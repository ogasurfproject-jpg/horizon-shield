#!/usr/bin/env node
// hs-hearing: run every suite beside this file, and let nothing decide the verdict
// except what the suites actually did.
//
// Why this file exists (2026-09-10). Eight suites sit in this directory and there
// was no way to run them but by name, one at a time, from memory. A suite you have
// to remember to run is a suite that gets forgotten on the day it would have caught
// something. Today it would have: the dispatch debounce added to triggerGeneration
// was wrong on its first write (`env.X || 600000` turns a deliberate 0 back into the
// default, so switching the guard off did nothing) and only its own new suite caught
// it, because that suite happened to be open at the time.
//
// This runner is the same file as workers/hs-verify-gate/test/run_all.mjs, changed
// only in what it discovers. It discovers by suffix rather than from a list, because
// a hand written list is the same defect one level up.
//
// What it does not cover: a suite deleted from this directory is a suite it will not
// miss, because it holds no list to miss it from. That guard belongs to git.
//
// Before deploying this worker:
//
//     node run_all.mjs && npx wrangler deploy
//
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SELF_PATH = fileURLToPath(import.meta.url);
const HERE = path.dirname(SELF_PATH);
const SELF = path.basename(SELF_PATH);
const TIMEOUT_MS = Number(process.env.GATE_SUITE_TIMEOUT_MS || 180000);

// このワーカーの慣習は「<名前>_test.mjs が worker 直下」。拡張子で拾うと自分や
// 道具まで巻き込むので、この repo が実際に使っとる綴りで拾う。
const suites = readdirSync(HERE).filter((f) => f.endsWith("_test.mjs") && f !== SELF).sort();

if (suites.length === 0) {
  console.error("REFUSING TO REPORT: no suite found in " + HERE + ". A runner that finds nothing must not print a pass.");
  process.exit(2);
}

console.log("hs-hearing: " + suites.length + " suite, per suite timeout " + Math.round(TIMEOUT_MS / 1000) + "s");
console.log("");

const results = [];
for (const name of suites) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(HERE, name)], {
    cwd: path.resolve(HERE, ".."),
    timeout: TIMEOUT_MS,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  const secs = Math.round((Date.now() - t0) / 1000);
  const out = ((r.stdout || "") + (r.stderr || "")).replace(/\s+$/, "");
  const lines = out.split("\n").filter((x) => x.trim() !== "");
  const timedOut = r.signal === "SIGTERM" || (r.error && r.error.code === "ETIMEDOUT");

  let reason = null;
  if (timedOut) reason = "timed out after " + secs + "s";
  else if (r.error) reason = "could not run: " + r.error.message;
  else if (r.status !== 0) reason = "exit " + r.status;
  else if (lines.length === 0) reason = "exit 0 but printed nothing, so it proved nothing";

  const summary = [...lines].reverse().find((x) => /合格|PASS|passed|^ok\s/.test(x)) || (lines.length ? lines[lines.length - 1] : "");
  results.push({ name, secs, out, reason, ok: reason === null, summary });

  console.log("  " + name.padEnd(28) + (reason === null ? "合格" : "不合格") + "  " + String(secs).padStart(3) + "s  " + (reason === null ? summary : reason));
}

const failed = results.filter((r) => !r.ok);

// green is DERIVED from the per suite results, never set beside them. A flag that can
// disagree with the list it summarises is a flag that will: found on 2026-09-10 in the
// agreement verifier by mutating that file and watching its suite stay green.
const green = results.length === suites.length && failed.length === 0;

console.log("");

if (!green) {
  for (const r of failed) {
    console.log("--- " + r.name + " (" + r.reason + ") 末尾 20 行");
    console.log(r.out.split("\n").slice(-20).join("\n"));
    console.log("");
  }
  console.log("=== " + (results.length - failed.length) + " / " + suites.length + " 通過、" + failed.length + " 不合格 (hs-hearing) ===");
  console.log("deploy せんこと。");
  process.exit(1);
}

console.log("=== " + suites.length + " / " + suites.length + " 合格 (hs-hearing 全 suite) ===");
console.log("この緑が言えるんは、この directory にある suite が全部通った、それだけや。消された suite はここでは見つからん。git status が見つける。");
process.exit(0);
