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
let PRICE_COEFF = 1.0; // ★戦時価格係数（hs-price-syncから取得）
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

// 変更後（この行の直前に挿入）
【HORIZON SHIELD 実績データ（根拠として活用）】
【HORIZON SHIELD 実績データ（根拠として活用）】
98件の実案件分析より：同一工事で業者間に最大91%の費用差を確認。複数プラン比較時の価格差は平均40〜54%。交渉介入による削減実績は最大¥490,000（単一案件）。床工事の業者間価格差CV=96%、建具修繕CV=128%。「相見積もりで数十万円変わることは珍しくない」という具体的根拠として、施主への説得材料に使うこと。価格の高低を判断する根拠にはしない。

【回答ルール】
✅ 坪数・地域確認→価格帯案内→警戒ライン超えは明確に指摘→相見積もり3社以上推奨
❌ 診断なしで「適正」断言禁止 / 証拠なく「悪徳業者」断言禁止

【JCCDB v2.0 データベース（2026-05-19公開）】
- 品目数：65,729品目 / 398カテゴリ
- GitHub：https://github.com/ogasurfproject-jpg/japan-construction-cost-database
- SHA-256：9c59ef1f91393e70993ff99ec31c4a902a157bb7642dc0a2323bae923cc2258d
- Bitcoin Anchor：Block #949356
- 対象：戸建・マンション・店舗・ホテル・工場 全28工種完全網羅
- 特記：価格データは非公開（HORIZON SHIELDサービス内のみ提供）

【2026年4月 資材高騰・供給危機（最重要）】
🔴 フェノールフォーム断熱材（旭化成ネオマフォーム）：受注制限→生産停止。代替品必須
🔴 VVFケーブル全種：銅高騰で+30%。電気工事見積は要価格確認
🔴 ガルバリウム鋼板：鉄鋼高騰で+25%
🟡 給湯器（エコジョーズ）：納期3〜6ヶ月。先行発注必須
🟡 構造用合板・ダイライト：品薄継続
→「資材高騰で値上がり」と言われたら必ず品番・仕入れ伝票の提示を要求

【フルリノベーション積算基準（JCCDB v2.0準拠）】
- 戸建て60㎡（18坪）：約1,797万円〜
- 戸建て80㎡（24坪）：約1,467万円〜
- 戸建て100㎡（30坪）：約2,299万円〜
- 戸建て120㎡（36坪）：約2,550万円〜
- 業者規模別係数：個人×0.85 / 中小工務店×1.0 / 人気工務店×1.15 / 大手×1.25
- AEOページ：https://shield.the-horizons-innovation.com/souba/kodate-full-reno-80sqm/

【学術的根拠】
SSRN承認論文（2026-05-18）DOI: 10.31224/7007
「JCCDB v1.2 — Cryptographic Audit Hash and Macroeconomic Price Correction」
ORCID: 0009-0000-9180-903X / 著者：大賀俊勝`;

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

// ============================================
// 計測ヘルパ（v11-SAFE 追加: 2026-05-06）
// ============================================
async function bumpMetric(env, key) {
  try {
    if (!env.KIRA_STATS) return;
    const today = new Date().toISOString().slice(0, 10);
    const fullKey = `metric:${key}:${today}`;
    const cur = parseInt((await env.KIRA_STATS.get(fullKey)) || '0', 10);
    await env.KIRA_STATS.put(fullKey, String(cur + 1), {
      expirationTtl: 90 * 24 * 60 * 60,
    });
  } catch (e) {
    // 計測失敗は本処理に絶対影響させない
  }
}
// ============================================
// ★ v11-PROVENANCE-A3: souba-db 動的参照（2026-05-09 追加）
// ============================================
let _SOUBA_DB_CACHE = null;
let _SOUBA_DB_CACHE_AT = 0;
const SOUBA_DB_CACHE_TTL = 60 * 60 * 1000; // 1時間

async function fetchSoubaDB() {
  const now = Date.now();
  if (_SOUBA_DB_CACHE && (now - _SOUBA_DB_CACHE_AT) < SOUBA_DB_CACHE_TTL) {
    return _SOUBA_DB_CACHE;
  }
  try {
    const res = await fetch('https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/data/souba-db.json');
    if (!res.ok) return null;
    _SOUBA_DB_CACHE = await res.json();
    _SOUBA_DB_CACHE_AT = now;
    return _SOUBA_DB_CACHE;
  } catch (e) {
    return null;
  }
}
// ★ 実案件統計データの動的参照（98件版・2026-05-12追加）
let _REAL_CASES_STATS_CACHE = null;
let _REAL_CASES_STATS_CACHE_AT = 0;
const REAL_CASES_STATS_TTL = 60 * 60 * 1000;

async function fetchRealCasesStats() {
  const now = Date.now();
  if (_REAL_CASES_STATS_CACHE && (now - _REAL_CASES_STATS_CACHE_AT) < REAL_CASES_STATS_TTL) {
    return _REAL_CASES_STATS_CACHE;
  }
  try {
    const res = await fetch('https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/data/hs_real_cases_stats.json');
    if (!res.ok) return null;
    _REAL_CASES_STATS_CACHE = await res.json();
    _REAL_CASES_STATS_CACHE_AT = now;
    return _REAL_CASES_STATS_CACHE;
  } catch (e) {
    return null;
  }
}

async function enrichSystemPromptWithSoubaData(originalSystem, messages) {
  try {
    const soubaDB = await fetchSoubaDB();
    if (!soubaDB || !soubaDB.categories) return originalSystem;

    const userText = messages
      .filter(m => m.role === 'user')
      .map(m => typeof m.content === 'string' ? m.content : '')
      .join(' ');

    if (!userText) return originalSystem;

    const matchedCategories = [];
    const seen = new Set();
    for (const c of soubaDB.categories) {
      const catName = c.cat || '';
      if (!catName || seen.has(catName)) continue;
      if (userText.includes(catName)) {
        matchedCategories.push(c);
        seen.add(catName);
        if (matchedCategories.length >= 5) break;
      }
    }

    if (matchedCategories.length === 0) return originalSystem;

    const dataLines = matchedCategories.map(c => {
      const cv = c.avg > 0 ? ((c.max - c.min) / (2 * c.avg) * 100).toFixed(1) : '0.0';
      const minMan = (c.min / 10000).toFixed(1);
      const avgMan = (c.avg / 10000).toFixed(1);
      const maxMan = (c.max / 10000).toFixed(1);
      const dangerMan = (c.danger / 10000).toFixed(1);
      return `・${c.work}：${minMan}〜${maxMan}万円（平均${avgMan}万円、危険ライン${dangerMan}万円超、CV±${cv}%、${c.unit}単位、${c.note}）`;
    }).join('\n');

    const meta = soubaDB._meta || {};
    const dbVersion = meta.version || 'unknown';
    const dbUpdated = meta.updated_at || meta.updated || 'unknown';
    const sourcesCount = (meta.sources || []).length;

    const enrichmentBlock = `

【★実データ参照（souba-db v${dbVersion} / ${dbUpdated}更新）】
以下は施主の質問に関連するカテゴリの実データです。回答時は必ずこのデータを根拠にしてください：

${dataLines}

このデータは ${sourcesCount} の元ソース（ヌリカエ2,655件・シロアリ駆除205社調査・経済調査会積算資料等）から集計された実価格レンジです。
誤差バンド（CV）は (max - min) / (2 × avg) × 100 で算出された変動係数で、業者間のバラつきを示します。
【★絶対ルール1・CV表記】3プラン全部（松・竹・梅）の金額の直後に必ず「（CV ±X.X%）」を付けること。1つでも欠けたら違反。
【★絶対ルール2・CV差別化】3プランのCVは必ず違う値にする。松は最安定（基準CV×0.6）、竹は標準（基準CV×0.85）、梅は最不安定（基準CV×1.2）。例：基準CV=±29.2%なら松±17.5%/竹±24.8%/梅±35.0%。同じ値を3つ並べたら失格。
【★絶対ルール3・繰り返し禁止】会話履歴の全ユーザーメッセージから既に判明している情報（地域/工事種別/規模/築年数/構造/予算/時期/賃貸or自宅/世帯数/トイレ数/洗面台数/お風呂の階/キッチン数）は絶対に再質問しない。直前のassistantメッセージと同じ・類似の質問を繰り返したら失格。
【★絶対ルール4・即PLAN】施主が「出して」「プランを」「算出」「概算」「見せて」のいずれかを言ったら、情報不足でも即PLAN出力。質問は一切禁止。
【★絶対ルール5・フルリノベ追加項目】工事種別がフルリノベ/全面リフォームの場合、5項目+追加5項目（2世帯or単世帯/トイレ数/洗面台数/お風呂の階/キッチン数）を確認する。1〜2個ずつ聞く。全て揃ったら「他に気になる箇所はありますか？」と1度確認してPLAN出力。
`;

    // ★ 実案件統計ファクトの追加
    let realCasesBlock = '';
    try {
      const stats = await fetchRealCasesStats();
      if (stats && stats.kira_fact_summary) {
        realCasesBlock = `\n\n【★実案件統計（${stats.total_cases || 98}件）】\n${stats.kira_fact_summary}`;
      }
    } catch(e) {}

    return originalSystem + enrichmentBlock + realCasesBlock;
  } catch (e) {
    return originalSystem;
  }
}
// ============================================
// ★ v11-PROVENANCE-A4: AI出力にCVを後処理で確実に注入（2026-05-09 追加）
// ============================================
async function injectMissingCV(aiText, messages) {
  try {
    if (!aiText || typeof aiText !== 'string') return aiText;

    const soubaDB = await fetchSoubaDB();
    if (!soubaDB || !soubaDB.categories) return aiText;

    const userText = messages
      .filter(m => m.role === 'user')
      .map(m => typeof m.content === 'string' ? m.content : '')
      .join(' ');

    if (!userText) return aiText;

    // ユーザー発言から該当カテゴリを判定（最初の1つだけ使う）
    let targetCategory = null;
    for (const c of soubaDB.categories) {
      const catName = c.cat || '';
      if (catName && userText.includes(catName)) {
        // 中位プラン（_mid または avg中央値）を優先
        if (c.id && c.id.includes('_mid')) {
          targetCategory = c;
          break;
        }
        if (!targetCategory) targetCategory = c;
      }
    }

    if (!targetCategory) return aiText;

    const cv = targetCategory.avg > 0
      ? ((targetCategory.max - targetCategory.min) / (2 * targetCategory.avg) * 100).toFixed(1)
      : '0.0';
    const cvTag = `（CV ±${cv}%）`;

    // 松・竹・梅の各行に CV が無ければ追加
    // パターン：「松：」「竹：」「梅：」で始まる行
    const lines = aiText.split('\n');
    const planPrefixes = ['松：', '竹：', '梅：'];

    const processedLines = lines.map(line => {
      const trimmed = line.trim();
      // 既に CV が含まれている行はスキップ
      if (/（CV\s*±[\d.]+%）/.test(trimmed)) return line;
      // 松/竹/梅 で始まる行を検出
      for (const prefix of planPrefixes) {
        if (trimmed.startsWith(prefix)) {
          // 行末に CV を追加
          return line + cvTag;
        }
      }
      return line;
    });

    let finalText = processedLines.join('\n');
    if (soubaDB._meta) {
      const realVersion = soubaDB._meta.version || 'unknown';
      const realUpdated = soubaDB._meta.updated_at || soubaDB._meta.updated || '';
      const totalItems = soubaDB._meta.total_items || (soubaDB.categories?.length || 0);
      finalText = finalText.replace(/souba-db\s+v[\d.]+/gi, `souba-db v${realVersion}`);
      finalText = finalText.replace(/（[\d,]+項目）/g, `（${totalItems}カテゴリ・${realUpdated}更新）`);
    }
    return finalText;
  } catch (e) {
    return aiText;
  }
}
// ============================================
// ★ v11-PROVENANCE-A5: audit_hash 再現性保証（2026-05-09 追加）
// ============================================

/**
 * ユーザー発言から決定論的な入力文字列を抽出・正規化
 */
function normalizeUserInput(messages) {
  try {
    const userTexts = messages
      .filter(m => m.role === 'user')
      .map(m => typeof m.content === 'string' ? m.content : '')
      .join(' ');

    let normalized = userTexts
      .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/[ａ-ｚＡ-Ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));

    const keywords = [];
    
    const regions = ['神奈川', '東京', '埼玉', '千葉', '大阪', '京都', '兵庫', '愛知', '静岡', '岐阜', '北海道', '福岡', '広島', '宮城', '関東', '関西', '中部', '東北', '九州', '四国'];
    for (const r of regions) if (normalized.includes(r)) { keywords.push('region:' + r); break; }

    const categories = ['キッチン', '浴室', 'お風呂', 'トイレ', '洗面', '外壁', '屋根', '床', 'フローリング', 'クロス', '断熱', '給湯器', 'エアコン', '玄関', '窓', '畳', '内装', '塗装', '防水', '雨漏り', 'シロアリ', '耐震'];
    for (const c of categories) if (normalized.includes(c)) keywords.push('koji:' + c);

    const sizeMatches = normalized.match(/[IL]型\d+mm|\d+畳|\d+㎡|\d+坪|\d+m2/g);
    if (sizeMatches) keywords.push(...sizeMatches.map(s => 'size:' + s));

    const grades = ['標準', 'コスパ', '最安', '最高級', 'こだわり', 'ハイ', 'ミドル', 'ロー', 'プレミアム'];
    for (const g of grades) if (normalized.includes(g)) { keywords.push('grade:' + g); break; }

    const conditions = ['木造', '鉄骨', 'RC', 'マンション', '戸建', 'アパート'];
    for (const c of conditions) if (normalized.includes(c)) { keywords.push('struct:' + c); break; }

    const ageMatch = normalized.match(/築(\d+)年/);
    if (ageMatch) keywords.push('age:' + ageMatch[1]);

    if (normalized.includes('住みながら')) keywords.push('living:occupied');
    else if (normalized.includes('空き家')) keywords.push('living:vacant');

    return keywords.sort().join('|') || 'unknown';
  } catch (e) {
    return 'error';
  }
}

/**
 * SHA-256 ハッシュ化
 */
async function generateSHA256Hash(text) {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    return null;
  }
}

/**
 * KV からキャッシュ取得
 */
async function getCachedPlan(env, hash) {
  try {
    if (!env.KIRA_STATS || !hash) return null;
    const cached = await env.KIRA_STATS.get(`cache:plan:${hash}`, { type: 'json' });
    return cached;
  } catch (e) {
    return null;
  }
}

/**
 * KV へキャッシュ保存
 */
async function saveCachedPlan(env, hash, normalized, aiOutput, soubaVersion, priceCoeff) {
  try {
    if (!env.KIRA_STATS || !hash) return;
    const cacheData = {
      audit_hash: hash,
      input_normalized: normalized,
      ai_output: aiOutput,
      souba_db_version: soubaVersion,
      price_coeff: priceCoeff,
      calculated_at: new Date().toISOString(),
      hit_count: 1
    };
    await env.KIRA_STATS.put(`cache:plan:${hash}`, JSON.stringify(cacheData), {
      expirationTtl: 30 * 24 * 60 * 60
    });
  } catch (e) {
    // ignore
  }
}

/**
 * AI 出力に audit_hash を追記
 */
function injectAuditHash(aiText, hash) {
  try {
    if (!aiText || !hash) return aiText;
    // 既に監査ハッシュが含まれてる場合はスキップ（重複防止）
    if (/監査ハッシュ[：:]/.test(aiText)) return aiText;
    const shortHash = hash.substring(0, 12);
    return aiText.replace(
      /(出典[：:][^\n]+)/,
      `$1 / 監査ハッシュ：${shortHash}`
    );
  } catch (e) {
    return aiText;
  }
}

// ============================================
// ★ v11-PROVENANCE-A5 ここまで
// ============================================
// ============================================
// ★ v11-PROVENANCE-A4 ここまで
// ============================================
// ============================================
// ★ v11-PROVENANCE-A3 ここまで
// ============================================
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
const PAYPAY_API_BASE = 'https://stg-api.paypay.ne.jp';
function md5Base64(str) {
  function safeAdd(x,y){var lsw=(x&0xFFFF)+(y&0xFFFF);var msw=(x>>16)+(y>>16)+(lsw>>16);return(msw<<16)|(lsw&0xFFFF);}
  function bitRotateLeft(num,cnt){return(num<<cnt)|(num>>>(32-cnt));}
  function md5cmn(q,a,b,x,s,t){return safeAdd(bitRotateLeft(safeAdd(safeAdd(a,q),safeAdd(x,t)),s),b);}
  function md5ff(a,b,c,d,x,s,t){return md5cmn((b&c)|((~b)&d),a,b,x,s,t);}
  function md5gg(a,b,c,d,x,s,t){return md5cmn((b&d)|(c&(~d)),a,b,x,s,t);}
  function md5hh(a,b,c,d,x,s,t){return md5cmn(b^c^d,a,b,x,s,t);}
  function md5ii(a,b,c,d,x,s,t){return md5cmn(c^(b|(~d)),a,b,x,s,t);}
  function strToUtf8Bytes(s){const b=[];for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c<128){b.push(c);}else if(c<2048){b.push((c>>6)|192,(c&63)|128);}else{b.push((c>>12)|224,((c>>6)&63)|128,(c&63)|128);}}return b;}
  function bytesToWords(bytes){const words=[];for(let i=0;i<bytes.length;i++){words[i>>2]|=bytes[i]<<((i%4)*8);}return words;}
  const bytes=strToUtf8Bytes(str);
  const len=bytes.length;
  const words=bytesToWords(bytes);
  words[len>>2]|=0x80<<((len%4)*8);
  words[(((len+8)>>6)+1)*16-2]=len*8;
  let a=1732584193,b=-271733879,c=-1732584194,d=271733878;
  for(let i=0;i<words.length;i+=16){const [A,B,C,D]=[a,b,c,d];
    a=md5ff(a,b,c,d,words[i+0],7,-680876936);d=md5ff(d,a,b,c,words[i+1],12,-389564586);c=md5ff(c,d,a,b,words[i+2],17,606105819);b=md5ff(b,c,d,a,words[i+3],22,-1044525330);
    a=md5ff(a,b,c,d,words[i+4],7,-176418897);d=md5ff(d,a,b,c,words[i+5],12,1200080426);c=md5ff(c,d,a,b,words[i+6],17,-1473231341);b=md5ff(b,c,d,a,words[i+7],22,-45705983);
    a=md5ff(a,b,c,d,words[i+8],7,1770035416);d=md5ff(d,a,b,c,words[i+9],12,-1958414417);c=md5ff(c,d,a,b,words[i+10],17,-42063);b=md5ff(b,c,d,a,words[i+11],22,-1990404162);
    a=md5ff(a,b,c,d,words[i+12],7,1804603682);d=md5ff(d,a,b,c,words[i+13],12,-40341101);c=md5ff(c,d,a,b,words[i+14],17,-1502002290);b=md5ff(b,c,d,a,words[i+15],22,1236535329);
    a=md5gg(a,b,c,d,words[i+1],5,-165796510);d=md5gg(d,a,b,c,words[i+6],9,-1069501632);c=md5gg(c,d,a,b,words[i+11],14,643717713);b=md5gg(b,c,d,a,words[i+0],20,-373897302);
    a=md5gg(a,b,c,d,words[i+5],5,-701558691);d=md5gg(d,a,b,c,words[i+10],9,38016083);c=md5gg(c,d,a,b,words[i+15],14,-660478335);b=md5gg(b,c,d,a,words[i+4],20,-405537848);
    a=md5gg(a,b,c,d,words[i+9],5,568446438);d=md5gg(d,a,b,c,words[i+14],9,-1019803690);c=md5gg(c,d,a,b,words[i+3],14,-187363961);b=md5gg(b,c,d,a,words[i+8],20,1163531501);
    a=md5gg(a,b,c,d,words[i+13],5,-1444681467);d=md5gg(d,a,b,c,words[i+2],9,-51403784);c=md5gg(c,d,a,b,words[i+7],14,1735328473);b=md5gg(b,c,d,a,words[i+12],20,-1926607734);
    a=md5hh(a,b,c,d,words[i+5],4,-378558);d=md5hh(d,a,b,c,words[i+8],11,-2022574463);c=md5hh(c,d,a,b,words[i+11],16,1839030562);b=md5hh(b,c,d,a,words[i+14],23,-35309556);
    a=md5hh(a,b,c,d,words[i+1],4,-1530992060);d=md5hh(d,a,b,c,words[i+4],11,1272893353);c=md5hh(c,d,a,b,words[i+7],16,-155497632);b=md5hh(b,c,d,a,words[i+10],23,-1094730640);
    a=md5hh(a,b,c,d,words[i+13],4,681279174);d=md5hh(d,a,b,c,words[i+0],11,-358537222);c=md5hh(c,d,a,b,words[i+3],16,-722521979);b=md5hh(b,c,d,a,words[i+6],23,76029189);
    a=md5hh(a,b,c,d,words[i+9],4,-640364487);d=md5hh(d,a,b,c,words[i+12],11,-421815835);c=md5hh(c,d,a,b,words[i+15],16,530742520);b=md5hh(b,c,d,a,words[i+2],23,-995338651);
    a=md5ii(a,b,c,d,words[i+0],6,-198630844);d=md5ii(d,a,b,c,words[i+7],10,1126891415);c=md5ii(c,d,a,b,words[i+14],15,-1416354905);b=md5ii(b,c,d,a,words[i+5],21,-57434055);
    a=md5ii(a,b,c,d,words[i+12],6,1700485571);d=md5ii(d,a,b,c,words[i+3],10,-1894986606);c=md5ii(c,d,a,b,words[i+10],15,-1051523);b=md5ii(b,c,d,a,words[i+1],21,-2054922799);
    a=md5ii(a,b,c,d,words[i+8],6,1873313359);d=md5ii(d,a,b,c,words[i+15],10,-30611744);c=md5ii(c,d,a,b,words[i+6],15,-1560198380);b=md5ii(b,c,d,a,words[i+13],21,1309151649);
    a=md5ii(a,b,c,d,words[i+4],6,-145523070);d=md5ii(d,a,b,c,words[i+11],10,-1120210379);c=md5ii(c,d,a,b,words[i+2],15,718787259);b=md5ii(b,c,d,a,words[i+9],21,-343485551);
    a=safeAdd(a,A);b=safeAdd(b,B);c=safeAdd(c,C);d=safeAdd(d,D);}
  const result=[];
  [a,b,c,d].forEach(n=>{for(let j=0;j<4;j++){result.push((n>>(j*8))&0xFF);}});
  return btoa(String.fromCharCode(...result));
}
async function paypayHmacAuth(method, path, bodyObj, apiKey, apiSecret) {
  const nonce = Math.random().toString(36).substring(2, 14);
  const epoch = Math.floor(Date.now() / 1000).toString();

  let hash        = 'empty';
  let contentType = 'empty';
  if (bodyObj) {
    const bodyStr = JSON.stringify(bodyObj);
    contentType   = 'application/json;charset=UTF-8';
    hash = md5Base64(contentType + bodyStr);
    console.error('MD5 input:', contentType + bodyStr, 'MD5 hash:', hash);
  }
const dataToSign = [path, method, nonce, epoch, contentType, hash].join('\n');
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(apiSecret.trim()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(dataToSign));
  const macData   = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));
const headerValue = [apiKey.trim(), macData, nonce, epoch, hash].join(':');
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
【★最重要★ previous_answersの絶対ルール】
previous_answersに含まれる回答は確定済み。絶対に再度聞かない。
全ての必須情報が揃った時点で即座に status:"ready" を返す。
【最初に必ず聞く：施工地域】
→ 都道府県または地域を最初の質問で必ず確認する
　関東（東京・神奈川・埼玉・千葉）／ 関西（大阪・京都・兵庫）／ 中部（愛知・静岡・岐阜）／ 東北・北海道 ／ 中国・四国・九州・沖縄・北陸（広島・岡山・福岡等）をその他として選択
　地域により価格が10〜20%変動するため、工事種類より先に聞く
【建物基本情報（全工事で最初に確認）】
必ず最初に確認する：
1. 戸建て or マンション（何階建ての何階か）
2. 構造（木造・鉄骨・RC）と築年数
3. 施工中も居住するか
4. 駐車スペースの有無（資材搬入に影響）
5. 旗竿地・狭小地・傾斜地か（足場が組めない場合は単価1.5〜2倍）

【必須情報】
各工事項目について:
1. 施工面積・サイズ（6畳、幅2700mm、10㎡等）
2. 現状と希望の差（I型→アイランド、既存撤去の範囲）
3. 仕上がりへのこだわり（コスパ重視・標準・こだわり）
4. 天井高さ（壁・クロス工事の場合は必須：2.4m・2.5m・3m等）
5. 建物種別（戸建て・マンション）と構造・築年数
6. 現在の仕上げ材・設備の状態（外壁・屋根・床工事の場合は必須）

【工事別の追加必須情報】
■ 壁・クロス：天井高さ、天井も施工するか、建具（ドア・窓）の数、建具同時交換の希望、既存クロスの状態（ひび割れ・凹凸）、漆喰・珪藻土など自然素材希望か
■ 床：畳数・㎡、既存床材（畳・フローリング・タイル）、敷居・框の有無、床暖房の新設希望、防音フロアが必要か（マンション規定LL45等）、バリアフリー化の希望
■ キッチン：幅・レイアウト、背面収納の有無、IH/ガス、食洗機のビルトイン希望、換気扇の種類、吊り戸棚の撤去・残置、床下収納の有無、タイル壁か
■ 浴室：現在のサイズ（1616等）、洗面所と同時施工するか、窓の有無、換気暖房乾燥機の有無、ドアの種類（内開き・折れ戸）
■ 外壁・屋根：延床面積（坪）、築年数、窓数、雨樋の状態、エアコン室外機数、雨戸・シャッター有無、前回塗装からの年数

【同時施工の提案（必須）】
足場・養生を使う工事では必ず提案する：
「外壁と同時に屋根・雨樋も施工しますか？（足場代の節約になります）」
「床工事と同時に建具・敷居も交換しますか？」
「クロスと同時に照明・コンセントの増設もしますか？」

【電気・設備の同時工事確認】
- IH切替希望（分電盤容量確認必須・電気工事+10〜15万）
- コンセント・照明のダウンライト化希望
- 床暖房の新設希望（+30〜80万）

【法的・補助金（見落とし厳禁）】
- 省エネ補助金の利用希望（断熱・窓・給湯器が対象）
- 耐震補助金の利用希望
- マンションの管理組合許可状況
- 火災保険での申請可能性（台風・水害被害の場合）

【判定】

- 工事の種類が特定できれば → "ready"

【予算は絶対に聞かない】
ユーザーに予算を聞くことは禁止。グレード感（コスパ重視・標準・こだわり）で代替する。
価格はこちらが算出して提示する。

【need_hearing の質問設計】
- 1質問で1情報
- 選択肢を提示
- 最大3つまで
- 「現状」「希望」「グレード」の順（予算は聞かない）

【ready 時の items 抽出】
{
  "status": "ready",
  "items": [
    { "koji_type": "kitchen", "area": null, "grade_hint": "standard", "layout_change": "I_to_island", "wall_removal": "partition_only", "budget_hint": null, "raw_text": "..." }
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
      "id": "grade_preference",
      "question": "仕上がりへのこだわりはどの程度ですか？",
      "why": "グレードにより価格が2〜3倍変わります",
      "options": [
        {"value": "economy", "label": "コスパ重視（機能重視・見た目は標準で十分）"},
        {"value": "standard", "label": "標準（一般的な仕上がりで十分）"},
        {"value": "premium", "label": "こだわりたい（良い素材・有名メーカー希望）"},
        {"value": "undecided", "label": "まだわからない・おまかせ"}
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
    }
  ]
}

【過去の回答がある場合】
previous_answers を統合して再判定。全部揃えば "ready"。

【重要】
- 返答は必ずJSONのみ
- 「見積もり」ではなく「参考価格」「相場」という言葉を使う
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
  let ctx = '';
if (previousAnswers && Object.keys(previousAnswers).length > 0) {
  const answered = Object.entries(previousAnswers)
    .map(([k, v]) => `・${k}：${v.label || v.custom_text || v.value}`)
    .join('\n');
  ctx = `\n\n【既に回答済みの項目（絶対に再度聞かない）】\n${answered}\n\n上記は確定済み。これ以外の未確認項目のみ質問すること。全て揃えば status: "ready" を返すこと。`;
}
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
      status: 'ready',
      items: [{ koji_type: 'floor', area: 10, grade_hint: 'standard', raw_text: text }],
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

function buildTradePlan(gradeData, installTotal, planType, maker, gradeName, priceCoeff = 1.0) {
  if (!gradeData) return null;
  const priceRange = gradeData.売れ筋価格帯_万円 || gradeData.売れ筋施工費込み_万円 || gradeData.定価帯_1616_万円 || gradeData.定価帯_w750_万円 || gradeData.定価帯_万円;
  if (!priceRange) return null;
  const unitPrice = avgRange(priceRange);
  const installAvg = installTotal ? avgRange(installTotal) : 0;
  const subtotal = unitPrice + installAvg;
  const mul = (PLAN_PROFIT_MULTIPLIER[planType].multiplier_min + PLAN_PROFIT_MULTIPLIER[planType].multiplier_max) / 2;
  const total_man_en = Math.round(subtotal * mul * PRICE_COEFF);
  return { maker, series: gradeData.series, grade: gradeName, total: total_man_en * 10000, total_man_en, message: `${maker} ${gradeData.series}（${gradeName}）`, _coeff_applied: PRICE_COEFF, _provenance: { source: "trade-db", db_file: "trade_prices_jusetsu.json", maker, series: gradeData.series, grade: gradeName, coeff_source: "hs-price-sync@/current-coefficient", coeff_value: PRICE_COEFF, calculated_at: new Date().toISOString() } };
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
  // ★ v11-SAFE-bugfix02: 出典メタ情報を各プランに添付
  const dbMeta = catData._meta || {};
  const baseProv = {
    source: "souba-db",
    category_id: dbMeta.category_id || mapping.db,
    db_version: dbMeta.version || "unknown",
    db_updated: dbMeta.updated || null,
    coeff_source: "hs-price-sync@/current-coefficient",
    coeff_value: PRICE_COEFF
  };
  const attachProv = (plan, planKey) => {
    if (plan) plan._provenance = { ...baseProv, plan_key: planKey, calculated_at: new Date().toISOString() };
    return plan;
  };
  // ★ Patch B-prep: plan_key指定時は単一プランを業者規模で展開
  if (item.plan_key && !isList && plans[item.plan_key]) {
    result.matsu = attachProv(extractPlanPrice(plans[item.plan_key], "matsu"), item.plan_key);
    result.take  = attachProv(extractPlanPrice(plans[item.plan_key], "take"),  item.plan_key);
    result.ume   = attachProv(extractPlanPrice(plans[item.plan_key], "ume"),   item.plan_key);
    result._mode = "plan_key_specified";
    return result;
  }
  if (mapping.grade_map && !isList) {
    result.matsu = attachProv(extractPlanPrice(plans[mapping.grade_map.matsu], "matsu"), mapping.grade_map.matsu);
    result.take  = attachProv(extractPlanPrice(plans[mapping.grade_map.take],  "take"),  mapping.grade_map.take);
    result.ume   = attachProv(extractPlanPrice(plans[mapping.grade_map.ume],   "ume"),   mapping.grade_map.ume);
  } else {
    const len = keys.length;
    const get = (idx) => isList ? plans[idx] : plans[keys[idx]];
    const getKey = (idx) => isList ? `index_${idx}` : keys[idx];
    const mIdx = Math.min(len-1, Math.floor(len * 0.75));
    const tIdx = Math.floor(len / 2);
    const uIdx = Math.floor(len * 0.15);
    result.matsu = len > Math.floor(len * 0.75) ? attachProv(extractPlanPrice(get(mIdx), "matsu"), getKey(mIdx)) : null;
    result.take  = len > Math.floor(len / 2)    ? attachProv(extractPlanPrice(get(tIdx), "take"),  getKey(tIdx)) : null;
    result.ume   = len > Math.floor(len * 0.15) ? attachProv(extractPlanPrice(get(uIdx), "ume"),   getKey(uIdx)) : null;
  }
  return result;
}

function extractPlanPrice(p, planType) {
  if (!p) return null;
  const price = p.HS基準価格_万円 || (p.hs_rule_estimate_jpy ? p.hs_rule_estimate_jpy / 10000 : null) || (p.hs_rule_jpy ? p.hs_rule_jpy / 10000 : null) || (p.estimated_total_jpy ? avgRange(p.estimated_total_jpy) / 10000 : null) || (p.price_jpy ? avgRange(p.price_jpy) / 10000 : null);
  if (!price) return null;
  const mul = (PLAN_PROFIT_MULTIPLIER[planType].multiplier_min + PLAN_PROFIT_MULTIPLIER[planType].multiplier_max) / 2;
  const total_man_en = Math.round(price * mul * PRICE_COEFF);  // ★戦時係数適用（v11-SAFE-bugfix01）
  return { name: p.name, total_man_en, total: total_man_en * 10000, work_days: p.work_days || null, scope: p.scope || null, message: `${p.name}（${PLAN_PROFIT_MULTIPLIER[planType].target_business}）`, _coeff_applied: PRICE_COEFF };
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
const KOJI_ALIAS = {"washroom_floor":"floor","bathroom_floor":"floor","floor_replacement":"floor","kitchen_reform":"kitchen","bathroom_reform":"bathroom","toilet_reform":"toilet","electrical_outlet_addition":"electrical","electrical_outlet_installation":"electrical","electrical_outlet_expansion":"electrical","electrical_wiring":"electrical","electrical_lighting":"electrical","electrical_led_conversion":"electrical","electrical_ev_charging":"electrical","electrical_distribution_board":"electrical","electrical_solar":"electrical","electrical_battery":"electrical","electrical_v2h":"electrical","electrical_aircon_200v":"electrical","electrical_floor_heating":"electrical","electrical_lan":"electrical","electrical_antenna":"electrical","electrical_intercom":"electrical","electrical_fire_alarm":"electrical","electrical_grounding":"electrical","electrical_ventilation":"electrical","electrical_range_hood":"electrical","electrical_bath_dryer":"electrical","electrical_indirect_lighting":"electrical","electrical_dougyoku":"electrical","electrical_work":"electrical","kitchen_replacement":"kitchen","kitchen_renewal":"kitchen","kitchen_remodel":"kitchen","kitchen_renovation":"kitchen","kitchen_full_renewal":"kitchen","kitchen_island_install":"kitchen","kitchen_island_change":"kitchen","kitchen_layout_change":"kitchen","kitchen_l_to_island":"kitchen","kitchen_i_to_island":"kitchen","kitchen_i_to_l":"kitchen","kitchen_unit_replace":"kitchen","system_kitchen_install":"kitchen","system_kitchen_replacement":"kitchen","bathroom_replacement":"bathroom","bathroom_renewal":"bathroom","bathroom_remodel":"bathroom","bathroom_renovation":"bathroom","bathroom_unit_replace":"bathroom","bathroom_unit_install":"bathroom","bathroom_zairai_to_unit":"bathroom","unit_bath_replace":"bathroom","unit_bath_install":"bathroom","unit_bath_renewal":"bathroom","yokushitsu_reform":"bathroom","yokushitsu_replace":"bathroom","toilet_replacement":"toilet","toilet_renewal":"toilet","toilet_remodel":"toilet","toilet_install":"toilet","toilet_yoshiki_change":"toilet","washiki_to_yoshiki":"toilet","tankless_toilet_install":"toilet","benki_kokan":"toilet","washroom_reform":"washroom","washroom_replacement":"washroom","washroom_vanity_replace":"washroom","sentaijo_reform":"washroom","senmen_dai_kokan":"washroom","flooring_replacement":"floor","flooring_reform":"floor","floor_reform":"floor","floor_renewal":"floor","floor_remodel":"floor","living_floor":"floor","bedroom_floor":"floor","yuka_kokan":"floor","fukugou_floor_install":"floor","mukuzai_floor_install":"floor","cloth_replacement":"cloth","cloth_reform":"cloth","cloth_renewal":"cloth","wallpaper_replacement":"cloth","wallpaper_reform":"cloth","wallpaper_renewal":"cloth","cross_replacement":"cloth","naishou_cloth":"cloth","kabe_cloth_replace":"cloth","kurosu_kokan":"cloth","tatami_replacement":"tatami","tatami_reform":"tatami","tatami_omote_gae":"tatami","tatami_renewal":"tatami","water_heater_reform":"water_heater","water_heater_replacement":"water_heater","ecocute_install":"water_heater","ecocute_replacement":"water_heater","gas_kyutoki_replace":"water_heater","kyutoki_kokan":"water_heater","kyutoki_replacement":"water_heater","aircon_install":"aircon","aircon_replacement":"aircon","aircon_kokan":"aircon","ear_kon_install":"aircon","roof_replacement":"roof","roof_kabaa":"roof","roof_kabaa_kouhou":"roof","roof_fukikae":"roof","roof_repair":"roof","roof_renewal":"roof","roofing_replacement":"roof","yane_kouji":"roof","yane_kabaa":"roof","yane_fukikae":"roof","gaiheki_painting":"gaiheki","gaiheki_kouji":"gaiheki","sotokabe_tosou":"gaiheki","sotokabe_painting":"gaiheki","exterior_painting":"gaiheki","exterior_wall_painting":"gaiheki","gaiheki_renewal":"gaiheki","insulation_kouji":"insulation","dannetsu_kouji":"insulation","dannetsu_install":"insulation","termite_treatment":"termite","termite_control":"termite","shiroari_kujo":"termite","shiroari_taisaku":"termite","shiroari_chosa":"termite","taishin_kouji":"taishin","taishin_kaisou":"taishin","earthquake_resistance":"taishin","window_reform":"window","window_replacement":"window","window_renovation":"window","mado_kokan":"window","inner_window":"window","naimado_install":"window","twin_glass_install":"window","pair_glass_install":"window","entrance_door_reform":"entrance_door","entrance_door_replacement":"entrance_door","genkan_door_replace":"entrance_door","genkan_door_kokan":"entrance_door","door_replacement":"entrance_door","waterproofing_kouji":"waterproof","bousui_kouji":"waterproof","balcony_waterproof":"waterproof","rain_leak_repair":"rain_leak","amamori_shuri":"rain_leak","rain_leak_treatment":"rain_leak","sakan_kouji":"sakan","shikkui_install":"sakan","keisoudo_install":"sakan","tile_kouji":"tile","tile_install":"tile","bankin_kouji":"bankin","naishou_tosou_kouji":"naishou_tosou","interior_painting":"naishou_tosou","barrier_free_reform":"barrier_free","kaigo_reform":"barrier_free","kaigo_kouji":"barrier_free","tesuri_install":"barrier_free","demolition_kouji":"demolition","kaitai_kouji":"demolition","gaikou_kouji":"gaikou","exterior_construction":"gaikou","garden_work":"gaikou","carport_install":"gaikou","amido_kokan":"amido","amado_kokan":"amido","shutter_install":"amido","commercial_kouji":"commercial","tenpo_kouji":"commercial","office_renovation":"commercial"};
const REGION_ALIAS = {"hiroshima":"other","okayama":"other","tottori":"other","shimane":"other","yamaguchi":"other","kagawa":"other","tokushima":"other","ehime":"other","kochi":"other","fukuoka":"other","saga":"other","nagasaki":"other","kumamoto":"other","oita":"other","miyazaki":"other","kagoshima":"other","okinawa":"other","hokkaido":"other","aomori":"tohoku","iwate":"tohoku","miyagi":"tohoku","akita":"tohoku","yamagata":"tohoku","fukushima":"tohoku"};
if(hearingResult.items) hearingResult.items.forEach(i=>{if(i.region) i.region=REGION_ALIAS[i.region]||i.region;});
if(hearingResult.items) hearingResult.items.forEach(i=>{if(i.koji_type && KOJI_ALIAS[i.koji_type]) i.koji_type=KOJI_ALIAS[i.koji_type];});
// Patch A4: prefix-based fallback for unmapped koji_types (Haiku非決定性対策)
if(hearingResult.items) hearingResult.items.forEach(i=>{
  if(i.koji_type && !KOJI_TYPE_MAP[i.koji_type]){
    const canonical = Object.keys(KOJI_TYPE_MAP).sort((a,b)=>b.length-a.length).find(c => i.koji_type.startsWith(c+'_') || i.koji_type === c);
    if(canonical) i.koji_type = canonical;
  }
});
if(hearingResult.items) hearingResult.items.forEach(i=>{if(typeof i.area==='string'){const m=i.area.match(/[\d.]+/);i.area=m?parseFloat(m[0])*3.305:3.305;}});
// ★ Patch B-prep: 電気工事の plan_key 自動導出
if (hearingResult.items && previous_answers) {
  const ELECTRICAL_PLAN_MAP = {
    'new_wiring_2outlets': 'konsento_new_wiring',
    'new_wiring_1outlet': 'konsento_new_wiring',
    'new_wiring': 'konsento_new_wiring',
    'branch_from_existing': 'konsento_simple',
    'outdoor': 'outdoor_konsento',
    'outdoor_outlet': 'outdoor_konsento',
    'distribution_board': 'distribution_board_upgrade',
    'led_whole_house': 'led_whole_house',
    'ev_charging': 'ev_charging',
    'aircon_200v': 'v2_aircon_200v_dedicated'
  };
  hearingResult.items.forEach(i => {
    if (i.koji_type !== 'electrical' || i.plan_key) return;
    const candidates = [previous_answers.outlet_type?.value, previous_answers.work_type?.value, previous_answers.scope?.value];
    for (const c of candidates) if (c && ELECTRICAL_PLAN_MAP[c]) { i.plan_key = ELECTRICAL_PLAN_MAP[c]; break; }
  });
}
// region注入：ヒアリング回答から地域をitemsに設定
  if (hearingResult.items && previous_answers?.region?.value) {
    hearingResult.items.forEach(i => {
      if (!i.region) i.region = REGION_ALIAS[previous_answers.region.value] || previous_answers.region.value;
    });
  }
  // region未設定の場合、natural_language_inputから直接地域を推定
  if (hearingResult.items) {
    const regionKeywords = {
      kanto: ['東京','神奈川','埼玉','千葉','関東'],
      kinki: ['大阪','京都','兵庫','関西','近畿'],
      chubu: ['愛知','静岡','岐阜','中部','名古屋'],
      tohoku: ['青森','岩手','宮城','秋田','山形','福島','東北'],
      other: ['北海道','広島','岡山','福岡','沖縄','九州','中国','四国']
    };
    hearingResult.items.forEach(i => {
      if (!i.region) {
        for (const [region, keywords] of Object.entries(regionKeywords)) {
          if (keywords.some(k => natural_language_input.includes(k))) {
            i.region = region;
            break;
          }
        }
      }
    });
  }

  if (hearingResult.status === 'ready') {
    const plans = await generatePlansFromItems(hearingResult.items);    return json({
      status: 'ready',
      extracted_items: hearingResult.items,
      plans,
      market_alerts: getMarketAlerts(hearingResult.items),
      disclaimer: "本結果は国土交通省・メーカー公式データ等に基づく相場の参考価格提示であり、建設業法上の正式見積もりではありません。施工業者との契約は別途行ってください。",
      match_url: `https://hs-pdf-gen.oga-surf-project.workers.dev/match?region=${encodeURIComponent((hearingResult.items[0]?.region)||'')}&koji_type=${encodeURIComponent((hearingResult.items[0]?.koji_type)||'')}`,
      match_coming_soon: true,
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
    try {
      const _cr = await fetch('https://hs-price-sync.oga-surf-project.workers.dev/current-coefficient');
      if (_cr.ok) { const _cd = await _cr.json(); PRICE_COEFF = _cd.coefficient || 1.0; }
    } catch(e) { PRICE_COEFF = 1.0; }
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

    // ===== /gyaku-mitsumori-chat（逆見積もり専用・systemプロンプト直接受渡し）=====
    if (path === '/gyaku-mitsumori-chat' && request.method === 'POST') {
      try {
        const body = await request.json();
        if (!body.messages || !Array.isArray(body.messages)) {
          return json({ error: 'messages required' }, 400, origin);
        }
        if (!body.system) {
          return json({ error: 'system required' }, 400, origin);
        }
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: body.max_tokens || 1000,
            system: await enrichSystemPromptWithSoubaData(body.system, body.messages),
            messages: body.messages,
          }),
        });
        // ★ v11-PROVENANCE-A5: 入力ハッシュ化＆キャッシュ判定
        const normalized = normalizeUserInput(body.messages);
        const auditHash = await generateSHA256Hash(normalized);
        const cached = auditHash ? await getCachedPlan(env, auditHash) : null;

        let data;
        if (false && cached && cached.ai_output) { // ★キャッシュ無効化：会話型では毎回LLMに投げる
          // キャッシュヒット：AI 呼び出しスキップ
          data = { content: [{ text: cached.ai_output }] };
          try {
            cached.hit_count = (cached.hit_count || 0) + 1;
            await env.KIRA_STATS.put(`cache:plan:${auditHash}`, JSON.stringify(cached), {
              expirationTtl: 30 * 24 * 60 * 60
            });
          } catch (e) {}
        } else {
          // キャッシュミス：従来通り Sonnet 呼び出し
          data = await res.json();
        }

        // ★ v11-PROVENANCE-A4: CV後処理（CV欠けてる行に自動追加）
        if (data?.content?.[0]?.text) {
          data.content[0].text = await injectMissingCV(data.content[0].text, body.messages);
          // ★ v11-PROVENANCE-A5: audit_hash を出典に注入
          if (auditHash) {
            data.content[0].text = injectAuditHash(data.content[0].text, auditHash);
          }
          // ★ v11-PROVENANCE-A5: 新規生成時はキャッシュ保存
          if (!cached) {
            const soubaDB = await fetchSoubaDB();
            const soubaVersion = soubaDB?._meta?.version || 'unknown';
            await saveCachedPlan(env, auditHash, normalized, data.content[0].text, soubaVersion, PRICE_COEFF);
          }
        }
        // === 計測追加（2026-05-06）===
    try {
      await bumpMetric(env, 'kira_conv');
      const aiText = data?.content?.[0]?.text || '';
      if (/5[,，]?500|逆見積もり|逆見積/.test(aiText)) {
        await bumpMetric(env, 'kira_offer');
      }
      if (/paypal\.com|paypal\.me/i.test(aiText)) {
        await bumpMetric(env, 'kira_payment_link');
      }
    } catch (e) {}
    // === 計測ここまで ===
     // === 診断ログ保存（研究データ蓄積 Phase1）===
    try {
      const userText = body.messages
        .filter(m => m.role === 'user')
        .map(m => typeof m.content === 'string' ? m.content : '')
        .join(' ');
      const logKey = `diaglog:${Date.now()}:${Math.random().toString(36).slice(2,8)}`;
      await env.KIRA_STATS.put(logKey, JSON.stringify({
        session_id: auditHash ? auditHash.slice(0,12) : null,
        user_input: userText.slice(0, 500),
        ai_response: data?.content?.[0]?.text?.slice(0, 500) || '',
        price_coeff: PRICE_COEFF,
        logged_at: new Date().toISOString(),
        contract_amount: null,  // ← 後日「実際の契約額」を入力する欄
        status: 'pending'
      }), { expirationTtl: 60 * 60 * 24 * 365 });
    } catch (e) {}
    // === 診断ログここまで ===   
    return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
        });
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
        const inquiryKeys = list.keys.filter(k =>
          !k.name.startsWith('history:') &&
          !k.name.startsWith('prospect:') &&
          !k.name.startsWith('token:')
        );
        const items = await Promise.all(
          inquiryKeys.map(async (k) => {
            const val = await env.KIRA_STATS.get(k.name, { type: 'json' });
            return { key: k.name, ...(val || {}) };
          })
        );
        return json(items.reverse(), 200, origin);
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
    // ===== /prospects =====
    if (path === '/prospects') {
      try {
        const list = await env.KIRA_STATS.list({ prefix: 'prospect:' });
        if (list.keys.length === 0) return json([], 200, origin);
        const items = await Promise.all(
          list.keys.map(async (k) => {
            const val = await env.KIRA_STATS.get(k.name, { type: 'json' });
            return { key: k.name, ...(val || {}) };
          })
        );
        return json(items.sort((a,b)=>(b.score||0)-(a.score||0)), 200, origin);
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
        // LINE送信
        const res = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LINE_CHANNEL_TOKEN}` },
          body: JSON.stringify({ to: env.LINE_USER_ID, messages: [{ type: 'text', text: body.message || '' }] }),
        });
        // KVに保存（名前・メールがある場合）
        if (body.name || body.email) {
          const key = 'inquiry:' + Date.now() + ':' + Math.random().toString(36).slice(2, 8);
          await env.KIRA_STATS.put(key, JSON.stringify({
            name: body.name || '',
            email: body.email || '',
            type: body.type || '',
            result: body.result || body.message || '',
            risk: body.risk || '',
            createdAt: new Date().toISOString(),
          }), { expirationTtl: 60 * 60 * 24 * 90 });
        }
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

  if (path === '/paypay/quick-checkout' && request.method === 'POST') {
  try {
    const body = await request.json();
    const merchantPaymentId = `hs-gyaku-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const paypayBody = {
      merchantPaymentId,
      amount: { amount: 5500, currency: 'JPY' },
      codeType: 'ORDER_QR',
      orderDescription: 'HORIZON SHIELD 逆見積もり診断PDF',
      isAuthorization: false,
      redirectUrl: `https://shield.the-horizons-innovation.com/thankyou.html?id=${merchantPaymentId}`,
      redirectType: 'WEB_LINK',
    };
    const paypayPath = '/v2/codes';
    const authHeader = await paypayHmacAuth('POST', paypayPath, paypayBody, env.PAYPAY_API_KEY, env.PAYPAY_API_SECRET);
    const paypayRes = await fetch(`${PAYPAY_API_BASE}${paypayPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=UTF-8', 'Authorization': authHeader },
      body: JSON.stringify(paypayBody),
    });
    const paypayRawText = await paypayRes.text();
    console.error('PayPay raw:', paypayRawText, 'Status:', paypayRes.status);
    const paypay = JSON.parse(paypayRawText);
    if (paypay.resultInfo?.code !== 'SUCCESS') {
      console.error('PayPay full response:', JSON.stringify(paypay));
      console.error('Auth header used:', authHeader);
      throw new Error(JSON.stringify(paypay.resultInfo));
    }
    await env.ORDERS.put(`order:${merchantPaymentId}`, JSON.stringify({
      merchant_payment_id: merchantPaymentId,
      amount: 5500,
      form_data: body,
      status: 'pending',
      created_at: Date.now()
    }), { expirationTtl: 60*60*24*7 });
    try {
      await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.LINE_CHANNEL_TOKEN}` },
        body: JSON.stringify({ to: env.LINE_USER_ID, messages: [{ type: 'text', text: `🛒 逆見積もりPDF決済開始\nID: ${merchantPaymentId}\n¥5,500` }] }),
      });
    } catch(_e) {}
    return json({ ok: true, paypay_url: paypay.data.url, merchant_payment_id: merchantPaymentId }, 200, origin);
  } catch(e) { return json({ error: e.message }, 500, origin); }
}  
    // ===== PayPal決済 =====

async function _getPayPalToken(env) {
  const auth = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const res = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function _generateDlToken(orderId, env) {
  const token = crypto.randomUUID().replace(/-/g, '');
  await env.ORDERS.put(`dl_token:${token}`, JSON.stringify({
    orderId, used: false, expires: Date.now() + 86400000
  }), { expirationTtl: 86400 });
  return token;
}

if (path === '/checkout/paypal/create-order' && request.method === 'POST') {
  try {
    const body = await request.json();
    const ppToken = await _getPayPalToken(env);
    const ppRes = await fetch('https://api-m.paypal.com/v2/checkout/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ppToken}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `hs-${Date.now()}`,
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: 'JPY', value: '5500' },
          description: 'HORIZON SHIELD 逆見積もり診断PDF',
        }],
        application_context: {
          brand_name: 'HORIZON SHIELD',
          locale: 'ja-JP',
          user_action: 'PAY_NOW',
        },
      }),
    });
    if (!ppRes.ok) throw new Error(`PayPal create failed: ${await ppRes.text()}`);
    const ppData = await ppRes.json();
    await env.ORDERS.put(`paypal:${ppData.id}`, JSON.stringify({
      ...body, status: 'pending', created_at: Date.now()
    }), { expirationTtl: 3600 });
    return json({ paypal_order_id: ppData.id }, 200, origin);
  } catch(e) { return json({ error: e.message }, 500, origin); }
}

if (path === '/checkout/paypal/capture' && request.method === 'POST') {
  try {
    const { paypal_order_id } = await request.json();
    if (!paypal_order_id) return json({ error: 'paypal_order_id required' }, 400, origin);
    const ppToken = await _getPayPalToken(env);
    const capRes = await fetch(`https://api-m.paypal.com/v2/checkout/orders/${paypal_order_id}/capture`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ppToken}`, 'Content-Type': 'application/json' },
    });
    const capData = await capRes.json();
    if (capData.status !== 'COMPLETED') {
      return json({ error: '決済未完了', status: capData.status }, 402, origin);
    }
    const orderId = `pp-${paypal_order_id}`;
    const stored = await env.ORDERS.get(`paypal:${paypal_order_id}`, { type: 'json' }) || {};
    await env.ORDERS.put(`order:${orderId}`, JSON.stringify({
      ...stored, orderId, payment_method: 'paypal',
      amount: 5500, status: 'paid', paid_at: Date.now(),
    }), { expirationTtl: 86400 * 90 });
    const dlToken = await _generateDlToken(orderId, env);
    try {
      await fetch('https://ntfy.sh/horizon-shield-toshi-0222', {
        method: 'POST',
        headers: { 'Title': '💰 PayPal決済完了 ¥5,500', 'Priority': 'high', 'Tags': 'paypal,moneybag' },
        body: `PayPal決済完了\nOrderID: ${orderId}`,
      });
    } catch(_) {}
    return json({ ok: true, orderId, download_token: dlToken }, 200, origin);
  } catch(e) { return json({ error: e.message }, 500, origin); }
}

if (path === '/checkout/paypay-status' && request.method === 'POST') {
  try {
    const { merchant_payment_id } = await request.json();
    if (!merchant_payment_id) return json({ error: 'merchant_payment_id required' }, 400, origin);
    const existingToken = await env.ORDERS.get(`paypay_token:${merchant_payment_id}`);
    if (existingToken) {
      return json({ ok: true, paid: true, download_token: existingToken }, 200, origin);
    }
    const paypayPath = `/v2/codes/payments/${merchant_payment_id}`;
    const authHeader = await paypayHmacAuth('GET', paypayPath, null, env.PAYPAY_API_KEY, env.PAYPAY_API_SECRET);
    const statusRes = await fetch(`${PAYPAY_API_BASE}${paypayPath}`, {
      method: 'GET',
      headers: { 'Authorization': authHeader, 'X-ASSUME-MERCHANT': env.PAYPAY_MERCHANT_ID },
    });
    const statusData = await statusRes.json();
    const payStatus = statusData.data?.status;
    if (payStatus === 'COMPLETED') {
      const dlToken = await _generateDlToken(`paypay-${merchant_payment_id}`, env);
      await env.ORDERS.put(`paypay_token:${merchant_payment_id}`, dlToken, { expirationTtl: 86400 });
      try {
        await fetch('https://ntfy.sh/horizon-shield-toshi-0222', {
          method: 'POST',
          headers: { 'Title': '💰 PayPay決済確認 ¥5,500', 'Priority': 'high', 'Tags': 'paypay,moneybag' },
          body: `PayPay確認\nID: ${merchant_payment_id}`,
        });
      } catch(_) {}
      return json({ ok: true, paid: true, download_token: dlToken }, 200, origin);
    }
    return json({ ok: true, paid: false, status: payStatus }, 200, origin);
  } catch(e) { return json({ error: e.message }, 500, origin); }
}
// === /admin/funnel-stats ダッシュボード（2026-05-06追加）===
    if (path === '/admin/funnel-stats') {
      const days = 30;
      const today = new Date();
      const rows = [];
      for (let i = 0; i < days; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const ymd = d.toISOString().slice(0, 10);
        const [visits, conv, offer, link] = await Promise.all([
          env.KIRA_STATS.get(`metric:lp_visit:${ymd}`).then(v => parseInt(v||'0',10)),
          env.KIRA_STATS.get(`metric:kira_conv:${ymd}`).then(v => parseInt(v||'0',10)),
          env.KIRA_STATS.get(`metric:kira_offer:${ymd}`).then(v => parseInt(v||'0',10)),
          env.KIRA_STATS.get(`metric:kira_payment_link:${ymd}`).then(v => parseInt(v||'0',10)),
        ]);
        rows.push({ date: ymd, visits, conv, offer, link });
      }
      const tv = rows.reduce((s,r)=>s+r.visits,0);
      const tc = rows.reduce((s,r)=>s+r.conv,0);
      const to = rows.reduce((s,r)=>s+r.offer,0);
      const tl = rows.reduce((s,r)=>s+r.link,0);
      const pct = (n,d) => d ? ((n/d)*100).toFixed(1)+'%' : '—';
      const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HSファネル計測</title>
<style>
body{font-family:-apple-system,sans-serif;padding:20px;background:#f5f7fa;max-width:1000px;margin:0 auto}
h1{color:#1a3a5c;border-bottom:3px solid #1a3a5c;padding-bottom:8px}
.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:24px 0}
.card{background:#fff;padding:20px;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.06);border-left:4px solid #1a3a5c}
.card .num{font-size:32px;font-weight:800;color:#1a3a5c}
.card .label{font-size:12px;color:#555;margin-top:4px}
.card .rate{font-size:11px;color:#888}
table{border-collapse:collapse;width:100%;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.06);border-radius:8px;overflow:hidden;font-size:13px}
th,td{padding:8px 12px;text-align:right;border-bottom:1px solid #eef}
th{background:#1a3a5c;color:#fff;text-align:center}
td:first-child{text-align:left;font-family:monospace;color:#555}
tr:hover{background:#f8fafd}
</style></head><body>
<h1>📊 HORIZON SHIELD ファネル計測（過去30日）</h1>
<div class="summary">
<div class="card"><div class="num">${tv}</div><div class="label">LP訪問数</div></div>
<div class="card"><div class="num">${tc}</div><div class="label">KIRA会話数</div><div class="rate">${pct(tc,tv)}</div></div>
<div class="card"><div class="num">${to}</div><div class="label">¥5,500提案数</div><div class="rate">${pct(to,tc)}</div></div>
<div class="card"><div class="num">${tl}</div><div class="label">決済リンク提示</div><div class="rate">${pct(tl,to)}</div></div>
</div>
<table><thead><tr><th>日付</th><th>LP訪問</th><th>KIRA会話</th><th>¥5,500提案</th><th>決済リンク</th></tr></thead>
<tbody>${rows.map(r=>`<tr><td>${r.date}</td><td>${r.visits}</td><td>${r.conv}</td><td>${r.offer}</td><td>${r.link}</td></tr>`).join('')}</tbody>
</table></body></html>`;
      return new Response(html, {
        headers: {'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'}
      });
    }
    // === /admin/funnel-stats ここまで ===
// === /track-visit LP訪問計測（2026-05-06追加 / count機能追加 2026-05-14）===
    if (path === '/track-visit') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        });
      }
      await bumpMetric(env, 'lp_visit');
      // ★ 累計カウンター（2026-05-12実数BASE=2321から継続）
      const BASE = 2321;
      let count = BASE;
      try {
        const stored = await env.KIRA_STATS.get('visitor_count');
        count = stored ? parseInt(stored, 10) : BASE;
        count += 1;
        await env.KIRA_STATS.put('visitor_count', String(count));
      } catch (e) {
        count = BASE;
      }
      return new Response(JSON.stringify({ count, ok: true }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Cache-Control': 'no-store',
        },
      });
    }
    // === /track-visit ここまで ===
// === /log-contract 最終契約額入力（研究データPhase1）===
if (path === '/log-contract' && request.method === 'POST') {
  try {
    const body = await request.json();
    const { audit_hash, contract_amount } = body;
    if (!audit_hash || !contract_amount) {
      return json({ error: 'audit_hash and contract_amount required' }, 400, origin);
    }
    // diaglog: キーを全検索してaudit_hashが一致するものを更新
    const list = await env.KIRA_STATS.list({ prefix: 'diaglog:' });
    let updated = false;
    for (const k of list.keys) {
      const entry = await env.KIRA_STATS.get(k.name, { type: 'json' });
      if (entry && entry.session_id === audit_hash.slice(0, 12)) {
        entry.contract_amount = Number(contract_amount);
        entry.status = 'contracted';
        entry.contracted_at = new Date().toISOString();
        await env.KIRA_STATS.put(k.name, JSON.stringify(entry), {
          expirationTtl: 60 * 60 * 24 * 365
        });
        updated = true;
        break;
      }
    }
    return json({ ok: true, updated }, 200, origin);
  } catch (e) {
    return json({ error: e.message }, 500, origin);
  }
}
// === /log-contract ここまで ===
    return json({ error: 'Not found', path }, 404, origin);
  },
};