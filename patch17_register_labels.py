#!/usr/bin/env python3
"""patch17: registerに運営者ラベル、verify-directoryをカード表示に。
既定はdry-run。--applyで書く。全アンカー期待1件。1つでも外れたら1バイトも書かない。
適用後の不変条件: node --check がworkerの構文を通すこと、新旧マーカーの個数一致。
"""
import sys, subprocess, tempfile, os

APPLY = "--apply" in sys.argv
EDITS = [('workers/hs-verify-gate/src/worker.js', 'const REGISTER_JOIN_MAX = 50;', '// 表示名。運営者が付けた名前であって、測定値ではない。registerの応答でもそう明記する。\n// 加盟店の実名は本人の書面同意が取れてから入れる。それまでは掲載準備中。\nconst OPERATOR_LABELS = {\n  "https://mcp.horizonshield.dev/mcp":     { ja: "KIRA\\u9069\\u6b63\\u8a3a\\u65ad", en: "KIRA fair price audit (the flagship MCP server)" },\n  "https://web.horizonshield.dev/mcp":     { ja: "KIRA\\u76f8\\u8ac7\\u7a93\\u53e3", en: "KIRA intake desk for renovation questions" },\n  "https://hearing.horizonshield.dev/mcp": { ja: "YAKUMO\\u52a0\\u76df\\u5e97\\u30c7\\u30a3\\u30ec\\u30af\\u30c8\\u30ea", en: "YAKUMO verified contractor directory" },\n  "https://gate.horizonshield.dev/mcp":    { ja: "\\u691c\\u8a3c\\u30b2\\u30fc\\u30c8\\uff08\\u3053\\u306e\\u691c\\u67fb\\u6a5f\\u81ea\\u8eab\\uff09", en: "The verification gate, measuring itself" },\n  "https://p001.horizonshield.dev/mcp":    { ja: "\\u52a0\\u76df\\u5e97\\uff08\\u63b2\\u8f09\\u6e96\\u5099\\u4e2d\\uff09", en: "Member firm, name pending consent" },\n  "https://p002.horizonshield.dev/mcp":    { ja: "\\u52a0\\u76df\\u5e97\\uff08\\u63b2\\u8f09\\u6e96\\u5099\\u4e2d\\uff09", en: "Member firm, name pending consent" }\n};\n\nconst REGISTER_JOIN_MAX = 50;', 'labels map'), ('workers/hs-verify-gate/src/worker.js', '    if (joined < REGISTER_JOIN_MAX) {\n      joined++;', '    const lbl = OPERATOR_LABELS[w.endpoint];\n    if (lbl) row.operator_label = lbl;\n    if (joined < REGISTER_JOIN_MAX) {\n      joined++;', 'row merge'), ('workers/hs-verify-gate/src/worker.js', 'Webhooks are never published. Every stored verdict carries a record_sha256 you can recompute yourself.",', 'Webhooks are never published. Every stored verdict carries a record_sha256 you can recompute yourself. The operator_label field is a display name assigned by the operator, not a measurement.",', 'register note'), ('verify-directory/index.html', '</style>', '.regcard{border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:14px 16px;margin:10px 0;background:rgba(255,255,255,.03)}\n.regtop{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap}\n.regname{font-weight:700;font-size:1.05rem}\n.regbadge{font-size:.75rem;padding:2px 10px;border-radius:999px;border:1px solid}\n.b-pass{color:#7ee2a8;border-color:#2f6f4a}\n.b-pend{color:#e2c97e;border-color:#6f5c2f}\n.b-none{color:#9aa4b2;border-color:#3a4250}\n.regdesc{color:#9aa4b2;font-size:.85rem;margin-top:4px}\n.regmeta{display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;font-size:.8rem;align-items:baseline}\n.regmeta .mono{opacity:.75}\n</style>', 'card css'), ('verify-directory/index.html', '    rows.forEach(function(r){\n      const d = document.createElement("div"); d.className = "regrow";\n      const ep = document.createElement("span"); ep.className = "mono grow"; ep.textContent = r.endpoint; d.appendChild(ep);\n      const st = document.createElement("span"); st.className = "mono";\n      st.textContent = (r.latest && r.latest.status)\n        ? (r.latest.status + " \\u00b7 " + String(r.latest.at || "").slice(0, 10))\n        : "no measurement stored yet";\n      d.appendChild(st);\n      if (typeof r.measurements === "number"){\n        const m = document.createElement("span"); m.className = "mono";\n        m.textContent = r.measurements + (r.measurements === 1 ? " measurement" : " measurements");\n        d.appendChild(m);\n      }\n      const h = document.createElement("a"); h.href = r.history_url; h.textContent = "history"; d.appendChild(h);\n      const b = document.createElement("a"); b.href = "#"; b.textContent = "measure now";\n      b.addEventListener("click", function(ev){\n        ev.preventDefault();\n        const inp = document.getElementById("epin");\n        if (inp) inp.value = r.endpoint;\n        runCheck(r.endpoint);\n      });\n      d.appendChild(b);\n      box.appendChild(d);\n    });', '    rows.forEach(function(r){\n      const d = document.createElement("div"); d.className = "regcard";\n      const top = document.createElement("div"); top.className = "regtop";\n      const nm = document.createElement("span"); nm.className = "regname";\n      nm.textContent = (r.operator_label && r.operator_label.ja) ? r.operator_label.ja : r.endpoint;\n      top.appendChild(nm);\n      const stat = (r.latest && r.latest.status) ? r.latest.status : "not yet measured";\n      const st = document.createElement("span");\n      st.className = "regbadge " + (stat === "pass" ? "b-pass" : (stat === "pending" || stat === "held") ? "b-pend" : "b-none");\n      st.textContent = stat + ((r.latest && r.latest.at) ? " \\u00b7 " + String(r.latest.at).slice(0, 10) : "");\n      top.appendChild(st);\n      d.appendChild(top);\n      if (r.operator_label && r.operator_label.en){\n        const en = document.createElement("div"); en.className = "regdesc"; en.textContent = r.operator_label.en; d.appendChild(en);\n      }\n      const meta = document.createElement("div"); meta.className = "regmeta";\n      const ep = document.createElement("span"); ep.className = "mono"; ep.textContent = r.endpoint; meta.appendChild(ep);\n      if (typeof r.measurements === "number"){\n        const m = document.createElement("span"); m.className = "mono";\n        m.textContent = r.measurements + (r.measurements === 1 ? " measurement" : " measurements");\n        meta.appendChild(m);\n      }\n      const h = document.createElement("a"); h.href = r.history_url; h.textContent = "history"; meta.appendChild(h);\n      const b = document.createElement("a"); b.href = "#"; b.textContent = "measure now";\n      b.addEventListener("click", function(ev){\n        ev.preventDefault();\n        const inp = document.getElementById("epin");\n        if (inp) inp.value = r.endpoint;\n        runCheck(r.endpoint);\n      });\n      meta.appendChild(b);\n      d.appendChild(meta);\n      box.appendChild(d);\n    });', 'card renderer')]

def main():
    contents = {}
    for path, old, new, name in EDITS:
        if path not in contents:
            contents[path] = open(path, encoding="utf-8").read()
        n = contents[path].count(old)
        print(f"[anchor] {name}: {n} occurrence(s) (expect 1)")
        if n != 1:
            print("ABORT: anchor count mismatch. Nothing written.")
            sys.exit(1)
    for path, old, new, name in EDITS:
        contents[path] = contents[path].replace(old, new, 1)

    w = contents["workers/hs-verify-gate/src/worker.js"]
    p = contents["verify-directory/index.html"]
    checks = [
        (w.count("OPERATOR_LABELS") == 2, "worker: OPERATOR_LABELS defined and used (2x)"),
        (w.count("operator_label") == 2, "worker: operator_label set + disclosed"),
        (p.count(".regcard{") == 1, "page: card css present once"),
        (p.count("regbadge") == 2, "page: badge class in css and renderer (2x)"),
        ("rows.forEach(function(r){" in p, "page: renderer present"),
    ]
    tf = tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8")
    tf.write(w); tf.close()
    try:
        r = subprocess.run(["node", "--check", tf.name], capture_output=True, text=True)
        checks.append((r.returncode == 0, "worker: node --check syntax ok" + ("" if r.returncode == 0 else " :: " + r.stderr.strip()[:200])))
    finally:
        os.unlink(tf.name)
    ok = True
    for good, label in checks:
        print(("[ok]  " if good else "[FAIL] ") + label)
        ok = ok and good
    if not ok:
        print("ABORT: invariant failed. Nothing written.")
        sys.exit(1)
    if not APPLY:
        print("DRY-RUN成立。書き込みはしていない。--applyで適用する。")
        return
    for path in contents:
        open(path, "w", encoding="utf-8").write(contents[path])
        print(f"[written] {path}")
    print("APPLY完了。")

if __name__ == "__main__":
    main()
