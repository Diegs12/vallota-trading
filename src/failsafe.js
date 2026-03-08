// Claude API failsafe — if Claude goes down, protect capital
// Never leave the bot blind with open positions

async function safeAnalyze(analyzeFn, marketData, portfolio, riskProfile) {
  const MAX_RETRIES = 2;
  const RETRY_DELAY = 5000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const decision = await analyzeFn(marketData, portfolio, riskProfile);
      return { decision, failsafe: false };
    } catch (err) {
      console.warn(
        `Claude API attempt ${attempt}/${MAX_RETRIES} failed:`,
        err.message
      );

      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY));
      }
    }
  }

  // Claude is unreachable — enter failsafe mode
  console.error("\n*** FAILSAFE ACTIVATED — Claude API unreachable ***");
  console.error("Action: Selling all non-USDC positions to protect capital\n");

  // Find all non-USDC balances and generate sell orders
  const sellOrders = [];
  const balances = portfolio.balances || {};

  for (const [token, amount] of Object.entries(balances)) {
    if (token === "usdc" || token === "USDC" || amount <= 0) continue;

    sellOrders.push({
      action: "sell",
      token,
      amount_usd: null, // sell full position
      amount,
      confidence: 100,
      reasoning: "FAILSAFE: Claude API unreachable — liquidating to USDC",
      market_summary: "Unable to analyze — API down",
      risk_notes: "Emergency capital preservation",
      failsafe: true,
    });
  }

  if (sellOrders.length === 0) {
    return {
      decision: {
        action: "hold",
        token: "usdc",
        amount_usd: null,
        confidence: 100,
        reasoning: "FAILSAFE: Claude API unreachable — already in USDC, holding safe",
        market_summary: "Unable to analyze — API down",
        risk_notes: "Will resume normal operation when API recovers",
        failsafe: true,
      },
      failsafe: true,
    };
  }

  // Return first sell order (bot loop will handle one at a time)
  return {
    decision: sellOrders[0],
    failsafe: true,
    pendingSells: sellOrders.slice(1),
  };
}

module.exports = { safeAnalyze };
