#!/usr/bin/env python3
"""hs-jccdb-obs v0.4: 米国の掛け率・マージン・輸入原価・各段の価格(非公開の計算層)を D1(DB_US)に流す SQL を作る。

使い方:
  python3 tools/make_d1_sql_kake.py --src ~/hs-core-private/ops-private/jccdb_us_kake_20260926 \
      --imports ~/horizon-shield/data/jccdb-obs-v2/raw/us/kake_20260926/derived --ym 202607 --out sql_us_kake

入力(どれも非公開。公開のリポには入れない。出力の sql_us_kake/ も .gitignore 済み):
  --src      kake_us_wa_des_23623_prototype.csv, kake_us_wa_des_11121_prototype.csv, kake_us_naspo_mro_ak_prototype.csv,
             margin_us_census_prototype.csv, margin_us_bea_2007_prototype.csv, markup_us_dot.csv,
             chain_us_hs10_<ym>.csv, chain_summary_<ym>.json
  --imports  imports_us_hs10_<ym>.csv, imports_us_hs10_cty_<ym>.csv(filter_imdb.py の出力)
検査(1 つでも外れたら何も書かずに止まる):
  kake   : 0 < kake_ratio <= 1、kake_ratio は値引きの行だけ、price_to_list_ratio >= 1、evidence_url と sha256 がある
  margin : 粗利率(%)は 0..100、NAICS がある、kake_cost_ratio = 1 - value/100
  bea    : 生産者 + 運賃 + 卸 + 小売 = 購入者(行ごとの丸めで 1 行あたり ±2.5)、比率 = 金額の比
  import : HS は 10 桁、CIF = 通関価格 + 諸掛、陸揚げ = CIF + 関税、品目の合計 = 国別の合計
  chain  : 粗利率 0..0.7、倍率 >= 1、unit_x = unit_landed * mult_x、出力の sha256 が chain_summary と同じ
出力: <out>/001.sql ...(1 文 90,000 bytes まで、1 ファイル --max-mb まで)と MANIFEST.json(apply_order の順に流す)。
最後の文は kake_meta の built_kake(件数と入力の sha256)。これが無い D1 は「入れ直しの途中」と worker が答える。
"""
import argparse, csv, hashlib, json, os, sys, unicodedata, datetime, collections

ap = argparse.ArgumentParser()
ap.add_argument("--src", required=True)
ap.add_argument("--imports", required=True)
ap.add_argument("--ym", required=True)
ap.add_argument("--out", default="sql_us_kake")
ap.add_argument("--max-mb", type=float, default=20)
A = ap.parse_args()
YM = A.ym
S = lambda f: os.path.join(A.src, f)
I = lambda f: os.path.join(A.imports, f)
files = {
    "kake_23623": S("kake_us_wa_des_23623_prototype.csv"), "kake_11121": S("kake_us_wa_des_11121_prototype.csv"),
    "kake_naspo": S("kake_us_naspo_mro_ak_prototype.csv"), "margin_census": S("margin_us_census_prototype.csv"),
    "margin_bea": S("margin_us_bea_2007_prototype.csv"), "markup": S("markup_us_dot.csv"),
    "chain": S(f"chain_us_hs10_{YM}.csv"), "chain_summary": S(f"chain_summary_{YM}.json"),
    "import_hs10": I(f"imports_us_hs10_{YM}.csv"), "import_cty": I(f"imports_us_hs10_cty_{YM}.csv"),
}
missing = [p for p in files.values() if not os.path.exists(p)]
if missing:
    sys.exit("入力が無い: " + ", ".join(missing))
sha = {k: hashlib.sha256(open(p, "rb").read()).hexdigest() for k, p in files.items()}
rd = lambda k: list(csv.DictReader(open(files[k], newline="", encoding="utf-8")))
errs = []
def bad(msg):
    errs.append(msg)

def fnum(v):
    if v is None or str(v).strip() == "":
        return None
    return float(v)
def inum(v):
    if v is None or str(v).strip() == "":
        return None
    return int(float(v))
def norm(*xs):
    return unicodedata.normalize("NFKC", " ".join(str(x) for x in xs if x)).lower()
def close(a, b, rel=1e-6, abs_=1e-9):
    return abs(a - b) <= max(abs_, rel * max(abs(a), abs(b)))

# ------------------------------------------------------------------ kake_obs
DISCOUNT_BASES = {"MSRP Discount", "Discount off List Price", "Discount off shelf price"}
kake = []
for key, sid_default in (("kake_23623", "wa-des-23623"), ("kake_11121", "wa-des-11121"), ("kake_naspo", "naspo-mro-ak")):
    for r in rd(key):
        basis = r.get("price_basis", "")
        k = fnum(r.get("kake_ratio")); pl = fnum(r.get("price_to_list_ratio")); cr = fnum(r.get("catalog_ratio"))
        pct = r.get("percentage", "")
        if k is not None and not (0 < k <= 1):
            bad(f"{key} row {r.get('row') or r.get('category')}: kake_ratio {k} not in (0,1]")
        if k is not None and basis not in DISCOUNT_BASES:
            bad(f"{key}: kake_ratio on non-discount basis {basis}")
        if basis in DISCOUNT_BASES and pct not in ("", None) and k is None:
            bad(f"{key}: discount row without kake_ratio")
        if k is not None and pct not in ("", None) and not close(k, 1 - float(pct)):
            bad(f"{key}: kake_ratio != 1 - pct ({k} vs {pct})")
        if pl is not None and (pl < 1 or not close(pl, 1 + float(pct))):
            bad(f"{key}: price_to_list_ratio {pl}")
        if not r.get("evidence_url") or len(r.get("evidence_sha256", "")) != 64:
            bad(f"{key}: evidence missing")
        vendor = r.get("vendor", "")
        detail = r.get("market_basket_detail") or r.get("specific") or ""
        ceiling = 1 if r["source_id"].startswith("wa-des") else None
        kake.append({
            "source_id": r["source_id"] or sid_default, "contract": r.get("contract"), "contract_term": r.get("contract_term") or r.get("period"),
            "contract_url": r.get("contract_url"), "contract_sha256": r.get("contract_sha256"),
            "vendor": vendor, "category": r.get("category"), "manufacturer": r.get("manufacturer"), "product_line": r.get("product_line"),
            "subcategory": r.get("subcategory"), "detail": detail, "uom": r.get("uom"),
            "price_basis": basis, "percentage": fnum(pct) if pct not in ("", None) else None,
            "percentage_min": fnum(r.get("percentage_min")), "percentage_max": fnum(r.get("percentage_max")),
            "kake_ratio": k, "price_to_list_ratio": pl, "catalog_ratio": cr, "list_basis": r.get("list_basis"),
            "ceiling": ceiling, "zero_discount": 1 if r.get("zero_discount") == "true" else 0,
            "method": r.get("method"), "period": r.get("period"),
            "page_or_row": (f"sheet {r['sheet']} row {r['row']}" if r.get("sheet") else (f"page {r['page']}" if r.get("page") else None)),
            "evidence_url": r["evidence_url"], "evidence_sha256": r["evidence_sha256"],
            "norm": norm(vendor, r.get("category"), r.get("manufacturer"), r.get("product_line"), r.get("subcategory"), detail, basis),
        })

# ------------------------------------------------------------------ margin_gm
margin = []
for r in rd("margin_census"):
    v = fnum(r["value"])
    if not r["naics"]:
        bad("margin: naics missing")
    if r["measure"] == "gross_margin_pct_of_sales" and v is not None:
        if not (0 <= v <= 100):
            bad(f"margin: pct out of range {r['naics']} {r['year']} {v}")
        kc = fnum(r["kake_cost_ratio"])
        if kc is not None and not close(kc, 1 - v / 100, rel=1e-4, abs_=1e-4):
            bad(f"margin: kake_cost_ratio {r['naics']} {r['year']} {kc} vs {1 - v/100}")
    margin.append({
        "source_id": r["source_id"], "trade": r["trade"], "naics": r["naics"], "label": r["label"], "typop": r["typop"], "geo": r["geo"],
        "year": int(r["year"]), "revised": r["revised"], "measure": r["measure"], "value": v, "flag": r["flag"] or None,
        "kake_cost_ratio": fnum(r["kake_cost_ratio"]), "computed": 1 if r["computed"] == "true" else 0, "method": r["method"], "cell": r["cell"],
        "evidence_url": r["evidence_url"], "evidence_sha256": r["evidence_sha256"], "norm": norm(r["naics"], r["label"], r["trade"]),
    })

# ------------------------------------------------------------------ margin_bea
bea = []
for r in rd("margin_bea"):
    pv, t, w, rt, pu = (float(r[k]) for k in ("producers_value_musd", "transport_musd", "wholesale_musd", "retail_musd", "purchasers_value_musd"))
    if abs(pv + t + w + rt - pu) > 2.5 * int(r["n_buyer_rows"]):   # 原本は行ごとに百万ドル単位で丸めてある(1 行あたり最大 ±2.5)
        bad(f"bea: identity {r['buyer_group']} {r['commodity_code']}")
    if not close(float(r["producer_to_purchaser"]), pv / pu, rel=1e-5):
        bad(f"bea: ratio {r['commodity_code']}")
    bea.append({
        "buyer_group": r["buyer_group"], "commodity_code": r["commodity_code"], "commodity": r["commodity"], "n_buyer_rows": int(r["n_buyer_rows"]),
        "producers_value_musd": pv, "transport_musd": t, "wholesale_musd": w, "retail_musd": rt, "purchasers_value_musd": pu,
        "producer_to_purchaser": float(r["producer_to_purchaser"]), "transport_share": float(r["transport_share"]),
        "wholesale_share": float(r["wholesale_share"]), "retail_share": float(r["retail_share"]),
        "wholesale_markup_on_producer": float(r["wholesale_markup_on_producer"]), "method": r["method"], "caveat": r["caveat"],
        "evidence_url": r["evidence_url"], "evidence_sha256": r["evidence_sha256"], "norm": norm(r["commodity_code"], r["commodity"]),
    })

# ------------------------------------------------------------------ markup_dot
markup = []
for r in rd("markup"):
    markup.append({"agency": r["agency"], "spec": r["spec"], "section": r["section"], "component": r["component"], "markup": fnum(r["markup"]),
                   "base": r["base"], "verified": 1 if r["verified"] == "true" else 0, "verified_how": r["verified_how"], "source_url": r["source_url"] or None, "note": r["note"] or None})
    if r["verified"] == "true" and fnum(r["markup"]) is None:
        bad("markup: verified row without value")

# ------------------------------------------------------------------ import_hs10 / import_hs10_cty
imp, imp_by = [], {}
for r in rd("import_hs10"):
    hs = r["hs10"]
    if len(hs) != 10 or not hs.isdigit():
        bad(f"import: hs10 {hs}")
    for sfx in ("mo", "yr"):
        if int(r[f"con_cif_{sfx}"]) != int(r[f"con_val_{sfx}"]) + int(r[f"con_cha_{sfx}"]):
            bad(f"import: cif identity {hs} {sfx}")
        if int(r[f"{sfx}_landed_duty_paid"]) != int(r[f"con_cif_{sfx}"]) + int(r[f"cal_dut_{sfx}"]):
            bad(f"import: landed identity {hs} {sfx}")
    ym = f"{r['year']}-{int(r['month']):02d}"
    rec = {"ym": ym, "hs10": hs, "descr": r["desc"] or r["desc_short"], "unit1": r["unit1"], "unit2": r["unit2"] or None, "naics": r["naics"], "end_use": r["end_use"]}
    for sfx in ("mo", "yr"):
        for k in ("con_qy1", "con_val", "dut_val", "cal_dut", "con_cha", "con_cif"):
            rec[f"{k}_{sfx}"] = int(r[f"{k}_{sfx}"])
    rec.update(mo_landed_duty_paid=int(r["mo_landed_duty_paid"]), mo_unit_landed=fnum(r["mo_unit_landed"]), mo_duty_rate_eff=fnum(r["mo_duty_rate_eff"]),
               yr_landed_duty_paid=int(r["yr_landed_duty_paid"]), yr_unit_landed=fnum(r["yr_unit_landed"]), yr_duty_rate_eff=fnum(r["yr_duty_rate_eff"]),
               evidence_url=r["evidence_url"], evidence_sha256=r["evidence_sha256"], norm=norm(hs, r["desc"], r["desc_short"]))
    imp.append(rec); imp_by[hs] = rec
cty = []
sums = collections.defaultdict(lambda: [0, 0, 0, 0])
for r in rd("import_cty"):
    hs = r["hs10"]
    ym = f"{r['year']}-{int(r['month']):02d}"
    rec = {"ym": ym, "hs10": hs, "cty_code": r["cty_code"], "cty_name": r["cty_name"]}
    for k in ("con_qy1_mo", "con_val_mo", "cal_dut_mo", "con_cif_mo", "con_qy1_yr", "con_val_yr", "dut_val_yr", "cal_dut_yr", "con_cif_yr"):
        rec[k] = int(r[k])
    rec.update(yr_landed_duty_paid=int(r["yr_landed_duty_paid"]), yr_unit_landed=fnum(r["yr_unit_landed"]), yr_duty_rate_eff=fnum(r["yr_duty_rate_eff"]))
    s = sums[hs]; s[0] += rec["con_val_mo"]; s[1] += rec["con_cif_yr"]; s[2] += rec["cal_dut_yr"]; s[3] += rec["con_qy1_yr"]
    cty.append(rec)
for hs, rec in imp_by.items():
    s = sums.get(hs, [0, 0, 0, 0])
    if s != [rec["con_val_mo"], rec["con_cif_yr"], rec["cal_dut_yr"], rec["con_qy1_yr"]]:
        bad(f"import: country sums != hs10 total for {hs}")
if set(sums) - set(imp_by):
    bad("import: countries for hs10 not in hs10 file")

# ------------------------------------------------------------------ trade_chain
summ = json.load(open(files["chain_summary"]))
if summ.get("output_sha256") != sha["chain"]:
    bad(f"chain: sha256 {sha['chain'][:12]} != chain_summary {str(summ.get('output_sha256'))[:12]}")
chain = []
UNITS = (("unit_wholesale", "mult_wholesale"), ("unit_retail_direct", "mult_retail_direct"), ("unit_retail_via_wholesale", "mult_retail_via_wholesale"), ("unit_contractor", "mult_contractor"))
for r in rd("chain"):
    gw = fnum(r["gm_wholesale"])
    if gw is None or not (0 <= gw <= 0.7):
        bad(f"chain: gm_wholesale {r['hs10']} {gw}")
    for m in ("mult_wholesale", "mult_retail_direct", "mult_retail_via_wholesale", "mult_contractor"):
        v = fnum(r[m])
        if v is not None and v < 1:
            bad(f"chain: {m} < 1 for {r['hs10']}")
    if not close(fnum(r["mult_wholesale"]), 1 / (1 - gw), rel=1e-6):
        bad(f"chain: mult_wholesale {r['hs10']}")
    ul = fnum(r["unit_landed_ytd"])
    for u, m in UNITS:
        if ul is not None and fnum(r[m]) is not None and not close(fnum(r[u]), ul * fnum(r[m]), rel=1e-6):
            bad(f"chain: {u} != unit_landed * {m} for {r['hs10']}")
    src = imp_by.get(r["hs10"])
    if not src or int(r["landed_duty_paid_ytd_usd"]) != src["yr_landed_duty_paid"]:
        bad(f"chain: landed differs from import for {r['hs10']}")
    if not r["formula"]:
        bad("chain: formula missing")
    rec = {k: r[k] for k in ("period", "hs10", "unit1", "naics_product", "wholesale_naics", "map_confidence", "map_reason", "gm_wholesale_naics_used",
                             "gm_retail_alt_naics", "bea2007_commodity", "bea2007_match", "formula", "caveat", "src_import", "src_import_sha256",
                             "src_gm_wholesale", "src_gm_wholesale_sha256", "src_gm_retail", "src_markup", "src_trade_map_sha256")}
    rec["descr"] = r["desc"]
    for k in ("qty_ytd", "landed_duty_paid_ytd_usd", "cif_ytd_usd", "cal_duty_ytd_usd"):
        rec[k] = int(r[k])
    for k in ("duty_rate_eff_ytd", "unit_landed_ytd", "gm_wholesale", "gm_wholesale_awts2022_4digit", "gm_retail_444110", "gm_retail_alt",
              "contractor_markup_materials", "mult_wholesale", "mult_retail_direct", "mult_retail_via_wholesale", "mult_retail_alt_via_wholesale",
              "mult_contractor", "kake_landed_to_wholesale", "kake_landed_to_retail_via_wholesale", "unit_wholesale", "unit_retail_direct",
              "unit_retail_via_wholesale", "unit_contractor", "bea2007_construction_producer_to_purchaser"):
        rec[k] = fnum(r[k])
    rec["thin_trade"] = 1 if r["thin_trade"] == "true" else 0
    rec["unit_outlier_vs_hs6"] = 1 if r["unit_outlier_vs_hs6"] == "true" else (0 if r["unit_outlier_vs_hs6"] == "false" else None)
    rec["norm"] = norm(r["hs10"], r["desc"], r["naics_product"], r["wholesale_naics"])
    chain.append(rec)

if errs:
    print(f"検査で {len(errs)} 件の誤り。何も書かない。", file=sys.stderr)
    for e in errs[:30]:
        print("  " + e, file=sys.stderr)
    sys.exit(1)

# ------------------------------------------------------------------ 書き出し
def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"

MAX_STMT = 90000
MAX_FILE = int(A.max_mb * 1024 * 1024)
os.makedirs(A.out, exist_ok=True)
for f in os.listdir(A.out):
    if f.endswith(".sql") or f == "MANIFEST.json":
        os.remove(os.path.join(A.out, f))
out_files, cur, cur_size = [], [], 0
def flush():
    global cur, cur_size
    if not cur:
        return
    name = f"{len(out_files) + 1:03d}.sql"
    with open(os.path.join(A.out, name), "w", encoding="utf-8") as fo:
        fo.write("".join(cur))
    out_files.append(name)
    cur, cur_size = [], 0
def emit(stmt):
    global cur_size
    b = len(stmt.encode("utf-8"))
    if cur_size + b > MAX_FILE:
        flush()
    cur.append(stmt); cur_size += b
def insert(table, rows):
    if not rows:
        return
    cols = list(rows[0].keys())
    head = f"INSERT INTO {table} (rid, {', '.join(cols)}) VALUES "
    buf, size = [], len(head.encode("utf-8")) + 2
    for i, r in enumerate(rows, start=1):
        t = "(" + ", ".join([str(i)] + [lit(r[c]) for c in cols]) + ")"
        tb = len(t.encode("utf-8")) + 1
        if tb + len(head) + 2 > MAX_STMT:
            sys.exit(f"1 行が 1 文の上限を超える: {table} rid {i}")
        if buf and size + tb > MAX_STMT:
            emit(head + ",".join(buf) + ";\n"); buf, size = [], len(head.encode("utf-8")) + 2
        buf.append(t); size += tb
    if buf:
        emit(head + ",".join(buf) + ";\n")

insert("kake_obs", kake)
insert("margin_gm", margin)
insert("margin_bea", bea)
insert("markup_dot", markup)
insert("import_hs10", imp)
insert("import_hs10_cty", cty)
insert("trade_chain", chain)
built = {
    "built_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "ym": YM,
    "rows": {"kake_obs": len(kake), "margin_gm": len(margin), "margin_bea": len(bea), "markup_dot": len(markup),
             "import_hs10": len(imp), "import_hs10_cty": len(cty), "trade_chain": len(chain)},
    "inputs_sha256": sha,
    "sources": {
        "wa-des-23623": "https://apps.des.wa.gov/contracting/23623p_updated.xlsx",
        "wa-des-11121": "https://apps.des.wa.gov/contracting/11121p.xlsx",
        "naspo-mro-ak": "https://oppm.doa.alaska.gov/media/1827/02-industrial-supplies-and-equipment.pdf",
        "census-imdb": imp[0]["evidence_url"] if imp else None,
        "census-aies-2024": "https://www2.census.gov/programs-surveys/aies/data/2024/",
        "census-awts-2022": "https://www2.census.gov/programs-surveys/awts/tables/2022revised/2022_awts_purchmarg_nomsbo_table4.xlsx",
        "census-arts-2022": "https://www2.census.gov/programs-surveys/arts/tables/2022benchmarked/gmper.xlsx",
        "bea-io-margins-2007": "https://apps.bea.gov/industry/xls/io-annual/Margins_Before_Redefinitions_2007_Detail.xlsx",
        "caltrans-ctss-9-1.04": "https://dot.ca.gov/-/media/dot-media/programs/local-assistance/documents/training/2025/8-payment-20260106.pdf",
    },
}
emit("INSERT INTO kake_meta (k, v) VALUES ('built_kake', " + lit(json.dumps(built, ensure_ascii=False, sort_keys=True)) + ");\n")
flush()
man = {"built": built, "files": {f: hashlib.sha256(open(os.path.join(A.out, f), "rb").read()).hexdigest() for f in out_files},
       "apply_order": ["schema/0004_kake_us.sql"] + [os.path.join(os.path.basename(os.path.normpath(A.out)), f) for f in out_files]}
json.dump(man, open(os.path.join(A.out, "MANIFEST.json"), "w"), indent=1, ensure_ascii=False)
print(json.dumps({"files": len(out_files), "bytes": sum(os.path.getsize(os.path.join(A.out, f)) for f in out_files), "rows": built["rows"]}, ensure_ascii=False))
