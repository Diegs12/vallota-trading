// Quick smoke tests for all modules
const { computeAll, rsi, macd, bollingerBands } = require("../src/indicators");
const { logTrade, getTradeStats, getTradesLast24h } = require("../src/trade-log");
const { recordEntry, checkStopLoss, clearPosition } = require("../src/stop-loss");

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}`);
    failed++;
  }
}

// ---- Indicators ----
console.log("\n--- Technical Indicators ---");

// Generate sample price data (uptrend)
const sampleUp = [];
for (let i = 0; i < 60; i++) {
  sampleUp.push(100 + i * 0.5 + Math.sin(i * 0.3) * 3);
}

const taUp = computeAll(sampleUp);
assert(taUp.rsi !== null, "RSI computed");
assert(taUp.rsi > 50, `RSI in uptrend is > 50 (got ${taUp.rsi})`);
assert(taUp.macd !== null, "MACD computed");
assert(taUp.macd.macd > 0, `MACD line positive in uptrend (got ${taUp.macd.macd})`);
assert(taUp.bollingerBands !== null, "Bollinger Bands computed");
assert(taUp.trendSignal === "bullish", `Trend is bullish in uptrend (got ${taUp.trendSignal})`);

// Generate sample price data (downtrend)
const sampleDown = [];
for (let i = 0; i < 60; i++) {
  sampleDown.push(200 - i * 0.8 + Math.sin(i * 0.3) * 2);
}

const taDown = computeAll(sampleDown);
assert(taDown.rsi < 50, `RSI in downtrend is < 50 (got ${taDown.rsi})`);
assert(taDown.macd.histogram < 0, `MACD histogram negative in downtrend (got ${taDown.macd.histogram})`);
assert(taDown.trendSignal === "bearish", `Trend is bearish in downtrend (got ${taDown.trendSignal})`);

// Edge case: not enough data
const taShort = computeAll([1, 2, 3]);
assert(taShort.error, "Returns error for insufficient data");

// ---- Paper Wallet ----
console.log("\n--- Paper Wallet ---");

// Clean state for testing
const fs = require("fs");
const path = require("path");
const dataDir = path.join(__dirname, "..", "data");
const paperFile = path.join(dataDir, "paper-portfolio.json");
const tradesFile = path.join(dataDir, "trades.json");
if (fs.existsSync(paperFile)) fs.unlinkSync(paperFile);
if (fs.existsSync(tradesFile)) fs.unlinkSync(tradesFile);

// Set env for paper wallet
process.env.TRADING_CAPITAL_USD = "1000";
const paperWallet = require("../src/paper-wallet");

paperWallet.updatePrices({ eth: 2000, sol: 80 });

async function testPaperWallet() {
  const balances1 = await paperWallet.getBalances();
  assert(balances1.usdc === 1000, `Starting capital is $1000 (got ${balances1.usdc})`);

  // Buy ETH
  await paperWallet.executeTrade("buy", "eth", 200);
  const balances2 = await paperWallet.getBalances();
  assert(balances2.usdc === 800, `After buying $200 ETH, USDC is $800 (got ${balances2.usdc})`);
  assert(balances2.eth === 0.1, `Bought 0.1 ETH at $2000 (got ${balances2.eth})`);

  // Price goes up
  paperWallet.updatePrices({ eth: 2200, sol: 80 });
  const pv = paperWallet.getPortfolioValue();
  assert(pv.totalValue === 1020, `Portfolio value after ETH +10%: $1020 (got ${pv.totalValue})`);
  assert(pv.pnl === 20, `P&L is $20 (got ${pv.pnl})`);

  // Sell ETH
  await paperWallet.executeTrade("sell", "eth", null);
  const balances3 = await paperWallet.getBalances();
  assert(balances3.usdc === 1020, `After selling ETH at $2200, USDC is $1020 (got ${balances3.usdc})`);
  assert(!balances3.eth, "No ETH remaining");

  // Can't buy more than we have
  await paperWallet.executeTrade("buy", "sol", 5000);
  const balances4 = await paperWallet.getBalances();
  assert(!balances4.usdc, `Spent all USDC (got ${balances4.usdc})`);
  assert(balances4.sol > 0, `Got some SOL (got ${balances4.sol})`);
}

// ---- Stop-Loss ----
console.log("\n--- Stop-Loss ---");

recordEntry("eth", 2000, 200);

const check1 = checkStopLoss("eth", 1950, "moderate"); // 2.5% down
assert(!check1.triggered, "2.5% drawdown does not trigger moderate stop (7%)");

const check2 = checkStopLoss("eth", 1800, "moderate"); // 10% down
assert(check2.triggered, "10% drawdown triggers moderate stop (7%)");
assert(check2.drawdownFromEntry === 10, `Reports 10% drawdown (got ${check2.drawdownFromEntry})`);

clearPosition("eth");
recordEntry("sol", 100, 100);
const check3 = checkStopLoss("sol", 96, "conservative"); // 4% down
assert(check3.triggered, "4% drawdown triggers conservative stop (3%)");

clearPosition("sol");

// ---- Trade Log ----
console.log("\n--- Trade Log ---");

logTrade({
  timestamp: new Date().toISOString(),
  action: "buy",
  token: "eth",
  amount_usd: 200,
  confidence: 75,
  reasoning: "Test trade",
  executed: true,
  mode: "paper",
});

const stats = getTradeStats();
assert(stats.totalDecisions >= 1, `Has at least 1 trade logged (got ${stats.totalDecisions})`);

const recent = getTradesLast24h();
assert(recent.length >= 1, `24h trades include our test (got ${recent.length})`);

// ---- Run async tests ----
testPaperWallet()
  .then(() => {
    console.log(`\n${"=".repeat(40)}`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log(`${"=".repeat(40)}`);
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error("Test error:", err);
    process.exit(1);
  });
