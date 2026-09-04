# Public Page Conduct Policy

門(tools/pagecheck/validate.py)が、公開前のページに課す規約。版番号つき。
目的は一つ: 検証を通っていないものを、施主や検索エンジンの前に出さない。
fail-closed。1枚でも落ちればバッチ全体を公開しない。

この規約は「金で買えないもの」の一部である。誰でも再計算できる:

    python3 tools/pagecheck/validate.py --paths <page>   # 1枚を門に通す
    python3 tools/pagecheck/redteam.py                    # 門を敵として攻める

---

## 現行版: v1.3.0 (2026-09-04)

対象: yakumo/**/*.html ・ care/**/*.html ・ qa/**/*.html ・ aeo/**/*.html (push で変わったページ)
      加えて qa/ aeo/ は全ページを毎回 report で見る(落とさず内訳を出す)

### 名前空間の種類 (v1.3.0)
門は置き場所で「何の面か」を決め、面の種類で読み方を変える。読み方が変わるのは4点だけで、それ以外は同じ強さ。

    member  = yakumo/ care/   加盟店の面。施主向けに金額を出さない。下の条件 1〜14 をそのまま。v1.2.0 から一字も変えていない
    content = qa/ aeo/        記事の面。金額と出典が中身そのもの。次の4点を content 用に読み替える:
        3.  canonical は ファイルURL(.../qa/x.html)。index.html だけディレクトリ形(.../qa/)
        8.  金額は 出典への href があれば可。無ければ MONEY_WITHOUT_SOURCE。
            出典と認める宛先: /souba/(相場DB) / ledger.horizonshield.dev(JIDEC) / github.com/ogasurfproject-jpg(JCCDB) / doi.org / papers.ssrn.com / zenodo.org
            本文に「出典」と書くだけ、コメントの中の href、は出典にならない。門を置いた理由は「出典のない金額」であり、content ではそれをそのまま検査する
        9.  モール / 窓口への逆リンクは求めない。HORIZON SHIELD ルートへの逆リンクは必須で、content は href="/" でも可
        10. root 相対(/souba/ 等)と絶対URLの内部リンクは、宛先がこのリポジトリに実在すること(無ければ INTERNAL_LINK_BROKEN)。
            裸相対(souba/.. や x.html)は従来どおり不可
    それ以外(blog/ 等) = UNKNOWN_NAMESPACE のまま。置き場所の取り違えは今までどおり弾く

--mode report: 判定は block と同一、exit だけ 0。内訳を1行で出す。CI は qa/aeo 全ページをこれで毎回見る。

### 初回計測 (2026-09-04、qa 57 + aeo 91 = 148 ページ)
v1.2.0 の門をそのまま当てると 1,317 件。取り違え(canonical 形 / 金額 / root 相対 / 名前空間)を読み替えたら 208 件、全部が実欠陥:
  NO_AUTHOR 90 / ROBOTS_TAG_COUNT 86 (aeo の 91 ページ中 86 に robots meta が無かった) / SUSPECT_RELATIVE_LINK 18 (一覧ページ 1 枚) / DUPLICATE_IN_BATCH 14
前三つは同日に直した(90 ページに meta を差し、一覧の 18 本を /aeo/ 付きに。ops/content_meta_fix_20260904_files.txt)。
残る近似重複 14 組は 22 ページ、可視本文 1,700〜1,850 字、対で 63〜73% 同文。**うち 21 ページが Google の「クロール済み・未登録」に入っている。**
これは文章の問題で、書き直すまで report に毎回出る。隠さない。

### 判定の前提 (v1.2.0)
門は「書かれた文字」でなく「読み手に届く文字」を見る。判定の前に正規化する:
HTMLエンティティ復号 / ゼロ幅文字の除去 / NFKC (全角・互換文字) / 同形異字 (キリル・ギリシャ → ラテン) /
CSS・JS のエスケープ復号 / インライン要素で割られた文字の糊付け。
どの符号化で書いても、同じ毒は同じ理由で落ちる。

### 各ページに課す条件
1. HTML基本構造 (html / title / html閉じ)。UTF-8 で読めること。title は空でなく1つだけ
2. JSON-LD が正当で @context / @type を持つ。属性順・引用符・大小で書き分けても同じ1本として読む
3. canonical が存在し、ファイルパスから導く正規URLと一致。canonical は1つだけ
4. 必須メタ: title / description (空でなく1つ) / robots / author
5. robots が index できる状態であること
   - noindex / nofollow / none / unavailable_after を含むページは弾く
   - robots メタは1つだけ (複数は矛盾として弾く)。大小・属性順・引用符・空白・エンティティで
     書かれた robots も同じ1本として数え、厳密表記との本数の食い違い自体を弾く
   - googlebot / bingbot 等の bot 別 meta と http-equiv X-Robots-Tag での noindex も弾く
   - コメント内の robots は数えない (コメントだけに robots がある = 無いのと同じ)
   - ただし非公開・取引・フォーム面 (admin / mypage / register / store / api / auth / login) は
     noindex が正当なので免除する。免除は名前空間直下 (yakumo/<面>/ , care/<slug>/<面>/) だけ。
     公開面の下に admin を名乗る枝を作っても免除しない
6. MOAT語 (機密の内部指標) が無い。大小・空白・記号割り・タグ割り・全角・エンティティ・同形異字・
   桁区切り・base64 での難読化も潰す。コメント・属性・JSON-LD・CSS・JS・同一リポジトリ内 JS も見る
7. em / en / bar dash および視覚的に等価なダッシュが無い
   個別の文字でなく Unicode Pd (ダッシュ句読点) クラス全体を禁止し、罫線・水平線・minus を明示で足す
   エンティティ (&mdash; 等) と CSS \2014 / JS \u2014 のエスケープも同じ文字として弾く
   許可: ハイフン - / ハイフン U+2010 U+2011 / 波ダッシュ 〜 ～ / 長音ー / ⇔ / ㎡
8. 金額が無い。数字・全角数字・漢数字・大字 (壱弐参拾) / ¥ ￥ 円 圓 萬 億 / JPY yen USD $ /
   通貨記号の無い「価格語 + 桁区切り数」まで見る
   置き場所: 可視本文 / 画像alt / title・aria-label・placeholder・value・data-* 等の属性 /
   meta description・og・twitter / JSON-LD の文字列と価格系の鍵 / CSS content / インラインJS /
   同一リポジトリ内の JS / インライン SVG の CDATA
   施主向け加盟店面は金額非表示。採用 (recruit) のみ免除。免除は名前空間直下
   (yakumo/recruit/ , yakumo/<店>/recruit/ , care/<slug>/recruit/) だけ
9. バックリンク: 置き場所で宛先が変わる (yakumo は モールへ / care は自事業所窓口へ)
   HORIZON SHIELD ルートへのリンクは必須。href= で在ること (コメントや本文の文字列では満たせない)
10. 内部リンクが絶対URLで壊れていない
11. 重複ゼロ (バッチ内相互 + 台帳との衝突)
12. 不可視文字が無い: ゼロ幅 (U+200B 等) / 双方向制御 (U+202E 等) / 制御文字。先頭の BOM だけ許容
13. <base> と meta refresh が無い (リンク先・表示先を丸ごと差し替える道具)
14. 実行時にページを書き換える資源 (script src / iframe / embed / object) は絶対URLで、
    許可した出どころだけ: shield.the-horizons-innovation.com / *.horizonshield.dev /
    *.oga-surf-project.workers.dev / www.paypal.com / static.cloudflareinsights.com
    同一リポジトリ内の JS は、実在し、中身も 6・7・8 の検査を通ること

### 門が見られないもの (正直に書く)
- 画像の中の文字 (金額を画像にして貼れば門は見えない)
- 許可した出どころの外部スクリプトが実行時に描く文字 (出どころで縛るだけ)
- 門は push の後に走る。GitHub Pages の配信は門と独立に進むため、赤は「止める」でなく「知らせる」。
  配信を止める門にするには、配信ワークフロー側で門を先に走らせる配線が要る (REDTEAM_LOG 参照)

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

### v1.2.0 (2026-08-30) ・ クラスで弾く
敵を「個別の13手」から「毒 x 置き場所 x 符号化」の機械生成 (1,475手) に上げ、
門を個別対応でなくクラス単位の判定へ組み直した。v1.1.0 の門は v2 の敵に 277 / 1,475 (1,198手がすり抜け)。
正規化層を入れた後も 4手、構造攻撃でさらに 6手が抜けたため、同日に以下を追加 (既存の判定は全て残し、弱めていない):
- 正規化層 (エンティティ / ゼロ幅 / NFKC / 同形異字 / CSS・JS エスケープ / インライン糊付け / CDATA)
- ダッシュ: Unicode Pd クラス全体 + 罫線・水平線 + エンティティ・エスケープ
- 金額: 大字・圓・萬・億・JPY・yen・USD・$・「価格語 + 桁区切り数」。置き場所を属性・meta・JSON-LD・
  CSS・JS・同一リポジトリ内 JS・CDATA へ拡張
- MOAT: 記号割り・タグ割り・全角・エンティティ・同形異字・桁区切り・base64
- robots / canonical / JSON-LD: 属性順・引用符・大小・空白・エンティティに依存しない汎用解析。
  bot 別 meta / X-Robots-Tag / unavailable_after / コメント内のみ / 複数 canonical / 複数 title
- 免除 (noindex / recruit) の置き場所を名前空間直下に固定
- 不可視文字 / <base> / meta refresh / 非UTF-8 / 空 title・description を禁止
- 実行時資源 (script src / iframe / embed / object) の出どころ許可制。同一リポジトリ内 JS は中身も検査
- CI: 複数コミットをまとめて push しても、その push で変わった全ページを見る (旧: 最後の1コミットだけ)
- redteam.py v2: 1,475手 (第1回の13手を回帰として保持) + 健全・免除の対照 20手。決定論的、約3秒

既存の公開ページ 26枚で回帰なし (通っていた 18枚は全て通る。落ちていた 8枚は理由が増えただけ)。

### v1.3.0 (2026-09-04) ・ 記事の面を守備範囲に
qa/ と aeo/ の 148 ページが門の外にあり、Google に索引されない qa 53 / aeo 41 と「門が知らない名前空間」が同じ集合だったため。
- 名前空間の種類 (member / content) を導入。member の判定は v1.2.0 から一字も変えていない (redteam の 1,475 手は全て同じ結果)
- content の読み替え 4 点 (canonical 形 / 出典つき金額 / 逆リンクの宛先 / 実在する内部リンク)。それ以外の 10 条件は同じ強さ
- --mode report を追加。CI は変わった qa/aeo ページを blocking、全ページを report
- redteam.py に content の 21 手: 出典つき金額は通す (souba / ledger / DOI)、出典なし・「出典」の文字だけ・コメント内の href は弾く、
  壊れた root 相対と絶対内部リンク、裸相対、ディレクトリ形 canonical、ルート逆リンク無し、robots 無し、noindex、MOAT、ダッシュ、
  ゼロ幅、未知の名前空間を弾く。**member のページに /souba/ への href を置いても金額は弾かれる** (content の緩さが member に漏れていない証明)。1,496 / 1,496
- 実欠陥 194 件を同日に修正 (meta 90 ページ、一覧の裸相対 18 本)。近似重複 14 組は残し、report で見え続ける
