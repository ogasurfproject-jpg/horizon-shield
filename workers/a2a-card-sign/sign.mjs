// 使い方(鍵を持つ Mac で):
//   node sign.mjs --worker ../hs-mcp/src/mcp.js --origin https://mcp.horizonshield.dev --key ~/.hs_card_key.pem --kid hs-2026-09
// 何をするか: Worker のソースから card を描く(env は空) -> 公式 SDK の generator で ES256 署名 -> 公式 verifier で確認 ->
//            Worker のソースの CARD_SIGNATURE 定数を書き換える。鍵の中身は出さん。
// 鍵の作り方(一度だけ、repo の外に): openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out ~/.hs_card_key.pem && chmod 600 ~/.hs_card_key.pem
import { readFile } from "node:fs/promises";
import { renderCard, keyFromPem, signCard, writeSignatureConstant } from "./sign_lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]] : null).filter(Boolean));
for (const k of ["worker", "origin", "key", "kid"]) if (!args[k]) { console.error("missing --" + k); process.exit(2); }
const origin = args.origin.replace(/\/+$/, "");
const jku = args.jku || origin + "/.well-known/jwks.json";

const key = keyFromPem(await readFile(args.key.replace(/^~/, process.env.HOME), "utf8"));
const card = await renderCard(args.worker, origin);
const rec = await signCard(card, key, args.kid, jku);
await writeSignatureConstant(args.worker, rec);
console.log(JSON.stringify({ worker: args.worker, origin, kid: rec.kid, jku: rec.jku, canonical_sha256: rec.canonical_sha256, signature_head: rec.signature.slice(0, 12), written: true }, null, 2));
