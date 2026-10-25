#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == --help || "${1:-}" == -h ]]; then
  echo 'Usage: bash scripts/macos/stop-db.sh — stop project-local PostgreSQL without deleting data.'
  exit 0
fi
if (($#)); then echo 'Unknown argument' >&2; exit 2; fi
project_root="$(cd "$(dirname "$0")/../.." && pwd)"
source "$project_root/scripts/macos/env.sh"
pg_ctl -D "$project_root/.local/postgres" -m fast -w stop
