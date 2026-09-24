#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MUSUBI settle v1: order-invariant settlement (a2a-settlement-v1).

Why this file exists. A red-team question on 2026-09-24 (Bluesky, @quaxworld.art) asked: if action
and revocation receipts reach replicas in opposite orders, each node settles deterministically from
different admissible facts, so what defines the authoritative event set, and can that choice be
recomputed too? Taking the question seriously exposed a real defect in contract_v0.settle(): it
used the LIST ORDER of execution records as time order. The same two records, swapped, flip the
verdict when an approval and the conditional action it covers live in different records.
List order is replica arrival order. That is exactly the bug the question described.

What v1 does instead.
  1. The authoritative event set is every record bound to the contract, ordered by the key
     (anchor.height, sha256(canonical(record))). anchor.height is the Bitcoin block height at which
     the record's bytes were anchored. Height is recomputable from the chain; the sha is
     recomputable from the bytes. Arrival order plays no part. Feed the same records in any order
     and the settlement bytes are identical (self-test [1] proves it by shuffling).
  2. When a revocation takes effect is a TERM OF THE SIGNED GRANT (grant.revocation.effective_at),
     never a node's clock: "anchor" = at the height the revocation was anchored; "delivery_ack" =
     at the height the contractor's signed acknowledgement was anchored. A wall-clock rule such as
     "signature" is refused as not recomputable.
  3. Two records at the same height are a genuine ambiguity. They are broken by record sha only if
     the grant opts in (grant.ordering.same_height = "record_sha256"). Otherwise a tie that actually
     changes the outcome makes the verdict "underspecified". settle never guesses.
  4. An approval counts for an action only if the record carrying it is ordered no later than the
     record performing the action.
  5. The event set is content-addressed: the same record delivered twice is one record. A revocation
     is terminal for the contract; re-granting is a new contract, not an un-revocation.

Discipline unchanged from v0: HS anchors, HS does not judge. The verdict is a function anyone
recomputes from the contract and the records. This file does not touch contract_v0.py (published,
referenced); it imports from it.

Records this settlement reads (all must carry anchor.height when they are bound to the contract):
  a2a-execution-v0       (from v0) performed_actions[], approvals[], delegated_to[], nenrin_ref
  a2a-revocation-v0      contract_ref, revoked_by, anchor
  a2a-revocation-ack-v0  contract_ref, revocation_sha256, acked_by, anchor
"""
import argparse, hashlib, json, os, random, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import contract_v0 as v0
from contract_v0 import canonical, parse_strict, EXEC_SCHEMA

SETTLE_SCHEMA = "a2a-settlement-v1"
REVOKE_SCHEMA = "a2a-revocation-v0"
ACK_SCHEMA = "a2a-revocation-ack-v0"
ORDERING_RULE = "anchor_height_then_record_sha256"
EFFECTIVE_AT = ("anchor", "delivery_ack")
SAME_HEIGHT = ("record_sha256",)


def rec_sha(ev):
    return hashlib.sha256(canonical(ev).encode("utf-8")).hexdigest()


def height_of(ev):
    a = ev.get("anchor") if isinstance(ev, dict) else None
    h = a.get("height") if isinstance(a, dict) else None
    if isinstance(h, bool) or not isinstance(h, int) or h < 0:
        return None
    return h


def bind(contract, events):
    """Records that reference this contract. Anything else is ignored, same as v0."""
    cid = contract.get("contract_id")
    pdg = (contract.get("task") or {}).get("payload_digest")
    out = []
    for ev in events:
        if not isinstance(ev, dict):
            continue
        ref = ev.get("contract_ref") or {}
        if ref.get("contract_id") != cid:
            continue
        if pdg is not None and ref.get("payload_digest") != pdg:
            continue
        if ev.get("schema") not in (EXEC_SCHEMA, REVOKE_SCHEMA, ACK_SCHEMA):
            continue
        out.append(ev)
    return out


def _kind(ev):
    return {EXEC_SCHEMA: "execution", REVOKE_SCHEMA: "revocation", ACK_SCHEMA: "revocation_ack"}[ev["schema"]]


def settle_v1(contract, events):
    grant = contract.get("grant") or {}
    prohibited = set(grant.get("authorized_prohibited") or grant.get("prohibited_actions") or [])
    authorized = set(grant.get("authorized_actions") or [])
    conditional = {c.get("action"): c for c in (grant.get("conditional") or []) if isinstance(c, dict)}
    deleg = grant.get("delegation")
    allowed_delegates = set((deleg.get("allowed") if isinstance(deleg, dict) else []) or [])
    rev_policy = grant.get("revocation") if isinstance(grant.get("revocation"), dict) else {}
    effective_at = rev_policy.get("effective_at")
    ordering = grant.get("ordering") if isinstance(grant.get("ordering"), dict) else {}
    same_height = ordering.get("same_height")
    sha_breaks_ties = same_height in SAME_HEIGHT

    underspecified = []
    bound = bind(contract, events)

    # 1. every bound record needs a recomputable coordinate. The set is content-addressed: the same
    #    bytes delivered twice (replicas do that) are one record.
    items, seen = [], set()
    for ev in bound:
        s = rec_sha(ev)
        if s in seen:
            continue
        seen.add(s)
        h = height_of(ev)
        if h is None:
            underspecified.append({"reason": "unanchored_event", "sha256": s, "kind": _kind(ev)})
            continue
        items.append((h, s, ev))
    items.sort(key=lambda t: (t[0], t[1]))          # the authoritative order; arrival order is gone here
    order = {s: i for i, (h, s, ev) in enumerate(items)}

    def before(x, y):
        """Is record key x ordered before key y? True / False, or None when they share a height and the
        grant did not opt into breaking ties by bytes. None is never turned into a guess."""
        if x[0] != y[0]:
            return x[0] < y[0]
        return (x[1] < y[1]) if sha_breaks_ties else None

    revocations = [t for t in items if t[2]["schema"] == REVOKE_SCHEMA]
    acks = [t for t in items if t[2]["schema"] == ACK_SCHEMA]
    executions = [t for t in items if t[2]["schema"] == EXEC_SCHEMA]

    # 2. revocation effective moment is a grant term, and it must be chain-recomputable
    rev_out = []
    effective = []                                  # (eff_height, eff_sha, rev_sha)
    if revocations:
        if not effective_at:
            underspecified.append({"reason": "revocation_policy_missing",
                                   "detail": "grant.revocation.effective_at must be one of %s" % list(EFFECTIVE_AT)})
        elif effective_at not in EFFECTIVE_AT:
            underspecified.append({"reason": "revocation_policy_not_recomputable",
                                   "detail": "effective_at=%r is a clock, not a chain coordinate" % effective_at})
        for h, s, ev in revocations:
            entry = {"sha256": s, "height": h, "revoked_by": ev.get("revoked_by"), "effective": False,
                     "effective_height": None, "basis": effective_at}
            if effective_at == "anchor":
                entry["effective"], entry["effective_height"] = True, h
                effective.append((h, s, s))
            elif effective_at == "delivery_ack":
                a = [t for t in acks if t[2].get("revocation_sha256") == s]
                if a:
                    ah, ash, aev = min(a, key=lambda t: (t[0], t[1]))
                    entry["effective"], entry["effective_height"], entry["ack_sha256"] = True, ah, ash
                    effective.append((ah, ash, s))
                else:
                    entry["pending"] = "no acknowledgement record bound to this contract"
            rev_out.append(entry)

    # 3. ties: same height. Harmless unless the two records interact.
    ties = []
    by_height = {}
    for h, s, ev in items:
        by_height.setdefault(h, []).append((s, ev))
    eff_shas = {e[1] for e in effective}

    def _carries_approval_for(ev, action):
        return any(isinstance(ap, dict) and ap.get("action") == action for ap in (ev.get("approvals") or []))

    for h, group in sorted(by_height.items()):
        if len(group) < 2:
            continue
        shas = sorted(s for s, ev in group)
        bites = False
        for s1, e1 in group:
            for s2, e2 in group:
                if s1 >= s2:
                    continue
                pair = (e1, e2)
                # revocation-effective record vs an execution at the same height
                if any(x["schema"] == EXEC_SCHEMA for x in pair) and any(rec_sha(x) in eff_shas for x in pair):
                    bites = True
                # approval carrier vs the action it covers, at the same height, in different records
                for a_ev, b_ev in ((e1, e2), (e2, e1)):
                    if a_ev["schema"] == EXEC_SCHEMA and b_ev["schema"] == EXEC_SCHEMA:
                        for act in (b_ev.get("performed_actions") or []):
                            if act in conditional and _carries_approval_for(a_ev, act) and not _carries_approval_for(b_ev, act):
                                bites = True
        ties.append({"height": h, "records": shas, "bites": bites,
                     "resolved_by": "record_sha256" if (bites and sha_breaks_ties) else None})
        if bites and not sha_breaks_ties:
            underspecified.append({"reason": "decisive_tie_without_policy", "height": h, "records": shas,
                                   "detail": "set grant.ordering.same_height to \"record_sha256\" to break ties by bytes"})

    # 4. walk the authoritative order
    deviations = []
    effective.sort()                                # earliest effective revocation is the one reported
    carriers = {}                                   # action -> keys of records carrying an approval for it
    for h, s, ev in items:                          # collected over the whole set first, so a later approval is
        if ev["schema"] != EXEC_SCHEMA:             # known to be later, not mistaken for absent
            continue
        for ap in (ev.get("approvals") or []):
            if isinstance(ap, dict) and ap.get("action") is not None:
                carriers.setdefault(ap["action"], []).append((h, s))
    for h, s, ev in items:
        if ev["schema"] != EXEC_SCHEMA:
            continue
        key = (h, s)
        # revoked before this execution? An undecided tie (None) is left undecided.
        revoked_by = None
        for eh, es, rs in effective:
            if before((eh, es), key) is True:
                revoked_by = rs
                break
        if revoked_by:
            for act in (ev.get("performed_actions") or []):
                deviations.append({"clause": "revoked", "observed": act, "revocation_sha256": revoked_by,
                                   "height": h, "evidence_sha": ev.get("nenrin_ref")})
            continue
        for act in (ev.get("performed_actions") or []):
            if act in prohibited:
                deviations.append({"clause": "prohibited", "observed": act, "height": h, "evidence_sha": ev.get("nenrin_ref")})
            elif act in conditional:
                need = conditional[act].get("requires")
                ks = carriers.get(act, [])
                rel = [True if k == key else before(k, key) for k in ks]   # same record counts, as in v0
                ok = any(r is True for r in rel)
                undecided = (not ok) and any(r is None for r in rel)
                if need and not ok and not undecided:
                    why = ("approval anchored after the action" if ks
                           else "requires %s, no approval referenced" % need)
                    deviations.append({"clause": "conditional", "observed": act, "why": why, "height": h,
                                       "evidence_sha": ev.get("nenrin_ref")})
            elif authorized and act not in authorized:
                deviations.append({"clause": "unauthorized", "observed": act, "height": h, "evidence_sha": ev.get("nenrin_ref")})
        for dg in (ev.get("delegated_to") or []):
            if dg not in allowed_delegates:
                deviations.append({"clause": "delegation", "observed": dg, "height": h, "evidence_sha": ev.get("nenrin_ref")})

    underspecified.sort(key=canonical)              # listing order must not depend on arrival order either
    if underspecified:
        verdict = "underspecified"
    else:
        verdict = "within_grant" if not deviations else "deviation"
    bond = contract.get("bond")
    if not (isinstance(bond, dict) and bond.get("amount")):
        bond_outcome = "n/a"
    elif verdict == "underspecified":
        bond_outcome = "undetermined"
    else:
        bond_outcome = "held" if verdict == "within_grant" else "forfeited"

    return {
        "schema": SETTLE_SCHEMA,
        "contract_id": contract.get("contract_id"),
        "a2a_task_id": (contract.get("task") or {}).get("a2a_task_id"),
        "ordering_rule": ORDERING_RULE,
        "same_height_policy": same_height,
        "authoritative_event_set": [{"kind": _kind(ev), "sha256": s, "height": h} for h, s, ev in items],
        "ties": ties,
        "revocations": rev_out,
        "verdict": verdict,
        "underspecified": underspecified,
        "deviations": deviations,
        "bond_outcome": bond_outcome,
        "establishes": [
            "that, ordered by (anchor height, record sha256), the bound records %s the grant" % (
                "stay within" if verdict == "within_grant" else
                "deviate from" if verdict == "deviation" else "cannot be settled without the listed terms, so no verdict is rendered on"),
            "that this settlement is a function of the contract and the records only; arrival order is not an input",
        ],
        "does_not_establish": [
            "that any anchor height a record claims is true; recompute it against the chain (that is the anchor verifier's job, this function orders by the claim)",
            "that HS judged this; the verdict is recomputable by anyone from the same bytes",
            "that no other execution happened outside the records bound to this contract_id",
            "that a revocation reached the contractor by any path other than the effective rule the grant names",
            "that each bound record is authentic; verify signatures and nenrin_ref bytes before settling, this function orders and compares",
        ],
        "signatures": [],
    }


# --------------------------------------------------------------------------- self test
def _c(cid="0123456789abcdef0123456789abcdef", **grant_extra):
    grant = {"authorized_actions": ["read", "write"], "prohibited_actions": ["delete"],
             "conditional": [{"action": "write", "requires": "principal_approval"}],
             "delegation": {"allowed": []}}
    grant.update(grant_extra)
    return {"schema": v0.SCHEMA, "contract_id": cid, "task": {"a2a_task_id": "t1", "payload_digest": "a" * 64},
            "grant": grant, "bond": {"amount": 1, "currency": "JPY"}}


def _ex(cid, actions, height, approvals=(), ref="1"):
    return {"schema": EXEC_SCHEMA, "contract_ref": {"contract_id": cid, "payload_digest": "a" * 64},
            "performed_actions": list(actions), "approvals": [{"action": a, "by": "principal"} for a in approvals],
            "delegated_to": [], "nenrin_ref": ref * 64, "anchor": {"height": height}}


def _rv(cid, height):
    return {"schema": REVOKE_SCHEMA, "contract_ref": {"contract_id": cid, "payload_digest": "a" * 64},
            "revoked_by": "principal", "anchor": {"height": height}}


def _ack(cid, rev, height):
    return {"schema": ACK_SCHEMA, "contract_ref": {"contract_id": cid, "payload_digest": "a" * 64},
            "revocation_sha256": rec_sha(rev), "acked_by": "contractor", "anchor": {"height": height}}


def _selftest():
    cid = "0123456789abcdef0123456789abcdef"
    n = 0

    # [1] shuffle invariance on a mixed set: approvals across records, a revocation, an ack, ties
    c = _c(revocation={"effective_at": "anchor"}, ordering={"same_height": "record_sha256"})
    rv = _rv(cid, 105)
    evs = [_ex(cid, ["read"], 100, approvals=["write"], ref="1"), _ex(cid, ["write"], 101, ref="2"),
           _ex(cid, ["read"], 105, ref="3"), rv, _ex(cid, ["read"], 110, ref="4"), _ack(cid, rv, 106)]
    base = canonical(settle_v1(c, evs))
    rng = random.Random(20260924)
    for _ in range(50):
        sh = list(evs); rng.shuffle(sh)
        assert canonical(settle_v1(c, sh)) == base, "settlement changed with input order"
    n += 1; print("[1] shuffle invariance, 50 permutations, settlement bytes identical: OK")

    # [2] action anchored before the revocation: within grant
    c = _c(revocation={"effective_at": "anchor"})
    s = settle_v1(c, [_ex(cid, ["read"], 100), _rv(cid, 200)])
    assert s["verdict"] == "within_grant", s
    n += 1; print("[2] action at 100, revocation at 200: within_grant")

    # [3] action anchored after the revocation: deviation, clause revoked
    s = settle_v1(c, [_rv(cid, 100), _ex(cid, ["read"], 200)])
    assert s["verdict"] == "deviation" and s["deviations"][0]["clause"] == "revoked", s
    assert s["bond_outcome"] == "forfeited"
    n += 1; print("[3] revocation at 100, action at 200: deviation, clause revoked, bond forfeited")

    # [4] same height, no tie policy: underspecified, no verdict guessed
    s = settle_v1(c, [_rv(cid, 100), _ex(cid, ["read"], 100)])
    assert s["verdict"] == "underspecified" and s["underspecified"][0]["reason"] == "decisive_tie_without_policy", s
    assert s["ties"][0]["bites"] is True and s["bond_outcome"] == "undetermined"
    n += 1; print("[4] revocation and action at the same height, no policy: underspecified (tie listed as decisive)")

    # [5] same height with the sha policy: deterministic either way, and the order is the bytes' order
    c5 = _c(revocation={"effective_at": "anchor"}, ordering={"same_height": "record_sha256"})
    r5, e5 = _rv(cid, 100), _ex(cid, ["read"], 100)
    s = settle_v1(c5, [r5, e5])
    expect = "deviation" if rec_sha(r5) < rec_sha(e5) else "within_grant"
    assert s["verdict"] == expect and s["ties"][0]["resolved_by"] == "record_sha256", (s["verdict"], expect)
    n += 1; print("[5] same height with policy record_sha256: %s, resolved by bytes, stated in the record" % expect)

    # [6] delivery_ack: revocation without an ack is not effective; with an ack anchored before the action it is
    c6 = _c(revocation={"effective_at": "delivery_ack"})
    r6 = _rv(cid, 100)
    s = settle_v1(c6, [r6, _ex(cid, ["read"], 200)])
    assert s["verdict"] == "within_grant" and s["revocations"][0]["pending"], s
    s = settle_v1(c6, [r6, _ack(cid, r6, 150), _ex(cid, ["read"], 200)])
    assert s["verdict"] == "deviation" and s["revocations"][0]["effective_height"] == 150, s
    n += 1; print("[6] delivery_ack: pending without ack (within), effective at the ack height 150 (deviation)")

    # [7] the finding: v0 is order-dependent on the same inputs, v1 is not
    c7 = _c()
    a = _ex(cid, ["write"], 101, ref="1")                 # the conditional action
    b = _ex(cid, ["read"], 100, approvals=["write"], ref="2")  # the approval, anchored earlier, in another record
    v0_ab, v0_ba = v0.settle(c7, [a, b])["verdict"], v0.settle(c7, [b, a])["verdict"]
    assert v0_ab != v0_ba, "v0 no longer order-dependent; update this test"
    v1_ab, v1_ba = settle_v1(c7, [a, b]), settle_v1(c7, [b, a])
    assert canonical(v1_ab) == canonical(v1_ba) and v1_ab["verdict"] == "within_grant", (v1_ab["verdict"], v1_ba["verdict"])
    # and an approval anchored AFTER the action does not count, whatever the list order
    b_late = _ex(cid, ["read"], 102, approvals=["write"], ref="2")
    s = settle_v1(c7, [b_late, a])
    assert s["verdict"] == "deviation" and s["deviations"][0]["why"] == "approval anchored after the action", s
    n += 1; print("[7] v0: [A,B]=%s [B,A]=%s (order-dependent). v1: identical bytes both orders, within_grant; "
                  "late approval is a deviation" % (v0_ab, v0_ba))

    # [8] a wall-clock effective rule is refused as not recomputable
    c8 = _c(revocation={"effective_at": "signature"})
    s = settle_v1(c8, [_rv(cid, 100), _ex(cid, ["read"], 200)])
    assert s["verdict"] == "underspecified" and s["underspecified"][0]["reason"] == "revocation_policy_not_recomputable", s
    n += 1; print("[8] effective_at=signature (a clock): refused, underspecified")

    # [9] a bound record without an anchor height cannot be ordered: underspecified, named by sha
    c9 = _c(revocation={"effective_at": "anchor"})
    e9 = _ex(cid, ["read"], 200); del e9["anchor"]
    s = settle_v1(c9, [_rv(cid, 100), e9])
    assert s["verdict"] == "underspecified" and s["underspecified"][0]["reason"] == "unanchored_event", s
    n += 1; print("[9] unanchored execution record: underspecified, record named by sha")

    # [10] the same receipt delivered twice (replicas do that) is one record, and cannot double a deviation
    c10 = _c()
    dup = _ex(cid, ["delete"], 100)
    s1, s2 = settle_v1(c10, [dup]), settle_v1(c10, [dup, dict(dup), dup])
    assert canonical(s1) == canonical(s2) and len(s2["deviations"]) == 1 and len(s2["authoritative_event_set"]) == 1, s2
    n += 1; print("[10] same record delivered three times: one record, one deviation, identical bytes")

    # [11] an undecided tie never leaks a guess into the deviations list
    c11 = _c(revocation={"effective_at": "anchor"})
    s = settle_v1(c11, [_rv(cid, 100), _ex(cid, ["read"], 100)])
    assert s["verdict"] == "underspecified" and s["deviations"] == [], s
    n += 1; print("[11] undecided tie: underspecified, deviations list empty (no guessed 'revoked')")

    print("\nSELF-TEST PASSED: MUSUBI settle v1, %d checks (order invariance, revocation, ties, ack, duplicates, v0 regression)" % n)


def _write_canonical(path, obj):
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(canonical(obj))


def main():
    ap = argparse.ArgumentParser(description="MUSUBI settle v1 (order-invariant settlement)")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--settle", metavar="CONTRACT.json")
    ap.add_argument("--event", action="append", default=[], metavar="RECORD.json",
                    help="execution / revocation / revocation-ack record; repeat; any order")
    ap.add_argument("--out", metavar="OUT.json")
    a = ap.parse_args()
    if a.selftest:
        _selftest(); return 0
    if a.settle:
        contract = parse_strict(open(a.settle, encoding="utf-8").read())
        events = [parse_strict(open(p, encoding="utf-8").read()) for p in a.event]
        s = settle_v1(contract, events)
        if a.out:
            _write_canonical(a.out, s); print("wrote", a.out)
        print(json.dumps(s, ensure_ascii=False, indent=2))
        return 0 if s["verdict"] != "underspecified" else 2
    ap.print_help(); return 1


if __name__ == "__main__":
    sys.exit(main())
