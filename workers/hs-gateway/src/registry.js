// registry.js
// 業種ディレクトリのレジストリ。ここが「業種一般化」の心臓部。
// 業種を1つ足す = この配列に1エントリ足すだけ。Gateway本体のロジックは触らない。
// これが設計図第2章「業種が増えてもGatewayは太らない」を実装で担保する部分。
//
// 重要な設計上の事実(hs-webmcp 実コードで確認済み):
//  - 自社(建設 Yakumo)は同一Cloudflareアカウント c15ff64a 内。service binding で呼ぶのが最適
//    (URL非公開・認証レス・同ゾーンfetch失敗の罠を回避)。
//  - 提携先(不動産・金融など)は別事業者・別アカウント。binding は張れない。HTTP fetch のみ。
//  - どちらで呼んでも、結果は receipt 発行前にハッシュを取り hs-ledger に刻む(検証可能性の核)。
//    その強制は adapter.js 側で行う。registry は「誰をどう呼ぶか」の定義だけを持つ。

// transport の値:
//   "binding" = env[binding_name] の service binding 経由(自社・同アカウントのみ)
//   "http"    = base_url へ HTTP fetch(提携先・別アカウント。信頼境界の外)
//
// verifiable の値:
//   true  = 弊社が検証能力を持つ業種(建設)。処理結果を台帳に刻む。
//   false = 提携先。弊社は検証能力を持たない。「検証できないものを検証できるフリしない」正直路線。
//           この場合でも「呼び出し・課金の事実」は台帳に刻む(=誰が何を呼び何枚消費したかは検証可能)。
//           ただし「結果の中身の妥当性」は保証しない。receipt の limits にそう明記する。

var DIRECTORIES = [
  {
    id: "construction",
    title: "建設・リフォーム (Yakumo)",
    // 建設は自社。30年の現場経験 + JCCDB があるから検証できる。
    verifiable: true,
    transport: "binding",
    binding_name: "YAKUMO_SVC", // env.YAKUMO_SVC = hs-webmcp への service binding
    mcp_path: "/mcp", // hs-webmcp の JSON-RPC エンドポイント
    // この業種に属すると判定するための決定的キーワード(上位ルーティング用)。
    // 実際の工種内スコープ判定は hs-webmcp の askRoute が既に完成しているので、
    // Gateway はここで「建設宛て」とだけ判定して丸投げする。二重管理しない。
    route_hints: [
      "工事", "リフォーム", "建設", "建築", "施工", "外壁", "屋根", "塗装",
      "解体", "内装", "基礎", "足場", "水回り", "キッチン", "浴室", "トイレ",
      "洗面", "給湯", "サッシ", "フローリング", "クロス", "外構", "防水",
      "断熱", "シロアリ", "大工", "工務店", "見積書", "坪単価", "新築", "改修", "修繕"
    ],
    // Gateway がこの業種に投げるときに使う tool 名(hs-webmcp の実装済み tool)。
    default_tool: "ask",
    status: "live"
  }

  // --- 提携業種を足すときの雛形(コメントで残す。実データが確定するまで有効化しない) ---
  // {
  //   id: "realestate",
  //   title: "不動産 (提携先X)",
  //   verifiable: false,              // 弊社に検証能力なし。正直に false。
  //   transport: "http",
  //   base_url: "https://partner-x.example.com",
  //   mcp_path: "/mcp",
  //   route_hints: ["不動産", "物件", "賃貸", "売買", "仲介手数料", "重要事項説明"],
  //   default_tool: "ask",
  //   status: "planned"               // "planned" は上位ルーティングの対象外。live のみ振り分ける。
  // }
];

function liveDirectories() {
  return DIRECTORIES.filter(function (d) { return d.status === "live"; });
}

function getDirectory(id) {
  for (var i = 0; i < DIRECTORIES.length; i++) {
    if (DIRECTORIES[i].id === id) return DIRECTORIES[i];
  }
  return null;
}

// 公開用の安全なメタ(binding_name / base_url など内部情報は出さない)。
// Gateway の GET / や agent-card で業種一覧を見せるときに使う。
function publicDirectoryList() {
  return liveDirectories().map(function (d) {
    return { id: d.id, title: d.title, verifiable: d.verifiable };
  });
}

export { DIRECTORIES, liveDirectories, getDirectory, publicDirectoryList };
