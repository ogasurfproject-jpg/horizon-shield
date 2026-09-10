#!/usr/bin/env python3
"""a2a_conduct_walk.py : reference client for the A2A Conduct Extension v1 witness walk.

Walks one agent the way section 4 of CONDUCT_EXT_v1.md says, writes a jidec-path-v1 record
with a witness field, prints its sha256, and (with --submit) files it at the witness intake
the agent's own card points to. Standard library only, Python 3.8 or later.

    python3 a2a_conduct_walk.py --origin https://mcp.horizonshield.dev \\
        --witness-name "your name or anonymous" --vantage "your network or tool" \\
        [--endpoint https://mcp.horizonshield.dev/mcp] [--mode mcp|a2a] [--wire 1.0|0.3] [--out walk.json] [--submit]

What it asserts (each one pinned by sha256 of the bytes it turned on):
    card_bytes_stable           two fetches of the agent card, seconds apart, are the same bytes
    conduct_ext_declared        the card lists the extension URI under capabilities.extensions[]
    compensation_well_formed    params.compensation has the shape section 2 requires
    measured_endpoint_answered  the measured endpoint answered a JSON-RPC request with a result of the
                                shape the wire version requires (1.0: {task}|{message}; 0.3: kind).
                                Recorded n/a, not FAIL, when the endpoint answers 402: see below
    payment_required_as_declared  an endpoint that answers 402 declares a paid model on its card
    extension_echoed            (a2a mode only) the response header A2A-Extensions carries the URI, or
                                X-A2A-Extensions when the walk used the 0.3 wire (that is the spelling
                                a 0.3 client sends and reads: the official SDKs' compatibility paths)

What it does not do: it does not judge quality, it does not read the conduct record for you,
and a PASS is not a verdict about the agent. It is one observation, filed where anyone can
read it and count it. Canonical bytes: keys sorted at every level, separators , and : with no
spaces, non-ASCII unescaped. sha256 of those bytes is the record's identity.

conduct-v1.3 draft (2026-09-11, ops/conduct_v1_3_paid_endpoint_20260911.md). Two changes, both found
by walking a real agent that charges for calls, and both invisible to 47 green vectors because every
fixture agent was free and every fixture card declared the extension.
    402 is an answer, not a silence. Before this, every status that was not 200 fell into one bucket,
    so an agent behaving exactly as its own card says was recorded the same as a broken one.
    measured_endpoint_answered is now n/a on 402 and payment_required_as_declared says what happened.
    A walk NEVER pays: a witness that pays the agent it walks has the relationship this layer exists
    to disclose. That is also why the undeclared case is a FAIL, so 402 cannot become a way to stop
    being measured.
    compensation_well_formed no longer answers a question about the extension. With no extension it
    is asked of the card's top-level compensation key (which the gate's condition 3 has read since
    0.2.0) and the record says which declaration it read; with no declaration anywhere it is n/a.
    Whether the extension is declared is conduct_ext_declared's whole job and is not restated.

conduct-v1.1 (2026-09-07, ops/conduct_v1_1_draft_20260907.md). Every record this client writes now
carries `mode`, `establishes` and `does_not_establish`; the last one is the field that keeps a reader
from taking a PASS for a verdict, and the intake refuses a v1.1 record without it.
    --privacy full        (default) urls, methods and body hashes of every node, as before
    --privacy hash-only   node urls are reduced to the origin, methods to REDACTED, request hashes dropped;
                          the record says which tool was called nowhere
    --privacy commitment  only sha256(canonical full record || salt) is filed; the full record and the salt
                          stay on your disk (walk_<sha12>.json, walk_<sha12>.salt) until you choose to reveal
    --key FILE --key-url URL   sign the record (Ed25519, needs the `cryptography` package) with a key you also
                          serve at URL as {"public_key_ed25519_b64": ...}; the ledger then records the domain
                          of URL as your identity (signed_domain). --print-public-key FILE prints that JSON.
    --vantage-limitation "text"   what you could not see from where you stood (a proxy, a cache, a region)
"""
import argparse
import base64
import hashlib
import io
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

EXT_URI = "https://gate.horizonshield.dev/ext/conduct/v1"
# 0.4.3 / spec section 12 (2026-09-09). The w3id.org permanent identifier resolves 302 to EXT_URI
# (perma-id/w3id.org#6653). A2A guidance encourages a permanent identifier service for extension
# URIs, so cards declaring this spelling exist. The identifier is still EXT_URI: this is a closed
# list of exact strings, never normalised, and the redirect is never followed while walking.
# The walk records which string the card used, so recognition is never silent.
EXT_PERMANENT_ID = "https://w3id.org/horizonshield/conduct/v1"
EXT_URIS = (EXT_URI, EXT_PERMANENT_ID)
PRIVACY_MODES = ("full", "hash-only", "commitment")
# conduct-v1.1 section 2: what a walk never establishes, whatever it observed. Stated in the record.
DOES_NOT_ESTABLISH_ALWAYS = [
    "correctness or quality of any response",
    "truth of the compensation declaration",
    "that the agent behaves the same at other instants or from other vantages",
]
DOES_NOT_ESTABLISH_UNSIGNED = "identity of the witness beyond the name given"
DOES_NOT_ESTABLISH_HASH_ONLY = "which tool or method was called"
DOES_NOT_ESTABLISH_COMMITMENT = "anything about the walked agent until the committed record is revealed"
# conduct-v1.3 (2026-09-11). A walk never pays. A 402 says the endpoint charges; it says nothing
# about the amount, and the walk has no way to learn the amount without becoming a customer.
DOES_NOT_ESTABLISH_PAID = "that the amount charged matches the price the card declares: the walk did not pay"
# A2A 1.0 spells the service parameter A2A-Extensions; 0.3 spelled it X-A2A-Extensions.
# A 1.0 walk sends the 1.0 spelling; a 0.3 walk sends only the 0.3 spelling, like a 0.3 client does.
EXT_HEADER = {"1.0": "A2A-Extensions", "0.3": "X-A2A-Extensions"}
PAID_BY = ["buyer", "seller", "referral", "advertising", "subscription", "public", "other"]
WALKER = {"tool": "a2a_conduct_walk.py", "version": "1"}
TIMEOUT = 20
# Cloudflare fronts many agents and refuses Python's default User-Agent with 403 before the
# origin sees the request. A named client passes; so does curl. Both are offered below.
USER_AGENT = "a2a-conduct-walk/1 (+" + EXT_URI + ")"


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
    """Real transport (urllib). Returns (status, headers_dict, body_bytes). Never raises on HTTP status."""
    h = {"User-Agent": USER_AGENT}
    h.update(headers or {})
    req = urllib.request.Request(url, data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.status, dict(r.headers.items()), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers.items()), e.read()
    except Exception as e:  # transport failure: no status, named in the node
        return 0, {"x-transport-error": str(e)}, b""


def curl_fetch(method, url, headers=None, body=None):
    """Real transport (curl subprocess), for hosts whose edge refuses urllib. Same return shape."""
    import subprocess
    import tempfile
    h = {"User-Agent": USER_AGENT}
    h.update(headers or {})
    with tempfile.TemporaryDirectory() as d:
        hdr = d + "/h"
        out = d + "/b"
        cmd = ["curl", "-sS", "--max-time", str(TIMEOUT), "-X", method, "-D", hdr, "-o", out, "-w", "%{http_code}", url]
        for k, v in h.items():
            cmd += ["-H", "%s: %s" % (k, v)]
        if body is not None:
            cmd += ["--data-binary", "@-"]
        try:
            r = subprocess.run(cmd, input=body if body is not None else b"", capture_output=True, timeout=TIMEOUT + 5)
        except Exception as e:
            return 0, {"x-transport-error": str(e)}, b""
        try:
            status = int(r.stdout.decode("ascii", "replace").strip()[-3:])
        except Exception:
            status = 0
        rh = {}
        try:
            for line in io.open(hdr, encoding="latin-1").read().split("\n"):
                if ":" in line and not line.startswith("HTTP/"):
                    k, v = line.split(":", 1)
                    rh[k.strip()] = v.strip()
        except Exception:
            pass
        try:
            rb = open(out, "rb").read()
        except Exception:
            rb = b""
        if status == 0 and r.stderr:
            rh["x-transport-error"] = r.stderr.decode("utf-8", "replace").strip()[:200]
        return status, rh, rb


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
    echo_legacy = None
    for k, v in (rh or {}).items():
        if str(k).lower() == "a2a-extensions":
            echo = str(v)
        elif str(k).lower() == "x-a2a-extensions":
            echo_legacy = str(v)
    node["response"]["a2a_extensions"] = echo
    node["response"]["x_a2a_extensions"] = echo_legacy
    return node, status, rb


def paid_model_signals(card):
    """conduct-v1.3 section 4. Which card keys declare a paid model, as a closed list of exact
    keys and exact values. Nothing is normalised, nothing is inferred from prose, and the walk
    records what it saw so recognition is never silent. Returns a sorted list; empty means the
    card declares no paid model."""
    if not isinstance(card, dict):
        return []
    seen = []
    comp = card.get("compensation")
    if isinstance(comp, dict) and comp.get("paid_by") == "buyer":
        seen.append("compensation.paid_by=buyer")
    if card.get("x402") is True:
        seen.append("x402=true")
    pm = card.get("paymentMethods")
    if isinstance(pm, list) and pm and all(isinstance(x, str) for x in pm):
        seen.append("paymentMethods=" + ",".join(sorted(pm)))
    pr = card.get("pricing")
    if isinstance(pr, dict) and pr.get("model") == "pay-per-use":
        seen.append("pricing.model=pay-per-use")
    return sorted(seen)


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


def read_card_signature(card, origin, privacy):
    """A2A 1.0 section 8.4 の card 署名を、検証せずに読む(第四波 4a-1、2026-09-10)。

    なんで verified を出さんか: 検証には card の正規形(signatures を抜いた proto 形に RFC 8785)を
    再現せなあかん。扉の JS 実装は公式 SDK の canonicalizeAgentCard と 27 例で一致を証明した上で
    使うとる。ここで Python の正規化器を書き下ろして規則を 1 つ外したら、**正直な agent に
    「署名が無効」の濡れ衣**を着せ、それが追記専用の台帳に Bitcoin の錨つきで残る。
    せやから読んだ物だけ書いて、真偽は null のまま名指しで理由を添える(unmeasured != pass)。
    verified に真偽を入れてええのは、同じ 27 例で一致を証明した正規化器が入った日だけ。
    """
    sigs = card.get("signatures") if isinstance(card, dict) else None
    if not isinstance(sigs, list) or not sigs:
        return {
            "present": False,
            "count": 0,
            "verified": None,
            "verified_reason": "the card carries no signatures field; this extension does not require one, so this is not a finding",
        }
    first = sigs[0] if isinstance(sigs[0], dict) else {}
    hdr = {}
    prot = first.get("protected")
    if isinstance(prot, str):
        try:
            raw = base64.urlsafe_b64decode(prot + "=" * (-len(prot) % 4))
            parsed = json.loads(raw.decode("utf-8"))
            if isinstance(parsed, dict):
                hdr = parsed
        except Exception:
            hdr = {}
    pick = lambda k: hdr.get(k) if isinstance(hdr.get(k), str) else None
    jku = pick("jku")
    same_host = None
    if jku:
        try:
            same_host = urllib.parse.urlsplit(jku).netloc == urllib.parse.urlsplit(origin).netloc
        except Exception:
            same_host = None
    out = {
        "present": True,
        "count": len(sigs),
        "alg": pick("alg"),
        "kid": pick("kid"),
        "jku": jku,
        "jku_same_host": same_host,
        "protected_readable": bool(hdr),
        "verified": None,
        "verified_reason": (
            "read, not verified: checking an A2A card signature means reproducing the card's canonical form "
            "(RFC 8785 over the proto shape with signatures removed), which this client does not implement. "
            "A canonicalizer that is one rule wrong would accuse an honest agent in an append only ledger, "
            "so this client reports what the header says and verifies nothing."
        ),
    }
    if privacy != "full":
        out["jku"] = None  # hash-only と commitment では URL を残さん。ホストが同じかどうかの事実だけ残す
    return out


def locate_extension(card):
    """Returns (ext_or_None, problems[])."""
    if not isinstance(card, dict):
        return None, ["card is not a JSON object"]
    caps = card.get("capabilities")
    exts = caps.get("extensions") if isinstance(caps, dict) else None
    if not isinstance(exts, list):
        return None, ["capabilities.extensions is not an array"]
    found = [e for e in exts if isinstance(e, dict) and e.get("uri") in EXT_URIS]
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


def rpc_body(mode, request_id=1, wire="1.0"):
    text = "a2a-conduct-walk-v1: reading the conduct pointers of this agent"
    if mode == "a2a" and wire == "0.3":
        return json.dumps({
            "jsonrpc": "2.0", "id": request_id, "method": "message/send",
            "params": {"message": {"messageId": "conduct-walk-" + str(request_id), "role": "user", "kind": "message",
                                    "parts": [{"kind": "text", "text": text}]}},
        }, ensure_ascii=False).encode("utf-8")
    if mode == "a2a":
        return json.dumps({
            "jsonrpc": "2.0", "id": request_id, "method": "SendMessage",
            "params": {"message": {"messageId": "conduct-walk-" + str(request_id), "role": "ROLE_USER",
                                    "parts": [{"text": text}]}},
        }, ensure_ascii=False).encode("utf-8")
    return json.dumps({
        "jsonrpc": "2.0", "id": request_id, "method": "initialize",
        "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "a2a_conduct_walk", "version": "1"}},
    }).encode("utf-8")


def result_shape_ok(j, mode, wire):
    """A JSON-RPC result is present and, on the A2A path, has the shape the wire version requires."""
    if not (isinstance(j, dict) and "result" in j and j.get("result") is not None):
        return False
    r = j["result"]
    if mode != "a2a" or not isinstance(r, dict):
        return mode != "a2a"
    if wire == "0.3":
        return r.get("kind") in ("message", "task")
    return ("message" in r or "task" in r) and "kind" not in r


def origin_only(u):
    """https://host[:port] of a URL; the part that names a service and not a tool."""
    try:
        from urllib.parse import urlsplit
        s = urlsplit(u)
        if s.scheme and s.netloc:
            return s.scheme + "://" + s.netloc + "/"
    except Exception:
        pass
    return u


def redact_hash_only(record):
    """conduct-v1.1 section 3. Every node keeps only what a reader needs to check that an answer of a
    given sha256 came from a given origin: url reduced to the origin, method to REDACTED, request
    hashes dropped. Assertion claims that name the measured path are reduced the same way. The
    purpose keeps the measured endpoint so the ring can attribute the walk; an endpoint names a
    service, not a tool."""
    for nd in record.get("nodes", []):
        req = nd.get("request") if isinstance(nd, dict) else None
        if isinstance(req, dict):
            if req.get("url"):
                req["url"] = origin_only(req["url"])
            if "method" in req:
                req["method"] = "REDACTED"
            req.pop("headers_sha256", None)
            req.pop("body_sha256", None)
    target = record.get("conduct_ext", {}).get("target")
    for a in record.get("assertions", []):
        if target and target in a.get("claim", ""):
            a["claim"] = a["claim"].replace(target, origin_only(target) + "(redacted path)")
    record["mode"] = "hash-only"
    return record


def disclaimers(record, privacy, signed, target):
    """conduct-v1.1 section 2: establishes and does_not_establish, computed from the record itself."""
    nodes = {nd.get("n"): nd for nd in record.get("nodes", []) if isinstance(nd, dict)}
    est = []
    if privacy == "commitment":
        est.append("a record with the stated commitment existed at " + record["walked_at"])
    else:
        n0, n1 = nodes.get(0), nodes.get(1)
        if n0 and n1:
            est.append("agent card at %s fetched twice at %s; body sha256 %s and %s" % (
                record["base"], record["walked_at"], n0["response"]["body_sha256"], n1["response"]["body_sha256"]))
        n2 = nodes.get(2)
        if n2:
            est.append("extension declaration checked against CONDUCT_EXT_v1 section 2: " + str(n2.get("output_preview", ""))[:160])
        n3 = nodes.get(3)
        if n3:
            where = origin_only(target) if privacy == "hash-only" else target
            est.append("one request answered by %s with http %s and body sha256 %s" % (
                where, n3["response"]["status"], n3["response"]["body_sha256"]))
    dne = list(DOES_NOT_ESTABLISH_ALWAYS)
    n3_dne = nodes.get(3)
    if n3_dne and n3_dne.get("response", {}).get("status") == 402:
        dne.append(DOES_NOT_ESTABLISH_PAID)
    if privacy == "hash-only":
        dne.append(DOES_NOT_ESTABLISH_HASH_ONLY)
    if privacy == "commitment":
        dne.insert(0, DOES_NOT_ESTABLISH_COMMITMENT)
    if not signed:
        dne.append(DOES_NOT_ESTABLISH_UNSIGNED)
    # 0.4.4 / 4a-1 (2026-09-10). 歩いた card の署名の有無は、この歩きの合否を動かさん(assertion にせん)。
    # 動かすのは「この記録が何を証明するか」。無署名の card についての行は、相手の言葉やなく
    # この歩き手の観測に帰属するだけで、相手は否認できる。それを名乗る。
    cs = record.get("card_signature")
    if isinstance(cs, dict):
        if cs.get("present") is False:
            dne.append("that the walked operator published this card: it carried no signature, so these bytes "
                       "are attributable to this walk alone and the operator can repudiate them")
        elif cs.get("verified") is None:
            dne.append("that the walked operator published this card: a signature is present but this client "
                       "does not verify signatures, so these bytes are attributable to this walk alone")
    return est, dne


def commitment_record(full_record, salt_hex):
    """conduct-v1.1 section 3, the stricter form: file only the commitment. The full record and the
    salt stay with the witness. Revealing later means POSTing the full record whose
    sha256(canonical || salt) equals this commitment."""
    full_c = canonical(full_record)
    commitment = sha256_hex(full_c.encode("utf-8") + bytes.fromhex(salt_hex))
    rec = {
        "schema": "jidec-path-v1",
        "purpose": full_record["purpose"],
        "walked_at": full_record["walked_at"],
        "walker": full_record.get("walker", WALKER),
        "base": full_record["base"],
        "witness": dict(full_record["witness"]),
        "mode": "commitment",
        "commitment": commitment,
        "commitment_recipe": "sha256(canonical(full record) || salt); salt is 32 bytes, kept by the witness",
    }
    est, dne = disclaimers(rec, "commitment", bool(rec["witness"].get("key_url")), None)
    rec["establishes"], rec["does_not_establish"] = est, dne
    return rec


def load_signing_key(path):
    """Ed25519 private key (PEM, PKCS8) via the cryptography package. Returns (private_key, public_raw_b64)."""
    import base64
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    except Exception:
        raise SystemExit("signing needs the cryptography package: pip install cryptography (or omit --key to file unsigned)")
    with open(path, "rb") as f:
        key = serialization.load_pem_private_key(f.read(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise SystemExit("--key must be an Ed25519 private key (openssl genpkey -algorithm ed25519 -out witness.pem)")
    pub = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return key, base64.b64encode(pub).decode("ascii")


def sign_canonical(key, record_canonical):
    import base64
    return base64.b64encode(key.sign(record_canonical.encode("utf-8"))).decode("ascii")


def walk(origin, endpoint, mode, witness_name, vantage, fetch=http_fetch, walked_at=None, wire="1.0",
         privacy="full", key_url=None, vantage_limitation=None):
    origin = origin.rstrip("/")
    wire = "0.3" if wire == "0.3" else "1.0"
    if privacy not in PRIVACY_MODES:
        raise ValueError("privacy must be one of " + ", ".join(PRIVACY_MODES))
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
    # conduct-v1.3 (2026-09-11). "Is the extension declared" and "is the compensation declaration
    # well formed" are two questions. Before this they shared one answer: with no extension the
    # compensation assertion was false whatever the card said, and the evidence filed beside it was
    # a sentence about capabilities.extensions. A card whose compensation was flawless was recorded
    # as malformed, with the reason naming a different field. Found on a real card.
    # The card's top-level compensation key is a real declaration surface: the gate's condition 3
    # has read it since 0.2.0. So when the extension is absent, the question is asked of whatever
    # declaration exists, and the record says which one it read. The extension's absence is already
    # one assertion's whole job, and it keeps it.
    comp_where, comp_problems = None, None
    if ext is not None:
        comp_where, comp_problems = "params.compensation", problems
    elif isinstance(card, dict) and isinstance(card.get("compensation"), dict):
        comp_where, comp_problems = "the card's top-level compensation key", compensation_problems(card["compensation"])
    card_signature = read_card_signature(card, origin, privacy)
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
        body = rpc_body(mode, wire=wire)
        hdrs = {"Content-Type": "application/json", "Accept": "application/json", EXT_HEADER[wire]: EXT_URI}
        if mode == "a2a":
            hdrs["A2A-Version"] = wire
        n3, s3, b3 = fetch_node(3, fetch, "POST", target, hdrs, body)
        nodes.append(n3)
        try:
            j = json.loads(b3.decode("utf-8")) if s3 == 200 else None
            answered = result_shape_ok(j, mode, wire)
        except Exception:
            answered = False
        if mode == "a2a":
            e = n3["response"].get("a2a_extensions" if wire == "1.0" else "x_a2a_extensions") or ""
            echoed = any(u in [x.strip() for x in e.split(",")] for u in EXT_URIS)

    # conduct-v1.3 (2026-09-11). 402 Payment Required is an answer, not a silence. Before this,
    # every status that was not 200 fell into one bucket, so a paid agent behaving exactly as its
    # card says was recorded the same as a broken one. Found by walking a real paid agent.
    paid_signals = paid_model_signals(card)
    payment_required = bool(n3) and s3 == 402

    def A(claim, result, nodes_, observed, note=None):
        a = {"claim": claim, "op": "eq", "result": result, "evidence_nodes": nodes_, "observed_sha256": sha256_hex(observed)}
        if note:
            a["note"] = note
        return a

    assertions = [
        A("card_bytes_stable: node0.body_sha256 == node1.body_sha256", s0 == 200 and s1 == 200 and n0["response"]["body_sha256"] == n1["response"]["body_sha256"], [0, 1], n0["response"]["body_sha256"] + n1["response"]["body_sha256"]),
        A("conduct_ext_declared: card lists " + EXT_URI + " under capabilities.extensions[]", ext is not None, [1, 2], canonical(ext) if ext is not None else "absent"),
        A("compensation_well_formed: the compensation declaration has the section 2 shape and any two copies of it agree",
          (not comp_problems) if comp_where else None,
          [1, 2],
          canonical(comp_problems if comp_where else "no declaration"),
          note=(("read from " + comp_where + ": the extension is not declared, so there is no "
                 "params.compensation. Whether the extension is declared is recorded by "
                 "conduct_ext_declared and is not restated here.") if comp_where == "the card's top-level compensation key"
                else ("not applicable: the card carries no compensation declaration in either place. "
                      "The extension's absence is recorded by conduct_ext_declared." if not comp_where else None))),
        A("measured_endpoint_answered: POST " + (target or "(no target)") + " returned http 200 with a JSON-RPC result" + (" of the A2A " + wire + " shape" if mode == "a2a" else ""),
          None if payment_required else (bool(target) and answered),
          [3] if n3 else [2],
          (n3["response"]["body_sha256"] if n3 else "no-node") + ":" + str(answered),
          note=("not applicable: the endpoint required payment (http 402) and this walk does not pay. "
                "A witness that pays the agent it is walking has a financial relationship with that "
                "agent, which is the thing this layer exists to disclose. What was observed instead "
                "is recorded by payment_required_as_declared.") if payment_required else None),
        A("payment_required_as_declared: an endpoint answering http 402 declares a paid model on its "
          "card; signals read (closed list, exact keys): " + (", ".join(paid_signals) if paid_signals else "none"),
          (bool(paid_signals) if payment_required else None),
          [3] if n3 else [2],
          canonical(paid_signals) + ":" + str(s3 if n3 else None),
          note=(None if payment_required and paid_signals else
                ("the endpoint charged and the card declares no paid model at all; a charge nobody "
                 "was told about is a failed disclosure, and without this line answering 402 would "
                 "be a way to never be measured again" if payment_required else
                 ("not applicable: the card declares no paid model, so there is nothing to enforce"
                  if not paid_signals else
                  "not applicable: the card declares a paid model and this request was answered "
                  "without a charge; from here a free method and a waived charge look the same")))),
    ]
    if mode == "a2a":
        assertions.append(A("extension_echoed: response header " + EXT_HEADER[wire] + " contains " + EXT_URI, bool(echoed), [3] if n3 else [2], str((n3["response"].get("a2a_extensions"), n3["response"].get("x_a2a_extensions")) if n3 else None)))
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
        "card_signature": card_signature,
        "conduct_ext": {"uri": EXT_URI, "declared_uri": (ext.get("uri") if isinstance(ext, dict) else None), "mode": mode, "wire": wire if mode == "a2a" else None, "conduct_record": params.get("conduct_record"), "witness_intake": params.get("witness_intake"), "target": target},
        "prev_path_refs": [],
    }
    # conduct-v1.1: the record says its mode and what it does and does not establish. A key_url on the
    # witness means the record will be signed with the key served there; it is part of the signed bytes.
    if key_url:
        record["witness"]["key_url"] = key_url
    if vantage_limitation:
        record["vantage_limitation"] = vantage_limitation
    record["mode"] = "full"
    if privacy == "hash-only":
        redact_hash_only(record)
    est, dne = disclaimers(record, privacy, bool(key_url), target)
    record["establishes"], record["does_not_establish"] = est, dne
    return record


def submit(intake, record_canonical, fetch=http_fetch, signature_b64=None, public_key_b64=None):
    payload = {"record_canonical": record_canonical}
    if signature_b64 and public_key_b64:
        payload["signature_ed25519_b64"] = signature_b64
        payload["public_key_ed25519_b64"] = public_key_b64
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    status, rh, rb = fetch("POST", intake, {"Content-Type": "application/json", "Accept": "application/json"}, body)
    try:
        return status, json.loads(rb.decode("utf-8"))
    except Exception:
        return status, {"raw": rb.decode("utf-8", "replace")[:400]}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--origin", required=True, help="agent origin, e.g. https://mcp.horizonshield.dev")
    ap.add_argument("--endpoint", help="measured endpoint to POST; default: first params.measured_endpoints entry from the card")
    ap.add_argument("--mode", choices=["mcp", "a2a"], default="mcp", help="node 3 body: MCP initialize (default) or an A2A message")
    ap.add_argument("--wire", choices=["1.0", "0.3"], default="1.0", help="a2a mode only: 1.0 sends SendMessage with A2A-Extensions (default); 0.3 sends message/send with X-A2A-Extensions only, as a 0.3 client does")
    ap.add_argument("--witness-name", required=True, help="who you are, or anonymous")
    ap.add_argument("--vantage", required=True, help="network or tool the walk is taken from")
    ap.add_argument("--out", default=None, help="write the canonical bytes here (default: walk_<sha12>.json)")
    ap.add_argument("--submit", action="store_true", help="POST the record to the witness intake named in the card")
    ap.add_argument("--intake", default=None, help="override the witness intake URL (default: params.witness_intake from the card)")
    ap.add_argument("--transport", choices=["urllib", "curl"], default="urllib", help="urllib (default) or curl; use curl when the edge answers 403 to urllib")
    ap.add_argument("--privacy", choices=list(PRIVACY_MODES), default="full", help="conduct-v1.1 record mode: full (default), hash-only, or commitment")
    ap.add_argument("--key", default=None, help="Ed25519 private key PEM to sign the record (needs the cryptography package)")
    ap.add_argument("--key-url", default=None, help="https URL under your own domain that serves {\"public_key_ed25519_b64\": ...}; required with --key")
    ap.add_argument("--print-public-key", default=None, metavar="KEYFILE", help="print the JSON to serve at --key-url for this key, then exit")
    ap.add_argument("--vantage-limitation", default=None, help="what you could not see from where you stood")
    ap.add_argument("--salt-file", default=None, help="commitment mode: read the 32 byte salt (hex) from here instead of generating one")
    a = ap.parse_args(argv)

    if a.print_public_key:
        _k, pub = load_signing_key(a.print_public_key)
        print(json.dumps({"public_key_ed25519_b64": pub}))
        return 0
    if bool(a.key) != bool(a.key_url):
        print("--key and --key-url go together: the ledger binds your signature to the domain that serves the key")
        return 2
    key = pub = None
    if a.key:
        key, pub = load_signing_key(a.key)

    fetch = curl_fetch if a.transport == "curl" else http_fetch
    rec = walk(a.origin, a.endpoint, a.mode, a.witness_name, a.vantage, fetch=fetch, wire=a.wire,
               privacy=a.privacy, key_url=a.key_url, vantage_limitation=a.vantage_limitation)
    rc = canonical(rec)
    sha = sha256_hex(rc)
    out = a.out or ("walk_" + sha[:12] + ".json")
    io.open(out, "w", encoding="utf-8").write(rc)
    v = rec["verdict"]
    print("walk %s  %s %d/%d  sha256 %s  -> %s" % (rec["purpose"], v["outcome"], v["n_pass"], v["n_total"], sha, out))
    for x in rec["assertions"]:
        print("  %s  %s" % ({True: "pass", False: "FAIL", None: "n/a "}[x["result"]], x["claim"][:110]))
    for nd in rec["nodes"]:
        if nd.get("kind") == "fetch":
            st = nd["response"]["status"]
            err = ""
            if st == 0:
                err = "  transport error"
            elif st == 403:
                err = "  (403 at the edge: rerun with --transport curl)"
            print("  n%d %s %s -> http %s  body sha %s%s" % (nd["n"], nd["request"]["method"], nd["request"]["url"], st, nd["response"]["body_sha256"][:12], err))
        else:
            print("  n%d compute: %s" % (nd["n"], nd.get("output_preview", "")[:120]))
    print("  mode %s; does_not_establish: %s" % (rec["mode"], "; ".join(rec["does_not_establish"])))

    # What gets filed: the record itself, or, in commitment mode, only its commitment.
    to_file, to_file_c = rec, rc
    if a.privacy == "commitment":
        import os
        salt_hex = io.open(a.salt_file, encoding="utf-8").read().strip() if a.salt_file else os.urandom(32).hex()
        if len(salt_hex) != 64 or any(c not in "0123456789abcdef" for c in salt_hex):
            print("salt must be 32 bytes as 64 lower-case hex characters")
            return 2
        salt_path = out[:-5] + ".salt" if out.endswith(".json") else out + ".salt"
        io.open(salt_path, "w", encoding="utf-8").write(salt_hex + "\n")
        to_file = commitment_record(rec, salt_hex)
        to_file_c = canonical(to_file)
        print("commitment %s  (full record %s, salt %s; reveal later by POSTing the full record)" % (to_file["commitment"], out, salt_path))

    if a.submit:
        intake = a.intake or rec["conduct_ext"].get("witness_intake")
        if not intake:
            print("no witness_intake in the card and no --intake given; not submitted")
            return 2
        sig = sign_canonical(key, to_file_c) if key else None
        st, j = submit(intake, to_file_c, fetch=fetch, signature_b64=sig, public_key_b64=pub)
        print("submitted to %s: http %d %s" % (intake, st, json.dumps(j, ensure_ascii=False)[:300]))
        return 0 if st in (200, 201) else 1
    return 0 if v["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
