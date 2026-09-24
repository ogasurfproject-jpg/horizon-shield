#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MUSUBI (結) / a2a-contract-v0: builder, signer, verifier, and deterministic settle().

Third pillar. NENRIN proves what was done; TSUGI proves how it was recovered; MUSUBI fixes what
was promised (a signed grant between principal and contractor) and makes any gap between promise
and act provable. Built on agreement-v1.1's proven primitives: same canonical form, same Ed25519
discipline, keys inside the signed bytes, offline verification forever.

Discipline (see ops/MUSUBI_a2a_contract_v0_DESIGN.md):
  MUSUBI does not enforce at runtime. HS anchors, HS does not judge. The settlement verdict is a
  function anyone recomputes from the contract and the NENRIN evidence, never a decree.

Standalone: needs the sibling agreement-v0/ module for the crypto primitives, and the
`cryptography` package for signing.
"""
import argparse, base64, hashlib, json, os, re, secrets, sys, time

_AG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "agreement-v0")
if _AG not in sys.path:
    sys.path.insert(0, _AG)
from agreement_verify import (canonical, b64_raw, public_key_problem, norm_domain,
                              host_of_https, under_domain, parse_strict, ed25519_verify, OVERCLAIM)

SCHEMA = "a2a-contract-v0"
SETTLE_SCHEMA = "a2a-settlement-v0"
EXEC_SCHEMA = "a2a-execution-v0"
CONTEXT = b"a2a-contract-v0\n"
SETTLE_CONTEXT = b"a2a-settlement-v0\n"

ROLES = ("principal", "contractor")
HEX32 = re.compile(r"^[0-9a-f]{32}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")

# establishes[] may not overclaim (reuse agreement's list: perform/deliver/paid/contract/binding/...)
# does_not_establish must cover these four subjects (by keyword), or the record is refused.
REQUIRED_DNE = [
    ("runtime enforcement", ("runtime", "enforce")),
    ("HS does not judge liability", ("judge", "liability", "fault")),
    ("deviation is provable, not prevented", ("deviat",)),
    ("not a legal contract", ("legal",)),
]


def sha256_hex(b):
    if isinstance(b, str):
        b = b.encode("utf-8")
    return hashlib.sha256(b).hexdigest()


def signing_bytes(record, context=CONTEXT):
    body = {k: v for k, v in record.items() if k != "signatures"}
    return context + canonical(body).encode("utf-8")


def contract_sha256(record):
    """Content digest of the terms: sha256 of the exact bytes both parties sign. Identical for both
    parties, stable when the second signature lands, recomputable from the contract minus its
    signatures. Binding across the transaction is by this digest, never by contract_id alone."""
    return sha256_hex(signing_bytes(record))


# --------------------------------------------------------------------------- grant algebra
def grant_subset(child, parent):
    """Delegation monotonicity: a delegated (child) grant may only narrow the parent's.
    Returns a list of violations; empty means the child is within the parent."""
    v = []
    pa = set(parent.get("authorized_actions") or [])
    for a in (child.get("authorized_actions") or []):
        if a not in pa:
            v.append("authorized action %r not in parent grant" % a)
    cp = set(child.get("prohibited_actions") or [])
    for a in (parent.get("prohibited_actions") or []):
        if a not in cp:
            v.append("parent prohibits %r but child does not" % a)
    pd = set(parent.get("data_access") or [])
    for d in (child.get("data_access") or []):
        if d not in pd:
            v.append("data_access %r not in parent grant" % d)
    if isinstance(parent.get("max_hops"), int) and isinstance(child.get("max_hops"), int):
        if child["max_hops"] > parent["max_hops"] - 1:
            v.append("max_hops %d exceeds parent-1 (%d)" % (child["max_hops"], parent["max_hops"] - 1))
    return v


# --------------------------------------------------------------------------- build
def build_contract(principal, contractor, task, grant, establishes, does_not_establish,
                   liability_boundary=None, requirements=None, selection_provenance=None,
                   bond=None, parent_contract=None, expiry=None, lower_bound=None,
                   contract_id=None, nonce=None, agreed_at=None):
    """Assemble an UNSIGNED contract record. Caller fills the real party/grant values."""
    rec = {
        "schema": SCHEMA,
        "contract_id": contract_id or secrets.token_hex(16),
        "nonce": nonce or secrets.token_hex(16),
        "agreed_at": agreed_at or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "expiry": expiry,
        "lower_bound": lower_bound,
        "parent_contract": parent_contract,
        "parties": [dict(principal, role="principal"), dict(contractor, role="contractor")],
        "task": task,
        "grant": grant,
        "bond": bond,
        "liability_boundary": liability_boundary or [],
        "requirements": requirements or {"evidence": "nenrin_required", "recovery": "tsugi_required"},
        "selection_provenance": selection_provenance,
        "establishes": establishes,
        "does_not_establish": does_not_establish,
        "signatures": [],
    }
    return rec


# --------------------------------------------------------------------------- sign
def _load_priv(pem_path):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    with open(pem_path, "rb") as f:
        key = serialization.load_pem_private_key(f.read(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise SystemExit("--key must be an Ed25519 private key")
    pub = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return key, base64.b64encode(pub).decode("ascii")


def sign_contract(record, key, public_b64, domain):
    """Add one party's signature. key is an Ed25519PrivateKey. Refuses unless the record pins
    exactly this public key for this domain (so a party can never sign bytes naming another key)."""
    d = norm_domain(domain)
    if not d:
        raise SystemExit("--domain must be a bare hostname")
    if record.get("schema") != SCHEMA:
        raise SystemExit("not an %s record" % SCHEMA)
    parties = record.get("parties")
    if not isinstance(parties, list) or len(parties) != 2:
        raise SystemExit("the record must carry exactly two parties before anyone signs it")
    me = next((p for p in parties if isinstance(p, dict) and norm_domain(p.get("domain")) == d), None)
    if me is None:
        raise SystemExit("%s is not a party to this record; refusing to sign" % d)
    sigs = [s for s in (record.get("signatures") or []) if isinstance(s, dict)]
    if any(norm_domain(s.get("domain")) == d for s in sigs):
        raise SystemExit("%s has already signed this record" % d)
    pinned = me.get("public_key_ed25519_b64")
    if pinned != public_b64:
        raise SystemExit("the record pins a different public key for %s than the one you are signing with" % d)
    if b64_raw(pinned, 32) is None:
        raise SystemExit("%s has no usable public_key_ed25519_b64 in the record" % d)
    record["signatures"] = sigs
    msg = signing_bytes(record)
    sigs.append({"domain": d, "alg": "ed25519", "signature": base64.b64encode(key.sign(msg)).decode("ascii")})
    record["signatures"] = sigs
    return record, msg


# --------------------------------------------------------------------------- verify
class R(object):
    def __init__(self):
        self.refusals = []
        self.findings = []

    def refuse(self, code, why):
        self.refusals.append({"code": code, "why": why})

    def find(self, code, why):
        self.findings.append({"code": code, "why": why})


def verify_contract(record, parent=None, now=None):
    """Offline. No fetch. Checks shape, two-party signatures over the pinned keys, grant sanity,
    delegation monotonicity (if parent supplied), overclaim, and required does_not_establish."""
    r = R()
    if not isinstance(record, dict) or record.get("schema") != SCHEMA:
        r.refuse("bad_schema", "not an %s record" % SCHEMA)
        return _out(r)
    csha = contract_sha256(record)

    for f in ("contract_id", "nonce"):
        if not (isinstance(record.get(f), str) and HEX32.match(record[f])):
            r.refuse("bad_field", "%s must be 32 lowercase hex" % f)

    parties = record.get("parties")
    if not isinstance(parties, list) or len(parties) != 2:
        r.refuse("bad_parties", "exactly two parties required")
        return _out(r, csha)
    roles = [p.get("role") for p in parties if isinstance(p, dict)]
    if sorted(roles) != ["contractor", "principal"]:
        r.refuse("bad_roles", "parties must be exactly one principal and one contractor")

    doms = []
    for p in parties:
        d = norm_domain(p.get("domain"))
        if not d:
            r.refuse("bad_domain", "party domain %r is not a bare hostname" % p.get("domain"))
            continue
        doms.append(d)
        ku = p.get("key_url")
        kh = host_of_https(ku)
        if not kh:
            r.refuse("bad_key_url", "%s.key_url must be an https URL" % d)
        elif not under_domain(kh, d):
            r.find("key_url_off_domain", "%s.key_url host %s is not under %s; signature still verifies, "
                                         "but attribution rests on a key server someone else runs" % (d, kh, d))
        if b64_raw(p.get("public_key_ed25519_b64"), 32) is None:
            r.refuse("bad_public_key", "%s.public_key_ed25519_b64 must be 32 bytes of canonical base64" % d)
    if len(set(doms)) < 2:
        r.refuse("self_contract", "principal and contractor must be different domains")

    task = record.get("task")
    if not isinstance(task, dict) or not isinstance(task.get("purpose"), str) or not task["purpose"]:
        r.refuse("bad_task", "task.purpose is required")
    if task and task.get("payload_digest") is not None and not (isinstance(task.get("payload_digest"), str) and HEX64.match(task["payload_digest"])):
        r.refuse("bad_payload_digest", "task.payload_digest, when present, must be 64 lowercase hex")

    grant = record.get("grant")
    if not isinstance(grant, dict):
        r.refuse("bad_grant", "grant object is required")
    else:
        for k in ("authorized_actions", "prohibited_actions"):
            if not isinstance(grant.get(k), list):
                r.refuse("bad_grant", "grant.%s must be a list" % k)
        overlap = set(grant.get("authorized_actions") or []) & set(grant.get("prohibited_actions") or [])
        if overlap:
            r.refuse("grant_contradiction", "actions both authorized and prohibited: %s" % sorted(overlap))

    # delegation monotonicity
    pc = record.get("parent_contract")
    if pc is not None:
        if not (isinstance(pc, dict) and isinstance(pc.get("contract_id"), str)):
            r.refuse("bad_parent", "parent_contract, when present, must carry contract_id")
        elif parent is not None:
            if parent.get("contract_id") != pc.get("contract_id"):
                r.refuse("parent_mismatch", "parent_contract.contract_id does not match the supplied parent")
            else:
                viol = grant_subset(grant or {}, parent.get("grant") or {})
                for x in viol:
                    r.refuse("grant_escalation", "delegated grant widens the parent: " + x)
        else:
            r.find("parent_not_checked", "record declares a parent but no parent was supplied; grant subset not checked")

    # establishes / does_not_establish
    est = record.get("establishes")
    dne = record.get("does_not_establish")
    if not isinstance(est, list) or not est:
        r.refuse("establishes_missing", "establishes[] is required")
    else:
        for line in est:
            if isinstance(line, str):
                for rx, label in OVERCLAIM:
                    if re.search(rx, line, re.I):
                        r.refuse("overclaim", "establishes claims %s: %r" % (label, line))
    if not isinstance(dne, list) or not dne:
        r.refuse("dne_missing", "does_not_establish[] is required")
    else:
        low = [x.lower() for x in dne if isinstance(x, str)]
        for subject, kws in REQUIRED_DNE:
            if not any(any(k in line for k in kws) for line in low):
                r.refuse("dne_incomplete", "does_not_establish must cover: %s" % subject)

    # signatures: both parties, each verifies against its pinned key over the signing bytes
    sigs = record.get("signatures")
    if not isinstance(sigs, list):
        r.refuse("bad_signatures", "signatures must be a list")
        return _out(r, csha)
    signed = {}
    msg = signing_bytes(record)
    pin = {norm_domain(p.get("domain")): p.get("public_key_ed25519_b64") for p in parties if isinstance(p, dict)}
    for s in sigs:
        if not isinstance(s, dict):
            continue
        d = norm_domain(s.get("domain"))
        if d not in pin:
            r.refuse("stranger_signature", "signature from %r who is not a party" % s.get("domain"))
            continue
        ok = ed25519_verify(pin[d], s.get("signature"), msg)
        if ok is True:
            signed[d] = True
        elif ok is False:
            r.refuse("bad_signature", "%s signature does not verify over the signing bytes" % d)
        else:
            r.refuse("unusable_signature", "%s signature or key is unusable" % d)
    for d in pin:
        if d not in signed:
            r.refuse("one_sided", "%s has not signed" % d)

    return _out(r, csha)


def _out(r, csha=None):
    verdict = "accepted" if not r.refusals else "refused"
    out = {"schema": "a2a-contract-verify-v0", "verdict": verdict,
           "refusals": r.refusals, "findings": r.findings}
    if csha is not None:
        out["contract_sha256"] = csha
    return out


# --------------------------------------------------------------------------- settle (deterministic)
def settle(contract, executions, sign_parties=None):
    """Deterministic. Given a contract and a list of a2a-execution-v0 evidence records, compute
    whether the contractor stayed within the grant. HS does not decree this; anyone recomputes it.

    An execution record binds to the contract via contract_ref {contract_id, payload_digest} and
    lists performed_actions[], any approvals[], and delegated_to[]. Its nenrin_ref points at the
    underlying jidec-path-v1 walk whose bytes are the real evidence."""
    cid = contract.get("contract_id")
    pdg = (contract.get("task") or {}).get("payload_digest")
    grant = contract.get("grant") or {}
    prohibited = set(grant.get("authorized_prohibited") or grant.get("prohibited_actions") or [])
    authorized = set(grant.get("authorized_actions") or [])
    conditional = {c.get("action"): c for c in (grant.get("conditional") or []) if isinstance(c, dict)}
    deleg = grant.get("delegation")
    allowed_delegates = set((deleg.get("allowed") if isinstance(deleg, dict) else []) or [])

    bound = []
    for ev in executions:
        if not isinstance(ev, dict):
            continue
        ref = ev.get("contract_ref") or {}
        if ref.get("contract_id") != cid:
            continue
        if pdg is not None and ref.get("payload_digest") != pdg:
            continue
        bound.append(ev)

    deviations = []
    approvals_seen = []
    for ev in bound:
        for ap in (ev.get("approvals") or []):
            if isinstance(ap, dict):
                approvals_seen.append(ap.get("action"))
        for act in (ev.get("performed_actions") or []):
            if act in prohibited:
                deviations.append({"clause": "prohibited", "observed": act,
                                   "evidence_sha": ev.get("nenrin_ref")})
            elif act in conditional:
                need = conditional[act].get("requires")
                if need and act not in approvals_seen:
                    deviations.append({"clause": "conditional", "observed": act,
                                       "why": "requires %s, no approval referenced" % need,
                                       "evidence_sha": ev.get("nenrin_ref")})
            elif authorized and act not in authorized:
                deviations.append({"clause": "unauthorized", "observed": act,
                                   "evidence_sha": ev.get("nenrin_ref")})
        for dg in (ev.get("delegated_to") or []):
            if dg not in allowed_delegates:
                deviations.append({"clause": "delegation", "observed": dg,
                                   "evidence_sha": ev.get("nenrin_ref")})

    verdict = "within_grant" if not deviations else "deviation"
    bond = contract.get("bond")
    if not (isinstance(bond, dict) and bond.get("amount")):
        bond_outcome = "n/a"
    else:
        bond_outcome = "held" if verdict == "within_grant" else "forfeited"

    rec = {
        "schema": SETTLE_SCHEMA,
        "contract_id": cid,
        "a2a_task_id": (contract.get("task") or {}).get("a2a_task_id"),
        "nenrin_refs": [ev.get("nenrin_ref") for ev in bound],
        "verdict": verdict,
        "deviations": deviations,
        "bond_outcome": bond_outcome,
        "establishes": [
            "that the bound execution records, taken together, %s the grant" %
            ("stay within" if verdict == "within_grant" else "deviate from"),
        ],
        "does_not_establish": [
            "that HS judged this; the verdict is a function of the contract and the evidence, recomputable by anyone",
            "that no other execution happened outside the records bound to this contract_id",
        ],
        "signatures": [],
    }
    return rec


# --------------------------------------------------------------------------- self test
def _selftest():
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    def newkey():
        k = Ed25519PrivateKey.generate()
        pub = k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        return k, base64.b64encode(pub).decode("ascii")

    ka, pa = newkey()   # principal
    kb, pb = newkey()   # contractor

    principal = {"domain": "gate.horizonshield.dev", "key_url": "https://gate.horizonshield.dev/keys/agreement.json",
                 "public_key_ed25519_b64": pa, "agent_card": "https://gate.horizonshield.dev/.well-known/agent-card.json",
                 "agent_card_sha256": "0" * 64}
    contractor = {"domain": "api.babyblueviper.com", "key_url": "https://api.babyblueviper.com/keys/agreement.json",
                  "public_key_ed25519_b64": pb, "agent_card": "https://api.babyblueviper.com/.well-known/agent-card.json",
                  "agent_card_sha256": "1" * 64}
    task = {"purpose": "endpoint_conduct_walk", "payload_digest": sha256_hex("walk api.babyblueviper.com/a2a"),
            "a2a_task_id": None}
    grant = {"authorized_actions": ["read", "observe", "emit_nenrin"],
             "prohibited_actions": ["payment", "delete", "redelegate", "send_pii"],
             "conditional": [{"action": "spend", "threshold_jpy": 100000, "requires": "human_approval"}],
             "delegation": "none", "data_access": ["public_endpoint"], "max_hops": 1, "privacy": "no_external_retention"}
    establishes = ["that both parties signed these grant bytes at the stated time",
                   "that each party named the grant it accepted"]
    does_not_establish = [
        "that HS enforced any of this at runtime",
        "that the contractor obeyed the grant, only that its recorded acts match or deviate from it",
        "that HS judges liability or fault; the verdict is a function anyone recomputes",
        "that a prohibited action was impossible, only that performing one is a provable deviation",
        "that this is a legal contract or determines legal responsibility",
    ]

    rec = build_contract(principal, contractor, task, grant, establishes, does_not_establish,
                         liability_boundary=["contractor: analysis output only", "principal: final decision"],
                         expiry="2026-12-31T00:00:00Z",
                         lower_bound={"kind": "bitcoin_block", "height": 968325, "hash": "0" * 64})
    sign_contract(rec, ka, pa, "gate.horizonshield.dev")
    sign_contract(rec, kb, pb, "api.babyblueviper.com")

    out = verify_contract(rec)
    assert out["verdict"] == "accepted", ("verify failed", out)
    assert out.get("contract_sha256") == contract_sha256(rec) == sha256_hex(signing_bytes(rec)), out
    one = json.loads(json.dumps(rec)); one["signatures"] = one["signatures"][:1]
    assert contract_sha256(one) == out["contract_sha256"], "sha changed when the second signature was removed"
    print("[1] build + two-party sign + verify: accepted  (findings: %d, contract_sha256 reported)" % len(out["findings"]))

    # tamper -> must refuse
    bad = json.loads(json.dumps(rec))
    bad["grant"]["prohibited_actions"] = ["delete"]   # changed after signing
    assert verify_contract(bad)["verdict"] == "refused", "tamper not caught"
    print("[2] tamper after signing: refused")

    # overclaim -> must refuse
    bad2 = json.loads(json.dumps(rec)); bad2["establishes"] = ["that the contractor performed the work"]
    assert verify_contract(bad2)["verdict"] == "refused", "overclaim not caught"
    print("[3] overclaim in establishes: refused")

    # settle within grant
    ev_ok = {"schema": EXEC_SCHEMA, "contract_ref": {"contract_id": rec["contract_id"], "payload_digest": task["payload_digest"]},
             "performed_actions": ["read", "observe", "emit_nenrin"], "approvals": [], "delegated_to": [],
             "nenrin_ref": "a" * 64}
    s1 = settle(rec, [ev_ok])
    assert s1["verdict"] == "within_grant", s1
    print("[4] settle, compliant execution: within_grant")

    # settle with a prohibited action -> deviation
    ev_bad = {"schema": EXEC_SCHEMA, "contract_ref": {"contract_id": rec["contract_id"], "payload_digest": task["payload_digest"]},
              "performed_actions": ["read", "delete"], "approvals": [], "delegated_to": [],
              "nenrin_ref": "b" * 64}
    s2 = settle(rec, [ev_bad])
    assert s2["verdict"] == "deviation" and s2["deviations"][0]["observed"] == "delete", s2
    print("[5] settle, prohibited action performed: deviation on 'delete'")

    # delegation monotonicity: child grant may not widen parent
    child = json.loads(json.dumps(rec))
    child["contract_id"] = secrets.token_hex(16); child["nonce"] = secrets.token_hex(16)
    child["parent_contract"] = {"contract_id": rec["contract_id"], "settlement_url": None}
    child["grant"]["authorized_actions"] = ["read", "observe", "emit_nenrin", "payment"]  # widened!
    viol = grant_subset(child["grant"], rec["grant"])
    assert any("payment" in v for v in viol), viol
    print("[6] delegation grant_subset: widening ('payment') rejected")

    print("\nSELF-TEST PASSED: MUSUBI a2a-contract-v0 (build, sign, verify, tamper, overclaim, settle, delegation)")


def _write_canonical(path, obj):
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(canonical(obj))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="MUSUBI a2a-contract-v0 (build/sign/verify/settle)")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--verify", metavar="RECORD.json")
    ap.add_argument("--parent", metavar="PARENT.json", default=None)
    ap.add_argument("--sign", metavar="RECORD.json", help="add one party's signature (needs --key --domain --out)")
    ap.add_argument("--key", metavar="PEM", help="Ed25519 private key PEM for --sign")
    ap.add_argument("--domain", metavar="HOST", help="the signing party's domain for --sign")
    ap.add_argument("--settle", metavar="CONTRACT.json", help="compute settlement (needs one or more --exec)")
    ap.add_argument("--exec", dest="execs", action="append", default=[], metavar="EXEC.json",
                    help="an a2a-execution-v0 evidence record; repeatable")
    ap.add_argument("--out", metavar="OUT.json", help="output path for --sign or --settle")
    a = ap.parse_args()
    if a.selftest:
        _selftest()
    elif a.verify:
        rec = parse_strict(open(a.verify, encoding="utf-8").read())
        parent = parse_strict(open(a.parent, encoding="utf-8").read()) if a.parent else None
        print(json.dumps(verify_contract(rec, parent=parent), ensure_ascii=False, indent=2))
    elif a.sign:
        if not (a.key and a.domain and a.out):
            raise SystemExit("--sign needs --key PEM --domain HOST --out OUT.json")
        rec = parse_strict(open(a.sign, encoding="utf-8").read())
        key, pub = _load_priv(a.key)
        rec, msg = sign_contract(rec, key, pub, a.domain)
        _write_canonical(a.out, rec)
        print("signed as %s over %d bytes; %d signature(s) now on the record -> %s"
              % (a.domain, len(msg), len(rec["signatures"]), a.out))
    elif a.settle:
        contract = parse_strict(open(a.settle, encoding="utf-8").read())
        execs = [parse_strict(open(p, encoding="utf-8").read()) for p in a.execs]
        s = settle(contract, execs)
        if a.out:
            _write_canonical(a.out, s)
        print(json.dumps(s, ensure_ascii=False, indent=2))
    else:
        ap.print_help()
