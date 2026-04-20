/**
 * hs-kira-proxy v4 Full - HORIZON SHIELD KIRA Proxy Worker
 *
 * ===== TOshi向けデプロイ手順 =====
 * 1. Cloudflareダッシュボード → Workers & Pages → hs-kira-proxy を選択
 * 2. Edit code をクリック
 * 3. Cmd+A → Delete で既存コードを全削除
 * 4. このファイルの内容を全コピペ
 * 5. Save and deploy
 *
 * ===== 必須ENV（Secrets）=====
 * - ANTHROPIC_API_KEY
 * - LINE_CHANNEL_TOKEN
 * - LINE_USER_ID = Uc7165565cb48b408eb3af5dc07a72a28
 * - RESEND_API_KEY
 *
 * ===== エンドポイント =====
 * POST /anthropic       - Claude APIプロキシ
 * POST /kira            - KIRA特化（inspect用）
 * POST /notify          - LINE通知
 * POST /send-email      - Resend経由メール
 * GET  /stats           - 統計
 * POST /reverse-estimate ★NEW★ ヒアリング判定付き逆見積もり
 */

const REPO_BASE = 'https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/souba-v2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key, anthropic-version',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      if (path === '/anthropic')        return await handleAnthropic(request, env);
      if (path === '/kira')             return await handleKira(request, env);
      if (path === '/notify')           return await handleNotify(request, env);
      if (path === '/send-email')       return await handleSendEmail(request, env);
      if (path === '/stats')            return await handleStats(request, env);
      if (path === '/reverse-estimate') return await handleReverseEstimate(request, env);
      if (path === '/health' || path === '/') {
        return jsonResponse({ ok: true, version: 'v4.0.0-reverse-estimate' });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    } catch (e) {
      return jsonResponse({ error: e.message, stack: e.stack }, 500);
    }
  }
};


// ============================================================
// /reverse-estimate: ヒアリング判定付き
// ============================================================
const HEARING_PROMPT = `あなたは30年経験の建設コンサルタント「KIRA」です。
施主の要望を聞いて、正確な見積もりを出すために必要な情報が揃っているかを判定してください。

【出力形式】(JSON形式のみ、他の文章は絶対に含めない)
{
  "status": "need_hearing" or "ready",
  "understood_summary": "現時点までに理解した工事内容の簡潔な要約（HTMLなし・改行OK）",
  "clarifying_questions": [
    {
      "field": "識別子（英数字スネークケース。kitchen_width, layout_change等）",
      "question": "質問文",
      "why_needed": "この情報がなぜ必要か（1-2文・金額への影響を説明）",
      "options": ["選択肢1", "選択肢2", "選択肢3"]
    }
  ],
  "current_items": [
    { "koji_type": "...", "area": 数値, "grade_hint": "...", "raw_text": "...", "specifics": {} }
  ]
}

【判定ルール】
"ready"の条件を全て満たすこと:
- 各工事項目で以下が明確:
  * 面積/サイズ (畳数、㎡、キッチン幅mm等)
  * レイアウト変更の有無 (I型→L型、壁撤去など)
  * グレード希望
  * 予算感

【質問生成ルール】(不足情報は最大3問に絞る)
- キッチン入れ替え: 現在と変更後の形状(I型/L型/U型/アイランド)、キッチン幅(2550/2700/3000mm)
- 「リビングを広く」等: 壁撤去の範囲(間仕切りのみ/構造壁含む/撤去なし)
- 面積不明時: 部屋の広さ(6畳/8畳/10畳/12畳LDK)
- グレード不明時: 予算感(こだわり/バランス/抑えめ)
- 水回り: メーカーのこだわり(TOTO/LIXIL/タカラ/こだわりなし)
- why_needed には「アイランド化は配管大改修で+100万円以上の差が出るため」等、金額影響を明示

【koji_type一覧】
kitchen, bathroom, toilet, washroom, floor, cloth, tatami, water_heater, electrical, aircon,
roof, gaiheki, insulation, window, entrance_door, waterproof, rain_leak, sakan, tile, bankin,
naishou_tosou, taishin, termite, barrier_free, demolition, gaikou, amido, commercial

【重要】
- options は最大4個、短く具体的に
- ユーザーが迷わず選べる形
- 情報が揃っていれば即 "ready" で返し、current_items を充実させる
- specifics に layout_change ("I_to_L", "I_to_island", "wall_removal", "structural_wall")、width_mm、maker などを記入
- understood_summary は常に返す (ユーザーの安心感のため)

施主の文章:
`;


async function handleReverseEstimate(request, env) {
  if (request.method !== 'POST') return jsonResponse({ error: 'POST only' }, 405);

  let body;
  try { body = await request.json(); }
  catch (e) { return jsonResponse({ error: 'Invalid JSON' }, 400); }

  const { natural_language_input, previous_answers = {}, user_context = {} } = body;
  if (!natural_language_input) {
    return jsonResponse({ error: 'natural_language_input is required' }, 400);
  }

  // 入力と過去回答を統合
  let enhancedInput = natural_language_input;
  if (Object.keys(previous_answers).length > 0) {
    enhancedInput += '\n\n【追加で得た情報】\n';
    for (const [key, val] of Object.entries(previous_answers)) {
      enhancedInput += `- ${key}: ${val}\n`;
    }
  }

  // Claude でヒアリング判定
  let hearingResult;
  try {
    hearingResult = await callClaudeForHearing(enhancedInput, env);
  } catch (e) {
    return jsonResponse({
      error: 'Claude API呼び出し失敗: ' + e.message,
      fallback_suggestion: 'LINEで直接ご相談ください: https://line.me/R/ti/p/@172piime'
    }, 500);
  }

  // 情報不足なら質問を返す
  if (hearingResult.status === 'need_hearing') {
    return jsonResponse({
      status: 'need_hearing',
      session_id: body.session_id || generateSessionId(),
      message: 'より正確な逆見積もりを作成するため、いくつか確認させてください。',
      understood_summary: hearingResult.understood_summary || '',
      clarifying_questions: hearingResult.clarifying_questions || [],
      current_items: hearingResult.current_items || hearingResult.extracted_items || [],
      _meta: { engine: 'hs-kira-proxy v4 hearing', philosophy: 'TOshi原則: プロは情報不足で見積もりを出さない' }
    });
  }

  const items = hearingResult.current_items || hearingResult.extracted_items || [];
  if (items.length === 0) {
    return jsonResponse({
      status: 'need_hearing',
      session_id: body.session_id || generateSessionId(),
      message: '工事項目を特定できませんでした。もう少し具体的にお書きください。',
      understood_summary: '',
      clarifying_questions: [{
        field: 'work_category',
        question: 'どんな工事をご希望ですか？',
        why_needed: 'まずは大まかな分野を教えてください。分野が決まれば具体的な質問をさせていただきます。',
        options: ['水回りリフォーム', '内装リフォーム', '外装・屋根', '断熱・省エネ', 'その他']
      }]
    });
  }

  // DB取得 + 算出
  const [tradeDB, soubaDB] = await Promise.all([fetchTradeDB(), fetchNeededCategoryDBs(items)]);
  const plans = generatePlans(items, soubaDB, tradeDB);

  return jsonResponse({
    status: 'ready',
    session_id: body.session_id || generateSessionId(),
    extracted_items: items,
    current_items: items,
    understood_summary: hearingResult.understood_summary || '',
    plans,
    disclaimer: '本結果は相場に基づく参考価格提示であり、建設業法上の正式見積もりではありません。HSは施工を行いません。施工業者との契約は別途行ってください。',
    market_alerts: getMarketAlerts(items),
    cta: { label: '詳細な参考見積書PDF（業者交渉用）', price_jpy: 5500, url: '/reverse-estimate/purchase' },
    _meta: { engine: 'HS_PLAN_ENGINE v1 + Hearing v1' }
  });
}


function generateSessionId() {
  return 'hs_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}


async function callClaudeForHearing(text, env) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{ role: 'user', content: HEARING_PROMPT + text }]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API ${response.status}: ${errText.substring(0, 200)}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text || '';
  const cleaned = content.replace(/```json\s*|\s*```/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error('JSONパース失敗: ' + cleaned.substring(0, 200));
  }
}


async function fetchTradeDB() {
  const r = await fetch(`${REPO_BASE}/trade_prices_jusetsu.json`);
  if (!r.ok) return {};
  return await r.json();
}

async function fetchNeededCategoryDBs(items) {
  const needed = [...new Set(items.map(it => KOJI_TYPE_MAP[it.koji_type]?.db).filter(Boolean))];
  const result = {};
  await Promise.all(needed.map(async (catName) => {
    try {
      const r = await fetch(`${REPO_BASE}/${catName}.json`);
      if (r.ok) result[catName] = await r.json();
    } catch (e) {}
  }));
  return result;
}


function getMarketAlerts(items) {
  const alerts = [];
  const types = new Set(items.map(i => i.koji_type));
  if (types.has('bathroom') || types.has('toilet')) {
    alerts.push({ severity: 'critical', title: '🚨 TOTO/LIXIL 受注停止中（2026/4/13〜）',
      message: 'ユニットバス・トイレユニット新規受注停止。タカラスタンダード（ホーロー）推奨。' });
  }
  if (types.has('gaiheki') || types.has('roof') || types.has('naishou_tosou')) {
    alerts.push({ severity: 'high', title: '🚨 塗料メーカー大幅値上げ',
      message: '日本ペイント+75%・関西ペイント+50%・エスケー化研+15-25%（2026/3-4月）' });
  }
  if (types.has('aircon')) {
    alerts.push({ severity: 'high', title: '🚨 因幡電工 冷媒配管+20%値上げ',
      message: '2026年2月以降、銅・石油原料高により+20%。' });
  }
  if (types.has('rain_leak') || types.has('roof') || types.has('bankin')) {
    alerts.push({ severity: 'high', title: '🚨 ルーフィング+40-50%値上げ（2026/5/1〜）',
      message: '雨漏り修理・屋根工事は5月以降値上げの可能性' });
  }
  return alerts;
}


// ============================================================
// HS_PLAN_ENGINE 内蔵版
// ============================================================
const KOJI_TYPE_MAP = {
  kitchen:       { db: 'kitchen_reform',       trade_key: 'kitchen' },
  bathroom:      { db: 'bathroom_reform',      trade_key: 'bathroom' },
  toilet:        { db: 'toilet_reform',        trade_key: 'toilet' },
  washroom:      { db: 'washroom_reform',      trade_key: 'washroom_vanity' },
  floor:         { db: 'floor_replacement_v2', trade_key: 'floor_materials',
                   grade_map: { matsu: 'solid_wood_flooring', take: 'composite_flooring', ume: 'CF_cushion_floor' } },
  cloth:         { db: 'cloth_replacement',    trade_key: 'cloth_wallpaper',
                   grade_map: { matsu: 'premium_vinyl_kinofu', take: 'standard_vinyl', ume: 'standard_vinyl' } },
  tatami:        { db: 'tatami_reform' },
  water_heater:  { db: 'water_heater_reform',  trade_key: 'water_heater',
                   grade_map: { matsu: 'hybrid_heater', take: 'ecocute_460L_standard_exchange', ume: 'gas_heater_eco_jozu_exchange' } },
  electrical:    { db: 'electrical_work' },
  water_pipe:    { db: 'water_pipe_work' },
  aircon:        { db: 'aircon_work',
                   grade_map: { matsu: 'two_unit_200v', take: 'one_unit_with_outlet', ume: 'one_unit_standard' } },
  roof:          { db: 'roof_construction' },
  gaiheki:       { db: 'gaiheki_tosou' },
  insulation:    { db: 'insulation_work' },
  termite:       { db: 'termite_work' },
  taishin:       { db: 'taishin_hokyou',
                   grade_map: { matsu: 'full_taishin_package', take: 'kabe_hokyou_10kabe_full', ume: 'kabe_hokyou_3kabe' } },
  window:        { db: 'window_reform',        trade_key: 'window',
                   grade_map: { matsu: 'inner_window_whole_house_6_S_grade', take: 'inner_window_whole_house_6', ume: 'glass_only_all_windows' } },
  entrance_door: { db: 'entrance_door_reform', trade_key: 'entrance_door' },
  waterproof:    { db: 'waterproofing_work' },
  rain_leak:     { db: 'rain_leak_repair' },
  sakan:         { db: 'sakan_work' },
  tile:          { db: 'tile_renga_work' },
  bankin:        { db: 'bankin_work' },
  naishou_tosou: { db: 'naishou_tosou' },
  barrier_free:  { db: 'barrier_free_kaigo' },
  demolition:    { db: 'demolition_master' },
  gaikou:        { db: 'gaikou_work' },
  amido:         { db: 'amido_amado_shutter' },
  commercial:    { db: 'commercial_tenpo_work' }
};

const PLAN_PROFIT_MULTIPLIER = {
  matsu: { name: '理想プラン（松）', multiplier_min: 1.12, multiplier_max: 1.18,
           target_business: '区分4: 大手リフォーム', pros: ['ブランド安心', '長期保証'], cons: ['価格最高帯'] },
  take:  { name: '推奨プラン（竹）', multiplier_min: 1.00, multiplier_max: 1.03,
           target_business: '★区分2: 中小工務店（HS推奨）', pros: ['適正価格', '地域密着'], cons: ['ブランド力は区分4に劣る'] },
  ume:   { name: '最安プラン（梅）', multiplier_min: 0.85, multiplier_max: 0.95,
           target_business: '区分1: 個人事業+ネット調達', pros: ['最安帯'], cons: ['保証短い可能性'] }
};

function avgRange(r) {
  if (!r) return 0;
  if (typeof r === 'number') return r;
  if (r.min !== undefined && r.max !== undefined) return (r.min + r.max) / 2;
  return 0;
}

function getMaterialLabel(k) {
  const m = {
    CF_cushion_floor: 'クッションフロア',
    floor_tile: 'フロアタイル',
    composite_flooring: '複合フローリング',
    solid_wood_flooring: '無垢材フローリング',
    standard_vinyl: '標準ビニルクロス',
    premium_vinyl_kinofu: '機能性クロス'
  };
  return m[k] || k;
}

function extractPlanPrice(planData, planType) {
  if (!planData) return null;
  const price = planData.HS基準価格_万円 ||
    (planData.hs_rule_estimate_jpy ? planData.hs_rule_estimate_jpy / 10000 : null) ||
    (planData.estimated_total_jpy ? avgRange(planData.estimated_total_jpy) / 10000 : null);
  if (!price) return null;
  const mul = (PLAN_PROFIT_MULTIPLIER[planType].multiplier_min + PLAN_PROFIT_MULTIPLIER[planType].multiplier_max) / 2;
  return {
    name: planData.name,
    total_man_en: Math.round(price * mul),
    total: Math.round(price * mul * 10000),
    message: `${planData.name}（${PLAN_PROFIT_MULTIPLIER[planType].target_business}）`
  };
}

function buildTradePlan(gradeData, installTotal, planType, makerName, gradeName) {
  if (!gradeData) return null;
  const priceRange = gradeData.売れ筋価格帯_万円 || gradeData.売れ筋施工費込み_万円 ||
    gradeData.定価帯_1616_万円 || gradeData.定価帯_w750_万円 || gradeData.定価帯_万円;
  if (!priceRange) return null;
  const unitPrice = avgRange(priceRange);
  const installAvg = installTotal ? avgRange(installTotal) : 0;
  const subtotal = unitPrice + installAvg;
  const mul = (PLAN_PROFIT_MULTIPLIER[planType].multiplier_min + PLAN_PROFIT_MULTIPLIER[planType].multiplier_max) / 2;
  const total_man_en = Math.round(subtotal * mul);
  return {
    maker: makerName, series: gradeData.series, grade: gradeName,
    total: total_man_en * 10000, total_man_en,
    message: `${makerName} ${gradeData.series}（${gradeName}グレード）`,
    net_price_hint_man_en: gradeData.ネット販売価格_typical_万円 || null,
    trade_price_hint_man_en: gradeData.業者仕入れ値_typical_万円 || null
  };
}

function computeFromTradeDB(item, mapping, tradeCategoryData) {
  const { koji_type, area } = item;
  const result = { koji_type, category_name: mapping.db, area };

  if (koji_type === 'floor' || koji_type === 'cloth') {
    const mats = tradeCategoryData.materials;
    const sqm = area || 12.96;
    ['matsu', 'take', 'ume'].forEach(t => {
      const key = mapping.grade_map[t];
      const unitP = avgRange(mats[key]?.施工費込み_per_sqm);
      const mul = t === 'matsu' ? PLAN_PROFIT_MULTIPLIER.matsu.multiplier_max :
                  t === 'take'  ? PLAN_PROFIT_MULTIPLIER.take.multiplier_min :
                                  PLAN_PROFIT_MULTIPLIER.ume.multiplier_min;
      result[t] = {
        name: key, sqm, unit_price: unitP,
        total: Math.round(unitP * sqm * mul),
        total_man_en: Math.round(unitP * sqm * mul / 10000),
        message: `${getMaterialLabel(key)}施工`
      };
    });
    return result;
  }

  if (koji_type === 'window' || koji_type === 'entrance_door' || koji_type === 'water_heater') {
    return { _needs_souba_db: true, koji_type };
  }

  const makers = tradeCategoryData.manufacturers;
  const installTotal = tradeCategoryData.installation_cost_jpy?.total_typical_万円;
  const defaultMaker = koji_type === 'kitchen' ? 'LIXIL' : 'TOTO';
  const budgetMaker = koji_type === 'bathroom' ? 'タカラスタンダード' : defaultMaker;

  result.matsu = buildTradePlan(makers[defaultMaker]?.lineup_by_grade?.最上位, installTotal, 'matsu', defaultMaker, '最上位');
  result.take  = buildTradePlan(makers[defaultMaker]?.lineup_by_grade?.中位,   installTotal, 'take',  defaultMaker, '中位');
  result.ume   = buildTradePlan(makers[budgetMaker]?.lineup_by_grade?.下位,    installTotal, 'ume',   budgetMaker, '下位');

  // レイアウト変更コスト加算（TOshi指摘対応）
  if (item.specifics?.layout_change) {
    const extraCostMap = {
      'I_to_L': 40,
      'I_to_island': 100,
      'wall_removal': 50,
      'structural_wall': 200
    };
    const extra = extraCostMap[item.specifics.layout_change] || 0;
    if (extra && result.matsu) { result.matsu.total_man_en += extra; result.matsu.total += extra * 10000; }
    if (extra && result.take)  { result.take.total_man_en  += extra; result.take.total  += extra * 10000; }
    if (extra && result.ume)   { const e = Math.round(extra * 0.8); result.ume.total_man_en += e; result.ume.total += e * 10000; }
  }

  return result;
}

function computeFromSoubaDB(item, mapping, soubaDB) {
  const cd = soubaDB[mapping.db];
  if (!cd) return { error: `Category ${mapping.db} not found`, koji_type: item.koji_type };
  const pf = Object.keys(cd).find(k => k.toLowerCase().includes('plan') && k !== 'plans_template');
  if (!pf) return { error: `No plans`, koji_type: item.koji_type };
  const plans = cd[pf];
  const result = { koji_type: item.koji_type, category_name: mapping.db };
  const isList = Array.isArray(plans);
  const keys = isList ? plans.map((_, i) => i) : Object.keys(plans);

  if (mapping.grade_map && !isList) {
    result.matsu = extractPlanPrice(plans[mapping.grade_map.matsu], 'matsu');
    result.take  = extractPlanPrice(plans[mapping.grade_map.take],  'take');
    result.ume   = extractPlanPrice(plans[mapping.grade_map.ume],   'ume');
  } else {
    const len = keys.length;
    const getP = (i) => isList ? plans[i] : plans[keys[i]];
    result.matsu = len > 0 ? extractPlanPrice(getP(Math.min(len - 1, Math.floor(len * 0.75))), 'matsu') : null;
    result.take  = len > 0 ? extractPlanPrice(getP(Math.floor(len / 2)), 'take') : null;
    result.ume   = len > 0 ? extractPlanPrice(getP(Math.floor(len * 0.15)), 'ume') : null;
  }
  return result;
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

function generatePlans(items, soubaDB, tradeDB) {
  const results = items.map(it => computeItemPlan(it, soubaDB, tradeDB));
  const totals = { matsu: 0, take: 0, ume: 0 };
  const valid  = { matsu: [], take: [], ume: [] };
  const errors = [];
  for (const r of results) {
    if (r.error) { errors.push(r); continue; }
    ['matsu', 'take', 'ume'].forEach(t => {
      if (r[t]?.total) {
        totals[t] += r[t].total;
        valid[t].push({ koji_type: r.koji_type, ...r[t] });
      }
    });
  }
  return {
    matsu: { ...PLAN_PROFIT_MULTIPLIER.matsu, total: totals.matsu, total_man_en: Math.round(totals.matsu / 10000), items: valid.matsu,
             summary: `大手相場: ¥${totals.matsu.toLocaleString()}` },
    take:  { ...PLAN_PROFIT_MULTIPLIER.take,  total: totals.take,  total_man_en: Math.round(totals.take / 10000),  items: valid.take,
             summary: `★中小工務店相場: ¥${totals.take.toLocaleString()}（HS推奨）` },
    ume:   { ...PLAN_PROFIT_MULTIPLIER.ume,   total: totals.ume,   total_man_en: Math.round(totals.ume / 10000),   items: valid.ume,
             summary: `個人+ネット調達相場: ¥${totals.ume.toLocaleString()}` },
    errors
  };
}


// ============================================================
// 既存エンドポイント: /anthropic
// ============================================================
async function handleAnthropic(request, env) {
  if (request.method !== 'POST') return jsonResponse({ error: 'POST only' }, 405);
  const body = await request.json();
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });
  const data = await r.json();
  return new Response(JSON.stringify(data), {
    status: r.status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}


async function handleKira(request, env) {
  if (request.method !== 'POST') return jsonResponse({ error: 'POST only' }, 405);
  const body = await request.json();
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });
  const data = await r.json();
  return new Response(JSON.stringify(data), {
    status: r.status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}


async function handleNotify(request, env) {
  if (request.method !== 'POST') return jsonResponse({ error: 'POST only' }, 405);
  const { message } = await request.json();
  if (!message) return jsonResponse({ error: 'message required' }, 400);
  const r = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.LINE_CHANNEL_TOKEN}`
    },
    body: JSON.stringify({
      to: env.LINE_USER_ID,
      messages: [{ type: 'text', text: message.slice(0, 5000) }]
    })
  });
  return jsonResponse({ ok: r.ok, status: r.status });
}


async function handleSendEmail(request, env) {
  if (request.method !== 'POST') return jsonResponse({ error: 'POST only' }, 405);
  const { to, subject, html, text } = await request.json();
  if (!to || !subject) return jsonResponse({ error: 'to and subject required' }, 400);
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: 'kira@the-horizons-innovation.com',
      to: [to],
      subject,
      html: html || `<p>${text || ''}</p>`,
      text: text || ''
    })
  });
  const data = await r.json().catch(() => ({}));
  return jsonResponse({ ok: r.ok, status: r.status, data });
}


async function handleStats(request, env) {
  return jsonResponse({
    ok: true,
    version: 'v4.0.0-reverse-estimate',
    features: ['anthropic-proxy', 'kira-inspect', 'line-notify', 'resend-email', 'reverse-estimate-with-hearing'],
    updated: '2026-04-20'
  });
}


function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS }
  });
}
