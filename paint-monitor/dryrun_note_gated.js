// ゲート付きドライラン: 本番と同じ「生成→捏造ゲート→再生成→常緑退避」を通して表示のみ。
const fs = require('fs');
const path = require('path');
const NOTE_DIR = path.join(require('os').homedir(), 'Desktop', 'horizon-shield', 'note-post');

// THEMES(常緑)の最低限ダミー: 退避先確認用に1件だけ持つ(本番はpost_to_note.jsのTHEMES)
const THEMES = [{
  title: '外壁塗装シリコン30坪150万円は適正か。坪単価で検算する手順',
  keywords: ['外壁塗装','シリコン','坪単価','足場代','適正レンジ'],
  angle: '外壁塗装の見積もりを坪単価と一般的な内訳で検算し適正かを判断する手順。具体的な金額は断定しない。',
  hashtags: ['外壁塗装','適正価格','坪単価','施主','HORIZONSHIELD'],
}];

function loadFreshThemes() {
  const feedDir = path.join(NOTE_DIR, 'feed');
  if (!fs.existsSync(feedDir)) return [];
  const fresh = [];
  for (const f of fs.readdirSync(feedDir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(feedDir, f), 'utf-8'));
      fresh.push({ title: j.title, keywords: j.keywords||[],
        angle: (j.angle||'')+' 参考事実: '+((j.facts||[]).join(' / '))+' 記事末尾で必ず「'+(j.cta||'')+'」とLP('+(j.lp_url||'')+')へ誘導する。',
        hashtags: (j.keywords||[]).slice(0,4).concat(['HORIZONSHIELD']),
        _priority: j.priority||'normal', _sourceFile: f });
    } catch(e){}
  }
  fresh.sort((a,b)=>(a._priority==='urgent'?0:1)-(b._priority==='urgent'?0:1));
  return fresh;
}

function looksFabricated(text) {
  if (!text) return true;
  const banned = [
    /私(?:が|は|たち|ども)?(?:が|は)?(?:関わっ|携わっ|担当|対応|見てき|見た|経験|施工|手がけ)/,
    /私の(?:経験|経験則|知見|肌感)/, /弊社が(?:対応|担当|施工|手がけ)/,
    /(?:先日|過去|以前)(?:に|の)?(?:対応|担当|施工|手がけ|あった案件)/,
    /某(?:戸建て|案件|現場|物件|施主)/, /(?:実際の|これまでの)?現場で(?:見た|見てき|経験)/,
    /(?:獲得|実現)できました/, /事例(?:も|を)(?:経験|担当)/,
    /施主(?:が|さん|様)?(?:いました|がいます|に直面)/,
    /昨年(?:度)?(?:も|は|の同時期)/, /例年(?:より)?/, /過去の(?:事業|実績|データ)で(?:も|は)/,
    /予定より(?:数|[0-9０-９]+)(?:ヶ月|か月|日)(?:も)?早く/,
  ];
  for (const re of banned) { if (re.test(text)) { console.log('  [ゲート]検出:', re.source); return true; } }
  return false;
}

async function generateArticle(theme) {
  const PROMPT = `あなたはHORIZON SHIELDのAIライターです。建設費診断の専門家として、施主目線で以下のテーマについて記事を書いてください。

テーマ：${theme.title}
キーワード：${theme.keywords.join('、')}
切り口：${theme.angle}

厳守事項(違反は不可):
1. あなたの役割は、上記の参考事実を施主向けに分かりやすく解説することです。事実を「創作」する役割ではありません。
2. 一人称の体験談を一切書かないでください。「私が」「弊社が対応した」「先日の案件で」「某戸建てで」のような実体験の描写は全面禁止です。
3. 参考事実に書かれていない具体的な数字(金額・パーセント・件数・「3ヶ月早く」等)を新たに作り出してはいけません。数字は参考事実にあるものだけを使ってください。
4. 現在は2026年6月です。「年内」「来年」等は2026年基準。2025年を未来や現在として書かないでください。
5. 一般的な注意喚起は「〜の場合があります」「公式サイトで必ず確認してください」と、断定を避けて書いてください。

書き方:
- 1000〜1400文字
- 施主が次に取るべき行動を、参考事実に基づいて整理する
- 段落ごとに改行して読みやすく
- 記号は使わない
- 最後にHORIZON SHIELDへの誘導文を1文

本文のみ出力してください。`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
    body: JSON.stringify({ model:'claude-haiku-4-5-20251001', max_tokens:2000, messages:[{role:'user',content:PROMPT}] }),
  });
  const data = await r.json();
  if (!data.content) { console.log('API異常:', JSON.stringify(data).slice(0,200)); return null; }
  return data.content[0].text;
}

(async () => {
  const fresh = loadFreshThemes();
  let theme = fresh.length>0 ? fresh[0] : THEMES[0];
  console.log('採用テーマ:', theme._priority||'(常緑)', theme.title);
  let article = await generateArticle(theme);
  let tries = 0;
  while (looksFabricated(article) && tries < 2) {
    console.log('  [ゲート] 捏造検出 → 再生成', tries+1);
    article = await generateArticle(theme);
    tries++;
  }
  if (looksFabricated(article)) {
    console.log('  [ゲート] 鮮度テーマで捏造消えず → 常緑テーマに退避');
    theme = THEMES[0];
    article = await generateArticle(theme);
  }
  console.log('\n===== 最終記事(ゲート通過後・投稿せず表示) =====');
  console.log('タイトル:', theme.title);
  console.log('----');
  console.log(article);
  console.log('---- 文字数:', (article||'').length, '----');
  console.log('捏造ゲート最終判定:', looksFabricated(article) ? '★まだ危険(投稿されない)' : '健全(投稿可能)');
})();
