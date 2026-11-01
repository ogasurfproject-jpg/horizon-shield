#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MUSUBI admission records, the verifying side (a2a-admission-v0): what anyone needs to check a record a relying party
signed, and to recompute what a settlement says about it.

An admission is a relying party's signed answer, given at its own door before an action: admit, escalate or refuse,
with reasons from a closed list. Settlement (settle_v1_11.py, settle_v1_12.py) reads an execution against that
record afterwards. This file is the part of that which a stranger needs:

    verify_admission(record, relying_key_b64, contract)   is this the relying party's record, unaltered, for these terms
    admission_sha256(record)                              the digest an execution record names (admission_ref)
    action_digest(contract_sha256, request)               the digest that binds what was asked to what was executed
    build_action_request / request_shape_ok / request_signed    the applicant's signed request, and its shape
    build_revocation / revocation_signed_by_principal     the principal's a2a-revocation-v0 record

What is not here. The implementation of the door itself, the function that decides, is not public. It is not needed
to check a record: a record carries the relying party's signature, the digests it decided over and the sha256 of the
clause evaluator it used (clause_eval_v0.py, which is public), and settlement recomputes the clauses from the
contract. A relying party is free to build its own door; what makes its records checkable is this file and the schema
in schemas/a2a-admission-v0.schema.json.

Five versions of the record exist. A v0 record has no rules.version. A v0.1 record (2026-10-10) says "0.1"; its
presentation_ref may carry self_declared, its revocations_seen are objects that say whether each revocation carried
an anchor, and the third line of its does_not_establish differs. A v0.2 record (2026-10-20) says "0.2" and carries
one more field, immune: the verdict of the immune rules (immune_v0.py, a2a-immune-v0) over the request, as digests and
codes only, and two more reasons, immune_hold and immune_reject. Its does_not_establish adds one line. A v0.3 record
(2026-10-27) says "0.3", carries immune and one more field, content: what the relying party says its content check
read (a2a-content-check-v0), as digests and flags only, one more reason, content_scope_conflict, and one more line of
does_not_establish. A v0.4 record (DESIGN_TASUKI_v2, after FURUI blind-06, ledger entry 232) says "0.4", carries
immune and a content block in the shape of FURUI A7.4: a salted commitment to the content (input_commit, never the
content's own digest), the digest of the check, the rule set (furui-rules-id-v1), the decision (stop or pass), the marks
(off_topic, rule_conflict), unread, answered and checked, one more reason, content_off_topic, and two lines of
does_not_establish of its own. A door whose policy does not require a content check writes a v0.1 record with no content
block (rule 0). verify_admission accepts each with its own stated limits and refuses one that carries another's.

A record read from bytes is checked with verify_admission_text, which reads it the way admission_verify_v0.mjs does
(read_record: a duplicate key or nesting past READER_MAX_DEPTH is malformed). verify_admission takes a record already
read that way.

  python3 admission_verify_v0.py --selftest
  python3 admission_verify_v0.py --check-fixtures      the fixture files are the ones listed in fixtures/ADMISSION_FIXTURES.sha256
  python3 admission_verify_v0.py --verify RECORD.json --key BASE64 [--contract CONTRACT.json]
"""
import argparse, base64, hashlib, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from contract_v0 import canonical, parse_strict, ed25519_verify, contract_sha256, b64_raw, CANONICAL_RULE
from agreement_verify import text_depth, READER_MAX_DEPTH, TooDeep, _no_duplicate_keys

SCHEMA = "a2a-admission-v0"
VERSION = "0.1"
CONTEXT = b"a2a-admission-v0\n"
REQUEST_CONTEXT = b"a2a-action-request-v0\n"
REVOKE_SCHEMA = "a2a-revocation-v0"
REVOKE_CONTEXT = b"a2a-revocation-v0\n"
PREIMAGE_PROFILE = "a2a-admission-v0/action"
DECISIONS = ("admit", "escalate", "refuse")
REASONS = ("within_grant", "conditional_needs_approval", "prohibited_action", "outside_grant", "amount_over_limit",
           "delegation_exceeds_parent", "contract_expired", "nonce_reused", "grant_revoked", "key_revoked",
           "presentation_unverifiable", "signer_not_on_own_domain", "action_digest_mismatch",
           "content_flagged", "content_unchecked", "exposure_full")
VERSION_IMMUNE = "0.2"
REASONS_V02 = REASONS + ("immune_hold", "immune_reject")
IMMUNE_RULES = "a2a-immune-v0"
IMMUNE_VERDICTS = ("clear", "flagged", "released", "hold", "reject", "not_run")
IMMUNE_REJECT_CODES = ("receptor_closed", "indicator_match", "hold_expired", "terms_malformed", "vetoed")
IMMUNE_HOLD_CODES = ("unmarked_from_content", "unmarked_novel", "inflamed", "exposure_full", "cooling_off")
IMMUNE_FLAG_CODES = ("unmarked_from_content", "unmarked_novel", "indicator_seen")
IMMUNE_KEYS = frozenset(("rules", "evaluator_sha256", "terms_sha256", "verdict", "codes", "evidence_sha256", "second_signal"))
VERSION_CONTENT = "0.3"
REASONS_V03 = REASONS_V02 + ("content_scope_conflict",)
CONTENT_RULES = "a2a-content-check-v0"
CONTENT_VERDICTS = ("instruction", "none")
CONTENT_CONFLICTS = ("none", "forbidden_by_rule", "skips_required_step", "outside_task")
CONTENT_KEYS = frozenset(("rules", "input_sha256", "check_sha256", "rules_sha256", "scope_sha256", "verdict", "scope_conflict", "answered", "checked"))
CONTENT_REASONS = ("content_flagged", "content_scope_conflict", "content_unchecked")
VERSION_CONTENT_V04 = "0.4"
REASONS_V04 = REASONS_V03 + ("content_off_topic",)
CONTENT_RULES_V04 = "a2a-content-check-v1"
CONTENT_DECISIONS_V04 = ("stop", "pass")
CONTENT_MARKS_V04 = ("off_topic", "rule_conflict")
CONTENT_KEYS_V04 = frozenset(("rules", "input_commit", "check_sha256", "rules_sha256", "scope_sha256", "decision", "marks", "unread", "answered", "checked"))
CONTENT_REASONS_V04 = ("content_flagged", "content_scope_conflict", "content_off_topic", "content_unchecked")
CONTENT_VERSIONS = (VERSION_CONTENT, VERSION_CONTENT_V04)
HEX32 = re.compile(r"^[0-9a-f]{32}\Z")
HEX64 = re.compile(r"^[0-9a-f]{64}\Z")
DOES_NOT_ESTABLISH_V0 = [
    "that HS allowed or blocked anything; the relying party ran the function at its own door",
    "that the agent is who it claims to be beyond what the presented signatures and keys on its own domain show",
    "that a revocation published after the chain view was known at admission time",
    "that the action was lawful, safe or wise; only that it was inside or outside the signed grant",
    "that this record is a legal authorization or determines liability"]
DOES_NOT_ESTABLISH = [
    DOES_NOT_ESTABLISH_V0[0],
    DOES_NOT_ESTABLISH_V0[1],
    "when a revocation without an anchor was issued, or that no revocation exists beyond those in revocations_seen; a revocation the "
    "principal signed is obeyed with or without an anchor, and its time is not proven until it is anchored",
    DOES_NOT_ESTABLISH_V0[3],
    DOES_NOT_ESTABLISH_V0[4]]
DOES_NOT_ESTABLISH_V02 = DOES_NOT_ESTABLISH + [
    "that the immune rules stopped every harmful act; a clear verdict says only that no rule in the contract's immune terms fired on the request as "
    "presented, and the values it read are not in this record"]
DOES_NOT_ESTABLISH_V03 = DOES_NOT_ESTABLISH_V02 + [
    "that any content check ran, or that the same check would answer the same way again; the record carries the digests of the bytes the relying "
    "party says it checked and of the verdict it says it read, the identifier of the rule set, and the flags, and nothing else about the content"]
DOES_NOT_ESTABLISH_V04 = DOES_NOT_ESTABLISH_V02 + [
    "that any content check ran, or that the same check would answer the same way again; the record carries a salted commitment to the bytes the "
    "relying party says it checked (only a holder of the bytes and the salt can recompute it), the digest of the check it says it read, the "
    "identifier of the rule set, the decision and the marks, and nothing else about the content",
    "that the rates measured for the named rule set hold on this contract's scope; they were measured on the scopes of public datasets, not on "
    "a scope rendered from a contract"]


def sha256_hex(b):
    return hashlib.sha256(b).hexdigest()


def _is_int(x):
    return isinstance(x, int) and not isinstance(x, bool)


# --------------------------------------------------------------------------- the action request
def action_preimage(contract_sha, req):
    a = req.get("action") if isinstance(req.get("action"), dict) else {}
    return {"contract_sha256": contract_sha, "action": a.get("action"), "target": a.get("target"), "amount": a.get("amount"),
            "nonce": req.get("nonce"), "expiry_height": req.get("expiry_height")}


def action_digest(contract_sha, req):
    return sha256_hex(canonical(action_preimage(contract_sha, req)).encode("utf-8"))


def action_binding(contract_sha, req):
    return {"type": "canonical_request_digest", "canonicalization": CANONICAL_RULE, "preimage_profile": PREIMAGE_PROFILE,
            "digest": {"alg": "sha-256", "value": action_digest(contract_sha, req)}}


def request_signing_bytes(req):
    return REQUEST_CONTEXT + canonical({k: v for k, v in req.items() if k != "signatures"}).encode("utf-8")


def build_action_request(contract, action, nonce, expiry_height, key, role="contractor", target=None, amount=None, approvals=None):
    csha = contract_sha256(contract)
    req = {"contract_ref": {"contract_id": contract["contract_id"], "contract_sha256": csha},
           "action": {"action": action, "target": target, "amount": amount}, "nonce": nonce, "expiry_height": expiry_height,
           "approvals": list(approvals or []), "requester": {"role": role}}
    req["action_binding"] = action_binding(csha, req)
    req["signatures"] = [{"role": role, "sig_b64": base64.b64encode(key.sign(request_signing_bytes(req))).decode("ascii")}]
    return req


def _party_key(contract, role):
    for p in contract.get("parties") or []:
        if isinstance(p, dict) and p.get("role") == role:
            return p.get("public_key_ed25519_b64")
    return None


def request_shape_ok(req):
    a = req.get("action") if isinstance(req, dict) else None
    return (isinstance(req, dict) and isinstance(a, dict) and isinstance(a.get("action"), str)
            and (a.get("target") is None or isinstance(a.get("target"), str))
            and (a.get("amount") is None or (_is_int(a.get("amount")) and a["amount"] >= 0))
            and isinstance(req.get("nonce"), str) and bool(HEX32.match(req["nonce"]))
            and _is_int(req.get("expiry_height")) and req["expiry_height"] >= 0
            and isinstance(req.get("requester"), dict) and req["requester"].get("role") in ("principal", "contractor")
            and isinstance(req.get("contract_ref"), dict))


def request_signed(contract, req):
    key = _party_key(contract, req["requester"]["role"])
    if not key:
        return False
    msg = request_signing_bytes(req)
    return any(isinstance(s, dict) and s.get("role") == req["requester"]["role"] and ed25519_verify(key, s.get("sig_b64"), msg) is True
               for s in (req.get("signatures") or []))


# --------------------------------------------------------------------------- the principal's revocation record
def revocation_signing_bytes(rec):
    return REVOKE_CONTEXT + canonical({k: v for k, v in rec.items() if k not in ("signatures", "anchor")}).encode("utf-8")


def build_revocation(contract, key, revoked_key_b64=None):
    """A principal's revocation. Without revoked_key it ends the grant: this is the a2a-revocation-v0 record settle v1
    already reads, bound to the terms by contract_sha256. With revoked_key it names one key that must no longer be
    admitted under this contract; that form is read by a relying party's door and is not a settle event."""
    rec = {"schema": REVOKE_SCHEMA, "contract_ref": {"contract_id": contract["contract_id"],
           "payload_digest": (contract.get("task") or {}).get("payload_digest"), "contract_sha256": contract_sha256(contract)},
           "revoked_by": "principal"}
    if revoked_key_b64 is not None:
        rec["revoked_key"] = {"public_key_ed25519_b64": revoked_key_b64}
    rec["signatures"] = [{"role": "principal", "sig_b64": base64.b64encode(key.sign(revocation_signing_bytes(rec))).decode("ascii")}]
    return rec


def revocation_signed_by_principal(contract, rec):
    """True when rec is an a2a-revocation-v0 the contract's principal signed for these terms. An anchor, if any, is not
    part of the signed bytes and is not looked at here."""
    try:
        if not (isinstance(rec, dict) and rec.get("schema") == REVOKE_SCHEMA and rec.get("revoked_by") == "principal"):
            return False
        ref = rec.get("contract_ref") if isinstance(rec.get("contract_ref"), dict) else {}
        pk = _party_key(contract, "principal")
        if ref.get("contract_sha256") != contract_sha256(contract) or not pk:
            return False
        msg = revocation_signing_bytes(rec)
        return any(isinstance(s, dict) and s.get("role") == "principal" and ed25519_verify(pk, s.get("sig_b64"), msg) is True
                   for s in (rec.get("signatures") if isinstance(rec.get("signatures"), list) else []))
    except Exception:
        return False


# --------------------------------------------------------------------------- the record
def admission_signing_bytes(record):
    return CONTEXT + canonical({k: v for k, v in record.items() if k != "signatures"}).encode("utf-8")


def admission_sha256(record):
    """sha256 of the bytes the relying party signs. Stable when the signature lands; this is what an execution record names."""
    return sha256_hex(admission_signing_bytes(record))


def _host(url):
    # [0-9], not \d: \d follows the Unicode version of the Python (and \p{Nd} that of the JavaScript), so a port of
    # Garay, Tangsa or Kawi digits was a port on one runtime and not on another
    m = re.match(r"^https://([A-Za-z0-9.-]+)(?::[0-9]+)?/", url) if isinstance(url, str) else None
    return m.group(1).lower() if m else None


RECORD_KEYS = frozenset(("schema", "admission_id", "relying_party", "contract_ref", "action_ref", "presentation_ref", "chain_view",
                         "revocations_seen", "decision", "reasons", "clause", "rules", "establishes", "does_not_establish", "signatures"))


def immune_problems(record):
    """[] when a v0.2 record's immune block is well formed and agrees with its decision and reasons."""
    im, reasons, d = record.get("immune"), record.get("reasons"), record.get("decision")
    if not isinstance(im, dict) or set(im) != IMMUNE_KEYS or im.get("rules") != IMMUNE_RULES or not isinstance(reasons, list):
        return ["malformed"]
    v, codes, ts = im.get("verdict"), im.get("codes"), im.get("terms_sha256")
    ok = (v in IMMUNE_VERDICTS and isinstance(codes, list) and all(isinstance(c, str) for c in codes) and codes == sorted(set(codes))
          and set(codes) <= set(IMMUNE_REJECT_CODES + IMMUNE_HOLD_CODES + IMMUNE_FLAG_CODES)
          and isinstance(im.get("evaluator_sha256"), str) and bool(HEX64.match(im["evaluator_sha256"]))
          and isinstance(im.get("evidence_sha256"), str) and bool(HEX64.match(im["evidence_sha256"]))
          and ((v == "not_run") == (ts is None)) and (ts is None or (isinstance(ts, str) and bool(HEX64.match(ts))))
          and im.get("second_signal") in (None, "witnesses") and ((v == "released") == (im.get("second_signal") == "witnesses")))
    if not ok:
        return ["malformed"]
    hold_r, rej_r = "immune_hold" in reasons, "immune_reject" in reasons
    if v == "reject":
        ok = d == "refuse" and rej_r and not hold_r and bool(set(codes) & set(IMMUNE_REJECT_CODES))
    elif v == "hold":
        ok = (d in ("escalate", "refuse") and hold_r and not rej_r and bool(set(codes) & set(IMMUNE_HOLD_CODES))
              and set(codes) <= set(IMMUNE_HOLD_CODES + IMMUNE_FLAG_CODES))
    elif v == "released":
        ok = not hold_r and not rej_r and bool(codes) and set(codes) <= set(IMMUNE_HOLD_CODES + IMMUNE_FLAG_CODES)
    elif v == "flagged":
        ok = not hold_r and not rej_r and bool(codes) and set(codes) <= set(IMMUNE_FLAG_CODES)
    else:
        ok = not hold_r and not rej_r and codes == []
    return [] if ok else ["immune_inconsistent"]


def content_problems(record):
    """[] when a v0.3 record's content block is well formed and agrees with its decision and reasons. The block is the
    relying party's account of its content check: digests and flags, never the content. Every rule here reads fields only."""
    c, reasons, d = record.get("content"), record.get("reasons"), record.get("decision")
    if not isinstance(c, dict) or set(c) != CONTENT_KEYS or c.get("rules") != CONTENT_RULES or not isinstance(reasons, list):
        return ["malformed"]
    hexnull = lambda k: c.get(k) is None or (isinstance(c[k], str) and bool(HEX64.match(c[k])))
    v, sc, ans, chk = c.get("verdict"), c.get("scope_conflict"), c.get("answered"), c.get("checked")
    if not (all(hexnull(k) for k in ("input_sha256", "check_sha256", "rules_sha256", "scope_sha256")) and v in CONTENT_VERDICTS + (None,)
            and sc in CONTENT_CONFLICTS + (None,) and isinstance(ans, bool) and isinstance(chk, bool)):
        return ["malformed"]
    r = set(reasons)
    ok = ((chk or (v is None and sc is None and "content_unchecked" in r))                                       # 1 unchecked: no flags
          and (not chk or all(c.get(k) is not None for k in ("input_sha256", "check_sha256", "rules_sha256")))  # 2 checked: three digests
          and (ans or (v is None and sc is None and "content_unchecked" in r))                                   # 3 no answer: no flags
          and ((v == "instruction") == ("content_flagged" in r))                                                 # 4 the verdict flag
          and ((sc not in (None, "none")) == ("content_scope_conflict" in r))                                    # 5 the scope flag
          and (c.get("scope_sha256") is not None or sc is None)                                                  # 6 no scope, no conflict
          and (d != "admit" or not (r & set(CONTENT_REASONS))))                                                  # 7 an admit carries none
    return [] if ok else ["malformed"]


def content_problems_v04(record):
    """[] when a v0.4 record's content block is well formed and agrees with its decision and reasons (rules 1 to 9 of
    DESIGN_TASUKI_v2 2.1.4). The block carries input_commit = sha256(r || canonical(content)), r a 32 byte salt the door
    returns to the requester alone, never the content's own digest. Every rule here reads fields only. Rule 0 (no content
    block when the door's policy does not require a check) is the door's: such a record is version 0.1 and has no content."""
    c, reasons, d = record.get("content"), record.get("reasons"), record.get("decision")
    if not isinstance(c, dict) or set(c) != CONTENT_KEYS_V04 or c.get("rules") != CONTENT_RULES_V04 or not isinstance(reasons, list):
        return ["malformed"]
    hexnull = lambda k: c.get(k) is None or (isinstance(c[k], str) and bool(HEX64.match(c[k])))
    dec, mk, un, ans, chk = c.get("decision"), c.get("marks"), c.get("unread"), c.get("answered"), c.get("checked")
    if not (all(hexnull(k) for k in ("input_commit", "check_sha256", "rules_sha256", "scope_sha256")) and dec in CONTENT_DECISIONS_V04 + (None,)
            and isinstance(mk, list) and all(isinstance(m, str) for m in mk) and mk == [m for m in CONTENT_MARKS_V04 if m in mk]
            and isinstance(un, bool) and isinstance(ans, bool) and isinstance(chk, bool)):
        return ["malformed"]
    r = set(reasons)
    nothing = dec is None and mk == [] and un is False
    ok = ((chk or (nothing and ans is False and "content_unchecked" in r))                                       # 1 unchecked: nothing read
          and (not chk or all(c.get(k) is not None for k in ("input_commit", "check_sha256", "rules_sha256")))  # 2 checked: three digests
          and (ans or (nothing and "content_unchecked" in r))                                                    # 3 no answer: no decision
          and (ans is False or dec is not None)                                                                  # 3 an answer has a decision
          and ((dec == "stop") == ("content_flagged" in r))                                                      # 4 the stop
          and (("rule_conflict" in mk) == ("content_scope_conflict" in r))                                       # 5 rule_conflict
          and (("off_topic" in mk) == ("content_off_topic" in r))                                                # 6 off_topic
          and ((un or not ans or not chk) == ("content_unchecked" in r))                                         # 7 unread or no answer
          and (dec != "stop" or (mk == [] and un is False))                                                      # 8 a stop has no marks and is read
          and (not un or dec == "pass")                                                                          # 8 unread is a pass
          and (not mk or c.get("scope_sha256") is not None)                                                      # a mark needs the scope
          and (d != "admit" or not (r & {"content_flagged", "content_scope_conflict", "content_unchecked"})))    # 9 an admit carries only off_topic
    return [] if ok else ["malformed"]


MAX_SAFE = 2 ** 53 - 1


def numbers_ok(x):
    """Every number in the record is an integer a JSON reader in any language reads the same: no floats, nothing past
    2^53 - 1. A record that breaks this signs bytes one runtime reads differently from another."""
    stack = [x]
    while stack:
        v = stack.pop()
        if isinstance(v, bool) or v is None or isinstance(v, str):
            continue
        if isinstance(v, int):
            if abs(v) > MAX_SAFE:
                return False
        elif isinstance(v, float):
            return False
        elif isinstance(v, dict):
            stack.extend(v.values())
        elif isinstance(v, list):
            stack.extend(v)
    return True


def proto_key(x):
    """True when any object in x has the key "__proto__". A JavaScript reader does not keep it as a key (the strict
    reader of agreement_canonical.mjs makes it the object's prototype or drops it), so the bytes a JavaScript verifier
    signs over are not the bytes this one reads. Such a record has no canonical form both runtimes write."""
    stack = [x]
    while stack:
        v = stack.pop()
        if isinstance(v, dict):
            if "__proto__" in v:
                return True
            stack.extend(v.values())
        elif isinstance(v, list):
            stack.extend(v)
    return False


_KEY_OK = re.compile(r"[\x20-\x7e]*\Z")
_SURROGATE = re.compile("[\ud800-\udfff]")


def text_problem(x):
    """True when an object key is not printable ASCII (0x20 to 0x7E, canonical_v0.mjs rule 2, which throws there and
    which Python's canonical() does not check), or a key or string carries a lone surrogate (rule 7: Python and
    canonical_v0.mjs write it as \\udxxx, agreement_canonical.mjs, which the intake uses, writes it raw). Either way the
    record has no canonical form all three readers write, so it has no signed bytes to check. A pair written as two
    escapes is one character after json.loads, and well formed in JavaScript, and is not a problem."""
    stack = [x]
    while stack:
        v = stack.pop()
        if isinstance(v, str):
            if _SURROGATE.search(v):
                return True
        elif isinstance(v, dict):
            for k in v:
                if not isinstance(k, str) or not _KEY_OK.match(k):
                    return True
            stack.extend(v.values())
        elif isinstance(v, list):
            stack.extend(v)
    return False


_INT_DIGITS = 40


def _int_literal(s):
    """int(s) as json.loads does it, except for a literal of more than 40 digits. Python 3.11 and later refuse to
    convert one of more than 4300 digits (ValueError) and 3.9 reads it, so the same bytes were unreadable on one
    Python and a number on another. Any literal past 40 digits is outside every range this file accepts, so it is
    read as a stand in of the same sign that is outside them too, and the record is refused the same way on every
    Python and in JavaScript (malformed, and no signed bytes to check)."""
    if len(s) - s.startswith("-") > _INT_DIGITS:
        return -(2 ** 64) if s.startswith("-") else 2 ** 64
    return int(s)


def read_record(text):
    """parse_strict (agreement_verify), with its refusals: a duplicate key raises ValueError, nesting past
    READER_MAX_DEPTH raises TooDeep. The one difference is _int_literal. admission_verify_v0.mjs reads with
    parseStrict of agreement_canonical.mjs, which refuses the same inputs."""
    if text_depth(text) > READER_MAX_DEPTH:
        raise TooDeep("the JSON is nested past what a reader can parse")
    return json.loads(text, object_pairs_hook=_no_duplicate_keys, parse_int=_int_literal)


def immune_binding_problems(record, contract):
    """With the contract: when it carries immune terms (requirements.immune), the record must be v0.2, name those terms,
    and may say not_run only on a refusal (a request the door could not read). A record that leaves the rules out is
    otherwise indistinguishable from one where they found nothing."""
    terms = ((contract.get("requirements") or {}).get("immune")) if isinstance(contract.get("requirements"), dict) else None
    if not isinstance(terms, dict):
        return []
    rules = record.get("rules") if isinstance(record.get("rules"), dict) else {}
    if rules.get("version") not in (VERSION_IMMUNE,) + CONTENT_VERSIONS or not isinstance(record.get("immune"), dict):
        return ["immune_missing"]
    im = record["immune"]
    if im.get("verdict") == "not_run":
        return [] if record.get("decision") == "refuse" else ["immune_not_run"]
    if im.get("terms_sha256") != sha256_hex(canonical(terms).encode("utf-8")):
        return ["immune_terms_not_this_contracts"]
    return []


def verify_admission(record, relying_key_b64, contract=None):
    """{"verdict": "accepted" | "refused", "refusals": [codes]}. relying_key_b64 is the key the caller fetched from
    record.relying_party.key_url. With the contract, an admission signed by a party's own request key is refused: an
    applicant cannot admit itself (the same fail closed rule as a self witness); and when the contract carries immune
    terms, the record must carry their verdict over those terms (immune_binding_problems)."""
    ref = []
    if not isinstance(record, dict) or record.get("schema") != SCHEMA:
        return {"verdict": "refused", "refusals": ["malformed"]}
    # A float, an integer past 2^53 - 1 or a "__proto__" key has no musubi-canonical-v0 form both runtimes write
    # (canonical_v0.mjs rule 5), so there are no signed bytes to check: malformed and bad_signature, in both twins.
    signable = numbers_ok(record) and not proto_key(record) and not text_problem(record)
    if not signable:
        ref.append("malformed")
    cv = record.get("chain_view") if isinstance(record.get("chain_view"), dict) else {}
    hgt = cv.get("height")
    if not (isinstance(hgt, int) and not isinstance(hgt, bool) and 0 <= hgt <= MAX_SAFE):
        ref.append("malformed")
    if not isinstance(record.get("rules"), dict):
        ref.append("malformed")
    rules = record.get("rules") if isinstance(record.get("rules"), dict) else {}
    ver = rules.get("version")
    if "version" in rules and ver is None:
        ref.append("malformed")             # an explicit null is not v0 (the intake reads it the same way)
    keys = RECORD_KEYS | {"immune", "content"} if ver in CONTENT_VERSIONS else RECORD_KEYS | {"immune"} if ver == VERSION_IMMUNE else RECORD_KEYS
    if set(record) - keys - {"publication"} or not keys <= set(record) or record.get("publication", "public") != "public":
        ref.append("malformed")
    if not isinstance(record.get("contract_ref"), dict):
        ref.append("malformed")
    rp = record.get("relying_party") if isinstance(record.get("relying_party"), dict) else {}
    dom = rp.get("domain") if isinstance(rp.get("domain"), str) else None
    allowed = REASONS_V04 if ver == VERSION_CONTENT_V04 else REASONS_V03 if ver == VERSION_CONTENT else REASONS_V02 if ver == VERSION_IMMUNE else REASONS
    if record.get("decision") not in DECISIONS or not isinstance(record.get("reasons"), list) or not record.get("reasons") \
            or any(r not in allowed for r in record.get("reasons") or []):
        ref.append("malformed")
    if ver not in (None, VERSION, VERSION_IMMUNE, VERSION_CONTENT, VERSION_CONTENT_V04):
        ref.append("malformed")
    if ver in (VERSION_IMMUNE,) + CONTENT_VERSIONS and "immune" in record:
        ref.extend(immune_problems(record))
    if ver == VERSION_CONTENT and "content" in record:
        ref.extend(content_problems(record))
    if ver == VERSION_CONTENT_V04 and "content" in record:
        ref.extend(content_problems_v04(record))
    # each version carries its own stated limits, and none may carry another's
    stated = (DOES_NOT_ESTABLISH_V04 if ver == VERSION_CONTENT_V04 else DOES_NOT_ESTABLISH_V03 if ver == VERSION_CONTENT else DOES_NOT_ESTABLISH_V02 if ver == VERSION_IMMUNE
              else DOES_NOT_ESTABLISH if ver == VERSION else DOES_NOT_ESTABLISH_V0)
    dne = record.get("does_not_establish")
    if not isinstance(dne, list):
        ref.append("malformed")
    if not isinstance(dne, list) or dne != stated:
        ref.append("does_not_establish_altered")
    if not dom or _host(rp.get("key_url")) != dom.lower():
        ref.append("signer_not_on_own_domain")
    if not isinstance(record.get("signatures"), list):
        ref.append("malformed")
    sigs = [s for s in (record["signatures"] if isinstance(record.get("signatures"), list) else []) if isinstance(s, dict)]
    try:
        msg = admission_signing_bytes(record) if signable else None
    except (TypeError, ValueError):
        msg = None
        ref.append("malformed")
    if b64_raw(relying_key_b64, 32) is None or msg is None or not any(
            s.get("domain") == dom and s.get("alg") == "ed25519" and ed25519_verify(relying_key_b64, s.get("sig"), msg) is True
            for s in sigs):
        ref.append("bad_signature")
    if isinstance(contract, dict):
        cref = record.get("contract_ref") if isinstance(record.get("contract_ref"), dict) else {}
        if cref.get("contract_sha256") != contract_sha256(contract):
            ref.append("other_contract")
        if relying_key_b64 == _party_key(contract, "contractor"):
            ref.append("self_admission")
        ref.extend(immune_binding_problems(record, contract))
    ref = sorted(set(ref))
    return {"verdict": "refused" if ref else "accepted", "refusals": ref}


def verify_admission_text(text, relying_key_b64, contract=None):
    """verify_admission over the record's bytes (a str), read with read_record. Text that cannot be read (not JSON, a
    duplicate key, nested too deep) is malformed. admission_verify_v0.mjs verifyAdmissionText is the twin."""
    if not isinstance(text, str) or _SURROGATE.search(text):
        # a surrogate in the text itself (not an escape): the text has no UTF-8 form, so it is not bytes anyone sent
        return {"verdict": "refused", "refusals": ["malformed"]}
    try:
        record = read_record(text)
    except (ValueError, RecursionError):
        return {"verdict": "refused", "refusals": ["malformed"]}
    return verify_admission(record, relying_key_b64, contract)


party_key = _party_key


# --------------------------------------------------------------------------- the fixtures
FIXTURE_LIST = os.path.join(HERE, "fixtures", "ADMISSION_FIXTURES.sha256")


def check_fixtures(out=None):
    """The fixture records were written by a door this repository does not carry. Their sha256 is listed here, and this
    compares. Returns the number of files that differ or are missing."""
    bad = 0
    for line in open(FIXTURE_LIST, encoding="utf-8").read().splitlines():
        if not line.strip():
            continue
        want, rel = line.split("  ", 1)
        p = os.path.join(HERE, "fixtures", rel)
        got = hashlib.sha256(open(p, "rb").read()).hexdigest() if os.path.exists(p) else None
        bad += got != want
        if out is not None:
            print("%s %s  %s" % ("ok  " if got == want else "NG  ", want[:16], rel), file=out)
    return bad


# --------------------------------------------------------------------------- self test
def _selftest():
    import subprocess
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    n = 0
    assert check_fixtures() == 0
    C = json.load(open(os.path.join(HERE, "fixtures", "admission_intake", "cases.json"), encoding="utf-8"))
    rd = parse_strict
    P, N = rd(C["contract_canonical"]), rd(C["other_contract_canonical"])
    rk, ck, sk = C["relying_pub_b64"], C["contractor_pub_b64"], C["stranger_pub_b64"]
    ok = {"verdict": "accepted", "refusals": []}

    # [1] records a relying party signed: both versions verify, each with its own stated limits
    names = ("admission_public", "admission_private", "admission_refuse", "admission_revoked_without_anchor", "admission_brought_result", "admission_public_v0")
    for k in names:
        assert verify_admission(rd(C[k]), rk, P) == ok, (k, verify_admission(rd(C[k]), rk, P))
    pub, old = rd(C["admission_public"]), rd(C["admission_public_v0"])
    assert pub["rules"]["version"] == VERSION and "version" not in old["rules"]
    assert pub["does_not_establish"] == DOES_NOT_ESTABLISH and old["does_not_establish"] == DOES_NOT_ESTABLISH_V0
    assert admission_sha256(pub) == C["admission_public_sha256"] and admission_sha256(old) == C["admission_public_v0_admission_sha256"]
    assert admission_sha256(pub) == sha256_hex(CONTEXT + canonical({k: v for k, v in pub.items() if k != "signatures"}).encode())
    n += 1; print("[1] %d records from the fixture verify under the relying party's key, one of them written by v0; admission_sha256 is the sha256 of the signed bytes" % len(names))

    # [2] what does not verify
    edit = lambda rec, **kw: dict(json.loads(json.dumps(rec)), **kw)
    assert verify_admission(edit(pub, decision="refuse"), rk, P)["refusals"] == ["bad_signature"]
    assert verify_admission(pub, sk, P)["refusals"] == ["bad_signature"]
    assert verify_admission(pub, "not a key", P)["refusals"] == ["bad_signature"]
    self_made = rd(C["admission_signed_by_contractor"])
    assert verify_admission(self_made, rk, P)["refusals"] == ["bad_signature"] and "self_admission" in verify_admission(self_made, ck, P)["refusals"]
    assert verify_admission(pub, rk, N)["refusals"] == ["other_contract"]
    assert "does_not_establish_altered" in verify_admission(edit(pub, does_not_establish=pub["does_not_establish"][:4]), rk, P)["refusals"]
    assert "does_not_establish_altered" in verify_admission(edit(pub, does_not_establish=list(DOES_NOT_ESTABLISH_V0)), rk, P)["refusals"]
    assert "does_not_establish_altered" in verify_admission(edit(old, rules=dict(old["rules"], version=VERSION)), rk, P)["refusals"]
    assert "malformed" in verify_admission(edit(pub, rules=dict(pub["rules"], version="9")), rk, P)["refusals"]
    assert "malformed" in verify_admission(edit(pub, score=97), rk, P)["refusals"] and "malformed" in verify_admission(edit(pub, reasons=["looks_fine"]), rk, P)["refusals"]
    assert "malformed" in verify_admission(edit(pub, publication="private"), rk, P)["refusals"]
    assert "signer_not_on_own_domain" in verify_admission(edit(pub, relying_party={"domain": "shop.example", "key_url": "https://evil.example/k.json"}), rk, P)["refusals"]
    assert verify_admission(None, rk)["refusals"] == ["malformed"] and verify_admission({"schema": "x"}, rk)["refusals"] == ["malformed"]
    n += 1; print("[2] an edited decision, another key, the applicant's own key (self_admission), other terms, another version's stated limits, an unknown version, an extra field, a key off the domain: refused, each with its code")

    # [3] the action request and the digest that binds it
    req = rd(C["action_request_public"])
    assert request_shape_ok(req) and request_signed(P, req) and not request_signed(N, dict(req, signatures=[]))
    assert action_digest(contract_sha256(P), req) == pub["action_ref"]["action_binding_digest"] == req["action_binding"]["digest"]["value"]
    moved = json.loads(json.dumps(req)); moved["action"]["target"] = "/other"
    assert action_digest(contract_sha256(P), moved) != action_digest(contract_sha256(P), req) and not request_signed(P, moved)
    assert action_binding(contract_sha256(P), req) == req["action_binding"]
    for bad in (None, {}, dict(req, nonce="xyz"), dict(req, expiry_height=-1), dict(req, action={"action": "read", "amount": -1}), dict(req, requester={"role": "witness"})):
        assert not request_shape_ok(bad), bad
    k = Ed25519PrivateKey.generate()
    kp = base64.b64encode(k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
    mine = {"contract_id": "c" * 32, "parties": [{"role": "principal", "public_key_ed25519_b64": kp}, {"role": "contractor", "public_key_ed25519_b64": kp}], "task": {}}
    r2 = build_action_request(mine, "pay", "ab" * 16, 500, k, target="/invoices", amount=80000)
    assert request_shape_ok(r2) and request_signed(mine, r2) and r2["action_binding"]["digest"]["value"] == action_digest(contract_sha256(mine), r2)
    assert not request_signed(mine, dict(r2, nonce="cd" * 16))
    n += 1; print("[3] the applicant's request: shape, signature under the key the contract names, and the action digest the admission and the execution both carry; an edit breaks both")

    # [4] the principal's revocation record
    assert revocation_signed_by_principal(P, rd(C["revocation_grant"])) and revocation_signed_by_principal(P, rd(C["revocation_key"]))
    assert not revocation_signed_by_principal(P, rd(C["revocation_by_contractor"])) and not revocation_signed_by_principal(N, rd(C["revocation_grant"]))
    anchored = dict(rd(C["revocation_grant"]), anchor={"height": 5})
    assert revocation_signed_by_principal(P, anchored)
    rv = build_revocation(mine, k)
    assert revocation_signed_by_principal(mine, rv) and canonical(rv) == canonical(build_revocation(mine, k))
    assert not revocation_signed_by_principal(mine, dict(rv, revoked_key={"public_key_ed25519_b64": kp})) and not revocation_signed_by_principal(mine, None)
    n += 1; print("[4] a2a-revocation-v0: the principal's signature for these terms verifies, with or without an anchor beside it; the contractor's, or one for other terms, does not")

    # [5] the second runtime
    twin = os.path.join(HERE, "admission_verify_v0.mjs")
    r = subprocess.run(["node", twin, "--check", os.path.join(HERE, "fixtures", "admission_intake", "cases.json")], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[-600:]
    J = json.loads(r.stdout)
    mine_py = {}
    for k_ in names + ("admission_signed_by_contractor",):
        rec = rd(C[k_])
        mine_py[k_] = {"sha": admission_sha256(rec), "relying": verify_admission(rec, rk, P), "contractor": verify_admission(rec, ck, P), "other": verify_admission(rec, rk, N),
                       "edited": verify_admission(dict(rec, decision="escalate"), rk, P)}
    assert J["records"] == mine_py, [k_ for k_ in mine_py if J["records"].get(k_) != mine_py[k_]]
    assert J["request"] == {"shape": True, "signed": True, "digest": action_digest(contract_sha256(P), req), "binding": action_binding(contract_sha256(P), req)}
    assert J["revocations"] == {"grant": True, "key": True, "by_contractor": False, "other_terms": False}
    n += 1; print("[5] admission_verify_v0.mjs gives the same verdicts, refusal codes and digests for the same records (%d records, 4 readings each)" % len(mine_py))

    # [6] v0.2: the immune block, in both runtimes
    IC = json.load(open(os.path.join(HERE, "fixtures", "admission_immune", "cases.json"), encoding="utf-8"))
    IP, ik = rd(IC["contract_canonical"]), IC["relying_pub_b64"]
    good = tuple(k_ for k_ in IC["records"] if k_[0].isupper())
    for k_ in good:
        assert verify_admission(rd(IC["records"][k_]), ik, IP) == ok, (k_, verify_admission(rd(IC["records"][k_]), ik, IP))
    want = {"v02_without_immune": "malformed", "v01_with_immune": "malformed", "v02_v01_limits": "does_not_establish_altered",
            "reject_admitted": "immune_inconsistent", "hold_without_reason": "immune_inconsistent", "released_without_signal": "malformed",
            "clear_with_codes": "immune_inconsistent", "unknown_code": "malformed", "immune_reason_in_v01": "malformed", "extra_immune_field": "malformed",
            "reasons_a_string": "malformed", "version_null": "malformed", "terms_of_another_contract": "immune_terms_not_this_contracts",
            "v01_under_immune_terms": "immune_missing", "not_run_admitted": "immune_not_run", "indicator_seen_on_hold_only": "immune_inconsistent"}
    for k_, code in want.items():
        got = verify_admission(rd(IC["records"][k_]), ik, IP)["refusals"]
        assert code in got and "bad_signature" in got, (k_, got)
    assert verify_admission(rd(C["admission_public"]), rk, P) == ok          # a v0.1 record reads as before
    first = rd(IC["records"][good[0]])
    for h in (float(first["chain_view"]["height"]), 2 ** 53, -1, True, None):
        assert "malformed" in verify_admission(dict(first, chain_view=dict(first["chain_view"], height=h)), ik, IP)["refusals"], h
    assert "malformed" in verify_admission(dict(first, presentation_ref=[dict(first["presentation_ref"][0], extra=0.5)]), ik, IP)["refusals"]
    r = subprocess.run(["node", twin, "--check-immune", os.path.join(HERE, "fixtures", "admission_immune", "cases.json")], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[-600:]
    JI = json.loads(r.stdout)
    py = {k_: {"sha": admission_sha256(rd(t)), "relying": verify_admission(rd(t), ik, IP)} for k_, t in IC["records"].items()}
    assert JI == py, [k_ for k_ in py if JI.get(k_) != py[k_]]
    # Records read from their bytes, each signed by a key of this test for exactly the bytes Python writes, so a
    # refusal is the defect's and not a stale signature's. Both runtimes must give the same verdict and refusal set.
    k6 = Ed25519PrivateKey.generate()
    k6p = base64.b64encode(k6.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()

    def signed(rec):
        rec = {kk: vv for kk, vv in rec.items() if kk != "signatures"}
        sig = base64.b64encode(k6.sign(admission_signing_bytes(rec))).decode("ascii")
        return dict(rec, signatures=[{"alg": "ed25519", "domain": rec["relying_party"]["domain"], "sig": sig}])

    def retext(text, old, new):
        assert text.count(old) == 1, old
        return text.replace(old, new)

    base = rd(IC["records"][good[0]])
    h0 = base["chain_view"]["height"]
    hs = '"height":%d' % h0
    cv, pr0, im0 = base["chain_view"], base["presentation_ref"][0], base["immune"]
    T = canonical
    st = T(signed(base))
    S = lambda **kw: T(signed(dict(base, **kw)))
    hold = lambda codes, **kw: S(decision="escalate", reasons=["immune_hold"], immune=dict(im0, verdict="hold", codes=codes), **kw)
    MS, BS = ["bad_signature", "malformed"], ["malformed"]
    texts = {
        "resigned": (st, []),
        # (a) what JSON.parse read differently: a float written as an integer value, a duplicate key
        "height_970204.0": (S(chain_view=dict(cv, height=float(h0))), MS),
        "height_mantissa_exponent": (retext(st, hs, '"height":%s.%se%d' % (str(h0)[0], str(h0)[1:], len(str(h0)) - 1)), MS),
        "height_e0": (retext(st, hs, '"height":%de0' % h0), MS),
        "duplicate_key_last_wins": (retext(st, '"decision":"refuse"', '"decision":"admit","decision":"refuse"'), BS),
        "duplicate_key_nested": (retext(st, hs, '"height":1,' + hs), BS),
        # (b) a field of the wrong type is a refusal, never an exception
        "rules_a_string": (S(rules="0.2"), ["does_not_establish_altered", "immune_missing", "malformed"]),
        "rules_an_array": (S(rules=[base["rules"]]), ["does_not_establish_altered", "immune_missing", "malformed"]),
        "contract_ref_a_string": (S(contract_ref=base["contract_ref"]["contract_sha256"]), ["malformed", "other_contract"]),
        "does_not_establish_5": (S(does_not_establish=5), ["does_not_establish_altered", "malformed"]),
        "does_not_establish_true": (S(does_not_establish=True), ["does_not_establish_altered", "malformed"]),
        "does_not_establish_null": (S(does_not_establish=None), ["does_not_establish_altered", "malformed"]),
        "signatures_5": (T(dict(signed(base), signatures=5)), MS),
        # (c) a number past 2^53 - 1, NaN or a "__proto__" key: no canonical form both write, so no signed bytes
        "integer_2^53": (S(presentation_ref=[dict(pr0, n=2 ** 53)]), MS),
        "integer_minus_2^53": (S(presentation_ref=[dict(pr0, n=-2 ** 53)]), MS),
        "height_2^60": (S(chain_view=dict(cv, height=2 ** 60)), MS),
        "height_5000_digits": (retext(st, hs, '"height":' + "9" * 5000), MS),
        "height_nan": (retext(st, hs, '"height":NaN'), MS),
        "float_elsewhere": (S(presentation_ref=[dict(pr0, extra=0.5)]), MS),
        "proto_key_top": (S(__proto__={}), MS),
        "proto_key_nested": (S(chain_view=dict(cv, __proto__=5)), MS),
        # (d) the four new codes, each with the verdict it may stand in, and out of place
        "reject_terms_malformed": (S(immune=dict(im0, codes=["terms_malformed"])), []),
        "reject_vetoed": (S(immune=dict(im0, codes=["receptor_closed", "vetoed"])), []),
        "hold_cooling_off": (hold(["cooling_off"]), []),
        "hold_exposure_full": (hold(["exposure_full", "unmarked_novel"]), []),
        "hold_with_vetoed": (hold(["cooling_off", "vetoed"]), ["immune_inconsistent"]),
        "reject_only_cooling_off": (S(immune=dict(im0, codes=["cooling_off"])), ["immune_inconsistent"]),
        "flagged_cooling_off": (S(decision="admit", reasons=["within_grant"], immune=dict(im0, verdict="flagged", codes=["cooling_off"])), ["immune_inconsistent"]),
        "unknown_code_vetoed_x": (S(immune=dict(im0, codes=["vetoedx"])), ["malformed"]),
    }
    # keys outside printable ASCII, the digits of a key_url port, lone surrogates (2026-10-21)
    for name, key in (("nul", "a\x00"), ("e_acute", "\u00e9"), ("del", "\x7f"), ("emoji", "\U0001F600"), ("tab", "a\tb")):
        texts["key_" + name] = (S(presentation_ref=[dict(pr0, **{key: 1})]), MS)
    texts["key_printable_ascii"] = (S(presentation_ref=[dict(pr0, **{" ~": 1})]), [])
    rp0 = base["relying_party"]
    port = lambda digits: S(relying_party=dict(rp0, key_url="https://%s:%s/keys/door.json" % (rp0["domain"], digits)))
    for name, digits in (("garay", "\U00010D41"), ("outlined", "\U0001CCF1"), ("tangsa", "\U00016AC1"), ("kawi", "\U00011F51"),
                         ("fullwidth", "\uff18"), ("arabic_indic", "\u0668"), ("ascii_then_devanagari", "8\u0966")):
        texts["port_" + name] = (port(digits), ["signer_not_on_own_domain"])
    texts["port_ascii"] = (port("8443"), [])
    for name, val in (("high", "\ud800"), ("low", "\udc00"), ("reversed_pair", "\ude00\ud83d"), ("high_at_end", "x\udbff")):
        texts["lone_surrogate_value_" + name] = (S(presentation_ref=[dict(pr0, note=val)]), MS)
    texts["lone_surrogate_key"] = (S(presentation_ref=[dict(pr0, **{"\udc00": 1})]), MS)
    emo = S(presentation_ref=[dict(pr0, note="\U0001F600")])
    texts["pair_raw"] = (emo, [])
    texts["pair_escaped"] = (retext(emo, "\U0001F600", "\\ud83d\\ude00"), [])
    lone = S(presentation_ref=[dict(pr0, note="\ud800")])
    texts["lone_surrogate_raw_in_text"] = (retext(lone, "\\ud800", "\ud800"), BS)
    texts["escaped_high_raw_low_in_text"] = (retext(emo, "\U0001F600", "\\ud83d\ude00"), BS)
    for k_, (t, codes) in texts.items():
        got = verify_admission_text(t, k6p, IP)
        assert got == {"verdict": "refused" if codes else "accepted", "refusals": codes}, (k_, got)
    assert verify_admission_text(b"{}", k6p) == verify_admission_text("{", k6p) == {"verdict": "refused", "refusals": ["malformed"]}
    feed = json.dumps({"contract_canonical": IC["contract_canonical"], "relying_pub_b64": k6p, "records": {k_: t for k_, (t, _c) in texts.items()}})
    r = subprocess.run(["node", twin, "--verify-texts"], input=feed, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[-600:]
    JT = json.loads(r.stdout)
    pyt = {k_: verify_admission_text(t, k6p, IP) for k_, (t, _c) in texts.items()}
    assert JT == pyt, [(k_, JT.get(k_), pyt[k_]) for k_ in pyt if JT.get(k_) != pyt[k_]]
    n += 1; print("[6] v0.2 (the immune block): %d records a door signed verify; %d broken ones are refused with their codes, among them a record that "
                  "names another contract's terms, leaves the rules out or says not_run on an admit; a height or any number that is not a safe integer "
                  "is malformed; the JavaScript twin gives the same verdicts and digests for all %d; and %d records read from their bytes (a float "
                  "written as 970204.0 or with an exponent, a duplicate key, a field of the wrong type, 2^53, 2^60, a 5000 digit integer, NaN, a "
                  "__proto__ key, the four new immune codes, a key outside printable ASCII, a key_url port of non-ASCII digits, a lone "
                  "surrogate) get the same verdict and refusal set in both"
                  % (len(good), len(want), len(py), len(texts)))

    # [7] v0.3: the content block, its shape and its seven rules, in both runtimes. The records are v0.2 records of the
    # fixture moved to v0.3 and signed by this test's key, so a refusal is the content block's.
    adm = next(rd(IC["records"][k_]) for k_ in good if rd(IC["records"][k_])["decision"] == "admit")
    H = lambda ch: ch * 64
    ct0 = {"rules": CONTENT_RULES, "input_sha256": H("1"), "check_sha256": H("2"), "rules_sha256": H("3"), "scope_sha256": H("4"),
           "verdict": "none", "scope_conflict": "none", "answered": True, "checked": True}
    unchecked = dict(ct0, input_sha256=None, check_sha256=None, verdict=None, scope_conflict=None, answered=False, checked=False)

    def v03(rec, content, **kw):
        r = dict(rec, rules=dict(rec["rules"], version=VERSION_CONTENT), does_not_establish=list(DOES_NOT_ESTABLISH_V03), content=content)
        return T(signed(dict(r, **kw)))
    refuse_with = lambda content, *rs: v03(base, content, reasons=sorted(base["reasons"] + list(rs), key=REASONS_V03.index))
    ctexts = {
        "v03_clear_refused_by_immune": (v03(base, ct0), []),
        "v03_clear_admitted": (v03(adm, ct0), []),
        "v03_both_flags": (refuse_with(dict(ct0, verdict="instruction", scope_conflict="outside_task"), "content_flagged", "content_scope_conflict"), []),
        "v03_unchecked": (refuse_with(unchecked, "content_unchecked"), []),
        "v03_no_scope": (v03(adm, dict(ct0, scope_sha256=None, scope_conflict=None)), []),
        "rule1_unchecked_with_flags": (refuse_with(dict(unchecked, verdict="none", scope_conflict="none", answered=True), "content_unchecked"), BS),
        "rule2_checked_without_check_sha": (v03(base, dict(ct0, check_sha256=None)), BS),
        "rule3_unanswered_with_verdict": (refuse_with(dict(ct0, answered=False, scope_conflict=None), "content_unchecked"), BS),
        "rule4_instruction_without_reason": (v03(base, dict(ct0, verdict="instruction")), BS),
        "rule5_conflict_without_reason": (v03(base, dict(ct0, scope_conflict="outside_task")), BS),
        "rule6_conflict_without_scope": (v03(base, dict(ct0, scope_sha256=None)), BS),
        "rule7_admit_with_flag": (v03(adm, dict(ct0, verdict="instruction"), reasons=["within_grant", "content_flagged"]), BS),
        "v03_without_content": (T(signed({k_: v_ for k_, v_ in rd(v03(base, ct0)).items() if k_ not in ("content", "signatures")})), BS),
        "v02_with_content": (T(signed(dict(base, content=ct0))), BS),
        "v03_v02_limits": (v03(base, ct0, does_not_establish=list(DOES_NOT_ESTABLISH_V02)), ["does_not_establish_altered"]),
        "scope_reason_in_v02": (T(signed(dict(base, reasons=["immune_reject", "content_scope_conflict"]))), BS),
        "extra_content_field": (v03(base, dict(ct0, text="hello")), BS),
        "unknown_verdict": (v03(base, dict(ct0, verdict="maybe")), BS),
        "unknown_conflict": (v03(base, dict(ct0, scope_conflict="elsewhere")), BS),
        "answered_a_string": (v03(base, dict(ct0, answered="true")), BS),
    }
    for k_, (t, codes) in ctexts.items():
        got = verify_admission_text(t, k6p, IP)
        assert got == {"verdict": "refused" if codes else "accepted", "refusals": codes}, (k_, got)
    feed = json.dumps({"contract_canonical": IC["contract_canonical"], "relying_pub_b64": k6p, "records": {k_: t for k_, (t, _c) in ctexts.items()}})
    r = subprocess.run(["node", twin, "--verify-texts"], input=feed, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[-600:]
    JC = json.loads(r.stdout)
    pyc = {k_: verify_admission_text(t, k6p, IP) for k_, (t, _c) in ctexts.items()}
    assert JC == pyc, [(k_, JC.get(k_), pyc[k_]) for k_ in pyc if JC.get(k_) != pyc[k_]]
    CC = json.load(open(os.path.join(HERE, "fixtures", "admission_content", "cases.json"), encoding="utf-8"))
    for k_, t in CC["records"].items():
        got = verify_admission_text(t, CC["relying_pub_b64"], IP)
        assert (got == ok) if k_[0].isupper() else (got["refusals"] == ["malformed"]), (k_, got)
    nok = sum(1 for _t, c_ in ctexts.values() if not c_)
    n += 1; print("[7] v0.3 (the content block): %d records verify (both flags, unchecked, no scope, an admit and a refusal); %d are refused, one for "
                  "each of the seven rules, a v0.3 without content, a v0.2 with it, another version's limits, content_scope_conflict in v0.2, an "
                  "extra field and values off the closed lists; the JavaScript twin gives the same verdict and refusal set for all %d; "
                  "the %d records of fixtures/admission_content read as their names say" % (nok, len(ctexts) - nok, len(ctexts), len(CC["records"])))

    # [8] v0.4 (DESIGN_TASUKI_v2 2.1): the content block of A7.4 (decision, marks, unread, answered, checked, input_commit), rules 1 to 9,
    # and rule 0 (a door that does not require a check writes a v0.1 record with no content block), in both runtimes.
    c4 = {"rules": CONTENT_RULES_V04, "input_commit": H("1"), "check_sha256": H("2"), "rules_sha256": H("3"), "scope_sha256": H("4"),
          "decision": "pass", "marks": [], "unread": False, "answered": True, "checked": True}
    un4 = dict(c4, input_commit=None, check_sha256=None, decision=None, answered=False, checked=False)

    def v04(rec, content, **kw):
        r = dict(rec, rules=dict(rec["rules"], version=VERSION_CONTENT_V04), does_not_establish=list(DOES_NOT_ESTABLISH_V04), content=content)
        return T(signed(dict(r, **kw)))
    rw4 = lambda content, *rs: v04(base, content, reasons=sorted(set(base["reasons"] + list(rs)), key=REASONS_V04.index))
    wg = lambda *rs: ["within_grant"] + list(rs)
    rule0 = {k_: v_ for k_, v_ in dict(adm, rules=dict(adm["rules"], version=VERSION), does_not_establish=list(DOES_NOT_ESTABLISH),
                                        reasons=["within_grant"]).items() if k_ not in ("immune", "content", "signatures")}
    d4 = {
        "v04_pass_admitted": (v04(adm, c4), []),
        "v04_off_topic_admitted_mark_only": (v04(adm, dict(c4, marks=["off_topic"]), reasons=wg("content_off_topic")), []),
        "v04_stop_refused": (rw4(dict(c4, decision="stop"), "content_flagged"), []),
        "v04_both_marks_refused": (rw4(dict(c4, marks=["off_topic", "rule_conflict"]), "content_scope_conflict", "content_off_topic"), []),
        "v04_unread_pass_with_mark": (rw4(dict(c4, unread=True, marks=["off_topic"]), "content_off_topic", "content_unchecked"), []),
        "v04_unanswered": (rw4(dict(c4, decision=None, answered=False), "content_unchecked"), []),
        "v04_unchecked": (rw4(un4, "content_unchecked"), []),
        "v04_no_scope_no_mark": (v04(adm, dict(c4, scope_sha256=None)), []),
        "r1_unchecked_with_decision": (rw4(dict(un4, decision="pass", answered=True), "content_unchecked"), BS),
        "r2_checked_without_commit": (v04(adm, dict(c4, input_commit=None)), BS),
        "r3_unanswered_with_mark": (rw4(dict(c4, decision=None, answered=False, marks=["off_topic"]), "content_off_topic", "content_unchecked"), BS),
        "r3_answered_without_decision": (v04(adm, dict(c4, decision=None)), BS),
        "r4_stop_without_reason": (v04(base, dict(c4, decision="stop")), BS),
        "r5_rule_conflict_without_reason": (v04(base, dict(c4, marks=["rule_conflict"])), BS),
        "r6_off_topic_without_reason": (v04(adm, dict(c4, marks=["off_topic"])), BS),
        "r7_unread_without_unchecked": (v04(base, dict(c4, unread=True)), BS),
        "r8_stop_with_mark": (rw4(dict(c4, decision="stop", marks=["off_topic"]), "content_flagged", "content_off_topic"), BS),
        "r8_stop_unread": (rw4(dict(c4, decision="stop", unread=True), "content_flagged", "content_unchecked"), BS),
        "r9_admit_with_unchecked": (v04(adm, dict(c4, unread=True), reasons=wg("content_unchecked")), BS),
        "r9_admit_with_flagged": (v04(adm, dict(c4, decision="stop"), reasons=wg("content_flagged")), BS),
        "mark_without_scope": (v04(adm, dict(c4, marks=["off_topic"], scope_sha256=None), reasons=wg("content_off_topic")), BS),
        "marks_out_of_order": (rw4(dict(c4, marks=["rule_conflict", "off_topic"]), "content_scope_conflict", "content_off_topic"), BS),
        "marks_unknown": (v04(base, dict(c4, marks=["elsewhere"])), BS),
        "old_field_input_sha256": (v04(base, dict({k_: v_ for k_, v_ in c4.items() if k_ != "input_commit"}, input_sha256=H("1"))), BS),
        "v04_with_v03_block": (v04(base, ct0), BS),
        "v03_with_v04_block": (v03(base, c4), BS),
        "off_topic_reason_in_v03": (v03(adm, ct0, reasons=wg("content_off_topic")), BS),
        "v04_with_v03_limits": (v04(base, c4, does_not_establish=list(DOES_NOT_ESTABLISH_V03)), ["does_not_establish_altered"]),
        "v04_without_content": (T(signed({k_: v_ for k_, v_ in rd(v04(base, c4)).items() if k_ not in ("content", "signatures")})), BS),
    }
    for k_, (t, codes) in d4.items():
        got = verify_admission_text(t, k6p, IP)
        assert got == {"verdict": "refused" if codes else "accepted", "refusals": codes}, (k_, got)
    r0 = T(signed(rule0))
    assert verify_admission_text(r0, k6p) == {"verdict": "accepted", "refusals": []}, verify_admission_text(r0, k6p)
    d4["a04_rule0_required_false_no_content"] = (r0, [])
    feed = json.dumps({"contract_canonical": IC["contract_canonical"], "relying_pub_b64": k6p, "records": {k_: t for k_, (t, _c) in d4.items()}})
    r = subprocess.run(["node", twin, "--verify-texts"], input=feed, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[-600:]
    J4 = json.loads(r.stdout)
    py4 = {k_: verify_admission_text(t, k6p, IP) for k_, (t, _c) in d4.items()}
    assert J4 == py4, [(k_, J4.get(k_), py4[k_]) for k_ in py4 if J4.get(k_) != py4[k_]]
    n4 = sum(1 for _t, c_ in d4.values() if not c_)
    n += 1; print("[8] v0.4 (the A7.4 content block with input_commit): %d records verify (pass, off_topic on an admit under mark_only, stop, both "
                  "marks, unread with a mark, no answer, unchecked, no scope); %d are refused, one or more for each of rules 1 to 9, marks out of "
                  "order or off the list, the old input_sha256 field, a v0.3 block in v0.4 and back, content_off_topic in v0.3, v0.3's limits, no "
                  "content; rule 0: a v0.1 admit with no content block verifies; the JavaScript twin gives the same verdict and refusal set for all %d"
                  % (n4 - 1, len(d4) - n4, len(d4)))

    print("\nSELF-TEST PASSED: MUSUBI admission records, the verifying side, %d checks (all five versions verify; what does not; the request and its digest; "
          "the revocation record; the JavaScript twin agrees; v0.2's immune block; v0.3's content block; v0.4's content block)" % n)


def main():
    ap = argparse.ArgumentParser(description="MUSUBI admission records (a2a-admission-v0): the verifying side")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--check-fixtures", action="store_true")
    ap.add_argument("--verify", metavar="RECORD.json")
    ap.add_argument("--key", metavar="BASE64", help="the relying party's Ed25519 key, fetched from the record's relying_party.key_url")
    ap.add_argument("--contract", metavar="CONTRACT.json")
    a = ap.parse_args()
    if a.selftest:
        _selftest(); return 0
    if a.check_fixtures:
        bad = check_fixtures(out=sys.stdout)
        print("fixtures match the list" if not bad else "FAILED: %d fixture file(s) differ from fixtures/ADMISSION_FIXTURES.sha256" % bad)
        return 1 if bad else 0
    if not (a.verify and a.key):
        ap.print_help(); return 1
    rd = lambda p: parse_strict(open(p, encoding="utf-8").read())
    rec = rd(a.verify)
    out = verify_admission({k: v for k, v in rec.items() if k != "anchor"}, a.key, rd(a.contract) if a.contract else None)
    out["admission_sha256"] = admission_sha256({k: v for k, v in rec.items() if k != "anchor"})
    print(json.dumps(out, indent=2))
    return 0 if out["verdict"] == "accepted" else 4


if __name__ == "__main__":
    sys.exit(main())
