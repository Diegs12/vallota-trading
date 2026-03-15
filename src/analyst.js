const Anthropic = require("@anthropic-ai/sdk").default;
const { getLatestLessons } = require("./self-review");
const { getStrategyForPrompt } = require("./daily-strategist");

const client = new Anthropic(); // uses ANTHROPIC_API_KEY env var
const PRIMARY_MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest";
const FALLBACK_MODEL = process.env.ANTHROPIC_FALLBACK_MODEL || "claude-sonnet-4-20250514";

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
  const strategy = getStrategyForPrompt();

  return `You are an active, strategic crypto trading analyst for the Vallota Trading bot.
You run on the Base L2 network via Coinbase. Your job is to actively trade and generate as much data as possible for the learning system.

IMPORTANT: The technical indicators (RSI, MACD, Bollinger Bands) have been computed programmatically with exact math. Trust these numbers -- do NOT recalculate them. Your job is to INTERPRET them in context, not verify the arithmetic.

RISK PROFILE: ${riskProfile.toUpperCase()}
- Max position size: ${profile.maxPositionPct}% of portfolio
- Max acceptable drawdown: ${profile.maxDrawdownPct}%
- ${profile.description}

TRADABLE TOKENS ON BASE: ETH, USDC, AERO, BRETT, DEGEN, TOSHI, WELL
(You can only recommend trades for tokens available on Base via Coinbase)

TRADING PHILOSOPHY:
This is a paper trading bot in ACTIVE DATA COLLECTION mode. We need to trade frequently AND strategically to build a dataset of trades, learn what works, and improve through the self-review loop. Sitting in USDC generates zero learning. But random trades are wasteful too -- every trade should have a clear thesis.

RULES:
1. Always return valid JSON with your decision
2. BIAS TOWARD ACTION with a CLEAR THESIS. Every trade should have a reason: momentum, mean reversion, breakout, sentiment catalyst, derivatives signal, or Opus strategy alignment.
3. Trade frequently but strategically. Look for short-term plays with identifiable edges. If you see a setup, take it.
4. Use the full range of tokens. Don't just trade ETH -- AERO, BRETT, DEGEN, TOSHI, WELL offer higher volatility and more pattern diversity.
5. Scale into positions. Take a starter position on initial signal, add if it confirms.
6. RSI below 35 = buy zone. RSI above 65 = sell zone. Don't wait for extremes at 30/70.
7. MACD histogram crossing zero or showing momentum shift = trade signal.
8. Bollinger %B below 0.2 = buy zone, above 0.8 = sell zone.
9. If one timeframe shows a strong signal, that's enough to act. Don't require all timeframes to align.
10. Grok social intelligence: news and sentiment are catalysts. Act on them before they're priced in.
11. DERIVATIVES: extreme funding rates = fade the crowd. High-conviction contrarian signal.
12. When in doubt between hold and a small position, take the small position ($20-50). We learn more from trading than sitting.
13. Confidence of 50+ is enough to trade. Set expected_edge_pct honestly -- even 0.3% is worth capturing.
14. FOLLOW THE DAILY STRATEGY from Opus (below) -- it sets the regime, bias, and game plan. Your job is to execute that strategy on the real-time signals.
15. Always explain your thesis in the reasoning field. "Buying because RSI is low" is not enough -- say WHY this particular entry makes sense given the regime, strategy, and data.

${strategy ? `\n${strategy}\n` : ""}
${lessons ? `\nSELF-IMPROVEMENT NOTES (from reviewing your past trades):\n${lessons}\n` : ""}

RESPONSE FORMAT (strict JSON):
{
  "action": "buy" | "sell" | "hold",
  "token": "eth" | "usdc" | "aero" | etc,
  "amount_usd": number | null,
  "confidence": 0-100,
  "expected_edge_pct": number,
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

${marketData.derivatives ? `DERIVATIVES DATA (funding rates, open interest, long/short ratios):
${JSON.stringify(marketData.derivatives, null, 2)}` : ""}

${marketData.macro ? `MACRO DATA (BTC dominance, stablecoin flows, market trend):
${JSON.stringify(marketData.macro, null, 2)}` : ""}

${marketData.grokResearch ? `REAL-TIME SOCIAL INTELLIGENCE (from Grok/X):
${JSON.stringify(marketData.grokResearch, null, 2)}` : ""}

Based on ALL data — technicals, derivatives, macro, and social intelligence — what is your trading decision? Respond with JSON only.`;

  let response;
  let lastErr;
  for (const model of [PRIMARY_MODEL, FALLBACK_MODEL]) {
    try {
      response = await client.messages.create({
        model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      });
      break;
    } catch (err) {
      lastErr = err;
      console.warn(`Claude model ${model} failed: ${err.message}`);
    }
  }
  if (!response) {
    throw lastErr || new Error("No model could produce a decision");
  }

  const text = response.content[0].text;

  // Parse the JSON from Claude's response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Claude did not return valid JSON");
  }

  let decision;
  try {
    decision = JSON.parse(jsonMatch[0]);
  } catch (parseErr) {
    throw new Error("Claude returned malformed JSON: " + parseErr.message);
  }

  // Validate required fields exist and have correct types
  if (!decision || typeof decision !== "object") {
    throw new Error("Claude returned non-object JSON");
  }
  if (!decision.action || typeof decision.action !== "string") {
    throw new Error("Missing or invalid 'action' in AI response");
  }
  if (decision.confidence !== undefined && typeof decision.confidence !== "number") {
    decision.confidence = parseInt(decision.confidence) || 0;
  }
  if (decision.expected_edge_pct !== undefined && typeof decision.expected_edge_pct !== "number") {
    decision.expected_edge_pct = parseFloat(decision.expected_edge_pct) || 0;
  }

  console.log("\nAI Decision:", JSON.stringify(decision, null, 2));
  return decision;
}

module.exports = { analyzeMarket, RISK_PROFILES };
