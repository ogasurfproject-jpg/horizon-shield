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
const WIPRED = "// RUN_ALL: wip    まだ途中\n"
  + "console.log('=== 4 / 5 不合格あり (これは vector の数で、点やない) ===');\n"
  + "console.log('SCORE: 一致 3 / 100');\n"
  + "console.log('=== 4 / 5 不合格あり (最後に来る紛らわしい行) ===');\nprocess.exit(1);\n";
const WIPGREEN = "// RUN_ALL: wip\nconsole.log('SCORE: 一致 100 / 100');\nprocess.exit(0);\n";
const WIPMUTE = "// RUN_ALL: wip\nconsole.log('--- 一致 3 / 100 ---');\nprocess.exit(1);\n";
const ARGV = "console.log('=== argv=' + (process.argv.slice(2).join(',') || '(無し)') + ' 合格 ===');\n";
const ARGSNOTE = "// RUN_ALL: suite --selftest    これは人が読む但し書きで、引数やない\n" + ARGV;
const NOTEONLY = "// RUN_ALL: suite    長い (百秒ほど)。書き換えて、また戻す\n" + ARGV;
const TWOFLAGS = "// RUN_ALL: suite --aa --bb   ここから但し書き\n" + ARGV;

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
  t("引数の後ろの但し書きは、引数にせん",
    r.status === 0 && /argv=--selftest 合格/.test(r.out), r.out.slice(-200));
}
{
  // 見つけ方: 2026-09-10、TOshi の画面に
  //   agreement_mutation.py 長い (百秒ほど)。agreement_verify.py を書き換えて、また戻す合格 168s
  // と出とった。但し書きが丸ごと引数として渡っとった。あの tool は argv を見んから
  // 無事やっただけで、agreement_canonical_test.mjs は argv[2] を fixture の path に使う。
  // 但し書きを一行足したら、無い file を読みに行って壊れとった。
  const r = run({ "noteonly.mjs": NOTEONLY });
  t("引数が無うて但し書きだけの行で、但し書きが引数にならん",
    r.status === 0 && /argv=\(無し\) 合格/.test(r.out), r.out.slice(-260));
  // これは「但し書きがどこかに出とる」やと弱い。古い runner でも、但し書きが
  // label にめり込んだまま出とったから通ってまう。見るべきは、結果の行に
  // 但し書きが混じっとらんことの方や。
  const resultLine = r.out.split("\n").find((l) => /noteonly\.mjs/.test(l) && /合格|不合格/.test(l)) || "";
  t("結果の行に但し書きが混じらん", !/長い/.test(resultLine), resultLine.slice(0, 120));
  const noteLine = r.out.split("\n").find((l) => / は 長い \(百秒ほど\)/.test(l)) || "";
  t("但し書きは走り出す前に、別の行で出る", noteLine !== "" && !/合格/.test(noteLine), noteLine.slice(0, 120));
}
{
  const r = run({ "twoflags.mjs": TWOFLAGS });
  t("頭から続く「-」の語は全部引数",
    r.status === 0 && /argv=--aa,--bb 合格/.test(r.out), r.out.slice(-220));
}
{
  const r = run({ "a_test.mjs": GREEN(1) });
  t("但し書きが無い suite は但し書きの行も出さん", !/ は /.test(r.out.split("\n")[1] || ""), r.out.slice(0, 160));
}
{
  // 採点中の物。赤くても合否には数えん。かというて黙らせもせん。
  // (2026-09-10、検証器の 2 つ目の実装が 0 / 5,221 から始まるから足した。赤いまま
  //  何日も置いたら人は赤を見んようになるし、一覧から外したら見えんようになる。)
  const r = run({ "a_test.mjs": GREEN(2), "wip.mjs": WIPRED });
  t("採点中の物が赤くても、全体は緑で終わる", r.status === 0, r.status + " " + r.out.slice(-200));
  t("採点中の物も必ず走らせて点を出す", /wip\.mjs\s+採点中\s+.*3 \/ 100/.test(r.out), r.out.slice(-320));
  // 見つけ方: 2026-09-10、runner が点を嗅ぎ当てる作りやったとき、採点板の最後の
  // "=== 4 / 5 不合格あり ===" を点として拾うた。あれは vector の数で、件数は
  // 0 / 5,221 やった。8 割できとるように読める行が 0% の場所に座っとった。
  t("紛らわしい行やのうて、名乗った点を読む",
    !/4 \/ 5/.test((r.out.split("\n").find((l) => /wip\.mjs\s+採点中/.test(l)) || "")),
    (r.out.split("\n").find((l) => /wip\.mjs\s+採点中/.test(l)) || "").slice(0, 120));
  t("緑の下の行も、名乗った点を読む",
    !/4 \/ 5/.test((r.out.split("\n").find((l) => /★ この緑は/.test(l)) || "")),
    (r.out.split("\n").find((l) => /★ この緑は/.test(l)) || "").slice(0, 120));
  t("緑の行のすぐ後で、何を含んでへんかを言う",
    /★ この緑は wip\.mjs を含んでへん。採点中: .*3 \/ 100/.test(r.out), r.out.slice(-320));
  t("採点中の物は suite の数に入っとらん", /1 \/ 1 合格/.test(r.out), r.out.slice(-260));
  t("頭にも採点中が何本あるか出る", /採点中 1 本/.test(r.out), r.out.split("\n")[0]);
}
{
  const r = run({ "a_test.mjs": RED, "wip.mjs": WIPRED });
  t("全体が赤いときも、採点中の点は出す", r.status === 1 && /★ この数は wip\.mjs を含んでへん/.test(r.out),
    r.status + " " + r.out.slice(-260));
}
{
  const r = run({ "wip.mjs": WIPGREEN });
  t("採点中しか無かったら、suite が無いとして断る", r.status === 2, r.status + " " + r.out.slice(-200));
}
{
  // 点を名乗らん wip は、緑の外に隠れとるだけの物になる。断る。
  const r = run({ "a_test.mjs": GREEN(2), "wip.mjs": WIPMUTE });
  t("点を名乗らん採点中は断る", r.status === 2, r.status + " " + r.out.slice(-260));
  t("その file の名前と、何を出すかを言う",
    /wip\.mjs/.test(r.out) && /SCORE:/.test(r.out), r.out.slice(-320));
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
