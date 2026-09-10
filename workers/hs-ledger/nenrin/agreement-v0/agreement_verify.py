#!/usr/bin/env python3
"""Offline verifier for agreement records.

Two schemas, one program.

  a2a-agreement-v1     the draft anchored as JIDEC entry 39 (ops/AGREEMENT_EXT_v0_DRAFT.md).
                       Read exactly as written. Its holes are named, not silently repaired,
                       because the draft's sha is anchored and quotable.
  a2a-agreement-v1.1   ops/AGREEMENT_EXT_v0_1_DRAFT.md. Every hole found while building this
                       verifier, closed. Strict by construction: the record carries its own
                       public keys, so it verifies offline forever, and every string, number,
                       size and shape in it is bounded.

What a record says: at time T, party A and party B both signed the same bytes describing terms,
and each pointed at a conduct record, by sha256, about the other. This program judges the SHAPE
and the SIGNATURES. It never judges the terms, and there is no editorial step anywhere in it.

What it deliberately does not do
  No network. It does not fetch key_url, the agent cards, the conduct records, or a ledger.
  Under v1.1 the keys are inside the signed bytes, so nothing needs fetching to verify. Under
  v1 the keys are supplied locally with --keys. Reachability is the intake's problem (503,
  retry), not a verifier's.

Fail closed
  The verdict is never "accepted" unless an Ed25519 verification actually ran and passed for
  both parties. A verifier that says accepted without that launders a one sided record into a
  two sided claim. The report always carries signatures_checked and key_urls_checked, and the
  establishes list changes with them: what a record proves is not the same question as whether
  it was refused.

Usage
  python3 agreement_verify.py RECORD.json [--keys keys.json] [--recorder-domain D] [--now ISO]
  python3 agreement_verify.py --example        # a v1.1 template
  python3 agreement_verify.py --example-v1     # the v1 template

  keys.json maps key_url to the Ed25519 public key served there:
    {"https://party-a.example/keys/agreement.json": {"public_key_ed25519_b64": "..."}}
  A bare string value is accepted too.

Exit codes: 0 accepted, 1 refused, 2 incomplete (shape passed, signatures not checked).
"""

import argparse
import base64
import hashlib
import json
import re
import sys

SCHEMA_V1 = "a2a-agreement-v1"
SCHEMA_V11 = "a2a-agreement-v1.1"
SCHEMAS = (SCHEMA_V1, SCHEMA_V11)
# v1.1 signs a context prefix. Under v1 the only thing separating an agreement signature from
# any other Ed25519 signature by the same key is the schema field happening to be in the bytes.
CONTEXT = {SCHEMA_V1: b"", SCHEMA_V11: b"a2a-agreement-v1.1\n"}

REPORT_SCHEMA = "a2a-agreement-verify-v0"
VERIFIER_VERSION = "0.2.0"
DRAFT = {SCHEMA_V1: "ops/AGREEMENT_EXT_v0_DRAFT.md", SCHEMA_V11: "ops/AGREEMENT_EXT_v0_1_DRAFT.md"}

SAFE_INT_MAX = 2 ** 53 - 1
# A record of this schema is four levels deep. A hostile one can be ten thousand, and every
# recursive reader (this one, json.dumps, most canonicalizers) dies on it with a traceback
# rather than a refusal. A verifier that crashes has not refused anything.
MAX_DEPTH = 32
MAX_NODES = 20000
MAX_STRING = 4096
MAX_BYTES = {SCHEMA_V1: 65536, SCHEMA_V11: 16384}
MAX_ARRAY = 64

ROLES = ("payer", "payee", "peer")
PAID_BY_WORDS = ("both", "neither", "third_party")
PAID_BY_V1 = ("party_a", "party_b") + PAID_BY_WORDS
FEE_BASES_OK = ("flat", "per_record", "subscription", "none")
FEE_BASES_BAD = ("percent_of_amount", "percent", "share_of_amount", "success_fee", "commission",
                 "basis_points", "per_mille", "share_of_savings")

# Codes the v1 draft names in section 4. Anything outside this set is an extension found while
# building the verifier; v1.1 adopts them. Every refusal reports which it is.
DRAFT_CODES = frozenset([
    "one_sided", "signatures_disagree", "self_agreement", "bad_key_url",
    "key_url_unreachable", "missing_conduct_sha", "disclaimer_missing", "fee_tied_to_outcome",
])

# An establishes[] line may not claim any of these. The record proves that two keys signed the
# same bytes. It does not prove that anything happened afterwards.
OVERCLAIM = [
    (r"\bperformed\b", "performance"),
    (r"\bdeliver(ed|y)\b", "delivery"),
    (r"\bmoney (moved|was sent)\b", "movement of money"),
    (r"\bfunds? (moved|were sent|were transferred)\b", "movement of funds"),
    (r"\bpaid\b(?!\s+for\s+(this|the)\s+record)", "payment"),
    (r"\bpayment (was|has been) (made|completed|settled|received)\b", "payment"),
    (r"\bcontract\b", "formation of a contract"),
    (r"\bbinding\b", "legal effect"),
    (r"\bguarantee", "a guarantee"),
    (r"\bescrow\b", "custody"),
    (r"\bcustody\b", "custody"),
    (r"\bsolvent\b", "solvency"),
    (r"\blawful\b", "lawfulness"),
    (r"\bfair\b", "fairness"),
    (r"\bcertified\b", "certification"),
]

# v1.1: what does_not_establish must actually cover, by subject.
REQUIRED_DNE = [
    ("performance", ("perform",)),
    ("that this is not a contract", ("contract",)),
    ("that money moved", ("money", "payment", "paid")),
    ("the accuracy of the conduct records", ("conduct record",)),
]


def canonical(obj):
    """Canonical bytes as in conduct-v1 section 4: UTF-8, keys sorted at every level,
    separators , and : with no spaces, non-ASCII unescaped."""
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_hex(b):
    if isinstance(b, str):
        b = b.encode("utf-8")
    return hashlib.sha256(b).hexdigest()


def _no_duplicate_keys(pairs):
    seen = set()
    for k, _v in pairs:
        if k in seen:
            raise ValueError("duplicate key in JSON object: %s" % k)
        seen.add(k)
    return dict(pairs)


def parse_strict(text):
    """json.loads keeps the LAST of two identical keys and says nothing. A record carrying
    "amount" twice would then canonicalize to a number the person who read it never saw."""
    return json.loads(text, object_pairs_hook=_no_duplicate_keys)


def schema_of(record):
    s = record.get("schema") if isinstance(record, dict) else None
    return s if s in SCHEMAS else None


def signing_bytes(record, schema=None):
    """The bytes a party signs: the record without its signatures, canonical, with the schema's
    context prefix in front of it."""
    if schema is None:
        schema = schema_of(record) or SCHEMA_V1
    body = {k: v for k, v in record.items() if k != "signatures"}
    return CONTEXT.get(schema, b"") + canonical(body).encode("utf-8")


# --- host and domain rules ----------------------------------------------------------------

_LABEL = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?$")


def norm_domain(d):
    """Bare hostname, lowercase, trailing dot removed. Returns None if it is not one."""
    if not isinstance(d, str) or not d:
        return None
    s = d.strip().lower().rstrip(".")
    if not s or "/" in s or "@" in s or ":" in s or " " in s:
        return None
    labels = s.split(".")
    if len(labels) < 2:
        return None
    for lab in labels:
        if not lab or not _LABEL.match(lab):
            return None
    return s


def host_of_https(u):
    """Host of an https URL, lowercase. None when the URL is not https or is unparseable."""
    if not isinstance(u, str):
        return None
    m = re.match(r"^https://([^/?#\s@]+)(?:[/?#].*)?$", u.strip())
    if not m:
        return None
    host = m.group(1).split(":")[0].lower().rstrip(".")
    return host or None


def under_domain(host, domain):
    return host == domain or (host or "").endswith("." + domain)


def parent_two(domain):
    parts = domain.split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else domain


# --- shape, text and number safety ---------------------------------------------------------

def measure(root):
    """Max depth, node count and self reference, iteratively. Runs before anything else,
    because canonicalizing an unbounded shape is how a reader dies instead of answering."""
    depth = 0
    nodes = 0
    seen = set()
    stack = [(root, 1)]
    while stack:
        node, d = stack.pop()
        nodes += 1
        if d > depth:
            depth = d
        if isinstance(node, (dict, list)):
            if id(node) in seen:
                return depth, nodes, True
            seen.add(id(node))
            if d >= MAX_DEPTH or nodes > MAX_NODES:
                return depth, nodes, False
            for v in (node.values() if isinstance(node, dict) else node):
                stack.append((v, d + 1))
    return depth, nodes, False


_CONTROL = re.compile(r"[\x00-\x08\x0a-\x1f\x7f]")


def scan_text(root):
    """Strings that cannot be canonicalized, or that a terminal would obey. A lone surrogate is
    valid JSON, survives json.loads, and then kills UTF-8 encoding: found by fuzzing this file
    on 2026-09-10. Control characters are refused because a record is printed into terminals and
    logs, and an escape sequence in a domain name is not a domain name."""
    out = []
    stack = [(root, "$")]
    while stack:
        node, p = stack.pop()
        if isinstance(node, str):
            for ch in node:
                if 0xD800 <= ord(ch) <= 0xDFFF:
                    out.append((p, "carries a lone surrogate (U+%04X), which is not encodable as UTF-8" % ord(ch)))
                    break
            if _CONTROL.search(node):
                out.append((p, "carries a control character"))
            if len(node) > MAX_STRING:
                out.append((p, "is %d characters; the limit is %d" % (len(node), MAX_STRING)))
        elif isinstance(node, dict):
            for k in sorted(node.keys(), reverse=True):
                if isinstance(k, str):
                    stack.append((k, p + ".<key>"))
                stack.append((node[k], p + "." + str(k)))
        elif isinstance(node, list):
            if len(node) > MAX_ARRAY:
                out.append((p, "has %d entries; the limit is %d" % (len(node), MAX_ARRAY)))
            for i in range(min(len(node), MAX_ARRAY + 1) - 1, -1, -1):
                stack.append((node[i], p + "[%d]" % i))
    out.sort()
    return out


def scan_numbers(root, path="$"):
    """Numbers a second implementer might not reproduce. The line condition 07 draws on the
    surfaces the gate measures, and the gate draws on its own verdict since 0.4.2. Iterative,
    so that the shape of the input cannot decide whether this program answers at all."""
    out = []
    stack = [(root, path)]
    while stack:
        node, p = stack.pop()
        if isinstance(node, bool):
            continue
        if isinstance(node, int):
            if abs(node) > SAFE_INT_MAX:
                out.append((p, "integer outside the RFC 7493 safe range", str(node)))
        elif isinstance(node, float):
            if node != node or node in (float("inf"), float("-inf")):
                out.append((p, "not a finite number", repr(node)))
            else:
                out.append((p, "not an integer", repr(node)))
        elif isinstance(node, dict):
            for k in sorted(node.keys(), reverse=True):
                stack.append((node[k], p + "." + str(k)))
        elif isinstance(node, list):
            for i in range(len(node) - 1, -1, -1):
                stack.append((node[i], p + "[%d]" % i))
    out.sort()
    return out


# --- Ed25519 key hygiene, in pure python so it needs no library and no network ----------------
# A public key of small order makes one signature verify under many messages. Rejecting it is
# not paranoia: it is the difference between "this key signed this" and "some key accepted it".

_P25519 = 2 ** 255 - 19
_L25519 = 2 ** 252 + 27742317777372353535851937790883648493
_D25519 = (-121665 * pow(121666, _P25519 - 2, _P25519)) % _P25519
_I25519 = pow(2, (_P25519 - 1) // 4, _P25519)
_IDENTITY = (0, 1)


def _xrecover(y):
    xx = (y * y - 1) * pow(_D25519 * y * y + 1, _P25519 - 2, _P25519) % _P25519
    x = pow(xx, (_P25519 + 3) // 8, _P25519)
    if (x * x - xx) % _P25519 != 0:
        x = (x * _I25519) % _P25519
    if (x * x - xx) % _P25519 != 0:
        return None
    return x


def _decode_point(raw):
    if len(raw) != 32:
        return None
    n = int.from_bytes(raw, "little")
    sign = n >> 255
    y = n & ((1 << 255) - 1)
    if y >= _P25519:
        return None          # a non canonical encoding of a point
    x = _xrecover(y)
    if x is None:
        return None
    if x & 1 != sign:
        x = (_P25519 - x) % _P25519
    if x == 0 and sign == 1:
        return None          # the other non canonical encoding
    if (-x * x + y * y - 1 - _D25519 * x * x * y * y) % _P25519 != 0:
        return None
    return (x, y)


def _pt_ext(point):
    x, y = point
    return (x % _P25519, y % _P25519, 1, x * y % _P25519)


_EXT_IDENTITY = (0, 1, 1, 0)


def _ext_add(p, q):
    """Extended coordinates, a = -1. No modular inversion inside the loop: with one inversion
    per addition this check took long enough to be skipped, and a check that is skipped is not
    a check."""
    x1, y1, z1, t1 = p
    x2, y2, z2, t2 = q
    a = (y1 - x1) * (y2 - x2) % _P25519
    b = (y1 + x1) * (y2 + x2) % _P25519
    c = t1 * 2 * _D25519 * t2 % _P25519
    d = z1 * 2 * z2 % _P25519
    e = b - a
    f = d - c
    g = d + c
    h = b + a
    return (e * f % _P25519, g * h % _P25519, f * g % _P25519, e * h % _P25519)


def _ext_is_identity(p):
    x, y, z, _t = p
    return x % _P25519 == 0 and (y - z) % _P25519 == 0


def _scalarmult(point, e):
    result = _EXT_IDENTITY
    addend = _pt_ext(point)
    while e:
        if e & 1:
            result = _ext_add(result, addend)
        addend = _ext_add(addend, addend)
        e >>= 1
    return result


_KEY_CACHE = {}


def public_key_problem(raw):
    """None when the key is a point of prime order L. A reason otherwise. A public key of small
    order makes one signature verify under many messages, which is the difference between
    "this key signed this" and "some key accepted it"."""
    if not isinstance(raw, bytes):
        return "is not 32 bytes"
    hit = _KEY_CACHE.get(raw)
    if hit is not None:
        return hit[0]
    point = _decode_point(raw)
    if point is None:
        why = "is not a canonical encoding of a point on curve25519"
    elif point == _IDENTITY:
        why = "is the identity element, under which forged signatures verify"
    elif not _ext_is_identity(_scalarmult(point, _L25519)):
        why = "is not in the prime order subgroup (a small order or mixed order point)"
    else:
        why = None
    if len(_KEY_CACHE) < 4096:
        _KEY_CACHE[raw] = (why,)
    return why


def b64_raw(s, want_len):
    """Decode base64 that must be canonical and of an exact length. Returns bytes or None."""
    if not isinstance(s, str) or not s:
        return None
    try:
        raw = base64.b64decode(s, validate=True)
    except Exception:
        return None
    if len(raw) != want_len:
        return None
    if base64.b64encode(raw).decode("ascii") != s:
        return None          # trailing bits set, or padding written another way
    return raw


# --- keys ---------------------------------------------------------------------------------

def load_keys(path):
    with open(path, "r", encoding="utf-8") as f:
        raw = parse_strict(f.read())
    if not isinstance(raw, dict):
        raise SystemExit("--keys must be a JSON object mapping key_url to a public key")
    out = {}
    for url, val in raw.items():
        if isinstance(val, str):
            out[url] = val
        elif isinstance(val, dict) and isinstance(val.get("public_key_ed25519_b64"), str):
            out[url] = val["public_key_ed25519_b64"]
        else:
            raise SystemExit("--keys entry for %s must be a b64 string or {public_key_ed25519_b64}" % url)
    return out


def ed25519_verify(pub_b64, sig_b64, message):
    """True / False, or None when the key or the signature is not usable at all."""
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        from cryptography.exceptions import InvalidSignature
    except Exception:
        raise SystemExit("checking signatures needs the cryptography package: pip install cryptography")
    raw_pub = b64_raw(pub_b64, 32)
    raw_sig = b64_raw(sig_b64, 64)
    if raw_pub is None or raw_sig is None:
        return None
    if public_key_problem(raw_pub) is not None:
        return None
    try:
        Ed25519PublicKey.from_public_bytes(raw_pub).verify(raw_sig, message)
        return True
    except InvalidSignature:
        return False
    except Exception:
        return None


# --- the verifier ---------------------------------------------------------------------------

class Report(object):
    def __init__(self):
        self.refusals = []
        self.findings = []
        self.seen = set()

    def refuse(self, code, why):
        if (code, why) in self.seen:
            return
        self.seen.add((code, why))
        self.refusals.append({"code": code, "why": why, "in_draft": code in DRAFT_CODES})

    def find(self, code, why):
        if (code, why) in self.seen:
            return
        self.seen.add((code, why))
        self.findings.append({"code": code, "why": why})


def _early(r, input_text, est, dne):
    return {
        "schema": REPORT_SCHEMA, "verifier_version": VERIFIER_VERSION, "record_schema": None,
        "draft": None, "verdict": "refused", "signatures_checked": False, "key_urls_checked": False,
        "refusals": r.refusals, "findings": r.findings,
        "canonical_sha256": None, "signing_sha256": None,
        "input_sha256": sha256_hex(input_text) if input_text is not None else None,
        "input_is_canonical": None, "establishes": est, "does_not_establish": dne,
    }


def verify(record, keys=None, recorder_domain=None, now=None, input_text=None):
    r = Report()

    # 1. shape, before anything touches the content
    if not isinstance(record, dict):
        r.refuse("bad_json", "the record must be a JSON object")
        return _early(r, input_text,
                      ["that this input was refused before any field was read"],
                      ["anything at all about any party, term or signature"])

    depth, nodes, cyclic = measure(record)
    if cyclic or depth >= MAX_DEPTH or nodes > MAX_NODES:
        why = ("the record refers to itself" if cyclic else
               "the record is %d levels deep and holds %d nodes; the limits are %d and %d"
               % (depth, nodes, MAX_DEPTH, MAX_NODES))
        r.refuse("too_deep", why + ". Refused without canonicalizing it, because a reader that recurses would die here instead of answering")
        return _early(r, input_text,
                      ["that this record was refused for its shape alone, before any field was read"],
                      ["anything at all about the parties, the terms or the signatures"])

    bad_text = scan_text(record)
    if bad_text:
        for p, why in bad_text[:8]:
            r.refuse("bad_text", "%s %s" % (p, why))
        return _early(r, input_text,
                      ["that this record was refused for its text alone, before any field was read"],
                      ["anything at all about the parties, the terms or the signatures"])

    schema = schema_of(record)
    strict = schema == SCHEMA_V11
    if schema is None:
        r.refuse("bad_schema", "schema must be one of %s, found %r" % (", ".join(SCHEMAS), record.get("schema")))
    can = canonical(record)
    limit = MAX_BYTES.get(schema or SCHEMA_V1)
    if len(can.encode("utf-8")) > limit:
        r.refuse("too_large", "the canonical record is %d bytes; the limit for %s is %d"
                 % (len(can.encode("utf-8")), schema or "an unknown schema", limit))
        return _early(r, input_text,
                      ["that this record was refused for its size alone"],
                      ["anything at all about the parties, the terms or the signatures"])

    # 2. numbers: a value destroyed at parse time makes every later check meaningless
    for path, why, shown in scan_numbers(record):
        in_terms = path.startswith("$.terms") or path.startswith("$.recorder")
        if why == "not an integer" and not in_terms:
            r.find("non_integer_number", "%s is %s (%s); a reader that prints a fixed number of digits will not reproduce these bytes" % (path, why, shown))
        else:
            r.refuse("unsafe_number", "%s is %s (%s)" % (path, why, shown))

    # 3. canonical form
    if input_text is not None and input_text.strip() != can:
        if strict:
            r.refuse("not_canonical", "the bytes handed to this verifier are not the canonical bytes; under v1.1 a record travels in canonical form so that the sha an anchor carries is the sha you hold")
        else:
            r.find("not_canonical", "the bytes handed to this verifier are not the canonical bytes; canonical_sha256 is what an anchor would carry, input_sha256 is what you have")

    # 4. identity of this agreement (v1.1)
    if strict:
        aid = record.get("agreement_id")
        if not (isinstance(aid, str) and re.match(r"^[0-9a-f]{32}$", aid)):
            r.refuse("bad_agreement_id", "agreement_id must be 32 lowercase hex characters chosen at random by the parties, found %r; without it two honest agreements with identical terms in the same second are one record" % (aid,))

    # 5. agreed_at
    at = record.get("agreed_at")
    pattern = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$" if strict else r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$"
    if not isinstance(at, str) or not re.match(pattern, at):
        r.refuse("bad_agreed_at", "agreed_at must be an ISO-8601 UTC instant%s, found %r"
                 % (" of the form YYYY-MM-DDTHH:MM:SSZ" if strict else " ending in Z", at))
    elif now and at > now:
        r.find("agreed_at_in_future", "agreed_at (%s) is later than the time given to this verifier (%s); it is a claim by the parties, and the anchor is what bounds it from above" % (at, now))

    lb = record.get("lower_bound")
    if lb is not None:
        if not isinstance(lb, dict) or lb.get("kind") != "bitcoin_block" \
                or not isinstance(lb.get("height"), int) or isinstance(lb.get("height"), bool) \
                or not (isinstance(lb.get("hash"), str) and re.match(r"^[0-9a-f]{64}$", lb["hash"])):
            r.refuse("bad_lower_bound", "lower_bound, when present, must be {kind: bitcoin_block, height: integer, hash: 64 lowercase hex}")

    # 6. parties
    parties = record.get("parties")
    if not isinstance(parties, list) or len(parties) != 2:
        r.refuse("not_two_parties", "parties must be exactly two objects, found %s"
                 % (len(parties) if isinstance(parties, list) else type(parties).__name__))
        parties = [p for p in parties if isinstance(p, dict)] if isinstance(parties, list) else []
    doms = []
    pubs = []
    for i, p in enumerate(parties):
        tag = "parties[%d]" % i
        if not isinstance(p, dict):
            r.refuse("bad_party", "%s is not an object" % tag)
            continue
        d = norm_domain(p.get("domain"))
        if not d:
            r.refuse("bad_domain", "%s.domain must be a bare hostname, found %r" % (tag, p.get("domain")))
        else:
            doms.append(d)
            if any(lab.startswith("xn--") for lab in d.split(".")):
                r.find("punycode_domain", "%s.domain %s is an internationalised name; two such names can look alike and this verifier compares bytes, not glyphs" % (tag, d))
        ku = p.get("key_url")
        kh = host_of_https(ku)
        if not kh:
            r.refuse("bad_key_url", "%s.key_url must be an https URL, found %r" % (tag, ku))
        elif d and not under_domain(kh, d):
            r.refuse("bad_key_url", "%s.key_url host %s is not under that party's own domain %s" % (tag, kh, d))
        for req, why in (("agent_card", "the card this party presented"),):
            if not isinstance(p.get(req), str) or not host_of_https(p.get(req)):
                r.refuse("missing_field", "%s.%s must be an https URL (%s)" % (tag, req, why))
        if strict:
            pk = p.get("public_key_ed25519_b64")
            raw = b64_raw(pk, 32) if isinstance(pk, str) else None
            if raw is None:
                r.refuse("bad_public_key", "%s.public_key_ed25519_b64 must be 32 bytes of canonical base64; under v1.1 the key lives inside the signed bytes so the record verifies offline forever, whatever the key_url serves next year" % tag)
            else:
                problem = public_key_problem(raw)
                if problem:
                    r.refuse("bad_public_key", "%s.public_key_ed25519_b64 %s" % (tag, problem))
                else:
                    pubs.append(pk)
            cs = p.get("agent_card_sha256")
            if not (isinstance(cs, str) and re.match(r"^[0-9a-f]{64}$", cs)):
                r.refuse("bad_card_sha", "%s.agent_card_sha256 must be 64 lowercase hex; a card named by URL alone can be rewritten after the fact" % tag)
            cr = p.get("conduct_record")
            if not isinstance(cr, dict):
                r.refuse("missing_conduct_sha", "%s.conduct_record must be an object {sha256, url, subject_domain, measured_by_domain}" % tag)
            else:
                sha = cr.get("sha256")
                if sha is None or sha == "":
                    r.refuse("missing_conduct_sha", "%s presented no conduct record; an agreement record without a conduct record on each side is half of the point" % tag)
                elif not (isinstance(sha, str) and re.match(r"^[0-9a-f]{64}$", sha)):
                    r.refuse("bad_conduct_sha", "%s.conduct_record.sha256 must be 64 lowercase hex characters, found %r" % (tag, sha))
                if not host_of_https(cr.get("url")):
                    r.refuse("missing_field", "%s.conduct_record.url must be an https URL" % tag)
                if not norm_domain(cr.get("subject_domain")):
                    r.refuse("bad_domain", "%s.conduct_record.subject_domain must be a bare hostname" % tag)
                if not norm_domain(cr.get("measured_by_domain")):
                    r.refuse("bad_domain", "%s.conduct_record.measured_by_domain must be a bare hostname" % tag)
                if cr.get("self_measured") is not None and not isinstance(cr.get("self_measured"), bool):
                    r.refuse("missing_field", "%s.conduct_record.self_measured, when present, must be true or false" % tag)
        else:
            sha = p.get("conduct_record_sha256")
            if sha is None or sha == "":
                r.refuse("missing_conduct_sha", "%s presented no conduct record; an agreement record without a conduct record on each side is half of the point" % tag)
            elif not (isinstance(sha, str) and re.match(r"^[0-9a-f]{64}$", sha)):
                r.refuse("bad_conduct_sha", "%s.conduct_record_sha256 must be 64 lowercase hex characters, found %r" % (tag, sha))
            if not isinstance(p.get("conduct_record_url"), str) or not p.get("conduct_record_url"):
                r.refuse("missing_field", "%s.conduct_record_url is required" % tag)
        role = p.get("role")
        if role not in ROLES:
            r.refuse("bad_role", "%s.role must be one of %s, found %r" % (tag, ", ".join(ROLES), role))

    roles = [p.get("role") for p in parties if isinstance(p, dict)]
    payer = payee = None
    if len(doms) == 2:
        a, b = doms
        if a == b:
            r.refuse("self_agreement", "both parties are %s; one party cannot agree with itself" % a)
        elif under_domain(a, b) or under_domain(b, a):
            r.refuse("self_agreement", "%s and %s are the same domain, one a subdomain of the other" % (a, b))
        elif parent_two(a) == parent_two(b):
            r.find("shared_parent_domain", "%s and %s share the parent %s; this verifier does not resolve registrable domains offline (no public suffix list) and does not refuse on that alone" % (a, b, parent_two(a)))
        if all(x in ROLES for x in roles) and len(roles) == 2:
            if sorted(roles) == ["payee", "payer"]:
                payer = doms[roles.index("payer")]
                payee = doms[roles.index("payee")]
            elif roles != ["peer", "peer"]:
                r.refuse("roles_inconsistent", "roles must be payer with payee, or peer with peer, found %s" % (" and ".join(str(x) for x in roles)))
    if len(pubs) == 2 and pubs[0] == pubs[1]:
        r.refuse("same_public_key", "both parties present the same public key; two domains holding one key is one party wearing two names")

    # 6b. whose conduct is pinned (v1.1 answers a question v1 asks two ways)
    if strict and len(doms) == 2 and len(parties) == 2:
        for i, p in enumerate(parties):
            if not isinstance(p, dict):
                continue
            cr = p.get("conduct_record")
            if not isinstance(cr, dict):
                continue
            mine = norm_domain(p.get("domain"))
            other = doms[1 - i] if len(doms) == 2 and mine == doms[i] else None
            subj = norm_domain(cr.get("subject_domain"))
            meas = norm_domain(cr.get("measured_by_domain"))
            if subj and other and not under_domain(subj, other):
                r.refuse("conduct_subject_wrong", "parties[%d] presented a conduct record about %s; each party pins the COUNTERPARTY's conduct, so the subject must be %s or a host under it" % (i, subj, other))
            if meas and mine and (under_domain(meas, mine) or (other and under_domain(meas, other))):
                if cr.get("self_measured") is True:
                    r.find("conduct_self_measured", "parties[%d] pins a conduct record written by %s, which is one of the two parties; declared, so it is recorded rather than refused, and this record does not establish that the conduct was measured by anybody other than the parties" % (i, meas))
                else:
                    r.refuse("conduct_self_measured_undeclared", "parties[%d] pins a conduct record written by %s, which is one of the two parties. A party measuring itself or its counterparty is permitted only when the record says so (conduct_record.self_measured true), because it changes what the record proves" % (i, meas))
        shas = []
        for p in parties:
            cr = p.get("conduct_record") if isinstance(p, dict) else None
            shas.append(cr.get("sha256") if isinstance(cr, dict) else None)
        if len(shas) == 2 and shas[0] and shas[0] == shas[1]:
            r.find("same_conduct_record", "both parties presented the same conduct record %s; the point of the field is one record per side" % str(shas[0])[:12])
    elif not strict and len(parties) == 2:
        shas = [p.get("conduct_record_sha256") for p in parties if isinstance(p, dict)]
        if len(shas) == 2 and shas[0] and shas[0] == shas[1]:
            r.find("same_conduct_record", "both parties presented the same conduct record %s; the point of the field is the counterparty's conduct as written by somebody other than the party presenting it" % str(shas[0])[:12])

    # 7. terms: presence and shape only. The content is not judged by anyone in this layer.
    terms = record.get("terms")
    if not isinstance(terms, dict):
        r.refuse("missing_field", "terms must be an object")
    elif strict:
        if not isinstance(terms.get("what"), str) or not terms.get("what"):
            r.refuse("missing_field", "terms.what is required")
        if not host_of_https(terms.get("disclosure_url")):
            r.refuse("missing_field", "terms.disclosure_url must be an https URL")
        # Not every agreement has a price. Two parties agreeing on a FACT owe each other nothing,
        # and v1 had no way to say so: the money fields were unconditional, so a reader had to
        # infer the absence of a price from missing keys. State it.
        cons = terms.get("consideration")
        if cons not in ("money", "none"):
            r.refuse("bad_consideration", 'terms.consideration must be "money" or "none"; an agreement with no price must say it has none rather than leave the fields out and let a reader guess')
        money_here = [k for k in ("currency", "amount_minor_units", "minor_unit_scale", "fee_basis")
                      if terms.get(k) is not None]
        wpw = terms.get("who_pays_whom")
        if cons == "money":
            if not (payer and payee):
                r.refuse("terms_contradict_roles", "consideration is money, so the two roles must be payer and payee")
            cur = terms.get("currency")
            if not (isinstance(cur, str) and re.match(r"^[A-Z]{3}$", cur)):
                r.refuse("bad_currency", "terms.currency must be three upper case letters (ISO 4217), found %r" % (cur,))
            amt = terms.get("amount_minor_units")
            scale = terms.get("minor_unit_scale")
            if amt is None and not terms.get("fee_basis"):
                r.refuse("missing_field", "terms needs amount_minor_units or fee_basis")
            if amt is not None:
                if isinstance(amt, bool) or not isinstance(amt, int) or amt < 0:
                    r.refuse("bad_amount", "terms.amount_minor_units must be a non negative integer in the currency's minor units; a price written as a double is a price two runtimes print differently")
                if isinstance(scale, bool) or not isinstance(scale, int) or not 0 <= scale <= 4:
                    r.refuse("bad_amount", "terms.minor_unit_scale must be an integer 0 to 4; without it 100 is both one hundred yen and one yen")
            if not isinstance(wpw, dict) or (payer and payee and (norm_domain(wpw.get("from")) != payer or norm_domain(wpw.get("to")) != payee)):
                r.refuse("terms_contradict_roles", "terms.who_pays_whom must be {from: %s, to: %s} to match the roles; prose that disagrees with the roles is two records in one" % (payer, payee))
        elif cons == "none":
            if roles != ["peer", "peer"]:
                r.refuse("terms_contradict_roles", "consideration is none, so neither party is a payer; both roles must be peer")
            if money_here:
                r.refuse("terms_contradict_roles", "consideration is none, and terms still carries %s. A record may not say both" % ", ".join(money_here))
            if wpw is not None:
                r.refuse("terms_contradict_roles", "consideration is none names no payer, so terms.who_pays_whom must be absent")
    else:
        for req in ("what", "who_pays_whom", "currency", "disclosure_url"):
            if not isinstance(terms.get(req), str) or not terms.get(req):
                r.refuse("missing_field", "terms.%s is required" % req)
        if terms.get("amount") is None and not terms.get("fee_basis"):
            r.refuse("missing_field", "terms needs amount or fee_basis")

    # 8. who is paid for the record, and who recorded it
    fee = None
    if strict:
        rec = record.get("recorder")
        if not isinstance(rec, dict):
            r.refuse("bad_recorder", "recorder is required under v1.1: {domain, is_a_party, fee}. A record whose recorder is unnamed cannot be checked for an interest in what it records")
        else:
            rdom = norm_domain(rec.get("domain"))
            if not rdom:
                r.refuse("bad_recorder", "recorder.domain must be a bare hostname")
            is_party = rec.get("is_a_party")
            if not isinstance(is_party, bool):
                r.refuse("bad_recorder", "recorder.is_a_party must be true or false")
            actually = bool(rdom) and any(under_domain(rdom, d) or under_domain(d, rdom) for d in doms)
            if isinstance(is_party, bool) and actually != is_party:
                r.refuse("recorder_undisclosed", "recorder.is_a_party says %s, but recorder.domain %s %s one of the parties. A recorder that is also a party has an interest in what it records, and that belongs in the signed bytes" % (str(is_party).lower(), rdom, "is" if actually else "is not"))
            if actually and is_party is True:
                r.find("operator_is_a_party", "the recorder %s is a party to this agreement; declared inside the signed bytes, so a reader sees it without trusting a policy page" % rdom)
            fee = rec.get("fee")
            if not isinstance(fee, dict) or not isinstance(fee.get("basis"), str):
                r.refuse("bad_recorder", "recorder.fee must be an object with a basis")
    else:
        fee = record.get("recorder_fee")

    if isinstance(fee, dict) and isinstance(fee.get("basis"), str):
        basis = fee["basis"]
        if basis in FEE_BASES_BAD:
            r.refuse("fee_tied_to_outcome", "the recorder fee basis %r varies with the deal; the recorder must not be paid more when the number is bigger" % basis)
        elif basis not in FEE_BASES_OK:
            r.refuse("fee_tied_to_outcome", "the recorder fee basis %r is not one of the bases that are independent of the deal (%s)" % (basis, ", ".join(FEE_BASES_OK)))
        elif basis == "none" and fee.get("amount_minor_units") not in (None, 0) and fee.get("amount") not in (None, 0):
            r.refuse("bad_recorder", "a fee basis of none may not carry an amount")
    elif fee is not None and not isinstance(fee, dict):
        r.refuse("missing_field", "the recorder fee must be an object with a basis")

    paid = record.get("record_paid_by")
    if strict:
        if not (paid in PAID_BY_WORDS or (isinstance(paid, str) and norm_domain(paid) in doms)):
            r.refuse("bad_record_paid_by", "record_paid_by must name a party's domain or be one of %s, found %r; v1's party_a and party_b are positions in an array, and reordering the array reverses who paid" % (", ".join(PAID_BY_WORDS), paid))
    else:
        if paid not in PAID_BY_V1:
            r.refuse("bad_record_paid_by", "record_paid_by must be one of %s, found %r" % (", ".join(PAID_BY_V1), paid))
        elif paid in ("party_a", "party_b"):
            r.find("paid_by_positional", "record_paid_by names a position in the parties array, so a reader that reorders parties silently reverses who paid; naming the domain would not have that property")

    if record.get("upstream") is not None:
        u = record.get("upstream")
        if not isinstance(u, dict) or not isinstance(u.get("protocol"), str) or not isinstance(u.get("reference"), str):
            r.refuse("missing_field", "upstream, when present, must be {protocol, reference}")
        else:
            r.find("upstream_unverified", "upstream names %s %s as declared; nothing in this layer checked it" % (u["protocol"], u["reference"]))

    # 9. what the record says it proves
    est, dne = record.get("establishes"), record.get("does_not_establish")
    ok_arr = lambda x: isinstance(x, list) and len(x) > 0 and all(isinstance(s, str) and s.strip() for s in x)
    if not ok_arr(est) or not ok_arr(dne):
        r.refuse("disclaimer_missing", "establishes and does_not_establish are both required and neither may be empty")
    else:
        blob = " ".join(est).lower()
        for pat, what in OVERCLAIM:
            if re.search(pat, blob):
                r.refuse("establishes_overclaims", "establishes claims %s; this record proves that two keys signed the same bytes at a time bounded from above by a Bitcoin block, and nothing more" % what)
                break
        low = " ".join(dne).lower()
        if strict:
            missing = [name for name, needles in REQUIRED_DNE if not any(n in low for n in needles)]
            if missing:
                r.refuse("disclaimer_incomplete", "does_not_establish must cover: %s" % "; ".join(missing))
        elif len(dne) < 3 or ("perform" not in low and "contract" not in low):
            r.find("disclaimer_thin", "does_not_establish should say at least that neither party performed and that this is not a contract")

    # 10. signatures
    sigs = record.get("signatures")
    if not isinstance(sigs, list) or len(sigs) < 2:
        r.refuse("one_sided", "a record needs two signatures; found %s. A one sided receipt is not an agreement"
                 % (len(sigs) if isinstance(sigs, list) else "none"))
        sigs = sigs if isinstance(sigs, list) else []
    elif len(sigs) > 2:
        r.refuse("extra_signatures", "signatures must be exactly two, found %d" % len(sigs))

    sig_doms = []
    for i, s in enumerate(sigs):
        tag = "signatures[%d]" % i
        if not isinstance(s, dict):
            r.refuse("bad_signature", "%s is not an object" % tag)
            continue
        d = norm_domain(s.get("domain"))
        if not d:
            r.refuse("bad_domain", "%s.domain must be a bare hostname, found %r" % (tag, s.get("domain")))
            continue
        sig_doms.append(d)
        if s.get("alg") != "ed25519":
            r.refuse("bad_signature", "%s.alg must be ed25519, found %r" % (tag, s.get("alg")))
        if b64_raw(s.get("signature"), 64) is None:
            r.refuse("bad_signature", "%s.signature must be 64 bytes of canonical base64" % tag)
        party = None
        for p in parties:
            if isinstance(p, dict) and norm_domain(p.get("domain")) == d:
                party = p
                break
        if party is None:
            r.refuse("signature_not_a_party", "%s is signed by %s, which is not one of the two parties; two signatures are not two sides unless they are the two sides" % (tag, d))
            continue
        ku = s.get("key_url")
        if strict:
            if ku is not None:
                r.refuse("signature_key_url_present", "%s carries a key_url. Signatures are removed before signing, so anything in this block is outside the signed bytes and whoever holds the record can swap it. Under v1.1 the key and its URL live in the party entry" % tag)
        elif ku is not None and not isinstance(ku, str):
            r.refuse("bad_key_url", "%s.key_url must be a string, found %s" % (tag, type(ku).__name__))
        elif ku is not None and ku != party.get("key_url"):
            r.refuse("key_url_not_pinned", "%s.key_url (%s) differs from the key_url this party pinned inside the signed bytes (%s); the signature block is outside the signed bytes and whoever holds the record could swap it" % (tag, ku, party.get("key_url")))

    if len(sig_doms) == 2 and sig_doms[0] == sig_doms[1]:
        r.refuse("one_sided", "both signatures are from %s; one side signing twice is one side" % sig_doms[0])

    # 11. the actual cryptography
    checked = False
    urls_checked = False
    per_sig = []
    if sigs and (strict or keys):
        msg = signing_bytes(record, schema)
        results = []
        url_results = []
        for i, s in enumerate(sigs):
            if not isinstance(s, dict):
                continue
            d = norm_domain(s.get("domain")) or "?"
            party = next((p for p in parties if isinstance(p, dict) and norm_domain(p.get("domain")) == d), None)
            if strict:
                pub = party.get("public_key_ed25519_b64") if isinstance(party, dict) else None
                ku = party.get("key_url") if isinstance(party, dict) else None
                if keys is not None and isinstance(ku, str):
                    served = keys.get(ku)
                    if served is None:
                        r.refuse("key_url_unreachable", "no public key was supplied for %s; offline this means the key set handed to the verifier does not contain it, and an intake would answer 503 and retry rather than judge" % ku)
                        url_results.append(False)
                    elif served != pub:
                        r.refuse("key_url_mismatch", "the key served at %s is not the key pinned inside the signed bytes for %s" % (ku, d))
                        url_results.append(False)
                    else:
                        url_results.append(True)
            else:
                ku = s.get("key_url") or (party.get("key_url") if isinstance(party, dict) else None)
                if not isinstance(ku, str):
                    ku = None
                pub = keys.get(ku) if ku else None
                if pub is None:
                    r.refuse("key_url_unreachable", "no public key was supplied for %s; offline this means the key set handed to the verifier does not contain it, and an intake would answer 503 and retry rather than judge" % ku)
                    results.append(None)
                    per_sig.append({"domain": d, "key_url": ku, "result": "no_key"})
                    continue
                if isinstance(party, dict) and party.get("key_url") and ku != party.get("key_url"):
                    r.refuse("key_url_mismatch", "the key checked for %s was not the one pinned in the signed bytes" % d)
                url_results.append(True)
            if not isinstance(pub, str):
                results.append(None)
                per_sig.append({"domain": d, "key_url": ku if isinstance(ku, str) else None, "result": "no_key"})
                continue
            ok = ed25519_verify(pub, s.get("signature") or "", msg)
            results.append(ok)
            per_sig.append({"domain": d, "key_url": ku if isinstance(ku, str) else None,
                            "result": {True: "valid", False: "invalid", None: "unusable"}[ok]})
        decided = [x for x in results if x is not None]
        # checked is DERIVED from the evidence recorded in the report, never set beside it.
        # A flag that can disagree with the list it summarises is a flag that will: found on
        # 2026-09-10 by mutating this file and watching the suite stay green.
        checked = len(per_sig) == 2 and all(e["result"] == "valid" for e in per_sig)
        if decided:
            if any(x is True for x in decided) and any(x is False for x in decided):
                r.refuse("signatures_disagree", "one signature covers these bytes and the other does not; the two parties did not sign the same record")
            elif all(x is False for x in decided):
                r.refuse("signature_invalid", "no signature on this record covers these bytes")
            elif len(decided) < 2:
                r.refuse("one_sided", "only one signature could be checked")
        if any(x is None for x in results):
            r.refuse("bad_signature", "a signature or public key could not be used")
        urls_checked = bool(url_results) and len(url_results) == 2 and all(url_results)

    if recorder_domain and not strict:
        rd = norm_domain(recorder_domain)
        for d in doms:
            if rd and under_domain(d, rd):
                r.find("operator_is_a_party", "the recorder's own domain %s is a party to this agreement; permitted, and disclosed here, because a recorder that is also a party has an interest in what it records" % rd)
                break

    return _report(r, record, schema, checked, urls_checked, per_sig, input_text, can)


def _report(r, record, schema, checked, urls_checked, per_sig, input_text, can):
    verdict = "refused" if r.refusals else ("accepted" if checked else "incomplete")
    self_measured = any(f["code"] == "conduct_self_measured" for f in r.findings)
    dne = [
        "that either party performed, or that money moved",
        "that this record is a contract, or that the terms are lawful, fair or complete",
        "that either party is solvent, competent or honest",
        "that the conduct records named by sha256 are accurate; only that they are the records that were presented",
        "that this record was filed anywhere, or that it is the only one these parties signed",
        "anything about time: the anchor bounds agreed_at from above, and this verifier never saw an anchor",
    ]
    if not urls_checked:
        dne.append("that the key each party signed with is the key it serves at its key_url: no URL was fetched, because this verifier is offline")
    if self_measured:
        dne.append("that the conduct pinned here was measured by anybody other than the two parties: at least one side declared self_measured")
    out = {
        "schema": REPORT_SCHEMA,
        "verifier_version": VERIFIER_VERSION,
        "record_schema": schema,
        "draft": DRAFT.get(schema),
        "verdict": verdict,
        "signatures_checked": checked,
        "key_urls_checked": urls_checked,
        "refusals": r.refusals,
        "findings": r.findings,
        "signatures": per_sig,
        "canonical_sha256": sha256_hex(can),
        "signing_sha256": sha256_hex(signing_bytes(record, schema)) if schema else None,
        "input_sha256": sha256_hex(input_text) if input_text is not None else None,
        "input_is_canonical": (input_text.strip() == can) if input_text is not None else None,
        "establishes": [],
        "does_not_establish": dne,
    }
    if verdict == "accepted":
        out["establishes"] = [
            "two keys, one per party, signed the same canonical bytes, and both Ed25519 signatures verify",
            "each party named a conduct record by sha256 at the moment of signing",
            "the record discloses who paid for this record",
        ]
        if schema == SCHEMA_V11:
            out["establishes"].append("the keys are inside the signed bytes, so this result can be reproduced from the record alone, with no network and no live key server")
            if not self_measured:
                out["establishes"].append("each party pinned the counterparty's conduct as written by somebody other than the two parties")
        if urls_checked:
            out["establishes"].append("each signing key is the key served at that party's own key_url, so the signature is attributable to the domain and not only to the holder of the key")
        lb = record.get("lower_bound") if isinstance(record, dict) else None
        if isinstance(lb, dict) and lb.get("kind") == "bitcoin_block":
            out["establishes"].append("the record names Bitcoin block %s by hash, so it cannot have been written before that block existed; the anchor bounds it from above and this bounds it from below" % lb.get("height"))
    elif verdict == "incomplete":
        out["establishes"] = [
            "the record has the shape its schema requires",
            "no signature was checked, so nothing here says the parties agreed",
        ]
    else:
        out["establishes"] = ["that this record was refused, for the reasons listed, without any editorial step"]
    if input_text is not None and out["input_is_canonical"] is False and not any(f["code"] == "not_canonical" for f in r.findings):
        if not any(x["code"] == "not_canonical" for x in r.refusals):
            out["findings"] = out["findings"] + [{"code": "not_canonical", "why": "the bytes handed to this verifier are not the canonical bytes; canonical_sha256 is what an anchor would carry, input_sha256 is what you have"}]
    return out


ZERO = "0" * 64
ONE = "1" * 64

EXAMPLE_V1 = {
    "schema": SCHEMA_V1,
    "agreed_at": "2026-09-10T00:00:00Z",
    "parties": [
        {"domain": "party-a.example", "key_url": "https://party-a.example/keys/agreement.json",
         "agent_card": "https://party-a.example/.well-known/agent-card.json",
         "conduct_record_sha256": ZERO,
         "conduct_record_url": "https://gate.horizonshield.dev/record/" + ZERO,
         "role": "payer"},
        {"domain": "party-b.example", "key_url": "https://party-b.example/keys/agreement.json",
         "agent_card": "https://party-b.example/.well-known/agent-card.json",
         "conduct_record_sha256": ONE,
         "conduct_record_url": "https://gate.horizonshield.dev/record/" + ONE,
         "role": "payee"},
    ],
    "terms": {"what": "one audit of one estimate", "who_pays_whom": "party-a.example pays party-b.example",
              "amount": 10000, "currency": "JPY", "disclosure_url": "https://party-b.example/pricing"},
    "record_paid_by": "both",
    "recorder_fee": {"basis": "per_record", "amount": 0, "currency": "JPY"},
    "establishes": [
        "that both parties signed these bytes at the stated time",
        "that each party named the other's conduct record by sha256 at that moment",
    ],
    "does_not_establish": [
        "that either party performed",
        "that this record is a contract",
        "that the terms are lawful, fair or complete",
    ],
    "signatures": [],
}

EXAMPLE_V11 = {
    "schema": SCHEMA_V11,
    "agreement_id": "00112233445566778899aabbccddeeff",
    "agreed_at": "2026-09-10T00:00:00Z",
    "parties": [
        {"domain": "party-a.example",
         "key_url": "https://party-a.example/keys/agreement.json",
         "public_key_ed25519_b64": "REPLACE_WITH_PARTY_A_PUBLIC_KEY",
         "agent_card": "https://party-a.example/.well-known/agent-card.json",
         "agent_card_sha256": ZERO,
         "conduct_record": {"sha256": ZERO, "url": "https://gate.horizonshield.dev/record/" + ZERO,
                            "subject_domain": "party-b.example", "measured_by_domain": "gate.example"},
         "role": "payer"},
        {"domain": "party-b.example",
         "key_url": "https://party-b.example/keys/agreement.json",
         "public_key_ed25519_b64": "REPLACE_WITH_PARTY_B_PUBLIC_KEY",
         "agent_card": "https://party-b.example/.well-known/agent-card.json",
         "agent_card_sha256": ONE,
         "conduct_record": {"sha256": ONE, "url": "https://gate.horizonshield.dev/record/" + ONE,
                            "subject_domain": "party-a.example", "measured_by_domain": "gate.example"},
         "role": "payee"},
    ],
    "terms": {"what": "one audit of one estimate", "consideration": "money",
              "who_pays_whom": {"from": "party-a.example", "to": "party-b.example"},
              "amount_minor_units": 10000, "minor_unit_scale": 0, "currency": "JPY",
              "disclosure_url": "https://party-b.example/pricing"},
    "recorder": {"domain": "recorder.example", "is_a_party": False,
                 "fee": {"basis": "per_record", "amount_minor_units": 0, "currency": "JPY"}},
    "record_paid_by": "both",
    "establishes": [
        "that both parties signed these bytes at the stated time",
        "that each party named the counterparty's conduct record by sha256 at that moment",
    ],
    "does_not_establish": [
        "that either party performed",
        "that this record is a contract",
        "that money moved",
        "that the conduct record each side pinned is accurate",
        "that the terms are lawful or complete",
    ],
    "signatures": [],
}
EXAMPLE = EXAMPLE_V11


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("record", nargs="?", help="the agreement record to read")
    ap.add_argument("--keys", default=None, help="JSON file mapping key_url to the public key served there")
    ap.add_argument("--recorder-domain", default=None, help="v1 only: the domain running the intake, so that operator as a party is disclosed")
    ap.add_argument("--now", default=None, help="ISO-8601 UTC instant to compare agreed_at against")
    ap.add_argument("--example", action="store_true", help="print an unsigned v1.1 template and exit")
    ap.add_argument("--example-v1", action="store_true", help="print an unsigned v1 template and exit")
    ap.add_argument("--quiet", action="store_true", help="one line instead of the full report")
    a = ap.parse_args(argv)

    if a.example or a.example_v1:
        print(canonical(EXAMPLE_V1 if a.example_v1 else EXAMPLE_V11))
        return 0
    if not a.record:
        ap.error("a record file is required (or --example)")

    with open(a.record, "r", encoding="utf-8") as f:
        text = f.read()
    try:
        rec = parse_strict(text)
    except RecursionError:
        rec = None
    except ValueError as e:
        print(json.dumps({"schema": REPORT_SCHEMA, "verifier_version": VERIFIER_VERSION,
                          "verdict": "refused", "signatures_checked": False, "key_urls_checked": False,
                          "refusals": [{"code": "duplicate_json_key" if "duplicate key" in str(e) else "bad_json",
                                        "why": str(e), "in_draft": False}],
                          "findings": [], "input_sha256": sha256_hex(text)}, ensure_ascii=False, indent=2))
        return 1
    if rec is None:
        print(json.dumps({"schema": REPORT_SCHEMA, "verifier_version": VERIFIER_VERSION,
                          "verdict": "refused", "signatures_checked": False, "key_urls_checked": False,
                          "refusals": [{"code": "too_deep", "why": "the JSON is nested past what a reader can parse", "in_draft": False}],
                          "findings": [], "input_sha256": sha256_hex(text)}, ensure_ascii=False, indent=2))
        return 1

    keys = load_keys(a.keys) if a.keys else None
    rep = verify(rec, keys=keys, recorder_domain=a.recorder_domain, now=a.now, input_text=text)
    if a.quiet:
        print("%s  refusals=%d findings=%d signatures_checked=%s key_urls_checked=%s  %s" % (
            rep["verdict"], len(rep["refusals"]), len(rep["findings"]),
            rep["signatures_checked"], rep["key_urls_checked"], (rep["canonical_sha256"] or "")[:16]))
    else:
        print(json.dumps(rep, ensure_ascii=False, indent=2))
    return {"accepted": 0, "refused": 1, "incomplete": 2}[rep["verdict"]]


if __name__ == "__main__":
    sys.exit(main())
