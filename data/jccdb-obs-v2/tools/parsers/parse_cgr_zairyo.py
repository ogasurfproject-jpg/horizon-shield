# -*- coding: utf-8 -*-
"""
中国地方整備局「土木工事設計材料（公表）単価一覧表（2026年04月単価）」(raw/cgr-zairyo-r8-04.pdf, 171 頁) を観測層 v2 に出す。
  第1部 PDF 4〜45 頁  : 地区別(列 = 地区。見出しは県名の行と地区名の行)      -> mlit_zairyo_common.parse_table_page
  第2部 PDF 47〜96 頁 : 県別(列 = 鳥取県〜山口県)                         -> mlit_zairyo_common.parse_table_page
  第3部 PDF 97〜126 頁: 令和8年度(上半期) 局統一単価 中国統一資材(報告価格 2026.3 / 2025.9) -> pdfplumber の罫線で表を切る
  第4部 PDF 127〜171 頁: 令和8年度(上半期) 局統一単価 地区別資材(列 = 鳥取〜山口)            -> pdfplumber の罫線で表を切る
第3部・第4部は罫線(細い矩形)で区切られた表で、結合セル(複数行にまたがる品名・備考)があるため、pdfplumber の表検出で
セルの範囲を取り、結合セル(None)はその列で上にある、範囲がこの行まで届くセルの文字を引き継ぐ。
セル内の複数行は、各行の右端がセルの右端近くなら折り返し(空白なし)、そうでなければ空白1つでつなぐ。
別表「地区別対象市町村一覧」(PDF 2 頁)は、埋め込みフォントに ToUnicode も cmap も無く文字が取れないため、area_members は空。
使い方: python3 parse_cgr_zairyo.py [OBS2 のルート]
"""
import sys, os, re, json, hashlib, collections, unicodedata
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))
from mlit_zairyo_common import words_of, layout_pages, parse_table_page, layout_value_check, join_cell, NUM, BLANK_MARKS
from obs_common import make_id, num, pref, write_obs
import pdfplumber

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(HERE, "..", ".."))
SID = "cgr-zairyo-r8-04"
PDF = os.path.join(ROOT, "raw", SID + ".pdf")
OUT = os.path.join(ROOT, "observations", "jp", "material_cgr_zairyo_r8_04.csv")
DIAG = os.path.join(ROOT, "reports", "B1-kinki-chugoku-shikoku.cgr_diag.json")
LED = json.load(open(os.path.join(ROOT, "sources", SID + ".json"), encoding="utf-8"))
SHA = "787fca9d32a767b7f688ef029502365b692bc3672d5177c2e45c57c394bcfb7d"
P1 = list(range(4, 46))
P2 = list(range(47, 97))
P3 = list(range(100, 127))
P4 = list(range(128, 172))
PERIOD = "2026-04"
# 第5部: 別の PDF「土木工事設計材料（アスファルト合材）単価一覧表（2026年6月単価）」(raw/cgr-zairyo-as-r8-06.pdf)
SID_AS = "cgr-zairyo-as-r8-06"
PDF_AS = os.path.join(ROOT, "raw", SID_AS + ".pdf")
SHA_AS = "3230b08c5cd6098aadf29b06517f448c2e4bca06440ca99e4bf392bcc32d21d1"
LED_AS = json.load(open(os.path.join(ROOT, "sources", SID_AS + ".json"), encoding="utf-8"))
NOTE_OPEN = "中国地整等が独自調査で定めた単価(物価資料に載っている資材は空欄)。表に税の記載なし(国の積算の扱いで消費税抜き)。"
NOTE_BLANK = "原本で空欄。原本の説明では、物価資料のいずれかに掲載されている資材と、取引事例が著しく少ない資材は空欄(どちらかは区別できない)。0 円ではない。"


def layer_basis(cat, unit):
    if "市場単価" in cat:
        return "work", "work_unit_price_ex_tax"
    if "賃料" in cat or "損料" in cat:
        if "月" in unit:
            return "equipment", "equipment_rate_monthly"
        if "日" in unit:
            return "equipment", "equipment_rate_daily"
        if "時" in unit:
            return "equipment", "equipment_rate_hourly"
    return "material", "design_unit_price_ex_tax"


def base_row(cat, item, spec, unit, pn):
    layer, basis = layer_basis(cat, unit)
    return {"country": "JP", "layer": layer, "category": cat, "item_name": item, "spec": spec,
            "unit": unicodedata.normalize("NFKC", unit), "currency": "JPY", "price_basis": basis,
            "period": PERIOD, "effective_from": "", "source_id": SID, "source_page": str(pn),
            "evidence_url": LED["url"], "license": LED["license"]}


def cell_text(page, bbox):
    """セルの範囲の語を pdfplumber で取り、行ごとにつなぐ(折り返しは空白なし)。"""
    x0, top, x1, bottom = bbox
    ws = page.crop((x0 + 0.3, top + 0.3, x1 - 0.3, bottom - 0.3)).extract_words(keep_blank_chars=False, x_tolerance=1.5, y_tolerance=2)
    tup = [(w["x0"], w["top"], w["x1"], w["bottom"], w["text"]) for w in ws]
    return join_cell(tup, x1 - 2, wrap_margin=10.0)


def parse_ruled(page, pn):
    """第3部・第4部の罫線表を読む。戻り値: (見出し, データ行[{no, cells:{列: 文字}}], 表の bbox)。"""
    ts = page.find_tables()
    if not ts:
        return None
    t = max(ts, key=lambda t: len(t.rows))
    rows = t.rows
    raw = [[(cell_text(page, c) if c else None) for c in r.cells] for r in rows]
    ncol = max(len(r) for r in raw)
    # 見出し: 1 行目。2 行目の先頭が None なら副見出し(県名・幅/長さ)
    head = raw[0]
    sub = raw[1] if len(raw) > 1 and raw[1][0] is None else None
    names, base = [], []
    for j in range(ncol):
        h = head[j] if j < len(head) else None
        if h is None:  # 横に結合された見出し(溝寸法 など)
            h = base[-1] if base else ""
        base.append(h)
        s = sub[j] if sub and j < len(sub) and sub[j] else ""
        names.append((h or "").strip() + ((" " + s) if s else ""))
    data = []
    start = 2 if sub else 1
    last = {}
    for i in range(start, len(raw)):
        r = raw[i]
        cells, boxes = {}, {}
        for j in range(ncol):
            v = r[j] if j < len(r) else None
            cb = rows[i].cells[j] if j < len(rows[i].cells) else None
            if v is None and cb is None:
                # 縦に結合されたセル: 上の行のセルの範囲がこの行まで届いていれば引き継ぐ
                if j in last and last[j][1][3] >= rows[i].bbox[3] - 1.0:
                    v, cb = last[j][0], last[j][1]
                else:
                    v = ""
            else:
                last[j] = (v, cb)
            cells[j] = v
            boxes[j] = cb
        no = cells.get(0, "")
        if not re.fullmatch(r"\d{1,3}", no or ""):
            raise RuntimeError((pn, "番号が数でない行", r))
        data.append({"no": no, "cells": cells, "boxes": boxes, "top": rows[i].bbox[1]})
    return names, data, t.bbox


def poppler_check_ruled(pwords, data, value_cols):
    """別の読み方での照合: 値の列の各セルの範囲に中心が入る pdftotext -bbox の語を集め、pdfplumber のセルの文字と比べる。
    戻り値: (比べたセル数, 一致数, 食い違い, 語の中心とセルの端の最小の余白 pt)。"""
    n = ok = 0
    bad = []
    margin = 99.0
    for d in data:
        for j in value_cols:
            b = d["boxes"].get(j)
            if not b:
                continue
            x0, t, x1, btm = b
            ws = [w for w in pwords if x0 < (w[0] + w[2]) / 2 < x1 and t < (w[1] + w[3]) / 2 < btm]
            got = "".join(w[4] for w in sorted(ws, key=lambda w: (round(w[1]), w[0])))
            want = (d["cells"][j] or "").replace(" ", "")
            n += 1
            if got == want:
                ok += 1
            else:
                bad.append((d["no"], j, want, got))
            for w in ws:
                cx, cy = (w[0] + w[2]) / 2, (w[1] + w[3]) / 2
                margin = min(margin, cx - x0, x1 - cx)
    return n, ok, bad, round(margin, 2)


def main():
    P = words_of(PDF)
    LP = layout_pages(PDF)
    pl = pdfplumber.open(PDF)
    rows_out, stats = [], []
    maxd_c = maxd_r = 0.0
    # --- 第1部・第2部 ---
    for pn in P1 + P2:
        r = parse_table_page(P[pn - 1], pn)
        d = r["diag"]
        maxd_c, maxd_r = max(maxd_c, d["maxd_center"]), max(maxd_r, d["maxd_right"])
        nl, nok, bad = layout_value_check(LP[pn - 1], r["rows"])
        stats.append({"page": pn, "part": 1 if pn in P1 else 2, "category": r["category"], "rows": len(r["rows"]),
                      "rows_layout": nl, "rows_equal": nok, "mismatch": bad,
                      "values": sum(len(x["cells"]) for x in r["rows"]),
                      **{k: d[k] for k in ("maxd_center", "maxd_right", "ro", "oc", "spec_x", "orphans")}})
        cat = r["category"]
        for ci, col in enumerate(r["columns"]):
            if pn in P1:
                g = col["group"]
                gc, gn = pref(g)
                geo = {"geo_level": "bureau_area", "geo_code": gc, "geo_name": gn,
                       "area_label": "%s %s" % (g, col["name"]), "area_code": "", "area_members": ""}
                key = ("d", g, col["name"])
            else:
                gc, gn = pref(col["name"])
                geo = {"geo_level": "pref", "geo_code": gc, "geo_name": gn, "area_label": col["name"],
                       "area_code": "", "area_members": ""}
                key = ("p", col["name"])
            for ri, row in enumerate(r["rows"]):
                spec = row["spec"] + (" [" + row["note"] + "]" if row["note"] else "")
                o = base_row(cat, row["item"], spec, row["unit"], pn)
                o.update(geo)
                cell = row["cells"].get(ci)
                if cell and cell[0] not in BLANK_MARKS:
                    o.update({"price": num(cell[0]), "price_status": "published_pdl", "note": NOTE_OPEN})
                else:
                    o.update({"price": "", "price_status": "not_set", "note": NOTE_BLANK})
                o["obs_id"] = make_id(SID, pn, ri, *key, cat, row["item"], row["spec"], row["unit"])
                rows_out.append(o)
    # --- 第3部(中国統一資材)・第4部(地区別資材) ---
    for pn in P3 + P4:
        page = pl.pages[pn - 1]
        res = parse_ruled(page, pn)
        if res is None:
            continue
        names, data, tb = res
        cat = [l.strip() for l in LP[pn - 1].split("\n") if l.strip()][0]  # 頁の 1 行目(表の題)
        roles = {}
        for j, h in enumerate(names):
            hn = h.replace(" ", "")
            if hn == "番号":
                roles[j] = "no"
            elif hn == "単位":
                roles[j] = "unit"
            elif "(2026.3)" in hn:
                roles[j] = "price"
            elif "(2025.9)" in hn:
                roles[j] = "ref"
            elif hn == "変動率":
                roles[j] = "rate"
            elif hn == "備考":
                roles[j] = "note"
            elif hn.startswith("価格（円）"):
                roles[j] = "pref:" + hn.replace("価格（円）", "")
            elif hn in ("品名", "種類") and "item" not in roles.values():
                roles[j] = "item"
            else:
                roles[j] = "desc"
        assert "unit" in roles.values() and "item" in roles.values(), (pn, names)
        value_cols = [j for j, ro in roles.items() if ro in ("price", "ref") or ro.startswith("pref:")]
        ncell, nok, bad, mg = poppler_check_ruled(P[pn - 1]["words"], data, value_cols)
        stats.append({"page": pn, "part": 3 if pn in P3 else 4, "category": cat, "rows": len(data), "cells_checked": ncell,
                      "cells_equal": nok, "rows_equal": len(data) if nok == ncell else 0, "mismatch": bad,
                      "min_margin_pt": mg, "columns": names})
        descs = [j for j, ro in roles.items() if ro == "desc"]
        prev_item = None
        for ri, dr in enumerate(data):
            c = dr["cells"]
            item = c[[j for j, ro in roles.items() if ro == "item"][0]]
            unit = c[[j for j, ro in roles.items() if ro == "unit"][0]]
            parts = []
            for j in descs:
                if c[j]:
                    hn = names[j].replace(" ", "")
                    parts.append(c[j] if hn in ("規格",) or len(descs) == 1 else "%s:%s" % (hn, c[j]))
            spec = " ".join(parts)
            note_txt = " ".join(c[j] for j, ro in roles.items() if ro == "note" and c[j])
            spec_full = spec + (" [" + note_txt + "]" if note_txt else "")
            doujou = ""
            if item.startswith("同上"):
                doujou = "品名の「同上」は直前の行(番号 %s)の品名「%s」を指す。" % (prev_item[0], prev_item[1]) if prev_item else ""
            else:
                prev_item = (dr["no"], item)
            if pn in P3:
                pj = [j for j, ro in roles.items() if ro == "price"][0]
                rj = [j for j, ro in roles.items() if ro == "ref"]
                o = base_row(cat, item, spec_full, unit, pn)
                o.update({"geo_level": "bureau_area", "geo_code": "", "geo_name": "", "area_label": "中国統一",
                          "area_code": "", "area_members": ""})
                v = c[pj]
                refv = c[rj[0]] if rj else ""
                sec = "令和8年度(上半期) 局統一単価 中国統一資材。値は報告価格(2026.3)。"
                if v and v not in BLANK_MARKS and float(num(v)) > 0:
                    o.update({"price": num(v), "price_status": "published_pdl", "note": sec + doujou + "表に税の記載なし(国の積算の扱いで消費税抜き)。"})
                    if refv and refv not in BLANK_MARKS and float(num(refv)) > 0:
                        o.update({"ref_value": num(refv), "ref_note": "前回の報告価格(2025.9)"})
                else:
                    o.update({"price": "", "price_status": "not_set",
                              "note": sec + doujou + ("原本の値は 0" + ("(備考: %s)" % note_txt if note_txt else "") + "。" if v and v not in BLANK_MARKS else "原本で空欄。") + "0 円ではなく、設定していないものとして扱う。"})
                o["obs_id"] = make_id(SID, pn, ri, "u", cat, dr["no"], item, spec, unit)
                o["_no"] = dr["no"]
                rows_out.append(o)
            else:
                for j in value_cols:
                    pnm = roles[j].split(":", 1)[1]
                    gc, gn = pref(pnm)
                    o = base_row(cat, item, spec_full, unit, pn)
                    o.update({"geo_level": "pref", "geo_code": gc, "geo_name": gn, "area_label": pnm,
                              "area_code": "", "area_members": ""})
                    v = c[j]
                    sec = "令和8年度(上半期) 局統一単価 地区別資材。"
                    if v and v not in BLANK_MARKS:
                        o.update({"price": num(v), "price_status": "published_pdl", "note": sec + doujou + "表に税の記載なし(国の積算の扱いで消費税抜き)。"})
                    else:
                        o.update({"price": "", "price_status": "not_set",
                                  "note": sec + doujou + "原本で「－」(または空欄)。この県では設定していない。0 円ではない。"})
                    o["obs_id"] = make_id(SID, pn, ri, "r", pnm, cat, dr["no"], item, spec, unit)
                    o["_no"] = dr["no"]
                    rows_out.append(o)
    # --- 第5部: アスファルト合材 2026年6月単価(別の PDF、1 頁 = 1 県、列 = 地区) ---
    area_pref = {}
    for o in rows_out:
        if o["source_page"] in [str(x) for x in P1] and o["geo_level"] == "bureau_area":
            g, a = o["area_label"].split(" ", 1)
            area_pref[unicodedata.normalize("NFKC", a)] = g
    PA = words_of(PDF_AS)
    pla = pdfplumber.open(PDF_AS)
    as_stats = []
    for pn in range(1, len(pla.pages) + 1):
        page = pla.pages[pn - 1]
        ts = page.find_tables()
        if not ts:
            continue
        t = max(ts, key=lambda t: len(t.rows))
        rows = t.rows
        texts = [[(cell_text(page, c) if c else None) for c in r.cells] for r in rows]
        hi = [i for i, r in enumerate(texts) if r and r[0] and r[0].replace(" ", "") == "名称"]
        if not hi:
            continue
        hi = hi[0]
        title = texts[0][0].split(" ")[0] if hi > 0 and texts[0][0] else ""
        head = texts[hi]
        assert [h.replace(" ", "") for h in head[:3]] == ["名称", "規格", "単位"], (pn, head)
        areas = head[3:]
        data = []
        for i in range(hi + 1, len(texts)):
            r = texts[i]
            if not r[0]:
                continue
            data.append({"no": str(i), "cells": {j: (r[j] or "") for j in range(len(r))},
                         "boxes": {j: rows[i].cells[j] for j in range(len(r))}})
        vcols = list(range(3, len(head)))
        ncell, nok, bad, mg = poppler_check_ruled(PA[pn - 1]["words"], data, vcols)
        as_stats.append({"page": pn, "title": title, "areas": areas, "rows": len(data), "cells_checked": ncell,
                         "cells_equal": nok, "mismatch": bad, "min_margin_pt": mg})
        for ri, dr in enumerate(data):
            c = dr["cells"]
            item, spec, unit = c[0], c[1], c[2]
            for j in vcols:
                a = areas[j - 3]
                g = area_pref.get(unicodedata.normalize("NFKC", a))  # 第1部は全角括弧、第5部は半角括弧
                assert g, ("第1部に無い地区", pn, a)
                gc, gn = pref(g)
                o = {"country": "JP", "layer": "material", "category": title, "item_name": item, "spec": spec,
                     "unit": unicodedata.normalize("NFKC", unit), "currency": "JPY", "price_basis": "design_unit_price_ex_tax",
                     "period": "2026-06", "effective_from": "", "source_id": SID_AS, "source_page": str(pn),
                     "evidence_url": LED_AS["url"], "license": LED_AS["license"],
                     "geo_level": "bureau_area", "geo_code": gc, "geo_name": gn, "area_label": "%s %s" % (g, a),
                     "area_code": "", "area_members": ""}
                v = c[j]
                b = dr["boxes"][j]
                red = any(ch.get("non_stroking_color") == (1.0, 0.0, 0.0) for ch in page.crop(b).chars if ch["text"].strip()) if b else False
                if v and v not in BLANK_MARKS:
                    o.update({"price": num(v), "price_status": "published_pdl",
                              "note": "アスファルト合材の2026年6月の新単価(急激な物価変動を踏まえた臨時の設定)。" + ("原本で赤字(5月28日公表の一覧表からの訂正)。" if red else "") + "表に税の記載なし(国の積算の扱いで消費税抜き)。県は第1部(2026年04月単価)の同じ地区名の県。"})
                else:
                    o.update({"price": "", "price_status": "not_set", "note": NOTE_BLANK})
                o["obs_id"] = make_id(SID_AS, pn, ri, a, item, spec, unit)
                rows_out.append(o)
    # 同じ観測(出典・品目・規格・単位・地域・時点)が2行になるもの: 表の番号を規格の後ろに付けて分ける(原本の重複らしきものも残す)
    KEY = ("source_id", "layer", "item_name", "spec", "unit", "geo_level", "geo_code", "area_label", "area_code", "period", "price_basis")
    grp = collections.defaultdict(list)
    for o in rows_out:
        grp[tuple(o.get(k, "") for k in KEY)].append(o)
    dup_groups = []
    for k, os_ in grp.items():
        if len(os_) > 1:
            dup_groups.append([(o["source_page"], o.get("_no"), o["area_label"], o.get("price", "")) for o in os_])
            for o in os_:
                assert o.get("_no"), ("第1部・第2部で重複", k)
                o["spec"] = o["spec"] + " [表の番号 %s]" % o["_no"]
    for o in rows_out:
        o.pop("_no", None)
    n = write_obs(OUT, rows_out)
    diag = {"pages": stats, "max_center_distance_pt": maxd_c, "max_right_edge_distance_pt": maxd_r,
            "pdf_sha256": hashlib.sha256(open(PDF, "rb").read()).hexdigest(), "rows": n,
            "status": dict(collections.Counter(r["price_status"] for r in rows_out)),
            "layer": dict(collections.Counter(r["layer"] for r in rows_out))}
    diag["check"] = {"part12_rows": sum(s["rows"] for s in stats if s["part"] in (1, 2)),
                     "part12_layout_rows": sum(s.get("rows_layout", 0) for s in stats if s["part"] in (1, 2)),
                     "part12_equal": sum(s["rows_equal"] for s in stats if s["part"] in (1, 2)),
                     "part34_rows": sum(s["rows"] for s in stats if s["part"] in (3, 4)),
                     "part34_cells_checked": sum(s["cells_checked"] for s in stats if s["part"] in (3, 4)),
                     "part34_cells_equal": sum(s["cells_equal"] for s in stats if s["part"] in (3, 4)),
                     "part34_min_margin_pt": min(s["min_margin_pt"] for s in stats if s["part"] in (3, 4))}
    diag["natural_key_dups_split_by_table_no"] = dup_groups
    diag["as_2606"] = {"pages": as_stats, "pdf_sha256": hashlib.sha256(open(PDF_AS, "rb").read()).hexdigest(),
                       "rows": sum(1 for o in rows_out if o["source_id"] == SID_AS),
                       "cells_checked": sum(x["cells_checked"] for x in as_stats), "cells_equal": sum(x["cells_equal"] for x in as_stats)}
    json.dump(diag, open(DIAG, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps({k: diag[k] for k in ("rows", "status", "layer", "check", "max_center_distance_pt", "max_right_edge_distance_pt")},
                     ensure_ascii=False), diag["pdf_sha256"] == SHA)
    print(json.dumps({k: v for k, v in diag["as_2606"].items() if k != "pages"}, ensure_ascii=False), diag["as_2606"]["pdf_sha256"] == SHA_AS)


if __name__ == "__main__":
    main()
