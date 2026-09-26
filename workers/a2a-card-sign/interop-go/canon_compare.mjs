// JS side of the fixture: prints the SHA-256 of the two canonical forms the signer in ../sign_lib.mjs uses,
// for the same served card bytes. Run from this directory: node canon_compare.mjs card.json
// Requires ../node_modules (@a2a-js/sdk), the same install sign.mjs uses.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { canonicalizeAgentCard } from "@a2a-js/sdk";
import { jcsCanonical } from "../sign_lib.mjs";

const raw = readFileSync(process.argv[2]);
const card = JSON.parse(raw);
const bare = Object.assign({}, card); delete bare.signatures;
const h = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const official = canonicalizeAgentCard(bare);
const plain = jcsCanonical(bare);
const dropped = Object.keys(bare).filter((k) => !(k in JSON.parse(official)));
console.log("served_sha256=" + createHash("sha256").update(raw).digest("hex") + " served_bytes=" + raw.length);
console.log("js_sdk_canonical_bytes=" + Buffer.byteLength(official) + " js_sdk_canonical_sha256=" + h(official) + " (proto round trip, then RFC 8785; signatures[1] is over this)");
console.log("js_plain_jcs_bytes=" + Buffer.byteLength(plain) + " js_plain_jcs_sha256=" + h(plain) + " (RFC 8785 of the served card, signatures dropped; signatures[0] is over this)");
console.log("top_level_fields_dropped_by_js_sdk=" + JSON.stringify(dropped));
