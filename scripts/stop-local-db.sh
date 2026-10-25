#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
source "$project_root/scripts/local-env.sh"
pg_ctl -D "$project_root/.local/postgres" -m fast -w stop
