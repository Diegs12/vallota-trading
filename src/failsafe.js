// Claude API failsafe — if Claude goes down, protect capital
// Uses a consecutive failure counter to avoid panic-selling on brief blips

let consecutiveFailures = 0;
const FAILSAFE_THRESHOLD = parseInt(process.env.FAILSAFE_THRESHOLD || "3", 10); // Require sustained outage before liquidating

async function safeAnalyze(analyzeFn, marketData, portfolio, riskProfile) {
  const MAX_RETRIES = parseInt(process.env.CLAUDE_MAX_RETRIES || "2", 10);
  const RETRY_DELAY = parseInt(process.env.CLAUDE_RETRY_DELAY_MS || "5000", 10);
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    attempts++;
    try {
      const decision = await analyzeFn(marketData, portfolio, riskProfile);
      // Success — reset failure counter
      consecutiveFailures = 0;
      return { decision, failsafe: false, meta: { apiSuccess: true, attempts } };
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

  // All retries exhausted for this cycle
  consecutiveFailures++;
  console.warn(
    `Claude API unreachable (${consecutiveFailures}/${FAILSAFE_THRESHOLD} consecutive failures)`
  );

  // Only enter failsafe liquidation after sustained outage
  if (consecutiveFailures < FAILSAFE_THRESHOLD) {
    console.warn("Holding positions — will liquidate if outage persists.");
    return {
      decision: {
        action: "hold",
        token: "usdc",
        amount_usd: null,
        confidence: 0,
        reasoning: `CAUTION: Claude API unreachable (failure ${consecutiveFailures}/${FAILSAFE_THRESHOLD}). Holding until recovery or sustained outage triggers failsafe.`,
        market_summary: "Unable to analyze — API down",
        risk_notes: `Will liquidate all positions if API stays down for ${FAILSAFE_THRESHOLD} consecutive cycles`,
        failsafe: false,
      },
      failsafe: false,
      meta: { apiSuccess: false, attempts },
    };
  }

  // Sustained outage — enter failsafe mode
  console.error("\n*** FAILSAFE ACTIVATED — Claude API unreachable for 3+ cycles ***");
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
      reasoning: "FAILSAFE: Claude API unreachable for 3+ cycles — liquidating to USDC",
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
      meta: { apiSuccess: false, attempts },
    };
  }

  // Return first sell order (bot loop will handle one at a time)
  return {
    decision: sellOrders[0],
    failsafe: true,
    meta: { apiSuccess: false, attempts },
    pendingSells: sellOrders.slice(1),
  };
}

module.exports = { safeAnalyze };
