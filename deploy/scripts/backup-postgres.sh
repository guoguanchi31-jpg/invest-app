#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
BACKUP_DIR="${ROOT_DIR}/backups"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${ROOT_DIR}/docker-compose.yml")

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}." >&2
  exit 1
fi

command -v gzip >/dev/null 2>&1 || {
  echo "gzip is required." >&2
  exit 1
}

mkdir -p "${BACKUP_DIR}"
umask 077
BACKUP_FILE="${BACKUP_DIR}/invest-$(date +%Y%m%d-%H%M%S).sql.gz"

"${COMPOSE[@]}" exec -T db sh -c \
  'pg_dump --clean --if-exists --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  | gzip -9 > "${BACKUP_FILE}"

find "${BACKUP_DIR}" -type f -name 'invest-*.sql.gz' -mtime "+${RETENTION_DAYS}" -delete

echo "Created ${BACKUP_FILE}"
