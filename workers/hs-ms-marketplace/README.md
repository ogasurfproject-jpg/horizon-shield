# hs-ms-marketplace

The Microsoft Marketplace side of HORIZON SHIELD's SaaS offer: the landing page a buyer is sent to after purchase, and
the connection webhook Microsoft calls for subscription events. Deployed at `https://marketplace.horizonshield.dev`.

| Route | What it does |
|---|---|
| `GET /landing?token=...` | Keeps the purchase token server side and sends the buyer to Microsoft sign-in (Entra ID or a personal Microsoft account, `id_token` by `form_post`). |
| `POST /auth/callback` | Verifies the `id_token` (RS256 against Microsoft's keys, audience, issuer bound to the token's tenant, nonce), resolves the purchase with the SaaS Fulfillment API and shows what was bought. Nothing is billed yet. |
| `POST /activate` | The buyer pressed Activate: calls the Activate API (billing starts only on success) and records the subscription with status `ActivationRequested` and `activation: "accepted"`. Microsoft's 200 means the request was received, so the record is not `Subscribed` yet (a failed activation is followed by an Unsubscribe webhook). Single use. |
| `POST /webhook` | Verifies Microsoft's Entra bearer token (signature, issuer, `tid`, `aud` = the API app, caller `appid`/`azp` = the Marketplace API), then confirms the event with the Get Operation API before recording it. A ChangePlan whose payload `planId` (the new plan) is not in `PLAN_LIMITS` is refused with 409 right after the token check, before Get Operation is called. Reinstate is recorded and sets `Subscribed` only when its operation's status is `Succeeded`. A ChangePlan to a known plan, and every ChangeQuantity, is accepted by not sending a PATCH (Microsoft accepts it after 10 seconds). When the payload names no plan, the plan from Get Operation is checked the same way. A refusal stores nothing, so the subscription keeps its plan. ChangeQuantity records the quantity only; the plans are flat rate and the endpoint limit comes from the plan. Any failure that is not a refusal (Microsoft's keys or token unavailable, Get Operation not found or failing, storage failing) answers 503, because a 4xx on ChangePlan or ChangeQuantity means refuse. A token that does not verify is 401. One operation id is recorded once, however often Microsoft retries it. |
| `GET /admin/subscriptions` | The recorded subscriptions, their events and what each is owed now (`entitlement`), for the operator (bearer `ADMIN_TOKEN`). |
| `POST` / `DELETE /admin/subscriptions/<id>/endpoints` | Adds or removes one endpoint (`{"endpoint":"https://..."}`) on a subscription. A new endpoint is refused (409) when the plan's limit is reached, the plan is unknown, or the subscription is not Subscribed. Bearer `ADMIN_TOKEN`. |
| `POST /admin/subscriptions/<id>/refresh` | Reads the subscription from Microsoft (Get subscription) and marks an `ActivationRequested` record `Subscribed` when `saasSubscriptionStatus` is `Subscribed`. Bearer `ADMIN_TOKEN`. |
| `POST /admin/subscriptions/<id>/keep` | The customer's choice of which endpoints stay on daily measurement when there are more than the plan allows (`{"endpoints":[...]}`, at most the limit). Bearer `ADMIN_TOKEN`. |
| `GET /admin/daily` | The endpoints owed daily measurement across all subscriptions, the ones over a limit, and subscriptions on an unknown plan. This is the list the operator hands to the measuring side. Bearer `ADMIN_TOKEN`, or `DAILY_READ_TOKEN` (0.2.1), a key that opens this route only, so the measuring side that reads the list every day does not hold `ADMIN_TOKEN`. |
| `GET /health` | Version, the plan table, and whether the worker is configured (never the values). |

Partner Center, offer technical configuration:

- Landing page URL: `https://marketplace.horizonshield.dev/landing`
- Connection webhook: `https://marketplace.horizonshield.dev/webhook`
- Microsoft Entra tenant ID: the tenant that holds the API app
- Microsoft Entra application ID: the API app (single tenant)

Two Entra apps, as Microsoft's registration guide asks: a single-tenant app with a client secret that calls the
fulfillment APIs (its service principal must sit in the same tenant as the Marketplace API's,
`20e940b3-4c77-4b0b-9a53-9e16a1b010a7`), and a separate sign-in app for buyers from any organisation or a personal
Microsoft account, with no secret (ID tokens only).

Endpoint limits. `PLAN_LIMITS` in `src/worker.js` is the only table of plans:

| planId | Endpoints |
|---|---|
| `endpoint-verification` | 3 |
| `endpoint-verification-pro` | 10 |

A planId that is not in the table allows 0 endpoints. The confirmation page offers no Activate button for it and
`/activate` refuses before calling Microsoft, so billing does not start for a plan this worker cannot serve. A
ChangePlan webhook to such a plan is refused (409) and nothing is stored. A record whose plan is still not in the table
(a plan removed from it later) is listed under `unknown_plan` with nothing owed daily.

A ChangePlan up raises the limit at once. A ChangePlan down deletes nothing: new endpoints are refused while the count
is at or over the new limit, the first endpoints up to the limit (the ones in `keep`, then the oldest) stay on daily
measurement, and the rest are listed as `over_limit` until the customer removes some, chooses others with `keep`, or
changes plan again. Suspended and Unsubscribed subscriptions are owed nothing daily; their endpoints are kept.
`ActivationRequested` counts toward the plan from the moment Microsoft accepts the activation (flagged
`activation_requested`), so the engagement can start at once; an Unsubscribe webhook brings it back to 0. It becomes
`Subscribed` on a Subscribe webhook, on a later webhook whose operation is `Succeeded`, or through `/refresh`.

To confirm with a test purchase: whether the Get Operation API answers for the operation ids of Subscribe, Renew and
Suspend events (Microsoft's pages disagree; a 404 there answers 503 and the event is retried, not recorded).

Tests: `node test/worker.test.mjs` (offline; Microsoft's endpoints are faked and every request is checked).

What this worker does not do: deliver the service. An activated subscription is recorded and the operator starts the
engagement; the buyer is told so on the page.
