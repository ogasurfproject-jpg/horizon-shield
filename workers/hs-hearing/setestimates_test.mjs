/* 審査見積セットの差し替え(/admin/set-estimates)を、実物ハンドラ+mock KV で確かめる。
   ネットにも外部ファイルにも触れない(見積は下にインライン。実物 estimates_001.json の写し)。

   2026-09-18 反省: 最初この試験は $HOME/mnt/Downloads/... の実ファイルを読んでいた。
     それはこの番人のVM固有のパスで、社長のMacにもCIにも無い。run_all が落ち、deploy が走らなかった。
     リポジトリの試験は自己完結でなければならない。見積は下にインラインする。 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRCDIR = path.join(HERE, "src");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hsset-"));
for (const f of fs.readdirSync(SRCDIR)) {
  if (!f.endsWith(".js")) continue;
  let body = fs.readFileSync(path.join(SRCDIR, f), "utf8");
  body = body.replace(/from "\.\/([a-z0-9_]+)\.js"/g, 'from "./$1.mjs"');
  fs.writeFileSync(path.join(TMP, f.replace(/\.js$/, ".mjs")), body);
}
const worker = (await import(path.join(TMP, "hearing.mjs") + "?v=" + Math.random())).default;

let fails = 0;
function ok(name, cond, detail){ if(cond){console.log("  ok   "+name);return;} fails++; console.log("  NG   "+name+(detail?"  <- "+detail:"")); }

function mockKV(init){
  const m = new Map(Object.entries(init||{}));
  return {
    async get(k,t){ const v=m.get(k); if(v===undefined) return null; return t==="json" ? (typeof v==="string"?JSON.parse(v):v) : (typeof v==="string"?v:JSON.stringify(v)); },
    async put(k,v){ m.set(k, typeof v==="string"?v:JSON.stringify(v)); },
    async getWithMetadata(k){ const v=m.get(k); return { value:v===undefined?null:v, metadata:null }; },
    async list(o){ const pre=(o&&o.prefix)||""; return { keys:[...m.keys()].filter(k=>k.startsWith(pre)).map(name=>({name})), list_complete:true, cursor:null }; },
    async delete(k){ m.delete(k); },
    _map:m,
  };
}

const KEY="testkey";
const fit = { work:"店舗内装改修(建具・大工・表装・ロールスクリーン・造作看板) 商業施設 愛知", amount:"1740000", shokei:272000, lump_lines:0, has_spec:true, has_warranty:false, urgency:false, insurance_bait:false, upfront_over_half:false, qty:1,
  lines:[{name:"軽量下地組み45x65",qty:30,unit_price:"3600"},{name:"クロス貼り工事AA級品",qty:63.6,unit_price:"2000"},{name:"ロールスクリーン タチカワ ラルク",qty:2,unit_price:"68750"}] };
const nextpro = { work:"店舗内装改修(照明・造作・塗装・クロス・床) 商業施設 名古屋", amount:"566560", shokei:42000, lump_lines:1, has_spec:false, has_warranty:false, urgency:false, insurance_bait:false, upfront_over_half:false, qty:1,
  lines:[{name:"スポットライト取付 材料費込み",qty:4,unit_price:"13000"},{name:"クロス床貼り巾木 一式",qty:1,unit_price:"129600"}] };
const red = { work:"店舗内装改修(床Pタイル・塗装・クロス・シート・鏡) 商業施設 名古屋", amount:"1510000", shokei:115000, lump_lines:3, has_spec:true, has_warranty:false, urgency:false, insurance_bait:false, upfront_over_half:false, qty:1,
  lines:[{name:"床Pタイル貼り",qty:40,unit_price:"5200"},{name:"塗装工事 一式",qty:1,unit_price:"145000"},{name:"シート工事 一式",qty:1,unit_price:"105000"},{name:"小口施工費 一式",qty:1,unit_price:"110000"}] };
const masuda = { work:"店舗内装(表装・電気) 名古屋千種 益田様新店舗", amount:"1600000", shokei:166000, lump_lines:0, has_spec:true, has_warranty:false, urgency:false, insurance_bait:false, upfront_over_half:false, qty:1,
  lines:[{name:"アリーナフィット東リ",qty:44.04,unit_price:"10200"},{name:"アンダーレイ東リ下地材",qty:44.04,unit_price:"3800"},{name:"スポット照明",qty:4,unit_price:"6000"},{name:"鏡貼りH1500xW4700 5mm",qty:1,unit_price:"300000"}] };

function freshEnv(){
  const store = { store_id:"hs-partner-001", member_no:"No.001", company:"リフォーム職人株式会社", verification:"pending", status:"hearing_done" };
  const rec = { store_id:"hs-partner-001", profile:{ industry:"construction", company:"リフォーム職人株式会社", estimates_for_audit:[fit, nextpro, red] } };
  return { HS_HEARING_KV: mockKV({ "store:hs-partner-001": JSON.stringify(store), "hearing:hs-partner-001": JSON.stringify(rec) }), HEARING_ADMIN_SECRET: KEY };
}

async function call(env, p, method, bodyObj){
  const req = new Request("https://hearing.horizonshield.dev"+p, { method, headers:{ "X-Admin-Key":KEY, "content-type":"application/json" }, body: bodyObj?JSON.stringify(bodyObj):undefined });
  const res = await worker.fetch(req, env);
  let j=null; try{ j=await res.json(); }catch(_e){}
  return { status:res.status, json:j };
}

console.log("1. 差し替え前はレッドマジックが分母にいる(前提)");
{
  const env = freshEnv();
  const rec = JSON.parse(env.HS_HEARING_KV._map.get("hearing:hs-partner-001"));
  ok("分母3件でレッドマジックを含む", rec.profile.estimates_for_audit.length===3 && rec.profile.estimates_for_audit.some(e=>e.amount==="1510000"));
}

console.log("2. set-estimates で通る3本(フィット+NextPro+益田)に差し替える");
{
  const env = freshEnv();
  const r = await call(env, "/admin/set-estimates", "POST", { store_id:"hs-partner-001", estimates:[fit, nextpro, masuda] });
  ok("200 で返る", r.status===200, JSON.stringify(r.json).slice(0,160));
  ok("replaced フラグ", r.json && r.json.replaced===true);
  ok("自動verify が立つ", r.json && r.json.auto && r.json.auto.verified===true, JSON.stringify(r.json&&r.json.auto));
  ok("スコア88", r.json && r.json.auto && r.json.auto.score===88, String(r.json&&r.json.auto&&r.json.auto.score));
  const store = JSON.parse(env.HS_HEARING_KV._map.get("store:hs-partner-001"));
  ok("store が verified 化", store.verification==="verified", store.verification);
  ok("tier B", store.integrity_tier==="B", store.integrity_tier);
  ok("status published", store.status==="published", store.status);
  const rec = JSON.parse(env.HS_HEARING_KV._map.get("hearing:hs-partner-001"));
  ok("分母が3件に差し替わった", rec.profile.estimates_for_audit.length===3, String(rec.profile.estimates_for_audit.length));
  ok("レッドマジックは分母から消えた", !rec.profile.estimates_for_audit.some(e=>e.amount==="1510000"));
  ok("益田様が分母に入った", rec.profile.estimates_for_audit.some(e=>String(e.amount)==="1600000"));
  ok("外した痕跡が profile.edits に残る", (rec.profile.edits||[]).some(x=>x.op==="set-estimates" && x.from_count===3));
}

console.log("3. タウンハウジングを混ぜると通らない(fail-closed)");
{
  const env = freshEnv();
  const town = { work:"店舗内装 名古屋金山 タウンハウジング", amount:"7707150", shokei:715000, lump_lines:5, has_spec:true, has_warranty:false, lines:[{name:"入口扉交換一式",qty:1,unit_price:"396000"}] };
  const r = await call(env, "/admin/set-estimates", "POST", { store_id:"hs-partner-001", estimates:[fit, masuda, town] });
  ok("自動verify は立たない", r.json && r.json.auto && r.json.auto.verified===false, JSON.stringify(r.json&&r.json.auto));
  ok("ハード赤旗で保留", r.json && r.json.auto && r.json.auto.hard_alert===true);
  const store = JSON.parse(env.HS_HEARING_KV._map.get("store:hs-partner-001"));
  ok("store は verified にならない", store.verification!=="verified", store.verification);
}

console.log("4. 鍵が無ければ弾く");
{
  const env = freshEnv();
  const res = await worker.fetch(new Request("https://hearing.horizonshield.dev/admin/set-estimates",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({store_id:"hs-partner-001",estimates:[fit]})}), env);
  ok("403 で弾く", res.status===403, "status "+res.status);
}

console.log("");
if(fails){ console.log("=== "+fails+" 件 不合格 (setestimates_test) ==="); process.exit(1); }
console.log("=== 全部 通過 (setestimates_test) ===");
