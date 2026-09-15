/* 人の番の名簿(humanRoster / formatRoster)の検査。ネットには出ない。純関数だけ。

   なぜ要るか (2026-09-15):
     機械が手を引いた店(needs_human)を拾う手順が無く、あっぷす様は 8/29 の最終回答から
     17 日、002 は 9/12 から、誰にも呼ばれずに止まっていた。日次の通知は「返事待ち」
     (pending のある店)しか並べず、001 のように pending が空で needs_human だけ立った店は
     一行も出なかった。この名簿は、その日の実物の形(2026-09-15 /admin/stores の 3 店)を
     そのまま fixture にしている。並べ方が変わったら、ここが先に落ちる。 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRCDIR = path.join(HERE, "src");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hsroster-"));
for (const f of fs.readdirSync(SRCDIR)) {
  if (!f.endsWith(".js")) continue;
  let body = fs.readFileSync(path.join(SRCDIR, f), "utf8");
  body = body.replace(/from "\.\/([a-z0-9_]+)\.js"/g, 'from "./$1.mjs"');
  fs.writeFileSync(path.join(TMP, f.replace(/\.js$/, ".mjs")), body);
}
const AP = await import(path.join(TMP, "autopilot.mjs") + "?v=" + Math.random());

let fails = 0;
function ok(name, cond, detail) {
  if (cond) { console.log("  ok   " + name); return; }
  fails++; console.log("  NG   " + name + (detail ? "  <- " + detail : ""));
}

// 2026-09-15T03:30:00Z を「今」とする。実物の 3 店 + 検査用の 3 店。
const NOW = Date.parse("2026-09-15T03:30:00Z");
const apps = { store_id: "kira-wbbk99p9", industry: "nursing", hearing_mode: "onboarding", verification: "pending",
  autopilot: { completeness: 40, last_answer_at: "2026-08-29T22:22:48.020Z", unanswered_sends: 3,
    needs_human: { since: "2026-09-13T21:17:52.202Z", why: "3回続けて送って、返事が一度も無い" },
    pending: { qids: ["q_nv_shiji", "q_nv_system"], sent_at: "2026-08-28T21:17:57.135Z", via: "followup" } } };
const p001 = { store_id: "hs-partner-001", member_no: "No.001", company: "リフォーム職人株式会社", hearing_mode: "onboarding", verification: "pending",
  autopilot: { completeness: 75, last_answer_at: "2026-09-15T00:24:11.503Z", unanswered_sends: 0, needs_human: null, pending: null } };
const p002 = { store_id: "hs-partner-002", member_no: "No.002", company: "ミネオトーヨー住器株式会社", hearing_mode: "onboarding", verification: "verified",
  autopilot: { completeness: 77, last_answer_at: "2026-09-07T01:55:25.217Z", unanswered_sends: 3,
    needs_human: { since: "2026-09-12T21:17:51.624Z", why: "3回続けて送って、返事が一度も無い" },
    pending: { qids: ["q_cn_takai_iwareta", "q_ai_tools", "q_cn_zairyo_ugoki"], sent_at: "2026-08-28T21:17:56.182Z", via: "followup" } } };
// 検査用: onboarding で 20 日沈黙、needs_human 無し(機械がまだ 3 回送り切っていない形)
const quiet = { store_id: "hs-partner-009", member_no: "No.009", company: "静かな店", hearing_mode: "onboarding",
  autopilot: { last_answer_at: "2026-08-26T00:00:00Z", unanswered_sends: 1, pending: { qids: ["q_story"], sent_at: "2026-09-13T00:00:00Z" } } };
// 検査用: prospect で 30 日沈黙。催促の表と 28 日打ち切りの持ち場なので、名簿には入れない。
const prospect = { store_id: "kira-prospect1", company: "見込み店", hearing_mode: "prospect",
  autopilot: { last_answer_at: "2026-08-16T00:00:00Z", pending: { qids: ["q_focus"], sent_at: "2026-08-20T00:00:00Z" } } };
// 検査用: onboarding で 3 日前に答えた店。入れない。
const fresh = { store_id: "hs-partner-010", member_no: "No.010", company: "元気な店", hearing_mode: "onboarding",
  autopilot: { last_answer_at: "2026-09-12T00:00:00Z", pending: null } };

console.log("== humanRoster");
const r = AP.humanRoster([fresh, prospect, p001, quiet, p002, apps], NOW);
const ids = r.map((e) => e.store_id);
ok("実物 3 店のうち 002 と あっぷす が並び、001 は並ばない", ids.includes("hs-partner-002") && ids.includes("kira-wbbk99p9") && !ids.includes("hs-partner-001"), ids.join(","));
ok("人送りが先頭に来る(2 店)", r.length >= 2 && r[0].kind === "人送り" && r[1].kind === "人送り", JSON.stringify(ids));
ok("人送りの中は沈黙の長い順(あっぷす 16 日 > 002 8 日)", ids[0] === "kira-wbbk99p9" && ids[1] === "hs-partner-002", ids.join(","));
ok("onboarding で 14 日以上黙っている店は needs_human 無しでも「沈黙」で並ぶ", ids.includes("hs-partner-009") && r.find((e) => e.store_id === "hs-partner-009").kind === "沈黙");
ok("prospect は 30 日黙っていても並ばない(催促の表の持ち場)", !ids.includes("kira-prospect1"));
ok("3 日前に答えた onboarding の店は並ばない", !ids.includes("hs-partner-010"));
const a0 = r.find((e) => e.store_id === "kira-wbbk99p9");
ok("あっぷす: 人送り 1 日、最終回答 16 日前、返事待ち 2 問", a0.human_since_d === 1 && a0.silent_d === 16 && a0.pending_n === 2, JSON.stringify(a0));
ok("company が無ければ store_id を名前にする", a0.company === "kira-wbbk99p9");
const b0 = r.find((e) => e.store_id === "hs-partner-002");
ok("002: 人送り 2 日、最終回答 8 日前、返事待ち 3 問、verified でも並ぶ(掲載と会話は別)", b0.human_since_d === 2 && b0.silent_d === 8 && b0.pending_n === 3, JSON.stringify(b0));
ok("理由は 60 字で切る", r.every((e) => e.why.length <= 60));
ok("last_answer_at が無い needs_human の店は silent_d が null で落ちない", (() => {
  const x = AP.humanRoster([{ store_id: "x", hearing_mode: "onboarding", autopilot: { needs_human: { since: "2026-09-14T00:00:00Z", why: "w" } } }], NOW);
  return x.length === 1 && x[0].silent_d === null && x[0].kind === "人送り";
})());
ok("stores が空でも null でも空配列", AP.humanRoster([], NOW).length === 0 && AP.humanRoster(null, NOW).length === 0);
ok("STALE_ANSWER_D は 14", AP.STALE_ANSWER_D === 14);

console.log("== formatRoster");
const txt = AP.formatRoster(r);
ok("見出しが付く", txt.startsWith("\n人の番(電話する名簿):\n"));
ok("1 店 1 行、3 行(並ぶのは あっぷす・002・静かな店 の 3 店。検査を書いた時に 4 と数え違えたので、検査の側を直した)", txt.split("\n").filter((l) => l.startsWith("  ")).length === r.length && r.length === 3, txt);
ok("会社名と加盟番号と日数が読める", txt.includes("ミネオトーヨー住器株式会社(No.002) 人送り2日") && txt.includes("最終回答8日前") && txt.includes("返事待ち3問"), txt);
ok("沈黙の店は理由なしで「沈黙」と出る", /静かな店\(No\.009\) 沈黙 最終回答20日前 返事待ち1問/.test(txt), txt);
ok("空なら空文字(通知に見出しだけ残さない)", AP.formatRoster([]) === "" && AP.formatRoster(null) === "");
ok("ダッシュ(em/en/bar)を含まない", !/[\u2013\u2014\u2015\u2500]/.test(txt));
ok("LINE の上限 1900 字に収まる長さ(4 店で)", txt.length < 600, String(txt.length));

console.log("== hearing.js の配線");
const src = fs.readFileSync(path.join(SRCDIR, "hearing.js"), "utf8");
ok("scheduled() が humanRoster を通して notify に足している", /AP\.formatRoster\(AP\.humanRoster\(/.test(src) && /waiting \+ roster \+ alarms/.test(src));
ok("GET /admin/roster が管理の門(/admin/ 共通の adminOk)の内側にある", (() => {
  const i = src.indexOf('if (path.startsWith("/admin/")) {'); const j = src.indexOf('path === "/admin/roster"');
  return i > 0 && j > i;
})());
ok("/admin/roster は読むだけ(KV に put しない)", (() => {
  const j = src.indexOf('path === "/admin/roster"'); const seg = src.slice(j, j + 500);
  return seg.includes("return json({ ok: true, count: entries.length") && !/\.put\(/.test(seg);
})());

console.log(fails ? ("=== " + fails + " 件 NG (human_roster_test) ===") : "=== 全部 通過 (human_roster_test) ===");
process.exit(fails ? 1 : 0);
