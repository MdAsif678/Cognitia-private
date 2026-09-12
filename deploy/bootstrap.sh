#!/usr/bin/env bash
# Prepares a fresh Debian/Ubuntu VM to receive "Deploy analysis API". Run it ON THE VM, as the
# user the workflow will SSH in as:
#
#   curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/deploy/bootstrap.sh | bash -s -- api.example.com
#   # or, from a checkout:  bash deploy/bootstrap.sh api.example.com
#
# It installs Docker, creates /opt/cognitia, and writes a keyless .env. It is idempotent: an
# existing .env is never overwritten. It deploys nothing — the workflow does that.
set -euo pipefail

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "usage: bash deploy/bootstrap.sh <api-hostname>   (e.g. api.example.com)" >&2
  exit 64
fi

DIR=/opt/cognitia
USER_NAME="$(id -un)"

if ! command -v docker >/dev/null 2>&1; then
  echo "==> installing Docker"
  curl -fsSL https://get.docker.com | sudo sh
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "!! the Docker Compose plugin is missing; install docker-compose-plugin and re-run" >&2
  exit 1
fi

# The deploy workflow runs docker as this user over SSH, without sudo.
if ! id -nG "$USER_NAME" | tr ' ' '\n' | grep -qx docker; then
  echo "==> adding $USER_NAME to the docker group (log out and back in for it to take effect)"
  sudo usermod -aG docker "$USER_NAME"
fi

echo "==> preparing $DIR"
sudo install -d -o "$USER_NAME" -g "$USER_NAME" -m 755 "$DIR"

if [ -e "$DIR/.env" ]; then
  echo "==> $DIR/.env already exists, leaving it untouched"
else
  echo "==> writing $DIR/.env for $DOMAIN"
  cat > "$DIR/.env" <<ENV
DOMAIN=$DOMAIN
# API_IMAGE is supplied by the deploy workflow on each run.
SIM_CHAINS=1,11155111
# Keyless public upstreams, highest preference first. No provider account is required; the
# simulator parks an endpoint that rate-limits and rotates to the next one in the list.
RPC_URL_1=https://ethereum-rpc.publicnode.com,https://eth.drpc.org,https://1rpc.io/eth
RPC_URL_11155111=https://ethereum-sepolia-rpc.publicnode.com,https://1rpc.io/sepolia
CORS_ORIGINS=*
MAX_CONCURRENT_FORKS=2
WARM_FORKS_PER_CHAIN=1
ANALYSIS_TIMEOUT_MS=45000
THREAT_INCLUDE_DEMO=false
ENV
  chmod 600 "$DIR/.env"
fi

cat <<NEXT

Ready. $DIR holds the .env; the workflow copies compose.yml and Caddyfile on each deploy.

Still to do, once only:
  1. Point an A/AAAA record for $DOMAIN at this VM, and open ports 80 and 443.
     Caddy needs port 80 reachable to obtain the certificate.
  2. In the repository, set variable ANALYSIS_API_URL to https://$DOMAIN
  3. In the "production" environment, set secrets DEPLOY_HOST, DEPLOY_USER ($USER_NAME),
     DEPLOY_SSH_KEY, and DEPLOY_KNOWN_HOSTS. Generate the last one on your workstation with:
       ssh-keyscan -t ed25519 $DOMAIN
  4. Run the "Deploy analysis API" workflow.

Then build the extension against the deployed API:
  API_BASE_URL=https://$DOMAIN npm run build -w @cognitia/extension
NEXT
