#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MUSUBI settle v1.18: an action run after the door escalated on the content, with no approval that counts, is a
deviation (a2a-settlement-v1.18). One rule, and nothing else.

Why this file exists. A relying party's door that reads the content of a request (FURUI) can escalate instead of
refusing (policy on_flagged, on_scope_conflict or on_unchecked = escalate). The admission then says escalate with a
content reason. Settle v1.11 counts an execution after escalate only when the grant's own clause for the action is
conditional and no approval is carried; settle v1.17 reads the content block of admit only. So an action the grant
authorizes, escalated by the door on the content and run anyway with no approval, left nothing in the settlement.

When the rule applies. To every contract that requires admission (requirements.admission, as v1.11), whether or not
it names a content check. The rule reads only admissions of version 0.3 whose decision is escalate and whose reasons
name a content reason (content_flagged, content_scope_conflict, content_unchecked). When no accepted execution names
such an admission, this file returns settle v1.17's result unchanged, the same bytes, schema line included: the 128
settle core v0 vectors, the v1.17 vectors, run0002 and the admission fixtures settle exactly as before.

The rule, for each action in each execution record v1.16 accepted, in (anchor height, record sha256) order, whose
admission_ref names such an admission that verifies under the relying party's key in hand (the admissions v1.11
reads, each read once, paired with actions as v1.17 pairs them):

  executed_after_content_escalate   the execution carries no approval that counts for this action under these terms
                                    (clause_eval_v0.approval_counts under settle v1.13's approver rule: the principal's
                                    a2a-approval-v2 over these terms, or the pinned approver's a2a-approval-v2 or v3 for
                                    an action the approver lists) and is still valid at the execution's height. A
                                    single_use approval counts once: an approval this rule already counted for an
                                    earlier escalate (in the same order) does not count again (approval_reused).

Precedence: where v1.11 already raised executed_after_refusal for the same execution, action and admission (the grant
clause is conditional and no approval was carried), nothing is added; that is the finding. Otherwise the clause stands
beside any other, content_rules_mismatch (v1.17) included.

Inputs: as v1.17. The rule reads the admission's version, decision and reasons, and the execution's approvals. It does
not read the content, run a check, or read the content block's flags.

Stated limits: as v1.17, and: that the approval was given after the door escalated, or because of it, is not
established (an approval carries a validity height, not the escalation it answers): an approval valid at the
execution's height counts even if it was signed before the escalate, and every row the rule reads says so
(approval_binds_escalate: false). The single_use spend this rule tracks is its own: an approval spent by settle v1.6 on
a conditional action is not carried into it. An escalate on the immune block alone (immune_hold) is not read by this
rule.
"""
import argparse, copy, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import settle_v1_5 as v15
import settle_v1_6 as v16
import settle_v1_11 as v111
import settle_v1_13 as v113
import settle_v1_14 as v114
import settle_v1_16 as v116
import settle_v1_17 as v117
import clause_eval_v0 as ce
import admission_verify_v0 as A
import approval_v3 as AV
from contract_v0 import canonical, parse_strict, contract_sha256, EXEC_SCHEMA

SETTLE_SCHEMA = "a2a-settlement-v1.18"
CLAUSE = "executed_after_content_escalate"
CLAUSES = (CLAUSE,)
CONTENT_REASONS = tuple(getattr(A, "CONTENT_REASONS", ("content_flagged", "content_scope_conflict", "content_unchecked")))
ESTABLISH = ("that each action run after an admission that escalated on the content was read for an approval that counts under "
             "these terms, under the rule in a2a-settlement-v1.18")
DOES_NOT = ["that an approval an execution carries was given after the door escalated, or because of it; an approval carries a "
            "validity height, not the escalation it answers"]


def content_escalated(adm):
    """True when the admission is version 0.3, its decision is escalate and its reasons name a content reason."""
    rules = adm.get("rules") if isinstance(adm.get("rules"), dict) else {}
    rs = adm.get("reasons") if isinstance(adm.get("reasons"), list) else []
    return (rules.get("version") == v117.CONTENT_VERSION and adm.get("decision") == "escalate"
            and any(r in CONTENT_REASONS for r in rs))


def approval_counted(contract, action, approvals, height, spent=None):
    """(entry, None) for the first approvals[] entry that counts for this action under these terms, is valid at height and,
    if single_use, is not in spent; else (None, why). The caller holds settle v1.13's approver rule (an a2a-approval-v3 of
    the pinned approver counts as it does in the lower layers). A counted single_use entry's nonce is added to spent."""
    why = None
    for ap in approvals if isinstance(approvals, list) else []:
        ok, reason = ce.approval_counts(contract, action, ap)
        if not ok:
            why = why or reason
            continue
        vu = ap.get("valid_until_height")
        if height is not None and not (isinstance(vu, int) and not isinstance(vu, bool) and height <= vu):
            why = why or "approval_expired"
            continue
        if spent is not None and ap.get("single_use") is True and ap.get("nonce") in spent:
            why = why or "approval_reused"
            continue
        if spent is not None and ap.get("single_use") is True:
            spent.add(ap.get("nonce"))
        return ap, None
    return None, why


def escalate_deviations(contract, events, accepted, admissions, relying_keys, refused_already):
    """The v1.18 rule. accepted: record sha256 -> height of the executions v1.16 accepted. refused_already: (record
    sha256, action, admission sha256) triples for which executed_after_refusal was raised. Returns (deviations, read)."""
    csha = contract_sha256(contract)
    index, _unverified = v111._admission_index(contract, v114.lowest_admission_copies(admissions), relying_keys)
    recs, seen = [], set()
    for ev in events if isinstance(events, list) else []:
        if not (isinstance(ev, dict) and ev.get("schema") == EXEC_SCHEMA):
            continue
        s = v116._sha(ev)
        if s is None or s not in accepted or s in seen or (ev.get("contract_ref") or {}).get("contract_sha256") != csha:
            continue
        seen.add(s)
        recs.append((accepted[s], s, ev))
    recs.sort(key=lambda t: (t[0], t[1]))
    devs, read, used, spent = [], [], set(), set()
    for h, s, ev in recs:
        refs = [r for r in ev.get("admission_ref") if isinstance(r, dict)] if isinstance(ev.get("admission_ref"), list) else []
        taken = set()
        for a in [x for x in (ev.get("performed_actions") or []) if isinstance(x, str)]:
            i = next((i for i, r in enumerate(refs) if i not in taken and r.get("action") == a), None)
            if i is None:
                continue
            taken.add(i)
            sha = refs[i].get("admission_sha256")
            if not isinstance(sha, str) or sha not in index or sha in used:
                continue
            used.add(sha)
            adm, _ah = index[sha]
            if not content_escalated(adm):
                continue
            if (s, a, sha) in refused_already:
                ap, why = None, None
            else:
                ap, why = approval_counted(contract, a, ev.get("approvals"), h, spent)
            reasons = [r for r in adm.get("reasons") if r in CONTENT_REASONS]
            read.append({"action": a, "admission_sha256": sha, "content_reasons": reasons, "record_sha256": s,
                         "approval": None if ap is None else {"by": ap.get("by") or "principal", "nonce": ap.get("nonce")},
                         "approval_binds_escalate": False})
            if ap is not None or (s, a, sha) in refused_already:
                continue
            dom = (adm.get("relying_party") or {}).get("domain") if isinstance(adm.get("relying_party"), dict) else None
            devs.append({"clause": CLAUSE, "observed": a, "height": h, "record_sha256": s, "admission_sha256": sha,
                         "why": "relying party %s signed escalate on the content (%s); the execution carries no approval that counts for %s%s"
                                % (dom, ", ".join(reasons), a, " (%s)" % why if why in ("approval_expired", "approval_reused") else "")})
    return devs, read


def settle_v1_18(contract, events, view, parent=None, **kw):
    s = v117.settle_v1_17(contract, events, view, parent=parent, **kw)
    if not v111.admission_required(contract) or s.get("verdict") not in ("within_grant", "deviation", "nothing_to_settle"):
        return s
    accepted = {x.get("sha256"): x.get("height") for x in (s.get("authoritative_event_set") or [])
                if isinstance(x, dict) and x.get("kind") == "execution"}
    refused_already = {(d.get("record_sha256"), d.get("observed"), d.get("admission_sha256")) for d in (s.get("deviations") or [])
                       if isinstance(d, dict) and d.get("clause") == "executed_after_refusal"}
    with v113._approver_rule():          # count a pinned approver's a2a-approval-v3 as the lower layers do (settle v1.13)
        devs, read = escalate_deviations(contract, events, accepted, kw.get("admissions"), kw.get("relying_keys"), refused_already)
    if not read:
        return s
    out = dict(s)
    out["schema"], out["settled_under"] = SETTLE_SCHEMA, s.get("schema")
    if devs:
        out["deviations"] = sorted(list(s.get("deviations") or []) + devs, key=canonical)
        out["verdict"] = "deviation"
        out["bond_outcome"] = v15._bond_outcome(contract, "deviation", out.get("status"))
    out["content_escalate_gate"] = {"rule": SETTLE_SCHEMA, "admissions_read": sorted(read, key=canonical),
                                    "counts": {c: sum(1 for d in devs if d["clause"] == c) for c in CLAUSES}}
    out["establishes"] = list(s.get("establishes") or []) + [ESTABLISH]
    out["does_not_establish"] = list(s.get("does_not_establish") or []) + DOES_NOT
    return out


# --------------------------------------------------------------------------- a small world for the tests and vectors
class World(v117.World):
    """v1.17's synthetic world, with a grant that can make "refund" conditional on the principal's approval, and
    executions that can carry approvals."""

    def __init__(self, furui=None, label="settle v1.18 synthetic", conditional=False):
        self._conditional = conditional
        super(World, self).__init__(furui, label=label)

    def execution(self, actions, refs, approvals=()):
        import settle_v1_2 as v12
        c = self.contract
        r = {"schema": EXEC_SCHEMA,
             "contract_ref": {"contract_id": c["contract_id"], "contract_sha256": contract_sha256(c), "payload_digest": c["task"]["payload_digest"]},
             "performed_actions": list(actions), "approvals": list(approvals), "delegated_to": [], "admission_ref": refs}
        v12.sign_record(r, self.KC, "contractor")
        h, hh, proofs = self.block([self.v11.commitment_digest(r)])
        r = copy.deepcopy(r); r["anchor"] = {"height": h, "block_hash": hh, "proof": proofs[0]}
        return r

    def approval(self, action, valid_until_height, nonce):
        return v16.sign_approval_v2(self.KP, self.contract, action, valid_until_height, nonce)

    def approval_v3(self, action, max_amount, valid_until_height, nonce):
        """The pinned approver's a2a-approval-v3 (approval_v3.py) for action, up to max_amount JPY."""
        return AV.sign_approval_v3(self.KZ, self.contract, action, str(max_amount), "JPY", valid_until_height, nonce, APPROVER, self.PZ)

    def admission(self, action, nonce, amount=None, **kw):
        """v1.17's admission, with the amount the request names (grant.limits needs it); None is v1.17's record."""
        if amount is None:
            return super(World, self).admission(action, nonce, **kw)
        saved = A.action_digest
        try:
            A.action_digest = lambda csha, req: saved(csha, dict(req, action=dict(req["action"], amount=amount)))
            return super(World, self).admission(action, nonce, **kw)
        finally:
            A.action_digest = saved


def _contract_with_conditional(w, label):
    """Rebuild w.contract with refund conditional on the principal's approval (the same parties, chain and fields)."""
    import contract_v0 as v0
    nc = copy.deepcopy(w.contract)
    nc["grant"] = dict(nc["grant"], conditional=[{"action": "refund", "requires": "principal_approval"}])
    nc["signatures"] = []
    v0.sign_contract(nc, w.KP, w.PP, v117.DOM_P); v0.sign_contract(nc, w.KC, w.PC, v117.DOM_C)
    assert v0.verify_contract(nc)["verdict"] == "accepted", v0.verify_contract(nc)
    w.contract = nc


APPROVER = "approver.synthetic.invalid"
LIMIT = 5000


def _contract_with_approver(w, label):
    """Rebuild w.contract with refund conditional on a pinned approver (approver.synthetic.invalid) and capped by
    grant.limits at 5,000 JPY: the case settle v1.13 reads, where the approver's a2a-approval-v3 counts."""
    import contract_v0 as v0
    nc = copy.deepcopy(w.contract)
    nc["grant"] = dict(nc["grant"], conditional=[{"action": "refund", "requires": "approver"}],
                       approval_policy={"allow_unscoped": False, "approvers": [{"name": APPROVER, "public_key_ed25519_b64": w.PZ, "actions": ["refund"]}]},
                       limits={"refund": {"max_amount": LIMIT, "unit": "JPY"}})
    nc["signatures"] = []
    v0.sign_contract(nc, w.KP, w.PP, v117.DOM_P); v0.sign_contract(nc, w.KC, w.PC, v117.DOM_C)
    assert v0.verify_contract(nc)["verdict"] == "accepted", v0.verify_contract(nc)
    w.contract = nc


def make_world(furui, label, conditional=False):
    """conditional: False, True (refund conditional on the principal's approval) or "approver" (refund gated by a pinned
    approver and capped by grant.limits)."""
    w = World(furui, label=label)
    w.KZ, w.PZ = v117.seedkey("approver")
    if conditional == "approver":
        _contract_with_approver(w, label)
    elif conditional:
        _contract_with_conditional(w, label)
    return w


def ref_amount(action, sha, nonce, amount):
    r = ref(action, sha, nonce)
    r["executed"] = dict(r["executed"], amount=amount)
    return r


R_GOOD, R_OTHER, NONCE, ref, content_block = v117.R_GOOD, v117.R_OTHER, v117.NONCE, v117.ref, v117.content_block
FLAGGED = dict(verdict="instruction")
SCOPE = dict(scope_conflict="outside_task")


def scenarios():
    """(name, furui terms, conditional grant, build(world) -> (events, admissions), expected clauses, rule reads)."""
    F = {"rules_sha256": R_GOOD}

    def esc(action="read", reasons=("content_flagged",), block=None, approve=None, amount=None):
        def b(w):
            a, sha = w.admission(action, NONCE(1), amount=amount, decision="escalate", reasons=reasons, version="0.3",
                                 content=block if block is not None else content_block(R_GOOD, **FLAGGED))
            aps = []
            if approve == "v3":
                aps = [w.approval_v3(action, amount, w.tip() + 50, NONCE(9))]
            elif approve == "valid":
                aps = [w.approval(action, w.tip() + 50, NONCE(9))]
            elif approve == "expired":
                aps = [w.approval(action, w.tip(), NONCE(9))]
            elif approve == "other_action":
                aps = [w.approval("write", w.tip() + 50, NONCE(9))]
            r = ref(action, sha, NONCE(1)) if amount is None else ref_amount(action, sha, NONCE(1), amount)
            return [w.execution([action], [r], approvals=aps)], [a]
        return b

    def reused(w):
        """Two escalates on two admissions, both executions carrying the same single_use approval: it counts once."""
        ap = w.approval("read", w.tip() + 80, NONCE(9))
        ev, adms = [], []
        for i in (1, 2):
            a, sha = w.admission("read", NONCE(i), decision="escalate", reasons=("content_flagged",), version="0.3",
                                 content=content_block(R_GOOD, **FLAGGED))
            ev.append(w.execution(["read"], [ref("read", sha, NONCE(i))], approvals=[ap])); adms.append(a)
        return ev, adms

    def admit_same(w):
        a, sha = w.admission("read", NONCE(1), version="0.3", content=content_block(R_GOOD))
        return [w.execution(["read"], [ref("read", sha, NONCE(1))])], [a]

    unchecked = content_block(R_GOOD, checked=False)
    return [
        ("v03_escalate_flagged_no_approval", F, False, esc(), [CLAUSE], True),
        ("v03_escalate_scope_conflict_no_approval", F, False,
         esc(reasons=("content_scope_conflict",), block=content_block(R_GOOD, **SCOPE)), [CLAUSE], True),
        ("v03_escalate_unchecked_no_approval", F, False, esc(reasons=("content_unchecked",), block=unchecked), [CLAUSE], True),
        ("v03_escalate_both_flags_no_approval", F, False,
         esc(reasons=("content_flagged", "content_scope_conflict"), block=content_block(R_GOOD, verdict="instruction", scope_conflict="outside_task")),
         [CLAUSE], True),
        ("v03_escalate_flagged_approval_carried", F, False, esc(approve="valid"), [], True),
        ("v03_escalate_flagged_approval_expired", F, False, esc(approve="expired"), [CLAUSE], True),
        ("v03_escalate_flagged_approval_other_action", F, False, esc(approve="other_action"), [CLAUSE], True),
        ("v03_escalate_flagged_no_check_named", None, False, esc(), [CLAUSE], True),
        ("v03_escalate_flagged_other_rules", F, False, esc(block=content_block(R_OTHER, **FLAGGED)), ["content_rules_mismatch", CLAUSE], True),
        ("v03_escalate_flagged_conditional_no_approval", F, True, esc(action="refund"), ["conditional", "executed_after_refusal"], True),
        ("v03_escalate_flagged_conditional_approval_carried", F, True, esc(action="refund", approve="valid"), [], True),
        ("v03_escalate_flagged_approver_v3_carried", F, "approver", esc(action="refund", approve="v3", amount=4000), [], True),
        ("v03_escalate_flagged_single_use_reused", F, False, reused, [CLAUSE], True),
        ("v03_admit_same_rules", F, False, admit_same, [], False),
    ]


# --------------------------------------------------------------------------- self test
def _selftest():
    import subprocess
    sys.path.insert(0, os.path.join(HERE, "settle-core-v0"))
    n = 0
    # [1] no such admission: the bytes of v1.17 on every settle core v0 vector, every v1.17 vector and every admission fixture case
    from run_reference import settle_dir, settle_v1_17_dir
    idx = json.load(open(os.path.join(HERE, "settle-core-v0", "vectors", "vectors.json"), encoding="utf-8"))
    for v in idx["vectors"]:
        d = os.path.join(HERE, "settle-core-v0", "vectors", v["id"])
        assert canonical(settle_dir(d, v117.settle_v1_17, parse_strict)) == canonical(settle_dir(d, settle_v1_18, parse_strict)), v["id"]
    i17 = json.load(open(os.path.join(HERE, "settle-core-v0", "vectors_v1_17", "vectors.json"), encoding="utf-8"))
    for v in i17["vectors"]:
        d = os.path.join(HERE, "settle-core-v0", "vectors_v1_17", v["id"])
        assert canonical(settle_v1_17_dir(d, v117.settle_v1_17, parse_strict)) == canonical(settle_v1_17_dir(d, settle_v1_18, parse_strict)), v["id"]
    contracts, cases, keys = v111.load_fixture()
    for k, c in sorted(cases.items()):
        a = v117.settle_v1_17(contracts[c["contract"]], c["events"], c["view"], admissions=c["admissions"], relying_keys=keys)
        b = settle_v1_18(contracts[c["contract"]], c["events"], c["view"], admissions=c["admissions"], relying_keys=keys)
        assert canonical(a) == canonical(b), k
    rd = lambda p: parse_strict(open(p, encoding="utf-8").read())
    rr = os.path.join(HERE, "run0002")
    C2 = rd(os.path.join(HERE, "second_contract_AB.json"))
    args = (C2, [rd(os.path.join(rr, "exec_19c44a79.anchored.json"))], rd(os.path.join(rr, "view.json")))
    nr = [rd(os.path.join(rr, "walk_8bf29f1a.json"))]
    assert canonical(settle_v1_18(*args, nenrin_records=nr)) == canonical(v117.settle_v1_17(*args, nenrin_records=nr))
    n += 1; print("[1] no admission that escalated on the content: v1.17 byte for byte (%d settle core v0 vectors, %d v1.17 vectors, "
                  "%d admission fixture cases, run0002)" % (len(idx["vectors"]), len(i17["vectors"]), len(cases)))

    # [2] the rule, on a synthetic world
    if getattr(A, "VERSION_CONTENT", None) != v117.CONTENT_VERSION:
        raise SystemExit("admission_verify_v0 here does not know version 0.3; the v1.18 rule reads only 0.3 admissions")
    clauses = lambda s: sorted({d["clause"] for d in s["deviations"]})
    for name, furui, cond, build, want, reads in scenarios():
        w = make_world(furui, "settle v1.18 " + name, conditional=cond)
        events, adms = build(w)
        view = w.view()
        s = settle_v1_18(w.contract, events, view, admissions=adms, relying_keys=w.keys)
        s17 = v117.settle_v1_17(w.contract, events, view, admissions=adms, relying_keys=w.keys)
        assert s["status"] == "final" and clauses(s) == want, (name, s["verdict"], clauses(s), s.get("underspecified"))
        assert s["verdict"] == ("deviation" if want else "within_grant"), (name, s["verdict"])
        if reads:
            assert s["schema"] == SETTLE_SCHEMA and s["settled_under"] == s17["schema"], name
            assert s["content_escalate_gate"]["counts"][CLAUSE] == want.count(CLAUSE), name
            # the v1.17 answer for the same input: the new clause is the only difference in the deviations
            assert sorted({d["clause"] for d in s17["deviations"]}) == [c for c in want if c != CLAUSE], (name, s17["deviations"])
        else:
            assert canonical(s) == canonical(s17), name
        print("    %-50s %-12s %s" % (name, s["verdict"], ",".join(want) or "-"))
    n += 1; print("[2] %d scenarios: flagged, scope conflict, unchecked and both flags escalated with no approval; an approval carried, "
                  "expired, or for another action; no check named; beside content_rules_mismatch; a conditional action left to v1.11; "
                  "a pinned approver's a2a-approval-v3 counted as in v1.13; one single_use approval counted once; "
                  "an admit untouched" % len(scenarios()))

    # [3] one admission named by two executions: read once; the order of the input does not change the bytes
    w = make_world({"rules_sha256": R_GOOD}, "settle v1.18 twice")
    a, sha = w.admission("read", NONCE(2), decision="escalate", reasons=("content_flagged",), version="0.3", content=content_block(R_GOOD, **FLAGGED))
    e1 = w.execution(["read"], [ref("read", sha, NONCE(2))])
    e2 = w.execution(["read"], [ref("read", sha, NONCE(2))])
    view = w.view()
    s = settle_v1_18(w.contract, [e1, e2], view, admissions=[a], relying_keys=w.keys)
    assert [d["clause"] for d in s["deviations"]].count(CLAUSE) == 1, s["deviations"]
    assert canonical(s) == canonical(settle_v1_18(w.contract, [e2, e1], view, admissions=[a], relying_keys=w.keys))
    n += 1; print("[3] one admission named twice: one %s; the order of the input does not change the bytes" % CLAUSE)

    # [4] an escalate that names no content reason (the immune block alone) is not read
    w = make_world({"rules_sha256": R_GOOD}, "settle v1.18 immune")
    rec, _ = w.admission("read", NONCE(3), decision="escalate", reasons=("content_flagged",), version="0.3", content=content_block(R_GOOD, **FLAGGED))
    assert content_escalated(rec) and not content_escalated(dict(rec, reasons=["immune_hold"])) and not content_escalated(dict(rec, decision="refuse"))
    assert not content_escalated(dict(rec, rules=dict(rec["rules"], version="0.2")))
    n += 1; print("[4] read only: version 0.3, decision escalate, a content reason (immune_hold alone, refuse, or 0.2 are not read)")

    # [5] the approver rule is load-bearing: outside settle v1.13's swap the same v3 approval does not count, and the swap
    # is undone after the call
    name, furui, cond, build, want, _r = next(x for x in scenarios() if x[0] == "v03_escalate_flagged_approver_v3_carried")
    w = make_world(furui, "settle v1.18 " + name, conditional=cond)
    events, adms = build(w)
    ev = events[0]
    assert approval_counted(w.contract, "refund", ev["approvals"], None)[0] is None
    with v113._approver_rule():
        assert approval_counted(w.contract, "refund", ev["approvals"], None)[0] is not None
    s = settle_v1_18(w.contract, events, w.view(), admissions=adms, relying_keys=w.keys)
    assert s["verdict"] == "within_grant" and ce.verify_approver_approval is not AV.verify_approver_any
    n += 1; print("[5] a pinned approver's a2a-approval-v3 counts only under settle v1.13's approver rule, which the call holds and gives back")

    r = subprocess.run([sys.executable, os.path.join(HERE, "settle_v1_17.py"), "--selftest"], capture_output=True, text=True)
    assert r.returncode == 0 and "SELF-TEST PASSED" in r.stdout, (r.stdout[-300:], r.stderr[-300:])
    n += 1; print("[6] settle_v1_17 self test (and every layer it runs) still passes")
    print("\nSELF-TEST PASSED: MUSUBI settle v1.18, %d checks (v1.17 byte for byte without a content escalate; %s; an approval that "
          "counts clears it; v1.11 keeps the conditional case; one admission read once; lower layers unchanged)" % (n, CLAUSE))


# --------------------------------------------------------------------------- command line
def main():
    ap = argparse.ArgumentParser(description="MUSUBI settle v1.18 (an action run after the door escalated on the content)")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--settle", metavar="CONTRACT.json")
    ap.add_argument("--event", action="append", default=[])
    ap.add_argument("--view", action="append", default=[])
    ap.add_argument("--nenrin", action="append", default=[])
    ap.add_argument("--admission", action="append", default=[], help="a signed a2a-admission-v0 record with its anchor")
    ap.add_argument("--relying-key", action="append", default=[], metavar="DOMAIN=BASE64", help="the relying party's Ed25519 key, fetched from its key_url")
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
    s = settle_v1_18(contract, [rd(p) for p in a.event], views[cmp["chosen"]], parent=rd(a.parent) if a.parent else None,
                     admissions=[rd(p) for p in a.admission], relying_keys=keys, nenrin_records=[rd(p) for p in a.nenrin] or None)
    if a.out:
        open(a.out, "w", encoding="utf-8", newline="").write(canonical(s))
    print(json.dumps(s, ensure_ascii=False, indent=2))
    return 0 if s["status"] == "final" else 2


if __name__ == "__main__":
    sys.exit(main())
