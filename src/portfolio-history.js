// Portfolio History — stores periodic snapshots for charting
const fs = require("fs");
const path = require("path");

const HISTORY_FILE = path.join(__dirname, "..", "data", "portfolio-history.json");
const MAX_ENTRIES = 10000;
const MAX_RESPONSE_POINTS = 500;

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = fs.readFileSync(HISTORY_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (err) {
    console.warn("portfolio-history: failed to load, starting fresh:", err.message);
  }
  return [];
}

function saveHistory(history) {
  try {
    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history), "utf-8");
  } catch (err) {
    console.warn("portfolio-history: failed to save:", err.message);
  }
}

/**
 * Record a portfolio snapshot.
 * @param {Object} data - { paperValue, paperPnlPct, liveValue, btcPrice, ethPrice, solPrice }
 */
function recordSnapshot(data) {
  const history = loadHistory();

  const snapshot = {
    timestamp: new Date().toISOString(),
    paperValue: round(data.paperValue || 0),
    paperPnlPct: round(data.paperPnlPct || 0),
    liveValue: round(data.liveValue || 0),
    btcPrice: round(data.btcPrice || 0),
    ethPrice: round(data.ethPrice || 0),
    solPrice: round(data.solPrice || 0),
  };

  history.push(snapshot);

  // Trim to max entries (drop oldest)
  while (history.length > MAX_ENTRIES) {
    history.shift();
  }

  saveHistory(history);
  return snapshot;
}

/**
 * Get portfolio history for the last N hours.
 * Auto-downsamples to MAX_RESPONSE_POINTS if too many entries.
 * @param {number} hours - Number of hours to look back (default 168 = 7 days)
 * @returns {Array} Array of snapshots
 */
function getHistory(hours = 168) {
  const history = loadHistory();
  const cutoff = Date.now() - hours * 60 * 60 * 1000;

  let filtered = history.filter((s) => new Date(s.timestamp).getTime() >= cutoff);

  // Downsample if too many points
  if (filtered.length > MAX_RESPONSE_POINTS) {
    filtered = downsample(filtered, MAX_RESPONSE_POINTS);
  }

  return filtered;
}

/**
 * Evenly downsample an array to targetCount entries.
 * Always keeps the first and last entry.
 */
function downsample(arr, targetCount) {
  if (arr.length <= targetCount) return arr;

  const result = [arr[0]];
  const step = (arr.length - 1) / (targetCount - 1);

  for (let i = 1; i < targetCount - 1; i++) {
    const idx = Math.round(i * step);
    result.push(arr[idx]);
  }

  result.push(arr[arr.length - 1]);
  return result;
}

function round(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

module.exports = { recordSnapshot, getHistory };
