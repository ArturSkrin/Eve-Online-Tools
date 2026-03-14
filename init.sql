CREATE TABLE IF NOT EXISTS users (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cached_prices (
  type_id INTEGER PRIMARY KEY,
  type_name TEXT,
  adjusted_price REAL,
  average_price REAL,
  jita_sell_min REAL,
  jita_buy_max REAL,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS saved_contracts (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id INTEGER NOT NULL,
  region_id INTEGER NOT NULL,
  contract_price REAL NOT NULL,
  items_value REAL NOT NULL,
  margin REAL NOT NULL,
  margin_percent REAL NOT NULL,
  item_count INTEGER NOT NULL,
  title TEXT,
  contract_type TEXT,
  items JSONB,
  saved_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scan_history (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id INTEGER NOT NULL,
  region_name TEXT NOT NULL,
  total_contracts INTEGER NOT NULL,
  analyzed_contracts INTEGER NOT NULL,
  profitable_contracts INTEGER NOT NULL,
  best_margin REAL,
  scanned_at TIMESTAMP DEFAULT NOW()
);
