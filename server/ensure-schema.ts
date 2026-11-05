import { sql } from "drizzle-orm";
import { db } from "./db";
import { log } from "./index";

// init.sql only runs when the Postgres volume is created for the first time, so a deployment that already
// has data would never get these tables. They are created here on every start instead; every statement is
// idempotent. Keep in sync with shared/schema.ts and init.sql.
export const CHARACTER_DDL = `
CREATE TABLE IF NOT EXISTS session (
  sid VARCHAR PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);

CREATE TABLE IF NOT EXISTS eve_accounts (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS eve_characters (
  character_id BIGINT PRIMARY KEY,
  account_id VARCHAR NOT NULL,
  name TEXT NOT NULL,
  scopes TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  wallet_balance DOUBLE PRECISION,
  last_sync_at TIMESTAMPTZ,
  last_sync_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_eve_characters_account ON eve_characters (account_id);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  transaction_id BIGINT PRIMARY KEY,
  character_id BIGINT NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  type_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price DOUBLE PRECISION NOT NULL,
  is_buy BOOLEAN NOT NULL,
  is_personal BOOLEAN NOT NULL,
  location_id BIGINT NOT NULL,
  client_id BIGINT NOT NULL,
  journal_ref_id BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_char_date ON wallet_transactions (character_id, date);

CREATE TABLE IF NOT EXISTS wallet_journal (
  id BIGINT PRIMARY KEY,
  character_id BIGINT NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  ref_type TEXT NOT NULL,
  amount DOUBLE PRECISION,
  balance DOUBLE PRECISION,
  description TEXT,
  context_id BIGINT,
  context_id_type TEXT,
  first_party_id BIGINT,
  second_party_id BIGINT,
  tax DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS idx_wallet_journal_char_date ON wallet_journal (character_id, date);

CREATE TABLE IF NOT EXISTS industry_jobs (
  job_id BIGINT PRIMARY KEY,
  character_id BIGINT NOT NULL,
  activity_id INTEGER NOT NULL,
  blueprint_type_id INTEGER NOT NULL,
  product_type_id INTEGER,
  runs INTEGER NOT NULL,
  cost DOUBLE PRECISION,
  status TEXT NOT NULL,
  facility_id BIGINT NOT NULL,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS cost_overrides (
  account_id VARCHAR NOT NULL,
  type_id INTEGER NOT NULL,
  unit_cost DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (account_id, type_id)
);
`;

export async function ensureSchema(): Promise<void> {
  await db.execute(sql.raw(CHARACTER_DDL));
  log("character tables ready", "db");
}
