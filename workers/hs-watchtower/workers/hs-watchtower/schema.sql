-- hs-watchtower D1 schema
-- One row per probe, one summary row per run. The guardian reads `runs` (latest) and,
-- when it wants detail, `probes` for that run_id.

CREATE TABLE IF NOT EXISTS probes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id       TEXT    NOT NULL,
  measured_at  INTEGER NOT NULL,      -- epoch ms
  measured_iso TEXT    NOT NULL,
  target       TEXT    NOT NULL,      -- logical name, e.g. 'ledger_health'
  url          TEXT    NOT NULL,
  http_status  INTEGER,               -- 0 = unreachable
  ok           INTEGER NOT NULL,      -- 1 pass / 0 fail
  detail       TEXT                   -- JSON: exact facts checked, or error
);

CREATE INDEX IF NOT EXISTS idx_probes_run      ON probes(run_id);
CREATE INDEX IF NOT EXISTS idx_probes_measured ON probes(measured_at);

CREATE TABLE IF NOT EXISTS runs (
  run_id       TEXT    PRIMARY KEY,
  measured_at  INTEGER NOT NULL,
  measured_iso TEXT    NOT NULL,
  overall      TEXT    NOT NULL,      -- GREEN / DEGRADED / RED
  n_pass       INTEGER NOT NULL,
  n_total      INTEGER NOT NULL,
  summary      TEXT                   -- JSON: per_target map + anomalies[] + outreach{}
);

CREATE INDEX IF NOT EXISTS idx_runs_measured ON runs(measured_at);
