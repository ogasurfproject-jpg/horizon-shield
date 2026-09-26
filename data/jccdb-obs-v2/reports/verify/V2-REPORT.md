# 独立検証 V2: 米国の値と利用条件の条文(2026-09-26)

検証者は作った担当とは別。作った側の報告と parser は使わず、台帳の sha256 で特定した原本を自分で読んだ。スクリプトと取り直した頁は verify/V2/(results.json、results_A1.json、results_A2.json、results_B.json、check_identity.py、verify_values.py、check_licenses.py、pages/)。検証者の環境で .md が書けなかったため、この報告は番人が検証者の返答から起こした。

## 結論

- 米国の値: price のある 111,106 行すべてが原本のセルと一致(不一致 0、未検出 0)。CSV の全 115,070 行を調べた。
- 原本の同一性: 米国 25 出典中 24 が一致。fhwa-nhcci は raw/ に原本が無かった(取り直した応答は台帳の sha256 と一致)。日本は 66 中 64 が一致、原本が無いのは mlit-roumu-r8 と nara-shizai-r8-09(src/ にあった)。
- SD / MT: 値は 0 件、license は全行 restricted。ただし SD の note 2,862 行に原本の入札件数(Bid Cnt)が残っていた。parser を当て直すと値が戻るので、apply_decisions を必ず後に走らせること。
- 利用条件の条文: 開いた条件の 85 出典で、一致 35、不一致 49、頁が取れない 1。不一致はどれも「利用できる」という中身は頁のとおりで、写し方の問題。
  - かぎ括弧の置き換え 32(mlit-gijutsusha 18、mlit-roumu 14): 台帳は『』、頁は「」。
  - 見出しと本文の連結・中略 17(estat-chakko 16、ogb-zairyo-r8-04)。
  - 取れない 1(国総研 aboutlink.htm、Shift_JIS の文字化け。同じ化け方を再現すると条文は含まれていた)。
  - restricted の 6 出典は一致 5、不一致 1(nara-shizai-r8-09、かぎ括弧)。

## 値の照合(一致 / price のある行)

| 出典 | 一致 / 行数 | 補足 |
|---|---|---|
| bls-ppi-wp-80i | 19456/19456 | |
| bls-ppi-pc-75 | 6393/6393 | not_set 7 行は flat file に行が無い |
| bls-ppi-wp-14 | 2929/2929 | not_set 15 行 |
| bls-ppi-wp-11b | 1280/1280 | |
| bls-ppi-wp-9 | 1152/1152 | |
| bls-ppi-wp-11a | 877/877 | not_set 15 行 |
| bls-ppi-wp-6 / 7 / 12a / 8 | 256 / 256 / 128 / 128 | |
| bls-eci-ci-current | 714/714 | |
| bls-oews-m2025-national | 1430/1430 | PRSE 330/330 |
| bls-oews-m2025-state | 35500/35500 | PRSE 8253/8253、not_set 263 行は * / ** |
| census-vip-eits | 28320/28320 | RSE 28320/28320 |
| census-chars-contractprice | 528/528 | not_set 48 行は (S) / (NA) |
| census-chars-soldprice | 480/480 | |
| census-chars-contractpricesqft | 390/390 | |
| census-chars-soldpricesqft | 340/340 | |
| census-cqpi-sold | 569/569 | |
| census-cqpi-uc | 814/814 | |
| fema-equipment-rates-2025 | 465/465 | 単位と頁も一致 |
| njdot-wavg-2023-q2 | 8608/8608 | 数量・件数・金額・頁・単位も一致 |
| fhwa-nhcci | 93/93 | 季節調整値 93/93 |

読み方: BLS は flat file を (series_id, year, period) で引いた(series_id は全行の spec にある)。OEWS は xlsx を (AREA, OCC_CODE, O_GROUP, NAICS, OWN_CODE) で引いた。Census は見出しの文字で列、年で行。VIP は note の cat_code と dt_code で引いた。FEMA と NJDOT は pdftotext -layout の行を正規表現で読んだ(作った側の座標の読みとは別の方法)。

値以外: NJDOT の CSV 4 行で、原本の品名「1 - 2" FLEXIBLE NONMETALLIC CONDUIT」の「-」が落ちていた。

## 番人の対応(同日)

- 条文 50 台帳を頁の文字どおりに直した(license_quote_previous に旧い写しを残した)。直した後、取り直した頁で 50/50 一致を確かめた。
- NJDOT の品名 4 行を直した。SD の note から数を落とした(2,862 行)。
- 原本の置き忘れ 3 つ(fhwa-nhcci、mlit-roumu-r8、nara-shizai-r8-09)を raw/ と raw_restricted/ に置いた(sha256 を台帳と照らしてから)。
- 以上は tools/apply_decisions_20260926.py に入れた(parser の後に走らせる)。
