// hs-ms-marketplace (2026-10-16): the Microsoft Marketplace side of HORIZON SHIELD's SaaS offer.
//
// Two jobs, both required by Microsoft for a transactable SaaS offer:
//   1. The landing page. A buyer who purchased the offer in Azure portal or Microsoft 365 admin center is sent to
//      /landing?token=<purchase token>. The buyer signs in with Microsoft Entra ID or a personal Microsoft account,
//      sees what was bought, and presses Activate. Only then does Microsoft start billing.
//   2. The connection webhook. Microsoft POSTs subscription events (Subscribe, ChangePlan, ChangeQuantity, Renew,
//      Suspend, Unsubscribe, Reinstate) to /webhook with an Entra bearer token. Every call is verified (signature,
//      issuer, tenant, audience, caller app) and then confirmed with the Operations API before anything is stored.
//
// Docs followed: learn.microsoft.com/partner-center/marketplace-offers/plan-saas-offer, pc-saas-registration,
// partner-center-portal/pc-saas-fulfillment-subscription-api, partner-center-portal/pc-saas-fulfillment-webhook.
//
// Configuration (no value is in this file):
//   vars    MS_TENANT_ID      the Entra tenant entered in the offer's technical configuration
//           MS_API_APP_ID     the single-tenant app that calls the fulfillment APIs (also the webhook token's aud)
//           MS_LOGIN_APP_ID   the multi-tenant + personal-account app used only to sign the buyer in
//   secrets MS_API_CLIENT_SECRET   client secret of MS_API_APP_ID
//           ADMIN_TOKEN            bearer for GET /admin/subscriptions
//           DAILY_READ_TOKEN       optional bearer for GET /admin/daily only (0.2.1). The measuring side reads the daily
//                                  list with it every day, so it does not need ADMIN_TOKEN, which can also change records.
//   kv      MS_SUBS           states, sessions, subscriptions, operation log
// What this worker does not do: deliver the service. An activated subscription is recorded and the operator is
// expected to start the engagement; the page says so to the buyer.
//
// Endpoint limits (0.2.0): each plan allows a number of endpoints, read from PLAN_LIMITS and nowhere else. A planId
// that is not in the table allows 0 endpoints: the buyer is not offered Activate, /activate refuses before calling
// Microsoft (so billing never starts for a plan this worker cannot serve), and a ChangePlan webhook to such a plan is
// refused with 409 before anything is stored, so Microsoft keeps the existing plan. A record whose planId is still not
// in the table (for example a plan removed from it later) is flagged unknown_plan with nothing owed daily measurement.
// The endpoints of a subscription are kept in
// its sub: record. A plan change down never deletes one: new endpoints are refused while the count is at or over the
// limit, and only the first <limit> endpoints (the ones the customer chose with /keep, then the oldest) are owed
// daily measurement; the rest are listed as over_limit until the customer removes some or changes plan again.
// Suspended and Unsubscribed subscriptions are owed nothing. GET /admin/daily is the list the operator hands to the
// measuring side.
//
// Activation: Microsoft's 200 on Activate means the request was received, not that the subscription is Subscribed
// (a failed activation is followed by an Unsubscribe webhook). So /activate records status ActivationRequested with
// activation "accepted". The status becomes Subscribed on a Subscribe webhook, on a later webhook whose operation is
// Succeeded, or when POST /admin/subscriptions/<id>/refresh reads saasSubscriptionStatus Subscribed from Microsoft.
// ActivationRequested already counts toward the plan's endpoints (flagged activation_requested), so the engagement
// can start at once; an Unsubscribe webhook takes it back to 0.

const VERSION = "0.2.1";
const MARKETPLACE_RESOURCE = "20e940b3-4c77-4b0b-9a53-9e16a1b010a7";
const FULFILLMENT = "https://marketplaceapi.microsoft.com/api/saas/subscriptions";
const API_VERSION = "2018-08-31";
const LOGIN = "https://login.microsoftonline.com";
const STATE_TTL = 900;      // seconds a sign-in round trip may take
const SESSION_TTL = 1800;   // seconds between sign-in and pressing Activate
const CLOCK_SKEW = 300;

// ---------------------------------------------------------------- small helpers
const enc = new TextEncoder();
function b64urlToBytes(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
function randomHex(n = 16) {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function json(o, status = 200) {
  return new Response(JSON.stringify(o, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function timingSafeEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length || a.length === 0) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------- plans and endpoint limits
// The one table of plans. A plan missing here allows 0 endpoints.
export const PLAN_LIMITS = Object.freeze({
  "endpoint-verification": 3,
  "endpoint-verification-pro": 10,
});
const planKnown = (planId) => typeof planId === "string" && Object.prototype.hasOwnProperty.call(PLAN_LIMITS, planId);
const planLimit = (planId) => (planKnown(planId) ? PLAN_LIMITS[planId] : 0);
const ENDPOINT_MAX_LEN = 2048;
function endpointOk(ep) {
  if (typeof ep !== "string" || ep.length > ENDPOINT_MAX_LEN || /\s/.test(ep)) return false;
  try { const u = new URL(ep); return u.protocol === "https:" && !!u.hostname && !u.username && !u.password; } catch (_e) { return false; }
}

// What a subscription is owed now. Pure: reads the record, writes nothing.
function entitlement(rec) {
  const known = planKnown(rec.planId);
  const status = rec.status || null;
  const live = status === "Subscribed" || status === "ActivationRequested";
  const limit = live ? planLimit(rec.planId) : 0;
  const eps = Array.isArray(rec.endpoints) ? rec.endpoints : [];
  const keep = Array.isArray(rec.keep) ? rec.keep : [];
  const rank = (e) => { const i = keep.indexOf(e.endpoint); return i === -1 ? keep.length : i; };
  const ordered = eps.map((e, i) => ({ e, i })).sort((a, b) =>
    rank(a.e) - rank(b.e) || String(a.e.added_at || "").localeCompare(String(b.e.added_at || "")) || a.i - b.i).map((x) => x.e);
  const daily = ordered.slice(0, limit).map((e) => e.endpoint);
  const over = ordered.slice(limit).map((e) => e.endpoint);
  const flags = [];
  if (!known) flags.push("unknown_plan");
  if (!live) flags.push("not_subscribed");
  if (status === "ActivationRequested") flags.push("activation_requested");
  if (live && eps.length > limit) flags.push("over_limit");
  return {
    planId: rec.planId || null, plan_known: known, status, limit, registered: eps.length,
    can_add: live && known && eps.length < limit, daily, over_limit: over, flags,
  };
}

// ---------------------------------------------------------------- JWT (RS256) against Microsoft's published keys
const jwksCache = new Map(); // url -> { at, keys }
// A failure to fetch Microsoft's keys says nothing about the token, so callers answer it with 5xx, never 401.
class KeyFetchError extends Error {}
async function jwks(url, fetchFn, force = false) {
  const hit = jwksCache.get(url);
  if (!force && hit && Date.now() - hit.at < 3600_000) return hit.keys;
  let keys;
  try {
    const res = await fetchFn(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error("status " + res.status);
    keys = (await res.json()).keys || [];
  } catch (e) { throw new KeyFetchError("jwks unavailable: " + e.message); }
  jwksCache.set(url, { at: Date.now(), keys });
  return keys;
}
// Verifies signature and time; returns the claims. Issuer, audience and the rest are checked by the caller.
async function verifyJwt(token, jwksUrl, fetchFn) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("not a JWT");
  const header = b64urlJson(parts[0]);
  if (header.alg !== "RS256") throw new Error("alg must be RS256");
  let keys = await jwks(jwksUrl, fetchFn);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) { keys = await jwks(jwksUrl, fetchFn, true); jwk = keys.find((k) => k.kid === header.kid); }  // key rotation
  if (!jwk) throw new Error("unknown kid");
  const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]), enc.encode(parts[0] + "." + parts[1]));
  if (!ok) throw new Error("bad signature");
  const c = b64urlJson(parts[1]);
  const now = Math.floor(Date.now() / 1000);
  if (typeof c.exp !== "number" || c.exp < now - CLOCK_SKEW) throw new Error("expired");
  if (typeof c.nbf === "number" && c.nbf > now + CLOCK_SKEW) throw new Error("not yet valid");
  return c;
}

// ---------------------------------------------------------------- fulfillment API
const tokenCache = { value: null, exp: 0 };
async function publisherToken(env, fetchFn) {
  if (tokenCache.value && tokenCache.exp - 120 > Date.now() / 1000) return tokenCache.value;
  const body = new URLSearchParams({
    grant_type: "client_credentials", client_id: env.MS_API_APP_ID, client_secret: env.MS_API_CLIENT_SECRET,
    scope: MARKETPLACE_RESOURCE + "/.default",
  });
  const res = await fetchFn(`${LOGIN}/${env.MS_TENANT_ID}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  if (!res.ok) throw new Error("token endpoint " + res.status);
  const j = await res.json();
  if (!j.access_token) throw new Error("no access_token");
  tokenCache.value = j.access_token;
  tokenCache.exp = Date.now() / 1000 + Number(j.expires_in || 3000);
  return j.access_token;
}
async function fulfillment(env, fetchFn, method, path, extraHeaders = {}) {
  const t = await publisherToken(env, fetchFn);
  const res = await fetchFn(`${FULFILLMENT}${path}${path.includes("?") ? "&" : "?"}api-version=${API_VERSION}`, {
    method, headers: { "content-type": "application/json", authorization: "Bearer " + t, "x-ms-requestid": crypto.randomUUID(), ...extraHeaders },
  });
  const text = await res.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch (_e) { body = null; }
  return { status: res.status, ok: res.ok, body };
}

// ---------------------------------------------------------------- pages
function page(title, inner, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | HORIZON SHIELD</title><meta name="robots" content="noindex">
<style>
:root{--ink:#111;--mute:#555;--rule:#d9d9d9;--red:#c8102e;--bg:#fff}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
main{max-width:640px;margin:0 auto;padding:48px 16px}
.brand{font-weight:700;letter-spacing:.04em;border-bottom:1px solid var(--ink);padding-bottom:8px;margin-bottom:32px}
.brand span{color:var(--red)}
h1{font-size:26px;line-height:1.25;margin:0 0 16px}
table{width:100%;border-collapse:collapse;margin:16px 0 24px}
td{border-top:1px solid var(--rule);padding:8px 0;vertical-align:top}
td:first-child{color:var(--mute);width:40%}
button{background:var(--ink);color:#fff;border:0;padding:12px 20px;font:inherit;cursor:pointer}
p.note{color:var(--mute);font-size:14px}
</style></head><body><main><div class="brand">HORIZON SHIELD <span>/</span> Microsoft Marketplace</div>${inner}</main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "no-referrer" } });
}
const row = (k, v) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`;
const TOKEN_EXPIRED = "We couldn't identify this purchase. Reopen this SaaS subscription in the Azure portal or in Microsoft 365 Admin Center and select Configure Account or Manage Account again.";

function configured(env) {
  return GUID.test(env.MS_TENANT_ID || "") && GUID.test(env.MS_API_APP_ID || "") && GUID.test(env.MS_LOGIN_APP_ID || "") && !!env.MS_API_CLIENT_SECRET && !!env.MS_SUBS;
}

// ---------------------------------------------------------------- handlers
async function landing(request, env, url) {
  const token = url.searchParams.get("token");
  if (!token) {
    return page("Configure your subscription", `<h1>HORIZON SHIELD on Microsoft Marketplace</h1>
<p>This page completes a purchase made in Microsoft Marketplace. Open it from the Azure portal or Microsoft 365 admin center by selecting <b>Configure account</b> on your HORIZON SHIELD subscription.</p>
<p class="note">Questions: contact@the-horizons-innovation.com</p>`);
  }
  const state = randomHex(16), nonce = randomHex(16);
  await env.MS_SUBS.put("st:" + state, JSON.stringify({ token, nonce }), { expirationTtl: STATE_TTL });
  const q = new URLSearchParams({
    client_id: env.MS_LOGIN_APP_ID, response_type: "id_token", response_mode: "form_post",
    redirect_uri: url.origin + "/auth/callback", scope: "openid profile email", state, nonce, prompt: "select_account",
  });
  return Response.redirect(`${LOGIN}/common/oauth2/v2.0/authorize?${q}`, 302);
}

async function authCallback(request, env, fetchFn) {
  const form = await request.formData();
  if (form.get("error")) return page("Sign-in did not complete", `<h1>Sign-in did not complete</h1><p>${esc(form.get("error_description") || form.get("error"))}</p>`, 400);
  const state = String(form.get("state") || "");
  const raw = state ? await env.MS_SUBS.get("st:" + state) : null;
  if (!raw) return page("Session expired", `<h1>This sign-in has expired</h1><p>${esc(TOKEN_EXPIRED)}</p>`, 400);
  await env.MS_SUBS.delete("st:" + state);
  const st = JSON.parse(raw);

  let user;
  try {
    const c = await verifyJwt(form.get("id_token"), `${LOGIN}/common/discovery/v2.0/keys`, fetchFn);
    if (c.aud !== env.MS_LOGIN_APP_ID) throw new Error("aud");
    if (!GUID.test(c.tid || "") || c.iss !== `${LOGIN}/${c.tid}/v2.0`) throw new Error("iss");
    if (c.nonce !== st.nonce) throw new Error("nonce");
    user = { name: c.name || "", email: c.email || c.preferred_username || "", oid: c.oid || "", tid: c.tid };
  } catch (e) {
    return page("Sign-in could not be verified", `<h1>Sign-in could not be verified</h1><p class="note">${esc(e.message)}</p>`, 401);
  }

  let r;
  try {
    r = await fulfillment(env, fetchFn, "POST", "/resolve", { "x-ms-marketplace-token": st.token });
  } catch (e) {
    return page("Marketplace unavailable", `<h1>We could not reach Microsoft Marketplace</h1><p>Please try again in a few minutes. If it keeps failing, write to contact@the-horizons-innovation.com.</p>`, 502);
  }
  if (r.status === 400) return page("Purchase not identified", `<h1>Purchase not identified</h1><p>${esc(TOKEN_EXPIRED)}</p>`, 400);
  if (!r.ok || !r.body || !r.body.id) return page("Marketplace error", `<h1>Microsoft Marketplace returned an error</h1><p class="note">HTTP ${esc(r.status)}</p>`, 502);

  const sub = r.body.subscription || {};
  const status = sub.saasSubscriptionStatus || "";
  const already = status === "Subscribed";
  if (!already && !planKnown(r.body.planId)) {
    return page("Plan not available", `<h1>This plan cannot be activated here</h1>
<table>${row("Plan", r.body.planId)}${row("Subscription id", r.body.id)}</table>
<p>The plan in this purchase is not one this service delivers, so it was not activated and you were not billed. Please write to contact@the-horizons-innovation.com with the subscription id above.</p>`, 409);
  }
  const sid = randomHex(24);
  await env.MS_SUBS.put("ses:" + sid, JSON.stringify({ user, resolved: r.body }), { expirationTtl: SESSION_TTL });
  return page("Confirm your subscription", `<h1>${already ? "Your subscription is active" : "Confirm your subscription"}</h1>
<table>
${row("Subscription", r.body.subscriptionName || sub.name)}
${row("Offer", r.body.offerId)}
${row("Plan", r.body.planId)}
${row("Endpoints included", planLimit(r.body.planId))}
${r.body.quantity ? row("Quantity", r.body.quantity) : ""}
${row("Purchased by", (sub.purchaser && sub.purchaser.emailId) || "")}
${row("For", (sub.beneficiary && sub.beneficiary.emailId) || "")}
${row("Signed in as", user.email || user.name)}
${row("Status", status)}
${sub.isTest ? row("Test purchase", "yes") : ""}
</table>
${already ? `<p>Nothing more to do here. We will be in touch at the address above.</p>` : `<form method="post" action="/activate"><input type="hidden" name="c" value="${esc(sid)}"><button type="submit">Activate subscription</button></form>
<p class="note">Billing starts when you press Activate. HORIZON SHIELD is paid only by its customers and takes no referral fee or commission from anyone it measures.</p>`}`);
}

async function activate(request, env, fetchFn) {
  const form = await request.formData();
  const sid = String(form.get("c") || "");
  const raw = /^[0-9a-f]{48}$/.test(sid) ? await env.MS_SUBS.get("ses:" + sid) : null;
  if (!raw) return page("Session expired", `<h1>This confirmation has expired</h1><p>${esc(TOKEN_EXPIRED)}</p>`, 400);
  await env.MS_SUBS.delete("ses:" + sid);  // single use
  const { user, resolved } = JSON.parse(raw);
  const subId = resolved.id;
  if (!GUID.test(subId)) return page("Marketplace error", `<h1>Unexpected subscription id</h1>`, 502);
  if (!planKnown(resolved.planId)) return page("Plan not available", `<h1>This plan cannot be activated here</h1><p>It was not activated and you were not billed. Please write to contact@the-horizons-innovation.com.</p>`, 409);
  let r;
  try { r = await fulfillment(env, fetchFn, "POST", `/${subId}/activate`); }
  catch (_e) { return page("Marketplace unavailable", `<h1>We could not reach Microsoft Marketplace</h1><p>Your subscription was not activated and you were not billed. Please try again from Configure account.</p>`, 502); }
  if (!r.ok) return page("Activation failed", `<h1>Activation did not go through</h1><p>Microsoft returned HTTP ${esc(r.status)}. You were not billed. Please try again from Configure account, or write to contact@the-horizons-innovation.com.</p>`, 502);
  const sub = resolved.subscription || {};
  const rec = {
    id: subId, offerId: resolved.offerId, planId: resolved.planId, quantity: resolved.quantity || null, name: resolved.subscriptionName || sub.name || "",
    purchaser: sub.purchaser || null, beneficiary: sub.beneficiary || null, isTest: !!sub.isTest,
    activated_at: new Date().toISOString(), activated_by: user, activation: "accepted", status: "ActivationRequested",
    events: [], endpoints: [], keep: [],
  };
  await env.MS_SUBS.put("sub:" + subId, JSON.stringify(rec));
  return page("Activation received", `<h1>Activation received</h1>
<p>Thank you. We will write to ${esc((sub.beneficiary && sub.beneficiary.emailId) || user.email || "you")} within one business day to start the engagement.</p>
<table>${row("Plan", resolved.planId)}${row("Endpoints included", planLimit(resolved.planId))}${row("Subscription id", subId)}</table>
<p class="note">Questions: contact@the-horizons-innovation.com</p>`);
}

function refuseUnknownPlan(planId) {
  return json({ error: "unknown_plan", refused: true, planId, plans: Object.keys(PLAN_LIMITS),
    note: "This plan is not one this service delivers, so the change is refused and the subscription keeps its current plan." }, 409);
}

async function webhook(request, env, fetchFn) {
  const auth = request.headers.get("authorization") || "";
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  if (!m) return json({ error: "missing bearer token" }, 401);
  let c;
  try {
    c = await verifyJwt(m[1], `${LOGIN}/${env.MS_TENANT_ID}/discovery/v2.0/keys`, fetchFn);
  } catch (e) {
    if (e instanceof KeyFetchError) return json({ error: "signing keys unavailable; retry" }, 503);
    return json({ error: "token rejected", why: e.message }, 401);
  }
  const issOk = c.iss === `https://sts.windows.net/${env.MS_TENANT_ID}/` || c.iss === `${LOGIN}/${env.MS_TENANT_ID}/v2.0`;
  const audOk = c.aud === env.MS_API_APP_ID || c.aud === "api://" + env.MS_API_APP_ID;
  const callerOk = (c.appid || c.azp) === MARKETPLACE_RESOURCE;
  if (!issOk || c.tid !== env.MS_TENANT_ID || !audOk || !callerOk)
    return json({ error: "token rejected", why: !issOk ? "iss" : c.tid !== env.MS_TENANT_ID ? "tid" : !audOk ? "aud" : "caller" }, 401);

  let ev;
  try { ev = await request.json(); } catch (_e) { return json({ error: "body is not JSON" }, 400); }
  const subId = ev && ev.subscriptionId, opId = ev && ev.id;
  if (!GUID.test(subId || "") || !GUID.test(opId || "")) return json({ error: "subscriptionId and id must be GUIDs" }, 400);

  // A ChangePlan to a plan this worker does not serve is refused here, after the token is verified and before any slow
  // call, so the 4xx reaches Microsoft well inside its 10 seconds. The new plan is the payload's top-level planId
  // (subscription.planId is the old one). Nothing is stored; Microsoft keeps the existing plan.
  if (ev.action === "ChangePlan" && typeof ev.planId === "string" && ev.planId && !planKnown(ev.planId)) return refuseUnknownPlan(ev.planId);

  // Microsoft: "call the Get Operation API to validate and authorize the webhook call and payload data before taking action".
  // For ChangePlan and ChangeQuantity a 4xx answer means "refuse this change" (it must arrive within 10 seconds, after
  // which the change is accepted). So every failure that is not a refusal answers 503: Microsoft retries it, and if
  // the retries outlast the 10 seconds the change is accepted, which is the safe side for a failure of ours.
  let op;
  try { op = await fulfillment(env, fetchFn, "GET", `/${subId}/operations/${opId}`); }
  catch (_e) { return json({ error: "operation lookup unavailable; retry" }, 503); }
  if (!op.ok || !op.body) return json({ error: "operation not confirmed by Microsoft; retry", status: op.status }, 503);
  const action = op.body.action || ev.action;
  if (ev.action && op.body.action && ev.action !== op.body.action) return json({ error: "payload action does not match the operation" }, 400);

  // The refusal is decided here, before any storage is touched, to stay well inside the 10 seconds.
  let toPlan = null;
  if (action === "ChangePlan") {
    toPlan = op.body.planId || ev.planId || null;
    if (!toPlan) return json({ error: "the operation names no plan; retry" }, 503);
    if (!planKnown(toPlan)) return refuseUnknownPlan(toPlan);   // the payload named no plan, or one the operation contradicts
  }

  const key = "sub:" + subId;
  let cur;
  try { cur = JSON.parse((await env.MS_SUBS.get(key)) || "null") || { id: subId, events: [] }; }
  catch (_e) { return json({ error: "storage unavailable; retry" }, 503); }
  // Microsoft retries a webhook up to 500 times over eight hours; one operation is recorded once.
  if ((cur.events || []).some((e) => e && e.operationId === opId))
    return json({ ok: true, duplicate: true, action, subscriptionId: subId });
  const opStatus = op.body.status || null;
  // Reinstate is recorded; it moves the status to Subscribed only once its operation is Succeeded (while it runs,
  // Microsoft keeps the subscription Suspended). ChangeQuantity only records the quantity: the plans are flat rate.
  const statusFor = { Subscribe: "Subscribed", Unsubscribe: "Unsubscribed", Suspend: "Suspended", Renew: cur.status || "Subscribed" };
  if (action === "Reinstate" && opStatus === "Succeeded") statusFor.Reinstate = "Subscribed";
  if (cur.status === "ActivationRequested" && opStatus === "Succeeded" && ["Renew", "ChangePlan", "ChangeQuantity"].includes(action)) statusFor[action] = "Subscribed";
  cur.events = (cur.events || []).concat([{ at: new Date().toISOString(), action, operationId: opId, status: opStatus || ev.status || null, planId: op.body.planId || ev.planId || null, quantity: op.body.quantity ?? ev.quantity ?? null }]).slice(-100);
  if (statusFor[action]) cur.status = statusFor[action];
  if (toPlan) {
    cur.plan_changes = (cur.plan_changes || []).concat([{ at: new Date().toISOString(), operationId: opId, from: cur.planId || null, to: toPlan,
      from_limit: planLimit(cur.planId), to_limit: planLimit(toPlan) }]).slice(-50);
    cur.planId = toPlan;
  }
  if (action === "ChangeQuantity" && (op.body.quantity ?? ev.quantity) != null) cur.quantity = op.body.quantity ?? ev.quantity;
  if (!cur.offerId && ev.offerId) cur.offerId = ev.offerId;
  try { await env.MS_SUBS.put(key, JSON.stringify(cur)); }
  catch (_e) { return json({ error: "storage unavailable; retry" }, 503); }
  // A ChangePlan to a known plan, and every ChangeQuantity, is accepted by sending no PATCH (accepted after 10 seconds).
  // A move down is accepted too: nothing is deleted, the endpoints over the new limit are listed as over_limit and are
  // not owed daily measurement.
  const ent = entitlement(cur);
  return json({ ok: true, action, subscriptionId: subId, entitlement: { planId: ent.planId, limit: ent.limit, registered: ent.registered, flags: ent.flags } });
}

function adminOk(request, env) {
  const auth = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return !!env.ADMIN_TOKEN && timingSafeEqual(auth, env.ADMIN_TOKEN);
}
// 0.2.1. The read-only key for the daily list. It opens GET /admin/daily and nothing else.
function dailyReaderOk(request, env) {
  const auth = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return !!env.DAILY_READ_TOKEN && timingSafeEqual(auth, env.DAILY_READ_TOKEN);
}
async function allSubs(env) {
  const out = [];
  let cursor;
  do {
    const l = await env.MS_SUBS.list({ prefix: "sub:", cursor });
    for (const k of l.keys) { const v = await env.MS_SUBS.get(k.name); if (v) out.push(JSON.parse(v)); }
    cursor = l.list_complete ? null : l.cursor;
  } while (cursor);
  return out;
}
async function adminList(request, env) {
  if (!adminOk(request, env)) return json({ error: "unauthorized" }, 401);
  const out = (await allSubs(env)).map((s) => ({ ...s, entitlement: entitlement(s) }));
  return json({ count: out.length, plans: PLAN_LIMITS, subscriptions: out });
}

// The endpoints owed daily measurement, across subscriptions; the operator hands this list to the measuring side.
async function adminDaily(request, env) {
  if (!adminOk(request, env) && !dailyReaderOk(request, env)) return json({ error: "unauthorized" }, 401);
  const daily = [], over = [], unknown = [];
  for (const s of await allSubs(env)) {
    const e = entitlement(s);
    for (const ep of e.daily) daily.push({ endpoint: ep, subscriptionId: s.id, planId: s.planId || null });
    for (const ep of e.over_limit) over.push({ endpoint: ep, subscriptionId: s.id, planId: s.planId || null, status: e.status });
    if (!e.plan_known) unknown.push({ subscriptionId: s.id, planId: s.planId || null, status: e.status });
  }
  return json({ plans: PLAN_LIMITS, daily, not_daily: over, unknown_plan: unknown });
}

// Reads the subscription from Microsoft (Get subscription) and marks it Subscribed when Microsoft says so.
async function adminRefresh(request, env, fetchFn, subId) {
  if (!adminOk(request, env)) return json({ error: "unauthorized" }, 401);
  if (!GUID.test(subId)) return json({ error: "subscription id must be a GUID" }, 400);
  const key = "sub:" + subId;
  const raw = await env.MS_SUBS.get(key);
  if (!raw) return json({ error: "no such subscription" }, 404);
  let r;
  try { r = await fulfillment(env, fetchFn, "GET", `/${subId}`); }
  catch (_e) { return json({ error: "Microsoft unavailable; retry" }, 503); }
  if (!r.ok || !r.body) return json({ error: "subscription not read from Microsoft", status: r.status }, 502);
  const rec = JSON.parse(raw);
  const ms = r.body.saasSubscriptionStatus || null;
  rec.ms_status = { saasSubscriptionStatus: ms, planId: r.body.planId || null, read_at: new Date().toISOString() };
  if (ms === "Subscribed" && rec.status === "ActivationRequested") { rec.status = "Subscribed"; rec.subscribed_confirmed_at = rec.ms_status.read_at; }
  await env.MS_SUBS.put(key, JSON.stringify(rec));
  return json({ ok: true, subscriptionId: subId, status: rec.status, ms_status: rec.ms_status, entitlement: entitlement(rec) });
}

// POST adds an endpoint, DELETE removes one, POST .../keep sets which endpoints stay daily when over the limit.
async function adminEndpoints(request, env, subId, op) {
  if (!adminOk(request, env)) return json({ error: "unauthorized" }, 401);
  if (!GUID.test(subId)) return json({ error: "subscription id must be a GUID" }, 400);
  const key = "sub:" + subId;
  const raw = await env.MS_SUBS.get(key);
  if (!raw) return json({ error: "no such subscription" }, 404);
  const rec = JSON.parse(raw);
  rec.endpoints = Array.isArray(rec.endpoints) ? rec.endpoints : [];
  rec.keep = Array.isArray(rec.keep) ? rec.keep : [];
  let body;
  try { body = await request.json(); } catch (_e) { return json({ error: "body is not JSON" }, 400); }
  const has = (ep) => rec.endpoints.some((e) => e.endpoint === ep);

  if (op === "keep") {
    const list = body && body.endpoints;
    if (!Array.isArray(list) || list.some((ep) => !has(ep)) || new Set(list).size !== list.length)
      return json({ error: "endpoints must be a list of this subscription's endpoints, each once" }, 400);
    const lim = planLimit(rec.planId);
    if (list.length > lim) return json({ error: "more endpoints than the plan allows", limit: lim }, 409);
    rec.keep = list;
  } else {
    const ep = body && body.endpoint;
    if (!endpointOk(ep)) return json({ error: "endpoint must be an https URL" }, 400);
    if (request.method === "DELETE") {
      if (!has(ep)) return json({ error: "not registered on this subscription" }, 404);
      rec.endpoints = rec.endpoints.filter((e) => e.endpoint !== ep);
      rec.keep = rec.keep.filter((k) => k !== ep);
    } else {
      if (has(ep)) return json({ ok: true, unchanged: true, subscriptionId: subId, entitlement: entitlement(rec) });
      const e = entitlement(rec);
      if (!e.can_add) {
        const why = !e.plan_known ? "unknown_plan" : e.flags.includes("not_subscribed") ? "not_subscribed" : "limit_reached";
        return json({ error: why, planId: e.planId, limit: e.limit, registered: e.registered }, 409);
      }
      rec.endpoints = rec.endpoints.concat([{ endpoint: ep, added_at: new Date().toISOString() }]);
    }
  }
  await env.MS_SUBS.put(key, JSON.stringify(rec));
  return json({ ok: true, subscriptionId: subId, entitlement: entitlement(rec) });
}

export default {
  async fetch(request, env, ctx, fetchFn = fetch) {
    const url = new URL(request.url);
    const p = url.pathname;
    try {
      if (p === "/health") return json({ ok: true, service: "hs-ms-marketplace", version: VERSION, configured: configured(env), plans: PLAN_LIMITS });
      if (!configured(env)) return json({ error: "not configured", needs: ["MS_TENANT_ID", "MS_API_APP_ID", "MS_LOGIN_APP_ID", "MS_API_CLIENT_SECRET", "MS_SUBS"] }, 503);
      if (p === "/landing" && request.method === "GET") return landing(request, env, url);
      if (p === "/auth/callback" && request.method === "POST") return authCallback(request, env, fetchFn);
      if (p === "/activate" && request.method === "POST") return activate(request, env, fetchFn);
      if (p === "/webhook" && request.method === "POST") return webhook(request, env, fetchFn);
      if (p === "/admin/subscriptions" && request.method === "GET") return adminList(request, env);
      if (p === "/admin/daily" && request.method === "GET") return adminDaily(request, env);
      const rm = /^\/admin\/subscriptions\/([^/]+)\/refresh$/.exec(p);
      if (rm && request.method === "POST") return adminRefresh(request, env, fetchFn, rm[1]);
      const am = /^\/admin\/subscriptions\/([^/]+)\/(endpoints|keep)$/.exec(p);
      if (am && (request.method === "POST" || (request.method === "DELETE" && am[2] === "endpoints"))) return adminEndpoints(request, env, am[1], am[2]);
      if (p === "/" && request.method === "GET") return Response.redirect(url.origin + "/landing", 302);
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: "internal error" }, 500);
    }
  },
};

export const _test = { verifyJwt, jwksCache, tokenCache, entitlement, planLimit };
