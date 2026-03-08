// Dashboard API — serves real-time bot data + static frontend
const express = require("express");
const path = require("path");
const { getTradeStats, getTradesLast24h, getRecentTrades, getReviews } = require("./trade-log");
const { getPositions } = require("./stop-loss");

const app = express();
const PORT = process.env.PORT || process.env.DASHBOARD_PORT || 3333;

// Shared state — set by bot.js each cycle
let liveState = {
  lastCycle: null,
  cycleCount: 0,
  marketData: null,
  technicals: null,
  timeframeSummary: null,
  portfolio: null,
  lastDecision: null,
  mode: "paper",
  riskProfile: "moderate",
  botStartedAt: new Date().toISOString(),
};

function updateLiveState(updates) {
  Object.assign(liveState, updates, { lastUpdated: new Date().toISOString() });
}

// Serve static dashboard
app.use(express.static(path.join(__dirname, "..", "public")));

// API endpoints
app.get("/api/status", (req, res) => {
  res.json({
    status: "running",
    mode: liveState.mode,
    riskProfile: liveState.riskProfile,
    cycleCount: liveState.cycleCount,
    lastCycle: liveState.lastCycle,
    botStartedAt: liveState.botStartedAt,
    lastUpdated: liveState.lastUpdated,
  });
});

app.get("/api/portfolio", (req, res) => {
  res.json(liveState.portfolio || { balances: {}, totalValue: 0 });
});

app.get("/api/market", (req, res) => {
  const md = liveState.marketData || {};
  res.json({
    fearGreed: md.fearGreed || null,
    prices: (md.prices || []).slice(0, 20).map((t) => ({
      symbol: t.symbol,
      price: t.current_price,
      change24h: t.price_change_percentage_24h,
      volume: t.total_volume,
      marketCap: t.market_cap,
    })),
    timestamp: md.timestamp,
  });
});

app.get("/api/indicators", (req, res) => {
  res.json({
    technicals: liveState.technicals || {},
    timeframeSummary: liveState.timeframeSummary || {},
  });
});

app.get("/api/trades", (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const trades = hours === 24 ? getTradesLast24h() : getRecentTrades(100);
  res.json(trades);
});

app.get("/api/stats", (req, res) => {
  res.json(getTradeStats());
});

app.get("/api/positions", (req, res) => {
  res.json(getPositions());
});

app.get("/api/decision", (req, res) => {
  res.json(liveState.lastDecision || { action: "waiting", reasoning: "Bot starting up..." });
});

app.get("/api/reviews", (req, res) => {
  res.json(getReviews().slice(-5));
});

app.get("/api/research", (req, res) => {
  const md = liveState.marketData || {};
  res.json(md.grokResearch || null);
});

function startDashboard() {
  app.listen(PORT, () => {
    console.log(`Dashboard running at http://localhost:${PORT}`);
  });
}

module.exports = { startDashboard, updateLiveState };
