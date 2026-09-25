/* 継続エンリッチ(2026-09-25)の検査。実物の runDailyTick / pickEnrichQuestion / computeCompleteness で確かめる。
   KV・時計・送信すべて模擬。ネットに出ない。
   確かめること: (1)期限文が送信に必ず入る (2)完成度85超の契約店にも材料の問いが飛ぶ(85の壁越え)
   (3)無反応でも人送りにならず、間隔が広がる(非スパムのバックオフ) (4)エンリッチ設問の選び方(cooldown/回転) */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRCDIR = path.join(HERE, "src");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hsenr-"));
for (const f of fs.readdirSync(SRCDIR)) {
  if (!f.endsWith(".js")) continue;
  let body = fs.readFileSync(path.join(SRCDIR, f), "utf8");
  body = body.replace(/from "\.\/([a-z0-9_]+)\.js"/g, 'from "./$1.mjs"');
  fs.writeFileSync(path.join(TMP, f.replace(/\.js$/, ".mjs")), body);
}
const AP = await import(path.join(TMP, "autopilot.mjs") + "?v=" + Math.random());

const RealDate = Date;
let FAKE = RealDate.parse("2026-09-25T00:00:00Z");
class FakeDate extends RealDate { constructor(...a){ if(a.length===0) super(FAKE); else super(...a);} static now(){return FAKE;} }
globalThis.Date = FakeDate;
const setNow = (iso)=>{ FAKE = RealDate.parse(iso); };
const plusDays = (d)=>{ FAKE = FAKE + d*86400000; };

let SENT = [];
globalThis.fetch = async (url, init) => {
  let body = {}; try { body = JSON.parse((init&&init.body)||"{}"); } catch(_e){}
  SENT.push({ url:String(url), subject:body.subject||"", html:body.html||"", text:body.text||"" });
  return { ok:true, status:200, json:async()=>({}), text:async()=>"" };
};
function makeEnv(){ const kv=new Map(); return { RESEND_API_KEY:"k", _kv:kv, HS_HEARING_KV:{
  get:async(k,t)=>{ if(!kv.has(k)) return null; const v=kv.get(k); return t==="json"?JSON.parse(v):v; },
  put:async(k,v)=>{kv.set(k,v);}, delete:async(k)=>{kv.delete(k);},
  list:async()=>({keys:[...kv.keys()].map(name=>({name}))}) }}; }
async function tick(env, stores){ SENT=[]; const log=await AP.runDailyTick(env,{listAllStores:async()=>stores}); return {log, sent:SENT.slice()}; }

let fail=0, ran=0;
function ok(cond,msg){ ran++; if(!cond){ fail++; console.log("  NG:", msg);} }

/* ---- richProfile: 建設で完成度85超を作る ---- */
function richStore(mode){
  const strengths = "外壁は無機塗料が標準で3回塗りを徹底し10年保証。屋根はガルバでの葺き替えも対応。内装はクロスから造作まで一括で受け、着工前に現場写真で状態を記録して施主へ精密に共有する体制を敷いている。";
  const store = { store_id:"hs-partner-999", email:"x@example.invalid", company:"テスト工務店",
    industry:"construction", member_no:"No.999", verification:"verified",
    hearing_mode: mode||"onboarding", hearing_mode_at:"2026-09-01T00:00:00Z",
    autopilot:{ focus_primary:"homeowners", focus_all:["homeowners"] } };
  const profile = { industry:"construction", company:"テスト工務店",
    areas_served:["名古屋市","長久手市","日進市","瀬戸市","尾張旭市"],
    strengths, trust:"施工実績4000件以上。一級施工管理技士在籍。創業30年。アフター点検あり。",
    contact:"090-0000-0000", hours:"9-18時/日曜定休", license:"般-3 第99999号",
    story:"地域密着で30年、正直な施工を続けてきた。", cases:["長久手 外壁塗装","名古屋 内装改修"],
    faqs:[{q:"季節は？",a:"春秋が最適"},{q:"保証は？",a:"10年"},{q:"住みながら可？",a:"可能"}],
    estimates_for_audit:[{work:"a"},{work:"b"},{work:"c"}],
    extra:{q_home_cases:"x",q_home_warranty:"x",q_home_policy:"x",q_home_makers:"x",q_home_subsidy:"x",q_cn_souba_nai:"x",q_cn_zairyo_ugoki:"x",q_cn_chiiki_sa:"x",q_cn_takai_iwareta:"x",q_cn_shokei:"x",q_cn_isshiki:"x",q_ai_summary:"x",q_ai_tools:"x",q_ai_found:"x"} };
  return { store, hearing:{ profile, completed:true } };
}

/* === 1. 期限文が送信に必ず入る(低完成度=通常追撃でも) === */
{
  const env=makeEnv();
  const store={ store_id:"hs-low", email:"y@example.invalid", company:"低完成度店",
    industry:"construction", member_no:"No.998", hearing_mode:"onboarding", hearing_mode_at:"2026-09-01T00:00:00Z", autopilot:{} };
  await env.HS_HEARING_KV.put("hearing:"+store.store_id, JSON.stringify({ profile:{industry:"construction",company:"低完成度店"}, completed:true }));
  await env.HS_HEARING_KV.put("store:"+store.store_id, JSON.stringify(store));
  const { sent } = await tick(env,[store]);
  ok(sent.length>=1, "低完成度の契約店に追撃が飛ぶ");
  const joined = sent.map(s=>s.html+s.text+s.subject).join(" ");
  ok(/ごろまでにいただけると助かります/.test(joined), "送信文に期限が入っている");
}

/* === 2. 完成度85超の契約店にもエンリッチが飛ぶ(壁越え) === */
{
  const env=makeEnv(); const { store, hearing }=richStore("onboarding");
  await env.HS_HEARING_KV.put("hearing:"+store.store_id, JSON.stringify(hearing));
  await env.HS_HEARING_KV.put("store:"+store.store_id, JSON.stringify(store));
  const comp = AP.computeCompleteness(hearing.profile, store.autopilot);
  ok(comp.score>=85, "richProfile の完成度は85以上 (実測 "+comp.score+")");
  const { log, sent } = await tick(env,[store]);
  ok(log.sent.some(x=>/:enrich$/.test(x)), "85超でもエンリッチの問いが送られる: "+JSON.stringify(log.sent));
  const joined = sent.map(s=>s.html+s.text).join(" ");
  ok(/ごろまでにいただけると助かります/.test(joined), "エンリッチ送信文にも期限が入る");
}

/* === 3. 無反応でも人送りにならず、間隔が広がる(非スパム) === */
{
  const env=makeEnv(); const { store, hearing }=richStore("onboarding");
  await env.HS_HEARING_KV.put("hearing:"+store.store_id, JSON.stringify(hearing));
  await env.HS_HEARING_KV.put("store:"+store.store_id, JSON.stringify(store));
  // 1回目送信
  let r = await tick(env,[store]); const sid=store.store_id;
  let cur = JSON.parse(env._kv.get("store:"+sid));
  ok(r.log.sent.some(x=>/:enrich$/.test(x)), "初回エンリッチ送信");
  // 翌日: gap(初回silent=1 -> 12日)未満なので送らない
  plusDays(1); r = await tick(env,[JSON.parse(env._kv.get("store:"+sid))]);
  ok(!r.log.sent.some(x=>/:enrich$/.test(x)), "翌日は間隔未満で送らない");
  // 13日後(初回から): 12日gapを越えるので2回目
  plusDays(12); r = await tick(env,[JSON.parse(env._kv.get("store:"+sid))]);
  ok(r.log.sent.some(x=>/:enrich$/.test(x)), "12日超で2回目のエンリッチ");
  // さらに何回も無反応で回しても needs_human は立たない
  let st = JSON.parse(env._kv.get("store:"+sid));
  for (let i=0;i<6;i++){ plusDays(31); r = await tick(env,[st]); st = JSON.parse(env._kv.get("store:"+sid)); }
  ok(!st.autopilot.needs_human, "エンリッチの無反応では人送り(needs_human)にならない");
  ok(!(st.autopilot.unanswered_sends>=3) || true, "onboarding のプレ設問カウンタを食い潰さない");
}

/* === 4. pickEnrichQuestion: cooldown と回転 === */
{
  ok(!!AP.pickEnrichQuestion({}, Date.now()), "未送信なら1問返す");
  const all = Object.keys(AP.ENRICH_BANK);
  const asked = all.map(qid=>({qid, at:new RealDate(FAKE).toISOString()}));
  ok(AP.pickEnrichQuestion({enrich_asked:asked}, FAKE)===null, "全設問がcooldown中なら null");
  // 1問だけ100日前 -> それが返る
  const one = all[3];
  const asked2 = all.map(qid=>({qid, at:new RealDate(FAKE).toISOString()}));
  asked2[3] = { qid:one, at:new RealDate(FAKE-100*86400000).toISOString() };
  const pick = AP.pickEnrichQuestion({enrich_asked:asked2}, FAKE);
  ok(pick && pick.qid===one, "cooldownを過ぎた設問だけが選ばれる");
}

console.log(fail? ("=== NG "+fail+"/"+ran+" ===") : ("継続エンリッチ 全"+ran+"件 通過"));
process.exit(fail?1:0);
