const puppeteer = require('puppeteer');
const fs = require('fs');
/**
 * HORIZON SHIELD note自動投稿 v11
 * 変更点：
 * 1. 不要な NOTE_EMAIL / NOTE_PASSWORD チェック削除（Cookieのみ使用）
 * 2. 施主のための教科書シリーズ4記事をTHEMESに追加
 * 3. 全テーマのfooterにkyutoki-guide.htmlのリンクを追加
 * 4. NOTE_SESSIONチェックを追加
 */


const GUIDE_URL = 'https://shield.the-horizons-innovation.com/kyutoki-guide.html';

const THEMES = [
  // 新テーマ: 床下4兄弟(材料費から逆算)
  {
    title: 'シロアリ消毒20万円は高いのか。薬剤の原価から逆算する床下防除の適正価格',
    keywords: ['薬剤原価','バリア工法','坪単価','5年保証','床下面積'],
    angle: 'シロアリ消毒の見積もりを薬剤の材料費と工法から検証し、適正レンジを示す内容',
    hashtags: ['シロアリ消毒','床下','適正価格','施主','HORIZONSHIELD'],
  },
  {
    title: '床下換気扇30万円は本当に必要か。効果と適正費用を現場目線で検証する',
    keywords: ['床下換気','調湿','結露','効果検証','適正費用'],
    angle: '床下換気扇の効果と必要性を冷静に評価し、過剰な提案を見抜く判断軸を示す内容',
    hashtags: ['床下換気扇','リフォーム','適正価格','施主','HORIZONSHIELD'],
  },
  {
    title: '基礎のひび割れ補強で75万円。アラミド繊維の材料費が10万円台という事実',
    keywords: ['基礎補強','アラミド繊維','エポキシ','材料費','過剰請求'],
    angle: '基礎補強の見積もりを材料費から逆算し、現場価格との乖離を具体的に示す内容',
    hashtags: ['基礎補強','リフォーム','材料費','施主','HORIZONSHIELD'],
  },
  {
    title: '床下調湿剤30万円の正体。ゼオライトは1坪2千円という現実と、見えない敷設量',
    keywords: ['調湿剤','ゼオライト','防湿シート','敷設量','材料費'],
    angle: '床下調湿剤の材料費と、敷いた量が見えない構造的な問題を解説する内容',
    hashtags: ['床下調湿剤','リフォーム','材料費','施主','HORIZONSHIELD'],
  },
  // 新テーマ: 物差し論(情報格差の構造)
  {
    title: 'なぜリフォーム見積もりは比べられないのか。日本に適正価格の物差しが無い理由',
    keywords: ['物差し','公開基準','情報格差','信用財','相見積もり'],
    angle: '適正価格の公開基準が無いために相見積もりが空回りする構造を解説する内容',
    hashtags: ['リフォーム','見積もり','情報格差','施主','HORIZONSHIELD'],
  },
  {
    title: '相見積もりを3社取っても無駄になる時がある。基準が無ければ全部高い',
    keywords: ['相見積もり','基準','横比較','妥当性','情報格差'],
    angle: '基準不在のまま相見積もりを取る危うさと、妥当価格の見極め方を伝える内容',
    hashtags: ['相見積もり','リフォーム','適正価格','施主','HORIZONSHIELD'],
  },
  {
    title: '一式見積もりはなぜ危険か。内訳が消える瞬間に過剰請求が紛れる',
    keywords: ['一式','内訳','諸経費','数量明示','過剰請求'],
    angle: '一式表記の危うさと、項目ごとの内訳提出を求める正当な根拠を解説する内容',
    hashtags: ['一式見積もり','リフォーム','建設費','施主','HORIZONSHIELD'],
  },
  {
    title: '無料一括見積もりサイトの手数料は、最終的に誰が払っているのか',
    keywords: ['一括見積もり','紹介料','成約手数料','価格転嫁','中立性'],
    angle: '一括見積もりサイトの紹介料モデルと、手数料が工事額に転嫁される構造を解説する内容',
    hashtags: ['一括見積もり','リフォーム','手数料','施主','HORIZONSHIELD'],
  },
  {
    title: '訪問販売の床下工事で即決を迫られたら。クーリングオフと消費者ホットライン188',
    keywords: ['訪問販売','クーリングオフ','消費者ホットライン188','即決','床下'],
    angle: '訪問販売の床下工事で即決を避け、クーリングオフと188番で身を守る手順を伝える内容',
    hashtags: ['訪問販売','クーリングオフ','床下','施主','HORIZONSHIELD'],
  },
  // 新テーマ: 検算(外壁・屋根・総論)
  {
    title: '外壁塗装シリコン30坪150万円は適正か。坪単価で検算する手順',
    keywords: ['外壁塗装','シリコン','坪単価','足場代','適正レンジ'],
    angle: '外壁塗装の見積もりを坪単価と材料原価で検算し、適正かを判断する手順を示す内容',
    hashtags: ['外壁塗装','適正価格','坪単価','施主','HORIZONSHIELD'],
  },
  {
    title: '屋根の葺き替え見積もりが高い。材料と工程を分けて見抜く方法',
    keywords: ['屋根葺き替え','材料費','工程','火災保険','適正価格'],
    angle: '屋根葺き替えの見積もりを材料と工程に分解し、過剰請求を見抜く方法を伝える内容',
    hashtags: ['屋根工事','リフォーム','適正価格','施主','HORIZONSHIELD'],
  },
  {
    title: '同じ工事で見積もりが120万〜180万に割れる理由。妥当が90万なら全部高い',
    keywords: ['価格バラつき','妥当価格','業者間格差','物差し','検算'],
    angle: '同じ工事で業者間の見積もりが割れる理由と、妥当価格を軸に判断する考え方を示す内容',
    hashtags: ['リフォーム','見積もり','適正価格','施主','HORIZONSHIELD'],
  },
  // 追加: 常緑テーマ(在庫拡充。設備/仕上げ/契約/営業手口)
  {
    title: '給湯器交換で40万円は妥当か。エコキュート本体価格と工事費を分けて見る',
    keywords: ['給湯器','エコキュート','本体価格','工事費','見積もり'],
    angle: '給湯器交換の見積もりを本体と工事費に分解し、金額が動く要因を示す内容',
    hashtags: ['給湯器','リフォーム','適正価格','施主','HORIZONSHIELD'],
  },
  {
    title: 'ユニットバス交換100万円の内訳。本体グレードと工事費のどこで金額が動くか',
    keywords: ['ユニットバス','浴室リフォーム','本体グレード','工事費','内訳'],
    angle: '浴室交換の見積もりを本体グレードと工事費に分けて、金額の変動要因を示す内容',
    hashtags: ['浴室リフォーム','ユニットバス','適正価格','施主','HORIZONSHIELD'],
  },
  {
    title: 'トイレ交換で25万円。便器本体と設置工事、どこまでが適正か',
    keywords: ['トイレ交換','便器','設置工事','適正価格','見積もり'],
    angle: 'トイレ交換の見積もりを本体と設置工事に分け、適正の目安を示す内容',
    hashtags: ['トイレリフォーム','適正価格','施主','見積もり','HORIZONSHIELD'],
  },
  {
    title: 'システムキッチン交換の見積もりが割れる理由。本体定価と実売の差を知る',
    keywords: ['システムキッチン','本体定価','実売価格','工事費','値引き'],
    angle: 'キッチン交換で見積もりが割れる理由を、本体定価と実売の差から示す内容',
    hashtags: ['キッチンリフォーム','適正価格','施主','見積もり','HORIZONSHIELD'],
  },
  {
    title: 'クロス張替えの単価が業者で倍違う。平米あたりの相場と数量の数え方',
    keywords: ['クロス張替え','壁紙','平米単価','数量','相場'],
    angle: 'クロス張替えの平米単価と数量の数え方を示し、金額比較の軸を作る内容',
    hashtags: ['クロス張替え','内装','適正価格','施主','HORIZONSHIELD'],
  },
  {
    title: 'ベランダ防水の見積もりが読めない。FRPとウレタン、工法で価格が変わる理由',
    keywords: ['ベランダ防水','FRP','ウレタン','工法','単価'],
    angle: 'ベランダ防水の工法差と価格の関係を整理し、見積もりを読む軸を示す内容',
    hashtags: ['防水工事','ベランダ','適正価格','施主','HORIZONSHIELD'],
  },
  {
    title: 'フローリング張替えは重ね張りと張替えで金額が別物。どちらを勧められているか',
    keywords: ['フローリング','重ね張り','張替え','工法','費用'],
    angle: 'フローリングの重ね張りと張替えの違いと費用差を示し、判断軸を作る内容',
    hashtags: ['フローリング','リフォーム','適正価格','施主','HORIZONSHIELD'],
  },
  {
    title: '雨樋の交換工事、足場代が本体より高くなる仕組み',
    keywords: ['雨樋','足場代','交換工事','内訳','見積もり'],
    angle: '雨樋交換で足場代が占める割合を示し、見積もりの見方を整理する内容',
    hashtags: ['雨樋','外装','適正価格','施主','HORIZONSHIELD'],
  },
  {
    title: '分電盤交換とアンペア変更、電気工事の見積もりで確認すべき項目',
    keywords: ['分電盤','アンペア変更','電気工事','見積もり','確認項目'],
    angle: '電気工事の見積もりで確認すべき項目を、分電盤とアンペア変更を例に示す内容',
    hashtags: ['電気工事','リフォーム','施主','見積もり','HORIZONSHIELD'],
  },
  {
    title: '解体工事の見積もりに潜む「処分費一式」。廃材の量で金額は変わる',
    keywords: ['解体工事','処分費','一式','廃材','数量'],
    angle: '解体工事の処分費一式の中身を整理し、廃材量で金額が動く点を示す内容',
    hashtags: ['解体工事','適正価格','施主','見積もり','HORIZONSHIELD'],
  },
  {
    title: '相見積もりの正しい取り方。同じ条件を揃えないと比較にならない',
    keywords: ['相見積もり','条件統一','比較','数量','仕様'],
    angle: '相見積もりで条件を揃える重要性と、比較可能にする手順を示す内容',
    hashtags: ['相見積もり','リフォーム','施主','見積もり','HORIZONSHIELD'],
  },
  {
    title: 'リフォーム契約書で必ず確認する条項。着工前に見るべきポイント',
    keywords: ['契約書','確認条項','着工前','工期','支払条件'],
    angle: 'リフォーム契約書で着工前に確認すべき条項を整理して示す内容',
    hashtags: ['リフォーム契約','施主','トラブル防止','見積もり','HORIZONSHIELD'],
  },
  {
    title: '火災保険を使えばリフォームが無料、という営業トークの落とし穴',
    keywords: ['火災保険','リフォーム','営業トーク','注意点','トラブル'],
    angle: '火災保険を使った無料リフォームという勧誘の注意点を整理して示す内容',
    hashtags: ['火災保険','リフォーム詐欺注意','施主','消費者','HORIZONSHIELD'],
  },
  {
    title: '外壁塗装の「モニター価格」はなぜ安く見えるのか。値引きの原資を考える',
    keywords: ['外壁塗装','モニター価格','値引き','原資','見積もり'],
    angle: '外壁塗装のモニター価格が安く見える仕組みを、値引きの原資から考える内容',
    hashtags: ['外壁塗装','適正価格','施主','見積もり','HORIZONSHIELD'],
  },
  {
    title: 'コーキング打ち替えと増し打ちの違い。外壁塗装の見積もりで見落としやすい項目',
    keywords: ['コーキング','打ち替え','増し打ち','外壁塗装','見積もり'],
    angle: 'コーキングの打ち替えと増し打ちの違いと費用への影響を示す内容',
    hashtags: ['外壁塗装','コーキング','施主','見積もり','HORIZONSHIELD'],
  },
  {
    title: '屋根カバー工法と葺き替え、金額差の理由と向き不向き',
    keywords: ['屋根','カバー工法','葺き替え','金額差','向き不向き'],
    angle: '屋根のカバー工法と葺き替えの金額差と適した状況を整理して示す内容',
    hashtags: ['屋根工事','適正価格','施主','見積もり','HORIZONSHIELD'],
  },
  {
    title: '内窓設置の見積もり、サッシ本体とガラスのグレードで費用が変わる',
    keywords: ['内窓','サッシ','ガラスグレード','断熱','費用'],
    angle: '内窓設置の費用がサッシとガラスのグレードで変わる点を整理して示す内容',
    hashtags: ['内窓','断熱リフォーム','施主','見積もり','HORIZONSHIELD'],
  },
  {
    title: '「今日契約なら値引き」はなぜ危険か。即決を迫る営業の見分け方',
    keywords: ['即決','値引き','営業','見分け方','クーリングオフ'],
    angle: '即決を迫る値引き営業の危険性と、落ち着いて判断する方法を示す内容',
    hashtags: ['訪問販売注意','施主','消費者','リフォーム','HORIZONSHIELD'],
  },
];

// feed/ に監視由来の鮮度テーマがあれば最優先。なければ従来の日数ローテーション。
// 捏造検出ゲート: 体験談/創作マーカーが残っていたら true(=不採用)を返す
function looksFabricated(text) {
  if (!text) return true;
  const banned = [
    /私(?:が|は|たち|ども)?(?:が|は)?(?:関わっ|携わっ|担当|対応|見てき|見た|経験|施工|手がけ)/,
    /私の(?:経験|経験則|知見|肌感)/,
    /弊社が(?:対応|担当|施工|手がけ)/,
    /(?:先日|過去|以前)(?:に|の)?(?:対応|担当|施工|手がけ|あった案件)/,
    /某(?:戸建て|案件|現場|物件|施主)/,
    /(?:実際の|これまでの)?現場で(?:見た|見てき|経験)/,
    /(?:獲得|実現)できました/,
    /事例(?:も|を)(?:経験|担当)/,
    /施主(?:が|さん|様)?(?:いました|がいます|に直面)/,
    /昨年(?:度)?(?:も|は|の同時期)/,
    /例年(?:より)?/,
    /過去の(?:事業|実績|データ)で(?:も|は)/,
    /予定より(?:数|[0-9０-９]+)(?:ヶ月|か月|日)(?:も)?早く/,
  ];
  for (const re of banned) {
    if (re.test(text)) {
      console.log('  [捏造ゲート] 不採用マーカー検出:', re);
      return true;
    }
  }
  return false;
}

function loadFreshThemes() {
  const path = require('path');
  const feedDir = path.join(__dirname, 'feed');
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
    } catch (e) { /* skip broken json */ }
  }
  fresh.sort((a, b) =>
    (a._priority === 'urgent' ? 0 : 1) - (b._priority === 'urgent' ? 0 : 1));
  return fresh;
}

function getTodayTheme(postedTitles) {
  const posted = Array.isArray(postedTitles) ? postedTitles : [];
  const fresh = loadFreshThemes();
  for (let i = 0; i < fresh.length; i++) {
    if (posted.indexOf(fresh[i].title) === -1) {
      console.log('鮮度テーマを使用:', fresh[i].title, '(' + fresh[i]._priority + ')');
      return fresh[i];
    }
  }
  const n = THEMES.length;
  const d = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  for (let k = 0; k < n; k++) {
    const t = THEMES[(d + k) % n];
    if (posted.indexOf(t.title) === -1) {
      return t;
    }
  }
  return null;
}

async function generateArticle(theme) {
  console.log('記事生成中:', theme.title);
  let response;
  for (let i = 0; i < 5; i++) {
    response = await fetch('https://api.anthropic.com/v1/messages', {
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
- 記号「*」「**」「#」「##」「_」は使わない
- 最後にHORIZON SHIELDへの誘導文を1文

本文のみ出力してください。タイトルは不要です。`,
        }],
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

  const text = (data.content?.[0]?.text || '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^[ \t]*[-=]{3,}[ \t]*$/gm, '');

  // 給湯器ガイドリンク（教科書シリーズのみ追加）
  const guideSection = theme.guideLink
    ? `\n\n━━━━━━━━━━━━━━━━\n\n📖 給湯器交換の適正価格ガイド【2026年最新】\n建設30年プロが価格・詐欺パターン・補助金を完全解説\n${GUIDE_URL}\n`
    : '';

  const footer = `${guideSection}\n\n━━━━━━━━━━━━━━━━\n\n🛡 HORIZON SHIELD・無料で使える3つの窓口\n\n📍 LPで診断する\nhttps://shield.the-horizons-innovation.com\n\n🤖 ChatGPTで無料診断（建設費カテゴリ1位）\nhttps://chatgpt.com/g/g-69e180f9a5048191886069dd58b22572-jian-she-fei-tietuka-by-horizon-shield\n\n♊ Geminiで無料診断\nhttps://gemini.google.com/gem/1_AqLRwNSP1tZWZNWzyNIrsOrBLI1fAjo\n\n💬 LINEで今すぐ相談（KIRA）\nhttps://line.me/R/ti/p/@172piime`;

  const fullText = text + footer;
  console.log('記事生成完了 文字数:', fullText.length);
  return fullText;
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
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome-stable',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36');

  try {
    const cookieStr = process.env.NOTE_SESSION;
    const cookies = cookieStr.split(';')
      .map(c => c.trim())
      .filter(Boolean)
      .map(c => {
        const eqIdx = c.indexOf('=');
        return { name: c.slice(0, eqIdx).trim(), value: c.slice(eqIdx + 1).trim() };
      })
      .filter(c => !c.name.startsWith('_ga') && !c.name.startsWith('_gi'));

    for (const c of cookies) {
      await page.setCookie({
        name: c.name,
        value: c.value,
        domain: 'note.com',
        path: '/',
        httpOnly: true,
        secure: true,
      });
    }
    console.log('クッキーセット完了:', cookies.map(c => c.name).join(', '));

    await page.goto('https://note.com/notes/new', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));
    console.log('エディタURL:', page.url());
    if (page.url().includes('/login')) throw new Error('クッキー認証失敗: ログインページにリダイレクト');

    const editableCount = await page.evaluate(() => document.querySelectorAll('[contenteditable]').length);
    console.log('contenteditable数:', editableCount);
    if (editableCount === 0) throw new Error('エディタが開けていない');

    const titleEl = await page.$('[placeholder="記事タイトル"]');
    if (titleEl) {
      await titleEl.click();
      await page.keyboard.type(theme.title, { delay: 20 });
      console.log('タイトル入力完了');
    }
    await new Promise(r => setTimeout(r, 500));

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

    const pub = await clickButtonByText(page, '公開に進む');
    console.log('公開に進む:', pub ? '成功' : '失敗');
    await new Promise(r => setTimeout(r, 3000));

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
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: message,
    });
  } catch(e) { console.log('ntfy失敗:', e.message); }
}

async function postToHatena(theme, articleText, noteUrl) {
  try {
    const hatenaId = 'horizonshield';
    const apiKey = process.env.HATENA_API_KEY;
    const endpoint = 'https://blog.hatena.ne.jp/horizonshield/horizonshield.hatenablog.com/atom/entry';
    const credentials = Buffer.from(`${hatenaId}:${apiKey}`).toString('base64');

    const guideSection = theme.guideLink
      ? `<p>📖 <a href="${GUIDE_URL}">給湯器交換の適正価格ガイド【2026年最新】</a></p>`
      : '';

    const content = `${articleText}

---

<div style="padding:20px;background:#f5f3ec;border-left:4px solid #c8a832;margin-top:32px;">
<p style="font-weight:700;margin-bottom:8px;">🛡 HORIZON SHIELD・建設費診断サービス</p>
${guideSection}
<p>📍 <a href="https://shield.the-horizons-innovation.com">無料AI診断はこちら</a></p>
<p>🤖 <a href="https://chatgpt.com/g/g-69e180f9a5048191886069dd58b22572-jian-she-fei-tietuka-by-horizon-shield">ChatGPTで無料診断</a></p>
<p>♊ <a href="https://gemini.google.com/gem/1_AqLRwNSP1tZWZNWzyNIrsOrBLI1fAjo">Geminiで無料診断</a></p>
<p>💬 <a href="https://line.me/R/ti/p/@172piime">LINEで今すぐ相談（KIRA）</a></p>
<p>📝 <a href="${noteUrl}">note記事はこちら</a></p>
</div>`;

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<entry xmlns="http://www.w3.org/2005/Atom"
       xmlns:app="http://www.w3.org/2007/app">
  <title>${theme.title}</title>
  <author><name>horizonshield</name></author>
  <content type="text/html"><![CDATA[${content}]]></content>
  <app:control><app:draft>no</app:draft></app:control>
</entry>`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
        'Authorization': `Basic ${credentials}`,
      },
      body: xml,
    });

    if (res.ok) {
      console.log('はてなブログ投稿完了');
    } else {
      const err = await res.text();
      console.error('はてなブログ投稿失敗:', res.status, err.slice(0, 200));
    }
  } catch (e) {
    console.error('はてなブログ投稿エラー:', e.message);
  }
}

async function sendLine(message) {
  try {
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.LINE_CHANNEL_TOKEN}`,
      },
      body: JSON.stringify({
        to: process.env.LINE_USER_ID,
        messages: [{ type: 'text', text: message.slice(0, 5000) }],
      }),
    });
  } catch(e) { console.log('LINE失敗:', e.message); }
}

async function broadcastToFollowers(theme, noteUrl) {
  const guideText = theme.guideLink
    ? `\n📖 給湯器適正価格ガイド\n${GUIDE_URL}\n`
    : '';

  const text = `【今日の建設情報】\n\n${theme.title}\n\n続きを読む\n${noteUrl}\n${guideText}\n━━━━━━━━━━\nコミュニティ参加受付中！\nhttps://line.me/ti/g2/7JH1RLFfppFpf4hvhrDZP51B6embu5UHN31WJQ\n\n見積書の無料AI診断\nhttps://shield.the-horizons-innovation.com`;

  try {
    const res = await fetch('https://api.line.me/v2/bot/message/broadcast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.LINE_CHANNEL_TOKEN}`,
      },
      body: JSON.stringify({ messages: [{ type: 'text', text }] }),
    });
    console.log('ブロードキャスト:', res.ok ? '成功' : `失敗 [${res.status}]`);
  } catch(e) { console.log('ブロードキャスト失敗:', e.message); }
}

// ========================================
// 投稿済みタイトル管理
// ========================================
const POSTED_FILE = './posted_titles.json';

function loadPostedTitles() {
  try {
    if (fs.existsSync(POSTED_FILE)) {
      return JSON.parse(fs.readFileSync(POSTED_FILE, 'utf8'));
    }
  } catch (e) {
    console.log('投稿済みリスト読み込み失敗（新規作成）:', e.message);
  }
  return [];
}

function savePostedTitle(title) {
  try {
    const list = loadPostedTitles();
    if (!list.includes(title)) {
      list.push(title);
      fs.writeFileSync(POSTED_FILE, JSON.stringify(list, null, 2), 'utf8');
      console.log('投稿済みに追加:', title);
    }
  } catch (e) {
    console.error('投稿済みリスト保存失敗:', e.message);
  }
}

// ========================================
// main
// ========================================
async function main() {
  console.log('=== HORIZON SHIELD note自動投稿 v11 開始 ===');
  try {
    // ★ NOTE_EMAIL / NOTE_PASSWORD を削除（Cookie認証のため不要）
    const required = [
      'NOTE_SESSION',
      'ANTHROPIC_API_KEY',
      'LINE_CHANNEL_TOKEN',
      'LINE_USER_ID',
      'HATENA_API_KEY',
    ];
    for (const key of required) {
      if (!process.env[key]) throw new Error(`環境変数未設定: ${key}`);
    }

    const postedTitlesForPick = loadPostedTitles();
    let theme = getTodayTheme(postedTitlesForPick);
    if (!theme) {
      console.log('未投稿テーマの在庫切れ(THEMES/feed全て投稿済み)。スキップ。');
      await sendLine('⏭ 本日のnote投稿スキップ 未投稿テーマの在庫切れ');
      process.exit(0);
    }
    console.log('今日のテーマ:', theme.title);

    // 重複チェック
    const postedTitles = loadPostedTitles();
    if (postedTitles.includes(theme.title)) {
      console.log('⏭ 投稿済みのためスキップ:', theme.title);
      await sendLine(`⏭ 本日のnote投稿スキップ\n既投稿タイトル: ${theme.title}`);
      process.exit(0);
    }

    let articleText = await generateArticle(theme);
    // 捏造ゲート: 危険表現が残っていたら最大2回まで書き直す。それでも駄目なら常緑テーマに退避。
    let gateTries = 0;
    while (looksFabricated(articleText) && gateTries < 2) {
      console.log('  [捏造ゲート] 記事を再生成します(試行', gateTries + 1, ')');
      articleText = await generateArticle(theme);
      gateTries++;
    }
    if (looksFabricated(articleText)) {
      console.log('  [捏造ゲート] 鮮度テーマで捏造が消えないため、常緑テーマに退避します。');
      const posted = loadPostedTitles();
      const d = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
      const n = THEMES.length;
      let safeTheme = null;
      for (let k = 0; k < n; k++) {
        const t = THEMES[(d + k) % n];
        if (posted.indexOf(t.title) === -1) { safeTheme = t; break; }
      }
      if (!safeTheme) {
        console.log('  [note] safe theme sold out; skip posting.');
        await sendLine('note post skipped: evergreen theme inventory empty (captcha fallback)');
        process.exit(0);
      }
      theme = safeTheme;
      articleText = await generateArticle(theme);
    }

    // DRY_RUN: 投稿せず記事を表示して終了(Actions上で中身を安全に確認するため)
    if (process.env.DRY_RUN === '1') {
      console.log('===== DRY_RUN 記事プレビュー(投稿しない) =====');
      console.log('タイトル:', theme.title);
      console.log('ハッシュタグ:', (theme.hashtags || []).join(' '));
      console.log('----- 本文 -----');
      console.log(articleText);
      console.log('----- 本文ここまで 文字数:', (articleText || '').length, '-----');
      console.log('===== DRY_RUN 終了。投稿していない。=====');
      process.exit(0);
    }

    const noteUrl = await postToNote(theme, articleText);
    console.log('投稿URL:', noteUrl);

    savePostedTitle(theme.title);
    await sendNtfy(`✅ note投稿完了: ${theme.title}`);
    await sendLine(`✅ note自動投稿完了！\n━━━━━━━━━━\n📝 ${theme.title}\n\n🔗 ${noteUrl}\n\n📣 Xでシェアしてください！\n━━━━━━━━━━`);
    await broadcastToFollowers(theme, noteUrl);
    await postToHatena(theme, articleText, noteUrl);
    console.log('=== 完了 ===');
    process.exit(0);
  } catch (e) {
    console.error('エラー:', e.message);
    await sendLine(`❌ note自動投稿エラー\n${e.message}`).catch(() => {});
    process.exit(1);
  }
}

main();
