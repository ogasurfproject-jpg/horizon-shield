# Google 索引の立て直し 決裁票(2026-09-13)

作業者: 番人(設計・検証のみ)。適用・commit・push・GSC/Bing の操作は TOshi。

## 診断(GSC 書き出し 09-13 の実測)

- 索引 22 / クロール済み未登録 386 / 検出未クロール 352。
- Google は無視していない。09-04/06 に登録リクエストした本命(トップ・gaiheki-150man・kyutoki・faq 3 本)は翌日クロールされ、索引段階で却下された。=サイト単位の品質保留。
- 386 のうち 165 は県別スタブ(既に noindex)。5 月の判定のまま残留。208 は 5〜6 月に見て却下したまま二度と来ていない。
- 352 の急増は 8 月下旬。8/8 の 227 ページ生成展開+sitemap 606 本と時期一致。クロール需要は 1 日約 3 本。外部被リンク 0 本。
- sitemap.xml の中に、noindex の転送スタブ 5 本と、ファイルが無い 404 が 8 本(ボット生成の hash 名 yakumo ページ)が混ざっていた。
- 再送信・Validate Fix・ページ増産は逆効果(保留を深める)。Google に苦情窓口は無い。

## 打ち手(この決裁票で適用するもの)

### A. sitemap.xml を 606 本から 115 本(コア)に絞る

- 残す 115: トップ、/kantei/、/hs-reverse-estimate/、監視 15 問の正本、souba ハブ 23、blog 59(Google が却下していない唯一の群)、法務(privacy/tokusho/tos)、about-founder、実例(jireishuu)、根拠(souba-konkyo)、施工不良(inspect)、工務店向け(biz)、ehn/hacker/guide/verify-directory/yakumo の入口。
- 外す 491: souba 189(県別・条件別)、aeo 89、qa 56、yakumo 40、faq 29、llmo 21、webmcp 11、ehn 10、verify-directory 9、guide 4、hacker 2、単独ページ 31(英語版、旧入口、重複 .html 版、ウィジェット等)。
- noindex は当てない。ページは全部そのまま残る。内部リンクからは今まで通り辿れる。Bing の索引(151 クリック/2.1K 表示、ChatGPT 検索・Copilot の入口)は殺さない。
- 外した生きページは 2 本の別 sitemap に移す。robots.txt には載せない。Bing Webmaster にだけ手で出す。
  - sitemap-archive.xml = 446 本(yakumo 以外)
  - sitemap-yakumo.xml = 32 本(yakumo。以後ボットの追記先)
- noindex 5 本と 404 の 8 本は、どの sitemap にも入れない。
- 一覧: ops/sitemap_kept_20260913.txt(残す)/ ops/sitemap_removed_20260913.txt(外す)/ allowlist は ops/sitemap_core_20260913.txt
- 台本: ops/sitemap_shrink.py(既定 dry-run。--apply で sitemap.xml.<日時>.bak を残して書く。件数 assert つき。別 ROOT の写しで --apply を通し、3 本とも整形式 XML を確認済み)

### B. ボットが sitemap.xml を埋め戻すのを塞ぐ(適用済み・未 commit)

- tools/yakumo/generate.py の update_sitemap(): 追記先を sitemap.xml から sitemap-yakumo.xml へ。無ければ作る。(.bak あり。写しで動作確認: 2 本追記、重複 0、整形式)
- data/industries/registry.json の also_commit: sitemap.xml を sitemap-yakumo.xml へ。(.bak あり。JSON 妥当)
- これを入れないと、加盟店の回答が来るたびに sitemap.xml が太り、A が数週間で元に戻る。

### C. 重複 gaiheki-150man-takai の統合(適用済み・未 commit)

- souba/gaiheki-150man-takai/index.html: canonical を /souba/gaiheki-150man/ へ。noindex は付けない(canonical と noindex の併用は Google が嫌う)。(.bak あり)
- souba/index.html: takai への重複リンク 1 行を外す(150man へのリンクは残る)。(.bak あり)
- 09-04 の割当表どおり正本は /souba/gaiheki-150man/。

### D. 被リンク(TOshi の手)

- ops/backlink_requests_20260913.md に、リフォーム職人株式会社(堤様/森下様)とミネオトーヨー住器(峰尾様)への依頼文、自前資産(note/LinkedIn/GitHub/X)からのリンク先一覧。
- 0 本のままだと A〜C を入れても巡回が増えない。これが本丸。

## Bing を壊さない保証(実測つき)

- 外す 491 本のうち生きページ 478 本は、URL も本文も robots meta(index,follow)も一切変えない。200 のまま。Bing の索引は「ページが消えた/noindex になった/404 になった」ときに落ちる。どれも起きない。
- 内部リンクの変更は 1 か所だけ(souba ハブの takai 重複リンク 1 行)。他のリンクは全部そのまま。
- 実測: 478 本のうち 332 本は他のページから内部リンクで辿れる。**146 本は sitemap.xml にしか載っていなかった孤立ページ**(診断レシート 16、souba 条件別 35、faq 28、llmo 21、webmcp 11、yakumo 22、他 13)。この 146 本を Bing から見えなくせんために、sitemap-archive.xml と sitemap-yakumo.xml を Bing Webmaster に手で出す。これは任意やない、必須。
- 押さえ: 押さえとして push 後に IndexNow(Bing 側だけの仕組み。Google は読まない)で 478 本を一度叩く。既存の indexnow_submit.py(既定 dry-run、200 と moat 漏れの関所つき)を使う。
- robots.txt は触らない(Sitemap: 行は sitemap.xml のまま)。Google に見せる面だけが 606 から 115 に減り、Bing に見せる面は 115+446+32=593(=生きページ全部)で今と同じ。
- Bing の数字(151 クリック/2.1K 表示)を週 1 で見る。落ちたら archive を robots.txt に戻す(1 行足すだけ、5 分で元に戻る)。

IndexNow の手順は下の「第 5 段」。

## 決裁で見てほしい点(3 つだけ)

1. 外す 491 本の中に「これは Google に出したい」があるか。ops/sitemap_removed_20260913.txt を眺めて、あれば ops/sitemap_core_20260913.txt に 1 行足して dry-run をやり直す。
2. 残す単独ページ 5 本(privacy / jireishuu.html / inspect.html / souba-konkyo.html / biz)を番人判断で足した。要らなければ allowlist から消す。
3. 英語ページ(index_en / faq_en / statistics_en / jireishuu_en / evidence-en / movement-us / proposal-en / ehn-en)は全部外した。英語圏の Google を今狙うなら戻す。

## 先にやること(作業ツリーの状態)

- ローカル main は origin より 1 コミット進み(7a83ea01 kira-group 添付読み取り、未 push)、1 コミット遅れ(0bb0c079 ボットの posted_titles)。先に rebase で揃える。
- ダッシュ置換の未 commit 変更が 85 ファイルある(admin/ ehn/ workers/ souba/ 等、442 行)。番人は触っていない。今回の git add には含めない。別 commit にするか捨てるかは TOshi。
- 番人の git 操作の残骸: .git/index.lock.stale_20260913(空)と .git/objects/*/tmp_obj_*(fetch の一時)。消してよい。

## 番人が 09-13 に自分の手でやった分(TOshi の「お前の手はない?」を受けて)

- sitemap_shrink.py --apply を本番の作業ツリーで実行済み。sitemap.xml 115 / sitemap-archive.xml 446 / sitemap-yakumo.xml 32、3 本とも整形式 XML を確認。バックアップ sitemap.xml.20260913-064513.bak。
- 上の A〜C と台本 2 本(GSC 送信・Bing 登録)を、番人がローカルで 1 コミットにまとめた(個別 git add、ダッシュ置換の 85 ファイルは入れていない)。push はしていない。
- 残りは「ネットワークに出す操作」だけ = pull --rebase / push / GSC 送信 / Bing 登録 / IndexNow / 被リンク。全部ターミナルで打てる形にした。

## コマンド(zsh。上から順に。コメント行は入れてへん)

第 1 段: 反映(2 分)

cd ~/horizon-shield
git log --oneline -3
git pull --rebase --autostash origin main
git log --oneline -3
git push origin main

期待値: 1 回目の git log の先頭が「seo: sitemap.xml を 606 から 115 のコアに縮小」の commit。pull 後も同じ commit が先頭に残り、その下に 0bb0c079(ボット)が入る。conflict が出たら止めて番人に言う(出ない見込み: 触っている場所が別)。

第 2 段: 本番に出たか確認(push の 5〜10 分後)

curl -s https://shield.the-horizons-innovation.com/sitemap.xml | grep -c '<loc>'
curl -s https://shield.the-horizons-innovation.com/sitemap-archive.xml | grep -c '<loc>'
curl -s https://shield.the-horizons-innovation.com/sitemap-yakumo.xml | grep -c '<loc>'

期待値: 115 / 446 / 32。

第 3 段: Google に sitemap.xml を再送信(gsc_check.py と同じ OAuth。初回だけブラウザが開いて許可を聞く)

cd ~/horizon-shield
python3 ops/gsc_sitemap_submit.py
python3 ops/gsc_sitemap_submit.py --send

期待値: 送信後の一覧に sitemap.xml が「送信URL 115」で出る(GSC 側の反映は数時間〜1 日遅れることがある。pending=True なら待つ)。
GSC が「ドメイン」型のプロパティなら --site sc-domain:the-horizons-innovation.com を両方に足す。

第 4 段: Bing に archive と yakumo を登録(孤立 146 本の命綱。API キーは Bing Webmaster > 設定 > API アクセス で 1 回だけ作る。値はどこにも書かない)

export BING_WMT_KEY=ここに値を貼る
python3 ops/bing_sitemap_submit.py
python3 ops/bing_sitemap_submit.py --send

期待値: 「登録 OK」2 行、登録後の一覧に sitemap-archive.xml と sitemap-yakumo.xml が出る。
API キーを作りたくなければ Bing Webmaster の画面 Sitemaps > Submit sitemap に 2 本の URL を貼るだけでも同じ。

第 5 段: IndexNow で 478 本を Bing に叩く(押さえ。9/4 と同じ export INDEXNOW_KEY を先に打つ)

cd ~/horizon-shield
python3 -c "import re;print(','.join(re.findall(r'<loc>(.*?)</loc>',open('sitemap-archive.xml').read()+open('sitemap-yakumo.xml').read())))" > /tmp/hs_bing_urls.txt
python3 indexnow_submit.py --no-marker --urls "$(cat /tmp/hs_bing_urls.txt)"
python3 indexnow_submit.py --no-marker --urls "$(cat /tmp/hs_bing_urls.txt)" --send

期待値: dry-run で「適格 478 / 除外 0」に近い数字、--send で 200/202。1 本ずつ実物確認するので数分かかる。

第 6 段: 被リンク(ops/backlink_requests_20260913.md)。note と LinkedIn は今日。堤様/森下様・峰尾様へ依頼文。

## 番人の git 操作の残骸(消してよい)

rm -f .git/index.lock.stale_20260913
find .git/objects -name 'tmp_obj_*' -delete

## push 後の約束

- sitemap-archive / sitemap-yakumo は GSC に出さない(Google に 478 本を再発見させない)。
- 以後 8〜12 週、Google に対しては触らない。登録リクエスト・Validate Fix・新規ページの量産をしない。yakumo ボットの生成は止めなくてよい(sitemap.xml に入らなくなった)。

## 測り方(週 1 回、月曜)

- 見る数字は 2 つだけ: GSC「ページ」の索引登録済み件数(22 から増えるか)と「クロールの統計情報」の 1 日あたりリクエスト数(3 から増えるか)。
- 「未登録」386/352 の数字は 2〜4 週は動かない(Google の報告が遅れる)。減らないことを失敗と見ない。
- 4 週で外部リンクが 3 本以上あるのにクロール数が動かなければ番人に言う。8 週で索引が 40 本を超えなければ、次の手(コアをさらに 60 本まで絞る、トップの本文で回答ページへの導線を太くする)を出す。
