// File-based trade logging — stores all decisions + outcomes
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const TRADES_FILE = path.join(DATA_DIR, "trades.json");
const REVIEWS_FILE = path.join(DATA_DIR, "reviews.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJson(file) {
  ensureDataDir();
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
}

function writeJson(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ---- Trade Log ----

function logTrade(trade) {
  const trades = readJson(TRADES_FILE);
  trades.push({
    id: trades.length + 1,
    ...trade,
    loggedAt: new Date().toISOString(),
  });
  writeJson(TRADES_FILE, trades);
  return trades.length;
}

function getTradesLast24h() {
  const trades = readJson(TRADES_FILE);
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return trades.filter((t) => new Date(t.timestamp).getTime() > cutoff);
}

function getRecentTrades(count = 50) {
  const trades = readJson(TRADES_FILE);
  return trades.slice(-count);
}

function getAllTrades() {
  return readJson(TRADES_FILE);
}

function getTradeStats() {
  const trades = readJson(TRADES_FILE);
  if (trades.length === 0) return { totalTrades: 0 };

  const executed = trades.filter((t) => t.executed);
  const holds = trades.filter((t) => !t.executed);
  const buys = executed.filter((t) => t.action === "buy");
  const sells = executed.filter((t) => t.action === "sell");

  const last24h = getTradesLast24h();
  const executedLast24h = last24h.filter((t) => t.executed);

  return {
    totalDecisions: trades.length,
    totalExecuted: executed.length,
    totalHolds: holds.length,
    buys: buys.length,
    sells: sells.length,
    last24h: {
      decisions: last24h.length,
      executed: executedLast24h.length,
    },
    avgConfidence:
      trades.length > 0
        ? Math.round(
            trades.reduce((s, t) => s + (t.confidence || 0), 0) / trades.length
          )
        : 0,
    firstTrade: trades[0]?.timestamp || null,
    lastTrade: trades[trades.length - 1]?.timestamp || null,
  };
}

// ---- Review Log ----

function logReview(review) {
  const reviews = readJson(REVIEWS_FILE);
  reviews.push({
    id: reviews.length + 1,
    ...review,
    reviewedAt: new Date().toISOString(),
  });
  writeJson(REVIEWS_FILE, reviews);
}

function getReviews() {
  return readJson(REVIEWS_FILE);
}

function getLatestReview() {
  const reviews = readJson(REVIEWS_FILE);
  return reviews.length > 0 ? reviews[reviews.length - 1] : null;
}

module.exports = {
  logTrade,
  getTradesLast24h,
  getRecentTrades,
  getAllTrades,
  getTradeStats,
  logReview,
  getReviews,
  getLatestReview,
};
