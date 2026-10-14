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

# Reject truncated input before stopping the application.
gzip -t "${BACKUP_FILE}"

# Pin the selected archive: the pre-restore backup may prune old files.
umask 077
mkdir -p "${ROOT_DIR}/backups"
RESTORE_SOURCE="$(mktemp "${ROOT_DIR}/backups/.restore-XXXXXX")"
RESTART_REQUIRED=0
cleanup() {
  local result=$?
  trap - EXIT
  rm -f "${RESTORE_SOURCE}"
  if [[ "${RESTART_REQUIRED}" == 1 ]]; then
    "${COMPOSE[@]}" up -d --wait backend web || result=1
  fi
  exit "${result}"
}
trap cleanup EXIT
cp "${BACKUP_FILE}" "${RESTORE_SOURCE}"
gzip -t "${RESTORE_SOURCE}"

"${ROOT_DIR}/deploy/scripts/backup-postgres.sh"
RESTART_REQUIRED=1
"${COMPOSE[@]}" stop web backend

gzip -dc "${RESTORE_SOURCE}" \
  | "${COMPOSE[@]}" exec -T db sh -c \
      'psql --single-transaction -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" "$POSTGRES_DB"'

"${COMPOSE[@]}" up -d --wait backend web
RESTART_REQUIRED=0
echo "Restored ${BACKUP_FILE}"
