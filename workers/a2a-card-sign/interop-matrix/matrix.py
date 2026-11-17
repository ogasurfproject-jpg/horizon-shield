"""A2A Agent Card signature interop matrix: every official SDK signs, every official SDK verifies.

Signers and verifiers: a2a-python (a2a-sdk), @a2a-js/sdk, a2a-go (a2acrypto, copied verbatim apart from one
import path). Cards: a control plus one case per REQUIRED-or-not field at its default value, and the frozen
JS-signed production card from a2aproject/a2a-go#445 (verify only).

Pairs (2026-11-17): two cards that differ in one declaration. For each SDK the matrix records whether the two
canonical forms are the same bytes, and whether the declaration is still in the canonical form. Each card is then
served with every signature made over the other card. The first pair is a set oneof member whose message is empty,
securitySchemes {"mtls": {"mtlsSecurityScheme": {}}}, against the control card (a2aproject/a2a-python#1278).
Pairs are kept out of CASES. vectors.py, the corpus and the moved-cell comparison with results_20261001.json
therefore see the same six cases as before.

The signing key is a published test key derived from a public phrase, so anyone can re-create it and re-run
every row. It signs test vectors only and is not a production key of anyone.
"""
import base64, hashlib, json, os, subprocess, sys, importlib.metadata as md

HERE = os.path.dirname(os.path.abspath(__file__))
GO_BIN = os.environ.get("INTEROP_GO_BIN", os.path.join(HERE, "go", "interop-go"))
PHRASE = "HORIZON SHIELD A2A card-signing interop test key v1 (public, test vectors only)"
KID = "hs-interop-test-v1"
JKU = "https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/workers/a2a-card-sign/interop-matrix/testkey_jwks.json"

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
from google.protobuf import json_format
from a2a.types import AgentCard
from a2a.utils import signing
from jwt import PyJWK

N = int("FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551", 16)


def test_key():
    d = int.from_bytes(hashlib.sha256(PHRASE.encode()).digest(), "big") % (N - 1) + 1
    priv = ec.derive_private_key(d, ec.SECP256R1())
    pem = priv.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    nums = priv.public_key().public_numbers()
    b64 = lambda i: base64.urlsafe_b64encode(i.to_bytes(32, "big")).rstrip(b"=").decode()
    jwk = {"kty": "EC", "crv": "P-256", "x": b64(nums.x), "y": b64(nums.y), "kid": KID, "alg": "ES256", "use": "sig"}
    return priv, pem, {"keys": [jwk]}


BASE = {
    "name": "Interop Probe",
    "description": "Probe card for cross-SDK signature checks",
    "version": "1.0.0",
    "supportedInterfaces": [{"url": "https://example.com/a2a/v1", "protocolBinding": "JSONRPC", "protocolVersion": "1.0"}],
    "capabilities": {"streaming": True, "pushNotifications": False},
    "defaultInputModes": ["text/plain"],
    "defaultOutputModes": ["text/plain"],
    "skills": [{"id": "probe", "name": "Probe", "description": "Answers a probe", "tags": ["probe"]}],
}


def case(mut):
    c = json.loads(json.dumps(BASE))
    mut(c)
    return c


CASES = [
    ("control", "no field at its default value", case(lambda c: None)),
    ("empty_description", "description = \"\" (REQUIRED)", case(lambda c: c.__setitem__("description", ""))),
    ("empty_skills", "skills = [] (REQUIRED)", case(lambda c: c.__setitem__("skills", []))),
    ("empty_skill_tags", "skills[0].tags = [] (REQUIRED on AgentSkill)", case(lambda c: c["skills"][0].__setitem__("tags", []))),
    ("empty_extensions", "capabilities.extensions = [] (not REQUIRED)", case(lambda c: c["capabilities"].__setitem__("extensions", []))),
    ("nested_empty_security", "securityRequirements = [{}] (not REQUIRED, nested empty)", case(lambda c: c.__setitem__("securityRequirements", [{}]))),
]


# (name, what, declared card, case it is paired with, path of the declaration inside the canonical JSON)
# Neither card carries securityRequirements. The reports on #1278 compare the card with and without the scheme.
# A requirement naming "mtls" on the control card would point at an undeclared scheme. A requirement for mtls also
# holds an empty scope list, which is the nested_empty_security question rather than this one.
PAIRS = [
    ("empty_oneof_mtls", "securitySchemes.mtls = {\"mtlsSecurityScheme\": {}} (set oneof member, empty message) against control",
     case(lambda c: c.__setitem__("securitySchemes", {"mtls": {"mtlsSecurityScheme": {}}})), "control", ("securitySchemes", "mtls", "mtlsSecurityScheme")),
]


SPEC_EXAMPLE_IN = {"name": "Example Agent", "description": "", "capabilities": {"streaming": False, "pushNotifications": False, "extensions": []}, "skills": []}
SPEC_EXAMPLE_OUT = '{"capabilities":{"pushNotifications":false,"streaming":false},"description":"","name":"Example Agent","skills":[]}'


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=60, cwd=HERE)
    try:
        return json.loads(p.stdout.strip().splitlines()[-1])
    except Exception:
        return {"error": (p.stdout + p.stderr)[-300:]}


def py_parse(obj):
    return json_format.Parse(json.dumps(obj), AgentCard(), ignore_unknown_fields=True)


def py_sign(card_obj, priv):
    signer = signing.create_agent_card_signer(priv, {"alg": "ES256", "kid": KID, "jku": JKU, "typ": "JOSE"})
    signed = signer(py_parse(card_obj))
    s = signed.signatures[-1]
    return {"protected": s.protected, "signature": s.signature}


def py_verify(served_obj, jwks):
    def kp(kid, jku):
        for k in jwks["keys"]:
            if k["kid"] == kid:
                return PyJWK(k)
        raise ValueError("kid not in JWKS: " + str(kid))
    try:
        signing.create_signature_verifier(kp, ["ES256"])(py_parse(served_obj))
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": (type(e).__name__ + ": " + str(e))[:300]}


def py_canon(obj, text=False):
    c = signing._canonicalize_agent_card(py_parse(obj))
    r = {"len": len(c.encode()), "sha256": hashlib.sha256(c.encode()).hexdigest()}
    if text:
        r["text"] = c
    return r


def canon_all(cp, card):
    """{sdk: {len, sha256, text}} for the canonical form each SDK signs over."""
    out = {"python": py_canon(card, text=True).get("text"), "js": run(["node", "js_tool.mjs", "canon", cp]).get("text"), "go": run([GO_BIN, "canon", cp]).get("text")}
    return {s: ({"len": len(t.encode()), "sha256": hashlib.sha256(t.encode()).hexdigest(), "text": t} if isinstance(t, str) else {"error": "no canonical form"}) for s, t in out.items()}


def has_path(text, path):
    o = json.loads(text)
    for k in path:
        if not isinstance(o, dict) or k not in o:
            return False
        o = o[k]
    return True


def sign_all(cp, card, priv, keyp):
    sigs = {}
    try:
        sigs["python"] = py_sign(card, priv)
    except Exception as e:
        sigs["python"] = {"error": str(e)[:200]}
    r = run(["node", "js_tool.mjs", "sign", cp, keyp, KID, JKU]); sigs["js"] = r.get("signature") or {"error": r.get("error")}
    r = run([GO_BIN, "sign", cp, keyp, KID, JKU]); sigs["go"] = r.get("signature") or {"error": r.get("error")}
    return sigs


def verify_cells(card, sigs, sp_base, jwks, jwksp, sdks):
    """Serve card with each signer's signature in turn and ask every verifier; same cell shape as the matrix rows."""
    cells = {}
    for s in sdks:
        if "error" in sigs[s]:
            for v in sdks:
                cells[s + ">" + v] = {"ok": None, "error": "signer failed: " + str(sigs[s]["error"])}
            continue
        served = dict(card)
        served["signatures"] = [{"protected": sigs[s]["protected"], "signature": sigs[s]["signature"]}]
        sp = sp_base + "." + s + "-signed.json"
        json.dump(served, open(sp, "w"), separators=(",", ":"), ensure_ascii=False)
        cells[s + ">python"] = py_verify(served, jwks)
        cells[s + ">js"] = run(["node", "js_tool.mjs", "verify", sp, jwksp])
        g = run([GO_BIN, "verify", sp, jwksp]); cells[s + ">go"] = {"ok": g.get("ok"), "error": None if g.get("ok") else json.dumps(g.get("per_signature"))[:300]}
    return cells


def main():
    priv, pem, jwks = test_key()
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    keyp = os.path.join(HERE, "out", "testkey.pem")
    open(keyp, "wb").write(pem)
    jwksp = os.path.join(HERE, "testkey_jwks.json")
    json.dump(jwks, open(jwksp, "w"), indent=2)
    versions = {
        "a2a-python": "a2a-sdk " + md.version("a2a-sdk"),
        "a2a-js": "@a2a-js/sdk " + json.load(open(os.path.join(HERE, "node_modules", "@a2a-js", "sdk", "package.json")))["version"],
        "a2a-go": os.environ.get("A2A_GO_COMMIT", "unknown"),
    }
    sdks = ["python", "js", "go"]
    rows = []
    for name, what, card in CASES:
        cp = os.path.join(HERE, "out", name + ".json")
        json.dump(card, open(cp, "w"), separators=(",", ":"), ensure_ascii=False)
        sigs = {}
        try:
            sigs["python"] = py_sign(card, priv)
        except Exception as e:
            sigs["python"] = {"error": str(e)[:200]}
        r = run(["node", "js_tool.mjs", "sign", cp, keyp, KID, JKU]); sigs["js"] = r.get("signature") or {"error": r.get("error")}
        r = run([GO_BIN, "sign", cp, keyp, KID, JKU]); sigs["go"] = r.get("signature") or {"error": r.get("error")}
        go_canon = {"len": r.get("canonical_len"), "sha256": r.get("canonical_sha256")}
        cells = {}
        for s in sdks:
            if "error" in sigs[s]:
                for v in sdks:
                    cells[s + ">" + v] = {"ok": None, "error": "signer failed: " + str(sigs[s]["error"])}
                continue
            served = dict(card)
            served["signatures"] = [{"protected": sigs[s]["protected"], "signature": sigs[s]["signature"]}]
            sp = os.path.join(HERE, "out", name + "." + s + "-signed.json")
            json.dump(served, open(sp, "w"), separators=(",", ":"), ensure_ascii=False)
            cells[s + ">python"] = py_verify(served, jwks)
            cells[s + ">js"] = run(["node", "js_tool.mjs", "verify", sp, jwksp])
            g = run([GO_BIN, "verify", sp, jwksp]); cells[s + ">go"] = {"ok": g.get("ok"), "error": None if g.get("ok") else json.dumps(g.get("per_signature"))[:300]}
        jc = run(["node", "js_tool.mjs", "canon", cp]); jc.pop("text", None)
        rows.append({"case": name, "what": what, "card_sha256": hashlib.sha256(open(cp, "rb").read()).hexdigest(),
                     "canonical": {"python": py_canon(card), "js": jc, "go": go_canon}, "cells": cells})
    pairs = []
    cards = {n: c for n, _w, c in CASES}
    for name, what, card, other, path in PAIRS:
        und = cards[other]
        cp = os.path.join(HERE, "out", name + ".json"); up = os.path.join(HERE, "out", name + ".undeclared.json")
        json.dump(card, open(cp, "w"), separators=(",", ":"), ensure_ascii=False)
        json.dump(und, open(up, "w"), separators=(",", ":"), ensure_ascii=False)
        dc, uc = canon_all(cp, card), canon_all(up, und)
        canonical = {}
        for s in sdks:
            d, u = dc[s], uc[s]
            ok = "text" in d and "text" in u
            canonical[s] = {"declared": {k: d.get(k) for k in ("len", "sha256")}, "undeclared": {k: u.get(k) for k in ("len", "sha256")},
                            "same_bytes": (d["sha256"] == u["sha256"]) if ok else None,
                            "declaration_kept": has_path(d["text"], path) if ok else None, "declared_text": d.get("text")}
        dsig, usig = sign_all(cp, card, priv, keyp), sign_all(up, und, priv, keyp)
        pairs.append({"pair": name, "what": what, "undeclared_case": other, "declaration_path": list(path),
                      "declared_card_sha256": hashlib.sha256(open(cp, "rb").read()).hexdigest(),
                      "undeclared_card_sha256": hashlib.sha256(open(up, "rb").read()).hexdigest(),
                      "canonical": canonical,
                      "cells": verify_cells(card, dsig, os.path.join(HERE, "out", name), jwks, jwksp, sdks),
                      "declared_sig_on_undeclared": verify_cells(und, dsig, os.path.join(HERE, "out", name + ".dsig-on-undeclared"), jwks, jwksp, sdks),
                      "undeclared_sig_on_declared": verify_cells(card, usig, os.path.join(HERE, "out", name + ".usig-on-declared"), jwks, jwksp, sdks)})
    fz = os.path.join(HERE, "..", "interop-go", "fixtures", "gate_card_20260928.json"); fzj = os.path.join(HERE, "..", "interop-go", "fixtures", "gate_jwks_20260928.json")
    fcard = json.load(open(fz))
    frozen = {"card_sha256": hashlib.sha256(open(fz, "rb").read()).hexdigest(), "jwks_sha256": hashlib.sha256(open(fzj, "rb").read()).hexdigest(),
              "python": py_verify(fcard, json.load(open(fzj))), "js": run(["node", "js_tool.mjs", "verify", fz, fzj])}
    g = run([GO_BIN, "verify", fz, fzj]); frozen["go"] = {"ok": g.get("ok"), "per_signature": g.get("per_signature")}
    sp_in = os.path.join(HERE, "out", "spec_example.json")
    json.dump(SPEC_EXAMPLE_IN, open(sp_in, "w"), separators=(",", ":"))
    gspec = run([GO_BIN, "canon", sp_in])
    spec = {"input": SPEC_EXAMPLE_IN, "expected": SPEC_EXAMPLE_OUT,
            "python": py_canon(SPEC_EXAMPLE_IN, text=True).get("text"),
            "js": run(["node", "js_tool.mjs", "canon", sp_in]).get("text"),
            "go": gspec.get("text")}
    spec["matches"] = {k: spec[k] == SPEC_EXAMPLE_OUT for k in ("python", "js", "go")}
    res = {"schema": "hs-a2a-signing-interop-v0", "versions": versions, "test_key": {"kid": KID, "phrase": PHRASE, "jwks_sha256": hashlib.sha256(open(jwksp, "rb").read()).hexdigest()}, "spec_8_4_1_example": spec, "rows": rows, "pairs": pairs, "frozen_production_card": frozen}
    json.dump(res, open(os.path.join(HERE, "out", "results.json"), "w"), indent=2, ensure_ascii=False)
    mark = lambda c: "pass" if c.get("ok") is True else ("n/a" if c.get("ok") is None else "FAIL")
    lines = ["| case | " + " | ".join(s + " signs > " + v for s in sdks for v in sdks) + " |", "|---|" + "---|" * 9]
    for r in rows:
        lines.append("| " + r["case"] + " | " + " | ".join(mark(r["cells"][s + ">" + v]) for s in sdks for v in sdks) + " |")
    print(json.dumps(versions))
    print("\n".join(lines))
    print("spec 8.4.1 worked example reproduced: " + json.dumps(spec["matches"]))
    for k in ("python", "js", "go"):
        print("  %s: %s" % (k, spec[k]))
    print("frozen production card (JS-signed): python %s, js %s, go %s" % (mark(frozen["python"]), mark(frozen["js"]), mark(frozen["go"])))
    took = lambda c: "accepts" if c.get("ok") is True else ("n/a" if c.get("ok") is None else "rejects")
    for p in pairs:
        print("\npair %s: %s" % (p["pair"], p["what"]))
        print("| SDK | declared card, canonical | %s, canonical | same bytes | declaration in canonical |" % p["undeclared_case"])
        print("|---|---|---|---|---|")
        for s in sdks:
            c = p["canonical"][s]
            f = lambda x: "%s bytes, sha256 %s" % (x["len"], (x["sha256"] or "")[:16])
            yn = lambda b: "n/a" if b is None else ("yes" if b else "no")
            print("| %s | %s | %s | %s | %s |" % (s, f(c["declared"]), f(c["undeclared"]), yn(c["same_bytes"]), "n/a" if c["declaration_kept"] is None else ("kept" if c["declaration_kept"] else "removed")))
        print("| served card, signature | " + " | ".join(s + " signs > " + v for s in sdks for v in sdks) + " |")
        print("|---|" + "---|" * 9)
        print("| declared card, signature over it | " + " | ".join(mark(p["cells"][s + ">" + v]) for s in sdks for v in sdks) + " |")
        print("| %s, signature over declared card | " % p["undeclared_case"] + " | ".join(took(p["declared_sig_on_undeclared"][s + ">" + v]) for s in sdks for v in sdks) + " |")
        print("| declared card, signature over %s | " % p["undeclared_case"] + " | ".join(took(p["undeclared_sig_on_declared"][s + ">" + v]) for s in sdks for v in sdks) + " |")


if __name__ == "__main__":
    main()
