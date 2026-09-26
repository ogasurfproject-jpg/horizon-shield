# US-C-bls-geo 報告(2026-09-26)

## 結論

- 米国 BLS の建設の賃金と価格を、地域の細かさと時系列で広げた。新しく 20 ファイル、992,804 行(public_domain 896,364、not_set 96,440)。検査器は全ファイル(185 ファイル、3,206,783 行)で誤り 0。
- QCEW(四半期雇用賃金センサス)年平均 2016〜2025 年: 建設業 NAICS 23 と 236 / 237 / 238 は全国・州・郡、4〜6 桁(BLS 独自の住宅・非住宅の 6 桁を含む 88 業種)は全国・州。民間(own_code 5)。1 年 約 7 万行 x 10 年。
- OEWS: May 2025 の都市圏(MSA 393)と、May 2021〜May 2024 の全国・州(U1 の May 2025 と同じ 110 職業、同じ列の作り方で 2021〜2025 の 5 年がつながる)。
- PPI: Final demand construction(WPUFD43 / 431 / 432)2016-01〜2026-08 と、住宅の資材・設備 27 系列(キャビネット、木製窓・扉、給湯器、暖房炉、空調、ヒートポンプ、配線器具、OSB、カーペット、家電 など)。
- CPI: 住宅(dwelling)の maintenance and repair の系列は現行の CPI に無い(cu.series で確認)。近い 3 系列(Repair of household items、Tools, hardware ...)を入れ、そのことを全行の note に書いた。
- 取れなかったもの: wp.data.22.FD-ID の flat file(Apify の上限超えで HTTP 413、Range も効かず)。代わりに系列ページの HTML で 3 系列を取った。

## 作ったファイル

| ファイル | 行数 | public_domain | not_set | bytes |
|---|---|---|---|---|
| observations/us/wage_bls_qcew_2016.csv | 70,716 | 61,809 | 8,907 | 36,356,619 |
| observations/us/wage_bls_qcew_2017.csv | 70,516 | 61,888 | 8,628 | 36,129,577 |
| observations/us/wage_bls_qcew_2018.csv | 70,536 | 61,830 | 8,706 | 36,176,187 |
| observations/us/wage_bls_qcew_2019.csv | 70,568 | 61,835 | 8,733 | 36,207,287 |
| observations/us/wage_bls_qcew_2020.csv | 70,612 | 61,795 | 8,817 | 36,270,727 |
| observations/us/wage_bls_qcew_2021.csv | 70,636 | 61,831 | 8,805 | 36,275,979 |
| observations/us/wage_bls_qcew_2022.csv | 70,748 | 62,129 | 8,619 | 36,365,223 |
| observations/us/wage_bls_qcew_2023.csv | 70,776 | 62,319 | 8,457 | 36,309,994 |
| observations/us/wage_bls_qcew_2024.csv | 70,700 | 60,029 | 10,671 | 37,346,412 |
| observations/us/wage_bls_qcew_2025.csv | 70,680 | 56,472 | 14,208 | 39,043,218 |
| observations/us/wage_bls_oews_metro_2025_a.csv(AREA < 30000) | 65,104 | 64,809 | 295 | 27,994,582 |
| observations/us/wage_bls_oews_metro_2025_b.csv(AREA >= 30000) | 66,417 | 66,142 | 275 | 28,742,991 |
| observations/us/wage_bls_oews_2024.csv | 37,427 | 37,164 | 263 | 15,096,453 |
| observations/us/wage_bls_oews_2023.csv | 37,765 | 37,604 | 161 | 15,232,414 |
| observations/us/wage_bls_oews_2022.csv | 37,726 | 37,509 | 217 | 15,325,648 |
| observations/us/wage_bls_oews_2021.csv | 37,882 | 37,392 | 490 | 15,394,857 |
| observations/us/index_bls_ppi_fd.csv | 384 | 384 | 0 | 146,476 |
| observations/us/index_bls_ppi_resid.csv | 3,237 | 3,098 | 139 | 1,106,752 |
| observations/us/index_bls_cpi_repair.csv | 374 | 325 | 49 | 258,255 |

- 都市圏の OEWS は 1 本だと 56.7MB で 50MB を超えるので、AREA(CBSA)コードで 2 本に分けた。
- parser(入力は raw/ の原本だけ。2 回走らせて出力 CSV と台帳 49 ファイルの sha256 が同じことを確かめた):
  - tools/parsers/parse_bls_qcew.py
  - tools/parsers/parse_bls_oews_geo.py
  - tools/parsers/parse_bls_ppi_cpi_geo.py
- 台帳(29 本): bls-qcew-2016-annual 〜 bls-qcew-2025-annual、bls-oews-m2025-metro、bls-oews-m2021〜m2024-national / -state、bls-ppi-ts-wpufd43 / 431 / 432、bls-ppi-wp-10 / -12b / -12c / -13、bls-ppi-wp-9-resid / -11b-resid、bls-cpi-cu-data-12
- 許可一覧の追加: tools/extra_enums/US-C-bls-geo.json(wage_weekly_mean: QCEW の annual_avg_wkly_wage)
- 照合の表: reports/US-C-bls-geo_qcew_check.csv(49,433 組)、reports/US-C-bls-geo_qcew_summary.json、reports/US-C-bls-geo_oews_check.csv(341 組)、reports/US-C-bls-geo_ppi_cpi_check.csv(33 系列)
- tools/apply_decisions_20260926.py を走らせた。observations / sources の全ファイルの sha256 は前後で変化なし。

## 利用条件

- BLS の著作権の頁(https://www.bls.gov/opub/copyright-information.htm、U1 が取った raw/bls-copyright.htm)の条文を、既存の bls-*.json と同じく license_quote にそのまま写した: "The Bureau of Labor Statistics (BLS) is a Federal government agency and everything that we publish, both in hard copy and electronically, is in the public domain, except for previously copyrighted photographs and illustrations. You are free to use our public domain material without specific permission, although we do ask that you cite the Bureau of Labor Statistics as the source."
- 判断: QCEW・OEWS・PPI・CPI はどれも BLS の公表物の数値表で、写真・図の例外に当たらない。全行 license US-PD-17USC105、値のある行は public_domain。台帳に attribution(Source: U.S. Bureau of Labor Statistics, ...)。

## 取った原本(すべて Apify web-fetch formats=raw。bytes は Content-Length / Content-Range と一致)

### QCEW(zip 全体ではなく、Range で必要な区間だけ)

各年の https://data.bls.gov/cew/data/files/<年>/csv/<年>_annual_by_industry.zip(全 1.2〜1.6 億 bytes)について、
(1) 末尾 600,000 bytes(中央ディレクトリ)を Range bytes=-600000 で取り、(2) 建設業のメンバー 92 本(名前が "<年>.annual 23..." のもの)が並ぶ区間を Range で 2 回に分けて取り、連結した。
どの回も HTTP 206、同じ ETag、Content-Range の全長が同じ。ETag の前半は 16 進で全長と一致した(10/10 年)。
中央ディレクトリから各メンバーの位置・圧縮後の大きさ・CRC32 を読み、区間から展開して、展開後の大きさと CRC32 が一致することを全 920 メンバーで確かめた。
zip 全体の sha256 は、全体を取っていないので無い。台帳の sha256 は区間(raw/bls-qcew-<年>-annual-by-industry.zip.seg.bin)のもの、各回の sha256 と各メンバーの CRC32・sha256 も台帳に書いた。

| 年 | zip 全長 | Last-Modified | 区間 bytes | 区間 sha256(先頭) |
|---|---|---|---|---|
| 2016 | 149,261,372 | 2018-06-01 | 10,094,668 | b96febd32f90 |
| 2017 | 142,937,089 | 2018-08-28 | 9,731,979 | 57f094327ac7 |
| 2018 | 149,885,017 | 2019-09-06 | 10,154,942 | 6f7e92f888a1 |
| 2019 | 150,370,964 | 2020-08-25 | 10,167,757 | 5364fd034eb1 |
| 2020 | 146,017,937 | 2021-08-19 | 9,837,016 | f39f4deef840 |
| 2021 | 152,141,127 | 2022-09-01 | 10,239,155 | 115eb50c4de9 |
| 2022 | 145,317,221 | 2023-08-31 | 10,137,741 | 9edcac75d27c |
| 2023 | 160,420,434 | 2024-08-29 | 10,728,353 | 7f78597e0d52 |
| 2024 | 144,722,455 | 2025-09-02 | 9,532,943 | 128d00eb424e |
| 2025 | 119,556,141 | 2026-08-21 | 7,838,260 | 586645b14473 |

- 照合用: https://data.bls.gov/cew/data/api/2024/a/industry/23.csv(1,087,346 bytes、sha256 c7a61add473b、ETag の前半 0x109772 = 1,087,346)
- 列と符号の定義の原文: 
  - layout の頁 https://www.bls.gov/cew/about-data/downloadable-file-layouts/annual/naics-based-annual-layout.htm(106,200 bytes、7edeab942143): "1-character disclosure code (either ' '(blank) or 'N' not disclosed)"
  - Q&A の頁 https://www.bls.gov/cew/questions-and-answers.htm(99,794 bytes、9003624ee5e1): "Suppressed data fields are published with an "N" in the disclosure code field. Only establishment counts are disclosed for these cells, based on approval from this Federal Register Notice , while all other data items for the cell are suppressed (zero-filled)."

### OEWS

| 原本 | bytes | sha256(先頭) | 取り方 |
|---|---|---|---|
| https://www.bls.gov/oes/special-requests/oesm25ma.zip(MSA_M2025_dl.xlsx、BOS_M2025_dl.xlsx) | 39,932,338 | cc3e6fa80edf | Range 6,000,000 bytes x 7 回を連結 |
| oesm24st.zip / oesm23st.zip / oesm22st.zip / oesm21st.zip | 7,617,815 / 7,445,440 / 7,424,445 / 7,525,249 | 5b66eb673f12 / e76daf090fc4 / 5d1fdf7bd2d0 / a4397cb15245 | Range 2 回を連結 |
| oesm24nat.zip / oesm23nat.zip / oesm22nat.zip / oesm21nat.zip | 282,052 / 271,583 / 266,448 / 278,152 | 5fa368aa034c / 8ce5e8277c3b / 725348e28b50 / 83ad09f19e62 | 1 回(HTTP 200) |

- 分割した回はどれも HTTP 206、同じ ETag、連結後の bytes = Content-Range の全長、zip の testzip(CRC)が通った。各回の Content-Range と sha256 は raw/bls-oews-fetch-manifest.json と台帳の parts に。Last-Modified はどれも 2026-05-15(過去年のファイルも 2026-05 に置き直されている)。

### PPI / CPI

| 原本 | bytes | sha256(先頭) |
|---|---|---|
| https://data.bls.gov/timeseries/WPUFD43?years_option=specific_years&from_year=2016&to_year=2026&output_view=data | 63,544 | d40905167cfb |
| 同 WPUFD431 / WPUFD432 | 63,641 / 63,609 | 4dcede16841a / b473efead84f |
| https://api.bls.gov/publicAPI/v1/timeseries/data/WPUFD43(照合用) | 3,617 | 0eaded8074ba |
| https://download.bls.gov/pub/time.series/wp/wp.data.10.Pulp | 3,710,772 | 0a16369e1c23 |
| wp.data.12b.Machinery114-116 / wp.data.12c.Machinery117-119 / wp.data.13.Furniture | 5,164,973 / 4,743,865 / 3,243,233 | dec392a5ed73 / f314abea2ed4 / 51cebfce7227 |
| https://download.bls.gov/pub/time.series/cu/cu.data.12.USHousing | 2,703,462 | f8d97f2dce4a |
| cu.series / cu.footnote | 1,339,447 / 100 | f7367ea78513 / d92c2f0b60f9 |

- wp.data.9.Lumber と wp.data.11b.Metals104-109 は U1 が取った raw をそのまま読んだ(再取得していない)。U1 の台帳は変えず、この担当の系列だけを bls-ppi-wp-9-resid / bls-ppi-wp-11b-resid で持つ(同じ原本・同じ sha256 を指す)。
- API v1 の応答と cu.footnote は結果がファイルに落ちず会話に出たので、その文字列(cu.footnote は base64)から復元し、bytes が Content-Length(3,617 / 100)と一致することを確かめた。

## QCEW(wage_bls_qcew_<年>.csv)

- 対象: 所有区分 own_code 5(Private)。建設の業種ファイルには own_code 0(合計)の行が無く、1 / 2 / 3(連邦・州・地方政府)と 5 だけなので、合計は入れていない(政府の行は入れていない)。
- 業種: 2 桁(23)と 3 桁(236 / 237 / 238)は全国(US000)・州(51 + PR + VI)・郡(xx999 の Unknown Or Undefined を含む)。4〜6 桁 88 業種(4 桁 10、5 桁 28、6 桁 50。BLS 独自の住宅・非住宅の 6 桁 238111 など)は全国・州だけ(郡まで入れると 1 年で約 16 万行増えて 1 年 100MB を超えるため。原本 raw には郡の行もある)。
- 1 行から 4 観測: 事業所数(annual_avg_estabs_count、count)、雇用者数(annual_avg_emplvl、count)、週平均賃金(annual_avg_wkly_wage、wage_weekly_mean、USD/week)、年平均給与(avg_annual_pay、wage_annual_mean、USD/year)。layer はすべて wage。period は年(2016〜2025)。
- disclosure_code N の行: 事業所数は値を入れ(Q&A の原文どおり事業所数だけは公表)、雇用者数・賃金は not_set、note に layout と Q&A の原文。原本の値は 0 埋め。N の not_set は 2016〜2023 年は毎年 8,400〜8,900、2024 年 10,671、2025 年 14,208 と増えている(2025 年の年平均で秘匿が多い)。
- 入れなかった行(年ごとに数えた): MSA の行(agglvl 44〜48、area_fips C####)は 2016〜2024 のファイルに毎年約 3.3 万行あるが範囲外として入れていない(2025 のファイルには MSA の行が無い)。政府の行(own 1/2/3)は年 約 1.5 万行。

### 照合(全数)

- 郡(xx999 を含む)の合計と州(49,433 組のうち郡と州の組 48,513、private、全業種ファイル):
  - 事業所数: 完全一致 15,330 組、全組(48,513)が丸めの幅(0.5 x 郡の数 + 0.5)の内側。事業所数も雇用者数も四半期・月の平均を整数に丸めた値なので、完全一致しないのは丸め。
  - 郡に N が 1 つも無く州も開示の 1,748 組: 年間賃金総額(total_annual_wages、丸めの無い合計)は 1,748 / 1,748 で完全一致。雇用者数は完全一致 1,061、丸めの幅の内側 1,748 / 1,748。
  - 郡に N がある 44,155 組: 開示された郡の賃金総額の合計は全組で州以下(44,155 / 44,155)。雇用者数の合計が州を 1〜5 人上回る組が 6(丸め)。
- 州(50 州 + DC)の合計と全国(920 組): 事業所数は全組が丸めの幅の内側。N の無い 456 組で賃金総額が完全一致 456 / 456、雇用者数は丸めの幅の内側 456 / 456。
- 別の読み方: 年平均給与 = total_annual_wages / annual_avg_emplvl、週平均賃金 = 同 / 52 を、開示されていて雇用者数が 0 でない全 145,105 行で確かめた。雇用者数が整数に丸めてあるので、雇用者数 +- 0.5 の幅で割った区間(+- 1 ドル)に 145,105 / 145,105 が入った。雇用者数 1,000 人以上の 51,740 行では、そのまま割った値との差は最大で年 59.98 ドル、週 1.43 ドル。
- 別の組版: 2024 年の API の industry/23.csv(6,475 行)と zip のメンバー 23(6,475 行)を全行で突き合わせ、事業所数・雇用者数・賃金総額・週平均賃金・年平均給与・disclosure_code が 6,475 / 6,475 で一致。
- zip の完全性: 全 920 メンバーで CRC32 と展開後の大きさが中央ディレクトリと一致。

## OEWS

- 都市圏(wage_bls_oews_metro_2025_a / _b): MSA_M2025_dl.xlsx の AREA_TYPE 4(393 地域、プエルトリコの 6 を含む)。職業は U1 と同じ(SOC 47-xxxx の全行と 11-9021、13-1051、17-1011、17-2051、17-3011、17-3022、49-9021)。都市圏のファイルには major と detailed しか無い。10,117 職業行 x 13 観測。geo_level metro、geo_code は原本の AREA(CBSA 5 桁)、geo_name は原本の PRIM_STATE の州(複数の州にまたがる都市圏は note に書いた)。BOS_M2025_dl.xlsx(非都市圏 137 地域)は都市圏ではないので観測にせず、照合にだけ使った。
- 過去年(wage_bls_oews_2021〜2024): 全国 110 行と州(領土を含む 54 地域)。item_name / spec / unit / obs_id の作り方は U1 と同じ(source_id と period だけが違う)ので、全国の 110 職業は 2021〜2025 の 5 年すべてでつながる(110 / 110)。
- 記号: "*" 960、"**" 717、"#" 24 観測を not_set(note にそのファイルの Field Descriptions の Notes の原文。"#" の閾値の文言は年で違うので年ごとの原文)。

### 照合

- 年収 = 時給 x 2080 を平均と 5 分位の全 129,810 組で確かめ、差は最大 15.20 ドル。全組が丸めの上限 15.4 ドルの内側。
- 都市圏(プエルトリコを除く)+ 非都市圏(BOS)の雇用者数の合計と全国(May 2025): 69 職業すべてで合計 <= 全国。全職業(00-0000)で比 0.9642、47-0000 で比 0.9695。都市圏と非都市圏に割り当てられない雇用が約 3.6% あり、建設の大分類もほぼ同じ比になった。
- 全国と州(50 州 + DC)の合計(2021〜2024): 州に "**" の無い職業で比 1 から 0.1% 以内が 2024: 16/22、2023: 17/29、2022: 19/29、2021: 17/20、1% 以内が 21/22、25/29、26/29、18/20。合計が全国を超えた組は 9(最大 1.0034、2024 年 Civil Engineering Technologists)。1% を超えてずれるのは州で行そのものが無い職業。

## PPI / CPI

- index_bls_ppi_fd.csv: WPUFD43 Final demand construction、WPUFD431 Construction for private capital investment、WPUFD432 Construction for government。2016-01〜2026-08 の各 128 か月、欠け 0。単位 index (2009-11 = 100)(系列の台帳 wp.series の base_date と頁の Base Date が一致)。脚注 P(速報)各 4 か月、note に表の tfoot の原文。
  - 照合: API v1 の応答(2024-01〜2026-08 の 32 か月、年平均 2 は除外)と HTML の表を全月で突き合わせ、32 / 32 で値と脚注 P が一致。
- index_bls_ppi_resid.csv: 27 系列(U1 の 257 系列とは重ならないことを parser で検査)。期待 3,237 月、値あり 3,098、欠け 139(not_set)。欠けは WPU12410445 Room air-conditioners 84、WPU10730120 Sheet metal air-conditioning ducts 30、WPU106201461 Warm air furnaces 24、WPU107103 Metal windows 1。全系列でファイルの最終月が台帳の終了月と一致。台帳の終了月が 2026-08 より前の系列: OSB(WPU09220124)と浴室洗面台(WPU08210106)は 2019-01、暖房炉(WPU106201461)は 2024-05、給湯器 3 系列は 2026-05、ユニタリー空調(WPU114802)は 2026-07。
- index_bls_cpi_repair.csv: CUUR0000SEHP04 Repair of household items、CUUR0000SEHM Tools, hardware, outdoor equipment and supplies、CUUR0000SEHM01 Tools, hardware and supplies(U.S. city average、CPI-U、季節調整なし、月次)。単位は cu.series の base_period の原文(DECEMBER 1997=100)。
  - cu.series で series_title に maintenance を含む品目は Motor vehicle maintenance and repair / Motor vehicle maintenance and servicing / Water and sewerage maintenance だけで、住宅の maintenance and repair は無い。全行の note にこのことを書いた。
  - 欠け: SEHP04 は 2016-01〜2025-10 のうち 47 か月が値なし(2021-06〜2022-09 など行が無い月と、2025-10 の "-")。SEHM と SEHM01 は 2025-10 の 1 か月が "-"。"-" の月の脚注 X の原文 "Data unavailable due to the 2025 lapse in appropriations" を note に。

## 取れなかったもの・入れなかったもの

- wp.data.22.FD-ID(10,541,754 bytes): https://download.bls.gov/pub/time.series/wp/wp.data.22.FD-ID を Range bytes=0-5299999 で取ろうとしたが、HTTP 413(本文 56 bytes、x-apify-unblocker-max-body-bytes: 10485760)。download.bls.gov では Range が効かない(cu.footnote を Range bytes=0-9 で取ると 200 で全体が HTML に包まれて返った)。このため Intermediate demand の建設関連(WPUID5xx、約 30 系列)と WPUFD49215 / WPUFD49404 は入れていない。系列ページの HTML なら 1 系列 1 回で取れる。
- QCEW の MSA の行(2016〜2024): 範囲外として入れていない。area_fips が C####(4 桁)で、検査器の都市圏コード(5〜7 桁の数字)に合わず、CBSA への変換の根拠となる原文を確かめていない。
- QCEW の郡の 4〜6 桁: 大きさの都合で入れていない(raw の区間に入っている)。
- OEWS の非都市圏(BOS、137 地域): 都市圏ではないので観測にしていない(照合にだけ使用)。
- cu.item(16,554 bytes): 中身は目で確かめたが、結果が会話に直接出たので raw には置いていない(品目の判断は raw にある cu.series で再現できる)。

## 原本で気づいたこと

- oesm22st.zip に Excel の一時ファイル "oesm22st/~$state_M2022_dl.xlsx"(165 bytes)が入っている。読んでいない。
- QCEW の by_industry の zip は 2016〜2024 年のファイルに MSA の行があるが、2025 年のファイルには無い。2025 年は N(秘匿)の行が多い(建設の private で N の not_set が 2023 年 8,457 から 2025 年 14,208 へ)。例: Autauga County, Alabama の NAICS 23 private が 2025 年は N。
- QCEW の ETag の前半はファイルの bytes の 16 進(10 年とも一致)。
- CPI SEHP04 は台帳の終了月が 2025-10 で、その月の値が "-"(脚注 X)。以後の更新が無い。
- PPI WPU12410445(Room air-conditioners)は 2016 年以降 84 か月の行が無い。

## 作業上の注意(自分の誤り)

- 共有の tool-results フォルダで、取り込み済みの自分の結果ファイルを消すつもりで、時刻の範囲(名前 mcp-Apify-get-dataset-items-17903929*〜17903930*)で rm した。同じ時間帯に別の担当の結果ファイルがあれば消えている可能性がある。その担当の取得がファイルを見つけられない場合は、get-dataset-items をもう一度呼べば同じ内容が得られる。

## 次に取るべきもの

1. PPI の Intermediate demand の建設関連(WPUID5xx)を系列ページの HTML で取る(1 系列 1 回)。
2. QCEW の MSA(C#### と CBSA の対応を BLS の area titles の頁で確かめてから)と、郡の 4〜6 桁(raw にある。年 2 ファイルに分ける)。
3. OEWS の非都市圏(BOS)を入れるかどうかの判断(geo_level の追加が要る)と、May 2019〜2020(hybrid SOC)の過去年。
4. QCEW の四半期データ(建設の季節性)。
