// test/resume_admissions.test.mjs
// The Résumé's admissions[] (2026-11-02, DESIGN_RESUME_ADMISSIONS_v0, decisions R-1 and R-2) on the LIVE worker
// (src/worker.js) with a mock KV shaped like the agreement pool's daily batch (nenrin-agreement-batch-v1, the stored
// bytes at agr:anchored:<sha>). The six tests of section 4 of the design, plus the revocation mark. No network.
//
// Run: node test/resume_admissions.test.mjs
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorker, mockKV } from "./load.mjs";
import { canonicalUtf8 } from "../nenrin/agreement-v0/agreement_canonical.mjs";
import { canonical as resumeCanonical } from "../nenrin/resume-v1/resume_v1.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORIGIN = "https://ledger.horizonshield.dev";
const worker = await loadWorker("src/worker.js");
const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
let pass = 0, fail = 0;
const t = (name, ok, detail) => { if (ok) { pass++; console.log("ok   " + name); } else { fail++; console.log("NG   " + name + (detail !== undefined ? "   <<< " + JSON.stringify(detail).slice(0, 700) : "")); } };
globalThis.fetch = async () => new Response("not found", { status: 404 });

// marker strings: every text a relying party writes into an admission carries one, so a copy into the Résumé shows
const MARK = {
  admission_id: "MARKadmissionid", key_url: "MARKkeyurl", contract_id: "MARKcontractid", clause: "MARKclause",
  establishes: "MARKestablishes", nonce: "MARKnonce", presentation: "MARKpresentation", sig: "MARKsig", immune: "MARKimmune",
};
const H = (c) => c.repeat(32);
const CONTRACT = H("c1");
function content04({ decision = "pass", marks = [], checked = true, answered = true, unread = false } = {}) {
  return { answered, check_sha256: H("a1"), checked, decision, input_commit: H("a2"), marks, rules: "a2a-content-check-v1", rules_sha256: H("a3"),
    scope_sha256: marks.length ? H("a4") : null, unread };
}
function content03() {
  return { answered: true, check_sha256: H("b1"), checked: true, input_sha256: H("b2"), rules: "a2a-content-check-v0", rules_sha256: H("b3"),
    scope_conflict: null, scope_sha256: null, verdict: "none" };
}
// an a2a-admission-v0 record as the intake stores it (the resume route does not check signatures; the intake did)
function admission(domain, { version = "0.4", decision = "admit", reasons = ["inside_grant"], content = undefined, contract = CONTRACT, id = "1" } = {}) {
  const rec = {
    schema: "a2a-admission-v0", admission_id: MARK.admission_id + "-" + id,
    relying_party: { domain, key_url: "https://" + domain + "/" + MARK.key_url + "/keys.json" },
    contract_ref: { contract_id: MARK.contract_id, contract_sha256: contract },
    action_ref: { action_binding_digest: H("d1"), nonce: MARK.nonce },
    presentation_ref: { presented: MARK.presentation }, chain_view: { height: 974100 }, revocations_seen: [],
    decision, reasons, clause: MARK.clause, rules: version === "v0" ? {} : { version },
    establishes: [MARK.establishes], does_not_establish: ["x"], signatures: [{ alg: "ed25519", domain, sig: MARK.sig }],
    publication: "public",
  };
  if (version === "0.2" || version === "0.3" || version === "0.4") rec.immune = { note: MARK.immune };
  if (version === "0.3") rec.content = content === undefined ? content03() : content;
  if (version === "0.4") rec.content = content === undefined ? content04() : content;
  const rc = canonicalUtf8(rec);
  return { canonical_sha256: sha(rc), record_canonical: rc, report: { record_schema: "a2a-admission-v0", verdict: "accepted" } };
}
function revocation(contract = CONTRACT) {
  const rec = { schema: "a2a-revocation-v0", contract_ref: { contract_id: MARK.contract_id, contract_sha256: contract }, revoked_by: "principal", signatures: [] };
  const rc = canonicalUtf8(rec);
  return { canonical_sha256: sha(rc), record_canonical: rc, report: { record_schema: "a2a-revocation-v0", verdict: "accepted" } };
}
function agreement(parties) {
  const rec = { schema: "a2a-agreement-v1.1", agreement_id: "ag-" + parties.join(","), parties: parties.map((d, i) => ({ role: i ? "contractor" : "principal", domain: d, key_url: "https://" + d + "/keys/agreement.json" })), publication: "public" };
  const rc = canonicalUtf8(rec);
  return { canonical_sha256: sha(rc), record_canonical: rc, report: { record_schema: "a2a-agreement-v1.1", verdict: "accepted" } };
}
function tamper(s) { return { ...s, record_canonical: s.record_canonical + " " }; }
function batch(n, items, { ots_status = "confirmed", bitcoin_block = 974000 + n, block_time = "2026-11-01T01:00:00Z" } = {}) {
  const b = { schema: "nenrin-agreement-batch-v1", anchored_at: "2026-11-01T00:30:00Z", count: items.length,
    records: [...items].sort((a, c) => (a.canonical_sha256 < c.canonical_sha256 ? -1 : 1)).map((s) => ({ canonical_sha256: s.canonical_sha256, record_schema: s.report.record_schema, verdict: "accepted", verifier_version: "x" })) };
  const rc = JSON.stringify(b);
  return { n, work: "NENRIN agreement batch", claim_sha256: sha(rc), record_canonical: rc, schema: "v0-plain", ots_status, bitcoin_block, block_time };
}
let kv, env;
function seed(entries) {
  const put = [["seq", String(Math.max(0, ...entries.map(([e]) => e.n)))]];
  for (const [e, items] of entries) {
    put.push(["entry:" + e.n, JSON.stringify(e)]);
    for (const s of items) put.push(["agr:anchored:" + s.canonical_sha256, JSON.stringify({ n: e.n, stored: s })]);
  }
  kv = mockKV(put); env = { LEDGER: kv.binding, LEDGER_ADMIN_TOKEN: "t".repeat(64) };
}
const resume = async (ep) => {
  const r = await worker.fetch(new Request(ORIGIN + "/resume?endpoint=" + encodeURIComponent(ep)), env, { waitUntil: () => {} });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch (_e) {}
  return { status: r.status, j, text };
};
const RP = "shield.example.org";
const EP = "https://" + RP + "/";

// ---- 1. two admissions (one by the endpoint's host, one by another host) and one agreement in the same batch ----
const mine = admission(RP, { id: "mine" });
const theirs = admission("door.other.example", { id: "theirs" });
const ag = agreement([RP, "buyer.example.net"]);
seed([[batch(3, [mine, theirs, ag]), [mine, theirs, ag]]]);
let r = await resume(EP);
t("1. admissions[] lists only the admission whose relying party is the endpoint's host", r.status === 200 && Array.isArray(r.j.admissions) && r.j.admissions.length === 1
  && r.j.admissions[0].record_sha256 === mine.canonical_sha256 && r.j.admissions[0].ledger_n === 3 && r.j.admissions[0].decision === "admit", r.j);
t("1. agreements[] is as before (the agreement, by ledger entry; no admission in it)", JSON.stringify(r.j.agreements) === JSON.stringify([{ record_sha256: ag.canonical_sha256, ledger_n: 3 }]), r.j.agreements);
t("1. the schema stays nenrin-resume-v1 (R-2)", r.j.schema === "nenrin-resume-v1", r.j.schema);
const sub = await resume("https://door." + RP + "/mcp");
t("1. an endpoint on a subdomain of the relying party's domain carries it too (the parent domain, as for agreements)", sub.status === 200 && sub.j.admissions.length === 1 && sub.j.admissions[0].record_sha256 === mine.canonical_sha256, sub.j && sub.j.admissions);
const parent = await resume("https://example.org/");
t("1. the parent domain's own endpoint does not carry the subdomain's admission", parent.status === 200 && parent.j.admissions.length === 0, parent.j && parent.j.admissions);
const other = await resume("https://door.other.example/");
t("1. the other host's Résumé carries the other admission", other.status === 200 && other.j.admissions.length === 1 && other.j.admissions[0].record_sha256 === theirs.canonical_sha256, other.j && other.j.admissions);
const none = await resume("https://nobody.example/mcp");
t("1. an endpoint with no admission: admissions[] is an empty list", none.status === 200 && Array.isArray(none.j.admissions) && none.j.admissions.length === 0, none.j);

// ---- 2. the content block: 0.4 gives the closed four, 0.3 and before give null ----
const a04 = admission(RP, { id: "04", decision: "refuse", reasons: ["content_flagged"], content: content04({ decision: "stop" }) });
const a04m = admission(RP, { id: "04m", decision: "refuse", reasons: ["content_off_topic", "content_scope_conflict"], content: content04({ marks: ["off_topic", "rule_conflict"] }) });
const a03 = admission(RP, { id: "03", version: "0.3" });
const a02 = admission(RP, { id: "02", version: "0.2", decision: "escalate" });
const av0 = admission(RP, { id: "v0", version: "v0" });
seed([[batch(4, [a04, a04m, a03]), [a04, a04m, a03]], [batch(6, [a02, av0]), [a02, av0]]]);
r = await resume(EP);
const by = Object.fromEntries((r.j.admissions || []).map((x) => [x.record_sha256, x]));
t("2. five admissions, in ledger entry order", r.status === 200 && r.j.admissions.length === 5 && r.j.admissions.map((x) => x.ledger_n).join(",") === "4,4,4,6,6", r.j.admissions);
t("2. a 0.4 admission: content is {checked, decision, marks, rules_sha256}", JSON.stringify(by[a04.canonical_sha256].content) === JSON.stringify({ checked: true, decision: "stop", marks: [], rules_sha256: H("a3") })
  && JSON.stringify(Object.keys(by[a04.canonical_sha256]).sort()) === JSON.stringify(["content", "decision", "ledger_n", "record_sha256", "revoked"]), by[a04.canonical_sha256]);
t("2. a 0.4 admission with marks: the marks in their closed order", JSON.stringify(by[a04m.canonical_sha256].content) === JSON.stringify({ checked: true, decision: "pass", marks: ["off_topic", "rule_conflict"], rules_sha256: H("a3") }), by[a04m.canonical_sha256]);
t("2. 0.3, 0.2 and v0 admissions: content is null", [a03, a02, av0].every((a) => by[a.canonical_sha256] && by[a.canonical_sha256].content === null), [a03, a02, av0].map((a) => by[a.canonical_sha256]));
t("2. the decision is copied (refuse, escalate, admit)", by[a04.canonical_sha256].decision === "refuse" && by[a02.canonical_sha256].decision === "escalate" && by[av0.canonical_sha256].decision === "admit");

// ---- 2b. revoked: a principal's revocation of the same contract in a later anchored entry ----
const OTHERC = H("c2");
const early = admission(RP, { id: "early" });
const late = admission(RP, { id: "late" });
const unrelated = admission(RP, { id: "unrel", contract: OTHERC });
const rev = revocation(CONTRACT);
seed([[batch(3, [early, unrelated]), [early, unrelated]], [batch(5, [rev]), [rev]], [batch(7, [late]), [late]]]);
r = await resume(EP);
const rv = Object.fromEntries((r.j.admissions || []).map((x) => [x.record_sha256, x.revoked]));
t("2b. an admission whose contract was revoked in a later anchored entry: revoked true", rv[early.canonical_sha256] === true, r.j.admissions);
t("2b. an admission after the revocation, and one of another contract: revoked false", rv[late.canonical_sha256] === false && rv[unrelated.canonical_sha256] === false, r.j.admissions);
t("2b. the revocation itself is not an admission line and not an agreement", r.j.admissions.length === 3 && r.j.agreements.length === 0);
const revP = revocation(OTHERC);
seed([[batch(3, [unrelated]), [unrelated]], [batch(5, [revP], { ots_status: "pending", bitcoin_block: null, block_time: null }), [revP]]]);
r = await resume(EP);
t("2b. a revocation in a batch not yet anchored does not mark it", r.j.admissions.length === 1 && r.j.admissions[0].revoked === false, r.j.admissions);

// ---- 3. not counted: bytes that do not hash to the listed sha, a batch not yet anchored ----
const good = admission(RP, { id: "good" });
const bad = admission(RP, { id: "bad" });
const pend = admission(RP, { id: "pend" });
const conf = admission(RP, { id: "conf" });
seed([[batch(3, [good, bad]), [good, tamper(bad)]], [batch(5, [pend], { ots_status: "pending", bitcoin_block: null, block_time: null }), [pend]],
  [batch(7, [conf], { block_time: null }), [conf]]]);
r = await resume(EP);
const nc = (r.j && r.j.not_counted) || [];
const ncOf = (s) => nc.find((x) => x.record_sha256 === s.canonical_sha256);
t("3. only the good admission is counted", r.status === 200 && r.j.admissions.length === 1 && r.j.admissions[0].record_sha256 === good.canonical_sha256, r.j && r.j.admissions);
t("3. stored bytes that do not hash to the batch's sha: not_counted, admission_bytes_do_not_hash_to_the_listed_sha, kind admission",
  ncOf(bad) && ncOf(bad).why === "admission_bytes_do_not_hash_to_the_listed_sha" && ncOf(bad).kind === "admission" && ncOf(bad).url === ORIGIN + "/admission/" + bad.canonical_sha256, nc);
t("3. a batch not yet anchored: not_counted, not_yet_anchored, kind admission", ncOf(pend) && ncOf(pend).why === "not_yet_anchored" && ncOf(pend).kind === "admission" && ncOf(pend).ots_status === "pending", nc);
t("3. confirmed without a block time: not_counted, confirmed_without_block_time", ncOf(conf) && ncOf(conf).why === "confirmed_without_block_time" && ncOf(conf).kind === "admission", nc);
const weird = admission(RP, { id: "weird", decision: "allow" });
seed([[batch(3, [weird, good]), [weird, good]]]);
r = await resume(EP);
t("3. an admission whose decision is not a closed word: not_counted admission_fields_not_closed, the Résumé still assembles",
  r.status === 200 && r.j.admissions.length === 1 && (r.j.not_counted || []).some((x) => x.record_sha256 === weird.canonical_sha256 && x.why === "admission_fields_not_closed" && x.detail === "admission_not_closed"), r.j);

// ---- 4. no text: none of the marker strings from inside the admissions reaches the Résumé ----
seed([[batch(3, [mine, a04, a04m, a03, a02, av0, early, rev]), [mine, a04, a04m, a03, a02, av0, early, rev]]]);
r = await resume(EP);
const leaked = Object.values(MARK).filter((m) => r.text.includes(m));
t("4. the whole /resume answer carries none of the admissions' text (key_url, admission_id, clause, contract_id, nonce, establishes, immune, signatures)", r.status === 200 && r.j.admissions.length === 7 && leaked.length === 0, leaked);
const lineKeys = new Set(r.j.admissions.flatMap((x) => Object.keys(x)));
const contentKeys = new Set(r.j.admissions.filter((x) => x.content).flatMap((x) => Object.keys(x.content)));
t("4. a line has the five closed keys only, content the four closed keys only", JSON.stringify([...lineKeys].sort()) === JSON.stringify(["content", "decision", "ledger_n", "record_sha256", "revoked"])
  && JSON.stringify([...contentKeys].sort()) === JSON.stringify(["checked", "decision", "marks", "rules_sha256"]), { lineKeys: [...lineKeys], contentKeys: [...contentKeys] });
t("4. every value is closed: hex, integer, a word from a closed list, a boolean, or null", r.j.admissions.every((x) => /^[0-9a-f]{64}$/.test(x.record_sha256) && Number.isSafeInteger(x.ledger_n)
  && ["admit", "escalate", "refuse"].includes(x.decision) && typeof x.revoked === "boolean"
  && (x.content === null || (typeof x.content.checked === "boolean" && [null, "stop", "pass"].includes(x.content.decision)
    && x.content.marks.every((m) => ["off_topic", "rule_conflict"].includes(m)) && (x.content.rules_sha256 === null || /^[0-9a-f]{64}$/.test(x.content.rules_sha256))))), r.j.admissions);
{
  const core = { ...r.j }; for (const k of ["evaluated_at", "subject_responses", "not_counted", "scan", "recompute", "resume_sha256"]) delete core[k];
  t("4. resume_sha256 covers admissions[] (recomputed from the answer without the envelope fields)", sha(resumeCanonical(core)) === r.j.resume_sha256
    && (() => { const c2 = { ...core, admissions: [] }; return sha(resumeCanonical(c2)) !== r.j.resume_sha256; })());
}

// ---- 5. the python and JavaScript cores give the same bytes (resume_bytematch.py, the D cases with the rest) ----
{
  const dir = resolve(HERE, "../nenrin/resume-v1");
  let out = null;
  for (const py of ["python3", "python"]) {
    const p = spawnSync(py, ["-I", "-B", "resume_bytematch.py"], { cwd: dir, encoding: "utf8", timeout: 120000 });
    if (!p.error) { out = p; break; }
  }
  const last = out ? (out.stdout || "").trim().split("\n").pop() : "python not found";
  const dLines = out ? (out.stdout || "").split("\n").filter((l) => /^\[OK\] {3}D\d+_/.test(l)).length : 0;
  t("5. python and JavaScript cores match on every case, the ten admission cases among them (" + last + ")", out && out.status === 0 && /^cases (\d+) {2}match \1 {2}mismatch 0$/.test(last) && dLines === 10, out && { status: out.status, stdout: (out.stdout || "").slice(-900), stderr: (out.stderr || "").slice(0, 300) });
}

// ---- 6. TOOSHI's 4 (door -> Résumé): the check call's admission sha in admissions[] is ok, its absence is red ----
// The rule TOOSHI applies (tools/tooshi is changed by its own step, not here): ok when the admission the 03:47 UTC
// check call produced is listed in the relying party's Résumé by record_sha256; red when it is not.
const tooshi4 = (resumeJson, admissionSha) => (Array.isArray(resumeJson && resumeJson.admissions) && resumeJson.admissions.some((x) => x && x.record_sha256 === admissionSha) ? "ok" : "red");
seed([[batch(3, [a04]), [a04]]]);
r = await resume(EP);
t("6. TOOSHI 4: the check call's admission is in admissions[]: ok", tooshi4(r.j, a04.canonical_sha256) === "ok");
t("6. TOOSHI 4: an admission not in admissions[] (another sha): red", tooshi4(r.j, a04m.canonical_sha256) === "red");
seed([[batch(3, [a04], { ots_status: "pending", bitcoin_block: null, block_time: null }), [a04]]]);
r = await resume(EP);
t("6. TOOSHI 4: before its batch is anchored the admission is not listed (red until anchored; TOOSHI reads it after the batch)", tooshi4(r.j, a04.canonical_sha256) === "red" && (r.j.not_counted || []).some((x) => x.record_sha256 === a04.canonical_sha256 && x.why === "not_yet_anchored"));
t("6. TOOSHI 4: an answer without admissions[] (the Résumé before this step): red", tooshi4({ agreements: [] }, a04.canonical_sha256) === "red");

console.log("");
if (fail) { console.log("FAIL " + fail + " of " + (pass + fail) + " (the Résumé's admissions[] on the live worker)"); process.exit(1); }
console.log("PASS " + pass + "/" + pass + " (the Résumé's admissions[] on the live worker)");
