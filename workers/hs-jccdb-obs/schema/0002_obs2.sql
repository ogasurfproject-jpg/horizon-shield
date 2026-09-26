-- hs-jccdb-obs v0.2: 観測層 v2(日本と米国を同じ列で持つ)。
-- v0.1 の items / obs / sources / meta はそのまま残す(後方互換。0001 は当て直さない)。
-- この 0002 は何度当ててもよい: obs2 / sources2 / coverage を作り直し、meta の built_v2 だけを消す。
-- 当てたら続けて sql_v2/*.sql を 001 から順に全部流す(途中で止まったら 0002 からやり直す)。
-- 列の意味は観測層 v2 の SCHEMA.md と同じ。足した列は computed / norm / period_key / src_file の4つだけ。

DROP TABLE IF EXISTS obs2;
CREATE TABLE obs2 (
  obs_id TEXT PRIMARY KEY,           -- 16桁の16進(obs_common.make_id)
  country TEXT NOT NULL,             -- JP | US
  layer TEXT NOT NULL,               -- material | labor | work | equipment | index | wage | bid_item | cost_sqft | spending | house_price(extra_enums で増える)
  category TEXT,
  item_name TEXT NOT NULL,
  spec TEXT,
  unit TEXT NOT NULL,
  geo_level TEXT NOT NULL,           -- national | bureau_area | pref | pref_area | city | census_region | state | metro | county | district
  geo_code TEXT,                     -- JP: JIS 2桁(市区町村は5桁か6桁) / US: FIPS 2桁・5桁、CBSA、R1..R4 / national: JP か US
  geo_name TEXT,
  area_label TEXT, area_code TEXT, area_members TEXT,
  price REAL,                        -- 開いた状態(published_pdl / published_cc_by / public_domain / published_open_terms)のときだけ入る
  currency TEXT,                     -- JPY | USD | 空(指数)
  price_basis TEXT NOT NULL,
  price_status TEXT NOT NULL,
  ref_value REAL, ref_note TEXT,
  period TEXT NOT NULL,              -- YYYY / YYYY-MM / YYYY-MM-DD / YYYYQn / FYYYYY / YYYYHn(原本の時点)
  effective_from TEXT,
  source_id TEXT NOT NULL,
  source_page TEXT,
  evidence_url TEXT NOT NULL,
  license TEXT NOT NULL,
  jccdb_v4_item_id TEXT,
  note TEXT,
  computed INTEGER NOT NULL DEFAULT 0, -- 1 = 値は原本に無く、観測層の組み立てで原本の値から計算した(note に『原本に無い値』。例: 着工統計の 1m2 あたり)
  norm TEXT NOT NULL,                -- 検索用: item_name + spec を NFKC、空白除去、ダッシュ類を '-'、小文字
  period_key TEXT NOT NULL,          -- 並べ替え用: 時点の始まりの日付 YYYY-MM-DD(FY は JP 4/1、US 前年 10/1)
  src_file TEXT                      -- 取り込んだ CSV(observations/jp/xxx.csv)
);
CREATE INDEX idx_obs2_country ON obs2(country);
CREATE INDEX idx_obs2_layer ON obs2(layer);
CREATE INDEX idx_obs2_geo ON obs2(geo_code);
CREATE INDEX idx_obs2_source ON obs2(source_id);
CREATE INDEX idx_obs2_period ON obs2(period_key);
CREATE INDEX idx_obs2_norm ON obs2(norm);
CREATE INDEX idx_obs2_lcg ON obs2(layer, country, geo_code);

DROP TABLE IF EXISTS sources2;
CREATE TABLE sources2 (
  source_id TEXT PRIMARY KEY,
  country TEXT NOT NULL,
  title TEXT, publisher TEXT, url TEXT, retrieved_at TEXT,
  license TEXT NOT NULL,
  values_copied INTEGER NOT NULL,    -- 1 = 値を写した / 0 = 状態だけ
  attribution TEXT,                  -- 帰属表示(PDL1.0 / CC BY / 政府標準利用規約 / 再利用条文のとき必須)
  body TEXT NOT NULL                 -- 台帳 sources/<source_id>.json の全文(JSON)
);

-- 組み立て時に集計した「何がどこまであるか」。出典 x 国 x layer x 地域 x 状態の件数。
DROP TABLE IF EXISTS coverage;
CREATE TABLE coverage (
  source_id TEXT NOT NULL,
  country TEXT NOT NULL,
  layer TEXT NOT NULL,
  geo_level TEXT NOT NULL,
  geo_code TEXT NOT NULL,
  geo_name TEXT,
  price_status TEXT NOT NULL,
  n INTEGER NOT NULL,                -- 行の数
  n_priced INTEGER NOT NULL,         -- 値が入っている行の数
  n_computed INTEGER NOT NULL,       -- そのうち、組み立てで計算した値(computed = 1)の行の数
  period_min TEXT, period_max TEXT,  -- 原本の時点の最小と最大(period_key の順)
  listed INTEGER NOT NULL DEFAULT 1, -- 1 = 行が obs2 にある。0 = 出典が表の複製・電子化を禁じているので行は載せず、件数だけを持つ(2026-09-26 番人の判断)
  PRIMARY KEY (source_id, country, layer, geo_level, geo_code, price_status)
);
CREATE INDEX idx_cov_cl ON coverage(country, layer);

CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
DELETE FROM meta WHERE k = 'built_v2';
