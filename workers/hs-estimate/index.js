// hs-estimate Worker v2.0
// BtoB月額サブスクリプション + 見積もりエンジン
// KV: HS_ESTIMATE_KV
//   sub:{subscriptionId} → { apiKey, companyName, email, lineUserId, status, createdAt }
//   key:{apiKey}         → { subscriptionId, companyName, status }

const PLAN_ID = 'P-3C2245943L730094SNH3LC4Y';

// ---- ユーティリティ ----
function generateApiKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return 'hse_' + Array.from(array).map(b => chars[b % chars.length]).join('');
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

// ---- APIキー認証 ----
async function authenticate(request, env) {
  const apiKey = request.headers.get('X-API-Key') || request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!apiKey) return null;
  const raw = await env.HS_ESTIMATE_KV.get(`key:${apiKey}`);
  if (!raw) return null;
  const data = JSON.parse(raw);
  if (data.status !== 'active') return null;
  return data;
}

// ---- PayPal webhook検証 ----
async function verifyPayPalWebhook(request, env) {
  // PayPalのwebhook検証（本番では署名検証を実装）
  // 現状はtransmission-idの存在確認のみ
  const transmissionId = request.headers.get('paypal-transmission-id');
  return !!transmissionId;
}

// ---- LINE通知 ----
async function sendLine(userId, message, env) {
  if (!userId || !env.LINE_CHANNEL_TOKEN) return false;
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.LINE_CHANNEL_TOKEN}`,
      },
      body: JSON.stringify({ to: userId, messages: [{ type: 'text', text: message }] }),
    });
    return res.ok;
  } catch (e) {
    console.error('LINE error:', e);
    return false;
  }
}

// ---- ntfy通知 ----
async function sendNtfy(title, message, env, priority = 'high') {
  if (!env.NTFY_TOPIC_URL) return false;
  try {
    await fetch(env.NTFY_TOPIC_URL, {
      method: 'POST',
      headers: { 'Title': title, 'Priority': priority, 'Tags': 'tada,moneybag' },
      body: message,
    });
    return true;
  } catch (e) {
    return false;
  }
}

// ---- メール送信（Resend） ----
async function sendEmail(to, subject, html, env) {
  if (!to || !env.RESEND_API_KEY) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: 'HORIZON SHIELD <onboarding@resend.dev>',
        to: [to],
        reply_to: 'contact@the-horizons-innovation.com',
        subject,
        html,
      }),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

// ---- 見積もり計算エンジン ----
function calculateEstimate(room) {
  const { width, depth, height, openings = [] } = room.room;
  const floor_m2 = room.surfaces?.floor_m2 || (width * depth);
  const ceiling_m2 = room.surfaces?.ceiling_m2 || (width * depth);
  const wall_m2_gross = room.surfaces?.wall_m2 || (2 * (width + depth) * height);
  const opening_m2 = openings.reduce((sum, o) => sum + (o.width * o.height), 0);
  const wall_m2 = wall_m2_gross - opening_m2;

  const items = [];

  // 解体工事
  items.push({ category: '解体工事', name: 'クロス撤去', unit: '㎡', qty: Math.round((wall_m2 + ceiling_m2) * 10) / 10, unit_price: 400 });
  items.push({ category: '解体工事', name: '床材撤去', unit: '㎡', qty: Math.round(floor_m2 * 10) / 10, unit_price: 600 });

  // 内装材料
  items.push({ category: '内装材料', name: 'クロス（量産）', unit: '㎡', qty: Math.ceil((wall_m2 + ceiling_m2) * 1.15), unit_price: 680 });
  items.push({ category: '内装材料', name: 'フローリング', unit: '㎡', qty: Math.ceil(floor_m2 * 1.1), unit_price: 4500 });

  // 内装工賃
  items.push({ category: '内装工賃', name: 'クロス貼り', unit: '㎡', qty: Math.round((wall_m2 + ceiling_m2) * 10) / 10, unit_price: 1200 });
  items.push({ category: '内装工賃', name: 'フローリング貼り', unit: '㎡', qty: Math.round(floor_m2 * 10) / 10, unit_price: 3500 });

  // 建具
  const doors = openings.filter(o => o.type === 'door').length;
  const windows = openings.filter(o => o.type === 'window').length;
  if (doors > 0) items.push({ category: '建具', name: '建具取付', unit: '枚', qty: doors, unit_price: 15000 });
  if (windows > 0) items.push({ category: '建具', name: 'サッシ取付（カバー工法）', unit: '箇所', qty: windows, unit_price: 25000 });

  // 仮設費
  const subtotal_before_expenses = items.reduce((sum, i) => sum + (i.qty * i.unit_price), 0);
  items.push({ category: '仮設費', name: '養生費', unit: '式', qty: 1, unit_price: 30000 });
  items.push({ category: '仮設費', name: '廃材処分費', unit: '式', qty: 1, unit_price: 50000 });

  const subtotal = items.reduce((sum, i) => sum + (i.qty * i.unit_price), 0);
  const expenses = Math.round(subtotal_before_expenses * 0.1);
  items.push({ category: '諸経費', name: '諸経費（10%）', unit: '式', qty: 1, unit_price: expenses });

  const total = subtotal + expenses;

  return {
    room_info: { width, depth, height, floor_m2: Math.round(floor_m2 * 100) / 100, wall_m2: Math.round(wall_m2 * 100) / 100, ceiling_m2: Math.round(ceiling_m2 * 100) / 100 },
    items: items.map(i => ({ ...i, amount: Math.round(i.qty * i.unit_price) })),
    subtotal,
    tax: Math.round(total * 0.1),
    total_with_tax: Math.round(total * 1.1),
    generated_at: new Date().toISOString(),
    generated_by: 'hs-estimate v2.0',
  };
}

// ---- メインハンドラ ----
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {

      // ---- ヘルスチェック ----
      if (pathname === '/health') {
        return json({ ok: true, service: 'hs-estimate', version: '2.0.0', plan_id: PLAN_ID });
      }

      // ---- PayPal Webhook ----
      if (pathname === '/webhook/paypal' && request.method === 'POST') {
        const isValid = await verifyPayPalWebhook(request, env);
        if (!isValid) return json({ error: 'Invalid webhook' }, 400);

        const body = await request.json();
        const eventType = body.event_type;
        console.log('PayPal webhook:', eventType);

        // サブスクリプション開始
        if (eventType === 'BILLING.SUBSCRIPTION.ACTIVATED') {
          const sub = body.resource;
          const subscriptionId = sub.id;
          const payerEmail = sub.subscriber?.email_address || '';
          const payerName = sub.subscriber?.name?.given_name + ' ' + (sub.subscriber?.name?.surname || '');

          // APIキー生成
          const apiKey = generateApiKey();
          const now = new Date().toISOString();

          const subData = {
            apiKey,
            companyName: payerName.trim() || '未設定',
            email: payerEmail,
            lineUserId: null,
            status: 'active',
            createdAt: now,
            planId: PLAN_ID,
          };

          // KV保存
          await env.HS_ESTIMATE_KV.put(`sub:${subscriptionId}`, JSON.stringify(subData));
          await env.HS_ESTIMATE_KV.put(`key:${apiKey}`, JSON.stringify({
            subscriptionId,
            companyName: subData.companyName,
            status: 'active',
          }));

          // TOshiへの通知
          const toshiMsg = `🎉 新規BtoB契約！
━━━━━━━━━━━━━━━
会社：${subData.companyName}
メール：${payerEmail}
プランID：${PLAN_ID}
サブスクID：${subscriptionId}
APIキー：${apiKey}
月額：¥49,800
━━━━━━━━━━━━━━━`;

          ctx.waitUntil(Promise.all([
            sendLine(env.LINE_USER_ID, toshiMsg, env),
            sendNtfy('🎉 新規BtoB契約 ¥49,800/月', toshiMsg, env, 'urgent'),
          ]));

          // 顧客へAPIキー送信（メール）
          if (payerEmail) {
            const emailHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:'Hiragino Sans',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;">
<div style="background:linear-gradient(135deg,#0a1628,#1a3a6a);padding:24px;border-radius:8px 8px 0 0;">
  <h1 style="color:#d4af37;margin:0;font-size:20px;">HORIZON SHIELD</h1>
  <p style="color:#7a9cc4;margin:4px 0 0;font-size:12px;">AIカメラ見積もりシステム</p>
</div>
<div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:28px;border-radius:0 0 8px 8px;">
  <h2 style="margin-top:0;">ご契約ありがとうございます</h2>
  <p>AIカメラ見積もりシステムへのご登録が完了しました。</p>
  <div style="background:#f8f9fa;border:1px solid #e5e7eb;border-left:4px solid #d4af37;padding:16px;margin:20px 0;border-radius:4px;">
    <p style="margin:0 0 8px;font-size:12px;color:#666;">あなたのAPIキー（厳重に保管してください）</p>
    <code style="font-size:14px;font-weight:bold;color:#0a1628;word-break:break-all;">${apiKey}</code>
  </div>
  <h3>APIの使い方</h3>
  <pre style="background:#1a1a2e;color:#a0c4ff;padding:16px;border-radius:4px;overflow-x:auto;font-size:12px;">curl -X POST https://hs-estimate.oga-surf-project.workers.dev/estimate \\
  -H "X-API-Key: ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "room": {"width":3.64,"depth":4.55,"height":2.40},
    "surfaces": {"floor_m2":16.57,"wall_m2":65.12,"ceiling_m2":16.57},
    "openings": [{"type":"door","width":0.9,"height":2.0}]
  }'</pre>
  <p style="font-size:13px;color:#666;">ご不明点はLINE（@172piime）またはメールにてお問い合わせください。</p>
</div>
</body></html>`;
            ctx.waitUntil(sendEmail(payerEmail, '【HORIZON SHIELD】APIキーのご案内', emailHtml, env));
          }

          return json({ ok: true, subscriptionId });
        }

        // サブスクリプション解約
        if (eventType === 'BILLING.SUBSCRIPTION.CANCELLED' || eventType === 'BILLING.SUBSCRIPTION.EXPIRED') {
          const subscriptionId = body.resource?.id;
          if (subscriptionId) {
            const raw = await env.HS_ESTIMATE_KV.get(`sub:${subscriptionId}`);
            if (raw) {
              const subData = JSON.parse(raw);
              subData.status = 'cancelled';
              await env.HS_ESTIMATE_KV.put(`sub:${subscriptionId}`, JSON.stringify(subData));
              if (subData.apiKey) {
                const keyRaw = await env.HS_ESTIMATE_KV.get(`key:${subData.apiKey}`);
                if (keyRaw) {
                  const keyData = JSON.parse(keyRaw);
                  keyData.status = 'cancelled';
                  await env.HS_ESTIMATE_KV.put(`key:${subData.apiKey}`, JSON.stringify(keyData));
                }
              }
              ctx.waitUntil(sendLine(env.LINE_USER_ID, `⚠️ BtoB解約\n会社：${subData.companyName}\nサブスクID：${subscriptionId}`, env));
            }
          }
          return json({ ok: true });
        }

        return json({ ok: true, skipped: eventType });
      }

      // ---- 見積もり生成（認証必須） ----
      if (pathname === '/estimate' && request.method === 'POST') {
        const auth = await authenticate(request, env);
        if (!auth) return json({ error: 'Unauthorized. X-API-Keyヘッダーが必要です。' }, 401);

        const params = await request.json();
        if (!params.room) return json({ error: 'room フィールドが必要です' }, 400);

        const estimate = calculateEstimate(params);
        const tier = auth.tier || 'external';
        const verification = {
          engine: 'HORIZON SHIELD hs-estimate',
          basis: 'standard_unit_price',
          overhead_fixed: '10%',
          markup_by_vendor: false,
          note: '当社エンジンが標準単価で生成。第三者業者による水増しは構造的に発生しません。',
        };
        return json({ ok: true, company: auth.companyName, tier, verification, estimate });
      }

      // ---- APIキー確認 ----
      if (pathname === '/verify' && request.method === 'GET') {
        const auth = await authenticate(request, env);
        if (!auth) return json({ ok: false, error: 'Invalid API key' }, 401);
        return json({ ok: true, company: auth.companyName, status: auth.status });
      }

      // ---- 管理：サブスク一覧（管理者のみ） ----
      if (pathname === '/admin/subscriptions' && request.method === 'GET') {
        const adminKey = request.headers.get('X-Admin-Key');
        if (adminKey !== env.ADMIN_SECRET) return json({ error: 'Forbidden' }, 403);

        const list = await env.HS_ESTIMATE_KV.list({ prefix: 'sub:' });
        const subs = [];
        for (const key of list.keys) {
          const raw = await env.HS_ESTIMATE_KV.get(key.name);
          if (raw) {
            const data = JSON.parse(raw);
            subs.push({ subscriptionId: key.name.replace('sub:', ''), ...data, apiKey: data.apiKey?.slice(0, 8) + '...' });
          }
        }
        return json({ ok: true, count: subs.length, subscriptions: subs });
      }

      // ---- テスト用：認証なし見積もり（開発時のみ） ----
      if (pathname === '/estimate-test' && request.method === 'POST') {
        const params = await request.json();
        if (!params.room) return json({ error: 'room フィールドが必要です' }, 400);
        const estimate = calculateEstimate(params);
        return json({ ok: true, company: 'TEST', estimate });
      }

      // ---- 管理：手動キー発行（八雲モール用・tier指定） ----
      if (pathname === '/admin/issue-key' && request.method === 'POST') {
        const adminKey = request.headers.get('X-Admin-Key');
        if (adminKey !== env.ADMIN_SECRET) return json({ error: 'Forbidden' }, 403);

        const body = await request.json().catch(() => ({}));
        const tier = body.tier === 'honbu' ? 'honbu' : (body.tier === 'external' ? 'external' : null);
        if (!tier) return json({ error: 'tier required', allowed: ['honbu', 'external'] }, 400);
        const companyName = (body.companyName || '').trim() || '未設定';

        const apiKey = generateApiKey();
        const subscriptionId = 'manual_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        const subData = {
          apiKey,
          companyName,
          email: body.email || null,
          lineUserId: body.lineUserId || null,
          status: 'active',
          createdAt: new Date().toISOString(),
          planId: 'manual-yakumo',
          tier,
        };
        await env.HS_ESTIMATE_KV.put(`sub:${subscriptionId}`, JSON.stringify(subData));
        await env.HS_ESTIMATE_KV.put(`key:${apiKey}`, JSON.stringify({
          subscriptionId,
          companyName,
          status: 'active',
          tier,
        }));
        return json({ ok: true, apiKey, tier, companyName, subscriptionId, note: 'save_this_now_key_is_shown_once' });
      }

      return json({ error: 'Not Found', path: pathname }, 404);

    } catch (err) {
      console.error('Error:', err);
      return json({ error: err.message || 'Internal Server Error' }, 500);
    }
  },
};
