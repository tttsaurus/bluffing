#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/../.." && pwd)"
for argument in "$@"; do
  case "$argument" in
    --tailnet) ;;
    --help|-h) echo 'Usage: bash scripts/macos/start.sh [--tailnet] — start project-local PostgreSQL and the app.'; exit 0 ;;
    *) echo "Unknown argument: $argument" >&2; exit 2 ;;
  esac
done
source "$project_root/scripts/macos/env.sh"
for required in node npm initdb pg_ctl psql createdb; do
  command -v "$required" >/dev/null 2>&1 || { echo "Required command not found: $required" >&2; exit 1; }
done
export PATH="$project_root/scripts/macos/bin:$PATH"
data_dir="$project_root/.local/postgres"
mkdir -p "$project_root/.local"
pid_file="$project_root/.local/app.pid"
if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
  echo "A previous launcher is still running. Stop it with Ctrl+C first."
  exit 1
fi

if [[ ! -f "$data_dir/PG_VERSION" ]]; then
  initdb -D "$data_dir" -U blufftable --encoding=UTF8 --locale=C \
    --auth-local=trust --auth-host=scram-sha-256 --pwfile=<(printf '%s\n' blufftable)
fi
if ! pg_ctl -D "$data_dir" status >/dev/null 2>&1; then
  pg_ctl -D "$data_dir" -l "$project_root/.local/postgres.log" \
    -o "-h 127.0.0.1 -p 5433 -k \"$project_root/.local\"" -w start
fi
export PGPASSWORD=blufftable
if [[ "$(psql -h 127.0.0.1 -p 5433 -U blufftable -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'blufftable'")" != 1 ]]; then
  createdb -h 127.0.0.1 -p 5433 -U blufftable blufftable
fi
unset PGPASSWORD
export DATABASE_URL="postgresql://blufftable:blufftable@127.0.0.1:5433/blufftable"
export DATABASE_URL_UNPOOLED="$DATABASE_URL"
export DIRECT_URL="$DATABASE_URL"
export BLUFF_STARTUP_TIMEOUT="${BLUFF_STARTUP_TIMEOUT:-600}"
exec bash "$project_root/scripts/start-dev.sh" "$@"
