-- hs-law-watch
CREATE TABLE IF NOT EXISTS snapshots (
  source_id TEXT PRIMARY KEY, fetched_at TEXT, http_status INTEGER, ok INTEGER, hash TEXT, items_json TEXT, fail_streak INTEGER DEFAULT 0, url TEXT
);
CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY, source_id TEXT, domain TEXT, kind TEXT, detected_at TEXT, title TEXT, url TEXT,
  impact_json TEXT, status TEXT DEFAULT 'open', note TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status, detected_at);
CREATE TABLE IF NOT EXISTS runs (at TEXT, summary_json TEXT);
