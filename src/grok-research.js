// Grok Research Module — pulls real-time crypto intelligence from xAI
// Grok has access to X/Twitter data, giving us sentiment + breaking news

const XAI_API_URL = "https://api.x.ai/v1/chat/completions";

async function queryGrok(prompt, model = "grok-3-mini-fast") {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    console.warn("Grok: No XAI_API_KEY set, skipping research");
    return null;
  }

  const res = await fetch(XAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a crypto market research analyst. Provide concise, data-driven insights. Always respond with valid JSON. Focus on actionable intelligence, not general commentary.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.warn(`Grok API error (${res.status}):`, err.substring(0, 200));
    return null;
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) return null;

  // Try to parse JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return { raw: text };
    }
  }
  return { raw: text };
}

async function getCryptoSentiment() {
  return queryGrok(`Analyze the current crypto market sentiment on X/Twitter right now.

Look at:
1. What are people saying about BTC, ETH, SOL in the last few hours?
2. Any whale activity being discussed?
3. Any breaking news affecting crypto markets?
4. Overall mood: is crypto Twitter bullish, bearish, or fearful?
5. Any trending tokens or narratives?

Respond with JSON:
{
  "overall_sentiment": "bullish" | "bearish" | "neutral" | "fearful",
  "sentiment_score": -100 to 100,
  "btc_sentiment": "brief summary",
  "eth_sentiment": "brief summary",
  "sol_sentiment": "brief summary",
  "whale_activity": "any notable whale moves discussed",
  "breaking_news": ["headline 1", "headline 2"],
  "trending_narratives": ["narrative 1", "narrative 2"],
  "key_tweets": ["summary of impactful tweet 1", "summary 2"],
  "risk_alerts": ["any warnings or red flags"]
}`);
}

async function getTokenResearch(token) {
  return queryGrok(`Research the token ${token.toUpperCase()} right now.

What's being said on X/Twitter about ${token.toUpperCase()} in the last few hours?
Any upcoming catalysts, partnerships, or developments?
Any concerns or FUD circulating?

Respond with JSON:
{
  "token": "${token}",
  "sentiment": "bullish" | "bearish" | "neutral",
  "recent_developments": ["dev 1", "dev 2"],
  "upcoming_catalysts": ["catalyst 1"],
  "concerns": ["concern 1"],
  "notable_mentions": ["key tweet or post summary"]
}`);
}

async function getRegulatoryScan() {
  return queryGrok(`Scan for any crypto regulatory news or developments in the last 24 hours.

Check for:
- SEC actions or statements
- Any country banning or adopting crypto
- Stablecoin regulation updates
- DeFi regulatory developments
- Any enforcement actions

Respond with JSON:
{
  "regulatory_risk_level": "low" | "medium" | "high",
  "developments": ["development 1", "development 2"],
  "impact_assessment": "brief summary of how this affects trading"
}`);
}

async function getFullResearch() {
  console.log("Grok: Fetching real-time crypto intelligence...");

  const results = await Promise.allSettled([
    getCryptoSentiment(),
    getRegulatoryScan(),
  ]);

  const [sentiment, regulatory] = results.map((r) =>
    r.status === "fulfilled" ? r.value : null
  );

  // Log any failures
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const names = ["sentiment", "regulatory"];
      console.warn(`Grok ${names[i]} research failed:`, r.reason?.message);
    }
  });

  const research = {
    timestamp: new Date().toISOString(),
    sentiment,
    regulatory,
  };

  if (sentiment) {
    console.log(
      `Grok: Sentiment=${sentiment.overall_sentiment || "?"} (${sentiment.sentiment_score || "?"}/100)`,
      sentiment.breaking_news?.length
        ? `| Breaking: ${sentiment.breaking_news[0]}`
        : ""
    );
  }

  return research;
}

module.exports = { getFullResearch, getCryptoSentiment, getTokenResearch, getRegulatoryScan };
