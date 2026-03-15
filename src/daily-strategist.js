// Daily Strategist — Opus-level deep analysis once per day
// Reviews all trades, market patterns, and sets strategic direction for Haiku

const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk").default;
const { Resend } = require("resend");
const { getTradesLast24h, getTradeStats } = require("./trade-log");
const { getLatestReview } = require("./trade-log");

const client = new Anthropic();
const OPUS_MODEL = process.env.STRATEGIST_MODEL || "claude-opus-4-20250514";
const COST_OPUS_STRATEGY_USD = parseFloat(process.env.COST_OPUS_STRATEGY_USD || "0.60");

const DATA_DIR = path.join(__dirname, "..", "data");
const STRATEGY_FILE = path.join(DATA_DIR, "daily-strategy.json");

let lastStrategyDate = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getUtcDate() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function shouldRunStrategy() {
  const today = getUtcDate();
  if (lastStrategyDate === today) return false;

  // Also check file in case bot restarted
  const existing = loadStrategy();
  if (existing?.date === today) {
    lastStrategyDate = today;
    return false;
  }

  return true;
}

function loadStrategy() {
  ensureDir();
  if (!fs.existsSync(STRATEGY_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(STRATEGY_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function saveStrategy(strategy) {
  ensureDir();
  fs.writeFileSync(STRATEGY_FILE, JSON.stringify(strategy, null, 2));
}

function getStrategyForPrompt() {
  const strategy = loadStrategy();
  if (!strategy?.analysis) return "";

  const a = strategy.analysis;
  const parts = [];

  parts.push(`DAILY STRATEGY (set by Opus at ${strategy.generatedAt}):`);

  if (a.market_regime) {
    parts.push(`MARKET REGIME: ${a.market_regime}`);
  }
  if (a.directional_bias) {
    parts.push(`DIRECTIONAL BIAS: ${a.directional_bias}`);
  }
  if (a.token_gameplan?.length) {
    parts.push("TOKEN GAMEPLAN:");
    for (const tp of a.token_gameplan) {
      parts.push(`  ${tp}`);
    }
  }
  if (a.key_levels?.length) {
    parts.push("KEY LEVELS TO WATCH:");
    for (const kl of a.key_levels) {
      parts.push(`  ${kl}`);
    }
  }
  if (a.strategy_rules?.length) {
    parts.push("STRATEGY RULES FOR TODAY:");
    for (const sr of a.strategy_rules) {
      parts.push(`  ${sr}`);
    }
  }
  if (a.mistakes_from_yesterday?.length) {
    parts.push("MISTAKES TO CORRECT:");
    for (const m of a.mistakes_from_yesterday) {
      parts.push(`  ${m}`);
    }
  }
  if (a.opportunities?.length) {
    parts.push("OPPORTUNITIES TO LOOK FOR:");
    for (const o of a.opportunities) {
      parts.push(`  ${o}`);
    }
  }

  return parts.join("\n");
}

async function runDailyStrategy(marketData) {
  const today = getUtcDate();
  console.log(`\n${"*".repeat(60)}`);
  console.log(`  DAILY OPUS STRATEGIST — ${today}`);
  console.log(`${"*".repeat(60)}`);

  const trades24h = getTradesLast24h();
  const stats = getTradeStats();
  const lastReview = getLatestReview();

  // Separate executed trades from holds for analysis
  const executedTrades = trades24h.filter((t) => t.executed);
  const holdDecisions = trades24h.filter((t) => !t.executed);

  // Build price history summary
  const pricesSummary = (marketData.prices || []).slice(0, 10).map((t) => ({
    symbol: t.symbol,
    price: t.current_price,
    change_24h_pct: t.price_change_percentage_24h,
    volume_24h: t.total_volume,
  }));

  const prompt = `You are the Chief Strategist for the Vallota Trading Bot. You run ONCE per day using Claude Opus to do a deep, thorough analysis that guides the faster Haiku model's real-time trading decisions.

TODAY'S DATE: ${today}

YOUR MISSION: Analyze everything that happened, identify what's working and what's not, spot patterns in the market, and produce a clear strategic game plan for the next 24 hours.

=== TRADING PERFORMANCE (last 24h) ===
Total decisions: ${trades24h.length}
Executed trades: ${executedTrades.length}
Hold decisions: ${holdDecisions.length}

Overall stats:
${JSON.stringify(stats, null, 2)}

Executed trades detail:
${JSON.stringify(executedTrades, null, 2)}

Sample of hold decisions (last 20):
${JSON.stringify(holdDecisions.slice(-20), null, 2)}

=== LAST SELF-REVIEW ===
${lastReview ? JSON.stringify(lastReview.insights, null, 2) : "No review yet"}

=== CURRENT MARKET STATE ===
Prices: ${JSON.stringify(pricesSummary, null, 2)}

Fear & Greed: ${marketData.fearGreed?.value || "N/A"} (${marketData.fearGreed?.value_classification || "N/A"})

Technical summary: ${JSON.stringify(marketData.timeframeSummary || {}, null, 2)}

${marketData.derivatives ? `Derivatives: ${JSON.stringify(marketData.derivatives, null, 2)}` : ""}

${marketData.macro ? `Macro: ${JSON.stringify(marketData.macro, null, 2)}` : ""}

${marketData.grokResearch ? `Social intelligence: ${JSON.stringify(marketData.grokResearch, null, 2)}` : ""}

=== YOUR TASK ===
Do a deep analysis and produce a strategic game plan. Think like a hedge fund strategist:

1. What market regime are we in? (trending, ranging, volatile, quiet)
2. What worked and what didn't in our trades?
3. Are we trading enough? Are we missing opportunities?
4. What are the key price levels to watch for each token?
5. What's the directional bias for each tradable token?
6. What specific setups should the real-time trader look for?
7. What mistakes did we make that we should correct?

Be specific and actionable. The Haiku trader will receive your output as instructions.

Respond with JSON:
{
  "market_regime": "one of: strong_uptrend, uptrend, ranging, downtrend, strong_downtrend, volatile_chop",
  "directional_bias": "overall market lean and why (1-2 sentences)",
  "confidence_in_regime": 0-100,
  "token_gameplan": [
    "ETH: specific strategy for this token",
    "AERO: specific strategy",
    ...
  ],
  "key_levels": [
    "ETH support ~$1920, resistance ~$1960 — buy near support, sell near resistance",
    ...
  ],
  "strategy_rules": [
    "specific rule for today's trading, e.g. 'take profits at 1.5% gains, don't hold for more'",
    ...
  ],
  "position_sizing_guidance": "how big should positions be given current conditions",
  "mistakes_from_yesterday": [
    "specific mistake and how to fix it"
  ],
  "opportunities": [
    "specific opportunity to look for today"
  ],
  "performance_grade": "A/B/C/D/F — how well did we trade?",
  "data_quality_assessment": "are we generating enough trades for learning? what should change?"
}`;

  try {
    const response = await client.messages.create({
      model: OPUS_MODEL,
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("Opus strategist did not return valid JSON");
      return null;
    }

    const analysis = JSON.parse(jsonMatch[0]);

    const strategyDoc = {
      date: today,
      generatedAt: new Date().toISOString(),
      model: OPUS_MODEL,
      analysis,
      tradesAnalyzed: trades24h.length,
      executedTradesAnalyzed: executedTrades.length,
    };

    saveStrategy(strategyDoc);
    lastStrategyDate = today;

    // Email the strategy memo
    await emailStrategy(analysis, today);

    console.log("\n--- OPUS STRATEGY ---");
    console.log(`Regime: ${analysis.market_regime}`);
    console.log(`Bias: ${analysis.directional_bias}`);
    console.log(`Grade: ${analysis.performance_grade}`);
    console.log(`Data quality: ${analysis.data_quality_assessment}`);
    if (analysis.token_gameplan?.length) {
      console.log("Game plan:");
      analysis.token_gameplan.forEach((tp) => console.log(`  ${tp}`));
    }
    if (analysis.strategy_rules?.length) {
      console.log("Rules:");
      analysis.strategy_rules.forEach((r) => console.log(`  ${r}`));
    }
    console.log("---------------------\n");

    return { analysis, costUsd: COST_OPUS_STRATEGY_USD };
  } catch (err) {
    console.error("Opus strategist failed:", err.message);
    return null;
  }
}

async function emailStrategy(analysis, date) {
  const resendKey = process.env.RESEND_API_KEY;
  const email = process.env.RECAP_EMAIL;
  if (!resendKey || !email) return;

  const resend = new Resend(resendKey);

  const tokenPlans = (analysis.token_gameplan || [])
    .map((tp) => `<li style="margin-bottom:8px;color:#1e293b;">${tp}</li>`)
    .join("");
  const rules = (analysis.strategy_rules || [])
    .map((r) => `<li style="margin-bottom:8px;color:#1e293b;">${r}</li>`)
    .join("");
  const levels = (analysis.key_levels || [])
    .map((l) => `<li style="margin-bottom:8px;color:#1e293b;">${l}</li>`)
    .join("");
  const opportunities = (analysis.opportunities || [])
    .map((o) => `<li style="margin-bottom:8px;color:#1e293b;">${o}</li>`)
    .join("");
  const mistakes = (analysis.mistakes_from_yesterday || [])
    .map((m) => `<li style="margin-bottom:8px;color:#ef4444;">${m}</li>`)
    .join("");

  const gradeColor =
    analysis.performance_grade?.startsWith("A") ? "#10b981" :
    analysis.performance_grade?.startsWith("B") ? "#0ea5e9" :
    analysis.performance_grade?.startsWith("C") ? "#f59e0b" : "#ef4444";

  const html = `
<div style="max-width:600px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;background:#ffffff;border-top:4px solid #0ea5e9;">
  <div style="padding:32px 24px;">
    <h1 style="font-size:22px;color:#0f172a;margin:0 0 4px;">Daily Strategy Memo</h1>
    <p style="color:#64748b;font-size:14px;margin:0 0 24px;">${date} | Opus Deep Analysis</p>

    <div style="display:flex;gap:12px;margin-bottom:24px;">
      <div style="flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:12px;color:#64748b;text-transform:uppercase;">Regime</div>
        <div style="font-size:18px;font-weight:700;color:#0f172a;margin-top:4px;">${analysis.market_regime || "N/A"}</div>
      </div>
      <div style="flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:12px;color:#64748b;text-transform:uppercase;">Grade</div>
        <div style="font-size:18px;font-weight:700;color:${gradeColor};margin-top:4px;">${analysis.performance_grade || "N/A"}</div>
      </div>
      <div style="flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:12px;color:#64748b;text-transform:uppercase;">Confidence</div>
        <div style="font-size:18px;font-weight:700;color:#0ea5e9;margin-top:4px;">${analysis.confidence_in_regime || "?"}%</div>
      </div>
    </div>

    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:20px;">
      <h3 style="font-size:14px;color:#0f172a;margin:0 0 8px;">Directional Bias</h3>
      <p style="color:#1e293b;margin:0;font-size:14px;">${analysis.directional_bias || "N/A"}</p>
    </div>

    ${tokenPlans ? `
    <h3 style="font-size:14px;color:#0f172a;margin:0 0 8px;">Token Game Plan</h3>
    <ul style="padding-left:20px;margin:0 0 20px;">${tokenPlans}</ul>` : ""}

    ${levels ? `
    <h3 style="font-size:14px;color:#0f172a;margin:0 0 8px;">Key Levels</h3>
    <ul style="padding-left:20px;margin:0 0 20px;">${levels}</ul>` : ""}

    ${rules ? `
    <h3 style="font-size:14px;color:#0f172a;margin:0 0 8px;">Strategy Rules</h3>
    <ul style="padding-left:20px;margin:0 0 20px;">${rules}</ul>` : ""}

    ${opportunities ? `
    <h3 style="font-size:14px;color:#0f172a;margin:0 0 8px;">Opportunities</h3>
    <ul style="padding-left:20px;margin:0 0 20px;">${opportunities}</ul>` : ""}

    ${mistakes ? `
    <h3 style="font-size:14px;color:#0f172a;margin:0 0 8px;">Mistakes to Correct</h3>
    <ul style="padding-left:20px;margin:0 0 20px;">${mistakes}</ul>` : ""}

    ${analysis.position_sizing_guidance ? `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin-bottom:20px;">
      <h3 style="font-size:14px;color:#0f172a;margin:0 0 8px;">Position Sizing</h3>
      <p style="color:#1e293b;margin:0;font-size:14px;">${analysis.position_sizing_guidance}</p>
    </div>` : ""}

    ${analysis.data_quality_assessment ? `
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin-bottom:20px;">
      <h3 style="font-size:14px;color:#0f172a;margin:0 0 8px;">Data Quality</h3>
      <p style="color:#1e293b;margin:0;font-size:14px;">${analysis.data_quality_assessment}</p>
    </div>` : ""}

    <p style="color:#94a3b8;font-size:12px;text-align:center;margin:24px 0 0;border-top:1px solid #e2e8f0;padding-top:16px;">
      Vallota Trading Bot | Opus Strategist | ${date}
    </p>
  </div>
</div>`;

  try {
    await resend.emails.send({
      from: "Vallota Trading <onboarding@resend.dev>",
      to: [email],
      subject: `Strategy Memo: ${analysis.market_regime || "Analysis"} | ${date}`,
      html,
    });
    console.log(`Strategy memo emailed to ${email}`);
  } catch (err) {
    console.warn("Strategy email failed:", err.message);
  }
}

module.exports = { shouldRunStrategy, runDailyStrategy, getStrategyForPrompt };
