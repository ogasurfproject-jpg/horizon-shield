#!/usr/bin/env node
// hs-gateway: run every suite in this directory, and let nothing decide the verdict
// except what the suites actually did.
//
// Why this file exists (2026-09-10). Two suites sit here, harness.mjs (19) and
// do_harness.mjs (13), and the only way to run them was to remember both names.
// Tonight the operator had to run them to check that removing a secret from a URL
// had broken nothing, and the first attempt looked like a failure because the
// command was typed from the worker root instead of test/. A runner removes both
// of those: the names, and the directory.
//
// Same file as workers/hs-verify-gate/test/run_all.mjs and
// workers/hs-hearing/run_all.mjs, changed only in what it discovers.
//
// What it does not cover: a suite deleted from this directory is a suite it will
// not miss, because it holds no list to miss it from. That guard belongs to git.
//
// Before deploying this worker:
//
//     node test/run_all.mjs && npx wrangler deploy
//
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SELF_PATH = fileURLToPath(import.meta.url);
const HERE = path.dirname(SELF_PATH);
const SELF = path.basename(SELF_PATH);
const TIMEOUT_MS = Number(process.env.GATE_SUITE_TIMEOUT_MS || 180000);

const suites = readdirSync(HERE).filter((f) => f.endsWith(".mjs") && f !== SELF).sort();

if (suites.length === 0) {
  console.error("REFUSING TO REPORT: no suite found in " + HERE + ". A runner that finds nothing must not print a pass.");
  process.exit(2);
}

console.log("hs-gateway: " + suites.length + " suite, per suite timeout " + Math.round(TIMEOUT_MS / 1000) + "s");
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
  // 要約は stdout からだけ拾う。2026-09-10: node の "type: module" 警告が stderr の
  // 最後に来る Mac があり、suite の締めの一行の席に警告が座った。合否は exit code から
  // 導いとるので判定は正しかったが、読む人には別の話に見える。落ちたときの本文は
  // 両方まとめて出す。そっちは全部要る。
  const so = (r.stdout || "").replace(/\s+$/, "");
  const out = ((r.stdout || "") + (r.stderr || "")).replace(/\s+$/, "");
  const lines = out.split("\n").filter((x) => x.trim() !== "");
  const solines = so.split("\n").filter((x) => x.trim() !== "");
  const timedOut = r.signal === "SIGTERM" || (r.error && r.error.code === "ETIMEDOUT");

  let reason = null;
  if (timedOut) reason = "timed out after " + secs + "s";
  else if (r.error) reason = "could not run: " + r.error.message;
  else if (r.status !== 0) reason = "exit " + r.status;
  else if (lines.length === 0) reason = "exit 0 but printed nothing, so it proved nothing";

  const pick = (ls) => [...ls].reverse().find((x) => /合格|通過|PASS|passed|^ok\s/.test(x)) || "";
  const summary = pick(solines) || pick(lines)
    || (solines.length ? solines[solines.length - 1] : (lines.length ? lines[lines.length - 1] : ""));
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
  console.log("=== " + (results.length - failed.length) + " / " + suites.length + " 通過、" + failed.length + " 不合格 (hs-gateway) ===");
  console.log("deploy せんこと。");
  process.exit(1);
}

console.log("=== " + suites.length + " / " + suites.length + " 合格 (hs-gateway 全 suite) ===");
console.log("この緑が言えるんは、この directory にある suite が全部通った、それだけや。消された suite はここでは見つからん。git status が見つける。");
process.exit(0);
