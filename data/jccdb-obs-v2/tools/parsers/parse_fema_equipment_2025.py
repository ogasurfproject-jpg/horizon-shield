# -*- coding: utf-8 -*-
"""
FEMA「2025 Schedule of Equipment Rates」(raw/fema-equipment-rates-2025.pdf, 11 頁, 横置き 792x612pt) を
座標で読み、observations/us/equipment_fema_2025.csv を作る。要約を通さない。

読み方(2 通りで読み、突き合わせる)
A. 値(#, Cost Code, Unit, 2025 Rates): pdftotext -bbox-layout の語。同じ高さで隙間 3pt 未満で続く語を句にまとめ、
   句の x 中心(Rates は右寄せなので右端)に一番近い見出しの列に入れる。
B. 文字の欄(Equipment, Manufacturer, Specification, Capacity or Size, HP, Notes): この PDF はタグ付きで、
   セル 1 つが marked content 1 つ(MCID)になっている。pdfplumber の文字を MCID で束ね、束の x 中心に一番近い
   見出しの列に入れる。セルの文字が隣の列にはみ出して重なる行(例: # 365)でも、MCID なら混ざらない。
   束の中で文字の高さが 2pt を超えて変わったら改行とみなし、空白 1 つでつなぐ。
行の境: PDF に描かれた横罫線(高さ 1.5pt 未満で表の幅いっぱいの塗り矩形)。罫線の間の帯 = 1 行。
   句・束は縦の中心が入る帯に割り当てる。1 頁目の最初の帯は見出し。
照合(報告に数字で出す)
- 頁ごと: 帯の数 = "#" の数 = "$" の数 = 値の数 = pdftotext -layout で「行頭が 番号 + Cost Code」の行の数。
- "#" は 1 から通しで欠けも重複もないこと。Cost Code の重複・昇順でない箇所。
- A と B の突き合わせ: #, Cost Code, Unit, Rate は全行で一致すること。文字の欄は空白を除いて比べ、違う行を数える。
- 見出し中心との距離(A の句、B の束)の列ごとの最大値と、2 番目に近い見出しとの差の最小値。
"""
import re, sys, os, json, subprocess, html, collections
import pdfplumber

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from obs_common import make_id, num, write_obs

SID = "fema-equipment-rates-2025"
PDF = os.path.join(ROOT, "raw", "fema-equipment-rates-2025.pdf")
OUT = os.path.join(ROOT, "observations", "us", "equipment_fema_2025.csv")
URL = "https://www.fema.gov/sites/default/files/documents/fema_pa_schedule-equipment-rates_2025.pdf"
LIC = "US-PD-17USC105"

COLS = ["#", "Cost Code", "Equipment", "Manufacturer", "Specification", "Capacity or Size", "HP", "Notes", "Unit", "2025 Rates"]
TEXT_COLS = ["Equipment", "Manufacturer", "Specification", "Capacity or Size", "HP", "Notes"]
RATE_RIGHT = 728.3  # 1 頁目 1 行目の値 "1.80" の右端(x=728.31)。Rates 列は右寄せ
UNIT_BASIS = {"hour": "equipment_rate_hourly", "mile": "equipment_rate_per_mile"}


def bbox_words():
    out = subprocess.run(["pdftotext", "-bbox-layout", PDF, "-"], capture_output=True, text=True, check=True).stdout
    res = []
    for pg in out.split("<page ")[1:]:
        ws = re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', pg)
        res.append([(float(a), float(b), float(c), float(d), html.unescape(w)) for a, b, c, d, w in ws])
    return res


def layout_row_counts():
    txt = subprocess.run(["pdftotext", "-layout", PDF, "-"], capture_output=True, text=True, check=True).stdout
    return [sum(1 for ln in p.splitlines() if re.match(r"^\s*\d+\s+8\d{3}(\.\d+)?\s", ln)) for p in txt.split("\f") if p.strip()]


def plumber_pages():
    """頁ごとに (横罫線の y のリスト, MCID の束のリスト)。束 = (x0, top, x1, bottom, text)。"""
    res = []
    with pdfplumber.open(PDF) as pdf:
        for p in pdf.pages:
            ys = sorted(r["top"] + r["height"] / 2 for r in p.rects if r["height"] < 1.5 and r["width"] > 600)
            groups = collections.OrderedDict()
            for c in p.chars:
                if c.get("mcid") is None:
                    continue  # 頁の見出し・頁番号(Artifact)
                groups.setdefault(c["mcid"], []).append(c)
            bundles = []
            for mcid, cs in groups.items():
                t, prev = "", None
                for c in cs:
                    if prev is not None and not t.endswith(" ") and c["text"] != " ":
                        # 改行(高さが 2pt を超えて変わる)か、同じ行で 1pt を超えて離れていれば空白を 1 つ入れる
                        if abs(c["top"] - prev["top"]) > 2.0 or c["x0"] - prev["x1"] > 1.0:
                            t += " "
                    t += c["text"]
                    prev = c
                t = re.sub(r"\s+", " ", t).strip()
                bundles.append((min(c["x0"] for c in cs), min(c["top"] for c in cs), max(c["x1"] for c in cs),
                                max(c["bottom"] for c in cs), t))
            res.append((ys, bundles))
    return res


def phrases(ws):
    lines = []
    for w in sorted(ws, key=lambda w: w[1]):
        if lines and abs(lines[-1][0] - w[1]) <= 0.6:
            lines[-1][1].append(w)
        else:
            lines.append([w[1], [w]])
    out = []
    for _, lw in lines:
        lw.sort(key=lambda w: w[0])
        cur = [lw[0]]
        for w in lw[1:]:
            if w[0] - cur[-1][2] < 3.0 and cur[-1][4] != "$" and w[4] != "$":
                cur.append(w)
            else:
                out.append(cur)
                cur = [w]
        out.append(cur)
    return [(min(w[0] for w in p), min(w[1] for w in p), max(w[2] for w in p), max(w[3] for w in p),
             " ".join(w[4] for w in p)) for p in out]


def join_lines(items):
    """(x0, top, x1, bottom, text) を上から行ごと、行の中は左から並べて空白でつなぐ。"""
    ps = sorted(items, key=lambda p: (p[1] + p[3]) / 2)
    lines = []
    for p in ps:
        yc = (p[1] + p[3]) / 2
        if lines and abs(lines[-1][0] - yc) <= 2.0:
            lines[-1][1].append(p)
        else:
            lines.append([yc, [p]])
    return " ".join(" ".join(q[4] for q in sorted(l[1], key=lambda q: q[0])) for l in lines).strip()


def main():
    wpages = bbox_words()
    ppages = plumber_pages()
    lay = layout_row_counts()
    assert len(wpages) == len(ppages) == 11
    # 見出しの x 中心は MCID の束(1 頁目の最初の帯の中)から
    ys1, b1 = ppages[0]
    hc = {}
    for b in b1:
        if ys1[0] < (b[1] + b[3]) / 2 < ys1[1] and b[4] in COLS:
            hc[b[4]] = (b[0] + b[2]) / 2
    assert set(hc) == set(COLS), hc

    stat ={"A": collections.defaultdict(lambda: [0.0, None, 1e9, None]), "B": collections.defaultdict(lambda: [0.0, None, 1e9, None])}

    def note_dist(kind, col, d, margin, pi, t):
        s = stat[kind][col]
        if d > s[0]:
            s[0], s[1] = d, (pi, t)
        if margin < s[2]:
            s[2], s[3] = margin, (pi, t)

    rows, per_page, problems = [], [], []
    for pi, (ws, (ys, bundles)) in enumerate(zip(wpages, ppages), start=1):
        bands = list(zip(ys[:-1], ys[1:]))
        if pi == 1:
            bands = bands[1:]
        def band_of(top, bottom):
            yc = (top + bottom) / 2
            hit = [i for i, (a, b) in enumerate(bands) if a < yc < b]
            return hit[0] if hit else None
        A = [collections.defaultdict(list) for _ in bands]
        B = [collections.defaultdict(list) for _ in bands]
        dollars = [0] * len(bands)
        body = [w for w in ws if ys[0] < (w[1] + w[3]) / 2 < ys[-1]]
        for ph in phrases(body):
            bi = band_of(ph[1], ph[3])
            if bi is None:
                if not (pi == 1 and (ph[1] + ph[3]) / 2 < ys[1]):
                    problems.append(("A: 帯に入らない句", pi, ph[4]))
                continue
            if ph[4] == "$":
                dollars[bi] += 1
                continue
            c = (ph[0] + ph[2]) / 2
            col = min(COLS, key=lambda k: abs(hc[k] - c))
            srt = sorted(abs(hc[k] - c) for k in COLS)
            d = abs(ph[2] - RATE_RIGHT) if col == "2025 Rates" else abs(hc[col] - c)
            note_dist("A", col, d, srt[1] - srt[0], pi, ph[4])
            A[bi][col].append(ph)
        for bd in bundles:
            if not (ys[0] < (bd[1] + bd[3]) / 2 < ys[-1]):
                continue
            bi = band_of(bd[1], bd[3])
            if bi is None:
                if not (pi == 1 and (bd[1] + bd[3]) / 2 < ys[1]):
                    problems.append(("B: 帯に入らない束", pi, bd[4]))
                continue
            c = (bd[0] + bd[2]) / 2
            col = min(COLS, key=lambda k: abs(hc[k] - c))
            srt = sorted(abs(hc[k] - c) for k in COLS)
            d = abs(bd[2] - RATE_RIGHT) if col == "2025 Rates" else abs(hc[col] - c)
            note_dist("B", col, d, srt[1] - srt[0], pi, bd[4])
            B[bi][col].append(bd)
        for bi in range(len(bands)):
            ra = {k: join_lines(A[bi].get(k, [])) for k in COLS}
            rb = {k: join_lines(B[bi].get(k, [])) for k in COLS}
            rows.append({"page": pi, "A": ra, "B": rb, "dollar": dollars[bi],
                         "n_bundles": {k: len(v) for k, v in B[bi].items()}})
        per_page.append({"page": pi, "bands": len(bands),
                         "row_numbers": sum(1 for r in rows if r["page"] == pi and re.match(r"^\d+$", r["A"]["#"])),
                         "dollars": sum(dollars),
                         "rates": sum(1 for r in rows if r["page"] == pi and r["A"]["2025 Rates"]),
                         "layout_rows": lay[pi - 1]})
    # 照合
    seq = [int(r["A"]["#"]) for r in rows if re.match(r"^\d+$", r["A"]["#"])]
    missing = sorted(set(range(1, max(seq) + 1)) - set(seq))
    dup_no = [k for k, v in collections.Counter(seq).items() if v > 1]
    codes = [r["A"]["Cost Code"] for r in rows]
    dup_code = [k for k, v in collections.Counter(codes).items() if v > 1]
    fv = [float(c) if re.match(r"^\d+(\.\d+)?$", c) else None for c in codes]
    not_asc = [(codes[i - 1], codes[i]) for i in range(1, len(codes)) if fv[i] is not None and fv[i - 1] is not None and fv[i] <= fv[i - 1]]
    bad_code = [c for c in codes if not re.match(r"^8\d{3}(\.\d+)?$", c)]

    def rate_of(s):
        s = s.replace("$", "").strip()
        return num(s) if s else ""
    ab_value_mismatch = []
    ab_text_mismatch = collections.Counter()
    ab_text_examples = []
    multi_bundle = []
    for r in rows:
        a, b = r["A"], r["B"]
        for k in ("#", "Cost Code", "Unit"):
            if a[k] != b[k]:
                ab_value_mismatch.append((a["#"], k, a[k], b[k]))
        if rate_of(a["2025 Rates"]) != rate_of(b["2025 Rates"]):
            ab_value_mismatch.append((a["#"], "2025 Rates", a["2025 Rates"], b["2025 Rates"]))
        for k in TEXT_COLS:
            if re.sub(r"\s", "", a[k]) != re.sub(r"\s", "", b[k]):
                ab_text_mismatch[k] += 1
                if len(ab_text_examples) < 12:
                    ab_text_examples.append((a["#"], k, a[k][:90], b[k][:90]))
        for k, n in r["n_bundles"].items():
            if n > 1:
                multi_bundle.append((a["#"], k, n))
    # 観測
    obs = []
    units = collections.Counter()
    for r in rows:
        a, b = r["A"], r["B"]
        u = a["Unit"]
        units[u] += 1
        spec_parts = ["Cost Code " + a["Cost Code"]]
        for k in ("Manufacturer", "Specification", "Capacity or Size", "HP", "Notes"):
            if b[k]:
                spec_parts.append("%s: %s" % (k, b[k]))
        note = ["FEMA Public Assistance の機械の料率表(2025 年版)。機械の所有と運転の費用(償却・間接費・整備・燃料・油脂・タイヤ等)を含み、"
                "オペレーターの人件費は含まない(FEMA の頁の注)。2025-07-01 以降に宣言された災害に適用。表の # %s、PDF %d 頁" % (a["#"], r["page"])]
        basis = UNIT_BASIS.get(u.lower())
        unit = "USD/" + u if u else "USD (Unit 欄が空)"
        if basis is None:
            basis = "equipment_rate_unit_not_stated"
            note.append("原本の Unit 欄が空。単位を推定しない")
        try:
            price, status = rate_of(a["2025 Rates"]), "public_domain"
        except ValueError:
            price, status = "", "not_set"
            note.append("Rate 欄が数でない: %r" % a["2025 Rates"])
        obs.append({
            "obs_id": make_id(SID, a["Cost Code"], a["#"]),
            "country": "US", "layer": "equipment",
            "category": b["Equipment"] or "(Equipment 欄が空)",
            "item_name": b["Equipment"] + (" / " + b["Manufacturer"] if b["Manufacturer"] else ""),
            "spec": "; ".join(spec_parts), "unit": unit,
            "geo_level": "national", "geo_code": "US", "geo_name": "United States",
            "price": price, "currency": "USD", "price_basis": basis, "price_status": status,
            "period": "2025", "effective_from": "2025-07-01", "source_id": SID, "source_page": str(r["page"]), "evidence_url": URL,
            "license": LIC, "note": "。".join(note),
        })
    write_obs(OUT, obs)
    rep = {
        "rows": len(rows), "header_centers": {k: round(v, 2) for k, v in hc.items()},
        "A_words_max_distance_pt": {k: round(v[0], 2) for k, v in stat["A"].items()},
        "A_words_max_distance_where": {k: v[1] for k, v in stat["A"].items()},
        "A_words_min_margin_pt": {k: round(v[2], 2) for k, v in stat["A"].items()},
        "B_mcid_max_distance_pt": {k: round(v[0], 2) for k, v in stat["B"].items()},
        "B_mcid_max_distance_where": {k: v[1] for k, v in stat["B"].items()},
        "B_mcid_min_margin_pt": {k: round(v[2], 2) for k, v in stat["B"].items()},
        "per_page": per_page, "row_number_first_last": [min(seq), max(seq)], "row_numbers_missing": missing,
        "row_numbers_duplicated": dup_no, "cost_code_duplicated": dup_code, "cost_code_not_ascending": not_asc,
        "cost_code_bad_form": bad_code, "units": dict(units),
        "rows_dollar_ne_1": [(r["A"]["#"], r["dollar"]) for r in rows if r["dollar"] != 1],
        "AB_value_mismatch": ab_value_mismatch, "AB_text_mismatch_by_col": dict(ab_text_mismatch),
        "AB_text_mismatch_examples": ab_text_examples, "cells_with_multiple_mcid": multi_bundle[:30],
        "n_cells_with_multiple_mcid": len(multi_bundle),
        "problems": [str(p) for p in problems][:20], "n_problems": len(problems),
        "status": dict(collections.Counter(o["price_status"] for o in obs)),
        "basis": dict(collections.Counter(o["price_basis"] for o in obs)),
    }
    print(json.dumps(rep, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
