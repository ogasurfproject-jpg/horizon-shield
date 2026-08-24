// hs-audit-app — 墓標(tombstone)
//
// このWorkerは 2026-08-24 に引退した。
// 稼働していた実装は src/index.js / src/provenance.js / src/ui.js に残してある。
// git 履歴も消していない。消せる記録は記録ではない。
//
// 引退の理由は「落ちていたから」ではない。エンドポイントは最後まで応答していた。
// レジストリの旧注記にあった「returns 404」は、POST専用のハンドラに GET を投げた
// ことによる誤診である(2026-08-24 実測: GET /mcp は 404、POST tools/list は 200)。
//
// 実際の理由:
//   - 版管理の外にあった(2026-08-24 に Cloudflare から実体を引き上げて git に戻した)
//   - 出典が古い(解説論文のDOIをデータセットDOIとして提示、件数が v2 時点の 65729、
//     エンドポイントが旧ドメイン)
//   - withProvenance(audit, {}) により signed が常に null で、
//     「第三者が独立に検証できる」と謳った経路が繋がっていなかった
//   - 上流エラーが検出されず、失敗が _provenance と DOI 付きの「監査結果」として
//     返っていた。答えていないものに自信のある引用が付く状態だった
//   - 無認証の公開エンドポイントでありながら、上流へ自身の HS_MCP_KEY を付与していた
//
// audit_estimate は上流の horizon-shield が直接提供している。そちらを使うこと。

const GONE = {
  gone: true,
  worker: "hs-audit-app",
  retired: "2026-08-24",
  reason: "Retired. Not down — retired. See use/registry below.",
  use: "https://mcp.horizonshield.dev/mcp",
  registry: "io.github.ogasurfproject-jpg/horizon-shield",
  note: "The source of the retired implementation is kept in version control rather than deleted, because a record that can be erased on request is not a record."
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,mcp-session-id"
};

const HEADERS = {
  ...CORS,
  "content-type": "application/json",
  // 410 に Allow は本来不要だが、外形監視が「メソッド違い」と誤読しないよう明示する。
  "allow": "GET, POST, OPTIONS",
  "cache-control": "no-store"
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // JSON-RPC(MCP)クライアントには JSON-RPC の器で返す。id は echo する。
    if (request.method === "POST") {
      let id = null;
      try {
        const body = await request.json();
        if (body && !Array.isArray(body) && "id" in body) id = body.id;
      } catch {
        // 本文が読めなくても 410 は返す。
      }
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: "hs-audit-app is retired. Use https://mcp.horizonshield.dev/mcp", data: GONE }
      }, null, 2), { status: 410, headers: HEADERS });
    }

    return new Response(JSON.stringify(GONE, null, 2), { status: 410, headers: HEADERS });
  }
};
