# pace the frontier / 先後レシート公開キャンペーン (2026-09-14)

## これは何か
「AIは速すぎる、ペースを落とせ」と世界のトップ(Dario / Sam / Elon)が認めた週に合わせて、
先後(precedence)レシートを公開し、それを主役に据えた投稿一式。
「速さではなく、確かめられること。日付を名指しすれば、俺の時計ではなく Bitcoin のブロック時刻で
前か後かを答える」を軸にした。

## 何を出したか(実装)
- 台帳 worker (hs-ledger) に GET /precedence/<citation>[?before=<ISO UTC>] を追加
- 判定: established / integrity_failure(409) / anchor_pending
- before 比較: precedes / not_provably_before / unparseable_time (+ margin_seconds)
- 署名では立証できん、を本文に明記
- /health の discovery に precedence を追加(routes 配列は 13 のまま不変)

## 紐づく事実(検証可能)
- deploy commit: 7e90d6a8
- hs-ledger Version ID: 88b01e0e-7b70-48a0-8743-d582f1437cdb
- 本番エンドポイント: https://ledger.horizonshield.dev/precedence/{citation}
- 実演URL(投稿に掲載): https://ledger.horizonshield.dev/precedence/jidec:entry:6?before=2026-08-01T00:00:00Z
  - 返り: established=true, result=precedes, provable=true, margin_seconds=509520
  - 記録の錨: Bitcoin block 959634, block_time 2026-07-26 02:28 UTC
- 逆向きの確認(?before=2026-07-01T00:00:00Z): result=not_provably_before, provable=false
- テスト: hs-ledger 4スイート全緑 (precedence 14 / ledger / mcp / witness_v11)
- 本番確認: 2026-09-14、内蔵ブラウザで precedes と not_provably_before の両方を目視

## ファイル
- linkedin.md   LinkedIn 投稿 (英語)
- bluesky.md    Bluesky 投稿 (英語、単発版 + 3連スレッド版)
- note.md       note 投稿 (日本語)
- grok_image_brief.md   Grok への画像指示書 (スイス様式、黒白+赤一色、時間軸)
- assets/hero-01-recommended.jpg   採用推奨 (番人選定。時間軸の上に赤旗の瞬間、その左に黒い錨点)
- assets/alt-02-photo.jpg          代替。写真調、下辺にハッシュ帯。質感は高いがサムネで点が小さい
- assets/alt-03-downriser.jpg      代替。赤旗が下向き。hero とほぼ双子

## 掟
- 投稿は precedence の URL が本番で生きてから出す(デプロイ済みなので現在は有効)
- ダッシュ(em/en/bar)は本文に一切使っていない
