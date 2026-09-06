# a2a-card-sign

Agent Card signing for the HORIZON SHIELD workers, per A2A 1.0 section 8.4 (JWS ES256 over the RFC 8785 canonical form of the proto-shaped card, `signatures` excluded). The canonical form is computed by the official `@a2a-js/sdk` (`canonicalizeAgentCard`), the signature by its `generateAgentCardSignature`, and every signature is checked with its `verifyAgentCardSignature` before it is written. A card signed here verifies with the official SDKs; that is the point.

The Workers never hold the private key. Signing happens on the operator's machine, before deploy; the result is a constant between the markers `/* @@CARD_SIGNATURE_BEGIN */` and `/* @@CARD_SIGNATURE_END */` in each worker source, committed with the code. The public key is served by the worker itself at `/.well-known/jwks.json`. Signatures are attached only when the card is served at its canonical origin (custom domain); the `workers.dev` alias serves the same card without `signatures`.

What the signature covers: everything the A2A 1.0 schema knows, including `capabilities.extensions[].params`, so the compensation declaration of the Conduct Extension is bound to the publisher's key. What it does not cover: fields outside the 1.0 schema (the top-level `compensation`, `ledger`, `dataset`, the 0.3 `url` / `preferredTransport` / `protocolVersion`), because the official canonicalization drops them. A verifier that trusts the signature trusts the schema part of the card only.

## Once

```
openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out ~/.hs_card_key.pem && chmod 600 ~/.hs_card_key.pem
cd workers/a2a-card-sign && npm i
```

Keep the key outside every repository. Its loss means new signatures with a new `kid`; its leak means someone can publish a card that claims to be ours, until the `kid` is dropped from the JWKS.

## Every time a card changes (before deploy)

```
node sign.mjs --worker ../hs-mcp/src/mcp.js --origin https://mcp.horizonshield.dev --key ~/.hs_card_key.pem --kid hs-2026-09
node sign.mjs --worker ../hs-verify-gate/src/worker.js --origin https://gate.horizonshield.dev --key ~/.hs_card_key.pem --kid hs-2026-09
node sign.mjs --worker ../hs-ledger/src/worker.js --origin https://ledger.horizonshield.dev --key ~/.hs_card_key.pem --kid hs-2026-09
node sign.mjs --worker ../hs-jidec-mcp/src/worker.js --origin https://jidec.horizonshield.dev --key ~/.hs_card_key.pem --kid hs-2026-09
node sign.mjs --worker ~/hs-femtech-mcp/src/worker.js --origin https://femtech.horizonshield.dev --key ~/.hs_card_key.pem --kid hs-2026-09
```

Then commit and deploy. After deploy:

```
node verify.mjs https://mcp.horizonshield.dev
```

`verify.mjs` needs no key. Anyone can run it.

## Selftest (no key, no network)

```
node selftest.mjs
```

Signs a temporary copy of each worker with a throwaway key, serves the card, verifies it with the official verifier, and checks that a one-word change or a flipped `referral_fee` breaks the signature.

## Rotation

Generate a new key, sign with a new `kid`, deploy. The JWKS carries one key per worker as written here; to keep the old signature valid during an overlap, extend `jwksDocument()` to list both, or accept that old cached cards fail verification for the cache lifetime.
