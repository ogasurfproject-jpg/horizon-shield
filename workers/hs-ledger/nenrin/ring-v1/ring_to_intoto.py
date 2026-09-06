#!/usr/bin/env python3
"""ring_to_intoto.py : emit an in-toto Statement v1 (and optionally a DSSE envelope) for a NENRIN ring file.

This is section 6 of CONDUCT_EXT_v1.md, delivered instead of only stated. The ring file stays the unit of
record (its identity is sha256 of its bytes, anchored to Bitcoin through the JIDEC ledger). The Statement is a
second door into the same bytes for tooling that already speaks in-toto / SLSA / SCITT:

    subject        = [{ name: "rings/<slug>/<YYYY-MM>.json", digest: { sha256: <hex of the file bytes> } }]
    predicateType  = https://gate.horizonshield.dev/ext/conduct/v1
    predicate      = the ring's counts, copied, never recomputed here; plus where the ring, the ledger and the
                     recompute recipe live. No rate, no score, no rank (the ring's own limits say why).

Standard library only for the Statement. For the DSSE envelope (--key), the `cryptography` package is needed
(ES256 = ECDSA P-256 with SHA-256, the same key type the agent cards are signed with). Without a key the tool
writes the unsigned Statement, which is still a valid in-toto Statement and still binds the ring by sha256.

    python3 ring_to_intoto.py rings/mcp-horizonshield-dev-mcp/2026-08.json                 -> prints Statement JSON
    python3 ring_to_intoto.py rings/mcp-horizonshield-dev-mcp/2026-08.json --out x.intoto.json
    python3 ring_to_intoto.py rings/.../2026-08.json --key ~/.hs_card_key.pem --kid hs-2026-09 --out x.dsse.json
    python3 ring_to_intoto.py --verify x.dsse.json --jwk pub.json       -> checks the DSSE signature (needs cryptography)

Canonical bytes of the Statement: keys sorted at every level, separators , and : with no spaces, non-ASCII
unescaped (the NENRIN seam, ledger entry 34). The DSSE payload is exactly those bytes.
"""
import argparse
import base64
import hashlib
import io
import json
import os
import re
import sys

PREDICATE_TYPE = "https://gate.horizonshield.dev/ext/conduct/v1"
STATEMENT_TYPE = "https://in-toto.io/Statement/v1"
PAYLOAD_TYPE = "application/vnd.in-toto+json"
RING_BASE = "https://raw.githubusercontent.com/ogasurfproject-jpg/mcp-conduct-register/main/rings/"
LEDGER = "https://ledger.horizonshield.dev/ledger"
COUNT_KEYS = [
    "schema", "ring", "endpoint", "instants_sampled", "instants_reached", "instants_by_status",
    "instants_by_consent_source", "witnesses", "witness_identities", "discrepancies", "surface_changes",
    "manifest_hashes_observed", "first_instant", "last_instant", "record_sha256_first", "record_sha256_last",
    "prev_ring", "prev_ring_sha256", "limits", "recompute",
]


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def b64u_dec(s):
    s = str(s)
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def subject_name(path, ring):
    """rings/<slug>/<YYYY-MM>.json, derived from the path when it has that shape, else from the ring's fields."""
    p = path.replace("\\", "/")
    m = re.search(r"(rings/[a-z0-9-]+/\d{4}-\d{2}\.json)$", p)
    if m:
        return m.group(1)
    ep = str(ring.get("endpoint", ""))
    slug = re.sub(r"[^a-z0-9]+", "-", ep.lower().replace("https://", "")).strip("-")
    return "rings/%s/%s.json" % (slug, ring.get("ring", "unknown"))


def statement_for(path):
    raw = open(path, "rb").read()
    ring = json.loads(raw.decode("utf-8"))
    if ring.get("schema") != "nenrin-ring-v1":
        raise SystemExit("not a nenrin-ring-v1 file: schema=%r" % ring.get("schema"))
    name = subject_name(path, ring)
    counts = {k: ring[k] for k in COUNT_KEYS if k in ring}
    # DSSE の payload に対する二重の注意: 「ring の bytes を再計算はせん。写しただけ。値の出所は ring 本体」を明記する。
    predicate = {
        "ring_counts": counts,
        "ring_sha256": hashlib.sha256(raw).hexdigest(),
        "ring_url": RING_BASE + name[len("rings/"):],
        "ring_spec": "NENRIN_SPEC_v1.md (sha256 9ccba2e325fd2a555fcdb2dec519b8c6bf7a669064674846aea98ecfff824e3d)",
        "ledger": LEDGER,
        "counts_are_copied_not_recomputed": True,
        "no_score": "counts with denominators only; the ring never states a rate, a score or a rank",
        "recompute": ring.get("recompute"),
        "emitted_by": "ring_to_intoto.py (workers/hs-ledger/nenrin/ring-v1)",
    }
    return {
        "_type": STATEMENT_TYPE,
        "subject": [{"name": name, "digest": {"sha256": hashlib.sha256(raw).hexdigest()}}],
        "predicateType": PREDICATE_TYPE,
        "predicate": predicate,
    }


def pae(payload_type, payload):
    """DSSE Pre-Authentication Encoding."""
    return b"DSSEv1 " + str(len(payload_type)).encode() + b" " + payload_type.encode() + b" " + str(len(payload)).encode() + b" " + payload


def sign_dsse(payload_bytes, key_path, kid):
    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
    except ImportError:
        raise SystemExit("--key needs the cryptography package: python3 -m pip install cryptography")
    pem = open(os.path.expanduser(key_path), "rb").read()
    priv = serialization.load_pem_private_key(pem, password=None)
    if not isinstance(priv, ec.EllipticCurvePrivateKey) or priv.curve.name != "secp256r1":
        raise SystemExit("key must be EC P-256 (prime256v1 / secp256r1) for ES256")
    der = priv.sign(pae(PAYLOAD_TYPE, payload_bytes), ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    raw = r.to_bytes(32, "big") + s.to_bytes(32, "big")   # JWS/ES256 の raw r||s。DSSE は署名の中身の形を縛らんので、card と同じ形に揃える
    pub = priv.public_key().public_numbers()
    jwk = {"kty": "EC", "crv": "P-256", "x": b64u(pub.x.to_bytes(32, "big")), "y": b64u(pub.y.to_bytes(32, "big")), "kid": kid, "alg": "ES256", "use": "sig"}
    return {"payloadType": PAYLOAD_TYPE, "payload": b64u(payload_bytes), "signatures": [{"keyid": kid, "sig": b64u(raw)}]}, jwk


def verify_dsse(env_path, jwk_path):
    try:
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
        from cryptography.exceptions import InvalidSignature
    except ImportError:
        raise SystemExit("--verify needs the cryptography package")
    env = json.load(open(env_path, encoding="utf-8"))
    jwk = json.load(open(jwk_path, encoding="utf-8"))
    if "keys" in jwk:
        jwk = jwk["keys"][0]
    x = int.from_bytes(b64u_dec(jwk["x"]), "big")
    y = int.from_bytes(b64u_dec(jwk["y"]), "big")
    pub = ec.EllipticCurvePublicNumbers(x, y, ec.SECP256R1()).public_key()
    payload = b64u_dec(env["payload"])
    ok = False
    for sig in env.get("signatures", []):
        raw = b64u_dec(sig["sig"])
        der = encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))
        try:
            pub.verify(der, pae(env["payloadType"], payload), ec.ECDSA(hashes.SHA256()))
            ok = True
        except InvalidSignature:
            pass
    st = json.loads(payload.decode("utf-8"))
    return ok, st


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ring", nargs="?", help="path to a nenrin-ring-v1 JSON file")
    ap.add_argument("--out", help="write here (default: stdout)")
    ap.add_argument("--key", help="EC P-256 private key PEM (PKCS8); when given, write a DSSE envelope instead of a bare Statement")
    ap.add_argument("--kid", default="hs-2026-09", help="key id written into the DSSE signature (default hs-2026-09)")
    ap.add_argument("--jwk-out", help="with --key: also write the public JWK here")
    ap.add_argument("--verify", help="verify a DSSE envelope file (needs --jwk)")
    ap.add_argument("--jwk", help="public JWK or JWKS file for --verify")
    a = ap.parse_args(argv)

    if a.verify:
        if not a.jwk:
            ap.error("--verify needs --jwk")
        ok, st = verify_dsse(a.verify, a.jwk)
        print(json.dumps({"verified": ok, "subject": st.get("subject"), "predicateType": st.get("predicateType")}, ensure_ascii=False, indent=2))
        return 0 if ok else 1
    if not a.ring:
        ap.error("ring path required")
    st = statement_for(a.ring)
    payload = canonical(st).encode("utf-8")
    if a.key:
        env, jwk = sign_dsse(payload, a.key, a.kid)
        out = canonical(env)
        if a.jwk_out:
            io.open(a.jwk_out, "w", encoding="utf-8").write(canonical({"keys": [jwk]}))
    else:
        out = payload.decode("utf-8")
    if a.out:
        io.open(a.out, "w", encoding="utf-8").write(out)
        print("%s  %s  ->  %s" % (hashlib.sha256(out.encode("utf-8")).hexdigest(), st["subject"][0]["name"], a.out))
    else:
        print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
