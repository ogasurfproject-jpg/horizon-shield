# -*- coding: utf-8 -*-
"""
地方整備局の「材 料 単 価 【設計】」の頁(近畿・中国・四国が同じ組版系統)を、pdftotext -bbox-layout の語の座標で読む共通部品。
要約を通さない。列は座標で決める。

頁の形は2つ:
  - 地区別(列 = 地区。見出しは「群ラベル(府県)」の行と、地区名 1〜2 行)
  - 府県別(列 = 府県。見出しは「品 目 規 格 単 位」と同じ行)
どちらも、見出し語の中心 x で列を作り、値は右寄せなので「値の右端 - 見出し中心」の頁ごとの中央値(ro)を引いて最近傍の列に割り当てる。
同時に「値の中心 - 見出し中心」の頁ごとの中央値(oc)を引いた中心距離でも最近傍を取り、両方が同じ列を指すことを確かめる(食い違えば止める)。
行は「単位の語を持つ行(主行)」を芯にして、主行から行間の半分以内にある語だけの行(折り返し・2 段の備考)を主行に束ねる。
セルの中の複数行は、前の行がセルの右端近くで終わっていれば折り返しとみなして空白なしで、そうでなければ空白1つでつなぐ。
"""
import re, subprocess, html, statistics, itertools, collections, unicodedata

NUM = re.compile(r"^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$")
BLANK_MARKS = {"－", "-", "ー", "\u2015", "‐", "−"}  # \u2015 は水平線(出力に書かない約束の字なので符号で書く)


def words_of(pdf, first=None, last=None):
    cmd = ["pdftotext", "-bbox-layout"]
    if first:
        cmd += ["-f", str(first)]
    if last:
        cmd += ["-l", str(last)]
    out = subprocess.run(cmd + [pdf, "-"], capture_output=True, text=True, check=True).stdout
    res = []
    for pg in out.split("<page ")[1:]:
        m = re.match(r'width="([\d.]+)" height="([\d.]+)"', pg)
        ws = re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', pg)
        res.append({"w": float(m.group(1)), "h": float(m.group(2)),
                    "words": [(float(a), float(b), float(c), float(d), html.unescape(t)) for a, b, c, d, t in ws]})
    return res


def layout_pages(pdf):
    out = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True, check=True).stdout
    return out.split("\f")


def lines_of(ws, tol=1.0):
    ws = sorted(ws, key=lambda w: (w[1], w[0]))
    out = []
    for w in ws:
        if out and abs(out[-1][0] - w[1]) < tol:
            out[-1][1].append(w)
        else:
            out.append([w[1], [w]])
    return [(y, sorted(l, key=lambda t: t[0])) for y, l in out]


def cluster(items, tol):
    items = sorted(items, key=lambda t: t[0])
    groups = []
    for it in items:
        if groups and abs(it[0] - statistics.mean(g[0] for g in groups[-1])) <= tol:
            groups[-1].append(it)
        else:
            groups.append([it])
    return groups


def join_cell(ws, right_bound, wrap_margin=12.0):
    """セルの語を行ごとにまとめ、行内は空白1つ、行間は折り返しなら空白なし・そうでなければ空白1つでつなぐ。"""
    if not ws:
        return ""
    ls = lines_of(ws, tol=1.0)
    parts = []
    prev_end = None
    for y, l in ls:
        t = " ".join(w[4] for w in l)
        if parts:
            parts.append("" if prev_end is not None and prev_end > right_bound - wrap_margin else " ")
        parts.append(t)
        prev_end = max(w[2] for w in l)
    return "".join(parts)


class PageError(Exception):
    pass


def find_header(ws):
    """「品」「目」「規」「格」「単」「位」「備」「考」の見出し語を探す。"""
    cands = [w for w in ws if w[4] == "品"]
    if not cands:
        return None
    hin = min(cands, key=lambda w: w[1])
    hy = hin[1]
    same = [w for w in ws if abs(w[1] - hy) < 2.0]
    def one(t):
        c = [w for w in same if w[4] == t]
        return c[0] if c else None
    h = {k: one(k) for k in ("品", "目", "規", "格", "単", "位", "備", "考")}
    if not (h["単"] and h["位"] and h["備"]):
        return None
    return hy, h


def parse_table_page(page, pageno, spec_x_hint=None, footer_margin=45.0, item_left_min=0.0):
    """1頁を読む。戻り値: dict(columns=[{name, group, hc}], rows=[...], diag={...})。表の頁でなければ None。"""
    ws = page["words"]
    fh = find_header(ws)
    if not fh:
        return None
    hy, H = fh
    shu = [w for w in ws if w[4] in ("種", "種別") and w[1] < hy]
    y_shu = max(w[1] for w in shu) if shu else hy - 30
    cat_words = [w for w in ws if abs(w[1] - y_shu) < 1.5 and w[0] > (max(x[2] for x in shu) if shu else 0) and w[0] < 300]
    category = " ".join(w[4] for w in sorted(cat_words, key=lambda t: t[0]) if w[4] not in ("種", "別", "種別"))
    unit_l, unit_r = H["単"][0], H["位"][2]
    note_hdr_l = H["備"][0]
    y_foot = page["h"] - footer_margin
    L = [(y, l) for y, l in lines_of(ws) if y > hy + 4 and y < y_foot]

    def unit_word(l):
        # 単位は右寄せ(右端が「位」の右端付近)か、左寄せ(左端が「単」の左端付近)のどちらか
        us = [w for w in l if not NUM.match(w[4]) and ((unit_r - 4 <= w[2] <= unit_r + 4.5 and w[0] >= unit_l - 12)
                                                    or (w[0] >= unit_l - 3.5 and w[2] <= unit_r + 4.5))]
        return us
    mains, subs = [], []
    for y, l in L:
        u = unit_word(l)
        if len(u) > 1:
            raise PageError((pageno, y, "単位の語が2つ", u))
        (mains if u else subs).append((y, l, u[0] if u else None))
    if not mains:
        return {"category": category, "columns": [], "rows": [], "diag": {"empty": True}}
    first_y = min(m[0] for m in mains)
    ys = sorted(m[0] for m in mains)
    pitch = statistics.median([b - a for a, b in zip(ys, ys[1:])]) if len(ys) > 1 else 18.0
    head_lim = first_y - 0.6 * pitch
    subs = [s for s in subs if s[0] >= head_lim]
    # 見出し帯の語(地区名・府県名・群ラベル)
    ax0, ax1 = unit_r + 2.0, note_hdr_l - 3.0
    hz = [w for w in ws if y_shu + 3 < w[1] < head_lim and ax0 <= w[0] and w[2] <= ax1 + 40 and w[0] < ax1]
    grp_w = [w for w in hz if w[1] < hy - 3]
    area_w = [w for w in hz if w[1] >= hy - 3]
    cols = cluster([((w[0] + w[2]) / 2, w) for w in area_w], 9.0)
    hc = [statistics.mean(c for c, _ in g) for g in cols]
    names = [" / ".join(w[4] for _, w in sorted(g, key=lambda t: (t[1][1], t[1][0]))) for g in cols]
    n = len(hc)
    group_of = [None] * n
    split_err = None
    if grp_w:
        labs = sorted([((w[0] + w[2]) / 2, w[4]) for w in grp_w])
        k = len(labs)
        best = None
        for cuts in itertools.combinations(range(1, n), k - 1):
            b = [0, *cuts, n]
            err = max(abs((hc[b[i]] + hc[b[i + 1] - 1]) / 2 - labs[i][0]) for i in range(k))
            if best is None or err < best[0]:
                best = (err, b)
        if not best or best[0] > 4.0:
            raise PageError((pageno, "群ラベルの割り当ての誤差", best, labs, names))
        split_err = best[0]
        for i in range(k):
            for c in range(best[1][i], best[1][i + 1]):
                group_of[c] = labs[i][1]
    # 値の右端と中心のずれ(頁ごとの中央値)
    allv = [w for y, l, u in mains + subs for w in l if w[0] > unit_r + 1 and w[2] <= ax1 + 5 and NUM.match(w[4])]
    if allv:
        ro = statistics.median(w[2] - min(hc, key=lambda c: abs(c - w[2] + 12)) for w in allv)
        oc = statistics.median((w[0] + w[2]) / 2 - min(hc, key=lambda c: abs(c - (w[0] + w[2]) / 2 + 6)) for w in allv)
    else:
        ro, oc = 12.0, 6.0
    R = [c + ro for c in hc]
    note_x = R[-1] + 1.0
    spacing = min(b - a for a, b in zip(hc, hc[1:])) if n > 1 else 40.0
    # 規格の列の左端
    item_left = min(w[0] for y, l, u in mains for w in l if w[0] >= item_left_min)
    if spec_x_hint is not None:
        spec_x = spec_x_hint
    else:
        lo = (H["目"][2] + 10) if H["目"] else item_left + 60
        cand = collections.Counter(round(w[0], 1) for y, l, u in mains + subs for w in l if lo < w[0] < unit_l - 10)
        spec_x = cand.most_common(1)[0][0] if cand else None
    # 副行を主行に束ねる
    attach = collections.defaultdict(list)
    orphans = []
    for y, l, _ in subs:
        j = min(range(len(mains)), key=lambda i: abs(mains[i][0] - y))
        if abs(mains[j][0] - y) < pitch / 2:
            attach[j].append((y, l))
        else:
            orphans.append((y, " ".join(w[4] for w in l)))
    rows = []
    maxd_c = maxd_r = 0.0
    for i, (y, l, u) in enumerate(mains):
        allw = list(l) + [w for yy, ll in attach[i] for w in ll]
        item_w, spec_w, note_w, vals, marks = [], [], [], [], []
        for w in allw:
            if w is u:
                continue
            if w[0] >= note_x - 0.5:
                note_w.append(w)
            elif w[0] > unit_r + 1:
                if NUM.match(w[4]):
                    vals.append(w)
                elif w[4] in BLANK_MARKS:
                    marks.append(w)
                else:
                    raise PageError((pageno, y, "値の列に数でない語", w))
            elif spec_x is not None and w[0] >= spec_x - 1:
                spec_w.append(w)
            else:
                item_w.append(w)
        cells = {}
        for v in vals + marks:
            xr, xc = v[2], (v[0] + v[2]) / 2
            j = min(range(n), key=lambda k: abs(R[k] - xr))
            jc = min(range(n), key=lambda k: abs(hc[k] + oc - xc))
            dr, dc = abs(R[j] - xr), abs(hc[j] + oc - xc)
            if j != jc or dr > 3.0 or dc > spacing / 3:
                raise PageError((pageno, y, "列の割り当てが定まらない", v, names[j], names[jc], dr, dc))
            if j in cells:
                raise PageError((pageno, y, "同じ列に値が2つ", v, cells[j]))
            maxd_c, maxd_r = max(maxd_c, dc), max(maxd_r, dr)
            cells[j] = (v[4], round(dc, 2), round(dr, 2))
        rows.append({
            "y": round(y, 1),
            "item": join_cell(item_w, spec_x if spec_x else unit_l),
            "spec": join_cell(spec_w, unit_l - 2),
            "unit": u[4],
            "note": join_cell(note_w, page["w"] - 5),
            "cells": cells,
            "n_sub": len(attach[i]),
        })
    return {"category": category, "columns": [{"name": names[k], "group": group_of[k], "hc": round(hc[k], 2)} for k in range(n)],
            "rows": rows,
            "diag": {"hy": hy, "spec_x": spec_x, "item_left": item_left, "ro": round(ro, 2), "oc": round(oc, 2),
                     "spacing": round(spacing, 2), "pitch": round(pitch, 2), "maxd_center": round(maxd_c, 2),
                     "maxd_right": round(maxd_r, 2), "orphans": orphans, "group_split_err": split_err,
                     "n_main": len(mains), "n_sub": len(subs)}}


def layout_rows_count(layout_page, units):
    """-layout の頁テキストで、単位の語(units のどれか)を含む行を数える(bbox の主行数との照合用)。"""
    n = 0
    for line in layout_page.split("\n"):
        toks = line.split()
        if any(t in units for t in toks):
            n += 1
    return n


RADICAL_MAP = {"⻄": "西", "⻑": "長", "⻘": "青", "⻯": "竜", "⻲": "亀", "⼾": "戸", "⿊": "黒"}


def fix_radicals(s):
    """埋め込みフォントの都合で康熙部首(U+2F00-2FDF)・CJK 部首補助(U+2E80-2EFF)の符号位置で出る字を、同じ字形の統合漢字に戻す。"""
    out = []
    for ch in s:
        if ch in RADICAL_MAP:
            out.append(RADICAL_MAP[ch])
        elif 0x2F00 <= ord(ch) <= 0x2FDF:
            out.append(unicodedata.normalize("NFKC", ch))
        else:
            out.append(ch)
    return "".join(out)


def layout_value_check(layout_page, rows):
    """別の読み方での照合: pdftotext -layout の頁テキストで、単位の語を含む行を上から順に取り、単位の後ろに続く数の並びを、
    bbox で読んだ行の値の並び(列の順)と突き合わせる。戻り値: (layout の行数, 一致した行数, 食い違いのリスト)。"""
    units = set(r["unit"] for r in rows)
    lrows = []
    for line in layout_page.split("\n"):
        toks = line.split()
        idx = [i for i, t in enumerate(toks) if t in units]
        if idx:
            i = idx[-1]
            vals = []
            for t in toks[i + 1:]:
                if NUM.match(t) or t in BLANK_MARKS:
                    vals.append(t)
                else:
                    break
            lrows.append((toks[i], [v for v in vals if v not in BLANK_MARKS]))
    bad = []
    ok = 0
    for k, r in enumerate(rows):
        bv = [r["cells"][j][0] for j in sorted(r["cells"]) if r["cells"][j][0] not in BLANK_MARKS]
        if k < len(lrows) and lrows[k][0] == r["unit"] and lrows[k][1] == bv:
            ok += 1
        else:
            bad.append((k, r["item"], r["spec"], bv, lrows[k] if k < len(lrows) else None))
    return len(lrows), ok, bad


def plumber_cell_text(page, bbox, wrap_margin=10.0):
    """pdfplumber の頁とセルの範囲から、セルの語を座標でつなぐ(折り返しは空白なし、明示の改行は空白1つ)。"""
    x0, top, x1, bottom = bbox
    ws = page.crop((x0 + 0.3, top + 0.3, x1 - 0.3, bottom - 0.3)).extract_words(keep_blank_chars=False, x_tolerance=1.5, y_tolerance=2)
    tup = [(w["x0"], w["top"], w["x1"], w["bottom"], w["text"]) for w in ws]
    return join_cell(tup, x1 - 2, wrap_margin=wrap_margin)
