# -*- coding: utf-8 -*-
"""
New Jersey DOT「Estimation Support and Historical Statistics, BAMS/DSS Output」2ndQuarter2023.pdf(894 頁、Jul 2022 - Jun 2023)
のうち、次の 2 つの表を pdftotext -bbox-layout の語の座標で読み、観測層 v2 の bid_item 行にする。

  A. 523〜788 頁「WEIGHTED AVERAGE ITEM PRICE REPORT BY REGION, ITEM, AND QUARTER」
     地区(C / N / S / STATEWID)x 品目 x 四半期 と、品目ごとの 12 か月計(合計行)。
       AVERAGE AWARDED PRICE      -> bid_weighted_avg(= TOTAL DOLLARS / TOTAL QUANTITY を検算)
       AVERAGE OF LOW 3 BIDDERS   -> bid_avg_lowest3
     ref_value = TOTAL QUANTITY、note に NUMBER OF OCCUR'S と TOTAL DOLLARS。
  B. 2〜4 頁「TOP STANDARD ITEMS BETWEEN July 28, 2022 AND June 6, 2023, RANKED BY TOTAL AWARDED DOLLARS」(上位 100 品目、州全体)
       AVERAGE PRICE -> bid_weighted_avg(= DOLLARS / QUANTITY)。geo_level state。
  518 頁の HISTORICAL BID PRICE LISTING(契約ごとの個別入札)と 10 頁の ITEM DATA AT CONTRACT LEVEL は集計でないので読まない。

入力: OBS2/raw/njdot-wavg-2023-q2.pdf
出力: OBS2/observations/us/bid_item_njdot_2023q2.csv
"""
import os, re, sys, json, subprocess, collections
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from obs_common import make_id, num, write_obs, US_STATES
from u3_pdfwords import words_of, lines_of, sha256_file, ColumnCheck

SID = "njdot-wavg-2023-q2"
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
PDF = os.path.join(ROOT, "raw", SID + ".pdf")
OUT = os.path.join(ROOT, "observations", "us", "bid_item_njdot_2023q2.csv")
URL = "https://dot.nj.gov/transportation/business/aashtoware/pdf/2ndQuarter2023.pdf"
FIPS = "34"
CODE_RE = re.compile(r"^[0-9A-Z]{6}[A-Z]$")
Q_RE = re.compile(r"^\d{4}Q[1-4]$")
NUMTOK = re.compile(r"^\$?-?[\d,]*\d(\.\d+)?$")
DASH_RE = re.compile(r"^-+$")
WAIP_PAGES = (523, 788)
TOP_PAGES = (2, 4)
COLS = ["occ", "qty", "dollars", "awarded", "low3"]


def f(t):
    return float(num(t.replace("$", "")))


def parse_waip(check):
    pages = words_of(PDF, *WAIP_PAGES)
    blocks, cur, region, cont = [], None, None, False
    for off, ws in enumerate(pages):
        pno = WAIP_PAGES[0] + off
        lines = lines_of(ws)
        h = [l for l in lines if any(w[4] == "OCCUR'S" for w in l[1])]
        assert h, pno
        hy, hw = h[0]
        hw2 = [l for l in lines if any(w[4] == "BIDDERS" for w in l[1])][0][1]
        anc_w = {"occ": [w for w in hw if w[4] == "OCCUR'S"][0], "qty": [w for w in hw if w[4] == "QUANTITY"][0],
                 "dollars": [w for w in hw if w[4] == "DOLLARS"][0], "awarded": [w for w in hw2 if w[4] == "PRICE"][0],
                 "low3": [w for w in hw2 if w[4] == "BIDDERS"][0]}
        anchors = {k: w[2] for k, w in anc_w.items()}
        centers = {k: (w[0] + w[2]) / 2 for k, w in anc_w.items()}
        for y, l in lines:
            if y <= hy + 12:  # 見出し 2 段目(PRICE / BIDDERS)まで
                continue
            toks = [w[4] for w in l]
            if all(DASH_RE.match(t) for t in toks):
                continue
            if toks == ["(item", "continued)"]:
                # 頁を跨ぐ品目。次の頁の先頭で 地区・説明・品目番号 が繰り返される
                cont = True
                continue
            reg = [w for w in l if w[0] < 125]
            body = [w for w in l if w[0] >= 125 and not DASH_RE.match(w[4])]
            if reg:
                region = reg[0][4]
            nums = [w for w in body if w[0] > 300 and NUMTOK.match(w[4])]
            quarter = [w for w in body if Q_RE.match(w[4])]
            code = [w for w in body if w[0] < 200 and CODE_RE.match(w[4])]
            is_total = (not quarter and not code and len(body) == 5 and all(NUMTOK.match(w[4]) for w in body)
                        and body[0][0] > 300)
            if not quarter and not is_total:
                # 品目の説明行「DESCRIPTION / UNIT」
                txt = " ".join(w[4] for w in body)
                assert " / " in txt, (pno, y, toks)
                desc, unit = txt.rsplit(" / ", 1)
                if cont:
                    assert cur and (cur["region"], cur["desc"], cur["unit"]) == (region, desc, unit), (pno, y, toks)
                    cont = False
                    cur["continued_pages"].append(pno)
                    continue
                cur = {"region": region, "desc": desc, "unit": unit, "code": None, "q": [], "total": None, "page": pno,
                       "continued_pages": []}
                blocks.append(cur)
                continue
            assert len(nums) == 5 and len(quarter) <= 1 and cur is not None and not cont, (pno, y, toks)
            vals = {}
            for k, w in zip(COLS, nums):
                vals[k] = w[4]
                check.add(pno, k, w[2], anchors[k], (w[0] + w[2]) / 2, centers[k], anchors)
            if code:
                assert cur["code"] is None or (cur["continued_pages"] and cur["code"] == code[0][4]), (pno, y, toks)
                cur["code"] = code[0][4]
            if quarter:
                assert cur["total"] is None, (pno, y, toks)
                vals["quarter"] = quarter[0][4]
                vals["page"] = pno
                cur["q"].append(vals)
            else:
                assert cur["total"] is None, (pno, y, toks)
                vals["page"] = pno
                cur["total"] = vals
    return blocks


def parse_top(check):
    pages = words_of(PDF, *TOP_PAGES)
    items = []
    for off, ws in enumerate(pages):
        pno = TOP_PAGES[0] + off
        lines = lines_of(ws)
        h = [l for l in lines if any(w[4] == "OCCURRENCES" for w in l[1])]
        assert h, pno
        hy, hw = h[0]
        anc_w = {"qty": [w for w in hw if w[4] == "QUANTITY"][0], "k$": [w for w in hw if w[4] == "000S)"][0],
                 "avg": [w for w in hw if w[4] == "PRICE"][0], "pct": [w for w in hw if w[4] == "DOLLARS"][0],
                 "occ": [w for w in hw if w[4] == "OCCURRENCES"][0]}
        anchors = {k: w[2] for k, w in anc_w.items()}
        centers = {k: (w[0] + w[2]) / 2 for k, w in anc_w.items()}
        a_units = [w for w in hw if w[4] == "UNITS"][0]
        for y, l in lines:
            if y <= hy:
                continue
            if not re.match(r"^\d{1,3}$", l[0][4]) or l[0][0] > 110:
                continue
            rank = l[0][4]
            code = l[1][4]
            year = l[2][4]
            assert CODE_RE.match(code) and re.match(r"^\d\d$", year), (pno, y, [w[4] for w in l])
            desc = [w for w in l[3:] if w[0] < a_units[0] - 2]
            unit = [w for w in l[3:] if a_units[0] - 2 <= w[0] < a_units[0] + 30]
            nums = [w for w in l[3:] if w[0] >= a_units[0] + 30]
            assert len(unit) == 1 and len(nums) == 5 and all(NUMTOK.match(w[4]) for w in nums), (pno, y, [w[4] for w in l])
            it = {"page": pno, "rank": rank, "code": code, "year": year, "desc": " ".join(w[4] for w in desc), "unit": unit[0][4]}
            for k, w in zip(["qty", "k$", "avg", "pct", "occ"], nums):
                it[k] = w[4]
                check.add(pno, k, w[2], anchors[k], (w[0] + w[2]) / 2, centers[k], anchors)
            items.append(it)
    return items


def base():
    return {"country": "US", "layer": "bid_item", "currency": "USD", "source_id": SID, "evidence_url": URL,
            "license": "OPEN-TERMS", "geo_code": FIPS, "geo_name": US_STATES[FIPS]}


def price_fields(r, v, note):
    x = f(v)
    if x <= 0:
        r["price_status"] = "not_set"
        note.insert(0, "原本の値は %s(0 以下は not_set で表す)" % v)
    else:
        r.update({"price": num(v.replace("$", "")), "price_status": "published_open_terms"})


def main():
    sha = sha256_file(PDF)
    check = ColumnCheck()
    blocks = parse_waip(check)
    top = parse_top(check)
    rows = []
    stats = collections.Counter()
    sum_mis, avg_mis, max_avg_rel = [], [], 0.0
    for b in blocks:
        assert b["code"] and b["q"] and b["total"], b
        t = b["total"]
        # 照合: 四半期の和 = 合計行
        so = sum(int(f(q["occ"])) for q in b["q"])
        sq = sum(f(q["qty"]) for q in b["q"])
        sd = sum(f(q["dollars"]) for q in b["q"])
        if so != int(f(t["occ"])) or abs(sq - f(t["qty"])) > 0.011 * len(b["q"]) or abs(sd - f(t["dollars"])) > 1.0 * len(b["q"]):
            sum_mis.append((b["region"], b["code"], so, t["occ"], sq, t["qty"], sd, t["dollars"]))
        for q in b["q"] + [t]:
            qty, dol, aw = f(q["qty"]), f(q["dollars"]), f(q["awarded"])
            if qty > 0 and aw > 0:
                rel = abs(dol / qty - aw) / aw
                # 印字の丸め: TOTAL DOLLARS は 1 ドル単位、AVERAGE AWARDED PRICE は小数 2 桁(大きい値は整数)で印字される
                dec = len(q["awarded"].split(".")[1]) if "." in q["awarded"] else 0
                if abs(dol / qty - aw) > 0.5 / qty + 0.5 * 10 ** (-dec) + 1e-9:
                    avg_mis.append((b["region"], b["code"], q.get("quarter", "total"), dol / qty, aw))
                max_avg_rel = max(max_avg_rel, rel)
        for q in b["q"] + [t]:
            is_total = "quarter" not in q
            period = "2023-06" if is_total else q["quarter"]
            for basis, key in (("bid_weighted_avg", "awarded"), ("bid_avg_lowest3", "low3")):
                r = base()
                note = ["NUMBER OF OCCUR'S %s" % num(q["occ"]), "TOTAL DOLLARS %s" % q["dollars"]]
                if is_total:
                    note.insert(0, "12 か月計(Jul 2022 - Jun 2023)")
                note.append("AVERAGE AWARDED PRICE" if key == "awarded" else "AVERAGE OF LOW 3 BIDDERS(加重か単純かは原本に明記なし)")
                if b["region"] == "STATEWID":
                    note.append("STATEWID は原本の地区区分(Area Totals では STAT)。州全体の集計ではない")
                if b["unit"] == "LS":
                    note.append("LS は一式あたりの平均で単価として比べない")
                r.update({"category": "WEIGHTED AVERAGE ITEM PRICE REPORT BY REGION, ITEM, AND QUARTER",
                          "item_name": b["desc"], "spec": b["code"], "unit": b["unit"], "geo_level": "district",
                          "area_label": b["region"], "area_code": b["region"], "price_basis": basis, "period": period,
                          "source_page": str(q["page"]), "ref_value": num(q["qty"]),
                          "ref_note": "TOTAL QUANTITY (awarded)"})
                price_fields(r, q[key], note)
                r["note"] = "。".join(note)
                r["obs_id"] = make_id(SID, "waip", b["region"], b["code"], b["unit"], period, basis)
                rows.append(r)
                stats[r["price_status"]] += 1
    # B. 州全体の上位 100 品目
    reg_tot = collections.defaultdict(lambda: [0.0, 0.0])
    for b in blocks:
        reg_tot[b["code"]][0] += f(b["total"]["dollars"])
        reg_tot[b["code"]][1] += f(b["total"]["qty"])
    top_cmp = []
    for it in top:
        r = base()
        note = ["RANK %s" % it["rank"], "SPEC YEAR %s" % it["year"], "DOLLARS (IN 000S) %s" % it["k$"],
                "PERCENT DOLLARS %s" % it["pct"], "CONTRACT OCCURRENCES %s" % it["occ"],
                "期間 July 28, 2022 - June 6, 2023(89 CONTRACTS)", "AVERAGE PRICE は原本の印字桁のまま(大きい値は小数を持たない)",
                "説明は原本で 40 桁で切れていることがある"]
        if it["unit"] == "LS":
            note.append("LS は一式あたりの平均で単価として比べない")
        r.update({"category": "TOP STANDARD ITEMS RANKED BY TOTAL AWARDED DOLLARS", "item_name": it["desc"],
                  "spec": it["code"], "unit": it["unit"], "geo_level": "state", "price_basis": "bid_weighted_avg",
                  "period": "2023-06", "source_page": str(it["page"]), "ref_value": num(it["qty"]),
                  "ref_note": "QUANTITY (awarded, statewide)"})
        price_fields(r, it["avg"], note)
        r["note"] = "。".join(note)
        r["obs_id"] = make_id(SID, "top", it["code"], it["unit"], "2023-06", "bid_weighted_avg")
        rows.append(r)
        stats[r["price_status"]] += 1
        d, q = reg_tot.get(it["code"], (0, 0))
        if q > 0:
            dec = len(it["avg"].split(".")[1]) if "." in it["avg"] else 0
            within = abs(d / q - f(it["avg"])) <= 0.5 / q + 0.5 * 10 ** (-dec) + 1e-9
            top_cmp.append((it["code"], it["unit"], f(it["avg"]), round(d / q, 4), f(it["qty"]), q, within))
    n = write_obs(OUT, rows)
    # 照合: layout で「品目番号 + 四半期」の行を数える(A の品目数)と 上位表の行
    lay = subprocess.run(["pdftotext", "-layout", "-f", str(WAIP_PAGES[0]), "-l", str(WAIP_PAGES[1]), PDF, "-"],
                         capture_output=True, text=True, check=True).stdout
    lay_blocks = re.findall(r"^\s+([0-9A-Z]{6}[A-Z])\s+\d{4}Q[1-4]\s", lay, flags=re.M)
    lay_q = re.findall(r"^\s+(?:[0-9A-Z]{6}[A-Z]\s+)?\d{4}Q[1-4]\s", lay, flags=re.M)
    lay_top = subprocess.run(["pdftotext", "-layout", "-f", "2", "-l", "4", PDF, "-"], capture_output=True, text=True, check=True).stdout
    lay_top_n = len(re.findall(r"^\s+\d{1,3}\s+[0-9A-Z]{6}[A-Z]\s+\d\d\s", lay_top, flags=re.M))
    keyc = collections.Counter((b["region"], b["code"], b["unit"]) for b in blocks)
    res = {"pdf_sha256": sha, "rows_written": n, "status": dict(stats),
           "waip_blocks_bbox": len(blocks), "waip_page_continuations": sum(len(b["continued_pages"]) for b in blocks),
           "waip_code_quarter_lines_layout": len(lay_blocks),
           "waip_quarter_rows_bbox": sum(len(b["q"]) for b in blocks), "waip_quarter_rows_layout": len(lay_q),
           "regions": dict(collections.Counter(b["region"] for b in blocks)),
           "distinct_item_codes": len(set(b["code"] for b in blocks)),
           "dup_region_code_unit": [k for k, v in keyc.items() if v > 1],
           "quarter_sum_vs_total_mismatch": len(sum_mis), "avg_vs_dollars_div_qty_mismatch": len(avg_mis),
           "avg_vs_dollars_div_qty_max_rel": round(max_avg_rel, 6),
           "top_items_bbox": len(top), "top_items_layout": lay_top_n,
           "top_vs_region_totals_compared": len(top_cmp),
           "top_vs_region_totals_within_print_rounding": sum(1 for c in top_cmp if c[6]),
           "top_vs_region_totals_outside (code, unit, top_avg, regions_dollars/qty, top_qty, regions_qty)":
               [c[:6] for c in top_cmp if not c[6]],
           "column_check": check.finish()}
    print(json.dumps(res, ensure_ascii=False, indent=1))
    if sum_mis:
        print("sum mismatch sample", sum_mis[:10])
    if avg_mis:
        print("avg mismatch sample", avg_mis[:10])


if __name__ == "__main__":
    main()
