#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${ROOT_DIR}/docker-compose.yml")

"${COMPOSE[@]}" run --rm certbot renew \
  --webroot \
  --webroot-path /var/www/certbot \
  --quiet

"${COMPOSE[@]}" exec web nginx -t
"${COMPOSE[@]}" exec web nginx -s reload

echo "Certificate renewal check completed."
