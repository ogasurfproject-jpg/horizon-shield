# -*- coding: utf-8 -*-
"""
北海道開発局「北海道開発局単価(令和8年9月1日以降入札書提出期限日の請負工事・業務等に適用)」(閲覧単価一覧、A3横、52頁)を、
罫線の格子とセルの座標で読み、観測層 v2 に書く。
使い方: python3 parse_hkd_zairyo.py [--month r8_09|r8_10|r8_11] [--out 出力.csv] [--debug 出力.csv] [--check 照合結果.json]
  --month を省くと r8_09(9月の表、最初の取り込みと同じ動き)。月ごとに別の source_id・別のファイル(古い月の行は消さない)。
  開発局は同じ URL の PDF を毎月差し替えるので、原本は raw/<source_id>.pdf を MONTHS の sha256 で固定し、表紙の適用日の文言で月を確かめる。
  --out を渡すとそこに書く(古い月に当て直して md5 を比べるときに、既存のファイルを書き換えないため)。
  頁の照合: 表の頁の下端の「n / N ページ」が 1..N の連番で N 頁そろうこと、表でない頁が表の前(表紙・説明・目次)だけであること、
  目次の分類コードがすべて表に現れ、目次の頁(n)の頁に最初に出ること。合わなければ problems に数えて止める。

表の列: 分類 / 名称 / 規格 / 単位 / 摘要１ / 摘要２ / 荷渡条件 / 札幌 函館 小樽 旭川 室蘭 釧路 帯広 網走 留萌 稚内(開発建設部)。
- 語は pdftotext -bbox-layout の座標、罫線の位置は pdfplumber(線の座標だけ)。
- 行 = 単位の列と値の列を横切る横罫線で区切った帯。列 = 見出し行の下まで伸びる縦罫線で区切ったセル。
- 金額欄『-』は原本の説明どおり「物価資料等の刊行物に記載されている単価」→ publication_based_not_public(値なし)。
  『＊』(市場で実勢価格が確認できない)→ not_set。0 は not_set(0 円ではない)。空欄は行を作らない。
- 労務の表(01-01 労務賃金、01-02 設計業務等賃金、01-03 電気通信関係技術者賃金、01-04 工場製作労務)は取り込まない。
- layer: 市場単価(04-xx)は work。機械の賃料・損料(02-85, 03-03, 03-05, 07-05)で単位が時間(h/日/供用日/月)のものは equipment。ほかは material。
照合: pdfplumber(pdfminer)の語で値のセルの語を別に拾い全件照合。pdftotext -layout と bbox の頁ごとの数字の語の数の一致。
"""
import sys, os, re, json, csv, collections, hashlib, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
OBS2 = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(OBS2, "tools"))
from mlit_grid import poppler_pages, plumber_pages, layout_pages, merge_positions, h_cover, covers, cell_text, NUMTOK
from obs_common import make_id, num, write_obs



def _opt(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


MONTHS = {
    # 9月: 最初の取り込み(2026-09-26 取得)
    "r8_09": {"sid": "hkd-zairyo-r8-09", "period": "2026-09", "effective_from": "2026-09-01",
              "cover": "令和8年9月1日以降入札書提出期限日の請負工事・業務等に適用",
              "sha": "aea49512dd1eb482cbc1a591d5ee522df5612d0566ae393980d3e8bd60954ad2"},
    # 10月: 同じ URL の差し替え(2026-10-04 取得)
    "r8_10": {"sid": "hkd-zairyo-r8-10", "period": "2026-10", "effective_from": "2026-10-01",
              "cover": "令和8年10月1日以降入札書提出期限日の請負工事・業務等に適用",
              "sha": "fe077f82241bbe76aab13faeecbf04e6c7c15ef3207305f2c2c41707e4ca7c08"},
    # 11月: 同じ URL の差し替え(2026-11-02 取得)
    "r8_11": {"sid": "hkd-zairyo-r8-11", "period": "2026-11", "effective_from": "2026-11-01",
              "cover": "令和8年11月1日以降入札書提出期限日の請負工事・業務等に適用",
              "sha": "c1bb894257d4fc3cdf3ed3887c3369e0e0018f5003d8fc37817575ea5708ca0a"},
}
MONTH = _opt("--month", "r8_09")
M = MONTHS[MONTH]
SID = M["sid"]
PDF = "raw/%s.pdf" % SID
URL = "https://www.hkd.mlit.go.jp/ky/jg/gijyutu/ud49g70000000uh8-att/slo5pa0000016vb8.pdf"
OUT = _opt("--out", "observations/jp/material_hkd_zairyo_%s.csv" % MONTH)
AREAS = ["札幌", "函館", "小樽", "旭川", "室蘭", "釧路", "帯広", "網走", "留萌", "稚内"]
LABOR = {"01-01", "01-02", "01-03", "01-04"}
EQUIP = {"02-85", "03-03", "03-05", "07-05"}
NOTE = ("北海道開発局が実勢価格調査で設定した単価(物価資料等の刊行物に載っているものは含まない)。記載の単価に消費税は含まない(原本)。"
        "地区は開発建設部の管内(札幌=札幌開発建設部 など)。")


def toc(P):
    """目次(3-4頁)の 分類コード → (大分類名, 中分類名)。目次の頁の欄(表の通し頁)は pages[分類コード] に入れる"""
    m, pages = {}, {}
    for pn in (3, 4):
        ws = sorted(P[pn - 1], key=lambda w: (round(w[1]), w[0]))
        lines = collections.defaultdict(list)
        for w in ws:
            lines[round(w[1])].append(w)
        for y, ln in lines.items():
            ln = sorted(ln, key=lambda t: t[0])
            toks = [w for w in ln]
            i = 0
            while i < len(toks):
                if re.match(r"^\d\d-\d\d$", toks[i][4]) and i + 3 < len(toks):
                    code = toks[i][4]
                    # 次の分類コードか頁番号までを名前とみる: コード, 大分類, 中分類, 頁
                    j = i + 1
                    names = []
                    while j < len(toks) and not re.match(r"^\d+$", toks[j][4]):
                        names.append(toks[j][4]); j += 1
                    if len(names) >= 2:
                        m[code] = (names[0], " ".join(names[1:]))
                        if j < len(toks):
                            pages[code] = int(toks[j][4])
                    i = j + 1
                else:
                    i += 1
    return m, pages


def time_basis(unit):
    """単位が時間あたり(機械の賃料・損料)なら price_basis を返す。台・日、基・日 のような『数量・期間』も期間で決める。"""
    u = unit.replace(" ", "").replace("･", "・")
    last = u.split("・")[-1]
    if last in ("h", "hr", "時間"):
        return "equipment_rate_hourly"
    if last in ("日", "供用日"):
        return "equipment_rate_daily"
    if last in ("月", "ｶ月", "ヶ月", "か月", "供用月"):
        return "equipment_rate_monthly"
    return None


def main():
    dbg = sys.argv[sys.argv.index("--debug") + 1] if "--debug" in sys.argv else None
    pdf = os.path.join(OBS2, PDF)
    sha = hashlib.sha256(open(pdf, "rb").read()).hexdigest()
    if sha != M["sha"]:
        sys.exit("原本の sha256 が %s の値と違う: %s" % (MONTH, sha))
    P = poppler_pages(pdf)
    if M["cover"] not in "".join(w[4] for w in P[0]):
        sys.exit("表紙に『%s』が無い(月の取り違え)" % M["cover"])
    G = plumber_pages(pdf)
    L = layout_pages(pdf)
    T, TP = toc(P)
    nontable_pages, footers, first_page_of = [], [], {}
    out, dbg_rows, problems = [], [], []
    stats = collections.Counter()
    max_right, max_center = 0.0, 0.0
    cross_mismatch, layout_mismatch = [], []
    seen_codes = collections.Counter()
    overflow = []
    for pn in range(1, len(P) + 1):
        ws, g = P[pn - 1], G[pn - 1]
        lay_n = sum(1 for t in L[pn - 1].split() if NUMTOK.match(t))
        box_n = sum(1 for w in ws if NUMTOK.match(w[4]))
        stats["layout_num_tokens"] += lay_n
        stats["bbox_num_tokens"] += box_n
        if lay_n != box_n:
            layout_mismatch.append((pn, lay_n, box_n))
        hd = [w for w in ws if w[4] == "分類"]
        if not hd or not any(w[4] == "荷渡条件" for w in ws):
            stats["pages_not_table"] += 1
            nontable_pages.append(pn)
            continue
        ft = re.match(r"^(\d+)/(\d+)ページ$", "".join(w[4] for w in sorted([w for w in ws if w[1] > 800], key=lambda t: t[0])))
        footers.append((pn, int(ft.group(1)), int(ft.group(2))) if ft else (pn, None, None))
        head_y = hd[0][1]
        heads = {w[4]: w for w in ws if abs(w[1] - head_y) < 2.0}
        need = ["分類", "名称", "規格", "単位", "摘要１", "摘要２", "荷渡条件"] + AREAS
        miss = [k for k in need if k not in heads]
        if miss:
            problems.append(("header_missing", pn, miss)); continue
        stats["pages_table"] += 1
        V = [v for v in g["V"] if v[2] - v[1] > 3]
        H = [h for h in g["H"] if h[2] - h[1] > 3]
        head_bottom = max(heads[k][3] for k in need)
        # 行の境界: 単位の見出しと札幌の見出しの x 範囲を横切る横線
        hu, hs = heads["単位"], heads["札幌"]
        ys = merge_positions([h[0] for h in H], tol=0.6)
        bounds = [y for y in ys if y > head_bottom - 0.5 and covers(h_cover(H, y), hu[0], hu[2]) and covers(h_cover(H, y), hs[0], hs[2])]
        if len(bounds) < 2:
            problems.append(("no_rows", pn)); continue
        y_first, bottom = bounds[0], bounds[-1]
        # 列: データの最初の帯を縦に横切る縦線
        cols = merge_positions([v[0] for v in V if v[1] <= bounds[0] + 1.0 and v[2] >= bounds[1] - 1.0])
        cells = list(zip(cols[:-1], cols[1:]))
        def cell_of(x):
            for i, (a, b) in enumerate(cells):
                if a <= x < b:
                    return i
            return None
        ci = {k: cell_of((heads[k][0] + heads[k][2]) / 2) for k in need}
        if None in ci.values() or len(set(ci.values())) != len(need):
            problems.append(("header_cells", pn, ci)); continue
        used = set()
        prev = {}
        for k in range(len(bounds) - 1):
            y0, y1 = bounds[k], bounds[k + 1]
            bw = [w for w in ws if y0 - 0.3 <= (w[1] + w[3]) / 2 < y1 + 0.3]
            if not bw:
                continue
            per = collections.defaultdict(list)
            for w in bw:
                i = cell_of((w[0] + w[2]) / 2)
                if i is None:
                    problems.append(("outside_grid", pn, w)); continue
                if w[0] < cells[i][0] - 1.5 or w[2] > cells[i][1] + 1.5:
                    # 文字がセルからはみ出して隣のセルにかかる(原本の組版)。数字なら止める。文字は中心のセルに入れて数える
                    if NUMTOK.match(w[4]) or w[4] in ("-", "＊"):
                        problems.append(("straddle", pn, w))
                    else:
                        stats["text_overflow_words"] += 1
                        overflow.append((pn, w[4]))
                per[i].append(w)
                used.add(id(w))
            txt = {kk: cell_text(per.get(ci[kk], []), cells[ci[kk]][1]) for kk in ["分類", "名称", "規格", "単位", "摘要１", "摘要２", "荷渡条件"]}
            code = txt["分類"]
            if not re.match(r"^\d\d-\d\d$", code):
                problems.append(("bad_code", pn, txt)); continue
            seen_codes[code] += 1
            first_page_of.setdefault(code, pn)
            if code in LABOR:
                stats["rows_labor_skipped"] += 1
                continue
            item, spec, unit = txt["名称"], txt["規格"], txt["単位"]
            if not item or not unit:
                problems.append(("row_missing_item_or_unit", pn, txt)); continue
            big, mid = T.get(code, ("", ""))
            if not big:
                problems.append(("code_not_in_toc", pn, code))
            category = "%s %s %s" % (code, big, mid)
            ext = " / ".join(x for x in (txt["摘要１"], txt["摘要２"]) if x)
            spec_full = spec + (" [" + ext + "]" if ext else "")
            deliver = txt["荷渡条件"]
            if big == "市場単価":
                layer, basis = "work", "work_unit_price_ex_tax"
            elif code in EQUIP and time_basis(unit):
                layer, basis = "equipment", time_basis(unit)
            else:
                layer, basis = "material", "design_unit_price_ex_tax"
            stats["rows"] += 1
            for a in AREAS:
                i = ci[a]
                vw = per.get(i, [])
                if not vw:
                    stats["blank_cells"] += 1
                    continue
                t = cell_text(vw)
                price, status, extra = "", "published_pdl", ""
                if len(vw) == 1 and NUMTOK.match(t):
                    val = num(t)
                    if float(val) == 0:
                        status, extra = "not_set", "原本の値は 0。"
                        stats["zero_cells"] += 1
                    else:
                        price = val
                        stats["numeric_cells"] += 1
                    w = vw[0]
                    max_right = max(max_right, abs(cells[i][1] - w[2]))
                    hc = (heads[a][0] + heads[a][2]) / 2
                    max_center = max(max_center, abs((w[0] + w[2]) / 2 - hc))
                elif t in ("-", "－", "‐", "ー"):
                    status, extra = "publication_based_not_public", "原本の金額欄は『-』(物価資料等の刊行物に記載されている単価。開発局は値を載せていない)。"
                    stats["dash_cells"] += 1
                elif t in ("＊", "*"):
                    status, extra = "not_set", "原本の金額欄は『＊』(市場において実勢価格が確認できない単価)。"
                    stats["star_cells"] += 1
                else:
                    problems.append(("value_text", pn, item, spec, a, t)); continue
                note = NOTE + ("荷渡条件: %s。" % deliver if deliver else "") + extra
                oid = make_id(SID, pn, category, item, spec_full, unit, deliver, a)
                out.append({
                    "obs_id": oid, "country": "JP", "layer": layer, "category": category, "item_name": item,
                    "spec": spec_full, "unit": unit, "geo_level": "bureau_area", "geo_code": "01", "geo_name": "北海道",
                    "area_label": a, "area_code": "", "area_members": "", "price": price, "currency": "JPY",
                    "price_basis": basis, "price_status": status, "period": M["period"], "effective_from": M["effective_from"],
                    "source_id": SID, "source_page": pn, "evidence_url": URL, "license": "PDL1.0", "note": note,
                })
                if dbg is not None:
                    dbg_rows.append({"page": pn, "code": code, "item": item, "spec": spec_full, "unit": unit, "deliver": deliver, "area": a, "value": t})
        for w in ws:
            cy = (w[1] + w[3]) / 2
            if y_first < cy < bottom and id(w) not in used:
                problems.append(("not_in_band", pn, w))
        # 照合A: pdfplumber の語で値のセルの語
        def pick(words):
            s = []
            for w in words:
                cy = (w[1] + w[3]) / 2
                if not (y_first < cy < bottom):
                    continue
                i = cell_of((w[0] + w[2]) / 2)
                if i is not None and i >= ci["札幌"]:
                    s.append((w[4], round(w[2], 1), round(w[1], 1)))
            return sorted(s)
        lp, lq = pick(ws), pick(g["words"])
        unq = list(lq)
        miss = []
        for tt in lp:
            hit = next((u for u in unq if u[0] == tt[0] and abs(u[1] - tt[1]) <= 1.5 and abs(u[2] - tt[2]) <= 1.5), None)
            if hit is None:
                miss.append(tt)
            else:
                unq.remove(hit)
        if miss or unq:
            cross_mismatch.append((pn, len(miss), len(unq), miss[:3], unq[:3]))
        stats["crosscheck_poppler"] += len(lp)
        stats["crosscheck_pdfminer"] += len(lq)
        stats["crosscheck_matched"] += len(lp) - len(miss)
    # 頁の照合(読み飛ばした頁が無いこと)
    if footers:
        tot = footers[0][2]
        if [f[1] for f in footers] != list(range(1, len(footers) + 1)) or any(f[2] != tot for f in footers) or tot != len(footers):
            problems.append(("page_footer_sequence", [f for f in footers if f[1] is None or f[2] != tot][:5], len(footers), tot))
        first_tab = footers[0][0]
        if [p for p in nontable_pages if p > first_tab]:
            problems.append(("nontable_page_inside_tables", [p for p in nontable_pages if p > first_tab]))
        toc_unseen = sorted(set(T) - set(seen_codes))
        if toc_unseen:
            problems.append(("toc_code_without_rows", toc_unseen))
        toc_page_mismatch = [(c, TP[c], first_page_of[c] - first_tab + 1) for c in sorted(TP) if c in first_page_of and TP[c] != first_page_of[c] - first_tab + 1]
        if toc_page_mismatch:
            problems.append(("toc_page_mismatch", toc_page_mismatch[:10]))
        stats["table_pages_footer_total"] = tot
    n = write_obs(os.path.join(OBS2, OUT), out)
    rep = {"source_id": SID, "pdf_sha256": sha, "rows_written": n,
           "by_status": dict(collections.Counter(o["price_status"] for o in out)),
           "by_layer": dict(collections.Counter(o["layer"] for o in out)),
           "by_basis": dict(collections.Counter(o["price_basis"] for o in out)),
           "stats": dict(stats), "problems": len(problems), "problem_samples": [str(p)[:300] for p in problems[:40]],
           "max_value_right_to_cell_right_pt": round(max_right, 2), "max_value_center_to_header_center_pt": round(max_center, 2),
           "crosscheck_pdfminer_mismatch_pages": cross_mismatch[:20], "layout_vs_bbox_mismatch_pages": layout_mismatch[:20],
           "codes_seen": dict(seen_codes), "text_overflow": overflow[:20], "toc_codes": len(T), "codes_not_in_toc": sorted(set(seen_codes) - set(T)),
           "month": MONTH, "pages_total": len(P), "nontable_pages": nontable_pages, "toc_pages_read": len(TP)}
    print(json.dumps({k: v for k, v in rep.items() if k != "codes_seen"}, ensure_ascii=False, indent=1))
    if "--check" in sys.argv:
        json.dump(rep, open(sys.argv[sys.argv.index("--check") + 1], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    if dbg:
        with open(dbg, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["page", "code", "item", "spec", "unit", "deliver", "area", "value"])
            w.writeheader(); w.writerows(dbg_rows)
    if problems:
        sys.exit("problems: %d" % len(problems))


if __name__ == "__main__":
    main()
