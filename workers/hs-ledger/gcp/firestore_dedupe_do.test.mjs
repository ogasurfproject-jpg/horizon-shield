import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAgreementDedupeDO } from "./firestore_dedupe_do.mjs";
import { decideDedupe } from "../nenrin/agreement-v0/agreement_intake.mjs";

// minimal in-memory Firestore: enough for makeAgreementDedupeDO (collection/doc,
// runTransaction with txn.get/txn.set + merge). It enforces Firestore's
// read-before-write rule so the shim is proven to respect it.
function fakeFirestore() {
  const store = new Map();
  const ref = (path) => ({ _path: path });
  return {
    _store: store,
    collection(name) { return { doc: (id) => ref(name + "/" + id) }; },
    async runTransaction(fn) {
      let wrote = false;
      const txn = {
        async get(r) {
          if (wrote) throw new Error("read after write in transaction");
          const data = store.get(r._path);
          return { exists: data !== undefined, data: () => data };
        },
        set(r, data, opts) {
          wrote = true;
          const prev = opts && opts.merge ? (store.get(r._path) || {}) : {};
          store.set(r._path, { ...prev, ...data });
        },
      };
      return await fn(txn);
    },
  };
}

const claim = (d, sha, payload) =>
  d.get(d.idFromName("agreement:" + sha)).fetch("https://agreement-dedupe/claim", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sha, payload }),
  });
const getRec = (d, sha) =>
  d.get(d.idFromName("agreement:" + sha)).fetch("https://agreement-dedupe/get", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  });

test("first claim stores and is not a duplicate (matches decideDedupe)", async () => {
  const d = makeAgreementDedupeDO(fakeFirestore(), "c");
  const p = { canonical_sha256: "aa", who: "x" };
  const r = await (await claim(d, "aa", p)).json();
  assert.deepEqual(r, decideDedupe(null, p));
  assert.equal(r.duplicate, false);
  assert.deepEqual(r.stored, p);
});

test("second claim of the same sha is a duplicate and keeps the first payload", async () => {
  const d = makeAgreementDedupeDO(fakeFirestore(), "c");
  const first = { canonical_sha256: "bb", v: 1 };
  const second = { canonical_sha256: "bb", v: 2 };
  await claim(d, "bb", first);
  const r = await (await claim(d, "bb", second)).json();
  assert.equal(r.duplicate, true);
  assert.deepEqual(r.stored, first);
});

test("get returns the stored record, or null when unknown", async () => {
  const d = makeAgreementDedupeDO(fakeFirestore(), "c");
  const p = { canonical_sha256: "cc" };
  assert.deepEqual(await (await getRec(d, "cc")).json(), { stored: null });
  await claim(d, "cc", p);
  assert.deepEqual(await (await getRec(d, "cc")).json(), { stored: p });
});

test("different shas are independent documents", async () => {
  const fs = fakeFirestore();
  const d = makeAgreementDedupeDO(fs, "c");
  const r1 = await (await claim(d, "d1", { canonical_sha256: "d1" })).json();
  const r2 = await (await claim(d, "d2", { canonical_sha256: "d2" })).json();
  assert.equal(r1.duplicate, false);
  assert.equal(r2.duplicate, false);
  assert.equal(fs._store.size, 2);
});
