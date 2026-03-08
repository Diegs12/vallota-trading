-- ============================================================
-- Shared Knowledge Layer — Supabase tables for Vallota Trading Bot
-- Run this in the Supabase SQL editor to set up the schema.
-- ============================================================

-- Shared Trades: every trade decision from every bot instance
CREATE TABLE IF NOT EXISTS shared_trades (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  local_id     INT NOT NULL,
  timestamp    TIMESTAMPTZ,
  cycle        INT,
  action       TEXT NOT NULL,           -- 'buy', 'sell', 'hold'
  token        TEXT,
  amount_usd   NUMERIC,
  confidence   INT,
  reasoning    TEXT,
  market_summary TEXT,
  risk_notes   TEXT,
  timeframe_alignment TEXT,
  executed     BOOLEAN DEFAULT FALSE,
  failsafe     BOOLEAN DEFAULT FALSE,
  mode         TEXT DEFAULT 'paper',    -- 'paper' or 'live'
  logged_at    TIMESTAMPTZ,
  bot_instance_id TEXT NOT NULL DEFAULT 'primary',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Shared Reviews: self-review insights from every bot instance
CREATE TABLE IF NOT EXISTS shared_reviews (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  local_id               INT NOT NULL,
  trades_reviewed        INT,
  insights               JSONB,
  market_state_at_review JSONB,
  reviewed_at            TIMESTAMPTZ,
  bot_instance_id        TEXT NOT NULL DEFAULT 'primary',
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

-- Shared Lessons view: aggregates the latest lessons from all reviews
-- Pulls the most actionable fields from the JSONB insights column.
CREATE OR REPLACE VIEW shared_lessons AS
SELECT
  r.id,
  r.bot_instance_id,
  r.reviewed_at,
  r.trades_reviewed,
  r.insights ->> 'overall_assessment'    AS overall_assessment,
  r.insights ->> 'win_rate_estimate'     AS win_rate_estimate,
  r.insights ->> 'confidence_calibration' AS confidence_calibration,
  r.insights -> 'lessons_learned'        AS lessons_learned,
  r.insights -> 'mistakes_to_avoid'      AS mistakes_to_avoid,
  r.insights -> 'strategy_adjustments'   AS strategy_adjustments,
  r.insights -> 'patterns_identified'    AS patterns_identified
FROM shared_reviews r
ORDER BY r.reviewed_at DESC;

-- ============================================================
-- Indexes
-- ============================================================

-- Fast lookups by bot instance
CREATE INDEX IF NOT EXISTS idx_shared_trades_bot
  ON shared_trades (bot_instance_id);

CREATE INDEX IF NOT EXISTS idx_shared_reviews_bot
  ON shared_reviews (bot_instance_id);

-- Chronological queries
CREATE INDEX IF NOT EXISTS idx_shared_trades_timestamp
  ON shared_trades (timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_shared_reviews_reviewed_at
  ON shared_reviews (reviewed_at DESC);

-- Filter by action type (useful for analyzing buy/sell patterns)
CREATE INDEX IF NOT EXISTS idx_shared_trades_action
  ON shared_trades (action);

-- Filter by token (useful for per-token analysis)
CREATE INDEX IF NOT EXISTS idx_shared_trades_token
  ON shared_trades (token);

-- Composite: find a specific bot's trades quickly
CREATE INDEX IF NOT EXISTS idx_shared_trades_bot_local
  ON shared_trades (bot_instance_id, local_id);

CREATE INDEX IF NOT EXISTS idx_shared_reviews_bot_local
  ON shared_reviews (bot_instance_id, local_id);

-- ============================================================
-- Row Level Security (optional — enable if using multiple users)
-- ============================================================
-- ALTER TABLE shared_trades ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE shared_reviews ENABLE ROW LEVEL SECURITY;
--
-- -- Allow all authenticated users to read
-- CREATE POLICY "Anyone can read shared_trades"
--   ON shared_trades FOR SELECT USING (true);
-- CREATE POLICY "Anyone can read shared_reviews"
--   ON shared_reviews FOR SELECT USING (true);
--
-- -- Allow inserts from authenticated users
-- CREATE POLICY "Authenticated can insert shared_trades"
--   ON shared_trades FOR INSERT WITH CHECK (true);
-- CREATE POLICY "Authenticated can insert shared_reviews"
--   ON shared_reviews FOR INSERT WITH CHECK (true);
