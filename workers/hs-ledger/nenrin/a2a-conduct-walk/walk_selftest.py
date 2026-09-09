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


def card(comp=COMP, ext=True, top=None, required=False, measured=None, extra=None, uri=None):
    c = {"name": "Selftest Agent", "description": "mock", "url": ORIGIN, "capabilities": {"streaming": False}}
    if ext:
        c["capabilities"]["extensions"] = [{"uri": uri or EXT, "description": "conduct", "required": required, "params": {
            "compensation": comp, "measured_endpoints": measured if measured is not None else [EP],
            "conduct_record": "https://gate.horizonshield.dev/history?endpoint=x", "witness_intake": "https://ledger.horizonshield.dev/witness"}}]
    if top is not None:
        c["compensation"] = top
    if extra:
        c.update(extra)
    return c


def mock(cards, ep_status=200, ep_result=True, echo=True, submit_status=200, echo_spelling="mirror", answer_shape="wire"):
    """cards: list of card objects returned in order for successive GETs (last one repeats).

    echo_spelling: "mirror" (honest: A2A-Extensions always, plus X-A2A-Extensions when the request used it),
                   "new_only" (a server that only knows the 1.0 spelling: a 0.3 client never sees the echo),
                   "old_only" (a 0.3-era server that only echoes X-A2A-Extensions).
    answer_shape:  "wire" (honest: 1.0 shape to SendMessage, 0.3 shape to message/send),
                   "0.3" (always the kind-shaped result, even to SendMessage: what our own servers did before 2026-09-06),
                   "1.0" (always the wrapped result, even to message/send).
    """
    state = {"i": 0, "posts": []}

    def fetch(method, url, headers=None, body=None):
        if method == "GET" and url.endswith("/.well-known/agent-card.json"):
            c = cards[min(state["i"], len(cards) - 1)]
            state["i"] += 1
            return 200, {"content-type": "application/json"}, json.dumps(c, ensure_ascii=False).encode("utf-8")
        if method == "POST" and url == EP:
            state["posts"].append((headers, body))
            h = {"content-type": "application/json"}
            hdrs = {str(k).lower(): v for k, v in (headers or {}).items()}
            asked = hdrs.get("a2a-extensions") or hdrs.get("x-a2a-extensions")
            if echo and asked:
                if echo_spelling in ("mirror", "new_only"):
                    h["A2A-Extensions"] = asked
                if echo_spelling == "old_only" or (echo_spelling == "mirror" and "x-a2a-extensions" in hdrs):
                    h["X-A2A-Extensions"] = asked
            if ep_status != 200:
                return ep_status, h, b"<html>nope</html>"
            try:
                method_name = json.loads(body.decode("utf-8")).get("method")
            except Exception:
                method_name = None
            if not ep_result:
                j = {"jsonrpc": "2.0", "id": 1, "error": {"code": -32601, "message": "no"}}
            elif method_name in ("SendMessage", "message/send"):
                shape = answer_shape if answer_shape in ("0.3", "1.0") else ("1.0" if method_name == "SendMessage" else "0.3")
                msg03 = {"kind": "message", "role": "agent", "messageId": "m", "parts": [{"kind": "text", "text": "ok"}]}
                msg10 = {"message": {"role": "ROLE_AGENT", "messageId": "m", "parts": [{"text": "ok"}]}}
                j = {"jsonrpc": "2.0", "id": 1, "result": msg10 if shape == "1.0" else msg03}
            else:
                j = {"jsonrpc": "2.0", "id": 1, "result": {"protocolVersion": "2025-06-18", "serverInfo": {"name": "mock"}}}
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


def ledger_v11_reason(rc):
    """Mirror of the conduct-v1.1 branches of witnessValidate (worker.js, 2026-09-07). Returns the
    reason_code the intake would answer, or None when the record passes those branches."""
    r = json.loads(rc)
    if "mode" not in r:
        return None
    if r["mode"] not in ("full", "hash-only", "commitment"):
        return "bad_mode"
    ok_list = lambda x: isinstance(x, list) and x and all(isinstance(s, str) and s.strip() for s in x)
    if not ok_list(r.get("establishes")) or not ok_list(r.get("does_not_establish")):
        return "disclaimer_missing"
    if r["mode"] == "commitment":
        c = r.get("commitment")
        if not (isinstance(c, str) and len(c) == 64 and all(ch in "0123456789abcdef" for ch in c)):
            return "bad_commitment"
    else:
        if not r.get("nodes") or not r.get("assertions") or not isinstance(r.get("verdict"), dict):
            return "schema"
    if r["mode"] == "hash-only":
        from urllib.parse import urlsplit
        for nd in r["nodes"]:
            req = nd.get("request") if isinstance(nd, dict) else None
            if not isinstance(req, dict):
                continue
            if "url" in req:
                s = urlsplit(req["url"])
                if (s.path and s.path != "/") or s.query or s.fragment:
                    return "path_leaks_tool"
            if "method" in req and req["method"] != "REDACTED":
                return "path_leaks_tool"
    ku = r["witness"].get("key_url")
    if ku is not None and not (isinstance(ku, str) and ku.startswith("https://")):
        return "bad_key_url"
    return None


V = []


def vec(name, kind, fetch, mode, expect_ok, expect_results, endpoint=None, wire="1.0"):
    V.append((name, kind, fetch, mode, expect_ok, expect_results, endpoint, wire))


vec("honest_mcp", "control", mock([card()]), "mcp", True, {"card_bytes_stable": True, "conduct_ext_declared": True, "compensation_well_formed": True, "measured_endpoint_answered": True, "extension_echoed": None})
vec("honest_a2a", "control", mock([card()]), "a2a", True, {"extension_echoed": True})
vec("honest_a2a_top_level_copy_equal", "control", mock([card(top=dict(COMP))]), "a2a", True, {"compensation_well_formed": True})
vec("card_changes_between_fetches", "attack", mock([card(), card(extra={"description": "mock v2"})]), "mcp", False, {"card_bytes_stable": False})
vec("no_extension_declared", "attack", mock([card(ext=False, top=dict(COMP))]), "mcp", False, {"conduct_ext_declared": False, "compensation_well_formed": False, "measured_endpoint_answered": True}, endpoint=EP)
vec("no_extension_no_endpoint_given", "attack", mock([card(ext=False)]), "mcp", False, {"conduct_ext_declared": False, "measured_endpoint_answered": False})
# spec section 12 (2026-09-09): the w3id.org permanent identifier is the same extension; nothing else is.
vec("perma_id_declared", "control", mock([card(uri=W.EXT_PERMANENT_ID)]), "a2a", True, {"conduct_ext_declared": True, "compensation_well_formed": True, "extension_echoed": True})
vec("perma_id_next_version_is_not_this_one", "attack", mock([card(uri="https://w3id.org/horizonshield/conduct/v2")]), "mcp", False, {"conduct_ext_declared": False}, endpoint=EP)
vec("perma_id_foreign_project", "attack", mock([card(uri="https://w3id.org/someoneelse/conduct/v1")]), "mcp", False, {"conduct_ext_declared": False}, endpoint=EP)
vec("compensation_paid_by_case", "attack", mock([card(comp=dict(COMP, paid_by="Buyer"))]), "mcp", False, {"compensation_well_formed": False})
vec("compensation_success_fee_string", "attack", mock([card(comp=dict(COMP, success_fee_pct="see site"))]), "mcp", False, {"compensation_well_formed": False})
vec("top_level_disagrees", "attack", mock([card(top=dict(COMP, paid_by="referral"))]), "mcp", False, {"compensation_well_formed": False})
vec("declared_required_true", "attack", mock([card(required=True)]), "mcp", False, {"compensation_well_formed": False})
vec("measured_endpoints_empty", "attack", mock([card(measured=[])]), "mcp", False, {"compensation_well_formed": False, "measured_endpoint_answered": False})
vec("endpoint_http_500", "attack", mock([card()], ep_status=500), "mcp", False, {"measured_endpoint_answered": False})
vec("endpoint_jsonrpc_error", "attack", mock([card()], ep_result=False), "mcp", False, {"measured_endpoint_answered": False})
vec("a2a_declared_but_not_echoed", "attack", mock([card()], echo=False), "a2a", False, {"extension_echoed": False})
vec("mcp_mode_no_echo_is_not_applicable", "control", mock([card()], echo=False), "mcp", True, {"extension_echoed": None})
# 2026-09-06 second wave: two spellings of the header, two versions of the wire
vec("honest_a2a_wire03", "control", mock([card()]), "a2a", True, {"measured_endpoint_answered": True, "extension_echoed": True}, wire="0.3")
vec("a2a_wire03_server_echoes_new_spelling_only", "attack", mock([card()], echo_spelling="new_only"), "a2a", False, {"extension_echoed": False}, wire="0.3")
vec("a2a_wire10_server_echoes_old_spelling_only", "attack", mock([card()], echo_spelling="old_only"), "a2a", False, {"extension_echoed": False}, wire="1.0")
vec("a2a_wire10_server_answers_03_shape", "attack", mock([card()], answer_shape="0.3"), "a2a", False, {"measured_endpoint_answered": False, "extension_echoed": True}, wire="1.0")
vec("a2a_wire03_server_answers_10_shape", "attack", mock([card()], answer_shape="1.0"), "a2a", False, {"measured_endpoint_answered": False}, wire="0.3")


def main():
    bad = []
    n = 0
    for name, kind, fetch, mode, expect_ok, expect_results, endpoint, wire in V:
        n += 1
        rec = W.walk(ORIGIN, endpoint, mode, "selftest", "offline-mock", fetch=fetch, walked_at="2026-09-06T00:00:00Z", wire=wire)
        if mode == "a2a":
            sent = {str(k).lower() for k, _b in fetch.state["posts"][:1] for k in (k or {})}
            want = "a2a-extensions" if wire == "1.0" else "x-a2a-extensions"
            other = "x-a2a-extensions" if wire == "1.0" else "a2a-extensions"
            if not (want in sent and other not in sent):
                bad.append((name, "walk sent the wrong header spelling for wire " + wire + ": " + str(sorted(sent))))
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
        want_hdr = "X-A2A-Extensions" if (mode == "a2a" and wire == "0.3") else "A2A-Extensions"
        posts = [h for h, b in fetch.state["posts"] if h and h.get(want_hdr) == EXT]
        has_n3 = any(nd.get("n") == 3 for nd in rec["nodes"])
        if has_n3 and not posts:
            problems.append("node 3 did not send " + want_hdr)
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

    # conduct-v1.1 (2026-09-07): mode, disclaimers, hash-only redaction, commitment, signing.
    def v11(name, cond, detail=""):
        nonlocal n
        n += 1
        if cond:
            print("  green  PASS   %-40s %s" % (name, detail))
        else:
            bad.append(name + (": " + detail if detail else "")); print("  RED    WRONG  %-40s << %s" % (name, detail))

    full = W.walk(ORIGIN, None, "a2a", "selftest", "offline-mock", fetch=mock([card()]), walked_at="2026-09-07T00:00:00Z")
    v11("v11_full_record_carries_mode_and_disclaimers",
        full.get("mode") == "full" and isinstance(full.get("establishes"), list) and len(full["establishes"]) == 3
        and W.DOES_NOT_ESTABLISH_UNSIGNED in full["does_not_establish"] and all(s in full["does_not_establish"] for s in W.DOES_NOT_ESTABLISH_ALWAYS),
        "mode=%s establishes=%d dne=%d" % (full.get("mode"), len(full.get("establishes") or []), len(full.get("does_not_establish") or [])))
    v11("v11_full_record_passes_intake_v11_rules", ledger_v11_reason(W.canonical(full)) is None, str(ledger_v11_reason(W.canonical(full))))
    dropped = json.loads(W.canonical(full)); dropped.pop("does_not_establish")
    v11("v11_disclaimer_dropped_is_refused", ledger_v11_reason(W.canonical(dropped)) == "disclaimer_missing" and ledger_shape_ok(W.canonical(dropped)),
        "still v1 shape-valid, refused by the v1.1 branch")

    ho = W.walk(ORIGIN, None, "a2a", "selftest", "offline-mock", fetch=mock([card()]), walked_at="2026-09-07T00:00:00Z", privacy="hash-only")
    leaks = [nd["request"].get("url") for nd in ho["nodes"] if nd.get("kind") == "fetch" and nd["request"].get("url") != ORIGIN + "/"]
    meth = [nd["request"].get("method") for nd in ho["nodes"] if nd.get("kind") == "fetch" and nd["request"].get("method") != "REDACTED"]
    hashes = [k for nd in ho["nodes"] if nd.get("kind") == "fetch" for k in ("headers_sha256", "body_sha256") if k in nd["request"]]
    claims_leak = [a["claim"] for a in ho["assertions"] if "/mcp" in a["claim"]]
    v11("v11_hash_only_names_no_tool", not leaks and not meth and not hashes and not claims_leak and ho["mode"] == "hash-only"
        and W.DOES_NOT_ESTABLISH_HASH_ONLY in ho["does_not_establish"] and ho["purpose"].endswith(EP),
        "urls=%s methods=%s reqhashes=%s claims=%s" % (leaks, meth, hashes, len(claims_leak)))
    v11("v11_hash_only_passes_intake_v11_rules", ledger_v11_reason(W.canonical(ho)) is None, str(ledger_v11_reason(W.canonical(ho))))
    v11("v11_hash_only_keeps_response_hashes_and_verdict",
        all(nd["response"].get("body_sha256") for nd in ho["nodes"] if nd.get("kind") == "fetch") and ho["verdict"]["ok"] is True and ho["verdict"]["n_total"] == 5)
    leaky = json.loads(W.canonical(ho)); leaky["nodes"][3]["request"]["url"] = EP
    v11("v11_hash_only_with_a_path_is_refused", ledger_v11_reason(W.canonical(leaky)) == "path_leaks_tool")

    # v1.2 (2026-09-09): which spelling the card used is written into the record, never silently normalised.
    canon_walk = W.walk(ORIGIN, None, "a2a", "selftest", "offline-mock", fetch=mock([card()]), walked_at="2026-09-09T00:00:00Z")
    perma_walk = W.walk(ORIGIN, None, "a2a", "selftest", "offline-mock", fetch=mock([card(uri=W.EXT_PERMANENT_ID)]), walked_at="2026-09-09T00:00:00Z")
    v11("v12_record_names_the_declared_spelling",
        canon_walk["conduct_ext"]["declared_uri"] == W.EXT_URI and perma_walk["conduct_ext"]["declared_uri"] == W.EXT_PERMANENT_ID
        and perma_walk["conduct_ext"]["uri"] == W.EXT_URI and perma_walk["verdict"]["ok"] is True,
        "identifier stays %s, declared spelling recorded" % W.EXT_URI)
    v11("v12_perma_id_record_still_passes_intake", ledger_v11_reason(W.canonical(perma_walk)) is None and ledger_shape_ok(W.canonical(perma_walk)),
        str(ledger_v11_reason(W.canonical(perma_walk))))
    v11("v12_walk_never_fetches_the_redirect",
        not any("w3id.org" in str(nd.get("request", {}).get("url") or "") for nd in perma_walk["nodes"]),
        "nodes touch only the walked origin")

    salt = "ab" * 32
    cm = W.commitment_record(full, salt)
    recomputed = W.sha256_hex(W.canonical(full).encode("utf-8") + bytes.fromhex(salt))
    v11("v11_commitment_record_shape", cm["mode"] == "commitment" and cm["commitment"] == recomputed and "nodes" not in cm
        and W.DOES_NOT_ESTABLISH_COMMITMENT in cm["does_not_establish"] and cm["purpose"] == full["purpose"] and ledger_v11_reason(W.canonical(cm)) is None,
        "commitment " + cm["commitment"][:16])
    v11("v11_commitment_reveals_nothing", all(k not in W.canonical(cm) for k in ("body_sha256", "assertions", "card_bytes", "headers_sha256", "\"nodes\"")),
        "no node, no assertion, no response hash in the filed bytes (the purpose keeps the endpoint so the ring can attribute it)")

    try:
        import base64
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        import tempfile
        k = Ed25519PrivateKey.generate()
        pem = k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        with tempfile.NamedTemporaryFile("wb", suffix=".pem", delete=False) as f:
            f.write(pem); kp = f.name
        key, pub = W.load_signing_key(kp)
        signed = W.walk(ORIGIN, None, "a2a", "selftest", "offline-mock", fetch=mock([card()]), walked_at="2026-09-07T00:00:00Z",
                        key_url="https://witness.selftest.invalid/.well-known/nenrin-witness-key.json")
        sc = W.canonical(signed)
        sig = W.sign_canonical(key, sc)
        k.public_key().verify(base64.b64decode(sig), sc.encode("utf-8"))
        v11("v11_signed_record_binds_key_url_and_drops_identity_disclaimer",
            signed["witness"]["key_url"].startswith("https://witness.selftest.invalid/") and W.DOES_NOT_ESTABLISH_UNSIGNED not in signed["does_not_establish"]
            and len(base64.b64decode(pub)) == 32 and ledger_v11_reason(sc) is None, "signature verifies with the served public key")
        os.unlink(kp)
    except ImportError:
        print("  skip   ----   v11_signed_record (cryptography not installed; signing is optional)")

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
