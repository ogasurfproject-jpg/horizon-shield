// tsugi_verify.test.mjs : the single-file TSUGI verifier is a faithful copy of the recovery-v0 modules and verifies
// the real incident chain and the witness fixture offline, with the same refusal codes as the modules, byte for byte.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as SDK from "./tsugi_verify.mjs";
import * as MOD from "../recovery-v0/recovery_verify.mjs";
import { seal } from "../recovery-v0/recovery_verify.mjs";

let pass = 0, fail = 0;
const chk = (name, ok, d) => { ok ? pass++ : fail++; console.log((ok ? "  ok   " : "  FAIL ") + name + (ok || !d ? "" : "  <- " + d)); };
const DASH = new RegExp("[" + String.fromCharCode(0x2014, 0x2013, 0x2015) + "]");
const clone = (x) => JSON.parse(JSON.stringify(x));

// 1. the committed artifact is what the build produces
const committed = readFileSync(new URL("./tsugi_verify.mjs", import.meta.url), "utf8");
execFileSync("node", [new URL("./build_tsugi.mjs", import.meta.url).pathname], { encoding: "utf8" });
const rebuilt = readFileSync(new URL("./tsugi_verify.mjs", import.meta.url), "utf8");
chk("tsugi_verify.mjs is exactly what build_tsugi.mjs produces (no hand edits)", committed === rebuilt);
chk("no em/en/bar dashes in the artifact", !DASH.test(committed));
chk("zero external imports (only node:fs, node:url, node:crypto fallback)", !/^import .* from ["'](?!node:)/m.test(committed));

// 2. real incident chain: same report as the modules, strict with the operator key
const inc = JSON.parse(readFileSync(new URL("../recovery-v0/incident_20260920_resign_chain.json", import.meta.url), "utf8"));
const key = inc.operator_public_key_ed25519_b64;
const rS = await SDK.verifyChain(inc.records, { operatorKeys: [key] });
const rM = await MOD.verifyChain(inc.records, { operatorKeys: [key] });
chk("incident 2 strict: ok and byte-identical report to the modules", rS.ok && JSON.stringify(rS) === JSON.stringify(rM));
const bS = await SDK.verifyChain(inc.records, { operatorKeys: ["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="] });
chk("incident 2 with an untrusted key: authorization_untrusted_key, same as modules", bS.refusals.some((x) => x.code === "authorization_untrusted_key") && JSON.stringify(bS) === JSON.stringify(await MOD.verifyChain(inc.records, { operatorKeys: ["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="] })));
for (const r of inc.records) chk("record_sha256 recomputes in the SDK: " + r.schema.replace("nenrin-", "").replace("-v1", "") + " " + r.record_sha256.slice(0, 8), (await SDK.recordSha256(r)) === r.record_sha256);

// 3. witness fixture: draw, quorum, commitment, and mutations produce identical refusal codes
const fx = JSON.parse(readFileSync(new URL("../recovery-v0/witness_fixture_20260920.json", import.meta.url), "utf8"));
const q = { q: 2, k: 3, pool: fx.pool, beaconHash: fx.beacon.hash, requireCommitment: true, commitmentAnchor: { height: "0", hash: fx.records[6].draw.commitment.anchor.hash } };
const fS = await SDK.verifyChain(fx.records, { witnessQuorum: q }), fM = await MOD.verifyChain(fx.records, { witnessQuorum: q });
chk("witness fixture with quorum 2, k 3, beacon, commitment: ok, byte-identical to the modules", fS.ok && JSON.stringify(fS) === JSON.stringify(fM), JSON.stringify(fS.refusals));
const d1 = await SDK.draw({ pool: fx.pool, beaconHash: fx.beacon.hash, subjectSha256: fx.records[5].record_sha256, k: 3, excludeHost: "gate.horizonshield.dev" });
chk("SDK recomputes the same draw", JSON.stringify(d1.drawn) === JSON.stringify(fx.records[6].draw.drawn));
chk("SDK commitmentClaimText equals the fixture's claim", (await SDK.sha256Hex(SDK.commitmentClaimText(fx.records[5].record_sha256))) === fx.records[6].draw.commitment.claim_sha256);
const reseal = async (v) => { const { record_sha256: _h, ...b } = v; return seal(b); };
const mutations = [
  ["drawn edited", (v) => { v.draw.drawn[0] = "witness-e.example"; }],
  ["commitment removed", (v) => { delete v.draw.commitment; }],
  ["beacon not next block", (v) => { v.draw.beacon.height = "2"; }],
  ["witness before execution", (v) => { v.external.find((e) => e.record).record.recorded_at = "2026-09-20T07:00:00Z"; }],
  ["pool_size lied", (v) => { v.draw.pool_size = "7"; }],
];
for (const [name, mut] of mutations) {
  const v = clone(fx.records[6]); mut(v);
  const chain = [...fx.records.slice(0, 6), await reseal(v)];
  const a = await SDK.verifyChain(chain, { witnessQuorum: q }), b = await MOD.verifyChain(chain, { witnessQuorum: q });
  chk("mutation " + name + ": refused, codes identical to modules (" + a.refusals.map((x) => x.code).join(",") + ")", !a.ok && JSON.stringify(a) === JSON.stringify(b));
}

// 4. CLI
const cli = (args) => { try { return { code: 0, out: execFileSync("node", [new URL("./tsugi_verify.mjs", import.meta.url).pathname, ...args], { encoding: "utf8" }) }; } catch (e) { return { code: e.status, out: String(e.stdout || "") + String(e.stderr || "") }; } };
const incPath = new URL("../recovery-v0/incident_20260920_resign_chain.json", import.meta.url).pathname;
const c1 = cli([incPath, "--operator-key", key]);
chk("CLI: incident chain strict, exit 0, ok true", c1.code === 0 && /"ok": true/.test(c1.out));
const c2 = cli([incPath, "--operator-key", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="]);
chk("CLI: wrong operator key, exit 1, authorization_untrusted_key", c2.code === 1 && /authorization_untrusted_key/.test(c2.out));
const c3 = cli([incPath]);
chk("CLI: lenient without a key says so in note", c3.code === 0 && /lenient/.test(c3.out));
const poolPath = new URL("./_tsugi_smoke_pool.gen.json", import.meta.url);
writeFileSync(poolPath, JSON.stringify(fx.pool));
const c4 = cli([new URL("../recovery-v0/witness_fixture_20260920.json", import.meta.url).pathname, "--pool", poolPath.pathname, "--q", "2", "--k", "3", "--require-commitment", "--anchor-height", "0"]);
chk("CLI: witness fixture with pool, q, k, commitment: exit 0", c4.code === 0 && /"ok": true/.test(c4.out), c4.out.slice(0, 300));
const c5 = cli([new URL("../recovery-v0/witness_fixture_20260920.json", import.meta.url).pathname, "--pool", poolPath.pathname, "--q", "3"]);
chk("CLI: quorum 3 against 2 answers: exit 1, witness_quorum_short", c5.code === 1 && /witness_quorum_short/.test(c5.out));
chk("CLI: report carries does_not_establish", /does_not_establish/.test(c1.out));

console.log(fail ? ("\n" + fail + " FAILED") : "\nALL PASS (tsugi_verify.mjs: single-file TSUGI verifier is a faithful copy and verifies offline)");
process.exit(fail ? 1 : 0);
