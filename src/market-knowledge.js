// Permanent market knowledge distilled from quantitative research
// Injected into Opus strategist and Haiku trader prompts
// Sources: peer-reviewed studies, backtested strategies, on-chain data (2020-2026)

function getMarketKnowledge() {
  return `
CALIBRATED MARKET KNOWLEDGE (from quantitative research, backtested data, and on-chain analysis):

=== REGIME-CONDITIONAL STRATEGY (HIGHEST PRIORITY) ===
The single most important decision is WHICH strategy to use based on current regime:
- TRENDING/BULL (price > 20 EMA, ADX > 25): Use momentum. Z-Score Momentum Sharpe ~1.0-1.2.
- RANGING/CHOPPY (flat BB, ADX < 20): Use mean reversion. BTC-neutral residual mean reversion Sharpe ~2.3.
- BEAR/CRASH: Reduce exposure or pairs trade. Cointegrated pairs Sharpe 2.24.
- Regime-switching blend: Sharpe 1.71, 56% annualized, T-stat 4.07.
CRITICAL: Meme coins are MEAN-REVERTING for illiquid tokens (t-stat = -7.31). If a meme pumps 20% today, it is MORE LIKELY to retrace tomorrow. Large/liquid coins (>$50M cap, >$5M weekly vol) show short-term MOMENTUM (t-stat = +2.33).
BTC daily autocorrelation: ACF(1) ~ -0.08 (mild mean-reverting). 55% of periods mean-revert, 35% random walk, 10% momentum.

=== FEAR & GREED INDEX CALIBRATION ===
- Extreme Fear (<20): BTC avg 7D return +4.1%, 14D +7.2%, 30D +11.8%, 90D +24.5%. Win rate: 72%.
- Fear (25-44): 7D +1.2%, 14D +2.4%, 30D +3.5%. Win rate: 58%.
- Greed (56-75): 7D -0.8%, 14D -1.5%, 30D -2.4%. Win rate: 45%.
- Extreme Greed (>80): 7D -3.5%, 14D -7.1%, 30D -14.2%. Win rate: 34%.
FAILURE MODE: Extreme fear fails during structural insolvencies (Terra/Luna, FTX) and macro shocks. If 30-day vol doubles during extreme fear, HALVE position sizes.

=== FUNDING RATE THRESHOLDS ===
- 0.01% per 8h: Balanced/neutral. 12% correction probability.
- 0.05% per 8h: Moderately bullish but crowded. 38% chance of 5%+ correction within 48h. Annualized cost at 10x leverage: 54.75%.
- 0.10% per 8h: Overheated. 64% correction probability.
- >0.15% per 8h: Extreme. 82% correction probability.
- -0.03% per 8h: Moderately bearish. 42% bounce probability.
- <-0.10%: Panic. 75% bounce probability (short squeeze).
Long/short ratio contrarian thresholds: >3.0 = fade longs. <0.5 = fade shorts. 1.0-1.8 = no edge.

=== MEME COIN LIFECYCLE TIMING ===
Sub-$1M: Peak in 2-12 hours. 50% dump in 30min-4h. 80% dump in 6-12h.
$1M-$10M: Peak in 1-3 days. 50% dump in 12-24h. 80% dump in 2-4 days.
$10M-$100M: Peak in 5-14 days. 50% dump in 3-7 days. 80% dump in 10-20 days.
$100M+: Peak in 3-6 weeks. 50% dump in 14-30 days. 80% dump in 45-90 days.
Entry timing capture rates (% of total pump captured):
- First 1 hour: 65-98% depending on tier.
- First 4 hours: 15-85%.
- First 12 hours: <5% to 75%.
- First 24 hours: Often net-negative for sub-$10M.
Only 5-8% of memes that dump 90% ever recover to ATH. "Second pumps" are conditional on >$100M initial peak + renewed narrative.
82.8% of high-performing memes show evidence of manipulation (wash trading, LPI).
Pump end signals: DEX volume drops 30% while price flat, top wallets distribute to exchanges, RSI >80 + decelerating returns.

=== OPTIMAL INDICATOR PARAMETERS FOR CRYPTO ===
RSI: Traditional 30/70 mean-reversion is "basically worthless on Bitcoin." Use RSI as MOMENTUM:
- Scalping (1m-5m): RSI(7), thresholds 80/20.
- Intraday (15m-1h): RSI(9-14), enter long on cross above 60, exit below 55.
- Trend filter: RSI(14) >50 = bullish regime.
MACD: Standard 12/26/9 is OK. Faster for scalping: 5/13/6 or 6/13/5. ALWAYS combine with trend filter.
Bollinger Bands: Use 2.5 SD (not 2.0) for crypto's fat tails. 20-period.
- Fade lower band: ~50% CAGR, in market only 34% of time (backtested BTC).
- Shorting with BB: "poor performance and capital erosion."
- BB Squeeze breakout: 40-50% win rate but 3:1+ R:R.
EMA crossovers: 9/21 for scalping, 20/50 for swing. Both outperform SMA versions.
ATR stops: BTC needs 10-15% trailing stops. 2x ATR short-term, 4x medium, 6x long-term.

=== INTRADAY SEASONALITY (UTC) ===
Peak liquidity: 13:00-20:00 UTC (EU/US overlap). Best execution quality.
Meme pump clustering: 14:00-18:00 UTC (US morning/afternoon).
Low liquidity danger: 00:00-08:00 UTC. Use smaller size, wider stops.
Monday: Positive bias (+2.1% avg), institutional catch-up from weekend.
Saturday: Negative bias (-3.4% avg, 72% probability negative).
Weekend mean returns are higher but on much thinner liquidity (16% of weekly volume).
Best months: October (+20% avg), November (high but outlier-sensitive).
Worst month: September (-5% avg).

=== CEX LISTING DYNAMICS ===
Binance Day 1: +41% avg. BUT 98% of tokens dump afterward, losing 70% of value.
Coinbase: +41% pump, 89% dump, -28% decline (mildest of major CEXs).
37% of tokens hit ATH at listing and NEVER surpass it.
6-month return vs benchmark after Binance listing: -39.46% underperformance.
RULE: Listings are exit liquidity events, not entry points. Fade the listing pump.

=== ON-CHAIN SIGNAL THRESHOLDS ===
Exchange inflows >2-3x 30-day avg + price declining = bearish (65-75% accuracy).
Single-day BTC outflow >10,000 BTC = institutional accumulation (bullish).
Coinbase outflows = US institutional. Binance flows = global retail.
Whale coordination (multiple >1000 BTC wallets buying simultaneously): 70-80% accuracy.
NVT >150 = overvalued top signal. NVT <40 = undervalued bottom signal.
Price-address divergence: Price up + active addresses down = BEARISH (May 2021 example: crashed within 1 week).
MVRV Z-Score: >3.7 = overvalued, <1 = undervalued. Picks cycle highs within 2 weeks historically.

=== CROSS-TOKEN CONTAGION ===
PEPE-BONK correlation: 0.73. FLOKI-BONK: 0.78. DOGE-BTC: 0.77. Memes vs BTC/ETH: 0.85.
Sympathy pump lag: 2-6 hours within same chain.
Capital rotation sequence: BTC → ETH (1-4 weeks) → large-cap alts (1-2 weeks) → memes (1-3 weeks).
SOL meme exhaustion → Base meme rotation: typically 24-72 hours.
Correlations SPIKE during dumps (approach 1.0) - treat meme sector as single position for risk.

=== POSITION SIZING RULES ===
Use QUARTER-KELLY (0.25x Kelly fraction). Full Kelly has 80% chance of 20% drawdown.
Maximum portfolio heat: 6% (sum of all position stop-loss risks).
After 20% drawdown: reduce all sizes by 50%.
After 30% drawdown: halt new entries.
Trailing stops: BTC 10-15%, alts 15-25%, memes use 3x ATR on 1H.
Correlation-adjusted: If ρ > 0.7, reduce each position by (1 - (ρ - 0.7)). At ρ = 0.85, reduce 15%.
Time-based exits for memes: 4-8 hour max hold often outperforms price targets.

=== LIQUIDATION HEATMAPS ===
Clusters within 2-3% of price: ~70% probability of being tested within 24 hours.
NEVER place stops inside visible liquidation clusters - they get hunted.
After cascade (OI drops 20-40%, funding resets): contrarian entry becomes favorable.

=== BASE L2 SPECIFIC ===
Aerodrome: 52% of Base TVL, 68% of DEX volume. Epoch flips Thursday 00:00 UTC.
Coinbase integration announcements: +30-140% pumps that fade long-term.
Bridge flow data leads Base token performance by 1-2 weeks.
Base is 3-7x less liquid than Solana at equivalent market caps.
Best execution window on Base: 14:00-02:00 UTC.
BRETT depth example: ~$21K per 2% depth on Aerodrome. Size trades accordingly.
MEV on Base is minimal (centralized sequencer) but gas spam from bots is significant.

=== STABLECOIN FLOW SIGNALS ===
Stablecoin supply growth >5-10% per month for multiple months = structural bull market.
Sharp one-off spike (>5% in a week) without BTC strength = dry powder accumulation (leading indicator).
USDC growth outpacing USDT = US institutional positioning.
Stablecoin supply stagnation = no new money, be defensive.

=== NEWS EVENT SPEED ===
Binary events (ETF approval): priced in seconds to minutes.
Complex events (exchange collapse): days to weeks.
CPI/macro: initial move in 60 seconds, elevated vol for 2-4 hours. Pause trading T-30min to T+90min.
Influencer tweets: effect has dramatically diminished since 2021. Treat as noise now.
"Buy rumor, sell news": highly reliable when pre-event rally exceeds 30-50%.
`;
}

module.exports = { getMarketKnowledge };
