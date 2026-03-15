// Fetches market data from free APIs every analysis cycle

const TOKENS = [
  // Majors
  "bitcoin", "ethereum", "solana", "chainlink", "uniswap",
  "aave", "render-token", "arbitrum", "optimism", "polygon-ecosystem-token",
  // Base L2 ecosystem
  "aerodrome-finance", "brett", "degen-base", "toshi", "moonwell",
  "virtual-protocol", "morpho", "extra-finance", "coinbase-wrapped-btc",
  // Meme / momentum plays
  "pepe", "bonk", "dogwifcoin", "floki", "shiba-inu",
  // L1/L2 movers
  "sui", "aptos", "celestia", "sei-network", "injective-protocol",
  // DeFi / narrative plays
  "jupiter-exchange-solana", "ondo-finance", "ethena", "pendle", "eigenlayer",
];

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJsonWithRetry(url, name, retries = 2) {
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        lastErr = new Error(`${name} error: ${res.status}`);
        if (res.status === 429 && attempt < retries) {
          await delay(400 * attempt);
          continue;
        }
        break;
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await delay(400 * attempt);
    }
  }
  throw lastErr || new Error(`${name} fetch failed`);
}

async function getCoinGeckoData() {
  const ids = TOKENS.join(",");
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=false&price_change_percentage=1h,24h,7d`;
  return fetchJsonWithRetry(url, "CoinGecko");
}

async function getFearGreedIndex() {
  const data = await fetchJsonWithRetry("https://api.alternative.me/fng/?limit=1", "Fear & Greed");
  return data.data[0]; // { value, value_classification, timestamp }
}

async function getDefiLlamaData() {
  const protocols = await fetchJsonWithRetry("https://api.llama.fi/protocols", "DefiLlama");

  // Get top protocols by TVL
  const top = protocols
    .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
    .slice(0, 10)
    .map((p) => ({
      name: p.name,
      tvl: p.tvl,
      change_1d: p.change_1d,
      chain: p.chain,
    }));

  return top;
}

async function getDexScreenerTrending() {
  const [boosts, baseTop] = await Promise.allSettled([
    fetchJsonWithRetry("https://api.dexscreener.com/token-boosts/latest/v1", "DexScreener boosts"),
    fetchJsonWithRetry("https://api.dexscreener.com/token-boosts/top/v1", "DexScreener top"),
  ]);

  const boostData = boosts.status === "fulfilled" && Array.isArray(boosts.value) ? boosts.value : [];
  const topData = baseTop.status === "fulfilled" && Array.isArray(baseTop.value) ? baseTop.value : [];

  // Merge and tag Base chain tokens
  const all = [...boostData, ...topData];
  const baseTokens = all.filter((t) => t.chainId === "base");
  const otherHot = all.filter((t) => t.chainId !== "base").slice(0, 5);

  return {
    baseTrending: baseTokens.slice(0, 15),
    otherTrending: otherHot,
    all: all.slice(0, 20),
  };
}

async function aggregateMarketData() {
  const results = await Promise.allSettled([
    getCoinGeckoData(),
    getFearGreedIndex(),
    getDefiLlamaData(),
    getDexScreenerTrending(),
  ]);

  const [coingecko, fearGreed, defiLlama, dexScreener] = results.map((r) =>
    r.status === "fulfilled" ? r.value : null
  );

  // Log any failures
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const names = ["CoinGecko", "FearGreed", "DefiLlama", "DexScreener"];
      console.warn(`${names[i]} fetch failed:`, r.reason.message);
    }
  });

  return {
    timestamp: new Date().toISOString(),
    prices: coingecko,
    fearGreed,
    defiTvl: defiLlama,
    trending: dexScreener,
  };
}

module.exports = { aggregateMarketData, TOKENS };
