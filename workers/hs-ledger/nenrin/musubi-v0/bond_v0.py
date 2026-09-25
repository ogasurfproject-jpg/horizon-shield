#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MUSUBI bond v0: the bond's teeth, without custody (a2a-bond-resolution-v0).

Why this file exists. The contract carries an optional bond, and every settlement since v0 computes
bond_outcome (held / forfeited / pending_finality / undetermined / n/a) as a pure function of the
contract and the records. What was missing is the step after the verdict: who actually held the
money, and what they did with it once the outcome was final. An outside review (2026-09-25) put it
plainly: the bond had a verdict but no coded consequence.

HS will not fix that by taking custody. Custody is on the refused list of every layer here (the
agreement intake refuses fee_tied_to_outcome and escrow claims; the contract verifier refuses
"escrow" and "custody" in establishes). The honest teeth are a RECORD:

  a2a-bond-resolution-v0: the bond holder states, over its own signature, what it did with the bond
  (released it back, or forfeited it to the principal), pinned to the exact terms
  (contract_sha256), the exact settlement bytes (settlement_sha256), and the outcome that
  settlement computed. Anyone can then prove one of three things:
    1. the disposition matches the recomputable outcome (honest),
    2. the disposition contradicts it (provable misconduct by the holder, priced in reputation),
    3. no resolution exists after finality (silence is visible, because the settlement is public).

Conventions this adds to the contract's bond block (build_contract already passes bond through):
    bond: { amount, currency, holder: "principal" | "contractor", reference?: <where anyone can
            observe the bond, a URL or account label>, evidence_required?: true }
  holder is WHO HOLDS THE MONEY while the contract runs: "principal" means the contractor posted a
  deposit with the principal; "contractor" means the contractor holds its own bond and pays out on
  forfeiture. A third party holder is out of v0 scope and is refused as unsettleable, not guessed.

The resolution must be signed by the party that bond.holder names, with the key pinned for that
party inside the signed contract. Nothing here moves money and nothing here is custody by HS.
"""
import argparse, base64, hashlib, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import contract_v0 as v0
from contract_v0 import canonical, parse_strict, ed25519_verify, contract_sha256, HEX64

SCHEMA = "a2a-bond-resolution-v0"
CONTEXT = b"a2a-bond-resolution-v0\n"
HOLDERS = ("principal", "contractor")
DISPOSITIONS = ("released", "forfeited_to_principal")
# which disposition is consistent with which recomputed outcome
CONSISTENT = {"held": "released", "forfeited": "forfeited_to_principal"}


def settlement_sha256(settlement):
    return hashlib.sha256(canonical(settlement).encode("utf-8")).hexdigest()


def resolution_signing_bytes(rec):
    body = {k: v for k, v in rec.items() if k != "signatures"}
    return CONTEXT + canonical(body).encode("utf-8")


def build_bond_resolution(contract, settlement, disposition, evidence=None, resolved_at=None):
    """Assemble the UNSIGNED resolution. The holder signs it with its contract key."""
    bond = contract.get("bond") if isinstance(contract.get("bond"), dict) else {}
    rec = {
        "schema": SCHEMA,
        "contract_ref": {"contract_id": contract.get("contract_id"),
                         "contract_sha256": contract_sha256(contract)},
        "settlement_sha256": settlement_sha256(settlement),
        "settlement_schema": settlement.get("schema"),
        "settlement_verdict": settlement.get("verdict"),
        "settlement_status": settlement.get("status"),
        "bond": {"amount": bond.get("amount"), "currency": bond.get("currency"),
                 "holder": bond.get("holder"), "reference": bond.get("reference")},
        "bond_outcome_recomputed": settlement.get("bond_outcome"),
        "disposition": disposition,
        "evidence": evidence,
        "resolved_at": resolved_at,
        "establishes": [
            "that the bond holder named here states, over its own signature, what it did with the bond",
            "that this statement is pinned to exactly these terms (contract_sha256) and exactly this settlement (settlement_sha256)",
            "that a disposition contradicting the recomputable outcome is provable from these bytes alone",
        ],
        "does_not_establish": [
            "that money actually moved; only the signed statement and any evidence pinned here",
            "that HS held, holds, or moved anything; the holder is a party, never the recorder",
            "that the settlement it pins is final; check its status and finality horizon yourself",
            "that this is a legal determination of ownership",
        ],
        "signatures": [],
    }
    return rec


def sign_bond_resolution(rec, key, role):
    sig = base64.b64encode(key.sign(resolution_signing_bytes(rec))).decode("ascii")
    rec.setdefault("signatures", []).append({"role": role, "alg": "ed25519", "sig_b64": sig})
    return rec


def verify_bond_resolution(resolution, contract, settlement):
    """Offline. Returns {verdict, problems, findings}. verdict: consistent / contradicts / unsettleable.
    'contradicts' is not a judgment of fault; it is the provable statement that the holder's signed
    disposition and the recomputable outcome disagree."""
    problems, findings = [], []
    if not isinstance(resolution, dict) or resolution.get("schema") != SCHEMA:
        return {"verdict": "unsettleable", "problems": [{"reason": "bad_schema"}], "findings": []}

    csha = contract_sha256(contract)
    ref = resolution.get("contract_ref") if isinstance(resolution.get("contract_ref"), dict) else {}
    if ref.get("contract_sha256") != csha:
        problems.append({"reason": "contract_sha_mismatch", "carried": ref.get("contract_sha256"), "recomputed": csha})
    ssha = settlement_sha256(settlement)
    if resolution.get("settlement_sha256") != ssha:
        problems.append({"reason": "settlement_sha_mismatch", "carried": resolution.get("settlement_sha256"), "recomputed": ssha})
    if settlement.get("contract_sha256") not in (None, csha):
        problems.append({"reason": "settlement_names_other_contract", "carried": settlement.get("contract_sha256")})

    bond = contract.get("bond") if isinstance(contract.get("bond"), dict) else None
    if not (bond and bond.get("amount")):
        problems.append({"reason": "no_bond_in_contract"})
        holder = None
    else:
        holder = bond.get("holder")
        if holder not in HOLDERS:
            problems.append({"reason": "holder_unspecified_or_unsupported",
                             "detail": "bond.holder must be one of %s; a third party holder is out of v0 scope" % (HOLDERS,)})
            holder = None

    disp = resolution.get("disposition")
    if disp not in DISPOSITIONS:
        problems.append({"reason": "bad_disposition", "carried": disp})

    # signature: the party bond.holder names, with the key pinned in the signed contract
    keys = {p.get("role"): p.get("public_key_ed25519_b64") for p in (contract.get("parties") or []) if isinstance(p, dict)}
    signed_ok = False
    if holder:
        msg = resolution_signing_bytes(resolution)
        for s in (resolution.get("signatures") or []):
            if isinstance(s, dict) and s.get("role") == holder and ed25519_verify(keys.get(holder), s.get("sig_b64"), msg) is True:
                signed_ok = True
        if not signed_ok:
            problems.append({"reason": "not_signed_by_holder", "holder": holder})

    outcome = settlement.get("bond_outcome")
    if resolution.get("bond_outcome_recomputed") != outcome:
        problems.append({"reason": "outcome_misquoted", "carried": resolution.get("bond_outcome_recomputed"), "recomputed": outcome})

    if problems:
        return {"verdict": "unsettleable", "problems": sorted(problems, key=canonical), "findings": findings}

    if outcome in ("pending_finality", "undetermined"):
        findings.append({"code": "disposition_before_final",
                         "why": "the settlement's bond_outcome is %s; a disposition now is the holder's own risk, on the record" % outcome})
        return {"verdict": "premature", "problems": [], "findings": findings}
    if outcome == "n/a":
        return {"verdict": "unsettleable", "problems": [{"reason": "no_bond_outcome"}], "findings": findings}

    expected = CONSISTENT.get(outcome)
    if disp == expected:
        return {"verdict": "consistent", "problems": [], "findings": findings}
    return {"verdict": "contradicts", "problems": [],
            "findings": findings + [{"code": "disposition_contradicts_settlement",
                                     "why": "outcome %s calls for %s, the holder signed %s; provable from these bytes" % (outcome, expected, disp)}]}


# --------------------------------------------------------------------------- self test
def _selftest():
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    import settle_v1_1 as v11, settle_v1_2 as v12, settle_v1_6 as v16
    import random

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

    def mk(bond):
        g = {"authorized_actions": ["read"], "prohibited_actions": ["delete"], "delegation": {"allowed": []},
             "revocation": {"effective_at": "anchor"}, "finality": {"depth": 3, "max_target_bits": "207fffff"},
             "witnesses": [{"name": "w", "public_key_ed25519_b64": pw}]}
        c = v0.build_contract(
            {"domain": "gate.horizonshield.dev", "key_url": "https://gate.horizonshield.dev/keys/agreement.json", "public_key_ed25519_b64": pa},
            {"domain": "api.babyblueviper.com", "key_url": "https://api.babyblueviper.com/keys/agreement.json", "public_key_ed25519_b64": pb},
            {"purpose": "endpoint_conduct_walk", "payload_digest": PDG, "a2a_task_id": "t1"}, g,
            ["that both parties signed these grant bytes at the stated time"], DNE,
            bond=bond, lower_bound=lb, contract_id="0123456789abcdef0123456789abcdef", nonce="c" * 32,
            agreed_at="2026-09-24T00:00:00Z")
        v0.sign_contract(c, ka, pa, "gate.horizonshield.dev"); v0.sign_contract(c, kb, pb, "api.babyblueviper.com")
        return c

    def ex(c, actions, ref="1"):
        r = {"schema": v0.EXEC_SCHEMA,
             "contract_ref": {"contract_id": c["contract_id"], "payload_digest": PDG, "contract_sha256": contract_sha256(c)},
             "performed_actions": list(actions), "approvals": [], "delegated_to": [], "nenrin_ref": (ref * 64)[:64]}
        return v12.sign_record(r, kb, "contractor")

    def settle(c, actions):
        ch = base.fork(98, "b%d" % random.randint(0, 1 << 40))
        recs = ch.block([ex(c, actions)])
        for _ in range(5):
            ch.block()
        return v16.settle_v1_6(c, recs, ch.view())

    BOND = {"amount": 50000, "currency": "JPY", "holder": "principal",
            "reference": "https://gate.horizonshield.dev/bond/first-contract"}

    # [1] honest release: within_grant, holder principal signs released
    c = mk(BOND)
    s_ok = settle(c, ["read"])
    assert s_ok["bond_outcome"] == "held", s_ok["bond_outcome"]
    r = build_bond_resolution(c, s_ok, "released", evidence={"note": "deposit returned", "tx": "f" * 64})
    sign_bond_resolution(r, ka, "principal")
    out = verify_bond_resolution(r, c, s_ok)
    assert out["verdict"] == "consistent", out
    n += 1; print("[1] within_grant, holder=principal signs released: consistent")

    # [2] honest forfeiture: deviation, released would contradict; forfeited_to_principal is consistent
    s_bad = settle(c, ["delete"])
    assert s_bad["bond_outcome"] == "forfeited"
    r2 = build_bond_resolution(c, s_bad, "forfeited_to_principal")
    sign_bond_resolution(r2, ka, "principal")
    assert verify_bond_resolution(r2, c, s_bad)["verdict"] == "consistent"
    n += 1; print("[2] deviation, holder signs forfeited_to_principal: consistent")

    # [3] the holder keeps the deposit despite within_grant: contradicts, provable
    r3 = build_bond_resolution(c, s_ok, "forfeited_to_principal")
    sign_bond_resolution(r3, ka, "principal")
    out = verify_bond_resolution(r3, c, s_ok)
    assert out["verdict"] == "contradicts" and out["findings"][0]["code"] == "disposition_contradicts_settlement", out
    n += 1; print("[3] outcome held but holder signs forfeited_to_principal: contradicts, named in findings")

    # [4] a resolution pinned to other terms, or to tampered settlement bytes, never settles
    c2 = mk(dict(BOND, amount=99))
    out = verify_bond_resolution(r, c2, s_ok)
    assert out["verdict"] == "unsettleable" and any(p["reason"] == "contract_sha_mismatch" for p in out["problems"])
    tam = json.loads(json.dumps(s_ok)); tam["bond_outcome"] = "forfeited"
    out = verify_bond_resolution(r, c, tam)
    assert out["verdict"] == "unsettleable" and any(p["reason"] == "settlement_sha_mismatch" for p in out["problems"])
    n += 1; print("[4] other terms -> contract_sha_mismatch; edited settlement bytes -> settlement_sha_mismatch")

    # [5] only the named holder's signature counts; the contractor cannot resolve a principal-held bond
    r5 = build_bond_resolution(c, s_ok, "released")
    sign_bond_resolution(r5, kb, "principal")                      # contractor's key claiming the principal role
    out = verify_bond_resolution(r5, c, s_ok)
    assert out["verdict"] == "unsettleable" and any(p["reason"] == "not_signed_by_holder" for p in out["problems"])
    r5b = build_bond_resolution(c, s_ok, "released")
    sign_bond_resolution(r5b, kb, "contractor")
    out = verify_bond_resolution(r5b, c, s_ok)
    assert out["verdict"] == "unsettleable" and any(p["reason"] == "not_signed_by_holder" for p in out["problems"])
    n += 1; print("[5] resolution not signed by the named holder (wrong key or wrong role): unsettleable")

    # [6] provisional settlement: a disposition now is premature, on the record
    cprov = mk(BOND)
    ch = base.fork(98, "prov")
    recs = ch.block([ex(cprov, ["read"])])
    ch.block()                                                      # tip too close: provisional
    import settle_v1_6 as v16b
    sp = v16b.settle_v1_6(cprov, recs, ch.view())
    assert sp["bond_outcome"] == "pending_finality", sp["bond_outcome"]
    rp = build_bond_resolution(cprov, sp, "released"); sign_bond_resolution(rp, ka, "principal")
    out = verify_bond_resolution(rp, cprov, sp)
    assert out["verdict"] == "premature" and out["findings"][0]["code"] == "disposition_before_final", out
    n += 1; print("[6] disposition while pending_finality: premature, holder's own risk on the record")

    # [7] third party holder or missing holder: refused as unsettleable, never guessed
    c7 = mk({"amount": 1, "currency": "JPY", "holder": "third_party:escrow.example"})
    s7 = settle(c7, ["read"])
    r7 = build_bond_resolution(c7, s7, "released"); sign_bond_resolution(r7, ka, "principal")
    out = verify_bond_resolution(r7, c7, s7)
    assert out["verdict"] == "unsettleable" and any(p["reason"] == "holder_unspecified_or_unsupported" for p in out["problems"])
    n += 1; print("[7] third party holder: out of v0 scope, unsettleable, not guessed")

    print("\nSELF-TEST PASSED: MUSUBI bond v0, %d checks (release, forfeiture, contradiction, pins, holder signature, finality, scope)" % n)


def main():
    ap = argparse.ArgumentParser(description="MUSUBI bond v0 (a2a-bond-resolution-v0, teeth without custody)")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--verify", metavar="RESOLUTION.json")
    ap.add_argument("--contract", metavar="CONTRACT.json")
    ap.add_argument("--settlement", metavar="SETTLEMENT.json")
    a = ap.parse_args()
    if a.selftest:
        _selftest(); return 0
    if a.verify and a.contract and a.settlement:
        rd = lambda p: parse_strict(open(p, encoding="utf-8").read())
        out = verify_bond_resolution(rd(a.verify), rd(a.contract), rd(a.settlement))
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0 if out["verdict"] == "consistent" else 2
    ap.print_help(); return 1


if __name__ == "__main__":
    sys.exit(main())
