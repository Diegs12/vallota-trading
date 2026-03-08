// Fetches market data from free APIs every analysis cycle

const TOKENS = [
  "bitcoin", "ethereum", "solana", "chainlink", "uniswap",
  "aave", "render-token", "arbitrum", "optimism", "polygon-ecosystem-token",
  "pepe", "bonk", "sui", "aptos", "celestia",
  "jupiter-exchange-solana", "ondo-finance", "ethena",
];

async function getCoinGeckoData() {
  const ids = TOKENS.join(",");
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=false&price_change_percentage=1h,24h,7d`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
  return res.json();
}

async function getFearGreedIndex() {
  const res = await fetch("https://api.alternative.me/fng/?limit=1");
  if (!res.ok) throw new Error(`Fear & Greed error: ${res.status}`);
  const data = await res.json();
  return data.data[0]; // { value, value_classification, timestamp }
}

async function getDefiLlamaData() {
  const res = await fetch("https://api.llama.fi/protocols");
  if (!res.ok) throw new Error(`DefiLlama error: ${res.status}`);
  const protocols = await res.json();

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
  const res = await fetch("https://api.dexscreener.com/token-boosts/latest/v1");
  if (!res.ok) throw new Error(`DexScreener error: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data.slice(0, 10) : [];
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
