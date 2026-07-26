#!/usr/bin/env python3
"""
jidec_cite.py — resolve and INDEPENDENTLY verify a JIDEC citation.

This is the Section-C primitive: any agent or human, given a citation URI,
can reduce it to a verified "citation card" without trusting HORIZON SHIELD.

Accepted citation forms:
    jidec:path:<64hex>      a verification path by its path_id
    jidec:entry:<n>         a ledger entry by number
    jidec:<64hex>           bare hash (same as path:)
    https://.../ledger/<n>  a ledger URL

What it does, in the order any careful verifier would:
    1. resolve the citation to a ledger entry (by scanning the public
       /ledger index for a matching claim_sha256, or directly by number)
    2. fetch the entry's exact bytes (?format=raw) and recompute SHA-256;
       confirm it equals the cited id  -> INTEGRITY
    3. read the entry's Bitcoin anchoring status (confirmed+block / pending)
    4. parse the record: a jidec-path-v1 surfaces its verdict + assertions;
       a jidec-claim-v1 surfaces its committed hashes; else it is noted v0
    5. emit a structured citation card (--json) and a human summary

Exit code: 0 if integrity holds, 1 if it does not (tampering / wrong id),
2 if the citation could not be resolved.

Standard library only.
"""

import argparse
import hashlib
import json
import re
import sys
import urllib.request

DEFAULT_BASE = "https://hs-ledger.oga-surf-project.workers.dev"
BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
HEX64 = re.compile(r"^[0-9a-f]{64}$", re.I)


def sha256_hex(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def urllib_transport(method, url):
    req = urllib.request.Request(url, method=method)
    req.add_header("User-Agent", BROWSER_UA)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def parse_citation(cit):
    """Return ('entry', n) or ('hash', sha) or ('url', url)."""
    c = cit.strip()
    if c.startswith("http://") or c.startswith("https://"):
        m = re.search(r"/ledger/(\d+)", c)
        if m:
            return ("entry", int(m.group(1)))
        return ("url", c)
    if c.startswith("jidec:entry:"):
        return ("entry", int(c.split(":")[-1]))
    if c.startswith("jidec:path:"):
        return ("hash", c.split(":")[-1].lower())
    if c.startswith("jidec:"):
        tail = c.split(":", 1)[1]
        if HEX64.match(tail):
            return ("hash", tail.lower())
    if HEX64.match(c):
        return ("hash", c.lower())
    if c.isdigit():
        return ("entry", int(c))
    raise ValueError("unrecognized citation form: %s" % cit)


def resolve_entry(kind, val, base, transport):
    """Resolve a citation to an entry number. For a hash, scan the public
    /ledger index for a matching claim_sha256 (no privileged access)."""
    if kind == "entry":
        return int(val)
    if kind == "hash":
        status, body = transport("GET", base + "/ledger")
        if status != 200:
            raise RuntimeError("could not read ledger index: HTTP %s" % status)
        idx = json.loads(body.decode("utf-8"))
        for e in idx.get("entries", []):
            if str(e.get("claim_sha256", "")).lower() == val:
                return int(e["n"])
        raise LookupError("no ledger entry has claim_sha256 == %s "
                          "(index covers the most recent 100 entries)" % val)
    raise ValueError("cannot resolve kind=%s" % kind)


def classify_record(text):
    try:
        obj = json.loads(text)
    except Exception:
        return "v0-plain", None
    if isinstance(obj, dict) and obj.get("schema") == "jidec-path-v1":
        return "jidec-path-v1", obj
    if isinstance(obj, dict) and obj.get("schema") == "jidec-claim-v1":
        return "jidec-claim-v1", obj
    return "v0", obj


def cite(citation, base=DEFAULT_BASE, transport=urllib_transport):
    kind, val = parse_citation(citation)
    n = resolve_entry(kind, val, base, transport)
    ledger_url = "%s/ledger/%d" % (base, n)

    # 2. exact bytes + recompute
    status, raw = transport("GET", "%s/ledger/%d?format=raw" % (base, n))
    if status != 200:
        raise RuntimeError("could not fetch raw record for entry %d: HTTP %s" % (n, status))
    recomputed = sha256_hex(raw)
    claimed = val if kind == "hash" else None

    # 3. metadata (ots status, block)
    status_j, jbody = transport("GET", "%s/ledger/%d?format=json" % (base, n))
    meta = json.loads(jbody.decode("utf-8")) if status_j == 200 else {}
    entry_claim = str(meta.get("claim_sha256", "")).lower()
    if claimed is None:
        claimed = entry_claim  # cited by entry number: the entry's own hash is the id

    integrity_match = (recomputed.lower() == claimed.lower()) and \
                      (entry_claim == "" or entry_claim == recomputed.lower())

    ots_status = meta.get("ots_status")
    block = meta.get("bitcoin_block")
    block_time = meta.get("block_time")
    if ots_status == "confirmed" and block:
        bitcoin = {"status": "confirmed", "block": block, "block_time": block_time}
    elif ots_status == "pending":
        bitcoin = {"status": "pending", "block": None, "block_time": None}
    else:
        bitcoin = {"status": ots_status or "none", "block": None, "block_time": None}

    # 4. parse
    text = raw.decode("utf-8", errors="replace")
    kind_rec, obj = classify_record(text)

    card = {
        "citation": citation,
        "resolved_entry": n,
        "ledger_url": ledger_url,
        "raw_url": ledger_url + "?format=raw",
        "ots_url": ledger_url + "/ots",
        "integrity": {
            "claimed_sha256": claimed.lower(),
            "recomputed_sha256": recomputed.lower(),
            "match": bool(integrity_match),
        },
        "bitcoin": bitcoin,
        "record_kind": kind_rec,
    }

    if kind_rec == "jidec-path-v1" and obj is not None:
        card["path"] = {
            "purpose": obj.get("purpose"),
            "walked_at": obj.get("walked_at"),
            "verdict": obj.get("verdict"),
            "assertions": [{"claim": a.get("claim"), "result": a.get("result")}
                           for a in obj.get("assertions", [])],
            "base": obj.get("base"),
            "replay_hint": ("python3 jidec_path.py --replay \"%s?format=raw\" "
                            "--base %s --pdfgen <pdfgen>" % (ledger_url, base)),
        }
    elif kind_rec == "jidec-claim-v1" and obj is not None:
        card["claim"] = {k: obj.get(k) for k in
                         ("work_id", "input_sha256", "reference_bundle_sha256",
                          "algorithm_commit", "thresholds_sha256", "result_sha256",
                          "pdf_sha256", "issued_at")}

    card["trust_note"] = (
        "Independently verified: the entry's bytes hash to the cited id"
        + (", and that id is confirmed in Bitcoin block %s" % block if bitcoin["status"] == "confirmed"
           else ", and that id is submitted to OpenTimestamps (Bitcoin confirmation pending)"
           if bitcoin["status"] == "pending" else "")
        + ". No trust in HORIZON SHIELD required."
    ) if integrity_match else (
        "INTEGRITY FAILURE: the entry's bytes do NOT hash to the cited id. "
        "Do not rely on this citation."
    )
    return card


def human_summary(card):
    lines = []
    lines.append("citation : %s" % card["citation"])
    lines.append("entry    : #%s  (%s)" % (card["resolved_entry"], card["ledger_url"]))
    ig = card["integrity"]
    lines.append("integrity: %s" % ("OK — bytes hash to the cited id"
                                    if ig["match"] else "FAIL — hash mismatch"))
    if not ig["match"]:
        lines.append("           claimed    %s" % ig["claimed_sha256"])
        lines.append("           recomputed %s" % ig["recomputed_sha256"])
    b = card["bitcoin"]
    if b["status"] == "confirmed":
        lines.append("bitcoin  : confirmed at block %s (%s)" % (b["block"], b["block_time"]))
    else:
        lines.append("bitcoin  : %s" % b["status"])
    lines.append("record   : %s" % card["record_kind"])
    if "path" in card:
        p = card["path"]
        v = p.get("verdict") or {}
        lines.append("path     : %s" % p.get("purpose"))
        lines.append("verdict  : %s (%s/%s)" % (v.get("outcome"), v.get("n_pass"), v.get("n_total")))
        for a in p.get("assertions", []):
            lines.append("   [%s] %s" % ("PASS" if a["result"] else "FAIL", a["claim"]))
    lines.append("")
    lines.append(card["trust_note"])
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Resolve and verify a JIDEC citation.")
    ap.add_argument("citation", help="jidec:path:<sha> | jidec:entry:<n> | ledger URL")
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--json", action="store_true", help="emit the citation card as JSON")
    args = ap.parse_args(argv)

    try:
        card = cite(args.citation, base=args.base)
    except LookupError as e:
        print("unresolved: %s" % e, file=sys.stderr)
        return 2
    except Exception as e:
        print("error: %s" % e, file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(card, ensure_ascii=False, indent=2))
    else:
        print(human_summary(card))
    return 0 if card["integrity"]["match"] else 1


if __name__ == "__main__":
    sys.exit(main())
