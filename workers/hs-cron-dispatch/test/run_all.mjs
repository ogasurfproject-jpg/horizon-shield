// test/run_all.mjs: every *.test.mjs in this folder, each in its own node process. Exit 1 if any fails.
// Run: node test/run_all.mjs
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(HERE).filter((f) => f.endsWith(".test.mjs")).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(HERE, f)], { encoding: "utf8" });
  const last = (r.stdout || "").trim().split("\n").pop();
  console.log((r.status === 0 ? "ok    " : "FAIL  ") + f + "  " + last);
  if (r.status !== 0) { failed++; process.stdout.write(r.stdout || ""); process.stdout.write(r.stderr || ""); }
}
console.log(files.length - failed + "/" + files.length + " suites passed");
if (failed) process.exit(1);
