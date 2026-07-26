#!/usr/bin/env python3
"""
jidec_path.py — record a content-addressed verification path (jidec-path-v1).

A "path" is a frozen, tamper-evident record of a verification walk: the
sequence of fetches and computations a verifier performed, the exact bytes
observed at each step, and the verdict reached. Its own SHA-256 is its
identity (path_id) and also the claim_sha256 the JIDEC ledger anchors to
Bitcoin.

A path is BOTH a record (what was observed, frozen) and a recipe (how to
re-walk and what to compare). Re-walking later either matches the anchored
observation (no drift) or does not (drift detected).

Standard library only. No third-party dependencies.

Usage on a machine with network access (e.g. TOshi's Mac):

    python3 jidec_path.py --walk entry4 \\
        --base https://hs-ledger.oga-surf-project.workers.dev \\
        --pdfgen https://hs-pdf-gen.oga-surf-project.workers.dev \\
        --out path_entry4.json --seed seed_entry_5.json

  --out   writes the human-readable path JSON (with path_id + cite_as).
  --seed  writes the ledger seed {claim_sha256, record_canonical, work},
          where record_canonical is the exact canonical bytes and
          claim_sha256 == path_id. POST that seed to /ledger/append.

Exit code 0 if the walk's verdict is PASS, 1 otherwise.
"""

import argparse
import hashlib
import json
import sys
import time
import urllib.request

SCHEMA = "jidec-path-v1"
BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


# --------------------------------------------------------------------------
# primitives
# --------------------------------------------------------------------------
def sha256_hex(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def canon(obj) -> str:
    """Canonical serialization: sorted keys, compact, raw UTF-8. The bytes
    of this string are what the ledger anchors and what path_id hashes."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def headers_sha(headers: dict) -> str:
    # Hash a stable serialization of headers (lower-cased keys, sorted).
    norm = {str(k).lower(): str(v) for k, v in (headers or {}).items()}
    return sha256_hex(canon(norm).encode("utf-8"))


# --------------------------------------------------------------------------
# transport (injectable so tests run without network)
# --------------------------------------------------------------------------
def urllib_transport(method, url, headers=None, body=None):
    """Real HTTP via urllib. Returns (status, resp_headers_dict, resp_body_bytes)."""
    req = urllib.request.Request(url, method=method, data=body)
    req.add_header("User-Agent", BROWSER_UA)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, dict(r.headers.items()), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers.items()), e.read()


# --------------------------------------------------------------------------
# recorder
# --------------------------------------------------------------------------
class PathRecorder:
    def __init__(self, base, purpose, transport=urllib_transport, clock=time.time,
                 walked_at=None, prev_path_refs=None):
        self.base = base
        self.purpose = purpose
        self.transport = transport
        self.clock = clock
        self.walked_at = walked_at  # if None, stamped from clock at first use
        self.prev_path_refs = list(prev_path_refs or [])
        self.nodes = []
        self.assertions = []

    def _now_iso(self):
        # ISO-8601 UTC, seconds resolution, from injected clock.
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.clock()))

    def fetch(self, method, url, headers=None, body=None):
        if self.walked_at is None:
            self.walked_at = self._now_iso()
        t0 = self.clock()
        status, resp_headers, resp_body = self.transport(method, url, headers, body)
        dt_ms = int(round((self.clock() - t0) * 1000))
        n = len(self.nodes)
        self.nodes.append({
            "n": n,
            "kind": "fetch",
            "request": {
                "method": method,
                "url": url,
                "headers_sha256": headers_sha(headers),
                "body_sha256": sha256_hex(body) if body else None,
            },
            "response": {
                "status": status,
                "headers_sha256": headers_sha(resp_headers),
                "body_sha256": sha256_hex(resp_body),
            },
            "duration_ms": dt_ms,
        })
        return resp_body

    def compute(self, label, inputs, output_value: str, preview_len=80):
        if self.walked_at is None:
            self.walked_at = self._now_iso()
        n = len(self.nodes)
        out_bytes = output_value.encode("utf-8")
        self.nodes.append({
            "n": n,
            "kind": "compute",
            "label": label,
            "inputs": [{"from_node": i} for i in inputs],
            "output_sha256": sha256_hex(out_bytes),
            "output_preview": output_value[:preview_len],
        })
        return output_value

    def assert_(self, claim, result: bool, evidence_nodes, observed_value: str):
        self.assertions.append({
            "claim": claim,
            "op": "eq",
            "result": bool(result),
            "evidence_nodes": list(evidence_nodes),
            "observed_sha256": sha256_hex(str(observed_value).encode("utf-8")),
        })
        return bool(result)

    def build(self):
        n_pass = sum(1 for a in self.assertions if a["result"])
        n_total = len(self.assertions)
        verdict = {
            "outcome": "PASS" if n_pass == n_total and n_total > 0 else "FAIL",
            "n_pass": n_pass,
            "n_total": n_total,
        }
        core = {
            "schema": SCHEMA,
            "purpose": self.purpose,
            "walked_at": self.walked_at,
            "walker": {"tool": "jidec_path.py", "version": "1"},
            "base": self.base,
            "nodes": self.nodes,
            "assertions": self.assertions,
            "verdict": verdict,
            "replay": {
                "how": "re-run the same walk against `base`; recompute every node body_sha256 and re-evaluate assertions",
                "match_means": "no drift since anchoring",
                "mismatch_means": "the live system now differs from the anchored observation",
            },
            "prev_path_refs": self.prev_path_refs,
        }
        record_canonical = canon(core)                       # exact anchored bytes
        path_id = sha256_hex(record_canonical.encode("utf-8"))  # == ledger claim_sha256
        presented = dict(core)
        presented["path_id"] = path_id
        presented["cite_as"] = "jidec:path:" + path_id
        return {
            "core": core,
            "record_canonical": record_canonical,
            "path_id": path_id,
            "presented": presented,
            "verdict": verdict,
        }


# --------------------------------------------------------------------------
# the entry-#4 verification walk
# --------------------------------------------------------------------------
CANARY_EXPECT = "C025E288675EE898"


def walk_entry4(base, pdfgen, transport=urllib_transport, clock=time.time, walked_at=None):
    """Walk the same route Federico walked: live /canary self-match, then the
    anchored entry-#4 source, and confirm both carry the same canary constant."""
    r = PathRecorder(
        base=base,
        purpose="verify hs-pdf-gen /canary self-matches and the Bitcoin-anchored entry #4 source carries the same canary constant",
        transport=transport, clock=clock, walked_at=walked_at,
    )

    # node 0: live canary from the deployment
    b0 = r.fetch("GET", pdfgen + "/canary")
    j = json.loads(b0.decode("utf-8"))
    live = str(j.get("live_computed_hash"))
    expect = str(j.get("canary_expect_hash"))
    match = bool(j.get("match"))

    # node 1: parse/extract the three fields
    extracted = canon({"live_computed_hash": live, "canary_expect_hash": expect, "match": match})
    r.compute("parse /canary json; extract live_computed_hash, canary_expect_hash, match",
              inputs=[0], output_value=extracted)

    # node 2: the Bitcoin-anchored entry #4 source bytes
    b2 = r.fetch("GET", base + "/ledger/4?format=raw")
    src = b2.decode("utf-8", errors="replace")

    # node 3: does the anchored source carry the same constant + its name?
    carries = (CANARY_EXPECT in src) and ("HS_AUDIT_CANARY_EXPECT" in src)
    r.compute("grep anchored entry #4 source for the canary constant and its name",
              inputs=[2], output_value=json.dumps(carries))

    # assertions
    r.assert_("/canary self-match is true", match is True, [0, 1], match)
    r.assert_(f"live_computed_hash == {CANARY_EXPECT}", live == CANARY_EXPECT, [0, 1], live)
    r.assert_(f"canary_expect_hash == {CANARY_EXPECT}", expect == CANARY_EXPECT, [0, 1], expect)
    r.assert_("anchored entry #4 source carries the same canary constant",
              carries, [2, 3], carries)

    return r.build()


# --------------------------------------------------------------------------
# cli
# --------------------------------------------------------------------------
def main(argv=None):
    ap = argparse.ArgumentParser(description="Record a JIDEC verification path.")
    ap.add_argument("--walk", default="entry4", choices=["entry4"])
    ap.add_argument("--base", default="https://hs-ledger.oga-surf-project.workers.dev")
    ap.add_argument("--pdfgen", default="https://hs-pdf-gen.oga-surf-project.workers.dev")
    ap.add_argument("--out", default="path_entry4.json")
    ap.add_argument("--seed", default="seed_path.json")
    args = ap.parse_args(argv)

    result = walk_entry4(args.base, args.pdfgen)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(result["presented"], f, ensure_ascii=False, indent=2)
    seed = {
        "claim_sha256": result["path_id"],
        "record_canonical": result["record_canonical"],
        "work": "JIDEC verification path (jidec-path-v1) — entry-#4 canary walk",
    }
    with open(args.seed, "w", encoding="utf-8") as f:
        json.dump(seed, f, ensure_ascii=False)

    v = result["verdict"]
    print(f"walk: {args.walk}")
    print(f"verdict: {v['outcome']}  ({v['n_pass']}/{v['n_total']} assertions passed)")
    print(f"path_id (== ledger claim_sha256): {result['path_id']}")
    print(f"cite_as: jidec:path:{result['path_id']}")
    print(f"wrote path:  {args.out}")
    print(f"wrote seed:  {args.seed}")
    return 0 if v["outcome"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
