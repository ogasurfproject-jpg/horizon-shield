#!/usr/bin/env node
// ops/registry_drift_check.mjs (2026-09-14): the authoritative C16 detector.
//
// C16 is "the MCP registry advertises an older version than the source of truth (main)".
// It kept recurring because server.json is republished by a manual workflow, so a bump on
// main did not reach the registry until someone remembered to run it. The version_sync gate
// test catches server.json vs worker code (P1); it cannot see the registry (P2), which is the
// real recurrence. This checks P2 for every server, and P1 as a best effort.
//
// For every server.json in the repo:
//   P2 (primary, fail-closed): main version (server.json) vs the LIVE registry latest version.
//   P1 (best effort): the worker's declared const SERVER|CONFIG version vs server.json.
// Always queries with &version=latest, so it cannot repeat the "old version reads as latest"
// false alarm that started all of this.
//
// Usage:
//   node ops/registry_drift_check.mjs             live check (needs network to the registry)
//   node ops/registry_drift_check.mjs --selftest  offline logic test with a mock registry
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const REGISTRY = "https://registry.modelcontextprotocol.io/v0/servers";
const SEMVER = /^\d+\.\d+\.\d+$/;

function serverJsonPaths() {
  const out = [];
  if (existsSync(path.join(REPO, "server.json"))) out.push("server.json");
  const wdir = path.join(REPO, "workers");
  if (existsSync(wdir)) {
    for (const w of readdirSync(wdir)) {
      const p = path.join("workers", w, "server.json");
      if (existsSync(path.join(REPO, p))) out.push(p);
    }
  }
  return out.sort();
}

function workerVersion(subfolder) {
  if (!subfolder) return null;
  const dir = path.join(REPO, subfolder);
  if (!existsSync(dir)) return null;
  const files = [];
  const walk = (d, depth) => {
    if (depth > 2) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp, depth + 1);
      else if (/\.(mjs|js)$/.test(e.name) && !e.name.includes(".bak")) files.push(fp);
    }
  };
  try { walk(dir, 0); } catch { return null; }
  const re = /const (?:SERVER|CONFIG)\s*=\s*\{[^}]*?version:\s*"(\d+\.\d+\.\d+)"/;
  for (const f of files.sort()) {
    try { const m = readFileSync(f, "utf8").match(re); if (m) return { version: m[1], file: path.relative(REPO, f) }; } catch {}
  }
  return null;
}

// 2026-09-26: the hint used repository.subfolder, so dev.horizonshield/horizon-shield (whose server.json has no
// repository block) read "server_dir undefined", and it pointed every name at the Actions workflow. That workflow
// logs in with GitHub OIDC, which can only publish io.github.ogasurfproject-jpg/*. A domain name needs the domain's
// own key: mcp-publisher login dns on the operator's Mac. The directory is where the server.json is.
function republishHint(name, sjPath) {
  const dir = path.dirname(sjPath);
  if (name.startsWith("io.github.")) return "republish: Actions 'MCP registry publish', server_dir " + dir;
  const ns = name.split("/")[0];
  const domain = ns.split(".").reverse().join(".");
  return "republish on the operator's Mac (Actions OIDC cannot publish " + ns + "/*): mcp-publisher login dns --domain " + domain + " with the domain key, then cd " + dir + " && mcp-publisher publish";
}

async function registryLatest(name, fetchFn) {
  const url = REGISTRY + "?search=" + encodeURIComponent(name) + "&version=latest";
  const res = await fetchFn(url);
  if (!res.ok) throw new Error("http " + res.status);
  const d = await res.json();
  const hit = (d.servers || []).find((s) => s.server && s.server.name === name);
  if (!hit) return { version: null, isLatest: null, present: false };
  const meta = (hit._meta && hit._meta["io.modelcontextprotocol.registry/official"]) || {};
  return { version: hit.server.version, isLatest: meta.isLatest === true, present: true };
}

async function run(fetchFn) {
  const rows = [];
  for (const sjPath of serverJsonPaths()) {
    const sj = JSON.parse(readFileSync(path.join(REPO, sjPath), "utf8"));
    const name = sj.name, mainVer = sj.version, subfolder = (sj.repository || {}).subfolder;
    const wv = workerVersion(subfolder);
    let reg, regErr = null;
    try { reg = await registryLatest(name, fetchFn); } catch (e) { reg = { version: null, isLatest: null, present: false }; regErr = e.message; }
    const issues = [];
    if (!SEMVER.test(mainVer || "")) issues.push("server.json version not semver: " + JSON.stringify(mainVer));
    if (wv && wv.version !== mainVer) issues.push("P1: worker " + wv.version + " (" + wv.file + ") != server.json " + mainVer);
    if (regErr) issues.push("registry query failed: " + regErr);
    else if (!reg.present) issues.push("P2: not found in registry (never published?)");
    else if (reg.version !== mainVer) issues.push("P2: registry " + reg.version + " != main " + mainVer + "  -> " + republishHint(name, sjPath));
    else if (reg.isLatest !== true) issues.push("P2: registry version matches but not marked isLatest");
    rows.push({ name, mainVer, worker: wv ? wv.version : "n/a", registry: reg.present ? reg.version : (regErr ? "err" : "absent"), ok: issues.length === 0, issues });
  }
  return rows;
}

function report(rows) {
  for (const r of rows) {
    console.log((r.ok ? "[OK]   " : "[DRIFT]") + " " + r.name.padEnd(50) + " main=" + String(r.mainVer).padEnd(8) + " worker=" + String(r.worker).padEnd(8) + " registry=" + String(r.registry));
    for (const i of r.issues) console.log("        - " + i);
  }
  const bad = rows.filter((r) => !r.ok).length;
  console.log("");
  console.log("=== " + (rows.length - bad) + "/" + rows.length + " synced, " + bad + " drift (registry drift check, " + new Date().toISOString().replace(/\.\d{3}Z$/, "Z") + ") ===");
  return bad;
}

if (process.argv.includes("--selftest")) {
  const mainOf = {};
  for (const p of serverJsonPaths()) { const sj = JSON.parse(readFileSync(path.join(REPO, p), "utf8")); mainOf[sj.name] = sj.version; }
  const DRIFT = "io.github.ogasurfproject-jpg/hs-verify-gate";
  const ABSENT = "io.github.ogasurfproject-jpg/hs-hearing";
  const mockFetch = async (url) => {
    const name = new URL(url).searchParams.get("search");
    let servers = [];
    if (name !== ABSENT) {
      const v = name === DRIFT ? "0.0.1" : (mainOf[name] || "9.9.9");
      servers = [{ server: { name, version: v }, _meta: { "io.modelcontextprotocol.registry/official": { isLatest: true } } }];
    }
    return { ok: true, json: async () => ({ servers }) };
  };
  const rows = await run(mockFetch);
  const flagged = rows.filter((r) => !r.ok).map((r) => r.name);
  report(rows);
  console.log("");
  const gateFlagged = flagged.includes(DRIFT);
  const hearingFlagged = flagged.includes(ABSENT);
  const othersClean = rows.filter((r) => r.name !== DRIFT && r.name !== ABSENT).every((r) => r.ok);
  const pass = gateFlagged && hearingFlagged && othersClean;
  console.log("selftest: forced-drift(gate)=" + gateFlagged + " forced-absent(hearing)=" + hearingFlagged + " others-clean=" + othersClean + " => " + (pass ? "PASS" : "FAIL"));
  process.exit(pass ? 0 : 1);
}

const rows = await run((u) => fetch(u));
process.exit(report(rows) ? 1 : 0);
