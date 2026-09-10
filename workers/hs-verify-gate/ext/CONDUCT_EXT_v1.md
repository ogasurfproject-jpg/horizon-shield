# A2A Conduct Extension v1 (`conduct-v1`)

**Extension URI (the identifier, compared as an exact string):** `https://gate.horizonshield.dev/ext/conduct/v1`
**Status:** v1, 2026-09-06 (sections 9 and 10 and the wire notes in sections 3 and 4 added the same day, before any anchoring). Revision v1.1, 2026-09-07: section 11, additive, same URI, every added field OPTIONAL; served from gate 0.4.0 with a new `spec_markdown_sha256`. Reference implementations: MCP Verification Gate 0.3.3 (reads it, serves this document at the URI, answers `SendMessage` at `/a2a`), HORIZON SHIELD KIRA and JIDEC agent cards (declare and echo it on both A2A wire versions), `a2a_conduct_walk.py` (client-side witness walk). Interoperability with the official A2A SDKs (`a2a-sdk` 1.1.x for Python, `@a2a-js/sdk` 1.1.x) is exercised by `workers/hs-mcp/test/sdk_js_interop.mjs` and `sdk_py_interop.py` against the real server code, both wire versions, no network.
**Type:** data-only A2A extension on the Agent Card, plus an optional request-level echo. It MUST NOT be declared `required: true` (A2A guidance: data-only extensions are never required).
**Language:** RFC 2119 keywords. Field names are exact.

## 1. What this is for

An agent about to hand work to another agent can read three things before the first message: who pays the other agent, where a record of that agent's measured conduct lives that the agent itself did not write, and where to file its own observation of that agent. The extension carries one declaration and a set of pointers. It carries no score, no rank, and no verdict of its own. Declaring it proves nothing; the third-party record at `conduct_record` is the evidence, and only if the client fetched it.

## 2. Declaration in the Agent Card

The agent lists the extension under `capabilities.extensions[]` (A2A 1.0, `AgentExtension`: `uri`, `description`, `required`, `params`).

```json
{
  "uri": "https://gate.horizonshield.dev/ext/conduct/v1",
  "description": "Who pays this agent, where its measured conduct record lives, and where to file a witness walk.",
  "required": false,
  "params": {
    "compensation": { "paid_by": "buyer", "referral_fee": false, "listing_fee": false, "success_fee_pct": 0, "disclosure_url": "https://..." },
    "measured_endpoints": ["https://mcp.horizonshield.dev/mcp"],
    "conduct_record": "https://gate.horizonshield.dev/history?endpoint=https%3A%2F%2Fmcp.horizonshield.dev%2Fmcp",
    "verdict_recipe": "https://gate.horizonshield.dev/spec",
    "witness_intake": "https://ledger.horizonshield.dev/witness",
    "consent": "https://mcp.horizonshield.dev/.well-known/mcp-conduct.json",
    "register": "https://gate.horizonshield.dev/register",
    "rings": {
      "spec": "https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-ledger/nenrin/NENRIN_SPEC_v1.md",
      "spec_sha256": "9ccba2e325fd2a555fcdb2dec519b8c6bf7a669064674846aea98ecfff824e3d",
      "base": "https://raw.githubusercontent.com/ogasurfproject-jpg/mcp-conduct-register/main/rings/",
      "path": "<slug>/<YYYY-MM>.json",
      "slug": "endpoint URL without https://, lower case, every run of characters outside [a-z0-9] replaced by one hyphen, hyphens trimmed at both ends",
      "ledger": "https://ledger.horizonshield.dev/ledger"
    }
  }
}
```

`params` fields:

| field | type | requirement | meaning |
|---|---|---|---|
| `compensation` | object | REQUIRED | Who pays the agent. `paid_by` MUST be one of `buyer`, `seller`, `referral`, `advertising`, `subscription`, `public`, `other`. `referral_fee` and `listing_fee` MUST be booleans. `success_fee_pct`, when present, MUST be a number from 0 to 100. `disclosure_url`, when present, MUST be a string. Content is not judged by anyone reading this field; only the absence or malformation of the declaration is a failure. This is the same shape the gate's condition 3 has read at the card's top-level `compensation` key since 0.2.0. |
| `measured_endpoints` | string[] | REQUIRED, at least one | The exact URL(s) whose conduct is recorded, as they appear on the register. |
| `conduct_record` | string (https URL) | REQUIRED | A live record of measurements of the agent, written by a party other than the agent. For gate-measured endpoints this is `https://gate.horizonshield.dev/history?endpoint=<url-encoded endpoint>`. Every record there carries a `record_sha256` that the reader recomputes. |
| `witness_intake` | string (https URL) | REQUIRED | Where a client files its own walk of the agent (section 4). |
| `verdict_recipe` | string (https URL) | OPTIONAL | How to recompute the hashes in `conduct_record`. |
| `consent` | string (https URL) | OPTIONAL | The origin's `/.well-known/mcp-conduct.json`, the owner's proof of consent to tool calls during measurement. |
| `register` | string (https URL) | OPTIONAL | The public register the endpoint sits on. |
| `rings` | object | OPTIONAL | Where monthly conduct rings (NENRIN Layer 3) are published, with the spec they follow and its sha256. |

A card MAY keep the top-level `compensation` key for readers that predate this extension. When both are present they MUST be equal on the five keys above; two declarations that disagree are a failed disclosure, not a choice for the reader to make. When the extension is listed more than once with this URI, every listing MUST carry an equal `compensation`.

## 3. Request-level echo (optional)

A client activates the extension by sending the A2A service parameter `A2A-Extensions` containing this URI (an HTTP header in the HTTP bindings). An agent that declares the extension MUST then include this URI in the `A2A-Extensions` header of its response and MUST place these keys in the `metadata` of the returned `Message` or `Task`:

| metadata key | value |
|---|---|
| `https://gate.horizonshield.dev/ext/conduct/v1/endpoint` | the entry of `measured_endpoints` that served this request |
| `https://gate.horizonshield.dev/ext/conduct/v1/conduct_record` | same value as `params.conduct_record` |
| `https://gate.horizonshield.dev/ext/conduct/v1/witness_intake` | same value as `params.witness_intake` |

Nothing else. No timestamp (a time an issuer chooses is a coordinate the issuer controls), no score. An agent that declares the extension and does not echo on activation is non-conforming; a client SHOULD record that as a discrepancy (section 4, `verdict.ok = false`). An agent that does not declare the extension is free to ignore the header, as A2A allows.

**Two spellings of the header, two versions of the wire.** A2A 0.3 named the service parameter `X-A2A-Extensions`; A2A 1.0 names it `A2A-Extensions`. The 0.3 compatibility paths of the official SDKs still emit the old spelling (`@a2a-js/sdk` 1.1.0 emits only `X-A2A-Extensions` on the 0.3 wire; `a2a-sdk` 1.1.x for Python emits both). An agent MUST read the URI from either header, MUST echo it under `A2A-Extensions`, and MUST also echo it under `X-A2A-Extensions` when the request carried that spelling (a 0.3 client reads only the spelling it sent). The wire version is decided by the method name (`SendMessage` is 1.0, `message/send` is 0.3) and, failing that, by the `A2A-Version` header; the response takes the shape of that wire (1.0: `{"task": ...}` or `{"message": ...}` with `TASK_STATE_*` and `ROLE_*` enum names and parts discriminated by member name; 0.3: a `Message` or `Task` with `kind`). The `metadata` keys above are the same on both wires. The agent SHOULD also list this URI in the `extensions` field of the returned `Message` (or of `status.message` on a `Task`), the field A2A provides for "extensions that contributed to this message". A card that carries the extension SHOULD publish `supportedInterfaces[]` with a `protocolVersion: "1.0"` entry first, and MAY keep the 0.3 `url` / `preferredTransport` / `protocolVersion` keys beside it for 0.3-only readers; both official SDKs read such a card as 1.0 and ignore the 0.3 keys.

## 4. Witness walk: `a2a-conduct-walk-v1`

This is how every connecting client becomes a witness. A walk is a `jidec-path-v1` record (JIDEC_PATH_SPEC_v1.md, ledger entry 5) with a `witness` field, submitted as `POST <witness_intake>` with body `{"record_canonical": "<exact bytes>"}`. Canonical bytes are UTF-8 of the record with keys sorted at every nesting level, separators `,` and `:` with no spaces, non-ASCII unescaped (Python `json.dumps(obj, sort_keys=True, separators=(",",":"), ensure_ascii=False)`; a JavaScript implementation MUST sort keys recursively before `JSON.stringify`, the seam recorded in ledger entry 34).

Fields:

- `schema`: `"jidec-path-v1"`. `purpose`: `"a2a-conduct-walk-v1: <measured endpoint>"`. `walked_at`: ISO-8601 UTC. `base`: the card origin (`https://host`). `witness`: `{ "name": "<who>", "vantage": "<network or tool the walk was taken from>" }`; `name` MAY be `anonymous`.
- `nodes`: n0 `fetch` GET `<origin>/.well-known/agent-card.json`; n1 the same GET again; n2 `compute` "locate the extension by URI in n1 and validate `params`"; n3 `fetch` POST to the measured endpoint with header `A2A-Extensions: <this URI>` and a JSON-RPC body (MCP `initialize`, or A2A `SendMessage` / `message/send` when the endpoint is the A2A interface). Each `fetch` node records `request.url`, `request.method`, `response.status`, `response.body_sha256` over the exact bytes received. A walk MUST touch at least one `measured_endpoints` entry or the origin, or the ring builder will not count it for that endpoint.
- `assertions` (each with `claim`, `op`, `result`, `evidence_nodes`): `card_bytes_stable` (n0 body sha equals n1 body sha), `conduct_ext_declared` (n1 carries this URI under `capabilities.extensions[]`), `compensation_well_formed` (section 2 shape), `measured_endpoint_answered` (n3 status 200 and a JSON-RPC `result` of the shape the wire version requires), `extension_echoed` (the n3 response carries this URI under `A2A-Extensions`, or under `X-A2A-Extensions` when the walk sent that spelling; only asserted when n3 was an A2A message, otherwise recorded with `result: null` and `note: "not applicable"`). A walk in A2A mode records which wire it used (`conduct_ext.wire`, `"1.0"` or `"0.3"`); a 0.3 walk sends `message/send` with the header spelled `X-A2A-Extensions` only, which is what a 0.3 client does.
- `card_signature` (added 2026-09-10, informational, OPTIONAL): what the walked card's A2A section 8.4 signature block says, read without being checked: `present`, `count`, `alg`, `kid`, `jku`, `jku_same_host`, `protected_readable`, and `verified` with `verified_reason`. The reference client sets `verified` to `null` always, because verifying requires reproducing the card's canonical form and a canonicalizer that is one rule wrong would accuse an honest agent in an append only ledger. A client that has proved its canonical form against the same vectors as the measurer MAY set `verified` to a boolean; a client that has not MUST NOT. An unsigned card is not a finding: this extension does not require a signed card. Under `hash-only` and `commitment` the `jku` is dropped and `jku_same_host` is kept.
- `verdict`: `{ "ok": <all applicable assertions true>, "outcome": "PASS" | "FAIL", "n_pass": <int>, "n_total": <int> }`. Both `ok` and `outcome` are carried because the ring builder (`make_ring.py`) reads `ok` while JIDEC_PATH_SPEC_v1 names `outcome`; a record carrying only one of them is read differently by the two.

The ledger accepts a schema-valid record inside its stated caps with no editorial step, pools it at `/witness/pending`, bundles the pool into a `nenrin-witness-batch-v1` entry once a day, and stamps it to Bitcoin. The monthly ring for the endpoint counts the walk under `witnesses` by distinct `witness.name`, and lists it under `discrepancies` when `ok` is false. With one witness a ring says so in `limits`; the second independent witness is what removes that sentence.

## 5. What this does not do

It does not measure quality. It does not verify that `compensation` is truthful; a false declaration is published and recorded, and is grounds for revocation on the register, but no reader of this extension can tell truth from shape. It does not make the agent trustworthy; it makes the agent's conduct record findable and the reader's own observation filable. A client MUST NOT treat the presence of this extension as a pass.

## 6. Interoperability, stated so this is not an island

The unit of record is a ring file: a JSON file whose identity is `sha256(file bytes)` and whose monthly list is anchored to Bitcoin through OpenTimestamps as a JIDEC ledger entry. Two independent implementations (Python and Node.js) reproduce the August 2026 rings byte for byte (ledger entry 34). That file, not this extension, is what other transparency systems can carry:

- **in-toto Statement v1** (planned mapping, not yet emitted): `subject = [{ "name": "rings/<slug>/<YYYY-MM>.json", "digest": { "sha256": "<ring sha>" } }]`, `predicateType = <this URI>`, predicate = the ring's counts.
- **IETF SCITT** (planned mapping, not yet emitted): the ring file is the Statement payload; the JIDEC entry with its Bitcoin attestation plays the part of the Receipt; JIDEC is the transparency service. A future version MAY emit a COSE_Sign1 Signed Statement over the same bytes.
- **Canonical form:** NENRIN v1 defines its canonical form by reference to a language runtime (the seam above). The next NENRIN spec version is expected to adopt RFC 8785 (JCS) or a language-neutral statement. This extension defines no canonical form of its own and inherits that seam.

These mappings are direction, not delivery. Nothing in sections 2 to 4 depends on them.

## 7. Versioning

The URI ends in `/v1`. A breaking change to fields, keys, or the walk MUST use a new URI. This document is served at the URI (`GET https://gate.horizonshield.dev/ext/conduct/v1`, JSON with `Accept: application/json`, this text with `Accept: text/markdown`). A permanent identifier (for example under w3id.org) MAY later redirect here; it would be a convenience, not a second identifier. Implementations compare the string at the top of this document and nothing else. **Revised by section 12 (v1.2, 2026-09-09): the permanent identifier now exists and readers recognise it. The identifier of `v1` is unchanged. The sentence above is kept rather than edited away.**

## 8. Source

Development home: `workers/hs-verify-gate/ext/CONDUCT_EXT_v1.md` in `github.com/ogasurfproject-jpg/horizon-shield`. The gate serves the same text. The sha256 of this file is recorded in the gate's `/ext/conduct/v1` JSON as `spec_markdown_sha256` so a reader can tell whether the served copy and the repository copy are the same bytes.


## 9. Prior art, named before anyone else has to

This extension claims no new primitive. The closest published work, and what differs:

- **ERC-8004 Trustless Agents** (Draft ERC; De Rossi, Crapis, Ellis, Reppel; created 2025-08-13). On-chain Identity, Reputation and Validation registries: the Reputation Registry stores client feedback as value scores and tags, the Validation Registry stores validator responses, and a registration file can point at an A2A agent card. Difference: conduct-v1 carries no score and no feedback channel; the record it points to is a measurement written by a gate that does not take the agent's word; the evidence lives as bytes anyone re-hashes; and the timestamp is a Bitcoin attestation of a ring file, not contract state. The two are not exclusive: an ERC-8004 registration file can point at a card that carries this extension.
- **A2A discussion #1631, "Reputation-Aware Agent Discovery"** (makito20256, 2026-03-14; prototype arp-trust-substrate published 2026-04-29; URI `https://agent-reputation-protocol.dev/extensions/reputation/v0.1`). Puts success_rate, accuracy, speed and honesty scores in the card, weighted by the evaluator's own reputation. Difference: the opposite direction. That discussion converged on separating attestation surfaces from scoring policies; conduct-v1 is an attestation surface and stops there by design, and it carries the one field none of the above carry, who pays the agent.
- **Sigstore-signed Agent Cards** (Hinds, 2025-07-31). Keyless signatures over the card, recorded in a transparency log; answers who published this card and from which commit. Complementary: a signed card can carry this extension; this extension signs nothing.
- **Agent Certificates** (Zhou, arXiv 2603.14332). A certificate chain and a skills manifest hash in the card's extensions field, for capability integrity. A different question (did the tools change) from this one (how did the agent behave when measured, and who pays it).
- The transparency and provenance primitives named in section 6 (Certificate Transparency, Rekor, in-toto, SCITT, OpenTimestamps, RFC 8785) are prior art for every mechanism used here.

What is not claimed: that any component is new. What is stated: the combination (compensation disclosure as a structural condition, a pointer to a third-party measurement with counts and no scores, a client-side witness path into a Bitcoin-anchored append-only ledger, and a ring builder reproduced byte for byte by a second implementation) was not found by the author in the sources above on 2026-09-06. A prior instance of the full combination is a finding, and this section is where it will be named.

## 10. License and governance

This specification and the reference implementations named above are licensed under the Apache License, Version 2.0 (`LICENSE` beside this file in the repository). Anyone MAY implement it, fork it, or propose it elsewhere without asking. The A2A project's governance for community extensions (proposal issue in `a2aproject/A2A`, maintainer sponsorship, an `experimental-ext-` repository, graduation by TSC vote) is the intended path if there is interest; should the extension move under the `a2aproject` organization, the URI at the top of this document stays valid for v1 as published, and any URI under `https://a2a-protocol.org/extensions/` would be a new identifier for a new version, not an alias of this one.

## 11. Revision v1.1 (2026-09-07): additive, same URI

**Status:** served at the URI from gate 0.4.0. Every field in this section is OPTIONAL for the declaring agent and for the walking client; a v1 reader that ignores them reads a v1.1 card and a v1.1 walk correctly, and v1 as published (JIDEC entry 37) stays valid unchanged. Section 7 permits this: only a breaking change needs a new URI. The served JSON reports `spec_markdown_sha256`, so a reader can always tell which text it has. Reference implementations: gate 0.4.0 (lookup, notify, verdict disclaimers, commitment anchoring), ledger intake (lanes, domain binding, counting rule), `a2a_conduct_walk.py` (modes, signing), `make_ring.py` (v1.1 columns).

**Why a revision.** Three holes named in the operator's own review on 2026-09-06: a witness chooses its own identity, so a flood of self-named witnesses can bury the disagreement column (11.4); a walk record can leak what a caller asked whom (11.3); filing costs the caller effort, so nobody files (11.5 to 11.7). Plus one field forced by a public finding (11.9): a record that does not say what it does not establish is read as more than it is.

**Rollout.** Rings for months from 2026-09 onward carry the columns of 11.8 when built with a builder that implements them; the v1 fields keep their v1 meaning and their bytes are unaffected in months before 2026-09, so the August 2026 reproducibility result (entry 34) is untouched. A month is published under v1.1 columns only after the second ring implementation agrees byte for byte on a shared fixture; until then that month is published under v1 columns and says so.

### 11.1 What a record claims: `establishes` and `does_not_establish`

Any record that carries `mode` (11.2) is a v1.1 record and MUST carry two non-empty arrays of strings: `establishes`, naming exactly what the record proves, and `does_not_establish`, naming what it does not. `does_not_establish` MUST contain at least: correctness or quality of any response; truth of the compensation declaration; and, when the record is unsigned, the identity of the witness beyond the name given. The intake refuses a v1.1 record missing either array or carrying it empty (`reason_code: disclaimer_missing`). A v1 record (no `mode`) is accepted as before and stored with `disclaimer_present: false`.

The same discipline applies to the measurer. From gate 0.4.0 every verdict and the gate's own `/self` record carry `establishes` and `does_not_establish`, and both arrays are inside the bytes that `record_sha256` hashes: a quotation of the verdict with the arrays removed no longer recomputes.

Since gate 0.4.4 (2026-09-10) those arrays also carry what the walked or measured card's signature does to attribution, and nothing else changes: an agent card signature is never a condition and never turns a row red. Gate 0.4.5 (2026-09-10) fixes the rule that decides it, after the operator found that 0.4.4 attributed a card to its operator whenever any signature verified, including one whose key was served on a host the operator need not control, and including a card whose own-domain signature had failed. A reader MUST NOT claim attribution unless the key that verified is served under the walked agent's own domain, because the reason to read a signature at all is authorship that survives being carried away: a key on somebody else's server can be withdrawn by that somebody, and the operator can disown it afterwards. The four states are: a key under the agent's own domain whose signature verifies, and no failing signature under that domain, so `establishes` says what the card declares is attributable to the operator and not only to the reader's observation; a signature under the agent's own domain that does not verify, so `does_not_establish` says so and names the reason, whatever any other signature does; a signature that verifies only against a key served off the agent's domain, so `does_not_establish` names that host and says attribution would rest on a key server the operator need not control (an off-domain key is permitted and is not a failure); and no signature at all, so `does_not_establish` says the record does not establish that the operator published the card, that the bytes are attributable to the reader alone, and that the operator can repudiate them (an unsigned card is permitted and is not a failure). When a signature is present but cannot be checked at all, the reason is named and no attribution is claimed. Exactly one of these lines appears, never two. A reader that cannot verify signatures at all (see the `card_signature` field in section 4) MUST use the unconfirmed wording rather than any of the others, because they are different facts.

### 11.2 Record modes

`mode` is `"full"` (v1 behaviour), `"hash-only"` or `"commitment"`. A record without `mode` is read as `"full"`. `vantage_limitation` (OPTIONAL, string) states what the witness could not see from where it stood: a proxy, a cache, a rate limit hit, a region.

### 11.3 `hash-only` and `commitment` (what a caller asked whom stays private)

`hash-only`: every `fetch` node carries only `response.status` and `response.body_sha256`; `request.url` is the origin (`https://host`, no path, no query) and `request.method` is `"REDACTED"`. `purpose` keeps `"a2a-conduct-walk-v1: <measured endpoint>"` so the ring builder can attribute the walk. `establishes` says that a response with the given sha256 was received from the origin at `walked_at` and nothing more; `does_not_establish` adds "which tool or method was called". The intake refuses a hash-only node whose `request.url` carries a path, a query or a fragment (`reason_code: path_leaks_tool`), and a `request.method` other than `REDACTED`.

`commitment`: the record carries `schema`, `purpose`, `walked_at`, `base`, `witness`, `mode: "commitment"`, `commitment` (64 hex characters), the two arrays of 11.1, and SHOULD carry `commitment_recipe` (a string saying how `commitment` was formed). For a witness walk the recipe is `sha256(canonical full record || salt)`; the witness keeps the full record and the salt, and MAY reveal later by filing the full record. Other purposes MAY use commitment mode with their own recipe, stated in the record: the gate files its instant coordinate salt commitment this way (purpose `nenrin-instant-commitment-v1: <window_id>`, recipe `sha256('nenrin-instant-salt-v1:' + salt)`, `base` the window's page on the gate), which anchors the salt's creation time to a Bitcoin block through the ledger without any new ledger code. The ring counts a walk commitment under `commitments_unrevealed`, with `verdict.ok = null`, under neither PASS nor discrepancies. Nothing in a commitment identifies a tool, a method or a response.

A record never carries a request or response body in any mode. A client MAY keep a local allow list and deny list of endpoints it will file about; a denied endpoint is simply not walked, and the client MUST NOT file a record that pretends otherwise.

### 11.4 Witness identity: domain-bound signing, lanes, counting

Signing is the existing intake mechanism: Ed25519 over the exact canonical bytes, presented as `signature_ed25519_b64` and `public_key_ed25519_b64` beside `record_canonical`. v1.1 adds `witness.key_url` (OPTIONAL, https URL): the same public key MUST be served at that URL as `{"public_key_ed25519_b64": "<key>"}`. The host of `key_url` is then the witness's identity (`signed_domain`); the string in `witness.name` is a label. The intake refuses: `key_url` without a signature (`bad_key_url`); a `key_url` host equal to the walked agent's origin host or measured endpoint host, or to the ledger's own host (`self_witness`: an agent cannot witness itself under a key it serves); a key served at `key_url` that is not the signing key (`key_url_mismatch`); and answers 503 `key_url_unreachable` when the key cannot be fetched, so the caller can retry or file unsigned. Keys are cached 24 hours per URL.

Lanes: unsigned and address-signed records share a per-address lane of 5 stored records per UTC day; domain-signed records have a per-domain lane of 50; the intake stores at most 500 records per UTC day in total. Beyond a lane the intake answers 429 and stores nothing. The caps are stated at `GET <witness_intake>`.

Counting, not storage, is the unit: the first record per identity (`domain:<host>` when domain-signed, otherwise `name:<witness.name>`) × walked endpoint × UTC day is stored with `counted: true`; later records that day are stored with `counted: false` and the reason. Two records with identical canonical bytes are stored once. `/witness/pending` and the daily `nenrin-witness-batch-v1` entry carry every stored record, counted or not, so nothing is hidden by a cap; only the ring's counts respect it. None of this scores a witness. It separates two columns and stops one address from filling a column alone.

### 11.5 Consent file additions: `notify`, `identity`, `witness_policy`

The owner's consent file (`/.well-known/mcp-conduct.json` on the origin, v1 section 2 `consent`) MAY carry three more keys. Only the owner of the origin can place them, which is why they live there rather than in a request.

`notify` (https URL): after each scheduled measurement of an endpoint on that origin, the measurer POSTs a JSON summary there: `event: "measured"`, `endpoint`, `at`, `status`, `record_sha256`, what changed, `establishes`, `does_not_establish`, and links to the conduct record and the lookup. At most once per hour per endpoint, a bounded number per sweep (the rest are recorded as deferred), never from an on-demand check (which anyone can call), never to an IP literal, a local name, or the measurer's own hosts, no retry. The sweep record carries `notify_status` per row. Declaring the field is consent to receive the POST; removing it stops the POSTs. The notification changes nothing about the verdict.

`identity`: an https URL, or `{ "kind": "did" | "jwks" | "vc" | "url", "ref": "<DID or https URL>" }`, pointing at an identity the agent holds elsewhere. The measurer does not resolve it and asserts nothing about it; readings copy it as declared. This is the receiving slot for identity layers when they go live.

`witness_policy`: `{ "reciprocal": true | false }` (default false). `reciprocal: true` is the owner's statement that it walks back callers as in 11.6. A declaration; the ring's `walked_as_witness` column is the fact. A card MAY repeat `identity` and `witness_policy` under this extension's `params`; when both are present the consent file is what the measurer reads.

### 11.6 Reciprocal walk

An agent that declares `witness_policy.reciprocal: true` states this behaviour: when it receives an A2A message whose `metadata` carries `https://gate.horizonshield.dev/ext/conduct/v1/caller_card` (an https URL, sent by the caller voluntarily), it walks that card within 24 hours, honours `listing: "decline"` at that origin, files the walk under its own name and, if it has one, its domain key, to the intake named in the caller's card (or its own intake when the caller declares none), and answers with the `metadata` key `https://gate.horizonshield.dev/ext/conduct/v1/reciprocal` set to `"scheduled"` or `"declined"`. The caller thus receives one record it did not write, without filing anything. A reciprocal walk is a walk like any other: same schema, same intake rules, counted under the walking agent's identity, carrying the arrays of 11.1. Reference implementation: pending; the field is defined so that cards can declare it now.

### 11.7 Register lookup: one URL before connecting

`GET https://gate.horizonshield.dev/register/lookup?endpoint=<url-encoded endpoint>` answers with no score: `status` (`verified`, `pending`, `declined`, `unknown`), `status_meaning`, `last_measured` (`at`, `status`, `record_sha256`, coordinate window), `measurements`, `last_ring` (the last published ring's counts copied as counts, or `present: false` with the URLs tried), `conduct_record`, `witness_intake`, `rings` (base, slug, path), `establishes`, `does_not_establish`. `unknown` means the register has no row; it never means a finding. The response is cacheable for 24 hours (`Cache-Control: public, max-age=86400`) and says so.

### 11.8 Ring columns (NENRIN, months from 2026-09)

Beside v1's `witnesses` and `discrepancies` (unchanged, every witness counted by distinct name): `witnesses_signed`, `witnesses_unsigned`, `discrepancies_signed`, `discrepancies_unsigned` (deduplicated per identity and day), `commitments_unrevealed`, `walked_as_witness` (walks this endpoint's operator filed about other endpoints that month, by count, attributed by `signed_domain` equal to the endpoint host and `counted: true`), `instants_derived`, `instants_legacy`, `instants_no_coordinate_block`; and `limits` gains "unsigned witnesses are counted by the name they gave" whenever `witnesses_unsigned > 0`. Counts only, never a rate.

### 11.9 Red team and prior art added in this revision

Vectors, each a refusal or a separation and never a pass: disclaimer dropped from a v1.1 record (still schema-valid, refused); disclaimer emptied; bad mode; `key_url` without signature; `key_url` under the walked agent's own domain; key at `key_url` not the signing key; `key_url` unreachable (503, not 422); same identity twice in a day (stored, counted once); one address over its lane (429, nothing stored); hash-only node with a path (refused); commitment without a 64 hex commitment (refused); the gate's verdict quoted without its arrays (does not recompute); commitment filed once per window and reported honestly when the ledger is unreachable; notify to an IP literal (never sent); notify twice within an hour (second not sent); notify from an on-demand check (never sent). Suites: `workers/hs-ledger/test/witness_v11.test.mjs`, `workers/hs-ledger/nenrin/a2a-conduct-walk/walk_selftest.py`, `workers/hs-ledger/nenrin/ring-v1/ring_redteam.py`, `workers/hs-verify-gate/test/conduct_v11_gate.test.mjs`.

Prior art: the `establishes` / `does_not_establish` pair follows a public finding by Federico Blanco Sánchez-Llanos (LinkedIn, 2026-09-07) about a TEE attestation conformance specification in `trustless-ai/recompute-kit`: a record that could silently drop its "not judged correct" disclaimer and still pass conformance, repaired the same day by a one-line fix and a new conformance vector, and mirrored by the `vantage_limitation` his review verdicts carry. This revision adopts the same discipline on both the witness side and the measurer side. Domain-bound witness keys follow the transparency-log witness model (Sigsum witnesses, Certificate Transparency gossip), applied to the conduct of a counterparty instead of the consistency of a log. Nothing else in this revision claims a new primitive.

### 11.10 What this revision does not do

It does not make a witness trustworthy; it makes a signed witness attributable to a domain and an unsigned one countable apart. It does not detect lies; a signed liar fills the signed column, and any hidden judgement of who is lying would be a coordinate the operator controls, which is what this extension exists to remove. It does not prove that a hash-only or commitment record refers to a real exchange; it proves only that a stated hash was filed at a stated time. It does not oblige any framework to file records by default; reference hooks default to writing the record locally and sending nothing. It does not change coordinate derivation, the sweep's conditions, or any field of `coordinate_derivation`.
## 12. Revision v1.2 (2026-09-09): the permanent identifier

The A2A extension guidance says: "Authors are encouraged to use a permanent identifier service, such as `w3id.org`, for their extension URIs to prevent broken links." On 2026-09-09 `perma-id/w3id.org#6653` was merged and `https://w3id.org/horizonshield/conduct/v1` began answering `302 Found` with `Location: https://gate.horizonshield.dev/ext/conduct/v1`. The redirect is an entry in a community registry, not a host this project controls, so from that date the name of this extension no longer depends on one Cloudflare account.

### 12.1 Identity is unchanged

For `v1` the identifier remains the exact string `https://gate.horizonshield.dev/ext/conduct/v1`. That is what the deployed agent cards declare, what JIDEC entry 37 anchors, and what every published record names. Changing it would rewrite anchored bytes, so it is not changed.

### 12.2 Readers recognise both, and say which

A reader of an agent card MUST treat an entry whose `uri` is either of these two exact strings as this extension:

- `https://gate.horizonshield.dev/ext/conduct/v1` (canonical)
- `https://w3id.org/horizonshield/conduct/v1` (permanent identifier)

The set is closed and compared as exact strings. No normalisation, no case folding, no tolerance for a trailing slash or for `http`, no other path under `w3id.org`, no other version. A reader MUST record which of the two strings was declared, inside the bytes it publishes, so that recognition is never silent. A reader MUST NOT resolve the redirect while it checks: a network fetch would let a third party's DNS decide what this extension is, and it would spend a request budget on an answer already known.

### 12.3 Writers

A writer SHOULD declare the canonical string while `v1` is current. A writer that declares the permanent identifier is conformant, is read, and its record says which string it used. Declaring both in one card is allowed and is read as one declaration; as in section 2, two declarations that disagree on the five compensation keys fail.

### 12.4 The wire

Activation is accepted under either string. The response echoes the string the caller sent, exactly as it already echoes the header spelling the caller used. The payload always names the canonical string: `metadata` keys and `Message.extensions` do not vary with the caller's spelling. One identity in the data, the caller's own words on the wire.

### 12.5 Succession

If `gate.horizonshield.dev` stops resolving, `https://w3id.org/horizonshield/conduct/v1` is the address of record for this document, and what a reader follows is the registry entry rather than this operator. The next version of this extension MUST be identified by `https://w3id.org/horizonshield/conduct/v2`; from `v2` on, the permanent identifier is the identifier and this host is only where a copy happens to be served. A version is never a fallback for another version (A2A: an agent MUST NOT fall back to a different version), so `v1` and `v2` never stand in for each other.

### 12.6 What this revision does not do

It adds no field, changes no hash recipe, changes no condition, and changes what no record means. A card that declared the canonical string yesterday declares the same thing today, byte for byte. It does not make the redirect trustworthy: a reader that wants to know where the permanent identifier points reads the registry entry in `perma-id/w3id.org`, which is public and versioned in git, and not this document.
