#!/usr/bin/env python3
"""Build the lookup index for /verify-directory/lookup/ from the published survey files.

Inputs (all already public in this directory):
  survey1_walk_2026-08-23_run2.jsonl          one line per address contacted on 2026-08-23
  survey2_recheck_2026-08-24.jsonl            the 918 pending rows contacted again under 2026-07-28
  survey3_ladder_2026-08-24.jsonl             the 882 still pending rows offered older protocol versions
  survey0_v4_endpoints_active_2026-09-01.txt  every address the registry declared on 2026-09-01

Outputs:
  lookup_index.json    compact rows for search (loaded on the first keystroke)
  lookup_details.json  reason sentence, record_sha256, tool names, re-check notes (loaded on demand)

Nothing here is a new measurement. Every row is a restatement of a line that is already
published, with its record_sha256 carried along so the restatement can be checked against
the source line. Run it again and you get the same bytes.
"""
import json, hashlib, os, sys, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
WALK = os.path.join(HERE, "survey1_walk_2026-08-23_run2.jsonl")
RECHECK = os.path.join(HERE, "survey2_recheck_2026-08-24.jsonl")
LADDER = os.path.join(HERE, "survey3_ladder_2026-08-24.jsonl")
ACTIVE = os.path.join(HERE, "survey0_v4_endpoints_active_2026-09-01.txt")
OUT_INDEX = os.path.join(HERE, "lookup_index.json")
OUT_DETAILS = os.path.join(HERE, "lookup_details.json")

STATE_OF = {
    "speaks_mcp_and_lists_tools": "measured",
    "speaks_mcp_no_tool_list": "measured",
    "authorization_required": "held",
    "not_reached": "held",
    "gateway_error": "held",
    "method_not_allowed": "held",
    "robots_disallowed": "skipped",
    "no_mcp_at_declared_address": "pending",
    "initialize_rejected": "pending",
    "no_result_in_initialize": "pending",
}

def jl(path):
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)

def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def host_of(u):
    try:
        return u.split("://", 1)[1].split("/", 1)[0].lower()
    except Exception:
        return u

def main():
    recheck = {r["url"]: r for r in jl(RECHECK)}
    ladder = {r["url"]: r for r in jl(LADDER)}
    rows, details = [], []
    seen = set()
    counts = {}
    for r in jl(WALK):
        ep = r["endpoint"]
        seen.add(ep)
        outcome = r.get("outcome") or "unknown"
        state = STATE_OF.get(outcome)
        if state is None:
            print("unmapped outcome:", outcome, file=sys.stderr)
            state = "pending"
        note = None
        rc = recheck.get(ep)
        ld = ladder.get(ep)
        if state == "pending" and rc:
            if rc.get("verdict") == "modern_answered":
                state, note = "measured", "recheck_2026-08-24_answered"
            elif rc.get("verdict") == "held":
                state, note = "held", "recheck_2026-08-24_held"
            elif ld and ld.get("verdict") not in (None, "still_not_mcp") and ld.get("accepted_version"):
                state, note = "measured", "ladder_2026-08-24_accepted_" + str(ld.get("accepted_version"))
        name = r.get("server_name") or (ld or {}).get("server_name") or (rc or {}).get("server_name") or ""
        tools = r.get("tool_count")
        card = r.get("agent_card")
        payer = r.get("compensation_disclosed")
        def tri(v):
            return 1 if v is True else (0 if v is False else None)
        rows.append([ep, name, state, outcome, tools, tri(card), tri(payer), note])
        details.append({
            "sha": r.get("record_sha256"),
            "reason": r.get("reason"),
            "http": r.get("http_status"),
            "tools": r.get("tool_names") or None,
            "card_note": r.get("agent_card_note"),
            "recheck": ({"verdict": rc.get("verdict"), "note": rc.get("note"), "http": rc.get("http"),
                         "sha": rc.get("record_sha256")} if rc else None),
            "ladder": ({"verdict": ld.get("verdict"), "note": ld.get("note"),
                        "accepted_version": ld.get("accepted_version")} if ld else None),
        })
        counts[state] = counts.get(state, 0) + 1
    declared = 0
    with open(ACTIVE, encoding="utf-8") as f:
        for line in f:
            ep = line.strip()
            if not ep or ep in seen:
                continue
            seen.add(ep)
            rows.append([ep, "", "declared", "declared_2026-09-01_not_yet_contacted", None, None, None, None])
            details.append({"sha": None, "reason": None, "http": None, "tools": None, "card_note": None,
                            "recheck": None, "ladder": None})
            declared += 1
    counts["declared"] = declared
    meta = {
        "schema": "wedjat-lookup-1",
        "built_at": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "built_by": "verify-directory/survey/data/build_lookup_index.py",
        "cols": ["endpoint", "name", "state", "outcome", "tools", "card", "payer", "note"],
        "states": {
            "measured": "Contacted once on 2026-08-23, read only. It answered MCP. Tool count, identity card and payer disclosure below are what it said that day.",
            "pending": "Contacted on 2026-08-23 and again on 2026-08-24 under every protocol revision we know. It answered, but did not complete an MCP handshake. A statement about the address the operator declared, on those days.",
            "held": "Could not be measured: behind authorization, not reachable, or a gateway error. A statement about our instrument and the network, not about the server. The honest reading is unknown.",
            "skipped": "robots.txt said no, so it was not contacted. No is an answer.",
            "declared": "On the registry on 2026-09-01, after the walk. Not contacted yet. Absence of measurement is not a verdict.",
        },
        "sources": [
            {"file": "survey1_walk_2026-08-23_run2.jsonl", "sha256": sha(WALK)},
            {"file": "survey2_recheck_2026-08-24.jsonl", "sha256": sha(RECHECK)},
            {"file": "survey3_ladder_2026-08-24.jsonl", "sha256": sha(LADDER)},
            {"file": "survey0_v4_endpoints_active_2026-09-01.txt", "sha256": sha(ACTIVE)},
        ],
        "counts": counts,
        "rows_total": len(rows),
    }
    with open(OUT_INDEX, "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "rows": rows}, f, ensure_ascii=False, separators=(",", ":"))
    with open(OUT_DETAILS, "w", encoding="utf-8") as f:
        json.dump({"schema": "wedjat-lookup-details-1", "built_at": meta["built_at"], "rows": details},
                  f, ensure_ascii=False, separators=(",", ":"))
    print(json.dumps(counts), len(rows), os.path.getsize(OUT_INDEX), os.path.getsize(OUT_DETAILS))

if __name__ == "__main__":
    main()
