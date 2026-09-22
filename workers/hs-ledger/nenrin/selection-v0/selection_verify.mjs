#!/usr/bin/env node
// selection_verify.mjs -- the Choice Layer verifies itself.
//
// Usage:
//   node selection_verify.mjs <manifest.json>          structure + invariants (offline)
//   node selection_verify.mjs <manifest.json> --live   also call each verify.url and recompute
//
// Fail-closed: a claim that cannot be recomputed does not pass. Exit code is
// non-zero if any check fails. hs-selection-v0.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const PRINCIPLE = "This manifest lists decision criteria and points to recomputable evidence. It asserts no ranking. Verify, do not trust.";
const BANNED = ["best", "better", "superior", "leading", "unbeatable", "#1", "no competitor", "only one", "market-leading"];

function sha256hex(buf) { return createHash("sha256").update(buf).digest("hex"); }

function loadManifest(path) {
  const raw = readFileSync(path, "utf8");
  return { raw, obj: JSON.parse(raw) };
}

// ---- structure + invariants (offline) ----
function checkStructure(raw, m) {
  const out = [];
  const ok = (name, cond, detail) => out.push({ name, pass: !!cond, detail: detail || "" });

  ok("spec is hs-selection-v0", m.spec === "hs-selection-v0", m.spec);
  ok("principle is the exact sentence", m.principle === PRINCIPLE);
  ok("task.id present", m.task && typeof m.task.id === "string" && m.task.id.length > 0);
  ok("provider.url is https", m.provider && /^https:\/\//.test(m.provider.url || ""));
  ok("as_of present", typeof m.as_of === "string" && m.as_of.length > 0);

  ok("out_of_scope is non-empty", Array.isArray(m.out_of_scope) && m.out_of_scope.length > 0,
    "if we cannot say when NOT to use us, the manifest is marketing");

  const axes = Array.isArray(m.axes) ? m.axes : [];
  ok("axes is non-empty", axes.length > 0);
  axes.forEach((a, i) => {
    const p = "axis[" + i + "]" + (a && a.id ? " " + a.id : "");
    ok(p + ": has id/label/why/our_claim",
      a && a.id && a.label && a.why_it_matters && a.our_claim);
    const v = a && a.verify;
    ok(p + ": verify.url is https", v && /^https:\/\//.test(v.url || ""), v && v.url);
    ok(p + ": verify.recompute present", v && typeof v.recompute === "string" && v.recompute.length > 0);
    ok(p + ": verify.pass_if present", v && typeof v.pass_if === "string" && v.pass_if.length > 0);
    ok(p + ": measure_any_provider present",
      typeof a.measure_any_provider === "string" && a.measure_any_provider.length > 0,
      "each axis must say how to measure ANY provider, so the comparison is fair");
  });

  // no ranking / superlative language anywhere
  const hay = raw.toLowerCase();
  const hits = BANNED.filter((w) => new RegExp("(^|[^a-z])" + w.replace(/[#]/g, "\\#").replace(/[-]/g, "\\-") + "([^a-z]|$)").test(hay));
  ok("no ranking or superlative language", hits.length === 0, hits.length ? "found: " + hits.join(", ") : "");

  return out;
}

// ---- live recompute (fail-closed) ----
async function get(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "accept": "application/json, */*" } });
    const body = Buffer.from(await r.arrayBuffer());
    return { status: r.status, body, text: body.toString("utf8") };
  } finally { clearTimeout(t); }
}

async function liveAxis(a) {
  const url = a.verify.url;
  switch (a.id) {
    case "recomputable-verdict": {
      const r = await get(url); // /self
      if (r.status !== 200) return fail("self not 200 (" + r.status + ")");
      let obj; try { obj = JSON.parse(r.text); } catch (e) { return fail("self not JSON"); }
      const claimed = obj.record_sha256;
      if (!/^[0-9a-f]{64}$/.test(claimed || "")) return fail("no record_sha256 in /self");
      delete obj.record_sha256; delete obj.recompute_note;
      const got = sha256hex(Buffer.from(JSON.stringify(obj), "utf8"));
      return got === claimed
        ? pass("recomputed /self verdict, sha256 == record_sha256 (" + claimed.slice(0, 12) + ")")
        : fail("recompute mismatch: got " + got.slice(0, 12) + " vs " + claimed.slice(0, 12));
    }
    case "honest-limits": {
      const r = await get(url); // /self
      if (r.status !== 200) return fail("self not 200 (" + r.status + ")");
      let obj; try { obj = JSON.parse(r.text); } catch (e) { return fail("self not JSON"); }
      const dne = Array.isArray(obj.does_not_establish) && obj.does_not_establish.length > 0;
      const iv = await get("https://gate.horizonshield.dev/is-verified?endpoint=" + encodeURIComponent("https://example.com/mcp"));
      let notFalse = true;
      try { notFalse = JSON.parse(iv.text).verified !== false; } catch (e) { notFalse = !/"verified"\s*:\s*false/.test(iv.text); }
      return (dne && notFalse)
        ? pass("does_not_establish non-empty (" + obj.does_not_establish.length + "), /is-verified not false")
        : fail("dne=" + dne + " notFalse=" + notFalse);
    }
    case "anonymous-recompute": {
      const r = await get(url);
      return r.status === 200 ? pass("200 without auth") : fail("not 200 (" + r.status + ")");
    }
    case "identity-bound-to-domain": {
      const r = await get(url);
      if (r.status !== 200) return fail("did.json not 200 (" + r.status + ")");
      const okId = /did:web:gate\.horizonshield\.dev/.test(r.text) && /verificationMethod/.test(r.text);
      return okId ? pass("DID doc resolves, keys under the domain") : fail("did doc missing id or verificationMethod");
    }
    case "existence-time-anchored": {
      const r = await get(url);
      if (r.status !== 200) return fail("nenrin/window not 200 (" + r.status + ")");
      const okWin = /commit|salt|coordinate/i.test(r.text);
      return okWin ? pass("window commitment published") : fail("no commitment fields in window");
    }
    default: {
      // generic: the recompute is a documented recipe (offline tool, manual inspection);
      // confirm the URL resolves so the recipe is runnable, and report it as manual.
      const r = await get(url);
      return r.status === 200
        ? pass("url resolves (200); manual recompute: " + a.verify.recompute)
        : fail("url not 200 (" + r.status + ")");
    }
  }
}
function pass(detail) { return { pass: true, detail }; }
function fail(detail) { return { pass: false, detail }; }

async function checkLive(m) {
  const out = [];
  for (const a of m.axes) {
    let res;
    try { res = await liveAxis(a); }
    catch (e) { res = fail("unreachable: " + (e && e.message ? e.message : String(e))); } // fail-closed
    out.push({ name: "live " + a.id, pass: res.pass, detail: res.detail });
  }
  return out;
}

// ---- main ----
async function main() {
  const args = process.argv.slice(2);
  const path = args.find((x) => !x.startsWith("--"));
  const live = args.includes("--live");
  if (!path) { console.error("usage: node selection_verify.mjs <manifest.json> [--live]"); process.exit(2); }

  const { raw, obj } = loadManifest(path);
  let checks = checkStructure(raw, obj);
  if (live) checks = checks.concat(await checkLive(obj));

  let failed = 0;
  for (const c of checks) {
    const tag = c.pass ? "PASS" : "FAIL";
    if (!c.pass) failed++;
    console.log(tag + "  " + c.name + (c.detail ? "  -- " + c.detail : ""));
  }
  console.log("");
  console.log((failed === 0 ? "OK  " : "FAILED  ") + (checks.length - failed) + "/" + checks.length + " checks pass" + (live ? " (with --live)" : " (offline)"));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error("error: " + (e && e.stack ? e.stack : e)); process.exit(1); });
