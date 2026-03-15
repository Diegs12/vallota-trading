// Smart AI call policy — reduce cost without skipping meaningful regime changes.

const FORCE_AI_CALL_MS = parseInt(process.env.FORCE_AI_CALL_MS || "300000", 10); // 5m
const PRICE_MOVE_TRIGGER_PCT = parseFloat(process.env.AI_TRIGGER_PRICE_MOVE_PCT || "0.25");
const FNG_DELTA_TRIGGER = parseInt(process.env.AI_TRIGGER_FNG_DELTA || "2", 10);
const SIGNAL_CHANGE_TRIGGER = parseInt(process.env.AI_TRIGGER_SIGNAL_CHANGES || "1", 10);

let lastAiCallAt = 0;
let lastSnapshot = null;

function getCorePriceMap(prices = []) {
  const wanted = new Set(["btc", "eth", "sol"]);
  const map = {};
  for (const t of prices || []) {
    const s = (t.symbol || "").toLowerCase();
    if (!wanted.has(s)) continue;
    map[s] = {
      price: Number(t.current_price) || 0,
      chg24h: Number(t.price_change_percentage_24h) || 0,
    };
  }
  return map;
}

function getSignalSnapshot(summary = {}) {
  const out = {};
  for (const [token, tfs] of Object.entries(summary || {})) {
    out[token] = {
      trend1d: tfs?.["1d"]?.trend || "unknown",
      macd1h: tfs?.["1h"]?.macdTrend || "unknown",
      bb1h: tfs?.["1h"]?.bbSignal || "unknown",
      rsi1dSignal: tfs?.["1d"]?.rsiSignal || "unknown",
    };
  }
  return out;
}

function countSignalChanges(prev, curr) {
  let changes = 0;
  const tokens = new Set([...Object.keys(prev || {}), ...Object.keys(curr || {})]);
  for (const token of tokens) {
    const a = prev?.[token] || {};
    const b = curr?.[token] || {};
    for (const key of ["trend1d", "macd1h", "bb1h", "rsi1dSignal"]) {
      if ((a[key] || "unknown") !== (b[key] || "unknown")) changes++;
    }
  }
  return changes;
}

function maxCorePriceMovePct(prev, curr) {
  let maxMove = 0;
  for (const sym of ["btc", "eth", "sol"]) {
    const p = prev?.[sym]?.price || 0;
    const c = curr?.[sym]?.price || 0;
    if (!p || !c) continue;
    const move = Math.abs(((c - p) / p) * 100);
    if (move > maxMove) maxMove = move;
  }
  return maxMove;
}

function shouldCallAI({ marketData, timeframeSummary, nearestStopBufferPct }) {
  const now = Date.now();
  const fgValue = parseInt(marketData?.fearGreed?.value || "0", 10) || 0;
  const priceMap = getCorePriceMap(marketData?.prices || []);
  const signalMap = getSignalSnapshot(timeframeSummary || {});
  const leverageSignal = marketData?.derivatives?.overall_leverage_signal || "unknown";

  const snapshot = { fgValue, priceMap, signalMap, leverageSignal };

  if (!lastSnapshot) {
    lastSnapshot = snapshot;
    lastAiCallAt = now;
    return { call: true, reason: "initial_cycle" };
  }

  if (nearestStopBufferPct != null && nearestStopBufferPct < 2) {
    lastSnapshot = snapshot;
    lastAiCallAt = now;
    return { call: true, reason: "near_stop_loss" };
  }

  if (now - lastAiCallAt >= FORCE_AI_CALL_MS) {
    lastSnapshot = snapshot;
    lastAiCallAt = now;
    return { call: true, reason: "forced_interval" };
  }

  const fgDelta = Math.abs(snapshot.fgValue - lastSnapshot.fgValue);
  if (fgDelta >= FNG_DELTA_TRIGGER) {
    lastSnapshot = snapshot;
    lastAiCallAt = now;
    return { call: true, reason: "fear_greed_shift" };
  }

  const priceMove = maxCorePriceMovePct(lastSnapshot.priceMap, snapshot.priceMap);
  if (priceMove >= PRICE_MOVE_TRIGGER_PCT) {
    lastSnapshot = snapshot;
    lastAiCallAt = now;
    return { call: true, reason: "core_price_move" };
  }

  const signalChanges = countSignalChanges(lastSnapshot.signalMap, snapshot.signalMap);
  if (signalChanges >= SIGNAL_CHANGE_TRIGGER) {
    lastSnapshot = snapshot;
    lastAiCallAt = now;
    return { call: true, reason: "indicator_regime_change" };
  }

  if (snapshot.leverageSignal !== lastSnapshot.leverageSignal) {
    lastSnapshot = snapshot;
    lastAiCallAt = now;
    return { call: true, reason: "derivatives_positioning_change" };
  }

  // Keep snapshot fresh even when skipping.
  lastSnapshot = snapshot;
  return { call: false, reason: "no_material_change" };
}

module.exports = { shouldCallAI };
