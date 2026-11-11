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
                              host_of_https, under_domain, parse_strict, ed25519_verify, OVERCLAIM,
                              scan_numbers)

SCHEMA = "a2a-contract-v0"
SETTLE_SCHEMA = "a2a-settlement-v0"
EXEC_SCHEMA = "a2a-execution-v0"
CONTEXT = b"a2a-contract-v0\n"
SETTLE_CONTEXT = b"a2a-settlement-v0\n"

ROLES = ("principal", "contractor")
HEX32 = re.compile(r"^[0-9a-f]{32}\Z")
HEX64 = re.compile(r"^[0-9a-f]{64}\Z")

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


# The canonical rule every digest here is computed over. canonical() comes from the agreement layer (json.dumps
# with sorted keys, no whitespace, non-ASCII raw); canonical_v0.mjs is the same rule in Node and
# canonical_vectors.json the fixed inputs both must hash identically. verify_contract refuses the two inputs that
# could make two runtimes disagree: floats and object keys outside printable ASCII.
CANONICAL_RULE = "musubi-canonical-v0"
CANONICAL_VECTORS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "canonical_vectors.json")
CANONICAL_TWIN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "canonical_v0.mjs")


def scan_keys(root, path="$"):
    """Object keys that are not printable ASCII (0x20..0x7E), with their path. Iterative, like scan_numbers."""
    out = []
    stack = [(root, path)]
    while stack:
        node, p = stack.pop()
        if isinstance(node, dict):
            for k in sorted(node.keys(), key=str, reverse=True):
                if not (isinstance(k, str) and all(0x20 <= ord(ch) <= 0x7e for ch in k)):
                    out.append((p, k))
                stack.append((node[k], p + "." + str(k)))
        elif isinstance(node, list):
            for i in range(len(node) - 1, -1, -1):
                stack.append((node[i], p + "[%d]" % i))
    out.sort(key=lambda t: (t[0], str(t[1])))
    return out


def signing_bytes(record, context=CONTEXT):
    body = {k: v for k, v in record.items() if k != "signatures"}
    return context + canonical(body).encode("utf-8")


def contract_sha256(record):
    """Content digest of the terms: sha256 of the exact bytes both parties sign. Identical for both
    parties, stable when the second signature lands, recomputable from the contract minus its
    signatures. Binding across the transaction is by this digest, never by contract_id alone."""
    return sha256_hex(signing_bytes(record))


# --------------------------------------------------------------------------- grant algebra
# The grant keys any settle layer reads. verify_contract refuses a grant carrying any other key: a key no
# verifier validates is a key some reader can be made to trust (2026-09-25, Issue #25: a leftover
# "authorized_prohibited" silently replaced prohibited_actions in the v0 and v1 settle paths).
GRANT_KEYS = frozenset(("authorized_actions", "prohibited_actions", "conditional", "delegation", "data_access",
                        "max_hops", "privacy", "revocation", "finality", "witnesses", "expiry_height",
                        "ordering", "approval_policy", "limits", "payload_schema", "exposure"))
# grant.limits (2026-10-10): {"<action>": {"max_amount": positive integer, "unit": "JPY"}}. One action may not carry
# more than max_amount in one execution. The amount of an execution is stated only in an admission request and in the
# execution record's admission_ref, so a contract that carries limits must require admission before execution
# (LIMITS_NEED), or no settle layer could see the amount the limit is about.
LIMITS_NEED = "required_before_execution"

# grant.payload_schema (2026-11-09): {"<action>": payload-schema-v0}. The closed shape the payload of one call of the action
# must have: every field named with its type, nothing else accepted. The relying party's door compares the payload with it
# before it admits, so, like limits, it needs requirements.admission (LIMITS_NEED). A field of type "text" is free text and
# is listed by name as open (open_fields); every other type is closed.
#
#   {"schema": "payload-schema-v0",
#    "fields": {"<name>": {"type": "enum",    "values": [string, ...], "required": bool, "values_from"?: {"path", "sha256", "pointer"}}
#                       | {"type": "integer", "min": integer, "max": integer, "required": bool}
#                       | {"type": "token",   "max_chars": 1..256, "required": bool}            ([A-Za-z0-9._-], 1 to max_chars)
#                       | {"type": "text",    "max_chars": 1..65536, "required": bool}},        (any string up to max_chars: open)
#    "other_fields": "refuse"}
#
# values_from names where an enum's values were taken from (a file and its sha256); a reader compares the payload with
# "values" alone. grant.exposure (2026-11-09): {"<action>": {"window_blocks": 1..4320, "max_acts": 1..100000}}, at most
# max_acts admitted calls of the action in any window_blocks blocks, counted by the door from its own admits; it too needs
# requirements.admission. The ranges are the ones immune_v0 reads for requirements.immune.exposure.
PAYLOAD_SCHEMA = "payload-schema-v0"
FIELD_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}\Z")
TOKEN = re.compile(r"^[A-Za-z0-9._-]+\Z")
FIELD_KEYS = {"enum": ({"type", "values", "required"}, {"values_from"}), "integer": ({"type", "min", "max", "required"}, set()),
              "token": ({"type", "max_chars", "required"}, set()), "text": ({"type", "max_chars", "required"}, set())}
MAX_CHARS = {"token": 256, "text": 65536}
OPEN_TYPES = ("text",)


def _field_problem(f):
    """None when f is one field of payload-schema-v0, else why not"""
    if not isinstance(f, dict) or not isinstance(f.get("type"), str) or f["type"] not in FIELD_KEYS:
        return "a field must be an object whose type is one of %s" % sorted(FIELD_KEYS)
    need, may = FIELD_KEYS[f["type"]]
    if not (need <= set(f) <= need | may):
        return "a field of type %s has exactly the keys %s (and may have %s)" % (f["type"], sorted(need), sorted(may))
    if not isinstance(f["required"], bool):
        return "required must be true or false"
    t = f["type"]
    if t == "enum":
        v = f["values"]
        if not (isinstance(v, list) and 1 <= len(v) <= 1024 and all(isinstance(x, str) and x for x in v) and len(set(v)) == len(v)):
            return "an enum's values are 1 to 1024 distinct non empty strings"
        if "values_from" in f:
            s = f["values_from"]
            if not (isinstance(s, dict) and set(s) == {"path", "sha256", "pointer"} and isinstance(s["path"], str) and s["path"]
                    and isinstance(s["sha256"], str) and HEX64.match(s["sha256"]) and isinstance(s["pointer"], str) and s["pointer"]):
                return "values_from is {path, sha256 (64 lowercase hex), pointer}"
    elif t == "integer":
        if _int(f["min"]) is None or _int(f["max"]) is None or f["min"] > f["max"]:
            return "an integer field has integer min and max, min <= max"
    elif _int(f["max_chars"]) is None or not 1 <= f["max_chars"] <= MAX_CHARS[t]:
        return "max_chars of a %s field is an integer from 1 to %d" % (t, MAX_CHARS[t])
    return None


def payload_schema_problem(s):
    """None when s is a payload-schema-v0 object, else why not"""
    if not isinstance(s, dict) or set(s) != {"schema", "fields", "other_fields"}:
        return "a payload schema is an object with exactly schema, fields and other_fields"
    if s["schema"] != PAYLOAD_SCHEMA:
        return "schema must be %r" % PAYLOAD_SCHEMA
    if s["other_fields"] != "refuse":
        return "other_fields must be \"refuse\": a schema that lets unnamed fields through binds nothing"
    fs = s["fields"]
    if not (isinstance(fs, dict) and 1 <= len(fs) <= 64):
        return "fields is an object of 1 to 64 fields"
    for name in sorted(fs, key=str):
        if not (isinstance(name, str) and FIELD_NAME.match(name)):
            return "field name %r is not [A-Za-z_][A-Za-z0-9_]{0,63}" % (name,)
        why = _field_problem(fs[name])
        if why:
            return "field %s: %s" % (name, why)
    return None


def open_fields(s):
    """the names of the fields of a payload-schema-v0 object that carry free text, ascending"""
    return sorted(n for n, f in s["fields"].items() if f["type"] in OPEN_TYPES)


def payload_schema_within(c, p):
    """True when every payload the schema c accepts, the schema p accepts too (both well formed)"""
    cf, pf = c["fields"], p["fields"]
    if set(cf) - set(pf):
        return False
    for n, x in pf.items():
        if x["required"] and not (n in cf and cf[n]["required"]):
            return False
    for n, x in cf.items():
        y = pf[n]
        if x["type"] != y["type"]:
            return False
        if x["type"] == "enum" and set(x["values"]) - set(y["values"]):
            return False
        if x["type"] == "integer" and not (y["min"] <= x["min"] and x["max"] <= y["max"]):
            return False
        if x["type"] in MAX_CHARS and x["max_chars"] > y["max_chars"]:
            return False
    return True


def _value_ok(f, v):
    t = f["type"]
    if t == "enum":
        return isinstance(v, str) and v in f["values"]
    if t == "integer":
        return _int(v) is not None and f["min"] <= v <= f["max"]
    if t == "token":
        return isinstance(v, str) and len(v) <= f["max_chars"] and TOKEN.match(v) is not None
    return isinstance(v, str) and len(v) <= f["max_chars"]


def payload_problems(contract, action, payload):
    """The codes under which grant.payload_schema[action] refuses this payload, ascending: payload_not_object,
    payload_field_unknown, payload_field_missing, payload_field_value. [] when the payload fits, and [] when the grant sets
    no schema for the action (nothing binds it then; loss_bound_v1 lists it as payload_unbound). A schema that is not well
    formed refuses every payload (payload_schema_unreadable)."""
    g = contract.get("grant") if isinstance(contract, dict) and isinstance(contract.get("grant"), dict) else {}
    ps = g.get("payload_schema")
    if ps is None:
        return []
    s = ps.get(action) if isinstance(ps, dict) else None
    if s is None and isinstance(ps, dict) and action not in ps:
        return []
    if payload_schema_problem(s) is not None:
        return ["payload_schema_unreadable"]
    if not isinstance(payload, dict):
        return ["payload_not_object"]
    out = set()
    fs = s["fields"]
    if set(payload) - set(fs):
        out.add("payload_field_unknown")
    for n, f in fs.items():
        if n not in payload:
            if f["required"]:
                out.add("payload_field_missing")
        elif not _value_ok(f, payload[n]):
            out.add("payload_field_value")
    return sorted(out)


def _delegates(grant):
    d = grant.get("delegation")
    return set((d.get("allowed") if isinstance(d, dict) else []) or [])


def _conditionals(grant):
    return {c.get("action"): c.get("requires") for c in (grant.get("conditional") or []) if isinstance(c, dict)}


def _int(x):
    return x if (isinstance(x, int) and not isinstance(x, bool)) else None


# The revocation modes any settle layer knows how to end authority under. verify_contract refuses any other
# value (2026-09-26, Issue #25 items 10 to 12): a mode no settle layer reads fell through grant_subset unflagged,
# and settle_v1_6 computed h + ack_window on it, so an unknown mode kept authority alive after revocation.
REVOCATION_MODES = frozenset(("anchor", "delivery_ack"))


def bits_to_target(bits):
    """Compact nBits to a target integer, the same decode settle_v1_1 uses, so the contract layer and the
    settle layer agree on which of two floors is harder. Negative or zero targets are not valid."""
    exp, mant = bits >> 24, bits & 0x007fffff
    if bits & 0x00800000 or mant == 0:
        return None
    return mant * (1 << (8 * (exp - 3))) if exp >= 3 else mant >> (8 * (3 - exp))


def _target_of(fin):
    """grant.finality.max_target_bits as a target integer, or None when absent or not 8 lowercase hex."""
    s = (fin or {}).get("max_target_bits")
    if not (isinstance(s, str) and re.match(r"^[0-9a-f]{8}\Z", s)):
        return None
    return bits_to_target(int(s, 16))


def _witness_keys(grant):
    """The witness set as the set of its public keys. Names are labels; the key is what settle_v1_4 verifies
    against, so a swap that keeps the name and changes the key is a replacement, not the same witness."""
    ws = grant.get("witnesses") if isinstance(grant.get("witnesses"), list) else []
    return set(w.get("public_key_ed25519_b64") for w in ws if isinstance(w, dict) and isinstance(w.get("public_key_ed25519_b64"), str))


_HEX8 = re.compile(r"^[0-9a-f]{8}\Z")


def _strlist(v):
    return isinstance(v, list) and all(isinstance(x, str) and x for x in v)


def grant_type_problems(grant):
    """The type door (Issue #25 round 3, 2026-09-26, the first outside verifier). A value of the wrong JSON type
    under a declared key passed verify_contract, and grant_subset then read it through _int / _target_of /
    set(...) and SKIPPED the axis, so a signed parent with max_hops "1" (or 1.0, or true) let every child under
    it carry max_hops 50 with zero refusals: the same class as an undeclared key or an unknown revocation mode,
    one level further down. Every axis is typed here exactly as its readers read it, and a wrong type is refused
    at verify, so it never reaches a comparison. Returns [(code, why)]."""
    p = []

    def bad(why):
        p.append(("grant_type", why))

    for k in ("authorized_actions", "prohibited_actions", "data_access"):
        if grant.get(k) is not None and not _strlist(grant[k]):
            bad("grant.%s must be a list of non empty strings" % k)
    for k in ("max_hops", "expiry_height"):
        v = grant.get(k)
        if v is not None and (_int(v) is None or v < 0):
            bad("grant.%s must be an integer >= 0 (got %s %r); a limit of another type is a limit no reader applies" % (k, type(v).__name__, v))
    d = grant.get("delegation")
    if d is not None:
        if not isinstance(d, dict) or set(d.keys()) - {"allowed"}:
            bad("grant.delegation must be an object {allowed: [domain, ...]}; use {\"allowed\": []} for no delegation")
        elif not _strlist(d.get("allowed")):
            bad("grant.delegation.allowed must be a list of non empty strings")
    c = grant.get("conditional")
    if c is not None:
        if not isinstance(c, list) or not all(isinstance(x, dict) for x in c):
            bad("grant.conditional must be a list of objects")
        else:
            acts = [x.get("action") for x in c]
            if not all(isinstance(a, str) and a for a in acts):
                bad("every grant.conditional entry needs a non empty string action")
            elif len(set(acts)) != len(acts):
                bad("grant.conditional actions must be unique; the dict view every reader builds keeps only the last of a duplicate")
            for x in c:
                if "requires" in x and not isinstance(x["requires"], str):
                    bad("grant.conditional[].requires must be a string when present")
    f = grant.get("finality")
    if f is not None:
        if not isinstance(f, dict) or set(f.keys()) - {"depth", "max_target_bits"}:
            bad("grant.finality must be an object {depth, max_target_bits}")
        else:
            if "depth" in f and (_int(f["depth"]) is None or f["depth"] < 1):
                bad("grant.finality.depth must be an integer >= 1 (got %r)" % (f["depth"],))
            if "max_target_bits" in f:
                s = f["max_target_bits"]
                if not (isinstance(s, str) and _HEX8.match(s)) or not bits_to_target(int(s, 16)):
                    bad("grant.finality.max_target_bits must be 8 lowercase hex that decodes to a positive target (got %r)" % (s,))
    w = grant.get("witnesses")
    if w is not None:
        if not isinstance(w, list) or not all(isinstance(x, dict) for x in w):
            bad("grant.witnesses must be a list of objects")
        else:
            for x in w:
                if not (isinstance(x.get("name"), str) and x["name"]) or b64_raw(x.get("public_key_ed25519_b64"), 32) is None:
                    bad("every grant.witnesses entry needs a non empty string name and a canonical 32 byte public_key_ed25519_b64")
    if grant.get("privacy") is not None and not (isinstance(grant["privacy"], str) and grant["privacy"]):
        bad("grant.privacy must be a non empty string")
    o = grant.get("ordering")
    if o is not None:
        if not isinstance(o, dict) or set(o.keys()) - {"same_height"}:
            bad("grant.ordering must be an object {same_height}, the shape settle v1 and v1.4 read")
        elif o.get("same_height") is not None and not isinstance(o["same_height"], str):
            bad("grant.ordering.same_height must be a string or null")
    ap = grant.get("approval_policy")
    if ap is not None:
        if not isinstance(ap, dict) or set(ap.keys()) - {"allow_unscoped", "approvers"}:
            bad("grant.approval_policy must be an object {allow_unscoped, approvers}")
        else:
            if "allow_unscoped" in ap and not isinstance(ap["allow_unscoped"], bool):
                bad("grant.approval_policy.allow_unscoped must be true or false")
            if "approvers" in ap:
                # pinned approvers with no stake (settle v1.10, Issue #29): checked like witnesses[], plus the actions each may approve
                apv = ap["approvers"]
                cond_actions = {x.get("action") for x in (grant.get("conditional") or []) if isinstance(x, dict)}
                if not (isinstance(apv, list) and 1 <= len(apv) <= 16 and all(isinstance(x, dict) for x in apv)):
                    bad("grant.approval_policy.approvers must be a list of 1 to 16 objects")
                else:
                    names, keys = set(), set()
                    for x in apv:
                        if set(x.keys()) - {"name", "public_key_ed25519_b64", "actions"}:
                            bad("every grant.approval_policy.approvers entry is an object {name, public_key_ed25519_b64, actions}")
                        if not (isinstance(x.get("name"), str) and x["name"]) or b64_raw(x.get("public_key_ed25519_b64"), 32) is None:
                            bad("every grant.approval_policy.approvers entry needs a non empty string name and a canonical 32 byte public_key_ed25519_b64")
                            continue
                        if x["name"] in names or x["public_key_ed25519_b64"] in keys:
                            bad("grant.approval_policy.approvers names and keys must be unique")
                        names.add(x["name"]); keys.add(x["public_key_ed25519_b64"])
                        acts = x.get("actions")
                        if not (isinstance(acts, list) and acts and all(isinstance(a, str) and a for a in acts) and len(set(acts)) == len(acts)):
                            bad("every grant.approval_policy.approvers entry needs a non empty list of distinct action names")
                        elif set(acts) - cond_actions:
                            bad("grant.approval_policy.approvers may approve only grant.conditional actions (not %s)" % sorted(set(acts) - cond_actions))
    lm = grant.get("limits")
    if lm is not None:
        if not isinstance(lm, dict):
            bad("grant.limits must be an object {action: {max_amount, unit}}")
        else:
            named = set(x for x in (grant.get("authorized_actions") or []) if isinstance(x, str)) if isinstance(grant.get("authorized_actions"), list) else set()
            named |= {x.get("action") for x in (grant.get("conditional") or []) if isinstance(x, dict)} if isinstance(grant.get("conditional"), list) else set()
            for a in sorted(lm, key=str):
                x = lm[a]
                if not (isinstance(a, str) and a):
                    bad("grant.limits keys must be non empty action names")
                elif a not in named:
                    bad("grant.limits names %r, which is neither in authorized_actions nor in conditional; a limit on an action the grant does not carry limits nothing" % a)
                if not isinstance(x, dict) or set(x.keys()) != {"max_amount", "unit"}:
                    bad("grant.limits[%s] must be an object with exactly max_amount and unit" % a)
                    continue
                if _int(x["max_amount"]) is None or x["max_amount"] < 1:
                    bad("grant.limits[%s].max_amount must be an integer >= 1 (got %s %r); a limit of another type is a limit no reader applies" % (a, type(x["max_amount"]).__name__, x["max_amount"]))
                if not (isinstance(x["unit"], str) and x["unit"]):
                    bad("grant.limits[%s].unit must be a non empty string" % a)
    # grant.payload_schema and grant.exposure (2026-11-09): keyed by actions the grant carries, like limits; one problem per
    # entry at most, so that the JavaScript twin counts the same
    named = set(x for x in (grant.get("authorized_actions") or []) if isinstance(x, str)) if isinstance(grant.get("authorized_actions"), list) else set()
    named |= {x.get("action") for x in (grant.get("conditional") or []) if isinstance(x, dict)} if isinstance(grant.get("conditional"), list) else set()
    ps = grant.get("payload_schema")
    if ps is not None:
        if not isinstance(ps, dict):
            bad("grant.payload_schema must be an object {action: payload-schema-v0}")
        else:
            for a in sorted(ps, key=str):
                if not (isinstance(a, str) and a) or a not in named:
                    bad("grant.payload_schema names %r, which is neither in authorized_actions nor in conditional" % (a,))
                why = payload_schema_problem(ps[a])
                if why:
                    bad("grant.payload_schema[%s]: %s" % (a, why))
    ex = grant.get("exposure")
    if ex is not None:
        if not isinstance(ex, dict):
            bad("grant.exposure must be an object {action: {window_blocks, max_acts}}")
        else:
            for a in sorted(ex, key=str):
                if not (isinstance(a, str) and a) or a not in named:
                    bad("grant.exposure names %r, which is neither in authorized_actions nor in conditional" % (a,))
                x = ex[a]
                if not (isinstance(x, dict) and set(x) == {"window_blocks", "max_acts"} and _int(x["window_blocks"]) is not None
                        and 1 <= x["window_blocks"] <= 4320 and _int(x["max_acts"]) is not None and 1 <= x["max_acts"] <= 100000):
                    bad("grant.exposure[%s] must be {window_blocks: 1..4320, max_acts: 1..100000}" % a)
    rv = grant.get("revocation")
    if isinstance(rv, dict):
        if set(rv.keys()) - {"effective_at", "ack_window"}:
            bad("grant.revocation must be an object {effective_at, ack_window}")
        if "ack_window" in rv and (_int(rv["ack_window"]) is None or rv["ack_window"] < 1):
            bad("grant.revocation.ack_window must be an integer >= 1 when present")
    return p


def grant_subset(child, parent):
    """Delegation monotonicity: a delegated (child) grant may only narrow the parent's, on EVERY axis of
    authority. Returns a list of violations; empty means the child is within the parent.
    Axes (2026-09-25, Issue #25 closed the last four; 2026-09-26, items 10 to 12 closed three more):
    authorized actions, prohibited actions, data access, hops, who the child may delegate to, every condition
    the parent placed on an action, expiry height, how fast authority ends on revocation, whether unscoped
    approvals are accepted, the finality floor (depth and proof-of-work target), the witness set (by key),
    and privacy and ordering (held equal until a partial order is defined for them)."""
    v = []
    # an axis this function cannot read is a violation, never a skipped axis (Issue #25 round 3, 2026-09-26): a
    # parent limit of the wrong type used to switch the axis off for the whole chain below it. verify_contract
    # refuses such a grant first; this line is for callers that compare grants without verifying them.
    for _, why in grant_type_problems(parent if isinstance(parent, dict) else {}):
        v.append("parent grant unreadable: " + why)
    for _, why in grant_type_problems(child if isinstance(child, dict) else {}):
        v.append("child grant unreadable: " + why)
    if v:
        return v
    pa = set(parent.get("authorized_actions") or [])
    ca = set(child.get("authorized_actions") or [])
    for a in sorted(ca, key=str):
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
    # hops: mirror expiry. A parent that carries a hop limit binds the child to parent-1; a child that omits
    # max_hops is a violation, not a pass (2026-09-25, Issue #25 follow-up: omission laundered the limit,
    # 2 became 50 two links down).
    ph, ch = _int(parent.get("max_hops")), _int(child.get("max_hops"))
    if ph is not None:
        if ch is None:
            v.append("parent allows %d hops but child has no max_hops" % ph)
        elif ch > ph - 1:
            v.append("max_hops %d exceeds parent-1 (%d)" % (ch, ph - 1))
    # who the child may delegate to: a subset of who the parent may delegate to
    pdl, cdl = _delegates(parent), _delegates(child)
    for d in sorted(cdl, key=str):
        if d not in pdl:
            v.append("delegation.allowed %r not in parent grant" % d)
    # every condition the parent placed stays, with the same requirement, unless the child drops or prohibits the action
    pc, cc = _conditionals(parent), _conditionals(child)
    for a, req in pc.items():
        if a in cp or (a not in ca and a not in cc):
            continue                                            # prohibited or not granted at all: narrower
        if a not in cc:
            v.append("parent requires %r for %r but child drops the condition" % (req, a))
        elif cc[a] != req:
            v.append("child changes the requirement for %r from %r to %r" % (a, req, cc[a]))
    for a in sorted(cc, key=str):                               # a conditional-only action is still an action
        if a not in pa and a not in pc:
            v.append("conditional action %r not in parent grant" % a)
    # expiry: the child cannot outlive the parent
    pe, ce = _int(parent.get("expiry_height")), _int(child.get("expiry_height"))
    if pe is not None:
        if ce is None:
            v.append("parent expires at height %d but child has no expiry_height" % pe)
        elif ce > pe:
            v.append("expiry_height %d exceeds parent (%d)" % (ce, pe))
    # revocation: authority in the child ends no later than it would in the parent. Only the known modes are
    # compared; any other child mode is a violation, never a fall-through (Issue #25 item 12: under a
    # delivery_ack parent, "manual" was neither anchor nor delivery_ack nor None, so nothing flagged it).
    pr = parent.get("revocation") if isinstance(parent.get("revocation"), dict) else None
    cr = child.get("revocation") if isinstance(child.get("revocation"), dict) else None
    if pr is not None:
        pm, cm = pr.get("effective_at"), (cr or {}).get("effective_at")
        if cr is None or cm is None:
            v.append("parent has a revocation policy but child has none")
        elif pm not in REVOCATION_MODES:
            v.append("parent revocation mode %r is not one a settle layer reads" % pm)
        elif cm not in REVOCATION_MODES:
            v.append("child revocation mode %r is not one a settle layer reads (parent uses %r)" % (cm, pm))
        elif pm == "anchor" and cm != "anchor":
            v.append("parent revokes at anchor but child revokes at %r" % cm)
        elif pm == "delivery_ack" and cm == "delivery_ack":
            pw, cw = _int(pr.get("ack_window")), _int((cr or {}).get("ack_window"))
            if pw is not None and (cw is None or cw > pw):
                v.append("ack_window %r exceeds parent (%d)" % (cw, pw))
        # pm == delivery_ack and cm == anchor: the child ends authority sooner; within.
    # finality: the child's assurance bar is at least the parent's (Issue #25 item 10). depth can only go up;
    # the proof-of-work floor, compared as a target, can only get harder (a smaller target). Omission when the
    # parent carries the axis is a violation, the same rule as expiry and hops.
    pf = parent.get("finality") if isinstance(parent.get("finality"), dict) else None
    cf = child.get("finality") if isinstance(child.get("finality"), dict) else None
    if pf is not None:
        if cf is None:
            v.append("parent sets a finality floor but child has none")
        else:
            pdp, cdp = _int(pf.get("depth")), _int(cf.get("depth"))
            if pdp is not None:
                if cdp is None:
                    v.append("parent requires finality depth %d but child has no depth" % pdp)
                elif cdp < pdp:
                    v.append("finality depth %d is below parent (%d)" % (cdp, pdp))
            pt, ct = _target_of(pf), _target_of(cf)
            if pt is not None:
                if ct is None:
                    v.append("parent sets max_target_bits %s but child has none or an invalid one" % pf.get("max_target_bits"))
                elif ct > pt:
                    v.append("max_target_bits %s is an easier target than parent %s" % (cf.get("max_target_bits"), pf.get("max_target_bits")))
    # witnesses: the party the parent trusted to walk the evidence stays (Issue #25 item 11). Compared by key,
    # since a swap that keeps the name is a replacement. The child may add witnesses, never remove, replace or
    # empty them when the parent has any.
    pwk, cwk = _witness_keys(parent), _witness_keys(child)
    if pwk:
        if not cwk:
            v.append("parent names %d witness(es) but child has none" % len(pwk))
        else:
            for k in sorted(pwk):
                if k not in cwk:
                    v.append("parent witness key %s... is dropped or replaced in child" % k[:12])
    # privacy and ordering: in GRANT_KEYS, no settle layer reads them yet, so no partial order is defined. Until
    # one is, a child holds them equal to the parent: the only rule that cannot be wrong in the widening
    # direction. Loosen when a reader and an order exist (Issue #25, 2026-09-26).
    for k in ("privacy", "ordering"):
        if k in parent and parent.get(k) is not None:
            if k not in child or child.get(k) is None:
                v.append("parent sets %s but child has none" % k)
            elif child.get(k) != parent.get(k):
                v.append("%s changed from %r to %r; no order is defined for it, so it must stay equal" % (k, parent.get(k), child.get(k)))
    # limits (2026-10-10): a child may only lower a limit the parent set, in the same unit. A child that carries the
    # action with no limit, where the parent has one, has removed the limit: a violation, the same rule as hops and expiry.
    pl = parent.get("limits") if isinstance(parent.get("limits"), dict) else {}
    cl = child.get("limits") if isinstance(child.get("limits"), dict) else {}
    for a in sorted(pl, key=str):
        if a in cp or (a not in ca and a not in cc):
            continue                                            # prohibited or not granted at all: narrower
        if a not in cl:
            v.append("parent limits %r to %d %s but child carries it with no limit" % (a, pl[a]["max_amount"], pl[a]["unit"]))
        elif cl[a]["unit"] != pl[a]["unit"]:
            v.append("limit for %r changes unit from %r to %r; amounts in different units are not compared" % (a, pl[a]["unit"], cl[a]["unit"]))
        elif cl[a]["max_amount"] > pl[a]["max_amount"]:
            v.append("limit for %r is %d, above parent (%d)" % (a, cl[a]["max_amount"], pl[a]["max_amount"]))
    # payload_schema (2026-11-09): a child accepts no payload the parent's schema refuses; dropping the schema widens
    ps_p = parent.get("payload_schema") if isinstance(parent.get("payload_schema"), dict) else {}
    ps_c = child.get("payload_schema") if isinstance(child.get("payload_schema"), dict) else {}
    for a in sorted(ps_p, key=str):
        if a in cp or (a not in ca and a not in cc):
            continue
        if a not in ps_c:
            v.append("parent binds the payload of %r but child carries it with no payload_schema" % a)
        elif not payload_schema_within(ps_c[a], ps_p[a]):
            v.append("payload_schema for %r accepts a payload the parent's refuses" % a)
    # exposure (2026-11-09): at most as many calls, in a window at least as long
    ex_p = parent.get("exposure") if isinstance(parent.get("exposure"), dict) else {}
    ex_c = child.get("exposure") if isinstance(child.get("exposure"), dict) else {}
    for a in sorted(ex_p, key=str):
        if a in cp or (a not in ca and a not in cc):
            continue
        if a not in ex_c:
            v.append("parent limits how often %r runs but child carries it with no exposure" % a)
        elif not (ex_c[a]["max_acts"] <= ex_p[a]["max_acts"] and ex_c[a]["window_blocks"] >= ex_p[a]["window_blocks"]):
            v.append("exposure for %r (%d in %d blocks) is not within the parent's (%d in %d blocks)" % (
                a, ex_c[a]["max_acts"], ex_c[a]["window_blocks"], ex_p[a]["max_acts"], ex_p[a]["window_blocks"]))
    # approvals: the child cannot accept looser approvals than the parent
    pap = parent.get("approval_policy") if isinstance(parent.get("approval_policy"), dict) else {}
    cap = child.get("approval_policy") if isinstance(child.get("approval_policy"), dict) else {}
    if bool(cap.get("allow_unscoped")) and not bool(pap.get("allow_unscoped")):
        v.append("child allows unscoped approvals but parent does not")
    # pinned approvers (settle v1.10): who approves is part of the authority, so a child keeps the parent's exactly
    norm = lambda a: sorted((canonical(x) for x in (a.get("approvers") or [])) if isinstance(a.get("approvers"), list) else [])
    if norm(pap) != norm(cap):
        v.append("child changes the pinned approvers (approval_policy.approvers must stay equal to the parent's)")
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
        unknown = sorted(k for k in grant if k not in GRANT_KEYS)
        if unknown:
            r.refuse("grant_key_unknown", "undeclared grant keys are refused, a key no verifier reads can shadow "
                                          "one that is: %s" % unknown)
        for k in ("authorized_actions", "prohibited_actions"):
            if not isinstance(grant.get(k), list):
                r.refuse("bad_grant", "grant.%s must be a list" % k)
        # the type door (Issue #25 round 3): every declared key holds exactly the type its readers assume, or the
        # contract is refused here. grant_subset skips an axis it cannot read, so a wrong-typed parent limit was
        # a limit no child had to honour.
        for code, why in grant_type_problems(grant):
            r.refuse(code, why)
        if _strlist(grant.get("authorized_actions")) and _strlist(grant.get("prohibited_actions")):
            overlap = set(grant["authorized_actions"]) & set(grant["prohibited_actions"])
            if overlap:
                r.refuse("grant_contradiction", "actions both authorized and prohibited: %s" % sorted(overlap))
        # revocation door (Issue #25 item 12): a mode no settle layer reads is refused here, the same way an
        # undeclared grant key is, so it can never reach a settle path that computes on it. The ack_window
        # requirement for delivery_ack stays where it already lives, settle_v1_4's terms check
        # (ack_window_missing); its [H5] regression needs such a contract to pass verify so v1.3's veto hole
        # stays demonstrable.
        rv = grant.get("revocation")
        if rv is not None:
            if not isinstance(rv, dict):
                r.refuse("bad_revocation", "grant.revocation must be an object")
            elif rv.get("effective_at") not in REVOCATION_MODES:
                r.refuse("revocation_mode_unknown", "grant.revocation.effective_at %r is not a mode any settle "
                                                    "layer reads; known: %s" % (rv.get("effective_at"), sorted(REVOCATION_MODES)))

        # limits need admission (2026-10-10): the amount an execution moved is stated only where an admission is
        # named, so a limit in a contract that does not require admission is a limit no settle layer can read.
        if grant.get("limits") is not None:
            rq = record.get("requirements")
            if not (isinstance(rq, dict) and rq.get("admission") == LIMITS_NEED):
                r.refuse("limits_need_admission", "grant.limits is present, so requirements.admission must be %r: the "
                                                  "amount of an execution is recorded only with its admission" % LIMITS_NEED)
        # payload_schema and exposure need admission (2026-11-09): the door is what compares a payload with the schema and
        # counts the calls in a window, so a contract that does not require the door states them to no one.
        for k in ("payload_schema", "exposure"):
            if grant.get(k) is not None:
                rq = record.get("requirements")
                if not (isinstance(rq, dict) and rq.get("admission") == LIMITS_NEED):
                    r.refuse(k + "_needs_admission", "grant.%s is present, so requirements.admission must be %r" % (k, LIMITS_NEED))

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

    # the canonical pin (musubi-canonical-v0, 2026-09-26). contract_sha256 is sha256 over canonical bytes, and
    # those bytes are only "canonical" if a second runtime produces the same ones. canonical_v0.mjs is that second
    # runtime and canonical_vectors.json the shared vectors; the two things that could still split the bytes are
    # refused here: a float (its text follows the runtime's float repr; until this morning a finding) and an
    # object key outside printable ASCII (code point order and UTF-16 order can differ above the BMP).
    for path, why, shown in scan_numbers(record):
        if why == "not an integer":
            r.refuse("non_integer_number", "%s is %s (%s); a float has no canonical form here, write a decimal as an "
                                           "integer at a stated scale" % (path, why, shown))
        else:
            r.refuse("unsafe_number", "%s is %s (%s)" % (path, why, shown))
    for path, key in scan_keys(record):
        r.refuse("key_not_printable_ascii", "%s carries key %r; keys are printable ASCII so that every runtime sorts "
                                            "them the same way" % (path, key))

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
             "delegation": {"allowed": []}, "data_access": ["public_endpoint"], "max_hops": 1, "privacy": "no_external_retention"}
    establishes = ["that both parties signed these grant bytes",
                   "that each party named the grant it accepted"]
    does_not_establish = [
        "that HS enforced any of this at runtime",
        "that the contractor obeyed the grant, only that its recorded acts match or deviate from it",
        "that HS judges liability or fault; the verdict is a function anyone recomputes",
        "that a prohibited action was impossible, only that performing one is a provable deviation",
        "that this is a legal contract or determines legal responsibility",
        "when either signature was produced; agreed_at is the declared drafting time, not a proven signing time",
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

    # every other axis a child could widen (Issue #25, 2026-09-25), and the door that closes key shadowing
    parent_g = {"authorized_actions": ["read", "write"], "prohibited_actions": ["delete"],
                "conditional": [{"action": "write", "requires": "principal_approval"}],
                "delegation": {"allowed": ["a.example"]}, "expiry_height": 1000,
                "revocation": {"effective_at": "anchor"}, "approval_policy": {"allow_unscoped": False}}
    same = json.loads(json.dumps(parent_g)); same["delegation"] = {"allowed": ["a.example"]}
    assert grant_subset(same, parent_g) == [], grant_subset(same, parent_g)
    def widen(**kv):
        g = json.loads(json.dumps(parent_g)); g.update(kv); return grant_subset(g, parent_g)
    cases = {
        "delegation.allowed":    widen(delegation={"allowed": ["a.example", "anyone.example"]}),
        "dropped condition":     widen(conditional=[]),
        "changed requirement":   widen(conditional=[{"action": "write", "requires": "none"}]),
        "conditional-only act":  widen(conditional=parent_g["conditional"] + [{"action": "payment", "requires": "x"}]),
        "expiry extended":       widen(expiry_height=9999),
        "expiry dropped":        widen(expiry_height=None),
        "revocation loosened":   widen(revocation={"effective_at": "delivery_ack", "ack_window": 50}),
        "unscoped approvals":    widen(approval_policy={"allow_unscoped": True}),
    }
    # ninth axis (2026-09-25, reported on Issue #25 after v1.6): omitting max_hops must not launder the limit.
    # A allows 2 hops; B omits the key; C under B asks for 50. The chain has to break at B.
    a_g = {"authorized_actions": ["read", "write"], "prohibited_actions": ["delete"], "max_hops": 2}
    b_g = {"authorized_actions": ["read"], "prohibited_actions": ["delete"]}
    cases["max_hops omitted"] = grant_subset(b_g, a_g)
    assert grant_subset(dict(b_g, max_hops=1), a_g) == [], grant_subset(dict(b_g, max_hops=1), a_g)   # parent-1: within
    assert grant_subset(dict(b_g, max_hops=5), a_g), "max_hops 5 under a 2-hop parent passed"          # still caught
    assert grant_subset(dict(b_g, max_hops=50), dict(b_g, max_hops=1)), "50 hops under a 1-hop parent passed"
    for name, viol in cases.items():
        assert viol, "child widened %s but grant_subset saw nothing" % name
    narrower = widen(conditional=[], prohibited_actions=["delete", "write"])   # prohibiting a conditional action narrows
    assert narrower == [], narrower
    bad3 = json.loads(json.dumps(rec)); bad3["grant"]["authorized_prohibited"] = ["harmless"]
    out3 = verify_contract(bad3)
    assert out3["verdict"] == "refused" and any(x["code"] == "grant_key_unknown" for x in out3["refusals"]), out3
    print("[7] grant_subset closes every widening axis (%d cases), prohibiting a conditional action still narrows; "
          "verify_contract refuses an undeclared grant key (authorized_prohibited)" % len(cases))

    # [8] the three keys grant_subset did not compare (Issue #25 items 10 to 12, reported 2026-09-26 by the
    # first outside verifier): finality floor, witness keys, revocation mode. Plus privacy and ordering, which
    # were in GRANT_KEYS with no reader: held equal until an order exists. Seven widenings from the report, each
    # of which passed with zero violations at 25422d34, must now fail; the narrowings must still pass.
    wk1 = base64.b64encode(bytes(range(32))).decode()
    wk2 = base64.b64encode(bytes(range(32, 64))).decode()
    p8 = {"authorized_actions": ["read", "write"], "prohibited_actions": ["delete"],
          "delegation": {"allowed": ["b.example"]}, "max_hops": 1,
          "finality": {"depth": 6, "max_target_bits": "1d00ffff"},
          "witnesses": [{"name": "nenrin-walker", "public_key_ed25519_b64": wk1}],
          "revocation": {"effective_at": "delivery_ack", "ack_window": 10},
          "approval_policy": {"allow_unscoped": False}, "privacy": "public_record", "ordering": {"same_height": "conservative"}}
    b8 = json.loads(json.dumps(p8)); b8["max_hops"] = 0
    assert grant_subset(b8, p8) == [], grant_subset(b8, p8)
    def w8(**kv):
        g = json.loads(json.dumps(b8))
        for k, val in kv.items():
            if val is None: g.pop(k, None)
            else: g[k] = val
        return grant_subset(g, p8)
    widened = {
        "finality depth 6->0":       w8(finality={"depth": 0, "max_target_bits": "1d00ffff"}),
        "finality target ->207fffff": w8(finality={"depth": 6, "max_target_bits": "207fffff"}),
        "finality dropped":          w8(finality=None),
        "witness swapped (same name, other key)": w8(witnesses=[{"name": "nenrin-walker", "public_key_ed25519_b64": wk2}]),
        "witnesses emptied":         w8(witnesses=[]),
        "revocation -> 'manual'":    w8(revocation={"effective_at": "manual"}),
        "revocation -> 'x', window 10**9": w8(revocation={"effective_at": "x", "ack_window": 10 ** 9}),
        "privacy changed":           w8(privacy="private"),
        "ordering changed":          w8(ordering={"same_height": None}),
    }
    for name, viol in widened.items():
        assert viol, "child widened %s but grant_subset saw nothing" % name
    narrowed = {
        "finality harder (depth 8, target 1c00ffff)": w8(finality={"depth": 8, "max_target_bits": "1c00ffff"}),
        "witness added (superset)":  w8(witnesses=p8["witnesses"] + [{"name": "second", "public_key_ed25519_b64": wk2}]),
        "revocation -> anchor under delivery_ack parent": w8(revocation={"effective_at": "anchor"}),
        "ack_window 5 under 10":     w8(revocation={"effective_at": "delivery_ack", "ack_window": 5}),
    }
    for name, viol in narrowed.items():
        assert viol == [], "child narrowed %s but grant_subset flagged it: %s" % (name, viol)
    assert bits_to_target(0x1c00ffff) < bits_to_target(0x1d00ffff) < bits_to_target(0x207fffff)
    # the door: verify_contract refuses a revocation mode no settle layer reads (delivery_ack without a window is
    # settle_v1_4's ack_window_missing, left there so its [H5] regression keeps demonstrating v1.3's veto hole)
    bad8 = json.loads(json.dumps(rec)); bad8["grant"]["revocation"] = {"effective_at": "manual"}
    out8 = verify_contract(bad8)
    assert out8["verdict"] == "refused" and any(x["code"] == "revocation_mode_unknown" for x in out8["refusals"]), out8
    print("[8] finality floor, witness keys, revocation mode, privacy, ordering: %d widenings caught, %d narrowings pass; "
          "verify_contract refuses a revocation mode no settle layer reads" % (len(widened), len(narrowed)))

    # [9] the type door (Issue #25 round 3, reported 2026-09-26 by the first outside verifier). His eight rows: a
    # two-party-signed parent whose limit is the wrong JSON type was accepted, the child under it was accepted, and
    # the identical child under the well-typed parent was refused. All eight widened at 2f07f267. Now the malformed
    # parent is refused at verify, and grant_subset reports the axis unreadable instead of skipping it.
    def signed9(g, parent=None):
        c9 = build_contract(principal, contractor, task, g, establishes, does_not_establish,
                            parent_contract={"contract_id": parent["contract_id"]} if parent else None,
                            lower_bound={"kind": "bitcoin_block", "height": 968325, "hash": "0" * 64})
        sign_contract(c9, ka, pa, "gate.horizonshield.dev"); sign_contract(c9, kb, pb, "api.babyblueviper.com")
        return c9
    base9 = {"authorized_actions": ["read"], "prohibited_actions": ["delete"]}
    rows = [  # (label, malformed parent axis, child axis, well-typed control parent axis)
        ("max_hops as string",        {"max_hops": "1"},                 {"max_hops": 50},            {"max_hops": 1}),
        ("max_hops as float",         {"max_hops": 1.0},                 {"max_hops": 50},            {"max_hops": 1}),
        ("max_hops as bool",          {"max_hops": True},                {"max_hops": 50},            {"max_hops": 1}),
        ("expiry_height as float",    {"expiry_height": 1000.0},         {"expiry_height": 9999},     {"expiry_height": 1000}),
        ("expiry_height as string",   {"expiry_height": "1000"},         {},                          {"expiry_height": 1000}),
        ("finality.depth as string",  {"finality": {"depth": "6"}},      {"finality": {"depth": 1}},  {"finality": {"depth": 6}}),
        ("max_target_bits uppercase", {"finality": {"depth": 6, "max_target_bits": "1D00FFFF"}},
                                      {"finality": {"depth": 6, "max_target_bits": "207fffff"}},
                                      {"finality": {"depth": 6, "max_target_bits": "1d00ffff"}}),
        ("data_access as string",     {"data_access": "db"},             {"data_access": ["d", "b"]}, {"data_access": ["db"]}),
    ]
    for label, pax, cax, ctl in rows:
        parent9 = signed9(dict(base9, **pax)); child9 = signed9(dict(base9, **cax), parent9)
        pv = verify_contract(parent9)
        assert pv["verdict"] == "refused" and any(x["code"] == "grant_type" for x in pv["refusals"]), (label, pv)
        assert grant_subset(child9["grant"], parent9["grant"]), (label, "grant_subset skipped the unreadable axis")
        cparent = signed9(dict(base9, **ctl)); cchild = signed9(dict(base9, **cax), cparent)
        assert verify_contract(cparent)["verdict"] == "accepted", (label, "control parent refused")
        assert verify_contract(cchild, cparent)["verdict"] == "refused", (label, "control child accepted")
    # the other axes the readers type: each wrong type is refused, each right type is accepted
    typed = [
        ({"delegation": "none"}, {"delegation": {"allowed": []}}),
        ({"delegation": {"allowed": "a.example"}}, {"delegation": {"allowed": ["a.example"]}}),
        ({"conditional": [{"action": "write"}, {"action": "write", "requires": "x"}]}, {"conditional": [{"action": "write", "requires": "x"}]}),
        ({"conditional": [{"requires": "x"}]}, {"conditional": []}),
        ({"witnesses": [{"name": "w", "public_key_ed25519_b64": "not-a-key"}]}, {"witnesses": [{"name": "w", "public_key_ed25519_b64": wk1}]}),
        ({"witnesses": [{"public_key_ed25519_b64": wk1}]}, {"witnesses": []}),
        ({"privacy": 1}, {"privacy": "public_record"}),
        ({"ordering": "strict"}, {"ordering": {"same_height": "conservative"}}),
        ({"approval_policy": {"allow_unscoped": "no"}}, {"approval_policy": {"allow_unscoped": False}}),
        ({"revocation": {"effective_at": "delivery_ack", "ack_window": "6"}}, {"revocation": {"effective_at": "delivery_ack", "ack_window": 6}}),
        ({"revocation": {"effective_at": "anchor", "grace": 1}}, {"revocation": {"effective_at": "anchor"}}),
        ({"finality": {"depth": 6, "max_target_bits": "00800000"}}, {"finality": {"depth": 6, "max_target_bits": "17080000"}}),
        ({"max_hops": -1}, {"max_hops": 0}),
        ({"authorized_actions": ["read", 5]}, {"authorized_actions": ["read"]}),
    ]
    for wrong, right in typed:
        vw = verify_contract(signed9(dict(base9, **wrong)))
        assert vw["verdict"] == "refused" and any(x["code"] == "grant_type" for x in vw["refusals"]), (wrong, vw)
        vr = verify_contract(signed9(dict(base9, **right)))
        assert vr["verdict"] == "accepted", (right, vr)
    # the filed contract is well-typed on every axis and still verifies
    here = os.path.dirname(os.path.abspath(__file__))
    filed_path = os.path.join(here, "first_contract_AB.json")
    if os.path.exists(filed_path):
        filed = parse_strict(open(filed_path, encoding="utf-8").read())
        fv = verify_contract(filed)
        assert fv["verdict"] == "accepted", fv
        filed_note = "; filed contract %s... still accepted" % fv["contract_sha256"][:8]
    else:
        filed_note = ""
    print("[9] type door: %d malformed parents from the report refused at verify and unreadable to grant_subset, their well-typed controls "
          "accepted; %d further wrong types refused, each right type accepted%s" % (len(rows), len(typed), filed_note))

    # [10] the canonical pin: the fixed vectors hash the same in this runtime as when they were recorded, and, when
    # node is present, canonical_v0.mjs produces byte-identical canonical text for every one of them. A float or a
    # non-ASCII key in a contract is refused, the two inputs that could split the bytes between runtimes.
    vecs = parse_strict(open(CANONICAL_VECTORS, encoding="utf-8").read())["vectors"]
    for vec in vecs:
        got = sha256_hex(canonical(vec["value"]))
        assert got == vec["sha256"], ("vector drifted", vec["name"], got)
    twin_note = "node absent, twin not run"
    import shutil, subprocess
    node = shutil.which("node")
    if node:
        for vec in vecs:
            # ensure_ascii: the twin's input may carry a lone surrogate (rule 7), which UTF-8 cannot write raw
            rr = subprocess.run([node, CANONICAL_TWIN], input=json.dumps(vec["value"], ensure_ascii=True).encode("ascii"),
                                capture_output=True, timeout=30)
            assert rr.returncode == 0, (vec["name"], rr.stderr.decode()[-300:])
            assert rr.stdout == canonical(vec["value"]).encode("utf-8"), ("twin differs", vec["name"], rr.stdout[:120])
        twin_note = "node twin byte-identical on all %d" % len(vecs)
    fl = json.loads(json.dumps(rec)); fl["bond"] = {"amount": 1000.5, "currency": "JPY"}
    ofl = verify_contract(fl)
    assert ofl["verdict"] == "refused" and any(x["code"] == "non_integer_number" for x in ofl["refusals"]), ofl
    nk = json.loads(json.dumps(rec)); nk["task"]["備考"] = "x"
    onk = verify_contract(nk)
    assert onk["verdict"] == "refused" and any(x["code"] == "key_not_printable_ascii" for x in onk["refusals"]), onk
    assert scan_keys({"a": {"bé": 1}, "c": [{"\t": 2}], "ok": {"x y": 1}}) == [("$.a", "bé"), ("$.c[0]", "\t")]
    ls = json.loads(json.dumps(rec)); ls["task"]["note"] = "\ud800"
    ols = verify_contract(ls)
    assert "contract_sha256" in ols and ols["contract_sha256"] == contract_sha256(ls), ols   # rule 7: hashed, not crashed
    print("[10] canonical pin: %d vectors recompute; %s; a float (bond.amount 1000.5) and a non-ASCII key are refused; a lone surrogate in a value is written \\udxxx and hashed" % (len(vecs), twin_note))

    # [9b] grant.limits (2026-10-10): typed at the door, only with requirements.admission, and a child may only lower it.
    # Counted with the type door, not as an eleventh check: settle_v1_6.py is published, is not edited, and its self
    # test looks for "10 checks" in this file's last line.
    def lim_contract(limits, requirements, g_over=None):
        g = dict(grant, authorized_actions=["read", "observe", "emit_nenrin", "pay"], limits=limits)
        g.update(g_over or {})
        c = build_contract(principal, contractor, task, g, establishes, does_not_establish, requirements=requirements)
        sign_contract(c, ka, pa, principal["domain"]); sign_contract(c, kb, pb, contractor["domain"])
        return verify_contract(c)
    need = {"evidence": "nenrin_required", "recovery": "tsugi_required", "admission": LIMITS_NEED}
    codes = lambda o: sorted({x["code"] for x in o["refusals"]})
    L = {"pay": {"max_amount": 100000, "unit": "JPY"}}
    assert lim_contract(L, need)["verdict"] == "accepted"
    assert lim_contract({"spend": {"max_amount": 5, "unit": "JPY"}}, need)["verdict"] == "accepted"      # a conditional action may carry one
    assert codes(lim_contract(L, None)) == ["limits_need_admission"]
    assert codes(lim_contract({}, None)) == ["limits_need_admission"]
    assert codes(lim_contract(L, {"evidence": "nenrin_required", "admission": "optional"})) == ["limits_need_admission"]
    wrong = [{"pay": 100000}, {"pay": {"max_amount": "100000", "unit": "JPY"}}, {"pay": {"max_amount": True, "unit": "JPY"}},
             {"pay": {"max_amount": 0, "unit": "JPY"}}, {"pay": {"max_amount": -1, "unit": "JPY"}}, {"pay": {"max_amount": 100000}},
             {"pay": {"max_amount": 100000, "unit": ""}}, {"pay": {"max_amount": 100000, "unit": "JPY", "per": "day"}},
             {"transfer": {"max_amount": 1, "unit": "JPY"}}, {"payment": {"max_amount": 1, "unit": "JPY"}}, [], "100000"]
    for bad_l in wrong:
        o = lim_contract(bad_l, need)
        assert o["verdict"] == "refused" and "grant_type" in codes(o), (bad_l, o)
        assert grant_subset({"authorized_actions": []}, {"authorized_actions": ["pay"], "limits": bad_l}) != [], bad_l
    par = {"authorized_actions": ["pay", "read"], "limits": L}
    sub = lambda **k: grant_subset(dict({"authorized_actions": ["pay"]}, **k), par)
    assert sub(limits={"pay": {"max_amount": 100000, "unit": "JPY"}}) == [] and sub(limits={"pay": {"max_amount": 1, "unit": "JPY"}}) == []
    assert any("no limit" in x for x in sub()) and any("above parent" in x for x in sub(limits={"pay": {"max_amount": 100001, "unit": "JPY"}}))
    assert any("unit" in x for x in sub(limits={"pay": {"max_amount": 1, "unit": "USD"}}))
    assert grant_subset({"authorized_actions": ["read"]}, par) == []                                     # the action is dropped: narrower
    assert grant_subset({"authorized_actions": [], "prohibited_actions": ["pay"]}, par) == []
    assert grant_subset({"authorized_actions": ["read"], "limits": {"read": {"max_amount": 5, "unit": "JPY"}}}, par) == []   # a new limit narrows
    cnd = grant_subset({"authorized_actions": [], "conditional": [{"action": "pay", "requires": "x"}]}, par)
    assert any("no limit" in x for x in cnd), cnd
    for name in ("first_contract_AB.json", "second_contract_AB.json"):
        pub = parse_strict(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), name), encoding="utf-8").read())
        assert "limits" not in pub["grant"] and verify_contract(pub) == {"schema": "a2a-contract-verify-v0", "contract_sha256": contract_sha256(pub), "verdict": "accepted", "refusals": [], "findings": []}, name
    print("[9b] grant.limits: accepted with requirements.admission, refused without it (limits_need_admission); %d wrong shapes refused at the "
          "type door and unreadable to grant_subset; a child may lower a limit, never raise it, drop it or change its unit; the two "
          "published contracts carry no limits and verify as before" % len(wrong))

    # [9c] grant.payload_schema and grant.exposure (2026-11-09): typed at the door, only with requirements.admission, a child
    # may only narrow them, and payload_problems refuses a payload outside the schema. Counted with the type door, like [9b].
    PS = {"schema": PAYLOAD_SCHEMA, "other_fields": "refuse", "fields": {
        "kind": {"type": "enum", "values": ["a", "b", "c"], "required": True},
        "amount": {"type": "integer", "min": 1, "max": 1000, "required": True},
        "ref": {"type": "token", "max_chars": 8, "required": False}}}
    EX = {"pay": {"window_blocks": 144, "max_acts": 4}}
    def ps_contract(g_over, requirements=need):
        g = dict(grant, authorized_actions=["read", "observe", "emit_nenrin", "pay"], limits=L)
        g.update(g_over)
        c = build_contract(principal, contractor, task, g, establishes, does_not_establish, requirements=requirements)
        sign_contract(c, ka, pa, principal["domain"]); sign_contract(c, kb, pb, contractor["domain"])
        return c
    ok_c = ps_contract({"payload_schema": {"pay": PS}, "exposure": EX})
    assert verify_contract(ok_c)["verdict"] == "accepted", verify_contract(ok_c)
    assert codes(verify_contract(ps_contract({"payload_schema": {"pay": PS}}, requirements=None))) == ["limits_need_admission", "payload_schema_needs_admission"]
    assert codes(verify_contract(ps_contract({"exposure": EX, "limits": None}, requirements=None))) == ["exposure_needs_admission"]
    def F(**kv):
        s = json.loads(json.dumps(PS)); s["fields"]["amount"] = dict(s["fields"]["amount"], **kv); return s
    wrong_ps = [[], {"pay": None}, {"pay": dict(PS, other_fields="accept")}, {"pay": dict(PS, schema="payload-schema-v1")},
                {"pay": dict(PS, extra=1)}, {"pay": dict(PS, fields={})}, {"pay": dict(PS, fields={"1bad": {"type": "text", "max_chars": 4, "required": False}})},
                {"pay": F(min=5, max=4)}, {"pay": F(min=1.5)}, {"pay": F(required="yes")}, {"pay": F(type="float")}, {"pay": F(note="x")},
                {"pay": dict(PS, fields={"t": {"type": "token", "max_chars": 257, "required": False}})},
                {"pay": dict(PS, fields={"t": {"type": "text", "max_chars": 0, "required": False}})},
                {"pay": dict(PS, fields={"e": {"type": "enum", "values": ["a", "a"], "required": True}})},
                {"pay": dict(PS, fields={"e": {"type": "enum", "values": ["a"], "required": True, "values_from": {"path": "x", "sha256": "0" * 63, "pointer": "/"}}})},
                {"ship": PS}]
    for bad_ps in wrong_ps:
        o = verify_contract(ps_contract({"payload_schema": bad_ps}))
        assert o["verdict"] == "refused" and "grant_type" in codes(o), (bad_ps, o)
    wrong_ex = [[], {"pay": {"window_blocks": 0, "max_acts": 1}}, {"pay": {"window_blocks": 4321, "max_acts": 1}}, {"pay": {"window_blocks": 6, "max_acts": 0}},
                {"pay": {"window_blocks": 6, "max_acts": True}}, {"pay": {"window_blocks": "6", "max_acts": 1}}, {"pay": {"window_blocks": 6, "max_acts": 1, "per": "day"}},
                {"ship": {"window_blocks": 6, "max_acts": 1}}]
    for bad_ex in wrong_ex:
        o = verify_contract(ps_contract({"exposure": bad_ex}))
        assert o["verdict"] == "refused" and "grant_type" in codes(o), (bad_ex, o)
    pg = {"authorized_actions": ["pay", "read"], "payload_schema": {"pay": PS}, "exposure": EX}
    sub = lambda **k: grant_subset(dict({"authorized_actions": ["pay"]}, **k), pg)
    narrow = json.loads(json.dumps(PS)); narrow["fields"]["kind"]["values"] = ["a"]; narrow["fields"]["amount"]["max"] = 20; narrow["fields"]["ref"]["required"] = True
    assert sub(payload_schema={"pay": PS}, exposure=EX) == [] and sub(payload_schema={"pay": narrow}, exposure={"pay": {"window_blocks": 288, "max_acts": 1}}) == []
    del narrow["fields"]["ref"]
    assert sub(payload_schema={"pay": narrow}, exposure=EX) == []                                       # an optional field dropped: narrower
    widen_ps = [dict(PS, fields=dict(PS["fields"], note={"type": "text", "max_chars": 4, "required": False})), F(max=1001),
                dict(PS, fields={k: v for k, v in PS["fields"].items() if k != "amount"}), F(type="token", max_chars=4, min=None, max=None)]
    widen_ps[3]["fields"]["amount"] = {"type": "token", "max_chars": 4, "required": True}
    for w in widen_ps:
        assert len(sub(payload_schema={"pay": w}, exposure=EX)) == 1, w
    assert len(sub(exposure=EX)) == 1 and len(sub(payload_schema={"pay": PS})) == 1
    for w in ({"window_blocks": 144, "max_acts": 5}, {"window_blocks": 143, "max_acts": 4}, {"window_blocks": 6, "max_acts": 1}):
        assert len(sub(payload_schema={"pay": PS}, exposure={"pay": w})) == 1, w
    assert grant_subset({"authorized_actions": ["read"]}, pg) == [] and grant_subset({"authorized_actions": [], "prohibited_actions": ["pay"]}, pg) == []
    pp = lambda p: payload_problems(ok_c, "pay", p)
    assert pp({"kind": "a", "amount": 20}) == [] and pp({"kind": "b", "amount": 1000, "ref": "x-1.Y_2"}) == []
    assert pp({"kind": "a", "amount": 20, "note": "hello"}) == ["payload_field_unknown"] and pp({"kind": "a"}) == ["payload_field_missing"]
    assert pp({"kind": "z", "amount": 20}) == ["payload_field_value"] and pp({"kind": "a", "amount": 1001}) == ["payload_field_value"]
    assert pp({"kind": "a", "amount": True}) == ["payload_field_value"] and pp({"kind": "a", "amount": 20, "ref": "a b"}) == ["payload_field_value"]
    assert pp({"kind": "a", "amount": 20, "ref": "123456789"}) == ["payload_field_value"] and pp([]) == ["payload_not_object"]
    assert payload_problems(ok_c, "read", {"anything": 1}) == [] and payload_problems(rec, "read", "x") == []
    assert payload_problems({"grant": {"payload_schema": {"pay": {}}}}, "pay", {}) == ["payload_schema_unreadable"]
    assert open_fields(PS) == [] and open_fields(widen_ps[0]) == ["note"]
    print("[9c] grant.payload_schema and grant.exposure: accepted with requirements.admission, refused without it; %d wrong schemas and %d "
          "wrong exposures refused at the type door; a child may narrow them, never widen or drop them (%d widenings); a payload "
          "outside the schema is refused by payload_problems" % (len(wrong_ps), len(wrong_ex), len(widen_ps) + 5))

    print("\nSELF-TEST PASSED: MUSUBI a2a-contract-v0, 10 checks (build, sign, verify, tamper, overclaim, settle, delegation on every axis, finality, witness and revocation floors, grant key door, grant type door with grant.limits, canonical pin)")


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
