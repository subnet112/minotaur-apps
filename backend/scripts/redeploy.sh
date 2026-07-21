#!/usr/bin/env bash
#
# Manual redeploy of the swap backend to its EC2 box, WITHOUT leaving SSH open.
#
# The box's security group has no public SSH by design. This script:
#   1. opens tcp/22 to *only your current public IP* (temporarily),
#   2. ships the current backend/ source and runs `docker compose up -d --build`,
#   3. revokes the SSH rule again (even if the deploy fails — via trap).
#
# It does NOT touch /opt/swap-backend/.env, so the RPC keys already on the box
# are preserved. To change env, edit .env on the box during a deploy window.
#
# Usage:  ./scripts/redeploy.sh
# Requires: awscli (configured), ssh/scp, and the deploy key (KEY below).
set -euo pipefail

REGION="${REGION:-us-east-1}"
SG="${SG:-sg-0ffd9f1441f7ad3e0}"
HOST="${HOST:-54.204.26.248}"
SSH_USER="${SSH_USER:-ec2-user}"
KEY="${KEY:-$HOME/.ssh/minotaur-swap-backend.pem}"
APP_DIR="/opt/swap-backend"

cd "$(dirname "$0")/.."   # backend/
[ -f package.json ] || { echo "run from the backend/ dir"; exit 1; }
[ -f "$KEY" ] || { echo "deploy key not found at $KEY"; exit 1; }

MYIP="$(curl -s --max-time 10 https://checkip.amazonaws.com | tr -d '[:space:]')/32"
echo "→ opening tcp/22 to $MYIP"
aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG" \
  --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=$MYIP,Description=redeploy}]" >/dev/null

cleanup() {
  echo "→ revoking tcp/22 from $MYIP"
  aws ec2 revoke-security-group-ingress --region "$REGION" --group-id "$SG" \
    --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=$MYIP}]" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "→ building artifact"
tar czf /tmp/swap-backend-deploy.tar.gz \
  --exclude=node_modules --exclude=dist --exclude=.env --exclude='*.log' --exclude=.git .

echo "→ waiting for SSH"
for i in $(seq 1 10); do
  ssh -i "$KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=5 "$SSH_USER@$HOST" true 2>/dev/null && break
  sleep 3
done

echo "→ shipping + rebuilding"
scp -i "$KEY" -o StrictHostKeyChecking=no /tmp/swap-backend-deploy.tar.gz "$SSH_USER@$HOST:/tmp/"
ssh -i "$KEY" -o StrictHostKeyChecking=no "$SSH_USER@$HOST" "bash -s" <<REMOTE
set -e
cd $APP_DIR
sudo tar xzf /tmp/swap-backend-deploy.tar.gz
sudo docker compose up -d --build 2>&1 | tail -4
REMOTE

echo "→ health check"
sleep 4
curl -fsS --max-time 8 "http://$HOST:8080/health" && echo " ✓ deployed"
