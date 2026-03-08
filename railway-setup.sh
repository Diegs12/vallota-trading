#!/bin/bash
# One-time Railway setup — sets all env vars and generates a public domain
# Run this ONCE after `railway login` and `railway init`
#
# Usage: source .env && ./railway-setup.sh

set -e

echo "=== Vallota Trading — Railway One-Time Setup ==="

# Check Railway auth
if ! railway whoami 2>/dev/null; then
  echo "Not logged in. Run: railway login"
  exit 1
fi

# Load .env if it exists
if [ -f .env ]; then
  echo "Loading .env file..."
  set -a
  source .env
  set +a
fi

# Set all env vars in Railway
echo "Setting environment variables in Railway..."
railway variables set \
  ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
  TRADING_MODE="${TRADING_MODE:-paper}" \
  RISK_PROFILE="${RISK_PROFILE:-moderate}" \
  TRADING_CAPITAL_USD="${TRADING_CAPITAL_USD:-1000}" \
  ANALYSIS_INTERVAL_MS="${ANALYSIS_INTERVAL_MS:-120000}" \
  XAI_API_KEY="${XAI_API_KEY}" \
  RESEND_API_KEY="${RESEND_API_KEY}" \
  RECAP_EMAIL="${RECAP_EMAIL}" \
  RECAP_FREQUENCY="${RECAP_FREQUENCY:-daily}" \
  RECAP_THEME="${RECAP_THEME:-clean}" \
  BOT_INSTANCE_ID="${BOT_INSTANCE_ID:-primary}" \
  PORT="3333"

echo ""
echo "Generating public domain..."
railway domain

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Your bot will auto-redeploy when you push to GitHub."
echo "To trigger a manual deploy: railway up --detach"
echo "To view logs: railway logs"
echo ""
echo "NEXT STEP: Copy the domain above, then run:"
echo "  cd ~/datenight-demo"
echo "  vercel env add REACT_APP_BOT_API production"
echo "  (paste: https://YOUR-DOMAIN-ABOVE)"
echo "  vercel --prod"
