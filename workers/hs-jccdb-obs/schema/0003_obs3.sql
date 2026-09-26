-- hs-jccdb-obs v0.3: 観測層 v2 を国ごとの D1 に分けて持つ(DB = 日本 + v0.1 の items / obs、DB_US = 米国)。
-- 同じ 0003 を両方の D1 に当てる。当てたら続けて、その国の SQL(sql_jp/ か sql_us/)を MANIFEST.json の apply_order の順に全部流す。
-- 何度当ててもよい: v0.2 と v0.3 の表(obs2 / obs2_fts / notes / members / sources2 / coverage / src_files / geo_names)を消して作り直し、
-- meta の built_v2 / built_v3 / built_v3_fts を消す。v0.1 の items / obs / sources / meta の built には触らない。
-- v0.2 の 0002 は流さなくてよい(流してあっても、この 0003 が作り直す)。
--
-- v0.2 から小さくしたところ(返す JSON の形は v0.2 と同じ。worker が埋め戻す):
--   note          -> notes 表に本文を1回だけ持ち、obs2 は note_id を持つ(NULL = 空の note)
--   area_members  -> members 表に本文を1回だけ持ち、obs2 は members_id を持つ(NULL = 空)
--   evidence_url  -> 台帳(sources2.url)と同じなら NULL(返すときに台帳から埋める)
--   license       -> 台帳(sources2.license)と同じなら NULL(同上。検査器が行と台帳の license の一致を確かめている)
--   norm          -> 日本の行だけ(品目名の LIKE 検索に使う)。米国の行は NULL で、検索は FTS5(obs2_fts、sql_us/ の fts_*.sql が作る)
--   src_file      -> src_files 表の番号(file_no)
--   obs_id の主キー索引をやめ、rid(INTEGER PRIMARY KEY = rowid)を主キーにした。同じ SQL を2度流すと rid の重複で止まる
--   索引は4つ(geo / layer / source / period)。全行の LIKE にしか使えなかった norm の索引と、1 DB 1国なので country の索引はやめた

DROP TABLE IF EXISTS obs2_fts;
DROP TABLE IF EXISTS obs2;
DROP TABLE IF EXISTS notes;
DROP TABLE IF EXISTS members;
DROP TABLE IF EXISTS sources2;
DROP TABLE IF EXISTS coverage;
DROP TABLE IF EXISTS src_files;
DROP TABLE IF EXISTS geo_names;

CREATE TABLE obs2 (
  rid INTEGER PRIMARY KEY,           -- 組み立ての順の通し番号(1 から)。FTS5 の rowid と同じ
  obs_id TEXT NOT NULL,              -- 16桁の16進(obs_common.make_id)。一意は検査器が全行で確かめている
  country TEXT NOT NULL,             -- JP | US(この DB の国)
  layer TEXT NOT NULL,               -- material | labor | work | equipment | index | wage | bid_item | cost_sqft | spending | house_price | cost_limit(extra_enums で増える)
  category TEXT,
  item_name TEXT NOT NULL,
  spec TEXT,
  unit TEXT NOT NULL,
  geo_level TEXT NOT NULL,           -- national | bureau_area | pref | pref_area | city | census_region | state | metro | county | district | usace_ep_region | country
  geo_code TEXT,
  geo_name TEXT,
  area_label TEXT, area_code TEXT,
  members_id INTEGER,                -- members(members_id)。NULL = area_members が空
  price REAL,                        -- 開いた状態(published_pdl / published_cc_by / public_domain / published_open_terms)のときだけ入る
  currency TEXT,
  price_basis TEXT NOT NULL,
  price_status TEXT NOT NULL,
  ref_value REAL, ref_note TEXT,
  period TEXT NOT NULL,
  effective_from TEXT,
  source_id TEXT NOT NULL,
  source_page TEXT,
  evidence_url TEXT,                 -- NULL = 台帳の url と同じ
  license TEXT,                      -- NULL = 台帳の license と同じ
  jccdb_v4_item_id TEXT,
  note_id INTEGER,                   -- notes(note_id)。NULL = note が空
  computed INTEGER NOT NULL DEFAULT 0, -- 1 = 値は原本に無く、観測層の組み立てで原本の値から計算した(note に『原本に無い値』)
  norm TEXT,                         -- 日本の行だけ: item_name + spec を NFKC、空白除去、ダッシュ類を '-'、小文字
  period_key TEXT NOT NULL,          -- 並べ替え用: 時点の始まりの日付 YYYY-MM-DD(FY は JP 4/1、US 前年 10/1)
  file_no INTEGER                    -- src_files(file_no)
);
CREATE INDEX idx_obs2_geo ON obs2(geo_code, layer, geo_level);
CREATE INDEX idx_obs2_layer ON obs2(layer, price_basis);
CREATE INDEX idx_obs2_source ON obs2(source_id);
CREATE INDEX idx_obs2_period ON obs2(period_key);

-- note の本文(同じ本文は1回だけ)
CREATE TABLE notes (note_id INTEGER PRIMARY KEY, text TEXT NOT NULL);
-- area_members の本文(同じ本文は1回だけ。Davis-Bacon の郡の一覧、USACE の地域の州の一覧、DoD の County / City / Zip など)
CREATE TABLE members (members_id INTEGER PRIMARY KEY, text TEXT NOT NULL);

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
CREATE TABLE coverage (
  source_id TEXT NOT NULL,
  country TEXT NOT NULL,
  layer TEXT NOT NULL,
  geo_level TEXT NOT NULL,
  geo_code TEXT NOT NULL,
  geo_name TEXT,
  price_status TEXT NOT NULL,
  n INTEGER NOT NULL,
  n_priced INTEGER NOT NULL,
  n_computed INTEGER NOT NULL,
  period_min TEXT, period_max TEXT,
  listed INTEGER NOT NULL DEFAULT 1, -- 1 = 行が obs2 にある。0 = 出典が表の複製・電子化を禁じているので件数だけ
  PRIMARY KEY (source_id, country, layer, geo_level, geo_code, price_status)
);
CREATE INDEX idx_cov_cl ON coverage(country, layer);

-- 取り込んだ CSV(file_no -> 観測層 v2 の中の相対パスと sha256)
CREATE TABLE src_files (file_no INTEGER PRIMARY KEY, path TEXT NOT NULL, sha256 TEXT NOT NULL, rows INTEGER NOT NULL, rid_min INTEGER, rid_max INTEGER);

-- 地域の名前の引き当て(郡・都市圏・市の名前 -> コード)。行の area_label(市は空なら geo_name)をそのまま集めたもの。
-- base_key は名前を小文字・英数字だけにし、郡の接尾辞(County / Parish / Borough 等)と「, 州名」を外したもの(worker.js の countyBase と同じ規則)。
CREATE TABLE geo_names (
  geo_level TEXT NOT NULL,           -- county | metro | city | usace_ep_region
  geo_code TEXT NOT NULL,            -- 郡 FIPS 5桁 / CBSA / 市は州 FIPS 2桁(日本は市区町村コード)/ EP-R1..R12
  name TEXT NOT NULL,                -- 原本の表示のまま(usace_ep_region は地域に含まれる州の一覧 = area_members)
  base_key TEXT NOT NULL,
  n INTEGER NOT NULL,                -- その名前の行の数
  PRIMARY KEY (geo_level, geo_code, name)
);
CREATE INDEX idx_geo_names_key ON geo_names(base_key, geo_level);

CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
DELETE FROM meta WHERE k IN ('built_v2', 'built_v3', 'built_v3_fts');
