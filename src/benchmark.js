// Market benchmark tracker — "did the bot beat buy-and-hold?"
// Tracks BTC, ETH, and top-10 basket as benchmarks

const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "..", "data", "benchmark.json");

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  }
  return null;
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// Top-10 crypto basket weights (approximate market cap weighted)
const BASKET_WEIGHTS = {
  btc: 0.45,
  eth: 0.20,
  sol: 0.08,
  bnb: 0.05,
  xrp: 0.05,
  ada: 0.03,
  avax: 0.03,
  link: 0.03,
  dot: 0.03,
  sui: 0.02,
  arb: 0.01,
  op: 0.01,
  uni: 0.01,
};

function initBenchmark(prices) {
  const state = loadState();
  if (state) return state; // Already initialized

  const startPrices = {};
  for (const [token, weight] of Object.entries(BASKET_WEIGHTS)) {
    if (prices[token]) {
      startPrices[token] = prices[token];
    }
  }

  const benchmark = {
    startedAt: new Date().toISOString(),
    startPrices,
    btcStartPrice: prices.btc || 0,
    ethStartPrice: prices.eth || 0,
  };

  saveState(benchmark);
  console.log(`Benchmark initialized — BTC: $${prices.btc}, ETH: $${prices.eth}`);
  return benchmark;
}

function getBenchmarkReturns(currentPrices) {
  const state = loadState();
  if (!state) return null;

  // BTC buy-and-hold return
  const btcReturn = state.btcStartPrice > 0
    ? ((currentPrices.btc - state.btcStartPrice) / state.btcStartPrice) * 100
    : 0;

  // ETH buy-and-hold return
  const ethReturn = state.ethStartPrice > 0
    ? ((currentPrices.eth - state.ethStartPrice) / state.ethStartPrice) * 100
    : 0;

  // Top-10 basket return (weighted average)
  let basketReturn = 0;
  let totalWeight = 0;
  for (const [token, weight] of Object.entries(BASKET_WEIGHTS)) {
    const startPrice = state.startPrices[token];
    const curPrice = currentPrices[token];
    if (startPrice > 0 && curPrice > 0) {
      basketReturn += ((curPrice - startPrice) / startPrice) * 100 * weight;
      totalWeight += weight;
    }
  }
  if (totalWeight > 0) {
    basketReturn = basketReturn / totalWeight * 1; // Normalize if some tokens missing
  }

  return {
    startedAt: state.startedAt,
    btc: {
      startPrice: round(state.btcStartPrice),
      currentPrice: round(currentPrices.btc || 0),
      returnPct: round(btcReturn),
    },
    eth: {
      startPrice: round(state.ethStartPrice),
      currentPrice: round(currentPrices.eth || 0),
      returnPct: round(ethReturn),
    },
    cryptoBasket: {
      description: "Top-10 weighted basket (BTC 45%, ETH 20%, SOL 8%, etc.)",
      returnPct: round(basketReturn),
    },
  };
}

function round(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

module.exports = { initBenchmark, getBenchmarkReturns };
