// env.mjs  worker.js に渡す env を組み立てる。
// 値は process.env から、決めた名だけを写す(GATE_VARS)。秘密(SWEEP_TOKEN、WITNESS_PRIVKEY_B64 など)は app settings の
// Key Vault 参照(@Microsoft.KeyVault(SecretUri=...))で入れる。参照は Functions の platform が解いて process.env に置く。
// 解けなかった参照は「@Microsoft.KeyVault(」で始まる文字のまま残るので、その名は env に入れず、名だけを unresolved に返す
// (値は返さない、log にも書かない)。
// 写しは測る場所なので、GATE_PUBLIC_ORIGIN と GATE_COMMIT が無ければ動かない(記録に Cloudflare の origin や
// "unpinned" を焼き込まないため)。GATE_PLATFORM、OWN_ROWS、GATE_PATHS は、無ければ写しの値を入れる。

import { makeStorageClients } from "./storage.mjs";
import { makeKvOnTable } from "./kv_table.mjs";
import { makeLeaseNamespace } from "./lease_table.mjs";
import { makeBlobText } from "./blob_text.mjs";

// worker.js、witness.js、key_history.js、ae_challenge.js、nenrin_instant.js が env から読む名(試験が grep で縛る)。
export const GATE_VARS = Object.freeze([
  "SWEEP_TOKEN", "SWEEP_ONLY_TOKEN",
  "WITNESS_PRIVKEY_B64", "WITNESS_PUBKEY_B64", "OPERATOR_PUBKEY_B64", "AGREEMENT_PUBKEY_B64",
  "OPENAI_APPS_CHALLENGE", "GATE_COMMIT", "SUBREQUEST_BUDGET", "AE_RECEIPT_STORE",
  "GATE_PLATFORM", "GATE_PUBLIC_ORIGIN", "OWN_ROWS", "GATE_PATHS",
  // 0.4.23. 写しが掃引の初めに読む Marketplace の毎日の一覧。URL は app settings の値で替えられる(今の Marketplace の
  // https://marketplace.horizonshield.dev/admin/daily か、Marketplace を別の app に置いた時の物)。鍵は Key Vault 参照で入れる
  // (hs-ms-marketplace の DAILY_READ_TOKEN と同じ値。GET /admin/daily だけを開ける)。
  "MARKETPLACE_DAILY_URL", "MARKETPLACE_DAILY_TOKEN",
]);
// 読まれるが渡さない名。RELAY_URL と RELAY_TOKEN は Cloudflare の同じゾーンの 522 を避ける中継、MCP_SVC は service binding。
// REPLICA_ORIGIN と REPLICA_PLATFORM は扉の役だけが読む(写しの記録を取り込む側)。写し(GATE_PATHS=replica)は読まないので渡さない。
export const GATE_NOT_PASSED = Object.freeze(["RELAY_URL", "RELAY_TOKEN", "MCP_SVC", "REPLICA_ORIGIN", "REPLICA_PLATFORM"]);
export const REPLICA_DEFAULTS = Object.freeze({ GATE_PLATFORM: "azure", OWN_ROWS: "off", GATE_PATHS: "replica" });
export const REQUIRED = Object.freeze(["GATE_PUBLIC_ORIGIN", "GATE_COMMIT", "SWEEP_TOKEN"]);

const KV_REF = /^@Microsoft\.KeyVault\(/;

export function pickVars(processEnv) {
  const vars = {};
  const unresolved = [];
  for (const name of GATE_VARS) {
    const v = processEnv[name];
    if (typeof v !== "string" || v === "") continue;
    if (KV_REF.test(v)) { unresolved.push(name); continue; }
    vars[name] = v;
  }
  for (const [k, v] of Object.entries(REPLICA_DEFAULTS)) if (!(k in vars)) vars[k] = v;
  const missing = REQUIRED.filter((k) => !vars[k]);
  return { vars, unresolved, missing };
}

// clients を渡せば(試験)それを使う。渡さなければ storage.mjs が process.env から作る。
export async function buildEnv(processEnv, { clients } = {}) {
  const { vars, unresolved, missing } = pickVars(processEnv);
  const c = clients || await makeStorageClients(processEnv);
  const blobs = makeBlobText(c.container);
  const env = {
    ...vars,
    HS_VERIFY_KV: makeKvOnTable({ table: c.kvTable, blobs, partition: "kv" }),
    SWEEP_LEASE_DO: makeLeaseNamespace({ table: c.leaseTable }),
  };
  return { env, unresolved, missing, clients: c, blobs };
}
