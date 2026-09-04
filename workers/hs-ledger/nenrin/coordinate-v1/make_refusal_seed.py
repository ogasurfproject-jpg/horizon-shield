"""
make_refusal_seed.py: a refusal becomes a ledger entry of its own.

sync_headers_p2p.py writes <prefix>.refusal.<time>.json whenever it refuses to write header
bytes: peers disagreed, too few finished, or the read back failed. That file is evidence, and
evidence that only sits on the operator's disk is a weaker guarantee than evidence anyone can
query. This script turns one refusal record into a JIDEC seed, {claim_sha256, record_canonical,
work}, the same shape every other entry on the ledger uses, so the refusal is appended as its
own numbered entry: jidec:entry:<n> returns the record as machine readable JSON, and the
ledger's list shows it under a work line that begins with "NENRIN localheaders refusal".

Fail-closed: the record must carry the refusal schema, bytes_written must be false, the reason
code must be one the client emits, a disagreement must name two peers and two different hashes
at one height, and no forbidden dash may appear. If any of that fails, nothing is written.
The record's bytes are used exactly as they are on disk; the claim is their SHA-256.

    python3 make_refusal_seed.py localheaders_full.refusal.1788514331.json
    python3 make_refusal_seed.py some.refusal.json --out seed_entry_refusal.json
"""
import argparse, hashlib, io, json, os, sys

SCHEMA = "nenrin-localheaders-refusal-1"
REASON_CODES = {"peers_disagree", "below_min_peers", "readback_refused", "readback_sha_mismatch"}
FORBIDDEN_DASH = ["—", "–", "―", "−"]


class Bad(Exception):
    pass


def load_and_check(path):
    text = io.open(path, encoding="utf-8").read()
    if any(d in text for d in FORBIDDEN_DASH):
        raise Bad("forbidden dash in the record")
    try:
        rec = json.loads(text)
    except ValueError as e:
        raise Bad("not JSON: %s" % e)
    if rec.get("schema") != SCHEMA:
        raise Bad("schema is %r, need %r" % (rec.get("schema"), SCHEMA))
    if rec.get("bytes_written") is not False:
        raise Bad("bytes_written must be false in a refusal record")
    code = rec.get("reason_code")
    if code not in REASON_CODES:
        raise Bad("unknown reason_code %r" % code)
    for k in ("network", "refused_at", "reason", "peers_finished", "peers_failed", "mode", "chain"):
        if k not in rec:
            raise Bad("missing field %s" % k)
    if not isinstance(rec["refused_at"], int):
        raise Bad("refused_at must be an integer unix time")
    d = rec.get("disagreement")
    if code == "peers_disagree":
        if not isinstance(d, dict):
            raise Bad("peers_disagree needs a disagreement object")
        for k in ("peer_a", "hash_a", "peer_b", "hash_b", "height"):
            if k not in d:
                raise Bad("disagreement missing %s" % k)
        if d["peer_a"] == d["peer_b"]:
            raise Bad("a disagreement needs two different peers")
        if d["hash_a"] == d["hash_b"]:
            raise Bad("a disagreement needs two different hashes")
        for h in (d["hash_a"], d["hash_b"]):
            if len(h) != 64 or any(c not in "0123456789abcdef" for c in h):
                raise Bad("hash is not 64 hex: %r" % h)
        if rec.get("height") != d["height"]:
            raise Bad("record height and disagreement height differ")
    elif d is not None:
        raise Bad("only peers_disagree carries a disagreement object")
    return text, rec


def work_line(rec):
    d = rec.get("disagreement")
    where = (" at height %d, %s vs %s, hashes %s.. and %s.." % (d["height"], d["peer_a"], d["peer_b"], d["hash_a"][:16], d["hash_b"][:16])
             if d else (" at height %d" % rec["height"] if rec.get("height") is not None else ""))
    return ("NENRIN localheaders refusal: %s%s. network: %s. mode: %s. peers finished %d, dropped %d. no header bytes were written; "
            "this record was. schema %s. a contradiction between sources is evidence and is published, not chosen away."
            % (rec["reason_code"], where, rec["network"], rec["mode"], len(rec["peers_finished"]), len(rec["peers_failed"]), SCHEMA))


def make_seed(record_path, out_path):
    text, rec = load_and_check(record_path)
    work = work_line(rec)
    if any(d in work for d in FORBIDDEN_DASH):
        raise Bad("forbidden dash in the work line")
    sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
    seed = {"claim_sha256": sha, "record_canonical": text, "work": work}
    io.open(out_path, "w", encoding="utf-8").write(json.dumps(seed, ensure_ascii=False))
    back = json.load(io.open(out_path, encoding="utf-8"))
    if back["claim_sha256"] != sha or hashlib.sha256(back["record_canonical"].encode("utf-8")).hexdigest() != sha or back["work"] != work:
        os.remove(out_path)
        raise Bad("read back check failed; seed removed")
    return sha, work


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("record")
    ap.add_argument("--out", default=None, help="seed path; default: seed_<record basename>")
    a = ap.parse_args()
    out = a.out or ("seed_" + os.path.basename(a.record))
    try:
        sha, work = make_seed(a.record, out)
    except Bad as e:
        print("refused to write a seed: %s" % e); return 1
    print("wrote %s\n  claim_sha256: %s\n  work: %s" % (out, sha, work))
    return 0


if __name__ == "__main__":
    sys.exit(main())
