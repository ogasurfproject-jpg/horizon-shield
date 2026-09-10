#!/usr/bin/env node
// RUN_ALL: runner
// agreement-v0: この directory の suite を全部回して、判定は suite がやったことだけから出す。
//
// なぜこれが要るか (2026-09-10)。
//
// ここには今 8 本の道具があって、試験の入口が 11 個ある。python が 9 個、node が 2 個。
// 名前も引数もばらばらで、全部憶えとる人間だけが「緑や」と言える状態やった。今日
// agreement_float_repr_v1.json と agreement_readback_v1.json という、python に書かせた
// 表が二つ増えた。表は python が変わったら黙ってずれる。--check を回す者が居らんかったら、
// ずれたまま緑に見える。それを回すのが、この file の一番の仕事や。
//
// 兄弟 (hs-verify-gate/test, hs-hearing, hs-gateway) との違いは、見つけ方や。
// 向こうは「この directory の .mjs は全部 suite」でよかった。ここは library と suite と
// 表が混じっとる。せやから拡張子では決めん。**file 自身に名乗らせる。**
//
//     # RUN_ALL: suite --selftest      その引数で回す。1 つの file に何本あってもええ
//     # RUN_ALL: library               suite やない。回さん
//     # RUN_ALL: runner                この file
//
// そして、.py と .mjs で名乗っとらん file が 1 つでもあったら、**回さずに断る。**
// 名乗り忘れを黙って飛ばす作りやと、新しい試験を足したのに回っとらん、という
// 一番よくある穴がそのまま開く。足した人に決めさせる。決めるまで緑は出さん。
//
//     node run_all.mjs
//
// 覆っとらんもの: この directory から消された suite は、ここでは見つからん。持っとる
// 一覧が無いんやから、欠けたことに気付きようが無い。それは git の仕事や。
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SELF_PATH = fileURLToPath(import.meta.url);
const HERE = path.dirname(SELF_PATH);
const SELF = path.basename(SELF_PATH);
const TIMEOUT_MS = Number(process.env.AGREEMENT_SUITE_TIMEOUT_MS || 300000);
const MARK = /^\s*(?:#|\/\/)\s*RUN_ALL:\s*(\S+)(.*)$/;

const files = readdirSync(HERE)
  .filter((f) => (f.endsWith(".py") || f.endsWith(".mjs")) && f !== SELF)
  .sort();

if (files.length === 0) {
  console.error("★ 拒否: " + HERE + " に .py も .mjs も無い。何も見つけとらん runner が合格を出したらあかん。");
  process.exit(2);
}

const suites = [];
const libraries = [];
const silent = [];

for (const f of files) {
  const lines = readFileSync(path.join(HERE, f), "utf8").split("\n").slice(0, 120);
  const marks = [];
  for (const line of lines) {
    const m = MARK.exec(line);
    if (m) marks.push([m[1], m[2].trim()]);
  }
  if (marks.length === 0) { silent.push(f); continue; }
  for (const [kind, rest] of marks) {
    if (kind === "suite") {
      // 引数は最初の空白 2 つより前まで。後ろは人が読む用の但し書き。
      const args = rest.split(/\s{2,}/)[0].trim();
      suites.push({ file: f, args: args ? args.split(/\s+/) : [] });
    } else if (kind === "library" || kind === "runner") {
      libraries.push(f);
    } else {
      silent.push(f + " (RUN_ALL: " + kind + " は知らん語)");
    }
  }
}

if (silent.length) {
  console.error("★ 拒否: 名乗っとらん file がある。suite か library か、足した人が決めること。");
  for (const f of silent) console.error("        " + f);
  console.error("");
  console.error('        先頭 120 行のどこかに 1 行入れる:  # RUN_ALL: suite --selftest');
  console.error('                                          # RUN_ALL: library');
  process.exit(2);
}

if (suites.length === 0) {
  console.error("★ 拒否: suite が 1 本も無い。");
  process.exit(2);
}

const label = (s) => s.file + (s.args.length ? " " + s.args.join(" ") : "");
const runner = (f) => (f.endsWith(".py") ? "python3" : process.execPath);

console.log("agreement-v0: " + suites.length + " suite (" + libraries.length + " library)、"
  + "1 本あたりの制限時間 " + Math.round(TIMEOUT_MS / 1000) + "s");
console.log("mutation を 2 本抱えとるから、全部で 3 分から 4 分かかる。");
console.log("");

const results = [];
const wall0 = Date.now();
for (const s of suites) {
  const t0 = Date.now();
  const r = spawnSync(runner(s.file), [path.join(HERE, s.file), ...s.args], {
    cwd: HERE, timeout: TIMEOUT_MS, encoding: "utf8", maxBuffer: 128 * 1024 * 1024,
  });
  const secs = Math.round((Date.now() - t0) / 1000);
  const so = (r.stdout || "").replace(/\s+$/, "");
  const out = ((r.stdout || "") + (r.stderr || "")).replace(/\s+$/, "");
  const lines = out.split("\n").filter((x) => x.trim() !== "");
  const solines = so.split("\n").filter((x) => x.trim() !== "");
  const timedOut = r.signal === "SIGTERM" || (r.error && r.error.code === "ETIMEDOUT");

  let reason = null;
  if (timedOut) reason = "timed out after " + secs + "s";
  else if (r.error) reason = "could not run: " + r.error.message;
  else if (r.status !== 0) reason = "exit " + r.status;
  else if (lines.length === 0) reason = "exit 0 やのに何も書かんかった。何も証明しとらん";

  const pick = (ls) => [...ls].reverse().find((x) => /合格|一致|通過|PASS|passed/.test(x)) || "";
  const summary = pick(solines) || pick(lines)
    || (solines.length ? solines[solines.length - 1] : (lines.length ? lines[lines.length - 1] : ""));
  results.push({ name: label(s), secs, out, reason, ok: reason === null, summary });

  console.log("  " + label(s).padEnd(38) + (reason === null ? "合格" : "不合格")
    + "  " + String(secs).padStart(3) + "s  " + (reason === null ? summary.slice(0, 80) : reason));
}

const failed = results.filter((r) => !r.ok);

// 緑は per suite の結果から**導く**。横に置いた旗は、いつか一覧と食い違う。
// 2026-09-10 に検証器で実際に食い違うのを見た。
const green = results.length === suites.length && failed.length === 0;
const wall = Math.round((Date.now() - wall0) / 1000);

console.log("");

if (!green) {
  for (const r of failed) {
    console.log("--- " + r.name + " (" + r.reason + ") 末尾 25 行");
    console.log(r.out.split("\n").slice(-25).join("\n"));
    console.log("");
  }
  console.log("=== " + (results.length - failed.length) + " / " + suites.length + " 通過、"
    + failed.length + " 不合格 (agreement-v0、" + wall + "s) ===");
  process.exit(1);
}

console.log("=== " + suites.length + " / " + suites.length + " 合格 (agreement-v0 全 suite、" + wall + "s) ===");
console.log("この緑が言えるんは、この directory で名乗っとる suite が全部通った、それだけや。");
console.log("消された suite はここでは見つからん。git status が見つける。");
process.exit(0);
