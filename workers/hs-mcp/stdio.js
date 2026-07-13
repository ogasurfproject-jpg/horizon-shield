/**
 * stdio.js : hs-mcp を stdio の MCP サーバーとして起動するアダプタ。
 * 用途: Glama等の検査コンテナ内で、サーバー本体(src/mcp.js)をこのプロセス内で直接動かす。
 * 仕組み: stdin の JSON-RPC 行を HTTP リクエストに包んで本体の fetch ハンドラへ渡し、
 *         応答JSONを1行1メッセージで stdout に書く。外部エンドポイントへの中継はしない。
 * KVバインドが無い環境では、本体の設計どおりレート制限と利用計数が安全に無効化される。
 */
import worker from "./src/mcp.js";
import { createInterface } from "node:readline";

// stdout は JSON-RPC 専用。console.log 系の出力(利用計測ログ等)は全て stderr へ逃がす。
const toErr = (...a) => process.stderr.write(a.map(String).join(" ") + "\n");
console.log = toErr;
console.info = toErr;
console.warn = toErr;

const env = {
  RL_KV: {
    get: async () => null,
    put: async () => {},
    list: async () => ({ keys: [], list_complete: true }),
  },
};
const ctx = { waitUntil() {} };

const rl = createInterface({ input: process.stdin, terminal: false });
let queue = Promise.resolve();

rl.on("line", (line) => {
  const text = line.trim();
  if (!text) return;
  queue = queue.then(async () => {
    let id = null;
    try { const p = JSON.parse(text); if (p && p.id !== undefined) id = p.id; } catch (_e) {}
    try {
      const req = new Request("http://localhost/", {
        method: "POST",
        headers: { "content-type": "application/json", "accept": "application/json" },
        body: text,
      });
      const res = await worker.fetch(req, env, ctx);
      const body = (await res.text()).trim();
      if (!body) return; // 通知(202)は応答なし
      const obj = JSON.parse(body); // 1行化の保証(改行入りJSON対策)
      process.stdout.write(JSON.stringify(obj) + "\n");
    } catch (e) {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32603, message: String(e && e.message || e).slice(0, 200) } }) + "\n");
      console.error("[hs-mcp stdio] error:", String(e).slice(0, 300));
    }
  });
});

rl.on("close", () => { queue.then(() => process.exit(0)); });
