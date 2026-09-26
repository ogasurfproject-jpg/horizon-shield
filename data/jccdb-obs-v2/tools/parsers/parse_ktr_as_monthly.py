# -*- coding: utf-8 -*-
"""
関東地方整備局「アスファルト合材 20XX年M月1日以降適用単価」(毎月の PDF、3 頁、4 品目 x 34 地区)を観測層 v2 に出す。
月ごとに別の source_id(ktr-zairyo-as-r8-MM)・別のファイル(observations/jp/material_ktr_zairyo_as_r8_MM.csv)。

読み方: 表の組版は 令和8年4月1日の特別調査の表(000940500.pdf)の「アスファルト合材価格」の頁(10〜12 頁)と同じなので、
parse_ktr_zairyo.py の parse_grid_page(pdftotext -bbox-layout の語の座標。列 = D+3桁 の地区コードの見出しの中心、
値は右寄せなので右端のずれを引いて最近傍、「-」は中央寄せと右寄せの近い方。6pt を超えたら止める)をそのまま当てる。
地区の市町村(area_members)は特別調査の表(raw/ktr-zairyo-r8-04.pdf)66〜68 頁の地区割一覧表の地区(3)(parse_ktr_zairyo.area_table)。
「-」: この月の PDF には記号の説明が無い。同じ表の 4月1日版(特別調査)の 2 頁の説明で「－」は「単価を設定していない地区」なので not_set。
空欄のセル(4月1日版では物価資料の単価を使う印)は、この月の PDF には無いことを確かめる(あれば止める)。
照合: 頁ごとに pdftotext -layout の値の形の語(数と「-」)の多重集合から、番号・種別№・規格・地区コードなど値でない欄の数の語を引いたものが、
bbox で値として列に割り当てた語の多重集合と一致すること(parse_ktr_zairyo と同じ照合)。
使い方: python3 parse_ktr_as_monthly.py r8_05|r8_06|r8_07|r8_08|r8_09 [--check 照合.json]
"""
import sys, os, re, json, hashlib, collections
HERE = os.path.dirname(os.path.abspath(__file__))
OBS2 = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(OBS2, "tools"))
from sekisan_layout import words_of, layout_pages
from parse_ktr_zairyo import parse_grid_page, area_table, isval, DASH
from obs_common import make_id, num, pref, write_obs

# 月 -> (原本の URL の番号, 期間, 適用開始日, 頁の見出し, sha256)
MONTHS = {
    "r8_05": ("000943667", "2026-05", "2026-05-01", "令和8年4月(令和8年5月号)", "abfe63861fb8b45f08899acbbde4f20db047a0a1fdcb4e06cc58ba8a39c47d86"),
    "r8_06": ("000946115", "2026-06", "2026-06-01", "令和8年5月(令和8年6月号)", "c4556e292db394df7256db88dc7d942083c32067b69e040dd6000b5192f0ef87"),
    "r8_07": ("000949745", "2026-07", "2026-07-01", "令和8年6月(令和8年7月号)", "3ff7a8204d5c2d646725a3188e4200edec0184c561df415c231a904ad321a42c"),
    "r8_08": ("000953486", "2026-08", "2026-08-01", "令和8年7月(令和8年8月号)", "fac567c3f1d4910d2dedc9d05ae4ad4f835e82516b2835535a9654afc929d9e4"),
    "r8_09": ("000956094", "2026-09", "2026-09-01", "令和8年8月(令和8年9月号)", "9fcab580504f8004522232a243f9346f8347721f8f1cf0d518a2b553154d2ff5"),
}
AREA_PDF = os.path.join(OBS2, "raw", "ktr-zairyo-r8-04.pdf")


def main():
    key = sys.argv[1]
    cno, period, eff, heading, sha_want = MONTHS[key]
    sid = "ktr-zairyo-as-" + key.replace("_", "-")
    pdf = os.path.join(OBS2, "raw", sid + ".pdf")
    led = json.load(open(os.path.join(OBS2, "sources", sid + ".json"), encoding="utf-8"))
    sha = hashlib.sha256(open(pdf, "rb").read()).hexdigest()
    assert sha == sha_want == led["sha256"], (sid, sha)
    area, nlab, miss = area_table(words_of(AREA_PDF))
    pages = words_of(pdf)
    lay = layout_pages(pdf)
    rows, checks, maxd = [], [], 0.0
    unmatched = []
    nat_seen = set()
    for pno in range(1, len(pages) + 1):
        P = parse_grid_page(pages[pno - 1], pno)
        assert P["title"] == heading, (pno, P["title"], heading)
        maxd = max(maxd, P["max_col_dist_pt"])
        for r in P["rows"]:
            assert r["kind"] == "アスファルト合材", r["kind"]
            spec = r["spec"] + (" [" + r["remark"] + "]" if r["remark"] else "")
            for j, col in enumerate(P["cols"]):
                t = r["cells"].get(j)
                assert t is not None, (pno, "空欄のセル", r["item"], col)
                gcode, gname = pref(col["group"])
                assert gcode, (pno, col)
                amem = area.get((3, gcode, col["name"]), "")
                if not amem:
                    unmatched.append((pno, col["code"], col["name"]))
                base = ("関東地整が毎月の調査で更新するアスファルト合材(安定処理材)の単価(掲載頁の文言「令和4年度7月より毎月調査を実施し、単価を更新しています」)。"
                        "原本の頁の見出しは「%s」。" % heading)
                if t in DASH:
                    status, price = "not_set", ""
                    note = base + ("原本で「-」。この月の PDF に記号の説明は無い。同じ表の令和8年4月1日版(特別調査、000940500.pdf 2頁)では「－」は"
                                   "取引事例が少なく単価を設定していない地区。0 円ではない。")
                else:
                    status, price = "published_pdl", num(t)
                    note = base + "原本に税の記載なし(特別調査の調査条件は「報告価格には消費税は含まないものとする。」)。"
                note += " 資材コード %s。" % r["zcode"]
                if amem:
                    note += " 地区の市町村は令和8年4月1日の特別調査の表の地区割一覧表(地区(3))による。"
                nat = (r["item"], spec, r["unit"], col["code"])
                assert nat not in nat_seen, nat
                nat_seen.add(nat)
                rows.append({"obs_id": make_id(sid, pno, r["kind"], r["shu_no"], r["no"], r["item"], spec, r["unit"], col["code"]),
                             "country": "JP", "layer": "material", "category": r["kind"], "item_name": r["item"], "spec": spec,
                             "unit": r["unit"], "geo_level": "bureau_area", "geo_code": gcode, "geo_name": gname,
                             "area_label": col["name"], "area_code": col["code"], "area_members": amem,
                             "price": price, "currency": "JPY", "price_basis": "design_unit_price_ex_tax", "price_status": status,
                             "period": period, "effective_from": eff, "source_id": sid, "source_page": pno,
                             "evidence_url": led["url"], "license": led["license"], "note": note})
        # 照合: -layout の値の形の語 - 値でない欄の数の語 = bbox の値の語
        lay_c = collections.Counter(t for ln in lay[pno - 1].split("\n") for t in ln.split() if isval(t))
        bb_c = collections.Counter(t for r in P["rows"] for t in r["cells"].values())
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
        checks.append({"page": pno, "rows": len(P["rows"]), "cols": len(P["cols"]), "layout_value_tokens": sum(rest.values()),
                       "bbox_values": sum(bb_c.values()), "multiset_equal": rest == bb_c, "max_col_dist_pt": P["max_col_dist_pt"],
                       "group_err_pt": P["group_err"]})
    out = os.path.join(OBS2, "observations", "jp", "material_ktr_zairyo_as_%s.csv" % key)
    n = write_obs(out, rows)
    rep = {"source_id": sid, "pdf_sha256": sha, "rows": n, "status": dict(collections.Counter(r["price_status"] for r in rows)),
           "areas": len(set(r["area_code"] for r in rows)), "area_members_unmatched": unmatched,
           "area_table_labels": nlab, "area_table_miss": miss, "max_col_dist_pt": maxd,
           "pages_multiset_equal": sum(1 for c in checks if c["multiset_equal"]), "pages": len(checks),
           "layout_tokens": sum(c["layout_value_tokens"] for c in checks), "bbox_values": sum(c["bbox_values"] for c in checks),
           "per_page": checks}
    print(json.dumps({k: v for k, v in rep.items() if k != "per_page"}, ensure_ascii=False))
    if "--check" in sys.argv:
        json.dump(rep, open(sys.argv[sys.argv.index("--check") + 1], "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
