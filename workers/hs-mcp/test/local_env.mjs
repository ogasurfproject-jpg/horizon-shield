// 本物の Worker module を node で読み、空の(ただし答えられる)env と共に node:http で local に立てる。
// SDK 相互運用テスト(sdk_js_interop.mjs / sdk_py_interop.py 経由の serve_local.mjs)の共通の足場。ネットワーク無し。
//
// env の中身は「無い」ではなく「空の店」: KV は seq=2 の 1 件だけ持つ mock。これで
//   hs-mcp   : A2A の面は KV 無しでも動く(rate limit は KV 無しで allow)
//   hs-ledger: jidec:entry:2 を引ける(ledger.test.mjs と同じ種)
//   hs-jidec-mcp: ledger へは service binding(env.LEDGER_SVC)で出るので、同じ env で立てた hs-ledger の worker を binding として渡す
//   hs-verify-gate: /a2a は HS_VERIFY_KV を読む(空 = 「登録なし」の正直な答えが返る)
import http from "node:http";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

export async function loadWorker(rel) {
  const abs = resolve(rel);
  const src = await readFile(abs, "utf8");
  // 相対 import を持つ Worker(扉)はそのまま読む。持たん Worker は .mjs の写しで読む(package.json 無しの .js 対策)。
  if (/^\s*import\s.+from\s+["']\.\.?\//m.test(src)) return (await import(pathToFileURL(abs).href)).default;
  const dir = await mkdtemp(join(tmpdir(), "a2a-local-env-"));
  const f = join(dir, "worker.mjs");
  await writeFile(f, src);
  return (await import(pathToFileURL(f).href)).default;
}

export function mockKV(entries) {
  const store = new Map(entries || []);
  return {
    store,
    binding: {
      get: async (k, opt) => {
        const v = store.get(k);
        if (v === undefined) return null;
        if (opt === "json" || (opt && opt.type === "json")) { try { return JSON.parse(v); } catch (_e) { return null; } }
        return v;
      },
      put: async (k, v) => { store.set(k, typeof v === "string" ? v : String(v)); },
      list: async (opt) => {
        const pre = (opt && opt.prefix) || "";
        return { keys: [...store.keys()].filter((k) => k.startsWith(pre)).map((name) => ({ name })), list_complete: true, cursor: undefined };
      },
      delete: async (k) => { store.delete(k); }
    }
  };
}

const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");

export function seededLedgerKV() {
  const rec2 = JSON.stringify({ title: "SPEC_HASH_INDEPENDENCE_v1.md", sha256: "deadbeef" });
  const h2 = sha256hex(rec2);
  return mockKV([
    ["seq", "2"],
    ["entry:2", JSON.stringify({ n: 2, work: "spec", claim_sha256: h2, record_canonical: rec2, schema: "v0", created_at: "2026-01-01T00:00:00Z", ots_status: "confirmed", bitcoin_block: 912345, block_time: "2026-01-02T00:00:00Z" })],
    ["hash:" + h2, "2"]
  ]);
}

export function makeEnv() {
  const ledgerKV = seededLedgerKV();
  return {
    GATE_COMMIT: "local-env",
    LEDGER: ledgerKV.binding,
    HS_VERIFY_KV: mockKV().binding,
    RL_KV: mockKV().binding
  };
}

export const ctx = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };

// jidec-mcp は ledger に service binding(env.LEDGER_SVC)で出る。同じ env で立てた hs-ledger の worker に折り返す。
export async function installLedgerFetchBridge(ledgerModulePath, env) {
  const ledger = await loadWorker(ledgerModulePath);
  env.LEDGER_SVC = { fetch: (input, init) => ledger.fetch(input instanceof Request ? input : new Request(input, init), env, ctx) };
  return ledger;
}

// module の場所から、ledger の worker.js の場所を推測する(workers/<name>/src/... の並び)。
export function siblingLedgerPath(modulePath) {
  const d = dirname(resolve(modulePath));
  return resolve(d, "..", "..", "hs-ledger", "src", "worker.js");
}

export async function serve(modulePath, origin, env) {
  const worker = await loadWorker(modulePath);
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const r = new Request(origin + req.url, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
    let out;
    try { out = await worker.fetch(r, env, ctx); } catch (e) { res.writeHead(500); res.end(String(e && e.stack || e)); return; }
    const h = {}; out.headers.forEach((v, k) => { h[k] = v; });
    res.writeHead(out.status, h);
    res.end(Buffer.from(await out.arrayBuffer()));
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { server, base: "http://127.0.0.1:" + server.address().port, worker };
}
