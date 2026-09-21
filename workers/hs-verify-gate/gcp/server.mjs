// server.mjs  Cloud Run の入口。扉(src/worker.js)を無改変で Node/Cloud Run に載せる。
// 起動: PORT(既定 8080)で listen。Firestore は ADC(Cloud Run のサービスアカウント)で繋ぐ。
// 秘密(WITNESS_PRIVKEY_B64 等)と設定は Cloud Run が Secret Manager / env から process.env に入れる。
import http from "node:http";
import { Firestore } from "@google-cloud/firestore";
import { makeKv } from "./kv_firestore.mjs";
import { makeNodeHandler } from "./http_bridge.mjs";

// card が名乗る正規 origin。twin は別ドメインなので、worker を読み込む前に立てる。
// worker.js 側は globalThis.CARD_ORIGIN_OVERRIDE を見て、無ければ従来の定数を使う。
if (process.env.CARD_ORIGIN) {
  globalThis.CARD_ORIGIN_OVERRIDE = String(process.env.CARD_ORIGIN).replace(/\/+$/, "");
}
const worker = (await import("../src/worker.js")).default;

const PORT = Number(process.env.PORT || 8080);
const firestore = new Firestore(); // GOOGLE_CLOUD_PROJECT / ADC を自動使用
const HS_VERIFY_KV = makeKv(firestore, process.env.KV_COLLECTION || "hs_verify_kv");

// worker が読む env。process.env(vars + Secret Manager 由来)に KV adapter を足すだけ。
// RELAY_URL / RELAY_TOKEN は Cloud Run では設定しない(自ゾーン迂回は不要。自分も直に叩ける)。
const env = { ...process.env, HS_VERIFY_KV };

const handler = makeNodeHandler({ worker, env, cronToken: process.env.CRON_TOKEN || "" });

http.createServer(handler).listen(PORT, () => {
  console.log("tsugi-gate listening on :" + PORT + " (KV: " + (process.env.KV_COLLECTION || "hs_verify_kv") + ", origin: " + ((typeof globalThis !== "undefined" && globalThis.CARD_ORIGIN_OVERRIDE) || "default") + ")");
});
