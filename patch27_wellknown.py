#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# patch27: serve the register at a well known path. A machine that has only the
# hostname can find it by convention instead of being told, and the payload is
# schema.org Dataset shaped so a crawler that reads nothing else still learns
# what the rows are, what they do not claim, and how to dispute one.
# Default is dry-run. --apply writes. Anchors expect exactly 1 hit each.
# After applying: deploy the gate.
import sys, subprocess, tempfile, os

APPLY = "--apply" in sys.argv
EDITS = [('workers/hs-verify-gate/src/worker.js', '    if (path === "/.well-known/agent-card.json") return json(ownAgentCard(url.origin));', '    if (path === "/.well-known/agent-card.json") return json(ownAgentCard(url.origin));\n    // A machine that has only the hostname can find the register without being told where\n    // to look. Same bytes as /register, plus the statement of what the rows are and are not,\n    // shaped so that a crawler which reads nothing else still quotes it correctly.\n    if (path === "/.well-known/mcp-register.json" && request.method === "GET") {\n      const reg = await publicRegister(env);\n      return json({\n        "@context": "https://schema.org",\n        "@type": "Dataset",\n        "@id": "https://github.com/ogasurfproject-jpg/mcp-conduct-register#dataset",\n        name: "MCP Conduct Register: measured conduct of Model Context Protocol servers",\n        description: "A machine generated record of how MCP servers behaved when measured. Not a curated list, not a ranking, not an endorsement. Rows are produced by a scheduled measurement, not by selection.",\n        url: "https://shield.the-horizons-innovation.com/verify-directory/",\n        license: "https://opensource.org/licenses/MIT",\n        isAccessibleForFree: true,\n        creator: {\n          "@type": "Organization",\n          name: "The HORIZONs Co., Ltd.",\n          url: "https://shield.the-horizons-innovation.com/",\n          founder: { "@type": "Person", name: "Toshikatsu Oga", identifier: "https://orcid.org/0009-0000-9180-903X" }\n        },\n        distribution: [\n          { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: "https://gate.horizonshield.dev/register" },\n          { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: "https://raw.githubusercontent.com/ogasurfproject-jpg/mcp-conduct-register/main/register.json" },\n          { "@type": "application/atom+xml", encodingFormat: "application/atom+xml", contentUrl: "https://raw.githubusercontent.com/ogasurfproject-jpg/mcp-conduct-register/main/feed.xml" }\n        ],\n        rows_are_selected_by: "nobody, the schedule decides what is measured and the code copies the result",\n        what_this_does_not_claim: "That a listed server returns correct numbers, that the business behind it is competent, or that it is safe to use.",\n        disputes: {\n          how: "Measure any listed endpoint yourself and submit the observation to the public ledger under your own name and vantage.",\n          intake: "https://ledger.horizonshield.dev/witness",\n          operator_veto: "none, the code has no route to refuse a schema valid submission"\n        },\n        count: reg.count,\n        gate_commit: reg.gate_commit,\n        rows: reg.rows\n      });\n    }', 'well-known register endpoint')]

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

    w = contents["workers/hs-verify-gate/src/worker.js"]
    checks = [
        (w.count("/.well-known/mcp-register.json") == 1, "well known route added once"),
        (w.count("/.well-known/agent-card.json") == 4, "agent card references untouched (4 pre-existing)"),
        ("what_this_does_not_claim" in w, "payload states its limits"),
        ("rows_are_selected_by" in w, "payload states its provenance"),
        ("operator_veto" in w, "payload states the dispute route"),
        ("orcid.org/0009-0000-9180-903X" in w, "author identified by ORCID"),
        ("publicRegister(env)" in w, "reuses the same register builder"),
    ]
    tf = tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8"); tf.write(w); tf.close()
    r = subprocess.run(["node", "--check", tf.name], capture_output=True, text=True)
    os.unlink(tf.name)
    checks.append((r.returncode == 0, "worker: node --check ok" + ("" if r.returncode == 0 else " :: " + r.stderr.strip()[:200])))
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
    print("APPLY done. Now deploy: cd workers/hs-verify-gate && bash deploy_gate.sh")

if __name__ == "__main__":
    main()
