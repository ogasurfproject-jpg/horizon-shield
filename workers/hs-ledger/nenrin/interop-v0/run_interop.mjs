// run_interop.mjs : the NENRIN reference interop check. Verifies each frozen fixture with the published verifier
// (sdk/nenrin_verify.mjs, the same single file published as nenrin-verify) and asserts it reproduces the canonical
// verdict signature frozen in expected.json. A conforming implementation, in any language, reproduces the same
// verdict signatures on the same fixtures. Run: node run_interop.mjs
import { readFileSync } from "node:fs";
import { verifyProvenance, didKeyResolver } from "../sdk/nenrin_verify.mjs";
const DASH = new RegExp("[" + String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D) + "]");
let fail = 0;
const chk = (n, c, x = "") => { console.log((c ? "PASS  " : "FAIL  ") + n + (c ? "" : "  <<< " + String(x).slice(0, 220))); if (!c) fail++; };
const expected = JSON.parse(readFileSync(new URL("./expected.json", import.meta.url)));
const sig = (p) => ({ verdict: p.verdict, refusals: p.refusals.map((r) => r.code).sort(), findings: p.findings.map((f) => f.code).sort() });
for (const [name, c] of Object.entries(expected.cases)) {
  const bundle = JSON.parse(readFileSync(new URL("./fixtures/" + name + ".json", import.meta.url)));
  const got = sig(verifyProvenance(Object.assign({}, bundle, { resolve: didKeyResolver })));
  chk("[" + name + "] reproduces the frozen verdict signature", JSON.stringify(got) === JSON.stringify(c.expect), "expected " + JSON.stringify(c.expect) + " got " + JSON.stringify(got));
}
chk("no em/en/bar dashes in expected.json", !DASH.test(readFileSync(new URL("./expected.json", import.meta.url), "utf8")));
console.log(fail ? ("\n" + fail + " FAILED") : "\nALL PASS (nenrin reference interop: every fixture reproduces its frozen verdict signature under the published verifier; a conforming reimplementation reproduces the same)");
process.exit(fail ? 1 : 0);
