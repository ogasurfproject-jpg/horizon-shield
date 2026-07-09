/**
 * hs-hearing : Yakumoモール 加盟店 自動ヒアリング + 生きた加盟店MCPサーバー
 *
 * 設計方針(恒久ルール準拠):
 *  - 新規の独立ワーカー。hs-mcp / hs-estimate には一切触れない(審査キュー保護)。
 *  - fail-closed。検証できないもの・不明なものは出さない・返さない。
 *  - 金額は施主向けに出さない(スコア・ティアのみ)。見積もり例は監査用にKVへ保存するだけ。
 *  - 会社名は The HORIZ音s株式会社(音インタクト)。em/en/bar dash 不使用。
 *  - MCP面は read-only・CORS開放。堀(souba中身/WPC/PTKA実装)は一切露出しない。
 *
 * バインド(wrangler.jsonc):
 *  KV  HS_HEARING_KV
 *  var PUBLIC_DATA_URL        = https://shield.the-horizons-innovation.com/data/yakumo-contractors.json
 *  secret HEARING_ADMIN_SECRET   (管理エンドポイントの X-Admin-Key)
 *  secret GH_DISPATCH_TOKEN      (任意: GitHub repository_dispatch 用 PAT。未設定なら生成は起動しない=fail-closed)
 *  var GH_DISPATCH_REPO       = ogasurfproject-jpg/horizon-shield   (任意)
 */

const SERVER = { name: "HORIZON SHIELD YAKUMO", version: "1.0.0" };
const PUBLIC_DATA_FALLBACK = "https://shield.the-horizons-innovation.com/data/yakumo-contractors.json";
const MALL_URL = "https://shield.the-horizons-innovation.com/yakumo/";

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
function adminOk(request, env) {
  const key = request.headers.get("X-Admin-Key") || "";
  return env.HEARING_ADMIN_SECRET && key && key === env.HEARING_ADMIN_SECRET;
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
'<p class="note">送信内容は The HORIZ音s株式会社(HORIZON SHIELD)が加盟店運営のために使用します。金額は施主向けに公開しません。</p>' +
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
async function triggerGeneration(env, profile) {
  if (!env.GH_DISPATCH_TOKEN || !env.GH_DISPATCH_REPO) {
    return { triggered: false, reason: "dispatch-not-configured" };
  }
  // 金額は payload から除外して渡す(生成側は金額を扱わない)
  const clientProfile = { ...profile };
  delete clientProfile.estimates_for_audit;
  try {
    const r = await fetch("https://api.github.com/repos/" + env.GH_DISPATCH_REPO + "/dispatches", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + env.GH_DISPATCH_TOKEN,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "hs-hearing-worker",
      },
      body: JSON.stringify({ event_type: "yakumo-hearing-completed", client_payload: { profile: clientProfile } }),
    });
    return { triggered: r.ok, status: r.status };
  } catch (e) {
    return { triggered: false, reason: String(e).slice(0, 80) };
  }
}

/* ------------------------------ MCP face ------------------------------ */
const MCP_TOOLS = [
  {
    name: "list_verified_stores",
    description: "Yakumo モールで検証を通過した加盟店(工務店・リフォーム店)を一覧する。適正価格の検証と過剰請求チェック(KIRA)を通過した店だけが返る。area(地名)や work(工種)で絞り込める。返り値は member_no / 会社名 / 地域 / 対応工種 / 適正度スコア / 誠実度ティア / プロフィールURL。金額は含まない(スコアとティアのみ)。検証手続き中の店は verification:'pending' として区別される。Japan only.",
    inputSchema: {
      type: "object",
      properties: {
        area: { type: "string", description: "地名で絞り込み(例: 愛知県, 長久手市)。省略で全件。" },
        work: { type: "string", description: "工種で絞り込み(例: 外壁塗装, 屋根, 内装)。省略で全件。" },
      },
    },
  },
  {
    name: "get_contractor_profile",
    description: "Yakumo の加盟店1件の検証済みプロフィールを返す。member_no(例 No.001)で指定。会社名・地域・対応工種・適正度スコア・誠実度ティア・検証状態・プロフィールURLを返す。金額は含まない。検証が済んでいない店は verification:'pending' を返す(スコアは出さない=fail-closed)。",
    inputSchema: {
      type: "object",
      properties: { member_no: { type: "string", description: "加盟店番号(例: No.001)" } },
      required: ["member_no"],
    },
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
    integrity_tier: verified ? (c.integrity_tier || null) : null,
    red_flags_detected: verified ? (c.red_flags_detected != null ? c.red_flags_detected : null) : null,
    profile_url: c.profile_url ? ("https://shield.the-horizons-innovation.com" + c.profile_url) : MALL_URL,
    note: verified ? "検証済み(KIRA適正診断 通過)" : "検証手続き中。通過するまでスコアは出しません(fail-closed)。",
  };
}

async function handleMcp(request, env, id, method, params) {
  if (method === "initialize") {
    const pv = (params && params.protocolVersion) || "2025-06-18";
    return rpc(id, { protocolVersion: pv, capabilities: { tools: {} }, serverInfo: SERVER });
  }
  if (method === "notifications/initialized") return new Response(null, { status: 202, headers: cors });
  if (method === "tools/list") return rpc(id, { tools: MCP_TOOLS });
  if (method === "tools/call") {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    const { contractors } = await fetchPublished(env);
    if (name === "list_verified_stores") {
      const area = safeStr(args.area, 40);
      const work = safeStr(args.work, 40);
      let list = contractors.map(publicView);
      if (area) list = list.filter((c) => (c.area || "").includes(area) || (c.areas_served || []).some((a) => a.includes(area)));
      if (work) list = list.filter((c) => (c.works || []).some((w) => w.includes(work)));
      const verified = list.filter((c) => c.verification === "verified");
      const pending = list.filter((c) => c.verification !== "verified");
      const payload = {
        mall: MALL_URL,
        operator: "The HORIZ音s株式会社 / HORIZON SHIELD",
        verified_count: verified.length,
        pending_count: pending.length,
        stores: verified,
        pending_stores: pending,
        disclaimer: "Yakumoは紹介料を受け取らない中立モール。掲載は適正診断の通過だけで決まる。金額は返さない(スコア・ティアのみ)。",
      };
      return rpc(id, { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] });
    }
    if (name === "get_contractor_profile") {
      const mn = safeStr(args.member_no, 20);
      if (!mn) return rpc(id, { content: [{ type: "text", text: JSON.stringify({ error: "member_no is required" }) }], isError: true });
      const c = contractors.find((x) => x.member_no === mn || x.store_id === mn);
      if (!c) return rpc(id, { content: [{ type: "text", text: JSON.stringify({ error: "not_found", member_no: mn }) }], isError: true });
      return rpc(id, { content: [{ type: "text", text: JSON.stringify(publicView(c), null, 2) }] });
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
    provider: { organization: "The HORIZ音s株式会社", url: "https://shield.the-horizons-innovation.com/yakumo/" },
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
async function sendHearingEmail(env, { to, token, company, origin }) {
  if (!env.RESEND_API_KEY) return { ok: false, reason: "RESEND_API_KEY 未設定" };
  const from = env.HEARING_FROM || "Yakumo <hearing@the-horizons-innovation.com>";
  const link = (origin || "https://hs-hearing.oga-surf-project.workers.dev") + "/h/" + token;
  const subject = "【Yakumo 加盟店ヒアリングのお願い / ref:" + token + "】" + (company || "");
  const htmlBody =
    '<div style="font-family:sans-serif;line-height:1.8;color:#222;">' +
    '<p>' + (company || "") + ' ご担当者さま</p>' +
    '<p>Yakumo(HORIZON SHIELD)加盟の手続きとして、簡単なヒアリングにご協力ください。下記フォームから約5分で完了します。</p>' +
    '<p><a href="' + link + '" style="display:inline-block;background:#15847a;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700;">ヒアリングフォームを開く</a></p>' +
    '<p style="color:#666;font-size:13px;">フォームが開けない場合は、このメールにそのままご返信いただいても構いません。内容を確認して手続きします（件名はそのままにしてください）。</p>' +
    '<p style="color:#888;font-size:12px;">The HORIZ音s株式会社 / HORIZON SHIELD / Yakumo ・ TEL 0463-74-5917</p></div>';
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ from, to, subject, html: htmlBody }) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, id: j.id, hearing_url: link };
  } catch (e) { return { ok: false, reason: String(e).slice(0, 80) }; }
}

// 初回あいさつメール(TOshi方針: 初回はあいさつ、本格ヒアリングは翌週)。フォームリンクは載せない。
async function sendGreetingEmail(env, { to, company }) {
  if (!env.RESEND_API_KEY) return { ok: false, reason: "RESEND_API_KEY 未設定" };
  const from = env.HEARING_FROM || "Yakumo <hearing@the-horizons-innovation.com>";
  const subject = "Yakumo 加盟 御礼のごあいさつ" + (company ? " / " + company : "");
  const html =
    '<div style="font-family:sans-serif;line-height:1.9;color:#222;">' +
    '<p>' + (company || "") + ' ご担当者さま</p>' +
    '<p>このたびは Yakumo(HORIZON SHIELD)へのご加盟、誠にありがとうございます。加盟No.001 として、心より歓迎いたします。</p>' +
    '<p>Yakumo は紹介料を受け取らない中立の加盟店モールです。適正価格の検証を通った店だけを、施主とAIの前にお並べします。貴社の強みを、施主・AI・検索の三方から見つけてもらえるよう、運営を代行してまいります。</p>' +
    '<p>来週より、簡単なヒアリング(工種・エリア・強みなど)を順にお願いしてまいります。まずは御礼のごあいさつまで。どうぞよろしくお願いいたします。</p>' +
    '<p style="color:#888;font-size:12px;">The HORIZ音s株式会社 / HORIZON SHIELD / Yakumo ・ TEL 0463-74-5917</p></div>';
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ from, to, subject, html }) });
    return { ok: r.ok, status: r.status };
  } catch (e) { return { ok: false, reason: String(e).slice(0, 80) }; }
}

/* ------------------------------ LINE intake (加盟店ヒアリングのLINE版) ------------------------------ */
// メールと同じ設計。加盟店がLINEで登録->回答->自動構造化->同じfail-closed関所->生成トリガー。
async function verifyLineSignature(secret, bodyText, signature) {
  if (!secret) return true; // 未設定時は検証スキップ(初期設定用)。本番は LINE_CHANNEL_SECRET を必ず設定すること。
  if (!signature) return false;
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(bodyText));
    const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return b64 === signature;
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
// メール/LINE共通: 回答テキストを取り込み、構造化->関所->生成トリガー。source で経路を区別。
async function ingestHearingAnswer(env, store_id, store, text, source) {
  await env.HS_HEARING_KV.put(source + "reply:" + store_id + ":" + Date.now(),
    JSON.stringify({ text: String(text).slice(0, 6000), at: new Date().toISOString(), source }));
  const structured = await llmStructure(env, text, store);
  if (!structured.ok) return { ok: false, reason: structured.reason };
  const profile = normalizeProfile(store || { store_id }, structured.raw);
  if (!profile.company || !profile.area || !(profile.works && profile.works.length)) {
    return { ok: false, reason: "missing-required" };
  }
  const now = new Date().toISOString();
  await env.HS_HEARING_KV.put("hearing:" + store_id, JSON.stringify({ store_id, profile, answered_at: now, completed: true, source }));
  if (store) { store.status = "hearing_done"; store.hearing_done_at = now; await env.HS_HEARING_KV.put("store:" + store_id, JSON.stringify(store)); }
  const gen = await triggerGeneration(env, profile);
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
            (tokRec.company || "加盟店") + " さま、登録が完了しました。\nこの LINE に、対応できる工種・エリア・強み(使う塗料や工法、保証など)を、そのまま送ってください。まとめて1通でもOKです。折り返しページ作成に入ります。");
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
  return {
    member_no: s.member_no || null,
    store_id: s.store_id,
    name: s.company || "",
    area: s.area || areas[0] || "",
    areas_served: areas,
    works: Array.isArray(s.works) ? s.works : [],
    verification: verified ? "verified" : "pending",
    fairness_score: verified ? s.fairness_score : null,
    integrity_tier: verified ? (s.integrity_tier || null) : null,
    red_flags_detected: verified ? (s.red_flags_detected != null ? s.red_flags_detected : null) : null,
    claim_sha256: verified ? (s.claim_sha256 || null) : null,
    profile_url: s.profile_url || (s.store_id === "hs-partner-001" ? "/yakumo/no001/" : "/yakumo/"),
    mcp_url: "https://hs-hearing.oga-surf-project.workers.dev/mcp",
    status: s.status || "onboarding",
  };
}

/* ------------------------------ router ------------------------------ */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (path === "/health") return json({ ok: true, server: SERVER.name });

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
        stats: { usage_total: 414, verify_total: 11, source_count: 8, jccdb_items: 65729, as_of: "2026-06-30" },
      }, 200, { "Cache-Control": "public, max-age=60" });
    }

    // MCP: JSON-RPC over HTTP(POST)
    if (path === "/mcp") {
      if (request.method === "GET") return json({ server: SERVER, transport: "jsonrpc", tools: MCP_TOOLS.map((t) => t.name), mall: MALL_URL });
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      let body;
      try { body = await request.json(); } catch (_e) { return rpcErr(null, -32700, "parse error"); }
      const msgs = Array.isArray(body) ? body : [body];
      // 単発想定(バッチは先頭のみ)。
      const m = msgs[0] || {};
      return handleMcp(request, env, m.id != null ? m.id : null, m.method, m.params);
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
        const profile = normalizeProfile(store || tokRec, raw);
        const now = new Date().toISOString();
        const record = { token, store_id: tokRec.store_id, profile, answered_at: now, completed: true };
        await env.HS_HEARING_KV.put("hearing:" + tokRec.store_id, JSON.stringify(record));
        if (store) { store.status = "hearing_done"; store.hearing_done_at = now; await env.HS_HEARING_KV.put("store:" + tokRec.store_id, JSON.stringify(store)); }
        const gen = await triggerGeneration(env, profile);  // 検証通過なら公開まで全自動(GitHub Action側でfail-closed検証)
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
        const res = await sendHearingEmail(env, { to, token: tok, company: tokRec.company, origin: url.origin });
        return json(res, res.ok ? 200 : 502);
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
          rows.push({
            ...storeToContractor(s),
            tier: s.tier || null,
            plan: s.plan || null,
            email: s.email || "",
            token: s.token || null,
            hearing_url: s.token ? (url.origin + "/h/" + s.token) : null,
            created_at: s.created_at || null,
            hearing_completed: !!(h && h.completed),
            hearing_source: (h && h.source) || null,
            answered_at: (h && h.answered_at) || null,
            line_linked: !!line,
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

      return json({ error: "unknown_admin_route" }, 404);
    }

    // ルート案内
    if (path === "/") return json({ server: SERVER.name, mall: MALL_URL, mcp: url.origin + "/mcp", agent_card: url.origin + "/.well-known/agent-card.json" });

    return json({ error: "not_found" }, 404);
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

      const structured = await llmStructure(env, text, store);
      if (!structured.ok) {
        await notify(env, "[Yakumo] メール返信を受信(自動構造化できず: " + structured.reason + ")。手動確認を。store=" + resolved.store_id + " from=" + message.from);
        return;
      }
      const profile = normalizeProfile(store || { store_id: resolved.store_id }, structured.raw);
      // 入口の関所: 必須項目(社名・所在地・工種)が無ければ自動公開しない(fail-closed)。
      if (!profile.company || !profile.area || !(profile.works && profile.works.length)) {
        await notify(env, "[Yakumo] メール返信を構造化したが必須項目が不足。自動公開せず通知。store=" + resolved.store_id + " from=" + message.from);
        return;
      }
      const now = new Date().toISOString();
      await env.HS_HEARING_KV.put("hearing:" + resolved.store_id, JSON.stringify({ store_id: resolved.store_id, profile, answered_at: now, completed: true, source: "email" }));
      if (store) { store.status = "hearing_done"; store.hearing_done_at = now; await env.HS_HEARING_KV.put("store:" + resolved.store_id, JSON.stringify(store)); }
      // 生成トリガー。下流の GitHub Action で validate.py(関所A) を通過した分だけ公開される。
      const gen = await triggerGeneration(env, profile);
      await notify(env, "[Yakumo] メール返信を自動構造化→生成トリガー: " + ((store && store.company) || resolved.store_id) + " via " + resolved.via + " / dispatch=" + JSON.stringify(gen));
    } catch (e) {
      await notify(env, "[Yakumo] email handler error: " + String(e).slice(0, 120));
    }
  },
};
