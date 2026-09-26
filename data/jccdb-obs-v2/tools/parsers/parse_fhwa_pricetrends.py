# -*- coding: utf-8 -*-
"""
FHWA 'Price Trends for Federal-Aid Highway Construction'(1987 Base, 2007 年に終了した四半期刊行物のアーカイブ頁)を読む。
担当 US-E-state-open。

入力(OBS2/raw):
  fhwa-pricetrends-2006q4.html  全 5 表(全国の年・四半期 / 地方部・都市部 2 表 / 3 四半期移動 / 州別 2006 年)
  fhwa-pricetrends-2006q4.pdf   同じ号の PDF(照合だけに使う。州別表の期間 'Year: 2006' は PDF にだけ印字)
  fhwa-pricetrends-<YYYY>q4.html (1998〜2005)  各号の州別表(その年の年計)だけを使う
出力:
  observations/us/bid_item_fhwa_pricetrends_1972_2006.csv
  sources/fhwa-pricetrends-<YYYY>q4.json
  reports/US-E-fhwa-pricetrends-checks.json(照合の数字)

読み方: HTML の <table> を行ごとに読み、行頭の数でないセルをラベル、残りを値として列の数を確かめる(表 1・4・5 は 15、表 2 は 14、表 3 は 17)。
値は原本の文字のまま(先頭の '.' だけ '0.' にして数にする)。0.00 と空欄は not_set。
"""
import csv, hashlib, html as htmlmod, json, os, re, subprocess, sys, collections
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from obs_common import make_id, write_obs, num, US_STATES, US_STATE_ABBR

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
J = lambda *p: os.path.join(ROOT, *p)
YEARS = list(range(1998, 2007))
LATEST = 2006
OUT = J("observations", "us", "bid_item_fhwa_pricetrends_1972_2006.csv")

ITEMS6 = [  # (価格の列, 指数の列, 群, 品目, 単位)  表 1・4・5 の 15 列
    (0, 1, "Common excavation", "Common excavation", "cu. yd."),
    (2, 3, "Surfacing", "Portland cement concrete", "sq. yd."),
    (4, 5, "Surfacing", "Bituminous concrete", "ton"),
    (7, 8, "Structures", "Reinforcing steel", "lb."),
    (9, 10, "Structures", "Structural steel", "lb."),
    (11, 12, "Structures", "Structural concrete", "cu. yd."),
]
T2 = [  # 表 2(14 列): (価格 R, 価格 U, 指数 R, 指数 U)
    ((0, 1, 2, 3), "Common excavation", "Common excavation", "cu. yd."),
    ((4, 5, 6, 7), "Surfacing", "Portland cement concrete surface", "sq. yd."),
    ((8, 9, 10, 11), "Surfacing", "Bituminous concrete surface", "ton"),
]
T3 = [  # 表 3(17 列)
    ((0, 1, 2, 3), "Structures", "Structural reinforcing steel", "lb."),
    ((4, 5, 6, 7), "Structures", "Structural steel", "lb."),
    ((8, 9, 10, 11), "Structures", "Structural concrete", "cu. yd."),
]
QMAP = {"first quarter": 1, "second quarter": 2, "third quarter": 3, "fourth quarter": 4}
STATE_ALIAS = {"dist of columbia": "11", "dist. of columbia": "11", "district of columbia": "11", "puerto rico": "72"}
NAME2FIPS = {v.lower(): k for k, v in US_STATES.items()}
PCC_NOTE = "脚注 2: Starting with 1972, prices for portland cement concrete surfacing reflect adjustments to a standard 9″ thickness in each State. Prices do not include costs for reinforcing steel and joints."
DEF_NOTE = "Average contract prices shown herein are based on actual bids and include costs of materials, labor, equipment, overhead and profit(原本の定義)。連邦補助の契約(50 万ドル未満などは除く)の報告に基づく"


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def cell_text(c):
    c = re.sub(r"<sup[^>]*>.*?</sup>", "", c, flags=re.S)
    c = re.sub(r"<br\s*/?>", " ", c)
    c = htmlmod.unescape(re.sub(r"<[^>]+>", "", c))
    return re.sub(r"\s+", " ", c.replace("\xa0", " ")).strip()


def sup_marks(c):
    return ",".join(re.sub(r"<[^>]+>", "", s).strip() for s in re.findall(r"<sup[^>]*>(.*?)</sup>", c, flags=re.S))


def consistent(a, b):
    """印字の桁の違い(小数 1 桁への切り捨て・四捨五入)の範囲で同じ値か。"""
    da = len(a.split(".")[1]) if "." in a else 0
    db = len(b.split(".")[1]) if "." in b else 0
    return abs(float(norm(a)) - float(norm(b))) < 10 ** (-min(da, db)) - 1e-9


def is_num(t):
    return bool(re.match(r"^-?(\d+(\.\d+)?|\.\d+)$", t.replace(",", "")))


def norm(t):
    t = t.replace(",", "")
    if t.startswith("."):
        t = "0" + t
    return num(t)


def tables(h):
    out = []
    for t in re.findall(r"<table.*?</table>", h, flags=re.S):
        summ = re.search(r'summary="([^"]*)"', t)
        body = re.search(r"<tbody>(.*?)</tbody>", t, flags=re.S)
        rows = []
        for r in re.findall(r"<tr.*?</tr>", body.group(1) if body else t, flags=re.S):
            tds = re.findall(r"<td([^>]*)>(.*?)</td>", r, flags=re.S)
            if not tds:
                continue
            # ラベルのセルは class に 'left' を持つ(全 9 号で同じ組版)。値のセルは class なし
            k = 0
            while k < len(tds) and re.search(r'class="[^"]*\bleft\b', tds[k][0]):
                k += 1
            cells = [c for a, c in tds]
            txt = [cell_text(c) for c in cells]
            if any(t and not is_num(t) for t in txt[k:]):
                raise SystemExit("値の列に数でない文字: %s" % txt)
            rows.append({"labels": txt[:k], "label_sup": [sup_marks(c) for c in cells[:k]], "vals": txt[k:]})
        out.append({"summary": summ.group(1) if summ else "", "rows": rows})
    return out


def periods(rows, ncols, tname):
    """行に期間を付ける(年だけの行 = 年計、四半期の行 = YYYYQn)。"""
    cur = None
    res = []
    for r in rows:
        labs = [l.rstrip(".:").strip() for l in r["labels"]]
        if not labs:
            continue
        y = None; q = None
        for l in labs:
            m = re.match(r"^(\d{4})", l)
            if m and len(l.rstrip(":.")) <= 5:
                y = int(m.group(1))
            elif l.lower() in QMAP:
                q = QMAP[l.lower()]
            elif l.lower() == "annual":
                q = "A"
        if y is not None:
            cur = y
        if cur is None:
            raise SystemExit("期間が決まらない行: %s %s" % (tname, labs))
        if len(r["vals"]) != ncols:
            raise SystemExit("列の数が %d(%d のはず): %s %s" % (len(r["vals"]), ncols, tname, labs))
        per = "%d" % cur if q in (None, "A") else "%dQ%d" % (cur, q)
        res.append((per, labs, r["label_sup"], r["vals"]))
    return res


def row(sid, url, tno, item, unit, geo, area_label, per, val, idx, basis, cat, note_extra, page_ref):
    gl, gc, gn = geo
    oid = make_id(sid, "t%d" % tno, gc, area_label, item, per, basis)
    r = {"obs_id": oid, "country": "US", "layer": "bid_item", "category": cat, "item_name": item, "spec": "", "unit": unit,
         "geo_level": gl, "geo_code": gc, "geo_name": gn, "area_label": area_label, "area_code": "", "area_members": "",
         "currency": "USD", "price_basis": basis, "period": per, "source_id": sid, "source_page": page_ref,
         "evidence_url": url, "license": "US-PD-17USC105"}
    notes = [DEF_NOTE]
    if item.startswith("Portland cement concrete"):
        notes.append(PCC_NOTE)
    if note_extra:
        notes.append(note_extra)
    if val == "" or float(norm(val)) == 0:
        r["price"] = ""; r["price_status"] = "not_set"
        notes.append("原本の印字は %s。単価の 0 と空欄は not_set" % (val if val else "空欄"))
    else:
        r["price"] = norm(val); r["price_status"] = "public_domain"
        if idx not in ("", None) and float(norm(idx)) != 0:
            r["ref_value"] = norm(idx); r["ref_note"] = "Index (1987 = 100)。原本の同じ行の指数"
        elif idx not in ("", None):
            notes.append("同じ行の指数の印字は %s(単価だけがあり指数が 0 の行。原本のまま)" % idx)
    r["note"] = "。".join(notes)
    return r


def state_fips(label):
    l = label.strip().rstrip(".").strip().lower()
    l = re.sub(r"\s*\.+$", "", l)
    if l in STATE_ALIAS:
        return STATE_ALIAS[l]
    if l in NAME2FIPS:
        return NAME2FIPS[l]
    if label.strip().upper() in US_STATE_ABBR:
        return US_STATE_ABBR[label.strip().upper()]
    return None


def main():
    out, checks = [], {"pages": {}}
    nat_latest = {}
    ledgers = {}
    for y in sorted(YEARS, reverse=True):
        sid = "fhwa-pricetrends-%dq4" % y
        src = J("raw", sid + ".html")
        url = "https://www.fhwa.dot.gov/programadmin/pt%dq4.cfm" % y
        h = open(src, encoding="utf-8").read()
        title = cell_text(re.search(r"<title>(.*?)</title>", h, re.S).group(1))
        assert ("Fourth Quarter %d" % y) in title, title
        tabs = tables(h)
        assert len(tabs) == 5, (y, len(tabs))
        t1 = periods(tabs[0]["rows"], 15, "t1")
        nat_annual = {p: v for p, l, s, v in t1 if re.match(r"^\d{4}$", p)}
        chk = {"title": title, "sha256": sha(src), "bytes": os.path.getsize(src), "tables": [len(t["rows"]) for t in tabs]}
        if y == LATEST:
            nat_latest = nat_annual
            cap = "Price Trends for Federal-Aid Highway Construction - 1987 Base"
            for per, labs, sups, v in t1:
                ne = "行ラベルの脚注 %s" % ",".join(s for s in sups if s) if any(sups) else ""
                for pc, ic, grp, item, unit in ITEMS6:
                    out.append(row(sid, url, 1, item, unit, ("national", "US", "United States"), "", per, v[pc], v[ic],
                                   "bid_avg_contract_price", "%s / %s" % (cap, grp), ne, "HTML 表 1(PDF 2〜3 頁)"))
            for tno, spec, ncol in ((2, T2, 14), (3, T3, 17)):
                rows = periods(tabs[tno - 1]["rows"], ncol, "t%d" % tno)
                cap = "Price Trends for Federal-aid Highway Construction Rural and Urban - 1987 Base"
                for per, labs, sups, v in rows:
                    ne = "行ラベルの脚注 %s" % ",".join(s for s in sups if s) if any(sups) else ""
                    for (pr, pu, ir, iu), grp, item, unit in spec:
                        for area, pc, ic in (("Rural", pr, ir), ("Urban", pu, iu)):
                            out.append(row(sid, url, tno, item, unit, ("national", "US", "United States"), area, per, v[pc], v[ic],
                                           "bid_avg_contract_price", "%s / %s" % (cap, grp), ne, "HTML 表 %d(PDF 4 頁)" % tno))
            t4 = periods(tabs[3]["rows"], 15, "t4")
            cap = "Price Trends for Federal-Aid Highway Construction - Three-Quarter Moving Index - 1987 Base"
            for per, labs, sups, v in t4:
                for pc, ic, grp, item, unit in ITEMS6:
                    out.append(row(sid, url, 4, item, unit, ("national", "US", "United States"), "", per, v[pc], v[ic],
                                   "bid_avg_contract_price_3q_moving", "%s / %s" % (cap, grp),
                                   "The three-quarter moving composite price index is the weighted average of the indices for three consecutive quarters(原本)", "HTML 表 4(PDF 5 頁)"))
            chk["t1_rows"] = len(t1); chk["t2_rows"] = len(periods(tabs[1]["rows"], 14, "t2")); chk["t3_rows"] = len(periods(tabs[2]["rows"], 17, "t3")); chk["t4_rows"] = len(t4)
        # 州別表(その年の年計)
        st_rows = [r for r in tabs[4]["rows"] if r["labels"]]
        cap = "Price Trends for Federal-Aid Highway Construction - 1987 Base (State)"
        us = None; nst = 0; unknown = []
        for r in st_rows:
            lab = r["labels"][0]
            if len(r["vals"]) != 15:
                raise SystemExit("州別表の列の数: %d %s %s" % (len(r["vals"]), y, lab))
            if lab.strip().rstrip(".").lower() in ("united states", "us", "u.s."):
                us = r["vals"]; continue
            f = state_fips(lab)
            if not f:
                unknown.append(lab); continue
            nst += 1
            for pc, ic, grp, item, unit in ITEMS6:
                out.append(row(sid, url, 5, item, unit, ("state", f, US_STATES[f]), lab, "%d" % y, r["vals"][pc], r["vals"][ic],
                               "bid_avg_contract_price", "%s / %s" % (cap, grp),
                               "州別表の期間: %s(%s)。原本の注: In some instances, individual State indices may not be truly representative of long-term price trends because of comparatively low volumes of work for the period reported, or because of unusual projects awarded during the period"
                               % (y, "PDF に 'Year: 2006' と印字" if y == LATEST else "Fourth Quarter %d 号の州別表。同じ表の United States 行がその年の全国の年計と一致することで年計と確かめた" % y),
                               "HTML 表 5" + ("(PDF 7〜8 頁)" if y == LATEST else "")))
        if unknown:
            raise SystemExit("州が決まらない: %s %s" % (y, unknown))
        # 照合: 州別表の United States 行 と その号の全国の年計 / 最新号(2006 Q4)の全国の年計
        cmp_self = [{"col": i, "state_table_us": us[i], "same_issue_annual": nat_annual[str(y)][i]} for i in range(15)
                    if not consistent(us[i], nat_annual[str(y)][i])]
        chk.update({"state_rows": nst, "us_row": us, "us_vs_same_issue_national_annual_mismatch_cols": cmp_self})
        checks["pages"][sid] = chk
        ledgers[y] = (sid, url, src, title, chk)
    # 最新号との照合(過去号の州別表の US 行 と 2006 Q4 号の年計)
    for y in YEARS:
        sid = "fhwa-pricetrends-%dq4" % y
        us = checks["pages"][sid]["us_row"]
        lat = nat_latest.get(str(y))
        diffs = []
        for i in range(15):
            if not consistent(us[i], lat[i]):
                diffs.append({"col": i, "state_table_us": us[i], "latest_issue_annual": lat[i]})
        checks["pages"][sid]["us_vs_2006q4_national_annual_diffs"] = diffs
    # PDF との照合(2006 Q4 号の HTML の全数値が PDF の文字に現れるか。数の多重集合で比べる)
    pdf = J("raw", "fhwa-pricetrends-%dq4.pdf" % LATEST)
    txt = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True).stdout
    pdf_vals = collections.Counter(round(float(t.replace(",", "") if not t.startswith(".") else "0" + t), 3)
                                   for t in re.findall(r"(?<![\w.])(?:\d[\d,]*\.\d+|\.\d+)(?![\w.])", txt))
    h = open(J("raw", "fhwa-pricetrends-%dq4.html" % LATEST), encoding="utf-8").read()
    html_vals = collections.Counter()
    for t in tables(h):
        for r in t["rows"]:
            for v in r["vals"]:
                if v and "." in v:
                    html_vals[round(float(norm(v)), 3)] += 1
    missing = {k: html_vals[k] - pdf_vals.get(k, 0) for k in html_vals if html_vals[k] > pdf_vals.get(k, 0)}
    checks["pdf_vs_html_2006q4"] = {"html_decimal_values": sum(html_vals.values()), "pdf_decimal_tokens": sum(pdf_vals.values()),
                                   "html_values_not_covered_by_pdf": {str(k): v for k, v in sorted(missing.items())},
                                   "pdf_sha256": sha(pdf), "pdf_bytes": os.path.getsize(pdf)}
    n = write_obs(OUT, out)
    st = collections.Counter(r["price_status"] for r in out)
    checks["rows"] = n; checks["by_status"] = dict(st)
    checks["by_table"] = dict(collections.Counter(r["source_page"].split("(")[0] + " " + r["source_id"] for r in out))
    json.dump(checks, open(J("reports", "US-E-fhwa-pricetrends-checks.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    # 台帳
    for y, (sid, url, src, title, chk) in ledgers.items():
        stmt = "This document is disseminated under the sponsorship of the Department of Transportation in the interest of information exchange. The United States Government assumes no liability for the use of the information contained in this document."
        h = open(src, encoding="utf-8").read()
        has_stmt = "disseminated under the sponsorship of the Department of Transportation" in re.sub(r"\s+", " ", h)
        led = {
            "source_id": sid, "country": "US",
            "title": title,
            "publisher": "U.S. Department of Transportation, Federal Highway Administration (Office of Infrastructure, Office of Program Administration)",
            "url": url, "landing": "https://www.fhwa.dot.gov/programadmin/pricetrends.cfm",
            "retrieved_at": "2026-09-26", "bytes": chk["bytes"], "sha256": chk["sha256"],
            "license": "US-PD-17USC105",
            "license_url": "https://www.law.cornell.edu/uscode/text/17/105",
            "license_quote": "Copyright protection under this title is not available for any work of the United States Government (17 U.S.C. 105)" + (
                " / 原本の頁の記載: \"%s\"" % stmt if has_stmt else ""),
            "license_note": "連邦政府(FHWA)の刊行物。頁と PDF に著作権表示・利用制限の記載はない(HTML で 'copyright' / '©' を検索して 0 件)。FHWA の 'Web Policies & Notices'(https://www.fhwa.dot.gov/webpolicies/publishschedule.cfm)は Web 公開計画の頁で、再利用の条文はない(Apify markdown dataset JSZMoYefiJyftBtWt)。",
            "attribution": "Source: U.S. DOT, Federal Highway Administration, Price Trends for Federal-Aid Highway Construction (ARCHIVED), %s" % url,
            "values_copied": True,
            "fetched_via": "Apify apify/web-fetch (formats=raw)。text/html を文字として受け取り UTF-8 で保存(サーバーの Last-Modified は返らない)",
            "scope_quote": "Average contract prices shown herein are based on actual bids and include costs of materials, labor, equipment, overhead and profit. / FHWA guidance calls for data to be provided on all National Highway System projects except those projects with a contract value less than $500,000, or installation of protective devices at railroad grade crossings, or beautification projects.",
        }
        if y == LATEST:
            led["how_read"] = ("tools/parsers/parse_fhwa_pricetrends.py。HTML の 5 表を行ごとに読み、行頭の数でないセルをラベル、残りを値とし、列の数(表 1・4・5 は 15、表 2 は 14、表 3 は 17)を全行で確かめた。"
                               "表 1(全国 1972〜2006 年の年計と 2004〜2006 年の四半期)、表 2・3(地方部 Rural / 都市部 Urban)、表 4(3 四半期移動)、表 5(州別、PDF に 'Year: 2006' と印字)。"
                               "価格は 6 品目の Average contract price、同じ行の Index を ref_value に。0.00 と空欄は not_set。州別表の United States 行は出力せず照合に使った。"
                               "照合: 同じ号の PDF(raw/fhwa-pricetrends-2006q4.pdf, sha256 %s)の文字の数と HTML の全数値を多重集合で比べた(結果は reports/US-E-fhwa-pricetrends-checks.json と reports/US-E-state-open.md)。"
                               % checks["pdf_vs_html_2006q4"]["pdf_sha256"])
            led["pdf_url"] = "https://www.fhwa.dot.gov/programadmin/pt2006q4.pdf"
            led["pdf_sha256"] = checks["pdf_vs_html_2006q4"]["pdf_sha256"]
            led["pdf_bytes"] = checks["pdf_vs_html_2006q4"]["pdf_bytes"]
            led["published"] = "2007-03"
            led["published_note"] = "PDF の CreationDate 2007-03-10、Publication Number FHWA-IF-07-003。頁は ARCHIVED(Updated: 03/14/2019)"
        else:
            led["how_read"] = ("tools/parsers/parse_fhwa_pricetrends.py。この号からは州別表(表 5、その年の年計)だけを使う(全国の系列は 2006 Q4 号から)。"
                               "行頭のラベル 1 つ + 値 15 列を全行で確かめた。0.00 は not_set。照合: 州別表の United States 行を、同じ号の表 1 の %d 年の年計、および 2006 Q4 号の %d 年の年計と比べた(結果は reports/US-E-fhwa-pricetrends-checks.json)。" % (y, y))
        json.dump(led, open(J("sources", sid + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps({"rows": n, "by_status": dict(st), "pdf_uncovered": checks["pdf_vs_html_2006q4"]["html_values_not_covered_by_pdf"],
                      "state_rows": {k: v["state_rows"] for k, v in checks["pages"].items()},
                      "us_self_mismatch": {k: v["us_vs_same_issue_national_annual_mismatch_cols"] for k, v in checks["pages"].items()},
                      "us_vs_latest": {k: v["us_vs_2006q4_national_annual_diffs"] for k, v in checks["pages"].items()}}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
