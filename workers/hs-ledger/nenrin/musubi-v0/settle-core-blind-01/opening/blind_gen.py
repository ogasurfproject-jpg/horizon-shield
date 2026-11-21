#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
settle core v0, held-out set blind-01: build the inputs and, separately, the reference's answers.

    SETTLE_CORE=/path/to/musubi-v0/settle-core-v0 python3 blind_gen.py --seed-file blind_seed.txt --out OUTDIR

Writes
  OUTDIR/public/inputs/bNN/{contract.json, view.json, events/eKK.json, nenrin/nKK.json, parent.json}
  OUTDIR/public/SHA256SUMS                    sha256 of every public input file, sorted by path
  OUTDIR/private/expected/bNN/expected.json   core fields (run_reference.core_fields) of settle_v1_16 on those files
  OUTDIR/private/MANIFEST.json                id -> internal name, section, intent, my reading, reference summary
  OUTDIR/private/OVERLAP.txt                  every public input file and vector compared with the 128 public vectors

PRIVATE UNTIL OPENING: this file, the seed file and everything under OUTDIR/private. The internal names and intents
say what each vector tests; the seed decides contract_id, nonce and approval nonces, so a reader without it cannot
match a vector to its internal name by recomputing labels.

Everything is deterministic from the seed: the same seed and the same reference give byte-identical files.
The keys are the four public synthetic keys of gen_vectors.py (they are in every contract anyway); every contract
here has its own label, so no contract.json equals a public one.
"""
import argparse, copy, hashlib, json, os, shutil, sys

sys.dont_write_bytecode = True

ap = argparse.ArgumentParser()
ap.add_argument("--seed-file", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--settle-core", default=os.environ.get("SETTLE_CORE"))
args = ap.parse_args()
if not args.settle_core:
    sys.exit("set SETTLE_CORE or --settle-core to the settle-core-v0 folder")
SC = os.path.abspath(args.settle_core)
SEED = open(args.seed_file, encoding="utf-8").read().strip()
assert SEED.startswith("settle-core-v0 blind-01 ") and len(SEED) == len("settle-core-v0 blind-01 ") + 32, "seed format"

sys.path.insert(0, SC)
import gen_vectors as G                                    # noqa: E402  (builds the 128 public vectors in memory; writes nothing)
from run_reference import core_fields, settle_dir           # noqa: E402

canonical, contract_sha256 = G.canonical, G.contract_sha256
v0, v1, v12, v16, s16 = G.v0, G.v1, G.v12, G.v16, G.s16
KP, PP, KC, PC, KW, PW, KS, PS = G.KP, G.PP, G.KC, G.PC, G.KW, G.PW, G.KS, G.PS
CK, DEPTH, Chain, malleate = G.CK, G.DEPTH, G.Chain, G.malleate

H = lambda s: hashlib.sha256((SEED + " " + s).encode()).hexdigest()
NONCE = lambda s: H("nonce " + s)[:32]
CASES = []


def case(name, section, intent, reading, contract, events, view, nenrin=None, parent=None):
    CASES.append(dict(name=name, section=section, intent=intent, reading=reading, contract=contract,
                      events=list(events), view=view, nenrin=list(nenrin or []), parent=parent))


def C(name, grant_over=None, grant_drop=(), top=None, sign=True):
    """A contract of the gen_vectors shape with its own seeded label (contract_id, nonce)."""
    return G.synth_contract(grant_over, grant_drop, sign=sign, top=top, label=SEED + " contract " + name)


def resign(c):
    c = copy.deepcopy(c)
    c["signatures"] = []
    v0.sign_contract(c, KP, PP, G.DOM_P)
    v0.sign_contract(c, KC, PC, G.DOM_C)
    return c


def synth(name, section, intent, reading, c, build, pad=DEPTH, nenrin=None, parent=None):
    ch = Chain()
    recs = build(ch)
    assert all(isinstance(r, dict) for r in recs), name           # a nested list would be skipped silently (6.1)
    ch.pad(pad)
    case(name, section, intent, reading, c, recs, ch.view(), nenrin, parent)


ex, revocation = G.ex, G.revocation


def ref_of(c):
    return {"contract_id": c["contract_id"], "contract_sha256": contract_sha256(c), "payload_digest": c["task"]["payload_digest"]}


def ack(rev_sha, c):
    r = {"schema": v1.ACK_SCHEMA, "contract_ref": ref_of(c), "revocation_sha256": rev_sha, "acked_by": "contractor"}
    return v12.sign_record(r, KC, "contractor")


def appr(c, action="refund", vu=CK + 100, n="a", key=KP, single=True):
    return v16.sign_approval_v2(key, c, action, vu, NONCE(n), single)


def body_sha(rec):
    """3.3 body digest: sha256 of canonical(record without anchor), signatures included."""
    return G.v11.commitment_digest({k: v for k, v in rec.items() if k != "anchor"}).hex()


ACT = lambda c, **kw: (lambda ch: [ch.put(ex(c, **kw))])

# ------------------------------------------------------------------------------------------- ordinary cases
B = C("base")
synth("o_base", "8,9", "one contractor execution of read, depth 6", "within_grant final held", B, ACT(B))


synth("o_payment_and_read", "10.3", "one record performs read and payment (payment prohibited)", "deviation prohibited", B,
      ACT(B, actions=["read", "payment"]))


C_EXP = C("expiry", {"expiry_height": CK + 2})
synth("o_expired_prohibited", "10.2", "expiry CK+2; read at CK+2, delete at CK+3", "deviation after_expiry and prohibited", C_EXP,
      lambda ch: [ch.pad(1).put(ex(C_EXP)), ch.put(ex(C_EXP, actions=["delete"]))])

synth("o_tip_exactly_final", "8.4,8.5", "pad 5 after the execution block (depth 6)", "within_grant final", B, ACT(B), pad=DEPTH - 1)

synth("o_provisional_deviation", "8.5,9.3", "prohibited delete, pad 4", "deviation provisional pending_finality", B,
      ACT(B, actions=["delete"]), pad=DEPTH - 2)


C_DEL = C("delegation", {"delegation": {"allowed": ["d1.synthetic.invalid"]}})
synth("o_delegation_allowed_and_not", "10.3", "two records: delegated_to an allowed domain, and to another", "deviation delegation", C_DEL,
      lambda ch: [ch.put(ex(C_DEL, delegated=["d1.synthetic.invalid"])),
                  ch.put(ex(C_DEL, delegated=["d2.synthetic.invalid"], extra={"nenrin_ref": H("ref d2")}))])

C_W = C("witness", {"witnesses": [{"name": "w-a", "public_key_ed25519_b64": PW}]})


def witness_rec(c, name, actions=("read",)):
    r = ex(c, actions=actions, sign=False)
    return v12.sign_record(r, KW, "witness", name)


synth("o_witness_read", "6.5", "execution of read signed only by the grant witness", "within_grant", C_W,
      lambda ch: [ch.put(witness_rec(C_W, "w-a"))])

synth("o_witness_name_unknown", "6.5", "witness key, witness_name not in the grant", "nothing_to_settle (rejected)", C_W,
      lambda ch: [ch.put(witness_rec(C_W, "w-b", actions=("delete",)))])

synth("o_revoked_next_block", "10.1", "anchor-mode revocation at h, delete at h+1", "deviation revoked only", B,
      lambda ch: [ch.put(revocation(B)), ch.put(ex(B, actions=["delete"]))])

synth("o_exec_before_revocation", "10.1", "read at h, revocation at h+1", "within_grant", B,
      lambda ch: [ch.put(ex(B)), ch.put(revocation(B))])

C_ACK5 = C("ack 5", {"revocation": {"effective_at": "delivery_ack", "ack_window": 5}})


def _ack_early(ch):
    rev = revocation(C_ACK5)
    a = ch.put(rev)
    return [a] + list(ch.put(ack(body_sha(rev), C_ACK5), ex(C_ACK5)))


synth("o_ack_same_block_as_exec", "10.1", "delivery_ack window 5; ack (naming the body digest) and read in one block h+1",
      "deviation revoked", C_ACK5, _ack_early)


def _ack_before(ch):
    rev = revocation(C_ACK5)
    first = ch.put(ex(C_ACK5))
    a = ch.put(ack(body_sha(rev), C_ACK5))
    r = ch.put(rev)
    return [first, a, r, ch.put(ex(C_ACK5, extra={"nenrin_ref": H("ref after")}))]


synth("o_ack_anchored_before_revocation", "10.1 (written behaviour)", "read at h, ack at h+1, its revocation at h+2, read at h+3",
      "deviation revoked (E = h+1 for the second read; the first read stands)", C_ACK5, _ack_before)


def _dup(ch):
    r = ex(B)
    a = ch.put(r)
    b = ch.put(r)
    return [b, a]


synth("o_duplicate_anchorings", "6.4", "the same signed body anchored in two blocks, later copy first in the list",
      "within_grant, later copy duplicate_dropped", B, _dup)

synth("o_batch_leg_extra_field", "7.6", "batch v1 with one more top-level field before records",
      "within_grant", B,
      lambda ch: [ch.put_in_batch(ex(B), b'{"schema":"nenrin-agreement-batch-v1","count":1,"batch_id":"x1","records":[{"sha":"',
                                  b'","kind":"execution","schema":"a2a-execution-v0"}]}')])

_cb = copy.deepcopy(B)
_s = _cb["signatures"][1]["signature"]
_cb["signatures"][1]["signature"] = ("A" if _s[0] != "A" else "B") + _s[1:]
synth("o_contract_bad_contractor_sig_with_delete", "4,6", "contractor contract signature broken; a signed delete",
      "underspecified contract_not_verified", _cb, ACT(_cb, actions=["delete"]))


def _upper_view():
    ch = Chain()
    r = ch.put(ex(B))
    ch.pad(DEPTH)
    v = ch.view()
    v["headers"][3] = dict(v["headers"][3], hex=v["headers"][3]["hex"].upper())
    return [r], v


_r, _v = _upper_view()
case("o_view_header_upper", "5", "one header (not the checkpoint) in upper case hex", "underspecified view_not_strict", B, _r, _v)

C_KC = C("key conflict", {"witnesses": [{"name": "w-a", "public_key_ed25519_b64": PC}]})
synth("o_witness_key_is_contractor_key", "4.2", "witness key equals the contractor's key", "underspecified key_conflict", C_KC, ACT(C_KC))


synth("o_actions_256", "6.6", "256 performed actions, all read", "within_grant", B, ACT(B, actions=["read"] * 256))

synth("o_actions_257", "6.6", "257 performed actions, all read", "deviation nonconforming_record", B, ACT(B, actions=["read"] * 257))

synth("o_outcome_bad_value", "6.6", "outcomes {read: done}", "deviation nonconforming_record", B, ACT(B, extra={"outcomes": {"read": "done"}}))

W_SAME = {"schema": "synthetic-walk-v0", "context": {"contract_sha256": contract_sha256(B)}, "note": "w1"}
synth("o_walk_names_this_contract", "11.1", "nenrin_ref names a supplied walk under these terms", "within_grant", B,
      ACT(B, extra={"nenrin_ref": v1.rec_sha(W_SAME)}), nenrin=[W_SAME])



C_CO = C("conditional", {"conditional": [{"action": "refund", "requires": "principal_approval"}]})


def _vu_equal(ch):
    h_next = CK + 2
    return [ch.put(ex(C_CO, actions=["refund"], approvals=[appr(C_CO, vu=h_next, n="vu")]))]


synth("o_approval_valid_until_equal", "10.4", "refund at h carrying an approval with valid_until_height h", "within_grant", C_CO, _vu_equal)

synth("o_approval_other_terms", "10.4", "refund carrying a principal approval signed for other terms", "deviation conditional", C_CO,
      ACT(C_CO, actions=["refund"], approvals=[appr(C("conditional other"), n="ot")]))


def _orph(ch):
    d = copy.deepcopy(ch.put(ex(B, actions=["delete"])))
    d["anchor"]["height"] += 1
    return [d, ch.put(ex(B))]


synth("o_orphaned_delete_beside_read", "7.4", "a delete whose anchor names the next height, and an honest read", "within_grant", B, _orph)

# ------------------------------------------------------------------------------------------- places the text was found unclear
synth("a_row4_nenrin_ref_upper", "6.0 row 4", "signed read with nenrin_ref in upper case hex", "underspecified record_not_strict", B,
      ACT(B, extra={"nenrin_ref": H("upper").upper()}))

synth("a_row1_unsigned_nenrin_upper_beside_good", "6.0 row 1", "honest read, plus unsigned delete with upper case nenrin_ref",
      "within_grant, record_not_strict disposition, no reason", B,
      lambda ch: [ch.put(ex(B)), ch.put(ex(B, actions=["delete"], extra={"nenrin_ref": H("upper2").upper()}, sign=False))])

synth("a_binding_before_triage_upper_csha", "6.1 before 6.0", "signed delete whose contract_sha256 is the right digest in upper case",
      "nothing_to_settle, inconsistent", B, ACT(B, actions=["delete"], ref={"contract_sha256": contract_sha256(B).upper()}))

synth("a_row1_stranger_float_beside_good", "6.0 row 1 before row 3", "honest read, plus stranger-signed delete carrying a float",
      "within_grant, record_not_strict disposition (not rejected)", B,
      lambda ch: [ch.put(ex(B)), ch.put(ex(B, actions=["delete"], extra={"outcomes": {"delete": 0.25}}, signer="stranger"))])


def _lax_witness(ch):
    r = witness_rec(C_W, "w-a", actions=("delete",))
    r["signatures"][0]["sig_b64"] = malleate(r["signatures"][0]["sig_b64"])
    return [ch.put(r)]


synth("a_row2_lax_witness_only", "6.0 row 2", "witness-signed delete, its only signature S + L", "nothing_to_settle, signature_not_strict", C_W, _lax_witness)


def _lax_float(ch):
    r = ex(B, actions=["delete"], extra={"outcomes": {"delete": 0.75}})
    r["signatures"][0]["sig_b64"] = malleate(r["signatures"][0]["sig_b64"])
    return [ch.put(r)]


synth("a_row1_lax_and_body_not_strict", "6.0 row 1 before row 2", "S + L signature over a body with a float", "nothing_to_settle, record_not_strict", B, _lax_float)


def _entry_not_strict(ch):
    r = ex(B, actions=["delete"])
    r["signatures"][0]["note"] = "x\u0001"
    return [ch.put(r)]


synth("a_signature_entry_not_strict_only", "6.0 strictly signed", "the only signature entry verifies but carries a key with a control character",
      "nothing_to_settle (row 2 or row 3?)", B, _entry_not_strict)


def _entry_not_strict_beside(ch):
    r = ex(B, actions=["delete"])
    r["signatures"].append(dict(r["signatures"][0], note="x\u0001"))
    return [ch.put(r)]


synth("a_signature_entry_not_strict_beside_good", "6.0 last paragraph", "a strict entry plus a copy of it with a control character",
      "deviation prohibited", B, _entry_not_strict_beside)

_am = appr(C_CO, n="mall")
_am["sig_b64"] = malleate(_am["sig_b64"])
synth("a_approval_sig_malleated_only", "6.0 row 4", "refund whose approval sig_b64 is S + L", "underspecified record_not_strict", C_CO,
      ACT(C_CO, actions=["refund"], approvals=[_am]))

_ag = appr(C_CO, n="short")
_ag["signature"] = "c2hvcnQ="
synth("a_approval_signature_short_beside_good", "6.0,10.4", "valid sig_b64, plus signature that decodes to 5 bytes", "within_grant", C_CO,
      ACT(C_CO, actions=["refund"], approvals=[_ag]))

P = C("parent")
PREF = lambda p=P: {"parent_contract": {"contract_id": p["contract_id"], "settlement_url": None}}

_cn = C("child bond", {"authorized_actions": ["read", "write"]}, top=dict(PREF(), bond={"amount": 0, "currency": "JPY"}))
synth("a_parent_wider_and_bond_zero", "4.3", "child adds write and has bond amount 0", "underspecified parent_narrowing_failed + bond_malformed",
      _cn, ACT(_cn), parent=P)

_pb = copy.deepcopy(P)
_s = _pb["signatures"][0]["signature"]
_pb["signatures"][0]["signature"] = ("A" if _s[0] != "A" else "B") + _s[1:]
_cg = C("child good", top=PREF())
synth("a_parent_signature_broken", "4.3", "child is within, the supplied parent's principal signature is broken",
      "underspecified parent_narrowing_failed only", _cg, ACT(_cg), parent=_pb)

synth("a_parent_is_list", "4.3", "parent.json is a list", "underspecified parent_narrowing_failed", _cg, ACT(_cg), parent=[P])

_cni = C("child no id", top={"parent_contract": {"settlement_url": None}})
synth("a_parent_ref_without_id", "4.1/4.3.1", "parent_contract without contract_id, parent supplied", "parent_narrowing_failed or contract_not_verified",
      _cni, ACT(_cni), parent=P)

_cnull = C("child null parent", top={"parent_contract": None})
synth("a_parent_null_with_parent", "4.3", "parent_contract null, a parent supplied anyway", "within_grant", _cnull, ACT(_cnull), parent=P)

P0 = C("parent hops 0", {"max_hops": 0})
_c0 = C("child hops 0", {"max_hops": 0}, top=PREF(P0))
synth("a_parent_max_hops_zero", "4.3.1 rule 4", "parent max_hops 0, child max_hops 0", "parent_narrowing_failed", _c0, ACT(_c0), parent=P0)

PNW = C("parent ack no window", {"revocation": {"effective_at": "delivery_ack"}})
_cw3 = C("child ack 3", {"revocation": {"effective_at": "delivery_ack", "ack_window": 3}}, top=PREF(PNW))
synth("a_parent_ack_without_window", "4.3.1 rule 9", "parent delivery_ack without ack_window (4.2 would refuse it), child window 3",
      "within_grant", _cw3, ACT(_cw3), parent=PNW)

_cwd = C("child wider delete", {"authorized_actions": ["read", "write"]}, top=PREF())
synth("a_parent_wider_with_prohibited_exec", "4.3,2.3", "child adds write (fails narrowing) and the contractor performs delete",
      "underspecified parent_narrowing_failed; deviation codes?", _cwd, ACT(_cwd, actions=["delete"]), parent=P)


def _ign_ack(ch):
    rev = revocation(C_ACK5, revoked_by="contractor")
    r = ch.put(rev)
    a = ch.put(ack(body_sha(rev), C_ACK5))
    return [r, a, ch.put(ex(C_ACK5))]


synth("a_ignored_revocation_with_ack", "6.5,10.1,8.2", "revocation with revoked_by contractor (ignored), an ack naming it, read",
      "within_grant; event set: ack and read only", C_ACK5, _ign_ack)

synth("a_ignored_revocation_same_block", "6.5,8.2", "ignored revocation and read in one block", "within_grant; event set: read only", B,
      lambda ch: list(ch.put(revocation(B, revoked_by="contractor"), ex(B))))

C_NR = C("irrevocable", grant_drop=("revocation",))


def _nr_ack(ch):
    rev = revocation(C_NR)
    return [ch.put(rev), ch.put(ack(body_sha(rev), C_NR)), ch.put(ex(C_NR))]


synth("a_not_provided_for_with_ack", "6.0,10.1", "grant without revocation; revocation, ack naming it, read",
      "within_grant, revocation_not_provided_for", C_NR, _nr_ack)

C_ACK10 = C("ack 10", {"revocation": {"effective_at": "delivery_ack", "ack_window": 10}})


def _ack_set_aside_copy(ch):
    rev = revocation(C_ACK10)
    good = ch.put(rev)
    bad = copy.deepcopy(good)
    bad["anchor"]["block_hash"] = bad["anchor"]["block_hash"].upper()
    return [good, bad, ch.put(ack(v1.rec_sha(bad), C_ACK10)), ch.put(ex(C_ACK10))]


synth("a_ack_names_set_aside_copy", "6.0,10.1 (N15 B6)", "window 10; ack names a copy set aside as anchor_not_strict; read one block after the ack",
      "within_grant", C_ACK10, _ack_set_aside_copy)


def _ack_rejected(ch):
    rev = v12.sign_record(dict({"schema": v1.REVOKE_SCHEMA, "contract_ref": ref_of(C_ACK10), "revoked_by": "principal"}, reason="x"), KP, "principal")
    r = ch.put(rev)
    return [r, ch.put(ack(v1.rec_sha(r), C_ACK10)), ch.put(ex(C_ACK10))]


synth("a_ack_names_rejected_revocation", "6.6,10.1", "revocation with a field outside the schema (rejected), ack naming it, read",
      "within_grant", C_ACK10, _ack_rejected)


def _shared(ch):
    a = ch.put(ex(C_CO, actions=["read"], approvals=[appr(C_CO, n="shared")]))
    two = ch.put(ex(C_CO, actions=["refund"]), ex(C_CO, actions=["refund"], extra={"nenrin_ref": H("ref shared")}))
    return [a] + list(two)


synth("a_same_block_shared_single_use", "8.3,10.4", "one single use approval earlier, two refunds in one block", "deviation conditional",
      C_CO, _shared)


# ------------------------------------------------------------------------------------------- write
def files_of(d):
    out = {}
    for root, _, fs in os.walk(d):
        for f in fs:
            p = os.path.join(root, f)
            out[os.path.relpath(p, d).replace(os.sep, "/")] = hashlib.sha256(open(p, "rb").read()).hexdigest()
    return dict(sorted(out.items()))


def emit(dst, src):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, "w", encoding="utf-8", newline="") as f:
        f.write(canonical(src))


def main():
    names = [c["name"] for c in CASES]
    assert len(set(names)) == len(names)
    order = sorted(CASES, key=lambda c: H("order " + c["name"]))   # ids carry no category
    out = os.path.abspath(args.out)
    if os.path.isdir(out):
        shutil.rmtree(out)
    pub, prv = os.path.join(out, "public", "inputs"), os.path.join(out, "private")
    os.makedirs(pub)
    os.makedirs(os.path.join(prv, "expected"))
    manifest = {"schema": "settle-core-v0-blind-manifest", "set": "blind-01", "count": len(order),
                "core_fields": ["contract_sha256", "verdict", "status", "bond_outcome", "deviation_codes", "underspecified_reasons", "event_set", "dispositions"],
                "vectors": []}
    sums = []
    for i, c in enumerate(order, 1):
        vid = "b%02d" % i
        d = os.path.join(pub, vid)
        emit(os.path.join(d, "contract.json"), c["contract"])
        emit(os.path.join(d, "view.json"), c["view"])
        for k, e in enumerate(c["events"]):
            emit(os.path.join(d, "events", "e%02d.json" % k), e)
        for k, w in enumerate(c["nenrin"]):
            emit(os.path.join(d, "nenrin", "n%02d.json" % k), w)
        if c["parent"] is not None:
            emit(os.path.join(d, "parent.json"), c["parent"])
        got = core_fields(settle_dir(d, s16.settle_v1_16, G.parse_strict))
        ed = os.path.join(prv, "expected", vid)
        os.makedirs(ed)
        with open(os.path.join(ed, "expected.json"), "w", encoding="utf-8", newline="") as f:
            f.write(json.dumps(got, indent=1, sort_keys=True) + "\n")
        fs = files_of(d)
        for rel, sha in fs.items():
            sums.append("%s  inputs/%s/%s" % (sha, vid, rel))
        manifest["vectors"].append({"id": vid, "name": c["name"], "section": c["section"], "intent": c["intent"], "my_reading": c["reading"],
                                    "reference": {k: got[k] for k in ("verdict", "status", "bond_outcome", "deviation_codes", "underspecified_reasons")},
                                    "dispositions": sorted(set(got["dispositions"].values())), "files": fs})
    with open(os.path.join(out, "public", "SHA256SUMS"), "w", encoding="utf-8", newline="") as f:
        f.write("\n".join(sorted(sums, key=lambda s: s[66:])) + "\n")
    with open(os.path.join(prv, "MANIFEST.json"), "w", encoding="utf-8", newline="") as f:
        f.write(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")

    # overlap with the 128 public vectors: file level and vector level (the multiset of input file digests)
    pubdir = os.path.join(SC, "vectors")
    pidx = json.load(open(os.path.join(pubdir, "vectors.json"), encoding="utf-8"))
    pfile, pvec = {}, {}
    for v in pidx["vectors"]:
        inp = {k: s for k, s in v["files"].items() if k != "expected.json"}
        for k, s in inp.items():
            pfile.setdefault(s, []).append(v["id"] + "/" + k)
        pvec[tuple(sorted(inp.values()))] = v["id"]
    lines, nfile, nvec = [], 0, 0
    for m in manifest["vectors"]:
        key = tuple(sorted(m["files"].values()))
        if key in pvec:
            nvec += 1
            lines.append("VECTOR %s equals public %s" % (m["id"], pvec[key]))
        for rel, s in m["files"].items():
            if s in pfile:
                nfile += 1
                lines.append("FILE   %s/%s equals %s" % (m["id"], rel, ", ".join(pfile[s][:3])))
    lines.append("public vectors %d; held-out vectors %d; equal vectors %d; equal files %d" % (len(pidx["vectors"]), len(order), nvec, nfile))
    with open(os.path.join(prv, "OVERLAP.txt"), "w", encoding="utf-8", newline="") as f:
        f.write("\n".join(lines) + "\n")

    for m in manifest["vectors"]:
        r = m["reference"]
        print("%s %-44s %-14s %-12s %-16s %s" % (m["id"], m["name"], r["verdict"], r["status"], r["bond_outcome"],
                                                 ",".join(r["deviation_codes"] + r["underspecified_reasons"]) or "-"))
    print(lines[-1])
    return 0 if nvec == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
