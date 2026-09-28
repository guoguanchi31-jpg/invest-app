#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

if [[ ! -f /etc/os-release ]]; then
  echo "Unsupported Linux distribution." >&2
  exit 1
fi

. /etc/os-release

case "${ID}" in
  ubuntu|debian) ;;
  *)
    echo "This script supports Ubuntu and Debian only." >&2
    exit 1
    ;;
esac

apt-get update
apt-get install -y ca-certificates curl gnupg openssl

install -m 0755 -d /etc/apt/keyrings
curl -fsSL "https://download.docker.com/linux/${ID}/gpg" \
  | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

ARCH="$(dpkg --print-architecture)"
CODENAME="${VERSION_CODENAME}"
echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${ID} ${CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable --now docker

TARGET_USER="${SUDO_USER:-}"
if [[ -n "${TARGET_USER}" && "${TARGET_USER}" != "root" ]]; then
  usermod -aG docker "${TARGET_USER}"
  echo "Added ${TARGET_USER} to the docker group. Sign out and back in before deploying."
fi

echo "Docker and Docker Compose are ready."
echo "Open TCP 80 and 443 in the cloud security group; restrict SSH to trusted IP addresses."
