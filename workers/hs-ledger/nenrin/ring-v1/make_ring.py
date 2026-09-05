#!/usr/bin/env python3
"""
nenrin-ring-v1: one ring per endpoint per calendar month, from the gate's /history.

Layer 3 of NENRIN_SPEC_v1.md (sha256 9ccba2e325fd2a555fcdb2dec519b8c6bf7a669064674846aea98ecfff824e3d):

    { "schema": "nenrin-ring-v1", "ring": "2026-09", "endpoint": "https://.../mcp",
      "witnesses": 3, "instants_sampled": 87, "instants_reached": 84,
      "manifest_hashes_observed": ["..."], "surface_changes": [], "discrepancies": [],
      "prev_ring_sha256": "...", "limits": "..." }

Rings carry counts with denominators, never rates, never scores, never rankings. Each ring
includes the hash of the previous ring, forming the chain that makes the metaphor literal.

Usage
    python3 make_ring.py --endpoint https://mcp.horizonshield.dev/mcp --month 2026-08 \
        --history history.json [--prev rings/<slug>/2026-07.json] [--witness w1.json ...] \
        --out rings/

    python3 make_ring.py --verify rings/<slug>/2026-08.json --history history.json [--prev ...]

Deterministic: the same inputs produce the same bytes, so the sha256 is reproducible by anyone
holding the same /history export. The ring never contains a rate or a score; if you find one,
that is a bug in this file, not a feature.
"""

import argparse, hashlib, io, json, os, re, sys

SCHEMA = "nenrin-ring-v1"
GATE_WITNESS = {"name": "gate.horizonshield.dev", "vantage": "cloudflare-worker"}


def canonical(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_hex(b):
    return hashlib.sha256(b).hexdigest()


def slug(endpoint):
    return re.sub(r"[^a-z0-9]+", "-", endpoint.replace("https://", "").lower()).strip("-")


def in_month(at, month):
    return isinstance(at, str) and at[:7] == month


def load_history(path):
    d = json.load(io.open(path, encoding="utf-8"))
    entries = d.get("entries") if isinstance(d, dict) else d
    if not isinstance(entries, list):
        raise SystemExit("history has no entries list")
    return d.get("endpoint") if isinstance(d, dict) else None, entries


def dedupe(entries):
    """Two entries with the same record_sha256 are one measurement. Counting it twice is a lie."""
    seen, out = set(), []
    for e in entries:
        k = e.get("record_sha256") or ("noid:" + str(e.get("at")))
        if k in seen:
            continue
        seen.add(k)
        out.append(e)
    return out


def build_ring(endpoint, month, entries, prev_ring=None, witness_records=None):
    ents = [e for e in entries if in_month(e.get("at"), month)]
    ents = dedupe(ents)
    ents.sort(key=lambda e: (e.get("at") or "", e.get("record_sha256") or ""))

    reached = sum(1 for e in ents if e.get("reachable") is True)
    by_status = {}
    for e in ents:
        s = str(e.get("status") or "unknown")
        by_status[s] = by_status.get(s, 0) + 1
    by_consent = {}
    for e in ents:
        s = str(e.get("consent_source") or "none")
        by_consent[s] = by_consent.get(s, 0) + 1

    hashes, changes, last = [], [], None
    for e in ents:
        surf = e.get("surface") if isinstance(e.get("surface"), dict) else None
        h = surf.get("manifest_hash") if surf else None
        if not h:
            continue
        if h not in hashes:
            hashes.append(h)
        if last is not None and h != last:
            changes.append({"at": e.get("at"), "from": last, "to": h})
        last = h

    # Witnesses: the gate itself, plus any third-party walks submitted to /witness for this
    # endpoint in this month. With one witness there can be no discrepancy, and the ring says so.
    wit = [GATE_WITNESS]
    disc = []
    for w in (witness_records or []):
        if not in_month(w.get("at"), month):
            continue
        ident = w.get("witness") if isinstance(w.get("witness"), dict) else None
        if not ident or not ident.get("name"):
            continue
        if ident not in wit:
            wit.append(ident)
        if w.get("discrepancy_sha256"):
            disc.append(w["discrepancy_sha256"])

    limits = []
    if len(wit) == 1:
        limits.append("one witness only, so no discrepancy could have been recorded this month; "
                      "a single witness can be wrong and nobody was positioned to say so")
    if not ents:
        limits.append("no measurement this month; a ring with zero instants is a recorded gap, not an absence of a ring")
    unmeasured_det = sum(1 for e in ents if (e.get("conditions") or {}).get("determinism", {}).get("measured") is False)
    if unmeasured_det:
        limits.append("determinism was not measured on %d of %d instants (no owner consent to call a tool); "
                      "unmeasured is not failed" % (unmeasured_det, len(ents)))
    limits.append("counts only; the ring never states a rate, a score or a rank, and any reader who "
                  "computes one has left the record")

    ring = {
        "schema": SCHEMA,
        "ring": month,
        "endpoint": endpoint,
        "witnesses": len(wit),
        "witness_identities": sorted(wit, key=lambda w: w["name"]),
        "instants_sampled": len(ents),
        "instants_reached": reached,
        "instants_by_status": dict(sorted(by_status.items())),
        "instants_by_consent_source": dict(sorted(by_consent.items())),
        "manifest_hashes_observed": hashes,
        "surface_changes": changes,
        "discrepancies": sorted(set(disc)),
        "first_instant": ents[0].get("at") if ents else None,
        "last_instant": ents[-1].get("at") if ents else None,
        "record_sha256_first": ents[0].get("record_sha256") if ents else None,
        "record_sha256_last": ents[-1].get("record_sha256") if ents else None,
        "prev_ring_sha256": sha256_hex(ring_bytes(prev_ring)) if prev_ring else None,
        "prev_ring": (prev_ring or {}).get("ring") if prev_ring else None,
        "limits": "; ".join(limits),
        "recompute": ("python3 make_ring.py --verify <this file> --history <the /history export> "
                      "[--prev <previous ring>]. Same bytes in, same sha256 out. Anyone can."),
    }
    return ring


def ring_bytes(ring):
    # Pretty for humans, deterministic for machines: sorted keys, fixed indent, trailing newline.
    # A ring file is exactly these bytes, so sha256(file) is the hash the ledger anchors AND the
    # hash the next ring carries as prev_ring_sha256. One hash, one meaning.
    return (json.dumps(ring, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def load_prev(path):
    """Read a previous ring and refuse one whose bytes are not canonical: its file sha256 would
    not equal the chain hash, and a reader comparing the two would be told a lie by the format."""
    raw = io.open(path, "rb").read()
    prev = json.loads(raw.decode("utf-8"))
    if raw != ring_bytes(prev):
        raise SystemExit("%s is not in canonical ring form (reformatted?); sha256(file) would not match prev_ring_sha256" % path)
    return prev


def cmd_make(a):
    ep_hist, entries = load_history(a.history)
    endpoint = a.endpoint or ep_hist
    if not endpoint:
        raise SystemExit("--endpoint required (history file carries no endpoint)")
    prev = load_prev(a.prev) if a.prev else None
    if prev and prev.get("endpoint") != endpoint:
        raise SystemExit("prev ring is for a different endpoint: %s" % prev.get("endpoint"))
    if prev and prev.get("ring") and prev.get("ring") >= a.month:
        raise SystemExit("prev ring %s is not before %s; chains only run forward" % (prev.get("ring"), a.month))
    wit = [json.load(io.open(p, encoding="utf-8")) for p in (a.witness or [])]
    ring = build_ring(endpoint, a.month, entries, prev, wit)
    b = ring_bytes(ring)
    outdir = os.path.join(a.out, slug(endpoint))
    os.makedirs(outdir, exist_ok=True)
    path = os.path.join(outdir, a.month + ".json")
    if os.path.exists(path) and not a.force:
        raise SystemExit("%s exists; a ring is written once. Use --force only before it is anchored." % path)
    io.open(path, "wb").write(b)
    print(path)
    print("sha256", sha256_hex(b))
    print("instants %d sampled / %d reached / witnesses %d / hashes %d / changes %d" % (
        ring["instants_sampled"], ring["instants_reached"], ring["witnesses"],
        len(ring["manifest_hashes_observed"]), len(ring["surface_changes"])))


def cmd_verify(a):
    claimed = json.load(io.open(a.verify, encoding="utf-8"))
    _, entries = load_history(a.history)
    prev = load_prev(a.prev) if a.prev else None
    wit = [json.load(io.open(p, encoding="utf-8")) for p in (a.witness or [])]
    rebuilt = build_ring(claimed.get("endpoint"), claimed.get("ring"), entries, prev, wit)
    claimed_b = io.open(a.verify, "rb").read()
    rebuilt_b = ring_bytes(rebuilt)
    ok = claimed_b == rebuilt_b
    print("claimed  sha256", sha256_hex(claimed_b))
    print("rebuilt  sha256", sha256_hex(rebuilt_b))
    if ok:
        print("MATCH: this ring is exactly what this history produces")
        return 0
    print("MISMATCH: the ring and the history disagree. Fields that differ:")
    for k in sorted(set(claimed) | set(rebuilt)):
        if claimed.get(k) != rebuilt.get(k):
            print("   ", k, "| ring:", json.dumps(claimed.get(k), ensure_ascii=False)[:80],
                  "| history:", json.dumps(rebuilt.get(k), ensure_ascii=False)[:80])
    return 1


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--endpoint")
    p.add_argument("--month", help="YYYY-MM")
    p.add_argument("--history", required=True, help="JSON from GET /history?endpoint=...")
    p.add_argument("--prev", help="previous month's ring file for this endpoint")
    p.add_argument("--witness", action="append", help="third-party witness record(s), repeatable")
    p.add_argument("--out", default="rings")
    p.add_argument("--force", action="store_true")
    p.add_argument("--verify", help="ring file to verify against --history")
    a = p.parse_args()
    if a.verify:
        sys.exit(cmd_verify(a))
    if not a.month or not re.match(r"^\d{4}-\d{2}$", a.month):
        raise SystemExit("--month YYYY-MM required")
    cmd_make(a)


if __name__ == "__main__":
    main()
