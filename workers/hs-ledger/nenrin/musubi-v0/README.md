# MUSUBI (a2a-contract-v0)

A contract layer for agents that act on each other's behalf. Prove and price, do not enforce at runtime. HORIZON SHIELD anchors the record. It does not judge it. The settlement verdict is a function you recompute, not a decree you trust.

## Walk it yourself (no account, no key of ours, no network)

    git clone https://github.com/ogasurfproject-jpg/horizon-shield
    cd horizon-shield/workers/hs-ledger/nenrin/musubi-v0
    python3 -m venv .venv && . .venv/bin/activate
    pip install cryptography
    python3 contract_v0.py --selftest        # expect: SELF-TEST PASSED, 6 of 6

`cryptography` is the only thing you install. If you prefer not to use a venv and pip refuses with "externally managed environment", `pip install --break-system-packages cryptography` does the same.

The verifier is offline by design. There is no endpoint to trust. You run the same code the operator runs and you reach the same verdict, or you have found a bug. This is a library and a CLI, not a hosted service; nothing needs to be deployed for you to check it.

## The CLI

    python3 contract_v0.py --selftest                     # 6 of 6 self checks
    python3 contract_v0.py --verify contract.json         # verify a signed contract
    python3 contract_v0.py --sign  contract_unsigned.json --key mykey.json --domain my.domain --out contract_A.json
    python3 contract_v0.py --settle contract.json --exec execution.json   # recompute the settlement verdict

## What each self check proves
1. build + two party sign + verify: a well formed contract with two valid signatures is accepted.
2. tamper after signing: one byte changed after signing is refused.
3. overclaim in establishes: a contract that claims performance or payment or legal effect in its own terms is refused.
4. settle, compliant execution: work inside the grant settles as within_grant.
5. settle, prohibited action: an action outside the grant settles as a deviation, named.
6. delegation subset: a sub grant that widens authority beyond its parent is rejected.

## Break it
Find a contract that verifies but should not, or a settlement that recomputes to the wrong verdict. The self test is 6 of 6 today. Make it 6 of 7 and send the input that does it. A finding is worth more than a pass.

## Design
`ops/MUSUBI_a2a_contract_v0_DESIGN.md` in this repo.

The crypto primitives (canonical form, Ed25519 discipline, small order key rejection, the overclaim list) are shared verbatim with the agreement layer in `../agreement-v0/agreement_verify.py`. One source of truth. MUSUBI reuses them, it does not fork them, so the folder above must sit next to this one. That is why you clone the repo rather than download this file alone.
