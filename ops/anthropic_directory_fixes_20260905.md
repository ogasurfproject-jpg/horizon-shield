# Anthropic MCP Directory: self-serve が開いたら入れる中身(2026-09-05)。入れるのは TOshi

## 1. アイコン
直リンク(512×512 PNG、shield ドメイン、公開済みで 200):
https://shield.the-horizons-innovation.com/icon.png
(同じ絵の別名 https://shield.the-horizons-innovation.com/fav-512.png も 512×512)

## 2. 説明文(英語、ダッシュ無し。短い欄ならこの 1 段落、長い欄なら 2 段落とも)

HORIZON SHIELD checks a Japanese renovation or construction estimate against JCCDB, an open cost database of 95,403 items (DOI 10.5281/zenodo.21898745, CC BY 4.0), and returns a fair price range, the gap, and red flags. Buyer side only: no referral or listing fees from contractors, and every verdict carries a SHA-256 you can recompute.

Beyond price checks it publishes an A2A agent card with machine readable compensation disclosure, accepts property intake for reverse estimates (what the job should cost, item by item), and can issue an AP2 fairness attestation for agent payments. Read only; no personal data is stored.

## 3. ツール一覧(実サーバー 14 本、名前はこの綴りで)
audit_estimate
check_red_flags
create_ap2_fairness_attestation
get_agent_card
get_estimate_reading_guide
get_fair_price_sources
get_jccdb_dataset_info
get_price_range
list_cost_categories
preview_reverse_estimate
search_cost_category
suggest_ehn
verify_fair_price
verify_integrity_claim

## 4. その他の欄
- MCP endpoint: https://mcp.horizonshield.dev/mcp(旧 hs-mcp.oga-surf-project.workers.dev は同じ Worker。先方はまだ旧 URL で認識しとる可能性あり、欄があれば新 URL に)
- Privacy policy: https://shield.the-horizons-innovation.com/verify-directory/privacy/(末尾スラッシュ必須)
- Website: https://shield.the-horizons-innovation.com
- Contact: contact@the-horizons-innovation.com

## 5. 番人の注記
- 8 月に先方が言うた「残 3 点」= ツール名の一致 / 説明に A2A card・property intake・AP2 attestation を追記 / icon_url を shield ドメインの直リンクに。上の 1〜3 でその 3 点を全部埋めとる
- 説明文の数字(95,403、DOI)はサイトと G空間の掲載と一致。変えるなら全部一緒に
