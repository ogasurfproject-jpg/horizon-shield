// version_sync.test.mjs (2026-09-14): the registry manifest must not drift behind the deployed gate.
//
// Why this exists. The gate version lives in src/worker.js CONFIG.version. The MCP registry
// manifest server.json carries its own version and is republished by hand. Every time the gate
// bumped (0.2.4 while prod ran 0.3.1; 0.4.0 while prod ran 0.4.7) the manifest lagged and the
// registry advertised an old version. That drift was tracked over and over as claim C16. A
// version string that can disagree with the code it names is a version string that will. This
// suite makes the deploy gate refuse while server.json.version != CONFIG.version, so the drift
// cannot ship again. It touches no anchored bytes; it compares two strings.
//
// Run: node test/version_sync.test.mjs   (in workers/hs-verify-gate)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.resolve(HERE, "..");
const SEMVER = /^\d+\.\d+\.\d+$/;

let fails = 0, n = 0;
const t = (ok, msg, extra) => { n++; console.log((ok ? "ok   " : "FAIL ") + n + ". " + msg + (ok ? "" : ("   " + (extra || "")))); if (!ok) fails++; };

let serverVer = null;
try {
  const sj = JSON.parse(readFileSync(path.join(GATE, "server.json"), "utf8"));
  serverVer = sj.version;
  t(typeof serverVer === "string" && SEMVER.test(serverVer), "server.json version is semver", "got " + JSON.stringify(serverVer));
} catch (e) { t(false, "server.json reads and parses", e.message); }

let workerVer = null;
try {
  const src = readFileSync(path.join(GATE, "src", "worker.js"), "utf8");
  const m = src.match(/const CONFIG = \{\s*version: "(\d+\.\d+\.\d+)"/);
  workerVer = m ? m[1] : null;
  t(SEMVER.test(workerVer || ""), "worker.js CONFIG.version found and is semver", "got " + JSON.stringify(workerVer));
} catch (e) { t(false, "src/worker.js reads", e.message); }

t(serverVer !== null && workerVer !== null && serverVer === workerVer,
  "server.json version == worker CONFIG.version (registry must not lag prod, claim C16)",
  "server.json=" + JSON.stringify(serverVer) + " worker=" + JSON.stringify(workerVer) +
  "  fix: set server.json version to " + JSON.stringify(workerVer) +
  " then publish (GitHub Actions -> MCP registry publish -> server_dir workers/hs-verify-gate)");

console.log("");
if (fails) { console.log("FAIL " + fails + "/" + n + " (version_sync)"); process.exit(1); }
console.log("PASS " + n + "/" + n + " (version_sync: registry manifest matches deployed gate)");
process.exit(0);
