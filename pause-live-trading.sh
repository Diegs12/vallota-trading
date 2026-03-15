#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

railway variable set LIVE_TRADING_ENABLED=false
railway up

echo "Live trading paused (execution disabled)."
