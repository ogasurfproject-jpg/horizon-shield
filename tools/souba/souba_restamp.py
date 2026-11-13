#!/usr/bin/env python3
"""souba_restamp.py: brings /souba/ pages back in line with data/souba-db.json, from the dataset, not by hand.

    souba_restamp.py <repo_root> [--write] [--indexable-only] [--old f.json ...] [--exclude pages.json]
    souba_restamp.py selftest

What it changes, and only on a page whose numbers already equal the current souba-db
(no N1, N3 or N4 finding from souba_drift_check.py; such a page is listed and left alone):
  - every "souba-db <version>" stamp becomes _meta.version, and the first date within 60 characters after it
    (2026-08-17 or 2026年8月17日, before any next stamp) becomes _meta.updated_at in the same form;
    a bare "souba-db <date>" too
  - a table cell showing a row's range without its average gets "(平均 ...)" in the cell's own unit,
    when the body of the same page already states that average (N2)
--exclude: a JSON file whose "experiments" lists /souba/<name>/ paths; those pages are left as they are (listed).
Without --write it prints what it would change and writes nothing. Standard library only; sends nothing.
"""
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import souba_drift_check as chk  # noqa: E402

STAMP_VER = re.compile(r"(souba-db\s*(?:[(（]\s*)?v?)(\d+\.\d+\.\d+)")
BARE_DATE = re.compile(r"(souba-db\s+)(\d{4}-\d{2}-\d{2})")


def fmt_date(iso, sep1, sep2, tail):
    y, m, d = iso.split("-")
    if sep1 == "年":
        return "%s年%d月%d日" % (y, int(m), int(d)) if tail else "%s年%d月%d" % (y, int(m), int(d))
    return "%s-%s-%s" % (y, m, d)


def restamp(src, db):
    """every stamp to the current version, and the first date within 60 characters after it to updated_at"""
    n = 0
    out = []
    last = 0
    for m in STAMP_VER.finditer(src):
        out.append(src[last:m.start()])
        piece = m.group(1) + db.version
        if m.group(0) != piece:
            n += 1
        out.append(piece)
        last = m.end()
        dn = chk.date_near(src, m.end())
        if dn and dn[2] != db.updated_at:
            y, s1, mo, s2, d, tail = dn[3]
            out.append(src[last:dn[0]])
            out.append(fmt_date(db.updated_at, s1, s2, tail))
            last = dn[1]
            if m.group(0) == piece:
                n += 1
    out.append(src[last:])
    src = "".join(out)

    def rep2(m):
        nonlocal n
        if m.group(2) == db.updated_at:
            return m.group(0)
        n += 1
        return m.group(1) + db.updated_at
    src = BARE_DATE.sub(rep2, src)
    return src, n


def man(v):
    x = v / 10000.0
    return ("%d" % x) if abs(x - round(x)) < 1e-9 else ("%.1f" % x)


def add_table_avgs(src, db, findings):
    """for each N2 finding, put the average into the first table cell that shows the same range"""
    n = 0
    want = []
    for f in findings:
        if f["kind"] != "N2_avg_not_in_table":
            continue
        rs = chk.ranges_in(f["text"])
        r = rs[0] if rs else None
        if r and r["avg"] is not None:
            want.append(r)
    for r in want:
        done = False

        def fix_table(tm):
            nonlocal done, n
            t = tm.group(0)
            if done:
                return t

            def fix_cell(cm):
                nonlocal done, n
                cell = cm.group(2)
                if done or "平均" in cell:
                    return cm.group(0)
                for rr in chk.ranges_in(chk.text_of(cell)):
                    if rr["lo"] == r["lo"] and rr["hi"] == r["hi"] and rr["avg"] is None:
                        unit_man = "万" in rr["text"]
                        avg = ("%s万円" % man(r["avg"])) if unit_man else ("{:,}円".format(r["avg"]))
                        done = True
                        n += 1
                        return cm.group(1) + cell.rstrip() + "(平均" + avg + ")" + cm.group(3)
                return cm.group(0)
            return re.sub(r"(<td[^>]*>)([^<]*)(</td>)", fix_cell, t)
        src = re.sub(r"<table.*?</table>", fix_table, src, flags=re.S | re.I)
    return src, n


def run(root, write, indexable_only, old_files, exclude=()):
    summary, per_page = chk.run(root, "souba/*/index.html", indexable_only, old_files)
    held = []
    db = chk.Db(json.load(open(os.path.join(root, "data", "souba-db.json"), encoding="utf-8")))
    changed, skipped = [], []
    for pp in per_page:
        kinds = {f["kind"] for f in pp["findings"]}
        if not kinds:
            continue
        if "/" + os.path.dirname(pp["page"]) + "/" in exclude:
            held.append(pp["page"])
            continue
        if kinds & {"N1_avg", "N3_table_row", "N4_old_value"}:
            skipped.append((pp["page"], sorted(kinds)))
            continue
        path = os.path.join(root, pp["page"])
        src = open(path, encoding="utf-8").read()
        new, a = restamp(src, db)
        new, b = add_table_avgs(new, db, pp["findings"])
        if new != src:
            changed.append((pp["page"], a, b))
            if write:
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(new)
    return changed, skipped, held


def selftest():
    db = chk.Db(chk.GOOD_DB)
    fails = 0
    src = ("<html><head></head><body><p>結論 6畳で9〜20万円(平均14万円)(souba-db 2.2.0)。</p>"
           "<p>souba-db(2.3.0、2026年10月18日更新)</p>"
           "<table><tr><td>8,000〜15,000円/㎡</td><td>9〜20万円(平均14万円)</td></tr></table>"
           "<p>数字の出どころ: souba-db 2.2.0(2026-08-17 更新)</p><p>souba-db v2.1.0(2026-06-15)／souba-db 2026-06-15</p>"
           "<p>平米8,000円から15,000円(平均11,000円)が適正な幅です。</p></body></html>")
    before = chk.check_page(src, db)
    new, a = restamp(src, db)
    new, b = add_table_avgs(new, db, before)
    after = chk.check_page(new, db)
    ok = (not after) and a == 4 and b == 1 and "8,000〜15,000円/㎡(平均11,000円)" in new and "souba-db 2.3.0(2026-10-18 更新)" in new and "v2.3.0(2026-10-18)" in new
    fails += not ok
    print("%s flooring shape goes to 0 (stamps %d, cells %d, left %s)" % ("ok  " if ok else "NG  ", a, b, [f["kind"] for f in after]))
    same, a2 = restamp(new, db)
    ok2 = same == new and a2 == 0
    fails += not ok2
    print("%s a second run changes nothing" % ("ok  " if ok2 else "NG  "))
    jp = "<p>souba-db(2.2.0、2026年8月17日更新)</p>"
    out, _ = restamp(jp, db)
    ok3 = out == "<p>souba-db(2.3.0、2026年10月18日更新)</p>"
    fails += not ok3
    print("%s the Japanese date form is kept (%s)" % ("ok  " if ok3 else "NG  ", out))
    tagged = "<strong>souba-db 2.2.0</strong>（2026-08-17更新）と souba-db 2.3.0(建設実務30年の監修、2026-08-17 更新)"
    out, k = restamp(tagged, db)
    ok4 = out == "<strong>souba-db 2.3.0</strong>（2026-10-18更新）と souba-db 2.3.0(建設実務30年の監修、2026-10-18 更新)" and k == 2
    fails += not ok4
    print("%s a date behind a tag or a few words is reached (%s)" % ("ok  " if ok4 else "NG  ", out))
    print("SELFTEST %s" % ("ok" if not fails else "NG"))
    return 0 if not fails else 1


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 2
    if argv[0] == "selftest":
        return selftest()
    root = argv[0]
    write = "--write" in argv
    indexable_only = "--indexable-only" in argv
    old_files = [argv[i + 1] for i, a in enumerate(argv) if a == "--old"]
    exclude = set()
    for i, a in enumerate(argv):
        if a == "--exclude":
            ex = json.load(open(argv[i + 1], encoding="utf-8"))
            for ps in (ex.get("experiments") or {}).values():
                exclude.update(ps)
    changed, skipped, held = run(root, write, indexable_only, old_files, exclude)
    for p, a, b in changed:
        print("%s %s  stamps %d, table averages %d" % ("wrote" if write else "would", p, a, b))
    for p, k in skipped:
        print("left  %s  numbers differ from souba-db (%s); fix the numbers first" % (p, ",".join(k)))
    for p in held:
        print("held  %s  in a registered experiment (--exclude)" % p)
    print("SUMMARY pages %d, stamps %d, table averages %d, left %d, held %d%s" % (
        len(changed), sum(x[1] for x in changed), sum(x[2] for x in changed), len(skipped), len(held), "" if write else " (dry run)"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
