// hs-price-sync v5.1 - Phase 3-B (Cron + KV + LINE通知 + Claudeサマリー)
// 月次自動実行 + 手動発火 + 提案KV保存 + TOshiへのLINE Push通知
// 作成: 2026-04-20 / The HORIZ音s株式会社

const BOJ_API_BASE = 'https://www.stat-search.boj.or.jp/api/v1';

// ★HORIZON SHIELD 戦時補正係数・確定加重（Phase 2-E検証済）
const WARFRONT_TARGETS = [
  { label: '総平均',        keywords: ['総平均'],       pinned_code: 'PRCG20_2200000000', weight: 0.10 },
  { label: '木材・木製品',   keywords: ['木材'],         pinned_code: 'PRCG20_2200320001', weight: 0.08 },
  { label: '鉄鋼',          keywords: ['鉄鋼'],         pinned_code: 'PRCG20_2200920001', weight: 0.20 },
  { label: '非鉄金属',      keywords: ['非鉄金属'],     weight: 0.15 },
  { label: 'セメント・土石', keywords: ['窯業'],         pinned_code: 'PRCG20_2200820001', weight: 0.12 },
  { label: '建設用金属',    keywords: ['建設用金属'],   pinned_code: 'PRCG20_2201140001', weight: 0.10 },
  { label: '石油・石炭',    keywords: ['石油'],         pinned_code: 'PRCG20_2200620001', weight: 0.25 }
];

const MANUFACTURER_ALERTS = [
  { maker: 'カネカ', product: 'カネライトフォーム', pct: 40, effective: '2026-04-01', category: '断熱材' },
  { maker: 'デュポン・スタイロ', product: 'スタイロフォーム', pct: 40, effective: '2026-05-01', category: '断熱材' },
  { maker: '旭化成建材', product: 'ネオマフォーム', pct: 20, effective: '2026-04-01', category: '断熱材' },
  { maker: '信越化学工業', product: '樹脂全般', pct: 8, effective: '2026-04-01', category: '樹脂' },
  { maker: 'タキロンシーアイ', product: '住設建材全般', pct: 20, effective: '2026-05-01', category: '住設建材' },
  { maker: '田島ルーフィング', product: 'ルーフィング全般', pct: 45, effective: '2026-05-01', category: '防水・屋根' },
  { maker: '三菱ケミカルインフラテック', product: '波板・ポリカ', pct: 10, effective: '2026-05-01', category: '波板' },
  { maker: 'グラスウール各社', product: 'グラスウール断熱材', pct: 20, effective: '2026-05-01', category: '断熱材' },
  { maker: '日本ペイント', product: 'シンナー・塗料', pct: 60, effective: '2026-05-01', category: '塗料' },
  { maker: '関西ペイント', product: '塗料全般', pct: 50, effective: '2026-05-01', category: '塗料' }
];

// =============================================
// 中核ロジック: 提案生成
// =============================================
async function generateProposal(env) {
  const metaRes = await fetch(`${BOJ_API_BASE}/getMetadata?format=json&lang=jp&db=pr01`);
  const metaData = await metaRes.json();
  const allSeries = metaData.RESULTSET || [];

  const targets = WARFRONT_TARGETS.map(t => {
    if (t.pinned_code) return { ...t, code: t.pinned_code };
    const match = allSeries.find(m => {
      if (!m.SERIES_CODE || m.FREQUENCY !== 'MONTHLY') return false;
      if (!/^PRCG20_22\d/.test(m.SERIES_CODE)) return false;
      const txt = `${m.NAME_OF_TIME_SERIES_J || ''} ${m.CATEGORY_J || ''}`;
      return t.keywords.some(k => txt.includes(k));
    });
    return { ...t, code: match?.SERIES_CODE || null };
  });

  const results = await Promise.all(targets.map(async t => {
    if (!t.code) return { label: t.label, weight: t.weight, error: 'no code' };
    const apiUrl = `${BOJ_API_BASE}/getDataCode?format=json&lang=jp&db=PR01&code=${t.code}&startDate=202501`;
    const res = await fetch(apiUrl);
    const data = await res.json();
    const s = (data.RESULTSET || [])[0];
    if (!s) return { label: t.label, weight: t.weight, code: t.code, error: 'no data' };
    const vo = s.VALUES || {};
    const ts = (vo.SURVEY_DATES || []).map((d, i) => ({ date: String(d), value: parseFloat((vo.VALUES || [])[i]) }))
      .filter(x => !isNaN(x.value));
    if (ts.length === 0) return { label: t.label, weight: t.weight, error: 'no numeric' };
    const latest = ts[ts.length - 1];
    const prev1 = ts[ts.length - 2] || null;
    const prev3 = ts[ts.length - 4] || null;
    const preIran = ts.find(x => x.date === '202601') || null;
    const mom = prev1 ? ((latest.value - prev1.value) / prev1.value) * 100 : 0;
    const tmo = prev3 ? ((latest.value - prev3.value) / prev3.value) * 100 : 0;
    const iran = preIran ? ((latest.value - preIran.value) / preIran.value) * 100 : null;
    return {
      label: t.label, weight: t.weight, code: s.SERIES_CODE,
      latest_month: latest.date, latest_value: latest.value,
      mom_pct: mom.toFixed(2), three_mo_pct: tmo.toFixed(2),
      since_iran_pct: iran !== null ? iran.toFixed(2) : null,
      pre_iran_value: preIran?.value || null
    };
  }));

  let weightedIran = 0, weightSum = 0;
  for (const r of results) {
    if (r.since_iran_pct !== null && r.weight && !r.error) {
      weightedIran += parseFloat(r.since_iran_pct) * r.weight;
      weightSum += r.weight;
    }
  }
  const compositeIranPct = weightSum > 0 ? (weightedIran / weightSum) : 0;
  const cgpiCoefficient = 1 + (compositeIranPct / 100);
  const today = new Date().toISOString().slice(0, 10);
  const activeAlerts = MANUFACTURER_ALERTS.filter(a => a.effective <= today);
  const makerAvgPct = activeAlerts.length > 0 ?
    activeAlerts.reduce((sum, a) => sum + a.pct, 0) / activeAlerts.length : 0;
  const makerCoefficient = 1 + (makerAvgPct * 0.30 / 100);
  const finalCoefficient = cgpiCoefficient * makerCoefficient;

  return {
    generated_at: new Date().toISOString(),
    composite: {
      weighted_since_iran_pct: compositeIranPct.toFixed(3),
      cgpi_coefficient: cgpiCoefficient.toFixed(4),
      maker_avg_pct: makerAvgPct.toFixed(2),
      maker_coefficient: makerCoefficient.toFixed(4),
      final_coefficient: finalCoefficient.toFixed(4),
      human_readable: `既存価格に × ${finalCoefficient.toFixed(4)} を掛ける（+${((finalCoefficient-1)*100).toFixed(2)}%補正）`
    },
    series: results,
    active_manufacturer_alerts: activeAlerts,
    status: 'pending',
    approved_at: null,
    approved_by: null
  };
}

// =============================================
// ★NEW: Claudeサマリー生成（ANTHROPIC_API_KEY必須）
// =============================================
async function generateClaudeSummary(proposal, env) {
  if (!env.ANTHROPIC_API_KEY) return null;
  try {
    const seriesLines = proposal.series
      .filter(s => !s.error)
      .map(s => `${s.label}(w=${s.weight}): 戦争以降${s.since_iran_pct}% / 3月比${s.three_mo_pct}% / 前月比${s.mom_pct}%`)
      .join('\n');
    const makerLines = proposal.active_manufacturer_alerts
      .map(a => `- ${a.maker} ${a.product} +${a.pct}% (${a.effective}実施)`)
      .join('\n');
    const prompt = `あなたは建設業30年のベテラン。TOshi（HORIZON SHIELD代表）に月次価格提案を3-4行で報告せよ。結論先出し、お世辞禁止、専門用語OK。

【計算結果】
最終補正係数: ${proposal.composite.final_coefficient} (+${((parseFloat(proposal.composite.final_coefficient)-1)*100).toFixed(2)}%)
内訳: CGPI加重${proposal.composite.weighted_since_iran_pct}% + メーカー平均${proposal.composite.maker_avg_pct}%×寄与率30%

【CGPI系列】
${seriesLines}

【有効メーカー値上げ】
${makerLines || 'なし'}

→ 承認すべきか、何が主犯か、警戒点を述べよ。`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) return `(Claudeサマリー失敗: ${res.status})`;
    const data = await res.json();
    return data.content?.[0]?.text?.trim() || null;
  } catch (e) {
    return `(Claudeサマリーエラー: ${e.message})`;
  }
}

// =============================================
// ★NEW: LINE Push通知（TOshi宛）
// =============================================
async function sendLineNotification(proposal, summary, env) {
  if (!env.LINE_CHANNEL_TOKEN || !env.LINE_USER_ID) {
    return { sent: false, reason: 'LINE not configured' };
  }
  const c = proposal.composite;
  const month = proposal.generated_at.slice(0, 7);
  const pctDelta = ((parseFloat(c.final_coefficient) - 1) * 100).toFixed(2);
  const header = `📊 HORIZON SHIELD 月次価格提案
【${month}分・承認待ち】

━━━━━━━━━━━━━━━
戦時補正係数: ×${c.final_coefficient}
既存価格比: +${pctDelta}%
━━━━━━━━━━━━━━━

▼ 内訳
・CGPI加重(戦争以降): ${c.weighted_since_iran_pct}%
・メーカー値上げ平均: +${c.maker_avg_pct}% (実効${proposal.active_manufacturer_alerts.length}件)

▼ 承認操作
/admin で承認/却下 (Phase 3-Cで実装)
https://hs-price-sync.oga-surf-project.workers.dev/proposal/latest`;

  const text = summary ? `${header}\n\n▼ AI分析\n${summary}` : header;

  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.LINE_CHANNEL_TOKEN}`
      },
      body: JSON.stringify({
        to: env.LINE_USER_ID,
        messages: [{ type: 'text', text: text.slice(0, 4900) }]
      })
    });
    const body = await res.text();
    return { sent: res.ok, status: res.status, body_preview: body.slice(0, 200) };
  } catch (e) {
    return { sent: false, error: e.message };
  }
}

// =============================================
// メイン ハンドラ
// =============================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json; charset=utf-8' };

    // ========================================
    // /run-now - 手動で提案生成＋KV保存＋LINE通知
    // ========================================
    if (url.pathname === '/run-now') {
      try {
        const proposal = await generateProposal(env);
        const yearMonth = new Date().toISOString().slice(0, 7);
        let kvSaved = false;
        if (env.KV) {
          await env.KV.put(`PROPOSAL:${yearMonth}`, JSON.stringify(proposal));
          kvSaved = true;
        }
        const summary = await generateClaudeSummary(proposal, env);
        const notifyResult = await sendLineNotification(proposal, summary, env);
        return new Response(JSON.stringify({
          success: true,
          saved_to_kv: kvSaved ? `PROPOSAL:${yearMonth}` : 'KV not bound',
          claude_summary: summary,
          line_notification: notifyResult,
          proposal
        }, null, 2), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message, stack: e.stack }), { status: 500, headers: cors });
      }
    }

    // ========================================
    // ★NEW: /notify-test - LINE通知単体テスト（KVから最新読み出して送る）
    // ========================================
    if (url.pathname === '/notify-test') {
      if (!env.KV) return new Response(JSON.stringify({ error: 'KV not bound' }), { status: 500, headers: cors });
      const yearMonth = new Date().toISOString().slice(0, 7);
      const raw = await env.KV.get(`PROPOSAL:${yearMonth}`);
      if (!raw) return new Response(JSON.stringify({ error: 'no proposal yet, run /run-now first' }), { headers: cors });
      const proposal = JSON.parse(raw);
      const summary = await generateClaudeSummary(proposal, env);
      const notifyResult = await sendLineNotification(proposal, summary, env);
      return new Response(JSON.stringify({ claude_summary: summary, line_notification: notifyResult }, null, 2), { headers: cors });
    }

    // ========================================
    // /proposal/latest - 最新提案取得
    // ========================================
    if (url.pathname === '/proposal/latest') {
      if (!env.KV) return new Response(JSON.stringify({ error: 'KV not bound' }), { status: 500, headers: cors });
      const yearMonth = new Date().toISOString().slice(0, 7);
      const raw = await env.KV.get(`PROPOSAL:${yearMonth}`);
      if (!raw) return new Response(JSON.stringify({ error: 'no proposal for current month', month: yearMonth }), { headers: cors });
      return new Response(raw, { headers: cors });
    }

    // ========================================
    // /current-coefficient - 有効係数取得（v11-SAFEから呼ばれる）
    // ========================================
    if (url.pathname === '/current-coefficient') {
      if (!env.KV) return new Response(JSON.stringify({ coefficient: 1.0, source: 'KV not bound, default' }), { headers: cors });
      const active = await env.KV.get('PRICE_INDEX_ACTIVE');
      if (!active) return new Response(JSON.stringify({ coefficient: 1.0, source: 'no active value, default' }), { headers: cors });
      const parsed = JSON.parse(active);
      return new Response(JSON.stringify({
        coefficient: parsed.coefficient,
        approved_at: parsed.approved_at,
        source_month: parsed.source_month,
        note: 'v11-SAFEから呼び出されて価格係数に適用される'
      }, null, 2), { headers: cors });
    }

    // ========================================
    // ★NEW: /admin - 承認UI HTML
    // ========================================
    if (url.pathname === '/admin' || url.pathname === '/admin/price') {
      if (!env.KV) return new Response('KV not bound', { status: 500 });
      const yearMonth = new Date().toISOString().slice(0, 7);
      const raw = await env.KV.get(`PROPOSAL:${yearMonth}`);
      const active = await env.KV.get('PRICE_INDEX_ACTIVE');
      const proposal = raw ? JSON.parse(raw) : null;
      const activeData = active ? JSON.parse(active) : null;

      const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HORIZON SHIELD 価格承認</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0a;color:#e0e0e0;font-family:'Noto Sans JP',sans-serif;padding:20px}
h1{color:#00d4ff;font-size:1.4rem;margin-bottom:20px;border-bottom:1px solid #333;padding-bottom:10px}
.card{background:#111;border:1px solid #333;border-radius:8px;padding:20px;margin-bottom:16px}
.card h2{font-size:1rem;color:#aaa;margin-bottom:12px}
.coeff{font-size:2.5rem;font-weight:bold;color:#ffd700;text-align:center;padding:10px 0}
.delta{text-align:center;color:#ff6b6b;font-size:1.1rem;margin-bottom:6px}
table{width:100%;border-collapse:collapse;font-size:0.85rem}
td,th{padding:6px 8px;border-bottom:1px solid #222;text-align:left}
th{color:#888;font-weight:normal}
.hot{color:#ff6b6b}
.summary{background:#1a1a2e;border-left:3px solid #00d4ff;padding:12px;border-radius:4px;line-height:1.7;white-space:pre-wrap;font-size:0.9rem}
.status-pending{color:#ffd700}
.status-approved{color:#00ff88}
.status-rejected{color:#ff4444}
.btn-group{display:flex;gap:12px;margin-top:16px}
.btn{flex:1;padding:14px;border:none;border-radius:6px;font-size:1rem;font-weight:bold;cursor:pointer}
.btn-approve{background:#00a86b;color:#fff}
.btn-reject{background:#c0392b;color:#fff}
.btn:active{opacity:0.8}
.active-box{background:#0d1b0d;border:1px solid #00a86b;border-radius:6px;padding:12px;font-size:0.85rem}
</style>
</head>
<body>
<h1>⚡ HORIZON SHIELD 価格承認コンソール</h1>

${activeData ? `
<div class="card">
  <h2>✅ 現在有効な係数</h2>
  <div class="active-box">
    係数: <strong style="color:#00ff88">×${activeData.coefficient}</strong>
    &nbsp;|&nbsp; 承認日: ${activeData.approved_at?.slice(0,10) || '-'}
    &nbsp;|&nbsp; 対象月: ${activeData.source_month || '-'}
  </div>
</div>` : '<div class="card"><h2>現在有効な係数</h2><p style="color:#666">未設定（係数 ×1.000 = 変更なし）</p></div>'}

${proposal ? `
<div class="card">
  <h2>📊 ${yearMonth} 提案 &nbsp;<span class="status-${proposal.status}">[${proposal.status}]</span></h2>
  <div class="coeff">×${proposal.composite?.final_coefficient}</div>
  <div class="delta">既存価格比 +${((parseFloat(proposal.composite?.final_coefficient)-1)*100).toFixed(2)}%</div>
  <table>
    <tr><th>内訳</th><th>値</th></tr>
    <tr><td>CGPI加重（戦争以降）</td><td class="hot">${proposal.composite?.weighted_since_iran_pct}%</td></tr>
    <tr><td>メーカー値上げ平均</td><td>+${proposal.composite?.maker_avg_pct}%</td></tr>
    <tr><td>メーカー有効件数</td><td>${proposal.active_manufacturer_alerts?.length || 0}件</td></tr>
    <tr><td>生成日時</td><td>${proposal.generated_at?.slice(0,16).replace('T',' ')}</td></tr>
  </table>
</div>

${proposal.claude_summary || proposal._summary ? `
<div class="card">
  <h2>🤖 AI分析</h2>
  <div class="summary">${proposal.claude_summary || proposal._summary || ''}</div>
</div>` : ''}

${proposal.status === 'pending' ? `
<div class="card">
  <h2>承認操作</h2>
  <div class="btn-group">
    <button class="btn btn-approve" onclick="approve()">✅ 承認・反映</button>
    <button class="btn btn-reject" onclick="reject()">❌ 却下</button>
  </div>
  <p id="msg" style="margin-top:12px;text-align:center;font-size:0.9rem"></p>
</div>
<script>
async function approve() {
  const msg = document.getElementById('msg');
  msg.textContent = '処理中...';
  try {
    const r = await fetch('/proposal/approve', {method:'POST'});
    const d = await r.json();
    if (d.success) { msg.style.color='#00ff88'; msg.textContent = '✅ 承認完了！係数 ×'+d.coefficient+' を反映しました'; }
    else { msg.style.color='#ff4444'; msg.textContent = '❌ エラー: '+JSON.stringify(d); }
  } catch(e) { msg.style.color='#ff4444'; msg.textContent='通信エラー'; }
}
async function reject() {
  if (!confirm('却下しますか？')) return;
  const msg = document.getElementById('msg');
  const r = await fetch('/proposal/reject', {method:'POST'});
  const d = await r.json();
  msg.style.color='#aaa'; msg.textContent = '却下しました';
  setTimeout(()=>location.reload(), 1000);
}
</script>` : `<div class="card"><p>この提案は既に <strong class="status-${proposal.status}">${proposal.status}</strong> です。</p></div>`}
` : `<div class="card"><p style="color:#666">今月の提案がありません。<a href="/run-now" style="color:#00d4ff">/run-now</a> を実行してください。</p></div>`}

</body>
</html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // ========================================
    // ★NEW: /proposal/approve - 承認 → KV保存
    // ========================================
    if (url.pathname === '/proposal/approve' && request.method === 'POST') {
      if (!env.KV) return new Response(JSON.stringify({ error: 'KV not bound' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      const yearMonth = new Date().toISOString().slice(0, 7);
      const raw = await env.KV.get(`PROPOSAL:${yearMonth}`);
      if (!raw) return new Response(JSON.stringify({ error: 'no proposal' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      const proposal = JSON.parse(raw);
      const coefficient = parseFloat(proposal.composite?.final_coefficient);
      // PRICE_INDEX_ACTIVE に書き込み（v11-SAFEが参照する）
      const activeData = {
        coefficient,
        approved_at: new Date().toISOString(),
        source_month: yearMonth,
        cgpi_weighted_pct: proposal.composite?.weighted_since_iran_pct,
        maker_avg_pct: proposal.composite?.maker_avg_pct
      };
      await env.KV.put('PRICE_INDEX_ACTIVE', JSON.stringify(activeData));
      // proposalのステータス更新
      proposal.status = 'approved';
      proposal.approved_at = activeData.approved_at;
      await env.KV.put(`PROPOSAL:${yearMonth}`, JSON.stringify(proposal));
      return new Response(JSON.stringify({ success: true, coefficient, message: `係数 ×${coefficient} を反映しました` }), { headers: { 'Content-Type': 'application/json' } });
    }

    // ========================================
    // ★NEW: /proposal/reject - 却下
    // ========================================
    if (url.pathname === '/proposal/reject' && request.method === 'POST') {
      if (!env.KV) return new Response(JSON.stringify({ error: 'KV not bound' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      const yearMonth = new Date().toISOString().slice(0, 7);
      const raw = await env.KV.get(`PROPOSAL:${yearMonth}`);
      if (!raw) return new Response(JSON.stringify({ error: 'no proposal' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      const proposal = JSON.parse(raw);
      proposal.status = 'rejected';
      proposal.rejected_at = new Date().toISOString();
      await env.KV.put(`PROPOSAL:${yearMonth}`, JSON.stringify(proposal));
      return new Response(JSON.stringify({ success: true, message: '却下しました' }), { headers: { 'Content-Type': 'application/json' } });
    }

    // ========================================
    // /stats - 健康状態確認
    // ========================================
    if (url.pathname === '/stats') {
      const health = {
        worker: 'hs-price-sync v5.1 (Phase 3-B)',
        kv_bound: !!env.KV,
        estat_app_id_set: !!env.ESTAT_APP_ID,
        line_token_set: !!env.LINE_CHANNEL_TOKEN,
        line_user_id_set: !!env.LINE_USER_ID,
        anthropic_key_set: !!env.ANTHROPIC_API_KEY
      };
      return new Response(JSON.stringify(health, null, 2), { headers: cors });
    }

    // ========================================
    // /debug/boj-iran-war（既存）
    // ========================================
    if (url.pathname === '/debug/boj-iran-war') {
      const proposal = await generateProposal(env);
      return new Response(JSON.stringify(proposal, null, 2), { headers: cors });
    }

    // Default
    return new Response(JSON.stringify({
      worker: 'hs-price-sync v5.2 (Phase 3-C)',
      company: 'The HORIZ音s株式会社',
      mission: 'HORIZON SHIELD 戦時価格自動補正システム',
      endpoints: {
        '/run-now': '★手動で提案生成＋KV保存＋LINE通知',
        '/notify-test': '★LINE通知単体テスト (KVから読む)',
        '/admin': '★★承認UI HTML（提案確認・承認・却下）',
        '/proposal/approve': 'POST: 承認 → PRICE_INDEX_ACTIVE 書き込み',
        '/proposal/reject': 'POST: 却下',
        '/proposal/latest': '現在月の最新提案取得',
        '/current-coefficient': 'v11-SAFE用の有効係数取得',
        '/stats': 'Worker健康状態',
        '/debug/boj-iran-war': '日銀CGPI戦時分析データ'
      },
      cron_schedule: '毎月10日 JST 22:00 (UTC 13:00)',
      next_phase: 'Phase 3-C: 承認UI /admin + /proposal/approve'
    }, null, 2), { headers: cors });
  },

  // ========================================
  // Scheduled Handler (Cron Trigger)
  // ========================================
  async scheduled(event, env, ctx) {
    console.log('[SCHEDULED] Triggered at:', new Date().toISOString());
    try {
      const proposal = await generateProposal(env);
      const yearMonth = new Date().toISOString().slice(0, 7);
      if (env.KV) {
        await env.KV.put(`PROPOSAL:${yearMonth}`, JSON.stringify(proposal));
        console.log(`[SCHEDULED] Saved: PROPOSAL:${yearMonth}`);
      }
      const summary = await generateClaudeSummary(proposal, env);
      await sendLineNotification(proposal, summary, env);
    } catch (e) {
      console.error('[SCHEDULED] Error:', e.message);
      if (env.LINE_CHANNEL_TOKEN && env.LINE_USER_ID) {
        await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.LINE_CHANNEL_TOKEN}` },
          body: JSON.stringify({ to: env.LINE_USER_ID, messages: [{ type: 'text', text: `🚨 hs-price-sync scheduled error\n${e.message}` }] })
        }).catch(() => {});
      }
    }
  }
};