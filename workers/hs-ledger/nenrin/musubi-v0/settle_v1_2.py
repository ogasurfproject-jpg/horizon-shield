#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MUSUBI settle v1.2: authenticated settlement (a2a-settlement-v1.2).

Why this file exists. v1.1 made ordering fork-aware and proof-checked, but it still believed what a
record SAID about who wrote it. Anchoring is permissionless (anyone can timestamp anything), so:
  a. a third party could anchor a revocation that merely says revoked_by "principal", end the grant,
     and turn every later act of an honest contractor into a deviation (bond forfeited: a frame);
  b. a contractor could write approvals:[{"action": "write"}] into its own execution record and pass
     a conditional action the principal never approved (a hidden deviation);
  c. anyone could anchor an execution record that puts acts in the contractor's name.
And contract.expiry is a wall-clock date that no settlement ever read, so work after expiry passed.

What v1.2 adds, on top of v1.1 (v1.1, v1 and v0 are untouched):
  1. The contract itself must verify (contract_v0.verify_contract: both parties signed, keys pinned
     inside the signed bytes). Every key used below comes from that verified contract, never from a
     record, so no record can bring its own key.
  2. Every record must be signed, before anchoring, by the party its schema requires:
       a2a-execution-v0        the contractor, or a witness named in the signed grant (grant.witnesses)
       a2a-revocation-v0       the principal
       a2a-revocation-ack-v0   the contractor
     Signing bytes: context line + canonical(record without "signatures" and "anchor"). A record that
     fails is rejected by sha and does not enter the event set. Records are bound to one contract by
     contract_ref inside the signed bytes, so a signature cannot be replayed into another contract.
  3. An approval inside an execution record counts only if it carries the principal's signature over
     (contract_id, payload_digest, action). A contractor record that claims an approval without that
     signature is itself a deviation, clause forged_approval: claiming consent you did not get is
     misconduct, not a formality.
  4. Expiry is a chain coordinate: grant.expiry_height. An execution anchored above it is a
     deviation, clause after_expiry. The wall-clock contract.expiry is not used by settlement.

Stated limits (written into every settlement): a stolen key signs validly; key compromise and
rotation are outside this function. An approval covers its action for the life of the contract once
it is anchored. Absence of signed evidence is not evidence of compliance: within_grant covers only
the accepted records.
"""
import argparse, base64, json, os, random, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import contract_v0 as v0
import settle_v1 as v1
import settle_v1_1 as v11
from contract_v0 import canonical, parse_strict, ed25519_verify, EXEC_SCHEMA

SETTLE_SCHEMA = "a2a-settlement-v1.2"
RECORD_CONTEXT = {
    EXEC_SCHEMA: b"a2a-execution-v0\n",
    v1.REVOKE_SCHEMA: b"a2a-revocation-v0\n",
    v1.ACK_SCHEMA: b"a2a-revocation-ack-v0\n",
}
APPROVAL_CONTEXT = b"a2a-approval-v0\n"
REQUIRED = {EXEC_SCHEMA: ("contractor", "witness"), v1.REVOKE_SCHEMA: ("principal",), v1.ACK_SCHEMA: ("contractor",)}


def record_signing_bytes(rec):
    body = {k: v for k, v in rec.items() if k not in ("signatures", "anchor")}
    return RECORD_CONTEXT[rec["schema"]] + canonical(body).encode("utf-8")


def approval_signing_bytes(contract_id, payload_digest, action):
    return APPROVAL_CONTEXT + canonical({"contract_id": contract_id, "payload_digest": payload_digest,
                                         "action": action}).encode("utf-8")


def _keys(contract):
    k = {}
    for p in contract.get("parties") or []:
        if isinstance(p, dict) and p.get("role") in ("principal", "contractor"):
            k[p["role"]] = p.get("public_key_ed25519_b64")
    wit = {}
    for w in ((contract.get("grant") or {}).get("witnesses") or []):
        if isinstance(w, dict) and isinstance(w.get("name"), str):
            wit[w["name"]] = w.get("public_key_ed25519_b64")
    return k, wit


def authenticate(rec, contract):
    """None when the record is signed by a party its schema allows; a reason otherwise."""
    keys, wit = _keys(contract)
    allowed = REQUIRED.get(rec.get("schema"))
    if not allowed:
        return "unknown schema"
    msg = record_signing_bytes(rec)
    sigs = rec.get("signatures")
    if not isinstance(sigs, list) or not sigs:
        return "unsigned"
    for s in sigs:
        if not isinstance(s, dict) or s.get("role") not in allowed:
            continue
        pub = wit.get(s.get("witness_name")) if s["role"] == "witness" else keys.get(s["role"])
        if pub and ed25519_verify(pub, s.get("sig_b64"), msg) is True:
            return None
    return "no valid signature from %s" % " or ".join(allowed)


def forged_approvals(rec, contract):
    """Approval entries in an execution record that the principal did not sign."""
    if rec.get("schema") != EXEC_SCHEMA:
        return []
    keys, _ = _keys(contract)
    cid, pdg = contract.get("contract_id"), (contract.get("task") or {}).get("payload_digest")
    bad = []
    for ap in rec.get("approvals") or []:
        if not isinstance(ap, dict):
            bad.append({"action": None, "why": "approval entry is not an object"})
            continue
        ok = keys.get("principal") and ed25519_verify(
            keys["principal"], ap.get("sig_b64"), approval_signing_bytes(cid, pdg, ap.get("action"))) is True
        if not ok:
            bad.append({"action": ap.get("action"), "why": "no principal signature over this approval"})
    return bad


def settle_v1_2(contract, events, view):
    grant = contract.get("grant") or {}
    cv = v0.verify_contract(contract)
    if cv.get("verdict") != "accepted":
        base = v11.settle_v1_1(contract, [], view)
        base.update({"schema": SETTLE_SCHEMA, "verdict": "underspecified", "status": "undetermined",
                     "deviations": [], "bond_outcome": "undetermined" if (contract.get("bond") or {}).get("amount") else "n/a",
                     "authenticity": {"contract": "refused", "contract_refusals": cv.get("refusals"),
                                      "rejected": [], "forged_approvals": []}})
        base["underspecified"] = sorted(base["underspecified"] + [{"reason": "contract_not_verified"}], key=canonical)
        return base

    accepted, rejected, forged, by_sha, seen = [], [], [], {}, set()
    for ev in v1.bind(contract, events):
        s = v1.rec_sha(ev)
        if s in seen:
            continue
        seen.add(s)
        why = authenticate(ev, contract)
        if why:
            rejected.append({"sha256": s, "schema": ev.get("schema"), "why": why})
            continue
        accepted.append(ev)
        by_sha[s] = ev
        for fa in forged_approvals(ev, contract):
            forged.append(dict(fa, sha256=s))

    out = v11.settle_v1_1(contract, accepted, view)
    extra = []
    for fa in forged:
        extra.append({"clause": "forged_approval", "observed": fa["action"], "why": fa["why"],
                      "record_sha256": fa["sha256"]})
    exp = grant.get("expiry_height")
    under = list(out["underspecified"])
    if exp is not None and (isinstance(exp, bool) or not isinstance(exp, int) or exp < 0):
        under.append({"reason": "bad_expiry_height", "detail": "grant.expiry_height must be a non negative integer"})
        exp = None
    if exp is not None:
        for e in out["authoritative_event_set"]:
            if e["kind"] == "execution" and e["height"] > exp:
                ev = by_sha.get(e["sha256"])
                for act in (ev.get("performed_actions") or []) if ev else []:
                    extra.append({"clause": "after_expiry", "observed": act, "height": e["height"],
                                  "expiry_height": exp, "record_sha256": e["sha256"]})

    under = sorted(under, key=canonical)
    verdict = "underspecified" if under else ("deviation" if (out["deviations"] or extra) else "within_grant")
    deviations = [] if verdict == "underspecified" else out["deviations"] + sorted(extra, key=canonical)
    status = out["status"] if verdict != "underspecified" else "undetermined"
    bond = contract.get("bond")
    if not (isinstance(bond, dict) and bond.get("amount")):
        bond_outcome = "n/a"
    elif verdict == "underspecified":
        bond_outcome = "undetermined"
    elif status == "provisional":
        bond_outcome = "pending_finality"
    else:
        bond_outcome = "held" if verdict == "within_grant" else "forfeited"

    out.update({
        "schema": SETTLE_SCHEMA,
        "settled_under": v11.SETTLE_SCHEMA,
        "verdict": verdict,
        "status": status,
        "underspecified": under,
        "deviations": deviations,
        "bond_outcome": bond_outcome,
        "expiry_height": exp,
        "authenticity": {"contract": "verified",
                         "rejected": sorted(rejected, key=lambda r: r["sha256"]),
                         "forged_approvals": sorted(forged, key=canonical)},
    })
    out["establishes"] = [
        "that the contract verified with both parties' signatures, and every record used was signed by the party its schema requires",
    ] + out["establishes"]
    out["does_not_establish"] = out["does_not_establish"] + [
        "that no key was stolen; a stolen key signs validly, and rotation or compromise is outside this function",
        "that the absence of signed evidence means compliance; within_grant covers only the accepted records",
        "anything about contract.expiry (a clock); only grant.expiry_height is settled",
    ]
    return out


# --------------------------------------------------------------------------- signing helpers
def sign_record(rec, key, role, witness_name=None):
    sig = base64.b64encode(key.sign(record_signing_bytes(rec))).decode("ascii")
    e = {"role": role, "sig_b64": sig}
    if witness_name:
        e["witness_name"] = witness_name
    rec.setdefault("signatures", []).append(e)
    return rec


def sign_approval(key, contract, action):
    cid, pdg = contract["contract_id"], (contract.get("task") or {}).get("payload_digest")
    return {"action": action, "by": "principal",
            "sig_b64": base64.b64encode(key.sign(approval_signing_bytes(cid, pdg, action))).decode("ascii")}


# --------------------------------------------------------------------------- self test
def _selftest():
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    def newkey():
        k = Ed25519PrivateKey.generate()
        return k, base64.b64encode(k.public_key().public_bytes(serialization.Encoding.Raw,
                                                                 serialization.PublicFormat.Raw)).decode()

    ka, pa = newkey(); kb, pb = newkey(); kw, pw = newkey(); kx, px = newkey()   # principal, contractor, witness, stranger
    n = 0

    chain = v11._Chain(95, "00" * 32, "common")
    for _ in range(3):
        chain.block()
    lb = {"kind": "bitcoin_block", "height": 97, "hash": chain.hashes[97]}

    def make_contract(expiry_height=None, tamper=False):
        grant = {"authorized_actions": ["read", "write"], "prohibited_actions": ["delete"],
                 "conditional": [{"action": "write", "requires": "principal_approval"}],
                 "delegation": {"allowed": []}, "revocation": {"effective_at": "anchor"},
                 "finality": {"depth": 3, "max_target_bits": "207fffff"},
                 "witnesses": [{"name": "nenrin-walker", "public_key_ed25519_b64": pw}]}
        if expiry_height is not None:
            grant["expiry_height"] = expiry_height
        principal = {"domain": "gate.horizonshield.dev", "key_url": "https://gate.horizonshield.dev/keys/agreement.json",
                     "public_key_ed25519_b64": pa}
        contractor = {"domain": "api.babyblueviper.com", "key_url": "https://api.babyblueviper.com/keys/agreement.json",
                      "public_key_ed25519_b64": pb}
        task = {"purpose": "endpoint_conduct_walk", "payload_digest": "a" * 64, "a2a_task_id": "t1"}
        c = v0.build_contract(principal, contractor, task, grant,
                              ["that both parties signed these grant bytes at the stated time"],
                              ["that HS enforced any of this at runtime",
                               "that the contractor obeyed the grant, only that its recorded acts match or deviate from it",
                               "that HS judges liability or fault; the verdict is a function anyone recomputes",
                               "that a prohibited action was impossible, only that performing one is a provable deviation",
                               "that this is a legal contract or determines legal responsibility"],
                              bond={"amount": 1000, "currency": "JPY"}, lower_bound=lb,
                              contract_id="0123456789abcdef0123456789abcdef", nonce="f" * 32,
                              agreed_at="2026-09-24T00:00:00Z")
        v0.sign_contract(c, ka, pa, "gate.horizonshield.dev")
        v0.sign_contract(c, kb, pb, "api.babyblueviper.com")
        if tamper:
            c["grant"]["prohibited_actions"] = []
        return c

    c = make_contract()
    cid = c["contract_id"]
    assert v0.verify_contract(c)["verdict"] == "accepted", v0.verify_contract(c)

    def ex(actions, approvals=(), signer=("contractor", kb), ref="1"):
        r = v1._ex(cid, actions, 0, ref=ref); del r["anchor"]
        r["approvals"] = list(approvals)
        role, key = signer
        return sign_record(r, key, role, "nenrin-walker" if role == "witness" else None)

    def rv(signer=("principal", ka), revoked_by="principal"):
        r = v1._rv(cid, 0); del r["anchor"]; r["revoked_by"] = revoked_by
        return sign_record(r, signer[1], signer[0])

    def settle(con, recs_by_block, extra_blocks=5, base=None):
        ch = base or chain.fork(98, "run%d" % random.randint(0, 1 << 30))
        out = []
        for recs in recs_by_block:
            out += ch.block(recs) if recs else ch.block()
        for _ in range(extra_blocks):
            ch.block()
        return settle_v1_2(con, out, ch.view()), out, ch

    # [1] honest run: signed action, final, within grant
    s, _, _ = settle(c, [[ex(["read"])]])
    assert s["verdict"] == "within_grant" and s["status"] == "final" and s["bond_outcome"] == "held", s
    n += 1; print("[1] contractor-signed action, verified contract: within_grant, final, bond held")

    # [2] the frame: forged revocation (says principal, signed by a stranger) cannot end the grant
    s, _, _ = settle(c, [[rv(signer=("principal", kx))], [ex(["read"])]])
    assert s["verdict"] == "within_grant" and s["authenticity"]["rejected"][0]["schema"] == v1.REVOKE_SCHEMA, s
    n += 1; print("[2] frame attempt: revocation claiming the principal, signed by a stranger: rejected, grant stands")

    # [3] genuine revocation still works
    s, _, _ = settle(c, [[rv()], [ex(["read"])]])
    assert s["verdict"] == "deviation" and s["deviations"][0]["clause"] == "revoked", s
    n += 1; print("[3] principal-signed revocation, action after it: deviation, clause revoked")

    # [4] hidden deviation: contractor writes an approval it never got
    s, _, _ = settle(c, [[ex(["write"], approvals=[{"action": "write", "by": "principal"}])]])
    assert s["verdict"] == "deviation" and any(d["clause"] == "forged_approval" for d in s["deviations"]), s
    n += 1; print("[4] contractor self-written approval: deviation, clause forged_approval")

    # [5] a real principal-signed approval passes
    s, _, _ = settle(c, [[ex(["write"], approvals=[sign_approval(ka, c, "write")])]])
    assert s["verdict"] == "within_grant", s
    n += 1; print("[5] principal-signed approval: within_grant")

    # [6] an approval signed for another action does not transfer
    ap = sign_approval(ka, c, "read"); ap["action"] = "write"
    s, _, _ = settle(c, [[ex(["write"], approvals=[ap])]])
    assert s["verdict"] == "deviation" and any(d["clause"] == "forged_approval" for d in s["deviations"]), s
    n += 1; print("[6] approval signed for 'read' relabelled 'write': forged_approval")

    # [7] acts put in the contractor's name by a stranger: rejected, not counted against the contractor
    s, _, _ = settle(c, [[ex(["delete"], signer=("contractor", kx))]])
    assert s["verdict"] == "within_grant" and s["authenticity"]["rejected"][0]["why"].startswith("no valid signature"), s
    n += 1; print("[7] 'delete' in the contractor's name signed by a stranger: rejected, contractor not framed")

    # [8] a witness named in the signed grant can attest acts; a witness not named cannot
    s, _, _ = settle(c, [[ex(["delete"], signer=("witness", kw))]])
    assert s["verdict"] == "deviation" and s["deviations"][0]["clause"] == "prohibited", s
    s, _, _ = settle(c, [[ex(["delete"], signer=("witness", kx))]])
    assert s["verdict"] == "within_grant" and s["authenticity"]["rejected"], s
    n += 1; print("[8] named witness attests 'delete': deviation; unnamed witness: rejected")

    # [9] tampering after signing: the record's signature no longer verifies
    r = ex(["read"]); r["performed_actions"] = ["delete"]
    s, _, _ = settle(c, [[r]])
    assert s["verdict"] == "within_grant" and s["authenticity"]["rejected"], s
    n += 1; print("[9] action changed after the contractor signed: rejected")

    # [10] the contract itself must verify
    bad = make_contract(tamper=True)
    s, _, _ = settle(bad, [[ex(["read"])]])
    assert s["verdict"] == "underspecified" and any(u["reason"] == "contract_not_verified" for u in s["underspecified"]), s
    n += 1; print("[10] contract changed after both signed: contract_not_verified, no verdict")

    # [11] expiry by height: act at or below it passes, above it is a deviation
    ce = make_contract(expiry_height=99)
    s, _, _ = settle(ce, [[ex(["read"])]])            # anchored at 98
    assert s["verdict"] == "within_grant", s
    s, _, _ = settle(ce, [None, None, [ex(["read"])]])  # anchored at 100
    assert s["verdict"] == "deviation" and s["deviations"][0]["clause"] == "after_expiry", s
    n += 1; print("[11] expiry_height 99: act at 98 within, act at 100 deviation after_expiry")

    # [12] order and duplicates still do not matter
    s0, recs, ch = settle(c, [[rv()], [ex(["read"], ref="2")], [ex(["write"], approvals=[sign_approval(ka, c, "write")], ref="3")]])
    ref = canonical(s0)
    rng = random.Random(7)
    for _ in range(30):
        sh = recs + [dict(recs[1])]; rng.shuffle(sh)
        assert canonical(settle_v1_2(c, sh, ch.view())) == ref
    n += 1; print("[12] 30 shuffles with duplicates: settlement bytes identical")

    # [13] earlier layers unchanged
    here = os.path.dirname(os.path.abspath(__file__))
    for f, want in (("settle_v1.py", "11 checks"), ("settle_v1_1.py", "11 checks"), ("contract_v0.py", "SELF-TEST PASSED")):
        rr = subprocess.run([sys.executable, os.path.join(here, f), "--selftest"], capture_output=True, text=True)
        assert rr.returncode == 0 and want in rr.stdout, f
    n += 1; print("[13] contract_v0 6/6, settle_v1 11/11, settle_v1_1 11/11 still pass")

    print("\nSELF-TEST PASSED: MUSUBI settle v1.2, %d checks (contract verify, record signatures, frames, "
          "forged approvals, witnesses, tamper, expiry height)" % n)


def main():
    ap = argparse.ArgumentParser(description="MUSUBI settle v1.2 (authenticated settlement)")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--settle", metavar="CONTRACT.json")
    ap.add_argument("--event", action="append", default=[], metavar="RECORD.json")
    ap.add_argument("--view", action="append", default=[], metavar="HEADERS.json")
    ap.add_argument("--out", metavar="OUT.json")
    a = ap.parse_args()
    if a.selftest:
        _selftest(); return 0
    if not a.settle or not a.view:
        ap.print_help(); return 1
    contract = parse_strict(open(a.settle, encoding="utf-8").read())
    views = [parse_strict(open(p, encoding="utf-8").read()) for p in a.view]
    cmp = v11.compare_views(views, contract)
    print(json.dumps({"fork_choice": cmp}, indent=2))
    if cmp["chosen"] is None:
        return 2
    events = [parse_strict(open(p, encoding="utf-8").read()) for p in a.event]
    s = settle_v1_2(contract, events, views[cmp["chosen"]])
    if a.out:
        with open(a.out, "w", encoding="utf-8", newline="") as f:
            f.write(canonical(s))
        print("wrote", a.out)
    print(json.dumps(s, ensure_ascii=False, indent=2))
    return 0 if s["status"] == "final" else 2


if __name__ == "__main__":
    sys.exit(main())
