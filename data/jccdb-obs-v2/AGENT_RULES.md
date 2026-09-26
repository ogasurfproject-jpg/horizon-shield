# 観測層 v2 に原本を取り込む手順と掟(全員共通。最初に全部読むこと)

作業の根: /home/claude/work/obs2 (以下 OBS2)。道具: OBS2/tools/obs_common.py(列・許可一覧・make_id・clean・num・pref・write_obs)、OBS2/tools/validate_obs.py(検査器)。
形の見本: OBS2/observations/jp/*.csv と OBS2/sources/*.json(v1 から移したもの。検査器は緑)。
座標で表を読む parser の見本: /home/claude/work/jccdb_up/tools/parse_kkr_namacon.py(近畿地整の生コン)と parse_mlit_roumu.py(労務単価)。

## 1. 原本の取り方(この作業環境は官公庁・米政府のサイトに直接届かない)

- WebSearch / WebFetch は「どこに何があるか」を探すのに使ってよい。ただし数字を WebFetch の要約から写してはならない(要約は表の列を入れ替える。実際に3回起きた)。
- 原本のバイト列は Apify で取る:
  1. mcp__Apify__apify--web-fetch に url と formats=["raw"](HTML の頁なら ["html"] か ["markdown"] も可)、waitSecs=45。
  2. 返ってきた datasetId で mcp__Apify__get-dataset-items を fields="raw,fetch.contentLengthBytes,fetch.contentType,metadata.headers.last-modified" で呼ぶ。大きいので結果はファイルに保存されたと言われる(パスが出る)。小さくてファイルに落ちないときは fields に "raw,text,html,markdown" を足して大きくする。
  3. python3 OBS2/tools/apify_raw_to_file.py <保存された結果ファイル> <置き場所> で原本を復元する。bytes と sha256 と last-modified が出る。bytes が content_length_header と一致すること。先頭が %PDF(PDF)/ PK(xlsx, zip)であること。
- 原本の置き場所: 再配布できる出典(PDL1.0 / CC BY / 米連邦の公有)は OBS2/raw/<source_id>.<拡張子>。再配布できない出典は OBS2/raw_restricted/<source_id>.<拡張子>(リポには入れない)。
- 取れなかったら、試した URL と返ってきたもの(ステータス、中身の先頭)を報告に書く。推測で埋めない。
- 1つの出典に何十回も取りに行かない。1回取って sha256 を記録し、以後は手元のファイルを読む。

## 2. 読み方(要約を通さない)

- PDF: pdftotext -layout で頁の構造を見て、値は pdftotext -bbox-layout の語の座標で列に割り当てる。列の見出しの x 中心と値の x 中心の距離を全セルで測り、最大値を報告する。
- Excel: openpyxl(pip install --break-system-packages openpyxl が要れば入れる)でセルを直接読む。結合セルに注意。
- CSV / JSON(API): そのまま読む。応答は保存して sha256 を取る。
- 必ず「別の読み方で数える」照合を1つ以上入れる(例: 頁ごとの行数と表の行番号、同じ値が別の組版で載っていればその一致、合計行との一致、pdftotext -layout の行と bbox の行の件数一致)。照合の結果を数字で報告する。
- 画像だけの PDF(文字が取れない)は取り込まない。「画像で文字が取れない」と報告する。OCR で値を作らない。

## 3. 利用条件(値を入れてよいか)

- 出典ごとに、そのサイトの利用規約・著作権の頁を Apify で取り、条文をそのまま license_quote に写す(要約しない)。license_url も書く。
- 値(price)を入れてよいのは:
  - 日本: 公共データ利用規約(PDL1.0)→ license "PDL1.0"、status "published_pdl"。政府標準利用規約(第2.0版)→ "GOV-STD-2.0"、status "published_cc_by"。CC BY 4.0 と明記 → "CC-BY-4.0"、status "published_cc_by"。
  - 米国: 連邦政府の著作物(17 U.S.C. 105)→ "US-PD-17USC105"、status "public_domain"。州などで、再利用を明示的に許す条文がある → "OPEN-TERMS"、status "published_open_terms"(条文を license_quote に)。
- 上以外(私的使用・引用のみ、複製禁止、許可が要る、条件が見つからない)は license "restricted"、values_copied false、price は空、status は published_restricted_not_copied / publication_based_not_public / not_set のどれか。条件が見つからないときも restricted 扱い(分からないものは開けない)。
- 市販の物価資料(建設物価、積算資料、RSMeans、ENR の有料部分 など)とその値を写した表は、値を入れない(publication_based_not_public)。
- 表の中に「物価資料の値」「刊行物」「○」などで市販資料由来と示されたセルは、出典の利用条件が開いていても値を入れない。

## 4. 書き方

- 1出典 = 台帳1ファイル: OBS2/sources/<source_id>.json。必須の欄は validate_obs.py の LEDGER_REQUIRED(source_id, country, title, publisher, url, retrieved_at, license, license_url, license_quote, how_read, values_copied)と sha256(原本か保存した API 応答のバイト列)。帰属表示が要る条件なら attribution(例: 「出典：〇〇ホームページ(URL)を加工して作成」/ "Source: ...")。あれば landing, published, effective_from, bytes, http_last_modified, fetched_via, scope_quote, area_quote も。
- source_id は小文字・数字・ハイフン(例: ktr-zairyo-r8-09, bls-ppi-wpuip2312001)。
- 観測は OBS2/observations/jp/ か us/ に、layer_出典_時点.csv の名前で(例: material_ktr_zairyo_r8_09.csv)。書くのは必ず obs_common.write_obs で(列の並び・禁止文字の置き換え・ID の重複検査をする)。
- obs_id = make_id(source_id, その出典の中で行を一意に決める値...)。同じ入力なら何度作っても同じ ID になるように(ページ番号・地区・品目・規格など)。
- 列の意味は OBS2/SCHEMA.md。迷ったら SCHEMA.md に従う。
- 許可一覧(layer, price_basis, geo_level)に無い値が要るときは obs_common.py を書き換えず、OBS2/tools/extra_enums/<自分の担当名>.json に {"price_basis": [{"value": "...", "why": "..."}]} の形で足す。
- 数は obs_common.num で正規化(桁区切りを取る、全角を半角に)。単価は原本の単位のまま(円/m3、円/t、USD/hour など)。
- 地区: 原本の地区表示を area_label にそのまま。地区コードがあれば area_code。地区に含まれる市町村の文言が原本にあれば area_members に原文のまま。都道府県が決まれば geo_code(JIS 2桁)と geo_name(obs_common.pref で)。
- 規格(spec)は原本の文字のまま(全角も)。ただし em/en ダッシュと水平線は clean が '-' に置き換える(出力に出さない約束)。
- note に、その行を読むときに必要な注意(消費税抜き、物価資料に無い地区だけ、など)を短く。

## 5. 検査

- 書いたら必ず: python3 OBS2/tools/validate_obs.py OBS2 --only observations/<自分のファイル> ...
  誤り 0 になるまで直す。自分の出典の台帳も検査対象(台帳は全部読まれる)。
- 自分のファイル以外(他の担当のファイル、obs_common.py、validate_obs.py)は書き換えない。
- parser は OBS2/tools/parsers/<名前>.py に置き、もう一度走らせれば同じ CSV が出るようにする(入力は OBS2/raw か raw_restricted の原本)。

## 6. 文字の約束

- 出力(ファイルも報告も)に em ダッシュ(U+2014)・en ダッシュ(U+2013)・水平線(U+2015)を使わない。ハイフン、〜、⇔ は可。
- 報告は日本語の標準語で、結論から。お世辞は書かない。

## 7. 報告

- 詳しい報告を OBS2/reports/<担当名>.md に書く: 取った出典(URL, sha256, bytes, 利用条件の判断と根拠の条文)、作ったファイルと行数、status 別の行数、照合の方法と結果の数字、取れなかったもの(試した URL と理由)、気づいた原本の誤植らしきもの、次に取るべきもの。
- 最後の返答(親に返すもの)は 250 語以内: 作ったファイルと行数、検査器の結果、照合の結果、取れなかったもの。長い表は報告ファイルに。

## 8. 取得の技(2026-09-26 前半の担当が確かめたこと。必ず読む)

- apify/web-fetch の formats=["raw"] は、Content-Type が PDF・octet-stream・zip なら base64 で正しく返す(sha256 を原本と照合済み)。
- **xls / xlsx(application/vnd.ms-excel 等)は web-fetch raw だと文字として読み替えられて壊れる**(先頭が EF BF BD。長さは一致してしまうので気づきにくい)。xls/xlsx は apify/website-content-crawler(crawlerType "cheerio"、saveFiles か saveContentTypes を指定)で key-value store に置かせ、mcp__Apify__get-key-value-store-record で受け取る。ただし MCP で受け取れるのは約 256KB まで(それを超えると api.apify.com の署名つき URL だけが返り、この環境から api.apify.com には届かない)。
- 1 つのデータ項目は約 9.4MB が上限。大きいファイルは web-fetch に headers {"Range": "bytes=0-3999999"} などを渡して分割で取り、つなぐ(HTTP 206、同じ ETag、Content-Range の全長 = 連結後の bytes、zip なら testzip で CRC を確かめる)。サーバーが Range に応じない場合は取れない。
- 取れない原本は、同じ中身の別の形(CSV / JSON API / 別の年版 / 別の組版の PDF)を探す。探しても無ければ、試した URL と理由を報告に書く。推測で値を作らない。
- 米国の Socrata 系オープンデータポータル(data.*.gov)は /resource/<id>.json?$limit=...&$offset=... や /api/views/<id>/rows.csv で取れる。ポータルの利用条件と、データセットごとの license 欄の両方を写す。
- 同じ source_id の台帳を2人が書かないように、自分の担当名を source_id の先頭の系統名にそろえる(他の担当の台帳は書き換えない)。
