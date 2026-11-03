// server.mjs  Cloud Run の入口。台帳(src/worker.js)を無改変で Node/Cloud Run に載せる。
// 扉(hs-verify-gate)の twin と同じ三点セット: KV は Firestore、DO は Firestore
// transaction、service binding は素の HTTPS fetch。worker.js は 1 バイトも変えない。
import http from "node:http";
import { Firestore } from "@google-cloud/firestore";
import { makeKv } from "./kv_firestore.mjs";
import { makeNodeHandler } from "./http_bridge.mjs";
import { makeAgreementDedupeDO } from "./firestore_dedupe_do.mjs";
import { serviceBindings } from "./bindings.mjs";

// worker.js は名前付きの入口のために "cloudflare:workers" を import する(2026-11-02)。Node には無いので、
// 同じ形の代わりに解決してから読む(Cloud Run では入口の RPC は使わない。fetch と scheduled だけを使う)。
import "../src/node_cloudflare_workers.mjs";
const worker = (await import("../src/worker.js")).default;

const PORT = Number(process.env.PORT || 8080);
const firestore = new Firestore(); // GOOGLE_CLOUD_PROJECT / ADC を自動使用
const KV_COLLECTION = process.env.KV_COLLECTION || "hs_ledger_kv";
const LEDGER = makeKv(firestore, KV_COLLECTION);
// 2026-10-13 L1r: the DO shim also sequences /ledger-append in a Firestore transaction over the KV
// collection's seq / entry:n / hash:h docs, so it gets the same collection name as LEDGER.
const AGREEMENT_DEDUPE_DO = makeAgreementDedupeDO(
  firestore,
  process.env.DEDUPE_COLLECTION || "hs_ledger_agreement_dedupe",
  KV_COLLECTION
);

// service binding は GCP では素の HTTPS fetch になる。Cloud Run は Cloudflare
// アカウントの外なので、公開 gate / pdf-gen を叩いても自ゾーン loopback(false
// drift の原因)にはならない。だから passthrough で良い。
// KANBAN_AE(Analytics Engine)は GCP に等価物が無い。worker 側は
// typeof ae.writeDataPoint === "function" で守っており、無ければ静かに飛ばすので、
// あえて渡さない(計測が減るだけで検証能力は落ちない)。
// 2026-11-03: the bindings, AGREEMENT_INTAKE included, come from bindings.mjs (the same file the parity test reads).

const env = {
  ...process.env,
  LEDGER,
  AGREEMENT_DEDUPE_DO,
  ...serviceBindings(),
};

const handler = makeNodeHandler({ worker, env, cronToken: process.env.CRON_TOKEN || "" });

http.createServer(handler).listen(PORT, () => {
  console.log(
    "hs-ledger twin listening on :" + PORT +
    " (KV: " + (process.env.KV_COLLECTION || "hs_ledger_kv") +
    ", dedupe: " + (process.env.DEDUPE_COLLECTION || "hs_ledger_agreement_dedupe") + ")"
  );
});
