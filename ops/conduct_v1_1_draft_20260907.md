# A2A Conduct Extension v1.1 (`conduct-v1`, additive revision), DRAFT 2026-09-07

> **Superseded the same day (2026-09-07, gate 0.4.0).** The normative text is now section 11 of `workers/hs-verify-gate/ext/CONDUCT_EXT_v1.md`, served at the URI with a new `spec_markdown_sha256`. This draft is kept as the record of what was proposed. Where the shipped text differs from the draft below:
>
> 1. **Signing** is the intake's existing Ed25519 over the canonical bytes (`signature_ed25519_b64` + `public_key_ed25519_b64`), plus `witness.key_url` serving `{public_key_ed25519_b64}` on the witness's own domain. The draft's ES256 JWS (`sig`, `kid`, `jwks_url`) was not implemented; one signature mechanism, not two.
> 2. **Caps** are lanes, not one number: 5 stored per address per UTC day (unsigned or address-signed), 50 per domain per day (domain-signed), 500 per day in total. The draft said 200 per address.
> 3. **`notify`, `identity`, `witness_policy`** live in the owner's consent file (`/.well-known/mcp-conduct.json`), which only the origin's owner can place; a card MAY repeat `identity` and `witness_policy` under `params`. The draft put them in the card only. `identity` accepts an https URL or `{kind, ref}`. `witness_policy.accept_unsigned` was dropped (the intake stores and separates; an owner cannot make unsigned walks of itself disappear from the record).
> 4. **notify** fires after every scheduled measurement (not only on change), once per hour per endpoint, at most 3 per sweep (subrequest budget), never from `/check`, never to an IP literal or a local name; `notify_status` is in the sweep record.
> 5. **Commitment mode** carries `commitment_recipe`; the gate uses the same mode to anchor the instant coordinate salt commitment (purpose `nenrin-instant-commitment-v1: <window_id>`, recipe `sha256('nenrin-instant-salt-v1:' + salt)`, `base` the window's page so ring builders never count it as a witness).
> 6. **Rollout**: ring columns from 2026-09 (not October), published under v1.1 columns only once the second builder agrees byte for byte; the August result is untouched either way.
> 7. **Measurer side**: every verdict and `/self` carry `establishes` and `does_not_establish` inside the hashed bytes; `GET /register/lookup` is live with a 24 hour edge cache and no KV writes.
> 8. **Reciprocal walk** (section 6 here, 11.6 there) is defined; the reference implementation is pending.


**Extension URI (unchanged):** `https://gate.horizonshield.dev/ext/conduct/v1`
**Status:** draft, not served, not anchored. v1 as published is anchored as JIDEC entry 37 (block 965717) and stays valid unchanged. Every field this revision adds is OPTIONAL for the declaring agent and for the walking client; a v1 reader that ignores them reads a v1.1 card and a v1.1 walk correctly. Section 7 of v1 permits this: only a breaking change needs a new URI. The served JSON at the URI reports `spec_markdown_sha256`, so a reader can always tell which text is being served.
**Why a revision:** three holes named in the operator's own review on 2026-09-06, in order of the repair: (2) a witness chooses its own identity, so a flood of self-named witnesses can bury the disagreement column; (3) a walk record can leak what a caller asked whom; (1) filing a record costs the caller effort, so nobody files. Plus one field forced by a public finding of the founding witness (section 9): a record that does not say what it does not establish is read as more than it is.
**Rollout:** September 2026 rings are built under NENRIN v1 unchanged, so the byte reproducibility result (entry 34) and the September pre-registration in the coordinate paper are untouched. v1.1 ring fields first appear in the October 2026 rings, and only after the second ring implementation has been updated and both builders agree byte for byte on a shared fixture.

## 1. Declaration additions (Agent Card `params`)

| field | type | requirement | meaning |
|---|---|---|---|
| `identity` | object | OPTIONAL | A pointer to an identity the agent holds elsewhere: `{ "kind": "did" \| "jwks" \| "vc", "ref": "<DID or https URL>" }`. The extension does not resolve it and asserts nothing about it; a reader that resolves it records what it found. This is the receiving slot for identity layers (attribute registries, KYA schemes) when they go live. |
| `notify` | string (https URL) | OPTIONAL | Where the measurer POSTs a notification after each measurement (section 5). Declaring it is consent to receive the POST. |
| `witness_policy` | object | OPTIONAL | `{ "accept_unsigned": true \| false, "reciprocal": true \| false }`. `accept_unsigned` defaults to `true`: unsigned walks of this agent are stored and counted in the unsigned column. `reciprocal` defaults to `false`: when `true`, the agent states that it walks back any A2A caller that presents a card (section 6). |

Absence of every field above means: v1 behaviour.

## 2. Witness record additions (`a2a-conduct-walk-v1`)

The record shape of v1 section 4 is unchanged. These keys are added inside the record; all OPTIONAL except where marked REQUIRED for v1.1 clients.

| key | requirement | meaning |
|---|---|---|
| `mode` | REQUIRED for v1.1 clients | `"full"` (v1 behaviour: every node carries `request.url`, `request.method`, `response.status`, `response.body_sha256`) or `"hash-only"` (section 3). A record without `mode` is read as `"full"`. |
| `establishes` | REQUIRED for v1.1 clients | An array of strings naming exactly what this record proves. For a full walk: `["card fetched twice from <origin> at <walked_at>", "extension declaration validated against v1 section 2", "one request answered by <endpoint> with body sha256 <hex>"]`. |
| `does_not_establish` | REQUIRED for v1.1 clients | An array of strings naming what this record does not prove. MUST contain at least: `"correctness or quality of any response"`, `"truth of the compensation declaration"`, and, when unsigned, `"identity of the witness beyond the name given"`. A v1.1 record missing this key, or carrying it empty, is refused by the intake (section 4) and by the red team (section 8). This is the field that keeps a downstream reader from reading a PASS as a verdict. |
| `vantage_limitation` | OPTIONAL | Free text: what the witness could not see from where it stood (a proxy in the path, a cache, a rate limit hit, a region). |
| `sig` | OPTIONAL | A compact JWS (ES256) whose payload is the SHA-256 hex of the record's canonical bytes with `sig`, `kid` and `jwks_url` removed. |
| `kid` | OPTIONAL, REQUIRED when `sig` is present | Key id, found in the witness's JWKS. |
| `jwks_url` | OPTIONAL, REQUIRED when `sig` is present | `https://<witness domain>/.well-known/jwks.json` or another https URL under a domain the witness controls. The witness's identity is the domain that serves the key, not the string in `witness.name`. |

Canonical bytes are computed exactly as v1 section 4 (sorted keys, no spaces, non-ASCII unescaped) over the record with the three signature keys removed. The ledger recomputes the hash before checking the signature.

## 3. `hash-only` mode (hole 3)

A caller whose calls are confidential (what was asked of whom) MAY file a record whose `nodes` carry only `response.status` and `response.body_sha256` and whose `request.url` is replaced by the origin (`https://host`) and `request.method` by `"REDACTED"`. `purpose` stays `"a2a-conduct-walk-v1: <measured endpoint>"` so the ring builder can attribute the walk. `establishes` MUST then say `"a response with sha256 <hex> was received from <origin> at <walked_at>"` and nothing more, and `does_not_establish` MUST add `"which tool or method was called"`.

A stricter form, `"commitment"`, files only `{ "schema", "purpose", "walked_at", "witness", "mode": "commitment", "commitment": sha256(canonical full record || salt) }`. The witness keeps the full record and the salt. The ring counts a commitment as a walk with `verdict.ok = null`, listed under neither PASS nor discrepancies; it counts toward `witnesses` only when the witness later reveals (POSTs the full record whose commitment matches). Nothing in a commitment identifies the tool, the method, or the response.

A record never carries a request or response body in any mode. A client MAY keep a local allow list and deny list of endpoints it will and will not file about; a denied endpoint is simply not walked, and the client MUST NOT file a record that pretends otherwise.

## 4. Intake rules (hole 2)

The intake (`POST <witness_intake>`) keeps v1's acceptance (schema-valid, inside caps, no editorial step) and adds, in this order:

1. A record with `sig` whose signature does not verify against the key at `jwks_url` is refused (`reason_code: bad_signature`). A record whose `jwks_url` is not https, or is under a domain that also serves `measured_endpoints` of the walked agent, is refused (`reason_code: self_witness`); an agent cannot witness itself under a key it serves.
2. A v1.1 record (`mode` present) without a non-empty `does_not_establish` is refused (`reason_code: disclaimer_missing`). A v1 record (no `mode`) is accepted as before and tagged `disclaimer: "v1, not stated"` in the pool.
3. Every stored record is tagged `signed: true | false`.
4. Counting, not storage, is capped: per (`witness.name` or signing domain) × walked endpoint × UTC day, one record is `counted: true`; later records that day are stored with `counted: false, reason: "same witness, same endpoint, same day"`. Two records with identical canonical bytes are stored once.
5. Per source address, at most 200 stored records per UTC day; beyond that the intake answers 429 and stores nothing. The cap and the count are public at `/witness/pending`.
6. The pool at `/witness/pending` and the daily `nenrin-witness-batch-v1` entry carry every stored record, counted or not, so that nothing is hidden by the cap; only the ring's counts respect it.

None of this scores a witness. It separates two columns and stops one address from filling a column alone.

## 5. Measurement notification (hole 1, measurer side)

When an endpoint's card declares `notify`, the gate POSTs, after each measurement of that endpoint, the JSON `{ "endpoint", "measured_at", "record_sha256", "conduct_record", "witness_intake", "how_to_witness_back": "<one command>" }`. At most one POST per measurement, no retry beyond one, never more than once per hour per endpoint. The gate records `notify_status` (HTTP code or `unreachable`) in the measurement record. An endpoint that did not declare `notify` receives nothing. The notification carries no verdict text, only where the verdict is.

## 6. Reciprocal walk (hole 1, called side)

An agent that declares `witness_policy.reciprocal: true` states the following behaviour, and the gate's condition set MAY later check it: when it receives an A2A message from a caller whose request identifies a card origin (the A2A `metadata` key `https://gate.horizonshield.dev/ext/conduct/v1/caller_card`, an https URL, sent by the caller voluntarily), it schedules a walk of that card within 24 hours, honours `listing: "decline"` at that origin, files the walk under its own name to the intake named in the caller's card (or to its own intake when the caller declares none), and includes in its response `metadata` the key `https://gate.horizonshield.dev/ext/conduct/v1/reciprocal` with the value `"scheduled"` or `"declined"`. The caller thus receives one record it did not write, without filing anything. A reciprocal walk is a walk like any other: same schema, same intake rules, counted under the walking agent's name, and it carries `does_not_establish` like every other record.

## 7. Register lookup (the one URL before connecting)

`GET https://gate.horizonshield.dev/register/lookup?endpoint=<url-encoded endpoint>` returns, with no score:

```json
{ "endpoint": "...", "status": "verified" | "pending" | "declined" | "unknown", "last_measured": "<ISO-8601 or null>", "last_ring": { "month": "2026-08", "measurements": 27, "witnesses_signed": 0, "witnesses_unsigned": 1, "discrepancies_signed": 0, "discrepancies_unsigned": 0 } | null, "conduct_record": "<url>", "witness_intake": "<url>", "does_not_establish": ["correctness or quality of any response", "truth of the compensation declaration"] }
```

`unknown` means the register has no row; it never means absent. The response is cacheable for 24 hours. A client that reads this before its first call is doing what section 1 of v1 describes; the field exists so the read costs one request.

## 8. Ring additions (NENRIN, October 2026 onward) and red team

Ring fields added beside v1's `witnesses` and `discrepancies` (v1 fields keep their v1 meaning and continue to count every witness by distinct name): `witnesses_signed`, `witnesses_unsigned`, `discrepancies_signed`, `discrepancies_unsigned`, `commitments_unrevealed`, `walked_as_witness` (how many walks this endpoint's operator filed about other endpoints that month, by count), and `limits` gains the sentence `"unsigned witnesses are counted by the name they gave"` whenever `witnesses_unsigned > 0`.

Red team vectors added to `walk_selftest.py` and the intake tests, each a refusal or a separation, none a pass: disclaimer dropped (a v1.1 record with `does_not_establish` removed still schema-valid, MUST be refused: the vector the founding witness's public finding names); disclaimer emptied; signature over the wrong bytes; `jwks_url` under the walked agent's own domain; one address filing 1,000 records in a day (stored up to 200, counted once, ring shows one); same witness name from two addresses (both stored, counted once per day per name, signed column empty); hash-only record carrying a `request.url` with a path (refused, path leaks the tool); commitment revealed with a non-matching salt (refused); reciprocal walk of an origin with `listing: "decline"` (not filed, `declined` echoed); notify POST to a non-https URL (never sent).

## 9. Prior art added in this revision

The `establishes` / `does_not_establish` pair follows a public finding by Federico Blanco Sánchez-Llanos (LinkedIn, 2026-09-07, about a TEE-attestation conformance spec in trustless-ai/recompute-kit): a record that could silently drop its "not judged correct" disclaimer and still pass conformance, repaired by a one-line fix and a new conformance vector the same day, and mirrored by the `vantage_limitation` field his invinoveritas review verdicts carry. This revision adopts the same discipline on the witness side: the disclaimer is a required field, its absence is a refusal, and the red team holds a vector for the omission. Signed witnesses with keys served from the witness's own domain follow the transparency-log witness model (Sigsum witnesses, Certificate Transparency gossip), applied to the conduct of a counterparty instead of the consistency of a log. Nothing else in this revision claims a new primitive.

## 10. What this revision does not do

It does not make a witness trustworthy; it makes a signed witness attributable to a domain and an unsigned one countable apart. It does not detect lies; a signed liar fills the signed column. It does not prove that a hash-only or commitment record refers to a real exchange; it proves only that a stated hash was filed at a stated time. It does not oblige any framework to file records by default; the reference hooks (Claude Code, Google ADK, LangChain, LlamaIndex, CrewAI) default to `local` (write the record to disk, send nothing) and require one explicit setting to send. It does not change coordinate derivation, the sweep, or any field of `coordinate_derivation`.

---

## 日本語の要約(番人、2026-09-07 深夜、git 未投入)

同じ URI、新しい sha、足す欄は全部 OPTIONAL。9 月の輪は v1 のまま(論文 1 の「同じバイト」と論文 2 の 9 月の事前登録を守る)、10 月から v1.1、それも Node.js の builder が追いついてから。

穴 2(身元、偽の食い違い): 署名付き証人(ES256、鍵は証人自身のドメインの JWKS。自分の endpoint と同じドメインの鍵は self_witness で拒否)、輪は signed / unsigned の 2 列、intake は「同じ証人 × 同じ対象 × 同じ日 = 1 件だけ数える(保存はする)」「1 送信元 1 日 200 件まで保存」。点数は無し。

穴 3(中身の漏れ): `mode: hash-only`(URL は origin だけ、method は REDACTED、本文は元から無し)と `commitment`(指紋と塩だけ、後で開示するかは証人が決める)。client 側の deny list。

穴 1(誘因): `notify`(宣言した endpoint にだけ、測るたびに 1 本 POST)、`witness_policy.reciprocal`(呼んできた agent をこっちから歩いて記録を渡す)、`/register/lookup`(繋ぐ前の 1 URL、点数無し)。hook の既定は local。

Federico の今夜の投稿から取った物: `establishes` / `does_not_establish` を必須の欄にして、落としたら intake も red team も拒否する。9 節に公開投稿として名前を出した(私信は引用しとらん)。

次: 台帳 intake の code(hs-ledger)、扉の lookup と notify(hs-verify-gate)、walk client の mode と署名、red team 10 本、ring builder の欄(10 月)。配備は全部 TOshi の手。
