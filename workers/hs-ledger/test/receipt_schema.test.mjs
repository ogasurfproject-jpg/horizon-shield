// test/receipt_schema.test.mjs : the receipt page names a record's own schema (2026-10-13).
// Entry 88 (a nenrin-agreement-batch-v1) was shown as "schema v0 · concept-proof" with a note about estimate JSON.
// A record that names its own schema is labelled by it; a record with no schema keeps the v0 note.
//   node test/receipt_schema.test.mjs
import { loadWorker, sha256Hex, mockKV, checker } from "./load.mjs";

const worker = await loadWorker("src/worker.js");
const batch = JSON.stringify({ schema: "nenrin-agreement-batch-v1", count: 1, records: [] });
const evil = JSON.stringify({ schema: "<img src=x onerror=alert(1)>", count: 0 });
const v0 = JSON.stringify({ title: "SPEC_HASH_INDEPENDENCE_v1.md", sha256: "deadbeef" });
const ent = async (n, rec) => [`entry:${n}`, JSON.stringify({ n, work: "x", claim_sha256: await sha256Hex(rec), record_canonical: rec, schema: "v0", created_at: "2026-10-12T00:45:17Z", ots_status: "confirmed", bitcoin_block: 971024, block_time: "2026-10-12 02:08 UTC" })];
const plainRec = "# FURUI blind-04: the plan\n\n**Status:** a plan record, anchored before the draw.\n";
const kv = mockKV([["seq", "5"], await ent(2, v0), await ent(3, batch), await ent(4, evil), await ent(5, plainRec)]);
const env = { LEDGER: kv.binding };
const page = async (n) => (await worker.fetch(new Request("https://ledger.example.dev/ledger/" + n), env)).text();
const chk = checker("receipt_schema");

let t = await page(3);
chk("a NENRIN batch is badged with its own schema", t.includes("record schema nenrin-agreement-batch-v1"));
chk("and not as a v0 estimate entry", !t.includes("concept-proof") && !t.includes("only the estimate JSON is hashed"));
chk("its card says what kind of record it is", t.includes("This entry is a nenrin-agreement-batch-v1 record"));
t = await page(2);
chk("a record with no schema keeps the v0 badge and note", t.includes("schema v0 · concept-proof") && t.includes("only the estimate JSON is hashed"));
t = await page(4);
chk("a schema name is HTML-escaped on the page", !t.includes("<img src=x") && t.includes("&lt;img src=x onerror=alert(1)&gt;"));
// The same rule on /cite and /verify (2026-10-13): jidec_how_to_verify still reported entry 88 as record_kind "v0"
// because /verify/{n} kept the old classification, and /cite said it does not prove "that the estimate is fair".
const getj = async (path) => JSON.parse(await (await worker.fetch(new Request("https://ledger.example.dev" + path), env)).text());
let c = await getj("/cite/jidec:entry:3");
chk("/cite names a NENRIN batch by its own schema", c.record_kind === "nenrin-agreement-batch-v1", c.record_kind);
chk("/cite says what kind of record it is", (c.note || "").includes("This entry is a nenrin-agreement-batch-v1 record"), c.note);
chk("/cite limits no longer mention an estimate for it", !/estimate/.test(c.limits) && /Does not prove/.test(c.limits), c.limits);
c = await getj("/cite/jidec:entry:2");
chk("/cite keeps the v0 kind, note and estimate limits for a record with no schema", c.record_kind === "v0" && /predates the v1 schemas/.test(c.note) && /estimate is fair/.test(c.limits));
let v = await getj("/verify/3");
chk("/verify names a NENRIN batch by its own schema", v.record_kind === "nenrin-agreement-batch-v1", v.record_kind);
chk("/verify scope says what kind of record it is", /This entry is a nenrin-agreement-batch-v1 record/.test(v.scope), v.scope);
v = await getj("/verify/2");
chk("/verify keeps v0 for a record with no schema", v.record_kind === "v0" && /does not declare a jidec-claim-v1 audit/.test(v.scope));
// 2026-10-30: a plain-text record (#194, a plan) was shown as v0 with "only the estimate JSON is hashed".
t = await page(5);
chk("a plain-text record is badged as one", t.includes("plain-text record"));
chk("and not as a v0 estimate entry", !t.includes("concept-proof") && !t.includes("only the estimate JSON is hashed"));
chk("its card says the hash covers all its bytes", t.includes("SHA-256 of all the record bytes shown below"));
c = await getj("/cite/jidec:entry:5");
chk("/cite names a plain-text record as v0-plain with its own note", c.record_kind === "v0-plain" && /plain-text record/.test(c.note || ""), c.note);
chk("/cite limits do not mention an estimate for it", !/estimate/.test(c.limits), c.limits);
process.exit(chk.done() ? 1 : 0);
