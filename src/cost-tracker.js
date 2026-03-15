const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "cost-events.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readEvents() {
  ensureDir();
  if (!fs.existsSync(FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeEvents(events) {
  ensureDir();
  fs.writeFileSync(FILE, JSON.stringify(events, null, 2));
}

function addCostEvent(service, usd, meta = {}) {
  if (!Number.isFinite(usd) || usd <= 0) return;
  const events = readEvents();
  events.push({
    id: events.length + 1,
    timestamp: new Date().toISOString(),
    service,
    usd: Math.round(usd * 100000) / 100000,
    meta,
  });
  writeEvents(events);
}

function sumSince(events, msAgo) {
  const cutoff = Date.now() - msAgo;
  return events
    .filter((e) => new Date(e.timestamp).getTime() >= cutoff)
    .reduce((s, e) => s + (Number(e.usd) || 0), 0);
}

function byServiceSince(events, msAgo) {
  const cutoff = Date.now() - msAgo;
  const out = {};
  for (const e of events) {
    if (new Date(e.timestamp).getTime() < cutoff) continue;
    out[e.service] = (out[e.service] || 0) + (Number(e.usd) || 0);
  }
  return out;
}

function getCostSummary(extra = {}) {
  const events = readEvents();
  const total = events.reduce((s, e) => s + (Number(e.usd) || 0), 0);
  const last24h = sumSince(events, 24 * 60 * 60 * 1000);
  const last7d = sumSince(events, 7 * 24 * 60 * 60 * 1000);
  const last30d = sumSince(events, 30 * 24 * 60 * 60 * 1000);
  const runRateMonthly = (last7d / 7) * 30;

  const fixedInfraMonthly = parseFloat(process.env.FIXED_MONTHLY_INFRA_USD || "0");
  const now = new Date();
  const daysInMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getDate();
  const monthDay = now.getUTCDate();
  const fixedInfraMtd = fixedInfraMonthly > 0 ? (fixedInfraMonthly / daysInMonth) * monthDay : 0;

  const totalWithInfraMtd = total + fixedInfraMtd;

  const paperPnlUsd = Number(extra.paperPnlUsd || 0);
  const netAfterCostsUsd = paperPnlUsd - totalWithInfraMtd;
  const roiAfterCostsPct = extra.startingCapitalUsd
    ? (netAfterCostsUsd / Number(extra.startingCapitalUsd)) * 100
    : null;

  return {
    totals: {
      api_all_time_usd: round(total),
      api_last_24h_usd: round(last24h),
      api_last_7d_usd: round(last7d),
      api_last_30d_usd: round(last30d),
      api_run_rate_monthly_usd: round(runRateMonthly),
      fixed_infra_monthly_usd: round(fixedInfraMonthly),
      fixed_infra_mtd_usd: round(fixedInfraMtd),
      total_spend_mtd_usd: round(totalWithInfraMtd),
    },
    by_service: {
      all_time: roundMap(byServiceSince(events, Number.MAX_SAFE_INTEGER)),
      last_30d: roundMap(byServiceSince(events, 30 * 24 * 60 * 60 * 1000)),
    },
    performance: {
      paper_pnl_usd: round(paperPnlUsd),
      net_after_costs_usd: round(netAfterCostsUsd),
      roi_after_costs_pct: roiAfterCostsPct == null ? null : round(roiAfterCostsPct),
    },
    events_count: events.length,
    last_event_at: events.length ? events[events.length - 1].timestamp : null,
  };
}

function round(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function roundMap(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = round(v);
  return out;
}

module.exports = { addCostEvent, getCostSummary };
