#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MUSUBI correction v0 (a2a-correction-v0): a recomputation that carries its own provenance.

Why this file exists. A red-team reply on Bluesky (@tallybexro, 2026-09-24): a recomputation is a
correction only if it preserves the original inputs, names the changed field, and shows why the old
result was wrong. Otherwise it is a second opinion with no provenance.

settle_v1_3.verify_claim named the changed fields and nothing else. It did not pin what it
recomputed from, and it did not say why the claim was wrong. So it was exactly what the reply
described: an opinion. This file turns it into a record.

A correction record carries:
  claim      sha256 of the claim's canonical bytes (signatures included, so a signed lie stays bound
             to its signer), plus the claim's own verdict, bond outcome and status
  inputs     sha256 of the contract, the sha256 of every record handed in (sorted), the chain view
             (tip, horizon, pins, work, rules), and the sha256 of the settlement code files used
  changes    every field where claim and recomputation differ, with both values
  causes     WHY, derived mechanically, each pointing at an input:
               record_omitted_by_claim     a record the claim's event set lacks, by sha
               record_not_in_inputs        a record the claim used that no input carries
               chain_view_differs          the claim settled on another tip / horizon / pins
               deviation_missing_in_claim  a deviation the inputs support, with its evidence sha
               deviation_without_basis     a deviation the claim asserts that no input supports
               verdict_follows             the verdict or bond differs because of the causes above
               unexplained                 a difference none of the rules above accounts for
  status     "matches" or "corrected"

The correction is itself deterministic: the same claim and inputs, in any order, give identical
bytes, and verify_correction(correction, claim, contract, records, view) recomputes it and says
whether it holds. A correction that does not recompute is not a correction.
"""
import argparse, hashlib, json, os, random, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import settle_v1 as v1
import settle_v1_1 as v11
import settle_v1_3 as v13
from contract_v0 import canonical, parse_strict

SCHEMA = "a2a-correction-v0"
CODE_FILES = ("contract_v0.py", "settle_v1.py", "settle_v1_1.py", "settle_v1_2.py", "settle_v1_3.py", "correction_v0.py")


def _sha(obj):
    return hashlib.sha256(canonical(obj).encode("utf-8")).hexdigest()


def code_fingerprint():
    here = os.path.dirname(os.path.abspath(__file__))
    return {f: hashlib.sha256(open(os.path.join(here, f), "rb").read()).hexdigest() for f in CODE_FILES}


def _dev_key(d):
    """A deviation's identity without presentation noise."""
    return canonical({k: d.get(k) for k in ("clause", "observed", "evidence_sha", "record_sha256", "revocation_sha256")})


def build_correction(claimed, contract, events, view):
    truth = v13.settle_v1_3(contract, events, view)
    claimed = claimed if isinstance(claimed, dict) else {}
    strip = lambda d: {k: v for k, v in d.items() if k != "signatures"}
    a, b = strip(claimed), strip(truth)
    changed = sorted(k for k in set(a) | set(b) if canonical(a.get(k)) != canonical(b.get(k)))

    causes = []
    c_set = {e.get("sha256") for e in (claimed.get("authoritative_event_set") or []) if isinstance(e, dict)}
    t_set = {e["sha256"] for e in truth["authoritative_event_set"]}
    input_shas = {v1.rec_sha(e) for e in events if isinstance(e, dict)}
    for s in sorted(t_set - c_set):
        causes.append({"cause": "record_omitted_by_claim", "record_sha256": s})
    for s in sorted(c_set - t_set):
        causes.append({"cause": "record_not_in_inputs" if s not in input_shas else "record_excluded_by_rules",
                       "record_sha256": s})
    for k in ("chain_tip", "finality_horizon", "pinned_blocks", "view_rules"):
        if canonical(claimed.get(k)) != canonical(truth.get(k)):
            causes.append({"cause": "chain_view_differs", "field": k, "claimed": claimed.get(k), "view": truth.get(k)})
    c_dev = {_dev_key(d): d for d in (claimed.get("deviations") or []) if isinstance(d, dict)}
    t_dev = {_dev_key(d): d for d in truth["deviations"]}
    for k in sorted(set(t_dev) - set(c_dev)):
        d = t_dev[k]
        causes.append({"cause": "deviation_missing_in_claim", "clause": d.get("clause"), "observed": d.get("observed"),
                       "evidence": d.get("record_sha256") or d.get("evidence_sha") or d.get("revocation_sha256")})
    for k in sorted(set(c_dev) - set(t_dev)):
        d = c_dev[k]
        causes.append({"cause": "deviation_without_basis", "clause": d.get("clause"), "observed": d.get("observed")})
    explained = {"authoritative_event_set", "deviations", "chain_tip", "finality_horizon", "pinned_blocks",
                 "view_rules", "ties", "revocations", "orphaned", "status", "view_work_hex",
                 "duplicate_anchorings", "authenticity", "underspecified", "establishes"}
    if any(k in changed for k in ("verdict", "bond_outcome")) and causes:
        causes.append({"cause": "verdict_follows", "claimed": {"verdict": claimed.get("verdict"), "bond_outcome": claimed.get("bond_outcome")},
                       "recomputed": {"verdict": truth["verdict"], "bond_outcome": truth["bond_outcome"]}})
        explained |= {"verdict", "bond_outcome"}
    leftover = [k for k in changed if k not in explained]
    if leftover:
        causes.append({"cause": "unexplained", "fields": leftover})

    return {
        "schema": SCHEMA,
        "status": "matches" if not changed else "corrected",
        "claim": {"sha256": _sha(claimed), "verdict": claimed.get("verdict"),
                  "bond_outcome": claimed.get("bond_outcome"), "status": claimed.get("status")},
        "inputs": {
            "contract_sha256": _sha(contract),
            "record_sha256s": sorted(input_shas),
            "view": {"chain_tip": truth["chain_tip"], "finality_horizon": truth["finality_horizon"],
                     "pinned_blocks": truth["pinned_blocks"], "view_work_hex": truth["view_work_hex"],
                     "view_rules": truth["view_rules"]},
            "code_sha256": code_fingerprint(),
        },
        "recomputed": {"sha256": _sha(strip(truth)), "verdict": truth["verdict"],
                       "bond_outcome": truth["bond_outcome"], "status": truth["status"]},
        "changes": [{"field": k, "claimed": a.get(k), "recomputed": b.get(k)} for k in changed],
        "causes": causes,
        "establishes": ["that from exactly the inputs listed, with the code listed, the settlement recomputes as stated, "
                        "and each difference from the claim is traced to the cause listed"],
        "does_not_establish": ["that the inputs are complete; a record nobody holds cannot be counted",
                               "that the claimant acted in bad faith; a claim can be wrong on an older view or an older record set"],
        "signatures": [],
    }


def verify_correction(correction, claimed, contract, events, view):
    again = build_correction(claimed, contract, events, view)
    strip = lambda d: {k: v for k, v in d.items() if k != "signatures"}
    same = canonical(strip(correction)) == canonical(strip(again))
    return {"status": "holds" if same else "does_not_recompute",
            "fields": [] if same else sorted(k for k in set(correction) | set(again)
                                             if canonical(correction.get(k)) != canonical(again.get(k)))}


# --------------------------------------------------------------------------- self test
def _selftest():
    import base64, subprocess
    import contract_v0 as v0
    import settle_v1_2 as v12
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    def newkey():
        k = Ed25519PrivateKey.generate()
        return k, base64.b64encode(k.public_key().public_bytes(serialization.Encoding.Raw,
                                                                 serialization.PublicFormat.Raw)).decode()
    ka, pa = newkey(); kb, pb = newkey()
    n = 0
    chain = v11._Chain(95, "00" * 32, "common")
    for _ in range(3):
        chain.block()
    lb = {"kind": "bitcoin_block", "height": 97, "hash": chain.hashes[97]}
    grant = {"authorized_actions": ["read", "write"], "prohibited_actions": ["delete"], "conditional": [],
             "delegation": {"allowed": []}, "revocation": {"effective_at": "anchor"},
             "finality": {"depth": 3, "max_target_bits": "207fffff"}}
    c = v0.build_contract(
        {"domain": "gate.horizonshield.dev", "key_url": "https://gate.horizonshield.dev/keys/agreement.json", "public_key_ed25519_b64": pa},
        {"domain": "api.babyblueviper.com", "key_url": "https://api.babyblueviper.com/keys/agreement.json", "public_key_ed25519_b64": pb},
        {"purpose": "endpoint_conduct_walk", "payload_digest": "a" * 64, "a2a_task_id": "t1"}, grant,
        ["that both parties signed these grant bytes at the stated time"],
        ["that HS enforced any of this at runtime",
         "that the contractor obeyed the grant, only that its recorded acts match or deviate from it",
         "that HS judges liability or fault; the verdict is a function anyone recomputes",
         "that a prohibited action was impossible, only that performing one is a provable deviation",
         "that this is a legal contract or determines legal responsibility"],
        bond={"amount": 1000, "currency": "JPY"}, lower_bound=lb,
        contract_id="0123456789abcdef0123456789abcdef", nonce="d" * 32, agreed_at="2026-09-24T00:00:00Z")
    v0.sign_contract(c, ka, pa, "gate.horizonshield.dev"); v0.sign_contract(c, kb, pb, "api.babyblueviper.com")
    cid = c["contract_id"]

    def ex(actions, ref):
        r = v1._ex(cid, actions, 0, ref=ref); del r["anchor"]; r["approvals"] = []
        return v12.sign_record(r, kb, "contractor")

    ch = chain.fork(98, "corr")
    recs = ch.block([ex(["read"], "1")]) + ch.block([ex(["delete"], "2")])
    for _ in range(5):
        ch.block()
    view = ch.view()
    truth = v13.settle_v1_3(c, recs, view)
    del_sha = [e["sha256"] for e in truth["authoritative_event_set"] if e["height"] == 99][0]

    # [1] honest claim: matches, and still carries its provenance
    r = build_correction(truth, c, recs, view)
    assert r["status"] == "matches" and not r["changes"] and len(r["inputs"]["record_sha256s"]) == 2
    assert set(r["inputs"]["code_sha256"]) == set(CODE_FILES)
    n += 1; print("[1] honest claim: matches; inputs pinned (contract sha, 2 record shas, view pins, 6 code file shas)")

    # [2] flipped verdict: fields named, and the cause points at the evidence record
    lie = json.loads(json.dumps(truth)); lie.update(verdict="within_grant", bond_outcome="held", deviations=[])
    r = build_correction(lie, c, recs, view)
    kinds = [x["cause"] for x in r["causes"]]
    assert r["status"] == "corrected" and "deviation_missing_in_claim" in kinds and "verdict_follows" in kinds
    miss = [x for x in r["causes"] if x["cause"] == "deviation_missing_in_claim"][0]
    assert miss["observed"] == "delete" and miss["evidence"] == "2" * 64 and "unexplained" not in kinds, r["causes"]
    n += 1; print("[2] claim within_grant over a real delete: corrected; cause deviation_missing_in_claim with its evidence, verdict_follows")

    # [3] a claim computed after dropping a record: the omitted record is named by sha
    partial = v13.settle_v1_3(c, recs[:1], view)
    r = build_correction(partial, c, recs, view)
    assert any(x["cause"] == "record_omitted_by_claim" and x["record_sha256"] == del_sha for x in r["causes"]), r["causes"]
    n += 1; print("[3] claim that dropped the delete record: record_omitted_by_claim %s..." % del_sha[:12])

    # [4] a claim settled on an older view: the view difference is the cause, not a mystery
    old = {"headers": view["headers"][:-3]}
    stale = v13.settle_v1_3(c, recs, old)
    r = build_correction(stale, c, recs, view)
    assert any(x["cause"] == "chain_view_differs" and x["field"] == "chain_tip" for x in r["causes"]), r["causes"]
    assert "unexplained" not in [x["cause"] for x in r["causes"]], r["causes"]
    n += 1; print("[4] claim made on an older view (tip %d vs %d): chain_view_differs, nothing unexplained"
                  % (stale["chain_tip"]["height"], truth["chain_tip"]["height"]))

    # [5] a claim that invents a deviation: named as without basis
    framed = json.loads(json.dumps(truth))
    framed["deviations"] = framed["deviations"] + [{"clause": "prohibited", "observed": "send_pii", "evidence_sha": "9" * 64}]
    r = build_correction(framed, c, recs, view)
    assert any(x["cause"] == "deviation_without_basis" and x["observed"] == "send_pii" for x in r["causes"]), r["causes"]
    n += 1; print("[5] claim that adds an invented send_pii deviation: deviation_without_basis")

    # [6] the correction is deterministic and verifiable; a doctored correction does not recompute
    base = canonical(build_correction(lie, c, recs, view))
    rng = random.Random(3)
    for _ in range(20):
        sh = list(recs); rng.shuffle(sh)
        assert canonical(build_correction(lie, c, sh, view)) == base
    corr = json.loads(base)
    assert verify_correction(corr, lie, c, recs, view)["status"] == "holds"
    doctored = json.loads(base); doctored["causes"] = doctored["causes"][:1]
    assert verify_correction(doctored, lie, c, recs, view)["status"] == "does_not_recompute"
    n += 1; print("[6] correction bytes identical over 20 shuffles; verify_correction holds; a doctored correction does not recompute")

    # [7] earlier layers unchanged
    here = os.path.dirname(os.path.abspath(__file__))
    rr = subprocess.run([sys.executable, os.path.join(here, "settle_v1_3.py"), "--selftest"], capture_output=True, text=True)
    assert rr.returncode == 0 and "9 checks" in rr.stdout, rr.stdout + rr.stderr
    n += 1; print("[7] settle_v1_3 9/9 (and every layer under it) still pass")

    print("\nSELF-TEST PASSED: MUSUBI correction v0, %d checks (provenance, named causes, omitted records, "
          "stale views, invented deviations, verifiable corrections)" % n)


def main():
    ap = argparse.ArgumentParser(description="MUSUBI correction v0 (recomputation with provenance)")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--settle", metavar="CONTRACT.json")
    ap.add_argument("--event", action="append", default=[], metavar="RECORD.json")
    ap.add_argument("--view", metavar="HEADERS.json")
    ap.add_argument("--claim", metavar="SETTLEMENT.json")
    ap.add_argument("--verify", metavar="CORRECTION.json", help="recompute a correction and say whether it holds")
    a = ap.parse_args()
    if a.selftest:
        _selftest(); return 0
    if not (a.settle and a.view and a.claim):
        ap.print_help(); return 1
    rd = lambda p: parse_strict(open(p, encoding="utf-8").read())
    contract, view, claim = rd(a.settle), rd(a.view), rd(a.claim)
    events = [rd(p) for p in a.event]
    if a.verify:
        r = verify_correction(rd(a.verify), claim, contract, events, view)
    else:
        r = build_correction(claim, contract, events, view)
    print(json.dumps(r, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
