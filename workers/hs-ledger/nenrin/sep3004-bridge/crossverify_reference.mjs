// crossverify_reference.mjs : run the SEP-3004 REFERENCE verifier (gif, Apache-2.0) over a chain this bridge exported.
//
// The point of a bridge is that somebody else's verifier accepts the bytes. This harness imports the reference
// implementation's audit-record-contract.ts (clone https://github.com/notboatanchor/gif) and runs its four checks
// over chain.jsonl and manifest.json. Nothing here is ours except the file reading.
//
//   git clone --depth 1 https://github.com/notboatanchor/gif.git /tmp/gif
//   node --experimental-strip-types crossverify_reference.mjs \
//        --ref /tmp/gif/mcp-server/conformance/audit-record-contract/audit-record-contract.ts \
//        --chain sep3004_out/chain.jsonl --manifest sep3004_out/manifest.json
//
// Exit 0 when hashes, links and manifest pass. Unregistered extension types are printed as the reference
// reports them (a failure of validateExtensions) and do not change the exit code unless --strict is given:
// conduct-witness is proposed, not registered, and the reference verifier only knows the SEP's registry.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const args = process.argv.slice(2);
function opt(name, dflt) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; }
const refPath = opt("--ref", null);
const chainPath = opt("--chain", "sep3004_out/chain.jsonl");
const manifestPath = opt("--manifest", "sep3004_out/manifest.json");
const strict = args.includes("--strict");
if (!refPath) { console.error("--ref <path to audit-record-contract.ts> is required"); process.exit(2); }

const ref = await import(pathToFileURL(resolve(refPath)).href);
const records = readFileSync(chainPath, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

let hard = 0, soft = 0;
for (const r of records) {
  const s = ref.validateSkeleton(r);
  if (!s.ok) { hard++; console.log("skeleton  " + r.event_id.slice(0, 12) + "  " + s.failures.join("; ")); }
  const x = ref.validateExtensions(r);
  if (!x.ok) {
    const onlyUnregistered = x.failures.every((f) => f.startsWith("unregistered extension type"));
    if (onlyUnregistered) { soft++; console.log("registry  " + r.event_id.slice(0, 12) + "  " + x.failures.join("; ")); }
    else { hard++; console.log("extension " + r.event_id.slice(0, 12) + "  " + x.failures.join("; ")); }
  }
  const h = ref.verifyRecordHash(r);
  if (!h.ok) { hard++; console.log("hash      " + r.event_id.slice(0, 12) + "  " + h.failures.join("; ")); }
}
const c = ref.verifyChainSegment(records);
if (!c.ok) { hard++; console.log("chain     " + c.failures.join("; ")); }
const m = ref.validateManifest(manifest);
if (!m.ok) { hard++; console.log("manifest  " + m.failures.join("; ")); }

// independent recomputation of every event_hash by the reference canonicalizer, printed for the record
for (const r of records) console.log("reference event_hash " + ref.computeEventHash(r) + "  stored " + r.event_hash + "  " + (ref.computeEventHash(r) === r.event_hash ? "equal" : "DIFFERENT"));

console.log("");
console.log("reference verifier: " + records.length + " records; hashes+links+skeleton+manifest " + (hard === 0 ? "PASS" : "FAIL (" + hard + ")") +
            "; registry findings " + soft + (soft ? " (extension types the SEP registry does not list yet)" : ""));
process.exit(hard === 0 && (!strict || soft === 0) ? 0 : 1);
