// AP2 端から端の構造テスト(番人 3a)。2026-09-16。
// 実物の create_ap2_fairness_attestation を叩き、AP2 v0.1 仕様(ap2-protocol.org と
// ap2-protocol.org/a2a-extension)とフィールド名/大小文字まで突き合わせる。ネットワーク無し。
//
// 仕様で確認した事実(番人):
//  - CartMandate      = {contents, merchant_signature, timestamp}
//  - CartContents     = {id, user_signature_required, payment_request}   (extensions/credentials/metadata の規範フィールドは無い)
//  - PaymentRequest   = {method_data:[{supported_methods}], details:{id, displayItems:[{label, amount:{currency,value}}], total}}  (displayItems は camelCase)
//  - mandate は W3C VC と規定されていない(merchant_signature/user_authorization は不透明な署名文字列)。credential 集合に嵌める口は無い。
//  - 第三者の価値証跡は A2A Artifact の兄弟 DataPart(key 'ap2.mandates.CartMandate' の隣、開放口は 'risk_data')に載せる。署名対象の contents には入れない。

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import worker from "../src/mcp.js";

const DB = JSON.parse(readFileSync(new URL("../../../data/souba-db.json", import.meta.url), "utf8"));
globalThis.fetch = async (url) => {
  const u = String(url && url.url ? url.url : url);
  if (u.includes("/data/souba-db.json")) return new Response(JSON.stringify(DB), { headers: { "content-type": "application/json" } });
  throw new Error("unexpected external fetch in test: " + u);
};

const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const DASH = new RegExp("[" + String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D) + "]");
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const keysOf = (o) => isObj(o) ? Object.keys(o) : [];

let fail = 0;
const chk = (n, c, x = "") => { console.log((c ? "PASS  " : "FAIL  ") + n + (c ? "" : "  <<< " + String(x).slice(0, 300))); if (!c) fail++; };

const call = async (name, args) => {
  const r = await worker.fetch(new Request("https://hs-mcp.test/", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })
  }), {}, { waitUntil() {} });
  const res = (await r.json()).result;
  const t = res && res.content && res.content[0] && res.content[0].text;
  let o; try { o = JSON.parse(t); } catch (e) { o = { _raw: String(t) }; }
  return o;
};

const firstWork = (DB.categories || []).map(c => c.work).find(Boolean);

{
  chk("fixture: souba-db has at least one work", !!firstWork, firstWork);

  const out = await call("create_ap2_fairness_attestation", { work: firstWork, quoted_price: 999999999 });
  if (!out.attestation) chk("tool returned an attestation (not ambiguous/error)", false, JSON.stringify(out).slice(0, 300));

  // ---- value layer: attestation shape + hash recompute (the core verifiability guarantee) ----
  const att = out.attestation;
  chk("attestation.type == FairPriceAttestation", att && att.type === "FairPriceAttestation", att && att.type);
  const claim = att && att.subject && att.subject.fair_price_claim;
  chk("subject.fair_price_claim has {work,unit,fair_min,fair_avg,fair_max,source,issued_at}",
    claim && ["work","unit","fair_min","fair_avg","fair_max","source","issued_at"].every(k => k in claim), keysOf(claim).join(","));
  const h = att && att.integrity && att.integrity.claim_sha256;
  chk("integrity.claim_sha256 == SHA-256(JSON.stringify(fair_price_claim))  [recomputable]",
    !!h && h === sha256hex(JSON.stringify(claim)), h);
  chk("integrity carries verify_url + a recompute recipe", att && att.integrity && !!att.integrity.verify_url && /SHA-256/.test(att.integrity.recompute || ""));

  // ---- AP2 field-name/casing conformance (verified against ap2-protocol.org/specification) ----
  const cm = out.cart_mandate_example && out.cart_mandate_example.cart_mandate;
  chk("CartMandate top-level keys == {contents, merchant_signature, timestamp}",
    cm && keysOf(cm).slice().sort().join(",") === "contents,merchant_signature,timestamp", keysOf(cm).join(","));
  const contents = cm && cm.contents;
  chk("CartContents has spec keys {id, user_signature_required, payment_request}",
    contents && ["id","user_signature_required","payment_request"].every(k => k in contents), keysOf(contents).join(","));
  chk("user_signature_required is boolean (spec field name + type)", contents && typeof contents.user_signature_required === "boolean");

  const pr = contents && contents.payment_request;
  chk("payment_request.method_data[0].supported_methods present (snake_case)",
    pr && Array.isArray(pr.method_data) && pr.method_data[0] && "supported_methods" in pr.method_data[0]);
  const det = pr && pr.details;
  chk("details.displayItems is camelCase array of {label, amount:{currency,value}}",
    det && Array.isArray(det.displayItems) && det.displayItems[0] && "label" in det.displayItems[0] &&
    det.displayItems[0].amount && "currency" in det.displayItems[0].amount && "value" in det.displayItems[0].amount, keysOf(det).join(","));
  chk("details.total is {label, amount:{currency,value}}",
    det && det.total && "label" in det.total && det.total.amount && "currency" in det.total.amount && "value" in det.total.amount);

  // ---- honest carriage finding: NOTHING third-party inside the merchant-signed contents ----
  chk("CartContents carries NO extensions/credentials/metadata (AP2 v0.1 has no such normative field)",
    contents && !("extensions" in contents) && !("credentials" in contents) && !("verifiableCredentials" in contents) && !("metadata" in contents), keysOf(contents).join(","));
  chk("HORIZON SHIELD attestation is NOT nested inside merchant-signed contents",
    !/fair_price_attestation/.test(JSON.stringify(contents || {})));

  // ---- spec-conformant carriage: sibling A2A DataPart ----
  const car = out.a2a_carriage;
  chk("a2a_carriage present (spec-conformant attachment point)", isObj(car));
  chk("a2a_carriage cites the AP2 A2A extension URI verbatim",
    car && car.ap2_a2a_extension_uri === "https://github.com/google-agentic-commerce/ap2/tree/v0.1", car && car.ap2_a2a_extension_uri);
  const parts = car && car.artifact && car.artifact.parts;
  chk("artifact.parts is a DataPart array (>=2)", Array.isArray(parts) && parts.length >= 2);
  const partKeys = (parts || []).flatMap(p => keysOf(p.data));
  chk("one DataPart keyed 'ap2.mandates.CartMandate' (spec DataPart key)", partKeys.includes("ap2.mandates.CartMandate"), partKeys.join(","));
  chk("attestation rides as a SIBLING DataPart next to the CartMandate",
    partKeys.some(k => /fair_price_attestation/.test(k)) && partKeys.includes("ap2.mandates.CartMandate"), partKeys.join(","));
  const sib = (parts || []).map(p => p.data).find(d => Object.keys(d || {}).some(k => /fair_price_attestation/.test(k)));
  const sibVal = sib && sib[Object.keys(sib).find(k => /fair_price_attestation/.test(k))];
  chk("sibling DataPart carries the same claim_sha256 (links the value layer to this cart)", sibVal && sibVal.claim_sha256 === h, sibVal && sibVal.claim_sha256);

  // ---- bridge thesis: parallel layers, not a payment action ----
  chk("ap2_bridge present (authorization x value, parallel layers)", isObj(out.ap2_bridge) && /並列/.test(out.ap2_bridge.thesis || ""));

  // ---- no forbidden dashes in the AP2 structural surface ----
  const surface = JSON.stringify({ attestation: out.attestation, cart_mandate_example: out.cart_mandate_example, a2a_carriage: out.a2a_carriage, ap2_bridge: out.ap2_bridge });
  chk("no em/en/bar dashes in the AP2 structural surface", !DASH.test(surface));
}

console.log(fail ? ("\n" + fail + " FAILED") : "\nALL PASS (AP2 conformance)");
process.exit(fail ? 1 : 0);
