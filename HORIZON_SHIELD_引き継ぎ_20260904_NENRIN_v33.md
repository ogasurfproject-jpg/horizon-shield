# HORIZON SHIELD 引き継ぎ 2026-09-04 未明 (NENRIN 座標整合性 time v3.3 の直後)

**このファイル1つで、止まったチャットの続きから動ける。**

作成: 2026年9月4日 未明 JST
作成者: 番人(別セッション。Cowork、Mac にリンク済み)
引き継ぎ元: 「Handoff continuation」チャット。Claude API の 500 Internal server error で応答が止まり、
TOshi が頼んだ引き継ぎファイルを出せずに落ちた

---

## 0. 出所の申告(ここを飛ばすと嘘を掴む)

このファイルは、止まったチャットの本文をコピーしたものやない。番人はそのチャットの中身を直接は読めん
(別セッションで、かつ Claude アプリ自身は computer use の対象に解決できんかった)。
代わりに **そのチャットが実際に作った物** を実物で確認して復元してある。

実物で確認したもの(この文書の記述の根拠):

1. `~/horizon-shield` の実ファイルと `.git/refs` の直読み(git コマンドは叩いてない。理由は1章)
2. JIDEC 台帳 entry 24 を `jidec_cite` で独立検証。バイト取得 → SHA-256 再計算 → 一致を確認
3. ローカル実ファイルの SHA-256 を番人が自分で計算し、addendum が pin した値と突き合わせ

**推測で埋めた箇所は無い。** 確認できてない唯一のものは、止まったチャットの会話文そのもの。
TOshi のスクショで読めた最後の1画面だけは 5 章に「スクショで確認した範囲」と分けて書いた。
それ以外で「チャットでこう言うた」とは一切書いてない。

**この引き継ぎに書いてない過去の経緯が要るようになったら、推測で埋めずに TOshi に聞くこと。**

---

## 1. 番人がまず守ること(破ると事故る)

- 本番の git root は `~/horizon-shield` のみ。`~/Documents/ホライゾンシールドシステム/horizon-shield`
  は別クローンで、そこで push すると reject される
- **deploy / push / KV 書き込み / git 操作は全て TOshi の手。** 番人は作って検証して渡すまで
- **番人はリポジトリで git コマンドを実行しない。** マウント越しに `git status` を回すと
  `.git/index.lock` が残り、番人側に削除権限が無いので TOshi の commit が止まる。
  状態を見たいときは `.git/HEAD` と `.git/refs/...` を `cat` で直読みする(このファイルの調査もそれでやった)
- `git add .` は永久禁止。常に個別指定。未追跡の残骸が多数ある
- **ダッシュ(em/en/bar)は出力に一切使わない。** ハイフン, 〜, ⇔, ㎡ は可
- 社名は「The HORIZ音s株式会社」。音は漢字、ローマ字にしない
- コードブロックにはコマンド以外を入れん。`#` コメントを入れん。コマンドは1回に1つ
  (TOshi の zsh はインタラクティブコメント無効で、コメント行がコマンドとして走る)
- 貼る先が違うものは同じ見た目にしない。「ターミナル」「ブラウザ」「LinkedIn のコメント欄」を毎回明示
- **推測で言わない。実物を確認してから発言する**

---

## 2. 何が止まったか

- 現象: 「Handoff continuation」チャットで `API Error: 500 Internal server error`。
  TOshi の直前の依頼(2件)に応答できずに停止
- TOshi の依頼(スクショで確認、原文):
  1. `https://shield.the-horizons-innovation.com/verify-directory/` を、
     もっと人々からすぐに活用してもらえるものに付け加えられんか
  2. その前に、ここまでの内容を完璧に新しいチャットで引き継げるファイルを作れ
- **この文書が 2 の代替物。** 1 は未着手で、7 章 B に materials を揃えてある
- 500 はサーバー側の一時障害。落ちたのは応答だけで、**リポジトリと台帳の状態は無傷**
  (このファイルの 3 章 4 章が実測でそれを示している)

---

## 3. NENRIN 座標整合性 v1 の現在地

### 一つの規律

座標整合性の全ては1行に落ちる。

> **検証者が、prover の所有しない源から座標を導出する。**

prover が座標を選べる限り、各層が緑でも判定は誤る。フェデリコが別々に持ち込んだ2問題
(record レベルの join、population の census)が同一欠陥やと番人が特定し、時刻軸を足して3軸で閉じた。

| 軸 | 座標 | prover 非所有の源 | 実装 |
|---|---|---|---|
| 中身 | 原価カテゴリ | 見積明細そのもの | `join_guard.py` |
| 母集団 | 呼べる集合 | Certificate Transparency | `nenrin_census.py` |
| 時刻 | `created_at` | Bitcoin ブロック(ビーコン + OTS) | `freshness_v3.py` |

### time 軸の版の推移(全部 addendum に記録済み)

- **v2** (`af10088e`): ビーコンで backdating を閉じ、currency を fail-closed に
- **v3** (`f31d0269`): ビーコンを複数ソースの quorum に。forged と unverifiable を分離。10/10
- **v3.1** (`538fc75d`): backdating 判定を quorum から切り離す。
  **フェデリコのレビューが見つけた欠陥。** 単独ソース confirm 時に本物の backdating が
  indeterminate で素通り(silent pass)。旧バイトで再現してから直した。13/13
- **v3.2** (`94651217`): veto を tip から導出。最高 tip + 6 ブロック(Bitcoin の確認深度)を越えたら構造的に不能。
  near-tip の残余は chain convergence で bound。18/18
- **v3.3** (`ecbb00bc`): **tip 自体を quorum に。** 参照 tip = quorum 番目に高い tip。
  嘘つき1本が tip を水増ししても最高値として無視され、stale 1本も最低値として無視される。
  1 fault ではどちらにも動かせん。22/22

### 現在の状態(実測)

- HEAD = `ecbb00bc`、`origin/main` も `ecbb00bc`。**v3.3 は push 済み**
- 赤チーム 22/22。offline、決定論
- 再現コマンド(ターミナル、1つずつ):

```
cd ~/horizon-shield/workers/hs-ledger/nenrin/coordinate-v1 && python3 freshness_v3.py
```

```
cd ~/horizon-shield/workers/hs-ledger/nenrin/coordinate-v1 && python3 freshness_v3_redteam.py
```

---

## 4. 番人が独立に再計算して確認した数字

止まったチャットの主張を鵜呑みにせず、番人が自分で計算し直した結果。全部一致。

**JIDEC entry 24 = time v3 addendum**

```
claimed    447bcf4f38cd8099683ccd396467609438aa47399e9bb9b75d7c425900147611
recomputed 447bcf4f38cd8099683ccd396467609438aa47399e9bb9b75d7c425900147611
match      true
```

- ローカルの `nenrin/coordinate-v1/NENRIN_COORDINATE_v1_ADDENDUM_time_v3.md` の SHA-256 も同値
- `workers/hs-ledger/claim_24.txt` の SHA-256 も同値。台帳のバイトと手元の原本が完全一致
- 台帳 URL: `https://ledger.horizonshield.dev/ledger/24`
- **Bitcoin: OTS 提出済み、confirmation は pending。ブロック未確定**

**addendum が pin しているハーネス(手元の実ファイルと照合、一致)**

```
276bc047838ee944bc078f519988d3688d58131318d4da916dad038622e22512  freshness_v3.py
1876bff826b598faa03ae8646a0eb8b9c5f010494f0d6322eea288757ac55e0a  freshness_v3_redteam.py
```

**cite されている上位仕様(不変)**

```
5be2b22e339d8b5c45a272325c49da189f10715b01683025ae903e83bf251df5  NENRIN_COORDINATE_SPEC_v1.md
```

**superseded として addendum に残してあるバイト(消してない、これが規律)**

```
d59c3385...  freshness_v3.py       (v3,   commit e296dec5)
f17d3ee5...  freshness_v3_redteam.py (v3,   commit e296dec5)
e8300274...  freshness_v3.py       (v3.1, commit 538fc75d)
307429a9...  freshness_v3_redteam.py (v3.1, commit 538fc75d)
6ba29b27...  freshness_v3.py       (v3.2, commit 94651217)
9e59daa9...  freshness_v3_redteam.py (v3.2, commit 94651217)
```

---

## 5. フェデリコとの現在地

`Federico Blanco Sanchez-Llanos`。coordinate-v1 spec が founding witness として名指ししている相手。
LinkedIn の DM と公開コメントでやり取りし、**返信は TOshi が自分の手で送る**(ダッシュ無し、AI 痕跡を消した文面)。

- 彼の verifier は3ソース稼働(mempool.space / blockstream / mempool.emzy.de)。
  tip は quorum(2番目に高い値)、authentic には全会一致を要求
- 彼のレビューは3回走り、**欠陥1 + 残余2** を出した。3件とも addendum に記録済み。superseded sha も保存済み
- 彼が自分の源で named した残余 = **共有 mempool コードベース**(3ソースが同じ実装を共有していたら独立性が減る)
- 彼の状態は entry 24 に対応している

### スクショで確認した範囲(止まったチャットの最後の1画面)

以下は番人が TOshi のスクショから読み取った、止まったチャットの最後の結論。**会話の全文ではない。**

- 論点は「dissent ルールを作るか」。作らん、が前のセッションの結論
- 理由: dissent は 2/3 と全会一致の中間で、単一障害への耐性を手放す。
  うちは 2/3 を選んでおり、共謀の閉じ方はローカルヘッダー集合の実装で行う
- **本当に潰すべきはそこやない。** うちの共謀2本の残余も、彼の共有 mempool コードベース残余も、
  「ローカルに同期したヘッダー集合を読み、第三者 API に一切依存しない」形が両方をまとめて潰す。
  addendum の本文にも既に `The strongest form of the check reads a locally synced header set and
  depends on no third-party API at all.` と書いてある。ただし fixture 止まりで本物は繋いでない
- 代わりにやること: **次の addendum(entry 24 を cite する新ファイル)に、この分岐を選択として書く。**
  「2/3 は障害1本に耐えて共謀2本に開く。全会一致は共謀2本に耐えて障害1本で止まる。
  dissent はその中間で、単一障害の保証を手放す。うちは 2/3 を選び、共謀の閉じ方はローカルヘッダー集合の
  実装で行う」
- フェデリコの返事が「うちの環境では共謀2本が現実的や」という具体ケース付きで来たら、
  その時に strict モードのフラグとして作る。既定は off、判定に mode を開示する形
- **TOshi には既に「作る前にお前の意見を聞く」と返信済み。** よって **返事待ちが正解。**

これは addendum の末尾にある `Not changed on purpose ... Held open for the witness rather than
decided alone.`(実ファイルで確認済み)と整合している。

---

## 6. 未処理・要注意(3件、全部実測)

### A. `.git/index.lock` が残っている。TOshi の commit が止まる

```
.git/index.lock   0 バイト   2026-09-03 12:08:57 UTC
```

- **番人が今回作ったものではない。** 番人の調査より約3時間半前に既に存在していた
- 番人には削除権限が無い。**TOshi の手で消すしかない**
- ターミナルで、他に git が走ってないことを確認してから:

```
rm -f ~/horizon-shield/.git/index.lock
```

### B. 未追跡の in-flight 作業が verify-directory にある

2026-09-03 13:22 UTC(22:22 JST、スクショの5分前)に作られたもの:

```
verify-directory/survey/data/build_lookup_index.py    7 KB   未追跡
verify-directory/survey/data/lookup_index.json      1.5 MB   未追跡
verify-directory/survey/data/lookup_details.json    5.2 MB   未追跡
verify-directory/lookup/                             空      未追跡
```

- `lookup_index.json` の中身: `{"meta":{"schema":"wedjat-lookup-1", ...}}`。
  列は endpoint / name / state / outcome / tools / card / payer / note。
  state の定義文(measured / pending / held)が meta に埋まっている
- **`verify-directory/lookup/` は空。** データは出来ているが、それを見せるページが無い
- つまり **7 章 B の作業は既に着手されていて、データ層だけ出来て止まっている**
- どう扱うか(commit するか、作り直すか)は TOshi の判断。番人は勝手に触らん

### C. 台帳 entry 24 の memo 表記のズレ(整合性の破れではない)

- `seed_entry_coordinate_v1_addendum_time_v3.json` の `work` フィールドが
  `time axis v3.2` と書いてある。実際に anchor されたバイトは **v3.3**
- `claim_sha256` と `record_canonical` は v3.3 で正しく、**再計算も一致する。改ざんではない**
- 影響は memo の文字列だけ。ただし anchor 後は編集できん
- **HS の規律に従うなら、隠さず次の addendum で開示する。** 直すのではなく、記録する

---

## 7. 次にやること

### A. フェデリコの返事待ち(最優先。動くな)

- 5 章の通り。返事が来たら、その具体ケースの有無で strict モードを作るかを決める
- 返事が来る前に dissent を実装するのは、既に送った「先に意見を聞く」に反する

### B. verify-directory を「すぐ活用できる」ものにする(TOshi の未着手の指示)

**現状の実物(確認済み):**

- `https://shield.the-horizons-innovation.com/verify-directory/` = WEDJAT。
  `Check any MCP server in 10 seconds`
- 入力欄は1つ(`#epin`)+ Run ボタン + プリセット2本
  (`gate.horizonshield.dev/self`, `mcp.horizonshield.dev/mcp`)
- 既存の見出し: Run it now, on anything / The same measurement, read from three different sides /
  Five questions ... / What a green row does not mean / Every row, drawn live from the register /
  An agent should not have to read this page / A badge you cannot pin / Three steps ...
- 下位ページ: about, badge, buyers, conformance, failures, for-registries, ja, member, members,
  method, monitoring, mould, operators, pay, pricing, privacy, recompute, register, survey
- 扉の口: `POST /check` / `GET /spec` / `GET /self` / `GET /health` /
  `GET /.well-known/agent-card.json`。エンドポイントは `https://gate.horizonshield.dev/mcp`

**番人からの候補(これは提案であって決定ではない。止まったチャットが何を提案するつもりやったかは番人には分からん):**

1. **6-B の lookup を完成させる。** データは既にある。`/verify-directory/lookup/` に
   結果の永続 URL を置けば、「自分のサーバーの行」を他人に見せられるようになる。
   URL に sha が入るなら、第三者がその場で再計算できる。**着手済みなので、まずここを片付けるのが筋**
2. 判定結果の横に **再計算のワンライナー** を出す。今の「recompute できます」という文言を、
   コピーして貼れる curl 一発に落とす。HS の差別化点(第三者再計算)が読む物から使う物になる
3. **バッジの貼り付けコード生成。** `badge/` は既にある。判定が緑になった相手に
   HTML/Markdown をそのまま渡せば、貼った先が全部入口になる
4. 日本語導線。`ja/` は既にあるが、トップの英語 1 画面目からの入口が薄い
5. エージェント向けの入口(`for-registries/` と `llms.txt` 系)。
   「An agent should not have to read this page」という見出しを既に持っているのに、
   機械が最初に読む1枚が page と同格で置かれてない

**やる前に TOshi に確認すること: 1 から 5 のどれをやるか、そもそも別の物か。**
番人が勝手に index.html を触らない。63 KB の本番ページで、pagecheck の対象や。

---

## 8. 用語(初見で詰まるもの)

- **NENRIN(年輪)** ... 機械可読な agent-facing サービスの conduct 記録。
  4層 = open witnessing / discrepancy records / ring / self-application。
  counts never scores、unmeasured は pass ではない
- **coordinate-v1(座標整合性)** ... NENRIN の下位仕様。3章の3軸
- **JIDEC** ... Bitcoin にアンカーする公開検証台帳。`ledger.horizonshield.dev`。読み取り専用
- **OTS(OpenTimestamps)** ... バイトを Bitcoin ブロックに刻む仕組み。提出から確定まで数時間
- **quorum** ... 独立ソースの過半の一致。v3.3 では tip 自体もこれで決める
- **fail-closed** ... 測れんかったものを合格にしない。判定不能は不合格側に倒す
- **forged / unverifiable_now** ... 前者は構造的にあり得ん高さ(常に拒否)、
  後者は今どのソースも確認できん(拒否せず、保証も与えん)。この分離が v3 の核
- **WEDJAT(検証の扉 / MCP Conduct Register)** ... 無料・読み取り専用の MCP/A2A 適合チェッカー。
  5条件、判定に SHA-256、第三者再計算可能
- **番人** ... アシスタント(あなた)の呼び名。作って検証して TOshi に渡すまでが役割
- **TOshi** ... 大賀俊勝。The HORIZ音s株式会社 代表。push と deploy は全て本人の手

---

## 9. 新しいチャットで最初にやること

1. このファイルを全部読む
2. 6-A の `.git/index.lock` が消えているか TOshi に一言確認する。ここが最優先
3. 1 章を守ると声に出して確認する
4. 7-A(フェデリコ待ち)が動いたかを TOshi に聞く。動いてなければ 7-B に入る
5. 7-B に入るなら、まず 6-B の未追跡ファイルを実物で開いてから話す。
   **引き継ぎが自己完結していることと、実物を見ずに語ってええことは別**

---

## 10. 追記(2026-09-04 午後、同じセッションで完了したもの)

### 完了

- **hs-hearing 2.3.0**: 正本 / 実ソース / レジストリの3点一致。PR #18、publish 済み、レジストリ latest 2.3.0(06:07:42Z)
- **hs-webmcp 1.0.3**: 本番が 0.6.0、正本とレジストリが 1.0.2 で、この1本だけ最初から番号線が2本あった。
  レジストリは後戻りできんので両方 1.0.3 に前進。本番は main より古い build で route_request の説明が
  「65,520品目」のままやった(main は 95,403)。deploy(version 9af2f38a)で解消。INSTRUCTIONS が
  route_request / run_full_audit を名乗ってへんかったのも修正(旧名 ask / orchestrate は TOOL_ALIASES で生きとる)。
  食い違っとった期間は workers/hs-webmcp/README.md「Version numbering, and a correction」に記録。
  PR #19、publish 済み、レジストリ latest 1.0.3(06:42:50Z)
- **verify-directory/ja/**: 「あなたのAIに、検査そのものをやらせる」節を追加(§7-d が閉じた)。commit 393eef19
- **次の addendum**: nenrin/coordinate-v1/NENRIN_COORDINATE_v1_ADDENDUM_sources_v1.md。entry 24 と 25 を cite、
  コード無改変、harness の新規ピン無し。seed は make_coordinate_sources_seed.py で生成済み、
  claim_sha256 = 04908cd53c006ea0ebd24535ab8d3c884317cd2aeeff7a24f136c8a459cf50dc。commit e50bfb70、main に原本あり。
  **台帳 append 済み = JIDEC entry 26**(https://ledger.horizonshield.dev/ledger/26)、ots stamp 済み PENDING。
  番人が jidec_cite で独立検証: claimed = recomputed = 04908cd5、match true。claim_26.txt(.ots) が untracked で残る(22〜25 と同じ)
- 版ドリフト全数: hs-mcp 1.0.5 / hs-hearing 2.3.0 / hs-verify-gate 0.2.2 / jidec 1.2.0 / webmcp 1.0.3 が3点一致。
  jhnrd はこのリポジトリに正本が無く**未測定**(一致とは書かん)。hs-audit-app は deprecated

### 罠(次の番人が同じ穴に落ちんように)

- **MCP レジストリの `?search=<名前空間>&version=latest` は latest を正しく返さんことがある。**
  同じ瞬間に hs-hearing を名前空間まとめ引きすると 2.2.0、単体名(`search=io.github.ogasurfproject-jpg/hs-hearing`)で
  引くと 2.3.0 latest やった。**必ず単体名で引いて versions を全部見る。**Gmail の search_threads と同じ形の罠
- **`gh pr create` に `--body` を複数渡すと最後の1つしか採られん。**PR #19 で本文が消えてフッターだけ残った。
  本文は1つの `--body` に `$'...\n...'` でまとめる。あとから `gh pr edit N --body` で直せる
- **番人がテスト出力をコードブロックに入れたら TOshi がターミナルに貼った**(`zsh: command not found: FAIL`)。
  掟の再確認: コードブロックにはコマンドだけ。出力・引用・例文は絶対に入れん
- grep は `+` で行をまたぐ文字列連結を見落とす。「index.js に無い」と言う前に、語1つで引き直す
- Mac のシステム python3.10 には cryptography 50.0.0 が入っとる。coordinate-v1 の両ハーネスはそのまま走る
  (「.hfvenv に無いからスキップ」というメモは古い)
- test/ask.test.mjs と ask_v2.test.mjs は `ask` → `route_request` 改名前の形で古い。壊れてるんやなく古い。
  直すなら別件

### 残り(この時点)

- ~~LinkedIn About~~ **完了(2026-09-04 16:1x JST)**。番人が内蔵ブラウザで自己紹介の編集フォームを開き、
  `JCCDB. 65729 line items. CC BY 4.0.` の1行だけを `JCCDB. 95,403 line items across 402 categories. CC BY 4.0.` に
  差し替えて保存(TOshi の「1」= 俺がやれ、を受けて)。他の文字は無改変。保存後にフォームを再読込して確認済み(1,155字)
- **LinkedIn 投稿は既に出とる。**「The most expensive sentence...」(§4 確定版)は 2026-09-03 22時前後に投稿済み、
  9/4 16時時点で 18h前・18インプレッション・コメント1件。**9/4 21:00 に再投稿するな(二重投稿になる)。**
  同じ晩の3時間前(21h)にフェデリコ関連の投稿も出ており、同日2本 = 掟の「食い合う」ケース。
  前の引き継ぎの「9/4(木) 21:00 に投稿予定」は曜日も状態も古い。コメント1件の主は未確認
- entry 25 と claim_2x.txt(.ots) の untracked 方針
- レジストリ未掲載 Worker 3本、Glama 旧ツール名、被リンク依頼、llm_visibility_monitor 生死確認、Bluesky 版、Maribell 返信確認

### GSC 実測(2026-09-04 16:4x JST、番人が内蔵ブラウザで Page indexing を直読み)

登録 22 / 未登録 390。未登録の内訳と、それぞれの正体:

| 理由 | 件数 | Validation | 正体 |
|---|---|---|---|
| Excluded by noindex | 4 | Failed | souba/yane-tokyo, kyutoki-fukushima, shiroari-nagano(県別スタブ)+ qa/mokuzai-tanka-2026.html。**全部意図した noindex**。Failed は「まだ noindex のまま」= 正しい |
| Crawled, currently not indexed | 383 | Failed | **トップページ(最終クロール 8/2)**、verify-directory、yakumo、partner、guide を含む。最新クロールは 8/18。08-24 時点の「Google に認識されていません」352 本がここへ移動 = クロールは進んだが索引判断は保留のまま。Failed は「検証」を押した結果で、Google 側理由に打つ手は無い |
| Not found 404 | 3 | Started | 全部 5 月が最終クロールの古い記録。souba/gaiheki-keiyaku/ と kouji-chuu-trouble/ は**今は 200**(番人が実測)。about-founder/ はディレクトリ形の幻 URL で、実体もリンクも sitemap も about-founder.html。直すものは無い |
| Page with redirect | 0 | Passed | `_redirects` は GitHub Pages では効かん。旧 blog URL は「移転しました」noindex スタブで処理済み(それで 0 で正しい) |

結論: **本物の問題は 0 本。**「Failed」2つは検証ボタンの結果で、Google 側理由には押しても必ず Failed になる。押さんこと。
9/4 の施策(Q15 内部リンク、新規3本、IndexNow、URL 検査からの登録リクエスト)は Page indexing レポートには数日遅れでしか出ん。
**生の信号は URL 検査の「前回のクロール」日付**。トップと要求した 10 本を検査して 9/4 以降なら要求が効いとる。
383 本の全リストは pane が隠れとる間は取れんかった(rows per page が合成イベントでは開かん)。pane を表示して実クリックすれば取れる

### GSC 追記(2026-09-04 16:5x JST)

- **URL 検査(生データ)**: トップ = 9/4 10:39 に Googlebot 来訪(昨日のリクエストが効いた)。/souba/gaiheki/ = 最終 7/2、参照元なし。
  /faq/mitsumori-isshiki-uchiwake-nai/ と /faq/mitsumori-yukokigen-neage/ = **Google が URL を知らん**(Last crawl N/A)
- **TOshi が 9/4 に登録リクエスト済み(8本)**: souba/gaiheki, shiroari, kyutoki, toilet, gaiheki-150man, faq/mitsumori-isshiki-uchiwake-nai,
  houmon-hanbai-gaiheki-kotowaru, chintai-taikyo-hiyou-takasugiru。9本目(faq/mitsumori-yukokigen-neage)で Quota Exceeded。
  **明日の分(6本)**: faq/mitsumori-yukokigen-neage, souba/yane-check, souba/yane-fukikae-slate-hiyou, aeo/リフォーム-相見積もり-コツ.html,
  aeo/火災保険-リフォーム詐欺.html, faq/tenken-shoho-kimari-monku。**フル URL で貼ること**(パスだけやと URL not in property)
- **Crawled, not indexed 383 本の全リスト取得済み**: ops/gsc_crawled_not_indexed_20260904.tsv(全件)、_nonstub.tsv(県別スタブ除外 214 本)。
  最終クロール月: May 285 / Jun 41 / Jul 33 / Aug 8 / Apr 15。**74% が 5 月で止まっとる** = クロール需要の枯渇そのもの。
  内訳: 県別スタブ 168(既に noindex、再クロールでこの箱から消える)/ 実ページ 214(souba 84, qa 53, aeo 41, ehn 10, guide 4, 入口ページ群)。
  監視 15 本のうちこの箱にあるのは 5 本だけ(kyutoki 7/20, toilet 7/12, gaiheki-150man 4/29, aeo 相見積もり 7/9, トップ 8/2)。残りは索引済み 22 に入っとるか「未知」
- **リンク衛生の実害 1 件**: /souba.html(canonical は /souba/)に **100 ページから内部リンク**が刺さっとる。/souba/ 自体も未索引(5/31)。
  リンク先を /souba/ に揃えるのが筋やが、100 ファイルの一括置換 = 6/16 と同種の操作。pagecheck を通す前提で TOshi 決裁
- 5 月の幻 URL(`//`、`.../index.html` 付き)はソースにもう無い。放置で消える
- Sitemaps レポートの `/search.google.com/search-console`(7/2、Couldn't fetch)はゴミ登録。削除推奨。/sitemap.xml は 9/1 読込 Success 587 本

### /souba.html 内部リンク修正(2026-09-04 17:1x JST、TOshi「やろう」で番人が実施、commit/push は TOshi 手)

- 対象: `href="/souba.html"` 101 箇所 + 絶対URL形 2 箇所 = **103 箇所 / 102 ファイル**(qa 57, aeo 41, souba 2, index.html ×2, mitsumori-ai-shindan.html)→ `/souba/`
- 手順は掟どおり: STEP1 grep で列挙 → STEP2 文脈を目視(全部ナビの「相場DB」か本文の「相場データベース」リンク、混在なし)→ STEP3 名指しリストで置換。
  `grep -rl | xargs sed` は使ってへん。危険ファイル(錨打ち済み)は対象に無し
- 検証: 変更前 tar と diff → **変更行ちょうど 103、href 以外の差ゼロ**(正規化して < > が完全対応)。残存 `souba.html` href 0
- sitemap.xml から `/souba.html` の url ブロックを削除(589→588、XML 再パース OK)。canonical が /souba/ を指す重複 URL を sitemap に載せんため
- バックアップ: ops/BACKUP_souba_link_fix_20260904-081303.tar.gz(gitignore 対象)、sitemap.xml.bak-20260904-081440
- add 用リスト: ops/souba_link_fix_20260904_files.txt(103 本)。`git add --pathspec-from-file=` で個別指定の代わりにする
- **pagecheck の発見**: validate.py を 102 本に当てたら 1317 件で不適格。**変更前の tar でも同じ 1317 件、内訳まで同一** = 今回の変更は中立。
  中身は UNKNOWN_NAMESPACE 102 / MONEY_ON_PAGE 102 / CANONICAL_MISMATCH 98(`.html/` を期待する門側の癖)/ SUSPECT_RELATIVE_LINK 760 =
  **門は yakumo/ と care/ 用に作られとって、qa/ と aeo/ は守備範囲外**。CI の pagecheck.yml も paths が yakumo/** と care/** だけなので、
  この push では走らん。トップ index.html ですら NO_AUTHOR と SUSPECT_RELATIVE_LINK で落ちる = 門の適用外の証拠。
  qa/aeo に門を広げるなら policy v1.3.0 の仕事(別件、TOshi 決裁)。**Google が索引せん qa 53 / aeo 41 と、門が知らん namespace が同じ集合**なのは記録しとく

- **push 済み(17:19 JST)**: commit `3a9d781e`、103 files / +103 -109、main = origin/main。GitHub raw で qa/yane-repair-cost.html に `/souba.html` 無し・`/souba/` 有り、
  sitemap.xml に souba.html 無し・/souba/ 有りを確認。Pages は static.yml で自動反映

### この時点で残っとるもの(2026-09-04 17:2x JST)

- 明日の GSC 登録リクエスト 6 本(上記、フル URL で)
- GSC Sitemaps のゴミ登録 `/search.google.com/search-console` の削除(TOshi 手、画面から)
- qa/ と aeo/ を pagecheck の守備範囲に入れるか(policy v1.3.0、TOshi 決裁)
- entry 25/26 の claim_2x.txt(.ots) と seed の untracked 方針
- レジストリ未掲載 Worker 3 本 / Glama 旧ツール名 / 被リンク依頼 / llm_visibility_monitor の生死 / Bluesky 版 / Maribell 返信確認
- 投稿のコメント 1 件の主の確認
- LinkedIn の Jeff Sham 返信、Frank Fiegel コメント(前の引き継ぎ §10、状態未確認)

## 11. localheaders を本物にした(2026-09-04 夕方、TOshi「強烈に作り込め」→ 番人実装、TOshi 同期・commit・push・append)

- **JIDEC entry 27** = NENRIN_COORDINATE_v1_ADDENDUM_localheaders_v1.md(claim 04→ f5512ea3bb476e3356f96979c9a922e102f35d893659d76ad151fed5450f6162)。
  番人が jidec_cite で独立検証 match true、OTS pending。commit 7e8d3e33(14 files、1344 行)、push 済み
- **entry 26 は Bitcoin block 965447 で確定**(2026-09-04 07:58 UTC)。**その 965447 は entry 27 が pin したヘッダー鎖(961632..965452)の中にある。**
  手元の .bin から取り出した 965447 の nTime = 1788508723 = 07:58:43Z で、JIDEC の block_time と分単位で一致。
  「entry 27 が検証する鎖が、entry 26 の錨を含む」= anchor of the anchor が具体物になった
- coordinate-v1 に新規 5 本: localheaders.py(7検査: hash / 連結 / PoW / retarget(Core の算術、4倍クランプ、上限)/ MTP / 未来時刻 / checkpoint。
  1違反でファイル丸ごと拒否)、localheaders_redteam.py(**本物の PoW を掘る敵**、25/25、Mac と cloud で同一)、sync_headers.py(TOshi が Mac で回す唯一のネット工程。
  explorer は運び屋、hash 不一致は捨てる、全部通らんと1バイトも書かん)、sources_live.py(3源組立)、freshness_live.py(本物 tip で5判定、固定時計)
- 実データ: blockstream 961632..965451(3820本、305,600B、sha b7c8ddef…)と mempool 961632..965452(3821本)。**共通 3820 本がバイト一致**。
  checkpoint 961632 / 963648 / 965451 / 965452。retarget は 963648 で中から検証、961632 は「前期間の先頭 959616 が無い」と正直に unverified
- freshness_v3.py は無改変(276bc047)。5判定: 正直=authentic(3源、quorum)/ 偽hash=forged / margin外=bad_coordinate / backdated=refused(beacon は authentic のまま)/
  鎖 down=authentic(2源、max_degraded 開示)。record hash 5本を addendum に固定
- 敵の記録: 36ブロックの fork は 32ブロックの正直鎖より軽かった(retarget で正直鎖が硬くなっとった)。追い越すのに 32 ブロック要った = ブロック数は work やない。
  mainnet genesis と block 1 を**記憶から書いた80バイト**で検証して hash 一致(名前やなくバイトで鎖を見分ける)
- 名指しした限界: 同期時の運び屋は HTTP explorer のまま(P2P getheaders 未着手)/ 軽い別鎖を拒むのは checkpoint だけ / スナップショット(再同期で currency)/
  窓の先頭境界は中から検証不能 / explorer 2社の実装独立は未監査のまま(entry 26 のとおり)
- フェデリコ: 16:45 に entry 26 を独立検証して「bytes first, when localheaders is real」。**entry 27 がその bytes。**番人が返信案(sha と entry と 965447 の一致)を出した、送信は TOshi
- 番人の反省(この日3回目): 出力や要約をコードブロックに入れて TOshi が2回ターミナルに貼った。**コードブロック = 貼るコマンドだけ。**例外なし

## 12. localheaders v2: 運び屋 = Bitcoin P2P(2026-09-04 夜)

- **JIDEC entry 28** = NENRIN_COORDINATE_v1_ADDENDUM_localheaders_v2.md(claim 5ed2027f4ce46a11a35dc065c74b02b81a4289c759225776f9383f4909cdf5f4)。
  commit b738e385(7 files)、push 済み、append + stamp 済み(PENDING)。entry 27 は stamp 時点でまだ pending
- sync_headers_p2p.py: Bitcoin の wire protocol(version/verack/ping/getheaders/headers、magic とチェックサム検査、payload 上限、services 0)を標準ライブラリで喋る。
  DNS シード8本から 182 アドレス → 最初に握手できた3ノード(/Satoshi:31.0.0/ ×2、/Satoshi:25.0.0/)から窓 961632.. を独立に引き、
  1メッセージごとに localheaders.py で累積検証。**3ノードが 3,822 ヘッダーでバイト一致、explorer 製 .bin と 3,820 でバイト一致**(sha b7c8ddef… 同値)。
  1台が1ブロック遅れ = lag として記録し長い方を書く。localheaders_p2p.bin = 3,823 本(..965454)、sha 888151bb…
- p2p_redteam.py: 偽ピアを loopback に立てて本物のクライアントを攻める。14/14、Mac と cloud で同一
  (PoW 壊れ/fork/チェックサム改ざん/magic 違い/巨大 length/txcount≠0/停止/未知 locator を落とす、有効な鎖2本の矛盾は拒否して名指し、古いピアは lag)
- **entry 27 の限界1「同期時の運び屋は HTTP explorer」は閉じた。**残る名指し: DNS シードは発見のみ(--peer で回避可)/ 平文接続(BIP324 未実装)/ IPv4 のみ / 窓の先頭境界 / explorer 2社の実装独立は未監査
- フェデリコへは entry 28 の sha と番号だけ(番人が文面、TOshi 送信)

## 13. genesis から、checkpoint 無しで(entry 29)/ 拒否は記録である(entry 30, 31)(2026-09-04 夜、19:30 JST 時点)

- **JIDEC entry 29** = NENRIN_COORDINATE_v1_ADDENDUM_localheaders_v3.md(claim 937ce7049c1962f9e862af5f124ae31a40ef39c230a5c0937a1a23257a861693)。
  commit 3a7fbcf8(10 files)、push 済み、append + stamp 済み。番人が jidec_cite で独立検証 match true
- genesis 引き(TOshi 手、18:32〜18:48 UTC+9 で約16分): 3ノード(136.51.20.119 /Satoshi:28.1.0/、87.166.205.38 /Satoshi:29.0.0/、24.126.175.8 /Satoshi:30.2.0/)から
  **965,457 本(0..965456、77,236,560 B、sha d91d6482cee0763a…)**。3ノードが 965,455 本でバイト一致、tip の差はその間に掘られたブロック = lag。
  2ノード(34.65.20.183、73.208.251.19)は握手後 30 秒で headers 返さず名指しで落とした。**478 個の retarget 境界(2016..963648)全部を中から検証、checkpoint は validator に渡しとらん**
  (--check-against は entry 27 の3点が「その鎖の上に乗っとること」を要求しただけ)。unverified はただ1件 height 0 の bits_continuity(genesis に前がない)
- genesis_window_check.py 9/9: 全ファイルが checkpoint 無しで valid(2.3 秒)、blockstream 3820 / mempool 3821 / p2p 3823 の3窓が **genesis 鎖のバイト切片**(sha が各 manifest と同値)、
  先の manifest の checkpoint 5点(961632 / 963648 / 965451 / 965452 / 965454)をバイトから読んで一致、965447(entry 26 の錨)が同 hash・同 nTime で存在
- **.bin(77MB)は git に入れん。** .gitignore に明記(commit 済み)。addendum に sha と prefix sha 4本(10万 / 50万 / 90万 / 965,455 本)を固定 = 誰でも自分で genesis から引いて突き合わせられる
- localheaders_stream.py(O(n) 一筆書き検証、状態は timestamps 11 個 + 期間先頭 2 個で一定)、stream_redteam.py 8/8(validate_chain と同じ判定・同じ拒否理由・同じ高さを乱数チャンクで証明)
- superseded(掟どおり旧 sha は addendum に残す): entry 28 の sync_headers_p2p.py 9b600f9b… / p2p_redteam.py 30bfe3eb… → entry 29 で b7e5a27f… / d848b12f…
- **フェデリコ 18:44**: entry 27 / 28 を独立検証(raw bytes、自前 sha、自前 lib で .ots)、**entry 26 の .ots は block 965447 の本物の attestation を持っとると自分の pull で確認**。
  そして問い:「2本の有効な鎖、checkpoint で分けられず、client が選ばず拒否して名指しする」という失敗モードは、台帳の下流が直接 query できる場所に記録されとるか、それとも addendum の文章を読まんと存在が分からんか。
  **正直な答えは「否」やった。**「拒否では何も書かん」はヘッダーのバイト用の掟やのに記録まで飲み込んどった。manifest の peers_failed は成功時にしか書かれん。実網で拒否が起きたらファイルも台帳も残らん設計やった
- 閉じた: sync_headers_p2p.py **v3**(拒否のたび `<prefix>.refusal.<time>.json`: reason_code / height / 食い違いは両ピア両 hash / 落としたピア全部 / network(mainnet か test か明記)/ bytes_written false。
  ヘッダーのバイトは相変わらず書かん)、make_refusal_seed.py(拒否記録 → 台帳 seed、fail-closed: schema / bytes_written / 理由コード / 同じピア・同じ hash の二重名指し を拒否)、
  p2p_redteam.py **16/16**(c07 が固定ポート 28901/28902 + 固定時計で拒否記録を吐き **Mac と cloud で sha 同一 07830db2cf32aaee…**、c15 で改ざん5種が seed にならん)
- **JIDEC entry 30** = 拒否記録そのもの(refusal_record_redteam_c07.json、claim 07830db2cf32aaee74b77c3cc563318515d276a505288ae574a3666f7defcf26 = ファイルの sha そのまま)。
  **jidec_cite に素の 64 桁を渡すと entry 30 に解決して JSON が返る** = 文章を読まんでも失敗モードの形が query できる。記録の中に「test network、本物の鎖やない」と明記
- **JIDEC entry 31** = NENRIN_COORDINATE_v1_ADDENDUM_refusals_v1.md(claim 71683e3a7b44bda0f55f6aefbf0e34280d05dc15f45eb36b8b128fe61bf469b5)。commit f05e8865(8 files)、push 済み。
  **§3 に運営者の掟を錨で固めた: 実網で client が拒否記録を書いたら、中身が気に入らんでも同じ台本で必ず台帳に載せる。**superseded: entry 29 の b7e5a27f… / d848b12f… → dd6c1985… / 0d49d663…
- 名指しした限界(31): 台帳に typed kind が無い(拒否は record 内の schema と work 行の接頭 "NENRIN localheaders refusal" で見分ける、typed kind は Worker 改修)/ 拒否点に着く前に死んだ run は何も残さん /
  記録はどっちのピアが正直かは言わん(選ばんのが要点)/ 台帳上の拒否は今は red team 製(test network と明記)、実網の拒否はまだ0件
- OTS: **27 / 28 / 29 は Bitcoin tx 13f753c7525f86dbbded08a64d069237ef5dce452721b8c2fd8bcfde57176d04 に乗って 6 承認待ち**(19:10 JST 時点)。30 / 31 は pending
- フェデリコへ返信送信済み(19:15 JST、entry 29 / 30 / 31 の番号と sha、「否やった」と認めた上で閉じ方、typed kind 無しは名指し)
- LinkedIn: Max Shyshkin が Femtech Registry 投稿にコメント(道具論、Nice work)→ 返信案2本を番人が出した(診断せん / 商品勧めん / 紹介料取らん、で乗る)。
  Maribell Smith の「certainty vs clarity」投稿にも TOshi がコメントしたい → 案2本(コンクリ打つ朝の話、決めた瞬間に知っとったことを書いて残す)。送信は TOshi、状態未確認

### 今日の罠(3件、再発防止)

- **.gitignore 17 行目 `*.py`**(8/20 に「手元の使い捨てパッチ用」で入れた規則)。coordinate-v1 の .py は全部 `-f` で入っとる。新規 .py は `git add -f --pathspec-from-file=ops/<list>.txt`。名指しリストやから -f でも余計なもんは入らん
- **番人が device_bash で git status を打つと `.git/index.lock` が残る**(そのマウントは unlink 不可)。TOshi の次の git が "index.lock: File exists" で止まる。番人は git を叩かん、叩いたら `rm -f ~/horizon-shield/.git/index.lock` を先に渡す
- **コマンドを貼るとき先頭に全角スペースが入る**ことがある(`zsh: command not found: 　rm`)。エラー文の command not found の後ろに空白が見えたらそれ

### この時点で残っとるもの

- qa/ と aeo/ を pagecheck の守備範囲に入れるか(policy v1.3.0、**TOshi 決裁**)
- 明日: GSC 登録リクエスト 6 本(フル URL)、GSC Sitemaps のゴミ登録 `/search.google.com/search-console` 削除(画面から)
- entry 25/26 の claim_2x.txt(.ots) と seed の untracked 方針
- レジストリ未掲載 Worker 3 本(hs-nursing-mcp / hs-mcp-observatory / hs-femtech-mcp)/ Glama 旧ツール名 / 被リンク依頼 / llm_visibility_monitor の生死(launchd は TOshi のターミナルからしか見えん)/ Bluesky 版
- LinkedIn: Jeff Sham 返信、Frank Fiegel コメント、Max 返信、Maribell コメント(全部 TOshi 送信、状態未確認)
- 27〜31 の Bitcoin 確定を次回 append 時か jidec_cite で確認

## 14. pagecheck v1.3.0: 記事の面(qa/aeo)を門の中へ / untracked 方針(2026-09-04 夜、19:45 JST)

- 決裁(TOshi): pagecheck は「報告で広げて、実欠陥を潰して、blocking に上げる」の全部。untracked は「seed は commit、claim/.ots は .gitignore」
- **commit e3f9d181(96 files)、push 済み、CI pagecheck 緑(blocking 88 ページ PASS / report / red team 1496 全 success)、Pages 配信済み**
- v1.3.0 の中身: 名前空間の**種類**(member = yakumo/care、content = qa/aeo)。content は 4 点だけ読み替え:
  canonical はファイル URL / 金額は**出典への href**(souba・ledger・JCCDB repo・DOI・SSRN)があれば可、無ければ MONEY_WITHOUT_SOURCE /
  HS ルート逆リンクは href="/" も可 / root 相対と絶対の内部リンクは実在必須(INTERNAL_LINK_BROKEN)。それ以外は同じ強さ。
  **member の判定は一字も変えとらん**(1,475 手が同一結果)。red team に content 21 手(うち 1 手は「member に /souba/ の href を置いても金額は弾かれる」= 漏れ検査)。1,496 / 1,496
- `--mode report`(判定同一、exit 0、内訳 1 行)。CI: 変わった qa/aeo を blocking + 全 148 ページを毎回 report(`if: always()`)
- **実測**: v1.2.0 のまま 1,317 件 → 読み替え後 208 件、全部実欠陥(NO_AUTHOR 90 / ROBOTS 無し 86 / 裸相対 18 / 近似重複 14 組)。
  aeo 91 ページ中 86 に robots meta が無かった。90 ページに meta を差し、一覧の 18 本を /aeo/ 付きに(掟どおり: 列挙→文脈→名指し置換→tar→差分検証、
  差分は meta と href だけ)。壊れた内部リンク 0、出典なし金額 0
- **門が見つけて門では直せんもの**: 近似重複 14 組 = 22 ページ(可視 1,700〜1,850 字、対で 63〜73% 同文)。**22 中 21 が GSC「クロール済み・未登録」**。
  qa/aeo が索引されん理由はこれ(薄い雛形)。文章の書き直し待ち。report に毎回出る
- aeo の重複 1 組(断熱工事 ⇔ 雨漏り修理)は両方この push に入ると blocking で赤になるから、**A 案で今回の commit から外した**(meta は差した状態で作業ツリーに残っとる、書き直しと一緒に commit)
- 罠: `.github/workflows/*.yml` は番人の remote 書き込みが**保護で拒否**される。ops/pagecheck.yml.v130 に置いて TOshi が cp
- 番人の台本ミス 1 件: 一覧ページで meta 挿入をリンク修正が上書きした(読んだ順の問題)。差し直して 148/148。手順の教訓: 同じファイルに 2 種類の編集をするなら 1 回読んで 1 回書く
- untracked: .gitignore に claim_*.txt / .ots / .bak(台帳が正)、entry 25 の seed(seed_entry_witness_state_0001.json)を add。claim_2/3 の .ots は 7 月から tracked のまま
- REDTEAM_LOG.md に第3回を追記、POLICY.md v1.3.0

### 残り(19:45 JST)
- 明日: GSC 6 本のフル URL 登録 + Sitemaps のゴミ削除
- 近似重複 22 ページの書き直し(TOshi の中身、番人は構成案は出せる)
- レジストリ未掲載 Worker 3 本 / Glama 旧ツール名 / 被リンク / llm_visibility_monitor / Bluesky / LinkedIn 4 件の送信状態
- 27〜31 の Bitcoin 確定確認

## 15. フェデリコの宿題「1 ケースの直しが兄弟に広がっとらん場所を探せ」(2026-09-04 20:00〜21:30 JST)

- フェデリコ 19:44: entry 29 / 30 / 31 を独立検証、「答えたのも閉じたのも同日、直しが 1 ケースの外へ効く(31 の掟)。それが基準。Nothing left to push on here, go build」。
  彼の実質の宿題 = 自分の他の場所で同じ失敗の型(1 ケースのために作った直しが兄弟へ一般化されず残る)を探すこと。TOshi「全部やる、宿題も」
- **当たり 1: .gitignore の `*.py` / `*.sh`**(8/20「使い捨てパッチ用」)。`.github/scripts/` だけ「ここだけ明示的に戻す」で例外 = 型そのもの。
  結果: 本物の .py 118 本が -f で入っとった上に、**append_witness.sh(台帳の手順)/ ops/llm_visibility_monitor.py(監視そのもの)/ run_visibility_weekly.sh / build_lookup_index.py が untracked で隠れとった**。
  規則を「root 直下の .py / .sh だけ」に狭めた(使い捨ては root に置く掟)。4 本を add(秘密は埋まっとらん、鍵は環境変数)。partner-002 の fix_*.py 2 本は untracked で見えるまま(TOshi 判断)
- **当たり 2: pagecheck v1.3.0 自身**。qa/aeo だけ入れて faq/blog/souba(576 ページ)を門の外に残しとった = 同じ日に同じ型。**v1.3.1「門の外に名前空間を残さない」**:
  faq/blog/souba も content。移転スタブ(meta refresh + noindex)を content の中の種類 redirect に(毒検査と移転先の検査だけ、member では refresh は禁止のまま)。
  content の裸相対はディレクトリから実在すれば可(領収ページ ⇔ claim.txt / proof.ots)、リンクは script を剥いで見る(JS の '+REVERSE+' を href と取らん)。red team **1,517 / 1,517**
- 実測と同日修正(差した行だけ、削除 0、tar と差分検証): souba 72 → 423 / 455(スタブ 170 に canonical、「→ 全国版へ」薄い県別 65 を正式スタブに、robots 116、author 32、</html> 5)、blog 36 → 83 / 86(author 25、robots 21)。
  content 5 名前空間 724 ページの report が 8 秒。commit 341f6049(419 files)、CI pagecheck 3 段緑、Pages 配信済み
- **副作用 1 件、同日に直した**: 規則を狭めて見えた build_lookup_index.py を add したら、survey-report の「データの索引と実ファイルの照合」が赤に(データ置き場に台本が 1 本増えて index.json に無い)。
  WHAT に説明 4 本を足し、tracked の集合で index.json を作り直し(手元の未公開生成物 lookup_*.json 2 本は載せん)。commit a9715667、survey-report 緑。
  教訓: **ignore を外すと「見えるようになったファイル」が他の門に入る。外した瞬間に、そのファイルを見る門を全部回す**
- observatory: レジストリ掲載 完了(io.github.ogasurfproject-jpg/hs-mcp-observatory 0.1.0、custom domain observatory.horizonshield.dev、12,429 住所)。1 回目は description 169 字で落ちた(上限 100)。
  hs-nursing-mcp は「内部の口」やから掲載せん(決定)。hs-femtech-mcp は別リポジトリ、未着手
- LinkedIn: フェデリコへ返信送信済み(短い、ALO の例に「同じ型を探す」で乗せた)。Maribell の返信(準備が価値を足さなくなる所)にも返信案を出して送信済み。Max 返信は状態未確認

### TOshi の判断待ち(門が見つけて門では直せんもの)
- **souba/kajou-seikyu-jirei-20 の「平均削減率 32.5%」**が MOAT 語の文字列と同じ。公表統計なら MOAT 語を見直す / 隠す数字なら本文を直す
- blog の出典なし金額 2 本(article-2026-04-17「150万円」/ 2026-05-17「980万円」): /souba/ への出典リンクを足すか数字を消すか
- souba の em ダッシュ 31 ページ(文脈で 、/〜 に置き換え。機械では危ない)、blog/index.html の JSON-LD 無し
- 近似重複: qa 13 組 / aeo 1 / faq 8 / blog 1 / souba 74(雛形)。qa の 22 ページは 21 が Google 未登録。書き直しの順番
- blog / souba を blocking に上げる時期(残欠陥が消えたら CI の grep に足すだけ)
- workers/hs-partner-002-mcp/fix_takashi_*.py 2 本(使い捨てなら root へ、要るなら add)

### 残り
- 明日: GSC 6 本 + Sitemaps ゴミ削除
- Glama: ツール名は 9/4 09:16 UTC の再取得で新 14 本に更新済み(閉じた)。件数 65,520 / 65,729 は Glama の古いキャッシュ、生きとる server は 95,403 v4.0 で正しい。
  自分の側のズレは about-founder.html の 1 行だけ(v4 の総数に v3.1 の層 13,207)→ 43,090 に直した。commit 8885dd1d
- **当たり 3: llm_visibility_monitor は死んどった。** launchd(com.horizonshield.visibility、毎週月曜 12:00)が ~/Desktop/horizon-shield/run_visibility_weekly.sh を指したまま、
  台本は ~/horizon-shield/ops/ に移っとった(Desktop は claim_4 の残骸だけ)。err に can't open input file が並び、ops/visibility-runs は 8/10 から空 = 移してから一度も走っとらん。
  launchctl list の「0」は zsh がファイルを開けん時の値で、正常やない。plist の 3 行(台本 / out / err)を ops/ に向けて bootstrap + kickstart(TOshi 手、9/4 20:42)。結果は visibility_last_run.txt で確認
- **当たり 4: com.horizonshield.jidec(1 時間ごとの OTS 昇格)は鍵を回した日から毎時 401 で死んどった。** 旧 ~/jidec/run_stamp.sh は鍵を直書き(28 字の旧鍵)、URL は旧 workers.dev。
  stamp.log に FATAL 401 が並び、launchd.out は空。**その台本の中身を TOshi がチャットに貼った = 旧鍵がログに残った。401 で死んどる鍵やから実害なし、番人は復唱せん、引き継ぎにも書かん。**
  直し: ops/run_stamp.sh(鍵は ~/.hs_ledger_token、chmod 600、64 字でなければ送らん。URL は ledger.horizonshield.dev。作業 dir は workers/hs-ledger)。plist をそこへ向けて bootstrap + kickstart、
  rc=0 で復活(9/4 20:48 JST)。旧台本は空にした(`: > ~/jidec/run_stamp.sh`)。commit は未(ops/run_stamp_files.txt)
- **27〜31 は全部 Bitcoin 確定**: 27 / 28 / 29 = block 965458(10:09 UTC)、30 / 31 = block 965464(10:38 UTC)。番人が jidec_cite で確認。
  run_stamp が 401 の間に昇格しとるから、台帳側(hs-ledger Worker か jidec_cite の照会時 upgrade)に自前の昇格路がある。launchd の毎時は二重の保険。どっちが書いたかは未確認
- 教訓(今日 4 回目の同じ型): 台本を動かしたら plist を、鍵を回したら鍵を読む全部の場所を、同じ日に数える。launchctl list の終了コードは「0 = 正常」と読んだらあかん(zsh がファイルを開けん時も 0)
- **visibility 復活 1 回目(9/4 20:42 JST): CITED 0 / 15**(競合 14、無し 1)。Claude + web search に相場 5 / 判断 5 / 手口 5 を聞き、引かれた出どころは wikipedia 11 回、rehome-navi 7、meetsmore 5、curama 5、nuri-kae 4、sunrefre 4。
  HORIZON SHIELD はゼロ。**監視の質問(外壁塗装 30坪 相場、シロアリ駆除 費用、給湯器 交換 費用、屋根 葺き替え …)は、今日 pagecheck が「薄い雛形・Google 未登録」と出した qa の 22 ページが答えるはずの質問そのもの。**
  索引されんページは web search に出ん、出んページは LLM に引かれん。0/15 はその帰結。次回の run(毎週月曜 12:00)が比較点。
  **訂正(同夜)**: 15 問の正本は qa の重複 22 ページやなくて souba/ faq/ の直答ページ(12 本既存 + 09-04 新規 3 本、ops/ai_citation_15_map.md)。qa の 22 は別件の薄い雛形。15 問側に足りんのは索引と被リンク
- **動線(TOshi「全業種の窓口、バッジをインフラに」→ 番人「半分正しい、順番が逆」)**: バッジは引用を連れて来ん(引かれた後に剥がれんようにする道具)。「AI がバッジを探す」が今日本当に成り立つのは
  AI が別の MCP に繋ぐ前の行儀確認だけ、そこに先客はおらん。検証の扉の登録簿は **8 本全部自社**、外部ゼロ。バッジ候補 = observatory の開示済み 152 本 / 95 運営者(ops/badge_cohort_disclosers_20260904.tsv)。
  計画と送る文面は ops/doujin_20260904.md(道 A: MCP 窓口、乗る側 95 運営者 + 見る側 Smithery/PulseMCP/mcp.so/Glama/公式、道 B: 建設は索引と被リンク、道 C: 制度の窓口は提携 2 社で 1 か月回してから住まいるダイヤル)。
  作らんもの: バッジ定義ページ(verify-directory/badge/ にある)、見る側向け説明(for-registries/ にある)、全業種ページ、15 問の新ページ
- 明日の 2 通は送る状態: ops/outreach_A_20260904.md。ToolOracle(tooloracle.io = 89 サーバー・1,096 ツールを agent に振り分ける router、trust scoring 自前、独 Herford の FeedOracle Technologies、創業者 Murat Keskin、
  observatory で 54 本が開示済み = 乗る側と見る側を 1 通で)、Smithery/Arcade.dev(KIRA を 98/100 で掲載済み、Discord か GitHub)。送る前に lookup?host= と /e/ の URL をブラウザで一度開く
- qa 重複 22 ページの正体と直し方: ops/qa_dup_decision_20260904.md。56 ページ共通の 781 字(信用財の段落 / 報酬を受け取らん宣言 / 電話の呼び込み / 監修 / FAQ)が原因。
  **複製で共通文を外したら門の重複 13 組 → 0**(本番は触っとらん)。段 1 = 共通文を 1〜2 行 + リンクに(機械、置き換え文は TOshi)、段 2 = 題材固有を出典つきで 500 字以上(14 本は souba-db の get_price_range、2 本は国交省労務単価、1 本はガイドライン、5 本は統合か TOshi)
- run_stamp.sh commit d4ff9293。ops/visibility-runs/ と visibility_last_run.txt は gitignore(生成物)
- 被リンク、Bluesky、hs-femtech-mcp の掲載(別リポジトリ)
- 27〜31 の Bitcoin 確定確認

## 16. ロゴ 6 本と patch 5 本(2026-09-04 21:30〜22:00 JST)

- TOshi「全てのロゴに画像を」。GitHub / 公式レジストリ / Glama に出る絵は server.json の `icons`(512x512 PNG、GitHub raw の URL)。それまで 6 本全部が根の icon.png(金の盾に日の出)を共有しとった
- 6 本を「紺の角丸 512x512」で統一: 本体 hs-mcp = 根の icon.png のまま / KIRA(webmcp)= 受付の書類(番人作)/ 扉 = 光る Wedjat の目(TOshi の絵を加算合成)/ YAKUMO(hearing)= 八角形(TOshi の絵、背景の閾値 0.16)/
  JIDEC = **年輪**(番人作: 歪んだ同心円 9 本、芯に錨の点。TOshi「年輪がなかった」で盾の目から差し替え)/ observatory = 点の列と 1 つの環(番人作)。**TOshi の「盾に Wedjat の目」の絵は未使用、行き先は TOshi 判断**
- 掟(3 点一致)どおり patch を 1 つ上げた: webmcp 1.0.3→1.0.4、gate 0.2.2→0.2.3(red team の min "0.2.2" は通る)、hearing 2.3.0→2.3.1、jidec 1.2.0→1.2.1、observatory 0.1.0→0.1.1。server.json と source を同時に
- TOshi 手: commit 033e63ea(15 ファイル)/ deploy 4 本 + deploy_gate.sh(gate_commit 033e63eaa27c)/ 本番 serverInfo 5 本とも新 version / publish 5 本 success(12:41〜12:48 UTC)/ レジストリ 5 本とも active + icons
- **Glama はまだロボットの絵**: Glama は公式レジストリを自分の周期で取る(今日は 09:16 UTC)。明日同じ頃に見て、変わらんなら Glama が icons を読まん仕様。その時は Glama 側の口を調べる
- 番人の反省: 「gate_version」の grep がスペース入りに合わず空を返した(deploy は成功しとった)。確認コマンドは実際の JSON の形で試してから渡す

## 17. 組み込まれる形 = GitHub Action、そして扉の穴(2026-09-04 22:00〜22:20 JST)

TOshi「続きをやれ！！インフラを撮りにいくんだろ！」。インフラの定義は §15 のまま: 他人が許可を取らずに自分の道具の上に組み込むもの。今夜作ったのはその「組み込まれる形」の 1 つ目。

### 17.1 mcp-conduct-action(Mac: ops/mcp-conduct-action/、tgz sha256 a4cb317974bf13139ce7eacde777bca6bcf3ce4ca0e976a19ae3d1b83b95af10)

- `action.yml`(composite): 入力 endpoint / allow_tool_call(既定 true)/ fail_on_not_verified(既定 false)/ join_register(既定 false)/ gate。出力 status / record_sha256 / recomputed / checked_at / verdict_path。branding shield/blue(Marketplace 掲載の条件も満たす)
- `scripts/check.sh`: curl で POST /check。python の urllib は Cloudflare の managed rule に 403 で弾かれる(扉が /spec で公開しとる既知の制限)から HTTP は curl だけ。200 以外は「要求の失敗、判定やない」で exit 1。join_register で POST /watch(冪等)
- `scripts/report.py`: HTTP 無し。判定を読み、record_sha256 を runner 上で再計算(record_sha256 と recompute_note を外す → json.dumps(separators=(',',':'), ensure_ascii=False) → sha256)。合わんかったら exit 20 → 赤。5 条件 + 06/07 の表を GITHUB_STEP_SUMMARY に。verified 0、held 0(判定やないから落とさん)、pending 10(fail 指定の時だけ落とす)
- 模擬の扉(cloud の python http.server)で 6 通り: verified / pending+fail / held / 改竄 / HTTP 500 / http の endpoint。全部意図どおり。**試験で見つけた自分のバグ**: `$(curl ... 2>/dev/stderr)` は /dev/stderr を O_TRUNC で開き直すから、stderr がファイルの時にログ先頭が NUL で埋まる。外した。ログをファイルに落として cat -A で見んと気づかんかった
- 本物の扉に対する試験は番人の VM から届かん(cloud も device VM も gate.horizonshield.dev への egress 拒否。api.github.com は device VM から届く)。TOshi の Terminal で `MCP_CONDUCT_ENDPOINT=https://mcp.horizonshield.dev/mcp bash ops/mcp-conduct-action/scripts/check.sh` を回して `recomputed: matches` を見るのが真の試験(JSON.stringify と json.dumps の byte 一致)
- 置き場は専用リポ `ogasurfproject-jpg/mcp-conduct-action`(`uses:` は参照先リポ全体を落とす。91MB の本体に載せると他人の CI が遅くなる)。TOshi が mv → git init → gh repo create --public。まだ作っとらん時点で outreach の文面に URL を入れたから、送る前に存在確認の 1 行を ops/outreach_A に足した
- 自社 6 本(mcp / web / hearing / jidec / gate / femtech)を同じ Action で毎週通す workflow = ops/mcp-conduct-own.yml(月曜 03:30 UTC + 手動、fail-fast 無し、判定を artifact 30 日)。TOshi が .github/workflows/mcp-conduct.yml に cp

### 17.2 扉の穴(読んで分かったこと。直しとらん)

`/badge` は登録簿(publicRegister → watchlist)の最新行を読む。登録簿の週次掃引は TOOL_CALL_CONSENT(worker.js のソースに手書きの Set、8 本、全部自社 + p002 + testbed)に無い endpoint には tool を呼ばん → determinism が not measured → status は pending 止まり。つまり**外の運営者は何をしてもバッジが緑にならん**(/check で verified を取っても、バッジは /check を読まん)。同意リストへの追加はコメントどおり「運営者の手作業、所有者からの依頼が無い限り足さん」。
これは設計の誠実さ(申告は所有証明やない)が、道 A の入口を塞いどる形。README には「当面は issue で申告 → 手で追加」「機械的な同意(自分の origin に well-known ファイル)は予定」と書いた。**TOshi が決めるまで約束は仮**。
番人の案 = 扉 0.2.4: 掃引時に `https://<host>/.well-known/mcp-conduct.json` を取り、`{"allow_tool_call": true}` なら所有者の同意とみなす(その場所に置けるのは所有者だけ = 証明)。同意の根拠を verdict の consent_basis に「well-known file on the origin, fetched at <時刻>」と刻む。ソースの Set は残す(既存分)。GitHub OIDC 案(id-token の repository claim と registry の repository.url を突き合わせる)は GitHub 利用者にしか効かんから後回し。

### 17.3 「また失敗してんぞ！」の 2 通(22:00 JST)

GitHub API で直近 40 走行を引いた。20:03 JST の MCP registry publish 失敗 = #5(13321961、description 169 字)、20:05 の #6 で成功、21:41〜21:48 の #7〜#11(絵入り 5 本)も success。20:27 の survey-report 失敗 = #13(341f6049、.gitignore 狭めた直後)、20:32 の #14(a9715667)で成功、21:40 の #15 も success。20:27 以降に赤は無い。GitHub は失敗の時だけメールを送る。

### 17.4 TOshi の決裁待ち(§16 までの分に追加)

- README の 2 文(issue 申告 / well-known 予定)を残すか。残すなら扉 0.2.4 を番人が書く
- allow_tool_call の既定 true(自分の CI から自分の server、が前提。扉は「申告、所有証明やない」と刻む)
- 専用リポ名 mcp-conduct-action でええか。Marketplace 掲載は release v1 を切ってから(今は @main)

### 17.5 その後 20 分(22:20〜22:40 JST): 本物で一致、リポ成立、扉 0.2.4 を書いた

- TOshi が本物の扉で check.sh を回した: status verified、record 30a6d3490d30b7e1a15e29c1220772d4f48212c9f228104c52e4cd6a0a2100d6、**recomputed: matches**(扉の JSON.stringify と python の json.dumps(separators=(',',':'), ensure_ascii=False) が byte 一致した証拠)
- github.com/ogasurfproject-jpg/mcp-conduct-action を public で作成(2dc0774、6 ファイル)。horizon-shield 側は f75621ab(.github/workflows/mcp-conduct.yml + ops/mcp-conduct-own.yml)。初回の手動実行(`gh workflow run mcp-conduct.yml`)はまだ
- 扉 0.2.4 = ops/gate_0.2.4_wellknown_consent.patch(sha256 b189b3cf9475cc444f2d9d54b39bc0f7acfe5f37afd63977b93cd11eac1f2bf3、worker.js / test/redteam_gate.mjs / server.json の 3 ファイル、Mac の原本は未適用)。番人は cloud に写しを取って(worker.js 7380f99b…、recompute.js も要る)そこで当てて試験した
  - 新関数 wellKnownConsent(endpoint) / resolveConsent(endpoint) / checkWithConsent(endpoint, asserted)。/check と MCP の check ツールは checkWithConsent 経由。掃引は resolveConsent(申告は決して使わん)
  - 判定に consent_source(operator_list / well_known / requester / none)、同意が無い時は consent_lookup { well_known: URL, result: 取れなかった理由, how_to_consent: 置き方 }。history の entry に consent_source、/register の行は直近掃引が well_known なら tool_call_consent true、why_not_verified に置き方
  - /spec に well_known_consent { since, path, shape, why, effect }。CONFIG.version 0.2.4、server.json 0.2.4
  - red team: 既存 48/48 のまま + 新 15 手 = **63/63**。同じ 15 手を 0.2.3 に当てると 1/14(唯一通るのは「同意があっても開示が無いのは落ちる」で、これは旧版でも落ちる)= 試験が噛んどる
  - 設計の芯は変えとらん: 申告は証明やない(requester は掃引に使わん)、fail-closed(取れなければ同意無し)、同一 origin のみ(別 origin への redirect は agent card と同じ扱いで拒否)、同意ファイルは同意だけを証明し 5 条件は一切甘くならん(red team で確認)
- deploy 後に番人がやること: mcp-conduct-action の README の「予定」を実物の説明に(→ v1 タグ)、verify-directory/for-registries の 210 行目付近の同意の 1 文に置き方を足す、outreach の文面に「ファイル 1 つで緑」の 1 行

### 17.6 22:40〜23:00 JST: 0.2.4 本番、自社 6/6 verified、番人の誇張を訂正

- TOshi が deploy を 1 本飛ばして registry publish を先に走らせた(レジストリ 0.2.4 / 本番 0.2.3 の食い違いが数分)→ deploy_gate.sh(GATE_COMMIT=b237ce0675ec、Version c15d5b87)→ health 0.2.4 / gate_commit b237ce0675ec / spec に well_known_consent。3 点一致。publish #12 success
- 自社 6 本の初回 CI(mcp-conduct.yml run 33877224891、f75621ab)= 6/6 verified、annotation に record sha: mcp 12e40b90…、web 11fe79a1…、hearing e197faa6…、jidec c3142e8e…、gate cb3f1178…、femtech dc93968e…。upload-artifact@v4 は Node 20 非推奨の警告 → ops/mcp-conduct-own.yml を v7 に(最新 v7.0.1、2026-04-10)
- **番人の誇張を見つけて訂正**: 観測所の「開示済み 152 本」は card に payment / pricing / x402 / AP2 の欄があった意味。扉の条件 3(checkCompensation)が読むのは top-level の compensation ブロック(paid_by / referral_fee / listing_fee)だけ。つまり ToolOracle が /check を叩けば条件 3 は落ちる。旧文「54 of your endpoints already pass the hard condition」は嘘になるところやった。文面を「あなたの card は誰が払うかを別の形で言うとる。扉は 1 つの形で読む。3 つの鍵を足せば通る(JSON 貼れる形)」に直し、ops/outreach_A に訂正の記録を残した(旧文は消さず、誇張やったと明記)
- ops/outreach_A_batch_20260905.md 生成: 開示済み運営者 20(共有ホスト onrender / fly / vercel / railway は host 単位で別運営者、tooloracle と自社を除く、sqlguard は 18 と 19 が同一運営者)。口(連絡先)は未調査。**12 番目が babyblueviper.com = フェデリコ本人**(invinoveritas、32 tools、pricing 欄)= 最初の外部の行の一番自然な相手。営業文やなく DM で「0.2.4 の well-known 同意の初の実地になってくれ」
- mcp-conduct-action(TOshi がフォルダを番人に開けた): README の「予定」を実物に(well-known の置き方、endpoints の絞り方、consent_source、consent_lookup)、report.py が consent_source と置き方を出力(模擬の扉で回帰 4 通り OK)、.gitignore(__pycache__/)。commit / push / tag v1 は TOshi
- verify-directory/for-registries/index.html 210 行目: 同意の 1 文に置き方を追加(code タグ、pagecheck report で新規の赤なし)。引き継ぎ §17.5 追記
- 番人の VM は gate.horizonshield.dev と registry.modelcontextprotocol.io に届かん(egress 拒否)。api.github.com と raw.githubusercontent.com は届く。扉の実測は全部 TOshi の Terminal 経由

### 17.7 23:00〜23:20 JST: push 済み、Mac の網が一瞬落ちて、番人のバグが 1 つ出た

- TOshi: horizon-shield 90257c60(outreach 訂正、batch 20、for-registries、upload-artifact v7、引き継ぎ)、mcp-conduct-action f529daf + tag v1
- 23:0x JST に Mac の網が落ちた(番人との bridge も同時に切断)。その瞬間の tooloracle 実測は `curl: (6) Could not resolve host` = こちら側。扉は無事
- **その失敗が check.sh のバグを炙った**: 要求失敗時に `$VERDICT`(固定名 /tmp/mcp-conduct-verdict.json)に残っとった前回(mcp.horizonshield.dev、verified)の中身を「body:」として表示した。古い測定を今回の結果に見せる嘘。直し: 要求前に `rm -f`、file 名を endpoint の sha256 先頭 12 桁つきに、HTTP 000 は「DNS / 網 / timeout、こちら側」と明記。模擬で「古い file がある + 接続不能」を再現 → 古い body は出ん、正常系 OK。~/mcp-conduct-action/scripts/check.sh(sha256 19bf585f3a2eb25a…)。TOshi の commit + `git tag -f v1` 待ち
- README(mcp-conduct-action)に残余を 1 段落: 同意は origin 単位(card と同じ)。path で多数の運営者を載せる platform では platform が tenant の代わりに同意することになり、tenant 単独では同意できん。endpoints の絞りは狭めるだけ。/spec にはまだ無い(次の扉の版で well_known_consent に scope の 1 文を足す)
- フェデリコ DM(最初の外部の行になってくれ)を ops/outreach_A_batch_20260905.md の 12 番に。endpoint https://api.babyblueviper.com/mcp、同意ファイルは api. の origin。bytes first(gate_commit、63/63、patch の場所)→ 頼み(3 鍵 + ファイル)→ 残余を先に自分で名指し

### 17.8 23:20〜23:50 JST: 実測が文面を裏づけ、20 社の口を埋めた

- TOshi の Terminal で tooloracle.io/ampel/mcp/ を read only で実測(扉 0.2.4): 01 pass / 02 pass / 03 did not pass「compensation block not declared in agent-card」/ 04 not measured、consent_lookup に 404 と置き方、record a8671fdec93251e03d1ffe3ee0b4c12d7224873d777a2298cb6c7950e17c46ea、再計算一致。番人の訂正どおり。ToolOracle の文面にこの実測を 1 段落足した(相手の server を触った事実も含めて)
- mcp-conduct-action a2ea2d1(check.sh の古い body 表示バグ修正 + README の origin 単位の残余)、tag v1 を forced で更新
- ops/outreach_A_batch_20260905.md の「口:」20 件を番人が埋めた(各サイトのトップを WebFetch で 1 ページずつ。伏せ字メールはブラウザで読める)。連絡先が無い 5 社(558686.xyz / aicomglobal / x402-endpoints / fingersai / agentservices.to)は後回し。**見る側候補が 2 社混じっとる**: TWZRD(twzrd.xyz、x402 の pre-spend trust gate、署名付き receipt = 扉と同種の門)と fingers(fingersai.co、merchant trust ranking)。A-1 の「乗れ」やなく A-2 の「並べろ」で話す方が筋。SaSame(srl-sasame.com、MCP-native の実行 + review what happened)も行儀の記録に関心のある相手
- 明日の順(§5 の週の順番は変えん): 朝 GSC 6 本 + ゴミ削除 → ToolOracle(GitHub Discussions か LinkedIn)→ Smithery → フェデリコ DM(12 番)→ 20 社のうち口のある 15 社を tool_count 順。horizon-shield の未 commit: ops/outreach_A_20260904.md、ops/outreach_A_batch_20260905.md、引き継ぎ

### 17.9 23:50〜24:10 JST: TOshi「全部やる」→ 明日の実行票と見る側 3 通

- ops/outreach_miru_20260905.md: 見る側 3 通(TWZRD = 「spend の門と conduct の門、2 つの hash を並べろ」、fingers = 「trust ranking の横に conduct の signal」、SaSame = 「review what happened の前に what was declared」)。3 社とも自分の server が 152 本に入っとるから最後の 1 段落で「自分の行も取れる(3 鍵 + 同意ファイル)」
- ops/asu_20260905.md: 明日の実行票。0 朝の commit → 1 GSC 6 本(URL を canonical から確定: faq/mitsumori-yukokigen-neage、souba/yane-check、souba/yane-fukikae-slate-hiyou、aeo/リフォーム-相見積もり-コツ.html、aeo/火災保険-リフォーム詐欺.html、faq/tenken-shoho-kimari-monku)+ ゴミ sitemap 削除(正は sitemap.xml 1 本、robots.txt 28 行目)→ 2 ToolOracle → 3 Smithery → 4 フェデリコ → 5 見る側 3 通 → 6 乗る側 11 社(口の無い 4 社と重複を除いた数)→ 7 物差し → 8 番人の仕事
- 扉の cron は 0 18 * * * UTC = 03:00 JST(deploy 出力より)。登録簿に他社の行が乗ったら、consent_source が well_known で読めとるかを最初に見る

### 17.10 00:10〜01:00 JST(09-05): 「今日から客を募れ、必ず通るインフラを作れ」

- 番人の答え(TOshi に送った): 「必ず」は力では作れん。通らん方が損になる場所に扉を置くだけ。場所は 3 つ = 繋ぐ側(クライアント)、一覧(レジストリ)、払う瞬間(x402 / AP2)。加えて形を標準にする(誰が測っても形はうちの形)
- 投稿: Chrome 拡張 offline、内蔵ブラウザは github.com を高リスクで 1 動作ごと承認 + 初回読み込み拒否 → TOshi の Terminal から `gh issue create`。番人が相手の repo を調べた: ToolOracle は個人アカウント 92 repo で Discussions 無し → 測った endpoint の repo `ToolOracle/ampeloracle`。Smithery の cli は `arcadeai-labs/smithery-cli`(833 星)へ移転。本文は ops/issue_tooloracle_ampeloracle.md / ops/issue_smithery_cli.md(+ .title)。**立った: ToolOracle/ampeloracle#1、arcadeai-labs/smithery-cli#810**(API で open 確認、投稿者 ogasurfproject-jpg)。TWZRD は Gmail に下書き(hello@twzrd.xyz)→ TOshi「送信したぞ」
- **mcp-conduct**(npm、依存ゼロ、Node 18+、試験 17/17、ops/mcp-conduct_20260905.tgz sha256 e03f9ba39ce18a2b…): 繋ぐ直前に /is-verified を読み、policy(warn 既定 / measured / verified-only / off)で止めるか決める。verified は true か null だけ。扉が読めん時は unavailable(サーバーの判定やない)。`guard(client)` で MCP SDK の connect を包む(transport の _url から endpoint)。`checkFresh()` は POST /check + 判定 hash の再計算(同意は申告せん)。`checkMany()` は /feed/batch 50 本ずつ。名前 mcp-conduct は npm で空き(404 確認)。TOshi の手: tar 展開 → npm test → git init → gh repo create ogasurfproject-jpg/mcp-conduct → npm whoami → npm publish
- **標準の提案書の下書き** ops/MCP_CONDUCT_WELLKNOWN_v1_draft.md: /.well-known/mcp-conduct.json v1 = version / allow_tool_call / endpoints / compensation(card と同じ形)/ contact。所有者だけが置ける場所に「同意」と「誰が払うか」を置く。card との不一致は報告して選ばん(提案、未実装と明記)。origin 単位の限界を明記。公開質問 3 つ。出す先は MCP の Discussion / SEP と A2A。TOshi が読んでから
- 正直な位置: 繋ぐ側の部品は「入れた人だけ」に効く。必ずにするには SDK の例、LangChain / OpenAI Agents の MCP 接続部、Claude Desktop の設定に既定で入ること。提案書はそのための紙

### 17.11 23:20〜23:40 JST: npm 公開、投稿 3 本、README

- **mcp-conduct 0.1.0 が npm に公開**(14:26:30 UTC、maintainer horizonshield、shasum 8f8a92f898a9947f932c20dad656be5c832e5132、registry で確認)。TOshi が npm アカウント horizonshield を作成(メール contact@、2FA = security key、GitHub 連携 ogasurfproject-jpg、Full Name The HORIZONs Co., Ltd.)。番人はアカウント作成・パスワード・2FA・recovery codes に一切触れとらん(掟)。途中の躓き: npm login の「Press ENTER」で文字を打って旧方式に落ちた → Enter だけで通る。publish の 403 は 2FA 未設定 → 設定後にブラウザ承認で通った
- mcp-conduct のリポ: c259cf3 → 6bf56d2(Node 18 修正)。CI は次の走行で 3 本緑のはず
- `npm warn publish "repository.url" was normalized` → package.json の repository.url を `git+https://…/mcp-conduct.git` に直して 0.1.1 にするのは後日(publish のたびに TOshi の 2FA 承認が要る)
- ops/posts_20260905.md: LinkedIn(英語、レストランの検査シールの例え、npm と CI と well-known の 3 つの扉、「今は自社だけ」を明記)、X(日本語、長い版 + 140 字版)、Bluesky(296 字)。送るのは TOshi
- README.md に「Three ways in, none of which need us」節(well-known / mcp-conduct-action@v1 / npm mcp-conduct、最後に「今は自社だけ」)。commit は TOshi

## 18. 番人の二重作りと、その始末(2026-09-05 08:30 JST)

TOshi「verify-directory を Anthropic にも出したい」→ 番人がページを読んで、**自分の落ち度を 2 つ見つけた**。

- **落ち度 1**: verify-directory には既に「Claude で使う」の節(#assistant)が在った(Claude Code の 1 行 / Desktop / Cursor / VS Code / ChatGPT / GitHub Actions / 生の curl、09-03 に作った物)。番人は見んまま「無いから作ろう」と言うた
- **落ち度 2、こっちが重い**: GitHub Action も既に在った。`ogasurfproject-jpg/wedjat-check-action`(09-03 push、v1 タグ、check.mjs)。番人は 09-04 の夜、それを知らんまま `mcp-conduct-action` を作り、TOshi に repo 作成と npm の 2FA まで踏ませた。**先に repo を見んかった番人の落ち度**。TOshi の時間を 1 回無駄にした
- 機能は先に在った方が上: `require` が 3 段階(measured-pass 既定 / verified / none)、`must_pass` で条件を名指し、`unmeasured_conditions` を独立の output に。番人の方は fail の可否 1 つだけ

### 18.1 始末(TOshi「お前の推奨でいく」)

- **正本は wedjat-check-action@v1**。理由: 先に在った、機能が上、verify-directory の EN/JA が既にそっちを指しとる
- `mcp-conduct-action` は **消さん**(09-04 夜に ToolOracle/ampeloracle#1 と arcadeai-labs/smithery-cli#810 で URL を外に出した。死んだリンクは誰の得にもならん)。README を統合の告知に差し替え、archive する。中身は git 履歴に残る
- npm の `mcp-conduct` は **重複やない**(繋ぐ側のライブラリ、Action とは別物)。そのまま残す
- 番人が直した: horizon-shield README.md の CI 節、ops の文面 32 か所(outreach_A_batch 20 / outreach_A 4 / issue 2 本 / posts / doujin / asu / WELLKNOWN 草案)。既に送った 2 通の issue の URL は直せんが、統合告知がその先で受ける

### 18.2 ついでに埋めた、本当に足りとらんかった 2 つ

- verify-directory(EN/JA)の #assistant に **npm `mcp-conduct` のカード**(依存ゼロ、繋ぐ前に登録簿を読む、policy 4 つ、verified は true か null で false 無し)
- #listed の手順に **`/.well-known/mcp-conduct.json` の同意ファイル**(扉 0.2.4)を 1 段追加。「申告では tool を呼ばん、origin に置けるのは所有者だけ、置かんでも determinism が未測定になるだけで落第やない」
- footer の古い表記 `JCCDB v3.1, 10.5281/zenodo.21898745` → `JCCDB v4.0, 95,403 items, ...`(G空間の掲載と一致)

### 18.3 Anthropic に扉(gate)を出す件

- 出すのはページやなく MCP サーバー: endpoint `https://gate.horizonshield.dev/mcp` 、ツール 5 本(get_conditions / check_conformance / verify_verdict / lookup_server / is_verified、全部 read only)、website `/verify-directory/` 、privacy `/verify-directory/privacy/` 、icon は workers/hs-verify-gate/icon.png の raw URL
- **順番**: HORIZON SHIELD の self-serve 管理権が付いてから、その画面で 2 件目として出す。今 2 件目を投げると先方の中で混ざる。09-08(火)まで折り返しが無ければ、現行ポータルから 2 件並べて出し直す

## 19. well-known 同意が外部で初めて通った(2026-09-05 09:23 JST)

### 19.1 経緯(3 時間)

1. 06:47 頃 Federico が資金入りの試験アカウントを提案(空の引数やなく本物の引数で determinism を測らせるため)。鍵を LinkedIn の DM で送ってきた
2. 番人が断る文を書いた。理由は 2 つ、規律やなく構造: (a) 鍵が第三者の保管庫に平文で入ったから、使う使わんに関係無く回すべき (b) **測る側が測られる側の鍵を持ったら、登録簿は他人の資格情報の山になり、破られた日に載っとる全員が破られる**。「緑を金で買った検査器は緑を買っただけ」
3. 断るだけで止めん。代わりの道を同じ段落で出した: **引数は所有者が出す、置き場は well-known の同意ファイル**。草案の公開質問 2 がまさにこれ。コードより先に草案を改訂して送ると約束し、実行した(ops/MCP_CONDUCT_WELLKNOWN_v1_draft.md に sample_call の節、commit 386262f8)
4. Federico の返信(09:19): 鍵をアカウントごと削除して回転、401 で死亡確認。**そして api.babyblueviper.com/.well-known/mcp-conduct.json に本物の sample_calls を公開**。reason / decision / review の 3 本、**MCP の tool 名**と本物の input_schema(REST の path やない = 番人の指摘どおり直っとる)、各エントリに auth_note で「bearer key が要る、鍵無しの経路は今日は無い、せやから determinism は正直に未測定であって失敗やない」と明記
5. 09:23 TOshi が扉で実測:

        status: pending
        consent_source: well_known
        consent_basis: consent file on the origin (https://api.babyblueviper.com/.well-known/mcp-conduct.json) sets allow_tool_call true, read at 2026-09-05T00:23:11.034Z; only the owner of the origin can place a file there
        determinism: not measured: every tool tried (3 of 33) answered empty arguments with an error, so there was no output to compare. An error echo is not a measurement of determinism.

### 19.2 これが意味すること

- **扉 0.2.4 の well-known 同意が、外部の origin で初めて通った**(2026-09-05T00:23:11Z)。昨夜作った道を、他人が最初に歩いた
- 扉は error 応答を determinism の失敗と数えんかった(0.2.2 の直し)。33 本のうち 3 本試して全部 error、せやから「未測定」。**Federico の auth_note が予告した結果と完全に一致**
- 仕様の**外部第 1 号実装**。しかも公開質問 2 を議論やなく実装で答えた: 番人の草案は sample_call(単数)、彼の実装は sample_calls(配列)。**配列が正しい**(tool を複数持つ運営者に代表を 1 つ選ばせる理由が無い)。草案を配列に直し、出どころを明記(ops/MCP_CONDUCT_WELLKNOWN_v1_draft.md)
- 草案に残余を明記: **引数を指名するのは所有者やから、所有者は行儀のええ呼び出しだけを選べる**。測る側は選び直せん(選び直す = 引数を作る = 禁止事項)。できるのは「何を replay したか公開する」だけ。解決やなく命名した

### 19.3 未実装(意図的)

扉は sample_calls をまだ読まん。「設計を先に外へ出し、Merlini の集団に実装やなく設計を撃たせる」と約束したから。今日の determinism は空の引数のまま = 彼の server は未測定のまま。それが正しい状態

### 19.4 同じ朝の他の動き

- 登録簿に **intel.twzrd.xyz/mcp**(TWZRD)が乗った。TOshi も番人も /watch を叩いた覚えが無い = 誰が入れたか分からん。登録簿は依頼者を記録せん設計。2 通目(ops/twzrd_followup_20260905.md)はその「分からん」を書いた
- jidec の 09-04 18:00 の赤(determinism timeout)は 28 回中 1 回。手動 /check で verified に戻った = 一時的、0.2.4 のせいやない
- Anthropic: 承認済み、org ID(UUID)返信済み、self-serve 管理権の折り返し待ち。09-08 が期限、来んかったら現行ポータルから 2 件(HORIZON SHIELD + 検証の扉)並べて再提出。掲載に入れる中身は ops/anthropic_directory_fixes_20260905.md
- Federico が Merlini への引き渡しのため email と GitHub username を 2 回聞いてきた → contact@the-horizons-innovation.com / ogasurfproject-jpg

### 19.5 一本化の取りこぼし 2 件(2026-09-05 09:30 JST に発見、番人の落ち度の続き)

09-05 の朝、Action を wedjat-check-action@v1 に一本化した「つもり」やった。実際には文書だけ直して、**動く物が 2 つ残っとった**。

1. **CI が古い方をまだ呼んどった**。`.github/workflows/mcp-conduct.yml:21` が `ogasurfproject-jpg/mcp-conduct-action@main`。archive したリポを、tag も付けずに `@main` で。毎週月曜 03:30 UTC に回る自社 6 本の測定が、統合告知だけになったリポを引いとった。直し: `ops/mcp-conduct-own.yml` を書き直して TOshi が cp。入力名が違うから機械的な置換では済まん(旧: `allow_tool_call` + `fail_on_not_verified` + 出力 `verdict_path` / 新: `require` + 出力 `record`)。**`allow_tool_call` は落とした**。0.2.4 以降、依頼者の申告は sweep の根拠にならん。自社 6 本の同意は operator_list か well-known から解決される。CI が「自分で自分に許可を出す」形を残しといたら、外に「申告でも通る」と読まれる
2. **npm の README が存在せん入力を宣伝しとった**。`mcp-conduct@0.1.0` の README 末尾に「`join_register` を CI の step に置け」。**`join_register` という入力はどの Action にも一度も存在せん**。番人が書いた時点で嘘。しかも行き先が archive 済のリポ。登録簿に載る道は `POST /watch` 1 本だけ。直して 0.1.1(README の実物の curl 1 行 + wedjat-check-action への差し替え、User-Agent も 0.1.1)。test 17/17 pass、Node 22。publish は TOshi(2FA)

教訓は 09-04 の重複と同じ根: **「直した」と言う前に、動いとる物を grep する**。`git grep mcp-conduct-action` を最初に打っとったら 3 分で済んだ。今回も TOshi の手を余計に 2 回踏ませた

### 19.6 Federico の訂正(09:22)

「GitHub username を選択肢に出したのは自分の勇み足やった。Merlini に確認したら、招待は link を踏む形で、onboarding は email で走る」。**email だけでええ**: contact@the-horizons-innovation.com。返信で GitHub username は出さん(彼が取り消した物をこっちが押し返す形になる)

## 20. 09-05 の一日(古い記述の掃除と、MCP 本体への第 1 手)

### 20.1 公開しとる嘘を 4 つ潰した

今日やった仕事の大半は新機能やない。**自分が過去に公開した、もう本当やない記述を消す**作業やった。4 件とも、外から読める場所にあった。

1. **npm `mcp-conduct@0.1.0` の README** が「`join_register` を CI の step に置け」と書いとった。**`join_register` という入力はどの Action にも一度も存在せん。** 番人が書いた時点で嘘。行き先も archive 済リポ。0.1.1 で撤去(実物の `POST /watch` の curl + wedjat-check-action)。registry で確認済み、latest=0.1.1、shasum a6549d78
2. **CI が archive した Action をまだ呼んどった。** `.github/workflows/mcp-conduct.yml` が `mcp-conduct-action@main`。文書だけ一本化して、動く物を直しとらんかった。wedjat-check-action@v1 に付け替え(入力名が違うから機械置換不可)。**`allow_tool_call` は落とした**(0.2.4 以降、依頼者の申告は根拠にならん。CI に自己申告を残したら「申告でも通る」と外に読まれる)。手動実行で 6/6、artifact 6 本各 3KB = 配管の証明
3. **扉の `/spec` に 0.2.3 の文言が 2 か所。** `conditions.determinism` が「allow_tool_call に true を送れ」のまま(廃れた道を本線として教えとった)、`red_team` が「48 of 48」のまま(**今は 63/63**、自分の成績を 1 版半ぶん過少申告)。本番 `ccff81d15afc` で修正、3 文字列を実測確認
4. **TWZRD 2 通目に嘘 2 つと死にリンク 1 つ。送る直前に発見。** (a)「毎日測る、1 日以内に初回判定」= 嘘。`isDueToday()` で **free 層は 7 日に 1 回**、endpoint の sha256 先頭 4 桁 mod 7 で日を分散。intel.twzrd.xyz/mcp は bucket 5 = **09-08 18:00 UTC** が初回 (b) `/e/intel.twzrd.xyz/mcp` は **今日 404**(publicRegister に行が在る時だけ発行。watched だけの endpoint には無い = 意図した 404)。**URL を開いてから送れという自分の掟に違反しとった** (c) sample_call の段落が古い。訂正版は日付を名指しし、**検算の式まで書いた**(相手に番人を信じさせず自分で確かめさせる)

**共通の根**: 09-04 の重複 Action と同じ。**「直した」と言う前に、動いとる物と公開されとる物を grep する。**

### 20.2 MCP 本体への第 1 手(投稿完了)

出す前に墓場を数えた。trust / verification / attestation の提案 **17 件中 13 件が closed**。生存 3 本(SEP-3140 署名付き宣言、SEP-2787 呼び出し証明、SEP-1913 信頼注記)。**3 本とも「server が自分について宣言する」形**で、外から測る生産者は 1 人もおらん。

- **SEP-3140 には出さん**: 著者が「sponsor が付くまで反応せん」と自分で書いとる
- **`/.well-known/mcp-conduct.json` を単独 SEP で出すのも筋が悪い**: SEP-2127(server card、著者 dsp-ant、sponsor tadasant)が同じ場所を定義中で、別の well-known を出した SEP-1960 は closed。うちの 2 項目は card の `_meta` に vendor prefix(`dev.horizonshield/` は逆 DNS 規則で合法)で入れるのが正しい形
- **SEP-1913 に出した**: このスレッドは 5 か月かけて `evidenceRef` に辿り着き、**二実装の壁**(片方の参照が、もう片方で再計算だけで解決できること)を基準として合意し、いま **adoption evidence を集めとる**。扉の `record_sha256` がまさにそれ

**最重要**: CONTRIBUTING.md に「AI 支援を使ったら PR か issue で開示しろ」とある。**SEP-2668(4,584 台を追跡する実装持ち)が closed になった唯一の理由がこの違反**(@localden: "AI-generated without disclosure and engagement is being automated")。開示行を先頭に置いた。

投稿: 2026-09-05T01:08:03Z、`#issuecomment-5548298612`。43 件目の会話に 44 件目として入った。

**現実的な目標は「SEP を通す」やない。** sponsor が付かんと動かんし、3140 も 2787 も sponsor 無しで止まっとる。目標は maintainer 1 人に登録簿の実在を知らせること。落ちても `dormant` であって `rejected` やない(最長 6 か月)。

### 20.3 作業樹の古い落とし物を 3 件片付けた

1. **aeo の 2 枚が未 commit**。`robots` と `author` の meta。**91 枚中 91 枚が既に持っとる**ので、終わっとる仕事の尻尾。安全に commit
2. **`workers/hs-ledger/nenrin/coordinate-v1/NENRIN_WITNESS_STATE_0001.md` が未追跡**。同ディレクトリの他は全部追跡済み。**Federico の証人陳述を一字も変えず記録した台帳文書**が 09-04 から git の外に置かれとった。sha256 `950edfee4e57835f7bdf7f22e07c54392fad692ad88f5c89aacfee5cdf8a64b4`。MANIFEST_coordinate_v1.md は harness コードだけを pin しとるからマニフェスト破損は無い。**anchor(OTS / 台帳追記)は TOshi の手**
3. **`workers/hs-hearing/src/oauth.js` が未追跡**。同日に書かれた `visibility.js` は追跡済み。誰も import しとらん(配線前)。鍵は全部 `env.*` から、直書きゼロ = 公開リポに出して安全。**ただし fail-open が 3 か所**: `env.SESSION_SECRET || ""` が署名と検証の両方、`env.MYPAGE_SALT || ""` が 1 か所。**空文字は世界中が知っとる鍵**やから、未設定のまま配線した日に誰でも任意の store_id の cookie を偽造できた。3 か所とも fail-closed に(署名は throw、検証は null、mypageK は throw)。同ファイル 80 行目の GOOGLE_CLIENT_ID が既に正しい形やったので、それに合わせた

### 20.4 番人の落ち度(今日ぶん)

- `git status` を device 側で打って `.git/index.lock` を残した。TOshi に `rm -f` を踏ませた。**以後 `git --no-optional-locks` を使う**(実測でロックを残さん)
- deploy と commit の順序を逆に言うた。`deploy_gate.sh` はコミット済みを要求する(SHA がデプロイしたコードを指すため)。TOshi の歯止めが正しく効いて止まった
- pbcopy の後にターミナルからコピーさせる導線を作った。**TOshi の Mac のホスト名とユーザー名を MCP の公開リポに投稿する寸前**やった。送信前に画像で気づいて止めた。以後、貼る物は TextEdit のような清潔な窓を経由させる

## 21. NENRIN の穴を、自分で見つけて自分で公開した(2026-09-05)

### 21.1 見つけた物

チャッピ(ChatGPT)の NENRIN 評価を TOshi が持ってきた。事実関係は 3 つとも実在を確認した(mcp-conduct-register リポジトリ、NENRIN_SPEC_v1.md と DISCREPANCY_0001、README の「0 calls」撤回文)。**捏造やない、本物を読んどる。**

ただしチャッピが挙げた最大の弱点(witness の独立性)は外れ。それは anchored 仕様が既に想定して答えを書いとる。**本当の穴は、coordinate-v1 が病名を付けとるのに NENRIN_SPEC_v1 の gaming analysis に入っとらん物やった。**

**時刻は座標や。** Ring は `instants_sampled` を数える。誰が instant を選ぶかが、Ring の中身を決める。今の扉は `bucket = sha256(endpoint)[:4] mod 7` で測る日を決めとる。**入力が全部公開されとるから、対象が自分の番を計算できる。** anchored 仕様の shim farm への反論は「shim が常時起きとる」前提やが、実際は 7 日に 1 回起きればええ。**18 か月の年輪が 1/7 の値段で買える。**

同じ穴の第 2 の顔: determinism は「server 自身の tools/list の順で最初の 1 本」を測る。**順番を決めるのは server**。扉は residual として開示しとるが、開示は閉鎖やない。

**しかもこの穴は、今朝 TOshi が TWZRD 宛の手紙に bucket の計算式をそのまま書いて渡しとる。** 透明性としては正しく、同時に攻略手順書。両方本当や。手紙は撤回せん(元から公開ソースから導ける)。直す方を書いた。

### 21.2 やったこと(anchored ファイルは 1 バイトも触っとらん)

**まず anchor 状態を確認した。** `NENRIN_SPEC_v1.md` の sha256 は `9ccba2e3...` で `seed_entry_nenrin_spec.json` の `claim_sha256` と完全一致。`NENRIN_COORDINATE_SPEC_v1.md` は `5be2b22e...` で MANIFEST の引用と一致。**両方 anchor 済みで未編集。** 仕様の最終行は「After anchoring, this specification cannot be altered」。せやから訂正は本文編集やなく、古い sha を引用する新ファイルにした。**番人も例外やない、が実際に効いた場面。**

新規 3 本(`workers/hs-ledger/nenrin/coordinate-v1/`):

    c4929b29b6e9f8f2877cc58e3c2e225542a7fe9a1bf805a02374b96750cf4c9f  NENRIN_COORDINATE_v1_ADDENDUM_instants_v1.md
    d18359d3a13c12ebc9ad17604ddae1d42c4141b1a796e3e5f94032d74274b7f8  instant_coordinate.py
    dea9647e78977aa812950bdbcd3a462e19faf7d30f53ec439791089107ff6e54  instant_redteam.py

**規則**: 測る時刻と測る対象を、どちらの当事者も選べん所から導き、導いた座標を判定に出力として埋める。材料は 2 つ、どちらか片方では足りん。

1. **測る側が窓の前に commit して後で reveal する salt**。無いと対象が予測する(他の入力は全部公開)。赤組の control 「salt を持てば予測が的中する」が、salt の秘匿がこの防御の全部やと証明しとる
2. **窓の境界の Bitcoin block height**。無いと測る側が事後に salt を作って好きな instant を主張できる。commitment は窓が開く height より下に anchor されてなあかん

tool は **辞書順に並べた集合**に対して同じ salt で選ぶ。並べ替えでは steer できず、改名すると `tool_set_sha256` が変わって Ring の surface change に出る。

赤組 17/17(attack 11、control 3、misclass 1、residual 2)、offline、決定的。

### 21.3 残余(名前を付けただけで解いてない)

- **salt は窓ごとに 1 回きり**。赤組の「reveal 済みの salt を次の窓で再利用したら完全に予測できる」は、通す試験やなく**失敗を証明するための vector**
- **導出が公平なのは、対象が申告した surface の中だけ**。申告されてない tool は永遠に選ばれん。**その集合は absent やなく unknown**。census が母集団規模で名前を付けた境界と同じで、創設外部証人が最初に指摘した物と同じ
- **品質は測っとらん**。予測できん時刻に予測できん tool で正直に答える server が、でたらめを返すことはある

### 21.4 まだ実装しとらん(意図的)

扉は今も bucket と server の tool 順で選んどる。**コードより先に穴を公開する**のが NENRIN の作法やから、この順にした。閉じたときに、この追補を引用する次の記録を書く。

**実装上の制約を先に明記しとく**: Cloudflare Worker は raw socket を持てんから `sync_headers_p2p.py` を Worker 内で回せん。**salt の commitment と beacon の束縛は offline 側(localheaders が在る所)で作って KV に置き、Worker は消費するだけ**にする。そうすれば「explorer を信用せん」性質は保たれる(ヘッダ検証は p2p 同期済みの手元のヘッダに対して offline で済んどる)。

### 21.5 新規性の主張に足す 6 点目

anchored 仕様は 5 点の組み合わせを新規性として主張しとる。この追補は 6 点目を提案する。

**測る時刻と測る対象を、対象も測る側も選べん。**

CT も Rekor も in-toto も SLSA も、**提出する側が選んだ物を受け取る**。それは彼らの目的には正しい設計や。**時間を通した conduct には間違った設計や。conduct とは、誰も見られることを選ばんかった時に起きる物やから。**

## 22. 09-05 の後半(0.3.0 の実装、離小島、掠奪誌、貼る物の設計)

### 22.1 扉 0.3.0 を本番に載せた

追補 nenrin-instant-v1 を、書いた当日に実装した。

- `workers/hs-verify-gate/src/nenrin_instant.js` を新設(worker.js への埋め込みやなく独立 module。巨大ファイルへの編集を最小にでき、単体で試験できる)
- worker.js 側は 4 か所だけ: import と version、`isDueToday` に coord を通す、`checkDeterminism` の候補順を導出順に、`runCheck` の record に `coordinate_derivation` を足す。`runDailySweep` の頭で座標を 1 回組んで下へ通す(`env` が runCheck に届いてないから、上から渡す形にした)
- `MAX_PER_SWEEP` を 9 から 8 に。**窓の初回だけ beacon の取得が部分要求 +4 乗る。9 やと 45+4=49 で Free 枠 50 に余白 1**、endpoint が 1 つ余計に redirect しただけで掃引が死ぬ
- 本番 `db730dd95ff1`、`/spec` に `instant_coordinate` 節を公開
- 赤組: 新 `test/redteam_instant.mjs` 26/26、既存 `redteam_gate.mjs` 63/63、Python 側 17/17

**設計上の決定を 2 つ記録しとく。**

1. **扉に管理用の書き込み口を新設せんかった。** worker.js に `Authorization` の処理も admin token も 1 つも無い。offline で beacon を作って KV に流し込む案は、**買えず steer できんことが値打ちの計器に新しい攻撃面を開ける**。代わりに Worker 自身に block hash を取らせ、**height と hash を判定に刻んだ**。手元に p2p 同期済みヘッダを持つ側がいつでも反証できる。**計器を信用できる物にするんやなく、計器の主張を反証可能にする**
2. **beacon は 2 源(mempool.space / blockstream.info)が height と hash で一致した時だけ採る。** 1 源しか答えん日は beacon 無しとして旧規則に落ち、落ちたことを判定と掃引の記録に書く

**未証明**: 導出が本番で 1 回も `derived: true` を出しとらん。手で掃引しようとしたが `SWEEP_TOKEN` が食い違って 403(ファイルは 8/9 付 48 文字で存在、Worker 側の secret は設定済み = どっちかが回された)。**09-05 18:00 UTC の自動掃引が初の実走。見張る予約 trig_017PVhPWMsF4ouqYMceejY8o を入れた**

### 22.2 番人の取得経路が古い答えを返しとった

WebFetch で `gate.horizonshield.dev/health` を素で読んだら **0.2.3 / 033e63eaa27c** が返った。本番は 0.3.0 / db730dd95ff1。**クエリを 1 つ足したら正しい値が返った。** URL 単位で溜め込んどる。

**今朝から 3 回目の同じ形**(古い npm README、古い /spec、古い読み取り)。予約 2 本(TWZRD 09-08、今夜の掃引)に**キャッシュ回避の指示と、gate_commit を報告に必ず書く指示**を入れた。

**09-08 の TWZRD 予約に、もう 1 つ重い訂正を入れた。** 手紙で名指しした「09-08」は**旧規則の日付**や。0.3.0 で beacon が取れとったら日がずれる。ずれても失敗やないが、**手紙と食い違ったらその食い違いこそ報告すべき事実**やと書いた

### 22.3 /yakumo/through-list/ が離小島やった

- リポジトリ全体で**このページに張るリンクが 0 本**、sitemap 588 件にも無し、8/30 から誰も辿り着けん
- 中身は「掲載は金で買えん・誰でも検算できる・不合格も見える・買い手のための入口」= **Yakumo の公正さの表玄関**
- 直した: sitemap に追加(589 件)、`/yakumo/` の一覧の**検証の仕組みを説明しとる llmo 2 本の直後**に配置

### 22.4 掠奪的学術誌が受信箱に入っとる

**5 組織以上、2 週間で 8 通。preprint を 1 本出したら住所が業者間で売り回されとる。**

受信箱(要処理): `researchersnexus.org`(**言語学習誌**が建設費論文に)、`premiersciencenetwork.com`(**測量誌**が原価DB論文に、2 通)、`theresearchconsortium.com`、`elivapress.com`(本の営業)
迷惑: Opast(掠奪的出版社の調査対象)、Vivian Cole、Jasmin、JDAEDM

**返信は 1 通もするな。返信は「この住所は生きとる」信号。** 危ないのは金やなく**記録**。ORCID / Zenodo DOI / engrXiv preprint がある所に掠奪誌の掲載が 1 本混ざったら JCCDB の権威づけが薄まる

**本物を潰すな。同じ箱に入っとる**: MDPI `Intelligent Infrastructure and Construction` 原稿 ID `iic-4476502`(担当編集 Lionel Zheng、**進行中の本物**)、**全 邦釘 先生**(東大、「上流のハッシュを下流にコピーしとるだけでは」と指摘してきた相手)、engrXiv / arXiv / OSF / Anthropic ディレクトリ

**見分け方**: 本物は褒めてこん。全先生は欠陥を 3 つ指摘した。掠奪誌は全員が "perfectly aligned" と書く

`prgunone.com` は配信業者の飛び込み営業(番人の当初の推測 = EIN Presswire 関係は外れ)。迷惑で正しい

### 22.5 Federico とのやり取り

彼の貢献 2 つを草案に入れた(commit 0afc71ee)。

1. **replay one の理由**: determinism は "same input twice" であって "different inputs once each" やない。全部 replay しても determinism の読みは良うならん、買えるのは tool の網羅率で別の問い。**番人の草案は結論だけで理由が無かった**
2. **coverage ratio**: 「33 本中 3 本が owner-published」を出せば、tool 単位の cherry-picking が沈黙やなく**見える数字**になる

**番人が一段上の穴を足した: 分母も測られる側が選ぶ。**「33 本中 3 本」と「4 本中 3 本(29 本は最初から申告しとらん)」を比率は区別できん。**辞書順 tool 集合の digest を添える**案を出した。完全性は外から証明できんが、分母が縮んどることは測定間で見える

**Telegram は渡さんかった。TOshi は持っとらん。** Merlini の招待は email で来ると彼自身が書いとる。持っとらんアカウントを DM 1 通のために作る理由が無い。「必要になったら作って handle を送る」と返した

### 22.6 番人の落ち度、今日 3 回とも同じ根

1. 朝: pbcopy の後にターミナルからコピーさせて、**Mac のホスト名を公開リポに投稿しかけた**(送信前に画像で止めた)
2. 昼: `</parameter>` がコマンド末尾に紛れて zsh が落ちた
3. 午前: **貼る本文の中に `TELEGRAM_PARAGRAPH` という差し替え印を置いた。TOshi がそのまま送信した**(削除 → 冒頭 1 行で経緯を書いた完成版を再送、11:20)

**根は 1 つ: 渡す物の中に、渡してはあかん物を混ぜた。**

**掟にする: 貼る物は貼る形そのままで渡す。選択肢も注記も印も本文の外。** 手本は `ops/fed_send_now_20260905.txt`。開いて全選択して貼ったら、それで完成しとる形

## 23. 離小島の全数調査(2026-09-05 午後)

through-list が 1 枚偶然見つかったから、全部数えた。**最初の数字は正しかったが、意味が違った。**

```
html 総数            891
リンク 0             398
  sitemap に在る       133  ← 検索から着地する設計(aeo など)。正常
  sitemap にも無い     265
    隠して正しい        16  ← admin / auth / system / GSC 検証ファイル
    souba 地名テンプレ 235  ← 全部 noindex 済み。前のセッションが意図的に隠しとる(384 字、一致率 98.4% の量産ページ。sitemap に足したら doorway page として全体の評価を下げる)
    blog 抜け殻        25  ← 「移転しました」56 字。隠れとって正しい
    本物で見えんかった  4  ← 今日直した(commit 23dcf64d)
死んだ行               0  ← 最初「41 件」と出たが percent-encoding をほどいてなかっただけ
sitemap 重複          10  ← 除去、589 → 579 → +4 = 583
```

**直した 4 枚**: `/verify-directory/privacy/`(Anthropic に出す URL がどこからも辿れんかった)、`blog/souba-エコキュート-2026-08-18.html`(2396 字の本物が抜け殻 25 枚に混ざっとった)、`souba-konkyo.html`(2748 字)、`yakumo/kensho-zumi-mitsumori/`(**検証済み見積もりの商品ページ、4578 字**。Yakumo の売り物が Yakumo のトップから辿れんかった)

**触らんと決めた物**: `souba.html`(`souba/index.html` と題材が被る。足すと自分同士で競合)、`bank-transfer.html`(振込案内、隠れとって正しい)、`verify-directory/monitoring/start/`(noindex 済み)

**教訓**: 「リンクが無い = 直す」やない。**noindex や抜け殻は、見えんように設計されとる**。数えた後に中身を見んと、235 枚の量産ページを sitemap に足して Google の評価を落とすところやった。

### 23.1 番人の落ち度、今日 5 つ目

sitemap を正規表現で組み直して **589 件を 322 件にした**。元ファイルの書式が混ざっとって、257 行を落とした。**書き出した件数を見て止まった。** HEAD から取り戻し、XML パーサで組み直して 583 件。commit 前に気づいたから本番には出とらん。sitemap は書式を揃えて書き出したから、次は同じ穴に落ちん。

**今日の 5 回は全部同じ根: 作った物を渡す前に数えとらん。** 5 回目で、数える癖が先に動いた。

### 23.2 明日以降に残っとる判断

- `souba.html` と `souba/index.html` の関係(統合するか、片方を canonical にするか)
- blog の抜け殻 25 枚: 301 リダイレクトにするか noindex を付けるか(今は素の 56 字ページ)

## 24. Ring 001 と /history の 30 件天井(2026-09-05 13:00〜13:30 JST)

### 24.1 見つけた穴
- `worker.js` `HISTORY_MAX = 30`、`entries.shift()`。1 endpoint 30 件を超えた古い記録は KV から捨てられとった。「追記のみ、編集せん」は本当やが「捨てん」とは書いてなかった。31 日の月を 1 か月分も持てん。
- 09-04 時点で自前 6 台が 30 件ちょうど(天井)。今夜 18:00Z の巡回で 08-14 が消える寸前やった。登録簿リポの日次 export は表だけで履歴を持たん。
- 監査 10 番は「未確認」やなく穴。実物で確認。

### 24.2 やった事(全部 commit 済、push と配備は TOshi)
- `workers/hs-ledger/nenrin/ring-v1/`: `make_ring.py`(nenrin-ring-v1 生成/検証/鎖)、`ring_redteam.py` 21/21(Mac で確認)、`endpoints.txt`、`fetch_history.sh`、`make_month.sh`、README。鎖の hash は「前の輪のファイル sha256」。最初の版は compact JSON の sha で台帳の sha と食い違う欠陥やった。整形し直した前の輪は `--prev` で拒否。
- export 実施(8 endpoint、30/30/30/28/30/30/30/9 件)。**Ring 001 = 2026-08 × 8 枚**、8/8 --verify MATCH。`rings/2026-08.sha256`(sha f3e589ef...)を **JIDEC entry 32** に append(04:18:49Z、OTS pending)。seed は `workers/hs-ledger/seed_entry_nenrin_ring_2026-08.json`。
- 扉 0.3.1(commit f3a2b189、**未配備**): HISTORY_MAX 400、`/history` に `retention {kept_max, note}`、/spec の説明も同じ事実。判定規則は 0.3.0 のまま。
- 登録簿リポ `mcp-conduct-register`(Mac に clone、commit b2424fb、**未 push**): `scripts/archive_history.py`(全 endpoint の /history を `history/<slug>.json` に append-only 合流、record_sha256 で重複排除、fetch 失敗時は現状維持)、`scripts/make_ring.py`、`.github/workflows/build.yml` に archive step、`history/` と `rings/` の初期値。
- 追補(instants、sha e228dfd8)は **JIDEC entry 33**(04:21:38Z、OTS pending)。これ以降、この追補ファイルは編集せん。直すなら新しいファイルで旧 sha を引く。

### 24.3 Ring 001 の中身(数だけ)
mcp 26/26 verified 23 pending 3、hearing 26/26 verified 23 pending 3、web 26/26 verified 23 pending 3、gate 26 中 reached 18 verified 17 held 9、jidec 24 中 22 verified 22 held 2、p001 26/26 **pending 26**、p002 26/26 verified 18 pending 8、femtech 5/5 verified 5。witness は全部 1(扉のみ)。

### 24.4 残り
- push 2 リポ(horizon-shield ahead 5、登録簿 2 commit)、扉 0.3.1 配備、登録簿 Actions を 1 回手動起動。
- hs-outreach の admin token がチャットに実値で貼られた(13:10 JST 頃)。漏れた扱いで回す。追跡ファイルに実値は無い(git grep 確認)。
- 監査の次: 3($5)、4/5(Federico に witness 依頼)、8(/watch requested_by)、13(claim register)。

### 24.5 追加で出た穴と直し(13:45〜14:10 JST)
- **証人プールが 18 日間 pending。** `/witness` の自己記述は「daily batches で anchor」やが、束ねる口は `POST /witness/anchor`(運営者の手動、鍵要)だけで cron が無かった。08-18 の 2 件(Federico の walk、TOshi の walk)が 09-05 まで放置。監査 9 番の実物。
  直し(hs-ledger、commit 前 / 未配備): `anchorWitnessPool(env, origin, trigger)` に切り出し、`scheduled()` から日次 00:30 UTC(wrangler.jsonc `triggers.crons`)で呼ぶ。entry に `anchored_by: schedule|operator`(canonical の外、hash 不変)。自己記述 3 か所を「00:30 UTC に schedule で束ねる。09-05 までは手動で 2 件が 18 日待った」に書き換え。Bitcoin stamp は Mac の launchd(毎時 run_stamp.sh)が `ots_status != confirmed` を拾う。テスト: `test/ledger.test.mjs` の「routes still 9」は 08-18 から落ち続けとった(12 が正)、12 に直して、束ねの 6 assertion を追加。ALL PASS。
- **ring-v1 に台帳の証人記録アダプタ。** `--witness` に `GET /witness/{sha}` の JSON(jidec-path-v1 walk 入り)をそのまま渡せる。walked_at で月、base か nodes の url で endpoint 一致、verdict.ok false は discrepancies に sha で載る。赤軍 25/25。**anchor 済の Ring 001 8 枚は新ツールでも 8/8 MATCH**(bytes 不変)。
- `ops/fed_witness_request_20260905.txt`: Federico 宛の witness 依頼(貼るだけ)。**hs-ledger 配備後に送る**(本文が「直した」と言うとる)。18 日放置を先に自分から言う形。

### 24.6 扉 0.3.1 の追加分と、もう 1 つの穴(14:10〜14:50 JST)
- **掃引の飢餓。** `due.slice(0, MAX_PER_SWEEP)` は登録簿の並び順で、自前 8 台(日次)が毎日 8 席を使い切る。外部の行は順番が来ても「over MAX_PER_SWEEP」で永久に落ちる。**0.3.0 で 9 → 8 に下げた日に、無料層の唯一の席が消えとった**(TWZRD は 09-04 の巡回後に列に入ったので、まだ実害は出とらんが、次の due 日に必ず出た)。直し: 測ったことが無い行が最初、次に古い順(least recently measured first)。溢れた行の reason に最終測定時刻を書く。自前の 1 台が週 1 で 1 日ずれる代わりに、外部が測られる。
- **/watch に `requested_by`(operator | anonymous)と `owner_file_at_request`(consent | decline | present | absent | unread)。** 最初の依頼者は上書きせん。
- **well-known `listing: "decline"`(値は完全一致のみ)。** origin の所有者だけが置ける「測るな」。掃引は測らず、skipped に理由、登録簿の行に `owner_declined {since, how, effect}`、/watchlist に `owner_declined`。判定は作らん、履歴も増えん。値を消せば次の掃引で再開。/spec の well_known_consent.shape と /register の rows_are_selected_by に明記。**誰でも乗せられる(操作者の拒否権は無し)+ 断れるのは origin だけ、が設計。** TWZRD に「外す」と言うた件は、この機構で本人が機械的に外せる形になった。
- /spec red_team の「determinism は server が先頭に置いた tool で測る」は 0.3.0 で古くなっとった。座標で選ぶ、legacy 時のみ先頭、判定に coordinate_derivation で明記、に書き換え。
- 試験: `test/watch_decline.mjs` 20/20(offline、飢餓 2 本含む)。redteam_gate 63/63、redteam_instant 26/26 は無傷。
- **claim register**(監査 13 番): `ops/claim_register.py`。公言 14 行(扉 version / 履歴保持 / 赤軍 63 / 26+17 / ring 25 / witness の cron 時刻 / pending 48h / OTS 7 日 / anchor 済 bytes の不変と seed の append 漏れ / 登録簿の日次生成 / snapshot 行 = live 行 / 月の輪 / archive 日次 / 飢餓 14 日)。各行に検算。`--offline` で手元だけ。TOshi の端末から週 1(device_bash は扉に届かん)。報告は `ops/claim_register_report.md`。

### 24.7 claim register 初回実走と、DELETE /watch(14:50〜15:10 JST)
- 初回 14 行中 8 FAIL。読み: C01/C02 = 扉 0.3.1 未配備、C06/C07 = hs-ledger 未配備、C12/C13 = 登録簿リポ未 push、C14 = TWZRD 未測定(due 日待ち。飢餓の直しで次の due 日には測られる)。**本物の発見は C09**: seed_entry_3/4/5 の anchor 済 bytes が「手元に無い」と出た。実際は entry 5 が `workers/hs-ledger/path/JIDEC_PATH_SPEC_v1.md`、3 と 4 は文書やなくコード(verify_finding_v0.py と hs-pdf-gen の worker.js)で、bytes は `~/jidec/claim_N.txt` に在った。探索範囲の穴で、文書の穴やない。C09 の探索を `workers/hs-ledger/**/*.md` + `claim_*.txt`(hs-ledger と ~/jidec)に広げた。
- **DELETE /watch(扉 0.3.1 同梱)。** TWZRD への手紙で「言うてくれたら同日に外す」と書いたが、外す経路が無かった(KV を手で触るしかない = 見えん編集)。運営 token + 理由 8 字以上必須、自前の行は外せん、外した事実は `/watchlist.removed` と `/register.removed_rows` に墓標(endpoint, removed_at, reason, requested_by, added_at)。履歴は消さん。二度目は 404。`rows_are_selected_by` に明記。試験 29/29(watch_decline.mjs)。
- Federico の LinkedIn(13:14): 自分の tracker も書き換えず追記する、二つの独立した記録が同じ交換を持つ、と。返信 `ops/fed_reply_anchored_20260905.txt`(entry 33 で e228dfd8 は anchor 済、entry 32 = Ring 001、依頼は今日メールで別便)。push 後に送る(本文が「committed in two repositories」と言う)。

### 24.8 監査 7 / 12 / 14 / 17(15:10〜15:40 JST)
- **7**: `coordinate-v1/verify_beacons.py`。/history の全 derived 判定から beacon(height, hash, salt_created_at)を集め、手元の検証済ヘッダ(localheaders.py、API 無し)で (1) その高さの hash が一致するか (2) salt が block time(+2h drift)より前か、を検算。MATCH / FALSIFIED / BEYOND_TIP(ヘッダ同期が要る、扉の問題やない)。合成テスト 4 本(正常 / hash 違い / salt が後 / tip 超え)で期待通り。今夜の初回 derived 掃引の後に実データで初実走。claim register に C15 として組み込み。手元ヘッダは 961632..965451(09-04 同期)、今夜の beacon は tip 超えの可能性が高いので `sync_headers.py` を先に。
- **12**: RECOMPUTE_NOTE に「検証したのは JS と Python の 2 言語のみ。他言語では key の順と数値の表記をそのまま。並べ替える encoder では再現せん。応答は人間向けに indent されとって hash した bytes やない」を追記(扉 0.3.1 同梱)。
- **14**: `ops/keys_inventory.py` → `ops/keys_inventory.md`。workers/*/src の `env.NAME` から生成、**54 個の秘密名 × 25 Worker、回転日不明 52**。値は読まん。既知: LEDGER_ADMIN_TOKEN(3 Worker 共有、09-04 回転)、SWEEP_TOKEN(手元ファイルと不一致)、hs-outreach ADMIN_TOKEN(今日チャットに実値、要回転)。規則 4 つ(露出即日回転 / 四半期 / 手で打たん / 封筒の索引)。
- **17**: trigger `trig_01C6xX…`(09-07 自動送信)に手順 1b を足した: thread の最新が自分の送信で 09-05T06:00Z 以降なら送らん、`to:directory@… in:sent after:2026/09/05` に別便があれば送らん。本文は不変。
