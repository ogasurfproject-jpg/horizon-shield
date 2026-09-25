/* 公開面の掃除(src/pii.js)と、その配線を実物で確かめる。KV・ネットワークは模擬。

   なぜ要るか (2026-09-25):
     001 の公開プロフィール(MCP)に「益田様新店舗」、002 に「古木様」「鴨宮瀬戸様」「八幡宮」が出ていた。
     継続エンリッチで加盟店の自由記述が増えると、同じ形の漏れが FAQ にも出る。
     そして門は fail-closed で、返事の絵文字1つ(ゼロ幅結合子)でその店の頁が全部止まる。
   押さえること:
     1) 施主の名前は伏せる。ただし「仕様」「同様」「お客様」「職人さん」を壊さない(壊すと頁が読めなくなる)。
     2) 見積の件名から顧客を名指しする語(寺社・店舗名)を落とす。地名は残す。
     3) 継続エンリッチの答えが、施主向けの問いつきで FAQ に出る。挨拶・絵文字・URL は出ない。
     4) 用紙から入った答えは、保存の時点で名前が伏せてある。生の返事ログは別に残る。
     5) 生成の合図に載る profile に、名前も見積金額(estimates_for_audit)も絵文字も無い。
     6) MCP が返す audit_evidence から、既に KV にある名前が消えている(過去の記録にも効く)。 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRCDIR = path.join(HERE, "src");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hspii-"));
for (const f of fs.readdirSync(SRCDIR)) {
  if (!f.endsWith(".js")) continue;
  let body = fs.readFileSync(path.join(SRCDIR, f), "utf8");
  body = body.replace(/from "\.\/([a-z0-9_]+)\.js"/g, 'from "./$1.mjs"');
  fs.writeFileSync(path.join(TMP, f.replace(/\.js$/, ".mjs")), body);
}
const PII = await import(path.join(TMP, "pii.mjs") + "?v=" + Math.random());
const AP  = await import(path.join(TMP, "autopilot.mjs") + "?v=" + Math.random());
const H   = await import(path.join(TMP, "hearing.mjs") + "?v=" + Math.random());

let fails = 0, ran = 0;
function ok(name, cond, detail) { ran++; if (cond) return; fails++; console.log("  NG   " + name + (detail !== undefined ? "  <- " + detail : "")); }
const eq = (name, got, want) => ok(name, got === want, JSON.stringify(got) + " (want " + JSON.stringify(want) + ")");

console.log("1. 施主の名前を伏せる");
for (const [inp, want] of [
  ["益田様新店舗", "〇〇様新店舗"],
  ["店舗内装(表装・電気) 名古屋千種 益田様新店舗", "店舗内装(表装・電気) 名古屋千種 〇〇様新店舗"],
  ["田中さんのお宅", "〇〇さんのお宅"], ["恵子様", "〇〇様"], ["健一様", "〇〇様"], ["直人さん", "〇〇さん"],
  ["本多様", "〇〇様"], ["土屋さん", "〇〇さん"], ["緒方様", "〇〇様"], ["高木邸の外壁", "〇〇邸の外壁"],
  ["ヤマダ様", "〇〇様"], ["古木様邸", "〇〇様邸"], ["鴨宮瀬戸様", "〇〇様"], ["田中氏", "〇〇氏"],
  ["太郎くん", "〇〇くん"], ["山田さま", "〇〇さま"], ["益田様と田中様", "〇〇様と〇〇様"],
]) eq("伏せる: " + inp, PII.scrubNames(inp), want);

console.log("2. 人名でない語は壊さない");
for (const s of ["標準仕様", "仕様書", "同様に", "多様な工法", "多種多様", "模様替え", "様々な", "書類様式", "大工の様子", "一様に",
  "お客様", "皆様", "施主様", "お施主様", "奥様", "ご主人様", "旦那様", "お子様", "お嬢様", "お得意様", "顧客様", "ご家族様",
  "先方様", "お宅様", "御社様", "担当者様", "オーナー様", "大家様", "業者様", "神様",
  "職人さん", "大工さん", "皆さん", "お父さん", "奥さん", "お子さん", "大家さん", "業者さん", "塗装屋さん", "社長さん",
  "お隣さん", "ご近所さん", "たくさん", "みなさん", "左官さん", "豪邸", "大邸宅", "氏名", "〇〇様", "施工実績4000件以上"])
  eq("残す: " + s, PII.scrubNames(s), s);

console.log("3. 見積の件名(audit_evidence.works)");
{
  const w = PII.scrubWorks(["店舗内装(表装・電気) 名古屋千種 益田様新店舗", "八幡宮 防犯ガラス+フィルム", "内窓9箇所",
    "フィットイージー半田店 内装", "二宮 玄関ドア", "古木様邸 玄関ドア交換", "内窓9箇所"]);
  eq("益田様 -> 〇〇様", w[0], "店舗内装(表装・電気) 名古屋千種 〇〇様新店舗");
  eq("八幡宮は語ごと落とす", w[1], "防犯ガラス+フィルム");
  eq("店舗名(半田店)は落とす", w[3], "内装");
  eq("地名の二宮は残す", w[4], "二宮 玄関ドア");
  eq("古木様邸 -> 〇〇様邸", w[5], "〇〇様邸 玄関ドア交換");
  eq("重複は1つ", w.length, 6);
  ok("どこにも名前が残らない", !/益田|八幡宮|半田店|古木/.test(w.join("|")), w.join("|"));
  const ev = PII.scrubEvidence({ estimates: 3, works: ["益田様新店舗 内装"], recorded_at: "2026-09-18T00:00:00Z", method: "auto-kira" });
  ok("scrubEvidence は他の欄を残す", ev.estimates === 3 && ev.method === "auto-kira" && ev.recorded_at === "2026-09-18T00:00:00Z");
  eq("scrubEvidence の works", ev.works[0], "〇〇様新店舗 内装");
  eq("scrubEvidence(null)", PII.scrubEvidence(null), null);
}

console.log("4. 門を止める文字と、答えの整形");
{
  eq("絵文字(ゼロ幅結合子つき)を取る", PII.stripInvisible("ありがとう🙇‍♂️です"), "ありがとうです");
  eq("ゼロ幅空白を取る", PII.stripInvisible("外​壁"), "外壁");
  eq("キーキャップ", PII.stripInvisible("1️⃣番"), "1番");
  eq("長い英数字は8字で区切る", PII.cleanForPage("型番reformshokunin123"), "型番reformsh okunin12 3");
  eq("金額は cleanForPage では触らない(生成器の safe_pub が伏せる)", PII.cleanForPage("100万円"), "100万円");
  const a = PII.cleanAnswer("お世話になっております！先日は益田様の新店舗で、クロスと床を一新しました🙇‍♂️ 照明も入れ替えています。よろしくお願いいたします。");
  eq("挨拶・絵文字を取り、名前を伏せる", a, "先日は〇〇様の新店舗で、クロスと床を一新しました 照明も入れ替えています。");
  eq("特になし -> 出さない", PII.cleanAnswer("特になし"), null);
  eq("ありません -> 出さない", PII.cleanAnswer("今は特にありません。"), null);
  const u = PII.cleanAnswer("詳しくは https://example.com/works と info@example.com まで。外壁の塗り替えは10年目安です。");
  ok("URL とメールを取る", u && !/https?:|@/.test(u), u);
  ok("上限600字", PII.cleanAnswer("外壁".repeat(500)).length === 600);
}

console.log("5. 用紙の送信と MCP の値");
{
  const raw = { company: "益田工務店様", rep: "森下 真也", contact: "090-1111-2222", strengths: "田中様邸で施工。",
    faqs: [{ q: "山田様から聞かれたこと", a: "鈴木さんに説明した" }],
    answers: [{ qid: "q_en_recent", text: "益田様の新店舗です" }] };
  PII.scrubFormRaw(raw);
  eq("社名の欄は触らない", raw.company, "益田工務店様");
  eq("代表者の欄は触らない", raw.rep, "森下 真也");
  eq("連絡先の欄は触らない", raw.contact, "090-1111-2222");
  eq("強み", raw.strengths, "〇〇様邸で施工。");
  eq("FAQ q", raw.faqs[0].q, "〇〇様から聞かれたこと");
  eq("FAQ a", raw.faqs[0].a, "〇〇さんに説明した");
  eq("設問の答え", raw.answers[0].text, "〇〇様の新店舗です");
  eq("answers の qid は保つ", raw.answers[0].qid, "q_en_recent");
  const m = PII.scrubForMcp({ q_en_price: { text: "益田様の工事は100万円でした", at: "2026-09-25T05:03:22.648Z" }, s: "見積 1,500,000 円" });
  eq("MCP: 名前と金額", m.q_en_price.text, "〇〇様の工事は(金額 非公開)でした");
  eq("MCP: 時刻は触らない", m.q_en_price.at, "2026-09-25T05:03:22.648Z");
  ok("MCP: カンマ付き金額も伏せる", !/1,500,000/.test(m.s), m.s);
}

console.log("6. 継続エンリッチの答え -> FAQ");
{
  const profile = { company: "テスト工務店", faqs: [{ q: "保証は？", a: "10年です" }], strengths: "高木邸の実績​あり",
    estimates_for_audit: [{ work: "x", amount: 1000000 }],
    extra: {
      q_en_recent:  { text: "お世話になっております。先日は益田様の新店舗の内装を一新しました。クロスと床を張り替えています。", at: "2026-09-20T00:00:00Z", attributed: "sole" },
      q_en_season:  { text: "梅雨前に外壁のひび割れを点検しておくと、雨漏りを防げます。", at: "2026-09-22T00:00:00Z", attributed: "form" },
      q_en_mistake: { text: "相見積もりで一番安い所に決めてしまうことです。内訳を見てください。", at: "2026-09-23T00:00:00Z", attributed: "ambiguous" },
      q_en_area:    "名古屋市千種区と長久手市からの依頼が特に多いです。",
      q_en_tool:    { text: "特になし", at: "2026-09-24T00:00:00Z" },
      q_focus:      "3",
    } };
  const before = JSON.stringify(profile);
  const ef = AP.enrichFaqs(profile);
  eq("出るのは3本(ambiguous と薄い答えは出ない)", ef.length, 3);
  eq("新しい順: 1本目は季節", ef[0].q, AP.ENRICH_FAQ_Q.q_en_season);
  eq("2本目は直近の工事", ef[1].q, AP.ENRICH_FAQ_Q.q_en_recent);
  ok("直近の工事の答えは名前が伏せてあり挨拶が無い", /^先日は〇〇様の新店舗/.test(ef[1].a) && !/益田|お世話/.test(ef[1].a), ef[1].a);
  eq("日付の無い古い形の答えは最後", ef[2].q, AP.ENRICH_FAQ_Q.q_en_area);
  const pp = AP.publishProfile(profile);
  eq("加盟店自身の FAQ が先頭", pp.faqs[0].q, "保証は？");
  eq("FAQ は 自分1 + エンリッチ3", pp.faqs.length, 4);
  ok("金額の元(estimates_for_audit)は写しに無い", pp.estimates_for_audit === undefined);
  eq("強みの名前とゼロ幅を取る", pp.strengths, "〇〇邸の実績あり");
  eq("元の profile は変わらない", JSON.stringify(profile), before);
  const pu = AP.publishProfile({ extra: { _unsorted: { text: "森下です。以前記入しました" }, q_focus: "3" } });
  ok("生の返事(_unsorted)は生成の写しに出ない", !("_unsorted" in pu.extra) && pu.extra.q_focus === "3", JSON.stringify(pu.extra));
  const many = { extra: {} };
  for (const k of Object.keys(AP.ENRICH_FAQ_Q)) many.extra[k] = { text: "これは十分な長さのある答えの本文です。" + k, at: "2026-09-2" + (k.length % 10) + "T00:00:00Z" };
  eq("最大 ENRICH_FAQ_MAX 本", AP.enrichFaqs(many).length, AP.ENRICH_FAQ_MAX);
  eq("空の profile でも落ちない", JSON.stringify(AP.publishProfile(undefined)), "{}");
}

/* ---- ここから実物の worker(fetch)を通す ---- */
function makeEnv() {
  const kv = new Map();
  return { _kv: kv, GH_DISPATCH_TOKEN: "t", GH_DISPATCH_REPO: "o/r", GEN_DEBOUNCE_MS: "0", GEN_MIN_COMPLETENESS: "0",
    HS_HEARING_KV: {
      get: async (k, t) => { if (!kv.has(k)) return null; const v = kv.get(k); return t === "json" ? JSON.parse(v) : v; },
      put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); },
      list: async (o) => ({ keys: [...kv.keys()].filter((n) => !o || !o.prefix || n.startsWith(o.prefix)).map((name) => ({ name })), list_complete: true }),
    } };
}
let CALLS = [];
globalThis.fetch = async (url, init) => { CALLS.push({ url: String(url), body: (init && init.body) || "" });
  return { ok: true, status: 200, json: async () => ({}), text: async () => "" }; };
const ctx = { waitUntil() {}, passThroughOnException() {} };
function findKey(o, key) { if (!o || typeof o !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(o, key)) return o[key];
  for (const v of Object.values(o)) { const r = findKey(v, key); if (r !== undefined) return r; } return undefined; }

console.log("7. 用紙送信 -> 保存 -> 生成の合図(実物の /h/)");
{
  const env = makeEnv(), sid = "hs-partner-777", tok = "ht_0123456789abcdef0123456789abcdef";
  const T = "2026-09-24T21:17:00.000Z";
  await env.HS_HEARING_KV.put("htok:" + tok, JSON.stringify({ store_id: sid }));
  await env.HS_HEARING_KV.put("store:" + sid, JSON.stringify({ store_id: sid, member_no: "No.777", company: "テスト工務店",
    industry: "construction", token: tok, status: "published", verification: "verified", hearing_mode: "onboarding",
    autopilot: { pending: { qids: ["q_en_recent"], asked_texts: { q_en_recent: AP.ENRICH_BANK.q_en_recent }, text: AP.ENRICH_BANK.q_en_recent,
      sent_at: T, via: "enrich", soft: true, waves: [{ qids: ["q_en_recent"], texts: { q_en_recent: AP.ENRICH_BANK.q_en_recent }, sent_at: T, kind: "enrich" }] } } }));
  await env.HS_HEARING_KV.put("hearing:" + sid, JSON.stringify({ completed: true, profile: { company: "テスト工務店", area: "愛知県",
    works: ["内装"], industry: "construction", faqs: [{ q: "保証は？", a: "10年です" }], strengths: "高木邸の実績あり",
    estimates_for_audit: [{ work: "益田様新店舗", amount: 1600000 }] } }));
  CALLS = [];
  const res = await H.default.fetch(new Request("https://hearing.horizonshield.dev/h/" + tok, { method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company: "テスト工務店", area: "愛知県", works: ["内装"], strengths: "田中様邸で施工。",
      answers: [{ qid: "q_en_recent", text: "お世話になっております！先日は益田様の新店舗で、クロスと床を一新しました🙇‍♂️ 照明も入れ替えています。よろしくお願いいたします。" }] }) }), env, ctx);
  const rj = await res.json();
  ok("用紙の送信が通る", rj && rj.ok === true, JSON.stringify(rj));
  ok("生成の合図が出る", rj.generation && rj.generation.triggered === true, JSON.stringify(rj.generation));
  const stored = JSON.parse(env._kv.get("hearing:" + sid));
  const st = stored.profile.extra && stored.profile.extra.q_en_recent;
  ok("答えは q_en_recent に qid つきで入る", st && st.attributed === "form", JSON.stringify(st));
  ok("保存された答えには名前が無い", st && /〇〇様/.test(st.text) && !/益田/.test(st.text), st && st.text);
  ok("用紙で来た名前(田中)はどこにも保存されない", !/田中/.test(JSON.stringify(stored)));
  ok("既に保存されていた名前(高木)は保存側では書き換えない(伏せるのは公開の時)", /高木/.test(stored.profile.strengths || ""), stored.profile.strengths);
  const gh = CALLS.find((c) => /api\.github\.com\/repos\/o\/r\/dispatches/.test(c.url));
  ok("GitHub への合図が1本ある", !!gh, CALLS.map((c) => c.url).join(" | "));
  const body = gh ? gh.body : "";
  ok("合図に名前が無い", !/益田|田中|高木/.test(body), body.slice(0, 300));
  ok("合図に絵文字もゼロ幅も無い", !/🙇|‍/.test(body));
  ok("合図に見積の中身が無い", !/estimates_for_audit|1600000/.test(body));
  const faqs = findKey(JSON.parse(body || "{}"), "faqs") || [];
  eq("FAQ の先頭は加盟店自身のもの", faqs[0] && faqs[0].q, "保証は？");
  const en = faqs.find((f) => f.q === AP.ENRICH_FAQ_Q.q_en_recent);
  ok("エンリッチの答えが施主向けの問いつきで FAQ に出る", en && /^先日は〇〇様の新店舗で、クロスと床を一新しました/.test(en.a), JSON.stringify(en));
}

console.log("8. MCP の公開プロフィール(実物の /mcp、既に KV にある名前)");
{
  const env = makeEnv(), sid = "hs-partner-778";
  await env.HS_HEARING_KV.put("store:" + sid, JSON.stringify({ store_id: sid, member_no: "No.778", company: "テスト住器",
    status: "published", verification: "verified", fairness_score: 90, integrity_tier: "A", red_flags_detected: 0,
    audit_evidence: { estimates: 3, works: ["店舗内装(表装・電気) 名古屋千種 益田様新店舗", "八幡宮 防犯ガラス+フィルム", "古木様邸 玄関ドア交換"], recorded_at: "2026-09-18T00:00:00Z", method: "auto-kira" } }));
  const res = await H.default.fetch(new Request("https://hearing.horizonshield.dev/mcp", { method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_contractor_profile", arguments: { member_no: "No.778" } } }) }), env, ctx);
  const txt = await res.text();
  ok("MCP が答える", res.status === 200 && /No\.778/.test(txt), res.status + " " + txt.slice(0, 200));
  ok("MCP の audit_evidence に名前が無い", !/益田|八幡宮|古木/.test(txt), txt.slice(0, 400));
  ok("伏せた形で残る", /〇〇様新店舗/.test(txt) && /防犯ガラス\+フィルム/.test(txt), txt.slice(0, 400));
}

console.log(fails ? ("=== NG " + fails + " / " + ran + " ===") : ("公開面の掃除 全" + ran + "件 通過"));
process.exit(fails ? 1 : 0);
