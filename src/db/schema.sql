-- RouteWise database schema for Supabase (Postgres)
-- Run this in the Supabase SQL Editor to create the tables.

-- ── Models table ──
CREATE TABLE IF NOT EXISTS models (
  model_id           TEXT PRIMARY KEY,
  provider           TEXT NOT NULL,
  display_name       TEXT NOT NULL,
  description        TEXT,
  context_length     INTEGER NOT NULL,
  max_output_tokens  INTEGER,
  modality           TEXT NOT NULL DEFAULT 'text->text',
  pricing_prompt     DOUBLE PRECISION NOT NULL,
  pricing_completion DOUBLE PRECISION NOT NULL,
  pricing_image      DOUBLE PRECISION,
  pricing_request    DOUBLE PRECISION,
  capabilities       JSONB NOT NULL DEFAULT '{"tool_calling":false,"json_output":false,"streaming":true,"vision":false}',
  supported_parameters TEXT[] DEFAULT '{}',
  quality_tier       TEXT NOT NULL DEFAULT 'standard',
  value_score        DOUBLE PRECISION,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider);
CREATE INDEX IF NOT EXISTS idx_models_quality_tier ON models(quality_tier);
CREATE INDEX IF NOT EXISTS idx_models_pricing_prompt ON models(pricing_prompt);
CREATE INDEX IF NOT EXISTS idx_models_is_active ON models(is_active);
CREATE INDEX IF NOT EXISTS idx_models_value_score ON models(value_score);

-- ── Price history table ──
CREATE TABLE IF NOT EXISTS price_history (
  id              BIGSERIAL PRIMARY KEY,
  model_id        TEXT NOT NULL REFERENCES models(model_id) ON DELETE CASCADE,
  field_changed   TEXT NOT NULL,
  old_value       DOUBLE PRECISION NOT NULL,
  new_value       DOUBLE PRECISION NOT NULL,
  change_pct      DOUBLE PRECISION NOT NULL,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_history_model ON price_history(model_id);
CREATE INDEX IF NOT EXISTS idx_price_history_date ON price_history(detected_at);

-- ── Row Level Security ──
-- Anon key can read models and price_history, only service role can write.

ALTER TABLE models ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;

-- Read access for anon
DROP POLICY IF EXISTS "Allow anon read models" ON models;
CREATE POLICY "Allow anon read models"
  ON models FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "Allow anon read price_history" ON price_history;
CREATE POLICY "Allow anon read price_history"
  ON price_history FOR SELECT
  TO anon
  USING (true);

-- Full access for service role (pipeline scripts)
DROP POLICY IF EXISTS "Allow service role all on models" ON models;
CREATE POLICY "Allow service role all on models"
  ON models FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service role all on price_history" ON price_history;
CREATE POLICY "Allow service role all on price_history"
  ON price_history FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── Auto-update updated_at trigger ──
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER models_updated_at
  BEFORE UPDATE ON models
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
