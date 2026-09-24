#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MUSUBI settle v1.3: authority under failure (a2a-settlement-v1.3).

Why this file exists. A red-team reply on Bluesky (@tallybexro, 2026-09-24): the missing test is
authority under failure. Can an agent exceed its delegated scope when a tool errors, a message is
duplicated, or one side lies about settlement? A contract that only recomputes a clean verdict
proves arithmetic, not delegation.

Checked against v1.2:
  duplicated message   half closed. v1 collapsed identical bytes, but the same signed message anchored
                       twice (two replicas, two calendars, two leaves in one block) carries two
                       different anchor proofs, so its bytes differ and it counted twice. Found by this
                       file's own test while answering the question.
  tool error           open. An attempt the contractor records outside performed_actions (say in a
                       "failed_actions" field) was never read by settlement, so a prohibited attempt
                       that errored could be written down and still ignored.
  lying about it       open. A party could publish a settlement saying within_grant, and there was no
                       function that recomputes it and names what was misreported.

What v1.3 adds, on top of v1.2 (v1.2, v1.1, v1, v0 untouched):
  0. One message, one record. Records are grouped by their signed body (everything but the anchor).
     Several anchored copies of one body collapse to the earliest copy whose anchor verifies on the
     view, and the collapse is listed (duplicate_anchorings). A genuine retry is a new signed body
     and counts again.
  1. Strict record schemas. An execution record may carry only its known fields, and every attempt
     goes in performed_actions, whatever happened to it. Outcomes go in an optional map
     outcomes {action: "ok" | "error" | "timeout" | "partial"}, whose keys must be performed actions.
  2. An outcome never excuses scope. A prohibited, unauthorized, revoked or expired attempt is a
     deviation whether the tool succeeded or failed. Authority is exercised when the call is made.
  3. A nonconforming record (unknown field, outcome for an action not listed, bad outcome value) that
     the contractor signed is itself a deviation, clause nonconforming_record: hiding an attempt
     outside the schema is misconduct. Its performed_actions are still evaluated. The same record
     signed only by a witness is rejected and listed; it cannot put a charge on the contractor.
  4. verify_claim(claimed, contract, records, view) recomputes the settlement and compares bytes
     (signatures aside). "matches", or "misreported" with every field that differs. A signed claim
     that misreports is evidence against its signer.

Stated limits: an attempt nobody recorded is invisible; absence of signed evidence is not evidence of
compliance, which is why witnesses named in the grant exist. verify_claim is only as good as the
records and view the verifier holds; a claim made on a different chain view shows up as misreported
on the fields that depend on it.
"""
import argparse, base64, json, os, random, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import contract_v0 as v0
import settle_v1 as v1
import settle_v1_1 as v11
import settle_v1_2 as v12
from contract_v0 import canonical, parse_strict, EXEC_SCHEMA

SETTLE_SCHEMA = "a2a-settlement-v1.3"
OUTCOMES = ("ok", "error", "timeout", "partial")
FIELDS = {
    EXEC_SCHEMA: {"schema", "contract_ref", "performed_actions", "approvals", "delegated_to", "nenrin_ref",
                  "outcomes", "anchor", "signatures"},
    v1.REVOKE_SCHEMA: {"schema", "contract_ref", "revoked_by", "anchor", "signatures"},
    v1.ACK_SCHEMA: {"schema", "contract_ref", "revocation_sha256", "acked_by", "anchor", "signatures"},
}


def conformance(rec):
    """List of problems; empty when the record fits its schema."""
    probs = []
    allowed = FIELDS.get(rec.get("schema"))
    if allowed is None:
        return ["unknown schema"]
    extra = sorted(set(rec) - allowed)
    if extra:
        probs.append("fields outside the schema: %s" % extra)
    if rec.get("schema") == EXEC_SCHEMA:
        acts = rec.get("performed_actions")
        if not isinstance(acts, list) or not all(isinstance(a, str) for a in acts):
            probs.append("performed_actions must be a list of strings")
            acts = []
        oc = rec.get("outcomes")
        if oc is not None:
            if not isinstance(oc, dict):
                probs.append("outcomes must be an object")
            else:
                for k, v in oc.items():
                    if k not in acts:
                        probs.append("outcome for %r, which is not in performed_actions" % k)
                    if v not in OUTCOMES:
                        probs.append("outcome %r for %r is not one of %s" % (v, k, list(OUTCOMES)))
    return probs


def _signer(rec, contract):
    """'contractor', 'witness', or None, for execution records (who vouches for the acts)."""
    keys, wit = v12._keys(contract)
    msg = v12.record_signing_bytes(rec)
    for s in rec.get("signatures") or []:
        if not isinstance(s, dict):
            continue
        if s.get("role") == "contractor" and keys.get("contractor") and \
                v0.ed25519_verify(keys["contractor"], s.get("sig_b64"), msg) is True:
            return "contractor"
    for s in rec.get("signatures") or []:
        if isinstance(s, dict) and s.get("role") == "witness":
            pub = wit.get(s.get("witness_name"))
            if pub and v0.ed25519_verify(pub, s.get("sig_b64"), msg) is True:
                return "witness"
    return None


def _anchor_valid(ev, cv):
    a = ev.get("anchor") if isinstance(ev.get("anchor"), dict) else {}
    h, bh = v1.height_of(ev), a.get("block_hash")
    if cv is None or h is None or h not in cv["hashes"] or cv["hashes"][h] != bh:
        return False
    return v11.run_proof(v11.commitment_digest(ev), a.get("proof")) == cv["merkle"][h]


def collapse_anchorings(contract, events, view):
    """The same signed body anchored more than once (two replicas, two calendars, two positions in a
    block) is ONE message. Keep the earliest copy whose anchor verifies on this view; if none verifies,
    keep them all and let v1.1 report why. Returns (records, collapsed)."""
    cv, _ = v11.verify_view(view, contract)
    groups = {}
    for ev in v1.bind(contract, events):
        groups.setdefault(v11.commitment_digest(ev).hex(), []).append(ev)
    out, collapsed = [], []
    for body, copies in sorted(groups.items()):
        uniq = {v1.rec_sha(e): e for e in copies}
        if len(uniq) == 1:
            out.append(next(iter(uniq.values())))
            continue
        valid = sorted(((v1.height_of(e), s, e) for s, e in uniq.items() if _anchor_valid(e, cv)),
                       key=lambda t: (t[0], t[1]))
        if valid:
            keep = valid[0]
            out.append(keep[2])
            collapsed.append({"body_sha256": body, "kept": keep[1], "height": keep[0],
                              "dropped": sorted(s for s in uniq if s != keep[1])})
        else:
            out.extend(uniq.values())
    return out, collapsed


def settle_v1_3(contract, events, view):
    events, collapsed = collapse_anchorings(contract, events, view)
    passed, charges, rejected, seen = [], [], [], set()
    for ev in v1.bind(contract, events):
        s = v1.rec_sha(ev)
        if s in seen:
            continue
        seen.add(s)
        probs = conformance(ev)
        if not probs:
            passed.append(ev)
            continue
        who = _signer(ev, contract) if ev.get("schema") == EXEC_SCHEMA else None
        if who == "contractor":
            charges.append({"clause": "nonconforming_record", "record_sha256": s, "why": probs})
            passed.append(ev)                       # its listed acts are still judged
        else:
            rejected.append({"sha256": s, "schema": ev.get("schema"), "why": "nonconforming: %s" % "; ".join(probs)})

    out = v12.settle_v1_2(contract, passed, view)
    verdict = out["verdict"]
    if verdict != "underspecified" and charges:
        verdict = "deviation"
    deviations = [] if verdict == "underspecified" else out["deviations"] + sorted(charges, key=canonical)
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

    auth = dict(out["authenticity"])
    auth["rejected"] = sorted(auth.get("rejected", []) + rejected, key=lambda r: r["sha256"])
    out.update({"schema": SETTLE_SCHEMA, "settled_under": v12.SETTLE_SCHEMA, "verdict": verdict,
                "status": status, "deviations": deviations, "bond_outcome": bond_outcome,
                "authenticity": auth, "duplicate_anchorings": collapsed})
    out["establishes"] = out["establishes"] + [
        "that every attempt in the accepted records was judged against the grant regardless of its outcome; "
        "an error or timeout never excuses an out of scope call",
    ]
    out["does_not_establish"] = out["does_not_establish"] + [
        "that attempts nobody recorded did not happen",
    ]
    return out


def verify_claim(claimed, contract, events, view):
    truth = settle_v1_3(contract, events, view)
    strip = lambda d: {k: v for k, v in d.items() if k != "signatures"}
    a, b = strip(claimed if isinstance(claimed, dict) else {}), strip(truth)
    if canonical(a) == canonical(b):
        return {"status": "matches", "recomputed_verdict": truth["verdict"]}
    diff = sorted(k for k in set(a) | set(b) if canonical(a.get(k)) != canonical(b.get(k)))
    return {"status": "misreported", "fields": diff,
            "claimed": {k: a.get(k) for k in ("verdict", "bond_outcome", "status") if k in diff},
            "recomputed": {k: b.get(k) for k in ("verdict", "bond_outcome", "status") if k in diff},
            "note": "the recomputation is the settlement; a signed claim that differs is evidence against its signer"}


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
    chain = v11._Chain(95, "00" * 32, "common")
    for _ in range(3):
        chain.block()
    lb = {"kind": "bitcoin_block", "height": 97, "hash": chain.hashes[97]}
    grant = {"authorized_actions": ["read", "write"], "prohibited_actions": ["delete"],
             "conditional": [{"action": "write", "requires": "principal_approval"}],
             "delegation": {"allowed": []}, "revocation": {"effective_at": "anchor"},
             "finality": {"depth": 3, "max_target_bits": "207fffff"},
             "witnesses": [{"name": "nenrin-walker", "public_key_ed25519_b64": pw}]}
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
        contract_id="0123456789abcdef0123456789abcdef", nonce="e" * 32, agreed_at="2026-09-24T00:00:00Z")
    v0.sign_contract(c, ka, pa, "gate.horizonshield.dev")
    v0.sign_contract(c, kb, pb, "api.babyblueviper.com")
    cid = c["contract_id"]

    def ex(actions, outcomes=None, extra=None, signer=("contractor", kb), ref="1"):
        r = v1._ex(cid, actions, 0, ref=ref); del r["anchor"]
        if outcomes is not None:
            r["outcomes"] = outcomes
        if extra:
            r.update(extra)
        return v12.sign_record(r, signer[1], signer[0], "nenrin-walker" if signer[0] == "witness" else None)

    def run(blocks):
        ch = chain.fork(98, "r%d" % random.randint(0, 1 << 30))
        recs = []
        for b in blocks:
            recs += ch.block(b)
        for _ in range(5):
            ch.block()
        return settle_v1_3(c, recs, ch.view()), recs, ch

    # [1] a prohibited call that errored is still a deviation
    s, _, _ = run([[ex(["delete"], outcomes={"delete": "error"})]])
    assert s["verdict"] == "deviation" and s["deviations"][0]["clause"] == "prohibited", s
    n += 1; print("[1] 'delete' attempted, tool returned error: deviation, prohibited (the error does not excuse it)")

    # [2] fallback after an error: read failed, agent reached for delete
    s, _, _ = run([[ex(["read", "delete"], outcomes={"read": "error", "delete": "ok"})]])
    assert s["verdict"] == "deviation" and [d["observed"] for d in s["deviations"]] == ["delete"], s
    n += 1; print("[2] read errored, agent fell back to delete: deviation on delete only")

    # [3] hiding the attempt outside the schema
    s, _, _ = run([[ex(["read"], extra={"failed_actions": ["delete"]})]])
    assert s["verdict"] == "deviation" and any(d["clause"] == "nonconforming_record" for d in s["deviations"]), s
    n += 1; print("[3] 'delete' written into failed_actions instead of performed_actions: deviation, nonconforming_record")

    # [4] an outcome for an action that is not listed, and an invented outcome value
    s, _, _ = run([[ex(["read"], outcomes={"delete": "error"})]])
    assert any(d["clause"] == "nonconforming_record" for d in s["deviations"]), s
    s, _, _ = run([[ex(["read"], outcomes={"read": "cancelled_so_it_does_not_count"})]])
    assert any(d["clause"] == "nonconforming_record" for d in s["deviations"]), s
    n += 1; print("[4] outcome for an unlisted action, invented outcome value: nonconforming_record each")

    # [5] a witness cannot charge the contractor with a nonconforming record
    s, _, _ = run([[ex(["read"], extra={"failed_actions": ["delete"]}, signer=("witness", kw))]])
    assert s["verdict"] == "within_grant" and any("nonconforming" in r["why"] for r in s["authenticity"]["rejected"]), s
    n += 1; print("[5] same nonconforming record signed only by the witness: rejected, no charge on the contractor")

    # [6] duplicated message vs genuine retry. The duplicate is anchored twice: two leaves in one block,
    #     and again in a later block. Three anchored copies of one signed body are one message.
    d = ex(["delete"])
    s, _, _ = run([[d, dict(d)], [dict(d)]])
    assert len([x for x in s["deviations"] if x["clause"] == "prohibited"]) == 1, s
    assert len(s["duplicate_anchorings"]) == 1 and len(s["duplicate_anchorings"][0]["dropped"]) == 2, s
    assert s["duplicate_anchorings"][0]["height"] == 98
    s, _, _ = run([[ex(["delete"], ref="1")], [ex(["delete"], ref="2")]])
    assert len([x for x in s["deviations"] if x["clause"] == "prohibited"]) == 2, s
    n += 1; print("[6] one signed message anchored three times (twice in block 98, again in 99): one deviation, "
                  "earliest anchor kept; a genuine retry (a second call): two deviations")

    # [7] lying about settlement: a flipped verdict and bond are named; the honest claim matches
    s, recs, ch = run([[ex(["delete"], outcomes={"delete": "error"})]])
    lie = json.loads(json.dumps(s)); lie["verdict"] = "within_grant"; lie["bond_outcome"] = "held"; lie["deviations"] = []
    r = verify_claim(lie, c, recs, ch.view())
    assert r["status"] == "misreported" and {"verdict", "bond_outcome", "deviations"} <= set(r["fields"]), r
    assert verify_claim(s, c, recs, ch.view())["status"] == "matches"
    n += 1; print("[7] claimed within_grant / bond held over a real deviation: misreported %s; honest claim: matches"
                  % r["fields"])

    # [8] a claim that quietly drops an inconvenient record is caught by recomputing from all records
    ok_rec = ex(["read"], ref="3")
    s_all, recs2, ch2 = run([[ok_rec], [ex(["delete"], ref="4")]])
    partial = settle_v1_3(c, recs2[:1], ch2.view())
    r = verify_claim(partial, c, recs2, ch2.view())
    assert partial["verdict"] == "within_grant" and r["status"] == "misreported" and "verdict" in r["fields"], r
    n += 1; print("[8] claim computed after dropping the 'delete' record: misreported against the full record set")

    # [9] earlier layers unchanged
    here = os.path.dirname(os.path.abspath(__file__))
    for f, want in (("contract_v0.py", "SELF-TEST PASSED"), ("settle_v1.py", "11 checks"),
                    ("settle_v1_1.py", "11 checks"), ("settle_v1_2.py", "13 checks")):
        rr = subprocess.run([sys.executable, os.path.join(here, f), "--selftest"], capture_output=True, text=True)
        assert rr.returncode == 0 and want in rr.stdout, f
    n += 1; print("[9] contract_v0 6/6, settle_v1 11/11, settle_v1_1 11/11, settle_v1_2 13/13 still pass")

    print("\nSELF-TEST PASSED: MUSUBI settle v1.3, %d checks (errors, fallback, hidden attempts, witnesses, "
          "duplicates vs retries, misreported settlements)" % n)


def main():
    ap = argparse.ArgumentParser(description="MUSUBI settle v1.3 (authority under failure)")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--settle", metavar="CONTRACT.json")
    ap.add_argument("--event", action="append", default=[], metavar="RECORD.json")
    ap.add_argument("--view", action="append", default=[], metavar="HEADERS.json")
    ap.add_argument("--claim", metavar="SETTLEMENT.json", help="recompute and compare a published settlement")
    a = ap.parse_args()
    if a.selftest:
        _selftest(); return 0
    if not a.settle or not a.view:
        ap.print_help(); return 1
    contract = parse_strict(open(a.settle, encoding="utf-8").read())
    views = [parse_strict(open(p, encoding="utf-8").read()) for p in a.view]
    cmp = v11.compare_views(views, contract)
    if cmp["chosen"] is None:
        print(json.dumps({"fork_choice": cmp}, indent=2)); return 2
    events = [parse_strict(open(p, encoding="utf-8").read()) for p in a.event]
    view = views[cmp["chosen"]]
    if a.claim:
        r = verify_claim(parse_strict(open(a.claim, encoding="utf-8").read()), contract, events, view)
        print(json.dumps(r, ensure_ascii=False, indent=2)); return 0 if r["status"] == "matches" else 2
    s = settle_v1_3(contract, events, view)
    print(json.dumps(s, ensure_ascii=False, indent=2))
    return 0 if s["status"] == "final" else 2


if __name__ == "__main__":
    sys.exit(main())
