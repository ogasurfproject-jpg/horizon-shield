// fake_vs_azurite.mjs  同じ筋書き(parity_run.mjs)を、Table と Blob の偽物(fake_azure.mjs)の上と、Azurite の上で回し、
// 出た物が全部同じバイトかを見る(記録の sha、応答、置き場の中身、webhook、notify、台帳への commitment、乱数と外への呼びの数)。
// 違ってよいのは meta の置き場の数え方(store_kind、storage_ops、table_entities、chunked_entities)だけ。
// 使い方: node test/parity/fake_vs_azurite.mjs <workers/hs-verify-gate の dir>
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const gateDir = process.argv[2];
const run = (mode, azurite) => {
  const env = { ...process.env };
  if (azurite) env.PARITY_STORE = "azurite"; else delete env.PARITY_STORE;
  const r = spawnSync(process.execPath, ["--no-warnings", path.join(HERE, "parity_run.mjs"), gateDir, mode], { encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
  if (r.status !== 0) throw new Error(mode + " failed: " + (r.stderr || "").slice(0, 1500));
  const o = JSON.parse(r.stdout);
  const kind = o.meta.store_kind;
  for (const k of ["store_kind", "storage_ops", "table_entities", "chunked_entities"]) delete o.meta[k];
  return { o, kind };
};
let pass = 0, fail = 0;
for (const mode of ["azure", "azure-plain"]) {
  const f = run(mode, false), a = run(mode, true);
  const same = JSON.stringify(f.o) === JSON.stringify(a.o);
  same ? pass++ : fail++;
  const diffs = Object.keys(f.o).filter((k) => JSON.stringify(f.o[k]) !== JSON.stringify(a.o[k]));
  console.log((same ? "  ok   " : "  FAIL ") + mode + ": " + f.kind + " and " + a.kind + " give the same bytes for every output (records " +
    f.o.records.map((r) => r.record_sha256.slice(0, 12)).join(", ") + "; store " + f.o.store.length + " keys)" + (same ? "" : "  <- differs in " + diffs.join(",")));
}
console.log("=== parity fake vs azurite: " + pass + " / " + (pass + fail) + (fail ? "  FAIL" : "  ok") + " ===");
process.exit(fail ? 1 : 0);
