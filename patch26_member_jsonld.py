#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# patch26: every member page declares the row it shows as its own schema.org
# Dataset, built at render time from the same API response the humans see,
# carrying the recomputable hash as an identifier and the same caveat about
# endorsement. A static WebPage block covers the case where no endpoint is given.
# Default is dry-run. --apply writes. Anchors expect exactly 1 hit each.
import sys, re, json, subprocess, tempfile, os

APPLY = "--apply" in sys.argv
EDITS = [('verify-directory/member.html', '</head>', '<script type="application/ld+json" id="staticld">\n{\n  "@context": "https://schema.org",\n  "@type": "WebPage",\n  "@id": "https://shield.the-horizons-innovation.com/verify-directory/member.html",\n  "name": "Member record: measured conduct of a single MCP server",\n  "description": "The measurement history of one server on the HORIZON SHIELD register, with every verdict and its recomputable record_sha256. Listing is not endorsement.",\n  "isPartOf": {"@id": "https://shield.the-horizons-innovation.com/#website"},\n  "about": {"@id": "https://shield.the-horizons-innovation.com/verify-directory/#dataset"}\n}\n</script>\n</head>', 'static webpage ld'), ('verify-directory/member.html', 'function badgeClass(stat){\n  return stat === "pass" ? "b-pass" : (stat === "pending" || stat === "held") ? "b-pend" : "b-none";\n}', 'function badgeClass(stat){\n  return stat === "pass" ? "b-pass" : (stat === "pending" || stat === "held") ? "b-pend" : "b-none";\n}\n// This page is one row of a public dataset. Declaring that row as its own Dataset lets a\n// crawler cite the record for a single server without scraping the table, and carries the\n// same caveat the humans see: a listing is not an endorsement.\nfunction injectRecordLD(row, lb){\n  try {\n    const latest = row.latest || {};\n    const name = lb.en || lb.ja || row.endpoint;\n    const ld = {\n      "@context": "https://schema.org",\n      "@type": "Dataset",\n      "@id": location.origin + location.pathname + "?endpoint=" + encodeURIComponent(row.endpoint),\n      "name": "Measured conduct record: " + name,\n      "description": "The public measurement history of " + name + " (" + row.endpoint + ") on the HORIZON SHIELD register. Latest verdict: " + (latest.status || "not measured yet") + ". Listing is not endorsement, and a passing verdict means only that the measured conditions passed on that date, from the vantage that measured them.",\n      "url": location.href,\n      "license": "https://opensource.org/licenses/MIT",\n      "isAccessibleForFree": true,\n      "creator": {"@type": "Organization", "name": "The HORIZONs Co., Ltd.", "url": "https://shield.the-horizons-innovation.com/"},\n      "isPartOf": {"@type": "Dataset", "@id": "https://shield.the-horizons-innovation.com/verify-directory/#dataset"},\n      "measurementTechnique": "Scheduled HTTP measurement with the measuring route disclosed in every verdict and the producing commit hashed into the record.",\n      "distribution": [{"@type": "DataDownload", "encodingFormat": "application/json", "contentUrl": row.history_url || (GATE + "/history?endpoint=" + encodeURIComponent(row.endpoint))}]\n    };\n    if (typeof row.measurements === "number") ld.size = row.measurements + " public measurements";\n    if (latest.at) ld.dateModified = latest.at;\n    if (latest.record_sha256) ld.identifier = "sha256:" + latest.record_sha256;\n    if (lb.url) ld.creator.sameAs = [lb.url];\n    const s = document.createElement("script");\n    s.type = "application/ld+json";\n    s.id = "recordld";\n    s.textContent = JSON.stringify(ld, null, 2);\n    document.head.appendChild(s);\n  } catch (e) {\n    // Structured data is a convenience for machines. If it cannot be built, the page\n    // still shows the humans the same records, so this failure is not worth surfacing.\n  }\n}', 'record ld injector'), ('verify-directory/member.html', '    const lb = row.operator_label || {};\n    const primary = LANG === "ja" ? (lb.ja || lb.en || row.endpoint) : (lb.en || lb.ja || row.endpoint);', '    const lb = row.operator_label || {};\n    injectRecordLD(row, lb);\n    const primary = LANG === "ja" ? (lb.ja || lb.en || row.endpoint) : (lb.en || lb.ja || row.endpoint);', 'injector call')]

def main():
    contents = {}
    ok = True
    for path, old, new, name in EDITS:
        if path not in contents:
            contents[path] = open(path, encoding="utf-8").read()
        n = contents[path].count(old)
        print("[anchor] %s: %d occurrence(s) (expect 1)" % (name, n))
        if n != 1: ok = False
    if not ok:
        print("ABORT: anchor mismatch. Nothing written.")
        sys.exit(1)
    for path, old, new, name in EDITS:
        contents[path] = contents[path].replace(old, new, 1)

    mem = contents["verify-directory/member.html"]
    LD_RE = "<script type=\"application/ld\\+json\"[^>]*>(.*?)</script>"
    blocks = re.findall(LD_RE, mem, re.S)
    checks = [
        (len(blocks) == 1, "static json-ld block present once"),
        ("function injectRecordLD" in mem, "injector defined"),
        (mem.count("    injectRecordLD(row, lb);") == 1, "injector called exactly once at render"),
        (mem.count("function injectRecordLD") == 1, "injector defined exactly once"),
        ("sha256:" in mem, "record hash used as identifier"),
        ("Listing is not endorsement" in mem, "caveat travels with the record"),
    ]
    if blocks:
        try:
            d = json.loads(blocks[0])
            checks.append((d.get("@type") == "WebPage", "static block is a WebPage"))
        except Exception as e:
            checks.append((False, "static json-ld INVALID :: %s" % e))
    for i, blk in enumerate(re.findall("<script>(.*?)</script>", mem, re.S)):
        tf = tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8"); tf.write(blk); tf.close()
        r = subprocess.run(["node", "--check", tf.name], capture_output=True, text=True)
        os.unlink(tf.name)
        checks.append((r.returncode == 0, "member script %d: node --check ok" % (i + 1) + ("" if r.returncode == 0 else " :: " + r.stderr.strip()[:160])))
    allok = True
    for good, label in checks:
        print(("[ok]  " if good else "[FAIL] ") + label)
        allok = allok and good
    if not allok:
        print("ABORT: invariant failed. Nothing written.")
        sys.exit(1)
    if not APPLY:
        print("DRY-RUN OK. Nothing written. Run with --apply to write.")
        return
    for path in contents:
        open(path, "w", encoding="utf-8").write(contents[path])
        print("[written] " + path)
    print("APPLY done. Pages only, no gate deploy needed.")

if __name__ == "__main__":
    main()
