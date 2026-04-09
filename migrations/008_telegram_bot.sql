-- Telegram bot: user bindings and notification preferences

-- ── Telegram user bindings ──
CREATE TABLE IF NOT EXISTS telegram_users (
  id              BIGSERIAL PRIMARY KEY,
  telegram_chat_id BIGINT NOT NULL UNIQUE,
  telegram_username TEXT,
  api_key_id      BIGINT REFERENCES api_keys(id) ON DELETE SET NULL,
  linked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_users_chat_id ON telegram_users(telegram_chat_id);
CREATE INDEX IF NOT EXISTS idx_telegram_users_api_key ON telegram_users(api_key_id);

-- ── Linking tokens (single-use, time-limited) ──
CREATE TABLE IF NOT EXISTS telegram_link_tokens (
  id              BIGSERIAL PRIMARY KEY,
  token           TEXT NOT NULL UNIQUE,
  api_key_id      BIGINT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_link_tokens_token ON telegram_link_tokens(token);

-- ── Notification preferences ──
CREATE TABLE IF NOT EXISTS telegram_notification_prefs (
  id              BIGSERIAL PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL REFERENCES telegram_users(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,  -- 'price_change', 'new_model', 'deprecation', 'capability_failure'
  enabled         BOOLEAN NOT NULL DEFAULT true,
  min_change_pct  DOUBLE PRECISION,  -- optional threshold for price changes
  providers       TEXT[],  -- optional provider filter (null = all)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_telegram_pref UNIQUE (telegram_user_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_telegram_prefs_user ON telegram_notification_prefs(telegram_user_id);

-- ── RLS ──
ALTER TABLE telegram_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_link_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_notification_prefs ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "Allow service role all on telegram_users"
  ON telegram_users FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Allow service role all on telegram_link_tokens"
  ON telegram_link_tokens FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Allow service role all on telegram_notification_prefs"
  ON telegram_notification_prefs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Auto-update triggers
CREATE OR REPLACE TRIGGER telegram_users_updated_at
  BEFORE UPDATE ON telegram_users FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER telegram_notification_prefs_updated_at
  BEFORE UPDATE ON telegram_notification_prefs FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
