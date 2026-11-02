// Prints, for each case of a vectors or mutations file, one line: the canonical JSON of what furui_day.mjs answers.
//   node furui_runner.mjs <furui_day.mjs path> <cases.json>
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const m = await import(pathToFileURL(process.argv[2]).href);
const doc = JSON.parse(readFileSync(process.argv[3], "utf8"));
const out = [];
for (const c of doc.cases) {
  let line;
  try { line = m.canonical(await m.runCase(c)); } catch (e) { line = "THREW " + (e && e.constructor && e.constructor.name); }
  out.push(line);
}
process.stdout.write(out.join("\n") + "\n");
