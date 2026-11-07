#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MUSUBI settle v1.20: admissions of version 0.5 (the content block of more than one runner) are read
(a2a-settlement-v1.20).

Why this file exists. Admission records of version 0.5 (admission_verify_v0) carry the content check of two or more
runners: checks[] in runner_id order, one per runner the relying party's policy names, quorum {required, answered},
runners_sha256 (the digest of the public half of the runner set the door counted under) and the block's decision,
marks, checked and disagreement_kind, which the verifier holds to checks[] and quorum.required. Settle v1.19 reads
the content of 0.3 and 0.4 only. It reads a 0.5 admit as an admission without a content check (v1.17's
content_not_checked, made because it does not know the version), and an escalate of a 0.5 admission on the content
is read by no rule.

When the rules apply. To contracts that require admission (requirements.admission, as v1.11). When no accepted
execution names an admission of version 0.5, this file returns settle v1.19's result unchanged, the same bytes,
schema line included: the settle core v0 vectors, the v1.17 and v1.18 vectors, the v1.19 scenarios, run0002 and the
admission fixtures settle exactly as before.

The rules, for each action in each execution record v1.16 accepted, in (anchor height, record sha256) order, whose
admission_ref names an admission that verifies under the relying party's key in hand (each admission read once, paired
with actions as v1.17 pairs them):

  1. The content gate for version 0.5, when the contract names a content check (requirements.furui.rules_sha256) or
     the runner set is in hand (runners=[{runner_id, key_id, runner_public_key_ed25519_b64, rules_sha256}], the public
     half of the policy's runners[]):
       content_rules_mismatch    with the runners in hand: the admission's runners_sha256 is not runners_sha256(runners),
                                 or a check names a runner_id, key_id and rules_sha256 that no runner in hand names.
                                 Without them: no check names the contract's rules_sha256 (each runner has its own rule
                                 set digest, so the contract's is that of one of them).
       content_not_checked       the admission's decision is admit and its content block says checked false.
       content_quorum_short      the admission's decision is admit and fewer keys answered (checks with why ok, each key
                                 once) than its quorum.required.
     admission_verify_v0 refuses a 0.5 admit that is not checked or short of its quorum, so the last two clauses stand
     for completeness. v1.17's own reading of a 0.5 admission is taken back, as v1.19 takes it back for 0.4.
  2. One escalate rule over versions 0.3, 0.4 and 0.5, in one pass with one single_use spend, in place of v1.19's:
       executed_after_content_escalate   the admission is version 0.3, 0.4 or 0.5, its decision is escalate and its
                                         reasons name a content reason (for 0.4 and 0.5 content_off_topic among them),
                                         and the execution carries no approval that counts (v1.18's test).
       executed_after_immune_escalate    the admission's decision is escalate, its reasons name immune_hold and no content
                                         reason, and the execution carries no approval that counts.
     Where v1.11 already raised executed_after_refusal for the same execution, action and admission, nothing is added.
  3. content_runners: for the 0.5 admissions read, the number with each mark, with a check unread, short of the quorum,
     and with each disagreement_kind. A difference between runners is counted, not judged.

Inputs: as v1.19, and runners (optional). The rules read the admission's version, decision, reasons and content
block fields, and the execution's approvals. They do not read the content, run a check or recompute input_commit.

Stated limits: as v1.19, and: a disagreement between runners says that their answers differ, not which is right.

What changed from v1.19. Version 0.5 is read by the gate (with content_quorum_short, and runners_sha256 in place of a
single rules_sha256), by the escalate rule, and by the counts. Nothing else; without a 0.5 admission the bytes are v1.19's.
"""
import argparse, base64, copy, hashlib, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import settle_v1_5 as v15
import settle_v1_11 as v111
import settle_v1_13 as v113
import settle_v1_16 as v116
import settle_v1_17 as v117
import settle_v1_18 as v118
import settle_v1_19 as v119
import admission_verify_v0 as A
from contract_v0 import canonical, parse_strict

SETTLE_SCHEMA = "a2a-settlement-v1.20"
V04, V05 = v119.V04, "0.5"
CLAUSE_C, CLAUSE_I = v119.CLAUSE_C, v119.CLAUSE_I
CLAUSE_Q = "content_quorum_short"
GATE_CLAUSES = v117.CLAUSES + (CLAUSE_Q,)
CLAUSES = (CLAUSE_C, CLAUSE_I)
REASONS_C03, REASONS_C04 = v119.REASONS_C03, v119.REASONS_C04
RUNNER_KEYS = ("runner_id", "key_id", "runner_public_key_ed25519_b64", "rules_sha256")
ESTABLISH = ("that each admission of version 0.5 an accepted execution names was read against the runner set in hand or the "
             "contract's rules_sha256, and that each action run after an admission that escalated on the content (0.3, 0.4 or 0.5) "
             "or on the immune rules was read for an approval that counts, under the rules in a2a-settlement-v1.20")
DOES_NOT = ["that one runner's answer in an admission of version 0.5 was right where the runners' answers differ; disagreement_kind "
            "is counted, not judged, and the content is not read"]


def runners_sha256(runners):
    """sha256 of the canonical list of the runners' public halves (runner_id, key_id, runner_public_key_ed25519_b64,
    rules_sha256), in runner_id order. A binding name or any other field is not part of it."""
    pub = sorted(({k: r.get(k) for k in RUNNER_KEYS} for r in runners), key=lambda r: str(r["runner_id"]))
    return hashlib.sha256(canonical(pub).encode("utf-8")).hexdigest()


def _version(adm):
    return v119._version(adm)


def escalate_kind(adm):
    """"content" for an escalate on the content (0.3, 0.4 or 0.5), "immune" for one on the immune rules alone, else None."""
    if adm.get("decision") != "escalate":
        return None
    rs = adm.get("reasons") if isinstance(adm.get("reasons"), list) else []
    ver = _version(adm)
    cr = REASONS_C04 if ver in (V04, V05) else REASONS_C03 if ver == v117.CONTENT_VERSION else ()
    if any(r in cr for r in rs):
        return "content"
    if "immune_hold" in rs and not any(r in REASONS_C04 for r in rs):
        return "immune"
    return None


def answered_keys(c):
    return len({k.get("key_id") for k in (c.get("checks") or []) if isinstance(k, dict) and k.get("why") == "ok"})


def rules_v1_20(contract, pairs, refused_already, runners):
    """(gate deviations, gate rows, escalate deviations, escalate rows, counts) over the pairs of v1.19's _paired."""
    want = v117.named_rules(contract)
    gate = want is not None or runners is not None
    rset = None if runners is None else {(r.get("runner_id"), r.get("key_id"), r.get("rules_sha256")) for r in runners}
    rsha = None if runners is None else runners_sha256(runners)
    gdevs, grows, edevs, erows, spent = [], [], [], [], set()
    counts = {"admissions_read": 0, "off_topic": 0, "rule_conflict": 0, "unread": 0, "quorum_short": 0,
              "disagreement_kind": {k: 0 for k in A.DISAGREEMENT_KINDS_V05}}
    for h, s, a, sha, adm, ev in pairs:
        ver = _version(adm)
        dom = (adm.get("relying_party") or {}).get("domain") if isinstance(adm.get("relying_party"), dict) else None
        d = lambda clause, why: {"clause": clause, "observed": a, "height": h, "record_sha256": s, "admission_sha256": sha, "why": why}
        if ver == V05:
            c = adm.get("content") if isinstance(adm.get("content"), dict) else {}
            q = c.get("quorum") if isinstance(c.get("quorum"), dict) else {}
            ks = [k for k in (c.get("checks") or []) if isinstance(k, dict)]
            mk = c.get("marks") if isinstance(c.get("marks"), list) else []
            ans, req = answered_keys(c), q.get("required")
            counts["admissions_read"] += 1
            for m in ("off_topic", "rule_conflict"):
                counts[m] += m in mk
            counts["unread"] += any(k.get("why") == "unread" for k in ks)
            counts["quorum_short"] += isinstance(req, int) and ans < req
            if c.get("disagreement_kind") in counts["disagreement_kind"]:
                counts["disagreement_kind"][c["disagreement_kind"]] += 1
            if gate:
                if rset is not None:
                    other = [k.get("runner_id") for k in ks if (k.get("runner_id"), k.get("key_id"), k.get("rules_sha256")) not in rset]
                    mis = None if c.get("runners_sha256") == rsha and not other else (
                        "relying party %s's admission names runner set %s%s; the runners in hand give %s"
                        % (dom, c.get("runners_sha256") or "none", (" and checks of runners not in hand (%s)" % ", ".join(map(str, other))) if other else "", rsha))
                else:
                    mis = None if any(k.get("rules_sha256") == want for k in ks) else (
                        "relying party %s's admission names no check under the contract's content check %s" % (dom, want))
                grows.append({"action": a, "admission_sha256": sha, "admission_version": ver, "decision": adm.get("decision"),
                              "runners_sha256": c.get("runners_sha256"), "checked": c.get("checked") is True, "quorum": {"required": req, "answered": ans},
                              "disagreement_kind": c.get("disagreement_kind"), "marks": [m for m in ("off_topic", "rule_conflict") if m in mk], "record_sha256": s})
                if (s, a, sha) not in refused_already:
                    if mis:
                        gdevs.append(d("content_rules_mismatch", mis))
                    elif adm.get("decision") == "admit" and c.get("checked") is not True:
                        gdevs.append(d("content_not_checked", "relying party %s signed admit with content.checked false" % dom))
                    elif adm.get("decision") == "admit" and not (isinstance(req, int) and ans >= req):
                        gdevs.append(d(CLAUSE_Q, "relying party %s signed admit with %d of %s runners answered" % (dom, ans, req)))
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
    return gdevs, grows, edevs, erows, counts


def settle_v1_20(contract, events, view, parent=None, runners=None, **kw):
    s = v119.settle_v1_19(contract, events, view, parent=parent, **kw)
    if not v111.admission_required(contract) or s.get("verdict") not in ("within_grant", "deviation", "nothing_to_settle"):
        return s
    accepted = {x.get("sha256"): x.get("height") for x in (s.get("authoritative_event_set") or [])
                if isinstance(x, dict) and x.get("kind") == "execution"}
    pairs = v119._paired(contract, events, accepted, kw.get("admissions"), kw.get("relying_keys"))
    if not any(_version(adm) == V05 for _h, _s, _a, _sha, adm, _ev in pairs):
        return s
    if runners is not None and not (isinstance(runners, list) and all(isinstance(r, dict) for r in runners)):
        raise ValueError("runners must be a list of objects")
    refused_already = {(d.get("record_sha256"), d.get("observed"), d.get("admission_sha256")) for d in (s.get("deviations") or [])
                       if isinstance(d, dict) and d.get("clause") == "executed_after_refusal"}
    with v113._approver_rule():
        gdevs, grows, edevs, erows, counts = rules_v1_20(contract, pairs, refused_already, runners)
    v05 = {sha for _h, _s, _a, sha, adm, _ev in pairs if _version(adm) == V05}
    keep = [d for d in (s.get("deviations") or []) if not (
        (isinstance(d, dict) and d.get("clause") in CLAUSES)                                                     # v1.19's pass, redone below
        or (isinstance(d, dict) and d.get("clause") in GATE_CLAUSES and d.get("admission_sha256") in v05))]     # v1.17's misreading of 0.5
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
    if v117.named_rules(contract) is not None or runners is not None:
        out["content_gate_v05"] = {"rule": SETTLE_SCHEMA, "rules_sha256": v117.named_rules(contract),
                                   "runners_sha256": None if runners is None else runners_sha256(runners),
                                   "admissions_read": sorted(grows, key=canonical),
                                   "counts": {c: sum(1 for d in gdevs if d["clause"] == c) for c in GATE_CLAUSES}}
    out["escalate_gate"] = {"rule": SETTLE_SCHEMA, "admissions_read": sorted(erows, key=canonical),
                            "counts": {c: sum(1 for d in edevs if d["clause"] == c) for c in CLAUSES}}
    out.pop("content_escalate_gate", None)
    out["content_runners"] = counts
    out["establishes"] = list(s.get("establishes") or []) + [ESTABLISH]
    out["does_not_establish"] = list(s.get("does_not_establish") or []) + DOES_NOT
    return out


# --------------------------------------------------------------------------- a small world for the tests
class World(v119.World):
    """v1.19's synthetic world, with admissions of version 0.5."""

    def admission(self, action, nonce, amount=None, decision="admit", reasons=("within_grant",), version="0.1", content=None, immune=None, **kw):
        if version != V05:
            return super(World, self).admission(action, nonce, amount=amount, decision=decision, reasons=reasons, version=version,
                                                content=content, immune=immune, **kw)
        rec, _sha = super(World, self).admission(action, nonce, amount=amount, decision=decision, reasons=reasons, version=V04,
                                                 content=v119.content_v04(v117.R_GOOD), immune=immune, **kw)
        rec = {k: v for k, v in rec.items() if k not in ("signatures", "anchor")}
        rec["rules"] = dict(rec["rules"], version=V05)
        rec["does_not_establish"] = list(A.DOES_NOT_ESTABLISH_V05)
        rec["content"] = content
        rec["signatures"] = [{"domain": v117.DOM_R, "alg": "ed25519", "sig": base64.b64encode(self.KR.sign(A.admission_signing_bytes(rec))).decode()}]
        return dict(rec, anchor={"height": self.tip()}), A.admission_sha256(rec)


RUNNERS = [{"runner_id": "runner-1", "key_id": "runner-1", "runner_public_key_ed25519_b64": "A" * 43 + "=", "rules_sha256": v117.R_GOOD},
           {"runner_id": "runner-2", "key_id": "runner-2", "runner_public_key_ed25519_b64": "B" * 43 + "=", "rules_sha256": "c3" * 32}]


def check(rid, why="ok", decision="pass", marks=(), rules=None):
    """one element of checks[] in the shape admission_verify_v0 reads (scope always the block's)."""
    read = why in ("ok", "unread")
    rules = rules or next(r["rules_sha256"] for r in RUNNERS if r["runner_id"] == rid)
    return {"runner_id": rid, "key_id": rid, "rules_sha256": rules, "check_sha256": ("%02x" % (len(rid) + len(why))) * 32 if read else None,
            "day": "2026-11-09" if read else None, "decision": decision if read else None, "marks": list(marks) if read else [],
            "unread": (why == "unread") if read else None, "answered": why == "ok", "scope_sha256": "33" * 32 if read else None, "why": why}


def content_v05(checks, required=2, runners=RUNNERS):
    """(block, content_ reasons) for checks, the block's derived fields from admission_verify_v0.content_from_checks_v05."""
    f = A.content_from_checks_v05(checks, required)
    block = {"rules": A.CONTENT_RULES_V05, "checked": f["checked"], "input_commit": "11" * 32, "scope_sha256": "33" * 32,
             "runners_sha256": runners_sha256(runners), "quorum": {"required": required, "answered": f["answered"]},
             "decision": f["decision"], "marks": f["marks"], "disagreement_kind": f["disagreement_kind"], "checks": checks}
    return block, tuple(r for r in A.REASONS_V05 if r in f["reasons"])


def scenarios():
    """(name, furui terms, runners in hand, build(world) -> (events, admissions), expected clauses)."""
    F = {"rules_sha256": v117.R_GOOD}
    NONCE, ref = v117.NONCE, v117.ref

    def one(checks, decision="admit", extra=(), approve=None, action="read", required=2, immune=None):
        def b(w):
            block, rs = content_v05(checks, required)
            reasons = ("within_grant",) + tuple(extra) + rs if decision == "admit" else tuple(extra) + rs
            reasons = tuple(r for r in A.REASONS_V05 if r in reasons)
            a, sha = w.admission(action, NONCE(1), decision=decision, reasons=reasons, version=V05, content=block, immune=immune)
            aps = [w.approval(action, w.tip() + 50, NONCE(9))] if approve == "valid" else []
            return [w.execution([action], [ref(action, sha, NONCE(1))], approvals=aps)], [a]
        return b

    def mixed(w):
        """a 0.4 escalate and a 0.5 escalate with the same single_use approval: it counts once across the two versions."""
        ap = w.approval("read", w.tip() + 80, NONCE(9))
        a1, s1 = w.admission("read", NONCE(1), decision="escalate", reasons=("content_off_topic",), version=V04,
                             content=v119.content_v04(v117.R_GOOD, marks=("off_topic",)))
        block, rs = content_v05([check("runner-1", why="no_envelope"), check("runner-2")])
        a2, s2 = w.admission("read", NONCE(2), decision="escalate", reasons=rs, version=V05, content=block)
        return [w.execution(["read"], [ref("read", s1, NONCE(1))], approvals=[ap]), w.execution(["read"], [ref("read", s2, NONCE(2))], approvals=[ap])], [a1, a2]

    both = [check("runner-1"), check("runner-2")]
    return [
        ("v05_admit_two_pass_contract_rules", F, None, one(both), []),
        ("v05_admit_two_pass_runners_in_hand", F, RUNNERS, one(both), []),
        ("v05_admit_runners_in_hand_only", None, RUNNERS, one(both), []),
        ("v05_admit_off_topic_from_one", F, RUNNERS, one([check("runner-1", marks=("off_topic",)), check("runner-2")]), []),
        ("v05_admit_other_runner_set", F, RUNNERS[:1] + [dict(RUNNERS[1], runner_public_key_ed25519_b64="C" * 43 + "=")], one(both), ["content_rules_mismatch"]),
        ("v05_admit_contract_rules_in_no_check", {"rules_sha256": v117.R_OTHER}, None, one(both), ["content_rules_mismatch"]),
        ("v05_escalate_one_no_envelope_no_approval", F, RUNNERS, one([check("runner-1", why="no_envelope"), check("runner-2")], decision="escalate"), [CLAUSE_C]),
        ("v05_escalate_one_no_envelope_with_approval", F, RUNNERS, one([check("runner-1", why="no_envelope"), check("runner-2")], decision="escalate", approve="valid"), []),
        ("v05_escalate_marks_differ_no_approval", F, RUNNERS, one([check("runner-1", marks=("rule_conflict",)), check("runner-2")], decision="escalate"), [CLAUSE_C]),
        ("v05_refuse_one_stop_executed", F, RUNNERS, one([check("runner-1", decision="stop"), check("runner-2")], decision="refuse"), ["executed_after_refusal"]),
        ("v05_immune_hold_escalate_no_approval", F, RUNNERS, one(both, decision="escalate", extra=("immune_hold",), immune=v119.IMMUNE_HOLD), [CLAUSE_I]),
        ("v04_v05_single_use_once", F, RUNNERS, mixed, [CLAUSE_C]),
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
        assert canonical(settle_dir(d, v119.settle_v1_19, parse_strict)) == canonical(settle_dir(d, settle_v1_20, parse_strict)), v["id"]
    nv = {}
    for sub in ("vectors_v1_17", "vectors_v1_18"):
        ix = json.load(open(os.path.join(HERE, "settle-core-v0", sub, "vectors.json"), encoding="utf-8"))
        for v in ix["vectors"]:
            d = os.path.join(HERE, "settle-core-v0", sub, v["id"])
            assert canonical(settle_v1_17_dir(d, v119.settle_v1_19, parse_strict)) == canonical(settle_v1_17_dir(d, settle_v1_20, parse_strict)), v["id"]
        nv[sub] = len(ix["vectors"])
    contracts, cases, keys = v111.load_fixture()
    for k, c in sorted(cases.items()):
        a = v119.settle_v1_19(contracts[c["contract"]], c["events"], c["view"], admissions=c["admissions"], relying_keys=keys)
        b = settle_v1_20(contracts[c["contract"]], c["events"], c["view"], admissions=c["admissions"], relying_keys=keys)
        assert canonical(a) == canonical(b), k
    rd = lambda p: parse_strict(open(p, encoding="utf-8").read())
    rr = os.path.join(HERE, "run0002")
    C2 = rd(os.path.join(HERE, "second_contract_AB.json"))
    args = (C2, [rd(os.path.join(rr, "exec_19c44a79.anchored.json"))], rd(os.path.join(rr, "view.json")))
    nr = [rd(os.path.join(rr, "walk_8bf29f1a.json"))]
    assert canonical(settle_v1_20(*args, nenrin_records=nr)) == canonical(v119.settle_v1_19(*args, nenrin_records=nr))
    n19 = 0
    for name, furui, cond, build, _want, _reads in v119.scenarios():
        w = v119.make_world(furui, "settle v1.19 " + name, conditional=cond)
        events, adms = build(w)
        view = w.view()
        a = v119.settle_v1_19(w.contract, events, view, admissions=adms, relying_keys=w.keys)
        b = settle_v1_20(w.contract, events, view, admissions=adms, relying_keys=w.keys)
        assert canonical(a) == canonical(b), name
        n19 += 1
    n += 1; print("[1] no 0.5 admission: v1.19 byte for byte (%d settle core v0 vectors, %d v1.17 vectors, %d v1.18 vectors, %d admission "
                  "fixture cases, run0002, the %d v1.19 scenarios)" % (len(idx["vectors"]), nv["vectors_v1_17"], nv["vectors_v1_18"], len(cases), n19))

    if getattr(A, "VERSION_CONTENT_V05", None) != V05:
        raise SystemExit("admission_verify_v0 here does not know version 0.5; the v1.20 rules read 0.5 admissions")
    clauses = lambda s: sorted({d["clause"] for d in s["deviations"]})
    for name, furui, runners, build, want in scenarios():
        w = World(furui, label="settle v1.20 " + name)
        w.KZ, w.PZ = v117.seedkey("approver")
        events, adms = build(w)
        for x in adms:
            got = A.verify_admission({k: v for k, v in x.items() if k != "anchor"}, w.keys[v117.DOM_R])
            assert got["verdict"] == "accepted", (name, got)
        view = w.view()
        s = settle_v1_20(w.contract, events, view, admissions=adms, relying_keys=w.keys, runners=runners)
        assert s["status"] == "final" and clauses(s) == sorted(want), (name, s["verdict"], clauses(s), s.get("underspecified"))
        assert s["verdict"] == ("deviation" if want else "within_grant"), (name, s["verdict"])
        assert s["schema"] == SETTLE_SCHEMA and s["content_runners"]["admissions_read"] >= 1, name
        assert all(s["escalate_gate"]["counts"][c] == (1 if c in want else 0) for c in CLAUSES), (name, s["escalate_gate"]["counts"])
        print("    %-50s %-12s %s" % (name, s["verdict"], ",".join(want) or "-"))
    n += 1; print("[2] %d scenarios: a 0.5 admit read against the contract's rule set or the runner set in hand (same, other, the contract's "
                  "digest in no check), off_topic from one runner, an escalate with one runner unanswered with and without an approval, "
                  "marks that differ, a stop from one runner left to v1.11, the immune escalate, single_use counted once across 0.4 and 0.5"
                  % len(scenarios()))

    w = World({"rules_sha256": v117.R_GOOD}, label="settle v1.20 takes back")
    w.KZ, w.PZ = v117.seedkey("approver")
    events, adms = dict((x[0], x[3]) for x in scenarios())["v05_admit_two_pass_contract_rules"](w)
    vw = w.view()
    s19 = v119.settle_v1_19(w.contract, events, vw, admissions=adms, relying_keys=w.keys)
    s = settle_v1_20(w.contract, events, vw, admissions=adms, relying_keys=w.keys)
    assert [d["clause"] for d in s19["deviations"]] == ["content_not_checked"], s19["deviations"]
    assert s["verdict"] == "within_grant" and s["content_runners"]["disagreement_kind"]["none"] == 1, s["content_runners"]
    assert runners_sha256(RUNNERS) == runners_sha256(list(reversed(RUNNERS))) == runners_sha256([dict(r, binding="X") for r in RUNNERS])
    n += 1; print("[3] a 0.5 admit of two runners: v1.19 alone misreads it as content_not_checked and v1.20 takes that back; "
                  "runners_sha256 is over the public halves in runner_id order (the order given and a binding name do not change it)")

    assert GATE_CLAUSES == ("content_rules_mismatch", "content_not_checked", "content_quorum_short")
    assert escalate_kind({"decision": "escalate", "reasons": ["content_off_topic"], "rules": {"version": "0.5"}}) == "content"
    assert escalate_kind({"decision": "escalate", "reasons": ["immune_hold"], "rules": {"version": "0.5"}}) == "immune"
    assert escalate_kind({"decision": "escalate", "reasons": ["content_off_topic"], "rules": {"version": "0.3"}}) is None
    n += 1; print("[4] the escalate kinds: content_off_topic counts in 0.4 and 0.5, not in 0.3; immune_hold alone is immune")

    r = subprocess.run([sys.executable, os.path.join(HERE, "settle_v1_19.py"), "--selftest"], capture_output=True, text=True)
    assert r.returncode == 0 and "SELF-TEST PASSED" in r.stdout, (r.stdout[-300:], r.stderr[-300:])
    n += 1; print("[5] settle_v1_19 self test (and every layer it runs) still passes")
    print("\nSELF-TEST PASSED: MUSUBI settle v1.20, %d checks (v1.19 byte for byte without 0.5; the 0.5 content gate with %s and the "
          "runner set; %s over 0.3, 0.4 and 0.5 in one pass; content_runners; lower layers unchanged)" % (n, CLAUSE_Q, CLAUSE_C))


def main():
    ap = argparse.ArgumentParser(description="MUSUBI settle v1.20 (admissions of version 0.5)")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--settle", metavar="CONTRACT.json")
    ap.add_argument("--event", action="append", default=[])
    ap.add_argument("--view", action="append", default=[])
    ap.add_argument("--nenrin", action="append", default=[])
    ap.add_argument("--admission", action="append", default=[], help="a signed a2a-admission-v0 record with its anchor")
    ap.add_argument("--relying-key", action="append", default=[], metavar="DOMAIN=BASE64")
    ap.add_argument("--runners", metavar="RUNNERS.json", help="the public half of the relying party's runners[] (a list)")
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
    s = settle_v1_20(contract, [rd(p) for p in a.event], views[cmp["chosen"]], parent=rd(a.parent) if a.parent else None,
                     runners=rd(a.runners) if a.runners else None, admissions=[rd(p) for p in a.admission], relying_keys=keys,
                     nenrin_records=[rd(p) for p in a.nenrin] or None)
    if a.out:
        open(a.out, "w", encoding="utf-8", newline="").write(canonical(s))
    print(json.dumps(s, ensure_ascii=False, indent=2))
    return 0 if s["status"] == "final" else 2


if __name__ == "__main__":
    sys.exit(main())
