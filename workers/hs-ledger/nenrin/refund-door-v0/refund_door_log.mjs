// refund_door_log.mjs: the door's own record of every /admit request that carried the sandbox key, and of the answer it
// gave (aeoess/agent-governance-vocabulary#193, 2026-10-27: "we retain the exact request bytes the runner sent, the
// request sequence for the replay and reissue cases, and every signed response").
//
// What is written, in the Durable Object's SQL storage (RefundDoorDO, beside the single-use table "consumed"):
//   - a "request" record before the door decides: the run, the door clock, the sha256 and length of the request body.
//     The body bytes go in parts of at most 1 MiB, since a row holds at most 2 MB;
//   - an "answer" record after it decides: the HTTP status, the sha256 and length of the answer body and its bytes, and
//     the mapping verdict (disposition, step, code, the two record hashes). When the door commits, the "consumed" row and
//     the answer record are written in one transaction: there is no consumption without its record.
//   - for a request without the right sandbox key (401, 403, or 503 before a key is set): a count per UTC day, status and
//     reason, never the body, so nobody without the key can fill the door's storage.
//
// Every record names the record before it in the same run (prev_record_sha256; the first names 64 zeros), and
// record_sha256 is the sha256 of the musubi-canonical-v0 bytes of the record without record_sha256. The last
// record_sha256 of a run is its head. A reader who kept a head notices a record removed or changed before it.
//
// Reading: the list of runs and each run's records are public (no bytes). The bytes are behind a separate read key
// (REFUND_LOG_KEY_SHA256), not the sandbox key: the inputs belong to the runner and its parties, and the sandbox key
// may be handed to the runner.
//
// Limits (2026-11-19). The parts kept by all records together stay under LOG_CAP_BYTES (256 MiB): a keyed request that would
// go past it is refused before the door decides (507 log_full, nothing consumed) and only counted, like a 401. Each
// answer may add up to ANSWER_RESERVE beyond the request, so the cap can be passed by at most that. The readers return at
// most PAGE_MAX lines or runs at a time, with a cursor to the next page.
//
// Replays are not recorded: /replay never touches the live state, and that stays so.
import { createHash } from "node:crypto";
import { canonical } from "../musubi-v0/canonical_v0.mjs";

export const LOG_SCHEMA = "hs-refund-door-log-v0";
export const PART = 1 << 20;
export const ZERO = "0".repeat(64);
export const LOG_CAP_BYTES = 256 << 20;
export const ANSWER_RESERVE = 1 << 20;
export const PAGE_MAX = 1000;
export const DENIED_DAYS = 31;
const RUN_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const sha256hex = (b) => createHash("sha256").update(b).digest("hex");
const enc = new TextEncoder();

export const LOG_DOES_NOT_ESTABLISH = [
  "that the record is complete beyond what a head kept by someone else covers: the door's operator keeps this storage and could rewrite a run together with its head",
  "the bytes of a body over 16 MiB, or of one not read (the door unavailable, content-length over 16 MiB): sha256 and length where read",
  "an answer when the door stopped between the request record and the answer record: the request record stays without an answer",
  "the 503 log_unavailable answers themselves: they are given when a record cannot be written, so they are not in the record",
  "requests without the right sandbox key beyond a count per day, status and reason",
  "requests refused as log_full (the kept parts at their cap) beyond a count per day",
];

// The run a request belongs to: its run_id when the body is a JSON object with a run_id the door accepts, else null.
export function runOf(text) {
  try {
    const b = JSON.parse(text);
    if (b && typeof b === "object" && !Array.isArray(b) && typeof b.run_id === "string" && RUN_ID.test(b.run_id)) return b.run_id;
  } catch { /* not JSON: no run */ }
  return null;
}

export const recordSha = (rec) => sha256hex(enc.encode(canonical(rec)));

// The tables. CREATE ... IF NOT EXISTS, beside "consumed"; nothing of "consumed" changes.
export function createTables(sql) {
  sql.exec("CREATE TABLE IF NOT EXISTS log_record (seq INTEGER PRIMARY KEY, run_key TEXT NOT NULL, kind TEXT NOT NULL, rec TEXT NOT NULL, record_sha256 TEXT NOT NULL)");
  sql.exec("CREATE TABLE IF NOT EXISTS log_part (seq INTEGER NOT NULL, i INTEGER NOT NULL, part BLOB NOT NULL, PRIMARY KEY (seq, i))");
  sql.exec("CREATE TABLE IF NOT EXISTS log_head (run_key TEXT PRIMARY KEY, head TEXT NOT NULL, records INTEGER NOT NULL, first_at TEXT NOT NULL, last_at TEXT NOT NULL)");
  sql.exec("CREATE TABLE IF NOT EXISTS log_denied (day TEXT NOT NULL, status INTEGER NOT NULL, why TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, status, why))");
}

// run_key "" is the requests without a run (stored so, shown as run_id null).
const keyOf = (run) => (run === null ? "" : run);

function nextSeq(sql) {
  const r = sql.exec("SELECT MAX(seq) AS m FROM log_record").toArray();
  return (r.length && r[0].m !== null ? Number(r[0].m) : 0) + 1;
}

// The ArrayBuffer of a part, the BLOB form the Durable Object's SQL binds.
const blob = (u8, a, b) => u8.buffer.slice(u8.byteOffset + a, u8.byteOffset + b);

// One record and its parts, and the run's head moved to it. Synchronous: the caller runs it inside transactionSync.
function append(sql, run, kind, fields, bytes, at) {
  const seq = nextSeq(sql);
  const rk = keyOf(run);
  const h = sql.exec("SELECT head, records, first_at FROM log_head WHERE run_key = ?", rk).toArray();
  const prev = h.length ? h[0].head : ZERO;
  const parts = bytes ? Math.ceil(bytes.length / PART) : 0;
  const rec = { schema: LOG_SCHEMA, seq, run_id: run, kind, at, ...fields, parts, prev_record_sha256: prev };
  const rs = recordSha(rec);
  sql.exec("INSERT INTO log_record (seq, run_key, kind, rec, record_sha256) VALUES (?, ?, ?, ?, ?)", seq, rk, kind, canonical(rec), rs);
  for (let i = 0; i < parts; i++) sql.exec("INSERT INTO log_part (seq, i, part) VALUES (?, ?, ?)", seq, i, blob(bytes, i * PART, Math.min(bytes.length, (i + 1) * PART)));
  if (h.length) sql.exec("UPDATE log_head SET head = ?, records = ?, last_at = ? WHERE run_key = ?", rs, Number(h[0].records) + 1, at, rk);
  else sql.exec("INSERT INTO log_head (run_key, head, records, first_at, last_at) VALUES (?, ?, ?, ?, ?)", rk, rs, 1, at, at);
  return { ...rec, record_sha256: rs };
}

// The request record. bytes: the body as received (Uint8Array), or null when it was not read or not kept.
// sha256 and length are of the body when it was read; declared_length is content-length when the body was not read.
export function writeRequest(storage, { run, at, received_at, bytes, sha256, length, declared_length, note }) {
  return storage.transactionSync(() => append(storage.sql, run, "request",
    { received_at, sha256, length, declared_length: declared_length ?? null, body_kept: !!bytes, note: note || null }, bytes, at));
}

// The answer record, and the single-use row when the door committed, in one transaction.
// consume: null, or {scope, row} exactly as the door's state.put received them.
export function writeAnswer(storage, { run, at, request_seq, status, text, verdict, consume }) {
  const bytes = enc.encode(text);
  return storage.transactionSync(() => {
    if (consume) storage.sql.exec("INSERT INTO consumed (scope, row) VALUES (?, ?)", consume.scope, JSON.stringify(consume.row));
    return append(storage.sql, run, "answer", { request_seq, status, sha256: sha256hex(bytes), length: bytes.length, ...verdict }, bytes, at);
  });
}

// What the public record says about an answer: the mapping verdict, read from the answer object (null fields when the
// answer is an error).
export function verdictOf(o) {
  const s = (v) => (typeof v === "string" ? v : null);
  return {
    disposition: s(o && o.disposition), step: o && Number.isInteger(o.step) ? o.step : null, code: s(o && o.code), error: s(o && o.error),
    repeated: !!(o && o.repeated), mapping_sha256: s(o && o.mapping_sha256), admission_sha256: s(o && o.admission_sha256),
  };
}

// The bytes the parts of all records keep, and whether a request of `need` more bytes (and its answer) still fits.
export function usedBytes(sql) {
  const r = sql.exec("SELECT COALESCE(SUM(LENGTH(part)), 0) AS n FROM log_part").toArray();
  return Number(r[0].n);
}
export const fits = (used, need, cap = LOG_CAP_BYTES) => used + need + ANSWER_RESERVE <= cap;

export function countDenied(sql, day, status, why) {
  sql.exec("INSERT INTO log_denied (day, status, why, n) VALUES (?, ?, ?, 1) ON CONFLICT (day, status, why) DO UPDATE SET n = n + 1", day, status, why);
}

// ---------------------------------------------------------------- reading

// One page of runs in run_id order ("" first: the requests without a run), after the cursor `after` (a run_key; null:
// from the start), at most `limit`. Then the refusals counted: totals per status and reason, and per day for the last
// DENIED_DAYS days.
export function listRuns(sql, { after = null, limit = PAGE_MAX, today } = {}) {
  const lim = Math.max(1, Math.min(PAGE_MAX, limit | 0));
  const rows = (after === null
    ? sql.exec("SELECT run_key, head, records, first_at, last_at FROM log_head ORDER BY run_key LIMIT ?", lim + 1)
    : sql.exec("SELECT run_key, head, records, first_at, last_at FROM log_head WHERE run_key > ? ORDER BY run_key LIMIT ?", after, lim + 1)).toArray();
  const more = rows.length > lim;
  const runs = rows.slice(0, lim).map((r) => ({ run_id: r.run_key === "" ? null : r.run_key, records: Number(r.records), head: r.head, first_at: r.first_at, last_at: r.last_at }));
  const since = new Date(Date.parse((today || new Date().toISOString().slice(0, 10)) + "T00:00:00Z") - (DENIED_DAYS - 1) * 86400000).toISOString().slice(0, 10);
  const denied_total = sql.exec("SELECT status, why, SUM(n) AS n FROM log_denied GROUP BY status, why ORDER BY status, why").toArray()
    .map((r) => ({ status: Number(r.status), why: r.why, n: Number(r.n) }));
  const denied = sql.exec("SELECT day, status, why, n FROM log_denied WHERE day >= ? ORDER BY day, status, why", since).toArray()
    .map((r) => ({ day: r.day, status: Number(r.status), why: r.why, n: Number(r.n) }));
  return { runs, next_after: more ? rows[lim - 1].run_key : null, denied_total, denied, denied_since: since };
}

// One page of a run's records in order, after record `after` (a seq; 0 from the start), at most `limit` lines; each line
// the canonical text of the record with its record_sha256. next: the seq to pass as `after` for the next page, or null.
export function runLines(sql, run, { after = 0, limit = PAGE_MAX } = {}) {
  const lim = Math.max(1, Math.min(PAGE_MAX, limit | 0));
  const rows = sql.exec("SELECT seq, rec, record_sha256 FROM log_record WHERE run_key = ? AND seq > ? ORDER BY seq LIMIT ?", keyOf(run), after, lim + 1).toArray();
  const more = rows.length > lim;
  const page = rows.slice(0, lim);
  return { lines: page.map((r) => canonical({ ...JSON.parse(r.rec), record_sha256: r.record_sha256 })), next: more ? Number(page[page.length - 1].seq) : null };
}

// The run's head and record count, as log_head keeps them (null when the run has no record).
export function runHead(sql, run) {
  const h = sql.exec("SELECT head, records FROM log_head WHERE run_key = ?", keyOf(run)).toArray();
  return h.length ? { head: h[0].head, records: Number(h[0].records) } : null;
}

// The bytes of one record (its parts joined), or null when the record has none.
export function recordBytes(sql, seq) {
  const rec = sql.exec("SELECT rec FROM log_record WHERE seq = ?", seq).toArray();
  if (!rec.length) return null;
  const r = JSON.parse(rec[0].rec);
  const parts = sql.exec("SELECT i, part FROM log_part WHERE seq = ? ORDER BY i", seq).toArray();
  if (parts.length !== r.parts) return { rec: r, bytes: null };
  const bufs = parts.map((p) => new Uint8Array(p.part));
  const out = new Uint8Array(bufs.reduce((a, b) => a + b.length, 0));
  let o = 0;
  for (const b of bufs) { out.set(b, o); o += b.length; }
  return { rec: r, bytes: out };
}

// A reader's check of one run's lines: each record hashes to its record_sha256 and names the one before it.
// Returns the head, or throws with the first line that does not hold.
// To check a run read in pages, pass each page with the record_sha256 of the last line of the page before (prev).
export function checkRun(lines, prev = ZERO) {
  lines.forEach((line, i) => {
    const r = JSON.parse(line);
    const { record_sha256: rs, ...rest } = r;
    if (canonical(r) !== line) throw new Error("line " + (i + 1) + ": not canonical text");
    if (recordSha(rest) !== rs) throw new Error("line " + (i + 1) + ": record_sha256 is not the sha256 of the record");
    if (rest.prev_record_sha256 !== prev) throw new Error("line " + (i + 1) + ": prev_record_sha256 is not the record before");
    prev = rs;
  });
  return prev;
}
