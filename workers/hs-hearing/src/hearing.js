/**
 * hs-hearing : Yakumoモール 加盟店 自動ヒアリング + 生きた加盟店MCPサーバー
 *
 * 設計方針(恒久ルール準拠):
 *  - 新規の独立ワーカー。hs-mcp / hs-estimate には一切触れない(審査キュー保護)。
 *  - fail-closed。検証できないもの・不明なものは出さない・返さない。
 *  - 金額は施主向けに出さない(スコア・ティアのみ)。見積もり例は監査用にKVへ保存するだけ。
 *  - 会社名は The HORIZONs株式会社(音インタクト)。em/en/bar dash 不使用。
 *  - MCP面は read-only・CORS開放。堀(内部実装の詳細)は一切露出しない。
 *
 * バインド(wrangler.jsonc):
 *  KV  HS_HEARING_KV
 *  var PUBLIC_DATA_URL        = https://shield.the-horizons-innovation.com/data/yakumo-contractors.json
 *  secret HEARING_ADMIN_SECRET   (管理エンドポイントの X-Admin-Key)
 *  secret GH_DISPATCH_TOKEN      (任意: GitHub repository_dispatch 用 PAT。未設定なら生成は起動しない=fail-closed)
 *  var GH_DISPATCH_REPO       = ogasurfproject-jpg/horizon-shield   (任意)
 */

import * as AP from "./autopilot.js";
import * as IND from "./industry.js";

const SERVER = { name: "HORIZON SHIELD YAKUMO", version: "2.3.0" };
const PUBLIC_DATA_FALLBACK = "https://shield.the-horizons-innovation.com/data/yakumo-contractors.json";
const MALL_URL = "https://shield.the-horizons-innovation.com/yakumo/";
const SITE_URL = "https://shield.the-horizons-innovation.com";
const MCP_SUPPORTED = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

/* ------------------------------ helpers ------------------------------ */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key, Authorization, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};
const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors, ...extra } });
const html = (body, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...cors } });
const rpc = (id, result) => json({ jsonrpc: "2.0", id, result });
const rpcErr = (id, code, message) => json({ jsonrpc: "2.0", id, error: { code, message } });

function safeStr(v, max = 400) { return (v == null ? "" : String(v)).slice(0, max); }
function escHtml(v) { return (v == null ? "" : String(v)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
// 金額を円の数値文字列にする。「90万」→900000 のように億/万/千を展開。単位なし(純粋な数字)は従来通り数字のみ。
function parseJpYen(v) {
  const s = String(v == null ? "" : v).replace(/[,，\s円]/g, "").replace(/^(?:約|およそ|凡そ)/, "");
  if (!s) return "";
  const m = s.match(/^(?:(\d+(?:\.\d+)?)億)?(?:(\d+(?:\.\d+)?)万)?(?:(\d+(?:\.\d+)?)千)?(\d+)?$/);
  if (m && (m[1] || m[2] || m[3])) {
    const total = parseFloat(m[1] || 0) * 1e8 + parseFloat(m[2] || 0) * 1e4 + parseFloat(m[3] || 0) * 1e3 + parseFloat(m[4] || 0);
    return String(Math.round(total));
  }
  return s.replace(/[^0-9]/g, "");
}
function safeArr(v, maxItems = 30, maxLen = 120) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, maxItems).map((x) => safeStr(x, maxLen)).filter(Boolean);
}
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function ctEqSync(a, b) {
  a = String(a == null ? "" : a); b = String(b == null ? "" : b);
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
function adminOk(request, env) {
  const key = request.headers.get("X-Admin-Key") || "";
  return !!(env.HEARING_ADMIN_SECRET && key && ctEqSync(key, env.HEARING_ADMIN_SECRET)); // L1: 定数時間比較
}
async function fetchPublished(env) {
  const url = (env.PUBLIC_DATA_URL || PUBLIC_DATA_FALLBACK);
  try {
    const r = await fetch(url, { cf: { cacheTtl: 600, cacheEverything: true } });
    if (!r.ok) return { contractors: [], stats: {} };
    const d = await r.json();
    return { contractors: Array.isArray(d.contractors) ? d.contractors : [], stats: d.stats || {} };
  } catch (_e) {
    return { contractors: [], stats: {} };
  }
}

/* ------------------------------ hearing form ------------------------------ */
function hearingForm(token, store) {
  const company = escHtml(safeStr(store && store.company, 120) || "加盟店");
  const memberNo = escHtml(safeStr(store && store.member_no, 20) || "");
  // インラインJSはバッククォートを使わない(ワーカー側テンプレートリテラルとの衝突回避)
  return '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">' +
'<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
'<meta name="robots" content="noindex,nofollow">' +
'<title>加盟店ヒアリング ｜ Yakumo</title>' +
'<style>' +
'body{margin:0;background:#080B11;color:#EAF0F8;font-family:"Hiragino Sans","Yu Gothic",system-ui,sans-serif;line-height:1.8;}' +
'.wrap{max-width:640px;margin:0 auto;padding:22px 18px 60px;}' +
'.brand{font-weight:900;letter-spacing:.06em;font-size:18px;color:#3FE0CE;}.brand span{color:#C9A86A;font-size:12px;letter-spacing:.2em;margin-left:6px;}' +
'h1{font-size:22px;margin:18px 0 6px;font-weight:700;}p.lead{color:#7E8CA2;font-size:14px;margin:0 0 20px;}' +
'.who{border:1px solid #1A2230;border-radius:12px;padding:12px 14px;background:rgba(16,22,33,.55);font-size:13px;color:#7E8CA2;margin-bottom:22px;}' +
'.who b{color:#EAF0F8;}' +
'label{display:block;margin:18px 0 6px;font-weight:700;font-size:14px;}label .req{color:#F0634A;font-size:12px;margin-left:6px;}label .opt{color:#4A5568;font-size:12px;margin-left:6px;}' +
'.hint{color:#4A5568;font-size:12px;margin:0 0 6px;}' +
'input[type=text],input[type=email],textarea,select{width:100%;background:#0A0E16;border:1px solid #283449;color:#EAF0F8;border-radius:9px;padding:11px 12px;font-family:inherit;font-size:15px;}' +
'textarea{min-height:84px;resize:vertical;}' +
'.chips{display:flex;flex-wrap:wrap;gap:8px;}.chip{border:1px solid #283449;border-radius:999px;padding:8px 14px;font-size:13px;color:#7E8CA2;cursor:pointer;user-select:none;}.chip.on{border-color:#15847A;color:#3FE0CE;background:rgba(63,224,206,.06);}' +
'.card{border:1px solid #1A2230;border-radius:12px;padding:14px;margin:10px 0;background:rgba(16,22,33,.35);}' +
'.row2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}@media(max-width:520px){.row2{grid-template-columns:1fr;}}' +
'button.add{background:transparent;border:1px dashed #283449;color:#7E8CA2;border-radius:9px;padding:9px 14px;font-family:inherit;font-size:13px;cursor:pointer;margin-top:6px;}' +
'button.submit{width:100%;margin-top:26px;background:#3FE0CE;color:#06241F;border:0;border-radius:11px;padding:15px;font-weight:800;font-size:16px;cursor:pointer;}' +
'.note{color:#4A5568;font-size:12px;margin-top:14px;text-align:center;}' +
'.ok{display:none;text-align:center;padding:40px 10px;}.ok h2{color:#3FE0CE;}' +
'</style></head><body><div class="wrap">' +
'<div class="brand">Yakumo</div>' +
'<h1>加盟店ヒアリング</h1>' +
'<p class="lead">ご回答いただいた内容から、あなたの店を施主・AI・検索の三方から見つけてもらうためのページ(GEO / AEO / LLMO / WebMCP)を自動で作成し、運営代行します。金額は施主向けに公開しません(スコアと検証だけ)。所要 約5分。</p>' +
'<div class="who">対象: <b>' + company + '</b>' + (memberNo ? ' ・ 加盟 <b>' + memberNo + '</b>' : '') + '</div>' +
'<form id="f">' +

'<label>正式な社名 <span class="req">必須</span></label>' +
'<input type="text" id="company" value="' + company + '" required>' +

'<div class="row2"><div><label>代表者名 <span class="opt">任意</span></label><input type="text" id="rep"></div>' +
'<div><label>建設業許可番号 <span class="opt">任意</span></label><input type="text" id="license"></div></div>' +

'<label>所在地(市区町村まで) <span class="req">必須</span></label>' +
'<input type="text" id="area" placeholder="例：愛知県長久手市" required>' +

'<label>対応エリア <span class="hint">(施主が探す地名。カンマ区切り)</span></label>' +
'<input type="text" id="areas" placeholder="例：長久手市, 名古屋市, 日進市, 尾張旭市, 瀬戸市">' +

'<label>対応できる工種 <span class="req">必須</span></label>' +
'<p class="hint">当てはまるものをタップ。その他は自由入力へ。</p>' +
'<div class="chips" id="works">' +
['外壁塗装','屋根','内装','クロス','床・フローリング','浴室','キッチン','トイレ','洗面','水道','外構','防水','リノベーション全般']
  .map(function(w){return '<span class="chip" data-w="'+w+'">'+w+'</span>';}).join('') +
'</div>' +
'<input type="text" id="worksOther" placeholder="その他の工種(自由入力)" style="margin-top:10px;">' +

'<label>各工種の強み・こだわり <span class="hint">(使う塗料・工法・保証年数など。LLMO/解説ページの素材)</span></label>' +
'<textarea id="strengths" placeholder="例：外壁は無機塗料が標準。3回塗りを徹底し、施工後10年保証。屋根はカバー工法とはつりの両対応で、下地の状態を写真で説明します。"></textarea>' +

'<label>実際の見積もり例 <span class="hint">(適正診断=KIRA監査に使います。金額は公開しません。1〜3件)</span></label>' +
'<div id="estimates">' +
'<div class="card est"><div class="row2"><div><input type="text" class="e-work" placeholder="工種(例:外壁塗装 30坪)"></div><div><input type="text" class="e-amount" placeholder="概算金額(例:900000)"></div></div><input type="text" class="e-detail" placeholder="内訳の要点(任意)" style="margin-top:8px;"></div>' +
'</div><button type="button" class="add" id="addEst">＋ 見積もり例を追加</button>' +

'<label>施主からよく聞かれる質問と答え <span class="hint">(FAQ/AEOページの素材。3件ほど)</span></label>' +
'<div id="faqs">' +
'<div class="card faq"><input type="text" class="q" placeholder="質問(例:外壁塗装の適した時期は?)"><textarea class="a" placeholder="答え" style="margin-top:8px;"></textarea></div>' +
'<div class="card faq"><input type="text" class="q" placeholder="質問"><textarea class="a" placeholder="答え" style="margin-top:8px;"></textarea></div>' +
'</div><button type="button" class="add" id="addFaq">＋ 質問を追加</button>' +

'<label>信頼の裏づけ <span class="opt">任意</span> <span class="hint">(受賞歴・加盟団体・アフター保証・施工実績数など)</span></label>' +
'<textarea id="trust" placeholder="例：地域密着20年、施工実績1,200件。塗装技能士在籍。工事後も年1回の無料点検。"></textarea>' +

'<div class="row2"><div><label>施主対応の連絡先 <span class="opt">任意</span></label><input type="text" id="contact" placeholder="電話 または メール"></div>' +
'<div><label>対応時間・定休日 <span class="opt">任意</span></label><input type="text" id="hours" placeholder="例：9-18時 / 日曜定休"></div></div>' +

'<label>公開してほしくない情報 <span class="opt">任意</span></label>' +
'<input type="text" id="ng" placeholder="例：担当者の個人携帯は載せないでほしい">' +

// ---- 採用(社員募集) 任意セクション。集客だけの店は全て空欄でOK(採用ページは作られない) ----
'<div style="margin-top:34px;border-top:1px solid #1A2230;padding-top:16px;"></div>' +
'<h1 style="font-size:18px;">採用(社員募集) <span class="opt" style="font-size:12px;">任意</span></h1>' +
'<p class="lead">職人・スタッフの募集がある場合だけご記入ください。入力すると、給与や待遇を載せた採用ページ(求人検索やAIに見つかる JobPosting 付き)を作成します。空欄なら採用ページは作りません。</p>' +

'<label>募集職種 <span class="opt">任意</span> <span class="hint">(当てはまるものをタップ。その他は自由入力へ)</span></label>' +
'<div class="chips" id="rroles">' +
['塗装工','屋根工','防水工','大工','内装工','左官','板金工','現場監督','施工管理','営業','事務']
  .map(function(w){return '<span class="chip" data-w="'+w+'">'+w+'</span>';}).join('') +
'</div>' +
'<input type="text" id="rrolesOther" placeholder="その他の職種(カンマ区切りで自由入力)" style="margin-top:10px;">' +

'<div class="row2"><div><label>雇用形態 <span class="opt">任意</span></label><input type="text" id="rEmployment" placeholder="例：正社員 / 契約社員 / パート"></div>' +
'<div><label>勤務地 <span class="opt">任意</span></label><input type="text" id="rWorkplace" placeholder="例：神奈川県平塚市とその周辺"></div></div>' +

'<label>給与レンジ <span class="opt">任意</span> <span class="hint">(下限・上限。採用ページにだけ表示します)</span></label>' +
'<div class="row2"><div><select id="rSalaryUnit"><option value="月給">月給</option><option value="時給">時給</option><option value="日給">日給</option><option value="年収">年収</option></select></div><div></div></div>' +
'<div class="row2"><div><input type="text" id="rSalaryMin" placeholder="下限(例：250000)"></div>' +
'<div><input type="text" id="rSalaryMax" placeholder="上限(例：400000)"></div></div>' +

'<label>賞与・各種手当 <span class="opt">任意</span></label>' +
'<input type="text" id="rBonus" placeholder="例：賞与年2回、資格手当、家族手当、交通費支給">' +

'<label>社会保険・休日・年間休日 <span class="opt">任意</span></label>' +
'<input type="text" id="rInsurance" placeholder="例：社会保険完備、週休2日、年間休日110日">' +

'<label>必要・歓迎する資格 <span class="opt">任意</span></label>' +
'<input type="text" id="rQualifications" placeholder="例：要普通自動車免許、歓迎：塗装技能士">' +

'<label>未経験の可否 <span class="opt">任意</span></label>' +
'<input type="text" id="rInexperienced" placeholder="例：未経験歓迎 / 経験者優遇">' +

'<label>入社後の研修・教育体制(リスキリング) <span class="opt">任意</span> <span class="hint">(助成金を活用した教育など)</span></label>' +
'<textarea id="rTraining" placeholder="例：未経験は先輩と2人1組で1年。助成金を活用した研修制度あり。資格取得を会社が支援。"></textarea>' +

'<label>求める人物像 <span class="opt">任意</span></label>' +
'<textarea id="rIdeal" placeholder="例：ものづくりが好きな方。チームで動ける方。長く腰を据えて働きたい方。"></textarea>' +

'<label>会社の魅力・社風 <span class="opt">任意</span></label>' +
'<textarea id="rCulture" placeholder="例：若手が多く風通しの良い職場。技術を教え合う文化。地域密着で残業は少なめ。"></textarea>' +

'<div class="row2"><div><label>応募方法 <span class="opt">任意</span></label><input type="text" id="rApplyMethod" placeholder="例：フォーム / LINE / 電話"></div>' +
'<div><label>応募の連絡先 <span class="opt">任意</span></label><input type="text" id="rApplyContact" placeholder="電話 / メール / LINE ID"></div></div>' +

'<button type="submit" class="submit">回答を送信する</button>' +
'<p class="note">送信内容は The HORIZONs株式会社(HORIZON SHIELD)が加盟店運営のために使用します。金額は施主向けに公開しません。</p>' +
'</form>' +
'<div class="ok" id="ok"><h2>ありがとうございます</h2><p style="color:#7E8CA2;">回答を受け取りました。適正診断(KIRA)とページ作成の準備に入ります。結果は運営からご連絡します。</p></div>' +

'<script>' +
'var TOKEN=' + JSON.stringify(token) + ';' +
'document.querySelectorAll("#works .chip").forEach(function(c){c.addEventListener("click",function(){c.classList.toggle("on");});});' +
'document.querySelectorAll("#rroles .chip").forEach(function(c){c.addEventListener("click",function(){c.classList.toggle("on");});});' +
'document.getElementById("addEst").addEventListener("click",function(){var d=document.createElement("div");d.className="card est";d.innerHTML=\'<div class="row2"><div><input type="text" class="e-work" placeholder="工種"></div><div><input type="text" class="e-amount" placeholder="概算金額"></div></div><input type="text" class="e-detail" placeholder="内訳の要点(任意)" style="margin-top:8px;">\';document.getElementById("estimates").appendChild(d);});' +
'document.getElementById("addFaq").addEventListener("click",function(){var d=document.createElement("div");d.className="card faq";d.innerHTML=\'<input type="text" class="q" placeholder="質問"><textarea class="a" placeholder="答え" style="margin-top:8px;"></textarea>\';document.getElementById("faqs").appendChild(d);});' +
'function val(id){var e=document.getElementById(id);return e?e.value.trim():"";}' +
'document.getElementById("f").addEventListener("submit",function(ev){ev.preventDefault();' +
'var works=[];document.querySelectorAll("#works .chip.on").forEach(function(c){works.push(c.getAttribute("data-w"));});' +
'var wo=val("worksOther");if(wo){wo.split(",").forEach(function(x){x=x.trim();if(x)works.push(x);});}' +
'var estimates=[];document.querySelectorAll("#estimates .est").forEach(function(c){var w=c.querySelector(".e-work").value.trim();var a=c.querySelector(".e-amount").value.trim();var de=c.querySelector(".e-detail").value.trim();if(w||a)estimates.push({work:w,amount:a,detail:de});});' +
'var faqs=[];document.querySelectorAll("#faqs .faq").forEach(function(c){var q=c.querySelector(".q").value.trim();var a=c.querySelector(".a").value.trim();if(q&&a)faqs.push({q:q,a:a});});' +
'var rroles=[];document.querySelectorAll("#rroles .chip.on").forEach(function(c){rroles.push(c.getAttribute("data-w"));});' +
'var rro=val("rrolesOther");if(rro){rro.split(",").forEach(function(x){x=x.trim();if(x)rroles.push(x);});}' +
'var recruit={roles:rroles,employment_type:val("rEmployment"),salary_min:val("rSalaryMin"),salary_max:val("rSalaryMax"),salary_unit:val("rSalaryUnit"),bonus_allowance:val("rBonus"),insurance_holidays:val("rInsurance"),ideal_person:val("rIdeal"),qualifications:val("rQualifications"),inexperienced_ok:val("rInexperienced"),training:val("rTraining"),workplace:val("rWorkplace"),culture:val("rCulture"),apply_method:val("rApplyMethod"),apply_contact:val("rApplyContact")};' +
'var hasR=rroles.length||recruit.employment_type||recruit.salary_min||recruit.salary_max||recruit.bonus_allowance||recruit.insurance_holidays||recruit.ideal_person||recruit.qualifications||recruit.inexperienced_ok||recruit.training||recruit.workplace||recruit.culture||recruit.apply_method||recruit.apply_contact;' +
'var payload={company:val("company"),rep:val("rep"),license:val("license"),area:val("area"),areas:val("areas"),works:works,strengths:val("strengths"),estimates:estimates,faqs:faqs,trust:val("trust"),contact:val("contact"),hours:val("hours"),ng:val("ng")};' +
'if(hasR)payload.recruit=recruit;' +
'if(!payload.company||!payload.area||works.length===0){alert("社名・所在地・工種は必須です。");return;}' +
'fetch("/h/"+TOKEN,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}).then(function(r){return r.json();}).then(function(res){if(res&&res.ok){document.getElementById("f").style.display="none";document.getElementById("ok").style.display="block";window.scrollTo(0,0);}else{alert((res&&res.error)||"送信に失敗しました。時間をおいて再度お試しください。");}}).catch(function(){alert("通信エラー。時間をおいて再度お試しください。");});' +
'});' +
'</script>' +
'</div></body></html>';
}

/* ------------------------------ normalize answers ------------------------------ */
// 採用(recruit)トラックの正規化。全項目が空なら null を返す(集客のみの店は影響を受けない=完全に任意)。
function normalizeRecruit(r) {
  if (!r || typeof r !== "object") return null;
  const rec = {
    roles: safeArr(r.roles, 12, 60),
    employment_type: safeStr(r.employment_type, 60),
    salary_min: safeStr(r.salary_min, 20).replace(/[^0-9]/g, ""),
    salary_max: safeStr(r.salary_max, 20).replace(/[^0-9]/g, ""),
    salary_unit: safeStr(r.salary_unit, 12),
    bonus_allowance: safeStr(r.bonus_allowance, 400),
    insurance_holidays: safeStr(r.insurance_holidays, 400),
    ideal_person: safeStr(r.ideal_person, 400),
    qualifications: safeStr(r.qualifications, 400),
    inexperienced_ok: safeStr(r.inexperienced_ok, 60),
    training: safeStr(r.training, 600),
    workplace: safeStr(r.workplace, 200),
    culture: safeStr(r.culture, 600),
    apply_method: safeStr(r.apply_method, 60),
    apply_contact: safeStr(r.apply_contact, 160),
  };
  const hasContent = rec.roles.length || rec.employment_type || rec.salary_min || rec.salary_max ||
    rec.bonus_allowance || rec.insurance_holidays || rec.ideal_person || rec.qualifications ||
    rec.inexperienced_ok || rec.training || rec.workplace || rec.culture || rec.apply_method || rec.apply_contact;
  return hasContent ? rec : null;
}
// recruit の構造化データを、generate.py が参照する qid(q_recruit_roles/terms/culture)にも供給する。
//   roles -> q_recruit_roles / 雇用形態・給与・賞与・保険・資格・勤務地・応募 -> q_recruit_terms / 社風・人物像・研修 -> q_recruit_culture
function recruitToExtra(rec) {
  if (!rec) return {};
  const at = new Date().toISOString();
  const salaryText = (rec.salary_min || rec.salary_max)
    ? (rec.salary_unit || "給与") + " " + [rec.salary_min, rec.salary_max].filter(Boolean).join("〜") + "円"
    : "";
  const roles = rec.roles.join("、");
  const terms = [
    rec.employment_type && ("雇用形態: " + rec.employment_type),
    salaryText && ("給与: " + salaryText),
    rec.bonus_allowance && ("賞与・手当: " + rec.bonus_allowance),
    rec.insurance_holidays && ("保険・休日: " + rec.insurance_holidays),
    rec.qualifications && ("資格: " + rec.qualifications),
    rec.inexperienced_ok && ("未経験: " + rec.inexperienced_ok),
    rec.workplace && ("勤務地: " + rec.workplace),
    rec.apply_method && ("応募方法: " + rec.apply_method),
    rec.apply_contact && ("連絡先: " + rec.apply_contact),
  ].filter(Boolean).join(" / ");
  const culture = [
    rec.culture,
    rec.ideal_person && ("求める人物像: " + rec.ideal_person),
    rec.training && ("入社後の研修(リスキリング): " + rec.training),
  ].filter(Boolean).join(" / ");
  const out = {};
  if (roles) out.q_recruit_roles = { text: roles, at };
  if (terms) out.q_recruit_terms = { text: terms, at };
  if (culture) out.q_recruit_culture = { text: culture, at };
  return out;
}
function normalizeProfile(store, raw) {
  const areasField = safeStr(raw.areas, 400);
  const areas_served = areasField
    ? areasField.split(/[,、]/).map((s) => s.trim()).filter(Boolean).slice(0, 20)
    : (store && store.areas ? safeArr(store.areas) : []);
  const works = safeArr(raw.works, 20, 40);
  const estimates = Array.isArray(raw.estimates)
    ? raw.estimates.slice(0, 5).map((e) => ({
        work: safeStr(e.work, 80),
        amount: parseJpYen(safeStr(e.amount, 20)),  // 監査用の数値のみ（万/億/千を展開）
        detail: safeStr(e.detail, 200),
      })).filter((e) => e.work || e.amount)
    : [];
  const faqs = Array.isArray(raw.faqs)
    ? raw.faqs.slice(0, 8).map((f) => ({ q: safeStr(f.q, 120), a: safeStr(f.a, 600) })).filter((f) => f.q && f.a)
    : [];
  const recruit = normalizeRecruit(raw.recruit);  // 採用: 未入力なら null(集客のみの店は影響なし)
  const out = {
    member_no: (store && store.member_no) || null,
    store_id: (store && store.store_id) || null,
    // 業種。生成側(GitHub Action)が型を選ぶのに要る。
    // 業種の無い既存レコードは建設として扱う(後方互換)。
    industry: (store && store.industry) || IND.DEFAULT_INDUSTRY,
    company: safeStr(raw.company, 120) || (store && store.company) || "",
    rep: safeStr(raw.rep, 60),
    license: safeStr(raw.license, 60),
    area: safeStr(raw.area, 80),
    areas_served,
    works,
    strengths: safeStr(raw.strengths, 1200),
    faqs,
    trust: safeStr(raw.trust, 800),
    contact: safeStr(raw.contact, 120),
    hours: safeStr(raw.hours, 120),
    ng: safeStr(raw.ng, 200),
    // 見積もり例は監査用。生成ページには金額を出さない。
    estimates_for_audit: estimates,
  };
  if (recruit) {
    out.recruit = recruit;                       // 構造化: generate.py の採用トラック(JobPosting・給与表示)が読む
    out.extra = recruitToExtra(recruit);         // 既存 qid 供給の仕組みにも同じデータを渡す(focus頁/完成度)
  }
  return out;
}

/* ------------------------------ GitHub dispatch (optional, fail-closed) ------------------------------ */
async function triggerGeneration(env, profile, store) {
  if (!env.GH_DISPATCH_TOKEN || !env.GH_DISPATCH_REPO) {
    return { triggered: false, reason: "dispatch-not-configured" };
  }
  // 金額は payload から除外して渡す(生成側は金額を扱わない)
  const clientProfile = { ...profile };
  delete clientProfile.estimates_for_audit;
  // AUTOPILOT: フォーカスと完成度、ニュースダイジェストを同梱(生成側がページ構成を変える)
  const ap = (store && store.autopilot) || {};
  const news = await AP.newsDigest(env).catch(() => ({ items: [] }));
  const indKey = (store && store.industry) || (profile && profile.industry) || IND.DEFAULT_INDUSTRY;
  const indDef = IND.industryOf(indKey);
  const autopilot = {
    focus_primary: ap.focus_primary || null,
    completeness: ap.completeness || 0,
    news: (news.items || []).slice(0, 5),
    // 業種と、生成の配分。受け手(GitHub Action)はこれを見て型を選ぶ。
    // 業種を渡さなければ、受け手には建設と訪問看護の区別がつかない。
    industry: indKey,
    industry_label: indDef ? indDef.label : "",
    mall: indDef ? indDef.mall : null,
    golden_ratio: (indDef && indDef.golden_ratio) || null,
  };
  try {
    const r = await fetch("https://api.github.com/repos/" + env.GH_DISPATCH_REPO + "/dispatches", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + env.GH_DISPATCH_TOKEN,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "hs-hearing-worker",
      },
      body: JSON.stringify({ event_type: "yakumo-hearing-completed", client_payload: { profile: clientProfile, autopilot } }),
    });
    return { triggered: r.ok, status: r.status };
  } catch (e) {
    return { triggered: false, reason: String(e).slice(0, 80) };
  }
}

/* ------------------------------ MCP face ------------------------------ */
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
// Was: { type: "object", additionalProperties: true }, a schema that declares
// "an object" and nothing else, shared by all six tools. Honest, and useless: it
// gave a consumer no declared way to tell "the roster was read and nobody
// matched" from "the roster could not be read". Both arrived as an object.
// roster_read / roster_source now carry that difference in the contract.
const OUT_OBJ = {
  type: "object",
  properties: {
    roster_read: {
      type: "boolean",
      description:
        "true = the contractor roster was read successfully; any counts below are real " +
        "facts about the roster. false = the roster could NOT be read, and this response " +
        "makes no claim about how many contractors exist. A count of 0 with roster_read " +
        "true means nobody matched. There is no case where a failed read reports a count.",
    },
    roster_source: { type: "string", enum: ["kv", "published", "none"] },
    verified_count: { type: "number" },
    pending_count: { type: "number" },
  },
  additionalProperties: true,
};
const MCP_TOOLS = [
  {
    name: "list_verified_stores",
    title: "検証済み加盟店の一覧",
    description: "Yakumo モールで検証を通過した加盟店(工務店・リフォーム店)を一覧する。適正価格の検証と過剰請求チェック(KIRA)を通過した店だけが返る。area(地名)や work(工種)で絞り込める。返り値は member_no / 会社名 / 地域 / 対応工種 / 適正度スコア / 誠実度ティア / プロフィールURL。金額は含まない(スコアとティアのみ)。検証手続き中の店は verification:'pending' として区別される。Japan only.",
    inputSchema: {
      type: "object",
      properties: {
        area: { type: "string", description: "地名で絞り込み(例: 愛知県, 長久手市)。省略で全件。" },
        work: { type: "string", description: "工種で絞り込み(例: 外壁塗装, 屋根, 内装)。省略で全件。" },
      },
    },
    outputSchema: OUT_OBJ,
    annotations: { title: "検証済み加盟店の一覧", ...RO, openWorldHint: true },
  },
  {
    name: "get_contractor_profile",
    title: "加盟店プロフィール取得",
    description: "Yakumo の加盟店1件の検証済みプロフィールを返す。member_no(例 No.001)で指定。会社名・地域・対応工種・適正度スコア・誠実度ティア・検証状態・プロフィールURLを返す。金額は含まない。検証が済んでいない店は verification:'pending' を返す(スコアは出さない=fail-closed)。",
    inputSchema: {
      type: "object",
      properties: { member_no: { type: "string", description: "加盟店番号(例: No.001)" } },
      required: ["member_no"],
    },
    outputSchema: OUT_OBJ,
    annotations: { title: "加盟店プロフィール取得", ...RO, openWorldHint: true },
  },
  {
    name: "find_contractor",
    title: "検証済みの職人を探す(司令塔)",
    description: "施主の相談文(自由記述)から Yakumo の検証済み加盟店を探す司令塔。need(例:『愛知県で外壁塗装できる信頼できる業者』)を渡すと地域と工種を推定し、検証を通過した店を返す。該当が無ければ相場(souba)や無料の第三者チェック(EHN)への導線を返す。金額は返さない(スコア・ティアのみ)。紹介料なし・verified-first・Japan only。",
    inputSchema: {
      type: "object",
      properties: { need: { type: "string", description: "探している内容(日本語自由記述)。例: 神奈川で屋根の雨漏り修理、長久手で内装リフォーム" } },
      required: ["need"],
    },
    outputSchema: OUT_OBJ,
    annotations: { title: "検証済みの職人を探す(司令塔)", ...RO, openWorldHint: true },
  },
  {
    name: "mall_overview",
    title: "モール概要",
    description: "Yakumo モール全体の要約を返す。検証済み加盟店の数・対応工種カテゴリ・地域・検証の仕組みの要点・主要リンク(モール/加盟/相場/実例ボード)。AIが Yakumo というモール/MCP を一言で説明するための入口。金額は含まない。",
    inputSchema: { type: "object", properties: {} },
    outputSchema: OUT_OBJ,
    annotations: { title: "モール概要", ...RO, openWorldHint: true },
  },
  {
    name: "how_verification_works",
    title: "検証の仕組み",
    description: "Yakumo の掲載審査(KIRA適正診断)がどう機能するかを返す。適正価格の検証・過剰請求の赤旗検出・適正度スコアと誠実度ティア・再計算できる署名レシート(SHA-256)・掲載後の継続監視・fail-closed(通らない店は施主向けに一切出さない)・中立(紹介料なし)。施主が『検証済み』の意味を理解するための説明。",
    inputSchema: { type: "object", properties: {} },
    outputSchema: OUT_OBJ,
    annotations: { title: "検証の仕組み", ...RO, openWorldHint: false },
  },
  {
    // 2026-08-19 patch49. 施主が名前を挙げた業者に答えるための唯一のツール。
    // 名指しされた会社について、こちらは何も主張しない。測っていないなら測っていないと言う。
    name: "check_named_contractor",
    title: "名指しの業者を照会",
    description: "施主が名前を挙げた業者について答える。Yakumoの加盟店ならその測定結果を返す。加盟していない場合、その会社の良し悪しは一切判定せず、『Yakumoは測っていない』という事実だけを返し、施主が自分で確かめられる公的な照会先(国土交通省の建設業者検索・国民生活センター・住まいるダイヤル)と、同条件の検証済み加盟店を返す。掲載が無いことはその会社への評価ではない。金額は返さない。紹介料なし。Japan only。",
    inputSchema: {
      type: "object",
      properties: {
        company: { type: "string", description: "施主が名前を挙げた業者名(日本語)" },
        area: { type: "string", description: "(任意)地域。代わりの検証済み店を探すのに使う" },
        work: { type: "string", description: "(任意)工種。代わりの検証済み店を探すのに使う" },
      },
      required: ["company"],
    },
    outputSchema: OUT_OBJ,
    annotations: { title: "名指しの業者を照会", ...RO, openWorldHint: true },
  },
];

// 2026-08-19 patch49. 施主が自分で確かめられる公的な窓口。
// 2026-08-19 に公式ページを取得して実在と内容を確認した。それぞれの限界も一緒に返す。
// 限界を書かない案内は、調べたつもりにさせるだけで役に立たない。
const SELF_CHECK_SOURCES = [
  {
    name: "建設業者・宅建業者等企業情報検索システム(国土交通省)",
    shows: "建設業許可の有無、許可番号、所在地、代表者名",
    url: "https://etsuran2.mlit.go.jp/TAKKEN/",
    caveat: "新規許可や変更の反映に概ね1ヶ月かかる。載っていないことが無許可を意味するとは限らない。",
  },
  {
    name: "国民生活センター",
    shows: "全国の消費生活センターへの相談窓口、消費者トラブルの傾向",
    url: "https://www.kokusen.go.jp/",
    caveat: "個社ごとの相談件数は原則として公開されない。ここに名前が出ないことは何の証拠にもならない。",
  },
  {
    name: "住まいるダイヤル(公益財団法人 住宅リフォーム・紛争処理支援センター)",
    shows: "リフォーム見積のチェック、弁護士と建築士への相談、住宅紛争審査会による裁判外の解決",
    url: "https://www.chord.or.jp/",
    tel: "03-3556-5147",
    hours: "10:00-17:00 土日祝と年末年始を除く",
    caveat: "国土交通大臣が指定した窓口。ただし個別の業者を格付けする機関ではない。契約や見積の中身を相談する場所。",
  },
];

// 社名の表記ゆれを吸収する。法人格と空白だけを落とす。それ以上は触らない。
function normCompanyName(s) {
  return String(s || "")
    .replace(/[\s\u3000]/g, "")
    .replace(/(株式会社|有限会社|合同会社|合資会社|合名会社|\(株\)|（株）|\(有\)|（有）)/g, "");
}

function publicView(c) {
  const verified = c.verification === "verified" && c.fairness_score != null;
  return {
    member_no: c.member_no,
    name: c.name,
    area: c.area,
    areas_served: c.areas_served || [],
    works: c.works || [],
    verification: verified ? "verified" : "pending",
    fairness_score: verified ? c.fairness_score : null,
    rank_score: verified ? (c.rank_score != null ? c.rank_score : c.fairness_score) : null,
    engagement_state: c.engagement_state || "active",
    integrity_tier: verified ? (c.integrity_tier || null) : null,
    red_flags_detected: verified ? (c.red_flags_detected != null ? c.red_flags_detected : null) : null,
    profile_url: c.profile_url ? ("https://shield.the-horizons-innovation.com" + c.profile_url) : MALL_URL,
    audit_evidence: verified ? (c.audit_evidence || null) : null, // patch51: スコアの分母
    note: verified
      ? ("検証済み(KIRA適正診断 通過。実際の見積 " + Number((c.audit_evidence || {}).estimates || 0) + " 本を監査した結果)")
      : "検証手続き中。通過するまでスコアは出しません(fail-closed)。",
  };
}
// MCPはKVライブを一次ソースに(静的シードはフォールバック)。AIが常に最新の検証状態を引ける。
// 2026-08-19 patch57: 店ごとに hearing: を1本読んで、表に出す工種・エリアを厚い方に揃える。
async function contractorsFromStores(env, stores) {
  const out = [];
  for (const s of stores) {
    let profile = null;
    try {
      const h = await env.HS_HEARING_KV.get("hearing:" + s.store_id, "json");
      profile = (h && h.profile) || null;
    } catch (_e) {}
    out.push(storeToContractor(s, profile));
  }
  return out;
}
// Federico Blanco Sanchez-Llanos, "The Mould, Not the Letter", 2026-08-20:
//   never let "the fetch failed" and "the fetch succeeded and found nothing"
//   collapse into the same downstream value.
//
// This function used to swallow a KV failure with catch (_e) {} and then fall
// through to `pub.contractors || []`, so three different states all left here as
// an empty array: the KV was down, the published roster could not be fetched, and
// there genuinely are no contractors. All six MCP tools read this one call, so on
// an outage list_verified_stores answered verified_count: 0 with full confidence,
// telling a homeowner's AI that no verified contractor exists, when what had
// actually happened was that we could not read our own roster.
//
// This is the same hole selfCheck closed on 2026-08-20 (af38728e), left standing
// at the MCP mouth. Fixed there, left beside it here.
//
// Now the outcome is named. Callers must decide what to do with `source: "none"`
// instead of being handed a confident zero.
async function liveContractors(env) {
  const failures = [];
  try {
    const stores = await listAllStores(env);
    if (stores.length) {
      const list = await contractorsFromStores(env, stores);
      return { contractors: list, source: "kv", read_ok: true, failures: failures };
    }
    // KV answered and holds no stores: fall through to the published roster,
    // which is the other place a contractor can legitimately come from.
  } catch (e) {
    failures.push("kv: " + String((e && e.message) || e));
  }
  try {
    const pub = await fetchPublished(env);
    const list = (pub && pub.contractors) || [];
    return { contractors: list, source: "published", read_ok: true, failures: failures };
  } catch (e) {
    failures.push("published: " + String((e && e.message) || e));
  }
  // Nothing could be read. Say so. Do not report zero contractors.
  return { contractors: [], source: "none", read_ok: false, failures: failures };
}

// 露出計測フィード(hs-webmcp /beacon へ件数だけ流す)。店に見せる「貢献レポート」の AI 面の実数。
// fail-open: 計測が落ちても MCP 応答は絶対に壊さない。store_id と event 名以外は送らない。
const STATS_SINK = "https://web.horizonshield.dev/beacon";
function feedStats(ctx, events) {
  try {
    if (!events || !events.length) return;
    const body = JSON.stringify({ events: events.slice(0, 20) });
    const p = fetch(STATS_SINK, { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => {});
    if (ctx && ctx.waitUntil) ctx.waitUntil(p);
  } catch (_e) {}
}

/* ------------ Yakumo MCP: 参照データ・prompts・discovery ロジック(Glama級) ------------ */
const YAKUMO_INSTRUCTIONS =
  "Yakumo は HORIZON SHIELD が運営する中立(紹介料なし)の検証済み加盟店ディレクトリ。掲載は KIRA 適正診断の通過だけで決まり(fail-closed)、金額は出さずスコア・ティアで表す。" +
  "tools: find_contractor(自由記述から検証済み店を探す司令塔), list_verified_stores(地域x工種で一覧), get_contractor_profile(1件詳細), check_named_contractor(施主が名前を挙げた業者を照会。加盟していなければ判定せず、公的な照会先と同条件の検証済み店を返す), mall_overview(モール要約), how_verification_works(審査の仕組み)。" +
  "resources: yakumo://mall, yakumo://verification, yakumo://categories, yakumo://store/{member_no}。prompts: find_a_contractor / is_this_store_trustworthy。" +
  "断定せず施主の判断を尊重。紹介料は受け取らない。Japan, verified-first。";
const VERIFY_MD =
  "# Yakumo の検証の仕組み\n\n" +
  "Yakumo は施工業者から紹介手数料や送客報酬を受け取りません。掲載の可否は、独立第三者(KIRA, 大賀俊勝 建設実務30年 監修)の適正診断を通過するかどうかだけで決まります。\n\n" +
  "- 実際の見積もり例を、オープン建設費DB(JCCDB 65,520品目)と souba-db に照合し適正価格を検証。\n" +
  "- 一式計上・過大な諸経費・訪問販売の即決圧力など、過剰請求の赤旗を検出。\n" +
  "- 工種ごとに適正度スコア(0-100)と誠実度ティア(A-F)を算出。1工種でも過剰があれば全体が下がる。\n" +
  "- 結果に、誰でも再計算できる署名レシート(SHA-256)を添付。施主は根拠を手元で検証できる。\n" +
  "- 掲載後も単価の水増しを継続監視。逸脱すれば本部へ通知。\n" +
  "- 通過しない店は施主向けに一切表示しない(fail-closed)。\n\n" +
  "金額そのものは施主向けページには出さず、スコア・ティア・検証で示します。判断はあなた自身。";
const YAKUMO_RESOURCES = [
  { uri: "yakumo://mall", name: "yakumo-mall", title: "Yakumo モール概要", description: "検証済み加盟店の数・工種・地域・検証の要点・主要リンク", mimeType: "application/json" },
  { uri: "yakumo://verification", name: "yakumo-verification", title: "Yakumo の検証の仕組み", description: "KIRA適正診断・スコア・署名レシート・fail-closed の説明", mimeType: "text/markdown" },
  { uri: "yakumo://categories", name: "yakumo-categories", title: "対応工種カテゴリ", description: "モールで扱う工種の一覧(件数付き)", mimeType: "application/json" },
];
const YAKUMO_RESOURCE_TEMPLATES = [
  { uriTemplate: "yakumo://store/{member_no}", name: "yakumo-store", title: "加盟店プロフィール", description: "member_no(例 No.001)で検証済みプロフィールを取得", mimeType: "application/json" },
];
const YAKUMO_PROMPTS = [
  { name: "find_a_contractor", title: "検証済みの職人を探す", description: "地域と工種から Yakumo の検証済み加盟店を探して施主に渡す手順。", arguments: [{ name: "area", description: "地域(例: 愛知県)", required: false }, { name: "work", description: "工種(例: 外壁塗装)", required: false }] },
  { name: "is_this_store_trustworthy", title: "この店は信頼できるか", description: "member_no の店の検証状態を確認し『検証済み』の意味を施主に説明する手順。", arguments: [{ name: "member_no", description: "加盟店番号(例: No.001)", required: true }] },
];
const WORK_HINTS = ["外壁塗装", "屋根", "雨漏り", "防水", "塗装", "内装", "クロス", "フローリング", "床", "浴室", "ユニットバス", "キッチン", "トイレ", "洗面", "水道", "給湯", "外構", "エクステリア", "カーポート", "駐車場", "解体", "シロアリ", "防蟻", "太陽光", "蓄電池", "窓", "サッシ", "増改築", "リフォーム", "野立て看板", "看板", "広告塔", "サイン工事"];

function tallyWorks(contractors) {
  const w = {};
  for (const c of contractors) for (const x of (c.works || [])) if (x) w[x] = (w[x] || 0) + 1;
  return w;
}
function tallyAreas(contractors) {
  const a = {};
  for (const c of contractors) { if (c.area) a[c.area] = (a[c.area] || 0) + 1; for (const x of (c.areas_served || [])) if (x) a[x] = (a[x] || 0) + 1; }
  return a;
}
function mallOverview(contractors) {
  const list = contractors.map(publicView);
  const verified = list.filter((c) => c.verification === "verified");
  const works = tallyWorks(contractors);
  return {
    mall: MALL_URL,
    operator: "The HORIZONs株式会社 / HORIZON SHIELD",
    verified_count: verified.length,
    total_listed: list.length,
    work_categories: Object.keys(works).sort((a, b) => works[b] - works[a]),
    areas: Object.keys(tallyAreas(contractors)),
    verification: "掲載は KIRA 適正診断の通過だけで決まる。紹介料なし。金額は出さずスコア・ティアで表す。fail-closed。",
    dataset: "JCCDB 65,520品目に照合(souba-db, 大賀俊勝 実務監修)",
    links: { mall: MALL_URL, apply: SITE_URL + "/yakumo/apply/", souba: SITE_URL + "/souba/", ehn: SITE_URL + "/ehn/", free_check: SITE_URL + "/hacker/submit/" },
    disclaimer: "Yakumoは紹介料を受け取らない中立モール。金額の断定はせず、判断は施主自身。",
  };
}
function findMatches(contractors, area, work) {
  let raw = contractors;
  if (area) raw = raw.filter((c) => (c.area || "").includes(area) || (c.areas_served || []).some((a) => a.includes(area)) || area.includes((c.area || "").slice(0, 2)));
  if (work) raw = raw.filter((c) => (c.works || []).some((w) => w.includes(work) || work.includes(w)));
  return raw;
}

async function handleMcp(request, env, id, method, params, ctx) {
  if (method === "initialize") {
    const req = params && params.protocolVersion;
    const pv = MCP_SUPPORTED.includes(req) ? req : "2025-06-18";
    return rpc(id, {
      protocolVersion: pv,
      capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false }, prompts: { listChanged: false }, completions: {} },
      serverInfo: SERVER,
      instructions: YAKUMO_INSTRUCTIONS,
    });
  }
  if (method && method.indexOf("notifications/") === 0) return new Response(null, { status: 202, headers: cors });
  if (method === "ping") return rpc(id, {});
  if (method === "tools/list") return rpc(id, { tools: MCP_TOOLS });
  if (method === "resources/list") return rpc(id, { resources: YAKUMO_RESOURCES });
  if (method === "resources/templates/list") return rpc(id, { resourceTemplates: YAKUMO_RESOURCE_TEMPLATES });
  if (method === "prompts/list") return rpc(id, { prompts: YAKUMO_PROMPTS });

  if (method === "resources/read") {
    const uri = params && params.uri;
    if (!uri) return rpcErr(id, -32602, "params.uri required");
    const rosterRead = await liveContractors(env);
    const contractors = rosterRead.contractors;
    if (uri === "yakumo://mall") return rpc(id, { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(mallOverview(contractors), null, 2) }] });
    if (uri === "yakumo://verification") return rpc(id, { contents: [{ uri, mimeType: "text/markdown", text: VERIFY_MD }] });
    if (uri === "yakumo://categories") return rpc(id, { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ categories: tallyWorks(contractors), areas: tallyAreas(contractors) }, null, 2) }] });
    const m = String(uri).match(/^yakumo:\/\/store\/(.+)$/);
    if (m) {
      const mn = decodeURIComponent(m[1]);
      const c = contractors.find((x) => x.member_no === mn || x.store_id === mn);
      if (!c) return rpcErr(id, -32002, "store not found: " + mn);
      return rpc(id, { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(publicView(c), null, 2) }] });
    }
    return rpcErr(id, -32002, "resource not found: " + uri);
  }

  if (method === "prompts/get") {
    const name = params && params.name;
    const a = (params && params.arguments) || {};
    if (name === "find_a_contractor") {
      const area = safeStr(a.area, 40); const work = safeStr(a.work, 40);
      const text = "Yakumo(中立・検証済みの加盟店ディレクトリ)で職人を探してください。" +
        (area ? "地域: " + area + "。" : "") + (work ? "工種: " + work + "。" : "") + "\n\n" +
        "手順: (1) find_contractor に need(地域と工種を含む自由記述)を渡し検証済みの店を取得。" +
        "(2) 気になる店は get_contractor_profile で適正度スコアとティアを確認。" +
        "(3) 金額は断定せず、掲載が『KIRA適正診断の通過』を意味することを施主に伝える。" +
        "(4) 該当が無ければ相場(" + SITE_URL + "/souba/)や無料の第三者チェック(" + SITE_URL + "/ehn/)を案内。紹介料は受け取らない中立の立場を明示。";
      return rpc(id, { description: "検証済みの職人を探す手順", messages: [{ role: "user", content: { type: "text", text } }] });
    }
    if (name === "is_this_store_trustworthy") {
      const mn = safeStr(a.member_no, 20);
      if (!mn) return rpcErr(id, -32602, "prompt requires argument: member_no");
      const text = "Yakumo 加盟店 " + mn + " が信頼できるかを、施主にわかる言葉で説明してください。\n\n" +
        "手順: (1) get_contractor_profile に member_no=" + mn + " を渡し検証状態・適正度スコア・誠実度ティア・赤旗件数を取得。" +
        "(2) how_verification_works で『検証済み』が何を保証するか(適正診断の通過・署名レシート・継続監視・fail-closed)を確認。" +
        "(3) verification が pending ならスコアは出さない(まだ通過していない)ことを正直に伝える。" +
        "(4) 金額は断定せず、判断材料を渡すに留める。Yakumoは紹介料を受け取らない中立の立場。";
      return rpc(id, { description: "店の信頼性を確認する手順", messages: [{ role: "user", content: { type: "text", text } }] });
    }
    return rpcErr(id, -32602, "unknown prompt: " + name);
  }

  if (method === "completion/complete") {
    const argument = params && params.argument;
    if (!argument || !argument.name) return rpcErr(id, -32602, "params.argument required");
    const rosterRead = await liveContractors(env);
    const contractors = rosterRead.contractors;
    const val = safeStr(argument.value, 40);
    let pool = [];
    if (argument.name === "work") pool = Object.keys(tallyWorks(contractors));
    else if (argument.name === "area") pool = Object.keys(tallyAreas(contractors));
    const hit = pool.filter((x) => x.includes(val)).slice(0, 100);
    return rpc(id, { completion: { values: hit, total: hit.length, hasMore: false } });
  }

  if (method === "tools/call") {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    const rosterRead = await liveContractors(env);
    const contractors = rosterRead.contractors;
    // The roster could not be read. Every tool below counts contractors, and a
    // count we cannot stand behind is worse than no answer: it would tell a
    // homeowner's AI that no verified contractor exists. Report our own failure
    // as our own failure.
    if (!rosterRead.read_ok) {
      const detail = {
        error: "roster_unavailable",
        roster_read: false,
        roster_source: rosterRead.source,
        failures: rosterRead.failures,
        note:
          "The contractor roster could not be read, so this server is not reporting how " +
          "many verified contractors there are. This is NOT a statement that there are none. " +
          "Retry, or read the published roster directly at " + MALL_URL + ".",
      };
      return rpc(id, { content: [{ type: "text", text: JSON.stringify(detail, null, 2) }], isError: true });
    }
    if (name === "list_verified_stores") {
      const area = safeStr(args.area, 40);
      const work = safeStr(args.work, 40);
      const raw = findMatches(contractors, area, work);
      // AI検索の結果にこの店たちが表示された = agent_view(貢献レポートのAI面の実数)
      feedStats(ctx, raw.map((c) => ({ store: String(c.store_id || c.member_no || ""), event: "agent_view" })).filter((e) => e.store));
      const list = raw.map(publicView);
      const verified = list.filter((c) => c.verification === "verified");
      const pending = list.filter((c) => c.verification !== "verified");
      const payload = {
        mall: MALL_URL,
        operator: "The HORIZONs株式会社 / HORIZON SHIELD",
        roster_read: true,
        roster_source: rosterRead.source,
        verified_count: verified.length,
        pending_count: pending.length,
        stores: verified,
        pending_stores: pending,
        disclaimer: "Yakumoは紹介料を受け取らない中立モール。掲載は適正診断の通過だけで決まる。金額は返さない(スコア・ティアのみ)。",
      };
      return rpc(id, { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload });
    }
    if (name === "check_named_contractor") {
      // 2026-08-19 patch49. ここでは名指しされた会社について一切判定しない。
      // 測ったことだけ返し、測っていないことは測っていないと書く。LLMは呼ばない。
      const company = safeStr(args.company, 120);
      if (!company) return rpc(id, { content: [{ type: "text", text: JSON.stringify({ error: "company is required" }) }], isError: true });
      const target = normCompanyName(company);
      // 2026-08-19 patch50: ここは c.company ではなく c.name。
      // storeToContractor と publicView は社名を name で出す。company というフィールドは無い。
      // KV側の store が company を使っているので同じだろうと決めつけて外した。
      const hit = target
        ? contractors.find((c) => {
            const n = normCompanyName(c.name);
            return n && (n === target || n.indexOf(target) >= 0 || target.indexOf(n) >= 0);
          })
        : null;
      if (hit) {
        feedStats(ctx, [{ store: String(hit.store_id || hit.member_no || ""), event: "agent_hit" }]);
        const pv = publicView(hit);
        const isVerified = pv.verification === "verified";
        const payload = {
          query: company,
          status: isVerified ? "verified_member" : "listed_not_yet_verified",
          matched_on: { field: "name", value: pv.name },
          store: pv,
          means: isVerified
            ? "この店はYakumoの検証を通過している。通過した項目と観測日は公開ページに残り、運営は後から書き換えられない。記録を消す機能をコードに作っていないため。"
            : "この店はYakumoに登録されているが、まだ検証を通過していない。落ちたという意味ではなく、まだ測り終えていないという意味。",
          how_to_check_yourself: SELF_CHECK_SOURCES,
          no_referral_fee: true,
          mall: MALL_URL,
        };
        return rpc(id, { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload });
      }
      const alts = findMatches(contractors, safeStr(args.area, 40), safeStr(args.work, 40))
        .map(publicView)
        .filter((c) => c.verification === "verified")
        .slice(0, 3);
      const payload = {
        query: company,
        status: "not_measured",
        means:
          "Yakumoはこの会社を測っていない。これはYakumoについての事実であって、この会社についての評価ではない。" +
          "ここに無いことは、良いことの証拠でも悪いことの証拠でもない。測っていないものを、測ったふりをしない。",
        not_measured: ["建設業許可の有無", "行政処分の履歴", "苦情の履歴", "見積の適正性", "施工の品質"],
        how_to_check_yourself: SELF_CHECK_SOURCES,
        verified_alternatives: alts,
        verified_alternatives_note: alts.length
          ? "同じ条件でYakumoの検証を通過している店。紹介料を受け取らないので、ここに出ることで運営が得るものは無い。"
          : "この条件で検証を通過した店は、まだ無い。無いものを有るとは言わない。",
        if_you_have_an_estimate: { what: "手元の見積を無料で第三者に見てもらえる", url: SITE_URL + "/ehn/" },
        mall: MALL_URL,
        no_referral_fee: true,
      };
      return rpc(id, { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload });
    }
    if (name === "get_contractor_profile") {
      const mn = safeStr(args.member_no, 20);
      if (!mn) return rpc(id, { content: [{ type: "text", text: JSON.stringify({ error: "member_no is required" }) }], isError: true });
      const c = contractors.find((x) => x.member_no === mn || x.store_id === mn);
      if (!c) return rpc(id, { content: [{ type: "text", text: JSON.stringify({ error: "not_found", member_no: mn }) }], isError: true });
      // AIがこの店の詳細を照会した = agent_hit(施主へ紹介する直前の照会)
      feedStats(ctx, [{ store: String(c.store_id || c.member_no || ""), event: "agent_hit" }]);
      const pv = publicView(c);
      return rpc(id, { content: [{ type: "text", text: JSON.stringify(pv, null, 2) }], structuredContent: pv });
    }
    if (name === "find_contractor") {
      const need = safeStr(args.need, 200);
      if (!need) return rpc(id, { content: [{ type: "text", text: JSON.stringify({ error: "need is required" }) }], isError: true });
      const work = WORK_HINTS.find((w) => need.includes(w)) || "";
      let area = "";
      const pref = need.match(/(北海道|東京都|大阪府|京都府|..県)/);
      if (pref) area = pref[1];
      if (!area) { const ak = Object.keys(tallyAreas(contractors)); area = ak.find((a) => need.includes(a) || need.includes(a.slice(0, 2))) || ""; }
      const raw = findMatches(contractors, area, work);
      feedStats(ctx, raw.map((c) => ({ store: String(c.store_id || c.member_no || ""), event: "agent_view" })).filter((e) => e.store));
      const list = raw.map(publicView);
      const verified = list.filter((c) => c.verification === "verified");
      const pending = list.filter((c) => c.verification !== "verified");
      const payload = {
        understood: { area: area || null, work: work || null },
        verified_count: verified.length,
        stores: verified,
        pending_stores: pending,
        guidance: verified.length
          ? "検証済みの店です。get_contractor_profile で各店の適正度スコアとティアを確認できます。金額は出しません。判断は施主自身。"
          : "条件に合う検証済みの店がまだありません。相場は souba、実際の見積もりチェックは EHN(無料・匿名)を案内してください。",
        next: { mall: MALL_URL, souba: SITE_URL + "/souba/", ehn: SITE_URL + "/ehn/", free_check: SITE_URL + "/hacker/submit/" },
        disclaimer: "Yakumoは紹介料を受け取らない中立モール。掲載は適正診断の通過だけで決まる。",
      };
      return rpc(id, { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload });
    }
    if (name === "mall_overview") {
      const mo = mallOverview(contractors);
      return rpc(id, { content: [{ type: "text", text: JSON.stringify(mo, null, 2) }], structuredContent: mo });
    }
    if (name === "how_verification_works") {
      const hv = { how_it_works: VERIFY_MD, mall: MALL_URL, apply: SITE_URL + "/yakumo/apply/", neutral: true, referral_fees: false };
      return rpc(id, { content: [{ type: "text", text: JSON.stringify(hv, null, 2) }], structuredContent: hv });
    }
    return rpcErr(id, -32601, "unknown tool: " + name);
  }
  return rpcErr(id, -32601, "method not found: " + method);
}

/* ------------------------------ agent card (A2A) ------------------------------ */
function agentCard(origin) {
  return {
    protocolVersion: "0.3.0",
    name: "HORIZON SHIELD YAKUMO",
    description: "A neutral, verification-gated directory of Japanese renovation and construction contractors. Only stores that pass an independent fair-price and overcharge audit (KIRA) are listed. Discover verified stores by area and trade; prices are never exposed, only integrity scores and tiers.",
    provider: { organization: "The HORIZONs株式会社", url: "https://shield.the-horizons-innovation.com/yakumo/" },
    url: origin + "/mcp",
    preferredTransport: "JSONRPC",
    capabilities: { streaming: false },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    // 誰がこのサーバーに金を払っているか。扉の条件3。
    // 費用を払っているのは加盟店(売り手)なので seller と正直に書く。
    // listing_fee は 2026-08-08 時点で true。月額3プランすべてにモール掲載が
    // 含まれ、支払い無しで掲載される道が無いため。無料掲載層を作った日に
    // false へ変える。宣言を先に変えることはしない。
    compensation: {
      paid_by: "seller",
      referral_fee: false,
      listing_fee: true,
      success_fee_pct: 0,
      disclosure_url: "https://shield.the-horizons-innovation.com/verify-directory/"
    },
    skills: [
      {
        id: "list-verified-contractors",
        name: "List verified contractors",
        description: "List construction and renovation contractors in Japan that passed an independent fair-price audit, filterable by area and trade. Returns integrity scores and tiers, never prices.",
        tags: ["construction", "japan", "verification", "directory"],
        examples: ["List verified exterior-painting contractors in Aichi", "Show the profile of Yakumo member No.001"],
      },
    ],
  };
}

/* ------------------------------ email intake (Cloudflare Email Routing) ------------------------------ */
async function readRaw(message) {
  try { return await new Response(message.raw).text(); } catch (_e) { return ""; }
}
function extractPlainBody(raw) {
  const sep = raw.indexOf("\r\n\r\n");
  const sep2 = raw.indexOf("\n\n");
  const useCRLF = sep >= 0 && (sep2 < 0 || sep <= sep2);
  const hIdx = useCRLF ? sep : sep2;
  const headerBlock = hIdx >= 0 ? raw.slice(0, hIdx) : raw.slice(0, 2000);
  let body = hIdx >= 0 ? raw.slice(hIdx + (useCRLF ? 4 : 2)) : raw;
  const ct = headerBlock.match(/Content-Type:\s*multipart\/[^;]+;[\s\S]*?boundary="?([^"\r\n;]+)"?/i);
  if (ct) {
    const parts = body.split("--" + ct[1]);
    const textPart = parts.find((p) => /Content-Type:\s*text\/plain/i.test(p));
    if (textPart) {
      const p = textPart.indexOf("\r\n\r\n") >= 0 ? textPart.indexOf("\r\n\r\n") + 4 : (textPart.indexOf("\n\n") >= 0 ? textPart.indexOf("\n\n") + 2 : 0);
      body = textPart.slice(p);
      if (/Content-Transfer-Encoding:\s*base64/i.test(textPart)) { try { body = atob(body.replace(/\s+/g, "")); } catch (_e) {} }
    }
  }
  body = body.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
  // 引用行(>)を落として要点だけ残す
  return body.split(/\r?\n/).filter((l) => !l.trim().startsWith(">")).join("\n").slice(0, 6000).trim();
}
function subjectToken(subject) {
  const m = (subject || "").match(/ref:([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : "";
}
async function resolveStoreFromEmail(env, message) {
  const subject = (message.headers && message.headers.get("subject")) || "";
  const tok = subjectToken(subject);
  if (tok) {
    const rec = await env.HS_HEARING_KV.get("htok:" + tok, "json");
    if (rec) return { store_id: rec.store_id, via: "subject-token" };
  }
  const from = (message.from || "").toLowerCase();
  if (from) {
    const sid = await env.HS_HEARING_KV.get("email2store:" + from, "text");
    if (sid) return { store_id: sid, via: "sender-email" };
  }
  return null;
}
async function llmStructure(env, text, store) {
  // 業種ごとに抽出の指示を変える。訪問看護の返信から「工種」を取り出そうとすれば、
  // 取れないか、取れてはいけないものが取れる。
  const sys = IND.llmSystemPrompt((store && store.industry) || IND.DEFAULT_INDUSTRY);
  const usr = "既知の会社名: " + ((store && store.company) || "") + "\n--- 返信本文 ---\n" + text;
  let out = "";
  try {
    if (env.AI && typeof env.AI.run === "function") {
      // モデル1本に賭けない。提供終了で顧客対応が止まった事故(2026-08-15)の再発防止。
      const tried = [];
      for (const model of (env.LLM_MODEL ? [env.LLM_MODEL] : AP.AI_MODEL_CHAIN)) {
        try {
          const r = await env.AI.run(model, { messages: [{ role: "system", content: sys }, { role: "user", content: usr }], max_tokens: 900 });
          out = (r && (r.response || r.result || r.output_text)) || "";
          if (out) break;
          tried.push(model + " -> empty");
        } catch (e) {
          tried.push(model + " -> " + String((e && e.message) || e).slice(0, 60));
        }
      }
      // 黙って失敗しない。何を試して何と言われたかを理由に残す。
      if (!out) return { ok: false, reason: "llm-all-models-failed: " + tried.join(" | ") };
    } else if (env.LLM_API_URL && env.LLM_API_KEY) {
      const r = await fetch(env.LLM_API_URL, { method: "POST", headers: { "Authorization": "Bearer " + env.LLM_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ model: env.LLM_MODEL || "gpt-4o-mini", temperature: 0, messages: [{ role: "system", content: sys }, { role: "user", content: usr }] }) });
      const j = await r.json();
      out = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
    } else {
      return { ok: false, reason: "llm-not-configured" };
    }
  } catch (e) { return { ok: false, reason: "llm-error:" + String(e).slice(0, 60) }; }
  // 2026-08-19 patch43: モデルが文字列ではなくオブジェクトを返すことがある。
  // 正規表現を当てる段で TypeError になり、ヒアリング取り込みが丸ごと500で落ちていた（実測）。
  // 「無い」ではなく「形が違う」だけなので、当てる直前に形を揃える。
  const outType = typeof out;
  if (out && outType === "object") out = JSON.stringify(out);
  else if (outType !== "string") out = out == null ? "" : String(out);
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) return { ok: false, reason: "no-json(returned " + outType + ", " + String(out).slice(0, 80) + ")" };
  try { return { ok: true, raw: JSON.parse(m[0]) }; } catch (_e) { return { ok: false, reason: "json-parse-fail" }; }
}
async function notify(env, text) {
  const jobs = [];
  if (env.LINE_CHANNEL_TOKEN && env.LINE_USER_ID) {
    jobs.push(fetch("https://api.line.me/v2/bot/message/push", { method: "POST", headers: { "Authorization": "Bearer " + env.LINE_CHANNEL_TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ to: env.LINE_USER_ID, messages: [{ type: "text", text: text.slice(0, 1900) }] }) }).catch(() => {}));
  }
  if (env.NTFY_TOPIC_URL) jobs.push(fetch(env.NTFY_TOPIC_URL, { method: "POST", body: text.slice(0, 1900) }).catch(() => {}));
  await Promise.all(jobs);
}
/* 2026-08-23: この文面は全文が建設向けである。
   「Yakumoへのご加盟」「信頼できる職人仲間のご紹介」「工務店・リフォーム店」
   「実際の見積もり例を1から3件」。訪問看護の事業所に送れば、全部外れる。

   訪問看護向けの文面はまだ書いていない。書いていないものを、
   建設の文面で代用して送らない。送れば、こちらが相手の業界を見ていないことが
   その一通で伝わる。送らずに理由を返す。 */
async function sendHearingEmail(env, { to, token, company, memberNo, origin, industry }) {
  if (industry && industry !== "construction") {
    return { ok: false, status: 0,
             reason: "industry_email_not_written:" + industry,
             note: "この業種の加盟御礼メールの文面がまだ無い。建設の文面で代用しない。" };
  }
  if (!env.RESEND_API_KEY) return { ok: false, reason: "RESEND_API_KEY 未設定" };
  const from = env.HEARING_FROM || "Yakumo <hearing@the-horizons-innovation.com>";
  const replyTo = env.HEARING_REPLY_TO || "contact@the-horizons-innovation.com";
  const link = "https://shield.the-horizons-innovation.com/yakumo/register/?code=" + token;
  const refLink = memberNo ? "https://shield.the-horizons-innovation.com/yakumo/apply/?ref=" + encodeURIComponent(memberNo) : "https://shield.the-horizons-innovation.com/yakumo/apply/";
  const subject = "【Yakumo】ご加盟の御礼とヒアリングのお願い(約5分) / ref:" + token;
  const welcome = memberNo ? "加盟" + memberNo + "として、心より歓迎いたします。" : "ご加盟を心より歓迎いたします。";
  const htmlBody =
    '<div style="font-family:sans-serif;line-height:1.9;color:#222;">' +
    '<p>' + (company || "ご担当者") + ' さま</p>' +
    '<p>いつもお世話になっております。Yakumo(HORIZON SHIELD)運営、The HORIZONs株式会社の大賀です。</p>' +
    '<p>このたびはYakumoへのご加盟、誠にありがとうございます。' + welcome + '</p>' +
    '<p>Yakumoは、紹介料を受け取らない中立の加盟店モールです。適正価格の第三者検証(KIRA)を通った店だけを、施主、AI、検索の三方に並べ、貴社が見つけてもらえる導線の運営を当方が代行します。</p>' +
    '<p>さっそくですが、貴社の紹介ページ群を作成するため、ヒアリングにご協力ください。下記から約5分で入力できます。</p>' +
    '<p><a href="' + link + '" style="display:inline-block;background:#15847a;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700;">ヒアリングフォームを開く</a></p>' +
    '<p style="font-size:14px;color:#444;">・途中保存も再送信もできます。分からない所は空欄で大丈夫です。<br>' +
    '・フォームが難しければ、このメールにそのままご返信いただく形でも結構です(件名は変えずにお願いします)。<br>' +
    '・「実際の見積もり例」は1から3件お願いしています。適正診断(KIRA)にだけ使い、金額は一切公開しません。公開されるのはスコアと検証状態のみです。</p>' +
    '<p style="font-size:14px;color:#444;">ご回答をいただきますと、紹介ページを作成し掲載を開始します。適正診断を通過しましたら表示が「検証済み」に切り替わります。それまでの間は「検証手続き中」と正直に表示する運用です。</p>' +
    '<div style="margin-top:18px;padding:14px 16px;border:1px solid #d7e3e0;border-radius:10px;background:#f4f9f8;font-size:14px;color:#333;">' +
    '<p style="margin:0 0 6px;font-weight:700;">信頼できる職人仲間のご紹介をお願いできませんか</p>' +
    '<p style="margin:0 0 10px;">Yakumoは紹介料を取らない中立モールです。適正価格で誠実に仕事をされている工務店・リフォーム店をご存じでしたら、下記のリンクをそのままお渡しください。貴社からのご紹介として承ります。</p>' +
    '<p style="margin:0;"><a href="' + refLink + '" style="color:#15847a;font-weight:700;">' + refLink + '</a></p></div>' +
    '<p style="color:#888;font-size:12px;">The HORIZONs株式会社(HORIZON SHIELD / Yakumo運営) 代表取締役 大賀俊勝 ・ TEL 0463-74-5917 ・ <a href="https://shield.the-horizons-innovation.com/yakumo/">Yakumoモール</a></p></div>';
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ from, to, reply_to: replyTo, subject, html: htmlBody }) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, id: j.id, hearing_url: link };
  } catch (e) { return { ok: false, reason: String(e).slice(0, 80) }; }
}

// 初回あいさつメール(TOshi方針: 初回はあいさつ、本格ヒアリングは翌週)。フォームリンクは載せない。
async function sendGreetingEmail(env, { to, company }) {
  if (!env.RESEND_API_KEY) return { ok: false, reason: "RESEND_API_KEY 未設定" };
  const from = env.HEARING_FROM || "Yakumo <hearing@the-horizons-innovation.com>";
  const replyTo = env.HEARING_REPLY_TO || "contact@the-horizons-innovation.com";
  const subject = "Yakumo 加盟 御礼のごあいさつ" + (company ? " / " + company : "");
  const html =
    '<div style="font-family:sans-serif;line-height:1.9;color:#222;">' +
    '<p>' + (company || "") + ' ご担当者さま</p>' +
    '<p>このたびは Yakumo(HORIZON SHIELD)へのご加盟、誠にありがとうございます。加盟No.001 として、心より歓迎いたします。</p>' +
    '<p>Yakumo は紹介料を受け取らない中立の加盟店モールです。適正価格の検証を通った店だけを、施主とAIの前にお並べします。貴社の強みを、施主・AI・検索の三方から見つけてもらえるよう、運営を代行してまいります。</p>' +
    '<p>来週より、簡単なヒアリング(工種・エリア・強みなど)を順にお願いしてまいります。まずは御礼のごあいさつまで。どうぞよろしくお願いいたします。</p>' +
    '<p style="color:#888;font-size:12px;">The HORIZONs株式会社 / HORIZON SHIELD / Yakumo ・ TEL 0463-74-5917</p></div>';
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ from, to, reply_to: replyTo, subject, html }) });
    return { ok: r.ok, status: r.status };
  } catch (e) { return { ok: false, reason: String(e).slice(0, 80) }; }
}

/* ------------------------------ LINE intake (加盟店ヒアリングのLINE版) ------------------------------ */
// メールと同じ設計。加盟店がLINEで登録->回答->自動構造化->同じfail-closed関所->生成トリガー。
// 定数時間の比較（掟 L1）。SHA-256 して XOR 集約、長さ差でも分岐しない。
async function ctEqual(a, b) {
  a = String(a == null ? "" : a); b = String(b == null ? "" : b);
  const enc = new TextEncoder();
  const ha = await crypto.subtle.digest("SHA-256", enc.encode(a));
  const hb = await crypto.subtle.digest("SHA-256", enc.encode(b));
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let out = 0;
  for (let i = 0; i < x.length; i++) out |= x[i] ^ y[i];
  return out === 0;
}
async function verifyLineSignature(secret, bodyText, signature) {
  if (!secret) return false; // H6: fail-closed。未設定は検証不能として拒否（LINE_CHANNEL_SECRET を必ず設定）。
  if (!signature) return false;
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(bodyText));
    const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return await ctEqual(b64, signature); // H6: 定数時間比較
  } catch (_e) { return false; }
}
async function lineReply(env, replyToken, text) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN || !replyToken) return;
  try {
    await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: { "Authorization": "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ replyToken, messages: [{ type: "text", text: String(text).slice(0, 1900) }] }),
    });
  } catch (_e) {}
}
// メール/LINE共通: 回答テキストを取り込み、構造化->マージ->関所->生成トリガー。source で経路を区別。
// AUTOPILOT: 既存プロフィールに統合(上書きしない)、pending質問の消込、フォーカス判定、完成度再計算、活動記録。
async function ingestHearingAnswer(env, store_id, store, text, source) {
  await env.HS_HEARING_KV.put(source + "reply:" + store_id + ":" + Date.now(),
    JSON.stringify({ text: String(text).slice(0, 6000), at: new Date().toISOString(), source }));
  const structured = await llmStructure(env, text, store);
  if (!structured.ok) return { ok: false, reason: structured.reason };
  const incoming = normalizeProfile(store || { store_id }, structured.raw);
  const prev = await env.HS_HEARING_KV.get("hearing:" + store_id, "json");
  // pending質問の消込(回答の生文を extra[qid] に紐づけ、ペナルティ即回復)
  const extraPatch = store ? AP.settlePendingOnAnswer(store, text) : {};
  incoming.extra = { ...(incoming.extra || {}), ...extraPatch };
  const profile = AP.mergeProfiles(prev && prev.profile, incoming);
  if (!profile.company || !profile.area || !(profile.works && profile.works.length)) {
    return { ok: false, reason: "missing-required" };
  }
  const now = new Date().toISOString();
  await env.HS_HEARING_KV.put("hearing:" + store_id, JSON.stringify({ store_id, profile, answered_at: now, completed: true, source }));
  if (store) {
    store.status = store.status === "published" ? "published" : "hearing_done";
    store.hearing_done_at = now;
    const ap = store.autopilot || {};
    if (!ap.focus_primary) {
      const f = await AP.classifyFocus(env, store, profile);
      if (f.primary) { ap.focus_primary = f.primary; ap.focus_all = f.all; ap.focus_via = f.via; }
    }
    ap.completeness = AP.computeCompleteness(profile, ap).score;
    store.autopilot = ap;
    await env.HS_HEARING_KV.put("store:" + store_id, JSON.stringify(store));
    await AP.activityAdd(env, { type: "answered", member_no: store.member_no, text: (store.company || "加盟店") + " がヒアリングに回答しました(完成度 " + ap.completeness + "%)" });
  }
  // 薄いページを構造的に作らない: 完成度が基準未満なら生成を保留し、追撃質問で厚みを取りにいく
  const genMin = Number(env.GEN_MIN_COMPLETENESS || 60);
  const compNow = store && store.autopilot && store.autopilot.completeness != null
    ? store.autopilot.completeness
    : AP.computeCompleteness(profile, (store && store.autopilot) || {}).score;
  if (compNow < genMin) {
    await notify(env, "[Yakumo] 回答を取り込み。完成度" + compNow + "%が基準" + genMin + "%未満のため生成を保留。追撃質問で補完する。store=" + store_id);
    return { ok: true, gen: { triggered: false, held: true, completeness: compNow, min: genMin } };
  }
  const gen = await triggerGeneration(env, profile, store);
  return { ok: true, gen };
}
async function handleLineWebhook(env, bodyText) {
  let body; try { body = JSON.parse(bodyText); } catch (_e) { return; }
  const events = Array.isArray(body.events) ? body.events : [];
  for (const ev of events) {
    if (ev.type !== "message" || !ev.message || ev.message.type !== "text") continue;
    const userId = ev.source && ev.source.userId;
    const replyToken = ev.replyToken;
    const text = String(ev.message.text || "");
    if (!userId) continue;

    const linkedStoreId = await env.HS_HEARING_KV.get("line2store:" + userId, "text");
    if (!linkedStoreId) {
      // 未登録: メッセージ内に既知の登録コード(ht_トークン)があれば紐づける。
      const m = text.match(/ht_[A-Za-z0-9]{8,}/);
      if (m) {
        const tokRec = await env.HS_HEARING_KV.get("htok:" + m[0], "json");
        if (tokRec) {
          await env.HS_HEARING_KV.put("line2store:" + userId, tokRec.store_id);
          await env.HS_HEARING_KV.put("store2line:" + tokRec.store_id, userId);
          await lineReply(env, replyToken,
            (tokRec.company || "加盟店") + " さま、登録が完了しました。\nこの LINE に、対応できる工種・エリア・強み(使う塗料や工法、保証など)を、そのまま送ってください。まとめて1通でもOKです。\nフォームで入力したい場合はこちら:\nhttps://shield.the-horizons-innovation.com/yakumo/register/?code=" + m[0]);
          continue;
        }
      }
      await lineReply(env, replyToken, "Yakumo 加盟店ヒアリングです。運営からお伝えした登録コード(ht_で始まる文字列)を、このトークにそのまま送ってください。");
      continue;
    }

    // 登録済み: これはヒアリング回答。取り込んで自動構造化->関所->生成。
    const store = await env.HS_HEARING_KV.get("store:" + linkedStoreId, "json");
    const res = await ingestHearingAnswer(env, linkedStoreId, store, text, "line");
    if (res.ok) {
      await lineReply(env, replyToken, "受け取りました。ありがとうございます。検証とページ作成の準備に入ります。追記があれば、いつでもこのトークに送ってください。");
      await notify(env, "[Yakumo] LINE回答を自動構造化->生成トリガー: " + ((store && store.company) || linkedStoreId));
    } else if (res.reason === "missing-required") {
      await lineReply(env, replyToken, "ありがとうございます。もう少しだけ、社名・地域(市区町村)・対応工種が分かるように教えていただけますか？(例: リフォーム職人株式会社 / 長久手市 / 外壁塗装・屋根・内装)");
      // patch39: ここだけ運営通知が無く、相手が返事をした事実が本人に届いていなかった。
      await notify(env, "[Yakumo] LINE返事あり(必須項目が不足のため保留): " + ((store && store.company) || linkedStoreId) + " 本文=" + String(text).slice(0, 80));
    } else {
      await lineReply(env, replyToken, "受け取りました。内容を確認して運営からご連絡します。");
      await notify(env, "[Yakumo] LINE回答を受信(自動構造化できず: " + res.reason + ")。手動確認を。store=" + linkedStoreId);
    }
  }
}


/* ------------------------------ KIRA橋渡し (hs-kira-lineからの内部連携) ------------------------------ */
// KIRA公式LINE(@172piime)のWebhookは hs-kira-line が持つ。加盟店フラグの立った相手のメッセージだけが
// ここへ転送され、ヒアリングとして取り込み、返信文を返す。登録コード(ht_)不要の自動開始に対応。
// 2026-08-20 A: 加盟店への「賢い」自動返信。金額は絶対に述べない(入口とAI出力の二重ガード)。
async function aiPartnerReply(env, text) {
  const t = String(text || "").slice(0, 800);
  if (!t) return null;
  if (!(env && env.AI && typeof env.AI.run === "function")) return null;
  const sys = "あなたは HORIZON SHIELD / Yakumo の加盟店窓口の担当者です。加盟店(工務店・リフォーム会社)からのLINEに、日本語で短く丁寧に自然に返信します。\n厳守(違反禁止):\n1. 金額・料金・価格・費用・割引などの具体は一切述べない。お金の話には『料金は担当の大賀からご案内します』とだけ返す。\n2. 契約・納期・保証などの約束をしない。\n3. 分からない具体は『担当の大賀が確認してご連絡します』と返す。\n4. 返信は2〜3文以内。記号(*,#)や絵文字は使わない。";
  let out = "";
  for (const model of (env.LLM_MODEL ? [env.LLM_MODEL] : AP.AI_MODEL_CHAIN)) {
    try {
      const r = await env.AI.run(model, { messages: [{ role: "system", content: sys }, { role: "user", content: t }], max_tokens: 220 });
      out = (r && (r.response || r.result || r.output_text)) || "";
      if (out) break;
    } catch (_e) {}
  }
  out = String(out || "").trim();
  if (!out) return null;
  if (/[0-9０-９][\s]*(円|万|万円)|[¥$]\s*[0-9０-９]|(料金|価格|費用|お値段|値引|割引)/.test(out)) {
    return "料金・金額については、担当の大賀からご案内します。少々お待ちください。";
  }
  return out;
}

async function handleKiraBridge(env, userId, text, groupId, estimates) {
  const t = String(text || "").trim();
  let storeId = await env.HS_HEARING_KV.get("line2store:" + userId, "text");

  // 2026-08-21: グループ経由のメンバー紐づけ。グループに登録済み加盟店(例:堤さん)が居れば
  //   その投稿で group2store が立ち、同じグループの他メンバー(スタッフ=森下さん)を、その店に
  //   束ねて「同じ会社のデータ」として取り込む。ゴミ店を作らないため、グループでは新規店を
  //   自動作成しない(group2storeが未確定なら取り込まない)。
  if (groupId) {
    if (storeId) {
      try { await env.HS_HEARING_KV.put("group2store:" + groupId, storeId); } catch (_e) {}
    } else {
      const gs = await env.HS_HEARING_KV.get("group2store:" + groupId, "text");
      if (!gs) return { ok: true, reply: "" };
      storeId = gs;
      try {
        await env.HS_HEARING_KV.put("line2store:" + userId, gs);
        await env.HS_HEARING_KV.put("member2store:" + userId, gs);
      } catch (_e) {}
    }
  }

  // 本文に既知の登録コードがあれば従来どおり紐づけ(招待済み加盟店)
  if (!storeId) {
    const m = t.match(/ht_[A-Za-z0-9]{8,}/);
    if (m) {
      const tokRec = await env.HS_HEARING_KV.get("htok:" + m[0], "json");
      if (tokRec) {
        await env.HS_HEARING_KV.put("line2store:" + userId, tokRec.store_id);
        await env.HS_HEARING_KV.put("store2line:" + tokRec.store_id, userId);
        return { ok: true, reply: (tokRec.company || "加盟店") + " さま、登録が完了しました。\nこの LINE に、対応できる工種・エリア・強み(使う塗料や工法、保証など)を、そのまま送ってください。まとめて1通でもOKです。\nフォームで入力したい場合はこちら:\nhttps://shield.the-horizons-innovation.com/yakumo/register/?code=" + m[0] };
      }
    }
  }

  /* --------------------------------------------------------------
     2026-08-23 業種の分岐。

     合同会社あっぷす様(訪問看護)が「加盟店希望」と打たれたところ、
     この下にあった処理が無条件に Yakumo の店を作り、「対応できる工種と強み
     (例: 外壁塗装、無機3回塗り10年保証)」を尋ねてしまった。
     訪問看護に工種は無い。打たれた言葉は正しく、壊れていたのはこちらの構造である。

     合言葉を業種ごとに増やす道は採らなかった。お客様に我々の商品分類を
     先に覚えていただく設計になるうえ、増やすたびに「間違った先へ送る口」が
     1つ増えるからである。入口は1つのまま、分岐を1問だけ後ろにずらす。

     判らないときは推測しない。二度読めなければ人に回す。
     業種を間違えたヒアリングは、相手の時間を奪った上で、
     こちらが話を聞いていないことの証拠になる。
     -------------------------------------------------------------- */
  {
    const intakeKey = "intake:" + userId;
    const INTAKE_TTL = 259200; // 72時間
    let intake = null;
    try { intake = await env.HS_HEARING_KV.get(intakeKey, "json"); } catch (_e) { intake = null; }

    const putIntake = async (o) => {
      try { await env.HS_HEARING_KV.put(intakeKey, JSON.stringify(o), { expirationTtl: INTAKE_TTL }); } catch (_e) {}
    };

    // 見積書が添えられていれば、業種を尋ねるまでもない。建設である。
    const looksConstruction = Array.isArray(estimates) && estimates.length > 0;

    // 業種が決まったところで店を用意する(既存があればそれに業種を書く)。
    const startWithIndustry = async (indKey, existingId) => {
      const ind = IND.industryOf(indKey);
      const nowIso2 = new Date().toISOString();
      let sid = existingId || null;
      let store = null;
      if (sid) {
        try { store = await env.HS_HEARING_KV.get("store:" + sid, "json"); } catch (_e) { store = null; }
      }
      // 既に店があったということは、業種を決める前に別の業種のヒアリングを
      // 送ってしまっている。次の文で、それを取り消す必要がある。
      const afterWrong = !!store;
      if (!store) {
        const rand2 = (n) => { const a = "abcdefghjkmnpqrstuvwxyz23456789"; const u = crypto.getRandomValues(new Uint8Array(n)); let s = ""; for (const b of u) s += a[b % a.length]; return s; };
        sid = "kira-" + rand2(8);
        const tok = "ht_" + rand2(12);
        store = { store_id: sid, company: "", areas: [], works: [], tier: "honbu", status: "onboarding", source: "kira-line", token: tok, created_at: nowIso2, autopilot: {} };
        await env.HS_HEARING_KV.put("htok:" + tok, JSON.stringify({ store_id: sid, company: "", issued_at: nowIso2, via: "kira-bridge" }));
      }
      store.industry = indKey;
      store.industry_decided_at = nowIso2;
      await env.HS_HEARING_KV.put("store:" + sid, JSON.stringify(store));
      await env.HS_HEARING_KV.put("line2store:" + userId, sid);
      await env.HS_HEARING_KV.put("store2line:" + sid, userId);
      try { await env.HS_HEARING_KV.delete(intakeKey); } catch (_e) {}
      await AP.activityAdd(env, { type: "onboard", text: (ind ? ind.label : indKey) + " のヒアリングが始まりました" });
      await notify(env, "[intake] 業種=" + indKey + " で開始。store=" + sid + " line=" + userId);
      if (Array.isArray(estimates) && estimates.length) { try { await appendEstimatesForAudit(env, sid, estimates); } catch (_e) {} }

      /* 2026-08-23 22:30 の事故への対処。
         業種を決めるきっかけになった文が、そのまま答えであることがある。
         平田様は訊いた3つ(事業所名・エリア・医療処置)に全部お答えくださったのに、
         こちらは業種を読み取っただけで満足し、同じ3つをもう一度お送りした。
         答えた直後に同じことを訊かれれば、読んでいないと受け取られる。

         短い合図(「2」「訪問看護です」)なら、それは業種の返事なので質問へ進む。
         それ以上の中身があるなら、それは答えである。取り込んでから受領だけ返す。 */
      const bare2 = String(t || "").replace(/[\s\u3000]/g, "");
      const isJustSignal = bare2.length <= 12;
      if (!isJustSignal) {
        try { await ingestHearingAnswer(env, sid, store, t, "line"); } catch (_e) {}
        await notify(env, "[intake] 業種=" + indKey + " を決めた文が答えを含んでいたので取り込みました。store=" + sid);
        return { ok: true, reply: IND.ackText(indKey, afterWrong) };
      }
      return { ok: true, reply: IND.openingText(indKey, afterWrong) };
    };

    // 既にある店だが、まだ一度も中身を聞けておらず、業種も無い。
    // 今日の平田様(合同会社あっぷす)がこれに当たる。次の一言を工種として
    // 取り込む前に、業種から聞き直す。
    if (storeId && !intake) {
      let s0 = null;
      try { s0 = await env.HS_HEARING_KV.get("store:" + storeId, "json"); } catch (_e) { s0 = null; }
      const untouched = s0 && !s0.industry && !safeStr(s0.company, 120) &&
                        !(Array.isArray(s0.works) && s0.works.length) &&
                        !(Array.isArray(s0.areas) && s0.areas.length);
      if (untouched) {
        if (looksConstruction) return await startWithIndustry("construction", storeId);
        const guess = IND.classifyIndustry(t);
        if (guess && guess.key !== IND.UNKNOWN_INDUSTRY && !guess.ambiguous) {
          return await startWithIndustry(guess.key, storeId);
        }
        await putIntake({ state: "awaiting_industry", store_id: storeId, asked_at: new Date().toISOString(), retries: 0 });
        await notify(env, "[intake] 業種が未確定のため業種を尋ねました。store=" + storeId + " line=" + userId);
        return { ok: true, reply: IND.askIndustryText() };
      }
    }

    // 業種を尋ねた相手からの返事。
    if (intake && intake.state === "awaiting_industry") {
      const cls = IND.classifyIndustry(t);
      if (cls && cls.key !== IND.UNKNOWN_INDUSTRY && !cls.ambiguous) {
        return await startWithIndustry(cls.key, intake.store_id || storeId);
      }
      const retries = Number(intake.retries || 0) + 1;
      if (!cls && retries < 2) {
        await putIntake(Object.assign({}, intake, { retries }));
        return { ok: true, reply: "うまく読み取れませんでした。もう一度だけ、ご業種を短くお願いします。\n1) 建設・リフォーム  2) 訪問看護・介護  3) それ以外" };
      }
      // 「それ以外」か、二度読めなかった。ここで型を当てはめない。
      await putIntake(Object.assign({}, intake, { state: "handoff", retries, last_text: String(t).slice(0, 300) }));
      await notify(env, "[intake] 業種を決めずに人へ回しました。line=" + userId + " / " + String(t).slice(0, 160));
      return { ok: true, reply: "承知しました。ご業種は、こちらで型を決めずに担当の大賀がお伺いします。\nご業種と、いま困っていることを一言だけ書いておいていただけると、話が早くなります。" };
    }

    // 人へ回したあとは、自動で型に嵌めない。届いた言葉は大賀に流す。
    if (intake && intake.state === "handoff") {
      const cls = IND.classifyIndustry(t);
      if (cls && cls.key !== IND.UNKNOWN_INDUSTRY && !cls.ambiguous) {
        return await startWithIndustry(cls.key, intake.store_id || storeId);
      }
      await notify(env, "[intake] 人待ちの相手から追加の言葉。line=" + userId + " / " + String(t).slice(0, 200));
      return { ok: true, reply: "" };
    }

    // まったくの初回。ここで店を作らない。業種が決まってから作る。
    if (!storeId) {
      if (looksConstruction) return await startWithIndustry("construction", null);
      const guess = IND.classifyIndustry(t);
      if (guess && guess.key !== IND.UNKNOWN_INDUSTRY && !guess.ambiguous) {
        return await startWithIndustry(guess.key, null);
      }
      await putIntake({ state: "awaiting_industry", store_id: null, asked_at: new Date().toISOString(), retries: 0 });
      await notify(env, "[intake] 新規のご連絡。業種を尋ねました。line=" + userId);
      return { ok: true, reply: IND.askIndustryText() };
    }
  }

  // 登録済み: トリガー語だけの短文は案内を返す(回答としては取り込まない)
  if (t.replace(/\s/g, "").length <= 6 && t.indexOf("加盟店") >= 0) {
    return { ok: true, reply: "ヒアリング進行中です。会社名(屋号)・対応エリア(市区町村)・対応できる工種と強みを、このままご返信ください。" };
  }

  // 2026-08-20 A: 金額のことだけは、ボットに絶対に喋らせない。担当(大賀)に回す。
  if (/(金額|料金|価格|費用|いくら|お値段|値段|支払|お支払|請求|割引|値引|万円|見積[^。]{0,8}金額|プラン[^。]{0,8}料金)/.test(t)) {
    try { await notify(env, "[Yakumo] 金額に関する問い合わせ。要対応(大賀が案内): store=" + storeId + " / " + t.slice(0, 120)); } catch (_e) {}
    return { ok: true, reply: "料金・金額については、担当の大賀からご案内します。少々お待ちください。" };
  }

  // 2026-08-20 A: 金額以外は、送られた言葉に沿ってAIが自然に返す。
  //   データとして取り込めるものは取り込み(プロフィールは従来どおり育てる)、返信はAIに任せる。
  //   これまでの「受け取りました…掲載準備に反映しました」+定型の追撃質問(変な会話)は廃止。
  //   追撃は autopilot の日次tickが、間隔と上限を守って別に行う。
  if (Array.isArray(estimates) && estimates.length) { try { await appendEstimatesForAudit(env, storeId, estimates); } catch (_e) {} }
  const store = await env.HS_HEARING_KV.get("store:" + storeId, "json");
  try { await ingestHearingAnswer(env, storeId, store, t, "line"); } catch (_e) {}
  const smart = await aiPartnerReply(env, t);
  try { await notify(env, "[Yakumo] KIRA経由メッセージにAI応答: " + (((store || {}).company) || storeId) + " / " + t.slice(0, 60)); } catch (_e) {}
  return { ok: true, reply: smart || "受け取りました。ありがとうございます。内容は運営事務局で確認します。お急ぎのご用件でしたら、その旨をお書きください。" };
}

async function appendEstimatesForAudit(env, storeId, estimates) {
  if (!storeId) return { ok: false, reason: "no-store" };
  // 2026-08-22 auto-score. work/amount/detail に加え、決定的な採点に使う誠実度フィールドも保存する。
  //   抽出側(kira-line)が付けてこなければ従来どおり work/amount/detail だけ入る(捏造しない)。
  const numOrNull = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
  const norm = (Array.isArray(estimates) ? estimates : []).slice(0, 10).map((e) => {
    const o = {
      work: safeStr(e && e.work, 80),
      amount: parseJpYen(safeStr(e && e.amount, 20)),
      detail: safeStr(e && e.detail, 200),
    };
    const _sh = numOrNull(e && e.shokei); if (_sh != null) o.shokei = _sh;
    if (e && e.lump_lines != null) o.lump_lines = Number(e.lump_lines) || 0;
    if (e && typeof e.has_spec === "boolean") o.has_spec = e.has_spec;
    if (e && typeof e.has_warranty === "boolean") o.has_warranty = e.has_warranty;
    if (e && typeof e.urgency === "boolean") o.urgency = e.urgency;
    if (e && typeof e.insurance_bait === "boolean") o.insurance_bait = e.insurance_bait;
    if (e && typeof e.upfront_over_half === "boolean") o.upfront_over_half = e.upfront_over_half;
    if (e && e.qty != null) o.qty = Number(e.qty) || 1;
    if (Array.isArray(e && e.lines)) o.lines = e.lines.slice(0, 30).map((ln) => ({
      name: safeStr(ln && ln.name, 80),
      qty: Number(ln && ln.qty) || 1,
      unit_price: parseJpYen(safeStr(ln && ln.unit_price, 20)),
    }));
    return o;
  }).filter((e) => e.work || e.amount);
  if (!norm.length) return { ok: false, reason: "empty" };
  const rec = await env.HS_HEARING_KV.get("hearing:" + storeId, "json");
  const profile = (rec && rec.profile) || { store_id: storeId };
  const eKey = (e) => safeStr(e.work, 80) + "|" + safeStr(e.amount, 20);
  const ests = Array.isArray(profile.estimates_for_audit) ? profile.estimates_for_audit.slice() : [];
  const seen = new Set(ests.map(eKey));
  let added = 0;
  for (const e of norm) { const k = eKey(e); if (!seen.has(k)) { seen.add(k); ests.push(e); added++; } }
  profile.estimates_for_audit = ests.slice(0, 12);
  const now = new Date().toISOString();
  await env.HS_HEARING_KV.put("hearing:" + storeId, JSON.stringify({ ...(rec || {}), store_id: storeId, profile, estimate_updated_at: now }));
  const store = await env.HS_HEARING_KV.get("store:" + storeId, "json");
  try { await AP.activityAdd(env, { type: "estimate", member_no: store && store.member_no, text: ((store && store.company) || "\u52A0\u76DF\u5E97") + " \u304C\u5BE9\u67FB\u7528\u306E\u898B\u7A4D\u3092\u9001\u4ED8(\u84C4\u7A4D " + profile.estimates_for_audit.length + "\u4EF6)" }); } catch (_e) {}
  try { await notify(env, "[Yakumo] \u52A0\u76DF\u5E97\u304B\u3089\u5BE9\u67FB\u7528\u306E\u898B\u7A4D\u3092\u53D7\u9818\u3002store=" + storeId + " \u4F1A\u793E=" + ((store && store.company) || "") + " \u8FFD\u52A0" + added + "\u4EF6/\u8A08" + profile.estimates_for_audit.length + "\u4EF6\u3002KIRA\u9069\u6B63\u8A3A\u65AD\u306E\u6750\u6599\u3002"); } catch (_e) {}

  // 2026-08-22 auto-score. \u5B9F\u898B\u7A4D\u304C MIN_AUDIT_ESTIMATES \u672C\u306B\u9054\u3057\u305F\u3089\u3001\u4EBA\u624B\u3092\u4ECB\u3055\u305A\u81EA\u52D5\u63A1\u70B9\u3057\u3066\u63B2\u8F09\u5224\u5B9A\u3059\u308B\u3002
  //   \u901A\u3059\u6761\u4EF6: \u8A3C\u62E0\u5341\u5206\u30FB\u30CF\u30FC\u30C9\u8D64\u65D7\u306A\u3057\u30FB\u30B9\u30B3\u30A2\u304C\u4E0B\u9650\u4EE5\u4E0A\u3002\u30CF\u30FC\u30C9\u8D64\u65D7\u304C\u3042\u308C\u3070\u63B2\u8F09\u305B\u305A\u5927\u8CC0\u306B\u56DE\u3059(fail-closed)\u3002
  //   \u30B9\u30B3\u30A2\u306F KIRA\u7D14\u6B63\u3068\u3057\u3066 fairness_score \u306B\u5165\u308C\u308B(/admin/verify \u3068\u540C\u3058\u9805\u76EE)\u3002\u65E2\u306B verified \u306E\u5E97\u306F\u89E6\u3089\u306A\u3044\u3002
  let auto = null;
  try {
    if (store && store.verification !== "verified" && profile.estimates_for_audit.length >= AP.MIN_AUDIT_ESTIMATES) {
      const sc = AP.scoreEstimates(profile);
      auto = sc;
      if (sc.auto_verify) {
        store.audit_evidence = {
          estimates: sc.evidence_count,
          works: Array.from(new Set((profile.estimates_for_audit || []).map((e) => String((e && e.work) || "")).filter(Boolean))).slice(0, 8),
          recorded_at: new Date().toISOString(),
          method: "auto-kira",
        };
        store.verification = "verified";
        store.fairness_score = sc.fairness_score;
        store.integrity_tier = sc.integrity_tier;
        store.red_flags_detected = sc.red_flags_detected;
        store.status = "published";
        store.verified_at = new Date().toISOString();
        store.auto_scored = { at: store.verified_at, score: sc.fairness_score, tier: sc.integrity_tier, confirm_notes: sc.confirm_notes, reason: sc.reason };
        await env.HS_HEARING_KV.put("store:" + storeId, JSON.stringify(store));
        try { await AP.activityAdd(env, { type: "verified", member_no: store.member_no, text: (store.company || "\u52A0\u76DF\u5E97") + " \u304C\u9069\u6B63\u4FA1\u683C\u306E\u7B2C\u4E09\u8005\u691C\u8A3C(KIRA\u81EA\u52D5)\u3092\u901A\u904E\u3057\u307E\u3057\u305F" }); } catch (_e) {}
        try { await notify(env, "[Yakumo] \u81EA\u52D5\u691C\u8A3C: " + (store.company || storeId) + " \u3092KIRA\u81EA\u52D5\u63A1\u70B9\u3067 verified \u5316\u3002\u30B9\u30B3\u30A2" + sc.fairness_score + "/\u30C6\u30A3\u30A2" + sc.integrity_tier + "/\u8D64\u65D7" + sc.red_flags_detected + "\u3002" + sc.reason); } catch (_e) {}
      } else if (sc.hard_alert) {
        try { await notify(env, "[Yakumo] \u81EA\u52D5\u63A1\u70B9\u3067\u4FDD\u7559(fail-closed): " + (store.company || storeId) + "\u3002" + sc.reason); } catch (_e) {}
      } else {
        try { await notify(env, "[Yakumo] \u81EA\u52D5\u63A1\u70B9: " + (store.company || storeId) + " \u306F\u30B9\u30B3\u30A2" + sc.fairness_score + "\u3067\u81EA\u52D5\u63B2\u8F09\u306E\u4E0B\u9650\u672A\u6E80\u3002\u4EBA\u306E\u78BA\u8A8D\u3078\u3002"); } catch (_e) {}
      }
    }
  } catch (_e) {}
  return { ok: true, added, total: profile.estimates_for_audit.length, auto: auto ? { verified: !!auto.auto_verify, score: auto.fairness_score, tier: auto.integrity_tier, hard_alert: auto.hard_alert } : null };
}

/* ------------------------------ 加盟店一覧(KV) + 公開データ ------------------------------ */
async function listAllStores(env) {
  const out = [];
  let cursor;
  do {
    const res = await env.HS_HEARING_KV.list({ prefix: "store:", cursor });
    for (const k of res.keys) {
      const s = await env.HS_HEARING_KV.get(k.name, "json");
      if (s) out.push(s);
    }
    cursor = res.list_complete ? null : res.cursor;
  } while (cursor);
  return out;
}
// KVの店レコード -> モール/一覧の表示形。金額は出さない(スコア・ティアのみ)。
function storeToContractor(s, profile) {
  // 2026-08-19 patch57: 厚い中身は hearing: レコードにあり、store: レコードは薄いままだった。
  //   No.002 は store: 側が works=["リフォーム"]・エリア3市で、モールのカードがその薄い方を出していた。
  //   hearing: の profile を渡されたら、工種とエリアはそちらを優先する。渡されなければ従来どおり。
  const p = profile || {};
  const pAreas = Array.isArray(p.areas_served) ? p.areas_served : [];
  const pWorks = Array.isArray(p.works) ? p.works : [];
  const areas = pAreas.length ? pAreas : (Array.isArray(s.areas) ? s.areas : []);
  const works = pWorks.length ? pWorks : (Array.isArray(s.works) ? s.works : []);
  const verified = s.verification === "verified" && s.fairness_score != null;
  const penalty = (s.autopilot && Number(s.autopilot.penalty)) || 0;
  // 2026-08-19 patch61: 加盟番号からだけ導く。store_id は見ない。
  const mnDigits = String(s.member_no || "").replace(/[^0-9]/g, "");
  const derivedProfileUrl = (mnDigits && mnDigits.length <= 3) ? ("/yakumo/no" + mnDigits.padStart(3, "0") + "/") : "/yakumo/";
  return {
    member_no: s.member_no || null,
    store_id: s.store_id,
    name: s.company || "",
    area: s.area || areas[0] || "",
    areas_served: areas,
    works,
    verification: verified ? "verified" : "pending",
    // fairness_score は KIRA純正のまま(不改変)。表示ランクは rank_score(運用状態込み)から。
    fairness_score: verified ? s.fairness_score : null,
    rank_score: verified ? Math.max(0, Number(s.fairness_score) - penalty) : null,
    engagement_state: penalty >= 5 ? "at_risk" : penalty > 0 ? "stale" : "active",
    integrity_tier: verified ? (s.integrity_tier || null) : null,
    red_flags_detected: verified ? (s.red_flags_detected != null ? s.red_flags_detected : null) : null,
    claim_sha256: verified ? (s.claim_sha256 || null) : null,
    audit_evidence: verified ? (s.audit_evidence || null) : null, // patch51: スコアの分母
    // 2026-08-19 patch57: 001だけベタ書きだったので、002のカードは自分のページに飛べず
    //   汎用ページに落ちていた。加盟番号から素直に導く。新しい店を出すときは /yakumo/noNNN/ を先に作ること。
    // 2026-08-19 patch61: patch57 は store_id からも数字を拾っていた。KIRA経由で作られる店の
    //   store_id は "kira-" + 英数字8桁で、その英数字に数字が混ざる。"kira-3xk9m2ab" なら
    //   "/yakumo/no3921/" という存在しないページを施主とAIに配ることになる。
    //   加盟番号(member_no)だけを見て、3桁に収まらないものは汎用ページに落とす。
    profile_url: s.profile_url || derivedProfileUrl,
    mcp_url: "https://hearing.horizonshield.dev/mcp",
    // 2026-08-19 patch60: モールのカードは c.webmcp_option を見て、ブロンズの枠と
    //   「WebMCP Partner」の札を出す作りになっている。ところがここが返していなかったので
    //   常に undefined で、あの枠は誰にも付かない死んだ分岐だった。検証済みの店にも付かない。
    //   CSS の .row.webmcp は opacity:1 なので、審査中でも枠は付く。有料オプションの札であって
    //   検証の合否ではない。だから店レコードの値をそのまま出す。無い店には付かない。
    //   これで /admin/stores にも出るので、KVに入っているかを目で確認できる。
    webmcp_option: s.webmcp_option === true,
    status: s.status || "onboarding",
  };
}

/* ------------------------------ router ------------------------------ */
/* ------------------------------ Yakumo WebMCP embed (served at /embed.js) ------------------------------ */
// 検証済みの職人を地域x工種で探せる discovery ウィジェット。どのサイトにも <script src=".../embed.js"> 1行で載る。
// Shadow DOM でホストCSSと隔離。localStorage不使用。金額は出さない(スコア・ティアのみ)。裏で Yakumo MCP を叩く。
const YAKUMO_EMBED_JS = "/* HORIZON SHIELD Yakumo 案内ウィジェット (served at /embed.js). Shadow DOM, no localStorage. */\n" +
"(function(){\n" +
"  if(window.__HS_YAKUMO_EMBED__)return; window.__HS_YAKUMO_EMBED__=true;\n" +
"  var me=document.currentScript, ORIGIN='https://hearing.horizonshield.dev';\n" +
"  try{ if(me&&me.src) ORIGIN=new URL(me.src).origin; }catch(e){}\n" +
"  var MCP=ORIGIN+'/mcp', SITE='https://shield.the-horizons-innovation.com';\n" +
"  function esc(s){s=(s==null?'':String(s));return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');}\n" +
"  var CSS='*{box-sizing:border-box}'+\n" +
"    '.fab{position:fixed;left:20px;bottom:20px;z-index:2147483000;background:#3FE0CE;color:#06241F;border:0;border-radius:999px;padding:13px 19px;font-weight:800;font-size:14px;cursor:pointer;box-shadow:0 8px 28px rgba(0,0,0,.4);font-family:system-ui,\"Hiragino Sans\",Meiryo,sans-serif}'+\n" +
"    '.fab .d{display:inline-block;width:8px;height:8px;border-radius:50%;background:#06241F;margin-right:8px;vertical-align:middle;opacity:.7}'+\n" +
"    '.panel{position:fixed;left:20px;bottom:80px;z-index:2147483000;width:360px;max-width:calc(100vw - 28px);max-height:calc(100vh - 116px);overflow:auto;background:#0A0E16;color:#EAF0F8;border:1px solid #1A2230;border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.55);font-family:system-ui,\"Hiragino Sans\",Meiryo,sans-serif;display:none;line-height:1.7}'+\n" +
"    '.panel.open{display:block}'+\n" +
"    '.hd{display:flex;align-items:center;justify-content:space-between;padding:15px 17px;border-bottom:1px solid #1A2230;position:sticky;top:0;background:#0A0E16}'+\n" +
"    '.ttl{font-weight:800;font-size:15px;color:#fff}'+\n" +
"    '.tag{font-size:10.5px;font-weight:700;color:#3FE0CE;border:1px solid #15847A;border-radius:999px;padding:2px 8px;margin-left:7px;vertical-align:middle}'+\n" +
"    '.x{background:0;border:0;color:#7E8CA2;font-size:22px;line-height:1;cursor:pointer;padding:2px 6px}'+\n" +
"    '.bd{padding:15px 17px}'+\n" +
"    '.lead{color:#9aa4b2;font-size:12.5px;margin:0 0 12px}'+\n" +
"    'label{display:block;font-size:11.5px;color:#7E8CA2;margin:10px 0 4px;font-weight:700}'+\n" +
"    'input{width:100%;background:#111722;border:1px solid #283449;color:#fff;border-radius:9px;padding:10px 11px;font-size:14px;outline:none}'+\n" +
"    'input:focus{border-color:#15847A}'+\n" +
"    '.go{width:100%;margin-top:13px;background:#3FE0CE;color:#06241F;border:0;border-radius:9px;padding:12px;font-weight:800;font-size:14px;cursor:pointer}'+\n" +
"    '.go:disabled{opacity:.6}'+\n" +
"    '.rc{margin-top:13px}'+\n" +
"    '.st{display:block;background:#111722;border:1px solid #283449;border-radius:11px;padding:12px 13px;margin-bottom:9px;text-decoration:none;color:inherit}'+\n" +
"    '.st:hover{border-color:#15847A}'+\n" +
"    '.st .nm{font-weight:800;font-size:14px;color:#fff}'+\n" +
"    '.st .mt{font-size:11.5px;color:#9aa4b2;margin-top:2px}'+\n" +
"    '.st .tg{display:inline-block;font-size:10px;color:#7E8CA2;border:1px solid #283449;border-radius:5px;padding:1px 6px;margin:5px 4px 0 0}'+\n" +
"    '.st .sc{float:right;font-family:\"Space Grotesk\",system-ui;font-weight:800;color:#3FE0CE;font-size:13px;border:1px solid #15847A;border-radius:7px;padding:2px 8px}'+\n" +
"    '.muted{color:#7E8CA2;font-size:12px;margin:8px 0}'+\n" +
"    '.lk{display:block;text-align:center;margin-top:9px;background:#3FE0CE;color:#06241F;font-weight:800;font-size:13px;border-radius:9px;padding:11px;text-decoration:none}'+\n" +
"    '.lk2{display:block;text-align:center;margin-top:7px;color:#EAF0F8;font-size:12.5px;text-decoration:underline}'+\n" +
"    '.ft{color:#4A5568;font-size:10.5px;margin-top:12px;border-top:1px solid #1A2230;padding-top:10px;line-height:1.6}';\n" +
"  var HTML='<button class=\"fab\" id=\"fab\" aria-label=\"検証済みの職人を探す\"><span class=\"d\"></span>検証済みの職人を探す</button>'+\n" +
"    '<div class=\"panel\" id=\"panel\" role=\"dialog\" aria-label=\"Yakumo 検証済みの職人を探す\">'+\n" +
"      '<div class=\"hd\"><div class=\"ttl\">検証済みの職人を探す<span class=\"tag\">中立・紹介料なし</span></div><button class=\"x\" id=\"x\" aria-label=\"閉じる\">&times;</button></div>'+\n" +
"      '<div class=\"bd\">'+\n" +
"        '<p class=\"lead\">Yakumo は適正価格の検証と過剰請求チェック(KIRA)を通過した加盟店だけを掲載する中立モールです。金額ではなくスコア・ティアで示します。判断はあなた自身。</p>'+\n" +
"        '<label for=\"ya\">地域</label><input id=\"ya\" placeholder=\"例: 愛知県 / 長久手市\" autocomplete=\"off\">'+\n" +
"        '<label for=\"yw\">工種</label><input id=\"yw\" placeholder=\"例: 外壁塗装 / 屋根 / 内装\" autocomplete=\"off\">'+\n" +
"        '<button class=\"go\" id=\"go\">検証済みの店を探す</button>'+\n" +
"        '<div class=\"rc\" id=\"rc\"></div>'+\n" +
"        '<div class=\"ft\">運営 The HORIZONs株式会社 / HORIZON SHIELD。Yakumo は施工業者から紹介料や送客報酬を受け取らない、独立した第三者です。</div>'+\n" +
"      '</div></div>';\n" +
"  var host=document.createElement('div'); (document.body||document.documentElement).appendChild(host);\n" +
"  var root=host.attachShadow?host.attachShadow({mode:'open'}):host;\n" +
"  var box=document.createElement('div'); box.innerHTML='<style>'+CSS+'</style>'+HTML; root.appendChild(box);\n" +
"  var panel=root.querySelector('#panel'), rc=root.querySelector('#rc');\n" +
"  function open(){panel.classList.add('open');var a=root.querySelector('#ya');if(a)a.focus();}\n" +
"  function close(){panel.classList.remove('open');}\n" +
"  root.querySelector('#fab').addEventListener('click',function(){panel.classList.contains('open')?close():open();});\n" +
"  root.querySelector('#x').addEventListener('click',close);\n" +
"  document.addEventListener('keydown',function(e){if(e.key==='Escape')close();});\n" +
"  function links(){return '<a class=\"lk\" href=\"'+SITE+'/yakumo/\" target=\"_blank\" rel=\"noopener\">Yakumo モールで一覧を見る</a>'+'<a class=\"lk2\" href=\"'+SITE+'/ehn/\" target=\"_blank\" rel=\"noopener\">見積もりを匿名で無料チェック(EHN)</a>';}\n" +
"  function render(d){\n" +
"    var stores=(d&&d.stores)||[];\n" +
"    if(!stores.length){ rc.innerHTML='<p class=\"muted\">条件に合う検証済みの店がまだ見つかりませんでした。モール全体を見るか、手元の見積もりを無料でチェックできます。</p>'+links(); return; }\n" +
"    var h='';\n" +
"    for(var i=0;i<stores.length;i++){ var s=stores[i];\n" +
"      var works=(s.works||[]).slice(0,4).map(function(w){return '<span class=\"tg\">'+esc(w)+'</span>';}).join('');\n" +
"      var sc=(s.integrity_tier?('<span class=\"sc\">'+esc(s.integrity_tier)+(s.fairness_score!=null?(' '+esc(s.fairness_score)):'')+'</span>'):'');\n" +
"      h+='<a class=\"st\" href=\"'+esc(s.profile_url||(SITE+'/yakumo/'))+'\" target=\"_blank\" rel=\"noopener\">'+sc+'<div class=\"nm\">'+esc(s.name||'加盟店')+'</div><div class=\"mt\">'+esc(s.area||'')+' ・ '+esc(s.member_no||'')+'</div>'+works+'</a>';\n" +
"    }\n" +
"    rc.innerHTML=h+links();\n" +
"  }\n" +
"  function search(){\n" +
"    var area=(root.querySelector('#ya').value||'').trim(), work=(root.querySelector('#yw').value||'').trim();\n" +
"    var go=root.querySelector('#go'); go.disabled=true; rc.innerHTML='<p class=\"muted\">検証済みの店を照合しています…</p>';\n" +
"    fetch(MCP,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'list_verified_stores',arguments:{area:area,work:work}}})})\n" +
"      .then(function(r){return r.json();}).then(function(j){ go.disabled=false; var out=null; try{ out=JSON.parse(j.result.content[0].text); }catch(e){} if(!out){ rc.innerHTML='<p class=\"muted\">ただいま混み合っています。少し時間をおいてお試しください。</p>'+links(); return;} render(out); })\n" +
"      .catch(function(){ go.disabled=false; rc.innerHTML='<p class=\"muted\">通信に失敗しました。時間をおいてお試しください。</p>'+links(); });\n" +
"  }\n" +
"  root.querySelector('#go').addEventListener('click',search);\n" +
"})();\n";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (path === "/embed.js")
      return new Response(YAKUMO_EMBED_JS, { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300", ...cors } });
    if (path === "/.well-known/security.txt")
      return new Response("Contact: mailto:contact@the-horizons-innovation.com\nExpires: 2027-07-18T00:00:00.000Z\nPreferred-Languages: ja, en\nCanonical: " + url.origin + "/.well-known/security.txt\nPolicy: " + SITE_URL + "/\n", { headers: { "Content-Type": "text/plain; charset=utf-8", ...cors } });
    if (path === "/.well-known/glama.json")
      return json({ "$schema": "https://glama.ai/mcp/schemas/connector.json", maintainers: [{ email: "ogasurfproject@gmail.com" }] });

    if (path === "/health") {
      // 保全: 心臓の脈(最終巡回)と内臓検診(弐号)の要約を出す。件数のみで中身は出さない(非機微)。
      const g = await AP.guardianStatus(env).catch(() => null);
      return json({ ok: true, server: SERVER.name, version: SERVER.version, ...(g || {}) });
    }

    if (path === "/.well-known/agent-card.json") return json(agentCard(url.origin));

    // 公開: モールが読む加盟店データ(KVライブ)。金額なし。静的 /data/yakumo-contractors.json のライブ版。
    if (path === "/contractors.json") {
      // 2026-08-19 patch63: patch57 で店ごとに hearing: を1本読むようにしたので、
      //   listAllStores と合わせて 1リクエスト 2N+1 回のKV操作になった。Workers の
      //   サブリクエスト上限に当たると、この公開エンドポイントごと落ちる。
      //   上限を決めて、超えた分は store: の登録内容だけで出し、何本落としたかを本文に書く。
      //   黙って切らない。KVが読めないときは公開済みの静的データに落ちる。
      let contractors = [];
      let srcLabel = "hs-hearing KV (live)";
      let thick_limited = false;
      let thick_note = null;
      try {
        const stores = await listAllStores(env);
        const MAX_THICK = 20;
        const head = await contractorsFromStores(env, stores.slice(0, MAX_THICK));
        const tail = stores.slice(MAX_THICK).map((s) => storeToContractor(s));
        contractors = head.concat(tail);
        if (tail.length) {
          thick_limited = true;
          thick_note = "hearing: の詳細を読んだのは先頭 " + MAX_THICK + " 店。残り " + tail.length + " 店は store: の登録内容のみ。";
        }
      } catch (_e) {
        const pub = await fetchPublished(env);
        contractors = (pub && pub.contractors) || [];
        srcLabel = "published fallback (KV unavailable)";
        thick_limited = true;
        thick_note = "KVを読めなかったため公開済みの静的データで応答した。";
      }
      return json({
        schema: "yakumo-contractors/v1",
        generated_at: new Date().toISOString(),
        source: srcLabel,
        contractors,
        thick_limited,
        thick_note,
        // 照会/検証の回数はここに置かない(実測でない数字を配らない)。実カウンタは hs-mcp /.well-known/usage-stats.json。
        stats: { source_count: 8, jccdb_items: 65520, as_of: "2026-06-30" },
      }, 200, { "Cache-Control": "public, max-age=60" });
    }

    // 登録画面用: 登録コード(token)で店の表示情報を返す(招待された加盟店向け・公開)。金額はtierと合算のみ。
    if (path === "/register-info") {
      const tok = safeStr(url.searchParams.get("token"), 80).replace(/[^A-Za-z0-9_-]/g, "");
      let store;
      if (!tok) {
        const bstore = safeStr(url.searchParams.get("store"), 60).replace(/[^A-Za-z0-9_-]/g, "");
        if (adminOk(request, env) && bstore) {
          store = await env.HS_HEARING_KV.get("store:" + bstore, "json");
          if (!store) return json({ exists: false });
        } else {
          return json({ exists: false });
        }
      } else {
        const rec = await env.HS_HEARING_KV.get("htok:" + tok, "json");
        if (!rec) return json({ exists: false });
        store = await env.HS_HEARING_KV.get("store:" + rec.store_id, "json");
        if (!store) return json({ exists: false });
      }
      const hearing = await env.HS_HEARING_KV.get("hearing:" + store.store_id, "json");
      const ap = store.autopilot || {};
      const refs = await AP.refCount(env, store.member_no);
      // 2026-08-19 patch58: 本人のマイページ(?code=トークン)もここを読む。薄い方を本人に見せていた。
      //   hearing は1行上で既に読んでいるので、その profile を優先するだけでいい。
      const riHp = (hearing && hearing.profile) || null;
      const riAreas = (riHp && Array.isArray(riHp.areas_served) && riHp.areas_served.length) ? riHp.areas_served : (store.areas || []);
      const riWorks = (riHp && Array.isArray(riHp.works) && riHp.works.length) ? riHp.works : (store.works || []);
      return json({
        exists: true,
        member_no: store.member_no || null,
        company: store.company || "",
        // 2026-08-19 patch63: モールのカードと出所を揃える。
        area: store.area || riAreas[0] || "",
        areas: riAreas,
        works: riWorks,
        tier: store.tier || "honbu",
        status: store.status || "onboarding",
        already_answered: !!(hearing && hearing.completed),
        // 2026-08-19 patch64: 本人用マイページ(?code=トークン)でも同じものを出す。
        webmcp_option: store.webmcp_option === true,
        // AUTOPILOT: マイページ用の運用状態(本人向け・公開安全)
        focus_primary: ap.focus_primary || null,
        completeness: ap.completeness != null ? ap.completeness : null,
        pending_question: (ap.pending && ap.pending.text) || null,
        referral_count: refs,
        // 紹介導線: この店専用の紹介リンク(他の工務店を誘う口)。member_noが無ければ汎用applyを返す。
        referral_link: store.member_no
          ? "https://shield.the-horizons-innovation.com/yakumo/apply/?ref=" + encodeURIComponent(store.member_no)
          : "https://shield.the-horizons-innovation.com/yakumo/apply/",
      });
    }

    // 公開: 加盟店プロフィール(認証不要・公開安全8項目のみ。料金/運用状態/紹介/トークンは返さない)
    if (path === "/public-profile") {
      const sid = safeStr(url.searchParams.get("store"), 60).replace(/[^A-Za-z0-9_-]/g, "");
      if (!sid) return json({ exists: false }, 404);
      const store = await env.HS_HEARING_KV.get("store:" + sid, "json");
      if (!store) return json({ exists: false }, 404);
      // 2026-08-19 patch58: ここも store: の薄い方を返していた。加盟店のマイページが、
      //   本人に「工種はリフォーム1つ、エリアは3市」の店として見えていた。
      //   厚い方(hearing: の profile)があればそちらを出す。patch57 と同じ直し方。
      let hp = null, hDone = false;
      try {
        const hrec = await env.HS_HEARING_KV.get("hearing:" + sid, "json");
        hp = (hrec && hrec.profile) || null;
        // 2026-08-19 patch59: マイページの公開ビューは already_answered だけを見て
        //   「ヒアリング待ち・まずはヒアリングにご回答ください」を出す。この口がその値を
        //   返していなかったので undefined -> false になり、2026-08-19に4回答えた加盟店(p002)に
        //   「まずは答えてください」と表示していた。status は既に hearing_done を返しており、
        //   ここで新しく公開する情報は無い。
        hDone = !!(hrec && hrec.completed);
      } catch (_e) {}
      const ppAreas = (hp && Array.isArray(hp.areas_served) && hp.areas_served.length) ? hp.areas_served : (store.areas || []);
      const ppWorks = (hp && Array.isArray(hp.works) && hp.works.length) ? hp.works : (store.works || []);
      return json({
        exists: true,
        store_id: store.store_id || sid,
        member_no: store.member_no || null,
        company: store.company || "",
        // 2026-08-19 patch63: モールのカードは s.area を優先しているのに、ここだけ
        //   profile の1件目を出していた。同じ店が画面によって別の所在地に見える。揃える。
        area: store.area || ppAreas[0] || "",
        areas: ppAreas,
        works: ppWorks,
        status: store.status || "onboarding",
        already_answered: hDone,
        // 2026-08-19 patch64: マイページが「自分のMCPエンドポイント」を出すために要る。
        //   有料オプションを入れている店だけが自分専用のMCPを持っている。
        webmcp_option: store.webmcp_option === true,
      });
    }

    // 公開: 活動フィード(認知ループ)。金額・連絡先・個人情報なしの文言のみ。
    if (path === "/activity.json") {
      const items = await AP.activityList(env, 30);
      return json({ items: items.filter((x) => x.type !== "tick"), updated_at: new Date().toISOString() },
        200, { "Cache-Control": "public, max-age=60" });
    }

    // 公開: 紹介リンク着地カウント(加盟店が加盟店を呼ぶ導線)。PIIなし。
    if (path === "/ref-hit") {
      const ref = safeStr(url.searchParams.get("ref"), 20).replace(/[^A-Za-z0-9.]/g, "");
      if (ref) await AP.refHit(env, ref);
      return new Response(null, { status: 204, headers: cors });
    }

    // MCP: JSON-RPC over HTTP(POST)
    if (path === "/mcp") {
      // Streamable HTTP: POST専用。GET/DELETEは405(仕様準拠)。
      if (request.method === "GET") return new Response("Method Not Allowed. Use POST for JSON-RPC.", { status: 405, headers: { Allow: "POST, OPTIONS", ...cors } });
      if (request.method === "DELETE") return new Response("Method Not Allowed (stateless server, no session).", { status: 405, headers: { Allow: "POST, OPTIONS", ...cors } });
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      const pv = request.headers.get("MCP-Protocol-Version");
      if (pv && !MCP_SUPPORTED.includes(pv)) return new Response("Unsupported MCP-Protocol-Version: " + pv, { status: 400, headers: cors });
      let body;
      try { body = await request.json(); } catch (_e) { return rpcErr(null, -32700, "parse error"); }
      const msgs = Array.isArray(body) ? body : [body];
      // 単発想定(バッチは先頭のみ)。
      const m = msgs[0] || {};
      // 通知・レスポンス(idなし/methodなし)は 202 空(仕様)。
      const hasId = m && Object.prototype.hasOwnProperty.call(m, "id") && m.id != null;
      const isResp = m && (Object.prototype.hasOwnProperty.call(m, "result") || Object.prototype.hasOwnProperty.call(m, "error")) && !m.method;
      if (isResp || (m && m.method && !hasId)) return new Response(null, { status: 202, headers: cors });
      return handleMcp(request, env, m.id != null ? m.id : null, m.method, m.params, ctx);
    }

    // KIRA(hs-kira-line)からの橋渡し: 加盟店メッセージを受け、返信文を返す(内部連携・共有鍵必須)
    if (path === "/kira-bridge") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      const bkey = request.headers.get("X-Bridge-Key") || "";
      if (!env.KIRA_BRIDGE_KEY || !(await ctEqual(bkey, env.KIRA_BRIDGE_KEY))) return json({ error: "forbidden" }, 403);
      let bb; try { bb = await request.json(); } catch (_e) { return json({ error: "bad_json" }, 400); }
      const uid = safeStr(bb.userId, 64);
      if (!/^U[0-9a-f]{32}$/.test(uid)) return json({ error: "bad_user" }, 400);
      const gid = /^[CR][0-9a-f]{32}$/.test(safeStr(bb.groupId || "", 64)) ? safeStr(bb.groupId || "", 64) : null;
      const out = await handleKiraBridge(env, uid, safeStr(bb.text, 6000), gid, Array.isArray(bb.estimates) ? bb.estimates : []);
      return json(out);
    }
    // KIRA(hs-kira-line)から: 加盟店が送った見積を審査材料(estimates_for_audit)に積む。共有鍵必須。
    if (path === "/kira-estimate") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      // 2026-08-22: 認証は共有鍵(X-Bridge-Key=KIRA_BRIDGE_KEY)か管理鍵(X-Admin-Key)のどちらかで通す。
      //   どちらか現行の方が通ればよい。両方外れたら forbidden。
      const bkey = request.headers.get("X-Bridge-Key") || "";
      const bridgeOk = !!(env.KIRA_BRIDGE_KEY && (await ctEqual(bkey, env.KIRA_BRIDGE_KEY)));
      if (!bridgeOk && !adminOk(request, env)) return json({ error: "forbidden" }, 403);
      let bb; try { bb = await request.json(); } catch (_e) { return json({ error: "bad_json" }, 400); }
      // 2026-08-22: store_id 直指定に対応(過去見積の再送なし投入用)。無ければ従来どおり LINE userId から解決。
      let sid = safeStr(bb.store_id, 40);
      if (sid) {
        const s0 = await env.HS_HEARING_KV.get("store:" + sid, "json");
        if (!s0) return json({ error: "not_found" }, 404);
      } else {
        const uid = safeStr(bb.userId, 64);
        if (!/^U[0-9a-f]{32}$/.test(uid)) return json({ error: "bad_user" }, 400);
        sid = await env.HS_HEARING_KV.get("line2store:" + uid, "text");
        if (!sid) sid = await env.HS_HEARING_KV.get("member2store:" + uid, "text");
      }
      const out = await appendEstimatesForAudit(env, sid, Array.isArray(bb.estimates) ? bb.estimates : []);
      return json(out);
    }


    // LINE Webhook: 加盟店ヒアリングのLINE版(登録->回答->自動構造化->生成)
    if (path === "/line/webhook") {
      if (request.method === "GET") return json({ ok: true, line: "webhook" }); // 疎通確認用
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      const bodyText = await request.text();
      const sig = request.headers.get("x-line-signature") || "";
      const okSig = await verifyLineSignature(env.LINE_CHANNEL_SECRET, bodyText, sig);
      if (!okSig) return json({ error: "bad_signature" }, 403);
      // LINEは即200を要求。処理は待たずに返す(waitUntilが無ければawaitでも可)。
      await handleLineWebhook(env, bodyText);
      return json({ ok: true });
    }

    // ヒアリングフォーム(GET) / 回答受信(POST)
    if (path.startsWith("/h/")) {
      const token = safeStr(decodeURIComponent(path.slice(3)), 80).replace(/[^A-Za-z0-9_-]/g, "");
      if (!token) return html("<h1>無効なリンクです</h1>", 400);
      const tokRec = await env.HS_HEARING_KV.get("htok:" + token, "json");
      if (!tokRec) return html("<h1>このヒアリングリンクは無効か、期限切れです</h1><p>運営(HORIZON SHIELD)にお問い合わせください。</p>", 404);
      const store = await env.HS_HEARING_KV.get("store:" + tokRec.store_id, "json");

      if (request.method === "GET") return html(hearingForm(token, store || tokRec));

      if (request.method === "POST") {
        let raw;
        try { raw = await request.json(); } catch (_e) { return json({ ok: false, error: "bad_json" }, 400); }
        if (!safeStr(raw.company) || !safeStr(raw.area) || !safeArr(raw.works).length) {
          return json({ ok: false, error: "社名・所在地・工種は必須です。" }, 400);
        }
        const incoming = normalizeProfile(store || tokRec, raw);
        const prev = await env.HS_HEARING_KV.get("hearing:" + tokRec.store_id, "json");
        if (store) AP.settlePendingOnAnswer(store, JSON.stringify(raw).slice(0, 3000)); // フォーム再送=pending消込+ペナルティ回復
        const profile = AP.mergeProfiles(prev && prev.profile, incoming);
        const now = new Date().toISOString();
        const record = { token, store_id: tokRec.store_id, profile, answered_at: now, completed: true, source: "form" };
        await env.HS_HEARING_KV.put("hearing:" + tokRec.store_id, JSON.stringify(record));
        if (store) {
          store.status = store.status === "published" ? "published" : "hearing_done";
          store.hearing_done_at = now;
          const ap2 = store.autopilot || {};
          if (!ap2.focus_primary) {
            const f = await AP.classifyFocus(env, store, profile);
            if (f.primary) { ap2.focus_primary = f.primary; ap2.focus_all = f.all; ap2.focus_via = f.via; }
          }
          ap2.completeness = AP.computeCompleteness(profile, ap2).score;
          store.autopilot = ap2;
          await env.HS_HEARING_KV.put("store:" + tokRec.store_id, JSON.stringify(store));
          await AP.activityAdd(env, { type: "answered", member_no: store.member_no, text: (store.company || "加盟店") + " がヒアリングに回答しました(完成度 " + ap2.completeness + "%)" });
        }
        // 薄いページを構造的に作らない: 完成度が基準未満なら生成を保留し、追撃質問で厚みを取りにいく
        const genMin = Number(env.GEN_MIN_COMPLETENESS || 60);
        const compNow = store && store.autopilot && store.autopilot.completeness != null
          ? store.autopilot.completeness
          : AP.computeCompleteness(profile, (store && store.autopilot) || {}).score;
        let gen;
        if (compNow >= genMin) {
          gen = await triggerGeneration(env, profile, store);  // 検証通過なら公開まで全自動(GitHub Action側でfail-closed検証)
        } else {
          gen = { triggered: false, held: true, completeness: compNow, min: genMin };
          await notify(env, "[Yakumo] フォーム回答を受信。完成度" + compNow + "%が基準" + genMin + "%未満のため生成を保留。追撃質問で補完する。store=" + tokRec.store_id);
        }
        return json({ ok: true, generation: gen });
      }
    }

    /* ---------- admin ---------- */
    if (path.startsWith("/admin/")) {
      if (!adminOk(request, env)) return json({ error: "forbidden" }, 403);

      // 加盟店をプロビジョン + WebMCPオプション有効化 + ヒアリングトークン発行
      if (path === "/admin/provision" && request.method === "POST") {
        let b; try { b = await request.json(); } catch (_e) { return json({ error: "bad_json" }, 400); }
        // 採番の正は member_no。連番(001,002...)は member_no に語らせ、caller の store_id は信用しない。
        // これで「明示 store_id=hs-partner-000 が自動採番を握り潰す」-000事故を構造的に殺す。
        const mnDigits = safeStr(b.member_no, 10).replace(/[^0-9]/g, "");
        const explicitId = safeStr(b.store_id, 40);
        const store_id = mnDigits ? ("hs-partner-" + mnDigits.padStart(3, "0")) : (explicitId || "hs-partner-000");
        if (explicitId && explicitId !== store_id) {
          await notify(env, "[Yakumo] provision: 明示store_id=" + explicitId + " が member_no由来(" + store_id + ")と不整合。member_no由来を採用。呼び出し側のstore_id指定は不要。");
        }
        const token = (b.token && safeStr(b.token, 60).replace(/[^A-Za-z0-9_-]/g, "")) ||
          ("ht_" + [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join(""));
        const store = {
          member_no: safeStr(b.member_no, 20),
          store_id,
          token,
          company: safeStr(b.company, 120),
          tier: safeStr(b.tier, 20) || "honbu",
          areas: safeArr(b.areas),
          works: safeArr(b.works),
          email: safeStr(b.email, 120),
          webmcp_option: b.webmcp_option !== false,
          plan: {
            base_tier: safeStr(b.tier, 20) || "honbu",
            base_fee_ex_tax: Number(b.base_fee_ex_tax) || 29800,
            webmcp_addon_ex_tax: Number(b.webmcp_addon_ex_tax) || 12000,
            total_ex_tax: (Number(b.base_fee_ex_tax) || 29800) + (b.webmcp_option === false ? 0 : (Number(b.webmcp_addon_ex_tax) || 12000)),
            currency: "JPY",
            tax_note: "税抜",
          },
          status: "onboarding",
          created_at: new Date().toISOString(),
        };
        await env.HS_HEARING_KV.put("store:" + store_id, JSON.stringify(store));
        await env.HS_HEARING_KV.put("htok:" + token, JSON.stringify({ store_id, member_no: store.member_no, company: store.company, created_at: store.created_at }));
        // メール返信を送信元アドレスで店に紐づけるための逆引き(email監視の照合用)
        if (store.email) await env.HS_HEARING_KV.put("email2store:" + store.email.toLowerCase(), store_id);
        await AP.activityAdd(env, { type: "joined", member_no: store.member_no, text: "新しい加盟店を迎えました(" + (store.member_no || store_id) + ")。検証の手続きが始まります。" });
        return json({ ok: true, store, hearing_url: url.origin + "/h/" + token, email_ref: "ref:" + token });
      }

      // ヒアリング案内メールを送信(RESEND)。件名に ref:<token> を入れて返信を自動照合できるようにする。
      if (path === "/admin/send-hearing" && request.method === "POST") {
        let b; try { b = await request.json(); } catch (_e) { return json({ error: "bad_json" }, 400); }
        const tok = safeStr(b.token, 60).replace(/[^A-Za-z0-9_-]/g, "");
        const to = safeStr(b.to, 120);
        if (!tok || !to) return json({ error: "token と to が必要" }, 400);
        const tokRec = await env.HS_HEARING_KV.get("htok:" + tok, "json");
        if (!tokRec) return json({ error: "unknown_token" }, 404);
        const res = await sendHearingEmail(env, { to, token: tok, company: tokRec.company, memberNo: tokRec.member_no, origin: url.origin,
          // 業種を渡す。建設以外なら、この文面は送らずに理由を返す。
          industry: (tokRec.profile && tokRec.profile.industry) || tokRec.industry || null });
        return json(res, res.ok ? 200 : 502);
      }

      // メール返信の全自動取り込み(Google Apps Script 橋渡し用)。
      // MXがGoogle Workspaceのため Cloudflare Email Routing は使わず、Apps Scriptが受信箱を見張って
      // ref:トークン付きの返信本文をここへPOSTする。件名tokenか送信元emailで店に照合し、同じ ingest 経路へ。
      if (path === "/admin/email-ingest" && request.method === "POST") {
        let b; try { b = await request.json(); } catch (_e) { return json({ error: "bad_json" }, 400); }
        const text = safeStr(b.text, 6000);
        if (!text) return json({ error: "text が必要" }, 400);
        let sid = null;
        const tok = safeStr(b.token, 60).replace(/[^A-Za-z0-9_-]/g, "");
        if (tok) {
          const rec = await env.HS_HEARING_KV.get("htok:" + tok, "json");
          if (rec) sid = rec.store_id;
        }
        if (!sid && b.from) {
          const fromAddr = safeStr(b.from, 120).toLowerCase();
          sid = await env.HS_HEARING_KV.get("email2store:" + fromAddr, "text");
        }
        if (!sid) return json({ ok: false, reason: "unresolved(tokenもfromも店に紐づかず)" }, 404);
        const store = await env.HS_HEARING_KV.get("store:" + sid, "json");
        const res = await ingestHearingAnswer(env, sid, store, text, "email");
        return json({ ok: res.ok, store_id: sid, result: res });
      }

      // 初回あいさつメール(TOshi方針: 初回はあいさつ、本格ヒアリングは翌週 send-hearing で)
      if (path === "/admin/send-greeting" && request.method === "POST") {
        let b; try { b = await request.json(); } catch (_e) { return json({ error: "bad_json" }, 400); }
        const to = safeStr(b.to, 120);
        if (!to) return json({ error: "to が必要" }, 400);
        const res = await sendGreetingEmail(env, { to, company: safeStr(b.company, 120) });
        return json(res, res.ok ? 200 : 502);
      }

      // LINE userId を店に手動で紐づける(自己登録コードを使わない場合の予備)
      if (path === "/admin/link-line" && request.method === "POST") {
        let b; try { b = await request.json(); } catch (_e) { return json({ error: "bad_json" }, 400); }
        const sid = safeStr(b.store_id, 40);
        const uid = safeStr(b.line_user_id, 60);
        if (!sid || !uid) return json({ error: "store_id と line_user_id が必要" }, 400);
        await env.HS_HEARING_KV.put("line2store:" + uid, sid);
        await env.HS_HEARING_KV.put("store2line:" + sid, uid);
        return json({ ok: true, store_id: sid, line_user_id: uid });
      }

      // 2026-08-22: 既存店に審査用の実見積を store_id 直指定で積む(LINE紐付けに一切依存しない)。
      //   峰尾さんのように、過去の見積が人手対応に流れて未保存の店を、再送なしで採点キューに載せるための口。
      //   appendEstimatesForAudit がそのまま自動採点 + fail-closed 自動掲載まで回す。store2line は触らない。
      if (path === "/admin/append-estimates" && request.method === "POST") {
        let b; try { b = await request.json(); } catch (_e) { return json({ error: "bad_json" }, 400); }
        const sid = safeStr(b.store_id, 40);
        if (!sid) return json({ error: "store_id が必要" }, 400);
        const s = await env.HS_HEARING_KV.get("store:" + sid, "json");
        if (!s) return json({ error: "not_found" }, 404);
        const out = await appendEstimatesForAudit(env, sid, Array.isArray(b.estimates) ? b.estimates : []);
        return json(out);
      }

      // 管理ダッシュボード用: 全加盟店＋ヒアリング状況
      if (path === "/admin/stores" && request.method === "GET") {
        const stores = await listAllStores(env);
        const rows = [];
        for (const s of stores) {
          const h = await env.HS_HEARING_KV.get("hearing:" + s.store_id, "json");
          const line = await env.HS_HEARING_KV.get("store2line:" + s.store_id, "text");
          const ap = s.autopilot || {};
          rows.push({
            ...storeToContractor(s),
            // 2026-08-24: 業種をここに出していなかった。
            //   store: 側に業種が入っているかを、外から見る手段が無かった。
            //   道具が row.get("industry") を見て、常に undefined を得て、
            //   「業種が無い」と報告し続けた。書き込みは成功していたのに。
            //   見えない欄について「無い」とは言えない。だから見えるようにする。
            industry: s.industry || null,
            industry_decided_at: s.industry_decided_at || null,
            tier: s.tier || null,
            plan: s.plan || null,
            email: s.email || "",
            token: s.token || null,
            hearing_url: s.token ? ("https://shield.the-horizons-innovation.com/yakumo/register/?code=" + s.token) : null,
            created_at: s.created_at || null,
            hearing_completed: !!(h && h.completed),
            hearing_source: (h && h.source) || null,
            answered_at: (h && h.answered_at) || null,
            line_linked: !!line,
            autopilot: {
              focus_primary: ap.focus_primary || null,
              completeness: ap.completeness != null ? ap.completeness : null,
              pending: ap.pending ? { qids: ap.pending.qids, sent_at: ap.pending.sent_at, via: ap.pending.via } : null,
              asked_count: (ap.asked || []).length,
              nudges: ap.nudges || 0,
              penalty: ap.penalty || 0,
              last_answer_at: ap.last_answer_at || null,
            },
            referral_count: await AP.refCount(env, s.member_no),
          });
        }
        rows.sort((a, b) => String(a.member_no || "").localeCompare(String(b.member_no || "")));
        return json({ ok: true, count: rows.length, stores: rows });
      }

      // 検証済み化(KIRA審査の結果をKVに反映 -> モール/MCPが自動で「検証済み+スコア」に)
      if (path === "/admin/verify" && request.method === "POST") {
        let b; try { b = await request.json(); } catch (_e) { return json({ error: "bad_json" }, 400); }
        const sid = safeStr(b.store_id, 40);
        const s = await env.HS_HEARING_KV.get("store:" + sid, "json");
        if (!s) return json({ error: "not_found" }, 404);
        const score = Number(b.fairness_score);
        if (!(score >= 0 && score <= 100)) return json({ error: "fairness_score は 0-100" }, 400);
        // 2026-08-19 patch51: 運営自身にも fail-closed。
        // 実物の見積が規定本数に届いていなければ、スコアを受け付けない。
        // 他人のMCPに課している条件を、一番内側にも通す。近道の経路を残さない。
        const hrec = await env.HS_HEARING_KV.get("hearing:" + sid, "json");
        const ests = (hrec && hrec.profile && hrec.profile.estimates_for_audit) || [];
        if (ests.length < AP.MIN_AUDIT_ESTIMATES) {
          return json({
            error: "insufficient_evidence",
            need: AP.MIN_AUDIT_ESTIMATES,
            have: ests.length,
            means: "監査した見積の実物が規定本数に届いていない。分母の無いスコアは出さない。これは店への評価ではなく、こちらの手続きが終わっていないという意味。",
          }, 409);
        }
        s.audit_evidence = {
          estimates: ests.length,
          works: Array.from(new Set(ests.map((e) => String((e && e.work) || "")).filter(Boolean))).slice(0, 8),
          recorded_at: new Date().toISOString(),
        };
        s.verification = "verified";
        s.fairness_score = score;
        s.integrity_tier = safeStr(b.integrity_tier, 4) || "A";
        s.red_flags_detected = Number(b.red_flags_detected) || 0;
        if (b.claim_sha256) s.claim_sha256 = safeStr(b.claim_sha256, 80);
        s.status = "published";
        s.verified_at = new Date().toISOString();
        await env.HS_HEARING_KV.put("store:" + sid, JSON.stringify(s));
        await AP.activityAdd(env, { type: "verified", member_no: s.member_no, text: (s.company || "加盟店") + " が適正価格の第三者検証(KIRA)を通過しました" });
        return json({ ok: true, store: storeToContractor(s) });
      }

      // 正規化済みプロフィールをエクスポート(生成側/確認用)
      if (path.startsWith("/admin/export/") && request.method === "GET") {
        const sid = safeStr(decodeURIComponent(path.slice("/admin/export/".length)), 60);
        const rec = await env.HS_HEARING_KV.get("hearing:" + sid, "json");
        if (!rec) return json({ error: "not_found" }, 404);
        return json({ ok: true, profile: rec.profile, answered_at: rec.answered_at });
      }

      // 生の回答(監査用・金額込み)を取得
      if (path.startsWith("/admin/hearing/") && request.method === "GET") {
        const sid = safeStr(decodeURIComponent(path.slice("/admin/hearing/".length)), 60);
        const rec = await env.HS_HEARING_KV.get("hearing:" + sid, "json");
        if (!rec) return json({ error: "not_found" }, 404);
        return json({ ok: true, record: rec });
      }

      // 2026-08-19 patch58: profile の文字列項目を1つだけ直す口。
      //   これが無かったので、峰尾さんの代表者名を入れる正規の手段が存在しなかった。
      //   /admin/provision は store レコードを丸ごと上書きしてトークンとLINE紐付けとasked履歴を壊す。
      //   /admin/verify はスコアしか触らない。だから狭い口をここに作る。
      //   配列(工種・エリア・FAQ・見積もり例)には触らせない。誰がいつ何を直したかを profile.edits に残す。
      if (path === "/admin/profile-patch" && request.method === "POST") {
        let b; try { b = await request.json(); } catch (_e) { return json({ error: "bad_json" }, 400); }
        const sid = safeStr(b.store_id, 40);
        const rec = await env.HS_HEARING_KV.get("hearing:" + sid, "json");
        if (!rec || !rec.profile) return json({ error: "not_found" }, 404);
        // 2026-08-23: 直せる項目が文字列8つしかなく、エリアも業種も直せなかった。
        // こちらが取り違えたものを、こちらで直せないのは筋が通らない。
        // 実際に「二宮町要相談」から条件が落ちた件を、この口から戻した。
        const ALLOW = ["rep", "license", "contact", "hours", "ng", "story", "strengths", "trust",
                       "company", "area", "industry"];
        const ALLOW_ARR = ["areas_served", "works", "cases"];
        const fields = (b.fields && typeof b.fields === "object") ? b.fields : {};
        const applied = {};
        for (const k of ALLOW) {
          if (!Object.prototype.hasOwnProperty.call(fields, k)) continue;
          const to = safeStr(fields[k], 2000);
          applied[k] = { from: safeStr(rec.profile[k], 2000), to };
          rec.profile[k] = to;
        }
        for (const k of ALLOW_ARR) {
          if (!Object.prototype.hasOwnProperty.call(fields, k)) continue;
          if (!Array.isArray(fields[k])) return json({ error: "must_be_array", field: k }, 400);
          const to = fields[k].map((x) => safeStr(x, 120)).filter(Boolean).slice(0, 40);
          applied[k] = { from: (rec.profile[k] || []).slice(0, 40), to };
          rec.profile[k] = to;
        }
        if (!Object.keys(applied).length) {
          return json({ error: "no_allowed_field", allow: ALLOW, allow_array: ALLOW_ARR }, 400);
        }
        rec.profile.edits = [...(rec.profile.edits || []),
          { at: new Date().toISOString(), by: "admin", fields: Object.keys(applied) }].slice(-20);
        await env.HS_HEARING_KV.put("hearing:" + sid, JSON.stringify(rec));
        await notify(env, "[Yakumo] profile-patch: " + sid + " " + Object.keys(applied).join(","));
        return json({ ok: true, store_id: sid, applied });
      }

      /* ---------- AUTOPILOT admin ---------- */
      // 追撃質問を今すぐ送る(自動選定・重複質問ゼロ)
      if (path === "/admin/followup" && request.method === "POST") {
        let b; try { b = await request.json(); } catch (_e) { return json({ error: "bad_json" }, 400); }
        const sid = safeStr(b.store_id, 40);
        const store = await env.HS_HEARING_KV.get("store:" + sid, "json");
        if (!store) return json({ error: "not_found" }, 404);
        const hearing = await env.HS_HEARING_KV.get("hearing:" + sid, "json");
        const ap = store.autopilot || {};
        const qs = AP.nextQuestions((hearing && hearing.profile) || {}, ap, Number(b.max) || 2);
        if (!qs.length) return json({ ok: false, reason: "質問なし(完成度が十分か、全て送信済み)" });
        const r = await AP.sendQuestions(env, store, qs, "followup");
        if (!r.ok) return json({ ok: false, reason: r.reason }, 502);
        ap.pending = { qids: qs.map((q) => q.qid), text: qs.map((q) => q.text).join("\n"), sent_at: new Date().toISOString(), via: r.via };
        ap.asked = [...(ap.asked || []), ...qs.map((q) => ({ qid: q.qid, at: new Date().toISOString(), answered: false }))].slice(-50);
        ap.last_send_at = new Date().toISOString();
        store.autopilot = ap;
        await env.HS_HEARING_KV.put("store:" + sid, JSON.stringify(store));
        return json({ ok: true, sent: qs.map((q) => q.qid), via: r.via });
      }

      // フォーカス再判定
      if (path === "/admin/classify" && request.method === "POST") {
        let b; try { b = await request.json(); } catch (_e) { return json({ error: "bad_json" }, 400); }
        const sid = safeStr(b.store_id, 40);
        const store = await env.HS_HEARING_KV.get("store:" + sid, "json");
        if (!store) return json({ error: "not_found" }, 404);
        const hearing = await env.HS_HEARING_KV.get("hearing:" + sid, "json");
        const ap = store.autopilot || {};
        if (b.focus && ["recruit","leads","homeowners","franchise","brand"].includes(b.focus)) {
          ap.focus_primary = b.focus; ap.focus_all = [b.focus]; ap.focus_via = "manual";
        } else {
          const f = await AP.classifyFocus(env, store, (hearing && hearing.profile) || null);
          ap.focus_primary = f.primary; ap.focus_all = f.all; ap.focus_via = f.via;
        }
        ap.completeness = AP.computeCompleteness((hearing && hearing.profile) || {}, ap).score;
        store.autopilot = ap;
        await env.HS_HEARING_KV.put("store:" + sid, JSON.stringify(store));
        return json({ ok: true, focus_primary: ap.focus_primary, via: ap.focus_via, completeness: ap.completeness });
      }

      // 注意喚起を今すぐ送る(こんなことはありますか？)
      if (path === "/admin/nudge" && request.method === "POST") {
        let b; try { b = await request.json(); } catch (_e) { return json({ error: "bad_json" }, 400); }
        const sid = safeStr(b.store_id, 40);
        const store = await env.HS_HEARING_KV.get("store:" + sid, "json");
        if (!store) return json({ error: "not_found" }, 404);
        const hearing = await env.HS_HEARING_KV.get("hearing:" + sid, "json");
        const ap = store.autopilot || {};
        const qs = AP.nextQuestions((hearing && hearing.profile) || {}, ap, 1);
        const sentQs = qs.length ? qs : [{ qid: "q_trust", text: AP.QUESTION_BANK.q_trust.text }];
        const r = await AP.sendQuestions(env, store, sentQs, "nudge");
        if (!r.ok) return json({ ok: false, reason: r.reason }, 502);
        // 2026-08-19 patch55: nudge で実際に送った質問も asked に記録する。
        // 2026-08-19 patch63: ただし q_trust のフォールバックは数えない。数えると
        //   ASK_MAX=3 を食い潰して、その項目を恒久的に聞けなくする。
        const nudgeAt = new Date().toISOString();
        if (qs.length) ap.asked = [...(ap.asked || []), ...qs.map((q) => ({ qid: q.qid, at: nudgeAt, answered: false, via: "nudge" }))].slice(-50);
        ap.last_send_at = nudgeAt;
        ap.nudges = (ap.nudges || 0) + 1;
        store.autopilot = ap;
        await env.HS_HEARING_KV.put("store:" + sid, JSON.stringify(store));
        return json({ ok: true, via: r.via, nudges: ap.nudges });
      }

      // 運用状態の全容
      if (path.startsWith("/admin/autopilot/") && request.method === "GET") {
        const sid = safeStr(decodeURIComponent(path.slice("/admin/autopilot/".length)), 60);
        const store = await env.HS_HEARING_KV.get("store:" + sid, "json");
        if (!store) return json({ error: "not_found" }, 404);
        const hearing = await env.HS_HEARING_KV.get("hearing:" + sid, "json");
        const ap = store.autopilot || {};
        const comp = AP.computeCompleteness((hearing && hearing.profile) || {}, ap);
        return json({ ok: true, autopilot: ap, completeness: comp.score, missing: comp.missing, referral_count: await AP.refCount(env, store.member_no) });
      }

      // 重複ゼロ台帳
      if (path === "/admin/dedup-check" && request.method === "POST") {
        let b; try { b = await request.json(); } catch (_e) { return json({ error: "bad_json" }, 400); }
        return json(await AP.dedupCheck(env, { slug: safeStr(b.slug, 160), title: safeStr(b.title, 300), body: String(b.body || "").slice(0, 30000) }));
      }
      if (path === "/admin/dedup-register" && request.method === "POST") {
        let b; try { b = await request.json(); } catch (_e) { return json({ error: "bad_json" }, 400); }
        return json({ ok: true, ...(await AP.dedupRegister(env, b.items || [])) });
      }

      // ニュース(設定制・捏造ゼロ)
      if (path === "/admin/news" && request.method === "GET") return json(await AP.newsDigest(env));
      if (path === "/admin/news-refresh" && request.method === "POST") return json(await AP.newsRefresh(env));
      if (path === "/admin/news-sources" && request.method === "POST") {
        let b; try { b = await request.json(); } catch (_e) { return json({ error: "bad_json" }, 400); }
        const urls = (Array.isArray(b.urls) ? b.urls : []).map((u) => safeStr(u, 300)).filter((u) => u.startsWith("https://")).slice(0, 5);
        await env.HS_HEARING_KV.put("news:sources", JSON.stringify(urls));
        return json({ ok: true, sources: urls });
      }

      // 活動フィードへの外部記録(GitHub Actionの公開コールバック用)
      if (path === "/admin/activity" && request.method === "POST") {
        let b; try { b = await request.json(); } catch (_e) { return json({ error: "bad_json" }, 400); }
        await AP.activityAdd(env, { type: safeStr(b.type, 30) || "note", member_no: safeStr(b.member_no, 20), text: safeStr(b.text, 200) });
        return json({ ok: true });
      }

      // SNS下書き(コピペ投稿用)
      if (path === "/admin/sns-drafts" && request.method === "POST") {
        const events = await AP.activityList(env, 10);
        return json({ ok: true, drafts: AP.snsDrafts(events) });
      }

      // 日次処理の手動実行
      if (path === "/admin/tick" && request.method === "POST") {
        const log = await AP.runDailyTick(env, { listAllStores, triggerGeneration });
        return json({ ok: true, log });
      }

      // 保全エージェント弐号の単独実行(内臓検診のみ)
      if (path === "/admin/selfheal" && request.method === "POST") {
        const report = await AP.selfHeal(env, await listAllStores(env));
        return json({ ok: true, report });
      }
      // 2026-08-19 patch45: 証拠監査の結果。いつでも読める。
      if (path === "/admin/selfcheck" && request.method === "GET") {
        const stores = await listAllStores(env);
        return json(await AP.selfCheck(env, stores));
      }
      if (path === "/admin/selfcheck/last" && request.method === "GET") {
        return json({ ok: true, report: (await env.HS_HEARING_KV.get("selfcheck:last", "json")) || null });
      }

      // 壱号が読む詳細レポート(修復済み一覧と未解決課題)
      if (path === "/admin/guardian" && request.method === "GET") {
        const g = (await env.HS_HEARING_KV.get("guardian:last", "json")) || null;
        return json({ ok: true, report: g });
      }

      // 旧レコードにトークンを後付け(No.001対応)
      if (path === "/admin/link-token" && request.method === "POST") {
        let b; try { b = await request.json(); } catch (_e) { return json({ error: "bad_json" }, 400); }
        const sid = safeStr(b.store_id, 40);
        const tok = safeStr(b.token, 60).replace(/[^A-Za-z0-9_-]/g, "");
        const store = await env.HS_HEARING_KV.get("store:" + sid, "json");
        if (!store || !tok) return json({ error: "not_found_or_bad_token" }, 404);
        store.token = tok;
        await env.HS_HEARING_KV.put("store:" + sid, JSON.stringify(store));
        const existing = await env.HS_HEARING_KV.get("htok:" + tok, "json");
        if (!existing) await env.HS_HEARING_KV.put("htok:" + tok, JSON.stringify({ store_id: sid, member_no: store.member_no, company: store.company, created_at: new Date().toISOString() }));
        return json({ ok: true, store_id: sid, token: tok });
      }

      return json({ error: "unknown_admin_route" }, 404);
    }

    // ルート案内
    if (path === "/") return json({ server: SERVER.name, mall: MALL_URL, mcp: url.origin + "/mcp", agent_card: url.origin + "/.well-known/agent-card.json" });

    return json({ error: "not_found" }, 404);
  },

  // AUTOPILOT: 日次cron(wrangler.jsonc triggers.crons)。巡回して追撃質問・注意喚起・ニュース更新を自動実行。
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        const log = await AP.runDailyTick(env, { listAllStores, triggerGeneration });
        // patch39: 件数だけでは誰を追えばよいか分からない。待っている相手を名前と日数で出す。
        let waiting = "";
        try {
          const stores = await listAllStores(env);
          const nowMs = Date.now();
          const lines = [];
          for (const s of stores) {
            const ap = s.autopilot || {};
            if (!ap.pending || !ap.pending.sent_at) continue;
            const d = Math.floor((nowMs - Date.parse(ap.pending.sent_at)) / 86400000);
            lines.push("  " + (s.company || s.store_id) + " " + d + "日待ち 催促" + (ap.nudges || 0) + "回 完成度" + (ap.completeness == null ? "?" : ap.completeness));
          }
          if (lines.length) waiting = "\n返事待ち:\n" + lines.join("\n");
        } catch (_e) {}
        // 2026-08-19 patch45: 証拠監査で落ちた項目があれば必ず載せる。全部通っていれば静か。
        let alarms = "";
        try {
          const sc = log.selfcheck;
          if (sc && !sc.pass) {
            alarms = "\n\n証拠監査で落ちた項目:\n" +
              sc.checks.filter((c) => !c.ok).map((c) => "  " + c.id + " : " + c.detail).join("\n");
          }
        } catch (_e) {}
        await notify(env, "[Yakumo AUTOPILOT] 日次巡回 完了: " + JSON.stringify({ checked: log.checked, sent: log.sent.length, nudged: log.nudged.length, penalized: log.penalized.length }).slice(0, 400) + waiting + alarms);
      } catch (e) {
        await notify(env, "[Yakumo AUTOPILOT] 日次巡回 エラー: " + String(e).slice(0, 200));
      }
    })());
  },

  // Cloudflare Email Routing の宛先ワーカー。堤さんがメールで返信してきた分を安全網として吸い取る。
  // 方針(TOshi確定): 構造化 -> 関所(必須項目チェック + 下流 validate.py) -> 通れば自動公開 / 落ちたら通知。
  async email(message, env, _ctx) {
    try {
      const subject = (message.headers && message.headers.get("subject")) || "";
      const resolved = await resolveStoreFromEmail(env, message);
      if (!resolved) {
        // どの店にも紐づかない = 自動処理しない(fail-closed)。通知だけして手動判断に回す。
        await notify(env, "[Yakumo] 未紐づけのメール受信。from=" + (message.from || "?") + " subj=" + subject);
        return;
      }
      const store = await env.HS_HEARING_KV.get("store:" + resolved.store_id, "json");
      const raw = await readRaw(message);
      const text = extractPlainBody(raw);
      // 生返信は必ず保存(監査・手動フォールバック用)。時刻はDate.now()で一意化。
      await env.HS_HEARING_KV.put("emailreply:" + resolved.store_id + ":" + Date.now(), JSON.stringify({ from: message.from, subject, text, at: new Date().toISOString(), via: resolved.via }));

      // AUTOPILOT共通取り込み: 構造化->マージ->pending消込->関所->生成トリガー(fail-closed)
      const res = await ingestHearingAnswer(env, resolved.store_id, store, text, "email");
      if (!res.ok && res.reason === "missing-required") {
        await notify(env, "[Yakumo] メール返信を構造化したが必須項目が不足。自動公開せず通知。store=" + resolved.store_id + " from=" + message.from);
        return;
      }
      if (!res.ok) {
        await notify(env, "[Yakumo] メール返信を受信(自動構造化できず: " + res.reason + ")。手動確認を。store=" + resolved.store_id + " from=" + message.from);
        return;
      }
      await notify(env, "[Yakumo] メール返信を自動構造化→生成トリガー: " + ((store && store.company) || resolved.store_id) + " via " + resolved.via + " / dispatch=" + JSON.stringify(res.gen));
    } catch (e) {
      await notify(env, "[Yakumo] email handler error: " + String(e).slice(0, 120));
    }
  },
};
