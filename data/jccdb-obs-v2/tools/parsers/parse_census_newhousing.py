# -*- coding: utf-8 -*-
"""
Census Bureau(Survey of Construction)の新築一戸建ての価格の表を Excel のセルで直接読み、3 つの観測ファイルを作る。

入力(raw/、いずれも Census のサイトの原本のバイト列):
  census-chars-contractpricesqft.xls  (chars/xls/contractpricesqft_cust.xls) シート ContractMedAvgPriceSqFt
  census-chars-soldpricesqft.xls      (chars/xls/soldpricesqft_cust.xls)     シート SoldMedAvgPPSF
  census-chars-soldprice.xls          (chars/xls/soldprice_cust.xls)         シート SoldMedAvgPrice
  census-chars-contractprice.xls      (chars/xls/contractprice_cust.xls)     シート ContractMedAvgPrice
  census-cqpi-sold.xlsx               (nrs/xls/price_sold_cust.xlsx)          シート Price Index(+ 照合用 Constant Price XX)
  census-cqpi-uc.xlsx                 (nrs/xls/price_uc_cust.xlsx)            シート Fixed(+ 照合用 Vertical)
出力:
  observations/us/cost_sqft_census_newhousing.csv   面積あたりの価格(請負価格/販売価格 の 中央値・平均)
  observations/us/house_price_census_newhousing.csv 1 戸あたりの価格(販売価格・請負価格 の 中央値・平均)
  observations/us/index_census_cqpi.csv             Laspeyres(固定ウェイト、2005 = 100)の価格指数
表の読み方: 見出し行の文字(United States / Northeast / Midwest / South / West、Median / Average)を確かめてから列を決める。
(S) は公表基準に満たず非公表、(NA) は該当なし: 値を入れず not_set。
照合(報告に数字で出す):
  1. 平均の表で、全米の平均が 4 地域の平均の最小と最大の間にあるか(全米の平均は地域の加重平均なので必ず間に入る)。
  2. 販売価格の平均(chars の SoldMedAvgPrice)と、価格指数のファイルの Constant Price XX シート
     「Average sales price of houses actually sold」の一致(別の刊行物に同じ値が載っている)。
  3. 価格指数: Price Index シートの年の値 と Constant Price XX シートの Price Index 列の一致。
  4. 建築中の指数: Fixed シート(年 x 月の表)と Vertical シート(縦 1 列)の Laspeyres の一致。
  5. 年の欠け。平均 < 中央値 の箇所(誤植の候補として数える)。
"""
import os, sys, re, json, datetime, collections, warnings
import xlrd, openpyxl

warnings.filterwarnings("ignore")
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from obs_common import make_id, num, write_obs

LIC = "US-PD-17USC105"
RAW = lambda f: os.path.join(ROOT, "raw", f)
REG = {"Northeast": ("R1", "Northeast"), "Midwest": ("R2", "Midwest"), "South": ("R3", "South"), "West": ("R4", "West")}
SRC = {
    "census-chars-contractpricesqft": "https://www.census.gov/construction/chars/xls/contractpricesqft_cust.xls",
    "census-chars-soldpricesqft": "https://www.census.gov/construction/chars/xls/soldpricesqft_cust.xls",
    "census-chars-soldprice": "https://www.census.gov/construction/chars/xls/soldprice_cust.xls",
    "census-chars-contractprice": "https://www.census.gov/construction/chars/xls/contractprice_cust.xls",
    "census-cqpi-sold": "https://www.census.gov/construction/nrs/xls/price_sold_cust.xlsx",
    "census-cqpi-uc": "https://www.census.gov/construction/nrs/xls/price_uc_cust.xlsx",
}
SYM = {"(S)": "(S) Withheld because estimate did not meet publication standards on the basis of response rate or a consistency review",
       "(NA)": "(NA) Not available"}


def geo(label):
    if label in ("United States", "Total"):
        return {"geo_level": "national", "geo_code": "US", "geo_name": "United States", "area_label": label}
    code, name = REG[label]
    return {"geo_level": "census_region", "geo_code": code, "geo_name": name, "area_label": label}


def xls_sheet(f, sh):
    s = xlrd.open_workbook(RAW(f)).sheet_by_name(sh)
    return [[s.cell_value(r, c) for c in range(s.ncols)] for r in range(s.nrows)]


def year_rows(rows, start=0, stop=None):
    out = []
    for i, r in enumerate(rows[start:stop], start=start):
        if isinstance(r[0], float) and 1900 < r[0] < 2100 and r[0] == int(r[0]):
            out.append((i, int(r[0]), r))
    return out


def rse_row(rows, after):
    for r in rows[after:]:
        if isinstance(r[0], str) and r[0].strip() == "RSE":
            return r
    return None


def med_avg_table(sid, f, sh, layer, basis, unit, spec, med_name, avg_name, expect_head):
    """Median 5 列 + Average 5 列(US, NE, MW, S, W)の表。見出しの並びを確かめてから読む。"""
    rows = xls_sheet(f, sh)
    title, sub = rows[0][0].strip(), rows[1][0].strip()
    head = " ".join(str(x) for r in rows[3:7] for x in r)
    for w in expect_head:
        assert w in head, (f, w, head)
    # 列の並び: 1..5 = 中央値の US, Northeast, Midwest, South, West / 6..10 = 平均の同じ並び
    r6 = [str(x).strip() for x in rows[6]]
    assert r6[1] == "States" and r6[2] == "east" and r6[3:6] == ["Midwest", "South", "West"], r6
    assert r6[6] == "States" and r6[7] == "east" and r6[8:11] == ["Midwest", "South", "West"], r6
    labels = ["United States", "Northeast", "Midwest", "South", "West"]
    yrs = year_rows(rows)
    rse = rse_row(rows, yrs[-1][0])
    last = yrs[-1][1]
    obs, table = [], {}
    for i, y, r in yrs:
        for j, lab in enumerate(labels):
            for off, name in ((1, med_name), (6, avg_name)):
                v = r[off + j]
                g = geo(lab)
                o = {"obs_id": make_id(sid, name, lab, y), "country": "US", "layer": layer, "category": title,
                     "item_name": name, "spec": spec, "unit": unit, **g, "currency": "USD", "price_basis": basis,
                     "period": str(y), "source_id": sid, "source_page": "sheet %s, row %d" % (sh, i + 1),
                     "evidence_url": SRC[sid], "license": LIC, "note": sub}
                if isinstance(v, float):
                    o["price"], o["price_status"] = num(repr(v)), "public_domain"
                    table[(name, lab, y)] = v
                else:
                    o["price"], o["price_status"] = "", "not_set"
                    o["note"] = sub + " " + SYM.get(str(v).strip(), "原本のセル: %r" % v)
                if y == last and rse is not None and isinstance(rse[off + j], float) and o["price"] != "":
                    o["ref_value"] = num(repr(rse[off + j]))
                    o["ref_note"] = "RSE (relative standard error, percent) の行の値。表の最終年の直下に印字(年の明記なし)"
                obs.append(o)
    return obs, table, [y for _, y, _ in yrs], title


def contract_price(sid="census-chars-contractprice", f="census-chars-contractprice.xls", sh="ContractMedAvgPrice"):
    rows = xls_sheet(f, sh)
    title, sub = rows[0][0].strip(), rows[1][0].strip()
    r6 = [str(x).strip() for x in rows[6]]
    assert r6[1:10] == ["Total", "Northeast", "Midwest", "South", "West", "tional1", "insured", "guaranteed", "Cash"], r6
    foot = [r[0] for r in rows if isinstance(r[0], str) and r[0].startswith("1 ")][0]
    cols = [("Total", None), ("Northeast", None), ("Midwest", None), ("South", None), ("West", None),
            ("Total", "Conventional (%s)" % foot[2:].strip()), ("Total", "FHA insured"), ("Total", "VA guaranteed"), ("Total", "Cash")]
    blocks = []
    for i, r in enumerate(rows):
        if len(r) > 1 and str(r[1]).strip() in ("Median Contract Price", "Average Contract Price"):
            blocks.append((i, str(r[1]).strip()))
    assert [b[1] for b in blocks] == ["Median Contract Price", "Average Contract Price"], blocks
    obs, table, years = [], {}, {}
    for bi, (start, name) in enumerate(blocks):
        stop = blocks[bi + 1][0] if bi + 1 < len(blocks) else len(rows)
        yrs = year_rows(rows, start, stop)
        years[name] = [y for _, y, _ in yrs]
        rse = rse_row(rows, yrs[-1][0])
        last = yrs[-1][1]
        for i, y, r in yrs:
            for j, (lab, fin) in enumerate(cols):
                v = r[1 + j]
                spec = "New Contractor-Built Single-Family Houses Started" + ("; Type of Financing: " + fin if fin else "")
                o = {"obs_id": make_id(sid, name, lab, fin or "", y), "country": "US", "layer": "house_price",
                     "category": title, "item_name": name, "spec": spec, "unit": "USD per house", **geo(lab),
                     "currency": "USD", "price_basis": "price_per_house", "period": str(y), "source_id": sid,
                     "source_page": "sheet %s, row %d" % (sh, i + 1), "evidence_url": SRC[sid], "license": LIC, "note": sub}
                if isinstance(v, float):
                    o["price"], o["price_status"] = num(repr(v)), "public_domain"
                    if fin is None:
                        table[(name, lab, y)] = v
                else:
                    o["price"], o["price_status"] = "", "not_set"
                    o["note"] = sub + " " + SYM.get(str(v).strip(), "原本のセル: %r" % v)
                if y == last and rse is not None and isinstance(rse[1 + j], float) and o["price"] != "":
                    o["ref_value"] = num(repr(rse[1 + j]))
                    o["ref_note"] = "RSE (relative standard error, percent) の行の値。表の最終年の直下に印字(年の明記なし)"
                obs.append(o)
    return obs, table, years, title


def cqpi_sold(sid="census-cqpi-sold", f="census-cqpi-sold.xlsx"):
    wb = openpyxl.load_workbook(RAW(f), data_only=True)
    ws = wb["Price Index"]
    rows = [[ws.cell(r, c).value for c in range(1, ws.max_column + 1)] for r in range(1, ws.max_row + 1)]
    title, sub = rows[0][0].strip(), rows[1][0].strip()
    h = rows[5]
    assert h[0] == "Year" and h[1] == "Annual index" and h[3] == "First Quarter" and h[5] == "Second Quarter" \
        and h[7] == "Third Quarter" and h[9] == "Fourth Quarter" and h[11] == "Northeast" and h[13] == "Midwest" \
        and h[15] == "South" and h[17] == "West", h
    assert rows[4][1] == "United States" and rows[4][11] == "Regions (Annual)", rows[4]
    cols = [(1, "United States", "Annual index", None), (3, "United States", "First Quarter", 1),
            (5, "United States", "Second Quarter", 2), (7, "United States", "Third Quarter", 3),
            (9, "United States", "Fourth Quarter", 4), (11, "Northeast", "Annual index", None),
            (13, "Midwest", "Annual index", None), (15, "South", "Annual index", None), (17, "West", "Annual index", None)]
    flags = {"p": "p = Preliminary", "r": "r = Revised"}
    obs, table = [], {}
    item = title  # 原本の表題のまま。基準と重みの説明(2005 = 100.0. Index based on kinds of houses sold in 2005.)は note に
    for i, r in enumerate(rows):
        if not (isinstance(r[0], int) and 1900 < r[0] < 2100):
            continue
        y = r[0]
        for c, lab, spec, q in cols:
            v = r[c]
            if v in (None, "", " "):
                continue  # 未公表の四半期(2026 年の第 3・第 4 四半期など)は行を作らない
            fl = str(r[c + 1] or "").strip()
            per = "%dQ%d" % (y, q) if q else str(y)
            o = {"obs_id": make_id(sid, lab, spec, per), "country": "US", "layer": "index", "category": title,
                 "item_name": item, "spec": spec + ("" if lab == "United States" else " (Regions, Annual)"),
                 "unit": "index (2005 = 100)", **geo(lab), "currency": "", "price_basis": "index_value",
                 "price": num(repr(float(v))), "price_status": "public_domain", "period": per, "source_id": sid,
                 "source_page": "sheet Price Index, row %d" % (i + 1), "evidence_url": SRC[sid], "license": LIC,
                 "note": sub + (" " + flags[fl] if fl in flags else "")}
            obs.append(o)
            table[(lab, spec, per)] = float(v)
    # 照合用: Constant Price XX シート
    cp = {}
    for code, lab in (("US", "United States"), ("NE", "Northeast"), ("MW", "Midwest"), ("SO", "South"), ("WE", "West")):
        w = wb["Constant Price " + code]
        assert w.cell(4, 1).value == lab and w.cell(5, 5).value == "Price Index", (code, w.cell(4, 1).value)
        for rr in range(7, w.max_row + 1):
            y = w.cell(rr, 1).value
            if isinstance(y, int):
                cp[(lab, y)] = {"actual_avg_price": w.cell(rr, 3).value, "index": w.cell(rr, 5).value,
                                "typical_2005_house_price": w.cell(rr, 6).value}
    return obs, table, cp, title


def cqpi_uc(sid="census-cqpi-uc", f="census-cqpi-uc.xlsx"):
    wb = openpyxl.load_workbook(RAW(f), data_only=True)
    ws = wb["Fixed"]
    rows = [[ws.cell(r, c).value for c in range(1, ws.max_column + 1)] for r in range(1, ws.max_row + 1)]
    title, sub = rows[0][0].strip(), rows[1][0].strip()
    h = rows[5]
    months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    assert h[1] == "Annual index" and [h[5 + 2 * k] for k in range(12)] == months, h
    flags = {"p": "p = Preliminary", "r": "r = Revised"}
    obs, fixed = [], {}
    for i, r in enumerate(rows):
        if not (isinstance(r[0], int) and 1900 < r[0] < 2100):
            continue
        y = r[0]
        cells = [(1, "Annual index", str(y))] + [(5 + 2 * k, "Monthly", "%d-%02d" % (y, k + 1)) for k in range(12)]
        for c, spec, per in cells:
            v = r[c]
            if v in (None, "", " "):
                continue  # 未公表の月は行を作らない
            fl = str(r[c + 1] or "").strip()
            o = {"obs_id": make_id(sid, "Laspeyres", spec, per), "country": "US", "layer": "index", "category": title,
                 "item_name": title, "spec": spec, "unit": "index (2005 = 100)", **geo("United States"),
                 "currency": "", "price_basis": "index_value", "price": num(repr(float(v))),
                 "price_status": "public_domain", "period": per, "source_id": sid,
                 "source_page": "sheet Fixed, row %d" % (i + 1), "evidence_url": SRC[sid], "license": LIC,
                 "note": sub + (" " + flags[fl] if fl in flags else "")}
            obs.append(o)
            if spec == "Monthly":
                fixed[per] = float(v)
    wv = wb["Vertical"]
    assert "Laspeyres" in str(wv.cell(6, 3).value), wv.cell(6, 3).value
    vert = {}
    for rr in range(7, wv.max_row + 1):
        d = wv.cell(rr, 1).value
        if isinstance(d, datetime.datetime):
            vert[d.strftime("%Y-%m")] = wv.cell(rr, 3).value
    return obs, fixed, vert, title


def main():
    rep = {}
    # 面積あたり
    o1, t1, y1, _ = med_avg_table("census-chars-contractpricesqft", "census-chars-contractpricesqft.xls", "ContractMedAvgPriceSqFt",
                                  "cost_sqft", "cost_per_sqft", "USD per square foot", "New Contractor-Built Single-Family Houses Started",
                                  "Median contract price per square foot", "Average contract price per square foot",
                                  ["Median contract price per square foot", "Average contract price per square foot", "Region"])
    o2, t2, y2, _ = med_avg_table("census-chars-soldpricesqft", "census-chars-soldpricesqft.xls", "SoldMedAvgPPSF",
                                  "cost_sqft", "cost_per_sqft", "USD per square foot of floor area", "New Single-Family Houses Sold",
                                  "Median price per square foot", "Average price per square foot",
                                  ["Median price per square foot", "Average price per square foot", "Region"])
    # 1 戸あたり
    o3, t3, y3, _ = med_avg_table("census-chars-soldprice", "census-chars-soldprice.xls", "SoldMedAvgPrice",
                                  "house_price", "price_per_house", "USD per house", "New Single-Family Houses Sold",
                                  "Median Sales Price", "Average Sales Price", ["Median Sales Price", "Average Sales Price", "Region"])
    o4, t4, y4, _ = contract_price()
    o5, t5, cp, _ = cqpi_sold()
    o6, fixed, vert, _ = cqpi_uc()
    # 照合 1: 全米の平均が地域の平均の間に入るか / 平均 < 中央値
    def us_within(table, avg, med, years, regions=("Northeast", "Midwest", "South", "West"), us="United States"):
        n = ok = 0
        bad, below_med = [], []
        for y in years:
            reg = [table.get((avg, r, y)) for r in regions]
            u = table.get((avg, us, y))
            if u is None or None in reg:
                continue
            n += 1
            if min(reg) <= u <= max(reg):
                ok += 1
            else:
                bad.append((y, u, min(reg), max(reg)))
            for r in (us,) + tuple(regions):
                a, m = table.get((avg, r, y)), table.get((med, r, y))
                if a is not None and m is not None and a < m:
                    below_med.append((y, r, a, m))
        return {"years_checked": n, "us_avg_within_regional_range": ok, "outside": bad, "avg_below_median": below_med}
    rep["check_contract_psf"] = us_within(t1, "Average contract price per square foot", "Median contract price per square foot", y1)
    rep["check_sold_psf"] = us_within(t2, "Average price per square foot", "Median price per square foot", y2)
    rep["check_sold_price"] = us_within(t3, "Average Sales Price", "Median Sales Price", y3)
    rep["check_contract_price"] = us_within(t4, "Average Contract Price", "Median Contract Price", y4["Average Contract Price"], us="Total")
    rep["years"] = {"contract_psf": [y1[0], y1[-1], len(y1)], "sold_psf": [y2[0], y2[-1], len(y2)],
                    "sold_price": [y3[0], y3[-1], len(y3)], "contract_price": {k: [v[0], v[-1], len(v)] for k, v in y4.items()}}
    rep["years_missing"] = {k: sorted(set(range(v[0], v[-1] + 1)) - set(v)) for k, v in
                            (("contract_psf", y1), ("sold_psf", y2), ("sold_price", y3))}
    # 照合 2: 販売価格の平均 (chars) と Constant Price シートの「実際に売れた家の平均価格」
    n = eq = 0
    diff = []
    for (name, lab, y), v in t3.items():
        if name != "Average Sales Price":
            continue
        c = cp.get((lab, y))
        if c is None:
            continue
        n += 1
        if abs(float(c["actual_avg_price"]) - v) < 0.5:
            eq += 1
        else:
            diff.append((lab, y, v, c["actual_avg_price"]))
    rep["check_avg_sales_price_chars_vs_cqpi"] = {"pairs": n, "equal": eq, "different": diff}
    # 照合 3: Price Index シート と Constant Price シートの指数
    n = eq = 0
    diff = []
    for (lab, y), c in cp.items():
        v = t5.get((lab, "Annual index", str(y)))
        if v is None or c["index"] is None:
            continue
        n += 1
        if abs(v - float(c["index"])) < 1e-9:
            eq += 1
        else:
            diff.append((lab, y, v, c["index"]))
    rep["check_index_priceindex_vs_constantprice"] = {"pairs": n, "equal": eq, "different": diff}
    # 照合 3b: 典型的な 2005 年の家の価格 = 2005 年の平均価格 x 指数 / 100(百ドル単位に丸め)
    n = ok = 0
    worst = 0
    for (lab, y), c in cp.items():
        base = cp.get((lab, 2005))
        if not base or c["index"] is None or c["typical_2005_house_price"] is None:
            continue
        n += 1
        est = float(base["actual_avg_price"]) * float(c["index"]) / 100
        d = abs(est - float(c["typical_2005_house_price"]))
        worst = max(worst, d)
        ok += d <= 50.0 + 1e-9
    rep["check_typical_2005_price_eq_base_x_index"] = {"pairs": n, "within_50usd": ok, "max_abs_diff_usd": round(worst, 2)}
    # 照合 4: Fixed と Vertical
    ks = sorted(set(fixed) | set(vert))
    rep["check_uc_fixed_vs_vertical"] = {"months_fixed": len(fixed), "months_vertical": len(vert),
                                         "equal": sum(1 for k in ks if k in fixed and k in vert and abs(fixed[k] - float(vert[k])) < 1e-9),
                                         "only_one_side": [k for k in ks if (k in fixed) != (k in vert)],
                                         "different": [(k, fixed.get(k), vert.get(k)) for k in ks if k in fixed and k in vert and abs(fixed[k] - float(vert[k])) >= 1e-9]}
    # 照合で見つかった箇所を行の note に書く(値は原本のまま変えない)
    flag = collections.defaultdict(list)
    for key, chk in (("contract_psf", rep["check_contract_psf"]), ("sold_psf", rep["check_sold_psf"]),
                     ("sold_price", rep["check_sold_price"]), ("contract_price", rep["check_contract_price"])):
        for y, r, a, m in chk["avg_below_median"]:
            if a >= 0.9 * m:
                continue  # 平均が中央値をわずかに下回るのは分布の形でも起こる。1 割以上下回るものだけ書く
            flag[(key, r, y)].append("同じ表の中央値 %s を平均 %s が下回る(誤植の可能性。値は原本のまま)" % (num(repr(float(m))), num(repr(float(a)))))
    for lab, y, v, c in rep["check_avg_sales_price_chars_vs_cqpi"]["different"]:
        flag[("sold_price_avg", lab, y)].append("Census の価格指数の表 price_sold_cust.xlsx(Constant Price シート)では同じ年・地域の平均販売価格が %s(値は原本のまま)" % c)
    def annotate(obs, key, avg_name):
        for o in obs:
            y = int(o["period"])
            lab = o["area_label"]
            msgs = []
            if o["item_name"] == avg_name:
                msgs += flag.get((key, lab, y), [])
                if key == "sold_price":
                    msgs += flag.get(("sold_price_avg", lab, y), [])
            if msgs:
                o["note"] = o["note"] + " " + " ".join(msgs)
    annotate(o1, "contract_psf", "Average contract price per square foot")
    annotate(o2, "sold_psf", "Average price per square foot")
    annotate(o3, "sold_price", "Average Sales Price")
    annotate(o4, "contract_price", "Average Contract Price")
    out = {"cost_sqft_census_newhousing.csv": o1 + o2, "house_price_census_newhousing.csv": o3 + o4,
           "index_census_cqpi.csv": o5 + o6}
    for fn, obs in out.items():
        write_obs(os.path.join(ROOT, "observations", "us", fn), obs)
        rep[fn] = {"rows": len(obs), "status": dict(collections.Counter(o["price_status"] for o in obs)),
                   "by_source": dict(collections.Counter(o["source_id"] for o in obs)),
                   "rows_with_flag_note": sum(1 for o in obs if "誤植の可能性" in o["note"] or "価格指数の表" in o["note"])}
    print(json.dumps(rep, ensure_ascii=False, indent=1, default=str))


if __name__ == "__main__":
    main()
