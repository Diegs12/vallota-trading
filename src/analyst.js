const Anthropic = require("@anthropic-ai/sdk").default;
const { getLatestLessons } = require("./self-review");

const client = new Anthropic(); // uses ANTHROPIC_API_KEY env var

const RISK_PROFILES = {
  conservative: {
    maxPositionPct: 10,
    maxDrawdownPct: 3,
    preferStables: true,
    description: "Small positions, tight stops, prefer large-cap tokens only",
  },
  moderate: {
    maxPositionPct: 20,
    maxDrawdownPct: 7,
    preferStables: false,
    description: "Balanced positions, moderate risk, large and mid-cap tokens",
  },
  aggressive: {
    maxPositionPct: 35,
    maxDrawdownPct: 15,
    preferStables: false,
    description: "Larger positions, wider stops, includes small-cap tokens",
  },
};

function buildSystemPrompt(riskProfile) {
  const profile = RISK_PROFILES[riskProfile] || RISK_PROFILES.moderate;
  const lessons = getLatestLessons();

  return `You are an expert crypto trading analyst for the Vallota Trading bot.
You run on the Base L2 network via Coinbase. Your job is to analyze COMPUTED technical indicators and market data to make trading decisions.

IMPORTANT: The technical indicators (RSI, MACD, Bollinger Bands) have been computed programmatically with exact math. Trust these numbers — do NOT recalculate them. Your job is to INTERPRET them in context, not verify the arithmetic.

RISK PROFILE: ${riskProfile.toUpperCase()}
- Max position size: ${profile.maxPositionPct}% of portfolio
- Max acceptable drawdown: ${profile.maxDrawdownPct}%
- ${profile.description}

TRADABLE TOKENS ON BASE: ETH, USDC, AERO, BRETT, DEGEN, TOSHI, WELL
(You can only recommend trades for tokens available on Base via Coinbase)

RULES:
1. Always return valid JSON with your decision
2. If uncertain, default to HOLD — preserving capital is priority #1
3. Never go all-in on a single token
4. Consider correlation between positions
5. Factor in gas costs for small trades (may not be worth it)
6. Idle USDC should be noted for potential Aave V3 deposit
7. Pay attention to multi-timeframe alignment — a buy signal on 5m means nothing if the 4h and 1d are bearish
8. RSI below 30 = oversold (potential buy), above 70 = overbought (potential sell)
9. MACD histogram crossing zero is a trend change signal
10. Bollinger %B below 0 = oversold, above 1 = overbought
11. Grok social intelligence provides real-time X/Twitter sentiment — use it to confirm or contradict technical signals
12. If Grok reports breaking news (regulatory, hacks, major announcements), weigh it heavily — news moves markets before indicators catch up
13. If social sentiment strongly disagrees with technicals, reduce position size and confidence

${lessons ? `\nSELF-IMPROVEMENT NOTES (from reviewing your past trades):\n${lessons}\n` : ""}

RESPONSE FORMAT (strict JSON):
{
  "action": "buy" | "sell" | "hold",
  "token": "eth" | "usdc" | "aero" | etc,
  "amount_usd": number | null,
  "confidence": 0-100,
  "reasoning": "brief explanation referencing specific indicators",
  "market_summary": "1-2 sentence market overview",
  "risk_notes": "any concerns",
  "timeframe_alignment": "do multiple timeframes agree? which ones?"
}`;
}

async function analyzeMarket(marketData, portfolio, riskProfile = "moderate") {
  const systemPrompt = buildSystemPrompt(riskProfile);

  const userMessage = `Current time: ${new Date().toISOString()}

PORTFOLIO STATE:
${JSON.stringify(portfolio, null, 2)}

COMPUTED TECHNICAL INDICATORS (exact math — trust these numbers):
${JSON.stringify(marketData.technicals || {}, null, 2)}

MULTI-TIMEFRAME SUMMARY:
${JSON.stringify(marketData.timeframeSummary || {}, null, 2)}

MARKET DATA:
- Fear & Greed Index: ${marketData.fearGreed?.value || "N/A"} (${marketData.fearGreed?.value_classification || "N/A"})
- Top tokens by market cap: ${JSON.stringify(
    (marketData.prices || []).slice(0, 10).map((t) => ({
      symbol: t.symbol,
      price: t.current_price,
      change_24h: t.price_change_percentage_24h,
      volume: t.total_volume,
      mktCap: t.market_cap,
    })),
    null,
    2
  )}

DEFI TVL (top protocols):
${JSON.stringify(marketData.defiTvl || [], null, 2)}

${marketData.grokResearch ? `REAL-TIME SOCIAL INTELLIGENCE (from Grok/X):
${JSON.stringify(marketData.grokResearch, null, 2)}` : ""}

Based on all indicators, market data, and social intelligence, what is your trading decision? Respond with JSON only.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content[0].text;

  // Parse the JSON from Claude's response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Claude did not return valid JSON");
  }

  const decision = JSON.parse(jsonMatch[0]);
  console.log("\nAI Decision:", JSON.stringify(decision, null, 2));
  return decision;
}

module.exports = { analyzeMarket, RISK_PROFILES };
