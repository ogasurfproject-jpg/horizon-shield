// exec_cross_lang_test.mjs : the execution-layer digests are not tied to this JS.
// Runs exec_witness_emit.py (independent Python canonical + sha256), then recomputes grant_ref and receipt_id
// in JS from the same records. Both the canonical preimage BYTES and the resulting hashes must agree exactly.
// Self-contained: no fixture file is written or read, so nothing here is an untracked artifact.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { canonical } from "../task-delegation-bind-v0/bind.mjs";
import { grantRef, receiptId, grantPreimage, receiptPreimage, verifyExecution } from "./bind_exec.mjs";
import { verifyEvidence } from "./outcome_evidence.mjs";

let fail = 0;
const chk = (n, c, x = "") => { console.log((c ? "PASS  " : "FAIL  ") + n + (c ? "" : "  <<< " + String(x).slice(0, 240))); if (!c) fail++; };

const py = fileURLToPath(new URL("./exec_witness_emit.py", import.meta.url));
const out = execFileSync("python3", [py], { encoding: "utf8" });
const fx = JSON.parse(out);

chk("python emitted a grant and a receipt", !!fx.grant && !!fx.receipt);
chk("grant preimage bytes agree (python canonical == JS canonical)", fx.grant_preimage_canonical === canonical(grantPreimage(fx.grant)), fx.grant_preimage_canonical.slice(0, 120));
chk("receipt preimage bytes agree (python canonical == JS canonical)", fx.receipt_preimage_canonical === canonical(receiptPreimage(fx.receipt)), fx.receipt_preimage_canonical.slice(0, 120));
chk("grant_ref recomputed in JS equals the python value", grantRef(fx.grant) === fx.grant.grant_ref, grantRef(fx.grant) + " vs " + fx.grant.grant_ref);
chk("receipt_id recomputed in JS equals the python value", receiptId(fx.receipt) === fx.receipt.receipt_id, receiptId(fx.receipt) + " vs " + fx.receipt.receipt_id);
chk("the python-built pair verifies in the JS verifier (E1 action_bound, null not_before honored)", verifyExecution(fx.grant, fx.receipt).ok === true);
chk("the python-built evidence pointer is well-formed in JS", verifyEvidence(fx.receipt, null).reason === "evidence_bound_unchecked");
chk("fixture exercised a null value and unsorted insertion order", fx.grant.not_before === null && Object.keys(fx.grant)[0] !== "action");

console.log(fail ? ("\n" + fail + " FAILED") : "\nALL PASS (task-execution-bind-v0 cross-lang: python == JS byte for byte)");
process.exit(fail ? 1 : 0);
