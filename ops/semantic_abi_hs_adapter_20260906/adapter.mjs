import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PAIR } from "../../runner/src/evaluate.mjs";

// REAL adapter for HORIZON SHIELD (owner: Toshikatsu Oga, The HORIZONs Co., Ltd.). observe() shells out
// to vendor/hs_gate_record_commitment.py, which rebuilds two gate verdict records under the cited
// commits' own derivation and commitment rules and prints their record_sha256 and status values. The
// pair outcome is derived here from those values and nothing else: VIOLATED when the backend told the
// two claims apart at the vector's scope, PRESERVED when it did not. The vector's oracle is never read;
// grading happens in the shared runner. No code is shared with any other owner's adapter; the only
// import is the runner's PAIR enum, which is the rule of this repository.
//
// Scope is part of the claim. "record" compares record_sha256 over the record bytes. "status_label"
// compares the status word alone, because that is what the register page, the state enum and the
// NENRIN ring's counts consume. The same pair can be PRESERVED-as-distinct in the bytes and collapsed
// in the label, and this adapter reports both rather than choosing the flattering one.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "vendor", "hs_gate_record_commitment.py");
const MODES = new Set(["pre_patch52", "post_patch52", "post_patch52_clean", "determinism"]);
const SCOPES = new Set(["record", "status_label"]);

export const horizonShieldAdapter = {
  name: "horizon-shield",
  observe(vector) {
    if (vector.relation !== "content_addressed_decision_commitment") return null;
    if (!MODES.has(vector.mode) || !SCOPES.has(vector.scope)) return null;
    const out = execFileSync("python3", [SCRIPT, vector.mode], { encoding: "utf8" });
    const r = JSON.parse(out);
    const distinct = vector.scope === "record" ? r.distinct_record : r.distinct_status;
    return distinct ? PAIR.VIOLATED : PAIR.PRESERVED;
  },
};
