#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MUSUBI settle v1.5: binding by contract_sha256 (a2a-settlement-v1.5).

Why this file exists. Every layer up to v1.4 bound a record to a contract by contract_id: a random
handle written inside the record's contract_ref. A handle can be copied. Two records that name the
same contract_id are treated as the same contract even when their terms differ, and a contract whose
grant is edited and re-signed keeps its old contract_id, so every past record silently follows the
edit. The binding was a label, not the terms.

v1.5 binds by the terms themselves. contract_sha256 is the sha256 of the exact bytes both parties
signed:

    contract_sha256(contract) = sha256( b"a2a-contract-v0\\n" + canonical(contract without "signatures") )

which is contract_v0.signing_bytes(contract). It is identical for both parties, does not change when
the second signature lands, and is recomputable by anyone from the contract minus its signatures. A
record is bound to this contract only if its contract_ref.contract_sha256 equals the sha recomputed
here from the contract. Records that name a different sha are listed foreign (they belong to other
terms); records that name none are listed unbound (a pre-v1.5 record that binds by label only).

What v1.5 adds, on top of v1.4 (v1.4 and every layer under it are untouched, reused as a part):
  1. contract_sha256(contract), recomputed from the contract bytes, never read from a record.
  2. binding by sha: only records whose contract_ref.contract_sha256 equals it are settled. The rest
     are sorted into foreign / unbound / inconsistent and reported, never counted.
  3. strict mode (default) settles only sha-bound records. legacy mode also settles records that
     carry the right contract_id but no sha, and marks the settlement bound_by_label_only.
  4. optional NENRIN cross-check: when the walk records cited by bound executions are supplied, an
     execution whose walk was produced under other terms (walk.context.contract_sha256 != this sha)
     is a deviation, clause evidence_names_other_contract.

Closes, each a self test that reproduces the attack on v1.4 first and then on v1.5:
  relabel        an execution for other terms copies this contract_id: v1.4 binds it by id and
                 counts it; v1.5 sees a different contract_sha256, lists it foreign, never settles it
  terms swap     a grant clause is edited and both parties re-sign, keeping the contract_id: v1.4
                 binds past executions to the new terms and turns them into deviations; v1.5 sees the
                 old sha on them, lists them foreign, and the edited contract has nothing bound to it
  evidence xplant a bound execution cites a NENRIN walk produced under another contract: deviation,
                 evidence_names_other_contract

Stated limits: within_grant covers only the sha-bound records; foreign and unbound records are not a
judgement that they are false, only that they do not name these exact terms. A stolen key still signs
validly (inherited from v1.2). contract_id remains as a human handle; binding is by contract_sha256.
"""
import argparse, base64, json, os, random, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import contract_v0 as v0
import settle_v1 as v1
import settle_v1_1 as v11
import settle_v1_2 as v12
import settle_v1_4 as v14
from contract_v0 import canonical, parse_strict, sha256_hex, contract_sha256, HEX64, EXEC_SCHEMA

SETTLE_SCHEMA = "a2a-settlement-v1.5"


def _bond_outcome(contract, verdict, status):
    bond = contract.get("bond")
    if not (isinstance(bond, dict) and bond.get("amount")):
        return "n/a"
    if verdict == "underspecified":
        return "undetermined"
    if status == "provisional":
        return "pending_finality"
    return "held" if verdict == "within_grant" else "forfeited"


def classify_binding(contract, events, csha):
    """Split the execution / revocation / ack records into those bound to these exact terms and the
    rest. Binding is by contract_ref.contract_sha256 == csha. Returns (bound, foreign, unbound,
    inconsistent):
      bound        contract_ref.contract_sha256 == csha, and contract_id / payload_digest agree
      foreign      contract_ref.contract_sha256 is present but != csha (belongs to other terms)
      unbound      no contract_ref.contract_sha256, but contract_ref.contract_id == this id (pre-v1.5)
      inconsistent names this sha with a mismatched contract_id or payload_digest, or a malformed sha
    A record that names neither this sha nor this contract_id is not ours and is dropped silently, as
    every layer below already does."""
    cid = contract.get("contract_id")
    pdg = (contract.get("task") or {}).get("payload_digest")
    bound, foreign, unbound, inconsistent = [], [], [], []
    seen = set()                                          # content-addressed: the same bytes twice are one record
    for ev in events:
        if not isinstance(ev, dict):
            continue
        if ev.get("schema") not in (EXEC_SCHEMA, v1.REVOKE_SCHEMA, v1.ACK_SCHEMA):
            continue
        ref = ev.get("contract_ref") if isinstance(ev.get("contract_ref"), dict) else {}
        rsha = ref.get("contract_sha256")
        s = v1.rec_sha(ev)
        if s in seen:
            continue
        seen.add(s)
        base = {"sha256": s, "schema": ev.get("schema")}
        if rsha is None:
            if ref.get("contract_id") == cid:
                unbound.append(ev)
            continue
        if not (isinstance(rsha, str) and HEX64.match(rsha)):
            inconsistent.append(dict(base, why="contract_ref.contract_sha256 is not 64 lowercase hex"))
            continue
        if rsha != csha:
            foreign.append(dict(base, contract_sha256=rsha))
            continue
        if ref.get("contract_id") != cid:
            inconsistent.append(dict(base, why="carries this contract_sha256 but a different contract_id"))
            continue
        if pdg is not None and ref.get("payload_digest") != pdg:
            inconsistent.append(dict(base, why="carries this contract_sha256 but a different payload_digest"))
            continue
        bound.append(ev)
    return bound, foreign, unbound, inconsistent


def _nenrin_deviations(used, nenrin_records, csha):
    """A bound execution whose cited walk was produced under other terms."""
    if not nenrin_records:
        return []
    walk_by_sha = {}
    for w in nenrin_records:
        if isinstance(w, dict):
            walk_by_sha[v1.rec_sha(w)] = w
    out, seen = [], set()
    for ev in used:
        if ev.get("schema") != EXEC_SCHEMA:
            continue
        s = v1.rec_sha(ev)
        if s in seen:
            continue
        seen.add(s)
        w = walk_by_sha.get(ev.get("nenrin_ref"))
        if not isinstance(w, dict):
            continue
        ctx = w.get("context") if isinstance(w.get("context"), dict) else {}
        wsha = ctx.get("contract_sha256")
        if wsha is not None and wsha != csha:
            out.append({"clause": "evidence_names_other_contract", "record_sha256": s,
                        "nenrin_ref": ev.get("nenrin_ref"), "walk_contract_sha256": wsha})
    return out


def settle_v1_5(contract, events, view, mode="strict", nenrin_records=None):
    if mode not in ("strict", "legacy"):
        raise ValueError("mode must be 'strict' or 'legacy'")
    if not isinstance(events, list):
        events = []
    csha = contract_sha256(contract)
    bound, foreign, unbound, inconsistent = classify_binding(contract, events, csha)
    used = list(bound) + (list(unbound) if mode == "legacy" else [])

    out = v14.settle_v1_4(contract, used, view)

    verdict, status = out["verdict"], out["status"]
    deviations = list(out["deviations"])
    evid = _nenrin_deviations(used, nenrin_records, csha)
    if verdict != "underspecified" and evid:
        deviations = sorted(deviations + evid, key=canonical)
        verdict = "deviation"
    bond_outcome = _bond_outcome(contract, verdict, status)
    bound_by_label_only = (mode == "legacy" and bool(unbound))

    out.update({
        "schema": SETTLE_SCHEMA,
        "settled_under": v14.SETTLE_SCHEMA,
        "contract_sha256": csha,
        "binding_mode": mode,
        "bound_by_label_only": bound_by_label_only,
        "verdict": verdict,
        "deviations": [] if verdict == "underspecified" else deviations,
        "bond_outcome": bond_outcome,
        "binding": {
            "bound": sorted(v1.rec_sha(e) for e in bound),
            "unbound": sorted(v1.rec_sha(e) for e in unbound),
            "foreign": sorted(foreign, key=canonical),
            "inconsistent": sorted(inconsistent, key=canonical),
        },
    })
    out["establishes"] = [
        "that every settled record names these terms by contract_sha256, recomputed here from the contract bytes",
    ] + out["establishes"]
    out["does_not_establish"] = out["does_not_establish"] + [
        "that records listed foreign or unbound are false; only that they do not name these exact terms, so they are not settled here",
        "that a contract_id binds anything on its own; binding is by contract_sha256, and a label can be copied onto any record",
    ]
    return out


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
    for _ in range(38):                                  # 60..97, checkpoint at 97
        base.block()
    lb = {"kind": "bitcoin_block", "height": 97, "hash": base.hashes[97]}
    DNE = ["that HS enforced any of this at runtime",
           "that the contractor obeyed the grant, only that its recorded acts match or deviate from it",
           "that HS judges liability or fault; the verdict is a function anyone recomputes",
           "that a prohibited action was impossible, only that performing one is a provable deviation",
           "that this is a legal contract or determines legal responsibility"]

    def mk(cid, authorized, prohibited, resign=None):
        g = {"authorized_actions": authorized, "prohibited_actions": prohibited,
             "delegation": {"allowed": []}, "revocation": {"effective_at": "anchor"},
             "finality": {"depth": 3, "max_target_bits": "207fffff"},
             "witnesses": [{"name": "nenrin-walker", "public_key_ed25519_b64": pw}]}
        c = v0.build_contract(
            {"domain": "gate.horizonshield.dev", "key_url": "https://gate.horizonshield.dev/keys/agreement.json", "public_key_ed25519_b64": pa},
            {"domain": "api.babyblueviper.com", "key_url": "https://api.babyblueviper.com/keys/agreement.json", "public_key_ed25519_b64": pb},
            {"purpose": "endpoint_conduct_walk", "payload_digest": PDG, "a2a_task_id": "t1"}, g,
            ["that both parties signed these grant bytes at the stated time"], DNE,
            bond={"amount": 1000, "currency": "JPY"}, lower_bound=lb,
            contract_id=cid, nonce="c" * 32, agreed_at="2026-09-24T00:00:00Z")
        v0.sign_contract(c, ka, pa, "gate.horizonshield.dev")
        v0.sign_contract(c, kb, pb, "api.babyblueviper.com")
        assert v0.verify_contract(c)["verdict"] == "accepted", v0.verify_contract(c)
        return c

    def ex(cid, csha, actions, ref="1", nenrin=None, with_sha=True):
        r = {"schema": EXEC_SCHEMA,
             "contract_ref": ({"contract_id": cid, "payload_digest": PDG, "contract_sha256": csha}
                              if with_sha else {"contract_id": cid, "payload_digest": PDG}),
             "performed_actions": list(actions), "approvals": [], "delegated_to": [],
             "nenrin_ref": nenrin or (ref * 64)[:64]}
        return v12.sign_record(r, kb, "contractor")

    def run(recs_by_block, extra=5):
        ch = base.fork(98, "r%d" % random.randint(0, 1 << 40))
        out = []
        for recs in recs_by_block:
            out += ch.block(recs) if recs else ch.block()
        for _ in range(extra):
            ch.block()
        return out, ch

    idA = "0123456789abcdef0123456789abcdef"
    idB = "fedcba9876543210fedcba9876543210"

    # [1] the definition is signing_bytes, stable across the second signature and recomputable
    cA = mk(idA, ["read", "write"], ["delete"])
    csA = contract_sha256(cA)
    assert csA == sha256_hex(v0.signing_bytes(cA))
    one = json.loads(json.dumps(cA)); one["signatures"] = one["signatures"][:1]
    assert contract_sha256(one) == csA, "sha changed when the second signature was removed"
    assert HEX64.match(csA)
    n += 1; print("[1] contract_sha256 = sha256(signing_bytes); identical with one or two signatures on the record")

    # [2] relabel: an execution really under B (delete allowed) is relabelled with A's contract_id
    cB = mk(idB, ["read", "delete"], [])                 # same keys, delete is allowed under B
    csB = contract_sha256(cB)
    assert csB != csA
    honest_B = ex(idB, csB, ["delete"], ref="1")
    relabel = json.loads(json.dumps(honest_B))
    relabel["contract_ref"]["contract_id"] = idA          # copy A's id onto B's execution
    relabel = v12.sign_record({k: v for k, v in relabel.items() if k != "signatures"}, kb, "contractor")
    recs, ch = run([[relabel]])
    v4 = v14.settle_v1_4(cA, recs, ch.view())
    v5 = settle_v1_5(cA, recs, ch.view())
    assert v4["verdict"] == "deviation" and v4["deviations"][0]["clause"] == "prohibited", v4
    assert v5["verdict"] == "within_grant" and len(v5["binding"]["foreign"]) == 1, v5
    assert v5["binding"]["foreign"][0]["contract_sha256"] == csB
    n += 1; print("[2] relabel B's 'delete' with A's contract_id: v1.4 deviation (prohibited); v1.5 lists it foreign, within_grant")

    # [3] terms swap: A is edited to prohibit 'write' and both re-sign, keeping the contract_id
    honest_A = ex(idA, csA, ["write"], ref="2")
    recs, ch = run([[honest_A]])
    assert settle_v1_5(cA, recs, ch.view())["verdict"] == "within_grant"
    cAp = mk(idA, ["read"], ["write"])                   # same id, 'write' now prohibited, freshly signed
    csAp = contract_sha256(cAp)
    assert csAp != csA
    v4 = v14.settle_v1_4(cAp, recs, ch.view())
    v5 = settle_v1_5(cAp, recs, ch.view())
    assert v4["verdict"] == "deviation" and v4["deviations"][0]["clause"] == "prohibited", v4
    assert v5["verdict"] == "within_grant" and len(v5["binding"]["foreign"]) == 1, v5
    assert v5["binding"]["foreign"][0]["contract_sha256"] == csA
    n += 1; print("[3] edit A's grant and re-sign (same contract_id): v1.4 turns a past 'write' into a deviation; "
                  "v1.5 sees the old sha, foreign, nothing bound to the edited terms")

    # [4] evidence transplant: a bound execution cites a walk produced under other terms
    walk = {"schema": "jidec-path-v1", "context": {"contract_sha256": csB}, "subject": "api.babyblueviper.com/a2a",
            "result": "pass", "nonce": "1234567890abcdef1234567890abcdef"}
    wsha = v1.rec_sha(walk)
    exe = ex(idA, csA, ["read"], ref="3", nenrin=wsha)
    recs, ch = run([[exe]])
    v5_no = settle_v1_5(cA, recs, ch.view())
    v5_ev = settle_v1_5(cA, recs, ch.view(), nenrin_records=[walk])
    assert v5_no["verdict"] == "within_grant", v5_no
    assert v5_ev["verdict"] == "deviation" and v5_ev["deviations"][0]["clause"] == "evidence_names_other_contract", v5_ev
    assert v5_ev["deviations"][0]["walk_contract_sha256"] == csB
    n += 1; print("[4] bound execution cites a walk whose context names contract B: within_grant without the walk; "
                  "deviation evidence_names_other_contract with it")

    # [5] strict vs legacy: a pre-v1.5 record (no contract_sha256) binds by label only
    v0rec = ex(idA, None, ["delete"], ref="4", with_sha=False)
    recs, ch = run([[v0rec]])
    strict = settle_v1_5(cA, recs, ch.view(), mode="strict")
    legacy = settle_v1_5(cA, recs, ch.view(), mode="legacy")
    assert strict["verdict"] == "within_grant" and len(strict["binding"]["unbound"]) == 1 and strict["bound_by_label_only"] is False, strict
    assert legacy["verdict"] == "deviation" and legacy["deviations"][0]["clause"] == "prohibited" and legacy["bound_by_label_only"] is True, legacy
    n += 1; print("[5] execution with no contract_sha256: strict lists it unbound and does not settle it; "
                  "legacy binds it by label, judges 'delete', bound_by_label_only")

    # [6] inconsistent: this sha on a record whose contract_id does not match
    bad = ex(idB, csA, ["read"], ref="5")                # names A's sha but B's id
    recs, ch = run([[bad]])
    s = settle_v1_5(cA, recs, ch.view())
    assert len(s["binding"]["inconsistent"]) == 1 and s["binding"]["bound"] == [], s
    n += 1; print("[6] record carries this contract_sha256 but a foreign contract_id: listed inconsistent, never bound")

    # [7] honest run: bound, within grant, final, bond held; a foreign record alongside is only listed
    good = ex(idA, csA, ["read"], ref="6")
    other = ex(idB, csB, ["delete"], ref="7")            # a real record for B, handed in by mistake
    recs, ch = run([[good, other]])
    s = settle_v1_5(cA, recs, ch.view())
    assert s["verdict"] == "within_grant" and s["status"] == "final" and s["bond_outcome"] == "held", s
    assert len(s["binding"]["bound"]) == 1 and len(s["binding"]["foreign"]) == 1, s["binding"]
    n += 1; print("[7] honest read bound to A, a B record alongside: within_grant, final, bond held; B listed foreign")

    # [8] determinism: same records in any order, identical settlement bytes
    ref = canonical(s)
    rng = random.Random(15)
    for _ in range(30):
        sh = recs + [dict(recs[0])]; rng.shuffle(sh)
        assert canonical(settle_v1_5(cA, sh, ch.view())) == ref, "settlement changed with input order"
    n += 1; print("[8] 30 shuffles with a duplicate: identical settlement bytes")

    # [9] every layer below still passes, unchanged
    here = os.path.dirname(os.path.abspath(__file__))
    for f, want in (("settle_v1_4.py", "11 checks"), ("correction_bundle_v0.py", "8 checks")):
        rr = subprocess.run([sys.executable, os.path.join(here, f), "--selftest"], capture_output=True, text=True)
        assert rr.returncode == 0 and want in rr.stdout, (f, rr.stdout[-400:], rr.stderr[-400:])
    n += 1; print("[9] settle_v1_4 11/11 and correction_bundle_v0 8/8 (with every layer under them) still pass")

    print("\nSELF-TEST PASSED: MUSUBI settle v1.5, %d checks (contract_sha256 binding; relabel, terms swap, "
          "evidence transplant closed; strict/legacy; determinism; regression)" % n)


def main():
    ap = argparse.ArgumentParser(description="MUSUBI settle v1.5 (binding by contract_sha256)")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--contract-sha256", metavar="CONTRACT.json",
                    help="print contract_sha256 for a contract record and exit")
    ap.add_argument("--settle", metavar="CONTRACT.json")
    ap.add_argument("--event", action="append", default=[], metavar="RECORD.json")
    ap.add_argument("--view", action="append", default=[], metavar="HEADERS.json")
    ap.add_argument("--nenrin", action="append", default=[], metavar="WALK.json")
    ap.add_argument("--mode", choices=("strict", "legacy"), default="strict")
    ap.add_argument("--out", metavar="OUT.json")
    a = ap.parse_args()
    if a.selftest:
        _selftest(); return 0
    rd = lambda p: parse_strict(open(p, encoding="utf-8").read())
    if a.contract_sha256:
        print(contract_sha256(rd(a.contract_sha256))); return 0
    if not a.settle or not a.view:
        ap.print_help(); return 1
    contract = rd(a.settle)
    views = [rd(p) for p in a.view]
    cmp = v14.compare_views_v1_4(views, contract)
    print(json.dumps({"fork_choice": cmp}, indent=2))
    if cmp["chosen"] is None:
        return 2
    nenrin = [rd(p) for p in a.nenrin] if a.nenrin else None
    s = settle_v1_5(contract, [rd(p) for p in a.event], views[cmp["chosen"]], mode=a.mode, nenrin_records=nenrin)
    if a.out:
        with open(a.out, "w", encoding="utf-8", newline="") as f:
            f.write(canonical(s))
        print("wrote", a.out)
    print(json.dumps(s, ensure_ascii=False, indent=2))
    return 0 if s["status"] == "final" else 2


if __name__ == "__main__":
    sys.exit(main())
