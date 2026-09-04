"""
sources_live.py: assemble real sources for freshness_v3 without touching freshness_v3.py.

freshness_v3.verify_freshness and classify_beacon accept a sources dict. This module builds
one from files the operator synced with sync_headers.py:

    localheaders_mainnet.bin + .manifest.json   validated header chain (a chain, not a website)
    explorer_mempool_snapshot.json              mempool.space's own view of the same window
    explorer_blockstream_snapshot.json          blockstream.info's own view

Each explorer snapshot is that explorer's word and nothing more. The header chain is verified
against consensus rules on load. If the header file is refused, the source is still present in
the dict with an empty block set and its name is returned in `down`, so the quorum sees it as
down with the reason on the record, exactly as freshness_v3 expects. Nothing here is trusted
because of its file name; a snapshot whose shape is wrong is refused too.

Offline, deterministic, standard library only. freshness_v3.py stays byte for byte what entry
24 pinned.
"""
import json, io, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import localheaders as LH

EMPTY = {"chain": "bitcoin", "tip": 0, "blocks": {}}


def load_snapshot(path):
    with io.open(path, encoding="utf-8") as f:
        d = json.load(f)
    if d.get("chain") != "bitcoin" or not isinstance(d.get("tip"), int) or not isinstance(d.get("blocks"), dict):
        raise ValueError("snapshot %s: wrong shape" % path)
    blocks = {}
    for k, v in d["blocks"].items():
        h = int(k)
        if not (isinstance(v.get("value"), str) and len(v["value"]) == 64 and isinstance(v.get("time"), int)):
            raise ValueError("snapshot %s: bad block %s" % (path, k))
        blocks[h] = {"value": v["value"].lower(), "time": v["time"]}
    return {"chain": "bitcoin", "tip": d["tip"], "blocks": blocks}


def load_sources(directory=".", now=None, prefix="localheaders_mainnet",
                 explorers=("mempool", "blockstream")):
    """Returns (sources, down, report). sources always has all three names."""
    sources = {}; down = set(); report = {}
    for name in explorers:
        p = os.path.join(directory, "explorer_%s_snapshot.json" % name)
        try:
            sources[name] = load_snapshot(p); report[name] = {"loaded": True, "tip": sources[name]["tip"], "blocks": len(sources[name]["blocks"])}
        except (OSError, ValueError, json.JSONDecodeError) as e:
            sources[name] = dict(EMPTY, blocks={}); down.add(name); report[name] = {"loaded": False, "why": str(e)}
    bp = os.path.join(directory, prefix + ".bin"); mp = os.path.join(directory, prefix + ".manifest.json")
    if os.path.exists(bp) and os.path.exists(mp):
        src, rep = LH.load_source(bp, mp, LH.MAINNET, now=now)
        if src is None:
            sources["localheaders"] = dict(EMPTY, blocks={}); down.add("localheaders"); report["localheaders"] = {"loaded": False, **rep}
        else:
            sources["localheaders"] = src
            report["localheaders"] = {"loaded": True, "tip": rep["tip_height"], "blocks": rep["count"],
                                      "retarget_verified_at": rep["retarget_verified_at"], "unverified": rep["unverified"],
                                      "checkpoints_matched": rep["checkpoints_matched"], "future_check": rep["future_check"]}
    else:
        sources["localheaders"] = dict(EMPTY, blocks={}); down.add("localheaders"); report["localheaders"] = {"loaded": False, "why": "no header file"}
    return sources, frozenset(down), report


if __name__ == "__main__":
    d = sys.argv[1] if len(sys.argv) > 1 else "."
    srcs, down, rep = load_sources(d)
    print(json.dumps({"down": sorted(down), "report": rep}, indent=1, ensure_ascii=False))
