# JCCDB 観測層 v2 の形

1行 = 1観測 = (品目 x 地域 x 時点 x 出典)。日本と米国を同じ列で持つ。
JCCDB v4 の本体(95,403 品目: category, item_name, unit と証拠 URL)は「品目が公的資料に実在する」を持つ。観測層は「どこで・いつ・いくらで(または値が公開されていない理由)」を持つ。

## 列

| 列 | 意味 |
|---|---|
| obs_id | 16桁の16進。obs_common.make_id(source_id, 行を一意に決める値...)。同じ入力から同じ ID |
| country | JP / US |
| layer | material(資材・製品) / labor(公的に設定された労務単価・賃金決定) / work(工事の単価: 材工機の複合) / equipment(機械の損料・運転単価) / index(指数) / wage(統計上の賃金) / bid_item(入札単価の集計) / cost_sqft(面積あたり工事費の統計) / spending(工事の出来高・支出の統計) |
| category | 出典の章や分類(原本の言葉) |
| item_name | 品目・職種・工種・系列の名前(原本の言葉) |
| spec | 規格・寸法・条件(原本の文字のまま) |
| unit | 単位(原本のまま。m3, t, 本, 人日, USD/hour, index (2003Q1 = 1) など) |
| geo_level | national / bureau_area / pref / pref_area / city / census_region / state / metro / county / district |
| geo_code | national は JP か US。都道府県は JIS 2桁。州は FIPS 2桁。郡は FIPS 5桁。都市圏は CBSA 等。bureau_area は分かれば都道府県コード |
| geo_name | geo_code の名前(都道府県名 / 州名) |
| area_label | 原本の地区表示(そのまま) |
| area_code | 原本の地区コード |
| area_members | 地区に含まれる市町村等の原文 |
| price | 値。開いた状態のときだけ。数(桁区切りなし) |
| currency | JPY / USD。指数は空 |
| price_basis | 値の種類(obs_common.PRICE_BASES)。design_unit_price_ex_tax、labor_wage_8h、work_unit_price_ex_tax、index_value、wage_hourly_mean、bid_weighted_avg、equipment_rate_hourly など |
| price_status | 下の表 |
| ref_value / ref_note | 参考の値と、それが何か(労務単価の「必要経費込みの参考値」、指数の季節調整値など) |
| period | 時点。YYYY / YYYY-MM / YYYY-MM-DD / YYYYQn / FYYYYY / YYYYHn |
| effective_from | 適用開始日(分かれば YYYY-MM-DD) |
| source_id | 出典台帳 sources/<source_id>.json |
| source_page | 原本の頁(PDF の頁番号か、原本に印字された頁) |
| evidence_url | 原本の URL |
| license | PDL1.0 / GOV-STD-2.0 / CC-BY-4.0 / US-PD-17USC105 / PD / OPEN-TERMS / restricted |
| jccdb_v4_item_id | JCCDB v4 の品目に結べたときの item_id |
| note | 読むときの注意 |

## price_status

| 状態 | 値 | 意味 |
|---|---|---|
| published_pdl | あり | 出典が公開し、PDL1.0 で再配布できる |
| published_cc_by | あり | 政府標準利用規約 2.0 か CC BY 4.0 |
| public_domain | あり | 米連邦政府の著作物など |
| published_open_terms | あり | 再利用を明示的に許す条文がある(台帳に条文) |
| published_restricted_not_copied | なし | 出典は値を公開しているが、利用条件が再配布を許さない。原本で見る |
| publication_based_not_public | なし | 出典の表が市販の物価資料の値を使い、値を公開していない。公的に公開された値は存在しない |
| not_set | なし | 空欄・「-」・単価表の 0(市場性なし等)。その地域・時点では設定していない。0 円ではない |

統計の件数・金額の 0(着工統計で該当する着工が無い、など)は「0 という値」なので、price に 0 を入れ、開いた状態にする(price_basis が count / construction_cost_planned_total / orders_received_total / spending_* / ratio のときだけ許す)。単価の 0 は not_set。

## 出典台帳 sources/<source_id>.json

必須: source_id, country, title, publisher, url, retrieved_at, license, license_url, license_quote(条文のまま), how_read(どう読んだか、どう照合したか), values_copied(値を写したか), sha256(原本か保存した API 応答のバイト列)。帰属表示が要る条件なら attribution。

## 置き場所

| ディレクトリ | 中身 | 公開の組み立て(hs-jccdb-obs の D1) |
|---|---|---|
| observations/ | 値を入れてよい出典の行と、値を写さず状態だけを入れた行 | 入る |
| observations_restricted/ | 出典の表そのものが複製・転載・電子媒体への加工を禁じているもの(台帳に row_listing = not_in_public_build と理由)。値は無い | 行は入れない。件数だけを coverage に入れる |
| observations_hold/ | 原本の誤りの疑いで保留した行(例: デフレーターの列ずれの疑い) | 入れない |
| raw/ | 再配布できる出典の原本 | - |
| raw_restricted/ | 再配布できない出典の原本(リポに入れない) | - |

parser を当て直したあとは、必ず tools/apply_decisions_20260926.py を走らせる(利用条件と品質の判断を当てる。何度走らせても同じ結果)。

## 検査

    python3 tools/validate_obs.py . [--only observations/jp/xxx.csv ...] [--json 出力]

全行を機械で数える。誤りが1つでもあれば終了コード 1。
