// resume_cli.mjs : node runner for the byte-match harness. Injects node:crypto into the core.
//   node resume_cli.mjs --fixtures cases.json
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { assembleResume, Reject } from "./resume_v1.mjs";

const sha256Hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");

if (process.argv[2] !== "--fixtures") { console.error("usage: node resume_cli.mjs --fixtures cases.json"); process.exit(2); }
const cases = JSON.parse(readFileSync(process.argv[3], "utf8")).cases;
const out = [];
for (const c of cases) {
  try {
    const a = c.args;
    const r = await assembleResume(a.perma_id, a.endpoint, a.agent_card_url, a.measurements,
      { rings: a.rings, agreements: a.agreements, period_days: a.period_days, now: a.now, sha256Hex });
    out.push({ name: c.name, ok: true, sha: r.resume_sha256 });
  } catch (e) {
    out.push({ name: c.name, ok: false, code: e instanceof Reject ? e.code : "ERROR:" + e.message });
  }
}
process.stdout.write(JSON.stringify({ results: out }));
