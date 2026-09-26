-- hs-jccdb-obs v0.4(v0.4.1 で markup_dot に原本の sha256 と頁、margin_ppi を足した): 米国の掛け率・マージン・輸入原価・各段の価格(非公開の計算層)。DB_US(hs-jccdb-obs-us)にだけ当てる。
-- obs2 と台帳の表には触らない。流し直すときはこのファイルから(表を消して作り直す)。
-- 中身は tools/make_d1_sql_kake.py の生成物だけ。値は hs-mcp の service binding からの呼び出しにだけ返す(worker の isInternal)。
DROP TABLE IF EXISTS kake_meta;
DROP TABLE IF EXISTS kake_obs;
DROP TABLE IF EXISTS margin_gm;
DROP TABLE IF EXISTS margin_bea;
DROP TABLE IF EXISTS import_hs10;
DROP TABLE IF EXISTS import_hs10_cty;
DROP TABLE IF EXISTS trade_chain;
DROP TABLE IF EXISTS markup_dot;
DROP TABLE IF EXISTS margin_ppi;

CREATE TABLE kake_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);

-- 観測: 州・共同購買の契約書の率(契約書の値そのまま。掛け率は 1 - 値引き率で computed)
CREATE TABLE kake_obs (
  rid INTEGER PRIMARY KEY, source_id TEXT NOT NULL, contract TEXT, contract_term TEXT, contract_url TEXT, contract_sha256 TEXT,
  vendor TEXT, category TEXT, manufacturer TEXT, product_line TEXT, subcategory TEXT, detail TEXT, uom TEXT,
  price_basis TEXT NOT NULL, percentage REAL, percentage_min REAL, percentage_max REAL,
  kake_ratio REAL, price_to_list_ratio REAL, catalog_ratio REAL, list_basis TEXT, ceiling INTEGER, zero_discount INTEGER,
  method TEXT, period TEXT, page_or_row TEXT, evidence_url TEXT NOT NULL, evidence_sha256 TEXT NOT NULL, norm TEXT NOT NULL
);
CREATE INDEX kake_obs_src ON kake_obs(source_id, vendor);

-- 統計: 卸・小売の粗利率(Census AWTS / ARTS / AIES)。value は % 、kake_cost_ratio = 1 - value/100
CREATE TABLE margin_gm (
  rid INTEGER PRIMARY KEY, source_id TEXT NOT NULL, trade TEXT, naics TEXT NOT NULL, label TEXT, typop TEXT, geo TEXT,
  year INTEGER NOT NULL, revised TEXT, measure TEXT NOT NULL, value REAL, flag TEXT, kake_cost_ratio REAL, computed INTEGER,
  method TEXT, cell TEXT, evidence_url TEXT NOT NULL, evidence_sha256 TEXT NOT NULL, norm TEXT NOT NULL
);
CREATE INDEX margin_gm_naics ON margin_gm(naics, measure, year);

-- 統計: BEA 産業連関表のマージン表 2007(建設業の購入と家計の購入)
CREATE TABLE margin_bea (
  rid INTEGER PRIMARY KEY, buyer_group TEXT NOT NULL, commodity_code TEXT NOT NULL, commodity TEXT, n_buyer_rows INTEGER,
  producers_value_musd REAL, transport_musd REAL, wholesale_musd REAL, retail_musd REAL, purchasers_value_musd REAL,
  producer_to_purchaser REAL, transport_share REAL, wholesale_share REAL, retail_share REAL, wholesale_markup_on_producer REAL,
  method TEXT, caveat TEXT, evidence_url TEXT NOT NULL, evidence_sha256 TEXT NOT NULL, norm TEXT NOT NULL
);
CREATE INDEX margin_bea_code ON margin_bea(commodity_code, buyer_group);

-- 統計: 輸入(Census IMDB)。HS 10 桁の月と年初来。陸揚げ原価と単価は computed
CREATE TABLE import_hs10 (
  rid INTEGER PRIMARY KEY, ym TEXT NOT NULL, hs10 TEXT NOT NULL, descr TEXT, unit1 TEXT, unit2 TEXT, naics TEXT, end_use TEXT,
  con_qy1_mo INTEGER, con_val_mo INTEGER, dut_val_mo INTEGER, cal_dut_mo INTEGER, con_cha_mo INTEGER, con_cif_mo INTEGER,
  con_qy1_yr INTEGER, con_val_yr INTEGER, dut_val_yr INTEGER, cal_dut_yr INTEGER, con_cha_yr INTEGER, con_cif_yr INTEGER,
  mo_landed_duty_paid INTEGER, mo_unit_landed REAL, mo_duty_rate_eff REAL, yr_landed_duty_paid INTEGER, yr_unit_landed REAL, yr_duty_rate_eff REAL,
  evidence_url TEXT NOT NULL, evidence_sha256 TEXT NOT NULL, norm TEXT NOT NULL
);
CREATE INDEX import_hs10_hs ON import_hs10(hs10, ym);

CREATE TABLE import_hs10_cty (
  rid INTEGER PRIMARY KEY, ym TEXT NOT NULL, hs10 TEXT NOT NULL, cty_code TEXT NOT NULL, cty_name TEXT,
  con_qy1_mo INTEGER, con_val_mo INTEGER, cal_dut_mo INTEGER, con_cif_mo INTEGER,
  con_qy1_yr INTEGER, con_val_yr INTEGER, dut_val_yr INTEGER, cal_dut_yr INTEGER, con_cif_yr INTEGER,
  yr_landed_duty_paid INTEGER, yr_unit_landed REAL, yr_duty_rate_eff REAL
);
CREATE INDEX import_hs10_cty_hs ON import_hs10_cty(hs10, ym, con_val_yr);
CREATE INDEX import_hs10_cty_c ON import_hs10_cty(cty_code, hs10);

-- 計算: 陸揚げ原価から卸・小売・元請の各段(build_chain.py の出力そのまま)
CREATE TABLE trade_chain (
  rid INTEGER PRIMARY KEY, period TEXT NOT NULL, hs10 TEXT NOT NULL, descr TEXT, unit1 TEXT, naics_product TEXT, wholesale_naics TEXT,
  map_confidence TEXT, map_reason TEXT, qty_ytd INTEGER, landed_duty_paid_ytd_usd INTEGER, cif_ytd_usd INTEGER, cal_duty_ytd_usd INTEGER,
  duty_rate_eff_ytd REAL, unit_landed_ytd REAL, gm_wholesale REAL, gm_wholesale_naics_used TEXT, gm_wholesale_awts2022_4digit REAL,
  gm_retail_444110 REAL, gm_retail_alt REAL, gm_retail_alt_naics TEXT, contractor_markup_materials REAL,
  mult_wholesale REAL, mult_retail_direct REAL, mult_retail_via_wholesale REAL, mult_retail_alt_via_wholesale REAL, mult_contractor REAL,
  kake_landed_to_wholesale REAL, kake_landed_to_retail_via_wholesale REAL,
  unit_wholesale REAL, unit_retail_direct REAL, unit_retail_via_wholesale REAL, unit_contractor REAL,
  bea2007_construction_producer_to_purchaser REAL, bea2007_commodity TEXT, bea2007_match TEXT,
  thin_trade INTEGER, unit_outlier_vs_hs6 INTEGER, formula TEXT, caveat TEXT,
  src_import TEXT, src_import_sha256 TEXT, src_gm_wholesale TEXT, src_gm_wholesale_sha256 TEXT, src_gm_retail TEXT, src_markup TEXT, src_trade_map_sha256 TEXT,
  norm TEXT NOT NULL
);
CREATE INDEX trade_chain_hs ON trade_chain(hs10);

-- 元請の上乗せ率(州の交通局の force account)。verified=1 の行だけ計算に使う
CREATE TABLE markup_dot (
  rid INTEGER PRIMARY KEY, agency TEXT NOT NULL, spec TEXT, section TEXT, component TEXT NOT NULL, markup REAL, base TEXT,
  verified INTEGER NOT NULL, verified_how TEXT, source_url TEXT, source_sha256 TEXT, source_page TEXT, note TEXT
);

-- v0.4.1: BLS の卸・小売のマージン物価指数と建設資材の特殊指数(FRED の CSV、月ごと、値は BLS のまま)
CREATE TABLE margin_ppi (
  rid INTEGER PRIMARY KEY, series_id TEXT NOT NULL, title TEXT, units TEXT, base_period TEXT, naics_prefix TEXT, kind TEXT NOT NULL,
  month TEXT NOT NULL, value REAL NOT NULL, source TEXT, evidence_url TEXT NOT NULL, evidence_sha256 TEXT NOT NULL
);
CREATE INDEX margin_ppi_s ON margin_ppi(series_id, month);
