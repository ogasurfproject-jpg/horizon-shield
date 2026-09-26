# -*- coding: utf-8 -*-
"""
近畿地方整備局「令和8年度 土木工事設計材料単価表(令和8年9月)」(raw/kkr-zairyo-r8-09.pdf) の、生コンクリート以外の全資材を観測層 v2 に出す。
  - 地区別の頁(骨材・アスファルト合材・生モルタル): PDF 37〜63 頁。列 = 地区(別表-2 の地区番号)。
  - 府県別の頁(鋼材〜機械賃料): PDF 65〜142 頁。列 = 府県(別表-1 の府県番号 01〜12)。
  - 生コンクリートの頁(PDF 10〜36 頁)は observations/jp/material_kkr_namacon_r8_09.csv にあるので除く。
  - 別表-1(PDF 3 頁)と別表-2(PDF 4〜7 頁)から、地区コード・府県番号と、含まれる市町村の文言を読む。
値は座標で読む(mlit_zairyo_common.parse_table_page)。空欄は「単価を設定していない」(原本 2 頁の説明)として not_set。
使い方: python3 parse_kkr_zairyo.py [OBS2 のルート] [--month r8_09|r8_10] [--out 出力.csv] [--diag 診断.json]
  --month を省くと r8_09(B1 が作った 9月の表)。月ごとに別の source_id・別のファイル(古い月の行は消さない)。
  頁の範囲は原本の表紙(「土木工事設計材料（公表）単価一覧表」の頁)と各頁の種別から決める。r8_09 では B1 の固定の範囲と同じになることを確かめる。
  --out / --diag を渡すと、そこに書く(古い月に当て直して md5 を比べるときに、既存のファイルを書き換えないため)。
"""
import sys, os, re, json, hashlib, collections, unicodedata, statistics
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))
from mlit_zairyo_common import words_of, layout_pages, lines_of, parse_table_page, fix_radicals, PageError, layout_value_check
from obs_common import make_id, num, pref, write_obs


def _opt(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


_pos = [a for i, a in enumerate(sys.argv[1:], 1) if not a.startswith("--") and not sys.argv[i - 1].startswith("--")]
ROOT = _pos[0] if _pos else os.path.abspath(os.path.join(HERE, "..", ".."))
MONTHS = {
    # 9月: B1 の取り込み。頁の範囲は B1 の固定値(自動で決めた範囲と一致することを main で確かめる)
    "r8_09": {"sid": "kkr-zairyo-r8-09", "period": "2026-09",
              "sha": "07691505e9319935539a58bb33ed74ca2e3d749b12753eb87c83333690e22886",
              "diag": os.path.join("reports", "B1-kinki-chugoku-shikoku.kkr_diag.json"),
              "pages": (list(range(10, 37)), list(range(37, 64)), list(range(65, 143)))},
    # 10月: J2-latest-editions の取り込み(2026_10tanka.pdf)
    "r8_10": {"sid": "kkr-zairyo-r8-10", "period": "2026-10",
              "sha": "82538ace3f1f9da28e4acdbf0dc1e875d46da91afbb12da23e652e5ac75701bd",
              "diag": os.path.join("reports", "J2-latest-editions.kkr_r8_10_diag.json"),
              "pages": None},
}
MONTH = _opt("--month", "r8_09")
M = MONTHS[MONTH]
SID = M["sid"]
PERIOD = M["period"]
PDF = os.path.join(ROOT, "raw", SID + ".pdf")
OUT = _opt("--out", os.path.join(ROOT, "observations", "jp", "material_kkr_zairyo_%s.csv" % MONTH))
DIAG = _opt("--diag", os.path.join(ROOT, M["diag"]))
LED = json.load(open(os.path.join(ROOT, "sources", SID + ".json"), encoding="utf-8"))
SHA = M["sha"]


def find_pages(P, LP):
    """表紙(「土木工事設計材料（公表）単価一覧表」)の 2 頁の間が地区別の部、2 つめの表紙の後ろが府県別の部。
    地区別の部のうち種別が生コンクリートの頁は生コン(material_kkr_namacon_*.csv 側)。"""
    covers = [i + 1 for i, t in enumerate(LP) if "土木工事設計材料（公表）単価一覧表" in t.replace(" ", "")]
    assert len(covers) == 2, ("表紙の頁が 2 つでない", covers)
    namacon, district, prefp = [], [], []
    for pn in range(covers[0] + 1, covers[1]):
        r = parse_table_page(P[pn - 1], pn)
        assert r is not None, ("地区別の部に表でない頁", pn)
        (namacon if r["category"] == "生コンクリート" else district).append(pn)
    for pn in range(covers[1] + 1, len(P) + 1):
        r = parse_table_page(P[pn - 1], pn)
        assert r is not None, ("府県別の部に表でない頁", pn)
        prefp.append(pn)
    return namacon, district, prefp

GROUP_PREF = {"福井": "18", "滋賀": "25", "京都北部": "26", "京都南部": "26", "大阪": "27", "兵庫北部": "28",
              "兵庫西部": "28", "兵庫": "28", "奈良": "29", "和歌山": "30", "岐阜": "21", "三重": "24"}


def partition(items, anchors):
    """items(y 昇順)を anchors(y 昇順)に連続したかたまりで割り当てる。かたまりの上下端の中点と anchor の差の和を最小にする。"""
    n, k = len(items), len(anchors)
    INF = float("inf")
    best = [[INF] * (n + 1) for _ in range(k + 1)]
    back = [[0] * (n + 1) for _ in range(k + 1)]
    best[0][0] = 0.0
    for a in range(1, k + 1):
        for e in range(1, n + 1):
            for s in range(a - 1, e):
                if best[a - 1][s] == INF:
                    continue
                c = best[a - 1][s] + abs((items[s] + items[e - 1]) / 2 - anchors[a - 1])
                if c < best[a][e]:
                    best[a][e], back[a][e] = c, s
    out, e = [], n
    for a in range(k, 0, -1):
        s = back[a][e]
        out.append((s, e))
        e = s
    return list(reversed(out)), best[k][n]


def read_beppyo1(page):
    """別表-1: 府県名・府県番号・地区別番号。"""
    ws = [(a, b, c, d, fix_radicals(t)) for a, b, c, d, t in page["words"]]
    anchors = sorted([w for w in ws if re.fullmatch(r"\d\d", w[4]) and 160 < w[0] < 170], key=lambda w: w[1])
    dlines = sorted([w for w in ws if 195 < w[0] < 200 and re.match(r"^\d", w[4])], key=lambda w: w[1])
    parts, cost = partition([w[1] for w in dlines], [w[1] for w in anchors])
    res = []
    for (s, e), a in zip(parts, anchors):
        names = [w for w in ws if w[0] < 150 and abs(w[1] - a[1]) < 20 and not re.match(r"^\d", w[4])]
        nm = [w for w in names if abs(w[1] - a[1]) < 10]
        # 府県名は府県番号と同じ高さ(兵庫(北・西除く)は 2 行)
        name = " ".join(w[4] for w in sorted(names, key=lambda w: w[1]) if abs(w[1] - a[1]) < 10)
        nums_txt = [w[4] for w in dlines[s:e]]
        nums = [int(x) for t in nums_txt for x in re.findall(r"\d+", t)]
        res.append({"code": a[4], "name": name, "district_text": " ".join(nums_txt), "districts": nums, "y": a[1]})
    return res, cost


def read_beppyo2(pages):
    """別表-2: 地区番号と地区名(含まれる市町村)。"""
    out = {}
    pref_of = {}
    for pg in pages:
        ws = [(a, b, c, d, fix_radicals(t)) for a, b, c, d, t in pg["words"]]
        ws = [w for w in ws if not w[4].startswith("※") and not w[4].startswith("】括弧")]
        hdr = [w for w in ws if w[4] == "地区名"]
        if hdr:  # 別表-2 の最初の頁は見出し(別表−2 / 地区区分 / 府県・番号・地区名)を除く
            ws = [w for w in ws if w[1] > hdr[0][1] + 12]
        L = lines_of(ws)
        labels = []
        for y, l in L:
            lab = [w for w in l if 75 < w[0] < 225]
            if not lab:
                continue
            if 78 < lab[0][0] < 92 and re.match(r"^【?\d+", lab[0][4]):
                labels.append([y, lab])
            elif labels and lab[0][0] >= 100:
                labels[-1].append((y, lab))
        blocks = []
        for lb in labels:
            ys = [lb[0]] + [t[0] for t in lb[2:]]
            ws_l = lb[1] + [w for t in lb[2:] for w in t[1]]
            # 番号欄の折り返し: 次の行が「他）」で始まるときだけ空白1つ、それ以外は空白なしでつなぐ
            segs = [" ".join(w[4] for w in grp) for grp in [lb[1]] + [t[1] for t in lb[2:]]]
            txt = segs[0]
            for sg in segs[1:]:
                txt += (" " if sg.startswith("他") else "") + sg
            m = re.match(r"^【?(\d+)】?", txt)
            blocks.append({"no": int(m.group(1)), "label": txt, "bracket": txt.startswith("【"), "ymid": (min(ys) + max(ys)) / 2})
        mlines = [(y, [w for w in l if w[0] >= 225]) for y, l in L]
        mlines = [(y, l) for y, l in mlines if l and y < pg["h"] - 40]
        parts, cost = partition([y for y, _ in mlines], [b["ymid"] for b in blocks])
        # 縦書きの府県名(x≈60 の 1 字ずつ)
        vch = sorted([w for w in ws if 55 < w[0] < 75 and len(w[4]) == 1], key=lambda w: w[1])
        vgroups = []
        for w in vch:
            if vgroups and w[1] - vgroups[-1][-1][1] < 26 and not vgroups[-1][-1][4] in ("県", "府"):
                vgroups[-1].append(w)
            else:
                vgroups.append([w])
        vp = [("".join(w[4] for w in g), (g[0][1] + g[-1][1]) / 2) for g in vgroups if g[-1][4] in ("県", "府")]
        for (s, e), b in zip(parts, blocks):
            members = "".join(" ".join(w[4] for w in l) for y, l in mlines[s:e])
            b["members"] = members
            b["partition_cost"] = cost
            # 府県: 縦書きの府県名のうち、この地区ブロックを含む範囲に最も近いもの
            out[b["no"]] = b
        if vp:
            vparts, _ = partition([b["ymid"] for b in blocks], [y for _, y in vp]) if len(blocks) >= len(vp) else (None, None)
            if vparts:
                for (s, e), (nm, _) in zip(vparts, vp):
                    for b in blocks[s:e]:
                        pref_of[b["no"]] = nm
    return out, pref_of


def main():
    P = words_of(PDF)
    LP = layout_pages(PDF)
    found = find_pages(P, LP)
    if M["pages"] is not None:
        assert tuple(found) == M["pages"], ("自動で決めた頁の範囲が固定値と違う", found)
    NAMACON_PAGES, DISTRICT_PAGES, PREF_PAGES = found
    b1, b1cost = read_beppyo1(P[2])
    b2, b2pref = read_beppyo2([P[3], P[4], P[5], P[6]])
    # 別表-2 の地区の府県が縦書きで取れなかったもの(ページまたぎ)は、前後の地区から埋める
    nos = sorted(b2)
    for i, no in enumerate(nos):
        if no not in b2pref:
            prev = [b2pref[x] for x in nos[:i] if x in b2pref]
            b2pref[no] = prev[-1] if prev else None
    code_of_group = {}
    for r in b1:
        code_of_group[r["name"].split()[0]] = r
    diag = {"beppyo1": b1, "beppyo1_partition_cost": b1cost,
            "beppyo2": {str(k): v for k, v in sorted(b2.items())}, "beppyo2_pref": {str(k): v for k, v in sorted(b2pref.items())}}
    # 別表-1 と 別表-2 の地区番号の一致
    all1 = sorted(x for r in b1 for x in r["districts"])
    diag["districts_beppyo1_eq_beppyo2"] = all1 == sorted(b2)

    rows_out = []
    page_stats = []
    maxd_c = maxd_r = 0.0
    # --- 地区別の頁 ---
    dist_order = sorted(b2)  # 別表-2 の地区番号の並び = 単価表の列の並び
    cycle = {}
    for pn in DISTRICT_PAGES:
        r = parse_table_page(P[pn - 1], pn)
        d = r["diag"]
        maxd_c, maxd_r = max(maxd_c, d["maxd_center"]), max(maxd_r, d["maxd_right"])
        cat = r["category"]
        if cat not in cycle:
            cycle[cat] = []
        start = sum(len(x) for x in cycle[cat])
        cols = r["columns"]
        cycle[cat].append(cols)
        nl, nok, bad = layout_value_check(LP[pn - 1], r["rows"])
        page_stats.append({"page": pn, "category": cat, "format": "district", "rows_bbox": len(r["rows"]),
                           "rows_layout": nl, "rows_values_equal": nok, "mismatch": bad,
                           "values": sum(len(x["cells"]) for x in r["rows"]),
                           **{k: d[k] for k in ("maxd_center", "maxd_right", "ro", "oc", "spec_x", "orphans")}})
        for ci, col in enumerate(cols):
            no = dist_order[start + ci]
            b = b2[no]
            g = col["group"]
            gp = GROUP_PREF[g]
            pp, pn_name = pref(b2pref.get(no) or "")
            col["no"] = no
            col["pref_check"] = (pp == gp)
            for ri, row in enumerate(r["rows"]):
                spec = row["spec"] + (" [" + row["note"] + "]" if row["note"] else "")
                cell = row["cells"].get(ci)
                base = {
                    "country": "JP", "layer": "material", "category": cat, "item_name": row["item"], "spec": spec,
                    "unit": unicodedata.normalize("NFKC", row["unit"]),
                    "geo_level": "bureau_area", "geo_code": gp, "geo_name": pref(gp)[1],
                    "area_label": "%s %s" % (g, col["name"]), "area_code": str(no), "area_members": b["members"],
                    "currency": "JPY", "price_basis": "design_unit_price_ex_tax",
                    "period": PERIOD, "effective_from": LED.get("effective_from", ""), "source_id": SID,
                    "source_page": str(pn), "evidence_url": LED["url"], "license": LED["license"],
                }
                extra = "別表-2 で【】書きの地区(局設定単価の登録(調査)対象としない)。" if b["bracket"] else ""
                if cell:
                    base.update({"price": num(cell[0]), "price_status": "published_pdl",
                                 "note": "近畿地整が独自調査で設定した単価(物価資料に載っていない材料・地区だけ)。表に税の記載なし(国の積算の扱いで消費税抜き)。" + extra})
                else:
                    base.update({"price": "", "price_status": "not_set",
                                 "note": "原本で空欄。原本の説明では、取り引き事例が著しく少ない材料は単価を設定していない地区があり空欄。0 円ではない。" + extra})
                base["obs_id"] = make_id(SID, pn, ri, "d", no, cat, row["item"], row["spec"], row["unit"])
                rows_out.append(base)
    # 地区の列が 1 巡で別表-2 の地区と同じ数か
    diag["district_cycles"] = {c: [len(x) for x in v] for c, v in cycle.items()}
    diag["district_columns"] = {c: [(col["no"], col["group"], col["name"], col["pref_check"]) for x in v for col in x] for c, v in cycle.items()}
    # --- 府県別の頁 ---
    for pn in PREF_PAGES:
        r = parse_table_page(P[pn - 1], pn)
        d = r["diag"]
        maxd_c, maxd_r = max(maxd_c, d["maxd_center"]), max(maxd_r, d["maxd_right"])
        cat = r["category"]
        cols = r["columns"]
        nl, nok, bad = layout_value_check(LP[pn - 1], r["rows"])
        page_stats.append({"page": pn, "category": cat, "format": "pref", "rows_bbox": len(r["rows"]),
                           "rows_layout": nl, "rows_values_equal": nok, "mismatch": bad,
                           "values": sum(len(x["cells"]) for x in r["rows"]),
                           **{k: d[k] for k in ("maxd_center", "maxd_right", "ro", "oc", "spec_x", "orphans")}})
        for ci, col in enumerate(cols):
            b1r = code_of_group[col["name"]]
            gp = GROUP_PREF[col["name"]]
            dists = b1r["districts"]
            mem = "別表-1 の地区別番号 %s。" % b1r["district_text"] + "｜".join(
                "%s %s" % (b2[x]["label"], b2[x]["members"]) for x in dists)
            multi = sorted(set(pref(b2pref.get(x) or "")[0] for x in dists))
            for ri, row in enumerate(r["rows"]):
                spec = row["spec"] + (" [" + row["note"] + "]" if row["note"] else "")
                cell = row["cells"].get(ci)
                layer = "equipment" if cat == "機械賃料" else "material"
                basis = "equipment_rate_monthly" if cat == "機械賃料" else "design_unit_price_ex_tax"
                base = {
                    "country": "JP", "layer": layer, "category": cat, "item_name": row["item"], "spec": spec,
                    "unit": unicodedata.normalize("NFKC", row["unit"]),
                    "geo_level": "bureau_area", "geo_code": gp, "geo_name": pref(gp)[1],
                    "area_label": col["name"], "area_code": b1r["code"], "area_members": mem,
                    "currency": "JPY", "price_basis": basis,
                    "period": PERIOD, "effective_from": LED.get("effective_from", ""), "source_id": SID,
                    "source_page": str(pn), "evidence_url": LED["url"], "license": LED["license"],
                }
                extra = ""
                if len(multi) > 1:
                    extra = "この列(府県番号 %s)は別表-1 で %s の地区も含む(geo_code は列の府県)。" % (
                        b1r["code"], "・".join(pref(c)[1] for c in multi if c != gp))
                if cell:
                    base.update({"price": num(cell[0]), "price_status": "published_pdl",
                                 "note": "近畿地整が独自調査で設定した単価(物価資料に載っていない材料だけ)。表に税の記載なし(国の積算の扱いで消費税抜き)。" + extra})
                else:
                    base.update({"price": "", "price_status": "not_set",
                                 "note": "原本で空欄。原本の説明では、取り引き事例が著しく少ない材料は単価を設定していない地区があり空欄。0 円ではない。" + extra})
                base["obs_id"] = make_id(SID, pn, ri, "p", b1r["code"], cat, row["item"], row["spec"], row["unit"])
                rows_out.append(base)
    n = write_obs(OUT, rows_out)
    diag["pages"] = page_stats
    diag["max_center_distance_pt"] = maxd_c
    diag["max_right_edge_distance_pt"] = maxd_r
    diag["pdf_sha256"] = hashlib.sha256(open(PDF, "rb").read()).hexdigest()
    diag["rows"] = n
    diag["status"] = dict(collections.Counter(r["price_status"] for r in rows_out))
    diag["excluded_pages_namacon"] = NAMACON_PAGES
    json.dump(diag, open(DIAG, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    diag["check_rows"] = [sum(p["rows_bbox"] for p in page_stats), sum(p["rows_layout"] for p in page_stats), sum(p["rows_values_equal"] for p in page_stats)]
    print(json.dumps({"rows": n, "status": diag["status"], "check_rows_bbox_layout_equal": diag["check_rows"], "max_center": maxd_c, "max_right": maxd_r,
                      "sha_ok": diag["pdf_sha256"] == SHA, "b1_eq_b2": diag["districts_beppyo1_eq_beppyo2"],
                      "cycles": diag["district_cycles"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
