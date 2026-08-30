# Public Page Conduct Policy

門(tools/pagecheck/validate.py)が、公開前のページに課す規約。版番号つき。
目的は一つ: 検証を通っていないものを、施主や検索エンジンの前に出さない。
fail-closed。1枚でも落ちればバッチ全体を公開しない。

この規約は「金で買えないもの」の一部である。誰でも再計算できる:

    python3 tools/pagecheck/validate.py --paths <page>   # 1枚を門に通す
    python3 tools/pagecheck/redteam.py                    # 門を敵として攻める

---

## 現行版: v1.1.0 (2026-08-30)

対象: yakumo/**/*.html ・ care/**/*.html (push で変わったページ)

### 各ページに課す条件
1. HTML基本構造 (html / title / html閉じ)
2. JSON-LD が正当で @context / @type を持つ
3. canonical が存在し、ファイルパスから導く正規URLと一致
4. 必須メタ: title / description / robots / author
5. robots が index できる状態であること
   - noindex / nofollow / none を含むページは弾く
   - robots メタは1つだけ (複数は矛盾として弾く)
   - ただし非公開・取引・フォーム面 (admin / mypage / register / store / api / auth / login) は
     noindex が正当なので免除する
6. MOAT語 (機密の内部指標) が本文に無い。大小・空白での難読化も潰す
7. em / en / bar dash および視覚的に等価なダッシュが無い
   (長音ー・ハイフン・波ダッシュ〜は許可)
8. 金額 (数字・全角数字・漢数字・画像alt内を含む) が無い
   施主向け加盟店面は金額非表示。採用 (/recruit/) のみ免除
9. バックリンク: 置き場所で宛先が変わる (yakumo は モールへ / care は自事業所窓口へ)
   HORIZON SHIELD ルートへのリンクは必須
10. 内部リンクが絶対URLで壊れていない
11. 重複ゼロ (バッチ内相互 + 台帳との衝突)

---

## 変更履歴

### v1.0.0 (2026-08-23)
初版。出典のない金額を含む2ページが門を通らずに公開されていたため設置。
上記 1〜4・6〜11 を導入。

### v1.1.0 (2026-08-30) ・ レッドチーム強化
門を敵として攻め (tools/pagecheck/redteam.py)、13攻撃のうち7つがすり抜けたため、
同日に以下を修正:
- robots: noindex / nofollow / none と複数robotsタグを検出。
  旧実装は "noindex" が "index" を部分文字列に含むため noindex ページを見逃していた。
- noindex の線引き: 非公開・取引・フォーム面は正当な noindex として免除。
  開示が主張を「限定」するのか「矛盾」させるのかを、置き場所で分ける。
- 金額: 漢数字金額と画像alt内の金額も検出 (難読化を潰す)。
- dash: 全角ハイフンマイナス・figure dash・minus 等、視覚的に等価な変種を追加。
- MOAT: 大小・空白の難読化を潰す。
- redteam.py を新設。13攻撃を fail-closed で常時検証 (誤検出も同時に監視)。

再現: 上記2コマンドで、この版の判定を誰でも再計算できる。
