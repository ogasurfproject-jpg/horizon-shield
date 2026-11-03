// furui_day.test.mjs: the shared vectors (../furui-check-day-v0/verify_vectors.json), the CLI's usage and exit codes,
// and the host guard. No network: every case reads its own world.
//   node furui_day.test.mjs
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runVectors, httpGet, NetError } from "./furui_day.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const vectors = join(here, "..", "furui-check-day-v0", "verify_vectors.json");
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
console.log(pass + "/" + (pass + fail) + " furui_day tests pass");
process.exit(fail ? 1 : 0);
