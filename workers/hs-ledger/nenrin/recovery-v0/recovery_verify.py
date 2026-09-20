# RUN_ALL: library  recovery-v0/v1 の検証器、python 側。node の recovery_verify.mjs と byte 一致でなければ意味が無い。
#
# 2 つ目の実装。canonical は合意層と同じ json.dumps(ensure_ascii=False, sort_keys=True, separators=(",",":"))。
# 正しいかどうかは、recovery_fixture の 7 記録の record_sha256 (node が計算した) と 1 桁も違わんかどうかで決まる。
# 採点は recovery_twin_test.py。読んで納得しても意味が無い。
import json, hashlib, re, base64

VERIFIER_VERSION = "0.2.0"
SCHEMAS = {"drift": "nenrin-drift-record-v1", "proposal": "nenrin-repair-proposal-v1",
           "authorization": "nenrin-authorization-v1", "execution": "nenrin-repair-execution-v1",
           "verify": "nenrin-verify-record-v1"}
ORDER = [SCHEMAS[k] for k in ("drift", "proposal", "authorization", "execution", "verify")]
PRIMITIVES = {
    "quarantine_endpoint": {"reversible": True, "approval": "auto"},
    "redeploy_pinned": {"reversible": True, "approval": "human"},
    "resign_agent_card": {"reversible": True, "approval": "human"},
    "revert_to_last_witnessed_good": {"reversible": True, "approval": "human"},
    "rotate_credential": {"reversible": False, "approval": "human"},
}
SIG_FIELDS = ("record_sha256", "signature_ed25519_b64", "public_key_ed25519_b64")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")

def hashed_body(rec): return {k: v for k, v in rec.items() if k not in SIG_FIELDS}
def canonical_text(rec): return json.dumps(hashed_body(rec), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
def canonical_bytes(rec): return canonical_text(rec).encode("utf-8")
def sha256_hex(b): return hashlib.sha256(b if isinstance(b, bytes) else b.encode("utf-8")).hexdigest()
def record_sha256(rec): return sha256_hex(canonical_bytes(rec))

def _is_str(v): return isinstance(v, str) and len(v) > 0
def _is_str_arr(v): return isinstance(v, list) and len(v) > 0 and all(_is_str(x) for x in v)
def _is_obj(v): return isinstance(v, dict)
def _is_hex(v): return _is_str(v) and bool(HEX64.match(v))

def _has_number(v):
    if isinstance(v, bool): return False               # JSON の真偽は python では int の subclass。数やない。
    if isinstance(v, (int, float)): return True
    if isinstance(v, list): return any(_has_number(x) for x in v)
    if isinstance(v, dict): return any(_has_number(x) for x in v.values())
    return False

def validate(rec):
    refs = []; seen = set()
    def refuse(code, why):
        k = code + "|" + why
        if k in seen: return
        seen.add(k); refs.append({"code": code, "why": why})
    if not _is_obj(rec):
        refuse("not_object", "record is not a JSON object"); return refs
    if rec.get("schema") not in ORDER: refuse("bad_schema", "schema must be one of " + ", ".join(ORDER))
    if not _is_str(rec.get("recorded_at")) or not ISO.match(rec.get("recorded_at", "")): refuse("bad_recorded_at", "recorded_at must be ISO-8601 UTC ending in Z")
    w = rec.get("witness")
    if not _is_obj(w) or not _is_str(w.get("name")) or not _is_str(w.get("vantage")): refuse("bad_witness", "witness.name and witness.vantage are required")
    if not _is_str_arr(rec.get("establishes")): refuse("disclaimer_missing", "establishes must be a non-empty array of strings")
    if not _is_str_arr(rec.get("does_not_establish")): refuse("disclaimer_missing", "does_not_establish must be a non-empty array of strings")
    prev = rec.get("prev", "__absent__")
    if not (prev is None or _is_hex(prev)): refuse("bad_prev", "prev must be null or 64 hex")
    if "record_sha256" in rec and not _is_hex(rec["record_sha256"]): refuse("bad_record_sha256", "record_sha256, when present, must be 64 hex")
    if _has_number(rec): refuse("number_in_record", "v0 records carry no JSON numbers; write counts as strings")
    s = rec.get("schema")
    if s == SCHEMAS["drift"]:
        if not _is_str(rec.get("endpoint")): refuse("bad_endpoint", "endpoint is required")
        if not _is_str(rec.get("surface")): refuse("bad_surface", "surface is required")
        if not isinstance(rec.get("drift"), bool): refuse("bad_drift", "drift must be a boolean")
        if not _is_obj(rec.get("observed")): refuse("bad_observed", "observed must be an object")
        if not _is_obj(rec.get("expected")): refuse("bad_expected", "expected must be an object")
        if rec.get("drift") is True and not _is_str(rec.get("kind")): refuse("bad_kind", "kind is required when drift is true")
        if rec.get("prev") is not None: refuse("bad_prev", "a drift record starts a segment: prev must be null")
    elif s == SCHEMAS["proposal"]:
        ds = rec.get("drift_sha256")
        if not (isinstance(ds, list) and len(ds) > 0 and all(_is_hex(x) for x in ds)): refuse("bad_drift_sha256", "drift_sha256 must be a non-empty array of 64 hex")
        if not (_is_str(rec.get("primitive")) and rec.get("primitive") in PRIMITIVES): refuse("primitive_not_in_catalog", "primitive must be in the catalog")
        if not _is_str(rec.get("diagnosis")): refuse("bad_diagnosis", "diagnosis is required")
        if not _is_obj(rec.get("expected_after")): refuse("bad_expected_after", "expected_after must be an object")
        if not _is_str(rec.get("rollback")): refuse("bad_rollback", "rollback is required")
        if not _is_hex(rec.get("prev")): refuse("bad_prev", "proposal must link to the last drift record")
    elif s == SCHEMAS["authorization"]:
        if not _is_hex(rec.get("proposal_sha256")): refuse("bad_proposal_sha256", "proposal_sha256 must be 64 hex")
        if rec.get("decision") not in ("approved", "refused"): refuse("bad_decision", "decision must be approved or refused")
        if not _is_str(rec.get("by")): refuse("bad_by", "by is required")
        if not _is_str(rec.get("expires_at")) or not ISO.match(rec.get("expires_at", "")): refuse("bad_expires_at", "expires_at must be ISO-8601 UTC")
        if not _is_hex(rec.get("prev")): refuse("bad_prev", "authorization must link to the proposal")
        elif rec.get("prev") != rec.get("proposal_sha256"): refuse("prev_mismatch", "authorization.prev must equal proposal_sha256")
    elif s == SCHEMAS["execution"]:
        if not _is_hex(rec.get("authorization_sha256")): refuse("bad_authorization_sha256", "authorization_sha256 must be 64 hex")
        if not (_is_str(rec.get("primitive")) and rec.get("primitive") in PRIMITIVES): refuse("primitive_not_in_catalog", "primitive must be in the catalog")
        if not _is_obj(rec.get("before")): refuse("bad_before", "before must be an object")
        if not _is_obj(rec.get("after")): refuse("bad_after", "after must be an object")
        if rec.get("outcome") not in ("ok", "failed", "rolled_back"): refuse("bad_outcome", "outcome must be ok, failed or rolled_back")
        if not _is_str_arr(rec.get("steps")): refuse("bad_steps", "steps must be a non-empty array of strings")
        if not _is_hex(rec.get("prev")): refuse("bad_prev", "execution must link to the authorization")
        elif rec.get("prev") != rec.get("authorization_sha256"): refuse("prev_mismatch", "execution.prev must equal authorization_sha256")
    elif s == SCHEMAS["verify"]:
        if not _is_hex(rec.get("execution_sha256")): refuse("bad_execution_sha256", "execution_sha256 must be 64 hex")
        if not _is_obj(rec.get("observed")): refuse("bad_observed", "observed must be an object")
        if not _is_obj(rec.get("expected_after")): refuse("bad_expected_after", "expected_after must be an object")
        if not isinstance(rec.get("recovered"), bool): refuse("bad_recovered", "recovered must be a boolean")
        if not _is_hex(rec.get("prev")): refuse("bad_prev", "verify must link to the execution")
        elif rec.get("prev") != rec.get("execution_sha256"): refuse("prev_mismatch", "verify.prev must equal execution_sha256")
    return refs

def verify_signature(rec):
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    sig = rec.get("signature_ed25519_b64"); pub = rec.get("public_key_ed25519_b64")
    if not sig or not pub: return (False, "signature_ed25519_b64 and public_key_ed25519_b64 must both be present")
    try:
        Ed25519PublicKey.from_public_bytes(base64.b64decode(pub)).verify(base64.b64decode(sig), canonical_bytes(rec))
        return (True, None)
    except Exception:
        return (False, "Ed25519 signature does not verify over the canonical bytes")

def verify_record(rec):
    refs = validate(rec)
    if refs: return {"ok": False, "refusals": refs}
    h = record_sha256(rec)
    if "record_sha256" in rec and rec["record_sha256"] != h:
        return {"ok": False, "refusals": [{"code": "hash_mismatch", "why": "carried " + rec["record_sha256"] + ", computed " + h}]}
    if "signature_ed25519_b64" in rec or "public_key_ed25519_b64" in rec:
        okk, why = verify_signature(rec)
        if not okk: return {"ok": False, "refusals": [{"code": "bad_signature", "why": why}]}
    return {"ok": True, "refusals": [], "record_sha256": h}

def verify_chain(records, operator_keys=None):
    refs = []
    def refuse(code, why): refs.append({"code": code, "why": why})
    if not isinstance(records, list) or len(records) == 0:
        refuse("empty_chain", "no records"); return {"ok": False, "refusals": refs}
    hashes = []
    for i, rec in enumerate(records):
        v = verify_record(rec)
        if not v["ok"]:
            for x in v["refusals"]: refuse(x["code"], "record[%d]: %s" % (i, x["why"]))
            return {"ok": False, "refusals": refs}
        hashes.append(v["record_sha256"])
    i = 0; drifts = []
    while i < len(records) and records[i].get("schema") == SCHEMAS["drift"]:
        drifts.append(hashes[i]); i += 1
    if not drifts:
        refuse("no_drift", "a segment starts with at least one drift record"); return {"ok": False, "refusals": refs}
    rest = records[i:]
    expect = [SCHEMAS["proposal"], SCHEMAS["authorization"], SCHEMAS["execution"], SCHEMAS["verify"]]
    if len(rest) > len(expect): refuse("bad_order", "more records than a segment holds")
    for k in range(min(len(rest), len(expect))):
        if rest[k].get("schema") != expect[k]: refuse("bad_order", "record %d is %s, expected %s" % (i + k, rest[k].get("schema"), expect[k]))
    if refs: return {"ok": False, "refusals": refs}
    for k in range(i, len(records)):
        if records[k].get("prev") != hashes[k - 1]: refuse("chain_broken", "record[%d].prev != previous record_sha256" % k)
    proposal = rest[0] if len(rest) > 0 else None
    authorization = rest[1] if len(rest) > 1 else None
    execution = rest[2] if len(rest) > 2 else None
    verify = rest[3] if len(rest) > 3 else None
    if proposal:
        for h in proposal.get("drift_sha256", []):
            if h not in drifts: refuse("unknown_drift", "proposal cites drift not in this segment")
    if authorization and authorization.get("proposal_sha256") != hashes[i]: refuse("ref_mismatch", "authorization.proposal_sha256 != proposal record_sha256")
    if execution and execution.get("authorization_sha256") != hashes[i + 1]: refuse("ref_mismatch", "execution.authorization_sha256 != authorization record_sha256")
    if verify and verify.get("execution_sha256") != hashes[i + 2]: refuse("ref_mismatch", "verify.execution_sha256 != execution record_sha256")
    if authorization and execution and authorization.get("decision") != "approved": refuse("unauthorized_execution", "execution follows an authorization whose decision is " + str(authorization.get("decision")))
    if execution:
        prim = execution.get("primitive")
        needs_human = bool(PRIMITIVES.get(prim) and PRIMITIVES[prim]["approval"] == "human")
        if needs_human and operator_keys is not None:
            if not authorization: refuse("unauthorized_execution", "human-approval primitive executed with no authorization")
            else:
                signed = bool(authorization.get("signature_ed25519_b64") and authorization.get("public_key_ed25519_b64"))
                if not signed: refuse("authorization_unsigned", "human-approval primitive " + str(prim) + " follows an authorization not signed by an operator key")
                elif authorization.get("public_key_ed25519_b64") not in operator_keys: refuse("authorization_untrusted_key", "authorization signed by a key not in the operator trust set")
        if authorization and authorization.get("expires_at") and execution.get("recorded_at", "") > authorization.get("expires_at", ""):
            refuse("authorization_expired", "execution.recorded_at is after authorization.expires_at")
    if proposal and execution and proposal.get("primitive") != execution.get("primitive"): refuse("primitive_mismatch", "execution.primitive != proposal.primitive")
    if proposal and verify:
        cu = lambda o: json.dumps(o, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        if cu(proposal.get("expected_after")) != cu(verify.get("expected_after")): refuse("expected_after_drift", "verify.expected_after differs from proposal.expected_after")
    if verify and verify.get("recovered") is True:
        for k in verify.get("expected_after", {}).keys():
            if k not in verify.get("observed", {}): refuse("recovered_unobserved", "recovered is true but observed has no entry for surface " + k)
    return {"ok": len(refs) == 0, "refusals": refs, "segment": {"drifts": drifts, "complete": len(rest) == 4}}

def sign_record(rec, priv):
    from cryptography.hazmat.primitives import serialization
    r = dict(hashed_body(rec)); r["record_sha256"] = record_sha256(r)
    sig = priv.sign(canonical_bytes(r))
    pub = priv.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    r["signature_ed25519_b64"] = base64.b64encode(sig).decode()
    r["public_key_ed25519_b64"] = base64.b64encode(pub).decode()
    return r

def fetch_operator_keys(origin, timeout=15):
    """信用アンカーを gate から取る (/keys/operator.json)。404 = まだ配っとらん = 空 (strict は全部 untrusted になる。それが正しい)。"""
    import urllib.request, urllib.error
    url = str(origin).rstrip("/") + "/keys/operator.json"
    req = urllib.request.Request(url, headers={"user-agent": "recovery-verify-py/" + VERIFIER_VERSION})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            j = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 404: return []
        raise
    k = j.get("public_key_ed25519_b64") if isinstance(j, dict) else None
    return [k.strip()] if isinstance(k, str) and k.strip() else []
