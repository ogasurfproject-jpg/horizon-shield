/**
 * hs-kira-proxy v11 PATCH
 *
 * ⚠️ これは v10 ベース + /reverse-estimate 追加の【完全統合版】
 * ⚠️ TOshi は全貼付けでOK（既存機能全部残したままヒアリング機能追加）
 *
 * v10からの変更点（追加のみ、既存は一切変更なし）:
 *  - NEW: /reverse-estimate エンドポイント（ヒアリング判定型）
 *  - NEW: handleReverseEstimate() 関数
 *  - NEW: runHearingDecision() - Claude でヒアリング要否判定
 *  - NEW: HEARING_PROMPT - プロの現場監督視点の質問設計
 *  - NEW: generatePlansFromItems() - 30カテゴリDB参照して3プラン算出
 *  - NEW: KOJI_TYPE_MAP（28カテゴリ対応）
 *  - NEW: PLAN_PROFIT_MULTIPLIER（業者規模別係数）
 *  - NEW: LAYOUT_CHANGE_EXTRA_JPY（TOshi 30年知識のレイアウト変更コスト）
 *
 * 既存エンドポイントに一切変更なし:
 *   /checkout/gyaku-mitsumori/start, /checkout/complete
 *   /kira, /debate, /anthropic, /history, /history/clear
 *   /inquiries, /delete, /stats, /send-email, /notify
 *   /bank-order, /confirm-payment, /admin
 *
 * 追加のバインディング不要（既存のKIRA_STATS, ORDERSをそのまま使う）
 * 追加のシークレット不要（既存のANTHROPIC_API_KEYをそのまま使う）
 */

const KIRA_SYSTEM_PROMPT = `あなたはKIRA（建設費診断AI）です。The HORIZ音s株式会社が提供する建設費診断サービス「HORIZON SHIELD」のAIアシスタントです。

【KIRAの人格】
- 建設業界30年のベテラン大工・現場監督・CMRである大賀俊勝の知識を学習したAI
- 施主（工事を依頼する側）の味方として徹底的に寄り添う
- 悪質業者の手口を熟知しており、施主を守ることを最優先とする
- 親切かつ具体的。専門用語は使わず、わかりやすい言葉で話す
- ユーザーの過去の相談内容を覚えており、継続的にサポートする

【HORIZON SHIELDのサービス】
- 建設費診断：¥55,000（2営業日以内PDF納品）
- 変更工事査定：¥33,000（24時間以内判定）
- 完成検査立会い：¥88,000（現場立会い）
- 無料AI診断：shield.the-horizons-innovation.com
- LINE相談：@172piime / 代表：大賀俊勝 0463-74-5917

【2026年現在の特殊事情】
ホルムズ海峡封鎖により原油価格が112.95ドルまで高騰（1970年代以来最大のエネルギー危機）
本当に影響を受ける建材：防水シート+5〜15%、油性塗料+8〜20%、塩ビ管+10〜20%、アルミサッシ+8〜15%
ほぼ影響なし：国産木材、国産水性塗料、国産クロス、国産フローリング
→「ホルムズの影響で値上がり」と言われたら「具体的な仕入れ伝票を見せてください」と要求

【工事別適正価格 2026年版】
外壁塗装30坪：シリコン70〜100万/ラジカル85〜115万/フッ素100〜140万/無機130〜180万（警戒：150万超）
外壁+屋根セット：100〜130万（警戒：200万超）
屋根カバー工法：80〜150万（平均100〜130万）/ 葺き替え：100〜200万
キッチン：ロー50〜80万/ミドル100〜150万/ハイ180〜250万
浴室：在来→ユニット100〜160万 / ユニット→ユニット70〜120万
トイレ：便座10〜20万/便器+内装25〜40万/和式→洋式50〜70万
水回り3点：ロー150〜200万/ミドル200〜300万/ハイ350〜500万
外構フルセット：関東100〜180万/関西90〜160万/九州80〜150万

【悪質業者の手口】
点検商法/一式見積もり/即日契約要求/恐怖訴求/資材高騰便乗/坪単価パック/
下請け多重構造（1.2〜1.5倍）/火災保険詐欺/追加工事後出し/シロアリでっち上げ/
公務員なりすまし/モニター商法/省エネ補助金便乗
クーリングオフ：訪問販売は契約書受取8日以内なら無条件解約可。相談：188

【回答ルール】
✅ 坪数・地域確認→価格帯案内→警戒ライン超えは明確に指摘→相見積もり3社以上推奨
❌ 診断なしで「適正」断言禁止 / 証拠なく「悪徳業者」断言禁止`;

const MAX_HISTORY = 20;
const HISTORY_TTL = 60 * 60 * 24 * 30;

const ALLOWED_ORIGINS = [
  'https://shield.the-horizons-innovation.com',
  'https://hs-kira-proxy.oga-surf-project.workers.dev',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function determineStrategy(scores) {
  const { anxiety, anger, resignation, urgency } = scores;
  if (anger >= 7) return 'DEESCALATE';
  if (anxiety >= 7 || urgency >= 7) return 'CONVERT';
  if (resignation >= 7) return 'ENCOURAGE';
  return 'STANDARD';
}

function getStrategyPrompt(strategy, scores) {
  switch(strategy) {
    case 'DEESCALATE':
      return `\n\n【対応戦略：鎮静化】施主は強い怒りを感じています（怒りスコア:${scores.anger}/10）。まず「それは怒るのは当然です」と共感を示してから冷静な情報提供をしてください。有料診断への誘導は最後の1行だけ、押しつけがましくなく。`;
    case 'CONVERT':
      return `\n\n【対応戦略：有料診断への誘導】施主は強い不安・緊急性を感じています（不安:${scores.anxiety}/10 緊急度:${scores.urgency}/10）。返答の最後に「今すぐ専門診断（¥55,000）で確実な答えを出しましょう。shield.the-horizons-innovation.com」と明確に案内してください。`;
    case 'ENCOURAGE':
      return `\n\n【対応戦略：励まし・行動促進】施主は諦めかけています（諦めスコア:${scores.resignation}/10）。「まだ間に合います」「あなたには知る権利があります」という言葉で背中を押し、具体的な次のアクションを明示してください。`;
    default:
      return '';
  }
}

async function analyzeEmotion(env, text) {
  const prompt = `以下のメッセージから感情スコアを分析してJSON形式で返してください。
スコアは0〜10の整数。JSONのみ返答し、説明文は不要です。

メッセージ：「${text}」

返答形式（JSONのみ）：
{"anxiety":0,"anger":0,"resignation":0,"urgency":0}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    const text2 = data?.content?.[0]?.text || '{}';
    const clean = text2.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    return { anxiety: 0, anger: 0, resignation: 0, urgency: 0 };
  }
}

function classifyQuestion(text) {
  const newsKeywords = [
    'ホルムズ', '関税', 'トランプ', '最新', 'ニュース', '今日', '今週',
    '現在', '値上がり', '高騰', '封鎖', 'イラン', '戦争', '物価',
    '円安', '輸入', '価格上昇', '2026', '最近'
  ];
  const constructionKeywords = [
    '見積', '相場', '適正', '外壁', '屋根', '水回り', 'キッチン',
    '浴室', 'トイレ', 'リフォーム', '塗装', 'カバー工法', '葺き替え',
    '業者', '手口', 'クーリングオフ', '足場', '一式', '追加工事', '工事', '塗料'
  ];
  const hasNews = newsKeywords.some(k => text.includes(k));
  const hasBuildingMaterial = text.includes('建材');
  const hasConstruction = constructionKeywords.some(k => text.includes(k));
  const isConstruction = hasConstruction || (hasBuildingMaterial && !hasNews);
  if (hasNews && (isConstruction || hasBuildingMaterial)) return 'HYBRID';
  if (hasNews) return 'NEWS';
  return 'CONSTRUCTION';
}

async function getHistory(env, userId) {
  if (!userId) return [];
  try {
    const data = await env.KIRA_STATS.get(`history:${userId}`, { type: 'json' });
    return data || [];
  } catch (e) { return []; }
}

async function saveHistory(env, userId, messages) {
  if (!userId) return;
  try {
    const trimmed = messages.slice(-MAX_HISTORY);
    await env.KIRA_STATS.put(`history:${userId}`, JSON.stringify(trimmed), { expirationTtl: HISTORY_TTL });
  } catch (e) {}
}

async function clearHistory(env, userId) {
  if (!userId) return;
  try { await env.KIRA_STATS.delete(`history:${userId}`); } catch (e) {}
}

async function callGemini(env, question) {
  const prompt = `あなたは建設・不動産業界のニュースアナリストです。
以下の質問に関連する最新の情報（2026年の状況）を簡潔に日本語で回答してください。
特に以下の観点で回答してください：
1. 最新の市場状況・価格動向
2. 施主（工事を依頼する一般消費者）への具体的な影響
3. 建設業界特有の注意点

質問：${question}

回答は200文字以内で要点のみ。`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 300, temperature: 0.3 }
      })
    }
  );
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

async function callClaude(env, messages, systemOverride = null) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemOverride || KIRA_SYSTEM_PROMPT,
      messages,
    }),
  });
  return await res.json();
}


// ====================================================================
// ▼▼▼ v10 既存: 逆見積もりPDF決済フロー ▼▼▼
// ====================================================================

const GYAKU_MITSUMORI = {
  id: 'gyaku-mitsumori',
  name: '交渉用・逆見積書PDF',
  amount: 5500,
  description: 'HORIZON SHIELD 交渉用・逆見積書PDF',
};

const LINE_REDIRECT_URI   = 'https://shield.the-horizons-innovation.com/auth/line-callback.html';
const PAYPAY_REDIRECT_URL = 'https://shield.the-horizons-innovation.com/thankyou.html';
const PAYPAY_API_BASE     = 'https://api.paypay.ne.jp';

async function paypayHmacAuth(method, path, bodyObj, apiKey, apiSecret) {
  const nonce = Math.random().toString(36).substring(2, 14);
  const epoch = Math.floor(Date.now() / 1000).toString();

  let hash        = 'empty';
  let contentType = 'empty';
  if (bodyObj) {
    const bodyBytes  = new TextEncoder().encode(JSON.stringify(bodyObj));
    const hashBuffer = await crypto.subtle.digest('SHA-256', bodyBytes);
    hash             = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
    contentType      = 'application/json;charset=UTF-8';
  }

  const dataToSign = [path, method, nonce, epoch, contentType, hash].join('\n');
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(apiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(dataToSign));
  const macData   = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));

  const headerValue = [apiKey, macData, nonce, epoch, hash].join(':');
  return `hmac OPA-Auth:${headerValue}`;
}

async function handleCheckoutStart(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400, origin);
  }

  const { koji_type, menseki, teiji_kingaku } = body;
  if (!koji_type || !menseki || !teiji_kingaku) {
    return json({ error: 'missing required fields' }, 400, origin);
  }

  const sessionId = crypto.randomUUID();
  const sessionData = {
    koji_type,
    menseki:      Number(menseki),
    teiji_kingaku: Number(teiji_kingaku),
    grade:        body.grade        || '標準',
    chikunen:     body.chikunen     || '10-20年',
    hanyu_jouken: body.hanyu_jouken || '良好',
    email:        body.email        || null,
    created_at:   Date.now(),
  };
  await env.ORDERS.put(`session:${sessionId}`, JSON.stringify(sessionData), { expirationTtl: 300 });

  const lineUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
  lineUrl.searchParams.set('response_type', 'code');
  lineUrl.searchParams.set('client_id',     env.LINE_LOGIN_CHANNEL_ID);
  lineUrl.searchParams.set('redirect_uri',  LINE_REDIRECT_URI);
  lineUrl.searchParams.set('state',         sessionId);
  lineUrl.searchParams.set('scope',         'profile openid');
  lineUrl.searchParams.set('bot_prompt',    'aggressive');

  return json({
    line_login_url: lineUrl.toString(),
    session_id:     sessionId,
  }, 200, origin);
}

async function handleCheckoutComplete(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400, origin);
  }

  const { code, state } = body;
  if (!code || !state) {
    return json({ error: 'missing code or state' }, 400, origin);
  }

  const sessionRaw = await env.ORDERS.get(`session:${state}`);
  if (!sessionRaw) {
    return json({ error: 'session expired or invalid' }, 400, origin);
  }
  const session = JSON.parse(sessionRaw);

  const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code:          code,
      redirect_uri:  LINE_REDIRECT_URI,
      client_id:     env.LINE_LOGIN_CHANNEL_ID,
      client_secret: env.LINE_LOGIN_CHANNEL_SECRET,
    }).toString(),
  });
  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error('LINE token error:', err);
    return json({ error: 'line token exchange failed', detail: err }, 500, origin);
  }
  const token = await tokenRes.json();

  const profileRes = await fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!profileRes.ok) {
    return json({ error: 'line profile fetch failed' }, 500, origin);
  }
  const profile = await profileRes.json();
  const lineUserId = profile.userId;

  const merchantPaymentId = `hs-gyaku-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const accessToken       = crypto.randomUUID().replace(/-/g, '');

  const paypayBody = {
    merchantPaymentId,
    amount:           { amount: GYAKU_MITSUMORI.amount, currency: 'JPY' },
    codeType:         'ORDER_QR',
    orderDescription: GYAKU_MITSUMORI.description,
    isAuthorization:  false,
    redirectUrl:      `${PAYPAY_REDIRECT_URL}?id=${merchantPaymentId}`,
    redirectType:     'WEB_LINK',
  };
  const paypayPath = '/v2/codes';
  const authHeader = await paypayHmacAuth('POST', paypayPath, paypayBody, env.PAYPAY_API_KEY, env.PAYPAY_API_SECRET);
  const paypayRes = await fetch(`${PAYPAY_API_BASE}${paypayPath}`, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json;charset=UTF-8',
      'Authorization':     authHeader,
      'X-ASSUME-MERCHANT': env.PAYPAY_MERCHANT_ID,
    },
    body: JSON.stringify(paypayBody),
  });
  if (!paypayRes.ok) {
    const err = await paypayRes.text();
    console.error('PayPay HTTP error:', paypayRes.status, err);
    return json({ error: 'paypay qr creation failed', status: paypayRes.status, detail: err }, 500, origin);
  }
  const paypay = await paypayRes.json();
  if (paypay.resultInfo?.code !== 'SUCCESS') {
    console.error('PayPay resultInfo error:', paypay.resultInfo);
    return json({ error: 'paypay returned error', detail: paypay.resultInfo }, 500, origin);
  }

  const order = {
    merchant_payment_id: merchantPaymentId,
    amount:              GYAKU_MITSUMORI.amount,
    form_data:           session,
    email:               session.email,
    lineUserId:          lineUserId,
    lineDisplayName:     profile.displayName,
    access_token:        accessToken,
    status:              'pending',
    created_at:          Date.now(),
  };
  await env.ORDERS.put(`order:${merchantPaymentId}`, JSON.stringify(order), { expirationTtl: 60 * 60 * 24 * 7 });

  await env.ORDERS.delete(`session:${state}`);

  try {
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${env.LINE_CHANNEL_TOKEN}`,
      },
      body: JSON.stringify({
        to: env.LINE_USER_ID,
        messages: [{
          type: 'text',
          text: `🛒 逆見積もりPDF 見込み発生\n`
              + `ID: ${merchantPaymentId}\n`
              + `工事: ${session.koji_type} / ${session.menseki}㎡\n`
              + `提示額: ¥${Number(session.teiji_kingaku).toLocaleString()}\n`
              + `LINE: ${profile.displayName}\n`
              + `決済待ち...`,
        }],
      }),
    });
  } catch (_e) {}

  return json({
    paypay_url:          paypay.data.url,
    merchant_payment_id: merchantPaymentId,
  }, 200, origin);
}

// ====================================================================
// ▼▼▼ v11 NEW: /reverse-estimate ヒアリング判定型 ▼▼▼
// ====================================================================

const HEARING_PROMPT = `あなたは建設業30年のプロの現場監督(CMR)AIです。
施主の要望を読み取り、3プラン算出に必要な情報が揃っているか判定してください。

【必須情報】
各工事項目について:
1. 施工面積・サイズ（6畳、幅2700mm、10㎡等）
2. 現状と希望の差（I型→アイランド、既存撤去の範囲）
3. グレード感（手頃・標準・こだわり）
4. 全体予算感（500万以内、1000万程度）

【判定】
- 必須情報の50%以下しか揃っていない → "need_hearing"
- 必須情報が概ね揃っている（70%以上）→ "ready"

【need_hearing の質問設計】
- 1質問で1情報
- 選択肢を提示
- 最大3つまで
- 「現状」「希望」「予算」の順

【ready 時の items 抽出】
{
  "status": "ready",
  "items": [
    { "koji_type": "kitchen", "area": null, "grade_hint": "standard", "layout_change": "I_to_island", "wall_removal": "partition_only", "budget_hint": 1200, "raw_text": "..." }
  ]
}

【need_hearing 時】
{
  "status": "need_hearing",
  "detected_topics": ["kitchen_layout_change", "room_expansion"],
  "reason": "レイアウト変更の範囲と現状サイズが不明で、¥50-300万の誤差が出ます",
  "clarifying_questions": [
    {
      "id": "kitchen_current",
      "question": "現在のキッチンのレイアウト・サイズは？",
      "why": "I型→アイランドは+¥100万、L型→アイランドは+¥70万程度の差",
      "options": [
        {"value": "I_2550", "label": "I型 幅2550mm（標準）"},
        {"value": "I_2700", "label": "I型 幅2700mm（売れ筋）"},
        {"value": "I_3000", "label": "I型 幅3000mm（大型）"},
        {"value": "L_type", "label": "L型"},
        {"value": "other", "label": "その他・わからない"}
      ]
    },
    {
      "id": "wall_removal",
      "question": "「リビングを広くしたい」は具体的にどちら？",
      "why": "間仕切り壁撤去は+¥50万、構造壁撤去は+¥150-300万と大きく変わります",
      "options": [
        {"value": "partition_only", "label": "間仕切り壁を撤去するだけ"},
        {"value": "structural", "label": "構造壁をごっそり撤去（柱梁補強含む）"},
        {"value": "unknown", "label": "わからない・業者に任せたい"}
      ]
    },
    {
      "id": "budget",
      "question": "大まかな予算感は？",
      "why": "予算により採用できるグレード・メーカーが変わります",
      "options": [
        {"value": "500", "label": "500万円以内"},
        {"value": "1000", "label": "1000万円前後"},
        {"value": "1500", "label": "1500万円前後"},
        {"value": "2000", "label": "2000万円以上"},
        {"value": "undecided", "label": "まだ決めていない"}
      ]
    }
  ]
}

【過去の回答がある場合】
previous_answers を統合して再判定。全部揃えば "ready"。

【重要】
- 返答は必ずJSONのみ
- 「見積もり」ではなく「参考価格」「相場」という言葉
- 日本語で自然な質問文`;

const KOJI_TYPE_MAP = {
  "kitchen": { db: "kitchen_reform", trade_key: "kitchen" },
  "bathroom": { db: "bathroom_reform", trade_key: "bathroom" },
  "toilet": { db: "toilet_reform", trade_key: "toilet" },
  "washroom": { db: "washroom_reform", trade_key: "washroom_vanity" },
  "floor": { db: "floor_replacement_v2", trade_key: "floor_materials", grade_map: { matsu: "solid_wood_flooring", take: "composite_flooring", ume: "CF_cushion_floor" } },
  "cloth": { db: "cloth_replacement", trade_key: "cloth_wallpaper", grade_map: { matsu: "premium_vinyl_kinofu", take: "standard_vinyl", ume: "standard_vinyl" } },
  "tatami": { db: "tatami_reform" },
  "water_heater": { db: "water_heater_reform", trade_key: "water_heater", grade_map: { matsu: "hybrid_heater", take: "ecocute_460L_standard_exchange", ume: "gas_heater_eco_jozu_exchange" } },
  "electrical": { db: "electrical_work" },
  "water_pipe": { db: "water_pipe_work" },
  "aircon": { db: "aircon_work" },
  "roof": { db: "roof_construction" },
  "gaiheki": { db: "gaiheki_tosou" },
  "insulation": { db: "insulation_work" },
  "termite": { db: "termite_work" },
  "taishin": { db: "taishin_hokyou", grade_map: { matsu: "full_taishin_package", take: "kabe_hokyou_10kabe_full", ume: "kabe_hokyou_3kabe" } },
  "window": { db: "window_reform", trade_key: "window", grade_map: { matsu: "inner_window_whole_house_6_S_grade", take: "inner_window_whole_house_6", ume: "glass_only_all_windows" } },
  "entrance_door": { db: "entrance_door_reform", trade_key: "entrance_door" },
  "waterproof": { db: "waterproofing_work" },
  "rain_leak": { db: "rain_leak_repair" },
  "sakan": { db: "sakan_work" },
  "tile": { db: "tile_renga_work" },
  "bankin": { db: "bankin_work" },
  "naishou_tosou": { db: "naishou_tosou" },
  "barrier_free": { db: "barrier_free_kaigo" },
  "demolition": { db: "demolition_master" },
  "gaikou": { db: "gaikou_work" },
  "amido": { db: "amido_amado_shutter" },
  "commercial": { db: "commercial_tenpo_work" }
};

const PLAN_PROFIT_MULTIPLIER = {
  matsu: { name: "理想プラン（松）", multiplier_min: 1.12, multiplier_max: 1.18, target_business: "区分4: 大手リフォーム", pros: ["ブランド安心", "長期保証"], cons: ["価格最高帯"] },
  take:  { name: "推奨プラン（竹）", multiplier_min: 1.00, multiplier_max: 1.03, target_business: "★区分2: 中小工務店（HS推奨）", pros: ["適正価格", "地域密着"], cons: ["ブランド力は区分4に劣る"] },
  ume:   { name: "最安プラン（梅）", multiplier_min: 0.85, multiplier_max: 0.95, target_business: "区分1: 個人事業", pros: ["最安帯"], cons: ["機種グレード低め"] }
};

const LAYOUT_CHANGE_EXTRA_JPY = {
  I_to_L: 400000,
  I_to_island: 1000000,
  L_to_island: 700000,
  wall_removal_partition: 500000,
  wall_removal_structural: 2000000
};

function avgRange(r) {
  if (!r) return 0;
  if (typeof r === 'number') return r;
  if (r.min !== undefined && r.max !== undefined) return (r.min + r.max) / 2;
  return 0;
}

async function runHearingDecision(text, previousAnswers, env) {
  const ctx = previousAnswers ? `\n\n【過去のヒアリング回答】\n${JSON.stringify(previousAnswers, null, 2)}` : '';
  const fullPrompt = HEARING_PROMPT + `\n\n【施主の入力】\n${text}${ctx}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 2048, messages: [{ role: 'user', content: fullPrompt }] }),
  });

  if (!response.ok) throw new Error(`Claude API failed: ${response.status}`);

  const data = await response.json();
  const content = data.content?.[0]?.text || '';
  const cleaned = content.replace(/```json\s*|\s*```/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    return {
      status: 'need_hearing',
      reason: '入力内容を正確に解析できませんでした',
      clarifying_questions: [{
        id: 'koji_type', question: 'どのリフォームをご希望ですか？',
        options: [
          { value: 'kitchen', label: 'キッチン' },
          { value: 'bathroom', label: 'お風呂' },
          { value: 'toilet', label: 'トイレ' },
          { value: 'floor', label: '床' },
          { value: 'other', label: 'その他' }
        ]
      }]
    };
  }
}

async function generatePlansFromItems(items) {
  const REPO = 'https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/souba-v2';
  const tradeDB = await fetch(`${REPO}/trade_prices_jusetsu.json`).then(r => r.json()).catch(() => ({}));
  const neededCats = [...new Set(items.map(i => KOJI_TYPE_MAP[i.koji_type]?.db).filter(Boolean))];
  const soubaDB = {};
  await Promise.all(neededCats.map(async (cat) => {
    try {
      const r = await fetch(`${REPO}/${cat}.json`);
      if (r.ok) soubaDB[cat] = await r.json();
    } catch (e) {}
  }));
  return generatePlans(items, soubaDB, tradeDB);
}

function getMarketAlerts(items) {
  const alerts = [];
  const t = new Set(items.map(i => i.koji_type));
  if (t.has('bathroom') || t.has('toilet')) alerts.push({ severity: 'critical', title: '🚨 TOTO/LIXIL 受注停止中（2026/4/13〜）', message: 'ユニットバス・トイレユニット新規受注停止中。タカラスタンダード推奨。' });
  if (t.has('aircon')) alerts.push({ severity: 'high', title: '🚨 因幡電工 冷媒配管+20%値上げ', message: '2026年2月〜銅・石油原料高により実質+20%。' });
  if (t.has('rain_leak') || t.has('roof') || t.has('bankin')) alerts.push({ severity: 'high', title: '🚨 ルーフィング+40-50%値上げ（2026/5/1〜）', message: '雨漏り修理・屋根工事は5月以降の着工が値上げ対象' });
  return alerts;
}

function generatePlans(items, soubaDB, tradeDB) {
  const totals = { matsu: 0, take: 0, ume: 0 };
  const validItems = { matsu: [], take: [], ume: [] };
  const errors = [];

  for (const item of items) {
    const result = computeItemPlan(item, soubaDB, tradeDB);
    if (result.error) { errors.push(result); continue; }

    if (item.layout_change && LAYOUT_CHANGE_EXTRA_JPY[item.layout_change]) {
      const extra = LAYOUT_CHANGE_EXTRA_JPY[item.layout_change];
      for (const pt of ['matsu', 'take', 'ume']) if (result[pt]?.total) result[pt].total += extra;
    }
    if (item.wall_removal === 'partition_only' || item.wall_removal === true) {
      for (const pt of ['matsu', 'take', 'ume']) if (result[pt]?.total) result[pt].total += LAYOUT_CHANGE_EXTRA_JPY.wall_removal_partition;
    }
    if (item.wall_removal === 'structural') {
      for (const pt of ['matsu', 'take', 'ume']) if (result[pt]?.total) result[pt].total += LAYOUT_CHANGE_EXTRA_JPY.wall_removal_structural;
    }

    for (const pt of ['matsu', 'take', 'ume']) {
      if (result[pt]?.total) {
        totals[pt] += result[pt].total;
        validItems[pt].push({ koji_type: result.koji_type, ...result[pt] });
      }
    }
  }

  return {
    matsu: { ...PLAN_PROFIT_MULTIPLIER.matsu, total: totals.matsu, total_man_en: Math.round(totals.matsu / 10000), items: validItems.matsu, summary: `大手リフォーム会社相場 ¥${totals.matsu.toLocaleString()}` },
    take:  { ...PLAN_PROFIT_MULTIPLIER.take,  total: totals.take,  total_man_en: Math.round(totals.take / 10000),  items: validItems.take,  summary: `★中小工務店相場 ¥${totals.take.toLocaleString()}` },
    ume:   { ...PLAN_PROFIT_MULTIPLIER.ume,   total: totals.ume,   total_man_en: Math.round(totals.ume / 10000),   items: validItems.ume,   summary: `個人+ネット調達 ¥${totals.ume.toLocaleString()}` },
    errors,
    _meta: { engine_version: "1.1-hearing", generated_at: new Date().toISOString() }
  };
}

function computeItemPlan(item, soubaDB, tradeDB) {
  const mapping = KOJI_TYPE_MAP[item.koji_type];
  if (!mapping) return { error: `Unknown koji_type: ${item.koji_type}`, koji_type: item.koji_type };
  if (mapping.trade_key && tradeDB[mapping.trade_key]) {
    const r = computeFromTradeDB(item, mapping, tradeDB[mapping.trade_key]);
    if (r._needs_souba_db) return computeFromSoubaDB(item, mapping, soubaDB);
    return r;
  }
  return computeFromSoubaDB(item, mapping, soubaDB);
}

function computeFromTradeDB(item, mapping, tradeCategoryData) {
  const { koji_type, area = null } = item;
  const result = { koji_type, category_name: mapping.db, area };

  if (koji_type === "floor" || koji_type === "cloth") {
    const materials = tradeCategoryData.materials;
    const sqm = area || 12.96;
    const m = mapping.grade_map;
    if (!m) return { _needs_souba_db: true, koji_type };
    result.matsu = { name: m.matsu, sqm, total: Math.round(avgRange(materials[m.matsu]?.施工費込み_per_sqm) * sqm * 1.15), message: `${materialLabel(m.matsu)}・大手` };
    result.take  = { name: m.take,  sqm, total: Math.round(avgRange(materials[m.take]?.施工費込み_per_sqm)  * sqm * 1.01), message: `${materialLabel(m.take)}・中小工務店★` };
    result.ume   = { name: m.ume,   sqm, total: Math.round(avgRange(materials[m.ume]?.施工費込み_per_sqm)   * sqm * 0.90), message: `${materialLabel(m.ume)}・個人+ネット` };
    return result;
  }

  if (koji_type === "window" || koji_type === "entrance_door" || koji_type === "water_heater") {
    return { _needs_souba_db: true, koji_type };
  }

  const makers = tradeCategoryData.manufacturers;
  const installTotal = tradeCategoryData.installation_cost_jpy?.total_typical_万円;
  const defaultMaker = koji_type === "kitchen" ? "LIXIL" : "TOTO";
  const budgetMaker = koji_type === "bathroom" ? "タカラスタンダード" : defaultMaker;

  result.matsu = buildTradePlan(makers?.[defaultMaker]?.lineup_by_grade?.最上位, installTotal, "matsu", defaultMaker, "最上位");
  result.take  = buildTradePlan(makers?.[defaultMaker]?.lineup_by_grade?.中位,  installTotal, "take",  defaultMaker, "中位");
  result.ume   = buildTradePlan(makers?.[budgetMaker]?.lineup_by_grade?.下位,   installTotal, "ume",   budgetMaker, "下位");
  return result;
}

function buildTradePlan(gradeData, installTotal, planType, maker, gradeName) {
  if (!gradeData) return null;
  const priceRange = gradeData.売れ筋価格帯_万円 || gradeData.売れ筋施工費込み_万円 || gradeData.定価帯_1616_万円 || gradeData.定価帯_w750_万円 || gradeData.定価帯_万円;
  if (!priceRange) return null;
  const unitPrice = avgRange(priceRange);
  const installAvg = installTotal ? avgRange(installTotal) : 0;
  const subtotal = unitPrice + installAvg;
  const mul = (PLAN_PROFIT_MULTIPLIER[planType].multiplier_min + PLAN_PROFIT_MULTIPLIER[planType].multiplier_max) / 2;
  const total_man_en = Math.round(subtotal * mul);
  return { maker, series: gradeData.series, grade: gradeName, total: total_man_en * 10000, total_man_en, message: `${maker} ${gradeData.series}（${gradeName}）` };
}

function computeFromSoubaDB(item, mapping, soubaDB) {
  const catData = soubaDB[mapping.db];
  if (!catData) return { error: `Category ${mapping.db} not found`, koji_type: item.koji_type };
  const plansField = Object.keys(catData).find(k => k.toLowerCase().includes('plan') && k !== 'plans_template');
  if (!plansField) return { error: `No plans in ${mapping.db}`, koji_type: item.koji_type };

  const plans = catData[plansField];
  const isList = Array.isArray(plans);
  const keys = isList ? plans.map((_, i) => i) : Object.keys(plans);
  const result = { koji_type: item.koji_type, category_name: mapping.db };

  if (mapping.grade_map && !isList) {
    result.matsu = extractPlanPrice(plans[mapping.grade_map.matsu], "matsu");
    result.take  = extractPlanPrice(plans[mapping.grade_map.take],  "take");
    result.ume   = extractPlanPrice(plans[mapping.grade_map.ume],   "ume");
  } else {
    const len = keys.length;
    const get = (idx) => isList ? plans[idx] : plans[keys[idx]];
    result.matsu = len > Math.floor(len * 0.75) ? extractPlanPrice(get(Math.min(len-1, Math.floor(len * 0.75))), "matsu") : null;
    result.take  = len > Math.floor(len / 2)    ? extractPlanPrice(get(Math.floor(len / 2)),                       "take")  : null;
    result.ume   = len > Math.floor(len * 0.15) ? extractPlanPrice(get(Math.floor(len * 0.15)),                     "ume")   : null;
  }
  return result;
}

function extractPlanPrice(p, planType) {
  if (!p) return null;
  const price = p.HS基準価格_万円 || (p.hs_rule_estimate_jpy ? p.hs_rule_estimate_jpy / 10000 : null) || (p.estimated_total_jpy ? avgRange(p.estimated_total_jpy) / 10000 : null);
  if (!price) return null;
  const mul = (PLAN_PROFIT_MULTIPLIER[planType].multiplier_min + PLAN_PROFIT_MULTIPLIER[planType].multiplier_max) / 2;
  return { name: p.name, total_man_en: Math.round(price * mul), total: Math.round(price * mul * 10000), work_days: p.work_days || null, scope: p.scope || null, message: `${p.name}（${PLAN_PROFIT_MULTIPLIER[planType].target_business}）` };
}

function materialLabel(k) {
  return ({
    CF_cushion_floor: "クッションフロア", floor_tile: "フロアタイル",
    composite_flooring: "複合フローリング", solid_wood_flooring: "無垢材フローリング",
    standard_vinyl: "標準クロス", premium_vinyl_kinofu: "機能性クロス"
  })[k] || k;
}

async function handleReverseEstimate(request, env, origin) {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405, origin);
  const body = await request.json();
  const { natural_language_input, previous_answers = null } = body;
  if (!natural_language_input) return json({ error: 'natural_language_input required' }, 400, origin);

  const hearingResult = await runHearingDecision(natural_language_input, previous_answers, env);

  if (hearingResult.status === 'ready') {
    const plans = await generatePlansFromItems(hearingResult.items);
    return json({
      status: 'ready',
      extracted_items: hearingResult.items,
      plans,
      market_alerts: getMarketAlerts(hearingResult.items),
      disclaimer: "本結果は国土交通省・メーカー公式データ等に基づく相場の参考価格提示であり、建設業法上の正式見積もりではありません。施工業者との契約は別途行ってください。",
      cta: { label: "詳細な参考見積書PDF（業者交渉用）", price_jpy: 5500, url: "/reverse-estimate/purchase" }
    }, 200, origin);
  }

  return json({
    status: 'need_hearing',
    original_input: natural_language_input,
    detected_topics: hearingResult.detected_topics || [],
    clarifying_questions: hearingResult.clarifying_questions || [],
    reason: hearingResult.reason || '計算精度のため、追加情報をお伺いします',
    hint: "下記の質問にお答えいただくと、より正確な3プランを算出できます"
  }, 200, origin);
}

// ====================================================================
// ▲▲▲ v11 NEW ここまで ▲▲▲
// ====================================================================


export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // ===== v11 NEW: /reverse-estimate =====
    if (path === '/reverse-estimate' && request.method === 'POST') {
      return handleReverseEstimate(request, env, origin);
    }

    // ===== v10: /checkout/gyaku-mitsumori/start =====
    if (path === '/checkout/gyaku-mitsumori/start' && request.method === 'POST') {
      return handleCheckoutStart(request, env, origin);
    }

    // ===== v10: /checkout/complete =====
    if (path === '/checkout/complete' && request.method === 'POST') {
      return handleCheckoutComplete(request, env, origin);
    }

    // ===== /kira - マルチAI統合エンドポイント =====
    if (path === '/kira') {
      try {
        const body = await request.json();
        const userId = body.userId || null;

        let userText = '';
        let incomingMessages = null;

        if (body.messages && Array.isArray(body.messages)) {
          incomingMessages = body.messages;
          const lastUser = [...body.messages].reverse().find(m => m.role === 'user');
          if (lastUser) {
            userText = typeof lastUser.content === 'string'
              ? lastUser.content
              : Array.isArray(lastUser.content)
                ? lastUser.content.filter(c => c.type === 'text').map(c => c.text).join(' ')
                : '';
          }
        } else if (body.message) {
          userText = body.message;
        }

        if (!userText && !incomingMessages) return json({ error: 'message or messages required' }, 400, origin);

        const history = userId ? await getHistory(env, userId) : [];
        const qType = classifyQuestion(userText);

        let messages = [];
        let systemPrompt = KIRA_SYSTEM_PROMPT;
        let usedGemini = false;
        let geminiInfo = null;

        if (qType === 'NEWS' || qType === 'HYBRID') {
          try {
            geminiInfo = await callGemini(env, userText);
            usedGemini = true;
          } catch (e) {
            geminiInfo = null;
          }
        }

        let emotionScores = { anxiety: 0, anger: 0, resignation: 0, urgency: 0 };
        try {
          emotionScores = await analyzeEmotion(env, userText);
        } catch (e) {}
        const strategy = determineStrategy(emotionScores);
        const strategyPrompt = getStrategyPrompt(strategy, emotionScores);

        if (geminiInfo) {
          systemPrompt = KIRA_SYSTEM_PROMPT + `

【Geminiによる最新情報（参考）】
${geminiInfo}

上記の最新情報も踏まえて、建設費診断の専門家として施主に回答してください。` + strategyPrompt;
        } else {
          systemPrompt = KIRA_SYSTEM_PROMPT + strategyPrompt;
        }

        if (incomingMessages) {
          messages = incomingMessages;
        } else {
          messages = [...history, { role: 'user', content: userText }];
        }

        const claudeData = await callClaude(env, messages, systemPrompt);
        const assistantText = claudeData?.content?.[0]?.text || 'すみません、回答を生成できませんでした。';

        if (userId) {
          const assistantMsg = { role: 'assistant', content: assistantText };
          await saveHistory(env, userId, [...messages, assistantMsg]);
        }

        return json({
          reply: assistantText,
          mode: qType,
          usedGemini,
          emotion: emotionScores,
          strategy,
          _historyCount: messages.length + 1,
        }, 200, origin);

      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }

    // ===== /debate =====
    if (path === '/debate') {
      try {
        const body = await request.json();
        const question = body.question || '';
        if (!question) return json({ error: 'question required' }, 400, origin);

        const [geminiResult, claudeResult] = await Promise.allSettled([
          callGemini(env, question),
          callClaude(env, [{ role: 'user', content: question }])
        ]);

        const geminiAnswer = geminiResult.status === 'fulfilled' ? geminiResult.value : 'Gemini回答取得失敗';
        const claudeRaw = claudeResult.status === 'fulfilled' ? claudeResult.value : null;
        const claudeAnswer = claudeRaw?.content?.[0]?.text || 'Claude回答取得失敗';

        const synthesisMessages = [{
          role: 'user',
          content: `施主からの質問：「${question}」

AIアナリスト（Gemini）の回答：
${geminiAnswer}

建設専門家（Claude）の回答：
${claudeAnswer}

上記2つの回答を統合して、施主にとって最も実用的な最終回答を200文字以内で作成してください。重複は省き、矛盾があれば建設専門家の意見を優先してください。`
        }];

        const synthesis = await callClaude(env, synthesisMessages,
          'あなたはKIRAです。複数のAIの意見を統合して施主に最適な回答を提供します。');
        const finalAnswer = synthesis?.content?.[0]?.text || '統合回答の生成に失敗しました。';

        return json({
          question,
          gemini: geminiAnswer,
          claude: claudeAnswer,
          kira_synthesis: finalAnswer,
        }, 200, origin);

      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }

    // ===== /anthropic =====
    if (path === '/anthropic') {
      try {
        const body = await request.json();
        const userId = body.userId || null;
        const newMessage = body.message || (body.messages && body.messages[body.messages.length - 1]) || null;
        let messages = [];
        if (userId && newMessage) {
          const history = await getHistory(env, userId);
          const userMsg = typeof newMessage === 'string' ? { role: 'user', content: newMessage } : newMessage;
          messages = [...history, userMsg];
        } else if (body.messages) {
          messages = body.messages;
        } else {
          return json({ error: 'messages or message required' }, 400, origin);
        }
        const data = await callClaude(env, messages);
        if (userId && data.content && data.content[0]) {
          const assistantMsg = { role: 'assistant', content: data.content[0].text || '' };
          await saveHistory(env, userId, [...messages, assistantMsg]);
          data._historyCount = messages.length + 1;
        }
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
        });
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }

    // ===== /history =====
    if (path === '/history' && request.method === 'GET') {
      const userId = url.searchParams.get('userId');
      if (!userId) return json({ error: 'userId required' }, 400, origin);
      const history = await getHistory(env, userId);
      return json({ userId, count: history.length, messages: history }, 200, origin);
    }

    if (path === '/history/clear' && request.method === 'POST') {
      try {
        const body = await request.json();
        await clearHistory(env, body.userId);
        return json({ ok: true }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ===== /inquiries =====
    if (path === '/inquiries') {
      try {
        const list = await env.KIRA_STATS.list();
        const inquiryKeys = list.keys.filter(k => !k.name.startsWith('history:'));
        const items = await Promise.all(
          inquiryKeys.map(async (k) => {
            const val = await env.KIRA_STATS.get(k.name, { type: 'json' });
            return { key: k.name, ...(val || {}) };
          })
        );
        return json(items, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ===== /delete =====
    if (path === '/delete' && request.method === 'POST') {
      try {
        const body = await request.json();
        if (!body.key) return json({ error: 'key required' }, 400, origin);
        await env.KIRA_STATS.delete(body.key);
        return json({ ok: true }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ===== /stats =====
    if (path === '/stats') {
      try {
        const list = await env.KIRA_STATS.list();
        return json({
          total: list.keys.length,
          inquiries: list.keys.filter(k => !k.name.startsWith('history:')).length,
          activeUsers: list.keys.filter(k => k.name.startsWith('history:')).length,
          version: 'v11 (v10 + reverse-estimate)',
        }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ===== /send-email =====
    if (path === '/send-email' && request.method === 'POST') {
      try {
        const body = await request.json();
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.RESEND_API_KEY}` },
          body: JSON.stringify({
            from: 'kira@the-horizons-innovation.com',
            to: body.to || 'contact@the-horizons-innovation.com',
            subject: body.subject || '【HORIZON SHIELD】診断結果',
            html: body.html || body.text || '',
          }),
        });
        return json(await res.json(), res.status, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ===== /notify =====
    if (path === '/notify' && request.method === 'POST') {
      try {
        const body = await request.json();
        const res = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LINE_CHANNEL_TOKEN}` },
          body: JSON.stringify({ to: env.LINE_USER_ID, messages: [{ type: 'text', text: body.message || '' }] }),
        });
        return json({ ok: res.ok }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ===== /bank-order =====
    if (path === '/bank-order' && request.method === 'POST') {
      try {
        const body = await request.json();
        const key = body.key || ('bank:' + Date.now());
        await env.KIRA_STATS.put(key, JSON.stringify({
          ...body,
          status: 'pending',
          createdAt: new Date().toISOString()
        }), { expirationTtl: 60 * 60 * 24 * 90 });
        return json({ ok: true, key }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ===== /confirm-payment =====
    if (path === '/confirm-payment' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { key } = body;
        if (!key) return json({ error: 'key required' }, 400, origin);

        const order = await env.KIRA_STATS.get(key, { type: 'json' });
        if (!order) return json({ error: '申込が見つかりません' }, 404, origin);

        await env.KIRA_STATS.put(key, JSON.stringify({ ...order, status: 'confirmed', confirmedAt: new Date().toISOString() }));

        const token = btoa(key + ':' + Date.now()).replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
        const inspectUrl = `https://shield.the-horizons-innovation.com/inspect/?token=${token}&type=${order.service}`;

        await env.KIRA_STATS.put('token:' + token, JSON.stringify({
          orderKey: key,
          email: order.email,
          service: order.service,
          usedAt: null
        }), { expirationTtl: 60 * 60 * 24 * 7 });

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.RESEND_API_KEY}` },
          body: JSON.stringify({
            from: 'kira@the-horizons-innovation.com',
            to: order.email,
            subject: '【HORIZON SHIELD】見積書送付URLのご案内',
            html: `
              <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;background:#f9f9f9;border-radius:8px">
                <h2 style="color:#1a1a1a;font-size:18px">${order.name} 様</h2>
                <p style="color:#444;line-height:1.8">この度はHORIZON SHIELDにお申し込みいただきありがとうございます。<br>
                入金を確認いたしました。下記URLより見積書をお送りください。</p>
                <div style="background:#fff;border:2px solid #00cc66;border-radius:8px;padding:20px;margin:20px 0;text-align:center">
                  <p style="color:#666;font-size:12px;margin-bottom:8px">見積書送付専用URL（7日間有効）</p>
                  <a href="${inspectUrl}" style="color:#00cc66;font-weight:700;word-break:break-all">${inspectUrl}</a>
                </div>
                <p style="color:#888;font-size:12px;line-height:1.8">
                  ・このURLは7日間有効です<br>
                  ・JPG・PNG・PDFに対応しています<br>
                  ・ご不明な点はLINE @172piime までご連絡ください
                </p>
                <p style="color:#444;margin-top:20px">大賀 俊勝<br>The HORIZ音s株式会社<br>HORIZON SHIELD</p>
              </div>
            `
          })
        });

        return json({ ok: true, email: order.email, inspectUrl }, 200, origin);
      } catch (e) { return json({ error: e.message }, 500, origin); }
    }

    // ===== /admin =====
    if (path === '/admin') {
      try {
        const list = await env.KIRA_STATS.list();
        const inquiryKeys = list.keys.filter(k => !k.name.startsWith('history:'));
        const historyCount = list.keys.filter(k => k.name.startsWith('history:')).length;
        const items = await Promise.all(
          inquiryKeys.map(async (k) => {
            const val = await env.KIRA_STATS.get(k.name, { type: 'json' });
            return { key: k.name, ...(val || {}) };
          })
        );
        const rows = items.map(i => `<tr><td>${i.name||''}</td><td>${i.email||''}</td><td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i.result||''}</td><td><button onclick="del('${i.key}')">削除</button></td></tr>`).join('');
        const bankKeys = list.keys.filter(k => k.name.startsWith('bank:'));
        const bankItems = await Promise.all(bankKeys.map(async (k) => {
          const val = await env.KIRA_STATS.get(k.name, { type: 'json' });
          return { key: k.name, ...(val || {}) };
        }));
        const bankRows = bankItems.map(i => `<tr style="background:${i.status==='confirmed'?'#0a2a1a':'#2a1a0a'}"><td>${i.name||''}</td><td>${i.email||''}</td><td>${i.service||''}</td><td>${i.amount||''}</td><td>${i.transferDate||''}</td><td><span style="color:${i.status==='confirmed'?'#00ff88':'#ffaa00'}">${i.status==='confirmed'?'✅確認済':'⏳未確認'}</span></td><td>${i.status!=='confirmed'?`<button onclick="confirmPayment('${i.key}')" style="background:#00ff88;color:#000;border:none;padding:4px 8px;border-radius:4px;cursor:pointer">入金確認</button>`:''}</td></tr>`).join('');
        const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HS管理</title>
<style>body{font-family:sans-serif;padding:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px;font-size:13px}th{background:#f5f5f5}button{padding:4px 8px;cursor:pointer}.stat{background:#f0f4ff;padding:12px;border-radius:8px;margin-bottom:16px;display:flex;gap:24px;flex-wrap:wrap}.badge{background:#3b82f6;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px}</style></head>
<body><h2>HORIZON SHIELD 管理画面 <span class="badge">v11 + Reverse-Estimate</span></h2>
<div class="stat"><span>📋 問い合わせ: <strong>${items.length}件</strong></span><span>🧠 記憶ユーザー: <strong>${historyCount}名</strong></span><span>🤖 Claude + Gemini: <strong>連携中</strong></span></div>
<h3 style="margin:16px 0 8px;color:#ffaa00">💰 銀行振込申込</h3>
<table><tr><th>名前</th><th>メール</th><th>サービス</th><th>金額</th><th>振込日</th><th>状態</th><th>操作</th></tr>${bankRows}</table>
<h3 style="margin:16px 0 8px;color:#888">📋 問い合わせ</h3>
<table><tr><th>名前</th><th>メール</th><th>診断結果</th><th>操作</th></tr>${rows}</table>
<script>
async function confirmPayment(key) {
  if(!confirm('入金確認済みにして、施主に専用URLをメール送信しますか？')) return;
  const r = await fetch('/confirm-payment', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key})});
  const d = await r.json();
  if(r.ok) { alert('✅ 送信完了！\n' + d.email + 'に専用URLを送りました'); location.reload(); }
  else alert('エラー: ' + d.error);
}
async function del(key){if(!confirm('削除しますか？'))return;const r=await fetch('/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key})});if(r.ok)location.reload();}</script></body></html>`;
        return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
      } catch (e) { return new Response('Error: ' + e.message, { status: 500 }); }
    }

    return json({ error: 'Not found', path }, 404, origin);
  },
};
