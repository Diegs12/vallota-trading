// Paper trading wallet — simulates trades without real money
// Mirrors the wallet.js interface so the bot can't tell the difference

const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "..", "data", "paper-portfolio.json");

// Current market prices (updated each cycle)
let currentPrices = {};

function loadState() {
  const targetCapital = parseFloat(process.env.TRADING_CAPITAL_USD) || 1000;

  if (fs.existsSync(STATE_FILE)) {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));

    // Capital injection: if TRADING_CAPITAL_USD increased, deposit the difference
    if (targetCapital > state.startingCapital) {
      const injection = targetCapital - state.startingCapital;
      state.balances.usdc = (state.balances.usdc || 0) + injection;
      state.startingCapital = targetCapital;
      state.tradeHistory.push({
        action: "deposit",
        token: "usdc",
        usdAmount: injection,
        tokenAmount: injection,
        price: 1,
        timestamp: new Date().toISOString(),
        note: `Capital injection: $${state.startingCapital - injection} -> $${targetCapital}`,
      });
      saveState(state);
      console.log(`[PAPER] Capital injection: +$${injection.toLocaleString()} USDC (new total capital: $${targetCapital.toLocaleString()})`);
    }

    return state;
  }

  const initial = {
    balances: { usdc: targetCapital },
    tradeHistory: [],
    startingCapital: targetCapital,
    createdAt: new Date().toISOString(),
  };
  saveState(initial);
  return initial;
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function updatePrices(prices) {
  // prices: { eth: 1949.09, btc: 67025, ... }
  currentPrices = prices;
}

function getPrice(token) {
  const t = token.toLowerCase();
  if (t === "usdc" || t === "usd") return 1;
  return currentPrices[t] || null;
}

async function initCoinbase() {
  console.log("[PAPER MODE] Simulated Coinbase initialized");
}

async function getOrCreateWallet() {
  console.log("[PAPER MODE] Using paper wallet");
  return { id: "paper-wallet" };
}

async function getBalance(assetId = "usdc") {
  const state = loadState();
  return state.balances[assetId.toLowerCase()] || 0;
}

async function getBalances() {
  const state = loadState();
  // Only return non-zero balances
  const result = {};
  for (const [asset, amount] of Object.entries(state.balances)) {
    if (amount > 0) {
      result[asset] = amount;
    }
  }
  return result;
}

async function executeTrade(action, assetId, amountUsd) {
  const state = loadState();
  const token = assetId.toLowerCase();
  const price = getPrice(token);

  if (!price && token !== "usdc") {
    console.error(`[PAPER] No price data for ${token}, cannot simulate trade`);
    return null;
  }

  if (action === "buy") {
    const usdcBalance = state.balances.usdc || 0;
    const spendAmount = Math.min(amountUsd, usdcBalance);

    if (spendAmount <= 0) {
      console.log(`[PAPER] Insufficient USDC to buy ${token}`);
      return null;
    }

    const tokenAmount = spendAmount / price;
    state.balances.usdc = (state.balances.usdc || 0) - spendAmount;
    if (state.balances.usdc <= 0.000001) state.balances.usdc = 0;
    state.balances[token] = (state.balances[token] || 0) + tokenAmount;

    const trade = {
      action: "buy",
      token,
      usdAmount: round(spendAmount),
      tokenAmount: round(tokenAmount),
      price: round(price),
      timestamp: new Date().toISOString(),
    };
    state.tradeHistory.push(trade);
    saveState(state);

    console.log(
      `[PAPER] Bought ${round(tokenAmount)} ${token.toUpperCase()} @ $${round(price)} ($${round(spendAmount)})`
    );
    return { getTransaction: () => ({ getTransactionHash: () => `paper-${Date.now()}` }) };
  }

  if (action === "sell") {
    const tokenBalance = state.balances[token] || 0;
    // amountUsd here means "sell this much USD worth" or sell all if amount > holdings
    const tokenAmountToSell = amountUsd
      ? Math.min(amountUsd / price, tokenBalance)
      : tokenBalance;

    if (tokenAmountToSell <= 0) {
      console.log(`[PAPER] No ${token.toUpperCase()} to sell`);
      return null;
    }

    const usdReceived = tokenAmountToSell * price;
    state.balances[token] = (state.balances[token] || 0) - tokenAmountToSell;
    state.balances.usdc = (state.balances.usdc || 0) + usdReceived;

    // Clean up zero balances
    if (state.balances[token] <= 0.000001) {
      delete state.balances[token];
    }

    const trade = {
      action: "sell",
      token,
      usdAmount: round(usdReceived),
      tokenAmount: round(tokenAmountToSell),
      price: round(price),
      timestamp: new Date().toISOString(),
    };
    state.tradeHistory.push(trade);
    saveState(state);

    console.log(
      `[PAPER] Sold ${round(tokenAmountToSell)} ${token.toUpperCase()} @ $${round(price)} ($${round(usdReceived)})`
    );
    return { getTransaction: () => ({ getTransactionHash: () => `paper-${Date.now()}` }) };
  }

  console.log("[PAPER] Holding — no trade executed.");
  return null;
}

async function getWalletAddress() {
  return "0xPAPER_WALLET_SIMULATION";
}

function getPortfolioValue() {
  const state = loadState();
  let total = 0;
  for (const [token, amount] of Object.entries(state.balances)) {
    const price = getPrice(token);
    if (price) {
      total += amount * price;
    }
  }
  return {
    totalValue: round(total),
    startingCapital: state.startingCapital,
    pnl: round(total - state.startingCapital),
    pnlPercent: round(((total - state.startingCapital) / state.startingCapital) * 100),
    balances: state.balances,
  };
}

function round(n) {
  return Math.round(n * 10000) / 10000;
}

module.exports = {
  initCoinbase,
  getOrCreateWallet,
  getBalance,
  getBalances,
  executeTrade,
  getWalletAddress,
  updatePrices,
  getPortfolioValue,
};
