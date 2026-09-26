# U2-us-census-fema 報告(2026-09-26)

## 結論

- 米連邦の建設費データを観測層 v2 に 5 ファイル、計 31,954 行入れた。検査器(validate_obs.py --only の 5 ファイル)は誤り 0、警告 0。
- 値はすべて連邦政府の著作物(17 U.S.C. 105)として license "US-PD-17USC105"、status "public_domain"。非公表セル((S)/(NA))の 48 行だけ not_set。
- 照合は全数で行い、FEMA は頁ごとの行数・番号の連番・Cost Code・別の組版(FEMA の頁の HTML の表)がすべて一致。Census VIP は合計行と内訳の和が(成り立つ系列で)丸めの範囲、報道発表の 13 個の数字とも一致。
- 取れなかったもの: USACE EP 1110-1-8 の地域別の表(PDF 1 本 7MB を MCP 経由で受け取れない)、Davis-Bacon(SAM.gov)。理由と試した URL は下に。

## 作ったファイル

| ファイル | 行数 | layer | status | 出典(source_id) |
|---|---|---|---|---|
| observations/us/spending_census_vip.csv | 28,320 | spending | public_domain 28,320 | census-vip-eits |
| observations/us/equipment_fema_2025.csv | 465 | equipment | public_domain 465 | fema-equipment-rates-2025 |
| observations/us/cost_sqft_census_newhousing.csv | 730 | cost_sqft | public_domain 730 | census-chars-contractpricesqft 390 / census-chars-soldpricesqft 340 |
| observations/us/house_price_census_newhousing.csv | 1,056 | house_price | public_domain 1,008 / not_set 48 | census-chars-soldprice 480 / census-chars-contractprice 576 |
| observations/us/index_census_cqpi.csv | 1,383 | index | public_domain 1,383 | census-cqpi-sold 569 / census-cqpi-uc 814 |

parser(もう一度走らせると同じ CSV が出ることを sha256 で確かめた):
- tools/parsers/parse_fema_equipment_2025.py
- tools/parsers/parse_census_vip.py
- tools/parsers/parse_census_newhousing.py(3 ファイルを作る)

許可一覧に足したもの: tools/extra_enums/U2-us-census-fema.json
- layer "house_price"(新築一戸建て 1 戸あたりの販売価格・請負価格の統計。面積あたりの cost_sqft と分けた)
- price_basis "price_per_house"、"equipment_rate_per_mile"(FEMA で Unit が mile の 3 行)、"equipment_rate_unit_not_stated"(FEMA で Unit 欄が空の 4 行。時間単価と推定しない)

出力 CSV の sha256:
- equipment_fema_2025.csv 70d29f3243c6a12bf3dc9eff5380d73ce3dfc7982d7a5247e117a17c534ee6b1
- spending_census_vip.csv 795a05f6d2bdfdfaf8b09b274327c20936446463b812225813d1665841a8634a
- cost_sqft_census_newhousing.csv 45ce30c4ce7e0c0b7faed5ced2bba82bb9bc21a04e6bcf5dd243be9013736027
- house_price_census_newhousing.csv 3ab6055ae22220196a76d47289944c98c0e4a9a06b0c0227f819dcd4ecffbc25
- index_census_cqpi.csv f3b3a52f18d99481e89b6be3916b052b87537dc42bc172fc858d202b2b587e42

## 取った出典(原本は raw/、台帳は sources/<source_id>.json)

| source_id | URL | bytes | sha256 | 取り方 |
|---|---|---|---|---|
| fema-equipment-rates-2025 | https://www.fema.gov/sites/default/files/documents/fema_pa_schedule-equipment-rates_2025.pdf | 817,260 | 62a9ca68fb61b3fe72a99a055c74c6cd20a9d0611498e3ecd9aff8153c59623f | web-fetch raw(base64)、Content-Length 一致、先頭 %PDF、Last-Modified Tue, 16 Sep 2025 19:11:09 GMT |
| census-vip-eits | https://www.census.gov/econ_getzippedfile/?programCode=VIP | 328,571 | 1370e0b266fc6846102ae13bbc5bc186844496786afcaebd3a38c25676e669b0 | web-fetch raw(octet-stream、VIP-mf.zip)。中の VIP-mf.csv 1,682,444 bytes、sha256 f8422c2c1463a4cff51944ff2904b86d40908f27fdda9353050c2176eff224a6、DATA UPDATED ON 2026-09-01 |
| census-chars-contractpricesqft | https://www.census.gov/construction/chars/xls/contractpricesqft_cust.xls | 57,344 | 7cfd24aa201ad2e62af9f475b5e2d978ba5e2b70c58eb2f3ee0f9bef790d4fce | website-content-crawler(saveFiles)から KVS、先頭 D0CF11E0 |
| census-chars-soldpricesqft | https://www.census.gov/construction/chars/xls/soldpricesqft_cust.xls | 146,944 | ce412990845bbb590909c2a43c377efeacdf6fcade0652b7d8dce4e73777dca5 | 同上 |
| census-chars-soldprice | https://www.census.gov/construction/chars/xls/soldprice_cust.xls | 102,912 | 78e843818c3692a56858a5eb448d9956170e80cc06b160e7348df4689a6e8e05 | 同上 |
| census-chars-contractprice | https://www.census.gov/construction/chars/xls/contractprice_cust.xls | 78,848 | 6c3eb1bfb126c12ecd5d1243ee521fc0538b51be6ba07d86fdae97bf45dff1d4 | 同上 |
| census-cqpi-sold | https://www.census.gov/construction/nrs/xls/price_sold_cust.xlsx | 52,235 | 9cf4f8b1aee4155dc88aa6bae267b7bedd95d2fb9940a67a76c7b5f97b1a7b7c | 同上、先頭 PK |
| census-cqpi-uc | https://www.census.gov/construction/nrs/xls/price_uc_cust.xlsx | 59,019 | e73e89cef5e5f4bcbe716d7144fb64dcf197abb3c9698cea65682712dea9d020 | 同上 |

取り方で分かったこと(次の担当向け): apify/web-fetch の formats=["raw"] は、Content-Type が PDF・octet-stream なら base64 で正しく返すが、xls(application/vnd.ms-excel)と xlsx は文字として読み替えて壊す(先頭が EF BF BD、zip として開けない。bytes も Content-Length も壊れた後の長さで一致してしまうので、長さの一致だけでは気づけない)。xls/xlsx は apify/website-content-crawler(crawlerType cheerio、saveFiles: true)で key-value store に置かせ、get-key-value-store-record で受け取ると原本のバイト列が来る(約 150KB まで確認)。7MB の PDF は同じ方法で署名つきの URL だけが返り、この環境から api.apify.com には届かない。apify/cheerio-scraper はアカウントの権限承認が要ると言われ使えなかった。

## 利用条件の判断と根拠

- FEMA: FEMA の Website Information「Reuse and Copyright」(https://www.fema.gov/about/website-information#copyright、Apify で取得)の条文を台帳に写した: "Most material on FEMA.gov is free of copyright and may be copied and distributed without permission. ... We sometimes use photos or graphics that we licensed or that are restricted. Check to see if there is a copyright or photo credit. ..." PDF には著作権表示・写真の帰属表示が無い(pdftotext で copyright / © は 0 件)。加えて 17 U.S.C. 105(a) の条文(Cornell LII から Apify で取得)。→ US-PD-17USC105 / public_domain。
- Census: 17 U.S.C. 105(a) の条文と、Census の「Citing our Data」頁の Public-Use Statement(https://www.census.gov/about/policies/citation.html、Page Last Revised February 24, 2026)の条文を写した。新築住宅の表と価格指数は Census と HUD(ともに連邦)の共同の Survey of Construction(ファイルの出所表記 "Source: U.S. Census Bureau and U.S. Department of Housing and Urban Development, Survey of Construction")。→ US-PD-17USC105 / public_domain。Census の Multimedia Usage Policy(商用不可)は写真・音声・動画の条件で、統計表には当たらない。
- Census Data API は使っていない(鍵なしの要求に "Missing Key" の頁が返った)。API の利用条件(非推奨表示)は今回の取り込みには関係しない。

## 各ファイルの中身

### spending_census_vip.csv(Census VIP、建設支出)
- 2002-01 から 2026-07 まで 295 か月の全月(2016 年以降は 12,192 行)。系列 96 本 = 全体(T)19 分類 + 民間(V)14 分類 + 公共(P)15 分類、それぞれ季節調整なしの月の値(NSA、spending_million_usd_nsa)と季節調整済み年率(SAAR、spending_million_usd_saar)。
- 分類は原本の CATEGORIES の言葉のまま(Total Construction, Residential, Nonresidential と非住宅の 16 種類。SAAR は "Annual Rate for ..." の名)。spec に "Total Private Construction, Seasonally Adjusted Annual Rate" のように所有と調整、note に cat_code と dt_code。
- 相対標準誤差(E_T/E_V/E_P、%)を 27,840 行の ref_value に入れた。最新月(2026-07)は速報値と note に書いた。
- 取り込まなかったもの: 月次変化率(MPCT など、水準から計算できる)。Census の xlsx の細目(民間住宅の新築一戸建て・集合・改修の内訳など)はこのデータセットに無い。

### equipment_fema_2025.csv(FEMA 機械料率 2025)
- 465 行、全国。unit は原本の Unit を使って "USD/hour"(458 行、Hour/hour)、"USD/Mile"・"USD/mile"(3 行)、Unit 欄が空の 4 行は "USD (Unit 欄が空)"。
- category = Equipment、item_name = Equipment / Manufacturer、spec = Cost Code と Manufacturer・Specification・Capacity or Size・HP・Notes を原文のまま。
- effective_from 2025-07-01(FEMA の頁: "These rates are applicable to major disaster and emergencies declared by the President on or after July 1, 2025.")。note に「オペレーターの人件費は含まない」(同頁: "Labor costs of the operator are not included in the rates")。

### cost_sqft_census_newhousing.csv(面積あたり)
- 請負建築(contractor-built、着工)の 1 平方フィートあたり請負価格の中央値・平均: 1987〜2025 年、全米 + 4 地域(census_region R1 Northeast / R2 Midwest / R3 South / R4 West)。宅地の価値を含まない。
- 販売された新築一戸建ての床面積 1 平方フィートあたり価格の中央値・平均: 1992〜2025 年、全米 + 4 地域。宅地の価値を含まない。
- 表の下の RSE の行(年の明記なし、最終年の直下)は 2025 年の行の ref_value に入れ、ref_note にそう書いた。

### house_price_census_newhousing.csv(1 戸あたり)
- 販売価格の中央値・平均(Median / Average Sales Price): 1978〜2025 年、全米 + 4 地域。
- 請負価格の中央値・平均(Median / Average Contract Price): 1994〜2025 年、Total(全米)+ 4 地域 + 資金の種類(Conventional / FHA insured / VA guaranteed / Cash、全米)。(S) 8 行と (NA) 40 行は not_set。

### index_census_cqpi.csv(価格指数、2005 = 100)
- Price Indexes of New Single-Family Houses Sold Including Lot Value: 全米の年 1963〜2025、全米の四半期 1963Q1〜2026Q2、4 地域の年 1963〜2025(569 行)。
- Constant Quality (Laspeyres) Price Index of New Single-Family Houses Under Construction: 全米の年 1964〜2025、月 1964-01〜2026-08(814 行)。p(Preliminary)/ r(Revised)の印は note。Fisher(Deflator)は取り込まない。

## 照合(全数、数字)

### FEMA
- 2 通りで読んだ: (A) pdftotext -bbox-layout の語を句にまとめ見出し中心に最近傍、(B) タグ付き PDF の marked content(MCID、セル 1 つ = 1 束、pdfplumber)。行の境は PDF に描かれた横罫線。
- 頁ごと「罫線の帯の数 = # の数 = $ の数 = 値の数 = pdftotext -layout で行頭が 番号 + Cost Code の行数」: 60/48/50/55/37/45/55/18/28/41/28、11 頁すべて一致、計 465。
- # は 1〜465 で欠け 0・重複 0。Cost Code は重複 0、昇順でない箇所 0、形の違うもの 0。
- A と B で #・Cost Code・Unit・Rate が 465/465 一致。文字の欄の違いは 1 行(# 365。Equipment の文字 "Truck, Fire, Type 5, 6 & 7" と Manufacturer の長い文字が同じ高さで重なって印字されている。B の MCID の読みを採用)。
- 見出し中心との距離の最大(B、MCID の束): #, Cost Code 0.02pt / Equipment 1.69 / Manufacturer 1.62 / Specification 1.87 / Capacity or Size 0.61 / HP 0.07 / Notes 0.54 / Unit 0.06pt、Rates は右寄せなので右端で測り 0.01pt。2 番目に近い見出しとの差の最小は 23.7pt(割り当てに際どいものは無い)。A の句では Specification に 48.6pt 離れた断片があるが(字間の広い行が句に割れたもの)、すべて Specification 列の範囲内。
- 別の組版: FEMA の頁(https://www.fema.gov/assistance/public/tools-resources/schedule-equipment-rates)に同じ 2025 年の表が HTML で載っている。Cost Code 465 個が過不足なく一致し、Rate 465/465、Unit 465/465(空欄 4 行を含む)が一致。

### Census VIP(差は百万ドル)
- Total = Residential + Nonresidential: NSA は T/V/P 各 295 か月すべて差 1 以内。SAAR は 2016-01 以降の 127 か月すべて差 1 以内、2002〜2015 年は T と V で最大 305(2002-06)、差 1 以内は T 267/295、V 258/295。P は全期間差 1 以内。
- Nonresidential = 16 種類の和(全体 T のみ成り立つ): NSA 295 か月で最大差 4(差 1 以内 211)、SAAR 最大差 4(2016 年以降は最大 3)。民間 V は 16 種類のうち 11、公共 P は 12 しか系列が無く、和は成り立たないので照合の対象外。
- 全体 = 民間 + 公共(3 系列そろう分類): NSA 2,950 組すべて差 1 以内。SAAR は 2016 年以降 1,270 組すべて差 1 以内、全期間では最大 9(2005-10)、差 1 以内 2,931/2,950。
- 2026-09-01 の報道発表 CB26-140(https://www.census.gov/construction/c30/current/index.html)の 13 個の数字(2026 年 7 月と 6 月の総額 2,157.6 / 2,167.7、民間 1,614.2 / 1,622.9、民間住宅 859.0 / 870.6、民間非住宅 755.2 / 752.4、公共 543.4 / 544.7、公共教育 112.3 / 112.5、公共道路 150.3 / 150.6、2025 年 7 月の総額 2,242.6、十億ドル)が CSV の値と丸めの範囲で全部一致。

### Census 新築住宅
- 全米の平均が 4 地域の平均の最小と最大の間に入るか(全米の平均は地域の加重平均なので必ず入る): 請負価格/平方フィート 39/39 年、販売価格/平方フィート 34/34 年、販売価格 48/48 年、請負価格 29/29 年(4 地域がそろう年)。外れ 0。
- 別の刊行物との突き合わせ: 販売価格の平均(chars の SoldMedAvgPrice)と価格指数ファイルの Constant Price XX シート「Average sales price of houses actually sold」を 240 組比べ 233 組一致、7 組不一致(下の「誤植らしきもの」)。
- 価格指数: Price Index シートの年の値と Constant Price XX シートの Price Index 列が 315/315 一致。「Average sales price of typical 2005 house」= 2005 年の平均販売価格 x 指数 / 100 が 315/315 組で 50 ドル以内(最大 49.93、百ドル単位の丸め)。
- 建築中の指数: Fixed シート(年 x 月の表)と Vertical シート(縦 1 列)の Laspeyres が 752/752 か月一致。
- 年の欠け 0(1987〜2025、1992〜2025、1978〜2025)。

## 原本の誤植らしきもの(値は原本のまま入れ、行の note に書いた)

1. contractpricesqft_cust.xls(ContractMedAvgPriceSqFt)1990 年 South の平均請負価格/平方フィート 19.3。同じ年の中央値 43.7 を大きく下回り、前後の年(1989 年 48.6、1991 年 50.35)とも離れている。49.3 などの打ち誤りの疑い。
2. soldprice_cust.xls(SoldMedAvgPrice)1995 年の平均販売価格 Midwest 152,700 / South 136,800 / West 168,900 は、同じ表の 1994 年の値と 3 つとも同じ。価格指数ファイル(Constant Price シート)では 1995 年が 157,200 / 142,000 / 169,800。1994 年の行の写し誤りの疑い。
3. 同じく 1996 年の 4 地域の平均販売価格が 2 つの刊行物で 300〜1,100 ドル違う(chars 226,100 / 158,900 / 144,200 / 186,200、価格指数ファイル 226,800 / 158,100 / 143,100 / 185,900)。改訂の反映の違いか誤植かは分からない。
4. FEMA PDF の文字の欄: "Enigne"(# 26)、"Ambulace"(# 454)、"antena"(# 450)などの綴り、# 368 の "PTOT" と "Tank" が重なって印字、# 24 などの Specification が途中で切れている("regular unleade")。値(Rate)には影響しない。原文のまま。
5. FEMA の Notes 欄に内部の作業メモらしき文("Added from EW"、"Saved in EW as 8680-1. Somehow was" など)がそのまま載っている。原文のまま。

## 取れなかったもの・調べただけのもの

- Census の時系列 xlsx(https://www.census.gov/construction/c30/xlsx/totsatime.xlsx、tottime.xlsx): web-fetch raw で取ったが、xlsx を文字として読み替えられて壊れた(zip として開けない)。削除し、同じ Census の時系列データセット(VIP-mf.zip)を原本にした。細目(民間住宅の内訳など)が要るなら website-content-crawler の方法で取り直せる。
- Census Data API(https://api.census.gov/data/timeseries/eits/vip?...&time=2026-07): "Missing Key"(A valid key must be included with each data API request.)の頁が返った。鍵なしでは使えない。
- USACE EP 1110-1-8(余力分): 現行の頁 https://www.usace.army.mil/Missions/Cost-Engineering/EP1110-1-8/ は Apify で読めた(地域 1〜12 ごとに Hourly Equipment Ownership and Operating Expense の PDF、例: Region 1 https://usace.contentdm.oclc.org/utils/getfile/collection/p16021coll9/id/2632、application/pdf、6,991,338 bytes)。しかし (1) web-fetch raw の結果(base64 で約 9.3MB)を get-dataset-items で受け取ろうとすると MCP の session expired になる(2 回)、(2) website-content-crawler で key-value store に置かせると 7MB の記録は署名つき URL(api.apify.com)だけが返り、この環境から api.apify.com は CONNECT 403。値は入れていない。頁によれば旧版(2018、2016、2014、2011、2009)も地域別 PDF で公開。現行版の発行年は頁に書かれていない。
- Davis-Bacon(SAM.gov)(余力分、調べただけ): 個別の賃金決定の頁 https://sam.gov/wage-determination/WA20220002/0 は Apify web-fetch で本文が空(画面は JavaScript で描く)。検索結果で見つけた文書のダウンロード口の形 https://sam.gov/api/prod/wdol/v1/wd/<WD 番号>/<改訂番号>/download を https://sam.gov/api/prod/wdol/v1/wd/DC20250002/0/download で試したが、Apify のプロキシが 502(Could not verify the TLS certificate of sam.gov)を返した。一括ダウンロードの口は見つからなかった(第三者の解説 https://govconapi.com/sam-gov-wage-determination-api も "There is no bulk download" と書く)。鍵の要る公式 API の条件はこの作業では確かめていない。取るなら、(a) 文書のダウンロード口に別の取り方(TLS を検証できる経路)で届くか試す、(b) WD 番号の一覧(州 x 種類 x 年)を先に作り 1 件ずつ取る、の順。

## 次に取るべきもの

1. FEMA の過去版(同じ頁に 2023 PDF、2021 PDF、2019 CSV、2017 CSV)。同じ parser の型で読め、年ごとの料率の変化が取れる。
2. Census の建設支出の細目 xlsx(privsatime.xlsx、pubsatime.xlsx など)を website-content-crawler の方法で。民間住宅の新築一戸建て・集合・改修の内訳が取れる。
3. Census の州別の支出(c30/xlsx/nrstate.xlsx、slstate.xlsx)と地域別(region.xlsx)。geo_level state / census_region に入る。
4. Census の新築住宅の他の表(squarefeet_cust.xls の床面積、contractpricesqft の価格帯別の戸数)。面積あたり価格を戸あたり価格と床面積から再計算して照合できる。
5. USACE EP 1110-1-8 は、7MB の PDF をこの環境に運ぶ経路ができてから(地域 12 本)。
