# -*- coding: utf-8 -*-
"""
地方整備局の「材料単価【設計】」様式(材料単価決定支援システムの帳票。北陸・中部・近畿が同じ組版)を
pdftotext -bbox-layout の語の座標で読む共通部品。表を要約経由で読まない。列は座標で決める。

1頁の形:
  y≈3   「材 料 単 価 【設計】 2026年09月」(機械賃料の頁は「機 械 賃 料 【設計】」)
  y≈30  「種 別 <種別名> ... 北陸地方整備局 単位：円」
  見出し帯: 「品 目 / 規 格 / 単 位 / 備 考」と、値の列の見出し
     - 地区の頁: 上段に県(群)ラベル、下段に地区(1〜2行)。群ラベルの中心 = その群の列の両端の中点、を総当たりで割り当てる
     - 県の頁: 見出しの1行がそのまま列(山形県 / 長野２０ など)
  データ行: 品目(x < 規の見出し-55)、規格、単位、値(右寄せ)、備考(備の見出し-18.5 より右)

値の列割り当て: 値は右寄せなので、値の右端と見出し中心のずれ(頁ごとの中央値)を引いてから最近傍。ずれを引いた後の距離が 6pt を超えたら止める。
値の欄にある語は 数(桁区切り、小数可)か「－」だけ。それ以外が出たら止める(読み違いを黙って通さない)。
空欄は行を作らない(この表でその地区に値が無い)。「－」は not_set として返す。
"""
import re, statistics, itertools, subprocess, html, unicodedata

NUM = re.compile(r"^[0-9]{1,3}(,[0-9]{3})*(\.[0-9]+)?$|^[0-9]+(\.[0-9]+)?$")  # ASCII の数字だけ
DASH = {"－", "-", "\u2015", "‐", "ー"}
WORD_RE = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>')


def words_of(pdf, first=None, last=None):
    cmd = ["pdftotext", "-bbox-layout"]
    if first:
        cmd += ["-f", str(first)]
    if last:
        cmd += ["-l", str(last)]
    out = subprocess.run(cmd + [pdf, "-"], capture_output=True, text=True, check=True).stdout
    pages = out.split("<page ")[1:]
    res = []
    for pg in pages:
        ws = WORD_RE.findall(pg)
        res.append([(float(a), float(b), float(c), float(d), html.unescape(w)) for a, b, c, d, w in ws])
    return res


def layout_pages(pdf):
    out = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True, check=True).stdout
    return out.split("\f")


def lines_of(ws, tol=1.5):
    """y で束ねた行のリスト [(y, [words sorted by x])]"""
    ys = []
    for w in sorted(ws, key=lambda t: t[1]):
        if ys and abs(w[1] - ys[-1][0]) <= tol:
            ys[-1][1].append(w)
        else:
            ys.append([w[1], [w]])
    return [(y, sorted(g, key=lambda t: t[0])) for y, g in ys]


def join_cell(ws, tol=1.0):
    """1つの欄の語をつなぐ。同じ行の語は空白1つ、折り返した行どうしは間を空けずにつなぐ(日本語の折り返し)。"""
    return "".join(" ".join(w[4] for w in lw) for _, lw in lines_of(ws, tol))


def cluster(items, tol):
    items = sorted(items, key=lambda t: t[0])
    groups = []
    for it in items:
        if groups and abs(it[0] - statistics.mean(g[0] for g in groups[-1])) <= tol:
            groups[-1].append(it)
        else:
            groups.append([it])
    return groups


def nfkc(s):
    return unicodedata.normalize("NFKC", s)


def parse_page(ws, pageno):
    """1頁を読む。様式の頁でなければ None。
    返り値: dict(period_label, category, is_equipment, columns=[{name, lines, group}], rows=[{...}], stats)"""
    title = [w for w in ws if w[1] < 15]
    ttxt = "".join(w[4] for w in sorted(title, key=lambda t: t[0]))
    if "【設計】" not in ttxt:
        return None
    m = re.search(r"(\d{4})年(\d{2})月", ttxt)
    period = "%s-%s" % (m.group(1), m.group(2)) if m else None
    is_equipment = ttxt.startswith("機械賃料")
    betsu = [w for w in ws if w[4] == "別" and 20 < w[1] < 45 and w[0] < 50]
    assert betsu, (pageno, "種別の行が無い")
    yb = betsu[0][1]
    cat = " ".join(w[4] for w in sorted(ws, key=lambda t: t[0]) if abs(w[1] - yb) < 2 and betsu[0][2] < w[0] < 680)
    hin = [w for w in ws if w[4] == "品" and yb + 5 < w[1] < yb + 40]
    assert hin, (pageno, "品目の見出しが無い")
    y_hin = hin[0][1]
    hline = [w for w in ws if abs(w[1] - y_hin) < 1.5]
    kaku = [w for w in hline if w[4] in ("規",)]
    tan = [w for w in hline if w[4] in ("単", "単位")]
    i_ = [w for w in hline if w[4] in ("位", "単位")]
    bi = [w for w in hline if w[4] in ("備",)]
    assert kaku and tan and i_ and bi, (pageno, "見出し語が足りない", [w[4] for w in hline])
    x_spec = kaku[0][0] - 55.0
    x_unit0 = tan[0][0] - 12.0
    x_val0 = max(w[2] for w in i_) + 3.0
    x_rem = bi[0][0] - 18.5
    # データ行の始まり: 品目の欄に語がある最初の行、または単位の欄に語がある最初の行
    body = [w for w in ws if w[1] > y_hin + 3 and not (w[1] > 540 and re.match(r"^[-\d]+$", w[4]))]
    first_y = min((w[1] for w in body if w[0] < x_spec or (x_unit0 <= w[0] and w[2] <= x_val0 + 1)), default=None)
    assert first_y is not None, (pageno, "データ行が無い")
    # 見出し帯の中の値の列の見出し
    head = [w for w in ws if yb + 5 < w[1] < first_y - 2 and x_val0 - 3 <= w[0] and w[2] <= x_rem + 1
            and w[4] not in ("単", "位", "単位", "備", "考")]
    # 機械賃料の頁のように、見出し帯に規格の語が入ることがある(値の欄の外なので上の条件で落ちる)
    grp_w = [w for w in head if w[1] < y_hin - 3]
    col_w = [w for w in head if w[1] >= y_hin - 3]
    cols = cluster([((w[0] + w[2]) / 2, w) for w in col_w], 9.0)
    col_c = [statistics.mean(c for c, _ in g) for g in cols]
    col_lines = [[w[4] for _, w in sorted(g, key=lambda t: t[1][1])] for g in cols]
    n = len(col_c)
    assert n > 0, (pageno, "列が無い")
    group_of = [None] * n
    split_err = 0.0
    if grp_w:
        labs = sorted([((w[0] + w[2]) / 2, w[4]) for w in grp_w])
        k = len(labs)
        best = None
        for cuts in itertools.combinations(range(1, n), k - 1):
            bounds = [0, *cuts, n]
            err = 0
            for i in range(k):
                a, b = bounds[i], bounds[i + 1] - 1
                err = max(err, abs((col_c[a] + col_c[b]) / 2 - labs[i][0]))
            if best is None or err < best[0]:
                best = (err, bounds)
        assert best and best[0] < 4.0, (pageno, "群の割り当てが合わない", best, labs, col_lines)
        split_err = best[0]
        for i in range(k):
            for c in range(best[1][i], best[1][i + 1]):
                group_of[c] = labs[i][1]
    # 行
    lines = lines_of([w for w in body if w[1] >= first_y - 12])
    anchors, others = [], []
    for y, lw in lines:
        vals = [w for w in lw if x_val0 <= w[0] and w[2] <= x_rem and (NUM.match(w[4]) or w[4] in DASH)]
        unit = [w for w in lw if x_unit0 <= w[0] and w[2] <= x_val0 + 1]
        (anchors if (vals or unit) else others).append((y, lw))
    groups = {i: [anchors[i]] for i in range(len(anchors))}
    for y, lw in others:
        j = min(range(len(anchors)), key=lambda i: abs(anchors[i][0] - y))
        assert abs(anchors[j][0] - y) < 14, (pageno, "行に付かない語", [w[4] for w in lw])
        groups[j].append((y, lw))
    raw_rows = []
    for i in range(len(anchors)):
        ay = anchors[i][0]
        allw = [w for _, lw in sorted(groups[i], key=lambda t: t[0]) for w in lw]
        item_w = [w for w in allw if w[0] < x_spec]
        spec_w = [w for w in allw if x_spec <= w[0] and w[2] <= x_unit0 + 8 and not (x_unit0 <= w[0])]
        unit_w = [w for w in anchors[i][1] if x_unit0 <= w[0] and w[2] <= x_val0 + 1]
        val_w = [w for w in anchors[i][1] if x_val0 <= w[0] and w[2] <= x_rem]
        rem_w = [w for w in allw if w[0] >= x_rem]
        stray = [w for w in allw if w not in item_w + spec_w + unit_w + val_w + rem_w]
        assert not stray, (pageno, "どの欄にも入らない語", [w[4] for w in stray])
        bad = [w for w in val_w if not (NUM.match(w[4]) or w[4] in DASH)]
        assert not bad, (pageno, "値の欄に数でない語", [w[4] for w in bad])
        assert item_w, (pageno, "品目が無い行", [w[4] for w in allw])
        raw_rows.append({"y": ay, "item_words": [w[4] for w in item_w], "spec_words": [w[4] for w in spec_w],
                         "spec_text": join_cell(spec_w), "unit": " ".join(w[4] for w in unit_w), "remark": join_cell(rem_w), "vals": val_w})
    # 列のずれ(値は右寄せ): 値の右端と見出し中心の差の中央値を引く
    allv = [v for r in raw_rows for v in r["vals"]]
    offs = [v[2] - min(col_c, key=lambda c: abs(c - v[2] + 17.5)) for v in allv]
    off = statistics.median(offs) if offs else 17.5
    rows, maxd = [], 0.0
    for r in raw_rows:
        cells = []
        for v in r["vals"]:
            c = v[2] - off
            j = min(range(n), key=lambda i: abs(col_c[i] - c))
            d = abs(col_c[j] - c)
            assert d < 6.0, (pageno, r["item_words"], v, col_lines[j], d)
            maxd = max(maxd, d)
            cells.append({"col": j, "text": v[4], "dist": round(d, 2)})
        cols_used = [c["col"] for c in cells]
        assert len(cols_used) == len(set(cols_used)), (pageno, "同じ列に2つの値", r["item_words"])
        r2 = dict(r); r2["cells"] = cells; del r2["vals"]
        rows.append(r2)
    return {"page": pageno, "period": period, "category": cat, "is_equipment": is_equipment,
            "columns": [{"lines": col_lines[i], "group": group_of[i], "x": round(col_c[i], 1)} for i in range(n)],
            "rows": rows, "col_offset_pt": round(off, 2), "max_col_dist_pt": round(maxd, 2), "group_split_err_pt": round(split_err, 2),
            "n_value_words": len(allv)}


def layout_check(layout_page_text, parsed):
    """照合: -layout の頁の本文で、値の欄にある数と「－」の語の数を数え、bbox で割り当てた数と比べる。
    -layout の行のうち単位の位置より右の部分だけを見る(品目・規格の中の数字を拾わないため)。
    返り値: (layout で数えた値の数, bbox で割り当てた値の数)"""
    return None
