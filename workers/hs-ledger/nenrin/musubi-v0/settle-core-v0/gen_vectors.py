#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Regenerate every settle core v0 vector from the two real settled inputs, deterministically.

    python3 gen_vectors.py            # writes vectors/ next to this file, then prints the index summary

Inputs read (never written):
  inputs/peer31/{c.AB.json, e.anchored.json, view.json}   first contract with no party from our project, as its parties published it
  ../second_contract_AB.json and ../run0002/{exec_19c44a79.anchored.json, view.json, walk_8bf29f1a.json}
  the reference code in .. (musubi-v0; SETTLE_REF and SETTLE_P31 override)

Two families:
  real   the real records, contracts and Bitcoin header views, with exactly one change each. A change to the record
         body would break the real Bitcoin anchor, so real vectors change only the anchor, the view, the contract, the
         event list or the nenrin input.
  synth  a synthetic contract shaped like the peer31 contract, signed by synthetic keys named synthetic-principal,
         synthetic-contractor, synthetic-witness and synthetic-stranger (Ed25519 seeds are sha256 of a fixed label,
         so the keys and every signature are the same on every run), anchored on a synthetic regtest-difficulty
         header chain (grant.finality.max_target_bits 207fffff). No real party's identity or key is reused.

Every expected.json is produced by running the reference on the files as written, never by hand.
"""
import base64, copy, hashlib, json, os, shutil, sys

sys.dont_write_bytecode = True                # never write caches into the reference folder

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.environ.get("SETTLE_REF", os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")))
P31 = os.environ.get("SETTLE_P31", os.path.join(os.path.dirname(os.path.abspath(__file__)), "inputs", "peer31"))
OUT = os.path.join(HERE, "vectors")
sys.path.insert(0, REF)
sys.path.insert(0, HERE)

import contract_v0 as v0                     # noqa: E402
import settle_v1 as v1                       # noqa: E402
import settle_v1_1 as v11                    # noqa: E402
import settle_v1_2 as v12                    # noqa: E402
import settle_v1_6 as v16                    # noqa: E402
import settle_v1_16 as s16                   # noqa: E402
from contract_v0 import canonical, parse_strict, contract_sha256, EXEC_SCHEMA   # noqa: E402
from run_reference import core_fields, settle_dir, settle_v1_17_dir, core_fields_v1_17, core_fields_v1_18, core_fields_v1_19                              # noqa: E402
from cryptography.hazmat.primitives import serialization                        # noqa: E402
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: E402

rd = lambda p: parse_strict(open(p, encoding="utf-8").read())
sha_file = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()

# ----------------------------------------------------------------------------------------------- real inputs
P31_C, P31_E, P31_V = (os.path.join(P31, f) for f in ("c.AB.json", "e.anchored.json", "view.json"))
R2_C = os.path.join(REF, "second_contract_AB.json")
R2_E = os.path.join(REF, "run0002", "exec_19c44a79.anchored.json")
R2_V = os.path.join(REF, "run0002", "view.json")
R2_W = os.path.join(REF, "run0002", "walk_8bf29f1a.json")

VECTORS = []


def vector(vid, family, rule, description, contract, events, view, nenrin=None, parent=None):
    """contract / view / each event / each nenrin item / parent: a path (copied byte for byte) or an object (written canonical)."""
    VECTORS.append(dict(id=vid, family=family, rule=rule, description=description, contract=contract,
                        events=list(events), view=view, nenrin=list(nenrin or []), parent=parent))


def _emit(dst, src):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if isinstance(src, str):
        shutil.copyfile(src, dst)
    else:
        with open(dst, "w", encoding="utf-8", newline="") as f:
            f.write(canonical(src))


# ----------------------------------------------------------------------------------------------- real family
pc, pe, pv = rd(P31_C), rd(P31_E), rd(P31_V)
rc, re_, rv, rw = rd(R2_C), rd(R2_E), rd(R2_V), rd(R2_W)
P_H = pe["anchor"]["height"]                                   # 970480
P_CK = pc["lower_bound"]["height"]                             # 970190
R_H = re_["anchor"]["height"]                                  # 969090


def view_upto(view, tip):
    return {"headers": [h for h in view["headers"] if h["height"] <= tip]}


def with_anchor(rec, **kw):
    r = copy.deepcopy(rec)
    for k, v in kw.items():
        if v is None:
            r["anchor"].pop(k, None)
        else:
            r["anchor"][k] = v
    return r


vector("real_p31_baseline", "real", "8,9",
       "The first contract between two outside parties, its anchored execution record and the 359 header view, unchanged. "
       "The reference reproduces the core fields of peer31/settlement.json from these files.",
       P31_C, [P31_E], P31_V)

vector("real_p31_tip_too_shallow", "real", "8.5",
       "The view ends 2 blocks above the anchor block (tip %d). With finality depth 6 the horizon is %d, below the anchor height %d: status provisional." % (P_H + 2, P_H - 3, P_H),
       P31_C, [P31_E], view_upto(pv, P_H + 2))

vector("real_p31_tip_exactly_deep_enough", "real", "8.5",
       "The view ends 5 blocks above the anchor block (tip %d). The horizon is tip - depth + 1 = %d, equal to the anchor height: final (the horizon is inclusive)." % (P_H + 5, P_H),
       P31_C, [P31_E], view_upto(pv, P_H + 5))

vector("real_p31_view_missing_anchor_block", "real", "7.4",
       "The view ends one block below the anchor block (tip %d). The anchor names a height the view does not hold: anchor_beyond_observed_chain, no verdict." % (P_H - 1),
       P31_C, [P31_E], view_upto(pv, P_H - 1))

vector("real_p31_view_without_checkpoint", "real", "5",
       "The view starts one block above the contract checkpoint %d, so the checkpoint the contract signed is not in it: chain_view_rejected." % P_CK,
       P31_C, [P31_E], {"headers": [h for h in pv["headers"] if h["height"] > P_CK]})

vector("real_p31_anchor_names_other_height", "real", "7.4",
       "The anchor's height is moved to %d and its block_hash left as is. The view holds a different block at that height, so the record is orphaned: "
       "excluded, listed, and its height still counts toward finality. With no other record nothing was executed: nothing_to_settle." % (P_H + 1),
       P31_C, [with_anchor(pe, height=P_H + 1)], P31_V)

vector("real_p31_anchor_below_checkpoint", "real", "7.4",
       "The anchor claims height %d, below the contract checkpoint %d (before the earliest block the contract allows). "
       "No honest anchor can have that height: the body names this contract, which commits to the checkpoint's hash. The record is signed by the "
       "contractor, so the settlement fails closed: anchor_below_lower_bound, no verdict. (settle v1.10 to v1.15 dropped it as predates_contract and said "
       "within_grant on an empty event set. See NOTES.md N11.)" % (P_CK - 90, P_CK),
       P31_C, [with_anchor(pe, height=P_CK - 90)], P31_V)

vector("real_p31_anchor_missing", "real", "7.4",
       "The anchor object is removed. A bound, authenticated record with no anchor: anchor_incomplete, no verdict for the whole settlement.",
       P31_C, [{k: v for k, v in pe.items() if k != "anchor"}], P31_V)

_tp = copy.deepcopy(pe["anchor"]["proof"])
_tp[0]["hex"] = "f" + _tp[0]["hex"][1:]
vector("real_p31_proof_operand_changed", "real", "7.5",
       "One hex digit of the first proof operand is changed. The proof no longer reaches the merkle root of block %d: anchor_proof_invalid." % P_H,
       P31_C, [with_anchor(pe, proof=_tp)], P31_V)

_np = copy.deepcopy(pe["anchor"]["proof"])
_np[0]["hex"] = _np[0]["hex"] + "\n"
vector("real_p31_proof_operand_trailing_newline", "real", "6.7,7.5",
       "The first proof operand gets a trailing line feed. Operands are lowercase hex of whole bytes and nothing else, so the anchor is not strict. "
       "It is the only copy of the contractor's record: anchor_not_strict, no verdict. (settle v1.10 to v1.15 matched the pattern before the final newline, "
       "bytes.fromhex skipped it and the record was accepted. See NOTES.md N1.)",
       P31_C, [with_anchor(pe, proof=_np)], P31_V)

vector("real_p31_proof_operand_trailing_newline_beside_good", "real", "6.7",
       "The real record, plus the copy whose first proof operand ends in a line feed. The anchor is not signed, so anyone holding the record can make such "
       "a copy: it is set aside (anchor_not_strict) because another copy of the same signed body is in the input, and the settlement is the baseline's.",
       P31_C, [P31_E, with_anchor(pe, proof=_np)], P31_V)

vector("real_p31_block_hash_trailing_newline", "real", "6.7,7.4",
       "anchor.block_hash gets a trailing line feed. It is not 64 lowercase hex characters, so the anchor is not strict, and it is the only copy: "
       "anchor_not_strict, no verdict. (settle v1.10 to v1.15 accepted it as well formed, found it differed from the view and orphaned the record, "
       "within_grant on an empty event set. See NOTES.md N1.)",
       P31_C, [with_anchor(pe, block_hash=pe["anchor"]["block_hash"] + "\n")], P31_V)

vector("real_p31_same_record_twice", "real", "6.3",
       "The same record bytes are supplied twice. The event set is content addressed: one record, the same settlement as the baseline.",
       P31_C, [P31_E, P31_E], P31_V)

vector("real_p31_two_anchorings_one_body", "real", "6.4",
       "Two copies of the same signed body: the real one, and one whose anchor names the next height (it does not verify there). "
       "Copies are grouped by body digest and the earliest copy whose anchor verifies is kept; the other is listed as dropped.",
       P31_C, [with_anchor(pe, height=P_H + 1), P31_E], P31_V)

_junk = copy.deepcopy(pe)
_junk["signatures"].append({"role": "observer", "sig_b64": "junk"})
vector("real_p31_copy_with_junk_signature_entry", "real", "6.4,7.5 (written behaviour)",
       "The real record, plus a copy with one junk entry appended to its signatures list and the genuine anchor. The signed bytes are the same, so the "
       "two are one record (signed body collapse): the copy is dropped and the settlement is the baseline's. (settle v1.10 to v1.14 read the copy as a "
       "different body whose proof fails: anchor_proof_invalid, no verdict, so anyone holding one record could block a verdict. See NOTES.md N10.)",
       P31_C, [P31_E, _junk], P31_V)

_c = copy.deepcopy(pc)
_s = _c["signatures"][0]["signature"]
_c["signatures"][0]["signature"] = ("A" if _s[0] != "A" else "B") + _s[1:]
vector("real_p31_contract_bad_principal_signature", "real", "4",
       "The principal's contract signature (agent-passport.org) has its first base64 character changed. The contract does not verify: contract_not_verified, no verdict.",
       _c, [P31_E], P31_V)

_c = copy.deepcopy(pc)
_s = _c["signatures"][1]["signature"]
_c["signatures"][1]["signature"] = ("A" if _s[0] != "A" else "B") + _s[1:]
vector("real_p31_contract_bad_contractor_signature", "real", "4",
       "The contractor's contract signature (kuangmi-bit.github.io) has its first base64 character changed: contract_not_verified, no verdict.",
       _c, [P31_E], P31_V)

_c = copy.deepcopy(pc)
_c["grant"]["finality"]["depth"] = 1

_c = copy.deepcopy(pc)
_s = _c["signatures"][0]["signature"]
_c["signatures"][0]["signature"] = ("A" if _s[0] != "A" else "B") + _s[1:]
vector("real_p31_bad_contract_and_bad_view", "real", "2.3,4,5",
       "TWO changes on purpose: the principal's contract signature is broken and the view lacks the checkpoint. Both reasons are reported "
       "(contract_not_verified and chain_view_rejected): a settler checks the view even when the contract fails, and reports every reason it found.",
       _c, [P31_E], {"headers": [h for h in pv["headers"] if h["height"] > P_CK]})

vector("real_cross_record_names_other_contract", "real", "6.1",
       "The peer31 execution record settled against the run0002 contract and view. Its contract_ref.contract_sha256 names other terms: foreign, "
       "never settled. Nothing is bound, so nothing_to_settle (status final: no height to wait for).",
       R2_C, [P31_E], R2_V)

vector("real_r2_baseline", "real", "7.6,8,11",
       "Our run0002 contract, its execution anchored through a NENRIN agreement batch (hexlify batch leg), the 535 header view and the walk the record cites, unchanged. "
       "settlement_walk2.json was produced by settle_v1_6; the reference gives the same core fields.",
       R2_C, [R2_E], R2_V, [R2_W])

_hp = [{"op": "prepend", "hex": ""}] + copy.deepcopy(re_["anchor"]["proof"])
vector("real_r2_hexlify_not_leading", "real", "7.6",
       "An empty prepend is put in front of the hexlify operation. An empty operand is strict (zero whole bytes) and the proof still reaches the merkle root, "
       "but a proof that uses hexlify must start with it: anchor_batch_leg_refused (detail hexlify_not_leading), no verdict.",
       R2_C, [with_anchor(re_, proof=_hp)], R2_V, [R2_W])

_bp = copy.deepcopy(re_["anchor"]["proof"])
_bp.insert(1, {"op": "append", "hex": ""})
vector("real_r2_batch_leg_extra_empty_append", "real", "7.6",
       "An empty append is inserted right after hexlify. The proof still verifies and the batch rebuilt from the operands is unchanged, "
       "so the batch leg rule accepts it: the record settles as in the baseline (its record sha256 changes).",
       R2_C, [with_anchor(re_, proof=_bp)], R2_V, [R2_W])

# ----------------------------------------------------------------------------------------------- synthetic family
def seedkey(name):
    k = Ed25519PrivateKey.from_private_bytes(hashlib.sha256(("settle-core-v0 synthetic key: " + name).encode()).digest())
    pub = base64.b64encode(k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
    return k, pub


KP, PP = seedkey("synthetic-principal")
KC, PC = seedkey("synthetic-contractor")
KW, PW = seedkey("synthetic-witness")
KS, PS = seedkey("synthetic-stranger")
DOM_P, DOM_C = "principal.synthetic.invalid", "contractor.synthetic.invalid"
H0, LABEL = 800000, "settle-core-v0-synthetic"
CK = H0 + 1                                                   # the synthetic checkpoint
DEPTH = 6


class Chain(object):
    """Regtest-difficulty headers (nBits 207fffff), mined deterministically by settle_v1_1._mine."""
    def __init__(self):
        self.headers, self.hashes, self.prev = [], {}, "00" * 32
        self.block()                                          # 800000
        self.block()                                          # 800001 = checkpoint

    def _mine(self, root):
        h = H0 + len(self.headers)
        raw = v11._mine(self.prev, root, salt=h * 7 + len(LABEL))
        hh = v11.header_hash(raw)
        self.headers.append({"height": h, "hex": raw.hex()})
        self.hashes[h] = hh
        self.prev = hh
        return h, hh

    def block(self, leaves=()):
        if leaves:
            root, proofs = v11._tree(list(leaves))
        else:
            root, proofs = hashlib.sha256(("%s-%d" % (LABEL, H0 + len(self.headers))).encode()).digest(), []
        h, hh = self._mine(root)
        return h, hh, proofs

    def put(self, *records):
        """One block holding these records, each anchored by a plain merkle path (no batch leg)."""
        h, hh, proofs = self.block([v11.commitment_digest(r) for r in records])
        out = []
        for r, p in zip(records, proofs):
            r = copy.deepcopy(r)
            r["anchor"] = {"height": h, "block_hash": hh, "proof": p}
            out.append(r)
        return out if len(out) > 1 else out[0]

    def put_in_batch(self, record, prefix, suffix):
        """One block whose single leaf is sha256(prefix + hex(digest) + suffix); the record's proof runs through that batch."""
        d = v11.commitment_digest(record)
        batch = prefix + d.hex().encode("ascii") + suffix
        h, hh, proofs = self.block([hashlib.sha256(batch).digest()])
        r = copy.deepcopy(record)
        r["anchor"] = {"height": h, "block_hash": hh,
                       "proof": [{"op": "hexlify"}, {"op": "prepend", "hex": prefix.hex()}, {"op": "append", "hex": suffix.hex()},
                                 {"op": "sha256"}] + proofs[0]}
        return r

    def pad(self, n):
        for _ in range(n):
            self.block()
        return self

    def view(self):
        return {"headers": list(self.headers)}


CHECKPOINT_HASH = Chain().hashes[CK]
SYN_PAYLOAD = "synthetic task for the settle core v0 vectors; no real party, key or endpoint is named"


def synth_contract(grant_over=None, grant_drop=(), sign=True, top=None, label="settle-core-v0 synthetic"):
    """The peer31 contract with synthetic parties, task, checkpoint and difficulty floor, then grant_over applied, then signed."""
    c = copy.deepcopy(pc)
    c["contract_id"] = hashlib.sha256((label + " contract_id").encode()).hexdigest()[:32]
    c["nonce"] = hashlib.sha256((label + " nonce").encode()).hexdigest()[:32]
    c["agreed_at"] = "2026-10-17T00:00:00Z"
    c["lower_bound"] = {"kind": "bitcoin_block", "height": CK, "hash": CHECKPOINT_HASH}
    c["parties"] = [
        {"domain": DOM_P, "key_url": "https://%s/keys/agreement.json" % DOM_P, "public_key_ed25519_b64": PP, "role": "principal"},
        {"domain": DOM_C, "key_url": "https://%s/keys/agreement.json" % DOM_C, "public_key_ed25519_b64": PC, "role": "contractor"}]
    c["task"] = {"purpose": "independent_reproduction", "payload": SYN_PAYLOAD,
                 "payload_digest": hashlib.sha256(SYN_PAYLOAD.encode()).hexdigest(),
                 "action_definitions": {"read": "synthetic read; changes nothing"}, "a2a_task_id": None}
    c["grant"]["finality"] = {"depth": DEPTH, "max_target_bits": "207fffff"}
    c["bond"] = {"amount": 1000, "currency": "JPY"}           # so that bond_outcome is exercised (the real contracts carry none)
    for k in grant_drop:
        c["grant"].pop(k, None)
    for k, v in (grant_over or {}).items():
        c["grant"][k] = v
    for k, v in (top or {}).items():
        c[k] = v
    c["signatures"] = []
    if sign:
        v0.sign_contract(c, KP, PP, DOM_P)
        v0.sign_contract(c, KC, PC, DOM_C)
        if not (top and "parent_contract" in top):
            assert v0.verify_contract(c)["verdict"] == "accepted", v0.verify_contract(c)
    return c


BASE = synth_contract()


def ex(c, actions=("read",), approvals=(), delegated=(), extra=None, ref=None, signer="contractor", sign=True):
    r = {"schema": EXEC_SCHEMA,
         "contract_ref": {"contract_id": c["contract_id"], "contract_sha256": contract_sha256(c), "payload_digest": c["task"]["payload_digest"]},
         "performed_actions": list(actions), "approvals": list(approvals), "delegated_to": list(delegated),
         "nenrin_ref": pe["nenrin_ref"]}
    if extra:
        r.update(extra)
    if ref:
        r["contract_ref"] = dict(r["contract_ref"], **ref)
        r["contract_ref"] = {k: v for k, v in r["contract_ref"].items() if v is not None}
    if sign:
        key, role, wname = {"contractor": (KC, "contractor", None), "witness": (KW, "witness", "synthetic-witness"),
                            "stranger": (KS, "contractor", None)}[signer]
        v12.sign_record(r, key, role, wname)
    return r


def revocation(c, key=KP, role="principal", revoked_by="principal"):
    r = {"schema": v1.REVOKE_SCHEMA,
         "contract_ref": {"contract_id": c["contract_id"], "contract_sha256": contract_sha256(c), "payload_digest": c["task"]["payload_digest"]},
         "revoked_by": revoked_by}
    return v12.sign_record(r, key, role)


def synth(vid, rule, description, c, build, pad=DEPTH, nenrin=None, parent=None):
    """build(chain) -> list of records already anchored on the chain; the chain is padded by `pad` empty blocks after."""
    ch = Chain()
    recs = build(ch)
    ch.pad(pad)
    vector(vid, "synth", rule, description, c, recs, ch.view(), nenrin, parent)


one = lambda c, **kw: (lambda ch: [ch.put(ex(c, **kw))])

synth("synth_baseline", "8,9",
      "The synthetic baseline: the peer31 contract shape with synthetic parties and a synthetic regtest chain. One contractor-signed execution of read, "
      "anchored by a merkle path at %d, 6 blocks of depth: within_grant, final." % (CK + 1),
      BASE, one(BASE))

synth("synth_exec_signed_by_stranger", "6.5",
      "The execution record says role contractor but is signed by synthetic-stranger, a key the contract does not pin: rejected, not settled. "
      "Nothing else is bound, so nothing_to_settle (a frame attempt does not charge the contractor).",
      BASE, one(BASE, actions=["delete"], signer="stranger"))

synth("synth_exec_unsigned", "6.5",
      "The execution record of a prohibited action carries no signatures: rejected (unsigned), not settled; nothing_to_settle.",
      BASE, one(BASE, actions=["delete"], sign=False))

synth("synth_prohibited_action", "10.3",
      "The contractor signs an execution of delete, which grant.prohibited_actions lists: deviation prohibited.",
      BASE, one(BASE, actions=["delete"]))

synth("synth_action_not_authorized", "10.3",
      "The contractor signs an execution of write, which is neither authorized, prohibited nor conditional: deviation unauthorized.",
      BASE, one(BASE, actions=["write"]))

synth("synth_action_name_not_canonical", "6.6,10.3",
      "The contractor signs an execution of Read (capital R). Action names must match ^[a-z][a-z0-9_.:-]{0,63}$, so the record is nonconforming; "
      "it is still judged, and Read is not an authorized name: deviations nonconforming_record and unauthorized.",
      BASE, one(BASE, actions=["Read"]))

synth("synth_action_name_trailing_newline", "6.7",
      "The contractor signs an execution of delete followed by a line feed. A control character in a signed string is not strict, and the record is the "
      "contractor's own signed statement: record_not_strict, no verdict. (settle v1.10 to v1.15 matched the action pattern before the final newline and "
      "read the record as unauthorized. See NOTES.md N1.)",
      BASE, one(BASE, actions=["delete\n"]))

synth("synth_record_field_outside_schema", "6.6",
      "The contractor's execution record carries a field outside the schema (failed_actions). Hiding an attempt outside performed_actions is itself a "
      "deviation: nonconforming_record. read itself is within the grant.",
      BASE, one(BASE, extra={"failed_actions": ["delete"]}))

synth("synth_outcome_error_does_not_excuse", "6.6,10.3",
      "The contractor records delete with outcomes {delete: error}. The schema allows outcomes; an error never excuses scope: deviation prohibited.",
      BASE, one(BASE, actions=["delete"], extra={"outcomes": {"delete": "error"}}))

C_EXP = synth_contract({"expiry_height": CK + 1})
synth("synth_after_expiry", "10.2",
      "grant.expiry_height is %d; the execution is anchored at %d: deviation after_expiry." % (CK + 1, CK + 2),
      C_EXP, lambda ch: [ch.pad(1).put(ex(C_EXP))])

synth("synth_at_expiry_height", "10.2",
      "grant.expiry_height is %d and the execution is anchored exactly at %d: within_grant (expiry is exclusive above, h > expiry_height)." % (CK + 1, CK + 1),
      C_EXP, one(C_EXP))


synth("synth_tip_too_shallow", "8.5,9",
      "The execution sits 3 blocks below the tip; depth 6 needs 5: status provisional, and with a bond the outcome is pending_finality.",
      BASE, one(BASE), pad=3)

synth("synth_payload_digest_mismatch", "6.1",
      "The signed record carries this contract's contract_sha256 and contract_id but another payload_digest: inconsistent, never settled; nothing_to_settle.",
      BASE, one(BASE, actions=["delete"], ref={"payload_digest": "00" * 32}))


synth("synth_label_only_reference", "6.1",
      "The signed record names the contract_id and payload_digest but no contract_sha256 (a pre-v1.5 label binding): unbound, not settled in strict mode; nothing_to_settle.",
      BASE, one(BASE, actions=["delete"], ref={"contract_sha256": None}))

C_W = synth_contract({"witnesses": [{"name": "synthetic-witness", "public_key_ed25519_b64": PW}]})
synth("synth_witness_attests_prohibited", "6.5,10.3",
      "grant.witnesses names synthetic-witness. An execution of delete signed only by that witness is accepted as evidence of the act: deviation prohibited.",
      C_W, one(C_W, actions=["delete"], signer="witness"))

C_WP = synth_contract({"witnesses": [{"name": "synthetic-witness", "public_key_ed25519_b64": PP}]})
synth("synth_witness_key_is_principal_key", "4.2",
      "grant.witnesses pins the principal's own key as the witness key. Keys must be pairwise distinct: key_conflict, no verdict.",
      C_WP, one(C_WP))

COND = [{"action": "refund", "requires": "principal_approval"}]
C_CO = synth_contract({"conditional": COND})
NONCE = lambda i: ("%02x" % i) * 16
appr = lambda vu=CK + 100, n=1, key=KP, c=C_CO, single=True: v16.sign_approval_v2(key, c, "refund", vu, NONCE(n), single)

synth("synth_conditional_without_approval", "10.4",
      "grant.conditional requires principal_approval for refund. The contractor performs refund with no approval: deviation conditional.",
      C_CO, one(C_CO, actions=["refund"]))

synth("synth_conditional_approved_same_record", "10.4",
      "refund carries a principal-signed a2a-approval-v2 in the same record (valid_until_height above the block, single use): counted, within_grant.",
      C_CO, one(C_CO, actions=["refund"], approvals=[appr()]))

synth("synth_conditional_approval_same_block_other_record", "10.4",
      "The approval is carried by another record anchored in the same block as the refund. Authority is granted only from an earlier block or the "
      "same record: not counted, deviation conditional.",
      C_CO, lambda ch: list(ch.put(ex(C_CO, actions=["read"], approvals=[appr()]), ex(C_CO, actions=["refund"]))))

synth("synth_conditional_approval_earlier_block", "10.4",
      "The approval is carried by a record anchored one block before the refund: counted, within_grant.",
      C_CO, lambda ch: [ch.put(ex(C_CO, actions=["read"], approvals=[appr()])), ch.put(ex(C_CO, actions=["refund"]))])

synth("synth_conditional_approval_expired", "10.4",
      "The approval's valid_until_height is %d; the refund carrying it is anchored at %d: not counted (approval_expired), deviation conditional." % (CK, CK + 1),
      C_CO, one(C_CO, actions=["refund"], approvals=[appr(vu=CK)]))

synth("synth_conditional_approval_reused", "10.4",
      "One single_use approval, then two refunds in two later blocks. The first consumes the nonce; the second finds it used: deviation conditional (approval_reused).",
      C_CO, lambda ch: [ch.put(ex(C_CO, actions=["read"], approvals=[appr()])), ch.put(ex(C_CO, actions=["refund"])),
                        ch.put(ex(C_CO, actions=["refund"], extra={"nenrin_ref": "11" * 32}))])

synth("synth_approval_signed_by_contractor", "10.4,10.5",
      "The refund carries an approval that says by principal but is signed with the contractor's key: forged_approval, and the refund is unapproved (conditional).",
      C_CO, one(C_CO, actions=["refund"], approvals=[appr(key=KC)]))

synth("synth_approval_label_bound", "10.4",
      "The refund carries a genuine principal signature over the old a2a-approval-v0 bytes (contract_id, payload_digest, action). "
      "It is label_bound: listed, not counted, not forged. Deviation conditional only.",
      C_CO, one(C_CO, actions=["refund"], approvals=[v12.sign_approval(KP, C_CO, "refund")]))

_onc = v16.sign_approval_v2(KP, C_CO, "refund", CK + 100, NONCE(7) + "\n")
synth("synth_approval_nonce_trailing_newline", "6.7",
      "The approval's nonce is 32 hex digits plus a trailing line feed, signed as such, inside the contractor's signed record: record_not_strict, no verdict. "
      "(settle v1.10 to v1.15 matched the nonce pattern before the final newline and counted the approval: within_grant. See NOTES.md N1.)",
      C_CO, one(C_CO, actions=["refund"], approvals=[_onc]))

synth("synth_delegation_not_allowed", "10.3",
      "grant.delegation.allowed is empty; the record names delegated_to [helper.synthetic.invalid]: deviation delegation.",
      BASE, one(BASE, delegated=["helper.synthetic.invalid"]))

synth("synth_revoked_same_block", "10.1",
      "A principal-signed revocation (effective_at anchor) and an execution anchored in the same block. Authority ends at the revocation's block, inclusive: deviation revoked.",
      BASE, lambda ch: list(ch.put(revocation(BASE), ex(BASE))))

synth("synth_revocation_signed_by_contractor", "6.5,10.1",
      "A revocation that says revoked_by principal is signed with the contractor's key (role principal claimed). It does not authenticate: rejected, the grant stands, within_grant.",
      BASE, lambda ch: [ch.put(revocation(BASE, key=KC)), ch.put(ex(BASE))])

synth("synth_revocation_by_non_principal", "6.5,10.1",
      "A revocation correctly signed by the principal but whose revoked_by field says contractor: ignored, the grant stands, within_grant.",
      BASE, lambda ch: [ch.put(revocation(BASE, revoked_by="contractor")), ch.put(ex(BASE))])

C_ACK = synth_contract({"revocation": {"effective_at": "delivery_ack", "ack_window": 2}})
synth("synth_delivery_ack_window", "10.1",
      "effective_at delivery_ack with ack_window 2 and no acknowledgement. Revocation at h, executions at h+1 and h+2. Authority ends at min(ack height, h + window) = h+2, "
      "inclusive: the act at h+1 stands, the act at h+2 is revoked.",
      C_ACK, lambda ch: [ch.put(revocation(C_ACK)), ch.put(ex(C_ACK)), ch.put(ex(C_ACK, extra={"nenrin_ref": "22" * 32}))])

C_TIE = synth_contract({"ordering": {"same_height": "record_sha256"}})
synth("synth_tie_policy_record_sha256", "4.2",
      "grant.ordering.same_height is record_sha256, which a record author can grind: tie_policy_refused, no verdict.",
      C_TIE, one(C_TIE))

W_OTHER = {"schema": "synthetic-walk-v0", "context": {"contract_sha256": "ee" * 32}, "note": "a synthetic walk produced under other terms"}
W_OTHER_SHA = v1.rec_sha(W_OTHER)
synth("synth_nenrin_walk_names_other_contract", "11",
      "The execution's nenrin_ref is the sha256 of a supplied walk record whose context.contract_sha256 names other terms: deviation evidence_names_other_contract.",
      BASE, one(BASE, extra={"nenrin_ref": W_OTHER_SHA}), nenrin=[W_OTHER])

synth("synth_nenrin_check_reads_rejected_record", "6.5,11",
      "An honest signed execution of read, plus an UNSIGNED, unanchored record bound to the contract whose nenrin_ref cites a walk made under other terms. "
      "The unsigned record is rejected, and no check reads a rejected record: within_grant, the bond held. (settle v1.10 to v1.15 ran the nenrin cross "
      "check over every bound record: deviation evidence_names_other_contract, the bond forfeited, a charge anyone could add. See NOTES.md N2.)",
      BASE, lambda ch: [ch.put(ex(BASE)), ex(BASE, actions=["read"], extra={"nenrin_ref": W_OTHER_SHA}, sign=False)], nenrin=[W_OTHER])

_rec = lambda: ex(BASE)


def _batch(listing_sha, extra_rejected=None, kind="execution"):
    """A nenrin-agreement-batch-v1 text with the digest hex spliced where the generator says. Returns (prefix, suffix)."""
    if extra_rejected is None:
        pre = '{"schema":"nenrin-agreement-batch-v1","count":1,"records":[{"sha":"'
        suf = '","kind":"%s","schema":"a2a-execution-v0"}]}' % kind
    else:
        pre = '{"schema":"nenrin-agreement-batch-v1","count":1,"records":[{"sha":"%s","kind":"execution","schema":"a2a-execution-v0"}],"rejected":["' % listing_sha
        suf = '"]}'
    return pre.encode(), suf.encode()


synth("synth_batch_leg_listed", "7.6",
      "The execution is anchored through a nenrin-agreement-batch-v1 batch that lists its digest as records[0].sha with kind execution: the batch leg is accepted, within_grant.",
      BASE, lambda ch: [ch.put_in_batch(_rec(), *_batch(None))])

synth("synth_batch_leg_not_listed", "7.6",
      "The batch bytes contain the record's digest only inside a rejected list; records[] lists another sha. The proof reaches the merkle root, "
      "but the digest is not a listing: anchor_batch_leg_refused (detail record_not_listed_in_batch), no verdict.",
      BASE, lambda ch: [ch.put_in_batch(_rec(), *_batch("ab" * 32, extra_rejected=True))])

synth("synth_batch_leg_kind_mismatch", "7.6",
      "The batch lists the digest as records[0].sha but with kind agreement; the record is an a2a-execution-v0: anchor_batch_leg_refused (detail record_kind_mismatch).",
      BASE, lambda ch: [ch.put_in_batch(_rec(), *_batch(None, kind="agreement"))])


# ----------------------------------------------------------------------------------------------- settle v1.16 rules
L_ORDER = 2 ** 252 + 27742317777372353535851937790883648493


def malleate(sig_b64):
    """The same signature with S + L in place of S: a lax verifier may accept it, a strict one does not."""
    raw = base64.b64decode(sig_b64)
    return base64.b64encode(raw[:32] + (int.from_bytes(raw[32:], "little") + L_ORDER).to_bytes(32, "little")).decode()


def ex_without(c, field, **kw):
    r = ex(c, sign=False, **kw)
    r.pop(field)
    return v12.sign_record(r, KC, "contractor")


def _appr_keys(mode):
    a = appr()
    if mode == "signature_only":
        a["signature"] = a.pop("sig_b64")
    elif mode == "lax_beside_good":
        a["signature"] = malleate(a["sig_b64"])
    else:
        a["signature"] = a["sig_b64"]
    return a


synth("synth_approval_signature_key_only", "10.4,10.5",
      "The refund carries a principal-signed a2a-approval-v2 whose signature is under the key signature instead of sig_b64. Only sig_b64 is verified: "
      "forged_approval, and the refund is unapproved (conditional). Revision 0.1, NOTES.md N13.",
      C_CO, lambda ch: [ch.put(ex(C_CO, actions=["refund"], approvals=[_appr_keys("signature_only")]))])

synth("synth_approval_lax_signature_beside_good_sig_b64", "6.0",
      "The approval's sig_b64 is a strict, valid principal signature; beside it, signature holds the same signature with S + L. Each key is checked for "
      "strictness on its own: the contractor-signed body is not strict, record_not_strict. Revision 0.1, NOTES.md N13.",
      C_CO, lambda ch: [ch.put(ex(C_CO, actions=["refund"], approvals=[_appr_keys("lax_beside_good")]))])

synth("synth_approval_signature_key_same_value", "6.0,10.4",
      "Control: sig_b64 and signature hold the same strict, valid principal signature. The approval is counted: within_grant. Revision 0.1, NOTES.md N13.",
      C_CO, lambda ch: [ch.put(ex(C_CO, actions=["refund"], approvals=[_appr_keys("same")]))])


synth("synth_nothing_to_settle", "9",
      "No record at all. Nothing was executed, so nothing is within the grant or outside it: nothing_to_settle, final, the bond held.",
      BASE, lambda ch: [])

synth("synth_delegated_to_object", "6.7",
      "The contractor signs an execution whose delegated_to holds an object, not a string: record_not_strict, no verdict. "
      "(settle v1.7 to v1.15 stopped with an exception on this input. See NOTES.md N6.)",
      BASE, one(BASE, delegated=[{"to": "helper.synthetic.invalid"}]))

synth("synth_float_in_signed_body", "6.7",
      "The contractor signs an execution whose outcomes carry 0.5. A number that is not an integer has no canonical form shared by every runtime: "
      "record_not_strict, no verdict. See NOTES.md N4.",
      BASE, one(BASE, extra={"outcomes": {"read": 0.5}}))

synth("synth_unsafe_integer_in_signed_body", "6.7",
      "The contractor signs an execution whose outcomes carry 2^53. A JavaScript reader cannot hold it exactly: record_not_strict, no verdict. See NOTES.md N4.",
      BASE, one(BASE, extra={"outcomes": {"read": 2 ** 53}}))

synth("synth_unsigned_float_beside_good", "6.7",
      "An honest signed execution of read, plus an unsigned record of delete carrying a float. Nobody signed it, so it cannot change anything: "
      "set aside (record_not_strict), within_grant.",
      BASE, lambda ch: [ch.put(ex(BASE)), ex(BASE, actions=["delete"], extra={"outcomes": {"delete": 1.5}}, sign=False)])

C_NR = synth_contract(grant_drop=("revocation",), label="settle-core-v0 synthetic irrevocable")
synth("synth_revocation_irrevocable_grant", "6.7,10.1",
      "The grant has no revocation block. A principal-signed revocation, then an execution of read: the contract cannot be revoked, so the revocation "
      "is set aside (revocation_not_provided_for) and the execution is within_grant. (settle v1.7 to v1.15 stopped with an exception. See NOTES.md N6.)",
      C_NR, lambda ch: [ch.put(revocation(C_NR)), ch.put(ex(C_NR))])

_m = ex(BASE)
_m["signatures"][0]["sig_b64"] = malleate(_m["signatures"][0]["sig_b64"])
synth("synth_signature_s_plus_l", "6.5",
      "The contractor's signature with S + L in place of S (L the group order). Its only signature is not strict, so the record is not strictly "
      "signed: rejected, nothing_to_settle. See NOTES.md N9.",
      BASE, lambda ch: [ch.put(_m)])

_m2 = ex(BASE)
_m2["signatures"].append(dict(_m2["signatures"][0], sig_b64=malleate(_m2["signatures"][0]["sig_b64"])))
synth("synth_strict_signature_beside_malleated", "6.5",
      "The contractor's strict signature, plus a second entry carrying the same signature with S + L. One strict signature from an allowed role "
      "authenticates the record; the other entry is ignored: within_grant.",
      BASE, lambda ch: [ch.put(_m2)])

synth("synth_bond_empty_list", "4.3",
      "The contract's bond is []. A bond is null, or an object whose amount is a positive integer: bond_malformed, no verdict. "
      "(settle v1.10 to v1.15 read [] as no bond; a JavaScript reader reads it as a bond. See NOTES.md N8.)",
      synth_contract(top={"bond": []}, label="settle-core-v0 synthetic bond list"),
      lambda ch: [ch.put(ex(synth_contract(top={"bond": []}, label="settle-core-v0 synthetic bond list")))])

_CBS = synth_contract(top={"bond": {"amount": "1000", "currency": "JPY"}}, label="settle-core-v0 synthetic bond string")
synth("synth_bond_amount_string", "4.3",
      "The contract's bond amount is the string 1000: bond_malformed, no verdict. See NOTES.md N8.",
      _CBS, one(_CBS))

PARENT = synth_contract(label="settle-core-v0 synthetic parent")
_CH = synth_contract(top={"parent_contract": {"contract_id": PARENT["contract_id"], "settlement_url": None}}, label="settle-core-v0 synthetic child")
synth("synth_parent_not_supplied", "4.4",
      "The contract names a parent_contract and no parent is supplied: parent_not_supplied, no verdict. (settle v1.10 to v1.15 never looked. See NOTES.md N11.)",
      _CH, one(_CH))

synth("synth_parent_supplied_narrows", "4.4",
      "The same child contract with its parent supplied (parent.json). The child's grant is the parent's: it verifies under the parent, within_grant.",
      _CH, one(_CH), parent=PARENT)

_CW = synth_contract({"authorized_actions": list(pc["grant"]["authorized_actions"]) + ["write"]},
                     top={"parent_contract": {"contract_id": PARENT["contract_id"], "settlement_url": None}}, label="settle-core-v0 synthetic wider child")
synth("synth_parent_widened", "4.4",
      "A child contract that adds write to the parent's authorized actions, with the parent supplied: parent_narrowing_failed, no verdict.",
      _CW, one(_CW), parent=PARENT)

synth("synth_nenrin_required_without_ref", "11",
      "requirements.evidence is nenrin_required; the contractor's execution of read carries no nenrin_ref: deviation evidence_missing. "
      "(settle v1.10 to v1.15 never read requirements.evidence. See NOTES.md N11.)",
      BASE, lambda ch: [ch.put(ex_without(BASE, "nenrin_ref"))])


_G = ex(BASE, actions=["delete"])
_U1 = {k: v for k, v in _G.items() if k != "signatures"}
_U2 = dict(_G, signatures=[])
synth("synth_unsigned_copies_anchored_first", "6.5",
      "The contractor's signed execution of delete, and two unsigned copies of its body (no signatures key; an empty signatures list) anchored "
      "in the two blocks before it. Records that are not strictly signed are rejected before anything else reads the input, so no copy "
      "collapse or check sees them: deviation prohibited, the bond forfeited. (A rule that dropped rejected records only once let the second "
      "unsigned copy displace the signed record: nothing_to_settle, the bond held.)",
      BASE, lambda ch: [ch.put(_U1), ch.put(_U2), ch.put(_G)])

_C_OLD = synth_contract({"authorized_actions": ["read", "write"]}, top={"contract_id": BASE["contract_id"]}, label="settle-core-v0 synthetic earlier terms")


def _old_terms(ch):
    honest = ch.put(ex(BASE))
    old = ch.put(ex(_C_OLD, actions=["write"]))
    old["anchor"]["block_hash"] = old["anchor"]["block_hash"].upper()
    return [honest, old]


synth("synth_earlier_terms_record_bad_anchor", "6.1,6.7",
      "Same contract_id, two sets of terms. An honest execution under these terms, and the contractor's record under the earlier terms with its "
      "block_hash in upper case. Binding is by contract_sha256, so the earlier record is foreign and never triaged: within_grant.",
      BASE, _old_terms)


W_FLOAT = {"schema": "synthetic-walk-v0", "context": {"contract_sha256": "ee" * 32}, "note": "a walk with a float", "score": 0.5}
synth("synth_cited_walk_not_strict", "11",
      "The contractor's execution cites, by nenrin_ref, a supplied walk that carries a float. The walk cannot be read strictly and the contractor "
      "chose to cite it: walk_not_strict, no verdict. (Leaving it out silently would hide the evidence_names_other_contract it shows.)",
      BASE, one(BASE, extra={"nenrin_ref": v1.rec_sha(W_FLOAT)}), nenrin=[W_FLOAT])


def _view_with_newline():
    ch = Chain()
    r = ch.put(ex(BASE))
    ch.pad(DEPTH)
    v = ch.view()
    v["headers"][0] = dict(v["headers"][0], hex=v["headers"][0]["hex"] + "\n")
    return [r], v


_r, _v = _view_with_newline()
vector("synth_view_header_trailing_newline", "synth", "5",
       "The baseline, with the view's first header ending in a line feed. A header is 160 lowercase hex characters and nothing else: "
       "view_not_strict, no verdict. See NOTES.md N1.",
       BASE, _r, _v)


# ----------------------------------------------------------------------------------------------- write
# ----------------------------------------------------------------------------------------------- revision 0.2 (NOTES.md N14)
# Each vector below pins one place where the text of revision 0.1 was silent or wrong and a separately written
# implementation (aeoess/musubi-settle-core-check, horizon-shield Issue #49) took another reading. The reference did not change.

def _resigned(c):
    c = copy.deepcopy(c)
    c["signatures"] = []
    v0.sign_contract(c, KP, PP, DOM_P)
    v0.sign_contract(c, KC, PC, DOM_C)
    return c


synth("synth_contract_not_object", "9.1",
      "The contract is a JSON list, not an object. There is nothing to digest: contract_sha256 is null, contract_not_verified. Revision 0.2 (A1).",
      [1, 2], lambda ch: [])

synth("synth_nan_in_signed_body", "2.2,6.0",
      "The contractor signs an execution whose body holds the token NaN. The reader takes NaN as a number that is not an integer, so the signed body "
      "is not strict: record_not_strict. It is not a parse error. Revision 0.2 (A15).",
      BASE, one(BASE, extra={"score": float("nan")}))

synth("synth_batch_bytes_with_nan", "7.6",
      "The execution is anchored through a nenrin-agreement-batch-v1 batch whose bytes also carry \"note\":NaN. Batch bytes are read by the same "
      "reader, which takes NaN as a number: the batch leg is accepted, within_grant. Revision 0.2 (A12).",
      BASE, lambda ch: [ch.put_in_batch(_rec(), b'{"schema":"nenrin-agreement-batch-v1","count":1,"note":NaN,"records":[{"sha":"',
                                        b'","kind":"execution","schema":"a2a-execution-v0"}]}')])

_C_TAB = synth_contract(sign=False, label="settle-core-v0 synthetic tab domain")
_C_TAB["parties"][0]["domain"] = "\t" + DOM_P
_C_TAB = _resigned(_C_TAB)
synth("synth_domain_leading_tab", "4.1",
      "The principal's domain is written with a leading tab. Normalization strips every leading and trailing whitespace character (Python str.strip), "
      "then lowercases, then removes trailing dots: the domain is the signature's, within_grant. Revision 0.2 (A6).",
      _C_TAB, one(_C_TAB))

_C_DEL0 = _resigned(dict(synth_contract(sign=False, label="settle-core-v0 synthetic empty delegation"),
                         grant=dict(BASE["grant"], delegation={})))
synth("synth_delegation_empty_object", "4.1",
      "grant.delegation is {}. delegation must carry allowed: contract_not_verified. Revision 0.2 (A7).",
      _C_DEL0, one(_C_DEL0))

_C_ORD0 = _resigned(dict(synth_contract(sign=False, label="settle-core-v0 synthetic empty ordering"),
                         grant=dict(BASE["grant"], ordering={})))
synth("synth_ordering_empty_object", "4.1",
      "grant.ordering is {}. same_height is optional, so the empty object is accepted: within_grant. Revision 0.2 (A7).",
      _C_ORD0, one(_C_ORD0))

vector("synth_view_not_an_object", "synth", "5.1",
       "The view is a JSON list. It is rejected (chain_view_rejected); rule 9 is not applied to a view that is not an object with a headers list, so "
       "view_not_strict is not added. Revision 0.2 (A16).",
       BASE, [], [])

vector("synth_view_headers_not_a_list", "synth", "5.1",
       "view.headers is an object. chain_view_rejected only, as for a view that is not an object. Revision 0.2 (A16).",
       BASE, [], {"headers": {}})

_C_LIM0 = _resigned(dict(synth_contract(sign=False, label="settle-core-v0 synthetic limits null"), grant=dict(BASE["grant"], limits=None)))
synth("synth_limits_null", "1",
      "grant.limits is present with the value null. A null limits is not carried (section 1), so the contract is in core: within_grant. Revision 0.2 (A20).",
      _C_LIM0, one(_C_LIM0))

_C_ADM0 = _resigned(dict(synth_contract(sign=False, label="settle-core-v0 synthetic admission null"),
                         requirements=dict(BASE.get("requirements") or {}, admission=None)))
synth("synth_admission_null", "1",
      "requirements.admission is present with the value null: not carried, in core, within_grant. Revision 0.2 (A20).",
      _C_ADM0, one(_C_ADM0))


def _cited_orphan(ch):
    r = copy.deepcopy(ch.put(ex(BASE, extra={"nenrin_ref": W_OTHER_SHA})))
    r["anchor"]["height"] += 1
    return [r, ch.put(ex(BASE))]


synth("synth_cited_walk_orphaned_execution", "11.1",
      "An execution cites a walk made under other terms, and its anchor names a height whose block is another: the execution is orphaned and "
      "leaves the event set, but the cross check reads every execution left after 6.4 whatever its anchor result: evidence_names_other_contract. "
      "WRITTEN BEHAVIOUR, revision 0.2 (A14).",
      BASE, _cited_orphan, nenrin=[W_OTHER])

_C_ZT = _resigned(dict(synth_contract(sign=False, label="settle-core-v0 synthetic zero floor"),
                       grant=dict(BASE["grant"], finality={"depth": DEPTH, "max_target_bits": "20000000"})))
synth("synth_floor_zero_mantissa", "4.1,5.1",
      "grant.finality.max_target_bits is 20000000, whose mantissa is zero. 5.2 decodes it to no target, so the door refuses the contract and 5.1 "
      "rule 1 rejects the view: contract_not_verified and chain_view_rejected. Revision 0.2 (A21).",
      _C_ZT, one(_C_ZT))

C_ACK10 = synth_contract({"revocation": {"effective_at": "delivery_ack", "ack_window": 10}}, label="settle-core-v0 synthetic ack window 10")


def _ack(rev_sha, c):
    r = {"schema": v1.ACK_SCHEMA,
         "contract_ref": {"contract_id": c["contract_id"], "contract_sha256": contract_sha256(c), "payload_digest": c["task"]["payload_digest"]},
         "revocation_sha256": rev_sha, "acked_by": "contractor"}
    return v12.sign_record(r, KC, "contractor")


def _ack_names_dropped_copy(ch):
    rev = revocation(C_ACK10)
    first, second = ch.put(rev), ch.put(rev)
    return [first, second, ch.put(_ack(v1.rec_sha(second), C_ACK10)), ch.put(ex(C_ACK10))]


synth("synth_ack_names_dropped_copy", "10.1",
      "delivery_ack with ack_window 10. The revocation is anchored twice; the later copy is dropped (6.4). An acknowledgement two blocks later names the "
      "dropped copy's record_sha256. A copy 6.4 dropped no longer names the revocation, so the acknowledgement does not end authority; the window does "
      "(h + 10), and the act one block after the acknowledgement stands: within_grant. WRITTEN BEHAVIOUR, revision 0.2 (A22).",
      C_ACK10, _ack_names_dropped_copy)

# Parent narrowing (4.3, grant_subset), one axis per vector, against a parent that sets every axis.
PARENT_FULL = synth_contract({
    "authorized_actions": ["read"], "prohibited_actions": ["delete", "payment"],
    "conditional": [{"action": "refund", "requires": "principal_approval"}],
    "delegation": {"allowed": ["delegate.synthetic.invalid"]}, "data_access": ["public_endpoint"], "max_hops": 2,
    "privacy": "no_external_retention", "revocation": {"effective_at": "delivery_ack", "ack_window": 5},
    "finality": {"depth": DEPTH, "max_target_bits": "207fffff"},
    "witnesses": [{"name": "synthetic-witness", "public_key_ed25519_b64": PW}],
    "expiry_height": 1000000, "ordering": {"same_height": None}, "approval_policy": {"allow_unscoped": False}},
    label="settle-core-v0 synthetic full parent")
_PREF = {"parent_contract": {"contract_id": PARENT_FULL["contract_id"], "settlement_url": None}}


def _child(name, over=None, drop=(), top=None):
    g = copy.deepcopy(PARENT_FULL["grant"])
    if name != "identical":
        g["max_hops"] = 1                                     # parent minus 1, so that each vector tests one axis
    for k in drop:
        g.pop(k, None)
    g.update(over or {})
    c = synth_contract(sign=False, label="settle-core-v0 synthetic child " + name, top=dict(_PREF, **(top or {})))
    c["grant"] = g
    return _resigned(c)


_AXES = [
    ("identical", {}, (), None, "the parent's grant byte for byte, max_hops 2 included. A child must take at most the parent's max_hops minus 1, "
                                "so an identical grant is not within: parent_narrowing_failed. Every other vector below keeps max_hops 1"),
    ("baseline", {}, (), None, "the parent's grant with max_hops 1: within, within_grant"),
    ("drops_prohibited", {"prohibited_actions": ["delete"]}, (), None, "payment is no longer prohibited: parent_narrowing_failed"),
    ("adds_data_access", {"data_access": ["public_endpoint", "private_records"]}, (), None, "an entry the parent lacks: parent_narrowing_failed"),
    ("without_data_access", {}, ("data_access",), None, "no data_access at all is narrower: within"),
    ("max_hops_equal", {"max_hops": 2}, (), None, "max_hops must be at most the parent's minus 1; 2 under 2 fails"),
    ("without_max_hops", {}, ("max_hops",), None, "the parent limits hops and the child has none: fails"),
    ("adds_delegate", {"delegation": {"allowed": ["delegate.synthetic.invalid", "other.synthetic.invalid"]}}, (), None, "a delegate the parent does not allow: fails"),
    ("drops_conditional_action", {"conditional": []}, (), None, "refund neither conditional nor authorized: the child cannot do it at all, within"),
    ("authorizes_conditional_action", {"conditional": [], "authorized_actions": ["read", "refund"]}, (), None,
     "refund authorized without the parent's condition: fails"),
    ("adds_conditional_action", {"conditional": [{"action": "refund", "requires": "principal_approval"},
                                                 {"action": "export", "requires": "principal_approval"}]}, (), None,
     "a conditional action the parent neither authorizes nor makes conditional: fails"),
    ("expiry_later", {"expiry_height": 1000001}, (), None, "expiry above the parent's: fails"),
    ("expiry_earlier", {"expiry_height": 999999}, (), None, "expiry below the parent's: within"),
    ("without_expiry", {}, ("expiry_height",), None, "the parent expires and the child does not: fails"),
    ("revocation_anchor", {"revocation": {"effective_at": "anchor"}}, (), None, "anchor ends authority sooner than delivery_ack: within"),
    ("revocation_wider_window", {"revocation": {"effective_at": "delivery_ack", "ack_window": 6}}, (), None, "ack_window above the parent's: fails"),
    ("without_revocation", {}, ("revocation",), None, "the parent can be revoked and the child cannot: fails"),
    ("finality_shallower", {"finality": {"depth": DEPTH - 1, "max_target_bits": "207fffff"}}, (), None, "depth below the parent's: fails"),
    ("finality_deeper", {"finality": {"depth": DEPTH + 1, "max_target_bits": "207fffff"}}, (), None, "depth above the parent's: within"),
    ("drops_witness", {"witnesses": []}, (), None, "the parent's witness key is gone: fails"),
    ("witness_renamed", {"witnesses": [{"name": "renamed-witness", "public_key_ed25519_b64": PW}]}, (), None,
     "the same witness key under another name: within (witnesses are compared by key)"),
    ("privacy_changed", {"privacy": "external_retention_allowed"}, (), None, "privacy differs from the parent's: fails"),
    ("without_ordering", {}, ("ordering",), None, "the parent sets ordering and the child has none: fails"),
    ("allow_unscoped", {"approval_policy": {"allow_unscoped": True}}, (), None,
     "unscoped approvals turned on: fails, and 4.2 also refuses unscoped approvals"),
    ("names_other_parent", {}, (), {"parent_contract": {"contract_id": "ab" * 16, "settlement_url": None}},
     "parent_contract.contract_id is not the supplied parent's: fails"),
]
for _name, _over, _drop, _top, _why in _AXES:
    _c = _child(_name, _over, _drop, _top)
    synth("synth_parent_full_" + _name, "4.3",
          "Parent narrowing against a parent that sets every axis of 4.3: " + _why + ". Revision 0.2 (A10).",
          _c, one(_c), parent=PARENT_FULL)


# ----------------------------------------------------------------------------------------------- revision 0.3 (NOTES.md N15)
# The second round of notes from the same implementation (impl/AMBIGUITIES.md B1 to B10, at aeoess 4ca508f). The reference did not change.

synth("synth_infinity_in_signed_body", "2.2,3.1,6.0",
      "The contractor signs an execution whose body holds Infinity. Canonical form writes the token Infinity (3.1 item 6), so the signature verifies; "
      "the body is not strict: record_not_strict. Revision 0.3 (B2).",
      BASE, one(BASE, extra={"score": float("inf")}))

synth("synth_negative_infinity_in_signed_body", "2.2,3.1,6.0",
      "The same with -Infinity: the signature verifies over the token -Infinity, record_not_strict. Revision 0.3 (B2).",
      BASE, one(BASE, extra={"score": float("-inf")}))

for _nm, _v in (("object", {}), ("string", ""), ("zero", 0)):
    _c = synth_contract(sign=False, label="settle-core-v0 synthetic approvers " + _nm)
    _c["grant"]["approval_policy"] = {"allow_unscoped": False, "approvers": _v}
    _c = _resigned(_c)
    synth("synth_approvers_" + _nm, "1,4.1",
          "grant.approval_policy.approvers is %s. Only a well formed approver list (4.1 rule 10) is carried and out of scope; any other value refuses "
          "the contract: contract_not_verified. Revision 0.3 (B7)." % json.dumps(_v),
          _c, one(_c))


def _approvers_contract(label, approvers, top=None):
    c = synth_contract(sign=False, label=label, top=top)
    c["grant"]["conditional"] = [{"action": "refund", "requires": "principal_approval"}]
    c["grant"]["approval_policy"] = {"allow_unscoped": False} if approvers is None else {"allow_unscoped": False, "approvers": approvers}
    return _resigned(c)


PARENT_APPROVERS = _approvers_contract("settle-core-v0 synthetic parent with approvers",
                                       [{"name": "synthetic-approver", "public_key_ed25519_b64": PW, "actions": ["refund"]}])
_C_DROPS = _approvers_contract("settle-core-v0 synthetic child without approvers", None,
                               top={"parent_contract": {"contract_id": PARENT_APPROVERS["contract_id"], "settlement_url": None}})
synth("synth_parent_approvers_child_drops", "4.3.1",
      "The parent pins approvers and the child has none. Rule 14 applies to the parent: a child must keep the parent's approvers exactly, so "
      "parent_narrowing_failed. (A child that keeps them carries approvers itself and is out of scope.) Revision 0.3 (B5).",
      _C_DROPS, one(_C_DROPS), parent=PARENT_APPROVERS)



# ----------------------------------------------------------------------------------------------- revision 0.4 (NOTES.md N17)
# Every underspecified reason of Appendix A was checked against the expected results. Ten were produced by no vector.
# Four of them are reachable and get a vector here; two need inputs the vector layout cannot carry (exercise_inputs.py);
# four can never fire (4.2). The reference did not change.

def _grant_variant(name, mutate):
    c = synth_contract(sign=False, label="settle-core-v0 synthetic r04 " + name)
    mutate(c["grant"])
    return _resigned(c)


def _witnesses(n):
    out = []
    for i in range(n):
        _k, pub = seedkey("synthetic-witness-%02d" % i)
        out.append({"name": "synthetic-witness-%02d" % i, "public_key_ed25519_b64": pub})
    return out


_C_ANAME = _grant_variant("grant action name", lambda g: g.__setitem__("authorized_actions", ["read", "Write"]))
synth("synth_grant_action_name_invalid", "4.2",
      "grant.authorized_actions lists Write (capital W). 4.1 rule 9 only asks for non-empty strings, so the door accepts; 4.2 then finds a name that "
      "does not match ^[a-z][a-z0-9_.:-]{0,63}$: grant_action_name_invalid, no verdict. Revision 0.4 (N17).",
      _C_ANAME, one(_C_ANAME))

_C_W33 = _grant_variant("33 witnesses", lambda g: g.__setitem__("witnesses", _witnesses(33)))
synth("synth_too_many_witnesses", "4.2",
      "grant.witnesses lists 33 witnesses with distinct names and keys. 4.1 sets no count; 4.2 allows at most 32: too_many_witnesses, no verdict. "
      "Revision 0.4 (N17).",
      _C_W33, one(_C_W33))

_C_W32 = _grant_variant("32 witnesses", lambda g: g.__setitem__("witnesses", _witnesses(32)))
synth("synth_witnesses_32", "4.2",
      "The same with 32 witnesses: within the limit, within_grant. With synth_too_many_witnesses it pins the boundary. Revision 0.4 (N17).",
      _C_W32, one(_C_W32))

_C_ACK0 = _grant_variant("delivery ack without window", lambda g: g.__setitem__("revocation", {"effective_at": "delivery_ack"}))
synth("synth_delivery_ack_without_window", "4.2",
      "grant.revocation is {effective_at: delivery_ack} with no ack_window. 4.1 rule 10 allows ack_window to be absent; 4.2 needs it for "
      "delivery_ack: ack_window_missing, no verdict. Revision 0.4 (N17).",
      _C_ACK0, one(_C_ACK0))

_C_FIN0 = _grant_variant("finality without depth", lambda g: g.__setitem__("finality", {"max_target_bits": "207fffff"}))
synth("synth_finality_without_depth", "4.2",
      "grant.finality is {max_target_bits: 207fffff} with no depth. 4.1 rule 10 allows depth to be absent; 4.2 needs an integer depth >= 1: "
      "finality_policy_missing, no verdict. The floor is still read, so the view is accepted. Revision 0.4 (N17).",
      _C_FIN0, one(_C_FIN0))


_FURUI_TEXT = "Answer questions about the synthetic price list; change nothing."
_C_FUR = synth_contract(top={"requirements": {"evidence": "nenrin_required", "recovery": "n/a",
                                              "furui": {"rules_sha256": "a1" * 32, "scope_text": _FURUI_TEXT}}},
                        label="settle-core-v0 synthetic requirements.furui")
# The shape of requirements.furui is section 17's, not core v0's: these two vectors are written into vectors_v1_17/ and
# settled by settle_v1_17.py, so the 128 core vectors stay as they were (revision 0.10).
SHAPE_V117 = []


def shape_v117(vid, description, c, build, pad=DEPTH):
    ch = Chain()
    recs = build(ch)
    ch.pad(pad)
    SHAPE_V117.append({"id": vid, "description": description, "contract": c, "events": recs, "view": ch.view()})


shape_v117("v117_requirements_furui_inert",
           "requirements.furui names a content check (rules_sha256) and the task in the parties' words. Section 17 accepts the shape; with no "
           "admission named, nothing is read: within_grant, as for the baseline. Revision 0.10.",
           _C_FUR, one(_C_FUR))

_C_FURX = synth_contract(sign=False, label="settle-core-v0 synthetic requirements.furui malformed",
                         top={"requirements": {"evidence": "nenrin_required", "recovery": "n/a", "furui": {"rules_sha256": "A1" * 32}}})
_C_FURX = _resigned(_C_FURX)
shape_v117("v117_requirements_furui_malformed",
           "requirements.furui.rules_sha256 is upper case hex. Section 17 refuses the contract: contract_not_verified. Revision 0.10.",
           _C_FURX, one(_C_FURX))


# ----------------------------------------------------------------------------------------------- a2a-settlement-v1.17
# Outside core v0: the content rule reads admissions, and requirements.admission is out of scope (section 1). These
# vectors carry admissions/aNN.json and relying_keys.json besides the core files, and are settled by settle_v1_17.py.
# Admissions of version 0.3 are written only when admission_verify_v0 knows that version (A.VERSION_CONTENT).
OUT_V117 = os.path.join(HERE, "vectors_v1_17")


def v1_17_vectors():
    import settle_v1_17 as s17
    import admission_verify_v0 as A
    know_03 = getattr(A, "VERSION_CONTENT", None) == s17.CONTENT_VERSION
    out = []
    for name, furui, build, want in s17.scenarios():
        if name.startswith("v03_") and not know_03:
            continue
        w = s17.World(furui, label="settle v1.17 " + name)
        events, adms = build(w)
        out.append({"id": "v117_" + name, "contract": w.contract, "events": events, "view": w.view(), "admissions": adms,
                    "relying_keys": w.keys, "want": want})
    return out, know_03


def write_v1_17():
    import settle_v1_17 as s17
    if os.path.isdir(OUT_V117):
        shutil.rmtree(OUT_V117)
    os.makedirs(OUT_V117)
    vs, know_03 = v1_17_vectors()
    vs = [dict(v, admissions=[], relying_keys={}, want=None) for v in SHAPE_V117] + vs
    index = {"schema": "settle-v1.17-vectors", "spec": "SETTLE_CORE_v0.md section 17",
             "reference": "settle_v1_17.settle_v1_17(contract, events, view, admissions=..., relying_keys=...) in musubi-v0 (a2a-settlement-v1.17)",
             "admission_versions": ["0.1", "0.3"] if know_03 else ["0.1"], "vectors": []}
    for v in vs:
        d = os.path.join(OUT_V117, v["id"])
        _emit(os.path.join(d, "contract.json"), v["contract"])
        _emit(os.path.join(d, "view.json"), v["view"])
        _emit(os.path.join(d, "relying_keys.json"), v["relying_keys"])
        for i, e in enumerate(v["events"]):
            _emit(os.path.join(d, "events", "e%02d.json" % i), e)
        for i, a in enumerate(v["admissions"]):
            _emit(os.path.join(d, "admissions", "a%02d.json" % i), a)
        got = core_fields_v1_17(settle_v1_17_dir(d, s17.settle_v1_17, parse_strict))
        assert v["want"] is None or got["deviation_codes"] == v["want"], (v["id"], got["deviation_codes"], v["want"])
        with open(os.path.join(d, "expected.json"), "w", encoding="utf-8", newline="") as f:
            f.write(json.dumps(got, indent=1, sort_keys=True) + "\n")
        files = {}
        for root, _, fs in os.walk(d):
            for f in fs:
                p = os.path.join(root, f)
                files[os.path.relpath(p, d).replace(os.sep, "/")] = sha_file(p)
        index["vectors"].append({"id": v["id"], "expect": {k: got[k] for k in ("verdict", "status", "deviation_codes", "content_gate_counts")},
                                 "files": dict(sorted(files.items()))})
    with open(os.path.join(OUT_V117, "vectors.json"), "w", encoding="utf-8", newline="") as f:
        f.write(json.dumps(index, indent=1, ensure_ascii=False) + "\n")
    print("%d v1.17 vectors written to %s (admission versions %s)" % (len(index["vectors"]), OUT_V117, ", ".join(index["admission_versions"])))


# ----------------------------------------------------------------------------------------------- a2a-settlement-v1.18
# Outside core v0, as v1.17: an action run after the door escalated on the content, with no approval that counts.
# Written only when admission_verify_v0 knows version 0.3 (every v1.18 scenario carries a 0.3 admission).
OUT_V118 = os.path.join(HERE, "vectors_v1_18")


def write_v1_18():
    import settle_v1_18 as s18
    import admission_verify_v0 as A
    if getattr(A, "VERSION_CONTENT", None) != "0.3":
        print("admission_verify_v0 does not know version 0.3: no v1.18 vectors written")
        return
    if os.path.isdir(OUT_V118):
        shutil.rmtree(OUT_V118)
    os.makedirs(OUT_V118)
    index = {"schema": "settle-v1.18-vectors", "spec": "SETTLE_CORE_v0.md section 18",
             "reference": "settle_v1_18.settle_v1_18(contract, events, view, admissions=..., relying_keys=...) in musubi-v0 (a2a-settlement-v1.18)",
             "admission_versions": ["0.3"], "vectors": []}
    for name, furui, cond, build, want, _reads in s18.scenarios():
        w = s18.make_world(furui, "settle v1.18 " + name, conditional=cond)
        events, adms = build(w)
        vid = "v118_" + name
        d = os.path.join(OUT_V118, vid)
        _emit(os.path.join(d, "contract.json"), w.contract)
        _emit(os.path.join(d, "view.json"), w.view())
        _emit(os.path.join(d, "relying_keys.json"), w.keys)
        for i, e in enumerate(events):
            _emit(os.path.join(d, "events", "e%02d.json" % i), e)
        for i, a in enumerate(adms):
            _emit(os.path.join(d, "admissions", "a%02d.json" % i), a)
        got = core_fields_v1_18(settle_v1_17_dir(d, s18.settle_v1_18, parse_strict))
        assert got["deviation_codes"] == want, (vid, got["deviation_codes"], want)
        with open(os.path.join(d, "expected.json"), "w", encoding="utf-8", newline="") as f:
            f.write(json.dumps(got, indent=1, sort_keys=True) + "\n")
        files = {}
        for root, _, fs in os.walk(d):
            for f in fs:
                p = os.path.join(root, f)
                files[os.path.relpath(p, d).replace(os.sep, "/")] = sha_file(p)
        index["vectors"].append({"id": vid, "expect": {k: got[k] for k in ("verdict", "status", "deviation_codes", "content_gate_counts",
                                                                              "content_escalate_gate_counts")},
                                 "files": dict(sorted(files.items()))})
    with open(os.path.join(OUT_V118, "vectors.json"), "w", encoding="utf-8", newline="") as f:
        f.write(json.dumps(index, indent=1, ensure_ascii=False) + "\n")
    print("%d v1.18 vectors written to %s" % (len(index["vectors"]), OUT_V118))


# ----------------------------------------------------------------------------------------------- a2a-settlement-v1.19
# Outside core v0, as v1.17 and v1.18: admissions of version 0.4 read, and an action run after an immune escalate.
# Written only when admission_verify_v0 knows version 0.4.
OUT_V119 = os.path.join(HERE, "vectors_v1_19")


def write_v1_19():
    import settle_v1_19 as s19
    import admission_verify_v0 as A
    if getattr(A, "VERSION_CONTENT_V04", None) != "0.4":
        print("admission_verify_v0 does not know version 0.4: no v1.19 vectors written")
        return
    if os.path.isdir(OUT_V119):
        shutil.rmtree(OUT_V119)
    os.makedirs(OUT_V119)
    index = {"schema": "settle-v1.19-vectors", "spec": "SETTLE_CORE_v0.md section 19",
             "reference": "settle_v1_19.settle_v1_19(contract, events, view, admissions=..., relying_keys=...) in musubi-v0 (a2a-settlement-v1.19)",
             "admission_versions": ["0.1", "0.2", "0.3", "0.4"], "vectors": []}
    for name, furui, cond, build, want, _reads in s19.scenarios():
        w = s19.make_world(furui, "settle v1.19 " + name, conditional=cond)
        events, adms = build(w)
        vid = "v119_" + name
        d = os.path.join(OUT_V119, vid)
        _emit(os.path.join(d, "contract.json"), w.contract)
        _emit(os.path.join(d, "view.json"), w.view())
        _emit(os.path.join(d, "relying_keys.json"), w.keys)
        for i, e in enumerate(events):
            _emit(os.path.join(d, "events", "e%02d.json" % i), e)
        for i, a in enumerate(adms):
            _emit(os.path.join(d, "admissions", "a%02d.json" % i), a)
        got = core_fields_v1_19(settle_v1_17_dir(d, s19.settle_v1_19, parse_strict))
        assert want is None and got["underspecified_reasons"] == ["contract_not_verified"] or got["deviation_codes"] == sorted(want or []), (vid, got["deviation_codes"], want)
        with open(os.path.join(d, "expected.json"), "w", encoding="utf-8", newline="") as f:
            f.write(json.dumps(got, indent=1, sort_keys=True) + "\n")
        files = {}
        for root, _, fs in os.walk(d):
            for f in fs:
                p = os.path.join(root, f)
                files[os.path.relpath(p, d).replace(os.sep, "/")] = sha_file(p)
        index["vectors"].append({"id": vid, "expect": {k: got[k] for k in ("verdict", "status", "deviation_codes", "underspecified_reasons",
                                                                              "content_gate_v04_counts", "escalate_gate_counts", "content_marks")},
                                 "files": dict(sorted(files.items()))})
    with open(os.path.join(OUT_V119, "vectors.json"), "w", encoding="utf-8", newline="") as f:
        f.write(json.dumps(index, indent=1, ensure_ascii=False) + "\n")
    print("%d v1.19 vectors written to %s" % (len(index["vectors"]), OUT_V119))


def main():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    index = {"schema": "settle-core-v0-vectors", "spec": "SETTLE_CORE_v0.md",
             "reference": "settle_v1_16.settle_v1_16(contract, events, view, parent=..., nenrin_records=...) in musubi-v0 (a2a-settlement-v1.16), binding mode strict, one view",
             "core_fields": ["contract_sha256", "verdict", "status", "bond_outcome", "deviation_codes", "underspecified_reasons", "event_set", "dispositions"],
             "synthetic_keys": {"synthetic-principal": PP, "synthetic-contractor": PC, "synthetic-witness": PW, "synthetic-stranger": PS},
             "vectors": []}
    ids = set()
    for v in VECTORS:
        assert v["id"] not in ids, v["id"]
        ids.add(v["id"])
        d = os.path.join(OUT, v["id"])
        _emit(os.path.join(d, "contract.json"), v["contract"])
        _emit(os.path.join(d, "view.json"), v["view"])
        for i, e in enumerate(v["events"]):
            _emit(os.path.join(d, "events", "e%02d.json" % i), e)
        for i, w in enumerate(v["nenrin"]):
            _emit(os.path.join(d, "nenrin", "n%02d.json" % i), w)
        if v["parent"] is not None:
            _emit(os.path.join(d, "parent.json"), v["parent"])
        got = core_fields(settle_dir(d, s16.settle_v1_16, parse_strict))
        with open(os.path.join(d, "expected.json"), "w", encoding="utf-8", newline="") as f:
            f.write(json.dumps(got, indent=1, sort_keys=True) + "\n")
        files = {}
        for root, _, fs in os.walk(d):
            for f in fs:
                p = os.path.join(root, f)
                files[os.path.relpath(p, d).replace(os.sep, "/")] = sha_file(p)
        index["vectors"].append({"id": v["id"], "family": v["family"], "spec_section": v["rule"], "description": v["description"],
                                 "expect": {k: got[k] for k in ("verdict", "status", "deviation_codes", "underspecified_reasons")},
                                 "files": dict(sorted(files.items()))})
    with open(os.path.join(OUT, "vectors.json"), "w", encoding="utf-8", newline="") as f:
        f.write(json.dumps(index, indent=1, ensure_ascii=False) + "\n")
    for x in index["vectors"]:
        e = x["expect"]
        print("%-52s %-14s %-12s %s" % (x["id"], e["verdict"], e["status"], ",".join(e["deviation_codes"] + e["underspecified_reasons"]) or "-"))
    print("\n%d vectors written to %s" % (len(index["vectors"]), OUT))
    write_v1_17()
    write_v1_18()
    write_v1_19()


if __name__ == "__main__":
    if sys.argv[1:] == ["v1_18"]:            # only the v1.18 vectors; the 128 core and the v1.17 vectors are left as they are
        write_v1_18()
    elif sys.argv[1:] == ["v1_19"]:          # only the v1.19 vectors
        write_v1_19()
    else:
        main()
