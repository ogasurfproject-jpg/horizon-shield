# loss-bound-v0: what one admitted call can move (2026-11-07)

L is computed from the contract's grant and the door's published policy alone, without the content check's answer. A pass does not mean the call was harmless; a wrong pass is bounded by L. While the contract does not bind the payload, L is not finite and the record says so.

## The record

One record per call, a closed set of keys (`loss_bound_v0.py` is the reference, `loss_bound_v0.mjs` gives the same canonical bytes):

    {"schema": "loss-bound-v0",
     "contract_sha256": "<the digest of the terms>",
     "action": "<the action of the request>",
     "class": "authorized" | "conditional" | "prohibited" | "unauthorized",
     "amount_max": <grant.limits[action].max_amount, or null>,
     "unit": <grant.limits[action].unit, or null>,
     "actions": [<the actions the grant lets run, ascending>],
     "open_fields": "payload_unbound" | [],
     "holds": false,
     "window": {"window_blocks": n, "max_acts": m} | null,
     "finite": true | false}

- `class` is `clause_eval_v0.classify_action`. `amount_max` and `unit` are the grant's limit for the action, written as the grant writes them; a unit is not converted.
- `finite` is true only when the class is authorized or conditional, `amount_max` is an integer and `open_fields` is `[]`. A prohibited or unauthorized action is refused at the door: `amount_max` 0, `open_fields` `[]`, `finite` true.
- A contract of a2a-contract-v0 has no field that binds the payload of a call (its grant keys are a closed set), so `open_fields` is `"payload_unbound"` for every action the grant lets run, and `finite` is false for all of them. L is not finite until the contract binds the payload.
- `holds` is false: no record yet says that an amount was held aside before the call.
- `window` is the door's published `policy.exposure[action]`. It is the door's policy, not the terms. `amount_max` times `max_acts` per `window_blocks` is a reference value from the contract and the door's published policy together.

## Where it is written

- settle v1.21 (`settle_v1_21.py`) gives settle v1.20's verdict, status and deviations, byte for byte, and adds `loss_bound`: one record for each admit it reads (admission versions 0.1 to 0.5), the number that are finite and the number that are not.
- TOOSHI 22 (`tools/tooshi/tooshi_daily.py`) reads the admits of the SEKI heartbeat's day and writes, as a notice, how many have a finite bound and names the ones that do not. For the demonstration store hs-seki-demo the unit is the ticket, and the pilot's tickets carry no monetary value.

## Run it

    python3 loss_bound_v0.py --selftest
    python3 loss_bound_v0.py --contract run0003/contract.json --action report [--policy policy.json]
    node loss_bound_v0.mjs --contract run0003/contract.json --action report
    python3 settle_v1_21.py --selftest
