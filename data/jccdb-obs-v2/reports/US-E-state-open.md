# US-E-state-open 報告: 州・連邦のオープンデータにある建設の単価

作成 2026-09-26 / 担当 US-E-state-open

## 結論

1. 州・市のオープンデータポータルで、再利用を明示的に許すライセンスが付いた入札の品目単価のデータは **見つからなかった**。Socrata の全ドメインをカタログ API で横断検索し、品目単価を持つデータセットは TxDOT の Bid Tabulations(data.texas.gov)と Hawaii DOT の Bid Tab Data(highways.hidot.hawaii.gov)の 2 つだけだった。どちらもデータセットの license 欄が空で、ポータルの条文にも再利用を許す文言がない(ハワイは商用利用と自動取得を禁じている)。値は入れていない。
2. 代わりに、連邦政府の著作物(17 U.S.C. 105、公有)で建設の単価を持つ 2 出典を入れた。
   - FHWA「Price Trends for Federal-Aid Highway Construction」(1987 Base、2006 年第 4 四半期で終了した刊行物のアーカイブ): 入札に基づく平均契約単価。全国 1972〜2006 年、地方部・都市部、3 四半期移動、**州別 1998〜2006 年(50 州 + DC + PR)**。3,834 行。
   - FTA Capital Cost Database(2024 年 9 月更新の CSV): 竣工した連邦補助の交通プロジェクト 65 件の要素別の出来形単価。3,508 行(layer は work。入札単価ではないので bid_item にしていない)。
3. Caltrans Contract Cost Data は一括の原本が取れなかった。検索画面のトップは生きていて(3,460,882 records、最新の開札日 09-23-2026 と表示。前回報告の「2024-08-15 で更新停止」から再開している)、条件も開いているが、結果の頁 results.php とコード検索 codes.php は Apify 経由で 404、District 8 のミラーは 120 秒で時間切れ、本部の Bid Summary は ServiceNow の画面で「Loading...」しか返らない。
4. 検査器: 私の 2 ファイル(7,342 行)と 10 台帳で誤り 0。parser は 2 回走らせて同じ CSV と台帳(md5 一致)。apply_decisions_20260926.py も走らせ、私のファイルが変わらないことを確かめた。全体の実行(113 ファイル、609,712 行)では誤りが 744 件あるが、全部が他の担当が作業中のファイル(city permits 系、cbr_tokuchou)で、私のものではない。

## 作ったもの

| ファイル | 行 | status | 中身 |
|---|---|---|---|
| observations/us/bid_item_fhwa_pricetrends_1972_2006.csv | 3,834 | public_domain 3,317 / not_set 517 | 下の表 |
| observations/us/work_fta_capcost_2024_09.csv | 3,508 | public_domain 2,796 / not_set 712 | 65 プロジェクト x SCC 要素 |

FHWA の内訳(source_page 別):

| 表 | 出典 | 行 | 内容 |
|---|---|---|---|
| 表 1 | fhwa-pricetrends-2006q4 | 282 | 全国、1972〜2006 年の年計 35 行 + 2004〜2006 年の四半期 12 行、6 品目 |
| 表 2・3 | fhwa-pricetrends-2006q4 | 282 + 282 | 地方部(Rural)・都市部(Urban)、同じ 47 期、各 3 品目 x 2 |
| 表 4 | fhwa-pricetrends-2006q4 | 180(not_set 6) | 3 四半期移動(1986〜2003 年と 2004〜2006 年の四半期)。2006 年第 4 四半期は原本が空欄 |
| 表 5 | 各年の第 4 四半期号 9 本 | 312 x 9 = 2,808(not_set 511) | 州別の年計 1998〜2006 年、52 地域 x 6 品目 |

- 6 品目: Common excavation(cu. yd.)、Portland cement concrete(sq. yd.、9 インチ厚に換算)、Bituminous concrete(ton)、Reinforcing steel(lb.)、Structural steel(lb.)、Structural concrete(cu. yd.)。unit は原本の単位の文字、currency USD。
- price = Average contract price、ref_value = 同じ行の Index(1987 = 100)。0.00 と空欄は not_set。単価があり指数が 0.00 の 17 行(1987 年に PCC 舗装が無かった州など)は note に記した。
- 州別表の United States 行は出力せず、照合に使った。area_label は原本の州名の表示のまま(2005 年号は CT など略号)。
- 許可一覧の追加: tools/extra_enums/US-E-state-open.json に price_basis 3 つ(bid_avg_contract_price、bid_avg_contract_price_3q_moving、asbuilt_unit_cost_midpoint)。FHWA の Average contract price は加重か単純かが原本に書かれていないので bid_weighted_avg と分けた。

FTA の内訳: 原本 12,805 行 = 65 プロジェクト x 197 要素。値あり 2,796、not_set 712(Units が Hard Costs の要素 585: 原本の単価欄が比率を通貨の書式で丸めた $0 / $1 なので値にしない、単価欄が $0 の行 27、費用だけで単価が空欄の行 100)、書かなかった行 9,297(費用も単価も空欄 9,296、中間年が空欄 1)。area_label = プロジェクト名、spec = SCC の要素番号、period = 工事期間の中間年、ref_value = 数量(not_set の行は費用)。原本の「Unit Cost in National Average, User Selected Analysis Year 2024」列は写していない。FTA の Quick Guide(June 2023)に「The default index is the RS Means Construction Cost Index.」とあり、市販の指数で物価・地域を補正した値だから。

parser: tools/parsers/parse_fhwa_pricetrends.py、tools/parsers/parse_fta_capcost.py。照合の数字: reports/US-E-fhwa-pricetrends-checks.json、reports/US-E-fta-capcost-checks.json。

## 取った出典

| source_id | URL | bytes | sha256 |
|---|---|---|---|
| fhwa-pricetrends-2006q4 | https://www.fhwa.dot.gov/programadmin/pt2006q4.cfm | 84,577 | ca40d166668626a1d17c846a299153ff4d87b073f37a7ac60dd43d0afe1770af |
| (同じ号の PDF、照合用) | https://www.fhwa.dot.gov/programadmin/pt2006q4.pdf | 630,938 | 353508d6e22ac86ae04d88d9e0e58fb2536996c83e830bf541d92d13dd668286 |
| fhwa-pricetrends-2005q4 | .../pt2005q4.cfm | 89,319 | b953d51e6074a56045f9d05c3df7447c513d3c10a9a355ee0c1d0bfde100fd30 |
| fhwa-pricetrends-2004q4 | .../pt2004q4.cfm | 90,185 | 0ba7d55ed450bacfe130ca358865de9db7b4b106d4d2edd4d1268106db65657d |
| fhwa-pricetrends-2003q4 | .../pt2003q4.cfm | 88,809 | 4f50e97af0f10d0573939f28275ef55e2abeafbd66b49a60a0c1258dbc054679 |
| fhwa-pricetrends-2002q4 | .../pt2002q4.cfm | 86,889 | 60b7c675941d095f4b055efb27963c2dc22ca54dc58990b9cf9b8165de28083c |
| fhwa-pricetrends-2001q4 | .../pt2001q4.cfm | 83,336 | 6f6d3ac6c19eb37bab8c69560382884404e61fa4a8414678c29e07171a919cb5 |
| fhwa-pricetrends-2000q4 | .../pt2000q4.cfm | 91,473 | f94165c5e6315c3fc27a0eec7817740f3c1870e7e84739af479695247a127ab2 |
| fhwa-pricetrends-1999q4 | .../pt1999q4.cfm | 90,215 | 4ca572f246d1d2ef37cf65443a61cdbad922903550388dab307fb815d7532b9e |
| fhwa-pricetrends-1998q4 | .../pt1998q4.cfm | 86,422 | a4d50f076bb8831187ad62be09894c94cd9f56b873e271c85b002a2a82fef999 |
| fta-capcost-2024-09 | https://www.transit.dot.gov/sites/fta.dot.gov/files/docs/FTA-Cost-Database-September-2024.csv | 1,849,004 | 64ef6c4d8d74bf42c73c2bdc971524ca73a3c2c8378aa593fa161df8a44cf46e |

原本は全部 raw/ に置いた(連邦の公有)。取り方は Apify apify/web-fetch formats=raw。HTML と CSV は文字として返るので UTF-8 で保存した。

### 利用条件の判断

- FHWA: **US-PD-17USC105**。「Copyright protection under this title is not available for any work of the United States Government (17 U.S.C. 105)」。頁の本文(2006 Q4 号)に「This document is disseminated under the sponsorship of the Department of Transportation in the interest of information exchange. The United States Government assumes no liability for the use of the information contained in this document.」。9 本の HTML と PDF で copyright / © を検索して 0 件。FHWA の「Web Policies & Notices」の頁(https://www.fhwa.dot.gov/webpolicies/publishschedule.cfm)は Web 公開計画の頁で、再利用の条文はない。
- FTA: **US-PD-17USC105**。17 U.S.C. 105 に加え、FTA Web Policies(Last updated: Tuesday, September 13, 2022)の Photo Policy「FTA does not restrict or hinder the public from downloading any information from its website.」。CSV に copyright の文字は 0 件。

### 注意(FTA の原本のバイト列)

CSV は text/csv で返り、Apify が文字として読み替えたため、UTF-8 でない 1 バイト文字(2 つのプロジェクト名「Ft. Collins ? Mason Corridor BRT」「Norfolk ? Tide LRT」の区切り、計 394 か所)が U+FFFD に置き換わっている。数値の列は ASCII だけで影響はない。プロジェクト名の該当の 1 文字は '-' と書き、該当行の note に記した。台帳の sha256 は保存したバイト列のもので、サーバーの原本とは一致しない可能性がある(Range: bytes=0-99 を付けても 200 で全体が返り、原本の長さを確かめられなかった)。原本どおりのバイト列が要るなら、同じ頁の .accdb(バイナリ)を取って mdbtools で読むのが次の手。

## 照合(別の数え方)

| 出典 | 照合 | 結果 |
|---|---|---|
| FHWA 全 9 号 | 行ごとの値の列の数(表 1・4・5 は 15、表 2 は 14、表 3 は 17、ラベルは class="left" のセル) | 全行で一致(違えば parser が止まる) |
| FHWA 2006 Q4 | 行数: 表 1 は 1972〜2006 年の 35 + 四半期 12 = 47 行、表 5 は 50 州 + DC + PR + United States = 53 行 | 一致(9 号とも 53 行) |
| FHWA 2006 Q4 | HTML の全ての小数の値 と 同じ号の PDF(pdftotext)に現れる小数の文字を多重集合で比べる | HTML 3,392 個、PDF 3,392 個、PDF に現れない HTML の値 0 |
| FHWA 2006 Q4 | 州別表の期間 | PDF に「Year: 2006」と印字、United States 行 = 表 1 の 2006 年の年計(15 列とも一致) |
| FHWA 9 号 | 州別表の United States 行 と 同じ号の表 1 のその年の年計(9 x 15 = 135 セル、印字の桁の違いは許す) | 不一致 1: 2002 年号の Structural concrete 374.90(州別表)と 374.96(表 1) |
| FHWA 9 号 | 州別表の United States 行 と 2006 Q4 号の表 1 のその年の年計(135 セル) | 不一致 2: 上の 2002 年、2003 年の Structural concrete の指数 168.59(2003 年号)と 158.5(2006 年号) |
| FTA | 原本の行数 | 12,805 = 65 プロジェクト x 197 要素(全プロジェクト 197) |
| FTA | 小計の行が構成要素の費用の和と一致するか(55 = 10+20+30+40+50、75 = 55+60+70、105 = 75+80+90+100) | 3 種とも 65/65 プロジェクトで一致(差 2〜4 ドル以内) |
| FTA | 単価 = 費用 / 数量 | 値のある 2,796 行のうち 2,781 行が 1 ドル以内。外れる 15 行の相対差は最大 0.38%(数量が整数に丸めて印字されているためと見られる) |
| FTA | 上位要素の費用 = 下位要素(xx.yy)の費用の和 | 490 組のうち 428 組が一致、62 組が不一致。原因は未確認(同じプロジェクトで要素ごとに中間年が違うものが 32 件ある) |

## 原本の誤植・不一致らしきもの

- FHWA 2006 Q4 号の表 1、2003 年の Structural concrete の指数が 158.5。価格 406.02 / 基準年 240.81 x 100 = 168.6 で、2003 Q4 号の州別表の United States 行も 168.59。2006 年号の印字の誤りと見られる(ref_value は原本のまま 158.5)。
- FHWA 2002 年の Structural concrete の価格が、2002 Q4 号の州別表の US 行で 374.90、同じ号と 2006 年号の表 1 で 374.96。
- FHWA の州別表に桁の外れた値がある(原本のまま): Washington 2006 年 Structural steel 96.112 ドル/lb(指数 6,967.06)、Maine 2006 年 PCC 4,700.00 ドル/sq. yd.(指数 0.00)、Pennsylvania 2006 年 Structural steel 10.000、DC 2005 年 Reinforcing steel 20.000、Rhode Island 2003 年 Structural steel 20.008 など。原本の注に「individual State indices may not be truly representative ... because of comparatively low volumes of work」。
- FHWA 2006 Q4 号の表 4 の行ラベル「2004:.」(句点の余分)。2006 年第 4 四半期の行は値が空欄(not_set 6 行)。
- FTA の Units が Hard Costs の要素は、単価欄が $0 か $1(比率を整数ドルの書式にした丸め)で意味をなさない。

## 州・ポータルごとに探した場所と判断

### ポータル横断の検索

- Socrata 全ドメイン(https://api.us.socrata.com/api/catalog/v1、Apify raw): q = bid item(21 件)、bid tabulation(8)、unit price(169)、bid prices(13)、weighted average bid(1)、bid results construction(6)、letting(34)、unit cost(514)。data.ny.gov、data.ct.gov、data.wa.gov、data.oregon.gov、data.colorado.gov、data.iowa.gov、data.texas.gov、data.pa.gov、opendata.maryland.gov、data.delaware.gov、data.cityofnewyork.us などの Socrata のポータルはこれで全部含まれる。品目の単価を持つのは TX と HI の 2 つだけ。
- CKAN data.ca.gov(package_search): bid は DGS の非競争契約 1 件、construction cost は医療施設の工事費など 8 件。Caltrans の単価は無い。
- ArcGIS Hub 横断検索(hub.arcgis.com/api/search/v1、q=bid): 2,674 件、上位 100 件は Business Improvement District の境界などで、入札の単価表は無い。q="bid tabulation" は 1 件(無関係)。
- catalog.data.gov の CKAN API(/api/3/action/package_search): 404(API の場所が変わっている)。

### 見つけたデータセットと判断

| 州・市 | データセット | 中身 | license 欄 | ポータル・機関の条文 | 判断 |
|---|---|---|---|---|---|
| TX | data.texas.gov de7b-7dna「Bid Tabulations」(TxDOT) | 直近 24 か月の州・地方の開札、入札者ごと・品目ごとの単価(BID ITEM UNIT PRICE AMOUNT、ENGINEER'S ESTIMATE UNIT PRICE、数量、単位、郡、管区) | 空(/api/views/de7b-7dna.json の license も licenseId も null、attribution は "TxDOT") | data.texas.gov の足元は Socrata の Terms of Service(http://www.socrata.com/terms-of-service、基盤の規約)へのリンクだけで、データの利用条件の頁は無い。texas.gov の案内頁は「Welcome to the Texas Open Data Portal, the official State repository for publicly accessible data! We believe in and promote open data.」だけで、ライセンスの条文は無い。TxDOT の Disclaimer(https://www.txdot.gov/about/disclaimer.html)は「Use of the Texas Department of Transportation ("TxDOT") Web site ("Site") is governed by the following terms, conditions, and disclaimers ("Terms").」に続く免責だけで、再利用を許す条文は無い | restricted(欄が空で条文も無い。分からないものは開けない)。取り込んでいない |
| TX | qh8x-rm8r「Official and Unofficial Bid Items」、h3h6-qwdh「Recapitulation」 | 次の 42 日の開札予定の品目(単価なし)、進行中の契約の出来高(前月) | 空 | 同上 | 取り込んでいない |
| HI | highways.hidot.hawaii.gov 5f6v-rbhq「Bid Tab Data - Numeric Values」 | 島ごとの開札の品目単価(落札者、最低 4 者、州の見積り) | 空(/api/views/5f6v-rbhq.json の license null) | ポータルの足元の Terms of Use(https://portal.ehawaii.gov/page/terms-of-use/)に「You agree not to use for commercial purposes, or resell, or allow your employees, agents or contractors to use for commercial purposes or resell any of the data derived from these Services unless you have been specifically allowed to do so in a separate, written agreement with the State of Hawai'i.」「You specifically agree not to access, or attempt to access ... any of the Services through any automated means (including, but not limited to, use of scripts, web crawlers or screen scrapers)」「Duplication or use of any content from this web site for commercial purposes or in any manner likely to give the impression of official approval by the State of Hawaiʻi is prohibited.」。州の CKAN ポータルの規約(https://opendata.hawaii.gov/pages/terms-of-use)も「Each Dataset is therefore likely to be subject to copyright protection ... Please read the license applicable to each Dataset.」 | restricted。自動取得も禁じているので、データの行は取っていない(条文を読む前にデータセットの説明 JSON を 1 回だけ取った) |
| NYC | data.cityofnewyork.us 9k82-ys7w「Bid Tabulations (Historical)」 | 市の物品調達の入札(食品、車両、事務用品など)。単位の列が無く、建設の単価ではない(先頭 40 行を確認) | 空 | 未確認(中身が対象外のため) | 対象外 |
| Cook County, IL | 32au-zaqn / pn38-yupm「Procurement - Bid Tabulations」 | 入札者ごとの入札総額(品目単価なし) | Public Domain | - | 対象外(単価が無い) |
| Baton Rouge, LA | u9zk-8nix「Bid Openings and Results」 | 開札の一覧(結果は別文書) | Public Domain | - | 対象外 |
| Austin, TX | 3ebq-e9iz「Purchase Order Quantity Price detail」 | 物品の発注単価(建設ではない) | 空 | - | 対象外 |
| CA Caltrans | Contract Cost Data(https://sv08data.dot.ca.gov/contractcost/) | 品目 x 管区 x 年の単価の検索(1993〜2026 年、3,460,882 records) | - | 条件は開いている(前回報告の conditions of use) | 一括の原本が取れない: results.php(?item=190101&ob=1&Year[]=y2025 など 2 通り)と codes.php が 404、https://d8data.dot.ca.gov/contractcost/results.php は 120 秒で時間切れ、本部の https://ppmoe.dot.ca.gov/cc?id=cc_bid_summary は ServiceNow の画面(markdown は「Loading...」だけ)。data.ca.gov にも無い |

前回(U3)に条件を確かめた約 40 州の DOT の判断は繰り返していない。州ポータル側で license 欄が開いた品目単価のデータセットは、上の検索の範囲では 0 件だった。

## Apify で取得したもの(記録)

- 検索: Socrata カタログ C24a5sNGEUS4sLgzT、35lnxwTh4sX9RnhBq、sRcvQB5vUQA9NGuzE、fCiR6j1Def3SJ2by1、EU4o22oPsHwReNMFH、n54zLEurW3Ma5PTWf、uoLF0deFrfdjORPh8、VAZ0vCtdNMnRSAZNJ。data.ca.gov Rag3ppDPTvfX2ydDH、FiGO72YD8J3l82Cbi。ArcGIS Hub Hzl5YAicXxLSonIYk、8JUfhsa06KaQuqpx5。catalog.data.gov(404)wCcFF7Lhge1gGFBd0。
- 条件: data.texas.gov の view JSON xLzaQnfenrRIflOMe、HDOT の view JSON qZnFOiEQ8oSAOM9s9、opendata.hawaii.gov 規約 VV3bwdVHnz5eaC5iA、eHawaii 規約 oou4UpeQiGD0KAE22、data.texas.gov の足元 5bP1Ef3bGPzP3sfxA、texas.gov の案内 0SQQgo0HwsmmoK67r、TxDOT Disclaimer 0VdR3xMMpQXjW5B8u、HDOT の足元 mbXKB9sK7gPraWmVV、FHWA Web Policies JSZMoYefiJyftBtWt、FTA Web Policies xYa9soWURSTjXaFL5。
- 原本: FHWA 2006Q4 HTML wYIOcodFkMaWPRgif、PDF gEn2IGa6Bx61u6mQS、2005Q4 ceqCmuX58zwIqwJVU、2004Q4 7qbx1kgvO1kVTAEOc、2003Q4 e4CBQtc3gVqsznRtw、2002Q4 RXR2KgswdBXRPz5nj、2001Q4 pJfk1Pw3sTwSnJQv2、2000Q4 O9mxIDOwsPSX2pplh、1999Q4 ZoWSe2WlOq9dmUwPT、1998Q4 lG4Jhznd0U1E7pQSn。FTA CSV fMlBbMXWNtJrn4vSK、Quick Guide PDF tevjIT0InelIckWcR。
- Caltrans: sv08data トップ 0TDdEFxKbey0JIwxl、results.php(404)UBZQJLQ8c0nXYTxRc と ROGNZxY01uAwLeFQq、codes.php(404)OAztxFYrfwrwF1sCO、d8data(時間切れ)run qEpv6fPuvlv1z1ysh、ppmoe Bid Summary T56lRDXIDWfyR7z7m。
- Apify の同時実行の上限(他の担当と共有で 5)に 4 回当たった。

## 次に取るべきもの

1. TxDOT に data.texas.gov の Bid Tabulations(de7b-7dna)の license 欄を開いてもらう(Public Domain / CC0 など)か、書面の許可を取る。24 か月分の品目 x 入札者の単価で、開けば品目 x 年 x 管区の集計(computed の行)を作れる。今の州の中で最も大きい。
2. FHWA Price Trends の第 1〜3 四半期号(1998〜2006 年、同じ組版)にも州別表がある。その期間が年初からの累計か四半期単独かを PDF の見出し(2006 Q4 号は「Year: 2006」)で確かめてから取り込む。
3. FTA は原本どおりのバイト列を残すため、同じ頁の 2024Sept30_FTA_Capital_Cost_Database.accdb(バイナリで base64 のまま返る)を取り、mdbtools で CSV と突き合わせる。
4. Caltrans Contract Cost Data は条件が開いていて 2026 年まで更新されているので、一括の書き出しを問い合わせる価値がある(検索画面は Apify から結果の頁が 404)。
