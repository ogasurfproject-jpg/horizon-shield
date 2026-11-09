# -*- coding: utf-8 -*-
"""
奈良県「土木工事設計資材単価表」(毎月改定、県土マネジメント部)の 生コンクリート 行を、語の座標で読み、
地区ごとに『県が独自に値を載せている / ○=刊行物単価使用(県は値を載せていない) / 空欄=設定なし』の区別だけを観測層 v2 に出す。
v1 の tools/parse_nara_namacon_status.py(令和8年9月版)と同じ読み方を、月ごとに回せる形にしたもの(2026-10-04)。

値そのもの(円)は写さない。奈良県サイトの利用条件は「私的使用のための複製」や「引用」など著作権法上認められた場合を
除き、無断で複製・転用することはできません」(https://www.pref.nara.lg.jp/link.html)。値が要るときは evidence_url の原本を見る。

使い方:
  python3 parse_nara_shizai_status.py <観測層 v2 のルート> --month r8_10 --url <原本の URL> --title <原本の題> \
      [--last-modified <HTTP の Last-Modified>] [--etag <ETag>]
  原本は raw_restricted/nara-shizai-<月>.pdf に置いておく(raw_restricted は .gitignore)。
  出力: observations/jp/material_nara_namacon_status_<月>.csv と sources/nara-shizai-<月>.json(前の月の台帳を写して直す)。
  台帳の pages は原本の頁数(r8_10 までは手で足していた欄。2026-11-02 から parser が書く)。
  照合: 前の月の CSV と、規格の集合・地区ごとの状態を突き合わせて差を出す(差があっても止めない。報告する)。
"""
import csv, hashlib, html, json, os, re, statistics, subprocess, sys, collections
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from obs_common import write_obs, make_id

def opt(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default

ROOT = os.path.abspath(sys.argv[1])
MONTH = opt("--month")
assert MONTH and re.match(r"^r\d+_\d\d$", MONTH), "--month は r8_10 の形"
REIWA, MM = MONTH[1:].split("_")
YEAR = 2018 + int(REIWA)
PERIOD = "%d-%s" % (YEAR, MM)
SID = "nara-shizai-%s" % MONTH.replace("_", "-")
PDF = os.path.join(ROOT, "raw_restricted", SID + ".pdf")
OUT = os.path.join(ROOT, "observations", "jp", "material_nara_namacon_status_%s.csv" % MONTH)
LEDGER = os.path.join(ROOT, "sources", SID + ".json")

def words_of(pdf):
    out = subprocess.run(["pdftotext", "-bbox-layout", pdf, "-"], capture_output=True, text=True, check=True).stdout
    for pg in out.split("<page ")[1:]:
        yield [(float(a), float(b), float(c), float(d), html.unescape(w)) for a, b, c, d, w in
               re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', pg)]

NUM = re.compile(r"^\d{1,3}(,\d{3})+$|^\d+(\.\d+)?$")
DISTRICT = re.compile(r"^[１２３４５６７８９０]+地区$")
Z2H = str.maketrans("０１２３４５６７８９", "0123456789")

def extract(pdf):
    rows = []
    for pno, ws in enumerate(words_of(pdf), 1):
        heads = [w for w in ws if DISTRICT.match(w[4])]
        if len(heads) != 11:
            continue
        hy = statistics.median(w[1] for w in heads)
        cols = sorted(((w[0] + w[2]) / 2, int(w[4].replace("地区", "").translate(Z2H))) for w in heads)
        lines = {}
        for w in ws:
            if w[1] > hy + 5:
                lines.setdefault(round(w[1], 0), []).append(w)
        for y, lw in sorted(lines.items()):
            lw.sort(key=lambda t: t[0])
            names = [w for w in lw if w[4].startswith("生コンクリート")]
            if not names:
                continue
            first_col_left = cols[0][0] - 25
            unit_w = [w for w in lw if w[4] in ("ｍ３", "m3", "ｍ3") and w[0] < first_col_left]
            assert unit_w, (pno, y, [w[4] for w in lw])
            ux = unit_w[0][0]
            itemno = lw[0][4] if lw[0][4].isdigit() else ""
            name = " ".join(w[4] for w in lw if w[0] >= names[0][0] and w[0] < names[0][2] + 2)
            spec = " ".join(w[4] for w in lw if names[0][2] + 2 <= w[0] < ux)
            status = {c: "not_set" for _, c in cols}
            for w in [w for w in lw if w[0] > ux + 10]:
                cx = (w[0] + w[2]) / 2
                d, c = min((abs(cx - x), c) for x, c in cols)
                assert d < 16, (pno, spec, w, d)
                if w[4] == "○":
                    status[c] = "publication_based"
                elif NUM.match(w[4]):
                    status[c] = "published_by_prefecture"
                else:
                    raise SystemExit("unknown cell %r on page %d" % (w, pno))
            for c in sorted(status):
                rows.append({"page": str(pno), "item_no": itemno, "name": name, "spec": spec, "district": "%d地区" % c,
                             "price_status": status[c]})
    return rows

ST = {"published_by_prefecture": "published_restricted_not_copied",
      "publication_based": "publication_based_not_public", "not_set": "not_set"}
NOTE = {"published_restricted_not_copied": "県が独自調査で値を載せている。利用条件が私的使用・引用のみのため値は写していない。原本を見ること。",
        "publication_based_not_public": "原本で『○＝刊行物単価使用』。県は規格だけを載せ、単価は載せていない(市販の物価資料の値)。公的に公開された値は存在しない。",
        "not_set": "原本で空欄(取引事例が著しく少なく単価を設定していない)。"}

def previous_month_file():
    fs = sorted(f for f in os.listdir(os.path.join(ROOT, "observations", "jp"))
                if f.startswith("material_nara_namacon_status_r") and f != os.path.basename(OUT))
    return os.path.join(ROOT, "observations", "jp", fs[-1]) if fs else None

def main():
    url, title = opt("--url"), opt("--title")
    assert url and title, "--url と --title が要る"
    raw = open(PDF, "rb").read()
    sha = hashlib.sha256(raw).hexdigest()
    rows = extract(PDF)
    assert rows, "生コンクリートの行が 1 つも読めない"
    prev = previous_month_file()
    prev_rows = list(csv.DictReader(open(prev, encoding="utf-8"))) if prev else []
    item_of_spec = {}
    for r in prev_rows:
        if r["jccdb_v4_item_id"]:
            item_of_spec[r["spec"]] = r["jccdb_v4_item_id"]
    out = []
    for r in rows:
        st = ST[r["price_status"]]
        out.append({"obs_id": make_id(SID, r["page"], r["item_no"], r["district"]), "country": "JP", "layer": "material",
                    "category": "生コンクリート・モルタル", "item_name": r["name"], "spec": r["spec"], "unit": "m3",
                    "geo_level": "pref_area", "geo_code": "29", "geo_name": "奈良県", "area_label": r["district"],
                    "area_code": "", "area_members": "", "price": "", "currency": "JPY",
                    "price_basis": "design_unit_price_ex_tax", "price_status": st, "ref_value": "", "ref_note": "",
                    "period": PERIOD, "effective_from": "%s-01" % PERIOD, "source_id": SID, "source_page": r["page"],
                    "evidence_url": url, "license": "restricted", "jccdb_v4_item_id": item_of_spec.get(r["spec"], ""),
                    "note": NOTE[st]})
    n = write_obs(OUT, out)
    # 前の月との照合
    cnt = collections.Counter((r["area_label"], r["price_status"]) for r in out)
    rep = {"month": MONTH, "rows": n, "specs": len({r["spec"] for r in out}), "pdf_sha256": sha, "pdf_bytes": len(raw),
           "by_status": dict(collections.Counter(r["price_status"] for r in out))}
    if prev_rows:
        a = {(r["spec"], r["area_label"]): r["price_status"] for r in prev_rows}
        b = {(r["spec"], r["area_label"]): r["price_status"] for r in out}
        rep["previous_file"] = os.path.basename(prev)
        rep["previous_rows"] = len(prev_rows)
        rep["specs_added"] = sorted({k[0] for k in b} - {k[0] for k in a})
        rep["specs_removed"] = sorted({k[0] for k in a} - {k[0] for k in b})
        rep["status_changed"] = sorted("%s %s: %s -> %s" % (k[0], k[1], a[k], b[k]) for k in a.keys() & b.keys() if a[k] != b[k])
        rep["item_id_carried"] = sum(1 for r in out if r["jccdb_v4_item_id"])
    # 台帳: 前の月の台帳を写して、月で変わる所だけ直す
    prev_ledger = sorted(f for f in os.listdir(os.path.join(ROOT, "sources")) if f.startswith("nara-shizai-r") and f != SID + ".json")
    led = json.load(open(os.path.join(ROOT, "sources", prev_ledger[-1]), encoding="utf-8"))
    led.update({"source_id": SID, "title": title, "url": url, "effective_from": "%s-01" % PERIOD, "bytes": len(raw), "sha256": sha,
                "retrieved_at": opt("--retrieved", ""), "http_last_modified": opt("--last-modified", ""),
                "how_read": "pdftotext -bbox-layout の語の座標(tools/parsers/parse_nara_shizai_status.py --month %s。v1 の parse_nara_namacon_status.py と同じ読み方)。" % MONTH,
                "previous_edition": prev_ledger[-1][:-5]})
    if opt("--etag"):
        led["http_etag"] = opt("--etag")
    led["pages"] = sum(1 for _ in words_of(PDF))
    for k in ("license_quote_previous", "license_quote_fixed", "row_listing_previous"):
        led.pop(k, None)
    json.dump(led, open(LEDGER, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(json.dumps(rep, ensure_ascii=False, indent=1))

if __name__ == "__main__":
    main()
