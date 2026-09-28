#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${ROOT_DIR}/docker-compose.yml")

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Run deploy/scripts/init-env.sh first." >&2
  exit 1
fi

if grep -q "CHANGE_ME" "${ENV_FILE}"; then
  echo "${ENV_FILE} still contains CHANGE_ME placeholders." >&2
  exit 1
fi

command -v docker >/dev/null 2>&1 || {
  echo "Docker is required." >&2
  exit 1
}

"${COMPOSE[@]}" config --quiet

if "${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx "db"; then
  "${ROOT_DIR}/deploy/scripts/backup-postgres.sh"
fi

"${COMPOSE[@]}" pull db
"${COMPOSE[@]}" build --pull backend web
"${COMPOSE[@]}" up -d --remove-orphans --wait db backend web
"${COMPOSE[@]}" ps

echo "Deployment is healthy."
echo "For the first deployment, run deploy/scripts/enable-https.sh after DNS resolves."
