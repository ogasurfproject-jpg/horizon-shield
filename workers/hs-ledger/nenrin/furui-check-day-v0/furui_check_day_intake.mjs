// furui_check_day_intake.mjs: the intake for furui-check-day-v0 at ledger.horizonshield.dev (POST /furui-check-day).
// A content check runner signs, once a day, the root of the day's signed check envelopes (RFC 6962 tree, leaves
// sha256(0x00 || musubi-canonical-v0 bytes of each envelope)). This intake checks the shape, that the key is the runner's
// as the ledger serves it at /.well-known/furui-check-keys.json, and the signature; it stores the record under its sha256
// and queues it for the ledger's daily batch at 00:30 UTC (the public pool, the same as /agreement and /admission).
// One record per runner per day. It never sees an envelope, a content or a check: only the root and the counts.
// A second record for a day whose first record has the same root (a runner sending its day again) is answered 200 with the
// first record's sha and is not stored: the day holds one record and the root it commits to is the same (0.2.0).
import { parseStrict, canonicalUtf8, CanonicalError } from "../agreement-v0/agreement_canonical.mjs";
import { ed25519Verify } from "../agreement-v0/agreement_verify.mjs";

export const FURUI_DAY_INTAKE_VERSION = "furui-check-day-intake 0.2.0";
export const FURUI_DAY_SCHEMA = "furui-check-day-v0";
export const KEYS_PATH = "/.well-known/furui-check-keys.json";
export const MAX_BYTES = 8192;
const TREE = "rfc6962-sha256";
const LEAF = "sha256(0x00 || musubi-canonical-v0(envelope))";
const KEYS = ["clock_skew", "day", "first_height", "last_height", "late", "leaf", "n", "publication", "root", "schema", "signatures", "signer", "tree"].sort();
const H64 = /^[0-9a-f]{64}$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const enc = new TextEncoder();
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const res = (status, b, headers) => ({ status, body: b, headers: headers || {} });
const intOk = (v, min) => (typeof v === "bigint" ? v >= BigInt(min) && v <= 9007199254740991n : Number.isSafeInteger(v) && v >= min);
const num = (v) => (typeof v === "bigint" ? Number(v) : v);
async function sha256Hex(bytes) {
  const d = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function hostOf(url) {
  const m = typeof url === "string" ? /^https:\/\/([A-Za-z0-9.-]+)(?::[0-9]+)?\//.exec(url) : null;
  return m ? m[1].toLowerCase() : null;
}
function realDay(s) {
  const m = DAY.exec(s || ""); if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
const refused = (codes, extra) => res(422, Object.assign({ status: "refused", refusals: codes, note: "not accepted, so not stored, not anchored, not served by sha" }, extra || {}));

// [] when the record has the closed shape; otherwise the codes.
export function shapeProblems(r) {
  if (!isObj(r) || r.schema !== FURUI_DAY_SCHEMA) return ["malformed"];
  const ks = Object.keys(r).sort();
  if (JSON.stringify(ks) !== JSON.stringify(KEYS)) return ["malformed"];
  const s = r.signer;
  const ok = realDay(r.day) && isObj(s) && JSON.stringify(Object.keys(s).sort()) === '["domain","key_url"]' && typeof s.domain === "string" && s.domain.length > 0
    && intOk(r.n, 1) && r.tree === TREE && r.leaf === LEAF && typeof r.root === "string" && H64.test(r.root)
    && intOk(r.first_height, 0) && intOk(r.last_height, 0) && num(r.first_height) <= num(r.last_height)
    && intOk(r.late, 0) && intOk(r.clock_skew, 0) && Array.isArray(r.signatures) && r.signatures.length === 1;
  if (!ok) return ["malformed"];
  const sg = r.signatures[0];
  if (!(isObj(sg) && JSON.stringify(Object.keys(sg).sort()) === '["alg","domain","key_id","sig"]' && sg.alg === "ed25519" && sg.domain === s.domain && typeof sg.key_id === "string" && typeof sg.sig === "string")) return ["malformed"];
  const h = hostOf(s.key_url), d = s.domain.toLowerCase();
  if (!h || !(h === d || h.endsWith("." + d))) return ["signer_not_on_own_domain"];
  return [];
}

// The key the record names, if the keys document lists it for this use and the record's heights fall inside its life.
export function keyFor(keysDoc, r) {
  const sg = r.signatures[0];
  const list = isObj(keysDoc) && keysDoc.use === "furui-check" && Array.isArray(keysDoc.keys) ? keysDoc.keys : [];
  const k = list.find((x) => isObj(x) && x.key_id === sg.key_id);
  if (!k) return { why: "key_not_listed" };
  if (typeof k.from_height === "number" && num(r.first_height) < k.from_height) return { why: "key_not_yet_valid" };
  if (typeof k.revoked_height === "number" && num(r.last_height) >= k.revoked_height) return { why: "key_revoked" };
  return { key: k.public_key_ed25519_b64 };
}

// POST /furui-check-day {"record_canonical": "<musubi-canonical-v0 bytes of a signed furui-check-day-v0>"}
export async function handleFuruiDayIntake(request, deps) {
  const { keysDoc, ledgerKeyUrl, store, now = () => new Date().toISOString(), origin = "https://ledger.horizonshield.dev" } = deps || {};
  let b;
  try { b = await request.json(); } catch { return res(400, { error: "bad_json" }); }
  if (!isObj(b) || typeof b.record_canonical !== "string") return res(400, { error: "record_canonical (string) required" });
  if (enc.encode(b.record_canonical).length > MAX_BYTES) return res(413, { error: "too_large", max_bytes: MAX_BYTES });
  let r;
  try { r = parseStrict(b.record_canonical); } catch (e) { return res(422, { error: "unparseable_record", reason_code: e instanceof CanonicalError ? e.code : "bad_json" }); }
  let again; try { again = canonicalUtf8(r); } catch { again = null; }
  if (again !== b.record_canonical) return res(422, { error: "not_canonical", note: "record_canonical must be the musubi-canonical-v0 bytes of the record" });
  const sp = shapeProblems(r);
  if (sp.length) return refused(sp);
  if (r.publication !== "public") return refused(["publication_not_public"]);
  if (r.signer.key_url !== ledgerKeyUrl) return refused(["key_url_not_the_ledgers"], { why: "the runner's keys are served by this ledger at " + ledgerKeyUrl });
  const kf = keyFor(keysDoc, r);
  if (!kf.key) return refused([kf.why]);
  const msg = enc.encode(FURUI_DAY_SCHEMA + "\n" + canonicalUtf8(Object.fromEntries(Object.entries(r).filter(([k]) => k !== "signatures"))));
  if ((await ed25519Verify(kf.key, r.signatures[0].sig, msg)) !== true) return refused(["bad_signature"]);
  const canonicalSha = await sha256Hex(enc.encode(b.record_canonical));
  const dayMark = await sha256Hex(enc.encode("furui-check-day mark\n" + r.signer.domain.toLowerCase() + "\n" + r.day));
  const mark = await store.claimAccepted(dayMark, { canonical_sha256: dayMark, report: { record_schema: "furui-check-day-v0 mark" }, day_of: canonicalSha });
  if (mark && mark.unbound) return res(503, { error: "dedupe_gate_unbound", note: "fail closed" });
  if (mark && mark.duplicate) {
    const first = mark.stored && mark.stored.day_of;
    if (first !== canonicalSha) {
      let prior = null, priorRoot = null;
      try { prior = typeof first === "string" && store.getAccepted ? await store.getAccepted(first) : null; priorRoot = prior && typeof prior.record_canonical === "string" ? parseStrict(prior.record_canonical).root : null; } catch (_e) { priorRoot = null; }
      if (priorRoot === r.root) return res(200, { status: (prior && prior.status) || "pending_anchor", dedup: true, same_root: true, verdict: "accepted", canonical_sha256: first,
        url: origin + "/furui-check-day/" + first, note: "this day already holds a record with the same root; the first record stands and these bytes are not stored" });
      return refused(["day_already_recorded"], { why: "one record per runner per day; this day already has " + first, first_canonical_sha256: first });
    }
  }
  const nowVal = typeof now === "function" ? now() : now;
  const report = { record_schema: FURUI_DAY_SCHEMA, verdict: "accepted", canonical_sha256: canonicalSha, signer: r.signer.domain, day: r.day, n: num(r.n),
    verifier_version: FURUI_DAY_INTAKE_VERSION, checked: ["canonical bytes", "the closed shape", "the key the ledger serves for furui-check, inside its heights", "Ed25519 signature", "one record per runner per day"],
    not_checked: ["any envelope, content or check behind the root; only the runner holds the leaves"] };
  const payload = { canonical_sha256: canonicalSha, record_canonical: b.record_canonical, report, verifier_version: FURUI_DAY_INTAKE_VERSION, submitted_at: nowVal, status: "pending_anchor" };
  const claim = await store.claimAccepted(canonicalSha, payload);
  if (claim && claim.unbound) return res(503, { error: "dedupe_gate_unbound", note: "fail closed" });
  const url = origin + "/furui-check-day/" + canonicalSha;
  if (claim && claim.duplicate) return res(200, { status: (claim.stored && claim.stored.status) || "pending_anchor", dedup: true, verdict: "accepted", canonical_sha256: canonicalSha, url });
  if (store.queueForAnchor) { try { await store.queueForAnchor(canonicalSha, payload); } catch (_e) { /* served, not queued */ } }
  return res(201, { status: "pending_anchor", verdict: "accepted", canonical_sha256: canonicalSha, url, report,
    anchor_policy: "recorded and served by sha now, and queued for the daily batch that anchors the public pool to Bitcoin at 00:30 UTC" });
}

// GET /furui-check-day/{sha}: the exact stored bytes.
export async function handleFuruiDayGet(sha, deps) {
  const { store, origin = "https://ledger.horizonshield.dev" } = deps || {};
  const s = String(sha || "").toLowerCase();
  if (!H64.test(s)) return res(400, { error: "bad_sha" });
  const stored = await store.getAccepted(s);
  if (!stored || !stored.report || stored.report.record_schema !== FURUI_DAY_SCHEMA) return res(404, { error: "not_found", canonical_sha256: s });
  let status = stored.status || "pending_anchor", ledgerEntry = null;
  if (store.anchorState) { const a = await store.anchorState(s); if (a && a.anchored) { status = "anchored"; ledgerEntry = a.ledger_entry; } }
  return res(200, { canonical_sha256: s, record_canonical: stored.record_canonical, report: stored.report, status, ledger_entry: ledgerEntry,
    ledger_url: ledgerEntry ? origin + "/ledger/" + ledgerEntry : null, submitted_at: stored.submitted_at });
}

export function furuiDaySelfDescription(origin) {
  const o = origin || "https://ledger.horizonshield.dev";
  return { intake: FURUI_DAY_INTAKE_VERSION, schema: FURUI_DAY_SCHEMA, post: o + "/furui-check-day  {\"record_canonical\"}", serve_by_sha: o + "/furui-check-day/{canonical_sha256}",
    keys: o + KEYS_PATH, max_bytes: MAX_BYTES, tree: TREE, leaf: LEAF,
    what_this_does: "stores a content check runner's signed daily root under its sha256 and anchors it with the ledger's daily batch at 00:30 UTC; one record per runner per day",
    what_this_does_not_do: ["hold or read any envelope, content or check", "say whether any check was right"],
    empty_days: "a runner writes no record for a day without checks; its own status endpoint says so",
    same_day_again: "the same bytes again, or another record for the day with the same root, is answered 200 with the first record's sha and not stored; another root for the day is refused (day_already_recorded)",
    caps: "50 a day in all and 10 a day per network on this public POST; the runner of this ledger's operator sends through a service binding entrypoint (FuruiDayIntake), which runs the same checks and is not counted in these caps" };
}
