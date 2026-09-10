#!/usr/bin/env python3
"""Offline verifier for a2a-agreement-v1 records (draft, ops/AGREEMENT_EXT_v0_DRAFT.md).

What this is
  A record says: at time T, party A and party B both signed the same bytes describing terms,
  and each of them pointed at a conduct record by sha256. This program reads such a record and
  answers accepted / refused / incomplete, with reasons. It judges the SHAPE and the SIGNATURES.
  It never judges the terms, and there is no editorial step anywhere in it.

What it deliberately does not do
  No network. It does not fetch key_url, does not fetch the conduct records, does not look at a
  ledger. Public keys are supplied locally with --keys, which is what makes the answer
  reproducible by anyone holding the same two files. Reachability of key_url is the intake's
  problem (503, retry), not a verifier's.

Fail closed
  With no keys supplied, signatures_checked is false and the verdict is "incomplete", never
  "accepted". A verifier that says accepted without having checked a signature is worse than no
  verifier, because it launders a one sided record into a two sided claim.

Usage
  python3 agreement_verify.py RECORD.json [--keys keys.json] [--recorder-domain D] [--now ISO8601]
  python3 agreement_verify.py --example > draft_agreement.json

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

SCHEMA = "a2a-agreement-v1"
REPORT_SCHEMA = "a2a-agreement-verify-v0"
VERIFIER_VERSION = "0.1.0"
DRAFT = "ops/AGREEMENT_EXT_v0_DRAFT.md"

SAFE_INT_MAX = 2 ** 53 - 1
# A record of this schema is four levels deep. A hostile one can be ten thousand, and every
# recursive reader (this one, json.dumps, most canonicalizers) dies on it with a traceback
# rather than a refusal. A verifier that crashes has not refused anything.
MAX_DEPTH = 32
MAX_NODES = 20000
ROLES = ("payer", "payee", "peer")
PAID_BY = ("party_a", "party_b", "both", "neither", "third_party")

# Codes the draft names in section 4. Anything outside this set is an extension found while
# building the verifier and is listed in the README so that v0.1 of the draft can adopt it.
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


def signing_bytes(record):
    body = {k: v for k, v in record.items() if k != "signatures"}
    return canonical(body).encode("utf-8")


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
    hostport = m.group(1)
    host = hostport.split(":")[0].lower().rstrip(".")
    return host or None


def under_domain(host, domain):
    return host == domain or (host or "").endswith("." + domain)


def parent_two(domain):
    parts = domain.split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else domain


# --- number safety ------------------------------------------------------------------------

def measure(root):
    """Max depth and node count, iteratively. Returns (depth, nodes, cyclic)."""
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
            vals = node.values() if isinstance(node, dict) else node
            for v in vals:
                stack.append((v, d + 1))
    return depth, nodes, False


def scan_numbers(root, path="$"):
    """Numbers a second implementer might not reproduce. Same line condition 07 draws on the
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
    """True / False, or None when the key or the signature is not decodable at all."""
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        from cryptography.exceptions import InvalidSignature
    except Exception:
        raise SystemExit("checking signatures needs the cryptography package: pip install cryptography")
    try:
        pub = Ed25519PublicKey.from_public_bytes(base64.b64decode(pub_b64, validate=True))
        sig = base64.b64decode(sig_b64, validate=True)
    except Exception:
        return None
    try:
        pub.verify(sig, message)
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

    def refuse(self, code, why):
        self.refusals.append({"code": code, "why": why, "in_draft": code in DRAFT_CODES})

    def find(self, code, why):
        self.findings.append({"code": code, "why": why})


def verify(record, keys=None, recorder_domain=None, now=None, input_text=None):
    r = Report()
    checked = False

    if not isinstance(record, dict):
        r.refuse("bad_json", "the record must be a JSON object")
        return _report(r, record, checked, input_text)

    depth, nodes, cyclic = measure(record)
    if cyclic or depth >= MAX_DEPTH or nodes > MAX_NODES:
        why = ("the record refers to itself" if cyclic else
               "the record is %d levels deep and holds %d nodes; the limits are %d and %d" % (depth, nodes, MAX_DEPTH, MAX_NODES))
        r.refuse("too_deep", why + ". Refused without canonicalizing it, because a reader that recurses would die here instead of answering")
        return {
            "schema": REPORT_SCHEMA, "verifier_version": VERIFIER_VERSION, "draft": DRAFT,
            "verdict": "refused", "signatures_checked": False,
            "refusals": r.refusals, "findings": r.findings,
            "canonical_sha256": None, "signing_sha256": None,
            "input_sha256": sha256_hex(input_text) if input_text is not None else None,
            "input_is_canonical": None,
            "establishes": ["that this record was refused for its shape alone, before any field was read"],
            "does_not_establish": ["anything at all about the parties, the terms or the signatures"],
        }

    if record.get("schema") != SCHEMA:
        r.refuse("bad_schema", "schema must be %r, found %r" % (SCHEMA, record.get("schema")))

    # numbers first: a value destroyed at parse time makes every later check meaningless
    for path, why, shown in scan_numbers(record):
        in_terms = path.startswith("$.terms")
        if why == "not an integer" and not in_terms:
            r.find("non_integer_number", "%s is %s (%s); a reader that prints a fixed number of digits will not reproduce these bytes" % (path, why, shown))
        else:
            r.refuse("unsafe_number", "%s is %s (%s)" % (path, why, shown))

    # agreed_at
    at = record.get("agreed_at")
    if not isinstance(at, str) or not re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$", at):
        r.refuse("bad_agreed_at", "agreed_at must be an ISO-8601 UTC instant ending in Z, found %r" % (at,))
    elif now and at > now:
        r.find("agreed_at_in_future", "agreed_at (%s) is later than the time given to this verifier (%s); it is a claim by the parties, and the anchor is what bounds it from above" % (at, now))

    # parties
    parties = record.get("parties")
    doms = []
    if not isinstance(parties, list) or len(parties) != 2:
        r.refuse("not_two_parties", "parties must be exactly two objects, found %s" % (len(parties) if isinstance(parties, list) else type(parties).__name__))
        parties = [p for p in (parties or []) if isinstance(p, dict)] if isinstance(parties, list) else []
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
        ku = p.get("key_url")
        kh = host_of_https(ku)
        if not kh:
            r.refuse("bad_key_url", "%s.key_url must be an https URL, found %r" % (tag, ku))
        elif d and not under_domain(kh, d):
            r.refuse("bad_key_url", "%s.key_url host %s is not under that party's own domain %s" % (tag, kh, d))
        sha = p.get("conduct_record_sha256")
        if sha is None or sha == "":
            r.refuse("missing_conduct_sha", "%s presented no conduct record; an agreement record without a conduct record on each side is half of the point" % tag)
        elif not (isinstance(sha, str) and re.match(r"^[0-9a-f]{64}$", sha)):
            r.refuse("bad_conduct_sha", "%s.conduct_record_sha256 must be 64 lowercase hex characters, found %r" % (tag, sha))
        role = p.get("role")
        if role not in ROLES:
            r.refuse("bad_role", "%s.role must be one of %s, found %r" % (tag, ", ".join(ROLES), role))
        for req in ("agent_card", "conduct_record_url"):
            if not isinstance(p.get(req), str) or not p.get(req):
                r.refuse("missing_field", "%s.%s is required" % (tag, req))

    if len(doms) == 2:
        a, b = doms
        if a == b:
            r.refuse("self_agreement", "both parties are %s; one party cannot agree with itself" % a)
        elif under_domain(a, b) or under_domain(b, a):
            r.refuse("self_agreement", "%s and %s are the same domain, one a subdomain of the other" % (a, b))
        elif parent_two(a) == parent_two(b):
            r.find("shared_parent_domain", "%s and %s share the parent %s; this verifier does not resolve registrable domains offline (no public suffix list) and does not refuse on that alone" % (a, b, parent_two(a)))
        roles = [p.get("role") for p in parties if isinstance(p, dict)]
        if sorted([x for x in roles if x in ROLES]) not in (["payee", "payer"], ["peer", "peer"]):
            if all(x in ROLES for x in roles):
                r.refuse("roles_inconsistent", "roles must be payer with payee, or peer with peer, found %s" % (" and ".join(str(x) for x in roles)))
        shas = [p.get("conduct_record_sha256") for p in parties if isinstance(p, dict)]
        if len(shas) == 2 and shas[0] and shas[0] == shas[1]:
            r.find("same_conduct_record", "both parties presented the same conduct record %s; the point of the field is the counterparty's conduct as written by somebody other than the party presenting it" % shas[0][:12])

    # terms: presence and shape only. The content is not judged by anyone in this layer.
    terms = record.get("terms")
    if not isinstance(terms, dict):
        r.refuse("missing_field", "terms must be an object")
    else:
        for req in ("what", "who_pays_whom", "currency", "disclosure_url"):
            if not isinstance(terms.get(req), str) or not terms.get(req):
                r.refuse("missing_field", "terms.%s is required" % req)
        if terms.get("amount") is None and not terms.get("fee_basis"):
            r.refuse("missing_field", "terms needs amount or fee_basis")

    # recorder_fee: the draft refuses fee_tied_to_outcome but section 3 never defines the field
    # it would be read from. Defined here, optional, and named in the README as a v0.1 gap.
    fee = record.get("recorder_fee")
    if fee is not None:
        if not isinstance(fee, dict) or not isinstance(fee.get("basis"), str):
            r.refuse("missing_field", "recorder_fee must be an object with a basis")
        else:
            basis = fee["basis"]
            if basis in ("percent_of_amount", "percent", "share_of_amount", "success_fee", "commission"):
                r.refuse("fee_tied_to_outcome", "recorder_fee.basis %r varies with the deal; the recorder must not be paid more when the number is bigger" % basis)
            elif basis not in ("flat", "per_record", "none", "subscription"):
                r.refuse("fee_tied_to_outcome", "recorder_fee.basis %r is not one of the bases that are independent of the deal (flat, per_record, subscription, none)" % basis)

    if record.get("record_paid_by") not in PAID_BY:
        r.refuse("bad_record_paid_by", "record_paid_by must be one of %s, found %r" % (", ".join(PAID_BY), record.get("record_paid_by")))
    elif record.get("record_paid_by") in ("party_a", "party_b"):
        r.find("paid_by_positional", "record_paid_by names a position in the parties array, so a reader that reorders parties silently reverses who paid; naming the domain would not have that property")

    if record.get("upstream") is not None:
        u = record.get("upstream")
        if not isinstance(u, dict) or not isinstance(u.get("protocol"), str) or not isinstance(u.get("reference"), str):
            r.refuse("missing_field", "upstream, when present, must be {protocol, reference}")
        else:
            r.find("upstream_unverified", "upstream names %s %s as declared; nothing in this layer checked it" % (u["protocol"], u["reference"]))

    # disclaimers
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
        if len(dne) < 3 or ("perform" not in low and "contract" not in low):
            r.find("disclaimer_thin", "does_not_establish should say at least that neither party performed and that this is not a contract")

    # signatures
    sigs = record.get("signatures")
    if not isinstance(sigs, list) or len(sigs) < 2:
        r.refuse("one_sided", "a record needs two signatures; found %s. A one sided receipt is not an agreement" % (len(sigs) if isinstance(sigs, list) else "none"))
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
        if not isinstance(s.get("signature"), str) or not s.get("signature"):
            r.refuse("bad_signature", "%s.signature is required" % tag)
        party = None
        for p in parties:
            if isinstance(p, dict) and norm_domain(p.get("domain")) == d:
                party = p
                break
        if party is None:
            r.refuse("signature_not_a_party", "%s is signed by %s, which is not one of the two parties; two signatures are not two sides unless they are the two sides" % (tag, d))
            continue
        ku = s.get("key_url")
        if ku is not None and not isinstance(ku, str):
            r.refuse("bad_key_url", "%s.key_url must be a string, found %s" % (tag, type(ku).__name__))
        elif ku is not None and ku != party.get("key_url"):
            r.refuse("key_url_not_pinned", "%s.key_url (%s) differs from the key_url this party pinned inside the signed bytes (%s); the signature block is outside the signed bytes and whoever holds the record could swap it" % (tag, ku, party.get("key_url")))

    if len(sig_doms) == 2 and sig_doms[0] == sig_doms[1]:
        r.refuse("one_sided", "both signatures are from %s; one side signing twice is one side" % sig_doms[0])

    # signature checking: only with keys, and never assumed
    per_sig = []
    if keys and sigs:
        msg = signing_bytes(record)
        results = []
        for i, s in enumerate(sigs):
            if not isinstance(s, dict):
                continue
            d = norm_domain(s.get("domain")) or "?"
            party = next((p for p in parties if isinstance(p, dict) and norm_domain(p.get("domain")) == d), None)
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
            ok = ed25519_verify(pub, s.get("signature") or "", msg)
            results.append(ok)
            per_sig.append({"domain": d, "key_url": ku, "result": {True: "valid", False: "invalid", None: "undecodable"}[ok]})
        decided = [x for x in results if x is not None]
        if decided:
            checked = True
            if any(x is True for x in decided) and any(x is False for x in decided):
                r.refuse("signatures_disagree", "one signature covers these bytes and the other does not; the two parties did not sign the same record")
            elif all(x is False for x in decided):
                r.refuse("signature_invalid", "no signature on this record covers these bytes")
        if any(x is None for x in results):
            r.refuse("bad_signature", "a signature or public key could not be decoded")

    if recorder_domain:
        rd = norm_domain(recorder_domain)
        for d in doms:
            if rd and under_domain(d, rd):
                r.find("operator_is_a_party", "the recorder's own domain %s is a party to this agreement; permitted, and disclosed here, because a recorder that is also a party has an interest in what it records" % rd)
                break

    return _report(r, record, checked, input_text)


def _report(r, record, checked, input_text):
    body = record if isinstance(record, dict) else {}
    can = canonical(body)
    verdict = "refused" if r.refusals else ("accepted" if checked else "incomplete")
    out = {
        "schema": REPORT_SCHEMA,
        "verifier_version": VERIFIER_VERSION,
        "draft": DRAFT,
        "verdict": verdict,
        "signatures_checked": checked,
        "refusals": r.refusals,
        "findings": r.findings,
        "canonical_sha256": sha256_hex(can),
        "signing_sha256": sha256_hex(signing_bytes(body)) if body else None,
        "input_sha256": sha256_hex(input_text) if input_text is not None else None,
        "input_is_canonical": (input_text.strip() == can) if input_text is not None else None,
        "establishes": [],
        "does_not_establish": [
            "that either party performed, or that money moved",
            "that this record is a contract, or that the terms are lawful, fair or complete",
            "that either party is solvent, competent or honest",
            "that the conduct records named by sha256 are accurate; only that they are the records that were presented",
            "that the key at key_url is the one the party serves there: this verifier is offline and was handed the keys",
            "anything about time: the anchor bounds agreed_at from above, and this verifier never saw an anchor",
        ],
    }
    if verdict == "accepted":
        out["establishes"] = [
            "two keys, each pinned inside the signed bytes under its own party's domain, produced valid Ed25519 signatures over the same canonical bytes",
            "each party named a conduct record by sha256 at the moment of signing",
            "the record discloses who paid for this record",
        ]
    elif verdict == "incomplete":
        out["establishes"] = [
            "the record has the shape a2a-agreement-v1 requires",
            "no signature was checked, so nothing here says the parties agreed",
        ]
    else:
        out["establishes"] = ["that this record was refused, for the reasons listed, without any editorial step"]
    if input_text is not None and out["input_is_canonical"] is False:
        out["findings"] = out["findings"] + [{"code": "not_canonical", "why": "the bytes handed to this verifier are not the canonical bytes; canonical_sha256 is what an anchor would carry, input_sha256 is what you have"}]
    return out


EXAMPLE = {
    "schema": SCHEMA,
    "agreed_at": "2026-09-10T00:00:00Z",
    "parties": [
        {"domain": "party-a.example", "key_url": "https://party-a.example/keys/agreement.json",
         "agent_card": "https://party-a.example/.well-known/agent-card.json",
         "conduct_record_sha256": "0" * 64,
         "conduct_record_url": "https://gate.horizonshield.dev/record/" + "0" * 64,
         "role": "payer"},
        {"domain": "party-b.example", "key_url": "https://party-b.example/keys/agreement.json",
         "agent_card": "https://party-b.example/.well-known/agent-card.json",
         "conduct_record_sha256": "1" * 64,
         "conduct_record_url": "https://gate.horizonshield.dev/record/" + "1" * 64,
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


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("record", nargs="?", help="the a2a-agreement-v1 record to read")
    ap.add_argument("--keys", default=None, help="JSON file mapping key_url to the public key served there")
    ap.add_argument("--recorder-domain", default=None, help="the domain running the intake, so that operator as a party is disclosed")
    ap.add_argument("--now", default=None, help="ISO-8601 UTC instant to compare agreed_at against")
    ap.add_argument("--example", action="store_true", help="print an unsigned example record and exit")
    ap.add_argument("--quiet", action="store_true", help="one line instead of the full report")
    a = ap.parse_args(argv)

    if a.example:
        print(canonical(EXAMPLE))
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
        rep = {"schema": REPORT_SCHEMA, "verifier_version": VERIFIER_VERSION, "verdict": "refused",
               "signatures_checked": False,
               "refusals": [{"code": "duplicate_json_key" if "duplicate key" in str(e) else "bad_json",
                             "why": str(e), "in_draft": False}],
               "findings": [], "input_sha256": sha256_hex(text)}
        print(json.dumps(rep, ensure_ascii=False, indent=2))
        return 1
    if rec is None:
        print(json.dumps({"schema": REPORT_SCHEMA, "verifier_version": VERIFIER_VERSION,
                          "verdict": "refused", "signatures_checked": False,
                          "refusals": [{"code": "too_deep", "why": "the JSON is nested past what a reader can parse", "in_draft": False}],
                          "findings": [], "input_sha256": sha256_hex(text)}, ensure_ascii=False, indent=2))
        return 1

    keys = load_keys(a.keys) if a.keys else None
    rep = verify(rec, keys=keys, recorder_domain=a.recorder_domain, now=a.now, input_text=text)
    if a.quiet:
        print("%s  refusals=%d findings=%d signatures_checked=%s  %s" % (
            rep["verdict"], len(rep["refusals"]), len(rep["findings"]),
            rep["signatures_checked"], rep["canonical_sha256"][:16]))
    else:
        print(json.dumps(rep, ensure_ascii=False, indent=2))
    return {"accepted": 0, "refused": 1, "incomplete": 2}[rep["verdict"]]


if __name__ == "__main__":
    sys.exit(main())
