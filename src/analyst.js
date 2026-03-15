const Anthropic = require("@anthropic-ai/sdk").default;
const { getLatestLessons } = require("./self-review");
const { getStrategyForPrompt } = require("./daily-strategist");
const { getMarketKnowledge } = require("./market-knowledge");

const client = new Anthropic(); // uses ANTHROPIC_API_KEY env var
const PRIMARY_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = process.env.ANTHROPIC_FALLBACK_MODEL || "claude-sonnet-4-6-20250514";

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
  const knowledge = getMarketKnowledge();

  return `You are an active, strategic crypto trading analyst for the Vallota Trading bot.
You run on the Base L2 network via Coinbase. Your job is to actively trade and generate as much data as possible for the learning system.

${knowledge}

IMPORTANT: The technical indicators (RSI, MACD, Bollinger Bands) have been computed programmatically with exact math. Trust these numbers -- do NOT recalculate them. Your job is to INTERPRET them in context, not verify the arithmetic.

RISK PROFILE: ${riskProfile.toUpperCase()}
- Max position size: ${profile.maxPositionPct}% of portfolio
- Max acceptable drawdown: ${profile.maxDrawdownPct}%
- ${profile.description}

TRADABLE TOKENS: You can trade ANY token that appears in the market data below. The full universe includes:
- Core: ETH, BTC (via cbBTC)
- Base L2: AERO, BRETT, DEGEN, TOSHI, WELL, VIRTUAL, MORPHO
- Meme/momentum: PEPE, BONK, WIF, FLOKI, SHIB
- L1/L2: SOL, SUI, APT, TIA, SEI, INJ, ARB, OP
- DeFi: LINK, UNI, AAVE, RNDR, JUP, ONDO, ENA, PENDLE
- Plus any trending tokens from Grok/DexScreener data
Use the token's lowercase symbol in your response.

NO RESTRICTIONS: You have full freedom over position sizing and allocation. There are no minimum holdings, no risk caps, no edge filters. Make the best decision you can with the data available. If you want to go 100% into one token, do it. If you want to spread across 5 tokens, do it. The only goal is to make smart trades and generate data.

TRADING PHILOSOPHY:
Paper trading in ACTIVE DATA COLLECTION mode. Trade frequently AND strategically. Every trade needs a thesis. Sitting in USDC = zero learning. But we also hunt for MOMENTUM PLAYS:

MEME COIN / PUMP STRATEGY:
- When Grok reports a token surging on social media, consider a quick momentum play
- Pump timing: most social-driven pumps last 2-8 hours. Get in early, set a mental exit
- Position size for meme plays: $20-75 max (small bets, high frequency)
- If Grok says "early stage" pump, that's a buy signal. "Late stage" = stay away or short
- DexScreener trending tokens on Base = immediate attention. Check the data and consider entry
- Take profits fast on meme plays. 5-10% gain = sell. Don't get greedy on pump plays
- If a meme coin dumps 5%+ from your entry, cut it immediately. No bag-holding memes

RULES:
1. Always return valid JSON with your decision
2. BIAS TOWARD ACTION with a CLEAR THESIS. Every trade should have a reason: momentum, mean reversion, breakout, sentiment catalyst, pump play, derivatives signal, or Opus strategy alignment.
3. Trade frequently and diversely. Mix stable plays (ETH, SOL) with high-vol plays (BRETT, DEGEN, PEPE). Different tokens teach different patterns.
4. Use the FULL token universe. Don't just trade ETH. Meme coins and small caps generate the most interesting data.
5. Scale into positions. Starter position on signal, add on confirmation.
6. RSI below 35 = buy zone. RSI above 65 = sell zone. Don't wait for extremes.
7. MACD histogram crossing zero or showing momentum shift = trade signal.
8. Bollinger %B below 0.2 = buy zone, above 0.8 = sell zone.
9. One strong timeframe signal is enough to act. Don't require all to align.
10. Grok social intelligence: trending tokens and sentiment spikes are ACTIONABLE. If Grok reports a token going viral, consider a momentum entry immediately.
11. DERIVATIVES: extreme funding rates = fade the crowd. High-conviction contrarian signal.
12. When in doubt between hold and a small position, take the small position ($20-50).
13. Confidence of 50+ is enough to trade. Even 0.3% expected edge is worth capturing.
14. FOLLOW THE DAILY STRATEGY from Opus (below) -- it sets regime, bias, and game plan.
15. Always explain your thesis clearly. What's the setup, why now, what's the exit plan?
16. DIVERSIFY across tokens. Don't put everything in one coin. Spread bets to maximize learning.

${strategy ? `\n${strategy}\n` : ""}
${lessons ? `\nSELF-IMPROVEMENT NOTES (from reviewing your past trades):\n${lessons}\n` : ""}

RESPONSE FORMAT (strict JSON):
Return your PRIMARY trade decision, plus up to 3 additional trades if you see opportunities across different tokens. More trades = more data = faster learning.
{
  "action": "buy" | "sell" | "hold",
  "token": "eth" | "usdc" | "aero" | etc,
  "amount_usd": number | null,
  "confidence": 0-100,
  "expected_edge_pct": number,
  "reasoning": "brief explanation referencing specific indicators and knowledge base thresholds",
  "market_summary": "1-2 sentence market overview",
  "risk_notes": "any concerns",
  "timeframe_alignment": "do multiple timeframes agree? which ones?",
  "additional_trades": [
    { "action": "buy|sell", "token": "symbol", "amount_usd": number, "confidence": 0-100, "reasoning": "why" }
  ]
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
- All tracked tokens: ${JSON.stringify(
    (marketData.prices || []).map((t) => ({
      symbol: t.symbol,
      price: t.current_price,
      change_24h: t.price_change_percentage_24h,
      change_1h: t.price_change_percentage_1h_in_currency,
      volume: t.total_volume,
      mktCap: t.market_cap,
    })),
    null,
    2
  )}

${marketData.trending ? `DEXSCREENER TRENDING (hot tokens right now):
${JSON.stringify(marketData.trending, null, 2)}` : ""}

DEFI TVL (top protocols):
${JSON.stringify(marketData.defiTvl || [], null, 2)}

${marketData.derivatives ? `DERIVATIVES DATA (funding rates, open interest, long/short ratios):
${JSON.stringify(marketData.derivatives, null, 2)}` : ""}

${marketData.macro ? `MACRO DATA (BTC dominance, stablecoin flows, market trend):
${JSON.stringify(marketData.macro, null, 2)}` : ""}

${marketData.grokResearch ? `REAL-TIME SOCIAL INTELLIGENCE (from Grok/X):
${JSON.stringify(marketData.grokResearch, null, 2)}` : ""}

Based on ALL data — technicals, derivatives, macro, social intelligence, AND trending tokens — what is your trading decision?

CRITICAL REMINDER: This is PAPER TRADING for data collection. We are NOT risking real money. Holding USDC teaches us NOTHING. Every cycle you say "hold" is a wasted learning opportunity. Even in uncertain markets, take a position — that's how we learn what works. Fear and uncertainty are themselves signals to trade on (contrarian buys in extreme fear often work). If the portfolio is mostly cash, you MUST deploy some of it. Start with BTC as our core position, then diversify into whatever looks most interesting.

DO NOT respond with "hold" unless you have already deployed at least 50% of the portfolio. If we are sitting in cash, BUY SOMETHING.

Respond with JSON only.`;

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
