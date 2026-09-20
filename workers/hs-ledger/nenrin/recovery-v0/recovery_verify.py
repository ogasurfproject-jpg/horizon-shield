# RUN_ALL: library  recovery-v0/v1 の検証器、python 側。node の recovery_verify.mjs と byte 一致でなければ意味が無い。
#
# 2 つ目の実装。canonical は合意層と同じ json.dumps(ensure_ascii=False, sort_keys=True, separators=(",",":"))。
# 正しいかどうかは、recovery_fixture の 7 記録の record_sha256 (node が計算した) と 1 桁も違わんかどうかで決まる。
# 採点は recovery_twin_test.py。読んで納得しても意味が無い。
import json, hashlib, re, base64

VERIFIER_VERSION = "0.3.0"
SCHEMAS = {"drift": "nenrin-drift-record-v1", "proposal": "nenrin-repair-proposal-v1",
           "authorization": "nenrin-authorization-v1", "execution": "nenrin-repair-execution-v1",
           "verify": "nenrin-verify-record-v1",
           "observation": "nenrin-witness-observation-v1"}   # v2: 籤で引いた証人の観測。連鎖の外、verify.external[].record の中
ORDER = [SCHEMAS[k] for k in ("drift", "proposal", "authorization", "execution", "verify")]
EMBEDDED = [SCHEMAS["observation"]]
POOL_SCHEMA = "nenrin-witness-pool-v1"
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
def _is_digits(v): return _is_str(v) and v.isdigit() and v.isascii()
def _is_https(v): return _is_str(v) and bool(re.match(r"^https://[^\s/]+", v))
def _host(u):
    from urllib.parse import urlsplit
    try: return (urlsplit(u).netloc or "").lower()
    except Exception: return ""

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
    if rec.get("schema") not in ORDER and rec.get("schema") not in EMBEDDED: refuse("bad_schema", "schema must be one of " + ", ".join(ORDER + EMBEDDED))
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
        ext = rec.get("external")
        if ext is not None and not isinstance(ext, list): refuse("bad_external", "external, when present, is an array of external witness results")
        elif isinstance(ext, list):
            for e in ext:
                if not _is_obj(e): refuse("bad_external", "external entries must be objects"); continue
                if "record" in e:
                    if not _is_obj(e["record"]): refuse("bad_external", "external[].record, when present, is the witness's signed observation record")
                    if not _is_str(e.get("signed_domain")): refuse("bad_external", "external[].signed_domain is required beside a record")
                if "answered" in e and not isinstance(e["answered"], bool): refuse("bad_external", "external[].answered, when present, is a boolean")
        if "draw" in rec:
            d = rec["draw"]
            if not _is_obj(d): refuse("bad_draw", "draw must be an object")
            else:
                b = d.get("beacon")
                if not (_is_obj(b) and _is_str(b.get("kind")) and _is_digits(b.get("height")) and _is_hex(b.get("hash"))): refuse("bad_draw", "draw.beacon needs kind, height (digits as a string) and hash (64 hex)")
                if not _is_hex(d.get("pool_sha256")): refuse("bad_draw", "draw.pool_sha256 must be 64 hex")
                if not _is_digits(d.get("pool_size")): refuse("bad_draw", "draw.pool_size must be digits as a string")
                if not _is_digits(d.get("k")): refuse("bad_draw", "draw.k must be digits as a string")
                if not _is_hex(d.get("subject_sha256")): refuse("bad_draw", "draw.subject_sha256 must be 64 hex (the record the draw serves)")
                if not _is_hex(d.get("request_sha256")): refuse("bad_draw", "draw.request_sha256 must be 64 hex (the request every drawn witness received)")
                dr = d.get("drawn")
                if not (isinstance(dr, list) and all(_is_str(x) for x in dr)): refuse("bad_draw", "draw.drawn must be an array of signed_domain strings (may be empty when the pool is empty)")
                if "commitment" in d:
                    c = d["commitment"]
                    if not _is_obj(c): refuse("bad_draw", "draw.commitment must be an object")
                    else:
                        if not _is_hex(c.get("subject_sha256")): refuse("bad_draw", "draw.commitment.subject_sha256 must be 64 hex")
                        if not _is_digits(c.get("ledger_entry")): refuse("bad_draw", "draw.commitment.ledger_entry must be digits as a string")
                        if not _is_https(c.get("ledger_url")): refuse("bad_draw", "draw.commitment.ledger_url must be https")
                        if not _is_hex(c.get("claim_sha256")): refuse("bad_draw", "draw.commitment.claim_sha256 must be 64 hex")
                        a = c.get("anchor")
                        if not (_is_obj(a) and _is_str(a.get("kind")) and _is_digits(a.get("height")) and _is_hex(a.get("hash"))): refuse("bad_draw", "draw.commitment.anchor needs kind, height (digits as a string) and hash (64 hex)")
        if not _is_hex(rec.get("prev")): refuse("bad_prev", "verify must link to the execution")
        elif rec.get("prev") != rec.get("execution_sha256"): refuse("prev_mismatch", "verify.prev must equal execution_sha256")
    elif s == SCHEMAS["observation"]:
        if not _is_str(rec.get("endpoint")): refuse("bad_endpoint", "endpoint is required (the origin that was measured)")
        ob = rec.get("observed")
        if not (_is_obj(ob) and len(ob) > 0 and all(_is_obj(v) for v in ob.values())): refuse("bad_observed", "observed must be an object: surface -> observed state object")
        if not _is_hex(rec.get("request_sha256")): refuse("bad_request_sha256", "request_sha256 must be 64 hex")
        src = rec.get("source")
        if not (_is_obj(src) and src.get("kind") == "external_witness" and _is_str(src.get("signed_domain")) and _is_https(src.get("key_url"))):
            refuse("bad_source", "source must be { kind: external_witness, signed_domain, key_url (https) }")
        elif _host(src["key_url"]) != src["signed_domain"].lower():
            refuse("bad_source", "source.signed_domain must be the host of source.key_url (conduct-v1.1 11.4)")
        if rec.get("prev", "__absent__") is not None: refuse("bad_prev", "an observation stands alone: prev must be null")
    return refs

# ---- v2 籤 (kuji): witness_draw.mjs の双子。同じ 3 入力 (beacon, 池, 対象) から同じ k 人が出んかったら意味が無い ----
def _cu(o): return json.dumps(o, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

def normalize_pool(pool):
    entries = pool if isinstance(pool, list) else (pool.get("entries") if isinstance(pool, dict) else None)
    if not isinstance(entries, list): raise ValueError("pool must be an array of entries or {entries: [...]}")
    out = []
    for e in entries:
        if not isinstance(e, dict): raise ValueError("pool entry is not an object")
        for k in ("signed_domain", "key_url", "public_key_ed25519_b64"):
            if not _is_str(e.get(k)): raise ValueError("pool entry lacks " + k)
        if _host(e["key_url"]) != e["signed_domain"].lower(): raise ValueError("pool entry signed_domain is not the host of its key_url (11.4)")
        o = {"signed_domain": e["signed_domain"], "key_url": e["key_url"], "public_key_ed25519_b64": e["public_key_ed25519_b64"]}
        if isinstance(e.get("a2a_url"), str): o["a2a_url"] = e["a2a_url"]
        out.append(o)
    out.sort(key=lambda e: e["public_key_ed25519_b64"])
    keys = set(); doms = set()
    for e in out:
        if e["public_key_ed25519_b64"] in keys: raise ValueError("pool has a duplicate key")
        if e["signed_domain"].lower() in doms: raise ValueError("pool has a duplicate domain " + e["signed_domain"])
        keys.add(e["public_key_ed25519_b64"]); doms.add(e["signed_domain"].lower())
    return out

def _hashed_entry(e): return {"signed_domain": e["signed_domain"], "key_url": e["key_url"], "public_key_ed25519_b64": e["public_key_ed25519_b64"]}
def pool_sha256(pool): return sha256_hex(_cu({"schema": POOL_SCHEMA, "entries": [_hashed_entry(e) for e in normalize_pool(pool)]}))

def draw(pool, beacon_hash, subject_sha256, k, exclude_host=None):
    if not _is_hex(beacon_hash): raise ValueError("beacon_hash must be 64 hex")
    if not _is_hex(subject_sha256): raise ValueError("subject_sha256 must be 64 hex")
    want = int(k)
    if want < 0: raise ValueError("k must be non-negative")
    all_ = normalize_pool(pool)
    psha = pool_sha256(pool)
    ex = exclude_host.lower() if exclude_host else None
    eligible = [e for e in all_ if not ex or e["signed_domain"].lower() != ex]
    n = len(eligible); kk = min(want, n)
    seed = sha256_hex(beacon_hash + "|" + psha + "|" + subject_sha256)
    arr = list(eligible)
    for i in range(kk):
        r = sha256_hex(seed + "|" + str(i))
        j = i + int(r[:16], 16) % (n - i)
        arr[i], arr[j] = arr[j], arr[i]
    chosen = arr[:kk]
    return {"pool_sha256": psha, "pool_size": str(len(all_)), "eligible": str(n), "k": str(kk), "k_requested": str(want),
            "seed_sha256": seed, "drawn": [e["signed_domain"] for e in chosen], "entries": chosen}

COMMITMENT_SCHEMA = "tsugi-draw-commitment-v1"
def commitment_claim_text(subject_sha256):
    if not _is_hex(subject_sha256): raise ValueError("subject_sha256 must be 64 hex")
    return "# " + COMMITMENT_SCHEMA + "\n\nsubject_sha256: " + subject_sha256 + "\n\nThis entry commits the record named by subject_sha256 (a TSUGI execution record) to the ledger before any re-verification witness is drawn. The draw's beacon must be the Bitcoin block after the block this entry is anchored to. Establishes: that subject_sha256 existed no later than the anchor block. Does not establish: anything about the record's content.\n"

def subset_matches(expected, observed):
    if isinstance(expected, dict) and isinstance(observed, dict):
        return all(k in observed and subset_matches(expected[k], observed[k]) for k in expected)
    return _cu(expected) == _cu(observed)

def verify_witnesses(verify, own_host=None, endpoint=None, execution_sha256=None, quorum=None, execution_at=None):
    refs = []
    def refuse(code, why): refs.append({"code": code, "why": why})
    quorum = quorum or {}
    q = int(quorum["q"]) if quorum.get("q") is not None else None
    pool = quorum.get("pool"); beacon_hash = (quorum.get("beaconHash") or quorum.get("beacon_hash") or "").lower() or None
    d = verify.get("draw"); drawn = d.get("drawn", []) if isinstance(d, dict) else []
    own = own_host.lower() if own_host else ""
    if d:
        if execution_sha256 and d.get("subject_sha256") != execution_sha256: refuse("draw_subject_mismatch", "draw.subject_sha256 is not the execution record_sha256")
        if own and any(str(x).lower() == own for x in drawn): refuse("self_witness", "the draw lists the endpoint's own host as a witness (11.4)")
        if beacon_hash and str(d.get("beacon", {}).get("hash", "")).lower() != beacon_hash: refuse("beacon_mismatch", "draw.beacon.hash is not the beacon the verifier fetched")
        k_expected = str(quorum["k"]) if quorum.get("k") is not None else None
        if k_expected and d.get("k") != k_expected and d.get("pool_size") != "0" and int(d.get("k", "0")) < int(k_expected): refuse("draw_mismatch", "draw.k is below the policy k (the operator may not shorten the draw)")
        c = d.get("commitment")
        if quorum.get("requireCommitment") and not c: refuse("draw_uncommitted", "policy requires the draw's subject to be anchored on the ledger before the beacon block; draw.commitment is absent")
        if c:
            if c.get("subject_sha256") != d.get("subject_sha256"): refuse("draw_subject_mismatch", "draw.commitment.subject_sha256 is not draw.subject_sha256")
            try: claim = sha256_hex(commitment_claim_text(c.get("subject_sha256", "")))
            except Exception: claim = ""
            if c.get("claim_sha256") != claim: refuse("commitment_claim_mismatch", "the ledger entry named does not commit this subject")
            try: nxt = str(int(c.get("anchor", {}).get("height", "x")) + 1)
            except Exception: nxt = ""
            if nxt != str(d.get("beacon", {}).get("height")): refuse("beacon_not_next_block", "the beacon must be the block after the one the subject is anchored to")
            ca = quorum.get("commitmentAnchor") or quorum.get("commitment_anchor")
            if ca:
                if str(ca.get("height")) != str(c.get("anchor", {}).get("height")): refuse("commitment_mismatch", "the ledger entry's OTS proof anchors at another height than the record says")
                if ca.get("hash") and str(ca["hash"]).lower() != str(c.get("anchor", {}).get("hash", "")).lower(): refuse("commitment_mismatch", "the anchor block hash the reader verified is not the one in the record")
        if pool is not None:
            try:
                re_ = draw(pool, d["beacon"]["hash"], d["subject_sha256"], d["k"], exclude_host=own or None)
                if re_["pool_sha256"] != d.get("pool_sha256"): refuse("pool_mismatch", "the pool given to the verifier hashes differently from the record")
                elif _cu(re_["drawn"]) != _cu(drawn): refuse("draw_mismatch", "recomputing the draw gives " + ", ".join(re_["drawn"]) + ", the record says " + ", ".join(drawn))
                elif re_["pool_size"] != d.get("pool_size"): refuse("draw_mismatch", "draw.pool_size is not the size of the pool given")
            except Exception as e: refuse("bad_pool", "the pool given to the verifier is malformed: " + str(e))
    by_domain = None
    if pool is not None:
        try: by_domain = {e["signed_domain"].lower(): e for e in normalize_pool(pool)}
        except Exception: by_domain = None
    answered, agreeing, disagreeing = [], [], []
    for n, e in enumerate(verify.get("external") or []):
        if not isinstance(e, dict) or "record" not in e: continue
        rec = e["record"]; tag = "external[%d]" % n
        v = verify_record(rec)
        if not v["ok"]:
            for x in v["refusals"]: refuse(x["code"], tag + ": " + x["why"])
            continue
        if rec.get("schema") != SCHEMAS["observation"]: refuse("bad_external", tag + ": record is not a witness observation"); continue
        if not (rec.get("signature_ed25519_b64") and rec.get("public_key_ed25519_b64")): refuse("witness_unsigned", tag + ": an embedded observation must be signed"); continue
        dom = str(rec["source"]["signed_domain"]).lower()
        if dom != str(e.get("signed_domain", "")).lower(): refuse("witness_domain_mismatch", tag + ": record is signed for another domain than the entry says"); continue
        if own and dom == own: refuse("self_witness", tag + ": the endpoint's own host witnessed itself (11.4)"); continue
        if not any(str(x).lower() == dom for x in drawn): refuse("witness_not_drawn", tag + ": " + rec["source"]["signed_domain"] + " was not drawn"); continue
        if endpoint and _host(rec.get("endpoint", "")) != _host(endpoint): refuse("witness_endpoint_mismatch", tag + ": observation is about another endpoint"); continue
        if d and rec.get("request_sha256") != d.get("request_sha256"): refuse("witness_request_mismatch", tag + ": observation answers another request"); continue
        if execution_at and rec.get("recorded_at", "") < execution_at: refuse("witness_before_execution", tag + ": observation recorded before the execution it re-verifies"); continue
        if by_domain is not None:
            pe = by_domain.get(dom)
            if not pe or pe["public_key_ed25519_b64"] != rec.get("public_key_ed25519_b64") or pe["key_url"] != rec["source"].get("key_url"):
                refuse("witness_key_mismatch", tag + ": signed with a key or key_url that is not the pool's"); continue
        answered.append(rec["source"]["signed_domain"])
        if dom in agreeing or dom in disagreeing: continue
        (agreeing if subset_matches(verify.get("expected_after", {}), rec.get("observed", {})) else disagreeing).append(dom)
    if q is not None and verify.get("recovered") is True and len(agreeing) < q:
        refuse("witness_quorum_short", "recovered is true but %d of the required %d drawn witnesses observed the expected state (drawn %d, answered %d, disagreeing %d)" % (len(agreeing), q, len(drawn), len(answered), len(disagreeing)))
    return {"refusals": refs, "drawn": list(drawn), "answered": answered, "agreeing": agreeing, "disagreeing": disagreeing}

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

def verify_chain(records, operator_keys=None, witness_quorum=None):
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
    witness = None
    if verify and (witness_quorum is not None or "draw" in verify or any(isinstance(e, dict) and "record" in e for e in (verify.get("external") or []))):
        witness = verify_witnesses(verify, own_host=_host(records[0].get("endpoint", "")), endpoint=records[0].get("endpoint"), execution_sha256=hashes[i + 2], quorum=witness_quorum, execution_at=(execution or {}).get("recorded_at"))
        for x in witness["refusals"]: refuse(x["code"], x["why"])
    seg = {"drifts": drifts, "complete": len(rest) == 4}
    if witness is not None: seg["witness"] = {k: witness[k] for k in ("drawn", "answered", "agreeing", "disagreeing")}
    return {"ok": len(refs) == 0, "refusals": refs, "segment": seg}

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
