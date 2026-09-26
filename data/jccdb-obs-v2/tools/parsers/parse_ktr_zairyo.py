# -*- coding: utf-8 -*-
"""
関東地方整備局「令和８年度 土木工事設計材料単価表（特別調査）（令和８年４月１日）」(000940500.pdf) を観測層 v2 に取り込む。
原本: OBS2/raw/ktr-zairyo-r8-04.pdf(PDL1.0)。値は pdftotext -bbox-layout の語の座標で読む。要約を通さない。

読む頁(本文の目次の「資材分類」):
  5〜9   骨材価格           地区(2)の列(3002 日立 など)。上段の県ラベルは列の両端の中点で割り当てる
  10〜12 アスファルト合材価格 地区(3)の列(D001 水戸 など)
  13〜22 一般材価格          都県別の列(2001 茨城県 〜 2009 長野県)
  23     機械賃料            都県別の列(layer equipment)
  29〜37 電気通信資材価格     1列の単価(関東統一。地区割一覧表の注に「電気通信資材は、関東統一とする」)
  51〜53 水質自動監視計用薬品単価、54〜57 ボルト・ナット類単価、65 電線共同溝資材単価(1列の単価)
  66〜68 地区割一覧表(地区(1)(2)(3)の名前と適用市町村) → area_members
読まない頁(報告に書く): 24〜28 砂防生コン山岳地補正価格(割増額と運搬経路)、38〜41・58〜64(様式が頁ごとに違う個別の表)、
  42〜50 試験・分析の単価(材料でない)。

空欄と「－」: 原本 2 頁「前記の物価資料に材料単価が掲載されている材料については、その掲載されている単価…を土木工事設計材料単価として
用いるため、特別調査にはこれらの単価は掲載していません。（単価表中の空欄部分）」「…単価を設定していない地区があり、…「 － 」になっています。」
→ 地区・都県の列の表では、空欄 = publication_based_not_public(値なし)、「－」= not_set(値なし)として行を作る。

照合: 頁ごとに、-layout の本文で値の形の語(ASCII の数・「-」「－」)の多重集合を数え、bbox で値として割り当てた語と比べる
(品名・規格・番号・種別№・備考の中の数の語は、bbox で同じ行の値でない欄に入ったものとして両方から除く)。
使い方: python3 parse_ktr_zairyo.py
"""
import sys, os, re, json, hashlib, collections, statistics, itertools
HERE = os.path.dirname(os.path.abspath(__file__))
OBS2 = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(OBS2, "tools"))
from sekisan_layout import words_of, layout_pages, lines_of, cluster, nfkc, join_cell
from obs_common import make_id, num, pref, write_obs

SID = "ktr-zairyo-r8-04"
PDF = os.path.join(OBS2, "raw", "ktr-zairyo-r8-04.pdf")
URL = "https://www.ktr.mlit.go.jp/ktr_content/content/000940500.pdf"
OUT = os.path.join(OBS2, "observations", "jp", "material_ktr_zairyo_r8_04.csv")
PERIOD, EFF = "2026-04", "2026-04-01"
NUMV = re.compile(r"^[0-9]{1,3}(,[0-9]{3})*(\.[0-9]+)?$|^[0-9]+(\.[0-9]+)?$")
DASH = {"-", "－", "\u2015", "‐"}
NOTE_OPEN = "関東地整が独自調査(特別調査)で設定した単価(物価資料に載っていない材料だけ)。消費税を含まない(調査条件)。"
NOTE_PUB = "原本の空欄。物価資料(建設物価・積算資料)に載っている単価を使う地区・都県で、公的に公開された値は無い(原本2頁の注)。"
NOTE_NOTSET = "原本で「－」(取引事例が少なく単価を設定していない)。0 円ではない。"


def isval(t):
    return bool(NUMV.match(t)) or t in DASH


# ---------------------------------------------------------------- 地区割一覧表
def plumber_offset(pg, ws):
    """pdfplumber の座標(矩形)を pdftotext -bbox-layout の座標に合わせるための (dx, dy)。
    両方で1回だけ出る文字列の語の組の (pdftotext - pdfplumber) の中央値。MediaBox の原点が (-14.4, -14.4) の頁では 14.4pt ずれる。
    返り値: (dx, dy, 組の数, 中央値からの最大のずれ)"""
    pw = pg.extract_words()
    c1 = collections.Counter(w[4] for w in ws)
    c2 = collections.Counter(q["text"] for q in pw)
    pairs = [(w, q) for w in ws for q in pw if w[4] == q["text"] and c1[w[4]] == 1 and c2[q["text"]] == 1]
    assert len(pairs) >= 5, "座標の対応が取れない"
    dx = statistics.median(w[0] - q["x0"] for w, q in pairs)
    dy = statistics.median(w[1] - q["top"] for w, q in pairs)
    spread = max(max(abs(w[0] - q["x0"] - dx), abs(w[1] - q["top"] - dy)) for w, q in pairs)
    return dx, dy, len(pairs), spread


def area_table(pages):
    """66〜68 頁。地区(1)(2)(3) の名前は縦に結合したセルに入っている。セルの境界は PDF の罫線(細い矩形)で決める
    (pdfplumber で矩形だけを読む。文字は pdftotext -bbox-layout の語)。県の境界は表の幅いっぱいの太い罫線。
    各ラベルの入ったセルの中にある「適用市町村」の行を、上から順に原文のままつなぐ。
    返り値: {(kind, pref_code, name): members}、ラベルの数、セルに入らなかったラベルの数"""
    import pdfplumber
    res, nlab, miss = {}, 0, 0
    pdf = pdfplumber.open(PDF)
    for pno in (66, 67, 68):
        ws = pages[pno - 1]
        pg = pdf.pages[pno - 1]
        dx, off, _, _ = plumber_offset(pg, ws)
        assert abs(dx) < 0.5, ("x のずれ", pno, dx)
        full = sorted((r["top"] + r["bottom"]) / 2 + off for r in pg.rects if r["x0"] <= 53 and r["x1"] >= 540 and r["bottom"] - r["top"] < 3)
        hdr = sorted([w for w in ws if w[4].startswith("地区（")], key=lambda t: t[0])
        y_h = min(w[1] for w in hdr)
        top = min(y for y in full if y > y_h)  # 見出しの下の罫線
        colx = [(97, 147), (148, 198), (198, 248)]
        memx = (249, 543)
        def bounds(x0, x1):
            thin = [(r["top"] + r["bottom"]) / 2 + off for r in pg.rects if r["bottom"] - r["top"] < 1.2 and r["x0"] <= x0 + 3 and r["x1"] >= x1 - 3]
            return sorted(set([round(y, 1) for y in thin + full if y >= top - 0.5]))
        def cell_of(yc, bs):
            for i in range(len(bs) - 1):
                if bs[i] <= yc < bs[i + 1]:
                    return (bs[i], bs[i + 1])
            return None
        mem = [w for w in ws if memx[0] <= w[0] and w[1] > top]
        mb = bounds(*memx)
        # 適用市町村の欄もセルごとにまとめる(折り返しの行は間を空けずにつなぐ)
        mcells = collections.OrderedDict()
        for y, lw in lines_of(mem, 2.0):
            c = cell_of(y + 5, mb)
            mcells.setdefault(c, []).append("".join(w[4] for w in lw))
        mlines = [((c[0] + c[1]) / 2, "".join(v)) for c, v in mcells.items() if c]
        prefw = [w for w in ws if w[0] < 95 and w[1] > top and len(w[4]) >= 3 and pref(w[4])[0]]
        pb = sorted(set(round(y, 1) for y in full if y >= top - 0.5))
        for k, (x0, x1) in enumerate(colx):
            bs = bounds(x0, x1)
            labs = [w for w in ws if x0 - 2 <= w[0] and w[2] <= x1 + 2 and w[1] > top and w not in hdr]
            for l in labs:
                nlab += 1
                yc = (l[1] + l[3]) / 2
                c = cell_of(yc, bs)
                pc = [pw for pw in prefw if cell_of((pw[1] + pw[3]) / 2, pb) == cell_of(yc, pb)]
                if not c or len(pc) != 1:
                    miss += 1
                    continue
                # 1つの地区のセルが適用市町村の複数のセルにまたがるときは「 / 」でつなぐ
                txt = " / ".join(t for y, t in mlines if c[0] <= y < c[1])
                key = (k + 1, pref(pc[0][4])[0], l[4])
                res[key] = (res[key] + " / " + txt) if key in res else txt
    return res, nlab, miss


def split_by_labels(centers, label_ys):
    """centers(上から) を連続する塊に分け、各塊の中心の平均が label_ys に最も近くなる分け方。返り値 (最大誤差, [(a,z),...])"""
    n, k = len(centers), len(label_ys)
    if k == 0 or n < k:
        return (999.0, [])
    best = None
    for cuts in itertools.combinations(range(1, n), k - 1):
        b = [0, *cuts, n]
        err = max(abs((centers[b[i]] + centers[b[i + 1] - 1]) / 2 - label_ys[i]) for i in range(k))
        if best is None or err < best[0]:
            best = (err, [(b[i], b[i + 1]) for i in range(k)])
    return best


# ---------------------------------------------------------------- 地区・都県の列の表(5〜23 頁)
def parse_grid_page(ws, pno):
    title = [w for w in ws if 25 < w[1] < 45 and w[0] < 150]
    ttl = "".join(w[4] for w in sorted(title, key=lambda t: t[0]))
    H = {}
    for key in ("材料種別", "種別№", "番号", "資材コード", "単位"):
        c = [w for w in ws if w[4] == key and w[1] < 90]
        assert c, (pno, "見出し無し", key)
        H[key] = c[0]
    bik = [w for w in ws if w[4].startswith("備考") and w[1] < 90]
    y_head = min(H[k][1] for k in H)
    x_val0 = H["単位"][2] + 4
    # 列: 4桁の数か D+3桁 のコードの行
    codes = [w for w in ws if y_head - 5 < w[1] < y_head + 12 and re.match(r"^(\d{4}|D\d{3})$", w[4]) and w[0] > x_val0 - 5]
    assert codes, (pno, "列のコードが無い")
    y_code = statistics.median(w[1] for w in codes)
    codes = sorted(codes, key=lambda t: t[0])
    col_c = [(w[0] + w[2]) / 2 for w in codes]
    n = len(codes)
    # 行: 単位の欄に語がある行を錨にし、ほかの行(0.9pt ずれた材料種別、折り返し)は最も近い錨に付ける
    ux0, ux1 = H["単位"][0] - 10, H["単位"][2] + 6
    unit_ws = [w for w in ws if ux0 <= w[0] and w[2] <= ux1 and w[1] > y_code + 8]
    first_y = min(w[1] for w in unit_ws)
    names = [w for w in ws if y_code + 2 < w[1] < first_y - 6 and w[0] > x_val0 - 5]
    col_names = [[] for _ in range(n)]
    for w in sorted(names, key=lambda t: t[1]):
        c = (w[0] + w[2]) / 2
        j = min(range(n), key=lambda i: abs(col_c[i] - c))
        assert abs(col_c[j] - c) < 9, (pno, "列名が列に付かない", w[4])
        col_names[j].append(w[4])
    labels = sorted([w for w in ws if w[1] < y_code - 4 and w[1] > 45 and len(w[4]) >= 3 and pref(w[4])[0]], key=lambda t: t[0])
    group_of, gerr = [None] * n, 0.0
    if labels:
        k = len(labels)
        best = None
        for cuts in itertools.combinations(range(1, n), k - 1):
            b = [0, *cuts, n]
            err = max(abs((col_c[b[i]] + col_c[b[i + 1] - 1]) / 2 - (labels[i][0] + labels[i][2]) / 2) for i in range(k))
            if best is None or err < best[0]:
                best = (err, b)
        assert best[0] < 4.0, (pno, "県の割り当てが合わない", best)
        gerr = best[0]
        for i in range(k):
            for c in range(best[1][i], best[1][i + 1]):
                group_of[c] = labels[i][4]
    # 22 頁の下の〔特記事項〕より下は表でない
    stop = min([w[1] for w in ws if w[4].startswith("〔特記事項〕")] + [580])
    body = [w for w in ws if first_y - 9 <= w[1] < stop - 2]
    lines = lines_of(body, 1.0)
    anch = [(y, lw) for y, lw in lines if any(ux0 <= w[0] and w[2] <= ux1 for w in lw)]
    rest = [(y, lw) for y, lw in lines if not any(ux0 <= w[0] and w[2] <= ux1 for w in lw)]
    grp = {i: list(anch[i][1]) for i in range(len(anch))}
    for y, lw in rest:
        i = min(range(len(anch)), key=lambda k: abs(anch[k][0] - y))
        assert abs(anch[i][0] - y) < 8.5, (pno, "行に付かない語", [w[4] for w in lw])
        grp[i] += lw
    rows = []
    for i, (y, lw) in enumerate(anch):
        nos = [w for w in grp[i] if H["番号"][0] - 12 <= w[0] and w[2] <= H["番号"][2] + 4 and re.match(r"^\d{1,3}$", w[4])]
        rows.append({"anchor": nos[0] if nos else None, "y": y, "band": grp[i]})
    code_x0 = H["資材コード"][0]
    xs = collections.Counter()
    for r in rows:
        mid = [w for w in r["band"] if code_x0 - 2 <= w[0] < H["単位"][0] - 8 and not re.match(r"^[A-Z]\d{7}$", w[4])]
        if mid:
            ix = min(w[0] for w in mid)
            r["item_x0"] = ix
            for w in mid:
                if w[0] > ix + 3:
                    xs[round(w[0])] += 1
    spec_x0 = xs.most_common(1)[0][0] if xs else 10000
    out, maxd, offs_all = [], 0.0, []
    # 値の右端と列見出しの中心のずれ(頁の中央値)
    cand = []
    for r in rows:
        for w in r["band"]:
            if w[0] >= x_val0 - 2 and isval(w[4]) and w[4] not in DASH:
                cand.append(w[2] - min(col_c, key=lambda c: abs(c - w[2] + 8)))
    off = statistics.median(cand) if cand else 8.0
    for r in rows:
        a = r["anchor"]
        band = r["band"]
        ano = a[4] if a else ""
        used = set()
        def take(pred):
            got = [w for w in band if id(w) not in used and pred(w)]
            for w in got:
                used.add(id(w))
            return got
        kind = take(lambda w: w[0] < H["種別№"][0] - 3)
        shu = take(lambda w: H["種別№"][0] - 3 <= w[0] and w[2] <= H["番号"][0] - 1)
        if a:
            take(lambda w: w is a)
        zcode = take(lambda w: re.match(r"^[A-Z]\d{7}$", w[4]) and w[0] < H["単位"][0])
        unit = take(lambda w: H["単位"][0] - 10 <= w[0] and w[2] <= H["単位"][2] + 6)
        item = take(lambda w: code_x0 - 2 <= w[0] < spec_x0 - 1 and w[2] < H["単位"][0])
        spec = take(lambda w: spec_x0 - 1 <= w[0] and w[2] < H["単位"][0] - 1)
        vals, rem = [], []
        for w in sorted([w for w in band if id(w) not in used], key=lambda t: (t[1], t[0])):
            if w[0] >= x_val0 - 6 and isval(w[4]):
                # 数は右寄せ(右端 - ずれ)。「-」は中央寄せと右寄せが混じるので、両方で測って近い方
                cs = [w[2] - off] + ([(w[0] + w[2]) / 2] if w[4] in DASH else [])
                d, j = min((abs(col_c[i] - c), i) for c in cs for i in range(n))
                if d < 6.0:
                    vals.append((j, w[4], d)); used.add(id(w)); maxd = max(maxd, d); continue
                assert w[0] > col_c[-1], (pno, "値が列に付かない", w[4], d, [x[4] for x in item])
            rem.append(w); used.add(id(w))
        bad_rem = [w for w in rem if w[0] < col_c[-1]]
        assert not bad_rem, (pno, "値の欄に数でない語", [w[4] for w in bad_rem], [x[4] for x in item])
        assert kind and item and unit, (pno, "欄が足りない", ano, [w[4] for w in band])
        js = [v[0] for v in vals]
        assert len(js) == len(set(js)), (pno, "同じ列に2つ", [x[4] for x in item])
        out.append({"page": pno, "title": ttl, "kind": " ".join(w[4] for w in kind), "shu_no": " ".join(w[4] for w in shu),
                    "no": ano, "zcode": " ".join(w[4] for w in zcode),
                    "item": join_cell(item), "spec": join_cell(spec),
                    "unit": " ".join(w[4] for w in unit),
                    "remark": join_cell(rem),
                    "cells": {j: t for j, t, _ in vals},
                    "nonvalue_numeric": [w[4] for w in band if isval(w[4]) and id(w) not in {id(x) for x in []}]})
    cols = [{"code": codes[j][4], "name": " ".join(col_names[j]), "group": group_of[j]} for j in range(n)]
    return {"page": pno, "title": ttl, "cols": cols, "rows": out, "max_col_dist_pt": round(maxd, 2), "offset": round(off, 2),
            "group_err": round(gerr, 2), "spec_x0": spec_x0}


# ---------------------------------------------------------------- 1列の単価の表(29〜37, 51〜57, 65 頁)
# 欄の境界は頁ごとに見出しの語の座標から決める。単価の欄は「数か -」で、右端が単価の見出しの範囲に入る語だけ。
# 行は単位の欄に語がある行を錨にし、ほかの行(0.5pt ずれた番号・単価、品目だけの行)は最も近い錨に付ける。
# 品目の欄が空の行は、上の行の品目を引き継ぐ(ボルト・ナット類の表は品目を群の先頭にだけ書いている)。
LIST_SECTIONS = [
    {"name": "電気通信資材価格", "pages": list(range(29, 38)), "hdr": {"no": "NO", "item": "品", "spec": "規格・仕様", "unit": "単位", "price": "単価（円）", "rem": "備考（確認事項、等）"},
     "attach": 4.0, "carry_item": False, "pslack": 6},
    {"name": "水質自動監視計用薬品単価", "pages": [51, 52, 53], "hdr": {"no": "番号", "item": "品", "spec": "規", "qty": "数量", "unit": "単位", "price": "単", "rem": "備"},
     "attach": 12.0, "carry_item": False, "pslack": 45},
    {"name": "ボルト・ナット類単価", "pages": [54, 55, 56, 57], "hdr": {"item": "品目", "spec": "規格", "mat": "材質", "coat": "塗装仕様", "unit": "単位", "price": "単価", "rem": "代表規格", "rem2": "参考質量（㎏/個）"},
     "attach": 5.0, "carry_item": True, "pslack": 40},
    {"name": "電線共同溝資材単価", "pages": [65], "hdr": {"item": "名称", "spec": "品名", "spec2": "規格", "unit": "単位", "price": "単価", "rem": "摘要"},
     "attach": 8.0, "carry_item": False, "pslack": 30},
]


def parse_list_page(ws, pno, sec):
    H = {}
    for k, t in sec["hdr"].items():
        c = [w for w in ws if w[4] == t and w[1] < 140]
        assert c, (pno, "見出し無し", t)
        H[k] = c[0]
    y_h = max(w[1] for w in H.values())
    ux0, ux1 = H["unit"][0] - 10, H["unit"][2] + 6
    order = sorted([k for k in H if k not in ("unit", "price")], key=lambda k: H[k][0])
    # 単価の欄: 右端が [単価の見出しの左端, 次の見出しの左端) に入る数・「-」
    nxt = [H[k][0] for k in H if H[k][0] > H["price"][2]]
    px1 = min(min(nxt) if nxt else 10000, H["price"][2] + sec["pslack"])
    px0 = H["price"][0]
    body = [w for w in ws if w[1] > y_h + 5 and not w[4].startswith("（単位") and not w[4].startswith("単位：") and not w[4].startswith("（諸経費")]
    lines = lines_of(body, 0.3)
    anch = [(y, lw) for y, lw in lines if any(ux0 <= w[0] and w[2] <= ux1 for w in lw)]
    rest = [(y, lw) for y, lw in lines if not any(ux0 <= w[0] and w[2] <= ux1 for w in lw)]
    grp = {i: list(anch[i][1]) for i in range(len(anch))}
    for y, lw in rest:
        i = min(range(len(anch)), key=lambda k: abs(anch[k][0] - y))
        assert abs(anch[i][0] - y) < sec["attach"], (pno, "行に付かない語", [w[4] for w in lw], y)
        grp[i] += lw
    # 品目と規格の境目: 品目の見出しより右で、規格の見出しより左にある語の x0 の最頻値
    item_x0 = min(w[0] for i in grp for w in grp[i] if w[0] > (H["no"][2] + 2 if "no" in H else 0)) if grp else 0
    xs = collections.Counter(round(w[0]) for i in grp for w in grp[i]
                             if item_x0 + 8 < w[0] < H[order[order.index("item") + 1]][0] + 5 and not isval(w[4]))
    spec_x0 = xs.most_common(1)[0][0] if xs else H[order[order.index("item") + 1]][0]
    rows = []
    for i, (y, lw) in enumerate(anch):
        band = sorted(grp[i], key=lambda t: (round(t[1]), t[0]))
        f = collections.defaultdict(list)
        for w in band:
            if ux0 <= w[0] and w[2] <= ux1:
                f["unit"].append(w); continue
            if isval(w[4]) and px0 <= w[2] <= px1 + 1 and w[0] > ux1 - 2:
                f["price"].append(w); continue
            if "no" in H and w[2] <= item_x0 - 1 and isval(w[4]):
                f["no"].append(w); continue
            if w[0] < spec_x0 - 1:
                f["item"].append(w); continue
            # 単価の見出しより右の語は、単価の右の欄(備考・代表規格・摘要)。その中では見出しの左端が w の左端 + 30 以下で最も右の欄
            if w[0] >= H["price"][0]:
                rk = [k for k in order if H[k][0] > H["price"][0]]
                c2 = [k for k in rk if H[k][0] - 30 <= w[0]]
                f[(c2 or rk)[-1] if c2 else rk[0]].append(w); continue
            # 残りは見出しの左端が w の左端以下で最も右の欄(規格より右)
            cands = [k for k in order if k not in ("no", "item") and H[k][0] - 30 <= w[0]]
            if w[0] < ux0:
                cands = [k for k in cands if H[k][0] < ux0] or ["spec"]
            k = cands[-1] if cands else "spec"
            if k in ("spec",) or (k not in ("rem", "rem2") and w[0] < ux0):
                pass
            f[k].append(w)
        assert f["unit"], (pno, "単位が無い", [w[4] for w in band])
        assert len(f["price"]) <= 1, (pno, "単価が2つ", [w[4] for w in band])
        bad = [w for w in f.get("rem", []) + f.get("rem2", []) if w[0] < px0 - 5]
        assert not bad, (pno, "備考の欄の左に外れた語", [w[4] for w in bad])
        rec = {}
        for k, v in f.items():
            # 同じ行の語は空白でつなぎ、折り返した行は間を空けずにつなぐ(日本語の折り返し)
            rec[k] = join_cell(v)
        rows.append(rec)
    return rows


# ---------------------------------------------------------------- 罫線で区切られた小さい表(38 頁下の材料費, 40, 41, 58, 61, 63 頁)
# 品名の欄は縦に結合したセル(ラベルがセルの中央)なので、行の区切りも品名の区切りも PDF の罫線(pdfplumber で矩形だけ読む)で決める。
# 欄の境界は各表の見出しの語の位置から決めた x(左端)。単価の欄は右端が [p0, p1] に入る数だけ。
RULED = [
    {"page": 38, "name": "非排水型伸縮装置設置費（材料費）", "y": (605, 640), "cols": [("item", 0), ("spec", 190), ("unit", 280), ("rem", 440)],
     "price": (360, 396), "labels": {"rem": ""}, "merged": []},
    {"page": 40, "name": "橋梁用排水管工場製作品", "y": (125, 250), "cols": [("item", 0), ("spec", 160), ("unit", 255), ("rem", 370), ("rem2", 510)],
     "price": (330, 372), "labels": {"rem": "摘要", "rem2": "備考"}, "merged": ["item"]},
    {"page": 41, "name": "ゴム製伸縮継手単価", "y": (135, 500), "cols": [("item", 0), ("spec", 150), ("unit", 250), ("rem", 440)],
     "price": (360, 415), "labels": {"rem": "※伸縮量(mm)"}, "spec_prefix": "軸差量(mm) ", "item_fixed": "ゴム製伸縮継手", "item_as_spec": "呼び径 ", "merged": ["item"]},
    {"page": 58, "name": "機械設備資材単価 特殊鋼材類（ゲート用ローラ）", "y": (136, 292), "cols": [("item", 0), ("spec", 290)],
     "price": (500, 545), "unit": "Kg", "labels": {}, "anchor": "spec", "merged": []},
    {"page": 61, "name": "ダクタイル鋳鉄管（規格外）単価", "y": (262, 310), "cols": [("item", 0), ("spec", 165), ("spec2", 270), ("unit", 345), ("rem", 470)],
     "price": (420, 465), "labels": {"rem": ""}, "spec2_prefix": "口径（mm） ", "merged": ["item"]},
    {"page": 63, "name": "アルミ高欄（ダム堰対応）他単価", "y": (130, 335), "cols": [("item", 0), ("spec", 160), ("unit", 290), ("rem2", 410), ("rem", 452)],
     "price": (365, 405), "labels": {"rem": "", "rem2": "参考質量（kg）"}, "merged": ["item", "rem"], "sentence": ["rem"]},
    {"page": 63, "name": "スチールショット単価", "y": (500, 610), "cols": [("item", 0), ("spec", 160), ("unit", 290), ("rem", 440)],
     "price": (380, 405), "labels": {"rem": ""}, "merged": []},
]


def parse_ruled(pages, T):
    """行は単位の語(単位の欄が無い表は規格の語)のある行を錨にし、ほかの行は最も近い錨に付ける。
    縦に結合したセルの欄(T["merged"]: 品名・備考など)は、その欄を横切る罫線(pdfplumber の矩形。y は plumber_offset で合わせる)で
    セルを切り、錨の行を含むセルの中の語をその欄の値にする。結合セルの中の行どうしは空白1つでつなぐ。"""
    import pdfplumber
    ws = pages[T["page"] - 1]
    pg = pdfplumber.open(PDF).pages[T["page"] - 1]
    dx, off, npair, spread = plumber_offset(pg, ws)
    assert spread < 1.0, (T["page"], "座標のずれがそろわない", spread)
    y0, y1 = T["y"]
    cols = T["cols"]
    xb = dict(cols)
    names = [n for n, _ in cols]
    def colx(n):
        i = names.index(n)
        return (cols[i][1], cols[i + 1][1] if i + 1 < len(cols) else 560)
    def col_of(w):
        return [n for n, x in cols if x <= w[0]][-1]
    body = [w for w in ws if y0 <= w[1] <= y1]
    merged = T.get("merged", ["item"])
    plain = [w for w in body if col_of(w) not in merged or (T["price"][0] <= w[2] <= T["price"][1] and isval(w[4]))]
    mw = [w for w in body if w not in plain]
    akey = T.get("anchor", "unit")
    lines = lines_of(plain, 1.0)
    isanch = lambda lw: any(col_of(w) == akey and not isval(w[4]) for w in lw)
    anch = [(y, lw) for y, lw in lines if isanch(lw)]
    rest = [(y, lw) for y, lw in lines if not isanch(lw)]
    grp = {i: list(anch[i][1]) for i in range(len(anch))}
    for y, lw in rest:
        i = min(range(len(anch)), key=lambda k: abs(anch[k][0] - y))
        assert abs(anch[i][0] - y) < 12, (T["page"], "行に付かない語", [w[4] for w in lw])
        grp[i] += lw
    def rules(x):
        return sorted(set(round((r["top"] + r["bottom"]) / 2 + off, 1) for r in pg.rects
                          if r["bottom"] - r["top"] < 2.5 and r["x0"] + dx <= x <= r["x1"] + dx and y0 - 30 <= r["top"] + off <= y1 + 30))
    def cell(yc, bs):
        for i in range(len(bs) - 1):
            if bs[i] <= yc < bs[i + 1]:
                return (bs[i], bs[i + 1])
        return None
    out = []
    for i, (y, lw) in enumerate(anch):
        f = collections.defaultdict(list)
        for w in grp[i]:
            if T["price"][0] <= w[2] <= T["price"][1] and isval(w[4]):
                f["price"].append(w); continue
            f[col_of(w)].append(w)
        # 罫線の表の備考は行ごとに別の句(材質の行と、めっきの行)なので、行どうしは空白1つでつなぐ
        rec = {k: " ".join(" ".join(w[4] for w in lw2) for _, lw2 in lines_of(v, 1.0)) for k, v in f.items()}
        for m in merged:
            x0, x1 = colx(m)
            bs = rules((x0 + x1) / 2)
            ay = statistics.mean(w[1] + 5 for w in anch[i][1])
            c = cell(ay, bs)
            assert c, (T["page"], "結合セルが見つからない", m, ay, bs)
            got = [w for w in mw if col_of(w) == m and c[0] <= w[1] + 5 < c[1]]
            sep = "" if m in T.get("sentence", []) else " "
            rec[m] = sep.join(" ".join(w[4] for w in lw2) for _, lw2 in lines_of(got, 1.0))
        rec["_offset"] = (round(dx, 2), round(off, 2), npair, round(spread, 3))
        out.append(rec)
    return out


def main():
    sha = hashlib.sha256(open(PDF, "rb").read()).hexdigest()
    pages = words_of(PDF)
    lay = layout_pages(PDF)
    area, area_nlab, area_miss = area_table(pages)
    area_err = (area_nlab, area_miss)
    rows, stats, checks = [], collections.Counter(), []
    nat_seen = {}
    maxd = 0.0
    unmatched = set()
    for pno in range(5, 24):
        P = parse_grid_page(pages[pno - 1], pno)
        maxd = max(maxd, P["max_col_dist_pt"])
        title = P["title"]
        kindmap = {"骨材価格": 2, "アスファルト合材価格": 3}
        akind = kindmap.get(title)
        nvals = 0
        for r in P["rows"]:
            stats["grid_rows"] += 1
            layer = "equipment" if title == "機械賃料" else "material"
            if "特記事項参照" in r["remark"]:
                # 22 頁〔特記事項〕「価格は労務費、直接経費（機械経費等）を含む直接工事費である。材料費は含まない。」
                layer = "work"
            spec = r["spec"]
            if r["remark"]:
                spec = (spec + " [" + r["remark"] + "]").strip()
            unit = r["unit"]
            basis = "work_unit_price_ex_tax" if layer == "work" else "design_unit_price_ex_tax"
            if layer == "equipment":
                basis = "equipment_rate_monthly" if "月" in unit else "equipment_rate_daily"
            for j, col in enumerate(P["cols"]):
                t = r["cells"].get(j)
                if t is None:
                    status, price, note = "publication_based_not_public", "", NOTE_PUB
                elif t in DASH:
                    status, price, note = "not_set", "", NOTE_NOTSET
                    nvals += 1
                else:
                    status, price, note = "published_pdl", num(t), NOTE_OPEN
                    nvals += 1
                if col["group"]:
                    gcode, gname = pref(col["group"])
                    geo_level, alabel, acode = "bureau_area", col["name"], col["code"]
                    amem = area.get((akind, gcode, col["name"]), "")
                    if not amem:
                        unmatched.add((pno, col["code"], col["name"], col["group"]))
                else:
                    gcode, gname = pref(col["name"])
                    assert gcode, (pno, col)
                    geo_level, alabel, acode, amem = "pref", col["name"], col["code"], ""
                if layer == "equipment" and status == "published_pdl":
                    note = "関東地整が独自調査で設定した機械賃料。消費税を含まない(調査条件)。"
                if layer == "work" and status == "published_pdl":
                    note = "作業の単価(原本22頁〔特記事項〕: 労務費・直接経費を含む直接工事費で材料費は含まない。週休2日補正は実施していない)。消費税を含まない。"
                if title == "アスファルト合材価格":
                    note += " アスファルト合材(安定処理材)は関東地整が毎月調査して更新する。これは令和8年4月1日時点で、2026年9月1日以降適用の単価は別 PDF(000956094.pdf、未取り込み)にある。"
                item = r["item"]
                zc = r["zcode"]
                if zc:
                    note = note + " 資材コード " + zc + "。"
                nat = (layer, item, spec, unit, geo_level, gcode, alabel, acode, basis)
                if nat in nat_seen:
                    raise SystemExit("同じ観測が2行: %s p%d と p%d" % (nat, nat_seen[nat], pno))
                nat_seen[nat] = pno
                rows.append({"obs_id": make_id(SID, pno, r["kind"], r["shu_no"], r["no"], item, spec, unit, acode),
                             "country": "JP", "layer": layer, "category": r["kind"], "item_name": item, "spec": spec, "unit": unit,
                             "geo_level": geo_level, "geo_code": gcode, "geo_name": gname, "area_label": alabel, "area_code": acode,
                             "area_members": amem, "price": price, "currency": "JPY", "price_basis": basis, "price_status": status,
                             "period": PERIOD, "effective_from": EFF, "source_id": SID, "source_page": pno, "evidence_url": URL,
                             "license": "PDL1.0", "note": note})
                stats["status:" + status] += 1
                stats["layer:" + layer] += 1
        # 照合: -layout の値の形の語 と bbox の値
        lay_c = collections.Counter(t for ln in lay[pno - 1].split("\n") for t in ln.split() if isval(t))
        bb_c = collections.Counter(t for r in P["rows"] for t in r["cells"].values())
        # 値でない欄にある数の語(番号・種別№・規格 等)を bbox から数えて layout 側から引く
        other = collections.Counter()
        for r in P["rows"]:
            for fld in ("shu_no", "no", "item", "spec", "remark", "kind", "unit"):
                for t in r[fld].split():
                    if isval(t):
                        other[t] += 1
        for c in P["cols"]:
            for t in (c["code"] + " " + c["name"]).split():
                if isval(t):
                    other[t] += 1
        rest = lay_c - other
        checks.append({"page": pno, "kind": "grid", "rows": len(P["rows"]), "layout_value_tokens": sum(rest.values()),
                       "bbox_values": sum(bb_c.values()), "multiset_equal": rest == bb_c,
                       "max_col_dist_pt": P["max_col_dist_pt"], "cols": len(P["cols"])})
    # ---- 1列の単価の表
    for sec in LIST_SECTIONS:
        prev_item = ""
        for pno in sec["pages"]:
            recs = parse_list_page(pages[pno - 1], pno, sec)
            other = collections.Counter()
            for r in recs:
                stats["list_rows"] += 1
                item = r.get("item", "")
                if not item and sec["carry_item"]:
                    item = prev_item
                assert item, (pno, "品目が無い", r)
                prev_item = item
                parts = [r.get(k, "") for k in ("spec", "spec2", "mat", "coat")]
                spec = " ".join(x for x in parts if x)
                if r.get("qty"):
                    spec = (spec + " (数量 " + r["qty"] + ")").strip()
                rem = []
                if r.get("rem"):
                    rem.append(("代表規格 " if sec["name"].startswith("ボルト") else "") + r["rem"])
                if r.get("rem2"):
                    rem.append("参考質量（㎏/個） " + r["rem2"])
                if rem:
                    spec = (spec + " [" + " / ".join(rem) + "]").strip()
                t = r.get("price")
                assert t is not None, (pno, "単価が無い", r)
                if t in DASH:
                    status, price, note = "not_set", "", NOTE_NOTSET
                else:
                    status, price, note = "published_pdl", num(t), NOTE_OPEN
                note += " 都県・地区の区別のない局の単価(%s)。" % sec["name"]
                if sec["name"].startswith("電気通信"):
                    note += " 地区割一覧表の注「電気通信資材は、関東統一とする」。"
                nat = ("material", item, spec, r["unit"], "bureau_area", "", "関東地方整備局", "", "design_unit_price_ex_tax")
                if nat in nat_seen:
                    raise SystemExit("同じ観測が2行: %s p%d と p%d" % (nat, nat_seen[nat], pno))
                nat_seen[nat] = pno
                rows.append({"obs_id": make_id(SID, pno, sec["name"], r.get("no", ""), item, spec, r["unit"]),
                             "country": "JP", "layer": "material", "category": sec["name"], "item_name": item, "spec": spec,
                             "unit": r["unit"], "geo_level": "bureau_area", "geo_code": "", "geo_name": "", "area_label": "関東地方整備局",
                             "area_code": "", "area_members": "", "price": price, "currency": "JPY", "price_basis": "design_unit_price_ex_tax",
                             "price_status": status, "period": PERIOD, "effective_from": EFF, "source_id": SID, "source_page": pno,
                             "evidence_url": URL, "license": "PDL1.0", "note": note})
                stats["status:" + status] += 1
                stats["layer:material"] += 1
                for k, v in r.items():
                    if k != "price":
                        for tok in v.split():
                            if isval(tok):
                                other[tok] += 1
            lay_c = collections.Counter(t for ln in lay[pno - 1].split("\n") for t in ln.split() if isval(t))
            bb_c = collections.Counter(r["price"] for r in recs)
            restc = lay_c - other
            checks.append({"page": pno, "kind": "list", "rows": len(recs), "layout_value_tokens": sum(restc.values()),
                           "bbox_values": sum(bb_c.values()), "multiset_equal": restc == bb_c, "section": sec["name"]})
    # ---- 罫線で区切られた小さい表
    for T in RULED:
        recs = parse_ruled(pages, T)
        for r in recs:
            t = r.get("price")
            if not t:
                # 40頁「橋梁用排水管継手 ゴム製伸縮継手 個 次項」: 単価は次頁(ゴム製伸縮継手単価)にある。行を作らない
                assert "次項" in (r.get("unit", "") + r.get("spec", "")), (T["page"], "単価が無い", r)
                stats["ruled_skipped_next_page"] += 1
                continue
            stats["ruled_rows"] += 1
            item = T.get("item_fixed") or r.get("item", "")
            assert item, (T["page"], "品名が無い", r)
            unit = T.get("unit") or r.get("unit", "")
            parts = []
            if T.get("item_fixed") and r.get("item"):
                parts.append(T.get("item_as_spec", "") + r["item"])
            if r.get("spec"):
                parts.append(T.get("spec_prefix", "") + r["spec"])
            if r.get("spec2"):
                parts.append(T.get("spec2_prefix", "") + r["spec2"])
            spec = " ".join(parts)
            rem = []
            for k in ("rem", "rem2"):
                if r.get(k):
                    lab = T["labels"].get(k, "")
                    rem.append((lab + " " if lab else "") + r[k])
            if rem:
                spec = (spec + " [" + " / ".join(rem) + "]").strip()
            if t in DASH:
                status, price, note = "not_set", "", NOTE_NOTSET
            else:
                status, price, note = "published_pdl", num(t), NOTE_OPEN
            note += " 都県・地区の区別のない局の単価(%s)。" % T["name"]
            nat = ("material", item, spec, unit, "bureau_area", "", "関東地方整備局", "", "design_unit_price_ex_tax")
            if nat in nat_seen:
                raise SystemExit("同じ観測が2行: %s p%d と p%d" % (nat, nat_seen[nat], T["page"]))
            nat_seen[nat] = T["page"]
            rows.append({"obs_id": make_id(SID, T["page"], T["name"], item, spec, unit),
                         "country": "JP", "layer": "material", "category": T["name"], "item_name": item, "spec": spec,
                         "unit": unit, "geo_level": "bureau_area", "geo_code": "", "geo_name": "", "area_label": "関東地方整備局",
                         "area_code": "", "area_members": "", "price": price, "currency": "JPY", "price_basis": "design_unit_price_ex_tax",
                         "price_status": status, "period": PERIOD, "effective_from": EFF, "source_id": SID, "source_page": T["page"],
                         "evidence_url": URL, "license": "PDL1.0", "note": note})
            stats["status:" + status] += 1
            stats["layer:material"] += 1
        # 照合: 各行の単価(桁区切りつき)が -layout の本文で、その行の規格の最後の語と同じ行か隣の行に出ること
        lines_l = lay[T["page"] - 1].split("\n")
        hits = 0
        mine = [r for r in rows if r["source_page"] == T["page"] and r["category"] == T["name"] and r["price"]]
        for r in mine:
            pr = "{:,}".format(int(r["price"]))
            tok = r["spec"].split(" [")[0].split()[-1] if r["spec"] else r["item_name"]
            for i, l in enumerate(lines_l):
                if re.search(r"(^|\s)" + re.escape(pr) + r"(\s|$)", l) and tok in " ".join(lines_l[max(0, i - 1):i + 2]):
                    hits += 1; break
        checks.append({"page": T["page"], "kind": "ruled", "section": T["name"], "rows": len(recs),
                       "offset_dx_dy_pairs_spread": recs[0]["_offset"], "multiset_equal": hits == len(mine),
                       "layout_value_tokens": hits, "bbox_values": len(mine),
                       "note": "罫線の表: 単価が -layout の本文でその行の規格と同じ行か隣の行に出る数(layout_value_tokens)と行数(bbox_values)"})
    return rows, stats, checks, maxd, area, area_err, unmatched, sha, pages, lay


if __name__ == "__main__":
    rows, stats, checks, maxd, area, area_err, unmatched, sha, pages, lay = main()
    n = write_obs(OUT, rows)
    bad = [c for c in checks if not c["multiset_equal"]]
    summary = {"source_id": SID, "pdf_sha256": sha, "rows_written": n, "stats": dict(stats), "max_col_dist_pt": maxd,
               "area_labels": area_err[0], "area_labels_without_cell": area_err[1], "area_entries": len(area),
               "grid_columns_without_area_members": sorted(map(list, unmatched)),
               "check_pages": len(checks), "check_pages_equal": len(checks) - len(bad),
               "check_values_total_grid_list": sum(c["bbox_values"] for c in checks if c["kind"] != "ruled"),
               "ruled_values": sum(c["bbox_values"] for c in checks if c["kind"] == "ruled"), "check_bad": bad,
               "checks": checks}
    json.dump(summary, open(os.path.join(OBS2, "reports", "B2_ktr_parse_summary.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in summary.items() if k != "checks"}, ensure_ascii=False, indent=1))
