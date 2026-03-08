// Daily/Weekly/Monthly Recap — AI-generated email summarizing strategy + teaching
// Uses Claude to analyze trades and write an educational, conversational recap

const Anthropic = require("@anthropic-ai/sdk").default;
const { Resend } = require("resend");
const { getRecentTrades, getTradeStats, getReviews } = require("./trade-log");

const client = new Anthropic();

const RECAP_INTERVALS = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

let lastRecapTime = {};

function shouldSendRecap(frequency) {
  const now = Date.now();
  const interval = RECAP_INTERVALS[frequency];
  if (!interval) return false;

  const last = lastRecapTime[frequency] || 0;
  if (now - last >= interval) {
    lastRecapTime[frequency] = now;
    return true;
  }
  return false;
}

async function generateRecap(frequency = "daily") {
  const tradeCount = frequency === "daily" ? 50 : frequency === "weekly" ? 200 : 500;
  const trades = getRecentTrades(tradeCount);
  const stats = getTradeStats();
  const reviews = getReviews().slice(-3);

  if (trades.length < 3) {
    return null; // Not enough data for a meaningful recap
  }

  // Filter trades by time window
  const now = Date.now();
  const window = RECAP_INTERVALS[frequency] || RECAP_INTERVALS.daily;
  const windowTrades = trades.filter(
    (t) => now - new Date(t.timestamp).getTime() < window
  );

  if (windowTrades.length < 2) return null;

  const executedTrades = windowTrades.filter((t) => t.executed);
  const holds = windowTrades.filter((t) => !t.executed);
  const buys = executedTrades.filter((t) => t.action === "buy");
  const sells = executedTrades.filter((t) => t.action === "sell");

  const periodLabel =
    frequency === "daily" ? "today" : frequency === "weekly" ? "this week" : "this month";

  const prompt = `You are writing a ${frequency} trading recap email for a user of the Vallota Trading bot.
Your tone should be conversational, educational, and confident — like a smart friend who's really good at trading explaining what happened.

The reader wants to:
1. Understand what trades were made and WHY
2. Learn the strategy behind the decisions
3. Get smarter about crypto trading by reading these recaps
4. Feel confident that the bot is making intelligent decisions

TRADING DATA FOR ${periodLabel.toUpperCase()}:

Total Decisions: ${windowTrades.length}
Executed Trades: ${executedTrades.length} (${buys.length} buys, ${sells.length} sells)
Held/Skipped: ${holds.length}
Average Confidence: ${Math.round(windowTrades.reduce((s, t) => s + (t.confidence || 0), 0) / windowTrades.length)}%

ALL-TIME STATS:
${JSON.stringify(stats, null, 2)}

EXECUTED TRADES:
${JSON.stringify(executedTrades.slice(-10).map(t => ({
  time: t.timestamp,
  action: t.action,
  token: t.token,
  amount: t.amount_usd,
  confidence: t.confidence,
  reasoning: t.reasoning,
  timeframe_alignment: t.timeframe_alignment,
  risk_notes: t.risk_notes,
})), null, 2)}

NOTABLE HOLD DECISIONS (showing restraint is strategy too):
${JSON.stringify(holds.slice(-5).map(t => ({
  time: t.timestamp,
  confidence: t.confidence,
  reasoning: t.reasoning,
})), null, 2)}

${reviews.length > 0 ? `AI SELF-REVIEW INSIGHTS:\n${JSON.stringify(reviews.map(r => r.insights), null, 2)}` : ""}

Write the email in this structure:

1. SUBJECT LINE — catchy, informative (e.g., "Your ${frequency} recap: ETH oversold play + why we held through fear")

2. OPENING — one-liner about how the period went

3. MARKET CONTEXT — what was happening in crypto ${periodLabel}? Reference Fear & Greed, any notable events

4. KEY TRADES — for each executed trade, explain:
   - What we bought/sold and why
   - What indicators drove the decision (teach the reader what RSI, MACD, funding rates mean in plain English)
   - How it turned out

5. SMART HOLDS — explain 1-2 times we chose NOT to trade and why that was the right call
   (Teaching: "Knowing when NOT to trade is just as important as knowing when to trade")

6. STRATEGY LESSON — pick ONE concept from ${periodLabel}'s trades and teach it:
   - Could be: RSI divergence, funding rate signals, multi-timeframe analysis, position sizing, etc.
   - Explain it like the reader has never heard of it before
   - Use the actual trades as examples

7. LOOKING AHEAD — what is the bot watching for next?

8. STATS — quick summary numbers

Format as HTML email with clean, dark-themed styling. Use inline CSS.
Keep it under 800 words. Make it something people actually WANT to read.

Respond with JSON:
{
  "subject": "email subject line",
  "html": "full HTML email body"
}`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error("Recap generation failed:", err.message);
    return null;
  }
}

async function sendRecapEmail(recap, toEmail) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.warn("Recap: No RESEND_API_KEY set — skipping email send");
    console.log("Recap subject:", recap.subject);
    return false;
  }

  const resend = new Resend(resendKey);

  try {
    const { data, error } = await resend.emails.send({
      from: "Vallota Trading <recap@vallotatrading.com>",
      to: [toEmail],
      subject: recap.subject,
      html: recap.html,
    });

    if (error) {
      console.error("Email send error:", error);
      return false;
    }

    console.log(`Recap email sent to ${toEmail} (id: ${data?.id})`);
    return true;
  } catch (err) {
    console.error("Email send failed:", err.message);
    return false;
  }
}

async function checkAndSendRecaps() {
  const email = process.env.RECAP_EMAIL;
  const frequency = process.env.RECAP_FREQUENCY || "daily";

  if (!email) return;

  if (!shouldSendRecap(frequency)) return;

  console.log(`\nGenerating ${frequency} recap for ${email}...`);
  const recap = await generateRecap(frequency);

  if (!recap) {
    console.log("Not enough trade data for recap yet");
    return;
  }

  await sendRecapEmail(recap, email);
}

// Allow manual trigger
async function sendManualRecap(frequency = "daily") {
  const email = process.env.RECAP_EMAIL;
  if (!email) {
    console.log("Set RECAP_EMAIL in .env to send recaps");
    return;
  }

  console.log(`Generating ${frequency} recap...`);
  const recap = await generateRecap(frequency);

  if (!recap) {
    console.log("Not enough trade data for recap");
    return;
  }

  console.log("\nSubject:", recap.subject);
  console.log("\nPreview (first 500 chars):");
  console.log(recap.html.replace(/<[^>]*>/g, "").substring(0, 500));

  const sent = await sendRecapEmail(recap, email);
  if (!sent) {
    console.log("\n(Email not sent — add RESEND_API_KEY to .env to enable)");
  }
}

module.exports = { checkAndSendRecaps, sendManualRecap, generateRecap };
