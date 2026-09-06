# HORIZON SHIELD 引き継ぎ 2026-09-06 昼 v38 (論文1 SSRN 投稿・論文2 草稿と共著確定・semantic-abi adapter・entry 35/36・A2A witness 2)

**このファイル 1 つで、止まったチャットの続きから動ける。**

作成: 2026 年 9 月 6 日 12:25 JST
作成者: 番人(「停止した問題の引き継ぎ」チャット本人。Cowork、Mac にリンク済み、horizon-shield / jidec / mcp-conduct-register のフォルダにアクセス済み)
引き継ぎ元: 同チャットの 2026-09-06 00:20〜12:25 JST 分(途中 1 回コンテキスト圧縮)。それ以前は v35。
前の引き継ぎ: `HORIZON_SHIELD_引き継ぎ_20260905_共著確定_v35.md`(論文1 の v0.2 まで、鑑定書AI、社名修正)。**A2A 側は別チャットの v36 / v37追記 が正**で、本ファイルは A2A の中身には触れない(7 章の伝達分だけ)。矛盾する記述は新しい方が正。

---

## 0. 出所の申告

数字と sha は全部、TOshi が端末に貼った出力、TOshi のスクショ、番人が Mac のマウント越しに実ファイルを読んだ結果、番人が Mac の VM で harness を実走した結果、のどれか。推測で埋めた箇所は無い。
番人が実行したのはファイルの読み書き・ローカル検証・Mac の VM 内での harness 実走(offline のもののみ)だけ。git push / 台帳 append / SSRN 操作 / LinkedIn / GitHub の PR 操作は全部 TOshi の手。「送った」「押した」は TOshi の端末出力かスクショで確認済み。**確認済みのことを聞き直すな。**

---

## 1. 番人が守ること(v35 の 1 章に足す分)

- **Federico の SSRN 用メールアドレス**は SSRN の著者欄にだけ使った。**リポジトリにもファイルにも書かない**(本人と合意)。この引き継ぎにも書かない。
- **PR #2(trustless-ai/semantic-abi)は ETHOnline の審査期間が終わるまで閉じたまま。** 再開は Merlini の合図の後。理由は ETHGlobal のメンター(Pascal)の明文: 確定メンバー以外がコードを入れると失格になり得る。
- **論文で引くのは錨打ち済みの公開文書だけ。** Federico の DM は一切引用しない(論文1・2 とも、本人に明言済み)。
- **他セッション(A2A チャット)が同じ作業ツリーを使っとる。** 向こうの未コミット・未追跡ファイルに触らない。push が弾かれたら `git pull --rebase --autostash origin main`(`--autostash` 無しだと unstaged changes で止まる、今日 2 回止まった)。`git add .` 禁止、個別パスのみ。
- **VM から ledger.horizonshield.dev / gate には届かん(proxy 403)。** 台帳の確認は TOshi が curl して貼る。GitHub API は届く。
- **PDF は pandoc → HTML → wkhtmltopdf。** xelatex は xeCJK 無しで使えん。CSS の font-family に IPAPGothic を入れると 音 が U+97F3 として抽出される(Noto CJK だと U+2EB3 に化けた)。`ops/` の pdfbuild 手順は 3 章。
- **貼る前に数える**(語数・禁則文字・sha)。今日も全ファイルでやった。exact-match の置換スクリプトは count が 1 でなければ書かない、置換文に禁則文字があれば書かない、を型にした(`ops/paper_v03_*.py`、`ops/fed_sections_dashfix*.py`、`ops/post_ssrn_7419998.py`)。

---

## 2. 今日(09-06 00:20〜12:25 JST)の結論だけ

1. **論文1 を SSRN に投稿した。abstract 7419998、11:34 JST、審査中(completeness review)。** 二人著者、CC BY。v0.3 = commit 686a7182、5,995 語。PDF 9 頁、sha256 0cedbb9ac9aa61447495b9b3dc48c931930c1e402507a8ea70ff74ff1bb1d6c4。Federico は 10:39 JST に v0.3 を承認済み。
2. **entry 36 を追加した。** entry 34 の「spec だけから書いた」「参照実装の source は見ていない」を、Federico 自身の訂正(commit 7dc5bff8)と同じ言葉で狭める訂正記録。schema nenrin-ring-reimpl-match-v1-correction、claim 69158463e659d3b3d158d8068a0506ccc9101beeca6ab2acc5b87aec493edc9c、OTS pending。register README にも同じ訂正を日付付きで 1 行(ace2871)。
3. **論文2 の草稿を書いて公開した。** `papers/nenrin-coordinate/manuscript_v0.1.md`、v0.1 = ebd0603e、v0.2 ヘッダ = f2c39f4e(二人著者)。**Federico は 12:10 JST に共著を受諾。** 6 節と 4.3 の証人側は彼が 1 週間で書く。
4. **semantic-abi の HS adapter を作り、PR #2 を開いて、Draft にして、閉じた**(10:32 JST)。ETHGlobal の資格規則のため。中身は horizon-shield の `ops/semantic_abi_hs_adapter_20260906/` に全部ある。
5. **Federico が mcp.horizonshield.dev を A2A モードで測って witness を出した**(12:07 JST、wire 1.0 と 0.3 で PASS 5/5、sha da9289a1117598658d171ca89de03028ca497e54cfe9ad75aaad2f0075d7adff、pool に count 1 で確認)。9 月 mcp ring の witness 2。明日 00:30 UTC のバッチで entry になる。
6. 朝の定例: sync_headers OK(tip 965702)。claim register は C03・C14・C16 が FAIL。C03 と C16 は A2A 側の 0.3.2 以降の配備に属する(伝達済み、7 章)。

---

## 3. 論文1(SSRN 7419998)

- タイトル: Same File In, Same Bytes Out: Reproducible Conduct Records for Agent-Facing Services, Tested by an Independent Reimplementation
- 著者: Toshikatsu Oga(The HORIZ音s株式会社 / HORIZON SHIELD、ORCID 0009-0000-9180-903X)、Federico Blanco Sánchez-Llanos(所属行は本人の言葉 "Viper Labs (builds invinoveritas, a verification layer for autonomous agents)"。SSRN の機関一覧に Viper Labs が無いので SSRN 上は "Unaffiliated Authors")
- SSRN 分類: Software Engineering / Cybersecurity, Privacy & Networks / Artificial Intelligence / Information Technology & Systems(名称は SSRN 側の実物を検索して確定した。「〜 Alert」系ではない)。JEL: L15, L86, D82, C88。キーワード 12。ライセンス CC BY。
- 投稿シート: `ops/ssrn_submission_sheet_v03_20260906.md`(要旨 308 語。メールアドレスは意図的に載せていない)
- v0.3 で直したこと(番人側): 要旨・3.3・7・結論から「no access to the reference source」「from the specification alone」を全部落とした(Federico の 4.2 と同じ狭め方)。4.3 に entry 36 の段落、5.1 の p001 行、7 節に新しい限界(status ラベルが 2 つの区別を潰す: instrument failure と unreachable がどちらも held、determinism unmeasured と failed がどちらも pending。ring v2 で counted fields にするのが修正)。謝辞は二人と invinoveritas と semantic-abi 協働を名指しし、金銭の授受なしを明記。付録 B は entry 34 と 36 の記録を逐語で。3.4 と 4.3 に Bitcoin ブロック(32 = 965566、34 = 965627)。References 完成。
- Federico の指摘で直った事実: NENRIN_SPEC_v1.md は canonical form について沈黙(json.dumps / sort / canonical の語が無い)、Layer 3 の例示は 20 フィールド中 11。彼は 17:49 JST に register を clone して make_ring.py --verify をブラックボックスで走らせている(再実装 22:08 JST より前、論文初コミット 23:35 JST より前)。RFC 8785 §3.2.3 は UTF-16 code unit でソート(JS の既定)なので、JCS を採るなら変わるのは Python 側。
- 投稿後: manuscript ヘッダを「Submitted to SSRN … 7419998 … under SSRN review」に、llms.txt に Preprint の行を挿入(`ops/post_ssrn_7419998.py`、commit 1b556e10)。ファイル名 manuscript_v0.1.md は entry 36 と register が引いとるので変えない。
- PDF の作り方(再現用): pandoc で md → HTML、`ops/`(番人の作業では kantei/pdfbuild/paper.css)の CSS を当てて wkhtmltopdf。表の `<th\b` にクラス付け(`<thead` に誤マッチした事故あり)。成果物 `papers/nenrin-reproducibility/nenrin_reproducibility_v0.3_686a7182.pdf`。
- **live になったら**: SSRN からメールが来る(両著者)。(1) `ops/linkedin_post_paper1_live_20260906.txt`(350 語、entry 36 の狭めに合わせて書き直したもの。**9/5 の `linkedin_post_reimpl_20260905.txt` は "never seen my source code" で嘘になるので使わない**)を投稿。(2) Federico に URL を一行。(3) llms.txt の Preprint 行の「under SSRN review」を「posted」に(exact-match で)。

---

## 4. 論文2(coordinate integrity)

- ファイル: `papers/nenrin-coordinate/manuscript_v0.1.md`(ヘッダは v0.2)。タイトル: The Prover Does Not Choose the Coordinate: One Rule at Four Scales for Anchored Conduct Records。7,262 語(付録の JSON と表を含む。本文目標は 6,000 前後で、彼の 6 節が入ってから刈る)。
- 骨: 要旨 / 1 欠陥 / 2 先行技術と狭め / 3 一つの規則(Table 4: 四つの尺度を一枚に) / 4.1 record(join guard) / 4.2 population(census) / 4.3 time(v2 → v3.3、sources 追補、localheaders v1〜v3、refusals v1、本番の門は explorer 2 本の quorum で header set は読めない) / 4.4 instant(bucket = sha256(endpoint)[:4] % 7 の欠陥、透明性の手紙が exploit recipe でもあった件、salted commit-reveal、gate 0.3.0) / 5 harness(Table 1) / 6 証人側(Federico の枠、錨打ち済記録から起こした仮置き) / 7 配備 vs 設計(Table 2、正直さの背骨) / 8 限界 / 9 事前登録(9 月の derived verdict、第二者の census) / 付録 A 再現コマンド / 付録 B Table 3 + entry 30 の refusal record 逐語。
- 検証済み: Table 3 の 11 個の claim sha256 はリポジトリの実ファイルの sha256 と全一致(番人が Mac で再計算)。Table 1 の件数は harness 9 本を Mac の VM で実走: join 8、census 10、time probe 8、freshness v2 9、v3.3 22、localheaders 25、stream 8、p2p 16(loopback)、instant 17。gate の JS 26 は claim register C04 の実測。数字(3,820 / 478 / 182 と DNS seed 8 / 965,457 / 77,236,560 / 2.3 秒 / six blocks / reason code 4 種)は追補本文と照合済み。
- 直した事実: gate 0.3.0(601713a5、9/5 10:51 JST)は instants 追補の初版(8ec6efcb、10:40)の後、錨打ち版(9590496b、12:04、e228dfd8、seed 13:18)の前。worker.js が両 sha を記録している。「追補の錨打ち後に実装」と書いていたのを直した。
- 未完: Table 3 の Bitcoin ブロック高(25、27〜31、33)は投稿時に ledger から読んで埋める(ローカル .ots は 22・23・24・26 のみ Bitcoin 確定、他は pre-upgrade。26 は 965447)。6 節と 4.3 の証人側は Federico。彼の作業の型は論文1 と同じ: 彼の fork にブランチ → TOshi が `--no-ff` で彼のコミットとして merge → 番人がダッシュだけ直すコミット(スクリプトは exact-match pairs、count 1、禁則文字検査)。
- 設計文書: `ops/paper2_coordinate_outline_20260906.md`(構成、証拠台帳、TOshi の 6 決裁 = 全部番人推奨で確定)。
- 次: 彼のブランチが来たら、一次資料(錨打ち済 entry)と突き合わせてレビュー → merge → v0.3 → PDF(論文1 と同じ手順)→ SSRN(同じシート、分類は同じ 4 つで足りる)。

---

## 5. semantic-abi adapter と PR #2

- 上流: github.com/trustless-ai/semantic-abi(Federico・Merlini・Pavlo の ETHOnline 作品)。manifest.schema.json(component / author / declarations[{endpoint, consumes, establishes{authority_class, claim_type, scope}, does_not_establish[], issued_at か verification_time のどちらか一つ}])、12 クラスの open enum、runner evaluate.mjs が PAIR / BACKEND / run(vectors, adapters) を export。adapter は各自が書き、共有 checker は無い。
- 番人の成果物(horizon-shield 側が正): `ops/semantic_abi_hs_manifest_draft_20260906.md`(設計)、`ops/semantic_abi_hs_adapter_20260906/{README.md, manifest.json, adapter.mjs, vectors.mjs, demo.mjs, vendor/hs_gate_record_commitment.py}`。relation は content_addressed_decision_commitment(hash + Bitcoin anchor は署名ではないので relation 1 と分けた。README の open question 1)。vectors 6 本は gate の公開 git 履歴 patch52 前後(8a370fca 前、3077a482 修正、522d4208、0dcf1668 tri-state)を再生: PASS 3 / FAIL 3。FAIL 3 は過去の self-held 潰れ 1 と、現在のラベル範囲の潰れ 2(held、pending)。修正案は ring v2 の counted fields(論文1 の 7 節と同じ発見)。manifest は 6 宣言(第三者 /check は INDEPENDENT_JUDGMENT、self は INFRASTRUCTURE_ATTESTATION、verify_verdict は CRYPTOGRAPHIC_VERIFICATION、witness は INDEPENDENT_JUDGMENT、ring verify は INDEPENDENT_RECOMPUTATION、JIDEC は NOT_BACKDATED)。
- PR #2: fork ogasurfproject-jpg/semantic-abi、branch adapter/horizon-shield、commit eb6637f。01:41 Draft 化 → 10:32 JST **Closed**(コメントで parked と明記)。上流では PR #1(Pavlo、行フィールド名の改名 oracle_pair → expected_pair、backend → backend_conformance、05:04 JST merge)と PR #3(horizon-shield を post-ETHOnline に延期、05:05 JST merge)が入った。
- **再開時にやること**: rebase、demo.mjs の行フィールド名を新名に(adapter.mjs は PAIR しか import しないので無傷)、adapters/horizon-shield/README.md の競合解消、それから Draft → Ready。合図は Merlini / Federico から。

---

## 6. 台帳(JIDEC)の現在地

- entry 32: 8 月 ring 8 本の sha 一覧、Bitcoin block 965566(2026-09-05 04:53 UTC)。
- entry 34: Federico の Node 再実装一致、block 965627(14:58 UTC)。
- entry 35: witness batch 3(2026-09-06 00:30Z の日次バッチ)、OTS pending。
- entry 36: 34 の訂正記録(2 章)、OTS pending。seed は `workers/hs-ledger/seed_entry_nenrin_reimpl_correction_20260906.json`(作成スクリプト `workers/hs-ledger/make_seed_reimpl_correction.sh`)、claim は `workers/hs-ledger/claim_36.txt`(gitignored)。
- witness pool: da9289a1117598658d171ca89de03028ca497e54cfe9ad75aaad2f0075d7adff(Federico、A2A walk、mcp.horizonshield.dev、03:06:31Z)が pending 1 件。**明日 2026-09-07 00:30 UTC(09:30 JST)のバッチで entry になる。番号が付いたら Federico に番号と sha だけ送る。**
- 台帳の読み方(番人用): `/ledger/{n}` は既定 HTML(JSON は Accept ヘッダ)、`?format=raw` で bytes、`/ots` で証明。append は `zsh append_witness.sh <seed.json>`(token は隠しプロンプト)。
- OTS 未確定: 35、36、25、27〜31、33 の pre-upgrade .ots。確定は数日単位で自然に進む。論文2 の Table 3 を埋める時にまとめて読む。

---

## 7. Federico(LinkedIn DM のみ、姓は Sánchez)今日の糸

送った(番人が書き TOshi が貼った、全部 `ops/` に原文):
- 00:46 `fed_reply_adapter_20260906.txt`(adapter 枠を取る、Telegram 参加)、`fed_reply_review_20260906.txt`(彼の 4.2 / 6 節への事実 3 点)
- 01:0x `fed_reply_merge2_20260906.txt`(彼の訂正 2 コミットを merge、RFC 8785 の件了解)
- 01:46 `fed_reply_ethglobal_hold_20260906.txt`(PR #2 を Draft 化)
- 10:5x 前 `fed_reply_v03_final_20260906.txt`(v0.3 承認依頼)→ 10:39 承認
- 11:3x `fed_reply_ssrn_id_20260906.txt`(7419998)
- 12:0x `fed_reply_paper2_invite_20260906.txt`(論文2 の共著打診。「後で聞くと書いたが公開したので今聞く」と明記)
- 12:1x `fed_reply_witness_coauthor2_20260906.txt`(witness 確認 + 共著受諾への返事、commit f2c39f4e を明記。COMMIT の穴は sed で埋めて 39d47e50 で確定)

来た(スクショで確認):
- 01:06 訂正 push、RFC 8785 UTF-16 の注記
- 01:32 行フィールド改名の予告、merge 保留の依頼
- 02:44 conduct spec の URI を自分で再取得、sha 一致
- 03:03 ETHGlobal の規則(Pascal の文)、審査後に merge
- 10:17 PR 閉鎖への礼
- 10:39 v0.3 承認
- 12:01 SSRN 投稿への祝辞、consent メール待ち、A2A の sha 訂正と interop 修正への礼、"Sections first, agreed"
- 12:07 A2A walk 実施、witness 提出(6 章)
- 12:10 **論文2 共著受諾**、6 節と 4.3 証人側を entry から書き直す、1 週間

A2A チャットへ伝達済み(TOshi 経由、12:16): C03(/spec red_team 63 → 74)、C16(server.json / registry 0.3.1 → source 0.3.3、publish)、witness da9289a1 の pool 入り、main のこっちのコミット一覧、返信は重複させない。

---

## 8. 朝の定例(9/6 実施分)と claim register

- `sync_headers` OK、tip 965702。
- `verify_beacons.py` は `--history workers/hs-ledger/nenrin/ring-v1/history/*.json` が必須(番人の手順書に抜けとった、直した)。
- claim register 01:41 UTC: PASS 13、FAIL 3。C03(/spec の red_team 63 vs test 74)、C14(TWZRD 未測定、既知)、C16(server.json / registry 0.3.1 vs source)。C03・C16 は A2A 側へ伝達済み。C15(derived beacon なし、legacy fallback のまま)は論文2 の Table 2 と 9 節の事前登録の根拠。

---

## 9. 自動で動くもの(時刻は UTC / JST)

- 00:30 UTC(09:30 JST)毎日: witness pool のバンドル(空でなければ entry)。
- 月曜 08:30 JST: claim register。月曜 12:00 JST: 可視性モニター(17 問)。
- SSRN: 審査完了で両著者にメール(通常 1〜3 営業日)。
- OTS: calendar の upgrade は自然進行。

---

## 10. 決裁待ち・保留(TOshi)

- 論文2 の本文を彼の 6 節が入った後にどこまで刈るか(6,000 語目標)。
- Tuba Rafique へのコメント(`ops/linkedin_comment_tuba_20260906.txt`、任意)。
- GSC の確認(9/12 まで)。
- ring v2 の counted fields(instants_instrument_failed、instants_determinism_unmeasured)の実装時期。adapter の live mode。10 月の Ring 002 と Federico の blind rerun。

---

## 11. 今日作った・変えたファイル(横断)

- 論文1: `papers/nenrin-reproducibility/manuscript_v0.1.md`(v0.3、686a7182 → 1b556e10)、`papers/nenrin-reproducibility/nenrin_reproducibility_v0.3_686a7182.pdf`、`ops/paper_v03_myside_20260906.py`、`ops/paper_v03_part2_20260906.py`、`ops/paper_v03_part3_20260906.py`、`ops/post_ssrn_7419998.py`、`ops/ssrn_submission_sheet_v03_20260906.md`、`llms.txt`(Preprint 行)
- 台帳: `workers/hs-ledger/make_seed_reimpl_correction.sh`、`workers/hs-ledger/seed_entry_nenrin_reimpl_correction_20260906.json`、`ops/register_correction_apply_20260906.py`、mcp-conduct-register README(ace2871)
- 論文2: `papers/nenrin-coordinate/manuscript_v0.1.md`(ebd0603e → f2c39f4e)、`ops/paper2_coordinate_outline_20260906.md`
- adapter: `ops/semantic_abi_hs_manifest_draft_20260906.md`、`ops/semantic_abi_hs_adapter_20260906/`
- Federico: `ops/fed_sections_20260906.patch`、`ops/fed_sections_dashfix_20260906.py`、`ops/fed_sections_fix_20260906.patch`、`ops/fed_sections_dashfix2_20260906.py`、`ops/fed_reply_*_20260906.txt`(7 章)
- LinkedIn: `ops/linkedin_post_paper1_live_20260906.txt`(live 用)
- main のコミット(このチャット分): bc0ec786(merge 18862488)、f8a3f719、e51feb96(merge 84fed5ac + 7dc5bff8)、662ed4ad、686a7182、1b556e10、ebd0603e、f2c39f4e、0daf278b、39d47e50

---

## 12. 新しいチャットで最初にやること

1. `git --no-optional-locks log --oneline -15` で main の先頭を見る(A2A 側のコミットが乗っとる前提)。
2. 台帳: TOshi に `curl -s -H "Accept: application/json" https://ledger.horizonshield.dev/witness/pending` と `/ledger` の末尾を貼ってもらい、da9289a1 が entry になったか見る。なっていたら Federico に番号と sha だけ(番人が文を書く、TOshi が貼る)。
3. SSRN の live メールが来ていれば 3 章の「live になったら」を順に。
4. Federico のブランチ(論文2 の 6 節 / 4.3)が来ていれば、錨打ち済 entry と突き合わせてレビュー、merge は TOshi、ダッシュは番人のスクリプト。
5. 月曜なら claim register(08:30)と可視性モニター(12:00)の結果を読む。
