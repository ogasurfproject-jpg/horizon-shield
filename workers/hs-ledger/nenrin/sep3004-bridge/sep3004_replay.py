#!/usr/bin/env python3
# Clean-room independent replay of the SEP-3004 protected-record witness.
# It derives the protected preimage FROM THE SOURCE RECORD using the SEP-3004
# canonicalization rules, then hashes it. It never reads the fixture's own
# protectedCanonicalUtf8 / hex as the source of the answer; those are used only
# to CHECK our independently produced bytes at the end.
import json, hashlib

# --- SEP-3004 protected-field canonicalization (implemented from the rules) ---
# Registered caller-governance fields (the "current registered shape"):
REGISTERED_CG = {"session_id", "invoked_by_principal_id", "purpose_declared", "flagged"}

def protected_view(record):
    """Return the protected projection of an event record:
       drop the unprotected event_hash; within extensions.caller-governance keep
       only registered fields that are present (do not inject absent ones)."""
    r = dict(record)
    r.pop("event_hash", None)            # event_hash is computed OVER the preimage, not part of it
    exts = r.get("extensions")
    if isinstance(exts, dict):
        e = dict(exts)
        cg = e.get("caller-governance")
        if isinstance(cg, dict):
            e["caller-governance"] = {k: v for k, v in cg.items() if k in REGISTERED_CG}
        r["extensions"] = e
    return r

def canonical_bytes(obj):
    """Canonical JSON: recursively sorted keys, compact separators, UTF-8, no whitespace."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

def event_hash(record):
    b = canonical_bytes(protected_view(record))
    return b, hashlib.sha256(b).hexdigest()

# --- load fixture ONLY to pull the source records + the values we will check against ---
import sys
FIXTURE = sys.argv[1] if len(sys.argv) > 1 else "SEP3004_CURRENT_HEAD_PROJECTION.fixture.json"
d = json.load(open(FIXTURE))
cg = d["currentRegisteredCallerGovernance"]
recA = cg["recordA"]; recB = cg["recordB"]
expected_bytes = cg["protectedCanonicalUtf8"].encode("utf-8")
expected_hex   = cg["protectedCanonicalUtf8Hex"]
expected_hash  = cg["eventHashA"]
expected_len   = cg["protectedByteLength"]

print("=== independent replay: recordA (source) -> protected preimage ===")
bA, hA = event_hash(recA)
print("our bytes len      :", len(bA), "(fixture protectedByteLength =", expected_len, ")")
print("our sha256         :", hA)
print("fixture eventHashA :", expected_hash)
print("BYTE-IDENTICAL to fixture protectedCanonicalUtf8 :", bA == expected_bytes)
print("our hex == fixture protectedCanonicalUtf8Hex     :", bA.hex() == expected_hex)
print("sha256 MATCH       :", hA == expected_hash)
print()
print("our produced preimage:")
print(bA.decode("utf-8"))
print()
print("=== recordB (different requested/hostAllowed authority) -> same witness? ===")
bB, hB = event_hash(recB)
print("recordB bytes == recordA bytes :", bB == bA)
print("recordB sha256                 :", hB, "(== a795c1d9...:", hB == expected_hash, ")")
print()
print("=== cross-check: same canonicalizer reproduces the published upstream KAT (f733fed9) ===")
# parse the upstream KAT canonical text back to a record, re-run our canonicalizer.
kat_txt = d["upstreamKnownAnswer"]["expectedCanonicalUtf8"]
kat_rec = json.loads(kat_txt)          # this is already the protected shape (no event_hash)
kb, kh = event_hash(kat_rec)
print("KAT re-canonicalized byte-identical :", kb == kat_txt.encode("utf-8"))
print("KAT sha256                          :", kh)
print("fixture upstream expectedSha256     :", d["upstreamKnownAnswer"]["expectedSha256"])
print("KAT sha256 MATCH                    :", kh == d["upstreamKnownAnswer"]["expectedSha256"])
print()
print("=== source provenance (from fixture, for the reply) ===")
print("SEP-3004 revision (head):", d["source"]["head"])
print("SEP file sha256         :", d["source"]["fileSha256"])
print("fixture pinned commit   : f3f74c4ae6f9551b94cb6b550b4611de98bc3ae3")
