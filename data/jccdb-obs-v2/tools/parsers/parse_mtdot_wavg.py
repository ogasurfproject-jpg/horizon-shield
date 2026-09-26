# -*- coding: utf-8 -*-
"""
Montana DOT「Weighted Average Prices Catalog, JANUARY 01, 2025 - DECEMBER 31, 2025」(Average_prices/2025.pdf, 17 頁)
を pdftotext -bbox-layout の語の座標で読み、観測層 v2 の bid_item 行にする。

入力: OBS2/raw/mtdot-wavg-2025.pdf
出力: OBS2/observations/us/bid_item_mtdot_2025.csv
  1 品目 = 1 行。price = Average Unit Price*(脚注「The weighted average unit price is the total bid amount divided by
  the total quantity」)-> bid_weighted_avg。ref_value = Total Quantity。spec = Item Number、note に Spec Book。
照合:
  (a) bbox で読んだ品目数 と pdftotext -layout の行頭 9 桁品目番号の数・集合
  (b) 同じ行を pdftotext -layout の正規表現で別に読み、全品目で 説明・単位・数量・単価 が一致するか
  (c) 列の割り当て(u3_pdfwords.ColumnCheck)
"""
import os, re, sys, json, subprocess
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from obs_common import make_id, num, write_obs, US_STATES
from u3_pdfwords import words_of, lines_of, sha256_file, ColumnCheck

SID = "mtdot-wavg-2025"
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
PDF = os.path.join(ROOT, "raw", SID + ".pdf")
OUT = os.path.join(ROOT, "observations", "us", "bid_item_mtdot_2025.csv")
URL = "https://mdt.mt.gov/other/webdata/external/contractplans/contract/Archives/Average_prices/2025.pdf"
FIPS = "30"
ITEM_RE = re.compile(r"^\d{9}$")
NUMTOK = re.compile(r"^\$?-?[\d,]*\d(\.\d+)?$")


def main():
    sha = sha256_file(PDF)
    pages = words_of(PDF)
    check = ColumnCheck()
    items = []
    for pno, ws in enumerate(pages, 1):
        lines = lines_of(ws)
        hdr = [l for l in lines if any(w[4] == "Price*" for w in l[1])]
        assert hdr, pno
        hy, hw = hdr[0]
        a_qty = [w for w in hw if w[4] == "Quantity"][0]
        a_prc = [w for w in hw if w[4] == "Price*"][0]
        a_unit = [w for w in hw if w[4] == "Unit"][0]  # 'Unit of Measure' の Unit(左の方)
        a_book = [w for w in hw if w[4] == "Book"][0]
        anchors = {"qty": a_qty[2], "price": a_prc[2]}
        centers = {"qty": (a_qty[0] + a_qty[2]) / 2, "price": (a_prc[0] + a_prc[2]) / 2}
        foot_y = min(y for y, l in lines if l[0][4] == "*")
        for y, l in lines:
            if y <= hy or y >= foot_y:
                continue
            assert ITEM_RE.match(l[0][4]) and l[0][0] < 70, (pno, y, [w[4] for w in l])
            book = [w for w in l if a_book[0] - 50 <= w[0] < 150 and w is not l[0]]
            desc = [w for w in l if 150 <= w[0] < a_unit[0] - 3]
            unit = [w for w in l if a_unit[0] - 3 <= w[0] < a_qty[0] - 5]
            nums = [w for w in l if w[0] >= a_qty[0] - 5]
            assert len(book) == 1 and desc and len(unit) == 1 and len(nums) == 2 and all(NUMTOK.match(w[4]) for w in nums), \
                (pno, y, [w[4] for w in l])
            for k, w in zip(("qty", "price"), nums):
                check.add(pno, k, w[2], anchors[k], (w[0] + w[2]) / 2, centers[k], anchors)
            items.append({"page": pno, "item": l[0][4], "book": book[0][4], "desc": " ".join(w[4] for w in desc),
                          "unit": unit[0][4], "qty": nums[0][4], "price": nums[1][4]})
    rows = []
    for it in items:
        note = ["Spec Book %s" % it["book"], "Average Unit Price*(脚注: total bid amount divided by the total quantity)"]
        if it["unit"] == "LS":
            note.append("LS は一式あたりの平均で単価として比べない")
        r = {"country": "US", "layer": "bid_item", "geo_level": "state", "geo_code": FIPS, "geo_name": US_STATES[FIPS],
             "currency": "USD", "source_id": SID, "evidence_url": URL, "license": "OPEN-TERMS",
             "category": "Weighted Average Prices Catalog (AASHTOPRECON002)", "item_name": it["desc"], "spec": it["item"],
             "unit": it["unit"], "price_basis": "bid_weighted_avg", "period": "2025", "source_page": str(it["page"]),
             "ref_value": num(it["qty"]), "ref_note": "Total Quantity (2025-01-01 to 2025-12-31)"}
        p = num(it["price"].replace("$", ""))
        if float(p) <= 0:
            r["price_status"] = "not_set"
            note.insert(0, "原本の値は %s(0 は not_set で表す)" % it["price"])
        else:
            r.update({"price": p, "price_status": "published_open_terms"})
        r["note"] = "。".join(note)
        r["obs_id"] = make_id(SID, it["item"], it["book"], "2025", "bid_weighted_avg")
        rows.append(r)
    n = write_obs(OUT, rows)
    # 照合 (a)(b): layout の正規表現で別に読む
    lay = subprocess.run(["pdftotext", "-layout", PDF, "-"], capture_output=True, text=True, check=True).stdout
    pat = re.compile(r"^(\d{9})\s+(\d+)\s+(.+?)\s+(\S+)\s+([\d,.]+)\s+(\$[\d,.]+)\s*$", re.M)
    lay_rows = {m.group(1): m.groups() for m in pat.finditer(lay)}
    lay_ids = re.findall(r"^(\d{9})\s", lay, flags=re.M)
    diff = []
    for it in items:
        g = lay_rows.get(it["item"])
        if not g or (g[1], g[2].strip(), g[3], g[4], g[5]) != (it["book"], it["desc"], it["unit"], it["qty"], it["price"]):
            diff.append((it["item"], g))
    ids = [it["item"] for it in items]
    res = {"pdf_sha256": sha, "rows_written": n, "items_bbox": len(items), "items_layout_lines": len(lay_ids),
           "items_layout_set_equal": sorted(lay_ids) == sorted(ids), "unique_item_numbers": len(set(ids)),
           "layout_regex_parsed": len(lay_rows), "layout_vs_bbox_value_mismatch": len(diff),
           "item_numbers_ascending": ids == sorted(ids), "column_check": check.finish(),
           "not_set_rows": sum(1 for r in rows if r["price_status"] == "not_set")}
    print(json.dumps(res, ensure_ascii=False, indent=1))
    if diff:
        print("diff sample", diff[:10])


if __name__ == "__main__":
    main()
