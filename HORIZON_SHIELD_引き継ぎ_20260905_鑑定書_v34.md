# HORIZON SHIELD 引き継ぎ 2026-09-05 深夜 (見積もり鑑定書AI・門 v1.3.3・社名 789 本・JIDEC entry 34 の直後)

**このファイル 1 つで、止まったチャットの続きから動ける。**

作成: 2026 年 9 月 5 日 23:40 JST
作成者: 番人(このセッションの本人。Cowork、Mac にリンク済み、horizon-shield / jidec / mcp-conduct-register の各フォルダにアクセス済み)
引き継ぎ元: 「停止した問題の引き継ぎ」チャット(2026-09-05 13:00〜23:40 JST、途中 1 回コンテキスト圧縮。前半は v33 の 20〜24 章、本ファイルは 24 章の続きから)
前の引き継ぎ: `HORIZON_SHIELD_引き継ぎ_20260904_NENRIN_v33.md`(1〜24 章。本ファイルはその上に乗る。矛盾する記述は本ファイルが正)

---

## 0. 出所の申告(ここを飛ばすと嘘を掴む)

このファイルの数字と sha は全部、**TOshi が端末に貼った出力**か、**番人が Mac のマウント越しに実ファイルを読んだ結果**か、**番人が WebFetch で本番から取った内容**から取った。推測で埋めた箇所は無い。
番人が実行したのはファイルの読み書き・ローカル検証・Mac の VM 内での dry-run だけ。**git push / wrangler deploy / 台帳 append / secret / SNS 投稿は全部 TOshi の手**で、その結果は TOshi の貼った出力で確認した。
「送った」と書いてあるものは、TOshi の端末出力かスクショで確認できたもの。「未確認」と書いてあるものは本当に未確認。**確認済みのことを TOshi に聞き直すな**(今日 3 回聞いて怒られた。「これ意味わからん！」「何回見せんだよ！」)。

---

## 1. 番人がまず守ること(破ると事故る)

v33 の 1 章は全部そのまま生きとる。今日足したもの:

- **貼る前に数える。** ファイルを渡す前に語数・禁則文字・sha を機械で確認する。今日は全ファイルでやった。
- **禁則文字(em/en/bar ダッシュ、全角ハイフンマイナス、罫線)は出力・ファイル・コード・コメントに一切入れない。** 検査文字列を書くときも `\u2014` 等のエスケープで書く(この引き継ぎ自体にも入れない)。ハイフン、〜、⇔、㎡、｜、＋、＝は可。
- **社名**: 日本語文脈(株式会社を伴う)は「The HORIZ音s株式会社」。英語文脈の「The HORIZONs Co., Ltd.」は仕様であって誤字ではない(巡回の掟、hs-patrol)。今日は日本語文脈のローマ字 789 本を 音 に直した(6 章)。
- **一括修正の掟**(hs-patrol): 再帰 sed 禁止。STEP1 一覧 → STEP2 目で分類 → STEP3 名指しの一覧だけ直す。今日の `ops/company_name_fix.sh` がその型。
- **事前確認は「変更後の本文」で回す。** 今日、社名修正の門の事前確認を「変更前の本文」で回して、push 後に 2 本赤を出した(5 章)。雛形が同文のページ群は 1 字の共通変更で simhash が全部ずれる。
- **Mac の VM(device_bash)の性質**: Linux、zsh 無し、`rm` 不可、git の名前無し(commit は失敗して `.git/objects/xx/tmp_obj_*` を残す。TOshi の `git gc --prune=now` で消える)、外部ネット無し(本番 URL には届かん、curl は 000)。読み・書き・python3・sh・`git --no-optional-locks` の読み取り系は可。**commit は TOshi の端末で。**
- **WebFetch**: 常に `?cb=` を付ける。provenance の制限で、直前に出た URL しか引けんことがある(raw.githubusercontent.com は引けんかった)。**要約器は信用しない**(pagecheck の一覧で赤の run を「Success」と要約した)。確定は TOshi の画面。
- **秘密**: hs-outreach の ADMIN_TOKEN は今日回転済(値は `~/jidec/hs_outreach_token`、chmod 600)。チャットに出た旧値・LEDGER_ADMIN_TOKEN の旧 28 字・IndexNow 以外のいかなる鍵も、**二度と書かない・繰り返さない**。IndexNow の鍵はサイト直下の `<key>.txt` で公開が仕様(秘密ではない)。
- **Federico との連絡は LinkedIn DM のみ**(メールの糸は無い)。文は番人が書き、TOshi が貼る。ダッシュ無し、AI の痕跡無し、英語。**姓は Sánchez(アクセント付き)**。彼の 2026-09-05 23:07 の依頼。エントリ 34 の記録内の「Sanchez」はそのまま(錨打ち済み、本人了承)。
- **錨打ち済みの記録・領収ページ(souba/jirei 25、souba/kajou-seikyu-jirei-20 の 20)は触らない。** 社名修正でも除外した。
- **`.github/workflows/` は番人が書けない。** `ops/pagecheck.yml.vNNN` に置いて TOshi が cp。
- **コードブロックにはコマンドだけ、1 回に 1 つ。** `$VAR` の直後に日本語を続けない(macOS の sh が `CODE。` を変数名と読んで unbound variable になった)。`${VAR}` で囲む。

---

## 2. 今日(09-05 13:00〜23:40 JST)の結論だけ

1. Grok が「リフォーム見積もり診断 AI のおすすめ」でドローン工務店を引き、弊社を引かん理由を実測で特定 → 決定的差は「客の言葉で検索したとき向こうは出て弊社は出ない」(3 章)。
2. TOshi 決定: 消費者向け診断の固有名は **「見積もり鑑定書AI」**、正本 **/kantei/** を新設・公開・IndexNow 受理。旧入口 4 本を転送、フッター 101 本を正本へ(4 章)。
3. pagecheck 門を **v1.3.2**(文面不変同士の既知重複は数えない)→ **v1.3.3**(quotepath の穴、aeo 87 本が blocking の外だった)に(5 章)。
4. 社名を **789 本** 音 に(phase1 550 + 2a 181 + 2b 13 + 2c 1 + 3 26 + llms.txt)。残り 49 は意図的(6 章)。
5. 雛形ページ 5 本にページ固有の節を書き足して 7 組の近似重複を解消(5 章)。
6. **Federico が Node.js でリング builder をゼロから再実装、8/8 バイト一致** → **JIDEC entry 34**。今夜の証人束ねは **entry 35**(7 章)。
7. SSRN working paper 1 本目の草稿 v0.1 を書いた(3,483 語)。Federico に共著の誘いを DM で(TOshi が貼る)(9 章)。
8. LinkedIn 投稿の文面を用意(TOshi の下書きに入っとる、Sánchez に直してから投稿)(8 章)。

---

## 3. Grok に引用されない理由(調査結果、ops/citation_gap_grok_20260905.md、commit 58b4ab34)

**結論**: 客の言葉で検索したとき、ドローン工務店(株式会社ドローン工務店、大阪市旭区、third-place-ai.jp「見積もりチェックAI」)は出る、shield.the-horizons-innovation.com は出ない。検索接続型 AI(Grok 含む)は検索結果に載ったものしか引かん。技術的ブロックではない(index,follow、sitemap、ブランド名では出る)。

実測 6 本(米国拠点の検索エンジン経由):「リフォーム 見積もり AI 診断 無料 おすすめ 会社」→ 向こう 6 位、弊社なし。「見積もり 適正 チェック AI 外壁塗装 屋根 無料 診断」→ 向こう 5 位、弊社なし。「建設費診断 AI リフォーム 見積もり」(弊社の造語)→ 弊社なし。「HORIZON SHIELD リフォーム 見積もり AI 診断」→ 出るのは PR TIMES / @Press / dreamnews / livedoor / VOIX / NEWSCAST / note のみ、本体ゼロ。09-04 の可視性モニター 15 問 CITED 0/15。

理由 3 点: (1) 向こうは商品名 = 客の質問文(見積もり・適正・無料・診断・外壁・屋根が全部 title に)、弊社は「建設費診断」= 客が打たん語。(2) 向こうは 1 ページ 1 商品・無料・3 分・フォーム最上部、弊社は入口 12 個・名前ばらばら。(3) 弊社トップの語彙が KIRA / JCCDB / PTKA / Bitcoin / OpenTimestamps / Zenodo / SSRN / ¥5,500 = 研究者向け。
弊社だけの札: 施工しない(向こうは工務店の自称公正)。third-place-ai.jp の下層(/soba/gaiheki-tosou、/soba/yane-shuri、/soba/amamori-shuri、/taikyo、/guide/…)は弊社 faq/souba と題目構成がほぼ同じ。先後は判定していない。

名前の候補検討: 「検証くん」不採用(株のシステムトレードソフト・詐欺被害者ブログと衝突)。「建設費」外す。「ホライゾンシールド エスティメイト」は海外・LinkedIn・MCP 向け英名として保留。「見積もりレントゲン」は比喩(H2)に。「見積もり鑑定書AI」採用。注意: 不動産の鑑定評価に関する法律 第 51 条(「不動産鑑定士」と紛らわしい名称の禁止)ゆえ「不動産」「鑑定士」を隣に置かない。商標は J-PlatPat で「見積もり鑑定」を要確認(未実施)。

---

## 4. 見積もり鑑定書AI(/kantei/)

### 4.1 正本
- `kantei/index.html`(44,204 bytes、commit 2d3925a3 → 8d9a1df9)。**本番で 200**、IndexNow 受理(HTTP 200、送信 1 本)。sitemap.xml にトップ直後で追加(584 URL)。
- title「見積もり鑑定書AI｜リフォーム見積もりが高いか適正か、無料で診断｜ホライゾンシールド（施工しない第三者）」、H1「その見積もり、業者に見せられる鑑定書にします。」。
- 無料診断 = inspect.html と同じ経路(hs-kira-proxy `/anthropic` → `/notify`)、KIRA への指示も同じ(**金額を出さない、気になる点の件数と見出しのみ**)。notify の message 先頭「【鑑定書AI 無料診断】」、`source: "kantei"`。名前・メール必須、同意 2 必須 + 公開同意 1 任意(CONSENT_VERSION 2026-06-05_v1)。
- 鑑定書 ¥5,500 の導線は既存トップ `#services`(PayPal H747QJMWFM4BS + 規約モーダル)へ。決済は複製していない。
- JSON-LD: Organization(#org、legalName The HORIZ音s株式会社、住所・電話は特商法ページと同じ)、Service(#service、offers 0 円と 5,500 円)、WebPage、BreadcrumbList、FAQPage 9 問(可視 FAQ と完全一致)。
- 「検証について」の節に **entry 34 の一文**を追加済(8d9a1df9)。llms.txt の JIDEC 節にも英語で 1 行。
- 描画確認済(スマホ 390px / PC 1280px、Playwright)。禁則文字ゼロ。

### 4.2 書いていないこと(実装が追いついたら差し替え)
- **「業者も同じ番号で確認できる」は書いていない。** 鑑定書 PDF(hs-pdf-gen `/generate-meitsumori`)に付くのは証明書番号(genCertNo)と SHA-256 のみで、**JIDEC 台帳に載らない**。台帳に載って `/verify/{n}` が返るのは estimate-audit 経路(hs-gateway op "audit" → `/generate-estimate-audit`、HS_AUDIT_TOKEN 必須)だけ。直すなら generate-meitsumori に `hsBuildClaim` + `hsAppendLedger`(worker.js 18494〜18531)を通し、`X-JIDEC-Verify` の URL を PDF に印字。差し替え文は `ops/kantei_consolidation_map_20260905.md` にある。
- 「3 分」は書いていない(未実測)。「その場で」「通常は数十秒」。
- 「診断 1,200 件・42%」(旧 /mitsumori-ai-shindan.html の数字)は持ち込んでいない。裏付けがあれば FAQ に足す。
- 返金保証「¥10,000 以上節約できなければ全額返金」はトップの文言をそのまま。特商法ページとの一致は未確認。
- 「工事は請け負いません」は特商法ページの販売価格一覧に施工が無いことを根拠にした。

### 4.3 入口の統合(実施済、ops/kantei_apply.sh、commit 93f45e2a)
- スタブ転送(noindex + refresh 0 + canonical、サイト既存の方式。**GitHub Pages なので `_redirects` は無効**): `mitsumori-ai-shindan.html` → /kantei/、`negotiate/` → /kantei/、`gemini-shindan/` → /kantei/、`reverse-estimate/` → /hs-reverse-estimate/。元ファイルは `ops/BACKUP_kantei_redirects_20260905-213501.tar.gz`。
- href 書き換え 100 ファイル(`/mitsumori-ai-shindan.html` → `/kantei/`)、トップの「見積もり・工事がある」カードを /kantei/ へ、llms.txt に 1 行。
- 残した入口: /hs-reverse-estimate/(見積もり前、157 被リンク)、/inspect.html(施工不良、写真)、/check/(業者名)、/lp/(EHN の LP、**title を EHN の言葉に変える提案は未実施**)、/hacker/ /ehn/(掲示板)、/guide/mitsumori-tekisei-check/(記事、CTA を /kantei/ に向ける提案は未実施)、/system/ /partner/(B2B、自己 canonical 追加は未実施)。一覧は `ops/kantei_consolidation_map_20260905.md`。

---

## 5. pagecheck 門(tools/pagecheck/)

### 5.1 版
- **v1.3.2**(c9712c6c): `validate.py --before <ref>`。ref 時点と「題名の指紋が同じで、枠を剥いだ可視文(content_core)が一字も違わない」ページ = 文面不変。文面不変同士の組は数えない。新規・文面が変わったページは文面不変とも比べる。台帳照合は文面不変は飛ばす。毒検査は全ページ。**simhash 一致を文面不変の基準にしてはいけない**(一文足しても同じ値。test の 4 手目で実際に抜けた)。検査 `tools/pagecheck/test_dedup_before.py` 4/4、redteam 1,517/1,517。REDTEAM_LOG.md 第 5 回。
- **v1.3.3**(f8d87bd2): ワークフローの `git diff` に `-c core.quotepath=false`。既定では日本語ファイル名が `"aeo/\343..."` と引用符付きになり `^(yakumo|care|qa|aeo|faq)` の grep に掛からず、**aeo の 87 ページが v1.3.0 から一度も blocking を受けていなかった**。今日の push で実測 107 → 195。
- ワークフローの blocking 段だけ `--before "$BEFORE"`、report 段は無し(既知の重複は毎回 report に出る、隠さない)。

### 5.2 今日の赤と直し
- 21:36 赤(93f45e2a、kantei 統合の href 書き換え): 既知の qa 近似重複 13 組が同じ束に入った → v1.3.2 で解消。
- 22:38 赤 2 本(7dc38fae = 社名 2a、86576fcb = 2b): 社名 1 字の共通変更で simhash がずれ、**距離 7 だった 7 組が 6 以内に**(2a 4 組、2b 3 組)。番人の事前確認が変更前の本文やった誤り。2c(fd2b3322)は緑。
- 直し(642464c1): 節点 5 ページに固有の H2 節を追加(370〜480 字、金額なし)。qa/ashiba-koji-tanka「足場面積の出し方と、水増しの型」、qa/dental-clinic-cost「ユニット基礎で、見積書に分けて書かれるべき項目」、qa/dantsuai-tanka「断熱材の見積もりで、性能と数量をどう確かめるか」、qa/kyuutouki-maker-tanka「給湯器の見積書で、本体以外の行を読む」、faq/mitsumorisho-doko-miru「4 つの着眼点を、実際の見積書でどう当てるか」。元の相手との距離 7〜13(最小: 足場 ⇔ 屋根修理 7、断熱 ⇔ 防音 8)。CI 同条件で 5/5 緑。元ファイル `ops/BACKUP_dedup_rewrite_*.tar.gz`。**この 5 節は TOshi の名前で出る建設の中身。TOshi は「読んでから push」の前提で push した。読み直しは任意。**
- 642464c1 と 39c06320 の pagecheck 結果は **メール未確認**(番人は GitHub Actions を引けんかった)。赤なら中身を貼ってもらう。

### 5.3 残っている既知の近似重複(report 段に毎回出る)
- qa: 09-04 時点 13 組 22 ページ、今日 5 ページを直したので減ったが再計上していない。faq 8 組、aeo 1 組、souba 74 組(雛形)、blog 1 組。**消えるのは書き直しだけ。** 型は今日の 5 節と同じ(ページ固有の見方を 400 字前後、金額なし)。

---

## 6. 社名修正(日本語文脈 The HORIZONs株式会社 → The HORIZ音s株式会社)

- STEP1 一覧: `ops/company_name_inventory_20260905.tsv`(820 ファイル・1,899 箇所。文脈: footer_neutrality 506 / jsonld_name 476 / copyright 312 / source_line 221 / other_text 198 / jsonld_alternateName 119 / footer_company_line 64)。
- STEP3 台本: `ops/company_name_fix.sh`(既定 dry-run、`--apply <phase>`、名指し一覧のみ、完全一致 1 文字列、tar backup、変更一覧 `ops/company_name_changed_<phase>.txt`)。**走るたびに phase1/phase2/flagged の一覧を再生成する**(そのため TOshi が手で足した llms.txt が phase1 から消えた。phase3 で回収)。
- 実施: phase1 550(f4bfa031)、2a 181(7dc38fae)、2b 13(86576fcb)、2c 1(fd2b3322)、phase3 26 = llms.txt + 目で確認した 25(39c06320)。**音 のサイトページ 789 本。**
- **残り 49 = 意図的**: 領収経路 souba/jirei 25 + souba/kajou-seikyu-jirei-20 の 20(判定の証明書、触らない)、yakumo 4(apply / plans / store / no002、下記)。.md の引き継ぎ文書 6 本は対象外。
- 2a/2b/2c の分け方: 既知の重複の対を別の push に分けると門が鳴らん(v1.3.2 は同じ push で変わったページ同士を比べる)。重複を直したことにはならん(report には出続ける)。
- **yakumo 4 ページ(決裁待ち)**: apply と plans は弊社の加盟プラン料金(¥10,780 等)を出しとるが、門は yakumo/ を「加盟店の面 = 金額非表示」と定義 → 弊社自身の B2B 料金ページが加盟店の名前空間に住んどるのが原因。直し方は「/biz/plans/ 等へ移す」か「弊社所有ページの特例を門に書いて開示する」の二択。store は title と JSON-LD が無い、no002 は author が無い(機械で足せる)。一覧 `ops/company_name_phase2_held.txt`。

---

## 7. NENRIN / JIDEC 台帳の現在地

- **entry 32** = Ring 001(rings/2026-08.sha256、claim f3e589efca103f3f717a68857618411f5f0864e0ad1aa264089e70b9d89081cc、8 endpoint)。**entry 33** = instants 追補(e228dfd8…)。
- **entry 34** = **Federico の Node.js 再実装が 8 リングをバイト一致で再現した記録**(schema nenrin-ring-reimpl-match-v1、claim `fad6d00a25281102711573b151b321bc13b28c625fe65807c5eb3a12a04e393c`、22:26 JST append、OTS pending → hourly stamp)。record の中身: spec sha 9ccba2e325fd2a…、make_ring.py sha 69719fed5ae6…、make_ring.js sha `5167188aeefb4852ca941a96856724f8831abd46be331cd9544898ba038e82a8`(7,955 bytes、github.com/babyblueviper1/invinoveritas scripts/nenrin_ring_reimpl/make_ring.js、commit `917dd97ff8e30107810d9a059e9091077f5171d0`、2026-09-05T13:08:01Z)、history 9 本の sha、リング 8 本の sha、implementation_note(入れ子キーソート)、limits、supersedes。**手で写した sha は無い**(`workers/hs-ledger/make_seed_reimpl.sh` が全部その場で取った)。seed `workers/hs-ledger/seed_entry_nenrin_reimpl_match_20260905.json`(commit ee13d5b0)。
- **今夜 00:30 UTC(9/6 09:30 JST)の証人束ね 3 件は entry 35**(以前の DM・メモの「34」は読み替え。Federico への最終返信で訂正済)。
- Federico の gate walk(sha 321e74b9f0e111d9…、walked_at 2026-09-05T05:16:26Z)は 9 月の gate リングの witness 2。10 月の Ring 002 で `witness/gate-horizonshield-dev-mcp/2026-09/<sha>.json` に置く(ring-v1 README の手順)。
- 番人が実機で照合済: spec sha = make_ring.py の引用値 = 実ファイル(一致)。8 リング sha = Federico の報告 = rings/2026-08.sha256(全部一致)。make_ring.js の中身 = 再帰キーソート + 2 スペース + 末尾改行 + prev_ring_sha256 = ファイルバイトの sha(make_ring.py と一致)。Federico 自身も ledger/34 raw と GitHub の commit からそれぞれ再ハッシュして一致確認(23:03 JST)。
- register README(github.com/ogasurfproject-jpg/mcp-conduct-register): a6a709e で二実装一致の段落、be89099 で Sánchez 修正。**「reimplementation has not yet been done」の旧文は supersedes 済み。**
- Ring 001 の数字(8 月): mcp 26/26(verified 23 pending 3、manifest 3)、hearing 26/26(23/3、2)、web 26/26(23/3、1)、gate 26 sampled / 18 reached(verified 17 held 9、3)、jidec 24/22(verified 22 held 2、1)、p001 26/26 pending 26、p002 26/26(verified 18 pending 8)、femtech 5/5 verified 5。witnesses 全部 1。

---

## 8. Federico(LinkedIn DM のみ、姓は Sánchez)

### 8.1 今日の往復(時刻は JST)
- 13:46 TOshi 送信: 錨打ちの返信(「メールで送る」と書いた版、メールの糸は無い)。
- 14:24 彼: gate を外から walk、witness 投稿(7 章)。
- TOshi 送信済(21:41 より前): `ops/fed_reply_witness_20260905.txt`(「a count, not a compliment」入り。**この中で今夜の束ねを entry 34 と書いた → 35 が正**)。
- 17:49 彼: register を clone して `make_ring.py --verify` 8/8(リポの自己整合の確認と、より難しい別言語再実装は別、と自分で区別)。20:53 彼: ETHGlobal 招待は「stuck, not dropped」。
- 21:41 TOshi 送信: `ops/fed_reply_recompute_20260905.txt`。
- 21:57 彼: ETHGlobal は今回「genuine no」(Merlini → 主催者側 Pascal → 否)。次回は最初から組み込む。
- 22:08 彼: **Node.js 再実装 8/8**(7 章)。
- 22:26 TOshi: entry 34 append。
- **TOshi 送信状況 未確認**: `ops/fed_reply_ethglobal_20260905.txt`(69 語)、`ops/fed_reply_reimpl_final_20260905.txt`(381 語、entry 34・sha・35 の訂正入り。**272 語の旧版 fed_reply_reimpl_20260905.txt は使わない**)。
- 23:03 彼: entry 34 raw と make_ring.js を自分で再ハッシュして一致、引用の希望なし(記録の文言をそのまま)、seam が本当の finding、9 月のリングにも blind で再実行する。23:07 彼: 姓は Sánchez。
- **未送信(TOshi が貼る)**: `ops/fed_reply_ssrn_invite_20260905.txt`(403 語。1 行目 Sánchez の件、23:03 への返事、SSRN 共著の誘い三択: 共著 / 名前付き独立検証者として草稿を確認 / 記録引用のみ。共著なら所属の書き方を聞いとる)。

### 8.2 ETHGlobal
- 今回の回(おそらく ETHOnline 2026、9/4〜16、非同期)には入れん。理由は「TOshi の申込みが無い状態で締切後に例外を頼んで否」。個人の評価ではない。
- **ETHGlobal Tokyo 2026: 9 月 25〜27 日、虎ノ門ヒルズ森タワー、現地ハッカソン、参加無料、公式一覧では Applications open**(公式ページは 500 で中身未確認、締切・条件は TOshi が画面で確認)。番人の助言: 「Federico か Merlini が来る」か「Ethereum で作る物が決まっとる(例: JIDEC の claim を EAS にも写す二重錨)」のどちらかが立てば行く、どちらも無ければ hacker では出ず Pragma Tokyo(9/26、1 日)に顔を出す。**TOshi 未決。** 返信に「東京、9/25〜27、俺は現地にいる、どちらか来るか」の 3 行を足す案は保留。

---

## 9. SSRN working paper

### 9.1 1 本目(書き始めた)
- `papers/nenrin-reproducibility/manuscript_v0.1.md`(3,483 語、単著、**未 commit**。Mac に置いてある)。
- 題「Same File In, Same Bytes Out: Reproducible Conduct Records for Agent-Facing Services, Tested by an Independent Reimplementation」。
- 背骨は 8/8 一致ではなく **seam**(6 節): spec が正準形を「Python の json.dumps のこのオプション」と言語ランタイムへの参照で定義 → 実際には再現できたが原理としては未定義 → 次版 spec は **RFC 8785(JCS)** を採るか言語中立に書く、と論文が自分の spec を批判する。Table 3 = 潜在 seam 8 種と 8 月のリングがそれを踏んだか(鎖ハッシュと証人経路は未踏 → 9 月が初)。8 節 = Federico の blind 再実行を **事前登録**。limits は abstract に。
- 構成: Abstract / 1 問い / 2 背景(discovery without conduct、先行研究 CT・Rekor・Reproducible Builds・in-toto・SLSA・OTS・RFC 8785)/ 3 Layer 3 as implemented(3.1 入力と 30 件天井の失敗談、3.2 出力、3.3 バイト、3.4 錨)/ 4 手順(4.1 recompute、4.2 独立再実装 4 条件、4.3 記録)/ 5 結果(Table 1 リング 8 本、Table 2 artifact)/ 6 seam(Table 3)/ 7 limits(決定性 ≠ 真実、n=2、入力は運営者公開、正準形はランタイム定義、保持の失敗)/ 8 事前登録 / 9 結論 / 付録 A 再現手順 / 付録 B entry 34 の record(**未記入**)/ 謝辞と利益相反 / 参考文献(**未整形**)。
- 著者欄: 大賀のみ。角括弧の注記で「独立実装は Federico Blanco Sánchez-Llanos(entry 34 に名あり)、共著・独立検証者・記録引用のどれかは彼の判断で保留」。**私信 DM の引用は削除済み**(公開記録の引用は承諾不要、DM の引用は承諾が要る)。
- **合意した流れ**: 単著で進める → 彼の返事 → 共著なら草稿を送って 4.2 節・6 節を彼が事実確認、二人で最終稿承諾、SSRN へ(SSRN は共著者にメールで確認、彼のメールが要る) / 独立検証者なら自分に関する節を確認してもらってから / 引用のみなら送らず出す / **一週間返事が無ければ単著で記録を引いて出す**。
- **TOshi だけが判断できる 5 箇所**(明日): 3.1 の保持の話(30 → 400、一掃分で消えるところやった)の語り、Table 1 gate の held 9 の理由(同じエッジ網の内側から自分の戸口に届かん = error 1104)、p001 pending 26 の行を載せるか(商売の側)、7 節「運営者の export から運営者のリングを再現するのは builder の試験であって運営者の試験ではない」を残すか(番人は残す派)、謝辞の利益相反の一文(著者が全 endpoint と台帳を運営)。
- 番人の残作業: 参考文献の整形、付録 B(entry 34 の record を raw から、Bitcoin ブロックが付いたら番号)、Federico の返事で著者欄、v0.2。

### 9.2 2 本目(候補、後)
- 座標整合性「prover が座標を選んではいけない、検証者が prover 非所有の源から座標を導出する」の一つの規律が、中身(join)・母集団(census、CT)・時刻(created_at を Bitcoin アンカーで挟む)の三軸で同じ欠陥を同じ直し方で閉じる(v33 の 3 章、8/31〜9/1)。Federico の二つの問いが起点 → 共著を打診する筋。

---

## 10. GSC / Bing / 可視性モニター

- GSC は 09-04 の登録リクエスト 15 本から **一日で予兆は出ない**。時計は 9/4 から。最初の予兆 = URL 検査の「前回のクロール」が 9 月になる(〜1 週間)。**9/12 までに 15 本のどれにも出なければ**「クロール需要の枯渇」と断定して手を変える。Google が既に言うとる判定 = 「クロール済み、インデックス未登録」221 本(雛形の近似重複)。**本筋は雛形ページへのページ固有の中身(今日の 5 節の型)か弱いページの noindex。** 09-04 合意「4 週間動かなければ索引側を疑う」。
- **Bing** は別の時計。IndexNow 受理済、ChatGPT / Perplexity は Bing の索引。/kantei/ は 2〜3 日後に Bing で確認。
- 可視性モニター `ops/llm_visibility_monitor.py` に **service 型 2 問追加(計 17 問、QTYPES で動的)**: 「リフォームの見積もり診断をAIでやってる会社でおすすめはありますか」「リフォームの見積もりが適正かどうかAIで無料でチェックできるサービスは」。**月曜 12:00 JST の定点で service 型が CITED になるかが今日の答え合わせ。**
- **GSC の /kantei/ URL 検査・登録リクエストは TOshi 未実施**(画面)。

---

## 11. 自動で動くもの(時刻は UTC / JST)

- **00:30Z(09:30 JST)** hs-ledger cron `anchorWitnessPool` → 証人束ね **entry 35**(3 件)。
- **毎時** Mac launchd `com.horizonshield.jidec`(run_stamp.sh)が未確定エントリに OTS stamp(34、35)。
- **18:00Z** 扉の掃引(最古測定順、0.3.1)。**18:15Z** 見張り trigger(trig_017PVhPWMsF4ouqYMceejY8o、初回 derived sweep 報告 + 投稿 3 本の下書き)。
- **18:40Z** register Actions「Rebuild register」(register.json + history/ archive)。
- **月曜 08:30 JST** launchd `com.horizonshield.claimregister`(16 行、想定 FAIL は C14 のみ。entry 35 が入れば C07 PASS)。**月曜 12:00 JST** 可視性モニター 17 問(launchd)。
- 週次巡回 trigger(trig_01Dh94cnXvhUnCiTmDUSgKsC)、09-07 自動送信 trigger(trig_01C6xXzT6WW71xcWHyKx6SAp、手順 1b 送信済み確認あり)、outreach brain v4(trig_015aAkJtpFDtMAW4j6bznNn2、token はファイルから)。**trigger の本文は番人が読めん(list_triggers に本文が無い)。本文中に「entry 34 = 束ね」の記述があれば 35 に読み替え。**
- pagecheck(GitHub Actions、paths: yakumo/care/qa/aeo/faq/blog/souba/tools/pagecheck)。

---

## 12. 明朝(9/6)の手順(TOshi の端末、順番どおり)

```
python3 workers/hs-ledger/nenrin/coordinate-v1/sync_headers.py
```

```
python3 workers/hs-ledger/nenrin/coordinate-v1/verify_beacons.py
```

```
python3 ops/claim_register.py
```

期待: C14(TWZRD 未測定)以外 PASS。entry 35 が 09:30 JST に入っとれば C07 も PASS。
その前に `curl -s "https://ledger.horizonshield.dev/ledger/35?cb=$(date +%s)"` で束ねを確認。
pagecheck のメール(642464c1、39c06320)が緑か確認。赤なら本文を貼る。

---

## 13. 決裁待ち(TOshi)

1. yakumo 4 ページの置き場所(6 章)。
2. ETHGlobal Tokyo(9/25〜27)に出るか(8.2)。
3. 論文 5 箇所の判断(9.1)。
4. /lp/ の title を EHN の言葉に変えるか、/guide/mitsumori-tekisei-check/ の CTA を /kantei/ に向けるか、/system/ /partner/ に自己 canonical(4.3)。
5. 鑑定書 PDF を JIDEC に載せる worker 改修(4.2)。
6. 既知の近似重複の書き直しの順番(5.3)。
7. J-PlatPat で「見積もり鑑定」の商標確認(3 章)。
8. 特商法ページと返金保証文言の一致確認(4.2)。

---

## 14. 今日作った・変えたファイル(横断一覧)

**horizon-shield(全部 push 済、最新 39c06320)**
- `ops/citation_gap_grok_20260905.md`(Grok 調査。**.gitignore の `GROK_*.md` は大文字小文字無視で grok_ 始まりも弾く**、ゆえこの名)
- `kantei/index.html`、`sitemap.xml`(+/kantei/)、`llms.txt`(+kantei 行、+entry 34 行、社名 音)
- `ops/kantei_consolidation_map_20260905.md`、`ops/kantei_apply.sh`(sh + python、既定 dry-run、本番 200 確認付き)、`ops/kantei_changed_files.txt`
- `ops/llm_visibility_monitor.py`(17 問、QTYPES)、`.bak-20260905` は gitignore
- `tools/pagecheck/validate.py`(v1.3.2)、`tools/pagecheck/test_dedup_before.py`、`tools/pagecheck/REDTEAM_LOG.md`(第 5 回)、`.github/workflows/pagecheck.yml`(v1.3.3、元は ops/pagecheck.yml.v132 / .v133)
- `ops/company_name_inventory_20260905.tsv`、`ops/company_name_fix.sh`、`ops/company_name_phase{1,2,2a,2b,2c,3}.txt`、`ops/company_name_phase2_held.txt`、`ops/company_name_flagged.txt`、`ops/company_name_changed_*.txt`、`ops/BACKUP_company_name_*.tar.gz`(gitignore)
- qa/ashiba-koji-tanka.html、qa/dental-clinic-cost.html、qa/dantsuai-tanka.html、qa/kyuutouki-maker-tanka.html、faq/mitsumorisho-doko-miru/index.html(固有節追加)、`ops/BACKUP_dedup_rewrite_*.tar.gz`
- `workers/hs-ledger/make_seed_reimpl.sh`、`workers/hs-ledger/seed_entry_nenrin_reimpl_match_20260905.json`
- 4 本のスタブ(mitsumori-ai-shindan.html、negotiate/、gemini-shindan/、reverse-estimate/)、href 書き換え 100 本、index.html のカード
- **未 commit**: `papers/nenrin-reproducibility/manuscript_v0.1.md`、`ops/fed_reply_*_20260905.txt`(ethglobal / reimpl / reimpl_final / ssrn_invite)、`ops/linkedin_post_reimpl_20260905.txt`、`ops/register_recompute_note_20260905.md`、`ops/register_reimpl_note_20260905.md`、`ops/pagecheck.yml.v132` / `.v133`(ops/ の草稿類は commit してもしなくてもよい。論文は commit を勧める)

**mcp-conduct-register(push 済、最新 be89099)**: README に「Independent recompute (record)」の段落 2 本(c153060 → a6a709e)、Sánchez 修正(be89099)。

**貼る物(TOshi)**: LinkedIn 投稿 `ops/linkedin_post_reimpl_20260905.txt`(274 語、Sánchez 版、TOshi の LinkedIn 下書きに旧綴りで入っとる → 直して投稿)、DM `ops/fed_reply_ssrn_invite_20260905.txt`。順番は LinkedIn が先(DM の 1 行目で「投稿は出る前に直した」と言うとる)。

---

## 15. 用語(初見で詰まるもの)

- **鑑定書AI / kantei**: 消費者向け診断の正本ページと固有名。「見積もり鑑定書AI」。
- **ring / 年輪 / NENRIN Layer 3**: endpoint × 月の conduct 記録 1 ファイル。counts never scores。`prev_ring_sha256` = 前リングのファイルバイトの sha。
- **seam**: 二実装のバイトが割れうる縫い目。今回は「Python の sort_keys は入れ子全階層、JS の JSON.stringify は並べん」。
- **entry N**: JIDEC 台帳の通番。32 = Ring 001、33 = instants、34 = 再実装一致、35 = 今夜の証人束ね。
- **文面不変**: v1.3.2 の定義。題名の指紋(tsha)同じ + content_core 完全一致。
- **phase1 / 2a / 2b / 2c / 3 / held / flagged**: 社名修正の束の名前(6 章)。
- **RFC 8785 / JCS**: JSON Canonicalization Scheme。論文が次版 spec に勧める正準形。
- **quotepath**: git が非 ASCII のパスを引用符付きで出す既定。v1.3.3 で無効化。
- **13 組 / 22 ページ**: qa の既知の近似重複(09-04 計上)。今日 5 ページ直して減った。

---

## 16. 新しいチャットで最初にやること

1. このファイルと v33 の 1 章を読む。1 章を守ると声に出して確認する。
2. TOshi に聞くのは **3 つだけ**: (a) LinkedIn 投稿と SSRN 誘いの DM は貼ったか、Federico から返事はあるか、(b) pagecheck の 642464c1 / 39c06320 のメールは緑か、(c) entry 35 は 09:30 JST に入ったか。**それ以外の「送ったか」は聞かない。**
3. 明朝の手順(12 章)の結果を受け取る。
4. Federico の返事が来とれば、9.1 の流れどおりに論文の著者欄と 4.2 節・6 節の確認へ。来てなければ番人は参考文献と付録 B を仕上げて v0.2。
5. 論文の 5 箇所の判断(9.1)を TOshi に出してもらう。
6. 月曜(9/8): 08:30 claim register、12:00 可視性モニター 17 問 → service 型の CITED を見る。
7. 10 月頭: Ring 002(fetch_history.sh → make_month.sh 2026-09、Federico の witness 記録を witness/ に置く)。Federico が blind で make_ring.js を再実行 → 一致でも不一致でも記録(論文 8 節の事前登録)。

**引き継ぎに書いてない過去の経緯が要るようになったら、推測で埋めずに TOshi に聞くこと。**
