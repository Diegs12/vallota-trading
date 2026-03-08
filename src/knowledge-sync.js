// Shared knowledge layer — syncs trades & reviews to Supabase
// so future bot instances inherit accumulated lessons.
// All Supabase calls are optional — if not configured, the bot runs normally.

const fs = require("fs");
const path = require("path");

const SYNC_MARKER_FILE = path.join(__dirname, "..", "data", "sync-marker.json");

// ---- Supabase Client (lazy init) ----

let supabase = null;
let supabaseAvailable = false;

function getSupabase() {
  if (supabase !== null) return supabase;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.log("Knowledge sync: SUPABASE_URL / SUPABASE_ANON_KEY not set — skipping sync.");
    supabase = false; // mark as checked but unavailable
    return null;
  }

  try {
    const { createClient } = require("@supabase/supabase-js");
    supabase = createClient(url, key);
    supabaseAvailable = true;
    console.log("Knowledge sync: Supabase client initialized.");
    return supabase;
  } catch (err) {
    console.warn("Knowledge sync: Failed to init Supabase client:", err.message);
    supabase = false;
    return null;
  }
}

function isAvailable() {
  if (supabase === null) getSupabase();
  return supabaseAvailable;
}

// ---- Sync Markers (track what's already been pushed) ----

function readSyncMarker() {
  try {
    if (!fs.existsSync(SYNC_MARKER_FILE)) return { lastTradeId: 0, lastReviewId: 0 };
    return JSON.parse(fs.readFileSync(SYNC_MARKER_FILE, "utf-8"));
  } catch {
    return { lastTradeId: 0, lastReviewId: 0 };
  }
}

function writeSyncMarker(marker) {
  const dir = path.dirname(SYNC_MARKER_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SYNC_MARKER_FILE, JSON.stringify(marker, null, 2));
}

// ---- Sync Trades ----

async function syncTradesToSupabase(botInstanceId) {
  const client = getSupabase();
  if (!client) return;

  try {
    const { getAllTrades } = require("./trade-log");
    const trades = getAllTrades();
    const marker = readSyncMarker();

    // Only push trades with id > lastTradeId
    const newTrades = trades.filter((t) => t.id > marker.lastTradeId);
    if (newTrades.length === 0) return;

    const rows = newTrades.map((t) => ({
      local_id: t.id,
      timestamp: t.timestamp,
      cycle: t.cycle,
      action: t.action,
      token: t.token,
      amount_usd: t.amount_usd,
      confidence: t.confidence,
      reasoning: t.reasoning,
      market_summary: t.market_summary,
      risk_notes: t.risk_notes,
      timeframe_alignment: t.timeframe_alignment || null,
      executed: t.executed,
      failsafe: t.failsafe || false,
      mode: t.mode || "paper",
      logged_at: t.loggedAt,
      bot_instance_id: botInstanceId,
    }));

    const { error } = await client.from("shared_trades").insert(rows);

    if (error) {
      console.warn("Knowledge sync: Failed to push trades:", error.message);
      return;
    }

    // Update marker to highest id we synced
    marker.lastTradeId = newTrades[newTrades.length - 1].id;
    writeSyncMarker(marker);
    console.log(`Knowledge sync: Pushed ${newTrades.length} new trade(s) to Supabase.`);
  } catch (err) {
    console.warn("Knowledge sync: Trade sync error:", err.message);
  }
}

// ---- Sync Reviews ----

async function syncReviewsToSupabase(botInstanceId) {
  const client = getSupabase();
  if (!client) return;

  try {
    const { getReviews } = require("./trade-log");
    const reviews = getReviews();
    const marker = readSyncMarker();

    const newReviews = reviews.filter((r) => r.id > marker.lastReviewId);
    if (newReviews.length === 0) return;

    const rows = newReviews.map((r) => ({
      local_id: r.id,
      trades_reviewed: r.tradesReviewed,
      insights: r.insights,
      market_state_at_review: r.marketStateAtReview || null,
      reviewed_at: r.reviewedAt,
      bot_instance_id: botInstanceId,
    }));

    const { error } = await client.from("shared_reviews").insert(rows);

    if (error) {
      console.warn("Knowledge sync: Failed to push reviews:", error.message);
      return;
    }

    marker.lastReviewId = newReviews[newReviews.length - 1].id;
    writeSyncMarker(marker);
    console.log(`Knowledge sync: Pushed ${newReviews.length} new review(s) to Supabase.`);
  } catch (err) {
    console.warn("Knowledge sync: Review sync error:", err.message);
  }
}

// ---- Fetch Shared Lessons ----

async function getSharedLessons() {
  const client = getSupabase();
  if (!client) return "";

  try {
    // Fetch the most recent reviews from all bot instances (last 20)
    const { data, error } = await client
      .from("shared_reviews")
      .select("insights, bot_instance_id, reviewed_at")
      .order("reviewed_at", { ascending: false })
      .limit(20);

    if (error) {
      console.warn("Knowledge sync: Failed to fetch shared lessons:", error.message);
      return "";
    }

    if (!data || data.length === 0) return "";

    // Aggregate lessons from all reviews
    const allLessons = [];
    const allMistakes = [];
    const allAdjustments = [];

    for (const review of data) {
      const insights = review.insights;
      if (!insights) continue;

      const source = review.bot_instance_id || "unknown";

      if (insights.lessons_learned?.length) {
        insights.lessons_learned.forEach((l) =>
          allLessons.push(`[${source}] ${l}`)
        );
      }
      if (insights.mistakes_to_avoid?.length) {
        insights.mistakes_to_avoid.forEach((m) =>
          allMistakes.push(`[${source}] ${m}`)
        );
      }
      if (insights.strategy_adjustments?.length) {
        insights.strategy_adjustments.forEach((a) =>
          allAdjustments.push(`[${source}] ${a}`)
        );
      }
    }

    // Deduplicate and limit to most recent entries
    const unique = (arr) => [...new Set(arr)].slice(0, 15);
    const parts = [];

    if (allLessons.length > 0) {
      parts.push("SHARED LESSONS (from all bot instances): " + unique(allLessons).join(". "));
    }
    if (allMistakes.length > 0) {
      parts.push("SHARED MISTAKES TO AVOID: " + unique(allMistakes).join(". "));
    }
    if (allAdjustments.length > 0) {
      parts.push("SHARED STRATEGY ADJUSTMENTS: " + unique(allAdjustments).join(". "));
    }

    if (parts.length > 0) {
      console.log(`Knowledge sync: Loaded shared lessons from ${data.length} review(s).`);
    }

    return parts.join("\n");
  } catch (err) {
    console.warn("Knowledge sync: Shared lessons fetch error:", err.message);
    return "";
  }
}

// ---- Convenience: sync everything ----

async function syncAll(botInstanceId) {
  if (!isAvailable()) return;

  await syncTradesToSupabase(botInstanceId);
  await syncReviewsToSupabase(botInstanceId);
}

module.exports = {
  syncTradesToSupabase,
  syncReviewsToSupabase,
  getSharedLessons,
  syncAll,
  isAvailable,
};
