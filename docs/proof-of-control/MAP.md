# Proof-of-Control requirements, mapped to HORIZON SHIELD

This page reads the 127 requirements of the Proof-of-Control working draft, one row each, against what HORIZON SHIELD
runs today, and names the evidence a reader can open. It is not a conformance statement. No Tier is claimed here, and
nothing on this page says the system is Proof-of-Control.

- Source: the requirement tables of chapters C1 to C10 in
  [LFDT-ProofOfControl/ov-poc-standard](https://github.com/LFDT-ProofOfControl/ov-poc-standard) at commit
  `54a7bc67140b39c9107216cd390dd47c1d42946d` (2026-10-29), as listed in `checklist/poc-checklist.csv` (127 rows,
  sha256 `ad0aece1...`). The repository's header calls the text Working Draft v0.1.4; the comment copy on the
  project's Google Doc calls it Working Draft v1.0. The requirement numbers below are the repository's. Each
  requirement is given as a short paraphrase; read the original for the exact words.
- Read on: 2026-11-07, against horizon-shield main at `19c021c5`.
- Status words: **met** (the evidence exists and covers the requirement for the system named below), **partly** (a
  mechanism exists but covers only part of the scope, or one of the requirement's conditions is missing), **not met**
  (nothing here does it today, or the requirement does not apply to anything we run; the note says which).
- Counts: met 20, partly 45, not met 62.

## The system this page reads

The chain of one paid call, and the records each step leaves:

    FURUI (content check runner)  ->  SEKI (the door that signs an admission)  ->  MUSUBI (contract and settlement)
      ->  NENRIN (the public ledger, anchored in Bitcoin)  ->  Resume
    TOOSHI checks the links every day.  TSUGI draws outside witnesses by lot and proves recovery.

- FURUI: the runner signs an envelope for each check (digests and closed words, no text) and a day record whose RFC 6962
  root covers every envelope of the day. The runner's code is not public; its records and the verifier are.
- SEKI: the door signs an admission record (admit, escalate or refuse, with a reason from a closed list) before a call
  runs. The door's code is not public; the record, its schema and the verifier are. The gateway in front of the paid
  tool refuses the call when the door does not answer admit (`workers/hs-gateway/src/seki.js`). Today the gateway guards
  one store of our own (`hs-seki-demo`), and the door makes one daily check call to its check store (`tooshi-check`);
  every other path of our services is not guarded.
- MUSUBI: the signed contract (grant, limits, expiry) and settlement, a function anyone recomputes.
- NENRIN: the ledger at https://ledger.horizonshield.dev. Every entry is hash-chained (`prev_entry_sha256`), stamped
  with OpenTimestamps and confirmed in a Bitcoin block. Entries are appended by the operator.
- TOOSHI: `tools/tooshi/tooshi_daily.py`, the daily end to end check (checks 1 to 16), published under `tooshi/days/`.
- TSUGI: recovery records, the witness draw (commit then reveal on Bitcoin) and the daily rebuild of the ledger from a
  copy we do not host.

Paths are in this repository. `nenrin/` stands for `workers/hs-ledger/nenrin/`. "ledger N" is
`https://ledger.horizonshield.dev/ledger/N?format=json`. "TOOSHI N" is check N of `tools/tooshi/tooshi_daily.py`.

## The question first: no execution without evidence

The highest bar of the draft (Tier 4, and 7.6.3, 8.3.3, 8.3.5, 10.3.2) is that an in-scope action cannot run unless its
evidence is produced. Our answer today is **not met**.

- What holds: on the guarded store, the gateway runs a paid call only after the door signed an admit for exactly
  that call, and refuses (HTTP 503, nothing spent) when the door is missing or does not answer
  (`workers/hs-gateway/src/seki.js`). The door's signed refusals are exercised every day by the heartbeat (an over the
  limit call and a prohibited call, both refused; `nenrin/seki-heartbeat/`). FURUI and SEKI make a signed record of
  every call they see, and TOOSHI 1, 2, 3 and 4 check each day that one fixed call's records link from the content check
  to the Resume.
- What does not hold yet: we have not shown that every operation passes the door. Other paths of our services are not
  guarded. The gateway waits for the door's signed answer, not for the record to be durably written on the ledger; the
  ledger receives records in a daily batch. No test yet withholds the evidence store and shows the calls stop.
- Next: TOOSHI 17 will count, for every paid call of the day that has a SEKI record, whether the FURUI envelope, the
  admission, the settlement and the ledger entry are all present, and turn red naming any call that lacks one. Until it
  runs green on real days, the rows that ask for this stay not met.

## C1 Provenance (13)

| # | Requirement (paraphrase) | Lv | Layer | Status | Evidence and notes |
|---|---|:-:|---|---|---|
| 1.1.1 | Execution record names the digest of model weights and serving config | 1 | FURUI | not met | The FURUI rules digest covers the model's name, not a digest of its weights; the model is a hosted service. |
| 1.1.2 | Weights digest compared to a signed manifest at load | 2 | none | not met | We do not load weights. |
| 1.1.3 | Signature chain over model artifacts validates; failures block deployment | 2 | none | not met | |
| 1.1.4 | Admission control rejects models, tools, plugins without valid attestation | 2 | none | not met | The conduct gate measures endpoints; it does not reject tools for missing attestation. |
| 1.1.5 | Supply-chain provenance in a standard format (SLSA, in-toto) | 3 | none | not met | Our verifier package `a2a-conduct-walk` is published with attestations (`.github/workflows/pypi-publish-a2a-conduct-walk.yml`), but no model supply chain is attested. |
| 1.2.1 | Each steering input recorded at ingestion with source and time | 1 | FURUI | partly | The FURUI envelope keeps a salted commitment of the content it checked (`input_commit`) and the check time (`nenrin/musubi-v0/ADMISSION.md`, v0.4). Retrieved documents, memory and tool outputs of an agent are not recorded. |
| 1.2.2 | Input records hash-linked to the records of the actions they fed | 2 | FURUI, SEKI | met | The admission's content block carries `check_sha256` of the runner's envelope; the execution record names the admission. Checked daily: TOOSHI 1 and 2. Verifier: `nenrin/furui-check-day-v0/VERIFY.md`. |
| 1.2.3 | Each data transformation appends to a hash-linked log | 2 | none | not met | |
| 1.2.4 | Training-data lineage and licensing obtainable by an outside verifier | 3 | none | not met | |
| 1.3.1 | Execution record names the compute environment (host, image digest) | 2 | none | not met | |
| 1.3.2 | Substrate identity backed by hardware or remote attestation | 3 | none | not met | No TEE. |
| 1.4.1 | Provenance keeps digests or commitments, not raw payloads | 1 | FURUI, SEKI | met | Envelope shape `furui-check-signed-v1`: hex digests and closed words, no text field (`nenrin/furui-check-day-v0/VERIFY.md`, step 1); admission v0.4 keeps a salted commitment. TOOSHI 6b checks the shape daily. |
| 1.4.2 | Outside verifier confirms a claim about confidential inputs without the data | 3 | FURUI | partly | Salted commitments allow a later opening (FURUI blind tests: `data/furui-blind-03/`, ledger 231 and 232); no selective disclosure protocol. |

## C2 Privacy (13)

| # | Requirement (paraphrase) | Lv | Layer | Status | Evidence and notes |
|---|---|:-:|---|---|---|
| 2.1.1 | Every data read and write recorded with store, object, operation, time | 1 | none | not met | |
| 2.1.2 | Privacy evidence holds identifiers or digests only; periodic scan confirms | 2 | FURUI, TOOSHI | partly | Closed shape with no text field; TOOSHI 6b reads two leaves of each day, not the whole store. |
| 2.1.3 | Record separates data used from data disclosed | 1 | none | not met | |
| 2.2.1 | Each data access evaluated against consent before execution | 2 | none | not met | |
| 2.2.2 | Each access records its purpose; mismatched purposes blocked | 2 | none | not met | |
| 2.2.3 | Queries limited to data the task needs; enforcement recorded | 2 | none | not met | FURUI's scope conflict (`content_scope_conflict`) reads the request against the scope, not data queries. |
| 2.2.4 | Licence and residency rules machine-enforced and recorded | 2 | none | not met | |
| 2.2.5 | De-identification logged; re-identification blocked | 2 | none | not met | |
| 2.3.1 | Where evidence would leak inputs, a ZK proof, selective disclosure or commitment | 3 | FURUI | partly | Salted commitment (`input_commit`) in admission v0.4; no ZK proof. |
| 2.3.2 | Consent records hashed and anchored at capture | 3 | none | not met | No consent records. |
| 2.3.3 | Verifiable computation gates release over confidential inputs | 4 | none | not met | |
| 2.4.1 | Retained evidence holds only minimized forms, enforced by schema | 1 | FURUI, SEKI | met | Closed shapes refuse a text field (`nenrin/furui-check-day-v0/VERIFY.md`; `nenrin/musubi-v0/schemas/a2a-admission-v0.schema.json`). Gate records: `workers/hs-verify-gate/ext/RECORD_PRIVACY_v1.md`. |
| 2.4.2 | Deletion requests reconciled with tamper-evident evidence; one executed | 2 | none | not met | |

## C3 Portability (5)

| # | Requirement (paraphrase) | Lv | Layer | Status | Evidence and notes |
|---|---|:-:|---|---|---|
| 3.1.1 | Each boundary crossing writes source, destination and what crossed | 1 | MUSUBI | partly | Contracts and execution records between two organizations name both parties and digests (`nenrin/musubi-v0/README.md`); crossings outside a contract are not recorded. |
| 3.1.2 | Integrity checked at the destination; result recorded on both sides | 2 | TSUGI, NENRIN | partly | Outside witnesses recompute a day on their machines and sign the answer (`nenrin/witness-answer-v0/`, TOOSHI 9); the result is recorded on our ledger, not on theirs. |
| 3.2.1 | Evidence stays verifiable after migration (keys, tools stay published) | 2 | NENRIN, TSUGI | met | Retired keys keep verifying (`workers/hs-verify-gate/src/key_history.js`, ledger 60); the ledger is rebuilt daily from a Software Heritage copy with our hosts blocked (`nenrin/survive-v0/README.md`, `.github/workflows/survive-drill.yml`, TOOSHI 15). |
| 3.2.2 | Signed linking record joins chains across attestation domains | 3 | NENRIN | partly | `nenrin/trace-bind-v0/` joins a TRACE record to a NENRIN or MUSUBI record, signed by the party whose act it is. Not used for every crossing. |
| 3.2.3 | Cross-jurisdiction disclosure review per pair | 3 | none | not met | |

## C4 Authorization (12)

| # | Requirement (paraphrase) | Lv | Layer | Status | Evidence and notes |
|---|---|:-:|---|---|---|
| 4.1.1 | Granted authority (permissions, scope, expiry) recorded before the first action | 1 | MUSUBI | met | The signed contract with `grant` and `grant.limits` is on file before calls (`nenrin/seki-heartbeat/check-contract.json`, `nenrin/musubi-v0/contract_v0.py`); the admission names `contract_sha256`. |
| 4.1.2 | Every action evaluated against the grant; record names the match or denial reason | 1 | SEKI | partly | Admission records carry the decision, the clause and reasons from a closed list (`nenrin/musubi-v0/ADMISSION.md`, `nenrin/musubi-v0/clause_eval_v0.py`). Only on the guarded store and the check calls. |
| 4.1.3 | Out-of-scope actions blocked at the gateway, with a rejection record | 3 | SEKI | partly | The gateway runs a call only after an admit (`workers/hs-gateway/src/seki.js`); the heartbeat's daily over-limit and prohibited calls are refused with signed records (`nenrin/seki-heartbeat/heartbeat.py`, TOOSHI 7). Guarded store only. |
| 4.1.4 | Tool parameters validated against a schema; parameter digest stored | 2 | SEKI | partly | The admission binds `action_binding_digest` and a nonce; the door admits only a request signed for that service, store and price. No general tool schema registry. |
| 4.1.5 | Per-task credentials with bound scope and expiry; no standing broad credential | 2 | MUSUBI, SEKI | partly | Contracts expire and each admission is bound to one nonce; the agent's signing key is long-lived. |
| 4.1.6 | Human approvals recorded with approver identity, content shown, decision, time | 2 | MUSUBI | partly | `nenrin/musubi-v0/APPROVAL_V3.md`: a signed approval that names the most it covers, read by settlement. No record of the content shown to the approver. |
| 4.1.7 | Authorization is path-aware across composed calls | 2 | none | not met | |
| 4.1.8 | Diagnostic or audit outputs cannot raise later authorization | 2 | SEKI | partly | The door does not accept a verification result brought by the applicant (`presentation_unverifiable` in `nenrin/musubi-v0/ADMISSION.md`); the effect of earlier tool outputs on later approvals is not tested. |
| 4.2.1 | Signed authorization validated (signature, expiry, audience, scope) before execution; recorded | 2 | SEKI | met | The door verifies the applicant's signed request against the contract and records the result; reasons include `contract_expired`, `key_revoked`, `nonce_reused` (`nenrin/musubi-v0/admission_verify_v0.py`). |
| 4.2.2 | Each delegation hop signed; chain validates to the principal | 2 | MUSUBI | partly | Contracts are signed by the principal (`nenrin/musubi-v0/contract_v0.py`); multi-hop delegation is not exercised in our public records. |
| 4.2.3 | Delegate's permissions cannot exceed the delegator's; escalations rejected | 3 | SEKI | partly | The closed reason `delegation_exceeds_parent` exists in the admission record; scope intersection at issuance is not shown. |
| 4.2.4 | Confidential delegation proven without showing the chain | 3 | none | not met | |

## C5 Identity (6)

| # | Requirement (paraphrase) | Lv | Layer | Status | Evidence and notes |
|---|---|:-:|---|---|---|
| 5.1.1 | Every record names the agent instance and the principal | 1 | MUSUBI, SEKI | met | Contract parties and keys; the admission names the contract and the relying party (`nenrin/musubi-v0/ADMISSION.md`). |
| 5.1.2 | Agent authenticates with a cryptographic credential before acting; recorded | 2 | SEKI | met | Ed25519 signed request checked by the door; a record signed with the applicant's own key is refused (`self_admission`). |
| 5.1.3 | Each tool call carries a delegation token linked to the principal's grant | 2 | SEKI | partly | On the guarded store the request names the signed contract; other tool calls carry no such token. |
| 5.1.4 | Identity credential bound to an attested environment | 3 | none | not met | No TEE. |
| 5.2.1 | Agent-to-agent messages signed; unsigned or invalid rejected and logged | 2 | NENRIN | partly | The witness intake rejects an invalid signature and records an absent one as `signed: false` (`workers/hs-ledger/src/worker.js`); A2A cards are signed (`workers/a2a-card-sign/`). Unsigned messages are not rejected everywhere. |
| 5.2.2 | Receiver validates sender with published keys, without the sender's operator | 3 | NENRIN | met | Keys served on each signer's own domain, the key list anchored (ledger 60, `workers/hs-verify-gate/ext/KEY_HISTORY_v1.md`); `nenrin-verify` checks offline. |

## C6 Security (12)

| # | Requirement (paraphrase) | Lv | Layer | Status | Evidence and notes |
|---|---|:-:|---|---|---|
| 6.1.1 | Claim lists its controls, each mapped to an evidence stream | 1 | all | partly | This page maps requirements to evidence; there is no conformance claim. |
| 6.1.2 | Every tool invocation recorded with tool, arguments or digest, status, time | 1 | SEKI | partly | Guarded calls leave an admission and an execution record; other tool calls of our services leave no such record. |
| 6.1.3 | Signed TEE or remote attestation at start, compared to reference values | 2 | none | not met | |
| 6.1.4 | Hardware-rooted attestation covers each named dependency | 3 | none | not met | |
| 6.2.1 | Generated code and outside tools run in a recorded sandbox | 2 | none | not met | |
| 6.2.2 | Sensitive workloads in confidential compute, verifiable from outside | 3 | none | not met | |
| 6.2.3 | On-chip enforcement gates execution | 4 | none | not met | |
| 6.3.1 | Evidence signing keys in HSM, non-exportable | 2 | none | not met | Keys are held as platform secrets, not in an HSM. |
| 6.3.2 | Rotation schedule; each rotation writes a signed old-to-new record | 2 | NENRIN | partly | Key history with status and dates, anchored on change (`workers/hs-verify-gate/src/key_history.js`, ledger 60). No fixed schedule; the record is anchored, not signed by the old key. |
| 6.3.3 | Key compromise procedure (revoke, find affected evidence, re-grade, notify), exercised yearly | 2 | NENRIN, TSUGI | partly | Procedure in `workers/hs-verify-gate/ext/KEY_HISTORY_v1.md`: a revoked key counts only for bytes shown to exist earlier on Bitcoin. Recovery records in `nenrin/recovery-v0/`. A full exercise is not on record. |
| 6.3.4 | Every record names its signature algorithm; migration path declared | 2 | all | partly | Signatures carry `alg` (`ed25519`, ES256 for cards); no declared migration path. |
| 6.3.5 | Post-quantum or re-anchoring when retention outlives the signature scheme | 3 | NENRIN | not met | Bitcoin anchoring proves existence by time without a signature, but no PQ scheme or re-signing plan is declared. |

## C7 Evidence Generation and Properties (28)

| # | Requirement (paraphrase) | Lv | Layer | Status | Evidence and notes |
|---|---|:-:|---|---|---|
| 7.1.1 | All tool invocations go through a separate interception gateway; no bypass | 3 | SEKI | partly | `workers/hs-gateway/src/seki.js`: the door is a separate worker; MCP `tools/call` is refused for a guarded store. Only the guarded store. |
| 7.1.2 | Gateway emits signed before, during and after records per action | 3 | SEKI, MUSUBI | partly | Before: the signed admission. After: the signed execution record. No during record. |
| 7.1.3 | The before record is durably written before the action is released | 3 | SEKI | partly | The call waits for the door's signed admit; the ledger gets it in a daily batch, so durable public writing before release is not shown. |
| 7.1.4 | Effect channel mediated inside the policy trust boundary | 3 | SEKI | partly | The gateway holds the paid service and releases it only for an admit bound to that exact call; the operator runs both. |
| 7.1.5 | No claim that evidence describes executed actions unless 7.1.4 holds | 1 | all | partly | Records carry `establishes` and `does_not_establish`; there is no conformance claim. |
| 7.2.1 | Each record written within the action's transaction, with capture time | 1 | FURUI, SEKI | partly | Envelope and admission are signed at the call; the ledger receives them later. On 2026-10-19 and 10-20 the order could not be shown through Bitcoin (`nenrin/seki-heartbeat/README.md`, ledger 123). |
| 7.2.2 | Timestamps anchored outside the operator (TSA, transparency log, consensus time) | 3 | NENRIN | met | OpenTimestamps into Bitcoin (`.github/workflows/ots-nightly.yml`); every entry shows `bitcoin_block` (ledger 175: block 973358). |
| 7.2.3 | Maximum attestation refresh interval stated and kept | 3 | none | not met | No hardware attestation. |
| 7.2.4 | Attestation binds the evidence signing key | 3 | none | not met | |
| 7.3.1 | Records hash-chained or Merkle-anchored; chain verified on schedule, results recorded | 2 | NENRIN, TSUGI | met | `workers/hs-ledger/src/chain_v1.mjs` (`prev_entry_sha256`); the daily rebuild drill commits its report (`nenrin/survive-v0/`, TOOSHI 15). |
| 7.3.2 | Records signed by keys the operator and agent cannot access | 3 | NENRIN | not met | One operator holds the door, runner and ledger keys. |
| 7.3.3 | Equivocation resisted (gossip, witness quorum, single-history ledger) | 3 | NENRIN, TSUGI | met | Anchoring in Bitcoin; the head is written into each daily witness batch (`/ledger/head`); outside witnesses sign day roots (TOOSHI 16, ledger 73). |
| 7.3.4 | Inclusion proof of one record against a published root (RFC 6962) | 3 | FURUI, NENRIN | partly | FURUI leaves: RFC 6962 audit path to the day root (`nenrin/furui-check-day-v0/VERIFY.md`, step 3; TOOSHI 6b). Ledger entries are a linear chain, proven by the full export, not by inclusion proofs. |
| 7.3.5 | Append-only consistency of published roots, checked against the anchored value | 3 | NENRIN, TSUGI | partly | The drill rebuilds the chain and checks it against Bitcoin; no RFC 6962 consistency proof. |
| 7.4.1 | Disclosure lists every party, hardware and math assumption per mechanism | 1 | all | partly | `does_not_establish` in `/ledger/head` and each record type. Not one complete list. |
| 7.5.1 | Schema fields are execution facts only; no quality, correctness or intent | 1 | FURUI, SEKI | met | Closed shapes: digests, identifiers, times, decisions from closed lists (`nenrin/musubi-v0/schemas/a2a-admission-v0.schema.json`). |
| 7.5.2 | Claims describe evidence only as execution facts; documented claims review | 1 | all | partly | Records say what they do not establish; no documented legal review. |
| 7.6.1 | Evidence pipeline failures alert and are written to a secondary log | 2 | TOOSHI | partly | A red day opens an issue and sends a mail (`tools/tooshi/tooshi_tell.py`, `.github/workflows/tooshi-daily.yml`); daily, not per failure. |
| 7.6.2 | Monotonic sequence numbers per source, so gaps show | 2 | NENRIN | met | Ledger entry `n` with `prev_entry_sha256`; FURUI day record `n` and leaf index. |
| 7.6.3 | Actions refused when evidence cannot be generated (fail-closed test) | 4 | SEKI | not met | The gateway fails closed when the door does not answer; no test withholds the evidence store. TOOSHI 17 is planned. |
| 7.6.4 | Evidence store role-based access; every read recorded | 2 | none | not met | The ledger is public to read; reads are not recorded. |
| 7.6.5 | Retention period stated, configured and long enough | 1 | NENRIN | partly | The ledger keeps every entry; the gate's history keeps 400 records per endpoint (`nenrin/ring-v1/README.md`). No stated period in a claim. |
| 7.6.6 | Root anchored within a declared interval; missed deadline alerts | 3 | NENRIN, TOOSHI | partly | Daily batch at 00:30 UTC; TOOSHI 6 turns red on a missing batch and TOOSHI 14 bounds Bitcoin waits to 36 hours. Interval not declared in a claim. |
| 7.7.1 | Machine-readable schema published; output validates | 2 | SEKI, FURUI | partly | `nenrin/musubi-v0/schemas/`; FURUI closed shapes checked by `nenrin-verify`. Not every record type has a schema file. |
| 7.7.2 | One canonical serialization; exact signed bytes stated | 2 | MUSUBI, NENRIN | met | musubi-canonical-v0 and RFC 8785 (`tools/jcs_vectors.json`); signed bytes stated per record (`nenrin/musubi-v0/ADMISSION.md`). |
| 7.7.3 | Every digest and signature carries an algorithm identifier | 2 | all | partly | Signatures carry `alg`; digests are named by field (`*_sha256`), not by an identifier in the value. |
| 7.7.4 | Canonical form proven on published vectors incl. negative cases | 3 | MUSUBI, FURUI | met | settle-core 128 vectors (`nenrin/musubi-v0/settle-core-v0/`), reproduced by two outside implementations; `nenrin/furui-check-day-v0/verify_vectors.json`. |
| 7.7.5 | Parser rejects duplicate keys | 2 | MUSUBI | met | `nenrin/musubi-v0/admission_verify_v0.py` (`_no_duplicate_keys`). |

## C8 Verifiability Tiers and the Binary Threshold (15)

| # | Requirement (paraphrase) | Lv | Layer | Status | Evidence and notes |
|---|---|:-:|---|---|---|
| 8.1.1 | Claim register gives every claim a Tier | 1 | none | not met | No claim register. |
| 8.1.2 | Each register entry has a trust analysis matching its Tier | 1 | none | not met | |
| 8.1.3 | Single-party claims registered at Tier 2 or below | 1 | none | not met | No register. Most of our records are signed by one operator. |
| 8.1.4 | "Proof-of-Control" used only for Tier 3 or 4 claims | 1 | all | partly | We do not use the name for our system; no documented claims review. |
| 8.1.5 | Outside party completes verification with published materials only, recorded | 3 | TSUGI, NENRIN | met | Outside witnesses sign day records with keys on their own domains (TOOSHI 9 and 16, `nenrin/WITNESSES.md`, ledger 73); two outside implementations reproduce settle-core 128 of 128. |
| 8.1.6 | After-the-fact evidence at Tier 3; Tier 4 only where verification gates operation | 1 | all | partly | Our records are after the fact by design (`nenrin/musubi-v0/README.md`: prove and price, do not enforce at runtime); not registered. |
| 8.1.7 | Vendor-rooted attestation at Tier 2 unless composed with public anchoring | 3 | none | not met | Does not apply today: no attestation-based claim. |
| 8.1.8 | Verification procedure and tooling published, versioned, no NDA | 3 | NENRIN | met | `nenrin-verify` on npm and PyPI and in Go (`nenrin/sdk/`, `nenrin/sdk-python/`, `nenrin/sdk-go/`). |
| 8.2.1 | Register maps each control to a mechanism within its scope | 1 | none | not met | |
| 8.2.2 | Signing-time and runtime claims kept apart | 1 | none | not met | |
| 8.3.1 | Tier 4 interaction inventory | 4 | none | not met | |
| 8.3.2 | Sub-Tier-4 parts reach the chain only through Tier 4 interfaces | 4 | none | not met | |
| 8.3.3 | Operation halts when the proof chain is invalid or withheld | 4 | none | not met | See the section at the top. |
| 8.3.4 | Availability impact of proof-gated operation documented; recovery exercised | 4 | TSUGI | not met | Recovery is exercised (`nenrin/recovery-v0/`, ledger 173 and 175), but there is no proof-gated operation to document. |
| 8.3.5 | Halt enforced outside the operator's control | 4 | none | not met | |

## C9 System Surface (MAESTRO) (6)

| # | Requirement (paraphrase) | Lv | Layer | Status | Evidence and notes |
|---|---|:-:|---|---|---|
| 9.1.1 | Each register entry names its MAESTRO layer | 1 | none | not met | |
| 9.1.2 | Statement names the system surface framework and version | 1 | none | not met | |
| 9.1.3 | Register validation rejects a missing layer field | 1 | none | not met | |
| 9.2.1 | Tamper-evident logging covers every system in scope | 2 | NENRIN | partly | FURUI, SEKI and MUSUBI records go to the ledger; the gate's own history is exported monthly into rings (`nenrin/ring-v1/`). Other services are not covered. |
| 9.2.2 | Evidence produced at the layer where the control is enforced | 2 | none | not met | No layer mapping. |
| 9.2.3 | Multi-layer claims aggregate per-layer evidence into a hash-linked bundle | 3 | MUSUBI | partly | Each day's settlement bundles the chain's records by sha256 (`nenrin/seki-heartbeat/check_loop.py`, `SETTLED.json`); not organised by layer. |

## C10 Conformance and Trust-Assumption Disclosure (17)

| # | Requirement (paraphrase) | Lv | Layer | Status | Evidence and notes |
|---|---|:-:|---|---|---|
| 10.1.1 | Statement names its stage | 1 | none | not met | No conformance statement. |
| 10.1.2 | Statement lists claimed domains only | 1 | none | not met | |
| 10.1.3 | Every asserted fact resolves to a register entry | 1 | none | not met | |
| 10.1.4 | Statement has all required fields | 1 | none | not met | |
| 10.1.5 | Statement cites the standard's version and date | 1 | none | not met | |
| 10.1.6 | Statement defines the system boundary and excluded action classes | 1 | all | partly | This page states the system and that unguarded paths are outside it; it is not a statement. |
| 10.1.7 | Statement machine-readable | 2 | none | not met | |
| 10.1.8 | Declared inventory reconciled against automated discovery | 2 | none | not met | |
| 10.2.1 | Residual trust assumptions listed per claim, one to one with mechanisms | 1 | all | partly | `does_not_establish` per record type; not per claim. |
| 10.2.2 | Each assumption tagged with a category | 2 | none | not met | |
| 10.3.1 | Evidence in a tamper-evident store; chain checks available to the assessor | 2 | NENRIN, TSUGI | met | The ledger, its export (`/ledger/export.jsonl`) and the daily drill reports (`nenrin/survive-v0/`). |
| 10.3.2 | Every in-scope action covered; gateway count equals evidence count | 4 | TOOSHI | not met | TOOSHI 17 will reconcile paid calls against records. |
| 10.3.3 | Automated validator checks each record within a window; results logged | 4 | TOOSHI | partly | TOOSHI runs daily and publishes each day (`tooshi/days/`); it reads the day's fixed calls, not every record. |
| 10.3.4 | Validation failures alert within a bounded window; acknowledgment tracked | 4 | TOOSHI | partly | A red day opens an issue and a mail the same morning; acknowledgment times are not tracked. |
| 10.3.5 | Monitoring re-assessed by an outside assessor on a cycle | 4 | none | not met | |
| 10.3.6 | Proof coverage computed and published | 3 | TOOSHI | not met | Planned with TOOSHI 17. |
| 10.3.7 | Automated validators evaluated for structured-trace parsing | 3 | none | not met | |

## Ledger entries named on this page

Each was read with a plain GET on 2026-11-07 and is confirmed in Bitcoin.

| entry | what it holds | Bitcoin block |
|---|---|---|
| 60 | key history of gate.horizonshield.dev, 2026-09-28 | 968923 |
| 73 | witness batch with outside signed walks | 970423 |
| 123 | batch holding the 2026-10-19 admission | 972237 |
| 173 | TSUGI draw commitment | 973320 |
| 175 | TSUGI first live draw, quorum of two | 973358 |
| 231, 232 | FURUI blind-06 plan and result | 974072, 974128 |
