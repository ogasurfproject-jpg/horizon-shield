// test/worker.test.mjs: hs-ms-marketplace offline. Microsoft's token endpoint, JWKS, resolve, activate and
// operations APIs are replaced by a fake that checks every request the worker makes.
// Run: node test/worker.test.mjs
import { generateKeyPairSync, createSign, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import worker, { PLAN_LIMITS, _test } from "../src/worker.js";

let bad = 0, n = 0;
const chk = (name, ok, info = "") => { n++; if (!ok) bad++; console.log((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : "  " + info)); };

const TENANT = "11111111-2222-3333-4444-555555555555";
const API_APP = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const LOGIN_APP = "99999999-8888-7777-6666-555555555555";
const BUYER_TID = "12345678-1234-1234-1234-123456789012";
const RESOURCE = "20e940b3-4c77-4b0b-9a53-9e16a1b010a7";
const SUB = randomUUID();

// One RSA key plays Microsoft's signing key; another is an impostor.
function rsa(kid) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: "jwk" }), kid, use: "sig" } };
}
const MS = rsa("ms-1"), EVIL = rsa("ms-1");
const b64u = (b) => Buffer.from(b).toString("base64url");
function jwt(claims, key = MS, alg = "RS256") {
  const h = b64u(JSON.stringify({ alg, typ: "JWT", kid: key.kid }));
  const p = b64u(JSON.stringify(claims));
  const s = createSign("RSA-SHA256").update(h + "." + p).sign(key.privateKey);
  return h + "." + p + "." + b64u(s);
}
const now = () => Math.floor(Date.now() / 1000);

// KV
function kv() {
  const m = new Map();
  return { m, binding: {
    get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); },
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  } };
}

// Fake Microsoft.
const calls = [];
let resolveStatus = 200, activateStatus = 200, opAction = "Suspend", resolvePlan = "endpoint-verification", opPlan = "endpoint-verification";
let opHttp = 200, keysHttp = 200, tokenHttp = 200, opStatus = "Succeeded", opQuantity = null, msSubStatus = "Subscribed";
async function fakeFetch(url, init = {}) {
  const u = String(url);
  calls.push({ u, init });
  const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
  if (u === `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`) {
    const b = new URLSearchParams(init.body);
    if (b.get("client_id") !== API_APP || b.get("client_secret") !== "s3cret" || b.get("scope") !== RESOURCE + "/.default" || b.get("grant_type") !== "client_credentials") return J({ error: "invalid_client" }, 401);
    if (tokenHttp !== 200) return J({ error: "temporarily_unavailable" }, tokenHttp);
    return J({ access_token: "PUBLISHER", expires_in: 3599 });
  }
  if (u === "https://login.microsoftonline.com/common/discovery/v2.0/keys" || u === `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`) return keysHttp === 200 ? J({ keys: [MS.jwk] }) : J({}, keysHttp);
  const authOk = (init.headers || {}).authorization === "Bearer PUBLISHER";
  if (u.startsWith("https://marketplaceapi.microsoft.com/api/saas/subscriptions/resolve?api-version=2018-08-31")) {
    if (!authOk) return J({}, 401);
    if (init.headers["x-ms-marketplace-token"] !== "ab+cd/ef") return J({ error: "bad token" }, 400);
    if (resolveStatus !== 200) return J({}, resolveStatus);
    return J({ id: SUB, subscriptionName: "Contoso HS", offerId: "horizon-shield-verification", planId: resolvePlan, quantity: null,
      subscription: { id: SUB, saasSubscriptionStatus: "PendingFulfillmentStart", purchaser: { emailId: "buyer@contoso.com" }, beneficiary: { emailId: "ops@contoso.com" }, isTest: true } });
  }
  if (u === `https://marketplaceapi.microsoft.com/api/saas/subscriptions/${SUB}/activate?api-version=2018-08-31`) {
    if (!authOk || init.method !== "POST") return J({}, 401);
    return new Response("", { status: activateStatus });
  }
  const om = new RegExp(`^https://marketplaceapi\\.microsoft\\.com/api/saas/subscriptions/${SUB}/operations/([0-9a-f-]{36})\\?api-version=2018-08-31$`).exec(u);
  if (om) {
    if (!authOk) return J({}, 401);
    if (opHttp !== 200) return J({ error: "operation not found" }, opHttp);
    return J({ id: om[1], action: opAction, status: opStatus, planId: opPlan, quantity: opQuantity });
  }
  if (u === `https://marketplaceapi.microsoft.com/api/saas/subscriptions/${SUB}?api-version=2018-08-31`) {
    if (!authOk || init.method !== "GET") return J({}, 401);
    return J({ id: SUB, planId: "endpoint-verification", saasSubscriptionStatus: msSubStatus });
  }
  return J({ error: "unexpected " + u }, 404);
}

const store = kv();
const env = { MS_TENANT_ID: TENANT, MS_API_APP_ID: API_APP, MS_LOGIN_APP_ID: LOGIN_APP, MS_API_CLIENT_SECRET: "s3cret", ADMIN_TOKEN: "adm1n-token-value", MS_SUBS: store.binding };
const ORIGIN = "https://marketplace.horizonshield.dev";
const call = (path, init = {}, e = env) => worker.fetch(new Request(ORIGIN + path, init), e, {}, fakeFetch);
const form = (o) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o).toString() });

// 0. health and configuration
let r = await call("/health");
let hj = await r.json();
chk("health reports configured without values", r.status === 200 && hj.configured === true);
chk("health shows the plan table: 3 and 10 endpoints", hj.plans["endpoint-verification"] === 3 && hj.plans["endpoint-verification-pro"] === 10 && Object.keys(hj.plans).length === 2);
const SRC = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
chk("each plan id is written once in the worker (the table is the only place)", Object.keys(PLAN_LIMITS).every((id) => SRC.split('"' + id + '"').length === 2));
r = await call("/landing?token=x", {}, { ...env, MS_API_CLIENT_SECRET: "" });
chk("unconfigured worker refuses to run the flow", r.status === 503);

// 1. landing without token explains; with token redirects to Microsoft sign-in with state and nonce
r = await call("/landing");
chk("landing without token: explanation page", r.status === 200 && (await r.text()).includes("Configure account"));
r = await call("/landing?token=ab%2Bcd%2Fef");
const loc = new URL(r.headers.get("location") || "https://x/");
const state = loc.searchParams.get("state"), nonce = loc.searchParams.get("nonce");
chk("landing with token: 302 to common authorize, form_post, id_token", r.status === 302 && loc.host === "login.microsoftonline.com" && loc.pathname === "/common/oauth2/v2.0/authorize" && loc.searchParams.get("response_mode") === "form_post" && loc.searchParams.get("response_type") === "id_token" && loc.searchParams.get("client_id") === LOGIN_APP && loc.searchParams.get("redirect_uri") === ORIGIN + "/auth/callback");
chk("purchase token kept server side, decoded", JSON.parse(store.m.get("st:" + state)).token === "ab+cd/ef");

const idt = (over = {}, key = MS) => jwt({ aud: LOGIN_APP, iss: `https://login.microsoftonline.com/${BUYER_TID}/v2.0`, tid: BUYER_TID, nonce, exp: now() + 600, iat: now(), name: "Pat Buyer", preferred_username: "pat@contoso.com", oid: randomUUID(), ...over }, key);

// 2. callback refusals
r = await call("/auth/callback", form({ id_token: idt(), state: "deadbeef" }));
chk("unknown state refused", r.status === 400);
r = await call("/landing?token=ab%2Bcd%2Fef"); let st2 = new URL(r.headers.get("location")).searchParams.get("state");
r = await call("/auth/callback", form({ id_token: idt({}, EVIL), state: st2 }));
chk("id_token signed by an impostor key refused", r.status === 401);
r = await call("/auth/callback", form({ id_token: idt(), state: st2 }));
chk("state is single use", r.status === 400);
for (const [label, over] of [["wrong audience", { aud: API_APP }], ["issuer not matching tid", { iss: "https://login.microsoftonline.com/common/v2.0" }], ["wrong nonce", { nonce: "x" }], ["expired", { exp: now() - 3600 }]]) {
  r = await call("/landing?token=ab%2Bcd%2Fef"); const s = new URL(r.headers.get("location")).searchParams;
  const tok = jwt({ aud: LOGIN_APP, iss: `https://login.microsoftonline.com/${BUYER_TID}/v2.0`, tid: BUYER_TID, nonce: s.get("nonce"), exp: now() + 600, ...over });
  r = await call("/auth/callback", form({ id_token: tok, state: s.get("state") }));
  chk("id_token refused: " + label, r.status === 401);
}

// 3. happy path: sign in, resolve, confirm page, activate
r = await call("/landing?token=ab%2Bcd%2Fef"); let s3 = new URL(r.headers.get("location")).searchParams;
const tok3 = jwt({ aud: LOGIN_APP, iss: `https://login.microsoftonline.com/${BUYER_TID}/v2.0`, tid: BUYER_TID, nonce: s3.get("nonce"), exp: now() + 600, preferred_username: "pat@contoso.com" });
r = await call("/auth/callback", form({ id_token: tok3, state: s3.get("state") }));
let html = await r.text();
const c = (html.match(/name="c" value="([0-9a-f]{48})"/) || [])[1];
chk("confirm page shows plan, purchaser and an Activate form", r.status === 200 && html.includes("endpoint-verification") && html.includes("buyer@contoso.com") && html.includes("pat@contoso.com") && !!c);
chk("confirm page shows the endpoints the plan includes", /Endpoints included<\/td><td>3</.test(html));
chk("resolve was called with the publisher token and decoded purchase token", calls.some((x) => x.u.includes("/resolve?") && x.init.headers["x-ms-marketplace-token"] === "ab+cd/ef"));
chk("not activated before the buyer presses Activate", !calls.some((x) => x.u.includes("/activate?")) && !store.m.has("sub:" + SUB));
r = await call("/activate", form({ c }));
let recA = JSON.parse(store.m.get("sub:" + SUB));
chk("activate: 200 page, record says activation accepted, not Subscribed", r.status === 200 && recA.status === "ActivationRequested" && recA.activation === "accepted" && !!recA.activated_at && recA.status !== "Subscribed");
r = await call("/activate", form({ c }));
chk("confirmation is single use", r.status === 400);

// 3b. a plan this worker does not know: no Activate form, and /activate refuses before calling Microsoft
resolvePlan = "endpoint-mystery";
r = await call("/landing?token=ab%2Bcd%2Fef"); let s3u = new URL(r.headers.get("location")).searchParams;
r = await call("/auth/callback", form({ id_token: jwt({ aud: LOGIN_APP, iss: `https://login.microsoftonline.com/${BUYER_TID}/v2.0`, tid: BUYER_TID, nonce: s3u.get("nonce"), exp: now() + 600 }), state: s3u.get("state") }));
html = await r.text();
chk("unknown plan: 409 page, no Activate form, no session kept", r.status === 409 && !html.includes('action="/activate"') && ![...store.m.keys()].some((k) => k.startsWith("ses:")));
const SUB_U = randomUUID(), sidU = "0".repeat(48);
store.m.set("ses:" + sidU, JSON.stringify({ user: { email: "pat@contoso.com" }, resolved: { id: SUB_U, planId: "endpoint-mystery", subscription: {} } }));
const actCallsBefore = calls.filter((x) => x.u.includes("/activate?")).length;
r = await call("/activate", form({ c: sidU }));
chk("unknown plan: /activate refuses with 409, Microsoft's Activate API not called, nothing stored", r.status === 409 && calls.filter((x) => x.u.includes("/activate?")).length === actCallsBefore && !store.m.has("sub:" + SUB_U));
resolvePlan = "endpoint-verification";

// 3c. endpoint limits from the plan
// (the webhook helper is used here for ChangePlan and again in section 5)
const hook = (claims, body = { id: randomUUID(), subscriptionId: SUB, action: "Suspend", status: "Succeeded" }, key = MS) =>
  call("/webhook", { method: "POST", headers: { authorization: "Bearer " + jwt({ iss: `https://sts.windows.net/${TENANT}/`, tid: TENANT, aud: API_APP, appid: RESOURCE, exp: now() + 600, ...claims }, key), "content-type": "application/json" }, body: JSON.stringify(body) });
const ADM = { authorization: "Bearer adm1n-token-value", "content-type": "application/json" };
const epReq = (method, ep, path = "endpoints", sub = SUB) => call(`/admin/subscriptions/${sub}/${path}`, { method, headers: ADM, body: JSON.stringify(path === "keep" ? { endpoints: ep } : { endpoint: ep }) });
const EP = (i) => `https://mcp${i}.contoso.example/mcp`;
const ent = () => { const s = JSON.parse(store.m.get("sub:" + SUB)); return s; };
r = await call(`/admin/subscriptions/${SUB}/endpoints`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: EP(1) }) });
chk("adding an endpoint needs the admin token", r.status === 401);
r = await epReq("POST", "http://mcp.contoso.example/mcp");
chk("endpoint must be https", r.status === 400);
for (const i of [1, 2, 3]) r = await epReq("POST", EP(i));
let j = await r.json();
chk("endpoint-verification: 3 endpoints accepted", r.status === 200 && j.entitlement.limit === 3 && j.entitlement.registered === 3 && j.entitlement.daily.length === 3);
r = await epReq("POST", EP(1));
chk("adding the same endpoint again changes nothing", r.status === 200 && (await r.json()).unchanged === true && ent().endpoints.length === 3);
r = await epReq("POST", EP(4));
j = await r.json();
chk("4th endpoint on endpoint-verification refused: limit_reached", r.status === 409 && j.error === "limit_reached" && j.limit === 3 && ent().endpoints.length === 3);

// Activation accepted already counts toward the plan (flagged); Get subscription confirms Subscribed.
r = await call("/admin/subscriptions", { headers: ADM });
let subA = (await r.json()).subscriptions.find((x) => x.id === SUB);
chk("ActivationRequested: the 3 endpoints count, flagged activation_requested", subA.entitlement.limit === 3 && subA.entitlement.daily.length === 3 && subA.entitlement.flags.includes("activation_requested"));
r = await call(`/admin/subscriptions/${SUB}/refresh`, { method: "POST", headers: ADM });
chk("refresh needs the admin token", (await call(`/admin/subscriptions/${SUB}/refresh`, { method: "POST" })).status === 401);
j = await r.json();
chk("refresh: Get subscription says Subscribed, the record becomes Subscribed", r.status === 200 && j.status === "Subscribed" && ent().status === "Subscribed" && !!ent().subscribed_confirmed_at && calls.some((x) => x.u.endsWith(`/subscriptions/${SUB}?api-version=2018-08-31`)));
const planHook = (planId, id = randomUUID()) => hook({}, { id, subscriptionId: SUB, action: "ChangePlan", planId, status: "InProgress" });
opAction = "ChangePlan"; opPlan = "endpoint-verification-pro";
r = await planHook("endpoint-verification-pro");
j = await r.json();
chk("ChangePlan 3 -> 10: limit raised at once", r.status === 200 && j.entitlement.limit === 10 && ent().planId === "endpoint-verification-pro");
r = await epReq("POST", EP(4)); r = await epReq("POST", EP(5));
j = await r.json();
chk("pro: 4th and 5th endpoints accepted", r.status === 200 && j.entitlement.registered === 5 && j.entitlement.daily.length === 5 && j.entitlement.flags.length === 0);

opPlan = "endpoint-verification";
r = await planHook("endpoint-verification");
j = await r.json();
let rec = ent();
chk("ChangePlan 10 -> 3 is accepted and nothing is deleted", r.status === 200 && rec.planId === "endpoint-verification" && rec.endpoints.length === 5 && j.entitlement.flags.includes("over_limit"));
chk("the plan change is recorded with both limits", rec.plan_changes.at(-1).from === "endpoint-verification-pro" && rec.plan_changes.at(-1).to === "endpoint-verification" && rec.plan_changes.at(-1).from_limit === 10 && rec.plan_changes.at(-1).to_limit === 3);
r = await call("/admin/daily", { headers: ADM });
j = await r.json();
let mine = (list) => list.filter((x) => x.subscriptionId === SUB).map((x) => x.endpoint);
chk("over the limit: the 3 oldest are owed daily, the other 2 listed as not daily", JSON.stringify(mine(j.daily)) === JSON.stringify([EP(1), EP(2), EP(3)]) && JSON.stringify(mine(j.not_daily)) === JSON.stringify([EP(4), EP(5)]));
r = await epReq("POST", EP(6));
chk("over the limit: a new endpoint is refused", r.status === 409 && (await r.json()).error === "limit_reached" && ent().endpoints.length === 5);
r = await epReq("POST", [EP(5), EP(4), EP(1), EP(2)], "keep");
chk("keep: choosing more than the limit is refused", r.status === 409);
r = await epReq("POST", [EP(9)], "keep");
chk("keep: an endpoint not on the subscription is refused", r.status === 400);
r = await epReq("POST", [EP(5), EP(4)], "keep");
j = await r.json();
chk("keep: the chosen endpoints come first, then the oldest", r.status === 200 && JSON.stringify(j.entitlement.daily) === JSON.stringify([EP(5), EP(4), EP(1)]) && JSON.stringify(j.entitlement.over_limit) === JSON.stringify([EP(2), EP(3)]));
r = await epReq("DELETE", EP(4)); r = await epReq("DELETE", EP(3));
j = await r.json();
chk("removing endpoints brings the subscription back under the limit", r.status === 200 && j.entitlement.registered === 3 && j.entitlement.flags.length === 0 && JSON.stringify(ent().keep) === JSON.stringify([EP(5)]));
r = await epReq("DELETE", EP(4));
chk("removing an endpoint that is not there: 404", r.status === 404);

// Microsoft's webhook page: for ChangePlan, a 4xx within 10 seconds refuses the change and the subscription keeps its plan.
let before = store.m.get("sub:" + SUB);
const opCalls = () => calls.filter((x) => x.u.includes("/operations/")).length;
let opBefore = opCalls();
r = await planHook("endpoint-mystery");
j = await r.json();
chk("ChangePlan to an unknown plan: 409 without calling Get Operation, KV unchanged", r.status === 409 && j.error === "unknown_plan" && j.refused === true && opCalls() === opBefore && store.m.get("sub:" + SUB) === before);
opPlan = "endpoint-mystery"; opBefore = opCalls();
r = await hook({}, { id: randomUUID(), subscriptionId: SUB, action: "ChangePlan", status: "InProgress" });
chk("ChangePlan whose payload names no plan: Get Operation is asked, its unknown plan refused with 409, KV unchanged", r.status === 409 && opCalls() === opBefore + 1 && store.m.get("sub:" + SUB) === before);
before = store.m.get("sub:" + SUB);
opPlan = "endpoint-verification-pro"; opHttp = 404;
r = await planHook("endpoint-verification-pro");
chk("Get Operation 404 on a ChangePlan: 503 (retry, not a refusal), KV unchanged", r.status === 503 && store.m.get("sub:" + SUB) === before);
opHttp = 500;
r = await planHook("endpoint-verification-pro");
chk("Get Operation 500 on a ChangePlan: 503, KV unchanged", r.status === 503 && store.m.get("sub:" + SUB) === before);
opHttp = 200; tokenHttp = 503; _test.tokenCache.value = null;
r = await planHook("endpoint-verification-pro");
chk("publisher token unavailable: 503, KV unchanged", r.status === 503 && store.m.get("sub:" + SUB) === before);
tokenHttp = 200; keysHttp = 500; _test.jwksCache.clear();
r = await planHook("endpoint-verification-pro");
chk("Microsoft's signing keys unavailable: 503, not 401, KV unchanged", r.status === 503 && store.m.get("sub:" + SUB) === before);
keysHttp = 200;
const realPut = store.binding.put;
store.binding.put = async () => { throw new Error("kv down"); };
r = await planHook("endpoint-verification-pro");
store.binding.put = realPut;
chk("KV write failure: 503, KV unchanged", r.status === 503 && store.m.get("sub:" + SUB) === before);
opAction = "ChangeQuantity"; opQuantity = 25;
r = await hook({}, { id: randomUUID(), subscriptionId: SUB, action: "ChangeQuantity", quantity: 25, status: "InProgress" });
j = await r.json();
chk("ChangeQuantity: accepted, quantity recorded, the endpoint limit does not change", r.status === 200 && j.entitlement.limit === 3 && ent().quantity === 25 && ent().planId === "endpoint-verification");
opAction = "ChangePlan"; opQuantity = null;
const ONE_OP = randomUUID();
r = await planHook("endpoint-verification-pro", ONE_OP);
j = await r.json();
chk("ChangePlan to a known plan: 200 and the limit changes (3 -> 10)", r.status === 200 && j.entitlement.limit === 10 && ent().planId === "endpoint-verification-pro");
r = await planHook("endpoint-verification-pro", ONE_OP);
j = await r.json();
chk("the same operation id a second time: 200 duplicate, one event for it", r.status === 200 && j.duplicate === true && ent().events.filter((e) => e.operationId === ONE_OP).length === 1);
opPlan = "endpoint-verification";
r = await planHook("endpoint-verification");
chk("ChangePlan back to endpoint-verification: 200, limit 3", r.status === 200 && (await r.json()).entitlement.limit === 3);
opAction = "Suspend";

// 4. resolve errors
resolveStatus = 400;
r = await call("/landing?token=ab%2Bcd%2Fef"); s3 = new URL(r.headers.get("location")).searchParams;
r = await call("/auth/callback", form({ id_token: jwt({ aud: LOGIN_APP, iss: `https://login.microsoftonline.com/${BUYER_TID}/v2.0`, tid: BUYER_TID, nonce: s3.get("nonce"), exp: now() + 600 }), state: s3.get("state") }));
chk("expired purchase token: Microsoft's wording", r.status === 400 && (await r.text()).includes("Configure Account or Manage Account"));
resolveStatus = 200;

// 5. webhook
r = await call("/webhook", { method: "POST", body: "{}" });
chk("webhook without bearer: 401", r.status === 401);
for (const [label, claims, key] of [["impostor key", {}, EVIL], ["wrong tenant", { tid: BUYER_TID }], ["wrong audience", { aud: LOGIN_APP }], ["caller not the marketplace", { appid: API_APP }], ["foreign issuer", { iss: "https://sts.windows.net/" + BUYER_TID + "/" }], ["expired", { exp: now() - 3600 }]]) {
  r = await hook(claims, undefined, key);
  chk("webhook refused: " + label, r.status === 401);
}
r = await hook({});
chk("webhook Suspend: verified, confirmed with Operations API, stored", r.status === 200 && JSON.parse(store.m.get("sub:" + SUB)).status === "Suspended" && calls.some((x) => x.u.includes("/operations/")));
r = await call("/admin/daily", { headers: ADM });
j = await r.json();
chk("suspended: nothing owed daily, endpoints kept", mine(j.daily).length === 0 && JSON.parse(store.m.get("sub:" + SUB)).endpoints.length === 3);
r = await epReq("POST", EP(8));
chk("suspended: a new endpoint is refused", r.status === 409 && (await r.json()).error === "not_subscribed");
opAction = "Reinstate"; opStatus = "InProgress";
let nEv = ent().events.length;
r = await hook({}, { id: randomUUID(), subscriptionId: SUB, action: "Reinstate", status: "InProgress" });
chk("Reinstate while its operation is InProgress: recorded, status stays Suspended", r.status === 200 && ent().status === "Suspended" && ent().events.length === nEv + 1);
opStatus = "Succeeded";
r = await hook({}, { id: randomUUID(), subscriptionId: SUB, action: "Reinstate", status: "Succeeded" });
chk("Reinstate whose operation is Succeeded: Subscribed", r.status === 200 && ent().status === "Subscribed");
opAction = "Suspend";
r = await hook({ appid: undefined, azp: RESOURCE, iss: `https://login.microsoftonline.com/${TENANT}/v2.0` });
chk("webhook accepts v2 tokens that carry azp instead of appid", r.status === 200);
r = await hook({}, { id: randomUUID(), subscriptionId: SUB, action: "Unsubscribe" });
chk("payload action that disagrees with the operation is refused", r.status === 400);
opAction = "Unsubscribe";
r = await hook({}, { id: randomUUID(), subscriptionId: SUB, action: "Unsubscribe" });
chk("Unsubscribe recorded", r.status === 200 && JSON.parse(store.m.get("sub:" + SUB)).status === "Unsubscribed");
r = await hook({}, { id: "not-a-guid", subscriptionId: SUB });
chk("non-GUID ids refused", r.status === 400);

// 6. admin list
r = await call("/admin/subscriptions");
chk("admin list without token: 401", r.status === 401);
r = await call("/admin/subscriptions", { headers: { authorization: "Bearer adm1n-token-value" } });
const al = await r.json();
chk("admin list with token: the subscription and its events", r.status === 200 && al.count === 1 && al.subscriptions[0].events.length >= 3);

// 7. the client secret never reaches any URL or page
chk("client secret only ever sent to the token endpoint body", calls.every((x) => !x.u.includes("s3cret") && (x.u.endsWith("/oauth2/v2.0/token") || !String(x.init.body || "").includes("s3cret"))));

console.log(`\nhs-ms-marketplace: ${bad ? "FAIL " + bad + " of " + n : "ALL PASS (" + n + ")"}`);
process.exit(bad ? 1 : 0);
