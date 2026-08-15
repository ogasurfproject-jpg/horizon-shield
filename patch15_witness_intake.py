# -*- coding: utf-8 -*-
"""
第15弾パッチ (2026-08-15) — NENRIN Phase 2: 台帳に証人の受け口を開ける

entry #19 (NENRIN v1 SPEC) が約束したもの:
  "Any party may measure any endpoint and submit the walk as a signed record"
  "The operator of the ledger holds no veto over what an accepted witness observes"

このパッチがやること (ADDITIVE ONLY。既存ルートは1本も変更しない):
  GET  /witness          受け口の自己記述。上限も全部ここに書く(黙った上限を作らない)
  POST /witness          誰でも。jidec-path-v1 + witness{name,vantage} の歩きを受ける。
                         受理の規則は機械的のみ: スキーマ・サイズ・回数・重複・(あれば)署名の検証。
                         運営者の好みで落とす経路は存在しない
  GET  /witness/pending  保留中の一覧(公開)
  GET  /witness/{sha}    提出されたバイト列(公開)
  POST /witness/anchor   管理者。保留分を束ねて1本のエントリとして台帳に追記
                         (nenrin-witness-batch-v1)。個々の記録のSHAが束の中に並び、
                         束のアンカーが全記録の存在時刻を固定する

設計判断:
  - 提出は即時にはチェーンに入らない。保留プール→日次の束。
    開放と、追記専用チェーンのスパム保護を両立するのはこの形しかない
  - 署名(Ed25519)は任意。あれば検証し、不正なら422。無ければ signed: false と記録。
    「未署名」は拒否理由ではなく、記録される事実である
  - 上限: 1日50件(全体)・1日5件(IP毎)・64KB/件。全部 GET /witness に公開
  - IPは保存しない。日次カウンタのキーに sha256(ip) の先頭16hexだけを使い、25hで自動消滅
  - 管理ルート /witness/anchor は AE_SKIP に追加(管理ルートは計測しない、の既存原則)

使い方:
  cd ~/Desktop/hs-docfix
  python3 patch15_witness_intake.py
  python3 patch15_witness_intake.py --apply
  node --check workers/hs-ledger/src/worker.js
"""
import sys, os, io, hashlib

W = "workers/hs-ledger/src/worker.js"

# ---- 1. AE_SKIP に管理ルートを追加 ----
F1 = '''const AE_SKIP = new Set(["/ledger/append", "/reference/pin", "/ledger/pending"]);
'''
R1 = '''const AE_SKIP = new Set(["/ledger/append", "/reference/pin", "/ledger/pending", "/witness/anchor"]);
'''

# ---- 2. ヘルパー群を esc の直後に ----
F2 = '''const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
'''
R2 = '''const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---- NENRIN Phase 2: witness intake (entry #19 の実装) ----
// 受理の規則は機械的のみ。ここに「運営者の判断」という分岐は存在しない。
const WITNESS_MAX_BYTES = 65536;
const WITNESS_DAILY_GLOBAL = 50;
const WITNESS_DAILY_PER_IP = 5;
const WITNESS_BATCH_MAX = 200;

function witnessValidate(recordCanonical) {
  let r;
  try { r = JSON.parse(recordCanonical); } catch (_e) { return { ok: false, why: "record_canonical is not JSON" }; }
  if (!r || typeof r !== "object" || Array.isArray(r)) return { ok: false, why: "record must be a JSON object" };
  if (r.schema !== "jidec-path-v1") return { ok: false, why: "schema must be jidec-path-v1" };
  for (const k of ["purpose", "walked_at", "base"]) {
    if (typeof r[k] !== "string" || !r[k]) return { ok: false, why: "missing string field: " + k };
  }
  if (!Array.isArray(r.nodes) || r.nodes.length < 1) return { ok: false, why: "nodes must be a non-empty array" };
  if (!Array.isArray(r.assertions) || r.assertions.length < 1) return { ok: false, why: "assertions must be a non-empty array" };
  if (!r.verdict || typeof r.verdict !== "object") return { ok: false, why: "verdict object required" };
  const w = r.witness;
  if (!w || typeof w !== "object") return { ok: false, why: "witness object required (NENRIN extension): { name, vantage }. name may be 'anonymous'." };
  if (typeof w.name !== "string" || !w.name) return { ok: false, why: "witness.name required ('anonymous' is allowed)" };
  if (typeof w.vantage !== "string" || !w.vantage) return { ok: false, why: "witness.vantage required (network/tool the walk was taken from)" };
  return { ok: true, purpose: r.purpose, witness_name: w.name, vantage: w.vantage };
}

async function witnessVerifySig(recordCanonical, sigB64, pubB64) {
  try {
    const key = await crypto.subtle.importKey("raw", b64ToBytes(pubB64), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, b64ToBytes(sigB64), enc.encode(recordCanonical));
  } catch (_e) { return false; }
}

function witnessSelfDescription(origin) {
  return {
    service: "NENRIN witness intake (JIDEC ledger)",
    spec: "NENRIN v1, anchored as ledger entry #19",
    what_this_is:
      "Any party may submit a verification walk (jidec-path-v1 with a witness field) it took of any " +
      "public endpoint. Accepted submissions sit in a public pending pool and are anchored in daily " +
      "batches as nenrin-witness-batch-v1 ledger entries. Acceptance is mechanical: schema, size, " +
      "rate, duplicate, and signature validity if a signature is present. There is no editorial " +
      "review and no route by which the operator declines a schema-valid submission.",
    limits_stated_not_hidden: {
      max_bytes: WITNESS_MAX_BYTES,
      daily_global: WITNESS_DAILY_GLOBAL,
      daily_per_ip: WITNESS_DAILY_PER_IP,
      batch_max: WITNESS_BATCH_MAX,
      note: "These caps exist because the pool is free to submit to and the chain is append-only. " +
            "A schema-valid submission inside the caps cannot be refused."
    },
    signature: "Optional Ed25519 over the exact record_canonical bytes (signature_ed25519_b64 + public_key_ed25519_b64). Present and invalid: rejected. Absent: accepted and recorded as signed: false.",
    privacy: "No IP addresses are stored. Rate counters use a 16-hex prefix of sha256(ip) and expire within 25 hours.",
    how_to_submit: 'POST /witness with {"record_canonical":"<exact bytes of your jidec-path-v1 walk, including a witness:{name,vantage} field>"}',
    pool: origin + "/witness/pending"
  };
}
'''

# ---- 3. ルート群を /ledger GET の直前に ----
F3 = '''    if (p === "/ledger" && request.method === "GET") {
'''
R3 = '''    /* ---------------------- NENRIN witness intake (additive) ---------------------- */

    if (p === "/witness" && request.method === "GET") {
      return json(witnessSelfDescription(origin));
    }

    if (p === "/witness" && request.method === "POST") {
      const b = await request.json().catch(() => null);
      if (!b || typeof b.record_canonical !== "string")
        return json({ error: "record_canonical (string) required", help: origin + "/witness" }, 400);
      if (b.record_canonical.length > WITNESS_MAX_BYTES)
        return json({ error: "too_large", max_bytes: WITNESS_MAX_BYTES }, 413);
      const v = witnessValidate(b.record_canonical);
      if (!v.ok) return json({ error: "invalid_witness_record", why: v.why, help: origin + "/witness" }, 422);

      const day = new Date().toISOString().slice(0, 10);
      const g = Number((await env.LEDGER.get(`wit:count:${day}`)) || 0);
      if (g >= WITNESS_DAILY_GLOBAL)
        return json({ error: "daily_global_cap_reached", cap: WITNESS_DAILY_GLOBAL, note: "stated at GET /witness; try tomorrow" }, 429);
      const ip = request.headers.get("cf-connecting-ip") || "unknown";
      const ipKey = `wit:ip:${day}:${(await sha256hex(ip)).slice(0, 16)}`;
      const gi = Number((await env.LEDGER.get(ipKey)) || 0);
      if (gi >= WITNESS_DAILY_PER_IP)
        return json({ error: "daily_per_ip_cap_reached", cap: WITNESS_DAILY_PER_IP, note: "stated at GET /witness; try tomorrow" }, 429);

      let signed = false;
      if (b.signature_ed25519_b64 || b.public_key_ed25519_b64) {
        if (!b.signature_ed25519_b64 || !b.public_key_ed25519_b64)
          return json({ error: "signature_and_public_key_must_come_together" }, 422);
        signed = await witnessVerifySig(b.record_canonical, b.signature_ed25519_b64, b.public_key_ed25519_b64);
        if (!signed) return json({ error: "signature_invalid", note: "a present signature must verify; omit it to submit unsigned" }, 422);
      }

      const sha = (await sha256hex(b.record_canonical)).toLowerCase();
      const dupP = await env.LEDGER.get(`wit:pending:${sha}`);
      const dupA = await env.LEDGER.get(`wit:anchored:${sha}`);
      if (dupP || dupA) return json({ sha, status: dupA ? "anchored" : "pending", dedup: true, url: `${origin}/witness/${sha}` });

      const stored = {
        sha, record_canonical: b.record_canonical, signed,
        public_key_ed25519_b64: signed ? b.public_key_ed25519_b64 : null,
        purpose: v.purpose, witness_name: v.witness_name, vantage: v.vantage,
        submitted_at: new Date().toISOString()
      };
      await env.LEDGER.put(`wit:pending:${sha}`, JSON.stringify(stored));
      await env.LEDGER.put(`wit:count:${day}`, String(g + 1), { expirationTtl: 90000 });
      await env.LEDGER.put(ipKey, String(gi + 1), { expirationTtl: 90000 });
      return json({
        sha, status: "pending", signed, url: `${origin}/witness/${sha}`,
        anchor_policy: "pending submissions are bundled into a nenrin-witness-batch-v1 ledger entry in daily batches; the batch anchor fixes the existence time of every record in it"
      }, 201);
    }

    if (p === "/witness/pending" && request.method === "GET") {
      const listed = await env.LEDGER.list({ prefix: "wit:pending:" });
      const out = [];
      for (const k of listed.keys) {
        const raw = await env.LEDGER.get(k.name);
        if (!raw) continue;
        const s = JSON.parse(raw);
        out.push({ sha: s.sha, purpose: s.purpose, witness_name: s.witness_name, vantage: s.vantage, signed: s.signed, submitted_at: s.submitted_at });
      }
      return json({ count: out.length, pending: out, note: "public pool; anchored in daily batches" });
    }

    const wm = p.match(/^\\/witness\\/([0-9a-f]{64})$/i);
    if (wm && request.method === "GET") {
      const sha = wm[1].toLowerCase();
      const raw = (await env.LEDGER.get(`wit:pending:${sha}`)) || null;
      const anch = (await env.LEDGER.get(`wit:anchored:${sha}`)) || null;
      if (!raw && !anch) return json({ error: "not found", sha }, 404);
      if (raw) { const s = JSON.parse(raw); return json({ status: "pending", ...s }); }
      const a = JSON.parse(anch);
      return json({ status: "anchored", sha, ledger_entry: a.n, url: `${origin}/ledger/${a.n}`, record: a.stored || null });
    }

    if (p === "/witness/anchor" && request.method === "POST") {
      if (!(await auth(request, env))) return json({ error: "unauthorized" }, 401);
      const listed = await env.LEDGER.list({ prefix: "wit:pending:" });
      const keys = listed.keys.slice(0, WITNESS_BATCH_MAX);
      if (!keys.length) return json({ ok: true, anchored: 0, note: "pool is empty" });
      const items = [];
      for (const k of keys) {
        const raw = await env.LEDGER.get(k.name);
        if (raw) items.push(JSON.parse(raw));
      }
      items.sort((a, b2) => (a.sha < b2.sha ? -1 : 1));
      const batch = {
        schema: "nenrin-witness-batch-v1",
        anchored_at: new Date().toISOString(),
        count: items.length,
        records: items.map((s) => ({ sha: s.sha, purpose: s.purpose, witness_name: s.witness_name, vantage: s.vantage, signed: s.signed }))
      };
      const canonical = JSON.stringify(batch);
      const h = (await sha256hex(canonical)).toLowerCase();
      const dup = await env.LEDGER.get(`hash:${h}`);
      if (dup) return json({ n: Number(dup), url: `${origin}/ledger/${dup}`, dedup: true });
      const n = Number((await env.LEDGER.get("seq")) || 0) + 1;
      const entry = { n, work: `NENRIN witness batch (${items.length} records)`, claim_sha256: h, record_canonical: canonical, schema: "v0-plain", created_at: new Date().toISOString(), ots_status: "unstamped", bitcoin_block: null, block_time: null, stamped_at: null };
      await env.LEDGER.put(`entry:${n}`, JSON.stringify(entry));
      await env.LEDGER.put(`hash:${h}`, String(n));
      await env.LEDGER.put("seq", String(n));
      for (const s of items) {
        await env.LEDGER.put(`wit:anchored:${s.sha}`, JSON.stringify({ n, stored: s }));
        await env.LEDGER.delete(`wit:pending:${s.sha}`);
      }
      return json({ n, url: `${origin}/ledger/${n}`, anchored: items.length, note: "stamp the ledger as usual; the batch anchor covers every record listed in it" }, 201);
    }

    if (p === "/ledger" && request.method === "GET") {
'''

# ---- 4. /health の routes に載せる ----
F4 = '''"/paths/{sha}/replay", "/paths/query"], discovery:'''
R4 = '''"/paths/{sha}/replay", "/paths/query", "/witness", "/witness/pending", "/witness/{sha}"], discovery:'''


def main():
    apply = "--apply" in sys.argv
    if not os.path.exists(W):
        print("NG: %s が無い。" % W)
        sys.exit(1)
    src = io.open(W, encoding="utf-8").read()
    print("対象  : %s" % W)
    print("変更前: sha256 %s  (%d bytes)" % (hashlib.sha256(src.encode()).hexdigest(), len(src.encode())))
    print("モード: %s" % ("APPLY(本番)" if apply else "dry-run(何も書かない)"))
    print("-" * 74)

    pairs = [(F1, R1), (F2, R2), (F3, R3), (F4, R4)]
    ok_all = True
    for i, (f, _r) in enumerate(pairs, 1):
        n = src.count(f)
        ok = (n == 1)
        ok_all = ok_all and ok
        print("  %s アンカー%d                     期待1 / 実際%d" % ("OK " if ok else "NG ", i, n))
    pre = [
        ("まだ適用されていない",       "witnessValidate" not in src),
        ("KVバインドは LEDGER",        "env.LEDGER.get" in src),
        ("auth ヘルパーが存在",        "const auth = async (request, env)" in src),
        ("b64ToBytes が存在",          "function b64ToBytes" in src),
    ]
    for label, ok in pre:
        print("  %s %s" % ("OK " if ok else "NG ", label))
        ok_all = ok_all and ok
    if not ok_all:
        print("★ 前提が違う。1バイトも書かずに終了する。")
        sys.exit(1)

    out = src
    for f, r in pairs:
        out = out.replace(f, r, 1)

    checks = [
        ("受け口5ルートが入った",
             all(s in out for s in ['p === "/witness" && request.method === "GET"',
                                     'p === "/witness" && request.method === "POST"',
                                     'p === "/witness/pending"', '/^\\/witness\\/([0-9a-f]{64})$/i',
                                     'p === "/witness/anchor"'])),
        ("★機械的受理のみ(運営者判断の分岐なし)", "運営者の判断" not in out.split("witnessValidate")[1].split("witnessSelfDescription")[0]),
        ("★上限は全部自己記述に公開",  "limits_stated_not_hidden" in out),
        ("未署名は事実として記録",      "signed: false" in out and "Absent: accepted and recorded" in out),
        ("不正署名は拒否",              '"signature_invalid"' in out),
        ("IPを保存しない",              "sha256hex(ip)).slice(0, 16)" in out and "expirationTtl" in out),
        ("重複は既存を返す",            "dedup: true" in out),
        ("束は既存の追記系列に入る",     '"nenrin-witness-batch-v1"' in out and out.count('await env.LEDGER.put("seq", String(n));') == 2),
        ("管理ルートは計測しない",       '"/witness/anchor"]' in out),
        ("/health に載った",            '"/witness", "/witness/pending", "/witness/{sha}"' in out),
        ("既存ルートは無変更",          out.count('p === "/ledger/append"') == src.count('p === "/ledger/append"')
                                        and out.count('p === "/reference/pin"') == src.count('p === "/reference/pin"')),
        ("波括弧の収支が合う",          out.count("{") - out.count("}") == src.count("{") - src.count("}")),
        ("丸括弧の収支が合う",          out.count("(") - out.count(")") == src.count("(") - src.count(")")),
    ]
    for c, ok in checks:
        print("  %s %s" % ("OK " if ok else "NG ", c))
    if any(not ok for _c, ok in checks):
        print("★ 検算に失敗。書かずに終了する。")
        sys.exit(1)

    print("-" * 74)
    print("変更後: sha256 %s  (%d bytes)" % (hashlib.sha256(out.encode()).hexdigest(), len(out.encode())))
    if not apply:
        print("")
        print("[dry-run] 書いていない。本番は --apply を付けろ。")
        sys.exit(0)

    io.open(W, "w", encoding="utf-8").write(out)
    print("")
    print("書いた。次: node --check %s" % W)


if __name__ == "__main__":
    main()
