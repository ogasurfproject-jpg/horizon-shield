/**
 * hs-kira-proxy /reverse-estimate エンドポイント
 *
 * ===== TOshi 実装手順 =====
 * 1. 既存 hs-kira-proxy Worker のメインfetchハンドラ内に
 *    `if (path === '/reverse-estimate')` の分岐を追加
 * 2. 以下の関数とハンドラをWorkerコードにコピペ
 * 3. KV バインド確認: SOUBA_DB (optional - なければGitHub直接fetch)
 *
 * ===== 入出力仕様 =====
 *
 * POST /reverse-estimate
 * Body: {
 *   natural_language_input: "6畳の和室をフローリングに、キッチンも手頃なもの",
 *   user_context: {  // optional
 *     address_zone: "関東",  // 地域係数（未使用、将来対応）
 *     building_age: 20,      // 築年数
 *     floor_plan: "2LDK"
 *   }
 * }
 *
 * Response: {
 *   extracted_items: [
 *     { koji_type: "floor", area: 9.72, grade_hint: "standard", raw_text: "6畳の和室をフローリング" },
 *     { koji_type: "kitchen", grade_hint: "affordable", raw_text: "キッチンも手頃なもの" }
 *   ],
 *   plans: {
 *     matsu: { total, total_man_en, items[], summary, ... },
 *     take:  { ... },
 *     ume:   { ... }
 *   },
 *   disclaimer: "本結果は相場に基づく参考価格提示であり、建設業法上の正式見積もりではありません",
 *   cta: { label: "詳細な参考見積書PDF（業者交渉用）", price_jpy: 5500, url: "/reverse-estimate/purchase" }
 * }
 */


// ========================================
// 自然言語 → 工事項目抽出プロンプト
// ========================================
const EXTRACT_PROMPT = `あなたはリフォーム工事の項目抽出専門AIです。
施主の自然言語の要望から、工事項目を構造化JSONで抽出してください。

【抽出ルール】
1. 必ず以下のJSONフォーマットで返す（他の文章は一切含めない）
2. 1つの要望に複数の工事項目が含まれる場合、すべて抽出する
3. 面積が明示されていない場合：
   - 「6畳」→ area: 9.72 (1畳=1.62㎡)
   - 「8畳」→ 12.96
   - 「10畳」→ 16.2
   - 「12畳LDK」→ 19.44
   - 面積不明 → area: null
4. grade_hint は以下の3値のいずれか：
   - "premium" : 「最高級」「こだわり」「ハイグレード」等
   - "standard": 明示なし、または「普通」「標準」
   - "affordable": 「手頃」「安く」「最安」「予算抑えめ」等

【koji_type 一覧】
- kitchen: キッチン、システムキッチン
- bathroom: 浴室、お風呂、ユニットバス
- toilet: トイレ、便器
- washroom: 洗面所、洗面化粧台
- floor: 床、フローリング
- cloth: 壁紙、クロス
- tatami: 畳
- water_heater: 給湯器、エコキュート、エネファーム
- electrical: 電気工事、コンセント、照明
- aircon: エアコン
- roof: 屋根
- gaiheki: 外壁、塗装
- insulation: 断熱
- window: 窓、内窓、二重窓
- entrance_door: 玄関ドア
- waterproof: 防水
- rain_leak: 雨漏り
- sakan: 左官、漆喰、珪藻土
- tile: タイル、れんが
- bankin: 雨樋、棟板金、板金
- naishou_tosou: 内装塗装
- taishin: 耐震、耐震補強
- termite: シロアリ、防蟻
- barrier_free: バリアフリー、手すり、段差解消
- demolition: 解体
- gaikou: 外構、庭、駐車場
- amido: 網戸、雨戸、シャッター
- commercial: 店舗、テナント

【出力フォーマット】
{
  "items": [
    {
      "koji_type": "floor",
      "area": 9.72,
      "grade_hint": "standard",
      "raw_text": "6畳の和室をフローリング"
    }
  ]
}

抽出対象の文章：
`;


// ========================================
// Worker ハンドラ本体（既存Workerに組み込む）
// ========================================
async function handleReverseEstimate(request, env) {
  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'POST only' }, 405);
  }

  try {
    const body = await request.json();
    const { natural_language_input, user_context = {} } = body;

    if (!natural_language_input || typeof natural_language_input !== 'string') {
      return jsonResponse({ error: 'natural_language_input is required' }, 400);
    }

    // Step 1: Claude APIで工事項目抽出
    const extractedItems = await extractItemsFromNL(natural_language_input, env);
    if (!extractedItems || extractedItems.length === 0) {
      return jsonResponse({
        error: '工事項目を抽出できませんでした。もう少し具体的にお書きください。',
        example: "例: 「6畳の和室をフローリングに張り替え、キッチンも手頃なものに交換」"
      }, 422);
    }

    // Step 2: DB取得（GitHub Pagesから直fetch - KV無しでも動くように）
    const [soubaIndex, tradeDB] = await Promise.all([
      fetchSoubaIndex(),
      fetchTradeDB()
    ]);

    // Step 3: 各工事項目の該当カテゴリDBを取得
    const neededCategories = [...new Set(
      extractedItems
        .map(item => KOJI_TYPE_MAP[item.koji_type]?.db)
        .filter(Boolean)
    )];

    const soubaDB = {};
    await Promise.all(
      neededCategories.map(async (catName) => {
        try {
          soubaDB[catName] = await fetchCategoryData(catName);
        } catch (e) {
          console.log(`Failed to fetch ${catName}:`, e.message);
        }
      })
    );

    // Step 4: 3プラン算出
    const plans = generatePlans(extractedItems, soubaDB, tradeDB);

    // Step 5: 免責事項とCTA付きで返す
    return jsonResponse({
      extracted_items: extractedItems,
      plans,
      disclaimer: "本結果は国土交通省・メーカー公式データ等に基づく相場の参考価格提示であり、建設業法上の正式見積もりではありません。施工業者との契約は別途行ってください。",
      cta: {
        label: "詳細な参考見積書PDF（業者交渉用・全項目の内訳表示・Red Flag警告付き）",
        price_jpy: 5500,
        url: "/reverse-estimate/purchase"
      },
      market_alerts: getMarketAlerts(extractedItems),
      _meta: {
        engine: "HS_PLAN_ENGINE v1.0",
        philosophy: "TOshi Rule: 業者規模別妥当利益率の透明化"
      }
    });

  } catch (error) {
    return jsonResponse({
      error: 'Internal error',
      message: error.message
    }, 500);
  }
}


// ========================================
// Claude API: 自然言語 → 工事項目抽出
// ========================================
async function extractItemsFromNL(text, env) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        { role: 'user', content: EXTRACT_PROMPT + text }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Claude API failed: ${response.status}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text || '';

  // JSONパース（```json フェンス除去）
  const cleaned = content.replace(/```json\s*|\s*```/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return parsed.items || [];
  } catch (e) {
    console.log('JSON parse failed:', cleaned);
    return [];
  }
}


// ========================================
// DB取得ヘルパー（GitHub Pages直fetch）
// ========================================
const REPO_BASE = 'https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/souba-v2';

async function fetchSoubaIndex() {
  const r = await fetch(`${REPO_BASE}/HS_SOUBA_INDEX.json`);
  return r.json();
}

async function fetchTradeDB() {
  const r = await fetch(`${REPO_BASE}/trade_prices_jusetsu.json`);
  return r.json();
}

async function fetchCategoryData(categoryName) {
  const r = await fetch(`${REPO_BASE}/${categoryName}.json`);
  if (!r.ok) throw new Error(`${categoryName}.json not found`);
  return r.json();
}


// ========================================
// 2026/4 市場警告アラート生成
// ========================================
function getMarketAlerts(items) {
  const alerts = [];
  const kojiTypes = new Set(items.map(i => i.koji_type));

  if (kojiTypes.has('bathroom') || kojiTypes.has('toilet')) {
    alerts.push({
      severity: 'critical',
      title: '🚨 TOTO/LIXIL 受注停止中（2026/4/13〜）',
      message: 'ユニットバス・トイレユニット新規受注停止中。タカラスタンダード（ホーロー）での代替を推奨。'
    });
  }

  if (kojiTypes.has('gaiheki') || kojiTypes.has('roof') || kojiTypes.has('naishou_tosou')) {
    alerts.push({
      severity: 'high',
      title: '🚨 塗料メーカー大幅値上げ',
      message: '日本ペイント シンナー+75%・関西ペイント+50%・エスケー化研+15-25%（2026/3-4月）'
    });
  }

  if (kojiTypes.has('aircon')) {
    alerts.push({
      severity: 'high',
      title: '🚨 因幡電工 冷媒配管+20%値上げ',
      message: '2026年2月以降、銅・石油原料高により冷媒配管が実質+20%。エアコン追加工事費に影響'
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


// ========================================
// ユーティリティ
// ========================================
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    }
  });
}


// ========================================
// 【既存Workerに追加する箇所】
// ========================================
/*
  既存 hs-kira-proxy Worker の fetch ハンドラ内に以下を追加：

  export default {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      const path = url.pathname;

      // ... 既存の /anthropic, /notify, /send-email, /stats ...

      // ★新規追加★
      if (path === '/reverse-estimate') {
        return handleReverseEstimate(request, env);
      }

      // ... (default handler) ...
    }
  };

  そして handleReverseEstimate 関数と、
  HS_PLAN_ENGINE.js からの generatePlans, computeItemPlan, KOJI_TYPE_MAP を
  同じWorkerファイル内に含める（bundleする）。
*/
