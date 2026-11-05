// azurite.mjs  試験だけの道具。手元の Azurite(127.0.0.1 の 10000 と 10002)に繋ぐ client を作る。
// 接続文字列の鍵は Azurite の文書に載っている開発用の既定の値で、秘密ではない。網には出ない(endpoint は 127.0.0.1 だけ)。
import { TableClient } from "@azure/data-tables";
import { BlobServiceClient } from "@azure/storage-blob";

export const AZURITE_CS = process.env.AZURITE_CS ||
  "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;" +
  "AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;" +
  "TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;";

let n = 0;
// 名は試験ごとに新しくする(同じ Azurite を何本の試験が使っても混ざらない)。
export function uniqueName(tag) {
  n += 1;
  return (tag + process.pid.toString(36) + Date.now().toString(36) + n).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);
}
export async function newTable(tag = "t") {
  const t = TableClient.fromConnectionString(AZURITE_CS, uniqueName(tag), { allowInsecureConnection: true });
  await t.createTable();
  return t;
}
export async function newContainer(tag = "c") {
  const c = BlobServiceClient.fromConnectionString(AZURITE_CS).getContainerClient(uniqueName(tag));
  await c.createIfNotExists();
  return c;
}
export async function newClients(tag = "g") {
  return { kvTable: await newTable(tag + "kv"), leaseTable: await newTable(tag + "ls"), container: await newContainer(tag + "bl"), via: "azurite" };
}
