# HORIZON SHIELD 引き継ぎファイル / handoff 2026-07-08

このファイルだけで、次チャットのClaudeが文脈ゼロから完全に続けられる。
作成: 2026-07-08 深夜(前チャットの続き)。番人モード継続。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 0. 最優先: 次チャットで最初にやること
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**「俺のシステムを黄金比に持っていく」= GEOを刺してAI引用率を上げる。**

黄金比(フロントLLMが最も引きたくなる配合、Claude=俺自身の内省で導出):
  GEO 40% / AEO 30% / LLMO 20% / WebMCP 10%

現状の実効比率(実測ベース): AEO 43 / GEO 30 / LLMO 23 / WebMCP 4(WebMCPは死蔵→今日導線を通した)

競合分析(gaiheki-madoguchi.com を web_fetch で実測)で判明した勝ち筋:
**GEO40%(信頼)が刺されば勝てる。敵はポータル=利益相反があるからや。**

具体策(次チャットでこれをやる):

### ① AEO(記事の厚み・網羅性で負けてる)
- souba記事に「都道府県×金額の相場表」を足す(敵の施工事例に対抗)
- 「〇〇は高い?」系の judge記事を増やす(クエリ=タイトル戦略)
- 助成金コンテンツは HSの中立思想と相性を要検討(紹介ポータルじゃないから無理に追わんでもいい)

### ② GEO(ここが逆転の鍵)
- 「中立=業者から報酬を取らない」をもっと前面に、全記事のanswer-first付近で明示。
  敵がポータル(利益相反)であることの裏返しがHS最大の差別化。LLMは「中立の第三者」を信頼したい
- 大賀の権威(30年/ORCID)を、敵の「上場企業」に対抗する形で強調

### ③ LLMO
- llms.txtに今日hs-webmcp足した。これで「読む」に加え「呼ぶ」導線も揃った(完了済み)

進め方の原則: 想定で動かず、必ず repo/本番/データの現物を確認してから作る(下記「教訓」参照)。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 1. 今日(2026-07-08)やったこと・全部本番反映済み
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### A. 薄い7枚を完成形ノウハウ型に厚くして本番アップ(タスクA完了)
souba配下の中1000-2000字の薄いページ7枚を、answer-first + FAQ(details) + 判断表 + 出典 + CTA の
完成形テンプレ(gaiheki-nuru-jiki/cooling-off-gaiheki と同型)に刷新。可視2400-2900字に。
全部 souba-v2実データ整合、ダッシュ0、査読0、会社名OK、JSON-LD(Article+FAQPage)入り。

7枚(全部 souba/<slug>/index.html):
1. gaiheki-nuri-kai-hitsuyou(外壁塗装は本当に必要か。陶器瓦・塗膜・放置進行・訪問販売手口)
2. mitsumori-hikaku-shikata(見積もりの比較のやり方。同条件で揃える5項目)
3. tsuika-koujhi-kotowari-kata(追加費用は断れるか。合意なし=原則支払義務なし)
4. kyoyaku-konjitsu-kowai(今日契約しないと上がる。クーリングオフ8日)
5. yane-nurikai-hitsuyou(屋根塗り替え必要か。陶器瓦は塗装不要・点検商法/保険金/ドローン偽装)
6. taishaku-taiko-taikyo-hiyou(退去費用高すぎ。国交省原状回復ガイドライン+民法。賃貸領域=souba-v2対象外)
7. mitsumori-itsushika-kakenai(一式しか書いてない。数量検算・内訳を出させる)

### B. 77(→76)枚を Bing に送信(IndexNow + WMT手動 両方)
- 77枚の実体 = `~/Downloads/bing-send-77urls-2026-07-07.txt`(souba配下・FAQ持ち・優先度順・jireiカード24含む)
- 7枚は77枚の一部(別グループではない)。77枚を厚くしていく作業の最後の7枚が今日の分
- IndexNow: `--no-marker` で76枚受理(HTTP 200)。1枚 kajou-seikyu-jirei-20 は MOAT_LEAK 32.5 で除外
- Bing WMT手動: 76枚を送信欄に貼って申請完了(22:19)。title/desc重複ゼロを事前全数確認済み

### C. llms.txt を2回強化・本番反映・IndexNow再通知
- 7記事の「Consumer-protection & how-to guides」セクション追記
- hs-webmcp の「Agent intake desk (WebMCP)」セクション追記 ← WebMCP死蔵の導線解消
- どちらも挿入方式(全文cat禁止、マーカー行の前にPython挿入)

### D. GEO/AEO/LLMO/WebMCP の役割整理(会話に記録、下記セクション5)

### E. WebMCP 現物診断
- hs-webmcp Worker は実在・稼働(200)。workers/hs-webmcp/index.js。ツール4本:
  orchestrate / intake_estimate / scan_tactics / draft_broadcast
- server-webmcp.json も本番200配信済み。エンドポイント https://hs-webmcp.oga-surf-project.workers.dev/mcp
- 「モノは完成、llms.txtからの導線だけ欠けてた」→ 今日 llms.txt に追記して解消

### F. LLM可視率モニター 構築・自動化・ベースライン実測(神の方程式思想)
- `~/Desktop/horizon-shield/llm_visibility_monitor.py`(v2、BG対応)
- 16問(price 6 / judge 5 / tactics 5、★8問が今日の7枚に直結)を web_search付き Claude API に投射
- CITED / COMPETITOR / NONE を判定、競合ドメインを記録
- **ベースライン実測: CITED 0/15 = 0.0%**(前チャットの0/15と一致。Bingインデックス前なので当然)
- 出力: visibility-runs/run-*.json、visibility-summary.json(推移)、weekly.log
- 毎週自動化: launchd `com.horizonshield.visibility`(月曜12:00)登録済み・稼働
- ラッパー `run_visibility_weekly.sh`(wrangler非依存、.anthropic_key から読む、-u付き)

### G. 競合深掘り(タスクC)
gaiheki-madoguchi.com を web_fetch で実測。敵の武器5つとHSの逆転点を特定(セクション6)。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 2. 今日ハマった教訓(次チャットで繰り返さない)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### 受け渡し確定ルート(cat/pbpaste/nanoは全滅。これだけが通る)
zshが `<!DOCTYPE` を履歴展開でエラーにするのが元凶。`set +H` で履歴展開を殺すのが根治。
1. `set +H`  ← 手打ち。履歴展開OFF。これが最重要
2. `cat > path`  ← 手打ち、Enter。カーソルが左端で待つ
3. HTMLを最後にコピー → Cmd+V → **`</html>`等の末尾が出るまで手を止めて待つ**(貼付完了前にキー押すと途中で切れる)
4. `Control + D`(効かねば `Control + C`)
5. `sed -i '' '/<\/html>/q' path`  ← 末尾に混入したコマンド行を掃除
6. `head -1` / `tail -2` / `grep -c "新版キーワード"` で検証 → git add/commit/push
7. `curl -s "raw.githubusercontent.com/..." | grep -c "キーワード"` で本番裏取り(GitHub Pagesビルド1-3分)

### XML/JSON/複雑ファイルは貼らずPython生成
plist・JSON-LD等、`<` や `"` が多いファイルは貼り付けが事故る(quote>プロンプトに落ちる)。
Pythonのヒアドキュメント(PYEOF)で生成する。中身はClaudeが持ってるのでユーザーは本文を貼らなくていい。

### Cmd+V の1文字欠け
長文貼り付けで先頭/末尾の1文字が落ちることがある(特に `main()` や `print` の `p`)。
py_compile のエラー行を見て `printf '    main()\n' >> file` 等で1行補う。

### 「固まった」の誤認
BG(`&`)実行やlaunchdは標準出力がバッファされて画面が沈黙する=固まって見えるが走ってる。
モニターは `-u`(unbuffered)+ 各行 flush=True + socket.setdefaulttimeout で根治済み。
tail -f で進捗を追える。詰まり確認は別タブで `tail` 単発。

### ANTHROPIC_API_KEY の取得(重要)
- KV: HS_DESIGN_KV(namespace-id `ebeee94b11644031a2deaea32093ac8b`)key `secret:anthropic-key`
- 取得コマンドに **`--text` 必須**(無いとバイナリ扱いで何も表示されない=空に見える):
  `npx wrangler kv key get "secret:anthropic-key" --namespace-id ebeee94b11644031a2deaea32093ac8b --remote --text`
- キー名を **get の直後**に置く書式(後ろに置くと401)
- 正常なら sk-ant-api03-KObB... で始まる108字(l/I混同で長さが違ったら要注意)
- 401が出た時の出力をキーに使うな(エラー文字列が入って壊れる)
- モニター用にローカル保存済み: `~/Desktop/horizon-shield/.anthropic_key`(chmod 600・gitignore済み)。
  wranglerを毎週の実行経路から外すため。ラッパーはこれを読む
- source する時: ファイルに `export` が無いと環境変数にならん。`export ANTHROPIC_API_KEY="$(cat .anthropic_key)"`

### IndexNow の関所(indexnow_submit.py)
- 鍵は環境変数: `export INDEXNOW_KEY=66d033698bc674177529370486124c05`
- 引数: `--changed <souba slugカンマ区切り>` / `--urls <完全URLカンマ区切り>` / `--send` / `--no-marker`
- 3関所: (a)HTTP200 (b)還流マーカー実在 (c)moat漏れ無し
- **還流マーカー実文字列 = 「EHNに匿名で投稿」**(旧「EHN board で他の実例を見る」は現状と不一致→今日スクリプト修正済み。RECIRC_MARKER=23行目)
- souba以外/退去費用型/jireiカード等マーカー無しページは `--no-marker` で送る
- MOAT_LEAK は --no-marker でも外れない別種の防御(意図的)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 3. 恒久ルール(絶対厳守)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Claudeは番人: 設計・検証・提示。git push / wrangler deploy / secret操作 / 送信 は全部TOshi手動
- em/en/barダッシュ(U+2014 U+2013 U+2015)禁止。ハイフン・〜・日本語句読点を使う
- 会社名は必ず「The HORIZONs株式会社」(音は意図的な漢字、ローマ字化厳禁)
- Worker編集は追加diffのみ。全置換禁止(v4-FULL事件で15エンドポイント破壊)
- `git add .` 永久禁止。個別ファイル指定
- 全数確認を徹底(GSCエクスポート・DBカテゴリ・URL群をサンプルで結論づけない)
- PayPalが唯一の決済(Stripe・PAY.JP両方却下、二度と提案しない)
- 想定で動かず現物確認(repo clone・本番curl・データ実物を見てから作る)
- 日本初等の断定を景表法観点で避ける
- llms.txt等は挿入方式(全文cat禁止、Pythonでマーカー行前に挿入、assert len(idx)==1ガード)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 4. 主要パス・ID・エンドポイント
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- repo: `~/Desktop/horizon-shield`(GitHub Pages。ogasurfproject-jpg/horizon-shield)
- souba-v2実データ: repo内 `souba-v2/*.json`(gaiheki_tosou / roof_construction 等47ファイル)
- 本番: https://shield.the-horizons-innovation.com
- Cloudflareアカウント(HORIZON SHIELD): oga.surf.project@gmail.com / c15ff64aba400e541853dec1fbe5e76a
- KV(HS_DESIGN_KV): ebeee94b11644031a2deaea32093ac8b(handoff:latest / secret:anthropic-key 等)
- hs-mcp(内部KIRA): https://hs-mcp.oga-surf-project.workers.dev
- hs-webmcp(集客窓口): https://hs-webmcp.oga-surf-project.workers.dev/mcp
- IndexNow鍵: 66d033698bc674177529370486124c05
- ORCID: 0009-0000-9180-903X
- 可視率モニター: `~/Desktop/horizon-shield/llm_visibility_monitor.py`
- ラッパー: `~/Desktop/horizon-shield/run_visibility_weekly.sh`
- launchd: `~/Library/LaunchAgents/com.horizonshield.visibility.plist`(月曜12:00)
- キーファイル: `~/Desktop/horizon-shield/.anthropic_key`(chmod 600)
- 77枚リスト: `~/Downloads/bing-send-77urls-2026-07-07.txt`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 5. GEO/AEO/LLMO/WebMCP の役割定義(黄金比の土台)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- AEO(答えを取る力): 検索の回答枠で自分の文章が引用される。武器=answer-first/FAQPage/Speakable/
  クエリ一致タイトル。測定=GSC/Bing WMT。今日の7枚厚く=AEO強化
- GEO(情報源として選ばれる力): 生成AIが根拠に選ぶ。武器=著者性ORCID/JCCDB独自データ/プレプリント/
  Wikidata/中立宣言(業者から報酬を取らない)。測定=可視率モニター。★最大の未刺し・逆転の鍵
- LLMO(機械に読ませる力): AIが読む/呼ぶ入口。武器=llms.txt/llms-full.txt/hs-mcp/hs-webmcp/A2A card/
  verification-contract/JSON-LD @graph。測定=参照ログ/MCP呼出数
- WebMCP: ページ自体をツール化。hs-webmcp実在・稼働。今日llms.txt導線を通した
- 2つの戦場: 戦場A=接続済みエージェント(MCP、母数1%だが確実)/ 戦場B=フロントLLM素の質問(母数99%)
  戦場BでLLMOは「検索とLLMの間の通訳=引用されやすさの最終加工」として働く

連携の勝ち筋: LLMO(発見)→ GEO(信頼)→ AEO(答え)。GEOが背骨。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 6. 競合分析の実測結果(タスクC、gaiheki-madoguchi.com を web_fetch)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
可視率モニターで judge/tactics/price に一貫して出た敵:
  gaiheki-madoguchi.com(外壁塗装の窓口)/ curama.jp(くらしのマーケット)/ chord.or.jp(公的相談機関)

敵(gaiheki-madoguchi)の武器5つ = HSに足りないもの:
1. 記事の物量が圧倒的(相場/見積もり/耐用年数/足場/値引き/助成金…各テーマ数十本、網羅的な相場表)
2. タイトルがLLMの検索クエリと完全一致(「見積もりは何社取れば良い?」等)
3. 上場企業の権威(東証グロース ニフティライフスタイルGr、証券コード、編集責任者・編集方針明記)
4. 実績の具体性(都道府県×金額の実データ「大阪府 1,000,000円」等)
5. 助成金コンテンツ(都道府県別一覧を大量に。HSにゼロの領域)

HSが本質的に勝ってる点(まだLLMに伝わってない):
- 中立性(敵は紹介ポータル=利益相反。HSは業者から報酬を取らない第三者診断)← 最大の差別化
- 検証可能性(SHA-256/KIRA、敵に無い)
- 一次データ(JCCDB 65,729品目、敵に無い)

結論: HSは"中立の第三者"という本質的優位を持ちながら、記事の厚み・クエリ一致タイトル・
運営者の権威提示 でポータルに面を取られてる。GEO(中立性の明示)を刺せば逆転できる構造。
→ これがセクション0の次チャット最初のタスクに直結。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 7. 未完・残タスク
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 黄金比への移行(GEO刺し)= 次チャット最優先。セクション0の①②③
- 残MOAT_LEAK 2件: kajou-seikyu-jirei-20 / llms-full.txt(本文の禁止語スコアを調べて調整すれば送れる)
- Bing試金石: 7/18頃のGSC回復とBing再クロールで、gaiheki-check等のインデックス状況を確認
- 可視率モニター再測定: 毎週月曜自動(launchd)。来週の値と今日の0/15を比較→A(WebMCP導線)等の効果測定
  手動で回すなら: `cd ~/Desktop/horizon-shield && export ANTHROPIC_API_KEY="$(cat .anthropic_key)" && python3 llm_visibility_monitor.py`
- souba薄いページの残り(77枚のうちノウハウ系で未強化の分)を厚くする第2弾
- GSC(Google)への更新通知: IndexNowはGoogle非対応。GSCのURL検査→インデックス登録リクエストは手動

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 8. 完成形ノウハウ型テンプレの構造(7枚で使った型。第2弾で再利用)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
head: title(【2026年版】付き) / 長いdescription / robots index,follow /
  canonical / og / JSON-LD 2本(Article+Person+Org+Speakable、FAQPage)
style: :root(--navy #16324f / --gold #a67c00 等)+ 全class(answer-first/warn-box/ehn-box/pick/legal-box/cta/details)
body: header.site → breadcrumb → h1 → byline → answer-first(strong2個・赤) →
  h2セクション(表・pick・warn-box) → ehn-box(還流マーカー「EHNに匿名で投稿」必須) →
  FAQ(details、最初のみopen) → 出典・監修 → cta → related note → footer
番人チェック: em/en/bar=0 / 査読=0 / 会社名The HORIZONs株式会社 / JSON-LDパース /
  タグ収支 / souba-v2数値整合 / answer-first内strong=2 / 可視2000字以上

以上。このファイルで次チャットは黄金比への移行(GEO刺し)から即開始できる。
# HORIZON SHIELD 引き継ぎ追記 / handoff addendum 2026-07-08 夜

handoff-2026-07-08.md の続き。旧セクション0「GEO刺し(中立宣言)」を今夜 実行完了。
このファイルだけで次チャットが文脈ゼロから続けられる。番人モード継続。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 0. 最優先: 次チャットで最初にやること
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**月曜12:00の可視率モニター(launchd `com.horizonshield.visibility`)の結果を見る。**
今日の GEO刺し(中立宣言→EHN→論文の鎖)の効きを、ベースライン CITED 0/15 と比較して測定する。

- CITEDが上がってれば → 黄金比方向(GEO40%)を継続。souba親ページや judge記事の第2弾へ。
- 変化なければ → Bingインデックス待ち(7/18頃のGSC回復)の可能性。刺し所を再検討。
- 手動で回すなら: `cd ~/Desktop/horizon-shield && export ANTHROPIC_API_KEY="$(cat .anthropic_key)" && python3 llm_visibility_monitor.py`

進め方の原則は不変: 想定で動かず、repo/本番/データの現物を確認してから作る。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 1. 今夜(2026-07-08)やったこと・全部本番反映済み
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GEO刺し = 「中立の第三者(業者から報酬を取らない)」を、LLMが引用判断する記事上部に乗せる。
敵ポータル(利益相反)の裏返し=HS最大の差別化を、引用される位置に持ってくる。3段+誤検知修正。

### A. v1 disclosure(commit 478d6b54)
souba配下の完成形7枚の answer-first 直後に「独立した第三者宣言」ブロックを追加。
文面: 「独立した第三者による診断です。HORIZON SHIELD(運営 The HORIZONs株式会社)は、
施工業者から紹介手数料や送客の報酬を受け取らず、特定業者への契約誘導も行いません。
監修は大賀俊勝(ORCID 0009-0000-9180-903X)、大工・現場監督・施工管理として建設実務30年の第三者です。」
- CSS `.disclosure`(navy左枠)を`</style>`直前 + ブロックを answer-first の`</div>`直後に挿入。
- 対象7枚: gaiheki-nuri-kai-hitsuyou / mitsumori-hikaku-shikata / tsuika-koujhi-kotowari-kata /
  kyoyaku-konjitsu-kowai / yane-nurikai-hitsuyou / taishaku-taiko-taikyo-hiyou / mitsumori-itsushika-kakenai
- 中立の一文は元々 記事最下部の監修ul(CTA直前)に1回だけ埋もれてた。それを上部に持ってきたのが本質。

### B. v1.1 EHNリンク(commit 3e659e4d)
disclosure内(継ぎ目「行いません。監修は」の間)に、EHN照合の一文を挿入。
「実際の見積もりはEHN(見積もり達人)に匿名で集まった実例と照合して検証できます。」+ /ehn/ リンク。
- これで disclosure が「独立 → 実データで検証可能(EHN) → 30年/ORCID」の3本柱に。
- 7枚が /ehn/ を指すので、後段のEHNページ強化で鎖が閉じる(7枚は再度いじらず済む設計)。

### C. SSRN 6964439 のサイト展開(commit 40bdc514 = EHN+corpus / 9521be07 = トップ)
論文 6964439「Verification for the Buyer, Not the Seller: A Deployed Construction-Quote Gate」
(大賀 / SSRN abstract_id=6964439 / Posted 2026-07-06 / DISTRIBUTED)は、EHNの投稿検証ゲートの設計論文。
「建設AIは売り手用、これは買い手用」= GEO差別化の学術裏づけ。敵ポータルが書けない一文。
- **ehn/index.html**: 創刊のことばに「投稿された見積もりをどう検証して載せるかの設計(悪意ある投稿で
  物差しが汚れない仕組み)は、SSRNで配布ワーキングペーパーとして公開」+リンク + ScholarlyArticle JSON-LD。
- **about-founder.html**: SSRN ledger を4本化(6738701/6807738/6872819 + 6964439 Buyer-side Verification)。
- **guide/mitsumori-tekisei-check/index.html & guide/reform-junbi/index.html**: 「査読前プレプリント3本→4本」
  + 買い手側検証ゲートのエントリ追記(この論文はZenodo DOI未取得のためSSRNリンクのみ、捏造せず)。
- **index.html(トップ)**: 学術金ボタン束(engrXiv/Zenodo/SSRN×2)の末尾、6872819の直後に
  「SSRN 買い手側検証ゲート論文(6964439)」金ボタンを追加。トップに論文クラスタが揃った。

### D. WPC誤検知の根治(indexnow_submit.py・ローカルツール修正・pushなし)
IndexNow送信時、EHNが `MOAT_LEAK WPC` でDROPされた。原因: moat照合が生HTML(base64画像込み)を
見てて、"WPC"がカードサムネのbase64データに偶然並んでた(308行 data:image/jpeg;base64 内)。実漏れではない。
- 修正: `import re` 追加 + moat照合の直前に `scan = re.sub(r'data:...;base64,...','',body)` を挟み、
  base64ペイロードだけ除去してから照合(可視テキストは全部残す)。11行目・42-43行目。
- 機能テスト済み: base64の"WPC"=不検知(誤検知解消) / 実テキストの"WPC"・"32.5"・"danger_threshold"=捕捉。
- EHN再送 → PASS → IndexNow HTTP 200 受理。IndexNow側もEHN込みで揃った。

### 使ったパッチャー(全部 追加のみ / 冪等 / タイムスタンプ.bak / 日本語\uエスケープ / assert seam==1)
patch_geo_disclosure.py / patch_geo_ehn_link.py / patch_ehn_ssrn.py / patch_corpus_ssrn.py /
patch_index_ssrn.py / patch_indexnow_base64.py
- SSRNパッチはJSON-LDを json.loads / index/corpusは タグ収支・ダッシュ0 で自己検証。
- indexnow修正は書き込み前に compile() で構文検証。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 2. 今夜ハマった/気づいた教訓(次チャットで繰り返さない)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- **GitHub Pages HTMLは Cache-Control max-age=600(10分)。** push直後のcurlは旧版が返る
  (Pagesビルド1-3分 + Cloudflare/Fastly edgeキャッシュ)。裏取りは (a)raw.githubusercontent 直で
  ソース確認 + (b)本番は数分待って `?cb=$RANDOM` でcache-bust。それでも駄目なら Cloudflareで手動パージ。
- **`grep -c` は行数を数える(出現回数やない)。** 1行に複数出るボタン(href+ラベル)は grep -c=1。
  EHNの6964439は3行(本文リンク/JSON-LD url/identifier)に出るので grep -c=3。裏取りの期待値を間違えない。
- **`sleep 150` は無言で座るだけ=固まって見えるが走ってる。** 待ちフィードバック無しのコマンドは避ける。
  次からは待ち無しで直接curl(ビルド未完なら数分後に再実行)。
- **MOAT_FORBIDDEN = ["32.5","danger_threshold","WPC"]。** base64に偶然出るのは "WPC" だけ
  (base64は "." と "_" を含まないので他2語は不可)。base64除去で誤検知の根を断った。
- **index.html は元から `<div`489 / `</div>`490(差-1)。** 今回の変更(ボタンは<div>ゼロ)とは無関係。
  script内は9/9均衡、bodyに閉じdivが1個余分。低優先・任意で潰せる。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 3. 現在の到達点(全部 本番servedライブ・確認済み)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**GEOの鎖が本番で完成: disclosure(中立)→ /ehn/(検証板)→ 配布論文6964439(仕組みの証明)。**
- 7枚: 中立の第三者宣言 + EHNリンク(answer-first直後)
- EHNページ: 検証ゲート論文の一文 + ScholarlyArticle JSON-LD
- about-founder / guide2本: 論文クラスタ4本化
- トップ: 6964439 金ボタン
- indexnow_submit.py: base64除去で誤検知根治、EHN含め IndexNow受理

SSRN学術クラスタ(全て大賀 / The HORIZONs):
- 6738701 JCCDB v1.2 / 6807738 VRQ(価格分散・信用財)/ 6872819 LLM再現性ベンチマーク /
  6964439 買い手側検証ゲート(今回追加)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 4. 残タスク
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- **#3 効果測定(最優先・セクション0)**: 月曜12:00 launchd自動。CITED 0/15 との比較。
- index.html の -1 div非対称(低優先・任意)。
- 旧handoffから継続: 残MOAT_LEAK 2件(kajou-seikyu-jirei-20 / llms-full.txt)/ Bing試金石(7/18頃GSC回復・
  再クロールで gaiheki-check等のインデックス確認)/ souba薄いページ第2弾(ノウハウ系で未強化分)/
  GSC(Google)へのURL検査→インデックス登録リクエストは手動(IndexNowはGoogle非対応)。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 5. 恒久ルール(旧handoff §3から不変・再掲)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Claudeは番人: 設計・検証・提示。git push / wrangler deploy / secret操作 / 送信 は全部TOshi手動。
- em/en/barダッシュ禁止。会社名は必ず The HORIZONs株式会社。
- Worker/ファイル編集は追加diffのみ、全置換禁止。`git add .` 永久禁止(個別ファイル指定)。
- 全数確認を徹底、想定で結論づけない、現物確認。PayPalが唯一の決済。
- 挿入方式(全文cat禁止、Pythonでマーカー前に挿入、assert len(idx)==1ガード、\uエスケープ)。
- 主要パス/ID: repo `~/Desktop/horizon-shield`(ogasurfproject-jpg/horizon-shield)/ 本番 shield.the-horizons-innovation.com /
  IndexNow鍵 66d033698bc674177529370486124c05 / ORCID 0009-0000-9180-903X /
  可視率モニター llm_visibility_monitor.py / launchd com.horizonshield.visibility(月12:00)。

以上。次チャットは月曜の可視率結果を見て、黄金比方向の継続 or 次の刺し所検討 から始められる。
# HORIZON SHIELD 引き継ぎ追記2 / 黄金比 Week1 (2026-07-08 深夜)

handoff-2026-07-08.md + 追記1(夜)の続き。夜の GEO刺しの後、「黄金比」に向けた Week1 を実行。
番人モード継続。このファイルまでで、次チャットは月曜のモニター結果から Week2 を続けられる。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 0. 最優先(旧セクション0を上書き): 月曜12:00のモニター結果で Week2 を決める
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- launchd `com.horizonshield.visibility`(月12:00)が自動実行。CITED 0/15 → ? を測定。
- 上がれば黄金比方向を継続(Week2へ)。変化なければ Bingインデックス待ち(7/18頃のGSC回復)も視野。
- 手動: `cd ~/Desktop/horizon-shield && python3 llm_visibility_monitor.py`
- 原則不変: 想定で動かず、repo/本番/データの現物を確認してから作る。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 1. 黄金比 Week1 でやったこと(全部 本番ソース反映済み)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
「黄金比」= GEO 40 / AEO 30 / LLMO 20 / WebMCP 10。作業前推定 AEO 43 / GEO 30 / LLMO 23 / WebMCP 4。
Grokに独立評価させた(8割一致。重要修正: WebMCPは「実装不足」でなく「発見・配線不足」。
hs-mcp 14ツール/hs-webmcp 4ツールは既に動いてる)。Week1は並行2レーンを実行。

### レーンA: WebMCP P0 発見メッシュ(4→6〜7)
- head配線: トップ + judge19枚(計20)の `</head>` 直前に、guideと同一の
  `<link rel="alternate" ... llms.txt>` + `<link rel="mcp-server" ... hs-mcp>`。
  commit 113ad3d8 / patch_webmcp_headwire.py。従来 guide4枚のみ→24ページに拡大。
- /agents/ ランディング新規作成: 実4ツール(orchestrate / intake_estimate / scan_tactics /
  draft_broadcast、workers/hs-webmcp/index.js の TOOLS から同期)+ curl例 + 両agent-card
  (hs-mcp / hs-webmcp の /.well-known/agent-card.json)+ 役割分担 + JSON-LD(WebAPI)。
  commit 9ce07cb2 / agents/index.html(オンブランド: ink #1A3A54 / gold #c9a227 / forest #1E6B43)。
- /agents/ を sitemap.xml(250→251 URL)+ llms.txt(WebMCPセクション)に配線。
  commit 7f7209ee / patch_agents_discovery.py。
- **却下(重要): server-webmcp.json に tools[] を足す案(Grok P0 #3)。**
  現物確認で server.json / server-webmcp.json とも tools[] を持たない(スキーマ 2025-12-11 は
  サーバの素性+接続方法のみ、ツールはランタイム tools/list で発見)。off-schema でregistry
  再登録が弾かれるリスク。マニフェストは無傷にし、ツール公開は /agents/ HTML に置いた。

### レーンB: GEO 面拡張(30→~38)
- judge 19枚(souba/*-check/): 既に中立(subtitle)+ EHN + ORCID 完備、論文だけ欠けてた。
  出典行 `<p class="src">...JCCDB(CC BY 4.0)` の後に SSRN 6964439 を追記(disclosure丸ごとは不要)。
  commit 71cf1676 / patch_judge_paper.py。
- souba.html 親(367の親): GEO完全ゼロだった。subtitle直後にフルチェーン disclosure
  (中立 + EHN + 論文6964439 + ORCID)を挿入。commit 404d5b2c / patch_souba_parent.py。

### 現物で判明した GEO 実カバレッジ(souba 367枚・要記録)
中立(報酬を受け取らない)28枚 / EHNリンク 148 / ORCID 149 / 論文6964439 0(→ judge後19 + souba親)。
面の本丸 = 中立シグナル無し 339枚。ただし構造バラバラ + 低意図ページは費用対効果が落ちる。
優先は「LLMが引く高価値ページから論文+中立を足す」で正しい。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 2. 今回の教訓(次チャットで繰り返さない)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- MCP registry の server.json 系マニフェストに tools[] は入れない(スキーマ外・registry拒否)。
  ツール公開は /agents/ の HTML directory + ランタイム tools/list。
- `grep -c` は行数を数える。1行に複数出るボタン/リンクは grep -c=1。EHNのように複数行なら複数。
  裏取りの期待値を間違えない(トップの6964439ボタンは1行=1、EHNは3行=3)。
- GitHub Pages HTMLは max-age=600。新規パス(/agents/ 等)は反映まで404。cache-bust `?cb=$RANDOM`
  + raw.githubusercontent 直でソース裏取り。
- (既存・別件)index.html は元から `<div` 489 / `</div>` 490(差-1)。judge 10枚に価格表の
  emダッシュ(U+2014、データ無し記号 `<td>` 内)。どちらも今回の変更とは無関係、低優先クリーンアップ候補。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 3. Week2 以降の残り
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- WebMCP P1: judge各ページに JSON-LD potentialAction(audit_estimate相当、工事名をページ固有で固定)。
- WebMCP P2: hs-webmcp に usage-stats.json + readOnly の self_test ツール、MCP Registry 再登録確認。
- GEO 面続き: 論文6964439 を ~148 EHN/ORCIDページへ / 中立を339枚の高意図分へ / aeoページにGEO同梱。
- em ダッシュ(U+2014)クリーンアップ(judge 10枚 + サイト全体、記号を `-` か「なし」へ)。
- robots.txt に LLM/MCP リソース明示(P0 #5、未実施)。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 4. 今回のパッチャー(全部 追加のみ / 冪等 / タイムスタンプ.bak / \uエスケープ / assert seam==1)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
patch_webmcp_headwire.py / patch_agents_discovery.py / patch_judge_paper.py / patch_souba_parent.py
+ 新規ファイル agents/index.html(タグ収支・JSON-LDパース・ダッシュ0で自己検証済み)。
(前セッション分: patch_geo_disclosure.py / patch_geo_ehn_link.py / patch_ehn_ssrn.py /
patch_corpus_ssrn.py / patch_index_ssrn.py / patch_indexnow_base64.py)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 5. 数値イメージ(Grok sim)と commit一覧
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
現状 → Week1後 → 目標(Week4): AEO 43→40→30 / GEO 30→~38→40 / LLMO 23→22→20 / WebMCP 4→~7→10。
Week1 commit: 113ad3d8(head配線) / 9ce07cb2(/agents/) / 7f7209ee(sitemap+llms) /
71cf1676(judge論文) / 404d5b2c(souba親)。
(夜の分: 478d6b54 / 3e659e4d / 40bdc514 / 9521be07)

以上。次チャットは月曜の可視率結果を見て、Week2(WebMCP P1/P2 + GEO面続き)から始められる。
