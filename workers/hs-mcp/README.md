# hs-mcp — HORIZON SHIELD MCP サーバー

エージェント(Claude / ChatGPT / Perplexity 等)が「呼べる」建設費ツール。
本番の hs-kira-proxy には一切依存しない完全独立ワーカー。KIRAエンジンにリスクなし。

## 提供ツール(5)
- `jccdb_dataset_info` : JCCDB(65,729品目・CC BY 4.0)のメタ・リンク・引用情報
- `list_cost_categories` : 整備済み61カテゴリ一覧
- `search_cost_category` : 工事名で検索(例: 外壁塗装, 浴室, 給湯器)
- `how_to_read_estimate` : 見積もりの読み方(諸経費10〜16%・一式の扱い等)
- `fair_price_data_sources` : 相場データの出典・地域係数(souba-dbをライブ取得)

## デプロイ(TOshiが手動)
親フォルダの wrangler.jsonc は別ワーカーを指すので、必ずこのフォルダに cd してから。
```
cd ~/Desktop/horizon-shield/workers/hs-mcp
npx wrangler deploy
```
デプロイ後に表示されるURL(例: https://hs-mcp.oga-surf-project.workers.dev)を控える。
bindingもsecretも不要。

## 動作確認
```
# 情報(GET)
curl https://hs-mcp.oga-surf-project.workers.dev
# ツール一覧(POST)
curl -X POST https://hs-mcp.oga-surf-project.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Claudeに接続
設定 → コネクタ → カスタムコネクタを追加 → URLに上記ワーカーURLを入れる。
接続後、Claudeが建設費の質問でこのツールを呼べるようになる。

## 更新
カテゴリは mcp.js に内蔵(souba index v1.7基準)。
価格出典は souba-db.json をライブ取得するので、souba-db更新時に自動反映。
