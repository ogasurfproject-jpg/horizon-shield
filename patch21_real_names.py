#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# patch21: real member names on the register (both already public elsewhere),
# and JIDEC added to the watchlist so the ledger measures itself too.
# Default is dry-run. --apply writes. Anchors expect exactly 1 hit each.
# Pure ASCII on purpose.
import sys, subprocess, tempfile, os

APPLY = "--apply" in sys.argv
EDITS = [('workers/hs-verify-gate/src/worker.js', 'const DEFAULT_WATCHLIST = [\n  "https://mcp.horizonshield.dev/mcp",\n  "https://hearing.horizonshield.dev/mcp",\n  "https://web.horizonshield.dev/mcp",\n  "https://p001.horizonshield.dev/mcp",\n  "https://p002.horizonshield.dev/mcp",\n  "https://gate.horizonshield.dev/mcp"\n];', 'const DEFAULT_WATCHLIST = [\n  "https://mcp.horizonshield.dev/mcp",\n  "https://hearing.horizonshield.dev/mcp",\n  "https://web.horizonshield.dev/mcp",\n  "https://jidec.horizonshield.dev/mcp",\n  "https://p001.horizonshield.dev/mcp",\n  "https://p002.horizonshield.dev/mcp",\n  "https://gate.horizonshield.dev/mcp"\n];', 'watchlist add jidec'), ('workers/hs-verify-gate/src/worker.js', '  "https://p001.horizonshield.dev/mcp":    { ja: "\\u52a0\\u76df\\u5e97\\uff08\\u63b2\\u8f09\\u6e96\\u5099\\u4e2d\\uff09", en: "Member firm, name pending consent" },\n  "https://p002.horizonshield.dev/mcp":    { ja: "\\u52a0\\u76df\\u5e97\\uff08\\u63b2\\u8f09\\u6e96\\u5099\\u4e2d\\uff09", en: "Member firm, name pending consent" }', '  "https://jidec.horizonshield.dev/mcp":   { ja: "JIDEC \\u516c\\u958b\\u691c\\u8a3c\\u53f0\\u5e33", en: "JIDEC, the Bitcoin anchored public ledger", url: "https://ledger.horizonshield.dev/llms.txt" },\n  "https://p001.horizonshield.dev/mcp":    { ja: "\\u30ea\\u30d5\\u30a9\\u30fc\\u30e0\\u8077\\u4eba\\u682a\\u5f0f\\u4f1a\\u793e\\uff08\\u52a0\\u76dfNo.001\\uff09", en: "Reform Shokunin Co., Ltd. (member No.001, Aichi)", url: "https://shield.the-horizons-innovation.com/yakumo/no001/" },\n  "https://p002.horizonshield.dev/mcp":    { ja: "\\u30df\\u30cd\\u30aa\\u30c8\\u30fc\\u30e8\\u30fc\\u4f4f\\u5668\\u682a\\u5f0f\\u4f1a\\u793e\\uff08\\u52a0\\u76dfNo.002\\uff09", en: "Mineo Toyo Juki Co., Ltd. (member No.002)" }', 'real names and jidec label')]

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
        (w.count("jidec.horizonshield.dev/mcp") == 2, "jidec in watchlist and labels"),
        ("Reform Shokunin Co., Ltd. (member No.001, Aichi)" in w, "member 001 real name present"),
        ("Mineo Toyo Juki Co., Ltd. (member No.002)" in w, "member 002 real name present"),
        ("name pending consent" not in w, "no pending-consent placeholders left"),
        (w.count("https://p001.horizonshield.dev/mcp") == 2, "member 001 in watchlist and labels"),
        (w.count("https://p002.horizonshield.dev/mcp") == 2, "member 002 in watchlist and labels"),
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
    print("APPLY done. Now deploy the gate: cd workers/hs-verify-gate && bash deploy_gate.sh")

if __name__ == "__main__":
    main()
