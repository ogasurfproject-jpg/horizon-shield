# A2A Conduct Extension v1 (`conduct-v1`)

**Extension URI (the identifier, compared as an exact string):** `https://gate.horizonshield.dev/ext/conduct/v1`
**Status:** v1, 2026-09-06. Reference implementations: MCP Verification Gate 0.3.2 (reads it, serves this document at the URI), HORIZON SHIELD KIRA and JIDEC agent cards (declare and echo it), `a2a_conduct_walk.py` (client-side witness walk).
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

## 4. Witness walk: `a2a-conduct-walk-v1`

This is how every connecting client becomes a witness. A walk is a `jidec-path-v1` record (JIDEC_PATH_SPEC_v1.md, ledger entry 5) with a `witness` field, submitted as `POST <witness_intake>` with body `{"record_canonical": "<exact bytes>"}`. Canonical bytes are UTF-8 of the record with keys sorted at every nesting level, separators `,` and `:` with no spaces, non-ASCII unescaped (Python `json.dumps(obj, sort_keys=True, separators=(",",":"), ensure_ascii=False)`; a JavaScript implementation MUST sort keys recursively before `JSON.stringify`, the seam recorded in ledger entry 34).

Fields:

- `schema`: `"jidec-path-v1"`. `purpose`: `"a2a-conduct-walk-v1: <measured endpoint>"`. `walked_at`: ISO-8601 UTC. `base`: the card origin (`https://host`). `witness`: `{ "name": "<who>", "vantage": "<network or tool the walk was taken from>" }`; `name` MAY be `anonymous`.
- `nodes`: n0 `fetch` GET `<origin>/.well-known/agent-card.json`; n1 the same GET again; n2 `compute` "locate the extension by URI in n1 and validate `params`"; n3 `fetch` POST to the measured endpoint with header `A2A-Extensions: <this URI>` and a JSON-RPC body (MCP `initialize`, or A2A `SendMessage` / `message/send` when the endpoint is the A2A interface). Each `fetch` node records `request.url`, `request.method`, `response.status`, `response.body_sha256` over the exact bytes received. A walk MUST touch at least one `measured_endpoints` entry or the origin, or the ring builder will not count it for that endpoint.
- `assertions` (each with `claim`, `op`, `result`, `evidence_nodes`): `card_bytes_stable` (n0 body sha equals n1 body sha), `conduct_ext_declared` (n1 carries this URI under `capabilities.extensions[]`), `compensation_well_formed` (section 2 shape), `measured_endpoint_answered` (n3 status 200 and a JSON-RPC `result`), `extension_echoed` (n3 response header `A2A-Extensions` contains this URI; only asserted when n3 was an A2A message, otherwise recorded with `result: null` and `note: "not applicable"`).
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

The URI ends in `/v1`. A breaking change to fields, keys, or the walk MUST use a new URI. This document is served at the URI (`GET https://gate.horizonshield.dev/ext/conduct/v1`, JSON with `Accept: application/json`, this text with `Accept: text/markdown`). A permanent identifier (for example under w3id.org) MAY later redirect here; it would be a convenience, not a second identifier. Implementations compare the string at the top of this document and nothing else.

## 8. Source

Development home: `workers/hs-verify-gate/ext/CONDUCT_EXT_v1.md` in `github.com/ogasurfproject-jpg/horizon-shield`. The gate serves the same text. The sha256 of this file is recorded in the gate's `/ext/conduct/v1` JSON as `spec_markdown_sha256` so a reader can tell whether the served copy and the repository copy are the same bytes.
