# interop-go: does an official Go verifier accept the HORIZON SHIELD Agent Card?

Cross-SDK fixture for the Agent Card JWS (A2A 1.0 section 8.4). The card is signed on the
operator's machine by `../sign.mjs` with the official `@a2a-js/sdk` 1.1.0. On 2026-09-25
`a2aproject/a2a-go` v2.6.0 shipped its own AgentCard JWS signing and verification
(`a2acrypto`, "fixes #141", plus "a2acrypto canonicalization and refactoring (#441)").
This directory runs that Go verifier, byte for byte, against the card the gate actually serves.

## What is in here

- `a2acrypto/`: seven files copied verbatim from a2a-go **v2.6.0**, commit
  `ebf17c56ef7e63c72883a45454a538bbc0df66b8` (Apache-2.0, `UPSTREAM_LICENSE`). One line differs:
  `verify.go` imports `hs.local/cardcheck/a2a` instead of `github.com/a2aproject/a2a-go/v2/a2a`,
  so the package builds with the standard library only and no module download. Upstream sha256:

      748e6f3ca81d9e6bd5827f6aa15f11c0607f7daf97f96af7886d8473fd83e53e  canonical.go
      56b648a5bc33f14fc1bb0e1095f997ebafa13f11e31c080793d5b4f7fa3dbd73  verify.go (before the import edit)
      a6fbc56f1b7d3f8b162839e9db394457c9efa008b651728cb2d0bea4cf7f55a9  jwks.go
      e517f1534578bee2ee7c0fa7ceb6832c56ca2631bbd908dc9d7f29ae21cfbbcf  keyresolver.go
      9582b14dfad7e656a5e7282e61ea9d6c759d6753815ba0c0529cf3efdb5f0594  alg.go
      cb70cd39f0676cb4f3a06f0e0f8c2ded010c7ccb7e602c5013cb862a39044e78  ecdsa.go
      e6974cd66a82e579b6c89d1876242c14e5a5b7c8ad9d6064e785dac964fd7603  doc.go

  `a2acrypto/export_canon.go` is ours (exposes the canonical bytes). `a2a/agent.go` is a three-field
  stub of `a2a.AgentCardSignature` with the upstream JSON tags.
- `main.go`: reads a card file, prints the served bytes' sha256 and the Go canonical form's sha256,
  resolves the key from the `jku` JWKS with the upstream `JWKSKeyResolver`, and reports every signature.
- `canon_compare.mjs`: the JS side. Prints the sha256 of the two canonical forms `../sign_lib.mjs` signs over.

## Run

    curl -s https://gate.horizonshield.dev/.well-known/agent-card.json > card.json
    go run . card.json                 # Go 1.24 or newer, standard library only
    node canon_compare.mjs card.json   # needs ../node_modules (npm ci in ..)

## Result on 2026-09-26 (gate 0.4.15, served sha256 99d374405a59bbdc92f93f52e5f6c647da8db8ec06a5b851c59dc8e1880fcb8d)

    go_canonical_bytes=6852 go_canonical_sha256=d9fe9289b493f93e2d771a0fcda118cf39177baf98392a2ad299f930098aef1a
    signature[0]: PASS
    signature[1]: FAIL signature verification failed
    result: 1 of 2 signatures verify under a2a-go v2.6.0 a2acrypto

    js_sdk_canonical_bytes=6410 js_sdk_canonical_sha256=1489fe91a2d6cbd6fcc88ce40d3c929eea9597832c3044fdc2c68877907d9f75
    js_plain_jcs_bytes=6852   js_plain_jcs_sha256=d9fe9289b493f93e2d771a0fcda118cf39177baf98392a2ad299f930098aef1a
    top_level_fields_dropped_by_js_sdk=["url","protocolVersion","securityRequirements","compensation","preferredTransport"]

## What this establishes

1. The Go verifier accepts the card. `signatures[0]` verifies under a2a-go v2.6.0 with the key it
   fetched itself from the card's `jku`. The gate's card is verifiable by an official SDK that
   HORIZON SHIELD did not write.
2. Two independent implementations of RFC 8785 agree byte for byte on this card: the Go
   `canonicalizeJSON` (a2a-go) and the 6-line `jcsCanonical` in `../sign_lib.mjs` both produce
   6852 bytes with sha256 `d9fe9289...`.
3. The two official SDKs do not canonicalize the same way. `@a2a-js/sdk` 1.1.0
   `canonicalizeAgentCard` runs the card through the protobuf model first
   (`AgentCard.toJSON(AgentCard.fromJSON(card))`, then `cleanEmpty`, then JCS), which drops
   every field outside the 1.0 schema and every empty value; a2a-go v2.6.0 `canonicalizeJSON`
   takes the served JSON as is and only removes top-level `signatures`. On this card the two
   forms differ by 442 bytes, so **a signature made by the JS SDK does not verify in Go, and a
   signature made by Go over a card with any non-schema field would not verify in JS**.
   `signatures[1]` (JS SDK form) failing in Go is that divergence, not a key or encoding problem.
   The specification (docs/specification.md 8.4.1 at 72b3761b, 2026-09-25) requires, as rule 1,
   that "the JSON representation MUST respect Protocol Buffer field presence semantics" before
   RFC 8785 is applied. The JS SDK's proto round trip is rule 1; a2a-go v2.6.0 skips it. So the
   spec-conformant signature on this card is `signatures[1]`, and `signatures[0]` is the
   compatibility signature that a raw-JCS verifier such as v2.6.0 accepts.
4. The reason the gate carries two signatures since 0.4.x is exactly this: `../sign_lib.mjs`
   signs the official form and the plain RFC 8785 form with the same key. Either official SDK
   finds one it accepts. A card with only the JS SDK signature would read as unsigned or invalid
   to a Go 2.6.0 client, and an external verifier that reports "Invalid" may be doing precisely that.

## What it does not establish

- Nothing about the truth of any card field, only that the bytes served were signed by the key at the jku.
- Nothing about other Go versions or other SDKs. Re-run when either SDK changes its canonical form.
- The Go copy here is frozen at v2.6.0. Diff `a2acrypto/*.go` against the upstream tag before trusting a newer claim.

## Upstream

The divergence in point 3 is a protocol interoperability problem, not a HORIZON SHIELD one. The
issue text to file against a2aproject/a2a-go (or the spec) is in `../../../ops/a2a_go_canonical_divergence_20260926.md`.
