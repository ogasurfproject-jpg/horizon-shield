#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
loss-bound-v1: how much one admitted call, and the calls of one day, can move under a contract that binds the payload
(2026-11-09).

loss-bound-v0 (loss_bound_v0.py) reads a contract of a2a-contract-v0 before grant.payload_schema existed: for every action
the grant lets run, open_fields is "payload_unbound" and finite is false. v0 is not changed; its records stay what they
were, and settle v1.21 keeps reading it. v1 is a new record with a new schema name. It reads two grant keys v0 does not:

  grant.payload_schema[action]  (payload-schema-v0, contract_v0.py): the closed shape of the payload. open_fields is the
                                list of its free text fields by name, ascending ([] when it has none); "payload_unbound"
                                when the grant sets no schema for the action.
  grant.exposure[action]        {window_blocks, max_acts}: at most max_acts admitted calls in any window_blocks blocks.

    {"schema": "loss-bound-v1",
     "contract_sha256", "action", "class", "amount_max", "unit", "actions", "holds", "window":   as in loss-bound-v0,
     "open_fields":  "payload_unbound" | [] | [field name, ...] (ascending),
     "terms_window": {"window_blocks", "max_acts"} from grant.exposure[action], or null,
     "day_blocks":   144, the number of blocks read as one day (a constant written into the record),
     "calls_day":    max_acts x ceil(day_blocks / window_blocks) from terms_window; 0 when the action does not run; null without terms_window,
     "l_day":        amount_max x calls_day when finite and calls_day is an integer; 0 when the action does not run; else null,
     "l_day_policy": the same from window (the door's published policy), a reference value; 0 when the action does not run,
     "bounds":       "amount",
     "finite":       true | false}

The rule for finite is v0's: true when the class is prohibited or unauthorized (nothing runs, amount_max 0), or when
amount_max is an integer and open_fields is []. A payload_schema with no free text field is what makes open_fields []. finite
speaks of the amount one admitted call can state, in the grant's unit ("bounds": "amount"); it does not say that what a
call carries is harmless. l_day adds how often: it is an integer only when the contract signs both the amount and the count.
l_day_policy reads the door's policy, which the parties did not sign and the door can change, so finite never rests on it.

One day is 144 blocks, not a calendar day: blocks come about every ten minutes on average, and the door counts by block
height. How many blocks fall in one calendar day varies.

L is computed from the contract's grant and the door's published policy alone, without the content check's answer. That a
payload fitted the schema is checked by the relying party's door (contract_v0.payload_problems); this record reads what the
contract says, not what the door did.

loss_bound_v1.mjs is the same function in JavaScript; the self test runs both over the same inputs and compares the
canonical bytes.

  python3 loss_bound_v1.py --selftest
  python3 loss_bound_v1.py --contract contract.json --action report [--policy policy.json]
"""
import argparse, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from contract_v0 import canonical, contract_sha256, parse_strict, payload_schema_problem, open_fields as schema_open_fields, payload_problems
from clause_eval_v0 import classify_action, limit_for
from loss_bound_v0 import granted_actions, window_of, PAYLOAD_UNBOUND, RUNS, _int

SCHEMA = "loss-bound-v1"
KEYS = ("schema", "contract_sha256", "action", "class", "amount_max", "unit", "actions", "open_fields", "holds", "window",
        "terms_window", "day_blocks", "calls_day", "l_day", "l_day_policy", "bounds", "finite")
DAY_BLOCKS = 144
BOUNDS = "amount"


def _grant(contract):
    return contract.get("grant") if isinstance(contract, dict) and isinstance(contract.get("grant"), dict) else {}


def schema_of(contract, action):
    """grant.payload_schema[action] when it is a well formed payload-schema-v0 object, else None"""
    ps = _grant(contract).get("payload_schema")
    s = ps.get(action) if isinstance(ps, dict) else None
    return s if s is not None and payload_schema_problem(s) is None else None


def terms_window_of(contract, action):
    """grant.exposure[action] as {"window_blocks", "max_acts"} when both are in range, else None"""
    ex = _grant(contract).get("exposure")
    w = ex.get(action) if isinstance(ex, dict) else None
    if not (isinstance(w, dict) and _int(w.get("window_blocks")) and w["window_blocks"] <= 4320 and _int(w.get("max_acts")) and w["max_acts"] <= 100000):
        return None
    return {"window_blocks": w["window_blocks"], "max_acts": w["max_acts"]}


def calls_in(w, day_blocks=DAY_BLOCKS):
    """at most how many calls any day_blocks blocks can hold under the window w: max_acts x ceil(day_blocks / window_blocks)"""
    return w["max_acts"] * (-(-day_blocks // w["window_blocks"]))


def loss_bound(contract, action, policy=None):
    """the loss-bound-v1 record of one call of `action` under `contract`, with the door's published `policy` when given"""
    kind = classify_action(contract, action)
    lim = limit_for(contract, action)
    unit = lim[1] if lim is not None and isinstance(lim[1], str) else None
    tw, win = terms_window_of(contract, action), window_of(policy, action)
    if kind in RUNS:
        amount_max = lim[0] if lim is not None else None
        s = schema_of(contract, action)
        opened = schema_open_fields(s) if s is not None else PAYLOAD_UNBOUND
        finite = _int(amount_max, 0) and opened == []
        calls_day = calls_in(tw) if tw is not None else None
        l_day = amount_max * calls_day if finite and calls_day is not None else None
        l_day_policy = amount_max * calls_in(win) if finite and win is not None else None
    else:
        amount_max, opened, finite, calls_day, l_day, l_day_policy = 0, [], True, 0, 0, 0
    return {"schema": SCHEMA, "contract_sha256": contract_sha256(contract), "action": action, "class": kind,
            "amount_max": amount_max, "unit": unit, "actions": granted_actions(contract), "open_fields": opened,
            "holds": False, "window": win, "terms_window": tw, "day_blocks": DAY_BLOCKS, "calls_day": calls_day,
            "l_day": l_day, "l_day_policy": l_day_policy, "bounds": BOUNDS, "finite": bool(finite)}


def loss_bound_bytes(rec):
    return canonical(rec).encode("utf-8")


def _window_ok(w):
    return w is None or (isinstance(w, dict) and sorted(w) == ["max_acts", "window_blocks"] and _int(w["window_blocks"]) and _int(w["max_acts"]))


def problems(rec):
    """[] when rec has the closed shape of loss-bound-v1 and every derived field follows from the others; the names of what does not otherwise"""
    if not isinstance(rec, dict):
        return ["not_an_object"]
    out = []
    if sorted(rec) != sorted(KEYS):
        return ["keys"]
    if rec["schema"] != SCHEMA:
        out.append("schema")
    runs = rec["class"] in RUNS
    if rec["class"] not in ("authorized", "conditional", "prohibited", "unauthorized"):
        out.append("class")
    of = rec["open_fields"]
    if not (of == PAYLOAD_UNBOUND or (isinstance(of, list) and all(isinstance(x, str) and x for x in of) and of == sorted(set(of)))):
        out.append("open_fields")
    if rec["holds"] is not False:
        out.append("holds")
    if rec["bounds"] != BOUNDS:
        out.append("bounds")
    if rec["day_blocks"] != DAY_BLOCKS:
        out.append("day_blocks")
    tw, win = rec["terms_window"], rec["window"]
    if not (_window_ok(tw) and _window_ok(win)):
        out.append("window")
        return out
    finite = (not runs) or bool(_int(rec["amount_max"], 0) and of == [])
    if rec["finite"] is not finite:
        out.append("finite")
    if not runs:
        want = (0, 0, 0)
    else:
        cd = calls_in(tw) if tw is not None else None
        want = (cd, rec["amount_max"] * cd if finite and cd is not None else None,
                rec["amount_max"] * calls_in(win) if finite and win is not None else None)
    if (rec["calls_day"], rec["l_day"], rec["l_day_policy"]) != want:
        out.append("l_day")
    return out


# --------------------------------------------------------------------------- self test
DEMO_V2 = os.path.join(HERE, "seki_demo_v2", "contract_unsigned.json")
RUN0003 = os.path.join(HERE, "run0003", "contract.json")
DOOR = {"exposure": {"report": {"window_blocks": 6, "max_acts": 1}}}


def _cases():
    """(name, contract, action, policy): the inputs both runtimes read in the self test"""
    PS = {"schema": "payload-schema-v0", "other_fields": "refuse", "fields": {
        "kind": {"type": "enum", "values": ["a", "b"], "required": True}, "n": {"type": "integer", "min": 1, "max": 9, "required": True}}}
    PSO = json.loads(json.dumps(PS)); PSO["fields"]["remark"] = {"type": "text", "max_chars": 64, "required": False}
    PSO["fields"]["name"] = {"type": "text", "max_chars": 64, "required": False}
    g = {"authorized_actions": ["read", "pay", "wire"], "prohibited_actions": ["wire", "delete"],
         "conditional": [{"action": "pay_large", "requires": "principal_approval"}],
         "limits": {"pay": {"max_amount": 20, "unit": "ticket"}, "pay_large": {"max_amount": 1000, "unit": "JPY"}}}
    def c(**kv):
        x = {"contract_id": "00" * 16, "grant": json.loads(json.dumps(g))}
        x["grant"].update(kv)
        return x
    rd = lambda p: parse_strict(open(p, encoding="utf-8").read())
    pol = {"exposure": {"pay": {"window_blocks": 6, "max_acts": 1}}}
    return [("v0_shape", c(), "pay", None),
            ("schema_closed", c(payload_schema={"pay": PS}), "pay", None),
            ("schema_open", c(payload_schema={"pay": PSO}), "pay", None),
            ("schema_unreadable", c(payload_schema={"pay": dict(PS, other_fields="accept")}), "pay", None),
            ("schema_no_limit", c(payload_schema={"read": PS}), "read", None),
            ("exposure_144_4", c(payload_schema={"pay": PS}, exposure={"pay": {"window_blocks": 144, "max_acts": 4}}), "pay", None),
            ("exposure_6_1", c(payload_schema={"pay": PS}, exposure={"pay": {"window_blocks": 6, "max_acts": 1}}), "pay", None),
            ("exposure_288_3", c(payload_schema={"pay": PS}, exposure={"pay": {"window_blocks": 288, "max_acts": 3}}), "pay", None),
            ("exposure_100_1", c(payload_schema={"pay": PS}, exposure={"pay": {"window_blocks": 100, "max_acts": 1}}), "pay", None),
            ("exposure_unbound", c(exposure={"pay": {"window_blocks": 144, "max_acts": 4}}), "pay", None),
            ("exposure_unreadable", c(payload_schema={"pay": PS}, exposure={"pay": {"window_blocks": 0, "max_acts": 4}}), "pay", None),
            ("policy_only", c(payload_schema={"pay": PS}), "pay", pol),
            ("conditional", c(payload_schema={"pay_large": PS}, exposure={"pay_large": {"window_blocks": 144, "max_acts": 1}}), "pay_large", pol),
            ("prohibited", c(payload_schema={"pay": PS}), "wire", pol), ("unauthorized", c(), "ship", None), ("no_grant", {}, "read", None),
            ("run0003_report", rd(RUN0003), "report", DOOR), ("run0003_audit", rd(RUN0003), "audit", DOOR), ("run0003_compare", rd(RUN0003), "compare", DOOR),
            ("demo_v2_report", rd(DEMO_V2), "report", DOOR), ("demo_v2_audit", rd(DEMO_V2), "audit", DOOR), ("demo_v2_compare", rd(DEMO_V2), "compare", DOOR)]


def _selftest():
    n = 0
    C = {name: (c, a, p) for name, c, a, p in _cases()}
    L = lambda name: loss_bound(*C[name])

    r = L("v0_shape")
    assert (r["open_fields"], r["finite"], r["terms_window"], r["calls_day"], r["l_day"]) == ("payload_unbound", False, None, None, None), r
    n += 1; print("[1] a grant without payload_schema: payload_unbound and finite false, as in v0")

    r = L("schema_closed")
    assert (r["amount_max"], r["open_fields"], r["finite"], r["calls_day"], r["l_day"]) == (20, [], True, None, None), r
    r = L("schema_open")
    assert (r["open_fields"], r["finite"], r["l_day"]) == (["name", "remark"], False, None), r
    assert L("schema_unreadable")["open_fields"] == "payload_unbound" and L("schema_no_limit")["finite"] is False
    n += 1; print("[2] payload_schema with no text field: open_fields [] and finite true (L 20); text fields are listed by name and finite stays false")

    w = {k: L(k) for k in ("exposure_144_4", "exposure_6_1", "exposure_288_3", "exposure_100_1")}
    assert [(x["calls_day"], x["l_day"]) for x in w.values()] == [(4, 80), (24, 480), (3, 60), (2, 40)], w
    assert (L("exposure_unbound")["calls_day"], L("exposure_unbound")["l_day"]) == (4, None)
    assert (L("exposure_unreadable")["terms_window"], L("exposure_unreadable")["l_day"]) == (None, None)
    n += 1; print("[3] grant.exposure: calls_day = max_acts x ceil(144 / window_blocks), l_day = amount_max x calls_day; null while the payload is open")

    r = L("policy_only")
    assert (r["window"], r["terms_window"], r["l_day"], r["l_day_policy"], r["finite"]) == ({"window_blocks": 6, "max_acts": 1}, None, None, 480, True), r
    r = L("conditional")
    assert (r["class"], r["amount_max"], r["unit"], r["l_day"], r["l_day_policy"]) == ("conditional", 1000, "JPY", 1000, None), r
    n += 1; print("[4] the door's policy gives l_day_policy only (a reference value); a conditional action reads like an authorized one")

    for name in ("prohibited", "unauthorized", "no_grant", "run0003_compare", "demo_v2_audit", "demo_v2_compare"):
        r = L(name)
        assert (r["amount_max"], r["open_fields"], r["calls_day"], r["l_day"], r["l_day_policy"], r["finite"]) == (0, [], 0, 0, 0, True), (name, r)
    n += 1; print("[5] a prohibited action or one outside the grant: L 0, l_day 0, finite true")

    for nm, c, a, p in _cases():
        assert problems(loss_bound(c, a, p)) == [], (nm, problems(loss_bound(c, a, p)))
    good = L("exposure_144_4")
    assert problems(dict(good, finite=False)) == ["finite"] and problems(dict(good, l_day=81)) == ["l_day"] and problems(dict(good, calls_day=5)) == ["l_day"]
    assert problems(dict(good, bounds="harm")) == ["bounds"] and problems(dict(good, day_blocks=100)) == ["day_blocks"] and problems(dict(good, extra=1)) == ["keys"]
    assert problems(dict(good, open_fields=["b", "a"])) == ["open_fields", "finite", "l_day"] and problems(dict(L("schema_open"))) == []
    assert problems(dict(good, schema="loss-bound-v0")) == ["schema"] and problems(dict(good, terms_window={"window_blocks": 0})) == ["window"]
    from loss_bound_v0 import loss_bound as lb0, problems as problems0
    assert problems(lb0(*C["schema_closed"])) == ["keys"] and "keys" in problems0(good)
    n += 1; print("[6] the closed shape: keys, bounds, day_blocks, the formulas for calls_day, l_day and l_day_policy, finite; v0 and v1 records refuse each other")

    r = L("run0003_report")
    assert r["contract_sha256"] == "e1fa47a049a94fd725efafa0a1d603e51a16158c58d2638d4c9052c1329109c8"
    assert (r["amount_max"], r["open_fields"], r["finite"], r["l_day"], r["l_day_policy"]) == (20, "payload_unbound", False, None, None), r
    assert L("run0003_audit")["open_fields"] == "payload_unbound"
    n += 1; print("[7] run0003/contract.json (hs-seki-demo today): report payload_unbound, finite false, no l_day")

    r = L("demo_v2_report")
    assert (r["class"], r["amount_max"], r["unit"], r["actions"], r["open_fields"], r["finite"]) == ("authorized", 20, "ticket", ["report"], [], True), r
    assert (r["terms_window"], r["calls_day"], r["l_day"], r["l_day_policy"]) == ({"window_blocks": 144, "max_acts": 4}, 4, 80, 480), r
    demo = C["demo_v2_report"][0]
    assert payload_problems(demo, "report", {"koji_type": "gaiheki_30tsubo", "teiji_kingaku": 1200000}) == []
    assert payload_problems(demo, "report", {"koji_type": "gaiheki_30tsubo", "teiji_kingaku": 1200000, "customer_name": "x"}) == ["payload_field_unknown"]
    n += 1; print("[8] seki_demo_v2/contract_unsigned.json: report finite true, open_fields [], L 20 ticket, l_day 80 per 144 blocks; "
                  "the heartbeat's report payload fits the schema, one with customer_name does not")

    twin = os.path.join(HERE, "loss_bound_v1.mjs")
    feed = json.dumps([{"name": nm, "contract": c, "action": a, "policy": p} for nm, c, a, p in _cases()])
    try:
        out = subprocess.run(["node", twin, "--cases", "-"], input=feed, capture_output=True, text=True, timeout=120)
    except FileNotFoundError:
        out = None
    if out is None:
        print("[9] node not found: the JavaScript twin was not run")
    else:
        assert out.returncode == 0, out.stderr[-400:]
        lines = out.stdout.splitlines()
        want = [nm + " " + canonical(loss_bound(c, a, p)) for nm, c, a, p in _cases()]
        assert lines == want, [(x, y) for x, y in zip(lines, want) if x != y][:2] or (len(lines), len(want))
        n += 1; print("[9] loss_bound_v1.mjs gives the same canonical bytes for all %d inputs" % len(want))

    print("\nSELF-TEST PASSED: loss-bound-v1, %d checks (no schema; a closed schema; grant.exposure; the door's window; nothing runs; "
          "the closed shape; run0003; seki_demo_v2; the JavaScript twin)" % n)


def main():
    ap = argparse.ArgumentParser(description="loss-bound-v1: L of one call and of 144 blocks, from the contract and the door's published policy")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--contract", metavar="CONTRACT.json")
    ap.add_argument("--action")
    ap.add_argument("--policy", metavar="POLICY.json", help="the door's published policy (an object with exposure)")
    a = ap.parse_args()
    if a.selftest:
        _selftest(); return 0
    if not a.contract or a.action is None:
        ap.print_help(); return 1
    rd = lambda p: parse_strict(open(p, encoding="utf-8").read())
    print(canonical(loss_bound(rd(a.contract), a.action, rd(a.policy) if a.policy else None)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
