# Google 索引の掃除 sitemap（2026-09-26、番人）

GSC export 9/21: 索引 21 / 未登録 470 = クロール済み未登録 388 + 発見済み未クロール 75 + noindex 4 + その他 3。
388 のうち 174 はどの sitemap にも無いページ。実測（Googlebot UA で 174 本を取得）: 168 本が HTTP 200 + noindex（4〜8 月に Google が取って却下し、その後 noindex にしたが Google が再訪していない県別スタブ等）、
/partner/ と /map と /tsuika-koji/ は meta 無し、/souba.html と /souba/gaiheki-yane-tosou-tebiki/index.html は index、//?ref=producthunt は 404。

## 何をするか
sitemap-cleanup.xml に 168 本を lastmod 今日で列挙し、GSC にだけ送る。robots.txt には載せない、Bing には出さない（168 本は全ボットに noindex なので Bing 側に変化は無い）。
Google が再クロールすると「クロール済み未登録」から「noindex により除外」へ移り、Google が持つこのサイト像から 5 月のスタブ群が消える。9/21 時点で既にそう移った 4 本（yane-tokyo 7/23 等）がこの経路の実証。

## 内訳（section 別）
- souba: 166
- mitsumori-ai-shindan.html: 1
- opening.html: 1

## 送り方（TOshi の手、~/horizon-shield で）

    git add sitemap-cleanup.xml ops/google_cleanup_20260926.md && git commit -m "google: cleanup sitemap of 168 noindexed pages Google still holds as crawled-not-indexed" && git push origin main
    python3 ops/gsc_sitemap_submit.py --feed https://shield.the-horizons-innovation.com/sitemap-cleanup.xml --send

送信前の一覧で sitemap.xml の「最終取得」が 9/13 より前なら、Google は縮小後の sitemap をまだ読んでいない（その事実も記録する）。

## 撤去
GSC のページ索引で「noindex により除外」がおおむね 168 に達したら sitemap-cleanup.xml を GSC から削除し、ファイルも消す。

## 一覧
- https://shield.the-horizons-innovation.com/mitsumori-ai-shindan.html
- https://shield.the-horizons-innovation.com/souba/yane-chiba/
- https://shield.the-horizons-innovation.com/souba/yane-hokkaido/
- https://shield.the-horizons-innovation.com/souba/gaiheki-osaka/
- https://shield.the-horizons-innovation.com/souba/gaiheki-hyogo/
- https://shield.the-horizons-innovation.com/souba/gaiheki-aichi/
- https://shield.the-horizons-innovation.com/souba/kyutoki-fukuoka/
- https://shield.the-horizons-innovation.com/souba/yane-osaka/
- https://shield.the-horizons-innovation.com/souba/gaiheki-kanagawa/
- https://shield.the-horizons-innovation.com/souba/bath-aichi/
- https://shield.the-horizons-innovation.com/souba/kyutoki-iwate/
- https://shield.the-horizons-innovation.com/souba/gaiheki-miyazaki/
- https://shield.the-horizons-innovation.com/souba/yane-kochi/
- https://shield.the-horizons-innovation.com/souba/kyutoki-shizuoka/
- https://shield.the-horizons-innovation.com/souba/shiroari-kanagawa/
- https://shield.the-horizons-innovation.com/opening.html
- https://shield.the-horizons-innovation.com/souba/shiroari-miyazaki/
- https://shield.the-horizons-innovation.com/souba/kyutoki-miyagi/
- https://shield.the-horizons-innovation.com/souba/shiroari-saitama/
- https://shield.the-horizons-innovation.com/souba/shiroari-kagawa/
- https://shield.the-horizons-innovation.com/souba/gaiheki-shimane/
- https://shield.the-horizons-innovation.com/souba/shiroari-oita/
- https://shield.the-horizons-innovation.com/souba/bath-fukuoka/
- https://shield.the-horizons-innovation.com/souba/bath-osaka/
- https://shield.the-horizons-innovation.com/souba/bath-tokyo/
- https://shield.the-horizons-innovation.com/souba/yane-mie/
- https://shield.the-horizons-innovation.com/souba/shiroari-tochigi/
- https://shield.the-horizons-innovation.com/souba/gaiheki-shiga/
- https://shield.the-horizons-innovation.com/souba/kyutoki-gifu/
- https://shield.the-horizons-innovation.com/souba/yane-tottori/
- https://shield.the-horizons-innovation.com/souba/gaiheki-wakayama/
- https://shield.the-horizons-innovation.com/souba/gaiheki-okayama/
- https://shield.the-horizons-innovation.com/souba/yane-shizuoka/
- https://shield.the-horizons-innovation.com/souba/yane-nagano/
- https://shield.the-horizons-innovation.com/souba/shiroari-shiga/
- https://shield.the-horizons-innovation.com/souba/kyutoki-shimane/
- https://shield.the-horizons-innovation.com/souba/shiroari-fukui/
- https://shield.the-horizons-innovation.com/souba/shiroari-kochi/
- https://shield.the-horizons-innovation.com/souba/kyutoki-tokyo/
- https://shield.the-horizons-innovation.com/souba/shiroari-shizuoka/
- https://shield.the-horizons-innovation.com/souba/kyutoki-kagoshima/
- https://shield.the-horizons-innovation.com/souba/gaiheki-hiroshima/
- https://shield.the-horizons-innovation.com/souba/gaiheki-kochi/
- https://shield.the-horizons-innovation.com/souba/yane-miyagi/
- https://shield.the-horizons-innovation.com/souba/kyutoki-yamaguchi/
- https://shield.the-horizons-innovation.com/souba/shiroari-gunma/
- https://shield.the-horizons-innovation.com/souba/gaiheki-toyama/
- https://shield.the-horizons-innovation.com/souba/kyutoki-tokushima/
- https://shield.the-horizons-innovation.com/souba/gaiheki-yamanashi/
- https://shield.the-horizons-innovation.com/souba/kyutoki-aichi/
- https://shield.the-horizons-innovation.com/souba/yane-kyoto/
- https://shield.the-horizons-innovation.com/souba/kyutoki-toyama/
- https://shield.the-horizons-innovation.com/souba/shiroari-akita/
- https://shield.the-horizons-innovation.com/souba/shiroari-shimane/
- https://shield.the-horizons-innovation.com/souba/yane-kanagawa/
- https://shield.the-horizons-innovation.com/souba/yane-okayama/
- https://shield.the-horizons-innovation.com/souba/shiroari-osaka/
- https://shield.the-horizons-innovation.com/souba/shiroari-fukuoka/
- https://shield.the-horizons-innovation.com/souba/gaiheki-fukui/
- https://shield.the-horizons-innovation.com/souba/kyutoki-gunma/
- https://shield.the-horizons-innovation.com/souba/kyutoki-kagawa/
- https://shield.the-horizons-innovation.com/souba/gaiheki-fukuoka/
- https://shield.the-horizons-innovation.com/souba/kyutoki-kanagawa/
- https://shield.the-horizons-innovation.com/souba/yane-yamagata/
- https://shield.the-horizons-innovation.com/souba/yane-oita/
- https://shield.the-horizons-innovation.com/souba/yane-gunma/
- https://shield.the-horizons-innovation.com/souba/shiroari-okayama/
- https://shield.the-horizons-innovation.com/souba/kyutoki-osaka/
- https://shield.the-horizons-innovation.com/souba/kyutoki-mie/
- https://shield.the-horizons-innovation.com/souba/kyutoki-kumamoto/
- https://shield.the-horizons-innovation.com/souba/gaiheki-kagawa/
- https://shield.the-horizons-innovation.com/souba/kyutoki-saga/
- https://shield.the-horizons-innovation.com/souba/gaiheki-gunma/
- https://shield.the-horizons-innovation.com/souba/shiroari-kumamoto/
- https://shield.the-horizons-innovation.com/souba/gaiheki-niigata/
- https://shield.the-horizons-innovation.com/souba/gaiheki-gifu/
- https://shield.the-horizons-innovation.com/souba/kyutoki-tottori/
- https://shield.the-horizons-innovation.com/souba/kyutoki-ehime/
- https://shield.the-horizons-innovation.com/souba/kyutoki-ishikawa/
- https://shield.the-horizons-innovation.com/souba/shiroari-gifu/
- https://shield.the-horizons-innovation.com/souba/yane-niigata/
- https://shield.the-horizons-innovation.com/souba/yane-tokushima/
- https://shield.the-horizons-innovation.com/souba/yane-yamaguchi/
- https://shield.the-horizons-innovation.com/souba/kyutoki-yamanashi/
- https://shield.the-horizons-innovation.com/souba/gaiheki-nagano/
- https://shield.the-horizons-innovation.com/souba/shiroari-yamaguchi/
- https://shield.the-horizons-innovation.com/souba/gaiheki-tokushima/
- https://shield.the-horizons-innovation.com/souba/gaiheki-saitama/
- https://shield.the-horizons-innovation.com/souba/yane-hiroshima/
- https://shield.the-horizons-innovation.com/souba/yane-hyogo/
- https://shield.the-horizons-innovation.com/souba/gaiheki-tochigi/
- https://shield.the-horizons-innovation.com/souba/yane-kagawa/
- https://shield.the-horizons-innovation.com/souba/gaiheki-hokkaido/
- https://shield.the-horizons-innovation.com/souba/gaiheki-mie/
- https://shield.the-horizons-innovation.com/souba/gaiheki-yamagata/
- https://shield.the-horizons-innovation.com/souba/yane-ibaraki/
- https://shield.the-horizons-innovation.com/souba/kyutoki-miyazaki/
- https://shield.the-horizons-innovation.com/souba/shiroari-aichi/
- https://shield.the-horizons-innovation.com/souba/kyutoki-tochigi/
- https://shield.the-horizons-innovation.com/souba/gaiheki-yamaguchi/
- https://shield.the-horizons-innovation.com/souba/shiroari-hokkaido/
- https://shield.the-horizons-innovation.com/souba/shiroari-ishikawa/
- https://shield.the-horizons-innovation.com/souba/yane-yamanashi/
- https://shield.the-horizons-innovation.com/souba/gaiheki-fukushima/
- https://shield.the-horizons-innovation.com/souba/kyutoki-aomori/
- https://shield.the-horizons-innovation.com/souba/shiroari-saga/
- https://shield.the-horizons-innovation.com/souba/shiroari-nara/
- https://shield.the-horizons-innovation.com/souba/shiroari-yamanashi/
- https://shield.the-horizons-innovation.com/souba/kyutoki-hiroshima/
- https://shield.the-horizons-innovation.com/souba/shiroari-aomori/
- https://shield.the-horizons-innovation.com/souba/gaiheki-ibaraki/
- https://shield.the-horizons-innovation.com/souba/shiroari-niigata/
- https://shield.the-horizons-innovation.com/souba/yane-nara/
- https://shield.the-horizons-innovation.com/souba/gaiheki-shizuoka/
- https://shield.the-horizons-innovation.com/souba/yane-gifu/
- https://shield.the-horizons-innovation.com/souba/shiroari-tottori/
- https://shield.the-horizons-innovation.com/souba/kyutoki-hokkaido/
- https://shield.the-horizons-innovation.com/souba/kyutoki-akita/
- https://shield.the-horizons-innovation.com/souba/kyutoki-nagasaki/
- https://shield.the-horizons-innovation.com/souba/shiroari-tokushima/
- https://shield.the-horizons-innovation.com/souba/shiroari-kagoshima/
- https://shield.the-horizons-innovation.com/souba/yane-fukushima/
- https://shield.the-horizons-innovation.com/souba/kyutoki-kyoto/
- https://shield.the-horizons-innovation.com/souba/shiroari-nagasaki/
- https://shield.the-horizons-innovation.com/souba/yane-wakayama/
- https://shield.the-horizons-innovation.com/souba/yane-ishikawa/
- https://shield.the-horizons-innovation.com/souba/yane-okinawa/
- https://shield.the-horizons-innovation.com/souba/yane-shiga/
- https://shield.the-horizons-innovation.com/souba/gaiheki-tokyo/
- https://shield.the-horizons-innovation.com/souba/gaiheki-iwate/
- https://shield.the-horizons-innovation.com/souba/kyutoki-chiba/
- https://shield.the-horizons-innovation.com/souba/yane-toyama/
- https://shield.the-horizons-innovation.com/souba/gaiheki-nagasaki/
- https://shield.the-horizons-innovation.com/souba/shiroari-hiroshima/
- https://shield.the-horizons-innovation.com/souba/yane-fukui/
- https://shield.the-horizons-innovation.com/souba/gaiheki-oita/
- https://shield.the-horizons-innovation.com/souba/shiroari-yamagata/
- https://shield.the-horizons-innovation.com/souba/gaiheki-tottori/
- https://shield.the-horizons-innovation.com/souba/gaiheki-kumamoto/
- https://shield.the-horizons-innovation.com/souba/gaiheki-kagoshima/
- https://shield.the-horizons-innovation.com/souba/gaiheki-miyagi/
- https://shield.the-horizons-innovation.com/souba/shiroari-fukushima/
- https://shield.the-horizons-innovation.com/souba/yane-shimane/
- https://shield.the-horizons-innovation.com/souba/gaiheki-kyoto/
- https://shield.the-horizons-innovation.com/souba/yane-aichi/
- https://shield.the-horizons-innovation.com/souba/shiroari-okinawa/
- https://shield.the-horizons-innovation.com/souba/kyutoki-yamagata/
- https://shield.the-horizons-innovation.com/souba/yane-iwate/
- https://shield.the-horizons-innovation.com/souba/kyutoki-ibaraki/
- https://shield.the-horizons-innovation.com/souba/kyutoki-kochi/
- https://shield.the-horizons-innovation.com/souba/shiroari-iwate/
- https://shield.the-horizons-innovation.com/souba/shiroari-ibaraki/
- https://shield.the-horizons-innovation.com/souba/shiroari-miyagi/
- https://shield.the-horizons-innovation.com/souba/gaiheki-akita/
- https://shield.the-horizons-innovation.com/souba/gaiheki-ishikawa/
- https://shield.the-horizons-innovation.com/souba/gaiheki-aomori/
- https://shield.the-horizons-innovation.com/souba/shiroari-kyoto/
- https://shield.the-horizons-innovation.com/souba/shiroari-wakayama/
- https://shield.the-horizons-innovation.com/souba/gaiheki-okinawa/
- https://shield.the-horizons-innovation.com/souba/yane-kumamoto/
- https://shield.the-horizons-innovation.com/souba/shiroari-hyogo/
- https://shield.the-horizons-innovation.com/souba/kyutoki-oita/
- https://shield.the-horizons-innovation.com/souba/kyutoki-nagano/
- https://shield.the-horizons-innovation.com/souba/yane-saga/
- https://shield.the-horizons-innovation.com/souba/yane-aomori/
- https://shield.the-horizons-innovation.com/souba/kyutoki-niigata/
- https://shield.the-horizons-innovation.com/souba/shiroari-mie/
- https://shield.the-horizons-innovation.com/souba/shiroari-chiba/
