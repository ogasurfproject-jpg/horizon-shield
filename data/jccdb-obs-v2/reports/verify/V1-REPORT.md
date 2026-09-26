# V1 検証報告: JCCDB 観測層 v2 日本の行の値

検証者 V1-jp-values(独立。作成側の報告は読んでいない)。2026-09-26。対象は `observations/jp/*.csv` の全行。原本と CSV だけを機械で読んだ。スクリプトは同じディレクトリ(`run_all.sh` で再実行できる)。データのファイルは1つも書き換えていない(obs2 配下の最終更新は 10:11 のまま)。

## 結論

- 値の存在(2): 値のある 273,760 行のうち 273,760 行が原本と一致、不一致 0 行。PDF は該当頁の文字、Excel は該当セル(表示の桁で丸め)で照合した。着工統計の 1m2 あたり 8,019 行は2つのセルから計算し直して全件一致(1円未満四捨五入、note の数・割る前の行の値とも一致)。
- 取り違え(3): 地区・職種の列の入れ替わり、行の入れ替わりは 0 件。PDF の表は座標で値の列と行を決め直し、セル FAIL 0 件、列見出しの不一致 0 件。Excel は表頭・表側の文字で全行一致。
- 検出力: 同じ検査に取り違えを注入すると、行内の地区入れ替え 1398/1398、空欄の列への移動 892/892、列ラベルの入れ替え 252/252、同じ列の行の入れ替え 1153/1159 を検出。Excel 側の注入 7 種も 738/739。0 件は検査が甘いからではない。
- 原本の同一性(1): JP の台帳 66 件すべてで sha256 とバイト数が手元の原本と一致。不一致 0 件。
- 閉じた行(4): closed の 47,743 行に値なし。restricted の出典(6 台帳、JP は 4)の行 21,986 行はすべて observations_restricted にあり、price も ref_value も空。observations/jp に restricted の出典の行は無い。

## 指摘(誤りではないが、読む人に要る事)

1. 原本の 0 を not_set にしている行がある。着工統計 4,743 行(元セルがすべて 0)、リフォーム調査 184 行、新営予算単価 6 行。SCHEMA の not_set は「空欄・「-」。0 ではない」なので定義とずれる。ただし着工統計と新営は ref_value=0 と ref_note「原本の値は 0」、リフォームは note「原本の値は 0」で全行に開示されている。検査器が開いた状態の 0 を許さないための扱いと読める。値を使う人が not_set を「未設定」と読むと 0 件の事実を落とす。
2. デフレーター四半期別の 1 行(2017Q3 道路橋梁 93.4)は、月別の同じ系列の3か月平均 93.27 と 0.13 ずれる。CSV の値は原本のセルと一致しているので、原本側の値。観測層の値の誤りではない。作成側が observations_hold に移した「右に1列ずれ」の疑い(2020年4-6月期以降)とは別件で、observations/jp に残っている四半期の行は 2,217 行が月別平均と 0.1 以内で一致した。
3. 労務単価 h25 の縦長の表で、青森・秋田の建具工、愛知のタイル工の 3 セルは原本の組版で列から 6pt 左にずれて印字されている。見出し(建具工 274-298pt)の真下にあり、横長の表でも同じ値が正しい列にあるので CSV は正しい(近傍列で合格として数えた)。
4. 労務単価 h29 の PDF は poppler(pdftotext)でフォントが解けず数字が出ない。pdfplumber(pdfminer)で読んだ。
5. 近畿の原本は raw/kkr-zairyo-r8-09.pdf と /home/claude/work/src/kkr_r8_09_tanka.pdf が同じバイト列(sha256 07691505...)。労務単価 r8 と奈良県の原本は raw/ に無く、src/ にある(sha256 は台帳と一致)。

## 確かめられなかったもの

- 施工パッケージの PDF(868 頁、国交省通知)はバイト列が手元に無い。台帳の sha256 は Apify のダウンローダーが報告した値で、自分では計算できない。値は Excel のセル(台帳と sha256 一致)で全件照合し、副として Apify の PDF 文字抽出(sha256 一致)の該当頁に値があることを全 88,832 件で確かめた。PDF の組版そのものとの照合はしていない。
- PDF の閉じた行(not_set など)のうち 11,263 行は、同じ印刷行に値が1つも無い、またはその頁のその地区の列に値が1つも無いため、座標で「その位置に数字が無い」ことを判定できなかった。値の無い行なので、誤った値が入る危険は無い(危険は原本の値の取りこぼしだけ)。
- PDF の行の文字(規格)と値の行の対応を文字で確かめられなかった印刷行が 40 件ある(複数行のセル、行をまたぐ「呼び径」など)。全件、値の近くの文字を `rowlabel_manual_review.txt` に出して目で見た。食い違いは無かった。このほか、文字は一致せず規格の数字だけが一致した行が材料で 378 件(規格を見出しから組み立てた表、語順の揺れ)ある。
- 条件の意味(物価資料由来か、税抜きか)や利用条件の判断の正しさは範囲外。ここで見たのは値の写しと位置だけ。

## 出典ごとの表

2 = 値の存在、3 = 取り違えの検出。「値あり」は price の入っている行。

| 出典 | ファイル | 行数 | 値あり | 2 一致 | 2 不一致 | 3 結果 |
|---|---|---:|---:|---:|---:|---|
| estat-chakko-t6-1-2025 | cost_sqft_mlit_chakko_2025.csv | 1,340 | 1,328 | 1,328 | 0 | 表頭・表側 ok 1340 / FAIL 0; 計算値 332/332, note の数 332, 元の行 332; not_set の元セル 0: 12 |
| estat-chakko-t7-1-2025 | cost_sqft_mlit_chakko_2025.csv | 3,449 | 3,428 | 3,428 | 0 | 表頭・表側 ok 3449 / FAIL 0; 計算値 857/857, note の数 857, 元の行 857; not_set の元セル 0: 21 |
| estat-chakko-t6-1-2026-01 | cost_sqft_mlit_chakko_2026_01_07.csv | 1,269 | 1,044 | 1,044 | 0 | 表頭・表側 ok 1269 / FAIL 0; 計算値 261/261, note の数 261, 元の行 261; not_set の元セル 0: 225 |
| estat-chakko-t7-1-2026-01 | cost_sqft_mlit_chakko_2026_01_07.csv | 3,275 | 2,732 | 2,732 | 0 | 表頭・表側 ok 3275 / FAIL 0; 計算値 683/683, note の数 683, 元の行 683; not_set の元セル 0: 543 |
| estat-chakko-t6-1-2026-02 | cost_sqft_mlit_chakko_2026_01_07.csv | 1,276 | 1,072 | 1,072 | 0 | 表頭・表側 ok 1276 / FAIL 0; 計算値 268/268, note の数 268, 元の行 268; not_set の元セル 0: 204 |
| estat-chakko-t7-1-2026-02 | cost_sqft_mlit_chakko_2026_01_07.csv | 3,283 | 2,764 | 2,764 | 0 | 表頭・表側 ok 3283 / FAIL 0; 計算値 691/691, note の数 691, 元の行 691; not_set の元セル 0: 519 |
| estat-chakko-t6-1-2026-03 | cost_sqft_mlit_chakko_2026_01_07.csv | 1,272 | 1,056 | 1,056 | 0 | 表頭・表側 ok 1272 / FAIL 0; 計算値 264/264, note の数 264, 元の行 264; not_set の元セル 0: 216 |
| estat-chakko-t7-1-2026-03 | cost_sqft_mlit_chakko_2026_01_07.csv | 3,300 | 2,832 | 2,832 | 0 | 表頭・表側 ok 3300 / FAIL 0; 計算値 708/708, note の数 708, 元の行 708; not_set の元セル 0: 468 |
| estat-chakko-t6-1-2026-04 | cost_sqft_mlit_chakko_2026_01_07.csv | 1,282 | 1,096 | 1,096 | 0 | 表頭・表側 ok 1282 / FAIL 0; 計算値 274/274, note の数 274, 元の行 274; not_set の元セル 0: 186 |
| estat-chakko-t7-1-2026-04 | cost_sqft_mlit_chakko_2026_01_07.csv | 3,304 | 2,848 | 2,848 | 0 | 表頭・表側 ok 3304 / FAIL 0; 計算値 712/712, note の数 712, 元の行 712; not_set の元セル 0: 456 |
| estat-chakko-t6-1-2026-05 | cost_sqft_mlit_chakko_2026_01_07.csv | 1,282 | 1,096 | 1,096 | 0 | 表頭・表側 ok 1282 / FAIL 0; 計算値 274/274, note の数 274, 元の行 274; not_set の元セル 0: 186 |
| estat-chakko-t7-1-2026-05 | cost_sqft_mlit_chakko_2026_01_07.csv | 3,293 | 2,804 | 2,804 | 0 | 表頭・表側 ok 3293 / FAIL 0; 計算値 701/701, note の数 701, 元の行 701; not_set の元セル 0: 489 |
| estat-chakko-t6-1-2026-06 | cost_sqft_mlit_chakko_2026_01_07.csv | 1,283 | 1,100 | 1,100 | 0 | 表頭・表側 ok 1283 / FAIL 0; 計算値 275/275, note の数 275, 元の行 275; not_set の元セル 0: 183 |
| estat-chakko-t7-1-2026-06 | cost_sqft_mlit_chakko_2026_01_07.csv | 3,311 | 2,876 | 2,876 | 0 | 表頭・表側 ok 3311 / FAIL 0; 計算値 719/719, note の数 719, 元の行 719; not_set の元セル 0: 435 |
| estat-chakko-t6-1-2026-07 | cost_sqft_mlit_chakko_2026_01_07.csv | 1,290 | 1,128 | 1,128 | 0 | 表頭・表側 ok 1290 / FAIL 0; 計算値 282/282, note の数 282, 元の行 282; not_set の元セル 0: 162 |
| estat-chakko-t7-1-2026-07 | cost_sqft_mlit_chakko_2026_01_07.csv | 3,310 | 2,872 | 2,872 | 0 | 表頭・表側 ok 3310 / FAIL 0; 計算値 718/718, note の数 718, 元の行 718; not_set の元セル 0: 438 |
| mlit-deflator-tsuki-2606 | index_mlit_deflator.csv | 11,475 | 11,475 | 11,475 | 0 | 表頭の系列パス ok 11475 / FAIL 0 (同じ表頭が2列ある系列 278 行は列記号で確認); 時点 ok 11475; 四半期値と月別3か月平均の差 0.1 以内 2217, 超え 1, 比較不能 32 |
| mlit-deflator-nendo-260630 | index_mlit_deflator_nendo.csv | 5,460 | 3,919 | 3,919 | 0 | 表頭の系列パス ok 5460 / FAIL 0 (同じ表頭が2列ある系列 140 行は列記号で確認); 時点 ok 5460 |
| mlit-shinei-yosan-r9 | index_mlit_shinei_yosan_fy2027.csv | 200 | 200 | 200 | 0 | pass 200 / FAIL 0 (表頭の順 鉄筋コンクリート造, 鉄骨鉄筋コンクリート造, 鉄骨造, 木造) |
| mlit-gijutsusha-h21 | labor_mlit_gijutsusha_h21.csv | 19 | 19 | 19 | 0 | pass 19 / FAIL 0 |
| mlit-gijutsusha-h22 | labor_mlit_gijutsusha_h22.csv | 19 | 19 | 19 | 0 | pass 19 / FAIL 0 |
| mlit-gijutsusha-h23 | labor_mlit_gijutsusha_h23.csv | 19 | 19 | 19 | 0 | pass 19 / FAIL 0 |
| mlit-gijutsusha-h24 | labor_mlit_gijutsusha_h24.csv | 19 | 19 | 19 | 0 | pass 19 / FAIL 0 |
| mlit-gijutsusha-h25 | labor_mlit_gijutsusha_h25.csv | 19 | 19 | 19 | 0 | pass 19 / FAIL 0 |
| mlit-gijutsusha-h26 | labor_mlit_gijutsusha_h26.csv | 18 | 18 | 18 | 0 | pass 18 / FAIL 0 |
| mlit-gijutsusha-h27 | labor_mlit_gijutsusha_h27.csv | 20 | 20 | 20 | 0 | pass 20 / FAIL 0 |
| mlit-gijutsusha-h28 | labor_mlit_gijutsusha_h28.csv | 20 | 20 | 20 | 0 | pass 20 / FAIL 0 |
| mlit-gijutsusha-h29 | labor_mlit_gijutsusha_h29.csv | 20 | 20 | 20 | 0 | pass 20 / FAIL 0 |
| mlit-gijutsusha-h30 | labor_mlit_gijutsusha_h30.csv | 20 | 20 | 20 | 0 | pass 20 / FAIL 0 |
| mlit-gijutsusha-h31 | labor_mlit_gijutsusha_h31.csv | 20 | 20 | 20 | 0 | pass 20 / FAIL 0 |
| mlit-gijutsusha-r2 | labor_mlit_gijutsusha_r2.csv | 20 | 20 | 20 | 0 | pass 20 / FAIL 0 |
| mlit-gijutsusha-r3 | labor_mlit_gijutsusha_r3.csv | 20 | 20 | 20 | 0 | pass 20 / FAIL 0 |
| mlit-gijutsusha-r4 | labor_mlit_gijutsusha_r4.csv | 20 | 20 | 20 | 0 | pass 20 / FAIL 0 |
| mlit-gijutsusha-r5 | labor_mlit_gijutsusha_r5.csv | 20 | 20 | 20 | 0 | pass 20 / FAIL 0 |
| mlit-gijutsusha-r6 | labor_mlit_gijutsusha_r6.csv | 20 | 20 | 20 | 0 | pass 20 / FAIL 0 |
| mlit-gijutsusha-r7 | labor_mlit_gijutsusha_r7.csv | 20 | 20 | 20 | 0 | pass 20 / FAIL 0 |
| mlit-gijutsusha-r8 | labor_mlit_gijutsusha_r8.csv | 20 | 20 | 20 | 0 | pass 20 / FAIL 0 |
| mlit-roumu-h25 | labor_mlit_roumu_h25.csv | 2,350 | 2,247 | 2,247 | 0 | 横長: セル pass 2247 / FAIL 0; 列見出し ok 50/50; 県ラベル ok 141 / FAIL 0; 下段(参考値) ok 2247 / FAIL 0; 閉じた行の列に数字なし ok 103 / FAIL 0 / 判定不能 0 || 縦長: セル pass 2244 + 近傍列 3 / FAIL 0; 列見出し ok 50/50; 県ラベル ok 235 / FAIL 0; 閉じた行の列に数字なし ok 103 / FAIL 0 / 判定不能 0; 参考値(下段)が頁に 2247/2247 |
| mlit-roumu-h26 | labor_mlit_roumu_h26.csv | 2,350 | 2,265 | 2,265 | 0 | 横長: セル pass 2265 / FAIL 0; 列見出し ok 50/50; 県ラベル ok 141 / FAIL 0; 下段(参考値) ok 2265 / FAIL 0; 閉じた行の列に数字なし ok 85 / FAIL 0 / 判定不能 0 || 縦長: セル pass 2265 / FAIL 0; 列見出し ok 50/50; 県ラベル ok 235 / FAIL 0; 閉じた行の列に数字なし ok 85 / FAIL 0 / 判定不能 0; 参考値(下段)が頁に 2265/2265 |
| mlit-roumu-h27 | labor_mlit_roumu_h27.csv | 2,303 | 2,098 | 2,098 | 0 | 横長: セル pass 2098 / FAIL 0; 列見出し ok 49/49; 県ラベル ok 141 / FAIL 0; 下段(参考値) ok 2098 / FAIL 0; 閉じた行の列に数字なし ok 205 / FAIL 0 / 判定不能 0 || 縦長: セル pass 2098 / FAIL 0; 列見出し ok 49/49; 県ラベル ok 235 / FAIL 0; 閉じた行の列に数字なし ok 205 / FAIL 0 / 判定不能 0; 参考値(下段)が頁に 2098/2098 |
| mlit-roumu-h28 | labor_mlit_roumu_h28.csv | 2,303 | 2,097 | 2,097 | 0 | 横長: セル pass 2097 / FAIL 0; 列見出し ok 49/49; 県ラベル ok 141 / FAIL 0; 下段(参考値) ok 2097 / FAIL 0; 閉じた行の列に数字なし ok 206 / FAIL 0 / 判定不能 0 || 縦長: セル pass 2097 / FAIL 0; 列見出し ok 49/49; 県ラベル ok 235 / FAIL 0; 閉じた行の列に数字なし ok 206 / FAIL 0 / 判定不能 0; 参考値(下段)が頁に 2097/2097 |
| mlit-roumu-h29 | labor_mlit_roumu_h29.csv | 2,256 | 2,133 | 2,133 | 0 | 横長: セル pass 2133 / FAIL 0; 列見出し ok 48/48; 県ラベル ok 141 / FAIL 0; 下段(参考値) ok 2132 / FAIL 0; 閉じた行の列に数字なし ok 123 / FAIL 0 / 判定不能 0 || 縦長: セル pass 2133 / FAIL 0; 列見出し ok 48/48; 県ラベル ok 235 / FAIL 0; 閉じた行の列に数字なし ok 123 / FAIL 0 / 判定不能 0; 参考値(下段)が頁に 2132/2132 |
| mlit-roumu-h30 | labor_mlit_roumu_h30.csv | 2,256 | 2,128 | 2,128 | 0 | 横長: セル pass 2128 / FAIL 0; 列見出し ok 48/48; 県ラベル ok 141 / FAIL 0; 下段(参考値) ok 2127 / FAIL 0; 閉じた行の列に数字なし ok 128 / FAIL 0 / 判定不能 0 || 縦長: セル pass 2128 / FAIL 0; 列見出し ok 48/48; 県ラベル ok 235 / FAIL 0; 閉じた行の列に数字なし ok 128 / FAIL 0 / 判定不能 0; 参考値(下段)が頁に 2127/2127 |
| mlit-roumu-h31 | labor_mlit_roumu_h31.csv | 2,303 | 2,114 | 2,114 | 0 | 横長: セル pass 2114 / FAIL 0; 列見出し ok 49/49; 県ラベル ok 141 / FAIL 0; 下段(参考値) ok 2114 / FAIL 0; 閉じた行の列に数字なし ok 189 / FAIL 0 / 判定不能 0 || 縦長: セル pass 2114 / FAIL 0; 列見出し ok 49/49; 県ラベル ok 235 / FAIL 0; 閉じた行の列に数字なし ok 189 / FAIL 0 / 判定不能 0; 参考値(下段)が頁に 2114/2114 |
| mlit-roumu-r2 | labor_mlit_roumu_r2.csv | 2,350 | 2,123 | 2,123 | 0 | 横長: セル pass 2123 / FAIL 0; 列見出し ok 50/50; 県ラベル ok 141 / FAIL 0; 下段(参考値) ok 2123 / FAIL 0; 閉じた行の列に数字なし ok 227 / FAIL 0 / 判定不能 0 || 縦長: セル pass 2123 / FAIL 0; 列見出し ok 50/50; 県ラベル ok 235 / FAIL 0; 閉じた行の列に数字なし ok 227 / FAIL 0 / 判定不能 0; 参考値(下段)が頁に 2123/2123 |
| mlit-roumu-r3 | labor_mlit_roumu_r3.csv | 2,350 | 2,120 | 2,120 | 0 | 横長: セル pass 2120 / FAIL 0; 列見出し ok 50/50; 県ラベル ok 141 / FAIL 0; 下段(参考値) ok 2120 / FAIL 0; 閉じた行の列に数字なし ok 230 / FAIL 0 / 判定不能 0 || 縦長: セル pass 2120 / FAIL 0; 列見出し ok 50/50; 県ラベル ok 235 / FAIL 0; 閉じた行の列に数字なし ok 230 / FAIL 0 / 判定不能 0; 参考値(下段)が頁に 2120/2120 |
| mlit-roumu-r4 | labor_mlit_roumu_r4.csv | 2,350 | 2,125 | 2,125 | 0 | 横長: セル pass 2125 / FAIL 0; 列見出し ok 50/50; 県ラベル ok 141 / FAIL 0; 下段(参考値) ok 2125 / FAIL 0; 閉じた行の列に数字なし ok 225 / FAIL 0 / 判定不能 0 || 縦長: セル pass 2125 / FAIL 0; 列見出し ok 50/50; 県ラベル ok 235 / FAIL 0; 閉じた行の列に数字なし ok 225 / FAIL 0 / 判定不能 0; 参考値(下段)が頁に 2125/2125 |
| mlit-roumu-r5 | labor_mlit_roumu_r5.csv | 2,350 | 2,127 | 2,127 | 0 | 横長: セル pass 2127 / FAIL 0; 列見出し ok 50/50; 県ラベル ok 141 / FAIL 0; 下段(参考値) ok 2127 / FAIL 0; 閉じた行の列に数字なし ok 223 / FAIL 0 / 判定不能 0 || 縦長: セル pass 2127 / FAIL 0; 列見出し ok 50/50; 県ラベル ok 235 / FAIL 0; 閉じた行の列に数字なし ok 223 / FAIL 0 / 判定不能 0; 参考値(下段)が頁に 2127/2127 |
| mlit-roumu-r6 | labor_mlit_roumu_r6.csv | 2,350 | 2,148 | 2,148 | 0 | 横長: セル pass 2148 / FAIL 0; 列見出し ok 50/50; 県ラベル ok 141 / FAIL 0; 下段(参考値) ok 2148 / FAIL 0; 閉じた行の列に数字なし ok 202 / FAIL 0 / 判定不能 0 || 縦長: セル pass 2148 / FAIL 0; 列見出し ok 50/50; 県ラベル ok 235 / FAIL 0; 閉じた行の列に数字なし ok 202 / FAIL 0 / 判定不能 0; 参考値(下段)が頁に 2148/2148 |
| mlit-roumu-r7 | labor_mlit_roumu_r7.csv | 2,350 | 2,177 | 2,177 | 0 | 横長: セル pass 2177 / FAIL 0; 列見出し ok 50/50; 県ラベル ok 141 / FAIL 0; 下段(参考値) ok 2177 / FAIL 0; 閉じた行の列に数字なし ok 173 / FAIL 0 / 判定不能 0 || 縦長: セル pass 2177 / FAIL 0; 列見出し ok 50/50; 県ラベル ok 235 / FAIL 0; 閉じた行の列に数字なし ok 173 / FAIL 0 / 判定不能 0; 参考値(下段)が頁に 2177/2177 |
| mlit-roumu-r8 | labor_mlit_roumu_r8.csv | 2,350 | 2,136 | 2,136 | 0 | 参考公表(参1-参3): セル pass 2136 / FAIL 0; 列見出し ok 50/50; 県ラベル ok 141 / FAIL 0; 下段(参考値) ok 2136 / FAIL 0; 閉じた行の列に数字なし ok 214 / FAIL 0 / 判定不能 0; 参考値(下段)が頁に 2136/2136 |
| cgr-zairyo-r8-04 | material_cgr_zairyo_r8_04.csv | 18,123 | 11,041 | 11,041 | 0 | セル pass 11041 / FAIL 0; 列見出し ok 693/693; 行ラベル 一致 2699, 数字のみ一致 295, 未確認 14; 閉じた行の列に数字なし ok 1890 / FAIL 0 / 判定不能 5192 |
| cgr-zairyo-as-r8-06 | material_cgr_zairyo_r8_04.csv | 1,932 | 941 | 941 | 0 | セル pass 941 / FAIL 0; 列見出し ok 69/69; 行ラベル 一致 115, 数字のみ一致 0, 未確認 0; 閉じた行の列に数字なし ok 646 / FAIL 0 / 判定不能 345 |
| hkd-zairyo-r8-09 | material_hkd_zairyo_r8_09.csv | 45,320 | 44,492 | 44,492 | 0 | セル pass 44492 / FAIL 0; 列見出し ok 520/520; 行ラベル 一致 4523, 数字のみ一致 0, 未確認 0; 閉じた行の列に数字なし ok 738 / FAIL 0 / 判定不能 90 |
| hrr-zairyo-r8-09 | material_hrr_zairyo_r8_09.csv | 4,947 | 4,947 | 4,947 | 0 | セル pass 4947 / FAIL 0; 列見出し ok 391/391; 行ラベル 一致 901, 数字のみ一致 0, 未確認 0 |
| kkr-zairyo-r8-09 | material_kkr_namacon_r8_09.csv | 846 | 846 | 846 | 0 | セル pass 846 / FAIL 0; 列見出し ok 82/82; 行ラベル 一致 256, 数字のみ一致 0, 未確認 0 |
| kkr-zairyo-r8-09 | material_kkr_zairyo_r8_09.csv | 24,197 | 17,322 | 17,322 | 0 | セル pass 17322 / FAIL 0; 列見出し ok 1035/1035; 行ラベル 一致 1707, 数字のみ一致 1, 未確認 0; 閉じた行の列に数字なし ok 1712 / FAIL 0 / 判定不能 5163 |
| ktr-zairyo-r8-04 | material_ktr_zairyo_r8_04.csv | 4,077 | 3,420 | 3,420 | 0 | セル pass 3420 / FAIL 0; 列見出し ok 225/225; 行ラベル 一致 936, 数字のみ一致 68, 未確認 21; 閉じた行の列に数字なし ok 402 / FAIL 0 / 判定不能 255 |
| ogb-zairyo-r8-04 | material_ogb_zairyo_r8_04.csv | 515 | 512 | 512 | 0 | セル pass 512 / FAIL 0; 列見出し ok 72/72; 行ラベル 一致 412, 数字のみ一致 0, 未確認 0; 閉じた行の列に数字なし ok 0 / FAIL 0 / 判定不能 3 |
| qsr-zairyo-r8-09 | material_qsr_zairyo_r8_09.csv | 22,514 | 22,513 | 22,513 | 0 | セル pass 22513 / FAIL 0; 列見出し ok 1505/1505; 行ラベル 一致 4210, 数字のみ一致 14, 未確認 5; 閉じた行の列に数字なし ok 1 / FAIL 0 / 判定不能 0 |
| mlit-reform-fy2025 | spending_mlit_reform_fy2025.csv | 804 | 616 | 616 | 0 | 見出し ok 804 / FAIL 0; note の生値 ok 616; 前年度比 ok 91 / FAIL 0; not_set の元セル 0: 184, 空欄 4 |
| mlit-sekou-package-r8-04 | work_mlit_sekou_package_r7_04.csv | 9,277 | 9,177 | 9,177 | 0 | 条件 ok 9177 / FAIL 0; 物価資料等による 100 件はシートに数字なし; PDF 文字の該当頁に値 9177 / 無し 0 |
| mlit-sekou-package-r8-04 | work_mlit_sekou_package_ratio_r7_04_p1.csv | 40,150 | 40,150 | 40,150 | 0 | 条件 ok 40150 / FAIL 0; 物価資料等による 0 件はシートに数字なし; PDF 文字の該当頁に値 40150 / 無し 0 |
| mlit-sekou-package-r8-04 | work_mlit_sekou_package_ratio_r7_04_p2.csv | 39,505 | 39,505 | 39,505 | 0 | 条件 ok 39505 / FAIL 0; 物価資料等による 0 件はシートに数字なし; PDF 文字の該当頁に値 39505 / 無し 0 |
| mlit-shinei-yosan-r9 | work_mlit_shinei_yosan_fy2027.csv | 432 | 217 | 217 | 0 | セル pass 217 / FAIL 0; 列見出し ok 24/24; 行ラベル 一致 82, 数字のみ一致 39, 未確認 0; 閉じた行の列に数字なし ok 0 / FAIL 0 / 判定不能 215 |
| 計 | | 299,517 | 273,760 | 273,760 | 0 | |

## 方法

- estat-chakko-t6-1-*, estat-chakko-t7-1-*: 2 = xlrd でセル値(source_page のセル)。1m2 あたりは2つのセルから 工事費x10000÷床面積 を1円未満四捨五入で計算し直し、note の2つの数と割る前の行 obs_id の値とも照合。3 = 表側(B列)=area_label、表頭(5行目の構造、左へ結合をたどる)と6行目の項目=spec の「」。closed 行はセルが 0 / ＊ / - / 空欄か。
- mlit-deflator-tsuki-*, mlit-deflator-nendo-260630: 2 = openpyxl でセル値を表示書式の桁で四捨五入。3 = 3〜10行目の表頭(連続重複を除く)=spec のパス、A/B 列=period。四半期は月別の同じ系列の3か月平均とも比べる。
- mlit-shinei-yosan-r9 (第１ 地域別工事費指数): 2 = pdftotext -layout の該当頁の数字(桁区切り・全角・末尾0を正規化)。3 = 縦書きの表頭を bbox で列ごとに束ねて構造の順(RC, SRC, S, W)を読み、地域名の後の4つの数がその順の CSV 値と一致するか。
- mlit-gijutsusha-*: 2 = pdftotext -layout の該当頁の数字(桁区切り・全角・末尾0を正規化)。3 = -layout の行: 区分(①〜④)の中で職種名の行を探し、その行の1つ目の数=基準日額、2つ目=割増対象賃金比(ref_value)。
- mlit-roumu-*: 2 = pdftotext -layout の該当頁の数字(桁区切り・全角・末尾0を正規化)。横長と縦長の2頁とも。3 = bbox 座標: 列=職種、行=都道府県。横長の表と縦長の表の両方で、値が職種の列・県の行にあるか、見出しに職種名、県ラベルが最も近いか、横長の表は下段(括弧)が参考値か。
- mlit-roumu-h29: 2 = pdfplumber(pdfminer)の該当頁の文字(poppler はこの PDF のフォントを読めない)。横長と縦長の2頁とも。3 = bbox 座標: 列=職種、行=都道府県。横長の表と縦長の表の両方で、値が職種の列・県の行にあるか、見出しに職種名、県ラベルが最も近いか、横長の表は下段(括弧)が参考値か。
- cgr-zairyo-r8-04, cgr-zairyo-as-r8-06, hkd-zairyo-r8-09, hrr-zairyo-r8-09, kkr-zairyo-r8-09, ktr-zairyo-r8-04, ogb-zairyo-r8-04, qsr-zairyo-r8-09: 2 = pdftotext -layout の該当頁の数字(桁区切り・全角・末尾0を正規化)。3 = bbox 座標: 値の列(地区)を票決で決め、同じ印刷行の値が1行に並ぶか、列見出しに地区名があるか、空欄の列に数字が無いか、行の文字に規格があるか。
- mlit-reform-fy2025: 2 = openpyxl でセル値を表示書式の桁で四捨五入。note の丸める前の値=セルの値。3 = 表側「」の語が行見出し(結合セルを展開、左の列から階層)に、表頭「」の語が列見出しに、住宅/非住宅の区分が B 列の直近の表題にあるか。前年度比(ref_value)は右隣のセル。
- mlit-sekou-package-r8-04: 2 = openpyxl でセル値(シート・行は source_page、列は 標準単価 / 構成比の見出し K,R,Z,S と K1〜Z4)を表示書式の桁で四捨五入。3 = spec の条件「名：値」がその行の条件列と一致し、spec に無い条件はその行で「-」。値の列は見出しで決める。副: Apify の PDF 文字抽出の該当頁に値があるか。
- mlit-shinei-yosan-r9 (第２ 標準予算単価): 2 = pdftotext -layout の該当頁の数字(桁区切り・全角・末尾0を正規化)。3 = bbox 座標(列=番号(1)〜、行=工事区分)。見出しに番号、行の文字に区分名。

### 3 の座標による方法(PDF の表)の詳細

1. 頁の語を `pdftotext -bbox`(h29 は pdfplumber)で取り、数字の語の値・左端・右端・中心・y を持つ。
2. 列の位置: 同じ頁・同じ地区(労務単価は職種)の CSV のセルが、自分の値を持つ語の右端(または中心)に票を入れ、最多の x をその地区の列とする。同じ値が隣の列にもあって票が割れたときは、その x の上の見出しに地区名がある方を取り、他の地区が取った x は使わない。右端と中心のどちらで揃う表かは列ごとに支持の多い方。
3. 行: 同じ印刷行(区分・品目・規格・単位が同じ。労務単価は県)のセルが、自分の列の位置で自分の値を持つ語の y を1つの行として共有しているか。候補の行が複数あるときは、閉じたセルの列に数字が無い行、行の文字に規格がある行を選ぶ。
4. 閉じたセル(not_set など): 選んだ行のその地区の列に数字が無いこと。
5. 見出し: 列の上の語をつなげた文字に area_label の最後の語(地区名)か area_code が含まれること。局一律の表(関東の「関東地方整備局」)は見出しが「単価」、中国の局統一単価(「中国統一」)は note のとおり「報告価格(2026.3)」の列であること。
6. 行の文字: その行の値より左の語(±9pt)に spec の [ ] より前の文字が含まれること。含まれない時は spec の数字がすべてその行にあるか(数字のみ一致)。
7. 労務単価はさらに、行に最も近い県名がその行の県であること、横長の表では下段の括弧の数が同じ列で ref_value と一致すること。

## 検出力の試験(注入)

CSV の行をメモリ上で書き換え(ファイルは触らない)、同じ検査が捕まえるかを数えた。乱数の種は固定。

| 注入 | 検出 / 注入数 |
|---|---:|
| PDF: 同じ印刷行の2つの地区の値を入れ替える | 1398 / 1398 |
| PDF: 値を同じ行の空欄の地区へ移す | 892 / 892 |
| PDF: 頁の2つの地区のラベルを全行で入れ替える | 252 / 252 |
| PDF: 同じ地区の2つの印刷行の値を入れ替える | 1153 / 1159 |
| 着工統計: 2行の値を入れ替える | 90 / 90 |
| 着工統計: 別の県の area_label にする | 100 / 100 |
| デフレーター: 隣の列の系列名にする | 99 / 99 |
| デフレーター: 時点を1か月ずらす | 100 / 100 |
| リフォーム: 同じシートの2行の spec を入れ替える | 121 / 122 |
| 施工パッケージ: 構成比の記号を次の記号にする(K1→K2 等) | 100 / 100 |
| 施工パッケージ: 同じシートの2行の条件を入れ替える | 128 / 128 |

見逃しは、同じ行の値の並びがほぼ同じ2行で規格の文字も数字だけ一致の行(M4 の 6 件)と、表側・表頭の語が同じ語を含み合う2行(E5 の 1 件)。

## 1. 原本の同一性

JP の台帳 66 件。raw/、raw_restricted/、/home/claude/work/src/ の全ファイルの sha256 を計算し、台帳の sha256 と bytes に照らした。全件一致。

- mlit-roumu-r8: raw/ に無い。/home/claude/work/src/mlit_roumu_r8_001981942.pdf が一致
- nara-shizai-r8-09: raw/ に無い。/home/claude/work/src/nara_r8_09_material.pdf が一致
- 手元に無い: notice PDF https://www.mlit.go.jp/tec/content/001989802.pdf(PDF bytes not in environment; ledger sha is only the downloader-reported value)
- 施工パッケージの関連ファイル(参考資料 xlsx、代表材料規格 PDF、PDF 文字抽出 txt)は台帳の sha256 と一致。

## 4. 閉じた行と restricted

- 全 JP 行 322,493(observations/jp、observations_restricted/jp、observations_hold/jp)。開いた行 274,750 はすべて値あり、閉じた行 47,743 はすべて値なし。行の license はすべて台帳の license と一致。
- restricted の台帳: cbr-zairyo-r8-10, mtdot-wavg-2025, nara-shizai-r8-09, sddot-bid-item-2024, skr-zairyo-r8-10, thr-zairyo-r8-04。どれも values_copied=false。JP の restricted 4 出典の行 21,986 はすべて閉じた状態で price も ref_value も空。
- 閉じた行に ref_value がある行が 4,749 行ある。すべて「原本の値は 0」を示す ref_value=0(着工統計 4,743、新営予算単価 6)。
- 問題: 0 件。

## ファイル

- `results.json`: 出典ごとの表と全ての数え、不一致の一覧(空)、注入試験の結果。
- 詳細: `identity.json`, `pdf_exist.json`, `pdf_grid_all.json`, `pdf_small.json`, `excel.json`, `sekou_pdftext.json`, `closed.json`, `mutation.json`, `mutation_excel.json`, `rowlabel_manual_review.txt`。
- スクリプト: `v1_identity.py`(1)、`v1_pdf_exist.py`(2 PDF)、`v1_pdf_grid.py`(3 PDF の表)、`v1_pdf_small.py`(3 技術者単価・新営)、`v1_excel.py`(2+3 Excel)、`v1_sekou_pdftext.py`(施工パッケージ副)、`v1_closed.py`(4)、`v1_mutation.py` と `v1_mutation_excel.py`(検出力)、`v1_report.py`(この報告)。
