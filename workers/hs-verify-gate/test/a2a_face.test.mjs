// 扉の A2A の口 (0.3.3) の自己検証。ネットワーク無し、依存無し。
// 使い方: node test/a2a_face.test.mjs   (workers/hs-verify-gate で)   1 つでも落ちたら exit 1。
import worker from "../src/worker.js";

const EXT = "https://gate.horizonshield.dev/ext/conduct/v1";
const O = "https://gate.redteam.invalid";
const kv = (() => { const m = new Map(); return { get: async (k, o) => { const v = m.get(k); if (v === undefined) return null; return (o === "json" || (o && o.type === "json")) ? JSON.parse(v) : v; }, put: async (k, v) => { m.set(k, String(v)); }, list: async (o) => ({ keys: [...m.keys()].filter((k) => k.startsWith((o && o.prefix) || "")).map((name) => ({ name })), list_complete: true }), delete: async (k) => { m.delete(k); } }; })();
const ENV = { HS_VERIFY_KV: kv, GATE_COMMIT: "a2a-face-local" };
const CTX = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };

let fails = 0;
const chk = (name, cond, extra) => { console.log((cond ? "PASS  " : "FAIL  ") + name + (cond ? "" : "  <<< " + (extra || ""))); if (!cond) fails++; };
const post = async (path, body, headers) => {
  const r = await worker.fetch(new Request(O + path, { method: "POST", headers: { "content-type": "application/json", ...(headers || {}) }, body: JSON.stringify(body) }), ENV, CTX);
  return { s: r.status, ext: r.headers.get("a2a-extensions"), extLegacy: r.headers.get("x-a2a-extensions"), j: await r.json() };
};

// card
const card = await (await worker.fetch(new Request(O + "/.well-known/agent-card.json"), ENV, CTX)).json();
chk("card: supportedInterfaces[0] is JSONRPC 1.0 at /a2a, [1] is 0.3", Array.isArray(card.supportedInterfaces) && card.supportedInterfaces[0].protocolBinding === "JSONRPC" && card.supportedInterfaces[0].protocolVersion === "1.0" && card.supportedInterfaces[0].url === O + "/a2a" && card.supportedInterfaces[1].protocolVersion === "0.3", JSON.stringify(card.supportedInterfaces));
chk("card: 0.3 keys point at the same /a2a", card.url === O + "/a2a" && card.preferredTransport === "JSONRPC" && card.protocolVersion === "0.3.0");
chk("card: media types, not the word text", card.defaultInputModes[0] === "text/plain" && card.defaultOutputModes.includes("application/json"));
chk("card: still declares the conduct extension, not required", card.capabilities.extensions.some((e) => e.uri === EXT && e.required === false));

// 1.0 wire, A2A-Extensions
let r = await post("/a2a", { jsonrpc: "2.0", id: 1, method: "SendMessage", params: { message: { messageId: "m1", role: "ROLE_USER", parts: [{ text: "how is https://srv.redteam.invalid/mcp doing?" }] } } }, { "a2a-extensions": EXT + ",https://example.invalid/other/v1", "a2a-version": "1.0" });
chk("1.0: result is {message} (no kind), role ROLE_AGENT", r.s === 200 && r.j.result && r.j.result.message && r.j.result.kind === undefined && r.j.result.message.role === "ROLE_AGENT", JSON.stringify(r.j).slice(0, 200));
chk("1.0: parts have no kind; a text part and a data part", r.j.result.message.parts.every((p) => p.kind === undefined) && r.j.result.message.parts.some((p) => typeof p.text === "string") && r.j.result.message.parts.some((p) => p.data && typeof p.data === "object"));
chk("1.0: the data part is the is-verified reading (absent, verified null, never false)", (() => { const d = r.j.result.message.parts.find((p) => p.data).data; return d.endpoint === "https://srv.redteam.invalid/mcp" && d.state === "absent" && d.verified === null && d.on_register === false; })(), JSON.stringify(r.j.result.message.parts.find((p) => p.data).data).slice(0, 200));
chk("1.0: echo header carries only the implemented URI", r.ext === EXT && r.extLegacy === null, r.ext + " / " + r.extLegacy);
chk("1.0: metadata has exactly the 3 conduct keys", r.j.result.message.metadata && Object.keys(r.j.result.message.metadata).length === 3 && r.j.result.message.metadata[EXT + "/endpoint"] === O + "/mcp", JSON.stringify(r.j.result.message.metadata));
chk("1.0: Message.extensions lists the URI", Array.isArray(r.j.result.message.extensions) && r.j.result.message.extensions.includes(EXT));

// 0.3 wire, X-A2A-Extensions only
r = await post("/a2a", { jsonrpc: "2.0", id: 2, method: "message/send", params: { message: { messageId: "m2", role: "user", kind: "message", parts: [{ kind: "text", text: "https://srv.redteam.invalid/mcp" }] } } }, { "x-a2a-extensions": EXT });
chk("0.3: result keeps kind: message, role agent, parts with kind", r.j.result && r.j.result.kind === "message" && r.j.result.role === "agent" && r.j.result.parts.every((p) => typeof p.kind === "string"), JSON.stringify(r.j).slice(0, 200));
chk("0.3: X-A2A-Extensions alone activates; echo comes back in both spellings", r.ext === EXT && r.extLegacy === EXT && r.j.result.metadata && r.j.result.extensions.includes(EXT), r.ext + " / " + r.extLegacy);

// no activation
r = await post("/a2a", { jsonrpc: "2.0", id: 3, method: "SendMessage", params: { message: { messageId: "m3", role: "ROLE_USER", parts: [{ text: "https://srv.redteam.invalid/mcp" }] } } });
chk("no activation: no echo, no metadata, no extensions", r.ext === null && r.extLegacy === null && r.j.result.message.metadata === undefined && r.j.result.message.extensions === undefined);

// no URL: usage, not an error
r = await post("/a2a", { jsonrpc: "2.0", id: 4, method: "SendMessage", params: { message: { messageId: "m4", role: "ROLE_USER", parts: [{ text: "hello there" }] } } });
chk("no URL in the text: a usage Message, not a JSON-RPC error", r.j.result && r.j.result.message && !r.j.error && r.j.result.message.parts[0].text.startsWith("Send an MCP endpoint URL"));

// wrong method, bad envelope, GET
r = await post("/a2a", { jsonrpc: "2.0", id: 5, method: "tasks/get", params: {} });
chk("unknown method: -32601", r.j.error && r.j.error.code === -32601);
r = await post("/a2a", { id: 6, method: "SendMessage" });
chk("no jsonrpc envelope: -32600", r.j.error && r.j.error.code === -32600);
const g = await worker.fetch(new Request(O + "/a2a"), ENV, CTX);
chk("GET /a2a answers 200 with methods and the extension", g.status === 200 && (await g.json()).methods.includes("SendMessage"));

// no storage
const r2 = await worker.fetch(new Request(O + "/a2a", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "SendMessage", params: { message: { messageId: "m7", role: "ROLE_USER", parts: [{ text: "https://srv.redteam.invalid/mcp" }] } } }) }), { GATE_COMMIT: "x" }, CTX);
const j2 = await r2.json();
chk("no KV bound: -32000 storage_unavailable, and it says this is not 'not verified'", j2.error && j2.error.code === -32000 && /NOT 'not verified'/.test(j2.error.message));

// the served spec still matches the file beside it
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const md = await readFile(new URL("../ext/CONDUCT_EXT_v1.md", import.meta.url), "utf8");
const served = await (await worker.fetch(new Request(O + "/ext/conduct/v1", { headers: { accept: "text/markdown" } }), ENV, CTX)).text();
const specJson = await (await worker.fetch(new Request(O + "/ext/conduct/v1"), ENV, CTX)).json();
chk("served spec markdown equals ext/CONDUCT_EXT_v1.md byte for byte", served === md);
chk("spec JSON sha256 matches the file", specJson.spec_markdown_sha256 === createHash("sha256").update(md, "utf8").digest("hex"), specJson.spec_markdown_sha256);
chk("spec JSON names the license and the a2a endpoint", /Apache-2.0/.test(specJson.license) && /\/a2a/.test(specJson.a2a_endpoint));

console.log(fails ? "\n" + fails + " FAIL" : "\nhs-verify-gate a2a face: ALL PASS");
process.exit(fails ? 1 : 0);
