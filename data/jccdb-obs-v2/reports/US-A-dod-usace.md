# US-A-dod-usace 報告(2026-09-26)

## 結論

- 国防総省と陸軍工兵隊の建設費の単価・係数・指数を、観測層 v2 に 5 ファイル・計 138,983 行で入れた。検査器(validate_obs.py --only で 5 ファイル)は誤り 0、警告 0。
- 値あり(public_domain)は 132,458 行。値なしは 6,525 行で、内訳は publication_based_not_public 1,492 行と not_set 5,033 行。publication_based_not_public は、表の中で市販の資料(Marshall & Swift、RSMeans、CostWorks、TRACES の Cost Book)由来と示された UFS Table 3 の PUC・SUC と、UFS Table 6 の全行。not_set は、原本で '**'・N/A・$0.00 の欄。
- 照合は全数で行った。3 つの出典とも、別の読み方・原本の中の式・別の年版との照合で、食い違いは 0 か、原本の誤りとして説明できる少数に収まった(数字は下の「照合」)。
- EP 1110-1-8 は 12 地域すべて取れた。現行版(Pamphlet Year 2024)の地域別 PDF は nww の Portals/28 にあり、1 本 3.8〜4.8MB なので分割せずに取れた。
- 取り込んでいないもの: UFS の Table 4-2〜4-4(escalation)、EP の Table 2-2(Hourly Rate Elements)、Table 3-1・3-2(年式の調整係数)、Appendix B(地域係数)。どれも範囲外として残した(「次に取るべきもの」)。

## 作ったファイル

| ファイル | 行数 | layer | status | source_id |
|---|---:|---|---|---|
| observations/us/cost_sqft_dod_ufc370101_2026.csv | 1,118 | cost_sqft | public_domain 370 / publication_based_not_public 628 / not_set 120 | dod-ufc-370101-2026 |
| observations/us/index_dod_acf_2026.csv | 32,978 | index | public_domain 32,978 | dod-ufc-370101-2026 |
| observations/us/work_dod_ufc370101_2026.csv | 864 | work | publication_based_not_public 864 | dod-ufc-370101-2026 |
| observations/us/index_usace_cwccis.csv | 8,503 | index | public_domain 8,503 | usace-cwccis-2026-03 |
| observations/us/equipment_usace_ep1110_2024.csv | 95,520 | equipment | public_domain 90,607 / not_set 4,913 | usace-ep1110-r1-2024 〜 usace-ep1110-r12-2024 |

内訳
- cost_sqft_dod_ufc370101_2026: Table 2 の GUC(施設の種類 79 x $/m2・$/SF = 158 行。値あり 64、'**' の not_set 94)と Table 3(FAC 480 件 x PUC・SUC = 960 行)。
  - PUC: 値あり 252、市販由来 215、N/A 13。
  - SUC: 値あり 54、市販由来 401、参照先・構成が分からない 12、N/A と 0 が 13。
- index_dod_acf_2026: Table 4-1 CONUS 15,549 行と OCONUS 940 行の ACF と Sustainment ACF(2 行ずつ)。geo は次のとおり。
  - CONUS: state(FIPS)。
  - Guam・Puerto Rico・Northern Mariana Islands・American Samoa・Virgin Islands: state(FIPS 66・72・69・60・78)。
  - 外国: country(ISO 3166-1 alpha-2、58 か国・地域、1,438 行)。
  - area_label は Site Name の原文、area_code は RPSUID、area_members は County・City・Zip。
  - セルの値が 2 桁より細かい 599 行では、表示形式 0.00 で丸めた表示値を ref_value に入れた。
- work_dod_ufc370101_2026: Table 6 の 432 品目 x 左右の欄 = 864 行。値は入れず、品目の並びだけを持つ。
- index_usace_cwccis: Table 1(四半期 1Q80〜4Q55*、19 工種 + COMPOSITE、6,080 行)、Table 2(年度 FY68〜FY55*、1,760 行)、Table 3(州の調整係数の現行値、51 行)、Table 4(2014〜2025 の州の調整係数、612 行)。
  - 四半期は会計年度の番号を暦の四半期にして period に入れた。例: 1Q80 は 1979Q4。
  - OMB の見通し(*)の列は note に明記した。
- equipment_usace_ep1110_2024: 12 地域 x 1,592 機械 x 5 列(Avg、Stby、DEPR、FCCM、Fuel)= 95,520 行。単位は USD/hour。
  - Value TEV と CWT、Model、メーカー、カテゴリ、Main/Carrier の馬力と燃料は、spec に原文で入れた。
  - geo_level は usace_ep_region(EP-R1〜EP-R12)。area_members には EP Appendix A.3 の州の原文を入れた。
  - 原本が $0.00 の欄は not_set にした(4,913 行。燃料を使わない付属品の Fuel が大半)。

parser
- tools/parsers/parse_dod_ufc370101_2026.py(3 ファイルを作る)
- tools/parsers/parse_usace_cwccis.py
- tools/parsers/parse_usace_ep1110_2024.py(地域ごとの中間結果を tools/parsers/out/ep1110_r<N>.json に置く)

許可一覧に足したもの(tools/extra_enums/US-A-dod-usace.json、理由つき)
- price_basis:
  - UFS: facility_unit_cost_guc、facility_prv_unit_cost、facility_sustainment_unit_cost_annual、supporting_facility_unit_cost、area_cost_factor、sustainment_area_cost_factor
  - CWCCIS: state_adjustment_factor
  - EP: equipment_standby_rate_hourly、equipment_depreciation_hourly、equipment_fccm_hourly、equipment_fuel_hourly
- geo_level: country(外国、ISO 3166-1 alpha-2)、usace_ep_region


出力 CSV の sha256(parser を走らせ直すと同じ CSV が出ることを sha256 で確かめた):
- observations/us/cost_sqft_dod_ufc370101_2026.csv 7e550d324438ff0c9c1a076c924dec1833b802e3ad5c863427b5617ba1d1b0e5
- observations/us/index_dod_acf_2026.csv 0f13eb8c4d5913fdaa0a06642d4aa81d13c40911a413300675455f81560e8677
- observations/us/work_dod_ufc370101_2026.csv 364829bd1f50860c920e919dbe208693c6d0349f5d30464bda2b99240e4dc261
- observations/us/index_usace_cwccis.csv 73cd83c253f2cabce99fb30daae75ba5f3233604cb6db43ca73b9bf9acab475d
- observations/us/equipment_usace_ep1110_2024.csv 28e194f847548133a8fea8a941e934ea91254302acc432f4435ef6fec81782b1

検査器: validate_obs.py --only で 5 ファイル 138,983 行、誤り 0・警告 0。全体(185 ファイル、3,206,783 行、台帳 2,458)でも誤り 0。apply_decisions_20260926.py を走らせ、observations・sources の全ファイルの md5 が前後で変わらないことを確かめた。

## 取った出典

| source_id | 原本の URL | bytes | sha256 | 取り方 |
|---|---|---:|---|---|
| dod-ufc-370101-2026 | https://nibs-s3-wbdg3-production.s3.us-east-1.amazonaws.com/media/2026-08/ufs_3_701_01_July_2026_Data_Tables_v2_1785874580922_xtunm5w6d8s.xlsx | 2,072,458 | cb6e7cd9f274d2130cfa8963119f83e84f8c62fb30175cd05828c8013a430086 | eliai/base64-encoder-decoder。MD5 が S3 の ETag 00276837c7979aed26603076ab271705 と一致、testzip 異常なし |
| (同・本文) | https://nibs-s3-wbdg3-production.s3.us-east-1.amazonaws.com/documents/2026-07/ufs_3_701_01_07_2026_1785515833242_ilsjl8wg0n.pdf | 260,784 | 2b7a35d4a271baa3a57924dc848688c73fe61bb890809799cdf30d3bca139222 | web-fetch raw。MD5 が ETag と一致(raw/dod-ufc-370101-2026-guide.pdf) |
| usace-cwccis-2026-03 | https://publibrary.sec.usace.army.mil/api/download?id=9fcedc82-37ec-4b3c-e8de-1b9dfc89ebec&filename=CWCCIS_Mar_2026-Combined%20Tables.pdf&token=&preview=true | 413,831 | f8f4e9f42476aae566c2cbc6c286dcacc6b23afbd754266bf4dbd8bce0d0bed8 | web-fetch raw は壊れた。base64 actor で取り直し、/L と一致 |
| (照合用 旧版) | 同じ API の CWCCIS_Tables_SEP-2025.pdf | 707,958 | 42bcb8ef2486f9ce3ed8ae617f1391940e22fe51cfd3eed000a07cdb94ff5d06 | web-fetch raw と base64 で同じ sha256(raw/usace-cwccis-2025-09.pdf) |
| usace-ep1110-r1-2024 | https://www.nww.usace.army.mil/Portals/28/REGION%201%20TABLE%202-1.pdf | 4,791,728 | 6d3467a373c89f3eab79ce8608163d7ee0df5d70ce074fe316cfda2dcc2cdf2b | web-fetch raw(base64)。以下同じ |
| usace-ep1110-r2-2024 | .../REGION%202%20TABLE%202-1.pdf | 4,788,049 | f8bf62a3756dca440acb0123c9380eb047f8ca9d5761f85d795fd89ae5f01436 | |
| usace-ep1110-r3-2024 | .../REGION%203%20TABLE%202-1.pdf | 4,781,886 | 3ff04c9b2e0f9b4231a4244ec41b9183b2332ecd8b25d4274cbdb0fb11040014 | |
| usace-ep1110-r4-2024 | .../REGION%204%20TABLE%202-1.pdf | 4,780,643 | 3657feced19c321c215bed82802e746e080782d84553fb35cf73816f54f5a51b | |
| usace-ep1110-r5-2024 | .../REGION%205%20TABLE%202-1.pdf | 4,787,049 | fb44c18b5dba1c74db18cc4f84a295b6086c704fa289a37e03371bf1d4aa1967 | |
| usace-ep1110-r6-2024 | .../REGION%206%20TABLE%202-1_1.pdf | 4,786,780 | ff7037770845fe2ef8d90c9bbc3c3d1e2a5e8898bf55a3e89f13d8fab3cc5a6e | |
| usace-ep1110-r7-2024 | .../REGION%207%20TABLE%202-1.pdf | 4,789,269 | d63dc10f638783f73415c7d2460895e0ce15af83f2319b2c7d59b5f352e19268 | |
| usace-ep1110-r8-2024 | .../REGION%208%20TABLE%202-1.pdf | 4,785,317 | f7a05eaac3ba9740a6c396003383485afa15603790e16ac68ed79a2f88cb6e58 | |
| usace-ep1110-r9-2024 | .../REGION%209%20TABLE%202-1.pdf | 4,789,999 | 250b19e5f85363b293b5ab9b29ea4cb67c15aa57e306dd8703ec758fa6ee601d | |
| usace-ep1110-r10-2024 | .../REGION%2010%20TABLE%202-1_1.pdf | 3,834,093 | aa94dc3edcb618ca05b92bd4dba4b9c0d17593b82ccb1d7bcf19e4ddbc8adbf8 | |
| usace-ep1110-r11-2024 | .../REGION%2011%20TABLE%202-1.pdf | 4,789,571 | 45d30f2cf40bfd6de01058e1a428ab9d33d1e693772e8da805511d3d49903795 | |
| usace-ep1110-r12-2024 | .../REGION%2012%20TABLE%202-1.pdf | 4,790,435 | edc9843d87118099f13f4a26d8cd36abf9df370d5e8e1b9abc5fd571e4ebb51e | |

EP の 12 本は、どれも bytes が PDF の linearization 辞書 /L と一致し、先頭は %PDF。qpdf --check でストリームの誤りは無い(linearization の hint の警告だけ)。Last-Modified は 2025-01-21、頁の脚注は "EP 1110-1-8 • 30 September 2024"、見出しは "Pamphlet Year 2024"。

利用条件の根拠の文書は、次のとおり raw/ に置いた。
- raw/usace-ep1110-text-2021.pdf(EP 1110-1-8 本文、12 August 2021)
- raw/usace-cwccis-em1110-2-1304-2021.pdf(EM 1110-2-1304、31 March 2021)

## 利用条件の判断と根拠(条文は各台帳の license_quote)

### 全出典に共通する根拠

- 17 U.S.C. 105(a)(Cornell LII から Apify で取得): "Copyright protection under this title is not available for any work of the United States Government, ..."

### UFS 3-701-01(国防総省)

- 表紙: "APPROVED FOR PUBLIC RELEASE; DISTRIBUTION UNLIMITED"。PDF の Author は "Department of Defense"。
- WBDG のサイトの terms の頁は "Terms of Service (To be implemented)" で、条文が無い(サイトの JavaScript で確かめた)。
- xlsx に著作権表示は無い。文書のプロパティの最終更新者は NAVFAC の文官(CIV USN)。
- 判断: public_domain。ただし AGENT_RULES 3 に従い、次の 3 種類は値を入れず publication_based_not_public にした。
  1. Table 3 で Source Description が市販の資料・評価サービスを示すセル。
     - PUC: "Marshall and Swift Valuation" など 215 件。
     - SUC: "CostWorks Model"・"RSMeans Cost Data Model"・"R.S. Means Cost Data"・"R.S. Mean Cost Data, USACE Data"・"Commercial Sources" など 401 件。
     - "Set equal to FAC xxxx" のように参照先がそれらに当たるものも含む。
  2. 構成が示されていない "Composite of multiple FACs" と、それを参照するもの(SUC 12 件)。出所を確かめられないため開けない。
  3. Table 6 の全行。
     - UFS 6-3.1: "The unit costs for supporting facilities are developed using the 2025 Costbook database."
     - その Cost Book(TRACES/MII)は、USACE と Gordian の契約で RSMeans data を組み込んだもの。
     - 根拠は Gordian の 2022-03-31 の発表(GlobeNewswire): "announced today the release of customized, up to date RSMeans data to inform the Tri-Service Automated Cost Engineering System (TRACES) for the Department of Defense user community under a contract with the US Army Corps of Engineers (USACE)."
- 開けた PUC・SUC の出所
  - USACE PAX Newsletter、UFS Table 2、PACES、AFCEC・AFCESA、DLA、Navy・CNIC の study、NASA、Service reported PRV など、政府のもの。
  - "Multiple Industry Studies"、"Private Sector Bid Prices"、"American Segmental Bridge Institute" など、市販の物価資料ではない第三者の資料も開けた(一覧は下)。この線引きは番人の確認を勧める。

### CWCCIS(USACE)

- USACE Privacy and Security: "Information presented on this website is considered public information and may be distributed or copied unless otherwise specified."
- EM 1110-2-1304: "3. Distribution Statement. Approved for public release; distribution is unlimited."
- 判断: public_domain。
- 注意: EM 14 項によると、指数の入力に市販の資料も使っている(RSMeans の Labor Rates と City Cost Index、ENR の 20-City 指数)。BLS PPI、OMB、Bureau of Reclamation、EP 1110-1-8 と並ぶ入力の一つ。表の値は USACE が合成した指数で、市販資料由来と示されたセルは無いので開けた。州の調整係数も、RSMeans の City Cost Index を入力にしている可能性が高い。ここも番人の判断を仰ぎたい。

### EP 1110-1-8(USACE)

- 根拠: 上の USACE の条文と、EP 本文の "3. Distribution Statement. Approved for public release. Distribution is unlimited."。
- 判断: public_domain。
- 方法論は Green Guide(salvage value)や RSMeans Labor Rates を参照する。ただし表の値は、USACE がカタログの定価と地域係数から計算した料率で、市販資料の値を写したセルは無い。

## 照合(全数、数字)

### UFS 3-701-01 Data Tables

- 別の読み方: 同じ xlsx を zipfile と XML で独立に読んだ(sharedStrings と <c r=...> を自前で解く)。値を入れた 33,348 セルがすべて openpyxl の値と一致した。
- 同じ値が別の表に載っている例: Table 3 の PUC で出所が "Table 2, UFS 3-701-01, 6 June 2026" の 46 件のうち、
  - 44 件が Table 2 の $/SF と小数 2 桁まで一致。
  - 1 件(FAC 1411 = 638)は Table 2 の 637.77 の表示値(表示形式 '0')と一致。
  - 1 件(FAC 1413 Air Control Tower 2,108.32 $/SF)は $/VF からの換算とみられ、直接の一致は無い。
- 原本の訂正記録との一致: Correction Log の 4 件の記載が、表の該当セルの行と一致した。
  - 002: OCONUS の M389・N389 = ASCENSION AUXILIARY AIRFIELD
  - 003: CONUS の M4317・M5693 = RPSUID 6836・171068
  - 004: OCONUS の M605・M736 = RPSUID 7520・187466
- 行数と ID
  - CONUS は 15,549 行、RPSUID 15,547 種。重複 2 組の内訳:
    - 186683: County の大小文字と住所の有無が違う 2 行
    - 191606: 全列同じ行が 2 回。2 回目は spec に「原本で同じ内容の行が重なる」と書いた
  - OCONUS は 940 行。RPSUID 空欄の 9 行は City が 'Unknown' の国ごとの行。

### CWCCIS(31 March 2026)

- 数え方の一致: 頁ごとに、pdftotext -layout の「数.2 桁」の数と bbox で読んだ値の数が 49/49 頁で一致した。
- 列の割り当て: 見出しの中心との距離は最大 4.02pt、列の間隔は約 47pt。Table 4 は最大 4.90pt。
- 重み付けの検算: COMPOSITE と 19 工種の Wt % による加重平均が 392/392 列で差 0.01 以内(Wt % の和 100)。
- 四半期と年度: Table 2 の年度値と Table 1 の 4 四半期の平均は、1,520 組のうち 1,511 組で差 0.01 以内。外れ 9 組は下の「誤植らしきもの」。
- 前年比: YEARLY PERCENTAGE CHANGE と COMPOSITE の前年比が 87/87 で一致した。
- 別の年版: 30 September 2025 版と同じ期間を比べた。
  - 実績の四半期: 3,638/3,640 が一致。違う 2 つは 2Q25 の 12 NAVIGATION PORTS & HARBORS と COMPOSITE で、改訂とみられる。
  - 実績の年度: 1,140/1,140 が一致。
  - 見通し(*)の 3,060 はすべて更新されている。
- 表の間の一致: Table 3(現行)と Table 4 の 2025 列が 51/51 で一致した。

### EP 1110-1-8(12 地域)

- 読み方
  - A(本採用): pdftotext -bbox-layout の語。
  - B: タグ付き PDF の MCID。
  - C: pdftotext -layout の行。
- 行数: A と C の機械の数が 3,649/3,649 頁で一致し、各地域 1,592 機械。SourceTag の重複は 0。
- $ の値の並び: TEV、Avg、Stby、DEPR、FCCM、Fuel の並びが、19,104/19,104 機械で A と C 一致。
- MCID(B)が使えた頁との一致
  - B は MCID がセルごとに切れている頁だけで使える。地域 1・2・5・6・8・9・11・12 は 239 頁、地域 4 は 238 頁、地域 7 は 240 頁、地域 10 は 304 頁。地域 3 は 0 頁で、MCID が頁全体で 1 束になっている。
  - 値は 13,413/13,413 機械で A と一致。Model と Description も同じ 13,413 機械ですべて一致。
  - 地域 10 は Main と Carrier の欄を束ねた MCID があり、馬力と燃料の欄だけ 398 件で B の割り当てがずれる。A の語の位置で確かめ、値には関係しない。
- 列の割り当て: 見出し中心との最大距離は 7.38pt(Fuel)、2 番目に近い見出しとの差は最小 41.1pt。
- 式での検算
  - Stby = DEPR x 0.5 + FCCM(EP 2.26)が 19,104/19,104 機械で ±0.01 以内に成り立つ。Stby・DEPR・FCCM の列の取り違えは無い。
  - Avg >= DEPR + FCCM + Fuel が 19,104/19,104 で成り立つ。
- 地域の間の一致: 12 地域で SourceTag の並びが同じ(1,592 機械、同じ順)。Model・Description・カテゴリ・サブカテゴリ・メーカー名は、空白を除くと 1,585/1,592 機械で 12 地域同じ。違う 7 機械は、原本の切れた文字(下の 4)。

## 原本の誤植らしきもの・注意(値は原本のまま)

1. CWCCIS Table 2 の FY26*〜FY55* の 30 列は、期間の見出しがすべて 'Oct 24 - Sep 25' と印字されている。FY の番号と合わないので誤植とみられる。period は FY の番号から付け、該当行の note に書いた。
2. CWCCIS の Table 2(年度)と Table 1 の 4 四半期の平均が合わない組がある。12 NAVIGATION PORTS & HARBORS の FY86・FY87・FY88・FY91 で、差は最大 0.88(FY91: 四半期の平均 402.29、年度 401.41)。COMPOSITE の FY91 など計 9 組が 0.01 を超える。原本のまま入れた。
3. UFS Table 4-1 CONUS に、重複した行と外国の拠点の行がある。
   - RPSUID 191606(BARNES MAP (ANG) SITE # 3)は全列同じ行が 2 回ある。
   - 'Abw/Rs Yokota Afb Japan'(RPSUID 183145、横田基地の募集拠点)が State California・City San Francisco(軍事郵便の住所)として CONUS に載っている。原本の State のとおり California に入れた。
4. EP の文字の欄は、セルの幅で切れている。
   - 例: サブカテゴリ 'D35 0.12 DIESEL, OVER 9.875" DIAMETER (Add co' と '...(Add cos' のように、地域によって切れる位置が違う。
   - 'EXCAVATOR ATTACHMENTS ... CONCRET' のように語が途中で切れ、一部の語は行の高さがずれて印字されている(地域 3 以外の 38 か所)。高さの差が 6pt 未満の語は同じ行として x の順に並べた。
5. UFS Table 2 の注 '*** Inssufficient projects ...' は、原文のまま(綴り)。

## 取得の技(次の担当向け)

- WBDG の頁(www.wbdg.org)は JavaScript だけで描かれ、Apify の markdown・html では空になる。
  - 文書の情報は API から取れる: https://www.wbdg.org/api/documents/<urlAlias の最後>(例 ufs-3-701-01)。JSON で、mediaFiles(現行と旧版の PDF)と relatedMaterials(Data Tables の xlsx など)の S3 URL が得られる。
  - 旧 URL の www.wbdg.org/FFC/DOD/UFC/*.pdf は 404。
- web-fetch raw で原本が壊れる場合
  - xlsx が壊れることを確かめた。
  - publibrary.sec.usace.army.mil の一部の PDF も壊れた(CWCCIS 2026-03。長さも変わる)。
- eliai/base64-encoder-decoder(Apify Store、fileUrls を base64 で dataset に返す、1 ファイル $0.002)で原本のバイト列が取れた。
  - xlsx 2MB と PDF 0.4MB で確かめた。
  - S3 は ETag = MD5 で照合できる。PDF は linearization の /L で照合できる。
  - nww.usace.army.mil はこの actor に 403 を返す。nww は web-fetch raw で正しく取れる。
- Apify の同時実行は 5 本まで(他の担当と共有)。超えると "exceed your limit of 5 concurrent Actor runs" になるので、少し待って再試行した。
- EP の旧 URL(usace.contentdm.oclc.org、約 7MB)は 2020 年以前の版。現行版は https://www.nww.usace.army.mil/missions/cost-engineering/ep1110-1-8/ の Portals/28 にある。

## 取れなかったもの・取り込まなかったもの

- UFS Table 4-2(MILCON escalation)、4-3(PRV escalation)、4-4(O&M escalation)は範囲外。
  - Table 4-2 の "ENR Indices (raw)" は市販の ENR の値なので、取り込むとしても値なし。
  - DoD SPI は 3 つの市販指数の平均。
- UFS Table 3 の Supporting documentation(SUC Documentation ZIP 90.4MB・PDF 56.5MB、PUC Supporting Documentation xlsx)は取っていない。
- EP の地域別の Table 2-2(Hourly Rate Elements、FOG・修理・タイヤなどの要素)、Table 3-1・3-2(年式の調整係数)、Appendix B(Local Area Factors)、共通の付表(Appendix C〜K)は取っていない。
- EP の旧版(2022、2020、2018、2016、2014、2011、2009)は取っていない。
- UFS の旧版の Data Tables(2025 = ufc_3_701_01_2022_c6_Data_Tables.xlsx など、WBDG の API の mediaFiles にある)は取っていない。年ごとの ACF・GUC の比較に使える。
- apply_decisions_20260926.py は他の担当のファイルだけを扱うので、この取り込みには関係しない。走らせて、他のファイルに変化が無いことを確かめた(下)。

## 次に取るべきもの

1. EP 1110-1-8 の Table 2-2(12 地域、Hourly Rate Elements)と Appendix B(Local Area Factors)。同じ nww の Portals/28 にあり、同じ parser の型で読める。
2. UFS の過去の Data Tables(2024、2025)。ACF と GUC の年次比較に使え、ACF の 96 Base City の変化の確認にもなる。
3. CWCCIS の旧版(30 September 2025 は照合用に raw に置いた。2021〜2025 の各版)。見通し(*)の改訂の履歴が取れる。
4. 番人の判断待ち
   - Table 3 の "Industry Studies"・"Private Sector Bid Prices" などを開けたこと。
   - CWCCIS と州の調整係数を開けたこと。入力に RSMeans と ENR がある。

## 付: UFS Table 3 で値を入れた PUC・SUC の Source Description(件数、計 306)

- 政府の資料
  - USACE PAX Newsletter 3.2.2 の各版: 122
  - Table 2(UFC / UFS 3-701-01 の各版): 66
  - DLA・DESC: 23
  - AFCEC・AFCESA: 18
  - Navy・NAVFAC・CNIC: 15
  - Set (equal) to / Ratio based on FAC(参照先が開けた出所): 13
  - PACES: 10
  - AF Military Construction Program 2、Service Reported PRV 2、その他の軍・政府の資料 各 1(AFIMSC/IZ、Air Force data、MTMC、Military Construction Program、NASA 2 件、WHS 2 件、Government correspondence、Based on Competitive Contract Awards、Multiple Government Sources、U.S. EPA Data on Pump Replacement 2012、Solid Waste Mgt Authority & Engineers Report、Fairfax County VA Park Authority)
- 市販の物価資料ではない第三者の資料(番人の確認を勧める)
  - Multiple Industry Studies: 7
  - Private Sector Bid Prices: 3
  - 各 1: Industry Study 2023、Multiple Government and Industry Studies、Water Reuse Association Study 2012、Univ of KS Short Line Study、American Segmental Bridge Institute、Based on National 9-11 Memorial Data、Fairbanks-Morse; Rice Lake(メーカーの資料)
