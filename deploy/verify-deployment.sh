#!/usr/bin/env bash
# verify-deployment.sh — Verify the deployed Parallax demo on Nebius Cloud.
#
# Usage:
#   ./deploy/verify-deployment.sh [BASE_URL] [LOOK_TOKEN] [JUDGE_TOKEN]
#
# If arguments are omitted, it will attempt to read them from deploy/.env.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

BASE_URL="${1:-}"
LOOK_TOKEN="${2:-}"
JUDGE_TOKEN="${3:-}"

if [ -z "$BASE_URL" ] && [ -f "$ENV_FILE" ]; then
  DOMAIN="$(grep -E '^DOMAIN=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '"'"'" | tr -d ' ' || true)"
  if [ -n "$DOMAIN" ]; then
    BASE_URL="https://${DOMAIN}"
  fi
fi

if [ -z "$BASE_URL" ]; then
  BASE_URL="http://localhost:8080"
fi
BASE_URL="${BASE_URL%/}"

echo "=========================================="
echo "  Parallax Deployment Verification"
echo "  Target: $BASE_URL"
echo "=========================================="

echo -n "1. Checking /api/health (public endpoint)... "
HEALTH_RESP="$(curl -sSL -w "\nHTTP_STATUS:%{http_code}" "${BASE_URL}/api/health")"
STATUS="$(echo "$HEALTH_RESP" | grep "HTTP_STATUS:" | cut -d':' -f2)"
BODY="$(echo "$HEALTH_RESP" | grep -v "HTTP_STATUS:")"

if [ "$STATUS" = "200" ]; then
  echo "OK ($STATUS)"
  echo "   Response: $BODY"
else
  echo "FAIL ($STATUS)"
  echo "   Response: $BODY"
  exit 1
fi

echo -n "2. Checking unauthorized access to /api/whoami... "
UNAUTH_STATUS="$(curl -sSL -o /dev/null -w "%{http_code}" "${BASE_URL}/api/whoami" || true)"
if [ "$UNAUTH_STATUS" = "401" ]; then
  echo "OK (401 Unauthorized as expected)"
else
  echo "FAIL (expected 401, got $UNAUTH_STATUS)"
fi

if [ -n "$LOOK_TOKEN" ]; then
  echo -n "3. Checking looking token (/api/whoami)... "
  LOOK_RESP="$(curl -sSL -H "Authorization: Bearer ${LOOK_TOKEN}" "${BASE_URL}/api/whoami" || true)"
  if echo "$LOOK_RESP" | grep -q '"readOnly":true'; then
    echo "OK (readOnly: true confirmed)"
  else
    echo "FAIL (unexpected response: $LOOK_RESP)"
  fi
fi

if [ -n "$JUDGE_TOKEN" ]; then
  echo -n "4. Checking judge token (/api/whoami)... "
  JUDGE_RESP="$(curl -sSL -H "Authorization: Bearer ${JUDGE_TOKEN}" "${BASE_URL}/api/whoami" || true)"
  if echo "$JUDGE_RESP" | grep -q '"readOnly":false'; then
    echo "OK (readOnly: false / testing privileges confirmed)"
  else
    echo "FAIL (unexpected response: $JUDGE_RESP)"
  fi
fi

echo "=========================================="
echo "  Verification complete!"
echo "=========================================="
