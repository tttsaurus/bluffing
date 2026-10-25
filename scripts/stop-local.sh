#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
pid_file="$project_root/.local/app.pid"
if [[ ! -f "$pid_file" ]]; then
  echo "No saved application process."
  exit 0
fi
app_pid="$(cat "$pid_file")"
case "$app_pid" in ''|*[!0-9]*) echo "Invalid application PID" >&2; exit 1;; esac
command_line="$(ps -p "$app_pid" -o command= || true)"
if [[ "$command_line" == *"$project_root/scripts/start-dev.sh"* || "$command_line" == *"$project_root/scripts/dev/start.sh"* ]]; then
  kill -TERM "$app_pid"
  echo "Stopping frontend and backend. PostgreSQL remains running."
else
  echo "Saved application process is no longer running."
fi
