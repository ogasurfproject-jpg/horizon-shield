// 公式 @a2a-js/sdk (1.1.0) の client で、この Worker の A2A 面を叩く。ネットワーク無し。
//
// なぜ: 自作 client で自作 server を叩いて PASS を出しても、それは鏡を見とるだけ。
//       A2A の外の人が使うのは公式 SDK。公式 SDK が (1) card を読めて (2) 拡張を有効化できて
//       (3) echo を受け取れて (4) 応答を型通りに読めて、初めて「A2A 1.0 に載った」と言える。
//
// 何を: 本物の src/mcp.js の fetch() を node:http で包み(env は空、KV 無しで A2A 面は動く)、
//       公式 SDK を 3 通りで当てる。
//         1.0   : ClientFactory 既定設定 (supportedInterfaces の 1.0 を選ぶ、SendMessage、A2A-Extensions)
//         0.3   : legacyCompat 有効 + 0.3 形の card (message/send、X-A2A-Extensions だけを送る)
//         なし  : 拡張を有効化しない (echo も metadata も付かんこと)
//
// 使い方 (workers/hs-mcp で):
//   npm i --no-save @a2a-js/sdk@1.1.0
//   node test/sdk_js_interop.mjs                 (この Worker)
//   node test/sdk_js_interop.mjs ../hs-ledger/src/worker.js /a2a   (他の Worker: module と A2A path)
//   node test/sdk_js_interop.mjs ../hs-jidec-mcp/src/worker.js /a2a
//   node test/sdk_js_interop.mjs ../hs-verify-gate/src/worker.js /a2a
// 1 つでも落ちたら exit 1。
import { ClientFactory, ClientFactoryOptions, DefaultAgentCardResolver, JsonRpcTransportFactory, ServiceParameters, withA2AExtensions } from "@a2a-js/sdk/client";
import { Role } from "@a2a-js/sdk";
import { makeEnv, serve, installLedgerFetchBridge, siblingLedgerPath } from "./local_env.mjs";

// SDK の core 型で書く(ts-proto の形: role は enum 値、part は content.$case)。JSON の {text} は線の上の形であって、SDK 利用者が書く形やない。
const userMessage = (id, text) => ({ messageId: id, role: Role.ROLE_USER, parts: [{ content: { $case: "text", value: text } }] });

const EXT = "https://gate.horizonshield.dev/ext/conduct/v1";
const MODULE = process.argv[2] || "./src/mcp.js";
const A2A_PATH = process.argv[3] || "/";
const TEXT = process.argv[4] || "a2a-conduct sdk interop: 外壁塗装で120万、今日契約なら半額と言われた";

const env = makeEnv();
if (/hs-jidec-mcp/.test(MODULE)) await installLedgerFetchBridge(siblingLedgerPath(MODULE), env);
const { server, base } = await serve(MODULE, "https://mcp.horizonshield.dev", env);

// 応答ヘッダを覗く fetch(SDK は型付きの結果だけ返し、ヘッダは見せんので、ここで捕まえる)
const seen = [];
const spyFetch = async (input, init) => {
  const r = await fetch(input, init);
  const reqH = {}; new Headers(init && init.headers).forEach((v, k) => { reqH[k] = v; });
  const resH = {}; r.headers.forEach((v, k) => { resH[k] = v; });
  let method = null; try { method = JSON.parse(init.body).method; } catch (_e) {}
  seen.push({ url: String(input), method, reqH, resH });
  return r;
};

let fails = 0;
const ok = (cond, name, extra) => { console.log((cond ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!cond) fails++; };
const msgOf = (r) => (r && r.status && r.status.message) ? r.status.message : r;  // Task か Message か
const cardUrl = base + "/.well-known/agent-card.json";
const liveCard = await (await fetch(cardUrl)).json();

// ---- 1. A2A 1.0 (公式 SDK 既定設定) ----
{
  seen.length = 0;
  const factory = new ClientFactory(ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
    transports: [new JsonRpcTransportFactory({ fetchImpl: spyFetch })],
    cardResolver: new DefaultAgentCardResolver({ fetchImpl: spyFetch })
  }));
  let client, err = null;
  try { client = await factory.createFromUrl(base); } catch (e) { err = e; }
  ok(!err, "1.0 card: official SDK builds a client from /.well-known/agent-card.json with default options", err ? String(err.message) : "");
  if (client) {
    // card から拾った endpoint を local に向け直す(card は本番 URL を書いとる)
    const iface = (client.agentCard.supportedInterfaces || []).find((i) => i.protocolVersion === "1.0");
    ok(!!iface, "1.0 card: a supportedInterfaces entry with protocolVersion 1.0 is present", iface ? iface.url : "");
  }
  // endpoint を local に向けるため、card を書き換えて createFromAgentCard
  const card10 = JSON.parse(JSON.stringify(liveCard));
  for (const i of (card10.supportedInterfaces || [])) i.url = base + A2A_PATH;
  card10.url = base + A2A_PATH;
  seen.length = 0;
  let result = null; err = null;
  try {
    const c10 = await factory.createFromAgentCard(card10);
    result = await c10.sendMessage({ message: userMessage("sdk-10-1", TEXT) },
      { serviceParameters: ServiceParameters.create(withA2AExtensions(EXT)) });
  } catch (e) { err = e; }
  const call = seen.find((s) => s.method);
  ok(!err, "1.0 wire: sendMessage returns without a parse error", err ? String(err.message) : "");
  ok(call && call.method === "SendMessage", "1.0 wire: the SDK sent method SendMessage", call && call.method);
  ok(call && call.reqH["a2a-extensions"] === EXT, "1.0 wire: the SDK sent A2A-Extensions", call && JSON.stringify(call.reqH["a2a-extensions"]));
  ok(call && call.resH["a2a-extensions"] === EXT, "1.0 wire: server echoed A2A-Extensions", call && JSON.stringify(call.resH["a2a-extensions"]));
  const m = msgOf(result);
  ok(result && result.metadata && result.metadata[EXT + "/endpoint"] && result.metadata[EXT + "/conduct_record"] && result.metadata[EXT + "/witness_intake"], "1.0 wire: the 3 conduct metadata keys are present on the parsed result", result && result.metadata ? Object.keys(result.metadata).length + " keys" : "");
  ok(m && Array.isArray(m.extensions) && m.extensions.includes(EXT), "1.0 wire: Message.extensions carries the URI", m && JSON.stringify(m.extensions));
  ok(m && (m.role === Role.ROLE_AGENT || m.role === "ROLE_AGENT"), "1.0 wire: role parsed as ROLE_AGENT", m && String(m.role));
}

// ---- 2. A2A 0.3 (legacyCompat, 0.3 形の card, X-A2A-Extensions のみ) ----
{
  const card03 = JSON.parse(JSON.stringify(liveCard));
  delete card03.supportedInterfaces;
  card03.url = base + A2A_PATH; card03.preferredTransport = "JSONRPC"; card03.protocolVersion = "0.3.0";
  const factory = new ClientFactory(ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
    transports: [new JsonRpcTransportFactory({ fetchImpl: spyFetch, legacyCompat: { enabled: true } })],
    cardResolver: new DefaultAgentCardResolver({ fetchImpl: spyFetch, legacyCompat: { enabled: true } })
  }));
  seen.length = 0;
  let result = null, err = null;
  try {
    const c03 = await factory.createFromAgentCard(card03);
    result = await c03.sendMessage({ message: userMessage("sdk-03-1", TEXT) },
      { serviceParameters: ServiceParameters.create(withA2AExtensions(EXT)) });
  } catch (e) { err = e; }
  const call = seen.find((s) => s.method);
  ok(!err, "0.3 wire: sendMessage returns without a parse error", err ? String(err.message) : "");
  ok(call && call.method === "message/send", "0.3 wire: the SDK sent method message/send", call && call.method);
  ok(call && call.reqH["x-a2a-extensions"] === EXT && !call.reqH["a2a-extensions"], "0.3 wire: the SDK sent only X-A2A-Extensions (the 0.3 spelling)", call && JSON.stringify([call.reqH["x-a2a-extensions"], call.reqH["a2a-extensions"]]));
  ok(call && call.resH["x-a2a-extensions"] === EXT, "0.3 wire: server echoed X-A2A-Extensions (the spelling the client used)", call && JSON.stringify(call.resH["x-a2a-extensions"]));
  ok(call && call.resH["a2a-extensions"] === EXT, "0.3 wire: server also echoed A2A-Extensions", call && JSON.stringify(call.resH["a2a-extensions"]));
  const m = msgOf(result);
  ok(result && result.metadata && result.metadata[EXT + "/endpoint"], "0.3 wire: conduct metadata keys present on the parsed result");
  ok(m && Array.isArray(m.extensions) && m.extensions.includes(EXT), "0.3 wire: Message.extensions carries the URI", m && JSON.stringify(m.extensions));
}

// ---- 3. 有効化なし: 何も付かん ----
{
  const card10 = JSON.parse(JSON.stringify(liveCard));
  for (const i of (card10.supportedInterfaces || [])) i.url = base + A2A_PATH;
  const factory = new ClientFactory(ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
    transports: [new JsonRpcTransportFactory({ fetchImpl: spyFetch })]
  }));
  seen.length = 0;
  let result = null;
  try { const c = await factory.createFromAgentCard(card10); result = await c.sendMessage({ message: userMessage("sdk-10-2", TEXT) }); } catch (_e) {}
  const call = seen.find((s) => s.method);
  ok(call && !call.resH["a2a-extensions"] && !call.resH["x-a2a-extensions"], "no activation: no echo header");
  ok(!(result && result.metadata && result.metadata[EXT + "/endpoint"]), "no activation: no conduct metadata");
}

server.close();
console.log(fails ? ("\n" + fails + " FAIL") : "\nALL PASS: official @a2a-js/sdk client, both wires, against " + MODULE + " " + A2A_PATH);
process.exit(fails ? 1 : 0);
