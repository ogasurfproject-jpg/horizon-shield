/**
 * HORIZON SHIELD note自動投稿 v8
 * 純粋API方式（Puppeteer不使用）
 */

const https = require('https');

const NOTE_EMAIL    = process.env.NOTE_EMAIL;
const NOTE_PASSWORD = process.env.NOTE_PASSWORD;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const LINE_TOKEN    = process.env.LINE_CHANNEL_TOKEN;
const LINE_USER_ID  = process.env.LINE_USER_ID;

const THEMES = [
  { title: 'リフォーム業者が絶対に教えない「見積書の5つの罠」', keywords: ['一式見積もり', '諸経費', '図面なし', '数量不明', '口頭約束'], angle: '施主が知らない業者の常套手段を暴露する内容', hashtags: ['リフォーム', '見積書', '建設', '施主', 'HORIZONSHIELD'] },
  { title: '「追加工事が必要です」と言われたら疑え。建設30年のプロが語る真実', keywords: ['追加工事', '契約外', '口頭指示', '変更工事査定', '証拠'], angle: '追加請求の正当性を見極める方法', hashtags: ['追加工事', '建設トラブル', '施工', '見積もり', 'HORIZONSHIELD'] },
  { title: '外壁塗装300万円は高いのか？適正価格の見分け方を徹底解説', keywords: ['外壁塗装', '足場代', '塗料原価', '坪単価', '相見積もり'], angle: '具体的な数字で適正価格を解説する内容', hashtags: ['外壁塗装', 'リフォーム', '塗装工事', '相見積もり', 'HORIZONSHIELD'] },
  { title: '工務店選びで失敗しない7つのチェックポイント', keywords: ['建設業許可', '施工実績', '保証内容', '契約書', '口コミ'], angle: '施主が業者を選ぶ際の具体的な判断基準', hashtags: ['工務店', '建設業者', 'リフォーム', '業者選び', 'HORIZONSHIELD'] },
  { title: '引き渡し前に必ず確認すべき施工不良チェックリスト20項目', keywords: ['施工不良', '完成検査', 'クロス', '床鳴り', '防水'], angle: '素人でもできる施工不良の見つけ方', hashtags: ['施工不良', '建設検査', '新築', 'リフォーム', 'HORIZONSHIELD'] },
  { title: '店舗開業の内装工事、適正価格はいくら？坪単価の相場を業種別に解説', keywords: ['坪単価', '飲食店', 'サロン', 'クリニック', '内装工事'], angle: '業種別の適正な内装工事費用の目安', hashtags: ['店舗内装', '内装工事', '開業', '坪単価', 'HORIZONSHIELD'] },
  { title: '見積書を「高い」と感じたら最初にやるべきこと3つ', keywords: ['見積書確認', '内訳', '単価', '数量', '専門家相談'], angle: '見積書に違和感を感じた時の具体的な行動手順', hashtags: ['見積書', 'リフォーム', '建設費用', '施主', 'HORIZONSHIELD'] },
];

function getTodayTheme() {
  const d = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  return THEMES[d % THEMES.length];
}

// HTTPSリクエストをPromise化
function httpsRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const cookies = [];
        for (let i = 0; i < res.rawHeaders.length; i += 2) {
          if (res.rawHeaders[i].toLowerCase() === 'set-cookie') {
            cookies.push(res.rawHeaders[i + 1]);
          }
        }
        resolve({ status: res.statusCode, body: data, cookies, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// セッションCookieを環境変数から直接取得
async function noteLogin() {
  const session = process.env.NOTE_SESSION;
  if (!session) throw new Error('NOTE_SESSION が設定されていません');
  const cookieStr = `_note_session_v5=${session}`;
  console.log('セッションCookie使用（環境変数から取得）');
  return { cookieStr, token: '' };
}

// CSRFトークン取得
async function getCsrfToken(cookieStr) {
  const res = await httpsRequest({
    hostname: 'note.com',
    path: '/api/v1/token',
    method: 'GET',
    headers: {
      'Cookie': cookieStr,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
    },
  });
  try {
    const json = JSON.parse(res.body);
    const csrf = json.data?.token || json.token || '';
    console.log('CSRFトークン:', csrf ? '取得成功' : '取得失敗');
    return csrf;
  } catch(e) {
    console.log('CSRFトークン取得エラー:', e.message);
    return '';
  }
}

// 記事本文をnote形式のHTMLに変換
function textToNoteBody(text) {
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  return text.split('\n\n')
    .map(p => p.trim()).filter(Boolean)
    .map(p => {
      const id = uuid();
      return `<p name="${id}" id="${id}">${p.replace(/\n/g, '<br>')}</p>`;
    }).join('');
}

// note記事を投稿
async function postNote(theme, bodyText, cookieStr, csrfToken) {
  const noteBody = textToNoteBody(bodyText);

  // まず下書きとして記事を作成
  const createBody = JSON.stringify({
    title: theme.title,
    body: noteBody,
    status: 'draft',
  });

  const createRes = await httpsRequest({
    hostname: 'note.com',
    path: '/api/v3/notes',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(createBody),
      'Cookie': cookieStr,
      'X-Note-Csrf-Token': csrfToken,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Origin': 'https://note.com',
      'Referer': 'https://note.com/notes/new',
      'Accept': 'application/json',
    },
  }, createBody);

  console.log('記事作成ステータス:', createRes.status);

  let noteId = '';
  try {
    const json = JSON.parse(createRes.body);
    noteId = json.data?.id || json.id || '';
    console.log('記事ID:', noteId);
  } catch(e) {
    throw new Error(`記事作成失敗: ${createRes.body.slice(0, 300)}`);
  }

  if (!noteId) throw new Error('記事IDが取得できなかった');

  // ハッシュタグを設定
  const tagBody = JSON.stringify({ hashtag_list: theme.hashtags });
  await httpsRequest({
    hostname: 'note.com',
    path: `/api/v3/notes/${noteId}/hashtags`,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(tagBody),
      'Cookie': cookieStr,
      'X-Note-Csrf-Token': csrfToken,
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json',
    },
  }, tagBody);
  console.log('ハッシュタグ設定完了');

  // 公開
  const publishBody = JSON.stringify({ status: 'published' });
  const publishRes = await httpsRequest({
    hostname: 'note.com',
    path: `/api/v3/notes/${noteId}/publish`,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(publishBody),
      'Cookie': cookieStr,
      'X-Note-Csrf-Token': csrfToken,
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json',
    },
  }, publishBody);

  console.log('公開ステータス:', publishRes.status);

  let slug = '';
  try {
    const json = JSON.parse(publishRes.body);
    slug = json.data?.key || json.data?.slug || noteId;
  } catch(e) {}

  return `https://note.com/horizon_shield/n/${slug || noteId}`;
}

// Claude API で記事生成
async function generateArticle(theme) {
  console.log('記事生成中:', theme.title);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `あなたは建設歴30年のプロ「大賀俊勝」として、施主側に立ったnote記事を書いてください。

【記事タイトル】${theme.title}
【含めるキーワード】${theme.keywords.join('、')}
【方向性】${theme.angle}

【ルール】
・一人称は「私」
・建設30年のプロとしての権威を自然に出す
・施主への共感から始める
・具体的な数字・事例を入れる
・1000〜1200文字
・段落は空行で区切る
・記号「*」「**」「#」「_」は使わない
・末尾に必ずこの文を入れる：
「見積書の適正価格が気になる方は、HORIZON SHIELDの無料AI診断をお試しください。建設30年の専門知識を学習したAIが、あなたの見積書を即座に分析します。
https://shield.the-horizons-innovation.com

また、建設費・リフォームで損をしないための情報を毎日発信しているコミュニティがあります。参加無料です。
https://line.me/ti/g2/7JH1RLFfppFpf4hvhrDZP51B6embu5UHN31WJQ」

本文のみ出力（タイトル不要）。`,
      }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API失敗 [${res.status}]`);
  const data = await res.json();
  let text = data.content?.[0]?.text || '';
  text = text.replace(/\*\*/g, '').replace(/\*/g, '').replace(/^#{1,6}\s/gm, '');
  console.log('記事生成完了 文字数:', text.length);
  return text;
}

// LINE通知
async function sendLine(message) {
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ to: LINE_USER_ID, messages: [{ type: 'text', text: message.slice(0, 5000) }] }),
  });
}

// LINEブロードキャスト
async function broadcastToFollowers(theme, noteUrl) {
  const text = `【今日の建設情報】\n\n${theme.title}\n\n▼ 続きを読む\n${noteUrl}\n\n━━━━━━━━━━\n📣 無料コミュニティ参加受付中！\nhttps://line.me/ti/g2/7JH1RLFfppFpf4hvhrDZP51B6embu5UHN31WJQ\n\n見積書の無料AI診断👇\nhttps://shield.the-horizons-innovation.com`;
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LINE_TOKEN}` },
      body: JSON.stringify({ messages: [{ type: 'text', text }] }),
    });
    console.log('ブロードキャスト:', res.ok ? '成功' : `失敗 [${res.status}]`);
  } catch(e) {
    console.log('ブロードキャスト失敗:', e.message);
  }
}

async function main() {
  console.log('=== HORIZON SHIELD note自動投稿 v8 開始 ===');
  try {
    const required = ['NOTE_SESSION', 'ANTHROPIC_API_KEY', 'LINE_CHANNEL_TOKEN', 'LINE_USER_ID'];
    for (const key of required) {
      if (!process.env[key]) throw new Error(`環境変数未設定: ${key}`);
    }

    const theme = getTodayTheme();
    console.log('今日のテーマ:', theme.title);

    // ログイン
    const { cookieStr, token } = await noteLogin();
    if (!cookieStr && !token) throw new Error('ログイン情報が取得できなかった');

    // CSRFトークン取得
    const csrfToken = await getCsrfToken(cookieStr);

    // 記事生成
    const articleText = await generateArticle(theme);

    // 投稿
    const noteUrl = await postNote(theme, articleText, cookieStr, csrfToken);
    console.log('投稿URL:', noteUrl);

    await sendLine(`✅ note自動投稿完了！\n━━━━━━━━━━\n📝 ${theme.title}\n\n🔗 ${noteUrl}\n\n📣 Xでシェアしてください！\n━━━━━━━━━━`);
    await broadcastToFollowers(theme, noteUrl);
    console.log('=== 完了 ===');
    process.exit(0);
  } catch(e) {
    console.error('エラー:', e.message);
    await sendLine(`❌ note自動投稿エラー\n${e.message}`).catch(() => {});
    process.exit(1);
  }
}

main();
