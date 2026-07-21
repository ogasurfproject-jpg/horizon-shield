/**
 * hs-real-cases-proxy Worker
 *
 * KIRA から fetch で呼ぶ。v11-SAFE は一切触らない。
 *
 * エンドポイント:
 *   GET /health                          — 死活確認
 *   GET /cases                           — 全件取得
 *   GET /cases/:case_id                  — 個別取得
 *   GET /cases/search?koji_type=&region= — 絞り込み検索
 *   GET /cases/summary                   — 統計サマリー
 *
 * KV Binding: HS_REAL_CASES
 */

// ── ユーティリティ ────────────────────────────────────────────────

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ ok: false, error: message }, status);
}

function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

// ── KVからケース全件ロード ─────────────────────────────────────────

async function loadAllCases(env) {
  const raw = await env.HS_REAL_CASES.get("cases:all", { type: "json" });
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [];
}

// ── /health ───────────────────────────────────────────────────────

function handleHealth() {
  return jsonResponse({
    ok: true,
    worker: "hs-real-cases-proxy",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
}

// ── GET /cases ────────────────────────────────────────────────────

async function handleGetAll(env) {
  const cases = await loadAllCases(env);
  return jsonResponse({ ok: true, count: cases.length, cases });
}

// ── GET /cases/:case_id ───────────────────────────────────────────

async function handleGetOne(caseId, env) {
  const cases = await loadAllCases(env);
  const found = cases.find((c) => c.case_id === caseId);
  if (!found) return errorResponse(`case_id "${caseId}" not found`, 404);
  return jsonResponse({ ok: true, case: found });
}

// ── GET /cases/search ─────────────────────────────────────────────
/**
 * クエリパラメータ（すべて任意・部分一致）:
 *   koji_type   例: 外壁塗装
 *   region      例: 神奈川県
 *   use_type    例: residential
 *   client_type 例: individual
 *   year_from   例: 2020
 *   year_to     例: 2023
 *   price_from  例: 500000
 *   price_to    例: 2000000
 */
async function handleSearch(url, env) {
  const p = url.searchParams;
  const cases = await loadAllCases(env);

  let results = cases.filter((c) => {
    if (p.get("koji_type") && !c.koji_type?.includes(p.get("koji_type"))) return false;
    if (p.get("region") && !c.region_prefecture?.includes(p.get("region")) && !c.region_city?.includes(p.get("region"))) return false;
    if (p.get("use_type") && c.use_type !== p.get("use_type")) return false;
    if (p.get("client_type") && c.client_type !== p.get("client_type")) return false;
    if (p.get("year_from") && c.year < Number(p.get("year_from"))) return false;
    if (p.get("year_to") && c.year > Number(p.get("year_to"))) return false;
    if (p.get("price_from") && c.actual_total_price_jpy < Number(p.get("price_from"))) return false;
    if (p.get("price_to") && c.actual_total_price_jpy > Number(p.get("price_to"))) return false;
    return true;
  });

  return jsonResponse({ ok: true, count: results.length, cases: results });
}

// ── GET /cases/summary ────────────────────────────────────────────

async function handleSummary(env) {
  const cases = await loadAllCases(env);
  if (cases.length === 0) return jsonResponse({ ok: true, summary: null });

  const prices = cases.map((c) => c.actual_total_price_jpy).filter(Boolean);
  const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
  const min = Math.min(...prices);
  const max = Math.max(...prices);

  // 工事種別カウント
  const kojiCount = {};
  cases.forEach((c) => {
    kojiCount[c.koji_type] = (kojiCount[c.koji_type] || 0) + 1;
  });

  // 地域カウント
  const regionCount = {};
  cases.forEach((c) => {
    if (c.region_prefecture) {
      regionCount[c.region_prefecture] = (regionCount[c.region_prefecture] || 0) + 1;
    }
  });

  return jsonResponse({
    ok: true,
    summary: {
      total_cases: cases.length,
      price_avg_jpy: avg,
      price_min_jpy: min,
      price_max_jpy: max,
      koji_type_breakdown: kojiCount,
      region_breakdown: regionCount,
    },
  });
}

// ── メインルーター ────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    if (method === "OPTIONS") return handleOptions();
    if (method !== "GET") return errorResponse("GET only", 405);

    if (path === "/health") return handleHealth();
    if (path === "/cases") return handleGetAll(env);
    if (path === "/cases/search") return handleSearch(url, env);
    if (path === "/cases/summary") return handleSummary(env);
    if (path.startsWith("/cases/")) {
      const caseId = path.replace("/cases/", "");
      return handleGetOne(caseId, env);
    }

    return errorResponse("Not Found", 404);
  },
};