// note記事 ドライラン: feedから鮮度テーマを取り、KIRAに記事を書かせて「表示するだけ」。
// 投稿(postToNote)は一切呼ばない。ブラウザもnoteログインも使わない。
const fs = require('fs');
const path = require('path');

const NOTE_DIR = path.join(require('os').homedir(), 'Desktop', 'horizon-shield', 'note-post');

function loadFreshThemes() {
  const feedDir = path.join(NOTE_DIR, 'feed');
  if (!fs.existsSync(feedDir)) return [];
  const fresh = [];
  for (const f of fs.readdirSync(feedDir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(feedDir, f), 'utf-8'));
      fresh.push({
        title: j.title,
        keywords: j.keywords || [],
        angle: (j.angle || '') +
          ' 参考事実: ' + ((j.facts || []).join(' / ')) +
          ' 記事末尾で必ず「' + (j.cta || '') + '」とLP(' + (j.lp_url || '') + ')へ誘導する。',
        hashtags: (j.keywords || []).slice(0, 4).concat(['HORIZONSHIELD']),
        _priority: j.priority || 'normal',
        _sourceFile: f,
      });
    } catch (e) {}
  }
  fresh.sort((a, b) => (a._priority === 'urgent' ? 0 : 1) - (b._priority === 'urgent' ? 0 : 1));
  return fresh;
}

async function generateArticle(theme) {
  console.log('記事生成中:', theme.title);
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `あなたはHORIZON SHIELDのAIライターです。建設費診断の専門家として、施主目線で以下のテーマについて記事を書いてください。

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

本文のみ出力してください。タイトルは不要です。`,
      }],
    }),
  });
  const data = await response.json();
  if (!data.content) {
    console.log('!! API応答異常:', JSON.stringify(data).slice(0, 300));
    return null;
  }
  return data.content[0].text;
}

(async () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('!! ANTHROPIC_API_KEY が環境変数に無い。');
    console.log('   export ANTHROPIC_API_KEY=... してから再実行するか、');
    console.log('   ドライランはスキップして本番Actions(secrets使用)で確認する。');
    process.exit(1);
  }
  const fresh = loadFreshThemes();
  if (fresh.length === 0) {
    console.log('feedに鮮度テーマが無い。make_feedで作ってから。');
    process.exit(0);
  }
  const theme = fresh[0];
  console.log('========================================');
  console.log('採用テーマ:', theme._priority, theme.title);
  console.log('ソースfeed:', theme._sourceFile);
  console.log('========================================');
  const article = await generateArticle(theme);
  if (article) {
    console.log('\n===== 生成された記事(投稿せず表示) =====\n');
    console.log(article);
    console.log('\n===== 記事ここまで 文字数:', article.length, '=====');
    console.log('\n※ これは投稿していない。中身がよければ本番Actionsで投稿する。');
  }
})();
