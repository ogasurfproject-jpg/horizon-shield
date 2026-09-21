// firestore_dedupe_do.mjs
// Firestore-backed twin of the Cloudflare Durable Object AGREEMENT_DEDUPE_DO.
// 台帳(hs-ledger)を Cloud Run に無改変で載せるための一部品。扉の kv_firestore.mjs /
// http_bridge.mjs と同じ考え方: worker 本体も DO クラス本体も書き換えず、周辺の
// binding だけ差し替える。
//
// Cloudflare 版は blockConcurrencyWhile が 1 インスタンス内の read-decide-write を
// 直列化して強整合を作る (agreement boundary 2.3)。GCP 版は同じ read-decide-write を
// Firestore の runTransaction 1 回に包む。1 canonical_sha256 == 1 doc == 1 transaction。
// AgreementDedupeDO クラスも decideDedupe 純関数も、Cloudflare 用のものをそのまま使う。
import { AgreementDedupeDO } from "../nenrin/agreement-v0/agreement_intake.mjs";

// 呼び出し側(agreement_intake.mjs doStore)は:
//   env.AGREEMENT_DEDUPE_DO.get(env.AGREEMENT_DEDUPE_DO.idFromName("agreement:"+sha))
//     .fetch("https://agreement-dedupe/claim" | "/get", { method:"POST", body })
// という Cloudflare DO stub の形で叩く。同じ形をここで満たす。
export function makeAgreementDedupeDO(firestore, collectionName = "hs_ledger_agreement_dedupe") {
  const col = firestore.collection(collectionName);
  const docIdFor = (name) => "d_" + Buffer.from(String(name), "utf8").toString("base64url");

  return {
    idFromName: (name) => String(name),
    get: (id) => ({
      async fetch(url, init) {
        const method = (init && init.method) || "GET";
        const headers = (init && init.headers) || {};
        const bodyStr = init && init.body != null ? String(init.body) : undefined;
        const docRef = col.doc(docIdFor(id));

        // one Firestore transaction == one blockConcurrencyWhile turn for this id.
        // runTransaction may re-run its callback on contention, so anything that
        // touches the request or the doc is built fresh inside the callback.
        return await firestore.runTransaction(async (txn) => {
          const request = new Request(url, {
            method,
            headers,
            body: method === "GET" || method === "HEAD" ? undefined : bodyStr,
          });
          const state = {
            // already inside a transaction: this block is atomic by construction.
            blockConcurrencyWhile: async (fn) => await fn(),
            storage: {
              // Firestore rule: all reads before any write. The DO reads "record"
              // once, decides, then conditionally writes. That order is preserved.
              get: async (key) => {
                const snap = await txn.get(docRef);
                if (!snap.exists) return undefined;
                const data = snap.data() || {};
                const raw = data[key + "_json"];
                return raw === undefined ? undefined : JSON.parse(raw);
              },
              put: async (key, val) => {
                txn.set(docRef, { [key + "_json"]: JSON.stringify(val) }, { merge: true });
              },
            },
          };
          const res = await new AgreementDedupeDO(state).fetch(request);
          const status = res.status;
          const text = await res.text();
          // minimal stub-response: callers only use await r.json().
          return {
            status,
            ok: status >= 200 && status < 300,
            async json() { return JSON.parse(text); },
            async text() { return text; },
          };
        });
      },
    }),
  };
}
