# -*- coding: utf-8 -*-
"""
U1-us-bls: BLS 生産者物価指数(PPI)の建設関連系列を観測層 v2 に入れる。

入力(すべて OBS2/raw、2026-09-26 に Apify web-fetch formats=raw で取得):
  - bls-ppi-commodity-series-id-codes.txt / bls-ppi-industry-series-id-codes.txt
      BLS の公式 Series ID 一覧(data-retrieval-guide)。系列 ID の実在確認と、系列名(原文)に使う。
  - bls-wp.series.txt / bls-pc.series.txt  系列の台帳(基準時点 base_date、開始・終了月)
  - bls-wp.group.txt                       商品分類の名前
  - bls-wp.footnote.txt                    脚注の原文(P = 速報)
  - bls-wp.data.*.txt / bls-pc.data.75.Construction.txt  値(BLS の time.series flat file、全期間)
  - bls-api-v1-WPUIP2312001.json           API v1 の応答(直近3年)。flat file との全月照合に使う
出力:
  - observations/us/index_bls_ppi.csv
  - sources/bls-ppi-*.json(flat file 1本 = 台帳1つ)
  - reports/U1-us-bls_ppi_series_check.csv(系列ごとの月数と欠けの全数照合)

API v1 ではなく flat file を値の出所にした理由: API v1 の GET は年の指定を無視して直近3年だけを返し
(2026-09-26 に確認)、25 系列 x 10 年を1問で取れる POST は、使える Apify の Actor(web-fetch)で送れなかった。
flat file は BLS が同じ PPI を全期間で配布している公式のテキストで、値と脚注は API と同じ(照合で確認)。
"""
import csv, hashlib, json, os, re, sys, collections
HERE = os.path.dirname(os.path.abspath(__file__))
OBS2 = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(OBS2, "tools"))
from obs_common import make_id, num, write_obs

RAW = os.path.join(OBS2, "raw")
RETRIEVED = "2026-09-26"
START_YEAR = 2016
FLAT_LM = "Thu, 10 Sep 2026 12:30:00 GMT"  # 取得時の Last-Modified(全 flat file 同じ)

FILES = collections.OrderedDict([
    ("bls-ppi-wp-80i", ("bls-wp.data.80i.ConstructnInputs.txt", "https://download.bls.gov/pub/time.series/wp/wp.data.80i.ConstructnInputs", "wp")),
    ("bls-ppi-pc-75", ("bls-pc.data.75.Construction.txt", "https://download.bls.gov/pub/time.series/pc/pc.data.75.Construction", "pc")),
    ("bls-ppi-wp-9", ("bls-wp.data.9.Lumber.txt", "https://download.bls.gov/pub/time.series/wp/wp.data.9.Lumber", "wp")),
    ("bls-ppi-wp-11a", ("bls-wp.data.11a.Metals10-103.txt", "https://download.bls.gov/pub/time.series/wp/wp.data.11a.Metals10-103", "wp")),
    ("bls-ppi-wp-11b", ("bls-wp.data.11b.Metals104-109.txt", "https://download.bls.gov/pub/time.series/wp/wp.data.11b.Metals104-109", "wp")),
    ("bls-ppi-wp-12a", ("bls-wp.data.12a.Machinery11-113.txt", "https://download.bls.gov/pub/time.series/wp/wp.data.12a.Machinery11-113", "wp")),
    ("bls-ppi-wp-14", ("bls-wp.data.14.Minerals.txt", "https://download.bls.gov/pub/time.series/wp/wp.data.14.Minerals", "wp")),
    ("bls-ppi-wp-6", ("bls-wp.data.6.Fuels.txt", "https://download.bls.gov/pub/time.series/wp/wp.data.6.Fuels", "wp")),
    ("bls-ppi-wp-7", ("bls-wp.data.7.Chemicals.txt", "https://download.bls.gov/pub/time.series/wp/wp.data.7.Chemicals", "wp")),
    ("bls-ppi-wp-8", ("bls-wp.data.8.Rubber.txt", "https://download.bls.gov/pub/time.series/wp/wp.data.8.Rubber", "wp")),
])
AUX = [  # 台帳に sha256 を残す補助ファイル
    ("bls-ppi-commodity-series-id-codes.txt", "https://www.bls.gov/ppi/data-retrieval-guide/producer-price-index-commodity-data-series-id-codes.txt", "Wed, 15 Jul 2026 17:44:29 GMT"),
    ("bls-ppi-industry-series-id-codes.txt", "https://www.bls.gov/ppi/data-retrieval-guide/producer-price-index-industry-data-series-id-codes.txt", "Wed, 15 Jul 2026 14:34:16 GMT"),
    ("bls-wp.series.txt", "https://download.bls.gov/pub/time.series/wp/wp.series", FLAT_LM),
    ("bls-pc.series.txt", "https://download.bls.gov/pub/time.series/pc/pc.series", FLAT_LM),
    ("bls-wp.group.txt", "https://download.bls.gov/pub/time.series/wp/wp.group", FLAT_LM),
    ("bls-wp.footnote.txt", "https://download.bls.gov/pub/time.series/wp/wp.footnote", FLAT_LM),
    ("bls-api-v1-WPUIP2312001.json", "https://api.bls.gov/publicAPI/v1/timeseries/data/WPUIP2312001?startyear=2016&endyear=2025", ""),
    ("bls-copyright.htm", "https://www.bls.gov/opub/copyright-information.htm", ""),
]

# 主要資材(商品別 PPI)。ID はすべて公式の Series ID 一覧にあることを下で検査する
MATERIALS = [
    "WPU132", "WPU1321", "WPU1322", "WPU133", "WPU1331", "WPU1332", "WPU1333",
    "WPU13330101A", "WPU13330101B", "WPU13330101C", "WPU13330101D", "WPU1334",
    "WPU081", "WPU0811", "WPU0812", "WPU082", "WPU0822", "WPU083", "WPU0831", "WPU0835", "WPU086",
    "WPU1017", "WPU101704", "WPU101706", "WPU102501", "WPU10250239", "WPU1026", "WPU10260314",
    "WPU107", "WPU1071", "WPU1073", "WPU1074", "WPU107405", "WPU1074051", "WPU1079",
    "WPU104101", "WPU105", "WPU106",
    "WPU1311", "WPU134", "WPU1342", "WPU136", "WPU1361", "WPU137", "WPU13710102", "WPU1392",
    "WPU1394", "WPU13940113C", "WPU1395",
    "WPU058102", "WPU057303", "WPU0621", "WPU062101", "WPU0721",
    "WPU112",
]

LICENSE_QUOTE = ("The Bureau of Labor Statistics (BLS) is a Federal government agency and everything that we publish, "
                 "both in hard copy and electronically, is in the public domain, except for previously copyrighted photographs "
                 "and illustrations. You are free to use our public domain material without specific permission, although we do "
                 "ask that you cite the Bureau of Labor Statistics as the source.")
LICENSE_URL = "https://www.bls.gov/opub/copyright-information.htm"
REGION = {"northeast": ("R1", "Northeast"), "midwest": ("R2", "Midwest"), "south": ("R3", "South"), "west": ("R4", "West")}


def sha(path):
    b = open(path, "rb").read()
    return hashlib.sha256(b).hexdigest(), len(b)


def load_id_list(fn):
    out = collections.OrderedDict()
    for ln in open(os.path.join(RAW, fn), encoding="utf-8"):
        m = re.match(r"^((?:WPU|PCU|pcu)\S+)\s{2,}(.+?)\s*$", ln.rstrip("\r\n"))
        if m and m.group(1) not in out:
            out[m.group(1)] = m.group(2)
    return out


def load_tsv(fn):
    with open(os.path.join(RAW, fn), encoding="utf-8", newline="") as f:
        rd = csv.reader(f, delimiter="\t")
        head = [h.strip() for h in next(rd)]
        for row in rd:
            if row:
                yield dict(zip(head, [c.strip() for c in row]))


def month_range(y0, m0, y1, m1):
    y, m = y0, m0
    while (y, m) <= (y1, m1):
        yield y, m
        m += 1
        if m == 13:
            y, m = y + 1, 1


def unit_from_base(bd):
    if len(bd) == 6 and bd.isdigit():
        return "index (%s = 100)" % (bd[:4] if bd[4:] == "00" else "%s-%s" % (bd[:4], bd[4:]))
    raise ValueError("base_date %r" % bd)


def region_of(title):
    m = re.search(r"(?:^|,\s*)(Northeast|Midwest|South|West)(?:\s+region)?\b", title, re.I)
    if m:
        code, name = REGION[m.group(1).lower()]
        return code, name, m.group(1)
    return None


def main():
    com = load_id_list("bls-ppi-commodity-series-id-codes.txt")
    ind = load_id_list("bls-ppi-industry-series-id-codes.txt")
    wser = {r["series_id"]: r for r in load_tsv("bls-wp.series.txt")}
    pser = {r["series_id"]: r for r in load_tsv("bls-pc.series.txt")}
    groups = {r["group_code"]: r["group_name"] for r in load_tsv("bls-wp.group.txt")}
    foot = {r["footnote_code"]: r["footnote_text"] for r in load_tsv("bls-wp.footnote.txt")}

    sel = collections.OrderedDict()
    for s in com:
        if s.startswith("WPUIP23"):
            sel[s] = ("commodity", "inputs_to_construction")
    for s in ind:
        if s.startswith("PCU23"):
            sel[s] = ("industry", "construction_industry")
    for s in MATERIALS:
        assert s in com, "公式一覧に無い ID: %s" % s
        sel[s] = ("commodity", "construction_material")

    # 値を読む(選んだ系列だけ)
    data = collections.defaultdict(dict)   # sid -> {(y, 'Mnn'): (value, footnote)}
    where = {}
    for src, (fn, url, kind) in FILES.items():
        for r in load_tsv(fn):
            sid = r["series_id"]
            if sid not in sel:
                continue
            if sid in where and where[sid] != src:
                raise SystemExit("同じ系列が2つのファイルに: %s" % sid)
            where[sid] = src
            key = (int(r["year"]), r["period"])
            assert key not in data[sid], "重複行: %s %s" % (sid, key)
            data[sid][key] = (r["value"], r.get("footnote_codes", ""))
    missing_series = [s for s in sel if s not in where]

    rows, checks = [], []
    stat = collections.Counter()
    for sid, (lst, grp) in sel.items():
        if sid not in where:
            continue
        src = where[sid]
        fn, url, kind = FILES[src]
        meta = (wser if kind == "wp" else pser)[sid]
        assert meta["seasonal"] == "U", sid
        title = (com if lst == "commodity" else ind)[sid]
        if kind == "wp":
            category = groups[meta["group_code"]]
        else:
            ic = meta["industry_code"]
            category = ind.get("PCU%s%s" % (ic, ic), ic)
        unit = unit_from_base(meta["base_date"])
        by, bm = int(meta["begin_year"]), int(meta["begin_period"][1:])
        ey, em = int(meta["end_year"]), int(meta["end_period"][1:])
        sy, sm = max((START_YEAR, 1), (by, bm))
        reg = region_of(title)
        if reg:
            geo_level, geo_code, geo_name, area_label = "census_region", reg[0], reg[1], reg[2]
        else:
            geo_level, geo_code, geo_name, area_label = "national", "US", "United States", ""
        base = dict(country="US", layer="index", category=category, item_name=title,
                    spec="series_id %s; not seasonally adjusted" % sid, unit=unit,
                    geo_level=geo_level, geo_code=geo_code, geo_name=geo_name, area_label=area_label,
                    currency="", price_basis="index_value", source_id=src, evidence_url=url,
                    license="US-PD-17USC105")
        months = [k for k in data[sid] if k[1] != "M13"]
        in_rng, missing, outside, pcount = 0, [], [], 0
        expect = list(month_range(sy, sm, ey, em)) if (ey, em) >= (sy, sm) else []
        for y, m in expect:
            k = (y, "M%02d" % m)
            period = "%04d-%02d" % (y, m)
            r = dict(base, obs_id=make_id(src, sid, period), period=period)
            if k in data[sid]:
                v, fc = data[sid][k]
                r.update(price=num(v), price_status="public_domain")
                notes = []
                for c in fc.split(","):
                    c = c.strip()
                    if c:
                        notes.append("%s: %s" % (c, foot[c]))
                        if c == "P":
                            pcount += 1
                if reg:
                    notes.append("地域は BLS の系列名にある地域名(%s)。geo_code は同名の Census Region のコードに名前で寄せた" % reg[2])
                r["note"] = " / ".join(notes)
                in_rng += 1
                stat["public_domain"] += 1
            else:
                r.update(price="", price_status="not_set",
                         note="BLS の flat file にこの月の行が無い(系列の台帳 wp/pc.series の開始・終了月の範囲内の欠け)")
                missing.append(period)
                stat["not_set"] += 1
            rows.append(r)
        for (y, p) in months:
            if y >= START_YEAR and not ((sy, sm) <= (y, int(p[1:])) <= (ey, em)):
                outside.append("%d-%s" % (y, p))
        last = max(months) if months else None
        checks.append(dict(series_id=sid, group=grp, source_id=src, title=title, base_date=meta["base_date"],
                           catalog_begin="%d-%02d" % (by, bm), catalog_end="%d-%02d" % (ey, em),
                           range_from="%d-%02d" % (sy, sm), expected_months=len(expect), months_with_value=in_rng,
                           missing_months=len(missing), missing_list=" ".join(missing[:40]) + (" ..." if len(missing) > 40 else ""),
                           rows_outside_catalog_range=len(outside),
                           last_month_in_file="%d-%s" % last if last else "", catalog_end_matches_last=(last == (ey, "M%02d" % em)),
                           preliminary_P=pcount, geo_level=geo_level, geo_code=geo_code))

    # API v1 の応答と flat file の全月照合(重なる期間の全月)
    api = json.load(open(os.path.join(RAW, "bls-api-v1-WPUIP2312001.json"), encoding="utf-8"))
    api_cmp = collections.Counter()
    for s in api["Results"]["series"]:
        for d in s["data"]:
            k = (int(d["year"]), d["period"])
            fv = data[s["seriesID"]].get(k)
            codes = ",".join(x.get("code", "") for x in d["footnotes"] if x.get("code"))
            if fv is None:
                api_cmp["missing_in_flat"] += 1
            elif num(fv[0]) == num(d["value"]) and fv[1].strip() == codes:
                api_cmp["equal_value_and_footnote"] += 1
            else:
                api_cmp["different"] += 1
                print("API と違う:", s["seriesID"], k, fv, d["value"], codes)

    out = os.path.join(OBS2, "observations", "us", "index_bls_ppi.csv")
    n = write_obs(out, rows)
    ck = os.path.join(OBS2, "reports", "U1-us-bls_ppi_series_check.csv")
    with open(ck, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(checks[0].keys()), lineterminator="\n")
        w.writeheader(); w.writerows(checks)

    # 台帳
    aux = []
    for fn, url, lm in AUX:
        h, b = sha(os.path.join(RAW, fn))
        aux.append({"path": "raw/" + fn, "url": url, "sha256": h, "bytes": b, "http_last_modified": lm})
    per_src = collections.Counter(r["source_id"] for r in rows)
    ser_src = collections.Counter(where[s] for s in where)
    for src, (fn, url, kind) in FILES.items():
        h, b = sha(os.path.join(RAW, fn))
        led = collections.OrderedDict([
            ("source_id", src), ("country", "US"),
            ("title", "Producer Price Indexes (PPI), time.series flat file %s" % url.rsplit("/", 1)[1]),
            ("publisher", "U.S. Bureau of Labor Statistics"),
            ("url", url), ("landing", "https://www.bls.gov/ppi/"),
            ("retrieved_at", RETRIEVED), ("bytes", b), ("sha256", h), ("http_last_modified", FLAT_LM),
            ("license", "US-PD-17USC105"), ("license_url", LICENSE_URL), ("license_quote", LICENSE_QUOTE),
            ("attribution", "Source: U.S. Bureau of Labor Statistics, Producer Price Indexes (https://www.bls.gov/ppi/)"),
            ("how_read", "BLS の time.series flat file(タブ区切り: series_id, year, period, value, footnote_codes)をそのまま読む。"
                         "取り込む系列は BLS の公式 Series ID 一覧(data-retrieval-guide の commodity / industry 2本)に載る ID だけ"
                         "(Inputs to construction industries は WPUIP23 で始まる全系列、建設業の産業別 PPI は PCU23 で始まる全系列、主要資材は選んだ %d 系列)。"
                         "系列名は同じ一覧の原文、分類名は wp.group / 一覧の産業名、基準時点は wp.series / pc.series の base_date。"
                         "%d 年1月から台帳の終了月までの月次(M01-M12)。年平均 M13 は入れない。脚注 P(速報)は note に wp.footnote の原文で。"
                         "台帳の範囲内で行が無い月は not_set。照合: 系列ごとに期待月数(台帳の開始・終了月から)と値のある月数、欠け、"
                         "台帳の終了月とファイルの最終月の一致を全数で数えた(reports/U1-us-bls_ppi_series_check.csv)。"
                         "API v1 の応答(WPUIP2312001、2024-01〜2026-08)と flat file を全月で突き合わせた。" % (len(MATERIALS), START_YEAR)),
            ("values_copied", True),
            ("fetched_via", "Apify web-fetch (formats=raw)"),
            ("series_count", ser_src.get(src, 0)), ("rows", per_src.get(src, 0)),
            ("aux_files", aux),
            ("api_note", "API v1 の GET(https://api.bls.gov/publicAPI/v1/timeseries/data/<id>)は startyear/endyear を無視して直近3年だけを返した。"
                         "POST は Apify の web-fetch で送れず、cheerio-scraper はアカウント権限の承認が要り使えなかった。"),
        ])
        json.dump(led, open(os.path.join(OBS2, "sources", src + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    summ = dict(rows=n, status=dict(stat), series_selected=len(sel), series_found=len(where), missing_series=missing_series,
                series_with_gaps=sum(1 for c in checks if c["missing_months"]), gap_months=sum(c["missing_months"] for c in checks),
                end_mismatch=[c["series_id"] for c in checks if not c["catalog_end_matches_last"]],
                outside=[c["series_id"] for c in checks if c["rows_outside_catalog_range"]],
                api_vs_flat=dict(api_cmp), per_source=dict(per_src), series_per_source=dict(ser_src))
    print(json.dumps(summ, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
