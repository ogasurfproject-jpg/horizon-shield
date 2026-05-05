/**
 * HORIZON SHIELD - Plan Engine v1.0
 *
 * 役割: 自然言語解析で抽出された工事項目JSONから、
 *       3プラン（松・竹・梅）の金額を自動算出する中核エンジン。
 *
 * 入力: { items: [{ koji_type, area, grade, manufacturer? }, ...] }
 * 出力: {
 *   matsu: { total, items[], message },  // 理想プラン
 *   take:  { total, items[], message },  // 推奨プラン
 *   ume:   { total, items[], message }   // 最安プラン
 * }
 *
 * 参照DB:
 *   - /souba-v2/HS_SOUBA_INDEX.json         （全30カテゴリインデックス）
 *   - /souba-v2/trade_prices_jusetsu.json   （住設仕入れ値/掛け率）
 *   - /souba-v2/{category}.json             （各カテゴリ詳細）
 *
 * TOshi哲学:
 *   - 業者を敵視しない、業者規模別の妥当利益率を透明化
 *   - 松=大手リフォーム価格帯 / 竹=中小工務店★推奨 / 梅=個人+ネット仕入れ
 *   - ネット販売価格 ≒ 業者仕入れ値 を施主に可視化
 */

// ========================================
// カテゴリ分類 → DBファイル/プランキーマッピング
// ========================================
const KOJI_TYPE_MAP = {
  // 水回り
  "kitchen":        { db: "kitchen_reform",       trade_key: "kitchen",         grade_map: { matsu: "最上位", take: "中位", ume: "下位" } },
  "bathroom":       { db: "bathroom_reform",      trade_key: "bathroom",        grade_map: { matsu: "最上位", take: "中位", ume: "下位" } },
  "toilet":         { db: "toilet_reform",        trade_key: "toilet",          grade_map: { matsu: "最上位", take: "中位", ume: "下位" } },
  "washroom":       { db: "washroom_reform",      trade_key: "washroom_vanity", grade_map: { matsu: "最上位", take: "中位", ume: "下位" } },

  // 床材・内装
  "floor":          { db: "floor_replacement_v2", trade_key: "floor_materials", grade_map: { matsu: "solid_wood_flooring", take: "composite_flooring", ume: "CF_cushion_floor" } },
  "cloth":          { db: "cloth_replacement",    trade_key: "cloth_wallpaper", grade_map: { matsu: "premium_vinyl_kinofu", take: "standard_vinyl", ume: "standard_vinyl" } },
  "tatami":         { db: "tatami_reform",        grade_map: { matsu: "新調_kokusan", take: "omote_gae_hyojun", ume: "ura_gaeshi" } },

  // 給湯・電気・水道
  "water_heater":   { db: "water_heater_reform",  trade_key: "water_heater",  grade_map: { matsu: "hybrid_heater", take: "ecocute_460L_standard_exchange", ume: "gas_heater_eco_jozu_exchange" } },
  "electrical":     { db: "electrical_work",      grade_map: null },
  "water_pipe":     { db: "water_pipe_work",      grade_map: null },
  "aircon":         { db: "aircon_work",          grade_map: { matsu: "two_unit_200v", take: "one_unit_with_outlet", ume: "one_unit_standard" } },

  // 外装・構造
  "roof":           { db: "roof_construction",    grade_map: null },
  "gaiheki":        { db: "gaiheki_tosou",        grade_map: null },
  "insulation":     { db: "insulation_work",      grade_map: null },
  "termite":        { db: "termite_work",         grade_map: null },
  "taishin":        { db: "taishin_hokyou",       grade_map: { matsu: "full_taishin_package", take: "kabe_hokyou_10kabe_full", ume: "kabe_hokyou_3kabe" } },

  // 窓・ドア
  "window":         { db: "window_reform",        trade_key: "window",        grade_map: { matsu: "inner_window_whole_house_6_S_grade", take: "inner_window_whole_house_6", ume: "glass_only_all_windows" } },
  "entrance_door":  { db: "entrance_door_reform", trade_key: "entrance_door", grade_map: null },

  // その他
  "waterproof":     { db: "waterproofing_work",   grade_map: null },
  "rain_leak":      { db: "rain_leak_repair",     grade_map: null },
  "sakan":          { db: "sakan_work",           grade_map: { matsu: "interior_shikkui_washitsu_20sqm", take: "keisou_do_living_25sqm", ume: "wall_morutaru_30sqm" } },
  "tile":           { db: "tile_renga_work",      grade_map: null },
  "bankin":         { db: "bankin_work",          grade_map: null },
  "naishou_tosou":  { db: "naishou_tosou",        grade_map: null },
  "barrier_free":   { db: "barrier_free_kaigo",   grade_map: null },
  "demolition":     { db: "demolition_master",    grade_map: null },
  "gaikou":         { db: "gaikou_work",          grade_map: null },
  "amido":          { db: "amido_amado_shutter",  grade_map: null },
  "commercial":     { db: "commercial_tenpo_work", grade_map: null }
};


// ========================================
// 業者タイプ別 利益率係数（HS基準係数）
// ========================================
const PLAN_PROFIT_MULTIPLIER = {
  matsu: {
    // 大手リフォーム想定：粗利35-45%
    name: "理想プラン（松）",
    description: "大手リフォーム会社品質・ブランド安心・フル機能",
    multiplier_min: 1.12,
    multiplier_max: 1.18,
    target_business: "区分4: 大手リフォーム・ハウスメーカー",
    pros: ["ブランド安心", "長期保証", "最新機種・最上級グレード"],
    cons: ["価格最高帯", "下請け施工が多い"]
  },
  take: {
    // 中小工務店想定：粗利25-35% ★HS推奨
    name: "推奨プラン（竹）",
    description: "地域密着・中小工務店レベル・必要十分な品質",
    multiplier_min: 1.00,
    multiplier_max: 1.03,
    target_business: "★区分2: 中小工務店（HS第一推奨）",
    pros: ["適正価格", "地域密着", "アフター良好", "中位グレード機種"],
    cons: ["ブランド力は区分4に劣る"]
  },
  ume: {
    // 個人事業+ネット調達想定：粗利20-30%
    name: "最安プラン（梅）",
    description: "個人事業・ネット調達活用・必要最小限",
    multiplier_min: 0.85,
    multiplier_max: 0.95,
    target_business: "区分1: 個人事業 + ネット販売価格活用",
    pros: ["最安帯", "職人直発注可能"],
    cons: ["機種グレード低め", "保証短い可能性"]
  }
};


// ========================================
// コア関数: 1つの工事項目 → 3プラン算出
// ========================================
function computeItemPlan(item, soubaDB, tradeDB) {
  const { koji_type, area, grade_hint } = item;
  const mapping = KOJI_TYPE_MAP[koji_type];

  if (!mapping) {
    return {
      error: `Unknown koji_type: ${koji_type}`,
      koji_type,
      matsu: null, take: null, ume: null
    };
  }

  // 住設系はtrade_prices参照
  if (mapping.trade_key && tradeDB[mapping.trade_key]) {
    const tradeResult = computeFromTradeDB(item, mapping, tradeDB[mapping.trade_key]);
    // フォールバックシグナルが立っていれば soubaDB 経由
    if (tradeResult._needs_souba_db) {
      return computeFromSoubaDB(item, mapping, soubaDB);
    }
    return tradeResult;
  }

  // その他はsoubaDB（各カテゴリplans）参照
  return computeFromSoubaDB(item, mapping, soubaDB);
}


function computeFromTradeDB(item, mapping, tradeCategoryData) {
  const { koji_type, area = null } = item;
  const result = {
    koji_type,
    category_name: mapping.db,
    area
  };

  // 床材・クロスは面積ベース
  if (koji_type === "floor" || koji_type === "cloth") {
    const materials = tradeCategoryData.materials;
    const sqm = area || 12.96;  // デフォルト8畳相当

    const matsuKey = mapping.grade_map.matsu;
    const takeKey = mapping.grade_map.take;
    const umeKey = mapping.grade_map.ume;

    result.matsu = {
      name: matsuKey,
      material_spec: getMaterialLabel(matsuKey),
      sqm,
      unit_price: avgRange(materials[matsuKey]?.施工費込み_per_sqm),
      total: Math.round(avgRange(materials[matsuKey]?.施工費込み_per_sqm) * sqm * PLAN_PROFIT_MULTIPLIER.matsu.multiplier_max),
      message: `大手リフォーム会社での${getMaterialLabel(matsuKey)}施工想定`
    };
    result.take = {
      name: takeKey,
      material_spec: getMaterialLabel(takeKey),
      sqm,
      unit_price: avgRange(materials[takeKey]?.施工費込み_per_sqm),
      total: Math.round(avgRange(materials[takeKey]?.施工費込み_per_sqm) * sqm * PLAN_PROFIT_MULTIPLIER.take.multiplier_min),
      message: `地域の中小工務店での${getMaterialLabel(takeKey)}施工想定（★推奨）`
    };
    result.ume = {
      name: umeKey,
      material_spec: getMaterialLabel(umeKey),
      sqm,
      unit_price: avgRange(materials[umeKey]?.施工費込み_per_sqm),
      total: Math.round(avgRange(materials[umeKey]?.施工費込み_per_sqm) * sqm * PLAN_PROFIT_MULTIPLIER.ume.multiplier_min),
      message: `個人事業+ネット調達活用での${getMaterialLabel(umeKey)}施工想定`
    };
    return result;
  }

  // window / entrance_door / water_heater は構造が違う → soubaDBにフォールバック
  if (koji_type === "window" || koji_type === "entrance_door" || koji_type === "water_heater") {
    // trade_key はあるが、soubaDB が使えるならそちらを優先（すでにv3.0で業者規模別価格あり）
    return { _needs_souba_db: true, koji_type };
  }

  // 住設系（キッチン/バス/トイレ/洗面）
  const makers = tradeCategoryData.manufacturers;
  const installCost = tradeCategoryData.installation_cost_jpy;
  const installTotal = installCost?.total_typical_万円;

  const defaultMaker = koji_type === "kitchen" ? "LIXIL" : "TOTO";
  const budgetMaker = koji_type === "bathroom" ? "タカラスタンダード" : defaultMaker;

  const matsuData = makers[defaultMaker]?.lineup_by_grade?.最上位;
  const takeData = makers[defaultMaker]?.lineup_by_grade?.中位;
  const umeData = makers[budgetMaker]?.lineup_by_grade?.下位;

  result.matsu = buildTradePlan(matsuData, installTotal, "matsu", defaultMaker, "最上位");
  result.take = buildTradePlan(takeData, installTotal, "take", defaultMaker, "中位");
  result.ume = buildTradePlan(umeData, installTotal, "ume", budgetMaker, "下位");

  return result;
}


function buildTradePlan(gradeData, installTotal, planType, makerName, gradeName) {
  if (!gradeData) return null;

  // 価格レンジ取得（最初にヒットしたキーを使用）
  const priceRange =
    gradeData.売れ筋価格帯_万円 ||
    gradeData.売れ筋施工費込み_万円 ||
    gradeData.定価帯_1616_万円 ||
    gradeData.定価帯_w750_万円 ||
    gradeData.定価帯_万円;

  if (!priceRange) return null;

  const unitPrice = avgRange(priceRange);
  const installAvg = installTotal ? avgRange(installTotal) : 0;
  const subtotal = unitPrice + installAvg;  // 万円
  const multiplier = (PLAN_PROFIT_MULTIPLIER[planType].multiplier_min +
                     PLAN_PROFIT_MULTIPLIER[planType].multiplier_max) / 2;
  const total_man_en = Math.round(subtotal * multiplier);

  return {
    maker: makerName,
    series: gradeData.series,
    grade: gradeName,
    unit_price_man_en: unitPrice,
    install_cost_man_en: installAvg,
    multiplier,
    total: total_man_en * 10000,  // 円に変換
    total_man_en,
    message: `${makerName} ${gradeData.series}（${gradeName}グレード）`,
    features: gradeData.特徴 || null,
    net_price_hint_man_en: gradeData.ネット販売価格_typical_万円 || null,
    trade_price_hint_man_en: gradeData.業者仕入れ値_typical_万円 || null
  };
}


function computeFromSoubaDB(item, mapping, soubaDB) {
  // soubaDBから該当カテゴリのplansを参照
  const categoryData = soubaDB[mapping.db];
  if (!categoryData) {
    return { error: `Category ${mapping.db} not found in soubaDB`, koji_type: item.koji_type };
  }

  const plansField = Object.keys(categoryData).find(k => k.toLowerCase().includes('plan') && k !== 'plans_template');
  if (!plansField) return { error: `No plans in ${mapping.db}`, koji_type: item.koji_type };

  const plans = categoryData[plansField];
  const result = { koji_type: item.koji_type, category_name: mapping.db };

  // plansがlistかdictかを判定
  const isPlanList = Array.isArray(plans);
  const planKeys = isPlanList ? plans.map((_, i) => i) : Object.keys(plans);

  // grade_mapで指定されたplanキーを取得
  if (mapping.grade_map && !isPlanList) {
    const matsuKey = mapping.grade_map.matsu;
    const takeKey = mapping.grade_map.take;
    const umeKey = mapping.grade_map.ume;

    result.matsu = extractPlanPrice(plans[matsuKey], "matsu");
    result.take = extractPlanPrice(plans[takeKey], "take");
    result.ume = extractPlanPrice(plans[umeKey], "ume");
  } else {
    // grade_map未指定 or listの場合 → 3等分して松竹梅として扱う（fallback）
    // プラン数が3未満ならそのまま、3以上なら均等割
    const len = planKeys.length;
    const matsuIdx = Math.min(len - 1, Math.floor(len * 0.75));  // 上位寄り
    const takeIdx = Math.floor(len / 2);                          // 中央
    const umeIdx = Math.floor(len * 0.15);                        // 下位寄り

    const getPlan = (idx) => isPlanList ? plans[idx] : plans[planKeys[idx]];

    result.matsu = len > matsuIdx ? extractPlanPrice(getPlan(matsuIdx), "matsu") : null;
    result.take  = len > takeIdx  ? extractPlanPrice(getPlan(takeIdx),  "take")  : null;
    result.ume   = len > umeIdx   ? extractPlanPrice(getPlan(umeIdx),   "ume")   : null;
  }

  return result;
}


function extractPlanPrice(planData, planType) {
  if (!planData) return null;

  // 価格フィールドを探索（v3.0 phase1.5 形式に対応）
  const price =
    planData.HS基準価格_万円 ||
    (planData.hs_rule_estimate_jpy ? planData.hs_rule_estimate_jpy / 10000 : null) ||
    (planData.hs_rule_jpy ? planData.hs_rule_jpy / 10000 : null) ||
    (planData.estimated_total_jpy ? avgRange(planData.estimated_total_jpy) / 10000 : null) ||
    (planData.price_jpy ? avgRange(planData.price_jpy) / 10000 : null);
  if (!price) return null;

  const multiplier = (PLAN_PROFIT_MULTIPLIER[planType].multiplier_min +
                     PLAN_PROFIT_MULTIPLIER[planType].multiplier_max) / 2;

  return {
    name: planData.name,
    total_man_en: Math.round(price * multiplier),
    total: Math.round(price * multiplier * 10000),
    work_days: planData.work_days || null,
    scope: planData.scope || null,
    multiplier,
    message: `${planData.name}（${PLAN_PROFIT_MULTIPLIER[planType].target_business}）`
  };
}


// ========================================
// メイン関数: 複数工事項目 → 統合3プラン
// ========================================
function generatePlans(items, soubaDB, tradeDB) {
  const itemResults = items.map(item => computeItemPlan(item, soubaDB, tradeDB));

  const totals = { matsu: 0, take: 0, ume: 0 };
  const validItems = { matsu: [], take: [], ume: [] };
  const errors = [];

  for (const result of itemResults) {
    if (result.error) {
      errors.push(result);
      continue;
    }
    for (const planType of ['matsu', 'take', 'ume']) {
      if (result[planType]?.total) {
        totals[planType] += result[planType].total;
        validItems[planType].push({
          koji_type: result.koji_type,
          ...result[planType]
        });
      }
    }
  }

  return {
    matsu: {
      ...PLAN_PROFIT_MULTIPLIER.matsu,
      total: totals.matsu,
      total_man_en: Math.round(totals.matsu / 10000),
      items: validItems.matsu,
      summary: `大手リフォーム会社相場での合計 ¥${totals.matsu.toLocaleString()}`
    },
    take: {
      ...PLAN_PROFIT_MULTIPLIER.take,
      total: totals.take,
      total_man_en: Math.round(totals.take / 10000),
      items: validItems.take,
      summary: `★中小工務店相場での合計 ¥${totals.take.toLocaleString()}（HS推奨）`
    },
    ume: {
      ...PLAN_PROFIT_MULTIPLIER.ume,
      total: totals.ume,
      total_man_en: Math.round(totals.ume / 10000),
      items: validItems.ume,
      summary: `個人事業＋ネット調達での合計 ¥${totals.ume.toLocaleString()}`
    },
    errors,
    _meta: {
      generated_at: new Date().toISOString(),
      engine_version: "1.0",
      philosophy: "TOshi Rule: 業者規模別の妥当利益率を透明化。松=区分4/竹=区分2★推奨/梅=区分1+ネット調達"
    }
  };
}


// ========================================
// ヘルパー関数
// ========================================
function avgRange(range) {
  if (!range) return 0;
  if (typeof range === 'number') return range;
  if (range.min !== undefined && range.max !== undefined) {
    return (range.min + range.max) / 2;
  }
  return 0;
}

function getMaterialLabel(key) {
  const labels = {
    CF_cushion_floor: "クッションフロア（CF）",
    floor_tile: "フロアタイル",
    composite_flooring: "複合フローリング",
    solid_wood_flooring: "無垢材フローリング",
    standard_vinyl: "標準ビニルクロス",
    premium_vinyl_kinofu: "機能性クロス（防汚・消臭等）"
  };
  return labels[key] || key;
}


// ========================================
// Cloudflare Worker / Node.js 両対応エクスポート
// ========================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { generatePlans, computeItemPlan, KOJI_TYPE_MAP, PLAN_PROFIT_MULTIPLIER };
}

// Workerで直接使う場合はグローバルに置く
if (typeof globalThis !== 'undefined') {
  globalThis.HS_PLAN_ENGINE = { generatePlans, computeItemPlan, KOJI_TYPE_MAP, PLAN_PROFIT_MULTIPLIER };
}
