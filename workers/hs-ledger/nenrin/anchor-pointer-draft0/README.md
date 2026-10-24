# Anchor pointer draft 0: vectors from JIDEC entries 120 and 142

Three pointers in the form of [anchor pointer draft 0](https://github.com/aos-standard/catalog/tree/a348d35/docs/runs/anchor-pointer-draft0) (aeoess/agent-governance-vocabulary#217), built from two real entries of the JIDEC ledger (https://ledger.horizonshield.dev). The anchored bytes and the OpenTimestamps proofs travel as base64 in `blobs`, with their sha256 in `blob_sha256`.

| vector | entry | claimed height | expected |
|---|---|---|---|
| HS-120-972141 | 120 | 972141, the earliest of two attestations in the proof (the tight bound) | anchored |
| HS-120-972145 | 120 | 972145, the later attestation in the same proof | anchored |
| HS-142-972686 | 142 | 972686, one attestation | anchored |

`run_output.txt` is `anchor_pointer_check.py` from aos-standard/catalog at `a348d35` (sha256 `85ad3f966c767595ca70a60489eacda83aac6dda3af32867fe24e5c06c8d170e`), run unchanged over `vectors.json` on 2026-10-24: 3/3. That reader is not ours; these vectors are.

Entry 120 is the case for the tight bound: one proof reaches two blocks, both pointers are anchored, and the earliest height says the most.
