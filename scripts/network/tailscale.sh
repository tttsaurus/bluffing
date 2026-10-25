#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

check_only=false
case "${1:-}" in
  --check) check_only=true ;;
  '') ;;
  --help|-h) echo 'Usage: bash scripts/network/tailscale.sh [--check]'; exit 0 ;;
  *) echo "Usage: bash scripts/network/tailscale.sh [--check]" >&2; exit 2 ;;
esac
if (($# > 1)); then echo "Too many arguments." >&2; exit 2; fi

if ! command -v tailscale >/dev/null 2>&1; then
  echo "Tailscale is not installed. Install it from https://tailscale.com/download" >&2
  exit 1
fi

require_commands node curl timeout

if ! tailscale_state="$(timeout 10 tailscale status --json | node -e 'let text = ""; process.stdin.on("data", chunk => text += chunk); process.stdin.on("end", () => { try { console.log(JSON.parse(text).BackendState); } catch { process.exitCode = 1; } });')"; then
  echo "Cannot read Tailscale status. Check that tailscaled is running and this account can access it." >&2
  exit 1
fi
if [[ "$tailscale_state" != Running ]]; then
  echo "Tailscale is not connected." >&2
  echo "Current state: $tailscale_state" >&2
  if [[ "$(uname -s)" == Darwin ]]; then
    echo "Open Tailscale.app, sign in if needed, and turn on its connection. Then retry." >&2
  else
    echo "Start the daemon and sign in first:" >&2
    echo "  sudo systemctl enable --now tailscaled" >&2
    echo "  sudo tailscale up" >&2
  fi
  exit 1
fi

if [[ "$check_only" == true ]]; then exit 0; fi

if ! curl --noproxy '*' --connect-timeout 1 --max-time 3 --fail --silent --output /dev/null http://127.0.0.1:5173/; then
  echo "The frontend is not running on 127.0.0.1:5173." >&2
  echo "Start it in another terminal with: cd frontend && npm run dev:tailnet" >&2
  exit 1
fi

if ! serve_output="$(timeout 30 tailscale serve --bg --yes http://127.0.0.1:5173 2>&1)"; then
  echo "$serve_output" >&2
  if [[ "$serve_output" == *"Access denied"* || "$serve_output" == *"serve config denied"* ]]; then
    echo >&2
    echo "Your Tailscale daemon requires elevated Serve permissions." >&2
    echo "Run this one-time command, then run this script again:" >&2
    echo '  sudo tailscale set --operator=$USER' >&2
  fi
  echo "Serve could not be configured. Check Tailscale HTTPS/Serve permissions and try again." >&2
  exit 1
fi

echo "$serve_output"
echo
echo "Bluff Table is available to devices allowed by your tailnet policy:"
timeout 10 tailscale serve status
