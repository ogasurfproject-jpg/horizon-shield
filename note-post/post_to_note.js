/**
 * HORIZON SHIELD note自動投稿 v2
 * puppeteer廃止 → note内部APIを直接使用
 */

const NOTE_EMAIL    = process.env.NOTE_EMAIL;
const NOTE_PASSWORD = process.env.NOTE_PASSWORD;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const LINE_TOKEN    = process.env.LINE_CHANNEL_TOKEN;
const LINE_USER_ID  = process.env.LINE_USER_ID;

const THEMES = [
  {
    title: 'リフォーム業者が絶対に教えない「見積書の5つの罠」',
    keywords: ['一式見積もり', '諸経費', '図面なし', '数量不明', '口頭約束'],
    angle: '施主が知らない業者の常套手段を暴露する内容',
  },
  {
    title: '「追加工事が必要です」と言われたら疑え。建設30年のプロが語る真実',
    keywords: ['追加工事', '契約外', '口頭指示', '変更工事査定', '証拠'],
    angle: '追加請求の正当性を見極める方法',
  },
  {
    title: '外壁塗装300万円は高いのか？適正価格の見分け方を徹底解説',
    keywords: ['外壁塗装', '足場代', '塗料原価', '坪単価', '相見積もり'],
    angle: '具体的な数字で適正価格を解説する内容',
  },
  {
    title: '工務店選びで失敗しない7つのチェックポイント',
    keywords: ['建設業許可', '施工実績', '保証内容', '契約書', '口コミ'],
    angle: '施主が業者を選ぶ際の具体的な判断基準',
  },
  {
    title: '引き渡し前に必ず確認すべき施工不良チェックリスト20項目',
    keywords: ['施工不良', '完成検査', 'クロス', '床鳴り', '防水'],
    angle: '素人でもできる施工不良の見つけ方',
  },
  {
    title: '店舗開業の内装工事、適正価格はいくら？坪単価の相場を業種別に解説',
    keywords: ['坪単価', '飲食店', 'サロン', 'クリニック', '内装工事'],
    angle: '業種別の適正な内装工事費用の目安',
  },
  {
    title: '見積書を「高い」と感じたら最初にやるべきこと3つ',
    keywords: ['見積書確認', '内訳', '単価', '数量', '専門家相談'],
    angle: '見積書に違和感を感じた時の具体的な行動手順',
  },
];

function getTodayTheme() {
  const dayOfYear = Math.floor(
    (new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000
  );
  return THEMES[dayOfYear % THEMES.length];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function textToTiptapJson(text) {
  const paragraphs = text.split('\n\n').map(p => p.trim()).filter(Boolean);
  const content = paragraphs.map(p => ({
    type: 'paragraph',
    content: [{ type: 'text', text: p.replace(/\n/g, ' ') }],
  }));
  return { type: 'doc', content };
}

async function getNoteSession() {
  console.log('noteログイン中...');
  const res = await fetch('https://note.com/api/v1/sessions/sign_in', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Referer': 'https://note.com/login',
      'Origin': 'https://note.com',
    },
    body: JSON.stringify({ login: NOTE_EMAIL, password: NOTE_PASSWORD }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`noteログイン失敗 [${res.status}]: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const cookies = res.headers.get('set-cookie') || '';
  console.log('noteログイン成功');
  return {
    token: data.data?.token || data.token || '',
    cookies,
  };
}

async function generateArticle(theme) {
  console.log(`記事生成中: ${theme.title}`);
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
・業者批判でなく「情報格差の解消」という立場
・1000〜1200文字
・段落は空行で区切る
・末尾に必ずこの文を入れる：
「見積書の適正価格が気になる方は、HORIZON SHIELDの無料AI診断をお試しください。建設30年の専門知識を学習したAIが、あなたの見積書を即座に分析します。
https://shield.the-horizons-innovation.com」

本文のみ出力（タイトル不要）。`,
      }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API失敗 [${res.status}]`);
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  console.log('記事生成完了 文字数:', text.length);
  return text;
}

async function postToNote(session, title, text) {
  console.log('note投稿中...');
  const body = textToTiptapJson(text);

  const res = await fetch('https://note.com/api/v1/text_notes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Referer': 'https://note.com/notes/new',
      'Origin': 'https://note.com',
      'Cookie': session.cookies,
      'X-Note-Token': session.token,
    },
    body: JSON.stringify({
      name: title,
      body: body,
      status: 'public',
      hashtag_list: ['リフォーム', '建設費診断', 'HORIZONSHIELD', '見積書', '施主'],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`投稿失敗 [${res.status}]: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const noteKey = data.data?.key || data.key;
  console.log('投稿完了 key:', noteKey);

  await sleep(5000);

  const noteUrl = `https://note.com/horizon_shield/n/${noteKey}`;
  console.log('URL:', noteUrl);
  return noteUrl;
}

async function sendLine(message) {
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LINE_TOKEN}`,
    },
    body: JSON.stringify({
      to: LINE_USER_ID,
      messages: [{ type: 'text', text: message.slice(0, 5000) }],
    }),
  });
}

async function main() {
  console.log('=== HORIZON SHIELD note自動投稿 v2 開始 ===');
  try {
    const required = ['NOTE_EMAIL', 'NOTE_PASSWORD', 'ANTHROPIC_API_KEY', 'LINE_CHANNEL_TOKEN', 'LINE_USER_ID'];
    for (const key of required) {
      if (!process.env[key]) throw new Error(`環境変数未設定: ${key}`);
    }

    const theme   = getTodayTheme();
    console.log('今日のテーマ:', theme.title);

    const session = await getNoteSession();
    const text    = await generateArticle(theme);
    const noteUrl = await postToNote(session, theme.title, text);

    await sendLine(
      `✅ note自動投稿完了！\n` +
      `━━━━━━━━━━\n` +
      `📝 ${theme.title}\n\n` +
      `🔗 ${noteUrl}\n\n` +
      `📣 Xでシェアしてください！\n` +
      `━━━━━━━━━━`
    );

    console.log('=== 完了 ===');
  } catch (e) {
    console.error('エラー:', e.message);
    await sendLine(`❌ note自動投稿エラー\n${e.message}`).catch(() => {});
    process.exit(1);
  }
}

main();
