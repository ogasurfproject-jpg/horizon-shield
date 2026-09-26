# -*- coding: utf-8 -*-
"""
FTA Capital Cost Database(2024 年 9 月更新の CSV)を読む。担当 US-E-state-open。

入力: OBS2/raw/fta-capcost-2024-09.csv
  https://www.transit.dot.gov/sites/fta.dot.gov/files/docs/FTA-Cost-Database-September-2024.csv
出力: observations/us/work_fta_capcost_2024_09.csv, sources/fta-capcost-2024-09.json

1 行 = プロジェクト x SCC 要素(65 x 197 = 12,805 行)。値として写すのは 'Unit Cost at Mid-Point of Construction'(中間年の名目ドル、地域補正なし)。
- Units が 'Hard Costs' の行(専門業務費など)は、原本の CSV で比率(費用 / ハードコスト)が通貨の書式で $0 / $1 に丸められているので値にしない(not_set、費用を ref_value に)。
- 費用はあるが単価が空欄の行(小計 55 など)は not_set(費用を ref_value に)。
- 費用も単価も空欄の行(そのプロジェクトに無い要素)は書かない。
- 'Unit Cost in National Average, User Selected Analysis Year 2024' 列は写さない(FTA の Quick Guide によれば物価・地域の補正は既定で RS Means Construction Cost Index。市販の指数による補正値)。
"""
import csv, hashlib, json, os, re, sys, collections
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from obs_common import make_id, write_obs, num

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
J = lambda *p: os.path.join(ROOT, *p)
SID = "fta-capcost-2024-09"
SRC = J("raw", SID + ".csv")
URL = "https://www.transit.dot.gov/sites/fta.dot.gov/files/docs/FTA-Cost-Database-September-2024.csv"
OUT = J("observations", "us", "work_fta_capcost_2024_09.csv")
C = "Cost at Mid-Point of Construction"
U = "Unit Cost at Mid-Point of Construction"
N = "Unit Cost in National Average, User Selected Analysis Year 2024"


def money(s):
    s = s.strip()
    if not s:
        return ""
    m = re.match(r"^\$([\d,]+(\.\d+)?)$", s)
    if not m:
        raise SystemExit("金額の形でない: %r" % s)
    return num(m.group(1))


def main():
    raw = open(SRC, "rb").read()
    rows = list(csv.DictReader(open(SRC, encoding="utf-8")))
    tops = {}
    for r in rows:
        if "." not in r["ElementNumber"]:
            tops[(r["ProjectName"], r["ElementNumber"])] = r["ElementName"].strip()
    out = []
    cnt = collections.Counter()
    ratio_chk = {"rows": 0, "within_1usd": 0, "max_rel_diff_outside": 0.0, "outside": []}
    for r in rows:
        cost, ucost = money(r[C]), money(r[U])
        units = r["Units"].strip()
        if not cost and not ucost:
            cnt["skip_blank"] += 1
            continue
        per = r["Mid-Point of Construction"].strip()
        if not re.match(r"^\d{4}$", per):
            cnt["skip_no_midpoint"] += 1
            continue
        proj_raw = r["ProjectName"]
        proj = proj_raw.replace("�", "-")
        top = r["ElementNumber"].split(".")[0]
        cat = "FTA Standard Cost Categories (SCC) %s %s" % (top, tops.get((proj_raw, top), ""))
        notes = ["Mode: %s。Grade: %s。ProjectType: %s" % (r["Mode"], r["Grade"], r["ProjectType"]),
                 "Cost at Mid-Point of Construction: %s(原本)" % r[C].strip() if cost else "",
                 "竣工した連邦補助の交通プロジェクトの出来形原価。工事期間の中間年の名目ドル、地域補正なし"]
        if "�" in proj_raw:
            notes.append("プロジェクト名の 1 文字(UTF-8 でない文字、cp1252 のダッシュと見られる)が取得経路で U+FFFD に置き換わっていたので '-' と書いた")
        o = {"obs_id": make_id(SID, proj_raw, r["ElementNumber"]), "country": "US", "layer": "work", "category": cat,
             "item_name": r["ElementName"].strip(), "spec": "SCC %s" % r["ElementNumber"], "unit": units,
             "geo_level": "national", "geo_code": "US", "geo_name": "United States", "area_label": proj,
             "currency": "USD", "price_basis": "asbuilt_unit_cost_midpoint", "period": per, "source_id": SID,
             "source_page": "CSV row %d" % (rows.index(r) + 2), "evidence_url": URL, "license": "US-PD-17USC105"}
        if units == "Hard Costs":
            o["price"] = ""; o["price_status"] = "not_set"
            if cost:
                o["ref_value"] = cost; o["ref_note"] = "Cost at Mid-Point of Construction (USD)"
            notes.append("単位が Hard Costs の要素は、原本の CSV の単価欄が比率を通貨の書式で丸めた %s なので値にしない。Quantity 欄はハードコストの額 %s" % (r[U].strip() or "空欄", r["Quantity"]))
            cnt["not_set_hardcost_ratio"] += 1
        elif ucost and float(ucost) == 0:
            o["price"] = ""; o["price_status"] = "not_set"
            if cost:
                o["ref_value"] = cost; o["ref_note"] = "Cost at Mid-Point of Construction (USD)"
            notes.append("原本の単価欄は $0(費用 %s / 数量 %s %s が 0.5 ドル未満で、整数ドルの書式に丸められたと見られる)。単価の 0 は not_set" % (r[C].strip(), r["Quantity"], units))
            cnt["not_set_unit_cost_zero"] += 1
        elif ucost:
            o["price"] = ucost; o["price_status"] = "public_domain"
            if r["Quantity"].strip():
                o["ref_value"] = num(r["Quantity"]); o["ref_note"] = "Quantity (%s)" % units
                q = float(num(r["Quantity"])); c = float(cost); u = float(ucost)
                ratio_chk["rows"] += 1
                if abs(c / q - u) <= 1.0:
                    ratio_chk["within_1usd"] += 1
                else:
                    rel = abs(c / q - u) / u
                    ratio_chk["max_rel_diff_outside"] = max(ratio_chk["max_rel_diff_outside"], rel)
                    ratio_chk["outside"].append([proj, r["ElementNumber"], r["Quantity"], r[C].strip(), r[U].strip()])
            cnt["public_domain"] += 1
        else:
            o["price"] = ""; o["price_status"] = "not_set"
            o["ref_value"] = cost; o["ref_note"] = "Cost at Mid-Point of Construction (USD)"
            notes.append("原本の単価欄は空欄(費用だけがある)")
            cnt["not_set_cost_only"] += 1
        o["note"] = "。".join(n for n in notes if n)
        out.append(o)
    n = write_obs(OUT, out)
    # 照合: 小計の行 = 構成要素の費用の和(55 = 10+20+30+40+50, 75 = 55+60+70, 105 = 75+80+90+100)
    by = collections.defaultdict(dict)
    for r in rows:
        by[r["ProjectName"]][r["ElementNumber"]] = float(money(r[C])) if money(r[C]) else 0.0
    sums = {}
    for tot, parts, tol in (("55", ["10", "20", "30", "40", "50"], 2), ("75", ["55", "60", "70"], 3), ("105", ["75", "80", "90", "100"], 4)):
        ok = sum(1 for p, d in by.items() if abs(sum(d.get(k, 0) for k in parts) - d.get(tot, 0)) <= tol)
        sums[tot] = "%d/%d" % (ok, len(by))
    chk = {"csv_rows": len(rows), "projects": len(by), "elements_per_project": sorted(set(collections.Counter(r["ProjectName"] for r in rows).values())),
           "written": n, "counts": dict(cnt), "unit_cost_vs_cost_div_qty": ratio_chk, "subtotals_equal_sum_of_parts": sums,
           "replacement_chars": raw.count(b"\xef\xbf\xbd"), "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}
    json.dump(chk, open(J("reports", "US-E-fta-capcost-checks.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    led = {
        "source_id": SID, "country": "US",
        "title": "FTA Capital Cost Database, September 2024 update (FTA Cost Database 2024 Sept.csv): as-built costs of 65 federally funded transit projects by Standard Cost Category",
        "publisher": "U.S. Department of Transportation, Federal Transit Administration",
        "url": URL, "landing": "https://www.transit.dot.gov/capital-cost-database",
        "retrieved_at": "2026-09-26", "bytes": len(raw), "sha256": chk["sha256"],
        "http_last_modified": "Thu, 10 Oct 2024 20:20:41 GMT",
        "license": "US-PD-17USC105",
        "license_url": "https://www.law.cornell.edu/uscode/text/17/105",
        "license_quote": "Copyright protection under this title is not available for any work of the United States Government (17 U.S.C. 105) / FTA Web Policies (https://www.transit.dot.gov/fta-web-policies/web-policies/fta-web-policies, Last updated: Tuesday, September 13, 2022), Photo Policy: \"FTA does not restrict or hinder the public from downloading any information from its website.\"",
        "license_note": "連邦政府(FTA)の公開データ。頁と CSV に著作権表示・利用制限の記載はない。FTA Web Policies は Apify markdown(dataset xYa9soWURSTjXaFL5)で取得。",
        "attribution": "Source: U.S. DOT, Federal Transit Administration, Capital Cost Database (September 2024 update), %s" % URL,
        "values_copied": True,
        "fetched_via": "Apify apify/web-fetch (formats=raw)。Content-Type text/csv を文字として受け取ったため、原本の UTF-8 でない 1 バイト文字(2 つのプロジェクト名、計 394 か所)が U+FFFD(EF BF BD)に置き換わった。数値の列は ASCII だけで影響なし。sha256 と bytes は保存したバイト列のもので、サーバーの原本のバイト列とは一致しない可能性がある(Range を付けても 200 で全体が返り、原本の長さを確かめられなかった)",
        "scope_quote": "The Capital Cost Database is a Microsoft Access database of as-built costs for 65 federally funded projects in the following modes: bus rapid transit, commuter rail, light rail, heavy rail and trolley. ... Project costs are tracked in FTA's Standard Cost Categories and the project costs have been validated. (landing page, Last updated: Friday, October 11, 2024)",
        "how_read": ("tools/parsers/parse_fta_capcost.py。CSV をそのまま読む(12,805 行 = 65 プロジェクト x 197 要素)。Unit Cost at Mid-Point of Construction を値に、Quantity を ref_value に、Cost を note に。"
                     "Units が Hard Costs の要素(単価欄が比率の丸めで $0 / $1)と、単価が空欄で費用だけの行は not_set(費用を ref_value)。費用も単価も空欄の行は書かない。"
                     "'Unit Cost in National Average, User Selected Analysis Year 2024' は写さない(FTA Cost Database Quick Guide June 2023: 'The default index is the RS Means Construction Cost Index.')。"
                     "照合: 単価 = 費用 / 数量 を全行で比べ、小計行 55・75・105 が構成要素の和と一致するかを全 65 プロジェクトで確かめた(結果は reports/US-E-fta-capcost-checks.json)。"),
    }
    json.dump(led, open(J("sources", SID + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in chk.items() if k != "unit_cost_vs_cost_div_qty"}, ensure_ascii=False))
    print(json.dumps({k: v for k, v in ratio_chk.items() if k != "outside"}), len(ratio_chk["outside"]))


if __name__ == "__main__":
    main()
