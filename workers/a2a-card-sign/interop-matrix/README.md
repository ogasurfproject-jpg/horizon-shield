# A2A Agent Card signing: interop matrix

Every official A2A SDK signs, every official A2A SDK verifies, on the same cards. Run on 2026-10-01 with
a2a-sdk 1.2.1, @a2a-js/sdk 1.3.0 and a2a-go main 534a60fc (2026-09-30) (a2acrypto copied verbatim apart from one import path; upstream
sha256 in `go/UPSTREAM_SHA256.txt`, licence in `go/UPSTREAM_LICENSE`).

## Result

| case | python signs, python verifies | python signs, js verifies | python signs, go verifies | js signs, python verifies | js signs, js verifies | js signs, go verifies | go signs, python verifies | go signs, js verifies | go signs, go verifies |
|---|---|---|---|---|---|---|---|---|---|
| `control` (no field at its default value) | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| `empty_description` (description = "" (REQUIRED)) | pass | pass | FAIL | pass | pass | FAIL | FAIL | FAIL | pass |
| `empty_skills` (skills = [] (REQUIRED)) | pass | pass | FAIL | pass | pass | FAIL | FAIL | FAIL | pass |
| `empty_skill_tags` (skills[0].tags = [] (REQUIRED on AgentSkill)) | pass | pass | FAIL | pass | pass | FAIL | FAIL | FAIL | pass |
| `empty_extensions` (capabilities.extensions = [] (not REQUIRED)) | pass | pass | FAIL | pass | pass | FAIL | FAIL | FAIL | pass |
| `nested_empty_security` (securityRequirements = [{}] (not REQUIRED, nested empty)) | pass | pass | FAIL | pass | pass | FAIL | FAIL | FAIL | pass |

The served card is the case JSON exactly as written, with the signer's signature appended. Each verifier reads that JSON the way its SDK reads a card.

**Python and JS agree with each other on every case. Go agrees with neither as soon as the card holds any empty value**, REQUIRED or not.

## The specification's own example (A2A section 8.4.1)

Input: `{"name":"Example Agent","description":"","capabilities":{"streaming":false,"pushNotifications":false,"extensions":[]},"skills":[]}`

| | canonical form | matches the specification |
|---|---|---|
| specification | `{"capabilities":{"pushNotifications":false,"streaming":false},"description":"","name":"Example Agent","skills":[]}` | |
| a2a-python | `{"capabilities":{"pushNotifications":false,"streaming":false},"name":"Example Agent"}` | no |
| @a2a-js/sdk | `{"capabilities":{"pushNotifications":false,"streaming":false},"name":"Example Agent"}` | no |
| a2a-go | `{"capabilities":{"extensions":[],"pushNotifications":false,"streaming":false},"description":"","name":"Example Agent","skills":[]}` | no |

None of the three reproduces the worked example. Python and JS drop the REQUIRED `description` and `skills`; Go keeps the non-REQUIRED `capabilities.extensions`.

## Frozen production card

`../interop-go/fixtures/gate_card_20260928.json` (sha256 `2df33ff120745a7f...`, JS-signed with two signatures, key set sha256 `692fd49da681cc0d...`) verifies in all three: python pass, js pass, go pass (Go accepts signature 0, the plain RFC 8785 one). It has no empty value, which is why it does not show the split above.

## Pair: an empty oneof member (`empty_oneof_mtls`)

Two cards that differ in one declaration, reported on a2aproject/a2a-python#1278. The declared card is `control`
plus `"securitySchemes": {"mtls": {"mtlsSecurityScheme": {}}}`. That is a set oneof member whose message is empty.
The other card is `control` itself. Neither card carries `securityRequirements`, so the scheme is the only difference.
Measured on 2026-11-17 with a2a-sdk 1.3.0, @a2a-js/sdk 1.3.0 and a2a-go main 6b0c5bd4.

| SDK | declared card, canonical | `control`, canonical | same bytes | declaration in canonical form |
|---|---|---|---|---|
| a2a-python | 434 bytes, sha256 `d2988a6544f23a9f` | 434 bytes, sha256 `d2988a6544f23a9f` | yes | removed |
| @a2a-js/sdk | 434 bytes, sha256 `d2988a6544f23a9f` | 434 bytes, sha256 `d2988a6544f23a9f` | yes | removed |
| a2a-go | 487 bytes, sha256 `98981f208c94def0` | 434 bytes, sha256 `d2988a6544f23a9f` | no | kept |

| served card, signature | python signs, python verifies | python signs, js verifies | python signs, go verifies | js signs, python verifies | js signs, js verifies | js signs, go verifies | go signs, python verifies | go signs, js verifies | go signs, go verifies |
|---|---|---|---|---|---|---|---|---|---|
| declared card, signature over it | pass | pass | FAIL | pass | pass | FAIL | FAIL | FAIL | pass |
| `control`, signature over the declared card | accepts | accepts | accepts | accepts | accepts | accepts | rejects | rejects | rejects |
| declared card, signature over `control` | accepts | accepts | rejects | accepts | accepts | rejects | accepts | accepts | rejects |

In a2a-python and @a2a-js/sdk both cards canonicalize to the same 434 bytes.
a2a-go keeps the empty member, so its canonical form of the declared card is 53 bytes longer.
Every cell above follows one rule: a verifier accepts when the signer's canonical bytes equal its own.
The pair is kept out of the six cases, so the corpus and the comparison with `results_20261001.json` do not change.

## The key

`testkey_jwks.json` (kid `hs-interop-test-v1`) is a test key derived from a public phrase in `matrix.py`, so anyone can re-create the private key and re-run every row. It signs test vectors only and is nobody's production key.

## Run

    pip install -r requirements.txt
    npm install
    (cd go && go build -o interop-go .)
    A2A_GO_COMMIT="a2a-go <commit>" python3 matrix.py

`out/` receives each case, each signed card and `results.json`. This directory's `results_20261001.json` is the run above.

## Signed vectors (`vectors/a2a-card-sign-v01/`)

`vectors.py` turns the matrix into a language-neutral corpus: the control card signed by a reference signer and by
each SDK, and each default-valued case signed once per distinct canonical form, tagged with the readings
(`rule-1-as-written`, `prune-empty`, `served-as-is`) it is accepted under. It is Layer C next to a2a-jcs-v01
(a2aproject/a2a-tck#228) and a2a-jcs-rule1-v01 (a2aproject/a2a-tck#245). Reference signatures are RFC 6979
deterministic, so a fresh run reproduces them byte for byte. Run after `matrix.py`:

    (cd jcs-go && go mod tidy && go build -o jcs .)
    JCS_GO_BIN=$PWD/jcs-go/jcs python3 vectors.py

`JCS_GO_BIN` is optional; when set, every canonical form is checked against gowebpki/jcs v1.0.1 as well.
`vectors_s2.py` (a REQUIRED field absent), `vectors_s3.py` (fields outside the schema) and `vectors_s3_transition.py` (one card signed over both s3 forms) add groups s2 and s3 on top,
leaving earlier files untouched; `PY1287` names a virtualenv with a2a-python at #1287 installed.

## Watch (`watch.py`, `.github/workflows/interop-matrix-watch.yml`)

Every morning the workflow looks up the newest a2a-sdk on PyPI, @a2a-js/sdk on npm and a2a-go `main`. When any of
them differs from the last recorded run, it installs exactly those versions, takes a2a-go's `a2acrypto` afresh at
that commit (`go/refresh_upstream.sh`, unchanged apart from one import path), runs `matrix.py` and `watch.py`, and
records the result as one comment on the public issue labelled `interop-watch`. Each comment says which matrix
cells moved since `results_20261001.json`, whether each SDK reproduces the section 8.4.1 example, whether the frozen
production card still verifies, and which reading (`rule-1-as-written`, `prune-empty`, `served-as-is`) each
verifier follows on the signed corpus. From 2026-11-17 each comment also carries the pair tables above. They are
not in the 2026-10-01 run, so they are shown as measured and never counted as moved cells. A release that breaks one of the tools is recorded as not measured, with the
log, and nothing is concluded from it. The workflow writes nothing to the repository.

    python3 matrix.py && python3 watch.py      # the same, locally, for the installed versions

## What this does not establish

- Which canonical form is right beyond the specification text; the question of how REQUIRED fields at their default value are represented is open in a2aproject/A2A#2122.
- Anything about cards served by other implementations.
- That a passing row means the card is trustworthy; it means one SDK accepted another SDK's signature over the same JSON.
- Whether a canonical form should keep a set oneof member whose message is empty. That question is open on a2aproject/a2a-python#1278.
- Anything about other oneof members, other empty messages or cards that also carry `securityRequirements`. The pair covers one scheme on one card.
