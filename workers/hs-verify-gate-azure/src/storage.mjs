// storage.mjs  Table と Blob の client を作る。2 つの道:
//   GATE_STORAGE_ACCOUNT    本番。managed identity(DefaultAzureCredential)で
//                           https://<account>.table.core.windows.net と https://<account>.blob.core.windows.net に繋ぐ。
//                           user assigned の identity なら AZURE_CLIENT_ID に client id を入れる
//   GATE_STORAGE_CONNECTION 試験(Azurite)。接続文字列。http の endpoint は 127.0.0.1 と localhost の時だけ許す
// table と container はここでは作らない(本番は deploy の台本が作る。関数の identity に作る権限を持たせない)。

import { TableClient } from "@azure/data-tables";
import { BlobServiceClient } from "@azure/storage-blob";

export const DEFAULT_NAMES = Object.freeze({
  kvTable: "hsverifykv",
  leaseTable: "hssweeplease",
  blobContainer: "hs-verify-kv-large",
});

function loopbackOnly(cs) {
  const eps = String(cs).split(";").filter((p) => /^(Table|Blob)Endpoint=/i.test(p)).map((p) => p.slice(p.indexOf("=") + 1));
  return eps.length > 0 && eps.every((u) => { try { const h = new URL(u).hostname; return h === "127.0.0.1" || h === "localhost"; } catch (_e) { return false; } });
}

export async function makeStorageClients(env, names = {}) {
  const n = { ...DEFAULT_NAMES, ...names };
  const cs = env.GATE_STORAGE_CONNECTION;
  if (cs) {
    const insecure = /^DefaultEndpointsProtocol=http;/i.test(cs) || /Endpoint=http:\/\//i.test(cs);
    if (insecure && !loopbackOnly(cs)) throw new Error("storage: an http endpoint is allowed only on 127.0.0.1 or localhost (Azurite)");
    const opt = insecure ? { allowInsecureConnection: true } : {};
    return {
      kvTable: TableClient.fromConnectionString(cs, n.kvTable, opt),
      leaseTable: TableClient.fromConnectionString(cs, n.leaseTable, opt),
      container: BlobServiceClient.fromConnectionString(cs).getContainerClient(n.blobContainer),
      via: "connection_string",
    };
  }
  const account = env.GATE_STORAGE_ACCOUNT;
  if (!account || !/^[a-z0-9]{3,24}$/.test(account)) throw new Error("storage: GATE_STORAGE_ACCOUNT (3 to 24 lower case letters and digits) or GATE_STORAGE_CONNECTION is required");
  const { DefaultAzureCredential } = await import("@azure/identity");
  const cred = new DefaultAzureCredential(env.AZURE_CLIENT_ID ? { managedIdentityClientId: env.AZURE_CLIENT_ID } : {});
  return {
    kvTable: new TableClient("https://" + account + ".table.core.windows.net", n.kvTable, cred),
    leaseTable: new TableClient("https://" + account + ".table.core.windows.net", n.leaseTable, cred),
    container: new BlobServiceClient("https://" + account + ".blob.core.windows.net", cred).getContainerClient(n.blobContainer),
    via: "managed_identity",
  };
}
