# JCCDB 観測層 v2(2026-09-26)

JCCDB v4(95,403 品目)は「品目が公的資料に実在する」を1行1品目で持つ。地域・時点・価格は持たない。
観測層は「どの地域・どの時点で・どの出典に・いくらで(または値が公開されていない理由)」を1行1観測で持つ。v2 で日本と米国を同じ列にした。

- 全 3,206,783 行(公開の組み立てに入るもの 3,185,391 行、件数だけの出典 20,402 行、原本のとおりの記録 990 行)
- 値あり 3,046,920 行
- 出典 2458(台帳 sources/)。検査器 tools/validate_obs.py は全行で誤り 0。
- 列と状態の意味: SCHEMA.md。取り込みの掟: AGENT_RULES.md。

## 中身

| 置き場所 | 国 | 系統 | ファイル | 行 | 値あり |
|---|---|---|---:|---:|---:|
| observations | jp | cost_sqft_mlit_chakko | 2 | 36,819 | 36,819 |
| observations | jp | index_mlit_deflator | 1 | 11,475 | 11,475 |
| observations | jp | index_mlit_deflator_nendo | 1 | 5,460 | 3,919 |
| observations | jp | index_mlit_deflator_realigned | 1 | 990 | 960 |
| observations | jp | index_mlit_shinei_yosan | 1 | 200 | 200 |
| observations | jp | labor_mlit_gijutsusha | 18 | 353 | 353 |
| observations | jp | labor_mlit_roumu | 14 | 32,571 | 30,038 |
| observations | jp | material_cbr_tokuchou_shizai | 1 | 744 | 688 |
| observations | jp | material_cgr_zairyo | 1 | 20,055 | 11,982 |
| observations | jp | material_hkd_zairyo | 1 | 45,320 | 44,492 |
| observations | jp | material_hrr_zairyo | 1 | 4,947 | 4,947 |
| observations | jp | material_kkr_namacon | 6 | 5,080 | 5,080 |
| observations | jp | material_kkr_zairyo | 2 | 48,394 | 34,567 |
| observations | jp | material_ktr_zairyo_as | 5 | 680 | 365 |
| observations | jp | material_ktr_zairyo | 1 | 4,077 | 3,420 |
| observations | jp | material_nara_namacon_status | 1 | 1,584 | 0 |
| observations | jp | material_ogb_zairyo | 1 | 515 | 512 |
| observations | jp | material_qsr_zairyo | 1 | 22,514 | 22,513 |
| observations | jp | spending_mlit_reform | 1 | 804 | 800 |
| observations | jp | work_mlit_sekou_package | 1 | 9,277 | 9,177 |
| observations | jp | work_mlit_sekou_package_ratio | 2 | 79,655 | 79,655 |
| observations | jp | work_mlit_shinei_yosan | 1 | 432 | 217 |
| observations | us | bid_item_fhwa_pricetrends | 1 | 3,834 | 3,317 |
| observations | us | bid_item_mtdot | 1 | 718 | 0 |
| observations | us | bid_item_njdot | 1 | 8,608 | 8,608 |
| observations | us | bid_item_sddot | 1 | 2,898 | 0 |
| observations | us | cost_limit_hud_tdc | 1 | 23,296 | 23,296 |
| observations | us | cost_sqft_census_newhousing | 1 | 730 | 730 |
| observations | us | cost_sqft_city_permits_austin | 1 | 56 | 56 |
| observations | us | cost_sqft_city_permits_boston | 1 | 32 | 32 |
| observations | us | cost_sqft_city_permits_neworleans | 1 | 46 | 46 |
| observations | us | cost_sqft_city_permits_nyc | 1 | 73 | 73 |
| observations | us | cost_sqft_city_permits_sandiego | 1 | 11 | 11 |
| observations | us | cost_sqft_dod_ufc370101 | 1 | 1,118 | 370 |
| observations | us | equipment_fema | 1 | 465 | 465 |
| observations | us | equipment_usace_ep1110 | 2 | 95,520 | 95,520 |
| observations | us | house_price_census_newhousing | 1 | 1,056 | 1,008 |
| observations | us | index_bls_cpi_repair | 1 | 374 | 325 |
| observations | us | index_bls_eci | 1 | 714 | 714 |
| observations | us | index_bls_ppi | 1 | 32,892 | 32,855 |
| observations | us | index_bls_ppi_fd | 1 | 384 | 384 |
| observations | us | index_bls_ppi_resid | 1 | 3,237 | 3,098 |
| observations | us | index_census_cqpi | 1 | 1,383 | 1,383 |
| observations | us | index_dod_acf | 1 | 32,978 | 32,978 |
| observations | us | index_fhwa_nhcci | 1 | 93 | 93 |
| observations | us | index_usace_cwccis | 1 | 8,503 | 8,503 |
| observations | us | labor_dol_davis_bacon | 30 | 133,962 | 133,958 |
| observations | us | spending_census_bps_county | 11 | 458,114 | 458,114 |
| observations | us | spending_census_bps_metro | 11 | 87,054 | 87,054 |
| observations | us | spending_census_bps_place | 11 | 799,991 | 799,991 |
| observations | us | spending_census_bps_state | 1 | 11,718 | 11,718 |
| observations | us | spending_census_econ2022_construction | 1 | 77,330 | 71,332 |
| observations | us | spending_census_vip | 1 | 28,320 | 28,320 |
| observations | us | spending_city_permits_austin | 1 | 653 | 595 |
| observations | us | spending_city_permits_boston | 1 | 1,583 | 1,579 |
| observations | us | spending_city_permits_neworleans | 1 | 2,196 | 1,992 |
| observations | us | spending_city_permits_nyc | 1 | 369 | 369 |
| observations | us | spending_city_permits_sandiego | 1 | 820 | 657 |
| observations | us | spending_city_permits_seattle | 1 | 599 | 598 |
| observations | us | spending_city_permits | 1 | 1,343 | 1,326 |
| observations | us | wage_bls_oews | 5 | 187,993 | 186,599 |
| observations | us | wage_bls_oews_metro | 2 | 131,521 | 130,951 |
| observations | us | wage_bls_qcew | 10 | 706,488 | 611,937 |
| observations | us | work_dod_ufc370101 | 1 | 864 | 0 |
| observations | us | work_fta_capcost | 1 | 3,508 | 2,796 |
| observations_hold | jp | index_mlit_deflator_nendo_suspect_shift | 1 | 165 | 165 |
| observations_hold | jp | index_mlit_deflator_suspect_shift | 1 | 825 | 825 |
| observations_restricted | jp | material_cbr_zairyo | 1 | 7,896 | 0 |
| observations_restricted | jp | material_skr_zairyo | 1 | 6,412 | 0 |
| observations_restricted | jp | material_thr_zairyo | 1 | 6,094 | 0 |

## 2026-09-26 後半に足した判断

- 奈良県の表: 状態(刊行物単価 / 県が値を掲載 / 空欄)1,584 行を公開の組み立てに戻した。県の条文は著作権の注記で、規格名と状態は事実。県の金額は写していない。
- 中部・東北・四国の地方整備局の設計材料単価表: 表の「磁気媒体入力を禁止」は著作権を超えた禁止なので、件数だけのまま。中部の特別調査(資材)の報告リストには権利表記が無いので値ごと入れた(744 行)。3局と奈良県への利用許諾の申請書の案は、送る前の下書きなので公開のリポには置かない(運営者の手元にある)。
- 建設工事費デフレーター: 四半期別 800 セルと年度別 160 セルは、見出しの1列右に値が置かれていた。月別の平均と全セル 0.1 以内で一致したので、正しい系列に付け直した(index_mlit_deflator_realigned.csv)。値がどの列にも無い 30 セルは not_set。原本のとおりの記録は observations_hold/。
- 統計の 0(着工統計・建築許可・Economic Census・Davis-Bacon の付加給付・機械の燃料費)は値 0。単価の 0 は not_set。
- Davis-Bacon: 値は公有。SAM.gov の利用規約が自動取得を禁じていると分かった時点で取得を止めた。取れた 30 州(AK〜MT)を入れた。残りは自動取得しない。
- 市販資料の線引き: 市販の物価資料の値をそのまま写したか、市販資料だけから換算したと原本が明記する値は入れない(UFS の RSMeans 由来 628 行、DoD Table 6)。政府が複数の資料から自ら算定・合成した値(CWCCIS)と、制度上の上限額として定めた値(HUD TDC)は政府の著作物として入れる。
- GitHub の上限に合わせ、45MB を超えるファイルは行で分ける(apply_decisions の split_large)。raw/ はリポに入れない。
- 独立検証(V4・V5): 国内の新しい分は全行、米国の新しい分は 2,632,645 行が原本と一致(不一致 0)。計算した行 284,850 行も作り直した値と一致。

## 利用条件の判断(値を入れていないもの)

- 中部 cbr / 東北 thr / 四国 skr の地方整備局と奈良県の表: 表そのものが「複製・転載・磁気媒体入力(電子媒体への加工)」を禁じている(サイトは PDL1.0 でも、表の権利表記が優先)。値も行の一覧も公開の組み立てに入れず、件数と理由と原本の URL だけ(observations_restricted/)。
- 米国 South Dakota / Montana の DOT: 条件が「personal or informational use」まで(Montana はさらに「改変しない限り」)。値は写さず、品目の並びだけ。
- Texas DOT は書面の許可が要る。Florida DOT は州法で著作権を持ち、再利用を許す条文が無い。どちらも取り込んでいない(reports/U3-us-state-dot.md)。
- 市販の物価資料(建設物価・積算資料など)の値は、どこからも入れていない。表で「刊行物」「物価資料」と示された行は publication_based_not_public(値なし)。

## 品質の判断

- 建設工事費デフレーターの四半期別(2020年4-6月期以降)と年度別(2021年度以降)の 33 列 990 行は、月別に対して1列右にずれている疑いが強い(四半期の4期平均は年度別と一致し、月別と合わない。合成指数が個別指数の範囲に収まらない)。observations_hold/ に保留。国交省(建設経済統計調査室)への照会を勧める。月別は使える。
- 統計の件数・金額の 0 は値(price 0)。単価表の 0 は not_set。

## 独立検証(作った担当とは別の3者、全行を機械で)

- 日本の値のある 273,760 行(当時)はすべて原本の該当頁・セルと一致。地区や職種の列の取り違え 0(取り違えを注入して検出力も確認: PDF 3,695/3,701、Excel 738/739)。reports/verify/V1-REPORT.md
- 米国の値のある 111,106 行はすべて原本のセルと一致(BLS の flat file、OEWS、Census、FEMA、NJDOT)。reports/verify/V2-REPORT.md
- 原本の sha256: 日本 66/66、米国 25/25 が台帳と一致(置き忘れていた3つの原本を raw/ に置いた後)。
- 利用条件の条文: 開いた条件の 85 出典で、条文の写し方(かぎ括弧の置き換え、見出しと本文の連結)が頁と文字どおりでなかった 50 台帳を、頁の文字どおりに直した(中身は変わらない)。
- 検証で見つかって直したもの: 統計の 0 を not_set にしていた 4,927 行、NJDOT の品名の「-」の欠落 4 行、SD の note に残っていた入札件数 2,862 行、原本の置き忘れ 3。

## 作り直し方

    # 1. parser(tools/parsers/)で CSV を作る(原本は raw/ と raw_restricted/)
    # 2. 判断を当てる(何度走らせても同じ)
    python3 tools/apply_decisions_20260926.py
    # 3. 検査
    python3 tools/validate_obs.py . --json reports/validate_all.json
    # 4. D1 の SQL(hs-jccdb-obs v0.2)
    python3 <hs-jccdb-obs>/tools/make_d1_sql_v2.py . --out <hs-jccdb-obs>/sql_v2

## 出典の表示

値を使うときは、行の出典(source_id)の台帳にある attribution を表示する(PDL1.0 / 政府標準利用規約 / CC BY / OPEN-TERMS)。例: 「出典：国土交通省ウェブサイト(URL)を加工して作成」。米連邦の公有の値は表示義務は無いが、出典を添える。

公共工事の設計単価・入札単価・統計は、リフォームの見積単価ではない。見積の妥当性の判断に使うときは、何の値かを添えること。
