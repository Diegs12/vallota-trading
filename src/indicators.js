// Computed Technical Analysis — exact math, no LLM guessing

function sma(data, period) {
  if (data.length < period) return null;
  const slice = data.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

function ema(data, period) {
  if (data.length < period) return null;
  const multiplier = 2 / (period + 1);

  // Seed with SMA of first `period` values
  let value = data.slice(0, period).reduce((s, v) => s + v, 0) / period;

  for (let i = period; i < data.length; i++) {
    value = (data[i] - value) * multiplier + value;
  }
  return value;
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;

  const changes = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  // Initial average gain/loss using SMA
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  // Smooth with Wilder's method
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function macd(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (closes.length < slowPeriod + signalPeriod) return null;

  // Compute MACD line values for each point
  const macdLine = [];
  for (let i = slowPeriod; i <= closes.length; i++) {
    const slice = closes.slice(0, i);
    const fastEma = ema(slice, fastPeriod);
    const slowEma = ema(slice, slowPeriod);
    if (fastEma !== null && slowEma !== null) {
      macdLine.push(fastEma - slowEma);
    }
  }

  if (macdLine.length < signalPeriod) return null;

  const signal = ema(macdLine, signalPeriod);
  const current = macdLine[macdLine.length - 1];
  const histogram = current - signal;

  return {
    macd: round(current),
    signal: round(signal),
    histogram: round(histogram),
    trend: histogram > 0 ? "bullish" : "bearish",
  };
}

function bollingerBands(closes, period = 20, stdDevMultiplier = 2) {
  if (closes.length < period) return null;

  const slice = closes.slice(-period);
  const middle = slice.reduce((s, v) => s + v, 0) / period;

  const variance =
    slice.reduce((s, v) => s + Math.pow(v - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);

  const upper = middle + stdDevMultiplier * stdDev;
  const lower = middle - stdDevMultiplier * stdDev;
  const currentPrice = closes[closes.length - 1];

  // %B tells you where price is relative to the bands (0 = lower, 1 = upper)
  const percentB = (currentPrice - lower) / (upper - lower);

  return {
    upper: round(upper),
    middle: round(middle),
    lower: round(lower),
    bandwidth: round((upper - lower) / middle),
    percentB: round(percentB),
    signal:
      percentB > 1
        ? "overbought"
        : percentB < 0
          ? "oversold"
          : "neutral",
  };
}

function computeAll(closes) {
  if (!closes || closes.length < 35) {
    return { error: "Need at least 35 data points for full analysis" };
  }

  const currentPrice = closes[closes.length - 1];
  const rsiValue = rsi(closes);
  const macdValue = macd(closes);
  const bbValue = bollingerBands(closes);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);

  let rsiSignal = "neutral";
  if (rsiValue !== null) {
    if (rsiValue > 70) rsiSignal = "overbought";
    else if (rsiValue < 30) rsiSignal = "oversold";
    else if (rsiValue < 40) rsiSignal = "approaching_oversold";
    else if (rsiValue > 60) rsiSignal = "approaching_overbought";
  }

  let trendSignal = "neutral";
  if (sma20 && sma50) {
    if (sma20 > sma50) trendSignal = "bullish";
    else if (sma20 < sma50) trendSignal = "bearish";
  }

  return {
    price: round(currentPrice),
    rsi: rsiValue !== null ? round(rsiValue) : null,
    rsiSignal,
    macd: macdValue,
    bollingerBands: bbValue,
    sma20: sma20 !== null ? round(sma20) : null,
    sma50: sma50 !== null ? round(sma50) : null,
    ema12: ema12 !== null ? round(ema12) : null,
    ema26: ema26 !== null ? round(ema26) : null,
    trendSignal,
  };
}

function round(n) {
  return Math.round(n * 10000) / 10000;
}

module.exports = { sma, ema, rsi, macd, bollingerBands, computeAll };
