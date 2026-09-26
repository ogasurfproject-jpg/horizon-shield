# -*- coding: utf-8 -*-
"""
2022 Economic Census, Construction (NAICS 23): Summary Statistics for the U.S., States, and Selected Geographies: 2022
(表 EC2223BASIC、https://www2.census.gov/programs-surveys/economic-census/data/2022/sector23/EC2223BASIC.zip)を読み、
observations/us/spending_census_econ2022_construction.csv と sources/census-econ2022-ec2223basic.json を作る。

原本: zip の中の EC2223BASIC.dat(| 区切り、1 行目が見出し #GEOTYPE|ST|...)、EC2223BASIC_FIELDS.txt(欄の名前・意味・型)。
  GEOTYPE 01 = United States、02 = 州(50 州 + DC)、11 = Census Region(4)。NAICS2022 は 23 から 6 桁まで(INDLEVEL 2〜6)。
  金額の欄は $1,000(FIELDS.txt の Label に "($1,000)")。値の欄の隣に _F(flag)欄があり、flag が入ったセルは値の欄が 0 になっている
  (公表されていない)。flag の入ったセルは price 空・not_set とし、flag の文字を note に書く。
取り込む欄(19): FIRM, ESTAB, EMP, PAYANN, PAYANCW, HOURS, BENEFIT, RCPTOT, RCPCWRK, RCPCGDL, FEDDL, CSLDL, PRIDL, RCPCCNDL, RCPNCW,
  CSTCMT, CSTMPRT, CSTSCNT, VALADD。その他の欄(四半期別の人数、在庫、資産、賃借料、細目の経費、補完率の範囲)は取り込まない。
照合(全数): 州 51 の和 = US(両方に flag の無いセル)、州の和 = Region、NAICS の親 = 子の和(同じ地域で親子とも flag 無しのとき)、
  RCPCWRK = RCPCGDL + PRIDL、RCPCGDL = FEDDL + CSLDL、RCPNCW = RCPCWRK - CSTSCNT(いずれも flag 無しのとき)。
"""
import csv, io, os, sys, json, zipfile, hashlib, collections

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from obs_common import make_id, num, write_obs, US_STATES

SID = "census-econ2022-ec2223basic"
ZIP = os.path.join(ROOT, "raw", SID + ".zip")
URL = "https://www2.census.gov/programs-surveys/economic-census/data/2022/sector23/EC2223BASIC.zip"
OUT = os.path.join(ROOT, "observations", "us", "spending_census_econ2022_construction.csv")
LIC = "US-PD-17USC105"
CATEGORY = "Construction: Summary Statistics for the U.S., States, and Selected Geographies: 2022 (EC2223BASIC)"
VARS = ["FIRM", "ESTAB", "EMP", "PAYANN", "PAYANCW", "HOURS", "BENEFIT", "RCPTOT", "RCPCWRK", "RCPCGDL", "FEDDL", "CSLDL",
        "PRIDL", "RCPCCNDL", "RCPNCW", "CSTCMT", "CSTMPRT", "CSTSCNT", "VALADD"]
COUNT_UNIT = {"FIRM": "firms", "ESTAB": "establishments", "EMP": "employees", "HOURS": "1,000 hours"}
REGION = {"1": ("R1", "Northeast Region"), "2": ("R2", "Midwest Region"), "3": ("R3", "South Region"), "4": ("R4", "West Region")}


def load():
    z = zipfile.ZipFile(ZIP)
    assert z.testzip() is None
    dat = z.read("EC2223BASIC.dat").decode("latin-1")
    fields = z.read("EC2223BASIC_FIELDS.txt").decode("latin-1")
    lab = {}
    for r in csv.DictReader(io.StringIO(fields), delimiter="|"):
        lab[r["Field_Name"]] = r["Label"]
    rows = list(csv.reader(io.StringIO(dat), delimiter="|"))
    head = rows[0]
    head[0] = head[0].lstrip("#")
    recs = [dict(zip(head, r)) for r in rows[1:] if r]
    return lab, recs, z


def main():
    lab, recs, z = load()
    obs = []
    stat = collections.Counter()
    val = {}
    for r in recs:
        gt = r["GEOTYPE"]
        if gt == "01":
            geo = dict(geo_level="national", geo_code="US", geo_name="United States", gkey="US")
        elif gt == "02":
            assert r["ST"] in US_STATES
            geo = dict(geo_level="state", geo_code=r["ST"], geo_name=US_STATES[r["ST"]], gkey=r["ST"])
        elif gt == "11":
            code, name = REGION[r["CENREG"]]
            geo = dict(geo_level="census_region", geo_code=code, geo_name=name, gkey=code)
        else:
            raise SystemExit("unknown GEOTYPE %r" % gt)
        naics = r["NAICS2022"]
        for v in VARS:
            flag = r[v + "_F"]
            raw = r[v]
            oid = make_id(SID, r["GEO_ID"], naics, v)
            row = {
                "obs_id": oid, "country": "US", "layer": "spending", "category": CATEGORY,
                "item_name": r["NAICS2022_LABEL"],
                "spec": "NAICS2022 %s; %s: %s" % (naics, v, lab[v]),
                "unit": COUNT_UNIT.get(v, "USD thousand"),
                "geo_level": geo["geo_level"], "geo_code": geo["geo_code"], "geo_name": geo["geo_name"],
                "area_label": r["GEO_LABEL"], "area_code": r["GEO_ID"],
                "currency": "" if v in COUNT_UNIT else "USD",
                "price_basis": "count" if v in COUNT_UNIT else "annual_total_thousand_usd",
                "period": "2022", "source_id": SID, "source_page": "EC2223BASIC.dat", "evidence_url": URL, "license": LIC,
            }
            if flag:
                row.update(price="", price_status="not_set",
                           note="原本の値の欄は %s、flag %r(公表されていない。flag の意味はこのファイルに無い)。INDLEVEL %s" % (raw, flag, r["INDLEVEL"]))
                stat["not_set:" + flag] += 1
            else:
                p = num(raw)
                if float(p) == 0 and v not in COUNT_UNIT:
                    # 金額の 0 は検査器が annual_total_thousand_usd の 0 を値として受けないため not_set
                    row.update(price="", price_status="not_set", ref_value="0", ref_note="原本の値(0)",
                               note="原本の値は 0(flag なし)。INDLEVEL %s" % r["INDLEVEL"])
                    stat["not_set:zero"] += 1
                else:
                    row.update(price=p, price_status="public_domain", note="INDLEVEL %s" % r["INDLEVEL"])
                    stat["public_domain"] += 1
                val[(geo["gkey"], naics, v)] = int(raw)
            obs.append(row)
    obs.sort(key=lambda o: (o["geo_level"] != "national", o["geo_level"], o["geo_code"], o["spec"]))
    write_obs(OUT, obs)
    checks = collections.OrderedDict()
    checks["records"] = len(recs)
    checks["records_by_geotype"] = dict(collections.Counter(r["GEOTYPE"] for r in recs))
    checks["rows"] = len(obs)
    checks["status"] = dict(stat)
    naics_all = sorted({r["NAICS2022"] for r in recs})
    states = sorted({r["ST"] for r in recs if r["GEOTYPE"] == "02"})
    ADD = [v for v in VARS if v != "FIRM"]  # 企業数は州・業種をまたぐため足し算にならない(照合から外す)
    # (1) 州の和 = US
    c = collections.Counter()
    worst = []
    for n in naics_all:
        for v in ADD:
            if ("US", n, v) not in val:
                continue
            parts = [val.get((s, n, v)) for s in states]
            if any(p is None for p in parts):
                c["skipped_state_flagged"] += 1
                continue
            d = sum(parts) - val[("US", n, v)]
            c["compared"] += 1
            c["exact"] += d == 0
            if d != 0:
                worst.append((abs(d), n, v, d))
    worst.sort(reverse=True)
    checks["states_sum_vs_US"] = dict(c, largest_diffs=worst[:10])
    # (2) 州の和 = Region
    c = collections.Counter()
    wr = []
    reg_of = {r["ST"]: REGION[r["CENREG"]][0] for r in recs if r["GEOTYPE"] == "02"}
    for code, _ in REGION.values():
        mem = [s for s in states if reg_of[s] == code]
        for n in naics_all:
            for v in ADD:
                if (code, n, v) not in val:
                    continue
                parts = [val.get((s, n, v)) for s in mem]
                if any(p is None for p in parts):
                    c["skipped"] += 1
                    continue
                d = sum(parts) - val[(code, n, v)]
                c["compared"] += 1
                c["exact"] += d == 0
                if d:
                    wr.append((abs(d), code, n, v, d))
    wr.sort(reverse=True)
    checks["states_sum_vs_region"] = dict(c, largest_diffs=wr[:10])
    # (3) NAICS の親 = 子の和
    children = collections.defaultdict(list)
    for n in naics_all:
        for m in naics_all:
            if len(m) == len(n) + 1 and m.startswith(n):
                children[n].append(m)
    c = collections.Counter()
    wn = []
    geos = sorted({k[0] for k in val})
    for g in geos:
        for n, ch in children.items():
            for v in ADD:
                if (g, n, v) not in val:
                    continue
                parts = [val.get((g, m, v)) for m in ch]
                if any(p is None for p in parts):
                    # 子のどれかが flag つき、またはその地域に子の行が無い
                    c["skipped"] += 1
                    continue
                d = sum(parts) - val[(g, n, v)]
                c["compared"] += 1
                c["exact"] += d == 0
                if d:
                    wn.append((abs(d), g, n, v, d))
    wn.sort(reverse=True)
    checks["naics_parent_vs_children"] = dict(c, largest_diffs=wn[:10])
    # (4) 欄どうしの恒等式
    idn = collections.Counter()
    wi = []
    for (g, n, v), x in list(val.items()):
        if v != "RCPCWRK":
            continue
        for name, lhs, rhs in (("RCPCWRK=RCPCGDL+PRIDL", ("RCPCWRK",), ("RCPCGDL", "PRIDL")),
                               ("RCPCGDL=FEDDL+CSLDL", ("RCPCGDL",), ("FEDDL", "CSLDL")),
                               ("RCPNCW=RCPCWRK-CSTSCNT", ("RCPNCW", "CSTSCNT"), ("RCPCWRK",))):
            a = [val.get((g, n, k)) for k in lhs]
            b = [val.get((g, n, k)) for k in rhs]
            if any(p is None for p in a + b):
                idn[name + ":skipped"] += 1
                continue
            d = sum(a) - sum(b)
            idn[name + ":compared"] += 1
            idn[name + ":exact"] += d == 0
            if d:
                wi.append((abs(d), name, g, n, d))
    wi.sort(reverse=True)
    checks["identities"] = dict(idn, largest_diffs=wi[:10])
    json.dump(checks, open(os.path.join(ROOT, "tools", "parsers", "out", "census_econ2022_checks.json"), "w"),
              ensure_ascii=False, indent=1)
    print(json.dumps(checks, ensure_ascii=False, indent=1))
    inner = {i.filename: {"bytes": i.file_size, "sha256": hashlib.sha256(z.read(i.filename)).hexdigest()} for i in z.infolist()}
    b = open(ZIP, "rb").read()
    su, sr, sn, idn = checks["states_sum_vs_US"], checks["states_sum_vs_region"], checks["naics_parent_vs_children"], checks["identities"]
    led = collections.OrderedDict([
        ("source_id", SID), ("country", "US"),
        ("title", "2022 Economic Census, Construction: Summary Statistics for the U.S., States, and Selected Geographies: 2022 (EC2223BASIC)"),
        ("publisher", "U.S. Census Bureau (Economic Census)"),
        ("url", URL), ("landing", "https://www.census.gov/data/tables/2022/econ/economic-census/naics-sector-23.html"),
        ("table_notes", "https://data.census.gov/table/ECNBASIC2022.EC2223BASIC"),
        ("retrieved_at", "2026-09-26"), ("published", "2024-12-05"),
        ("http_last_modified", "Thu, 05 Dec 2024 12:00:03 GMT"),
        ("bytes", len(b)), ("sha256", hashlib.sha256(b).hexdigest()), ("inner_files", inner),
        ("fetched_via", "Apify apify/web-fetch(formats raw、Content-Type application/zip を base64 で受け取り)。bytes が contentLength と一致、先頭 PK、zip の testzip 正常。"
                        "Census Data API(api.census.gov/data/2022/ecnbasic)は鍵なしの要求に Missing Key の頁を返したため使っていない"),
        ("license", LIC), ("license_url", "https://www.law.cornell.edu/uscode/text/17/105"),
        ("license_quote", json.load(open(os.path.join(ROOT, "sources", "census-bps-st2025a.json")))["license_quote"]),
        ("attribution", "Source: U.S. Census Bureau, \"Construction: Summary Statistics for the U.S., States, and Selected Geographies: 2022,\" 2022 Economic Census, Table EC2223BASIC, %s, accessed on September 26, 2026" % URL),
        ("scope_quote", "This file package includes a data file and companion file with important metadata information. Table Notes for this table can be found on data.census.gov at: https://data.census.gov/table/ECNBASIC2022.EC2223BASIC (EC2223BASIC_README.txt)"),
        ("how_read", "tools/parsers/parse_census_econ2022.py。EC2223BASIC.dat を | 区切りで読み、欄の意味は EC2223BASIC_FIELDS.txt の Label をそのまま spec に。"
                     "4,070 行(US 73、Region 292、州 3,705。NAICS 23 から 6 桁まで)x 19 欄 = %d 行。金額は $1,000(price_basis annual_total_thousand_usd)、"
                     "件数は count。_F の flag が入ったセルは値の欄が 0 で公表されていないので not_set(flag D %d、EMP の flag a/b/c/e/f/g %d)。"
                     "flag の無い金額の 0(%d)は検査器が 0 を値として受けないため not_set・ref_value 0。"
                     "照合(企業数 FIRM は州・業種をまたぐため外した): 州 51 の和 = US は比較できた %d 組すべて一致(州に flag があり比べなかった組 %d)。"
                     "州の和 = Region は %d 組すべて一致。NAICS の親 = 子の和は %d 組すべて一致。"
                     "RCPCWRK = RCPCGDL + PRIDL は %d 組、RCPCGDL = FEDDL + CSLDL は %d 組、RCPNCW = RCPCWRK - CSTSCNT は %d 組、すべて一致。"
                     % (checks["rows"], checks["status"].get("not_set:D", 0),
                        sum(v for k, v in checks["status"].items() if k.startswith("not_set:") and len(k) == 9 and k[-1] in "abcefg"),
                        checks["status"].get("not_set:zero", 0), su["compared"], su["skipped_state_flagged"], sr["compared"], sn["compared"],
                        idn["RCPCWRK=RCPCGDL+PRIDL:compared"], idn["RCPCGDL=FEDDL+CSLDL:compared"], idn["RCPNCW=RCPCWRK-CSTSCNT:compared"])),
        ("values_copied", True),
    ])
    json.dump(led, open(os.path.join(ROOT, "sources", SID + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return checks, inner


if __name__ == "__main__":
    main()
