path = '/Users/oogatoshikatsu/Desktop/horizon-shield/workers/hs-kira-proxy-CURRENT/hs-kira-proxy/src/kira-proxy-v2.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

helper = r'''
// ★★★ ユーザー回答から構造化事実抽出（HSフルリノベ専用） ★★★
function extractFactsFromMessagesHS(messages) {
  const userText = messages
    .filter(m => m.role === 'user')
    .map(m => typeof m.content === 'string' ? m.content : '')
    .join(' ');
  const facts = {};
  const k2n = {'一':'1','二':'2','三':'3','四':'4','五':'5'};
  
  const region = userText.match(/(北海道|青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|東京|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|京都|大阪|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄|関東|関西|九州|東北)/);
  if (region) facts['地域'] = region[1];
  const st = userText.match(/(木造|RC|鉄筋コンクリート|鉄骨|S造)/);
  if (st) facts['構造'] = st[1];
  const age = userText.match(/築\s*(\d+)\s*年/);
  if (age) facts['築年数'] = age[1] + '年';
  const area = userText.match(/(\d+)\s*(?:㎡|平米|m2|m²|平方メートル|坪)/);
  if (area) facts['延床面積'] = area[1] + '㎡';
  if (/賃貸/.test(userText)) facts['用途'] = '賃貸用';
  else if (/自宅|住居/.test(userText)) facts['用途'] = '自宅用';
  if (/単世帯|一世帯/.test(userText)) facts['世帯数'] = '単世帯';
  else if (/二世帯|2世帯/.test(userText)) facts['世帯数'] = '二世帯';
  
  const ex = (re) => {
    const m = userText.match(re);
    if (!m) return null;
    let n = m[1];
    if (k2n[n]) n = k2n[n];
    return n;
  };
  const t = ex(/トイレ[^。、]{0,20}?(\d+|[一二三四五])\s*(?:箇所|個|台|つ|か所)/);
  if (t) facts['トイレ数'] = t + '個';
  const kt = ex(/キッチン[^。、]{0,20}?(\d+|[一二三四五])\s*(?:箇所|個|台|つ|か所)/);
  if (kt) facts['キッチン数'] = kt + '個';
  const sm = ex(/洗面[^。、]{0,20}?(\d+|[一二三四五])\s*(?:箇所|個|台|つ|か所)/);
  if (sm) facts['洗面台数'] = sm + '個';
  
  if (/お?風呂[^。]{0,30}?1\s*階/.test(userText)) facts['お風呂の階'] = '1階';
  else if (/お?風呂[^。]{0,30}?2\s*階/.test(userText)) facts['お風呂の階'] = '2階';
  if (/配管[^。]{0,20}?(?:やり?か?え|交換)/.test(userText)) facts['配管やり替え'] = '有';
  else if (/配管[^。]{0,20}?(?:そのまま|変更なし|不要)/.test(userText)) facts['配管やり替え'] = '無';
  if (/スケルトン/.test(userText)) facts['解体範囲'] = 'スケルトン';
  else if (/内装(?:のみ|全面|全部)|内装だけ/.test(userText)) facts['解体範囲'] = '内装のみ';
  const b = userText.match(/(?:予算|目安)[^。、]{0,10}?(\d+)\s*万/);
  if (b) facts['予算'] = b[1] + '万円';
  const s = userText.match(/(春|夏|秋|冬)(?:ぐらい|くらい|までに|頃|まで)?/);
  if (s) facts['完成希望時期'] = s[1];
  if (/電気容量[^。]{0,15}?(?:変更|アップ|増)|アンペア[^。]{0,15}?(?:アップ|変更)/.test(userText)) facts['電気容量変更'] = '有';
  else if (/電気[^。]{0,15}?(?:そのまま|変更なし)/.test(userText)) facts['電気容量変更'] = '無';
  
  return facts;
}

function buildFactsBlockHS(facts) {
  const req = ['地域','構造','築年数','延床面積','用途','世帯数','キッチン数','トイレ数','洗面台数','お風呂の階','解体範囲','配管やり替え','電気容量変更','予算','完成希望時期'];
  const ok = []; const ng = [];
  for (const k of req) {
    if (facts[k]) ok.push(k + ': ' + facts[k]);
    else ng.push(k);
  }
  let b = '\n\n### 📌 ユーザー過去発言から自動抽出した【確定情報】（絶対に再質問禁止）\n';
  b += ok.length > 0 ? ok.map(f => '✅ ' + f).join('\n') : '（まだ確定情報なし）';
  b += '\n\n### ❓ まだ未確認の項目（次の質問対象）\n';
  b += ng.length > 0 ? ng.map(f => '❌ ' + f).join('\n') : '（全項目確認済み・PLAN出力OK）';
  b += '\n\n【絶対質問ルール】\n';
  b += '- ✅項目は絶対に二度と聞くな（聞いたら即失格）\n';
  b += '- ❌項目から1〜2個だけ選んで質問せよ\n';
  b += '- 残り未確認: ' + ng.length + '項目\n';
  b += '- 未確認0項目になるまでPLAN禁止\n';
  if (ng.length > 0) {
    b += '- 「概算を出して」と要求されても「あと' + ng.length + '項目（' + ng.slice(0,3).join('・') + 'など）を教えてください」と返せ\n';
  }
  return b;
}

'''

# Step 1: ヘルパー関数を enrichSystemPromptWithSoubaData の前に挿入
m1 = "async function enrichSystemPromptWithSoubaData"
if "extractFactsFromMessagesHS" in content:
    print("Skip 1: 既存")
elif m1 in content:
    content = content.replace(m1, helper + m1, 1)
    print("OK 1: ヘルパー関数挿入")
else:
    print("NG 1")

# Step 2: フルリノベ判定ブロック内に _facts 生成追加
m2 = "if (typeof isFullRenovation !== 'undefined' && isFullRenovation) {"
n2 = """if (typeof isFullRenovation !== 'undefined' && isFullRenovation) {
      const _facts = extractFactsFromMessagesHS(messages);
      const _factsBlock = buildFactsBlockHS(_facts);"""
if "_factsBlock" in content:
    print("Skip 2: 既存")
elif m2 in content:
    content = content.replace(m2, n2, 1)
    print("OK 2: facts生成追加")
else:
    print("NG 2")

# Step 3: return文に _factsBlock を末尾追加
m3 = "return originalSystem + enrichmentBlock + realCasesBlock + fullRenoBlock;"
n3 = "return originalSystem + enrichmentBlock + realCasesBlock + fullRenoBlock + _factsBlock;"
if "+ _factsBlock" in content:
    print("Skip 3: 既存")
elif m3 in content:
    content = content.replace(m3, n3, 1)
    print("OK 3: return書き換え")
else:
    print("NG 3")

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print("---完了---")
