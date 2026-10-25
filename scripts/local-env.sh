#!/usr/bin/env bash
# Source this file to use the project's Homebrew runtimes.
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'This helper is for macOS. On Linux, use bash scripts/start-dev.sh.' >&2
  return 1
fi
if ! command -v brew >/dev/null 2>&1; then
  echo 'Install Homebrew and the README macOS prerequisites first.' >&2
  return 1
fi
bluff_brew_prefix="$(brew --prefix)"
export PATH="$bluff_brew_prefix/opt/node@24/bin:$bluff_brew_prefix/opt/postgresql@16/bin:$bluff_brew_prefix/bin:$PATH"
