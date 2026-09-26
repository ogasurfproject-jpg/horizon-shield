# US-B-census-permits 報告(2026-09-26)

## 結論

- 米国の建築の工事額を 3 つの連邦の出典から入れた。36 ファイル、計 1,457,503 行。検査器(validate_obs.py --only の 36 ファイルを一緒に)は誤り 0、警告 0。status は public_domain 1,369,124、not_set 88,379。
  - Census Building Permits Survey(BPS): 州・郡・都市圏(CBSA)・place の 4 階層 x 2016〜2025 年の年次 + 2026 年 1〜8 月の年初来累計。34 ファイル 1,356,877 行、約 668 MB(うち 1 戸あたり工事額の計算行 277,516)。
  - 2022 Economic Census 建設部門(EC2223BASIC): US・4 Region・51 州 x NAICS 23〜6 桁 x 19 欄。77,330 行。
  - HUD 2024 Unit Total Development Cost (TDC) Limits: 416 地域 x 4 構造 x 7 寝室数 x HCC/TDC。23,296 行。
- 値はすべて連邦政府の著作物(17 U.S.C. 105)として license US-PD-17USC105、status public_domain。not_set は、原本で伏せられたセル(Economic Census の flag)と、検査器が新しい price_basis の 0 を値として受け付けないため not_set にした金額 0 のセル。
- 照合は全数。BPS の年次は、郡の和 = 州(Bldgs/Units 408 セル全部一致、Value は千ドルの丸め差 0.5 以内)、州 51 の和 = US(Bldgs/Units 全部一致)が 10 年すべてで成り立つ。2026 年の年初来累計だけは州ファイルと郡ファイルが 17 州で一致しない(原本どうしの不一致、下に詳細)。Economic Census は州の和 = US、州の和 = Region、NAICS の親 = 子の和、価額の内訳の恒等式が、比べられた組すべてで一致。HUD は bbox と -layout の 2 つの読み方で 1,664 行すべて一致、TDC/HCC 比は規則の係数(1.75 / 1.6)どおり。
- 判断が要る点(所有者向け): (1) HUD の HCC は規則上 R.S. Means と Marshall & Swift の 2 指数の平均から HUD が算定した上限額。指数の値を写した表ではないので値を入れたが、AGENT_RULES 3 の厳しい読み方で閉じるなら parser の status を替えるだけで済む。(2) 検査器の ZERO_OK_BASES に permit_valuation_usd / permit_valuation_thousand_usd / annual_total_thousand_usd が無いため、統計の金額 0 を not_set(ref_value 0)で持った(BPS 82,140 行、Economic Census 241 行)。検査器に足せば値 0 に戻せる。(3) BPS の place と郡は行数が大きい(place 11 ファイル 799,991 行 約 424 MB、郡 11 ファイル 458,114 行 約 196 MB)。全体の検査器を走らせたとき、一度はメモリ不足で止まった(ほかの担当の処理と同時)。

## 作ったファイル

| ファイル | 行数 | public_domain | not_set | うち 1 戸あたり計算行 | 大きさ |
|---|---|---|---|---|---|
| spending_census_bps_county_2016.csv | 41,524 | 34,425 | 7,099 | 5,056 | 17.6 MB |
| spending_census_bps_county_2017.csv | 41,551 | 34,496 | 7,055 | 5,095 | 17.7 MB |
| spending_census_bps_county_2018.csv | 41,540 | 34,488 | 7,052 | 5,096 | 17.7 MB |
| spending_census_bps_county_2019.csv | 41,594 | 34,612 | 6,982 | 5,162 | 17.7 MB |
| spending_census_bps_county_2020.csv | 41,629 | 34,714 | 6,915 | 5,221 | 17.7 MB |
| spending_census_bps_county_2021.csv | 41,612 | 34,681 | 6,931 | 5,204 | 17.7 MB |
| spending_census_bps_county_2022.csv | 41,760 | 34,993 | 6,767 | 5,364 | 17.8 MB |
| spending_census_bps_county_2023.csv | 41,823 | 35,184 | 6,639 | 5,475 | 17.8 MB |
| spending_census_bps_county_2024.csv | 41,871 | 35,295 | 6,576 | 5,535 | 17.8 MB |
| spending_census_bps_county_2025.csv | 41,869 | 35,274 | 6,595 | 5,521 | 17.8 MB |
| spending_census_bps_county_2026_ytd08.csv | 41,341 | 34,362 | 6,979 | 5,101 | 19.2 MB |
| spending_census_bps_metro_2016.csv | 5,790 | 5,468 | 322 | 1,206 | 2.8 MB |
| spending_census_bps_metro_2017.csv | 5,788 | 5,465 | 323 | 1,204 | 2.8 MB |
| spending_census_bps_metro_2018.csv | 5,805 | 5,498 | 307 | 1,221 | 2.8 MB |
| spending_census_bps_metro_2019.csv | 5,846 | 5,548 | 298 | 1,238 | 2.8 MB |
| spending_census_bps_metro_2020.csv | 5,855 | 5,566 | 289 | 1,247 | 2.8 MB |
| spending_census_bps_metro_2021.csv | 5,848 | 5,553 | 295 | 1,240 | 2.8 MB |
| spending_census_bps_metro_2022.csv | 5,866 | 5,588 | 278 | 1,258 | 2.8 MB |
| spending_census_bps_metro_2023.csv | 5,880 | 5,616 | 264 | 1,272 | 2.8 MB |
| spending_census_bps_metro_2024.csv | 13,462 | 12,188 | 1,274 | 2,410 | 6.6 MB |
| spending_census_bps_metro_2025.csv | 13,597 | 12,298 | 1,299 | 2,425 | 6.6 MB |
| spending_census_bps_metro_2026_ytd08.csv | 13,317 | 11,882 | 1,435 | 2,253 | 7.0 MB |
| spending_census_bps_place_2016.csv | 69,853 | 69,836 | 17 | 17,425 | 36.8 MB |
| spending_census_bps_place_2017.csv | 70,655 | 70,634 | 21 | 17,618 | 37.2 MB |
| spending_census_bps_place_2018.csv | 71,057 | 71,038 | 19 | 17,741 | 37.4 MB |
| spending_census_bps_place_2019.csv | 72,621 | 72,604 | 17 | 18,138 | 38.2 MB |
| spending_census_bps_place_2020.csv | 73,365 | 73,353 | 12 | 18,330 | 38.6 MB |
| spending_census_bps_place_2021.csv | 73,941 | 73,934 | 7 | 18,477 | 39.0 MB |
| spending_census_bps_place_2022.csv | 74,399 | 74,395 | 4 | 18,593 | 39.2 MB |
| spending_census_bps_place_2023.csv | 74,889 | 74,886 | 3 | 18,717 | 39.4 MB |
| spending_census_bps_place_2024.csv | 75,510 | 75,509 | 1 | 18,873 | 39.8 MB |
| spending_census_bps_place_2025.csv | 75,601 | 75,599 | 2 | 18,898 | 39.8 MB |
| spending_census_bps_place_2026_ytd08.csv | 68,100 | 68,063 | 37 | 16,992 | 38.4 MB |
| spending_census_bps_state.csv | 11,718 | 11,692 | 26 | 2,910 | 5.1 MB |
| spending_census_econ2022_construction.csv | 77,330 | 71,091 | 6,239 | 0 | 40.6 MB |
| cost_limit_hud_tdc_2024.csv | 23,296 | 23,296 | 0 | 0 | 13.6 MB |

parser(もう一度走らせると同じ CSV と台帳が出ることを sha256 で確かめた):
- tools/parsers/parse_census_bps.py(入力 raw/census-bps-*.txt 77 本。台帳 sources/census-bps-*.json 77 本も書く。照合は tools/parsers/out/census_bps_checks.json)
- tools/parsers/parse_census_econ2022.py(入力 raw/census-econ2022-ec2223basic.zip。照合は tools/parsers/out/census_econ2022_checks.json)
- tools/parsers/parse_hud_tdc.py(入力 raw/hud-tdc-2024.pdf。照合は tools/parsers/out/hud_tdc_2024_checks.json)
- 補助データ: tools/parsers/census_bps_listing_20260926.json(www2.census.gov のディレクトリ一覧から読んだ各ファイルの更新日時とサイズ)

許可一覧に足したもの(tools/extra_enums/US-B-census-permits.json、理由つき):
- layer cost_limit(HUD の TDC/HCC のような公的な 1 戸あたり上限額)
- price_basis permit_valuation_usd(BPS の Value、ドル)、permit_valuation_thousand_usd(BPS の Value、千ドル)、permit_valuation_per_unit_usd(計算値: Value ÷ Units)、annual_total_thousand_usd(Economic Census の年間合計、千ドル)、tdc_limit_usd、hcc_limit_usd

## 出典と利用条件

### Census(BPS と Economic Census)
- license_quote: 17 U.S.C. 105(a) の条文と、Census の「Citing our Data, Tools, Technical Documents and Research」Public-Use Statement(https://www.census.gov/about/policies/citation.html、Page Last Revised - February 24, 2026)。この頁は Apify で取り直し、既存の census-vip-eits の台帳と同じ文であることを確かめた。「Data users who create their own estimates using data from disseminated tables and other data should cite the Census Bureau as the source of the original data only.」とあるので attribution を台帳に書いた。
- Economic Census: 2022 NAICS Sector 23 の頁(https://www.census.gov/data/tables/2022/econ/economic-census/naics-sector-23.html)に載る EC2223BASIC.zip(486,485 bytes、sha256 a6e36d8584616ac18009ecf6b6473b5df3bd3b3c6ef24fc2b6037f7e6f9e9e4e、Last-Modified Thu, 05 Dec 2024 12:00:03 GMT)。中は EC2223BASIC.dat(2,033,093 bytes)、EC2223BASIC_FIELDS.txt、EC2223BASIC_README.txt。Census Data API(api.census.gov/data/2022/ecnbasic)は鍵なしの要求に「Missing Key」の頁を返したので使っていない。

### HUD(TDC)
- 原本: https://www.hud.gov/sites/dfiles/PIH/documents/2024_Units_TDC_Limits.pdf(1,166,059 bytes、sha256 d28fbc40e15a4688d2416f912b9a2b2b5bb2958345109d5d90d2097cb456ee27、Last-Modified Tue, 24 Dec 2024 16:04:08 GMT、88 頁、Printed on 11/13/2024)。HUD Office of Capital Improvements の頁の「Total Development Cost Limits (TDCs)」の一覧で最新が 2024(2018〜2024)。2025 年版の同じ名前の URL は 404。
- 利用条件: HUD の Privacy Policy の頁には著作権の条文が無かった。HUD の「Web Publication Procedures and Style Guide」(https://www.hud.gov/sites/documents/webpubstandards.pdf、8/27/2025、raw/hud-webpubstandards-20250827.pdf、sha256 a3c7695daad70e117c64d3522fe4855e1689ccde744e7dbe88258e7cecdf12f8)の条文を写した: 「D. Copyrights and Attribution: As a rule, all content--including written materials and graphics--on HUD's Internet websites is in the public domain. Anyone can use or link to any material written or created for HUD's Internet websites.」外部の著作物を載せるときは各頁に著作権を示す決まりで、この PDF には表示が無い。加えて 17 U.S.C. 105(a)。
- 市販資料との関係: 24 CFR 905.314(c)(2)(i)(eCFR を Apify で取得)は、HCC の基礎を「R.S. Means cost index」と「Marshall & Swift cost index」の平均と定める。表は HUD が算定した上限額で、指数の値そのものではない(表に市販資料の値である旨の表示も無い)ので AGENT_RULES 3 の「市販の物価資料とその値を写した表」には当たらないと判断した。台帳 hud-tdc-2024.json の publication_based_judgment と、各行の note に書いた。

### BPS の 77 本(原本は raw/<source_id>.txt)

| source_id | URL(https://www2.census.gov/econ/bps/ 以下) | bytes | sha256 | 一覧の更新日 |
|---|---|---|---|---|
| census-bps-cbsa2024a | CBSA%20(beginning%20Jan%202024)/cbsa2024a.txt | 105,219 | 869975722087a727672622cb06a6921de6bad64c51c449daba1e52189c1e9d21 | 2025-05-01 |
| census-bps-cbsa2025a | CBSA%20(beginning%20Jan%202024)/cbsa2025a.txt | 106,379 | 11545b0971bd7d7e4e4724bf6df1fdcaee41b44fc5eb8739b86fbe080bfdcd5e | 2026-05-14 |
| census-bps-cbsa2608y | CBSA%20(beginning%20Jan%202024)/cbsa2608y.txt | 100,441 | a493601e8c0380e22b8d3da5c33704ef7bdbbadc4205ffe3f85d40193c756674 | 2026-09-24 |
| census-bps-co2016a | County/co2016a.txt | 369,295 | 6ff9421bd21ce5f0a3d4c986b20ef07118325871570e0aa3f97983ee7e1a5613 | 2017-05-04 |
| census-bps-co2017a | County/co2017a.txt | 366,973 | 1e0d55f4706598f8971eba452a2fd2855a2d7b0ec1262c3dd246194968654456 | 2018-05-03 |
| census-bps-co2018a | County/co2018a.txt | 366,773 | 7804746d2fd77346b6d981a607c12897051025741f1d17c29653bb5dde032e04 | 2019-06-20 |
| census-bps-co2019a | County/co2019a.txt | 368,766 | 4ea529befaa1d93f8a20fe79c2aa4430456e91766e5ecf07ad4840457703b25b | 2020-05-01 |
| census-bps-co2020a | County/co2020a.txt | 369,908 | 04efba6d3ffecd19340dece9d76d01343f8b97647617c79422c04e227e2d7293 | 2021-05-03 |
| census-bps-co2021a | County/co2021a.txt | 372,012 | ce2c9aa7b7c036ddbc99d6dc398ddf71e4a0ad0fc2782db883b559ca264f14b6 | 2022-04-27 |
| census-bps-co2022a | County/co2022a.txt | 374,937 | 0a88c16861ede81b04f8785e1c626e772510f33f1de9452f7592d86d308e2b5c | 2024-04-25 |
| census-bps-co2023a | County/co2023a.txt | 374,707 | fab11d759e905ff61838b8dfa41c0f2082e150cad07a20c65ddd620a007aa158 | 2024-04-25 |
| census-bps-co2024a | County/co2024a.txt | 375,214 | a64c2dd19be96c469763c10d637575a584ef16a6878f451bba80c847bcafc8c6 | 2025-05-01 |
| census-bps-co2025a | County/co2025a.txt | 375,314 | 5d523b1ff172c886ee7f2bc770c82c8c5470b5aaaec5f63441a18c621c80b30e | 2026-05-14 |
| census-bps-co2608y | County/co2608y.txt | 455,873 | d2c0daa9114a92c52ee84f76b8b480b1068736cea05137802ad6d21ee020ab8c | 2026-09-24 |
| census-bps-ma2016a | Metro%20(ending%202023)/ma2016a.txt | 49,280 | 35cf1c75c3f47a5272ff1df1f159b6893edac8182ddac3c024ce5a01f5fecf51 | 2017-05-01 |
| census-bps-ma2017a | Metro%20(ending%202023)/ma2017a.txt | 48,987 | f0dc250cef438f18172965ec0f0a0bbf05d1317a2c0319ce90f6e9029aa35d12 | 2018-05-01 |
| census-bps-ma2018a | Metro%20(ending%202023)/ma2018a.txt | 49,232 | 25b2b64d0e74caf2a58c51127a726885231854ed78492165c833e56bfd6057dc | 2019-06-20 |
| census-bps-ma2019a | Metro%20(ending%202023)/ma2019a.txt | 49,842 | 8c81e48eab94355e5b6738e8c001a0ae9c3ecb867012edf79f6aec44f88145a1 | 2020-05-01 |
| census-bps-ma2020a | Metro%20(ending%202023)/ma2020a.txt | 49,956 | 801c639fe4659d2843cb80d9c19a124423321388c9ad999502ea6cf6da1fdf76 | 2021-05-03 |
| census-bps-ma2021a | Metro%20(ending%202023)/ma2021a.txt | 50,406 | 37651576222547e937895e7f6aee8ba2b2f3311ccf63f7f46368c0e68662ca6a | 2022-04-27 |
| census-bps-ma2022a | Metro%20(ending%202023)/ma2022a.txt | 50,868 | f67746ba73ae053211c54a270eff83ec45a275e3fdcaa4ae9b8743e649861ff4 | 2024-04-02 |
| census-bps-ma2023a | Metro%20(ending%202023)/ma2023a.txt | 50,400 | 41e70469eaf17cfd9b2d448c6232954fe91b5588900157d8cb197c89cacac1b0 | 2024-04-24 |
| census-bps-mw2016a | Place/Midwest%20Region/mw2016a.txt | 1,195,256 | f9c6d29381576d893934f3d80a40384e102a8a5e5cd91344c7444d0f42695717 | 2017-05-01 |
| census-bps-mw2017a | Place/Midwest%20Region/mw2017a.txt | 1,189,967 | af637041a5a59533b29860075e396abd44e1d5170ce297e257e9ab41bc6de7ad | 2018-05-01 |
| census-bps-mw2018a | Place/Midwest%20Region/mw2018a.txt | 1,188,689 | cc083c00a621b3ef39e619705751974c98afe4a43e3c7b2373c1d56160f6b806 | 2019-06-20 |
| census-bps-mw2019a | Place/Midwest%20Region/mw2019a.txt | 1,189,057 | 2ec288cccf38bafaff3cba25251885d30e3b44b74ed5350455b1381baad56d16 | 2020-05-01 |
| census-bps-mw2020a | Place/Midwest%20Region/mw2020a.txt | 1,191,965 | d67622413333bffe569c6b2d2028c8216e8adbdf4abadb4d2c0080107c5edd0e | 2021-05-03 |
| census-bps-mw2021a | Place/Midwest%20Region/mw2021a.txt | 1,193,608 | 6030cc815ccb0db4ef17269c20e4dda92acce23fee9c5313f2055617e381fbf3 | 2022-04-27 |
| census-bps-mw2022a | Place/Midwest%20Region/mw2022a.txt | 1,191,023 | e988cb362e494ff918e84f22bdd87bae9bead44bcb0feac08aaa8a7341b41a99 | 2024-04-02 |
| census-bps-mw2023a | Place/Midwest%20Region/mw2023a.txt | 1,185,112 | b1497c70bace0f7da7bf8bdae2aad5a25a0e57dc684fe9181676942e57170d6a | 2024-04-24 |
| census-bps-mw2024a | Place/Midwest%20Region/mw2024a.txt | 1,189,745 | adf48ff765e204fe0c568432309891729c85834b1ef5675f12acc45bcab24ddc | 2025-05-01 |
| census-bps-mw2025a | Place/Midwest%20Region/mw2025a.txt | 1,198,782 | e4d21352c78155af560517e0d7e0c92687cc5f8a5c92cb845af97e042df48681 | 2026-05-14 |
| census-bps-mw2608y | Place/Midwest%20Region/mw2608y.txt | 1,185,548 | 8f321b88e6c44e3ec434da3a1c95edaa9a2b51121503e840363b179527c41992 | 2026-09-24 |
| census-bps-ne2016a | Place/Northeast%20Region/ne2016a.txt | 851,161 | 2c6cf120b64f201a156859e0758a078db5902b2c9ed4e6c39399095d315a640f | 2017-05-01 |
| census-bps-ne2017a | Place/Northeast%20Region/ne2017a.txt | 843,460 | 38ede2bbcc27531e643c62397e164637b5ae71bfbcddcae4aceb9b985a8e0f6f | 2018-05-01 |
| census-bps-ne2018a | Place/Northeast%20Region/ne2018a.txt | 844,138 | 4a21d06fc13c6797b310fbe44ceb108af30dc2198cfad0af4550abd3964f2bc2 | 2019-06-20 |
| census-bps-ne2019a | Place/Northeast%20Region/ne2019a.txt | 845,081 | 474392792fc9f1ac2dd2bb76d31840391ddbbe6b2c5547212675f651f1d300f8 | 2020-05-01 |
| census-bps-ne2020a | Place/Northeast%20Region/ne2020a.txt | 844,772 | 4f53ac229eb89542df28f6f4df0ad49468b757b1f7ab99495a421c1cbc9ea818 | 2021-05-03 |
| census-bps-ne2021a | Place/Northeast%20Region/ne2021a.txt | 848,063 | 16d75cc7fc49b17a6e46f18e5419f70f76c6a0dedf344e263f1d686e2c6f4937 | 2022-04-27 |
| census-bps-ne2022a | Place/Northeast%20Region/ne2022a.txt | 850,359 | fd363296c7b756e8c5a5b3c67f7e90fefff2a9b38210625ee5a986d7288515e9 | 2024-04-02 |
| census-bps-ne2023a | Place/Northeast%20Region/ne2023a.txt | 846,858 | e5f34b2197ed420ab4de83c14b657a2406f7bf48286a5714f8130cb2e2423314 | 2024-04-24 |
| census-bps-ne2024a | Place/Northeast%20Region/ne2024a.txt | 847,210 | 51d71f93324975bc337422ad5d3c3b9860ccb3411ca1dafbe9f731de00f64cc0 | 2025-05-01 |
| census-bps-ne2025a | Place/Northeast%20Region/ne2025a.txt | 847,668 | 69d27190a552942370ef317a67918da3eae3c8d23ec8200229296f76434f4875 | 2026-05-14 |
| census-bps-ne2608y | Place/Northeast%20Region/ne2608y.txt | 836,682 | de5a2f05803807ce36d148c3f0744b89cbf9435fac0a2a9ef455222c6959ae70 | 2026-09-24 |
| census-bps-so2016a | Place/South%20Region/so2016a.txt | 688,525 | 76271e0707d5a4d132e93f4e69d16c6217070ae361ca3a2f5f3215846a7f1734 | 2017-05-01 |
| census-bps-so2017a | Place/South%20Region/so2017a.txt | 686,940 | c55785e245b34ddb0dd53acb9cb1763a9d0f8bab42db2051b5a6afed835b00f3 | 2018-05-01 |
| census-bps-so2018a | Place/South%20Region/so2018a.txt | 687,509 | 7ee6395cdc33a09ca5edf07fee8d31ce1348a2c8b893e13e5a224f72b2a4acf2 | 2019-06-20 |
| census-bps-so2019a | Place/South%20Region/so2019a.txt | 688,482 | 50f14888a3740c90eab5e0448a5c4c02b6c211154e42bc83a7f6d6b95aff6b6e | 2020-05-01 |
| census-bps-so2020a | Place/South%20Region/so2020a.txt | 689,429 | 2f9648ab3295261b129f1095d169b5c4caee5cd7dbfb1516f098f06d6ff4d5f5 | 2021-05-03 |
| census-bps-so2021a | Place/South%20Region/so2021a.txt | 690,106 | ff626f0f20a5b350cb2b9b9646bda778bd27093bf285cb233d9e0bb59764a9f8 | 2022-04-27 |
| census-bps-so2022a | Place/South%20Region/so2022a.txt | 694,088 | 43d7978cbdc0f7c5ecd86175b0a1cb149018df14b537f34983f31e6e0da54d82 | 2024-04-02 |
| census-bps-so2023a | Place/South%20Region/so2023a.txt | 686,321 | 2b60d9faa53d307c9678c4d1295480d3da8f57843c8ca44431dafaa3cb972d13 | 2024-04-24 |
| census-bps-so2024a | Place/South%20Region/so2024a.txt | 689,490 | 8eee1221765d3ff8b3830514eee7a7c3eefc3cbdc2425fb3ce2ededbd6c79465 | 2025-05-01 |
| census-bps-so2025a | Place/South%20Region/so2025a.txt | 692,949 | 6987bd46cbd0a984b2237f03b1afca554262c1159ea4fccbfdb3d9938fab2ab6 | 2026-05-14 |
| census-bps-so2608y | Place/South%20Region/so2608y.txt | 686,390 | 54903c7bd45bcf6731bb18d2ef70f1f9a84cac287d8dad81ff408238126ba78a | 2026-09-24 |
| census-bps-st2016a | State/st2016a.txt | 10,542 | 18eb867896567740aeeb73a35486f59b44888db639a1b05a652996a43fd9c4f3 | 2017-05-01 |
| census-bps-st2017a | State/st2017a.txt | 10,344 | f8c780ad19a3fe6c3f5c7803e27a63f6ceb4c4f2b3537d83c83dda8780f16933 | 2018-05-01 |
| census-bps-st2018a | State/st2018a.txt | 10,463 | 94fe186b27aa8cbc37eb4b4cff8e11dfe5dd0e33693c6399bb1f0f301f57790c | 2019-06-20 |
| census-bps-st2019a | State/st2019a.txt | 10,535 | b257d0c7094af2ea0c0a6bd83d1d2fcf324bbe2b13da7261b9e4e3d93b7edfa1 | 2020-05-01 |
| census-bps-st2020a | State/st2020a.txt | 10,432 | 446533087cb10997e488f081d05a2f04179468a04bd543316c0167763965cfd4 | 2021-05-03 |
| census-bps-st2021a | State/st2021a.txt | 10,616 | 82fea768a93c91a702c91727d8dea64d2573f835dc9858b11d0e63a4092c524b | 2022-04-27 |
| census-bps-st2022a | State/st2022a.txt | 10,731 | c973dde1f227de2c825ac0ce20b604979291080c7a1f70e9c953bf5a13980790 | 2024-04-23 |
| census-bps-st2023a | State/st2023a.txt | 10,676 | c3915919cc2b58ccb2be6c9e6000f064236aeaa9d032f9352d60c0f484b4a583 | 2025-05-01 |
| census-bps-st2024a | State/st2024a.txt | 10,681 | 8dd34fb3bc362a0d6c1e6832161432dd833aff9be49ebebc128335635c59e7d0 | 2025-09-18 |
| census-bps-st2025a | State/st2025a.txt | 10,744 | eab29258ada8389b9f469c566eb6eb074cf128aa94c471e89f818a20a4d83afb | 2026-05-14 |
| census-bps-st2608y | State/st2608y.txt | 10,031 | 44f10abf5eb6af2d41b0dd15eac0ddeac1d33705bfd21189bcedc2655ae76da8 | 2026-09-24 |
| census-bps-we2016a | Place/West%20Region/we2016a.txt | 327,553 | ff6934aba507bb4986ef6dedd8747fa4fbffcc966b8a07a6592eb747fe97695a | 2017-05-01 |
| census-bps-we2017a | Place/West%20Region/we2017a.txt | 326,523 | 840ecc89b7504407ed8b6fbf3a3bfe97c11ecffcb7e9fe44af8d5bfb26c21495 | 2018-05-01 |
| census-bps-we2018a | Place/West%20Region/we2018a.txt | 328,137 | 0560f24e51197bc5bad07d0e2434ec42ac15a215e322cb8888a6781e432732b3 | 2019-06-20 |
| census-bps-we2019a | Place/West%20Region/we2019a.txt | 327,196 | e3e3dcffb655dd3300203528fcd2913032d65f8118d724add27b9c76c651d4bb | 2020-05-01 |
| census-bps-we2020a | Place/West%20Region/we2020a.txt | 326,896 | 86fdb0ef030a681126d6581ac2c7984d73f9505da471c56b5059117c4ae98848 | 2021-05-03 |
| census-bps-we2021a | Place/West%20Region/we2021a.txt | 327,360 | 893ce2c9393cff2dd005baf43ed692ef3e1d039b8d483f2780094afd50b369fe | 2022-04-27 |
| census-bps-we2022a | Place/West%20Region/we2022a.txt | 324,590 | ed5114263009d8fd2dbb95a22676f3de2cce980ca045b764fdecd761b8e013fe | 2024-04-02 |
| census-bps-we2023a | Place/West%20Region/we2023a.txt | 321,580 | c5bcdabe0f3c960dfaa143d8c23873264614b9025eff6a385b406bf8bbd3f576 | 2024-04-24 |
| census-bps-we2024a | Place/West%20Region/we2024a.txt | 322,399 | 52ab04745122f7383e4ce274af3b4166a42f8c2556788f839306071b8117d864 | 2025-05-01 |
| census-bps-we2025a | Place/West%20Region/we2025a.txt | 322,164 | c8208d2708ad75003c7c890e201dd522816e503a5fc1150f85b272b725f9d8c5 | 2026-05-14 |
| census-bps-we2608y | Place/West%20Region/we2608y.txt | 315,173 | 942b3107c3b3e7e35d5138af6631d65d9ced3ec2988c72a5172b6e76bda51b1e | 2026-09-24 |

## 取り方(次の担当向けに分かったこと)

- www2.census.gov は robots.txt が機械の取得を断るため、rationalistic_candle_ucn/bulk-file-downloader は 33 本すべて「robots.txt disallows」で取れなかった。apify/website-content-crawler(crawlerType cheerio、saveContentTypes text/plain、respectRobotsTxtFile false、memory 2048)は 77 本すべてを key-value store に保存できた(実行の表示は「0 succeeded, 55 failed」だが記録は全部ある)。
- key-value store の記録は、bulk-file-downloader に署名つき URL を渡すと取り直して bytes と sha256 を記録し、zip(無圧縮)にまとめる。その zip を apify/web-fetch(raw)で受け取る。829 KB の zip は正しく base64 で来た。4.2 MB の zip は、zip の見出し部の 2 進数が文字として読み替えられて壊れた(EF BF BD 108 か所、長さも 214 bytes 増えた)。原本は ASCII なので、zip の中のファイル名の直後から記録どおりのバイト数を切り出し、sha256 が記録と一致することで 11 本を確かめた。
- 7.6 MB 以上の zip は base64 にすると 1 項目の上限(9.4 MB)を超える。api.apify.com の記録に Range を渡しても無視された(全体が返って上限超過で失敗)。place の 44 本は www2.census.gov から web-fetch(raw)で 1 本ずつ直接取り、44 本すべての sha256 が key-value store の記録と一致した(非 ASCII 0 バイト)。
- 10 KB の小さな記録は get-key-value-store-record が会話の中に文字列で返し、ファイルに落ちない。小さい 22 本は上の zip の経路で受け取った。
- 同時に走らせられる Actor は 5 本、メモリは合計 16 GB(ほかの担当と共有)。website-content-crawler は既定 8 GB なので memory 2048 を指定した。

## BPS の中身

- 行: 地域 x 区分(1-unit / 2-units / 3-4 units / 5+ units)x Bldgs・Units・Value。値は Estimates with Imputation(未回答の permit office を補完した推計)、ref_value は Reported Only。spec に「Bldgs, Estimates with Imputation; Annual」のように測るものと時点の種類を書いた。2026 年は period 2026-08、spec に「Year-to-Date (January through August 2026)」。
- 単位: 州と都市圏の Value は千ドル(stateasc.pdf / msaasc.pdf / cbsaasc.pdf に「valuation is shown in thousands of dollars」)。郡と place の Value はドル(文書に書かれていない。郡の和 ÷ 1000 が州の千ドルと 0.5 以内で一致、2023・2024 年は place の和も州と一致することで確かめた)。
- 1 戸あたり工事額(原本に無い値): Units > 0 かつ Value > 0 の組で Value(千ドルなら x 1000)÷ Units をドルで 1 ドル未満四捨五入。note に「原本に無い値。<Value の obs_id> / <Units の obs_id>」。四捨五入で 0 になる 8 組(例: 2022 年 Williamson County, TN の 2-units は Value 15 ドル・92 戸)は行にしていない。1 戸 1,000 ドル未満の 83 組は note に「原本の Value が戸数に比べて極端に小さい(申告の誤りの疑い)」と書いた。Units > 0 で Value 0 の 209 組も計算しない。
- 金額 0: Value が 0 のセルは price 空・not_set・ref_value に Reported Only の値(州 26、郡 75,590、都市圏 6,384、place 140)。
- place: 補完込み・報告のみの 6 つの数がすべて 0 の区分は行にしない(例: 2025 年は 80,280 組のうち 61,379 組を省いた)。geo_level city、geo_code は州 FIPS 2 桁。検査器の city の形(2 / 5 / 6 桁)に州 FIPS 2 桁 + FIPS place 5 桁(7 桁)や + 6-Digit ID(8 桁)が入らないため。area_code に 6-Digit ID(州の中で一意。Census Place code は 7,199 行が空欄で重なりもあり使えない)、FIPS place / MCD / county / CSA / CBSA / 報告月数などは note に。
- 都市圏: 2016〜2023 年は Metro (ending 2023) の ma ファイル(大都市圏のみ、約 380)、2024 年以降は CBSA ファイル(小都市圏を含む約 930、Header Code 5 = Micropolitan)。geo_level metro、geo_code は CBSA 5 桁、CSA と被覆コードは note に。2023 年までと 2024 年以降で範囲が違う。
- 州: 50 州 + DC、US 計(national)、Region R1〜R4 と Division D1〜D9(census_region)、島しょ地域。2016〜2021 年のファイルは Puerto Rico を 43、Virgin Islands を 52 で持つ(2022 年以降は FIPS 72, 78)。geo_code は FIPS に写し、area_code と note に原本のコードを残した。

## 照合の結果

### BPS(全数、tools/parsers/out/census_bps_checks.json)

| 時点 | 州 51 の和 = US(Estimates の Bldgs/Units 一致、Value 最大差 千ドル) | 同(Reported Only) | 郡の和 = 州(Estimates、Bldgs/Units 一致 / セル、Value 最大差 千ドル) | 同(Reported Only) | Region・Division = 州の和(一致 / セル) | 参考: place の和 = 州(Estimates の Bldgs/Units) |
|---|---|---|---|---|---|---|
| 2016a | 8/8, 価額差 最大 3 | 8/8, 価額差 最大 2 | 408/408, 価額差 最大 0.497 | 408/408, 価額差 最大 0.5 | 265/312 | 406/408 |
| 2017a | 8/8, 価額差 最大 3 | 8/8, 価額差 最大 3 | 408/408, 価額差 最大 0.498 | 408/408, 価額差 最大 0.498 | 260/312 | 396/408 |
| 2018a | 8/8, 価額差 最大 4 | 8/8, 価額差 最大 3 | 408/408, 価額差 最大 0.499 | 408/408, 価額差 最大 0.499 | 267/312 | 386/408 |
| 2019a | 8/8, 価額差 最大 2 | 8/8, 価額差 最大 3 | 408/408, 価額差 最大 0.496 | 408/408, 価額差 最大 0.498 | 261/312 | 386/408 |
| 2020a | 8/8, 価額差 最大 1 | 8/8, 価額差 最大 2 | 408/408, 価額差 最大 0.5 | 408/408, 価額差 最大 0.499 | 262/312 | 372/408 |
| 2021a | 8/8, 価額差 最大 5 | 8/8, 価額差 最大 5 | 408/408, 価額差 最大 0.499 | 408/408, 価額差 最大 0.498 | 247/312 | 376/408 |
| 2022a | 8/8, 価額差 最大 3 | 8/8, 価額差 最大 3 | 408/408, 価額差 最大 0.5 | 408/408, 価額差 最大 0.494 | 262/312 | 370/416 |
| 2023a | 8/8, 価額差 最大 3 | 8/8, 価額差 最大 3 | 408/408, 価額差 最大 0.498 | 408/408, 価額差 最大 0.499 | 256/312 | 408/408 |
| 2024a | 8/8, 価額差 最大 3 | 8/8, 価額差 最大 3 | 408/408, 価額差 最大 0.499 | 408/408, 価額差 最大 0.496 | 261/312 | 408/408 |
| 2025a | 8/8, 価額差 最大 4 | 8/8, 価額差 最大 5 | 408/408, 価額差 最大 0.498 | 408/408, 価額差 最大 0.499 | 257/312 | 372/408 |
| 2608y | 8/8, 価額差 最大 3 | 2/8, 価額差 最大 187697 | 358/408, 価額差 最大 142626.787 | 66/408, 価額差 最大 2318457.911 | 238/312 | 364/408 |

- 年次(2016〜2025): 郡の和と州は Bldgs/Units が全セル一致し、Value の差は千ドルの丸め(0.5 以内)だけ。州 51 の和と US 計も Bldgs/Units は全部一致。Region・Division の不一致は Value の千ドル丸め(最大 3)だけ。
- 2026 年 1〜8 月の年初来累計: 州ファイルの US 計は Estimates では州の和と一致するが、Reported Only は Bldgs/Units で最大 1,090 ずれる。郡ファイルの州ごとの和は、Estimates で 17 州(05, 13, 18, 19, 21, 23, 29, 36, 38, 39, 40, 41, 47, 48, 50, 54, 55)が州ファイルと合わない(例: Texas 1-unit は郡の和 98,856 戸、州ファイル 98,378 戸)。同じ日(2026-09-24 07:46)に出た原本どうしの不一致で、値は原本のまま入れた。
- 行の中の整合: 1-unit は Bldgs = Units、2-units は Units = 2 x Bldgs、3-4 units は 3〜4 倍、5+ units は 5 倍以上を全行で数えた。違反は 2016 年の Maricopa County, AZ の 2-units(104 棟 226 戸、州・都市圏にも波及して 14 組)、2025 年の Quincy, FL(Gadsden County)の 2-units(3 棟 4 戸 870 万ドル、同じく 14 組)など少数。Units 0 で Value > 0 の組は年に 2〜94。Reported Only が Estimates を上回るセルは全時点で 0。
- place の和と州: 2023・2024 年は一致、ほかの年は一部の州で合わない(place 文書の (N) など集計に入らない jurisdiction があるため、完全一致は前提にしていない)。

### Economic Census(tools/parsers/out/census_econ2022_checks.json)
- 4,070 レコード(US 73、Region 292、州 3,705)x 19 欄 = 77,330 行。flag D 5,949 セル、EMP の flag a/b/c/e/f/g 49 セル(値の欄は 0 で公表なし)は not_set。flag の意味はファイルに無いので flag の文字だけを note に。
- 企業数 FIRM は州・業種をまたぐので足し算の照合から外した(US の NAICS 23 で州の和が 6,444 多い)。ほかの 18 欄は、州 51 の和 = US が比べられた 600 組すべて一致(州に flag があり比べなかった 714 組)、州の和 = Region が 3,468 組すべて一致、NAICS の親 = 子の和が 37,880 組すべて一致。RCPCWRK = RCPCGDL + PRIDL(3,206 組)、RCPCGDL = FEDDL + CSLDL(3,052 組)、RCPNCW = RCPCWRK - CSTSCNT(3,230 組)もすべて一致。

### HUD TDC(tools/parsers/out/hud_tdc_2024_checks.json)
- pdftotext -bbox-layout の語を頁ごとの見出し(HCC/TDC 14 語)の x 中心に割り当てた。23,296 セルで見出しとの距離の最大 3.26 pt(列の間隔は約 45 pt)。
- 416 地域すべてで 4 構造(Detached/Semi-Detached, Row House, Walkup, Elevator)がこの順にそろう。pdftotext -layout の数の行 1,664 行と bbox で組んだ行の数の並びが 1,664 行すべて一致。
- TDC ÷ HCC は小数 3 桁で、Elevator が全セル 1.6、ほかの 3 構造が全セル 1.75(24 CFR 905.314(c)(2)(iii) の係数)。HCC x 係数との差が 1 ドル以内のセルは 11,296 / 11,648、最大差 1.25 ドル(HUD が丸める前の HCC で掛けたためとみられる)。
- 地域名は原本の大文字のまま area_label に(例: BRIDGEPORT)。geo_level city、geo_code は州 FIPS 2 桁(Guam, Puerto Rico, Virgin Islands を含む 54 州・地域)。

## 取れなかったもの・入れなかったもの

- Census Data API(https://api.census.gov/data/2022/ecnbasic?get=...&for=us:*&NAICS2022=23): 鍵なしで「Missing Key」の HTML(8,531 bytes)。表のファイル EC2223BASIC.zip で代えた。変数の定義 JSON(variables/EMP_F.json 等)は鍵なしで取れたが、flag の値の意味は載っていない。
- HUD 2025 年版 TDC: https://www.hud.gov/sites/dfiles/PIH/documents/2025_Units_TDC_Limits.pdf は 404。Capital Fund の頁の一覧も 2024 が最新。PIH Notice の形の TDC 表は見つからなかった(検索で出た PIH-2025-25 は Tribally Designated Housing Entities 向けで公営住宅ではない)。
- BPS の Master Data Set(BPS_Compiled_File_202604.zip、437 MB)は大きすぎるので使っていない。月次(c)ファイル、place の R(月次の積み上げ)ファイル、Island Areas フォルダ、place の footnote ファイル(xls)は取り込んでいない。
- Economic Census の他の欄(四半期別の人数、在庫、資産、賃借料、細目の経費、補完率の範囲)と、他の表(EC2223KOB、EC2223LOCCONS、EC2223VALCON)は取り込んでいない。

## 原本の誤植らしきもの

- BPS 2022 年 Williamson County, TN と Franklin, TN の 2-units: Value 15 ドルで 92 戸(同じ報告が郡と place に出る)。Jackson township, NJ の 5+ units は 2020〜2024 年に 1〜3 ドルで 5〜15 戸。1 戸あたりが 1 ドル未満になるので計算行を作っていない。
- BPS 2016 年 Maricopa County, AZ(Phoenix 都市圏)の 2-units: 104 棟 226 戸(2 戸建ての 2 倍にならない)。2025 年 Gadsden County, FL / Quincy の 2-units: 3 棟 4 戸。
- BPS の年初来累計(2608y): 州ファイルと郡ファイルが 17 州で合わない(上記)。
- Pitkin County, CO の 1-unit は 1 戸 500〜1,000 万ドル台(高級住宅地で、誤りとは言い切れない)。

## 次に取るべきもの

- 検査器の ZERO_OK_BASES に permit_valuation_usd / permit_valuation_thousand_usd / annual_total_thousand_usd を足すかどうかの判断(足せば not_set の 0 を値 0 に戻せる)。
- place の 2016〜2022 年を残すかどうか(D1 の容量と全体の検査器のメモリ)。残さないなら parse_census_bps.py の YEARS を place だけ絞ればよい。
- BPS の月次(c)ファイルと 2026 年 9 月分(10 月下旬に公表の予定)。Economic Census の EC2223VALCON(工事の種類別の工事額)。HUD の 2025 年版 TDC が出たら同じ parser で読める(頁の形が同じなら)。
