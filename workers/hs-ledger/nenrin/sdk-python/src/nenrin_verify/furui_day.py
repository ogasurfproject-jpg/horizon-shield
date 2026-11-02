"""furui-day and resume-admission: check one day of the content check runner, or one admissions[] line of a Resume.

  nenrin-verify furui-day <day> --leaf <i>
      Six checks on leaf i of day <day> (YYYY-MM-DD, UTC):
        1 envelope_shape   the envelope the runner serves has the closed shape (furui-check-signed-v1, no text field)
        2 leaf_sha256      sha256(0x00 || musubi-canonical-v0(envelope)) is the leaf the runner names
        3 audit_path       the RFC 6962 audit path rebuilds the root of the day record the ledger serves
        4 signature        runner-1's Ed25519 signature on the day record, and on the envelope
        5 runner_key       runner-1's key is in the ledger's /.well-known/furui-check-keys.json, inside from_height
                           (and before revoked_height) for the heights of the record and of the envelope
        6 bitcoin_anchor   the day record is listed in a ledger batch entry whose OpenTimestamps proof commits the
                           entry's sha256 to a Bitcoin block header (not_yet before the batch or before the anchor)

  nenrin-verify resume-admission <endpoint> <record_sha256>
      One line of the Resume's admissions[] against the ledger:
        1 resume           GET /resume?endpoint=..., resume_sha256 recomputes
        2 admission_line   the line is listed once, with the closed fields (not_yet while not_counted says unanchored)
        3 admission_record the stored bytes hash to record_sha256; schema, relying party host, decision, content match
        4 ledger_batch     the batch entry ledger_n hashes to its claim and lists the record as a2a-admission-v0
        5 bitcoin_anchor   the entry is anchored and its OpenTimestamps proof commits it to a Bitcoin block header

  nenrin-verify furui-vectors <vectors.json>
      Run the shared vectors (the same file the JavaScript, Go and Java ports run) and print one line per case.

Exit: 0 ok, 1 fail, 3 not_yet, 2 usage or network error. Network: GET only, only https://ledger.horizonshield.dev and
https://furui.horizonshield.dev, no redirects. The Bitcoin block header itself is not fetched: the output names the
block height and the merkle root the proof commits to, to be compared with any copy of the Bitcoin chain.
"""
import base64
import datetime
import hashlib
import json
import re
import sys

LEDGER = "https://ledger.horizonshield.dev"
FURUI = "https://furui.horizonshield.dev"
KEYS_URL = LEDGER + "/.well-known/furui-check-keys.json"
SIGNER = {"domain": "horizonshield.dev", "key_url": KEYS_URL}
ALLOWED_HOSTS = ("ledger.horizonshield.dev", "furui.horizonshield.dev")
SAFE = 9007199254740991
H64 = re.compile(r"^[0-9a-f]{64}$")
DAY = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
ISO_MS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
NONCE = re.compile(r"^(?:[0-9a-f]{32}|heartbeat-\d{4}-\d{2}-\d{2})$")
SIG88 = re.compile(r"^[A-Za-z0-9+/]{86}==$")
CHECK_KEYS = sorted(["action_binding_digest", "answered", "checked_at_height", "contract_sha256", "decision", "input_commit", "marks",
                     "nonce", "rules_sha256", "schema", "scope_sha256", "signed_at", "stage_reached", "trace_sha256", "unread"])
DAY_KEYS = sorted(["clock_skew", "day", "first_height", "last_height", "late", "leaf", "n", "publication", "root", "schema",
                   "signatures", "signer", "tree"])
DAY_LEAF = "sha256(0x00 || musubi-canonical-v0(envelope))"
RESUME_ENVELOPE_KEYS = ("evaluated_at", "subject_responses", "not_counted", "scan", "recompute", "resume_sha256")
UNANCHORED = ("not_yet_anchored", "confirmed_without_block_time")
CHECK_SCHEMA = "nenrin-furui-check-v1"
DAY_STEPS = ["envelope_shape", "leaf_sha256", "audit_path", "signature", "runner_key", "bitcoin_anchor"]
RESUME_STEPS = ["resume", "admission_line", "admission_record", "ledger_batch", "bitcoin_anchor"]


class NetError(Exception):
    pass


class _Bad(Exception):
    pass


# ---- JSON with the reading every port shares: a number is an integer when it is integral and inside +-(2^53-1) ----
def _num(s):
    try:
        v = float(s)
    except (ValueError, OverflowError):
        return float("nan")
    if v != v or v in (float("inf"), float("-inf")):
        return v
    if v == int(v) and abs(v) <= SAFE:
        if re.match(r"^-?\d+$", s):
            i = int(s)
            return i if abs(i) <= SAFE else v
        return int(v)
    return v


def parse_json(b):
    """bytes -> value, or raise _Bad. UTF-8 must be valid; duplicate keys: the last one wins (JSON.parse)."""
    try:
        t = b.decode("utf-8") if isinstance(b, (bytes, bytearray)) else b
        return json.loads(t, parse_float=_num, parse_int=_num, parse_constant=lambda c: (_ for _ in ()).throw(_Bad(c)))
    except (UnicodeDecodeError, ValueError, RecursionError) as e:
        raise _Bad(str(e))


def canonical(o):
    """musubi-canonical-v0: keys sorted, no whitespace, non-ASCII raw. Floats, integers outside +-(2^53-1),
    keys that are not printable ASCII and lone surrogates are refused (_Bad)."""
    def chk(v):
        if isinstance(v, bool) or v is None:
            return
        if isinstance(v, int):
            if not -SAFE <= v <= SAFE:
                raise _Bad("integer out of range")
        elif isinstance(v, float):
            raise _Bad("float")
        elif isinstance(v, str):
            if any(0xD800 <= ord(ch) <= 0xDFFF for ch in v):
                raise _Bad("lone surrogate")
        elif isinstance(v, list):
            for x in v:
                chk(x)
        elif isinstance(v, dict):
            for k, x in v.items():
                if not (isinstance(k, str) and all(0x20 <= ord(ch) <= 0x7E for ch in k)):
                    raise _Bad("key")
                chk(x)
        else:
            raise _Bad("type")
    chk(o)
    return json.dumps(o, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha(b):
    return hashlib.sha256(b if isinstance(b, (bytes, bytearray)) else b.encode("utf-8")).hexdigest()


def _isint(x, lo=0):
    return isinstance(x, int) and not isinstance(x, bool) and lo <= x <= SAFE


def _keys(o, ks):
    return isinstance(o, dict) and sorted(o) == sorted(ks)


def _real_day(s):
    m = DAY.match(s) if isinstance(s, str) else None
    if not m:
        return False
    try:
        datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        return True
    except ValueError:
        return False


def _b64(s, n):
    """strict standard base64 of exactly n bytes, or None"""
    if not isinstance(s, str) or not re.match(r"^[A-Za-z0-9+/]*={0,2}$", s) or len(s) % 4:
        return None
    try:
        b = base64.b64decode(s, validate=True)
    except (ValueError, TypeError):
        return None
    return b if len(b) == n and base64.b64encode(b).decode() == s else None


def ed25519_verify(pub, msg, sig):
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    try:
        Ed25519PublicKey.from_public_bytes(pub).verify(sig, msg)
        return True
    except (InvalidSignature, ValueError):
        return False


# ---- the closed envelope (runner 0.3.0 keepProblems) ----
def envelope_problem(e):
    if not _keys(e, ["check", "schema", "signatures", "signer"]) or e["schema"] != "furui-check-signed-v1":
        return "envelope_keys"
    c = e["check"]
    if not _keys(c, CHECK_KEYS) or c["schema"] != "furui-check-v1":
        return "check_keys"
    for k in ("input_commit", "action_binding_digest", "contract_sha256", "trace_sha256"):
        if not (isinstance(c[k], str) and H64.match(c[k])):
            return "check_" + k
    for k in ("rules_sha256", "scope_sha256"):
        if c[k] is not None and not (isinstance(c[k], str) and H64.match(c[k])):
            return "check_" + k
    if not (c["decision"] is None or (isinstance(c["decision"], str) and c["decision"] in ("stop", "pass"))):
        return "check_decision"
    mk = c["marks"]
    if not isinstance(mk, list) or not all(isinstance(x, str) for x in mk) or mk not in ([], ["off_topic"], ["rule_conflict"], ["off_topic", "rule_conflict"]):
        return "check_marks"
    if not isinstance(c["unread"], bool) or not isinstance(c["answered"], bool):
        return "check_flags"
    if not _isint(c["stage_reached"]) or c["stage_reached"] > 4:
        return "check_stage_reached"
    if not _isint(c["checked_at_height"]):
        return "check_height"
    if not (isinstance(c["nonce"], str) and NONCE.match(c["nonce"])):
        return "check_nonce"
    if not (isinstance(c["signed_at"], str) and ISO_MS.match(c["signed_at"])):
        return "check_signed_at"
    if not _keys(e["signer"], ["domain", "key_url"]) or e["signer"] != SIGNER:
        return "signer"
    if not isinstance(e["signatures"], list) or len(e["signatures"]) != 1:
        return "signatures"
    g = e["signatures"][0]
    if (not _keys(g, ["alg", "domain", "key_id", "sig"]) or g["alg"] != "ed25519" or g["domain"] != SIGNER["domain"]
            or g["key_id"] != "runner-1" or not (isinstance(g["sig"], str) and SIG88.match(g["sig"]))):
        return "signature"
    return None


def envelope_message(e):
    return ("furui-check-signed-v1\n" + canonical({"schema": e["schema"], "check": e["check"], "signer": e["signer"]})).encode("utf-8")


def day_message(r):
    return ("furui-check-day-v0\n" + canonical({k: v for k, v in r.items() if k != "signatures"})).encode("utf-8")


def day_record_problem(r):
    """the intake's closed shape (furui_check_day_intake.mjs shapeProblems) and publication public"""
    if not _keys(r, DAY_KEYS) or r["schema"] != "furui-check-day-v0":
        return "day_record_shape"
    s = r["signer"]
    ok = (_real_day(r["day"]) and _keys(s, ["domain", "key_url"]) and isinstance(s["domain"], str) and s["domain"]
          and isinstance(s["key_url"], str) and _isint(r["n"], 1) and r["tree"] == "rfc6962-sha256" and r["leaf"] == DAY_LEAF
          and isinstance(r["root"], str) and H64.match(r["root"]) and _isint(r["first_height"]) and _isint(r["last_height"])
          and r["first_height"] <= r["last_height"] and _isint(r["late"]) and _isint(r["clock_skew"]) and r["publication"] == "public"
          and isinstance(r["signatures"], list) and len(r["signatures"]) == 1)
    if not ok:
        return "day_record_shape"
    g = r["signatures"][0]
    if not (_keys(g, ["alg", "domain", "key_id", "sig"]) and g["alg"] == "ed25519" and g["domain"] == s["domain"]
            and isinstance(g["key_id"], str) and isinstance(g["sig"], str)):
        return "day_record_shape"
    return None


# ---- RFC 6962 ----
def leaf_hash(env):
    return sha(b"\x00" + canonical(env).encode("utf-8"))


def _node(a, b):
    return sha(b"\x01" + bytes.fromhex(a) + bytes.fromhex(b))


def _split(n):
    k = 1
    while k * 2 < n:
        k *= 2
    return k


def root_from_path(leaf, m, n, path):
    if n == 1:
        return leaf if len(path) == 0 else None
    if len(path) == 0:
        return None
    k, top, rest = _split(n), path[-1], path[:-1]
    if m < k:
        l = root_from_path(leaf, m, k, rest)
        return None if l is None else _node(l, top)
    r = root_from_path(leaf, m - k, n - k, rest)
    return None if r is None else _node(top, r)


def tree_hash(l):
    if len(l) == 1:
        return l[0]
    k = _split(len(l))
    return _node(tree_hash(l[:k]), tree_hash(l[k:]))


def audit_path(m, l):
    if len(l) <= 1:
        return []
    k = _split(len(l))
    return audit_path(m, l[:k]) + [tree_hash(l[k:])] if m < k else audit_path(m - k, l[k:]) + [tree_hash(l[:k])]


# ---- OpenTimestamps: enough of the format to follow sha256, append and prepend to the Bitcoin attestations ----
OTS_MAGIC = b"\x00OpenTimestamps\x00\x00Proof\x00\xbf\x89\xe2\xe8\x84\xe8\x92\x94"
OTS_BITCOIN = bytes.fromhex("0588960d73d71901")
OTS_PENDING = bytes.fromhex("83dfe30d2ef90c8e")


def ots_parse(b):
    """-> (file digest bytes, [(height, merkle root in block explorer order)], pending count) or raise _Bad"""
    pos = [0]

    def rd(n):
        if pos[0] + n > len(b):
            raise _Bad("ots_truncated")
        v = b[pos[0]:pos[0] + n]
        pos[0] += n
        return v

    def varuint():
        """at most 8 bytes, at most 2^53 - 1"""
        v = 0
        for i in range(8):
            c = rd(1)[0]
            v |= (c & 0x7F) << (7 * i)
            if not c & 0x80:
                if v > SAFE:
                    raise _Bad("ots_varuint")
                return v
        raise _Bad("ots_varuint")

    def varbytes(mx):
        n = varuint()
        if n > mx:
            raise _Bad("ots_too_long")
        return rd(n)

    if rd(len(OTS_MAGIC)) != OTS_MAGIC or varuint() != 1 or rd(1) != b"\x08":
        raise _Bad("ots_header")
    digest = rd(32)
    btc, pend, steps = [], [0], [0]

    def item(tag, msg, depth):
        if tag == 0:
            t = rd(8)
            payload = varbytes(8192)
            if t == OTS_BITCOIN:
                v, i, done = 0, 0, False
                while i < len(payload) and i < 8:
                    c = payload[i]
                    v |= (c & 0x7F) << (7 * i)
                    i += 1
                    if not c & 0x80:
                        done = True
                        break
                if not done or i != len(payload) or v > SAFE or len(msg) != 32:
                    raise _Bad("ots_attestation")
                btc.append((v, msg[::-1].hex()))
            elif t == OTS_PENDING:
                pend[0] += 1
            return
        steps[0] += 1
        if steps[0] > 10000 or depth > 256:
            raise _Bad("ots_too_deep")
        if tag == 0x08:
            nxt = hashlib.sha256(msg).digest()
        elif tag == 0xF0:
            nxt = msg + varbytes(4096)
        elif tag == 0xF1:
            nxt = varbytes(4096) + msg
        else:
            raise _Bad("ots_unsupported_op")
        if len(nxt) > 4096:
            raise _Bad("ots_too_long")
        stamp(nxt, depth + 1)

    def stamp(msg, depth):
        tag = rd(1)[0]
        while tag == 0xFF:
            item(rd(1)[0], msg, depth)
            tag = rd(1)[0]
        item(tag, msg, depth)

    stamp(digest, 0)
    if pos[0] != len(b):
        raise _Bad("ots_trailing")
    return digest, btc, pend[0]


# ---- fetching ----
def _enc_component(s):
    return "".join(ch if re.match(r"[A-Za-z0-9\-_.~]", ch) else "".join("%%%02X" % x for x in ch.encode("utf-8")) for ch in s)


def http_get(url, timeout=30):
    """(status, body bytes). GET only, only the two hosts, no redirects."""
    import urllib.error
    import urllib.parse
    import urllib.request
    u = urllib.parse.urlsplit(url)
    if u.scheme != "https" or u.hostname not in ALLOWED_HOSTS or u.port not in (None, 443):
        raise NetError("not an allowed URL: " + url)

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None
    op = urllib.request.build_opener(NoRedirect)
    req = urllib.request.Request(url, headers={"user-agent": "nenrin-verify-furui/1", "accept": "application/json"})
    try:
        with op.open(req, timeout=timeout) as r:
            return r.status, r.read(4 * 1024 * 1024)
    except urllib.error.HTTPError as e:
        return e.code, e.read(1024 * 1024)
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise NetError("%s: %s" % (url, e))


class _Run:
    def __init__(self, get, names):
        self.get, self.names = get, names
        self.steps = []
        self.facts = {}

    def getj(self, url):
        s, b = self.get(url)
        try:
            v = parse_json(b)
        except _Bad:
            v = _Bad
        return s, v

    def put(self, state, code=None):
        self.steps.append({"step": len(self.steps) + 1, "name": self.names[len(self.steps)], "state": state, "code": code})

    def result(self, command, args):
        while len(self.steps) < len(self.names):
            self.put("skipped")
        states = [x["state"] for x in self.steps]
        verdict = "fail" if "fail" in states else ("not_yet" if "not_yet" in states else "ok")
        failed = next((x["step"] for x in self.steps if x["state"] in ("fail", "not_yet")), None)
        out = {"schema": CHECK_SCHEMA, "command": command, "args": args, "verdict": verdict, "first_not_ok": failed,
               "steps": self.steps, "facts": self.facts}
        return out


def _anchor(run, n, record_sha, record_schema, need_block_time):
    """the ledger batch entry n lists record_sha as record_schema, and its OTS proof reaches Bitcoin.
    -> (state, code) for the anchor step; the batch facts land in run.facts. Raises _Stop(state, code) on the batch part."""
    s, e = run.getj(LEDGER + "/ledger/%d?format=json" % n)
    if s != 200 or not isinstance(e, dict):
        return ("batch", "fail", "entry_http_%d" % s if s != 200 else "entry_not_json")
    rc = e.get("record_canonical")
    if not isinstance(rc, str) or e.get("claim_sha256") != sha(rc):
        return ("batch", "fail", "entry_bytes_do_not_hash_to_claim")
    try:
        bt = parse_json(rc)
    except _Bad:
        bt = None
    rows = bt.get("records") if isinstance(bt, dict) and bt.get("schema") == "nenrin-agreement-batch-v1" else None
    if not isinstance(rows, list) or not any(isinstance(r, dict) and r.get("canonical_sha256") == record_sha and r.get("record_schema") == record_schema for r in rows):
        return ("batch", "fail", "record_not_in_entry")
    run.facts["ledger_entry"] = n
    if e.get("ots_status") != "confirmed" or not _isint(e.get("bitcoin_block"), 1) or (need_block_time and not e.get("block_time")):
        return ("anchor", "not_yet", "ots_not_confirmed")
    s, b = run.get(LEDGER + "/ledger/%d/ots" % n)
    if s != 200:
        return ("anchor", "fail", "ots_http_%d" % s)
    try:
        digest, btc, _p = ots_parse(b)
    except _Bad:
        return ("anchor", "fail", "ots_parse")
    if digest.hex() != e["claim_sha256"]:
        return ("anchor", "fail", "ots_digest_is_not_the_entry")
    if not btc:
        return ("anchor", "fail", "ots_no_bitcoin_attestation")
    hit = [m for (h, m) in btc if h == e["bitcoin_block"]]
    if not hit:
        return ("anchor", "fail", "ots_height_is_not_the_entry_block")
    run.facts["bitcoin_block"] = e["bitcoin_block"]
    run.facts["merkle_root"] = hit[0]
    return ("anchor", "ok", None)


def furui_day(day, leaf, get=http_get):
    run = _Run(get, DAY_STEPS)
    run.facts = {"day": day, "leaf": leaf, "record_sha256": None, "n": None, "root": None, "ledger_entry": None, "bitcoin_block": None, "merkle_root": None}
    args = {"day": day, "leaf": leaf}
    # 1 envelope_shape
    s, a = run.getj(FURUI + "/furui/day/%s/leaf/%d" % (day, leaf))
    if s == 404 and isinstance(a, dict) and a.get("error") == "day_open":
        # the runner answers day_open for every day without leaves; its status says whether the day closed empty
        ss, st = run.getj(FURUI + "/furui/day/%s/status" % day)
        v = st.get("status") if ss == 200 and isinstance(st, dict) and st.get("day") == day else None
        if isinstance(v, dict) and v.get("state") == "empty":
            run.put("fail", "day_closed_empty")
        else:
            run.put("not_yet", "day_open")
        return run.result("furui-day", args)
    if s != 200:
        run.put("fail", "leaf_http_%d" % s)
        return run.result("furui-day", args)
    if not isinstance(a, dict):
        run.put("fail", "leaf_not_json")
        return run.result("furui-day", args)
    if a.get("day") != day or not _isint(a.get("index")) or a["index"] != leaf:
        run.put("fail", "leaf_is_another_day_or_index")
        return run.result("furui-day", args)
    env = a.get("envelope")
    p = envelope_problem(env)
    if p:
        run.put("fail", "envelope_shape:" + p)
        return run.result("furui-day", args)
    try:
        envc = canonical(env)
    except _Bad:
        run.put("fail", "envelope_shape:not_canonical")
        return run.result("furui-day", args)
    run.put("ok")
    # 2 leaf_sha256
    lh = sha(b"\x00" + envc.encode("utf-8"))
    if a.get("leaf_sha256") != lh:
        run.put("fail", "leaf_sha256_is_not_the_envelope")
        return run.result("furui-day", args)
    if a.get("envelope_sha256") != sha(envc):
        run.put("fail", "envelope_sha256_is_not_the_envelope")
        return run.result("furui-day", args)
    run.put("ok")
    # 3 audit_path, against the day record the ledger serves
    dr = a.get("day_record")
    if not isinstance(dr, dict) or not isinstance(dr.get("state"), str):
        run.put("fail", "no_day_record")
        return run.result("furui-day", args)
    if dr["state"] != "accepted":
        run.put("not_yet", "day_record_not_accepted")
        return run.result("furui-day", args)
    rs = dr.get("ledger_canonical_sha256")
    if not (isinstance(rs, str) and H64.match(rs)):
        run.put("fail", "no_day_record")
        return run.result("furui-day", args)
    s, lr = run.getj(LEDGER + "/furui-check-day/" + rs)
    if s != 200 or not isinstance(lr, dict):
        run.put("fail", "day_record_http_%d" % s if s != 200 else "day_record_not_json")
        return run.result("furui-day", args)
    rc = lr.get("record_canonical")
    if not isinstance(rc, str) or sha(rc) != rs:
        run.put("fail", "day_record_bytes_do_not_hash_to_sha")
        return run.result("furui-day", args)
    try:
        rec = parse_json(rc)
        if canonical(rec) != rc:
            raise _Bad("not canonical")
    except _Bad:
        run.put("fail", "day_record_not_canonical")
        return run.result("furui-day", args)
    p = day_record_problem(rec)
    if p:
        run.put("fail", p)
        return run.result("furui-day", args)
    if rec["day"] != day:
        run.put("fail", "day_record_is_another_day")
        return run.result("furui-day", args)
    run.facts.update({"record_sha256": rs, "n": rec["n"], "root": rec["root"]})
    if not _isint(a.get("n")) or a["n"] != rec["n"] or a.get("root") != rec["root"]:
        run.put("fail", "n_or_root_differs_from_the_ledger_record")
        return run.result("furui-day", args)
    pr = a.get("proof")
    if a.get("proof_kind") != "rfc6962-audit-path" or not isinstance(pr, list) or not all(isinstance(x, str) and H64.match(x) for x in pr) or len(pr) > 64:
        run.put("fail", "proof_shape")
        return run.result("furui-day", args)
    if not leaf < rec["n"] or root_from_path(lh, leaf, rec["n"], pr) != rec["root"]:
        run.put("fail", "proof_does_not_rebuild_the_root")
        return run.result("furui-day", args)
    run.put("ok")
    # 4 signature, with the key the ledger lists under the record's key_id (5 says whether that key may sign here)
    s, kd = run.getj(KEYS_URL)
    kid = rec["signatures"][0]["key_id"]
    klist = kd.get("keys") if s == 200 and isinstance(kd, dict) and kd.get("use") == "furui-check" and isinstance(kd.get("keys"), list) else None
    k = next((x for x in (klist or []) if isinstance(x, dict) and x.get("key_id") == kid), None)
    pub = _b64(k.get("public_key_ed25519_b64"), 32) if k else None
    if pub is None:
        run.put("skipped", "no_listed_key")
    else:
        rsig = _b64(rec["signatures"][0]["sig"], 64)
        if rsig is None or not ed25519_verify(pub, day_message(rec), rsig):
            run.put("fail", "day_record_signature")
            return run.result("furui-day", args)
        if not ed25519_verify(pub, envelope_message(env), base64.b64decode(env["signatures"][0]["sig"])):
            run.put("fail", "envelope_signature")
            return run.result("furui-day", args)
        run.put("ok")
    # 5 runner_key
    if s != 200 or not isinstance(kd, dict):
        run.put("fail", "keys_http_%d" % s if s != 200 else "keys_not_json")
        return run.result("furui-day", args)
    if klist is None:
        run.put("fail", "keys_not_furui_check")
        return run.result("furui-day", args)
    if rec["signer"] != SIGNER:
        run.put("fail", "signer_is_not_the_ledger_keys")
        return run.result("furui-day", args)
    if kid != "runner-1":
        run.put("fail", "key_id_is_not_runner_1")
        return run.result("furui-day", args)
    if k is None:
        run.put("fail", "key_not_listed")
        return run.result("furui-day", args)
    if pub is None:
        run.put("fail", "key_not_32_bytes")
        return run.result("furui-day", args)
    fh, rh = k.get("from_height"), k.get("revoked_height")
    if not _isint(fh) or not (rh is None or _isint(rh)):
        run.put("fail", "key_heights_shape")
        return run.result("furui-day", args)
    hh = env["check"]["checked_at_height"]
    if rec["first_height"] < fh or hh < fh:
        run.put("fail", "key_not_yet_valid")
        return run.result("furui-day", args)
    if rh is not None and (rec["last_height"] >= rh or hh >= rh):
        run.put("fail", "key_revoked")
        return run.result("furui-day", args)
    run.put("ok")
    # 6 bitcoin_anchor
    if lr.get("status") != "anchored" or not _isint(lr.get("ledger_entry"), 1):
        run.put("not_yet", "not_in_an_anchored_batch_yet")
        return run.result("furui-day", args)
    part, state, code = _anchor(run, lr["ledger_entry"], rs, "furui-check-day-v0", False)
    run.put(state, code)
    return run.result("furui-day", args)


def _host(endpoint):
    import urllib.parse
    try:
        h = urllib.parse.urlsplit(endpoint).hostname
    except ValueError:
        return None
    return h.lower() if h else None


def resume_admission(endpoint, record_sha, get=http_get):
    run = _Run(get, RESUME_STEPS)
    run.facts = {"endpoint": endpoint, "record_sha256": record_sha, "resume_sha256": None, "ledger_entry": None, "bitcoin_block": None, "merkle_root": None}
    args = {"endpoint": endpoint, "record_sha256": record_sha}
    # 1 resume
    s, r = run.getj(LEDGER + "/resume?endpoint=" + _enc_component(endpoint))
    if s != 200 or not isinstance(r, dict):
        run.put("fail", "resume_http_%d" % s if s != 200 else "resume_not_json")
        return run.result("resume-admission", args)
    if r.get("schema") != "nenrin-resume-v1":
        run.put("fail", "resume_schema")
        return run.result("resume-admission", args)
    if r.get("measured_endpoint") != endpoint:
        run.put("fail", "resume_is_another_endpoint")
        return run.result("resume-admission", args)
    try:
        body = canonical({k: v for k, v in r.items() if k not in RESUME_ENVELOPE_KEYS})
    except _Bad:
        body = None
    if body is None or r.get("resume_sha256") != sha(body):
        run.put("fail", "resume_sha256_does_not_recompute")
        return run.result("resume-admission", args)
    run.facts["resume_sha256"] = r["resume_sha256"]
    run.put("ok")
    # 2 admission_line
    adm = r.get("admissions")
    if not isinstance(adm, list):
        run.put("fail", "no_admissions_list")
        return run.result("resume-admission", args)
    lines = [x for x in adm if isinstance(x, dict) and x.get("record_sha256") == record_sha]
    if not lines:
        nc = r.get("not_counted")
        hold = [x for x in (nc if isinstance(nc, list) else []) if isinstance(x, dict) and x.get("record_sha256") == record_sha and x.get("kind") == "admission"]
        if any(x.get("why") in UNANCHORED for x in hold):
            run.put("not_yet", "not_anchored_yet")
        else:
            run.put("fail", "not_listed")
        return run.result("resume-admission", args)
    if len(lines) > 1:
        run.put("fail", "listed_twice")
        return run.result("resume-admission", args)
    ln = lines[0]
    c = ln.get("content")
    closed = (_keys(ln, ["content", "decision", "ledger_n", "record_sha256", "revoked"]) and _isint(ln["ledger_n"], 1)
              and isinstance(ln["decision"], str) and ln["decision"] in ("admit", "escalate", "refuse") and isinstance(ln["revoked"], bool)
              and (c is None or (_keys(c, ["checked", "decision", "marks", "rules_sha256"]) and isinstance(c["checked"], bool)
                                 and (c["decision"] is None or (isinstance(c["decision"], str) and c["decision"] in ("stop", "pass")))
                                 and isinstance(c["marks"], list) and c["marks"] in ([], ["off_topic"], ["rule_conflict"], ["off_topic", "rule_conflict"])
                                 and (c["rules_sha256"] is None or (isinstance(c["rules_sha256"], str) and H64.match(c["rules_sha256"]))))))
    if not closed:
        run.put("fail", "line_not_closed")
        return run.result("resume-admission", args)
    run.put("ok")
    # 3 admission_record
    s, st = run.getj(LEDGER + "/admission/" + record_sha)
    if s != 200 or not isinstance(st, dict):
        run.put("fail", "admission_http_%d" % s if s != 200 else "admission_not_json")
        return run.result("resume-admission", args)
    rc = st.get("record_canonical")
    if not isinstance(rc, str) or sha(rc) != record_sha:
        run.put("fail", "admission_bytes_do_not_hash_to_sha")
        return run.result("resume-admission", args)
    try:
        rec = parse_json(rc)
    except _Bad:
        rec = None
    if not isinstance(rec, dict) or rec.get("schema") != "a2a-admission-v0":
        run.put("fail", "admission_schema")
        return run.result("resume-admission", args)
    rp = rec.get("relying_party")
    rpd = rp.get("domain").lower() if isinstance(rp, dict) and isinstance(rp.get("domain"), str) else None
    h = _host(endpoint)
    if not rpd or not h or not (h == rpd or h.endswith("." + rpd)):
        run.put("fail", "relying_party_is_not_the_endpoint_host")
        return run.result("resume-admission", args)
    if rec.get("decision") != ln["decision"]:
        run.put("fail", "decision_differs")
        return run.result("resume-admission", args)
    rules = rec.get("rules")
    cb = rec.get("content") if isinstance(rules, dict) and rules.get("version") == "0.4" and isinstance(rec.get("content"), dict) else None
    want = None if cb is None else {"checked": cb.get("checked"), "decision": cb.get("decision"), "marks": cb.get("marks"), "rules_sha256": cb.get("rules_sha256")}
    try:
        same = (want is None and c is None) or (want is not None and c is not None and canonical(want) == canonical(c))
    except _Bad:
        same = False
    if not same:
        run.put("fail", "content_differs")
        return run.result("resume-admission", args)
    run.put("ok")
    # 4 ledger_batch, 5 bitcoin_anchor
    part, state, code = _anchor(run, ln["ledger_n"], record_sha, "a2a-admission-v0", True)
    if part == "batch":
        run.put(state, code)
        return run.result("resume-admission", args)
    run.put("ok")
    if state == "not_yet":
        state, code = "fail", "entry_listed_by_the_resume_is_not_anchored"
    run.put(state, code)
    return run.result("resume-admission", args)


# ---- vectors and the CLI ----
def world_get(world):
    def get(url):
        w = world.get(url)
        if w is None:
            return 404, b'{"error":"not_found"}'
        if "body_b64" in w:
            return w["status"], base64.b64decode(w["body_b64"])
        return w["status"], w["body"].encode("utf-8")
    return get


def summary(res):
    return {"verdict": res["verdict"], "steps": [[x["step"], x["state"], x["code"]] for x in res["steps"]], "facts": res["facts"]}


def run_case(c):
    get = world_get(c["world"])
    a = c["args"]
    if c["command"] == "furui-day":
        return furui_day(a["day"], a["leaf"], get)
    return resume_admission(a["endpoint"], a["record_sha256"], get)


class _Utf8Out:
    """console.log writes UTF-8 whatever the locale; so do these commands"""
    def write(self, s):
        if hasattr(sys.stdout, "buffer"):
            sys.stdout.flush()
            sys.stdout.buffer.write(s.encode("utf-8"))
            sys.stdout.buffer.flush()
        else:
            sys.stdout.write(s)


def run_vectors(path, out=None):
    out = out or _Utf8Out()
    with open(path, "rb") as f:
        doc = parse_json(f.read())
    ok = 0
    for c in doc["cases"]:
        if c["command"] == "ots-parse":
            try:
                d, btc, pend = ots_parse(base64.b64decode(c["args"]["body_b64"]))
                got = {"digest": d.hex(), "bitcoin": [[x, m] for (x, m) in btc], "pending": pend}
            except _Bad as e:
                got = {"error": str(e)}
        else:
            got = summary(run_case(c))
        same = "expect" in c and canonical(got) == canonical(c["expect"])
        ok += same
        out.write(canonical({"name": c["name"], "same": same, "got": got}) + "\n")
    out.write("%d/%d furui vectors give the expected verdict (python)\n" % (ok, len(doc["cases"])))
    return 0 if ok == len(doc["cases"]) else 1


USAGE = ("usage: nenrin-verify furui-day <YYYY-MM-DD> --leaf <i>\n"
         "       nenrin-verify resume-admission <https endpoint> <record_sha256>\n"
         "       nenrin-verify furui-vectors <vectors.json>")
EXIT = {"ok": 0, "fail": 1, "not_yet": 3}


def main(argv):
    try:
        if len(argv) == 4 and argv[0] == "furui-day" and argv[2] == "--leaf":
            if not _real_day(argv[1]) or not re.match(r"^(0|[1-9]\d{0,8})$", argv[3]):
                raise ValueError
            res = furui_day(argv[1], int(argv[3]))
        elif len(argv) == 3 and argv[0] == "resume-admission":
            if not re.match(r"^https://[^\s]+$", argv[1]) or not H64.match(argv[2]) or not _host(argv[1]):
                raise ValueError
            res = resume_admission(argv[1], argv[2])
        elif len(argv) == 2 and argv[0] == "furui-vectors":
            return run_vectors(argv[1])
        else:
            raise ValueError
    except ValueError:
        print(USAGE, file=sys.stderr)
        return 2
    except NetError as e:
        print("nenrin-verify: network: %s" % e, file=sys.stderr)
        return 2
    _Utf8Out().write(json.dumps(res, ensure_ascii=False, sort_keys=True, indent=2) + "\n")
    return EXIT[res["verdict"]]
