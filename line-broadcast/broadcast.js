const https = require('https');

const KIRA_SYSTEM = `あなたはHORIZON SHIELDのAI営業スタッフKIRAです。
毎朝、建設費・リフォームに不安を持つ施主向けに、LINE配信メッセージを1通生成してください。

【ルール】
・150文字以内
・絵文字を2〜3個使う
・「見積書を見せてください」「診断します」「¥55,000」のいずれかを必ず含める
・毎回違うパターンで（事例紹介/警告/安心感/お得感をローテート）
・最後にLP URLを入れる：https://shield.the-horizons-innovation.com
・プレーンテキストのみ`;

function generateMessage() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 300,
      system: KIRA_SYSTEM,
      messages: [{ role: 'user', content: '今日のLINE配信メッセージを1通生成してください。' }]
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.content[0].text);
        } catch(e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function broadcast(message) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ messages: [{ type: 'text', text: message }] });

    const req = https.request({
      hostname: 'api.line.me',
      path: '/v2/bot/message/broadcast',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.LINE_CHANNEL_TOKEN}`
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`Status: ${res.statusCode}`);
        console.log(`Response: ${data}`);
        if (res.statusCode === 200) resolve();
        else reject(new Error(`LINE API error: ${res.statusCode} ${data}`));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('KIRA LINE broadcast 開始...');
  const message = await generateMessage();
  console.log('生成メッセージ:', message);
  await broadcast(message);
  console.log('配信完了！');
}

main().catch(err => {
  console.error('エラー:', err);
  process.exit(1);
});
