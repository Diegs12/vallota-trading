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
const { evaluateRules } = require("./rule-engine");

const BOT_INSTANCE_ID = process.env.BOT_INSTANCE_ID || "primary";
const { initBenchmark, getBenchmarkReturns } = require("./benchmark");

// Always run paper wallet for data collection
const paperWallet = require("./paper-wallet");

// Also run live wallet if enabled
const LIVE_ENABLED = process.env.TRADING_MODE === "live" && process.env.LIVE_TRADING_ENABLED === "true";
let liveWallet = null;
if (LIVE_ENABLED) {
  liveWallet = require("./wallet");
}

// Primary wallet for bot decisions (paper for analysis, live executes alongside)
const PAPER_MODE = !LIVE_ENABLED; // For backward compat in logs/dashboard
const LIVE_TRADING_ENABLED = LIVE_ENABLED;
const walletModule = paperWallet;
const { getBalances, executeTrade, getWalletAddress } = paperWallet;

const INTERVAL = parseInt(process.env.ANALYSIS_INTERVAL_MS || "300000", 10); // default 5m
const RISK_PROFILE = process.env.RISK_PROFILE || "moderate";
const PER_TRADE_RISK_PCT = parseFloat(process.env.PER_TRADE_RISK_PCT || "5");
const DAILY_MAX_DRAWDOWN_PCT = parseFloat(process.env.DAILY_MAX_DRAWDOWN_PCT || "15");
const MIN_TRADE_USD = parseFloat(process.env.MIN_TRADE_USD || "10");
const ESTIMATED_ROUND_TRIP_COST_BPS = parseFloat(process.env.ESTIMATED_ROUND_TRIP_COST_BPS || "30");
const MIN_NET_EDGE_BPS = parseFloat(process.env.MIN_NET_EDGE_BPS || "5");
const MIN_CONFIDENCE_WITHOUT_EDGE = parseInt(process.env.MIN_CONFIDENCE_WITHOUT_EDGE || "50", 10);
const COST_CLAUDE_ANALYSIS_USD = parseFloat(process.env.COST_CLAUDE_ANALYSIS_USD || "0.005");
const COST_CLAUDE_REVIEW_USD = parseFloat(process.env.COST_CLAUDE_REVIEW_USD || "0.006");
const COST_GROK_RESEARCH_USD = parseFloat(process.env.COST_GROK_RESEARCH_USD || "0.00012");
const COST_GROK_DERIVATIVES_USD = parseFloat(process.env.COST_GROK_DERIVATIVES_USD || "0.00012");

let cycleCount = 0;
let dayAnchor = null;
let dayStartPortfolioUsd = null;
let aiCallsMade = 0;
let aiCallsSkipped = 0;
let livePortfolioUsd = 0;

// Mirror a trade to the live wallet, scaling amount proportionally
async function mirrorToLive(action, token, paperAmountUsd, paperPortfolioUsd) {
  if (!liveWallet) return;
  try {
    // Scale proportionally: if paper trades 5% of portfolio, live trades 5% too
    const pct = paperPortfolioUsd > 0 ? paperAmountUsd / paperPortfolioUsd : 0;
    const liveAmount = Math.max(1, Math.round(pct * livePortfolioUsd * 100) / 100);
    if (liveAmount < 1) return; // Skip tiny trades
    console.log(`  [LIVE MIRROR] ${action} ${token} $${liveAmount} (${(pct * 100).toFixed(1)}% of live portfolio)`);
    await liveWallet.executeTrade(action, token, liveAmount);
  } catch (err) {
    console.warn(`  [LIVE MIRROR] Failed: ${err.message}`);
  }
}

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
    `Cycle #${cycleCount} | ${cycleStart.toISOString()} | PAPER${LIVE_ENABLED ? " + LIVE" : ""} MODE`
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

    // 3. Update wallet prices for both paper and live
    const priceMap = {};
    (marketData.prices || []).forEach((t) => {
      priceMap[t.symbol.toLowerCase()] = t.current_price;
    });
    paperWallet.updatePrices(priceMap);
    if (liveWallet && liveWallet.updatePrices) {
      liveWallet.updatePrices(priceMap);
    }

    // 3b. Initialize benchmark on first cycle
    if (cycleCount === 1) {
      initBenchmark(priceMap);
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
    const pv = paperWallet.getPortfolioValue();
    console.log(
      `Paper Portfolio: $${pv.totalValue.toLocaleString()} | P&L: $${pv.pnl.toLocaleString()} (${pv.pnlPercent}%)`
    );
    portfolio.portfolioValue = pv;
    portfolioUsd = pv.totalValue || 0;

    // Track live wallet alongside paper
    let livePortfolioData = null;
    if (liveWallet) {
      try {
        const liveBalances = await liveWallet.getBalances();
        livePortfolioUsd = estimatePortfolioUsd(
          liveBalances,
          Object.fromEntries((marketData.prices || []).map((t) => [t.symbol.toLowerCase(), t.current_price]))
        );
        livePortfolioData = { balances: liveBalances, totalValueUsd: Math.round(livePortfolioUsd * 100) / 100 };
        console.log(`Live Portfolio: $${livePortfolioUsd.toFixed(2)}`);
      } catch (err) {
        console.warn(`Live wallet read failed: ${err.message}`);
      }
    }

    // Get benchmark returns
    const benchmarkReturns = getBenchmarkReturns(priceMap);

    updateLiveState({
      portfolio: pv,
      livePortfolio: livePortfolioData,
      benchmark: benchmarkReturns,
    });

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
    // Smart-skip saves money: only call Claude when market changes or on interval
    if (aiCallPolicy.call) {
      const reason = aiCallPolicy.reason;
      console.log(`Analyzing with Claude... (${reason})`);
      const out = await safeAnalyze(analyzeMarket, marketData, portfolio, RISK_PROFILE);
      decision = out.decision;
      failsafe = out.failsafe;
      aiMeta = out.meta || aiMeta;
      aiCallsMade++;
      if (aiMeta.apiSuccess) {
        addCostEvent("claude_analysis", COST_CLAUDE_ANALYSIS_USD, { reason });
      }
    } else {
      aiCallsSkipped++;

      // Rule-based trading: use computed indicators to trade without API call
      const ruleTrades = evaluateRules({
        timeframeSummary,
        marketData,
        balances,
        currentPrices,
        portfolioUsd,
      });

      if (ruleTrades.length > 0) {
        console.log(`Rule engine found ${ruleTrades.length} trade(s) (no API cost):`);
        for (const rt of ruleTrades) {
          console.log(`  ${rt.rule}: ${rt.action} ${rt.token} $${rt.amount_usd} (${rt.confidence}%)`);
          const trade = await executeTrade(rt.action, rt.token, rt.amount_usd);
          if (trade) {
            if (rt.action === "buy") {
              const price = currentPrices[rt.token] || rt.amount_usd;
              recordEntry(rt.token, price, rt.amount_usd);
            } else if (rt.action === "sell") {
              clearPosition(rt.token);
            }
            // Mirror to live wallet
            await mirrorToLive(rt.action, rt.token, rt.amount_usd, portfolioUsd);
          }
          logTrade({
            timestamp: cycleStart.toISOString(),
            cycle: cycleCount,
            ...rt,
            executed: !!trade,
            mode: PAPER_MODE ? "paper" : "live",
            source: "rule_engine",
          });
        }
        // Use first rule trade as the "decision" for dashboard display
        decision = { ...ruleTrades[0], market_summary: `Rule engine: ${ruleTrades.length} trade(s)`, risk_notes: "Automated rule-based trade (zero API cost)" };
      } else {
        decision = {
          action: "hold",
          token: "usdc",
          amount_usd: null,
          confidence: 45,
          reasoning: `SMART-SKIP: No material market change, no rule triggers (${aiCallPolicy.reason})`,
          market_summary: "State unchanged, no rule-based signals fired",
          risk_notes: "Capital preserved; force-analysis window still active.",
          timeframe_alignment: "unchanged",
          expected_edge_pct: 0,
        };
      }
      console.log(`Skipping Claude call (${aiCallPolicy.reason})${ruleTrades.length > 0 ? ` — but executed ${ruleTrades.length} rule trade(s)` : ""}`);
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
    // Dynamic token list: any token with price data is tradable
    const knownTokens = new Set(
      (marketData.prices || []).map((t) => t.symbol?.toLowerCase()).filter(Boolean)
    );
    // Always allow core Base L2 tokens
    ["eth", "usdc", "aero", "brett", "degen", "toshi", "well", "virtual", "morpho", "cbbtc",
     "pepe", "bonk", "wif", "floki", "shib", "sui", "apt", "tia", "sei", "inj",
     "link", "uni", "aave", "rndr", "arb", "op", "pol", "jup", "ondo", "ena", "pendle"
    ].forEach((t) => knownTokens.add(t));

    const validAction = ALLOWED_ACTIONS.includes(decision.action);
    const validToken = !decision.token || knownTokens.has(decision.token?.toLowerCase());
    const validConfidence = typeof decision.confidence === "number" &&
      decision.confidence >= 0 && decision.confidence <= 100 &&
      Number.isFinite(decision.confidence);
    const validAmount = decision.amount_usd === null ||
      decision.amount_usd === undefined ||
      (typeof decision.amount_usd === "number" &&
        decision.amount_usd > 0 &&
        Number.isFinite(decision.amount_usd) &&
        decision.amount_usd <= portfolioUsd * 0.5); // max 50% of portfolio per trade

    if (!validAction || !validToken || !validConfidence || !validAmount) {
      console.warn("\n*** BLOCKED: Invalid trade parameters from AI ***");
      if (!validAction) console.warn(`  Bad action: ${decision.action}`);
      if (!validToken) console.warn(`  Bad token: ${decision.token}`);
      if (!validConfidence) console.warn(`  Bad confidence: ${decision.confidence}`);
      if (!validAmount) console.warn(`  Bad amount: ${decision.amount_usd}`);
      decision.action = "hold";
      decision.reasoning = "BLOCKED — invalid parameters: " + decision.reasoning;
    }

    // In data-collection mode: no risk caps, no edge filters, no daily kill-switch.
    // Let Claude make whatever trade it wants. We learn from everything.

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

        // Mirror to live wallet (proportionally scaled)
        await mirrorToLive(decision.action, decision.token, decision.amount_usd, portfolioUsd);
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
      source: "claude",
    });

    // 8b. Execute additional trades from Claude (multi-trade per call)
    const additionalTrades = decision.additional_trades || [];
    if (additionalTrades.length > 0) {
      console.log(`\nExecuting ${additionalTrades.length} additional trade(s):`);
      for (const at of additionalTrades) {
        if (!at.action || !at.token || at.action === "hold") continue;
        const atToken = at.token?.toLowerCase();
        if (!knownTokens.has(atToken)) continue;
        if (typeof at.amount_usd !== "number" || at.amount_usd <= 0) continue;

        console.log(`  ${at.action} ${atToken} $${at.amount_usd} (${at.confidence}%)`);
        const atTrade = await executeTrade(at.action, atToken, at.amount_usd);
        if (atTrade) {
          if (at.action === "buy") {
            recordEntry(atToken, currentPrices[atToken] || at.amount_usd, at.amount_usd);
          } else if (at.action === "sell") {
            clearPosition(atToken);
          }
          // Mirror to live wallet
          await mirrorToLive(at.action, atToken, at.amount_usd, portfolioUsd);
        }
        logTrade({
          timestamp: cycleStart.toISOString(),
          cycle: cycleCount,
          action: at.action,
          token: atToken,
          amount_usd: at.amount_usd,
          confidence: at.confidence || 50,
          reasoning: at.reasoning || "Additional trade from Claude",
          executed: !!atTrade,
          mode: PAPER_MODE ? "paper" : "live",
          source: "claude_additional",
        });
      }
    }

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
    // Build error/warning list for dashboard
    const errors = [];
    const warnings = [];
    if (!aiMeta.apiSuccess && aiCallPolicy.call) {
      errors.push({ type: "claude_api", message: "Claude API call failed — check credits or API key", at: cycleStart.toISOString() });
    }
    if (failsafe) {
      errors.push({ type: "failsafe", message: "FAILSAFE ACTIVE — Claude API unreachable, protecting capital", at: cycleStart.toISOString() });
    }
    if (!marketData.prices || marketData.prices.length === 0) {
      warnings.push({ type: "market_data", message: "CoinGecko rate limited — using cached prices", at: cycleStart.toISOString() });
    }
    if (dailyRiskLocked) {
      warnings.push({ type: "drawdown", message: `Daily drawdown lock active (${dailyDrawdownPct.toFixed(1)}%)`, at: cycleStart.toISOString() });
    }

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
      errors,
      warnings,
      failsafeActive: failsafe,
    });

    const elapsed = Date.now() - cycleStart.getTime();
    console.log(`\nCycle #${cycleCount} complete in ${(elapsed / 1000).toFixed(1)}s`);
  } catch (err) {
    console.error("Cycle error:", err.message);
    console.error(err.stack);
    updateLiveState({
      errors: [{ type: "cycle_crash", message: err.message, at: new Date().toISOString() }],
    });
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
  ║  Paper:    $${(process.env.TRADING_CAPITAL_USD || "1000").padEnd(29)}║
  ║  Live:     ${(LIVE_ENABLED ? "CONNECTED" : "OFF").padEnd(30)}║
  ║  Risk:     ${RISK_PROFILE.padEnd(30)}║
  ║  Interval: ${(INTERVAL / 1000 + "s").padEnd(30)}║
  ╠═══════════════════════════════════════════╣
  ║  Features:                                ║
  ║  ✓ Dual wallet (paper + live)             ║
  ║  ✓ Market benchmark tracking              ║
  ║  ✓ Computed TA (RSI, MACD, Bollinger)     ║
  ║  ✓ Multi-timeframe (5m, 1h, 4h, 1d)      ║
  ║  ✓ Hard stop-losses                       ║
  ║  ✓ Self-review & learning loop            ║
  ╚═══════════════════════════════════════════╝
  `);

  if (LIVE_ENABLED) {
    console.log("DUAL MODE: Paper ($" + (process.env.TRADING_CAPITAL_USD || "1000") + ") + Live (Coinbase account)");
    console.log("Every trade executes on both wallets (live scaled proportionally).\n");
    try {
      await liveWallet.initCoinbase();
    } catch (err) {
      console.error("Failed to connect live wallet:", err.message);
      console.warn("Continuing with paper-only mode.\n");
    }
  } else {
    console.log("PAPER MODE: $" + (process.env.TRADING_CAPITAL_USD || "1000") + " simulated capital.\n");
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
