#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${ROOT_DIR}/docker-compose.yml")

if [[ $# -ne 2 || "$2" != "--confirm-restore" ]]; then
  echo "Usage: $0 <backup.sql.gz> --confirm-restore" >&2
  exit 1
fi

BACKUP_FILE="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "Backup not found: ${BACKUP_FILE}" >&2
  exit 1
fi

"${ROOT_DIR}/deploy/scripts/backup-postgres.sh"
"${COMPOSE[@]}" stop web backend

restart_app() {
  "${COMPOSE[@]}" up -d --wait backend web
}
trap restart_app EXIT

gzip -dc "${BACKUP_FILE}" \
  | "${COMPOSE[@]}" exec -T db sh -c \
      'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" "$POSTGRES_DB"'

restart_app
trap - EXIT

echo "Restored ${BACKUP_FILE}"
