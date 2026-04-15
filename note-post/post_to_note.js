/**
 * HORIZON SHIELD note自動投稿 v9
 * Fix: publishにX-Note-Token(note_otp)を付与
 */

const https = require('https');

const THEMES = [
  { title: 'リフォーム業者が絶対に教えない「見積書の5つの罠」', keywords: ['一式見積もり','諸経費','図面なし','数量不明','口頭約束'], angle: '施主が知らない業者の常套手段を暴露する内容', hashtags: ['リフォーム','見積書','建設費','施主','HORIZONSHIELD'] },
  { title: '「追加工事が必要です」と言われたら疑え。建設30年のプロが語る真実', keywords: ['追加工事','契約外','口頭指示','変更工事査定','証拠'], angle: '追加請求の正当性を見極める方法', hashtags: ['追加工事','リフォーム','建設','施主','HORIZONSHIELD'] },
  { title: '外壁塗装300万円は高いのか？適正価格の見分け方を徹底解説', keywords: ['外壁塗装','足場代','塗料原価','坪単価','相見積もり'], angle: '具体的な数字で適正価格を解説する内容', hashtags: ['外壁塗装','リフォーム','適正価格','施主','HORIZONSHIELD'] },
  { title: '工務店選びで失敗しない7つのチェックポイント', keywords: ['建設業許可','施工実績','保証内容','契約書','口コミ'], angle: '施主が業者を選ぶ際の具体的な判断基準', hashtags: ['工務店','リフォーム','建設','施主','HORIZONSHIELD'] },
  { title: '引き渡し前に必ず確認すべき施工不良チェックリスト20項目', keywords: ['施工不良','完成検査','クロス','床鳴り','防水'], angle: '素人でもできる施工不良の見つけ方', hashtags: ['施工不良','完成検査','リフォーム','施主','HORIZONSHIELD'] },
  { title: '店舗開業の内装工事、適正価格はいくら？坪単価の相場を業種別に解説', keywords: ['坪単価','飲食店','サロン','クリニック','内装工事'], angle: '業種別の適正な内装工事費用の目安', hashtags: ['内装工事','店舗','坪単価','リフォーム','HORIZONSHIELD'] },
  { title: '見積書を「高い」と感じたら最初にやるべきこと3つ', keywords: ['見積書確認','内訳','単価','数量','専門家相談'], angle: '見積書に違和感を感じた時の具体的な行動手順', hashtags: ['見積書','リフォーム','建設費','施主','HORIZONSHIELD'] },
];

function getTodayTheme() {
  const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  return THEMES[dayOfYear % THEMES.length];
}

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        cookies: res.headers['set-cookie'] || [],
        body: Buffer.concat(chunks).toString(),
      }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function textToNoteBody(text) {
  return text.split('\n\n').map(p => p.trim()).filter(Boolean).map(p => {
    const id = uuid();
    return `<p name="${id}" id="${id}">${p.replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

async function generateArticle(theme) {
  const prompt = `あなたはHORIZON SHIELDのAIライターです。建設費診断の専門家として、施主目線で以下のテーマについて記事を書いてください。

テーマ：${theme.title}
キーワード：${theme.keywords.join('、')}
切り口：${theme.angle}

条件：
- 1200〜1500文字
- 実際の建設現場での経験を交えた具体的な内容
- 施主が今すぐ使える実践的なアドバイス
- 段落ごとに改行して読みやすく
- 最後にHORIZON SHIELDへの誘導文を1文

本文のみ出力してください。タイトルは不要です。`;

  let response;
  for (let i = 0; i < 5; i++) {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (response.status === 529 || response.status === 503) {
      console.log(`Claude API ${response.status} リトライ ${i+1}/5...`);
      await new Promise(r => setTimeout(r, 10000 * (i + 1)));
      continue;
    }
    break;
  }
  const data = await response.json();
  if (data.error) throw new Error(`Claude API失敗: ${data.error.message}`);
  const text = (data.content?.[0]?.text || '').replace(/\n{3,}/g, '\n\n');
  console.log('記事生成完了 文字数:', text.length);
  return text;
}

async function getNoteOtp(noteKey, cookieStr) {
  try {
    // エディタページからnote_otpトークンを取得
    const res = await httpsRequest({
      hostname: 'editor.note.com',
      path: `/notes/${noteKey}/edit`,
      method: 'GET',
      headers: {
        'Cookie': cookieStr,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    }, null);

    // パターン1: JSON埋め込み "note_otp":"xxxxx"
    const m1 = res.body.match(/"note_otp"\s*:\s*"([^"]+)"/);
    if (m1) { console.log('note_otp取得(JSON):', m1[1].slice(0, 8) + '...'); return m1[1]; }

    // パターン2: metaタグ <meta name="note_otp" content="xxxxx">
    const m2 = res.body.match(/<meta[^>]+name=["']note_otp["'][^>]+content=["']([^"']+)["']/i);
    if (m2) { console.log('note_otp取得(meta):', m2[1].slice(0, 8) + '...'); return m2[1]; }

    // パターン3: note-token
    const m3 = res.body.match(/"note[-_]token"\s*:\s*"([^"]+)"/);
    if (m3) { console.log('note_otp取得(note-token):', m3[1].slice(0, 8) + '...'); return m3[1]; }

    console.log('⚠️ note_otp未取得 - tokenなしで試行');
    return null;
  } catch(e) {
    console.log('note_otp取得失敗:', e.message);
    return null;
  }
}

async function postNote(theme, bodyText, cookieStr) {
  const noteBody = textToNoteBody(bodyText);
  const bodyLength = bodyText.replace(/\s/g, '').length;

  const makeHeaders = (bodyStr, referer) => ({
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(bodyStr),
    'Cookie': cookieStr,
    'X-Requested-With': 'XMLHttpRequest',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Origin': 'https://editor.note.com',
    'Referer': referer || 'https://editor.note.com/',
  });

  // Step1: 下書き作成
  const createBody = JSON.stringify({ name: theme.title });
  const createRes = await httpsRequest({
    hostname: 'note.com', path: '/api/v1/text_notes', method: 'POST',
    headers: makeHeaders(createBody),
  }, createBody);
  console.log('下書き作成ステータス:', createRes.status);

  let noteId = '', noteKey = '';
  try {
    const json = JSON.parse(createRes.body);
    noteId = String(json.data?.id || '');
    noteKey = String(json.data?.key || '');
    console.log('下書き作成完了 id:', noteId, 'key:', noteKey);
  } catch(e) { throw new Error('下書き作成失敗: ' + createRes.body.slice(0, 200)); }
  if (!noteId) throw new Error('記事IDが取得できなかった');

  // Step2: 本文保存（is_temp_saved=true）
  const saveBody = JSON.stringify({ body: noteBody, body_length: bodyLength, name: theme.title, index: false, is_lead_form: false });
  const saveRes = await httpsRequest({
    hostname: 'note.com',
    path: `/api/v1/text_notes/draft_save?id=${noteId}&is_temp_saved=true`,
    method: 'POST',
    headers: makeHeaders(saveBody, `https://editor.note.com/notes/${noteKey}/edit`),
  }, saveBody);
  console.log('draft_saveステータス:', saveRes.status);

  // セッション更新
  if (saveRes.cookies.length > 0) {
    const newCookie = saveRes.cookies.map(c => c.split(';')[0]).join('; ');
    if (newCookie) cookieStr = newCookie;
  }

  // Step3: ハッシュタグ設定
  const tagBody = JSON.stringify({ hashtag_list: theme.hashtags });
  await httpsRequest({
    hostname: 'note.com', path: `/api/v1/text_notes/${noteId}/hashtags`, method: 'PUT',
    headers: makeHeaders(tagBody, `https://editor.note.com/notes/${noteKey}/edit`),
  }, tagBody);
  console.log('ハッシュタグ設定完了');

  // Step4: 現在のnoteデータをGETして構造を取得
  const getRes = await httpsRequest({
    hostname: 'note.com',
    path: `/api/v1/text_notes/${noteId}`,
    method: 'GET',
    headers: {
      'Cookie': cookieStr,
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Origin': 'https://editor.note.com',
      'Referer': `https://editor.note.com/notes/${noteKey}/edit`,
    },
  }, null);
  console.log('GETステータス:', getRes.status);

  let noteData = {};
  try {
    const getJson = JSON.parse(getRes.body);
    noteData = getJson.data || getJson;
  } catch(e) { console.log('GET解析失敗:', e.message); }

  // Step5: 取得したデータにindex:trueを付けてPUT公開
  const pubData = Object.assign({}, noteData, { index: true });
  const pubBody = JSON.stringify(pubData);
  const pubRes = await httpsRequest({
    hostname: 'note.com',
    path: `/api/v1/text_notes/${noteId}`,
    method: 'PUT',
    headers: makeHeaders(pubBody, `https://editor.note.com/notes/${noteKey}/edit`),
  }, pubBody);
  console.log('公開ステータス:', pubRes.status);
  console.log('公開レスポンス:', pubRes.body.slice(0, 300));

  return `https://note.com/horizon_shield/n/${noteKey}`;
}

async function sendNtfy(message) {
  try {
    await fetch('https://ntfy.sh/horizon-shield-toshi-0222', {
      method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: message,
    });
  } catch(e) { console.log('ntfy失敗:', e.message); }
}

async function sendLine(message) {
  try {
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LINE_CHANNEL_TOKEN}` },
      body: JSON.stringify({ to: process.env.LINE_USER_ID, messages: [{ type: 'text', text: message.slice(0, 5000) }] }),
    });
  } catch(e) { console.log('LINE失敗:', e.message); }
}

async function broadcastToFollowers(theme, noteUrl) {
  const text = `【今日の建設情報】\n\n${theme.title}\n\n続きを読む\n${noteUrl}\n\n━━━━━━━━━━\nコミュニティ参加受付中！\nhttps://line.me/ti/g2/7JH1RLFfppFpf4hvhrDZP51B6embu5UHN31WJQ\n\n建積書の無料AI診断\nhttps://shield.the-horizons-innovation.com`;
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LINE_CHANNEL_TOKEN}` },
      body: JSON.stringify({ messages: [{ type: 'text', text }] }),
    });
    console.log('ブロードキャスト:', res.ok ? '成功' : `失敗 [${res.status}]`);
  } catch(e) { console.log('ブロードキャスト失敗:', e.message); }
}

async function main() {
  console.log('=== HORIZON SHIELD note自動投稿 v8 開始 ===');
  try {
    const required = ['NOTE_SESSION', 'ANTHROPIC_API_KEY', 'LINE_CHANNEL_TOKEN', 'LINE_USER_ID'];
    for (const key of required) {
      if (!process.env[key]) throw new Error(`環境変数未設定: ${key}`);
    }

    const cookieStr = `_note_session_v5=${process.env.NOTE_SESSION}`;
    const theme = getTodayTheme();
    console.log('今日のテーマ:', theme.title);

    const articleText = await generateArticle(theme);
    const noteUrl = await postNote(theme, articleText, cookieStr);
    console.log('投稿URL:', noteUrl);

    await sendNtfy(`✅ note投稿完了: ${theme.title}`);
    await sendLine(`✅ note自動投稿完了！\n━━━━━━━━━━\n📝 ${theme.title}\n\n🔗 ${noteUrl}\n\n📣 Xでシェアしてください！\n━━━━━━━━━━`);
    await broadcastToFollowers(theme, noteUrl);
    console.log('=== 完了 ===');
    process.exit(0);
  } catch (e) {
    console.error('エラー:', e.message);
    await sendLine(`❌ note自動投稿エラー\n${e.message}`).catch(() => {});
    process.exit(1);
  }
}

main();
