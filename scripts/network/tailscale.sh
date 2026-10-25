#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
exec node --import tsx scripts/network/tailscale.ts "$@"
