/**
 * HORIZON SHIELD 見込み客監視システム
 * 
 * 機能：GoogleアラートRSS → AI精査 → LINE通知
 * 
 * Cloudflare環境変数（設定必須）:
 *   ANTHROPIC_API_KEY  : 既存のAPIキー
 *   LINE_CHANNEL_TOKEN : LINEチャンネルアクセストークン
 *   LINE_USER_ID       : 通知先LINEユーザーID（下記手順で取得）
 *   ALERT_FEED_URLS    : GoogleアラートRSS URL（カンマ区切り）
 */

// ========================================
// スコアリング基準
// ========================================
const SCORE_THRESHOLD = 70; // この点数以上をLINE通知

// ========================================
// AI精査：見込み客スコアリング
// ========================================
async function scorePost(text, env) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `以下の投稿を分析し、建設費診断サービス（¥55,000）の見込み客スコアを0-100点で判定。

【高スコア条件】
- リフォーム・外壁塗装の見積もりに不満・不安を持つ施主
- 工事費が高いと感じている一般消費者
- 業者に騙された・不信感がある人
- 契約前に第三者に確認したい人

【低スコア条件】
- 業者・職人・建設会社側の投稿
- 単なる愚痴で行動意欲なし
- 既に工事完了済み
- 関係のない内容

投稿：${text.slice(0, 300)}

JSON形式のみ返答：{"score": 数値, "reason": "理由15文字以内", "action": "アプローチ方法20文字以内"}`
      }]
    })
  });

  const data = await response.json();
  const raw = data.content?.[0]?.text || '';
  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    return { score: 0, reason: '解析失敗', action: 'スキップ' };
  }
}

// ========================================
// LINE通知送信
// ========================================
async function sendLine(message, env) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.LINE_CHANNEL_TOKEN}`
    },
    body: JSON.stringify({
      to: env.LINE_USER_ID,
      messages: [{ type: 'text', text: message }]
    })
  });
  return res.ok;
}

// ========================================
// GoogleアラートRSSフィード取得
// ========================================
async function fetchAlertFeeds(env) {
  const feedUrls = (env.ALERT_FEED_URLS || '').split(',').map(u => u.trim()).filter(Boolean);
  const results = [];

  for (const url of feedUrls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const xml = await res.text();

      // エントリー抽出
      const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g) || [];
      for (const entry of entries.slice(0, 10)) {
        const title = (entry.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] || '')
          .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        const content = (entry.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1] || '')
          .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
        const link = entry.match(/href="([^"]+)"/)?.[1] || '';
        const updated = entry.match(/<updated>([\s\S]*?)<\/updated>/)?.[1] || '';

        if (title) {
          results.push({
            text: title + ' ' + content,
            title: title.slice(0, 80),
            link,
            updated
          });
        }
      }
    } catch (e) {
      console.error('RSS fetch error:', url, e.message);
    }
  }

  return results;
}

// ========================================
// メイン処理：スキャン→精査→通知
// ========================================
async function scanAndNotify(env) {
  const posts = await fetchAlertFeeds(env);
  console.log(`取得件数: ${posts.length}`);

  let notified = 0;
  for (const post of posts) {
    const result = await scorePost(post.text, env);
    console.log(`スコア: ${result.score} | ${post.title.slice(0, 30)}`);

    if (result.score >= SCORE_THRESHOLD) {
      const msg =
        `🎯 見込み客発見！【${result.score}点】\n` +
        `━━━━━━━━━━━━\n` +
        `📋 ${post.title}\n\n` +
        `💡 理由: ${result.reason}\n` +
        `🚀 対応: ${result.action}\n\n` +
        `🔗 ${post.link}\n` +
        `━━━━━━━━━━━━\n` +
        `→ Xで検索してアプローチ！`;

      await sendLine(msg, env);
      notified++;
    }

    // API制限対策
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`通知件数: ${notified}`);
  return { scanned: posts.length, notified };
}

// ========================================
// Cloudflare Worker エントリーポイント
// ========================================
export default {
  // 手動実行・テスト用
  async fetch(request, env) {
    const url = new URL(request.url);

    // LINEテスト通知
    if (url.pathname === '/test') {
      const ok = await sendLine(
        '🛡️ HORIZON SHIELD監視システム\n✅ LINE通知テスト成功！\n\n見込み客が見つかったらここに通知が届きます。',
        env
      );
      return new Response(ok ? 'LINE通知成功！' : 'LINE通知失敗', { status: ok ? 200 : 500 });
    }

    // 手動スキャン実行
    if (url.pathname === '/scan') {
      const result = await scanAndNotify(env);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('HORIZON SHIELD Monitor v1.0 Active', { status: 200 });
  },

  // 自動実行（30分ごと）
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scanAndNotify(env));
  }
};