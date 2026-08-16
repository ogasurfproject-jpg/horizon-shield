#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# patch29: make verified reachable, and disclose why it is not.
# Determinism needs a tool call, and the gate never calls a tool without the
# owner asking. So nobody ever reached verified. This records consent for the
# operator's own endpoints, has the nightly sweep honour it, discloses the
# consent state on every row so the difference is visible rather than hidden,
# and publishes /verified.json with the passing subset, the reason the count can
# be zero, and the badge a verified server may put in its own agent card.
# Default is dry-run. --apply writes. Anchors expect exactly 1 hit each.
# After applying: deploy the gate.
import sys, subprocess, tempfile, os

APPLY = "--apply" in sys.argv
EDITS = [('workers/hs-verify-gate/src/worker.js', '// \u8868\u793a\u540d\u3002\u904b\u55b6\u8005\u304c\u4ed8\u3051\u305f\u540d\u524d\u3067\u3042\u3063\u3066\u3001\u6e2c\u5b9a\u5024\u3067\u306f\u306a\u3044\u3002register\u306e\u5fdc\u7b54\u3067\u3082\u305d\u3046\u660e\u8a18\u3059\u308b\u3002', '// \u30c4\u30fc\u30eb\u547c\u3073\u51fa\u3057\u306e\u540c\u610f\u3002\u6240\u6709\u8005\u304c\u660e\u793a\u7684\u306b\u4f9d\u983c\u3057\u305f\u30a8\u30f3\u30c9\u30dd\u30a4\u30f3\u30c8\u3060\u3051\u3092\u3053\u3053\u306b\u5165\u308c\u308b\u3002\n// determinism \u306f\u6240\u6709\u8005\u306e\u30c4\u30fc\u30eb\u30922\u56de\u547c\u3070\u306a\u3044\u3068\u6e2c\u308c\u305a\u3001\u540c\u610f\u306e\u306a\u3044\u547c\u3073\u51fa\u3057\u306f\u7d76\u5bfe\u306b\u3057\u306a\u3044\u3002\n// \u3060\u304b\u3089\u540c\u610f\u306e\u306a\u3044\u30b5\u30fc\u30d0\u30fc\u306f determinism \u304c not measured \u306e\u307e\u307e\u306b\u306a\u308a\u3001verified \u306b\u306f\u5c4a\u304b\u306a\u3044\u3002\n// \u305d\u308c\u306f\u4e0d\u5408\u683c\u3067\u306f\u306a\u304f\u3001\u6e2c\u3063\u3066\u3044\u306a\u3044\u3068\u3044\u3046\u610f\u5473\u3067\u3042\u308a\u3001register \u306e\u5fdc\u7b54\u3067\u3082\u305d\u3046\u8aac\u660e\u3059\u308b\u3002\n// \u8ffd\u52a0\u306f\u904b\u55b6\u8005\u306e\u624b\u4f5c\u696d\u3002\u6240\u6709\u8005\u304b\u3089\u306e\u4f9d\u983c\u304c\u7121\u3044\u9650\u308a\u8db3\u3055\u306a\u3044\u3002\u52dd\u624b\u306b\u8db3\u305b\u308b\u7d4c\u8def\u306f\u7528\u610f\u3057\u306a\u3044\u3002\nconst TOOL_CALL_CONSENT = new Set([\n  "https://mcp.horizonshield.dev/mcp",\n  "https://web.horizonshield.dev/mcp",\n  "https://hearing.horizonshield.dev/mcp",\n  "https://jidec.horizonshield.dev/mcp",\n  "https://gate.horizonshield.dev/mcp"\n]);\n\n// \u8868\u793a\u540d\u3002\u904b\u55b6\u8005\u304c\u4ed8\u3051\u305f\u540d\u524d\u3067\u3042\u3063\u3066\u3001\u6e2c\u5b9a\u5024\u3067\u306f\u306a\u3044\u3002register\u306e\u5fdc\u7b54\u3067\u3082\u305d\u3046\u660e\u8a18\u3059\u308b\u3002', 'consent set'), ('workers/hs-verify-gate/src/worker.js', '// \u6bce\u65e5\u306e\u518d\u6e2c\u5b9a\u3002**allow_tool_call \u306f\u6c7a\u3057\u3066\u6e21\u3055\u306a\u3044\u3002** \u4ed6\u4eba\u306e\u30c4\u30fc\u30eb\u306f\u547c\u3070\u306a\u3044\u3002', '// \u6bce\u65e5\u306e\u518d\u6e2c\u5b9a\u3002**\u540c\u610f\u306e\u306a\u3044\u30a8\u30f3\u30c9\u30dd\u30a4\u30f3\u30c8\u306b\u306f allow_tool_call \u3092\u6c7a\u3057\u3066\u6e21\u3055\u306a\u3044\u3002**\n// \u540c\u610f\u6e08\u307f (TOOL_CALL_CONSENT) \u3060\u3051 determinism \u307e\u3067\u6e2c\u308b\u3002\u540c\u610f\u306e\u6709\u7121\u306f\u5224\u5b9a\u306b\u5f71\u97ff\u3059\u308b\u306e\u3067\u3001\n// \u5404\u884c\u306e\u5fdc\u7b54\u306b tool_call_consent \u3068\u3057\u3066\u958b\u793a\u3059\u308b\u3002\u96a0\u308c\u305f\u512a\u9047\u306b\u898b\u3048\u306a\u3044\u3088\u3046\u306b\u3059\u308b\u305f\u3081\u3060\u3002', 'sweep comment'), ('workers/hs-verify-gate/src/worker.js', '      const record = await runCheck(w.endpoint, false);', '      const record = await runCheck(w.endpoint, TOOL_CALL_CONSENT.has(w.endpoint));', 'sweep honors consent'), ('workers/hs-verify-gate/src/worker.js', '    const lbl = OPERATOR_LABELS[w.endpoint];\n    if (lbl) row.operator_label = lbl;', '    const lbl = OPERATOR_LABELS[w.endpoint];\n    if (lbl) row.operator_label = lbl;\n    row.tool_call_consent = TOOL_CALL_CONSENT.has(w.endpoint);\n    if (!row.tool_call_consent) {\n      row.why_not_verified = "The owner has not asked for tool calls, so determinism is not measured and this row cannot reach verified. That is not a failure, it is an unmeasured condition.";\n    }', 'register discloses consent'), ('workers/hs-verify-gate/src/worker.js', '    // \u516c\u958b\u306e\u767b\u9332\u7c3f\u3002\u52a0\u76df\u8005\u306e\u884c\u3092\u3001\u4eba\u9593\u3082\u30a8\u30fc\u30b8\u30a7\u30f3\u30c8\u3082\u4e00\u89a7\u3067\u8aad\u3081\u308b\u3002\n    if (path === "/register" && request.method === "GET") {\n      return json(await publicRegister(env));\n    }', '    // \u516c\u958b\u306e\u767b\u9332\u7c3f\u3002\u52a0\u76df\u8005\u306e\u884c\u3092\u3001\u4eba\u9593\u3082\u30a8\u30fc\u30b8\u30a7\u30f3\u30c8\u3082\u4e00\u89a7\u3067\u8aad\u3081\u308b\u3002\n    if (path === "/register" && request.method === "GET") {\n      return json(await publicRegister(env));\n    }\n\n    // \u901a\u904e\u3057\u305f\u884c\u3060\u3051\u30020\u4ef6\u306a\u30890\u4ef6\u3068\u8fd4\u3059\u3002\u7a7a\u3092\u96a0\u3059\u305f\u3081\u306b\u57fa\u6e96\u3092\u7de9\u3081\u308b\u3053\u3068\u306f\u3057\u306a\u3044\u3002\n    if (path === "/verified.json" && request.method === "GET") {\n      const reg = await publicRegister(env);\n      const all = Array.isArray(reg.rows) ? reg.rows : [];\n      const verified = all.filter((r) => r.latest && r.latest.status === CONFIG.tier_pass);\n      return json({\n        "@context": "https://schema.org",\n        "@type": "Dataset",\n        name: "MCP servers that passed every measured condition",\n        description: "The subset of the public register whose latest scheduled measurement passed all five conditions, including determinism. Passing means the measured conditions passed on that date, from the vantage that measured them. It does not mean the numbers a server returns are correct, that the business behind it is competent, or that it is safe to use.",\n        url: "https://shield.the-horizons-innovation.com/verify-directory/",\n        license: "https://opensource.org/licenses/MIT",\n        isAccessibleForFree: true,\n        updated: new Date().toISOString(),\n        gate_commit: gateCommit(),\n        verified_count: verified.length,\n        register_count: all.length,\n        why_the_count_can_be_zero: "Determinism cannot be measured without calling a tool on the server, and this gate never calls a tool without the owner asking for it. A server whose owner has not asked stays unmeasured on that condition and therefore stays short of verified. Unmeasured is not failed.",\n        how_to_become_verified: {\n          step_1: "Check yourself with consent: POST /check with {\\"endpoint\\":\\"https://your-server/mcp\\",\\"allow_tool_call\\":true}",\n          step_2: "If it returns verified, ask the operator to record your consent so the nightly sweep measures the same way.",\n          step_3: "The row turns verified on the next sweep, and stays that way only while it keeps passing.",\n          note: "Nothing here is bought. The verdict is the measurement."\n        },\n        badge_for_a_verified_server: {\n          where: "your own /.well-known/agent-card.json",\n          why: "so an agent reading your card directly learns the record exists without visiting any page we control",\n          block: {\n            verification: {\n              provider: "HORIZON SHIELD verification gate",\n              register: "https://gate.horizonshield.dev/register",\n              your_history: "https://gate.horizonshield.dev/history?endpoint=<your endpoint>",\n              record_sha256: "<the hash of the verdict you are citing>",\n              recompute: "Fetch the history, hash the record, compare. No trust in the provider is required."\n            }\n          },\n          honesty_rule: "Publish the block only while the row actually reads verified. If it stops passing, remove it. The register will show the truth either way, so a stale badge only costs you."\n        },\n        servers: verified.map((r) => ({\n          endpoint: r.endpoint,\n          name: (r.operator_label && (r.operator_label.en || r.operator_label.ja)) || null,\n          status: r.latest.status,\n          verified_at: r.latest.at,\n          record_sha256: r.latest.record_sha256,\n          measurements: r.measurements,\n          history_url: r.history_url\n        }))\n      });\n    }', 'verified.json endpoint')]

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
        (w.count("const TOOL_CALL_CONSENT") == 1, "consent set defined once"),
        (w.count("TOOL_CALL_CONSENT.has(") == 2, "consent consulted exactly twice: sweep and register"),
        (w.count("runCheck(w.endpoint, TOOL_CALL_CONSENT.has(w.endpoint))") == 1, "sweep passes consent, not a constant"),
        ("runCheck(w.endpoint, false)" not in w, "no unconditional false left in the sweep"),
        (w.count("/verified.json") == 1, "verified endpoint added once"),
        ("why_the_count_can_be_zero" in w, "explains an empty list instead of hiding it"),
        ("why_not_verified" in w, "each unconsented row says why"),
        ("honesty_rule" in w, "badge carries a rule against stale claims"),
        ("recompute" in w, "badge tells the reader how to check it"),
        (w.count("CONFIG.tier_pass") == 4, "uses the existing pass constant (3 pre-existing + 1 new)"),
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
