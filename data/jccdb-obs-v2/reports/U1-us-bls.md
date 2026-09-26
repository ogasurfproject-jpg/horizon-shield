# U1-us-bls 報告(2026-09-26)

## 結論

- BLS の PPI 257 系列(2016年1月〜2026年8月の月次)、OEWS May 2025 の建設関係 110 職業(全国と 54 地域)、余力で ECI の建設関連 17 系列(2016Q1〜2026Q2)を観測層 v2 に入れた。3 ファイル計 70,799 行、検査器の誤りは私のファイルで 0。
- 利用条件は BLS の著作権の頁の条文(公有)で確かめ、全行 license US-PD-17USC105、値のある行は public_domain。
- PPI の値は API v1 ではなく BLS 公式の time.series flat file から取った。API v1 の GET は年の指定を無視して直近3年だけを返し、25 系列 x 10 年を1問で取れる POST は Apify で送れなかったため。flat file と API v1 の応答は重なる全月で値も脚注も一致した(34/34)。
- 取らなかったもの: CPI の住宅修繕関連、PPI の Final demand construction(WPUFD43 ほか)、OSB・空調機器・配線器具の PPI。理由は末尾。

## 作ったファイル

| ファイル | 行数 | public_domain | not_set |
|---|---|---|---|
| observations/us/index_bls_ppi.csv | 32,892 | 32,855 | 37 |
| observations/us/wage_bls_oews_2025.csv | 37,193 | 36,930 | 263 |
| observations/us/index_bls_eci.csv | 714 | 714 | 0 |

- parser: tools/parsers/parse_bls_ppi.py、parse_bls_oews.py、parse_bls_eci.py(入力は raw/ の原本だけ。2 回走らせて CSV と台帳の sha256 が同じことを確かめた)
- 台帳: sources/bls-ppi-wp-80i / -pc-75 / -wp-9 / -wp-11a / -wp-11b / -wp-12a / -wp-14 / -wp-6 / -wp-7 / -wp-8、bls-oews-m2025-national、bls-oews-m2025-state、bls-eci-ci-current(13 本。parser が原本から sha256 と bytes を書く)
- 許可一覧の追加: tools/extra_enums/U1-us-bls.json(wage_annual_p10 / p25 / p75 / p90。obs_common には時給の分位しか無い)
- 照合の表: reports/U1-us-bls_ppi_series_check.csv(257 系列)、reports/U1-us-bls_oews_emp_check.csv(110 職業)、reports/U1-us-bls_eci_series_check.csv(17 系列)

## 利用条件

- 頁: https://www.bls.gov/opub/copyright-information.htm(raw/bls-copyright.htm、47,310 bytes、sha256 93b73a7d…021be2)
- 条文(license_quote にそのまま): "The Bureau of Labor Statistics (BLS) is a Federal government agency and everything that we publish, both in hard copy and electronically, is in the public domain, except for previously copyrighted photographs and illustrations. You are free to use our public domain material without specific permission, although we do ask that you cite the Bureau of Labor Statistics as the source."
- 判断: 連邦の著作物で公有。写真・図ではなく数値表なので例外に当たらない。出典の表示を求めているので台帳に attribution("Source: U.S. Bureau of Labor Statistics, ...")を書いた。

## 取った原本(すべて Apify web-fetch formats=raw、bytes は Content-Length と一致)

| 原本 | URL | bytes | sha256(先頭) | Last-Modified |
|---|---|---|---|---|
| PPI 商品別 Series ID 一覧(June 2026) | https://www.bls.gov/ppi/data-retrieval-guide/producer-price-index-commodity-data-series-id-codes.txt | 261,252 | f7fd4f39 | 2026-07-15 |
| PPI 産業別 Series ID 一覧(June 2026) | https://www.bls.gov/ppi/data-retrieval-guide/producer-price-index-industry-data-series-id-codes.txt | 306,771 | 2c2dd8a8 | 2026-07-15 |
| wp.series / pc.series / wp.group / wp.footnote | https://download.bls.gov/pub/time.series/wp/ ・ /pc/ | 985,162 / 853,221 / 2,050 / 150 | cf06d3d3 / 911f8811 / 863337a7 / 2c34208e | 2026-09-10 |
| wp.data.80i.ConstructnInputs | 同上 | 1,406,260 | 07e01e04 | 2026-09-10 |
| pc.data.75.Construction | 同上 | 532,287 | d5b3a9f5 | 2026-09-10 |
| wp.data.9.Lumber / 11a / 11b / 12a / 14 / 6 / 7 / 8 | 同上 | 2,615,816 / 4,161,994 / 5,215,575 / 3,145,343 / 4,694,690 / 4,020,973 / 5,688,391 / 2,321,917 | e598958c / d3927914 / 5d20f873 / dff7d6b9 / 0e930130 / 12876d0e / 585b85cd / 5d9a863d | 2026-09-10 |
| API v1 応答 WPUIP2312001 | https://api.bls.gov/publicAPI/v1/timeseries/data/WPUIP2312001?startyear=2016&endyear=2025 | 3,623 | b776a334 | - |
| OEWS 全国 | https://www.bls.gov/oes/special-requests/oesm25nat.zip | 279,525 | b5855a37 | 2026-05-15 |
| OEWS 州 | https://www.bls.gov/oes/special-requests/oesm25st.zip | 7,563,829 | 74d5be0e | 2026-05-15 |
| ECI ci.series / ci.data.0.Current / ci.footnote | https://download.bls.gov/pub/time.series/ci/ | 487,191 / 4,203,255 / 2,569 | e6dbe943 / 277f7093 / 1ca8db02 | 2026-07-31 |
| ECI news release Table 4 | https://www.bls.gov/news.release/eci.t04.htm | 80,280 | d01518eb | - |

- OEWS 州の zip は Apify のデータ項目の上限(9,436,240 bytes)を超えて 1 回では取れなかった。Range ヘッダで bytes=0-3999999 と 4000000- の 2 回に分けて取り、つないだ。2 回とも HTTP 206、同じ ETag "016a1726de4dc1:0"、Content-Range の全長 7,563,829 と連結後の bytes が一致、zip の CRC 検査(testzip)が通った。
- 小さい応答(wp.group、wp.footnote、ci.footnote、API 応答)は結果がファイルに落ちず会話に出たので、その文字列から復元し、bytes が Content-Length と一致することを確かめた。

## PPI(index_bls_ppi.csv)

- 系列の選び方(推測の ID は使わない): 公式の Series ID 一覧に載る ID だけ。
  - Inputs to construction industries: WPUIP23 で始まる全 152 系列(19 業種 x 8 区分: 総合、goods、energy、goods less foods and energy、services、trade、transportation and warehousing、services less trade...)。
  - 建設業の産業別 PPI: PCU23 で始まる全 50 系列(新築の工業・倉庫・学校・事務所・医療の建物、業者の種類別と地域別、専門工事 PCU23811X / 23816X / 23821X / 23822X、非住宅の修繕 PCU2381MR、各 "Primary products")。
  - 主要資材 55 系列: 骨材・セメント・生コン(全国と地域 4)・コンクリート製品、製材・合板・木製品、鉄鋼(WPU1017 ほか)、構造用金属製品(WPU107、WPU107405)、銅線(WPU10260314)・銅管、衛生器具(WPU105)、暖房機器、建具金物、板ガラス、粘土製品・れんが、アスファルト屋根材、石こう製品(WPU137)、断熱材(WPU1392)、舗装材、切石、アスファルト(WPU058102)、軽油、塗料(WPU0621)、樹脂の建設製品、建設機械(WPU112)。
- 系列名は一覧の原文、分類名は wp.group(商品)と一覧の産業名(産業)、単位は wp.series / pc.series の base_date から「index (2014-12 = 100)」の形。
- 地域の系列 28(業者の種類別 x 4 地域、新築非住宅 x 4 地域、生コン x 4 地域)は geo_level census_region。系列名の地域名(Northeast / Midwest / South / West)を同名の Census Region コード R1〜R4 に名前で寄せ、そのことを note に書いた。
- 脚注 P(速報)は 1,024 行。note に wp.footnote の原文 "Preliminary. All indexes are subject to monthly revisions up to four months after original publication."。年平均 M13 は入れていない。
- `/ppi/construction/` は PPI の総合頁の中身を返し、建設の系列一覧は無かった。ID の確認は Series ID 一覧 2 本で行った。

### 照合(全数)

- 系列ごとに、台帳(wp/pc.series)の開始・終了月から 2016年1月以降の期待月数を出し、値のある月数と欠けを数えた。257 系列すべてで台帳の終了月とファイルの最終月が一致し、台帳の範囲の外の行は 0。
  - 期待 32,892 月、値あり 32,855 月、欠け 37 月(4 系列)。欠けは not_set 行として入れた。
  - WPU13710102 Gypsum building materials: 2017-06〜2018-08 の 15 か月
  - WPU10250239 Copper and copper alloy pipe and tube: 14 か月(2021-04、2024-11〜2026-01 の間で 13)。台帳の終了月も 2026-04 で、8 月まで更新されていない
  - PCU2364002364002232 Roofing contractors, South: 7 か月(2021-07、2022-10、2024-01〜2024-05)
  - WPU10260314 Copper wire and cable: 2020-07 の 1 か月
- 別の取り方: API v1 の応答(WPUIP2312001、2024-01〜2026-08 の 32 か月と年平均 2)と flat file を全行で突き合わせ、34/34 で値と脚注 P が一致。

## OEWS(wage_bls_oews_2025.csv)

- May 2025(公表済みの最新。表の頁 https://www.bls.gov/oes/tables.htm で確認)。period は 2025-05。
- 対象: SOC 47-xxxx の全行(全国 103 行: major 1、minor 5、broad と detailed)と 11-9021 Construction Managers、13-1051 Cost Estimators、17-1011 Architects, Except Landscape and Naval、17-2051 Civil Engineers、17-3011 Architectural and Civil Drafters、17-3022 Civil Engineering Technologists and Technicians、49-9021 Heating, Air Conditioning, and Refrigeration Mechanics and Installers。全国 110 行、州のファイル 2,751 行(50 州 + DC + 領土 3 = 54 地域)。
- 1 行から 13 観測: TOT_EMP(count、persons)、時給と年収の平均・10/25/50/75/90 分位。平均の行と雇用者数の行には PRSE を ref_value に。
- 州のファイルには major と detailed しか無い(minor と broad は全国だけ)。47-4090 は全国で broad と detailed の 2 度出る(OEWS の仕様)ので両方残し、spec に O_GROUP を書いた。
- 記号: "*" が 96 観測(8 行 x 12 賃金列)、"**" が 167 観測(雇用者数)。値を入れず not_set、note に Field Descriptions の Notes の原文("*  = indicates that a wage estimate is not available"、"**  = indicates that an employment estimate is not available")。対象の職業に "#" は無かった。

### 照合

- 全国の雇用者数と州の合計(reports/U1-us-bls_oews_emp_check.csv): 47-0000 は全国 6,425,160、50 州 + DC の合計 6,425,180(比 1.0000)、領土 3 を足すと 6,471,150(比 1.0072)。全国の値は領土を含まない。51 地域以上で公表され "**" が無い 18 職業は比 0.9992〜1.0004(丸めの範囲)。比が 1 から離れるのは、州で "**" がある職業(43)と、州で行そのものが無い職業(例: 47-5043 Roof Bolters は 7 地域だけ、比 0.75)。全国にだけある minor・broad の 42 行は比較対象外。
- 階層: 全国で 47-0000 と minor 5 群の合計の差 10、detailed の合計との差 -40(10 人単位の丸め)。州では全 54 地域で 47-0000 が detailed(値のある行)の合計以上(差の最小 190)。
- 別の読み方: 年収 = 時給 x 2080 を平均と 5 分位の全 17,118 組で確かめ、差は最大 15.20 ドル。時給の丸め(0.005 x 2080 = 10.4)と年収の丸め(5)の上限 15.4 ドルの内側に全組が入った。

## ECI(index_bls_eci.csv、余力分)

- ci.series のうち季節調整なし・current dollar index・系列名に construction を含む 17 系列(建設業の総報酬・賃金 CIU2012300000000I / CIU2022300000000I、建設関連職業群の総報酬・賃金・福利 civilian / private ほか)。2016Q1〜2026Q2、各 42 四半期、欠け 0、台帳の終了四半期と一致。
- 単位は index (2005-12 = 100)。取得したファイルに基準の記載が無いので、news release Table 4 の見出し "Indexes (Dec. 2005=100)" を根拠にした(civilian の表。private の系列も同じ ECI の current dollar index として同じ基準と扱った。note に明記)。
- 照合: Table 4 の civilian 2 系列 x 3 四半期(2025Q2、2026Q1、2026Q2)と flat file が 6/6 で一致。

## 取れなかったもの・取らなかったもの

- API v1 の POST(複数系列・10 年): Apify の web-fetch は GET だけ。apify/cheerio-scraper(method/payload を受ける)は "This Actor requires full access to your account. You must approve its permissions before running it" で止まり、承認はこちらでできない。GET https://api.bls.gov/publicAPI/v1/timeseries/data/WPUIP2312001?startyear=2016&endyear=2025 は年の指定を無視して 2024-01〜2026-08 だけを返した。API の問い合わせは今日 1 回だけ。
- PPI Final demand construction(WPUFD43 / 431 / 432): wp.data.22.FD-ID が 10,541,754 bytes で、1 回では Apify の上限を超える。Range 分割で取れる見込み。
- PPI の OSB(WPU09220124、wp.data.10.Pulp)、空調機器(WPU1148、wp.data.12b)、配線器具(WPU1171、wp.data.12c)、WPU80 系(PCU236 系と同じ指数の商品コード版、wp.data.80.Construction): 取得を絞ったため未取得。
- CPI の住宅修繕関連: 未着手。

## 原本で気づいたこと

- 産業別の一覧で PCU2364002364002221 だけ "Electrical contractors, northeast" と小文字(他は Northeast)。原文のまま area_label に残した。
- 依頼文の「新築の非住宅建物 PCU236211236211」は、一覧では "New industrial building construction"(新築の工業建物)。非住宅全体の系列は地域別の PCU236500236500 "New nonresidential building construction by region" と業者の種類別の PCU236400236400。
- WPU10250239(銅管)は台帳の終了月が 2026-04 で、他の 256 系列(2026-08)より 4 か月古い。

## 次に取るべきもの

1. wp.data.22.FD-ID を Range で分割取得して WPUFD43 系を足す。
2. OSB・空調・配線器具の flat file(10.Pulp、12b、12c)。
3. CPI の住宅修繕関連(cu.series で ID を確かめてから)。
4. OEWS の都市圏別(oesm25ma.zip、Range 分割が要る見込み)と過去年(oesm24st 以前)で時系列化。
