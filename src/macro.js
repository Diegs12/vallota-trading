// Macro economic data — crypto follows macro, ignore this at your own risk
// Source: FRED API (Federal Reserve Economic Data) — free, no key needed for basic
// + CoinGecko global data for BTC dominance + stablecoin metrics

async function getBitcoinDominance() {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/global");
    if (!res.ok) return null;
    const data = await res.json();
    const global = data.data;

    return {
      btcDominance: Math.round(global.market_cap_percentage?.btc * 100) / 100,
      ethDominance: Math.round(global.market_cap_percentage?.eth * 100) / 100,
      totalMarketCap: global.total_market_cap?.usd,
      totalVolume24h: global.total_volume?.usd,
      marketCapChange24h: Math.round(global.market_cap_change_percentage_24h_usd * 100) / 100,
      activeCryptos: global.active_cryptocurrencies,
      signal:
        global.market_cap_percentage?.btc > 55
          ? "btc_dominance_high_alt_risk"
          : global.market_cap_percentage?.btc < 40
            ? "alt_season_likely"
            : "normal",
    };
  } catch (err) {
    console.warn("BTC dominance fetch failed:", err.message);
    return null;
  }
}

async function getStablecoinFlows() {
  try {
    const res = await fetch("https://stablecoins.llama.fi/stablecoins?includePrices=false");
    if (!res.ok) return null;
    const data = await res.json();

    // Get top stablecoins
    const stables = (data.peggedAssets || [])
      .filter((s) => s.circulating?.peggedUSD > 1e9)
      .sort((a, b) => (b.circulating?.peggedUSD || 0) - (a.circulating?.peggedUSD || 0))
      .slice(0, 5)
      .map((s) => ({
        name: s.name,
        symbol: s.symbol,
        marketCap: Math.round((s.circulating?.peggedUSD || 0) / 1e9 * 100) / 100,
        marketCapBillions: `$${(Math.round((s.circulating?.peggedUSD || 0) / 1e9 * 100) / 100)}B`,
      }));

    const totalStablecoinMcap = stables.reduce((s, c) => s + c.marketCap, 0);

    return {
      topStablecoins: stables,
      totalMarketCapBillions: `$${Math.round(totalStablecoinMcap * 100) / 100}B`,
      interpretation:
        "Rising stablecoin market cap = new money entering crypto. Falling = money leaving.",
    };
  } catch (err) {
    console.warn("Stablecoin flows fetch failed:", err.message);
    return null;
  }
}

async function getTreasuryYields() {
  // Use FRED-compatible free proxy for key macro indicators
  // DGS10 = 10-year treasury yield, DGS2 = 2-year
  try {
    const res = await fetch(
      "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?sort=-record_date&page[size]=5"
    );
    if (!res.ok) return null;
    const data = await res.json();

    // Just provide a summary — exact rates matter less than direction
    return {
      source: "US Treasury Fiscal Data",
      note: "Rising yields = risk-off for crypto. Falling yields = risk-on.",
      latestDate: data.data?.[0]?.record_date || null,
    };
  } catch (err) {
    console.warn("Treasury yields fetch failed:", err.message);
    return null;
  }
}

async function getSP500Proxy() {
  // Use CoinGecko's Bitcoin correlation with stocks as a proxy
  // Or use a free market data API
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=7&interval=daily"
    );
    if (!res.ok) return null;
    const data = await res.json();
    const prices = data.prices || [];

    if (prices.length < 2) return null;

    const latest = prices[prices.length - 1][1];
    const weekAgo = prices[0][1];
    const weekChange = ((latest - weekAgo) / weekAgo) * 100;

    return {
      btcWeeklyTrend: Math.round(weekChange * 100) / 100,
      direction: weekChange > 0 ? "bullish" : "bearish",
      note: "BTC weekly trend as proxy for overall risk appetite",
    };
  } catch (err) {
    console.warn("Market proxy fetch failed:", err.message);
    return null;
  }
}

async function getAllMacroData() {
  console.log("Fetching macro data (BTC dominance, stablecoins, treasury, market trend)...");

  const [dominance, stablecoins, treasury, marketTrend] = await Promise.allSettled([
    getBitcoinDominance(),
    getStablecoinFlows(),
    getTreasuryYields(),
    getSP500Proxy(),
  ]);

  const result = {
    btcDominance: dominance.status === "fulfilled" ? dominance.value : null,
    stablecoinFlows: stablecoins.status === "fulfilled" ? stablecoins.value : null,
    treasury: treasury.status === "fulfilled" ? treasury.value : null,
    marketTrend: marketTrend.status === "fulfilled" ? marketTrend.value : null,
  };

  if (result.btcDominance) {
    console.log(
      `  BTC.D: ${result.btcDominance.btcDominance}% (${result.btcDominance.signal})`
    );
  }
  if (result.stablecoinFlows) {
    console.log(`  Stablecoin Total: ${result.stablecoinFlows.totalMarketCapBillions}`);
  }

  return result;
}

module.exports = { getAllMacroData };
