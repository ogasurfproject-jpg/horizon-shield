import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, VOLATILE } from "./external_attestation_watch.mjs";

const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const ABOUT = "Agenstry's published observation of gate.horizonshield.dev (agent card, JWS, A2A liveness)";
const FIELDS = ["version", "signed", "signature_valid", "stats.last_checked", "stats.checks_ok", "stats.checks_total", "stats.uptime_pct"];
const URL = "https://agenstry.com/api/agents/gate.horizonshield.dev";
const base = { version: "0.4.7", signed: true, signature_valid: null, stats: { last_checked: "2026-09-19T23:01:24.136901", checks_ok: 43, checks_total: 43, uptime_pct: 100 } };
const run = (obj, prevState, fetchedAt = "2026-09-20T00:00:00.000Z") =>
  evaluate({ url: URL, about: ABOUT, bytes: enc(obj), fetchedAt, fields: FIELDS, prevState, refersTo: "6d259ba9bfe2869f", refersEntry: 50 });

test("first sight is a change and produces a seed", async () => {
  const r = await run(base, {});
  assert.equal(r.firstSight, true);
  assert.equal(r.changed, true);
  assert.ok(r.seed && /^[0-9a-f]{64}$/.test(r.seed.claim_sha256));
});

test("identical substance with only last_checked moved is NOT a change", async () => {
  const first = await run(base, {});
  const moved = { ...base, stats: { ...base.stats, last_checked: "2026-09-20T23:00:00.000000" } };
  const r = await run(moved, first.nextState);
  assert.equal(r.changed, false);
  assert.equal(r.seed, null);
});

test("a dropped check or uptime is a change with a diff and a seed", async () => {
  const first = await run(base, {});
  const worse = { ...base, stats: { ...base.stats, last_checked: "2026-09-20T23:00:00", checks_ok: 40, uptime_pct: 92 } };
  const r = await run(worse, first.nextState);
  assert.equal(r.changed, true);
  assert.deepEqual(r.diff.map((d) => d.field).sort(), ["stats.checks_ok", "stats.uptime_pct"]);
  assert.ok(r.seed);
});

test("signature_valid flipping null to true is a change", async () => {
  const first = await run(base, {});
  const signed = { ...base, signature_valid: true, stats: { ...base.stats, last_checked: "later" } };
  const r = await run(signed, first.nextState);
  assert.equal(r.changed, true);
  assert.deepEqual(r.diff, [{ field: "signature_valid", from: null, to: true }]);
});

test("same bytes give a stable claim_sha256", async () => {
  const a = await run(base, {});
  const b = await run(base, {});
  assert.equal(a.seed.claim_sha256, b.seed.claim_sha256);
});

test("VOLATILE excludes last_checked but keeps checks_ok and uptime_pct", () => {
  assert.equal(VOLATILE.test("stats.last_checked"), true);
  assert.equal(VOLATILE.test("stats.checks_ok"), false);
  assert.equal(VOLATILE.test("stats.checks_total"), false);
  assert.equal(VOLATILE.test("stats.uptime_pct"), false);
  assert.equal(VOLATILE.test("version"), false);
});
