#!/usr/bin/env python3
"""Add one party's signature to an a2a-agreement-v1 record. Each party runs this on its own
machine, with its own key, in either order: signatures are excluded from the signed bytes, so
the second signer does not disturb the first.

  openssl genpkey -algorithm ed25519 -out agreement.pem
  python3 agreement_sign.py --pubkey agreement.pem            # what to serve at key_url
  python3 agreement_sign.py record.json --key agreement.pem --domain party-a.example --out record.json

The key_url is not passed here. It is read from the party's own entry in the record, which is
inside the signed bytes, so a signer cannot point at a key the other party never saw.
"""

import argparse
import base64
import json
import sys

from agreement_verify import SCHEMA, canonical, parse_strict, signing_bytes, norm_domain


def load_key(path):
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    except Exception:
        raise SystemExit("signing needs the cryptography package: pip install cryptography")
    with open(path, "rb") as f:
        key = serialization.load_pem_private_key(f.read(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise SystemExit("--key must be an Ed25519 private key (openssl genpkey -algorithm ed25519 -out agreement.pem)")
    pub = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return key, base64.b64encode(pub).decode("ascii")


def sign(record, key, domain):
    d = norm_domain(domain)
    if not d:
        raise SystemExit("--domain must be a bare hostname")
    if record.get("schema") != SCHEMA:
        raise SystemExit("this is not a %s record" % SCHEMA)
    parties = record.get("parties")
    if not isinstance(parties, list) or len(parties) != 2:
        raise SystemExit("the record must carry exactly two parties before anyone signs it")
    me = next((p for p in parties if isinstance(p, dict) and norm_domain(p.get("domain")) == d), None)
    if me is None:
        raise SystemExit("%s is not a party to this record; refusing to sign" % d)
    sigs = [s for s in (record.get("signatures") or []) if isinstance(s, dict)]
    if any(norm_domain(s.get("domain")) == d for s in sigs):
        raise SystemExit("%s has already signed this record" % d)
    record["signatures"] = sigs
    msg = signing_bytes(record)
    sig = base64.b64encode(key.sign(msg)).decode("ascii")
    sigs.append({"domain": d, "alg": "ed25519", "signature": sig, "key_url": me.get("key_url")})
    record["signatures"] = sigs
    return record, msg


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("record", nargs="?", help="the record to sign")
    ap.add_argument("--key", help="Ed25519 private key PEM")
    ap.add_argument("--domain", help="which party you are")
    ap.add_argument("--out", default=None, help="where to write the signed record (default: stdout)")
    ap.add_argument("--pubkey", default=None, help="print what to serve at key_url for this PEM and exit")
    a = ap.parse_args(argv)

    if a.pubkey:
        _k, pub = load_key(a.pubkey)
        print(json.dumps({"public_key_ed25519_b64": pub}))
        return 0
    if not (a.record and a.key and a.domain):
        ap.error("record, --key and --domain are all required")

    with open(a.record, "r", encoding="utf-8") as f:
        rec = parse_strict(f.read())
    key, _pub = load_key(a.key)
    rec, msg = sign(rec, key, a.domain)
    out = canonical(rec)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(out)
        # read back: a generator that does not read its own output is a generator that lies
        with open(a.out, "r", encoding="utf-8") as f:
            back = f.read()
        if back != out:
            raise SystemExit("wrote %s but read back different bytes" % a.out)
        sys.stderr.write("signed as %s over %d bytes; %d signature(s) now on the record\n" % (a.domain, len(msg), len(rec["signatures"])))
    else:
        print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
