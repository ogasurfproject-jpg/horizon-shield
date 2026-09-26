# REPORT_M1: hs-jccdb-obs v0.2 と hs-mcp patcher v2(2026-09-26)

担当 M1-mcp が作り、番人が「行を載せない出典」の扱いを足した。M1 の報告の本文は下の「M1 の報告」。番人の追記が先。

## 番人の追記(M1 の後に変えたこと)

- 出典が表の複製・転載・電子媒体への加工を禁じているもの(中部 cbr、東北 thr、四国 skr、奈良県)は、値だけでなく行の一覧も D1 に入れない。
  - 観測層では observations_restricted/ に置く(検査器は検査する。組み立ては読まない)。
  - coverage に listed 列を足した(0 = 件数だけ)。make_d1_sql_v2.py は observations_restricted/ から件数だけを coverage に入れる。台帳に row_listing=not_in_public_build が無ければ止まる。値が入っていても止まる。
  - jccdb_observations は、地域か出典を指定したとき not_listed(出典、件数、状態の内訳、理由、原本の URL)を返す。奈良の生コンなら、近畿地整の 72 行(値あり)と、奈良県の表 1,584 セル(刊行物 803 / 値は公開だが複製禁止 744 / 設定なし 37)の件数と理由が返る。
  - jccdb_coverage は layer ごとに not_listed_cells、出典ごとに row_listing / rows_in_db / why_not_listed を返す。
- 建設工事費デフレーターの四半期別(2020年4-6月期以降)と年度別(2021年度以降)の 33 列 990 行は、月別に対して1列右にずれている疑いが強いので observations_hold/ に移した(組み立てに入らない)。
- 米国 SD / MT の DOT は条件が「personal or informational use」まで(MT は「改変しない限り」)なので、値を外した(published_restricted_not_copied)。品目の並びは残した。
- jccdb_compare_regions に normalize: "namacon" を足した。生コンの規格を、セメントの種類・呼び強度-スランプ-粗骨材の最大寸法・水セメント比の上限・単位セメント量の下限で束ね、局ごとの書き方の違い(２４－８－２５（２０） [Ｗ／Ｃ＝５５％以下] と 24-8-25(20) W/C≦55%)を越えて比べる。束ねるのは layer material の行だけ。束ね方はこのサービスの読み取りなので normalized.computed:true。実データで 24-8-25(20) の普通・W/C55 は 4 局 113 地区が1つの組になる(最小 17,500 / 中央 27,375 / 最大 37,900 円/m3)。hs-mcp の compare_jccdb_regions にも normalize を足した。
- 独立検証(verify/V3)で、本番用 SQL は MANIFEST の sha256 209/209 一致、restricted の値 0、行を載せない出典の行 0、保留の行 0、行数が CSV の合計と一致。
- D1 の大きさ(実測): obs2 部分 504 MB(表 382 MB、索引 122 MB)。Workers Paid が前提。
- 試験(最終): harness 147/0(fixtures と本番の sql_v2 414,587 行)。itest_v2 65/0。

## 実データでの応答の例(node:sqlite、1回の呼び出し)

| 呼び出し | 結果 | 時間 |
|---|---|---|
| jccdb_observations 生コンクリート / 奈良 | 近畿地整 72 行(値あり)+ not_listed 奈良県 1,584 セル | 311ms |
| jccdb_compare_regions 生コンクリート 21-8-25(20) | 4,283 組(局ごとの規格の書き方で割れる。下の懸念6) | 385ms |
| jccdb_work_unit_price ブロック積 | 1,259 パッケージ行 | 111ms |
| jccdb_us_prices carpenter / CA / wage | 65 行 | 31ms |
| jccdb_coverage JP | 299,517 行(値あり 273,760)、行を載せない 21,986 セル | 30ms |

## M1 の報告

### 結論
- hs-jccdb-obs v0.2 は出来た。観測層 v2(日本と米国の全 CSV)を obs2 表から読む。既存の4本は引数と返りの形を保ち、新しい5本を足した。
- patcher v2 は、手つかずの mcp.js にも v1 が当たった mcp.js にも当たる。どちらの道でも出来上がりは同じバイト列になる。
- 本番の前に決めること: D1 のプラン(懸念1)。

### 変えたもの(v0.1 を写してから変えた。v0.1 は1バイトも変えていない)
- schema/0002_obs2.sql: obs2 表(SCHEMA.md の全 27 列 + computed / norm / period_key / src_file)、索引(country、layer、geo_code、source_id、period_key、norm、(layer, country, geo_code))、sources2 表(台帳の JSON)、coverage 表。何度当ててもよい。v0.1 の表には触らない。
- tools/make_d1_sql_v2.py: 全 CSV と全台帳を読む。先に validate_obs.py を走らせ、誤りがあれば止まる。1ファイル 2000 文。出力は sql_v2/ と MANIFEST.json(行数、sha256、流す順)。v0.1 の sql/ には書かない。
- src/worker.js、test/harness.mjs、test/fixtures/(実ファイルと「試験用」の架空の行。source_id は test-fixture-、URL は example.invalid)。
- DEPLOY_TOshi.md、wrangler.jsonc(注記)、.gitignore(sql_v2/)。
- hs-mcp-patch/patch_hs_mcp_jccdb_obs_v2.py: 状態を fresh / v1 / v2 の3つで判定し、全部当てるか、差分だけか、何もしないかを選ぶ。書く前に一時ディレクトリで node --check を通し、読み込んで tools/list を比べる。
- hs-mcp-patch/itest_v2.mjs: 作業用ディレクトリは ./itest_work(緑なら消す)。

### 道具(MCP と REST の両方)
- jccdb_search_items(hs-mcp では search_jccdb_items): 観測の件数を obs2 から数え、layer 別の件数も返す。
- jccdb_observations(get_jccdb_observations): 足した引数 country、geo、layer、status、period、source_id、offset。
- jccdb_labor_rate(get_jccdb_labor_rate): 既定は地域ごとの最新時点。history:true で年ごとの系列。
- jccdb_sources: v0.1 の3出典のまま。全出典は ledger。
- jccdb_compare_regions(compare_jccdb_regions): 地域ごとに最新時点の値を並べ、最小・中央・最大と状態別の件数。
- jccdb_work_unit_price(get_jccdb_work_unit_price): 構成比の行を obs_id でパッケージに添える。構成比は入れ子(K と K1)なので合計は出さない。
- jccdb_index_series(get_jccdb_index_series): 前年同期比は computed:true。query が無いときは系列の一覧。
- jccdb_us_prices(get_us_construction_prices): bid_item、wage、equipment、spending、cost_sqft、house_price。州を指定すると全国一律の行も付ける(geo_match で区別)。
- jccdb_coverage(get_jccdb_coverage): 0 行の組み合わせは absent に「無い(取り込んでいない)」と書く。
- 地域の正規化: 県名・ローマ字・JIS(29, JP-29)、州名・略号・FIPS・カタカナ、郡 FIPS、市区町村コード。「29」のように県と州の両方に読めるコードは、country が無ければ ambiguous_region。v0.1 の normPref が kyoto と gifu を読めなかった誤りも直した。

### 返答の約束
- 読めなかったとき: error、code、fetch_failed:true、source_read:false。件数は言わない。REST は 503、MCP は isError。入れ直しの途中は obs2_loading(meta の built_v2 が最後の文で入るので、それを関所にした)。
- 0 件のとき: count:0、lookup:absent、source_read:true。「その layer がまだ1行も無い」のか「行はあるが条件に合わない」のかを言う。
- 引数の誤り: invalid_argument:true、fetch_failed:false。
- 値の行: license、attribution(台帳から)、evidence_url を必ず付ける。
- BASIS_NOTE は日本と米国の2つ。STATUS_LEGEND は7つの状態すべて。
- computed: このサービスが計算した値(中央値、前年同期比、1m2 あたり)と、観測層の組み立てで計算した値(note に「原本に無い値」)は true。原本の値は false。

### hs-mcp で v1 から変えたこと(v1 の3本にも効く)
- 失敗の返し方: v1 は成功の結果に fetch_failed:true を入れていたので、共通の包みが source_read:true を足して食い違っていた。v2 は既存の failTxt で isError にした。
- 引数の誤りは isError + invalid_argument。
- 既存ツールの定義(tools/list)は、当てる前と後で1文字も変わらない。get_price_range の返りの形も itest で比べた。

### 試験
| 試験 | 結果 |
|---|---|
| harness(fixtures + 実データ、最終) | 147/0 |
| itest_v2 + 実データ | 65/0 |
| v0.1 harness(元) | 25/0 |
| v1 itest(元) | 6/0 |

### 残った懸念
1. D1 のプラン: obs2 だけで約 450MB、書き込みは索引を含めて約 290 万行、検索は全行を読む。Workers Paid が前提。
2. computed の判定は note の「原本に無い値」に頼っている。
3. inputSchema の layer enum は 10 個。layer が増えたら足す。
4. hs-mcp の isError のときは structuredContent が付かない(hs-mcp の既存の作り)。
5. 地域の比較: 局ごとの規格の書き方で組が割れる(生コン 21-8-25(20) で 4,283 組)。直すには規格を分けた列(強度・スランプ・骨材寸法・セメント種別)が要る。
6. 施工パッケージの標準単価は東京地区・基準年月の値。比較の道具は地区の補正をしない。
