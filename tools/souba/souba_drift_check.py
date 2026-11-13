#!/usr/bin/env python3
"""souba_drift_check.py: counts where a /souba/ page disagrees with data/souba-db.json.

    souba_drift_check.py <repo_root> [--json out.json] [--pages-glob 'souba/*/index.html'] [--indexable-only] [--old f.json ...]
    souba_drift_check.py selftest

What is counted, per page (every finding names the page, the kind, where on the page, and the text):
  V1 version      a "souba-db <version>" stamp that is not the version in data/souba-db.json _meta.version
  V2 mixed        the page stamps two or more different souba-db versions (counted once per page)
  D1 date         a souba-db update date next to a stamp of the current version, or a bare "souba-db <date>",
                  that is not _meta.updated_at
  N1 avg          a range that equals one souba-db row (min and max) with a stated average that is not that row's avg
  N2 avg_not_in_table  the body states a row's average for a range, the page has a table showing that same range,
                  and no table on the page shows that average
  N3 table_row    a table row of (min, avg, max) whose min and max equal a souba-db row but whose avg does not
  N4 old_value    a range that equals an older release's values for a row whose values have since changed
                  (older releases: data/souba-db-<version>.json in the repo, plus any --old file)
Ranges that match no row are not counted (many pages compute totals from rows; those are not drift).

Exit 0 when the total is 0, 1 when anything is counted, 2 on input error.
Standard library only. Reads files under <repo_root>; sends nothing.
"""
import glob
import html
import json
import os
import re
import sys

DATE_STAMP = re.compile(r"souba-db\s+(\d{4}-\d{2}-\d{2})")
VER = re.compile(r"souba-db\s*(?:[(（]\s*)?v?(\d+\.\d+\.\d+)")
NUM = r"(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)"
SEP = r"\s*(?:〜|～|~|から)\s*"
# lo[万][円] SEP hi (万円|円) [ /㎡ etc ] [ (平均 A (万円|円)) ]
RANGE = re.compile(r"[¥￥]?" + NUM + r"\s*(万)?\s*円?" + SEP + r"[¥￥]?" + NUM + r"\s*(万円|万|円)"
                   r"(?:\s*/\s*[^\s(（、。]{1,3})?"
                   r"(?:\s*[(（]\s*平均\s*[¥￥]?" + NUM + r"\s*(万円|万|円))?")
YEN_CELL = re.compile(r"^\s*[¥￥]?\s*" + NUM + r"\s*(万円|万|円)?\s*$")


# a date that reads as the stamp's update date: followed by 更新, a closing bracket or a tag
NEAR_DATE = re.compile(r"(20\d\d)(-|年)(\d{1,2})(-|月)(\d{1,2})(日?)(?!\d)(?=\s*(?:更新|[)）]|<|$))")


def date_near(t, pos, width=60):
    """the first date within `width` characters after a stamp, before the next stamp: (start, end, iso, groups)"""
    w = t[pos:pos + width]
    cut = w.find("souba-db")
    if cut >= 0:
        w = w[:cut]
    m = NEAR_DATE.search(w)
    if not m:
        return None
    iso = "%s-%02d-%02d" % (m.group(1), int(m.group(3)), int(m.group(5)))
    return pos + m.start(), pos + m.end(), iso, m.groups()


def num(s):
    return float(s.replace(",", ""))


def to_yen(v, unit):
    return int(round(v * 10000)) if unit and unit.startswith("万") else int(round(v))


def work_words(row):
    words = [w for w in re.split(r"[\s　()（）・、/×]+", str(row.get("work", ""))) if len(w) >= 3 and not re.match(r"^[\d,.]+", w)]
    return words or [str(row.get("cat", "")) or "\0"]


def text_of(fragment):
    s = re.sub(r"<script[^>]*>.*?</script>", " ", fragment, flags=re.S | re.I)
    s = re.sub(r"<style[^>]*>.*?</style>", " ", s, flags=re.S | re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"[ \t\r\f\v]+", " ", html.unescape(s))


def split_page(src):
    """returns (body_text_without_tables, [table_html], jsonld_text, head_text)"""
    head = ""
    m = re.search(r"<head[^>]*>(.*?)</head>", src, re.S | re.I)
    if m:
        head = m.group(1)
    jsonld = " ".join(re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', src, re.S | re.I))
    body = src[m.end():] if m else src
    tables = re.findall(r"<table.*?</table>", body, re.S | re.I)
    body_wo = re.sub(r"<table.*?</table>", " ", body, flags=re.S | re.I)
    head_meta = " ".join(re.findall(r'<(?:title|meta)[^>]*?(?:content="([^"]*)")?[^>]*>', head, re.I))
    head_meta += " " + " ".join(re.findall(r"<title>(.*?)</title>", head, re.S | re.I))
    return text_of(body_wo), tables, jsonld, head_meta


def ranges_in(text):
    out = []
    for m in RANGE.finditer(text):
        lo_s, lo_man, hi_s, hi_unit, avg_s, avg_unit = m.groups()
        hi = to_yen(num(hi_s), hi_unit)
        lo_unit = "万" if (lo_man or (hi_unit.startswith("万") and not lo_man and num(lo_s) < 10000)) else "円"
        lo = to_yen(num(lo_s), lo_unit)
        avg = to_yen(num(avg_s), avg_unit) if avg_s else None
        out.append({"lo": lo, "hi": hi, "avg": avg, "text": m.group(0), "start": m.start()})
    return out


def table_rows(table_html):
    rows = []
    for tr in re.findall(r"<tr.*?</tr>", table_html, re.S | re.I):
        cells = [text_of(c).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S | re.I)]
        rows.append(cells)
    return rows


class Db:
    def __init__(self, d):
        self.meta = d["_meta"]
        self.version = self.meta["version"]
        self.updated_at = self.meta["updated_at"]
        self.rows = d["categories"]
        self.by_pair = {}
        self.old_pairs = {}
        for c in self.rows:
            if isinstance(c.get("min"), (int, float)) and isinstance(c.get("max"), (int, float)):
                self.by_pair.setdefault((int(c["min"]), int(c["max"])), []).append(c)

    def match(self, lo, hi):
        return self.by_pair.get((lo, hi), [])

    def add_old(self, d):
        cur = {c["id"]: c for c in self.rows}
        ver = (d.get("_meta") or {}).get("version", "?")
        for c in d.get("categories") or []:
            n = cur.get(c.get("id"))
            if not n or not isinstance(c.get("min"), (int, float)) or not isinstance(c.get("max"), (int, float)):
                continue
            if (c.get("min"), c.get("max")) != (n.get("min"), n.get("max")):
                pair = (int(c["min"]), int(c["max"]))
                if pair not in self.by_pair:
                    self.old_pairs.setdefault(pair, (c["id"], ver, n))


def check_page(src, db, page="page"):
    found = []

    def add(kind, where, text, note=""):
        found.append({"page": page, "kind": kind, "where": where, "text": text.strip()[:160], "note": note})

    body, tables, jsonld, headm = split_page(src)
    parts = [("body", body), ("table", " ".join(text_of(t) for t in tables)), ("jsonld", jsonld), ("head", headm)]
    seen_versions = set()
    for where, t in parts:
        for m in VER.finditer(t):
            v = m.group(1)
            seen_versions.add(v)
            if v != db.version:
                add("V1_version", where, t[max(0, m.start() - 20):m.end() + 20], "%s, souba-db.json is %s" % (v, db.version))
            else:
                dn = date_near(t, m.end())
                if dn and dn[2] != db.updated_at:
                    add("D1_date", where, t[m.start():dn[1]], "%s, souba-db.json updated_at is %s" % (dn[2], db.updated_at))
        for m in DATE_STAMP.finditer(t):
            if m.group(1) != db.updated_at:
                add("D1_date", where, t[max(0, m.start() - 20):m.end()], "%s, souba-db.json updated_at is %s" % (m.group(1), db.updated_at))
    if len(seen_versions) >= 2:
        add("V2_mixed", "page", ", ".join(sorted(seen_versions)), "two or more souba-db versions on one page")

    # numbers in prose (body, json-ld, head): stated averages
    table_texts = [text_of(t) for t in tables]
    table_ranges = [r for tt in table_texts for r in ranges_in(tt)]
    table_numbers = set()
    for tt in table_texts:
        for x in re.findall(NUM + r"\s*(万円|万|円)?", tt):
            v = num(x[0])
            table_numbers.add(to_yen(v, x[1] or ("万" if v < 1000 and "万" in tt else "円")))
            table_numbers.add(int(round(v)))
            table_numbers.add(int(round(v * 10000)))
    reported_n2 = set()
    for where, t in parts:
        for r in ranges_in(t):
            old = db.old_pairs.get((r["lo"], r["hi"]))
            # an older pair counts only when the row's own words stand next to it (4〜6万円 is also a scaffold price)
            near = t[max(0, r["start"] - 100):r["start"] + len(r["text"]) + 100]
            if old and any(w in near for w in work_words(old[2])):
                add("N4_old_value", where, r["text"], "souba-db %s had %s〜%s for %s; %s has %s〜%s" % (
                    old[1], r["lo"], r["hi"], old[0], db.version, old[2]["min"], old[2]["max"]))
    for where, t in parts[:1] + parts[2:]:
        for r in ranges_in(t):
            rows = db.match(r["lo"], r["hi"])
            if not rows or r["avg"] is None:
                continue
            if all(r["avg"] != int(c["avg"]) for c in rows):
                add("N1_avg", where, r["text"], "souba-db %s avg %s" % (rows[0]["id"], rows[0]["avg"]))
                continue
            if where != "body":
                continue
            in_table = any(tr["lo"] == r["lo"] and tr["hi"] == r["hi"] for tr in table_ranges)
            if in_table and r["avg"] not in table_numbers and (r["lo"], r["hi"]) not in reported_n2:
                reported_n2.add((r["lo"], r["hi"]))
                add("N2_avg_not_in_table", where, r["text"], "the table shows %s〜%s without the average" % (r["lo"], r["hi"]))
    # table rows with explicit min / avg / max cells
    for t in tables:
        for cells in table_rows(t):
            vals = []
            for c in cells:
                m = YEN_CELL.match(c.replace(" ", ""))
                if m:
                    vals.append(to_yen(num(m.group(1)), m.group(2) or "円"))
            if len(vals) == 3 and vals[0] <= vals[1] <= vals[2]:
                rows = db.match(vals[0], vals[2])
                if rows and all(vals[1] != int(c["avg"]) for c in rows):
                    add("N3_table_row", "table", " | ".join(cells), "souba-db %s avg %s" % (rows[0]["id"], rows[0]["avg"]))
        # range cells with an average next to them, e.g. 9〜20万円(平均14万円)
        for r in ranges_in(text_of(t)):
            rows = db.match(r["lo"], r["hi"])
            if rows and r["avg"] is not None and all(r["avg"] != int(c["avg"]) for c in rows):
                add("N1_avg", "table", r["text"], "souba-db %s avg %s" % (rows[0]["id"], rows[0]["avg"]))
    return found


def is_indexable(src):
    m = re.search(r'<meta[^>]+name=["\']robots["\'][^>]+content=["\']([^"\']*)', src, re.I)
    return not (m and "noindex" in m.group(1).lower())


def run(root, pages_glob, indexable_only, old_files=()):
    db = Db(json.load(open(os.path.join(root, "data", "souba-db.json"), encoding="utf-8")))
    olds = sorted(glob.glob(os.path.join(root, "data", "souba-db-*.json"))) + list(old_files)
    for f in olds:
        db.add_old(json.load(open(f, encoding="utf-8")))
    pages = sorted(glob.glob(os.path.join(root, pages_glob)))
    per_page = []
    for p in pages:
        src = open(p, encoding="utf-8").read()
        idx = is_indexable(src)
        if indexable_only and not idx:
            continue
        rel = os.path.relpath(p, root)
        f = check_page(src, db, rel)
        per_page.append({"page": rel, "indexable": idx, "findings": f})
    kinds = {}
    for pp in per_page:
        for f in pp["findings"]:
            kinds[f["kind"]] = kinds.get(f["kind"], 0) + 1
    total = sum(kinds.values())
    summary = {
        "souba_db_version": db.version, "souba_db_updated_at": db.updated_at, "older_releases_read": len(olds),
        "pages": len(per_page), "pages_indexable": sum(1 for p in per_page if p["indexable"]),
        "pages_with_findings": sum(1 for p in per_page if p["findings"]),
        "pages_with_findings_indexable": sum(1 for p in per_page if p["findings"] and p["indexable"]),
        "findings": total, "by_kind": dict(sorted(kinds.items())),
        "findings_indexable": sum(len(p["findings"]) for p in per_page if p["indexable"]),
    }
    return summary, per_page


GOOD_DB = {"_meta": {"version": "2.3.0", "updated_at": "2026-10-18"},
           "categories": [{"id": "floor_harikae_sqm", "min": 8000, "avg": 11000, "max": 15000},
                          {"id": "floor_harikae_6jo", "min": 90000, "avg": 140000, "max": 200000},
                          {"id": "denki_aircon", "work": "エアコン取付工事 1台", "min": 15000, "avg": 22000, "max": 30000}]}


def selftest():
    db = Db(GOOD_DB)
    fails = 0

    def expect(name, src, want):
        nonlocal fails
        got = sorted(f["kind"] for f in check_page(src, db))
        ok = got == sorted(want)
        fails += not ok
        print("%s %s %s" % ("ok  " if ok else "NG  ", name, "" if ok else "got %s want %s" % (got, want)))

    clean = ("<html><head><title>t</title></head><body><p>㎡8,000〜15,000円(平均11,000円)(souba-db 2.3.0)</p>"
             "<table><tr><td>複合</td><td>8,000〜15,000円/㎡(平均11,000円)</td><td>9〜20万円(平均14万円)</td></tr></table>"
             "<p>出どころ souba-db 2.3.0(2026-10-18 更新)</p></body></html>")
    expect("clean page counts 0", clean, [])
    flooring = ("<html><head></head><body><p>結論 6畳で9〜20万円(平均14万円)(souba-db 2.2.0)。</p>"
                "<p>souba-db(2.3.0、2026年10月18日更新)</p>"
                "<table><tr><td>8,000〜15,000円/㎡</td><td>9〜20万円(平均14万円)</td></tr></table>"
                "<p>数字の出どころ: souba-db 2.2.0(2026-08-17 更新)</p>"
                "<p>平米8,000円から15,000円(平均11,000円)が適正な幅です。</p></body></html>")
    expect("flooring shape: two stale stamps, mixed, average not in table", flooring,
           ["V1_version", "V1_version", "V2_mixed", "N2_avg_not_in_table"])
    expect("wrong average in prose", "<html><head></head><body><p>9〜20万円(平均15万円)</p></body></html>", ["N1_avg"])
    expect("wrong average in a min/avg/max table row",
           "<html><head></head><body><table><tr><td>エアコン</td><td>¥15,000</td><td>¥25,000</td><td>¥30,000</td></tr></table></body></html>",
           ["N3_table_row"])
    expect("current version with a stale date", "<html><head></head><body><p>souba-db 2.3.0(2026-08-17 更新)</p></body></html>", ["D1_date"])
    expect("a range that is no row is not counted", "<html><head></head><body><p>70〜130万円(平均100万円)</p></body></html>", [])
    expect("a bare dated stamp", "<html><head></head><body><p>souba index v1.7）／souba-db 2026-06-15</p></body></html>", ["D1_date"])
    expect("a survey date after a stamp is not its update date", "<html><head></head><body><p>souba-db 2.3.0。業界平均(2026年4月205社調査)</p></body></html>", [])
    expect("a phone number after a stamp is not a date", "<html><head></head><body><p>souba-db 2.3.0 の版の日)。 TEL: 0463-74-5917</p></body></html>", [])
    expect("v-prefixed old stamp", "<html><head></head><body><p>souba-db v2.1.0 / souba index v1.7</p></body></html>", ["V1_version"])
    db.add_old({"_meta": {"version": "2.2.0"}, "categories": [{"id": "denki_aircon", "min": 18000, "avg": 25000, "max": 35000}]})
    expect("an older release's range is caught", "<html><head></head><body><p>エアコン取付工事 1台1.8〜3.5万円</p></body></html>", ["N4_old_value"])
    expect("the same numbers for another work are not", "<html><head></head><body><p>足場 1.8〜3.5万円</p></body></html>", [])
    print("SELFTEST %s" % ("ok" if not fails else "NG"))
    return 0 if not fails else 1


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 2
    if argv[0] == "selftest":
        return selftest()
    root = argv[0]
    out = None
    pages_glob = "souba/*/index.html"
    indexable_only = False
    old_files = []
    i = 1
    while i < len(argv):
        if argv[i] == "--json":
            out = argv[i + 1]; i += 2
        elif argv[i] == "--pages-glob":
            pages_glob = argv[i + 1]; i += 2
        elif argv[i] == "--old":
            old_files.append(argv[i + 1]); i += 2
        elif argv[i] == "--indexable-only":
            indexable_only = True; i += 1
        else:
            print("unknown argument %s" % argv[i]); return 2
    try:
        summary, per_page = run(root, pages_glob, indexable_only, old_files)
    except (OSError, ValueError, KeyError) as e:
        print("input error: %s" % e)
        return 2
    for pp in per_page:
        if pp["findings"]:
            print("%s%s  %d" % (pp["page"], "" if pp["indexable"] else " (noindex)", len(pp["findings"])))
            for f in pp["findings"]:
                print("   %-20s %-6s %s  [%s]" % (f["kind"], f["where"], f["text"].replace("\n", " "), f["note"]))
    print("SUMMARY " + json.dumps(summary, ensure_ascii=False))
    if out:
        with open(out, "w", encoding="utf-8") as fh:
            json.dump({"summary": summary, "pages": per_page}, fh, ensure_ascii=False, indent=1)
    return 0 if summary["findings"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
