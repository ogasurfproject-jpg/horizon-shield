// 0.4.3 (2026-09-09): 拡張の綴りが 2 本になった日の敵と管制。
//
// 発端: perma-id/w3id.org#6653 が merge され https://w3id.org/horizonshield/conduct/v1 が
// 302 で扉の URI に解決するようになった。A2A の拡張ガイダンスは perma-id を推しとる。
// つまり「本家の推奨どおりに書いた card」が現れる。読む側がそれを知らんかったら、
// 正しくやった奴が黙って条件3 で落ちる。これは第二波のヘッダ両綴りと同じ型の穴。
//
// 規律: 識別子は 1 本のまま。綴りは閉じた 2 本の一覧、完全一致だけ。
//       どっちで宣言されたかは判定のバイトに書く(黙って受け入れん)。
//       check の最中に redirect は絶対に叩かん(この suite が fetch を数えて証明する)。
//
// 使い方: node test/ext_identifier.test.mjs   (workers/hs-verify-gate で)  1 つでも落ちたら exit 1。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import worker from "../src/worker.js";

const CANON = "https://gate.horizonshield.dev/ext/conduct/v1";
const PERMA = "https://w3id.org/horizonshield/conduct/v1";
const NEXT = "https://w3id.org/horizonshield/conduct/v2";
const O = "https://gate.redteam.invalid";
const EP = "https://srv.redteam.invalid/mcp";
const ENV = { GATE_COMMIT: "ext-identifier-local" };
// A2A の口は register を読むので KV が要る(中身は空でええ。読むのは「行が無い」という答え)。
const kv = (() => { const m = new Map(); return { get: async (k, o) => { const v = m.get(k); if (v === undefined) return null; return (o === "json" || (o && o.type === "json")) ? JSON.parse(v) : v; }, put: async (k, v) => { m.set(k, String(v)); }, list: async (o) => ({ keys: [...m.keys()].filter((k) => k.startsWith((o && o.prefix) || "")).map((name) => ({ name })), list_complete: true }), delete: async (k) => { m.delete(k); } }; })();
const ENVK = { HS_VERIFY_KV: kv, GATE_COMMIT: "ext-identifier-local" };
const CTX = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

const R = [];
const t = (kind, name, cond, got) => { R.push({ kind, name, ok: !!cond }); console.log((cond ? "ok   " : "NG   ") + "[" + kind + "] " + name + (cond ? "" : "   <<< " + String(got).slice(0, 220))); };

// ---- 敵と管制のための最小の相手サーバー。ネットワークは使わん(.invalid は RFC 2606) ----
const COMP = { paid_by: "buyer", referral_fee: false, listing_fee: false, success_fee_pct: 0, disclosure_url: "https://example.invalid/d" };
const ext = (uri, compensation) => ({ uri, description: "conduct", required: false, params: { compensation, measured_endpoints: [EP], conduct_record: "https://example.invalid/h", witness_intake: "https://example.invalid/w" } });
let fetched = [];
function install(card) {
  fetched = [];
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    fetched.push(u.origin + u.pathname);
    if (u.hostname === "srv.redteam.invalid" && u.pathname === "/.well-known/agent-card.json") {
      return new Response(JSON.stringify(card), { headers: { "content-type": "application/json" } });
    }
    if (u.hostname === "srv.redteam.invalid" && u.pathname === "/mcp") {
      const b = JSON.parse(init.body);
      if (b.method === "initialize") return new Response(JSON.stringify({ jsonrpc: "2.0", id: b.id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "s", version: "1" }, capabilities: {} } }), { headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: b.id, result: { tools: [{ name: "t1", description: "d", inputSchema: { type: "object", properties: {} } }] } }), { headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  };
}
async function check(card) {
  install(card);
  const res = await worker.fetch(new Request(O + "/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: EP }) }), ENV, CTX);
  return await res.json();
}
const comp = (v) => v.checks.compensation_disclosure;
const card = (extra) => ({ name: "Perma Agent", description: "declares the conduct extension", url: "", ...extra });
const withExts = (...entries) => card({ capabilities: { extensions: entries } });

// ---------------------------------------------------------------- 読む側
let v = await check(withExts(ext(CANON, COMP)));
t("control", "canonical spelling passes as before", comp(v).pass === true && comp(v).detail.location === "extension", JSON.stringify(comp(v)));
t("control", "canonical is recorded as canonical", comp(v).detail.extension_identifier.forms.join() === "canonical", JSON.stringify(comp(v).detail.extension_identifier));

v = await check(withExts(ext(PERMA, COMP)));
t("fix", "the permanent identifier is read as this extension", comp(v).pass === true, JSON.stringify(comp(v)));
t("fix", "and the verdict says which string was declared", comp(v).detail.extension_identifier.declared.join() === PERMA && comp(v).detail.extension_identifier.forms.join() === "permanent_id", JSON.stringify(comp(v).detail.extension_identifier));
t("fix", "the identifier named in the record is still the canonical one", comp(v).detail.extension_identifier.identifier === CANON, comp(v).detail.extension_identifier.identifier);
t("fix", "the note says the redirect was not followed", /not followed/.test(comp(v).detail.extension_identifier.note || ""), comp(v).detail.extension_identifier.note);
t("attack", "w3id.org is never fetched while checking", fetched.every((u) => !/w3id\.org/i.test(u)), fetched.join(" "));
t("fix", "the declared string is inside the bytes record_sha256 covers", (() => {
  const bytes = { ...v }; delete bytes.record_sha256; delete bytes.recompute_note;
  const s = JSON.stringify(bytes);
  return s.includes(PERMA) && sha256(s) === v.record_sha256;
})(), v.record_sha256);

v = await check(withExts(ext(CANON, COMP), ext(PERMA, COMP)));
t("control", "both spellings, one declaration: passes and stays 'extension', not 'both'", comp(v).pass === true && comp(v).detail.location === "extension", JSON.stringify(comp(v).detail));
t("control", "both spellings are both recorded", comp(v).detail.extension_identifier.declared.length === 2, JSON.stringify(comp(v).detail.extension_identifier));

v = await check(withExts(ext(CANON, COMP), ext(PERMA, { ...COMP, paid_by: "seller" })));
t("attack", "two spellings that disagree fail (a disclosure that says two things is not a disclosure)", comp(v).pass === false && /disagree/.test(comp(v).reason), JSON.stringify(comp(v)));

v = await check({ ...withExts(ext(PERMA, COMP)), compensation: COMP });
t("control", "top-level plus the permanent identifier, in agreement, is 'both'", comp(v).pass === true && comp(v).detail.location === "both", JSON.stringify(comp(v).detail));

for (const [name, uri] of [
  ["the next version's identifier is not this version", NEXT],
  ["another project under w3id.org is not this extension", "https://w3id.org/someoneelse/conduct/v1"],
  ["http is not https", "http://w3id.org/horizonshield/conduct/v1"],
  ["a trailing slash is a different string", PERMA + "/"],
  ["case is not folded", "https://W3ID.org/horizonshield/conduct/v1"],
  ["a path prefix is not a match", PERMA + "/spec"],
  ["the canonical string with a trailing slash is a different string", CANON + "/"]
]) {
  v = await check(withExts(ext(uri, COMP)));
  t("attack", name, comp(v).pass === false && /not declared/.test(comp(v).reason), uri + " => " + JSON.stringify(comp(v)).slice(0, 200));
}
t("control", "when nothing matched, the verdict lists the strings that would have", (() => {
  const a = comp(v).detail.accepted_extension_uris;
  return Array.isArray(a) && a.length === 2 && a.includes(CANON) && a.includes(PERMA) && !a.includes(NEXT);
})(), JSON.stringify(comp(v).detail.accepted_extension_uris));

v = await check(withExts({ uri: PERMA, required: false, params: { measured_endpoints: [EP] } }));
t("attack", "the permanent identifier without a compensation block still fails, and names where", comp(v).pass === false && /extension_permanent_id/.test(comp(v).reason), JSON.stringify(comp(v)));

v = await check(card({ compensation: COMP }));
t("control", "a card with no extension at all is unchanged (no identifier block)", comp(v).pass === true && comp(v).detail.location === "top_level" && comp(v).detail.extension_identifier === null, JSON.stringify(comp(v).detail));

// ---------------------------------------------------------------- 線(A2A の口)
const post = async (body, headers) => {
  const r = await worker.fetch(new Request(O + "/a2a", { method: "POST", headers: { "content-type": "application/json", ...(headers || {}) }, body: JSON.stringify(body) }), ENVK, CTX);
  return { ext: r.headers.get("a2a-extensions"), extLegacy: r.headers.get("x-a2a-extensions"), j: await r.json() };
};
const MSG = (id) => ({ jsonrpc: "2.0", id, method: "SendMessage", params: { message: { messageId: "m" + id, role: "ROLE_USER", parts: [{ text: EP }] } } });

let w = await post(MSG(1), { "a2a-extensions": PERMA });
t("fix", "1.0 wire: the permanent identifier activates the extension", !!(w.j.result && w.j.result.message && w.j.result.message.metadata), JSON.stringify(w.j).slice(0, 200));
t("fix", "the echo returns the caller's own spelling", w.ext === PERMA, w.ext);
t("fix", "the metadata keys still name the canonical identifier", !!w.j.result.message.metadata[CANON + "/endpoint"] && Object.keys(w.j.result.message.metadata).every((k) => k.startsWith(CANON)), JSON.stringify(Object.keys(w.j.result.message.metadata)));
t("fix", "Message.extensions names the canonical identifier only", w.j.result.message.extensions.join() === CANON, JSON.stringify(w.j.result.message.extensions));

w = await post(MSG(2), { "a2a-extensions": PERMA + "," + CANON });
t("control", "both spellings requested: both echoed, in the order asked", w.ext === PERMA + "," + CANON, w.ext);

w = await post(MSG(3), { "a2a-extensions": NEXT });
t("attack", "the next version does not activate this one (no fallback across versions)", w.ext === null && w.j.result.message.metadata === undefined, w.ext + " " + JSON.stringify(w.j.result.message.metadata));

w = await post({ ...MSG(4), method: "message/send", params: { message: { messageId: "m4", role: "user", kind: "message", parts: [{ kind: "text", text: EP }] } } }, { "x-a2a-extensions": PERMA });
t("fix", "0.3 spelling of the header carries the permanent identifier too, echoed in both spellings", w.ext === PERMA && w.extLegacy === PERMA, w.ext + " / " + w.extLegacy);

const g = await (await worker.fetch(new Request(O + "/a2a"), ENVK, CTX)).json();
t("control", "GET /a2a states the identifier and the strings it accepts", g.extensions.join() === CANON && g.extensions_accepted.length === 2 && g.extensions_accepted.includes(PERMA), JSON.stringify(g.extensions_accepted));

// ---------------------------------------------------------------- 仕様の口
const extJson = await (await worker.fetch(new Request(O + "/ext/conduct/v1"), ENV, CTX)).json();
t("fix", "/ext/conduct/v1 declares the permanent identifier", extJson.permanent_id && extJson.permanent_id.uri === PERMA, JSON.stringify(extJson.permanent_id || null).slice(0, 200));
t("fix", "it names the registry entry and the redirect", /6653/.test(extJson.permanent_id.registry) && /302/.test(extJson.permanent_id.resolves), JSON.stringify(extJson.permanent_id.registry));
t("fix", "it says the redirect is never resolved while checking", /does not follow the redirect/.test(extJson.permanent_id.never_resolved), extJson.permanent_id.never_resolved);
t("fix", "it names the successor identifier for the next version", extJson.permanent_id.succession.includes(NEXT) && extJson.versioning.includes(NEXT), extJson.permanent_id.succession);
t("control", "identity is unchanged: uri is still the canonical string", extJson.uri === CANON, extJson.uri);

const mdRes = await worker.fetch(new Request(O + "/ext/conduct/v1", { headers: { accept: "text/markdown" } }), ENV, CTX);
const md = await mdRes.text();
t("fix", "the served specification carries section 12", /## 12\. Revision v1\.2/.test(md) && md.includes(PERMA), md.slice(-120));
t("control", "the served bytes hash to the sha the JSON publishes", sha256(md) === extJson.spec_markdown_sha256, sha256(md) + " vs " + extJson.spec_markdown_sha256);
t("attack", "the served copy has not drifted from ext/CONDUCT_EXT_v1.md in the repository", sha256(readFileSync(new URL("../ext/CONDUCT_EXT_v1.md", import.meta.url), "utf8")) === extJson.spec_markdown_sha256, "run sync_ext_md.py");

const spec = await (await worker.fetch(new Request(O + "/spec"), ENV, CTX)).json();
t("control", "/spec tells a reader both strings are read", spec.conditions.compensation_disclosure.location.includes(PERMA) && spec.conditions.compensation_disclosure.location.includes(CANON), spec.conditions.compensation_disclosure.location.slice(0, 200));

// ----------------------------------------------------------------
const passed = R.filter((r) => r.ok).length;
const by = (k) => R.filter((r) => r.kind === k);
console.log("");
for (const k of ["attack", "fix", "control"]) console.log("  " + k.padEnd(9) + by(k).filter((r) => r.ok).length + " / " + by(k).length);
console.log("");
console.log("=== " + passed + " / " + R.length + " 合格 (extension identifier、扉 0.4.3) ===");
console.log("識別子は 1 本、綴りは 2 本、どっちで名乗られたかは記録に残る。redirect は叩かん。");
if (passed !== R.length) process.exit(1);
