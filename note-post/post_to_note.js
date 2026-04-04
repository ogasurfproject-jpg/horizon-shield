/**
 * HORIZON SHIELD note自動投稿 v3
 * puppeteer-extra + stealth（Grok推奨セレクタ適用済み）
 */

const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteerExtra.use(StealthPlugin());

const NOTE_EMAIL    = process.env.NOTE_EMAIL;
const NOTE_PASSWORD = process.env.NOTE_PASSWORD;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const LINE_TOKEN    = process.env.LINE_CHANNEL_TOKEN;
const LINE_USER_ID  = process.env.LINE_USER_ID;

const THEMES = [
  { title: 'リフォーム業者が絶対に教えない「見積書の5つの罠」', keywords: ['一式見積もり', '諸経費', '図面なし', '数量不明', '口頭約束'], angle: '施主が知らない業者の常套手段を暴露する内容' },
  { title: '「追加工事が必要です」と言われたら疑え。建設30年のプロが語る真実', keywords: ['追加工事', '契約外', '口頭指示', '変更工事査定', '証拠'], angle: '追加請求の正当性を見極める方法' },
  { title: '外壁塗装300万円は高いのか？適正価格の見分け方を徹底解説', keywords: ['外壁塗装', '足場代', '塗料原価', '坪単価', '相見積もり'], angle: '具体的な数字で適正価格を解説する内容' },
  { title: '工務店選びで失敗しない7つのチェックポイント', keywords: ['建設業許可', '施工実績', '保証内容', '契約書', '口コミ'], angle: '施主が業者を選ぶ際の具体的な判断基準' },
  { title: '引き渡し前に必ず確認すべき施工不良チェックリスト20項目', keywords: ['施工不良', '完成検査', 'クロス', '床鳴り', '防水'], angle: '素人でもできる施工不良の見つけ方' },
  { title: '店舗開業の内装工事、適正価格はいくら？坪単価の相場を業種別に解説', keywords: ['坪単価', '飲食店', 'サロン', 'クリニック', '内装工事'], angle: '業種別の適正な内装工事費用の目安' },
  { title: '見積書を「高い」と感じたら最初にやるべきこと3つ', keywords: ['見積書確認', '内訳', '単価', '数量', '専門家相談'], angle: '見積書に違和感を感じた時の具体的な行動手順' },
];

function getTodayTheme() {
  const d = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  return THEMES[d % THEMES.length];
}

async function generateArticle(theme) {
  console.log('記事生成中:', theme.title);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', max_tokens: 1500,
      messages: [{ role: 'user', content: `あなたは建設歴30年のプロ「大賀俊勝」として、施主側に立ったnote記事を書いてください。\n\n【記事タイトル】${theme.title}\n【含めるキーワード】${theme.keywords.join('、')}\n【方向性】${theme.angle}\n\n【ルール】\n・一人称は「私」\n・建設30年のプロとしての権威を自然に出す\n・施主への共感から始める\n・具体的な数字・事例を入れる\n・業者批判でなく「情報格差の解消」という立場\n・1000〜1200文字\n・段落は空行で区切る\n・末尾に必ずこの文を入れる：\n「見積書の適正価格が気になる方は、HORIZON SHIELDの無料AI診断をお試しください。建設30年の専門知識を学習したAIが、あなたの見積書を即座に分析します。\nhttps://shield.the-horizons-innovation.com」\n\n本文のみ出力（タイトル不要）。` }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API失敗 [${res.status}]`);
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  console.log('記事生成完了 文字数:', text.length);
  return text;
}

async function sendLine(message) {
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ to: LINE_USER_ID, messages: [{ type: 'text', text: message.slice(0, 5000) }] }),
  });
}

async function postToNote(theme, articleText) {
  console.log('ブラウザ起動中...');
  const browser = await puppeteerExtra.launch({
    executablePath: '/usr/bin/google-chrome-stable',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', '--disable-features=site-per-process'],
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36');

  try {
    await page.goto('https://note.com/login', { waitUntil: 'networkidle2', timeout: 30000 });

    await page.waitForSelector('input[autocomplete="username"]', { timeout: 15000 });
    await page.type('input[autocomplete="username"]', NOTE_EMAIL, { delay: 60 });
    console.log('メール入力完了');

    await page.waitForSelector('input[autocomplete="current-password"]', { timeout: 15000 });
    await page.type('input[autocomplete="current-password"]', NOTE_PASSWORD, { delay: 60 });
    console.log('パスワード入力完了');

    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 8000));
    console.log('ログイン後URL:', page.url());
    if (page.url().includes('/login')) throw new Error('ログイン失敗');

    await page.goto('https://editor.note.com/notes/new', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));
    console.log('エディタURL:', page.url());

    const editableCount = await page.evaluate(() => document.querySelectorAll('[contenteditable]').length);
    console.log('contenteditable数:', editableCount);
    if (editableCount === 0) throw new Error('エディタが開けていない');

    const editables = await page.$$('[contenteditable]');
    await editables[0].click();
    await page.keyboard.type(theme.title, { delay: 20 });
    console.log('タイトル入力完了');

    if (editables.length > 1) { await editables[1].click(); } else { await page.keyboard.press('Tab'); }
    await new Promise(r => setTimeout(r, 500));

    const paragraphs = articleText.split('\n\n').filter(p => p.trim());
    for (let i = 0; i < paragraphs.length; i++) {
      await page.keyboard.type(paragraphs[i].trim(), { delay: 0 });
      if (i < paragraphs.length - 1) { await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); }
    }
    console.log('本文入力完了');
    await new Promise(r => setTimeout(r, 3000));

    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('公開')); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 2000));
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('投稿')); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 3000));

    const finalUrl = page.url();
    console.log('投稿完了 URL:', finalUrl);
    return finalUrl.includes('note.com') ? finalUrl : 'https://note.com/horizon_shield';
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log('=== HORIZON SHIELD note自動投稿 v3 開始 ===');
  try {
    const required = ['NOTE_EMAIL', 'NOTE_PASSWORD', 'ANTHROPIC_API_KEY', 'LINE_CHANNEL_TOKEN', 'LINE_USER_ID'];
    for (const key of required) { if (!process.env[key]) throw new Error(`環境変数未設定: ${key}`); }
    const theme = getTodayTheme();
    console.log('今日のテーマ:', theme.title);
    const text = await generateArticle(theme);
    const url  = await postToNote(theme, text);
    await sendLine(`✅ note自動投稿完了！\n━━━━━━━━━━\n📝 ${theme.title}\n\n🔗 ${url}\n\n📣 Xでシェアしてください！\n━━━━━━━━━━`);
    console.log('=== 完了 ===');
  } catch (e) {
    console.error('エラー:', e.message);
    await sendLine(`❌ note自動投稿エラー\n${e.message}`).catch(() => {});
    process.exit(1);
  }
}

main();
