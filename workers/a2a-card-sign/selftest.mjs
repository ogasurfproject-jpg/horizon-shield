// 鍵無しで全体の流れを証明する: 5 つの Worker それぞれについて、一時コピーに使い捨ての P-256 鍵で署名を書き込み、
// 正規 origin で配られる card を公式 verifier(jwks は Worker 自身が配る)で検証。改ざんは落ちる、別 origin では signatures が付かん、も見る。
// 使い方: node selftest.mjs      1 つでも落ちたら exit 1。
import { mkdtemp, copyFile, readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { ephemeralKey, renderCard, signCard, writeSignatureConstant, verifyServed, BEGIN } from "./sign_lib.mjs";
import { loadWorker, makeEnv, ctx, installLedgerFetchBridge } from "../hs-mcp/test/local_env.mjs";

const HERE = dirname(new URL(import.meta.url).pathname);
const TARGETS = [
  ["../hs-mcp/src/mcp.js", "https://mcp.horizonshield.dev"],
  ["../hs-verify-gate/src/worker.js", "https://gate.horizonshield.dev"],
  ["../hs-ledger/src/worker.js", "https://ledger.horizonshield.dev"],
  ["../hs-jidec-mcp/src/worker.js", "https://jidec.horizonshield.dev"],
  [process.env.FEMTECH_WORKER || resolve(process.env.HOME || "/", "hs-femtech-mcp/src/worker.js"), "https://femtech.horizonshield.dev"]
];
let fails = 0;
const chk = (name, cond, extra) => { console.log((cond ? "PASS  " : "FAIL  ") + name + (cond ? "" : "  <<< " + (extra || ""))); if (!cond) fails++; };

const leftovers = [];
async function rmQuiet(p) { try { await unlink(p); } catch (_e) { leftovers.push(p); } }
// 公式 verifier は落ちるとき console.debug に stack を吐く。期待どおりの失敗を静かに見るため、その間だけ黙らせる。
const quiet = async (fn) => { const cd = console.debug, ce = console.error; console.debug = () => {}; console.error = () => {}; try { return await fn(); } finally { console.debug = cd; console.error = ce; } };

for (const [rel, origin] of TARGETS) {
  const src = rel.startsWith("/") ? rel : resolve(HERE, rel);
  let text; try { text = await readFile(src, "utf8"); } catch (_e) { console.log("skip  " + rel + " (not found)"); continue; }
  if (!text.includes(BEGIN)) { chk(rel + ": has signature markers", false, "markers missing"); continue; }
  // 相対 import を持つ Worker(扉)は同じディレクトリでしか読めんので src/ の隣に一時コピーを置く。持たん Worker は OS の tmp に置く。
  const sameDir = /^\s*import\s.+from\s+["']\.\.?\//m.test(text);
  const dir = sameDir ? dirname(src) : await mkdtemp(join(tmpdir(), "a2a-card-selftest-"));
  const stamp = Date.now() + "-" + Math.random().toString(16).slice(2, 8);
  const tmp = join(dir, (sameDir ? "worker" : "w") + ".selftest-sign-" + stamp + ".js");
  const bust = join(dir, (sameDir ? "worker" : "w") + ".selftest-sign-" + stamp + "-b.js");
  await copyFile(src, tmp);
  try {
    const key = ephemeralKey();
    const card = await renderCard(tmp, origin);
    const rec = await signCard(card, key, "selftest-key", origin + "/.well-known/jwks.json");
    await writeSignatureConstant(tmp, rec);
    await writeFile(bust, await readFile(tmp, "utf8"));
    const worker = await loadWorker(bust);
    const env = makeEnv();
    if (/hs-jidec-mcp/.test(rel)) await installLedgerFetchBridge(resolve(HERE, "../hs-ledger/src/worker.js"), env);
    const served = await (await worker.fetch(new Request(origin + "/.well-known/agent-card.json"), env, ctx)).json();
    chk(rel + ": served card at canonical origin carries 1 signature", Array.isArray(served.signatures) && served.signatures.length === 1);
    const jwks = await (await worker.fetch(new Request(origin + "/.well-known/jwks.json"), env, ctx)).json();
    chk(rel + ": /.well-known/jwks.json serves the public key with kid", jwks.keys && jwks.keys[0] && jwks.keys[0].kid === "selftest-key" && jwks.keys[0].kty === "EC" && !jwks.keys[0].d, JSON.stringify(jwks).slice(0, 120));
    let ok = true, err = "";
    try { await verifyServed(served, async () => jwks); } catch (e) { ok = false; err = String(e.message || e); }
    chk(rel + ": official @a2a-js/sdk verifier accepts the served card", ok, err);
    const tampered = JSON.parse(JSON.stringify(served)); tampered.description = tampered.description + " (tampered)";
    let ok2 = true; try { await quiet(() => verifyServed(tampered, async () => jwks)); } catch (_e) { ok2 = false; }
    chk(rel + ": a one-word change to the card breaks the signature", !ok2);
    const tampered2 = JSON.parse(JSON.stringify(served));
    const ext = tampered2.capabilities.extensions.find((e) => e.uri === "https://gate.horizonshield.dev/ext/conduct/v1");
    if (ext) { ext.params.compensation.referral_fee = true; let ok3 = true; try { await quiet(() => verifyServed(tampered2, async () => jwks)); } catch (_e) { ok3 = false; } chk(rel + ": flipping compensation.referral_fee inside the extension breaks the signature (the signature covers the disclosure)", !ok3); }
    const other = await (await worker.fetch(new Request("https://something.oga-surf-project.workers.dev/.well-known/agent-card.json"), env, ctx)).json();
    chk(rel + ": the same card at a non-canonical origin carries no signatures", other.signatures === undefined);
  } finally {
    await rmQuiet(bust); await rmQuiet(tmp);
  }
}
if (leftovers.length) console.log("note: could not delete temporary copies (no delete permission here); remove by hand:\n  rm " + leftovers.join(" "));
console.log(fails ? "\n" + fails + " FAIL" : "\na2a-card-sign selftest: ALL PASS");
process.exit(fails ? 1 : 0);
