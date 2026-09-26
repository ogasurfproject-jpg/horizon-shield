# -*- coding: utf-8 -*-
"""
U1-us-bls: BLS 雇用コスト指数(ECI)の建設関連系列(季節調整なし、current dollar index)を観測層 v2 に入れる。

入力(OBS2/raw、2026-09-26 に Apify web-fetch formats=raw で取得):
  - bls-ci.series.txt          https://download.bls.gov/pub/time.series/ci/ci.series(系列の台帳、系列名の原文)
  - bls-ci.data.0.Current.txt  https://download.bls.gov/pub/time.series/ci/ci.data.0.Current(値、2014 年以降)
  - bls-ci.footnote.txt        https://download.bls.gov/pub/time.series/ci/ci.footnote(脚注の原文)
  - bls-eci-news-release-t04.htm  https://www.bls.gov/news.release/eci.t04.htm(基準時点の表記と、別経路の照合)
選ぶ系列: ci.series のうち seasonal=U、periodicity=I(current dollar index)、系列名に construction を含むもの全部。
出力: observations/us/index_bls_eci.csv、sources/bls-eci-ci-current.json、reports/U1-us-bls_eci_series_check.csv
"""
import csv, collections, hashlib, html, json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
OBS2 = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(OBS2, "tools"))
from obs_common import make_id, num, write_obs

RAW = os.path.join(OBS2, "raw")
SRC = "bls-eci-ci-current"
URL = "https://download.bls.gov/pub/time.series/ci/ci.data.0.Current"
START = (2016, 1)
LICENSE_QUOTE = ("The Bureau of Labor Statistics (BLS) is a Federal government agency and everything that we publish, "
                 "both in hard copy and electronically, is in the public domain, except for previously copyrighted photographs "
                 "and illustrations. You are free to use our public domain material without specific permission, although we do "
                 "ask that you cite the Bureau of Labor Statistics as the source.")


def tsv(fn):
    with open(os.path.join(RAW, fn), encoding="utf-8", newline="") as f:
        rd = csv.reader(f, delimiter="\t")
        head = [h.strip() for h in next(rd)]
        for row in rd:
            if row:
                yield dict(zip(head, [c.strip() for c in row]))


def sha(fn):
    b = open(os.path.join(RAW, fn), "rb").read()
    return hashlib.sha256(b).hexdigest(), len(b)


def quarters(y0, q0, y1, q1):
    y, q = y0, q0
    while (y, q) <= (y1, q1):
        yield y, q
        q += 1
        if q == 5:
            y, q = y + 1, 1


def main():
    ser = collections.OrderedDict()
    for r in tsv("bls-ci.series.txt"):
        if r["seasonal"] == "U" and r["periodicity_code"] == "I" and "construction" in r["series_title"].lower():
            ser[r["series_id"]] = r
    foot = {r["footnote_code"]: r["footnote_text"] for r in tsv("bls-ci.footnote.txt")}
    data = collections.defaultdict(dict)
    for r in tsv("bls-ci.data.0.Current.txt"):
        if r["series_id"] in ser:
            k = (int(r["year"]), int(r["period"][1:]))
            assert r["period"].startswith("Q") and k not in data[r["series_id"]]
            data[r["series_id"]][k] = (r["value"], r["footnote_codes"])

    # 基準時点の表記(news release Table 4 の見出し)と、Table 4 の値
    s = open(os.path.join(RAW, "bls-eci-news-release-t04.htm"), encoding="utf-8").read()
    t = re.sub(r"<script.*?</script>", "", s, flags=re.S)
    t = re.sub(r"</t[dh]>", "\t", t); t = re.sub(r"</tr>", "\n", t)
    t = html.unescape(re.sub(r"<[^>]+>", "", t)); t = re.sub(r"[ \xa0]+", " ", t)
    lines = [l.strip() for l in t.split("\n") if l.strip()]
    base_label = next(l for l in lines if l.startswith("Indexes (Dec. 2005=100)"))
    assert base_label == "Indexes (Dec. 2005=100)"
    t4 = {}
    for name, sid in (("Natural resources, construction, and maintenance", "CIU1010000400000I"),
                      ("Construction, extraction, farming, fishing, and forestry occupations", "CIU1010000405000I")):
        i = lines.index(name)
        t4[sid] = {(2025, 2): lines[i + 1], (2026, 1): lines[i + 2], (2026, 2): lines[i + 3]}

    rows, checks, stat = [], [], collections.Counter()
    for sid, m in ser.items():
        by, bq = int(m["begin_year"]), int(m["begin_period"][1:])
        ey, eq = int(m["end_year"]), int(m["end_period"][1:])
        sy, sq = max(START, (by, bq))
        sfn = [c.strip() for c in m["footnote_codes"].split(",") if c.strip()]
        snote = " / ".join("%s: %s" % (c, foot[c]) for c in sfn if not foot[c].startswith("See Footnote"))
        base = dict(country="US", layer="index", category="Employment Cost Index (ECI), current dollar index",
                    item_name=m["series_title"],
                    spec="series_id %s; not seasonally adjusted; owner_code %s; industry_code %s; occupation_code %s; estimate_code %s"
                         % (sid, m["owner_code"], m["industry_code"], m["occupation_code"], m["estimate_code"]),
                    unit="index (2005-12 = 100)", geo_level="national", geo_code="US", geo_name="United States",
                    currency="", price_basis="index_value", source_id=SRC, evidence_url=URL, license="US-PD-17USC105")
        exp = list(quarters(sy, sq, ey, eq))
        have, miss = 0, []
        for y, q in exp:
            period = "%dQ%d" % (y, q)
            r = dict(base, obs_id=make_id(SRC, sid, period), period=period)
            notes = ["基準: news release Table 4 の見出し \"Indexes (Dec. 2005=100)\""] + ([snote] if snote else [])
            if (y, q) in data[sid]:
                v, fc = data[sid][(y, q)]
                for c in [c.strip() for c in fc.split(",") if c.strip()]:
                    notes.append("%s: %s" % (c, foot[c]))
                r.update(price=num(v), price_status="public_domain", note=" / ".join(notes))
                have += 1; stat["public_domain"] += 1
            else:
                r.update(price="", price_status="not_set", note="flat file にこの四半期の行が無い")
                miss.append(period); stat["not_set"] += 1
            rows.append(r)
        last = max(data[sid]) if data[sid] else None
        checks.append(dict(series_id=sid, title=m["series_title"], catalog_begin="%dQ%d" % (by, bq), catalog_end="%dQ%d" % (ey, eq),
                           range_from="%dQ%d" % (sy, sq), expected_quarters=len(exp), quarters_with_value=have,
                           missing=" ".join(miss), last_in_file="%dQ%d" % last if last else "",
                           catalog_end_matches_last=(last == (ey, eq))))
    t4cmp = collections.Counter()
    for sid, d in t4.items():
        for k, v in d.items():
            t4cmp["equal" if num(v) == num(data[sid][k][0]) else "different"] += 1

    out = os.path.join(OBS2, "observations", "us", "index_bls_eci.csv")
    n = write_obs(out, rows)
    with open(os.path.join(OBS2, "reports", "U1-us-bls_eci_series_check.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(checks[0].keys()), lineterminator="\n")
        w.writeheader(); w.writerows(checks)
    h, b = sha("bls-ci.data.0.Current.txt")
    aux = []
    for fn, url in (("bls-ci.series.txt", "https://download.bls.gov/pub/time.series/ci/ci.series"),
                    ("bls-ci.footnote.txt", "https://download.bls.gov/pub/time.series/ci/ci.footnote"),
                    ("bls-eci-news-release-t04.htm", "https://www.bls.gov/news.release/eci.t04.htm"),
                    ("bls-copyright.htm", "https://www.bls.gov/opub/copyright-information.htm")):
        hh, bb = sha(fn)
        aux.append({"path": "raw/" + fn, "url": url, "sha256": hh, "bytes": bb})
    led = collections.OrderedDict([
        ("source_id", SRC), ("country", "US"), ("title", "Employment Cost Index (ECI), time.series flat file ci.data.0.Current"),
        ("publisher", "U.S. Bureau of Labor Statistics"), ("url", URL), ("landing", "https://www.bls.gov/eci/"),
        ("retrieved_at", "2026-09-26"), ("bytes", b), ("sha256", h), ("http_last_modified", "Fri, 31 Jul 2026 12:30:00 GMT"),
        ("license", "US-PD-17USC105"), ("license_url", "https://www.bls.gov/opub/copyright-information.htm"),
        ("license_quote", LICENSE_QUOTE),
        ("attribution", "Source: U.S. Bureau of Labor Statistics, Employment Cost Index (https://www.bls.gov/eci/)"),
        ("how_read", "ci.series から seasonal=U、periodicity=I(current dollar index)、系列名に construction を含む系列を全部選び、"
                     "ci.data.0.Current の値を 2016Q1 から台帳の終了四半期まで入れる。系列名は ci.series の原文。系列の脚注のうち本文のあるもの(B, N)を note に。"
                     "基準時点は news release Table 4 の見出し \"Indexes (Dec. 2005=100)\"(civilian の表。private の系列も同じ ECI の current dollar index)。"
                     "照合: 系列ごとに期待四半期数と値のある四半期数・欠け・台帳の終了四半期との一致を全数で(reports/U1-us-bls_eci_series_check.csv)。"
                     "news release Table 4 の civilian 2 系列 x 3 四半期の値と flat file を突き合わせた。"),
        ("values_copied", True), ("fetched_via", "Apify web-fetch (formats=raw)"), ("aux_files", aux),
        ("series_count", len(ser)), ("rows", n),
    ])
    json.dump(led, open(os.path.join(OBS2, "sources", SRC + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps(dict(rows=n, series=len(ser), stat=dict(stat), gaps=sum(1 for c in checks if c["missing"]),
                          end_mismatch=[c["series_id"] for c in checks if not c["catalog_end_matches_last"]],
                          table4_vs_flat=dict(t4cmp)), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
