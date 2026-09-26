# US-F-city-permits 報告: 米国の市の建築許可の申告工事額の分布

作成 2026-09-26 / 担当 US-F-city-permits

## 結論

1. 再利用を明示的に許す条件が確かめられた 7 市(New York City、San Francisco、Seattle、Austin、New Orleans、Boston、San Diego)の建築許可データから、市 x 年 x 許可の種類 x 工事の区分 ごとの件数・申告工事額の合計・中央値・25/75 分位と、面積の列がある 5 市は 1 sqft あたりの中央値を作った。12 ファイル 7,781 行(値あり published_open_terms 7,334、有効な申告額が 1 件も無い区分の合計 not_set 447)。検査器は私の 12 ファイルと 7 台帳で誤り 0。
2. 期間は 2023〜2025 の 3 暦年(San Diego は年別ファイルがある 2024・2025 のみ)。全市とも直近 3 年に絞った。
3. 照合は全市で不一致 0: API に別に数えさせた 月 x 区分 の count(*)・count(値)・sum(値)と、分布の応答を手元で足した値が、区分の全組で件数・非欠け件数・合計とも一致(San Diego は同じ CSV を pandas で読み直して一致)。
4. Chicago、Los Angeles、Denver は利用条件に再利用を許す条文が無いので取り込んでいない(下に条文)。Philadelphia は許可データに工事額の列が無い。
5. 申告工事額は申請者の申告で、実際の契約額ではない(全行の note に書いた)。New Orleans の EstProjectCost だけは原本の説明が「construction contract の写し、自主施工なら明細見積に基づく」。

## 作ったもの

| ファイル | 行 | 中身 |
|---|---:|---|
| observations/us/spending_city_permits_nyc_2023_2025.csv | 369 | job_type x building_type(DOB NOW 初回申請、first_permit_date の年) |
| observations/us/cost_sqft_city_permits_nyc_2023_2025.csv | 73 | Initial Cost / Total Construction Floor Area の中央値 |
| observations/us/spending_city_permits_sf_2023_2025.csv | 1,343 | permit_type / permit_type_definition x proposed_use |
| observations/us/spending_city_permits_seattle_2023_2025.csv | 599 | permittypemapped / permittypedesc x permitclass |
| observations/us/spending_city_permits_austin_2023_2025.csv | 653 | work_class x permit_class(Building Permit、AUSTIN FULL PURPOSE) |
| observations/us/cost_sqft_city_permits_austin_2023_2025.csv | 56 | Total Job Valuation /(total_new_add_sqft + remodel_repair_sqft) |
| observations/us/spending_city_permits_neworleans_2023_2025.csv | 2,196 | permittypemapped / permittypedesc x permitclass(mapped が Other を除く) |
| observations/us/cost_sqft_city_permits_neworleans_2023_2025.csv | 46 | EstProjectCost / TotalSqFt |
| observations/us/spending_city_permits_boston_2023_2025.csv | 1,583 | permittypedescr x worktype |
| observations/us/cost_sqft_city_permits_boston_2023_2025.csv | 32 | declared_valuation / sq_feet |
| observations/us/spending_city_permits_sandiego_2023_2025.csv | 820 | APPROVAL_TYPE x JOB_BC_CODE_DESCRIPTION(2024・2025) |
| observations/us/cost_sqft_city_permits_sandiego_2023_2025.csv | 11 | APPROVAL_VALUATION / APPROVAL_FLOOR_AREA |

- 行の種類(price_basis): count(件数、unit permits)、permit_valuation_total_usd(合計)、permit_valuation_median_usd / _p25_usd / _p75_usd(許可 1 件あたり)、permit_valuation_per_sqft_median_usd(layer cost_sqft)。許可一覧への追加は tools/extra_enums/US-F-city-permits.json に理由つき。
- 各 区分 x 年 について、工事の区分ごとの行と「(all <列名>)」の行(許可の種類の全体)を作った。
- 列: category = 許可の種類(原本の語)、item_name = 「許可の種類 | 工事の区分」、spec = 列名=値 と抽出条件、ref_value = 計算に使った件数、note = 「原本に無い値。n 件の申告工事額の中央値」、除いた件数、合計の行は最大の申告額とその割合、Census place GEOID、市ごとの注意、申告額は契約額でないこと。
- geo_level city、geo_name は市名。geo_code は州 FIPS 2 桁にした(下の「親に判断を回すもの」1)。place GEOID(NYC 3651000、SF 0667000、Seattle 5363000、Austin 4805000、New Orleans 2255000、Boston 2507000、San Diego 0666000)は note に。area_label は空(市全体)。
- parser: tools/parsers/parse_us_city_permits.py(raw の応答と CSV から 12 ファイルと reports/US-F-city-permits_checks.json を作る。2 回走らせて md5 一致)。走らせたあと tools/apply_decisions_20260926.py も走らせ、どのファイルも変わらないことを確かめた。
- 台帳: sources/city-nyc-permits-w9ak-ipjd.json、city-sf-permits-i98e-djp9.json、city-seattle-permits-76t5-zqzr.json、city-austin-permits-3syk-w9eu.json、city-neworleans-permits-72f9-bi28.json、city-boston-permits-6ddcd912.json、city-sandiego-permits-development-permits-set2.json。台帳の sha256 は raw/<source_id>.manifest.json(応答ごとの URL・bytes・sha256・Apify dataset ID の一覧)のバイト列の sha256。

## 計算の決まり(全市共通)

- 有効な申告額 = 100 ドル以上 10 億ドル未満。欠け・0・100 ドル未満(1 ドルなどの置き値)・10 億ドル以上を除き、除いた件数を行の note に書いた。10 億ドルの上限で除いたのは Austin 2023 の 81 億ドル x 6 件(C- 213 Hotels 5 件、C- 106 Mixed Use Shell 1 件)だけ。
- 分位は線形補間(Hyndman-Fan type 7、numpy の既定)。中央値・分位は有効な申告額が 10 件以上の区分だけ。件数と合計は全区分。有効な申告額が 1 件も無い区分の合計は not_set(0 ドルではない)。
- 1 sqft あたり = 許可ごとの 申告額 / 面積 の中央値。有効な申告額で面積 100 sqft 以上の許可だけ(NYC には面積 1 の置き値がある)、10 件以上の区分だけ。
- 分布は API に「区分 x 申告額(x 面積)ごとの件数」を返させて 1 件も落とさずに持ち、手元で計算した(SoQL に median が無いため)。金額は Decimal、小数 2 桁に丸め。

## 取った出典と利用条件の判断

| 市 | データセット | 取り方 | 利用条件の判断(根拠) |
|---|---|---|---|
| New York City | DOB NOW: Build - Job Application Filings(w9ak-ipjd) | SoQL 年ごと 3 回 + 月別照合 | OPEN-TERMS。NYC Administrative Code § 23-502 d「Such public data sets shall be made available without any registration requirement, license requirement or restrictions on their use ...」。データセットの license 欄は空 |
| San Francisco | Building Permits(i98e-djp9) | SoQL 1 回 + 月別照合 | OPEN-TERMS。DataSF terms of use IX「Data is made available under the Public Domain Dedication and License v1.0」、license 欄 PDDL |
| Seattle | Building Permits(76t5-zqzr) | SoQL 1 回 + 月別照合 | OPEN-TERMS。license 欄 Public Domain。条件は個人の一覧の商用利用の禁止のみ、「data on this site does not require specific attribution」 |
| Austin | Issued Construction Permits(3syk-w9eu) | SoQL 年ごと 3 回 + 月別照合 | OPEN-TERMS。「Data available through the City of Austin Open Data Portal are offered free and without restriction ... datasets ... are in the public domain」。license 欄の 'Public Domain U.S. Government' は連邦の表示なので US-PD にはしない |
| New Orleans | Permits - BLDS(72f9-bi28) | SoQL 1 回 + 月別照合 | OPEN-TERMS。license 欄 CC0 1.0、市の頁「This data is free to use and free to share.」 |
| Boston | Approved Building Permits(CKAN resource 6ddcd912-32a0-43df-9908-63574f8c7e77) | datastore_search_sql 年ごと 3 回 + 月別照合 | OPEN-TERMS。license 欄 PDDL(isopen true)。市の Terms of Use は Analyze Boston を含み、後援を装わない等の注意のみ |
| San Diego | Approvals for development projects(development-permits-set2)年別 CSV | Range 3 MB x 10 回 x 2 年 | OPEN-TERMS。データセット頁の License が ODC PDDL。Terms of Use に再配布の制限なし |

- 原本の置き場所: 7 出典とも再配布できる条件なので raw/。API 応答 24 本(views / package の JSON 6 本を含む)と San Diego の CSV 2 本。San Diego は 28,897,173 bytes と 29,230,352 bytes で、つないだ bytes が Content-Range の全長と一致し、md5 が S3 の ETag と一致(9c2ef3014006cc4c74749f152255c093、e206194d2368007e399642811e3d3948)。
- 条文の写し: NYC の法律の条文は City の Open Data Technical Standards Manual(GitHub CityOfNewYork/opendatatsm、commit fa204a27304262a68f83469c8468f7b00ca8f889)を git clone して行をそのまま(Apify は github.io の取得に失敗)。Austin と Seattle の条件の頁は Socrata のストーリー頁で、Apify raw の頁のソースに埋め込まれた本文を取り出した。ほかは Apify markdown。

## 取り込まなかった市(試した URL と理由)

- Chicago(Building Permits ydr8-5enu): license 欄 'See Terms of Use'。https://www.chicago.gov/city/en/narr/foia/data_disclaimer.html は免責・補償と「Any user of this website providing any software application, or other secondary or derivative application using data supplied at this website shall do the following: Include the following disclaimer ...」「The City may require a user of this data to terminate any and all display, distribution or other use ...」「These Terms of Use do not grant anyone any title or right to any patent, copyright ...」で、再利用を許す明示の条文が無い。reported_cost の列はある(809,178 行に値)。親の判断で開けるなら parser に 1 市足すだけで作れる。
- Los Angeles(LADBS pi9x-tg5x): license 欄が空。https://data.lacity.org/terms-of-use(May 2014)は免責・利用者投稿・行為規範だけで、データの再利用を許す条文が無い。
- Denver(Residential Construction Permits、ArcGIS item 014a873bf7444a658fc2ea0da7ad0704): licenseInfo は「USE CONSTRAINTS ... the user agrees to indemnify and hold harmless ... from any liability arising out of the use, reproduction or dissemination of the data/information provided. NOT FOR ENGINEERING PURPOSES.」の免責・補償のみ。
- Philadelphia(phl.carto.com の permits 表): 工事額の列が無い(permittype、typeofwork、approvedscopeofwork などのみ)。
- ほか: Dallas(e7gq-4sah)は 2020 年で更新停止・license 空、Honolulu(4vab-c87q)は 2025-06 まで・license 空、Mesa(2gkz-7z4f)は RETIRED。Boulder, CO の Construction Permits(CC0、EstProjectCost と面積あり)を見つけたが大都市でないので取っていない。

## 照合の結果(数字)

| 市 | 比べた区分 | 件数の不一致 | 非欠け件数の不一致 | 合計の差 0.01 超 | 年ごとの件数(API = 手元) |
|---|---:|---:|---:|---:|---|
| NYC | 60 | 0 | 0 | 0 | 2023 69,140、2024 73,529、2025 67,279 |
| SF | 408 | 0 | 0 | 0 | 22,087、22,777、23,013 |
| Seattle | 132 | 0 | 0 | 0 | 5,848、5,853、6,334 |
| Austin | 185 | 0 | 0 | 0 | 11,234、10,424、11,018 |
| New Orleans | 587 | 0 | 0 | 0 | 21,316、22,210、20,766 |
| Boston | 337 | 0 | 0 | 0 | 38,533、37,335、36,795 |
| San Diego(pandas と csv) | 285 | 0 | 0 | 0 | 2024 13,906、2025 12,212 |

- 全市で、区分 x 工事の件数行の年ごとの和 = 区分 x (all) の件数行の和 = API の年ごとの件数。
- Boston は別に取った月別の件数(date_trunc('month'))の年ごとの和とも一致(2023: 38,533、2024: 37,335、2025: 36,795)。NYC は最初に探索で取った 年 x 区分 の集計(count と sum。応答は保存していない)とも件数が一致(例 2023 Alteration / Other 54,476 件、2024 Alteration / 1 Family 9,591 件)。

## 数字の例(2025、中央値 [25%〜75%]、件数は有効な申告額の件数)

| 市 | 区分 | 中央値(USD) | 1 sqft あたり中央値 |
|---|---|---|---|
| NYC | Alteration / 1 Family | 36,630 [20,250〜57,400]、8,177 件 | 31(2,735 件) |
| SF | 8 otc alterations permit / 1 family dwelling | 15,000 [7,600〜35,000]、6,368 件 | - |
| SF | 3 additions alterations or repairs / 1 family dwelling | 150,000 [50,000〜300,000]、308 件 | - |
| Seattle | Building Addition/Alteration / Single Family/Duplex | 60,000 [20,000〜150,000]、2,660 件 | - |
| New Orleans | Renovation (Non-Structural) / Single Family | 25,896 [12,212〜48,425]、820 件 | - |
| Boston | Short Form Bldg Permit / INTREN | 50,000 [22,987.5〜125,000]、2,224 件 | - |
| Boston | Short Form Bldg Permit / ROOF | 16,740 [11,100〜27,510]、1,531 件 | - |
| San Diego | Combination Building Permit / Add/Alt 1 or 2 Fam, No Chg DU | 36,558.54 [10,000〜90,551]、1,906 件 | 128.02(12 件) |

## 気づいた原本の問題(値は直していない)

- Austin: Total Job Valuation が 1 ドルの置き値が多い(R- 435 Renovations/Remodel の Repair は 2025 年 2,492 件中 2,370 件)。New / R- 101 Single Family Houses は 0 か 1 が大半(2023: 1,311 件中 784、2024: 1,285 件中 1,118、2025: 1,319 件中 1,305)で、新築の中央値は件数が少ない。C-1000 Commercial Remodel は値がほぼ空。2023 年に 81 億ドルの許可が 6 件(10 億ドル以上として除いた)。
- New Orleans: Mechanical Fuel Gas に 311,284,400 ドルの許可が 12 件(2023、Single Family 2 件を含む)、Electrical Service に 360,329,600 ドル(2024)など、工種の許可に事業全体の額を入れたとみられる値。10 億ドル未満なので合計に入り、合計を押し上げる(合計の行の note に最大値と割合)。
- NYC: New Building は Initial Cost が 0 の申請が多い(2025 年 1,116 件中 有効 194)。面積に '1' の置き値と '1.28854e+006' のような指数表記。
- Seattle: PermitTypeDesc の 'Tenant Improvment'(原本の綴りのまま)。
- SF: 2025 年に permit_type 9 で permit_type_definition が空の許可 130 件。複数住所の許可は住所ごとに行が重なる(primary_address_flag = 'Y' だけにした。除いた行 2023: 1,706、2024: 1,812、2025: 1,877。この数は保存していない探索の問い合わせで見た値)。
- San Diego: 2024 年版に同じ APPROVAL_ID の行が 2 行ある承認が 6 件(原本のまま数えた)。評価額が入るのは各年約 6,500 行(Building Permit / Combination Building Permit が中心)。

## 親に判断を回すもの

1. geo_code: 指示は「州 FIPS 2 桁 + Census place 5 桁」だが、検査器の city の形(2 / 5 / 6 桁)が 7 桁を通さない。SCHEMA の city の定義(「全国地方公共団体コード5桁 か 都道府県コード」)に合わせて州 FIPS 2 桁にし、place GEOID は note に置いた。検査器が 7 桁を許すようになれば parser の geo_code を 1 か所直すだけ。
2. NYC: 法律(§ 23-502 d)で開いたと判断したが、ポータルの条件が参照する NYC.gov Terms of Use IV.1 に「All rights are reserved.」がある(台帳の license_counter_quote)。法律がデータセットについて優先すると読んだ。
3. Austin: 条件に「The City may require the termination of any and all displays, distribution, or other use of any or all of the data for any reason.」がある(Chicago と同じ型の撤回条項)。Austin は「offered free and without restriction」「public domain」を明示しているので開いた。
4. Chicago / Denver を開けないとした判断(条文は上)。

## 次に取るべきもの

- San Diego 2023 年(年別ファイルが無い。全年の Issued approvals 557 MB を Range で取るか、2023 年分だけの別の形を探す)。
- Chicago と Los Angeles(親が開けると判断した場合。Chicago は reported_cost、LA は valuation と square_footage がある)。
- Austin の building_valuation / total_valuation_remodel など別の評価額の列(Total Job Valuation が空・置き値の区分を補えるか)。
- NYC の区(borough)別など area_label を使った市内の地区別の分布、2016〜2022 年への延長。
