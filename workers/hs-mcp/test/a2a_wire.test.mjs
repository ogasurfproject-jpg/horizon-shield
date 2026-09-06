// hs-mcp の A2A の面 (2026-09-06 第二波) の自己検証。ネットワーク無し、依存無し(公式 SDK を当てる方は sdk_js_interop.mjs / sdk_py_interop.py)。
// 使い方: node test/a2a_wire.test.mjs   (workers/hs-mcp で)   1 つでも落ちたら exit 1。
import worker from "../src/mcp.js";

const EXT = "https://gate.horizonshield.dev/ext/conduct/v1";
const O = "https://mcp.horizonshield.dev";
const ENV = {};
const CTX = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
let fails = 0;
const chk = (name, cond, extra) => { console.log((cond ? "PASS  " : "FAIL  ") + name + (cond ? "" : "  <<< " + (extra || ""))); if (!cond) fails++; };
const post = async (body, headers) => {
  const r = await worker.fetch(new Request(O + "/", { method: "POST", headers: { "content-type": "application/json", ...(headers || {}) }, body: JSON.stringify(body) }), ENV, CTX);
  return { s: r.status, ext: r.headers.get("a2a-extensions"), extLegacy: r.headers.get("x-a2a-extensions"), expose: r.headers.get("access-control-expose-headers") || "", j: await r.json() };
};
const TEXT = "外壁塗装で120万って言われた。今日契約なら半額と言われた";

const card = await (await worker.fetch(new Request(O + "/.well-known/agent-card.json"), ENV, CTX)).json();
chk("card: supportedInterfaces[0] is JSONRPC 1.0, [1] is 0.3, both at the origin", Array.isArray(card.supportedInterfaces) && card.supportedInterfaces[0].protocolBinding === "JSONRPC" && card.supportedInterfaces[0].protocolVersion === "1.0" && card.supportedInterfaces[1].protocolVersion === "0.3" && card.supportedInterfaces.every((i) => i.url === O), JSON.stringify(card.supportedInterfaces));
chk("card: 0.3 keys kept for 0.3-only readers", card.url === O && card.preferredTransport === "JSONRPC" && card.protocolVersion === "0.3.0");
chk("card: conduct extension still declared, not required, compensation equal to top level", card.capabilities.extensions.some((e) => e.uri === EXT && e.required === false && JSON.stringify(e.params.compensation) === JSON.stringify(card.compensation)));

// 1.0 wire
let r = await post({ jsonrpc: "2.0", id: 1, method: "SendMessage", params: { message: { messageId: "m1", role: "ROLE_USER", parts: [{ text: TEXT }] } } }, { "a2a-extensions": EXT + ", https://example.invalid/other/v1", "a2a-version": "1.0" });
const t = r.j.result && r.j.result.task;
chk("1.0: SendMessage returns {task} (no kind)", r.s === 200 && t && r.j.result.kind === undefined, JSON.stringify(r.j).slice(0, 200));
chk("1.0: task.status.state is TASK_STATE_COMPLETED and status.message.role is ROLE_AGENT", t && t.status.state === "TASK_STATE_COMPLETED" && t.status.message.role === "ROLE_AGENT");
chk("1.0: artifact parts carry no kind; text and data parts present", t && t.artifacts[0].parts.every((p) => p.kind === undefined) && t.artifacts[0].parts.some((p) => typeof p.text === "string") && t.artifacts[0].parts.some((p) => p.data && p.data.claim_sha256));
chk("1.0: a 1.0 request part without kind was read (a red flag matched)", t && t.artifacts[0].parts.find((p) => p.data).data.red_flags.length >= 1);
chk("1.0: echo header carries only the implemented URI; expose header names it", r.ext === EXT && r.extLegacy === null && /A2A-Extensions/.test(r.expose), r.ext + " / " + r.extLegacy + " / " + r.expose);
chk("1.0: metadata on the task has exactly the 3 conduct keys", t && t.metadata && Object.keys(t.metadata).length === 3 && t.metadata[EXT + "/endpoint"] === O + "/mcp");
chk("1.0: status.message.extensions lists the URI", t && Array.isArray(t.status.message.extensions) && t.status.message.extensions.includes(EXT));

// 0.3 wire, X- only
r = await post({ jsonrpc: "2.0", id: 2, method: "message/send", params: { message: { messageId: "m2", role: "user", kind: "message", parts: [{ kind: "text", text: TEXT }] } } }, { "x-a2a-extensions": EXT });
chk("0.3: message/send keeps kind: task, state completed, parts with kind", r.j.result && r.j.result.kind === "task" && r.j.result.status.state === "completed" && r.j.result.artifacts[0].parts.every((p) => typeof p.kind === "string"), JSON.stringify(r.j).slice(0, 200));
chk("0.3: X-A2A-Extensions alone activates; echo in both spellings; metadata and extensions attached", r.ext === EXT && r.extLegacy === EXT && r.j.result.metadata && r.j.result.status.message.extensions.includes(EXT) && /X-A2A-Extensions/.test(r.expose), r.ext + " / " + r.extLegacy + " / " + r.expose);

// Message-shaped answer (closed skill refusal) on 1.0
r = await post({ jsonrpc: "2.0", id: 3, method: "SendMessage", params: { metadata: { skill: "fair-price-attestation" }, message: { messageId: "m3", role: "ROLE_USER", parts: [{ text: "price?" }] } } }, { "a2a-extensions": EXT });
chk("1.0: a Message answer is wrapped as {message} with ROLE_AGENT and no kind", r.j.result && r.j.result.message && r.j.result.message.role === "ROLE_AGENT" && r.j.result.message.parts[0].kind === undefined && r.j.result.kind === undefined, JSON.stringify(r.j).slice(0, 200));
chk("1.0: Message answer carries metadata and extensions when activated", r.j.result.message.metadata && r.j.result.message.extensions.includes(EXT));

// no activation
r = await post({ jsonrpc: "2.0", id: 4, method: "SendMessage", params: { message: { messageId: "m4", role: "ROLE_USER", parts: [{ text: TEXT }] } } });
chk("no activation: no echo, no metadata, no extensions", r.ext === null && r.extLegacy === null && r.j.result.task.metadata === undefined && r.j.result.task.status.message.extensions === undefined);

// MCP untouched
r = await post({ jsonrpc: "2.0", id: 5, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
chk("MCP initialize still answers with serverInfo and no A2A headers", r.j.result && r.j.result.serverInfo && r.ext === null);
r = await post([{ jsonrpc: "2.0", id: 6, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }]);
chk("MCP batch still works", Array.isArray(r.j) && r.j.length === 1 && r.j[0].id === 6);

console.log(fails ? "\n" + fails + " FAIL" : "\nhs-mcp a2a wire: ALL PASS");
process.exit(fails ? 1 : 0);
