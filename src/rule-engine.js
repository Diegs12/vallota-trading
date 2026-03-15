// Rule-based trading engine -- runs on cycles where Claude is skipped
// Applies calibrated thresholds from research to generate trades at zero API cost
// These are simple, backtested rules that don't need LLM reasoning

function evaluateRules({ timeframeSummary, marketData, balances, currentPrices, portfolioUsd }) {
  const trades = [];
  const usdc = balances.usdc || 0;
  const fearGreed = parseInt(marketData?.fearGreed?.value || "50", 10);
  const maxTradeUsd = Math.min(portfolioUsd * 0.08, usdc); // 8% max per rule-based trade

  if (maxTradeUsd < 5) return trades; // not enough to trade

  for (const [token, tfs] of Object.entries(timeframeSummary || {})) {
    const t = token.toLowerCase();
    if (t === "usdc" || t === "usd") continue;

    const h1 = tfs["1h"] || {};
    const h4 = tfs["4h"] || {};
    const d1 = tfs["1d"] || {};

    const rsi1h = h1.rsi;
    const rsi4h = h4.rsi;
    const rsi1d = d1.rsi;
    const macd1h = h1.macdTrend;
    const macd4h = h4.macdTrend;
    const bb1h = h1.bbSignal;
    const trend1d = d1.trend;

    const holding = balances[t] || 0;
    const holdingUsd = holding * (currentPrices[t] || 0);

    // === BUY RULES ===

    // Rule 1: BB lower band touch + daily trend not bearish (backtested: ~50% CAGR, 34% time in market)
    if (bb1h === "oversold" && trend1d !== "bearish" && usdc > 10) {
      trades.push({
        action: "buy",
        token: t,
        amount_usd: Math.min(maxTradeUsd * 0.5, 40),
        confidence: 55,
        reasoning: `RULE: BB oversold on 1h + daily trend ${trend1d}. Research: BB lower fade = ~50% CAGR backtested.`,
        rule: "bb_lower_fade",
      });
    }

    // Rule 2: RSI momentum crossover (RSI > 60 on 1h + MACD bullish + daily trend bullish)
    if (rsi1h > 60 && rsi1h < 75 && macd1h === "bullish" && trend1d === "bullish" && usdc > 10) {
      trades.push({
        action: "buy",
        token: t,
        amount_usd: Math.min(maxTradeUsd * 0.4, 35),
        confidence: 58,
        reasoning: `RULE: RSI(1h)=${rsi1h} momentum crossover + MACD bullish + daily trend bullish. Research: RSI momentum > RSI mean-reversion for BTC.`,
        rule: "rsi_momentum_buy",
      });
    }

    // Rule 3: Extreme fear contrarian buy (F&G < 20 + RSI < 40 on 4h)
    if (fearGreed < 20 && rsi4h && rsi4h < 40 && usdc > 10) {
      trades.push({
        action: "buy",
        token: t,
        amount_usd: Math.min(maxTradeUsd * 0.3, 30),
        confidence: 60,
        reasoning: `RULE: Extreme fear (${fearGreed}) + RSI(4h)=${rsi4h} oversold. Research: F&G<20 = 72% win rate, +11.8% avg 30d return.`,
        rule: "extreme_fear_buy",
      });
    }

    // Rule 4: Multi-timeframe alignment buy (all timeframes bullish)
    if (macd1h === "bullish" && macd4h === "bullish" && trend1d === "bullish" && rsi1d && rsi1d > 50 && rsi1d < 70 && usdc > 10) {
      trades.push({
        action: "buy",
        token: t,
        amount_usd: Math.min(maxTradeUsd * 0.5, 45),
        confidence: 65,
        reasoning: `RULE: Full alignment -- MACD bullish on 1h+4h, daily trend bullish, RSI(1d)=${rsi1d} in momentum zone. High conviction.`,
        rule: "full_alignment_buy",
      });
    }

    // === SELL RULES (only if holding) ===
    if (holdingUsd < 5) continue;

    // Rule 5: RSI overbought on 1h + MACD turning bearish
    if (rsi1h > 75 && (macd1h === "bearish" || bb1h === "overbought")) {
      trades.push({
        action: "sell",
        token: t,
        amount_usd: Math.round(holdingUsd * 0.5 * 100) / 100,
        confidence: 58,
        reasoning: `RULE: RSI(1h)=${rsi1h} overbought + ${macd1h === "bearish" ? "MACD bearish" : "BB overbought"}. Taking partial profit.`,
        rule: "rsi_overbought_sell",
      });
    }

    // Rule 6: Daily trend flipped bearish while holding
    if (trend1d === "bearish" && rsi1d && rsi1d < 45) {
      trades.push({
        action: "sell",
        token: t,
        amount_usd: Math.round(holdingUsd * 0.7 * 100) / 100,
        confidence: 62,
        reasoning: `RULE: Daily trend bearish + RSI(1d)=${rsi1d} below midline. Reducing exposure.`,
        rule: "daily_bearish_sell",
      });
    }

    // Rule 7: Extreme greed + overbought = take profit
    if (fearGreed > 80 && rsi4h && rsi4h > 70) {
      trades.push({
        action: "sell",
        token: t,
        amount_usd: Math.round(holdingUsd * 0.4 * 100) / 100,
        confidence: 55,
        reasoning: `RULE: Extreme greed (${fearGreed}) + RSI(4h)=${rsi4h} overbought. Research: F&G>80 = 34% win rate, avg -14.2% 30d. De-risking.`,
        rule: "extreme_greed_sell",
      });
    }
  }

  // Deduplicate: only one trade per token, pick highest confidence
  const best = {};
  for (const trade of trades) {
    const key = `${trade.action}_${trade.token}`;
    if (!best[key] || trade.confidence > best[key].confidence) {
      best[key] = trade;
    }
  }

  // Limit to top 3 trades per cycle to avoid over-trading
  return Object.values(best)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);
}

module.exports = { evaluateRules };
