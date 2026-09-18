# NENRIN Reference Interop Test (interop-v0)

A vendor-neutral interoperability test for the NENRIN evidence layer. It is a small set of frozen, did:key-verifiable provenance bundles, each with a canonical verdict signature. Any implementation, in any language, that reproduces these verdict signatures on these fixtures is interoperable with NENRIN evidence: it reads the same records, resolves the same keys offline, and reaches the same accept or refuse decision with the same surfaced conflicts.

There is no trust in the operator. Every fixture is self-contained: the caller, provider and witness identifiers are did:key, so the Ed25519 public keys are self-encoded and resolution needs no network and no key server.

## The five cases (fixtures/)
- pass : a clean, fully signed delegation and execution graph. Accepted.
- disagreement : two witnesses of one hop disagree. Verified true, and the disagreement is surfaced as a finding, not collapsed to the favorable verdict (R4).
- equivocation : the provider signed two conflicting receipts for one grant. Fail-closed refusal.
- forged_signature : one observation carries a tampered witness signature. Refusal.
- broken_chain : hop continuity does not hold over the presented set (R3). Refusal.

## The contract
For each fixture the verdict signature is: the verdict (accepted or refused), the sorted refusal codes, and the sorted finding codes. These are frozen in expected.json. Passing the interop test means reproducing every fixture's verdict signature. It is a behavior contract, not a byte-for-byte report contract: an implementation may phrase its report however it likes, as long as it reaches the same verdict and surfaces the same conflicts. NENRIN records evidence and surfaced conflicts; it computes no trust score and makes no allow or deny decision, and a conforming implementation holds the same line.

## Run it
With the published verifier:

    npm install nenrin-verify
    node run_interop.mjs

Or verify any single fixture directly:

    npx nenrin-verify fixtures/pass.json

run_interop.mjs verifies each fixture with ../sdk/nenrin_verify.mjs (the same single file published as nenrin-verify) and asserts it reproduces expected.json.

## Reimplement it
To claim interoperability from another implementation: verify the five fixtures in fixtures/ with your own code, resolving each did:key identifier to an Ed25519 public key, and reproduce the verdict signature for each in expected.json. That is the whole contract.

## Note
Re-running make_interop_fixtures.mjs produces NEW fixtures with fresh keys. The committed fixtures/ and expected.json are the immutable reference; run_interop.mjs is the check.
