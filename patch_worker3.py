path = '/Users/oogatoshikatsu/Desktop/horizon-shield/workers/hs-kira-proxy-CURRENT/hs-kira-proxy/src/kira-proxy-v2.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Step 1: isFullRenovation判定追加
old1 = """    // ★ エイリアス展開：施主表現 → souba-dbカテゴリ名へ変換
    const aliases = ["""
new1 = """    // ★ フルリノベ判定（情報が命、最後まで聞き切る）
    const isFullRenovation = /フルリノベ|全面リフォーム|全面リノベ|フルリフォーム|スケルトン/.test(userText);
    
    // ★ エイリアス展開：施主表現 → souba-dbカテゴリ名へ変換
    const aliases = ["""

# Step 2: フルリノベ専用ブロック注入
old2 = """  return originalSystem + enrichmentBlock;"""
new2 = """  // ★★★ フルリノベ専用：情報が命、聞き切るまで止めない ★★★
  if (typeof isFullRenovation !== 'undefined' && isFullRenovation) {
    const fullRenoBlock = `

### 🔴 フルリノベ専用絶対ルール（最優先・他のルールより上位）

**フルリノベは情報量が命。途中でPLAN出力は絶対禁止。聞き切れ。**

【必須ヒアリング 全15項目】（全部揃うまでPLAN禁止）
1.地域 2.構造 3.築年数 4.延床面積 5.用途(賃貸/自宅)
6.世帯数 7.キッチン数 8.トイレ数 9.洗面台数 10.お風呂の階
11.解体範囲(内装のみ/スケルトン/外壁含) 12.配管やり替え有無 13.電気容量変更 14.予算 15.完成希望時期

【🚫 重複質問絶対禁止プロトコル 🚫】
- 質問前にユーザー過去発言を全件スキャンせよ
- 既に答えが出ている項目を二度と聞くな（同じ質問を繰り返したら即失格）
- 含意も読み取れ：
  ・「トイレは2箇所、各階に1個ずつ」→ トイレ数=2 確定、各階配置も確定
  ・「お風呂は既存1階のままで」→ お風呂位置=1階 確定
  ・「他に気になる箇所はない」→ 追加劣化なし 確定
  ・「築25年・特に劣化なし」→ 築年数=25、劣化情報=なし 確定

【質問の出し方ルール】
- 1回の質問につき必須項目は1〜2個まで(4個並べるな・部分回答を誘発する)
- 質問前に必ず「✅ これまで確認：地域千葉/木造築25年/80㎡/賃貸/単世帯/トイレ2/お風呂1F...」と1行サマリ
- 次は未確認の最重要項目から1つだけ質問

【ユーザーが「プランを出して」と要求した場合】
- 必須15項目に未充足項目があれば PLAN出さず
- 「精度の高い概算のため、あと○○・△△を教えてください」と未確認項目だけ聞き返す
- 全15項目揃って初めてPLAN出力

【PLAN出力時】
- 3プラン(松/竹/梅)全部にCV±X.X%必須
- CV値は3つ全部違う数値(松×0.6/竹×0.85/梅×1.2の係数で差別化)
- 同じCV値3つ並んだら失格
`;
    return originalSystem + enrichmentBlock + fullRenoBlock;
  }
  
  return originalSystem + enrichmentBlock;"""

ok = True
if old1 in content:
    content = content.replace(old1, new1)
    print("OK Step 1: isFullRenovation判定追加")
else:
    print("NG Step 1: アンカー1が見つからない")
    ok = False

if old2 in content:
    content = content.replace(old2, new2, 1)
    print("OK Step 2: フルリノベ専用ブロック注入")
else:
    print("NG Step 2: アンカー2が見つからない")
    ok = False

if ok:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("✅ パッチ適用完了")
