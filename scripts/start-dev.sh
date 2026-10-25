#!/usr/bin/env bash
set -euo pipefail

# Linux/macOS convenience entry point; Windows uses start-dev.ps1 or npm run dev.
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec npm run dev -- "$@"
