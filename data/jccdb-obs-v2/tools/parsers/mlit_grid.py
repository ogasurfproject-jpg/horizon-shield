# -*- coding: utf-8 -*-
"""
国の地方機関の「材料単価【設計】」表(材料単価決定支援システムの出力と、その体裁に合わせて作った頁)を、
罫線の格子とセルの座標で読む共通部品。

- 文字(語)は pdftotext -bbox-layout の語の座標を使う(poppler)。
- 罫線(縦線・横線)の位置は pdfplumber で読む(文字は読まない。線の座標だけ)。
- 行 = 横罫線(単位の列を横切るもの)で区切った帯。列 = 縦罫線で区切ったセル。
- 列の見出し(県名・地区名)は、表の上の見出し帯にある語のうち、1つのセルに収まる語。
  複数のセルにまたがる語(と、見出し帯を上下に分ける部分罫線より上の語)は「群ラベル」(県名)。
- 値は、値の列のセルに入っている語。数だけのセルを値とし、数でない語が入っていれば text として返す。

要約を通さない。表の読み取りで迷うもの(セルからはみ出した語、帯に入らない語)は数えて返し、呼び出し側が止める。
"""
import re, subprocess, html, collections, statistics

NUMTOK = re.compile(r"^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$")
PREF_SUFFIX = re.compile(r"^(北海道|.{2,3}[県府都])$")


def poppler_pages(pdf):
    out = subprocess.run(["pdftotext", "-bbox-layout", pdf, "-"], capture_output=True, text=True).stdout
    res = []
    for pg in out.split("<page ")[1:]:
        ws = re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', pg)
        res.append([(float(a), float(b), float(c), float(d), html.unescape(w)) for a, b, c, d, w in ws])
    return res


def layout_pages(pdf):
    out = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True).stdout
    return out.split("\f")


def plumber_pages(pdf):
    """罫線の座標と、照合用の語(pdfminer)を返す。"""
    import pdfplumber
    res = []
    with pdfplumber.open(pdf) as P:
        for p in P.pages:
            V, H = [], []
            for l in p.lines:
                if abs(l["x0"] - l["x1"]) < 1.5:
                    V.append(((l["x0"] + l["x1"]) / 2, l["top"], l["bottom"]))
                elif abs(l["top"] - l["bottom"]) < 1.5:
                    H.append(((l["top"] + l["bottom"]) / 2, l["x0"], l["x1"]))
            for r in p.rects:
                w, h = r["x1"] - r["x0"], r["bottom"] - r["top"]
                if w < 1.5 and h >= 1.5:
                    V.append(((r["x0"] + r["x1"]) / 2, r["top"], r["bottom"]))
                elif h < 1.5 and w >= 1.5:
                    H.append(((r["top"] + r["bottom"]) / 2, r["x0"], r["x1"]))
                elif w >= 1.5 and h >= 1.5:
                    V += [(r["x0"], r["top"], r["bottom"]), (r["x1"], r["top"], r["bottom"])]
                    H += [(r["top"], r["x0"], r["x1"]), (r["bottom"], r["x0"], r["x1"])]
            try:
                ws = p.extract_words()
                words = [(w["x0"], w["top"], w["x1"], w["bottom"], w["text"]) for w in ws]
            except Exception:
                words = []
            res.append({"V": V, "H": H, "words": words, "width": p.width, "height": p.height})
    return res


def merge_positions(xs, tol=1.2):
    xs = sorted(xs)
    out = []
    for x in xs:
        if out and x - out[-1][-1] <= tol:
            out[-1].append(x)
        else:
            out.append([x])
    return [sum(g) / len(g) for g in out]


def h_cover(H, y, tol=0.8):
    """高さ y の横線の区間(和集合)"""
    segs = sorted((a, b) for yy, a, b in H if abs(yy - y) <= tol)
    out = []
    for a, b in segs:
        if out and a <= out[-1][1] + 1.0:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def covers(cov, a, b):
    return any(s <= a + 0.5 and e >= b - 0.5 for s, e in cov)


def is_num(t):
    return bool(NUMTOK.match(t))


def cell_text(ws, right=None):
    """セルの語をつなぐ。同じ行の語は空白でつなぐ。行が変わるとき、前の行がセルの右端近くまで埋まっていれば
    (セルの幅で折り返した続き)空白を入れずにつなぎ、そうでなければ空白でつなぐ。"""
    ws = sorted(ws, key=lambda w: (round(w[1]), w[0]))
    lines = []
    for w in ws:
        if lines and abs(lines[-1][-1][1] - w[1]) < 2.0:
            lines[-1].append(w)
        else:
            lines.append([w])
    out = ""
    for k, ln in enumerate(lines):
        t = " ".join(w[4] for w in sorted(ln, key=lambda t: t[0]))
        if k == 0:
            out = t
        else:
            prev = lines[k - 1]
            full = right is not None and (right - max(w[2] for w in prev)) < 10.0
            out += ("" if full else " ") + t
    return out


def parse_grid_page(ws, geo, pageno, header_words_extra=()):
    """1頁を読む。戻り値 dict(ok, category, columns, rows, problems, stats)。表の頁でなければ None。"""
    W = ws
    # 見出し語
    items = [w for w in W if w[4] in ("品", "品目") or re.match(r"^品\s*目$", w[4])]
    if not items:
        return None
    hd = min(items, key=lambda w: w[1])
    head_y = hd[1]
    same = [w for w in W if abs(w[1] - head_y) < 4.0]
    def find(chars):
        c = [w for w in same if w[4] in chars]
        return c
    unit_h = find(("単", "単位"))
    spec_h = find(("規", "規格"))
    rem_h = find(("備", "備考"))
    if not unit_h or not spec_h:
        return None
    unit_x = (min(w[0] for w in unit_h) + max(w[2] for w in find(("位", "単位")) or unit_h)) / 2
    item_x = (hd[0] + max((w[2] for w in find(("目", "品目"))), default=hd[2])) / 2
    spec_x = (min(w[0] for w in spec_h) + max((w[2] for w in find(("格", "規格"))), default=spec_h[0][2])) / 2
    rem_x = None
    if rem_h:
        rem_x = (min(w[0] for w in rem_h) + max((w[2] for w in find(("考", "備考"))), default=rem_h[0][2])) / 2
    # 種別(分類)
    cat_w = [w for w in W if w[4] in ("種", "種別") and w[1] < head_y]
    cat_y = min(w[1] for w in cat_w) if cat_w else None
    category = ""
    if cat_w:
        cw = min(cat_w, key=lambda w: w[1])
        right = cw[2]
        if cw[4] == "種":
            b = [w for w in W if w[4] == "別" and abs(w[1] - cw[1]) < 2]
            if b:
                right = b[0][2]
        catws = [w for w in W if abs(w[1] - cw[1]) < 2.5 and w[0] > right and w[0] < 600 and "整備局" not in w[4]
                 and "事務局" not in w[4] and not w[4].startswith("単位")]
        category = " ".join(w[4] for w in sorted(catws, key=lambda t: t[0]))
    # 縦線(長いもの)と横線
    V = [v for v in geo["V"] if v[2] - v[1] > 3]
    H = [h for h in geo["H"] if h[2] - h[1] > 3]
    # 単位の列の左右
    vx_all = merge_positions([v[0] for v in V if v[2] > head_y + 5])
    ul = max([x for x in vx_all if x < unit_x], default=None)
    ur = min([x for x in vx_all if x > unit_x], default=None)
    if ul is None or ur is None:
        return {"ok": False, "why": "単位の列の罫線が無い", "page": pageno}
    # 行の境界: 単位の列を横切る横線
    ys = merge_positions([h[0] for h in H], tol=0.8)
    bounds = [y for y in ys if covers(h_cover(H, y), ul + 1, ur - 1) and covers(h_cover(H, y), ur + 1, ur + 25)]
    head_bottom = max(w[3] for w in same)
    first = [y for y in bounds if y > head_bottom - 0.5]
    if len(first) < 2:
        return {"ok": False, "why": "データ行の横線が無い", "page": pageno}
    # 見出し帯の下端 = 見出し語(と地区名)の下にある最初の境界。地区名の行があれば、それより下。
    # 見出し帯の語: 値の列の範囲で、head_y-15 以上、最初の境界より上
    y_first = first[0]
    # 地区名が見出しの下に続く場合(値の列だけの部分罫線で区切られる)。最初の境界は単位の列を横切る線なので、その上は全部見出し
    body_bounds = first
    table_bottom = body_bounds[-1]
    # 列: データ行の最初の帯を縦に横切る縦線
    band0 = (body_bounds[0], body_bounds[1])
    cols_x = merge_positions([v[0] for v in V if v[1] <= band0[0] + 1.0 and v[2] >= band0[1] - 1.0])
    cells = list(zip(cols_x[:-1], cols_x[1:]))
    def cell_of(x):
        for i, (a, b) in enumerate(cells):
            if a <= x < b:
                return i
        return None
    ci_item, ci_spec, ci_unit = cell_of(item_x), cell_of(spec_x), cell_of(unit_x)
    ci_rem = cell_of(rem_x) if rem_x is not None else None
    if None in (ci_item, ci_spec, ci_unit):
        return {"ok": False, "why": "品目/規格/単位の列が格子に無い", "page": pageno}
    last_val = (ci_rem - 1) if ci_rem is not None else len(cells) - 1
    val_cells = list(range(ci_unit + 1, last_val + 1))
    # 見出し帯の語(値の列の範囲)
    vz0, vz1 = cells[val_cells[0]][0], cells[val_cells[-1]][1]
    top_lim = (cat_y - 16) if cat_y is not None else head_y - 30
    hws = [w for w in W if w[1] >= top_lim and w[3] <= y_first + 0.5 and w[2] > vz0 + 0.5 and w[0] < vz1 - 0.5
           and w[4] not in ("単位：円",) and "整備局" not in w[4] and "事務局" not in w[4]
           and not (cat_y is not None and abs(w[1] - cat_y) < 2.5)]
    # 部分罫線(値の列の範囲だけ)があれば、その上は群ラベル
    seps = []
    for y in ys:
        if head_y - 20 < y < y_first - 0.5:
            cov = h_cover(H, y)
            if covers(cov, vz0 + 1, min(vz0 + 30, vz1) - 1) and not covers(cov, ul + 1, ur - 1):
                seps.append(y)
    sep_y = max(seps) if seps else None
    col_head = collections.defaultdict(list)
    labels = []
    for w in hws:
        cx = (w[0] + w[2]) / 2
        i = cell_of(cx)
        inside = i is not None and w[0] >= cells[i][0] - 1.0 and w[2] <= cells[i][1] + 1.0
        above = sep_y is not None and w[3] <= sep_y + 0.5
        if inside and not above and i in val_cells:
            col_head[i].append(w)
        else:
            labels.append(w)
    # 群ラベルの範囲: ラベルの高さまで伸びている縦線で区切る
    tallV = merge_positions([v[0] for v in V])
    label_span = []
    for w in labels:
        cx = (w[0] + w[2]) / 2
        tall = merge_positions([v[0] for v in V if v[1] <= w[1] + 0.5 and v[2] >= y_first - 1])
        lefts = [x for x in tall if x <= w[0] + 0.5]
        rights = [x for x in tall if x >= w[2] - 0.5]
        a = max(lefts) if lefts else vz0
        b = min(rights) if rights else vz1
        label_span.append((w, a, b))
    columns = []
    for i in val_cells:
        a, b = cells[i]
        head = cell_text(col_head.get(i, []))
        hl = sorted(col_head.get(i, []), key=lambda t: (t[1], t[0]))
        grp = [lw for lw, la, lb in label_span if la - 0.5 <= (a + b) / 2 <= lb + 0.5 and (lb - la) > 1]
        columns.append({"cell": i, "x0": a, "x1": b, "head": " / ".join(w[4] for w in hl), "head_ws": hl,
                        "groups": [g[4] for g in sorted(grp, key=lambda t: t[1])], "group_ws": grp})
    # 行
    rows, problems = [], []
    used = set()
    for k in range(len(body_bounds) - 1):
        y0, y1 = body_bounds[k], body_bounds[k + 1]
        bw = [w for w in W if y0 - 0.5 <= (w[1] + w[3]) / 2 < y1 + 0.5 and (w[1] + w[3]) / 2 < table_bottom + 0.5]
        per = collections.defaultdict(list)
        for w in bw:
            cx = (w[0] + w[2]) / 2
            i = cell_of(cx)
            if i is None:
                problems.append(("outside_grid", pageno, w))
                continue
            if w[0] < cells[i][0] - 1.5 or w[2] > cells[i][1] + 1.5:
                problems.append(("straddle", pageno, w))
            per[i].append(w)
            used.add(id(w))
        if not bw:
            continue
        # 上の横線が品目の列を横切っていないなら、品目のセルは上の行とつながっている(結合セル)
        cov = h_cover(H, y0)
        joined = {c: not covers(cov, cells[c][0] + 1, cells[c][1] - 1) for c in (ci_item, ci_spec, ci_unit)}
        vals = {}
        for i in val_cells:
            if per.get(i):
                vals[i] = per[i]
        rows.append({"y0": y0, "y1": y1, "item": cell_text(per.get(ci_item, []), cells[ci_item][1]),
                     "spec": cell_text(per.get(ci_spec, []), cells[ci_spec][1]),
                     "unit": cell_text(per.get(ci_unit, [])), "rem": cell_text(per.get(ci_rem, []), cells[ci_rem][1]) if ci_rem is not None else "",
                     "vals": vals, "joined": joined,
                     "other": {i: cell_text(v) for i, v in per.items() if i not in val_cells and i not in (ci_item, ci_spec, ci_unit, ci_rem)}})
    # 帯に入らなかった語のうち、表の中(見出し帯より下、表の下端より上)にあるもの
    for w in W:
        cy = (w[1] + w[3]) / 2
        if y_first < cy < table_bottom and id(w) not in used:
            problems.append(("not_in_band", pageno, w))
    foot = [w for w in W if w[1] > table_bottom + 0.5]
    return {"ok": True, "page": pageno, "category": category, "head_y": head_y, "cells": cells,
            "ci": {"item": ci_item, "spec": ci_spec, "unit": ci_unit, "rem": ci_rem}, "columns": columns,
            "rows": rows, "problems": problems, "y_first": y_first, "table_bottom": table_bottom,
            "labels": [w[4] for w in labels], "footer": foot, "sep_y": sep_y}
