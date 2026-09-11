/* 当て先の決まっていない返事(_unsorted)を、正しい設問へ当て直して、置き場を消す。
   実物の /admin/profile-patch と /admin/profile を、mock KV を噛ませて叩く。ネットには出ない。

   なぜ要るか (2026-09-11):
     settlePendingOnAnswer は切り分け不能の1通を profile.extra._unsorted に1本だけ置く。
     人が中身を見て正しい qid に当て直したあと、この置き場は用済みになる。
     ところが profile-patch は _unsorted を「知らない qid」として弾いていたので消せず、
     E9(no_unsorted_reply)が永久に鳴った。実物: hs-partner-001 の 2026-09-10 11:21 の
     森下さまの回答(お客様の見つかり方)が _unsorted に座っていた。
     _unsorted は手で書く物ではない(機械しか置かない)。だから消すことだけ許す。 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRCDIR = path.join(HERE, "src");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hsadmin-"));
for (const f of fs.readdirSync(SRCDIR)) {
  if (!f.endsWith(".js")) continue;
  let body = fs.readFileSync(path.join(SRCDIR, f), "utf8");
  body = body.replace(/from "\.\/([a-z0-9_]+)\.js"/g, 'from "./$1.mjs"');
  fs.writeFileSync(path.join(TMP, f.replace(/\.js$/, ".mjs")), body);
}
const worker = (await import(path.join(TMP, "hearing.mjs") + "?v=" + Math.random())).default;

let fails = 0;
function ok(name, cond, detail) {
  if (cond) { console.log("  ok   " + name); return; }
  fails++; console.log("  NG   " + name + (detail ? "  <- " + detail : ""));
}

function mockKV(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    async get(k, t) { const v = m.get(k); if (v === undefined) return null; return t === "json" ? (typeof v === "string" ? JSON.parse(v) : v) : (typeof v === "string" ? v : JSON.stringify(v)); },
    async put(k, v) { m.set(k, typeof v === "string" ? v : JSON.stringify(v)); },
    async getWithMetadata(k) { const v = m.get(k); return { value: v === undefined ? null : v, metadata: null }; },
    async list() { return { keys: [], list_complete: true }; },
    _map: m,
  };
}

const KEY = "testkey";
const UNSORTED_TEXT = "toB営業でアポ無し訪問。紹介が徐々に増えている。『AIで見つけた』というお客様は過去に1名だけで、工事には至らず、直接訪問で1度だけ繋がった。";
const AT = "2026-09-10T02:21:00.000Z";   // 11:21 JST

function freshEnv() {
  const rec = {
    token: "ht_test", store_id: "hs-partner-001",
    profile: {
      industry: "construction", company: "リフォーム職人株式会社",
      extra: {
        q_estimates: { text: "見積は0本", at: "2026-09-04T00:00:00.000Z", attributed: "form", with: [] },
        _unsorted: { text: UNSORTED_TEXT, at: AT, attributed: "ambiguous",
                     with: ["q_ai_found", "q_cn_chiiki_sa", "q_estimates", "q_cn_takai_iwareta"],
                     asked: "いま、お客様は御社をどうやって見つけていますか / ..." },
      },
    },
  };
  return { HS_HEARING_KV: mockKV({ "hearing:hs-partner-001": JSON.stringify(rec) }), HEARING_ADMIN_SECRET: KEY };
}

async function call(env, pathAndQuery, method, bodyObj) {
  const req = new Request("https://hearing.horizonshield.dev" + pathAndQuery, {
    method,
    headers: { "X-Admin-Key": KEY, "content-type": "application/json" },
    body: bodyObj ? JSON.stringify(bodyObj) : undefined,
  });
  const res = await worker.fetch(req, env);
  let json = null; try { json = await res.json(); } catch (_e) {}
  return { status: res.status, json };
}

console.log("1. 読む口(/admin/profile)が _unsorted を見せる");
{
  const env = freshEnv();
  const r = await call(env, "/admin/profile?store=hs-partner-001", "GET");
  ok("200 で返る", r.status === 200, JSON.stringify(r.json).slice(0, 80));
  ok("extra に _unsorted が見える", !!(r.json && r.json.extra && r.json.extra._unsorted), Object.keys((r.json && r.json.extra) || {}).join(","));
  ok("_unsorted の本文が読める", r.json.extra._unsorted.text.includes("アポ無し訪問"));
  const noKey = await worker.fetch(new Request("https://hearing.horizonshield.dev/admin/profile?store=hs-partner-001", { method: "GET" }), env);
  ok("鍵が無ければ弾く(admin ガードが 403)", noKey.status === 403, "status " + noKey.status);
}

console.log("2. 正しい設問に当て直して、_unsorted を消す(1回で)");
{
  const env = freshEnv();
  const r = await call(env, "/admin/profile-patch", "POST", {
    store_id: "hs-partner-001",
    extra: { q_ai_found: { text: UNSORTED_TEXT, at: AT }, _unsorted: "" },
  });
  ok("200 で返る", r.status === 200, JSON.stringify(r.json).slice(0, 120));
  const rec = JSON.parse(env.HS_HEARING_KV._map.get("hearing:hs-partner-001"));
  const ex = rec.profile.extra;
  ok("q_ai_found に本文が入る", ex.q_ai_found && ex.q_ai_found.text === UNSORTED_TEXT);
  ok("印は legacy_confirmed(昔の回答を人が確認した)", ex.q_ai_found.attributed === "legacy_confirmed", ex.q_ai_found.attributed);
  ok("答えた時刻(11:21)が保たれる=今の時刻で潰さない", ex.q_ai_found.at === AT, ex.q_ai_found.at);
  ok("_unsorted は消える", !("_unsorted" in ex), Object.keys(ex).join(","));
  ok("巻き込みで q_estimates は消えない", !!ex.q_estimates);
}

console.log("3. _unsorted に手で本文を書こうとしたら弾く(消すことだけ許す)");
{
  const env = freshEnv();
  const r = await call(env, "/admin/profile-patch", "POST", {
    store_id: "hs-partner-001",
    extra: { _unsorted: "勝手に書いた本文" },
  });
  ok("400 で弾く", r.status === 400, JSON.stringify(r.json));
  ok("理由は delete only", r.json && r.json.error === "unsorted_is_delete_only", JSON.stringify(r.json));
  const rec = JSON.parse(env.HS_HEARING_KV._map.get("hearing:hs-partner-001"));
  ok("弾いたので _unsorted の中身は元のまま", rec.profile.extra._unsorted.text.includes("アポ無し訪問"));
}

console.log("4. 未来の日付は今までどおり弾く(退行していない)");
{
  const env = freshEnv();
  const future = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
  const r = await call(env, "/admin/profile-patch", "POST", {
    store_id: "hs-partner-001",
    extra: { q_ai_found: { text: "x", at: future } },
  });
  ok("400 で弾く", r.status === 400, JSON.stringify(r.json));
  ok("理由は at_in_future", r.json && r.json.error === "at_in_future", JSON.stringify(r.json));
}

console.log("");
if (fails) { console.log("=== " + fails + " 件 不合格 (admin_unsorted_test) ==="); process.exit(1); }
console.log("=== 全部 通過 (admin_unsorted_test) ===");
