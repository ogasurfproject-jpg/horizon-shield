#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MUSUBI offer v0: negotiation as a chain of content digests (a2a-offer-v0).

Why this file exists. A commercial extension the outside world compares MUSUBI to (A202) carries a
signed offer / counteroffer / acceptance state machine. MUSUBI had the end state only: a contract
both parties sign. The negotiation that produced it lived nowhere. With contract_sha256 in hand the
whole state machine collapses into one rule that MUSUBI already lives by: every proposal is a set of
exact bytes, named by its digest, and every reply names the digest it replies to.

  offer          a2a-offer-v0: { by, in_reply_to, draft: <unsigned a2a-contract-v0>, ... },
                 signed by the offering party with the key the draft itself pins for that party.
                 offer_sha256 = sha256(b"a2a-offer-v0\\n" + canonical(offer minus signatures))
  counteroffer   an offer whose in_reply_to names the previous offer's offer_sha256 and whose draft
                 differs (a reply that changes nothing is flagged; the way to accept is to sign)
  acceptance     the final signed contract. Its body minus the optional "negotiation" block must
                 hash-equal the accepted draft, and the negotiation block pins the chain:
                 { head_offer_sha256, accepted_offer_sha256, offers }

What this proves: which exact terms were proposed, by whom, in reply to which exact terms, and that
the contract both parties signed is byte-identical to the accepted proposal. What it does not do:
oblige anyone to accept, price the negotiation, or stop a party from abandoning the chain. Silence
stays silence; only statements are bound.
"""
import argparse, base64, hashlib, json, os, secrets, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import contract_v0 as v0
from contract_v0 import canonical, parse_strict, ed25519_verify, contract_sha256, norm_domain

SCHEMA = "a2a-offer-v0"
CONTEXT = b"a2a-offer-v0\n"
NEG_SCHEMA = "a2a-negotiation-ref-v0"


def offer_signing_bytes(offer):
    body = {k: v for k, v in offer.items() if k != "signatures"}
    return CONTEXT + canonical(body).encode("utf-8")


def offer_sha256(offer):
    return hashlib.sha256(offer_signing_bytes(offer)).hexdigest()


def make_offer(draft, by_domain, in_reply_to=None, offered_at=None, offer_id=None):
    return {
        "schema": SCHEMA,
        "offer_id": offer_id or secrets.token_hex(16),
        "by": by_domain,
        "in_reply_to": in_reply_to,
        "offered_at": offered_at or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "draft": draft,
        "signatures": [],
    }


def sign_offer(offer, key):
    sig = base64.b64encode(key.sign(offer_signing_bytes(offer))).decode("ascii")
    offer.setdefault("signatures", []).append({"domain": offer.get("by"), "alg": "ed25519", "sig_b64": sig})
    return offer


def negotiation_pin(offers):
    """The block the accepting parties put into the final contract before signing."""
    return {"schema": NEG_SCHEMA,
            "head_offer_sha256": offer_sha256(offers[0]),
            "accepted_offer_sha256": offer_sha256(offers[-1]),
            "offers": len(offers)}


def _party_key(draft, domain):
    d = norm_domain(domain)
    for p in (draft.get("parties") or []):
        if isinstance(p, dict) and norm_domain(p.get("domain")) == d:
            return p.get("public_key_ed25519_b64")
    return None


def verify_offer_chain(offers, final_contract=None):
    """Offline. Returns {verdict, problems, findings, chain}. verdict: intact / broken.
    Signatures verify against the key each offer's OWN draft pins for the offering party; whether
    that key really belongs to that domain is the same out-of-band question as for the contract."""
    problems, findings, chain = [], [], []
    if not offers:
        return {"verdict": "broken", "problems": [{"reason": "no_offers"}], "findings": [], "chain": []}
    prev_sha, prev_by, prev_draft_sha, cid = None, None, None, None
    for i, o in enumerate(offers):
        tag = {"index": i}
        if not isinstance(o, dict) or o.get("schema") != SCHEMA:
            problems.append(dict(tag, reason="bad_schema")); continue
        osha = offer_sha256(o)
        draft = o.get("draft") if isinstance(o.get("draft"), dict) else {}
        dsha = contract_sha256(draft)
        chain.append({"index": i, "by": o.get("by"), "offer_sha256": osha, "draft_contract_sha256": dsha,
                      "in_reply_to": o.get("in_reply_to")})
        # link
        if i == 0:
            if o.get("in_reply_to") is not None:
                problems.append(dict(tag, reason="head_replies_to_something", carried=o.get("in_reply_to")))
        elif o.get("in_reply_to") != prev_sha:
            problems.append(dict(tag, reason="chain_broken", carried=o.get("in_reply_to"), expected=prev_sha))
        # one deal, one handle
        this_cid = draft.get("contract_id")
        if cid is None:
            cid = this_cid
        elif this_cid != cid:
            problems.append(dict(tag, reason="contract_id_changed_mid_negotiation", carried=this_cid, expected=cid))
        # the offering party must be a party to its own draft, and its pinned key must verify the offer
        pk = _party_key(draft, o.get("by"))
        if pk is None:
            problems.append(dict(tag, reason="offeror_not_a_party", by=o.get("by")))
        else:
            ok = any(isinstance(s, dict) and norm_domain(s.get("domain")) == norm_domain(o.get("by"))
                     and ed25519_verify(pk, s.get("sig_b64"), offer_signing_bytes(o)) is True
                     for s in (o.get("signatures") or []))
            if not ok:
                problems.append(dict(tag, reason="offer_not_signed_by_offeror", by=o.get("by")))
        # a reply that changes nothing is not a counteroffer; the way to accept is to sign
        if i > 0:
            if dsha == prev_draft_sha:
                findings.append(dict(tag, code="counteroffer_changes_nothing",
                                     why="the draft is byte-identical to the one it replies to; acceptance is a signature, not a repeat"))
            if norm_domain(o.get("by")) == norm_domain(prev_by):
                findings.append(dict(tag, code="consecutive_offers_same_party"))
        prev_sha, prev_by, prev_draft_sha = osha, o.get("by"), dsha

    if final_contract is not None and not problems:
        stripped = {k: v for k, v in final_contract.items() if k != "negotiation"}
        fsha = contract_sha256(stripped)
        if fsha != prev_draft_sha:
            problems.append({"reason": "final_differs_from_accepted_offer",
                             "final_contract_sha256_minus_negotiation": fsha, "accepted_draft_sha256": prev_draft_sha,
                             "detail": "the signed contract is not the bytes that were offered; whatever changed was never proposed"})
        neg = final_contract.get("negotiation")
        if isinstance(neg, dict):
            if neg.get("accepted_offer_sha256") != prev_sha:
                problems.append({"reason": "negotiation_pin_mismatch", "field": "accepted_offer_sha256",
                                 "carried": neg.get("accepted_offer_sha256"), "recomputed": prev_sha})
            head = offer_sha256(offers[0]) if isinstance(offers[0], dict) else None
            if neg.get("head_offer_sha256") != head:
                problems.append({"reason": "negotiation_pin_mismatch", "field": "head_offer_sha256",
                                 "carried": neg.get("head_offer_sha256"), "recomputed": head})

    verdict = "intact" if not problems else "broken"
    return {"verdict": verdict, "problems": sorted(problems, key=canonical),
            "findings": sorted(findings, key=canonical), "chain": chain,
            "accepted_as_offered": (final_contract is not None and verdict == "intact") or None}


# --------------------------------------------------------------------------- self test
def _selftest():
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    def newkey():
        k = Ed25519PrivateKey.generate()
        return k, base64.b64encode(k.public_key().public_bytes(serialization.Encoding.Raw,
                                                               serialization.PublicFormat.Raw)).decode()
    ka, pa = newkey(); kb, pb = newkey(); kx, px = newkey()
    n = 0
    DNE = ["that HS enforced any of this at runtime",
           "that the contractor obeyed the grant, only that its recorded acts match or deviate from it",
           "that HS judges liability or fault; the verdict is a function anyone recomputes",
           "that a prohibited action was impossible, only that performing one is a provable deviation",
           "that this is a legal contract or determines legal responsibility"]

    def draft(price_jpy, expiry):
        g = {"authorized_actions": ["read", "observe", "emit_witness"],
             "prohibited_actions": ["payment", "delete", "redelegate", "send_pii"],
             "delegation": {"allowed": []}, "revocation": {"effective_at": "anchor"},
             "finality": {"depth": 6, "max_target_bits": "17080000"}, "expiry_height": expiry}
        d = v0.build_contract(
            {"domain": "gate.horizonshield.dev", "key_url": "https://gate.horizonshield.dev/keys/agreement.json", "public_key_ed25519_b64": pa},
            {"domain": "api.babyblueviper.com", "key_url": "https://api.babyblueviper.com/keys/agreement.json", "public_key_ed25519_b64": pb},
            {"purpose": "witness walk", "payload_digest": "a" * 64, "a2a_task_id": None}, g,
            ["that both parties signed these grant bytes at the stated time"], DNE,
            bond={"amount": price_jpy, "currency": "JPY", "holder": "principal"},
            contract_id="0123456789abcdef0123456789abcdef", nonce="c" * 32, agreed_at="2026-09-25T00:00:00Z")
        return d

    # [1] offer -> counteroffer -> accept, honest
    o1 = sign_offer(make_offer(draft(50000, 972736), "gate.horizonshield.dev", offer_id="1" * 32, offered_at="2026-09-25T00:00:00Z"), ka)
    o2 = sign_offer(make_offer(draft(30000, 973000), "api.babyblueviper.com", in_reply_to=offer_sha256(o1), offer_id="2" * 32, offered_at="2026-09-25T00:10:00Z"), kb)
    final = json.loads(json.dumps(o2["draft"]))
    final["negotiation"] = negotiation_pin([o1, o2])
    v0.sign_contract(final, ka, pa, "gate.horizonshield.dev")
    v0.sign_contract(final, kb, pb, "api.babyblueviper.com")
    out = verify_offer_chain([o1, o2], final)
    assert out["verdict"] == "intact" and out["accepted_as_offered"] is True and out["findings"] == [], out
    assert v0.verify_contract(final)["verdict"] == "accepted"
    n += 1; print("[1] offer, counteroffer, acceptance: chain intact, final contract is byte-identical to the accepted draft, verify_contract accepted")

    # [2] terms changed after the last offer: the signed contract is not what was proposed
    sneaky = json.loads(json.dumps(o2["draft"]))
    sneaky["grant"]["authorized_actions"].append("payment")
    sneaky["negotiation"] = negotiation_pin([o1, o2])
    out = verify_offer_chain([o1, o2], sneaky)
    assert out["verdict"] == "broken" and any(p["reason"] == "final_differs_from_accepted_offer" for p in out["problems"]), out
    n += 1; print("[2] final contract widened after the accepted offer: final_differs_from_accepted_offer")

    # [3] a draft edited after the offer was signed: signature fails
    o2t = json.loads(json.dumps(o2)); o2t["draft"]["bond"]["amount"] = 1
    out = verify_offer_chain([o1, o2t])
    assert out["verdict"] == "broken" and any(p["reason"] == "offer_not_signed_by_offeror" for p in out["problems"]), out
    n += 1; print("[3] draft edited after signing: offer_not_signed_by_offeror")

    # [4] broken link and a head that replies to something
    o2w = json.loads(json.dumps(o2)); o2w["in_reply_to"] = "e" * 64
    o2w["signatures"] = []; sign_offer(o2w, kb)
    out = verify_offer_chain([o1, o2w])
    assert any(p["reason"] == "chain_broken" for p in out["problems"]), out
    o1w = json.loads(json.dumps(o1)); o1w["in_reply_to"] = "f" * 64; o1w["signatures"] = []; sign_offer(o1w, ka)
    out = verify_offer_chain([o1w])
    assert any(p["reason"] == "head_replies_to_something" for p in out["problems"]), out
    n += 1; print("[4] in_reply_to that names the wrong offer: chain_broken; a head with in_reply_to: refused")

    # [5] a stranger's offer: the draft pins no key for it
    o3 = sign_offer(make_offer(draft(1, 973000), "stranger.example", in_reply_to=offer_sha256(o2), offer_id="3" * 32), kx)
    out = verify_offer_chain([o1, o2, o3])
    assert any(p["reason"] == "offeror_not_a_party" for p in out["problems"]), out
    n += 1; print("[5] offer by a domain the draft does not name: offeror_not_a_party")

    # [6] a reply that changes nothing, and two offers in a row from one party: flagged, not refused
    o2same = sign_offer(make_offer(json.loads(json.dumps(o1["draft"])), "gate.horizonshield.dev", in_reply_to=offer_sha256(o1), offer_id="4" * 32, offered_at="2026-09-25T00:20:00Z"), ka)
    out = verify_offer_chain([o1, o2same])
    codes = sorted(f["code"] for f in out["findings"])
    assert out["verdict"] == "intact" and codes == ["consecutive_offers_same_party", "counteroffer_changes_nothing"], out
    n += 1; print("[6] identical draft re-offered by the same party: both flagged as findings, chain still intact")

    # [7] negotiation pin naming the wrong offer: refused
    wrong = json.loads(json.dumps(o2["draft"]))
    wrong["negotiation"] = {"schema": NEG_SCHEMA, "head_offer_sha256": "a" * 64, "accepted_offer_sha256": "b" * 64, "offers": 2}
    out = verify_offer_chain([o1, o2], wrong)
    reasons = [p["reason"] for p in out["problems"]]
    assert "final_differs_from_accepted_offer" not in reasons and reasons.count("negotiation_pin_mismatch") == 2, out
    n += 1; print("[7] negotiation pin naming other offers: negotiation_pin_mismatch on both fields")

    # [8] determinism
    import random
    ref = canonical(verify_offer_chain([o1, o2], final))
    for _ in range(20):
        assert canonical(verify_offer_chain([o1, o2], final)) == ref
    n += 1; print("[8] 20 recomputations: identical bytes")

    print("\nSELF-TEST PASSED: MUSUBI offer v0, %d checks (negotiation chain, late widening, tamper, links, strangers, no-change replies, pins, determinism)" % n)


def main():
    ap = argparse.ArgumentParser(description="MUSUBI offer v0 (a2a-offer-v0 negotiation chain)")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--verify-chain", nargs="+", metavar="OFFER.json")
    ap.add_argument("--final", metavar="CONTRACT.json", default=None)
    a = ap.parse_args()
    if a.selftest:
        _selftest(); return 0
    if a.verify_chain:
        rd = lambda p: parse_strict(open(p, encoding="utf-8").read())
        out = verify_offer_chain([rd(p) for p in a.verify_chain], rd(a.final) if a.final else None)
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0 if out["verdict"] == "intact" else 2
    ap.print_help(); return 1


if __name__ == "__main__":
    sys.exit(main())
