const { Coinbase, Wallet } = require("@coinbase/coinbase-sdk");
const fs = require("fs");
const path = require("path");

const WALLET_FILE = path.join(__dirname, "..", "wallet-seed.json");

let coinbase;
let wallet;

async function initCoinbase() {
  if (coinbase) return coinbase;

  coinbase = Coinbase.configureFromJson({
    filePath: path.join(__dirname, "..", "cdp_api_key.json"),
  });

  console.log("Coinbase CDP initialized");
  return coinbase;
}

async function getOrCreateWallet() {
  if (wallet) return wallet;

  await initCoinbase();

  // Try to load existing wallet
  if (fs.existsSync(WALLET_FILE)) {
    const seedData = JSON.parse(fs.readFileSync(WALLET_FILE, "utf-8"));
    wallet = await Wallet.import(seedData);
    console.log("Loaded existing wallet:", wallet.getDefaultAddress()?.getId());
    return wallet;
  }

  // Create new wallet on Base network
  wallet = await Wallet.create({ networkId: Coinbase.networks.BaseMainnet });

  // Save seed for recovery
  const seedData = wallet.export();
  fs.writeFileSync(WALLET_FILE, JSON.stringify(seedData, null, 2));
  console.log("Created new wallet:", wallet.getDefaultAddress()?.getId());
  console.log("IMPORTANT: Fund this wallet with USDC on Base to start trading");

  return wallet;
}

async function getBalance(assetId = "usdc") {
  const w = await getOrCreateWallet();
  const balance = await w.getBalance(assetId);
  return parseFloat(balance.toString());
}

async function getBalances() {
  const w = await getOrCreateWallet();
  const balances = await w.listBalances();
  const result = {};
  for (const [asset, amount] of balances) {
    result[asset] = parseFloat(amount.toString());
  }
  return result;
}

async function executeTrade(action, assetId, amount) {
  const w = await getOrCreateWallet();

  if (action === "buy") {
    // Trade USDC for the target asset
    console.log(`Buying ${amount} USDC worth of ${assetId}...`);
    const trade = await w.createTrade({
      amount: amount,
      fromAssetId: "usdc",
      toAssetId: assetId,
    });
    await trade.wait();
    console.log(`Trade complete: bought ${assetId}`, trade.getTransaction()?.getTransactionHash());
    return trade;
  }

  if (action === "sell") {
    // Trade the asset back to USDC
    console.log(`Selling ${amount} of ${assetId} for USDC...`);
    const trade = await w.createTrade({
      amount: amount,
      fromAssetId: assetId,
      toAssetId: "usdc",
    });
    await trade.wait();
    console.log(`Trade complete: sold ${assetId}`, trade.getTransaction()?.getTransactionHash());
    return trade;
  }

  console.log("Holding — no trade executed.");
  return null;
}

async function getWalletAddress() {
  const w = await getOrCreateWallet();
  const address = await w.getDefaultAddress();
  return address.getId();
}

module.exports = {
  initCoinbase,
  getOrCreateWallet,
  getBalance,
  getBalances,
  executeTrade,
  getWalletAddress,
};
