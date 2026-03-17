// Dashboard API — serves real-time bot data + static frontend
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { getTradeStats, getTradesLast24h, getRecentTrades, getReviews } = require("./trade-log");
const { getPositions } = require("./stop-loss");

const app = express();
const PORT = process.env.PORT || process.env.DASHBOARD_PORT || 3333;
app.disable("x-powered-by");
app.set("trust proxy", parseInt(process.env.TRUST_PROXY_HOPS || "1", 10));

// API secret for authentication — set API_SECRET in .env / Railway
const API_SECRET = process.env.API_SECRET;

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
  ops: null,
  costs: null,
};

function updateLiveState(updates) {
  Object.assign(liveState, updates, { lastUpdated: new Date().toISOString() });
}

// ── Security middleware ──

// Security headers (XSS, clickjacking, MIME sniffing protection)
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// Rate limiting — max 60 requests per minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, try again later" },
});
app.use("/api/", limiter);

// Body size limit (prevent payload DoS)
app.use(express.json({ limit: "10kb" }));

// CORS — allow dashboard on vallotaventures.com and localhost only
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = [
    "http://localhost:3000",
    "https://vallotaventures.com",
    "https://www.vallotaventures.com",
  ];
  if (allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

// Avoid caching API responses that may include account/trading state.
app.use("/api/", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  next();
});

// ── Authentication middleware ──
// All /api/* routes require a valid API key in the X-API-Key header
function requireAuth(req, res, next) {
  if (!API_SECRET) {
    return res.status(503).json({ error: "API not configured" });
  }

  const key = req.headers["x-api-key"];

  if (!key || typeof key !== "string" || key.length !== API_SECRET.length) {
    if (process.env.LOG_AUTH_FAILURES === "true") {
      console.warn(`Auth failure from ${req.ip} — ${req.method} ${req.path}`);
    }
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Timing-safe comparison to prevent timing attacks
  const keyBuf = Buffer.from(key);
  const secretBuf = Buffer.from(API_SECRET);
  if (!crypto.timingSafeEqual(keyBuf, secretBuf)) {
    if (process.env.LOG_AUTH_FAILURES === "true") {
      console.warn(`Auth failure from ${req.ip} — ${req.method} ${req.path}`);
    }
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

// Public health check (no auth needed)
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// Serve static dashboard (the frontend handles auth via stored key)
app.use(express.static(path.join(__dirname, "..", "public")));

// All other API routes require authentication
app.use("/api/", requireAuth);

// API endpoints
app.get("/api/status", (req, res) => {
  res.json({
    status: "running",
    mode: liveState.mode,
    liveTradingEnabled: !!liveState.liveTradingEnabled,
    riskProfile: liveState.riskProfile,
    cycleCount: liveState.cycleCount,
    lastCycle: liveState.lastCycle,
    botStartedAt: liveState.botStartedAt,
    lastUpdated: liveState.lastUpdated,
    errors: liveState.errors || [],
    warnings: liveState.warnings || [],
    failsafeActive: liveState.failsafeActive || false,
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
  const hours = Math.min(Math.max(parseInt(req.query.hours) || 24, 1), 168);
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

app.get("/api/ops", (req, res) => {
  res.json(liveState.ops || {});
});

app.get("/api/costs", (req, res) => {
  res.json(liveState.costs || {});
});

app.get("/api/benchmark", (req, res) => {
  res.json(liveState.benchmark || null);
});

app.get("/api/live-portfolio", (req, res) => {
  res.json(liveState.livePortfolio || null);
});

// Combined scorecard: paper vs live vs market vs costs
app.get("/api/scorecard", (req, res) => {
  const paper = liveState.portfolio || {};
  const live = liveState.livePortfolio || null;
  const bench = liveState.benchmark || {};
  const costs = liveState.costs || {};

  const paperReturnPct = paper.pnlPercent || 0;
  const apiCosts = costs.totals?.api_all_time_usd || 0;
  const paperNetPnl = (paper.pnl || 0) - apiCosts;
  const paperNetReturnPct = paper.startingCapital
    ? (paperNetPnl / paper.startingCapital) * 100
    : 0;

  res.json({
    paper: {
      totalValue: paper.totalValue || 0,
      pnl: paper.pnl || 0,
      returnPct: round(paperReturnPct),
      netPnl: round(paperNetPnl),
      netReturnPct: round(paperNetReturnPct),
    },
    live: live ? {
      totalValue: live.totalValueUsd || 0,
      balances: live.balances || {},
    } : null,
    benchmark: {
      btcReturnPct: bench.btc?.returnPct || 0,
      ethReturnPct: bench.eth?.returnPct || 0,
      basketReturnPct: bench.cryptoBasket?.returnPct || 0,
    },
    costs: {
      totalApiUsd: apiCosts,
      runRateMonthly: costs.totals?.api_run_rate_monthly_usd || 0,
    },
    alpha: {
      vsBtc: round(paperReturnPct - (bench.btc?.returnPct || 0)),
      vsBasket: round(paperReturnPct - (bench.cryptoBasket?.returnPct || 0)),
      netVsBtc: round(paperNetReturnPct - (bench.btc?.returnPct || 0)),
    },
    since: bench.startedAt || null,
  });
});

function round(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Catch-all error handler — never leak stack traces
app.use((err, req, res, next) => {
  console.error("API error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

function startDashboard() {
  app.listen(PORT, () => {
    console.log(`Dashboard running at http://localhost:${PORT}`);
    if (!API_SECRET) {
      console.warn("⚠ WARNING: API_SECRET not set — all API endpoints are LOCKED.");
      console.warn("  Set API_SECRET in .env or Railway to enable the dashboard API.");
    }
  });
}

module.exports = { startDashboard, updateLiveState };
