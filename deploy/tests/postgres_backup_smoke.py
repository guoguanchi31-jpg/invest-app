"""CI-only real backup/restore drill on a fresh Compose project; never reuses a book."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("postgres_backup", ROOT / "deploy/scripts/postgres_backup.py")
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


def main():
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix="invest-backup-ci-") as temporary:
        root = Path(temporary)
        (root / ".env").write_text("COMPOSE_PROJECT_NAME=invest-backup-ci-" + uuid4().hex + "\n")
        (root / "docker-compose.yml").write_text("""
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: invest_test
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: isolated_test_password
    ports:
      - "127.0.0.1::5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d invest_test"]
      interval: 1s
      timeout: 5s
      retries: 30
""")
        compose = ["docker", "compose", "--env-file", str(root / ".env"),
                   "-f", str(root / "docker-compose.yml")]
        try:
            tool.run(compose + ["up", "-d", "--wait"], timeout=120)
            address = tool.run(compose + ["port", "db", "5432"]).decode().strip()
            # The only URL in this test comes from the newly created, named project.
            env = {
                **os.environ, "DATABASE_URL": f"postgresql://postgres:isolated_test_password@{address}/invest_test",
                "DB_DIR": str(root), "APP_ENV": "development", "APP_USERNAME": "admin",
                "APP_PASSWORD": "test_password", "APP_AUTH_SECRET": uuid4().hex * 2,
                "SEED_DEMO_DATA": "1", "ENABLE_SNAPSHOT_SCHEDULER": "0",
            }
            subprocess.run(
                [sys.executable, "migrate.py"], cwd=ROOT / "backend", env=env,
                check=True, capture_output=True, timeout=60,
            )
            result = tool.backup(root, root / "backups")
            tool.check(root / "backups")
            sys.path.insert(0, str(ROOT / "backend"))
            from migrations.schema import CURRENT_SCHEMA_VERSION
            evidence = tool.drill(
                root / "backups" / result["file"], root / "backups",
                expected_schema=CURRENT_SCHEMA_VERSION,
            )
            if evidence["checks"]["accounts"] < 1:
                raise AssertionError("fixture did not contain accounts")
            artifacts = ROOT / "deploy/test-results"
            artifacts.mkdir(exist_ok=True)
            tool.atomic_json(artifacts / "postgres-restore-drill.json", evidence)
            print(json.dumps(evidence))
        finally:
            tool.run(compose + ["down", "--volumes", "--remove-orphans"], timeout=60)


if __name__ == "__main__":
    main()
