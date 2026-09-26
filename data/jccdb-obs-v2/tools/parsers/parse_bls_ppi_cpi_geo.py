# -*- coding: utf-8 -*-
"""
US-C-bls-geo: PPI と CPI の足りない系列を観測層 v2 に入れる(U1 の index_bls_ppi.csv と重ならない系列だけ)。

1. PPI Final demand construction(WPUFD43 / WPUFD431 / WPUFD432)
   flat file wp.data.22.FD-ID(10,541,754 bytes)は、Apify の取得の上限(x-apify-unblocker-max-body-bytes 10485760)を超えて
   HTTP 413 になり、download.bls.gov では Range ヘッダも効かなかった(小さいファイルで試すと 200 で全体が返った)。
   代わりに BLS の data.bls.gov の系列ページ(timeseries/<id>、2016〜2026 年の月次の表)を原本の HTML のまま取り、表のセルを読む。
   照合: API v1(api.bls.gov/publicAPI/v1/timeseries/data/WPUFD43、直近 3 年)と全月で値と脚注 P を突き合わせる。
   系列の台帳(開始・終了月、基準時点)は U1 が取った raw/bls-wp.series.txt、系列名は raw/bls-ppi-commodity-series-id-codes.txt。
2. 住宅建設の資材・設備で U1 が取っていない商品別 PPI(27 系列)
   raw の flat file: bls-wp.data.9.Lumber.txt と bls-wp.data.11b.Metals104-109.txt(U1 が取った原本を読むだけ。U1 の台帳は触らない)、
   bls-wp.data.10.Pulp.txt / 12b / 12c / 13(この担当で取得)。
3. CPI の住宅の修繕に近い系列(CUUR0000SEHP04 Repair of household items、SEHM、SEHM01)
   cu.series に住宅(dwelling)の maintenance and repair の品目は無い(item の名前に maintenance を含む系列は
   Water and sewerage maintenance と Motor vehicle maintenance だけ)。近い 3 系列を入れ、そのことを note に書く。
出力: observations/us/index_bls_ppi_fd.csv, index_bls_ppi_resid.csv, index_bls_cpi_repair.csv、sources/*.json、
      reports/US-C-bls-geo_ppi_cpi_check.csv
"""
import csv, collections, hashlib, html, json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
OBS2 = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(OBS2, "tools"))
from obs_common import make_id, num, write_obs

RAW = os.path.join(OBS2, "raw")
RETRIEVED = "2026-09-26"
START = (2016, 1)
LICENSE_QUOTE = ("The Bureau of Labor Statistics (BLS) is a Federal government agency and everything that we publish, "
                 "both in hard copy and electronically, is in the public domain, except for previously copyrighted photographs "
                 "and illustrations. You are free to use our public domain material without specific permission, although we do "
                 "ask that you cite the Bureau of Labor Statistics as the source.")
LICENSE_URL = "https://www.bls.gov/opub/copyright-information.htm"
FETCH = {  # 取得時の応答ヘッダ(Apify web-fetch の結果から)
    "bls-ppi-timeseries-WPUFD43.htm": dict(status=200, lm="", etag="", note="Data extracted on: September 26, 2026 (12:06:05 AM)"),
    "bls-ppi-timeseries-WPUFD431.htm": dict(status=200, lm="", etag=""),
    "bls-ppi-timeseries-WPUFD432.htm": dict(status=200, lm="", etag=""),
    "bls-api-v1-WPUFD43.json": dict(status=200, lm="", etag="", note="Apify の結果が会話に直接出た(ファイルに落ちなかった)ので、JSON 文字列から復元。bytes 3617 = Content-Length"),
    "bls-wp.data.10.Pulp.txt": dict(status=200, lm="Thu, 10 Sep 2026 12:30:00 GMT", etag='"014b1182041dd1:0"'),
    "bls-wp.data.12b.Machinery114-116.txt": dict(status=200, lm="Thu, 10 Sep 2026 12:30:00 GMT", etag='"014b1182041dd1:0"'),
    "bls-wp.data.12c.Machinery117-119.txt": dict(status=200, lm="Thu, 10 Sep 2026 12:30:00 GMT", etag='"014b1182041dd1:0"'),
    "bls-wp.data.13.Furniture.txt": dict(status=200, lm="Thu, 10 Sep 2026 12:30:00 GMT", etag='"014b1182041dd1:0"'),
    "bls-wp.data.9.Lumber.txt": dict(status=200, lm="Thu, 10 Sep 2026 12:30:00 GMT", etag="", note="U1 が取得した原本(raw にあるものを読む)"),
    "bls-wp.data.11b.Metals104-109.txt": dict(status=200, lm="Thu, 10 Sep 2026 12:30:00 GMT", etag="", note="U1 が取得した原本(raw にあるものを読む)"),
    "bls-cu.series.txt": dict(status=200, lm="Fri, 11 Sep 2026 12:30:00 GMT", etag='"0d41a43e941dd1:0"'),
    "bls-cu.data.12.USHousing.txt": dict(status=200, lm="Fri, 11 Sep 2026 12:30:00 GMT", etag='"0d41a43e941dd1:0"'),
    "bls-cu.footnote.txt": dict(status=200, lm="Fri, 11 Sep 2026 12:30:00 GMT", etag='"0d41a43e941dd1:0"',
                                note="Apify の結果が会話に直接出た(base64)ので、その文字列から復元。bytes 100 = Content-Length"),
}
FD_SERIES = ["WPUFD43", "WPUFD431", "WPUFD432"]
TS_URL = "https://data.bls.gov/timeseries/%s?years_option=specific_years&from_year=2016&to_year=2026&output_view=data"
API_URL = "https://api.bls.gov/publicAPI/v1/timeseries/data/WPUFD43"
FLAT = collections.OrderedDict([
    ("bls-ppi-wp-9-resid", ("bls-wp.data.9.Lumber.txt", "https://download.bls.gov/pub/time.series/wp/wp.data.9.Lumber")),
    ("bls-ppi-wp-11b-resid", ("bls-wp.data.11b.Metals104-109.txt", "https://download.bls.gov/pub/time.series/wp/wp.data.11b.Metals104-109")),
    ("bls-ppi-wp-10", ("bls-wp.data.10.Pulp.txt", "https://download.bls.gov/pub/time.series/wp/wp.data.10.Pulp")),
    ("bls-ppi-wp-12b", ("bls-wp.data.12b.Machinery114-116.txt", "https://download.bls.gov/pub/time.series/wp/wp.data.12b.Machinery114-116")),
    ("bls-ppi-wp-12c", ("bls-wp.data.12c.Machinery117-119.txt", "https://download.bls.gov/pub/time.series/wp/wp.data.12c.Machinery117-119")),
    ("bls-ppi-wp-13", ("bls-wp.data.13.Furniture.txt", "https://download.bls.gov/pub/time.series/wp/wp.data.13.Furniture")),
])
RESID = [
    "WPU0821", "WPU08210102", "WPU08210105", "WPU08210106", "WPU08210112", "WPU08210142", "WPU08210152", "WPU081204",
    "WPU1062", "WPU106201461", "WPU1066", "WPU10660101", "WPU10660114", "WPU107102", "WPU107103", "WPU10730120", "WPU1083",
    "WPU09220124", "WPU1148", "WPU114802", "WPU11480734", "WPU1171", "WPU117101", "WPU117102", "WPU1231", "WPU124", "WPU12410445",
]
CPI_SERIES = ["CUUR0000SEHP04", "CUUR0000SEHM", "CUUR0000SEHM01"]
CPI_SRC = "bls-cpi-cu-data-12"
CPI_URL = "https://download.bls.gov/pub/time.series/cu/cu.data.12.USHousing"


def sha(fn):
    b = open(os.path.join(RAW, fn), "rb").read()
    return hashlib.sha256(b).hexdigest(), len(b)


def load_tsv(fn):
    with open(os.path.join(RAW, fn), encoding="utf-8", newline="") as f:
        rd = csv.reader(f, delimiter="\t")
        head = [h.strip() for h in next(rd)]
        for row in rd:
            if row:
                yield dict(zip(head, [c.strip() for c in row]))


def load_id_list(fn):
    out = collections.OrderedDict()
    for ln in open(os.path.join(RAW, fn), encoding="utf-8"):
        m = re.match(r"^((?:WPU|PCU|pcu)\S+)\s{2,}(.+?)\s*$", ln.rstrip("\r\n"))
        if m and m.group(1) not in out:
            out[m.group(1)] = m.group(2)
    return out


def months(y0, m0, y1, m1):
    y, m = y0, m0
    while (y, m) <= (y1, m1):
        yield y, m
        m += 1
        if m == 13:
            y, m = y + 1, 1


def unit_from_base(bd):
    assert len(bd) == 6 and bd.isdigit(), bd
    return "index (%s = 100)" % (bd[:4] if bd[4:] == "00" else "%s-%s" % (bd[:4], bd[4:]))


def parse_ts(fn):
    t = open(os.path.join(RAW, fn), encoding="utf-8").read()
    cat = {}
    for k in ("Series Id", "Series Title", "Group", "Item", "Base Date"):
        m = re.search(r"<th[^>]*>\s*%s:\s*</th>\s*<td[^>]*>(.*?)</td>" % re.escape(k), t, re.I | re.S)
        cat[k] = html.unescape(m.group(1)).strip() if m else ""
    tb = re.search(r'<table id="table0".*?</table>', t, re.I | re.S).group(0)
    heads = [h.strip() for h in re.findall(r"<th scope=\"col\">(.*?)</th>", tb, re.I | re.S)]
    assert heads == ["Year", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], heads
    vals = {}
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", re.search(r"<tbody>(.*?)</tbody>", tb, re.I | re.S).group(1), re.I | re.S):
        y = int(re.search(r"<th scope=\"row\">\s*(\d{4})\s*</th>", tr, re.I).group(1))
        tds = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.I | re.S)
        assert len(tds) == 12, (fn, y, len(tds))
        for i, c in enumerate(tds, start=1):
            c = html.unescape(c).replace("\xa0", " ").strip()
            if c == "":
                continue
            m = re.match(r"^(-?[\d.]+)(\((\w+)\))?$", c)
            assert m, (fn, y, i, c)
            vals[(y, i)] = (m.group(1), m.group(3) or "")
    foot = re.search(r"<tfoot>.*?<td[^>]*>(.*?)</td>", tb, re.I | re.S)
    ftext = {}
    if foot:
        for part in re.split(r"<br\s*/?>", foot.group(1), flags=re.I):
            p = html.unescape(re.sub(r"<[^>]+>", "", part)).strip()
            m = re.match(r"^(\w+)\s*:\s*(.+)$", p)
            if m:
                ftext[m.group(1)] = m.group(2).strip()
    ext = re.search(r"Data extracted on:\s*([^<]+)", t)
    return cat, vals, ftext, (ext.group(1).strip() if ext else "")


def ledger(src, title, url, fn, how, rows, extra=None, landing="https://www.bls.gov/ppi/", attribution="Source: U.S. Bureau of Labor Statistics, Producer Price Indexes (https://www.bls.gov/ppi/)"):
    h, b = sha(fn)
    f = FETCH.get(fn, {})
    led = collections.OrderedDict([
        ("source_id", src), ("country", "US"), ("title", title), ("publisher", "U.S. Bureau of Labor Statistics"),
        ("url", url), ("landing", landing), ("retrieved_at", RETRIEVED), ("bytes", b), ("sha256", h), ("raw", "raw/" + fn),
        ("http_last_modified", f.get("lm", "")), ("http_etag", f.get("etag", "")),
        ("license", "US-PD-17USC105"), ("license_url", LICENSE_URL), ("license_quote", LICENSE_QUOTE),
        ("attribution", attribution), ("how_read", how), ("values_copied", True),
        ("fetched_via", "Apify web-fetch (formats=raw)" + ("; " + f["note"] if f.get("note") else "")), ("rows", rows),
    ])
    if extra:
        led.update(extra)
    json.dump(led, open(os.path.join(OBS2, "sources", src + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def main():
    com = load_id_list("bls-ppi-commodity-series-id-codes.txt")
    wser = {r["series_id"]: r for r in load_tsv("bls-wp.series.txt")}
    groups = {r["group_code"]: r["group_name"] for r in load_tsv("bls-wp.group.txt")}
    wfoot = {r["footnote_code"]: r["footnote_text"] for r in load_tsv("bls-wp.footnote.txt")}
    u1 = set()
    for r in csv.DictReader(open(os.path.join(OBS2, "reports", "U1-us-bls_ppi_series_check.csv"), encoding="utf-8")):
        u1.add(r["series_id"])
    checks = []

    # 1. Final demand construction(系列ページの HTML)
    fd_rows = []
    fd_vals = {}
    for sid in FD_SERIES:
        assert sid in com and sid not in u1
        fn = "bls-ppi-timeseries-%s.htm" % sid
        cat, vals, ftext, extracted = parse_ts(fn)
        assert cat["Series Id"] == sid, cat
        meta = wser[sid]
        assert meta["seasonal"] == "U" and meta["base_date"] == cat["Base Date"], (meta, cat)
        src = "bls-ppi-ts-%s" % sid.lower()
        unit = unit_from_base(meta["base_date"])
        ey, em = int(meta["end_year"]), int(meta["end_period"][1:])
        expect = list(months(START[0], START[1], ey, em))
        rows, nval, npre, miss = [], 0, 0, []
        for y, m in expect:
            period = "%04d-%02d" % (y, m)
            r = dict(obs_id=make_id(src, sid, period), country="US", layer="index", category=cat["Group"], item_name=com[sid],
                     spec="series_id %s; not seasonally adjusted" % sid, unit=unit, geo_level="national", geo_code="US",
                     geo_name="United States", currency="", price_basis="index_value", period=period, source_id=src,
                     source_page="table0 %d %s" % (y, ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]),
                     evidence_url=TS_URL % sid, license="US-PD-17USC105")
            if (y, m) in vals:
                v, fc = vals[(y, m)]
                r.update(price=num(v), price_status="public_domain")
                if fc:
                    r["note"] = "%s: %s" % (fc, ftext.get(fc, wfoot.get(fc, "")))
                    npre += fc == "P"
                nval += 1
            else:
                r.update(price="", price_status="not_set", note="系列ページの表のこの月のセルが空欄(系列の台帳の範囲内)")
                miss.append(period)
            rows.append(r)
        extra_cells = [k for k in vals if k < START or k > (ey, em)]
        fd_vals[sid] = vals
        fd_rows += rows
        checks.append(dict(source="ppi_fd", series_id=sid, title=com[sid], catalog_begin="%s-%s" % (meta["begin_year"], meta["begin_period"]),
                           catalog_end="%d-%02d" % (ey, em), expected_months=len(expect), months_with_value=nval,
                           missing_months=len(miss), missing_list=" ".join(miss), cells_outside_range=len(extra_cells),
                           preliminary=npre, note="HTML の Data extracted on: " + extracted))
        ledger(src, "PPI Commodity Data %s (%s), data.bls.gov series page 2016-2026" % (sid, com[sid]), TS_URL % sid, fn,
               "data.bls.gov の系列ページ(Series Id / Series Title / Group / Item / Base Date の表と、年 x 月の表 table0)の HTML をそのまま読む。"
               "セルの (P) は脚注(表の tfoot の原文を note に)。2016 年1月から系列の台帳(raw/bls-wp.series.txt、U1 が取得)の終了月まで。"
               "flat file wp.data.22.FD-ID は 10,541,754 bytes で Apify の上限 10,485,760 を超え HTTP 413、download.bls.gov では Range も効かなかったため、この頁を原本にした。"
               "照合: 系列の台帳の基準時点と頁の Base Date の一致、期待月数と値のある月数、WPUFD43 は API v1 の応答(2024-01〜2026-08)と全月で値と脚注 P を突き合わせた。",
               len(rows), extra=dict(page_extracted=extracted, aux_files=[
                   dict(path="raw/bls-api-v1-WPUFD43.json", url=API_URL, bytes=sha("bls-api-v1-WPUFD43.json")[1], sha256=sha("bls-api-v1-WPUFD43.json")[0],
                        role="照合用(直近 3 年)")] if sid == "WPUFD43" else []))
    # API v1 と照合(WPUFD43)
    api = json.load(open(os.path.join(RAW, "bls-api-v1-WPUFD43.json"), encoding="utf-8"))
    cmpc = collections.Counter()
    for d in api["Results"]["series"][0]["data"]:
        if d["period"] == "M13":
            cmpc["api_annual_skipped"] += 1
            continue
        k = (int(d["year"]), int(d["period"][1:]))
        codes = ",".join(x["code"] for x in d["footnotes"] if x.get("code"))
        h = fd_vals["WPUFD43"].get(k)
        if h is None:
            cmpc["missing_in_html"] += 1
        elif num(h[0]) == num(d["value"]) and h[1] == codes:
            cmpc["equal_value_and_footnote"] += 1
        else:
            cmpc["different"] += 1
    n_fd = write_obs(os.path.join(OBS2, "observations", "us", "index_bls_ppi_fd.csv"), fd_rows)

    # 2. 住宅の資材・設備(flat file)
    where, data = {}, collections.defaultdict(dict)
    want = set(RESID)
    for src, (fn, url) in FLAT.items():
        for r in load_tsv(fn):
            s = r["series_id"]
            if s not in want:
                continue
            assert where.get(s, src) == src
            where[s] = src
            data[s][(int(r["year"]), r["period"])] = (r["value"], r.get("footnote_codes", ""))
    res_rows, per_src = [], collections.Counter()
    for s in RESID:
        assert s in com and s not in u1 and s in where, s
        meta = wser[s]
        assert meta["seasonal"] == "U"
        src = where[s]
        fn, url = FLAT[src]
        by, bm = int(meta["begin_year"]), int(meta["begin_period"][1:])
        ey, em = int(meta["end_year"]), int(meta["end_period"][1:])
        sy, sm = max(START, (by, bm))
        expect = list(months(sy, sm, ey, em)) if (ey, em) >= (sy, sm) else []
        nval, miss, npre = 0, [], 0
        for y, m in expect:
            period = "%04d-%02d" % (y, m)
            r = dict(obs_id=make_id(src, s, period), country="US", layer="index", category=groups[meta["group_code"]], item_name=com[s],
                     spec="series_id %s; not seasonally adjusted" % s, unit=unit_from_base(meta["base_date"]), geo_level="national",
                     geo_code="US", geo_name="United States", currency="", price_basis="index_value", period=period, source_id=src,
                     evidence_url=url, license="US-PD-17USC105")
            k = (y, "M%02d" % m)
            if k in data[s]:
                v, fc = data[s][k]
                r.update(price=num(v), price_status="public_domain")
                notes = ["%s: %s" % (c.strip(), wfoot[c.strip()]) for c in fc.split(",") if c.strip()]
                npre += "P" in [c.strip() for c in fc.split(",")]
                r["note"] = " / ".join(notes)
                nval += 1
            else:
                r.update(price="", price_status="not_set",
                         note="BLS の flat file にこの月の行が無い(系列の台帳 wp.series の開始・終了月の範囲内の欠け)")
                miss.append(period)
            res_rows.append(r)
            per_src[src] += 1
        months_file = [k for k in data[s] if k[1] != "M13"]
        last = max(months_file)
        checks.append(dict(source=src, series_id=s, title=com[s], catalog_begin="%d-%02d" % (by, bm), catalog_end="%d-%02d" % (ey, em),
                           expected_months=len(expect), months_with_value=nval, missing_months=len(miss),
                           missing_list=" ".join(miss[:40]), cells_outside_range=sum(1 for (y, p) in months_file if (y, int(p[1:])) > (ey, em)),
                           preliminary=npre, note="ファイルの最終月 %d-%s、台帳の終了月と%s" % (last[0], last[1], "一致" if last == (ey, "M%02d" % em) else "不一致")))
    n_res = write_obs(os.path.join(OBS2, "observations", "us", "index_bls_ppi_resid.csv"), res_rows)
    for src, (fn, url) in FLAT.items():
        sel = [s for s in RESID if where[s] == src]
        ledger(src, "Producer Price Indexes (PPI), time.series flat file %s (住宅建設の資材・設備 %d 系列)" % (url.rsplit("/", 1)[1], len(sel)), url, fn,
               "BLS の time.series flat file(タブ区切り: series_id, year, period, value, footnote_codes)をそのまま読む。取り込む系列は公式の Series ID 一覧"
               "(raw/bls-ppi-commodity-series-id-codes.txt)に載り、U1 の index_bls_ppi.csv に無い、住宅建設の資材・設備の系列: %s。"
               "系列名は同じ一覧の原文、分類名は wp.group、基準時点は wp.series の base_date。2016 年1月(系列の開始が後ならその月)から台帳の終了月までの月次。"
               "年平均 M13 は入れない。脚注 P は wp.footnote の原文を note に。台帳の範囲内で行が無い月は not_set。"
               "照合: 系列ごとの期待月数と値のある月数、欠け、ファイルの最終月と台帳の終了月の一致(reports/US-C-bls-geo_ppi_cpi_check.csv)。"
               % ", ".join(sel) + (" この原本は U1 が取得したもの(U1 の台帳 %s も同じファイルを指す)。U1 の台帳は変えず、この担当の系列だけをこの台帳で持つ。"
                                   % src.replace("-resid", "") if src.endswith("-resid") else ""),
               per_src[src], extra=dict(series=sel))

    # 3. CPI
    cser = {r["series_id"]: r for r in load_tsv("bls-cu.series.txt")}
    cfoot = {r["footnote_code"]: r["footnote_text"] for r in load_tsv("bls-cu.footnote.txt")}
    maint = sorted({r["series_title"].split(" in ")[0] for r in cser.values() if "mainten" in r["series_title"].lower()})
    cdata = collections.defaultdict(dict)
    for r in load_tsv("bls-cu.data.12.USHousing.txt"):
        if r["series_id"] in CPI_SERIES:
            cdata[r["series_id"]][(int(r["year"]), r["period"])] = (r["value"], r.get("footnote_codes", ""))
    cpi_rows = []
    for s in CPI_SERIES:
        meta = cser[s]
        assert meta["seasonal"] == "U" and meta["periodicity_code"] == "R" and meta["area_code"] == "0000"
        by, bm = int(meta["begin_year"]), int(meta["begin_period"][1:])
        ey, em = int(meta["end_year"]), int(meta["end_period"][1:])
        expect = list(months(START[0], START[1], ey, em))
        nval, miss, dash = 0, [], 0
        title = meta["series_title"]
        item = title.split(" in U.S. city average")[0]
        for y, m in expect:
            period = "%04d-%02d" % (y, m)
            r = dict(obs_id=make_id(CPI_SRC, s, period), country="US", layer="index", category="Housing (CPI item %s)" % meta["item_code"],
                     item_name=item, spec="series_id %s; U.S. city average, all urban consumers (CPI-U); not seasonally adjusted" % s,
                     unit="index (%s)" % meta["base_period"], geo_level="national", geo_code="US", geo_name="United States",
                     area_label="U.S. city average", area_code=meta["area_code"], currency="", price_basis="index_value",
                     period=period, source_id=CPI_SRC, evidence_url=CPI_URL, license="US-PD-17USC105")
            notes = ["CPI には住宅(dwelling)の maintenance and repair の品目が無い(cu.series で maintenance を含む品目は %s だけ)。"
                     "これはそれに近い系列" % " / ".join(maint)]
            k = (y, "M%02d" % m)
            if k in cdata[s] and cdata[s][k][0] != "-":
                v, fc = cdata[s][k]
                r.update(price=num(v), price_status="public_domain")
                notes += ["%s: %s" % (c.strip(), cfoot[c.strip()]) for c in fc.split(",") if c.strip()]
                nval += 1
            elif k in cdata[s]:
                v, fc = cdata[s][k]
                r.update(price="", price_status="not_set")
                notes.append('原本の値が "-"。' + " / ".join("%s: %s" % (c.strip(), cfoot[c.strip()]) for c in fc.split(",") if c.strip()))
                miss.append(period); dash += 1
            else:
                r.update(price="", price_status="not_set")
                notes.append("cu.data.12.USHousing にこの月の行が無い(この月の値は公表されていない)")
                miss.append(period)
            r["note"] = " / ".join(notes)
            cpi_rows.append(r)
        last = max(k for k in cdata[s] if k[1] != "M13")
        checks.append(dict(source=CPI_SRC, series_id=s, title=title, catalog_begin="%d-%02d" % (by, bm), catalog_end="%d-%02d" % (ey, em),
                           expected_months=len(expect), months_with_value=nval, missing_months=len(miss), missing_list=" ".join(miss),
                           cells_outside_range=0, preliminary="", note="値が - の月 %d。ファイルの最終月 %d-%s" % (dash, last[0], last[1])))
    n_cpi = write_obs(os.path.join(OBS2, "observations", "us", "index_bls_cpi_repair.csv"), cpi_rows)
    ledger(CPI_SRC, "Consumer Price Index (CPI-U), time.series flat file cu.data.12.USHousing (repair and hardware items)", CPI_URL,
           "bls-cu.data.12.USHousing.txt",
           "BLS の time.series flat file(タブ区切り)をそのまま読む。系列の台帳は cu.series(raw/bls-cu.series.txt)、脚注は cu.footnote(raw/bls-cu.footnote.txt)。"
           "cu.series の series_title で maintenance を含む品目は %s だけで、住宅(dwelling)の maintenance and repair の品目は無い"
           "(cu.item 16,554 bytes、2026-09-11 版も目で確かめた。結果が会話に直接出たため raw には置いていない)。近い系列として %s(U.S. city average、"
           "CPI-U、季節調整なし、月次)を 2016 年1月から台帳の終了月まで入れる。値が - の月と行の無い月は not_set(脚注 X の原文を note に)。"
           % (" / ".join(maint), ", ".join(CPI_SERIES)),
           len(cpi_rows), landing="https://www.bls.gov/cpi/",
           attribution="Source: U.S. Bureau of Labor Statistics, Consumer Price Index (https://www.bls.gov/cpi/)",
           extra=dict(aux_files=[dict(path="raw/" + fn, url=u, bytes=sha(fn)[1], sha256=sha(fn)[0]) for fn, u in (
               ("bls-cu.series.txt", "https://download.bls.gov/pub/time.series/cu/cu.series"),
               ("bls-cu.footnote.txt", "https://download.bls.gov/pub/time.series/cu/cu.footnote"))]))

    ck = os.path.join(OBS2, "reports", "US-C-bls-geo_ppi_cpi_check.csv")
    with open(ck, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(checks[0].keys()), lineterminator="\n")
        w.writeheader(); w.writerows(checks)
    print(json.dumps(dict(rows=dict(fd=n_fd, resid=n_res, cpi=n_cpi), api_vs_html=dict(cmpc), maintenance_items=maint,
                          gaps={c["series_id"]: c["missing_months"] for c in checks if c["missing_months"]},
                          end_mismatch=[c["series_id"] for c in checks if "不一致" in c["note"]]), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
