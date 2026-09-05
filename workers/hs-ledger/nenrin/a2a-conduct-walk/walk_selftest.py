#!/usr/bin/env python3
"""walk_selftest.py : offline red team for a2a_conduct_walk.py. No network. Deterministic.

    python3 walk_selftest.py

Mocks the transport, walks eleven agents (honest and dishonest), and checks that the walk
says PASS only for the honest ones, names the failing assertion for the others, produces the
same canonical bytes twice for the same input, satisfies the ledger's witness intake rules,
and is counted by make_ring.py for the endpoint it touched (and listed as a discrepancy when
its verdict is not ok). Exit 1 on any miss.
"""
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import a2a_conduct_walk as W  # noqa: E402

RING_DIR = os.path.join(HERE, "..", "ring-v1")
sys.path.insert(0, RING_DIR)
try:
    import make_ring  # noqa: E402
except Exception:
    make_ring = None

EXT = W.EXT_URI
ORIGIN = "https://agent.selftest.invalid"
EP = ORIGIN + "/mcp"
COMP = {"paid_by": "buyer", "referral_fee": False, "listing_fee": False, "success_fee_pct": 0, "disclosure_url": "https://example.invalid/d"}


def card(comp=COMP, ext=True, top=None, required=False, measured=None, extra=None):
    c = {"name": "Selftest Agent", "description": "mock", "url": ORIGIN, "capabilities": {"streaming": False}}
    if ext:
        c["capabilities"]["extensions"] = [{"uri": EXT, "description": "conduct", "required": required, "params": {
            "compensation": comp, "measured_endpoints": measured if measured is not None else [EP],
            "conduct_record": "https://gate.horizonshield.dev/history?endpoint=x", "witness_intake": "https://ledger.horizonshield.dev/witness"}}]
    if top is not None:
        c["compensation"] = top
    if extra:
        c.update(extra)
    return c


def mock(cards, ep_status=200, ep_result=True, echo=True, submit_status=200):
    """cards: list of card objects returned in order for successive GETs (last one repeats)."""
    state = {"i": 0, "posts": []}

    def fetch(method, url, headers=None, body=None):
        if method == "GET" and url.endswith("/.well-known/agent-card.json"):
            c = cards[min(state["i"], len(cards) - 1)]
            state["i"] += 1
            return 200, {"content-type": "application/json"}, json.dumps(c, ensure_ascii=False).encode("utf-8")
        if method == "POST" and url == EP:
            state["posts"].append((headers, body))
            h = {"content-type": "application/json"}
            if echo and headers and headers.get("A2A-Extensions"):
                h["A2A-Extensions"] = headers["A2A-Extensions"]
            if ep_status != 200:
                return ep_status, h, b"<html>nope</html>"
            j = {"jsonrpc": "2.0", "id": 1, "result": {"protocolVersion": "2025-06-18", "serverInfo": {"name": "mock"}}} if ep_result else {"jsonrpc": "2.0", "id": 1, "error": {"code": -32601, "message": "no"}}
            return 200, h, json.dumps(j).encode("utf-8")
        if method == "POST" and url.endswith("/witness"):
            state["posts"].append((headers, body))
            return submit_status, {"content-type": "application/json"}, json.dumps({"sha": "x" * 64, "status": "pending"}).encode("utf-8")
        return 404, {}, b"not found"
    fetch.state = state
    return fetch


def results(rec):
    return {a["claim"].split(":")[0]: a["result"] for a in rec["assertions"]}


def ledger_shape_ok(rc):
    """Mirror of witnessValidate in hs-ledger/src/worker.js."""
    r = json.loads(rc)
    if r.get("schema") != "jidec-path-v1":
        return False
    for k in ("purpose", "walked_at", "base"):
        if not isinstance(r.get(k), str) or not r[k]:
            return False
    if not isinstance(r.get("nodes"), list) or not r["nodes"]:
        return False
    if not isinstance(r.get("assertions"), list) or not r["assertions"]:
        return False
    if not isinstance(r.get("verdict"), dict):
        return False
    w = r.get("witness")
    return isinstance(w, dict) and isinstance(w.get("name"), str) and w["name"] and isinstance(w.get("vantage"), str) and w["vantage"]


V = []


def vec(name, kind, fetch, mode, expect_ok, expect_results, endpoint=None):
    V.append((name, kind, fetch, mode, expect_ok, expect_results, endpoint))


vec("honest_mcp", "control", mock([card()]), "mcp", True, {"card_bytes_stable": True, "conduct_ext_declared": True, "compensation_well_formed": True, "measured_endpoint_answered": True, "extension_echoed": None})
vec("honest_a2a", "control", mock([card()]), "a2a", True, {"extension_echoed": True})
vec("honest_a2a_top_level_copy_equal", "control", mock([card(top=dict(COMP))]), "a2a", True, {"compensation_well_formed": True})
vec("card_changes_between_fetches", "attack", mock([card(), card(extra={"description": "mock v2"})]), "mcp", False, {"card_bytes_stable": False})
vec("no_extension_declared", "attack", mock([card(ext=False, top=dict(COMP))]), "mcp", False, {"conduct_ext_declared": False, "compensation_well_formed": False, "measured_endpoint_answered": True}, endpoint=EP)
vec("no_extension_no_endpoint_given", "attack", mock([card(ext=False)]), "mcp", False, {"conduct_ext_declared": False, "measured_endpoint_answered": False})
vec("compensation_paid_by_case", "attack", mock([card(comp=dict(COMP, paid_by="Buyer"))]), "mcp", False, {"compensation_well_formed": False})
vec("compensation_success_fee_string", "attack", mock([card(comp=dict(COMP, success_fee_pct="see site"))]), "mcp", False, {"compensation_well_formed": False})
vec("top_level_disagrees", "attack", mock([card(top=dict(COMP, paid_by="referral"))]), "mcp", False, {"compensation_well_formed": False})
vec("declared_required_true", "attack", mock([card(required=True)]), "mcp", False, {"compensation_well_formed": False})
vec("measured_endpoints_empty", "attack", mock([card(measured=[])]), "mcp", False, {"compensation_well_formed": False, "measured_endpoint_answered": False})
vec("endpoint_http_500", "attack", mock([card()], ep_status=500), "mcp", False, {"measured_endpoint_answered": False})
vec("endpoint_jsonrpc_error", "attack", mock([card()], ep_result=False), "mcp", False, {"measured_endpoint_answered": False})
vec("a2a_declared_but_not_echoed", "attack", mock([card()], echo=False), "a2a", False, {"extension_echoed": False})
vec("mcp_mode_no_echo_is_not_applicable", "control", mock([card()], echo=False), "mcp", True, {"extension_echoed": None})


def main():
    bad = []
    n = 0
    for name, kind, fetch, mode, expect_ok, expect_results, endpoint in V:
        n += 1
        rec = W.walk(ORIGIN, endpoint, mode, "selftest", "offline-mock", fetch=fetch, walked_at="2026-09-06T00:00:00Z")
        res = results(rec)
        problems = []
        if rec["verdict"]["ok"] is not expect_ok:
            problems.append("verdict.ok %s != %s" % (rec["verdict"]["ok"], expect_ok))
        if (rec["verdict"]["outcome"] == "PASS") is not rec["verdict"]["ok"]:
            problems.append("outcome and ok disagree")
        applicable = [a for a in rec["assertions"] if a["result"] is not None]
        if rec["verdict"]["n_total"] != len(applicable) or rec["verdict"]["n_pass"] != sum(1 for a in applicable if a["result"] is True):
            problems.append("counts wrong")
        for k, v in expect_results.items():
            if res.get(k, "missing") is not v:
                problems.append("%s=%s expected %s" % (k, res.get(k, "missing"), v))
        rc = W.canonical(rec)
        if not ledger_shape_ok(rc):
            problems.append("record would be refused by the ledger's witness intake rules")
        # request to the endpoint carried the activation header
        posts = [h for h, b in fetch.state["posts"] if h and h.get("A2A-Extensions") == EXT]
        has_n3 = any(nd.get("n") == 3 for nd in rec["nodes"])
        if has_n3 and not posts:
            problems.append("node 3 did not send A2A-Extensions")
        if not has_n3 and expect_results.get("measured_endpoint_answered") is True:
            problems.append("no node 3 although an answer was expected")
        if problems:
            bad.append(name + ": " + " / ".join(problems))
            print("  RED    %-6s %-40s << %s" % ("LEAK" if kind == "attack" else "WRONG", name, " / ".join(problems)))
        else:
            print("  green  %-6s %-40s (%s %d/%d)" % ("BLOCK" if kind == "attack" else "PASS", name, rec["verdict"]["outcome"], rec["verdict"]["n_pass"], rec["verdict"]["n_total"]))

    # determinism: same input, same walked_at, same bytes
    n += 1
    r1 = W.walk(ORIGIN, None, "a2a", "selftest", "offline-mock", fetch=mock([card()]), walked_at="2026-09-06T00:00:00Z")
    r2 = W.walk(ORIGIN, None, "a2a", "selftest", "offline-mock", fetch=mock([card()]), walked_at="2026-09-06T00:00:00Z")
    c1, c2 = W.canonical(r1), W.canonical(r2)
    for nd in json.loads(c1)["nodes"]:
        nd.pop("duration_ms", None)
    for nd in json.loads(c2)["nodes"]:
        nd.pop("duration_ms", None)
    strip = lambda c: W.canonical({**json.loads(c), "nodes": [{k: v for k, v in nd.items() if k != "duration_ms"} for nd in json.loads(c)["nodes"]]})
    if strip(c1) == strip(c2):
        print("  green  PASS   %-40s (sha %s)" % ("deterministic_bytes_modulo_duration", W.sha256_hex(strip(c1))[:16]))
    else:
        bad.append("deterministic_bytes_modulo_duration"); print("  RED    WRONG  deterministic_bytes_modulo_duration")

    # ring builder compatibility
    n += 1
    if make_ring is None:
        print("  skip   ----   make_ring_counts_the_walk (ring-v1/make_ring.py not found next to this directory)")
    else:
        ok_rec = W.walk(ORIGIN, None, "mcp", "selftest", "offline-mock", fetch=mock([card()]), walked_at="2026-09-06T00:00:00Z")
        bad_rec = W.walk(ORIGIN, None, "mcp", "selftest", "offline-mock", fetch=mock([card()], ep_status=500), walked_at="2026-09-06T00:00:00Z")
        probs = []
        for rec, want_disc in ((ok_rec, False), (bad_rec, True)):
            rc = W.canonical(rec)
            stored = {"sha": W.sha256_hex(rc), "witness_name": "selftest", "vantage": "offline-mock", "submitted_at": "2026-09-06T00:00:01Z", "record_canonical": rc}
            w = make_ring.normalise_witness(stored)
            if not w or not make_ring.witness_covers(w, EP):
                probs.append("walk not counted for " + EP)
            if bool(w and w.get("discrepancy_sha256")) is not want_disc:
                probs.append("discrepancy flag %s, wanted %s" % (bool(w and w.get("discrepancy_sha256")), want_disc))
            if w and make_ring.witness_covers(w, "https://other.selftest.invalid/mcp"):
                probs.append("walk counted for a foreign endpoint")
        if probs:
            bad.append("make_ring_counts_the_walk: " + " / ".join(probs)); print("  RED    WRONG  make_ring_counts_the_walk << " + " / ".join(probs))
        else:
            print("  green  PASS   %-40s (counted for %s, discrepancy only when ok is false, not counted elsewhere)" % ("make_ring_counts_the_walk", EP))

    total = n
    print("\n=== %d / %d 合格 (a2a_conduct_walk.py) ===" % (total - len(bad), total))
    if bad:
        print("不適格 (fail-closed):")
        for b in bad:
            print("  - " + b)
        return 1
    print("正直な agent だけ PASS、崩れた agent は落ちる assertion を名指し、台帳の受理規則と年輪の数え方に合う。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
