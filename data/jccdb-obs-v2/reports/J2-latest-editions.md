# J2-latest-editions 報告(2026-09-26)

## 結論

- 新しい版は、近畿の 2026年10月版(全資材)と、関東のアスファルト合材 月次表(2026年5月〜9月の 5 か月分)だけが出ていた。北陸・九州・北海道・中国・沖縄の一覧頁の最新は、既に取り込んだ月と同じだった。東北(4月)・中部(10月)・四国(10月)も新しい表は無く、台帳・行とも作っていない。
- 近畿は、公開が終わった過去の月のうち Internet Archive に原本が残っていた 4 か月(2025年6月・7月、2026年1月・4月)の生コンを、原本の SHA-1 を Wayback の索引と照合したうえで取り込んだ。生コンは 2025年6月から 2026年10月まで 6 時点の時系列になった。
- 新しく 11 ファイル・29,111 行(値 21,844 / not_set 7,267)、台帳 10 件を作った。古い月の行は 1 行も消していない。全体の検査は誤り 0(80 ファイル・467,664 行、警告 0)。apply_decisions_20260926.py も走らせてある。
- 近畿の 9月から10月: 全資材 24,197 行の対応が 1 対 1 で取れ(9月だけ・10月だけの行は 0)、上がった 8,451 件、下がった 0 件、同じ 8,794 件、値から空欄 77 件、空欄から値 0 件。上げ幅の最大は カッタービット ＲＭ８－２５(橋梁・トンネル用材、12 府県列とも)8,800 円 → 48,000 円(+445%)。金額の最大はプレキャストボックス（ﾚｼﾞﾝｺﾝｸﾘｰﾄ製） E桝 800×4700×1500(滋賀)3,520,000 円 → 3,910,000 円(+390,000 円)。生コンは 846 行のうち 6 件だけ上がった(京都北部・京都南部の 30-18-20(25) 23,400 円 → 29,400 円、+25.6%)。
- parser を直した(月の引数を足した)近畿の全資材 parser を 9月に当て直し、既存の CSV と診断 JSON が md5 一致することを確かめた。新しく置いた生コンの parser も 9月に当てると既存の生コンの CSV と md5 一致。

## 作ったファイル

| ファイル | 行数 | published_pdl | not_set | source_id |
|---|---:|---:|---:|---|
| observations/jp/material_kkr_zairyo_r8_10.csv | 24,197 | 17,245 | 6,952 | kkr-zairyo-r8-10 |
| observations/jp/material_kkr_namacon_r8_10.csv | 846 | 846 | 0 | kkr-zairyo-r8-10 |
| observations/jp/material_kkr_namacon_r8_04.csv | 846 | 846 | 0 | kkr-zairyo-r8-04 |
| observations/jp/material_kkr_namacon_r8_01.csv | 846 | 846 | 0 | kkr-zairyo-r8-01 |
| observations/jp/material_kkr_namacon_r7_07.csv | 848 | 848 | 0 | kkr-zairyo-r7-07 |
| observations/jp/material_kkr_namacon_r7_06.csv | 848 | 848 | 0 | kkr-zairyo-r7-06 |
| observations/jp/material_ktr_zairyo_as_r8_05.csv | 136 | 73 | 63 | ktr-zairyo-as-r8-05 |
| observations/jp/material_ktr_zairyo_as_r8_06.csv | 136 | 73 | 63 | ktr-zairyo-as-r8-06 |
| observations/jp/material_ktr_zairyo_as_r8_07.csv | 136 | 73 | 63 | ktr-zairyo-as-r8-07 |
| observations/jp/material_ktr_zairyo_as_r8_08.csv | 136 | 73 | 63 | ktr-zairyo-as-r8-08 |
| observations/jp/material_ktr_zairyo_as_r8_09.csv | 136 | 73 | 63 | ktr-zairyo-as-r8-09 |
| 計 | 29,111 | 21,844 | 7,267 | |

- layer: material 29,099、equipment 12(近畿 10月の機械賃料)。price_basis は既存の許可一覧の中(extra_enums は使っていない)。
- 近畿 10月の全資材の内訳は 9月と同じ形: 地区別の頁(骨材・アスファルト合材・生モルタル、PDF 37〜63)4,565 行、府県別の頁(鋼材〜機械賃料、PDF 65〜142)19,632 行。
- 生コンのファイルは 9月のもの(v1 から移したもの)と同じ約束: 値のあるセルだけ行を作り、空欄は行を作らない。奈良の列だけ area_code / area_members を入れる。jccdb_v4_item_id は JCCDB v4 の品名で結ぶ(各月 541 行が結べた)。
- 台帳(新規 10 件): sources/kkr-zairyo-r8-10.json、kkr-zairyo-r8-04.json、kkr-zairyo-r8-01.json、kkr-zairyo-r7-07.json、kkr-zairyo-r7-06.json、ktr-zairyo-as-r8-05.json 〜 ktr-zairyo-as-r8-09.json。既存の台帳は書き換えていない。
- 原本(raw/、すべて PDL1.0): kkr-zairyo-r8-10.pdf、kkr-zairyo-r8-04.pdf、kkr-zairyo-r8-01.pdf、kkr-zairyo-r7-07.pdf、kkr-zairyo-r7-06.pdf、ktr-zairyo-as-r8-05.pdf 〜 ktr-zairyo-as-r8-09.pdf。
- parser:
  - tools/parsers/parse_kkr_zairyo.py(B1 のもの)に `--month r8_09|r8_10`、`--out`、`--diag` を足した。頁の範囲は表紙の頁と各頁の種別から自動で決め、r8_09 では B1 の固定の範囲と一致することを assert する。引数なしは従来どおり 9月。
  - tools/parsers/parse_kkr_namacon.py(新規): v1 の /home/claude/work/jccdb_up/tools/parse_kkr_namacon.py の parse_page(左端 X0=363.0 の直しを含む)と、v1 の build_obs.py・migrate_v1.py の行の組み立てを写したもの。`--month r7_06|r7_07|r8_01|r8_04|r8_09|r8_10`。
  - tools/parsers/parse_ktr_as_monthly.py(新規): parse_ktr_zairyo.py の parse_grid_page と area_table をそのまま使う。`r8_05|…|r8_09`。
- 読みの詳細: reports/J2-latest-editions.kkr_r8_10_diag.json(近畿 10月の全資材、B1 の診断と同じ形)、reports/J2-latest-editions.checks.json(生コン 6 か月と関東アスファルト 5 か月の照合)、reports/J2-latest-editions.kkr_r8_09_to_r8_10_changes.csv(9月から10月で値が変わった 8,534 セル: 全資材 8,528、生コン 6)。

## 取った出典

| source_id | URL | bytes | sha256 | Last-Modified | 取り方 |
|---|---|---:|---|---|---|
| kkr-zairyo-r8-10 | https://www-2.kkr.mlit.go.jp/plan/jigyousya/technical_information/gijutsukanri/qgl8vl0000004zj9-att/2026_10tanka.pdf | 1,812,911 | 82538ace3f1f9da28e4acdbf0dc1e875d46da91afbb12da23e652e5ac75701bd | Fri, 25 Sep 2026 04:01:15 GMT | web-fetch raw。Content-Length・ETag の長さ部 0x1ba9af と一致、142 頁 |
| kkr-zairyo-r8-04 | https://www.kkr.mlit.go.jp/…/qgl8vl0000004zj9-att/2026_4tanka.pdf | 3,636,659 | 92e35f0663e09bca28456c5d105d728b17734c38e58e7e9accbc7f2502b7bc22 | Wed, 25 Mar 2026 05:34:31 GMT | Wayback 20260518125543、SHA-1 = CDX digest QLDBI7WZ… |
| kkr-zairyo-r8-01 | https://www.kkr.mlit.go.jp/…/qgl8vl0000004zj9-att/2026_1tanka.pdf | 4,035,733 | c7ad8a76b17067b49046be8c96c9a2b23ec38ea70f371713ca2db0a8dcb9d8fd | Tue, 23 Dec 2025 06:07:24 GMT | Wayback 20260210020630、SHA-1 = CDX digest I45EPX34… |
| kkr-zairyo-r7-07 | https://www.kkr.mlit.go.jp/…/qgl8vl0000004zj9-att/2025_07tanka.pdf | 3,820,002 | 90a7489068e70b2d9951497b06d70a547b465d4b511cdd1d4d57cc899048cec9 | Mon, 23 Jun 2025 06:05:09 GMT | Wayback 20250706212004、SHA-1 = CDX digest Q63P37S4… |
| kkr-zairyo-r7-06 | https://www.kkr.mlit.go.jp/…/qgl8vl0000004zj9-att/2025_06tanka.pdf | 4,014,582 | 07c79c0d1ad949c4ff3206ccb5b1049d1856aa484204d1267a6c915af553e9e0 | Fri, 23 May 2025 06:39:51 GMT | Wayback 20250706203523、SHA-1 = CDX digest RYKV4POX… |
| ktr-zairyo-as-r8-05 | https://www.ktr.mlit.go.jp/ktr_content/content/000943667.pdf | 27,951 | abfe63861fb8b45f08899acbbde4f20db047a0a1fdcb4e06cc58ba8a39c47d86 | Fri, 24 Apr 2026 01:00:08 GMT | website-content-crawler → key-value store |
| ktr-zairyo-as-r8-06 | https://www.ktr.mlit.go.jp/ktr_content/content/000946115.pdf | 32,171 | c4556e292db394df7256db88dc7d942083c32067b69e040dd6000b5192f0ef87 | Tue, 26 May 2026 01:00:08 GMT | 同上 |
| ktr-zairyo-as-r8-07 | https://www.ktr.mlit.go.jp/ktr_content/content/000949745.pdf | 32,159 | 3ff7a8204d5c2d646725a3188e4200edec0184c561df415c231a904ad321a42c | Fri, 26 Jun 2026 01:00:08 GMT | 同上 |
| ktr-zairyo-as-r8-08 | https://www.ktr.mlit.go.jp/ktr_content/content/000953486.pdf | 32,172 | fac567c3f1d4910d2dedc9d05ae4ad4f835e82516b2835535a9654afc929d9e4 | Mon, 27 Jul 2026 01:00:37 GMT | 同上 |
| ktr-zairyo-as-r8-09 | https://www.ktr.mlit.go.jp/ktr_content/content/000956094.pdf | 32,142 | 9fcab580504f8004522232a243f9346f8347721f8f1cf0d518a2b553154d2ff5 | Thu, 27 Aug 2026 01:00:08 GMT | 同上 |

(…は plan/jigyousya/technical_information/gijutsukanri/。完全な URL は各台帳の url と archive_url。)

### 近畿の過去の月: 原本は公開終了、Internet Archive の原本のバイト列を使った

- 近畿の掲載頁(https://www.kkr.mlit.go.jp/plan/jigyousya/technical_information/gijutsukanri/index.html、WebFetch で所在確認)には 9月と10月の 2 件しか載っていない。過去の月の URL(2026_4tanka.pdf、2026_07tanka.pdf、2026_08tanka.pdf を www と www-2 で)を Apify で取ると、どれも HTTP 200 で近畿地整の「WEBサイトリニューアルのお知らせ」頁(text/html、22,289 bytes)が返る(公開終了)。2026_05tanka.pdf と 2026_06tanka.pdf は Apify の同時実行の上限で試せていないが、下の索引に無い。
- Wayback の CDX 索引(Apify で https://web.archive.org/cdx/search/cdx?url=kkr.mlit.go.jp/…/qgl8vl0000004zj9-att/&matchType=prefix を取得)に、2025年度以降の設計材料単価表は 2025_06、2025_07、2026_1、2026_4 の 4 件だけあった(2026年5〜8月は無い)。
- 4 件とも id_ 形式(原本のバイト列をそのまま返す)で取り、(1) SHA-1 の base32 が CDX の digest と一致、(2) bytes が保存時の Content-Length と ETag の長さ部と一致、(3) 先頭 %PDF、表紙と各頁の月がその月、を確かめた。台帳の url は原本の URL、archive_url に Wayback の URL、fetched_via に確かめたことを書いた。
- 利用条件は近畿のサイトの PDL1.0(条文は下)。原本は今は掲載されていないが、同じ発行者の同じ表の系列で、PDF の全頁の文字に「複製・転載・禁止・著作・無断」は 0 件。これで値を入れてよいかは、公開の組み立ての前に持ち主の確認を勧める(条文の「当ホームページで公開している情報」に、公開を終えた版が含まれるかという点)。
- 2026年4〜8月の優先は、4月だけが取れた。5〜8月は原本が無い(公開終了、Wayback にも無い)。

### 関東のアスファルト合材 月次表の取り方

- web-fetch の raw は小さい PDF(約 32KB)だと結果がファイルに落ちず復元できない(B2 の報告どおり)。apify/cheerio-scraper はアカウントの権限の承認が要り動かなかった。apify/website-content-crawler(crawlerType cheerio、saveContentTypes application/pdf、proxyConfiguration 必須)で 5 本を 1 回で key-value store に置かせ、get-key-value-store-record で受け取った(バイナリはファイルに保存される)。
- 別に web-fetch で各 PDF の応答ヘッダだけを読み、Content-Length と ETag の長さ部(16 進、例 0x7d8e = 32,142)が受け取ったバイト数と 5 本とも一致することを確かめた。000956094.pdf の 32,142 bytes は B2 の報告の値とも一致。

### 利用条件(値を入れた根拠)

- 近畿(https://www.kkr.mlit.go.jp/link.html、2026-09-26 に B1 が Apify で取得した条文): 「当ホームページで公開している情報（以下「コンテンツ」といいます。）の著作権は、特記されていない限り国土交通省近畿地方整備局に帰属し、権利表記の記載がない限り「公共データ利用規約（第1.0版）」（PDL1.0）に準拠した利用条件の下で、利用することができます。」 10月・過去 4 か月の PDF とも権利表記・複製禁止の文言は無い。10月の表の 1〜9 頁(説明と別表)は 9月と、月の表記・空白・一部の字の符号位置(電⼒料⾦ など)以外同じ。
- 関東(https://www.ktr.mlit.go.jp/guide/copyright.html、今回 Apify で取り直した、last-modified Tue, 31 Mar 2026 16:00:40 GMT): 「関東地方整備局ウェブサイトで掲載・発信している情報(以下「コンテンツ」といいます。)の著作権は、特記されていない限り関東地方整備局に帰属し、権利表記の記載がない限り「公共データ利用規約(第1.0版)」(PDL1.0)に準拠した利用条件の下で、利用することができます。」 月次の PDF に権利表記は無い。帰属表示は「…を加工して作成」の形で台帳 attribution に。

## 一覧頁を見た結果(2026-09-26)

| 局 | 見た頁 | 最新 | 取り込み済みの月 | 判断 |
|---|---|---|---|---|
| 近畿 kkr | gijutsukanri/index.html(WebFetch) | 2026年10月 | 9月 | 10月を取り込み |
| 北陸 hrr | https://www.hrr.mlit.go.jp/gijyutu/index.html(Apify、last-modified Fri, 28 Aug 2026) | 2026年9月(2026.9.pdf) | 9月 | 新しい表なし |
| 九州 qsr | https://www.qsr.mlit.go.jp/for_company/kensetu_joho/koujisekisan.html(Apify) | 令和8年9月(8月と9月が掲載) | 9月 | 新しい表なし |
| 北海道 hkd | https://www.hkd.mlit.go.jp/ky/jg/gijyutu/ud49g70000000uh8.html(Apify、last-modified Fri, 25 Sep 2026) | 令和8年9月単価 | 9月 | 新しい表なし |
| 中国 cgr | http://www.cgr.mlit.go.jp/skill/index.html(WebFetch。Apify は B1 のとき FAILED) | 2026年4月単価、アスファルト合材 2026年6月単価 | 4月・6月 | 新しい表なし |
| 関東 ktr | https://www.ktr.mlit.go.jp/gijyutu/gijyutu00000041.html(Apify、last-modified Thu, 27 Aug 2026) | 特別調査 令和8年4月1日、アスファルト合材 2026年9月1日以降適用 | 4月 | アスファルト合材 5〜9月を取り込み |
| 沖縄 ogb | https://www.ogb.go.jp/kaiken/koji/007864(Apify) | R8.4 | 4月 | 新しい表なし |
| 東北 thr | tanka.files/sheet001.htm(WebFetch。sheet001.htm 直下は 404) | 令和08年04月単価 | 4月 | 新しい表なし(台帳も作らない) |
| 中部 cbr・四国 skr | (既存の台帳が 10月) | 10月 | 10月 | 新しい表なし |

## 照合の方法と数字

1. 近畿 10月 全資材(B1 の照合をそのまま当てた): 105 頁・2,131 行で pdftotext -layout の行の値の並びと bbox の行の値の並びが全行一致(食い違いの頁 0、主行に付かない語 0)。値の列の割り当ての最大距離 右端 0.12pt・中心 7.8pt(右端と中心の最近傍が全セルで同じ列)。地区別の頁の列は各種別 83(10x8+3)で別表-2 の 83 地区に番号順で当たり、列の府県と別表-2 の府県が 83/83 一致、別表-1 の地区番号の集合 = 別表-2 の地区番号の集合。9月の数字と全部同じ。
2. 近畿 生コン(6 か月): 各月 27 頁・567 行で -layout の生コンの行の数の並びと bbox の行の値の並びが全行一致。値の列の最大距離 0.13pt(9月・10月)/ 0.06pt(過去 4 か月)、群ラベルの割り当ての最大誤差 0.15pt / 0.05pt。別表-1・-2 の -layout の文字は 6 か月とも 9月と全く同じ。
3. parser の当て直し(md5): parse_kkr_zairyo.py --month r8_09 の出力 d46f74537efc137ea3630895c6ed3a15 = 既存の material_kkr_zairyo_r8_09.csv、診断 JSON 20fe070ab4a4a13c638a79992b41412d = 既存の B1 の診断。parse_kkr_namacon.py --month r8_09 の出力 a317238f6060a54fbb241784e8ffc349 = 既存の material_kkr_namacon_r8_09.csv。当て直しは作業用の場所に書き、既存のファイルは書き換えていない。
4. 9月と10月の行の対応: 全資材は (種別, 品目, 規格, 単位, 地区表示, 地区コード) で 24,197 行が 1 対 1(重複 0、片方だけ 0)、行の並びも同じ。生コンは (規格, 単位, 地区表示) で 846 行が 1 対 1。
5. 値の変化の確かめ: 上げ幅最大のカッタービット(9月 -layout 5,596 行目「8,800」x12、10月 5,591 行目「48,000」x12)、生コンの京都の変化(PDF 12 頁、23,400 → 29,400)を -layout の本文で直接確かめた。
6. 関東 アスファルト合材 月次(5 か月): 各月 3 頁すべてで、-layout の値の形の語(数と「-」)の多重集合から値でない欄の数の語を引いたものと、bbox で列に割り当てた 136 語が一致。列の最大距離 0.04pt。34 地区すべてに特別調査の地区割一覧表の地区(3)の市町村が付いた(ラベル 164、セルに入らないもの 0)。空欄のセル 0。
7. 検査器: 新しい 11 ファイルの指定で誤り 0・警告 0(29,111 行)。apply_decisions_20260926.py のあと全体で誤り 0・警告 0(80 ファイル、observations 446,272 行、observations_restricted 20,402 行、observations_hold 990 行、台帳 101)。

## 時系列で見えたこと(値は原本のまま、消費税抜き)

### 近畿 全資材 9月 → 10月

- 上がった 8,451 件、下がった 0 件、同じ 8,794 件、値 → 空欄 77 件、空欄 → 値 0 件、両方空欄 6,875 件。
- 上がった件数の多い種別: 配線材料 4,476(上がった値の中央値 +13.1%)、通信器具 1,020(+12.1%)、管路材・ダクト（電気） 852(+11.0%)、橋梁・トンネル用材 408(+9.6%)、道路・舗装用材 328(+10.2%)、コンクリート製品 309(+8.3%)、その他土木資材 261、電気設備その他 228。鋼材は 72 件で中央値 +32.9%。仮設材・生モルタル・セメント・塗料・機械賃料は変化なし。アスファルト合材は 5 件だけ(中央値 +1.4%)。
- 変化率の分布(値が変わった 8,451 件): 1% 未満 21、1〜5% 1,837、5〜10% 1,133、10〜20% 4,677、20〜50% 759、50% 以上 24。
- 値 → 空欄 77 件: 防錆材 プロコート・プロコートＣ、シール材 エポキシ、照明器具（坑内照明用）鋼板版 40W 相当 LED、照明器具グローブ ＫＳＣ－４(各 12 府県列)、コンクリート用骨材 砂 洗い 細目(6 地区)、鉄筋コンクリートＬ形 Ｌ－１(3 規格 x 3)、連節ブロック 小型(2)。原本の説明では、取り引き事例が著しく少ない材料は単価を設定せず空欄。物価資料に載っている材料は表に載せないとも書かれており、どちらの理由で空欄になったかは原本から分からない。

### 近畿 生コン 6 時点(2025-06, 2025-07, 2026-01, 2026-04, 2026-09, 2026-10)

| 前 → 後 | 対応した行 | 上がった | 下がった | 同じ | 前だけ | 最大の上げ幅 |
|---|---:|---:|---:|---:|---:|---|
| 2025-06 → 2025-07 | 848 | 4 | 0 | 844 | 0 | +10.8% |
| 2025-07 → 2026-01 | 846 | 69 | 0 | 777 | 2 | +10.2% |
| 2026-01 → 2026-04 | 846 | 0 | 0 | 846 | 0 | なし |
| 2026-04 → 2026-09 | 846 | 415 | 0 | 431 | 0 | +50.1%(京都北部 舞鶴市 30-18-20(25) 21,950 → 32,950) |
| 2026-09 → 2026-10 | 846 | 6 | 0 | 840 | 0 | +25.6%(京都北部・京都南部 3 地区 x 2 セメント 23,400 → 29,400) |

- 2025-06 から 2026-10 まで続いた 846 行の変化率: 中央値 +5.9%、最小 0%、最大 +50.1%。下がった行は 1 つも無い。
- 兵庫北部 美方郡の 30-18-20(25)(普通・高炉の 2 行、28,600 円)は 2025年7月まであり、2026年1月以降は空欄(行なし)。

### 関東 アスファルト合材(安定処理材)2026-04 → 2026-09(4月は既存の特別調査のファイル)

| 前 → 後 | 上がった | 同じ | 状態の変化 | 最大の上げ幅 |
|---|---:|---:|---:|---|
| 04 → 05 | 34 | 39 | 0 | +17.7%(AS安定処理(再生) (30) 成田 11,300 → 13,300) |
| 05 → 06 | 73 | 0 | 0 | +7.5% |
| 06 → 07 | 0 | 73 | 0 | なし |
| 07 → 08 | 4 | 69 | 0 | +5.6%(再生瀝青安定処理材（４０） 上田 17,800 → 18,800) |
| 08 → 09 | 0 | 73 | 0 | なし |

- 4月から9月で値のある 73 セルは全部上がった(中央値 +23.1%、最小 +15.5%、最大 +38.1%)。下がったセルと、「-」と値の入れ替わりは 0。

## 取れなかったもの・やらなかったもの

- 近畿の 2026年5〜8月と、2025年度のうち 6・7・1 月以外の月: 原本は公開終了(掲載頁に無く、URL は「WEBサイトリニューアルのお知らせ」頁を返す)。Wayback の索引にも無い。推測で作っていない。
- 近畿の過去 4 か月の生コン以外の資材: 指示どおり生コンだけ(全資材は 1 か月 28.7MB になるため)。原本は raw/ にあるので、parse_kkr_zairyo.py の MONTHS に足せば同じ読み方で出せる(141 頁の月は頁の範囲の自動決定がそのまま効くはず。試していない)。
- 近畿の生コンの空欄(not_set)の行: 9月の生コンのファイルに合わせて作っていない。全資材のファイルの地区別の頁は空欄も not_set で持つので、約束が 2 通りある(下の「次に」)。
- 中部・東北・四国: 新しい表が無かったので、台帳も observations_restricted/ の行も作っていない。
- 北陸 2026.10.pdf など、一覧頁に載っていない URL を当て推量で取ることはしていない。
- Wayback の www-2.kkr.mlit.go.jp の索引は Apify の実行が FAILED(exitCode 1)で見られなかった。

## 原本で気づいたこと

- 近畿 2026年4月版の表紙が「令和７年度土木工事設計材料単価表（令和８年４月）」。2026年4月は令和8年度なので、年度の表記の誤りらしい(各頁は「2026年04月」)。台帳の title は「令和7年度 …(令和8年4月)」と原本のままにした。
- 近畿 2025年7月・2026年1月版は、表紙と説明の頁の字が康熙部首の符号位置(⼟⽊⼯ など)で埋め込まれている(読みの結果には影響なし。生コンの頁は通常の字)。
- 関東の月次表の頁の見出しは「令和8年8月(令和8年9月号)」の形で、調査月と号を表す。掲載頁のリンクの文言は「2026年9月1日以降適用単価」。period と effective_from はリンクの文言(適用開始)に合わせた。
- 関東の月次表には「-」の説明が無い。4月1日の特別調査の表の説明(「－」は単価を設定していない地区)に拠って not_set にした。
- 既存の material_ktr_zairyo_r8_04.csv のアスファルト合材の行の note に「2026年9月1日以降適用の単価は別 PDF(000956094.pdf、未取り込み)」とある。今回取り込んだので、B2 の担当か番人が note を直すことを勧める(他の担当のファイルなので書き換えていない)。

## 次に取るべきもの

- 10月1日以降に出る版: 北陸 2026年10月、九州 令和8年10月(原本に「次回の単価更新は、令和８年９月末頃を予定」)、北海道 10月、関東 特別調査 令和8年10月1日 と アスファルト合材 10月、中国 2026年10月、沖縄・東北 R8.10。
- 近畿の生コンの約束を 1 つにするか(空欄の行を not_set で持つか)の判断。持つなら parse_kkr_namacon.py に空欄の行を足し、6 か月とも作り直す(obs_id は変わらない)。
- 近畿の過去 4 か月の生コン以外の資材(原本は手元にある)。
- 公開を終えた版(Wayback から取ったもの)に PDL1.0 を当てることの持ち主の確認。
