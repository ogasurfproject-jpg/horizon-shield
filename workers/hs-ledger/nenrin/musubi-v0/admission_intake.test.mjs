// admission_intake.test.mjs: the intake for a2a-admission-v0 and a2a-revocation-v0, on records made by the Python
// reference (fixtures/admission_intake/cases.json, written by a relying party's door from fixed test keys; fixtures/ADMISSION_FIXTURES.sha256 lists its sha256).
// No network: keys come from a stub, storage is a Map. Run: node admission_intake.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { handleAdmissionIntake, handleRevocationIntake, handleStoredGet, admissionSelfDescription, MAX_BYTES, LIMITS_BY_VERSION } from "./admission_intake.mjs";
import { verifyAdmissionText, DOES_NOT_ESTABLISH_V04, DOES_NOT_ESTABLISH_V05, contentFromChecksV05 } from "./admission_verify_v0.mjs";
import { canonical as musubiCanonical } from "./canonical_v0.mjs";
import { canonicalUtf8, parseStrict } from "../agreement-v0/agreement_canonical.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const C = JSON.parse(readFileSync(path.join(HERE, "fixtures", "admission_intake", "cases.json"), "utf8"));
let pass = 0, fail = 0;
const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log((ok ? "ok   " : "NG   ") + name + (ok || detail === undefined ? "" : "   <<< " + (typeof detail === "string" ? detail : JSON.stringify(detail)))); };
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

function world({ keys = null, bound = true } = {}) {
  const mem = new Map(), queued = [], fetched = [];
  const served = keys || { [C.relying_party.key_url]: C.relying_pub_b64, [C.principal_key_url]: C.principal_pub_b64 };
  return { mem, queued, fetched,
    deps: { origin: "https://ledger.horizonshield.dev", recorderDomain: "ledger.horizonshield.dev", now: () => "2026-10-10T00:00:00.000Z",
      fetchKey: async (u) => { fetched.push(u); return served[u] ? { ok: true, key: served[u] } : { ok: false, why: "key_url answered 404" }; },
      store: {
        claimAccepted: async (s, p) => { if (!bound) return { unbound: true }; if (mem.has(s)) return { duplicate: true, stored: mem.get(s) }; mem.set(s, p); return { duplicate: false, stored: p }; },
        queueForAnchor: async (s) => { queued.push(s); return { ok: true }; },
        getAccepted: async (s) => mem.get(s) || null,
        anchorState: async () => null } } };
}
const post = (b) => new Request("https://ledger.horizonshield.dev/x", { method: "POST", headers: { "content-type": "application/json" }, body: typeof b === "string" ? b : JSON.stringify(b) });
const edit = (text, f) => { const o = JSON.parse(text); f(o); return musubiCanonical(o); };

// ---- the canonical rule is one rule ----
for (const k of ["admission_public", "admission_public_v0", "admission_revoked_without_anchor", "admission_brought_result", "contract_canonical", "revocation_grant", "revocation_key"]) {
  // the intake reads with parseStrict (which keeps an integer an integer) and writes with canonicalUtf8; canonical_v0.mjs is the MUSUBI twin
  t("the intake's reader and writer and musubi-canonical-v0 give the bytes Python wrote for " + k, canonicalUtf8(parseStrict(C[k])) === C[k] && musubiCanonical(JSON.parse(C[k])) === C[k]);
}

// ---- POST /admission ----
let w = world();
let r = await handleAdmissionIntake(post({ record_canonical: C.admission_public }), w.deps);
t("a relying party's admission with signed consent to publication: 201, pending_anchor", r.status === 201 && r.body.status === "pending_anchor" && r.body.verdict === "accepted", r.body);
t("stored under the sha256 of the bytes received", r.body.canonical_sha256 === sha(C.admission_public) && w.mem.has(sha(C.admission_public)) && w.mem.get(sha(C.admission_public)).record_canonical === C.admission_public);
t("the response names admission_sha256, what an execution cites (the same value Python computes)", r.body.admission_sha256 === C.admission_public_sha256, r.body.admission_sha256);
t("queued for the daily batch the agreement intake anchors; batch row is schema a2a-admission-v0, verdict accepted", w.queued.length === 1 && r.body.report.record_schema === "a2a-admission-v0" && r.body.report.verdict === "accepted");
t("the intake says what it did not check, and that it did not agree with the decision", r.body.report.not_checked.length === 1 && /did not|does not/.test(JSON.stringify(r.body.does_not_establish) + r.body.report.not_checked[0]));
t("one key fetch, the relying party's own key_url", w.fetched.length === 1 && w.fetched[0] === C.relying_party.key_url);
r = await handleAdmissionIntake(post({ record_canonical: C.admission_public }), w.deps);
t("the same bytes again: 200, dedup, one stored record", r.status === 200 && r.body.dedup === true && w.mem.size === 1 && w.queued.length === 1, r.body);
r = await handleAdmissionIntake(post({ record_canonical: C.admission_refuse }), w.deps);
t("a refuse decision is recorded like any other (the intake does not prefer an outcome)", r.status === 201 && r.body.report.decision === "refuse", r.body);
r = await handleStoredGet("admission", sha(C.admission_public), w.deps);
t("GET /admission/{sha} serves the exact bytes", r.status === 200 && r.body.record_canonical === C.admission_public && r.body.status === "pending_anchor");
t("GET /revocation/{sha} does not serve an admission", (await handleStoredGet("revocation", sha(C.admission_public), w.deps)).status === 404);
t("GET with a bad sha: 400", (await handleStoredGet("admission", "xyz", w.deps)).status === 400);

const refusal = async (name, text, code, deps) => {
  const ww = deps || world();
  const rr = await handleAdmissionIntake(post({ record_canonical: text }), ww.deps);
  t("refused, nothing stored: " + name + " (" + code + ")", rr.status === 422 && (rr.body.refusals || [rr.body.error]).includes(code) && ww.mem.size === 0 && ww.queued.length === 0, rr.body);
};
await refusal("no signed consent to publication", C.admission_private, "publication_consent_missing");
await refusal("publication set to private after signing", edit(C.admission_public, (o) => { o.publication = "private"; }), "publication_not_public");
await refusal("signed by the applicant's key (self admission), relying party's key served", C.admission_signed_by_contractor, "bad_signature");
await refusal("decision edited after signing", edit(C.admission_public, (o) => { o.decision = "refuse"; o.reasons = ["prohibited_action"]; }), "bad_signature");
await refusal("key_url on another domain", edit(C.admission_public, (o) => { o.relying_party.key_url = "https://evil.example/k.json"; }), "signer_not_on_own_domain");
await refusal("a stated limit removed", edit(C.admission_public, (o) => { o.does_not_establish.pop(); }), "does_not_establish_altered");
await refusal("a v0.1 record carrying v0's stated limits", edit(C.admission_public, (o) => { o.does_not_establish[2] = "that a revocation published after the chain view was known at admission time"; }), "does_not_establish_altered");
await refusal("a v0 record relabelled as v0.1", edit(C.admission_public_v0, (o) => { o.rules.version = "0.1"; }), "does_not_establish_altered");
await refusal("a version of admit() this intake does not know", edit(C.admission_public, (o) => { o.rules.version = "9"; }), "malformed");
await refusal("rules.version written as v0", edit(C.admission_public, (o) => { o.rules.version = "v0"; }), "malformed");
await refusal("rules.version a number", edit(C.admission_public, (o) => { o.rules.version = 1; }), "malformed");
{
  const ww = world();
  const r0 = await handleAdmissionIntake(post({ record_canonical: C.admission_public_v0 }), ww.deps);
  t("a record admit v0 signed is still accepted and stored under its own sha", r0.status === 201 && r0.body.canonical_sha256 === C.admission_public_v0_canonical_sha256 && r0.body.admission_sha256 === C.admission_public_v0_admission_sha256 && r0.body.report.admit_version === "0", r0.body);
  const r1 = await handleAdmissionIntake(post({ record_canonical: C.admission_revoked_without_anchor }), ww.deps);
  const rec1 = JSON.parse(C.admission_revoked_without_anchor);
  t("a v0.1 refusal on an unanchored revocation is stored, and says the revocation carried no anchor", r1.status === 201 && r1.body.report.admit_version === "0.1"
    && rec1.decision === "refuse" && rec1.revocations_seen.length === 1 && rec1.revocations_seen[0].anchored === false && rec1.revocations_seen[0].height === null, r1.body);
  const r2 = await handleAdmissionIntake(post({ record_canonical: C.admission_brought_result }), ww.deps);
  const rec2 = JSON.parse(C.admission_brought_result);
  t("a v0.1 refusal of a brought result is stored, and names what was brought", r2.status === 201 && rec2.decision === "refuse" && JSON.stringify(rec2.presentation_ref[0].self_declared) === JSON.stringify(["verified"]), r2.body);
}
await refusal("a reason outside the closed list", edit(C.admission_public, (o) => { o.reasons = ["looks_fine"]; }), "malformed");
await refusal("an extra field (a score)", edit(C.admission_public, (o) => { o.score = 97; }), "malformed");
await refusal("another schema", edit(C.admission_public, (o) => { o.schema = "a2a-admission-v1"; }), "malformed");
await refusal("the key the key_url serves is another key", C.admission_public, "bad_signature", world({ keys: { [C.relying_party.key_url]: C.stranger_pub_b64 } }));
await refusal("bytes that are not canonical (pretty printed)", JSON.stringify(JSON.parse(C.admission_public), null, 1), "not_canonical");
await refusal("not JSON", "{", "unparseable_record");
w = world({ keys: {} });
r = await handleAdmissionIntake(post({ record_canonical: C.admission_public }), w.deps);
t("key_url unreachable: 503 with retry-after, not a verdict, nothing stored", r.status === 503 && r.headers["retry-after"] === "30" && w.mem.size === 0, r.body);
w = world({ bound: false });
r = await handleAdmissionIntake(post({ record_canonical: C.admission_public }), w.deps);
t("dedupe gate unbound: 503, fail closed", r.status === 503 && r.body.error === "dedupe_gate_unbound");
t("no record_canonical: 400", (await handleAdmissionIntake(post({}), world().deps)).status === 400);
t("too large: 413", (await handleAdmissionIntake(post({ record_canonical: "x".repeat(MAX_BYTES + 1) }), world().deps)).status === 413);
w = world(); w.deps.rateLimit = async () => ({ ok: false, error: "daily_cap", cap: 50, scope: "network" });
t("rate limited: 429, before any parsing", (await handleAdmissionIntake(post({ record_canonical: C.admission_public }), w.deps)).status === 429 && w.fetched.length === 0);

// ---- POST /revocation ----
w = world();
r = await handleRevocationIntake(post({ record_canonical: C.revocation_grant, contract_canonical: C.contract_canonical }), w.deps);
t("the principal's revocation of the grant: 201, pending_anchor, revokes grant", r.status === 201 && r.body.report.revokes === "grant" && r.body.report.contract_sha256 === C.contract_sha256, r.body);
t("only the revocation is stored, not the contract", w.mem.size === 1 && w.mem.get(sha(C.revocation_grant)).record_canonical === C.revocation_grant && !JSON.stringify([...w.mem.values()]).includes("authorized_actions"));
r = await handleRevocationIntake(post({ record_canonical: C.revocation_key, contract_canonical: C.contract_canonical }), w.deps);
t("the principal's revocation of one key: 201, revokes key", r.status === 201 && r.body.report.revokes === "key", r.body);
t("GET /revocation/{sha} serves the exact bytes", (await handleStoredGet("revocation", sha(C.revocation_key), w.deps)).body.record_canonical === C.revocation_key);
const rrev = async (name, bodyObj, code, deps) => {
  const ww = deps || world();
  const rr = await handleRevocationIntake(post(bodyObj), ww.deps);
  t("refused, nothing stored: " + name + " (" + code + ")", rr.status === 422 && (rr.body.refusals || []).includes(code) && ww.mem.size === 0, rr.body);
};
await rrev("a revocation signed by the contractor", { record_canonical: C.revocation_by_contractor, contract_canonical: C.contract_canonical }, "bad_signature");
await rrev("a revocation sent with another contract", { record_canonical: C.revocation_grant, contract_canonical: C.other_contract_canonical }, "other_contract");
await rrev("the contract edited after signing (and the revocation re-pointed)", { record_canonical: C.revocation_grant, contract_canonical: edit(C.contract_canonical, (o) => { o.nonce = "0".repeat(32); }) }, "other_contract");
await rrev("an extra field in the revocation", { record_canonical: edit(C.revocation_grant, (o) => { o.reason = "x"; }), contract_canonical: C.contract_canonical }, "malformed");
await rrev("revoked_by is not the principal", { record_canonical: edit(C.revocation_grant, (o) => { o.revoked_by = "contractor"; }), contract_canonical: C.contract_canonical }, "malformed");
await rrev("the principal's key_url now serves another key", { record_canonical: C.revocation_grant, contract_canonical: C.contract_canonical }, "key_url_serves_another_key", world({ keys: { [C.principal_key_url]: C.stranger_pub_b64 } }));
w = world({ keys: {} });
r = await handleRevocationIntake(post({ record_canonical: C.revocation_grant, contract_canonical: C.contract_canonical }), w.deps);
t("principal's key_url unreachable: 503, not a verdict", r.status === 503 && w.mem.size === 0);
t("no contract sent: 400", (await handleRevocationIntake(post({ record_canonical: C.revocation_grant }), world().deps)).status === 400);

// ---- the self description ----
const d = admissionSelfDescription("https://ledger.horizonshield.dev");
t("the self description says what the intake does not do", d.what_this_does_not_do.length === 3 && d.schemas.join() === "a2a-admission-v0,a2a-revocation-v0");

// ---- v0.2: the immune block (fixtures/admission_immune/cases.json, the first attack as a door signed it) ----
{
  const IC = JSON.parse(readFileSync(path.join(HERE, "fixtures", "admission_immune", "cases.json"), "utf8"));
  const doorKeyUrl = JSON.parse(IC.records.D_listed_payee).relying_party.key_url;
  const good = Object.keys(IC.records).filter((k) => /^[A-Z]/.test(k));
  const wi = world({ keys: { [doorKeyUrl]: IC.relying_pub_b64 } });
  let okAll = true;
  for (const k of good) {
    const rr = await handleAdmissionIntake(post({ record_canonical: IC.records[k] }), wi.deps);
    okAll = okAll && rr.status === 201 && rr.body.report.admit_version === "0.2" && rr.body.report.decision === JSON.parse(IC.records[k]).decision;
  }
  t("v0.2: the " + good.length + " admissions of the first attack, each with its immune block, are accepted and stored", okAll && wi.mem.size === good.length);
  const want = { v02_without_immune: "malformed", v01_with_immune: "malformed", v02_v01_limits: "does_not_establish_altered", reject_admitted: "immune_inconsistent",
    hold_without_reason: "immune_inconsistent", released_without_signal: "malformed", clear_with_codes: "immune_inconsistent", unknown_code: "malformed",
    immune_reason_in_v01: "malformed", extra_immune_field: "malformed", reasons_a_string: "malformed", version_null: "malformed",
    indicator_seen_on_hold_only: "immune_inconsistent" };
  for (const [k, code] of Object.entries(want)) await refusal("v0.2 broken: " + k, IC.records[k], code, world({ keys: { [doorKeyUrl]: IC.relying_pub_b64 } }));
  const anyGood = IC.records[good[0]];
  await refusal("a negative chain height is malformed", edit(anyGood, (o) => { o.chain_view.height = -1; }), "malformed", world({ keys: { [doorKeyUrl]: IC.relying_pub_b64 } }));
  const floatText = anyGood.replace(/"height":(\d+)/, '"height":$1.5');
  const rf = await handleAdmissionIntake(post({ record_canonical: floatText }), world({ keys: { [doorKeyUrl]: IC.relying_pub_b64 } }).deps);
  t("a chain height that is not an integer never reaches the store", floatText !== anyGood && rf.status === 422, rf.body);

  // Records signed by a key of this test for exactly their canonical bytes, so a refusal is the defect's. The intake's
  // verdict must be the verifier's (verifyAdmissionText, the twin of admission_verify_v0.verify_admission_text).
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pub = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url").toString("base64");
  const signed = (rec) => {
    const b = Object.fromEntries(Object.entries(rec).filter(([k]) => k !== "signatures"));
    const sig = cryptoSign(null, Buffer.from("a2a-admission-v0\n" + canonicalUtf8(b), "utf8"), privateKey).toString("base64");
    return { ...b, signatures: [{ alg: "ed25519", domain: b.relying_party.domain, sig }] };
  };
  const base = parseStrict(anyGood), h0 = base.chain_view.height, hs = '"height":' + h0;
  const S = (kw) => canonicalUtf8(signed({ ...base, ...kw }));
  const st = S({});
  const retext = (old, nu) => { if (st.split(old).length !== 2) throw new Error("not once: " + old); return st.replace(old, nu); };
  const hold = (codes) => S({ decision: "escalate", reasons: ["immune_hold"], immune: { ...base.immune, verdict: "hold", codes } });
  const cases = [
    ["resigned (the control)", st, null],
    ["(a) height written 970204.0", S({ chain_view: { ...base.chain_view, height: Number(h0) } }), "malformed"],
    ["(a) height written with an exponent", retext(hs, '"height":' + String(h0)[0] + "." + String(h0).slice(1) + "e" + (String(h0).length - 1)), "not_canonical"],
    ["(a) a duplicate key, the last one the signed value", retext('"decision":"refuse"', '"decision":"admit","decision":"refuse"'), "unparseable_record"],
    ["(b) rules a string", S({ rules: "0.2" }), "malformed"],
    ["(b) rules an array", S({ rules: [base.rules] }), "malformed"],
    ["(b) contract_ref a string", S({ contract_ref: base.contract_ref.contract_sha256 }), "malformed"],
    ["(b) does_not_establish 5 (a BigInt, which JSON.stringify could not write)", S({ does_not_establish: 5n }), "malformed"],
    ["(b) does_not_establish true", S({ does_not_establish: true }), "malformed"],
    ["(b) signatures 5", canonicalUtf8({ ...signed(base), signatures: 5n }), "malformed"],
    ["(c) 2^53 outside the height", S({ presentation_ref: [{ ...base.presentation_ref[0], n: 2n ** 53n }] }), "malformed"],
    ["(c) -2^53 outside the height", S({ presentation_ref: [{ ...base.presentation_ref[0], n: -(2n ** 53n) }] }), "malformed"],
    ["(c) height 2^60", S({ chain_view: { ...base.chain_view, height: 2n ** 60n } }), "malformed"],
    ["(c) height of 5000 digits", retext(hs, '"height":' + "9".repeat(5000)), "malformed"],
    ["(c) height NaN", retext(hs, '"height":NaN'), "malformed"],
    ["(c) a float outside the height", S({ presentation_ref: [{ ...base.presentation_ref[0], extra: 0.5 }] }), "malformed"],
    ["(c) a __proto__ key", retext('"publication":"public"', '"__proto__":{},"publication":"public"'), "not_canonical"],
    ["(d) reject, terms_malformed", S({ immune: { ...base.immune, codes: ["terms_malformed"] } }), null],
    ["(d) reject, vetoed", S({ immune: { ...base.immune, codes: ["receptor_closed", "vetoed"] } }), null],
    ["(d) hold, cooling_off", hold(["cooling_off"]), null],
    ["(d) hold, exposure_full", hold(["exposure_full", "unmarked_novel"]), null],
    ["(d) hold carrying vetoed", hold(["cooling_off", "vetoed"]), "immune_inconsistent"],
    ["(d) reject with only cooling_off", S({ immune: { ...base.immune, codes: ["cooling_off"] } }), "immune_inconsistent"],
    ["(d) flagged with cooling_off", S({ decision: "admit", reasons: ["within_grant"], immune: { ...base.immune, verdict: "flagged", codes: ["cooling_off"] } }), "immune_inconsistent"],
  ];
  // keys outside printable ASCII, the digits of a key_url port, lone surrogates (2026-10-21)
  const pr = (kw) => S({ presentation_ref: [{ ...base.presentation_ref[0], ...kw }] });
  for (const [name, key] of [["NUL", "a\u0000"], ["e acute", "\u00e9"], ["DEL", "\x7f"], ["an emoji", "\u{1F600}"], ["a tab", "a\tb"]]) {
    cases.push(["a key with " + name, pr({ [key]: 1n }), "malformed"]);
  }
  cases.push(["a key of printable ASCII only", pr({ " ~": 1n }), null]);
  const port = (d) => S({ relying_party: { ...base.relying_party, key_url: "https://" + base.relying_party.domain + ":" + d + "/keys/door.json" } });
  for (const [name, d] of [["Garay", "\u{10D41}"], ["outlined", "\u{1CCF1}"], ["Tangsa", "\u{16AC1}"], ["Kawi", "\u{11F51}"], ["fullwidth", "\uff18"],
    ["Arabic-Indic", "\u0668"], ["ASCII then Devanagari", "8\u0966"]]) cases.push(["a key_url port of " + name + " digits", port(d), "signer_not_on_own_domain"]);
  cases.push(["a key_url port of ASCII digits", port("8443"), null]);
  // the bytes Python and canonical_v0.mjs write for a lone surrogate (rule 7: an escape); canonicalUtf8 would write it raw
  const esc = (text, ch) => text.split(ch).join("\\u" + ch.charCodeAt(0).toString(16));
  for (const [name, val] of [["high", "\ud800"], ["low", "\udc00"], ["reversed pair", "\ude00\ud83d"], ["high at the end", "x\udbff"]]) {
    let text = pr({ note: val });
    for (const ch of new Set(val)) if (ch.charCodeAt(0) >= 0xd800 && ch.charCodeAt(0) <= 0xdfff) text = esc(text, ch);
    cases.push(["a lone surrogate (" + name + ") in a value, written as rule 7 writes it", text, "not_canonical"]);
  }
  cases.push(["a lone surrogate in a key, written as rule 7 writes it", esc(pr({ "\udc00": 1n }), "\udc00"), "not_canonical"]);
  cases.push(["a lone surrogate sent raw inside record_canonical (JSON.stringify escapes it in the body)", pr({ note: "\ud800" }), "malformed"]);
  cases.push(["a pair, raw", pr({ note: "\u{1F600}" }), null]);
  cases.push(["a pair written as two escapes (the verifier accepts; the bytes are not canonical)", pr({ note: "\u{1F600}" }).replace("\u{1F600}", "\\ud83d\\ude00"), "not_canonical"]);
  for (const [name, text, code] of cases) {
    let kurl = doorKeyUrl;
    try { kurl = parseStrict(text).relying_party.key_url; } catch (_e) { /* unreadable: the door's own */ }
    const ww = world({ keys: { [doorKeyUrl]: pub, [kurl]: pub } });
    let rr;
    try { rr = await handleAdmissionIntake(post({ record_canonical: text }), ww.deps); } catch (e) { rr = { status: "threw " + e.name, body: String(e) }; }
    const v = verifyAdmissionText(text, pub);
    const codes = (rr.body && (rr.body.refusals || [rr.body.error])) || [];
    let canon = false;
    try { canon = canonicalUtf8(parseStrict(text)) === text; } catch (_e) { /* unreadable */ }
    const stored = rr.status === 201 && ww.mem.size === 1, none = rr.status === 422 && ww.mem.size === 0;
    // the intake never accepts what the verifier refuses; on canonical bytes it accepts what the verifier accepts
    const agree = v.verdict === "refused" ? none : canon ? stored : none && codes.includes("not_canonical");
    const ok = agree && (code === null ? stored : codes.includes(code));
    t("the intake and the verifier agree: " + name + (code ? " (" + code + ")" : " (accepted)"), ok, { intake: rr.status, body: rr.body, verifier: v, canonical: canon });
  }
}

// ---- v0.3: the content block (fixtures/admission_content/cases.json, v0.2 records moved to v0.3 and signed by a scratch key) ----
{
  const CC = JSON.parse(readFileSync(path.join(HERE, "fixtures", "admission_content", "cases.json"), "utf8"));
  const keyUrl = JSON.parse(CC.records.A_clear_refused_by_immune).relying_party.key_url;
  const wc = world({ keys: { [keyUrl]: CC.relying_pub_b64 } });
  const good = Object.keys(CC.records).filter((k) => /^[A-Z]/.test(k));
  let okAll = true;
  for (const k of good) {
    const rr = await handleAdmissionIntake(post({ record_canonical: CC.records[k] }), wc.deps);
    okAll = okAll && rr.status === 201 && rr.body.report.admit_version === "0.3" && rr.body.report.checked.some((x) => /content block/.test(x));
  }
  t("v0.3: the " + good.length + " records with a content block (both flags, unchecked, no scope, an admit and a refusal) are accepted and stored", okAll && wc.mem.size === good.length);
  for (const k of Object.keys(CC.records).filter((k) => !/^[A-Z]/.test(k))) {
    await refusal("v0.3 broken: " + k, CC.records[k], "malformed", world({ keys: { [keyUrl]: CC.relying_pub_b64 } }));
    const v = verifyAdmissionText(CC.records[k], CC.relying_pub_b64);
    t("the verifier refuses it too: " + k, v.verdict === "refused" && v.refusals.includes("malformed"), v);
  }
  await refusal("a v0.3 record carrying v0.2's stated limits", edit(CC.records.A_clear_refused_by_immune, (o) => { o.does_not_establish.pop(); }), "does_not_establish_altered",
    world({ keys: { [keyUrl]: CC.relying_pub_b64 } }));
  t("the intake says it reads v0.3", admissionSelfDescription().versions.some((x) => x.startsWith("0.3")));
}

// ---- v0.4: the content block of FURUI A7.4 (records moved from the v0.3 fixture to v0.4 and signed here by a fresh key) ----
{
  const CC = JSON.parse(readFileSync(path.join(HERE, "fixtures", "admission_content", "cases.json"), "utf8"));
  const kp = generateKeyPairSync("ed25519");
  const pub = kp.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
  const base = JSON.parse(CC.records.A_clear_refused_by_immune), adm = JSON.parse(CC.records.B_clear_admitted);
  const keyUrl = base.relying_party.key_url;
  const R4 = ["within_grant", "conditional_needs_approval", "prohibited_action", "outside_grant", "amount_over_limit", "delegation_exceeds_parent",
    "contract_expired", "nonce_reused", "grant_revoked", "key_revoked", "presentation_unverifiable", "signer_not_on_own_domain", "action_digest_mismatch",
    "content_flagged", "content_unchecked", "exposure_full", "immune_hold", "immune_reject", "content_scope_conflict", "content_off_topic"];
  const H = (ch) => ch.repeat(64);
  const c4 = { rules: "a2a-content-check-v1", input_commit: H("1"), check_sha256: H("2"), rules_sha256: H("3"), scope_sha256: H("4"),
    decision: "pass", marks: [], unread: false, answered: true, checked: true };
  const un4 = { ...c4, input_commit: null, check_sha256: null, decision: null, answered: false, checked: false };
  const signRec = (o) => {
    const b = Object.fromEntries(Object.entries(o).filter(([k]) => k !== "signatures"));
    const sig = cryptoSign(null, Buffer.from("a2a-admission-v0\n" + musubiCanonical(b), "utf8"), kp.privateKey).toString("base64");
    return musubiCanonical({ ...b, signatures: [{ alg: "ed25519", domain: o.relying_party.domain, sig }] });
  };
  const v04 = (rec, content, extra) => signRec({ ...rec, rules: { ...rec.rules, version: "0.4" }, does_not_establish: [...LIMITS_BY_VERSION["0.4"]], content, ...(extra || {}) });
  const rw = (content, ...rs) => v04(base, content, { reasons: [...new Set([...base.reasons, ...rs])].sort((x, y) => R4.indexOf(x) - R4.indexOf(y)) });
  const wg = (...rs) => ({ reasons: ["within_grant", ...rs] });
  t("v0.4: the intake's stated limits for 0.4 are the verifier's, line for line", JSON.stringify(LIMITS_BY_VERSION["0.4"]) === JSON.stringify(DOES_NOT_ESTABLISH_V04));
  const cases = {
    pass_admitted: [v04(adm, c4), null],
    off_topic_admitted_mark_only: [v04(adm, { ...c4, marks: ["off_topic"] }, wg("content_off_topic")), null],
    stop_refused: [rw({ ...c4, decision: "stop" }, "content_flagged"), null],
    both_marks_refused: [rw({ ...c4, marks: ["off_topic", "rule_conflict"] }, "content_scope_conflict", "content_off_topic"), null],
    unread_pass_with_mark: [rw({ ...c4, unread: true, marks: ["off_topic"] }, "content_off_topic", "content_unchecked"), null],
    unanswered: [rw({ ...c4, decision: null, answered: false }, "content_unchecked"), null],
    unchecked: [rw(un4, "content_unchecked"), null],
    r1_unchecked_with_decision: [rw({ ...un4, decision: "pass", answered: true }, "content_unchecked"), "malformed"],
    r2_checked_without_commit: [v04(adm, { ...c4, input_commit: null }), "malformed"],
    r3_answered_without_decision: [v04(adm, { ...c4, decision: null }), "malformed"],
    r4_stop_without_reason: [v04(base, { ...c4, decision: "stop" }), "malformed"],
    r5_rule_conflict_without_reason: [v04(base, { ...c4, marks: ["rule_conflict"] }), "malformed"],
    r6_off_topic_without_reason: [v04(adm, { ...c4, marks: ["off_topic"] }), "malformed"],
    r7_unread_without_unchecked: [v04(base, { ...c4, unread: true }), "malformed"],
    r8_stop_with_mark: [rw({ ...c4, decision: "stop", marks: ["off_topic"] }, "content_flagged", "content_off_topic"), "malformed"],
    r9_admit_with_unchecked: [v04(adm, { ...c4, unread: true }, wg("content_unchecked")), "malformed"],
    mark_without_scope: [v04(adm, { ...c4, marks: ["off_topic"], scope_sha256: null }, wg("content_off_topic")), "malformed"],
    marks_out_of_order: [rw({ ...c4, marks: ["rule_conflict", "off_topic"] }, "content_scope_conflict", "content_off_topic"), "malformed"],
    old_field_input_sha256: [v04(base, Object.fromEntries([...Object.entries(c4).filter(([k]) => k !== "input_commit"), ["input_sha256", H("1")]])), "malformed"],
    v03_limits_in_v04: [v04(base, c4, { does_not_establish: [...LIMITS_BY_VERSION["0.3"]] }), "does_not_establish_altered"],
    version_not_known: [signRec({ ...JSON.parse(v04(base, c4)), rules: { ...base.rules, version: "0.5" } }), "malformed"],
  };
  const ws = world({ keys: { [keyUrl]: pub } });
  let agreeAll = true, n = 0;
  for (const [k, [text, code]] of Object.entries(cases)) {
    const w1 = world({ keys: { [keyUrl]: pub } });
    const rr = await handleAdmissionIntake(post({ record_canonical: text }), w1.deps);
    const v = verifyAdmissionText(text, pub);
    const ok = code === null ? rr.status === 201 && rr.body.report.admit_version === "0.4" && v.verdict === "accepted"
      : rr.status === 422 && rr.body.refusals.includes(code) && v.verdict === "refused" && v.refusals.includes(code);
    t("v0.4 " + k + (code ? " is refused (" + code + ") by the intake and the verifier" : " is accepted by the intake and the verifier"), ok, { intake: rr.status, body: rr.body, verifier: v });
    agreeAll = agreeAll && ok; n++;
  }
  const rr = await handleAdmissionIntake(post({ record_canonical: cases.off_topic_admitted_mark_only[0] }), ws.deps);
  t("v0.4: the report says the content block's nine rules were checked, and the record goes to the daily batch", rr.status === 201 && rr.body.report.checked.some((x) => /nine rules/.test(x)) && ws.queued.length === 1);
  t("the intake says it reads v0.4", admissionSelfDescription().versions.some((x) => x.startsWith("0.4")));
}

// ---- v0.5: the content block of more than one runner (checks[] and quorum). Records made here by the door's rule as far as a
// test needs it (each answer of fixtures/admission_v05/cases.json becomes one check), signed by a fresh key; the intake and the
// verifier must agree on every one of them, and on the three v0.4 records the ledger served on 2026-11-07 ----
{
  const V5 = JSON.parse(readFileSync(path.join(HERE, "fixtures", "admission_v05", "cases.json"), "utf8"));
  const CC = JSON.parse(readFileSync(path.join(HERE, "fixtures", "admission_content", "cases.json"), "utf8"));
  const kp = generateKeyPairSync("ed25519");
  const pub = kp.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
  const adm = JSON.parse(CC.records.B_clear_admitted);
  const keyUrl = adm.relying_party.key_url;
  const R5 = ["within_grant", "conditional_needs_approval", "prohibited_action", "outside_grant", "amount_over_limit", "delegation_exceeds_parent",
    "contract_expired", "nonce_reused", "grant_revoked", "key_revoked", "presentation_unverifiable", "signer_not_on_own_domain", "action_digest_mismatch",
    "content_flagged", "content_unchecked", "exposure_full", "immune_hold", "immune_reject", "content_scope_conflict", "content_off_topic"];
  const H = (ch) => ch.repeat(64), scope = H("4");
  const sha = (x) => createHash("sha256").update(x, "utf8").digest("hex");
  const WHY = { 1: "no_envelope", 2: "signature", 3: "rules_mismatch", 4: "scope_mismatch", 5: "commit_mismatch", 6: "shape", 7: "not_answered", 8: "decision_null", 22: "scope_mismatch" };
  const MK = { 16: ["off_topic"], 17: ["rule_conflict"], 18: ["off_topic", "rule_conflict"], 20: ["off_topic"], 21: ["rule_conflict"] };
  const checkOf = (i, rid) => {
    const read = i >= 9 && i !== 22, why = WHY[i] || ([19, 20, 21].includes(i) ? "unread" : "ok");
    return { runner_id: rid, key_id: rid, rules_sha256: rid === "runner-1" ? H("3") : H("5"), check_sha256: i === 1 ? null : sha(rid + " " + i),
      day: read ? "2026-11-09" : null, decision: read ? (i <= 14 ? "stop" : "pass") : null, marks: read ? (MK[i] || []) : [],
      unread: read ? why === "unread" : null, answered: why === "ok", scope_sha256: (!read || [4, 22, 23].includes(i)) ? null : scope, why };
  };
  const door = (answers, required) => {
    const checks = answers.map((i, j) => checkOf(i, "runner-" + (j + 1))), f = contentFromChecksV05(checks, required);
    let rs = new Set(f.reasons), dec;
    if (rs.has("content_flagged")) dec = "refuse";                                   // the paid policy: on_flagged refuse, the others escalate
    else if (rs.has("content_unchecked") || rs.has("content_scope_conflict")) dec = "escalate";
    else { dec = "admit"; rs = new Set(["within_grant", ...(rs.has("content_off_topic") ? ["content_off_topic"] : [])]); }
    const block = { rules: "a2a-content-check-v2", checked: f.checked, input_commit: H("1"), scope_sha256: scope, runners_sha256: H("6"),
      quorum: { required, answered: f.answered }, decision: f.decision, marks: f.marks, disagreement_kind: f.disagreement_kind, checks };
    return { block, reasons: R5.filter((r) => rs.has(r)), dec };
  };
  const signRec = (o) => {
    const b = Object.fromEntries(Object.entries(o).filter(([k]) => k !== "signatures"));
    const sig = cryptoSign(null, Buffer.from("a2a-admission-v0\n" + musubiCanonical(b), "utf8"), kp.privateKey).toString("base64");
    return musubiCanonical({ ...b, signatures: [{ alg: "ed25519", domain: o.relying_party.domain, sig }] });
  };
  const v05 = (block, reasons, decision, extra) => signRec({ ...adm, rules: { ...adm.rules, version: "0.5" }, does_not_establish: [...LIMITS_BY_VERSION["0.5"]],
    content: block, decision, reasons, ...(extra || {}) });
  t("v0.5: the intake's stated limits for 0.5 are the verifier's, line for line", JSON.stringify(LIMITS_BY_VERSION["0.5"]) === JSON.stringify(DOES_NOT_ESTABLISH_V05));
  const cases = {};
  for (const row of V5.quorum1) { const d = door([row.answer], 1); cases["q1_" + row.answer] = [v05(d.block, d.reasons, d.dec), null]; }
  let tableAgrees = true;
  for (const [r1, r2, wantRs, wantAns, wantDec, wantKind] of V5.quorum2) {
    const d = door([r1, r2], 2);
    tableAgrees = tableAgrees && JSON.stringify(d.reasons.filter((r) => r.startsWith("content_"))) === JSON.stringify(wantRs) && d.block.quorum.answered === wantAns
      && d.dec === wantDec && d.block.disagreement_kind === wantKind;
    cases["q2_" + r1 + "_" + r2] = [v05(d.block, d.reasons, d.dec), null];
  }
  t("v0.5: the door's rule here gives the fixture's reasons, runners answered, decision and disagreement_kind for all 529 pairs", tableAgrees);
  const g = door([15, 15], 2), gk = g.block.checks;
  const mut = (answers, i, kw) => { const d = door(answers, 2); const ks = d.block.checks.map((k) => ({ ...k })); Object.assign(ks[i], kw); return v05({ ...d.block, checks: ks }, d.reasons, d.dec); };
  Object.assign(cases, {
    not_ascending: [v05({ ...g.block, checks: [gk[1], gk[0]] }, g.reasons, g.dec), "malformed"],
    not_ok_but_answered: [mut([15, 1], 1, { answered: true }), "malformed"],
    unread_but_answered: [mut([15, 19], 1, { answered: true }), "malformed"],
    decision_not_the_rule: [v05({ ...g.block, decision: "stop" }, g.reasons, g.dec), "malformed"],
    kind_not_the_rule: [v05({ ...g.block, disagreement_kind: "marks" }, g.reasons, g.dec), "malformed"],
    answered_not_the_rule: [v05({ ...g.block, quorum: { required: 2, answered: 1 } }, g.reasons, g.dec), "malformed"],
    reason_extra: [v05(g.block, ["within_grant", "content_off_topic"], "admit"), "malformed"],
    admit_short_of_quorum: [v05(door([15, 1], 2).block, ["within_grant"], "admit"), "malformed"],
    stop_with_marks: [mut([9, 15], 0, { marks: ["off_topic"] }), "malformed"],
    not_read_keeps_decision: [mut([1, 15], 0, { decision: "pass" }), "malformed"],
    check_scope_other: [mut([15, 15], 1, { scope_sha256: H("7") }), "malformed"],
    check_extra_field: [mut([15, 15], 1, { leaf_index: 0 }), "malformed"],
    block_with_check_sha256: [v05({ ...g.block, check_sha256: H("2") }, g.reasons, g.dec), "malformed"],
    block_with_version: [v05({ ...g.block, version: "0.4" }, g.reasons, g.dec), "malformed"],
    same_key_twice_counted_once: [v05({ ...g.block, checks: [gk[0], { ...gk[1], key_id: "runner-1" }], quorum: { required: 2, answered: 1 }, decision: null, checked: false,
      disagreement_kind: "n/a" }, ["content_unchecked"], "escalate"), null],
    v04_limits_in_v05: [v05(g.block, g.reasons, g.dec, { does_not_establish: [...LIMITS_BY_VERSION["0.4"]] }), "does_not_establish_altered"],
  });
  let agree = 0, n = 0, bad = [];
  for (const [k, [text, code]] of Object.entries(cases)) {
    const w1 = world({ keys: { [keyUrl]: pub } });
    const rr = await handleAdmissionIntake(post({ record_canonical: text }), w1.deps);
    const v = verifyAdmissionText(text, pub);
    const ok = code === null ? rr.status === 201 && rr.body.report.admit_version === "0.5" && v.verdict === "accepted"
      : rr.status === 422 && rr.body.refusals.includes(code) && v.verdict === "refused" && v.refusals.includes(code);
    agree += ok; n++;
    if (!ok) bad.push([k, rr.status, rr.body.refusals, v]);
  }
  t("v0.5: the intake and the verifier agree on all " + n + " records (" + Object.values(cases).filter((x) => x[1] === null).length + " accepted, "
    + Object.values(cases).filter((x) => x[1] !== null).length + " refused)", agree === n, bad.slice(0, 3));
  const w2 = world({ keys: { [keyUrl]: pub } });
  const rr = await handleAdmissionIntake(post({ record_canonical: cases.q2_16_15[0] }), w2.deps);
  t("v0.5: the report says the block and the reasons were held to its checks, and the record goes to the daily batch",
    rr.status === 201 && rr.body.report.checked.some((x) => /what its checks and quorum.required give/.test(x)) && w2.queued.length === 1, rr.body);
  t("the intake says it reads v0.5", admissionSelfDescription().versions.some((x) => x.startsWith("0.5")));
  const L4 = V5.live_v04, keyUrl4 = "https://shield.the-horizons-innovation.com/keys/seki-door.json";
  let live = 0;
  for (const text of Object.values(L4.records)) {
    const w3 = world({ keys: { [keyUrl4]: L4.relying_pub_b64 } });
    const r4 = await handleAdmissionIntake(post({ record_canonical: text }), w3.deps);
    live += r4.status === 201 && r4.body.report.admit_version === "0.4" && verifyAdmissionText(text, L4.relying_pub_b64).verdict === "accepted";
  }
  t("v0.4 as before: the three records the ledger served on 2026-11-07 are accepted by this intake and the verifier", live === 3);
}

console.log("");
if (fail) { console.log("FAIL " + fail + " of " + (pass + fail) + " (admission_intake)"); process.exit(1); }
console.log("PASS " + pass + "/" + pass + " (admission_intake: records made by the Python reference; stored only when signed, on the signer's own domain, and public by the signer's consent)");
