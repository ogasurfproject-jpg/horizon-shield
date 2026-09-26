# -*- coding: utf-8 -*-
"""
US-F-city-permits: 米国の大都市のオープンデータにある建築許可の申告工事額(estimated cost / valuation)から、
市 x 年 x 許可の種類 x 工事の区分 ごとの件数・合計・中央値・25/75 分位(と 1 sqft あたりの中央値)を作る。

入力(OBS2/raw/。Socrata の SoQL で「区分 x 申告額(x 面積)ごとの件数」を返させた応答をそのまま保存したもの):
  raw/<source_id>.hist.*.json         区分と申告額(と面積)の組ごとの件数。値の分布を 1 件も落とさずに持つ
  raw/<source_id>.check_monthly.json  API 側で数えた 月 x 区分 ごとの count(*) / count(値) / sum(値)(照合用)
出力:
  observations/us/spending_city_permits_<市>_2023_2025.csv   (count / 合計 / 中央値 / 25・75 分位)
  observations/us/cost_sqft_city_permits_<市>_2023_2025.csv  (1 sqft あたりの中央値。面積の列がある市だけ)
  reports/US-F-city-permits_checks.json                       (照合の数字)

計算の決まり(全市で同じ):
  - 有効な申告額 = 100 ドル以上 10 億ドル未満。欠け・0・100 ドル未満(1 ドル等の置き値)・10 億ドル以上(1 件の許可としてありえにくい。
    Austin 2023 に 81 億ドルが 6 件)は除く(除いた件数を note に)。合計の行の note に区分内の最大の申告額を書く(合計は外れ値に弱い)
  - 分位は線形補間(Hyndman-Fan type 7 = numpy の既定)。中央値は q=0.5 の同じ式(偶数件なら中央 2 値の平均)
  - 中央値・分位は有効な申告額が 10 件以上の区分だけ。件数と合計は全区分
  - 1 sqft あたり = 申告額 / 面積。有効な申告額かつ面積 100 sqft 以上の許可だけ。10 件以上の区分だけ
  - 金額は Decimal で計算し、小数 2 桁に丸める
使い方: python3 tools/parsers/parse_us_city_permits.py [OBS2 のルート]
"""
import sys, os, json, glob, collections, csv
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from obs_common import make_id, write_obs, num  # noqa: E402

YEARS = ["2023", "2024", "2025"]
VMIN, VMAX = Decimal("100"), Decimal("1000000000")
AMIN = Decimal("100")
NMIN_Q = 10
LICENSE = "OPEN-TERMS"
STATUS = "published_open_terms"
BLANK = "(blank)"

COMMON_NOTE = ("申告工事額は許可申請者の申告(見積・予定額)で、実際の契約額・精算額ではない。"
               "許可が要らない工事や無許可の工事は含まれない")

CITIES = [
    {
        "key": "nyc", "source_id": "city-nyc-permits-w9ak-ipjd", "geo_code": "36", "geo_name": "New York City",
        "place_geoid": "3651000", "landing": "https://data.cityofnewyork.us/d/w9ak-ipjd",
        "dataset": "DOB NOW: Build - Job Application Filings",
        "hist": ["hist.2023.json", "hist.2024.json", "hist.2025.json"], "year_from": "file",
        "type_cols": [("t", "job_type")], "work_col": ("b", "building_type"),
        "value_col": ("c", "initial_cost"), "area": lambda r: dec(r.get("a")), "area_label": "total_construction_floor_area",
        "check_keys": ["t", "b"],
        "filter_text": "job_filing_number like '%-I1'(初回の申請)、first_permit_date の年",
        "city_note": ("NYC は DOB NOW の初回申請(job_filing_number が -I1)で、最初の許可が出た年(first_permit_date)で数えた。"
                      "Initial Cost は申請時の申告工事費。New Building は Initial Cost が 0 の申請が多い(除いた件数を参照)"),
    },
    {
        "key": "sf", "source_id": "city-sf-permits-i98e-djp9", "geo_code": "06", "geo_name": "San Francisco",
        "place_geoid": "0667000", "landing": "https://data.sf.gov/d/i98e-djp9",
        "dataset": "Building Permits (Department of Building Inspection)",
        "hist": ["hist.2023-2025.json"], "year_from": "y",
        "type_cols": [("p", "permit_type"), ("t", "permit_type_definition")], "work_col": ("b", "proposed_use"),
        "value_col": ("c", "estimated_cost"), "area": None, "area_label": None,
        "check_keys": ["p", "b"],
        "filter_text": "primary_address_flag = 'Y'(1 許可 1 行)、issued_date の年",
        "city_note": ("SF は主たる住所の行(primary_address_flag = Y)だけで 1 許可 1 行にし、issued_date の年で数えた。"
                      "Estimated Cost は申請時の申告額(審査後の Revised Cost は使っていない)"),
    },
    {
        "key": "seattle", "source_id": "city-seattle-permits-76t5-zqzr", "geo_code": "53", "geo_name": "Seattle",
        "place_geoid": "5363000", "landing": "https://data.seattle.gov/d/76t5-zqzr",
        "dataset": "Building Permits (Seattle Department of Construction & Inspections)",
        "hist": ["hist.2023-2025.json"], "year_from": "y",
        "type_cols": [("m", "permittypemapped"), ("t", "permittypedesc")], "work_col": ("b", "permitclass"),
        "value_col": ("c", "estprojectcost"), "area": None, "area_label": None,
        "check_keys": ["m", "t", "b"],
        "filter_text": "issueddate の年",
        "city_note": ("Seattle は issueddate の年で数えた。EstProjectCost は原本の説明で fair market value (parts plus labor) "
                      "に基づく見積で、事業が変われば変わる"),
    },
    {
        "key": "austin", "source_id": "city-austin-permits-3syk-w9eu", "geo_code": "48", "geo_name": "Austin",
        "place_geoid": "4805000", "landing": "https://data.austintexas.gov/d/3syk-w9eu",
        "dataset": "Issued Construction Permits",
        "hist": ["hist.2023.json", "hist.2024.json", "hist.2025.json"], "year_from": "file",
        "type_cols": [("t", "work_class")], "work_col": ("b", "permit_class"),
        "value_col": ("c", "total_job_valuation"),
        "area": lambda r: add_area(r.get("a1"), r.get("a2")), "area_label": "total_new_add_sqft + remodel_repair_sqft",
        "check_keys": ["t", "b"],
        "filter_text": "permittype = 'BP'(Building Permit)、jurisdiction = 'AUSTIN FULL PURPOSE'、issue_date の年",
        "city_note": ("Austin は Building Permit(permittype BP)のうち jurisdiction が AUSTIN FULL PURPOSE のものだけ"
                      "(ETJ や周辺の市を除く)。Total Job Valuation は許可ごとの工事全体(建築・電気・機械・配管を含む)の申告額。"
                      "C-1000 Commercial Remodel などは Total Job Valuation が空の許可が多い。New / R- 101 Single Family Houses は "
                      "Total Job Valuation が 0 か 1 の許可が大半(2023: 1,311 件中 784 件、2024: 1,285 件中 1,118 件、2025: 1,319 件中 1,305 件)で、"
                      "有効な件数が少ない年の中央値は代表性が低い"),
    },
    {
        "key": "neworleans", "source_id": "city-neworleans-permits-72f9-bi28", "geo_code": "22", "geo_name": "New Orleans",
        "place_geoid": "2255000", "landing": "https://data.nola.gov/d/72f9-bi28",
        "dataset": "Permits - BLDS",
        "hist": ["hist.2023-2025.json"], "year_from": "y",
        "type_cols": [("m", "permittypemapped"), ("t", "permittypedesc")], "work_col": ("b", "permitclass"),
        "value_col": ("c", "estprojectcost"), "area": lambda r: dec(r.get("a")), "area_label": "totalsqft",
        "check_keys": ["m", "t", "b"],
        "exclude": lambda r: r.get("m") == "Other",
        "filter_text": "issuedate の年。PermitTypeMapped が Other(道路占用・看板・植樹・住所変更など建築工事でないもの)は除く",
        "city_note": ("New Orleans は issuedate の年で数えた。EstProjectCost は原本の説明で『construction contract の写し、"
                      "自主施工なら明細見積』に基づく工事額。TotalSqFt は新築・増築の面積(該当しなければ 0)"),
    },
    {
        "key": "boston", "source_id": "city-boston-permits-6ddcd912", "geo_code": "25", "geo_name": "Boston",
        "place_geoid": "2507000", "landing": "https://data.boston.gov/dataset/approved-building-permits",
        "dataset": "Approved Building Permits (Inspectional Services Department)",
        "hist": ["hist.2023.json", "hist.2024.json", "hist.2025.json"], "year_from": "file",
        "type_cols": [("t", "permittypedescr")], "work_col": ("b", "worktype"),
        "value_col": ("c", "declared_valuation"), "area": lambda r: dec(r.get("a")), "area_label": "sq_feet",
        "check_keys": ["t", "b"],
        "filter_text": "issued_date の年(申請中・却下・取消の許可は原本に含まれない)",
        "city_note": ("Boston は issued_date の年で数えた。declared_valuation は申請時の申告額('$25,800.00' の形の文字列)。"
                      "worktype は原本の略号のまま(INTREN、EXTREN、ROOF など。意味は原本のデータ辞書)。sq_feet はほとんどの許可で 0"),
    },
    {
        "key": "sandiego", "source_id": "city-sandiego-permits-development-permits-set2", "geo_code": "06", "geo_name": "San Diego",
        "place_geoid": "0666000", "landing": "https://data.sandiego.gov/datasets/development-permits-set2/",
        "dataset": "Approvals for development projects (Development Services Department)",
        "hist": ["issued2024.csv", "issued2025.csv"], "year_from": "csv", "loader": "sd_csv",
        "type_cols": [("t", "APPROVAL_TYPE")], "work_col": ("b", "JOB_BC_CODE_DESCRIPTION"),
        "value_col": ("c", "APPROVAL_VALUATION"), "area": lambda r: dec(r.get("a")), "area_label": "APPROVAL_FLOOR_AREA",
        "check_keys": ["t", "b"], "check": "csv_pandas",
        "filter_text": "APPROVAL_ISSUE_DATE の年(原本の年別ファイル Issued approvals)。APPROVAL_VALUATION が 1 件も入っていない承認の種類は除く",
        "city_note": ("San Diego は年別ファイル『Issued approvals (2024)』『(2025)』の全行(1 行 = 承認 x 工事)。2023 年は年別ファイルが無く取っていない。"
                      "APPROVAL_VALUATION は承認ごとの評価額(申請時の申告に基づく)。JOB_BC_CODE_DESCRIPTION は Census の建築許可の区分コードの説明。"
                      "交通規制・騒音・証明書など評価額の列が 1 件も入っていない承認の種類は除いた。2024 年は同じ APPROVAL_ID が 2 行ある承認が 6 件(原本のまま数えた)"),
    },
]


def dec(s):
    if s is None:
        return None
    t = str(s).replace(",", "").replace("$", "").strip()
    if t == "":
        return None
    try:
        return Decimal(t)
    except InvalidOperation:
        return None


def add_area(a1, a2):
    x, y = dec(a1), dec(a2)
    if x is None and y is None:
        return None
    return (x or Decimal(0)) + (y or Decimal(0))


def q2(x):
    return num(str(x.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)))


def quantile(hist, q):
    """hist: 値 -> 件数。線形補間(type 7)。"""
    items = sorted(hist.items())
    n = sum(c for _, c in items)
    h = (n - 1) * Decimal(q)
    lo = int(h)  # floor(h >= 0)
    frac = h - lo

    def at(k):
        acc = 0
        for v, c in items:
            acc += c
            if k < acc:
                return v
        return items[-1][0]
    vlo = at(lo)
    if frac == 0:
        return vlo
    return vlo + frac * (at(lo + 1) - vlo)


def records(data):
    """Socrata は行の配列、CKAN(datastore_search_sql)は {"result": {"records": [...]}}。切り詰めがあれば止める。"""
    if isinstance(data, dict):
        assert data.get("success") is True, "CKAN の応答が success でない"
        assert not data["result"].get("records_truncated"), "CKAN の応答が切り詰められている"
        return data["result"]["records"]
    return data


def lab(v):
    return BLANK if v is None or str(v).strip() == "" else str(v)


def load_sd_csv(root, c):
    """San Diego の年別 CSV を、ヒストグラムの応答と同じ形(t, b, c, a, n)の行に直す。評価額が 1 件も無い承認の種類は除く。"""
    rows = []
    for fn in c["hist"]:
        path = os.path.join(root, "raw", "%s.%s" % (c["source_id"], fn))
        recs = list(csv.DictReader(open(path, encoding="utf-8", newline="")))
        with_val = collections.defaultdict(set)
        for x in recs:
            if x["APPROVAL_VALUATION"].strip() != "":
                with_val[x["APPROVAL_ISSUE_DATE"][:4]].add(x["APPROVAL_TYPE"])
        for x in recs:
            y = x["APPROVAL_ISSUE_DATE"][:4]
            if x["APPROVAL_TYPE"] not in with_val[y]:
                continue
            rows.append((y, {"t": x["APPROVAL_TYPE"], "b": x["JOB_BC_CODE_DESCRIPTION"] or None,
                             "c": x["APPROVAL_VALUATION"] or None, "a": x["APPROVAL_FLOOR_AREA"] or None, "n": "1"}))
    return rows


def load_hist(root, c):
    if c.get("loader") == "sd_csv":
        return load_sd_csv(root, c)
    rows = []
    for fn in c["hist"]:
        path = os.path.join(root, "raw", "%s.%s" % (c["source_id"], fn))
        data = records(json.load(open(path, encoding="utf-8")))
        year = fn.split(".")[1] if c["year_from"] == "file" else None
        for r in data:
            y = year or r["y"]
            if c.get("exclude") and c["exclude"](r):
                continue
            rows.append((y, r))
    return rows


def build(root, c):
    vk = c["value_col"][0]
    tks = [k for k, _ in c["type_cols"]]
    wk = c["work_col"][0]
    groups = collections.defaultdict(lambda: {"n": 0, "nnull": 0, "nlow": 0, "nhigh": 0, "hist": collections.Counter(),
                                              "sumall": Decimal(0), "ratio": collections.Counter(), "narea": 0})
    seen_types = collections.defaultdict(set)
    for y, r in load_hist(root, c):
        if y not in YEARS:
            continue
        n = int(r["n"])
        tkey = tuple(lab(r.get(k)) for k in tks)
        wkey = lab(r.get(wk))
        v = dec(r.get(vk))
        area = c["area"](r) if c["area"] else None
        for gk in ((y, tkey, wkey), (y, tkey, None)):
            g = groups[gk]
            g["n"] += n
            if v is None:
                g["nnull"] += n
                continue
            g["sumall"] += v * n
            if v < VMIN:
                g["nlow"] += n
                continue
            if v >= VMAX:
                g["nhigh"] += n
                continue
            g["hist"][v] += n
            if area is not None and area >= AMIN:
                g["ratio"][v / area] += n
                g["narea"] += n
        seen_types[y].add(tkey)
    return groups


def rows_for(c, groups):
    out_sp, out_sq = [], []
    tnames = [col for _, col in c["type_cols"]]
    wname = c["work_col"][1]
    vname = c["value_col"][1]
    for (y, tkey, wkey), g in sorted(groups.items(), key=lambda kv: (kv[0][0], kv[0][1], kv[0][2] or "")):
        type_label = " / ".join(tkey)
        work_label = wkey if wkey is not None else "(all %s)" % wname
        item = "%s | %s" % (type_label, work_label)
        spec_parts = ["%s=%s" % (col, v) for col, v in zip(tnames, tkey)]
        spec_parts.append("%s=%s" % (wname, wkey if wkey is not None else "(all)"))
        spec = "; ".join(spec_parts) + "; " + c["filter_text"]
        nv = sum(g["hist"].values())
        excl = "除いた許可: 申告額の欠け %d 件、100 ドル未満(0 を含む) %d 件、10 億ドル以上 %d 件" % (g["nnull"], g["nlow"], g["nhigh"])
        base = {"country": "US", "category": type_label, "item_name": item, "spec": spec,
                "geo_level": "city", "geo_code": c["geo_code"], "geo_name": c["geo_name"],
                "area_label": "", "area_code": "", "area_members": "",
                "price_status": STATUS, "period": y, "effective_from": "",
                "source_id": c["source_id"], "evidence_url": c["landing"], "license": LICENSE, "jccdb_v4_item_id": ""}
        if c.get("loader") == "sd_csv":
            src_page = "raw/%s.issued%s.csv(年別ファイルの全行)" % (c["source_id"], y)
        else:
            src_page = "raw/%s.%s(SoQL の group 集計の応答)" % (c["source_id"], c["hist"][0] if len(c["hist"]) == 1 else "hist.%s.json" % y)
        tail = "Census place GEOID %s。%s。%s" % (c["place_geoid"], c["city_note"], COMMON_NOTE)

        def mk(layer, basis, price, unit, currency, ref, refnote, note):
            r = dict(base)
            r.update({"obs_id": make_id(c["source_id"], layer, y, type_label, work_label, basis), "layer": layer,
                      "price": price, "unit": unit, "currency": currency, "price_basis": basis,
                      "ref_value": ref, "ref_note": refnote, "source_page": src_page, "note": note})
            return r
        # 件数
        out_sp.append(mk("spending", "count", str(g["n"]), "permits", "", str(nv),
                         "うち申告額が有効(100 ドル以上 10 億ドル未満)な件数",
                         "原本に無い値(区分ごとの件数を足した値)。%s の許可の件数。%s。%s" % (c["dataset"], excl, tail)))
        # 合計
        total = sum((v * n for v, n in g["hist"].items()), Decimal(0))
        if g["hist"]:
            vmax = max(g["hist"]); kmax = g["hist"][vmax]
            maxnote = "合計は外れ値に弱い。合計に入れた最大の申告額は %s ドル(%d 件、合計の %s%%)" % (
                q2(vmax), kmax, q2(vmax * kmax * 100 / total) if total else "0")
        else:
            maxnote = "有効な申告額が無い"
        if nv == 0:
            r0 = mk("spending", "permit_valuation_total_usd", "", "USD", "USD", "0", "合計に入れた件数",
                    "有効な申告工事額(%s)が 1 件も無いので合計を出さない(0 ドルではない)。%s。%s" % (vname, excl, tail))
            r0["price_status"] = "not_set"
            out_sp.append(r0)
            continue
        out_sp.append(mk("spending", "permit_valuation_total_usd", q2(total), "USD", "USD", str(nv),
                         "合計に入れた件数",
                         "原本に無い値。%d 件の申告工事額(%s)の合計。%s。%s。%s" % (nv, vname, excl, maxnote, tail)))
        if nv >= NMIN_Q:
            for basis, qq, word in (("permit_valuation_median_usd", "0.5", "中央値"),
                                    ("permit_valuation_p25_usd", "0.25", "25 パーセンタイル"),
                                    ("permit_valuation_p75_usd", "0.75", "75 パーセンタイル")):
                out_sp.append(mk("spending", basis, q2(quantile(g["hist"], qq)), "USD per permit", "USD", str(nv),
                                 "計算に使った件数",
                                 "原本に無い値。%d 件の申告工事額(%s)の%s(線形補間、numpy 既定の type 7)。%s。%s" % (nv, vname, word, excl, tail)))
        if c["area"] and g["narea"] >= NMIN_Q:
            out_sq.append(mk("cost_sqft", "permit_valuation_per_sqft_median_usd", q2(quantile(g["ratio"], "0.5")),
                             "USD per square foot", "USD", str(g["narea"]), "計算に使った件数",
                             "原本に無い値。%d 件の(申告工事額 / 面積)の中央値。面積は %s。有効な申告額(100 ドル以上 10 億ドル未満)で"
                             "面積 100 sqft 以上の許可だけ。%s。%s" % (g["narea"], c["area_label"], excl, tail)))
    return out_sp, out_sq


def check_pandas(root, c):
    """CSV を pandas(別の parser)で読み直し、年 x 区分 x 工事ごとの件数・非欠け件数・値の合計を返す(照合用)。"""
    import pandas as pd
    out = []
    for fn in c["hist"]:
        path = os.path.join(root, "raw", "%s.%s" % (c["source_id"], fn))
        df = pd.read_csv(path, dtype=str, keep_default_na=False)
        df["y"] = df["APPROVAL_ISSUE_DATE"].str[:4]
        typ = df[df["APPROVAL_VALUATION"].str.strip() != ""].groupby("y")["APPROVAL_TYPE"].apply(set).to_dict()
        df = df[[t in typ.get(y, set()) for y, t in zip(df["y"], df["APPROVAL_TYPE"])]]
        for (y, t, b), g in df.groupby(["y", "APPROVAL_TYPE", "JOB_BC_CODE_DESCRIPTION"]):
            v = g["APPROVAL_VALUATION"]
            nn = v[v != ""]
            out.append({"ym": y + "-01", "t": t, "b": b or None, "n": len(g), "nc": len(nn),
                        "s": str(sum((Decimal(x) for x in nn), Decimal(0)))})
    return out


def check(root, c, groups):
    """API 側の月別 count(*) / count(値) / sum(値) と、手元の区分別の件数・非欠け件数・値の合計を比べる。
    CSV の出典(San Diego)は、pandas で読み直した集計と比べる。"""
    if c.get("check") == "csv_pandas":
        data = check_pandas(root, c)
    else:
        path = os.path.join(root, "raw", "%s.check_monthly.json" % c["source_id"])
        data = records(json.load(open(path, encoding="utf-8")))
    api = collections.defaultdict(lambda: [0, 0, Decimal(0)])
    ex = c.get("exclude")
    for r in data:
        if ex and ex(r):
            continue
        y = r["ym"][:4]
        key = (y,) + tuple(lab(r.get(k)) for k in c["check_keys"])
        a = api[key]
        a[0] += int(r["n"]); a[1] += int(r.get("nc") or 0); a[2] += dec(r.get("s")) or Decimal(0)
    loc = collections.defaultdict(lambda: [0, 0, Decimal(0)])
    vk = c["value_col"][0]
    for y, r in load_hist(root, c):
        if y not in YEARS:
            continue
        key = (y,) + tuple(lab(r.get(k)) for k in c["check_keys"])
        n = int(r["n"]); v = dec(r.get(vk))
        a = loc[key]
        a[0] += n
        if v is not None:
            a[1] += n; a[2] += v * n
    keys = set(api) | set(loc)
    dn = [k for k in keys if api[k][0] != loc[k][0]]
    dc = [k for k in keys if api[k][1] != loc[k][1]]
    ds = [k for k in keys if abs(api[k][2] - loc[k][2]) > Decimal("0.01")]
    per_year = {}
    for y in YEARS:
        per_year[y] = {"api_count": sum(v[0] for k, v in api.items() if k[0] == y),
                       "local_count": sum(v[0] for k, v in loc.items() if k[0] == y),
                       "api_sum": str(sum((v[2] for k, v in api.items() if k[0] == y), Decimal(0))),
                       "local_sum": str(sum((v[2] for k, v in loc.items() if k[0] == y), Decimal(0)))}
    maxdiff = max([abs(api[k][2] - loc[k][2]) for k in keys] or [Decimal(0)])
    return {"groups_compared": len(keys), "count_mismatch": len(dn), "nonnull_mismatch": len(dc),
            "sum_mismatch_over_0.01": len(ds), "max_abs_sum_diff": str(maxdiff),
            "mismatch_examples": [[list(k), api[k][0], loc[k][0], str(api[k][2]), str(loc[k][2])] for k in sorted(dn + ds)[:10]],
            "per_year": per_year}


def main():
    checks = {}
    for c in CITIES:
        groups = build(ROOT, c)
        sp, sq = rows_for(c, groups)
        # 件数の和: (区分 x 工事) の count 行の和 = (区分 x all) の count 行の和
        tot_detail = collections.Counter(); tot_all = collections.Counter()
        for r in sp:
            if r["price_basis"] == "count":
                (tot_all if "(all " in r["item_name"] else tot_detail)[r["period"]] += int(r["price"])
        f1 = os.path.join(ROOT, "observations", "us", "spending_city_permits_%s_2023_2025.csv" % c["key"])
        n1 = write_obs(f1, sp)
        n2 = 0
        if sq:
            f2 = os.path.join(ROOT, "observations", "us", "cost_sqft_city_permits_%s_2023_2025.csv" % c["key"])
            n2 = write_obs(f2, sq)
        ck = check(ROOT, c, groups)
        ck["rows_spending"] = n1; ck["rows_cost_sqft"] = n2
        ck["count_rows_detail_sum_by_year"] = dict(tot_detail); ck["count_rows_all_sum_by_year"] = dict(tot_all)
        ck["by_basis"] = dict(collections.Counter(r["price_basis"] for r in sp + sq))
        checks[c["source_id"]] = ck
        print(c["key"], n1, n2, json.dumps({k: ck[k] for k in ("groups_compared", "count_mismatch", "nonnull_mismatch",
                                                               "sum_mismatch_over_0.01", "max_abs_sum_diff")}, ensure_ascii=False))
    out = os.path.join(ROOT, "reports", "US-F-city-permits_checks.json")
    json.dump(checks, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
