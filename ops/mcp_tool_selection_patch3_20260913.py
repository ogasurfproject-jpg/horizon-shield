#!/usr/bin/env python3
"""
ops/mcp_tool_selection_patch3_20260913.py  (patch2 の続き。hs-mcp 1.0.7 -> 1.0.8)

本番実測(Version 55ced515): find_verified_contractor の一次ソース fetch(hearing.horizonshield.dev)が
hs-mcp Worker の中から通らず、静的 JSON に落ちとった(source = published static)。mcp.horizonshield.dev も
hearing.horizonshield.dev も同じ zone の Route なので、Worker から Worker への公開 hostname 経由の fetch は
Cloudflare が通さん。hs-jidec-mcp -> hs-ledger と同じく Service Binding で繋ぐ。

  S1 wrangler.jsonc に services: HEARING_SVC -> hs-hearing
  S2 handler は env.HEARING_SVC.fetch を一番目に、公開 fetch を二番目に、静的 JSON を三番目に。どれで読んだかは source に出る。
  S3 version 1.0.8、test1 の固定値

既定は dry-run。--apply で書く(.bak を先に残す)。各 anchor は count==1 を assert。
"""
import sys, os, re, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, "workers", "hs-mcp", "src", "mcp.js")
WRANGLER = os.path.join(ROOT, "workers", "hs-mcp", "wrangler.jsonc")
TEST1 = os.path.join(ROOT, "workers", "hs-mcp", "test", "tool_selection.test.mjs")
APPLY = "--apply" in sys.argv

src = open(TARGET, encoding="utf-8").read(); orig = src
wr = open(WRANGLER, encoding="utf-8").read(); wr_orig = wr

def rep_in(text, anchor, new, label):
    n = text.count(anchor)
    assert n == 1, "%s: anchor count %d != 1" % (label, n)
    print("ok   " + label)
    return text.replace(anchor, new)

src = rep_in(src, 'const SERVER = { name: "horizon-shield", version: "1.0.7" };',
                  'const SERVER = { name: "horizon-shield", version: "1.0.8" };', "S3 version 1.0.7 -> 1.0.8")

src = rep_in(src, '''    let data = null, srcLabel = null;
    try {
      const r = await fetch(YAKUMO_LIVE_URL, { cf: { cacheTtl: 300 } });
      if (r && r.ok) { data = await r.json(); srcLabel = "hs-hearing contractors.json (live KV)"; }
    } catch (_e) { /* fall through to static */ }''',
'''    let data = null, srcLabel = null;
    // [2026-09-13 patch3] 同じ zone の Route 同士は公開 hostname 経由で fetch できん(本番実測で静的に落ちとった)。
    // Service Binding を一番目に。無い環境(ローカル test など)は公開 fetch、それも駄目なら静的 JSON。
    try {
      if (env && env.HEARING_SVC && typeof env.HEARING_SVC.fetch === "function") {
        const r = await env.HEARING_SVC.fetch(new Request(YAKUMO_LIVE_URL));
        if (r && r.ok) { data = await r.json(); srcLabel = "hs-hearing contractors.json (live KV, service binding)"; }
      }
    } catch (_e) { /* fall through to public fetch */ }
    if (!data) {
      try {
        const r = await fetch(YAKUMO_LIVE_URL, { cf: { cacheTtl: 300 } });
        if (r && r.ok) { data = await r.json(); srcLabel = "hs-hearing contractors.json (live KV)"; }
      } catch (_e) { /* fall through to static */ }
    }''', "S2 handler: HEARING_SVC を一番目に")

wr = rep_in(wr, '''  "kv_namespaces": [
    {
      "binding": "RL_KV",
      "id": "1bf80c9f870f403ea93d2eec90a7402e"
    }
  ],
''', '''  "kv_namespaces": [
    {
      "binding": "RL_KV",
      "id": "1bf80c9f870f403ea93d2eec90a7402e"
    }
  ],

  // ★2026-09-13 patch3。find_verified_contractor が hs-hearing の公開ライブ名簿(/contractors.json)を読む道。
  //   mcp.horizonshield.dev も hearing.horizonshield.dev も同じ zone の Route なので、Worker から
  //   公開 hostname 経由の fetch は通らん(本番実測: 静的 JSON に落ちとった)。hs-jidec-mcp -> hs-ledger と同じ形。
  "services": [
    { "binding": "HEARING_SVC", "service": "hs-hearing" }
  ],
''', "S1 wrangler.jsonc に services HEARING_SVC")

t = open(TEST1, encoding="utf-8").read()
t_new = t.replace('chk("serverInfo.version は 1.0.7", r.serverInfo && r.serverInfo.version === "1.0.7", JSON.stringify(r.serverInfo));',
                  'chk("serverInfo.version は 1.0.8", r.serverInfo && r.serverInfo.version === "1.0.8", JSON.stringify(r.serverInfo));')
assert t_new != t and "1.0.7" not in t_new
print("ok   test1 の固定値 1.0.8")

DASH = re.compile("[" + "".join(chr(c) for c in (0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D)) + "]")
for label, new, old in (("mcp.js", src, orig), ("wrangler.jsonc", wr, wr_orig)):
    added = [l for l in new.splitlines() if l not in set(old.splitlines())]
    assert not [l for l in added if DASH.search(l)], label + " にダッシュ"
    print("ok   %s 追加行 %d 本、ダッシュ無し" % (label, len(added)))

if not APPLY:
    print("\nDRY RUN。書いてへん。--apply で書く。"); sys.exit(0)
stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
open(TARGET + "." + stamp + "-toolsel3.bak", "w", encoding="utf-8").write(orig)
open(WRANGLER + "." + stamp + "-toolsel3.bak", "w", encoding="utf-8").write(wr_orig)
open(TARGET, "w", encoding="utf-8").write(src)
open(WRANGLER, "w", encoding="utf-8").write(wr)
open(TEST1, "w", encoding="utf-8").write(t_new)
print("\nAPPLIED  mcp.js / wrangler.jsonc / test1  (bak stamp " + stamp + ")")
