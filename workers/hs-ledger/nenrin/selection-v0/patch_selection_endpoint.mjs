#!/usr/bin/env node
// patch_selection_endpoint.mjs -- additive: serve the Choice Layer manifest at
// GET /.well-known/selection.json on the Verify Gate. Does NOT touch the signed
// agent card, so no re-sign is needed. HS coding rules: anchor + assert count==1
// + timestamped .bak + node --check (restores .bak on failure).
//
// Usage: node patch_selection_endpoint.mjs [path/to/worker.js]

import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const workerPath = resolve(process.argv[2] || join(here, "../../../hs-verify-gate/src/worker.js"));
const manifestPath = join(here, "selection.conduct.json");

const CONST_ANCHOR = 'const CONDUCT_EXT_URI = "https://gate.horizonshield.dev/ext/conduct/v1";';
const ROUTE_ANCHOR = 'if (path === "/.well-known/did.json") return json(didDocument(env));';

function countOccurrences(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

function main() {
  let src = readFileSync(workerPath, "utf8");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const newConst = "const SELECTION_CONDUCT = " + JSON.stringify(manifest, null, 2) + ";";
  let mode;

  if (src.includes("SELECTION_CONDUCT")) {
    // update mode: replace the embedded manifest, keep comment + route.
    const re = /const SELECTION_CONDUCT = [\s\S]*?\n\};/;
    const hits = src.match(new RegExp(re.source, "g"));
    if (!hits || hits.length !== 1) { console.error("SELECTION_CONDUCT block count != 1 (got " + (hits ? hits.length : 0) + "). aborting."); process.exit(1); }
    src = src.replace(re, newConst);
    mode = "updated embedded manifest";
  } else {
    // create mode: two anchored, additive insertions.
    const cA = countOccurrences(src, CONST_ANCHOR);
    const rA = countOccurrences(src, ROUTE_ANCHOR);
    if (cA !== 1) { console.error("const anchor count != 1 (got " + cA + "). aborting."); process.exit(1); }
    if (rA !== 1) { console.error("route anchor count != 1 (got " + rA + "). aborting."); process.exit(1); }
    const constBlock = CONST_ANCHOR + "\n" +
      "// hs-selection-v0: served at /.well-known/selection.json (does not touch the signed card).\n" +
      newConst;
    const routeBlock = ROUTE_ANCHOR + "\n" +
      '    if (path === "/.well-known/selection.json") return json(SELECTION_CONDUCT);';
    src = src.replace(CONST_ANCHOR, constBlock);
    src = src.replace(ROUTE_ANCHOR, routeBlock);
    mode = "added route + embedded manifest";
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bak = workerPath + "." + stamp + ".bak";
  copyFileSync(workerPath, bak);
  writeFileSync(workerPath, src, "utf8");

  const chk = spawnSync(process.execPath, ["--check", workerPath], { encoding: "utf8" });
  if (chk.status !== 0) {
    copyFileSync(bak, workerPath);
    console.error("node --check FAILED, restored from .bak:\n" + (chk.stderr || chk.stdout));
    process.exit(1);
  }

  console.log("patched OK (" + mode + "): " + workerPath);
  console.log("backup:     " + bak);
  console.log("node --check: passed");
  console.log("");
  console.log("next (your manual steps):");
  console.log("  cd " + dirname(workerPath));
  console.log("  npx wrangler whoami   # expect oga.surf.project / c15ff64a");
  console.log("  npx wrangler deploy");
  console.log("  curl -s https://gate.horizonshield.dev/.well-known/selection.json | head");
}

main();
