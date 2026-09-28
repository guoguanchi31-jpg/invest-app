#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <domain> <letsencrypt-email>" >&2
  exit 1
fi

DOMAIN="$1"
LETSENCRYPT_EMAIL="$2"

if [[ ! "${DOMAIN}" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$ ]]; then
  echo "Invalid domain: ${DOMAIN}" >&2
  exit 1
fi

if [[ ! "${LETSENCRYPT_EMAIL}" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  echo "Invalid email address: ${LETSENCRYPT_EMAIL}" >&2
  exit 1
fi

if [[ -e "${ENV_FILE}" ]]; then
  echo "${ENV_FILE} already exists; refusing to overwrite it." >&2
  exit 1
fi

command -v openssl >/dev/null 2>&1 || {
  echo "openssl is required." >&2
  exit 1
}

umask 077
POSTGRES_PASSWORD="$(openssl rand -hex 24)"
APP_PASSWORD="$(openssl rand -hex 12)"
APP_AUTH_SECRET="$(openssl rand -hex 48)"

cat > "${ENV_FILE}" <<EOF
COMPOSE_PROJECT_NAME=invest
DOMAIN=${DOMAIN}
LETSENCRYPT_EMAIL=${LETSENCRYPT_EMAIL}

POSTGRES_DB=invest
POSTGRES_USER=invest
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

APP_PASSWORD=${APP_PASSWORD}
APP_AUTH_SECRET=${APP_AUTH_SECRET}
AUTH_TOKEN_TTL_SECONDS=604800
ALLOWED_ORIGINS=https://${DOMAIN},capacitor://localhost,http://localhost,https://localhost

VITE_USER_NAME=冠池
VITE_USER_BADGE=个人理财空间
SEED_DEMO_DATA=0
TZ=Asia/Shanghai
EOF

chmod 600 "${ENV_FILE}"

echo "Created ${ENV_FILE} with generated database and application secrets."
echo "Review APP_PASSWORD in that file before the first login."
