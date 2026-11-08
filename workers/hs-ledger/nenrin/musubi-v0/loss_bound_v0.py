#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
loss-bound-v0: how much one call admitted under a contract can move, read from the contract and the door's policy (2026-11-07).

Why this file exists. An admission record says that a relying party's door let a call through, and, when the door asks
for it, what a content check answered. A content check can be wrong. What a wrong pass can cost is then set by what the
terms let the call do, not by the check. This file writes that down for one call, as a closed record:

    {"schema": "loss-bound-v0",
     "contract_sha256": the digest of the terms (contract_v0.contract_sha256),
     "action":          the action the request names,
     "class":           "authorized" | "conditional" | "prohibited" | "unauthorized"   (clause_eval_v0.classify_action),
     "amount_max":      grant.limits[action].max_amount, or null when the grant sets no limit on the action,
     "unit":            grant.limits[action].unit, or null; written as the grant writes it, never converted,
     "actions":         the actions the grant lets run (authorized or conditional, not prohibited), in ascending order,
     "open_fields":     "payload_unbound" | [],
     "holds":           false,
     "window":          {"window_blocks": n, "max_acts": m} from the door's published policy.exposure[action], or null,
     "finite":          true | false}

The rule for finite. true only when the class is authorized or conditional, amount_max is an integer and open_fields is
[]. A prohibited or unauthorized action is refused at the door, so nothing runs: amount_max is 0, open_fields is [] and
finite is true. A contract of a2a-contract-v0 has no field that binds the payload of a call (the grant keys are a closed
set, contract_v0.GRANT_KEYS), so for every action the grant lets run open_fields is "payload_unbound" and finite is false.
That is stated, not hidden: the payload of an admitted call can carry more than its amount says.

holds is false: no record yet says that an amount was held aside before the call. The window is the door's policy, not
the contract: amount_max times max_acts per window_blocks (window_loss) is a reference value from the contract and the
door's published policy together.

Inputs: the contract, the action of the request, and the door's published policy (optional). The content check's answer
is not read. The amount of the request is not part of the record: a request above amount_max is refused over_limit
(clause_eval_v0.over_limit), so amount_max is what an admitted call can state.

L is computed from the contract's grant and the door's published policy alone, without the content check's answer. A
pass does not mean the call was harmless; a wrong pass is bounded by L. While the contract does not bind the payload, L
is not finite and the record says so.

loss_bound_v0.mjs is the same function in JavaScript; the self test runs both over the same inputs and compares the
canonical bytes.

  python3 loss_bound_v0.py --selftest
  python3 loss_bound_v0.py --contract contract.json --action report [--policy policy.json]
"""
import argparse, hashlib, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from contract_v0 import canonical, contract_sha256, parse_strict
from clause_eval_v0 import classify_action, limit_for

SCHEMA = "loss-bound-v0"
KEYS = ("schema", "contract_sha256", "action", "class", "amount_max", "unit", "actions", "open_fields", "holds", "window", "finite")
PAYLOAD_UNBOUND = "payload_unbound"
RUNS = ("authorized", "conditional")


def _int(x, lo=1):
    return isinstance(x, int) and not isinstance(x, bool) and x >= lo


def granted_actions(contract):
    """the actions the grant lets run (classify_action gives authorized or conditional), ascending, each once"""
    g = contract.get("grant") if isinstance(contract.get("grant"), dict) else {}
    names = [a for a in (g.get("authorized_actions") or []) if isinstance(a, str)]
    names += [c.get("action") for c in (g.get("conditional") or []) if isinstance(c, dict) and isinstance(c.get("action"), str)]
    return sorted({a for a in names if classify_action(contract, a) in RUNS})


def window_of(policy, action):
    """policy.exposure[action] as {"window_blocks", "max_acts"} when both are integers of at least 1, else None"""
    ex = policy.get("exposure") if isinstance(policy, dict) else None
    w = ex.get(action) if isinstance(ex, dict) else None
    if not isinstance(w, dict) or not (_int(w.get("window_blocks")) and _int(w.get("max_acts"))):
        return None
    return {"window_blocks": w["window_blocks"], "max_acts": w["max_acts"]}


def loss_bound(contract, action, policy=None):
    """the loss-bound-v0 record of one call of `action` under `contract`, with the door's published `policy` when given"""
    kind = classify_action(contract, action)
    lim = limit_for(contract, action)
    unit = lim[1] if lim is not None and isinstance(lim[1], str) else None
    if kind in RUNS:
        amount_max = lim[0] if lim is not None else None
        open_fields = PAYLOAD_UNBOUND
    else:
        amount_max, open_fields = 0, []
    finite = (kind not in RUNS) or (_int(amount_max, 0) and open_fields == [])
    return {"schema": SCHEMA, "contract_sha256": contract_sha256(contract), "action": action, "class": kind,
            "amount_max": amount_max, "unit": unit, "actions": granted_actions(contract), "open_fields": open_fields,
            "holds": False, "window": window_of(policy, action), "finite": bool(finite)}


def loss_bound_bytes(rec):
    return canonical(rec).encode("utf-8")


def window_loss(rec):
    """amount_max x max_acts per window_blocks, as {"amount", "unit", "per_blocks"}, or None without a window or an amount"""
    w = rec.get("window")
    if not isinstance(w, dict) or not _int(rec.get("amount_max"), 0):
        return None
    return {"amount": rec["amount_max"] * w["max_acts"], "unit": rec.get("unit"), "per_blocks": w["window_blocks"]}


def problems(rec):
    """[] when rec has the closed shape of loss-bound-v0 and its finite follows from its fields; the names of what does not otherwise"""
    out = []
    if not isinstance(rec, dict):
        return ["not_an_object"]
    if sorted(rec) != sorted(KEYS):
        out.append("keys")
    if rec.get("schema") != SCHEMA:
        out.append("schema")
    if rec.get("class") not in ("authorized", "conditional", "prohibited", "unauthorized"):
        out.append("class")
    if rec.get("open_fields") not in (PAYLOAD_UNBOUND, []):
        out.append("open_fields")
    if rec.get("holds") is not False:
        out.append("holds")
    want = rec.get("class") not in RUNS or (_int(rec.get("amount_max"), 0) and rec.get("open_fields") == [])
    if rec.get("finite") is not bool(want):
        out.append("finite")
    return out


# --------------------------------------------------------------------------- self test
def _cases():
    """(name, contract, action, policy): the inputs both runtimes read in the self test"""
    base = {"contract_id": "00" * 16, "grant": {"authorized_actions": ["read", "pay", "wire"], "prohibited_actions": ["wire", "delete"],
                                                "conditional": [{"action": "pay_large", "requires": "principal_approval"}]}}
    lim = json.loads(json.dumps(base))
    lim["grant"]["limits"] = {"pay": {"max_amount": 20, "unit": "ticket"}, "pay_large": {"max_amount": 1000, "unit": "JPY"}}
    real = parse_strict(open(os.path.join(HERE, "run0003", "contract.json"), encoding="utf-8").read())
    pol = {"exposure": {"pay": {"window_blocks": 144, "max_acts": 1}, "read": {"window_blocks": 0, "max_acts": 1}}}
    door = {"exposure": {"report": {"window_blocks": 6, "max_acts": 1}}}
    return [("no_limits_authorized", base, "read", None), ("no_limits_conditional", base, "pay_large", None),
            ("limits_authorized", lim, "pay", None), ("limits_conditional", lim, "pay_large", None),
            ("prohibited", lim, "delete", None), ("prohibited_and_authorized", lim, "wire", pol),
            ("outside_the_actions", lim, "ship", None), ("exposure", lim, "pay", pol), ("exposure_unreadable", lim, "read", pol),
            ("empty_grant", {"grant": {}}, "read", None), ("no_grant", {}, "read", None),
            ("real_report", real, "report", door), ("real_audit", real, "audit", door), ("real_compare", real, "compare", door)]


def _selftest():
    n = 0
    C = {name: (c, a, p) for name, c, a, p in _cases()}
    L = lambda name: loss_bound(*C[name])

    r = L("no_limits_authorized")
    assert (r["class"], r["amount_max"], r["unit"], r["open_fields"], r["finite"]) == ("authorized", None, None, "payload_unbound", False), r
    assert L("no_limits_conditional")["class"] == "conditional" and L("no_limits_conditional")["finite"] is False
    n += 1; print("[1] no limits: amount_max null, unit null, finite false")

    r = L("limits_authorized")
    assert (r["amount_max"], r["unit"], r["open_fields"], r["finite"]) == (20, "ticket", "payload_unbound", False), r
    assert (L("limits_conditional")["amount_max"], L("limits_conditional")["unit"], L("limits_conditional")["finite"]) == (1000, "JPY", False)
    n += 1; print("[2] limits: amount_max and unit as the grant writes them; finite false because the payload is not bound")

    for name in ("prohibited", "prohibited_and_authorized"):
        r = L(name)
        assert (r["class"], r["amount_max"], r["open_fields"], r["finite"]) == ("prohibited", 0, [], True), (name, r)
    n += 1; print("[3] a prohibited action (also when the grant authorizes it too): L 0, finite true")

    for name in ("outside_the_actions", "empty_grant", "no_grant"):
        r = L(name)
        assert (r["class"], r["amount_max"], r["open_fields"], r["finite"]) == ("unauthorized", 0, [], True), (name, r)
    n += 1; print("[4] an action outside the grant: unauthorized, L 0, finite true")

    r = L("exposure")
    assert r["window"] == {"window_blocks": 144, "max_acts": 1} and window_loss(r) == {"amount": 20, "unit": "ticket", "per_blocks": 144}, r
    assert L("exposure_unreadable")["window"] is None and window_loss(L("no_limits_authorized")) is None and L("limits_authorized")["window"] is None
    n += 1; print("[5] the door's policy.exposure: window and window_loss (amount_max x max_acts per window_blocks); a window that cannot be read is null")

    assert all(problems(loss_bound(c, a, p)) == [] for _n, c, a, p in _cases())
    assert L("limits_authorized")["actions"] == ["pay", "pay_large", "read"] and L("no_grant")["actions"] == []
    assert problems(dict(L("limits_authorized"), finite=True)) == ["finite"] and problems(dict(L("prohibited"), extra=1)) == ["keys"]
    assert problems(dict(L("limits_authorized"), holds=True)) == ["holds"]
    assert L("limits_authorized")["contract_sha256"] == contract_sha256(C["limits_authorized"][0])
    n += 1; print("[6] the closed shape: the keys, finite follows from class, amount_max and open_fields; actions ascending without prohibited ones")

    r = L("real_report")
    assert r["contract_sha256"] == "e1fa47a049a94fd725efafa0a1d603e51a16158c58d2638d4c9052c1329109c8"
    assert (r["class"], r["amount_max"], r["unit"], r["actions"], r["finite"]) == ("authorized", 20, "ticket", ["audit", "report"], False), r
    assert window_loss(r) == {"amount": 20, "unit": "ticket", "per_blocks": 6}
    assert (L("real_audit")["amount_max"], L("real_compare")["class"], L("real_compare")["finite"]) == (25, "prohibited", True)
    n += 1; print("[7] run0003/contract.json (hs-seki-demo): report 20 ticket, finite false (payload_unbound); compare prohibited, L 0")

    twin = os.path.join(HERE, "loss_bound_v0.mjs")
    feed = json.dumps([{"name": nm, "contract": c, "action": a, "policy": p} for nm, c, a, p in _cases()])
    try:
        out = subprocess.run(["node", twin, "--cases", "-"], input=feed, capture_output=True, text=True, timeout=120)
    except FileNotFoundError:
        out = None
    if out is None:
        print("[8] node not found: the JavaScript twin was not run")
    else:
        assert out.returncode == 0, out.stderr[-400:]
        lines = out.stdout.splitlines()
        want = [nm + " " + canonical(loss_bound(c, a, p)) for nm, c, a, p in _cases()]
        assert lines == want, [(x, y) for x, y in zip(lines, want) if x != y][:2] or (len(lines), len(want))
        n += 1; print("[8] loss_bound_v0.mjs gives the same canonical bytes for all %d inputs" % len(want))

    print("\nSELF-TEST PASSED: loss-bound-v0, %d checks (no limits; limits; prohibited; outside the grant; the door's window; the closed shape; "
          "the hs-seki-demo contract; the JavaScript twin)" % n)


def main():
    ap = argparse.ArgumentParser(description="loss-bound-v0: L of one call from the contract and the door's published policy")
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
    rec = loss_bound(rd(a.contract), a.action, rd(a.policy) if a.policy else None)
    print(canonical(rec))
    return 0


if __name__ == "__main__":
    sys.exit(main())
