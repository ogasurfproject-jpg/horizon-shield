// selection_verify.test.mjs -- offline tests for the Choice Layer verifier.
// Run: node --test selection_verify.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const VERIFIER = join(here, "selection_verify.mjs");
const CONDUCT = join(here, "selection.conduct.json");
const CONSTRUCTION = join(here, "selection.construction.json");

function runOffline(path) {
  return spawnSync(process.execPath, [VERIFIER, path], { encoding: "utf8" });
}
function tmp(obj) {
  const d = mkdtempSync(join(tmpdir(), "sel-"));
  const p = join(d, "m.json");
  writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}
function baseValid() {
  return JSON.parse(readFileSync(CONDUCT, "utf8"));
}

test("real conduct manifest passes offline", () => {
  const r = runOffline(CONDUCT);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("real construction manifest passes offline", () => {
  const r = runOffline(CONSTRUCTION);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("empty out_of_scope is rejected", () => {
  const m = baseValid(); m.out_of_scope = [];
  const r = runOffline(tmp(m));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /out_of_scope/);
});

test("wrong principle is rejected", () => {
  const m = baseValid(); m.principle = "choose us, we are the best";
  const r = runOffline(tmp(m));
  assert.equal(r.status, 1);
});

test("ranking or superlative language is rejected", () => {
  const m = baseValid(); m.axes[0].our_claim = "We are the best and unbeatable option.";
  const r = runOffline(tmp(m));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /ranking or superlative/);
});

test("axis without a verify url is rejected", () => {
  const m = baseValid(); delete m.axes[0].verify.url;
  const r = runOffline(tmp(m));
  assert.equal(r.status, 1);
});

test("axis without measure_any_provider is rejected", () => {
  const m = baseValid(); delete m.axes[1].measure_any_provider;
  const r = runOffline(tmp(m));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /measure_any_provider/);
});

test("non-https verify url is rejected", () => {
  const m = baseValid(); m.axes[0].verify.url = "http://gate.horizonshield.dev/history";
  const r = runOffline(tmp(m));
  assert.equal(r.status, 1);
});
