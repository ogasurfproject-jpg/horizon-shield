# U3-us-state-dot 報告: 米国の州 DOT の入札単価集計(bid_item)

作成 2026-09-26 / 担当 U3-us-state-dot

## 結論

1. 利用条件に再利用を明示的に許す条文があり、原本を一括で取れた州は **3 州**(ニュージャージー、サウスダコタ、モンタナ)。指示の「最低 5 州」には届いていない。約 40 州の DOT と州ポータルの条件を確かめたが、ほとんどは「条文なし」「© / All rights reserved のみ」「非営利のみ」「許可が要る」だった。
2. カリフォルニア(Caltrans)は条件が開いている(「public domain」「may be distributed or copied」)が、Contract Cost Data は品目ごとの検索画面だけで一括の原本が無く(2024-08-15 で更新停止)、主要品目の価格指数 CCI.pdf は ServiceNow の画面に置き換わって PDF が返らない。取り込んでいない。
3. 計画書で「規約の足場が一番固い」とされたフロリダ(FDOT)は **開けない**。州法 334.049(1)(a) が FDOT に著作権の取得と行使の権限を与えており、FDOT のサイトは「© 1996-2022 Florida Department of Transportation」の表示と免責だけで、再利用を許す条文が無い。
4. 作ったファイル 3 本、計 12,224 行。検査器は私の 3 ファイルと 3 台帳で誤り 0(全体の実行では他の担当の台帳 3 件に how_read 空欄の誤りが残っている。私は触っていない)。

## 作ったもの

| ファイル | 行 | status | 中身 |
|---|---|---|---|
| observations/us/bid_item_njdot_2023q2.csv | 8,608 | published_open_terms 8,608 | NJDOT 地区(C/N/S/STATEWID)x 品目 x 四半期 2,673 と品目ごとの 12 か月計 1,581、各 2 種(落札の加重平均 / 最低 3 者の平均)= 8,508、州全体の上位 100 品目 100 |
| observations/us/bid_item_sddot_2024.csv | 2,898 | published_open_terms 2,885 / not_set 13 | SDDOT 品目 1,431 x 2 種 = 2,862、品目群 18 x (2020, 2024) = 36 |
| observations/us/bid_item_mtdot_2025.csv | 718 | published_open_terms 718 | MDT 品目 718(加重平均) |

- 台帳: sources/njdot-wavg-2023-q2.json, sources/sddot-bid-item-2024.json, sources/mtdot-wavg-2025.json
- 原本: raw/njdot-wavg-2023-q2.pdf, raw/sddot-bid-item-2024.pdf, raw/mtdot-wavg-2025.pdf(3 本とも再配布を許す条文があるので raw/ に置いた)
- parser: tools/parsers/parse_njdot_wavg.py, parse_sddot_bid_item.py, parse_mtdot_wavg.py(共通部品 u3_pdfwords.py)。3 本とも 2 回走らせて同じ CSV(md5 一致)を確かめた。
- 許可一覧の追加: tools/extra_enums/U3-us-state-dot.json に price_basis 2 つ
  - bid_avg_lowest3: 最低 3 者の入札単価の平均(SD「Avg of 3 Lowest Bids」、NJ「Average of Low 3 Bidders」。加重か単純かは原本に明記なし)
  - bid_group_avg: 品目群の平均(SD の品目群表。加重か単純かは原本に明記なし)
- 列の決め方: item_name = 原本の品目説明、spec = 品目番号(pay item number)、unit = 原本の単位、ref_value = 数量(ref_note に何の数量か)、入札件数・金額は note。LS(一式)の行は note に「単価として比べない」。0.00 の値は not_set(原本の値を note に)。

## 取り込んだ出典と利用条件の判断

### 1. New Jersey DOT「Estimation Support and Historical Statistics, BAMS/DSS Output」2ndQuarter2023.pdf

- URL: https://dot.nj.gov/transportation/business/aashtoware/pdf/2ndQuarter2023.pdf(見積りの頁 https://dot.nj.gov/transportation/business/aashtoware/estimation.shtm の最新版)
- sha256 5d488a9274926ad2e6f0ad104ac109aab6f47eb1a2847639933cab2416a8d113、2,562,391 bytes(content-length と一致、%PDF)、Last-Modified Thu, 10 Aug 2023 14:43:33 GMT、894 頁
- 期間: Jul 2022 - Jun 2023(四半期 2022Q3〜2023Q2)。12 か月計の period は 2023-06、note に期間。
- 判断: **OPEN-TERMS**。根拠 https://www.nj.gov/transportation/legal/(Apify markdown、dataset 58kwtSrZu8cjYlK9H、Last updated date: June 5, 2020)の Section E:
  > The Department of Transportation has made the content of these pages available to the public and anyone may view, copy or distribute department information found here without obligation to the department, unless otherwise stated on particular material or information to which a restriction on free use may apply. However, the Department of Transportation makes no warranty that materials contained herein are free of Copyright or Trademark claims or other restrictions or limitations on free use or display. Making a copy of such material may be subject to the copyright of trademark laws.
- 原本の PDF 全文に著作権表示・利用制限の記載はない(表紙の「BAMS/DSS®」はソフトウェアの商標表示のみ)。報告書は委託先(表紙の www.infotechinc.com)が NJDOT のために作成したもの。

### 2. South Dakota DOT「2024 SDDOT Bid Item Price Report」

- URL: https://dot.sd.gov/media/qqhgg24h/2024-bid-item-price-report.pdf
- sha256 f51f31f530422e3a12d952288ef54fa56ca5e0d96a2b58f9cd6720ba6142aeac、737,897 bytes(一致、%PDF)、Last-Modified Fri, 08 Aug 2025 15:43:19 GMT、30 頁、送り状 March 31, 2025
- 判断: **OPEN-TERMS**。根拠 http://public.sd.gov/disclaim.aspx「South Dakota Online Disclaimer and Limitation of Liability」(Apify markdown、dataset ScSVw6nPdnFpRQgIi):
  > Anyone may view, copy or distribute information found on the State's website for personal or informational use without owing an obligation to the State. The State makes no warranty that the materials contained within this information are free from copyright claims or other restrictions or limitations on free use or display.
- dot.sd.gov には DOT 独自の利用条件の頁が見当たらない。WebFetch の要約では dot.sd.gov の足元に「© 2026 State of South Dakota. All Rights Reserved.」とあった(Apify の markdown では足元が落ちて原文は未確認)。州の免責頁の許可は明示なので開いたが、許可の範囲が「personal or informational use」である点は親の判断に回す。

### 3. Montana DOT「Weighted Average Prices Catalog, JANUARY 01, 2025 - DECEMBER 31, 2025」

- URL: https://mdt.mt.gov/other/webdata/external/contractplans/contract/Archives/Average_prices/2025.pdf
- sha256 d4cbd3587a30b04d6965d17c87dd3440ccd0f83f1257df8e820b1861627f2a2e、1,084,380 bytes(一致、%PDF)、Last-Modified Tue, 17 Feb 2026 19:38:59 GMT、17 頁、Date : 01/02/2026
- 単価の定義(脚注): 「* The weighted average unit price is the total bid amount divided by the total quantity」-> bid_weighted_avg
- 判断: **OPEN-TERMS(条件付き)**。根拠 https://www.mdt.mt.gov/mdt/terms-of-use.aspx の 4. Copyright Limitations(Apify markdown、dataset fVLf1h1FckaRfGJ1N):
  > MDT has made the content of certain pages of its Web sites available to the public. Anyone may view, copy, or distribute information found within these web pages (not including the design or layout of the pages) for personal or informational use without owing an obligation to MDT if the documents are not modified in any respect, and unless otherwise stated on the particular materials or information to which a restriction on free use applies. MDT makes no warranty, however, that the materials contained within these pages are free from copyright claims, or other restrictions or limitations on free use or display. MDT disclaims any liability for the improper or incorrect use of information obtained from its Web sites.
- 条件「if the documents are not modified in any respect」: 値は原本の印字のまま写し、原本の PDF は改変せず raw に置いた。観測層の形に並べ替えることがこの条件に触れるかは解釈が要るので、親の判断に回す。落とす場合は bid_item_mtdot_2025.csv と台帳を restricted に書き換えるだけで済む。

## 照合(別の数え方)

| 出典 | 照合 | 結果 |
|---|---|---|
| NJ | bbox の品目の塊 と layout の「品目番号+四半期」行 | 1,581 + 頁跨ぎ 57 = 1,638 = layout 1,638 |
| NJ | 四半期の行数 | bbox 2,673 = layout 2,673 |
| NJ | 四半期の 件数・数量・金額 の和 = 合計行 | 1,581 品目すべて一致(不一致 0) |
| NJ | AVERAGE AWARDED PRICE = TOTAL DOLLARS / TOTAL QUANTITY | 全 4,254 行が印字の丸め(金額 1 ドル単位、単価 小数 2 桁、大きい単価は整数)の範囲で一致(範囲外 0) |
| NJ | 州全体の上位 100 品目の平均 と 地区の 12 か月計からの再計算 | 96 品目は丸めの範囲で一致。LS の 4 品目は金額が一致し数量が違う(下の「原本の不一致」) |
| NJ | 上位表の行数 | bbox 100 = layout 100 |
| SD | bbox の品目 と layout の行頭品目番号 | 1,431 = 1,431(集合も一致) |
| SD | Total Cost / Total Quantity と Avg Low Bid Price | 1,431 品目のうち 0.005 ドルを超えて違うのは 8 品目。7 品目は単位 Mile で数量が小数 2 桁に丸めて印字されているため(最大は 210E3500: 1.61 Mile、156,440.00 / 1.61 = 97,167.70 に対し印字 97,228.09、差 0.062%)、1 品目(451E3610)は 0.005 の境目 |
| MT | bbox の品目 と layout の行頭 9 桁品目番号 | 718 = 718(集合も一致) |
| MT | 同じ行を pdftotext -layout の正規表現で別に読む | 718 品目すべてで 説明・単位・数量・単価 が一致 |
| 3 本 | 列の割り当て(値の並び順で決めた列 と 見出し語の右端からの最近傍の列) | NJ 21,770 セル / SD 7,245 / MT 1,436 で不一致 0。列ごと・頁ごとの中央値のずれを引いた後の右端の距離の最大: NJ 0.48pt、SD 2.02pt、MT 0.01pt(値は右寄せなので中心同士の距離は大きい: NJ 26.39pt、SD 55.53pt、MT 17.0pt) |

## 原本の誤植・不一致らしきもの

- NJ: 表紙が「Second Quarter 2022 ... June 2022」だが、中身は Jul 2022 - Jun 2023、印刷日時は July 5, 2023、ファイル名は 2ndQuarter2023。表紙の誤植と見られる。
- NJ: 上位 100 品目表(2〜4 頁)と地区表(523〜788 頁)で LS 品目の数量が違う。506003P STRUCTURAL STEEL は上位表 3 に対し地区合計 7(N 6 + S 1)、201006P は 4 と 5、201039P は 4 と 13、704033P は 4 と 5。金額は一致しているので、LS の数量の数え方が表によって違う。上位表の LS の平均は地区表と比べられない。
- NJ: 上位表の期間は「July 28, 2022 AND June 6, 2023」、地区表は「Jul 2022 - Jun 2023」。上位表の説明は 40 桁で切れている(例: STONE MATRIX ASPHALT 12.5 MM SURFACE COU)。
- NJ: Summary Report の見出しが「Historical Statistics For January 1, 1960 to December 31, 2025」(印刷は 2023-07-05)。
- NJ: 地区 STATEWID は Area Totals では「STAT 3 contracts」。州全体の集計ではなく地区区分の一つ(note に記載)。
- SD: 品目群表の「Classs A45 Concrete (Bridge)」(Class の誤植)、群の説明の「pavment」「Penatrating」。原本のまま写した。
- SD: 2020 年の Structural Steel の数量「7463140.000」だけ桁区切りが無い。
- SD: 数量 0.00・Bid Cnt 0 なのに Avg of 3 Lowest Bids に値がある品目が 10(450E0196, 560E0160 など)。落札が無い品目の入札平均と見られる。原本のまま(Avg Low Bid Price 側は 0.00 なので not_set)。

## 取り込まなかった州と理由

「Apify」は条文を Apify で取って確かめたもの、「WebFetch」は WebFetch の要約で所在と中身を見たもの(値の根拠には使っていない。開く判断はしていないので、閉じる判断の根拠として記す)。

| 州 | 判断 | 根拠(条文) | 確認 |
|---|---|---|---|
| CA Caltrans | 条件は開く / 原本が取れない | https://dot.ca.gov/conditions-of-use OWNERSHIP:「In general, information presented on this website, unless otherwise indicated, is considered in the public domain. It may be distributed or copied as permitted by law.」。ただし Contract Cost Data(sv08data.dot.ca.gov/contractcost/)は品目ごとの検索画面のみで一括の原本なし(2024-08-15 の取り込みで更新停止)。https://ppmoe.dot.ca.gov/des/oe/docs/CCI.pdf は text/html 165,762 bytes の ServiceNow の画面(「OE Index - PPMOE MIgration」)が返り PDF でない | Apify |
| FL FDOT | restricted | 州法 334.049(1)(a)「the Department of Transportation is authorized, in its own name, to: (a) Perform all things necessary to secure letters of patent, copyrights, and trademarks on any legitimately acquired work products, and to enforce its rights therein.」(https://www.flsenate.gov/Laws/Statutes/2025/334.049)。FDOT の Web Policies and Notices と Disclaimer(https://www.fdot.gov/agencyresources/notices/disclaimer.shtm)に再利用を許す条文なし、足元は「© 1996-2022 Florida Department of Transportation」(原文の区切りは U+2010) | Apify |
| MN MnDOT | restricted | https://www.dot.state.mn.us/information/disclaimer.html は免責・リンク方針のみで、再利用を許す条文なし | Apify |
| IA Iowa DOT | restricted | https://iowadot.gov/policies-statements/terms-use「© Copyright 2026 Iowa Department of Transportation. All rights reserved. You may not copy, display, distribute, ...」「solely for your personal, educational, and noncommercial use」。CC0 / CC BY は GIS データ等の区分だけ | Apify |
| NY NYSDOT | 取れない | Weighted Average Item Price Report(https://www.dot.ny.gov/divisions/engineering/design/dqab/waipr)が「NYS DOT Single Sign-On Login Screen」になっている。条件頁 https://dot.ny.gov/main/legal-disclaimer は 404 | Apify |
| NH | restricted | https://www.nh.gov/policies は Privacy / Accessibility / 翻訳の頁だけで著作権・再利用の条文なし | Apify |
| TX TxDOT | restricted(指示どおり) | 書面の許可が要る(調査メモと指示) | 未取得 |
| NC NCDOT | restricted | https://www.nc.gov/disclaimer-terms-use「grants permission to copy and distribute ... for non-commercial use, provided they are copied and distributed without alteration」 | WebFetch |
| WI WisDOT | restricted | Acceptable use policy「for the noncommercial use of the general public」「If permission to reproduce or redistribute is granted ...」 | WebFetch |
| OH ODOT | restricted | Privacy Notice and Policies「Reuse of any and all material for commercial purposes is generally prohibited.」 | WebFetch |
| MI MDOT | restricted | michigan.gov Policies「You may not modify, copy, distribute ... unless the law otherwise provides or the State gives you prior written permission.」 | WebFetch |
| IN INDOT | restricted | IN.gov Terms of Use「only a limited, nonexclusive license for use solely by you for your own personal use, and not for republication, distribution ...」 | WebFetch |
| MA MassDOT | restricted | Mass.gov Terms of Use「the Commonwealth forbids any copying or use other than "fair use"」 | WebFetch |
| AK DOT&PF | restricted | https://dot.alaska.gov/copyright.shtml 無断の複製・再公表を禁止、書面の許可が要る | WebFetch |
| AZ ADOT | restricted | Disclaimer「Copyright © Arizona Department of Transportation - All rights reserved.」「Permission to reproduce may be required.」 | WebFetch |
| SC SCDOT | restricted | SC.gov Terms「No reproduction, distribution, or transmission ... without our prior written permission.」 | WebFetch |
| MD SHA | restricted | Copyright and Disclaimers「Any unauthorized reproduction of these materials is strictly prohibited.」 | WebFetch |
| OK ODOT | restricted | Contracts Data Disclaimer「© Copyright Oklahoma Department of Transportation All Rights Reserved」 | WebFetch |
| MO MoDOT | restricted | 足元「© 2026 Missouri Department of Transportation, All Rights Reserved」、利用条件の頁は Privacy のみ | WebFetch |
| NE NDOT | restricted | Policies and Disclaimers は「used at the user's risk」の免責のみ。nebraska.gov は「personal and non-commercial use」 | WebFetch |
| WA WSDOT | restricted | Unit Bid Analysis は品目ごとの検索アプリ(一括の原本なし)。Policies の足元「Copyright WSDOT ©」、再利用を許す条文なし(Open data policy はデータ基盤の計画のみ) | WebFetch |
| OR ODOT | restricted | Oregon.gov Terms & Conditions は著作権侵害の申し立て先のみ。ORS 173.763 は公開しても州の著作権を放棄しないと定める(Harvard の State Copyright Resource Center の要約) | WebFetch |
| LA DOTD | restricted | Website Policies は Privacy / Accessibility のみ | WebFetch |
| AR ARDOT | restricted | 足元「Copyright © 2026 ARDOT」、Arkansas.gov Acceptable Use に再利用の条文なし | WebFetch |
| TN TDOT | restricted | tn.gov Web Policies は Privacy / Accessibility / Linking / Security / DMCA / COPPA のみ | WebFetch |
| CO CDOT | restricted | 足元「© 2024 State of Colorado」、data.colorado.gov の規約にもライセンスの条文なし | WebFetch |
| WV WVDOT | restricted | Content Disclaimer は「© 2026 State of West Virginia」のみ | WebFetch |
| VT VTrans | restricted | vermont.gov Policies は写真の非営利利用と著作権侵害の手続きのみ | WebFetch |
| WY WYDOT | restricted | Disclaimer はリンク先の免責のみ。単価は Google Drive のフォルダ | WebFetch |
| NM NMDOT | restricted | 「Copyright @ NMDOT 2021」のみ | WebFetch |
| CT, KY, ID, ND, IL, MS, GA | restricted | 州ポータル・DOT の頁に再利用を許す条文が見つからない(CT はロゴ・紋章の制限のみ、KY は著作権侵害の方針のみ、ND は © のみ、MS は公文書の閲覧・複写の規定のみ) | WebFetch |
| PA PennDOT | restricted | 71 Pa. Stat. 636 で州の刊行物に著作権を取る権限(Harvard の要約、Red) | WebFetch |
| DE DelDOT | restricted | 「Permission to Publish」の申請書式がある(許可制) | 検索結果のみ |
| UT UDOT | 条件は開く / 原本なし | utah.gov Disclaimer に MT と同じ条文(copy, or distribute ... for personal or informational use ... if the documents are not modified)。UDOT が品目単価の集計を公開している頁は見つからなかった | WebFetch |

## Apify で取得したもの(記録)

- 原本: NJ dataset k8W40tlw73ObOVotZ、SD zelQTuJJPWsMxTO9j、MT dih18cvfzaBujjeWi(いずれも formats=raw)
- 条件頁: Caltrans S2y2cWn2wNnxQPxIr、MnDOT wR1HI3nQ84m6jzlq7、FDOT Web Policies Vr2Jj041lAP3152HN / Disclaimer raw Oh7GF4c1l6orl3sB6、Iowa DOT wrApRTAneDUKBg6wG、FL 334.049 RF9g1qlkaC87CTH7D、NJDOT legal 58kwtSrZu8cjYlK9H、SD disclaimer ScSVw6nPdnFpRQgIi、MDT terms fVLf1h1FckaRfGJ1N、NH policies 8QuqPwhdB11zuF4Gr、NYSDOT(404)gbh8t9OA04DLd7u8W、NYSDOT WAIPR(ログイン画面)ogWAbZzXuqgM3VU0A、Caltrans CCI.pdf(HTML)rYuvaRVt0CMImMBwT
- Apify の同時実行の上限(他の担当と共有で 5)に一度当たった。

## 次に取るべきもの

1. 親の判断: SD / MT の「personal or informational use」と MT の「if the documents are not modified in any respect」を OPEN-TERMS のまま置くか。落とすなら 2 ファイルの status を published_restricted_not_copied にして値を消す。
2. フロリダ・テキサス: 書面の許可を取れば最も大きい 2 州が入る(FDOT は州全体+市場地域、TxDOT は Socrata API)。許可の前に状態だけの行(published_restricted_not_copied)を入れるなら FDOT の Excel を raw_restricted に取る。
3. 時系列: MDT の Archives/Average_prices/<年>.pdf(過去年)、SD の 2020〜2023 年版、NJ の 1stQuarter2023 / 2022 各四半期版。いずれも同じ parser で読める形。
4. Caltrans: Contract Cost Data の一括の書き出しがあるか問い合わせる(条件は開いている)。
5. NJ の新しい版(2023 年第2四半期より後)が出ていないか定期的に見る(2026-09-26 時点で見積りの頁の最新は 2ndQuarter2023)。
