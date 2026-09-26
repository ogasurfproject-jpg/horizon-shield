-- hs-jccdb-obs: JCCDB の品目(v4)と観測層(v1)を引ける口。読み取り専用。
DROP TABLE IF EXISTS items;
CREATE TABLE items (
  row_key TEXT PRIMARY KEY,          -- sha256(category|item_name|unit) 先頭16桁。v4 の行を一意に指す
  item_id TEXT,                      -- v4 provenance の item_id(verified 層だけが持つ)
  category TEXT NOT NULL,
  item_name TEXT NOT NULL,
  unit TEXT,
  norm TEXT NOT NULL,                -- NFKC 正規化 + 空白除去。検索用
  tier TEXT NOT NULL,                -- verified | extended
  verification_method TEXT,
  evidence_url TEXT
);
CREATE INDEX idx_items_cat ON items(category);

DROP TABLE IF EXISTS obs;
CREATE TABLE obs (
  obs_id TEXT PRIMARY KEY,
  layer TEXT NOT NULL,               -- labor | material
  category TEXT, item_name TEXT, spec TEXT, unit TEXT,
  norm TEXT NOT NULL,
  pref_code TEXT, pref TEXT, area_label TEXT, area_code TEXT, area_members TEXT,
  price_yen INTEGER,                 -- 出典の利用条件が再配布を許すときだけ入る
  price_status TEXT NOT NULL,        -- published_pdl | published_restricted_not_copied | publication_based_not_public | not_set
  ref_value_yen INTEGER, ref_value_note TEXT,
  effective_from TEXT, source_id TEXT NOT NULL, source_page TEXT, evidence_url TEXT, license TEXT,
  jccdb_v4_item_id TEXT, note TEXT
);
CREATE INDEX idx_obs_pref ON obs(pref);
CREATE INDEX idx_obs_layer ON obs(layer);

DROP TABLE IF EXISTS sources;
CREATE TABLE sources (source_id TEXT PRIMARY KEY, body TEXT NOT NULL);

DROP TABLE IF EXISTS meta;
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);
