#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MUSUBI settle v1.19: admissions of version 0.4 (the FURUI A7.4 content block) are read, and an action run after the
door escalated on the immune rules, with no approval that counts, is a deviation (a2a-settlement-v1.19).

Why this file exists. Admission records of version 0.4 (admission_verify_v0, 2026-11-01) carry the content check in the
shape of FURUI A7.4: a salted commitment to the content, the rule set (furui-rules-id-v1), a decision (stop or pass),
the marks off_topic and rule_conflict, unread, answered and checked, and the reason content_off_topic. Settle v1.17
compares the content block only when the admission says "0.3", so it reads a 0.4 admit as an admission that carries no
content check (content_not_checked), and settle v1.18 reads an escalate on the content only in 0.3. And an escalate on
the immune rules alone (immune_hold) was read by no rule.

When the rules apply. To contracts that require admission (requirements.admission, as v1.11). When no accepted
execution names an admission of version 0.4, and none names an escalate on the immune rules alone, this file returns
settle v1.18's result unchanged, the same bytes, schema line included: the 128 settle core v0 vectors, the v1.17 and
v1.18 vectors, run0002 and the admission fixtures settle exactly as before.

The rules, for each action in each execution record v1.16 accepted, in (anchor height, record sha256) order, whose
admission_ref names an admission that verifies under the relying party's key in hand (the admissions v1.11 reads, each
read once, paired with actions as v1.17 pairs them):

  1. The content gate for version 0.4 (v1.17's rule, read for 0.4), only when the contract names a content check
     (requirements.furui.rules_sha256):
       content_rules_mismatch    the admission is version 0.4 and content.rules_sha256 is not the contract's.
       content_not_checked       the admission's decision is admit and its content block says checked false or
                                 answered false (admission_verify_v0 refuses such a 0.4 admit, so the clause stands for
                                 completeness).
     v1.17's own reading of a 0.4 admission (content_not_checked, made because it did not know the version) is taken
     back: such a deviation, for an admission of version 0.4, is removed and the gate above stands in its place.
  2. One escalate rule over versions 0.3 and 0.4, in one pass with one single_use spend, in place of v1.18's:
       executed_after_content_escalate   the admission is version 0.3 or 0.4, its decision is escalate and its reasons
                                         name a content reason (content_flagged, content_scope_conflict,
                                         content_unchecked, or for 0.4 content_off_topic), and the execution carries no
                                         approval that counts for the action, valid at its height (v1.18's test).
       executed_after_immune_escalate    the admission's decision is escalate, its reasons name immune_hold and no content
                                         reason, and the execution carries no approval that counts (the same test).
     Where v1.11 already raised executed_after_refusal for the same execution, action and admission, nothing is added.
  3. content_marks: for the 0.4 admissions read, the number with each mark (off_topic, rule_conflict) and with unread.
     A mark under the relying party's on_off_topic mark_only is no deviation; it is counted.

Inputs: as v1.18. The rules read the admission's version, decision, reasons and content block fields, and the
execution's approvals. They do not read the content, run a check, or recompute input_commit.

Stated limits: as v1.18, and: an approval signs no admission's digest, so that it answers a particular escalate is not
established (v1.18); a mark says what the relying party's check marked, not that the content was off topic.
"""
import argparse, copy, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import settle_v1_5 as v15
import settle_v1_11 as v111
import settle_v1_13 as v113
import settle_v1_14 as v114
import settle_v1_16 as v116
import settle_v1_17 as v117
import settle_v1_18 as v118
import admission_verify_v0 as A
from contract_v0 import canonical, parse_strict, contract_sha256, EXEC_SCHEMA

SETTLE_SCHEMA = "a2a-settlement-v1.19"
V04 = "0.4"
CLAUSE_C, CLAUSE_I = v118.CLAUSE, "executed_after_immune_escalate"
GATE_CLAUSES = v117.CLAUSES
CLAUSES = (CLAUSE_C, CLAUSE_I)
REASONS_C03 = v118.CONTENT_REASONS
REASONS_C04 = tuple(getattr(A, "CONTENT_REASONS_V04", REASONS_C03 + ("content_off_topic",)))
HEX64 = re.compile(r"\A[0-9a-f]{64}\Z")
ESTABLISH = ("that each admission of version 0.4 an accepted execution names was read against requirements.furui.rules_sha256, and that "
             "each action run after an admission that escalated on the content or on the immune rules was read for an approval that "
             "counts, under the rules in a2a-settlement-v1.19")
DOES_NOT = ["that a mark in an admission of version 0.4 says more than what the relying party's own check marked; the content is not "
            "read and input_commit is not recomputed"]


def _version(adm):
    rules = adm.get("rules") if isinstance(adm.get("rules"), dict) else {}
    return rules.get("version")


def escalate_kind(adm):
    """"content" for an escalate on the content (0.3 or 0.4), "immune" for an escalate on the immune rules alone, else None."""
    if adm.get("decision") != "escalate":
        return None
    rs = adm.get("reasons") if isinstance(adm.get("reasons"), list) else []
    ver = _version(adm)
    cr = REASONS_C04 if ver == V04 else REASONS_C03 if ver == v117.CONTENT_VERSION else ()
    if any(r in cr for r in rs):
        return "content"
    if "immune_hold" in rs and not any(r in REASONS_C04 for r in rs):
        return "immune"
    return None


def _paired(contract, events, accepted, admissions, relying_keys):
    """(height, record sha256, action, admission sha256, admission) in v1.17's order and pairing, each admission once."""
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
    out, used = [], set()
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
            out.append((h, s, a, sha, index[sha][0], ev))
    return out


def reads_anything(pairs):
    return any(_version(adm) == V04 or escalate_kind(adm) == "immune" for _h, _s, _a, _sha, adm, _ev in pairs)


def rules_v1_19(contract, pairs, refused_already):
    """(gate deviations, gate rows, escalate deviations, escalate rows, marks)."""
    want = v117.named_rules(contract)
    gdevs, grows, edevs, erows, spent = [], [], [], [], set()
    marks = {"off_topic": 0, "rule_conflict": 0, "unread": 0}
    for h, s, a, sha, adm, ev in pairs:
        ver = _version(adm)
        dom = (adm.get("relying_party") or {}).get("domain") if isinstance(adm.get("relying_party"), dict) else None
        d = lambda clause, why: {"clause": clause, "observed": a, "height": h, "record_sha256": s, "admission_sha256": sha, "why": why}
        if ver == V04:
            c = adm.get("content") if isinstance(adm.get("content"), dict) else {}
            mk = c.get("marks") if isinstance(c.get("marks"), list) else []
            for m in ("off_topic", "rule_conflict"):
                marks[m] += m in mk
            marks["unread"] += c.get("unread") is True
            if want is not None:
                got = c.get("rules_sha256")
                checked = c.get("checked") is True and c.get("answered") is True
                grows.append({"action": a, "admission_sha256": sha, "admission_version": ver, "decision": adm.get("decision"),
                              "rules_sha256": got, "checked": checked, "marks": [m for m in ("off_topic", "rule_conflict") if m in mk],
                              "record_sha256": s})
                if (s, a, sha) not in refused_already:
                    if got != want:
                        gdevs.append(d("content_rules_mismatch", "relying party %s's admission names content check %s; the contract names %s"
                                       % (dom, got if isinstance(got, str) else "none", want)))
                    elif adm.get("decision") == "admit" and not checked:
                        gdevs.append(d("content_not_checked", "relying party %s signed admit with content.checked or content.answered false" % dom))
        kind = escalate_kind(adm)
        if kind is None:
            continue
        if (s, a, sha) in refused_already:
            ap, why = None, None
        else:
            ap, why = v118.approval_counted(contract, a, ev.get("approvals"), h, spent)
        rs = [r for r in adm.get("reasons") if r in (REASONS_C04 if kind == "content" else ("immune_hold",))]
        erows.append({"action": a, "admission_sha256": sha, "admission_version": ver, "kind": kind, "reasons": rs, "record_sha256": s,
                      "approval": None if ap is None else {"by": ap.get("by") or "principal", "nonce": ap.get("nonce")},
                      "approval_binds_escalate": False})
        if ap is not None or (s, a, sha) in refused_already:
            continue
        clause = CLAUSE_C if kind == "content" else CLAUSE_I
        edevs.append(d(clause, "relying party %s signed escalate on the %s (%s); the execution carries no approval that counts for %s%s"
                       % (dom, "content" if kind == "content" else "immune rules", ", ".join(rs), a,
                          " (%s)" % why if why in ("approval_expired", "approval_reused") else "")))
    return gdevs, grows, edevs, erows, marks


def settle_v1_19(contract, events, view, parent=None, **kw):
    s = v118.settle_v1_18(contract, events, view, parent=parent, **kw)
    if not v111.admission_required(contract) or s.get("verdict") not in ("within_grant", "deviation", "nothing_to_settle"):
        return s
    accepted = {x.get("sha256"): x.get("height") for x in (s.get("authoritative_event_set") or [])
                if isinstance(x, dict) and x.get("kind") == "execution"}
    pairs = _paired(contract, events, accepted, kw.get("admissions"), kw.get("relying_keys"))
    if not reads_anything(pairs):
        return s
    refused_already = {(d.get("record_sha256"), d.get("observed"), d.get("admission_sha256")) for d in (s.get("deviations") or [])
                       if isinstance(d, dict) and d.get("clause") == "executed_after_refusal"}
    with v113._approver_rule():          # count a pinned approver's a2a-approval-v3 as the lower layers do (settle v1.13)
        gdevs, grows, edevs, erows, marks = rules_v1_19(contract, pairs, refused_already)
    v04 = {sha for _h, _s, _a, sha, adm, _ev in pairs if _version(adm) == V04}
    keep = [d for d in (s.get("deviations") or []) if not (
        (isinstance(d, dict) and d.get("clause") == CLAUSE_C)                                                 # v1.18's pass, redone below
        or (isinstance(d, dict) and d.get("clause") in GATE_CLAUSES and d.get("admission_sha256") in v04))]  # v1.17's misreading of 0.4
    devs = sorted(keep + gdevs + edevs, key=canonical)
    out = dict(s)
    out["schema"], out["settled_under"] = SETTLE_SCHEMA, s.get("schema")
    out["deviations"] = devs
    if devs:
        out["verdict"] = "deviation"
        out["bond_outcome"] = v15._bond_outcome(contract, "deviation", out.get("status"))
    else:
        base = v116.settle_v1_16(contract, events, view, parent=parent, **kw)
        out["verdict"], out["bond_outcome"] = base.get("verdict"), base.get("bond_outcome")
    if v117.named_rules(contract) is not None:
        out["content_gate_v04"] = {"rule": SETTLE_SCHEMA, "rules_sha256": v117.named_rules(contract), "admissions_read": sorted(grows, key=canonical),
                                   "counts": {c: sum(1 for d in gdevs if d["clause"] == c) for c in GATE_CLAUSES}}
    out["escalate_gate"] = {"rule": SETTLE_SCHEMA, "admissions_read": sorted(erows, key=canonical),
                            "counts": {c: sum(1 for d in edevs if d["clause"] == c) for c in CLAUSES}}
    out.pop("content_escalate_gate", None)
    out["content_marks"] = marks
    out["establishes"] = list(s.get("establishes") or []) + [ESTABLISH]
    out["does_not_establish"] = list(s.get("does_not_establish") or []) + DOES_NOT
    return out


# --------------------------------------------------------------------------- a small world for the tests and vectors
class World(v118.World):
    """v1.18's synthetic world, with admissions of version 0.4 and of version 0.2 (the immune block alone)."""

    def admission(self, action, nonce, amount=None, decision="admit", reasons=("within_grant",), version="0.1", content=None, immune=None, **kw):
        if version not in (V04, "0.2"):
            return super(World, self).admission(action, nonce, amount=amount, decision=decision, reasons=reasons, version=version, content=content, **kw)
        saved = A.admission_signing_bytes
        rec, _sha = super(World, self).admission(action, nonce, amount=amount, decision=decision, reasons=reasons, version="0.3",
                                                 content=content, **kw)
        rec = {k: v for k, v in rec.items() if k not in ("signatures", "anchor")}
        rec["rules"] = dict(rec["rules"], version=version)
        if version == V04:
            rec["does_not_establish"] = list(A.DOES_NOT_ESTABLISH_V04)
        else:
            rec.pop("content", None)
            rec["does_not_establish"] = list(A.DOES_NOT_ESTABLISH_V02)
        if immune is not None:
            rec["immune"] = immune
        import base64
        rec["signatures"] = [{"domain": v117.DOM_R, "alg": "ed25519", "sig": base64.b64encode(self.KR.sign(saved(rec))).decode()}]
        return dict(rec, anchor={"height": self.tip()}), A.admission_sha256(rec)


def content_v04(rules_sha256, decision="pass", marks=(), unread=False, answered=True, checked=True, scope=True):
    on = checked
    return {"rules": "a2a-content-check-v1", "input_commit": "11" * 32 if on else None, "check_sha256": "22" * 32 if on else None,
            "rules_sha256": rules_sha256 if on else None, "scope_sha256": "33" * 32 if scope else None,
            "decision": decision if (on and answered) else None, "marks": list(marks), "unread": unread, "answered": answered, "checked": checked}


IMMUNE_HOLD = {"rules": "a2a-immune-v0", "evaluator_sha256": "cd" * 32, "terms_sha256": "44" * 32, "verdict": "hold",
               "codes": ["unmarked_novel"], "evidence_sha256": "ef" * 32, "second_signal": None}


def make_world(furui, label, conditional=False):
    w = World(furui, label=label)
    w.KZ, w.PZ = v117.seedkey("approver")
    if conditional:
        v118._contract_with_conditional(w, label)
    return w


R_GOOD, R_OTHER, NONCE, ref = v117.R_GOOD, v117.R_OTHER, v117.NONCE, v117.ref


def scenarios():
    """(name, furui terms, conditional grant, build(world) -> (events, admissions), expected clauses, v1.19 reads)."""
    F = {"rules_sha256": R_GOOD}

    def one(action="read", approve=None, **adm):
        def b(w):
            a, sha = w.admission(action, NONCE(1), **adm)
            aps = [w.approval(action, w.tip() + 50, NONCE(9))] if approve == "valid" else []
            return [w.execution([action], [ref(action, sha, NONCE(1))], approvals=aps)], [a]
        return b

    def v4(**c):
        return dict(version=V04, content=content_v04(R_GOOD, **c))

    def esc4(reasons, approve=None, **c):
        return one(approve=approve, decision="escalate", reasons=reasons, **v4(**c))

    def imm(approve=None):
        return one(approve=approve, decision="escalate", reasons=("immune_hold",), version="0.2", immune=IMMUNE_HOLD)

    def twice(w):
        a, sha = w.admission("read", NONCE(2), decision="escalate", reasons=("content_off_topic",), **v4(marks=("off_topic",)))
        return [w.execution(["read"], [ref("read", sha, NONCE(2))]), w.execution(["read"], [ref("read", sha, NONCE(2))])], [a]

    def reused(w):
        ap = w.approval("read", w.tip() + 80, NONCE(9))
        ev, adms = [], []
        for i in (1, 2):
            a, sha = w.admission("read", NONCE(i), decision="escalate", reasons=("content_off_topic",), **v4(marks=("off_topic",)))
            ev.append(w.execution(["read"], [ref("read", sha, NONCE(i))], approvals=[ap])); adms.append(a)
        return ev, adms

    def mixed(w):
        """A 0.3 escalate and a 0.4 escalate, the same single_use approval on both: it counts once across the two versions."""
        ap = w.approval("read", w.tip() + 80, NONCE(9))
        a1, s1 = w.admission("read", NONCE(1), decision="escalate", reasons=("content_flagged",), version="0.3",
                             content=v117.content_block(R_GOOD, verdict="instruction"))
        a2, s2 = w.admission("read", NONCE(2), decision="escalate", reasons=("content_off_topic",), **v4(marks=("off_topic",)))
        return [w.execution(["read"], [ref("read", s1, NONCE(1))], approvals=[ap]), w.execution(["read"], [ref("read", s2, NONCE(2))], approvals=[ap])], [a1, a2]

    MAL = {"rules_sha256": R_GOOD, "scope_text": 5}
    return [
        ("required_false_v01_admit_under_furui_contract", F, False, one(), ["content_not_checked"], False),
        ("v04_admit_pass_same_rules", F, False, one(**v4()), [], True),
        ("v04_admit_off_topic_mark_only", F, False, one(reasons=("within_grant", "content_off_topic"), **v4(marks=("off_topic",))), [], True),
        ("v04_escalate_off_topic_no_approval", F, False, esc4(("content_off_topic",), marks=("off_topic",)), [CLAUSE_C], True),
        ("v04_escalate_off_topic_with_approval", F, False, esc4(("content_off_topic",), approve="valid", marks=("off_topic",)), [], True),
        ("v04_escalate_both_marks_no_approval", F, False,
         esc4(("content_scope_conflict", "content_off_topic"), marks=("off_topic", "rule_conflict")), [CLAUSE_C], True),
        ("v04_refuse_stop_executed", F, False, one(decision="refuse", reasons=("content_flagged",), **v4(decision="stop")), ["executed_after_refusal"], True),
        ("v04_admit_other_rules", F, False, one(version=V04, content=content_v04(R_OTHER)), ["content_rules_mismatch"], True),
        ("v03_admit_under_v1_contract", F, False, one(version="0.3", content=v117.content_block(R_OTHER)), ["content_rules_mismatch"], False),
        ("v04_admit_unchecked", F, False, one(reasons=("within_grant", "content_unchecked"), **v4(checked=False, answered=False)), ["unadmitted_execution"], False),
        ("v04_admit_unanswered", F, False, one(reasons=("within_grant", "content_unchecked"), **v4(answered=False)), ["unadmitted_execution"], False),
        ("v04_unread_escalate_no_approval", F, False, esc4(("content_unchecked",), unread=True), [CLAUSE_C], True),
        ("v04_admit_flagged_inconsistent", F, False, one(reasons=("within_grant", "content_flagged"), **v4(decision="stop")), ["unadmitted_execution"], False),
        ("v04_one_admission_two_execs", F, False, twice, [CLAUSE_C], True),
        ("v04_single_use_reused", F, False, reused, [CLAUSE_C], True),
        ("v03_v04_single_use_once", F, False, mixed, [CLAUSE_C], True),
        ("requirements_furui_v1_malformed", MAL, False, one(**v4()), None, False),
        ("immune_hold_escalate_no_approval", None, False, imm(), [CLAUSE_I], True),
        ("immune_hold_escalate_with_approval", None, False, imm(approve="valid"), [], True),
    ]


# --------------------------------------------------------------------------- self test
def _selftest():
    import subprocess
    sys.path.insert(0, os.path.join(HERE, "settle-core-v0"))
    n = 0
    from run_reference import settle_dir, settle_v1_17_dir
    idx = json.load(open(os.path.join(HERE, "settle-core-v0", "vectors", "vectors.json"), encoding="utf-8"))
    for v in idx["vectors"]:
        d = os.path.join(HERE, "settle-core-v0", "vectors", v["id"])
        assert canonical(settle_dir(d, v118.settle_v1_18, parse_strict)) == canonical(settle_dir(d, settle_v1_19, parse_strict)), v["id"]
    nv = {}
    for sub, f in (("vectors_v1_17", v117.settle_v1_17), ("vectors_v1_18", v118.settle_v1_18)):
        ix = json.load(open(os.path.join(HERE, "settle-core-v0", sub, "vectors.json"), encoding="utf-8"))
        for v in ix["vectors"]:
            d = os.path.join(HERE, "settle-core-v0", sub, v["id"])
            assert canonical(settle_v1_17_dir(d, v118.settle_v1_18, parse_strict)) == canonical(settle_v1_17_dir(d, settle_v1_19, parse_strict)), v["id"]
        nv[sub] = len(ix["vectors"])
    contracts, cases, keys = v111.load_fixture()
    for k, c in sorted(cases.items()):
        a = v118.settle_v1_18(contracts[c["contract"]], c["events"], c["view"], admissions=c["admissions"], relying_keys=keys)
        b = settle_v1_19(contracts[c["contract"]], c["events"], c["view"], admissions=c["admissions"], relying_keys=keys)
        assert canonical(a) == canonical(b), k
    rd = lambda p: parse_strict(open(p, encoding="utf-8").read())
    rr = os.path.join(HERE, "run0002")
    C2 = rd(os.path.join(HERE, "second_contract_AB.json"))
    args = (C2, [rd(os.path.join(rr, "exec_19c44a79.anchored.json"))], rd(os.path.join(rr, "view.json")))
    nr = [rd(os.path.join(rr, "walk_8bf29f1a.json"))]
    assert canonical(settle_v1_19(*args, nenrin_records=nr)) == canonical(v118.settle_v1_18(*args, nenrin_records=nr))
    n += 1; print("[1] no 0.4 admission and no immune escalate: v1.18 byte for byte (%d settle core v0 vectors, %d v1.17 vectors, %d v1.18 "
                  "vectors, %d admission fixture cases, run0002)" % (len(idx["vectors"]), nv["vectors_v1_17"], nv["vectors_v1_18"], len(cases)))

    if getattr(A, "VERSION_CONTENT_V04", None) != V04:
        raise SystemExit("admission_verify_v0 here does not know version 0.4; the v1.19 rules read 0.4 admissions")
    clauses = lambda s: sorted({d["clause"] for d in s["deviations"]})
    for name, furui, cond, build, want, reads in scenarios():
        w = make_world(furui, "settle v1.19 " + name, conditional=cond)
        events, adms = build(w)
        view = w.view()
        s = settle_v1_19(w.contract, events, view, admissions=adms, relying_keys=w.keys)
        s18 = v118.settle_v1_18(w.contract, events, view, admissions=adms, relying_keys=w.keys)
        if want is None:
            assert s["verdict"] == "underspecified" and canonical(s) == canonical(s18), (name, s.get("verdict"))
            assert [u.get("reason") for u in s.get("underspecified") or []] == ["contract_not_verified"], (name, s.get("underspecified"))
            print("    %-50s %-12s %s" % (name, s["verdict"], "contract_not_verified")); continue
        assert s["status"] == "final" and clauses(s) == sorted(want), (name, s["verdict"], clauses(s), s.get("underspecified"))
        assert s["verdict"] == ("deviation" if want else "within_grant"), (name, s["verdict"])
        if reads:
            assert s["schema"] == SETTLE_SCHEMA and s["settled_under"] == s18["schema"], name
            assert all(s["escalate_gate"]["counts"][c] == (1 if c in want else 0) for c in CLAUSES), (name, s["escalate_gate"]["counts"])
            assert sum(1 for d in s["deviations"] if d["clause"] in CLAUSES) == sum(1 for c in want if c in CLAUSES), (name, s["deviations"])
        else:
            assert canonical(s) == canonical(s18), name
        print("    %-50s %-12s %s" % (name, s["verdict"], ",".join(want) or "-"))
    n += 1; print("[2] %d scenarios: the 0.4 content gate (same rules, other rules, unchecked and unanswered refused by the verifier), "
                  "off_topic under mark_only, escalates on the content in 0.4 with and without an approval, unread, one admission read once, "
                  "single_use counted once within 0.4 and across 0.3 and 0.4, a refusal left to v1.11, the immune escalate with and without an "
                  "approval, rule 0 (a 0.1 admit under a contract that names a check)" % len(scenarios()))

    w = make_world({"rules_sha256": R_GOOD}, "settle v1.19 marks")
    b = dict((x[0], x[3]) for x in scenarios())["v04_admit_off_topic_mark_only"]
    events, adms = b(w)
    vw = w.view()
    s = settle_v1_19(w.contract, events, vw, admissions=adms, relying_keys=w.keys)
    s17 = v117.settle_v1_17(w.contract, events, vw, admissions=adms, relying_keys=w.keys)
    assert s["content_marks"] == {"off_topic": 1, "rule_conflict": 0, "unread": 0} and s["verdict"] == "within_grant"
    assert [d["clause"] for d in s17["deviations"]] == ["content_not_checked"], s17["deviations"]
    n += 1; print("[3] a 0.4 admit with off_topic under mark_only: within_grant, counted in content_marks; v1.17 alone misreads it as "
                  "content_not_checked, and v1.19 takes that back")

    assert escalate_kind({"decision": "escalate", "reasons": ["immune_hold"], "rules": {"version": "0.2"}}) == "immune"
    assert escalate_kind({"decision": "escalate", "reasons": ["immune_hold", "content_flagged"], "rules": {"version": "0.3"}}) == "content"
    assert escalate_kind({"decision": "refuse", "reasons": ["immune_hold"], "rules": {"version": "0.2"}}) is None
    assert escalate_kind({"decision": "escalate", "reasons": ["content_off_topic"], "rules": {"version": "0.3"}}) is None
    n += 1; print("[4] the escalate kinds: immune_hold alone is immune; a content reason with it is content; a refusal is neither; "
                  "content_off_topic counts only in 0.4")

    r = subprocess.run([sys.executable, os.path.join(HERE, "settle_v1_18.py"), "--selftest"], capture_output=True, text=True)
    assert r.returncode == 0 and "SELF-TEST PASSED" in r.stdout, (r.stdout[-300:], r.stderr[-300:])
    n += 1; print("[5] settle_v1_18 self test (and every layer it runs) still passes")
    print("\nSELF-TEST PASSED: MUSUBI settle v1.19, %d checks (v1.18 byte for byte without 0.4 or an immune escalate; the 0.4 content gate; "
          "%s over 0.3 and 0.4 in one pass; %s; content_marks; lower layers unchanged)" % (n, CLAUSE_C, CLAUSE_I))


def main():
    ap = argparse.ArgumentParser(description="MUSUBI settle v1.19 (admissions of version 0.4; an action run after an immune escalate)")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--settle", metavar="CONTRACT.json")
    ap.add_argument("--event", action="append", default=[])
    ap.add_argument("--view", action="append", default=[])
    ap.add_argument("--nenrin", action="append", default=[])
    ap.add_argument("--admission", action="append", default=[], help="a signed a2a-admission-v0 record with its anchor")
    ap.add_argument("--relying-key", action="append", default=[], metavar="DOMAIN=BASE64")
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
    s = settle_v1_19(contract, [rd(p) for p in a.event], views[cmp["chosen"]], parent=rd(a.parent) if a.parent else None,
                     admissions=[rd(p) for p in a.admission], relying_keys=keys, nenrin_records=[rd(p) for p in a.nenrin] or None)
    if a.out:
        open(a.out, "w", encoding="utf-8", newline="").write(canonical(s))
    print(json.dumps(s, ensure_ascii=False, indent=2))
    return 0 if s["status"] == "final" else 2


if __name__ == "__main__":
    sys.exit(main())
