/**
 * HORIZON SHIELD note自動投稿 v4
 * 見出し画像 + ハッシュタグ + 自動投稿
 */

const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const https = require('https');
const http = require('http');
const fs = require('fs');
puppeteerExtra.use(StealthPlugin());

const NOTE_EMAIL    = process.env.NOTE_EMAIL;
const NOTE_PASSWORD = process.env.NOTE_PASSWORD;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const LINE_TOKEN    = process.env.LINE_CHANNEL_TOKEN;
const LINE_USER_ID  = process.env.LINE_USER_ID;

const THEMES = [
  { title: 'リフォーム業者が絶対に教えない「見積書の5つの罠」', keywords: ['一式見積もり', '諸経費', '図面なし', '数量不明', '口頭約束'], angle: '施主が知らない業者の常套手段を暴露する内容', hashtags: ['リフォーム', '見積書', '建設', '施主', 'HORIZONSHIELD'], imageQuery: 'construction blueprint' },
  { title: '「追加工事が必要です」と言われたら疑え。建設30年のプロが語る真実', keywords: ['追加工事', '契約外', '口頭指示', '変更工事査定', '証拠'], angle: '追加請求の正当性を見極める方法', hashtags: ['追加工事', '建設トラブル', '施工', '見積もり', 'HORIZONSHIELD'], imageQuery: 'construction worker site' },
  { title: '外壁塗装300万円は高いのか？適正価格の見分け方を徹底解説', keywords: ['外壁塗装', '足場代', '塗料原価', '坪単価', '相見積もり'], angle: '具体的な数字で適正価格を解説する内容', hashtags: ['外壁塗装', 'リフォーム', '塗装工事', '相見積もり', 'HORIZONSHIELD'], imageQuery: 'house exterior painting' },
  { title: '工務店選びで失敗しない7つのチェックポイント', keywords: ['建設業許可', '施工実績', '保証内容', '契約書', '口コミ'], angle: '施主が業者を選ぶ際の具体的な判断基準', hashtags: ['工務店', '建設業者', 'リフォーム', '業者選び', 'HORIZONSHIELD'], imageQuery: 'architect consultation' },
  { title: '引き渡し前に必ず確認すべき施工不良チェックリスト20項目', keywords: ['施工不良', '完成検査', 'クロス', '床鳴り', '防水'], angle: '素人でもできる施工不良の見つけ方', hashtags: ['施工不良', '建設検査', '新築', 'リフォーム', 'HORIZONSHIELD'], imageQuery: 'house inspection quality' },
  { title: '店舗開業の内装工事、適正価格はいくら？坪単価の相場を業種別に解説', keywords: ['坪単価', '飲食店', 'サロン', 'クリニック', '内装工事'], angle: '業種別の適正な内装工事費用の目安', hashtags: ['店舗内装', '内装工事', '開業', '坪単価', 'HORIZONSHIELD'], imageQuery: 'interior design shop' },
  { title: '見積書を「高い」と感じたら最初にやるべきこと3つ', keywords: ['見積書確認', '内訳', '単価', '数量', '専門家相談'], angle: '見積書に違和感を感じた時の具体的な行動手順', hashtags: ['見積書', 'リフォーム', '建設費用', '施主', 'HORIZONSHIELD'], imageQuery: 'document contract business' },
];

function getTodayTheme() {
  const d = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  return THEMES[d % THEMES.length];
}

function apiLogin() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ login: NOTE_EMAIL, password: NOTE_PASSWORD });
    const req = https.request({
      hostname: 'note.com', path: '/api/v1/sessions/sign_in', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Origin': 'https://note.com', 'Referer': 'https://note.com/login' },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const cookies = [];
        for (let i = 0; i < res.rawHeaders.length; i += 2) {
          if (res.rawHeaders[i].toLowerCase() === 'set-cookie') cookies.push(res.rawHeaders[i+1]);
        }
        resolve({ cookies, json: JSON.parse(data) });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function downloadImage(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    proto.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        downloadImage(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
    }).on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
  });
}

async function fetchImage(query) {
  const imgPath = '/tmp/note_image.jpg';
  // picsum.photos - 確実に動く無料画像サービス（1200x630固定）
  const seed = Buffer.from(query).reduce((a, b) => a + b, 0) % 1000;
  const url = `https://picsum.photos/seed/${seed}/1200/630`;
  try {
    await downloadImage(url, imgPath);
    const stat = fs.statSync(imgPath);
    console.log('画像ダウンロード完了 サイズ:', stat.size, 'bytes');
    if (stat.size < 10000) throw new Error('画像が小さすぎる: ' + stat.size);
    return imgPath;
  } catch (e) {
    console.log('画像ダウンロード失敗:', e.message);
    return null;
  }
}

async function generateArticle(theme) {
  console.log('記事生成中:', theme.title);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', max_tokens: 1500,
      messages: [{ role: 'user', content: `あなたは建設歴30年のプロ「大賀俊勝」として、施主側に立ったnote記事を書いてください。

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
・記号「*」「**」「#」「##」「_」は絶対に使わない。最重要ルール。
・番号付きリストは「1.」「2.」の形式で書く
・末尾に必ずこの文を入れる：
「見積書の適正価格が気になる方は、HORIZON SHIELDの無料AI診断をお試しください。建設30年の専門知識を学習したAIが、あなたの見積書を即座に分析します。
https://shield.the-horizons-innovation.com

また、施主側に立った建設情報を毎日LINEでお届けしています。業者に負けない知識を身につけたい方は、ぜひ公式LINEにご登録ください。
https://line.me/R/ti/p/@462lurtl」

本文のみ出力（タイトル不要）。` }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API失敗 [${res.status}]`);
  const data = await res.json();
  let text = data.content?.[0]?.text || '';
  text = text.replace(/\*\*/g, '').replace(/\*/g, '').replace(/^#{1,6}\s/gm, '').replace(/_([^_]+)_/g, '$1');
  console.log('記事生成完了 文字数:', text.length);
  return text;
}

async function broadcastToFollowers(theme, noteUrl) {
  const text = `【今日の建設情報】\n\n${theme.title}\n\n業者に負けない知識を、毎日お届けします。\n\n▼ 続きを読む\n${noteUrl}\n\n━━━━━━━━━━\n見積書が気になる方は無料AI診断へ👇\nhttps://shield.the-horizons-innovation.com`;
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LINE_TOKEN}` },
      body: JSON.stringify({ messages: [{ type: 'text', text }] }),
    });
    console.log('ブロードキャスト:', res.ok ? '成功' : `失敗 [${res.status}]`);
  } catch (e) {
    console.log('ブロードキャスト失敗:', e.message);
  }
}

async function sendLine(message) {
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ to: LINE_USER_ID, messages: [{ type: 'text', text: message.slice(0, 5000) }] }),
  });
}

async function clickButtonByText(page, text) {
  const buttons = await page.$$('button');
  for (const btn of buttons) {
    const btnText = await btn.evaluate(el => el.textContent);
    if (btnText.includes(text)) { await btn.click(); return true; }
  }
  return false;
}

async function postToNote(theme, articleText, sessionCookies, imagePath) {
  console.log('ブラウザ起動中...');
  const browser = await puppeteerExtra.launch({
    executablePath: '/usr/bin/google-chrome-stable',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', '--window-size=1920,1080'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36');

  try {
    // Cookie注入
    await page.goto('https://note.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
    for (const cookieStr of sessionCookies) {
      const parts = cookieStr.split(';').map(p => p.trim());
      const eqIdx = parts[0].indexOf('=');
      const name  = parts[0].slice(0, eqIdx).trim();
      const value = parts[0].slice(eqIdx + 1).trim();
      await page.setCookie({ name, value, domain: '.note.com', path: '/' });
    }
    await page.reload({ waitUntil: 'networkidle2', timeout: 20000 });
    await new Promise(r => setTimeout(r, 2000));
    console.log('ログイン状態:', page.url());

    // エディタへ直接遷移
    await page.goto('https://note.com/notes/new', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));
    console.log('エディタURL:', page.url());

    const editableCount = await page.evaluate(() => document.querySelectorAll('[contenteditable]').length);
    console.log('contenteditable数:', editableCount);
    if (editableCount === 0) throw new Error('エディタが開けていない: ' + page.url());

    // 見出し画像アップロード
    if (imagePath && fs.existsSync(imagePath)) {
      try {
        // 「設定する」ボタンをクリックしてfile inputを出現させる
        const setBtn = await clickButtonByText(page, '設定する');
        if (setBtn) {
          console.log('設定するボタンクリック');
          await new Promise(r => setTimeout(r, 2000));
        }

        // file inputを待って取得
        await page.waitForSelector('input[type="file"]', { timeout: 5000 });
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
          await fileInput.uploadFile(imagePath);
          await new Promise(r => setTimeout(r, 4000));
          console.log('見出し画像アップロード完了');
        } else {
          console.log('file inputが見つからない、スキップ');
        }
      } catch (e) {
        console.log('画像アップロードスキップ:', e.message);
      }
    }

    // タイトル入力
    const titleEl = await page.$('[placeholder="記事タイトル"]');
    if (titleEl) {
      await titleEl.click();
      await page.keyboard.type(theme.title, { delay: 20 });
      console.log('タイトル入力完了');
    }
    await new Promise(r => setTimeout(r, 500));

    // 本文入力
    const editables = await page.$$('[contenteditable]');
    await editables[editables.length - 1].click();
    await new Promise(r => setTimeout(r, 500));
    const paragraphs = articleText.split('\n\n').filter(p => p.trim());
    for (let i = 0; i < paragraphs.length; i++) {
      await page.keyboard.type(paragraphs[i].trim(), { delay: 0 });
      if (i < paragraphs.length - 1) { await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); }
    }
    console.log('本文入力完了');
    await new Promise(r => setTimeout(r, 3000));

    // 公開に進む
    const pub = await clickButtonByText(page, '公開に進む');
    console.log('公開に進む:', pub ? '成功' : '失敗');
    await new Promise(r => setTimeout(r, 3000));

    // ハッシュタグ入力
    try {
      const hashtagInput = await page.$('input[placeholder*="ハッシュタグ"], input[placeholder*="タグ"]');
      if (hashtagInput) {
        for (const tag of theme.hashtags) {
          await hashtagInput.click();
          await page.keyboard.type(tag, { delay: 20 });
          await page.keyboard.press('Enter');
          await new Promise(r => setTimeout(r, 300));
        }
        console.log('ハッシュタグ入力完了');
      }
    } catch (e) {
      console.log('ハッシュタグスキップ:', e.message);
    }
    await new Promise(r => setTimeout(r, 1000));

    // 投稿する
    const post = await clickButtonByText(page, '投稿する');
    console.log('投稿する:', post ? '成功' : '失敗');
    await new Promise(r => setTimeout(r, 5000));

    const finalUrl = page.url();
    console.log('投稿完了 URL:', finalUrl);
    const noteKey = finalUrl.match(/\/n\/([a-z0-9]+)/)?.[1] || finalUrl.match(/\/notes\/([a-z0-9]+)/)?.[1];
    return noteKey ? `https://note.com/horizon_shield/n/${noteKey}` : 'https://note.com/horizon_shield';

  } finally {
    await browser.close();
    if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
  }
}

async function main() {
  console.log('=== HORIZON SHIELD note自動投稿 v4 開始 ===');
  try {
    const required = ['NOTE_EMAIL', 'NOTE_PASSWORD', 'ANTHROPIC_API_KEY', 'LINE_CHANNEL_TOKEN', 'LINE_USER_ID'];
    for (const key of required) { if (!process.env[key]) throw new Error(`環境変数未設定: ${key}`); }
    const theme = getTodayTheme();
    console.log('今日のテーマ:', theme.title);
    const { cookies } = await apiLogin();
    const [text, imagePath] = await Promise.all([generateArticle(theme), fetchImage(theme.imageQuery)]);
    const url = await postToNote(theme, text, cookies, imagePath);
    await sendLine(`✅ note自動投稿完了！\n━━━━━━━━━━\n📝 ${theme.title}\n\n🔗 ${url}\n\n📣 Xでシェアしてください！\n━━━━━━━━━━`);
    await broadcastToFollowers(theme, url);
    console.log('=== 完了 ===');
  } catch (e) {
    console.error('エラー:', e.message);
    await sendLine(`❌ note自動投稿エラー\n${e.message}`).catch(() => {});
    process.exit(1);
  }
}

main();
