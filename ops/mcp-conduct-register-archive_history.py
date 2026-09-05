#!/usr/bin/env python3
"""
Archive the gate's /history for every endpoint on the register into history/<slug>.json.
Append-only, keyed by record_sha256. Runs daily in mcp-conduct-register after build_register.py.

Why this exists: the gate keeps a bounded number of records per endpoint (30 until 2026-09-05,
400 after) and drops the oldest beyond that. KV is not a durable record. This directory is.
Monthly rings (nenrin-ring-v1) are built from these files, and anyone can rebuild them from here.

Nothing is ever removed from an archive file. If the gate's export shrinks, the archive keeps
what it already held. If the gate corrects an old entry by annotation (it never edits bytes),
the annotation is not copied onto the archived entry: the archive holds the entry as first seen.
"""

import io, json, os, re, sys, time, urllib.parse, urllib.request

REGISTER = "register.json"
OUT = "history"
GATE = "https://gate.horizonshield.dev/history?endpoint="
UA = "mcp-conduct-register/1.0 (+https://github.com/ogasurfproject-jpg/mcp-conduct-register)"


def slug(endpoint):
    # Identical to make_ring.slug in nenrin-ring-v1, so a ring built from this file names the same slug.
    return re.sub(r"[^a-z0-9]+", "-", endpoint.replace("https://", "").lower()).strip("-")


def key(e):
    return e.get("record_sha256") or ("noid:" + str(e.get("at")))


def fetch(endpoint):
    url = GATE + urllib.parse.quote(endpoint, safe="") + "&cb=" + str(int(time.time()))
    req = urllib.request.Request(url, headers={"user-agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    reg = json.load(io.open(REGISTER, encoding="utf-8"))
    rows = reg.get("rows") or []
    os.makedirs(OUT, exist_ok=True)
    changed, failed = 0, 0
    for row in rows:
        ep = row.get("endpoint")
        if not ep:
            continue
        path = os.path.join(OUT, slug(ep) + ".json")
        try:
            live = fetch(ep)
        except Exception as e:
            print("%s: not fetched (%s); archive left as it was" % (slug(ep), e), file=sys.stderr)
            failed += 1
            continue
        if os.path.exists(path):
            old = json.load(io.open(path, encoding="utf-8"))
        else:
            old = {"endpoint": ep, "entries": []}
        seen = set(key(e) for e in old["entries"])
        added = [e for e in (live.get("entries") or []) if key(e) not in seen]
        # A file copied in by hand (the first eight, 2026-09-05) has no archive block yet. Stamp it once,
        # so the block exists and the count is stated; after that, rewrite only when records are added.
        if not added and os.path.exists(path) and isinstance(old.get("archive"), dict):
            print("%s: no new records (%d archived)" % (slug(ep), len(old["entries"])))
            continue
        entries = old["entries"] + added
        entries.sort(key=lambda e: (e.get("at") or "", key(e)))
        doc = {
            "endpoint": ep,
            "entries": entries,
            "archive": {
                "schema": "mcp-conduct-history-archive-v1",
                "source": GATE + urllib.parse.quote(ep, safe=""),
                "rule": "append-only union of every export seen, keyed by record_sha256; nothing is removed",
                "gate_retention_at_last_fetch": (live.get("retention") or {}).get("kept_max"),
                "last_fetch_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "count": len(entries),
            },
        }
        io.open(path, "w", encoding="utf-8").write(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
        changed += 1
        print("%s: +%d, %d archived%s" % (slug(ep), len(added), len(entries), "" if added else " (archive block added)"))
    print("archive: %d file(s) changed, %d endpoint(s) not fetched" % (changed, failed))
    return 0


if __name__ == "__main__":
    sys.exit(main())
