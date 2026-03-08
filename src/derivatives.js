// Derivatives data — funding rates, open interest, liquidations
// These are the signals institutional traders use
// Binance futures is geo-blocked in US, so we use Grok to get this data
// + CoinCap/alternative free sources

async function getDerivativesViaGrok() {
  // Ask Grok for current derivatives data — it has real-time access
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-3-mini-fast",
        messages: [
          {
            role: "system",
            content: "You are a crypto derivatives data analyst. Provide current data in JSON only.",
          },
          {
            role: "user",
            content: `What are the current crypto derivatives metrics? I need:
1. BTC, ETH, SOL funding rates (are longs or shorts paying?)
2. Is open interest rising or falling for BTC/ETH?
3. What's the long/short ratio — is the crowd positioned one way?
4. Any major liquidations in the last few hours?
5. Overall derivatives positioning — are traders overleveraged?

Respond with JSON:
{
  "fundingRates": [
    {"symbol": "BTC", "rate": "0.01%", "signal": "neutral|overleveraged_longs|overleveraged_shorts", "interpretation": "brief"}
  ],
  "openInterest": {"trend": "rising|falling|stable", "interpretation": "brief"},
  "longShortRatio": {"ratio": 1.2, "signal": "balanced|extreme_long|extreme_short", "interpretation": "brief"},
  "recentLiquidations": {"summary": "brief", "dominant": "longs|shorts|balanced"},
  "overall_leverage_signal": "overleveraged|underleveraged|balanced",
  "risk_assessment": "brief overall derivatives risk assessment"
}`,
          },
        ],
        temperature: 0.2,
        max_tokens: 800,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) return null;

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.warn("Derivatives via Grok failed:", err.message);
    return null;
  }
}

async function getAllDerivativesData() {
  console.log("Fetching derivatives data via Grok...");

  const data = await getDerivativesViaGrok();

  if (data) {
    console.log(`  Leverage: ${data.overall_leverage_signal || "?"}`);
    console.log(`  Risk: ${data.risk_assessment || "?"}`);
  } else {
    console.warn("  Derivatives data unavailable");
  }

  return data;
}

module.exports = { getAllDerivativesData };
