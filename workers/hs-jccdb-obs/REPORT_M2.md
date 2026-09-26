# REPORT_M2: hs-jccdb-obs v0.3(米国の建設費データベース)と hs-mcp patcher v2 の手直し(2026-09-26)

担当 M2-mcp-v03 が作り、番人がデータの直し(独立検証 V5)の後に組み立て直して試験を通した。

## 結論
- 観測層 v2 の全量(日本 331,946 行、米国 2,853,445 行)を D1 2 つに入れる形にした。DB(日本 + v0.1 の items / obs)275 MB、DB_US(米国)1,585 MB(SQLite に流して実測)。米国は Workers Paid が前提。
- 試験: harness 242 pass / 0 fail(fixtures と、本番の SQL をファイルの DB に流した全行の検査)、itest_v2 79 pass / 0 fail(実データ)。
- 本物の D1 にはまだ流していない。50MB の SQL ファイルを wrangler が受けるか、FTS5 の組み立ての文が D1 の時間の上限に収まるかは、流したときに分かる(受けなければ --max-mb 20 で作り直す。FTS5 が通らなくても米国の検索は LIKE で答える)。

## 変えたもの
- schema/0003_obs3.sql: 両方の D1 に当てる表の形(notes 表、members 表、evidence_url と license は台帳と同じなら持たない、rid を主キー、索引 4 本、米国は FTS5)。0002 は流さない。
- tools/make_d1_sql_v3.py: --country JP|US で国ごとに作る。検査器を先に全行に走らせ、行を読みながら書く(メモリの山 248 MB)。1 文 90,000 bytes まで、1 ファイル --max-mb まで。MANIFEST.json。
- src/worker.js: DB と DB_US を国で選ぶ。country の無い呼び出しは両方を引いて束ね、片方が読めないときは partial:true と parts で正直に返す。新しい道具 3 本(jccdb_us_prevailing_wage、jccdb_us_permits、jccdb_us_area_factor)。REST /us/wage、/us/permits、/us/area-factor。
- wrangler.jsonc: DB_US の binding(database_id は <D1_US_ID>)。
- test/harness.mjs、test/fixtures/: v0.3 用(米国の新しい形の試験用の行は架空、source_id は test-fixture-)。
- hs-mcp-patch/patch_hs_mcp_jccdb_obs_v2.py と itest_v2.mjs: 11 本にした(直す前の写しは .bak.20260926-134055-m2)。

## 実データでの応答(ファイルの DB、1 回の呼び出し)
| 呼び出し | 件数 | 時間 |
|---|---:|---:|
| /us/wage?state=CA&county=Los Angeles&trade=carpenter | 8 | 37 ms |
| /us/permits?geo=Austin, TX&year=2024 | 78 | 33 ms |
| /us/area-factor?geo=NC | 505 | 9 ms |
| /obs?country=US&q=carpenters(FTS5) | 13,678 | 20 ms |
| 同(LIKE に落ちた場合) | 13,678 | 3,842 ms |
| /compare 生コン 24-8-25(20) normalize=namacon | 395 | 81 ms |
| /coverage | 3,185,391 | 716 ms |

## v0.2 から振る舞いが変わった所
- jccdb_sources は既定で 20 件ずつ(出典が 2,458 に増えたため)。
- jccdb_us_prices は既定で米国の全 layer を引く。
- 絞り込みが無く 20 万行を超える呼び出しは索引の順で返し、order_note に書く。
- Davis-Bacon は取り込んだ 30 州(AK〜MT)だけ。郡は名前の一致で照合する(Saint と St. のような書き分けは当たらない)。
