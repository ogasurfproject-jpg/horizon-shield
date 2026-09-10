#!/usr/bin/env node
// hs-verify-gate: run every suite in this directory, and let nothing decide the
// verdict except what the suites actually did.
//
// Why this file exists (2026-09-10).
//
// The gate writes a permanent, Bitcoin anchored record every 18:00Z, and the code
// that writes it is whatever was last deployed by hand. Until today there was no
// runner here. Every deploy runbook named a hand picked subset: the 0.4.1 runbook
// ran four of these suites, the 0.4.2 runbook ran four. So "this build passed its
// tests" was a claim about which four somebody chose to type, made by the same hand
// that then ran the deploy.
//
// 0.4.4 showed what that costs. It shipped with an attribution rule that credited a
// card to its operator whenever any signature verified, including one whose key was
// served on a host the operator need not control. It was live for hours. No 18:00Z
// sweep fell in that window, so no false attribution was ever hashed into anchored
// bytes and nobody can ever cite one. That was timing. Timing is not a control.
//
// What this file does not cover, written here rather than left to be discovered: it
// runs the suites that are in this directory. A suite deleted from the directory is
// a suite it will not miss, because it holds no list to miss it from. A stored
// expected count would be a declaration that goes stale, which is the exact defect
// this file exists to remove one level up. The guard against a deleted suite is git:
// a removed file shows in `git status` and in the diff of the commit that removed it.
//
// This file does not deploy and must never learn how. The deploy stays one typed
// command, in a hand that is not this one:
//
//     node test/run_all.mjs && npx wrangler deploy
//
// The `&&` is the whole mechanism, and it is worth more than any flag this file
// could set for itself.

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

console.log("hs-verify-gate: " + suites.length + " suite, per suite timeout " + Math.round(TIMEOUT_MS / 1000) + "s");
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
  console.log("=== " + (results.length - failed.length) + " / " + suites.length + " 通過、" + failed.length + " 不合格 (hs-verify-gate) ===");
  console.log("deploy せんこと。");
  process.exit(1);
}

console.log("=== " + suites.length + " / " + suites.length + " 合格 (hs-verify-gate 全 suite) ===");
console.log("この緑が言えるんは、この directory にある suite が全部通った、それだけや。消された suite はここでは見つからん。git status が見つける。");
process.exit(0);
