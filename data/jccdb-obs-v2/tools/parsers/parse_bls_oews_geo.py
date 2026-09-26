# -*- coding: utf-8 -*-
"""
US-C-bls-geo: BLS 職業別雇用・賃金統計(OEWS)を、都市圏(May 2025)と過去年(May 2021〜May 2024 の全国・州)で広げる。
U1(parse_bls_oews.py、May 2025 の全国・州)と同じ職業・同じ列の作り方(item_name / spec / unit を揃え、時系列でつながるように)。

入力(OBS2/raw、2026-09-26 に Apify web-fetch formats=raw で取得。大きいものは Range ヘッダで分割して連結):
  - bls-oesm25ma.zip  https://www.bls.gov/oes/special-requests/oesm25ma.zip(MSA_M2025_dl.xlsx と BOS_M2025_dl.xlsx)
  - bls-oesm24nat.zip / bls-oesm24st.zip / bls-oesm23nat.zip / bls-oesm23st.zip / bls-oesm22nat.zip / bls-oesm22st.zip /
    bls-oesm21nat.zip / bls-oesm21st.zip
出力:
  - observations/us/wage_bls_oews_metro_2025_a.csv / _b.csv(AREA のコードが 30000 未満 / 以上。1 本だと 50MB を超えるため)
  - observations/us/wage_bls_oews_2024.csv / 2023 / 2022 / 2021(全国と州)
  - sources/bls-oews-m2025-metro.json, bls-oews-m<年>-national.json, bls-oews-m<年>-state.json
  - reports/US-C-bls-geo_oews_check.csv
対象の職業: SOC 47-xxxx の全行と EXTRA。記号 * ** # は値を入れず not_set、note にそのファイルの Field Descriptions の Notes の原文。
BOS(非都市圏)のファイルは観測にしない(都市圏ではないため)。照合(MSA + BOS の合計と全国)にだけ使う。
"""
import csv, collections, hashlib, io, json, os, sys, zipfile
HERE = os.path.dirname(os.path.abspath(__file__))
OBS2 = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(OBS2, "tools"))
from obs_common import make_id, num, write_obs, US_STATES, US_STATE_ABBR
import openpyxl

RAW = os.path.join(OBS2, "raw")
RETRIEVED = "2026-09-26"
EXTRA = ["11-9021", "13-1051", "17-1011", "17-2051", "17-3011", "17-3022", "49-9021"]
URL = "https://www.bls.gov/oes/special-requests/%s"
FETCH = json.load(open(os.path.join(RAW, "bls-oews-fetch-manifest.json"), encoding="utf-8"))
METRICS = [
    ("TOT_EMP", "count", "persons (employment)", "EMP_PRSE"),
    ("H_MEAN", "wage_hourly_mean", "USD/hour", "MEAN_PRSE"),
    ("A_MEAN", "wage_annual_mean", "USD/year", "MEAN_PRSE"),
    ("H_PCT10", "wage_hourly_p10", "USD/hour", None),
    ("H_PCT25", "wage_hourly_p25", "USD/hour", None),
    ("H_MEDIAN", "wage_hourly_median", "USD/hour", None),
    ("H_PCT75", "wage_hourly_p75", "USD/hour", None),
    ("H_PCT90", "wage_hourly_p90", "USD/hour", None),
    ("A_PCT10", "wage_annual_p10", "USD/year", None),
    ("A_PCT25", "wage_annual_p25", "USD/year", None),
    ("A_MEDIAN", "wage_annual_median", "USD/year", None),
    ("A_PCT75", "wage_annual_p75", "USD/year", None),
    ("A_PCT90", "wage_annual_p90", "USD/year", None),
]
LICENSE_QUOTE = ("The Bureau of Labor Statistics (BLS) is a Federal government agency and everything that we publish, "
                 "both in hard copy and electronically, is in the public domain, except for previously copyrighted photographs "
                 "and illustrations. You are free to use our public domain material without specific permission, although we do "
                 "ask that you cite the Bureau of Labor Statistics as the source.")
# (source_id, zip, member, 期間, 種類)
SOURCES = [("bls-oews-m2025-metro", "bls-oesm25ma.zip", "oesm25ma/MSA_M2025_dl.xlsx", "2025-05", "metro")]
for y in (2024, 2023, 2022, 2021):
    yy = "%02d" % (y % 100)
    SOURCES.append(("bls-oews-m%d-national" % y, "bls-oesm%snat.zip" % yy, "oesm%snat/national_M%d_dl.xlsx" % (yy, y), "%d-05" % y, "national"))
    SOURCES.append(("bls-oews-m%d-state" % y, "bls-oesm%sst.zip" % yy, "oesm%sst/state_M%d_dl.xlsx" % (yy, y), "%d-05" % y, "state"))


def sha(path):
    b = open(path, "rb").read()
    return hashlib.sha256(b).hexdigest(), len(b)


def load(zfn, member):
    z = zipfile.ZipFile(os.path.join(RAW, zfn))
    assert z.testzip() is None
    names = {n.lower(): n for n in z.namelist()}
    member = names[member.lower()]
    wb = openpyxl.load_workbook(io.BytesIO(z.read(member)), read_only=True)
    ws = wb.worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    notes = {}
    for r in wb["Field Descriptions"].iter_rows(values_only=True):
        t = r[0]
        if isinstance(t, str):
            for sym in ("**", "*", "#", "~"):
                if t.startswith(sym + " ") and "=" in t and sym not in notes:
                    notes[sym] = t.strip()
                    break
    return member, ws.title, rows, notes


def cell(v):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return num(repr(v) if isinstance(v, float) else str(v))
    return None


def main():
    per_file = collections.defaultdict(list)
    stat = collections.Counter()
    emp = {}  # (period, kind, area, code, og) -> TOT_EMP
    info = {}
    wage_check = collections.Counter()
    notes_by_src = {}
    member_of = {}
    for src, zfn, member, period, kind in SOURCES:
        member, sheet, rows, notes = load(zfn, member)
        member_of[src] = member
        notes_by_src[src] = notes
        H = list(rows[0]); ix = {h: i for i, h in enumerate(H)}
        majors = {r[ix["OCC_CODE"]]: r[ix["OCC_TITLE"]] for r in rows[1:] if r[ix["O_GROUP"]] == "major"}
        url = URL % zfn.replace("bls-", "")
        for ln, r in enumerate(rows[1:], start=2):
            code = r[ix["OCC_CODE"]]
            if not (code.startswith("47-") or code in EXTRA):
                continue
            assert r[ix["NAICS"]] == "000000" and str(r[ix["OWN_CODE"]]) == "1235", (src, ln)
            area, og, at = str(r[ix["AREA"]]), r[ix["O_GROUP"]], str(r[ix["AREA_TYPE"]])
            if kind == "metro":
                assert at == "4", (src, ln, at)
                ps = r[ix["PRIM_STATE"]]
                geo = dict(geo_level="metro", geo_code=area, geo_name=US_STATES.get(US_STATE_ABBR.get(ps, ""), ""))
                out = "wage_bls_oews_metro_2025_%s.csv" % ("a" if int(area) < 30000 else "b")
            elif at == "1":
                geo = dict(geo_level="national", geo_code="US", geo_name="United States")
                out = "wage_bls_oews_%s.csv" % period[:4]
            else:
                assert at in ("2", "3"), (src, ln, at)  # 3 = 領土(グアム・プエルトリコ・ヴァージン諸島)。U1 と同じく state として持つ
                geo = dict(geo_level="state", geo_code=area, geo_name=US_STATES[area])
                out = "wage_bls_oews_%s.csv" % period[:4]
            base = dict(country="US", layer="wage", category=majors[code[:2] + "-0000"], item_name=r[ix["OCC_TITLE"]],
                        spec="SOC %s; O_GROUP %s; cross-industry (NAICS 000000); ownership 1235" % (code, og),
                        area_label=r[ix["AREA_TITLE"]], area_code=area, period=period, source_id=src,
                        source_page="%s row %d" % (sheet, ln), evidence_url=url, license="US-PD-17USC105", **geo)
            vals = {}
            for col, pb, unit, prse in METRICS:
                v = r[ix[col]]
                row = dict(base, obs_id=make_id(src, area, code, og, col), unit=unit, price_basis=pb,
                           currency="" if pb == "count" else "USD")
                nv = cell(v)
                notes_row = []
                if kind == "metro" and ps and "-" in str(r[ix["AREA_TITLE"]]).rsplit(",", 1)[-1]:
                    notes_row.append("複数の州にまたがる都市圏。geo_name は原本の PRIM_STATE(%s)の州" % ps)
                if nv is not None:
                    row.update(price=nv, price_status="public_domain")
                    vals[col] = float(nv)
                    if prse:
                        pv = cell(r[ix[prse]])
                        if pv is not None:
                            row.update(ref_value=pv, ref_note="%s (percent relative standard error, 原本の列 %s)" % (prse, prse))
                    stat["public_domain"] += 1
                else:
                    s = "" if v is None else str(v).strip()
                    if s in notes:
                        row.update(price="", price_status="not_set")
                        notes_row.append('OEWS の記号 "%s": %s' % (s, notes[s]))
                        stat["not_set:" + s] += 1
                    elif s == "":
                        row.update(price="", price_status="not_set")
                        notes_row.append("原本のセルが空欄")
                        stat["not_set:blank"] += 1
                    else:
                        raise SystemExit("想定外のセル: %s %s %s %r" % (src, ln, col, v))
                row["note"] = " / ".join(notes_row)
                per_file[out].append(row)
            emp[(period, kind, area, code, og)] = vals.get("TOT_EMP")
            info[(code, og)] = r[ix["OCC_TITLE"]]
            for h, a in (("H_MEAN", "A_MEAN"), ("H_PCT10", "A_PCT10"), ("H_PCT25", "A_PCT25"), ("H_MEDIAN", "A_MEDIAN"),
                         ("H_PCT75", "A_PCT75"), ("H_PCT90", "A_PCT90")):
                if h in vals and a in vals:
                    d = abs(vals[h] * 2080 - vals[a])
                    wage_check["pairs"] += 1
                    wage_check["within_15.4usd"] += d <= 15.4
                    wage_check["max_diff_x100"] = max(wage_check["max_diff_x100"], int(round(d * 100)))
        stat["rows_selected:" + src] = sum(1 for k in emp if k[0] == period and k[1] == kind)

    counts = {}
    for fn, rows in sorted(per_file.items()):
        counts[fn] = write_obs(os.path.join(OBS2, "observations", "us", fn), rows)

    # 照合 1: 都市圏(MSA、プエルトリコを除く)+ 非都市圏(BOS)の合計と全国(May 2025、U1 の全国ファイル)
    member, sheet, bos, bnotes = load("bls-oesm25ma.zip", "oesm25ma/BOS_M2025_dl.xlsx")
    Hb = list(bos[0]); ib = {h: i for i, h in enumerate(Hb)}
    bos_emp = collections.Counter(); bos_sup = collections.Counter()
    for r in bos[1:]:
        c = r[ib["OCC_CODE"]]
        if not (c.startswith("47-") or c in EXTRA or c == "00-0000") or r[ib["PRIM_STATE"]] == "PR":
            continue
        v = cell(r[ib["TOT_EMP"]])
        if v is None:
            bos_sup[(c, r[ib["O_GROUP"]])] += 1
        else:
            bos_emp[(c, r[ib["O_GROUP"]])] += float(v)
    _, _, nat25, _ = load("bls-oesm25nat.zip", "oesm25nat/national_M2025_dl.xlsx")
    Hn = list(nat25[0]); inn = {h: i for i, h in enumerate(Hn)}
    nat_emp = {(r[inn["OCC_CODE"]], r[inn["O_GROUP"]]): cell(r[inn["TOT_EMP"]]) for r in nat25[1:]}
    # MSA の PRIM_STATE を引くため、metro の行から地域の州を作る
    _, _, msa, _ = load("bls-oesm25ma.zip", "oesm25ma/MSA_M2025_dl.xlsx")
    Hm = list(msa[0]); im = {h: i for i, h in enumerate(Hm)}
    msa_emp = collections.Counter(); msa_sup = collections.Counter(); msa_n = collections.Counter()
    for r in msa[1:]:
        c = r[im["OCC_CODE"]]
        if not (c.startswith("47-") or c in EXTRA or c == "00-0000") or r[im["PRIM_STATE"]] == "PR":
            continue
        k = (c, r[im["O_GROUP"]]); msa_n[k] += 1
        v = cell(r[im["TOT_EMP"]])
        if v is None:
            msa_sup[k] += 1
        else:
            msa_emp[k] += float(v)
    chk = []
    for k in sorted(msa_n):
        nv = nat_emp.get(k)
        s = msa_emp[k] + bos_emp[k]
        chk.append(dict(check="msa_plus_bos_vs_national_2025", occ_code=k[0], o_group=k[1], title=info.get(k, ""),
                        parent=nv, sum_children=int(s), children_suppressed=msa_sup[k] + bos_sup[k], msa_areas=msa_n[k],
                        ratio=("%.4f" % (s / float(nv))) if nv else ""))
    # 照合 2: 過去年の全国と州(50 州 + DC)の合計
    terr = {"66", "72", "78"}
    for (period, kind, area, code, og), v in emp.items():
        if kind != "national":
            continue
        sub = [(a2, v2) for (p2, k2, a2, c2, o2), v2 in emp.items() if p2 == period and k2 == "state" and c2 == code and o2 == og]
        if not sub:
            continue
        s51 = sum(v2 for a2, v2 in sub if v2 is not None and a2 not in terr)
        sup = sum(1 for a2, v2 in sub if v2 is None)
        chk.append(dict(check="states51_vs_national_%s" % period[:4], occ_code=code, o_group=og, title=info.get((code, og), ""),
                        parent=v, sum_children=int(s51), children_suppressed=sup, msa_areas="",
                        ratio=("%.4f" % (s51 / v)) if v else ""))
    ck = os.path.join(OBS2, "reports", "US-C-bls-geo_oews_check.csv")
    with open(ck, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(chk[0].keys()), lineterminator="\n")
        w.writeheader(); w.writerows(chk)
    agg = collections.Counter()
    for c in chk:
        t = c["check"]
        agg[t + ":n"] += 1
        if c["ratio"]:
            agg[t + ":ratio_le_1.0005"] += float(c["ratio"]) <= 1.0005
        if c["ratio"] and c["children_suppressed"] == 0:
            r = float(c["ratio"])
            agg[t + ":no_suppression"] += 1
            agg[t + ":no_suppression_within_0.1pct"] += abs(r - 1) <= 0.001
            agg[t + ":no_suppression_within_1pct"] += abs(r - 1) <= 0.01
    # 時系列のつながり: 全国の各職業が 2021〜2025 の何年にあるか(2025 は U1 の全国ファイル)
    years = collections.defaultdict(set)
    for (period, kind, area, code, og) in emp:
        if kind == "national":
            years[(code, og)].add(period[:4])
    for k, v in nat_emp.items():
        if k[0].startswith("47-") or k[0] in EXTRA:
            years[k].add("2025")
    span = collections.Counter(len(v) for v in years.values())

    # 台帳
    for src, zfn, member, period, kind in SOURCES:
        h, b = sha(os.path.join(RAW, zfn))
        f = FETCH[zfn]
        led = collections.OrderedDict([
            ("source_id", src), ("country", "US"),
            ("title", "Occupational Employment and Wage Statistics (OEWS), May %s, %s (%s)" % (period[:4], {"metro": "metropolitan areas", "national": "national", "state": "state"}[kind], member_of[src].split("/")[-1])),
            ("publisher", "U.S. Bureau of Labor Statistics"), ("url", URL % zfn.replace("bls-", "")),
            ("landing", "https://www.bls.gov/oes/tables.htm"),
            ("retrieved_at", RETRIEVED), ("bytes", b), ("sha256", h), ("http_last_modified", f["lm"]), ("http_etag", f["etag"]),
            ("license", "US-PD-17USC105"), ("license_url", "https://www.bls.gov/opub/copyright-information.htm"),
            ("license_quote", LICENSE_QUOTE),
            ("attribution", "Source: U.S. Bureau of Labor Statistics, Occupational Employment and Wage Statistics, May %s (https://www.bls.gov/oes/)" % period[:4]),
            ("how_read", "zip の中の xlsx を openpyxl でセルごとに読む(%s の 1 枚目)。対象は SOC 47-xxxx の全行と %s、cross-industry(NAICS 000000)・"
                         "全所有形態(OWN_CODE 1235)。1 行の職業から TOT_EMP と時給・年収の平均と分位(10/25/50/75/90)の 13 観測。U1(May 2025 の全国・州)と"
                         "item_name / spec / unit の作り方を揃えた。記号 * ** # は値を入れず not_set、note にこのファイルの Field Descriptions の Notes の原文。"
                         "照合: 年収 = 時給 x 2080 の全組%s(reports/US-C-bls-geo_oews_check.csv)。"
                         % (member_of[src].split("/")[-1], ", ".join(EXTRA),
                            "、都市圏(プエルトリコを除く)と同じ zip の BOS(非都市圏)の雇用者数の合計を全国(May 2025)と" if kind == "metro"
                            else "、全国の雇用者数と 50 州 + DC の合計")),
            ("values_copied", True),
            ("fetched_via", "Apify web-fetch (formats=raw)" + ("; Range ヘッダで %d 回に分けて取得し連結(どの回も HTTP 206、同じ ETag、合計 bytes = Content-Range の全長、zip の CRC 検査済み)" % len(f["parts"]) if len(f["parts"]) > 1 else "")),
            ("parts", f["parts"]),
            ("published", f.get("published", "")), ("scope_quote", "May %s OEWS Estimates" % period[:4]),
            ("rows", sum(1 for fn, rows in per_file.items() for r in rows if r["source_id"] == src)),
        ])
        if kind == "metro":
            led["files"] = ["observations/us/wage_bls_oews_metro_2025_a.csv", "observations/us/wage_bls_oews_metro_2025_b.csv"]
            led["not_used"] = "BOS_M2025_dl.xlsx(非都市圏)は観測にせず、照合にだけ使った"
        json.dump(led, open(os.path.join(OBS2, "sources", src + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    allocc = [c for c in chk if c["occ_code"] == "00-0000"]
    print(json.dumps(dict(all_occupations_msa_bos=allocc, files=counts, stat=dict(stat), wage_x2080=dict(wage_check), checks=dict(agg),
                          national_years_span=dict(span)), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
