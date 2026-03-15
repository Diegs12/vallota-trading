// Fetches historical candle data from CryptoCompare (free, no API key, works in US)
// Provides multi-timeframe analysis: 5m (via minute), 1h, 4h, 1d

const BASE_URL = "https://min-api.cryptocompare.com/data/v2";
const CACHE_TTL_MS = parseInt(process.env.HISTORICAL_CACHE_TTL_MS || "900000", 10); // 15m
const candleCache = new Map();

// Core tokens we compute full TA for
const CORE_TOKENS = ["BTC", "ETH", "SOL"];

const TIMEFRAMES = {
  "5m": { endpoint: "histominute", limit: 100, aggregate: 5 }, // 100 x 5min = ~8 hours
  "1h": { endpoint: "histohour", limit: 100, aggregate: 1 },   // 100 hours = ~4 days
  "4h": { endpoint: "histohour", limit: 100, aggregate: 4 },   // 100 x 4h = ~16 days
  "1d": { endpoint: "histoday", limit: 60, aggregate: 1 },     // 60 days = ~2 months
};

async function fetchCandles(symbol, endpoint, limit, aggregate) {
  const cacheKey = `${symbol}:${endpoint}:${limit}:${aggregate}`;
  const cached = candleCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const url = `${BASE_URL}/${endpoint}?fsym=${symbol}&tsym=USD&limit=${limit}&aggregate=${aggregate}`;
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        lastErr = new Error(`CryptoCompare status ${res.status}`);
        if (res.status === 429 && attempt < 2) {
          await delay(600 * attempt);
          continue;
        }
        break;
      }

      const json = await res.json();
      if (json.Response === "Error") {
        lastErr = new Error(json.Message || "Unknown CryptoCompare error");
        if ((json.Message || "").toLowerCase().includes("rate limit") && attempt < 2) {
          await delay(600 * attempt);
          continue;
        }
        break;
      }

      const raw = json.Data?.Data;
      if (!raw || !Array.isArray(raw)) {
        lastErr = new Error("Malformed candle response");
        break;
      }

      const parsed = raw.map((k) => ({
        time: k.time * 1000,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
        volume: k.volumefrom,
      }));

      candleCache.set(cacheKey, { fetchedAt: Date.now(), data: parsed });
      return parsed;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await delay(600 * attempt);
    }
  }

  if (cached?.data) {
    console.warn(
      `CryptoCompare unavailable for ${symbol} ${endpoint}; using cached candles (${Math.round(
        (Date.now() - cached.fetchedAt) / 1000
      )}s old)`
    );
    return cached.data;
  }

  console.warn(`CryptoCompare fetch failed for ${symbol} ${endpoint}: ${lastErr?.message || "unknown"}`);
  return null;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function getMultiTimeframeData(symbol) {
  const results = {};
  const entries = Object.entries(TIMEFRAMES);

  // Sequential with small delay to avoid rate limits
  for (const [tf, config] of entries) {
    const candles = await fetchCandles(
      symbol,
      config.endpoint,
      config.limit,
      config.aggregate
    );
    if (candles && candles.length > 0) {
      results[tf] = {
        candles: candles.length,
        closes: candles.map((c) => c.close),
        volumes: candles.map((c) => c.volume),
        latest: candles[candles.length - 1],
        highOfPeriod: Math.max(...candles.map((c) => c.high)),
        lowOfPeriod: Math.min(...candles.map((c) => c.low)),
        avgVolume:
          candles.reduce((s, c) => s + c.volume, 0) / candles.length,
      };
    }
    await delay(300); // 300ms between requests to stay under rate limit
  }

  return results;
}

async function getAllCoreTokenData() {
  const data = {};

  // Sequential per token to respect rate limits (12 total calls, ~4s total)
  for (const token of CORE_TOKENS) {
    try {
      data[token.toLowerCase()] = await getMultiTimeframeData(token);
    } catch (err) {
      console.warn(`Failed to get historical data for ${token}:`, err.message);
    }
  }

  return data;
}

module.exports = {
  fetchCandles,
  getMultiTimeframeData,
  getAllCoreTokenData,
  CORE_TOKENS,
  TIMEFRAMES,
};
