#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MUSUBI settle v1.21: the same verdict as settle v1.20, with the loss bound of every admitted call it reads
(a2a-settlement-v1.21).

Why this file exists. Settle v1.20 says whether each act was inside the signed grant and what each admission said. It
does not say how much an admitted call could move if the door's content check let through something it should have
stopped. loss_bound_v0.py states that for one call, from the contract and the door's published policy alone
(loss-bound-v0). This file writes one such record for each admit it reads, so that a settlement names the calls whose
bound is not finite.

L is computed from the contract's grant and the door's published policy alone, without the content check's answer. A
pass does not mean the call was harmless; a wrong pass is bounded by L. While the contract does not bind the payload, L
is not finite and the record says so.

When it applies. To contracts that require admission (requirements.admission, as v1.11), when settle v1.20's verdict is
within_grant, deviation or nothing_to_settle and at least one accepted execution names an admission that verifies under
the relying party's key in hand (the pairs of v1.19, any version from 0.1 to 0.5). Otherwise this file returns settle
v1.20's result unchanged, the same bytes, schema line included.

What it adds, and nothing else:
  loss_bound = {"rule": "a2a-settlement-v1.21", "record": "loss-bound-v0",
                "policy_sha256": sha256 of the canonical policy in hand, or null,
                "admissions_read": [{"admission_sha256", "record_sha256", "action", "admission_version",
                                     "loss_bound": <loss-bound-v0 of the action under the contract and the policy>}],
                "finite": the number of those whose loss_bound says finite true,
                "not_finite": the number that say finite false}
  one line in establishes and one in does_not_establish. schema becomes a2a-settlement-v1.21 and settled_under v1.20's.
admissions_read lists the admissions whose decision is admit: a refused call does not run, and an escalate runs only with
an approval that v1.20 reads. verdict, status, deviations, bond_outcome and every other field are v1.20's, byte for byte.

Inputs: as v1.20, and policy (optional): the door's published policy, an object whose exposure gives the window of
loss-bound-v0. Without it every window is null.

Stated limits: as v1.20, and: an amount is written in the unit the grant names and is not converted; a window is the
door's policy, not the terms; an admit of a prohibited or unauthorized action has L 0 by the rule of loss-bound-v0 and is
a deviation under v1.20's rules.
"""
import argparse, hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import settle_v1_11 as v111
import settle_v1_16 as v116
import settle_v1_19 as v119
import settle_v1_20 as v120
import loss_bound_v0 as LB
from contract_v0 import canonical, parse_strict

SETTLE_SCHEMA = "a2a-settlement-v1.21"
ADDED = ("schema", "settled_under", "loss_bound", "establishes", "does_not_establish")
ESTABLISH = ("that each admit an accepted execution names was given a loss-bound-v0 record from the contract's grant and the door's "
             "policy in hand, without the content check's answer, under the rules in a2a-settlement-v1.21")
DOES_NOT = ["that an admitted call was harmless; loss_bound states what the terms let an admitted call do, and while the contract "
            "does not bind the payload it is not finite"]


def _version(adm):
    return v119._version(adm)


def loss_rows(contract, pairs, policy):
    """the admissions_read rows of loss_bound, one per admit in the pairs of v1.19, in canonical order"""
    rows = []
    for _h, s, a, sha, adm, _ev in pairs:
        if adm.get("decision") != "admit":
            continue
        rows.append({"admission_sha256": sha, "record_sha256": s, "action": a, "admission_version": _version(adm),
                     "loss_bound": LB.loss_bound(contract, a, policy)})
    return sorted(rows, key=canonical)


def settle_v1_21(contract, events, view, parent=None, runners=None, policy=None, **kw):
    s = v120.settle_v1_20(contract, events, view, parent=parent, runners=runners, **kw)
    if not v111.admission_required(contract) or s.get("verdict") not in ("within_grant", "deviation", "nothing_to_settle"):
        return s
    if policy is not None and not isinstance(policy, dict):
        raise ValueError("policy must be an object")
    accepted = {x.get("sha256"): x.get("height") for x in (s.get("authoritative_event_set") or [])
                if isinstance(x, dict) and x.get("kind") == "execution"}
    pairs = v119._paired(contract, events, accepted, kw.get("admissions"), kw.get("relying_keys"))
    if not pairs:
        return s
    rows = loss_rows(contract, pairs, policy)
    out = dict(s)
    out["schema"], out["settled_under"] = SETTLE_SCHEMA, s.get("schema")
    out["loss_bound"] = {"rule": SETTLE_SCHEMA, "record": LB.SCHEMA,
                         "policy_sha256": None if policy is None else hashlib.sha256(canonical(policy).encode("utf-8")).hexdigest(),
                         "admissions_read": rows,
                         "finite": sum(1 for r in rows if r["loss_bound"]["finite"] is True),
                         "not_finite": sum(1 for r in rows if r["loss_bound"]["finite"] is not True)}
    out["establishes"] = list(s.get("establishes") or []) + [ESTABLISH]
    out["does_not_establish"] = list(s.get("does_not_establish") or []) + DOES_NOT
    return out


def same_as_v1_20(a21, a20):
    """True when a21 is a20 (the same bytes), or a20 with only what v1.21 adds: every other field byte for byte, and
    establishes and does_not_establish extended by one line each"""
    if canonical(a21) == canonical(a20):
        return True
    if a21.get("schema") != SETTLE_SCHEMA or a21.get("settled_under") != a20.get("schema") or "loss_bound" not in a21:
        return False
    rest = lambda x: canonical({k: v for k, v in x.items() if k not in ADDED})
    return (rest(a21) == rest(a20) and a21["establishes"] == list(a20.get("establishes") or []) + [ESTABLISH]
            and a21["does_not_establish"] == list(a20.get("does_not_establish") or []) + DOES_NOT)


# --------------------------------------------------------------------------- self test
def _heartbeat_days():
    """(name, contract, events, view, admissions, keys) of every settled day of the SEKI heartbeat whose view lies in
    view-chunks/, read from ../seki-heartbeat as its own self test reads them; [] when that directory is not beside.
    Each day is read under the contract its admissions name (heartbeat.contract_for, since 2026-11-12: run0003 before,
    seki_demo_v2 from then on), not under the one contract the heartbeat calls with today"""
    import importlib.util
    hb_path = os.path.normpath(os.path.join(HERE, "..", "seki-heartbeat", "heartbeat.py"))
    if not os.path.isfile(hb_path):
        return []
    spec = importlib.util.spec_from_file_location("seki_heartbeat_for_v1_21", hb_path)
    hb = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hb)
    hd, out = [], []
    contract_for = getattr(hb, "contract_for", None)   # absent in a heartbeat.py before 2026-11-12: one contract then
    for name in hb._chunks(os.path.join(hb.HERE, "view-chunks")):
        hd += json.load(open(os.path.join(hb.HERE, "view-chunks", name), encoding="utf-8"))["headers"]
    top = hd[-1]["height"] if hd else -1
    for d in sorted(x for x in os.listdir(os.path.join(hb.HERE, "runs")) if len(x) == 10):
        dd = os.path.join(hb.HERE, "runs", d)
        if not os.path.exists(os.path.join(dd, "SETTLED.json")):
            continue
        S = json.load(open(os.path.join(dd, "SETTLED.json"), encoding="utf-8"))
        if S["view"]["to"] > top:
            continue
        r = json.load(open(os.path.join(dd, "RUN.json"), encoding="utf-8"))
        contract = contract_for(dd)[0] if contract_for else hb.rd(hb.CONTRACT_PATH)
        adms = [hb.rd(os.path.join(dd, "admission_%s.anchored.json" % c["service"])) for c in hb.door_calls(r)]
        evs = [hb.rd(os.path.join(dd, "execution_report.anchored.json"))]
        out.append((d, contract, evs, {"headers": [x for x in hd if x["height"] <= S["view"]["to"]]}, adms, {hb.DOOR_DOMAIN: hb.door_key()}))
    return out


def _selftest():
    import subprocess
    sys.path.insert(0, os.path.join(HERE, "settle-core-v0"))
    from run_reference import settle_dir, settle_v1_17_dir
    n, counts = 0, {}
    rd = lambda p: parse_strict(open(p, encoding="utf-8").read())

    def both(name, f20, f21):
        a, b = f20(), f21()
        assert same_as_v1_20(b, a), name
        assert (b.get("verdict"), b.get("status"), canonical(b.get("deviations"))) == (a.get("verdict"), a.get("status"), canonical(a.get("deviations"))), name
        return b

    idx = json.load(open(os.path.join(HERE, "settle-core-v0", "vectors", "vectors.json"), encoding="utf-8"))
    for v in idx["vectors"]:
        d = os.path.join(HERE, "settle-core-v0", "vectors", v["id"])
        both(v["id"], lambda: settle_dir(d, v120.settle_v1_20, parse_strict), lambda: settle_dir(d, settle_v1_21, parse_strict))
    counts["settle core v0"] = len(idx["vectors"])
    for sub in ("vectors_v1_17", "vectors_v1_18"):
        ix = json.load(open(os.path.join(HERE, "settle-core-v0", sub, "vectors.json"), encoding="utf-8"))
        for v in ix["vectors"]:
            d = os.path.join(HERE, "settle-core-v0", sub, v["id"])
            both(v["id"], lambda: settle_v1_17_dir(d, v120.settle_v1_20, parse_strict), lambda: settle_v1_17_dir(d, settle_v1_21, parse_strict))
        counts[sub] = len(ix["vectors"])
    contracts, cases, keys = v111.load_fixture()
    with_lb = 0
    for k, c in sorted(cases.items()):
        b = both(k, lambda: v120.settle_v1_20(contracts[c["contract"]], c["events"], c["view"], admissions=c["admissions"], relying_keys=keys),
                 lambda: settle_v1_21(contracts[c["contract"]], c["events"], c["view"], admissions=c["admissions"], relying_keys=keys))
        with_lb += "loss_bound" in b
    counts["admission fixture cases"] = len(cases)
    rr = os.path.join(HERE, "run0002")
    args = (rd(os.path.join(HERE, "second_contract_AB.json")), [rd(os.path.join(rr, "exec_19c44a79.anchored.json"))], rd(os.path.join(rr, "view.json")))
    nr = [rd(os.path.join(rr, "walk_8bf29f1a.json"))]
    b = both("run0002", lambda: v120.settle_v1_20(*args, nenrin_records=nr), lambda: settle_v1_21(*args, nenrin_records=nr))
    assert "loss_bound" not in b
    n19 = 0
    for name, furui, cond, build, _want, _reads in v119.scenarios():
        w = v119.make_world(furui, "settle v1.19 " + name, conditional=cond)
        events, adms = build(w)
        view = w.view()
        b = both(name, lambda: v120.settle_v1_20(w.contract, events, view, admissions=adms, relying_keys=w.keys),
                 lambda: settle_v1_21(w.contract, events, view, admissions=adms, relying_keys=w.keys))
        with_lb += "loss_bound" in b
        n19 += 1
    counts["v1.19 scenarios"] = n19
    n20 = 0
    for name, furui, runners, build, _want in v120.scenarios():
        w = v120.World(furui, label="settle v1.20 " + name)
        w.KZ, w.PZ = v120.v117.seedkey("approver")
        events, adms = build(w)
        view = w.view()
        b = both(name, lambda: v120.settle_v1_20(w.contract, events, view, admissions=adms, relying_keys=w.keys, runners=runners),
                 lambda: settle_v1_21(w.contract, events, view, admissions=adms, relying_keys=w.keys, runners=runners))
        with_lb += "loss_bound" in b
        n20 += 1
    counts["v1.20 scenarios"] = n20
    days = _heartbeat_days()
    hb_rows = []
    for d, contract, evs, view, adms, ks in days:
        b = both(d, lambda: v120.settle_v1_20(contract, evs, view, admissions=adms, relying_keys=ks),
                 lambda: settle_v1_21(contract, evs, view, admissions=adms, relying_keys=ks))
        hb_rows.append(b.get("loss_bound"))
    counts["SEKI heartbeat settled days"] = len(days)
    assert with_lb > 0
    n += 1; print("[1] the same verdict, status, deviations and every other field of v1.20 on every existing vector (%s); "
                  "%d of them carry loss_bound" % (", ".join("%d %s" % (v, k) for k, v in counts.items()), with_lb + sum(1 for x in hb_rows if x)))

    # the heartbeat's days: one admit (report, 20 tickets) each, not finite
    if days:
        assert all(x and x["finite"] == 0 and x["not_finite"] == 1 for x in hb_rows), hb_rows[:1]
        r = hb_rows[-1]["admissions_read"][0]["loss_bound"]
        assert (r["action"], r["class"], r["amount_max"], r["unit"], r["open_fields"], r["finite"]) == ("report", "authorized", 20, "ticket", "payload_unbound", False), r
        n += 1; print("[2] the SEKI heartbeat's %d settled days (%s to %s): each admit is report, 20 ticket, finite false (payload_unbound)"
                      % (len(days), days[0][0], days[-1][0]))
    else:
        print("[2] ../seki-heartbeat is not beside this file: its days were not read")

    # one settlement with three admitted calls: read (authorized, limits 20 ticket), list (authorized, no limits) and delete
    # (prohibited; a door that signs admit for it is a deviation under v1.20, and its L is 0 by the rule of loss-bound-v0)
    import copy
    import contract_v0 as v0
    w = v119.make_world(None, "settle v1.21 loss bound")
    nc = copy.deepcopy(w.contract)
    nc["grant"] = dict(nc["grant"], authorized_actions=["list", "read"], limits={"read": {"max_amount": 20, "unit": "ticket"}})
    nc["signatures"] = []
    v0.sign_contract(nc, w.KP, w.PP, v119.v117.DOM_P); v0.sign_contract(nc, w.KC, w.PC, v119.v117.DOM_C)
    assert v0.verify_contract(nc)["verdict"] == "accepted", v0.verify_contract(nc)
    w.contract = nc
    events, adms = [], []
    for i, (act, amt) in enumerate((("read", 20), ("list", None), ("delete", None))):
        a, sha = w.admission(act, v119.NONCE(i + 1), amount=amt)
        adms.append(a)
        events.append(w.execution([act], [v119.ref(act, sha, v119.NONCE(i + 1))]))
    view = w.view()
    s = settle_v1_21(w.contract, events, view, admissions=adms, relying_keys=w.keys)
    s20 = v120.settle_v1_20(w.contract, events, view, admissions=adms, relying_keys=w.keys)
    assert same_as_v1_20(s, s20) and "prohibited" in {d["clause"] for d in s["deviations"]}, sorted({d["clause"] for d in s["deviations"]})
    by = {r["action"]: r["loss_bound"] for r in s["loss_bound"]["admissions_read"]}
    assert sorted(by) == ["delete", "list", "read"], sorted(by)
    pick = lambda r: (r["class"], r["amount_max"], r["unit"], r["open_fields"], r["finite"])
    assert pick(by["read"]) == ("authorized", 20, "ticket", "payload_unbound", False), by["read"]
    assert pick(by["list"]) == ("authorized", None, None, "payload_unbound", False), by["list"]
    assert pick(by["delete"]) == ("prohibited", 0, None, [], True), by["delete"]
    lb = s["loss_bound"]
    assert (lb["finite"], lb["not_finite"]) == (1, 2) == (sum(1 for r in by.values() if r["finite"] is True), sum(1 for r in by.values() if r["finite"] is False))
    assert lb["finite"] + lb["not_finite"] == len(lb["admissions_read"]) and all(LB.problems(r) == [] for r in by.values())
    assert all(r["contract_sha256"] == v116.contract_sha256(w.contract) and r["window"] is None for r in by.values()) and lb["policy_sha256"] is None
    n += 1; print("[3] three admits in one settlement: authorized with limits (amount_max 20 ticket, open_fields payload_unbound, finite false), "
                  "authorized without limits (amount_max null, finite false), prohibited (L 0, finite true, and v1.20's prohibited deviation); "
                  "finite 1 and not_finite 2 are the counts of the rows")

    pol = {"exposure": {"read": {"window_blocks": 6, "max_acts": 1}}}
    s2 = settle_v1_21(w.contract, events, view, admissions=adms, relying_keys=w.keys, policy=pol)
    by2 = {r["action"]: r["loss_bound"] for r in s2["loss_bound"]["admissions_read"]}
    assert by2["read"]["window"] == {"window_blocks": 6, "max_acts": 1} and by2["list"]["window"] is None
    assert LB.window_loss(by2["read"]) == {"amount": 20, "unit": "ticket", "per_blocks": 6}
    assert s2["loss_bound"]["policy_sha256"] == hashlib.sha256(canonical(pol).encode()).hexdigest() and same_as_v1_20(s2, s20)
    assert canonical({k: v for k, v in s2.items() if k != "loss_bound"}) == canonical({k: v for k, v in s.items() if k != "loss_bound"})
    n += 1; print("[4] the door's policy gives the window of read (20 ticket per 6 blocks) and its sha256; nothing outside loss_bound changes")

    r = subprocess.run([sys.executable, os.path.join(HERE, "loss_bound_v0.py"), "--selftest"], capture_output=True, text=True)
    assert r.returncode == 0 and "SELF-TEST PASSED" in r.stdout, (r.stdout[-300:], r.stderr[-300:])
    n += 1; print("[5] loss_bound_v0 self test (with its JavaScript twin) passes")
    r = subprocess.run([sys.executable, os.path.join(HERE, "settle_v1_20.py"), "--selftest"], capture_output=True, text=True)
    assert r.returncode == 0 and "SELF-TEST PASSED" in r.stdout, (r.stdout[-300:], r.stderr[-300:])
    n += 1; print("[6] settle_v1_20 self test (and every layer it runs) still passes")
    print("\nSELF-TEST PASSED: MUSUBI settle v1.21, %d checks (v1.20's verdict, status and deviations on every existing vector; "
          "loss_bound for each admit read; the window from the door's policy; loss-bound-v0 and lower layers unchanged)" % n)


def main():
    ap = argparse.ArgumentParser(description="MUSUBI settle v1.21 (v1.20 with the loss bound of each admitted call)")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--settle", metavar="CONTRACT.json")
    ap.add_argument("--event", action="append", default=[])
    ap.add_argument("--view", action="append", default=[])
    ap.add_argument("--nenrin", action="append", default=[])
    ap.add_argument("--admission", action="append", default=[], help="a signed a2a-admission-v0 record with its anchor")
    ap.add_argument("--relying-key", action="append", default=[], metavar="DOMAIN=BASE64")
    ap.add_argument("--runners", metavar="RUNNERS.json", help="the public half of the relying party's runners[] (a list)")
    ap.add_argument("--policy", metavar="POLICY.json", help="the door's published policy (an object with exposure)")
    ap.add_argument("--parent", metavar="PARENT_CONTRACT.json")
    ap.add_argument("--out")
    a = ap.parse_args()
    if a.selftest:
        _selftest(); return 0
    if not a.settle or not a.view:
        ap.print_help(); return 1
    rd = lambda p: parse_strict(open(p, encoding="utf-8").read())
    contract = rd(a.settle)
    views = [rd(p) for p in a.view]
    for vw in views:
        why = v116.view_problem(vw)
        if why:
            print(json.dumps({"view_not_strict": why}, indent=2)); return 2
    cmp = v116.v115.v110.v19.v18.v17.v14.compare_views_v1_4(views, contract)
    if cmp["chosen"] is None:
        print(json.dumps({"fork_choice": cmp}, indent=2)); return 2
    keys = dict(x.split("=", 1) for x in a.relying_key)
    s = settle_v1_21(contract, [rd(p) for p in a.event], views[cmp["chosen"]], parent=rd(a.parent) if a.parent else None,
                     runners=rd(a.runners) if a.runners else None, policy=rd(a.policy) if a.policy else None,
                     admissions=[rd(p) for p in a.admission], relying_keys=keys, nenrin_records=[rd(p) for p in a.nenrin] or None)
    if a.out:
        open(a.out, "w", encoding="utf-8", newline="").write(canonical(s))
    print(json.dumps(s, ensure_ascii=False, indent=2))
    return 0 if s["status"] == "final" else 2


if __name__ == "__main__":
    sys.exit(main())
