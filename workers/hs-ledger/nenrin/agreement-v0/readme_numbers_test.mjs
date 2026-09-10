// RUN_ALL: suite
// README が言うとる数を、その場で数え直す。
//
// なぜこれが要るか (2026-09-10)。
//
// README の表に「818 values」と書いてあった。本当は 831 やった。敵に vector を足して
// 契約を作り直した時に増えとって、prose の方だけが古いまま残った。誰も損はせんかった
// が、これは この repository が何度も踏んどる型そのものや: **証拠の横に置いた主張は、
// いつか証拠と食い違う。** 置くなら導く。導けんなら、導けんと書く。
//
// ここで数えるんは、README の表と本文に出てくる数のうち、file か suite から導ける物
// だけや。導けん物は下に名前を書いてある。書いてある物は、この suite が見張っとらん。
//
// Run: node readme_numbers_test.mjs
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { MUTANTS as CANON_MUTANTS } from "./agreement_canonical_mutation.mjs";
import { MUTANTS as VERIFY_MUTANTS } from "./agreement_verify_mutation.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const README = readFileSync(path.join(HERE, "README.md"), "utf8");

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log("ok   " + name); }
  else { fail++; console.log("NG   " + name + (detail !== undefined ? "  " + detail : "")); }
};

const j = (f) => JSON.parse(readFileSync(path.join(HERE, f), "utf8"));
const num = (n) => n.toLocaleString("en-US");

// suite を 1 本走らせて "=== a / b" の a を拾う
const suiteCount = (cmd, args) => {
  const r = spawnSync(cmd, args.map((a) => (a.endsWith(".mjs") || a.endsWith(".py") ? path.join(HERE, a) : a)),
    { cwd: HERE, encoding: "utf8", timeout: 120000 });
  const m = /===\s*(\d+)\s*\/\s*(\d+)/.exec(r.stdout || "");
  return m ? { got: Number(m[1]), of: Number(m[2]), ok: r.status === 0 } : null;
};

const env = j("agreement_vectors_v1.json");
const cases = JSON.parse(inflateSync(Buffer.from(env.payload, "base64")).toString("utf8")).cases.length;
const strings = j("agreement_strings_v1.json");

const CHECKS = [
  ["契約の件数", cases, [num(cases) + " inputs and the report", num(cases) + " frozen cases", num(cases) + " notice", num(cases) + " inputs and gave"]],
  ["repr の表", j("agreement_pyrepr_v1.json").count, [num(j("agreement_pyrepr_v1.json").count) + " values beside"]],
  ["float の表", j("agreement_float_repr_v1.json").count, [num(j("agreement_float_repr_v1.json").count) + " doubles as raw bits", num(j("agreement_float_repr_v1.json").count) + " doubles that Python"]],
  ["読み口の表", j("agreement_readback_v1.json").count, [num(j("agreement_readback_v1.json").count) + " pieces of JSON text", num(j("agreement_readback_v1.json").count) + " pieces of text"]],
  ["文言の型", strings.template_count, [String(strings.template_count) + " sentence templates"]],
  ["断り code の数", strings.refusal_codes, [strings.refusal_codes + " refusal codes"]],
  ["canonical の変異", CANON_MUTANTS.length, [CANON_MUTANTS.length + " ways", CANON_MUTANTS.length + " deliberate breakages"]],
  ["検証規則の変異", VERIFY_MUTANTS.length, [VERIFY_MUTANTS.length + " ways and checks"]],
];

for (const [what, value, phrases] of CHECKS) {
  const found = phrases.filter((p) => README.includes(p));
  t("README の「" + what + "」は " + num(value) + " と一致しとる", found.length > 0,
    "この言い回しが見当たらん: " + JSON.stringify(phrases));
}

// 走らせて数えるもの
for (const [what, cmd, args, phrase] of [
  ["canonical の試験", process.execPath, ["agreement_canonical_test.mjs"], (n) => n + " checks:"],
  ["runner 自身の試験", process.execPath, ["run_all_test.mjs"], (n) => n + " checks on the runner"],
  ["敵の vector", "python3", ["agreement_redteam.py"], (n) => n + " vectors:"],
]) {
  const r = suiteCount(cmd, args);
  if (!r) { t("README の「" + what + "」を数える", false, "suite の締めの行が読めん"); continue; }
  t("README の「" + what + "」は " + r.of + " と一致しとる", README.includes(phrase(r.of)),
    "README に " + JSON.stringify(phrase(r.of)) + " が無い");
}

// python の変異は走らせると 3 分かかる。一覧の長さだけ import して数える。
{
  const r = spawnSync("python3", ["-c", "import sys; sys.path.insert(0, '" + HERE + "'); import agreement_mutation as m; print(len(m.MUTANTS))"],
    { cwd: HERE, encoding: "utf8", timeout: 60000 });
  const n = Number((r.stdout || "").trim());
  t("README の「python の変異」は " + n + " と一致しとる",
    Number.isFinite(n) && n > 0 && README.includes(n + " mutants"), r.stdout + r.stderr);
}

console.log("");
console.log("見張っとらん数: 契約の sha、20.4 MB という丸めた言い方、attack と control の内訳、");
console.log("               2^70 が 376 個という数、それと本文の日付。ここは人が読む物や。");
console.log("");
console.log("=== " + pass + " / " + (pass + fail) + (fail ? " 不合格あり" : " 合格")
  + " (README の数) ===");
process.exit(fail ? 1 : 0);
