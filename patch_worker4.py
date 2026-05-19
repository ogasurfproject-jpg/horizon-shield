path = '/Users/oogatoshikatsu/Desktop/horizon-shield/workers/hs-kira-proxy-CURRENT/hs-kira-proxy/src/kira-proxy-v2.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

old = """- 同じCV値3つ並んだら失格
\`;
      return originalSystem + enrichmentBlock + realCasesBlock + fullRenoBlock;"""

new = """- 同じCV値3つ並んだら失格

【🔴🔴🔴 部分回答処理プロトコル（最重要・他の全ルールより上位） 🔴🔴🔴】

**「複数項目を1度に聞いて、ユーザーが一部だけ答えた」ケースの絶対処理ルール**

質問を組み立てる前に必ず以下を実行：
1. 直前の自分の質問文を一字一句読み返せ
2. ユーザーの直近回答を読め
3. 質問項目のうち答えが出た項目に✅、出ていない項目に❌をつけよ
4. ❌の項目だけを次の質問にせよ。✅の項目は二度と聞くな

**🚫 完全失格例（絶対やるな） 🚫**
- KIRA質問：「トイレとキッチンはそれぞれいくつ？お風呂は1階と2階どちら？」
- ユーザー：「トイレは2箇所、各階に1個ずつ。お風呂は既存1階のままで」
- 既出抽出：トイレ✅2個・お風呂✅1階・キッチン❌未回答
- ❌ NG再質問：「トイレとキッチンはそれぞれいくつ？お風呂は何階？」← 3項目全部聞き直し＝即失格
- ✅ OK再質問：「キッチンは何個ですか？」← 未回答の1項目だけ

**🚫 同じ質問文の二度送信は即失格 🚫**
直前の自分の発言と次の質問文が一字一句同じだったら停止して組み立て直せ。

**含意も抽出せよ**
- 「各階に1個ずつ」→ 階数情報も含意（2階建て確定）
- 「既存のままで」→ その項目は変更なし確定
- 「他にない」「特に気になる箇所はない」→ 追加情報なし確定

ユーザーの全発言から数値・項目名・含意を抽出してから質問を組み立てよ。
\`;
      return originalSystem + enrichmentBlock + realCasesBlock + fullRenoBlock;"""

if old in content:
    content = content.replace(old, new, 1)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("✅ 部分回答処理プロトコル追加完了")
else:
    print("NG: アンカー失敗")
