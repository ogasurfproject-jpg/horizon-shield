// test/ledger.test.mjs — hs-ledger 看板v1.1 の回帰テスト（23アサーション）
//
// 実行: node test/ledger.test.mjs
//
// このテストが守っているもの:
//   1. /health の routes 配列が **ちょうど9本** であること。
//      引き継ぎ書がこの9本を文字単位で固定し、番人v4 点検⑩ がこれを数えている。
//      看板の追加でここが動いたら、それは設計の失敗であってテストの失敗ではない。
//   2. 看板が RFC / 仕様に**本当に**準拠していること（形だけの .well-known を置かない）。
//   3. 台帳が自分の限界を公言し続けること（transparency.conformance の "NOT a conformant"）。
//      ここが消えたら、それは誠実さが消えたということで、機能の劣化より重い。
//   4. 既存ルートが無傷であること。

import { loadWorker, sha256Hex, mockKV, checker } from "./load.mjs";

const worker = await loadWorker("src/worker.js");

// entry #2 相当：`schema` を持たない v0 の仕様書型エントリ。
// これがまさに、v1.0 の jidec_cite が 400 を返していたケースである。
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
const env = { LEDGER: kv.binding };

const B = "https://hs-ledger.example.dev";
async function go(path, init) {
  const r = await worker.fetch(new Request(B + path, init), env);
  return {
    s: r.status,
    ct: r.headers.get("content-type"),
    vary: r.headers.get("vary"),
    t: await r.text(),
  };
}

const chk = checker("hs-ledger");

// ── 既存の約束 ───────────────────────────────────────────────
let r = await go("/health");
const hj = JSON.parse(r.t);
chk("/health routes still 9", hj.routes.length === 9, String(hj.routes.length));
chk("/health has discovery", !!hj.discovery && hj.discovery.api_catalog === "/.well-known/api-catalog");
chk("/health transparency admits non-conformance", /NOT a conformant/.test(hj.transparency.conformance));

// ── 看板 ─────────────────────────────────────────────────────
r = await go("/.well-known/api-catalog");
chk("api-catalog 200 + linkset+json", r.s === 200 && r.ct.includes("application/linkset+json"), r.ct);
chk("api-catalog has linkset[].item[]", Array.isArray(JSON.parse(r.t).linkset[0].item));

r = await go("/.well-known/agent-card.json");
const ac = JSON.parse(r.t);
const req8 = [
  "name",
  "description",
  "version",
  "capabilities",
  "supportedInterfaces",
  "defaultInputModes",
  "defaultOutputModes",
  "skills",
];
chk("agent-card has all 8 A2A v1.0 required fields", req8.every((k) => k in ac), req8.filter((k) => !(k in ac)).join(","));
// A2A v1.0 で protocolVersion はルートから各 AgentInterface に移った。
// ルートに残っていたら v0.3 系の古い理解のまま書いたということ。
chk(
  "agent-card protocolVersion is per-interface, not root",
  !("protocolVersion" in ac) && ac.supportedInterfaces[0].protocolVersion === "1.0.1"
);
chk("AgentSkill has id/name/description/tags", ["id", "name", "description", "tags"].every((k) => k in ac.skills[0]));

r = await go("/.well-known/security.txt");
chk("security.txt has Contact+Expires", r.s === 200 && /Contact:/.test(r.t) && /Expires:/.test(r.t));

r = await go("/llms.txt");
chk("llms.txt 200 text/markdown", r.s === 200 && r.ct.includes("text/markdown"));

r = await go("/robots.txt");
chk("robots.txt has Content-Usage + Content-signal", /Content-Usage:/.test(r.t) && /Content-signal:/.test(r.t));

// ── 案内人：非パス型エントリが引けること（v1.0 では 400 だった） ──
r = await go("/cite/jidec:entry:2");
const card = JSON.parse(r.t);
chk("/cite resolves a v0 spec entry (was 400)", r.s === 200 && card.integrity.match === true, JSON.stringify(card).slice(0, 200));
// Vary: Accept が無いと、Markdown を受け取ったキャッシュが JSON クライアントに
// Markdown を返す。これは静かに壊れる種類の事故なので必ず検査する。
chk("/cite Vary: Accept present", r.vary === "Accept", String(r.vary));
chk("/cite states its limits", /Does not prove/.test(card.limits));

r = await go("/cite/" + h2);
chk("/cite by bare 64-hex resolves", r.s === 200 && JSON.parse(r.t).resolved_entry === 2);

r = await go("/cite/jidec:entry:2", { headers: { accept: "text/markdown" } });
chk("/cite markdown negotiation", r.s === 200 && r.ct.includes("text/markdown") && r.vary === "Accept", r.ct + " vary=" + r.vary);
chk("markdown contains reproduce command", /shasum -a 256/.test(r.t));

r = await go("/cite/jidec:entry:999");
chk("/cite unknown entry -> 404 with accepted_forms", r.s === 404 && JSON.parse(r.t).accepted_forms.length === 4);

// ── A2A：カードが宣言したスキルが実在すること ────────────────
r = await go("/a2a", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 7,
    method: "message/send",
    params: { message: { role: "user", kind: "message", messageId: "m1", parts: [{ kind: "text", text: "please verify jidec:entry:2" }] } },
  }),
});
const a = JSON.parse(r.t);
chk("a2a message/send returns agent message", a.result && a.result.kind === "message" && a.result.role === "agent", r.t.slice(0, 300));
chk("a2a returns a data part with the card", a.result.parts.some((p) => p.kind === "data" && p.data.integrity.match === true));

r = await go("/a2a", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 8, method: "tasks/get" }),
});
chk("a2a unknown method -> -32601", JSON.parse(r.t).error.code === -32601);

// ── 既存ルートが無傷であること ────────────────────────────────
r = await go("/ledger/2");
chk("existing /ledger/{n} route untouched", r.s === 200);
r = await go("/nope");
chk("unknown route still 404", r.s === 404);

process.exit(chk.done() ? 1 : 0);
