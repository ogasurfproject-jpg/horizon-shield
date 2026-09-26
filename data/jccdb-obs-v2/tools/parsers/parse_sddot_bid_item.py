# -*- coding: utf-8 -*-
"""
South Dakota DOT「Bid Item Price Report January 01, 2024 to December 31, 2024」(2024-bid-item-price-report.pdf, 30 頁)
を pdftotext -bbox-layout の語の座標で読み、観測層 v2 の bid_item 行にする。

入力: OBS2/raw/sddot-bid-item-2024.pdf(Apify web-fetch raw で取得、sha256 は台帳)
出力: OBS2/observations/us/bid_item_sddot_2024.csv
  - 3 頁「Average Unit Bid Prices for Bid Item Groups (Awarded Contracts)」18 群 x (2020, 2024)
      price_basis = bid_group_avg(原本は加重か単純か明記しない)
  - 4〜30 頁「2024 Average Unit Price Report」全品目 x 2 種
      Avg Low Bid Price      -> bid_weighted_avg(= Total Cost / Total Quantity を全行で検算)
      Avg of 3 Lowest Bids   -> bid_avg_lowest3
    ref_value = Total Quantity、note に Bid Cnt
照合:
  (a) bbox で読んだ品目行の数 と pdftotext -layout の行頭品目番号の数
  (b) 全品目で Total Cost / Total Quantity と Avg Low Bid Price の差(0.005 超を数える)
  (c) 列の割り当て: 数値語の並び順で決めた列と、見出し語の右端からの最近傍の列が全セルで一致するか
"""
import os, re, sys, json, subprocess
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from obs_common import make_id, num, write_obs, US_STATES
from u3_pdfwords import words_of, lines_of, sha256_file, ColumnCheck

SID = "sddot-bid-item-2024"
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
PDF = os.path.join(ROOT, "raw", SID + ".pdf")
OUT = os.path.join(ROOT, "observations", "us", "bid_item_sddot_2024.csv")
URL = "https://dot.sd.gov/media/qqhgg24h/2024-bid-item-price-report.pdf"
FIPS = "46"
ITEM_RE = re.compile(r"^\d{3}E\d{4}$")
NUMTOK = re.compile(r"^\$?-?[\d,]*\d(\.\d+)?%?$")


def is_num(t):
    return bool(NUMTOK.match(t)) or t == "N/A"


def base_row():
    return {"country": "US", "layer": "bid_item", "geo_level": "state", "geo_code": FIPS, "geo_name": US_STATES[FIPS],
            "currency": "USD", "source_id": SID, "evidence_url": URL, "license": "OPEN-TERMS"}


def parse_groups(ws, check):
    lines = lines_of(ws)
    hdr = [l for l in lines if any(w[4] == "Difference" for w in l[1])][0]
    hw = hdr[1]
    anchors_ws = [w for w in hw if w[4] in ("Quantity", "Price", "Difference")]
    anchors_ws = sorted(anchors_ws, key=lambda w: w[0])
    names = ["q2020", "p2020", "q2024", "p2024", "pct"]
    assert len(anchors_ws) == 5, anchors_ws
    anchors = {n: w[2] for n, w in zip(names, anchors_ws)}
    centers = {n: (w[0] + w[2]) / 2 for n, w in zip(names, anchors_ws)}
    param_y = [l[0] for l in lines if any(w[4] == "Parameters:" for w in l[1])][0]
    groups, pending = [], None
    for y, l in lines:
        if y <= hdr[0] or y >= param_y:
            continue
        lead = [w for w in l if w[0] < 82 and re.match(r"^\d{1,2}$", w[4])]
        nums = [w for w in l if w[0] > 330 and is_num(w[4])]
        desc = " ".join(w[4] for w in l if 82 <= w[0] < 300)
        unit = " ".join(w[4] for w in l if 300 <= w[0] < 330)
        if not lead and nums and not desc:
            pending = nums  # 17, 18 は値が説明の1行上に印字されている
            continue
        if lead:
            if not nums and pending:
                nums, pending = pending, None
            assert len(nums) == 5, (y, [w[4] for w in l])
            g = {"n": int(lead[0][4]), "desc": desc, "unit": unit}
            for n, w in zip(names, nums):
                g[n] = w[4]
                check.add(3, n, w[2], anchors[n], (w[0] + w[2]) / 2, centers[n], anchors)
            groups.append(g)
    # 群の中身(Bid Items & Parameters)
    params = {}
    for y, l in lines:
        if y <= param_y:
            continue
        lead = [w for w in l if w[0] < 82 and re.match(r"^\d{1,2}$", w[4])]
        if lead:
            txt = []
            for w in l[1:] if l[0] is lead[0] else l:
                if w[4] == "Page":
                    break
                if w is lead[0]:
                    continue
                txt.append(w[4])
            params[int(lead[0][4])] = " ".join(txt)
    return groups, params


def parse_items(pages, check):
    items = []
    for pno, ws in pages:
        lines = lines_of(ws)
        h2 = [l for l in lines if any(w[4] == "Cnt" for w in l[1])]
        if not h2:
            continue
        hy, hw = h2[0]
        a = {"qty": [w for w in hw if w[4] == "Quantity"][0], "cost": [w for w in hw if w[4] == "Cost"][0],
             "avglow": [w for w in hw if w[4] == "Price"][0], "avg3": [w for w in hw if w[4] == "Bids"][0],
             "cnt": [w for w in hw if w[4] == "Cnt"][0]}
        meas = [w for w in hw if w[4] == "Measure"][0]
        anchors = {k: v[2] for k, v in a.items()}
        centers = {k: (v[0] + v[2]) / 2 for k, v in a.items()}
        # 足元: 印刷日時(03/10/2025)と帳票名(HC65-...)。品目名に Standard / Page を含むものがあるので語では決めない
        footer_y = min([y for y, l in lines if y > hy and any(w[4] == "HC65-BidLetting-AvgUnitPrice.rp"
                                                           or re.match(r"^\d\d/\d\d/\d{4}$", w[4]) for w in l)] + [9999])
        for y, l in lines:
            if y <= hy or y >= footer_y:
                continue
            first = l[0]
            desc_ws = [w for w in l if 65 <= w[0] < meas[0] - 4]
            if ITEM_RE.match(first[4]) and first[0] < 65:
                unit_ws = [w for w in l if meas[0] - 6 <= w[0] and w[2] <= meas[2] + 6]
                nums = [w for w in l if w[0] > meas[2] + 6 and is_num(w[4])]
                others = [w for w in l if w[0] > meas[2] + 6 and not is_num(w[4])]
                assert len(nums) == 5 and not others, (pno, y, [w[4] for w in l])
                it = {"page": pno, "item": first[4], "desc": " ".join(w[4] for w in desc_ws),
                      "unit": " ".join(w[4] for w in unit_ws), "y": y}
                for k, w in zip(["qty", "cost", "avglow", "avg3", "cnt"], nums):
                    it[k] = w[4]
                    check.add(pno, k, w[2], anchors[k], (w[0] + w[2]) / 2, centers[k], anchors)
                items.append(it)
            else:
                # 説明の続きの行(品目番号なし、説明の列だけに語がある)
                rest = [w for w in l if not (65 <= w[0] < meas[0] - 4)]
                assert desc_ws and not rest and items and items[-1]["page"] == pno and 0 < y - items[-1]["y"] < 14, \
                    (pno, y, [w[4] for w in l])
                items[-1]["desc"] += " " + " ".join(w[4] for w in desc_ws)
                items[-1]["y"] = y
    return items


def main():
    sha = sha256_file(PDF)
    pages = words_of(PDF)
    check = ColumnCheck()
    groups, params = parse_groups(pages[2], check)
    items = parse_items([(i + 1, ws) for i, ws in enumerate(pages) if i >= 3], check)
    rows = []
    for g in groups:
        for yr, qk, pk in (("2020", "q2020", "p2020"), ("2024", "q2024", "p2024")):
            r = base_row()
            r.update({"category": "Average Unit Bid Prices for Bid Item Groups (Awarded Contracts) / Major Construction Items",
                      "item_name": g["desc"], "spec": "item group %d" % g["n"], "unit": g["unit"],
                      "price_basis": "bid_group_avg", "period": yr, "source_page": "3",
                      "note": ("群の中身: " + params.get(g["n"], "")).strip() + " / 2024 年版報告書の比較列(4 年前)" * (yr == "2020")})
            if g[pk] == "N/A":
                r.update({"price_status": "not_set"})
                r["note"] = "原本は N/A。" + r["note"]
            else:
                r.update({"price": num(g[pk].replace("$", "")), "price_status": "published_open_terms",
                          "ref_value": num(g[qk]), "ref_note": "quantity of the item group (awarded contracts)"})
            r["obs_id"] = make_id(SID, "group", g["n"], yr, "bid_group_avg")
            rows.append(r)
    # 品目
    bad_ratio, max_rel = [], 0.0
    for it in items:
        qty, cost, avglow = float(num(it["qty"])), float(num(it["cost"])), float(num(it["avglow"]))
        if qty > 0 and abs(cost / qty - avglow) > 0.005:
            bad_ratio.append((it["item"], round(cost / qty, 4), avglow))
        if qty > 0 and avglow > 0:
            max_rel = max(max_rel, abs(cost / qty - avglow) / avglow)
        for basis, key in (("bid_weighted_avg", "avglow"), ("bid_avg_lowest3", "avg3")):
            r = base_row()
            note = ["Bid Cnt %s" % num(it["cnt"])]
            if basis == "bid_weighted_avg":
                note.append("Avg Low Bid Price(落札者の単価の平均。Total Cost / Total Quantity にあたる)")
            else:
                note.append("Avg of 3 Lowest Bids(最低 3 者の単価の平均。加重か単純かは原本に明記なし)")
            if qty == 0:
                note.append("Total Quantity 0.00(落札数量なし)")
            if it["unit"] == "LS":
                note.append("LS は一式あたりの平均で単価として比べない")
            r.update({"category": "Standard Items with Average Bid Price for all accepted bids",
                      "item_name": it["desc"], "spec": it["item"], "unit": it["unit"], "price_basis": basis,
                      "period": "2024", "source_page": str(it["page"]),
                      "ref_value": num(it["qty"]), "ref_note": "Total Quantity (2024, awarded contracts)"})
            v = float(num(it[key]))
            if v <= 0:
                r["price_status"] = "not_set"
                note.insert(0, "原本の値は %s(0 は not_set で表す)" % it[key])
            else:
                r.update({"price": num(it[key]), "price_status": "published_open_terms"})
            r["note"] = "。".join(note)
            r["obs_id"] = make_id(SID, "item", it["item"], "2024", basis)
            rows.append(r)
    n = write_obs(OUT, rows)
    # 照合 (a): layout の行頭品目番号
    lay = subprocess.run(["pdftotext", "-layout", PDF, "-"], capture_output=True, text=True, check=True).stdout
    lay_items = re.findall(r"^\s*(\d{3}E\d{4})\s", lay, flags=re.M)
    cc = check.finish()
    res = {"pdf_sha256": sha, "rows_written": n, "groups": len(groups), "items_bbox": len(items),
           "items_layout_regex": len(lay_items), "items_layout_set_equal": sorted(lay_items) == sorted(i["item"] for i in items),
           "unique_item_numbers": len(set(i["item"] for i in items)),
           "cost_div_qty_mismatch_gt_0.005": len(bad_ratio), "cost_div_qty_max_rel_diff": round(max_rel, 6),
           "column_check": cc,
           "zero_value_items": [i["item"] for i in items if float(num(i["avglow"])) <= 0 or float(num(i["avg3"])) <= 0]}
    print(json.dumps(res, ensure_ascii=False, indent=1))
    if bad_ratio:
        print("mismatch sample", bad_ratio[:10])


if __name__ == "__main__":
    main()
