#!/bin/bash
# Deploy Vallota Trading Bot to Railway
# Usage: ./deploy.sh

set -e

echo "=== Vallota Trading — Railway Deploy ==="

# Check Railway auth
if ! railway whoami 2>/dev/null; then
  echo "Not logged in to Railway. Running 'railway login'..."
  railway login
fi

# Check if linked to a project
if ! railway status 2>/dev/null; then
  echo ""
  echo "No Railway project linked. Creating one..."
  railway init --name vallota-trading
fi

# Set environment variables from .env
echo ""
echo "Setting environment variables..."
railway variables set \
  ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  TRADING_MODE="${TRADING_MODE:-paper}" \
  RISK_PROFILE="${RISK_PROFILE:-moderate}" \
  TRADING_CAPITAL_USD="${TRADING_CAPITAL_USD:-1000}" \
  ANALYSIS_INTERVAL_MS="${ANALYSIS_INTERVAL_MS:-120000}" \
  XAI_API_KEY="$XAI_API_KEY" \
  RESEND_API_KEY="$RESEND_API_KEY" \
  RECAP_EMAIL="${RECAP_EMAIL:-dvallota10@gmail.com}" \
  RECAP_FREQUENCY="${RECAP_FREQUENCY:-daily}" \
  RECAP_THEME="${RECAP_THEME:-clean}" \
  BOT_INSTANCE_ID="${BOT_INSTANCE_ID:-primary}" \
  2>/dev/null || echo "(some vars may already be set)"

echo ""
echo "Deploying to Railway..."
railway up --detach

echo ""
echo "=== Deploy initiated! ==="
echo "Run 'railway logs' to watch the bot start up."
echo "Run 'railway domain' to get your public URL for the dashboard."
echo ""
echo "After deploy completes, run:"
echo "  railway domain"
echo "Then set that URL as REACT_APP_BOT_API in Vercel:"
echo "  cd ~/datenight-demo && vercel env add REACT_APP_BOT_API production"
