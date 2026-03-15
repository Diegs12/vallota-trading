// Hard stop-loss — sells positions that breach drawdown thresholds
// Overrides Claude's opinion. Capital preservation is non-negotiable.

const STOP_LOSS_THRESHOLDS = {
  conservative: 0.03, // 3% drawdown
  moderate: 0.07,     // 7% drawdown
  aggressive: 0.15,   // 15% drawdown
};

// Track entry prices for active positions
const positions = new Map();

function recordEntry(token, price, amount) {
  positions.set(token, {
    entryPrice: price,
    amount,
    enteredAt: new Date().toISOString(),
    highWaterMark: price,
  });
}

function updateHighWaterMark(token, currentPrice) {
  const pos = positions.get(token);
  if (pos && currentPrice > pos.highWaterMark) {
    pos.highWaterMark = currentPrice;
  }
}

function clearPosition(token) {
  positions.delete(token);
}

function checkStopLoss(token, currentPrice, riskProfile = "moderate") {
  const pos = positions.get(token);
  if (!pos) return { triggered: false };

  const threshold = STOP_LOSS_THRESHOLDS[riskProfile] || STOP_LOSS_THRESHOLDS.moderate;

  // Check drawdown from entry price
  const drawdownFromEntry = (pos.entryPrice - currentPrice) / pos.entryPrice;

  // Check drawdown from high water mark (trailing stop)
  const drawdownFromHigh = (pos.highWaterMark - currentPrice) / pos.highWaterMark;

  // Update high water mark
  updateHighWaterMark(token, currentPrice);

  // Trigger on either fixed or trailing stop
  const triggered = drawdownFromEntry > threshold || drawdownFromHigh > threshold;

  return {
    triggered,
    token,
    entryPrice: pos.entryPrice,
    currentPrice,
    highWaterMark: pos.highWaterMark,
    drawdownFromEntry: Math.round(drawdownFromEntry * 10000) / 100, // as %
    drawdownFromHigh: Math.round(drawdownFromHigh * 10000) / 100,
    threshold: threshold * 100,
    reason: triggered
      ? `Stop-loss triggered: ${drawdownFromEntry > threshold ? "entry" : "trailing"} drawdown ${(Math.max(drawdownFromEntry, drawdownFromHigh) * 100).toFixed(2)}% > ${threshold * 100}%`
      : null,
  };
}

function checkAllPositions(prices, riskProfile) {
  const triggers = [];
  for (const [token, pos] of positions) {
    const price = prices[token];
    if (price) {
      const result = checkStopLoss(token, price, riskProfile);
      if (result.triggered) {
        triggers.push(result);
      }
    }
  }
  return triggers;
}

function getPositions() {
  const result = {};
  for (const [token, pos] of positions) {
    result[token] = { ...pos };
  }
  return result;
}

function getNearestStopBufferPct(prices, riskProfile = "moderate") {
  const threshold = STOP_LOSS_THRESHOLDS[riskProfile] || STOP_LOSS_THRESHOLDS.moderate;
  let nearest = null;
  for (const [token, pos] of positions) {
    const p = prices?.[token];
    if (!p || !pos.entryPrice || !pos.highWaterMark) continue;

    const ddEntry = (pos.entryPrice - p) / pos.entryPrice;
    const ddHigh = (pos.highWaterMark - p) / pos.highWaterMark;
    const dd = Math.max(ddEntry, ddHigh);
    const buffer = (threshold - dd) * 100; // remaining headroom before trigger

    if (nearest == null || buffer < nearest) nearest = buffer;
  }
  return nearest;
}

module.exports = {
  recordEntry,
  updateHighWaterMark,
  clearPosition,
  checkStopLoss,
  checkAllPositions,
  getPositions,
  getNearestStopBufferPct,
};
