#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Closes the second half of the SEP-3004 caller-governance delta-loss replay: the two external
decision digests (auec-authority-delta-c14n-v2_1) are recomputed here, clean room, from the profile
text and the public decision objects, without importing or copying the author's canonicalizer.

decision_to_record_replay.py already showed the derivable half: two genuinely different authority
decisions build the same witnessed record, which projects to the same 298 byte preimage a795c1d9.
The part it could not do was recompute the external digests that prove the two decisions differ.
Mohammed Messaoudene published the references on 2026-09-24:

  source   github.com/mohammedmessaoudene-cmd/AUEC @ f34dd379ad94e05d30b156f82190f593b7f0532d
           experimental/mcp-composition/authority-delta-reviewer-v2_1/
  profile  PROFILE.md: digest over the canonical UTF-8 bytes of `decision`; object keys in unsigned
           UTF-8 byte order; strings NFC without lone surrogates; no duplicate keys, no floats,
           no unsafe integers
  A        vectors/corpus.json, vector BASE_STRUCTURED, record.decision
  B        A with decisionId "decision-20260823-0002", operations {requested [read],
           hostAllowed [read, write], effective [read], denied [], reduced []}, reasonCodes
           [SERVER_ADMITTED]  (oracles/sep3004-current-head-projection.mjs lines 184-187)

This script pins corpus.json by sha256, rebuilds A and B, canonicalizes them with its own code,
and checks four things end to end:
  1. the recomputed digests equal the published ones (and the ones in our fixture)
  2. A and B differ in canonical bytes and in digest
  3. both still intersect to effective [read]
  4. the witnessed record built from each is byte identical and projects to a795c1d9
So the whole chain is re-run, not assumed: different decisions, different digests, same record,
same witness. The caller-governance delta is provably lost at record construction.

Usage: python3 decision_digest_replay.py <path/to/corpus.json> [fixture.json]
"""
import hashlib, json, sys, unicodedata

CORPUS_SHA256 = "9c50ce5e188eced867ebe0d113ca4aab1d606d2c64c9879a7751e92592fe7234"
PUBLISHED_A = "sha256:204bf01669510688a16dddf90e3f8dae45f23c78199e2714e476001b5c2555e0"
PUBLISHED_B = "sha256:fde36a175777bd5e314be69a4f9ba170b70235bf417c5d1720bd67e1ef6010d1"
WITNESS = "a795c1d9"
SAFE_INT = (1 << 53) - 1


# --------------------------------------------------------------------------- clean room c14n
def _no_dupes(pairs):
    seen = set()
    for k, _ in pairs:
        if k in seen:
            raise ValueError("duplicate key %r" % k)
        seen.add(k)
    return dict(pairs)


def _str(s):
    for ch in s:
        if 0xD800 <= ord(ch) <= 0xDFFF:
            raise ValueError("lone surrogate")
    if unicodedata.normalize("NFC", s) != s:
        raise ValueError("string not NFC")
    return json.dumps(s, ensure_ascii=False)


def c14n(v):
    """Written from PROFILE.md: compact JSON, keys in unsigned UTF-8 byte order, UTF-8 output,
    integers only (safe range), strings NFC with no lone surrogates."""
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, float):
        raise ValueError("floating point value")
    if isinstance(v, int):
        if abs(v) > SAFE_INT:
            raise ValueError("unsafe integer")
        return str(v)
    if isinstance(v, str):
        return _str(v)
    if isinstance(v, list):
        return "[" + ",".join(c14n(x) for x in v) + "]"
    if isinstance(v, dict):
        keys = sorted(v, key=lambda k: k.encode("utf-8"))
        return "{" + ",".join(_str(k) + ":" + c14n(v[k]) for k in keys) + "}"
    raise ValueError("unsupported type %s" % type(v).__name__)


def digest(decision):
    return "sha256:" + hashlib.sha256(c14n(decision).encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- witnessed record
# Same projection as sep3004_replay.py / decision_to_record_replay.py (copied verbatim there).
REGISTERED_CG = {"session_id", "invoked_by_principal_id", "purpose_declared", "flagged"}


def protected_view(record):
    r = dict(record)
    r.pop("event_hash", None)
    exts = r.get("extensions")
    if isinstance(exts, dict):
        e = dict(exts)
        cg = e.get("caller-governance")
        if isinstance(cg, dict):
            e["caller-governance"] = {k: v for k, v in cg.items() if k in REGISTERED_CG}
        r["extensions"] = e
    return r


def sep_canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def build_record(decision, template):
    ops = decision["operations"]
    allowed = set(ops.get("hostAllowed") or [])
    eff = [a for a in (ops.get("requested") or []) if a in allowed]
    rec = dict(template)
    rec["outcome"] = "allowed" if "read" in eff else "denied"
    return rec, eff


def main():
    if len(sys.argv) < 2:
        print(__doc__); return 2
    raw = open(sys.argv[1], "rb").read()
    got = hashlib.sha256(raw).hexdigest()
    print("corpus.json sha256:", got, "pinned:", got == CORPUS_SHA256)
    if got != CORPUS_SHA256:
        print("refusing: not the published corpus bytes"); return 1
    corpus = json.loads(raw.decode("utf-8"), object_pairs_hook=_no_dupes)
    base = next(v for v in corpus["vectors"] if v["id"] == "BASE_STRUCTURED")["record"]
    A = json.loads(json.dumps(base["decision"]))
    B = json.loads(json.dumps(base["decision"]))
    B["decisionId"] = "decision-20260823-0002"
    B["operations"] = {"requested": ["read"], "hostAllowed": ["read", "write"], "effective": ["read"],
                       "denied": [], "reduced": []}
    B["reasonCodes"] = ["SERVER_ADMITTED"]

    dA, dB = digest(A), digest(B)
    print()
    print("=== 1. external digests recomputed with our own canonicalizer ===")
    print("A:", dA, " == published:", dA == PUBLISHED_A)
    print("B:", dB, " == published:", dB == PUBLISHED_B)
    print("A canonical bytes:", len(c14n(A).encode()), " B canonical bytes:", len(c14n(B).encode()))
    embedded = base.get("decisionEvidence", {}).get("digest")
    print("A equals the digest embedded in the BASE_STRUCTURED record:", dA == embedded)

    fix_ok = True
    if len(sys.argv) > 2:
        fx = json.load(open(sys.argv[2]))
        fa, fb = fx["decisionA"]["externalDecisionDigest"], fx["decisionB"]["externalDecisionDigest"]
        fix_ok = (fa == dA and fb == dB)
        print("fixture digests match the recomputation:", fix_ok)
        cg = fx["currentRegisteredCallerGovernance"]
        template = {k: v for k, v in cg["recordA"].items() if k not in ("event_hash", "outcome")}
        expected_hash = cg["eventHashA"]
    else:
        template, expected_hash = None, None

    print()
    print("=== 2. the decisions genuinely differ ===")
    differ = c14n(A) != c14n(B) and dA != dB
    print("canonical bytes differ:", c14n(A) != c14n(B), " digests differ:", dA != dB)
    print("fields that differ:", sorted(k for k in set(A) | set(B) if A.get(k) != B.get(k)))

    print()
    print("=== 3. both intersect to the same effective authority ===")
    recA, effA = build_record(A, template or {})
    recB, effB = build_record(B, template or {})
    print("effective(A):", effA, " effective(B):", effB, " same:", effA == effB == ["read"])

    chain_ok = True
    if template is not None:
        print()
        print("=== 4. same witnessed record, same witness ===")
        bA = sep_canonical(protected_view(recA)); hA = hashlib.sha256(bA).hexdigest()
        bB = sep_canonical(protected_view(recB)); hB = hashlib.sha256(bB).hexdigest()
        print("record(A) == record(B):", sep_canonical(recA) == sep_canonical(recB))
        print("event_hash A:", hA, " B:", hB)
        print("both == fixture eventHashA (%s...):" % WITNESS, hA == hB == expected_hash, " preimage bytes:", len(bA))
        chain_ok = sep_canonical(recA) == sep_canonical(recB) and hA == hB == expected_hash and hA.startswith(WITNESS)

    ok = dA == PUBLISHED_A and dB == PUBLISHED_B and differ and effA == effB == ["read"] and fix_ok and chain_ok
    print()
    print("CLOSED (both halves):", ok)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
