require("dotenv").config();

const { aggregateMarketData } = require("./market-data");
const { getAllCoreTokenData } = require("./historical");
const { computeAll } = require("./indicators");
const { analyzeMarket, RISK_PROFILES } = require("./analyst");
const { safeAnalyze } = require("./failsafe");
const { getFullResearch } = require("./grok-research");
const { getAllDerivativesData } = require("./derivatives");
const { getAllMacroData } = require("./macro");
const { startDashboard, updateLiveState } = require("./dashboard-api");
const { logTrade, getTradeStats, getTradesLast24h } = require("./trade-log");
const { shouldReview, reviewPastTrades } = require("./self-review");
const { checkAndSendRecaps, sendManualRecap } = require("./recap");
const {
  recordEntry,
  clearPosition,
  checkAllPositions,
  getPositions,
  getNearestStopBufferPct,
} = require("./stop-loss");
const { syncAll } = require("./knowledge-sync");
const { shouldCallAI } = require("./decision-policy");
const { addCostEvent, getCostSummary } = require("./cost-tracker");
const { shouldRunStrategy, runDailyStrategy } = require("./daily-strategist");

const BOT_INSTANCE_ID = process.env.BOT_INSTANCE_ID || "primary";

// Choose real or paper wallet based on mode
const PAPER_MODE = process.env.TRADING_MODE !== "live";
const LIVE_TRADING_ENABLED = process.env.LIVE_TRADING_ENABLED === "true";
const walletModule = PAPER_MODE
  ? require("./paper-wallet")
  : require("./wallet");
const { getBalances, executeTrade, getWalletAddress } = walletModule;
const paperWallet = PAPER_MODE ? walletModule : null;

const INTERVAL = parseInt(process.env.ANALYSIS_INTERVAL_MS || "300000", 10); // default 5m
const RISK_PROFILE = process.env.RISK_PROFILE || "moderate";
const PER_TRADE_RISK_PCT = parseFloat(process.env.PER_TRADE_RISK_PCT || "5");
const DAILY_MAX_DRAWDOWN_PCT = parseFloat(process.env.DAILY_MAX_DRAWDOWN_PCT || "15");
const MIN_TRADE_USD = parseFloat(process.env.MIN_TRADE_USD || "10");
const ESTIMATED_ROUND_TRIP_COST_BPS = parseFloat(process.env.ESTIMATED_ROUND_TRIP_COST_BPS || "30");
const MIN_NET_EDGE_BPS = parseFloat(process.env.MIN_NET_EDGE_BPS || "5");
const MIN_CONFIDENCE_WITHOUT_EDGE = parseInt(process.env.MIN_CONFIDENCE_WITHOUT_EDGE || "50", 10);
const COST_CLAUDE_ANALYSIS_USD = parseFloat(process.env.COST_CLAUDE_ANALYSIS_USD || "0.012");
const COST_CLAUDE_REVIEW_USD = parseFloat(process.env.COST_CLAUDE_REVIEW_USD || "0.015");
const COST_GROK_RESEARCH_USD = parseFloat(process.env.COST_GROK_RESEARCH_USD || "0.00012");
const COST_GROK_DERIVATIVES_USD = parseFloat(process.env.COST_GROK_DERIVATIVES_USD || "0.00012");

let cycleCount = 0;
let dayAnchor = null;
let dayStartPortfolioUsd = null;
let aiCallsMade = 0;
let aiCallsSkipped = 0;

function getUtcDayAnchor(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

function estimatePortfolioUsd(balances, priceMap) {
  let total = 0;
  for (const [token, amount] of Object.entries(balances || {})) {
    const t = String(token).toLowerCase();
    const a = Number(amount) || 0;
    if (!a) continue;
    if (t === "usdc" || t === "usd") {
      total += a;
      continue;
    }
    const px = Number(priceMap?.[t]) || 0;
    total += a * px;
  }
  return total;
}

async function runCycle() {
  cycleCount++;
  const cycleStart = new Date();
  console.log(`\n${"=".repeat(60)}`);
  console.log(
    `Cycle #${cycleCount} | ${cycleStart.toISOString()} | ${PAPER_MODE ? "PAPER" : "LIVE"} MODE`
  );
  console.log(`Risk: ${RISK_PROFILE} | Interval: ${INTERVAL / 1000}s`);
  console.log(`${"=".repeat(60)}`);

  try {
    // 1. Fetch ALL data sources in parallel
    console.log("\nFetching market data, candles, derivatives, macro & Grok...");
    const [marketData, historicalData, grokResearch, derivativesData, macroData] = await Promise.all([
      aggregateMarketData(),
      getAllCoreTokenData(),
      getFullResearch(),
      getAllDerivativesData(),
      getAllMacroData(),
    ]);
    if (grokResearch?.sentiment || grokResearch?.regulatory) {
      addCostEvent("grok_research", COST_GROK_RESEARCH_USD);
    }
    if (derivativesData) {
      addCostEvent("grok_derivatives", COST_GROK_DERIVATIVES_USD);
    }

    console.log(
      `Prices: ${marketData.prices?.length || 0} tokens`,
      `| Fear & Greed: ${marketData.fearGreed?.value || "N/A"} (${marketData.fearGreed?.value_classification || "N/A"})`
    );

    // 2. Compute technical indicators from historical data
    console.log("Computing technical indicators...");
    const technicals = {};
    const timeframeSummary = {};

    for (const [token, timeframes] of Object.entries(historicalData)) {
      technicals[token] = {};
      timeframeSummary[token] = {};

      for (const [tf, data] of Object.entries(timeframes)) {
        if (data.closes && data.closes.length >= 35) {
          technicals[token][tf] = computeAll(data.closes);
          timeframeSummary[token][tf] = {
            trend: technicals[token][tf].trendSignal,
            rsi: technicals[token][tf].rsi,
            rsiSignal: technicals[token][tf].rsiSignal,
            macdTrend: technicals[token][tf].macd?.trend || "unknown",
            bbSignal: technicals[token][tf].bollingerBands?.signal || "unknown",
          };
        }
      }

      // Print summary
      const daily = timeframeSummary[token]["1d"] || {};
      const hourly = timeframeSummary[token]["1h"] || {};
      console.log(
        `  ${token.toUpperCase()}: RSI(1d)=${daily.rsi || "?"} ${daily.rsiSignal || "?"} | MACD(1h)=${hourly.macdTrend || "?"} | BB(1h)=${hourly.bbSignal || "?"}`
      );
    }

    // Enrich market data with all intelligence
    marketData.technicals = technicals;
    marketData.timeframeSummary = timeframeSummary;
    marketData.grokResearch = grokResearch;
    marketData.derivatives = derivativesData;
    marketData.macro = macroData;

    // Run daily Opus strategist (once per UTC day)
    if (shouldRunStrategy()) {
      const strategyResult = await runDailyStrategy(marketData);
      if (strategyResult) {
        addCostEvent("opus_strategist", strategyResult.costUsd, { type: "daily_strategy" });
        console.log("Daily Opus strategy set.");
      }
    }

    // Update dashboard
    updateLiveState({
      marketData,
      technicals,
      timeframeSummary,
      cycleCount,
      lastCycle: cycleStart.toISOString(),
      mode: PAPER_MODE ? "paper" : "live",
      liveTradingEnabled: LIVE_TRADING_ENABLED,
      riskProfile: RISK_PROFILE,
    });

    // 3. Update paper wallet prices if in paper mode
    if (paperWallet) {
      const priceMap = {};
      (marketData.prices || []).forEach((t) => {
        priceMap[t.symbol.toLowerCase()] = t.current_price;
      });
      paperWallet.updatePrices(priceMap);
    }

    // 4. Get current portfolio
    console.log("\nChecking portfolio...");
    const balances = await getBalances();
    const portfolio = {
      balances,
      walletAddress: await getWalletAddress(),
      mode: PAPER_MODE ? "paper" : "live",
    };

    let portfolioUsd = 0;
    if (paperWallet) {
      const pv = paperWallet.getPortfolioValue();
      console.log(
        `Portfolio: $${pv.totalValue} | P&L: $${pv.pnl} (${pv.pnlPercent}%)`
      );
      portfolio.portfolioValue = pv;
      updateLiveState({ portfolio: pv });
      portfolioUsd = pv.totalValue || 0;
    } else {
      console.log("Balances: [redacted from logs — check dashboard]");
      updateLiveState({ portfolio: { balances } });
      portfolioUsd = estimatePortfolioUsd(
        balances,
        Object.fromEntries((marketData.prices || []).map((t) => [t.symbol.toLowerCase(), t.current_price]))
      );
    }

    // 4b. Daily drawdown kill-switch (prevents new risk after severe down day)
    const nowAnchor = getUtcDayAnchor();
    if (dayAnchor !== nowAnchor || dayStartPortfolioUsd == null) {
      dayAnchor = nowAnchor;
      dayStartPortfolioUsd = portfolioUsd || parseFloat(process.env.TRADING_CAPITAL_USD || "1000");
    }
    const dailyDrawdownPct =
      dayStartPortfolioUsd > 0
        ? ((dayStartPortfolioUsd - portfolioUsd) / dayStartPortfolioUsd) * 100
        : 0;
    const dailyRiskLocked = dailyDrawdownPct >= DAILY_MAX_DRAWDOWN_PCT;
    if (dailyRiskLocked) {
      console.warn(
        `DAILY KILL-SWITCH ACTIVE: drawdown ${dailyDrawdownPct.toFixed(2)}% >= ${DAILY_MAX_DRAWDOWN_PCT}%`
      );
    }

    // 5. Check stop-losses BEFORE asking Claude
    const currentPrices = {};
    (marketData.prices || []).forEach((t) => {
      currentPrices[t.symbol.toLowerCase()] = t.current_price;
    });

    const stopLossTriggers = checkAllPositions(currentPrices, RISK_PROFILE);
    if (stopLossTriggers.length > 0) {
      console.log("\n*** STOP-LOSS TRIGGERED ***");
      for (const trigger of stopLossTriggers) {
        console.log(
          `  ${trigger.token.toUpperCase()}: ${trigger.reason}`
        );
        console.log(
          `  Entry: $${trigger.entryPrice} → Current: $${trigger.currentPrice} (${trigger.drawdownFromEntry}% down)`
        );

        // Execute the stop-loss sell
        await executeTrade("sell", trigger.token, null);
        clearPosition(trigger.token);

        logTrade({
          timestamp: cycleStart.toISOString(),
          cycle: cycleCount,
          action: "sell",
          token: trigger.token,
          confidence: 100,
          reasoning: trigger.reason,
          market_summary: "Stop-loss triggered",
          risk_notes: `Drawdown: ${trigger.drawdownFromEntry}% (threshold: ${trigger.threshold}%)`,
          executed: true,
          stopLoss: true,
        });
      }
      console.log("Stop-loss sells complete.\n");
    }

    // 6. Smart policy: only call Claude when state materially changed
    const nearestStopBufferPct = getNearestStopBufferPct(currentPrices, RISK_PROFILE);
    const aiCallPolicy = shouldCallAI({
      marketData,
      timeframeSummary,
      nearestStopBufferPct,
    });

    let decision;
    let failsafe = false;
    let aiMeta = { apiSuccess: false, attempts: 0 };
    if (aiCallPolicy.call) {
      console.log(`Analyzing with Claude... (${aiCallPolicy.reason})`);
      const out = await safeAnalyze(analyzeMarket, marketData, portfolio, RISK_PROFILE);
      decision = out.decision;
      failsafe = out.failsafe;
      aiMeta = out.meta || aiMeta;
      aiCallsMade++;
      if (aiMeta.apiSuccess) {
        addCostEvent("claude_analysis", COST_CLAUDE_ANALYSIS_USD, { reason: aiCallPolicy.reason });
      }
    } else {
      aiCallsSkipped++;
      decision = {
        action: "hold",
        token: "usdc",
        amount_usd: null,
        confidence: 45,
        reasoning: `SMART-SKIP: No material market change (${aiCallPolicy.reason})`,
        market_summary: "State unchanged enough to skip LLM analysis this cycle",
        risk_notes: "Capital preserved; force-analysis window still active.",
        timeframe_alignment: "unchanged",
        expected_edge_pct: 0,
      };
      console.log(`Skipping Claude call (${aiCallPolicy.reason})`);
    }

    if (failsafe) {
      console.warn("*** Running in FAILSAFE mode ***");
    }

    // Update dashboard with latest decision
    updateLiveState({ lastDecision: decision });

    // 7. Validate + execute trade if not hold and confidence is high enough
    const minConfidence = failsafe ? 0 : 45; // Aggressive: lower bar to execute trades
    let executed = false;

    // Validate decision fields before executing
    const ALLOWED_ACTIONS = ["buy", "sell", "hold"];
    const ALLOWED_TOKENS = ["eth", "usdc", "aero", "brett", "degen", "toshi", "well"];

    const validAction = ALLOWED_ACTIONS.includes(decision.action);
    const validToken = !decision.token || ALLOWED_TOKENS.includes(decision.token?.toLowerCase());
    const validConfidence = typeof decision.confidence === "number" &&
      decision.confidence >= 0 && decision.confidence <= 100 &&
      Number.isFinite(decision.confidence);
    const validAmount = decision.amount_usd === null ||
      decision.amount_usd === undefined ||
      (typeof decision.amount_usd === "number" &&
        decision.amount_usd > 0 &&
        Number.isFinite(decision.amount_usd) &&
        decision.amount_usd <= parseFloat(process.env.TRADING_CAPITAL_USD || "1000"));

    if (!validAction || !validToken || !validConfidence || !validAmount) {
      console.warn("\n*** BLOCKED: Invalid trade parameters from AI ***");
      if (!validAction) console.warn(`  Bad action: ${decision.action}`);
      if (!validToken) console.warn(`  Bad token: ${decision.token}`);
      if (!validConfidence) console.warn(`  Bad confidence: ${decision.confidence}`);
      if (!validAmount) console.warn(`  Bad amount: ${decision.amount_usd}`);
      decision.action = "hold";
      decision.reasoning = "BLOCKED — invalid parameters: " + decision.reasoning;
    }

    // Risk cap by account size + profile ceiling
    const profile = RISK_PROFILES[RISK_PROFILE] || RISK_PROFILES.moderate;
    const riskCapUsd = (portfolioUsd * PER_TRADE_RISK_PCT) / 100;
    const profileCapUsd = (portfolioUsd * profile.maxPositionPct) / 100;
    const hardCapUsd = Math.max(0, Math.min(riskCapUsd, profileCapUsd));
    if (
      decision.action === "buy" &&
      typeof decision.amount_usd === "number" &&
      decision.amount_usd > hardCapUsd &&
      hardCapUsd > 0
    ) {
      decision.risk_notes = `${decision.risk_notes || ""} | Clamped by risk cap to $${hardCapUsd.toFixed(2)}`;
      decision.amount_usd = parseFloat(hardCapUsd.toFixed(2));
    }

    // Edge/cost filter: skip low-edge, low-notional churn.
    if (decision.action !== "hold") {
      const amount = Number(decision.amount_usd || 0);
      if (amount > 0 && amount < MIN_TRADE_USD) {
        decision.action = "hold";
        decision.reasoning = `BLOCKED — trade below minimum notional ($${MIN_TRADE_USD})`;
      } else {
        const hasEdge = Number.isFinite(Number(decision.expected_edge_pct));
        const estEdgeBps = hasEdge
          ? Number(decision.expected_edge_pct) * 100
          : Math.max(0, (Number(decision.confidence || 0) - 50) * 4);
        const netEdgeBps = estEdgeBps - ESTIMATED_ROUND_TRIP_COST_BPS;
        if (hasEdge) {
          if (netEdgeBps < MIN_NET_EDGE_BPS) {
            decision.action = "hold";
            decision.reasoning = `BLOCKED — insufficient net edge (${netEdgeBps.toFixed(1)} bps after costs)`;
          }
        } else if ((decision.confidence || 0) < MIN_CONFIDENCE_WITHOUT_EDGE) {
          decision.action = "hold";
          decision.reasoning = `BLOCKED — confidence < ${MIN_CONFIDENCE_WITHOUT_EDGE} without explicit edge estimate`;
        }
      }
    }

    // Daily kill-switch blocks new buys, but still allows sells/risk reduction.
    if (dailyRiskLocked && decision.action === "buy") {
      decision.action = "hold";
      decision.reasoning = `BLOCKED — daily drawdown lock active (${dailyDrawdownPct.toFixed(2)}%)`;
    }

    if (decision.action !== "hold" && decision.confidence >= minConfidence) {
      if (!PAPER_MODE && !LIVE_TRADING_ENABLED) {
        decision.action = "hold";
        decision.reasoning = "BLOCKED — live trading guard is disabled (set LIVE_TRADING_ENABLED=true to execute)";
      }
    }

    if (decision.action !== "hold" && decision.confidence >= minConfidence) {
      console.log(
        `\nExecuting: ${decision.action} ${decision.token} ($${decision.amount_usd})`
      );
      const trade = await executeTrade(
        decision.action,
        decision.token,
        decision.amount_usd
      );

      if (trade) {
        executed = true;

        // Track position for stop-loss
        if (decision.action === "buy") {
          const price = currentPrices[decision.token] || decision.amount_usd;
          recordEntry(decision.token, price, decision.amount_usd);
        } else if (decision.action === "sell") {
          clearPosition(decision.token);
        }
      }
    } else {
      console.log(
        `\nHolding. Confidence: ${decision.confidence}% | Reason: ${decision.reasoning}`
      );
    }

    // 8. Log the trade decision
    logTrade({
      timestamp: cycleStart.toISOString(),
      cycle: cycleCount,
      ...decision,
      executed,
      failsafe: failsafe || false,
      mode: PAPER_MODE ? "paper" : "live",
    });

    // 9. Self-review check
    if (shouldReview()) {
      console.log("\nRunning self-review...");
      const review = await reviewPastTrades(marketData);
      if (review) addCostEvent("claude_review", COST_CLAUDE_REVIEW_USD);
    }

    // 10. Check if it's time to send a recap email
    await checkAndSendRecaps();

    // 11. Sync knowledge to Supabase every 10 cycles
    if (cycleCount % 10 === 0) {
      try {
        await syncAll(BOT_INSTANCE_ID);
      } catch (syncErr) {
        console.warn("Knowledge sync skipped:", syncErr.message);
      }
    }

    // 12. Print 24h summary periodically (every 10 cycles)
    if (cycleCount % 10 === 0) {
      print24hSummary();
    }

    // 13. Update operations + cost telemetry for dashboard
    const pv = paperWallet ? paperWallet.getPortfolioValue() : null;
    const costs = getCostSummary({
      paperPnlUsd: pv?.pnl || 0,
      startingCapitalUsd: pv?.startingCapital || parseFloat(process.env.TRADING_CAPITAL_USD || "1000"),
    });
    updateLiveState({
      ops: {
        aiCallsMade,
        aiCallsSkipped,
        lastAiDecisionPolicy: aiCallPolicy.reason,
        lastAiApiSuccess: aiMeta.apiSuccess,
        lastAiAttempts: aiMeta.attempts,
        dailyDrawdownPct: Math.round(dailyDrawdownPct * 100) / 100,
        dailyRiskLocked,
      },
      costs,
    });

    const elapsed = Date.now() - cycleStart.getTime();
    console.log(`\nCycle #${cycleCount} complete in ${(elapsed / 1000).toFixed(1)}s`);
  } catch (err) {
    console.error("Cycle error:", err.message);
    console.error(err.stack);
  }
}

function print24hSummary() {
  const trades = getTradesLast24h();
  const stats = getTradeStats();

  console.log(`\n--- 24-HOUR SUMMARY ---`);
  console.log(`Total decisions: ${stats.last24h?.decisions || 0}`);
  console.log(`Executed trades: ${stats.last24h?.executed || 0}`);
  console.log(`Avg confidence: ${stats.avgConfidence}%`);

  if (paperWallet) {
    const pv = paperWallet.getPortfolioValue();
    console.log(`Portfolio value: $${pv.totalValue}`);
    console.log(`P&L: $${pv.pnl} (${pv.pnlPercent}%)`);
  }

  const positions = getPositions();
  const posCount = Object.keys(positions).length;
  if (posCount > 0) {
    console.log(`Open positions: ${posCount}`);
    for (const [token, pos] of Object.entries(positions)) {
      console.log(`  ${token.toUpperCase()}: entry $${pos.entryPrice}`);
    }
  }
  console.log(`-----------------------\n`);
}

async function start() {
  console.log(`
  ╔═══════════════════════════════════════════╗
  ║         VALLOTA TRADING BOT v1.0          ║
  ║         Base L2 | Coinbase CDP            ║
  ╠═══════════════════════════════════════════╣
  ║  Mode:     ${(PAPER_MODE ? "PAPER (simulated)" : "LIVE (real money)").padEnd(30)}║
  ║  Risk:     ${RISK_PROFILE.padEnd(30)}║
  ║  Interval: ${(INTERVAL / 1000 + "s").padEnd(30)}║
  ║  Capital:  $${(process.env.TRADING_CAPITAL_USD || "1000").padEnd(29)}║
  ╠═══════════════════════════════════════════╣
  ║  Features:                                ║
  ║  ✓ Computed TA (RSI, MACD, Bollinger)     ║
  ║  ✓ Multi-timeframe (5m, 1h, 4h, 1d)      ║
  ║  ✓ Hard stop-losses                       ║
  ║  ✓ Claude failsafe                        ║
  ║  ✓ Self-review & learning loop            ║
  ║  ✓ Trade logging & 24h summaries          ║
  ╚═══════════════════════════════════════════╝
  `);

  if (PAPER_MODE) {
    console.log(
      "Running in PAPER MODE — no real trades will be executed.\n" +
      "Set TRADING_MODE=live in .env to switch to real trading.\n"
    );
  } else if (!LIVE_TRADING_ENABLED) {
    console.warn(
      "LIVE mode requested but LIVE_TRADING_ENABLED is false.\n" +
      "Trades will be analyzed but NOT executed until you set LIVE_TRADING_ENABLED=true."
    );
  }

  // Start dashboard server
  startDashboard();

  // Run first cycle immediately
  await runCycle();

  // Then run on interval
  setInterval(runCycle, INTERVAL);
}

// ---- CLI Commands ----

async function testMarketData() {
  console.log("Testing market data + indicators...\n");
  const [marketData, historicalData] = await Promise.all([
    aggregateMarketData(),
    getAllCoreTokenData(),
  ]);

  console.log(`Prices for ${marketData.prices?.length || 0} tokens:`);
  (marketData.prices || []).forEach((t) => {
    console.log(
      `  ${t.symbol.toUpperCase().padEnd(8)} $${String(t.current_price).padStart(10)} | 24h: ${(t.price_change_percentage_24h || 0).toFixed(2)}%`
    );
  });

  console.log(
    `\nFear & Greed: ${marketData.fearGreed?.value} (${marketData.fearGreed?.value_classification})`
  );

  console.log("\n--- Computed Technical Indicators ---");
  for (const [token, timeframes] of Object.entries(historicalData)) {
    console.log(`\n${token.toUpperCase()}:`);
    for (const [tf, data] of Object.entries(timeframes)) {
      if (data.closes && data.closes.length >= 35) {
        const ta = computeAll(data.closes);
        console.log(`  ${tf}:`);
        console.log(`    RSI: ${ta.rsi} (${ta.rsiSignal})`);
        console.log(
          `    MACD: ${ta.macd?.macd} | Signal: ${ta.macd?.signal} | Histogram: ${ta.macd?.histogram} (${ta.macd?.trend})`
        );
        console.log(
          `    Bollinger: Upper=${ta.bollingerBands?.upper} Mid=${ta.bollingerBands?.middle} Low=${ta.bollingerBands?.lower} %B=${ta.bollingerBands?.percentB} (${ta.bollingerBands?.signal})`
        );
        console.log(`    SMA20: ${ta.sma20} | SMA50: ${ta.sma50} | Trend: ${ta.trendSignal}`);
      }
    }
  }
}

function showStats() {
  const stats = getTradeStats();
  console.log("\n--- Trading Stats ---");
  console.log(JSON.stringify(stats, null, 2));

  if (paperWallet) {
    const pv = paperWallet.getPortfolioValue();
    console.log("\n--- Paper Portfolio ---");
    console.log(JSON.stringify(pv, null, 2));
  }

  const trades24h = getTradesLast24h();
  console.log(`\n--- Last 24h: ${trades24h.length} decisions ---`);
  trades24h.forEach((t) => {
    const time = new Date(t.timestamp).toLocaleTimeString();
    const exec = t.executed ? "EXEC" : "SKIP";
    console.log(
      `  ${time} | ${exec} | ${t.action.toUpperCase().padEnd(4)} ${(t.token || "").toUpperCase().padEnd(6)} | conf: ${t.confidence}% | ${t.reasoning?.substring(0, 60)}`
    );
  });
}

const command = process.argv[2];
switch (command) {
  case "start":
    start().catch(console.error);
    break;
  case "test-data":
    testMarketData().catch(console.error);
    break;
  case "stats":
    showStats();
    break;
  case "recap":
    sendManualRecap(process.argv[3] || "daily").catch(console.error);
    break;
  default:
    console.log("Vallota Trading Bot v1.0\n");
    console.log("Usage:");
    console.log("  node src/bot.js start       — Start the trading bot");
    console.log("  node src/bot.js test-data   — Test market data + indicators (no API key needed)");
    console.log("  node src/bot.js stats       — Show trade statistics & 24h log");
    console.log("  node src/bot.js recap       — Generate & send a recap email now");
    console.log("  node src/bot.js recap weekly — Generate a weekly recap");
    break;
}
