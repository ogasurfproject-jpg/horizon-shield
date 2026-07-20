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

const SERVER = { name: "HORIZON SHIELD YAKUMO", version: "2.2.0" };
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
  const company = safeStr(store && store.company, 120) || "加盟店";
  const memberNo = safeStr(store && store.member_no, 20) || "";
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

'<button type="submit" class="submit">回答を送信する</button>' +
'<p class="note">送信内容は The HORIZONs株式会社(HORIZON SHIELD)が加盟店運営のために使用します。金額は施主向けに公開しません。</p>' +
'</form>' +
'<div class="ok" id="ok"><h2>ありがとうございます</h2><p style="color:#7E8CA2;">回答を受け取りました。適正診断(KIRA)とページ作成の準備に入ります。結果は運営からご連絡します。</p></div>' +

'<script>' +
'var TOKEN=' + JSON.stringify(token) + ';' +
'document.querySelectorAll("#works .chip").forEach(function(c){c.addEventListener("click",function(){c.classList.toggle("on");});});' +
'document.getElementById("addEst").addEventListener("click",function(){var d=document.createElement("div");d.className="card est";d.innerHTML=\'<div class="row2"><div><input type="text" class="e-work" placeholder="工種"></div><div><input type="text" class="e-amount" placeholder="概算金額"></div></div><input type="text" class="e-detail" placeholder="内訳の要点(任意)" style="margin-top:8px;">\';document.getElementById("estimates").appendChild(d);});' +
'document.getElementById("addFaq").addEventListener("click",function(){var d=document.createElement("div");d.className="card faq";d.innerHTML=\'<input type="text" class="q" placeholder="質問"><textarea class="a" placeholder="答え" style="margin-top:8px;"></textarea>\';document.getElementById("faqs").appendChild(d);});' +
'function val(id){var e=document.getElementById(id);return e?e.value.trim():"";}' +
'document.getElementById("f").addEventListener("submit",function(ev){ev.preventDefault();' +
'var works=[];document.querySelectorAll("#works .chip.on").forEach(function(c){works.push(c.getAttribute("data-w"));});' +
'var wo=val("worksOther");if(wo){wo.split(",").forEach(function(x){x=x.trim();if(x)works.push(x);});}' +
'var estimates=[];document.querySelectorAll("#estimates .est").forEach(function(c){var w=c.querySelector(".e-work").value.trim();var a=c.querySelector(".e-amount").value.trim();var de=c.querySelector(".e-detail").value.trim();if(w||a)estimates.push({work:w,amount:a,detail:de});});' +
'var faqs=[];document.querySelectorAll("#faqs .faq").forEach(function(c){var q=c.querySelector(".q").value.trim();var a=c.querySelector(".a").value.trim();if(q&&a)faqs.push({q:q,a:a});});' +
'var payload={company:val("company"),rep:val("rep"),license:val("license"),area:val("area"),areas:val("areas"),works:works,strengths:val("strengths"),estimates:estimates,faqs:faqs,trust:val("trust"),contact:val("contact"),hours:val("hours"),ng:val("ng")};' +
'if(!payload.company||!payload.area||works.length===0){alert("社名・所在地・工種は必須です。");return;}' +
'fetch("/h/"+TOKEN,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}).then(function(r){return r.json();}).then(function(res){if(res&&res.ok){document.getElementById("f").style.display="none";document.getElementById("ok").style.display="block";window.scrollTo(0,0);}else{alert((res&&res.error)||"送信に失敗しました。時間をおいて再度お試しください。");}}).catch(function(){alert("通信エラー。時間をおいて再度お試しください。");});' +
'});' +
'</script>' +
'</div></body></html>';
}

/* ------------------------------ normalize answers ------------------------------ */
function normalizeProfile(store, raw) {
  const areasField = safeStr(raw.areas, 400);
  const areas_served = areasField
    ? areasField.split(/[,、]/).map((s) => s.trim()).filter(Boolean).slice(0, 20)
    : (store && store.areas ? safeArr(store.areas) : []);
  const works = safeArr(raw.works, 20, 40);
  const estimates = Array.isArray(raw.estimates)
    ? raw.estimates.slice(0, 5).map((e) => ({
        work: safeStr(e.work, 80),
        amount: safeStr(e.amount, 20).replace(/[^0-9]/g, ""),  // 監査用の数値のみ
        detail: safeStr(e.detail, 200),
      })).filter((e) => e.work || e.amount)
    : [];
  const faqs = Array.isArray(raw.faqs)
    ? raw.faqs.slice(0, 8).map((f) => ({ q: safeStr(f.q, 120), a: safeStr(f.a, 600) })).filter((f) => f.q && f.a)
    : [];
  return {
    member_no: (store && store.member_no) || null,
    store_id: (store && store.store_id) || null,
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
  const autopilot = { focus_primary: ap.focus_primary || null, completeness: ap.completeness || 0, news: (news.items || []).slice(0, 5) };
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
const OUT_OBJ = { type: "object", additionalProperties: true };
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
];

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
    note: verified ? "検証済み(KIRA適正診断 通過)" : "検証手続き中。通過するまでスコアは出しません(fail-closed)。",
  };
}
// MCPはKVライブを一次ソースに(静的シードはフォールバック)。AIが常に最新の検証状態を引ける。
async function liveContractors(env) {
  try {
    const stores = await listAllStores(env);
    if (stores.length) return stores.map(storeToContractor);
  } catch (_e) {}
  const pub = await fetchPublished(env);
  return pub.contractors || [];
}

// 露出計測フィード(hs-webmcp /beacon へ件数だけ流す)。店に見せる「貢献レポート」の AI 面の実数。
// fail-open: 計測が落ちても MCP 応答は絶対に壊さない。store_id と event 名以外は送らない。
const STATS_SINK = "https://hs-webmcp.oga-surf-project.workers.dev/beacon";
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
  "tools: find_contractor(自由記述から検証済み店を探す司令塔), list_verified_stores(地域x工種で一覧), get_contractor_profile(1件詳細), mall_overview(モール要約), how_verification_works(審査の仕組み)。" +
  "resources: yakumo://mall, yakumo://verification, yakumo://categories, yakumo://store/{member_no}。prompts: find_a_contractor / is_this_store_trustworthy。" +
  "断定せず施主の判断を尊重。紹介料は受け取らない。Japan, verified-first。";
const VERIFY_MD =
  "# Yakumo の検証の仕組み\n\n" +
  "Yakumo は施工業者から紹介手数料や送客報酬を受け取りません。掲載の可否は、独立第三者(KIRA, 大賀俊勝 建設実務30年 監修)の適正診断を通過するかどうかだけで決まります。\n\n" +
  "- 実際の見積もり例を、オープン建設費DB(JCCDB 65,729品目)と souba-db に照合し適正価格を検証。\n" +
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
    dataset: "JCCDB 65,729品目に照合(souba-db, 大賀俊勝 実務監修)",
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
    const contractors = await liveContractors(env);
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
    const contractors = await liveContractors(env);
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
    const contractors = await liveContractors(env);
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
        verified_count: verified.length,
        pending_count: pending.length,
        stores: verified,
        pending_stores: pending,
        disclaimer: "Yakumoは紹介料を受け取らない中立モール。掲載は適正診断の通過だけで決まる。金額は返さない(スコア・ティアのみ)。",
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
  const sys = "You extract structured data from a Japanese renovation/construction contractor's email reply. Output ONLY a JSON object (no prose, no code fences) with keys: company (string), rep (string), license (string), area (string, city level), areas (comma-separated string of service areas), works (array of trade strings in Japanese e.g. 外壁塗装), strengths (string), faqs (array of objects with q and a), trust (string), contact (string), hours (string). Do NOT invent prices or amounts. Unknown fields: empty string or empty array.";
  const usr = "既知の会社名: " + ((store && store.company) || "") + "\n--- 返信本文 ---\n" + text;
  let out = "";
  try {
    if (env.AI && typeof env.AI.run === "function") {
      const r = await env.AI.run(env.LLM_MODEL || "@cf/meta/llama-3.1-8b-instruct", { messages: [{ role: "system", content: sys }, { role: "user", content: usr }], max_tokens: 900 });
      out = (r && (r.response || r.result || r.output_text)) || "";
    } else if (env.LLM_API_URL && env.LLM_API_KEY) {
      const r = await fetch(env.LLM_API_URL, { method: "POST", headers: { "Authorization": "Bearer " + env.LLM_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ model: env.LLM_MODEL || "gpt-4o-mini", temperature: 0, messages: [{ role: "system", content: sys }, { role: "user", content: usr }] }) });
      const j = await r.json();
      out = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
    } else {
      return { ok: false, reason: "llm-not-configured" };
    }
  } catch (e) { return { ok: false, reason: "llm-error:" + String(e).slice(0, 60) }; }
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) return { ok: false, reason: "no-json" };
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
async function sendHearingEmail(env, { to, token, company, memberNo, origin }) {
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
    } else {
      await lineReply(env, replyToken, "受け取りました。内容を確認して運営からご連絡します。");
      await notify(env, "[Yakumo] LINE回答を受信(自動構造化できず: " + res.reason + ")。手動確認を。store=" + linkedStoreId);
    }
  }
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
function storeToContractor(s) {
  const areas = Array.isArray(s.areas) ? s.areas : [];
  const verified = s.verification === "verified" && s.fairness_score != null;
  const penalty = (s.autopilot && Number(s.autopilot.penalty)) || 0;
  return {
    member_no: s.member_no || null,
    store_id: s.store_id,
    name: s.company || "",
    area: s.area || areas[0] || "",
    areas_served: areas,
    works: Array.isArray(s.works) ? s.works : [],
    verification: verified ? "verified" : "pending",
    // fairness_score は KIRA純正のまま(不改変)。表示ランクは rank_score(運用状態込み)から。
    fairness_score: verified ? s.fairness_score : null,
    rank_score: verified ? Math.max(0, Number(s.fairness_score) - penalty) : null,
    engagement_state: penalty >= 5 ? "at_risk" : penalty > 0 ? "stale" : "active",
    integrity_tier: verified ? (s.integrity_tier || null) : null,
    red_flags_detected: verified ? (s.red_flags_detected != null ? s.red_flags_detected : null) : null,
    claim_sha256: verified ? (s.claim_sha256 || null) : null,
    profile_url: s.profile_url || (s.store_id === "hs-partner-001" ? "/yakumo/no001/" : "/yakumo/"),
    mcp_url: "https://hs-hearing.oga-surf-project.workers.dev/mcp",
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
"  var me=document.currentScript, ORIGIN='https://hs-hearing.oga-surf-project.workers.dev';\n" +
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
      const stores = await listAllStores(env);
      const contractors = stores.map(storeToContractor);
      return json({
        schema: "yakumo-contractors/v1",
        generated_at: new Date().toISOString(),
        source: "hs-hearing KV (live)",
        contractors,
        // 照会/検証の回数はここに置かない(実測でない数字を配らない)。実カウンタは hs-mcp /.well-known/usage-stats.json。
        stats: { source_count: 8, jccdb_items: 65729, as_of: "2026-06-30" },
      }, 200, { "Cache-Control": "public, max-age=60" });
    }

    // 登録画面用: 登録コード(token)で店の表示情報を返す(招待された加盟店向け・公開)。金額はtierと合算のみ。
    if (path === "/register-info") {
      const tok = safeStr(url.searchParams.get("token"), 80).replace(/[^A-Za-z0-9_-]/g, "");
      if (!tok) return json({ exists: false });
      const rec = await env.HS_HEARING_KV.get("htok:" + tok, "json");
      if (!rec) return json({ exists: false });
      const store = await env.HS_HEARING_KV.get("store:" + rec.store_id, "json");
      if (!store) return json({ exists: false });
      const hearing = await env.HS_HEARING_KV.get("hearing:" + store.store_id, "json");
      const ap = store.autopilot || {};
      const refs = await AP.refCount(env, store.member_no);
      return json({
        exists: true,
        member_no: store.member_no || null,
        company: store.company || "",
        area: (store.areas && store.areas[0]) || "",
        areas: store.areas || [],
        works: store.works || [],
        tier: store.tier || "honbu",
        status: store.status || "onboarding",
        already_answered: !!(hearing && hearing.completed),
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
        const store_id = safeStr(b.store_id, 40) || ("hs-partner-" + safeStr(b.member_no, 10).replace(/[^0-9]/g, "").padStart(3, "0"));
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
        const res = await sendHearingEmail(env, { to, token: tok, company: tokRec.company, memberNo: tokRec.member_no, origin: url.origin });
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
        const r = await AP.sendQuestions(env, store, qs.length ? qs : [{ qid: "q_trust", text: AP.QUESTION_BANK.q_trust.text }], "nudge");
        if (!r.ok) return json({ ok: false, reason: r.reason }, 502);
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
        await notify(env, "[Yakumo AUTOPILOT] 日次巡回 完了: " + JSON.stringify({ checked: log.checked, sent: log.sent.length, nudged: log.nudged.length, penalized: log.penalized.length }).slice(0, 400));
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
