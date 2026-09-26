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

## 送信の記録（2026-09-26 05:55Z、TOshi の手、/usr/bin/python3 3.9 の google ライブラリで実行）
- sitemap-cleanup.xml を GSC に送信、pending=True。
- 送信前一覧の事実: sitemap.xml は 最終送信 2026-09-13T06:57:31Z、最終取得 2026-09-13T06:57:32Z（送信の 1 秒後に 1 回だけ）、送信 URL 115 / 索引 0。以後 13 日間 Google は sitemap.xml を再取得していない（現物は 151 本だが Google の記録は 115 のまま）。
- 9/21 の URL 検査で「認識されていません」だった 103 本には 9/13 の 115 本に入っていた /kantei/ や blog が含まれる = Google は sitemap を読んでも URL を発見扱いにしていない。sitemap 経由の発見自体が止まっている状態。
- 次に見る物: GSC の sitemap 一覧で sitemap-cleanup.xml の「最終取得」が付くか、sitemap.xml の最終取得が 9/13 から動くか。

## 被リンク 1 本目（2026-09-26 15:15 JST、TOshi の手、Wix）
- www.the-horizons-innovation.com（会社サイト、canonical 自己、noindex 無し）に shield へのリンク 2 本を確認（番人が外部から取得）:
  ナビ「HORIZON SHIELD（建設費診断）」と HOME 本文「リフォーム・建設費の見積もり診断 HORIZON SHIELD（ホライゾンシールド）」。どちらも rel 無し（follow）。
- それまで会社サイトから shield へのリンクは 0 本だった。Google がこのサイトに来る最初の自然経路。
- 注意: Wix の公開ダイアログはサイト URL を https://thehoraizons.com/ と表示。thehoraizons.com は別内容のサイトで shield リンク無し。the-horizons-innovation.com と thehoraizons.com の関係（別サイトか、同一サイトの複数ドメインか）は未確認、別件。

## 索引 21 本の正体（2026-09-26 15:20 JST、TOshi の export https___shield-4、番人が 21 本を live で実測）
- 全 21 本の最終クロールは 5 月 19〜31 日。Google が持つこのサイトの索引は丸ごと 5 月の写し。
- 内訳: 県別スタブ 10 本（今は全部 noindex + canonical→親。yane-saitama / shiroari-tokyo / yane-fukuoka / gaiheki-ehime / kyutoki-okinawa / yane-akita / kyutoki-shiga / gaiheki-saga / yane-ehime / kyutoki-wakayama）、コア 2 本（souba/gaiheki、souba/shiroari。9/15 に作り直したが Google の写しは 5 月版）、archive 9 本（movement-us、fuyujimai、制振-免震装置、kitchen-150man、roof-150man、屋根-種類-特徴、sofa-gaiheki-hyomenshori、mitsumori-ichishiki、aircon-kosho。全部 index,follow・canonical 自己）。
- 処置: noindex 済みなのに索引に残る 10 本を sitemap-cleanup.xml に追加（168→178）。Google が再クロールすれば索引から落ちる。**索引数は 21→約 11 に下がる見込み。これは悪化ではなく、9/4 に自分で決めた noindex を Google がやっと反映する動き。**
- GSC 登録リクエスト: /kantei/ 済（15:20、優先クロール待ちに入った旨の表示）。次は /hs-reverse-estimate/、/souba/gaiheki/、/souba/shiroari/（後者 2 本は 5 月版を 9/15 版に更新させるため）。
- 後で見る: スタブは noindex と canonical→親 を同時に持つ。Google はこの組み合わせを推奨していない（矛盾信号）。9/21 時点で既に「noindex により除外」へ移った 4 本は同じ組み合わせで noindex が採用されたので実害は出ていないが、いずれ片方に揃える。

## Domain プロパティ the-horizons-innovation.com（2026-09-26 18:17 JST 所有権確認、TOshi の手）
- GSC に Domain プロパティ `the-horizons-innovation.com` を追加（contact@ のアカウント）。方式は DNS TXT（お名前.com の DNSレコード設定、ホスト名は空欄 = apex、TYPE TXT、値は google-site-verification=…、TTL 3600）。値は GSC の Settings > Ownership verification で見える。**消すと所有権が外れるので置きっぱなし。** 既存の `v=MCPv1…` TXT と並んで 2 本になった。
- 経緯: 17:03 と 18:04 の VERIFY は失敗。原因は Google のキャッシュではなく、お名前.com 側で「確認画面へ進む」→「設定する」の最後の 1 押しが残っていて、レコードが配信されていなかった（ゾーンの SOA シリアルが 7/31 のままだった）。18:10 に設定を確定、18:11 に「DNSレコード設定 完了通知」と「ネームサーバー情報変更 完了通知」の 2 通。後者は「DNSレコード設定用ネームサーバー変更確認」のチェックによる形式的な NS 変更で、中身は前と同じ 01〜04.dnsv.jp（www は Wix、shield は GitHub Pages を指したまま。壊れていない）。18:13 には dig と dns.google の両方で 2 本見えた。18:17 VERIFY 成功。
- 見分け方（次に同じ事が起きたとき）: Mac のターミナルで `dig +short TXT the-horizons-innovation.com @01.dnsv.jp`。権威サーバーに無ければお名前側の未確定か未反映、あって GSC が失敗なら Google の resolver のキャッシュ（TTL 3600）待ち。
- 18:18 Sitemaps に `https://www.the-horizons-innovation.com/sitemap.xml`（Wix 自動生成）を送信、Success。登録直後は Type = Unknown、Discovered 0。Google が読むと Sitemap index に変わり、下に pages-sitemap 等がぶら下がる想定。
- 18:20 URL 検査 `https://www.the-horizons-innovation.com/` は「URL is on Google」（会社サイトのトップは既に索引にある）。REQUEST INDEXING 済（優先クロール待ち）。= shield への被リンク 2 本を持つページの再クロールを頼んだ形。
- Domain プロパティの Sitemaps 一覧は shield の sitemap.xml（9/13、115）と sitemap-cleanup.xml（9/26、168）も表示する。2024-07 の古い Sitemap index（`https://renonoer.mugaw…`、0 ページ）も見えるが触らない（正体は後で確認）。
- Bing 側（sitemap.xml / sitemap-archive.xml / sitemap-yakumo.xml / robots.txt）は一切触っていない。
- 次に見る物（月曜 9/28 09:00 の gsc_check と、GSC の画面）: (1) shield の sitemap.xml の最終取得が 9/13 から動くか、(2) sitemap-cleanup.xml に最終取得が付くか、(3) www の sitemap.xml が Sitemap index に変わるか、(4) 索引数 21 が下がる（noindex の反映、想定どおり）か、(5) /kantei/ ほか 4 本の登録依頼が「登録」に変わるか。
