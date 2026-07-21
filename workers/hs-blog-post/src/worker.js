/**
 * HORIZON SHIELD - ブログ投稿トリガーWorker v1
 * GitHub Actionsをトリガーして記事生成・投稿
 */

async function sendLine(msg, env) {
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.LINE_CHANNEL_TOKEN },
    body: JSON.stringify({ to: env.LINE_USER_ID, messages: [{ type: 'text', text: String(msg).slice(0, 5000) }] })
  });
}

async function triggerGitHubActions(env) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/dispatches`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'token ' + env.GITHUB_TOKEN,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'HORIZON-SHIELD-BOT'
    },
    body: JSON.stringify({ event_type: 'blog-post' })
  });

  if (res.status === 204) {
    await sendLine('✅ ブログ投稿をGitHub Actionsに依頼しました！\n\n数分後にshield.the-horizons-innovation.com/blog/に記事が公開されます。', env);
    return true;
  } else {
    const err = await res.text();
    await sendLine(`❌ GitHub Actions トリガー失敗\nStatus: ${res.status}\n${err.slice(0, 200)}`, env);
    return false;
  }
}

export default {
  async fetch(req, env, ctx) {
    const path = new URL(req.url).pathname;
    if (path === '/post') {
      ctx.waitUntil(triggerGitHubActions(env));
      return new Response('GitHub Actions トリガー開始', { status: 200 });
    }
    return new Response('HORIZON SHIELD Blog Trigger v1', { status: 200 });
  },
  async scheduled(e, env, ctx) {
    ctx.waitUntil(triggerGitHubActions(env));
  }
};