#!/usr/bin/env node
// run_tests.mjs  この folder の試験を全部回す。Azurite を 127.0.0.1 の空いた port で、memory の中だけで立て(telemetry は切る)、
// 終わったら止める。網には出ない(Azurite も試験も 127.0.0.1 だけに繋ぐ)。
//   1. adapter.test.mjs            adapter の単体(Azurite)
//   2. parity/parity.test.mjs      筋書きの比べ(Cloudflare の偽物 と Azurite)
//   3. parity/fake_vs_azurite.mjs  Table の偽物 と Azurite で、出た物が全部同じバイトか
//   4. entry.test.mjs              入口(関数を直に呼ぶ。Functions の host の上ではない)と、束ねた dist/main.cjs
//   5. 扉の既存の試験(../hs-verify-gate/test/run_all.mjs)を、KV と DO を Table の adapter に替えて(swap/register.mjs)
//   6. Marketplace の試験(../hs-ms-marketplace/test/worker.test.mjs)を、MS_SUBS を Table の adapter に替えて
// 5 と 6 は、替えない回(基準)も回して、落ちた行が同じかを比べる。
// 使い方: node build.mjs && node test/run_tests.mjs [出力の dir]     1 つでも落ちたら exit 1

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const GATE = path.resolve(ROOT, "../hs-verify-gate");
const MS = path.resolve(ROOT, "../hs-ms-marketplace");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "test_output"));
mkdirSync(OUT, { recursive: true });

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); s.on("error", rej); });
const waitPort = async (port, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const ok = await new Promise((res) => { const c = net.connect(port, "127.0.0.1", () => { c.end(); res(true); }); c.on("error", () => res(false)); });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};

const [bp, qp, tp] = [await freePort(), await freePort(), await freePort()];
const azuriteDir = path.join(OUT, ".azurite");
mkdirSync(azuriteDir, { recursive: true });
const az = spawn(path.join(ROOT, "node_modules", ".bin", "azurite"), [
  "--silent", "--inMemoryPersistence", "--disableTelemetry", "--skipApiVersionCheck",
  "--blobHost", "127.0.0.1", "--blobPort", String(bp), "--queueHost", "127.0.0.1", "--queuePort", String(qp), "--tableHost", "127.0.0.1", "--tablePort", String(tp),
], { cwd: azuriteDir, stdio: ["ignore", "pipe", "pipe"] });
let azLog = "";
az.stdout.on("data", (d) => { azLog += d; }); az.stderr.on("data", (d) => { azLog += d; });
const stopAzurite = () => { try { az.kill("SIGTERM"); } catch (_e) {} };
process.on("exit", stopAzurite);
if (!(await waitPort(tp, 30000)) || !(await waitPort(bp, 30000))) { console.error("azurite did not start: " + azLog.slice(0, 500)); process.exit(2); }

const AZURITE_CS = "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;" +
  "AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;" +
  "TableEndpoint=http://127.0.0.1:" + tp + "/devstoreaccount1;BlobEndpoint=http://127.0.0.1:" + bp + "/devstoreaccount1;";
const baseEnv = { ...process.env, AZURITE_CS };
delete baseEnv.NODE_OPTIONS;

const results = [];
function step(name, file, args, { cwd = ROOT, env = {}, expectFail = false } = {}) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ["--no-warnings", ...args], { cwd, env: { ...baseEnv, ...env }, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 900_000 });
  const text = (r.stdout || "") + (r.stderr ? "\n--- stderr\n" + r.stderr : "");
  writeFileSync(path.join(OUT, file), text);
  const last = (r.stdout || "").trim().split("\n").filter((l) => /===|ALL PASS|通過|合格/.test(l)).pop() || "";
  results.push({ name, file, exit: r.status, secs: Math.round((Date.now() - t0) / 1000), last });
  console.log((r.status === 0 || expectFail ? "  done " : "  FAIL ") + name.padEnd(46) + " exit " + r.status + "  " + last.slice(0, 120));
  return { status: r.status, text };
}

console.log("azurite 127.0.0.1 blob " + bp + " table " + tp + " (in memory, telemetry off)");
step("1 adapter on Azurite", "1_adapter.txt", ["test/adapter.test.mjs"]);
step("2 parity cf fakes vs Azurite", "2_parity_azurite.txt", ["test/parity/parity.test.mjs", GATE], { env: { PARITY_STORE: "azurite" } });
step("3 parity Table fake vs Azurite", "3_parity_fake_vs_azurite.txt", ["test/parity/fake_vs_azurite.mjs", GATE]);
step("4 entry, functions called directly", "4_entry.txt", ["test/entry.test.mjs"]);

// 5, 6: 基準(替えない)と Table(替える)
const ngLines = (text) => text.split("\n").filter((l) => /^\s*(NG|FAIL)\b/.test(l)).sort();
const statsFile = path.join(OUT, "5_swap_stats.jsonl");
if (existsSync(statsFile)) rmSync(statsFile);
const g0 = step("5a gate run_all, baseline (no swap)", "5a_gate_baseline.txt", ["test/run_all.mjs"], { cwd: GATE, env: { GATE_SUITE_TIMEOUT_MS: "120000" }, expectFail: true });
const g1 = step("5b gate run_all, KV and DO on Azurite", "5b_gate_on_table.txt", ["test/run_all.mjs"], { cwd: GATE, env: { GATE_SUITE_TIMEOUT_MS: "120000", NODE_OPTIONS: "--import " + path.join(HERE, "swap", "register.mjs"), SWAP_STATS_FILE: statsFile }, expectFail: true });
const sameNg = JSON.stringify(ngLines(g0.text)) === JSON.stringify(ngLines(g1.text));
const msStats = path.join(OUT, "6_swap_stats.jsonl");
if (existsSync(msStats)) rmSync(msStats);
const m0 = step("6a marketplace, baseline", "6a_ms_baseline.txt", ["test/worker.test.mjs"], { cwd: MS });
const m1 = step("6b marketplace, MS_SUBS on Azurite", "6b_ms_on_table.txt", ["test/worker.test.mjs"], { cwd: MS, env: { NODE_OPTIONS: "--import " + path.join(HERE, "swap", "register.mjs"), SWAP_STATS_FILE: msStats } });

const tally = (text) => { const m = /=== (\d+) \/ (\d+) 通過/.exec(text); return m ? m[1] + "/" + m[2] : "?"; };
const stats = existsSync(statsFile) ? readFileSync(statsFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const sum = {}; for (const s of stats) for (const [k, v] of Object.entries(s)) if (typeof v === "number") sum[k] = (sum[k] || 0) + v;
const summary = [
  "gate suites baseline " + tally(g0.text) + ", on Azurite tables " + tally(g1.text) + "; the failing lines are " + (sameNg ? "the same" : "DIFFERENT") + " (" + ngLines(g1.text).length + ")",
  "gate swap totals over " + stats.length + " processes: " + JSON.stringify(sum),
  "suites whose KV went to Table: " + [...new Set(stats.filter((s) => s.kv_swapped).map((s) => s.suite))].length + ", whose lease went to Table: " + [...new Set(stats.filter((s) => s.do_swapped).map((s) => s.suite))].join(","),
  "mismatch (orig fake vs Table answer): " + JSON.stringify(stats.filter((s) => s.kv_get_mismatch || s.kv_list_mismatch || s.do_mismatch).map((s) => [s.suite, s.kv_get_mismatch, s.kv_list_mismatch, s.do_mismatch, s.mismatch_examples.slice(0, 2)])),
  "marketplace baseline exit " + m0.status + ", on Azurite exit " + m1.status + ": " + ((m1.text.match(/ALL PASS \(\d+\)/) || [""])[0]),
];
const bad = results.filter((r) => !r.name.startsWith("5") && r.exit !== 0).length + (sameNg ? 0 : 1);
const report = ["run_tests " + new Date().toISOString() + " node " + process.version, ...results.map((r) => r.name + "  exit " + r.exit + "  " + r.secs + "s  " + r.last), "", ...summary, "", bad ? "RESULT: FAIL" : "RESULT: ok"].join("\n") + "\n";
writeFileSync(path.join(OUT, "SUMMARY.txt"), report);
console.log("\n" + summary.join("\n") + "\n" + (bad ? "RESULT: FAIL" : "RESULT: ok"));
stopAzurite();
rmSync(azuriteDir, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
