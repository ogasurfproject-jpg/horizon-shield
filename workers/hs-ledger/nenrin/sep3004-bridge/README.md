# sep3004-bridge

NENRIN witness records, projected into the audit record chain that MCP SEP-3004 defines, and verified by SEP-3004's own reference verifier. Version 0.1.0, 2026-09-15. Apache-2.0, as conduct-v1.

SEP-3004 (modelcontextprotocol PR #3004, "Tamper-Evident Audit Record Contract", Draft, Standards Track) fixes one record shape, one canonical form (`gif-audit/2`: sorted keys, NFC, strings and booleans and null only, no bare numbers), one hash chain (`previous_hash` threads to the prior `event_hash`, SHA-256) and one verification procedure (section 2.6) that runs the same for the operator and for a stranger. Its section 2.8 reserves `anchor_witness` for an external witness and leaves it out of v1. Its section 2.2 lets any emitter register an extension whose data is protected by the same chain.

NENRIN is the other half of that sentence. A witness record is bytes somebody who is not the operator produced by walking an agent; its identity is sha256 of those bytes; the ledger cannot delete it; it is bundled into a daily ledger entry that OpenTimestamps stamps into a Bitcoin block; two witnesses who disagree are kept side by side. SEP-3004 says how to chain records so that insertion, deletion and reordering are detectable inside one recorder. NENRIN says who else saw it, from where, and when the world's clock says it existed. This bridge lets a SEP-3004 reader consume NENRIN records without learning anything about NENRIN, and states, in the manifest, exactly what the reader is and is not getting.

## Use it

```
python3 nenrin_to_sep3004.py kat
python3 nenrin_to_sep3004.py selftest
python3 nenrin_to_sep3004.py export ../a2a-conduct-walk/walk_*.json --out sep3004_out
python3 nenrin_to_sep3004.py export --fetch da9289a1117598658d171ca89de03028ca497e54cfe9ad75aaad2f0075d7adff --out sep3004_out
python3 nenrin_to_sep3004.py verify sep3004_out/chain.jsonl
```

`export` takes bare walk files (`walk_*.json` as a2a_conduct_walk.py writes them) or the bodies of `GET https://ledger.horizonshield.dev/witness/<sha>` (pending or anchored form; `--fetch` downloads them). A record whose stored sha does not equal sha256 of its bytes is refused, so is a duplicate. Output is `chain.jsonl` (one SEP-3004 record per line, sorted keys), `manifest.json` (section 2.7) and `anchors.json` (the Bitcoin side, kept outside the preimage as section 2.8 requires in v1).

To have the SEP's own verifier judge the result:

```
git clone --depth 1 https://github.com/notboatanchor/gif.git /tmp/gif
node --experimental-strip-types crossverify_reference.mjs --ref /tmp/gif/mcp-server/conformance/audit-record-contract/audit-record-contract.ts --chain sep3004_out/chain.jsonl --manifest sep3004_out/manifest.json
```

Measured 2026-09-15 on the two walk files in `../a2a-conduct-walk` (Node 22.22, reference at gif main): every `event_hash` recomputed by the reference canonicalizer equals the stored one, chain links and manifest pass; the reference reports `conduct-witness` as an unregistered extension type, which it is (section 3 below). With `--extensions registered` the export carries only `caller-governance` and passes the reference verifier with zero findings, `--strict` included. Both known-answer digests of the SEP (`d494769c…`, `f733fed9…`) reproduce from this canonicalizer (`kat`). Selftest: 35 checks (canonical form corners, export, deterministic order, registered-only mode, nine mutation checks: seven alterations detected, two non-alterations (anchor_witness, JSON key order) leave the hash unchanged, refusals, ledger form roundtrip).

## 1. Mapping

| SEP-3004 core (section 2.1) | from the NENRIN record |
|---|---|
| `event_id` | sha256 of the record's exact bytes. Content addressed: `GET /witness/<event_id>` returns the bytes and `sha256(record_canonical) == event_id` |
| `occurred_at` | the ledger's `submitted_at` when the input came from the ledger (recorder assigned, as the SEP asks); otherwise the witness's `walked_at`. Which one is stated in the extension and in the manifest |
| `principal_id` | the witness: `witness:domain:<d>` when the ledger verified an Ed25519 signature under domain d, else `witness:name:<witness.name>`. Never the operator, never the measured agent |
| `event_type` | `conduct_walk` |
| `tool_name` | the measured target named in the walk's purpose (`a2a-conduct-walk-v1: <target>`), else the walk's base origin |
| `outcome` | `allowed` when the walk completed and carries a verdict. PASS and FAIL are both completed observations: the SEP's outcome is the disposition of the recorded event, and the event is the observation, not the agent. `deferred` for a commitment record whose verdict is unrevealed. `error` when there is neither |
| `previous_hash` | the prior record's `event_hash` in the segment; `null` at the head |
| `event_hash` | SHA-256 of the gif-audit/2 canonical form of the protected body |

A segment is ordered ascending by (`occurred_at`, `event_id`). Same inputs in any order give byte identical output. A segment is a projection: it proves that the exported set is intact and in the declared order. It does not replace the ledger's order (the daily batch, sorted by sha) and it is not the authority for existence time; the batch anchor is. The manifest says so.

Extensions carried:

`caller-governance` (registered by the SEP): `purpose_declared` = the walk's own `purpose` string, which is a declared intent at event time; `sources_touched` = the URLs the walk fetched, encoded as the SEP's canonical array string (deduplicated, sorted by UTF-8 bytes, minimal escaping), `null` when the record redacts them.

`conduct-witness` (proposed, section 3): the witness facts.

## 2. What a reader gets, and does not

Establishes, for a reader who only runs a SEP-3004 verifier: that these records have not been altered, reordered, inserted into or deleted from since this segment was written; that each names a NENRIN record by content hash; that each carries a declared purpose and the sources it touched.

Does not establish: that the agent is good, honest or safe (the record's own `does_not_establish` says so and the intake refuses a record without it); that a count is a score (a reader who computes one has left the record); that the witness told the truth (a second witness is how that gets contested, and the ring keeps the disagreement); when the record existed in the world's time (that is the Bitcoin anchor, which SEP-3004 v1 keeps outside the preimage; see `anchors.json` and section 4).

## 3. Proposed extension registration: `conduct-witness`

Registered under section 2.2 in the type keyed form `extensions:{"conduct-witness":{…}}`. All values are JSON strings or `null` (the runtime-security convention, strictest of the registered profiles); `null` means recorded with no value, absent means not recorded.

REQUIRED: `record_sha256` (64 lowercase hex, equals the core `event_id`), `record_schema` (`jidec-path-v1`), `walked_at` (the witness's clock, RFC 3339 UTC), `witness_name`, `occurred_at_source` (`ledger_receipt` or `witness_clock`).

OPTIONAL: `record_url` (https, content addressed), `conduct_ext_uri` (the extension the walk measured against, `https://gate.horizonshield.dev/ext/conduct/v1` or its w3id form), `mode` (`mcp` or `a2a`), `privacy_mode` (`full`, `hash-only`, `commitment`), `witness_vantage`, `witness_signed_domain`, `witness_key_url`, `verdict_outcome` (`PASS` or `FAIL`), `n_pass`, `n_total` (decimal strings), `assertions_failed` (canonical array string of assertion names, `null` when none), `commitment`.

Outcome binding (section 2.1.1): the extension's `verdict_outcome` is evidence, never a competing outcome. Both `PASS` and `FAIL` bind to base `outcome: allowed`; `commitment` binds to `deferred`.

Event type vocabulary (section 2.9): `conduct_walk`, emitted once per witness record. Emission is never blocking: a walk that cannot produce a record produces no event, and the absence is visible as a gap between the witness's declared schedule and the chain, not as a failed operation.

Until the SEP accepts this registration, a verifier that only knows the SEP's registry reports the type as unregistered. That is correct behaviour on its side and the reason `--extensions registered` exists on ours.

## 4. Section 2.8, the follow-on anchoring profile this bridge would use

SEP-3004 reserves `anchor_witness`, requires it absent or null in v1, and names RFC 3161 timestamps, version control commits and public ledgers as candidate witnesses, with SCITT as a possible frame. What NENRIN already does fits the slot without inventing a service:

```
"anchor_witness": {
  "type": "opentimestamps-bitcoin",
  "subject": "<sha256 of the ledger entry bytes that list this event_id>",
  "subject_url": "https://ledger.horizonshield.dev/ledger/<n>?format=raw",
  "proof_url": "https://ledger.horizonshield.dev/ledger/<n>/ots",
  "bitcoin_block": "<height as a decimal string>",
  "position_binding": "the record names a block hash that existed before it was written and is stamped into a block that came after; neither coordinate is chosen by the prover"
}
```

Two properties the SEP's threat model (an organisation rewriting its own history) needs and a version control commit does not give: the witness is a clock nobody operates, and the stamp costs nothing and needs no account, so a recorder has no excuse not to anchor. Position binding (a block hash inside the record, a block after the record for the stamp) is the rule written up as "The Prover Does Not Choose the Coordinate" (SSRN 7425458); it is what makes backdating detectable rather than merely discouraged. This section is a proposal for the thread, not a claim that v1 verifiers read it; `anchors.json` carries the same facts beside the chain today.

## 5. SEP-1913 `evidenceRef`: the same bytes as a pointer

SEP-1913's `io.modelcontextprotocol/trust-annotations` extension carries an optional `evidenceRef` whose `type` is an open string, so that richer evidence lives outside the wire and schemes stay interchangeable. A NENRIN record is one such scheme, and the only one on that list that a party other than the server produced:

```
"evidenceRef": {
  "type": "nenrin.conduct.v1",
  "sha256": "<64 hex>",
  "url": "https://ledger.horizonshield.dev/witness/<sha256>",
  "recompute": "sha256(record_canonical) must equal sha256; the record's verdict.n_pass and n_total are counts, not a score"
}
```

The pointer is content addressed (the id is the hash of what comes back), which is the invariant vaaraio asked for on that thread and what gate 0.4.1 and the ledger already serve. It is server level evidence (what a third party saw of this server at a time), not a classification of one result, and a client MUST NOT read it as either an allow or a deny.

## 6. Divergences from the reference verifier, stated

The reference (`audit-record-contract.ts`) rejects control characters U+0000 to U+001F and U+007F in protected strings. This canonicalizer also rejects U+0080 to U+009F, as the SEP text says (Unicode Cc). For a record both accept the bytes are identical, which is what the known-answer tests and the cross verification measure; for a record carrying a C1 control the reference accepts and this tool refuses. Key sort is by code point here and by UTF-16 code unit in JavaScript; they differ only for keys above the BMP against private use keys, which registry vocabulary never contains.

## 7. What this bridge is not

Not a second ledger, not a signature (the chain proves intactness of a set, not who wrote it; the Ed25519 signature on a witness record and the ledger's attribution do that), not a verdict (nothing here recomputes an assertion), not a score, and not a claim that NENRIN conforms to a draft that is still seeking a sponsor. It is the export that a reader of that draft can verify with the draft's own code, and the registration text that would make the extension type read as known.
