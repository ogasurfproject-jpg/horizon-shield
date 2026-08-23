/**
 * Yakumo AUTOPILOT : 加盟店 自動運用エージェント
 *
 * 役割(設計書 tools/yakumo/AUTOPILOT_DESIGN.md):
 *  - 厳格・満遍ないヒアリング: 完成度を計算し、足りない所だけを自動で追撃質問(同じ質問は上限3回・間隔 3日)
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

import * as IND from "./industry.js";

// 2026-08-19 patch51. 「検証済み」と言うために、実際に監査する見積の最低本数。
// 1本は業者を測ったことにならない。1本の書類を測っただけになる。
// 分母の無いスコアは出さない。この本数は公開ページとMCPの応答にも必ず出る。
// 変えるならこの1行。
export const MIN_AUDIT_ESTIMATES = 3;

// 2026-08-20 reply-resets-cooldown. 追撃質問の門は二つある。
// 門B(時間)だけを見ていた頃、答えている相手が三日以上止められていた。実測は下の分岐に書いた。
export const FOLLOWUP_COOLDOWN_H = 72; // 門B: 無反応の相手を急かさないための待ち
export const REPLY_GATE_FLOOR_H = 6;   // 門A: 返事が来ていても、これより短い間隔では送らない

/* ------------------------------ 質問バンク ------------------------------ */
// qid は恒久固定。同じ qid は二度と送らない(asked台帳)。
export const QUESTION_BANK = {
  // 基本(全店)
  q_focus:      { w: 5,  text: "Yakumoの運用で、いちばん叶えたいことはどれですか？(複数可)\n1 人材確保(職人・スタッフ採用)\n2 案件・元請けの獲得\n3 施主からの直接相談を増やす\n4 協力店・パートナー店の募集\n5 会社の認知度アップ\n番号か言葉でそのままご返信ください。" },
  q_areas:      { w: 10, text: "対応エリアを市区町村名で、思いつく限り挙げてください(例: 長久手市, 名古屋市名東区, 日進市 ...)。施主はこの地名で探します。" },
  q_strengths:  { w: 15, text: "工種ごとの強み・こだわりを具体的に教えてください。使う塗料や工法、標準の保証年数、施工の手順で必ず守っていることなど(例: 外壁は無機塗料が標準。3回塗り徹底、10年保証)。" },
  q_faqs:       { w: 15, text: "施主さんからよく聞かれる質問と、その答えを3つほど教えてください(例: Q 外壁塗装に適した季節は？ A ...)。そのままFAQページの素材になります。" },
  q_estimates:  { w: 10, text: "実際の見積もり例をあと3件以上お願いします(工種・概算金額・内訳の要点)。適正診断(KIRA)にだけ使い、金額は一切公開しません。公開するのは『見積を何本見て検証したか』という本数だけです。1本では御社の値付けを測ったことにならないため、本数を確保してから検証に進みます。" },
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
/* ------------------------------ AIモデルの綱 ------------------------------ */
// Workers AI のモデルは予告のうえ提供終了になる。1本に賭けると、その日に顧客対応が止まる。
// 2026-05-30 に llama-3.1/3/2 系が終了し、実際に止まった。二度目は無い形にする。
// 上から順に試し、最初に応答したものを使う。env.LLM_MODEL が設定されていればそれを優先。
export const AI_MODEL_CHAIN = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/zai-org/glm-4.7-flash",
  "@cf/google/gemma-4-26b-a4b-it",
];

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
  const missing = [], askable = [];
  let score = 0;
  // 2026-08-19 patch56: 「点が足りない」と「まだ聞いていない」を分ける。
  //   q_strengths は120字、q_trust は30字という長さの関門で判定していた。
  //   2026-08-19、加盟店(p002)の回答は実測85字と27字。きちんと答えているのに
  //   「未回答」として質問対象に残り続け、同じ質問が何度も出た。3文字足りないという理由で。
  //   点数(score)は今までどおり長さで決める。薄さの指標として要る。
  //   変えるのは質問を選ぶ側だけ。一度でも答えが入っている欄は、自動では二度と聞かない。
  //   件数の関門(FAQ3件・見積3件・エリア3市)は別。足りない分をもう一度お願いするのは
  //   正当な追加依頼なので、そこは触らない。
  const add = (ok, w, qid, answered) => {
    if (ok) { score += w; return; }
    missing.push({ qid, w });
    if (!answered) askable.push({ qid, w });
  };

  add((p.areas_served || []).length >= 3, 10, "q_areas");
  add(S(p.strengths, 2000).length >= 120, 15, "q_strengths", !!S(p.strengths, 2000).trim());
  add((p.faqs || []).length >= 3, 15, "q_faqs");
  // 2026-08-23: 見積もり例は建設の話である。訪問看護に見積書は無い。
  // 業種を見ずにこの10点を課すと、訪問看護は永久に完成度が上がらず、
  // 生成が始まらない。業種ぶんの配点は下の業種バンクで持つ。
  const usesEstimates = !p.industry || p.industry === "construction";
  if (usesEstimates) add((p.estimates_for_audit || []).length >= MIN_AUDIT_ESTIMATES, 10, "q_estimates"); // patch51
  add(S(p.trust, 2000).length >= 30, 10, "q_trust", !!S(p.trust, 2000).trim());
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
    // 2026-08-19 patch56: フォーカス個別は extra[q] の有無で見ているので、
    //   答えがあれば埋まる。missing と askable は同じでよい。
    for (const q of qids) if (!extra[q]) { missing.push({ qid: q, w: QUESTION_BANK[focus][q].w }); askable.push({ qid: q, w: QUESTION_BANK[focus][q].w }); }
  } else {
    // フォーカス不明のうちは配点保留(q_focusが最優先で立つ)
  }
  // 2026-08-23: 業種ぶんの設問。業種ごとに聞くべきことが違う。
  // 訪問看護なら、指示書の期限、加算、減算の要件、返戻、オンコールの実態。
  // 答えは extra[qid] に入る(フォーカス個別と同じ仕組み)。
  const ibank = IND.industryBank(p.industry);
  if (ibank) {
    const iqids = Object.keys(ibank);
    const ianswered = iqids.filter((q) => !!extra[q]).length;
    score += Math.round((ianswered / iqids.length) * 20);
    for (const q of iqids) if (!extra[q]) { missing.push({ qid: q, w: ibank[q].w }); askable.push({ qid: q, w: ibank[q].w }); }
  }
  // 契約時点で埋まる基本項目ぶんの底上げ(社名/所在地/工種は必須通過済み)
  score += 5;
  return { score: Math.min(100, score), missing, askable };
}

/* ------------------------------ 次の質問を選ぶ(重複ゼロ) ------------------------------ */
export function nextQuestions(profile, autopilot, maxN = 2) {
  // 2026-08-19 patch44: 恒久除外をやめる。
  // 無関係な返事1通で、一番重い質問(強み・見積もり例・実績)が永久に失われていた。
  // 代わりに上限3回、間隔3日。3回聞いて埋まらなければ打ち切る。
  const ASK_MAX = 3, ASK_COOL_MS = 3 * 86400000, nowMs = Date.now();
  const askedCount = {}, lastAskAt = {};
  for (const a of ((autopilot && autopilot.asked) || [])) {
    askedCount[a.qid] = (askedCount[a.qid] || 0) + 1;
    if (!lastAskAt[a.qid] || String(a.at) > String(lastAskAt[a.qid])) lastAskAt[a.qid] = a.at;
  }
  // 2026-08-19 patch56: 質問を選ぶのは askable。missing は点数の話で、
  //   「答えてもらったが長さが足りない」欄も入っている。そこを聞き直さない。
  const comp = computeCompleteness(profile, autopilot);
  const missing = comp.askable || comp.missing;
  const flat = [];
  for (const m of missing) {
    const askedN = askedCount[m.qid] || 0;
    if (askedN >= ASK_MAX) continue;
    if (askedN > 0 && lastAskAt[m.qid] && (nowMs - Date.parse(lastAskAt[m.qid])) < ASK_COOL_MS) continue;
    // 2026-08-23: 業種の文面を先に見る。無ければ従来どおり。
    // これが無いと、訪問看護の事業所に「工種ごとの強み(例: 外壁塗装)」
    // 「施主さんからよく聞かれる質問」が、追撃質問として毎週届く。
    const q = IND.questionFor((profile || {}).industry, m.qid)
      || QUESTION_BANK[m.qid]
      || (autopilot && autopilot.focus_primary && QUESTION_BANK[autopilot.focus_primary] && QUESTION_BANK[autopilot.focus_primary][m.qid]);
    if (!q) continue;
    flat.push({ qid: m.qid, w: m.w, text: q.text });
  }
  // フォーカス未判明なら q_focus を最優先に押し上げ
  flat.sort((a, b) => (a.qid === "q_focus" ? -1 : b.qid === "q_focus" ? 1 : b.w - a.w));
  const picked = flat.slice(0, maxN);
  // 2026-08-23: 毎回1枠を、算定要件データベースを厚くする設問に空けておく。
  //   重みだけで並べると、集客の設問(w15)と実績の設問(w10)が前に立ち続け、
  //   実地指導・加算・医療保険・保険者差といった、データベースの穴を埋める設問は
  //   2週間後ろに並んでいた。置いてあることと、届くことは別である。
  //   集客の設問を消すのではなく、2問のうち1問を必ずこちらに回す。
  //   残っていなければ、これまでどおり重みの順のまま。
  if (maxN >= 2 && picked.length >= 2) {
    const dbq = IND.dbBuildingQids((profile || {}).industry) || [];
    if (dbq.length) {
      const set = new Set(dbq);
      if (!picked.some((f) => set.has(f.qid))) {
        const cand = flat.find((f) => set.has(f.qid));
        if (cand) picked[picked.length - 1] = cand;
      }
    }
  }
  return picked;
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
      const msgs = [
        { role: "system", content: "Classify a Japanese contractor's primary goal. Reply with EXACTLY one word from: recruit, leads, homeowners, franchise, brand, unknown." },
        { role: "user", content: corpus.slice(0, 1500) },
      ];
      let raw = "";
      for (const model of (env.LLM_MODEL ? [env.LLM_MODEL] : AI_MODEL_CHAIN)) {
        try {
          const r = await env.AI.run(model, { messages: msgs, max_tokens: 8 });
          // 2026-08-20 patch52: patch43 と同じ鋳型。モデルは文字列を返すとは限らない。
          // ここは落ちない代わりに S() が "[object Object]" に変え、判定が静かに空振りする。
          // 落ちて止まるより悪い。同じ扱いは hs-ehn-verify/src/verify.js に既に正しく書かれていた。
          // 一度直した癖が、他のどこに住んでいるかを探していなかった。
          const rr = r && (r.response !== undefined ? r.response : r.result);
          raw = rr == null ? "" : (typeof rr === "object" ? JSON.stringify(rr) : String(rr));
          if (raw) break;
        } catch (_e) { /* 次のモデルへ。ここは補助判定なので落ちても本流は止めない */ }
      }
      const out = S(raw, 40).toLowerCase();
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
  // 採用(recruit): 任意トラック。集客のみの店には無い。フィールド単位で情報量の多い方を残し、職種は和集合。
  if (a.recruit || b.recruit) {
    const ra = a.recruit || {}, rb = b.recruit || {};
    const rout = { ...ra };
    for (const k of ["employment_type", "salary_min", "salary_max", "salary_unit", "bonus_allowance",
                     "insurance_holidays", "ideal_person", "qualifications", "inexperienced_ok",
                     "training", "workplace", "culture", "apply_method", "apply_contact"]) {
      const av = S(ra[k], 2000), bv = S(rb[k], 2000);
      rout[k] = bv.length > av.length ? bv : av;
    }
    rout.roles = uniq([...(ra.roles || []), ...(rb.roles || [])]).slice(0, 12);
    out.recruit = rout;
  }
  for (const k of ["member_no", "store_id"]) out[k] = a[k] || b[k] || null;
  // 2026-08-23: 業種をここで落としていた。
  // industry が profile から消えると computeCompleteness が建設の規則で走り、
  // 訪問看護の事業所に「見積もり例をあと3件」を求め、訪問看護の設問は一問も出ない。
  // これは「情報量の多い方を残す」種類の項目ではない。決まっているものを落とさないだけ。
  const ind = S(b.industry, 40) || S(a.industry, 40);
  if (ind) out.industry = ind;
  return out;
}

/* ------------------------------ 送信(メール/LINE) ------------------------------ */
async function sendEmailRaw(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) return { ok: false, reason: "RESEND_API_KEY 未設定" };
  const from = env.HEARING_FROM || "Yakumo <hearing@the-horizons-innovation.com>";
  const replyTo = env.HEARING_REPLY_TO || "contact@the-horizons-innovation.com";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, reply_to: replyTo, subject, html }),
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
    const formLink = store.token
      ? '<p style="font-size:13px;"><a href="https://shield.the-horizons-innovation.com/yakumo/register/?code=' + store.token + '">フォームから追記する場合はこちら</a>(前回の続きから入力できます)</p>'
      : "";
    const lineInvite = '<p style="font-size:13px;">やり取りはLINEでも可能です。HORIZON SHIELD公式LINE(ID: @172piime)の友だち追加はこちら: <a href="https://line.me/R/ti/p/@172piime">https://line.me/R/ti/p/@172piime</a></p>';
    const html = '<div style="font-family:sans-serif;line-height:1.9;color:#222;"><p>' +
      intro.replace(/\n/g, "<br>") + "</p><p>" + qText.replace(/\n/g, "<br>") + "</p>" + formLink + lineInvite +
      '<p style="color:#888;font-size:12px;">このメールにそのまま返信してください。The HORIZONs株式会社 / HORIZON SHIELD / Yakumo</p></div>';
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
// L16: refHit/refCount のキー生成を統一(正規化不一致による紹介数の取りこぼしを防ぐ)。
function refKey(memberNo) { return "ref:" + S(memberNo, 20).replace(/[^A-Za-z0-9.]/g, ""); }
export async function refHit(env, memberNo) {
  const key = refKey(memberNo);
  const cur = parseInt((await env.HS_HEARING_KV.get(key, "text")) || "0", 10) || 0;
  await env.HS_HEARING_KV.put(key, String(cur + 1));
  return cur + 1;
}
export async function refCount(env, memberNo) {
  return parseInt((await env.HS_HEARING_KV.get(refKey(memberNo), "text")) || "0", 10) || 0;
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
      // L11: https のみ + 内部ホスト遮断(SSRF多重防御。sourcesは管理者設定だが念のため)。
      if (!/^https:\/\//i.test(String(url))) continue;
      let _h = ""; try { _h = new URL(url).hostname.toLowerCase(); } catch (_e) { continue; }
      if (_h === "localhost" || _h.endsWith(".internal") || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(_h)) continue;
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
  // 2026-08-19 patch63: kira-bridge が返信に添える任意質問は soft pending。
  //   「差し支えなければ」と書いて出したものに、催促もペナルティも付けない。
  //   答えが来たときに紐づけるためだけに置いている。
  if (ap.pending.soft) return { action: null, penalty: ap.penalty || 0 };
  const age = days(nowMs - Date.parse(ap.pending.sent_at));
  const nudges = ap.nudges || 0;
  // 2026-08-19 patch39: 回数の頭打ちをやめ、経過日数の表で駆動する。
  // 商売の速度に合わせて 3 / 7 / 14 / 21 日。28日で打ち切り。
  // 「もう nudges が上限だから何もしない」という沈黙を作らないための形。
  const NUDGE_SCHEDULE_DAYS = [3, 7, 14, 21];
  if (age >= 28 && (ap.penalty || 0) < 5) return { action: "cap", penalty: 5 };
  if (nudges < NUDGE_SCHEDULE_DAYS.length && age >= NUDGE_SCHEDULE_DAYS[nudges]) {
    // 3回目以降は放置が長いのでペナルティを付ける。1,2回目は付けない。
    return { action: nudges >= 2 ? "nudge2" : "nudge1", penalty: nudges >= 2 ? 3 : (ap.penalty || 0) };
  }
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
    // 2026-08-19 patch63: soft pending は7日で失効させる。放置すると pending が立っている
    //   というだけで、追撃質問の経路(comp.score < 85 && !ap.pending)が永久に塞がる。
    if (ap.pending && ap.pending.soft && ap.pending.sent_at &&
        (nowMs - Date.parse(ap.pending.sent_at)) >= 7 * 86400000) ap.pending = null;

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
        ap.last_send_at = now(); // patch39: nudge経路で記録漏れがあった（両店とも None だった）
        // 2026-08-19 patch55: cron の nudge も、送った質問を asked に記録していなかった。
        // 2026-08-19 patch63: ただし q_trust のフォールバックは数えない。フォールバックが出るのは
        //   nextQuestions が空を返したとき、つまりその質問が既に上限か冷却中のとき。
        //   数えると ASK_MAX=3 を食い潰して、その項目を恒久的に聞けなくする。
        if (qs.length) ap.asked = [...(ap.asked || []), ...qs.map((q) => ({ qid: q.qid, at: now(), answered: false, via: "nudge" }))].slice(-50);
        if (pol.action === "nudge2") ap.penalty = pol.penalty;
        log.nudged.push(sid + ":" + pol.action + ":" + r.via);
        if (pol.action === "nudge2") log.penalized.push(sid + ":penalty3");
      } else log.skipped.push(sid + ":nudge:" + r.reason);
    } else if (pol.action === "cap") {
      ap.penalty = pol.penalty;
      log.penalized.push(sid + ":penalty5");
    }
    // 2) 追撃質問。門は二つ。どちらかが開けば送る。
    //    2026-08-20 reply-resets-cooldown:
    //      これまで見ていたのは「最後に送った時刻」からの72時間だけだった。
    //      相手が返事をしたかどうかを、一度も見ていなかった。
    //      実測(2026-08-20 朝): hs-partner-002 は 8/19 19:08 JST に返事をして pending が消え、
    //      完成度は50。85に届いていないのに、次の質問が飛ぶのは 8/23。答えた人が三日放置される。
    //      無反応の相手を急かさないための門が、答えている相手を止めていた。
    //      これも静かに縮む型。落ちない。例外も出ない。ログにも出ない。ただ会話が止まるだけ。
    //    門A 返事: 最後の返事が最後の送信より後なら、待つ理由がない。
    //             ただし直近 REPLY_GATE_FLOOR_H 時間以内は開けない。相手側の自動応答よけ。
    //    門B 時間: 従来どおり FOLLOWUP_COOLDOWN_H 時間。無反応の相手はこちらで拾う。
    //    連投にはならない。送れば ap.pending が立ち、この枝は次の返事が来るまで通らない。
    //    最大でも「返事1通につき送信1回」。門を開けても回数は増えない。
    else if (profile && comp.score < 85 && !ap.pending) {
      const sinceSend = ap.last_send_at ? (nowMs - Date.parse(ap.last_send_at)) : Infinity;
      const sinceAnswer = ap.last_answer_at ? (nowMs - Date.parse(ap.last_answer_at)) : Infinity;
      const answeredAfterSend = !!ap.last_answer_at &&
        (!ap.last_send_at || Date.parse(ap.last_answer_at) > Date.parse(ap.last_send_at));
      const gate = (answeredAfterSend && sinceAnswer >= REPLY_GATE_FLOOR_H * 3600 * 1000) ? "reply"
                 : (sinceSend >= FOLLOWUP_COOLDOWN_H * 3600 * 1000) ? "cooldown" : "";
      if (gate) {
        const qs = nextQuestions(profile, ap, 2);
        if (qs.length) {
          const r = await sendQuestions(env, store, qs, "followup");
          if (r.ok) {
            ap.pending = { qids: qs.map((q) => q.qid), text: qs.map((q) => q.text).join("\n"),
                           // 何を訊いたかを qid ごとに残す。答えだけ残っても、
                           // あとから「何への答えか」が分からなければ使えない。
                           asked_texts: Object.fromEntries(qs.map((q) => [q.qid, q.text])),
                           sent_at: now(), via: r.via };
            ap.asked = [...(ap.asked || []), ...qs.map((q) => ({ qid: q.qid, at: now(), answered: false }))].slice(-50);
            ap.last_send_at = now();
            log.sent.push(sid + ":" + qs.map((q) => q.qid).join("+") + ":" + r.via + ":" + gate);
          } else log.skipped.push(sid + ":followup:" + r.reason);
        }
      }
    }
    store.autopilot = ap;
    await env.HS_HEARING_KV.put("store:" + sid, JSON.stringify(store));
  }
  // 保全エージェント弐号(ウチ回り): 内臓検診と自己修復。結果は guardian:last に記録され、壱号(Actions)が読む。
  log.guardian = await selfHeal(env, stores);
  // 2026-08-19 patch45: last_tick を更新する前に測る。後だと E1 が必ず通ってしまう。
  log.selfcheck = await selfCheck(env, stores);
  await env.HS_HEARING_KV.put("autopilot:last_tick", now());
  await activityAdd(env, { type: "tick", text: "自動運用エージェントが巡回しました(対象 " + log.checked + "店)" });
  return log;
}

/* ------------------------------ 証拠監査(静かな壊れ方の検出) ------------------------------ */
// 2026-08-19 patch45.
// 死活監視は「生きているか」しか見ない。今回の4つの穴は、生きたまま中身だけが止まった。
// だからここでは「動いた証拠が残っているか」を測る。
// 各項目は、何が出れば異常なのかを先に書いてある。落ちた項目だけが通知に載る。
export async function selfCheck(env, stores) {
  const nowMs = Date.now();
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok, detail });

  // 2026-08-20 empty-roster-passes-everything.
  //   一覧を走査して違反を挙げる形の検査は、一覧が空だと必ず「違反なし」で通る。
  //   検査は正しい。渡されるものが間違っているだけ。空の部屋を見て「侵入者なし」と報告していた。
  //   指摘: Federico Blanco Sanchez-Llanos 2026-08-20。
  //   「ガードが在る」は、それに食わせている値が壊れているとき、真であって役に立たない答えになる。
  //   だから「違反なし」と「測れていない」を書き分ける。/recompute で
  //   「再現できなかった」と「無効」を分けたのと同じ規則。
  const roster = Array.isArray(stores) ? stores : [];
  const measured = roster.length;
  const scanned = (id, ok, detail) =>
    add(id, measured > 0 && ok,
        measured > 0
          ? detail + "（走査 " + measured + "店)"
          : "走査対象が0店。違反なしではなく、測れていない。名簿が届いていない。");

  // E0 名簿そのものが届いているか。ここが0なら、以下の一覧走査はすべて意味を失う。
  //    KVの接頭辞違い、全件の読み取り失敗、listAllStores の黙った取りこぼし。どれも例外を出さない。
  add("roster_present", measured > 0,
      measured > 0 ? measured + "店を走査対象にした"
                   : "名簿が空。接頭辞違いか全件読み取り失敗。この状態では他の検査は何も保証しない。");

  // E1 巡回そのものが走っているか。last_tick を更新する前に測る。
  //    後で測ると必ず通ってしまい、検査として成立しない。
  const lastTick = await env.HS_HEARING_KV.get("autopilot:last_tick", "text");
  add("tick_alive", !!lastTick && days(nowMs - Date.parse(lastTick)) < 1.1,
      "last_tick=" + (lastTick || "記録なし"));

  // E2 取り込みが起きているか。どこか1店でも14日以内に回答が settle されていること。
  //    橋が落ちていた期間は、ここが必ず落ちる。
  // 2026-08-19 patch46: 全体の最大で判定していたため、動いている1店が
  // 止まっている店を隠していた。実測で、当日取り込めた店が28日沈黙している店を覆った。
  // 店ごとに測る。待ちを抱えたまま14日以上なにも取り込めていない店を名指しする。
  const silent = [];
  let lastAnswer = null;
  for (const s of roster) {
    const ap = s.autopilot || {};
    const a = ap.last_answer_at || null;
    if (a && (lastAnswer === null || a > lastAnswer)) lastAnswer = a;
    const openPending = !!(ap.pending && ap.pending.sent_at);
    const quiet = a ? days(nowMs - Date.parse(a)) : Infinity;
    if (openPending && quiet >= 14) {
      silent.push(s.store_id + ":" + (a ? Math.floor(quiet) + "日沈黙" : "取り込み履歴なし"));
    }
  }
  scanned("ingest_alive", silent.length === 0,
      (silent.length ? silent.join(" ") + " / " : "") + "全体最新=" + (lastAnswer || "一度もなし"));

  // E3 質問が到達可能か。上限まで聞いてなお埋まらない qid は「打ち切り」であって、
  //    放置してよい状態ではない。人が判断すべきものとして必ず名前を出す。
  const retired = [];
  for (const s of roster) {
    const ap = s.autopilot || {};
    const cnt = {};
    for (const a of (ap.asked || [])) cnt[a.qid] = (cnt[a.qid] || 0) + 1;
    const h = await env.HS_HEARING_KV.get("hearing:" + s.store_id, "json");
    const comp = computeCompleteness((h && h.profile) || {}, ap);
    for (const m of comp.missing) if ((cnt[m.qid] || 0) >= 3) retired.push(s.store_id + ":" + m.qid);
  }
  scanned("questions_reachable", retired.length === 0, retired.length ? retired.join(" ") : "打ち切りなし");

  // E4 待ちが放置されていないか。28日はペナルティの打ち切り点。それを超えたら人へ回す。
  const stale = [];
  for (const s of roster) {
    const p = (s.autopilot || {}).pending;
    if (p && p.sent_at && days(nowMs - Date.parse(p.sent_at)) > 28) stale.push(s.store_id);
  }
  scanned("no_stale_pending", stale.length === 0, stale.length ? stale.join(" ") : "放置なし");

  // E5 完成度が動いているか。前回の基準と同じままで14日たった店は、
  //    生きて見えても前に進んでいない。
  const SNAP = "selfcheck:snapshot";
  const prev = (await env.HS_HEARING_KV.get(SNAP, "json")) || {};
  const frozen = [];
  const next = {};
  for (const s of roster) {
    const c = (s.autopilot || {}).completeness;
    const cur = (c === undefined ? null : c);
    const p = prev[s.store_id];
    if (p && p.c !== null && p.c === cur && days(nowMs - Date.parse(p.at)) >= 14) {
      frozen.push(s.store_id + ":" + cur);
    }
    // 動いた店だけ基準日を更新する。動いていない店は据え置いて経過を積ませる。
    next[s.store_id] = (p && p.c === cur) ? p : { c: cur, at: now() };
  }
  // 2026-08-19 patch46: 基準が無い店は「不動なし」ではなく「まだ測れない」。
  // 通ったのか測れていないのかを、見た人が区別できるようにする。
  let noBase = 0;
  for (const s of roster) if (!prev[s.store_id]) noBase++;
  scanned("completeness_moving", frozen.length === 0,
      (frozen.length ? frozen.join(" ") : "不動なし") +
      (noBase ? "（ただし " + noBase + "店は基準未設定。次回から測れる）" : ""));
  await env.HS_HEARING_KV.put(SNAP, JSON.stringify(next));

  // E6 門が開いているのに、出せる質問が無い店。2026-08-20 gate-open-nothing-to-send。
  //    門を増やしたその日に、門が空振りする形も一緒に測る。
  //    「開いた」と「出た」を別々に数えないと、巡回は正常・完成度は不動、という状態が
  //    どこにも表示されないまま続く。E5 が14日たってようやく気づく。それでは遅い。
  const idle = [];
  for (const s of roster) {
    const ap = s.autopilot || {};
    if (ap.pending) continue;
    const h = await env.HS_HEARING_KV.get("hearing:" + s.store_id, "json");
    const prof = (h && h.profile) || null;
    if (!prof) continue;
    const comp = computeCompleteness(prof, ap);
    if (comp.score >= 85) continue;
    const sinceSend = ap.last_send_at ? (nowMs - Date.parse(ap.last_send_at)) : Infinity;
    const sinceAnswer = ap.last_answer_at ? (nowMs - Date.parse(ap.last_answer_at)) : Infinity;
    const answered = !!ap.last_answer_at &&
      (!ap.last_send_at || Date.parse(ap.last_answer_at) > Date.parse(ap.last_send_at));
    const open = (answered && sinceAnswer >= REPLY_GATE_FLOOR_H * 3600 * 1000) ||
                 (sinceSend >= FOLLOWUP_COOLDOWN_H * 3600 * 1000);
    if (!open) continue;
    if (nextQuestions(prof, ap, 2).length === 0) {
      idle.push(s.store_id + ":完成度" + comp.score + ":門は開いているが出せる質問が無い");
    }
  }
  scanned("gate_has_something_to_send", idle.length === 0,
      idle.length ? idle.join(" ") : "門が開いた店には出せる質問がある");

  const failed = checks.filter((x) => !x.ok);
  const report = { checked_at: now(), pass: failed.length === 0, failed: failed.map((f) => f.id), checks };
  await env.HS_HEARING_KV.put("selfcheck:last", JSON.stringify(report));
  return report;
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
/* 2026-08-23: 番号つきの返事を、番号ごとに切り分ける。
   質問は sendQuestions が "1) …" "2) …" と番号を振って送っている。
   返事も番号で返ってくることが多い。そのときは、どの答えがどの質問のものか分かる。

   なぜ要るか。これまでは、2問送って1通返ってくると、
   その本文を2つの質問の両方に同じまま入れていた。
   片方にしか答えていなくても、もう片方も「答えが入った」ことになる。
   落ちない。例外も出ない。ただ、聞いていない質問に、
   別の質問の答えが入ったまま残る。
   この状態で算定要件データベースに取り込めば、
   実地指導について尋ねた欄に、集客の話が入る。
   データベースが厚くなるほど、この取り違えは見つけにくくなる。

   切り分けられなかったときは、切り分けられなかったと書く。
   推測で割り当てない。attributed:"ambiguous" は、
   取り込み側(collect_field_reports.py)で人の確認に回る。 */
export function splitNumberedReply(rawText, n) {
  const t = String(rawText || "");
  if (n < 2) return null;
  const marks = [];
  for (let i = 1; i <= n; i++) {
    const circ = "①②③④⑤⑥⑦⑧⑨".charAt(i - 1);
    const re = new RegExp("(?:^|\\n)[ \u3000]*(?:\\(" + i + "\\)|" + i +
                          "[)）.．、,:：]|" + circ + ")[ \u3000]*", "m");
    const m = re.exec(t);
    if (!m) return null;
    marks.push({ start: m.index + (m[0].startsWith("\n") ? 1 : 0), end: m.index + m[0].length });
  }
  // 番号が本文の中で昇順に並んでいなければ、番号ではなく別の数字である。
  for (let i = 1; i < marks.length; i++) if (marks[i].start <= marks[i - 1].start) return null;
  const parts = [];
  for (let i = 0; i < marks.length; i++) {
    const to = (i + 1 < marks.length) ? marks[i + 1].start : t.length;
    parts.push(t.slice(marks[i].end, to).trim());
  }
  // どれか一つでも空なら、切り分けは成立していない。
  if (parts.some((x) => !x)) return null;
  return parts;
}

export function settlePendingOnAnswer(store, rawText) {
  const ap = store.autopilot || {};
  if (ap.pending && ap.pending.qids) {
    const qids = ap.pending.qids;
    const parts = splitNumberedReply(rawText, qids.length);
    const asked = ap.pending.asked_texts || {};
    const extraPatch = {};
    qids.forEach((qid, i) => {
      extraPatch[qid] = {
        text: S(parts ? parts[i] : rawText, 3000),
        at: now(),
        // どうやってこの答えに辿り着いたかを残す。
        //   sole      … その質問だけを送って返ってきた
        //   numbered  … 番号で切り分けられた
        //   ambiguous … 複数送って1通返り、切り分けられなかった
        attributed: parts ? "numbered" : (qids.length > 1 ? "ambiguous" : "sole"),
        with: qids.filter((x) => x !== qid),
        asked: S(asked[qid] || "", 600),
      };
    });
    // 2026-08-19 patch44: 返事が来たことと、その質問が埋まったことは別の事実。
    // 中身を確かめずに埋まった印を立てない。埋まったかは computeCompleteness が決める。
    // 返事が来た事実は消さずに残す。
    ap.asked = (ap.asked || []).map((a) => (ap.pending.qids.includes(a.qid) ? { ...a, replied_at: now() } : a));
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

/* ------------------------------ KIRA 自動採点(相場表内蔵・決定的) ------------------------------ */
// 2026-08-22 auto-score. スコアとティアは、これまで /admin/verify に人が手入力していた。
//   ここに決定的な採点を置き、実見積が MIN_AUDIT_ESTIMATES 本に達したら自動で verified 化できるようにする。
//   価格レンジは souba-db の写しをコード内に内蔵。同じ品目・金額を入れれば誰でも同じ判定が再現できる。
//   誠実度チェック(諸経費率・一式隠蔽・型番/仕様・保証・営業文言・支払条件)は全て決定的。
//   価格が alert(危険水準)か、ハードな誠実度違反があれば auto_verify=false。fail-closed。近道は作らない。
//
//   採点の材料は estimates_for_audit の各要素。抽出側(kira-line)が入れる想定フィールド:
//     work(工種), amount(その見積の総額,円), detail,
//     shokei(諸経費の額,円|null), lump_lines(内訳の無い「一式」行の数,集計行は除く),
//     has_spec(型番/塗料名/寸法が有るか), has_warranty(施工保証年数の記載が有るか),
//     urgency(今日だけ/特別価格 等), insurance_bait(火災保険で実質0円 等), upfront_over_half(着手金が過半),
//     lines(任意): [{ name, qty, unit_price }]  価格レンジ判定に使う。無ければ誠実度のみで採点。
//   足りないフィールドは「不明」として安全側に倒す(捏造しない)。

// souba-db の写し。min/avg/max は「製品込み・工事込み・1単位あたり(円)」。
export const KIRA_BANDS = {
  mado_inner_large: { label: "内窓設置 掃き出し窓(大) 1箇所", min: 100000, avg: 150000, max: 200000 },
  mado_inner_small: { label: "内窓設置 腰窓・小窓 1箇所",     min: 40000,  avg: 70000,  max: 100000 },
  mado_insulation:  { label: "窓断熱 内窓設置 1箇所",         min: 30000,  avg: 60000,  max: 80000 },
  door_cover_std:   { label: "玄関ドア カバー工法 片開き標準", min: 200000, avg: 300000, max: 380000 },
  door_cover_mid:   { label: "玄関ドア カバー工法 中級",       min: 300000, avg: 400000, max: 500000 },
  glass_special:    { label: "真空/特殊(防犯含む)ガラス交換", min: 100000, avg: 150000, max: 200000 },
  glass_bath:       { label: "浴室強化ガラス交換",             min: 35000,  avg: 55000,  max: 80000 },
};
// 適正 max のこの倍を超えたら alert(危険水準)。KIRA本診断の danger 相当。
export const KIRA_DANGER_MULT = 1.6;
// 自動掲載を許す最低スコア。これ未満(ただしハード違反は無い)は、自動掲載せず人の目に回す。
export const AUTO_VERIFY_MIN_SCORE = 70;

const _has = (t, arr) => { const s = String(t || ""); return arr.some((k) => s.indexOf(k) >= 0); };

// 工種名/行名を相場表のキーに寄せる。分からなければ null(価格レンジ判定はスキップ)。
export function classifyWork(text) {
  const t = String(text || "");
  if (_has(t, ["内窓", "二重窓", "リプラス", "インプラス", "プラマード"])) {
    if (_has(t, ["掃き出し", "掃出", "テラス", "大"])) return "mado_inner_large";
    if (_has(t, ["腰窓", "小窓", "小"])) return "mado_inner_small";
    return "mado_insulation";
  }
  if (_has(t, ["玄関ドア", "玄関扉", "リシェント", "ドアリモ", "カバー工法"]) && _has(t, ["玄関", "ドア", "扉", "リシェント", "ドアリモ"])) {
    if (_has(t, ["断熱", "採風", "採光", "親子", "中級", "高級"])) return "door_cover_mid";
    return "door_cover_std";
  }
  if (_has(t, ["浴室"]) && _has(t, ["ガラス"])) return "glass_bath";
  if (_has(t, ["防犯ガラス", "真空ガラス", "合わせガラス", "複層ガラス", "ガラス交換", "ガラス"])) return "glass_special";
  return null;
}

// 1つの見積の価格レンジ判定。lines があれば行ごと、無ければ工種+総額で1回だけ試す。
function _priceLevels(est) {
  const out = [];
  const lines = Array.isArray(est && est.lines) ? est.lines : [];
  const check = (name, unit) => {
    const key = classifyWork(name);
    if (!key || !(unit > 0)) return;
    const b = KIRA_BANDS[key];
    let level = "ok", vs = unit / b.avg;
    if (unit > b.max * KIRA_DANGER_MULT) level = "alert";
    else if (unit > b.max) level = "watch";
    out.push({ band: key, label: b.label, unit, level, vs_avg_pct: Math.round((vs - 1) * 100) });
  };
  if (lines.length) {
    for (const ln of lines.slice(0, 30)) {
      const q = Number(ln && ln.qty) || 1;
      const up = Number(ln && ln.unit_price) || 0;
      check((ln && ln.name) || est.work, up || (q ? Number(ln && ln.amount) / q : 0));
    }
  }
  // lines が無く、総額が単一工種っぽい(数量1)ときだけ総額で1回試す。多工種の総額は判定しない。
  if (!out.length && Number(est && est.amount) > 0 && Number(est && est.qty || 1) === 1) {
    check(est.work, Number(est.amount));
  }
  return out;
}

// profile.estimates_for_audit から適正度スコア/誠実度ティア/赤旗を決定的に出す。
export function scoreEstimates(profile) {
  const ests = Array.isArray(profile && profile.estimates_for_audit) ? profile.estimates_for_audit : [];
  const n = ests.length;
  let score = 100;
  const hard = [];   // 過剰請求・欺瞞のハード赤旗(alert)
  const soft = [];   // 確認推奨(watch)
  const priceLevels = [];
  let priceChecked = 0;
  let warrantyAny = false;
  let signalCount = 0; // 採点に使える実データ(諸経費 or 明細 or 誠実度フラグ)を持つ見積の数

  for (const e of ests) {
    const amount = Number(e && e.amount) || 0;
    const shokei = (e && e.shokei != null) ? Number(e.shokei) : null;
    const work = (e && e.work) || "";
    // この見積が採点材料を持っているか。諸経費の額(0も可)か、単価の分かる明細が要る。
    //   誠実度フラグ(型番/保証等)だけでは自動掲載の根拠にしない。諸経費が読めない見積は人の目に回す。
    const hasSignal = (shokei != null) || (Array.isArray(e && e.lines) && e.lines.length > 0);
    if (hasSignal) signalCount++;

    // 諸経費率(決定的)。20%超はハード、16-20%は watch。
    if (shokei != null && amount > 0) {
      const r = shokei / amount;
      if (r > 0.20) { hard.push("諸経費が総額の20%超(" + Math.round(r * 100) + "%): " + work); score -= 25; }
      else if (r > 0.16) { soft.push("諸経費が16-20%(" + Math.round(r * 100) + "%): " + work); score -= 5; }
    }
    // 一式隠蔽(決定的)。内訳の無い一式行が3つ以上はハード、1-2は watch。
    const lump = Number(e && e.lump_lines) || 0;
    if (lump >= 3) { hard.push("内訳の無い「一式」が" + lump + "行: " + work); score -= 20; }
    else if (lump >= 1) { soft.push("内訳の無い「一式」が" + lump + "行: " + work); score -= 5; }
    // 型番/仕様(決定的)。明示が無ければ watch。
    if (e && e.has_spec === false) { soft.push("型番/塗料名/寸法の記載が薄い: " + work); score -= 5; }
    // 営業圧(決定的・ハード)
    if (e && e.urgency === true) { hard.push("今日だけ/特別価格などの緊急煽り: " + work); score -= 15; }
    if (e && e.insurance_bait === true) { hard.push("火災保険で実質0円などの誘導: " + work); score -= 20; }
    if (e && e.upfront_over_half === true) { soft.push("着手金が過半: " + work); score -= 8; }
    if (e && e.has_warranty === true) warrantyAny = true;

    // 価格レンジ(内蔵表・決定的)
    for (const pl of _priceLevels(e)) {
      priceChecked++;
      priceLevels.push(pl);
      if (pl.level === "alert") { hard.push("価格が危険水準(" + pl.label + " " + (pl.vs_avg_pct >= 0 ? "+" : "") + pl.vs_avg_pct + "%): " + work); score -= 15; }
      else if (pl.level === "watch") { soft.push("適正上限超だが危険未満(" + pl.label + " +" + pl.vs_avg_pct + "%): " + work); }
    }
  }
  // 価格 watch は本数に依らず合計マイナス6を上限(honest な店を過度に削らない)
  const priceWatch = priceLevels.filter((p) => p.level === "watch").length;
  if (priceWatch) score -= Math.min(6, priceWatch * 3);
  // 保証年数がどの見積にも無い(書式上の欠落・ソフト)
  if (n > 0 && !warrantyAny) { soft.push("施工保証の年数が見積書に無い(全件共通)"); score -= 2; }

  if (score < 0) score = 0;
  if (score > 100) score = 100;

  const hardAlert = hard.length > 0;
  let tier = "F";
  if (score >= 90) tier = "A";
  else if (score >= 80) tier = "B";
  else if (score >= 70) tier = "C";
  else if (score >= 60) tier = "D";
  else if (score >= 50) tier = "E";

  const enoughEvidence = n >= MIN_AUDIT_ESTIMATES;
  // 採点材料を持つ見積が規定本数に届いていなければ「測っていない」。薄い取り込みだけで自動掲載しない。
  const enoughSignal = signalCount >= MIN_AUDIT_ESTIMATES;
  const autoVerify = enoughEvidence && enoughSignal && !hardAlert && score >= AUTO_VERIFY_MIN_SCORE;
  let reason;
  if (!enoughEvidence) reason = "証拠不足(実見積 " + n + "/" + MIN_AUDIT_ESTIMATES + " 本)。分母の無いスコアは出さない。";
  else if (!enoughSignal) reason = "抽出データが採点に足りない(諸経費/明細を持つ見積 " + signalCount + "/" + MIN_AUDIT_ESTIMATES + " 本)。自動掲載せず人の確認へ。";
  else if (hardAlert) reason = "ハードな赤旗を検知したため自動掲載せず、人の確認に回す(fail-closed): " + hard.slice(0, 3).join(" / ");
  else if (score < AUTO_VERIFY_MIN_SCORE) reason = "スコア " + score + " が自動掲載の下限(" + AUTO_VERIFY_MIN_SCORE + ")未満。人の確認に回す。";
  else reason = "自動掲載の条件を満たす(証拠十分・ハード赤旗なし・スコア" + score + ")。";

  return {
    evidence_count: n,
    signal_count: signalCount,
    fairness_score: score,
    integrity_tier: tier,
    red_flags_detected: hard.length,
    red_flags: hard.slice(0, 8),
    confirm_notes: soft.slice(0, 8),
    price_levels: priceLevels.slice(0, 20),
    price_checked: priceChecked,
    hard_alert: hardAlert,
    auto_verify: autoVerify,
    reason,
  };
}
