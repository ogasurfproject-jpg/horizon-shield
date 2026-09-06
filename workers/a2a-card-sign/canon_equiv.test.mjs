// 扉の cardSignatureCanonical(schema で書いた写し)が、公式 SDK の canonicalizeAgentCard と同じ bytes を出すことを確かめる。
// ここが割れたら、扉は署名を「無効」と誤読する。割れたら扉側を直す(公式 SDK が正)。
// 使い方: node canon_equiv.test.mjs      1 つでも落ちたら exit 1。
import { createHash } from "node:crypto";
import { canonicalizeAgentCard } from "@a2a-js/sdk";
import { cardSignatureCanonical } from "../hs-verify-gate/src/worker.js";
import { loadWorker, makeEnv, ctx, installLedgerFetchBridge } from "../hs-mcp/test/local_env.mjs";
import { resolve, dirname } from "node:path";

const HERE = dirname(new URL(import.meta.url).pathname);
let fails = 0;
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
const chk = (name, card) => {
  const sdk = canonicalizeAgentCard(JSON.parse(JSON.stringify(card)));
  const { canonical, unsupported } = cardSignatureCanonical(card);
  const ok = !unsupported && canonical === sdk;
  console.log((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : "  <<< gate " + sha(canonical) + " sdk " + sha(sdk) + (unsupported ? " unsupported=" + unsupported : "")));
  if (!ok) {
    // 最初の差分位置を出す
    let i = 0; while (i < canonical.length && canonical[i] === sdk[i]) i++;
    console.log("      diff at " + i + ": gate ..." + canonical.slice(Math.max(0, i - 40), i + 60) + "\n                 sdk ..." + sdk.slice(Math.max(0, i - 40), i + 60));
    fails++;
  }
};

// 1. 本物の 4 card + femtech
const targets = [["../hs-mcp/src/mcp.js", "https://mcp.horizonshield.dev"], ["../hs-verify-gate/src/worker.js", "https://gate.horizonshield.dev"], ["../hs-ledger/src/worker.js", "https://ledger.horizonshield.dev"], ["../hs-jidec-mcp/src/worker.js", "https://jidec.horizonshield.dev"], [process.env.FEMTECH_WORKER || resolve(process.env.HOME || "/", "hs-femtech-mcp/src/worker.js"), "https://femtech.horizonshield.dev"]];
for (const [rel, origin] of targets) {
  const p = rel.startsWith("/") ? rel : resolve(HERE, rel);
  let w; try { w = await loadWorker(p); } catch (_e) { console.log("skip  " + rel); continue; }
  const env = makeEnv(); if (/jidec/.test(rel)) await installLedgerFetchBridge(resolve(HERE, "../hs-ledger/src/worker.js"), env);
  const card = await (await w.fetch(new Request(origin + "/.well-known/agent-card.json"), env, ctx)).json();
  chk("live card: " + rel, card);
  chk("live card with a fake signatures entry: " + rel, Object.assign({}, card, { signatures: [{ protected: "eyJ", signature: "AAAA" }] }));
}

// 2. 合成: 既定値、tenant、iconUrl、extendedAgentCard、inputModes、snake_case、空配列、余計な鍵
const base = { name: "X", description: "d", version: "1", supportedInterfaces: [{ url: "https://x.invalid/a2a", protocolBinding: "JSONRPC", protocolVersion: "1.0" }], capabilities: {}, defaultInputModes: ["text/plain"], defaultOutputModes: ["text/plain"], skills: [{ id: "s", name: "S", description: "sd", tags: ["t"] }] };
chk("minimal card", base);
chk("defaults false/0/empty are omitted", Object.assign({}, base, { capabilities: { streaming: false, pushNotifications: false, extensions: [] }, documentationUrl: "", iconUrl: "" }));
chk("explicit true bools kept", Object.assign({}, base, { capabilities: { streaming: true, pushNotifications: true, extendedAgentCard: true } }));
chk("tenant and iconUrl kept when set", Object.assign({}, base, { iconUrl: "https://x.invalid/i.png", supportedInterfaces: [{ url: "https://x.invalid/a2a", protocolBinding: "JSONRPC", protocolVersion: "1.0", tenant: "t1" }] }));
chk("extension with params struct incl. numbers, nested arrays, nulls", Object.assign({}, base, { capabilities: { extensions: [{ uri: "https://e.invalid/v1", description: "", required: false, params: { a: 0, b: 1.5, c: [1, "x", null, { d: false }], e: "" } }] } }));
chk("struct pruning: null / empty string / {} / [] drop, false and 0 stay, nested empties collapse", Object.assign({}, base, { capabilities: { extensions: [{ uri: "u", params: { n: null, e: "", o: {}, l: [], f: false, z: 0, deep: { only: { nulls: null } }, arr: [null, "", {}, [], false, 0, [null]] } }] } }));
chk("struct numbers: 1e21, 0.1, -0, 2^53+1, 1.0", Object.assign({}, base, { capabilities: { extensions: [{ uri: "u", params: { a: 1e21, b: 0.1, c: -0, d: 123456789012345680000, e: 9007199254740993, f: 1.0 } }] } }));
chk("struct only nulls -> params omitted", Object.assign({}, base, { capabilities: { extensions: [{ uri: "u", params: { a: null } }] } }));
chk("optional bools false are kept when present", Object.assign({}, base, { capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false } }));
chk("provider with empty strings -> omitted; REQUIRED empty strings -> omitted", Object.assign({}, base, { name: "", provider: { organization: "", url: "" } }));
chk("extension required:true kept", Object.assign({}, base, { capabilities: { extensions: [{ uri: "https://e.invalid/v1", required: true }] } }));
chk("skills with examples/inputModes/outputModes", Object.assign({}, base, { skills: [{ id: "s", name: "S", description: "sd", tags: ["t", "u"], examples: ["e1"], inputModes: ["text/plain"], outputModes: ["application/json"] }] }));
chk("snake_case keys are read as camelCase", { name: "X", description: "d", version: "1", supported_interfaces: [{ url: "https://x.invalid/a2a", protocol_binding: "JSONRPC", protocol_version: "1.0" }], capabilities: { push_notifications: true }, default_input_modes: ["text/plain"], default_output_modes: ["text/plain"], skills: [{ id: "s", name: "S", description: "sd", tags: ["t"] }], documentation_url: "https://x.invalid/doc" });
chk("0.3 keys and unknown top-level keys are dropped", Object.assign({}, base, { url: "https://x.invalid", preferredTransport: "JSONRPC", protocolVersion: "0.3.0", compensation: { paid_by: "buyer" }, ledger: { a: 1 }, stateTransitionHistory: false }));
chk("provider object kept, unicode kept", Object.assign({}, base, { provider: { organization: "The HORIZ音s株式会社", url: "https://h.invalid" }, description: "日本語 と emoji 🙂 と \"quotes\" と \\ backslash" }));
chk("key order in input does not matter", { skills: base.skills, defaultOutputModes: base.defaultOutputModes, defaultInputModes: base.defaultInputModes, capabilities: {}, supportedInterfaces: base.supportedInterfaces, version: "1", description: "d", name: "X" });

// 3. 読めん形は unsupported(有効とも無効とも言わん)
const sec = Object.assign({}, base, { securitySchemes: { apiKey: { apiKeySecurityScheme: { location: "header", name: "X-Key" } } } });
const r = cardSignatureCanonical(sec);
console.log((r.unsupported ? "PASS  " : "FAIL  ") + "securitySchemes present -> unsupported (unverifiable), not a wrong canonical"); if (!r.unsupported) fails++;

console.log(fails ? "\n" + fails + " FAIL" : "\ncanon_equiv: ALL PASS (gate canonical form == official SDK canonical form)");
process.exit(fails ? 1 : 0);
