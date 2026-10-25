#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  --help|-h) echo 'Usage: bash scripts/build.sh — install locked npm dependencies and build TypeScript backend and web frontend (no database needed).'; exit 0 ;;
  '') ;;
  *) echo 'Usage: bash scripts/build.sh' >&2; exit 2 ;;
esac
if (($# > 1)); then echo 'Too many arguments.' >&2; exit 2; fi
cd "$(dirname "${BASH_SOURCE[0]}")/.."
npm ci --include=optional
npm run build
