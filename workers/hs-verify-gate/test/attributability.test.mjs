// 0.4.4 (2026-09-10): 署名の有無は合否を動かさん。動かすのは「この記録が何を証明するか」。
//
// 芯: TLS は「取った瞬間」しか押さえん。同じホストの jku なら、fetch の瞬間の署名はほぼ同語反復や。
// 署名が効くのは**持ち出した時と時間が経った時**だけ = 転送に耐える著者性。
// せやから無署名の card についての行は、相手の言葉やなく**この扉の観測**に帰属するだけで、相手は否認できる。
// うちの看板は「信用が要らん」やのに、無署名の相手の行は読む側が うちを信用するしかなかった。
// これは相手の穴やなく うちの穴で、0.4.4 で塞ぐ。塞ぎ方は罰やない: 条件も赤も増やさず、
// establishes / does_not_establish(hash の中)に「この行が何を証明するか」を書く。
//
// 使い方: node test/attributability.test.mjs   (workers/hs-verify-gate で)  1 つでも落ちたら exit 1。
import { createHash } from "node:crypto";
import worker, { cardSignatureCanonical } from "../src/worker.js";

const O = "https://gate.redteam.invalid";
const EP = "https://srv.redteam.invalid/mcp";
const JWKS = "https://srv.redteam.invalid/.well-known/jwks.json";
const FOREIGN_JWKS = "https://keys.redteam.invalid/.well-known/jwks.json";
const ENV = { GATE_COMMIT: "attributability-local" };
const CTX = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

const R = [];
const t = (kind, name, cond, got) => { R.push({ kind, name, ok: !!cond }); console.log((cond ? "ok   " : "NG   ") + "[" + kind + "] " + name + (cond ? "" : "   <<< " + String(got).slice(0, 240))); };

// ---- 署名の道具(redteam_gate と同じ型: WebCrypto ES256 + 扉自身の正規化) ----
const b64u = (bytes) => { let b = ""; for (const x of bytes) b += String.fromCharCode(x); return btoa(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const b64uStr = (s) => b64u(new TextEncoder().encode(s));
const KEY = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const JWK = Object.assign(await crypto.subtle.exportKey("jwk", KEY.publicKey), { kid: "attr-key-1", alg: "ES256", use: "sig" });
delete JWK.key_ops; delete JWK.ext;
async function sign(card, hdr) {
  const protectedB64 = b64uStr(JSON.stringify(Object.assign({ alg: "ES256", typ: "JOSE", kid: "attr-key-1", jku: JWKS }, hdr || {})));
  const payload = b64uStr(cardSignatureCanonical(card).canonical);
  const s = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, KEY.privateKey, new TextEncoder().encode(protectedB64 + "." + payload)));
  return Object.assign({}, card, { signatures: [{ protected: protectedB64, signature: b64u(s) }] });
}

const COMP = { paid_by: "buyer", referral_fee: false, listing_fee: false, success_fee_pct: 0, disclosure_url: "https://example.invalid/d" };
const CARD = { name: "Attributability Agent", description: "a mock", url: "", compensation: COMP };

function install(card, opts) {
  const o = opts || {};
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname === "/.well-known/agent-card.json") return new Response(JSON.stringify(card), { headers: { "content-type": "application/json" } });
    // 所有者の同意ファイル。これが無いと determinism を測らんので status は pending のままになる(0.2.4 の規則)。
    // ここで測りたいのは「署名が合否を動かさんこと」やから、同意を置いて verified まで行かせる。
    if (u.pathname === "/.well-known/mcp-conduct.json") return new Response(JSON.stringify({ allow_tool_call: true }), { headers: { "content-type": "application/json" } });
    if (u.href === JWKS || u.href === FOREIGN_JWKS) {
      if (o.jwks === "404") return new Response("no", { status: 404 });
      return new Response(JSON.stringify({ keys: o.jwks === "otherkid" ? [Object.assign({}, JWK, { kid: "someone-else" })] : [JWK] }), { headers: { "content-type": "application/json" } });
    }
    if (u.pathname === "/mcp") {
      const b = JSON.parse(init.body);
      if (b.method === "initialize") return new Response(JSON.stringify({ jsonrpc: "2.0", id: b.id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "s", version: "1" }, capabilities: {} } }), { headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: b.id, result: { tools: [{ name: "t1", description: "d", inputSchema: { type: "object", properties: {} } }] } }), { headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  };
}
async function check(card, opts) {
  install(card, opts);
  const res = await worker.fetch(new Request(O + "/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: EP }) }), ENV, CTX);
  return await res.json();
}
const REPUDIATE = /carried no signature/;
const ATTRIB = /attributable to the operator/;
const UNCONFIRMED = /could not confirm it/;
const has = (arr, re) => Array.isArray(arr) && arr.some((x) => re.test(x));

// ---------------------------------------------------------------- 無署名
let v = await check(CARD);
t("fix", "unsigned: does_not_establish says the operator can repudiate these bytes", has(v.does_not_establish, REPUDIATE) && /repudiate/.test(v.does_not_establish.join(" ")), JSON.stringify(v.does_not_establish));
t("fix", "unsigned: establishes never claims attributability", !has(v.establishes, ATTRIB), JSON.stringify(v.establishes));
t("control", "unsigned: the row is still verified, condition 2 still passes (no new rule, nothing turns red)", v.status === "verified" && v.checks.agent_card.pass === true, v.status);
t("control", "unsigned: the line says an unsigned card is permitted, so it reads as a limit and not as a fault", /is not a failure/.test(v.does_not_establish.join(" ")), JSON.stringify(v.does_not_establish));
t("fix", "unsigned: the new line is inside the bytes record_sha256 covers", (() => {
  const b = { ...v }; delete b.record_sha256; delete b.recompute_note;
  const s = JSON.stringify(b);
  return REPUDIATE.test(s) && sha256(s) === v.record_sha256;
})(), v.record_sha256);

// ---------------------------------------------------------------- 署名あり、検証 OK
const SIGNED = await sign(CARD);
v = await check(SIGNED);
t("fix", "signed and verifying: establishes says the declaration is attributable to the operator", has(v.establishes, ATTRIB), JSON.stringify(v.establishes.slice(-1)));
t("fix", "signed and verifying: the line names the key location and the kid", /attr-key-1/.test(v.establishes.join(" ")) && v.establishes.join(" ").includes(JWKS), JSON.stringify(v.establishes.slice(-1)));
t("fix", "signed and verifying: no repudiation line", !has(v.does_not_establish, REPUDIATE) && !has(v.does_not_establish, UNCONFIRMED), JSON.stringify(v.does_not_establish));
t("control", "signed and verifying: status unchanged, the signature did not become a condition", v.status === "verified" && Object.keys(v.checks).length === 4, v.status + " " + Object.keys(v.checks).join(","));
t("fix", "signed and verifying: the claim is inside the hashed bytes", (() => {
  const b = { ...v }; delete b.record_sha256; delete b.recompute_note;
  const s = JSON.stringify(b);
  return ATTRIB.test(s) && sha256(s) === v.record_sha256;
})(), v.record_sha256);

// ---------------------------------------------------------------- 署名あり、確認できん 3 通り
const EDITED = Object.assign({}, SIGNED, { description: SIGNED.description + " (edited after signing)" });
v = await check(EDITED);
t("attack", "edited after signing: no attributability claim, and the record says why", !has(v.establishes, ATTRIB) && has(v.does_not_establish, UNCONFIRMED) && /changed after signing/.test(v.does_not_establish.join(" ")), JSON.stringify(v.does_not_establish.slice(-1)));
t("control", "edited after signing: still verified (0.3.4 rule unchanged, disclosed not judged)", v.status === "verified" && v.checks.agent_card.pass === true, v.status);

v = await check(SIGNED, { jwks: "404" });
t("attack", "jwks unreadable: no attributability claim, reason named", !has(v.establishes, ATTRIB) && has(v.does_not_establish, UNCONFIRMED) && /jwks not readable/.test(v.does_not_establish.join(" ")), JSON.stringify(v.does_not_establish.slice(-1)));

v = await check(SIGNED, { jwks: "otherkid" });
t("attack", "kid not in the jwks: no attributability claim, reason named", !has(v.establishes, ATTRIB) && has(v.does_not_establish, UNCONFIRMED) && /kid not found/.test(v.does_not_establish.join(" ")), JSON.stringify(v.does_not_establish.slice(-1)));

v = await check(Object.assign({}, CARD, { signatures: ["garbage"] }));
t("attack", "a signatures array of garbage claims nothing and does not crash", !has(v.establishes, ATTRIB) && has(v.does_not_establish, UNCONFIRMED) && v.status === "verified", JSON.stringify(v.does_not_establish.slice(-1)));

// ---------------------------------------------------------------- 鍵が別ホストでも、検証できたなら帰属する
const FOREIGN = await sign(CARD, { jku: FOREIGN_JWKS });
v = await check(FOREIGN);
t("control", "a key on another host that verifies still attributes, and the line names that host", has(v.establishes, ATTRIB) && v.establishes.join(" ").includes(FOREIGN_JWKS), JSON.stringify(v.establishes.slice(-1)));
t("control", "and the verdict still discloses that the key was not on the same host", v.checks.agent_card.detail.signature.signatures[0].jku_same_host === false, JSON.stringify(v.checks.agent_card.detail.signature.signatures[0]));

// ---------------------------------------------------------------- 0.4.0 の行は動かしとらん
v = await check(CARD);
t("control", "the 0.4.0 lines are untouched: measurement, conditions, recompute, and the four disclaimers", v.establishes.length >= 3 && /this gate \(commit /.test(v.establishes[0]) && /conditions passed:/.test(v.establishes[1]) && has(v.does_not_establish, /correctness of any price/) && has(v.does_not_establish, /truth of the compensation declaration/), JSON.stringify(v.establishes.length) + " / " + JSON.stringify(v.does_not_establish.length));
t("control", "exactly one attributability line is added, never both", (() => {
  const n = v.does_not_establish.filter((x) => REPUDIATE.test(x) || UNCONFIRMED.test(x)).length + v.establishes.filter((x) => ATTRIB.test(x)).length;
  return n === 1;
})(), JSON.stringify(v.does_not_establish));

const spec = await (await worker.fetch(new Request(O + "/spec"), ENV, CTX)).json();
t("control", "/health and /spec report 0.4.4", spec.version === "0.4.4" || (await (await worker.fetch(new Request(O + "/health"), ENV, CTX)).json()).gate_version === "0.4.4", JSON.stringify(spec.version));

const passed = R.filter((r) => r.ok).length;
const by = (k) => R.filter((r) => r.kind === k);
console.log("");
for (const k of ["attack", "fix", "control"]) console.log("  " + k.padEnd(9) + by(k).filter((r) => r.ok).length + " / " + by(k).length);
console.log("");
console.log("=== " + passed + " / " + R.length + " 合格 (attributability、扉 0.4.4) ===");
console.log("署名は合否やない。署名の無い行は「うちの言葉」、署名の有る行は「相手の言葉」。記録がそれを名乗る。");
if (passed !== R.length) process.exit(1);
