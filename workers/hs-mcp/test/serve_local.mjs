// 本物の Worker module を node:http で包んで local に立てる(env は local_env.mjs の空の店)。他言語の公式 SDK を当てるための足場。
// 使い方: node test/serve_local.mjs ./src/mcp.js            -> 1 行目に PORT=<n> を出す。Ctrl-C で止まる。
//         node test/serve_local.mjs ../hs-ledger/src/worker.js
import { makeEnv, serve, installLedgerFetchBridge, siblingLedgerPath } from "./local_env.mjs";
const MODULE = process.argv[2] || "./src/mcp.js";
const ORIGIN = process.argv[3] || "https://mcp.horizonshield.dev";
const env = makeEnv();
if (/hs-jidec-mcp/.test(MODULE)) await installLedgerFetchBridge(siblingLedgerPath(MODULE), env);
const { base } = await serve(MODULE, ORIGIN, env);
console.log("PORT=" + base.split(":").pop());
