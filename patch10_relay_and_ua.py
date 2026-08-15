# -*- coding: utf-8 -*-
"""
第10弾パッチ (2026-08-15) — 扉の同一ゾーン522を中継で迂回し、扉に名乗らせる

背景(全部実測):
  - HTTPで呼ばれた扉 → 自ゾーン(horizonshield.dev)のサーバー: 522 (全滅。mcp/hearingで確認)
  - cron起動の同じ扉 → 同じサーバー: 通る (昨夜の掃引6本成功)
  - 扉 → 別ゾーン(the-horizons-innovation.com): 通る (405実測)
  - 最初に見つけたのは Federico の外部ネットワークからの1発。
    内側からの測定は全部この穴を見られなかった。

このパッチがやること:
  1. probeFetch() を追加。対象が自ゾーンなら hs-verify-relay (別ゾーン) 経由で取得。
     経路は全区間公開エッジ。RELAY_URL/RELAY_TOKEN が未設定なら従来どおり直接
     (=fail-open にしない。中継が無ければ今の522がそのまま見える)
  2. rpcCall / checkAgentCard を probeFetch に切り替え
  3. 判定に probed_via を追加。どの経路で測ったかを判定自身が言う
     (黙って経路を替えたら、それも「静かな読み替え」になる)
  4. ★扉が名乗る。User-Agent を全プローブに付ける。
     他人には開示を要求する扉が自分は無名で測っていた。SentinelOracle ですら
     opt-out URL 付きで名乗っていた。今日からこちらも名乗る
  5. wrangler.jsonc に RELAY_URL (平文var) を追加。RELAY_TOKEN は secret

デプロイ順(厳守):
  中継を先にデプロイ+secret → 扉に secret → このパッチ → 扉をデプロイ
  逆にすると、扉が存在しない中継を呼んで全チェックが落ちる。

使い方:
  cd ~/Desktop/hs-docfix
  python3 patch10_relay_and_ua.py
  python3 patch10_relay_and_ua.py --apply
  node --check workers/hs-verify-gate/src/worker.js
"""
import sys, os, io, hashlib

W = "workers/hs-verify-gate/src/worker.js"
C = "workers/hs-verify-gate/wrangler.jsonc"

UA = "HORIZON-SHIELD-verify-gate/0.2 (+https://gate.horizonshield.dev/spec; conformance probe; read-only)"

# ---- worker.js 変更 1: UA定数と probeFetch を withTimeout の直後に追加 ----
F1 = '''function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))
  ]);
}
'''

R1 = '''function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))
  ]);
}

// ---- 測定経路 (2026-08-15) ----
// 実測: HTTPで呼ばれたこのWorkerから自ゾーンへの subrequest は 522 になる。
// cron起動なら通る。外部ゾーンへは通る。最初に外から見つけたのは Federico。
// 対象が自ゾーンのときだけ、別ゾーンの hs-verify-relay を経由して公開エッジで測る。
// service binding は使わない。公開経路を測らない私道になるからだ。
const PROBE_UA = "''' + UA + '''";
const OWN_ZONE = "horizonshield.dev";
let GATE_ENV = null;       // 入口で env を差す。値は毎回同一なので競合しない
let GATE_CONTEXT = "none"; // "http" | "cron"。★中継は http 文脈のみ。cron→workers.dev は塞がっている(実測)

function isOwnZone(u) {
  try {
    const h = new URL(u).hostname;
    return h === OWN_ZONE || h.endsWith("." + OWN_ZONE);
  } catch (_e) { return false; }
}

function relayConfigured() {
  return GATE_CONTEXT === "http" && !!(GATE_ENV && GATE_ENV.RELAY_URL && GATE_ENV.RELAY_TOKEN);
}

function probeVia(endpoint) {
  return (isOwnZone(endpoint) && relayConfigured())
    ? "relay (hs-verify-relay, a separate worker outside this zone path; the whole probe traverses the public edge, because a Worker invoked over HTTP cannot reach its own zone directly \\u2014 measured 2026-08-14/15)"
    : "direct from the gate worker (" + GATE_CONTEXT + " context)";
}

async function probeFetch(url, init) {
  const opts = init ? { ...init } : {};
  opts.headers = { ...(opts.headers || {}), "user-agent": PROBE_UA };
  if (!(isOwnZone(url) && relayConfigured())) {
    return await fetch(url, opts);
  }
  const res = await fetch(GATE_ENV.RELAY_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-relay-token": GATE_ENV.RELAY_TOKEN },
    body: JSON.stringify({
      url: url,
      method: opts.method === "POST" ? "POST" : "GET",
      headers: opts.headers,
      body: typeof opts.body === "string" ? opts.body : null
    })
  });
  let wrapped = null;
  try { wrapped = await res.json(); } catch (_e) { wrapped = null; }
  if (res.status === 502 && wrapped && wrapped.error === "target_fetch_failed") {
    // 中継までは届いたが、中継から相手に届かなかった = 公開エッジ経由の相手側到達性の事実
    throw new Error("unreachable via public-edge relay: " + String(wrapped.message || "fetch failed"));
  }
  if (!res.ok || !wrapped || wrapped.relayed !== true) {
    // 中継そのものに届かない/設定不良 = こちら側の故障。相手の記録にしない文言で返す
    throw new Error("relay unavailable (http " + res.status + "): gate-side failure, not a statement about the target");
  }
  return new Response(wrapped.body || "", { status: wrapped.status, headers: wrapped.headers || {} });
}
'''

# ---- worker.js 変更 2: rpcCall を probeFetch に ----
F2 = '''async function rpcCall(endpoint, method, params) {
  const res = await withTimeout(fetch(endpoint, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params || {} })
  }), CONFIG.timeout_ms);
'''

R2 = '''async function rpcCall(endpoint, method, params) {
  const res = await withTimeout(probeFetch(endpoint, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params || {} })
  }), CONFIG.timeout_ms);
'''

# ---- worker.js 変更 3: agent-card 取得を probeFetch に ----
F3 = '''    const res = await withTimeout(fetch(url), CONFIG.timeout_ms);
'''
R3 = '''    const res = await withTimeout(probeFetch(url), CONFIG.timeout_ms);
'''

# ---- worker.js 変更 4: 判定に probed_via ----
F4 = '''    tools_called: allowToolCall === true ? "one tool, twice, with empty arguments, by consent" : "none",
    checks: results
  };
'''
R4 = '''    tools_called: allowToolCall === true ? "one tool, twice, with empty arguments, by consent" : "none",
    probed_via: probeVia(endpoint),
    checks: results
  };
'''

# ---- worker.js 変更 5,6: 入口で GATE_ENV を差す ----
F5 = '''  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDailySweep(env));
  },
'''
R5 = '''  async scheduled(event, env, ctx) {
    GATE_ENV = env;
    GATE_CONTEXT = "cron";
    ctx.waitUntil(runDailySweep(env));
  },
'''

F6 = '''  async fetch(request, env, ctx) {
    const url = new URL(request.url);
'''
R6 = '''  async fetch(request, env, ctx) {
    GATE_ENV = env;
    GATE_CONTEXT = "http";
    const url = new URL(request.url);
'''

# ---- wrangler.jsonc: RELAY_URL ----
FC = '''  "kv_namespaces": [
    { "binding": "HS_VERIFY_KV", "id": "ab98336fc22d4d0f947501d843d2d228" }
  ]
'''
RC = '''  "kv_namespaces": [
    { "binding": "HS_VERIFY_KV", "id": "ab98336fc22d4d0f947501d843d2d228" }
  ],

  // 同一ゾーン522の迂回先 (2026-08-15)。RELAY_TOKEN は secret で入れる:
  //   npx wrangler secret put RELAY_TOKEN
  // 中継側(hs-verify-relay)にも同じ値を入れる。片方だけだと 403 で
  // 「relay unavailable: gate-side failure」が判定に出る(相手の記録にはならない)。
  "vars": {
    "RELAY_URL": "https://hs-verify-relay.oga-surf-project.workers.dev"
  }
'''


def run(target, pairs, apply, extra_checks):
    src = io.open(target, encoding="utf-8").read()
    print("対象  : %s" % target)
    print("変更前: sha256 %s  (%d bytes)" % (hashlib.sha256(src.encode()).hexdigest(), len(src.encode())))
    ok_all = True
    for i, (f, _r) in enumerate(pairs, 1):
        n = src.count(f)
        ok = (n == 1)
        ok_all = ok_all and ok
        print("  %s アンカー%d                     期待1 / 実際%d" % ("OK " if ok else "NG ", i, n))
    if not ok_all:
        return None, src
    out = src
    for f, r in pairs:
        out = out.replace(f, r, 1)
    for label, ok in extra_checks(src, out):
        print("  %s %s" % ("OK " if ok else "NG ", label))
        ok_all = ok_all and ok
    if not ok_all:
        return None, src
    print("変更後: sha256 %s  (%d bytes)" % (hashlib.sha256(out.encode()).hexdigest(), len(out.encode())))
    return out, src


def main():
    apply = "--apply" in sys.argv
    for t in (W, C):
        if not os.path.exists(t):
            print("NG: %s が無い。~/Desktop/hs-docfix で実行しているか確認せよ。" % t)
            sys.exit(1)
    print("モード: %s" % ("APPLY(本番)" if apply else "dry-run(何も書かない)"))
    print("=" * 74)

    def wchecks(src, out):
        return [
            ("probeFetch が1回定義された",        out.count("async function probeFetch(url, init)") == 1),
            ("UA が定義され本文に1回",            out.count('const PROBE_UA = "') == 1 and "HORIZON-SHIELD-verify-gate/0.2" in out),
            ("直接fetchの生き残りが正しい",
                 # プローブ以外の fetch (中継呼び出し・webhook通知) は残る
                 out.count("await withTimeout(probeFetch(") == 2),
            ("rpcCall は probeFetch を使う",      "withTimeout(probeFetch(endpoint, {" in out),
            ("agent-card も probeFetch",          "withTimeout(probeFetch(url), CONFIG.timeout_ms)" in out),
            ("webhook通知は直接fetchのまま",       "await withTimeout(fetch(target, {" in out),
            ("probed_via が判定に入った",          out.count("probed_via: probeVia(endpoint)") == 1),
            ("入口2箇所で GATE_ENV を差す",        out.count("GATE_ENV = env;") == 2),
            ("★中継は http 文脈のみ",             'GATE_CONTEXT === "http"' in out and out.count('GATE_CONTEXT = "cron"') == 1 and out.count('GATE_CONTEXT = "http"') == 1),
            ("中継未設定なら直接に戻る(fail-open無し)", "if (!(isOwnZone(url) && relayConfigured()))" in out),
            ("中継の故障を相手の記録にしない",      "gate-side failure, not a statement about the target" in out),
            ("公開エッジ経由の不達は区別する",      "unreachable via public-edge relay" in out),
            ("既存4ツールを壊していない",          out.count('name: "lookup_server"') == 1),
            ("波括弧の収支が合う",                 out.count("{") - out.count("}") == src.count("{") - src.count("}")),
            ("丸括弧の収支が合う",                 out.count("(") - out.count(")") == src.count("(") - src.count(")")),
        ]

    def cchecks(src, out):
        return [
            ("RELAY_URL が入った",                out.count('"RELAY_URL": "https://hs-verify-relay.oga-surf-project.workers.dev"') == 1),
            ("KVバインドは無傷",                  '"binding": "HS_VERIFY_KV"' in out),
            ("cron 設定は無傷",                   '"crons": ["0 18 * * *"]' in out),
            ("secret を平文で書いていない",        "RELAY_TOKEN" not in out.replace("npx wrangler secret put RELAY_TOKEN", "").replace("RELAY_TOKEN は secret で入れる", "").replace("中継側(hs-verify-relay)にも同じ値を入れる", "")),
        ]

    out_w, src_w = run(W, [(F1, R1), (F2, R2), (F3, R3), (F4, R4), (F5, R5), (F6, R6)], apply, wchecks)
    print("-" * 74)
    out_c, src_c = run(C, [(FC, RC)], apply, cchecks)
    print("=" * 74)

    if out_w is None or out_c is None:
        print("★ 前提または検算に失敗。1バイトも書かずに終了する。")
        sys.exit(1)

    if not apply:
        print("[dry-run] 書いていない。本番は --apply を付けろ。")
        sys.exit(0)

    io.open(W, "w", encoding="utf-8").write(out_w)
    io.open(C, "w", encoding="utf-8").write(out_c)
    print("書いた。次: node --check %s" % W)


if __name__ == "__main__":
    main()
