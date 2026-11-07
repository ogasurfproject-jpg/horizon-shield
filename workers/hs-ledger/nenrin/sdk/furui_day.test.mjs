// furui_day.test.mjs: the shared vectors (../furui-check-day-v0/verify_vectors.json), the CLI's usage and exit codes,
// and the host guard. --bitcoin-header (next version): its vectors (../furui-check-day-v0/bitcoin_header_vectors.json,
// Python and JavaScript only), no explorer is asked without the flag, the explorer host guard. No network: every case
// reads its own world.
//   node furui_day.test.mjs
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { runVectors, httpGet, httpGetExplorer, NetError, furuiDay, resumeAdmission, worldGet, summary, canonical } from "./furui_day.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const vectors = join(here, "..", "furui-check-day-v0", "verify_vectors.json");
const bhVectors = join(here, "..", "furui-check-day-v0", "bitcoin_header_vectors.json");
let pass = 0, fail = 0;
const ok = (c, name) => { if (c) pass++; else { fail++; console.log("FAIL " + name); } };

const lines = [];
ok((await runVectors(vectors, (l) => lines.push(l))) === 0, "every vector gives its expected verdict");
console.log(lines[lines.length - 1]);

const cli = (args) => spawnSync(process.execPath, [join(here, "nenrin_verify.mjs"), ...args], { encoding: "utf8" });
for (const a of [["furui-day"], ["furui-day", "2026-11-31", "--leaf", "0"], ["furui-day", "2026-11-03", "--leaf", "-1"], ["furui-day", "2026-11-03", "--leaf", "01"],
  ["resume-admission", "http://example.org/", "a".repeat(64)], ["resume-admission", "https://example.org/", "A".repeat(64)],
  // 0.8.1 (the Python port moved to these; this port refused them already): nothing after the value, ASCII digits only
  ["furui-day", "2026-11-03\n", "--leaf", "0"], ["furui-day", "\uff12\uff10\uff12\uff16-11-03", "--leaf", "0"], ["furui-day", "2026-11-03", "--leaf", "0\n"],
  ["furui-day", "2026-11-03", "--leaf", "\u0663"], ["resume-admission", "https://example.org/", "a".repeat(64) + "\n"], ["resume-admission", "https://example.org/\n", "a".repeat(64)]]) {
  ok(cli(a).status === 2, "usage exit 2: " + a.join(" "));
}
const v = cli(["furui-vectors", vectors]);
ok(v.status === 0 && /furui vectors give the expected verdict \(javascript\)/.test(v.stdout), "furui-vectors through the nenrin-verify bin");

for (const u of ["https://example.org/furui/day/2026-11-03/leaf/0", "http://ledger.horizonshield.dev/ledger/1", "https://ledger.horizonshield.dev:8443/ledger/1"]) {
  let threw = false;
  try { await httpGet(u); } catch (e) { threw = e instanceof NetError; }
  ok(threw, "host guard refuses " + u);
}
// ---- --bitcoin-header ----
const bl = [];
ok((await runVectors(bhVectors, (l) => bl.push(l))) === 0, "every --bitcoin-header vector gives its expected answer");
console.log(bl[bl.length - 1]);
const vb = cli(["furui-vectors", bhVectors]);
ok(vb.status === 0 && /^24\/24 furui vectors give the expected verdict \(javascript\)$/m.test(vb.stdout), "--bitcoin-header vectors through the nenrin-verify bin");
for (const a of [["furui-day", "2026-11-03", "--leaf", "0", "--bitcoin-header", "--bitcoin-header"], ["furui-day", "--bitcoin-header"],
  ["furui-vectors", bhVectors, "--bitcoin-header"], ["resume-admission", "https://example.org/", "a".repeat(64), "--bitcoin-headers"],
  ["resume-admission", "https://example.org/", "--bitcoin-header"]]) {
  ok(cli(a).status === 2, "usage exit 2: " + a.join(" "));
}
const noExplorer = async (u) => { throw new Error("an explorer was asked without --bitcoin-header: " + u); };
let same = 0, total = 0;
for (const file of [vectors, bhVectors]) {
  for (const c of JSON.parse(readFileSync(file, "utf8")).cases) {
    if (c.command !== "furui-day" && c.command !== "resume-admission") continue;
    const g = worldGet(c.world);
    const r = summary(c.command === "furui-day" ? await furuiDay(c.args.day, c.args.leaf, g, { headerGet: noExplorer, runner: c.args.runner === undefined ? 1 : c.args.runner }) : await resumeAdmission(c.args.endpoint, c.args.record_sha256, g, { headerGet: noExplorer }));
    total++;
    if (c.args.bitcoin_header === true) {
      const f = Object.assign({}, c.expect.facts); delete f.bitcoin_header;
      same += canonical(r.steps) === canonical(c.expect.steps.slice(0, -1)) && canonical(r.facts) === canonical(f) ? 1 : 0;
    } else same += canonical(r) === canonical(c.expect) ? 1 : 0;
  }
}
ok(total > 50 && same === total, "without the flag no explorer is asked and the answer is the flag's answer without its last step (" + same + "/" + total + ")");
for (const u of ["https://ledger.horizonshield.dev/ledger/1", "http://mempool.space/api/block-height/1", "https://mempool.space:8443/api/block-height/1",
  "https://example.org/api/block-height/1", "https://mempool.space.example.org/api/block-height/1"]) {
  let threw = false;
  try { await httpGetExplorer(u); } catch (e) { threw = e instanceof NetError; }
  ok(threw, "explorer host guard refuses " + u);
}
for (const u of ["https://mempool.space/api/block-height/1", "https://blockstream.info/api/block-height/1"]) {
  let threw = false;
  try { await httpGet(u); } catch (e) { threw = e instanceof NetError; }
  ok(threw, "the ledger guard refuses the explorer " + u);
}
console.log(pass + "/" + (pass + fail) + " furui_day tests pass");
process.exit(fail ? 1 : 0);
