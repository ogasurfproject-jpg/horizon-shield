# -*- coding: utf-8 -*-
"""
国交省「公共工事設計労務単価」(各年の報道発表資料 PDF) から、47都道府県 x 職種の単価を取り出し、観測層 v2 の CSV にする。

年ごとに組版が少しずつ違う(職種数、横長の表の有無、頁の回転、フォントの埋め込み)ので、列の位置を決め打ちせず、
語の座標(pdftotext -bbox-layout、読めない年は pdfminer)で表を読む:

  1. 表の頁 = 「2桁の県コード + 県名」の語が並ぶ頁。県名の語の右端より右にある数(と「-」)だけを値とみなす。
  2. 行 = 値の語の y 中心を、いちばん近い県名の行に割り当てる。
  3. 列 = 値の語の右端(xMax)で束ねる(単価は右寄せなので、同じ列の右端は揃う)。
     ＜山括弧＞付きの値は右端がずれるので、x 中心がいちばん近い列に入れる。
  4. 列の見出し = 表の上の見出し帯の語を x の重なりで束ね、上から順につないだ文字。見出しの列数と値の列数が一致しなければ止める。
  5. 同じ PDF に同じ単価が二つの組版で載っている:
       A. 横長の表: 1頁20職種、値の無い欄は「-」、下段に(必要経費込みの参考値)がある年もある
       B. 縦長の表: 1頁10職種、値の無い欄は空白
     A を正として読み、B と全セル(値の有無を含む)で突き合わせる。1セルでも違えば止める(取り込まない)。
  6. 別の読み方の照合として、見出しの x 中心と値の x 中心の距離を全セルで測り、最大値と、隣の見出しとの余裕を出す。
     さらに別のエンジン(pdfminer / poppler)で同じ頁を読み、値の並びが一致するかも数える。

使い方:
  python3 parse_mlit_roumu_hist.py <year_key> [--check-only]
    year_key: r7 r6 r5 r4 r3 r2 h31 h30 h29 h28 h27 h26 h25 (r8 は回帰試験用に読むだけ)
  入力: OBS2/raw/mlit-roumu-<year_key>.pdf と OBS2/sources/mlit-roumu-<year_key>.json(台帳)
  出力: OBS2/observations/jp/labor_mlit_roumu_<year_key>.csv と、照合の数字を OBS2/tools/parsers/out/roumu_<year_key>_check.json
"""
import os, re, sys, json, html, subprocess, tempfile, hashlib, collections

HERE = os.path.dirname(os.path.abspath(__file__))
OBS2 = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(OBS2, "tools"))
from obs_common import write_obs, make_id, JP_PREF_CODE, JP_CODE_PREF  # noqa: E402

NUM_RE = re.compile(r"^([<＜])?(\()?(\d{1,3}(?:,\d{3})+)(\))?([>＞])?$")
DASH_RE = re.compile(r"^[-－‐\u2015ー]$")
CODE_RE = re.compile(r"^\d\d$")
PREF_NAMES = set(JP_PREF_CODE)

# 年ごとの設定。period は適用開始の年月、effective_from はその日(原本の本文で確かめた日付)。
YEARS = {
    "r8": dict(period="2026-03", eff="2026-03-01", label="令和8年3月"),
    "r7": dict(period="2025-03", eff="2025-03-01", label="令和7年3月"),
    "r6": dict(period="2024-03", eff="2024-03-01", label="令和6年3月"),
    "r5": dict(period="2023-03", eff="2023-03-01", label="令和5年3月"),
    "r4": dict(period="2022-03", eff="2022-03-01", label="令和4年3月"),
    "r3": dict(period="2021-03", eff="2021-03-01", label="令和3年3月"),
    "r2": dict(period="2020-03", eff="2020-03-01", label="令和2年3月"),
    "h31": dict(period="2019-03", eff="2019-03-01", label="平成31年3月"),
    "h30": dict(period="2018-03", eff="2018-03-01", label="平成30年3月"),
    "h29": dict(period="2017-03", eff="2017-03-01", label="平成29年3月"),
    "h28": dict(period="2016-02", eff="2016-02-01", label="平成28年2月"),
    "h27": dict(period="2015-02", eff="2015-02-01", label="平成27年2月"),
    "h26": dict(period="2014-02", eff="2014-02-01", label="平成26年2月"),
    "h25": dict(period="2013-04", eff="2013-04-01", label="平成25年度"),
}

REF_NOTE = "公共工事設計労務単価＋必要経費(法定福利費(事業主負担分)、労務管理費、宿舎費等)の参考値"


# ---------- 語の座標を読む ----------

def words_poppler(pdf):
    """pdftotext -bbox-layout。頁ごとに [(x0, y0, x1, y1, text)]。"""
    with tempfile.NamedTemporaryFile(suffix=".html", delete=False) as t:
        out = t.name
    subprocess.run(["pdftotext", "-bbox-layout", pdf, out], check=True, capture_output=True)
    s = open(out, encoding="utf-8").read()
    os.unlink(out)
    pages = []
    for p in re.split(r"<page ", s)[1:]:
        ws = [(float(a), float(b), float(c), float(d), html.unescape(e))
              for a, b, c, d, e in re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', p)]
        pages.append(ws)
    return pages


def words_pdfminer(pdf):
    """pdfminer(pdfplumber 経由)。poppler がフォントを解けない年(h29)の正、他の年の照合に使う。"""
    import pdfplumber
    pages = []
    with pdfplumber.open(pdf) as d:
        for p in d.pages:
            # 太字を重ね打ちした文字(『青青森森県県』)を1つにしてから語にする
            ws = p.dedupe_chars(tolerance=1).extract_words(x_tolerance=1.0, y_tolerance=1.0, keep_blank_chars=False)
            pages.append([(w["x0"], w["top"], w["x1"], w["bottom"], w["text"]) for w in ws])
    return pages


# ---------- 表を読む ----------

def xc(w):
    return (w[0] + w[2]) / 2


def yc(w):
    return (w[1] + w[3]) / 2


def find_pref_rows(ws):
    """『2桁コード』と『県名』が同じ高さで隣り合う語の組。戻り値 [(code, name, yc, name_x1)]。"""
    rows = {}
    codes = [w for w in ws if CODE_RE.match(w[4])]
    for w in ws:
        name = w[4]
        m = re.match(r"^(\d\d)(\S+)$", name)
        if m and m.group(2) in PREF_NAMES and JP_PREF_CODE[m.group(2)] == m.group(1):
            rows[m.group(1)] = (m.group(1), m.group(2), yc(w), w[2])
            continue
        if name not in PREF_NAMES:
            continue
        for c in codes:
            if abs(yc(c) - yc(w)) < 2.0 and -0.5 <= w[0] - c[2] <= 12 and JP_PREF_CODE[name] == c[4]:
                rows[c[4]] = (c[4], name, yc(w), w[2])
                break
    return sorted(rows.values(), key=lambda r: r[2])


def tok_kind(t):
    """値の語の種類: dash / num。丸括弧 (paren) と山括弧 (bracket) は印として別に返す。数でなければ None。"""
    if DASH_RE.match(t):
        return ("dash", False, False)
    m = NUM_RE.match(t)
    if not m:
        return None
    br_l, par_l, n, par_r, br_r = m.groups()
    if bool(par_l) != bool(par_r) or bool(br_l) != bool(br_r):
        return None
    return ("num", bool(par_l), bool(br_l))


def tok_val(t):
    m = NUM_RE.match(t)
    return int(m.group(3).replace(",", ""))


def cluster_1d(vals, gap):
    """昇順に並べ、隣との差が gap を超えたら切る。戻り値: 各群の値のリスト。"""
    vs = sorted(vals)
    groups = [[vs[0]]]
    for v in vs[1:]:
        if v - groups[-1][-1] > gap:
            groups.append([v])
        else:
            groups[-1].append(v)
    return groups


def header_columns(ws, R, band_top, first_top):
    """見出し帯の語を x の重なりで束ねる。戻り値 [{'text','center','x0','x1'}] (x 順)。"""
    hw = [w for w in ws if w[1] >= band_top and w[3] <= first_top + 0.5 and xc(w) > R
          and not any(s in w[4] for s in ("単位", "金額", "所定", "円）", "上段", "下段", "参考値"))]
    hcols = []
    for w in sorted(hw, key=lambda w: w[0]):
        hcols.append({"x0": w[0], "x1": w[2], "ws": [w]})
    merged = True
    while merged:
        merged = False
        hcols.sort(key=lambda h: h["x0"])
        for i in range(len(hcols) - 1):
            a, b = hcols[i], hcols[i + 1]
            if b["x0"] < a["x1"] - 0.3:
                a["ws"] += b["ws"]; a["x1"] = max(a["x1"], b["x1"]); del hcols[i + 1]; merged = True
                break
    for hc in hcols:
        lines = collections.OrderedDict()
        for w in sorted(hc["ws"], key=lambda w: (round(w[1]), w[0])):
            lines.setdefault(round(w[1]), []).append(w[4])
        hc["text"] = "".join("".join(v) for v in lines.values()).replace(" ", "").replace("\u3000", "")
        hc["center"] = (hc["x0"] + hc["x1"]) / 2
    return hcols


def read_table_page(ws, pno):
    rows = find_pref_rows(ws)
    if len(rows) < 10:
        return None
    R = max(r[3] for r in rows)
    ys = [r[2] for r in rows]
    spacing = min(b - a for a, b in zip(ys, ys[1:])) if len(ys) > 1 else 10
    top, bot = min(ys) - spacing, max(ys) + spacing
    toks = []
    for w in ws:
        if w[0] <= R + 0.3 or not (top <= yc(w) <= bot):
            continue
        k = tok_kind(w[4])
        if k:
            toks.append((w, k))
    if not toks:
        return None
    # 行への割り当て(いちばん近い県の行)
    assigned = []
    for w, k in toks:
        d, r = min((abs(yc(w) - r[2]), r) for r in rows)
        if d > 0.75 * spacing:
            raise SystemExit("p%d: 行に割り当てられない値 %r (y=%.1f, 最近の県 %s 距離 %.1f)" % (pno, w[4], yc(w), r[1], d))
        assigned.append((w, k, r))
    # 組版の種類: 下段に丸括弧の参考値が 30 県以上にあれば A(横長)、無ければ B(縦長)
    lower_rows = {r[0] for w, k, r in assigned if k[1] and yc(w) - r[2] > 1.0}
    kind = "A" if len(lower_rows) >= 30 else "B"
    # 見出し
    first_top = min(w[1] for w, k, r in assigned if r[0] == rows[0][0])
    labels = [w for w in ws if (w[4] in ("地方連絡", "協議会名") or w[4].startswith("都道府県")) and w[1] < first_top]
    if not labels:
        raise SystemExit("p%d: 見出しの目印(地方連絡/都道府県名)が無い" % pno)
    band_top = min(w[1] for w in labels) - 7.0
    hcols = header_columns(ws, R, band_top, first_top)
    ncol = len(hcols)
    centers = [h["center"] for h in hcols]
    # 列: 数(山括弧付きを除く)を右端(xMax)で束ねる。群の数が見出しの列数と一致すれば順に対応させる。
    xm = [w[2] for w, k, _ in assigned if k[0] == "num" and not k[2]]
    diffs = sorted(b - a for a, b in zip(centers, centers[1:]))
    col_pitch = diffs[len(diffs) // 2] if diffs else 40.0
    gap = min(10.0, 0.35 * col_pitch)
    groups = cluster_1d(xm, gap)
    if len(groups) != ncol:
        raise SystemExit("p%d: 見出しの列数 %d と値の列(右端の群)の数 %d が違う: %s" % (pno, ncol, len(groups), [h["text"] for h in hcols]))
    col_xmax = [sum(g) / len(g) for g in groups]
    col_spread = max(max(g) - min(g) for g in groups)
    cells = []
    dash_by_xmax = dash_by_center = 0
    for w, k, r in assigned:
        if k[0] == "num" and not k[2]:
            j = min(range(ncol), key=lambda j: abs(w[2] - col_xmax[j]))
        elif k[0] == "dash":
            j0 = min(range(ncol), key=lambda j: abs(w[2] - col_xmax[j]))
            if abs(w[2] - col_xmax[j0]) <= 1.0:
                j = j0; dash_by_xmax += 1
            else:
                j = min(range(ncol), key=lambda j: abs(xc(w) - centers[j])); dash_by_center += 1
        else:  # 山括弧付き: 右端がずれるので x 中心で
            col_c = {}
            j = min(range(ncol), key=lambda j: abs(xc(w) - (col_xmax[j] - (w[2] - w[0]) / 2 + 2.0)))
        cells.append((r[0], j, w, k))
    # 見出し中心と値中心の距離、隣の見出しとの余裕(別の読み方の照合)
    maxd, min_margin, near_ok = 0.0, 1e9, 0
    for code, j, w, k in cells:
        d = abs(xc(w) - centers[j])
        maxd = max(maxd, d)
        others = [abs(xc(w) - c) for i, c in enumerate(centers) if i != j]
        if others:
            min_margin = min(min_margin, min(others) - d)
        near_ok += (min(range(ncol), key=lambda i: abs(xc(w) - centers[i])) == j)
    return {"page": pno, "kind": kind, "rows": rows, "jobs": [h["text"] for h in hcols], "cells": cells, "ncol": ncol,
            "col_spread": col_spread, "max_hdr_dist": maxd, "min_margin": min_margin,
            "nearest_hdr_agree": near_ok, "ncells": len(cells), "row_spacing": spacing,
            "dash_by_xmax": dash_by_xmax, "dash_by_center": dash_by_center, "col_pitch": col_pitch}


def build(pages_words):
    """表の頁を全部読み、A(横長)と B(縦長)の組版ごとに {(code, job): cell} を作る。"""
    tabs = []
    for i, ws in enumerate(pages_words, 1):
        t = read_table_page(ws, i)
        if t:
            tabs.append(t)
    out = {"A": {}, "B": {}, "pages": {"A": [], "B": []}, "jobs": {"A": [], "B": []}, "stats": []}
    for t in tabs:
        K = t["kind"]
        out["pages"][K].append(t["page"])
        out["jobs"][K] += t["jobs"]
        st = {k: t[k] for k in ("page", "kind", "ncol", "ncells", "col_spread", "max_hdr_dist", "min_margin",
                                "nearest_hdr_agree", "row_spacing", "dash_by_xmax", "dash_by_center", "col_pitch")}
        st["prefs"] = len(t["rows"])
        out["stats"].append(st)
        by = collections.defaultdict(list)
        for code, j, w, k in t["cells"]:
            by[(code, j)].append((w, k))
        for r in t["rows"]:
            code = r[0]
            for j, job in enumerate(t["jobs"]):
                ts = by.get((code, j), [])
                key = (code, job)
                if key in out[K]:
                    raise SystemExit("p%d: %s %s が2回出る" % (t["page"], code, job))
                if K == "A":
                    # 上段(単価)は行の中心より上、下段(参考値)は下
                    up = [x for x in ts if yc(x[0]) < r[2] - 0.3 and not x[1][1]]
                    lo = [x for x in ts if yc(x[0]) >= r[2] - 0.3 and (x[1][1] or x[1][0] == "dash")]
                    if len(up) == 0 and len(lo) == 1 and len(ts) == 1 and lo[0][1][0] == "dash":
                        # 上段に語が無く下段が『-』(h29 の一部の列。フォントの都合で上段の『-』が取れない)。B と突き合わせて確かめる。
                        out.setdefault("odd", []).append((t["page"], code, job, "上段 (語なし) / 下段 -"))
                        out[K][key] = {"wage": None, "ref": None, "paren": False, "bracket": False, "page": t["page"],
                                       "odd": "上段 (語なし) / 下段 -"}
                        continue
                    if len(up) != 1 or len(lo) != 1 or len(ts) != 2:
                        raise SystemExit("p%d: %s %s 上段 %d 個 / 下段 %d 個: %s" % (t["page"], code, job, len(up), len(lo), [x[0][4] for x in ts]))
                    u, lw = up[0], lo[0]
                    odd = ""
                    if (u[1][0] == "dash") != (lw[1][0] == "dash"):
                        # 原本の不整合(上段に単価があるのに下段が『-』など)。止めずに印を付けて報告する。
                        odd = "上段 %s / 下段 %s" % (u[0][4], lw[0][4])
                        out.setdefault("odd", []).append((t["page"], code, job, odd))
                    out[K][key] = {"wage": None if u[1][0] == "dash" else tok_val(u[0][4]),
                                   "ref": None if lw[1][0] == "dash" else tok_val(lw[0][4]),
                                   "paren": False, "bracket": u[1][2], "page": t["page"], "odd": odd}
                else:
                    if len(ts) > 1:
                        raise SystemExit("p%d: %s %s 値が %d 個" % (t["page"], code, job, len(ts)))
                    if ts and ts[0][1][0] == "dash":
                        out[K][key] = {"wage": None, "paren": False, "bracket": False, "page": t["page"], "dash": True}
                    else:
                        out[K][key] = {"wage": tok_val(ts[0][0][4]) if ts else None,
                                       "paren": bool(ts) and ts[0][1][1], "bracket": bool(ts) and ts[0][1][2],
                                       "page": t["page"]}
    return out


def compare(A, B):
    """A と B を全セルで突き合わせる(値の有無も)。戻り値: (一致数, 不一致のリスト)"""
    keys = set(A) | set(B)
    mism = []
    ok = 0
    for k in sorted(keys):
        a, b = A.get(k), B.get(k)
        if a is None or b is None:
            mism.append((k, a and a["wage"], b and b["wage"], "片方に無い"))
            continue
        if a["wage"] != b["wage"]:
            mism.append((k, a["wage"], b["wage"], "値が違う"))
            continue
        ok += 1
    return ok, mism


# ---------- CSV に書く ----------

R8_NAMES = ["特殊作業員", "普通作業員", "軽作業員", "造園工", "法面工", "とび工", "石工", "ブロック工", "電工", "鉄筋工",
            "鉄骨工", "塗装工", "溶接工", "運転手（特殊）", "運転手（一般）", "潜かん工", "潜かん世話役", "さく岩工",
            "トンネル特殊工", "トンネル作業員", "トンネル世話役", "橋りょう特殊工", "橋りょう塗装工", "橋りょう世話役",
            "土木一般世話役", "高級船員", "普通船員", "潜水士", "潜水連絡員", "潜水送気員", "山林砂防工", "軌道工",
            "型わく工", "大工", "左官", "配管工", "はつり工", "防水工", "板金工", "タイル工", "サッシ工", "屋根ふき工",
            "内装工", "ガラス工", "建具工", "ダクト工", "保温工", "設備機械工", "交通誘導警備員Ａ", "交通誘導警備員Ｂ"]


def nfkc(s):
    import unicodedata
    return unicodedata.normalize("NFKC", s)


def item_name(job):
    """表の見出しの文字を、令和8年のファイル(labor_mlit_roumu_r8.csv)と同じ書き方にそろえる。
    見出しでは半角の A/B、本文と職種の定義では全角の Ａ/Ｂ なので、末尾の A/B だけ全角にする。それ以外は見出しの文字のまま。"""
    for n in R8_NAMES:
        if nfkc(n) == nfkc(job):
            return n
    return re.sub(r"A$", "Ａ", re.sub(r"B$", "Ｂ", job))


def page_texts(pdf, engine):
    if engine == "poppler":
        r = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True)
        return r.stdout.decode("utf-8", "replace").split("\f")
    import pdfplumber
    with pdfplumber.open(pdf) as d:
        return [p.extract_text() or "" for p in d.pages]


def flat(s):
    return re.sub(r"\s+", "", nfkc(s))


def notes_from_pages(texts, a_pages, b_pages):
    """縦長の表の(注)と、横長の表の『(下段)』の説明を原本から取る(要約しない。空白だけ詰める)。"""
    fb = flat(texts[b_pages[0] - 1])
    paren = re.search(r"\(注\)岩手県、宮城県、福島県における.*?。(?:[^(]*?。)?", fb)
    brack = re.search(r"\(注\)<山括弧書き>.*?。", fb)
    fa = flat(texts[a_pages[0] - 1])
    lower = re.search(r"\(下段\):(.*?\)\((?:参考値|試算値)\))", fa)
    return {"paren": paren.group(0) if paren else "", "bracket": brack.group(0) if brack else "",
            "lower": lower.group(1) if lower else ""}


def main():
    y = sys.argv[1]
    cfg = YEARS[y]
    sid = "mlit-roumu-" + y
    pdf = os.path.join(OBS2, "raw", sid + ".pdf")
    led = json.load(open(os.path.join(OBS2, "sources", sid + ".json"), encoding="utf-8"))
    sha = hashlib.sha256(open(pdf, "rb").read()).hexdigest()
    assert sha == led["sha256"], "原本の sha256 が台帳と違う"
    engine = "pdfminer" if y == "h29" else "poppler"
    words = words_pdfminer(pdf) if engine == "pdfminer" else words_poppler(pdf)
    o = build(words)
    texts = page_texts(pdf, engine)
    # 適用開始の文言が原本にあるか
    want = {"h25": "平成25年4月から適用"}.get(y, cfg["label"] + "から適用")
    assert any(want in flat(t) for t in texts), "原本に『%s』が無い" % want
    ok, mism = compare(o["A"], o["B"])
    jobs = o["jobs"]["A"]
    nA, nB = len(o["A"]), len(o["B"])
    check = {"year": y, "engine": engine, "pages_A": o["pages"]["A"], "pages_B": o["pages"]["B"],
             "jobs": len(jobs), "jobs_A_eq_B": o["jobs"]["A"] == o["jobs"]["B"], "cells_A": nA, "cells_B": nB,
             "cells_expected": len(jobs) * 47, "A_B_agree": ok, "A_B_mismatch": len(mism),
             "max_hdr_value_center_dist": round(max(s["max_hdr_dist"] for s in o["stats"]), 2),
             "min_margin_to_next_header": round(min(s["min_margin"] for s in o["stats"]), 2),
             "max_xmax_spread_in_column": round(max(s["col_spread"] for s in o["stats"]), 2),
             "nearest_header_agrees": sum(s["nearest_hdr_agree"] for s in o["stats"]),
             "cells_read": sum(s["ncells"] for s in o["stats"]),
             "dash_assigned_by_right_edge": sum(s["dash_by_xmax"] for s in o["stats"]),
             "dash_assigned_by_header_center": sum(s["dash_by_center"] for s in o["stats"]),
             "odd": o.get("odd", []), "page_stats": o["stats"]}
    if mism or not check["jobs_A_eq_B"] or nA != len(jobs) * 47 or nB != nA:
        for m in mism[:10]:
            print("MISMATCH", m)
        print(json.dumps({k: v for k, v in check.items() if k != "page_stats"}, ensure_ascii=False))
        sys.exit("組版Aと組版Bが一致しない、または件数が 職種数 x 47 でない。取り込まない。")
    notes = notes_from_pages(texts, o["pages"]["A"], o["pages"]["B"])
    check["notes"] = notes
    parenB = sum(1 for v in o["B"].values() if v["paren"])
    brackB = sum(1 for v in o["B"].values() if v["bracket"])
    if parenB:
        assert notes["paren"], "丸括弧の値があるのに注が取れない"
    if brackB:
        assert notes["bracket"], "山括弧の値があるのに注が取れない"
    assert notes["lower"], "下段の説明が取れない"
    ref_note = "原本の下段(括弧書き): " + notes["lower"]
    order = {j: i for i, j in enumerate(jobs)}
    rows = []
    for (code, job), a in sorted(o["A"].items(), key=lambda kv: (kv[0][0], order[kv[0][1]])):
        b = o["B"][(code, job)]
        name = item_name(job)
        has = a["wage"] is not None
        note = []
        if not has:
            note.append("原本の表で『-』(この都道府県ではこの職種の単価を設定していない)")
        if b["paren"]:
            note.append("原本の縦長の表で丸括弧書き。" + notes["paren"])
        if b["bracket"]:
            note.append("原本の縦長の表で山括弧書き。" + notes["bracket"])
        if a.get("odd"):
            note.append("原本の横長の表の上段・下段: " + a["odd"])
        rows.append({
            "obs_id": make_id(sid, code, name), "country": "JP", "layer": "labor", "category": "労務単価",
            "item_name": name, "spec": "所定労働時間内8時間あたり", "unit": "人日",
            "geo_level": "pref", "geo_code": code, "geo_name": JP_CODE_PREF[code],
            "price": str(a["wage"]) if has else "", "currency": "JPY", "price_basis": "labor_wage_8h",
            "price_status": "published_pdl" if has else "not_set",
            "ref_value": str(a["ref"]) if (has and a["ref"] is not None) else "",
            "ref_note": ref_note if (has and a["ref"] is not None) else "",
            "period": cfg["period"], "effective_from": cfg["eff"], "source_id": sid,
            "source_page": "p%d(横長の表) / p%d(縦長の表)" % (a["page"], b["page"]),
            "evidence_url": led["url"], "license": led["license"], "jccdb_v4_item_id": "",
            "note": " ".join(note)})
    out = os.path.join(OBS2, "observations", "jp", "labor_mlit_roumu_%s.csv" % y)
    n = write_obs(out, rows)
    check["rows_written"] = n
    check["published_pdl"] = sum(1 for r in rows if r["price_status"] == "published_pdl")
    check["not_set"] = sum(1 for r in rows if r["price_status"] == "not_set")
    check["with_ref_value"] = sum(1 for r in rows if r["ref_value"])
    check["paren_marked_B"] = parenB
    check["bracket_marked_B"] = brackB
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    json.dump(check, open(os.path.join(HERE, "out", "roumu_%s_check.json" % y), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in check.items() if k not in ("page_stats", "notes")}, ensure_ascii=False))
    print("wrote", out, n)


if __name__ == "__main__":
    main()
