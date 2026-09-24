#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MUSUBI spine_verify: one content-addressed thread through an agent transaction (a2a-spine-verify-v0).

contract_sha256 is the sha256 of the exact bytes both parties signed (contract_v0.signing_bytes).
spine_verify recomputes it from the contract and follows it through every record handed in:

    contract -> task -> executions -> nenrin -> settlement -> delegation -> tsugi -> ap2

For each stage it reports which records name these exact terms (linked), which name other terms
(foreign), and which name none (unbound). The executions / revocations / acks are settled by
settle_v1_5 (binding by contract_sha256, v1.4 and below untouched); the other stages are checked by
the same rule. "Which contract governed this" becomes one thread anyone can recompute offline.

This does not decide fault. It proves which terms each record claims to be under and whether that
claim recomputes. A stage that carries no records is reported empty, not failed: Phase 2 turns each
producer (NENRIN walker, gate A2A face, TSUGI, AP2 bridge) into a carrier of the sha, and each turns
its stage from unbound to linked.
"""
import argparse, base64, json, os, random, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import contract_v0 as v0
import settle_v1 as v1
import settle_v1_1 as v11
import settle_v1_2 as v12
import settle_v1_5 as v15
from contract_v0 import canonical, parse_strict, contract_sha256, HEX64, EXEC_SCHEMA

SPINE_SCHEMA = "a2a-spine-verify-v0"


def _get(d, *path):
    cur = d
    for k in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur


def _link(records, get_sha, csha):
    """Sort records by whether the sha they carry equals csha. Deterministic, deduplicated by
    the sha the record carries plus its own bytes."""
    linked, foreign, unbound = [], [], []
    seen = set()
    for r in records or ():
        if not isinstance(r, dict):
            continue
        rid = v1.rec_sha(r)
        if rid in seen:
            continue
        seen.add(rid)
        rsha = get_sha(r)
        entry = {"record_sha256": rid}
        if rsha is None:
            unbound.append(entry)
        elif isinstance(rsha, str) and HEX64.match(rsha) and rsha == csha:
            linked.append(entry)
        else:
            foreign.append(dict(entry, contract_sha256=rsha))
    return {"linked": sorted(linked, key=canonical), "foreign": sorted(foreign, key=canonical),
            "unbound": sorted(unbound, key=canonical)}


def _check_children(contract, children, csha):
    """Delegation: a child contract must name its parent by contract_sha256, and its grant must be a
    subset of the parent's (contract_v0.grant_subset). A child that names a parent sha which is not
    this contract's is foreign (parent_not_found_by_sha); a child within the sha but widening the
    grant is an escalation."""
    linked, foreign, unbound, escalations = [], [], [], []
    for ch in children or ():
        if not isinstance(ch, dict):
            continue
        pc = ch.get("parent_contract") if isinstance(ch.get("parent_contract"), dict) else {}
        psha = pc.get("contract_sha256")
        entry = {"child_sha256": contract_sha256(ch), "child_id": ch.get("contract_id")}
        if psha is None:
            unbound.append(entry)
        elif psha != csha:
            foreign.append(dict(entry, parent_contract_sha256=psha))
        else:
            viol = v0.grant_subset(ch.get("grant") or {}, contract.get("grant") or {})
            if viol:
                escalations.append(dict(entry, violations=viol))
            else:
                linked.append(entry)
    return {"linked": sorted(linked, key=canonical), "foreign": sorted(foreign, key=canonical),
            "unbound": sorted(unbound, key=canonical), "escalations": sorted(escalations, key=canonical)}


def spine_verify(contract, executions=(), revocations=(), acks=(), view=None,
                 nenrin_records=(), child_contracts=(), ap2_records=(), tasks=(),
                 tsugi_records=(), mode="strict"):
    csha = contract_sha256(contract)
    holes = []

    # task: metadata.musubi.contract_sha256, or a top-level musubi.contract_sha256
    task_link = _link(tasks, lambda t: _get(t, "metadata", "musubi", "contract_sha256") or _get(t, "musubi", "contract_sha256"), csha)

    # executions / revocations / acks: settled by settle_v1_5
    settlement, exec_link = None, {"linked": [], "foreign": [], "unbound": [], "inconsistent": []}
    if view is not None:
        s = v15.settle_v1_5(contract, list(executions) + list(revocations) + list(acks),
                            view, mode=mode, nenrin_records=list(nenrin_records) or None)
        settlement = {"verdict": s["verdict"], "status": s["status"], "bond_outcome": s["bond_outcome"],
                      "contract_sha256": s["contract_sha256"], "settlement": s}
        exec_link = {"linked": [{"record_sha256": x} for x in s["binding"]["bound"]],
                     "foreign": s["binding"]["foreign"], "unbound": [{"record_sha256": x} for x in s["binding"]["unbound"]],
                     "inconsistent": s["binding"]["inconsistent"]}

    # nenrin: walk.context.contract_sha256
    nenrin_link = _link(nenrin_records, lambda w: _get(w, "context", "contract_sha256"), csha)

    # delegation
    deleg = _check_children(contract, child_contracts, csha)

    # tsugi: drift / authorization records carry contract_sha256 (top level or in contract_ref)
    tsugi_link = _link(tsugi_records, lambda r: r.get("contract_sha256") or _get(r, "contract_ref", "contract_sha256"), csha)

    # ap2: attestation reference carries contract_sha256
    ap2_link = _link(ap2_records, lambda r: _get(r, "reference", "contract_sha256") or _get(r, "contract_ref", "contract_sha256")
                     or r.get("contract_sha256"), csha)

    # holes: structural breaks in the thread (a deviation is a settlement verdict, not a hole)
    if task_link["foreign"] or task_link["unbound"]:
        holes.append({"stage": "task", "reason": "task_not_bound_by_sha",
                      "foreign": task_link["foreign"], "unbound": task_link["unbound"]})
    if exec_link["foreign"]:
        holes.append({"stage": "execution", "reason": "foreign_records", "records": exec_link["foreign"]})
    if exec_link["inconsistent"]:
        holes.append({"stage": "execution", "reason": "inconsistent_records", "records": exec_link["inconsistent"]})
    if mode == "strict" and exec_link["unbound"]:
        holes.append({"stage": "execution", "reason": "unbound_records", "records": exec_link["unbound"]})
    if nenrin_link["foreign"]:
        holes.append({"stage": "nenrin", "reason": "evidence_names_other_contract", "records": nenrin_link["foreign"]})
    if deleg["foreign"]:
        holes.append({"stage": "delegation", "reason": "parent_not_found_by_sha", "records": deleg["foreign"]})
    if deleg["escalations"]:
        holes.append({"stage": "delegation", "reason": "grant_escalation", "records": deleg["escalations"]})
    if ap2_link["unbound"]:
        holes.append({"stage": "ap2", "reason": "payment_without_terms", "records": ap2_link["unbound"]})
    if ap2_link["foreign"]:
        holes.append({"stage": "ap2", "reason": "payment_names_other_contract", "records": ap2_link["foreign"]})
    if tsugi_link["foreign"] or tsugi_link["unbound"]:
        holes.append({"stage": "tsugi", "reason": "recovery_not_bound_by_sha",
                      "foreign": tsugi_link["foreign"], "unbound": tsugi_link["unbound"]})

    chain = [
        {"stage": "contract", "status": "linked", "contract_sha256": csha},
        {"stage": "task", **task_link},
        {"stage": "execution", **exec_link},
        {"stage": "nenrin", **nenrin_link},
        {"stage": "settlement", "status": ("not_run" if settlement is None else settlement["status"]),
         "verdict": (None if settlement is None else settlement["verdict"])},
        {"stage": "delegation", **deleg},
        {"stage": "tsugi", **tsugi_link},
        {"stage": "ap2", **ap2_link},
    ]

    spine = "intact" if not holes else "broken"
    settlement_verdict = settlement["verdict"] if settlement else None
    return {
        "schema": SPINE_SCHEMA,
        "contract_sha256": csha,
        "contract_id": contract.get("contract_id"),
        "spine": spine,
        "settlement_verdict": settlement_verdict,
        "chain": chain,
        "holes": sorted(holes, key=canonical),
        "settlement": settlement["settlement"] if settlement else None,
        "establishes": [
            "that contract_sha256 recomputes from the contract bytes, and every linked record names it",
            "that the thread contract -> task -> executions -> nenrin -> settlement -> delegation -> tsugi -> ap2 is %s" % spine,
        ],
        "does_not_establish": [
            "that foreign or unbound records are false; only that they do not name these exact terms",
            "that a linked record is true or authentic beyond what its own layer establishes",
            "that this decides fault; it proves which terms each record claims and whether the claim recomputes",
        ],
    }


# --------------------------------------------------------------------------- self test
def _selftest():
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    def newkey():
        k = Ed25519PrivateKey.generate()
        return k, base64.b64encode(k.public_key().public_bytes(serialization.Encoding.Raw,
                                                               serialization.PublicFormat.Raw)).decode()
    ka, pa = newkey(); kb, pb = newkey(); kw, pw = newkey()
    n = 0
    PDG = "a" * 64
    base = v11._Chain(60, "00" * 32, "common")
    for _ in range(38):
        base.block()
    lb = {"kind": "bitcoin_block", "height": 97, "hash": base.hashes[97]}
    DNE = ["that HS enforced any of this at runtime",
           "that the contractor obeyed the grant, only that its recorded acts match or deviate from it",
           "that HS judges liability or fault; the verdict is a function anyone recomputes",
           "that a prohibited action was impossible, only that performing one is a provable deviation",
           "that this is a legal contract or determines legal responsibility"]

    def mk(cid, authorized, prohibited, parent=None, max_hops=None):
        g = {"authorized_actions": authorized, "prohibited_actions": prohibited,
             "delegation": {"allowed": []}, "revocation": {"effective_at": "anchor"},
             "finality": {"depth": 3, "max_target_bits": "207fffff"},
             "witnesses": [{"name": "nenrin-walker", "public_key_ed25519_b64": pw}]}
        if max_hops is not None:
            g["max_hops"] = max_hops
        c = v0.build_contract(
            {"domain": "gate.horizonshield.dev", "key_url": "https://gate.horizonshield.dev/keys/agreement.json", "public_key_ed25519_b64": pa},
            {"domain": "api.babyblueviper.com", "key_url": "https://api.babyblueviper.com/keys/agreement.json", "public_key_ed25519_b64": pb},
            {"purpose": "endpoint_conduct_walk", "payload_digest": PDG, "a2a_task_id": "t1"}, g,
            ["that both parties signed these grant bytes at the stated time"], DNE,
            bond={"amount": 1000, "currency": "JPY"}, lower_bound=lb, parent_contract=parent,
            contract_id=cid, nonce="c" * 32, agreed_at="2026-09-24T00:00:00Z")
        v0.sign_contract(c, ka, pa, "gate.horizonshield.dev")
        v0.sign_contract(c, kb, pb, "api.babyblueviper.com")
        return c

    def ex(cid, csha, actions, ref="1", nenrin=None):
        r = {"schema": EXEC_SCHEMA,
             "contract_ref": {"contract_id": cid, "payload_digest": PDG, "contract_sha256": csha},
             "performed_actions": list(actions), "approvals": [], "delegated_to": [],
             "nenrin_ref": nenrin or (ref * 64)[:64]}
        return v12.sign_record(r, kb, "contractor")

    def anchor(recs_by_block, extra=5):
        ch = base.fork(98, "r%d" % random.randint(0, 1 << 40))
        out = []
        for recs in recs_by_block:
            out += ch.block(recs) if recs else ch.block()
        for _ in range(extra):
            ch.block()
        return out, ch

    idA = "0123456789abcdef0123456789abcdef"
    cA = mk(idA, ["read", "write"], ["delete"], max_hops=2)
    csA = contract_sha256(cA)

    # [1] honest full thread: task, execution, nenrin, ap2 all name csA
    walk = {"schema": "jidec-path-v1", "context": {"contract_sha256": csA}, "subject": "api.babyblueviper.com/a2a",
            "result": "pass", "nonce": "1234567890abcdef1234567890abcdef"}
    wsha = v1.rec_sha(walk)
    exe = ex(idA, csA, ["read"], ref="2", nenrin=wsha)
    recs, ch = anchor([[exe]])
    task = {"schema": "a2a-task", "id": "t1", "metadata": {"musubi": {"contract_sha256": csA}}}
    ap2 = {"schema": "a2a-ap2-fairness-attestation", "reference": {"contract_sha256": csA, "cart_mandate": "m1"}}
    out = spine_verify(cA, executions=recs, view=ch.view(), nenrin_records=[walk], tasks=[task], ap2_records=[ap2])
    assert out["spine"] == "intact" and out["holes"] == [], out["holes"]
    assert out["settlement_verdict"] == "within_grant"
    assert len(out["chain"][2]["linked"]) == 1 and out["chain"][1]["linked"] and out["chain"][3]["linked"] and out["chain"][7]["linked"]
    n += 1; print("[1] honest thread (task, execution, nenrin, ap2 all name the sha): spine intact, within_grant, every stage linked")

    # [2] delegation laundering: a child names the parent by an old sha; the parent is edited
    child = mk("11112222333344445555666677778888", ["read"], ["delete"],
               parent={"contract_id": idA, "contract_sha256": csA})
    cAp = mk(idA, ["read"], ["write", "delete"])          # parent edited and re-signed, same id, new sha
    csAp = contract_sha256(cAp)
    assert csAp != csA
    out = spine_verify(cAp, child_contracts=[child])
    assert out["spine"] == "broken" and any(h["reason"] == "parent_not_found_by_sha" for h in out["holes"]), out["holes"]
    assert out["chain"][5]["foreign"][0]["parent_contract_sha256"] == csA
    n += 1; print("[2] child names the parent by an old sha, parent edited: delegation foreign, hole parent_not_found_by_sha")

    # [3] honest delegation: child within the parent grant, names the current sha
    child_ok = mk("99998888777766665555444433332222", ["read"], ["delete"],
                  parent={"contract_id": idA, "contract_sha256": csA})
    out = spine_verify(cA, child_contracts=[child_ok])
    assert out["spine"] == "intact" and out["chain"][5]["linked"], out
    n += 1; print("[3] child within the parent grant, names the current sha: delegation linked, spine intact")

    # [4] escalation: child widens the grant but names the correct parent sha
    child_bad = mk("aaaabbbbccccddddeeeeffff00001111", ["read", "payment"], ["delete"],
                   parent={"contract_id": idA, "contract_sha256": csA})
    out = spine_verify(cA, child_contracts=[child_bad])
    assert out["spine"] == "broken" and any(h["reason"] == "grant_escalation" for h in out["holes"]), out["holes"]
    n += 1; print("[4] child names the correct parent sha but adds 'payment': hole grant_escalation")

    # [5] payment without terms: ap2 attestation carries no contract_sha256
    ap2_bad = {"schema": "a2a-ap2-fairness-attestation", "reference": {"cart_mandate": "m2"}}
    out = spine_verify(cA, ap2_records=[ap2_bad])
    assert out["spine"] == "broken" and any(h["reason"] == "payment_without_terms" for h in out["holes"]), out["holes"]
    assert out["chain"][7]["unbound"], out["chain"][7]
    n += 1; print("[5] ap2 attestation with no contract_sha256: ap2 unbound, hole payment_without_terms")

    # [6] ap2 names other terms
    ap2_other = {"schema": "a2a-ap2-fairness-attestation", "reference": {"contract_sha256": "b" * 64, "cart_mandate": "m3"}}
    out = spine_verify(cA, ap2_records=[ap2_other])
    assert any(h["reason"] == "payment_names_other_contract" for h in out["holes"]), out["holes"]
    n += 1; print("[6] ap2 attestation names another contract_sha256: hole payment_names_other_contract")

    # [7] evidence transplant shows as a nenrin hole and a settlement deviation together
    walkB = {"schema": "jidec-path-v1", "context": {"contract_sha256": "c" * 64}, "subject": "x", "result": "pass",
             "nonce": "abcdefabcdefabcdefabcdefabcdefab"}
    wB = v1.rec_sha(walkB)
    exe2 = ex(idA, csA, ["read"], ref="3", nenrin=wB)
    recs, ch = anchor([[exe2]])
    out = spine_verify(cA, executions=recs, view=ch.view(), nenrin_records=[walkB])
    assert out["settlement_verdict"] == "deviation" and any(h["reason"] == "evidence_names_other_contract" for h in out["holes"]), out
    n += 1; print("[7] bound execution cites a walk under other terms: nenrin hole + settlement deviation")

    # [8] determinism: any order of the same records gives identical spine bytes
    recs, ch = anchor([[exe]])
    ref = canonical(spine_verify(cA, executions=recs, view=ch.view(), nenrin_records=[walk], tasks=[task], ap2_records=[ap2]))
    rng = random.Random(3)
    for _ in range(20):
        r2 = recs + [dict(recs[0])]; rng.shuffle(r2)
        assert canonical(spine_verify(cA, executions=r2, view=ch.view(), nenrin_records=[walk, dict(walk)],
                                      tasks=[task], ap2_records=[ap2])) == ref
    n += 1; print("[8] 20 shuffles with duplicates: identical spine bytes")

    # [9] settle_v1_5 and every layer under it still pass
    here = os.path.dirname(os.path.abspath(__file__))
    rr = subprocess.run([sys.executable, os.path.join(here, "settle_v1_5.py"), "--selftest"], capture_output=True, text=True)
    assert rr.returncode == 0 and "9 checks" in rr.stdout, (rr.stdout[-400:], rr.stderr[-400:])
    n += 1; print("[9] settle_v1_5 9/9 (with every layer under it) still passes")

    print("\nSELF-TEST PASSED: MUSUBI spine_verify, %d checks (honest thread; delegation laundering, escalation; "
          "payment without terms; evidence transplant; determinism; regression)" % n)


def main():
    ap = argparse.ArgumentParser(description="MUSUBI spine_verify (thread the contract_sha256 through a transaction)")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--contract", metavar="CONTRACT.json")
    ap.add_argument("--exec", dest="execs", action="append", default=[], metavar="EXEC.json")
    ap.add_argument("--rev", action="append", default=[], metavar="REVOCATION.json")
    ap.add_argument("--ack", action="append", default=[], metavar="ACK.json")
    ap.add_argument("--view", action="append", default=[], metavar="HEADERS.json")
    ap.add_argument("--nenrin", action="append", default=[], metavar="WALK.json")
    ap.add_argument("--child", action="append", default=[], metavar="CHILD_CONTRACT.json")
    ap.add_argument("--ap2", action="append", default=[], metavar="AP2.json")
    ap.add_argument("--task", action="append", default=[], metavar="TASK.json")
    ap.add_argument("--tsugi", action="append", default=[], metavar="TSUGI.json")
    ap.add_argument("--mode", choices=("strict", "legacy"), default="strict")
    ap.add_argument("--out", metavar="OUT.json")
    a = ap.parse_args()
    if a.selftest:
        _selftest(); return 0
    if not a.contract:
        ap.print_help(); return 1
    rd = lambda p: parse_strict(open(p, encoding="utf-8").read())
    contract = rd(a.contract)
    view = None
    if a.view:
        views = [rd(p) for p in a.view]
        cmp = v14_compare(views, contract)
        view = views[cmp] if cmp is not None else None
    out = spine_verify(contract, executions=[rd(p) for p in a.execs], revocations=[rd(p) for p in a.rev],
                       acks=[rd(p) for p in a.ack], view=view, nenrin_records=[rd(p) for p in a.nenrin],
                       child_contracts=[rd(p) for p in a.child], ap2_records=[rd(p) for p in a.ap2],
                       tasks=[rd(p) for p in a.task], tsugi_records=[rd(p) for p in a.tsugi], mode=a.mode)
    if a.out:
        with open(a.out, "w", encoding="utf-8", newline="") as f:
            f.write(canonical(out))
        print("wrote", a.out)
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0 if out["spine"] == "intact" else 2


def v14_compare(views, contract):
    import settle_v1_4 as v14
    cmp = v14.compare_views_v1_4(views, contract)
    return cmp["chosen"]


if __name__ == "__main__":
    sys.exit(main())
