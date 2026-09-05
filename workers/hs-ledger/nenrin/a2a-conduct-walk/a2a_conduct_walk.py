#!/usr/bin/env python3
"""a2a_conduct_walk.py : reference client for the A2A Conduct Extension v1 witness walk.

Walks one agent the way section 4 of CONDUCT_EXT_v1.md says, writes a jidec-path-v1 record
with a witness field, prints its sha256, and (with --submit) files it at the witness intake
the agent's own card points to. Standard library only, Python 3.8 or later.

    python3 a2a_conduct_walk.py --origin https://mcp.horizonshield.dev \\
        --witness-name "your name or anonymous" --vantage "your network or tool" \\
        [--endpoint https://mcp.horizonshield.dev/mcp] [--mode mcp|a2a] [--out walk.json] [--submit]

What it asserts (each one pinned by sha256 of the bytes it turned on):
    card_bytes_stable           two fetches of the agent card, seconds apart, are the same bytes
    conduct_ext_declared        the card lists the extension URI under capabilities.extensions[]
    compensation_well_formed    params.compensation has the shape section 2 requires
    measured_endpoint_answered  the measured endpoint answered a JSON-RPC request with a result
    extension_echoed            (a2a mode only) the response header A2A-Extensions carries the URI

What it does not do: it does not judge quality, it does not read the conduct record for you,
and a PASS is not a verdict about the agent. It is one observation, filed where anyone can
read it and count it. Canonical bytes: keys sorted at every level, separators , and : with no
spaces, non-ASCII unescaped. sha256 of those bytes is the record's identity.
"""
import argparse
import hashlib
import io
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

EXT_URI = "https://gate.horizonshield.dev/ext/conduct/v1"
PAID_BY = ["buyer", "seller", "referral", "advertising", "subscription", "public", "other"]
WALKER = {"tool": "a2a_conduct_walk.py", "version": "1"}
TIMEOUT = 20


def canonical(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_hex(b):
    if isinstance(b, str):
        b = b.encode("utf-8")
    return hashlib.sha256(b).hexdigest()


def headers_sha256(headers):
    lines = sorted("%s: %s" % (str(k).lower(), str(v)) for k, v in (headers or {}).items())
    return sha256_hex("\n".join(lines))


def http_fetch(method, url, headers=None, body=None):
    """Real transport. Returns (status, headers_dict, body_bytes). Never raises on HTTP status."""
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.status, dict(r.headers.items()), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers.items()), e.read()
    except Exception as e:  # transport failure: no status, named in the node
        return 0, {"x-transport-error": str(e)}, b""


def fetch_node(n, fetch, method, url, headers=None, body=None):
    t0 = time.time()
    status, rh, rb = fetch(method, url, headers, body)
    node = {
        "n": n,
        "kind": "fetch",
        "request": {"method": method, "url": url, "headers_sha256": headers_sha256(headers or {}), "body_sha256": sha256_hex(body) if body else None},
        "response": {"status": status, "headers_sha256": headers_sha256(rh), "body_sha256": sha256_hex(rb)},
        "duration_ms": int((time.time() - t0) * 1000),
    }
    echo = None
    for k, v in (rh or {}).items():
        if str(k).lower() == "a2a-extensions":
            echo = str(v)
    node["response"]["a2a_extensions"] = echo
    return node, status, rb


def compensation_problems(c):
    """Section 2 shape. Returns a list of reasons; empty means well formed. Content is not judged."""
    p = []
    if not isinstance(c, dict):
        return ["compensation is not an object"]
    if c.get("paid_by") not in PAID_BY:
        p.append("paid_by not one of " + ",".join(PAID_BY))
    for k in ("referral_fee", "listing_fee"):
        if not isinstance(c.get(k), bool):
            p.append(k + " not boolean")
    if "success_fee_pct" in c:
        v = c["success_fee_pct"]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or v < 0 or v > 100:
            p.append("success_fee_pct not a number in 0..100")
    if "disclosure_url" in c and c["disclosure_url"] is not None and not isinstance(c["disclosure_url"], str):
        p.append("disclosure_url not a string")
    return p


def is_https(u):
    return isinstance(u, str) and u.startswith("https://")


def locate_extension(card):
    """Returns (ext_or_None, problems[])."""
    if not isinstance(card, dict):
        return None, ["card is not a JSON object"]
    caps = card.get("capabilities")
    exts = caps.get("extensions") if isinstance(caps, dict) else None
    if not isinstance(exts, list):
        return None, ["capabilities.extensions is not an array"]
    found = [e for e in exts if isinstance(e, dict) and e.get("uri") == EXT_URI]
    if not found:
        return None, ["extension URI not declared"]
    ext = found[0]
    problems = []
    params = ext.get("params")
    if not isinstance(params, dict):
        return ext, ["params is not an object"]
    problems += compensation_problems(params.get("compensation"))
    me = params.get("measured_endpoints")
    if not isinstance(me, list) or not me or not all(is_https(x) for x in me):
        problems.append("measured_endpoints missing, empty, or not https strings")
    for k in ("conduct_record", "witness_intake"):
        if not is_https(params.get(k)):
            problems.append(k + " missing or not https")
    if ext.get("required") is True:
        problems.append("declared required: true (a data-only extension must not be)")
    # top-level copy, if any, must agree on the five keys
    top = card.get("compensation")
    if isinstance(top, dict) and isinstance(params.get("compensation"), dict):
        K = ["paid_by", "referral_fee", "listing_fee", "success_fee_pct", "disclosure_url"]
        if any(canonical(top.get(k)) != canonical(params["compensation"].get(k)) for k in K):
            problems.append("top-level compensation disagrees with params.compensation")
    return ext, problems


def rpc_body(mode, request_id=1):
    if mode == "a2a":
        return json.dumps({
            "jsonrpc": "2.0", "id": request_id, "method": "SendMessage",
            "params": {"message": {"messageId": "conduct-walk-" + str(request_id), "role": "user", "kind": "message",
                                    "parts": [{"kind": "text", "text": "a2a-conduct-walk-v1: reading the conduct pointers of this agent"}]}},
        }, ensure_ascii=False).encode("utf-8")
    return json.dumps({
        "jsonrpc": "2.0", "id": request_id, "method": "initialize",
        "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "a2a_conduct_walk", "version": "1"}},
    }).encode("utf-8")


def walk(origin, endpoint, mode, witness_name, vantage, fetch=http_fetch, walked_at=None):
    origin = origin.rstrip("/")
    walked_at = walked_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    card_url = origin + "/.well-known/agent-card.json"
    nodes = []
    n0, s0, b0 = fetch_node(0, fetch, "GET", card_url, {"Accept": "application/json"})
    n1, s1, b1 = fetch_node(1, fetch, "GET", card_url, {"Accept": "application/json"})
    nodes += [n0, n1]

    try:
        card = json.loads(b1.decode("utf-8")) if s1 == 200 else None
    except Exception:
        card = None
    ext, problems = locate_extension(card)
    params = ext.get("params") if isinstance(ext, dict) and isinstance(ext.get("params"), dict) else {}
    measured = params.get("measured_endpoints") if isinstance(params.get("measured_endpoints"), list) else []
    target = endpoint or (measured[0] if measured and is_https(measured[0]) else None)
    validation = {"extension_declared": ext is not None, "problems": problems, "target": target}
    nodes.append({
        "n": 2, "kind": "compute",
        "label": "locate " + EXT_URI + " in node 1 and validate params (section 2 of CONDUCT_EXT_v1.md)",
        "inputs": [{"from_node": 1}],
        "output_sha256": sha256_hex(canonical(validation)),
        "output_preview": ("declared" if ext is not None else "not declared") + ("; " + "; ".join(problems) if problems else "; well formed"),
    })

    n3 = None
    answered = False
    echoed = None
    if target:
        body = rpc_body(mode)
        n3, s3, b3 = fetch_node(3, fetch, "POST", target, {"Content-Type": "application/json", "Accept": "application/json", "A2A-Extensions": EXT_URI}, body)
        nodes.append(n3)
        try:
            j = json.loads(b3.decode("utf-8")) if s3 == 200 else None
            answered = isinstance(j, dict) and "result" in j and j.get("result") is not None
        except Exception:
            answered = False
        if mode == "a2a":
            e = n3["response"].get("a2a_extensions") or ""
            echoed = EXT_URI in [x.strip() for x in e.split(",")]

    def A(claim, result, nodes_, observed, note=None):
        a = {"claim": claim, "op": "eq", "result": result, "evidence_nodes": nodes_, "observed_sha256": sha256_hex(observed)}
        if note:
            a["note"] = note
        return a

    assertions = [
        A("card_bytes_stable: node0.body_sha256 == node1.body_sha256", s0 == 200 and s1 == 200 and n0["response"]["body_sha256"] == n1["response"]["body_sha256"], [0, 1], n0["response"]["body_sha256"] + n1["response"]["body_sha256"]),
        A("conduct_ext_declared: card lists " + EXT_URI + " under capabilities.extensions[]", ext is not None, [1, 2], canonical(ext) if ext is not None else "absent"),
        A("compensation_well_formed: params.compensation has the section 2 shape and agrees with any top-level copy", ext is not None and not problems, [1, 2], canonical(problems)),
        A("measured_endpoint_answered: POST " + (target or "(no target)") + " returned http 200 with a JSON-RPC result", bool(target) and answered, [3] if n3 else [2], (n3["response"]["body_sha256"] if n3 else "no-node") + ":" + str(answered)),
    ]
    if mode == "a2a":
        assertions.append(A("extension_echoed: response header A2A-Extensions contains " + EXT_URI, bool(echoed), [3] if n3 else [2], str(n3["response"].get("a2a_extensions") if n3 else None)))
    else:
        assertions.append(A("extension_echoed", None, [3] if n3 else [2], "not applicable", note="not applicable: node 3 was an MCP initialize, not an A2A message; the echo is only required on A2A requests"))

    applicable = [a for a in assertions if a["result"] is not None]
    n_pass = sum(1 for a in applicable if a["result"] is True)
    ok = n_pass == len(applicable)
    record = {
        "schema": "jidec-path-v1",
        "purpose": "a2a-conduct-walk-v1: " + (target or origin),
        "walked_at": walked_at,
        "walker": WALKER,
        "base": origin,
        "nodes": nodes,
        "assertions": assertions,
        "verdict": {"ok": ok, "outcome": "PASS" if ok else "FAIL", "n_pass": n_pass, "n_total": len(applicable)},
        "replay": {
            "how": "re-run a2a_conduct_walk.py against base with the same mode; recompute every node body_sha256 and re-evaluate assertions",
            "match_means": "the card and the endpoint answer the same bytes as when this walk was anchored",
            "mismatch_means": "the live agent now differs from the anchored observation; a changed card is a finding, not an error in the walk",
        },
        "witness": {"name": witness_name, "vantage": vantage},
        "conduct_ext": {"uri": EXT_URI, "mode": mode, "conduct_record": params.get("conduct_record"), "witness_intake": params.get("witness_intake")},
        "prev_path_refs": [],
    }
    return record


def submit(intake, record_canonical, fetch=http_fetch):
    body = json.dumps({"record_canonical": record_canonical}, ensure_ascii=False).encode("utf-8")
    status, rh, rb = fetch("POST", intake, {"Content-Type": "application/json", "Accept": "application/json"}, body)
    try:
        return status, json.loads(rb.decode("utf-8"))
    except Exception:
        return status, {"raw": rb.decode("utf-8", "replace")[:400]}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--origin", required=True, help="agent origin, e.g. https://mcp.horizonshield.dev")
    ap.add_argument("--endpoint", help="measured endpoint to POST; default: first params.measured_endpoints entry from the card")
    ap.add_argument("--mode", choices=["mcp", "a2a"], default="mcp", help="node 3 body: MCP initialize (default) or A2A SendMessage")
    ap.add_argument("--witness-name", required=True, help="who you are, or anonymous")
    ap.add_argument("--vantage", required=True, help="network or tool the walk is taken from")
    ap.add_argument("--out", default=None, help="write the canonical bytes here (default: walk_<sha12>.json)")
    ap.add_argument("--submit", action="store_true", help="POST the record to the witness intake named in the card")
    ap.add_argument("--intake", default=None, help="override the witness intake URL (default: params.witness_intake from the card)")
    a = ap.parse_args(argv)

    rec = walk(a.origin, a.endpoint, a.mode, a.witness_name, a.vantage)
    rc = canonical(rec)
    sha = sha256_hex(rc)
    out = a.out or ("walk_" + sha[:12] + ".json")
    io.open(out, "w", encoding="utf-8").write(rc)
    v = rec["verdict"]
    print("walk %s  %s %d/%d  sha256 %s  -> %s" % (rec["purpose"], v["outcome"], v["n_pass"], v["n_total"], sha, out))
    for x in rec["assertions"]:
        print("  %s  %s" % ({True: "pass", False: "FAIL", None: "n/a "}[x["result"]], x["claim"][:110]))
    if a.submit:
        intake = a.intake or rec["conduct_ext"].get("witness_intake")
        if not intake:
            print("no witness_intake in the card and no --intake given; not submitted")
            return 2
        st, j = submit(intake, rc)
        print("submitted to %s: http %d %s" % (intake, st, json.dumps(j, ensure_ascii=False)[:300]))
        return 0 if st in (200, 201) else 1
    return 0 if v["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
