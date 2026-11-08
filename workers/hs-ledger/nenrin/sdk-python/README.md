# nenrin-verify (Python)

Recompute NENRIN evidence yourself, offline, in your own Python process. The Python twin of the npm package
[`nenrin-verify`](https://www.npmjs.com/package/nenrin-verify) and of the TSUGI recovery-chain verifier
`tsugi_verify.mjs`: same input, same report (the limits are listed under "Where the claim stops"). It also carries
the MUSUBI contract verifier, which is written in Python, byte for byte.

    pip install nenrin-verify
    nenrin-verify --selftest          # 31/31 frozen bundles and 98/98 TSUGI chains match the JavaScript; MUSUBI run0002 recomputes
    nenrin-verify bundle.json         # the provenance report; exit 0 accepted, 1 refused
    tsugi-verify chain.json --operator-key <b64>   # a TSUGI recovery chain, printed as node tsugi_verify.mjs prints it
    musubi-verify contract_v0 --verify contract.json   # a MUSUBI module, run exactly as python3 contract_v0.py in the repository

```python
import json, nenrin_verify as nv

bundle = nv.js_loads(open("bundle.json", "rb").read())   # parsed the way JSON.parse parses it
report = nv.verify_bundle(bundle)             # did:key resolution, no network, no clock
print(report["verdict"], report["does_not_establish"])
print(nv.report_json(report))                 # JSON text as the JavaScript CLI prints it (not json.dumps)
print(nv.report_sha256(report))               # compare with the JavaScript run, byte for byte
```

One dependency, `cryptography`, for Ed25519. Nothing here opens a socket, except `tsugi-verify --fetch-operator-key
<origin>`, which fetches the operator key from the origin you name, and the two opt-in calls below
(`nenrin-a2a-record submit` / `flush(submit=True)`, and `policy.fetch_resume`).

## Record every A2A call your agent makes (0.4, `a2a_recorder`)

Two lines with the official A2A Python SDK (`pip install "nenrin-verify[a2a]"`):

```python
from nenrin_verify.a2a_recorder import Recorder
client = ClientFactory(config).create(card, interceptors=[Recorder(witness_name="acme-billing", key="witness.pem")])
```

From then on every outgoing call (send, stream, get_task, cancel, ...) is logged on your machine: method, time, the
salted sha256 of the request and of every response event, the final task state, and whether any result came back.
At exit (or `rec.flush()`) the calls become one Ed25519-signed `jidec-path-v1` record per agent endpoint, in
`nenrin-records/records/` (the exact body the NENRIN witness intake accepts), with the salt and the full log kept in
`nenrin-records/private/` (mode 600). Nothing is sent unless you file it. Content never leaves your machine; a
counterparty you show the private file to can match any call to its own logs (`a2a_recorder.matches`).

Each record lists what it establishes and what it does not, names the previous record for the same endpoint
(`prev_path_refs`, so a dropped day is a visible gap), and is checked against the ledger's own intake rules and the
resume assembler before it is written. A record says what came back from an agent you actually used, not whether
it was right; an unanswered call may be your own network, and the record says so.

    nenrin-a2a-record keygen witness.pem       # serve the public key at https://<your domain>/... and pass key_url=
    nenrin-a2a-record show                     # the records in ./nenrin-records
    nenrin-a2a-record verify nenrin-records/records/<sha>.json --private nenrin-records/private/<sha>.json
    nenrin-a2a-record submit nenrin-records/records/<sha>.json     # opt-in: file it at the public ledger

## Your rule, your decision (0.4, `policy`)

NENRIN never says whether to trust an agent. `policy.evaluate` applies a rule you write to a resume and returns a
decision anyone recomputes from (resume, rule, time). No score; every record counted or not counted is listed with
the reason, and the resume's own sha256 is recomputed rather than trusted.

```python
from nenrin_verify import policy
rule = {"min_independent_witnesses": 2, "within_days": 30, "max_fail": 0, "exclude_domains": ["mycompany.example"]}
d = policy.evaluate(policy.fetch_resume("https://agent.example/a2a"), rule)
print(d["allow"], d["reasons"])
```

By default a witness counts only by the domain its signing key is served from (`independence: "signed_domain"`),
and the measured agent's own domain never counts. `nenrin-policy <endpoint or resume.json> --rule rule.json` does
the same from a shell (exit 0 allow, 1 deny).

Snippets for LangGraph, the OpenAI Agents SDK, Google ADK, CrewAI and Claude (the verification gate as an MCP tool,
the recorder and the policy together): [integrations/FRAMEWORKS.md](https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-ledger/nenrin/sdk-python/integrations/FRAMEWORKS.md).

## Score your verifier the way the TSUNAGI board does (0.4.9, `nenrin-tsunagi`)

The TSUNAGI board (`ops/tsunagi/BOARD.md` in the repository) runs every registered NENRIN verifier every night, each
cloned from its author's own repository. For the NENRIN corpora it no longer repeats the count an implementation
prints: it hands the implementation the fixtures as one batch file, reads back one verdict signature per fixture and
compares each with the frozen expected.json itself. `nenrin-tsunagi` is that referee, with the corpora inside
the package (`nenrin-tsunagi list`), so you get the board's answer on your own machine before you open a pull request.

```sh
pip install nenrin-verify
nenrin-tsunagi list
nenrin-tsunagi run nenrin-interop-v0.2-edge -- "python3 my_verifier.py {in} {out}"
nenrin-tsunagi row nenrin-interop-v0.2-edge -- "python3 my_verifier.py {in} {out}"    # the row for implementations.json
```

The contract, in any language: `{in}` is a JSON array `[{"name", "bundle"}]`; write `{out}` as
`{name: {"verdict", "refusals", "findings"}}` (or `{name: {"error"}}`). Codes are compared as sets (VERIFIER.md
section 4). A missing case, an extra case, an error or any difference is a case not reproduced; exit 0 only when
every case reproduces.

## What it verifies

| module | what | held to |
|---|---|---|
| `verify_provenance`, `consume_evidence`, `posture_line`, `candidate_evidence_set`, `preflight_report` | one A2A task's provenance graph: the delegation chain observed by third-party witnesses (R1 to R4, witness and edge signatures), the caller's grant and the provider's execution receipt (E1 to E3, caller and provider signatures), the provider's pre-execution intent, the outcome's evidence pointer, and the digest link between the layers | npm nenrin-verify 0.4.4 (`nenrin_verify.mjs`, verifier 0.1.6): the same report, key for key |
| `agreement_verify.verify`, `nenrin-agreement-verify` | a two-party agreement record (`a2a-agreement-v1`, `v1.1`), including key succession across a rotation | the repository's own Python verifier, unchanged but for one import line and a header comment; it and the JavaScript verifier return the same report on 5,286 frozen cases, and from npm nenrin-verify 0.3.0 the JavaScript command `nenrin-agreement-verify` prints what this one prints |
| `musubi.load`, `musubi-verify` | MUSUBI (a2a-contract-v0): a contract both parties signed, its settlement against anchored execution records (settle v1 to v1.12), admission records (a2a-admission-v0, the verifying side), offers, bonds, corrections, terms, independence, corroboration, and the spine that threads one contract through all of them | the repository's own files (`musubi-v0/`), byte for byte: MUSUBI is written in Python and has no JavaScript twin, so the guarantee is that installing changes nothing, each of its 18 modules passes its own self-test from the package, and the first settled execution (run0002) recomputes to its published hashes |
| `tsugi.verify_chain`, `tsugi-verify` | a TSUGI recovery chain (drift, proposal, authorization, execution, verify): every record's schema, hash and Ed25519 signature, order and links, strict mode (a human-approval repair needs an authorization signed by a trusted operator key, unexpired), the random witness draw recomputed from beacon, pool and subject, the commit-then-reveal anchor, the embedded witness observations and the quorum | `tsugi_verify.mjs` (verifier 0.3.1): the same stdout, byte for byte, and the same exit code |

## How "same report" is checked

The JavaScript file is the reference. The port reads it line for line, and every place where Python and
JavaScript disagree by default (`x or y` on `{}`, `==` on `True` and `1`, `Date.parse` accepting February 31st,
Node's lenient base64, an own `__proto__` key that Object.assign turns into a prototype, the order V8's sort
gives values a numeric comparator cannot order, `new URL(s).host`) goes through `src/nenrin_verify/_js.py` and
`src/nenrin_verify/_url.py`, so the differences can be read in one place.

- **Frozen.** 31 bundles signed with keys derived from a public phrase, covering accepted graphs, refusals of every
  layer, witness disagreement, provider equivocation, action bindings, non-ASCII and escapes, and the date edge
  cases. For each, the report, the `consume_evidence` projection and the CLI output are byte-identical to the
  JavaScript's. They ship in the package; `nenrin-verify --selftest` re-runs them on your machine.
- **Live.** Every path of every frozen bundle is broken in about twenty ways (deleted, nulled, retyped, shortened,
  reordered, timestamps and sequence numbers bent, own `__proto__` keys added, the whole bundle replaced by an
  array or null), 27,062 inputs in all. Each is run through the JavaScript verifier and through this port. Pass
  means both threw, or both returned the same report and projection. 0 differ.
- **Semantics.** The helpers in `_js.py` against Node directly: number text, Date.parse, Buffer base64, string
  escaping and mixed-type sorting, several thousand random values each.
- **Agreement.** The packaged agreement verifier returns every one of the 5,286 frozen reports in
  `agreement-v0/agreement_vectors_v1.json`, the file the JavaScript verifier is scored against.
- **Unchanged.** `VENDORED.json` pins the sha256 of the agreement files and their sources; a copy that drifts fails.
- **MUSUBI, byte for byte.** The 18 modules of `musubi-v0/` and the data their self-tests read sit in
  `src/nenrin_verify/_repo/musubi-v0/`, beside a byte-identical `agreement-v0/`, the layout each module expects; no
  line is edited, and `VENDORED.json` pins each to its source (the same sha256 twice). Byte identity matters beyond
  the proof: `correction_v0` fingerprints its own code files, so a correction bundle built from the repository
  verifies here only if the files are the same bytes. From the installed wheel, every module's own self-test
  passes (`musubi-verify --selftest`, 18/18) and run0002 recomputes to `b13a3869...` and `11c27fcf...`
  (`musubi-verify --run0002`). Not shipped: `gen_anchor_compose_fixture.py` (needs `opentimestamps`, regenerates a
  fixture) and `header_view_fetch.py` (fetches block headers over the network).
- **TSUGI, frozen.** 98 cases: the repository's three real chains (incident 2 with the real operator signature,
  12 records; the 7-record incident of the same week; that incident re-verified by a random draw of witnesses),
  under the command lines that matter, and edits of them that reach every one of the 69 refusal codes
  `tsugi_verify.mjs` has, plus the five inputs on which the JavaScript itself throws. Edited chains are re-sealed so
  an edit meets the rule it targets, not only a hash mismatch. For each, `node tsugi_verify.mjs` was run and its
  stdout and exit code frozen; they ship in the package and `nenrin-verify --selftest` re-runs them.
- **TSUGI, live.** Every path of the real chains and of the witness pool is edited in about twenty ways, raw and
  re-sealed: 29,326 inputs with the frozen cases. Each is run through `tsugi_verify.mjs` and through this port.
  0 differ; 3 edits put a non-ASCII host in an endpoint, and there the port raises `NotReproduced` instead of
  answering (see below).
- **TSUGI semantics.** `new URL(s).host`, `toLowerCase`, `Buffer.from` on any JSON value and string conversion of
  any JSON value, against Node directly, several thousand inputs each.

`report_sha256(report)` is the sha256 of the report with keys sorted by UTF-16 code unit at every depth, no
whitespace, strings and numbers as JSON.stringify writes them. The JavaScript side of the same hash is
`tests/parity/js_canon.mjs` (twelve lines).

## Check a day of the content check runner (0.8.0, `furui-day`, `resume-admission`)

```sh
nenrin-verify furui-day 2026-11-03 --leaf 0
nenrin-verify resume-admission https://shield.the-horizons-innovation.com/ <record_sha256>
```

Six checks on one leaf of the runner's day: the envelope's closed shape, the leaf sha256, the RFC 6962 audit path to
the root of the day record the ledger serves, runner-1's Ed25519 signature on the day record and on the envelope, the
key in the ledger's `/.well-known/furui-check-keys.json` inside `from_height`, and the ledger batch entry with its
OpenTimestamps proof to a Bitcoin block header (`not_yet` before the anchor). The second command holds one
admissions[] line of a Resume to the stored admission, the batch entry and its proof. Exit 0 ok, 1 fail, 3 not_yet,
2 usage or network error; GET only, only ledger.horizonshield.dev and furui.horizonshield.dev. The same commands in
npm `nenrin-verify`; both give the same verdicts on the shared vectors (`../furui-check-day-v0/verify_vectors.json`)
and on seeded mutations of them, which is what the tests compare. Details:
`../furui-check-day-v0/VERIFY.md`.

The chain these commands sit in has five names: FURUI (篩, the content check runner) → SEKI admission (関の扉, the door that
signs an admission) → MUSUBI settle (結の精算, the settlement of a contract) → NENRIN ledger (年輪の台帳, anchored to
Bitcoin) → Résumé. TOOSHI checks the whole chain every day, and TSUGI (継) calls outside witnesses by a public draw.
`furui-day` checks one FURUI leaf up to the NENRIN ledger and its Bitcoin anchor; `resume-admission` checks one SEKI
admission as the Résumé lists it, back to the ledger.

## Walk one paid call (0.11.0, `tasuki`; Python only for now)

```sh
nenrin-verify tasuki <record_sha256>
```

`record_sha256` is the sha256 of a SEKI admission record's bytes, the key the ledger serves it under
(`GET /admission/<sha>`). The walk goes from that record to the Bitcoin anchor and answers each handoff (link) of the
call with `holds`, `missing` or `not_yet`, a reason, and the digests it compared: `adm->check`, `check->day`,
`day->entry`, `adm->entry`, `adm->exec`, `exec->result`, `exec->entry`, `exec->settle`, `settle->recompute`,
`entry->ots`, `day->witness`. Each link asks whether the later record names the earlier one by its digest, and calls the
checks this package already has: `furui-day` for the leaf, the day record and its batch, the vendored
`admission_verify_v0` for the record's signature and its `admission_sha256`, and the settle version `SETTLED.json`
names for `settle->recompute`, which runs the settlement again from the anchored records of `runs/<day>/` and the
headers of `seki-heartbeat/view-chunks` and compares the bytes. `not_yet` is a wait: the runner's day closes at 00:47
UTC the next day, then the ledger batch, the Bitcoin confirmation, the settlement and the witness answer. A link whose
earlier link does not hold takes that state and names it in `follows`; `causes` lists the links that do not hold on
their own. Exit 0 every link holds, 3 none missing and some not_yet, 1 a link is missing, 2 usage or network error.
GET only, no redirects: the ledger, the runner, agreement.horizonshield.dev, raw.githubusercontent.com (this
repository's main branch) and the relying party's `key_url`. The output carries `does_not_establish`: a chain that
holds shows that each handoff left a record that names the one before it; it does not show that any judgment in it was
right. The JavaScript twin comes next.

## 0.11.0

- `tasuki <record_sha256>`: walks one paid call link by link, from its SEKI admission record to the Bitcoin anchor
  (the section "Walk one paid call" above). Python only; the npm package stays at 0.10.0 and has no `tasuki`, so the
  same version number never names two different sets of commands.

## 0.10.0

- `furui-day` takes `--runner 1|2` (1 when left out). Runner 2 is FURUI's second content check runner: its day tree is
  `https://furui.horizonshield.dev/furui2/day/`, its day record and envelopes carry key_id runner-2, and its day record
  names runner_id runner-2. A runner-1 day record may name runner_id runner-1 or leave it out; a record that names
  another runner is refused at step 5 (runner_id_is_not_runner_1 or _2). Earlier versions refuse every runner-2 day
  (key_id_is_not_runner_1), so a runner-2 day needs this version or later. Python, JavaScript, Go (0.6.0) and Java
  (0.3.0) give the same answers on `../furui-check-day-v0/verify_vectors.json` (85 cases, 10 of them for the runner).
- The MUSUBI copy reads admission records of version 0.5 (the content block of more than one runner: checks[], quorum,
  disagreement_kind) and carries settle v1.20, which reads them; a 0.5 record needs this version or later, and earlier
  versions refuse it as malformed. Records of 0.3 and 0.4 read as before.

## 0.9.0

- `furui-day` and `resume-admission` take `--bitcoin-header`: after the anchor, the block header at the proof's height from
  mempool.space and blockstream.info; both must serve the same header, its merkle root must be the proof's and its
  sha256d the block hash, at or under the target its own bits name. Without the flag no other host is asked. Python and
  JavaScript give the same answers on `../furui-check-day-v0/bitcoin_header_vectors.json`; Go and Java take the flag in
  their next version.

## 0.8.1

- `furui-day` and `resume-admission` read every 64 hex value (each sha256, the audit path, the day record's root, a
  Resume line's `rules_sha256`, the second argument of `resume-admission`) as exactly 64 characters of `0-9a-f`, and
  the day, `signed_at`, the nonce, the signature and `--leaf` the same way, with ASCII digits only (`fullmatch` and
  `[0-9]`). 0.8.0 read them with `re.match` and a final `$`, which also passes one trailing line feed, and with `\d`,
  which takes any Unicode digit: an audit path hash with a trailing `"\n"` rebuilt the root (`bytes.fromhex` skips
  whitespace), and a signed envelope with a line feed after `input_commit` passed all six checks. The JavaScript, Go
  and Java ports refused these already. The shared vectors have 21 more cases (75), and the mutations of the tests
  edge string values (a character before or after, uppercase), so this difference fails the comparison.
- `nenrin_verify.trace` (the bind record's `record_sha256`, `trace_sha256` and `trace_key_thumbprint`, and the
  base64 forms) and the JavaScript property order in `_js` (an array index key) use `fullmatch` as well; the TRACE
  corpora give the same verdicts as before.
- The agreement verifier (`nenrin_verify.agreement_verify`, vendored from agreement-v0) reads `agreed_at` with `[0-9]`: `\d` took
  fullwidth and other Unicode digits, which the JavaScript twin refuses (`bad_agreed_at`). The JavaScript twin now
  reads Python's whitespace where Python's `\s` stands (after "paid", and in the host of an https URL: `\x85` is a
  space there and `\ufeff` is not). `tests/test_agreement_edges.py` holds both verifiers to the same report on these
  inputs; the 5,286 frozen reports are unchanged.
- The JavaScript reference the self-test names is npm `nenrin-verify` 0.8.1 (its furui commands now wait for stdout
  before they exit; the reports are the same).

## 0.8.0

- `nenrin-verify furui-day <day> --leaf <i>` and `nenrin-verify resume-admission <endpoint> <record_sha256>`
  (`nenrin_verify.furui_day`), with the shared vectors and `nenrin-verify furui-vectors <file>`. The tests run the
  JavaScript twin on the vectors and on mutations of them and compare the answers line by line.
- The first release on PyPI that reads admission records of version 0.4 (the content block) and 0.3, and settle v1.17
  to v1.19: `musubi-verify admission_verify_v0 --selftest` runs the 0.4 checks from the installed package (8 records
  verify, 21 are refused, the JavaScript twin agrees on all 30).
- settle v1.17 and requirements_furui_v0: when a contract names the content check it expects
  (`requirements.furui.rules_sha256`), an admission of version 0.3 is read against it (`content_rules_mismatch`,
  `content_not_checked`); settle core v0 revision 0.10, section 17.
- Admission records of version 0.4 (admission_verify_v0): the content block in the shape of FURUI A7.4, with a salted
  commitment to the content (`input_commit`), the decision, the marks `off_topic` and `rule_conflict`, `unread`,
  `answered` and `checked`, and the reason `content_off_topic`.
- settle v1.18: an action run after the door escalated on the content, with no approval that counts, is a deviation,
  `executed_after_content_escalate`; settle core v0 revision 0.12, section 18, and its 14 vectors. An approval signs no
  admission's digest, so that an approval answers a particular escalate is not established.
- settle v1.19: admissions of version 0.4 are read (the content gate, and the escalate rule over 0.3 and 0.4 in one
  pass), and an action run after an escalate on the immune rules alone, with no approval that counts, is a deviation,
  `executed_after_immune_escalate`; settle core v0 revision 0.13, section 19, and its 19 vectors.
- settle core v0 revision 0.11 (text only): the byte order of `max_target_bits`, and a reason of 4.2 stops the
  examination of records.

## 0.7.0 (2026-10-22)

- settle v1.13 to v1.16 and approval_v3, so the package carries the reference of settle core v0
  (draft-oga-musubi-settlement), and settle core v0 itself: the text, the notes, the 128 vectors, run_reference.py and
  exercise_inputs.py, byte for byte from the repository (VENDORED.json). `musubi-verify --settle-core` runs the 128
  vectors and the exercised inputs, with no clone: "128/128 vectors agree with the reference; EXERCISE.txt agrees".
- The cA2A companion's settler (companion_v0, companion_v0_1, pilot_v0) and the #51 set 2 run of 22 October.
  `musubi-verify --pilot51-set2` recomputes its settlement and checks the published sha256 (`18a19f8a...`). It needs
  the new extra `nenrin-verify[ca2a]` (ca2a-runtime 0.4.0, Python 3.11 or later); without it the command says what is
  missing and exits 3.
- `musubi-verify --selftest` now also runs the self-tests of the five added modules.

## 0.6.0 (2026-10-22)

- TSUGI witness draws v2.4 (`nenrin_verify.tsugi`, verifier 0.4.0), red team R2-1 and R5-F1, fixed in horizon-shield
  3252f5ea: a draw carries its request body and requested k, a v2 commitment fixes the subject, the pool and k before
  the beacon, and observations made before their request or before the beacon block time are not counted. New refusal
  codes `draw_request_mismatch`, `draw_request_unbound`, `draw_k_mismatch`, `commitment_pool_mismatch`,
  `commitment_k_mismatch`, `witness_before_request`, `witness_before_beacon`, `request_before_beacon`; options
  `--require-v24` and `--beacon-time`. Draws in the v2.2 form still verify and are marked in `segment.witness.forms`.
  The port prints the same bytes as `tsugi_verify.mjs` on all 117 frozen cases, the 15 v2.4 attack and control cases
  included. The vendored `recovery-v0/recovery_verify.py` is the repository's at 3252f5ea.
- npm and PyPI carry the same version number from this release (npm 0.5.4 had no JavaScript change to follow 0.5.5 to 0.5.7).

## 0.5.7 (2026-10-21)

- `nenrin-track`: whether a door's signed admissions, in a [nenrin mirror](../mirror-v0) you hold, form one history
  (fork, broken link, an admission anchored more than four days after the height it names, gaps), under keys you pin
  as `<base64 key>@<key_url>`. The repository's `track-v0/track.py` and its ten vector mirrors, byte for byte;
  `nenrin-track --selftest` reproduces every vector's report. The Go port `nenrin-track-go` (sdk-go v0.3.0) prints the
  same report. See [track-v0](../track-v0).
- MUSUBI: `immune_v0` (the immune rules, a2a-immune-v0) is now shipped, so `musubi-verify immune_v0 --selftest` runs
  from the package, and the admission verifier with the immune block (`admission_verify_v0`, admission v0.2) is the
  one in the repository at d79c052a. 27 modules.

## 0.5.6 (2026-10-18)

`nenrin-tsunagi run` (with npm 0.5.4): when the command under test exits non zero, the last printed line now ends with
"; not a pass: the command exited <code>" instead of only the count, so a reader who stops at the last line does not
take a failing run for a pass (piiiico, aeoess/agent-governance-vocabulary#177). The exit status, the scores and the
board are unchanged. Verifiers and corpora are unchanged (verifier_version 0.1.7).

## 0.5.5 (2026-10-15)

Verifier change (verifier_version 0.1.7, with npm 0.5.3): a record's own `"__proto__"` key stays in its preimage. The
JS reference copied records with `Object.assign({}, rec)`, which drops that one own key, and `_without` here called
`_js.assign` to emulate exactly that, so a signed grant, receipt or intent with `"__proto__": {...}` added after
signing recomputed to its stored id and was accepted (pipavlo82, #29). `_without` now takes the record's own items
minus the derived keys, nothing else. `nenrin-tsunagi` carries `nenrin-interop-v0.3-own-proto` (7 cases): the key
added to each of the three records after signing, and an ordinary key added the same way as the control; this port
gives 7/7. The other corpora and the 31 parity bundles give the same signatures as before.

## 0.5.4 (2026-10-13)

`nenrin-tsunagi` carries two more provenance corpora. `nenrin-interop-v0.3-survivors` (9 cases,
`interop-v0.3/survivors/` in the repository) is new: a mutation-adequacy measurement
(`conformance-v0/adequacy-v0/REPORT.md`) found that 8 of 13 declared verifier faults survive the 93 frozen
provenance fixtures, and these nine vectors (one per survivor, plus the clean pair they change) kill all 13. They pin
the refusal of a tampered or wrongly signed grant, a stored grant_ref or receipt_id that does not recompute, a
receipt naming another grant or signed by an unauthorized provider, an hour-24 timestamp and an execution after
not_after. `nenrin-interop-v0.2-action-presence` (9 cases, kuangmi-bit) was registered after 0.5.3 and ships on PyPI
for the first time. Both are vendored byte for byte under `_repo/`, pinned in VENDORED.json and named in the package
data. This port reproduces 9/9 of each; the verifiers are unchanged. The claim stops at the declared faults: a kill
shows one outcome moving under one substitution, not that a verifier is correct.

    nenrin-tsunagi run nenrin-interop-v0.3-survivors -- "python3 my_verifier.py {in} {out}"

## 0.5.3 (2026-10-10)

Identifiers and hashes with a trailing newline are refused. Python's `$` also matches before one final newline, so
`"<32 hex>\n"` passed several patterns in the Python verifiers while the JavaScript ones refused it. The agreement
verifier now reads `\Z` in its domain label, timestamp, hex and currency rules (before this, the Python port accepted
the domain `"shop\n.example.com"` and the JavaScript reference did not), and so do the MUSUBI contract door, the
admission record verifier and their JavaScript twins. The 5,286 agreement vectors, run0002, the outside parties'
contract d7118f28 and every MUSUBI self-test give the same results as before.

One pattern is left as it was, on purpose: the approval nonce in `clause_eval_v0.py`, which every admission names by
sha256 and which follows babyblueviper1's approver reference. Its JavaScript twin now reads it the same way, so the two
runtimes agree; a stricter nonce belongs in the next approval version, agreed with the reference's author.

## 0.5.2 (2026-10-10)

Admission records (`a2a-admission-v0`) can be checked from the package. A relying party may decide, at its own door and
before an action, whether the action is inside the grant both parties signed, and sign that decision. This release
carries the side that checks such a record afterwards, not the side that decides:

- `musubi-verify admission_verify_v0`: the record's canonical bytes, the relying party's signature with its key on its
  own domain, the action digest, the signed action request and the principal's revocation record. Its self-test holds
  it to its JavaScript twin (`admission_verify_v0.mjs`, shipped beside it) on the same records.
- `musubi-verify settle_v1_11`: when a contract requires admission before execution, every execution must name an
  admission that said admit, for the same action digest, anchored before the execution; an admission outside the
  grant is reported as such.
- `musubi-verify settle_v1_12`: `grant.limits` (a maximum amount per action, in the bytes both parties signed) is read
  against the amount each execution states.
- `contract_v0` accepts `grant.limits` only with `requirements.admission`, typed, and a delegated grant may only lower
  it. `clause_eval_v0` has the clause `over_limit`.

A contract without `requirements.admission` and without `grant.limits` settles byte for byte as under v1.10 (run0002,
the outside parties' contract d7118f28 and the 18 scenario corpus). The fixtures the new self-tests read ship with
them and are pinned by `fixtures/ADMISSION_FIXTURES.sha256`. The other verifiers are unchanged.

## 0.5.1 (2026-10-09)

`nenrin_verify.trace_pin` (`nenrin-trace-pin`): pin a TRACE Trust Record to the NENRIN ledger in one command and check
it later. `nenrin-trace-pin trace.json` is a dry run (local intake, nothing sent); `--yes` pins it, and the record
becomes public; `nenrin-trace-pin status <sha>` reports pending or anchored and recomputes the sha256 of the bytes the
ledger serves. A record the ledger would refuse is refused locally first, and the ledger's answer must name the sha
computed here. `--ledger <origin>` names another service with the same contract. The JavaScript twin is
`npx -p nenrin-verify nenrin-trace-pin`. The verifiers are unchanged.

## 0.5.0 (2026-10-09)

`nenrin_verify.trace` (`nenrin-trace-verify`): the TRACE intake rule of the NENRIN ledger, the `nenrin-trace-bind-v0`
link between a NENRIN or MUSUBI record and a TRACE Trust Record, and the OpenTelemetry helpers (`span_attributes`,
`annotate_span(span, bind)` for an opentelemetry-api span, `check_span_attributes`). A port of `trace_verify.mjs`,
held to it by the corpora trace-intake-v0, trace-bind-v0 and trace-span-v0, which `nenrin-tsunagi` now carries too.
`nenrin-tsunagi run` writes each fixture's exact bytes into the batch, as the JavaScript referee always did: it used
to re-serialise parsed fixtures, which cannot write back a lone surrogate or a literal like `1e400`, exactly what
trace-intake-v0 tests. The other verifiers are unchanged.

## 0.4.9 (2026-10-08)

`nenrin-tsunagi`: the TSUNAGI board's referee, with interop-v0 (5), interop-v0.1 (13) and interop-v0.2/edge (36)
vendored byte for byte under `_repo/` and pinned in VENDORED.json. `run` writes the batch, runs your command and
scores it; `score` scores an output you already have; `row` prints the board entry for your pull request. The
verifiers are unchanged.

## 0.4.8 (2026-10-06)

`musubi-verify --selftest` prints each module's own wall time next to its result. @pipavlo82 completed the full 0.4.7
run on Windows 11 (Python 3.12.10, Node 22.15.0): 22/22, exit 0, 25 nested self-tests reused, 1596 s, against 2 s on
Linux here. Neither of us can say yet where the Windows time goes; the per-module column is what tells it. Nothing
else changed.

## 0.4.7 (2026-10-05)

`musubi-verify --selftest` runs the 22 MUSUBI modules lower layers first and lets a nested self-test reuse the exact
result (exit code, stdout, stderr) of the same command when it already passed earlier in the same run. Most settle
self-tests end by running the self-test of the layer below, so the all-modules run used to repeat the lower layers many
times; it was too slow to finish on Windows (reported by @pipavlo82 in Issue #29). Measured here: 32 s before, 2 s
after, 22/22 either way. A module that failed is never reused, any other command runs for real, and the repository's
files are untouched (three are fingerprinted by correction_v0). A module run on its own (`musubi-verify settle_v1_10
--selftest`) still runs every layer under it, and `musubi-verify --selftest --no-reuse` runs every nested self-test
again. Checked against a broken settle_v1_8: v1.8, v1.9 and v1.10 all fail with reuse on, as they should.

## 0.4.6 (2026-10-05)

`canonical_v0.mjs`, the Node twin that contract_v0 uses to confirm its canonical bytes, decided whether it was the main
module by comparing `import.meta.url` with `"file://" + process.argv[1]`. On Windows that string never matches, so the
twin printed nothing and the contract_v0 self-test failed in a clean Windows venv (reported by @pipavlo82 in Issue #29,
Node 22.15.0). It now compares against `pathToFileURL(realpathSync(process.argv[1])).href`, which also holds when the file
is reached through a symlink. Its `--vectors` mode also reads canonical_vectors.json as published (`{rule, note,
vectors}`); before, it expected a bare list and threw. No canonical rule and no settlement rule changed.

The Python and JavaScript packages are versioned together where they share a verifier: compare Python 0.4.5 or 0.4.6
with npm nenrin-verify 0.4.4, not with an older npm pin. 0.4.5 and 0.4.6 change only MUSUBI, which has no JavaScript
twin in the npm package.

## 0.4.5 (2026-10-05)

MUSUBI settle v1.8, v1.9 and v1.10 now ship with the package, byte for byte from the repository, with what they need:
convergence_v0 and recovery-v0/recovery_verify.py (v1.9), and babyblueviper1's approver vectors (v1.10, CC0 vectors and
MIT code, their LICENSE included). `musubi-verify settle_v1_10 --selftest` runs from a plain venv, and
`musubi-verify settle_v1_10 --settle contract.json --event exec.json --view view.json` settles a contract whose
conditional actions require a pinned approver. The v1.10 self-test gained the rest of the approval lifecycle asked for
in Issue #29: a repeatable approval covering two executions, an approval for one action carried with another, and an
approval past valid_until_height. No settlement rule changed.

## 0.4.2 (2026-10-04)

Every signature check in this package now accepts a key only if it is the canonical encoding of a point of the
prime-order subgroup. A small-order Ed25519 key (the identity point, for example) verifies R = identity, S = 0 on
every message with no private key, and a mixed-order key (a real key plus a small-order point) lets one private key
pose as a second key; both are refused everywhere this package checks a signature: `provenance.did_key_resolver`
(verifier_version 0.1.5, in step with nenrin_verify.mjs), `tsugi` (verifier 0.3.1, in step with tsugi_verify.mjs),
`a2a_recorder.verify_payload` and the record check in `policy` (`provenance.ed25519_key_ok`). The base64 rule of
0.4.1 now covers them all too (`provenance.b64_exact`), and a TSUGI witness key counts once toward a quorum. The
frozen corpora were regenerated from the JavaScript files; no verdict changed. The agreement verifier is unchanged;
it already applied the same subgroup rule.

## 0.4.4 (2026-10-04)

Malformed records (a record slot or list element that is present but not an object, and not null/false) are refused
in their own step with reason record_not_object and are otherwise not presented, in step with verifier_version 0.1.6
(see the npm SDK.md and VERIFIER.md section 5). Before, the port threw on a non-object observation, as the JavaScript
did. No frozen verdict changed.

## 0.4.3 (2026-10-04)

A witness pool with a key that is not canonical base64 of a usable key is bad_pool, and an operator key passed to
`tsugi-verify` that is not a usable key is a usage error (exit 2, no report), as in the JavaScript command. Four frozen
TSUGI cases added (102 in all); no existing verdict changed.

## 0.4.1 (2026-10-04)

Two rules made strict in step with the JavaScript verifier (verifier_version 0.1.4, see the npm SDK.md): a timestamp
must be a real calendar instant (no 2026-02-30, no hour 24, no year 0000), and a signature field must be canonical
standard base64. The frozen parity corpus was regenerated from the JavaScript file; two bundles that pinned the old
lenient date reading are now refused with invalid_timestamp.

## Where the claim stops

- **Stack depth.** A document nested deep enough to exhaust a runtime's stack has no report in that runtime, and
  Node and Python run out at different depths (Node threw at 3,000 nested arrays inside a signed field, Python's
  default limit is 1,000). Real bundles are a few levels deep.
- **Sixty-four or more non-numeric `hop.seq` values in one bundle.** The order of those keys is V8's merge sort over
  a comparator that cannot order them; the port reproduces V8 for up to 63 keys and raises above that instead of
  guessing.
- Where the JavaScript throws, the port raises; the CLI then prints no report and exits 2 (Node exits 1 on an
  uncaught throw).
- **TSUGI: hosts that need UTS #46.** The verifier compares and prints URL hosts as WHATWG `new URL(s).host` gives
  them. The port follows the standard for ASCII hosts, IPv4 in every form the standard reads, ports and userinfo,
  and raises `NotReproduced` (no report, exit 2) for a host that is not ASCII after percent-decoding or has an
  `xn--` label, an IPv6 literal, or a `file:` URL. Lowercasing a code point this Python's Unicode tables do not
  assign raises the same way (Node 24 knows Unicode 16; Python 3.9 knows 13).
- **TSUGI: one refusal text depends on the Node release.** For an Ed25519 public key that is not 32 bytes, Node 24
  writes "Invalid keyData" and Node 22 "Ed25519 raw keys must be exactly 32-bytes". The port writes Node 24's
  (`tsugi.KEY_LENGTH_MESSAGE`); the tests compare Node 22's output after that one substitution.
- **TSUGI: `--fetch-operator-key`** makes the same request as the JavaScript (GET `<origin>/keys/operator.json`,
  404 read as no key) but is not part of the comparison, which runs offline.

## What it does not establish

What every report says itself, accepted or refused: a signature proves who asserted, not that the assertion is
true; E1 compares a provider's signed claim to a caller's signed authorization and has no side-effect oracle;
R1 proves a witness is structurally distinct from the parties, not unaffiliated with them. There is no score and
no allow or deny anywhere in this package. The decision belongs to whoever reads the evidence.

MUSUBI is the one part held to no second implementation, because there is none: its Python is the reference.
`musubi.load(name)` puts the two vendored directories at the front of `sys.path`, since that is how the modules
find each other (by bare name, as in the repository).

## Reproduce

    cd workers/hs-ledger/nenrin/sdk-python
    pip install -e . pytest
    node tests/fixtures/make_fixtures.mjs --check   # the frozen fixtures re-create byte for byte
    python tests/fixtures/make_tsugi_cases.py --check   # the frozen TSUGI cases and their JavaScript output re-create
    python tools/vendor.py --check                  # the agreement and MUSUBI copies are their sources
    pytest tests -q -s                              # frozen, live differential, agreement, TSUGI, MUSUBI

Published from GitHub Actions with PyPI Trusted Publishing and attestations
(`.github/workflows/pypi-publish-nenrin-verify.yml`); the parity suite runs on every change to this directory,
to the JavaScript SDK, to the agreement verifier, to the TSUGI chains and to MUSUBI
(`.github/workflows/nenrin-verify-py.yml`).

MIT. The HORIZONs Co., Ltd.

## Citing
Oga, T. (2026). NENRIN provenance verifier: normative procedure (VERIFIER.md), interoperability vectors and reference verifiers (nenrin-verify 0.4.4). Zenodo. https://doi.org/10.5281/zenodo.23136978

The deposit holds the verification procedure (VERIFIER.md), the interoperability vectors and this package as published.
