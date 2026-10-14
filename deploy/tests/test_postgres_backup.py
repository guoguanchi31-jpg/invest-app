"""Backup failure injection; no Docker daemon or application database is used."""
import fcntl
import gzip
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/postgres_backup.py"
spec = importlib.util.spec_from_file_location("postgres_backup", SCRIPT)
backup_tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup_tool)
DUMP = b"-- PostgreSQL database dump\nCREATE TABLE proof (id int);\n" + b"-- evidence\n" * 20
EVIDENCE = {
    "schema_version": 8, "accounts": 2, "transactions": 3, "investment_trades": 0,
    "audit_events": 3, "invalid_cash": 0, "orphan_accounts": 0, "orphan_transactions": 0,
}


class BackupOperations(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / ".env").write_text("test only")
        self.folder = self.root / "backups"

    def dump(self, _args, *, stdout, **_kwargs):
        stdout.write(DUMP)

    def successful_backup(self, **kwargs):
        with patch.object(backup_tool, "run", side_effect=self.dump):
            return backup_tool.backup(self.root, self.folder, **kwargs)

    def test_success_is_durable_verified_private_and_mirrored(self):
        mirror = self.root / "mirror"
        result = self.successful_backup(mirror=mirror)
        source = self.folder / result["file"]
        self.assertEqual(gzip.decompress(source.read_bytes()), DUMP)
        self.assertEqual(source.stat().st_mode & 0o077, 0)
        self.assertEqual(backup_tool.check(self.folder)["status"], "healthy")
        self.assertEqual(source.read_bytes(), (mirror / source.name).read_bytes())
        self.assertEqual((self.folder / "backup-status.json").stat().st_mode & 0o077, 0)
        self.assertEqual(list(self.folder.glob(".backup-*")), [])
        (mirror / source.name).write_bytes(b"corrupt")
        with self.assertRaisesRegex(ValueError, "mirror"):
            backup_tool.check(self.folder)

    def test_failed_dump_never_publishes_or_deletes_previous_backup(self):
        previous = self.successful_backup()
        source = self.folder / previous["file"]
        os.utime(source, (1, 1))

        def partial_dump(_args, *, stdout, **_kwargs):
            stdout.write(DUMP[:50])
            raise RuntimeError("pg_dump failed")

        with patch.object(backup_tool, "run", side_effect=partial_dump):
            with self.assertRaises(RuntimeError):
                backup_tool.backup(self.root, self.folder, retention_days=1)
        self.assertEqual(list(self.folder.glob("*.sql.gz")), [source])
        status = backup_tool.load_status(self.folder)
        self.assertEqual(status["status"], "failed")
        self.assertEqual(status["last_success_at"], previous["last_success_at"])
        with self.assertRaisesRegex(ValueError, "did not succeed"):
            backup_tool.check(self.folder)

    def test_mirror_failure_marks_failure_and_prevents_retention(self):
        previous = self.successful_backup()
        source = self.folder / previous["file"]
        os.utime(source, (1, 1))
        mirror = self.root / "unavailable"
        mirror.write_text("not a directory")
        with self.assertRaises(OSError):
            self.successful_backup(retention_days=1, mirror=mirror)
        self.assertTrue(source.exists())
        self.assertEqual(backup_tool.load_status(self.folder)["status"], "failed")

    def test_check_rejects_truncated_and_stale_archives(self):
        result = self.successful_backup()
        with patch.object(backup_tool.time, "time", return_value=time.time() + 27 * 3600):
            with self.assertRaisesRegex(ValueError, "stale"):
                backup_tool.check(self.folder)
        source = self.folder / result["file"]
        source.write_bytes(source.read_bytes()[:-8])
        with self.assertRaises(EOFError):
            backup_tool.check(self.folder)
        result = subprocess.run(
            [os.sys.executable, str(SCRIPT), "--backup-dir", str(self.folder), "check"],
            capture_output=True,
        )
        self.assertNotEqual(result.returncode, 0)

    def test_concurrent_backup_is_rejected_without_replacing_status(self):
        previous = self.successful_backup()
        with (self.folder / ".backup.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(RuntimeError, "already running"):
                self.successful_backup()
        self.assertEqual(backup_tool.load_status(self.folder), previous)

    def test_drill_uses_only_isolated_container_and_cleans_up_after_sql_failure(self):
        result = self.successful_backup()
        calls = []

        def docker(args, **_kwargs):
            calls.append(args)
            if "psql" in args:
                raise RuntimeError("invalid restore SQL")
            return b""

        with patch.object(backup_tool, "run", side_effect=docker):
            with self.assertRaisesRegex(RuntimeError, "invalid restore SQL"):
                backup_tool.drill(self.folder / result["file"], self.folder)
        self.assertIn("--network", calls[0])
        self.assertIn("none", calls[0])
        self.assertNotIn("compose", " ".join(" ".join(args) for args in calls))
        self.assertEqual(calls[-1][:3], ["docker", "rm", "-fv"])
        report = json.loads(next(self.folder.glob("invest-restore-drill-*.json")).read_text())
        self.assertEqual(report["status"], "failed")

    def test_drill_verifies_schema_cash_and_orphans_before_success(self):
        result = self.successful_backup()
        for evidence, succeeds in [
            (EVIDENCE, True),
            ({**EVIDENCE, "schema_version": 7}, False),
            ({**EVIDENCE, "invalid_cash": 1}, False),
            ({**EVIDENCE, "orphan_transactions": 1}, False),
        ]:
            def docker(args, **_kwargs):
                return json.dumps(evidence).encode() if "-c" in args else b""

            with patch.object(backup_tool, "run", side_effect=docker):
                if succeeds:
                    report = backup_tool.drill(
                        self.folder / result["file"], self.folder, expected_schema=8,
                    )
                    self.assertEqual(report["checks"], EVIDENCE)
                    self.assertIn("restore_seconds", report)
                else:
                    with self.assertRaises(ValueError):
                        backup_tool.drill(
                            self.folder / result["file"], self.folder, expected_schema=8,
                        )

    def test_whole_database_restore_pins_archive_and_restarts_after_failure(self):
        scripts = self.root / "deploy/scripts"
        scripts.mkdir(parents=True)
        restore = scripts / "restore-postgres.sh"
        restore.write_text((SCRIPT.parent / restore.name).read_text())
        backup = scripts / "backup-postgres.sh"
        backup.write_text('#!/usr/bin/env bash\nrm -f "$TEST_SELECTED_BACKUP"\n')
        backup.chmod(0o700)
        binaries = self.root / "bin"
        binaries.mkdir()
        docker = binaries / "docker"
        docker.write_text("""#!/usr/bin/env bash
echo "$*" >> "$TEST_COMMAND_LOG"
if [[ "$*" == *"exec -T db"* ]]; then
  cat > "$TEST_RESTORED_SQL"
  exit "${TEST_RESTORE_EXIT:-0}"
fi
""")
        docker.chmod(0o700)
        selected = self.root / "old.sql.gz"
        log = self.root / "commands.log"
        restored = self.root / "restored.sql"
        for restore_exit in (0, 1):
            selected.write_bytes(gzip.compress(DUMP))
            log.write_text("")
            result = subprocess.run(
                ["bash", str(restore), str(selected), "--confirm-restore"],
                env={
                    **os.environ, "PATH": f"{binaries}:{os.environ['PATH']}",
                    "TEST_SELECTED_BACKUP": str(selected), "TEST_COMMAND_LOG": str(log),
                    "TEST_RESTORED_SQL": str(restored), "TEST_RESTORE_EXIT": str(restore_exit),
                },
                capture_output=True,
            )
            self.assertEqual(result.returncode, restore_exit, result.stderr)
            self.assertEqual(restored.read_bytes(), DUMP)
            self.assertIn("up -d --wait backend web", log.read_text().splitlines()[-1])
            self.assertFalse(selected.exists())
            self.assertEqual(list(self.folder.glob(".restore-*")), [])


if __name__ == "__main__":
    unittest.main()
