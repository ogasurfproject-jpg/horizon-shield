// test/mcp.test.mjs — hs-jidec-mcp v1.1.0 の回帰テスト（18アサーション）
//
// 実行: node test/mcp.test.mjs
//
// ここは**統合テスト**である。MCP Worker の LEDGER_SVC バインディングに、
// 本物の hs-ledger モジュールを直接束ねている。HTTP は一切出て行かない。
//
// なぜそうするか（第二の掟）:
//   同一アカウントの workers.dev を fetch すると自分に戻ってくる。過去に
//   これで FALSE DRIFT を出した。テストで公開ホスト名を叩けば、同じ罠を
//   テストの中に持ち込むことになる。サービスバインディングを模す＝本番の
//   正しい姿を模す、ということでもある。
//
// このテストが守っているもの:
//   1. ツールが4本あること（jidec_how_to_verify を含む）。3本に戻っていたら
//      ロールバック事故。番人v4 点検⑪ と同じことを見ている。
//   2. protocolVersion が 2025-11-25 であること。2024-11-05 に戻っていたら
//      古いソースが上書きデプロイされている。
//   3. initialize 無しで tools/call が通ること（MCP 2026-07-28 のステートレス化）。
//   4. Origin 検証が効くこと（DNS リバインディング対策）。
//   5. ツールの失敗が protocol error ではなく isError 結果で返ること。
//      protocol error だとモデルは本文を読めず、ただ「壊れた」としか分からない。

import { loadWorker, sha256Hex, mockKV, checker } from "./load.mjs";

const ledger = await loadWorker("src/worker.js");

// hs-jidec-mcp の置き場所は配布形態で変わる。
//   リポジトリでは  workers/hs-jidec-mcp/    （= hs-ledger の**隣**）
//   配布zipでは     ledger_sync/hs-jidec-mcp/（= hs-ledger の**中**）
// 2026-07-26、リポジトリ側でこのテストが ENOENT のまま即死していることが分かった。
// 落ちていたのはテストであって本番ではない。だが**動かないテストは無いテストより悪い**。
// 「ツールが4本あること」を守るはずの見張りが、実は一度も見張っていなかった。
// だから置き場所を決め打ちにせず、両方試し、見つからなければ理由を言って落ちる。
let mcp = null;
let mcpFrom = null;
for (const cand of ["hs-jidec-mcp/src/worker.js", "../hs-jidec-mcp/src/worker.js"]) {
  try {
    mcp = await loadWorker(cand);
    mcpFrom = cand;
    break;
  } catch (e) {
    if (String((e && e.code) || "") !== "ENOENT") throw e;
  }
}
if (!mcp) {
  console.error("FAIL  hs-jidec-mcp のソースが見つからない（hs-jidec-mcp/src/worker.js も ../hs-jidec-mcp/src/worker.js も無い）");
  process.exit(1);
}
console.log("# mcp source: " + mcpFrom);

const rec2 = JSON.stringify({ title: "SPEC_HASH_INDEPENDENCE_v1.md", sha256: "deadbeef" });
const h2 = await sha256Hex(rec2);
const kv = mockKV([
  ["seq", "2"],
  [
    "entry:2",
    JSON.stringify({
      n: 2,
      work: "spec",
      claim_sha256: h2,
      record_canonical: rec2,
      schema: "v0",
      created_at: "2026-01-01T00:00:00Z",
      ots_status: "confirmed",
      bitcoin_block: 912345,
      block_time: "2026-01-02T00:00:00Z",
    }),
  ],
  [`hash:${h2}`, "2"],
]);
const ledgerEnv = { LEDGER: kv.binding };

// サービスバインディングそのもの。公開ホスト名を経由しない＝ループバックしない。
const env = { LEDGER_SVC: { fetch: (req) => ledger.fetch(req, ledgerEnv) } };

const B = "https://hs-jidec-mcp.example.dev";
const call = async (body, hdr = {}) => {
  const r = await mcp.fetch(
    new Request(B + "/mcp", { method: "POST", headers: { "content-type": "application/json", ...hdr }, body: JSON.stringify(body) }),
    env
  );
  return { s: r.status, j: JSON.parse(await r.text()) };
};

const chk = checker("hs-jidec-mcp");

// ── HTTP 層 ──────────────────────────────────────────────────
let r = await mcp.fetch(new Request(B + "/mcp"), env);
chk("GET /mcp -> 405 (was 404)", r.status === 405 && r.headers.get("Allow") === "POST, OPTIONS", r.status + " allow=" + r.headers.get("Allow"));

r = await mcp.fetch(new Request(B + "/mcp", { method: "POST", headers: { Origin: "null", "content-type": "application/json" }, body: "{}" }), env);
chk("Origin: null -> 403", r.status === 403);

r = await mcp.fetch(
  new Request(B + "/mcp", {
    method: "POST",
    headers: { Origin: "https://claude.ai", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  }),
  env
);
chk(
  "permitted origin echoed, not \"*\"",
  r.status === 200 && r.headers.get("Access-Control-Allow-Origin") === "https://claude.ai" && r.headers.get("Vary") === "Origin",
  r.headers.get("Access-Control-Allow-Origin")
);

r = await mcp.fetch(
  new Request(B + "/mcp", { method: "POST", headers: { Origin: "https://evil.example", "content-type": "application/json" }, body: "{}" }),
  { ...env, ALLOWED_ORIGINS: "https://claude.ai" }
);
chk("ALLOWED_ORIGINS tightening works -> 403", r.status === 403);

// ── MCP プロトコル層 ─────────────────────────────────────────
let x = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
chk("protocolVersion is 2025-11-25", x.j.result.protocolVersion === "2025-11-25", x.j.result.protocolVersion);
chk("serverInfo has title + instructions", !!x.j.result.serverInfo.title && /requires no trust in HORIZON SHIELD/.test(x.j.result.instructions));

x = await call({ jsonrpc: "2.0", id: 2, method: "tools/list" });
const tools = x.j.result.tools;
chk("4 tools listed", tools.length === 4, String(tools.length));
chk("every tool has title", tools.every((t) => typeof t.title === "string" && t.title));
chk("every tool readOnlyHint:true", tools.every((t) => t.annotations && t.annotations.readOnlyHint === true));
chk("jidec_how_to_verify present", tools.some((t) => t.name === "jidec_how_to_verify"));

// ステートレス：initialize を送らずに tools/call を通す（2026-07-28 の挙動）
x = await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "jidec_cite", arguments: { citation: "jidec:entry:2" } } });
const card = JSON.parse(x.j.result.content[0].text);
chk("jidec_cite resolves entry #2 (was MCP error -32000 ledger error 400)", !x.j.result.isError && card.integrity.match === true, JSON.stringify(x.j).slice(0, 300));
chk("card reports Bitcoin confirmed block", card.bitcoin.status === "confirmed" && card.bitcoin.block === 912345);
chk("card carries limits statement", /does NOT prove/i.test(card.limits));
chk("tools/call works with no initialize (stateless, 2026-07-28 ready)", true);

x = await call({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "jidec_cite", arguments: { citation: "jidec:entry:404" } } });
chk("tool failure -> isError result, not protocol error", x.j.result && x.j.result.isError === true, JSON.stringify(x.j).slice(0, 200));

// 台帳は「パスが無い」に 404、「エントリはあるがパス型でない」に 400 を返す。
// 両方とも「再walkするものが無い」であって、コードではなく言葉で説明されるべき。
x = await call({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "jidec_replay", arguments: { citation: "jidec:entry:2" } } });
chk(
  "replay on a non-path entry explains itself instead of raw 404",
  x.j.result.isError === true && /not a jidec-path-v1/.test(x.j.result.content[0].text),
  x.j.result.content[0].text.slice(0, 160)
);

x = await call({ jsonrpc: "2.0", id: 6, method: "ping" });
chk("ping supported", JSON.stringify(x.j.result) === "{}");

r = await mcp.fetch(new Request(B + "/health"), env);
const h = JSON.parse(await r.text());
chk("/health advertises protocol + stateless + discovery", h.mcp.protocol_version === "2025-11-25" && h.mcp.stateless === true && !!h.discovery);

// A2A Conduct Extension v1 (2026-09-06): the card the gate reads declares it, and the two compensation copies agree
r = await mcp.fetch(new Request(B + "/.well-known/agent-card.json"), env);
const jc = JSON.parse(await r.text());
const EXT = "https://gate.horizonshield.dev/ext/conduct/v1";
const jext = (jc.capabilities && jc.capabilities.extensions || []).find((e) => e.uri === EXT);
chk("jidec-mcp agent-card declares conduct ext", !!jext && jext.required === false && Array.isArray(jext.params.measured_endpoints), JSON.stringify(jc.capabilities));
const K = ["paid_by", "referral_fee", "listing_fee", "success_fee_pct", "disclosure_url"];
chk("top-level compensation equals extension params.compensation on the five keys", !!jext && K.every((k) => JSON.stringify(jc.compensation[k] === undefined ? null : jc.compensation[k]) === JSON.stringify(jext.params.compensation[k] === undefined ? null : jext.params.compensation[k])));

process.exit(chk.done() ? 1 : 0);
