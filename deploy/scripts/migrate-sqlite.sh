#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${ROOT_DIR}/docker-compose.yml")

if [[ $# -ne 2 || "$2" != "--confirm-replace" ]]; then
  echo "Usage: $0 <invest.db> --confirm-replace" >&2
  exit 1
fi

SQLITE_FILE="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"

if [[ ! -f "${SQLITE_FILE}" ]]; then
  echo "SQLite database not found: ${SQLITE_FILE}" >&2
  exit 1
fi

"${ROOT_DIR}/deploy/scripts/backup-postgres.sh"
"${COMPOSE[@]}" stop web backend

restart_app() {
  "${COMPOSE[@]}" up -d --wait backend web
}
trap restart_app EXIT

"${COMPOSE[@]}" run --rm --no-deps \
  --volume "${SQLITE_FILE}:/tmp/invest.db:ro" \
  backend \
  python migrate_sqlite_to_postgres.py /tmp/invest.db --replace

restart_app
trap - EXIT

echo "SQLite data migrated to PostgreSQL."
