# -*- coding: utf-8 -*-
"""
US-C-bls-geo: BLS 四半期雇用賃金センサス(QCEW)の年平均、建設業(NAICS 23 とその下位)を観測層 v2 に入れる。

入力(OBS2/raw、2026-09-26 に Apify web-fetch formats=raw、Range ヘッダで取得):
  - bls-qcew-<年>-annual-by-industry.zip.cd.bin   https://data.bls.gov/cew/data/files/<年>/csv/<年>_annual_by_industry.zip の末尾 600,000 bytes
      (zip の中央ディレクトリ。全メンバーの名前・CRC32・圧縮後の大きさ・位置が入っている)
  - bls-qcew-<年>-annual-by-industry.zip.seg.bin  同じ zip の、建設業のメンバー(名前が "<年>.annual 23..." の 92 本)が並ぶ区間
      (Range で 1〜2 回に分けて取り、連結した。どの回も HTTP 206、同じ ETag、Content-Range の全長が同じ)
  - bls-qcew-fetch-manifest.json  取得したときの Content-Range / ETag / Last-Modified / 各回の sha256
  - bls-qcew-api-2024-a-industry-23.csv  https://data.bls.gov/cew/data/api/2024/a/industry/23.csv(照合用。同じ値の別の組版)
  - bls-qcew-annual-layout.htm / bls-qcew-questions-and-answers.htm(disclosure_code の意味の原文)
  zip 全体(約 1.2〜1.6 億 bytes)は取っていない。各メンバーは中央ディレクトリの CRC32 と展開後の大きさで照合する。

出力:
  - observations/us/wage_bls_qcew_<年>.csv(2016〜2025、年ごと)
  - sources/bls-qcew-<年>-annual.json
  - reports/US-C-bls-geo_qcew_check.csv(郡の合計と州、州の合計と全国)
対象: 所有区分 own_code 5(Private)だけ。NAICS 23 の業種ファイルには合計の所有区分(own_code 0)の行が無い(1/2/3/5 だけ)。
  - 2 桁(23)と 3 桁(236 / 237 / 238): 全国・州・郡(agglvl の頭 1 / 5 / 7)
  - 4〜6 桁: 全国・州だけ(郡まで入れると 1 年で数十万行になるため。原本 raw には郡の行も入っている)
  - MSA の行(agglvl 44〜48、area_fips が C####。2016〜2024 のファイルにだけある)は入れない(範囲外。数だけ数える)
1 行から 4 観測: 事業所数(annual_avg_estabs_count)、雇用者数(annual_avg_emplvl)、週平均賃金(annual_avg_wkly_wage)、
  年平均給与(avg_annual_pay)。disclosure_code "N" の行は、事業所数だけ値を入れ、他の 3 つは not_set
  (原本は 0 で埋めてある。Q&A の原文を note に)。
"""
import csv, collections, hashlib, io, json, os, re, struct, sys, zlib
HERE = os.path.dirname(os.path.abspath(__file__))
OBS2 = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(OBS2, "tools"))
from obs_common import make_id, num, write_obs, US_STATES

RAW = os.path.join(OBS2, "raw")
RETRIEVED = "2026-09-26"
YEARS = list(range(2016, 2026))
ZIP_URL = "https://data.bls.gov/cew/data/files/%d/csv/%d_annual_by_industry.zip"
API_URL = "https://data.bls.gov/cew/data/api/2024/a/industry/23.csv"
LAYOUT_URL = "https://www.bls.gov/cew/about-data/downloadable-file-layouts/annual/naics-based-annual-layout.htm"
QA_URL = "https://www.bls.gov/cew/questions-and-answers.htm"
LICENSE_QUOTE = ("The Bureau of Labor Statistics (BLS) is a Federal government agency and everything that we publish, "
                 "both in hard copy and electronically, is in the public domain, except for previously copyrighted photographs "
                 "and illustrations. You are free to use our public domain material without specific permission, although we do "
                 "ask that you cite the Bureau of Labor Statistics as the source.")
LICENSE_URL = "https://www.bls.gov/opub/copyright-information.htm"
# disclosure_code の意味(原文。layout の頁と Q&A の頁)
Q_LAYOUT_DC = "1-character disclosure code (either ' '(blank) or 'N' not disclosed)"
Q_QA_N = ("Suppressed data fields are published with an \"N\" in the disclosure code field. Only establishment counts are disclosed "
          "for these cells, based on approval from this Federal Register Notice , while all other data items for the cell are "
          "suppressed (zero-filled).")
Q_QA_DASH = "A dash \"-\" means the macro cell field (data point combining area/ownership/industry) does not exist for that specific quarter and year."
METRICS = [  # (列, price_basis, 単位, 分類)
    ("annual_avg_estabs_count", "count", "establishments (annual average of quarterly counts)", "estabs"),
    ("annual_avg_emplvl", "count", "persons (annual average of monthly employment)", "emp"),
    ("annual_avg_wkly_wage", "wage_weekly_mean", "USD/week", "wage"),
    ("avg_annual_pay", "wage_annual_mean", "USD/year", "wage"),
]
DEFS = {  # layout の頁の定義の原文(ref_note ではなく how_read に使う)
    "annual_avg_estabs_count": "Annual average of quarterly establishment counts for a given year",
    "annual_avg_emplvl": "Annual average of monthly employment levels for a given year",
    "annual_avg_wkly_wage": "Average weekly wage based on the 12-monthly employment levels and total annual wage levels.",
    "avg_annual_pay": "Average annual pay based on employment and wage levels for a given year.",
    "total_annual_wages": "Sum of the four quarterly total wage levels for a given year",
}
MEMBER_RE = re.compile(r"/(\d{4})\.annual (23\d*) ")


def sha_bytes(b):
    return hashlib.sha256(b).hexdigest()


def parse_cd(tail, tail_start):
    i = tail.rfind(b"PK\x05\x06")
    assert i >= 0, "中央ディレクトリの終わりが無い"
    _, _, _, _, n_tot, cd_size, cd_off, _ = struct.unpack("<IHHHHIIH", tail[i:i + 22])
    assert cd_off != 0xFFFFFFFF, "zip64 は想定外"
    p = cd_off - tail_start
    assert p >= 0, "中央ディレクトリが取得した末尾に入っていない"
    ents = []
    for _ in range(n_tot):
        h = struct.unpack("<IHHHHHHIIIHHHHHII", tail[p:p + 46])
        assert h[0] == 0x02014b50
        name = tail[p + 46:p + 46 + h[10]].decode("utf-8")
        ents.append(dict(name=name, method=h[4], crc=h[7], csize=h[8], usize=h[9], lho=h[16]))
        p += 46 + h[10] + h[11] + h[12]
    return ents, n_tot


def extract_members(year, man):
    tail = open(os.path.join(RAW, "bls-qcew-%d-annual-by-industry.zip.cd.bin" % year), "rb").read()
    seg = open(os.path.join(RAW, "bls-qcew-%d-annual-by-industry.zip.seg.bin" % year), "rb").read()
    m = man[str(year)]
    t0 = int(re.match(r"bytes (\d+)-", m["tail"]["cr"]).group(1))
    s0 = int(re.match(r"bytes (\d+)-", m["parts"][0]["cr"]).group(1))
    assert sha_bytes(tail) == m["tail"]["sha256"] and sha_bytes(seg) == m["seg_sha256"]
    ents, n_all = parse_cd(tail, t0)
    out = collections.OrderedDict()
    for e in ents:
        mm = MEMBER_RE.search(e["name"])
        if not mm:
            continue
        assert int(mm.group(1)) == year
        p = e["lho"] - s0
        h = struct.unpack("<IHHHHHIIIHH", seg[p:p + 30])
        assert h[0] == 0x04034b50, e["name"]
        d0 = p + 30 + h[9] + h[10]
        comp = seg[d0:d0 + e["csize"]]
        assert len(comp) == e["csize"], "区間が足りない: " + e["name"]
        data = zlib.decompress(comp, -15) if e["method"] == 8 else comp
        assert len(data) == e["usize"] and (zlib.crc32(data) & 0xFFFFFFFF) == e["crc"], "CRC 不一致: " + e["name"]
        out[e["name"]] = dict(code=mm.group(2), data=data, crc="%08x" % e["crc"], usize=e["usize"], csize=e["csize"],
                              sha256=sha_bytes(data))
    return out, n_all


def geo_of(r):
    a, lvl = r["area_fips"], r["agglvl_code"][0]
    if lvl == "4":
        assert a.startswith("C"), a
        return None  # MSA(QCEW の C#### コード)。この取り込みの範囲外(2016〜2024 のファイルにだけある)
    if a == "US000":
        assert lvl == "1"
        return dict(geo_level="national", geo_code="US", geo_name="United States")
    if a.endswith("000"):
        assert lvl == "5", a
        return dict(geo_level="state", geo_code=a[:2], geo_name=US_STATES[a[:2]])
    assert lvl == "7" and re.match(r"^\d{5}$", a), a
    return dict(geo_level="county", geo_code=a, geo_name=US_STATES[a[:2]])


def main():
    man = json.load(open(os.path.join(RAW, "bls-qcew-fetch-manifest.json"), encoding="utf-8"))
    checks = []
    summary = {}
    api_cmp = collections.Counter()
    arith = collections.Counter()
    for year in YEARS:
        src = "bls-qcew-%d-annual" % year
        url = ZIP_URL % (year, year)
        members, n_all = extract_members(year, man)
        rows, stat = [], collections.Counter()
        parent3 = {}
        tables = {}
        for name, mb in members.items():
            code = mb["code"]
            rd = list(csv.DictReader(io.StringIO(mb["data"].decode("utf-8"))))
            tables[code] = rd
            if len(code) <= 3:
                parent3[code] = rd[0]["industry_title"]
        for name, mb in members.items():
            code = mb["code"]
            mshort = name.split("/")[-1]
            category = parent3.get(code[:3], parent3["23"]) if len(code) >= 3 else parent3["23"]
            for ln, r in enumerate(tables[code], start=2):
                assert r["industry_code"] == code and r["year"] == str(year) and r["qtr"] == "A" and r["size_code"] == "0"
                if r["own_code"] != "5":
                    stat["skip_own_%s" % r["own_code"]] += 1
                    continue
                g = geo_of(r)
                if g is None:
                    stat["skip_msa"] += 1
                    continue
                if len(code) >= 4 and g["geo_level"] == "county":
                    stat["skip_county_4to6digit"] += 1
                    continue
                dc = r["disclosure_code"].strip()
                assert dc in ("", "N"), dc
                base = dict(country="US", layer="wage", category=category, item_name=r["industry_title"],
                            spec="NAICS %s; own_code 5 %s; agglvl_code %s" % (code, r["own_title"], r["agglvl_code"]),
                            area_label=r["area_title"], area_code=r["area_fips"], period=str(year), source_id=src,
                            source_page="%s row %d" % (mshort, ln), evidence_url=url, license="US-PD-17USC105", **g)
                extra_note = ""
                if g["geo_level"] == "county" and r["area_fips"].endswith("999"):
                    extra_note = "郡に割り当てられない州内の事業所の行(原本の area_title のとおり)。郡の合計を州と比べるときはこの行も足す"
                for col, pb, unit, kind in METRICS:
                    v = r[col].strip()
                    row = dict(base, obs_id=make_id(src, r["area_fips"], "5", code, col), unit=unit, price_basis=pb,
                               currency="" if pb == "count" else "USD")
                    notes = []
                    if v == "-":
                        row.update(price="", price_status="not_set")
                        notes.append('原本の値が "-": ' + Q_QA_DASH)
                        stat["not_set_dash"] += 1
                    elif dc == "N" and kind != "estabs":
                        row.update(price="", price_status="not_set")
                        notes.append('disclosure_code "N"(%s)。%s 原本のこの欄は 0' % (Q_LAYOUT_DC, Q_QA_N))
                        stat["not_set_N"] += 1
                    elif kind == "wage" and num(v) == "0":
                        row.update(price="", price_status="not_set")
                        notes.append("原本の値が 0(雇用者数 %s)。賃金の 0 は値として扱わない" % r["annual_avg_emplvl"])
                        stat["not_set_wage0"] += 1
                    else:
                        row.update(price=num(v), price_status="public_domain")
                        stat["public_domain"] += 1
                        if kind == "estabs" and dc == "N":
                            notes.append('disclosure_code "N" の行。事業所数だけは公表される(%s)' % Q_QA_N)
                    if extra_note:
                        notes.append(extra_note)
                    row["note"] = " / ".join(notes)
                    rows.append(row)
                # 別の読み方: 年平均給与 = total_annual_wages / 年平均雇用者数、週平均賃金 = 同 / 52。
                # 原本の annual_avg_emplvl は整数に丸めてあるので、雇用者数を em +- 0.5 の幅で割った区間(+- 1 ドル)に入るかを見る
                if dc == "" and num(r["annual_avg_emplvl"]) != "0":
                    tw, em = float(r["total_annual_wages"]), float(r["annual_avg_emplvl"])
                    lo, hi = tw / (em + 0.5), tw / max(em - 0.5, 0.5)
                    pay, wk = float(r["avg_annual_pay"]), float(r["annual_avg_wkly_wage"])
                    arith["rows"] += 1
                    arith["pay_in_interval"] += lo - 1 <= pay <= hi + 1
                    arith["wkly_in_interval"] += lo / 52 - 1 <= wk <= hi / 52 + 1
                    if em >= 1000:
                        arith["rows_emp_ge_1000"] += 1
                        arith["emp_ge_1000_max_pay_diff_x100"] = max(arith["emp_ge_1000_max_pay_diff_x100"], int(round(abs(tw / em - pay) * 100)))
                        arith["emp_ge_1000_max_wkly_diff_x100"] = max(arith["emp_ge_1000_max_wkly_diff_x100"], int(round(abs(tw / em / 52 - wk) * 100)))
        out = os.path.join(OBS2, "observations", "us", "wage_bls_qcew_%d.csv" % year)
        n = write_obs(out, rows)

        # 照合 1: 郡の合計(xx999 を含む)と州。照合 2: 州(50 州 + DC)の合計と全国。どちらも private、建設の全業種ファイル
        for code, rd in tables.items():
            priv = [r for r in rd if r["own_code"] == "5"]
            by_state = collections.defaultdict(list)
            st_row, us_row = {}, None
            for r in priv:
                a = r["area_fips"]
                if r["agglvl_code"][0] == "4":
                    continue
                if a == "US000":
                    us_row = r
                elif a.endswith("000"):
                    st_row[a[:2]] = r
                else:
                    by_state[a[:2]].append(r)
            for s, sr in sorted(st_row.items()):
                cs = by_state.get(s, [])
                if not cs:
                    continue
                nN = sum(1 for r in cs if r["disclosure_code"] == "N")
                se = sum(int(r["annual_avg_estabs_count"]) for r in cs)
                sm = sum(int(r["annual_avg_emplvl"]) for r in cs if r["disclosure_code"] != "N")
                sw = sum(int(r["total_annual_wages"]) for r in cs if r["disclosure_code"] != "N")
                checks.append(dict(year=year, naics=code, level="county_vs_state", area=s, parent_disclosure=sr["disclosure_code"],
                                   children=len(cs), children_N=nN, parent_estabs=sr["annual_avg_estabs_count"], sum_estabs=se,
                                   parent_emplvl=sr["annual_avg_emplvl"], sum_emplvl_disclosed=sm,
                                   parent_total_wages=sr["total_annual_wages"], sum_total_wages_disclosed=sw))
            if us_row is not None:
                ss = [r for s, r in st_row.items() if s not in ("72", "78")]
                nN = sum(1 for r in ss if r["disclosure_code"] == "N")
                checks.append(dict(year=year, naics=code, level="states51_vs_national", area="US", parent_disclosure=us_row["disclosure_code"],
                                   children=len(ss), children_N=nN, parent_estabs=us_row["annual_avg_estabs_count"],
                                   sum_estabs=sum(int(r["annual_avg_estabs_count"]) for r in ss),
                                   parent_emplvl=us_row["annual_avg_emplvl"],
                                   sum_emplvl_disclosed=sum(int(r["annual_avg_emplvl"]) for r in ss if r["disclosure_code"] != "N"),
                                   parent_total_wages=us_row["total_annual_wages"],
                                   sum_total_wages_disclosed=sum(int(r["total_annual_wages"]) for r in ss if r["disclosure_code"] != "N")))
        # 照合 3(2024 だけ): API の 23.csv と zip のメンバー 23 を全行で突き合わせる
        if year == 2024:
            api = list(csv.DictReader(open(os.path.join(RAW, "bls-qcew-api-2024-a-industry-23.csv"), encoding="utf-8", newline="")))
            zz = {(r["area_fips"], r["own_code"]): r for r in tables["23"]}
            pairs = [("annual_avg_estabs", "annual_avg_estabs_count"), ("annual_avg_emplvl", "annual_avg_emplvl"),
                     ("total_annual_wages", "total_annual_wages"), ("annual_avg_wkly_wage", "annual_avg_wkly_wage"),
                     ("avg_annual_pay", "avg_annual_pay"), ("disclosure_code", "disclosure_code")]
            api_cmp["api_rows"] = len(api); api_cmp["zip_rows"] = len(zz)
            for r in api:
                z = zz.get((r["area_fips"], r["own_code"]))
                if z is None:
                    api_cmp["api_only"] += 1
                    continue
                api_cmp["matched_rows"] += 1
                api_cmp["rows_all_equal"] += all(r[a].strip() == z[b].strip() for a, b in pairs)
            api_cmp["api_only_msa_rows"] = sum(1 for r in api if r["area_fips"].startswith("C"))

        # 台帳
        m = man[str(year)]
        mem_list = [dict(name=k.split("/")[-1], crc32=v["crc"], uncompressed_bytes=v["usize"], sha256=v["sha256"])
                    for k, v in members.items()]
        aux = []
        if year == 2024:
            for fn, u in (("bls-qcew-api-2024-a-industry-23.csv", API_URL),):
                b = open(os.path.join(RAW, fn), "rb").read()
                aux.append(dict(path="raw/" + fn, url=u, bytes=len(b), sha256=sha_bytes(b), http_last_modified=man["aux"]["parts/api_2024_a_industry_23.csv"]["lm"],
                                etag=man["aux"]["parts/api_2024_a_industry_23.csv"]["etag"], role="照合用(同じ値の別の組版)"))
        for fn, u in (("bls-qcew-annual-layout.htm", LAYOUT_URL), ("bls-qcew-questions-and-answers.htm", QA_URL)):
            b = open(os.path.join(RAW, fn), "rb").read()
            aux.append(dict(path="raw/" + fn, url=u, bytes=len(b), sha256=sha_bytes(b), role="disclosure_code と各列の定義の原文"))
        tot = int(re.search(r"/(\d+)$", m["tail"]["cr"]).group(1))
        led = collections.OrderedDict([
            ("source_id", src), ("country", "US"),
            ("title", "Quarterly Census of Employment and Wages (QCEW), %d annual averages by industry (CSV), NAICS 23 Construction and sub-industries" % year),
            ("publisher", "U.S. Bureau of Labor Statistics"), ("url", url),
            ("landing", "https://www.bls.gov/cew/downloadable-data-files.htm"),
            ("retrieved_at", RETRIEVED),
            ("bytes", m["seg_bytes"]), ("sha256", m["seg_sha256"]),
            ("sha256_of", "raw/bls-qcew-%d-annual-by-industry.zip.seg.bin(zip のうち建設業のメンバーが並ぶ区間の bytes。zip 全体の sha256 は、全体を取っていないので無い)" % year),
            ("zip_total_bytes", tot), ("http_etag", m["tail"]["etag"]), ("http_last_modified", m["tail"]["lm"]),
            ("ranges", [dict(content_range=m["tail"]["cr"], bytes=m["tail"]["bytes"], sha256=m["tail"]["sha256"],
                             raw="raw/bls-qcew-%d-annual-by-industry.zip.cd.bin" % year, role="中央ディレクトリ")] +
                       [dict(content_range=p["cr"], bytes=p["bytes"], sha256=p["sha256"], http_status=p["status"],
                             raw="raw/bls-qcew-%d-annual-by-industry.zip.seg.bin" % year, role="建設業のメンバーの区間(連結)") for p in m["parts"]]),
            ("zip_members_total", n_all), ("members_used", mem_list),
            ("license", "US-PD-17USC105"), ("license_url", LICENSE_URL), ("license_quote", LICENSE_QUOTE),
            ("attribution", "Source: U.S. Bureau of Labor Statistics, Quarterly Census of Employment and Wages (https://www.bls.gov/cew/)"),
            ("how_read", "zip 全体ではなく、Range ヘッダで末尾(中央ディレクトリ)と建設業のメンバー 92 本の区間だけを取った。中央ディレクトリから各メンバーの位置・"
                         "圧縮後の大きさ・CRC32 を読み、区間から deflate を展開して、展開後の大きさと CRC32 が中央ディレクトリと一致することを全メンバーで確かめた。"
                         "各メンバーの CSV をそのまま読む(列の定義は layout の頁: %s)。所有区分は own_code 5(Private)だけ(建設の業種ファイルに own_code 0 の合計行は無い)。"
                         "2 桁と 3 桁(23, 236, 237, 238)は全国・州・郡、4〜6 桁は全国・州。1 行から事業所数・雇用者数(count)、週平均賃金(wage_weekly_mean)、"
                         "年平均給与(wage_annual_mean)の 4 観測。disclosure_code N の行は事業所数だけ値を入れ、他は not_set(原本は 0 埋め。Q&A の原文を note に)。"
                         "照合: 郡(xx999 を含む)の合計と州、州(50 州 + DC)の合計と全国を事業所数・雇用者数・年間賃金総額で(reports/US-C-bls-geo_qcew_check.csv)、"
                         "年平均給与 = total_annual_wages / annual_avg_emplvl と週平均賃金 = 同 / 52 を開示された全行で。"
                         % "; ".join("%s = %s" % kv for kv in DEFS.items())
                         + (" 2024 は API の industry/23.csv と zip のメンバー 23 を全行で突き合わせた。" if year == 2024 else "")),
            ("values_copied", True),
            ("fetched_via", "Apify web-fetch (formats=raw) with Range header"),
            ("scope_quote", "%d.annual.by_industry" % year),
            ("aux_files", aux),
            ("rows", n),
        ])
        json.dump(led, open(os.path.join(OBS2, "sources", src + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        summary[year] = dict(rows=n, members=len(members), bytes_csv=os.path.getsize(out), stat=dict(stat))
        print(year, n, os.path.getsize(out), dict(stat), flush=True)

    ck = os.path.join(OBS2, "reports", "US-C-bls-geo_qcew_check.csv")
    with open(ck, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(checks[0].keys()), lineterminator="\n")
        w.writeheader(); w.writerows(checks)
    # 照合のまとめ
    agg = collections.Counter()
    for c in checks:
        k = c["level"]
        agg[k + ":pairs"] += 1
        agg[k + ":estabs_equal"] += int(c["parent_estabs"]) == c["sum_estabs"]
        # 事業所数も雇用者数も年平均を整数に丸めたもの。子の和と親の差は 0.5 x 子の数 + 0.5 を超えないはず
        bound = 0.5 * c["children"] + 0.5
        agg[k + ":estabs_within_rounding"] += abs(int(c["parent_estabs"]) - c["sum_estabs"]) <= bound
        if c["children_N"] == 0 and c["parent_disclosure"] == "":
            agg[k + ":no_N_pairs"] += 1
            agg[k + ":no_N_emplvl_equal"] += int(c["parent_emplvl"]) == c["sum_emplvl_disclosed"]
            agg[k + ":no_N_emplvl_within_rounding"] += abs(int(c["parent_emplvl"]) - c["sum_emplvl_disclosed"]) <= bound
            agg[k + ":no_N_wages_equal"] += int(c["parent_total_wages"]) == c["sum_total_wages_disclosed"]
        elif c["parent_disclosure"] == "":
            agg[k + ":with_N_pairs"] += 1
            agg[k + ":with_N_sum_le_parent"] += c["sum_emplvl_disclosed"] <= int(c["parent_emplvl"])
            agg[k + ":with_N_wages_sum_le_parent"] += c["sum_total_wages_disclosed"] <= int(c["parent_total_wages"])
    print(json.dumps(dict(checks=dict(agg), arithmetic=dict(arith), api_vs_zip_2024=dict(api_cmp)), ensure_ascii=False, indent=1))
    json.dump(dict(checks=dict(agg), arithmetic=dict(arith), api_vs_zip_2024=dict(api_cmp), per_year=summary),
              open(os.path.join(OBS2, "reports", "US-C-bls-geo_qcew_summary.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
