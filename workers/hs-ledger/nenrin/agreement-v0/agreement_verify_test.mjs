// RUN_ALL: wip    5,221 / 5,221 になるまで合否には数えん。点は毎回出る
// 採点板。5,221 件を JavaScript の検証器に通して、凍った報告書とバイトで突き合わせる。
//
// なぜ規則より先にこれを作るか (2026-09-10)。
//
// 規則を先に書いてから採点板を作ると、採点板は「今書いた物が通る形」に寄る。順番が
// 逆やと、採点板は 0 点から始まって、規則が入るたびに点が増える。増えん規則は入っと
// らんのと同じや。canonical のときと同じ順番で、同じ理由や。
//
// 点の付け方は 1 つだけ。**JavaScript の報告書の canonical バイトが、凍った報告書の
// canonical バイトと 1 バイトも違わんか。** verdict が合うとるとか、refusal の数が
// 合うとるとかでは点をやらん。報告書は丸ごと 1 つの答えや。
//
// 5,221 / 5,221 でないうちは、この suite は必ず赤で終わる。途中経過に緑は無い。
// 「今 3,900 件通っとる」は進捗であって合格やない。両方を同時に言えるように、点数は
// 必ず出すが、exit code は満点以外は 1 や。
//
// 進み方を決めるのもこの file の仕事や。合わんかった件を「最初に食い違う鍵」で束ね、
// 多い順に出す。次にどの規則を書くかは、読んで決めるんやのうて、ここが決める。
//
// Run: node agreement_verify_test.mjs
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { canonicalAscii, canonicalUtf8, parseStrict } from "./agreement_canonical.mjs";
import { verify, sha256Hex, pyRepr, VERIFIER_VERSION, REPORT_SCHEMA } from "./agreement_verify.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = process.argv[2] || path.join(HERE, "agreement_vectors_v1.json");
const PYREPR = path.join(HERE, "agreement_pyrepr_v1.json");

const env = JSON.parse(readFileSync(FIXTURE, "utf8"));
const payload = inflateSync(Buffer.from(env.payload, "base64")).toString("utf8");
const doc = parseStrict(payload);
const cases = doc.cases;

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log("ok   " + name); }
  else { fail++; console.log("NG   " + name + (detail !== undefined ? "  " + detail : "")); }
};

// 契約が何を名乗っとるかを、こちらの定数と突き合わせる。ここがずれとったら
// 5,221 件が全部ずれるから、先に言うたる。
{
  const v = new Set(cases.map((c) => c.report.verifier_version));
  const s = new Set(cases.map((c) => c.report.schema));
  t("verifier_version が契約と同じ", v.size === 1 && v.has(VERIFIER_VERSION),
    [...v].join(",") + " vs " + VERIFIER_VERSION);
  t("報告書の schema が契約と同じ", s.size === 1 && s.has(REPORT_SCHEMA),
    [...s].join(",") + " vs " + REPORT_SCHEMA);
}

// 記録層の canonical (ensure_ascii=False) が python と同じか。凍った報告書の
// canonical_sha256 は python の canonical(record) の sha やから、突き合わせるだけで
// 本物の記録 4,645 件ぶんの裏付けになる。表も要らん。
{
  let ok = 0, bad = 0, skipped = 0, first = null;
  for (const c of cases) {
    const want = c.report.canonical_sha256;
    if (want === null || want === undefined) { skipped++; continue; }
    let got;
    try { got = await sha256Hex(canonicalUtf8(c.input.record)); }
    catch (e) { got = "投げた: " + (e && e.message); }
    if (got === want) ok++;
    else { bad++; if (!first) first = "python " + String(want).slice(0, 16) + " / js " + String(got).slice(0, 16); }
  }
  t("記録層の canonical (非 ASCII を逃がさん形) が " + ok.toLocaleString()
    + " 件の本物の記録で python と同じ sha を出す", bad === 0,
    bad ? bad + " 件ずれた、最初は " + first : undefined);
  t("その裏付けが痩せとらん", ok > 4000, ok + " 件しか無い (python が sha を出しとらんのが " + skipped + " 件)");
}

// 断り文は "found %r" で値を差し込む。%r は repr() で、JSON の書き方とは別物や。
// python に書かせた表 809 件 (契約に出る値 260 種を全部含む) と突き合わせる。
{
  const doc = JSON.parse(readFileSync(PYREPR, "utf8"));
  let ok = 0, bad = 0, first = null;
  for (const [key, want] of doc.cases) {
    let got;
    try { got = pyRepr(parseStrict(key)); } catch (e) { got = "投げた: " + (e && e.message); }
    if (got === want) ok++;
    else { bad++; if (!first) first = key + "  python " + want + "  js " + got; }
  }
  t("count は数え直した数と合う", doc.count === doc.cases.length, doc.count);
  t(doc.cases.length + " 種の値を python の repr() と同じ字で書けた", bad === 0,
    bad ? bad + " 件ずれた、最初は " + first : undefined);
}

// 食い違う鍵を「最初の 1 つ」で数えとった。あれは辞書順やから作業順にならん。
// canonical_sha256 が合うただけで does_not_establish が先頭に立つ。全部数える。
// (2026-09-10、初回の表を見て気付いた。4645 件が does_not_establish と出とったが、
//  あれは「それより前の鍵が合うとる」以上のことを言うてへんかった。)
const diffKeys = (want, got) => {
  if (typeof want !== "object" || want === null) return ["(全体)"];
  const keys = [...new Set([...Object.keys(want), ...Object.keys(got || {})])].sort();
  const out = [];
  for (const k of keys) {
    const a = (() => { try { return canonicalAscii(want[k]); } catch { return "?"; } })();
    const b = (() => { try { return canonicalAscii((got || {})[k]); } catch { return "?"; } })();
    if (a !== b) out.push(k);
  }
  return out.length ? out : ["(同じ)"];
};

const byKey = new Map();
const byCode = new Map();
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);

let same = 0, threw = 0;
let firstBad = null;
const t0 = Date.now();

for (let i = 0; i < cases.length; i++) {
  const c = cases[i];
  const want = canonicalAscii(c.report);
  let got, gotObj = null;
  try {
    gotObj = await verify(c.input.record, {
      keys: c.input.keys,
      recorderDomain: c.input.recorder_domain,
      now: c.input.now,
      inputText: c.input.input_text,
    });
    got = canonicalAscii(gotObj);
  } catch (e) {
    threw++;
    bump(byKey, "投げた: " + (e && e.message ? String(e.message).slice(0, 40) : "?"));
    for (const x of c.report.refusals || []) bump(byCode, x.code);
    if (!firstBad) firstBad = { i, want, got: "(投げた) " + (e && e.message) };
    continue;
  }
  if (got === want) { same++; continue; }
  for (const k of diffKeys(c.report, gotObj)) bump(byKey, k);
  for (const x of c.report.refusals || []) bump(byCode, x.code);
  if (!firstBad) firstBad = { i, want, got };
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
const all = same === cases.length;
t(cases.length.toLocaleString() + " 件を Python と同じ報告書で返した", all,
  all ? undefined : same.toLocaleString() + " / " + cases.length.toLocaleString()
    + " 一致 (" + (same / cases.length * 100).toFixed(1) + "%)、投げた " + threw);

console.log("");
// run_all が拾う行。runner に点を嗅ぎ当てさせたらあかん。名乗る。
// (2026-09-10、嗅ぎ当てる作りやったとき、runner は最後の "=== 4 / 5 不合格あり ===" を
//  拾うた。あれは vector の数で件数やない。8 割できとるように読める行が、0 / 5,221 の
//  場所に座っとった。進捗に見えて別の物を測っとる要約は、無い方がましや。)
console.log("SCORE: 一致 " + same.toLocaleString() + " / " + cases.length.toLocaleString()
  + " (" + (same / cases.length * 100).toFixed(1) + "%)、投げた " + threw + "、" + secs + " 秒");
console.log("--- 一致 " + same.toLocaleString() + " / " + cases.length.toLocaleString()
  + " (" + secs + " 秒) ---");

if (!all) {
  console.log("");
  console.log("食い違う鍵、件数 (1 件が複数の鍵で食い違う。ここが次に書く規則):");
  for (const [k, n] of [...byKey].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
    console.log("  " + String(n).padStart(5) + "  " + k);
  }
  console.log("  (" + (cases.length - same).toLocaleString() + " 件が不一致。鍵ごとの合致率は "
    + [...byKey].sort((a, b) => a[1] - b[1]).slice(0, 3)
        .map(([k, n]) => k + " " + (100 - n / cases.length * 100).toFixed(0) + "%").join("、") + " ...)");
  console.log("");
  console.log("その件が Python 側で出しとる refusal code (多い順):");
  for (const [k, n] of [...byCode].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
    console.log("  " + String(n).padStart(5) + "  " + k);
  }
  if (firstBad) {
    let j = 0;
    const n = Math.min(firstBad.want.length, firstBad.got.length);
    while (j < n && firstBad.want[j] === firstBad.got[j]) j++;
    const from = Math.max(0, j - 50);
    console.log("");
    console.log("最初に合わんかった件 (" + firstBad.i + " 番)、" + j + " 文字目から違う:");
    console.log("  python ..." + firstBad.want.slice(from, j + 70));
    console.log("  js     ..." + firstBad.got.slice(from, j + 70));
  }
  console.log("");
  console.log("★ 途中経過や。5,221 / 5,221 になるまで、この suite は赤で終わる。");
}

console.log("");
console.log("=== " + pass + " / " + (pass + fail) + (fail ? " 不合格あり" : " 合格")
  + " (a2a-agreement 検証器、JS と Python の一致) ===");
process.exit(fail ? 1 : 0);
