"""TRACE intake and the nenrin-trace-bind-v0 link, offline: the Python port of sdk/trace_verify.mjs.

The normative text is workers/hs-ledger/nenrin/trace-bind-v0/SPEC.md. The JavaScript file is the reference; this
port is held to it by the corpora trace-intake-v0 (the TRACE conformance vectors) and trace-bind-v0, on the TSUNAGI
board every night.

    nenrin-trace-verify intake <record.json> [--now <seconds>]
    nenrin-trace-verify bind <bundle.json>
    nenrin-trace-verify --batch intake|bind|span <in.json> <out.json>

Inputs are read with JSON.parse semantics (nenrin_verify._js.loads): every number a double, duplicate names last-wins.
"""
import base64
import hashlib
import json
import math
import re
import sys

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from ._js import loads, quote, num_str, MAX_SAFE

TRACE_PROFILE_V0_2 = "tag:agentrust-io.com,2026:trace-v0.2"
TRACE_PROFILE_V0_1 = "tag:agentrust.io,2026:trace-v0.1"
TRACE_REQUIRED = ("eat_profile", "iat", "subject", "model", "runtime", "policy", "data_class", "build_provenance",
                  "appraisal", "cnf")
MAX_RECORD_BYTES = 65536
FUTURE_SKEW_SECONDS = 300
DEFAULT_MAX_AGE_SECONDS = 86400
BIND_SCHEMA = "nenrin-trace-bind-v0"
BIND_CONTEXT = "nenrin-trace-bind-v0\n"
BIND_KEYS = ("acted_at", "binder_public_key_ed25519_b64", "record_sha256", "relation", "schema", "sig_b64",
             "trace_key_thumbprint", "trace_sha256")
BIND_FINDINGS = ["acted_at_is_stated", "trace_claims_not_appraised"]
MAX_DEPTH = 64


class Refusal(Exception):
    def __init__(self, code, why=""):
        super().__init__(why or code)
        self.code = code


def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _is_int(v):
    """Number.isInteger for a JSON value: an integer-valued finite double."""
    if not _is_num(v):
        return False
    if isinstance(v, int):
        try:
            float(v)
        except OverflowError:
            return False
        return True
    return math.isfinite(v) and v.is_integer()


def _has_surrogate(s):
    return any(0xD800 <= ord(c) <= 0xDFFF for c in s)


def _u16(k):
    return k.encode("utf-16-be", "surrogatepass")


def jcs(v, depth=0, path="$"):
    """RFC 8785 with refusals, in the order SPEC.md section 1 walks the value."""
    if depth > MAX_DEPTH:
        raise Refusal("too_deep", path + " nests deeper than %d" % MAX_DEPTH)
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if _is_num(v):
        if isinstance(v, int):
            if abs(v) > MAX_SAFE:
                try:
                    float(v)
                except OverflowError:
                    raise Refusal("non_finite_number", path + " is not finite")
                raise Refusal("unsafe_integer", path + " is outside the safe integer range")
            return str(v)
        if not math.isfinite(v):
            raise Refusal("non_finite_number", path + " is not finite")
        if v.is_integer() and abs(v) > MAX_SAFE:
            raise Refusal("unsafe_integer", path + " is outside the safe integer range")
        return num_str(v)
    if isinstance(v, str):
        if _has_surrogate(v):
            raise Refusal("lone_surrogate", path + " holds a lone surrogate")
        return quote(v)
    if isinstance(v, list):
        return "[" + ",".join(jcs(x, depth + 1, "%s[%d]" % (path, i)) for i, x in enumerate(v)) + "]"
    if isinstance(v, dict):
        parts = []
        for k in sorted(v, key=_u16):
            if _has_surrogate(k):
                raise Refusal("lone_surrogate", path + " has a member name with a lone surrogate")
            parts.append(quote(k) + ":" + jcs(v[k], depth + 1, path + "." + k))
        return "{" + ",".join(parts) + "}"
    raise Refusal("not_json", path + " is not a JSON value")


def sha256hex(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


_B64URL = re.compile(r"[A-Za-z0-9_-]*")
_B64STD = re.compile(r"[A-Za-z0-9+/]*={0,2}")


def _b64url_canonical(s):
    if not isinstance(s, str) or not _B64URL.fullmatch(s) or len(s) % 4 == 1:
        return None
    try:
        b = base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))
    except Exception:
        return None
    return b if base64.urlsafe_b64encode(b).decode().rstrip("=") == s else None


def _b64std_canonical(s):
    if not isinstance(s, str) or not _B64STD.fullmatch(s) or len(s) % 4 != 0:
        return None
    try:
        b = base64.b64decode(s, validate=True)
    except Exception:
        return None
    return b if base64.b64encode(b).decode() == s else None


def _ed25519_verify(pub32, sig64, msg):
    try:
        Ed25519PublicKey.from_public_bytes(bytes(pub32)).verify(bytes(sig64), msg)
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False


def jwk_thumbprint(jwk):
    m = '{"crv":' + quote(jwk["crv"]) + ',"kty":' + quote(jwk["kty"]) + ',"x":' + quote(jwk["x"]) + "}"
    return base64.urlsafe_b64encode(hashlib.sha256(m.encode("utf-8")).digest()).decode().rstrip("=")


def check_trace_record(R, now):
    """SPEC.md section 2. Raises Refusal; returns {sha, key_thumbprint, iat, subject} when the ledger pins R."""
    if not isinstance(R, dict):
        raise Refusal("record_not_object", "the record is not a JSON object")
    rj = jcs(R)
    if len(rj.encode("utf-8")) > MAX_RECORD_BYTES:
        raise Refusal("too_large")
    if "cmcp_version" in R and "trace" in R and "eat_profile" not in R:
        raise Refusal("enveloped_form")
    prof = R.get("eat_profile")
    if prof == TRACE_PROFILE_V0_1 and isinstance(prof, str):
        raise Refusal("superseded_profile")
    if not (isinstance(prof, str) and prof == TRACE_PROFILE_V0_2):
        raise Refusal("unsupported_profile")
    missing = [k for k in TRACE_REQUIRED if k not in R]
    if missing:
        raise Refusal("missing_required", "missing " + ", ".join(missing))
    iat = R["iat"]
    if not _is_int(iat) or iat < 1700000000:
        raise Refusal("bad_iat")
    if not isinstance(R["subject"], str) or not R["subject"]:
        raise Refusal("bad_subject")
    if "signature" not in R:
        raise Refusal("no_embedded_signature")
    sig = _b64url_canonical(R["signature"])
    if sig is None:
        raise Refusal("bad_base64url", "signature")
    if len(sig) != 64:
        raise Refusal("bad_signature_length")
    cnf = R["cnf"]
    jwk = cnf.get("jwk") if isinstance(cnf, dict) and isinstance(cnf.get("jwk"), dict) else None
    if jwk is None:
        raise Refusal("no_confirmation_key")
    if not (isinstance(jwk.get("kty"), str) and jwk.get("kty") == "OKP" and isinstance(jwk.get("crv"), str)
            and jwk.get("crv") == "Ed25519"):
        raise Refusal("unsupported_key_type")
    pub = _b64url_canonical(jwk.get("x"))
    if pub is None:
        raise Refusal("bad_base64url", "cnf.jwk.x")
    if len(pub) != 32:
        raise Refusal("bad_key_length")
    body = {k: v for k, v in R.items() if k != "signature"}
    if not _ed25519_verify(pub, sig, jcs(body).encode("utf-8")):
        raise Refusal("signature_invalid")
    if iat > now + FUTURE_SKEW_SECONDS:
        raise Refusal("iat_in_future")
    return {"sha": sha256hex(rj), "key_thumbprint": jwk_thumbprint(jwk), "iat": iat, "subject": R["subject"]}


def unwrap_vector(vector):
    if isinstance(vector, dict) and isinstance(vector.get("record"), dict):
        return vector["record"]
    return vector


def verify_trace_intake(bundle):
    if not isinstance(bundle, dict) or not _is_int(bundle.get("now")):
        raise ValueError('an intake bundle is {"now": <integer>, "vector": <value>}')
    try:
        c = check_trace_record(unwrap_vector(bundle.get("vector")), bundle["now"])
        return {"verdict": "pinnable", "refusals": [], "findings": [], "sha": c["sha"],
                "key_thumbprint": c["key_thumbprint"]}
    except Refusal as e:
        return {"verdict": "refused", "refusals": [e.code], "findings": []}


def bind_signing_bytes(bind):
    body = {k: v for k, v in bind.items() if k != "sig_b64"}
    return (BIND_CONTEXT + jcs(body)).encode("utf-8")


# fullmatch, never match with "$" (which also passes one trailing "\n"; trace_verify.mjs and trace.go refuse it)
_HEX64 = re.compile(r"[0-9a-f]{64}")
_THUMB = re.compile(r"[A-Za-z0-9_-]{43}")


def _str_list(a):
    return isinstance(a, list) and all(isinstance(x, str) for x in a)


def verify_trace_bind(bundle):
    """SPEC.md section 4: the verdict signature of a bind bundle {"bind", "trace", "record", "policy"}."""
    if not isinstance(bundle, dict) or not all(isinstance(bundle.get(k), dict) for k in ("bind", "trace", "record", "policy")):
        raise ValueError('a bind bundle is {"bind", "trace", "record", "policy"}, each an object')
    bind, trace, record, policy = bundle["bind"], bundle["trace"], bundle["record"], bundle["policy"]

    def stop(code):
        return {"verdict": "not_bound", "refusals": [code], "findings": list(BIND_FINDINGS)}

    try:
        jcs(bind); jcs(trace); jcs(record)
    except Refusal as e:
        return stop(e.code)
    max_age = policy["max_age_seconds"] if "max_age_seconds" in policy else DEFAULT_MAX_AGE_SECONDS
    if (not _str_list(policy.get("binder_keys")) or not _str_list(policy.get("trace_key_thumbprints"))
            or not _is_int(max_age) or max_age < 0 or max_age > 31536000):
        return stop("policy_malformed")
    if not (isinstance(bind.get("schema"), str) and bind["schema"] == BIND_SCHEMA):
        return stop("bind_schema")
    shape_ok = (tuple(sorted(bind, key=_u16)) == BIND_KEYS
                and isinstance(bind["relation"], str) and bind["relation"] == "performed_under"
                and isinstance(bind["record_sha256"], str) and bool(_HEX64.fullmatch(bind["record_sha256"]))
                and isinstance(bind["trace_sha256"], str) and bool(_HEX64.fullmatch(bind["trace_sha256"]))
                and isinstance(bind["trace_key_thumbprint"], str) and bool(_THUMB.fullmatch(bind["trace_key_thumbprint"]))
                and _is_int(bind["acted_at"]) and 1700000000 <= bind["acted_at"] <= MAX_SAFE)
    key = _b64std_canonical(bind["binder_public_key_ed25519_b64"]) if shape_ok else None
    sig = _b64std_canonical(bind["sig_b64"]) if shape_ok else None
    if not shape_ok or key is None or len(key) != 32 or sig is None or len(sig) != 64:
        return stop("bind_malformed")

    refusals = []
    if not _ed25519_verify(key, sig, bind_signing_bytes(bind)):
        refusals.append("bind_signature_invalid")
    if bind["binder_public_key_ed25519_b64"] not in policy["binder_keys"]:
        refusals.append("binder_not_pinned")
    if sha256hex(jcs(record)) != bind["record_sha256"]:
        refusals.append("record_sha_mismatch")
    if sha256hex(jcs(trace)) != bind["trace_sha256"]:
        refusals.append("trace_sha_mismatch")
    c = None
    try:
        c = check_trace_record(trace, bind["acted_at"])
    except Refusal as e:
        refusals.append("trace:" + e.code)
    if c is not None:
        if c["key_thumbprint"] != bind["trace_key_thumbprint"]:
            refusals.append("trace_key_thumbprint_mismatch")
        if c["key_thumbprint"] not in policy["trace_key_thumbprints"]:
            refusals.append("trace_key_not_pinned")
        if bind["acted_at"] - c["iat"] > max_age:
            refusals.append("trace_stale_at_act")
    return {"verdict": "not_bound" if refusals else "bound", "refusals": sorted(refusals),
            "findings": list(BIND_FINDINGS)}


# ---- OpenTelemetry (SPEC.md section 7) ----------------------------------------------------------------------
OTEL_SCHEMA = "nenrin-otel-v0"
OTEL_KEYS = ("nenrin.otel.schema", "nenrin.bind.sha256", "nenrin.record.sha256", "nenrin.trace.sha256",
             "nenrin.trace.key_thumbprint")


def span_attributes(bind, ledger_origin="https://ledger.horizonshield.dev"):
    """The attributes to put on the agent's OpenTelemetry GenAI span (execute_tool / invoke_agent)."""
    t = bind.get("trace_sha256")
    return {
        "nenrin.otel.schema": OTEL_SCHEMA,
        "nenrin.bind.sha256": sha256hex(jcs(bind)),
        "nenrin.record.sha256": bind.get("record_sha256"),
        "nenrin.trace.sha256": t,
        "nenrin.trace.key_thumbprint": bind.get("trace_key_thumbprint"),
        "nenrin.trace.url": ledger_origin + "/evidence/trace/" + (t if isinstance(t, str) else ""),
    }


def annotate_span(span, bind, ledger_origin="https://ledger.horizonshield.dev"):
    """span.set_attributes(span_attributes(bind)); any object with set_attributes works (opentelemetry-api's Span)."""
    span.set_attributes(span_attributes(bind, ledger_origin))
    return span


def check_span_attributes(attrs, bundle):
    v = verify_trace_bind(bundle)
    try:
        want = span_attributes(bundle["bind"])
    except Refusal:
        want = {}
    a = attrs if isinstance(attrs, dict) else {}
    refusals = list(v["refusals"]) + ["span_attribute_mismatch:" + k for k in OTEL_KEYS
                                      if not isinstance(a.get(k), str) or not isinstance(want.get(k), str) or a[k] != want[k]]
    return {"verdict": "span_not_bound" if refusals else "span_bound", "refusals": sorted(refusals),
            "findings": v["findings"]}


def _sig(r):
    return {"verdict": r["verdict"], "refusals": r["refusals"], "findings": r["findings"]}


def _batch(kind, inp, outp):
    def span(b):
        if not isinstance(b, dict):
            raise ValueError("a span case is {span, bind_bundle}")
        return check_span_attributes(b.get("span"), b.get("bind_bundle"))

    fn = {"intake": verify_trace_intake, "bind": verify_trace_bind, "span": span}.get(kind)
    if fn is None:
        print("batch kind is intake, bind or span", file=sys.stderr)
        return 2
    with open(inp, "rb") as f:
        cases = loads(f.read())
    out = {}
    for c in cases:
        try:
            out[c["name"]] = _sig(fn(c["bundle"]))
        except Exception as e:  # a crash is this case's result, never hidden
            out[c["name"]] = {"error": ("%s: %s" % (type(e).__name__, e))[:160]}
    with open(outp, "w", encoding="utf-8") as f:
        json.dump(out, f)
    print("wrote %d verdict signatures (trace %s)" % (len(out), kind))
    return 0


def main(argv=None):
    a = list(sys.argv[1:] if argv is None else argv)
    if len(a) == 4 and a[0] == "--batch":
        return _batch(a[1], a[2], a[3])
    if len(a) >= 2 and a[0] in ("intake", "bind"):
        with open(a[1], "rb") as f:
            v = loads(f.read())
        if a[0] == "intake":
            import time
            now = int(a[a.index("--now") + 1]) if "--now" in a else int(time.time())
            r = verify_trace_intake({"now": now, "vector": v})
            print(json.dumps(r, indent=2, ensure_ascii=False))
            return 0 if r["verdict"] == "pinnable" else 1
        r = verify_trace_bind(v)
        print(json.dumps(r, indent=2, ensure_ascii=False))
        return 0 if r["verdict"] == "bound" else 1
    print("usage: nenrin-trace-verify intake <record.json> [--now s] | bind <bundle.json> | --batch intake|bind <in> <out>",
          file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
