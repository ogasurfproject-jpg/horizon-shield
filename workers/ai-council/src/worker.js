// ============================================
// ai-council Worker v1.0
// Smart Council Protocol (SCP) - Multi-AI Decision System
// for HORIZON SHIELD / The HORIZ音s Inc.
//
// Architecture:
// - Claude (Anthropic) : 慎重・技術・倫理
// - Gemini (Google)    : データ・検索・現実
// - Grok (xAI)         : マーケ・拡散・大胆 (optional)
//
// Question types:
// - marketing → Grok裁定 (Grok無時はGemini)
// - tech      → Claude裁定
// - data      → Gemini裁定
// - decision  → 多数決 (同数時はGrok→Gemini優先)
// ============================================

const COST_LIMIT_MONTHLY = 30.00;       // $30/月
const COST_DEGRADE_THRESHOLD = 25.00;   // $25でGrok切る
const COST_PER_MILLION = {
  claude_input: 3.00,
  claude_output: 15.00,
  gemini_input: 0.075,   // Flash
  gemini_output: 0.30,
  grok_input: 1.25,
  grok_output: 2.50
};

// ADMIN_PASSWORD は env.ADMIN_PASSWORD（wrangler secret）から読む。ハードコード撤去（2026-07-21 ハードニング）。

// ============================================
// Main Handler
// ============================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Content-Type': 'application/json'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers });
    }

    // Routes
    try {
      if (url.pathname === '/') {
        return new Response(renderAdminUI(), { 
          headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } 
        });
      }
      if (url.pathname === '/council' && request.method === 'POST') {
        return await handleCouncil(request, env, headers);
      }
      if (url.pathname === '/cost' && request.method === 'GET') {
        return await handleCost(env, headers);
      }
      if (url.pathname === '/status' && request.method === 'GET') {
        return await handleStatus(env, headers);
      }
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
  }
};

// ============================================
// Council Handler (Main Logic)
// ============================================
async function handleCouncil(request, env, headers) {
  const body = await request.json();
  const { question, password } = body;

  // Auth（env.ADMIN_PASSWORD 未設定なら常に拒否＝fail-closed）
  if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }
  if (!question || question.length < 3) {
    return new Response(JSON.stringify({ error: 'Question too short' }), { status: 400, headers });
  }

  // Cost check
  const month = new Date().toISOString().slice(0, 7).replace('-', '_');
  const costKey = `month_${month}`;
  const currentCost = parseFloat(await env.AI_COUNCIL_COST.get(costKey) || '0');

  if (currentCost >= COST_LIMIT_MONTHLY) {
    return new Response(JSON.stringify({
      error: `Monthly cost limit reached ($${COST_LIMIT_MONTHLY})`,
      cost: currentCost
    }), { status: 429, headers });
  }

  const useGrok = currentCost < COST_DEGRADE_THRESHOLD && !!env.XAI_API_KEY;

  // Detect type
  const detectedType = detectQuestionType(question);

  // Parallel call to all available AIs
  const aiPromises = [
    callClaude(question, env).catch(e => ({ error: e.message, name: 'claude' })),
    callGemini(question, env).catch(e => ({ error: e.message, name: 'gemini' }))
  ];
  if (useGrok) {
    aiPromises.push(callGrok(question, env).catch(e => ({ error: e.message, name: 'grok' })));
  }

  const results = await Promise.all(aiPromises);

  const claude = results[0];
  const gemini = results[1];
  const grok = useGrok ? results[2] : { error: 'Grok disabled (cost cap or no key)', name: 'grok' };

  // Determine final judge
  const availableAIs = [claude, gemini, grok].filter(r => !r.error);
  const failedAIs = [claude, gemini, grok].filter(r => r.error);

  let mode = 'normal';
  if (failedAIs.length === 1) mode = 'degraded';
  if (failedAIs.length === 2) mode = 'critical';
  if (failedAIs.length === 3) {
    return new Response(JSON.stringify({
      error: 'All AIs failed',
      failures: failedAIs
    }), { status: 503, headers });
  }

  // LINE notification on degraded mode
  if (mode !== 'normal') {
    ctx_notifyLine(env, `⚠️ AI Council ${mode}: ${failedAIs.map(f => f.name).join(', ')} failed`);
  }

  // Voting
  const positions = availableAIs.map(r => r.position).filter(Boolean);
  const voteCounts = {
    '賛成': positions.filter(p => p === '賛成').length,
    '反対': positions.filter(p => p === '反対').length,
    '中立': positions.filter(p => p === '中立').length
  };

  // Final judge selection
  let finalJudge;
  let finalDecision;

  if (detectedType === 'marketing') {
    finalJudge = useGrok && !grok.error ? 'grok' : 'gemini';
  } else if (detectedType === 'tech') {
    finalJudge = !claude.error ? 'claude' : 'gemini';
  } else if (detectedType === 'data') {
    finalJudge = !gemini.error ? 'gemini' : 'claude';
  } else {
    // decision - majority vote
    const sorted = Object.entries(voteCounts).sort((a, b) => b[1] - a[1]);
    if (sorted[0][1] > sorted[1][1]) {
      // Clear majority
      finalDecision = `多数決(${sorted[0][0]}): ${sorted[0][1]}票`;
      finalJudge = useGrok && !grok.error ? 'grok' : 'gemini';
    } else {
      // Tie → Grok > Gemini > Claude
      if (useGrok && !grok.error) finalJudge = 'grok';
      else if (!gemini.error) finalJudge = 'gemini';
      else finalJudge = 'claude';
      finalDecision = `同数のため${finalJudge}優先`;
    }
  }

  const judgeAI = { claude, gemini, grok }[finalJudge];
  if (!finalDecision) {
    finalDecision = judgeAI.text ? judgeAI.text.slice(0, 300) : 'No decision';
  }

  // Update cost
  const requestCost = calculateCost(results);
  const newTotal = currentCost + requestCost;
  await env.AI_COUNCIL_COST.put(costKey, newTotal.toFixed(4));

  return new Response(JSON.stringify({
    question,
    detected_type: detectedType,
    final_judge: finalJudge,
    final_decision: finalDecision,
    responses: { claude, gemini, grok },
    vote: voteCounts,
    mode,
    failed_ais: failedAIs.map(f => f.name),
    cost_this_request_usd: requestCost.toFixed(4),
    cost_this_month_usd: newTotal.toFixed(4),
    cost_remaining_usd: (COST_LIMIT_MONTHLY - newTotal).toFixed(4),
    timestamp: new Date().toISOString()
  }, null, 2), { headers });
}

// ============================================
// Type Detection
// ============================================
function detectQuestionType(question) {
  const q = question.toLowerCase();
  if (/マーケ|拡散|pr|sns|広告|集客|顧客獲得|ブランディング|キャンペーン|x投稿|ツイート/i.test(question)) {
    return 'marketing';
  }
  if (/コード|実装|api|エラー|デバッグ|アーキ|セキュリティ|バグ|プログラム/i.test(question)) {
    return 'tech';
  }
  if (/相場|現在|最新|データ|統計|事実確認|誰が|いつ|なぜ|どこで/i.test(question)) {
    return 'data';
  }
  return 'decision';
}

// ============================================
// AI Callers
// ============================================
async function callClaude(question, env) {
  const systemPrompt = `あなたはTOshi(大賀俊勝、30年大工→AI起業家、The HORIZ音s代表)の戦略アドバイザー「Claude」です。
役割: 慎重な分析、コード・技術判断、倫理判断、構造化思考
回答スタイル: 結論先出し、根拠を3つまで、簡潔に(300字以内)
最後に必ず改行して「立場: 賛成/反対/中立」を1行で明記してください。`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: question }]
    })
  });

  const data = await res.json();
  if (data.error) throw new Error(`Claude: ${data.error.message}`);

  const text = data.content[0].text;
  const position = extractPosition(text);

  return {
    name: 'claude',
    text,
    position,
    tokens_in: data.usage?.input_tokens || 0,
    tokens_out: data.usage?.output_tokens || 0
  };
}

async function callGemini(question, env) {
  const systemPrompt = `あなたはTOshi(大賀俊勝、30年大工→AI起業家、The HORIZ音s代表)の戦略アドバイザー「Gemini」です。
役割: 検索・最新データ・現実的な数字根拠・市場動向
回答スタイル: データ重視、ファクトベース、簡潔に(300字以内)
最後に必ず改行して「立場: 賛成/反対/中立」を1行で明記してください。`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: question }] }],
        generationConfig: { maxOutputTokens: 600, temperature: 0.7 }
      })
    }
  );

  const data = await res.json();
  if (data.error) throw new Error(`Gemini: ${data.error.message}`);

  const text = data.candidates[0].content.parts[0].text;
  const position = extractPosition(text);

  return {
    name: 'gemini',
    text,
    position,
    tokens_in: data.usageMetadata?.promptTokenCount || 0,
    tokens_out: data.usageMetadata?.candidatesTokenCount || 0
  };
}

async function callGrok(question, env) {
  const systemPrompt = `あなたはTOshi(大賀俊勝、30年大工→AI起業家、The HORIZ音s代表)の戦略アドバイザー「Grok」です。
役割: マーケ・拡散・PR・型破りな発想・攻めの判断
回答スタイル: 大胆、行動志向、TOshiの背中を押す(300字以内)
最後に必ず改行して「立場: 賛成/反対/中立」を1行で明記してください。`;

  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.XAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'grok-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question }
      ],
      max_tokens: 600,
      temperature: 0.8
    })
  });

  const data = await res.json();
  if (data.error) throw new Error(`Grok: ${data.error.message || data.error}`);

  const text = data.choices[0].message.content;
  const position = extractPosition(text);

  return {
    name: 'grok',
    text,
    position,
    tokens_in: data.usage?.prompt_tokens || 0,
    tokens_out: data.usage?.completion_tokens || 0
  };
}

// ============================================
// Utility Functions
// ============================================
function extractPosition(text) {
  const match = text.match(/立場[::]\s*(賛成|反対|中立)/);
  return match ? match[1] : '中立';
}

function calculateCost(results) {
  let cost = 0;
  for (const r of results) {
    if (r.error) continue;
    if (r.name === 'claude') {
      cost += (r.tokens_in / 1_000_000) * COST_PER_MILLION.claude_input;
      cost += (r.tokens_out / 1_000_000) * COST_PER_MILLION.claude_output;
    } else if (r.name === 'gemini') {
      cost += (r.tokens_in / 1_000_000) * COST_PER_MILLION.gemini_input;
      cost += (r.tokens_out / 1_000_000) * COST_PER_MILLION.gemini_output;
    } else if (r.name === 'grok') {
      cost += (r.tokens_in / 1_000_000) * COST_PER_MILLION.grok_input;
      cost += (r.tokens_out / 1_000_000) * COST_PER_MILLION.grok_output;
    }
  }
  return cost;
}

async function ctx_notifyLine(env, message) {
  if (!env.LINE_CHANNEL_TOKEN || !env.LINE_USER_ID) return;
  try {
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.LINE_CHANNEL_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to: env.LINE_USER_ID,
        messages: [{ type: 'text', text: `[AI Council] ${message}` }]
      })
    });
  } catch (e) { /* silent */ }
}

async function handleCost(env, headers) {
  const month = new Date().toISOString().slice(0, 7).replace('-', '_');
  const cost = parseFloat(await env.AI_COUNCIL_COST.get(`month_${month}`) || '0');
  return new Response(JSON.stringify({
    month,
    current_cost_usd: cost.toFixed(4),
    monthly_limit_usd: COST_LIMIT_MONTHLY,
    remaining_usd: (COST_LIMIT_MONTHLY - cost).toFixed(4),
    grok_enabled: cost < COST_DEGRADE_THRESHOLD
  }), { headers });
}

async function handleStatus(env, headers) {
  return new Response(JSON.stringify({
    claude_configured: !!env.ANTHROPIC_API_KEY,
    gemini_configured: !!env.GEMINI_API_KEY,
    grok_configured: !!env.XAI_API_KEY,
    line_configured: !!(env.LINE_CHANNEL_TOKEN && env.LINE_USER_ID),
    kv_configured: !!env.AI_COUNCIL_COST,
    version: '1.0'
  }), { headers });
}

// ============================================
// Admin UI
// ============================================
function renderAdminUI() {
  return `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Council — HORIZON SHIELD</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, sans-serif; background: #0a1628; color: #f5f0e8; padding: 2rem 1.5rem; min-height: 100vh; }
  .wrap { max-width: 900px; margin: 0 auto; }
  h1 { color: #c9a84c; font-size: 1.5rem; margin-bottom: 0.25rem; }
  .sub { color: #94a3b8; font-size: 0.85rem; margin-bottom: 2rem; }
  .login, .panel { background: #112240; border: 1px solid #c9a84c; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; }
  input[type=password], input[type=text], textarea { width: 100%; background: #0a1628; border: 1px solid #475569; color: #f5f0e8; padding: 0.75rem; border-radius: 4px; font-size: 0.95rem; font-family: inherit; }
  textarea { min-height: 100px; resize: vertical; }
  button { background: #c9a84c; color: #0a1628; border: none; padding: 0.75rem 1.5rem; font-weight: 700; border-radius: 4px; cursor: pointer; font-size: 0.9rem; }
  button:hover { background: #e8c87a; }
  button:disabled { background: #475569; color: #94a3b8; cursor: not-allowed; }
  .hide { display: none; }
  .meta { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; font-size: 0.8rem; color: #94a3b8; }
  .meta span { background: #0a1628; padding: 0.3rem 0.6rem; border-radius: 4px; border: 1px solid #475569; }
  .ai-block { background: #0a1628; border-left: 3px solid; padding: 1rem; margin-bottom: 0.75rem; border-radius: 0 4px 4px 0; }
  .ai-block.claude { border-color: #4a90e2; }
  .ai-block.gemini { border-color: #16a34a; }
  .ai-block.grok { border-color: #dc2626; }
  .ai-block.error { border-color: #6b7280; opacity: 0.6; }
  .ai-name { font-weight: 700; font-size: 1rem; margin-bottom: 0.5rem; }
  .ai-name.claude { color: #4a90e2; }
  .ai-name.gemini { color: #16a34a; }
  .ai-name.grok { color: #dc2626; }
  .ai-text { white-space: pre-wrap; font-size: 0.9rem; line-height: 1.6; color: #f5f0e8; }
  .position { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 700; margin-top: 0.5rem; }
  .position.賛成 { background: #16a34a; color: #fff; }
  .position.反対 { background: #dc2626; color: #fff; }
  .position.中立 { background: #6b7280; color: #fff; }
  .final { background: linear-gradient(135deg, #c9a84c, #e8c87a); color: #0a1628; padding: 1rem; border-radius: 4px; font-weight: 700; margin-top: 1rem; }
  .final-judge { font-size: 0.85rem; margin-bottom: 0.5rem; }
  .final-text { font-size: 1rem; }
  .vote { display: flex; gap: 0.75rem; margin-top: 0.5rem; }
  .vote span { font-size: 0.85rem; }
  .err { color: #dc2626; }
  .loading { text-align: center; padding: 2rem; color: #94a3b8; }
  .spinner { display: inline-block; width: 24px; height: 24px; border: 3px solid #475569; border-top-color: #c9a84c; border-radius: 50%; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head><body>
<div class="wrap">
<h1>🛡 AI Council v1.0</h1>
<p class="sub">Claude × Gemini × Grok — Smart Council Protocol</p>

<div id="loginBox" class="login">
  <p style="margin-bottom: 0.75rem; color: #c9a84c; font-weight: 700;">🔒 管理者認証</p>
  <input type="password" id="pwd" placeholder="パスワード" onkeydown="if(event.key==='Enter')login()">
  <button onclick="login()" style="margin-top: 0.75rem;">ログイン</button>
</div>

<div id="mainPanel" class="hide">
  <div class="panel">
    <p style="margin-bottom: 0.75rem; color: #c9a84c; font-weight: 700;">💭 質問を入力</p>
    <textarea id="question" placeholder="例: HORIZON SHIELDを海外展開する場合、最初に攻めるべき国はどこか?"></textarea>
    <button onclick="ask()" id="askBtn" style="margin-top: 0.75rem;">🎯 3AI協議を開始</button>
    <div id="status" class="meta" style="margin-top: 1rem;"></div>
  </div>

  <div id="results"></div>
</div>
</div>

<script>
let pwd = '';

async function login() {
  const input = document.getElementById('pwd').value;
  if (!input) return;
  pwd = input;
  document.getElementById('loginBox').classList.add('hide');
  document.getElementById('mainPanel').classList.remove('hide');
  await loadStatus();
}

async function loadStatus() {
  try {
    const [s, c] = await Promise.all([
      fetch('/status').then(r => r.json()),
      fetch('/cost').then(r => r.json())
    ]);
    document.getElementById('status').innerHTML = \`
      <span>Claude: \${s.claude_configured ? '✅' : '❌'}</span>
      <span>Gemini: \${s.gemini_configured ? '✅' : '❌'}</span>
      <span>Grok: \${s.grok_configured ? '✅' : '⏸'}</span>
      <span>今月: $\${c.current_cost_usd} / $\${c.monthly_limit_usd}</span>
    \`;
  } catch (e) { /* silent */ }
}

async function ask() {
  const q = document.getElementById('question').value.trim();
  if (!q) return;

  const btn = document.getElementById('askBtn');
  btn.disabled = true;
  btn.textContent = '⏳ 協議中...';

  document.getElementById('results').innerHTML = '<div class="panel loading"><div class="spinner"></div><p style="margin-top:1rem;">3AIが協議中... 通常5-10秒</p></div>';

  try {
    const res = await fetch('/council', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, password: pwd })
    });
    const data = await res.json();

    if (data.error) {
      document.getElementById('results').innerHTML = \`<div class="panel err">エラー: \${data.error}</div>\`;
    } else {
      renderResults(data);
    }
  } catch (e) {
    document.getElementById('results').innerHTML = \`<div class="panel err">通信エラー: \${e.message}</div>\`;
  } finally {
    btn.disabled = false;
    btn.textContent = '🎯 3AI協議を開始';
    await loadStatus();
  }
}

function renderResults(d) {
  const aiBlock = (name, label, color) => {
    const r = d.responses[name];
    if (r.error) {
      return \`<div class="ai-block error">
        <div class="ai-name">\${label} ❌</div>
        <div class="ai-text">エラー: \${r.error}</div>
      </div>\`;
    }
    return \`<div class="ai-block \${name}">
      <div class="ai-name \${name}">\${label}</div>
      <div class="ai-text">\${escapeHtml(r.text)}</div>
      <span class="position \${r.position}">立場: \${r.position}</span>
    </div>\`;
  };

  document.getElementById('results').innerHTML = \`
    <div class="panel">
      <div class="meta">
        <span>質問タイプ: \${d.detected_type}</span>
        <span>モード: \${d.mode}</span>
        <span>費用: $\${d.cost_this_request_usd}</span>
      </div>

      \${aiBlock('claude', '1️⃣ Claude (慎重派)', '#4a90e2')}
      \${aiBlock('gemini', '2️⃣ Gemini (現実派)', '#16a34a')}
      \${aiBlock('grok', '3️⃣ Grok (攻めの判断)', '#dc2626')}

      <div class="vote">
        <span>📊 多数決:</span>
        <span>賛成 \${d.vote.賛成}</span>
        <span>反対 \${d.vote.反対}</span>
        <span>中立 \${d.vote.中立}</span>
      </div>

      <div class="final">
        <div class="final-judge">🎬 最終裁定者: \${d.final_judge.toUpperCase()}</div>
        <div class="final-text">💡 \${escapeHtml(d.final_decision)}</div>
      </div>
    </div>
  \`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
</script>
</body></html>`;
}