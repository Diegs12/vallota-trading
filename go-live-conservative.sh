#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

railway variable set \
  TRADING_MODE=live \
  LIVE_TRADING_ENABLED=true \
  RISK_PROFILE=conservative \
  PER_TRADE_RISK_PCT=0.35 \
  DAILY_MAX_DRAWDOWN_PCT=1.5 \
  ANALYSIS_INTERVAL_MS=300000

railway up

echo "Live trading enabled in conservative mode."
