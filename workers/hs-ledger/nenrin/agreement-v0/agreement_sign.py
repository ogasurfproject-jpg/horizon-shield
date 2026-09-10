#!/usr/bin/env python3
"""Add one party's signature to an agreement record. Each party runs this on its own machine,
with its own key, in either order: signatures are excluded from the signed bytes, so the second
signer does not disturb the first.

  openssl genpkey -algorithm ed25519 -out agreement.pem
  python3 agreement_sign.py --pubkey agreement.pem            # what to put in the record and serve at key_url
  python3 agreement_sign.py record.json --key agreement.pem --domain party-a.example --out record.json

Handles both schemas. Under a2a-agreement-v1.1 the bytes signed carry the context prefix
"a2a-agreement-v1.1" and a newline, so an agreement signature can never be mistaken for, or
replayed as, any other signature by the same key; and the signer refuses to sign unless the
public key pinned for you inside the record is the key you are signing with.

The key_url is never passed here. It is read from the party's own entry in the record, which is
inside the signed bytes, so a signer cannot point at a key the other party never saw.
"""
# RUN_ALL: library  記録に署名する道具。振舞いは agreement_redteam.py の中で覆われとる

import argparse
import base64
import json
import sys

from agreement_verify import (SCHEMA_V1, SCHEMA_V11, canonical, parse_strict, signing_bytes,
                              norm_domain, schema_of, b64_raw, public_key_problem)


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
    problem = public_key_problem(pub)
    if problem:
        raise SystemExit("this key's public half %s; generate another one" % problem)
    return key, base64.b64encode(pub).decode("ascii")


def sign(record, key, domain, public_b64=None):
    d = norm_domain(domain)
    if not d:
        raise SystemExit("--domain must be a bare hostname")
    schema = schema_of(record)
    if schema is None:
        raise SystemExit("this is not a %s or %s record" % (SCHEMA_V1, SCHEMA_V11))
    parties = record.get("parties")
    if not isinstance(parties, list) or len(parties) != 2:
        raise SystemExit("the record must carry exactly two parties before anyone signs it")
    me = next((p for p in parties if isinstance(p, dict) and norm_domain(p.get("domain")) == d), None)
    if me is None:
        raise SystemExit("%s is not a party to this record; refusing to sign" % d)
    sigs = [s for s in (record.get("signatures") or []) if isinstance(s, dict)]
    if any(norm_domain(s.get("domain")) == d for s in sigs):
        raise SystemExit("%s has already signed this record" % d)

    if schema == SCHEMA_V11:
        pinned = me.get("public_key_ed25519_b64")
        if public_b64 is not None and pinned != public_b64:
            raise SystemExit("the record pins a different public key for %s than the one you are signing with. "
                             "Put your key in parties[].public_key_ed25519_b64 first, or you will sign bytes "
                             "that name somebody else's key" % d)
        if b64_raw(pinned, 32) is None:
            raise SystemExit("%s has no usable public_key_ed25519_b64 in the record; v1.1 keeps the key inside the signed bytes" % d)

    record["signatures"] = sigs
    msg = signing_bytes(record, schema)
    entry = {"domain": d, "alg": "ed25519", "signature": base64.b64encode(key.sign(msg)).decode("ascii")}
    if schema == SCHEMA_V1:
        entry["key_url"] = me.get("key_url")
    sigs.append(entry)
    record["signatures"] = sigs
    return record, msg


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("record", nargs="?", help="the record to sign")
    ap.add_argument("--key", help="Ed25519 private key PEM")
    ap.add_argument("--domain", help="which party you are")
    ap.add_argument("--out", default=None, help="where to write the signed record (default: stdout)")
    ap.add_argument("--pubkey", default=None, help="print what to pin in the record and serve at key_url, then exit")
    a = ap.parse_args(argv)

    if a.pubkey:
        _k, pub = load_key(a.pubkey)
        print(json.dumps({"public_key_ed25519_b64": pub}))
        return 0
    if not (a.record and a.key and a.domain):
        ap.error("record, --key and --domain are all required")

    with open(a.record, "r", encoding="utf-8") as f:
        rec = parse_strict(f.read())
    key, pub = load_key(a.key)
    rec, msg = sign(rec, key, a.domain, public_b64=pub)
    out = canonical(rec)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(out)
        # read back: a generator that does not read its own output is a generator that lies
        with open(a.out, "r", encoding="utf-8") as f:
            back = f.read()
        if back != out:
            raise SystemExit("wrote %s but read back different bytes" % a.out)
        sys.stderr.write("signed as %s over %d bytes; %d signature(s) now on the record\n"
                         % (a.domain, len(msg), len(rec["signatures"])))
    else:
        print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
