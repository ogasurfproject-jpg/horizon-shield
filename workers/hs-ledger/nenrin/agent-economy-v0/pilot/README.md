# agent-economy-v0 pilot

The closed-pilot mechanism for PROTOCOL_v1, in code and tested. Deterministic: given the evidence,
the same RDA comes out, and every fail-closed stop holds. It moves no money and holds no funds.

## Files (and the PROTOCOL step each serves)
- recipe.mjs    the split: execute is the residual, connect a 500 bps pool across N=2 slots with the G4 decay, operate 300. S7.
- rda.mjs       recursive key-sorted canonical bytes, rda_id = SHA-256 of them, fail-closed validate, the G2 nullifier spent-set. S7, S8.
- evidence.mjs  adapts the real anchored records: delegation to roles, agreement to gross, the drawn witness verdict, the settlement tier (G5). Section 2.
- history.mjs   the G4 prior_count per connector-executor pair, and the G6 per-principal connect governor.
- issuer.mjs    the deterministic issuer: verdict pass, settlement Tier A, witness independent (W3), G4 decay, G6 fold, build, validate; toJidecSeed for the anchor. S7, S8.
- run.mjs       the live runner: reads the delegation chain and the agreement from the ledger, picks the drawn witness, takes the settlement receipt, emits the RDA and the JIDEC seed. Ties S4 to S8.

## Run it (live)
    node run.mjs --ledger https://ledger.horizonshield.dev --task <task_id> \
      --agreement <agreement_sha256> --settlement receipt.json \
      [--witness-id <id>] [--operate-to <principal>] [--recipe-committed-at <iso>] \
      --out rda.json --seed rda_seed.json
    zsh ../../../append_witness.sh rda_seed.json     # S8 anchor, the operator's hand

It reads GET /witness/task?task_id=.. for the delegation set and GET /agreement/<sha> for the terms.
The settlement receipt is a local JSON ({ ref, signer_kind, customer_ref, settled_at }); only
signer_kind payer_principal, psp or escrow is Tier A and settles (G5).

## Offline
    node --test        # the pilot suite plus the runner, no network

## The boundary (not code here)
S0 enrol and KYC (I1, I3), S3 the escrow that funds the witness fee (W2), and S6 the real settlement
receipt touch accounts, contracts and identity, not this repo. The pilot runs over contracted
principals where I1 and I3 hold by agreement; opening the network to uncontracted principals is v2
(SPEC_v1 section 5, PROTOCOL_v1 section 5). The irreducible floor, reciprocal collusion between
genuine distinct principals and off-ledger bribery of a witness, is out of scope by that
construction, stated in the open and not claimed closed.
