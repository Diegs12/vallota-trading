// Self-review loop — Claude reviews its own past decisions
// Looks at what it predicted vs what actually happened
// Generates lessons that feed into future decision-making

const Anthropic = require("@anthropic-ai/sdk").default;
const { getRecentTrades, logReview, getLatestReview } = require("./trade-log");

const client = new Anthropic();

const REVIEW_INTERVAL_CYCLES = 30; // Review every 30 cycles (~1 hour at 2min intervals)

let cyclesSinceReview = 0;

function shouldReview() {
  cyclesSinceReview++;
  if (cyclesSinceReview >= REVIEW_INTERVAL_CYCLES) {
    cyclesSinceReview = 0;
    return true;
  }
  return false;
}

async function reviewPastTrades(currentMarketData) {
  const trades = getRecentTrades(30);
  if (trades.length < 5) {
    console.log("Self-review: Not enough trades yet (need at least 5)");
    return null;
  }

  const previousReview = getLatestReview();

  const prompt = `You are reviewing your own past trading decisions as the Vallota Trading Bot.

YOUR RECENT TRADES (last ${trades.length} decisions):
${JSON.stringify(trades, null, 2)}

${previousReview ? `YOUR PREVIOUS SELF-REVIEW:\n${JSON.stringify(previousReview.insights, null, 2)}` : "This is your first self-review."}

CURRENT MARKET STATE:
${JSON.stringify(currentMarketData, null, 2)}

Analyze your past decisions honestly. For each trade:
- Was the reasoning sound at the time?
- Did the market move as expected afterward?
- Were there signals you missed?
- Were there trades where you were too aggressive or too conservative?

Respond with JSON:
{
  "overall_assessment": "brief summary of your performance",
  "win_rate_estimate": "your estimated % of good decisions",
  "patterns_identified": [
    "pattern 1 you notice in your decisions",
    "pattern 2"
  ],
  "mistakes_to_avoid": [
    "specific mistake to stop making"
  ],
  "lessons_learned": [
    "actionable lesson for future trades"
  ],
  "strategy_adjustments": [
    "specific change to make going forward"
  ],
  "confidence_calibration": "are you overconfident, underconfident, or well-calibrated?"
}`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("Self-review: Claude did not return valid JSON");
      return null;
    }

    const insights = JSON.parse(jsonMatch[0]);

    // Log the review
    logReview({
      tradesReviewed: trades.length,
      insights,
      marketStateAtReview: {
        fearGreed: currentMarketData.fearGreed,
        timestamp: currentMarketData.timestamp,
      },
    });

    console.log("\n--- SELF-REVIEW COMPLETE ---");
    console.log("Assessment:", insights.overall_assessment);
    console.log("Lessons:", insights.lessons_learned?.join("; "));
    console.log("Adjustments:", insights.strategy_adjustments?.join("; "));
    console.log("----------------------------\n");

    return insights;
  } catch (err) {
    console.warn("Self-review failed:", err.message);
    return null;
  }
}

function getLatestLessons() {
  const review = getLatestReview();
  if (!review) return "";

  const insights = review.insights;
  const parts = [];

  if (insights.lessons_learned?.length) {
    parts.push("LESSONS FROM PAST TRADES: " + insights.lessons_learned.join(". "));
  }
  if (insights.mistakes_to_avoid?.length) {
    parts.push("MISTAKES TO AVOID: " + insights.mistakes_to_avoid.join(". "));
  }
  if (insights.strategy_adjustments?.length) {
    parts.push("STRATEGY ADJUSTMENTS: " + insights.strategy_adjustments.join(". "));
  }
  if (insights.confidence_calibration) {
    parts.push("CONFIDENCE NOTE: " + insights.confidence_calibration);
  }

  return parts.join("\n");
}

module.exports = { shouldReview, reviewPastTrades, getLatestLessons };
