# -*- coding: utf-8 -*-
"""
USACE EP 1110-1-8 Construction Equipment Ownership and Operating Expense Schedule
"Hourly Equipment Ownership and Operating Expense (formerly Table 2-1)" の地域別 PDF
(raw/usace-ep1110-r<N>-2024.pdf、N = 1..12、Pamphlet Year 2024、頁の脚注 "EP 1110-1-8 • 30 September 2024")
を座標で読み、observations/us/equipment_usace_ep1110_2024.csv を作る。

2 通りで読み、突き合わせる:
 B(主): タグ付き PDF の marked content(MCID、セル 1 つ = 1 束)を pdfplumber で束ね、束の x 中心に一番近い
        見出し(9/1/2021 = Value TEV, Avg, Stby, DEPR, FCCM, Fuel, CWT)の列に入れる。Model / Equipment Description /
        Engine Horsepower and Fuel Type(Main, Carrier)は x の範囲で分ける。束の中で文字の高さが 2pt を超えて変わったら改行とみなし空白でつなぐ。
 A(照合): pdftotext -bbox-layout の語。SourceTag の語と同じ高さの語を見出し中心に最近傍で割り当てる。
 C(照合): pdftotext -layout の行頭が SourceTag の行の数(頁ごと)と、その行の $ の値の並び。
行: SourceTag(例 A10RS009、[A-Z]\\d{2}[A-Z0-9]{2}\\d{3})で始まる行 = 1 機械。左端 x < 85 の行(カテゴリ・サブカテゴリ・メーカー名)で区切る。
値: Avg(平均条件の総時間単価 = 所有 + 運転、EP 2.3)、Stby(待機時間単価 = DEPR x 0.5 + FCCM、EP 2.26)、DEPR、FCCM、Fuel を
    1 行ずつ(USD/hour)。Value TEV(Total Equipment Value、EP 2.12)と CWT(shipping weight, hundredweight)は spec に原文で。

使い方: python3 parse_usace_ep1110_2024.py [地域番号 ...]   (省略時 1..12。"check" なら読み直さず中間結果から照合と CSV だけ)。地域ごとの中間結果を tools/parsers/out/ep1110_r<N>.json に置き、
        最後に全地域の中間結果から CSV を書く(中間結果が無い地域は読む)。
"""
import os, re, sys, json, html, subprocess, collections
import pdfplumber

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from obs_common import make_id, num, write_obs

OUT = os.path.join(ROOT, "observations", "us", "equipment_usace_ep1110_2024.csv")
CACHE = os.path.join(ROOT, "tools", "parsers", "out")
LIC = "US-PD-17USC105"
URLS = {r: "https://www.nww.usace.army.mil/Portals/28/REGION%%20%d%%20TABLE%%202-1%s.pdf" % (r, "_1" if r in (6, 10) else "") for r in range(1, 13)}
REGION_NAME = {1: "Region 1 - Northeast", 2: "Region 2 - Mideast", 3: "Region 3 - Southeast", 4: "Region 4 - North Central",
               5: "Region 5 - Midwest", 6: "Region 6 - Southwest", 7: "Region 7 - West", 8: "Region 8 - Northwest",
               9: "Region 9 - Alaska", 10: "Region 10 - Hawaii", 11: "Region 11 - Puerto Rico", 12: "Region 12 - Kwajalein"}
# EP 1110-1-8(12 August 2021)Appendix A, A.3 Geographic Regions の原文(2 段組みを左の段、右の段の順に)
REGION_MEMBERS = {
    1: "Connecticut; Maine; Massachusetts; New Hampshire; New Jersey; New York; Pennsylvania; Rhode Island; Vermont",
    2: "Delaware; District of Columbia; Illinois (East of U.S. Highway 51); Kentucky (East of U.S. Highway 51); Indiana; Maryland; Michigan (Lower Peninsula); Ohio; Virginia; West Virginia",
    3: "Alabama; Florida; Georgia; Louisiana; Mississippi; Arkansas; Missouri (Panhandle South of 36° -30'00\"); North Carolina; South Carolina; Tennessee",
    4: "Iowa (North of U.S. Highway 20); Michigan (Upper Peninsula); Minnesota; Montana; North Dakota; South Dakota; Wisconsin; Wyoming",
    5: "Colorado; Illinois (West of U.S. Highway 51); Iowa (South of U.S. Highway 20); Kansas; Kentucky (West of U.S. Highway 51); Missouri (North of 36° -30'00\"); Nebraska",
    6: "New Mexico; Oklahoma; Texas", 7: "Arizona; California; Nevada; Utah", 8: "Idaho; Oregon; Washington",
    9: "Alaska", 10: "Hawaii", 11: "Puerto Rico", 12: "Kwajalein Island"}
TAG = re.compile(r"^[A-Z]\d{2}[A-Z0-9]{2}\d{3}$")
MONEY = re.compile(r"^\$[\d,]+(\.\d{2})?$")
VALCOLS = ["TEV", "Avg", "Stby", "DEPR", "FCCM", "Fuel", "CWT"]
BASIS = {"Avg": "equipment_rate_hourly", "Stby": "equipment_standby_rate_hourly", "DEPR": "equipment_depreciation_hourly",
         "FCCM": "equipment_fccm_hourly", "Fuel": "equipment_fuel_hourly"}
NOTE = {"Avg": "Avg: 平均の運転条件での総時間単価(所有費 DEPR + FCCM と運転費 燃料・FOG・修理・タイヤの和、40 時間/週で計算、EP 1110-1-8 2.3)。オペレーターの人件費を含まない",
        "Stby": "Stby: 待機時間単価(Standby Rate/hr = DEPR/hr x 0.50 + FCCM/hr、EP 1110-1-8 2.26)",
        "DEPR": "DEPR: 時間あたりの減価償却(時間単価の要素、EP 1110-1-8 2.3 a)",
        "FCCM": "FCCM: Facilities Capital Cost of Money / 時間(FAR 31.205-10、時間単価の要素)",
        "Fuel": "Fuel: 時間あたりの燃料費(平均条件、時間単価の要素)"}


def pdf_path(r):
    return os.path.join(ROOT, "raw", "usace-ep1110-r%d-2024.pdf" % r)


def bbox_pages(pdf):
    out = subprocess.run(["pdftotext", "-bbox-layout", pdf, "-"], capture_output=True, text=True, check=True).stdout
    res = []
    for pg in out.split("<page ")[1:]:
        ws = re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', pg)
        res.append([(float(a), float(b), float(c), float(d), html.unescape(w)) for a, b, c, d, w in ws])
    return res


def layout_pages(pdf):
    txt = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True, check=True).stdout
    res = []
    for p in txt.split("\f"):
        tags = []
        for ln in p.splitlines():
            m = re.match(r"^([A-Z]\d{2}[A-Z0-9]{2}\d{3})\s", ln)
            if m:
                tags.append((m.group(1), re.findall(r"\$[\d,]+(?:\.\d{2})?", ln)))
        res.append(tags)
    return res


def header(ws):
    """頁の見出しの列の位置。"""
    h = {}
    row = [w for w in ws if 75 < w[1] < 95]
    for w in row:
        t = w[4]
        key = {"9/1/2021": "TEV", "Avg": "Avg", "Stby": "Stby", "DEPR": "DEPR", "FCCM": "FCCM", "Fuel": "Fuel", "CWT": "CWT",
               "Main": "Main", "Carrier": "Carrier", "Model": "Model", "Equipment": "Equipment", "SourceTag": "SourceTag"}.get(t)
        if key:
            h[key] = w
    assert set(h) >= set(VALCOLS + ["Main", "Carrier", "Model", "Equipment"]), sorted(h)
    return h


def cx(b):
    return (b[0] + b[2]) / 2


def plumber_bundles(page):
    groups = collections.OrderedDict()
    for c in page.chars:
        if c.get("mcid") is None:
            continue
        groups.setdefault(c["mcid"], []).append(c)
    out = []
    for mcid, cs in groups.items():
        t, prev = "", None
        for c in cs:
            if prev is not None and not t.endswith(" ") and c["text"] != " ":
                if abs(c["top"] - prev["top"]) > 2.0 or c["x0"] - prev["x1"] > 1.0:
                    t += " "
            t += c["text"]
            prev = c
        t = re.sub(r"\s+", " ", t).strip()
        if not t:
            continue
        ink = [c for c in cs if c["text"].strip()]
        out.append((min(c["x0"] for c in ink), min(c["top"] for c in ink), max(c["x1"] for c in ink), max(c["bottom"] for c in ink), t, mcid))
    return out


def split_engine(items, main_x, carr_x):
    """Main / Carrier の欄: 燃料の種類(文字)と馬力(数)。"""
    res = {"Main": [], "Carrier": []}
    for b in items:
        k = "Main" if cx(b) < (main_x + carr_x) / 2 else "Carrier"
        res[k].append(b[4])
    return {k: " ".join(v) for k, v in res.items()}


def lines_of(items, tol=2.0):
    items = sorted(items, key=lambda b: ((b[1] + b[3]) / 2, b[0]))
    lines = []
    for b in items:
        y = (b[1] + b[3]) / 2
        if lines and abs(lines[-1][0] - y) <= tol:
            lines[-1][1].append(b)
        else:
            lines.append([y, [b]])
    for ln in lines:
        ln[1].sort(key=lambda b: b[0])
    return lines


def records_from(items, hy, fy, ctx, what):
    """items(語か束)を行にまとめ、SourceTag の行から次の区切りの行までを 1 機械にする。"""
    cat, sub, mfr = ctx
    recs, orphans = [], []
    cur = None
    last = None
    last_line = (0.0, [])
    # 頁の脚注(EP 1110-1-8 • 30 September 2024)は最後の行と高さが重なることがあるので、脚注の上端より 2pt 上までを本文とする
    for y, lb in lines_of([b for b in items if hy + 1 < b[1] and b[1] < fy - 2.0 and not b[4].startswith("EP 1110-1-8")]):
        left = lb[0]
        if left[0] < 85:
            first = left[4].split()[0]
            if TAG.match(first):
                cur = {"tag": first, "y": y, "cat": cat, "sub": sub, "mfr": mfr, "items": list(lb)}
                recs.append(cur)
                continue
            joined = " ".join(b[4] for b in lb)
            if left[0] > 30 and re.match(r"^[A-Z]\d{2}$", first):
                sub = joined; last = "sub"
            elif left[0] < 30 and re.match(r"^[A-Z]\d{2}$", first):
                cat = joined; sub = None; last = "cat"
            else:
                mfr = joined; last = "mfr"
            last_line = (y, list(lb))
            cur = None
            continue
        if cur is None:
            # 区切りの行(カテゴリ・サブカテゴリ・メーカー名)に属する語。高さが 6pt 未満しか違わなければ同じ行の語として x の順に並べ直し、
            # それより下なら折り返しの 2 行目として後ろにつなぐ
            ly, lwords = last_line
            if abs(y - ly) < 6.0:
                merged = sorted(lwords + list(lb), key=lambda b: b[0])
                last_line = (ly, merged)
                txt = " ".join(b[4] for b in merged)
                how = "same_line"
            else:
                txt = {"sub": sub, "cat": cat, "mfr": mfr}.get(last) or ""
                txt = (txt + " " + " ".join(b[4] for b in lb)).strip()
                last_line = (ly, lwords + list(lb))
                how = "wrapped"
            if last == "sub":
                sub = txt
            elif last == "cat":
                cat = txt
            elif last == "mfr":
                mfr = txt
            orphans.append((what, last, how, " ".join(b[4] for b in lb)))
            continue
        cur["items"].extend(lb)
    return recs, orphans, (cat, sub, mfr)


def assign(rec, centers, desc_x0, eng_x0, main_x, carr_x, maxd, mind2, kind, probs, pi):
    model, desc, eng, vals = [], [], [], {}
    for b in rec["items"][1:] if rec["items"][0][4] == rec["tag"] else rec["items"]:
        c = cx(b)
        t = b[4]
        if b[0] >= 515 and (MONEY.match(t) or re.match(r"^\d+(\.\d+)?$", t)):
            k = min(VALCOLS, key=lambda k: abs(c - centers[k]))
            d = sorted(abs(c - centers[x]) for x in VALCOLS)
            maxd[kind + ":" + k] = max(maxd.get(kind + ":" + k, 0.0), d[0])
            mind2[kind + ":" + k] = min(mind2.get(kind + ":" + k, 1e9), d[1] - d[0])
            if k in vals:
                probs.append((kind + "_dup_col", pi, rec["tag"], k, vals[k], t))
            vals[k] = t
        elif b[0] >= 515:
            probs.append((kind + "_stray_right", pi, rec["tag"], t))
        elif b[0] >= eng_x0:
            eng.append(b)
        elif b[0] >= desc_x0 - 3:
            desc.append(b)
        else:
            model.append(b)
    rec["model"] = " ".join(b[4] for b in model)
    rec["desc"] = " ".join(b[4] for b in desc)
    rec["engine"] = split_engine(eng, main_x, carr_x)
    rec["vals"] = vals
    missing = [k for k in VALCOLS if k not in vals]
    if missing:
        probs.append((kind + "_missing", pi, rec["tag"], missing))


def read_region(r):
    pdf = pdf_path(r)
    wpages = bbox_pages(pdf)
    lpages = layout_pages(pdf)
    recs = []
    stat = collections.Counter()
    maxd, mind2 = {}, {}
    probs = []
    ctxA = ctxB = (None, None, None)
    with pdfplumber.open(pdf) as doc:
        assert len(doc.pages) == len(wpages)
        for pi, (page, ws) in enumerate(zip(doc.pages, wpages), start=1):
            h = header(ws)
            hy = max(w[3] for w in h.values())
            foot = [w for w in ws if w[4] == "EP" and w[1] > 500]
            fy = min(w[1] for w in foot) if foot else 1e9
            centers = {k: cx(h[k]) for k in VALCOLS}
            desc_x0 = h["Equipment"][0]
            main_x, carr_x = cx(h["Main"]), cx(h["Carrier"])
            eng_x0 = h["Main"][0] - 12
            # ---- A(主): bbox の語
            ra, orph, ctxA = records_from(ws, hy, fy, ctxA, "A")
            probs.extend(("A_orphan", pi, o) for o in orph)
            for rec in ra:
                rec["page"] = pi
                assign(rec, centers, desc_x0, eng_x0, main_x, carr_x, maxd, mind2, "A", probs, pi)
                del rec["items"]
            # ---- B(照合): MCID の束。束が細かく切れている頁だけ使える
            bs = plumber_bundles(page)
            rb, orphb, ctxB = records_from(bs, hy, fy, ctxB, "B")
            bvals = {}
            for rec in rb:
                assign(rec, centers, desc_x0, eng_x0, main_x, carr_x, maxd, mind2, "B", [], pi)
                bvals[rec["tag"]] = rec
            # ---- C(照合): -layout の行
            lay = lpages[pi - 1] if pi - 1 < len(lpages) else []
            ltags = dict(lay)
            stat["pages"] += 1
            stat["pages_A_eq_C_count" if len(ra) == len(lay) else "pages_A_ne_C_count"] += 1
            if len(ra) != len(lay):
                probs.append(("count_A_C", pi, len(ra), len(lay)))
            if len(rb) == len(ra):
                stat["pages_B_usable"] += 1
            for rec in ra:
                money_a = [rec["vals"].get(k) for k in VALCOLS[:-1]]
                if ltags.get(rec["tag"]) == money_a:
                    stat["C_eq_A"] += 1
                else:
                    stat["C_ne_A"] += 1
                    probs.append(("C_ne_A", pi, rec["tag"], ltags.get(rec["tag"]), money_a))
                b = bvals.get(rec["tag"])
                if b is not None and len(rb) == len(ra):
                    stat["B_vals_eq_A" if b["vals"] == rec["vals"] else "B_vals_ne_A"] += 1
                    if b["vals"] != rec["vals"]:
                        probs.append(("B_ne_A", pi, rec["tag"], b["vals"], rec["vals"]))
                    for f in ("model", "desc"):
                        same = re.sub(r"\s+", "", b[f]) == re.sub(r"\s+", "", rec[f])
                        stat["B_%s_eq_A" % f if same else "B_%s_ne_A" % f] += 1
                        if not same:
                            probs.append(("B_%s_ne_A" % f, pi, rec["tag"], b[f], rec[f]))
                    stat["B_engine_eq_A" if b["engine"] == rec["engine"] else "B_engine_ne_A"] += 1
            recs.extend(ra)
    tagc = collections.Counter(x["tag"] for x in recs)
    stat["records"] = len(recs)
    stat["tag_duplicates"] = sum(1 for v in tagc.values() if v > 1)
    return {"region": r, "records": recs, "stat": dict(stat), "maxd": maxd, "min_margin": mind2, "problems": probs[:300],
            "n_problems": len(probs), "problem_kinds": dict(collections.Counter(p[0] for p in probs))}


def money(s):
    return num(s.replace("$", ""))


def build_rows(res):
    rows = []
    for rr in res:
        r = rr["region"]
        sid = "usace-ep1110-r%d-2024" % r
        seen = collections.Counter()
        for rec in rr["records"]:
            seen[rec["tag"]] += 1
            dupn = seen[rec["tag"]]
            eng = rec["engine"]
            spec = ["Model: %s" % (rec["model"] or "(空欄)"),
                    "Manufacturer: %s" % (rec["mfr"] or ""),
                    "Category: %s" % (rec["cat"] or ""), "Subcategory: %s" % (rec["sub"] or ""),
                    "Engine Horsepower and Fuel Type: Main %s / Carrier %s" % (eng["Main"] or "-", eng["Carrier"] or "-"),
                    "Value TEV 9/1/2021: %s" % rec["vals"].get("TEV", ""), "CWT: %s" % rec["vals"].get("CWT", "")]
            if dupn > 1:
                spec.append("原本で同じ SourceTag の %d 回目" % dupn)
            for k in ("Avg", "Stby", "DEPR", "FCCM", "Fuel"):
                v = rec["vals"].get(k)
                row = dict(obs_id=make_id(sid, rec["tag"], dupn, k), country="US", layer="equipment",
                           category=rec["cat"] or "", item_name="%s %s" % (rec["tag"], rec["desc"]), spec="; ".join(spec),
                           unit="USD/hour", geo_level="usace_ep_region", geo_code="EP-R%d" % r, geo_name=REGION_NAME[r],
                           area_label="Region: %d" % r, area_members=REGION_MEMBERS[r], currency="USD", price_basis=BASIS[k],
                           period="2024", source_id=sid, source_page=str(rec["page"]), evidence_url=URLS[r], license=LIC)
                note = NOTE[k] + "。Pamphlet Year 2024(頁の脚注 EP 1110-1-8 • 30 September 2024)"
                if v is not None and float(money(v)) > 0:
                    row["price"] = money(v); row["price_status"] = "public_domain"
                else:
                    row["price"] = ""; row["price_status"] = "not_set"
                    note += "。原本は %s(単価の 0 は設定なしとして扱う)" % (v if v is not None else "空欄")
                row["note"] = note
                rows.append(row)
    return rows


def cross_checks(allres):
    """地域をまたぐ照合と式の検算。Stby = DEPR x 0.5 + FCCM(EP 2.26)、Avg >= DEPR + FCCM + Fuel、SourceTag の並び。"""
    f = lambda v: float(v.replace("$", "").replace(",", ""))
    c = collections.Counter()
    for rr in allres:
        for x in rr["records"]:
            v = x["vals"]
            c["stby_formula_ok" if abs(0.5 * f(v["DEPR"]) + f(v["FCCM"]) - f(v["Stby"])) <= 0.0101 else "stby_formula_ng"] += 1
            c["avg_ge_parts" if f(v["Avg"]) + 0.011 >= f(v["DEPR"]) + f(v["FCCM"]) + f(v["Fuel"]) else "avg_lt_parts"] += 1
    orders = [tuple(x["tag"] for x in rr["records"]) for rr in allres]
    c["same_tag_order_all_regions"] = int(all(o == orders[0] for o in orders))
    key = lambda x: (re.sub(r"\s+", "", x["model"]), re.sub(r"\s+", "", x["desc"]), x["cat"], x["sub"], x["mfr"])
    if allres:
        for i in range(len(allres[0]["records"])):
            c["text_same_all_regions" if len({key(rr["records"][i]) for rr in allres}) == 1 else "text_differs"] += 1
    return dict(c)


def main():
    if sys.argv[1:] == ["check"]:
        regions = []
    else:
        regions = [int(a) for a in sys.argv[1:]] or list(range(1, 13))
    os.makedirs(CACHE, exist_ok=True)
    for r in regions:
        res = read_region(r)
        json.dump(res, open(os.path.join(CACHE, "ep1110_r%d.json" % r), "w", encoding="utf-8"), ensure_ascii=False)
        print(json.dumps({k: res[k] for k in ("region", "stat", "maxd", "min_margin", "n_problems", "problem_kinds")}, ensure_ascii=False))
        for p in res["problems"][:8]:
            print("  ", p)
    allres = []
    for r in range(1, 13):
        f = os.path.join(CACHE, "ep1110_r%d.json" % r)
        if os.path.exists(f):
            allres.append(json.load(open(f, encoding="utf-8")))
    print("cross_checks", json.dumps(cross_checks(allres), ensure_ascii=False))
    rows = build_rows(allres)
    n = write_obs(OUT, rows)
    print("rows", n, "regions", [x["region"] for x in allres])


if __name__ == "__main__":
    main()
