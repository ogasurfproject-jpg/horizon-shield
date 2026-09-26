# -*- coding: utf-8 -*-
"""
USACE EM 1110-2-1304 Civil Works Construction Cost Index System (CWCCIS), 31 March 2026 の表
(raw/usace-cwccis-2026-03.pdf, 52 頁) を語の座標で読み、observations/us/index_usace_cwccis.csv を作る。

表: TABLE 1 QUARTERLY COST INDICES BY CWWBS FEATURE CODE(1-38 頁、1Q80〜4Q55*)
    TABLE 2 YEARLY COST INDICES BY CWWBS FEATURE CODE(39-49 頁、FY68〜FY55*)
    TABLE 3 STATE ADJUSTMENT FACTORS(50 頁)
    TABLE 4 HISTORICAL STATE ADJUSTMENT FACTORS(51-52 頁、2014〜2025)
読み方: pdftotext -bbox-layout の語。行は Wt % の語(例 5%)の高さ、列は見出し(1Q80 / FY68)の x 中心に最近傍。
照合(報告に数字):
 (1) 各頁 20 行(19 工種 + COMPOSITE)x 8 列がそろうか。pdftotext -layout の行数との一致。
 (2) COMPOSITE = 工種の Wt % による加重平均(丸めの差の分布)。
 (3) Table 2 の年度値 = Table 1 の 4 四半期の平均(FY80 以降、丸めの差)。
 (4) Table 2 の YEARLY PERCENTAGE CHANGE = COMPOSITE の前年比(小数 1 桁 %)。
 (5) 別の年版(30 September 2025、raw/usace-cwccis-2025-09.pdf)と同じ期間の値の一致数。
 (6) Table 3 と Table 4 の 2025 列の一致数。
"""
import os, re, sys, json, html, subprocess, collections, statistics

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from obs_common import make_id, num, write_obs, US_STATES

SID = "usace-cwccis-2026-03"
PDF = os.path.join(ROOT, "raw", "usace-cwccis-2026-03.pdf")
PDF_PREV = os.path.join(ROOT, "raw", "usace-cwccis-2025-09.pdf")
OUT = os.path.join(ROOT, "observations", "us", "index_usace_cwccis.csv")
URL = "https://publibrary.sec.usace.army.mil/api/download?id=9fcedc82-37ec-4b3c-e8de-1b9dfc89ebec&filename=CWCCIS_Mar_2026-Combined%20Tables.pdf&token=&preview=true"
LIC = "US-PD-17USC105"
STATE_FIPS = {v.upper(): k for k, v in US_STATES.items()}
STATE_FIPS.update({"WASHINGTON STATE": "53", "WASHINGTON D.C.": "11"})


def pages(pdf):
    out = subprocess.run(["pdftotext", "-bbox-layout", pdf, "-"], capture_output=True, text=True, check=True).stdout
    res = []
    for pg in out.split("<page ")[1:]:
        ws = re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', pg)
        res.append([(float(a), float(b), float(c), float(d), html.unescape(w)) for a, b, c, d, w in ws])
    return res


def yc(w):
    return (w[1] + w[3]) / 2


def xc(w):
    return (w[0] + w[2]) / 2


NUMW = re.compile(r"^\d{1,5}\.\d{2}$")
WT = re.compile(r"^\d{1,3}%$")


def parse_index_page(ws, kind):
    """kind = 'Q'(Table 1)か 'Y'(Table 2)。{'cols': [(label, sub1, sub2)], 'rows': [(code, name, wt, [vals]...)], 'pct': [...], 'maxd': float}"""
    hdr_re = re.compile(r"^\dQ\d{2}\*?$") if kind == "Q" else re.compile(r"^FY\d{2}\*?$")
    heads = sorted([w for w in ws if hdr_re.match(w[4])], key=xc)
    assert len(heads) == 8, [w[4] for w in heads]
    hx = [xc(h) for h in heads]
    hy = yc(heads[0])
    # 見出しの下の 2 行(年 / 期間)を列ごとに集める
    sub = [[] for _ in heads]
    for w in ws:
        if hy + 3 < yc(w) < hy + 32 and w[0] > hx[0] - 30:
            i = min(range(8), key=lambda k: abs(xc(w) - hx[k]))
            sub[i].append(w)
    cols = []
    for i, h in enumerate(heads):
        lines = collections.OrderedDict()
        for w in sorted(sub[i], key=lambda w: (round(yc(w)), w[0])):
            lines.setdefault(round(yc(w) / 3), []).append(w[4])
        cols.append((h[4], re.sub(r"\s+", " ", " ".join(" ".join(v) for v in lines.values())).strip()))
    wts = sorted([w for w in ws if WT.match(w[4]) and yc(w) > hy + 20], key=yc)
    codes = [w for w in ws if re.match(r"^\d{2}$", w[4]) and w[0] < 110 and yc(w) > hy + 20]
    comp = [w for w in ws if w[4] == "COMPOSITE"]
    rows = []
    maxd = 0.0
    for wt in wts:
        y = yc(wt)
        vals = [w for w in ws if NUMW.match(w[4]) and abs(yc(w) - y) < 3.0 and w[0] > wt[2] - 2]
        if comp and abs(yc(comp[0]) - y) < 3.0:
            code, name = "COMPOSITE", "COMPOSITE INDEX (WEIGHTED AVERAGE)"
        else:
            c = min(codes, key=lambda w: abs(yc(w) - y))
            assert abs(yc(c) - y) < 12, (wt, c)
            code = c[4]
            name_ws = [w for w in ws if w[0] > c[2] and w[2] < wt[0] - 5 and abs(yc(w) - yc(c)) < 12 and not re.match(r"^\d", w[4])]
            name = " ".join(w[4] for w in sorted(name_ws, key=lambda w: (round(yc(w)), w[0])))
        assert len(vals) == 8, (code, [v[4] for v in vals])
        out = [None] * 8
        for v in vals:
            i = min(range(8), key=lambda k: abs(xc(v) - hx[k]))
            d = abs(xc(v) - hx[i])
            maxd = max(maxd, d)
            assert out[i] is None, (code, v)
            out[i] = v[4]
        rows.append((code, name, wt[4], out))
    pct = None
    pw = [w for w in ws if w[4] == "PERCENTAGE"]
    if pw:
        y = yc(pw[0])
        pv = [w for w in ws if re.match(r"^-?\d+\.\d%$", w[4]) and abs(yc(w) - y) < 3.0]
        pct = [None] * 8
        for v in pv:
            i = min(range(8), key=lambda k: abs(xc(v) - hx[k]))
            pct[i] = v[4]
    return {"cols": cols, "rows": rows, "pct": pct, "maxd": maxd}


def fy_of_q(label):
    m = re.match(r"^(\d)Q(\d{2})(\*?)$", label)
    q, yy, star = int(m.group(1)), int(m.group(2)), m.group(3)
    fy = 1900 + yy if yy >= 60 else 2000 + yy
    cal = {1: (fy - 1, 4), 2: (fy, 1), 3: (fy, 2), 4: (fy, 3)}[q]
    return fy, q, "%dQ%d" % cal, bool(star)


def fy_of_y(label):
    m = re.match(r"^FY(\d{2})(\*?)$", label)
    yy = int(m.group(1))
    return (1900 + yy if yy >= 60 else 2000 + yy), bool(m.group(2))


def read_all(pdf):
    ps = pages(pdf)
    t1, t2, t3, t4 = [], [], [], []
    for pi, ws in enumerate(ps, start=1):
        text = " ".join(w[4] for w in ws[:12])
        if "QUARTERLY" in text:
            t1.append((pi, parse_index_page(ws, "Q")))
        elif "YEARLY" in text:
            t2.append((pi, parse_index_page(ws, "Y")))
        elif "HISTORICAL" in text:
            t4.append((pi, ws))
        elif "STATE" in text and "ADJUSTMENT" in text:
            t3.append((pi, ws))
    return t1, t2, t3, t4


def parse_t3(ws):
    """2 段組み。行ごとに左右の半分で、最後の語が値、その前が州名。"""
    sts = [w for w in ws if w[4] == "STATE" and w[1] > 150]
    y0 = min(w[1] for w in sts)
    heads = sorted([w for w in sts if abs(w[1] - y0) < 2], key=lambda w: w[0])
    assert len(heads) == 2, heads
    hx0 = [h[0] for h in heads]
    vals = [w for w in ws if re.match(r"^\d\.\d{2}$", w[4])]
    out = []
    for v in vals:
        b = max(i for i in range(2) if hx0[i] - 1 <= v[0])
        names = [w for w in ws if abs(yc(w) - yc(v)) < 3 and hx0[b] - 1 <= w[0] < v[0] and not re.match(r"^\d", w[4])]
        name = " ".join(w[4] for w in sorted(names, key=lambda w: w[0]))
        out.append((name, v[4], v))
    return out


def parse_t4(ws):
    yw = [w for w in ws if re.match(r"^20\d{2}$", w[4])]
    sthdr = [w for w in ws if w[4] == "STATE" and sum(1 for y in yw if abs(yc(y) - yc(w)) < 3) >= 10][0]
    yrs = sorted([w for w in yw if abs(yc(w) - yc(sthdr)) < 3], key=xc)
    hx = [xc(w) for w in yrs]
    hy = yc(yrs[0])
    rows = collections.OrderedDict()
    maxd = 0.0
    for v in [w for w in ws if re.match(r"^\d\.\d{2}$", w[4]) and yc(w) > hy + 3]:
        i = min(range(len(hx)), key=lambda k: abs(xc(v) - hx[k]))
        maxd = max(maxd, abs(xc(v) - hx[i]))
        key = round(yc(v))
        rows.setdefault(key, {"y": yc(v), "vals": {}})
        assert yrs[i][4] not in rows[key]["vals"]
        rows[key]["vals"][yrs[i][4]] = v[4]
    out = []
    for k, r in rows.items():
        names = [w for w in ws if abs(yc(w) - r["y"]) < 3 and w[2] < hx[0] - 15 and not re.match(r"^\d", w[4])]
        out.append((" ".join(w[4] for w in sorted(names, key=lambda w: w[0])), r["vals"]))
    return out, [w[4] for w in yrs], maxd


def main():
    t1, t2, t3, t4 = read_all(PDF)
    rows = []
    rep = collections.OrderedDict()
    rep["pages"] = {"table1": [p for p, _ in t1], "table2": [p for p, _ in t2], "table3": [p for p, _ in t3], "table4": [p for p, _ in t4]}
    idx = {}  # (table, code, label) -> value
    maxd = 0.0
    label_issues = []
    for tname, tbl, kind in (("TABLE 1, QUARTERLY COST INDICES BY CWWBS FEATURE CODE", t1, "Q"), ("TABLE 2, YEARLY COST INDICES BY CWWBS FEATURE CODE", t2, "Y")):
        for pi, pg in tbl:
            maxd = max(maxd, pg["maxd"])
            assert len(pg["rows"]) == 20, (pi, len(pg["rows"]))
            for ci, (label, subl) in enumerate(pg["cols"]):
                badlabel = False
                if kind == "Q":
                    fy, q, period, star = fy_of_q(label)
                    exp_year = str(fy - 1 if q == 1 else fy)
                    if not subl.startswith(exp_year):
                        label_issues.append((pi, label, subl)); badlabel = True
                else:
                    fy, star = fy_of_y(label)
                    period = "FY%d" % fy
                    exp = "Oct %02d - Sep %02d" % ((fy - 1) % 100, fy % 100)
                    if subl != exp:
                        label_issues.append((pi, label, subl)); badlabel = True
                for code, name, wt, vals in pg["rows"]:
                    v = vals[ci]
                    idx[(kind, code, label.rstrip("*"))] = float(v)
                    item = "COMPOSITE INDEX (WEIGHTED AVERAGE)" if code == "COMPOSITE" else "%s %s" % (code, name)
                    spec = "Wt %% %s; %s (%s)" % (wt, label, subl)
                    note = ["CWCCIS(EM 1110-2-1304、31 March 2026 版)。Base Year 1967 = 100"]
                    if kind == "Q":
                        note.append("会計年度の四半期 %s(FY%d 第 %d 四半期)を暦の四半期 %s として period に入れた" % (label, fy, q, period))
                    if star:
                        note.append("FY* indicates data developed based on OMB projections(推計、原文の注)")
                    if badlabel:
                        note.append("原本の列見出しの期間は '%s' と印字(%s の期間と合わない。誤植とみられる。period は FY の番号から付けた)" % (subl, label))
                    rows.append(dict(obs_id=make_id(SID, kind, code, label), country="US", layer="index", category=tname,
                                     item_name=item, spec=spec, unit="index (1967 = 100)", geo_level="national",
                                     geo_code="US", geo_name="United States", price=num(v), currency="",
                                     price_basis="index_value", price_status="public_domain", period=period,
                                     source_id=SID, source_page=str(pi), evidence_url=URL, license=LIC, note="。".join(note)))
    rep["max_center_distance_pt"] = round(maxd, 2)
    rep["label_issues"] = label_issues
    # Table 3
    t3v = []
    for pi, ws in t3:
        for name, v, w in parse_t3(ws):
            fips = STATE_FIPS[name]
            t3v.append((name, v))
            rows.append(dict(obs_id=make_id(SID, "T3", name), country="US", layer="index", category="TABLE 3, STATE ADJUSTMENT FACTORS",
                             item_name="State Adjustment Factor", spec="TABLE 3, STATE ADJUSTMENT FACTORS(31 March 2026 版の現行値)",
                             unit="factor", geo_level="state", geo_code=fips, geo_name=US_STATES[fips], area_label=name,
                             price=num(v), currency="", price_basis="state_adjustment_factor", price_status="public_domain",
                             period="2026-03", source_id=SID, source_page=str(pi), evidence_url=URL, license=LIC,
                             note="CWCCIS の州ごとの調整係数(EM 1110-2-1304、31 March 2026 版)。period は版の年月"))
    rep["table3_states"] = len(t3v)
    t4v = {}
    t4max = 0.0
    for pi, ws in t4:
        lst, yrs, md = parse_t4(ws)
        t4max = max(t4max, md)
        for name, vals in lst:
            fips = STATE_FIPS[name]
            assert len(vals) == len(yrs) == 12, (name, vals)
            for y, v in vals.items():
                t4v[(name, y)] = v
                rows.append(dict(obs_id=make_id(SID, "T4", name, y), country="US", layer="index",
                                 category="TABLE 4, HISTORICAL STATE ADJUSTMENT FACTORS", item_name="State Adjustment Factor",
                                 spec="TABLE 4, HISTORICAL STATE ADJUSTMENT FACTORS; For Information Only", unit="factor",
                                 geo_level="state", geo_code=fips, geo_name=US_STATES[fips], area_label=name, price=num(v),
                                 currency="", price_basis="state_adjustment_factor", price_status="public_domain", period=y,
                                 source_id=SID, source_page=str(pi), evidence_url=URL, license=LIC,
                                 note="CWCCIS の州ごとの調整係数の過去値(For Information Only、原文)"))
    rep["table4_cells"] = len(t4v)
    rep["table4_max_center_distance_pt"] = round(t4max, 2)
    # 照合 (6) Table 3 と Table 4 の 2025 列
    m = sum(1 for name, v in t3v if t4v.get((name if name != "WASHINGTON STATE" else "WASHINGTON", "2025")) == v)
    rep["table3_eq_table4_2025"] = "%d/%d" % (m, len(t3v))
    rep["table3_ne_table4_2025"] = [(n, v, t4v.get((n if n != "WASHINGTON STATE" else "WASHINGTON", "2025"))) for n, v in t3v
                                    if t4v.get((n if n != "WASHINGTON STATE" else "WASHINGTON", "2025")) != v]
    # 照合 (2) COMPOSITE と加重平均
    diffs = []
    for kind, tbl in (("Q", t1), ("Y", t2)):
        for pi, pg in tbl:
            for ci in range(8):
                comp = None; s = 0.0; wsum = 0
                for code, name, wt, vals in pg["rows"]:
                    if code == "COMPOSITE":
                        comp = float(vals[ci])
                    else:
                        s += float(wt.rstrip("%")) * float(vals[ci]); wsum += int(wt.rstrip("%"))
                diffs.append((abs(s / wsum - comp), kind, pi, pg["cols"][ci][0], round(s / wsum, 3), comp))
    diffs.sort(reverse=True)
    rep["composite_vs_weighted"] = {"cells": len(diffs), "within_0.01": sum(1 for d in diffs if d[0] <= 0.0100001),
                                    "within_0.05": sum(1 for d in diffs if d[0] <= 0.05), "max": diffs[0], "top5": diffs[:5],
                                    "weight_sum": wsum}
    # 照合 (3) 年度値 = 四半期 4 つの平均
    d3 = []
    codes = sorted({k[1] for k in idx if k[0] == "Y"})
    for (kind, code, label), v in idx.items():
        if kind != "Y":
            continue
        fy = int(label[2:])
        qs = [idx.get(("Q", code, "%dQ%02d" % (q, fy))) for q in (1, 2, 3, 4)]
        if all(x is not None for x in qs):
            d3.append((abs(sum(qs) / 4 - v), code, label, round(sum(qs) / 4, 3), v))
    d3.sort(reverse=True)
    rep["yearly_vs_quarter_mean"] = {"pairs": len(d3), "within_0.01": sum(1 for d in d3 if d[0] <= 0.0100001),
                                     "within_0.05": sum(1 for d in d3 if d[0] <= 0.05), "top5": d3[:5]}
    # 照合 (4) YEARLY PERCENTAGE CHANGE
    ok = ng = 0; bad = []
    prev = None
    ycomp = {}
    for pi, pg in t2:
        for ci, (label, _) in enumerate(pg["cols"]):
            comp = [float(vals[ci]) for code, n, wt, vals in pg["rows"] if code == "COMPOSITE"][0]
            ycomp[label.rstrip("*")] = comp
            p = pg["pct"][ci] if pg["pct"] else None
            fy = int(label[2:4])
            prevl = "FY%02d" % ((fy - 1) % 100)
            if p and prevl in ycomp:
                calc = (comp / ycomp[prevl] - 1) * 100
                if abs(calc - float(p.rstrip("%"))) <= 0.051:
                    ok += 1
                else:
                    ng += 1; bad.append((label, p, round(calc, 3)))
    rep["yearly_pct_change"] = {"ok": ok, "ng": ng, "bad": bad[:10]}
    # 照合 (5) 別の年版
    if os.path.exists(PDF_PREV):
        p1, p2, _, _ = read_all(PDF_PREV)
        prev = {}
        for kind, tbl in (("Q", p1), ("Y", p2)):
            for pi, pg in tbl:
                for ci, (label, _) in enumerate(pg["cols"]):
                    for code, name, wt, vals in pg["rows"]:
                        prev[(kind, code, label.rstrip("*"), label.endswith("*"))] = float(vals[ci])
        cmpd = collections.Counter(); firstdiff = {}
        for (kind, code, label, star), pv in prev.items():
            cur = idx.get((kind, code, label))
            if cur is None:
                cmpd["missing"] += 1; continue
            k = "%s_%s" % (kind, "proj" if star else "actual")
            if abs(cur - pv) < 1e-9:
                cmpd[k + "_equal"] += 1
            else:
                cmpd[k + "_diff"] += 1
                firstdiff.setdefault(k, []).append((code, label))
        rep["vs_2025_09"] = dict(cmpd)
        rep["vs_2025_09_diff_examples"] = {k: v[:6] for k, v in firstdiff.items()}
    # 照合 (1) pdftotext -layout で頁ごとに「数.2桁」の語を数え、bbox で読んだ値の数と比べる
    lay = subprocess.run(["pdftotext", "-layout", PDF, "-"], capture_output=True, text=True, check=True).stdout.split("\f")
    per = collections.Counter()
    for pi, pg in t1 + t2:
        n_lay = len(re.findall(r"(?<![\d.])\d{1,5}\.\d{2}(?![\d%])", lay[pi - 1]))
        n_bb = sum(1 for r in pg["rows"] for v in r[3] if v is not None)
        per["equal" if n_lay == n_bb else "diff"] += 1
    rep["layout_vs_bbox_pages"] = dict(per)
    n = write_obs(OUT, rows)
    rep["rows"] = n
    rep["by_category"] = dict(collections.Counter(r["category"] for r in rows))
    print(json.dumps(rep, ensure_ascii=False, indent=1, default=str))


if __name__ == "__main__":
    main()
