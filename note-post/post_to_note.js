/**
 * HORIZON SHIELD note自動投稿 v10
 * Puppeteerによるブラウザ操作で公開（v4方式に戻す）
 */

const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
puppeteerExtra.use(StealthPlugin());

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
  const d = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  return THEMES[d % THEMES.length];
}

async function generateArticle(theme) {
  console.log('記事生成中:', theme.title);
  let response;
  for (let i = 0; i < 5; i++) {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', max_tokens: 2000,
        messages: [{ role: 'user', content: `あなたはHORIZON SHIELDのAIライターです。建設費診断の専門家として、施主目線で以下のテーマについて記事を書いてください。

テーマ：${theme.title}
キーワード：${theme.keywords.join('、')}
切り口：${theme.angle}

条件：
- 1200〜1500文字
- 実際の建設現場での経験を交えた具体的な内容
- 施主が今すぐ使える実践的なアドバイス
- 段落ごとに改行して読みやすく
- 記号「*」「**」「#」「##」「_」は使わない
- 最後にHORIZON SHIELDへの誘導文を1文

本文のみ出力してください。タイトルは不要です。` }],
      }),
    });
    if (response.status === 529 || response.status === 503) {
      await new Promise(r => setTimeout(r, 10000 * (i + 1)));
      continue;
    }
    break;
  }
  const data = await response.json();
  if (data.error) throw new Error(`Claude API失敗: ${data.error.message}`);
  const text = (data.content?.[0]?.text || '').replace(/\n{3,}/g, '\n\n').replace(/\*\*/g, '').replace(/\*/g, '');
  console.log('記事生成完了 文字数:', text.length);
  return text;
}

async function clickButtonByText(page, text) {
  const buttons = await page.$$('button');
  for (const btn of buttons) {
    const btnText = await btn.evaluate(el => el.textContent);
    if (btnText.includes(text)) { await btn.click(); return true; }
  }
  return false;
}

async function postToNote(theme, articleText) {
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
    // note.comに移動してからクッキーをセット
    await page.goto('https://note.com', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // NOTE_SESSIONはフルCookie文字列: "name1=val1; name2=val2; ..."
    const cookieStr = process.env.NOTE_SESSION;
    const cookies = cookieStr.split(';').map(c => c.trim()).filter(Boolean).map(c => {
      const eqIdx = c.indexOf('=');
      return { name: c.slice(0, eqIdx).trim(), value: c.slice(eqIdx + 1).trim() };
    }).filter(c => !c.name.startsWith('_ga') && !c.name.startsWith('_gi')); // GA系除外
    for (const c of cookies) {
      await page.setCookie({ name: c.name, value: c.value, domain: 'note.com', path: '/', httpOnly: true, secure: true });
    }
    console.log('クッキーセット完了:', cookies.map(c => c.name).join(', '));

    // エディタへ
    await page.goto('https://note.com/notes/new', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));
    console.log('エディタURL:', page.url());
    if (page.url().includes('/login')) throw new Error('クッキー認証失敗: ログインページにリダイレクト');

    const editableCount = await page.evaluate(() => document.querySelectorAll('[contenteditable]').length);
    console.log('contenteditable数:', editableCount);
    if (editableCount === 0) throw new Error('エディタが開けていない');

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
      if (i < paragraphs.length - 1) {
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
      }
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
  }
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
  const text = `【今日の建設情報】\n\n${theme.title}\n\n続きを読む\n${noteUrl}\n\n━━━━━━━━━━\nコミュニティ参加受付中！\nhttps://line.me/ti/g2/7JH1RLFfppFpf4hvhrDZP51B6embu5UHN31WJQ\n\n見積書の無料AI診断\nhttps://shield.the-horizons-innovation.com`;
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
  console.log('=== HORIZON SHIELD note自動投稿 v10 開始 ===');
  try {
    const required = ['NOTE_EMAIL', 'NOTE_PASSWORD', 'ANTHROPIC_API_KEY', 'LINE_CHANNEL_TOKEN', 'LINE_USER_ID'];
    for (const key of required) {
      if (!process.env[key]) throw new Error(`環境変数未設定: ${key}`);
    }
    const theme = getTodayTheme();
    console.log('今日のテーマ:', theme.title);
    const articleText = await generateArticle(theme);
    const noteUrl = await postToNote(theme, articleText);
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
