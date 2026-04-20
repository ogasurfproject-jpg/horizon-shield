/**
 * hs-kira-proxy v4 FULL - Cloudflare Workers
 *
 * ===== このファイルをCloudflareに貼付ければ動く完全版 =====
 *
 * エンドポイント:
 *   POST /anthropic        - Claude API汎用プロキシ
 *   POST /kira             - KIRA専用プロキシ（inspect/widget.html用）
 *   POST /notify           - LINE通知
 *   POST /send-email       - Resendメール送信
 *   GET  /stats            - 稼働確認
 *   POST /reverse-estimate - 🆕 逆見積もりシステム（ヒアリング型）
 *
 * ===== TOshi 貼付け手順 =====
 *  1. https://dash.cloudflare.com/ → Workers & Pages
 *  2. hs-kira-proxy を開く → 「編集」
 *  3. Cmd+A 全選択 → Delete → 本ファイル内容を貼付け
 *  4. 「デプロイ」クリック
 *  5. 環境変数確認:
 *     - ANTHROPIC_API_KEY （必須）
 *     - LINE_CHANNEL_TOKEN （必須）
 *     - LINE_USER_ID = Uc7165565cb48b408eb3af5dc07a72a28
 *     - RESEND_API_KEY （必須）
 */


// ==========================================
// 逆見積もり ヒアリング判定プロンプト
// ==========================================
const HEARING_PROMPT = `あなたは HORIZON SHIELD の AI版凄腕CMR「KIRA」です。
建設30年の大工・現場監督経験を持ち、施主から工事の要望を聞き取り、3プラン（松竹梅）を提示する役割です。

【あなたの判断基準】
プロの現場監督は、絶対に抽象的な要望では見積もりを出しません。必ず以下を確認してから見積もりを出します：

▼ 必須情報（全工事共通）
1. 該当部屋の広さ（畳数 or ㎡）
2. 築年数
3. 予算感（500万前後 / 1000万前後 / 2000万超 など）

▼ カテゴリ別の必須情報
- キッチン: 現状サイズ（W2550/2700/3000mm等）、現状レイアウト（I型/L型/対面等）、希望レイアウト、食洗機/IH/ガスの希望
- 浴室: 現状サイズ（0.75坪/1坪=1616/1.25坪/1.5坪等）、在来 or UB、希望メーカー
- トイレ: 現状タイプ（タンク式/タンクレス）、床張替えの有無、ウォシュレット希望
- 床: 面積（畳数or㎡）、現状（畳/既存フローリング/CF）、希望（無垢/複合/CF/フロアタイル）
- 窓: 枚数（掃き出し/腰窓の数）、希望工法（内窓/カバー/はつり）
- 玄関ドア: 現状の状態、希望グレード、暗証番号/電気錠の希望
- 外壁: 建物規模、現状色、希望色、塗料グレード
- 屋根: 現状（瓦/スレート/金属）、面積、希望工法（塗装/カバー/葺替）
- 給湯器: 現状（ガス式/エコキュート）、号数/容量、家族人数
- 水回り全般: 築年数で配管寿命確認も必要
- 「リビングを広く」系: 撤去対象の壁が「構造壁」か「間仕切り壁」か

▼ レイアウト変更の金額差（非常に重要）
- I型→L型: +¥40-80万（配管/給排水の移設）
- I型→対面カウンター型: +¥60-120万
- I型→アイランド型: +¥100-200万（排気ダクト延長・給排水ルート変更・電源増設）
- 壁撤去（間仕切り）: +¥30-60万
- 壁撤去（構造壁）: +¥100-300万（梁補強必須）

【重要な判断ルール】
施主の入力情報 + 既に収集済み情報（collected）を見て：

A) 情報が「十分」→ status: "ready" を返す
   → extracted_items に工事項目JSONを出力
   → layout_change_cost_adj_万円 も明記（レイアウト変更時）

B) 情報が「不足」→ status: "need_hearing" を返す
   → 追加で聞くべき質問を最大3つ、選択肢付きで返す
   → 選択肢は具体的な数値/カテゴリ

【出力フォーマット - 必ずこのJSON形式、他の文字は一切含めない】

ケースA（ready）:
{
  "status": "ready",
  "kira_message": "必要な情報が揃いました。3プランをご提示します。",
  "extracted_items": [
    {
      "koji_type": "kitchen",
      "area": null,
      "grade_hint": "standard",
      "raw_text": "I型2550mm → アイランドキッチン変更",
      "layout_change": "I_to_island",
      "layout_change_cost_adj_万円": 150
    },
    {
      "koji_type": "floor",
      "area": 9.72,
      "grade_hint": "standard",
      "raw_text": "6畳和室 → フローリング化"
    }
  ]
}

ケースB（need_hearing）:
{
  "status": "need_hearing",
  "kira_message": "詳しくお聞かせください。",
  "clarifying_questions": [
    {
      "key": "kitchen_current_size",
      "question": "現在のキッチンのサイズ（幅）を教えてください",
      "options": ["2550mm", "2700mm", "3000mm", "不明"],
      "allow_custom": false
    },
    {
      "key": "kitchen_target_layout",
      "question": "希望のレイアウトは？",
      "options": ["I型のまま", "L型", "対面カウンター型", "アイランド型"],
      "allow_custom": false
    },
    {
      "key": "budget_range",
      "question": "予算感はいかがでしょうか？",
      "options": ["500万前後", "800-1200万", "1500-2000万", "予算は二の次"],
      "allow_custom": true
    }
  ]
}

【ヒアリングラウンドの上限】
- 初回含めて最大3ラウンドまで。
- ラウンド3を超えたら、不足情報は「標準的な想定」でreadyに強制移行し、注釈を kira_message に入れる。

【koji_type 一覧】
kitchen / bathroom / toilet / washroom / floor / cloth / tatami / water_heater / electrical / aircon / roof / gaiheki / insulation / window / entrance_door / waterproof / rain_leak / sakan / tile / bankin / naishou_tosou / taishin / termite / barrier_free / demolition / gaikou / amido / commercial

【必ず厳守】
- 返答は上記のJSONのみ。他の文章・コードフェンスは一切含めない。`;


// ==========================================
// Main Handler
// ==========================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, x-api-key, anthropic-version, Authorization',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    try {
      if (path === '/reverse-estimate') return handleReverseEstimate(request, env);
      if (path === '/anthropic') return handleAnthropicProxy(request, env);
      if (path === '/kira') return handleAnthropicProxy(request, env);
      if (path === '/notify') return handleLineNotify(request, env);
      if (path === '/send-email') return handleSendEmail(request, env);
      if (path === '/stats') return jsonResponse({
        ok: true,
        version: 'hs-kira-proxy v4.0.0',
        endpoints: ['/anthropic', '/kira', '/notify', '/send-email', '/stats', '/reverse-estimate'],
      });
      return jsonResponse({ error: 'Not Found', path }, 404);
    } catch (error) {
      return jsonResponse({ error: error.message }, 500);
    }
  }
};


// ==========================================
// /reverse-estimate - ヒアリング型逆見積もり
// ==========================================
async function handleReverseEstimate(request, env) {
  if (request.method !== 'POST') return jsonResponse({ error: 'POST only' }, 405);

  const body = await request.json();
  const { initial_input = '', collected = {}, round = 0 } = body;

  if (!initial_input) return jsonResponse({ error: 'initial_input is required' }, 400);

  const userContent = `初回入力: ${initial_input}

既に収集済みの情報:
${JSON.stringify(collected, null, 2)}

ヒアリングラウンド: ${round} / 3

上記を踏まえて、判断（ready or need_hearing）を JSON で返してください。`;

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: HEARING_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      return jsonResponse({ error: 'Claude API error', detail: errText.slice(0, 500) }, 500);
    }

    const claudeData = await claudeRes.json();
    const text = claudeData.content?.[0]?.text || '';
    const cleaned = text.replace(/```json\s*|\s*```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return jsonResponse({
        error: 'Failed to parse Claude response as JSON',
        raw: cleaned.slice(0, 500)
      }, 500);
    }

    // ready なら3プラン算出
    if (parsed.status === 'ready' && parsed.extracted_items) {
      const soubaDB = await fetchAllSoubaData(parsed.extracted_items);
      const tradeDB = await fetchTradeDB();
      const plans = generatePlans(parsed.extracted_items, soubaDB, tradeDB);
      const market_alerts = getMarketAlerts(parsed.extracted_items);

      return jsonResponse({
        status: 'ready',
        kira_message: parsed.kira_message,
        extracted_items: parsed.extracted_items,
        plans,
        market_alerts,
        disclaimer: '本結果は相場に基づく参考価格提示であり、建設業法上の正式見積もりではありません。HORIZON SHIELDは施工を行いません。施工業者との契約は別途行ってください。',
      });
    }

    return jsonResponse(parsed);

  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}


// ==========================================
// /anthropic - Claude API 汎用プロキシ
// ==========================================
async function handleAnthropicProxy(request, env) {
  if (request.method !== 'POST') return jsonResponse({ error: 'POST only' }, 405);
  const body = await request.text();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body,
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    }
  });
}


// ==========================================
// /notify - LINE通知
// ==========================================
async function handleLineNotify(request, env) {
  if (request.method !== 'POST') return jsonResponse({ error: 'POST only' }, 405);
  const body = await request.json();
  const { message } = body;
  if (!message) return jsonResponse({ error: 'message required' }, 400);

  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.LINE_CHANNEL_TOKEN}`,
    },
    body: JSON.stringify({
      to: env.LINE_USER_ID,
      messages: [{ type: 'text', text: message.slice(0, 5000) }],
    }),
  });
  const resText = await res.text();
  return jsonResponse({ ok: res.ok, status: res.status, line_response: resText.slice(0, 300) });
}


// ==========================================
// /send-email - Resend
// ==========================================
async function handleSendEmail(request, env) {
  if (request.method !== 'POST') return jsonResponse({ error: 'POST only' }, 405);
  const body = await request.json();
  const { to, subject, html, text } = body;
  if (!to || !subject) return jsonResponse({ error: 'to and subject required' }, 400);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: 'kira@the-horizons-innovation.com',
      to: Array.isArray(to) ? to : [to],
      subject,
      html: html || text,
      text,
    }),
  });
  const resData = await res.json().catch(() => ({}));
  return jsonResponse({ ok: res.ok, status: res.status, resend_response: resData });
}


// ==========================================
// DB取得（GitHub Pages直fetch）
// ==========================================
const REPO_BASE = 'https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/souba-v2';

async function fetchTradeDB() {
  try {
    const r = await fetch(`${REPO_BASE}/trade_prices_jusetsu.json`);
    return await r.json();
  } catch { return {}; }
}

async function fetchCategoryData(categoryName) {
  try {
    const r = await fetch(`${REPO_BASE}/${categoryName}.json`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function fetchAllSoubaData(items) {
  const needed = [...new Set(items.map(it => KOJI_TYPE_MAP[it.koji_type]?.db).filter(Boolean))];
  const result = {};
  await Promise.all(needed.map(async cat => {
    const d = await fetchCategoryData(cat);
    if (d) result[cat] = d;
  }));
  return result;
}


// ==========================================
// KOJI_TYPE_MAP
// ==========================================
const KOJI_TYPE_MAP = {
  "kitchen":       { db: "kitchen_reform",       trade_key: "kitchen" },
  "bathroom":      { db: "bathroom_reform",      trade_key: "bathroom" },
  "toilet":        { db: "toilet_reform",        trade_key: "toilet" },
  "washroom":      { db: "washroom_reform",      trade_key: "washroom_vanity" },
  "floor":         { db: "floor_replacement_v2", trade_key: "floor_materials", grade_map: { matsu: "solid_wood_flooring", take: "composite_flooring", ume: "CF_cushion_floor" } },
  "cloth":         { db: "cloth_replacement",    trade_key: "cloth_wallpaper", grade_map: { matsu: "premium_vinyl_kinofu", take: "standard_vinyl", ume: "standard_vinyl" } },
  "tatami":        { db: "tatami_reform" },
  "water_heater":  { db: "water_heater_reform",  trade_key: "water_heater", grade_map: { matsu: "hybrid_heater", take: "ecocute_460L_standard_exchange", ume: "gas_heater_eco_jozu_exchange" } },
  "electrical":    { db: "electrical_work" },
  "water_pipe":    { db: "water_pipe_work" },
  "aircon":        { db: "aircon_work", grade_map: { matsu: "two_unit_200v", take: "one_unit_with_outlet", ume: "one_unit_standard" } },
  "roof":          { db: "roof_construction" },
  "gaiheki":       { db: "gaiheki_tosou" },
  "insulation":    { db: "insulation_work" },
  "termite":       { db: "termite_work" },
  "taishin":       { db: "taishin_hokyou", grade_map: { matsu: "full_taishin_package", take: "kabe_hokyou_10kabe_full", ume: "kabe_hokyou_3kabe" } },
  "window":        { db: "window_reform", trade_key: "window", grade_map: { matsu: "inner_window_whole_house_6_S_grade", take: "inner_window_whole_house_6", ume: "glass_only_all_windows" } },
  "entrance_door": { db: "entrance_door_reform", trade_key: "entrance_door" },
  "waterproof":    { db: "waterproofing_work" },
  "rain_leak":     { db: "rain_leak_repair" },
  "sakan":         { db: "sakan_work", grade_map: { matsu: "interior_shikkui_washitsu_20sqm", take: "keisou_do_living_25sqm", ume: "wall_morutaru_30sqm" } },
  "tile":          { db: "tile_renga_work" },
  "bankin":        { db: "bankin_work" },
  "naishou_tosou": { db: "naishou_tosou" },
  "barrier_free":  { db: "barrier_free_kaigo" },
  "demolition":    { db: "demolition_master" },
  "gaikou":        { db: "gaikou_work" },
  "amido":         { db: "amido_amado_shutter" },
  "commercial":    { db: "commercial_tenpo_work" }
};


// ==========================================
// PLAN_PROFIT_MULTIPLIER
// ==========================================
const PLAN_PROFIT_MULTIPLIER = {
  matsu: {
    name: "理想プラン（松）",
    description: "大手リフォーム会社品質",
    multiplier_min: 1.12, multiplier_max: 1.18,
    target_business: "区分4: 大手リフォーム・ハウスメーカー",
    pros: ["ブランド安心", "長期保証", "最上級グレード"],
    cons: ["価格最高帯", "下請け施工多い"]
  },
  take: {
    name: "推奨プラン（竹）",
    description: "地域中小工務店レベル",
    multiplier_min: 1.00, multiplier_max: 1.03,
    target_business: "★区分2: 中小工務店（HS第一推奨）",
    pros: ["適正価格", "地域密着", "アフター良好"],
    cons: ["ブランド力は区分4に劣る"]
  },
  ume: {
    name: "最安プラン（梅）",
    description: "個人事業・ネット調達活用",
    multiplier_min: 0.85, multiplier_max: 0.95,
    target_business: "区分1: 個人事業 + ネット販売価格",
    pros: ["最安帯", "職人直発注可"],
    cons: ["機種グレード低め", "保証短い可能性"]
  }
};


// ==========================================
// 3プラン生成エンジン
// ==========================================
function generatePlans(items, soubaDB, tradeDB) {
  const itemResults = items.map(item => computeItemPlan(item, soubaDB, tradeDB));
  const totals = { matsu: 0, take: 0, ume: 0 };
  const validItems = { matsu: [], take: [], ume: [] };
  const errors = [];

  for (const result of itemResults) {
    if (result.error) { errors.push(result); continue; }
    for (const planType of ['matsu', 'take', 'ume']) {
      if (result[planType]?.total) {
        totals[planType] += result[planType].total;
        validItems[planType].push({ koji_type: result.koji_type, ...result[planType] });
      }
    }
  }

  return {
    matsu: {
      ...PLAN_PROFIT_MULTIPLIER.matsu,
      total: totals.matsu, total_man_en: Math.round(totals.matsu / 10000),
      items: validItems.matsu,
      summary: `大手リフォーム相場 ¥${totals.matsu.toLocaleString()}`
    },
    take: {
      ...PLAN_PROFIT_MULTIPLIER.take,
      total: totals.take, total_man_en: Math.round(totals.take / 10000),
      items: validItems.take,
      summary: `★中小工務店相場 ¥${totals.take.toLocaleString()}（HS推奨）`
    },
    ume: {
      ...PLAN_PROFIT_MULTIPLIER.ume,
      total: totals.ume, total_man_en: Math.round(totals.ume / 10000),
      items: validItems.ume,
      summary: `個人+ネット調達 ¥${totals.ume.toLocaleString()}`
    },
    errors,
  };
}

function computeItemPlan(item, soubaDB, tradeDB) {
  const { koji_type } = item;
  const mapping = KOJI_TYPE_MAP[koji_type];
  if (!mapping) return { error: `Unknown: ${koji_type}`, koji_type };

  const layoutAdj = (item.layout_change_cost_adj_万円 || 0) * 10000;

  if (mapping.trade_key && tradeDB[mapping.trade_key]) {
    const result = computeFromTradeDB(item, mapping, tradeDB[mapping.trade_key]);
    if (result._needs_souba_db) return computeFromSoubaDB(item, mapping, soubaDB, layoutAdj);
    if (layoutAdj > 0) {
      ['matsu', 'take', 'ume'].forEach(k => {
        if (result[k]) { result[k].total += layoutAdj; result[k].total_man_en = Math.round(result[k].total / 10000); }
      });
    }
    return result;
  }
  return computeFromSoubaDB(item, mapping, soubaDB, layoutAdj);
}

function computeFromTradeDB(item, mapping, tradeData) {
  const { koji_type, area = null } = item;
  const result = { koji_type, area };

  if (koji_type === "floor" || koji_type === "cloth") {
    const materials = tradeData.materials;
    const sqm = area || 12.96;
    result.matsu = buildMaterialPlan(mapping.grade_map.matsu, materials, sqm, 'matsu');
    result.take  = buildMaterialPlan(mapping.grade_map.take,  materials, sqm, 'take');
    result.ume   = buildMaterialPlan(mapping.grade_map.ume,   materials, sqm, 'ume');
    return result;
  }

  if (koji_type === "window" || koji_type === "entrance_door" || koji_type === "water_heater") {
    return { _needs_souba_db: true, koji_type };
  }

  // 住設系（キッチン/バス/トイレ/洗面）
  const makers = tradeData.manufacturers;
  const installCost = tradeData.installation_cost_jpy;
  const installTotal = installCost?.total_typical_万円;
  const defaultMaker = koji_type === "kitchen" ? "LIXIL" : "TOTO";
  const budgetMaker = koji_type === "bathroom" ? "タカラスタンダード" : defaultMaker;

  result.matsu = buildTradePlan(makers[defaultMaker]?.lineup_by_grade?.最上位, installTotal, "matsu", defaultMaker, "最上位");
  result.take  = buildTradePlan(makers[defaultMaker]?.lineup_by_grade?.中位,   installTotal, "take",  defaultMaker, "中位");
  result.ume   = buildTradePlan(makers[budgetMaker]?.lineup_by_grade?.下位,    installTotal, "ume",   budgetMaker, "下位");
  return result;
}

function buildMaterialPlan(key, materials, sqm, planType) {
  const unit = avgRange(materials[key]?.施工費込み_per_sqm);
  const mult = planType === 'matsu' ? PLAN_PROFIT_MULTIPLIER.matsu.multiplier_max
             : planType === 'ume'   ? PLAN_PROFIT_MULTIPLIER.ume.multiplier_min
             : PLAN_PROFIT_MULTIPLIER.take.multiplier_min;
  const total = Math.round(unit * sqm * mult);
  return {
    name: key, sqm, unit_price: unit,
    total, total_man_en: Math.round(total / 10000),
    message: `${getMaterialLabel(key)} ${sqm}㎡`
  };
}

function buildTradePlan(gradeData, installTotal, planType, maker, grade) {
  if (!gradeData) return null;
  const priceRange = gradeData.売れ筋価格帯_万円 || gradeData.売れ筋施工費込み_万円 ||
                     gradeData.定価帯_1616_万円 || gradeData.定価帯_w750_万円 || gradeData.定価帯_万円;
  if (!priceRange) return null;
  const unitPrice = avgRange(priceRange);
  const installAvg = installTotal ? avgRange(installTotal) : 0;
  const subtotal = unitPrice + installAvg;
  const mult = (PLAN_PROFIT_MULTIPLIER[planType].multiplier_min + PLAN_PROFIT_MULTIPLIER[planType].multiplier_max) / 2;
  const totalManEn = Math.round(subtotal * mult);
  return {
    maker, series: gradeData.series, grade,
    total: totalManEn * 10000, total_man_en: totalManEn,
    message: `${maker} ${gradeData.series}（${grade}）`,
    net_price_hint_man_en: gradeData.ネット販売価格_typical_万円 || null
  };
}

function computeFromSoubaDB(item, mapping, soubaDB, layoutAdj = 0) {
  const categoryData = soubaDB[mapping.db];
  if (!categoryData) return { error: `No data: ${mapping.db}`, koji_type: item.koji_type };
  const plansField = Object.keys(categoryData).find(k => k.toLowerCase().includes('plan') && k !== 'plans_template');
  if (!plansField) return { error: `No plans`, koji_type: item.koji_type };
  const plans = categoryData[plansField];
  const result = { koji_type: item.koji_type };

  const isPlanList = Array.isArray(plans);
  const planKeys = isPlanList ? plans.map((_, i) => i) : Object.keys(plans);

  if (mapping.grade_map && !isPlanList) {
    result.matsu = extractPlanPrice(plans[mapping.grade_map.matsu], "matsu", layoutAdj);
    result.take  = extractPlanPrice(plans[mapping.grade_map.take],  "take",  layoutAdj);
    result.ume   = extractPlanPrice(plans[mapping.grade_map.ume],   "ume",   layoutAdj);
  } else {
    const len = planKeys.length;
    const mIdx = Math.min(len - 1, Math.floor(len * 0.75));
    const tIdx = Math.floor(len / 2);
    const uIdx = Math.floor(len * 0.15);
    const get = (i) => isPlanList ? plans[i] : plans[planKeys[i]];
    result.matsu = extractPlanPrice(get(mIdx), "matsu", layoutAdj);
    result.take  = extractPlanPrice(get(tIdx), "take",  layoutAdj);
    result.ume   = extractPlanPrice(get(uIdx), "ume",   layoutAdj);
  }
  return result;
}

function extractPlanPrice(planData, planType, layoutAdj = 0) {
  if (!planData) return null;
  const price = planData.HS基準価格_万円 ||
                (planData.hs_rule_estimate_jpy ? planData.hs_rule_estimate_jpy / 10000 : null) ||
                (planData.estimated_total_jpy ? avgRange(planData.estimated_total_jpy) / 10000 : null);
  if (!price) return null;
  const mult = (PLAN_PROFIT_MULTIPLIER[planType].multiplier_min + PLAN_PROFIT_MULTIPLIER[planType].multiplier_max) / 2;
  const total = Math.round(price * mult * 10000) + layoutAdj;
  return {
    name: planData.name,
    total, total_man_en: Math.round(total / 10000),
    work_days: planData.work_days,
    message: planData.name
  };
}

function avgRange(r) {
  if (!r) return 0;
  if (typeof r === 'number') return r;
  if (r.min !== undefined && r.max !== undefined) return (r.min + r.max) / 2;
  return 0;
}

function getMaterialLabel(key) {
  const l = {
    CF_cushion_floor: "クッションフロア(CF)",
    floor_tile: "フロアタイル",
    composite_flooring: "複合フローリング",
    solid_wood_flooring: "無垢フローリング",
    standard_vinyl: "標準ビニルクロス",
    premium_vinyl_kinofu: "機能性クロス"
  };
  return l[key] || key;
}


// ==========================================
// Market Alerts
// ==========================================
function getMarketAlerts(items) {
  const alerts = [];
  const kojiTypes = new Set(items.map(i => i.koji_type));
  if (kojiTypes.has('bathroom') || kojiTypes.has('toilet')) {
    alerts.push({
      severity: 'critical',
      title: '🚨 TOTO/LIXIL 受注停止中（2026/4/13〜）',
      message: 'ユニットバス・トイレユニット新規受注停止中。タカラスタンダード（ホーロー）を推奨。'
    });
  }
  if (kojiTypes.has('gaiheki') || kojiTypes.has('roof') || kojiTypes.has('naishou_tosou')) {
    alerts.push({
      severity: 'high',
      title: '🚨 塗料メーカー大幅値上げ',
      message: '日本ペイント +75%・関西ペイント +50%・エスケー化研 +15-25%（2026/3-4月）'
    });
  }
  if (kojiTypes.has('aircon') || kojiTypes.has('water_heater')) {
    alerts.push({
      severity: 'high',
      title: '🚨 因幡電工 冷媒配管+20%値上げ',
      message: '2026年2月以降、銅・石油原料高により冷媒配管が実質+20%'
    });
  }
  if (kojiTypes.has('rain_leak') || kojiTypes.has('roof') || kojiTypes.has('bankin')) {
    alerts.push({
      severity: 'high',
      title: '🚨 ルーフィング+40-50%値上げ（2026/5/1〜）',
      message: '雨漏り修理・屋根工事は5月以降の着工が値上げ対象になる可能性'
    });
  }
  return alerts;
}


// ==========================================
// Utility
// ==========================================
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
