#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MUSUBI correction bundle v0 (a2a-correction-bundle-v0): a correction that cannot be severed from
what it corrects, and a history of corrections that cannot be quietly rewritten.

Why this file exists. Two replies on Bluesky (@tallybexro, 2026-09-24):
  "Re-running the code only makes a correction if the original claim, inputs, and evidence hashes
   remain available. Otherwise the new result can be true while quietly severing itself from what it
   claims to correct."
  "That makes the history load-bearing. If a doctored correction passes, the chain is theater."

correction_v0 pinned hashes but carried none of the bytes. Hashes of bytes nobody holds are a promise,
not evidence. And nothing linked one correction to the next, so a later correction could replace an
earlier one without a trace.

A bundle carries everything needed to re-verify it offline, forever, with no fetch:
  correction   the a2a-correction-v0 record
  claim        the exact claim bytes being corrected (as parsed JSON, signatures included)
  contract     the signed contract
  records      every record the correction was computed from
  view         the header view it was computed on
  supersedes   sha256 of the previous bundle for the same claim, or null for the first

verify_bundle(bundle) needs nothing else: every hash inside the correction must match the bytes in the
bundle, the correction must recompute from them, and the code fingerprint is compared with the code
running the check (a difference is reported, never ignored).

verify_chain([b1, b2, ...]) walks a history: every bundle verifies, all correct the same claim, the
first supersedes nothing, and each later one names the sha256 of the one before it. Doctoring,
dropping or reordering any bundle breaks a named link.

Stated limit: a chain is tamper evident relative to a head someone already holds. Rewriting everything
after bundle k and re-linking it produces a chain that verifies on its own; what exposes it is any
earlier copy, or an anchored sha256, of a bundle the rewrite no longer contains. So anchor each bundle
sha when it is issued, the same way records are anchored.

Availability is then one question with one answer: keep the bundle, or anchor its sha256 and store its
bytes where anyone can fetch them by that sha (the NENRIN ledger serves records by sha). A bundle whose
bytes are lost is lost as a whole, never half: there is no state where the correction survives but the
evidence it rests on does not.
"""
import argparse, hashlib, json, os, random, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import settle_v1 as v1
import correction_v0 as cor
from contract_v0 import canonical, parse_strict

SCHEMA = "a2a-correction-bundle-v0"


def sha(obj):
    return hashlib.sha256(canonical(obj).encode("utf-8")).hexdigest()


def build_bundle(claim, contract, records, view, supersedes=None):
    uniq = {v1.rec_sha(r): r for r in records if isinstance(r, dict)}
    recs = [uniq[k] for k in sorted(uniq)]
    return {"schema": SCHEMA,
            "correction": cor.build_correction(claim, contract, recs, view),
            "claim": claim, "contract": contract, "records": recs, "view": view,
            "supersedes": supersedes}


def verify_bundle(b):
    probs = []
    if not isinstance(b, dict) or b.get("schema") != SCHEMA:
        return {"status": "broken", "problems": ["not an %s" % SCHEMA]}
    c = b.get("correction") or {}
    inp = c.get("inputs") or {}
    if (c.get("claim") or {}).get("sha256") != sha(b.get("claim")):
        probs.append("claim bytes in the bundle do not match the claim sha the correction names")
    if inp.get("contract_sha256") != sha(b.get("contract")):
        probs.append("contract bytes do not match the contract sha")
    held = sorted(v1.rec_sha(r) for r in (b.get("records") or []) if isinstance(r, dict))
    if held != inp.get("record_sha256s"):
        missing = sorted(set(inp.get("record_sha256s") or []) - set(held))
        extra = sorted(set(held) - set(inp.get("record_sha256s") or []))
        probs.append("record bytes do not match the record shas (missing %s, extra %s)" % (missing, extra))
    code_note = None
    here = cor.code_fingerprint()
    if inp.get("code_sha256") != here:
        diff = sorted(k for k in set(here) | set(inp.get("code_sha256") or {})
                      if here.get(k) != (inp.get("code_sha256") or {}).get(k))
        code_note = "computed with different code files: %s; recomputed here with the local code" % diff
    if not probs:
        again = cor.build_correction(b["claim"], b["contract"], b["records"], b["view"])
        strip = lambda d: {k: v for k, v in d.items() if k not in ("signatures", "inputs")}
        if canonical(strip(c)) != canonical(strip(again)):
            probs.append("the correction does not recompute from the bytes it carries")
        elif canonical({k: v for k, v in (c.get("inputs") or {}).items() if k != "code_sha256"}) != \
                canonical({k: v for k, v in again["inputs"].items() if k != "code_sha256"}):
            probs.append("the pinned view or inputs do not recompute from the bytes it carries")
    out = {"status": "broken" if probs else "holds", "bundle_sha256": sha(b), "problems": probs}
    if code_note:
        out["code"] = code_note
    return out


def verify_chain(bundles):
    links, probs = [], []
    claim_sha = None
    prev = None
    for i, b in enumerate(bundles):
        r = verify_bundle(b)
        if r["status"] != "holds":
            probs.append("bundle %d does not verify: %s" % (i, r["problems"]))
        cs = ((b.get("correction") or {}).get("claim") or {}).get("sha256") if isinstance(b, dict) else None
        if claim_sha is None:
            claim_sha = cs
        elif cs != claim_sha:
            probs.append("bundle %d corrects a different claim" % i)
        want = None if prev is None else sha(prev)
        got = b.get("supersedes") if isinstance(b, dict) else "?"
        if got != want:
            probs.append("link broken at bundle %d: supersedes %s, previous bundle is %s" % (i, got, want))
        links.append({"index": i, "bundle_sha256": sha(b), "supersedes": got,
                      "status": (b.get("correction") or {}).get("status")})
        prev = b
    return {"status": "broken" if probs else "holds", "links": links, "problems": probs,
            "head_sha256": sha(prev) if prev is not None else None}


# --------------------------------------------------------------------------- self test
def _selftest():
    import base64
    import contract_v0 as v0
    import settle_v1_1 as v11
    import settle_v1_2 as v12
    import settle_v1_3 as v13
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
        contract_id="0123456789abcdef0123456789abcdef", nonce="b" * 32, agreed_at="2026-09-24T00:00:00Z")
    v0.sign_contract(c, ka, pa, "gate.horizonshield.dev"); v0.sign_contract(c, kb, pb, "api.babyblueviper.com")
    cid = c["contract_id"]

    def ex(actions, ref):
        r = v1._ex(cid, actions, 0, ref=ref); del r["anchor"]; r["approvals"] = []
        return v12.sign_record(r, kb, "contractor")

    ch = chain.fork(98, "bundle")
    r1 = ch.block([ex(["read"], "1")])
    for _ in range(4):
        ch.block()
    view1 = {"headers": list(ch.view()["headers"])}
    claim = v13.settle_v1_3(c, r1, view1)                    # a claim: within_grant, true at the time
    r2 = ch.block([ex(["delete"], "2")])                     # later evidence arrives
    for _ in range(4):
        ch.block()
    view2 = ch.view()
    recs = r1 + r2

    # [1] a bundle verifies with nothing but itself
    b1 = build_bundle(claim, c, r1, view1)
    r = verify_bundle(json.loads(canonical(b1)))
    assert r["status"] == "holds" and "code" not in r, r
    n += 1; print("[1] bundle re-verifies offline from its own bytes: holds (%s...)" % r["bundle_sha256"][:12])

    # [2] swapping the claim bytes severs it: named
    bad = json.loads(canonical(b1)); bad["claim"]["verdict"] = "deviation"
    assert verify_bundle(bad)["status"] == "broken" and "claim bytes" in verify_bundle(bad)["problems"][0]
    n += 1; print("[2] claim bytes swapped inside the bundle: broken, 'claim bytes do not match'")

    # [3] dropping a record severs it: named by sha
    b2 = build_bundle(claim, c, recs, view2, supersedes=sha(b1))
    bad = json.loads(canonical(b2)); bad["records"] = bad["records"][:1]
    r = verify_bundle(bad)
    assert r["status"] == "broken" and "missing" in r["problems"][0], r
    n += 1; print("[3] a record removed from the bundle: broken, the missing record named by sha")

    # [4] a doctored correction inside an intact bundle does not pass
    bad = json.loads(canonical(b2)); bad["correction"]["causes"] = []; bad["correction"]["status"] = "matches"
    r = verify_bundle(bad)
    assert r["status"] == "broken" and "does not recompute" in r["problems"][0], r
    n += 1; print("[4] correction doctored to 'matches' with its causes removed: broken, does not recompute")

    # [5] history: three corrections, linked; doctor, drop or reorder one and a named link breaks
    b3 = build_bundle(claim, c, recs, view2, supersedes=sha(b2))
    good = [b1, b2, b3]
    assert verify_chain(good)["status"] == "holds"
    assert b2["correction"]["status"] == "corrected"
    doctored_mid = json.loads(canonical(b2)); doctored_mid["correction"]["causes"] = []
    assert verify_chain([b1, doctored_mid, b3])["status"] == "broken"
    assert any("link broken at bundle 1" in p for p in verify_chain([b1, b3])["problems"])
    assert verify_chain([b2, b1, b3])["status"] == "broken"
    silent = build_bundle(claim, c, r1, view1, supersedes=sha(b1))        # a rewrite that hides the delete
    assert any("link broken at bundle 2" in p for p in verify_chain([b1, silent, b3])["problems"])
    n += 1; print("[5] chain of 3 holds; doctored middle, dropped middle, reordered, or a quiet rewrite swapped in: broken, link named")

    # [6] code drift is reported, not hidden
    drift = json.loads(canonical(b1)); drift["correction"]["inputs"]["code_sha256"]["settle_v1.py"] = "0" * 64
    r = verify_bundle(drift)
    assert "code" in r and "settle_v1.py" in r["code"], r
    n += 1; print("[6] bundle made with different code: verification reports which files differ")

    # [7] deterministic: records in any order give the same bundle bytes
    ref = canonical(b2)
    rng = random.Random(4)
    for _ in range(10):
        sh = list(recs); rng.shuffle(sh)
        assert canonical(build_bundle(claim, c, sh, view2, supersedes=sha(b1))) == ref
    n += 1; print("[7] bundle bytes identical over 10 shuffles of the records")

    here = os.path.dirname(os.path.abspath(__file__))
    rr = subprocess.run([sys.executable, os.path.join(here, "correction_v0.py"), "--selftest"], capture_output=True, text=True)
    assert rr.returncode == 0 and "7 checks" in rr.stdout
    n += 1; print("[8] correction_v0 7/7 (and the settlement layers under it) still pass")

    print("\nSELF-TEST PASSED: MUSUBI correction bundle v0, %d checks (self-contained, severed claim, dropped record, "
          "doctored correction, linked history, code drift)" % n)


def main():
    ap = argparse.ArgumentParser(description="MUSUBI correction bundle v0")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--verify", metavar="BUNDLE.json")
    ap.add_argument("--chain", nargs="+", metavar="BUNDLE.json", help="bundles oldest first")
    a = ap.parse_args()
    if a.selftest:
        _selftest(); return 0
    rd = lambda p: parse_strict(open(p, encoding="utf-8").read())
    if a.verify:
        r = verify_bundle(rd(a.verify)); print(json.dumps(r, indent=2)); return 0 if r["status"] == "holds" else 2
    if a.chain:
        r = verify_chain([rd(p) for p in a.chain]); print(json.dumps(r, indent=2)); return 0 if r["status"] == "holds" else 2
    ap.print_help(); return 1


if __name__ == "__main__":
    sys.exit(main())
