#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
HTTPS_TEMPLATE="${ROOT_DIR}/deploy/nginx/https.conf.template"
HTTPS_CONFIG="${ROOT_DIR}/deploy/nginx/conf.d/https.conf"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${ROOT_DIR}/docker-compose.yml")

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}." >&2
  exit 1
fi

set -a
. "${ENV_FILE}"
set +a

if [[ ! "${DOMAIN}" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$ ]]; then
  echo "Invalid DOMAIN in ${ENV_FILE}." >&2
  exit 1
fi

if [[ -z "${LETSENCRYPT_EMAIL:-}" ]]; then
  echo "LETSENCRYPT_EMAIL is required." >&2
  exit 1
fi

"${COMPOSE[@]}" up -d --wait db backend web

"${COMPOSE[@]}" run --rm certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --domain "${DOMAIN}" \
  --email "${LETSENCRYPT_EMAIL}" \
  --agree-tos \
  --no-eff-email \
  --keep-until-expiring

TMP_CONFIG="$(mktemp "${HTTPS_CONFIG}.XXXXXX")"
trap 'rm -f "${TMP_CONFIG}"' EXIT
sed "s/__DOMAIN__/${DOMAIN}/g" "${HTTPS_TEMPLATE}" > "${TMP_CONFIG}"
mv "${TMP_CONFIG}" "${HTTPS_CONFIG}"

"${COMPOSE[@]}" exec web nginx -t
"${COMPOSE[@]}" exec web nginx -s reload

echo "HTTPS is enabled at https://${DOMAIN}"
