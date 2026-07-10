/**
 * Yakumo AUTOPILOT : 加盟店 自動運用エージェント
 *
 * 役割(設計書 tools/yakumo/AUTOPILOT_DESIGN.md):
 *  - 厳格・満遍ないヒアリング: 完成度を計算し、足りない所だけを自動で追撃質問(同じ質問は二度としない)
 *  - フォーカス判定: 各店が求めるもの(人材確保/案件獲得/施主集客/加盟店募集/認知)を見極め生成に渡す
 *  - 注意喚起とペナルティ: 放置には質問で喚起→改善なければ表示ランクを一時降下(KIRAスコア自体は不改変)
 *  - 重複ゼロ: 公開コンテンツの指紋台帳(simhash)で近似重複も拒否
 *  - 認知ループ: 活動フィード / 紹介カウント / SNS下書き
 *  - ニュース: KV設定のRSSのみ取得(捏造ゼロ・未設定なら黙ってスキップ)
 *
 * 恒久ルール: fail-closed。金額は施主向けに出さない。KIRAスコアは改変しない(rank_scoreを別に持つ)。
 */

/* ------------------------------ 小道具 ------------------------------ */
const S = (v, max = 400) => (v == null ? "" : String(v)).slice(0, max);
const now = () => new Date().toISOString();
const days = (ms) => ms / 86400000;

/* ------------------------------ 質問バンク ------------------------------ */
// qid は恒久固定。同じ qid は二度と送らない(asked台帳)。
export const QUESTION_BANK = {
  // 基本(全店)
  q_focus:      { w: 5,  text: "Yakumoの運用で、いちばん叶えたいことはどれですか？(複数可)\n1 人材確保(職人・スタッフ採用)\n2 案件・元請けの獲得\n3 施主からの直接相談を増やす\n4 協力店・パートナー店の募集\n5 会社の認知度アップ\n番号か言葉でそのままご返信ください。" },
  q_areas:      { w: 10, text: "対応エリアを市区町村名で、思いつく限り挙げてください(例: 長久手市, 名古屋市名東区, 日進市 ...)。施主はこの地名で探します。" },
  q_strengths:  { w: 15, text: "工種ごとの強み・こだわりを具体的に教えてください。使う塗料や工法、標準の保証年数、施工の手順で必ず守っていることなど(例: 外壁は無機塗料が標準。3回塗り徹底、10年保証)。" },
  q_faqs:       { w: 15, text: "施主さんからよく聞かれる質問と、その答えを3つほど教えてください(例: Q 外壁塗装に適した季節は？ A ...)。そのままFAQページの素材になります。" },
  q_estimates:  { w: 10, text: "実際の見積もり例をあと1〜2件お願いします(工種・概算金額・内訳の要点)。適正診断(KIRA)にだけ使い、金額は一切公開しません。" },
  q_trust:      { w: 10, text: "信頼の裏づけになる実績を教えてください。施工実績数、資格(技能士など)、受賞歴、加盟団体、創業年数、アフター点検の体制など。" },
  q_contact:    { w: 5,  text: "施主対応の連絡先(電話かメール)と、対応時間・定休日を教えてください。" },
  q_license:    { w: 5,  text: "建設業許可番号(お持ちであれば)を教えてください。掲載すると信頼度が上がります。" },
  q_story:      { w: 5,  text: "創業の経緯や、地域への想いをひとことお聞かせください。AIがあなたの会社を語るときの芯になります。" },
  q_cases:      { w: 5,  text: "代表的な施工事例を2〜3件、題名だけでも教えてください(例: 長久手市 築20年戸建て 外壁+屋根塗装)。金額は不要です。" },
  // フォーカス別(判明後に出す)
  recruit: {
    q_recruit_roles:   { w: 4, text: "採用で募集したい職種と人数を教えてください(例: 塗装職人2名、現場管理1名)。経験年数の目安もあれば。" },
    q_recruit_terms:   { w: 3, text: "待遇や働き方の特徴を教えてください(社会保険、資格取得支援、週休、直行直帰の可否など)。求職者が一番見る所です。" },
    q_recruit_culture: { w: 3, text: "現場の雰囲気や教育方針をひとことで(例: 未経験は先輩と2人1組で1年)。" },
  },
  leads: {
    q_leads_types:     { w: 4, text: "受けたい案件の種類と規模を教えてください(例: 外壁塗装 30〜60坪、公共は不可、など)。" },
    q_leads_capacity:  { w: 3, text: "月に受け入れ可能な件数と、対応できる距離(車で何分圏など)を教えてください。" },
    q_leads_partners:  { w: 3, text: "元請け・協力業者としての経験があれば教えてください(取引年数、対応した工事の種類など)。" },
  },
  homeowners: {
    q_home_cases:      { w: 4, text: "施主向けに見せたい施工事例を2〜3件(before/afterの様子を言葉で)。" },
    q_home_warranty:   { w: 3, text: "保証とアフターの内容を教えてください(年数、点検頻度、対象)。" },
    q_home_policy:     { w: 3, text: "見積もりの出し方で心がけていることを教えてください(内訳の見せ方、追加費用の扱いなど)。金額そのものは公開しません。" },
  },
  franchise: {
    q_fr_target:       { w: 4, text: "どんな協力店・パートナー店と組みたいですか(地域、工種、規模感)。" },
    q_fr_terms:        { w: 3, text: "パートナー募集の条件があれば教えてください(対応エリア分担、紹介の流れなど)。" },
    q_fr_support:      { w: 3, text: "組んだ相手に提供できるサポートは何ですか(資材調達、教育、営業支援など)。" },
  },
  brand: {
    q_brand_media:     { w: 4, text: "メディア掲載・受賞・表彰があれば教えてください(媒体名と年)。" },
    q_brand_community: { w: 3, text: "地域活動や社会貢献があれば教えてください(祭りの協賛、学校の修繕ボランティアなど)。" },
    q_brand_message:   { w: 3, text: "会社として一番伝えたいメッセージをひとことで。" },
  },
};
export const FOCUS_KEYS = ["recruit", "leads", "homeowners", "franchise", "brand"];
const FOCUS_LABEL = { recruit: "人材確保", leads: "案件・元請け獲得", homeowners: "施主集客", franchise: "協力店・加盟店募集", brand: "認知度アップ" };
const FOCUS_KEYWORDS = {
  recruit:    ["求人", "採用", "職人募集", "人手", "人材", "スタッフ募集"],
  leads:      ["元請", "案件", "下請", "協力業者", "仕事が欲しい", "受注"],
  homeowners: ["施主", "お客様", "集客", "直接依頼", "問い合わせを増や"],
  franchise:  ["加盟", "パートナー", "協力店", "フランチャイズ", "ネットワーク"],
  brand:      ["認知", "知名度", "ブランド", "有名", "広く知って"],
};

/* ------------------------------ 完成度(計算しながら聞く) ------------------------------ */
export function computeCompleteness(profile, autopilot) {
  const p = profile || {};
  const extra = p.extra || {};
  const focus = autopilot && autopilot.focus_primary;
  const missing = [];
  let score = 0;
  const add = (ok, w, qid) => { if (ok) score += w; else missing.push({ qid, w }); };

  add((p.areas_served || []).length >= 3, 10, "q_areas");
  add(S(p.strengths, 2000).length >= 120, 15, "q_strengths");
  add((p.faqs || []).length >= 3, 15, "q_faqs");
  add((p.estimates_for_audit || []).length >= 2, 10, "q_estimates");
  add(S(p.trust, 2000).length >= 30, 10, "q_trust");
  add(!!S(p.contact), 5, "q_contact");
  add(!!S(p.license), 5, "q_license");
  add(!!S(p.story) || !!extra.q_story, 5, "q_story");
  add((p.cases || []).length > 0 || !!extra.q_cases, 5, "q_cases");
  add(!!focus, 5, "q_focus");
  // フォーカス個別(3問で10点)
  if (focus && QUESTION_BANK[focus]) {
    const qids = Object.keys(QUESTION_BANK[focus]);
    const answered = qids.filter((q) => !!extra[q]).length;
    score += Math.round((answered / qids.length) * 10);
    for (const q of qids) if (!extra[q]) missing.push({ qid: q, w: QUESTION_BANK[focus][q].w });
  } else {
    // フォーカス不明のうちは配点保留(q_focusが最優先で立つ)
  }
  // 契約時点で埋まる基本項目ぶんの底上げ(社名/所在地/工種は必須通過済み)
  score += 5;
  return { score: Math.min(100, score), missing };
}

/* ------------------------------ 次の質問を選ぶ(重複ゼロ) ------------------------------ */
export function nextQuestions(profile, autopilot, maxN = 2) {
  const asked = new Set(((autopilot && autopilot.asked) || []).map((a) => a.qid));
  const { missing } = computeCompleteness(profile, autopilot);
  const flat = [];
  for (const m of missing) {
    if (asked.has(m.qid)) continue; // 同じ質問は二度としない
    const q = QUESTION_BANK[m.qid] || (autopilot && autopilot.focus_primary && QUESTION_BANK[autopilot.focus_primary] && QUESTION_BANK[autopilot.focus_primary][m.qid]);
    if (!q) continue;
    flat.push({ qid: m.qid, w: m.w, text: q.text });
  }
  // フォーカス未判明なら q_focus を最優先に押し上げ
  flat.sort((a, b) => (a.qid === "q_focus" ? -1 : b.qid === "q_focus" ? 1 : b.w - a.w));
  return flat.slice(0, maxN);
}

/* ------------------------------ フォーカス判定 ------------------------------ */
export function classifyFocusFromText(text) {
  const t = S(text, 4000);
  const hits = [];
  // 明示の番号回答(1-5)
  const numMap = { "1": "recruit", "2": "leads", "3": "homeowners", "4": "franchise", "5": "brand" };
  for (const n of Object.keys(numMap)) {
    if (new RegExp("(^|[^0-9])" + n + "([^0-9]|$)").test(t.slice(0, 80))) hits.push(numMap[n]);
  }
  for (const k of FOCUS_KEYS) {
    if (FOCUS_KEYWORDS[k].some((w) => t.includes(w))) if (!hits.includes(k)) hits.push(k);
  }
  return hits;
}
export async function classifyFocus(env, store, profile) {
  const ap = store.autopilot || {};
  // 1) 明示回答(extra.q_focus)
  const extra = (profile && profile.extra) || {};
  if (extra.q_focus && extra.q_focus.text) {
    const hits = classifyFocusFromText(extra.q_focus.text);
    if (hits.length) return { primary: hits[0], all: hits, via: "explicit" };
  }
  // 2) 本文キーワード
  const corpus = [profile && profile.strengths, profile && profile.trust, profile && profile.ng].filter(Boolean).join("\n");
  const kw = classifyFocusFromText(corpus);
  if (kw.length) return { primary: kw[0], all: kw, via: "keywords" };
  // 3) Workers AI 補助(任意)
  try {
    if (env.AI && typeof env.AI.run === "function" && corpus.length > 40) {
      const r = await env.AI.run(env.LLM_MODEL || "@cf/meta/llama-3.1-8b-instruct", {
        messages: [
          { role: "system", content: "Classify a Japanese contractor's primary goal. Reply with EXACTLY one word from: recruit, leads, homeowners, franchise, brand, unknown." },
          { role: "user", content: corpus.slice(0, 1500) },
        ], max_tokens: 8,
      });
      const out = S((r && (r.response || r.result)) || "", 40).toLowerCase();
      const k = FOCUS_KEYS.find((x) => out.includes(x));
      if (k) return { primary: k, all: [k], via: "llm" };
    }
  } catch (_e) {}
  return { primary: ap.focus_primary || null, all: ap.focus_all || [], via: "unknown" };
}

/* ------------------------------ プロフィールのマージ(上書きしない) ------------------------------ */
export function mergeProfiles(base, incoming) {
  const a = base || {}, b = incoming || {};
  const out = { ...a };
  for (const k of ["company", "rep", "license", "area", "strengths", "trust", "contact", "hours", "ng", "story"]) {
    const av = S(a[k], 4000), bv = S(b[k], 4000);
    out[k] = bv.length > av.length ? bv : av; // 情報量の多い方を残す
  }
  const uniq = (arr) => [...new Set((arr || []).filter(Boolean))];
  out.areas_served = uniq([...(a.areas_served || []), ...(b.areas_served || [])]).slice(0, 30);
  out.works = uniq([...(a.works || []), ...(b.works || [])]).slice(0, 25);
  // FAQは質問文で重複排除して追加
  const faqKey = (f) => S(f.q, 120);
  const faqs = [...(a.faqs || [])];
  for (const f of (b.faqs || [])) if (f && f.q && f.a && !faqs.some((x) => faqKey(x) === faqKey(f))) faqs.push(f);
  out.faqs = faqs.slice(0, 12);
  // 見積もり例(監査用)は work+amount で重複排除して追加
  const eKey = (e) => S(e.work, 80) + "|" + S(e.amount, 20);
  const ests = [...(a.estimates_for_audit || [])];
  for (const e of (b.estimates_for_audit || [])) if (e && (e.work || e.amount) && !ests.some((x) => eKey(x) === eKey(e))) ests.push(e);
  out.estimates_for_audit = ests.slice(0, 8);
  out.cases = uniq([...(a.cases || []), ...(b.cases || [])]).slice(0, 10);
  out.extra = { ...(a.extra || {}), ...(b.extra || {}) };
  for (const k of ["member_no", "store_id"]) out[k] = a[k] || b[k] || null;
  return out;
}

/* ------------------------------ 送信(メール/LINE) ------------------------------ */
async function sendEmailRaw(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) return { ok: false, reason: "RESEND_API_KEY 未設定" };
  const from = env.HEARING_FROM || "Yakumo <hearing@the-horizons-innovation.com>";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html }),
    });
    return { ok: r.ok, status: r.status };
  } catch (e) { return { ok: false, reason: String(e).slice(0, 80) }; }
}
async function sendLinePush(env, userId, text) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN || !userId) return { ok: false, reason: "line-not-configured" };
  try {
    const r = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Authorization": "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ to: userId, messages: [{ type: "text", text: S(text, 1900) }] }),
    });
    return { ok: r.ok, status: r.status };
  } catch (e) { return { ok: false, reason: String(e).slice(0, 80) }; }
}
export async function sendQuestions(env, store, questions, kind) {
  // kind: "followup" | "nudge"
  const qText = questions.map((q, i) => (questions.length > 1 ? (i + 1) + ") " : "") + q.text).join("\n\n");
  const company = S(store.company, 120) || "加盟店";
  const lineUid = await env.HS_HEARING_KV.get("store2line:" + store.store_id, "text");
  const intro = kind === "nudge"
    ? company + " さま、Yakumo運営です。その後いかがでしょうか。掲載の質を上げるため、下記だけ教えていただけると助かります。\n\n"
    : company + " さま、Yakumo運営です。掲載ページをさらに強くするため、下記を教えてください。このまま返信いただければ自動で反映されます。\n\n";
  if (lineUid) {
    const r = await sendLinePush(env, lineUid, intro + qText);
    if (r.ok) return { ok: true, via: "line" };
  }
  if (store.email) {
    const refTag = store.token ? " / ref:" + store.token : "";
    const subject = (kind === "nudge" ? "【Yakumo ご様子うかがい" : "【Yakumo 追加ヒアリング") + refTag + "】" + company;
    const html = '<div style="font-family:sans-serif;line-height:1.9;color:#222;"><p>' +
      intro.replace(/\n/g, "<br>") + "</p><p>" + qText.replace(/\n/g, "<br>") + "</p>" +
      '<p style="color:#888;font-size:12px;">このメールにそのまま返信してください。The HORIZ音s株式会社 / HORIZON SHIELD / Yakumo</p></div>';
    const r = await sendEmailRaw(env, { to: store.email, subject, html });
    if (r.ok) return { ok: true, via: "email" };
    return { ok: false, reason: r.reason || ("email-status-" + r.status) };
  }
  return { ok: false, reason: "no-channel(email/LINE未登録)" };
}

/* ------------------------------ 活動フィード(認知ループ) ------------------------------ */
export async function activityAdd(env, ev) {
  // ev: {type, member_no?, text} 公開安全な文言のみ(金額・連絡先・個人名なし)
  try {
    const idx = (await env.HS_HEARING_KV.get("activity:index", "json")) || [];
    idx.unshift({ type: S(ev.type, 30), member_no: S(ev.member_no, 20) || null, text: S(ev.text, 200), at: now() });
    await env.HS_HEARING_KV.put("activity:index", JSON.stringify(idx.slice(0, 100)));
  } catch (_e) {}
}
export async function activityList(env, n = 30) {
  const idx = (await env.HS_HEARING_KV.get("activity:index", "json")) || [];
  return idx.slice(0, n);
}

/* ------------------------------ 紹介プログラム ------------------------------ */
export async function refHit(env, memberNo) {
  const key = "ref:" + S(memberNo, 20).replace(/[^A-Za-z0-9.]/g, "");
  const cur = parseInt((await env.HS_HEARING_KV.get(key, "text")) || "0", 10) || 0;
  await env.HS_HEARING_KV.put(key, String(cur + 1));
  return cur + 1;
}
export async function refCount(env, memberNo) {
  return parseInt((await env.HS_HEARING_KV.get("ref:" + S(memberNo, 20), "text")) || "0", 10) || 0;
}

/* ------------------------------ 重複ゼロ台帳(simhash) ------------------------------ */
function normText(s) {
  return S(s, 20000).toLowerCase().replace(/<[^>]+>/g, " ").replace(/[\s　]+/g, "").replace(/[、。・,.:;!?'"()\[\]{}<>|\/\\-]/g, "");
}
function fnv1a64(str) {
  let h = 0xcbf29ce484222325n;
  const PRIME = 0x100000001b3n, MASK = 0xffffffffffffffffn;
  for (let i = 0; i < str.length; i++) {
    h ^= BigInt(str.charCodeAt(i));
    h = (h * PRIME) & MASK;
  }
  return h;
}
export function simhash64(text) {
  const t = normText(text);
  if (t.length < 3) return "0";
  const acc = new Array(64).fill(0);
  for (let i = 0; i <= t.length - 3; i++) {
    const h = fnv1a64(t.slice(i, i + 3));
    for (let b = 0; b < 64; b++) acc[b] += (h >> BigInt(b)) & 1n ? 1 : -1;
  }
  let out = 0n;
  for (let b = 0; b < 64; b++) if (acc[b] > 0) out |= 1n << BigInt(b);
  return out.toString(16);
}
export function hamming64(hexA, hexB) {
  let x = BigInt("0x" + (hexA || "0")) ^ BigInt("0x" + (hexB || "0"));
  let c = 0;
  while (x) { c += Number(x & 1n); x >>= 1n; }
  return c;
}
async function sha256hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function dedupCheck(env, { slug, title, body }) {
  const idx = (await env.HS_HEARING_KV.get("dedupe:index", "json")) || [];
  const tsha = (await sha256hex(normText(title || ""))).slice(0, 8);
  const sim = simhash64(body || "");
  const matches = [];
  for (const e of idx) {
    if (slug && e.slug === slug) matches.push({ ...e, why: "slug" });
    else if (tsha && e.tsha === tsha) matches.push({ ...e, why: "title" });
    else if (sim !== "0" && e.simhash && hamming64(sim, e.simhash) <= 6) matches.push({ ...e, why: "near-dup" });
    if (matches.length >= 5) break;
  }
  return { duplicate: matches.length > 0, matches, fingerprint: { slug, tsha, simhash: sim } };
}
export async function dedupRegister(env, items) {
  const idx = (await env.HS_HEARING_KV.get("dedupe:index", "json")) || [];
  let added = 0;
  for (const it of (items || []).slice(0, 50)) {
    const slug = S(it.slug, 160), tsha = S(it.tsha, 16), simhash = S(it.simhash, 20);
    if (!slug) continue;
    if (idx.some((e) => e.slug === slug)) continue;
    idx.unshift({ slug, tsha, simhash, at: now() });
    added++;
  }
  await env.HS_HEARING_KV.put("dedupe:index", JSON.stringify(idx.slice(0, 5000)));
  return { added, total: Math.min(idx.length, 5000) };
}

/* ------------------------------ ニュース(捏造ゼロ・設定制) ------------------------------ */
export async function newsRefresh(env) {
  const sources = (await env.HS_HEARING_KV.get("news:sources", "json")) || [];
  const items = [];
  for (const url of sources.slice(0, 5)) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "yakumo-autopilot" } });
      if (!r.ok) continue;
      const xml = (await r.text()).slice(0, 200000);
      const rex = /<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>[\s\S]*?<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>[\s\S]*?<\/item>/g;
      let m, n = 0;
      while ((m = rex.exec(xml)) && n < 5) {
        items.push({ title: S(m[1], 140).trim(), url: S(m[2], 300).trim(), source: url });
        n++;
      }
    } catch (_e) {}
  }
  const digest = { items: items.slice(0, 10), updated_at: now() };
  await env.HS_HEARING_KV.put("news:digest", JSON.stringify(digest));
  return digest;
}
export async function newsDigest(env) {
  return (await env.HS_HEARING_KV.get("news:digest", "json")) || { items: [], updated_at: null };
}

/* ------------------------------ SNS下書き(コピペ投稿用) ------------------------------ */
export function snsDrafts(events) {
  const out = [];
  for (const ev of (events || []).slice(0, 5)) {
    if (ev.type === "verified") out.push("【Yakumo】" + (ev.member_no || "") + " が適正価格の第三者検証(KIRA)を通過しました。検証を通った店だけが並ぶ中立モール。\nhttps://shield.the-horizons-innovation.com/yakumo/ #リフォーム #適正価格");
    else if (ev.type === "joined") out.push("【Yakumo】新しい加盟店を迎えました(" + (ev.member_no || "") + ")。紹介料を取らない中立モールで、検証の手続きが始まります。\nhttps://shield.the-horizons-innovation.com/yakumo/");
    else if (ev.type === "published") out.push("【Yakumo】加盟店の新しい紹介ページを公開しました。施主・AI・検索の三方から見つかる導線を運営代行しています。\nhttps://shield.the-horizons-innovation.com/yakumo/");
  }
  if (!out.length) out.push("【Yakumo】検証を通った加盟店だけが並ぶ中立の建設モール。紹介料は受け取りません。\nhttps://shield.the-horizons-innovation.com/yakumo/");
  return out;
}

/* ------------------------------ ペナルティ(誠実設計) ------------------------------ */
export function applyPenaltyPolicy(ap, nowMs) {
  // 返り値: {action: null|"nudge1"|"nudge2"|"cap", penalty}
  if (!ap.pending || !ap.pending.sent_at) return { action: null, penalty: ap.penalty || 0 };
  const age = days(nowMs - Date.parse(ap.pending.sent_at));
  const nudges = ap.nudges || 0;
  if (age >= 28 && (ap.penalty || 0) < 5) return { action: "cap", penalty: 5 };
  if (age >= 14 && nudges < 2) return { action: "nudge2", penalty: 3 };
  if (age >= 7 && nudges < 1) return { action: "nudge1", penalty: ap.penalty || 0 };
  return { action: null, penalty: ap.penalty || 0 };
}

/* ------------------------------ 日次tick(エージェント本体) ------------------------------ */
export async function runDailyTick(env, deps) {
  // deps: { listAllStores, triggerGeneration }
  const log = { checked: 0, sent: [], nudged: [], penalized: [], skipped: [] };
  await newsRefresh(env).catch(() => {});
  const stores = await deps.listAllStores(env);
  const nowMs = Date.now();
  for (const store of stores) {
    log.checked++;
    const sid = store.store_id;
    const hearing = await env.HS_HEARING_KV.get("hearing:" + sid, "json");
    const profile = (hearing && hearing.profile) || null;
    const ap = store.autopilot || {};

    // フォーカス未判定なら判定を試みる(回答が既にあれば)
    if (!ap.focus_primary && profile) {
      const f = await classifyFocus(env, store, profile);
      if (f.primary) { ap.focus_primary = f.primary; ap.focus_all = f.all; ap.focus_via = f.via; }
    }
    const comp = profile ? computeCompleteness(profile, ap) : { score: 0, missing: [] };
    ap.completeness = comp.score;

    // 1) pending放置 -> 注意喚起 / ペナルティ
    const pol = applyPenaltyPolicy(ap, nowMs);
    if (pol.action === "nudge1" || pol.action === "nudge2") {
      const qs = nextQuestions(profile || {}, ap, 1);
      const nudgeQ = qs.length ? qs : [{ qid: "q_trust", text: QUESTION_BANK.q_trust.text }];
      const r = await sendQuestions(env, store, nudgeQ, "nudge");
      if (r.ok) {
        ap.nudges = (ap.nudges || 0) + 1;
        if (pol.action === "nudge2") ap.penalty = pol.penalty;
        log.nudged.push(sid + ":" + pol.action + ":" + r.via);
        if (pol.action === "nudge2") log.penalized.push(sid + ":penalty3");
      } else log.skipped.push(sid + ":nudge:" + r.reason);
    } else if (pol.action === "cap") {
      ap.penalty = pol.penalty;
      log.penalized.push(sid + ":penalty5");
    }
    // 2) 追撃質問(完成度<85・pendingなし・72h間隔)
    else if (profile && comp.score < 85 && !ap.pending) {
      const since = ap.last_send_at ? (nowMs - Date.parse(ap.last_send_at)) : Infinity;
      if (since >= 72 * 3600 * 1000) {
        const qs = nextQuestions(profile, ap, 2);
        if (qs.length) {
          const r = await sendQuestions(env, store, qs, "followup");
          if (r.ok) {
            ap.pending = { qids: qs.map((q) => q.qid), text: qs.map((q) => q.text).join("\n"), sent_at: now(), via: r.via };
            ap.asked = [...(ap.asked || []), ...qs.map((q) => ({ qid: q.qid, at: now(), answered: false }))].slice(-50);
            ap.last_send_at = now();
            log.sent.push(sid + ":" + qs.map((q) => q.qid).join("+") + ":" + r.via);
          } else log.skipped.push(sid + ":followup:" + r.reason);
        }
      }
    }
    store.autopilot = ap;
    await env.HS_HEARING_KV.put("store:" + sid, JSON.stringify(store));
  }
  // 保全エージェント弐号(ウチ回り): 内臓検診と自己修復。結果は guardian:last に記録され、壱号(Actions)が読む。
  log.guardian = await selfHeal(env, stores);
  await env.HS_HEARING_KV.put("autopilot:last_tick", now());
  await activityAdd(env, { type: "tick", text: "自動運用エージェントが巡回しました(対象 " + log.checked + "店)" });
  return log;
}

/* ------------------------------ 保全エージェント弐号(ウチ回り・自己修復) ------------------------------ */
// KVの内臓検診。軽微な破損は自動修復し、直せないものは issues に列挙(壱号がIssue化して報告)。
export async function selfHeal(env, stores) {
  const repaired = [], issues = [];
  for (const s of stores) {
    try {
      // 1) store.token があるのに htok索引が無い -> 張り直し(登録リンク/メール照合が死ぬ事故の自動修復)
      if (s.token) {
        const tok = await env.HS_HEARING_KV.get("htok:" + s.token, "json");
        if (!tok) {
          await env.HS_HEARING_KV.put("htok:" + s.token, JSON.stringify({ store_id: s.store_id, member_no: s.member_no, company: s.company, created_at: now() }));
          repaired.push("htok再構築:" + s.store_id);
        }
      } else {
        issues.push("token未設定(登録リンク無し): " + s.store_id);
      }
      // 2) email逆引き索引の欠け -> 張り直し
      if (s.email) {
        const rev = await env.HS_HEARING_KV.get("email2store:" + s.email.toLowerCase(), "text");
        if (!rev) {
          await env.HS_HEARING_KV.put("email2store:" + s.email.toLowerCase(), s.store_id);
          repaired.push("email索引再構築:" + s.store_id);
        }
      }
      // 3) 必須フィールド欠損の検知(自動では直さない=報告)
      if (!s.member_no) issues.push("member_no欠損: " + s.store_id);
      if (!s.company) issues.push("company欠損: " + s.store_id);
      // 4) 検証済みなのにスコア欠損(fail-closed違反状態) -> 報告
      if (s.verification === "verified" && (s.fairness_score == null || isNaN(Number(s.fairness_score)))) {
        issues.push("検証済みなのにスコア欠損(fail-closed違反): " + s.store_id);
      }
      // 5) autopilot枠の初期化漏れ -> 自動修復
      if (!s.autopilot) { s.autopilot = {}; await env.HS_HEARING_KV.put("store:" + s.store_id, JSON.stringify(s)); repaired.push("autopilot初期化:" + s.store_id); }
      // 6) hearingレコードの破損検知
      const hRaw = await env.HS_HEARING_KV.get("hearing:" + s.store_id, "text");
      if (hRaw) { try { JSON.parse(hRaw); } catch (_e) { issues.push("hearing破損(JSON不正): " + s.store_id); } }
    } catch (e) { issues.push("検診失敗: " + s.store_id + " " + String(e).slice(0, 60)); }
  }
  // 7) 共有インデックスの破損 -> バックアップして初期化(活動フィード) / 台帳は初期化しない(報告のみ)
  try { const a = await env.HS_HEARING_KV.get("activity:index", "text"); if (a) JSON.parse(a); }
  catch (_e) { await env.HS_HEARING_KV.put("activity:index", "[]"); repaired.push("activity:index初期化"); }
  try { const d = await env.HS_HEARING_KV.get("dedupe:index", "text"); if (d) JSON.parse(d); }
  catch (_e) { issues.push("dedupe:index破損(重複ゼロ台帳)。自動初期化はしない。リポジトリのdata/yakumo-content-manifest.jsonから再同期を"); }
  const report = { checked: stores.length, repaired, issues, at: now() };
  await env.HS_HEARING_KV.put("guardian:last", JSON.stringify(report));
  return report;
}
export async function guardianStatus(env) {
  const g = (await env.HS_HEARING_KV.get("guardian:last", "json")) || null;
  const t = (await env.HS_HEARING_KV.get("autopilot:last_tick", "text")) || null;
  return {
    last_tick: t,
    last_tick_age_hours: t ? Math.round((Date.now() - Date.parse(t)) / 3600000 * 10) / 10 : null,
    guardian: g ? { at: g.at, checked: g.checked, repaired: g.repaired.length, issues: g.issues.length } : null,
  };
}

/* ------------------------------ 回答取り込み時の消込 ------------------------------ */
export function settlePendingOnAnswer(store, rawText) {
  const ap = store.autopilot || {};
  if (ap.pending && ap.pending.qids) {
    const extraPatch = {};
    for (const qid of ap.pending.qids) extraPatch[qid] = { text: S(rawText, 3000), at: now() };
    ap.asked = (ap.asked || []).map((a) => (ap.pending.qids.includes(a.qid) ? { ...a, answered: true } : a));
    ap.pending = null;
    ap.nudges = 0;
    ap.penalty = 0; // 回答が来たら即回復(誠実設計)
    ap.last_answer_at = now();
    store.autopilot = ap;
    return extraPatch;
  }
  ap.last_answer_at = now();
  ap.penalty = 0;
  ap.nudges = 0;
  store.autopilot = ap;
  return {};
}
