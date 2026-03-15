#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

PATTERN='(sk-[A-Za-z0-9]{20,}|xai-[A-Za-z0-9_-]{20,}|re_[A-Za-z0-9_\-]{10,}|BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z\-_]{35})'

echo "Scanning tracked files for potential secrets..."
FILES=$(git ls-files)
if [ -z "$FILES" ]; then
  echo "No tracked files found."
  exit 0
fi

# shellcheck disable=SC2086
if rg -n -e "$PATTERN" $FILES; then
  echo "Potential secrets detected. Review the lines above."
  exit 1
fi

echo "No obvious secrets found in tracked files."
