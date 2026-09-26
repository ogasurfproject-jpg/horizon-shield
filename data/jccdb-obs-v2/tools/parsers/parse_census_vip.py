# -*- coding: utf-8 -*-
"""
Census Bureau「Construction Spending (Value of Construction Put in Place, VIP)」の時系列データセット
(raw/census-vip-mf.zip = https://www.census.gov/econ_getzippedfile/?programCode=VIP の中の VIP-mf.csv)を
そのまま読み、observations/us/spending_census_vip.csv を作る。

VIP-mf.csv の形(同梱の README による): CATEGORIES / DATA TYPES / ERROR TYPES / GEO LEVELS / TIME PERIODS / NOTES /
DATA UPDATED ON / DATA の節。DATA の列は per_idx, cat_idx, dt_idx, et_idx, geo_idx, is_adj, val。
- 水準の値: dt_idx = 1(T 全体)/ 2(V 民間)/ 3(P 公共)、et_idx = 0。
  is_adj = 0 は季節調整なしの月の値(cat_code が XXXX 等)、is_adj = 1 は季節調整済み年率(cat_code が AXXXX 等 = "Annual Rate for ...")。
- 相対標準誤差: dt_idx = 0、et_idx = 1..3(E_T / E_V / E_P、単位 PCT)。同じ (月, 分類, 調整) の水準の行の ref_value に入れる。
- 月次の変化率(dt 4..6)は取り込まない(水準から計算できるため)。
照合: 全月・全区分で「Total Construction = Residential + Nonresidential」「Nonresidential = 字下げ 1 の各種類の和」
「全体(T) = 民間(V) + 公共(P)(同じ分類がそろう分)」の差を数え、差の最大を報告する(単位 百万ドル)。
"""
import csv, io, os, re, sys, json, zipfile, collections, hashlib

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from obs_common import make_id, num, write_obs

SID = "census-vip-eits"
ZIP = os.path.join(ROOT, "raw", "census-vip-mf.zip")
OUT = os.path.join(ROOT, "observations", "us", "spending_census_vip.csv")
URL = "https://www.census.gov/econ_getzippedfile/?programCode=VIP"
LIC = "US-PD-17USC105"
MONTHS = {m: i + 1 for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}


def sections(text):
    lines = [l.rstrip("\r") for l in text.split("\n")]
    names = ["CATEGORIES", "DATA TYPES", "ERROR TYPES", "GEO LEVELS", "TIME PERIODS", "NOTES", "DATA UPDATED ON", "DATA"]
    idx = {n: lines.index(n) for n in names}
    order = sorted(idx.items(), key=lambda kv: kv[1])
    out = {}
    for i, (n, s) in enumerate(order):
        e = order[i + 1][1] if i + 1 < len(order) else len(lines)
        out[n] = [l for l in lines[s + 1:e] if l.strip() != ""]
    return out


def main():
    z = zipfile.ZipFile(ZIP)
    raw = z.read("VIP-mf.csv")
    text = raw.decode("utf-8")
    sec = sections(text)
    cats = {r["cat_idx"]: r for r in csv.DictReader(io.StringIO("\n".join(sec["CATEGORIES"])))}
    dts = {r["dt_idx"]: r for r in csv.DictReader(io.StringIO("\n".join(sec["DATA TYPES"])))}
    ets = {r["et_idx"]: r for r in csv.DictReader(io.StringIO("\n".join(sec["ERROR TYPES"])))}
    pers = {r["per_idx"]: r["per_name"] for r in csv.DictReader(io.StringIO("\n".join(sec["TIME PERIODS"])))}
    updated_raw = sec["DATA UPDATED ON"][0].strip()  # 例: "Tuesday, 01-Sep-26 09:01:03 EDT"
    m = re.search(r"(\d{2})-([A-Z][a-z]{2})-(\d{2})", updated_raw)
    updated = "20%s-%02d-%s" % (m.group(3), MONTHS[m.group(2)], m.group(1))
    data = list(csv.DictReader(io.StringIO("\n".join(sec["DATA"]))))

    def period(pn):
        m, y = pn.split("-")
        return "%s-%02d" % (y, MONTHS[m])

    # 相対標準誤差: (per, cat, 対応する dt, is_adj) -> val
    et2dt = {"1": "1", "2": "2", "3": "3"}  # E_T->T, E_V->V, E_P->P
    rse = {}
    for r in data:
        if r["dt_idx"] == "0" and r["et_idx"] in et2dt:
            rse[(r["per_idx"], r["cat_idx"], et2dt[r["et_idx"]], r["is_adj"])] = r["val"]
    levels = [r for r in data if r["dt_idx"] in ("1", "2", "3") and r["et_idx"] == "0"]
    obs = []
    val = {}
    per_list = sorted({int(r["per_idx"]) for r in levels})
    for r in levels:
        c, d = cats[r["cat_idx"]], dts[r["dt_idx"]]
        adj = r["is_adj"] == "1"
        p = period(pers[r["per_idx"]])
        v = num(r["val"])
        val[(r["per_idx"], r["cat_idx"], r["dt_idx"], r["is_adj"])] = float(v)
        rv = rse.get((r["per_idx"], r["cat_idx"], r["dt_idx"], r["is_adj"]), "")
        latest = int(r["per_idx"]) == per_list[-1]
        note = ("Census 公表 %s 時点の値(以後の月次・年次改訂で変わる)。cat_code=%s, dt_code=%s" % (updated, c["cat_code"], d["dt_code"]))
        if latest:
            note += "。最新月は速報値(原本の注: current month estimates are preliminary)"
        obs.append({
            "obs_id": make_id(SID, c["cat_code"], d["dt_code"], r["is_adj"], p),
            "country": "US", "layer": "spending",
            "category": "Construction Spending (Value of Construction Put in Place)",
            "item_name": c["cat_desc"],
            "spec": "%s, %s" % (d["dt_desc"], "Seasonally Adjusted Annual Rate" if adj else "Not Seasonally Adjusted"),
            "unit": "MLN$" + (" (annual rate)" if adj else " (monthly)"),
            "geo_level": "national", "geo_code": "US", "geo_name": "United States", "area_label": "U.S. Total",
            "price": v, "currency": "USD",
            "price_basis": "spending_million_usd_saar" if adj else "spending_million_usd_nsa",
            "price_status": "public_domain",
            "ref_value": num(rv) if rv != "" else "",
            "ref_note": ("relative standard error (percent), %s" % ets[{"1": "1", "2": "2", "3": "3"}[r["dt_idx"]]]["err_code"]) if rv != "" else "",
            "period": p, "source_id": SID, "source_page": "VIP-mf.csv", "evidence_url": URL, "license": LIC,
            "note": note,
        })
    obs.sort(key=lambda o: (o["period"], o["spec"], o["item_name"]))
    write_obs(OUT, obs)

    # 照合
    code2idx = {c["cat_code"]: k for k, c in cats.items()}
    def children_of(parent_idx):
        """CATEGORIES の並びと字下げで子を決める(README の説明どおり)。"""
        ks = sorted(cats, key=int)
        i = ks.index(parent_idx)
        lvl = int(cats[parent_idx]["cat_indent"])
        ch = []
        for k in ks[i + 1:]:
            l = int(cats[k]["cat_indent"])
            if l <= lvl:
                break
            if l == lvl + 1:
                ch.append(k)
        return ch
    checks = collections.OrderedDict()
    since = [p for p in per_list if period(pers[str(p)]) >= "2016-01"]
    def add(name, diffs, note=""):
        def summ(ds):
            return {"n": len(ds), "exact": sum(1 for d in ds if abs(d[0]) < 1e-9),
                    "abs_diff_le_1": sum(1 for d in ds if abs(d[0]) <= 1.0 + 1e-9),
                    "max_abs_diff": max((abs(d[0]) for d in ds), default=0),
                    "worst": list(max(ds, key=lambda d: abs(d[0]))) if ds else None}
        checks[name] = {"all": summ(diffs), "since_2016": summ([d for d in diffs if period(d[1]) >= "2016-01"])}
        if note:
            checks[name]["note"] = note
    adjname = {"0": "NSA", "1": "SAAR"}
    for adj, tot, res, nonres in (("0", "XXXX", "00XX", "NRXX"), ("1", "AXXXX", "A00XX", "ANRXX")):
        t, rs, nr = code2idx[tot], code2idx[res], code2idx[nonres]
        kids = children_of(nr)
        for dt in ("1", "2", "3"):
            d1, d2, npresent = [], [], collections.Counter()
            for per in per_list:
                ps = str(per)
                a = val.get((ps, t, dt, adj)); b = val.get((ps, rs, dt, adj)); c = val.get((ps, nr, dt, adj))
                if None not in (a, b, c):
                    d1.append((a - b - c, pers[ps]))
                present = [x for x in (val.get((ps, k, dt, adj)) for k in kids) if x is not None]
                npresent[len(present)] += 1
                if c is not None and len(present) == len(kids):
                    d2.append((c - sum(present), pers[ps]))
            dc = dts[dt]["dt_code"]
            add("%s %s: Total = Residential + Nonresidential" % (adjname[adj], dc), d1)
            if d2:
                add("%s %s: Nonresidential = sum of the %d types" % (adjname[adj], dc, len(kids)), d2)
            else:
                checks["%s %s: Nonresidential = sum of types" % (adjname[adj], dc)] = {
                    "not_applicable": "この系列は種類が %s 個しか公表されておらず(全 %d 種類のうち)、和は成り立たない" % (dict(npresent), len(kids))}
    for adj in ("0", "1"):
        d3 = []
        for per in per_list:
            ps = str(per)
            for k in cats:
                a = val.get((ps, k, "1", adj)); b = val.get((ps, k, "2", adj)); c = val.get((ps, k, "3", adj))
                if None not in (a, b, c):
                    d3.append((a - b - c, pers[ps], cats[k]["cat_code"]))
        add("%s: T = V + P (categories published for all three)" % adjname[adj], d3)
    rep = {"rows": len(obs), "zip_sha256": hashlib.sha256(open(ZIP, "rb").read()).hexdigest(),
           "csv_sha256": hashlib.sha256(raw).hexdigest(), "csv_bytes": len(raw), "data_updated_on": updated_raw,
           "periods": [pers[str(per_list[0])], pers[str(per_list[-1])], len(per_list)],
           "by_basis": dict(collections.Counter(o["price_basis"] for o in obs)),
           "rows_with_rse": sum(1 for o in obs if o["ref_value"] != ""),
           "series": len({(o["item_name"], o["spec"]) for o in obs}),
           "since_2016": sum(1 for o in obs if o["period"] >= "2016-01"),
           "checks": checks}
    print(json.dumps(rep, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
