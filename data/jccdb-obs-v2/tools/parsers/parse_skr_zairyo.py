# -*- coding: utf-8 -*-
"""
四国地方整備局「令和８年度 土木工事設計材料単価表［令和８年１０月］」(raw_restricted/skr-zairyo-r8-10.pdf, 107 頁) を観測層 v2 に出す。
この表は頁 2 で「本設計材料単価表の全部または一部を、第三者が複製・転載・磁気媒体入力・販売することを禁止します。」と定めるため、
値(円)は写さない(license restricted, values_copied false)。セルごとに「値が載っている(published_restricted_not_copied)/空欄(not_set)」だけを記録する。
  第1部 PDF 10〜44 頁: 主要資材単価(地区別単価)。列 = 地区(地区割表の地区番号 101〜143)
  第2部 PDF 47〜83 頁: 県別単価及び統一単価。列 = 徳島県〜高知県
  第3部 PDF 85〜107 頁: 上記外統一単価(アンカー・ボルト・標識・区画線工など、表の形が頁ごとに違う)は取り込んでいない。
地区割表-1・-2(PDF 5・6 頁)は罫線の表なので pdfplumber でセルを切り、地区番号・地区名・該当市町村・国道・河川を読む。
使い方: python3 parse_skr_zairyo.py [OBS2 のルート]
"""
import sys, os, re, json, hashlib, collections, unicodedata
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))
from mlit_zairyo_common import words_of, layout_pages, parse_table_page, layout_value_check, plumber_cell_text, BLANK_MARKS
from obs_common import make_id, pref, write_obs
import pdfplumber

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(HERE, "..", ".."))
SID = "skr-zairyo-r8-10"
PDF = os.path.join(ROOT, "raw_restricted", SID + ".pdf")
OUT = os.path.join(ROOT, "observations", "jp", "material_skr_zairyo_r8_10.csv")
DIAG = os.path.join(ROOT, "reports", "B1-kinki-chugoku-shikoku.skr_diag.json")
LED = json.load(open(os.path.join(ROOT, "sources", SID + ".json"), encoding="utf-8"))
SHA = "48df4a902b04a05589a597831db36dec8cb2b7b9f3537acac25b1b746678b790"
P1 = list(range(10, 45))
P2 = list(range(47, 84))
NOTE_R = "値は原本にあるが、表(頁 2)が第三者の複製・転載・磁気媒体入力を禁止しているため写さない。原本で見る。"
NOTE_B = "原本で空欄(値の記載なし)。四国地整の説明では、物価資料に掲載されている単価はこの表に載せていない。0 円ではない。"


def nk(name):
    """単価表の列見出し(2 行は「 / 」でつないだもの)と地区割表の地区名を突き合わせるための鍵(・と空白と / を除く)。"""
    return re.sub(r"[・\s/]", "", name)


def read_chikuwari(pl):
    out = {}
    for pn in (5, 6):
        page = pl.pages[pn - 1]
        t = max(page.find_tables(), key=lambda t: len(t.rows))
        rows = t.rows
        head = [plumber_cell_text(page, c) if c else None for c in rows[0].cells]
        assert head == ["県", "地区番号", "地区名", "該当市町村", "国道・河川"], head
        cur_pref = None
        for r in rows[1:]:
            c = [plumber_cell_text(page, b) if b else None for b in r.cells]
            if c[0]:
                cur_pref = c[0]
            out[nk(c[2])] = {"no": c[1], "name": c[2], "pref": cur_pref, "members": c[3], "roads": c[4] or "", "page": pn}
    return out


def main():
    P = words_of(PDF)
    LP = layout_pages(PDF)
    pl = pdfplumber.open(PDF)
    chiku = read_chikuwari(pl)
    rows_out, stats = [], []
    maxd_c = maxd_r = 0.0
    used = set()
    for pn in P1 + P2:
        r = parse_table_page(P[pn - 1], pn)
        d = r["diag"]
        if d.get("empty"):
            stats.append({"page": pn, "category": r["category"], "rows": 0})
            continue
        maxd_c, maxd_r = max(maxd_c, d["maxd_center"]), max(maxd_r, d["maxd_right"])
        nl, nok, bad = layout_value_check(LP[pn - 1], r["rows"])
        stats.append({"page": pn, "part": 1 if pn in P1 else 2, "category": r["category"], "rows": len(r["rows"]),
                      "rows_layout": nl, "rows_equal": nok, "mismatch": bad,
                      "values": sum(len(x["cells"]) for x in r["rows"]),
                      **{k: d[k] for k in ("maxd_center", "maxd_right", "ro", "oc", "spec_x", "orphans")}})
        cat = r["category"]
        for ci, col in enumerate(r["columns"]):
            if pn in P1:
                ch = chiku[nk(col["name"])]
                used.add(nk(col["name"]))
                g = col["group"]
                gc, gn = pref(g)
                assert pref(ch["pref"])[0] == gc, (pn, col, ch)
                geo = {"geo_level": "bureau_area", "geo_code": gc, "geo_name": gn, "area_label": "%s %s" % (g, col["name"]),
                       "area_code": ch["no"],
                       "area_members": ch["members"] + ("［国道・河川］" + ch["roads"] if ch["roads"] else "")}
                key = ("d", ch["no"])
            else:
                gc, gn = pref(col["name"])
                geo = {"geo_level": "pref", "geo_code": gc, "geo_name": gn, "area_label": col["name"], "area_code": "", "area_members": ""}
                key = ("p", col["name"])
            for ri, row in enumerate(r["rows"]):
                spec = row["spec"] + (" [" + row["note"] + "]" if row["note"] else "")
                o = {"country": "JP", "layer": "material", "category": cat, "item_name": row["item"], "spec": spec,
                     "unit": unicodedata.normalize("NFKC", row["unit"]), "currency": "JPY", "price_basis": "design_unit_price_ex_tax",
                     "period": "2026-10", "effective_from": LED.get("effective_from", ""), "source_id": SID, "source_page": str(pn),
                     "evidence_url": LED["url"], "license": LED["license"], "price": ""}
                o.update(geo)
                cell = row["cells"].get(ci)
                if cell and cell[0] not in BLANK_MARKS:
                    o.update({"price_status": "published_restricted_not_copied", "note": NOTE_R})
                else:
                    o.update({"price_status": "not_set", "note": NOTE_B})
                o["obs_id"] = make_id(SID, pn, ri, *key, cat, row["item"], row["spec"], row["unit"])
                rows_out.append(o)
    n = write_obs(OUT, rows_out)
    diag = {"pages": stats, "chikuwari": chiku, "chikuwari_not_in_price_table": sorted(set(chiku) - used),
            "max_center_distance_pt": maxd_c, "max_right_edge_distance_pt": maxd_r,
            "pdf_sha256": hashlib.sha256(open(PDF, "rb").read()).hexdigest(), "rows": n,
            "status": dict(collections.Counter(r["price_status"] for r in rows_out)),
            "check": [sum(s["rows"] for s in stats), sum(s.get("rows_layout", 0) for s in stats), sum(s.get("rows_equal", 0) for s in stats)]}
    json.dump(diag, open(DIAG, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps({k: diag[k] for k in ("rows", "status", "check", "max_center_distance_pt", "max_right_edge_distance_pt",
                                            "chikuwari_not_in_price_table")}, ensure_ascii=False), diag["pdf_sha256"] == SHA, len(chiku))


if __name__ == "__main__":
    main()
