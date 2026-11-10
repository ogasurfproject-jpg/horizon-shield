"""dr_check 0.1.1: a reader of draft-gruszka-audit-decision-receipts-06, Sections 3.2 to 3.5, 3.8 and the
relying-party check of Section 4, written from the draft text only.  It began as a reader of -04 and was changed
for each later revision only where the text changed; the changes for -05 and -06 are listed below, and each place
changed for -06 is marked "-06:" in the code.
0.1.1: the verdicts file names each input whose SHA-256 differs from inputs-06.json (build_checks_off, with the
vectors that read it, and inputs_off in each of those vectors); the verdicts still come from the steps of the draft
alone, so such an input fails a vector only where a step checks its bytes (3.2 step 10, Case 1, 3.4 step 6).  A
vector whose files are not in the package is reported as not run, and an input file that is not there is reported
as missing.
-06 changes applied: timestamp form (fraction of one to six digits, compared as microseconds), strict base64 for
payload (3.2 step 2) and sig (3.2 step 3), RFC 8785 numbers as IEEE 754 doubles (3.2 step 4), 3.4 step 1 failures
named as that step, trust policy read from a file (3.4 step 5 with the policies P2 and P3), Section 4 items as -06
names them (copy or same bytes: item 1), unreadable state read from bytes, Section 3.5 item named.  The vector
driver reads the envelopes and inputs of the author's test package, from a per-vector procedure list
(inputs-06.json) with no expected field.
-05 changes applied: BOM rejection in 3.2 step 1 (already held by the strict parser), exactly one subject
entry (already held), 3.4 step 6 effect bytes whatever the status (already held), Section 4 item named,
Statement-level overrides for F11 and F12, consumption state with generations (c2).
Python standard library plus cryptography (Ed25519).  No network access.

Usage: python3 -I -B dr_check.py inputs-06.json <package_dir> <out_dir>
  verifies the vectors of the test package by the procedure inputs-06.json names for each, and writes
  <out_dir>/gruszka06_verdicts.json.  No expected result is read; expected.json is not opened.
  count.py then compares the verdicts with expected.json of the package.

Readings where the text leaves a choice (cited as G-n where used):"""
__version__ = "0.1.1"
import base64, copy, hashlib, json, os, re, sys
from datetime import datetime, timezone
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from cryptography.exceptions import InvalidSignature

READINGS_06 = {  # written before the verdicts were compared with expected.json
    "G21": "3.2 step 2 defines the base64 form 'here and for sig in step 3', but says only that 'a payload in another "
           "form fails this step'. We read a sig in another form as a sig that does not verify, so the vector fails "
           "at step 3 (F80). Other reading: any base64 in another form, payload or sig, fails step 2.",
    "G22": "3.1 and 3.4 step 5 with the trust policy files: the decision keys are the keys the policy lists under "
           "decision, and step 8 needs decisionMaker.id to be both bound to the verifying key and the expected id. "
           "The outcome-signing key is whichever key listed under outcome verifies the outcome envelope in 3.4 step 1; "
           "step 5 then needs that key to be permitted for the expected executor.id and to differ from the key that "
           "verified the decision. Under P2 the gate-1 key is listed for outcomes, so F66 reaches step 5. Other "
           "reading: the expected outcome key excludes the decision key, so F66 fails at 3.4 step 1.",
    "G23": "Where the field rules of 3.8 (step 7 of 3.2, step 3 of 3.4) and a later step state the same rule, the "
           "first step in order fails (for example validity.audience = [] fails at 3.2 step 7, not step 9).",
    "G24": "Section 4 items in -06: an identity found in the current generation of the state (the same bytes, F77, or "
           "a copy with other bytes, F10) is refused under item 1, as the last paragraph of Section 4 and A.5 say. "
           "Found only in a rotated generation: item 4 (F13). A state that does not parse: item 5 (F71). Other "
           "reading: every refusal rests on item 1 and items 4 and 5 only say which state counts.",
    "G25": "'F31 to F34 are checked like V3-decision': V3-decision is judged by the Case 3 procedure with V3-good, "
           "so F31 to F34 are checked as Case 3 with V3-good as the outcome receipt. One of them that passed 3.2 "
           "would then fail at 3.4 step 4 (binding). Other reading: Section 3.2 alone.",
    "G26": "Case 3 lists the verdict before the outcome receipt; 'Section 3.4 is checked before the status' orders only "
           "the status check. So a decision with the verdict ESCALATE fails Case 3 before 3.4 is run (F17).",
    "G27": "The expected nonce is the decisionId of the vector (A.3), read from the vector's payload before "
           "verification; F39 supplies dec-0009 instead. For an envelope that does not parse, no nonce is needed.",
    "G28": "For Case 3, a3 is supplied as action bytes to 3.2 step 10 for V3-decision and the decisions derived from "
           "it, as in -05 (G8). The description names only e3 and the expected executor.id.",
    "G29": "3.2 step 2: 'its padding' is read as required padding (length a multiple of 4). No vector has unpadded base64.",
    "G30": "3.2 step 1 says only that the envelope is one JSON text of RFC 8259; the -05 parser (Python json) also "
           "admits NaN and Infinity. This was not changed, since the -06 text of step 1 did not change; no vector has them.",
}

READINGS = {
    "G1": "Section 3.8 states the field rules itself (tables 4 and 5); [PB-DECISION], [PB-OUTCOME] and [PB-REPO] "
          "were not fetched. Only the tables and the text of Sections 3.2, 3.3 and 3.4 are applied.",
    "G2": "Digests are exactly the paths listed in 3.2 step 7 and 3.4 step 3 (resolved by -04). The digest form is "
          "applied through the table type 'digest'. actionOutcome.outcomeRef and evidenceRefs[].typedDigest are not digests.",
    "G3": "Timestamps are exactly the paths listed in 3.2 step 7 and 3.4 step 3 (resolved by -04). A timestamp is "
          "YYYY-MM-DDTHH:MM:SS with optional fraction and a trailing upper-case Z, and must be a real calendar instant.",
    "G4": "Steps run in order and the first failure ends the procedure (Section 3 first paragraph); the report names that step.",
    "G5": "A decision vector is checked with Section 3.2 and then its case of Section 3.3 (A.3 of -04 now names this). "
          "An outcome vector is checked by Section 3.4 against the decision receipt the verifier input names, which "
          "must itself pass 3.2 at the stated T.",
    "G6": "The expected nonce is the decisionId of the vector (A.3 and A.5: 'the decisionId as expected nonce'); "
          "the verifier supplies it per vector; the expected audience is observer-1.",
    "G7": "Subject: exactly one entry; its name is not checked against decisionId; other Statement members and other "
          "members of the subject entry are not restricted (3.2 step 6 does not restrict them).",
    "G8": "Case 1: the approval record bytes are the RFC 8785 bytes of ap (or ap2 for F10); the action bytes are supplied.",
    "G9": "RFC 8785 here covers strings, integers, true/false/null, arrays and objects; a non-integer number "
          "makes the canonical check fail (no vector has one).",
    "G10": "3.4 step 1 applies 3.2 steps 1 to 5 with the outcome key; step 5: the expected executor is "
           "forge:agent-42-bot under observer-1, and the decision key is gate-1.",
    "G11": "Section 3.8 'Everywhere else a null is not allowed, also inside an open object and in an array of any "
           "values': a member whose Null column is yes may itself be null, but no null is allowed anywhere inside a "
           "non-null value of type any value, open object or array of any values.",
    "G12": "Note (1): proposedAction must carry parametersDigest or parametersRef; when only parametersRef is present, "
           "3.2 step 10 (with action bytes), Case 1 and 3.4 step 4 compare against an absent parametersDigest and fail.",
    "G13": "When a step-7 / step-3 rule fails in more than one place, the step is the same; the 'why' names the first "
           "path found in table order.",
    "G14": "Section 4 is run only where the verifier input supplies a consumption state (F10; F13 in -05). It runs after the "
           "receipt passes 3.2 and Case 1, uses the identity (approvalId, actionDigest, session) of the supplied "
           "approval record, and refuses if that identity is in the state. Its result is reported apart from "
           "receipt verification.",
    "G15": "Section 3.5 is run over the decisions and outcomes of A.3 that pass (as in -03). A second run adds F10, "
           "for information, with one scope for all; the draft gives no consumption scope for the vectors.",
    "G16": "3.4 is not given T; the outcome check uses T only to verify the named decision under 3.2.",
    "G17": "Section 4 item named: a consumption state that is an array is the current generation; an object is a set of "
           "generations, with member current for the current one. An identity found in the current generation is refused "
           "under item 2 (keyed by identity, so a copy with other metadata is the same approval; item 1 would also fit). "
           "An identity found only in another generation is refused under item 4. A state of another shape is refused under item 5.",
    "G18": "3.2 step 1 of -05: the strict parser already rejects a leading U+FEFF; no vector of A.3 or A.5 tests it.",
}
READINGS.update(READINGS_06)

DEC_TYPE = "https://b7n0de.com/proofbundle/predicates/decision-receipt/v0.1"
OUT_TYPE = "https://b7n0de.com/proofbundle/predicates/action-outcome/v0.1"
STMT = "https://in-toto.io/Statement/v1"
PTYPE = "application/vnd.in-toto+json"
HEX64 = re.compile(r"^[0-9a-f]{64}$")
TS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$")  # -06: one to six fraction digits
B64 = re.compile(r"^[A-Za-z0-9+/]*={0,2}$")
SCHEMA = re.compile(r"^0\.1\.[0-9]+$")


class Fail(Exception):
    def __init__(self, step, why):
        super().__init__(step)
        self.step, self.why = step, why


# ---------- RFC 8785 (G9) ----------
def _jstr(s):
    o = ['"']
    m = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t"}
    for ch in s:
        if ch in m:
            o.append(m[ch])
        elif ord(ch) < 0x20:
            o.append("\\u%04x" % ord(ch))
        else:
            o.append(ch)
    o.append('"')
    return "".join(o)


def jcs(v):
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, (int, float)):  # -06: 3.2 step 4, numbers are IEEE 754 doubles (RFC 8785 3.1)
        return es6num(float(v))
    if isinstance(v, str):
        return _jstr(v)
    if isinstance(v, list):
        return "[" + ",".join(jcs(x) for x in v) + "]"
    if isinstance(v, dict):
        ks = sorted(v, key=lambda k: k.encode("utf-16-be"))
        return "{" + ",".join(_jstr(k) + ":" + jcs(v[k]) for k in ks) + "}"
    raise ValueError("type")


def es6num(f):  # -06: ECMAScript Number.prototype.toString, as RFC 8785 3.2.2.3
    from decimal import Decimal
    import math
    if math.isnan(f) or math.isinf(f):
        raise ValueError("NaN or infinity")
    if f == 0:
        return "0"
    if f < 0:
        return "-" + es6num(-f)
    t = Decimal(repr(f)).normalize().as_tuple()  # shortest round-trip digits
    digits = "".join(map(str, t.digits))
    k = len(digits)
    n = k + t.exponent  # value = 0.digits * 10**n
    if k <= n <= 21:
        return digits + "0" * (n - k)
    if 0 < n <= 21:
        return digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return "0." + "0" * (-n) + digits
    ex = n - 1
    return digits[0] + ("." + digits[1:] if k > 1 else "") + "e" + ("+" if ex >= 0 else "-") + str(abs(ex))


def b64strict(x):  # -06: 3.2 step 2 (and sig in step 3): alphabet and padding only, zero pad bits
    if not isinstance(x, str) or len(x) % 4 or not B64.match(x):
        raise ValueError("base64 form")
    b = base64.b64decode(x, validate=True)
    if base64.b64encode(b).decode() != x:
        raise ValueError("base64 pad bits or padding")
    return b


def jcsb(v):
    return jcs(v).encode("utf-8")


def sha(b):
    return hashlib.sha256(b).hexdigest()


def _pairs(p):
    d = {}
    for k, v in p:
        if k in d:
            raise ValueError("duplicate member " + k)
        d[k] = v
    return d


def strict_json(b):
    t = b.decode("utf-8", errors="strict")
    return json.loads(t, object_pairs_hook=_pairs)


def ts(s):  # -06: full value, fraction padded to six digits (strptime %f pads); TS admits at most six
    if "." in s:
        return datetime.strptime(s[:-1], "%Y-%m-%dT%H:%M:%S.%f").replace(tzinfo=timezone.utc)
    return datetime.strptime(s[:-1], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)


def is_ts(x):
    if not (isinstance(x, str) and TS.match(x)):
        return False
    try:
        ts(x)
    except ValueError:
        return False
    return True


def is_digest(x):
    return isinstance(x, dict) and set(x) == {"sha256"} and isinstance(x["sha256"], str) and bool(HEX64.match(x["sha256"]))


def _nes(x):
    return isinstance(x, str) and x != ""


# ---------- Section 3.8 field rules (tables 4 and 5) ----------
# (path, type, required, null)
DEC_TABLE = [
    ("schemaVersion", "ver", True, False),
    ("decisionId", "nes", True, False),
    ("decisionType", "const:preActionAuthorization", True, False),
    ("decidedAt", "ts", True, False),
    ("recordedAt", "ts", False, False),
    ("decisionMaker", "obj", True, False),
    ("decisionMaker.id", "nes", True, False),
    ("decisionMaker.version", "any", False, True),
    ("agent", "obj", True, False),
    ("agent.id", "nes", True, False),
    ("agent.version", "str", False, False),
    ("agent.configurationDigest", "digest", False, False),
    ("principal", "obj", True, False),
    ("principal.id", "nes", True, False),
    ("principal.authnContextRef", "obj", False, False),
    ("principal.authnContextRef.uri", "str", False, False),
    ("principal.authnContextRef.digest", "digest", False, False),
    ("delegationRefs", "arr_any", False, False),
    ("proposedAction", "obj", True, False),
    ("proposedAction.actionType", "str", True, False),
    ("proposedAction.target", "obj", False, False),
    ("proposedAction.target.name", "str", False, False),
    ("proposedAction.target.uri", "str", False, False),
    ("proposedAction.target.digest", "digest", False, False),
    ("proposedAction.method", "str", False, False),
    ("proposedAction.parametersDigest", "digest", False, False),  # note (1)
    ("proposedAction.parametersRef", "open", False, False),        # note (1)
    ("proposedAction.parametersSchemaRef", "obj", False, False),
    ("proposedAction.parametersSchemaRef.uri", "str", False, False),
    ("proposedAction.parametersSchemaRef.digest", "digest", False, False),
    ("inputSnapshot", "arr_obj", True, False),
    ("inputSnapshot[].name", "str", False, False),
    ("inputSnapshot[].uri", "str", False, False),
    ("inputSnapshot[].digest", "digest", True, False),
    ("inputSnapshot[].mediaType", "str", False, False),
    ("policyBoundary", "obj", True, False),
    ("policyBoundary.policyEngine", "nes", True, False),
    ("policyBoundary.policyId", "nes", True, False),
    ("policyBoundary.decisionPath", "nes", True, False),
    ("policyBoundary.policyDigest", "digest", True, False),
    ("policyBoundary.bundleRevision", "str", False, False),
    ("policyBoundary.validFrom", "ts", False, False),
    ("policyBoundary.validUntil", "ts", False, False),
    ("evidenceRefs", "arr_obj", True, False),
    ("evidenceRefs[].relation", "str", True, False),
    ("evidenceRefs[].digest", "digest", True, False),
    ("evidenceRefs[].artifactDigest", "digest", False, False),
    ("evidenceRefs[].uri", "str", False, False),
    ("evidenceRefs[].predicateType", "str", False, False),
    ("evidenceRefs[].typedDigest", "typedDigest", False, False),
    ("decision", "obj", True, False),
    ("decision.verdict", "enum:ALLOW,DENY,REFUSE,ESCALATE,DEFER,OBSERVE", True, False),
    ("decision.reasonCodes", "nearr_nes", True, False),
    ("decision.humanReadableSummary", "str", False, False),
    ("decision.obligations", "arr_any", False, False),
    ("decision.allowedScope", "arr_any", False, False),
    ("notChecked", "arr_obj_or_str", True, False),
    ("notChecked[].field", "str", False, False),
    ("notChecked[].reason", "str", False, False),
    ("notChecked[].impact", "str", False, False),
    ("decisionChangeConditions", "arr_obj", True, False),
    ("decisionChangeConditions[].conditionType", "str", False, False),
    ("decisionChangeConditions[].description", "str", False, False),
    ("decisionChangeConditions[].requiredEvidenceType", "str", False, False),
    ("actionOutcome", "obj", False, False),
    ("actionOutcome.status", "enum:notAttempted,blocked,refused,attempted,executed,failed,unknown", False, False),
    ("actionOutcome.performedAt", "ts", False, True),
    ("actionOutcome.outcomeRef", "obj", False, True),
    ("actionOutcome.outcomeRef.uri", "str", False, False),
    ("actionOutcome.outcomeRef.digest", "digest", False, False),
    ("traceContext", "open", False, False),
    ("privacy", "obj", True, False),
    ("privacy.rawInputsIncluded", "bool", True, False),
    ("privacy.redactionProfile", "str", False, False),
    ("privacy.erased", "arr_any", False, False),
    ("privacy.masked", "arr_any", False, False),
    ("validity", "obj", True, False),
    ("validity.audience", "nearr_nes", True, False),
    ("validity.nonce", "nes", True, False),
    ("validity.expiresAt", "ts", True, False),
]

OUT_TABLE = [
    ("schemaVersion", "ver", True, False),
    ("outcomeId", "nes", True, False),
    ("decisionRef", "digest", True, False),
    ("executor", "obj", True, False),
    ("executor.id", "nes", True, False),
    ("executor.keyId", "str", False, False),
    ("requestedActionDigest", "digest", True, False),
    ("status", "enum:executed,refused,failed,partial", True, False),
    ("performedAt", "ts", True, False),
    ("effectDigest", "digest", False, False),
    ("actualActionDigest", "digest", False, False),
    ("responseDigest", "digest", False, False),
    ("policyPurpose", "const:outcome", False, False),
    ("receiverRefs", "arr_obj", False, False),
    ("receiverRefs[].relation", "nes", True, False),
    ("receiverRefs[].digest", "digest", True, False),
    ("receiverRefs[].receiverId", "str", False, False),
    ("receiverRefs[].receiverKeyId", "str", False, False),
    ("receiverRefs[].artifactDigest", "digest", False, False),
    ("sequence", "obj", False, False),
    ("sequence.runId", "nes", True, False),
    ("sequence.seq", "int0", True, False),
    ("recordedAt", "ts", False, False),
    ("limitations", "arr_str", False, False),
    ("traceContext", "obj", False, False),
    ("traceContext.traceparent", "str", False, False),
    ("validity", "obj", False, False),
    ("validity.audience", "arr_any", False, False),
    ("validity.nonce", "str", False, False),
]


def _children(table):
    ch = {}
    for path, typ, req, nul in table:
        if "." in path:
            parent, name = path.rsplit(".", 1)
        else:
            parent, name = "", path
        ch.setdefault(parent, []).append((name, path, typ, req, nul))
    return ch


def _no_null(v, where, step):  # G11
    if v is None:
        raise Fail(step, "null inside " + where)
    if isinstance(v, dict):
        for k, x in v.items():
            _no_null(x, where + "." + k, step)
    elif isinstance(v, list):
        for i, x in enumerate(v):
            _no_null(x, where + "[%d]" % i, step)


def _check_obj(obj, parent, ch, step, where):
    names = {c[0] for c in ch.get(parent, [])}
    for name, path, typ, req, nul in ch.get(parent, []):
        if name not in obj:
            if req:
                raise Fail(step, "missing " + where + name)
            continue
        v = obj[name]
        if v is None:
            if not nul:
                raise Fail(step, "null not allowed at " + where + name)
            continue
        _check_val(v, path, typ, ch, step, where + name)
    extra = sorted(set(obj) - names)
    if extra:
        raise Fail(step, "member not allowed: " + ",".join(where + e for e in extra))


def _check_val(v, path, typ, ch, step, where):
    bad = lambda: Fail(step, "%s is not %s" % (where, typ))
    if typ == "ver":
        if not (isinstance(v, str) and SCHEMA.match(v)):
            raise bad()
    elif typ == "nes":
        if not _nes(v):
            raise bad()
    elif typ == "str":
        if not isinstance(v, str):
            raise bad()
    elif typ == "bool":
        if not isinstance(v, bool):
            raise bad()
    elif typ == "int0":
        if not (isinstance(v, int) and not isinstance(v, bool) and v >= 0):
            raise bad()
    elif typ.startswith("const:"):
        if v != typ[6:]:
            raise bad()
    elif typ.startswith("enum:"):
        if not (isinstance(v, str) and v in typ[5:].split(",")):
            raise bad()
    elif typ == "ts":
        if not is_ts(v):
            raise Fail(step, "timestamp form at " + where)
    elif typ == "digest":
        if not is_digest(v):
            raise Fail(step, "digest form at " + where)
    elif typ == "typedDigest":
        if not (isinstance(v, dict) and {"type", "digestAlgorithm", "digest"} <= set(v)
                and set(v) <= {"type", "digestAlgorithm", "digest", "purpose"}):
            raise bad()
        if not _nes(v["type"]) or ("purpose" in v and not _nes(v["purpose"])):
            raise bad()
        if v["digestAlgorithm"] != "jcs-sha256-v1" or not (isinstance(v["digest"], str) and HEX64.match(v["digest"])):
            raise bad()
    elif typ == "obj":
        if not isinstance(v, dict):
            raise bad()
        _check_obj(v, path, ch, step, where + ".")
    elif typ == "open":
        if not isinstance(v, dict):
            raise bad()
        _no_null(v, where, step)
    elif typ == "any":
        _no_null(v, where, step)
    elif typ == "arr_any":
        if not isinstance(v, list):
            raise bad()
        _no_null(v, where, step)
    elif typ == "arr_str":
        if not (isinstance(v, list) and all(isinstance(x, str) for x in v)):
            raise bad()
    elif typ == "nearr_nes":
        if not (isinstance(v, list) and v and all(_nes(x) for x in v)):
            raise bad()
    elif typ in ("arr_obj", "arr_obj_or_str"):
        if not isinstance(v, list):
            raise bad()
        for i, e in enumerate(v):
            if isinstance(e, dict):
                _check_obj(e, path + "[]", ch, step, "%s[%d]." % (where, i))
            elif typ == "arr_obj_or_str" and isinstance(e, str):
                pass
            else:
                raise bad()
    else:
        raise ValueError("table type " + typ)


DEC_CH = _children(DEC_TABLE)
OUT_CH = _children(OUT_TABLE)


def field_rules(pred, ch, step):
    if not isinstance(pred, dict):
        raise Fail(step, "predicate not an object")
    _check_obj(pred, "", ch, step, "")


# ---------- 3.2 steps 1 to 5 ----------
def envelope_steps(env_bytes, pubs, label):  # -06: pubs is a list of (raw key bytes, key object) from the trust policy
    try:
        env = strict_json(env_bytes)
    except Exception as e:
        raise Fail(label + "1", "envelope not JSON: %s" % e)
    if not isinstance(env, dict) or not {"payload", "payloadType", "signatures"} <= set(env):
        raise Fail(label + "1", "envelope members")
    if env["payloadType"] != PTYPE:
        raise Fail(label + "1", "payloadType")
    try:
        P = b64strict(env["payload"])  # -06: alphabet and padding only, no line breaks, zero pad bits
    except Exception:
        raise Fail(label + "2", "payload not base64 in the form of step 2")
    t = env["payloadType"].encode()
    pae = b"DSSEv1 " + str(len(t)).encode() + b" " + t + b" " + str(len(P)).encode() + b" " + P
    ok = None
    for s in env["signatures"] if isinstance(env["signatures"], list) else []:
        for raw, pub in pubs:
            try:
                pub.verify(b64strict(s["sig"]), pae)  # -06 G21: a sig not in the base64 form of step 2 does not count
                ok = raw
                break
            except (InvalidSignature, Exception):
                continue
        if ok is not None:
            break
    if ok is None:
        raise Fail(label + "3", "no signature verifies under the expected key")
    try:
        val = strict_json(P)
    except Exception as e:
        raise Fail(label + "4", "payload not strict JSON: %s" % e)
    try:
        if jcsb(val) != P:
            raise Fail(label + "4", "payload is not its own RFC 8785 serialization")
    except ValueError as e:
        raise Fail(label + "4", "canonical form: %s" % e)
    return val, P, sha(P), ok


def statement_step(val, ptype, step):
    if not isinstance(val, dict) or val.get("_type") != STMT or val.get("predicateType") != ptype:
        raise Fail(step, "_type or predicateType")
    pred = val.get("predicate")
    subj = val.get("subject")
    if not isinstance(subj, list) or len(subj) != 1 or not isinstance(subj[0], dict):  # G7
        raise Fail(step, "subject must have one entry")
    d = subj[0].get("digest")
    try:
        h = sha(jcsb(pred))
    except ValueError:
        raise Fail(step, "predicate not serializable")
    if not isinstance(d, dict) or d.get("sha256") != h:
        raise Fail(step, "subject digest is not SHA-256 of RFC 8785 of predicate")
    return pred


def verify_decision(env_bytes, ctx):
    """ctx: pub, dm_id, T, aud, nonce, action_bytes (opt). Returns (pred, R)."""
    val, P, R, kraw = envelope_steps(env_bytes, ctx["dec_keys"], "3.2 step ")
    pred = statement_step(val, DEC_TYPE, "3.2 step 6")
    st = "3.2 step 7"
    field_rules(pred, DEC_CH, st)
    pa = pred["proposedAction"]
    if "parametersDigest" not in pa and "parametersRef" not in pa:  # note (1), G12
        raise Fail(st, "proposedAction carries neither parametersDigest nor parametersRef")
    # step 8
    if pred["decisionMaker"]["id"] not in ctx["policy_dec"].get(kraw, []) or pred["decisionMaker"]["id"] != ctx["dm_id"]:
        raise Fail("3.2 step 8", "decisionMaker.id not bound to the key")  # -06: binding read from the trust policy file
    ctx["dm_key_raw"] = kraw
    # step 9 (members and forms are already held by step 7)
    v = pred["validity"]
    T = ts(ctx["T"])
    if ts(pred["decidedAt"]) > T or not (T < ts(v["expiresAt"])):
        raise Fail("3.2 step 9", "time bounds decidedAt <= T < expiresAt")
    if ctx.get("aud") is not None and ctx["aud"] not in v["audience"]:
        raise Fail("3.2 step 9", "audience")
    if ctx.get("nonce") is not None and v["nonce"] != ctx["nonce"]:
        raise Fail("3.2 step 9", "nonce")
    # step 10
    if ctx.get("action_bytes") is not None:
        pd = pa.get("parametersDigest")
        if not isinstance(pd, dict) or sha(ctx["action_bytes"]) != pd.get("sha256"):
            raise Fail("3.2 step 10", "action bytes digest")
    return pred, R


def check_case(case, pred, ctx):
    d = pred["decision"]
    if case == 1:
        st = "3.3 case 1"
        if d.get("verdict") != "ALLOW" or "user_approval" not in d["reasonCodes"]:
            raise Fail(st, "verdict/reasonCodes")
        ents = [e for e in pred["inputSnapshot"] if isinstance(e, dict) and e.get("name") == "approval record"]
        if len(ents) != 1:
            raise Fail(st, "approval record entry count")
        A = ctx.get("approval_bytes")
        if A is None:
            raise Fail(st, "approval record bytes not supplied")
        if sha(A) != (ents[0].get("digest") or {}).get("sha256"):
            raise Fail(st, "approval record digest")
        try:
            a = strict_json(A)
            if jcsb(a) != A:
                raise Fail(st, "approval record not RFC 8785")
        except Fail:
            raise
        except Exception as e:
            raise Fail(st, "approval record JSON: %s" % e)
        need = {"approvalId", "approver", "session", "actionDigest", "approvedAt", "validUntil"}
        if not isinstance(a, dict) or not need <= set(a):
            raise Fail(st, "approval record members")
        if not all(_nes(a[k]) for k in ("approvalId", "approver", "session")):
            raise Fail(st, "approval strings")
        if not is_digest(a["actionDigest"]):
            raise Fail(st, "actionDigest form")
        if a["actionDigest"] != pred["proposedAction"].get("parametersDigest"):
            raise Fail(st, "actionDigest != parametersDigest")
        if a["approver"] != pred["principal"]["id"]:
            raise Fail(st, "approver != principal.id")
        for k in ("approvedAt", "validUntil"):
            if not is_ts(a[k]):
                raise Fail(st, k)
        if not (ts(a["approvedAt"]) <= ts(pred["decidedAt"]) <= ts(ctx["T"]) < ts(pred["validity"]["expiresAt"])
                <= ts(a["validUntil"])):
            raise Fail(st, "time bounds approvedAt <= decidedAt <= T < expiresAt <= validUntil")
        return a
    elif case == 2:
        st = "3.3 case 2"
        if d.get("verdict") not in ("DENY", "REFUSE"):
            raise Fail(st, "verdict")
        ao = pred.get("actionOutcome")
        if ao is not None:
            if ao.get("status") not in ("notAttempted", "blocked", "refused"):
                raise Fail(st, "actionOutcome.status")
            if ao.get("performedAt") is not None or ao.get("outcomeRef") is not None:
                raise Fail(st, "performedAt/outcomeRef present")
    elif case == 3:
        st = "3.3 case 3"
        if d.get("verdict") != "ALLOW":
            raise Fail(st, "verdict")
        oc = ctx.get("outcome")
        if oc is None:
            raise Fail(st, "no outcome receipt supplied")
        oc["dm_pub_raw"] = ctx["dm_key_raw"]
        o = verify_outcome(oc["env"], pred, ctx["R"], oc)
        if o.get("status") != "executed":
            raise Fail(st, "outcome status not executed")
    return None


def verify_outcome(env_bytes, dpred, R, ctx):
    try:  # -06: "A failure there is a failure of this step"
        val, Q, RQ, kraw = envelope_steps(env_bytes, ctx["out_keys"], "3.2 step ")
    except Fail as f:
        raise Fail("3.4 step 1", "as " + f.step + ": " + f.why)
    pred = statement_step(val, OUT_TYPE, "3.4 step 2")
    st = "3.4 step 3"
    field_rules(pred, OUT_CH, st)
    st = "3.4 step 4"
    if pred["decisionRef"]["sha256"] != R:
        raise Fail(st, "decisionRef != content root of the decision")
    if pred["requestedActionDigest"] != dpred["proposedAction"].get("parametersDigest"):
        raise Fail(st, "requestedActionDigest != parametersDigest")
    st = "3.4 step 5"
    if pred["executor"]["id"] != ctx["executor_id"]:
        raise Fail(st, "executor.id")
    if ctx["executor_id"] not in ctx["policy_out"].get(kraw, []):  # -06 G22: permission read from the trust policy file
        raise Fail(st, "trust policy does not permit the outcome-signing key to attest the expected executor.id")
    if kraw == ctx["dm_pub_raw"]:
        raise Fail(st, "same key as decision maker")
    if pred["executor"]["id"] == dpred["decisionMaker"]["id"]:
        raise Fail(st, "executor.id == decisionMaker.id")
    st = "3.4 step 6"
    if pred["status"] == "executed" and pred.get("effectDigest") is None:
        raise Fail(st, "executed without effectDigest")
    if ctx.get("effect_bytes") is not None:
        if pred.get("effectDigest") is None or sha(ctx["effect_bytes"]) != pred["effectDigest"].get("sha256"):
            raise Fail(st, "effect bytes given but effectDigest absent or different")
    st = "3.4 step 7"
    pa = ts(pred["performedAt"])
    if pa < ts(dpred["decidedAt"]) or not (pa < ts(dpred["validity"]["expiresAt"])):
        raise Fail(st, "performedAt bounds decidedAt <= performedAt < expiresAt")
    return pred


# ---------- Section 4, relying party (G14) ----------
def section4(a, state_bytes):  # G17, as changed by -06 (G24)
    ident = {"approvalId": a["approvalId"], "actionDigest": a["actionDigest"], "session": a["session"]}
    try:  # -06: the state is read from its bytes, so an unparsable state is refused under item 5
        state = strict_json(state_bytes)
    except Exception:
        raise Fail("Section 4 item 5", "consumption state unreadable (not JSON)")
    if isinstance(state, list):
        gens = {"current": state}
    elif isinstance(state, dict) and all(isinstance(g, list) for g in state.values()):
        gens = state
    else:
        raise Fail("Section 4 item 5", "consumption state unreadable")
    if ident in gens.get("current", []):
        raise Fail("Section 4 item 1", "approval identity already consumed (current generation); "
                   "item 2 makes a copy with other bytes the same approval")  # -06: Section 4 last paragraph, A.5 F10
    for name, g in gens.items():
        if name != "current" and ident in g:
            raise Fail("Section 4 item 4", "approval identity consumed in generation " + name)


# ---------- 3.5 ----------
def set_checks(decisions, outcomes, approvals):
    """decisions: {name: (pred, R)}; outcomes: {name: pred}; approvals: {digest: obj}."""
    out = {"first": "pass", "second": "pass", "notes": []}
    seen = {}
    for n, (p, R) in decisions.items():
        if p["decision"].get("verdict") != "ALLOW":
            continue
        for e in p["inputSnapshot"]:
            if isinstance(e, dict) and e.get("name") == "approval record":
                a = approvals.get(e["digest"]["sha256"])
                if a is None:
                    out["notes"].append(n + ": approval record bytes not held")
                    continue
                ident = (a["approvalId"], a["actionDigest"]["sha256"], a["session"])
                if ident in seen and seen[ident][1] != R:
                    out["first"] = "fail"
                    out["notes"].append("same approval identity in %s and %s (item 1 of Section 4, identity as in "
                                        "item 2)" % (seen[ident][0], n))  # -06
                seen.setdefault(ident, (n, R))
    refused = {R for n, (p, R) in decisions.items() if p["decision"].get("verdict") in ("DENY", "REFUSE")}
    for n, o in outcomes.items():
        if o.get("status") == "executed" and o["decisionRef"]["sha256"] in refused:
            out["second"] = "fail"
    return out


# ---------- -06 driver: package files and a per-vector procedure list ----------
def _lenient_decision_id(b):
    try:
        v = json.loads(base64.b64decode(json.loads(b)["payload"]))
        return v["predicate"]["decisionId"]
    except Exception:
        return None


def _input_names(v):
    return [v[k] for k in ("action", "approval", "effect", "state") if v.get(k)]


def _env_files(v):
    return [v[k] for k in ("env", "decision_env", "outcome_env") if v.get(k)]


def load_policy(b):
    pol = json.loads(b)
    dec = {base64.b64decode(k): v for k, v in pol["decision"].items()}
    out = {base64.b64decode(k): v for k, v in pol["outcome"].items()}
    return dec, out


def run_vector(v, rd, inp):
    """Returns a verdict dict for one vector. rd(path) reads a package file."""
    dfl = inp["defaults"]
    pdec, pout = load_policy(rd(inp["policies"][v.get("policy", "A1")]))
    dec_keys = [(k, Ed25519PublicKey.from_public_bytes(k)) for k in pdec]
    out_keys = [(k, Ed25519PublicKey.from_public_bytes(k)) for k in pout]
    raw = lambda n: rd(inp["inputs"][n]["file"]) if n else None
    denv = rd(v["decision_env"] if v["proc"] == "case3" else v["env"])
    nonce = v.get("nonce") or _lenient_decision_id(denv)  # G6
    ctx = {"dec_keys": dec_keys, "policy_dec": pdec, "dm_id": dfl["dm_id"], "T": v["T"],
           "aud": v.get("aud", dfl["aud"]), "nonce": nonce, "action_bytes": raw(v.get("action")),
           "approval_bytes": raw(v.get("approval"))}
    case = {"case1": 1, "case2": 2, "case3": 3}[v["proc"]]
    if case == 3:
        ctx["outcome"] = {"env": rd(v["outcome_env"]), "out_keys": out_keys, "policy_out": pout,
                          "executor_id": v.get("executor_id", dfl["executor_id"]),
                          "effect_bytes": raw(v.get("effect"))}
    r = {"procedure": v["proc"], "T": v["T"], "expected_nonce_used": nonce}
    try:
        pred, R = verify_decision(denv, ctx)
        ctx["R"] = R
        a = check_case(case, pred, ctx)
    except Fail as f:
        r.update({"result": "fail", "step": f.step, "why": f.why, "receipt_verification": "fail"})
        return r, None
    r["receipt_verification"] = "pass"
    r["content_root"] = R
    if v.get("state"):
        try:
            section4(a, raw(v["state"]))
            r.update({"result": "pass", "step": None, "why": None, "section4": "pass"})
        except Fail as f:
            r.update({"result": "refused", "step": f.step, "why": f.why, "section4": "refused"})
    else:
        r.update({"result": "pass", "step": None, "why": None, "section4": "not run"})
    return r, (pred, R, a)


def main():
    inp = json.load(open(sys.argv[1]))
    pkg = sys.argv[2]
    od = sys.argv[3]
    rd = lambda path: open(os.path.join(pkg, path), "rb").read()
    have = lambda path: os.path.isfile(os.path.join(pkg, path))
    checks, off = {}, {}  # 0.1.1: off names the file, the two values and the vectors that read it
    for n, f in inp["inputs"].items():
        if f.get("sha256"):
            got = sha(rd(f["file"])) if have(f["file"]) else "missing"
            checks["input " + n] = got == f["sha256"]
            if got != f["sha256"]:
                off["input " + n] = {"file": f["file"], "sha256_inputs": f["sha256"], "sha256_found": got,
                                     "vectors": [v["name"] for v in inp["vectors"] if n in _input_names(v)]}
    checks["B from A.1 base64"] = sha(base64.b64decode("".join(inp["B_b64"]))) == inp["B_sha256"]
    for n, ps in inp["payload_sha256_from_text"].items():
        try:
            got = sha(base64.b64decode(json.loads(rd(ps["file"]))["payload"])) if have(ps["file"]) else "missing"
        except Exception:
            got = "unreadable"
        checks["payload " + n] = got == ps["sha256"]
        if got != ps["sha256"]:
            off["payload " + n] = {"file": ps["file"], "sha256_inputs": ps["sha256"], "sha256_found": got,
                                   "vectors": [v["name"] for v in inp["vectors"] if ps["file"] in _env_files(v)]}
    kc = {}
    for n, k in inp["keys"].items():
        seed = hashlib.sha256(k["label"].encode()).digest()
        pub = Ed25519PrivateKey.from_private_bytes(seed).public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
        kc[n] = {"seed_ok": seed.hex() == k["seed"], "pub_ok": base64.b64encode(pub).decode() == k["pub_b64"]}
    results, held = {}, {}
    for v in inp["vectors"]:
        gone = [p for p in _env_files(v) + [inp["inputs"][n]["file"] for n in _input_names(v)] if not have(p)]
        if gone:  # 0.1.1: a vector of another revision of the package
            results[v["name"]] = {"procedure": v["proc"], "T": v["T"], "result": "not run", "step": None,
                                  "why": "not in this package: " + ", ".join(gone)}
            continue
        r, h = run_vector(v, rd, inp)
        mine = sorted(k for k, o in off.items() if v["name"] in o["vectors"])
        if mine:
            r["inputs_off"] = mine
        results[v["name"]] = r
        if h:
            held[v["name"]] = h
    for n, note in inp.get("notes", {}).items():
        results[n]["note"] = note
    # Section 3.5 over the passing decisions of A.3 (G15); outcomes: V3-good when it passes
    a3 = ("V1-good", "V2-good", "V3-decision")
    decs = {n: (held[n][0], held[n][1]) for n in a3 if n in held}
    outs = {}
    if "V3-good" in held:
        o = json.loads(base64.b64decode(json.loads(rd(inp["v3_good_env"]))["payload"]))["predicate"]
        outs["V3-good"] = o
    approvals = {}
    for n in ("ap", "ap2"):
        b = rd(inp["inputs"][n]["file"])
        approvals[sha(b)] = json.loads(b)
    sc = set_checks(decs, outs, approvals)
    both = dict(decs)
    for n in ("F10", "F77"):
        if n in held:
            both[n] = (held[n][0], held[n][1])
    sc2 = set_checks(both, outs, approvals)
    doc = {"checker": "dr_check " + __version__, "draft": "draft-gruszka-audit-decision-receipts-06", "readings": READINGS,
           "build_checks": checks, "build_checks_off": off, "key_checks": kc, "results": results, "count": len(results),
           "set_checks_3_5_A3": sc, "set_checks_3_5_A3_plus_F10_F77_one_scope_for_information": sc2}
    data = json.dumps(doc, sort_keys=True, indent=1).encode()
    os.makedirs(od, exist_ok=True)
    open(os.path.join(od, "gruszka06_verdicts.json"), "wb").write(data)
    for k in sorted(off):  # 0.1.1: the verdicts are not changed by this, only reported
        print("build check off: %s (%s, found %s), read by %d vectors"
              % (k, off[k]["file"], off[k]["sha256_found"][:8], len(off[k]["vectors"])), file=sys.stderr)
    print(sha(data))


if __name__ == "__main__":
    main()
