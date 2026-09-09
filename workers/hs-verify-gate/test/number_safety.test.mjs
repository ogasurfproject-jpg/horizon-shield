// 0.4.2 (2026-09-09): 判定自身のバイトの中の数値は、他所の言語でも同じに書き戻せるか。
// 条件07 は測る相手の表面に「2^53 の外の整数を含むなら指紋を出さん」と課しとる(RFC 7493 I-JSON)。
// この試験は、同じ問いを扉自身の出力に当てる。運営者は例外やなく被験者。
// 発端: Federico Blanco Sanchez-Llanos が 2026-09-09 に payments 側から公開した同じ型
// (精度はパースの時点で失われる = 正準化コードが動く前に壊れとる = 散文では間に合わん)。
//
// 見張るもの:
//   1. 不動点。number_safety は数値を 1 つも持たんので、足す前と後で走査の答えが変わらん。
//      ここが崩れたら、欄が自分について嘘をつく。hash の中に入れてええ根拠が消える。
//   2. 本物の判定と /self が safe_integers_only を持ち、hash に入っとる(引用から外せん)。
//   3. 走査が本当に捕まえるか。2^53 の外、非整数、非有限を毒として入れて確かめる。
//   4. 判定規則は不変。number_safety で赤くならん。recipe(2 欄を抜いて JSON.stringify)も不変。
// Offline。走らせ方: node test/number_safety.test.mjs   (workers/hs-verify-gate で)  1 つ落ちたら exit 1。
import worker, { _numberSafety } from "../src/worker.js";
import { createHash } from "node:crypto";

const CTX = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
const jres = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } });
const CARD = { name: "Redteam Agent", description: "an adversarial mock", url: "",
  compensation: { paid_by: "public", referral_fee: false, listing_fee: false, success_fee_pct: 0, disclosure_url: "https://example.invalid/disclosure" } };
// 3 本にしとくのは、cannot_distinguish_pct が割り切れん値(33.3 等)になる道を開けとくため。
// 扉が実際に小数を出し得るなら、この試験はそれを捕まえんといかん。
const TOOLS = [
  { name: "alpha", description: "redteam tool alpha", inputSchema: { type: "object", properties: {} }, outputSchema: { type: "object", properties: { found: { type: "boolean" } } } },
  { name: "beta", description: "redteam tool beta", inputSchema: { type: "object", properties: {} } },
  { name: "gamma", description: "redteam tool gamma", inputSchema: { type: "object", properties: {} } }
];
function kv() {
  const store = new Map();
  return {
    store, puts: 0,
    get: async (k, type) => { const v = store.has(k) ? store.get(k) : null; return (type === "json" && v !== null) ? JSON.parse(v) : v; },
    put: async function (k, v) { this.puts++; store.set(k, typeof v === "string" ? v : JSON.stringify(v)); },
    delete: async (k) => { store.delete(k); },
    list: async (o) => ({ keys: [...store.keys()].filter((k) => k.startsWith((o && o.prefix) || "")).map((name) => ({ name })), list_complete: true }),
  };
}
const sha256 = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
const HASH_A = "aa".repeat(32);
const EXPLORER = { tips: { "mempool.space": 900006, "blockstream.info": 900007 }, hashAt: { 900000: { "mempool.space": HASH_A, "blockstream.info": HASH_A } }, blockTime: { [HASH_A]: Math.floor(Date.now() / 1000) + 3600 } };
function explorerAnswer(u) {
  const src = u.hostname;
  if (u.pathname === "/api/blocks/tip/height") { const t = EXPLORER.tips[src]; return t == null ? new Response("down", { status: 503 }) : new Response(String(t)); }
  let m = /^\/api\/block-height\/(\d+)$/.exec(u.pathname);
  if (m) { const h = EXPLORER.hashAt[m[1]] && EXPLORER.hashAt[m[1]][src]; return h ? new Response(h) : new Response("", { status: 404 }); }
  m = /^\/api\/block\/([0-9a-f]{64})$/.exec(u.pathname);
  if (m) { const ts = EXPLORER.blockTime[m[1]]; return ts == null ? new Response("", { status: 404 }) : jres({ id: m[1], height: 900000, timestamp: ts }); }
  return new Response("", { status: 404 });
}
const WELLKNOWN = new Map();
globalThis.fetch = async (url, init) => {
  const u = new URL(url);
  if (u.hostname === "mempool.space" || u.hostname === "blockstream.info") return explorerAnswer(u);
  if (u.hostname === "ledger.horizonshield.dev") return jres({ ok: true, accepted: true, id: "x", sha256: "00".repeat(32) }, 201);
  if (u.hostname === "raw.githubusercontent.com") return new Response("404: Not Found", { status: 404 });
  if (!/\.redteam\.invalid$/.test(u.hostname)) return new Response("no", { status: 500 });
  if (u.pathname === "/.well-known/mcp-conduct.json") { const b = WELLKNOWN.get(u.hostname); return b ? jres(b) : new Response("", { status: 404 }); }
  if (u.pathname === "/.well-known/agent-card.json") return jres(CARD);
  if (u.pathname === "/mcp" && (init && init.method) === "POST") {
    const body = JSON.parse(init.body); const id = body.id;
    if (body.method === "initialize") return jres({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "rt", version: "0" }, capabilities: { tools: {} } } });
    if (body.method === "tools/list") return jres({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    if (body.method === "tools/call") return jres({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "constant answer" }] } });
    return jres({ jsonrpc: "2.0", id, error: { code: -32601, message: "nope" } });
  }
  return new Response("not found", { status: 404 });
};

const R = [];
const t = (kind, name, ok, detail = "") => R.push({ kind, name, ok: !!ok, detail: String(detail) });
const EP = "https://open.redteam.invalid/mcp";
WELLKNOWN.set("open.redteam.invalid", { allow_tool_call: true });
function freshEnv() {
  const env = { HS_VERIFY_KV: kv(), SWEEP_TOKEN: "redteam-sweep-token", GATE_COMMIT: "redteam-local" };
  const call = (path, init) => worker.fetch(new Request("https://gate.horizonshield.dev" + path, init), env, CTX);
  const post = (path, body, headers) => call(path, { method: "POST", headers: { "content-type": "application/json", ...(headers || {}) }, body: JSON.stringify(body) });
  return { env, call, post };
}
const recompute = (r) => { const c = JSON.parse(JSON.stringify(r)); delete c.record_sha256; delete c.recompute_note; return sha256(JSON.stringify(c)); };
const { call, post } = freshEnv();

// ---- 1. 不動点。ここが崩れたら欄を hash に入れてええ根拠が消える ----------------------------------------
{
  const { scanNumbers, numberSafety } = _numberSafety;
  const sample = { a: 1, b: "x", c: [2, 3], d: { e: 4 } };
  const before = scanNumbers(sample);
  const withBlock = Object.assign({}, sample, { number_safety: numberSafety(sample) });
  const after = scanNumbers(withBlock);
  t("attack", "fixed point: adding the block does not change the scan (the block carries no number of its own)",
    JSON.stringify(before) === JSON.stringify(after), JSON.stringify([before.length, after.length]));
  const blockOnly = scanNumbers(numberSafety(sample));
  t("attack", "the block itself contains no number at all", blockOnly.length === 0, JSON.stringify(blockOnly));
  const dirty = { pct: 33.3 };
  const dirtyBlock = numberSafety(dirty);
  t("attack", "fixed point holds for an unsafe record too",
    JSON.stringify(scanNumbers(dirty)) === JSON.stringify(scanNumbers(Object.assign({}, dirty, { number_safety: dirtyBlock }))));
  // 二つの見出しが、それぞれ違う質問に答えとるか。同じなら片方は要らん。
  t("control", "a record whose only flaw is a double: parse_safe true, safe_integers_only false",
    dirtyBlock.parse_safe === true && dirtyBlock.safe_integers_only === false && dirtyBlock.non_integer_numbers.length === 1,
    JSON.stringify([dirtyBlock.parse_safe, dirtyBlock.safe_integers_only]));
  const past = numberSafety(JSON.parse('{"amount":9007199254740993}'));
  t("attack", "a record carrying an integer past 2^53: both are false and the value is named as certain breakage",
    past.parse_safe === false && past.safe_integers_only === false && past.unsafe_integers.length === 1 && /amount/.test(past.unsafe_integers[0]),
    JSON.stringify([past.parse_safe, past.unsafe_integers]));
  const clean = numberSafety({ n: 8, m: [0, -1, 9007199254740991] });
  t("control", "a record of safe integers only: both are true and both lists are empty",
    clean.parse_safe === true && clean.safe_integers_only === true && clean.unsafe_integers.length === 0 && clean.non_integer_numbers.length === 0,
    JSON.stringify([clean.parse_safe, clean.safe_integers_only]));
  t("attack", "the block still carries no number after the second boolean was added",
    scanNumbers(dirtyBlock).length === 0 && scanNumbers(past).length === 0 && scanNumbers(clean).length === 0);
}

// ---- 2. 走査が本当に捕まえるか(毒) -----------------------------------------------------------------
{
  const { scanNumbers } = _numberSafety;
  const cases = [
    ["safe integer", { n: 965814 }, 0],
    ["zero and negative", { a: 0, b: -7 }, 0],
    ["the boundary itself, still safe", { n: 9007199254740991 }, 0],
    ["one past the boundary", { n: 9007199254740992 }, 1],
    ["wei scale", { amount: 1e21 }, 1],
    ["one decimal place, what cannot_distinguish_pct can produce", { pct: 33.3 }, 1],
    ["a long double", { pct: 1 / 3 }, 1],
    ["Infinity", { n: Infinity }, 1],
    ["NaN", { n: NaN }, 1],
    ["nested and in arrays", { a: { b: [1, 2.5] } }, 1],
    ["strings that look like numbers are not numbers", { s: "9007199254740993", t: "33.3" }, 0]
  ];
  let bad = [];
  for (const [name, obj, want] of cases) {
    const got = scanNumbers(obj).length;
    if (got !== want) bad.push(name + " want " + want + " got " + got);
  }
  t("attack", "the scan catches every shape a second implementer cannot reproduce, and nothing else (" + cases.length + " cases)",
    bad.length === 0, bad.join(" | "));
  const paths = scanNumbers({ a: { b: [1, 2.5] } });
  const first = (paths[0] && paths[0].text) || "";
  t("control", "a finding names the path and the printed value", /a\.b\[1\].*2\.5/.test(first), first);
  t("control", "every finding carries a kind the block can sort on", paths.every((f) => f && typeof f.kind === "string" && typeof f.text === "string"), JSON.stringify(paths));
}

// ---- 3. 本物の判定。欄があり、hash の中にあり、答えが記録と一致する ------------------------------------
const v = await (await post("/check", { endpoint: EP })).json();
t("control", "a /check verdict carries number_safety", !!(v.number_safety && typeof v.number_safety.safe_integers_only === "boolean"), JSON.stringify(Object.keys(v.number_safety || {})));
t("control", "the verdict still recomputes to its own record_sha256 (recipe unchanged: remove the same two fields)",
  recompute(v) === v.record_sha256, v.record_sha256);
{
  const stripped = JSON.parse(JSON.stringify(v)); delete stripped.number_safety;
  t("attack", "number_safety is inside the hashed bytes: a quote with it removed no longer recomputes",
    recompute(stripped) !== v.record_sha256);
}
{
  // 欄が言うとることは、そのバイトについて本当か。第三者と同じ手で確かめる。
  const c = JSON.parse(JSON.stringify(v)); delete c.record_sha256; delete c.recompute_note;
  const independent = _numberSafety.scanNumbers(c);
  t("attack", "the block tells the truth about its own bytes: an independent scan of the hashed object agrees",
    (independent.length === 0) === (v.number_safety.safe_integers_only === true),
    JSON.stringify([v.number_safety.safe_integers_only, independent.slice(0, 3)]));
  const ns = v.number_safety;
  t("control", "both lists are always present and always arrays (a machine reader never has to tell absent from empty)",
    Array.isArray(ns.unsafe_integers) && Array.isArray(ns.non_integer_numbers), JSON.stringify([ns.unsafe_integers.length, ns.non_integer_numbers.length]));
  t("attack", "the two lists together account for exactly what an independent scan finds",
    ns.unsafe_integers.length + ns.non_integer_numbers.length === independent.length,
    JSON.stringify([ns.unsafe_integers.length, ns.non_integer_numbers.length, independent.length]));
  t("attack", "the severities are not mixed: an integer past 2^53 never lands in the double list and a double never lands in the integer list",
    ns.unsafe_integers.every((x) => !/is not an integer/.test(x)) && ns.non_integer_numbers.every((x) => /is not an integer/.test(x)),
    JSON.stringify([ns.unsafe_integers.slice(0, 1), ns.non_integer_numbers.slice(0, 1)]));
  t("control", "with three tools the gate does emit a double (cannot_distinguish_pct), and the block names it rather than hiding it",
    ns.non_integer_numbers.some((x) => /cannot_distinguish_pct/.test(x)), JSON.stringify(ns.non_integer_numbers).slice(0, 200));
  t("control", "that double is reported as the softer of the two: certain breakage stays empty",
    ns.unsafe_integers.length === 0 && ns.safe_integers_only === false, JSON.stringify([ns.unsafe_integers, ns.safe_integers_only]));
  // parse_safe が本題。これが false の時だけ、読み手は書かれた物を見ることすらできん。
  // 実際の判定は必ず cannot_distinguish_pct を持つので safe_integers_only は常に false になる。
  // 見出しがいつも false では狼少年になるから、壊れ方の重さで欄を分けとる。
  t("control", "parse_safe is present and is the strictly weaker of the two claims",
    typeof ns.parse_safe === "boolean" && (ns.safe_integers_only === true ? ns.parse_safe === true : true),
    JSON.stringify([ns.parse_safe, ns.safe_integers_only]));
  t("attack", "parse_safe is exactly 'unsafe_integers is empty', not a softer restatement of safe_integers_only",
    ns.parse_safe === (ns.unsafe_integers.length === 0), JSON.stringify([ns.parse_safe, ns.unsafe_integers.length]));
  t("control", "an ordinary verdict is parse_safe true even though it carries a double: nothing here is destroyed at parse time",
    ns.parse_safe === true && ns.safe_integers_only === false, JSON.stringify([ns.parse_safe, ns.safe_integers_only]));
}
{
  // safe_integers_only が true なら、その主張どおりに他所の言語でも同じバイトに着くはず。
  // JS の中で確かめられる範囲でやる: parse して印字順のまま詰め直しても同じバイトか。
  const c = JSON.parse(JSON.stringify(v)); delete c.record_sha256; delete c.recompute_note;
  const canonical = JSON.stringify(c);
  const roundTrip = JSON.stringify(JSON.parse(canonical)) === canonical;
  t("control", "the claim holds where it can be checked here: parse and re-serialize reaches the same bytes",
    v.number_safety.safe_integers_only ? roundTrip : true, JSON.stringify([v.number_safety.safe_integers_only, roundTrip]));
}
t("control", "number_safety is a disclosed measurement, not a condition: it is not in checks and the status is unaffected",
  !("number_safety" in (v.checks || {})) && typeof v.status === "string" && /verified|pending|unreachable|held/.test(v.status), v.status);
t("control", "the block says plainly that nothing fails on it",
  /not a pass or fail/i.test(v.number_safety.not_a_rule || ""), (v.number_safety.not_a_rule || "").slice(0, 80));
t("control", "the block credits where the bug class was found in public",
  /Federico/.test(v.number_safety.why || ""), (v.number_safety.why || "").slice(0, 120));
t("control", "the block names condition 07 as the rule it is applying to itself",
  /condition 07/i.test(v.number_safety.self_applied || ""), (v.number_safety.self_applied || "").slice(0, 120));

// ---- 4. 扉自身の /self にも同じ欄がある(運営者は被験者) ------------------------------------------------
{
  const self = await (await call("/self")).json();
  const sr = self.record || self;
  t("control", "the gate's own /self record carries number_safety too", !!(sr.number_safety && typeof sr.number_safety.safe_integers_only === "boolean"));
  t("control", "the /self record still recomputes with the same recipe", sr.record_sha256 && recompute(sr) === sr.record_sha256);
  const c = JSON.parse(JSON.stringify(sr)); delete c.record_sha256; delete c.recompute_note;
  t("attack", "the /self block tells the truth about its own bytes",
    (_numberSafety.scanNumbers(c).length === 0) === (sr.number_safety.safe_integers_only === true),
    JSON.stringify([sr.number_safety.safe_integers_only, _numberSafety.scanNumbers(c).slice(0, 3)]));
}

// ---- 5. 版と仕様 ---------------------------------------------------------------------------------------
{
  const health = await (await call("/health")).json();
  t("control", "gate version is 0.4.x", /^0\.4\./.test(health.gate_version), health.gate_version);  // 0.4.3 で緩めた: この suite は number_safety を測る物で、版そのものを測る物やない
  const spec = await (await call("/spec")).json();
  const ns = spec.number_safety || {};
  t("control", "/spec documents number_safety: where it lives, why, that it is self applied and not a rule",
    /record_sha256/.test(ns.where || "") && /Federico/.test(ns.why || "") && /[Cc]ondition 07/.test(ns.self_applied || "") && /disclosed measurement/i.test(ns.not_a_rule || ""),
    JSON.stringify(Object.keys(ns)));
  t("control", "the recompute note tells a reader what to do when the answer is false",
    /number_safety/.test(v.recompute_note || "") && /\/record\//.test(v.recompute_note || ""), "");
}

// ---- 報告 ----------------------------------------------------------------------------------------------
const kinds = {};
for (const r of R) { const k = kinds[r.kind] || [0, 0]; kinds[r.kind] = [k[0] + (r.ok ? 1 : 0), k[1] + 1]; }
console.log("--- 種別 ---");
for (const k of ["attack", "control"]) if (kinds[k]) console.log("  " + k.padEnd(10) + " " + kinds[k][0] + " / " + kinds[k][1]);
console.log();
for (const r of R) if (!r.ok) console.log("  NG  [" + r.kind + "] " + r.name + "\n      " + r.detail);
const passed = R.filter((r) => r.ok).length;
console.log("=== " + passed + " / " + R.length + " 合格 (number safety、扉 0.4.2) ===");
if (passed === R.length) console.log("測る相手に課した規律を、自分の出力にも課した。欄は自分について嘘をつけん。");
process.exit(passed === R.length ? 0 : 1);
