// Live wallet — trades directly from user's Coinbase account via Advanced Trade API
// Uses CDP API key (JWT auth) to place market orders on the exchange

const crypto = require("crypto");
const { URL } = require("url");

const API_BASE = "https://api.coinbase.com";

let apiKeyName;
let privateKey;
let currentPrices = {};

function loadCredentials() {
  if (apiKeyName && privateKey) return;
  apiKeyName = process.env.CDP_API_KEY_NAME;
  const rawKey = process.env.CDP_API_KEY_PRIVATE_KEY;
  if (!apiKeyName || !rawKey) {
    throw new Error("Missing CDP_API_KEY_NAME or CDP_API_KEY_PRIVATE_KEY env vars");
  }
  privateKey = rawKey.replace(/\\n/g, "\n");
}

function buildJwt(method, path) {
  loadCredentials();

  const now = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(16).toString("hex");
  // Strip query params from URI for JWT signing (Coinbase requires path only)
  const pathOnly = path.split("?")[0];
  const uri = `${method.toUpperCase()} api.coinbase.com${pathOnly}`;

  const header = { alg: "ES256", kid: apiKeyName, nonce, typ: "JWT" };
  const payload = {
    sub: apiKeyName,
    iss: "coinbase-cloud",
    aud: ["retail_rest_api_proxy"],
    nbf: now,
    exp: now + 120,
    uri,
  };

  const b64url = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const signingInput = `${b64url(header)}.${b64url(payload)}`;

  const sign = crypto.createSign("SHA256");
  sign.update(signingInput);
  const sig = sign
    .sign({ key: privateKey, dsaEncoding: "ieee-p1363" })
    .toString("base64url");

  return `${signingInput}.${sig}`;
}

async function cbFetch(method, path, body = null) {
  const jwt = buildJwt(method, path);
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, opts);
  const text = await res.text();
  if (!res.ok) {
    console.error(`Coinbase API error — ${res.status} ${method} ${path}: ${text.substring(0, 200)}`);
    throw new Error(`Coinbase API ${res.status}: ${text.substring(0, 200)}`);
  }
  return JSON.parse(text);
}

// --- Interface methods (matches paper-wallet.js) ---

async function initCoinbase() {
  loadCredentials();
  // Verify credentials by listing accounts
  const data = await cbFetch("GET", "/api/v3/brokerage/accounts?limit=1");
  console.log("Coinbase Advanced Trade API connected — trading from your account");
  return true;
}

async function getOrCreateWallet() {
  // No wallet to create — we trade from the user's existing account
  return { id: "coinbase-exchange" };
}

function updatePrices(prices) {
  currentPrices = prices;
}

async function getBalance(assetId = "usdc") {
  const balances = await getBalances();
  return balances[assetId.toLowerCase()] || 0;
}

async function getBalances() {
  const result = {};
  let cursor = null;

  // Paginate through accounts
  do {
    const qs = cursor
      ? `/api/v3/brokerage/accounts?limit=50&cursor=${cursor}`
      : "/api/v3/brokerage/accounts?limit=50";
    const data = await cbFetch("GET", qs);

    for (const acct of data.accounts || []) {
      const bal = parseFloat(acct.available_balance?.value || "0");
      if (bal > 0) {
        result[acct.currency.toLowerCase()] = bal;
      }
    }
    cursor = data.cursor || null;
  } while (cursor);

  return result;
}

async function executeTrade(action, assetId, amountUsd) {
  const token = assetId.toLowerCase();
  const productId = `${token.toUpperCase()}-USD`;

  // Validate the product exists
  try {
    await cbFetch("GET", `/api/v3/brokerage/products/${productId}`);
  } catch (err) {
    // Try USDC pair as fallback
    const usdcProductId = `${token.toUpperCase()}-USDC`;
    try {
      await cbFetch("GET", `/api/v3/brokerage/products/${usdcProductId}`);
      return await executeOrder(action, usdcProductId, token, amountUsd);
    } catch {
      console.error(`No trading pair found for ${token} (tried ${productId} and ${usdcProductId})`);
      return null;
    }
  }

  return await executeOrder(action, productId, token, amountUsd);
}

// Cache product info (base_increment) to avoid repeated lookups
const productInfoCache = {};

async function getProductPrecision(productId) {
  if (productInfoCache[productId]) return productInfoCache[productId];
  try {
    const info = await cbFetch("GET", `/api/v3/brokerage/products/${productId}`);
    const increment = parseFloat(info.base_increment || "0.000001");
    const minSize = parseFloat(info.base_min_size || "0.000001");
    // Calculate decimal places from increment (e.g., 0.001 = 3 decimals, 1 = 0 decimals)
    const decimals = increment >= 1 ? 0 : Math.max(0, -Math.floor(Math.log10(increment)));
    productInfoCache[productId] = { decimals, minSize, increment };
    return productInfoCache[productId];
  } catch {
    return { decimals: 6, minSize: 0.000001, increment: 0.000001 };
  }
}

function truncateToIncrement(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.floor(value * factor) / factor;
}

async function executeOrder(action, productId, token, amountUsd) {
  const clientOrderId = `vt-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const { decimals, minSize } = await getProductPrecision(productId);

  let orderConfig;
  if (action === "buy") {
    orderConfig = {
      market_market_ioc: {
        quote_size: amountUsd.toFixed(2),
      },
    };
  } else if (action === "sell") {
    if (amountUsd === null || amountUsd === undefined) {
      // Sell entire balance
      const bal = await getBalance(token);
      if (bal <= 0) { console.log(`[LIVE] No ${token} to sell`); return null; }
      const truncated = truncateToIncrement(bal, decimals);
      if (truncated < minSize) { console.log(`[LIVE] ${token} balance (${truncated}) below minimum (${minSize})`); return null; }
      orderConfig = { market_market_ioc: { base_size: truncated.toString() } };
      console.log(`[LIVE] SELL ALL ${token.toUpperCase()} — ${truncated} tokens (${decimals} decimals)`);
    } else {
      const price = currentPrices[token];
      if (!price || price <= 0) {
        console.error(`[LIVE] No price for ${token}, cannot calculate sell size`);
        return null;
      }
      const baseSize = truncateToIncrement(amountUsd / price, decimals);
      if (baseSize < minSize) { console.log(`[LIVE] ${token} sell amount below minimum`); return null; }
      orderConfig = { market_market_ioc: { base_size: baseSize.toString() } };
    }
  } else {
    console.log("[LIVE] Holding — no trade executed.");
    return null;
  }

  const order = {
    client_order_id: clientOrderId,
    product_id: productId,
    side: action.toUpperCase(),
    order_configuration: orderConfig,
  };

  console.log(`[LIVE] ${action.toUpperCase()} ${token} — $${amountUsd} on ${productId}...`);

  try {
    const result = await cbFetch("POST", "/api/v3/brokerage/orders", order);

    if (result.success) {
      const orderId = result.order_id || result.success_response?.order_id;
      console.log(`[LIVE] Order placed: ${orderId}`);
      // Return compatible interface
      return {
        getTransaction: () => ({
          getTransactionHash: () => orderId || clientOrderId,
        }),
      };
    } else {
      const errMsg = result.error_response?.message || result.failure_reason || JSON.stringify(result);
      console.error(`[LIVE] Order failed: ${errMsg}`);
      return null;
    }
  } catch (err) {
    console.error(`[LIVE] Trade error: ${err.message}`);
    return null;
  }
}

async function getWalletAddress() {
  return "coinbase-exchange-account";
}

function getPortfolioValue() {
  // Not used in live mode — the bot reads balances directly
  return null;
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
