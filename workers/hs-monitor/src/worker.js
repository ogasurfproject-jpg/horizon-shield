/**
 * HORIZON SHIELD 見込み客監視システム v14.0
 *
 * 【v14.0の変更点】
 * ① Yahoo!リアルタイム監視を完全削除（403ブロック対応）
 * ② HOT閾値を75に戻す
 * ③ RSS・X監視に集中
 */

const SCORE_THRESHOLD_HOT   = 85;
const SCORE_THRESHOLD_WATCH = 55;
const SEEN_TTL              = 60 * 60 * 24 * 7;
const PROSPECT_TTL          = 60 * 60 * 24 * 90;
const WATCH_BATCH_KEY       = 'watchbatch:pending';

const X_KEYWORDS = [
  'リフォーム 後悔','リノベ 後悔','リフォーム 失敗',
  '工務店 最悪','工務店 トラブル','業者 騙された',
  'リフォーム 詐欺','工事 ひどい','施工 欠陥','追加費用 おかしい',
  'リノベ 悩んでる','リノベーション どこに頼む','リフォーム 業者 どこ',
  '工務店 選び方','リフォーム 相場 わからない','見積もり 適正 わからない',
  'リノベ 費用 どのくらい',
  'リフォーム 見積もり 高い','見積もり 比較 リフォーム',
  '工事費 払いすぎ','建設費 高すぎ','追加工事 納得できない',
  '工務店 信用できない','業者 信頼できない',
  'リフォーム 完成 高かった','リノベ 完成 後悔',
  '工事 終わった 高い','引き渡し 不満','竣工 トラブル',
  '中古マンション 買った リノベ','古民家 買った リフォーム',
  '戸建て 購入 リフォーム','マンション 購入 内装',
  '店舗 出店 準備','内装業者 探してる',
  'テナント 工事 相場','開業準備 内装','飲食店 開業 工事費',
];

// ========================================
// KVキー生成
// ========================================
function makeSeenKey(post) {
  if (post.tweetId) return 'seen:x:' + post.tweetId;
  const base = post.title.slice(0, 40)
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_\u3040-\u9FFF]/g, '');
  return 'seen:rss:' + base;
}

function makeProspectKey(post) {
  if (post.tweetId) return 'prospect:x:' + post.tweetId;
  try {
    const url = new URL(post.link);
    const pathPart = url.pathname.split('/')[1] || 'unknown';
    return 'prospect:rss:' + url.hostname + ':' + pathPart;
  } catch {
    return 'prospect:rss:' + post.title.slice(0, 20).replace(/\s+/g, '_');
  }
}

// ========================================
// OAuth 1.0a 署名生成
// ========================================
async function hmacSha1(key, data) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function percentEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

async function buildOAuthHeader(method, url, params, env) {
  const oauthParams = {
    oauth_consumer_key:     env.X_API_KEY,
    oauth_nonce:            Math.random().toString(36).slice(2) + Date.now().toString(36),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp:        Math.floor(Date.now() / 1000).toString(),
    oauth_token:            env.X_ACCESS_TOKEN,
    oauth_version:          '1.0',
  };
  const allParams  = { ...params, ...oauthParams };
  const sortedKeys = Object.keys(allParams).sort();
  const paramStr   = sortedKeys.map(k => `${percentEncode(k)}=${percentEncode(allParams[k])}`).join('&');
  const baseString = [method.toUpperCase(), percentEncode(url), percentEncode(paramStr)].join('&');
  const sigKey     = `${percentEncode(env.X_API_SECRET)}&${percentEncode(env.X_ACCESS_SECRET)}`;
  oauthParams.oauth_signature = await hmacSha1(sigKey, baseString);
  return 'OAuth ' + Object.keys(oauthParams).sort()
    .map(k => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(', ');
}

// ========================================
// KV 既読管理
// ========================================
async function isAlreadySeen(kvKey, env) {
  try { return (await env.SEEN_STORE.get(kvKey)) !== null; }
  catch { return false; }
}

async function markAsSeen(kvKey, env) {
  try { await env.SEEN_STORE.put(kvKey, '1', { expirationTtl: SEEN_TTL }); }
  catch (e) { console.error('KV seen error:', e.message); }
}

// ========================================
// 見込み客KV管理
// ========================================
async function getProspect(key, env) {
  try {
    const val = await env.SEEN_STORE.get(key);
    return val ? JSON.parse(val) : null;
  } catch { return null; }
}

async function saveProspect(key, data, env) {
  try {
    await env.SEEN_STORE.put(key, JSON.stringify(data), { expirationTtl: PROSPECT_TTL });
  } catch (e) { console.error('KV prospect error:', e.message); }
}

// ========================================
// ウォッチバッチ管理
// ========================================
async function addToWatchBatch(post, score, reason, env) {
  try {
    const raw   = await env.SEEN_STORE.get(WATCH_BATCH_KEY);
    const batch = raw ? JSON.parse(raw) : [];
    batch.push({ title: post.title.slice(0, 50), score, reason, link: post.link, source: post.source });
    const trimmed = batch.slice(-10);
    await env.SEEN_STORE.put(WATCH_BATCH_KEY, JSON.stringify(trimmed), { expirationTtl: 60 * 60 * 2 });
  } catch (e) { console.error('KV batch error:', e.message); }
}

// ========================================
// rss.appウォッチURL生成
// ========================================
function buildWatchInstruction(post) {
  if (post.source === 'X' && post.link) {
    const match = post.link.match(/(?:twitter|x)\.com\/([^/]+)\/status/);
    if (match && match[1] && match[1] !== 'i') {
      return `\n👤 ウォッチ登録:\nrss.appで追加 → https://x.com/${match[1]}`;
    }
  }
  return '';
}

// ========================================
// 業者フィルター
// ========================================
function isVendorPost(text) {
  const hardVendorWords = [
    '弊社では','当社では','承っております','施工実績多数',
    'お気軽にお問い合わせ','見積もり無料','工事承り',
    '職人直営','建設会社です','工務店です','リフォーム会社です',
    'ハウスメーカー','#PR','#ad','#sponsored','スポンサード',
  ];
  return hardVendorWords.some(w => text.includes(w));
}

// ========================================
// AIスコアリング
// ========================================
async function scorePost(text, env) {
  const prompt = `あなたはHORIZON SHIELD（建設費診断サービス¥55,000〜）の見込み客判定AIです。
以下の投稿を分析し、サービスの潜在顧客かどうかをスコアリングしてください。

━━━━━━━━━━━━━━━━━━━━
【絶対除外（スコア0）】
━━━━━━━━━━━━━━━━━━━━
・業者・工務店・職人・建設会社の宣伝投稿
・公共工事/インフラ/道路/橋/ダム
・ゲーム・アニメ・比喩での「リフォーム」「工事」使用
・明らかなニュース記事・業界情報の転載
・交通・移動・生活環境・設備メンテナンス・収納・家電などの質問
・建設費・工事費・見積もりと無関係な質問は全て除外

━━━━━━━━━━━━━━━━━━━━
【見込み客の3パターン】
━━━━━━━━━━━━━━━━━━━━

■ パターンA: 今まさに困っている（80〜100点）
・見積書を受け取って高いと感じている
・工事中に追加請求が来て困惑している
・相見積もりをどこに頼めばいいか探している

■ パターンB: 被害後に怒っている（75〜90点）
・業者に騙された・高額請求された怒りを発散
・損害回復や業者への対処を模索している

■ パターンC: 家族・知人の代理（70〜85点）
・家族が被害に遭い代わりに相談しようとしている

■ パターンD: これから検討中（60〜75点）
・リフォーム/店舗開業を今後予定している

投稿: ${text.slice(0, 400)}

以下のJSONのみ返答:
{
  "score": 0〜100の整数,
  "pattern": "A/B/C/D/除外のいずれか",
  "reason": "15文字以内の判定理由",
  "is_vendor": true/false,
  "urgency": "高/中/低",
  "reply": "【厳守】建設費・工事費・見積もりの悩みに直接関係する投稿（パターンA/B/C/D）のみ生成。交通・収納・生活・設備・家電・その他無関係な質問には必ず空文字列\"\"を返せ。スコア75未満も必ず\"\"。合致する場合のみ：投稿内容に共感した上で自然にサービスへ誘導する文を100文字以内で。URLは含めるな。"
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 250,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) return { score: 0, pattern: '除外', reason: 'API error', is_vendor: false, urgency: '低', reply: '' };
    const data = await response.json();
    const raw  = data.content?.[0]?.text || '{}';
    try {
      return JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch {
      return { score: 0, pattern: '除外', reason: 'parse error', is_vendor: false, urgency: '低', reply: '' };
    }
  } catch (e) {
    return { score: 0, pattern: '除外', reason: 'fetch error', is_vendor: false, urgency: '低', reply: '' };
  }
}

// ========================================
// RSSフィード取得
// ========================================
async function fetchAlertFeeds(env) {
  const results = [];
  const urls    = (env.ALERT_FEED_URLS || '').split(',').map(u => u.trim()).filter(Boolean);

  for (const url of urls.slice(0, 15)) {
    try {
      const res = await fetch(url);
      if (!res.ok) { console.error(`RSS failed [${res.status}]: ${url}`); continue; }
      const xml        = await res.text();
      const atomItems  = xml.match(/<entry>([\s\S]*?)<\/entry>/g) || [];
      const rssItems   = xml.match(/<item>([\s\S]*?)<\/item>/g)   || [];
      const entries    = [...atomItems, ...rssItems];
      console.log(`RSS: ${url.slice(0, 50)}... → ${entries.length}件`);

      for (const entry of entries.slice(0, 3)) {
        const title = (entry.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] || '')
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'")
          .trim();
        const content = (
          entry.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)?.[1] ||
          entry.match(/<content[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content>/)?.[1] || ''
        ).replace(/<[^>]+>/g, '').trim();
        const link =
          entry.match(/<link[^>]*href="([^"]+)"/)?.[1] ||
          entry.match(/<link>(https?:\/\/[^<]+)<\/link>/)?.[1] || '';

        if (title && !isVendorPost(title + content)) {
          results.push({ text: title + ' ' + content, title: title.slice(0, 80), link, source: 'RSS' });
        }
      }
    } catch (e) { console.error('RSS error:', e.message); }
  }
  return results;
}

// ========================================
// X検索（OAuth 1.0a）
// ========================================
async function fetchXPosts(env) {
  const results = [];
  if (!env.X_API_KEY || !env.X_ACCESS_TOKEN) { console.log('X keys missing'); return results; }

  const now       = Math.floor(Date.now() / 1000 / 60 / 30);
  const batchSize = 6;
  const start     = (now % Math.ceil(X_KEYWORDS.length / batchSize)) * batchSize;
  const batch     = X_KEYWORDS.slice(start, start + batchSize);

  for (const keyword of batch) {
    try {
      const query       = `${keyword} -is:retweet lang:ja`;
      const baseUrl     = 'https://api.twitter.com/2/tweets/search/recent';
      const queryParams = { query, max_results: '10', 'tweet.fields': 'text,created_at,author_id' };
      const fullUrl     = baseUrl + '?' + new URLSearchParams(queryParams).toString();
      const authHeader  = await buildOAuthHeader('GET', baseUrl, queryParams, env);
      const res         = await fetch(fullUrl, { headers: { Authorization: authHeader } });
      if (!res.ok) {
        const err = await res.text();
        console.error(`X [${res.status}]: ${keyword} - ${err.slice(0, 100)}`);
        continue;
      }
      const data = await res.json();
      for (const tweet of (data.data || [])) {
        if (!isVendorPost(tweet.text)) {
          results.push({
            text:     tweet.text,
            title:    tweet.text.slice(0, 60),
            link:     `https://x.com/i/web/status/${tweet.id}`,
            tweetId:  tweet.id,
            source:   'X',
          });
        }
      }
    } catch (e) { console.error('X error:', keyword, e.message); }
  }
  return results;
}

// ========================================
// LINE通知
// ========================================
async function sendLine(message, env) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      Authorization:   `Bearer ${env.LINE_CHANNEL_TOKEN}`,
    },
    body: JSON.stringify({
  to: env.LINE_USER_ID,
  messages: [{ type: 'text', text: message.slice(0, 5000) }],
    }),
  });
  if (!res.ok) { const err = await res.text(); console.error('LINE失敗:', err); }
  return res.ok;
}
// ========================================
// 資材価格ニュース取得・KV保存
// ========================================
async function fetchAndSaveMaterialNews(env) {
  const feeds = [
    'https://news.google.com/rss/search?q=%E5%BB%BA%E8%A8%AD%E8%B3%87%E6%9D%90+%E4%BE%A1%E6%A0%BC&hl=ja&gl=JP&ceid=JP:ja',
    'https://news.google.com/rss/search?q=%E9%89%84%E9%8B%BC+%E6%9C%A8%E6%9D%90+%E5%80%A4%E4%B8%8A%E3%81%8C%E3%82%8A&hl=ja&gl=JP&ceid=JP:ja',
  ];

  const headlines = [];

  for (const url of feeds) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const xml = await res.text();
      const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
      for (const item of items.slice(0, 3)) {
        const title = (item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] || '')
          .replace(/<[^>]+>/g, '').trim();
        if (title) headlines.push(title);
      }
    } catch (e) { console.error('資材ニュースRSSエラー:', e.message); }
  }

  if (headlines.length === 0) return;

  const summary = headlines.slice(0, 5).join('\n・');
  const payload = {
    updatedAt: new Date().toISOString(),
    headlines: headlines.slice(0, 5),
    summary: `・${summary}`,
  };

  try {
    await env.SEEN_STORE.put(
      'market:daily_news',
      JSON.stringify(payload),
      { expirationTtl: 60 * 60 * 25 }
    );
    console.log('資材ニュースKV保存完了:', headlines.length + '件');
    // ワンクリックDB更新リンクをLINE送信
    const updateUrl = 'https://hs-monitor.oga-surf-project.workers.dev/update-db';
    const lineMsg =
      `📦【資材価格ニュース更新】\n━━━━━━━━━━\n・${headlines.slice(0,5).join('\n・')}\n━━━━━━━━━━\n👇 ワンクリックでDB反映\n${updateUrl}`;
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {'Content-Type':'application/json','Authorization':`Bearer ${env.LINE_CHANNEL_TOKEN}`},
      body: JSON.stringify({to: env.LINE_USER_ID, messages:[{type:'text',text:lineMsg}]})
    });
  } catch (e) { console.error('資材ニュースKV保存エラー:', e.message); }
}
// ========================================
// 大賀俊勝ブランド記事生成・LINE送信
// ========================================
const BRAND_THEMES = [
  {
    type: '告発・実例系',
    title: 'リフォーム業者が「今日中に決めないと値段が上がる」と言う本当の理由',
    prompt: '建設30年のプロとして、訪問販売業者が使う「今日中」「限定」などの心理的圧力手法を暴露する記事。具体的な手口と断り方を施主目線で。必ず「リフォーム 見積もり 高い」「過剰請求」「建設費診断」というキーワードを自然に入れること。記事末尾に「無料診断→ https://shield.the-horizons-innovation.com/presentation.html」を入れること。1000文字。記号「*」「#」「_」は使わない。',
  },
  {
    type: '大賀俊勝ブランド系',
    title: '棟梁に叩き込まれた「誤魔化すな」の一言が、今のAIサービスの原点だ',
    prompt:  '大工1年目に棟梁から叩き込まれた職人の矜持。海外2年半の経験、大工→現場監督→CM→AIエンジニアという異色のキャリア。なぜ施主側に立つサービスを作ったのか。一人称で熱く語る。必ず「建設費診断」「見積書 査定」「外壁塗装 適正価格」を自然に入れること。記事末尾に「無料診断→ https://shield.the-horizons-innovation.com/presentation.html」を入れること。1000文字。記号「*」「#」「_」は使わない。',
  },
  {
    type: '業界構造系',
    title: '「一式」という言葉が建設業界で横行する構造的な理由',
    prompt: '建設業界で見積書に「一式」と書く慣習がなぜ生まれたか。業界の構造的問題として解説。施主が知るべき真実を権威ある専門家として語る。必ず「リフォーム 見積もり 高い」「見積書 査定」「過剰請求 チェック」を自然に入れること。記事末尾に「無料診断→ https://shield.the-horizons-innovation.com/presentation.html」を入れること。1000文字。記号「*」「#」「_」は使わない。',
  },
];

const FOOTER = `

━━━━━━━━━━━━━━━━

🛡 HORIZON SHIELD — 無料で使える窓口

📍 LP：https://shield.the-horizons-innovation.com
🤖 ChatGPT：https://chatgpt.com/g/g-69e180f9a5048191886069dd58b22572-jian-she-fei-tietuka-by-horizon-shield
♊ Gemini：https://gemini.google.com/gem/1_AqLRwNSP1tZWZNWzyNIrsOrBLI1fAjo
💬 LINE KIRA：https://line.me/R/ti/p/@172piime

#建設費診断 #リフォーム #見積もり #ぼったくり #HORIZONSHIELD #大賀俊勝`;

// ========================================
// ★ X断言投稿ネタ生成（NETA-KIT追加）
//   監視で拾った「施主の生の言葉」から、Xに自分で投稿する断言ネタを3本作りLINE送信
//   ※既存のリプライ機能とは別系統。追いかけリプライでなく「自分で投稿」用。
// ========================================
async function generateXPostIdeas(env) {
  try {
    // 監視で蓄積した見込み客の「生の言葉」を取得（高スコア順）
    const prospects = await listProspects(env);
    const voices = (Array.isArray(prospects) ? prospects : [])
      .map(p => (p.firstTitle || p.lastTitle || '').trim())
      .filter(t => t.length > 8)
      .slice(0, 12);

    // 生の言葉が無い日は、汎用テーマで生成（空振り防止）
    const voiceBlock = voices.length > 0
      ? voices.map((v, i) => `${i + 1}. ${v}`).join('\n')
      : '（本日は監視で拾えた生の声が少ないため、リフォーム見積もりの一般的な不安をネタにすること）';

    const prompt = `あなたは大賀俊勝（建設業30年・大工→現場監督→CM→AIエンジニア）。
施主がXで実際に呟いていた「生の不安の言葉」を下に並べます。
この生の言葉を踏まえ、あなた自身がXに投稿する「断言ポスト」を3本作ってください。

【施主が実際に呟いた言葉】
${voiceBlock}

【断言ポストの型（必ず守る）】
・1行目：定説をひっくり返す一行（「みんなこう言うが、違う」）
・2〜3行目：30年の現場からの本音（一次体験）
・最後：具体的な数字1つ、または見るべき1点
・売り込み・URL・料金は書かない（価値100%）
・1本140〜220文字。リプライ誘発の余白を残す。

JSONのみ返答：
{"posts":["1本目の全文","2本目の全文","3本目の全文"]}`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await res.json();
    let parsed;
    try {
      parsed = JSON.parse((data.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim());
    } catch {
      parsed = { posts: [] };
    }
    const posts = Array.isArray(parsed.posts) ? parsed.posts.slice(0, 3) : [];
    if (posts.length === 0) { console.log('Xネタ生成: 0件（スキップ）'); return; }

    const body = posts.map((p, i) => `【${i + 1}本目】\n${p}`).join('\n\n━━━━━━━━━━\n\n');
    const message =
      `🐦【X断言ポスト ネタ3本 ready】\n` +
      `（施主の生の声 ${voices.length}件から生成）\n` +
      `━━━━━━━━━━\n\n` +
      `${body}\n\n` +
      `━━━━━━━━━━\n` +
      `👆 どれか1本を選んでXに投稿。来たリプには必ず返信（会話が最強）。`;

    await sendLine(message, env);
    console.log('Xネタ生成・LINE送信完了:', posts.length + '本 / 生の声' + voices.length + '件');
  } catch (e) {
    console.error('Xネタ生成エラー:', e.message);
  }
}

async function generateAndSendArticle(env) {
  try {
    // ★ テーマ・タイトルをその都度AIが生成
    const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

    const themeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `今日は${today}です。
HORIZON SHIELD（建設費診断サービス）のnote記事のテーマとタイトルを1つ考えてください。
大賀俊勝（建設30年・大工→現場監督→CMR→AIエンジニア）が書く記事です。

以下のジャンルからその日に合ったものを選んでください：
- 告発・実例系（業者の手口暴露）
- 業界構造系（業界の仕組み解説）
- 大賀俊勝ブランド系（自身の経験・キャリア）
- 季節・時事連動系（今の季節や社会状況に絡めた切り口）

【厳守】過去によく使われるタイトルと被らないよう、新鮮な切り口で考えること。
例えばこれらとは被らないこと：「今日中に決めないと」「一式という言葉」「棟梁に叩き込まれた」

JSONのみ返答：
{"type":"ジャンル名","title":"記事タイトル（40文字以内）","angle":"この記事で伝えたい核心（20文字以内）"}`
        }],
      }),
    });

    const themeData = await themeRes.json();
    let theme;
    try {
      theme = JSON.parse((themeData.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim());
    } catch {
      theme = { type: '告発・実例系', title: '建設費の「適正価格」を知らないと損をする理由', angle: '情報格差の実態' };
    }

    console.log('テーマ生成:', theme.type, theme.title);

    // ★ 本文生成
    const articlePrompt = `あなたは大賀俊勝（建設業30年・大工→現場監督→CMR→AIエンジニア）です。
以下のテーマで記事を書いてください。

タイトル：${theme.title}
伝えたい核心：${theme.angle}
ジャンル：${theme.type}

【必須条件】
・施主（工事を依頼する一般の方）の味方として書く
・具体的な金額・事例・数字を入れる
・「リフォーム 見積もり 高い」「建設費診断」「見積書 査定」のいずれかを自然に含める
・記事末尾に「無料診断→ https://shield.the-horizons-innovation.com/presentation.html」を入れる
・1000文字
・記号「*」「#」「_」は使わない`;

    const articleRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{ role: 'user', content: articlePrompt }],
      }),
    });

    const articleData = await articleRes.json();
    const text = (articleData.content?.[0]?.text || '').replace(/\*\*/g, '').replace(/\*/g, '').replace(/#+\s/g, '').trim();

    const message =
      `📝【note投稿用記事 ready】\n` +
      `種別：${theme.type}\n` +
      `━━━━━━━━━━\n` +
      `タイトル：${theme.title}\n\n` +
      `${text}${FOOTER}\n\n` +
      `━━━━━━━━━━\n` +
      `👆 上記をnoteにコピペして投稿してください`;

    await sendLine(message, env);
    console.log('記事LINE送信完了:', theme.type, theme.title);
  } catch (e) {
    console.error('記事生成エラー:', e.message);
  }
}
// ========================================
// メイン処理
// ========================================
async function scanAndNotify(env) {
  const [rssPosts, xPosts] = await Promise.all([
    fetchAlertFeeds(env),
    fetchXPosts(env),
  ]);

  const seenThisScan = new Set();
  const allPosts = [...rssPosts, ...xPosts].filter(post => {
    const key = makeSeenKey(post);
    if (seenThisScan.has(key)) return false;
    seenThisScan.add(key);
    return true;
  });

  console.log(`取得: RSS=${rssPosts.length} X=${xPosts.length} 合計=${allPosts.length}`);

  let notifiedHot   = 0;
  let notifiedWatch = 0;
  let recontact     = 0;
  let skipped       = 0;
  const watchBatchItems = [];

  for (const post of allPosts) {
    const seenKey     = makeSeenKey(post);
    const prospectKey = makeProspectKey(post);

    if (await isAlreadySeen(seenKey, env)) { skipped++; continue; }
    await markAsSeen(seenKey, env);

    const existingProspect = await getProspect(prospectKey, env);
    const result = await scorePost(post.text, env);

    console.log(`[${post.source}][${result.pattern}] score:${result.score} ${result.is_vendor ? '[業者]' : ''} "${post.title.slice(0, 25)}"`);

    // ★ 修正①: 既存見込み客の再投稿も、スコアがHOT閾値以上の場合のみ通知（水面下監視）
    if (existingProspect && !result.is_vendor && result.score >= SCORE_THRESHOLD_HOT) {
      const urgencyMark = result.score >= 90 ? '🔥緊急' : result.score >= 75 ? '🎯再接触' : '👀動向';
      let replyLink = '';
      if (post.tweetId) {
        const replyText = result.reply ? result.reply + '\n→ shield.the-horizons-innovation.com' : '→ shield.the-horizons-innovation.com';
        const rt = encodeURIComponent(replyText);
        replyLink = `https://x.com/intent/tweet?in_reply_to=${post.tweetId}&text=${rt}`;
      }
      const replySection = result.reply
        ? `📝 推奨リプライ:\n${result.reply}\n→ shield.the-horizons-innovation.com\n\n`
        : '';
      const msg =
        `${urgencyMark}【既存見込み客が再投稿！】[${post.source}]\n━━━━━━━━━━\n` +
        `📋 ${post.title}\n\n💡 ${result.reason}（パターン${result.pattern}）\n` +
        `⏰ 緊急度: ${result.urgency}\n📊 今回:${result.score}点 ／ 初回:${existingProspect.firstScore}点\n\n` +
        replySection +
        `🔗 元投稿:\n${post.link}` +
        (replyLink ? `\n\n👆 1タップリプライ:\n${replyLink}` : '') +
        `\n━━━━━━━━━━`;
      await sendLine(msg, env);
      notifiedHot++;
      recontact++;
      await saveProspect(prospectKey, {
        ...existingProspect,
        lastSeen:     Date.now(),
        lastTitle:    post.title,
        lastScore:    result.score,
        contactCount: (existingProspect.contactCount || 1) + 1,
      }, env);

    } else if (existingProspect && !result.is_vendor && result.score < SCORE_THRESHOLD_HOT) {
      // ★ 水面下監視：スコア低い再投稿はKV更新のみ、LINEには送らない
      console.log(`[水面下] 既存見込み客だが無関係投稿のためスキップ: score=${result.score} "${post.title.slice(0, 25)}"`);
      await saveProspect(prospectKey, {
        ...existingProspect,
        lastSeen:  Date.now(),
        lastTitle: post.title,
        lastScore: result.score,
      }, env);

    } else if (result.score >= SCORE_THRESHOLD_HOT && !result.is_vendor) {
      const urgencyMark = result.score >= 90 ? '🔥緊急' : '🎯発見';
      let replyLink = '';
      if (post.tweetId) {
        const replyText = result.reply ? result.reply + '\n→ shield.the-horizons-innovation.com' : '→ shield.the-horizons-innovation.com';
        const rt = encodeURIComponent(replyText);
        replyLink = `https://x.com/intent/tweet?in_reply_to=${post.tweetId}&text=${rt}`;
      }
      const watchInstr = buildWatchInstruction(post);
      const replySection = result.reply
        ? `📝 推奨リプライ:\n${result.reply}\n→ shield.the-horizons-innovation.com\n\n`
        : '';
      const msg =
        `${urgencyMark}【${result.score}点 / パターン${result.pattern}】[${post.source}]\n━━━━━━━━━━\n` +
        `📋 ${post.title}\n\n💡 ${result.reason}\n⏰ 緊急度: ${result.urgency}\n\n` +
        replySection +
        `🔗 元投稿:\n${post.link}` +
        (replyLink ? `\n\n👆 1タップリプライ:\n${replyLink}` : '') +
        watchInstr + `\n━━━━━━━━━━`;
      await sendLine(msg, env);
      notifiedHot++;
      await saveProspect(prospectKey, {
        firstTitle:   post.title,
        firstScore:   result.score,
        firstPattern: result.pattern,
        firstLink:    post.link,
        source:       post.source,
        addedAt:      Date.now(),
        lastSeen:     Date.now(),
        contactCount: 1,
        tier:         'hot',
      }, env);

    } else if (result.score >= SCORE_THRESHOLD_WATCH && !result.is_vendor) {
      watchBatchItems.push({ post, result });
      notifiedWatch++;
      await saveProspect(prospectKey, {
        firstTitle:   post.title,
        firstScore:   result.score,
        firstPattern: result.pattern,
        firstLink:    post.link,
        source:       post.source,
        addedAt:      Date.now(),
        lastSeen:     Date.now(),
        contactCount: 0,
        tier:         'watch',
      }, env);
    }

    await new Promise(r => setTimeout(r, 300));
  }

  if (watchBatchItems.length > 0) {
    let batchMsg = `👀 ウォッチリスト追加（${watchBatchItems.length}件）\n━━━━━━━━━━\n`;
    for (const { post, result } of watchBatchItems) {
      batchMsg += `[${result.score}点/パターン${result.pattern}][${post.source}] ${post.title.slice(0, 40)}\n→ ${post.link}\n\n`;
    }
    batchMsg += `※再投稿があれば自動で通知します\n━━━━━━━━━━`;
    await sendLine(batchMsg, env);
  }

  return {
    scanned:      allPosts.length,
    notifiedHot,
    notifiedWatch,
    recontact,
    skipped,
    rss:          rssPosts.length,
    x:            xPosts.length,
  };
}

// ========================================
// 見込み客リスト確認
// ========================================
async function listProspects(env) {
  try {
    const list      = await env.SEEN_STORE.list({ prefix: 'prospect:' });
    const prospects = [];
    for (const key of list.keys) {
      const val = await env.SEEN_STORE.get(key.name);
      if (val) prospects.push({ key: key.name, ...JSON.parse(val) });
    }
    prospects.sort((a, b) => (b.firstScore || 0) - (a.firstScore || 0));
    return prospects;
  } catch (e) { return { error: e.message }; }
}

// ========================================
// エントリーポイント
// ========================================

// 定数時間比較（掟 L1）。SHA-256 して XOR 集約。
async function ctEqual(a, b) {
  a = String(a == null ? '' : a); b = String(b == null ? '' : b);
  const enc = new TextEncoder();
  const ha = await crypto.subtle.digest('SHA-256', enc.encode(a));
  const hb = await crypto.subtle.digest('SHA-256', enc.encode(b));
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let out = 0;
  for (let i = 0; i < x.length; i++) out |= x[i] ^ y[i];
  return out === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 2026-07-19 H1/H2/M2/M3/M4: 制御ルートは CONTROL_TOKEN 必須（scheduled は別経路なので無影響）
    const CONTROL_PATHS = ['/scan', '/test', '/prospects', '/fetch-material-news', '/reset-seen', '/update-db'];
    if (CONTROL_PATHS.includes(url.pathname)) {
      const provided = url.searchParams.get('token')
        || (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
        || request.headers.get('X-Control-Token') || '';
      if (!env.CONTROL_TOKEN || !(await ctEqual(provided, env.CONTROL_TOKEN))) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
    }

    if (url.pathname === '/scan') {
      const result = await scanAndNotify(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/test') {
      const msg = '🛡️ HORIZON SHIELD v14.0 テスト';
      const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.LINE_CHANNEL_TOKEN}`,
        },
        body: JSON.stringify({
  to: env.LINE_USER_ID,
  messages: [{ type: 'text', text: msg }],
        }),
      });
      const body = await res.text();
      return new Response(
        `STATUS: ${res.status}\nBODY: ${body}`,
        { headers: { 'Content-Type': 'text/plain' } }
      );
    }

    if (url.pathname === '/prospects') {
      const prospects = await listProspects(env);
      return new Response(JSON.stringify(prospects, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/fetch-material-news') {
      await fetchAndSaveMaterialNews(env);
      return new Response('資材ニュース取得・KV保存完了', { status: 200 });
    }
    if (url.pathname === '/reset-seen') {
      try {
        const list = await env.SEEN_STORE.list({ prefix: 'seen:' });
        for (const key of list.keys) await env.SEEN_STORE.delete(key.name);
        return new Response(`削除完了: ${list.keys.length}件`);
      } catch (e) {
        return new Response('エラー: ' + e.message, { status: 500 });
      }
    }
    if (url.pathname === '/update-db') {
      try {
        const raw = await env.SEEN_STORE.get('market:daily_news');
        if (!raw) return new Response('ニュースデータなし', {status:404});
        const market = JSON.parse(raw);
        const newsText = market.headlines.join('\n');
        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {'Content-Type':'application/json','x-api-key':env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
          body: JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:800,messages:[{role:'user',content:`以下の建設資材ニュースから価格変動情報を抽出。\n${newsText}\n\nJSON形式のみ:\n{"updates":[{"item":"品目名","change":"値上がり/値下がり/品薄","percent":"変動率","note":"一言メモ"}],"summary":"要約30文字以内"}`}]})
        });
        const aiData = await aiRes.json();
        let parsed;
        try { parsed = JSON.parse((aiData.content?.[0]?.text||'{}').replace(/```json|```/g,'').trim()); }
        catch { parsed = {updates:[],summary:'解析失敗'}; }
        const ghHeaders = {'Authorization':`token ${env.GITHUB_PAT}`,'Accept':'application/vnd.github.v3+json','Content-Type':'application/json'};
        const dbRes = await fetch('https://api.github.com/repos/ogasurfproject-jpg/horizon-shield/contents/data/zaisai-db9.json',{headers:ghHeaders});
        let updatedCount = 0;
        if (dbRes.ok) {
          const dbData = await dbRes.json();
          const dbContent = JSON.parse(atob(dbData.content.replace(/\n/g,'')));
          const now2026 = new Date().toISOString().slice(0,7);
          if (!dbContent.categories['品薄・高騰警告_自動更新']) dbContent.categories['品薄・高騰警告_自動更新'] = [];
          for (const u of (parsed.updates||[])) {
            dbContent.categories['品薄・高騰警告_自動更新'].push({name:u.item+'（'+u.change+' '+u.percent+'）',unit:'式',unit_price:0,memo:u.note+'【自動更新 '+now2026+'】'});
            updatedCount++;
          }
          dbContent.categories['品薄・高騰警告_自動更新'] = dbContent.categories['品薄・高騰警告_自動更新'].slice(-20);
          const newContent = btoa(unescape(encodeURIComponent(JSON.stringify(dbContent,null,2))));
          await fetch('https://api.github.com/repos/ogasurfproject-jpg/horizon-shield/contents/data/zaisai-db9.json',{method:'PUT',headers:ghHeaders,body:JSON.stringify({message:`Auto-update: 資材価格DB自動更新 ${now2026}`,content:newContent,sha:dbData.sha,branch:'main'})});
        }
        const doneMsg = `✅【DB自動更新完了】\n${parsed.summary}\n更新: ${updatedCount}件\n${(parsed.updates||[]).map(u=>`・${u.item}: ${u.change} ${u.percent}`).join('\n')}`;
        await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${env.LINE_CHANNEL_TOKEN}`},body:JSON.stringify({to:env.LINE_USER_ID,messages:[{type:'text',text:doneMsg}]})});
        return new Response(JSON.stringify({ok:true,updated:updatedCount}),{headers:{'Content-Type':'application/json'}});
      } catch(e) {
        return new Response(JSON.stringify({ok:false,error:e.message}),{status:500});
      }
    }
    return new Response('HORIZON SHIELD Monitor v14.0', { status: 200 });
  },

  async scheduled(event, env, ctx) {
    const jstHour = new Date(Date.now() + 9 * 3600000).getUTCHours();
    if (jstHour === 8) {
  ctx.waitUntil(generateAndSendArticle(env));
  ctx.waitUntil(fetchAndSaveMaterialNews(env));
  ctx.waitUntil(generateXPostIdeas(env));
}
    ctx.waitUntil(scanAndNotify(env));
  },
};
