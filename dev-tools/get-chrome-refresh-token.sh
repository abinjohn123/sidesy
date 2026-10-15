#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Generate a Google OAuth refresh token for Chrome Web Store API.

Usage:
  scripts/get-chrome-refresh-token.sh --client-id <id> --client-secret <secret> [--port <port>]

Options:
  --client-id       OAuth client ID (Web application client)
  --client-secret   OAuth client secret
  --port            Localhost port used for redirect URI (default: 8765)
  -h, --help        Show this help text

You can also provide credentials via environment variables:
  CHROME_CLIENT_ID
  CHROME_CLIENT_SECRET
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

urlencode() {
  jq -rn --arg v "$1" '$v|@uri'
}

CLIENT_ID="${CHROME_CLIENT_ID:-}"
CLIENT_SECRET="${CHROME_CLIENT_SECRET:-}"
PORT="8765"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --client-id)
      CLIENT_ID="${2:-}"
      shift 2
      ;;
    --client-secret)
      CLIENT_SECRET="${2:-}"
      shift 2
      ;;
    --port)
      PORT="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
  echo "Both client ID and client secret are required." >&2
  usage
  exit 1
fi

require_cmd curl
require_cmd jq

REDIRECT_URI="http://localhost:${PORT}/callback"
SCOPE="https://www.googleapis.com/auth/chromewebstore"
AUTH_BASE="https://accounts.google.com/o/oauth2/v2/auth"

AUTH_URL="${AUTH_BASE}?client_id=$(urlencode "$CLIENT_ID")&redirect_uri=$(urlencode "$REDIRECT_URI")&response_type=code&scope=$(urlencode "$SCOPE")&access_type=offline&prompt=consent"

echo "Step 1: Ensure this redirect URI exists in your OAuth client:"
echo "  ${REDIRECT_URI}"
echo
echo "Step 2: Open this URL in your browser and authorize:"
echo "  ${AUTH_URL}"
echo
echo "Google will redirect to localhost. The page may fail to load if no local server is listening."
echo "Copy the 'code' query parameter from the URL bar and paste it here."
printf "Authorization code: "
IFS= read -r AUTH_CODE

if [ -z "$AUTH_CODE" ]; then
  echo "Authorization code is required." >&2
  exit 1
fi

TOKEN_RESPONSE="$(curl -sS -X POST "https://oauth2.googleapis.com/token" \
  -d "code=${AUTH_CODE}" \
  -d "client_id=${CLIENT_ID}" \
  -d "client_secret=${CLIENT_SECRET}" \
  -d "redirect_uri=${REDIRECT_URI}" \
  -d "grant_type=authorization_code")"

ACCESS_TOKEN="$(echo "$TOKEN_RESPONSE" | jq -r '.access_token // empty')"
REFRESH_TOKEN="$(echo "$TOKEN_RESPONSE" | jq -r '.refresh_token // empty')"
ERROR_CODE="$(echo "$TOKEN_RESPONSE" | jq -r '.error // empty')"

if [ -n "$ERROR_CODE" ]; then
  echo "Token exchange failed: $ERROR_CODE" >&2
  echo "$TOKEN_RESPONSE" | jq .
  exit 1
fi

if [ -z "$REFRESH_TOKEN" ]; then
  echo "No refresh token returned. Full response:" >&2
  echo "$TOKEN_RESPONSE" | jq .
  echo
  echo "If this is a repeat authorization, ensure 'prompt=consent' is present and approve again."
  exit 1
fi

echo
echo "Success. New tokens were generated."
echo "Refresh token:"
echo "$REFRESH_TOKEN"
echo
echo "Next: update GitHub secret CHROME_REFRESH_TOKEN with this value."
echo "Optional quick check (access token presence):"
if [ -n "$ACCESS_TOKEN" ]; then
  echo "  Access token generated successfully."
else
  echo "  Access token not present in response."
fi
