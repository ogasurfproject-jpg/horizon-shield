// HORIZON SHIELD adapter, run standalone: `node adapters/horizon-shield/demo.mjs`
// Requires python3 on PATH (stdlib only: json, hashlib). Nothing to install.
import { run, BACKEND } from "../../runner/src/evaluate.mjs";
import { horizonShieldAdapter } from "./adapter.mjs";
import { VECTORS } from "./vectors.mjs";

const { rows, witnesses, tally } = run(VECTORS, [horizonShieldAdapter]);

console.log("\n  horizon-shield adapter: content_addressed_decision_commitment, real replay of a public git history\n");
console.log("  vector                          scope          oracle       observed     backend");
console.log("  " + "-".repeat(84));
const scopeOf = Object.fromEntries(VECTORS.map((v) => [v.id, v.scope]));
for (const r of rows) {
  console.log(
    `  ${r.vector.padEnd(31)} ${scopeOf[r.vector].padEnd(14)} ${String(r.oracle_pair).padEnd(12)} ${String(r.observed_pair).padEnd(12)} ${r.backend}`
  );
}
console.log(`\n  pairs (oracle)  PRESERVED ${tally.PRESERVED}  VIOLATED ${tally.VIOLATED}  UNVERIFIABLE ${tally.UNVERIFIABLE}`);
console.log(`  backends        PASS ${tally.PASS}  FAIL ${tally.FAIL}  CANNOT_CHECK ${tally.CANNOT_CHECK}`);

if (witnesses.length) {
  console.log(`\n  ${witnesses.length} collapse(s) reported:`);
  for (const w of witnesses) console.log(`  x ${w.adapter} ${w.vector}: ${w.minimal}`);
}

// Expected pattern. One FAIL is history (pre-patch52, reproduced). Two FAILs are current and declared:
// the status label collapses distinctions that the record bytes keep. Everything at record scope after
// the fix must PASS, and the clean control must PASS.
const byId = Object.fromEntries(rows.map((r) => [r.vector, r]));
const expected =
  byId["hs-pre-patch52-self-held"]?.backend === BACKEND.FAIL &&
  byId["hs-post-patch52-adversarial"]?.backend === BACKEND.PASS &&
  byId["hs-post-patch52-clean"]?.backend === BACKEND.PASS &&
  byId["hs-post-patch52-status-label"]?.backend === BACKEND.FAIL &&
  byId["hs-determinism-record-scope"]?.backend === BACKEND.PASS &&
  byId["hs-determinism-status-label"]?.backend === BACKEND.FAIL;
console.log(
  expected
    ? "\n  Matches the expected pattern: the pre-patch52 collapse reproduces as a FAIL, the fix and the control PASS at record scope, and the two label-scope collapses are reported as the open findings they are.\n"
    : "\n  Does NOT match the expected pattern. See the rows above; something regressed, or the vendor script drifted from the cited commits.\n"
);
