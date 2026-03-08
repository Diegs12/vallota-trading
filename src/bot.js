require("dotenv").config();

const { aggregateMarketData } = require("./market-data");
const { getAllCoreTokenData } = require("./historical");
const { computeAll } = require("./indicators");
const { analyzeMarket } = require("./analyst");
const { safeAnalyze } = require("./failsafe");
const { getFullResearch } = require("./grok-research");
const { getAllDerivativesData } = require("./derivatives");
const { getAllMacroData } = require("./macro");
const { startDashboard, updateLiveState } = require("./dashboard-api");
const { logTrade, getTradeStats, getTradesLast24h } = require("./trade-log");
const { shouldReview, reviewPastTrades } = require("./self-review");
const {
  recordEntry,
  clearPosition,
  checkAllPositions,
  getPositions,
} = require("./stop-loss");

// Choose real or paper wallet based on mode
const PAPER_MODE = process.env.TRADING_MODE !== "live";
const walletModule = PAPER_MODE
  ? require("./paper-wallet")
  : require("./wallet");
const { getBalances, executeTrade, getWalletAddress } = walletModule;
const paperWallet = PAPER_MODE ? walletModule : null;

const INTERVAL = parseInt(process.env.ANALYSIS_INTERVAL_MS) || 120000;
const RISK_PROFILE = process.env.RISK_PROFILE || "moderate";

let cycleCount = 0;

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

    // Update dashboard
    updateLiveState({
      marketData,
      technicals,
      timeframeSummary,
      cycleCount,
      lastCycle: cycleStart.toISOString(),
      mode: PAPER_MODE ? "paper" : "live",
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

    if (paperWallet) {
      const pv = paperWallet.getPortfolioValue();
      console.log(
        `Portfolio: $${pv.totalValue} | P&L: $${pv.pnl} (${pv.pnlPercent}%)`
      );
      portfolio.portfolioValue = pv;
      updateLiveState({ portfolio: pv });
    } else {
      console.log("Balances:", JSON.stringify(balances, null, 2));
      updateLiveState({ portfolio: { balances } });
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

    // 6. Ask Claude for analysis (with failsafe)
    console.log("Analyzing with Claude...");
    const { decision, failsafe } = await safeAnalyze(
      analyzeMarket,
      marketData,
      portfolio,
      RISK_PROFILE
    );

    if (failsafe) {
      console.warn("*** Running in FAILSAFE mode ***");
    }

    // Update dashboard with latest decision
    updateLiveState({ lastDecision: decision });

    // 7. Execute trade if not hold and confidence is high enough
    const minConfidence = failsafe ? 0 : 60; // Always execute failsafe sells
    let executed = false;

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
      await reviewPastTrades(marketData);
    }

    // 10. Print 24h summary periodically (every 10 cycles)
    if (cycleCount % 10 === 0) {
      print24hSummary();
    }

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
  default:
    console.log("Vallota Trading Bot v1.0\n");
    console.log("Usage:");
    console.log("  node src/bot.js start       — Start the trading bot");
    console.log("  node src/bot.js test-data   — Test market data + indicators (no API key needed)");
    console.log("  node src/bot.js stats       — Show trade statistics & 24h log");
    break;
}
