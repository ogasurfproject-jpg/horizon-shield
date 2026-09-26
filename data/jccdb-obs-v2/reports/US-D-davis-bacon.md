# US-D-davis-bacon 報告(2026-09-26)

## 結論

- Davis-Bacon 法の一般賃金決定(General Decisions)を、SAM.gov の頁をブラウザで開き頁の中から SAM.gov の公開の API を呼ぶ方法で取れた。現行の決定 4,235 件のうち 2,250 件を取り、州の決定がそろった 30 州・地域(AK から MT まで。AS、CM、GU、DC を含む)の 2,213 件を観測にした。133,962 行(基本賃金 66,981 行 + 付加給付 66,981 行)。検査器は誤り 0、警告 0。
- ただし SAM.gov の利用規約が「Automated data gathering, web scraping tools are prohibited」と書いていることを取得の途中で読み、残りの取得(NC 以降の 1,985 件、TX・NY・PA・OH・NJ・VA・WA を含む)を止めた。値そのものは労働省の著作物で公有(17 U.S.C. 105)だが、取り方が規約に触れる。**公開の組み立てに入れるかは番人の判断が要るので、行は observations_hold/us/ に置いた**(公開の組み立てに入らない)。判断が出れば parser を `--dir observations` で走らせ直すだけで observations/us/ に移る。
- 照合は全数: 2 通りの読み(組の読みと桁の読み)で賃金の行 66,981 / 66,981 が件数・値とも一致。SAM.gov の現行の決定の一覧と、改訂番号・州・工事の種類が 2,213 / 2,213 件一致、一覧の郡名 7,258 個が全部本文の郡の欄にある。公表日は本文の表・本文の見出し・JSON の publishDate の 3 か所で 2,213 / 2,213 件一致。

## 取り方を試した結果

| 経路 | 結果 |
|---|---|
| Apify web-fetch で文書のダウンロード口 https://sam.gov/api/prod/wdol/v1/wd/CA20260001/0/download | 502、本文「Could not verify the TLS certificate of sam.gov (for example expired, self-signed or incomplete certificate chain).」(x-apify-proxy-error: true)。前回の担当と同じ |
| この作業環境から直接(curl) | sam.gov / api.sam.gov とも CONNECT 403(組織の方針で届かない) |
| Apify website-content-crawler(crawlerType playwright:chrome、実際は Firefox で動く)で https://sam.gov/wage-determination/CA20260001/0 | 200。頁が描かれ、決定の本文が読めた(ブラウザは TLS を検証して通る) |
| 同じ頁の中から fetch() で SAM.gov の API を呼ぶ(pageFunction) | **取れた**。`https://sam.gov/api/prod/wdol/v1/wd/<WD>/<改訂>?api_key=null`(JSON。document に本文そのもの)、`.../wd/<WD>/history?api_key=null`(改訂の履歴)、`.../wdol/v1/dictionaries?api_key=null&ids=wdStates,wdCounties`(州・郡のコード表)、`https://sam.gov/api/prod/sgs/v1/search/?index=dbra&mode=search&responseType=json&is_active=true&size=250&page=<k>&sort=title`(現行の決定の一覧、totalElements 4,235、maxAllowedRecords 10,000、size は 500 まで確認、sort=title で順序が決まる)。鍵は要らない(api_key=null は SAM.gov の頁自身が付ける値)。`.../download` は頁の中の fetch でも NetworkError |
| SAM.gov の公式 API(open.gsa.gov/api/) | 一覧 15 本(Entity Management、Opportunities、Exclusions、Federal Hierarchy など)に賃金決定の API は無い。鍵の登録を案内する対象が無いので鍵の手順は不要 |
| SAM.gov Data Services の一括ファイル(sam.gov/data-services) | フォルダは Assistance Listings / Contract Opportunities / Data Dictionary / Documentation / Entity Registration / Exclusions だけ。賃金決定の一括ファイルは無い |
| DOL の案内(dol.gov の Davis-Bacon Wage Determinations の頁) | 「On June 14, 2019, the System for Award Management (SAM) website ... became the official site for all Davis-Bacon GWDs.」一括ファイル・API の案内は無い |
| wdol.gov のアーカイブ | 試していない。2019 年に廃止され、現行の決定ではない |
| 第三者の Apify actor(parseforge/sam-gov-wage-determinations-scraper) | 存在を確認しただけで使っていない(SAM.gov を同じように自動で読む物で、規約の問題は同じ。従量課金、無料は 10 件まで) |

取得の仕組み(次の担当向け): website-content-crawler の pageFunction の context には `page` しか無い(`request` は undefined)。頁の URL の問い合わせ文字列(`?claude_batch=k`)は `page.url()` で読める。頁の中で応答のバイト列(arrayBuffer)を sha256 し、全部をつないで gzip + base64 にして `<pre id="claude-out">` に書き、`keepElementsCssSelector: "#claude-out"`、`htmlTransformer: "none"` で text 欄に出させる。250 件で約 400KB(元は約 3.6MB)。手元で `tools/parsers/dbra_unpack.py` が復元し、頁の中の sha256 と 2,260 応答すべて一致。pageFunction は `tools/parsers/dbra_fetch_pagefunction.js`。Apify は同時実行 5 本・メモリ 16GB の上限があり、他の担当と共有なので callOptions の memory を 2048 に下げると通る。

## 利用条件の判断

- 値の著作権: 賃金決定は労働省 賃金時間局が 29 CFR Part 1 に基づいて定める文書。17 U.S.C. 105(a)(Cornell LII を Apify で取得)「Copyright protection under this title is not available for any work of the United States Government ...」、労働省の頁(https://www.dol.gov/general/aboutdol/copyright、Apify で取得)「Materials created by the federal government are generally part of the public domain and may be used, reproduced and distributed without permission. ...」、SAM.gov の Reuse and Copyright「Most material on our site is free of copyright and may be copied and distributed without permission. ...」。取得した 2,213 件の本文に copyright / © は 0 件。→ license US-PD-17USC105、status public_domain。条文は各台帳の license_quote に写した。
- 取り方の条件(SAM.gov Terms of Use、https://sam.gov/about/terms-of-use、Apify website-content-crawler で表示して取得): Data Access の平文は「Do not use bots to download or copy restricted or sensitive data from SAM.gov.」「Do not use your SAM.gov login for data mining, bots, or other data gathering and extraction tools.」(賃金決定は restricted でも sensitive でもなく、ログインも使っていない)。しかし Full Legal Language は「SAM.gov makes certain data available via APIs and extracts with URLs “https://open.gsa.gov/api/” and “https://sam.gov/data-services.” Automated data gathering, web scraping tools are prohibited and, if detected, will result in the associated account(s) being denied access to SAM.gov via Login.gov.」と、対象を限らずに自動収集を禁じている。規約は「When you agree to the terms, you agree to both the explanations and the legal language.」とも書く。
- 経緯: 一覧の頁 0 と 250 件を取った後、残り 16 頁を 1 本の run(U7V0tsebQ3eE245lm)で流している最中に規約を読んだ(03:24 UTC 台)。03:25:02 UTC に run を中止した。中止までに頁 1〜8 が取れていた(頁 7・8 の取得時刻は 03:24:44 と 03:24:46 で、規約を読んだ時刻とほぼ同時)。以後 SAM.gov への自動の取得はしていない(規約の頁と Data Services の頁を 1 回ずつ表示しただけ)。
- 各台帳に access_terms_quote(条文)と access_terms_note(経緯)を入れた。

## 作ったもの

- 観測(公開の組み立ての外): `observations_hold/us/labor_dol_davis_bacon_<州>_2026.csv` 30 ファイル、133,962 行(public_domain 113,205 / not_set 20,757)、計 80MB。
- 台帳: `sources/dol-dbra-<wd>-<改訂>.json` 2,213 件(source_id は親の指定どおり)。
- 原本: `raw/dol-dbra-<wd>-<改訂>.json` 2,213 件(API の応答のバイト列そのまま、計 36,096,416 bytes)、`raw/dol-dbra-index-2026-09-26-p0.json`〜`p8.json`(一覧)、`raw/dol-dbra-dictionaries-2026-09-26.json`、取得の記録 `raw/dol-dbra-fetch-manifest-2026-09-26.json`(sha256 1bd777910d248e38ecc38acb9b9fa6f8fc0f0fbe2ce57be31e467a833c7cd27e。各応答の url・bytes・sha256・取得時刻)。NC の 37 件は州がそろわないので raw にも入れていない(作業用の場所にだけある)。
- parser: `tools/parsers/parse_dol_dbra.py`(もう一度走らせて CSV 30 本と台帳 2,213 本の sha256 が同じになることを確かめた)。取得の道具: `tools/parsers/dbra_unpack.py`、`tools/parsers/dbra_stage_to_raw.py`、`tools/parsers/dbra_fetch_pagefunction.js`。照合の数: `tools/parsers/out/dol_dbra_summary.json`、決定ごと: `tools/parsers/out/dol_dbra_per_doc.json`。
- 許可一覧に足したもの: `tools/extra_enums/US-D-davis-bacon.json` の price_basis `prevailing_wage_daily`(下の潜水士の 36 行)。
- `tools/apply_decisions_20260926.py` を走らせ、他の担当のファイルが変わらないことを sha256 で確かめた。

| 州 | 一覧の現行決定 | 取り込んだ決定 | 組 | 賃金の行 | 観測行 | public_domain | not_set |
|---|---:|---:|---:|---:|---:|---:|---:|
| AK | 5 | 5 | 38 | 203 | 406 | 375 | 31 |
| AL | 167 | 167 | 391 | 3785 | 7570 | 4536 | 3034 |
| AR | 172 | 172 | 355 | 3731 | 7462 | 4232 | 3230 |
| AS | 1 | 1 | 1 | 12 | 24 | 12 | 12 |
| AZ | 49 | 49 | 705 | 1401 | 2802 | 2540 | 262 |
| CA | 28 | 28 | 865 | 3385 | 6770 | 6723 | 47 |
| CM | 1 | 1 | 1 | 17 | 34 | 17 | 17 |
| CO | 30 | 30 | 329 | 1442 | 2884 | 2735 | 149 |
| CT | 24 | 24 | 370 | 1005 | 2010 | 2000 | 10 |
| DC | 3 | 3 | 67 | 125 | 250 | 240 | 10 |
| DE | 11 | 11 | 80 | 205 | 410 | 384 | 26 |
| FL | 229 | 229 | 958 | 6228 | 12456 | 8976 | 3480 |
| GA | 188 | 188 | 683 | 4360 | 8720 | 6005 | 2715 |
| GU | 5 | 5 | 5 | 46 | 92 | 52 | 40 |
| HI | 1 | 1 | 26 | 132 | 264 | 264 | 0 |
| IA | 80 | 80 | 914 | 1971 | 3942 | 3860 | 82 |
| ID | 94 | 94 | 584 | 2209 | 4418 | 4200 | 218 |
| IL | 70 | 70 | 1395 | 2534 | 5068 | 4981 | 87 |
| IN | 41 | 41 | 743 | 1408 | 2816 | 2707 | 109 |
| KS | 150 | 150 | 921 | 4713 | 9426 | 7042 | 2384 |
| KY | 106 | 106 | 1432 | 2857 | 5714 | 5579 | 135 |
| LA | 53 | 53 | 479 | 1088 | 2176 | 1757 | 419 |
| MA | 24 | 24 | 420 | 993 | 1986 | 1958 | 28 |
| MD | 66 | 66 | 109 | 3331 | 6662 | 6491 | 171 |
| ME | 48 | 48 | 150 | 748 | 1496 | 1428 | 68 |
| MI | 157 | 157 | 2483 | 5954 | 11908 | 11823 | 85 |
| MN | 123 | 123 | 302 | 5830 | 11660 | 11282 | 378 |
| MO | 65 | 65 | 1190 | 1898 | 3796 | 3690 | 106 |
| MS | 143 | 143 | 249 | 3718 | 7436 | 4128 | 3308 |
| MT | 79 | 79 | 594 | 1652 | 3304 | 3188 | 116 |
| 計 | 2213 | 2213 | 16839 | 66981 | 133962 | 113205 | 20757 |

「一覧の現行決定」は SAM.gov の一覧(is_active=true、sort=title)の頁 0〜8 に出た件数。一覧は決定番号の文字順なので、MT までの州はこの 9 頁で全部そろう(頁 8 は NC20260067 で終わる)。

## 列の入れ方

- layer labor、category「Davis-Bacon General Decision」、item_name = 職種名(原本の行を行末の空白ごとつなぎ、点線の引出しを除いたもの。新しい書式では脚注・割増の説明が職種名の中に書かれているので、それも職種名に含まれる)、spec =「Rate identifier: ASBE0005-002 07/01/2024」(組の見出し。組合の協約番号と効力日、SU は調査、UAVG は組合の加重平均)。
- 基本賃金は price_basis prevailing_wage_hourly(unit USD/hour)、付加給付は prevailing_fringe_hourly(USD/hour)。職種名に「AMOUNTS IN "RATES' COLUMN ARE PER DAY」とある潜水士の 36 行(CA の 9 決定)は Rates 列が日額なので prevailing_wage_daily(USD/day)。
- geo_level state、geo_code は州 FIPS(SAM.gov の州コード CM は本文で Northern Mariana Islands なので 69)、area_label =「決定番号 + 本文の Construction Types の文字」(例「CA20260001 Building, Heavy, Highway and Residential」)、area_code = 改訂番号、area_members = 本文の Counties の欄の原文(例「Alabama Counties of Autauga, Baldwin, ...」)。
- period = 本文の Modification Number / Publication Date の表で現行の改訂の公表日(YYYY-MM-DD)。source_page =「document line N」(document の行番号)、evidence_url = https://sam.gov/wage-determination/<WD>/<改訂>。
- 本文は CSV の欄のように「"」で囲まれ、中の「"」が「""」と二重になっている(2,213 件すべてで確認、二重でない「"」は 0)。囲みを外し「""」を「"」に戻して読んだ。戻さないと 13 件の決定で桁が 1 つずれる。

## 照合(全数、数字)

1. 2 通りの読み: (A) 組の読み(rate identifier の行と Rates/Fringes の見出し行から「-----」まで、行の最後の「$」の後の数と行の最後の数)と (B) 桁の読み(本文の全行で 53 桁目が「$ 」の行、値を桁で切る)。賃金の行 66,981 / 66,981、行番号・基本賃金・付加給付がすべて一致(差のある決定 0)。取り込んだ行 133,962 = 66,981 x 2。
2. 組の見出し 16,839 個すべてに rate identifier の行があり(無いもの 0)、組の終わりに賃金の行につながらない文字が残った組は 0。
3. 一覧との突き合わせ: 2,213 / 2,213 件で改訂番号・州・工事の種類(constructionTypes と JSON の constructionType)が一致。一覧に無い決定 0。一覧の郡名 7,258 個が全部、本文の郡の欄に出てくる。
4. 公表日: 本文の表の現行改訂の日付 = 本文の見出し「General Decision Number: XX 日付」= JSON の publishDate が 2,213 / 2,213。
5. 本文の State の名と FIPS の名が 2,213 / 2,213 一致。
6. 自然キー(出典・品目・規格・単位・地域・時点・値の種類)の重複 0、obs_id の重複 0(他のファイルとの衝突 0)。observations_hold/ は検査器が自然キーを見ないので、同じ式で別に数えた。

## 値の扱いで判断したもの(報告して決めてもらいたい点を含む)

- 付加給付 0.00 の 20,753 行: 検査器が単価の 0 を値として許さない(ZERO_OK_BASES は件数・金額だけ)ので、not_set にして ref_value 0、ref_note「原本の Fringes 欄の値 0.00(付加給付の定めが 0 ドル。...)」とした。実際は「0 と定めた」値なので、Davis-Bacon の付加給付を 0 として持てるよう検査器に prevailing_fringe_hourly を足すかは番人の判断(南部の州の SU(調査)決定に多い。not_set のうち付加給付 0.00 の行: AL 3,034 / 3,034、AR 3,230 / 3,230、FL 3,479 / 3,480、GA 2,715 / 2,715、KS 2,384 / 2,384、MS 3,308 / 3,308)。
- 基本賃金 0.00 の 2 行(IL20260018「MECHANIC (UNDEFINED) (FLOATING EQUIPMENT: OHIO)」など): 同じく not_set、ref_value 0。
- 付加給付の欄が空の 2 行(FL20260004「TRAFFIC CONTROL: FLAGGER」、IL20260020「LABORER: BUILDING CONSTRUCTION (LANDSCAPE WORK)- LANDSCAPE LABORERS (DU PAGE COUNTY)」): not_set。
- 同じ組の中に同じ職種名が 2 回あり値が違う 36 か所(例 MA20260002 LABO0022-013「LABORERS; TOP MAN ((OPEN AIR CASSONS, ...):)」41.18 と 46.20): 原本のまま両方入れ、2 回目の spec に「同じ組の中で同じ職種名の 2 行目」と書いた(旧書式の階層が平らにされた時に見出しが落ちたものと思われる)。

## 原本の誤植らしきもの(値は原本のまま入れ、note に書いた)

1. IN20260003 改訂 2、BRIN0005-001 09/21/2023「BRICKLAYER: TERRAZZO FINISHER (TERRE HAUTE ...)」の Fringes が 1,315.00(Rates 23.38。同じ組の他の行は 15.20〜17.23)。13.15 などの打ち誤りの疑い。
2. MT20260059 改訂 1、ELEC0233-011 03/01/2024「ELECTRICIAN: LOW VOLTAGE WIRING FOR ALARMS AND COMPUTERS (MEAGHER COUNTY ONLY)」の Fringes が 160.74(Rates 23.90)。
3. 31 行で Rates と Fringes の間に文字が印字されている(KY の 3 決定 KY20260054・KY20260055・KY20260065 の ENGI0181-010 の組に「Employee...」11 行、MN の 18 決定の ROOFER / SHEET METAL WORKER などの行に郡名「kandiyohi」「RENVILLE」など 20 行)。組版のはみ出し。値は「$」の後の数と行の最後の数を取り、はみ出した文字を note に書いた。
4. 綴り: 「FREUENCY MODULATION」(CA)、「POWER EQUIMENT OPERATORS」(AS)、「CETER OF THE JOB」(MT)、一覧の郡名「Northwest Artic」(AK)など。原文のまま。
5. CA20260001 改訂 3 に同じ協約番号の組が 2 つ(ASBE0005-002 07/01/2024 と 09/01/2024、値は同じ)。spec の効力日で分かれるので両方入れた。

## 取れなかったもの・次に要るもの

- 残りの現行決定 1,985 件(一覧の頁 9〜16。NC の残り、ND、NE、NH、NJ、NM、NV、NY、OH、OK、OR、PA、PR、RI、SC、SD、TN、TX、UT、VA、VI、VT、WA、WI、WV、WY)。取り方は分かっている(同じ pageFunction で batch 9〜16、1 run 約 2 分、約 30MB)。**取るかどうかは番人の判断**。選択肢:
  1. 規約の「Automated data gathering, web scraping tools are prohibited」を承知で残りを取り、30 州分と合わせて observations/ に移す(parser を `--dir observations` で走らせ直す)。
  2. 許可を取る: 規約の平文に「With permission, you may use software to connect to some SAM.gov data.」とある。GSA の Federal Service Desk(https://www.fsd.gov/gsafsd_sp)か IAE に、賃金決定の一括の取得の可否を問い合わせる。
  3. 労働省 賃金時間局に FOIA で現行の一般賃金決定の一括データを求める。
  4. 取らない。30 州分も observations_hold/ に置いたまま(または削除)にする。
- 公式の API キーは要らない(賃金決定の公式 API が無い)。鍵は作っていない。
- 決定ごとの改訂の履歴(history)と過去の改訂は取っていない(取り方は分かっている: `.../wd/<WD>/history?api_key=null`)。
