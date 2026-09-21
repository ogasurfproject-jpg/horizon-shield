// server.mjs  Cloud Run の入口。台帳(src/worker.js)を無改変で Node/Cloud Run に載せる。
// 扉(hs-verify-gate)の twin と同じ三点セット: KV は Firestore、DO は Firestore
// transaction、service binding は素の HTTPS fetch。worker.js は 1 バイトも変えない。
import http from "node:http";
import { Firestore } from "@google-cloud/firestore";
import { makeKv } from "./kv_firestore.mjs";
import { makeNodeHandler } from "./http_bridge.mjs";
import { makeAgreementDedupeDO } from "./firestore_dedupe_do.mjs";

const worker = (await import("../src/worker.js")).default;

const PORT = Number(process.env.PORT || 8080);
const firestore = new Firestore(); // GOOGLE_CLOUD_PROJECT / ADC を自動使用
const LEDGER = makeKv(firestore, process.env.KV_COLLECTION || "hs_ledger_kv");
const AGREEMENT_DEDUPE_DO = makeAgreementDedupeDO(
  firestore,
  process.env.DEDUPE_COLLECTION || "hs_ledger_agreement_dedupe"
);

// service binding は GCP では素の HTTPS fetch になる。Cloud Run は Cloudflare
// アカウントの外なので、公開 gate / pdf-gen を叩いても自ゾーン loopback(false
// drift の原因)にはならない。だから passthrough で良い。
// KANBAN_AE(Analytics Engine)は GCP に等価物が無い。worker 側は
// typeof ae.writeDataPoint === "function" で守っており、無ければ静かに飛ばすので、
// あえて渡さない(計測が減るだけで検証能力は落ちない)。
const passthrough = { fetch: (...a) => fetch(...a) };

const env = {
  ...process.env,
  LEDGER,
  AGREEMENT_DEDUPE_DO,
  GATE: passthrough,
  PDF_GEN: passthrough,
};

const handler = makeNodeHandler({ worker, env, cronToken: process.env.CRON_TOKEN || "" });

http.createServer(handler).listen(PORT, () => {
  console.log(
    "hs-ledger twin listening on :" + PORT +
    " (KV: " + (process.env.KV_COLLECTION || "hs_ledger_kv") +
    ", dedupe: " + (process.env.DEDUPE_COLLECTION || "hs_ledger_agreement_dedupe") + ")"
  );
});
