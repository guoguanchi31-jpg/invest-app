"""Atomic PostgreSQL backups and disposable-container restore drills (Python 3.10+)."""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[2]


def run(args, *, stdin=None, stdout=subprocess.PIPE, timeout=600):
    try:
        return subprocess.run(
            args, stdin=stdin, stdout=stdout, stderr=subprocess.PIPE,
            check=True, timeout=timeout,
        ).stdout
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        # pg_dump/psql errors may contain SQL data; do not copy them to status/logs.
        raise RuntimeError(f"{Path(args[0]).name} failed ({type(exc).__name__})") from None


def sync_directory(folder):
    descriptor = os.open(folder, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_json(path, payload):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as output:
        temporary = Path(output.name)
        try:
            output.write((json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode())
            output.flush()
            os.fsync(output.fileno())
            os.replace(temporary, path)
            sync_directory(path.parent)
        finally:
            temporary.unlink(missing_ok=True)


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def validate_dump(path):
    size = 0
    with gzip.open(path, "rb") as source:
        first = source.read(4096)
        if b"-- PostgreSQL database dump" not in first:
            raise ValueError("not a PostgreSQL plain SQL dump")
        size += len(first)
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            size += len(chunk)
    if size < 100:
        raise ValueError("empty PostgreSQL dump")


@contextmanager
def exclusive_backup(folder):
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (folder / ".backup.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("another backup is already running") from None
        yield


def load_status(folder):
    path = folder / "backup-status.json"
    return json.loads(path.read_text()) if path.exists() else {}


def backup(root, folder, retention_days=14, mirror=None):
    if retention_days < 1:
        raise ValueError("retention days must be positive")
    with exclusive_backup(folder):
        status = load_status(folder)
        status.update(status="running", attempted_at=time.time())
        atomic_json(folder / "backup-status.json", status)
        try:
            if not (root / ".env").is_file():
                raise ValueError("deployment .env is missing")
            if mirror and mirror.resolve() == folder.resolve():
                raise ValueError("mirror must be a different directory")
            name = f"invest-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}-{uuid4().hex[:8]}.sql.gz"
            target = folder / name
            compose = ["docker", "compose", "--env-file", str(root / ".env"),
                       "-f", str(root / "docker-compose.yml")]
            with tempfile.TemporaryDirectory(prefix=".backup-", dir=folder) as temporary:
                raw = Path(temporary) / "dump.sql"
                packed = Path(temporary) / name
                with raw.open("wb") as output:
                    run(compose + ["exec", "-T", "db", "sh", "-c",
                                   'pg_dump --clean --if-exists --no-owner --no-privileges '
                                   '-U "$POSTGRES_USER" "$POSTGRES_DB"'], stdout=output)
                with raw.open("rb") as source, packed.open("wb") as output:
                    os.chmod(packed, 0o600)
                    with gzip.GzipFile(fileobj=output, mode="wb", compresslevel=9) as archive:
                        shutil.copyfileobj(source, archive)
                    output.flush()
                    os.fsync(output.fileno())
                validate_dump(packed)
                checksum = digest(packed)
                os.replace(packed, target)
                sync_directory(folder)
            mirror_path = None
            if mirror:
                mirror.mkdir(parents=True, exist_ok=True, mode=0o700)
                with tempfile.NamedTemporaryFile(dir=mirror, delete=False) as output:
                    staged = Path(output.name)
                    try:
                        with target.open("rb") as source:
                            shutil.copyfileobj(source, output)
                        output.flush()
                        os.fsync(output.fileno())
                        if digest(staged) != checksum:
                            raise ValueError("mirror checksum mismatch")
                        os.replace(staged, mirror / name)
                        sync_directory(mirror)
                    finally:
                        staged.unlink(missing_ok=True)
                mirror_path = str((mirror / name).resolve())
            status = {
                "status": "succeeded", "attempted_at": status["attempted_at"],
                "last_success_at": time.time(), "file": name, "sha256": checksum,
                "bytes": target.stat().st_size, "mirror": mirror_path,
            }
            atomic_json(folder / "backup-status.json", status)
            # Retention runs only after local and configured mirror copies succeed.
            cutoff = time.time() - retention_days * 86400
            for candidate in folder.glob("invest-*.sql.gz"):
                if candidate != target and candidate.stat().st_mtime < cutoff:
                    candidate.unlink()
            return status
        except BaseException as exc:
            status.update(status="failed", failed_at=time.time(), error_type=type(exc).__name__)
            atomic_json(folder / "backup-status.json", status)
            raise


def check(folder, max_age_hours=26):
    if max_age_hours <= 0:
        raise ValueError("max age must be positive")
    status = load_status(folder)
    if status.get("status") != "succeeded":
        raise ValueError("latest backup did not succeed")
    age = time.time() - status["last_success_at"]
    if age < 0 or age > max_age_hours * 3600:
        raise ValueError("latest backup is stale or has an invalid timestamp")
    source = folder / Path(status["file"]).name
    validate_dump(source)
    if digest(source) != status["sha256"]:
        raise ValueError("local backup checksum mismatch")
    if status.get("mirror") and digest(Path(status["mirror"])) != status["sha256"]:
        raise ValueError("mirror checksum mismatch")
    return {"status": "healthy", "age_seconds": round(age), "file": source.name}


DRILL_QUERY = """
SELECT json_build_object(
    'schema_version', (SELECT MAX(version) FROM schema_migrations),
    'accounts', (SELECT COUNT(*) FROM accounts),
    'transactions', (SELECT COUNT(*) FROM transactions),
    'investment_trades', (SELECT COUNT(*) FROM investment_trades),
    'audit_events', (SELECT COUNT(*) FROM audit_events),
    'invalid_cash', (SELECT COUNT(*) FROM accounts
        WHERE type = 'investment' AND is_liability = 0 AND cash_available < 0),
    'orphan_accounts', (SELECT COUNT(*) FROM accounts a LEFT JOIN family_members m
        ON m.id = a.member_id AND m.family_id = a.family_id
        WHERE a.member_id IS NOT NULL AND m.id IS NULL),
    'orphan_transactions', (SELECT COUNT(*) FROM transactions t LEFT JOIN accounts a
        ON a.id = t.account_id AND a.family_id = t.family_id
        WHERE a.id IS NULL)
);
"""


def drill(source, folder, image="postgres:16-alpine", expected_schema=None):
    source = source.resolve()
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    name = "invest-restore-drill-" + uuid4().hex
    started = time.time()
    report = {"status": "running", "backup": source.name, "started_at": started}
    report_file = folder / f"{name}.json"
    atomic_json(report_file, report)
    container_attempted = False
    try:
        validate_dump(source)
        report.update(sha256=digest(source), backup_age_seconds=max(0, round(started - source.stat().st_mtime)))
        container_attempted = True
        # No Compose, production network, published port or host volume.
        run(["docker", "run", "-d", "--name", name, "--network", "none",
             "-e", "POSTGRES_HOST_AUTH_METHOD=trust", image], timeout=120)
        for attempt in range(60):
            try:
                # The image starts a temporary server during init. Wait until the
                # entrypoint has exec'd the final postgres process before restore.
                run([
                    "docker", "exec", name, "sh", "-c",
                    'test "$(cat /proc/1/comm)" = postgres '
                    '&& pg_isready -U postgres -d postgres',
                ], timeout=5)
                break
            except RuntimeError:
                if attempt == 59:
                    raise RuntimeError("restore drill database did not become ready") from None
                time.sleep(1)
        # Full gzip validation has already finished before any SQL is submitted.
        with tempfile.TemporaryFile() as raw:
            with gzip.open(source, "rb") as archive:
                shutil.copyfileobj(archive, raw)
            raw.seek(0)
            run(["docker", "exec", "-i", name, "psql", "--single-transaction",
                 "-v", "ON_ERROR_STOP=1", "-U", "postgres", "postgres"],
                stdin=raw, stdout=subprocess.DEVNULL)
        evidence = json.loads(run([
            "docker", "exec", name, "psql", "-X", "-At", "-v", "ON_ERROR_STOP=1",
            "-U", "postgres", "postgres", "-c", DRILL_QUERY,
        ]))
        if not evidence.get("schema_version"):
            raise ValueError("restored schema version is missing")
        if expected_schema is not None and evidence["schema_version"] != expected_schema:
            raise ValueError("restored schema version does not match expected version")
        if any(evidence[key] for key in ("invalid_cash", "orphan_accounts", "orphan_transactions")):
            raise ValueError("restored ledger invariants failed")
        report.update(status="succeeded", checks=evidence)
        return report
    except BaseException as exc:
        report.update(status="failed", error_type=type(exc).__name__)
        raise
    finally:
        report["restore_seconds"] = round(time.time() - started, 3)
        try:
            if container_attempted:
                run(["docker", "rm", "-fv", name], timeout=30)
        except Exception:
            report.update(status="failed", cleanup_failed=True, container=name)
            raise
        finally:
            atomic_json(report_file, report)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--backup-dir", type=Path)
    commands = parser.add_subparsers(dest="command", required=True)
    backup_args = commands.add_parser("backup")
    backup_args.add_argument("--retention-days", type=int, default=int(os.environ.get("BACKUP_RETENTION_DAYS", "14")))
    backup_args.add_argument("--mirror-dir", type=Path, default=os.environ.get("BACKUP_MIRROR_DIR"))
    check_args = commands.add_parser("check")
    check_args.add_argument("--max-age-hours", type=float, default=26)
    drill_args = commands.add_parser("drill")
    drill_args.add_argument("file", type=Path)
    drill_args.add_argument("--image", default="postgres:16-alpine")
    drill_args.add_argument("--expected-schema", type=int)
    args = parser.parse_args()
    os.umask(0o077)
    folder = args.backup_dir or args.root / "backups"
    def interrupt(_signal, _frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, interrupt)
    try:
        if args.command == "backup":
            result = backup(args.root, folder, args.retention_days, args.mirror_dir)
        elif args.command == "check":
            result = check(folder, args.max_age_hours)
        else:
            result = drill(args.file, folder, args.image, args.expected_schema)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (Exception, KeyboardInterrupt) as exc:
        print(f"PostgreSQL backup {args.command} failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
