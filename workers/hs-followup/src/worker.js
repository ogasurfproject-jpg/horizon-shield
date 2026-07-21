/**
 * hs-followup Worker — Week 1 実装
 * 
 * エンドポイント:
 *   POST /create-case       — 診断完了時に case_id 発行・KV保存
 *   GET  /followup/:case_id — フォームページ表示（Week 2）
 *   POST /followup/submit   — 回答保存（Week 2）
 *   POST /scheduled-send    — Cron: 30日経過案件にフォーム送信（Week 2）
 *   GET  /admin/export      — 月次匿名化JSON出力（Week 2）
 *   GET  /health            — 死活確認
 *
 * KV Binding: FOLLOWUP
 * Secret: ADMIN_KEY（/admin/export 認証用）
 */

// ── ユーティリティ ───────────────────────────────────────────────

function generateCaseId() {
  // UUID v4 相当（crypto.randomUUID が使えない環境用フォールバック付き）
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // フォールバック
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function today() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
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

// ── CORS プリフライト ────────────────────────────────────────────

function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

// ── /create-case ─────────────────────────────────────────────────
/**
 * POST /create-case
 *
 * Body (JSON):
 * {
 *   "region":         "kanto",           // 地域（必須）
 *   "koji_type":      "外壁塗装_30坪",   // 工事種別（必須）
 *   "menseki":        75,                // 面積 m²（任意）
 *   "gyosha_estimate": 1200000,          // 業者見積もり額（必須）
 *   "kira_estimate":  503800,            // KIRA算出額（必須）
 *   "kira_range_low": 442000,            // KIRA下限（任意）
 *   "kira_range_high": 595000,           // KIRA上限（任意）
 *   "pdf_purchased":  true               // PDF購入有無（任意、デフォルト false）
 * }
 *
 * Response:
 * {
 *   "ok": true,
 *   "case_id": "uuid-v4",
 *   "followup_scheduled": "YYYY-MM-DD"  // 30日後
 * }
 */
async function handleCreateCase(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("リクエストボディが JSON ではありません");
  }

  // 必須項目チェック
  const required = ["region", "koji_type", "gyosha_estimate", "kira_estimate"];
  for (const field of required) {
    if (body[field] === undefined || body[field] === null || body[field] === "") {
      return errorResponse(`必須項目が不足しています: ${field}`);
    }
  }

  const caseId = generateCaseId();
  const diagnosisDate = today();
  const followupScheduledDate = addDays(diagnosisDate, 30);

  const record = {
    case_id: caseId,
    diagnosis_date: diagnosisDate,
    followup_scheduled_date: followupScheduledDate,
    followup_sent_date: null,
    followup_responded_date: null,
    status: "pending", // pending → sent → responded
    input: {
      region: body.region,
      koji_type: body.koji_type,
      menseki: body.menseki ?? null,
    },
    intervention: {
      gyosha_estimate: Number(body.gyosha_estimate),
      kira_estimate: Number(body.kira_estimate),
      kira_estimate_range: [
        body.kira_range_low ? Number(body.kira_range_low) : null,
        body.kira_range_high ? Number(body.kira_range_high) : null,
      ],
      pdf_purchased: body.pdf_purchased ?? false,
    },
    outcome: null, // フォロー回答後に埋まる
  };

  // KV 保存: キー = followup:{case_id}
  // expirationTtl: 365日（1年後に自動削除）
  await env.FOLLOWUP.put(
    `followup:${caseId}`,
    JSON.stringify(record),
    { expirationTtl: 60 * 60 * 24 * 365 }
  );

  // インデックス用: date:{diagnosis_date}:{case_id} → "1"
  // ※Cron で30日後の案件を探すために使う
  await env.FOLLOWUP.put(
    `date:${diagnosisDate}:${caseId}`,
    "1",
    { expirationTtl: 60 * 60 * 24 * 400 }
  );

  return jsonResponse({
    ok: true,
    case_id: caseId,
    followup_scheduled: followupScheduledDate,
  });
}

// ── /health ───────────────────────────────────────────────────────

function handleHealth() {
  return jsonResponse({
    ok: true,
    worker: "hs-followup",
    version: "1.0.0-week1",
    timestamp: new Date().toISOString(),
  });
}

// ── スタブ（Week 2 以降に実装） ────────────────────────────────────

function handleStub(name) {
  return jsonResponse(
    { ok: false, error: `${name} は Week 2 以降に実装予定です` },
    501
  );
}

// ── メインルーター ────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    if (method === "OPTIONS") return handleOptions();

    // /health
    if (path === "/health" && method === "GET") {
      return handleHealth();
    }

    // /create-case
    if (path === "/create-case" && method === "POST") {
      return handleCreateCase(request, env);
    }

    // /followup/:case_id (GET) — Week 2
    if (path.startsWith("/followup/") && !path.endsWith("/submit") && method === "GET") {
      return handleStub("GET /followup/:case_id");
    }

    // /followup/submit (POST) — Week 2
    if (path === "/followup/submit" && method === "POST") {
      return handleStub("POST /followup/submit");
    }

    // /scheduled-send (POST / Cron) — Week 2
    if (path === "/scheduled-send" && method === "POST") {
      return handleStub("POST /scheduled-send");
    }

    // /admin/export (GET) — Week 2
    if (path === "/admin/export" && method === "GET") {
      return handleStub("GET /admin/export");
    }

    return errorResponse("Not Found", 404);
  },

  // Cron トリガー — Week 2 で実装
  async scheduled(_event, _env, _ctx) {
    // TODO: 30日経過案件にフォロー LINE Push を送る
    console.log("scheduled: hs-followup cron fired (Week 2 で実装)");
  },
};