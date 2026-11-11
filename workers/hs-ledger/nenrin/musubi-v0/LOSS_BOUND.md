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

## loss-bound-v1 (2026-11-09): a contract that binds the payload

The sentence above that a contract has no field binding the payload held for every grant until 2026-11-09. Two grant keys
now exist (`contract_v0.py`, `contract_door_v0.mjs`), each requiring `requirements.admission` like `limits`:

- `grant.payload_schema[action]`, a `payload-schema-v0` object: every field of the payload named with its type (`enum`,
  `integer`, `token` of `[A-Za-z0-9._-]`, or `text`), and `"other_fields": "refuse"`. `contract_v0.payload_problems` (and
  `payloadProblems` in JavaScript) gives the codes under which a payload is refused: `payload_not_object`,
  `payload_field_unknown`, `payload_field_missing`, `payload_field_value`. A `text` field is free text and is listed as open.
- `grant.exposure[action]` = `{"window_blocks": 1..4320, "max_acts": 1..100000}`: at most `max_acts` admitted calls in any
  `window_blocks` blocks, counted by the door from its own admissions.

A child grant may narrow both, never widen or drop them. A reader older than these keys refuses such a contract
(`grant_key_unknown`), so it cannot read it the wrong way.

`loss_bound_v1.py` (and `loss_bound_v1.mjs`) writes the record `loss-bound-v1`: the fields of v0, with `open_fields` read from
the schema (`[]` when it has no text field, the text fields by name otherwise, `"payload_unbound"` without a schema), and

    "terms_window": grant.exposure[action] | null,
    "day_blocks":   144,
    "calls_day":    max_acts x ceil(144 / window_blocks), or null,
    "l_day":        amount_max x calls_day when finite, or null,
    "l_day_policy": the same from the door's policy window (a reference value), or null,
    "bounds":       "amount"

`finite` keeps the rule of v0. One day is 144 blocks, not a calendar day. finite speaks of the amount one admitted call can
state, in the grant's unit; it does not say that what a call carries is harmless. v0 and settle v1.21 are not changed.

`seki_demo_v2/contract_unsigned.json` is the next contract for the demonstration store hs-seki-demo, not yet signed: `report`
only (`audit` and `compare` prohibited), 20 tickets a call, a payload of `koji_type` (the 189 ids of `data/souba-db.json`),
`teiji_kingaku`, `region` and `orderId`, and at most 4 report calls in any 144 blocks. Under it `loss_bound_v1.py` reads report
as finite: L 20 tickets, `open_fields` `[]`, `l_day` 80 tickets per 144 blocks. Tickets in this demonstration carry no monetary
value. Its `agreed_at` is null: the parties write the time of signing into it when they sign, so the contract_sha256 of the signed
contract (`seki_demo_v2/contract.json`) is known only then.

    python3 loss_bound_v1.py --selftest
    python3 loss_bound_v1.py --contract seki_demo_v2/contract_unsigned.json --action report
    python3 contract_door_check.py
