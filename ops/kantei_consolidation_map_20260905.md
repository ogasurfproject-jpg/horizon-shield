# 見積もり鑑定書AI (/kantei/) への入口統合マップ (2026-09-05)

決定 (TOshi 2026-09-05): 消費者向け診断の固有名は「見積もり鑑定書AI」、記述名は「リフォーム見積もり診断AI」。正本は /kantei/ の 1 ページ。
このメモは、今ある診断入口 12 個をどう扱うかの一覧と、その根拠。実行は ops/kantei_apply.sh (既定は dry-run、--apply で書き換え)。

## 前提 (実測)

- ホストは GitHub Pages (CNAME shield.the-horizons-innovation.com、_config.yml は Jekyll)。サーバー 301 は使えない。リポジトリの _redirects は Cloudflare Pages / Netlify の書式で、GitHub Pages は読まない (blog/article-2026-06-14.html などは実体のスタブ HTML が転送している。_redirects の 25 行は飾り)。
- 既にサイトで使っている転送方式 = スタブ HTML: `<meta name="robots" content="noindex">` + `<meta http-equiv="refresh" content="0;url=...">` + canonical を新 URL + `location.replace`。Google は refresh 0 を恒久転送と同等に扱う。本メモでも同じ方式を使う。
- 正本 /kantei/index.html は本日設置済み (43,939 bytes、sha256 先頭 9bb233204c6af67d)。sitemap.xml にトップ直後で追加済み (583 → 584 URL)。
- 無料診断の経路は inspect.html と同じ (hs-kira-proxy /anthropic → /notify)。KIRA への指示も同じ (金額を出さない、気になる点の件数と見出しのみ)。notify の message 先頭を「【鑑定書AI 無料診断】」、source を "kantei" にしてあるので、どの入口から来たか KV で分かる。
- 鑑定書 ¥5,500 の導線は既存のトップ #services (PayPal + 規約モーダル) へ送る。決済の複製はしていない。

## 一覧

| URL | 今の title | 機能 | 被リンク(サイト内ページ数) | 扱い |
|---|---|---|---|---|
| /kantei/ | 見積もり鑑定書AI｜リフォーム見積もりが高いか適正か、無料で診断｜ホライゾンシールド（施工しない第三者） | 正本。無料アップロード診断 + 鑑定書導線 + FAQ 9 問 (FAQPage/Service/Organization JSON-LD) | 0 (新規) | トップの「見積もり・工事がある」カードの href をここへ、llms.txt に 1 行、IndexNow、GSC 登録リクエスト |
| /mitsumori-ai-shindan.html | 見積書AI診断の適正チェックと料金｜30秒で過剰請求を見分ける | ¥5,500 / ¥55,000 の料金と電話受付の説明ページ | 101 (フッター) | スタブで /kantei/ へ転送。101 ページの href も /kantei/ に書き換え。※「診断1200件の42%」の数字は /kantei/ に持ち込んでいない。裏付けがあるなら後で足す |
| /negotiate/ | 見積書交渉サポート｜AIが適正価格を算出・交渉文を生成 | hs-diagnosis で適正価格 + 交渉文 (= 鑑定書の中身と同じ約束) | 1 | スタブで /kantei/ へ |
| /gemini-shindan/ | Gemini AI 見積もり監査 | hs-gemini-audit の Gemini 経路 | 2 | スタブで /kantei/ へ。Gemini 経路を残したいなら、転送せず noindex にして /kantei/ から「Gemini で診断」リンクを張る (TOshi 判断) |
| /reverse-estimate/ | 逆見積もり診断 v4 | /hs-reverse-estimate/ の旧版 | 4 | スタブで /hs-reverse-estimate/ へ (鑑定書ではなく逆見積もりの重複) |
| /hs-reverse-estimate/ | 逆見積もり診断 \| HORIZON SHIELD (KIRAが3プラン算出) | まだ見積もりが無い人向け (KIRA 対話 → 適正予算 → PDF) | 157 | 残す。別商品 (見積もり前)。「見積もりがある人は /kantei/」の一行を追加。title の中の横棒 (U+2014) は禁則文字なので「｜」に |
| /inspect.html | 施工不良チェック｜写真を送るだけ・無料診断 | 工事後の写真の施工不良チェック (同じフォーム) | 4 | 残す。意図が違う (施工後)。「見積書なら /kantei/」の一行を追加 |
| /check/ | 悪徳業者チェッカー｜業者名で検索・リスク診断 | 業者名検索 | 2 | 残す。別商品 |
| /lp/ | 見積もり達人 EHN｜その見積もり、高いのか安いのか、AIが解剖する | EHN (掲示板) の LP | 124 | 残すが title を EHN の言葉に変える (「匿名の見積もり掲示板」)。今の title は /kantei/ と同じ検索語を食い合う |
| /hacker/ | 見積もり達人 / 匿名見積もりデータベース | EHN 掲示板本体 | 133 | 残す |
| /ehn/ | EHN 創刊号・見積もり達人ニュース | EHN ハブ | 639 | 残す |
| /guide/mitsumori-tekisei-check/ | リフォームの見積もりが適正かを確かめる方法 | 解説記事 | 5 | 残す。記事末の CTA を KIRA から /kantei/ へ |
| /system/, /partner/ | MCP System / 認定パートナー募集 | B2B | 0 | 残す。canonical が無いので自己 canonical を足す (消費者語の食い合いはしない) |

## 順番

1. /kantei/ を push → 反映後に IndexNow → GSC で URL 検査 + 登録リクエスト。(このメモの時点で /kantei/ はローカルのみ)
2. 1 が 200 を返してから ops/kantei_apply.sh --apply。順番を逆にすると、転送先が 404 の間だけ転送元が死ぬ。
3. 週次の可視性モニターに service 型 2 問を足した版 (ops/llm_visibility_monitor.py) で、月曜に測る。完了条件は service 型が CITED になること。

## /kantei/ の文面で、今は書いていないこと (実装が追いついたら差し替える)

- 「業者も同じ番号で確認できる」: 鑑定書 (generate-meitsumori) は証明書番号と SHA-256 は付くが、JIDEC 台帳には載らない。台帳に載って /verify/{n} が返るのは estimate-audit 経路 (hs-gateway op "audit" → hs-pdf-gen /generate-estimate-audit) だけ。generate-meitsumori にも hsBuildClaim + hsAppendLedger (worker.js 18494〜18531 の関数) を通し、X-JIDEC-Verify の URL を PDF に印字すれば、/kantei/ の「なぜ業者に見せられるのか」3 番目を次の文に差し替えられる:
  「鑑定書には公開台帳 JIDEC の検証番号が付きます。業者が同じ番号を台帳で引けば同じ鑑定書が出てくるので、『施主が書き換えた』も『AI の適当な数字』も通りません。」
- 「3 分」: 書いていない。実測していないため。「その場で」「通常は数十秒」にしてある。
- 「診断 1,200 件・42%」: /mitsumori-ai-shindan.html の数字。根拠の所在を TOshi が示せるなら FAQ に 1 問足す。
- 返金保証「¥10,000 以上節約できなければ全額返金」はトップの文言をそのまま載せた。特商法ページの記載と一致しているか要確認。
- 「工事は請け負いません」: 特商法ページの販売価格一覧に施工の項目が無いことを根拠にした。違うなら直す。

## 同日に見つけた別件 (このメモの範囲外、TOshi の決裁)

- 823 ページのフッター中立宣言が「The HORIZONs株式会社」(ローマ字) になっている。社名は「The HORIZ音s株式会社」。PR TIMES・特商法ページ・/kantei/ は 音。エンティティ照合 (プレス記事 ⇔ サイト) が名前で切れる。一括置換は 1 行の sed で済むが、6/16 の 235 URL 事故と同種の全ページ書き換えなので、一覧提示の上で実施する。
- llms.txt の 1 行目も「The HORIZONs株式会社」。
