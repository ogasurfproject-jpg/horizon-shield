/**
* HORIZON SHIELD Yahoo!リアルタイム検索監視
* GitHub Actionsで30分ごとに実行
*/

const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const KEYWORDS = [
  'リフォーム 見積もり 高い',
  '追加工事 おかしい',
  '工務店 最悪',
  'タックダイン',
  '床下 詐欺',
  '外壁塗装 高い',
  'リノベーション トラブル',
  '建設業者 騙された',
];

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const LINE_CHANNEL_TOKEN = process.env.LINE_CHANNEL_TOKEN;
const LINE_USER_ID = process.env.LINE_USER_ID;
const SCORE_THRESHOLD = 75;

// ========================================
// スコアリング
// ========================================
async function scorePost(text) {
  const prompt = `あなたはHORIZON SHIELD（建設費診断サービス¥55,000〜）の見込み客判定AIです。運営は30年現場を見てきた元大工・大賀俊勝。

投稿: ${text.slice(0, 400)}

以下のJSONのみ返答（前置き・コードブロック不要）:
{
  "score": 0〜100の整数,
  "pattern": "A/B/C/D/除外のいずれか",
  "reason": "15文字以内の判定理由",
  "is_vendor": true/false,
  "urgency": "高/中/低",
  "souba_hint": "工事種別が判別できれば一般的な相場レンジ（例: 外壁塗装30坪なら80〜150万が中央値帯）。㎡数や仕様が不明なら断定数字を出さずレンジ表現に留める。判別不能なら空文字",
  "reply_empathy": "共感型リプライ。まず不安に寄り添い『その違和感は当たってることが多い』と伝え、最後にLINE誘導。120文字以内",
  "reply_data": "相場感型リプライ。souba_hintのレンジを自然に提示して安心させ、専門家の信頼を出す。最後にLINE誘導。120文字以内",
  "reply_diagnosis": "即診断型リプライ。『見積書1枚あれば過剰箇所を指摘できます』と軽く行動を促す。押しは弱く。最後にLINE誘導。120文字以内"
}

全リプライ共通ルール:
- 押し売り禁止。断定・煽り禁止（「ぼったくり確定」と言い切らない）
- 特定業者の名指し批判をしない。業者を一律に敵視しない
- 営業臭を消す。元大工の先輩が後輩に教える温度
- CTAは「LINEで見積書を無料診断 → @172piime」に統一
- 末尾に必ず「※AI支援＋人間が確認しています」を入れる

パターンA: 今まさに困っている（80〜100点）
パターンB: 被害後に怒っている（75〜90点）
パターンC: 家族・知人の代理（70〜85点）
パターンD: これから検討中（60〜75点）
業者の宣伝・無関係: 0点`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    const raw = data.content?.[0]?.text || '{}';
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (e) {
    console.error('スコアリングエラー:', e.message);
    return { score: 0, pattern: '除外', reason: 'error', is_vendor: false, urgency: '低', souba_hint: '', reply_empathy: '', reply_data: '', reply_diagnosis: '' };
  }
}

// ========================================
// LINE通知
// ========================================
async function sendLine(message) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LINE_CHANNEL_TOKEN}`,
    },
    body: JSON.stringify({
      to: LINE_USER_ID,
      messages: [{ type: 'text', text: message.slice(0, 5000) }],
    }),
  });
  return res.ok;
}

// ========================================
// Yahoo!リアルタイム検索スクレイピング
// ========================================
async function scrapeYahooRealtime(browser, keyword) {
  const results = [];
  const page = await browser.newPage();

  try {
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15');
    await page.setViewport({ width: 390, height: 844 });

    const url = `https://search.yahoo.co.jp/realtime?p=${encodeURIComponent(keyword)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Yahoo!リアルタイムのJSレンダリング完了を待つ
    try {
      await page.waitForFunction(
        () => document.querySelector('article[class*="PopularTweetItem"]') !== null,
        { timeout: 15000 }
      );
      console.log(`"${keyword}" 投稿要素を検出`);
    } catch (e) {
      console.log(`"${keyword}" 投稿要素タイムアウト - 10秒待機`);
      await new Promise(r => setTimeout(r, 10000));
    }

    // 投稿テキストを取得
    const posts = await page.evaluate(() => {
      const items = [];

      // Yahoo!リアルタイム検索の投稿セレクター（2026-05 DOM再解析済み）
      // 投稿1件 = <article class="PopularTweetItem_TrendTweet__xxxx">
      const selectors = [
        'article[class*="PopularTweetItem"]',
        '[class*="PopularTweet_list"] article',
        '[class*="PopularTweetItem"]',
      ];

      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length >= 1) {
          elements.forEach(el => {
            const text = (el.innerText || el.textContent || '').trim();
            const linkEl = el.querySelector('a[href*="twitter.com"], a[href*="x.com"]');
            const link = linkEl?.href || '';
            if (text.length > 15 && text.length < 500) {
              items.push({ text: text.slice(0, 300), link, selector });
            }
          });
          if (items.length >= 1) break;
        }
      }

      return items.slice(0, 10);
    });

    console.log(`"${keyword}" → ${posts.length}件取得 (selector: ${posts[0]?.selector || 'none'})`);

    console.log(`"${keyword}" → ${posts.length}件取得`);
    results.push(...posts.map(p => ({ ...p, keyword })));

  } catch (e) {
    console.error(`"${keyword}" エラー:`, e.message);
  } finally {
    await page.close();
  }

  return results;
}

// ========================================
// メイン処理
// ========================================
async function main() {
  console.log('Yahoo!リアルタイム監視開始');

  // Chromiumのパスを取得
  let executablePath;
  try {
    executablePath = execSync('which chromium-browser || which chromium || which google-chrome').toString().trim();
  } catch {
    executablePath = '/Users/oogatoshikatsu/.cache/puppeteer/chrome/mac_arm-121.0.6167.85/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
  }

  const browser = await puppeteer.launch({
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
    headless: true,
  });

  try {
    let totalNotified = 0;
    const watchList = [];

    for (const keyword of KEYWORDS) {
      const posts = await scrapeYahooRealtime(browser, keyword);

      for (const post of posts) {
        if (!post.text || post.text.length < 15) continue;

        const result = await scorePost(post.text);
        console.log(`[${result.pattern}] ${result.score}点: ${post.text.slice(0, 30)}...`);

        if (result.score >= SCORE_THRESHOLD && !result.is_vendor) {
          const urgencyMark = result.score >= 90 ? '🔥緊急' : '🎯発見';
          const msg =
            `${urgencyMark}【${result.score}点/パターン${result.pattern}】[YahooRT]\n━━━━━━━━━━\n` +
            `🔍 キーワード: ${keyword}\n` +
            `📋 ${post.text.slice(0, 100)}\n\n` +
            `💡 ${result.reason}\n⏰ 緊急度: ${result.urgency}\n` +
            (result.souba_hint ? `📊 相場感: ${result.souba_hint}\n` : '') +
            `\n──返信ドラフト（1つ選んでコピペ）──\n` +
            `【A:共感】\n${result.reply_empathy || ''}\n\n` +
            `【B:相場】\n${result.reply_data || ''}\n\n` +
            `【C:即診断】\n${result.reply_diagnosis || ''}\n` +
            (post.link ? `\n🔗 元投稿:\n${post.link}\n` : '') +
            `━━━━━━━━━━\n` +
            `⚠️ 1日のリプライは20件まで。同文連投NG。LINE誘導優先`;

          await sendLine(msg);
          totalNotified++;
          console.log(`LINE通知送信: ${result.score}点`);

        } else if (result.score >= 55 && !result.is_vendor) {
          watchList.push({ post, result, keyword });
        }
      }

      // サーバー負荷軽減
      await new Promise(r => setTimeout(r, 2000));
    }

    // ウォッチリストをまとめて通知
    if (watchList.length > 0) {
      let batchMsg = `👀 Yahooリアルタイム ウォッチリスト（${watchList.length}件）\n━━━━━━━━━━\n`;
      for (const { post, result, keyword } of watchList.slice(0, 5)) {
        batchMsg += `[${result.score}点] ${keyword}\n${post.text.slice(0, 50)}\n\n`;
      }
      batchMsg += `━━━━━━━━━━`;
      await sendLine(batchMsg);
    }

    console.log(`完了: 通知${totalNotified}件 ウォッチ${watchList.length}件`);

  } finally {
    await browser.close();
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
