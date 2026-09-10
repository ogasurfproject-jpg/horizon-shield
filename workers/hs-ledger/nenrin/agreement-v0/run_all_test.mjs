// RUN_ALL: suite
// run_all.mjs 自身の試験。
//
// なぜこれが要るか (2026-09-10)。
//
// run_all.mjs は「名乗っとらん file が 1 つでもあったら回さずに断る」で立っとる。
// その断りが効かんかったら、新しい試験を足したのに回っとらん、という一番よくある
// 穴がそのまま開いたまま、緑が出る。番人を番する者が要る。
//
// 本物の suite は使わん。作業場に偽物の suite を並べて、そこで run_all.mjs を回す。
// 偽物やから速いし、本物が緑か赤かに左右されん。ここで測るんは run_all の判断だけや。
//
// 覆っとらんもの: 本物の 11 本が本当に緑かは、ここでは分からん。それは run_all を
// 実際に回して見ること。この file が言えるんは「run_all の判断は正しい」だけ。
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_SRC = readFileSync(path.join(HERE, "run_all.mjs"), "utf8");

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log("ok   " + name); }
  else { fail++; console.log("NG   " + name + (detail !== undefined ? "  " + detail : "")); }
};

const GREEN = (n) => "// RUN_ALL: suite\nconsole.log('=== " + n + " 合格 ===');\n";
const RED = "// RUN_ALL: suite\nconsole.log('NG こける');\nprocess.exit(1);\n";
const MUTE = "// RUN_ALL: suite\nprocess.exit(0);\n";
const LIB = "// RUN_ALL: library  ただの部品\nexport const x = 1;\n";
const SILENT = "export const x = 1;\n";
const TWO = "#!/usr/bin/env python3\n# RUN_ALL: suite --selftest\n# RUN_ALL: suite --check\n"
  + "import sys\nprint('=== ' + (' '.join(sys.argv[1:]) or 'none') + ' 合格 ===')\n";
const BANANA = "// RUN_ALL: banana\nexport const x = 1;\n";
const ARGSNOTE = "// RUN_ALL: suite --selftest    これは人が読む但し書きで、引数やない\n"
  + "console.log('=== argv=' + process.argv.slice(2).join(',') + ' 合格 ===');\n";

const run = (files) => {
  const d = mkdtempSync(path.join(os.tmpdir(), "run-all-test-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(d, name), body);
  writeFileSync(path.join(d, "run_all.mjs"), RUNNER_SRC);
  const r = spawnSync(process.execPath, [path.join(d, "run_all.mjs")], {
    cwd: d, encoding: "utf8", timeout: 60000,
  });
  rmSync(d, { recursive: true, force: true });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
};
{
  const r = run({ "a_test.mjs": GREEN(3), "b_test.mjs": GREEN(4), "lib.mjs": LIB });
  t("名乗っとる suite が全部緑なら 0", r.status === 0, r.status + "  " + r.out.slice(-200));
  t("library は回さん", !/lib\.mjs\s+合格/.test(r.out));
  t("何本回したか出る", /2 \/ 2 合格/.test(r.out), r.out.slice(-160));
}
{
  const r = run({ "a_test.mjs": GREEN(3), "silent.mjs": SILENT });
  t("名乗っとらん file が 1 つでもあったら 2 で断る", r.status === 2, r.status);
  t("その file の名前を言う", /silent\.mjs/.test(r.out), r.out.slice(-200));
  t("断ったときは 1 本も回しとらん", !/合格/.test(r.out.split("★")[1] || ""));
}
{
  const r = run({ "a_test.mjs": GREEN(3), "b_test.mjs": RED });
  t("赤い suite が 1 本あったら 1", r.status === 1, r.status);
  t("赤い方の名前と末尾を出す", /b_test\.mjs/.test(r.out) && /こける/.test(r.out));
}
{
  const r = run({ "a_test.mjs": GREEN(3), "mute.mjs": MUTE });
  t("exit 0 でも何も書かんかったら不合格", r.status === 1, r.status);
  t("理由を言う", /何も証明しとらん/.test(r.out), r.out.slice(-200));
}
{
  const r = run({ "two.py": TWO });
  t("1 つの file に RUN_ALL が 2 本あったら 2 回回す", r.status === 0 && /2 \/ 2 合格/.test(r.out), r.out.slice(-200));
  t("引数はそれぞれ渡る", /--selftest 合格/.test(r.out) && /--check 合格/.test(r.out), r.out.slice(-300));
}
{
  const r = run({ "argsnote.mjs": ARGSNOTE });
  t("空白 2 つより後ろは但し書きで、引数にせん",
    r.status === 0 && /argv=--selftest 合格/.test(r.out), r.out.slice(-200));
}
{
  const r = run({ "banana.mjs": BANANA });
  t("知らん語で名乗ったら断る", r.status === 2 && /banana/.test(r.out), r.status + " " + r.out.slice(-200));
}
{
  const d = mkdtempSync(path.join(os.tmpdir(), "run-all-test-"));
  writeFileSync(path.join(d, "run_all.mjs"), RUNNER_SRC);
  const r = spawnSync(process.execPath, [path.join(d, "run_all.mjs")], { cwd: d, encoding: "utf8", timeout: 60000 });
  rmSync(d, { recursive: true, force: true });
  t("suite が 1 本も無かったら合格を出さん", r.status === 2, r.status);
}
{
  const r = run({ "lib1.mjs": LIB, "lib2.mjs": LIB });
  t("library だけで suite が無かったら断る", r.status === 2, r.status + " " + r.out.slice(-160));
}

console.log("");
console.log("=== " + pass + " / " + (pass + fail) + (fail ? " 不合格あり" : " 合格")
  + " (run_all 自身の試験) ===");
process.exit(fail ? 1 : 0);
