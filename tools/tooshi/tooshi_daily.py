"""tooshi_daily.py: TOOSHI, the daily end to end check of the content check chain (sieve, admission, ledger, door,
Resume, runner, the daily root, the heartbeat). It reads public endpoints only, holds no secret and writes nothing.

    python3 -I -B tools/tooshi/tooshi_daily.py [--now 2026-11-03T04:05:00Z] [--trigger schedule|second|dispatch|manual] [--out result.json] [--body body.md] [--notes notes.json]
    python3 -I -B tools/tooshi/tooshi_daily.py --witness <your name> [--vantage <your network or tool>] [--dry-run] [--ledger URL]
    python3 -I -B tools/tooshi/tooshi_daily.py --selftest

Each check ends in one of four states:
    ok        checked today, and it holds
    red       checked today, and it does not hold (or the endpoint did not answer after three tries)
    notice    holds, with something to know (a day that hit a spending cap; a day with no checks)
    not_yet   cannot be checked yet; counted and named, never reported as ok
The verdict is red if any check is red; green only if every check is ok or notice; otherwise not_all_checked.
Exit 0 for green or not_all_checked, 1 for red, 2 if this script itself failed.
The result is canonical JSON (sorted keys, no spaces); its sha256 is printed on the last line.

Added with the door's daily check call (2026-11-03):
    6b_daily_leaf  the day before yesterday's first and last leaf, read at GET /furui/day/<D>/leaf/<i>: the envelope has the
                   closed shape, hashes to the leaf, carries runner-1's signature, and its RFC 6962 audit path rebuilds the
                   root of the day record the ledger serves.
    1, 2           from the door's daily check call (03:47 UTC), read at GET /seki .furui.check_call:
                   1 sieve to admission: the call's record carries a checked v0.4 content block; its check_sha256 is the
                     sha256 of the check of a runner envelope. The envelope of a call is served from the next day and the
                     door shows only its last call, so this binding is made on the previous call (.furui.check_call_prev)
                     and stays not_yet while the door does not show one.
                   2 admission to ledger: the ledger serves the call's record under its sha (/admission/<sha>), the
                     door serves the same bytes (/seki/record/<sha>), and the content block is the fixed answer
                     (checked, pass, no marks, the door's rules id).
    3              ledger to MUSUBI settlement (settle): the call of the day before yesterday was carried through MUSUBI
                   (workers/hs-ledger/nenrin/seki-heartbeat/check_loop.py): its execution record names the admission
                   under the check contract at the MUSUBI intake, and the day is settled with settle v1.19 as
                   within_grant, final. Read from check-runs/index.json and the day's settlement.json in this
                   repository (its sha256 must be the one SETTLED.json names), the admission on the ledger and the
                   execution at the intake. not_yet before the loop's first day and while Bitcoin has not confirmed
                   both records; red when the day was not filed, or settled as anything but within_grant, final.
                   A day is filed at 21:17 UTC of its own day (seki-heartbeat), so the day before yesterday is always
                   less than 72 hours past its filing at the run; the stall is read on the earlier filed days of the
                   last 7 days: one of them still not settled final 72 hours after 21:17 UTC of its day is red.
    4              door to Resume: the previous call's record (.furui.check_call_prev, yesterday's) is listed by its
                   record_sha256 in the admissions[] of the relying party's Resume (GET /resume?endpoint=<its endpoint>),
                   as admit, not revoked, with the fixed content answer. An admission is listed only once its batch is
                   anchored, so yesterday's call is read, after the ledger's batch of today: not_yet before 01:05 UTC, and
                   not_yet while the Resume names it in not_counted as not yet anchored. Missing from both: red.
                   not_yet while the door shows no previous call or the Resume carries no admissions[].
    4b             MUSUBI agreement to Resume: the check contract, on file at the MUSUBI intake, is listed in the
                   agreements[] of the same Resume. not_yet while it is not on file, not in a ledger batch, or its batch
                   is not confirmed in Bitcoin; red when its batch is confirmed and the Resume does not list it.
A check that cannot be made because a shape is not fixed yet says why and is never reported ok.

Added with the published days and the witness (2026-11-03):
    trigger        the result names what started it: schedule (the 04:05 cron), second (the 04:35 cron, which runs only when
                   the day has no published result yet), dispatch (by hand in Actions), manual (any other run), witness.
    day_sha256     the sha256 of the day view: the result without checked_at and trigger, with day added (canonical JSON).
                   Two runs of the same day after 03:47 UTC that read the same answers give the same day_sha256, on any
                   machine; result_sha256 differs between them because it covers checked_at.
    --witness      anyone runs the checks on their own machine and files the day_sha256 as an unsigned commitment
                   (jidec-path-v1, mode commitment) at the ledger's witness intake, POST /witness. No key, no account.
                   Refused before 03:47 UTC (the day's answers are not all in yet) and with --now (the answers are read now).
                   --dry-run prints the record and sends nothing.

Added on 2026-11-05:
    5              the door's public policy names the stores whose own policy requires the content check
                   (.furui.stores_requiring). .furui.policy is the door's default (the demonstration store, required
                   false); the check store tooshi-check carries its own. Once the door makes check calls, tooshi-check
                   missing from that list is red. facts.check_store_required is that value (a setting, not a time).
    --notes FILE   what this run saw beside the checks, written to FILE as canonical JSON (tooshi-notes-v0) with
                   observed_at. Today one note: whether the ledger batch holding yesterday's admission is confirmed in
                   Bitcoin. 3 still reads the day before yesterday, since yesterday is settled only by the 21:17 UTC run.
                   A note is not a check and is kept outside the result: it is not in result_canonical, result_sha256 or
                   day_sha256, a witness (--witness, witness-answer-v0) does not recompute it, and a later run that sees
                   the batch confirmed gives the same day_sha256 as a 04:05 run that saw it pending.
                   tooshi_publish.py writes it into the day file under notes.
"""
import base64, datetime, hashlib, json, re, sys, time, urllib.error, urllib.parse, urllib.request

RUNNER = "https://furui.horizonshield.dev"
LEDGER = "https://ledger.horizonshield.dev"
DOOR_POLICY = "https://hs-gateway.oga-surf-project.workers.dev/seki"
CAPS = {"request_usd": 0.4, "day_usd": 5.0, "party_per_day": 100}
FIRST_HEARTBEAT_DAY = "2026-11-03"   # the runner's first heartbeat scene runs at 03:17 UTC that day
FIRST_CLOSED_DAY = "2026-11-02"      # the first UTC day the runner 0.2.0 closes (its status exists from the next day)
HEARTBEAT_AFTER = (3, 17)            # the cron 17 3 * * *
HEARTBEAT_EXPECT = {"decision": "pass", "answered": True, "marks": []}  # the fixed in scope question of the scene
UA = {"user-agent": "tooshi-daily/0.1", "accept": "application/json"}
DOOR_RECORD = DOOR_POLICY + "/record/"   # hs-seki-door has no public route of its own; the gateway's /seki path
CHECK_CALL_AFTER = (3, 47)               # the door's cron 47 3 * * *
CHECK_STORE = "tooshi-check"             # the door's check store; its own policy requires the content check (GET /seki .furui.stores_requiring)
FIRST_KEPT_DAY = "2026-11-03"            # the first day whose envelopes runner 0.3.0 keeps (its leaves answer from 11-04 00:47 UTC)
LEAF_SCAN_MAX = 32                       # at most this many leaves of one day are read to find the check call's envelope
SIGNER = {"domain": "horizonshield.dev", "key_url": LEDGER + "/.well-known/furui-check-keys.json"}
H64 = re.compile(r"^[0-9a-f]{64}$")
AGREEMENT = "https://agreement.horizonshield.dev"   # the MUSUBI intake (contracts and execution records)
CHECK_RUNS = "https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/workers/hs-ledger/nenrin/seki-heartbeat/check-runs/"
SETTLE_FILED = (21, 17)                  # seki-heartbeat (cron 17 21 * * *) files the check call of a day at 21:17 UTC of that day
SETTLE_STALL = datetime.timedelta(hours=72)   # a filed day not settled final 72 hours after its filing is red
SETTLE_LOOKBACK = 7                      # the stall is read on the filed days of the last 7 days (before the day before yesterday)
RESUME_ENDPOINT = "https://shield.the-horizons-innovation.com/"   # the door's relying party (shield.the-horizons-innovation.com)
BATCH_DONE = (1, 5)                      # the ledger's daily batch window ends at 01:05 UTC
UNANCHORED = ("not_yet_anchored", "confirmed_without_block_time")
TRIGGERS = ("schedule", "second", "dispatch", "manual", "witness")
DAY_READY = (3, 47)                      # after this UTC time every check of the day can be made (01:05, 03:17, 03:47)
DAY_URL = "https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/tooshi/days/%s.json"   # the published day (tooshi_publish.py)


class Unreachable(Exception):
    pass


def http_get(url, tries=3, wait=10, timeout=30, raw=False):
    """(status, parsed JSON), or (status, the body as text) with raw. A network failure or a 5xx is tried three times; then Unreachable."""
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                t = r.read().decode("utf-8")
                return r.status, (t if raw else json.loads(t))
        except urllib.error.HTTPError as e:
            if e.code < 500:
                try:
                    t = e.read().decode("utf-8")
                    return e.code, (t if raw else json.loads(t))
                except ValueError:
                    return e.code, None
            last = "http %d" % e.code
        except (urllib.error.URLError, OSError, ValueError) as e:
            last = type(e).__name__
        if i + 1 < tries:
            time.sleep(wait)
    raise Unreachable("%s: %s after %d tries" % (url, last, tries))


def c(cid, state, why, **facts):
    return {"id": cid, "state": state, "why": why, "facts": facts}


def check_door_runner(get):
    cid = "5_door_runner"
    try:
        hs, h = get(RUNNER + "/health")
        ks, k = get(LEDGER + "/.well-known/furui-check-keys.json")
        ps, p = get(DOOR_POLICY)
    except Unreachable as e:
        return c(cid, "red", "an endpoint did not answer: " + str(e))
    if hs != 200 or ks != 200 or ps != 200 or not all(isinstance(x, dict) for x in (h, k, p)):
        return c(cid, "red", "health %s, keys %s, door policy %s" % (hs, ks, ps))
    listed = [x.get("public_key_ed25519_b64") for x in k.get("keys", []) if isinstance(x, dict) and x.get("key_id") == "runner-1" and x.get("revoked_height") is None]
    fu = p.get("furui") or {}
    pol = fu.get("policy") or {}
    door_rules = pol.get("rules_sha256")
    # .furui.policy is the door's default (the demonstration store, required false); the check store carries its own policy,
    # named only in .furui.stores_requiring. Once the door makes check calls, the check store must require the check.
    requiring = fu.get("stores_requiring") if isinstance(fu.get("stores_requiring"), list) else []
    bad = []
    if h.get("key_id") != "runner-1" or listed != [h.get("public_key_ed25519_b64")] or not h.get("public_key_ed25519_b64"):
        bad.append("the runner's public half is not the one the ledger lists for runner-1")
    if h.get("caps") != CAPS:
        bad.append("caps are %s, not %s" % (json.dumps(h.get("caps"), sort_keys=True), json.dumps(CAPS, sort_keys=True)))
    if h.get("anthropic_key_set") is not True:
        bad.append("the model key is not set")
    if (h.get("rules_sha256") or None) != (door_rules or None):
        bad.append("rules_sha256 differs: runner %s, door %s" % (h.get("rules_sha256"), door_rules))
    if pol.get("required") is True and not (isinstance(door_rules, str) and H64.match(door_rules)):
        bad.append("the door requires the check but names no rules id")
    if pol.get("runner_public_key_ed25519_b64") is not None and pol.get("runner_public_key_ed25519_b64") != h.get("public_key_ed25519_b64"):
        bad.append("the door checks envelopes with a public half other than the runner's")
    if "check_call" in fu and CHECK_STORE not in requiring:
        bad.append("the door makes check calls but its check store %s does not require the content check (stores_requiring %s)" % (CHECK_STORE, json.dumps(fu.get("stores_requiring"))))
    facts = {"runner": h.get("runner"), "rules_sha256": h.get("rules_sha256"), "door_required": pol.get("required"),
             "check_store_required": CHECK_STORE in requiring}
    return c(cid, "red" if bad else "ok", "; ".join(bad) or "the runner's key, caps, model key and rules id agree with the ledger and the door", **facts)


def check_heartbeat(get, now):
    cid = "7_heartbeat_scene"
    today = now.strftime("%Y-%m-%d")
    try:
        s, hb = get(RUNNER + "/furui/heartbeat")
    except Unreachable as e:
        return c(cid, "red", "the heartbeat endpoint did not answer: " + str(e))
    if s != 200 or not isinstance(hb, dict):
        return c(cid, "red", "the heartbeat endpoint answered %s" % s)
    after = now.replace(hour=HEARTBEAT_AFTER[0], minute=HEARTBEAT_AFTER[1], second=0, microsecond=0)
    if hb.get("at") is None:
        if today < FIRST_HEARTBEAT_DAY or (today == FIRST_HEARTBEAT_DAY and now < after):
            return c(cid, "not_yet", "no heartbeat scene has run yet (the first is %s 03:17 UTC)" % FIRST_HEARTBEAT_DAY)
        return c(cid, "red", "no heartbeat scene has ever been recorded")
    try:
        at = datetime.datetime.strptime(hb["at"][:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=datetime.timezone.utc)
    except (TypeError, ValueError):
        return c(cid, "red", "the heartbeat time is not a time")
    if now < after:
        return c(cid, "not_yet", "today's scene runs at 03:17 UTC; this check ran before it")
    if at < after:
        return c(cid, "red", "the last scene is from %s, before today's 03:17 UTC" % hb["at"])
    spent = hb.get("spent_usd") or 0
    facts = {"at": hb["at"], "spent_usd": spent, "capped": hb.get("capped")}
    if not isinstance(spent, (int, float)) or spent > CAPS["day_usd"]:
        return c(cid, "red", "the scene spent %s, over the day cap" % spent, **facts)
    if hb.get("capped") is True:
        return c(cid, "notice", "the scene hit a spending cap today (not red; the day's caps did their work)", **facts)
    got = {"decision": hb.get("decision"), "answered": hb.get("answered"), "marks": hb.get("marks")}
    if hb.get("ok") is not True or got != HEARTBEAT_EXPECT:
        return c(cid, "red", "the scene answered %s, not %s" % (json.dumps(got, sort_keys=True), json.dumps(HEARTBEAT_EXPECT, sort_keys=True)), **facts)
    return c(cid, "ok", "today's scene ran after 03:17 UTC and gave the expected answer", **facts)


def check_day_root(get, now):
    cid = "6_daily_root"
    d = (now - datetime.timedelta(days=2)).strftime("%Y-%m-%d")
    d2 = (now - datetime.timedelta(days=0)).strftime("%Y-%m-%d")
    if d < FIRST_CLOSED_DAY:
        return c(cid, "not_yet", "the day before yesterday (%s) is before the runner's first closed day %s" % (d, FIRST_CLOSED_DAY), day=d)
    try:
        s, st = get(RUNNER + "/furui/day/%s/status" % d)
    except Unreachable as e:
        return c(cid, "red", "the day status did not answer: " + str(e), day=d)
    if s != 200 or not isinstance(st, dict):
        return c(cid, "red", "the day status answered %s" % s, day=d)
    v = st.get("status")
    if not isinstance(v, dict):
        return c(cid, "red", "the runner holds no closed status for %s" % d, day=d)
    if v.get("state") == "empty":
        return c(cid, "notice", "%s had no checks; nothing was sent (not red)" % d, day=d)
    if v.get("state") != "accepted" or v.get("accepted") is not True:
        return c(cid, "red", "%s is %s (http %s, attempts %s, refusals %s)" % (d, v.get("state"), v.get("http"), v.get("attempts"), v.get("refusals")), day=d)
    sha = v.get("ledger_canonical_sha256") or v.get("record_sha256")
    try:
        ls, rec = get(LEDGER + "/furui-check-day/" + str(sha))
    except Unreachable as e:
        return c(cid, "red", "the ledger did not answer for the record: " + str(e), day=d, record=sha)
    if ls != 200 or not isinstance(rec, dict) or rec.get("canonical_sha256") != sha:
        return c(cid, "red", "the ledger does not serve the record %s (answered %s)" % (sha, ls), day=d, record=sha)
    n = rec.get("ledger_entry")
    if rec.get("status") != "anchored" or not isinstance(n, int):
        return c(cid, "red", "the record is %s, not in a batch" % rec.get("status"), day=d, record=sha)
    try:
        es, e = get(LEDGER + "/ledger/%d?format=json" % n)
    except Unreachable as ex:
        return c(cid, "red", "the batch entry did not answer: " + str(ex), day=d, record=sha, entry=n)
    if es != 200 or not isinstance(e, dict) or sha not in str(e.get("record_canonical") or ""):
        return c(cid, "red", "batch entry %s does not list the record" % n, day=d, record=sha, entry=n)
    if str(e.get("created_at") or "")[:10] != d2:
        return c(cid, "red", "batch entry %s is from %s, not %s (the day after the close)" % (n, str(e.get("created_at"))[:10], d2), day=d, record=sha, entry=n)
    return c(cid, "ok", "%s was accepted, is served by the ledger and is in batch entry %d of %s" % (d, n, d2), day=d, record=sha, entry=n)

# ---- the closed envelope, its leaf and audit path (runner 0.3.0 keepProblems, leafHash, rootFromPath), Ed25519 (RFC 8032) ----
SAFE = 9007199254740991


def canonical(o):
    """musubi-canonical-v0 for the closed values these checks read (no float; printable ASCII keys)."""
    def chk(v):
        if isinstance(v, float):
            raise ValueError("float")
        if isinstance(v, int) and not isinstance(v, bool) and not -SAFE <= v <= SAFE:
            raise ValueError("integer out of range")
        if isinstance(v, str) and any(0xD800 <= ord(x) <= 0xDFFF for x in v):
            raise ValueError("lone surrogate")
        if isinstance(v, list):
            for x in v:
                chk(x)
        if isinstance(v, dict):
            for k, x in v.items():
                if not all(0x20 <= ord(ch) <= 0x7E for ch in k):
                    raise ValueError("key")
                chk(x)
    chk(o)
    return json.dumps(o, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha(b):
    return hashlib.sha256(b if isinstance(b, bytes) else b.encode("utf-8")).hexdigest()


CHECK_KEYS = sorted(["action_binding_digest", "answered", "checked_at_height", "contract_sha256", "decision", "input_commit", "marks", "nonce", "rules_sha256",
                     "schema", "scope_sha256", "signed_at", "stage_reached", "trace_sha256", "unread"])


def _keys(o, ks):
    return isinstance(o, dict) and sorted(o) == sorted(ks)


def _int(x, lo=0):
    return isinstance(x, int) and not isinstance(x, bool) and x >= lo


def keep_problems(e):
    if not _keys(e, ["check", "schema", "signatures", "signer"]) or e["schema"] != "furui-check-signed-v1":
        return "envelope_keys"
    k = e["check"]
    if not _keys(k, CHECK_KEYS) or k["schema"] != "furui-check-v1":
        return "check_keys"
    for f in ("input_commit", "action_binding_digest", "contract_sha256", "trace_sha256"):
        if not (isinstance(k[f], str) and H64.match(k[f])):
            return "check_" + f
    for f in ("rules_sha256", "scope_sha256"):
        if k[f] is not None and not (isinstance(k[f], str) and H64.match(k[f])):
            return "check_" + f
    if k["decision"] not in (None, "stop", "pass"):
        return "check_decision"
    if not isinstance(k["marks"], list) or not all(isinstance(x, str) for x in k["marks"]) or ",".join(k["marks"]) not in ("", "off_topic", "rule_conflict", "off_topic,rule_conflict"):
        return "check_marks"
    if not isinstance(k["unread"], bool) or not isinstance(k["answered"], bool):
        return "check_flags"
    if not _int(k["stage_reached"]) or k["stage_reached"] > 4 or not _int(k["checked_at_height"]) or k["checked_at_height"] > SAFE:
        return "check_numbers"
    if not (isinstance(k["nonce"], str) and re.match(r"^(?:[0-9a-f]{32}|heartbeat-\d{4}-\d{2}-\d{2})$", k["nonce"])):
        return "check_nonce"
    if not (isinstance(k["signed_at"], str) and re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$", k["signed_at"])):
        return "check_signed_at"
    if e["signer"] != SIGNER:
        return "signer"
    g = e["signatures"][0] if isinstance(e["signatures"], list) and len(e["signatures"]) == 1 else None
    if not _keys(g, ["alg", "domain", "key_id", "sig"]) or g["alg"] != "ed25519" or g["domain"] != SIGNER["domain"] or g["key_id"] != "runner-1" or not (isinstance(g["sig"], str) and re.match(r"^[A-Za-z0-9+/]{86}==$", g["sig"])):
        return "signature"
    return None


def leaf_hash(e):
    return sha(b"\x00" + canonical(e).encode("utf-8"))


def _node(a, b):
    return sha(b"\x01" + bytes.fromhex(a) + bytes.fromhex(b))


def _split(n):
    k = 1
    while k * 2 < n:
        k *= 2
    return k


def root_from_path(leaf, m, n, path):
    if n == 1:
        return leaf if not path else None
    if not path:
        return None
    k, top, rest = _split(n), path[-1], path[:-1]
    if m < k:
        l = root_from_path(leaf, m, k, rest)
        return None if l is None else _node(l, top)
    r = root_from_path(leaf, m - k, n - k, rest)
    return None if r is None else _node(top, r)


_P = 2 ** 255 - 19
_Q = 2 ** 252 + 27742317777372353535851937790883648493
_D = -121665 * pow(121666, _P - 2, _P) % _P
_I = pow(2, (_P - 1) // 4, _P)


def _add(a, b):
    A, B = (a[1] - a[0]) * (b[1] - b[0]) % _P, (a[1] + a[0]) * (b[1] + b[0]) % _P
    C, D = 2 * a[3] * b[3] * _D % _P, 2 * a[2] * b[2] % _P
    E, F, G, H = B - A, D - C, D + C, B + A
    return (E * F, G * H, F * G, E * H)


def _mul(s, pt):
    q = (0, 1, 1, 0)
    while s > 0:
        if s & 1:
            q = _add(q, pt)
        pt = _add(pt, pt)
        s >>= 1
    return q


def _xrec(y, sign):
    if y >= _P:
        return None
    x2 = (y * y - 1) * pow(_D * y * y + 1, _P - 2, _P)
    if x2 % _P == 0:
        return None if sign else 0
    x = pow(x2, (_P + 3) // 8, _P)
    if (x * x - x2) % _P:
        x = x * _I % _P
    if (x * x - x2) % _P:
        return None
    return _P - x if (x & 1) != sign else x


_GY = 4 * pow(5, _P - 2, _P) % _P
_GX = _xrec(_GY, 0)
_G = (_GX, _GY, 1, _GX * _GY % _P)


def _enc(pt):
    zi = pow(pt[2], _P - 2, _P)
    x, y = pt[0] * zi % _P, pt[1] * zi % _P
    return int.to_bytes(y | ((x & 1) << 255), 32, "little")


def _dec(b):
    y = int.from_bytes(b, "little")
    sign, y = y >> 255, y & ((1 << 255) - 1)
    x = _xrec(y, sign)
    return None if x is None else (x, y, 1, x * y % _P)


def _hq(m):
    return int.from_bytes(hashlib.sha512(m).digest(), "little") % _Q


def _scalar(secret):
    h = hashlib.sha512(secret).digest()
    return (int.from_bytes(h[:32], "little") & ((1 << 254) - 8)) | (1 << 254), h[32:]


def ed25519_sign(secret, msg):
    """used by the self test only"""
    a, prefix = _scalar(secret)
    A = _enc(_mul(a, _G))
    r = _hq(prefix + msg)
    R = _enc(_mul(r, _G))
    return R + int.to_bytes((r + _hq(R + A + msg) * a) % _Q, 32, "little")


def ed25519_public(secret):
    return _enc(_mul(_scalar(secret)[0], _G))


def ed25519_verify(pub_b64, msg, sig_b64):
    try:
        pub, sg = base64.b64decode(pub_b64, validate=True), base64.b64decode(sig_b64, validate=True)
    except (ValueError, TypeError):
        return False
    if len(pub) != 32 or len(sg) != 64:
        return False
    A, R = _dec(pub), _dec(sg[:32])
    s = int.from_bytes(sg[32:], "little")
    if A is None or R is None or s >= _Q:
        return False
    sB, rhs = _mul(s, _G), _add(R, _mul(_hq(sg[:32] + pub + msg), A))
    return (sB[0] * rhs[2] - rhs[0] * sB[2]) % _P == 0 and (sB[1] * rhs[2] - rhs[1] * sB[2]) % _P == 0


def envelope_message(e):
    return ("furui-check-signed-v1\n" + canonical({"schema": e["schema"], "check": e["check"], "signer": e["signer"]})).encode("utf-8")


def ledger_day(get, d):
    """the runner's closed status of day d and the day record the ledger serves for it: (problem or None, facts)"""
    s, st = get(RUNNER + "/furui/day/%s/status" % d)
    v = st.get("status") if s == 200 and isinstance(st, dict) else None
    if not isinstance(v, dict):
        return "the runner holds no closed status for %s (http %s)" % (d, s), None
    if v.get("state") == "empty":
        return "empty", None
    rs = v.get("ledger_canonical_sha256")
    if v.get("state") != "accepted" or not (isinstance(rs, str) and H64.match(rs)):
        return "%s is %s, so there is no accepted root to read leaves against" % (d, v.get("state")), None
    ls, r = get(LEDGER + "/furui-check-day/" + rs)
    rc = r.get("record_canonical") if ls == 200 and isinstance(r, dict) else None
    if not isinstance(rc, str) or sha(rc) != rs:
        return "the ledger does not serve the day record %s as bytes that hash to it (http %s)" % (rs, ls), None
    rec = json.loads(rc)
    if rec.get("day") != d or not _int(rec.get("n"), 1) or rec.get("root") != v.get("root") or rec.get("n") != v.get("n"):
        return "the ledger's day record of %s does not name the runner's n and root" % d, None
    return None, {"sha": rs, "n": rec["n"], "root": rec["root"]}


def leaf_problems(get, d, i, day, pub):
    """read leaf i of day d and hold it to the ledger's day record: the closed envelope, the leaf hash, the envelope sha,
    runner-1's signature and the audit path to the root. (problem words, the envelope)"""
    s, a = get(RUNNER + "/furui/day/%s/leaf/%d" % (d, i))
    if s != 200 or not isinstance(a, dict):
        return ["leaf_http_%s_%s" % (s, (a or {}).get("error") if isinstance(a, dict) else None)], None
    bad = []
    if a.get("day") != d or a.get("index") != i or a.get("n") != day["n"] or a.get("root") != day["root"]:
        bad.append("day_index_n_or_root_differs_from_the_ledger_record")
    e = a.get("envelope")
    p = keep_problems(e)
    if p:
        return bad + ["envelope_shape:" + p], None
    lh = leaf_hash(e)
    if a.get("leaf_sha256") != lh:
        bad.append("leaf_is_not_the_envelope")
    if a.get("envelope_sha256") != sha(canonical(e)):
        bad.append("envelope_sha256_is_not_the_envelope")
    pr = a.get("proof")
    if a.get("proof_kind") != "rfc6962-audit-path" or not isinstance(pr, list) or not all(isinstance(x, str) and H64.match(x) for x in pr) or root_from_path(lh, i, day["n"], pr) != day["root"]:
        bad.append("audit_path_does_not_rebuild_the_root")
    dr = a.get("day_record")
    if not isinstance(dr, dict) or dr.get("ledger_canonical_sha256") != day["sha"]:
        bad.append("day_record_is_not_the_ledger_record")
    if not ed25519_verify(pub, envelope_message(e), e["signatures"][0]["sig"]):
        bad.append("signature_does_not_verify_with_runner_1")
    return bad, e


def runner_key(get):
    s, k = get(LEDGER + "/.well-known/furui-check-keys.json")
    listed = [x.get("public_key_ed25519_b64") for x in (k.get("keys", []) if s == 200 and isinstance(k, dict) else []) if isinstance(x, dict) and x.get("key_id") == "runner-1" and x.get("revoked_height") is None]
    return listed[0] if len(listed) == 1 else None


def check_leaves(get, now):
    cid = "6b_daily_leaf"
    d = (now - datetime.timedelta(days=2)).strftime("%Y-%m-%d")
    if d < FIRST_KEPT_DAY:
        return c(cid, "not_yet", "the day before yesterday (%s) is before the first day whose envelopes the runner keeps (%s)" % (d, FIRST_KEPT_DAY), day=d)
    try:
        why, day = ledger_day(get, d)
        if why == "empty":
            return c(cid, "notice", "%s had no checks, so there is no leaf to read (not red)" % d, day=d)
        if why:
            return c(cid, "red", why, day=d)
        pub = runner_key(get)
        if not pub:
            return c(cid, "red", "the ledger lists no single live runner-1 key", day=d)
        idx = sorted({0, day["n"] - 1})
        bad = []
        for i in idx:
            b, _e = leaf_problems(get, d, i, day, pub)
            bad += ["leaf %d: %s" % (i, w) for w in b]
    except Unreachable as e:
        return c(cid, "red", "an endpoint did not answer: " + str(e), day=d)
    except (ValueError, KeyError, TypeError) as e:
        return c(cid, "red", "an answer did not have its shape: %s" % type(e).__name__, day=d)
    if bad:
        return c(cid, "red", "; ".join(bad), day=d, leaves=idx)
    return c(cid, "ok", "%s: leaves %s match their envelopes, carry runner-1's signature, and their audit paths rebuild the root of the day record the ledger serves" % (d, ",".join(str(i) for i in idx)), day=d, leaves=idx, record=day["sha"])


CHECK_REASONS = ["within_grant"]
CONTENT_KEYS = sorted(["answered", "check_sha256", "checked", "decision", "input_commit", "marks", "rules", "rules_sha256", "scope_sha256", "unread"])


def door_record(get, sha_):
    """the door's record bytes and the ledger's, for one record sha: (problem or None, the parsed record, the ledger answer)"""
    if not (isinstance(sha_, str) and H64.match(sha_)):
        return "the call names no record sha", None, None
    ls, la = get(LEDGER + "/admission/" + sha_)
    lrc = la.get("record_canonical") if ls == 200 and isinstance(la, dict) else None
    if not isinstance(lrc, str) or sha(lrc) != sha_ or la.get("canonical_sha256") != sha_:
        return "ledger: /admission/%s does not serve bytes that hash to it (http %s)" % (sha_, ls), None, la
    ds, dt = get(DOOR_RECORD + sha_, raw=True)
    if ds != 200 or not isinstance(dt, str) or sha(dt) != sha_:
        return "door: /seki/record/%s does not serve bytes that hash to it (http %s)" % (sha_, ds), None, la
    if dt.encode("utf-8") != lrc.encode("utf-8"):
        return "door and ledger serve different bytes for %s" % sha_, None, la
    return None, json.loads(dt), la


def content_problems(rec, rules):
    k = rec.get("content") if isinstance(rec, dict) else None
    if not _keys(k, CONTENT_KEYS) or k.get("rules") != "a2a-content-check-v1":
        return ["the record has no closed v0.4 content block"]
    bad = []
    if (rec.get("rules") or {}).get("version") != "0.4":
        bad.append("the record is not admission 0.4")
    if not all(isinstance(k[f], str) and H64.match(k[f]) for f in ("input_commit", "check_sha256", "scope_sha256")):
        bad.append("input_commit, check_sha256 or scope_sha256 is not a 64 hex digest")
    if k.get("checked") is not True or k.get("decision") != "pass" or k.get("marks") != [] or k.get("unread") is not False or k.get("answered") is not True:
        bad.append("the content block is not the fixed answer (checked, pass, no marks, answered, nothing unread)")
    if not (isinstance(rules, str) and H64.match(rules)) or k.get("rules_sha256") != rules:
        bad.append("the content block's rules id %s is not the door's %s" % (k.get("rules_sha256"), rules))
    if rec.get("reasons") != CHECK_REASONS:
        bad.append("the record's reasons are %s, not %s" % (json.dumps(rec.get("reasons")), json.dumps(CHECK_REASONS)))
    return bad


def check_call_checks(get, now):
    """checks 1 and 2 from the door's daily check call"""
    ids = ("1_sieve_admission", "2_admission_ledger")
    def all2(state, why, **f):
        return [c(i, state, why, **f) for i in ids]
    today = now.strftime("%Y-%m-%d")
    try:
        ps, p = get(DOOR_POLICY)
    except Unreachable as e:
        return all2("red", "the door policy did not answer: " + str(e))
    fu = p.get("furui") if ps == 200 and isinstance(p, dict) else None
    if not isinstance(fu, dict):
        return all2("red", "the door policy answered %s without a furui block" % ps)
    if "check_call" not in fu:
        return all2("not_yet", "the door shows no check call (furui.check_call): its daily check call is not in production")
    after = now.replace(hour=CHECK_CALL_AFTER[0], minute=CHECK_CALL_AFTER[1], second=0, microsecond=0)
    if now < after:
        return all2("not_yet", "today's check call runs at 03:47 UTC; this check ran before it")
    cc = fu.get("check_call")
    if cc is None:
        return all2("not_yet", "the door has recorded no check call yet")
    if not isinstance(cc, dict):
        return all2("red", "furui.check_call is not an object")
    facts = {"day": cc.get("day"), "record": cc.get("record_sha256"), "decision": cc.get("decision")}
    if cc.get("day") != today or str(cc.get("at") or "")[:19] < after.strftime("%Y-%m-%dT%H:%M:%S"):
        return all2("red", "the last check call is from %s, not after today's 03:47 UTC" % cc.get("at"), **facts)
    if cc.get("ok") is not True or cc.get("error"):
        return all2("red", "today's check call failed: %s" % (cc.get("error") or "ok is not true"), **facts)
    rules = ((fu.get("policy") or {}).get("rules_sha256"))
    out = {}
    pub = cc.get("published")
    unpublished = None if isinstance(pub, dict) and pub.get("accepted") is True else "the door did not hand the call's record to the ledger (published %s)" % json.dumps(pub)
    try:
        why, rec, _la = door_record(get, cc.get("record_sha256"))
    except Unreachable as e:
        return all2("red", "an endpoint did not answer: " + str(e), **facts)
    except (ValueError, KeyError, TypeError) as e:
        return all2("red", "an answer did not have its shape: %s" % type(e).__name__, **facts)
    if why:
        out["2_admission_ledger"] = c(ids[1], "red", "; ".join(x for x in (unpublished, why) if x), **facts)
        out["1_sieve_admission"] = c(ids[0], "red", "the call's record could not be read from both ends: " + why, **facts)
        return [out[i] for i in ids]
    bad = ([unpublished] if unpublished else []) + content_problems(rec, rules)
    k = rec["content"] if isinstance(rec.get("content"), dict) else {}
    cc_content = cc.get("content")
    if cc_content != {"checked": k.get("checked"), "decision": k.get("decision"), "marks": k.get("marks"), "rules_sha256": k.get("rules_sha256")}:
        bad.append("the door's summary of the call differs from its record")
    if cc.get("decision") != "admit" or cc.get("reasons") != CHECK_REASONS or cc.get("version") != "0.4" or not (isinstance(cc.get("admission_sha256"), str) and H64.match(cc["admission_sha256"])):
        bad.append("the call is not admit / within_grant / 0.4 with an admission sha")
    if bad:
        out["2_admission_ledger"] = c(ids[1], "red", "; ".join(bad), **facts)
        out["1_sieve_admission"] = c(ids[0], "red", "today's content block does not hold: " + "; ".join(bad), **facts)
        return [out[i] for i in ids]
    out["2_admission_ledger"] = c(ids[1], "ok", "the ledger serves the call's record %s under its sha, the door serves the same bytes, a v0.4 record with the fixed content answer under the door's rules id" % cc["record_sha256"], **facts)
    out["1_sieve_admission"] = check_binding(get, now, fu, rules, facts)
    return [out[i] for i in ids]


def check_binding(get, now, fu, rules, facts):
    """1: the previous call's content block names the check of a runner envelope kept in that day's leaves"""
    cid = "1_sieve_admission"
    prev = fu.get("check_call_prev")
    if prev is None:
        return c(cid, "not_yet", "today's content block holds, but the envelope behind it is served by the runner only from tomorrow and the door shows only its last call; "
                 "the binding to the runner's envelope waits for furui.check_call_prev (not in the door yet)", **facts)
    y = (now - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    if not isinstance(prev, dict) or prev.get("day") != y or prev.get("ok") is not True:
        return c(cid, "red", "furui.check_call_prev is not yesterday's good call (%s)" % (prev.get("day") if isinstance(prev, dict) else prev), **facts)
    try:
        why, rec, _la = door_record(get, prev.get("record_sha256"))
        if why:
            return c(cid, "red", "yesterday's call: " + why, **facts)
        bad = content_problems(rec, rules)
        if bad:
            return c(cid, "red", "yesterday's content block: " + "; ".join(bad), **facts)
        k = rec["content"]
        why, day = ledger_day(get, y)
        if why:
            return c(cid, "red", "yesterday's runner day: " + ("no checks at all" if why == "empty" else why), **facts)
        pub = runner_key(get)
        if not pub:
            return c(cid, "red", "the ledger lists no single live runner-1 key", **facts)
        for i in range(min(day["n"], LEAF_SCAN_MAX)):
            bad, e = leaf_problems(get, y, i, day, pub)
            if e is not None and sha(canonical(e["check"])) == k["check_sha256"]:
                if bad:
                    return c(cid, "red", "the call's envelope (leaf %d of %s) does not hold: %s" % (i, y, "; ".join(bad)), **facts)
                ch = e["check"]
                if ch["input_commit"] != k["input_commit"] or ch["rules_sha256"] != k["rules_sha256"] or ch["scope_sha256"] != k["scope_sha256"] or ch["decision"] != k["decision"] or ch["marks"] != k["marks"]:
                    return c(cid, "red", "the call's envelope (leaf %d) and the record's content block differ" % i, **facts)
                return c(cid, "ok", "yesterday's call: its content block's check_sha256 is the check of leaf %d of %s, signed by runner-1, in the day root the ledger serves, with the same input_commit, rules, scope and answer" % (i, y), leaf=i, **facts)
    except Unreachable as e:
        return c(cid, "red", "an endpoint did not answer: " + str(e), **facts)
    except (ValueError, KeyError, TypeError) as e:
        return c(cid, "red", "an answer did not have its shape: %s" % type(e).__name__, **facts)
    return c(cid, "red", "no leaf among the first %d of %s carries the check named by yesterday's record" % (min(day["n"], LEAF_SCAN_MAX), y), **facts)


def check_resume(get, now):
    """4: yesterday's check call record is in the admissions[] of the relying party's Resume"""
    cid = "4_door_resume"
    y = (now - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    try:
        ps, p = get(DOOR_POLICY)
    except Unreachable as e:
        return c(cid, "red", "the door policy did not answer: " + str(e))
    fu = p.get("furui") if ps == 200 and isinstance(p, dict) else None
    if not isinstance(fu, dict):
        return c(cid, "red", "the door policy answered %s without a furui block" % ps)
    if "check_call_prev" not in fu:
        return c(cid, "not_yet", "the door does not show its previous check call (furui.check_call_prev) yet")
    prev = fu.get("check_call_prev")
    if prev is None:
        return c(cid, "not_yet", "the door has no previous check call yet (the first call has no earlier one)")
    if not isinstance(prev, dict):
        return c(cid, "red", "furui.check_call_prev is not an object")
    rs = prev.get("record_sha256")
    facts = {"day": prev.get("day"), "record": rs}
    if prev.get("day") != y or prev.get("ok") is not True or not (isinstance(rs, str) and H64.match(rs)):
        return c(cid, "red", "furui.check_call_prev is not yesterday's good call with a record sha (day %s, ok %s)" % (prev.get("day"), prev.get("ok")), **facts)
    if now < now.replace(hour=BATCH_DONE[0], minute=BATCH_DONE[1], second=0, microsecond=0):
        return c(cid, "not_yet", "yesterday's record is batched by the ledger between 00:20 and 01:05 UTC; this check ran before 01:05", **facts)
    try:
        s, r = get(LEDGER + "/resume?endpoint=" + urllib.parse.quote(RESUME_ENDPOINT, safe=""))
    except Unreachable as e:
        return c(cid, "red", "the Resume did not answer: " + str(e), **facts)
    if s != 200 or not isinstance(r, dict):
        return c(cid, "red", "the Resume of %s answered http %s" % (RESUME_ENDPOINT, s), **facts)
    adm = r.get("admissions")
    if "admissions" not in r:
        return c(cid, "not_yet", "the Resume carries no admissions[] yet, so the door's record cannot be looked up there", **facts)
    if not isinstance(adm, list):
        return c(cid, "red", "the Resume's admissions is not a list", **facts)
    hit = [x for x in adm if isinstance(x, dict) and x.get("record_sha256") == rs]
    if hit:
        x = hit[0]
        rules = (fu.get("policy") or {}).get("rules_sha256")
        bad = []
        if len(hit) != 1:
            bad.append("listed %d times" % len(hit))
        if x.get("decision") != "admit":
            bad.append("decision %s, not admit" % json.dumps(x.get("decision")))
        if x.get("revoked") is not False:
            bad.append("revoked is %s" % json.dumps(x.get("revoked")))
        if x.get("content") != {"checked": True, "decision": "pass", "marks": [], "rules_sha256": rules}:
            bad.append("the content is not the fixed answer under the door's rules id")
        if bad:
            return c(cid, "red", "yesterday's record is in the Resume, but " + "; ".join(bad), ledger_n=x.get("ledger_n"), **facts)
        return c(cid, "ok", "yesterday's check call record is in the Resume of %s: admit, not revoked, the fixed content answer, ledger entry %s" % (RESUME_ENDPOINT, x.get("ledger_n")), ledger_n=x.get("ledger_n"), **facts)
    nc = [x for x in (r.get("not_counted") or []) if isinstance(x, dict) and x.get("record_sha256") == rs]
    if nc and all(x.get("why") in UNANCHORED for x in nc):
        return c(cid, "not_yet", "yesterday's record is batched but its batch is not anchored yet (%s), so the Resume does not list it yet" % nc[0].get("why"), **facts)
    if nc:
        return c(cid, "red", "the Resume does not count yesterday's record: %s" % ", ".join(str(x.get("why")) for x in nc), **facts)
    return c(cid, "red", "yesterday's check call record is in neither admissions[] nor not_counted of the Resume of %s" % RESUME_ENDPOINT, **facts)


def _index(get):
    """(state or None, why, index): the check call's MUSUBI loop index, or why it cannot be read"""
    try:
        s, ix = get(CHECK_RUNS + "index.json")
    except Unreachable as e:
        return "red", "the loop's index did not answer: " + str(e), None
    if s == 404:
        return "not_yet", "the check call's MUSUBI loop is not in production yet (no check-runs/index.json)", None
    if s != 200 or not isinstance(ix, dict) or ix.get("schema") != "seki-check-loop-index-v0" or not isinstance(ix.get("days"), dict) \
            or not (isinstance(ix.get("contract_sha256"), str) and H64.match(ix["contract_sha256"])):
        return "red", "check-runs/index.json answered http %s without the index shape" % s, None
    return None, "", ix


def _filed_at(d):
    """when seki-heartbeat files the check call of day d: 21:17 UTC of that day"""
    return datetime.datetime.strptime(d, "%Y-%m-%d").replace(hour=SETTLE_FILED[0], minute=SETTLE_FILED[1], tzinfo=datetime.timezone.utc)


def _stalled(ix, first, d, now):
    """the filed days before d, not before the loop's first day nor SETTLE_LOOKBACK days before now, still not settled final
    SETTLE_STALL after 21:17 UTC of their day"""
    lo = (now - datetime.timedelta(days=SETTLE_LOOKBACK)).strftime("%Y-%m-%d")
    late = []
    for e in sorted(k for k in ix["days"] if isinstance(k, str)):
        x = ix["days"][e]
        if not (first <= e < d and e >= lo and isinstance(x, dict)):
            continue
        try:
            fa = _filed_at(e)
        except ValueError:
            continue
        if now - fa >= SETTLE_STALL and not (x.get("settled") is True and x.get("status") == "final"):
            late.append(e)
    return late


def check_settle(get, now):
    """3: the check call of the day before yesterday, settled with MUSUBI settle v1.19 as within_grant, final"""
    cid = "3_ledger_settle"
    d = (now - datetime.timedelta(days=2)).strftime("%Y-%m-%d")
    st, why, ix = _index(get)
    if st:
        return c(cid, st, why, day=d)
    first = ix.get("first_day")
    if not isinstance(first, str) or d < first:
        return c(cid, "not_yet", "%s is before the first day the loop filed (%s)" % (d, first), day=d)
    late = _stalled(ix, first, d, now)
    if late:
        return c(cid, "red", "%s still not settled final more than 72 hours after it was filed (21:17 UTC of its day)" % ", ".join(late), day=d, stalled=late)
    x = ix["days"].get(d)
    if not isinstance(x, dict):
        return c(cid, "red", "the check call of %s was not carried through MUSUBI (no execution filed for it)" % d, day=d)
    facts = {"day": d, "record": x.get("record_sha256"), "execution": x.get("execution_sha256"), "contract": ix["contract_sha256"]}
    filed_at = _filed_at(d)
    if x.get("settled") is not True or x.get("status") != "final":
        if now - filed_at < SETTLE_STALL:
            return c(cid, "not_yet", "%s is filed and waits for Bitcoin to confirm its admission and execution (%s)" % (d, x.get("status") or "not settled"), **facts)
        return c(cid, "red", "%s is still not settled final more than 72 hours after it was filed" % d, **facts)
    if x.get("settle") != "v1.19" or x.get("verdict") != "within_grant":
        return c(cid, "red", "%s settled as %s under settle %s, not within_grant under v1.19" % (d, x.get("verdict"), x.get("settle")), **facts)
    try:
        ss, stext = get(CHECK_RUNS + d + "/settlement.json", raw=True)
        if ss != 200 or not isinstance(stext, str) or sha(stext) != x.get("settlement_sha256"):
            return c(cid, "red", "the settlement of %s is not served as the bytes its index names (http %s)" % (d, ss), **facts)
        sm = json.loads(stext)
        if sm.get("schema") != "a2a-settlement-v1.19" or sm.get("verdict") != "within_grant" or sm.get("status") != "final" or sm.get("contract_sha256") != ix["contract_sha256"]:
            return c(cid, "red", "the settlement of %s is not a v1.19 within_grant, final settlement of the check contract" % d, **facts)
        ls, la = get(LEDGER + "/admission/" + str(x.get("record_sha256")))
        if ls != 200 or not isinstance(la, dict) or la.get("canonical_sha256") != x.get("record_sha256") or la.get("status") != "anchored":
            return c(cid, "red", "the ledger does not serve the admission of %s as anchored (http %s)" % (d, ls), **facts)
        es, et = get(AGREEMENT + "/execution/" + str(x.get("execution_sha256")), raw=True)
        if es != 200 or not isinstance(et, str) or sha(et) != x.get("execution_sha256"):
            return c(cid, "red", "the MUSUBI intake does not serve the execution of %s as bytes that hash to it (http %s)" % (d, es), **facts)
    except Unreachable as e:
        return c(cid, "red", "an endpoint did not answer: " + str(e), **facts)
    except (ValueError, KeyError, TypeError) as e:
        return c(cid, "red", "an answer did not have its shape: %s" % type(e).__name__, **facts)
    return c(cid, "ok", "the check call of %s is settled within_grant, final, under settle v1.19: the admission is anchored on the ledger and the execution naming it is at the MUSUBI intake" % d, **facts)


NOTES_OUTSIDE = ("what this run saw at observed_at, beside the checks; not part of result_canonical, result_sha256 or day_sha256, "
                 "and not recomputed by a witness")


def note_yesterday_batch(get, now):
    """a note beside 3, never a check: is the ledger batch holding yesterday's admission confirmed in Bitcoin at this run.
    3 keeps reading the day before yesterday (yesterday is settled only by the 21:17 UTC run of today). The answer moves
    with the time of the run (pending at 04:05, confirmed later), so it stays out of the result and out of day_sha256;
    otherwise a witness who recomputes the day later would not get the published day_sha256. Reads only what 3 and 4b
    read: the loop's index, /admission/<sha> and /verify/<n>."""
    y = (now - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    def n(state, why, **f):
        return dict({"about": "3_ledger_settle", "what": "yesterday_batch_bitcoin", "day": y, "state": state, "why": why}, **f)
    try:
        st, why, ix = _index(get)
        if st:
            return n("unreadable", why)
        first = ix.get("first_day")
        if not isinstance(first, str) or y < first:
            return n("before_first_day", "%s is before the first day the loop filed (%s)" % (y, first))
        x = ix["days"].get(y)
        rs = x.get("record_sha256") if isinstance(x, dict) else None
        if not (isinstance(rs, str) and H64.match(rs)):
            return n("not_filed", "%s is not filed in the loop's index yet (it is filed at 21:17 UTC of its day)" % y)
        if x.get("settled") is True and x.get("status") == "final":
            return n("settled", "%s is settled final already" % y, record=rs)
        ls, la = get(LEDGER + "/admission/" + rs)
        if ls != 200 or not isinstance(la, dict) or la.get("canonical_sha256") != rs:
            return n("unreadable", "the ledger does not serve yesterday's admission (http %s)" % ls, record=rs)
        en = la.get("ledger_entry")
        if la.get("status") != "anchored" or not _int(en):
            return n("not_in_batch", "yesterday's admission is not in a ledger batch yet (%s)" % la.get("status"), record=rs)
        vs, v = get(LEDGER + "/verify/%d" % en)
        bs = v.get("bitcoin_status") if vs == 200 and isinstance(v, dict) else None
        if bs == "confirmed":
            return n("confirmed", "the ledger batch holding yesterday's admission (entry %d) is confirmed in Bitcoin; %s is settled by the 21:17 UTC run" % (en, y), record=rs, entry=en, bitcoin_status=bs)
        if bs is None:
            return n("unreadable", "/verify/%d answered http %s without a bitcoin_status" % (en, vs), record=rs, entry=en)
        return n("not_confirmed", "the ledger batch holding yesterday's admission (entry %d) is not confirmed in Bitcoin yet (%s)" % (en, bs), record=rs, entry=en, bitcoin_status=bs)
    except Unreachable as e:
        return n("unreadable", "an endpoint did not answer: " + str(e))
    except Exception as e:   # a note never stops the run
        return n("unreadable", "the note could not be made: %s" % type(e).__name__)


def notes(get, now):
    """the run's notes (tooshi-notes-v0): kept beside the result, never inside it"""
    return {"schema": "tooshi-notes-v0", "observed_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "outside": NOTES_OUTSIDE,
            "items": [note_yesterday_batch(get, now)]}


def check_resume_agreement(get, now):
    """4b: the check contract, on file at the MUSUBI intake, is listed in the agreements[] of the relying party's Resume"""
    cid = "4b_resume_agreement"
    st, why, ix = _index(get)
    if st:
        return c(cid, st, why)
    csha = ix["contract_sha256"]
    try:
        s, r = get(AGREEMENT + "/contract/" + csha + "/report")
        if s == 404:
            return c(cid, "not_yet", "the check contract is not on file at the MUSUBI intake yet", contract=csha)
        an = ((r or {}).get("intake") or {}).get("anchor") if s == 200 and isinstance(r, dict) else None
        if s != 200 or ((r.get("intake") or {}).get("verdict")) != "accepted":
            return c(cid, "red", "the MUSUBI intake answered http %s for the check contract, not an accepted contract" % s, contract=csha)
        n = an.get("ledger_entry") if isinstance(an, dict) else None
        if not isinstance(n, int):
            return c(cid, "not_yet", "the check contract is on file but not in a ledger batch yet", contract=csha)
        vs, v = get(LEDGER + "/verify/%d" % n)
        if vs != 200 or not isinstance(v, dict) or v.get("bitcoin_status") != "confirmed":
            return c(cid, "not_yet", "the check contract's batch (ledger entry %d) is not confirmed in Bitcoin yet" % n, contract=csha, entry=n)
        rs, rj = get(LEDGER + "/resume?endpoint=" + urllib.parse.quote(RESUME_ENDPOINT, safe=""))
    except Unreachable as e:
        return c(cid, "red", "an endpoint did not answer: " + str(e), contract=csha)
    if rs != 200 or not isinstance(rj, dict) or not isinstance(rj.get("agreements"), list):
        return c(cid, "red", "the Resume of %s answered http %s without an agreements list" % (RESUME_ENDPOINT, rs), contract=csha, entry=n)
    if any(isinstance(y, dict) and y.get("record_sha256") == csha for y in rj["agreements"]):
        return c(cid, "ok", "the check contract is listed in the agreements[] of the Resume of %s (ledger entry %d)" % (RESUME_ENDPOINT, n), contract=csha, entry=n)
    nc = [y for y in (rj.get("not_counted") or []) if isinstance(y, dict) and y.get("record_sha256") == csha]
    if nc and all(y.get("why") in UNANCHORED for y in nc):
        return c(cid, "not_yet", "the Resume names the check contract as not yet anchored (%s)" % nc[0].get("why"), contract=csha, entry=n)
    if nc:
        return c(cid, "red", "the Resume does not count the check contract: %s" % ", ".join(str(y.get("why")) for y in nc), contract=csha, entry=n)
    return c(cid, "red", "the check contract's batch (ledger entry %d) is confirmed, and the Resume of %s does not list it in agreements[] or not_counted" % (n, RESUME_ENDPOINT), contract=csha, entry=n)


def run(get, now, trigger="manual"):
    if trigger not in TRIGGERS:
        raise ValueError("trigger must be one of " + ", ".join(TRIGGERS))
    checks = check_call_checks(get, now)
    checks.append(check_settle(get, now))
    checks.append(check_resume(get, now))
    checks.append(check_resume_agreement(get, now))
    checks += [check_door_runner(get), check_day_root(get, now), check_leaves(get, now), check_heartbeat(get, now)]
    checks.sort(key=lambda x: x["id"])
    counts = {k: sum(1 for x in checks if x["state"] == k) for k in ("ok", "red", "notice", "not_yet")}
    verdict = "red" if counts["red"] else ("green" if counts["not_yet"] == 0 else "not_all_checked")
    res = {"schema": "tooshi-daily-v0", "checked_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "trigger": trigger, "verdict": verdict, "counts": counts, "checks": checks}
    text = json.dumps(res, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return res, text, hashlib.sha256(text.encode("utf-8")).hexdigest()


def day_view(res):
    """the result without the run's own time and trigger: what every run of the same day after 03:47 UTC should agree on.
    The run's notes (notes(), --notes) are never in res, so they are not in the view either."""
    v = {k: x for k, x in res.items() if k not in ("checked_at", "trigger")}
    v["schema"] = "tooshi-day-view-v0"
    v["day"] = res["checked_at"][:10]
    return v


def day_sha256(res):
    return hashlib.sha256(json.dumps(day_view(res), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()


def tool_sha256():
    with open(__file__, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def witness_record(res, name, vantage, now, tool):
    """an unsigned jidec-path-v1 commitment record for POST /witness: the witness's own day_sha256 of day D"""
    d = res["checked_at"][:10]
    ds = day_sha256(res)
    rec = {
        "schema": "jidec-path-v1", "purpose": "tooshi-day-v0: " + d, "walked_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "base": DAY_URL % d,
        "mode": "commitment", "commitment": ds,
        "witness": {"name": name, "vantage": vantage},
        "establishes": ["the witness ran tools/tooshi/tooshi_daily.py (sha256 %s) on its own machine on %s after 03:47 UTC and read the public endpoints itself" % (tool, d),
                        "commitment is the sha256 of the canonical day view it got (the result without checked_at and trigger, with day); salt is empty"],
        "does_not_establish": ["that the witness is independent of the operator (the record is unsigned; the name is what the witness typed)",
                               "that every reader got the same answers from the endpoints",
                               "anything beyond what the checks read"],
        "tooshi": {"schema": "tooshi-witness-v0", "day": d, "day_sha256": ds, "verdict": res["verdict"], "counts": res["counts"], "tool_sha256": tool},
    }
    return json.dumps(rec, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def http_post(url, obj, timeout=30):
    data = json.dumps(obj, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers=dict(UA, **{"content-type": "application/json"}))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except ValueError:
            return e.code, None


def body(res, sha):
    lines = ["TOOSHI %s: %s" % (res["checked_at"][:10], res["verdict"]), "",
             "ok %(ok)d, red %(red)d, notice %(notice)d, not yet %(not_yet)d" % res["counts"], ""]
    for x in res["checks"]:
        lines.append("- %s: %s. %s" % (x["id"], x["state"], x["why"]))
    lines += ["", "trigger " + res.get("trigger", "manual"), "result sha256 " + sha, "day sha256 " + day_sha256(res)]
    return "\n".join(lines) + "\n"


def selftest():
    now = datetime.datetime(2026, 11, 5, 4, 5, tzinfo=datetime.timezone.utc)
    hsh = globals()["sha"]
    SK, SK2 = b"\x05" * 32, b"\x06" * 32
    PUB = base64.b64encode(ed25519_public(SK)).decode()
    RULES = "2c5a1089a90265717175dd1056be7075472aed44fab5581e6be6e73b1746f195"

    def tree(l):
        if len(l) == 1:
            return l[0]
        k = _split(len(l))
        return _node(tree(l[:k]), tree(l[k:]))

    def path(m, l):
        if len(l) <= 1:
            return []
        k = _split(len(l))
        return path(m, l[:k]) + [tree(l[k:])] if m < k else path(m - k, l[k:]) + [tree(l[:k])]

    def envelope(d, i, key=SK, **chk):
        k = {"schema": "furui-check-v1", "input_commit": hsh("ic%s%d" % (d, i)), "rules_sha256": RULES, "scope_sha256": hsh("scope"), "action_binding_digest": "3" * 64,
             "contract_sha256": "4" * 64, "trace_sha256": "5" * 64, "decision": "pass", "marks": [], "unread": False, "answered": True, "stage_reached": 4,
             "checked_at_height": 100 + i, "nonce": "%032x" % (i + 1), "signed_at": d + "T03:47:1%d.000Z" % i}
        k.update(chk)
        e = {"schema": "furui-check-signed-v1", "check": k, "signer": dict(SIGNER), "signatures": []}
        e["signatures"] = [{"alg": "ed25519", "domain": "horizonshield.dev", "key_id": "runner-1", "sig": base64.b64encode(ed25519_sign(key, envelope_message(e))).decode()}]
        return e

    def day_world(d, envs, entry, batch_day):
        lv = [leaf_hash(e) for e in envs]
        root = tree(lv)
        rc = canonical({"schema": "furui-check-day-v0", "day": d, "signer": SIGNER, "n": len(lv), "tree": "rfc6962-sha256", "root": root})
        s_ = hsh(rc)
        w = {RUNNER + "/furui/day/%s/status" % d: (200, {"day": d, "status": {"state": "accepted", "accepted": True, "refused": False, "http": 201, "attempts": 1, "n": len(lv), "root": root, "ledger_canonical_sha256": s_}}),
             LEDGER + "/furui-check-day/" + s_: (200, {"canonical_sha256": s_, "record_canonical": rc, "status": "anchored", "ledger_entry": entry}),
             LEDGER + "/ledger/%d?format=json" % entry: (200, {"n": entry, "created_at": batch_day + "T00:30:40.000Z", "record_canonical": '{"records":[{"canonical_sha256":"%s"}]}' % s_})}
        for i, e in enumerate(envs):
            w[RUNNER + "/furui/day/%s/leaf/%d" % (d, i)] = (200, {"day": d, "index": i, "n": len(lv), "root": root, "leaf_sha256": lv[i], "envelope_sha256": hsh(canonical(e)), "envelope": e,
                                                                 "proof": path(i, lv), "proof_kind": "rfc6962-audit-path", "day_record": {"state": "accepted", "ledger_canonical_sha256": s_}, "kept_until": "2026-11-11"})
        return w, s_

    def admission(e, **content):
        k = e["check"]
        b = {"rules": "a2a-content-check-v1", "input_commit": k["input_commit"], "check_sha256": hsh(canonical(k)), "rules_sha256": k["rules_sha256"], "scope_sha256": k["scope_sha256"],
             "decision": k["decision"], "marks": k["marks"], "unread": k["unread"], "answered": k["answered"], "checked": True}
        b.update(content)
        t = canonical({"schema": "a2a-admission-v0", "rules": {"version": "0.4"}, "decision": "admit", "reasons": ["within_grant"], "content": b})
        return t, hsh(t)

    RESUME_URL = LEDGER + "/resume?endpoint=https%3A%2F%2Fshield.the-horizons-innovation.com%2F"
    D3 = [envelope("2026-11-03", 0, nonce="heartbeat-2026-11-03"), envelope("2026-11-03", 1), envelope("2026-11-03", 2)]
    W3, sha = day_world("2026-11-03", D3, 250, "2026-11-05")

    CSHA = hsh("the check contract")
    REC3 = hsh("the admission of 11-03")
    EXE3 = canonical({"schema": "a2a-execution-v0", "admission_ref": [{"admission_sha256": hsh("adm3")}]})
    SET3 = canonical({"schema": "a2a-settlement-v1.19", "verdict": "within_grant", "status": "final", "contract_sha256": CSHA})
    DAY3 = {"record_sha256": REC3, "admission_sha256": hsh("adm3"), "execution_sha256": hsh(EXE3), "settled": True, "settle": "v1.19",
            "verdict": "within_grant", "status": "final", "settlement_sha256": hsh(SET3)}
    INDEX = {"schema": "seki-check-loop-index-v0", "contract_sha256": CSHA, "first_day": "2026-11-03", "days": {"2026-11-03": DAY3}}

    def loop_world():
        return {CHECK_RUNS + "index.json": (200, json.loads(json.dumps(INDEX))), CHECK_RUNS + "2026-11-03/settlement.json": (200, SET3),
                LEDGER + "/admission/" + REC3: (200, {"canonical_sha256": REC3, "status": "anchored", "ledger_entry": 300}),
                AGREEMENT + "/execution/" + hsh(EXE3): (200, EXE3),
                AGREEMENT + "/contract/" + CSHA + "/report": (200, {"intake": {"verdict": "accepted", "anchor": {"status": "batched", "ledger_entry": 300}}}),
                LEDGER + "/verify/300": (200, {"bitcoin_status": "confirmed"})}

    def world(cc=False, prev=True, d4key=SK, adm_today=None, adm_prev=None, **over):
        w = {
            RUNNER + "/health": (200, {"runner": "hs-furui-runner 0.4.0", "key_id": "runner-1", "public_key_ed25519_b64": PUB, "rules_sha256": RULES if cc else None, "caps": dict(CAPS), "anthropic_key_set": True}),
            LEDGER + "/.well-known/furui-check-keys.json": (200, {"use": "furui-check", "keys": [{"key_id": "runner-1", "public_key_ed25519_b64": PUB, "from_height": 0, "revoked_height": None}]}),
            DOOR_POLICY: (200, {"furui": {"policy": {"required": False}}}),
            RUNNER + "/furui/heartbeat": (200, {"at": "2026-11-05T03:17:09.000Z", "ok": True, "decision": "pass", "answered": True, "marks": [], "capped": False, "spent_usd": 0.03}),
        }
        w.update(W3)
        if cc:
            e5 = envelope("2026-11-05", 0)
            t5, r5 = adm_today or admission(e5)
            D4 = [envelope("2026-11-04", 0, key=d4key, nonce="heartbeat-2026-11-04"), envelope("2026-11-04", 1, key=d4key)]
            W4, _s4 = day_world("2026-11-04", D4, 260, "2026-11-06")
            w.update(W4)
            t4, r4 = adm_prev or admission(D4[1])
            call = {"at": "2026-11-05T03:47:12.345Z", "day": "2026-11-05", "ok": True, "decision": "admit", "reasons": ["within_grant"], "admission_sha256": hsh("adm5"),
                    "record_sha256": r5, "version": "0.4", "content": {"checked": True, "decision": "pass", "marks": [], "rules_sha256": RULES}, "published": {"status": 201, "accepted": True}}
            fu = {"policy": {"required": False, "rules_sha256": RULES, "runner_wait_ms": 25000, "runner_public_key_ed25519_b64": PUB}, "check_call": call,
                  "stores_requiring": [CHECK_STORE]}
            if prev:
                fu["check_call_prev"] = dict(call, at="2026-11-04T03:47:12.345Z", day="2026-11-04", record_sha256=r4, admission_sha256=hsh("adm4"))
            w[DOOR_POLICY] = (200, {"furui": fu})
            w.update(loop_world())
            w[RESUME_URL] = (200, {"schema": "nenrin-resume-v1", "agreements": [{"record_sha256": CSHA, "source_ledger_n": 300}], "not_counted": [{"n": 271, "record_sha256": r5, "why": "not_yet_anchored", "kind": "admission"}],
                                   "admissions": [{"record_sha256": r4, "ledger_n": 261, "decision": "admit", "revoked": False,
                                                   "content": {"checked": True, "decision": "pass", "marks": [], "rules_sha256": RULES}}]})
            for t, r in ((t5, r5), (t4, r4)):
                w[LEDGER + "/admission/" + r] = (200, {"canonical_sha256": r, "record_canonical": t, "status": "pending_anchor", "ledger_entry": None})
                w[DOOR_RECORD + r] = (200, t)
        w.update(over)

        def get(url, raw=False):
            v = w.get(url, (404, {"error": "not_found"}))
            if v == "down":
                raise Unreachable(url + ": http 503 after 3 tries")
            if callable(v):
                return v(w)
            return v
        return get

    def states(get, when=now):
        res, _, _ = run(get, when)
        return res["verdict"], {x["id"]: x["state"] for x in res["checks"]}

    cases = []
    v, s = states(world())
    cases.append(("a whole day that holds: the three checkable checks ok, the four others not_yet, verdict not_all_checked", (v, s["5_door_runner"], s["6_daily_root"], s["7_heartbeat_scene"], s["1_sieve_admission"]), ("not_all_checked", "ok", "ok", "ok", "not_yet")))
    v, s = states(world(**{LEDGER + "/.well-known/furui-check-keys.json": (200, {"keys": [{"key_id": "runner-1", "public_key_ed25519_b64": "B" * 43 + "=", "revoked_height": None}]})}))
    cases.append(("the runner's public half differs from the ledger's: red", (v, s["5_door_runner"]), ("red", "red")))
    v, s = states(world(**{DOOR_POLICY: (200, {"furui": {"policy": {"required": True, "rules_sha256": "cd" * 32}}})}))
    cases.append(("the door names a rules id the runner does not carry: red", (v, s["5_door_runner"]), ("red", "red")))
    v, s = states(world(**{RUNNER + "/health": (200, {"key_id": "runner-1", "public_key_ed25519_b64": PUB, "rules_sha256": None, "caps": {"request_usd": 0.4, "day_usd": 50, "party_per_day": 100}, "anthropic_key_set": True})}))
    cases.append(("caps other than 0.40 / 5.00 / 100: red", s["5_door_runner"], "red"))
    v, s = states(world(**{RUNNER + "/furui/heartbeat": (200, {"at": "2026-11-04T03:17:09.000Z", "ok": True, "decision": "pass", "answered": True, "marks": [], "capped": False, "spent_usd": 0.03})}))
    cases.append(("the heartbeat is from yesterday (old): red", (v, s["7_heartbeat_scene"]), ("red", "red")))
    v, s = states(world(**{RUNNER + "/furui/heartbeat": (200, {"at": "2026-11-05T03:17:09.000Z", "ok": True, "decision": "stop", "answered": True, "marks": ["off_topic"], "capped": False, "spent_usd": 0.03})}))
    cases.append(("the heartbeat answered other than pass with no marks: red", s["7_heartbeat_scene"], "red"))
    v, s = states(world(**{RUNNER + "/furui/heartbeat": (200, {"at": "2026-11-05T03:17:09.000Z", "ok": True, "decision": None, "answered": False, "marks": [], "capped": True, "spent_usd": 0.4})}))
    cases.append(("the heartbeat hit a cap: notice, not red", (v, s["7_heartbeat_scene"]), ("not_all_checked", "notice")))
    v, s = states(world(**{RUNNER + "/furui/heartbeat": (200, {"at": None})}), datetime.datetime(2026, 11, 2, 9, 0, tzinfo=datetime.timezone.utc))
    cases.append(("before the first scene (11-02): the heartbeat is not_yet, the day root is not_yet", (s["7_heartbeat_scene"], s["6_daily_root"]), ("not_yet", "not_yet")))
    v, s = states(world(**{RUNNER + "/furui/heartbeat": (200, {"at": None})}))
    cases.append(("no scene ever, after the first day: red", s["7_heartbeat_scene"], "red"))
    v, s = states(world(**{RUNNER + "/furui/day/2026-11-03/status": (200, {"status": {"state": "retrying", "accepted": False, "refused": True, "http": 422, "attempts": 5, "refusals": ["key_not_listed"]}})}))
    cases.append(("the day status says refused (retrying): red", (v, s["6_daily_root"]), ("red", "red")))
    v, s = states(world(**{RUNNER + "/furui/day/2026-11-03/status": (200, {"status": {"state": "empty", "accepted": False, "refused": False, "attempts": 0}})}))
    cases.append(("an empty day: notice, not red", s["6_daily_root"], "notice"))
    v, s = states(world(**{RUNNER + "/furui/day/2026-11-03/status": (200, {"status": None})}))
    cases.append(("no closed status for the day: red", s["6_daily_root"], "red"))
    v, s = states(world(**{LEDGER + "/furui-check-day/" + sha: (200, {"canonical_sha256": sha, "status": "pending_anchor", "ledger_entry": None})}))
    cases.append(("accepted but not in a batch: red", s["6_daily_root"], "red"))
    v, s = states(world(**{LEDGER + "/ledger/250?format=json": (200, {"n": 250, "created_at": "2026-11-06T00:30:40.000Z", "record_canonical": sha})}))
    cases.append(("in a batch of another day: red", s["6_daily_root"], "red"))
    v, s = states(world(**{RUNNER + "/health": "down"}))
    cases.append(("the runner's health answers 5xx three times: red", (v, s["5_door_runner"]), ("red", "red")))
    v, s = states(world(**{RUNNER + "/furui/day/2026-11-03/status": "down", RUNNER + "/furui/heartbeat": "down"}))
    cases.append(("the day status and the heartbeat answer 5xx: both red", (s["6_daily_root"], s["7_heartbeat_scene"]), ("red", "red")))
    # the leaves (6b) and the door's check call (1 to 3); 4 stays not_yet; nothing here is ever green while 4 is not_yet
    v, s = states(world())
    cases.append(("before the door stage and the loop: 1 to 4 and 4b not_yet (no furui.check_call, no check-runs index), the leaves of 11-03 ok", (s["1_sieve_admission"], s["2_admission_ledger"], s["3_ledger_settle"], s["4_door_resume"], s["4b_resume_agreement"], s["6b_daily_leaf"]), ("not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "ok")))
    v, s = states(world(cc=True))
    cases.append(("the door's check call and its MUSUBI loop, everything holds: 1 to 7, 4b and 6b ok, the verdict green", (v, s["1_sieve_admission"], s["2_admission_ledger"], s["3_ledger_settle"], s["4_door_resume"], s["4b_resume_agreement"], s["5_door_runner"], s["6_daily_root"], s["6b_daily_leaf"], s["7_heartbeat_scene"]), ("green", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok")))
    v, s = states(world(cc=True, prev=False))
    cases.append(("no check_call_prev in the door yet: 1 and 4 stay not_yet (never ok), 2 and 3 ok, the verdict not green", (v, s["1_sieve_admission"], s["2_admission_ledger"], s["3_ledger_settle"], s["4_door_resume"]), ("not_all_checked", "not_yet", "ok", "ok", "not_yet")))
    v, s = states(world(**{DOOR_POLICY: (200, {"furui": {"policy": {"required": False}, "check_call": None}})}))
    cases.append(("the door shows check_call null (no call yet): 1 and 2 not_yet, never ok", (s["1_sieve_admission"], s["2_admission_ledger"]), ("not_yet", "not_yet")))
    v, s = states(world(cc=True), datetime.datetime(2026, 11, 5, 3, 40, tzinfo=datetime.timezone.utc))
    cases.append(("a run before 03:47 UTC: 1 and 2 not_yet (3 reads the day before yesterday and does not wait)", (s["1_sieve_admission"], s["2_admission_ledger"], s["3_ledger_settle"]), ("not_yet", "not_yet", "ok")))
    g = world(cc=True)
    pol = json.loads(json.dumps(g(DOOR_POLICY)[1]))
    def door_with(**ccf):
        p2 = json.loads(json.dumps(pol)); p2["furui"]["check_call"].update(ccf); return (200, p2)
    v, s = states(world(cc=True, **{DOOR_POLICY: door_with(day="2026-11-04", at="2026-11-04T03:47:12.345Z")}))
    cases.append(("red: the last call is yesterday's (the cron did not run today)", (v, s["1_sieve_admission"], s["2_admission_ledger"]), ("red", "red", "red")))
    v, s = states(world(cc=True, **{DOOR_POLICY: door_with(ok=False, error="chain_view_unavailable")}))
    cases.append(("red: today's call failed", (v, s["2_admission_ledger"]), ("red", "red")))
    v, s = states(world(cc=True, **{DOOR_POLICY: door_with(published={"status": 503, "accepted": False})}))
    cases.append(("red: the door did not hand the record to the ledger", (v, s["2_admission_ledger"]), ("red", "red")))
    r5 = pol["furui"]["check_call"]["record_sha256"]
    v, s = states(world(cc=True, **{LEDGER + "/admission/" + r5: (404, {"error": "not_found"})}))
    cases.append(("red: the ledger does not serve the record (1 and 2 red)", (v, s["1_sieve_admission"], s["2_admission_ledger"]), ("red", "red", "red")))
    t5 = g(DOOR_RECORD + r5)[1]
    v, s = states(world(cc=True, **{DOOR_RECORD + r5: (200, t5 + " ")}))
    cases.append(("red: the door serves other bytes than the ledger", (v, s["2_admission_ledger"]), ("red", "red")))
    e5 = envelope("2026-11-05", 0, marks=["off_topic"])
    v, s = states(world(cc=True, adm_today=admission(e5)))
    cases.append(("red: today's record says off_topic (not the fixed answer)", (v, s["1_sieve_admission"], s["2_admission_ledger"]), ("red", "red", "red")))
    v, s = states(world(cc=True, adm_today=admission(envelope("2026-11-05", 0, rules_sha256="77" * 32))))
    cases.append(("red: the record's rules id is not the door's", (v, s["2_admission_ledger"]), ("red", "red")))
    v, s = states(world(cc=True, adm_today=admission(envelope("2026-11-05", 0), note="free text in the block")))
    cases.append(("red: the content block carries a field outside the closed list", (v, s["2_admission_ledger"]), ("red", "red")))
    v, s = states(world(cc=True, adm_prev=admission(envelope("2026-11-04", 7))))
    cases.append(("red: yesterday's record names a check no leaf of that day carries", (v, s["1_sieve_admission"]), ("red", "red")))
    v, s = states(world(cc=True, d4key=SK2))
    cases.append(("red: yesterday's envelope is not signed by runner-1", (v, s["1_sieve_admission"]), ("red", "red")))
    v, s = states(world(**{RUNNER + "/furui/day/2026-11-03/leaf/2": (410, {"error": "gone"})}))
    cases.append(("red: a leaf of the day before yesterday is gone (410) inside the 7 days", (v, s["6b_daily_leaf"]), ("red", "red")))
    lf = json.loads(json.dumps(W3[RUNNER + "/furui/day/2026-11-03/leaf/0"][1])); lf["proof"] = list(reversed(lf["proof"]))
    v, s = states(world(**{RUNNER + "/furui/day/2026-11-03/leaf/0": (200, lf)}))
    cases.append(("red: a leaf's audit path does not rebuild the root", (v, s["6b_daily_leaf"]), ("red", "red")))
    lf = json.loads(json.dumps(W3[RUNNER + "/furui/day/2026-11-03/leaf/2"][1])); lf["envelope"]["check"]["decision"] = "stop"
    v, s = states(world(**{RUNNER + "/furui/day/2026-11-03/leaf/2": (200, lf)}))
    cases.append(("red: a leaf's envelope was changed after it was hashed", (v, s["6b_daily_leaf"]), ("red", "red")))
    lf = json.loads(json.dumps(W3[RUNNER + "/furui/day/2026-11-03/leaf/1"][1])); lf["envelope"]["check"]["note"] = "LEAK"
    cases.append(("a leaf that is not read (1 of 0..2) is not checked; 0 and n-1 are", states(world(**{RUNNER + "/furui/day/2026-11-03/leaf/1": (200, lf)}))[1]["6b_daily_leaf"], "ok"))
    v, s = states(world(), datetime.datetime(2026, 11, 4, 4, 5, tzinfo=datetime.timezone.utc))
    cases.append(("before the first kept day (11-02 is read on 11-04): the leaves are not_yet", s["6b_daily_leaf"], "not_yet"))
    v, s = states(world(**{RUNNER + "/furui/day/2026-11-03/status": (200, {"status": {"state": "empty", "accepted": False}})}))
    cases.append(("an empty day: the leaves are a notice, not red", s["6b_daily_leaf"], "notice"))
    v, s = states(world(cc=True, **{DOOR_POLICY: (200, dict(pol, furui=dict(pol["furui"], policy={"required": True})))}))
    cases.append(("red: the door requires the check but names no rules id", s["5_door_runner"], "red"))
    v, s = states(world(cc=True, **{DOOR_POLICY: (200, dict(pol, furui=dict(pol["furui"], policy=dict(pol["furui"]["policy"], runner_public_key_ed25519_b64="B" * 43 + "="))))}))
    cases.append(("red: the door checks envelopes with another public half than the runner's", s["5_door_runner"], "red"))
    v, s = states(world(cc=True, **{DOOR_POLICY: (200, dict(pol, furui=dict(pol["furui"], stores_requiring=[])))}))
    cases.append(("red: the door makes check calls and its check store no longer requires the content check", (v, s["5_door_runner"]), ("red", "red")))
    v, s = states(world(cc=True, **{DOOR_POLICY: (200, dict(pol, furui={k: x for k, x in pol["furui"].items() if k != "stores_requiring"}))}))
    cases.append(("red: the door makes check calls and names no stores_requiring", s["5_door_runner"], "red"))
    # 4: yesterday's record in the relying party's Resume
    rj = json.loads(json.dumps(g(RESUME_URL)[1]))
    r4 = pol["furui"]["check_call_prev"]["record_sha256"]
    def resume_with(**f):
        x = json.loads(json.dumps(rj)); x.update(f); return (200, x)
    cases.append(("4 ok: the Resume of shield.the-horizons-innovation.com lists yesterday's record (admit, not revoked, the fixed content)", states(world(cc=True))[1]["4_door_resume"], "ok"))
    v, s = states(world(cc=True, **{RESUME_URL: resume_with(admissions=[])}))
    cases.append(("4 red: yesterday's record is in neither admissions[] nor not_counted", (v, s["4_door_resume"]), ("red", "red")))
    v, s = states(world(cc=True, **{RESUME_URL: resume_with(admissions=[], not_counted=[{"n": 261, "record_sha256": r4, "why": "not_yet_anchored", "kind": "admission"}])}))
    cases.append(("4 not_yet: batched, not anchored yet (not_counted not_yet_anchored); the verdict is not green", (v, s["4_door_resume"]), ("not_all_checked", "not_yet")))
    v, s = states(world(cc=True, **{RESUME_URL: resume_with(admissions=[], not_counted=[{"n": 261, "record_sha256": r4, "why": "admission_fields_not_closed", "kind": "admission"}])}))
    cases.append(("4 red: the Resume refuses to count yesterday's record (not closed)", (v, s["4_door_resume"]), ("red", "red")))
    v, s = states(world(cc=True), datetime.datetime(2026, 11, 5, 0, 50, tzinfo=datetime.timezone.utc))
    cases.append(("4 not_yet: before the ledger's batch window ends (00:50 UTC), the Resume is not read", s["4_door_resume"], "not_yet"))
    v, s = states(world(cc=True, **{RESUME_URL: "down"}))
    cases.append(("4 red: the Resume answers 5xx three times", (v, s["4_door_resume"]), ("red", "red")))
    v, s = states(world(cc=True, **{RESUME_URL: (200, {"schema": "nenrin-resume-v1", "agreements": [{"record_sha256": CSHA, "source_ledger_n": 300}]})}))
    cases.append(("4 not_yet: the Resume carries no admissions[] (never ok)", (v, s["4_door_resume"]), ("not_all_checked", "not_yet")))
    a4 = rj["admissions"][0]
    v, s = states(world(cc=True, **{RESUME_URL: resume_with(admissions=[dict(a4, revoked=True)])}))
    cases.append(("4 red: listed but revoked", s["4_door_resume"], "red"))
    v, s = states(world(cc=True, **{RESUME_URL: resume_with(admissions=[dict(a4, content=dict(a4["content"], marks=["off_topic"], decision="stop"))])}))
    cases.append(("4 red: listed with another content answer than the fixed one", s["4_door_resume"], "red"))
    v, s = states(world(cc=True, **{DOOR_POLICY: (200, dict(pol, furui=dict(pol["furui"], check_call_prev=None)))}))
    cases.append(("4 not_yet: the door's previous call is null (its first day)", s["4_door_resume"], "not_yet"))
    v, s = states(world(cc=True, **{DOOR_POLICY: (200, dict(pol, furui=dict(pol["furui"], check_call_prev=dict(pol["furui"]["check_call_prev"], day="2026-11-03"))))}))
    cases.append(("4 red: the door's previous call is not yesterday's", s["4_door_resume"], "red"))
    v, s = states(world())
    cases.append(("4 not_yet: the door shows no check call at all", s["4_door_resume"], "not_yet"))
    # 3: the check call's MUSUBI settlement; 4b: the check contract in the Resume's agreements[]
    def loop_with(day=None, **f):
        ix = json.loads(json.dumps(INDEX)); ix["days"]["2026-11-03"].update(day or {}); ix.update(f); return (200, ix)
    cases.append(("3 ok: the call of 11-03 settled within_grant, final under v1.19, admission anchored, execution served", states(world(cc=True))[1]["3_ledger_settle"], "ok"))
    v, s = states(world(cc=True, **{CHECK_RUNS + "index.json": (404, None)}))
    cases.append(("3 and 4b not_yet: the loop is not in production (no index), never ok, the verdict not green", (v, s["3_ledger_settle"], s["4b_resume_agreement"]), ("not_all_checked", "not_yet", "not_yet")))
    v, s = states(world(cc=True, **{CHECK_RUNS + "index.json": loop_with(first_day="2026-11-04")}))
    cases.append(("3 not_yet: the day before yesterday is before the loop's first day", s["3_ledger_settle"], "not_yet"))
    v, s = states(world(cc=True, **{CHECK_RUNS + "index.json": (200, dict(INDEX, days={}))}))
    cases.append(("3 red: the day is not filed after the loop's first day", (v, s["3_ledger_settle"]), ("red", "red")))
    v, s = states(world(cc=True, **{CHECK_RUNS + "index.json": loop_with(day={"settled": False, "status": None, "verdict": None})}))
    cases.append(("3 not_yet: filed, waiting for Bitcoin (within 72 hours of filing)", (v, s["3_ledger_settle"]), ("not_all_checked", "not_yet")))
    UNS = {"settled": False, "status": None, "verdict": None}

    def settle_at(when, days):
        ix = json.loads(json.dumps(INDEX))
        for k, f in days.items():
            ix["days"][k] = dict(DAY3, **f)
        r = check_settle(world(cc=True, **{CHECK_RUNS + "index.json": (200, ix)}), when)
        return r["state"], r["facts"].get("stalled")
    at = lambda d, h, m: datetime.datetime.strptime(d, "%Y-%m-%d").replace(hour=h, minute=m, tzinfo=datetime.timezone.utc)
    cases.append(("3 not_yet: 11-03 unsettled at 11-06 21:16, one minute before 72 hours after its filing at 11-03 21:17 (11-04 the day before yesterday, unsettled)",
                  settle_at(at("2026-11-06", 21, 16), {"2026-11-03": UNS, "2026-11-04": UNS}), ("not_yet", None)))
    cases.append(("3 red: 11-03 unsettled at 11-06 21:17, 72 hours after its filing at 11-03 21:17",
                  settle_at(at("2026-11-06", 21, 17), {"2026-11-03": UNS, "2026-11-04": UNS}), ("red", ["2026-11-03"])))
    cases.append(("3 red: at the 04:05 run of 11-07, 11-03 still unsettled (the day before yesterday 11-05 filed and waiting)",
                  settle_at(at("2026-11-07", 4, 5), {"2026-11-03": UNS, "2026-11-05": UNS}), ("red", ["2026-11-03"])))
    cases.append(("3 not_yet: at the 04:05 run of 11-07, 11-03 settled final, 11-04 unsettled but within 72 hours of 11-04 21:17, 11-05 waiting",
                  settle_at(at("2026-11-07", 4, 5), {"2026-11-04": UNS, "2026-11-05": UNS}), ("not_yet", None)))
    cases.append(("3 not_yet: at the 04:05 run of 11-11, 11-03 is unsettled but more than 7 days back, 11-09 waiting",
                  settle_at(at("2026-11-11", 4, 5), {"2026-11-03": UNS, "2026-11-09": UNS}), ("not_yet", None)))
    cases.append(("3 red: at the 04:05 run of 11-11, 11-04 to 11-07 unsettled are named, 11-08 is within 72 hours",
                  settle_at(at("2026-11-11", 4, 5), {d_: UNS for d_ in ("2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09")}), ("red", ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"])))
    v, s = states(world(cc=True, **{CHECK_RUNS + "index.json": loop_with(day={"verdict": "deviation"})}))
    cases.append(("3 red: settled as a deviation", (v, s["3_ledger_settle"]), ("red", "red")))
    v, s = states(world(cc=True, **{CHECK_RUNS + "index.json": loop_with(day={"settle": "v1.15"})}))
    cases.append(("3 red: settled under another settle than v1.19", s["3_ledger_settle"], "red"))
    v, s = states(world(cc=True, **{CHECK_RUNS + "2026-11-03/settlement.json": (200, SET3 + " ")}))
    cases.append(("3 red: the settlement's bytes are not the ones its index names", s["3_ledger_settle"], "red"))
    v, s = states(world(cc=True, **{LEDGER + "/admission/" + REC3: (200, {"canonical_sha256": REC3, "status": "pending_anchor"})}))
    cases.append(("3 red: the settled admission is not anchored on the ledger", s["3_ledger_settle"], "red"))
    v, s = states(world(cc=True, **{AGREEMENT + "/execution/" + hsh(EXE3): (404, "{}")}))
    cases.append(("3 red: the MUSUBI intake does not serve the execution", s["3_ledger_settle"], "red"))
    v, s = states(world(cc=True, **{CHECK_RUNS + "index.json": "down"}))
    cases.append(("3 and 4b red: the index answers 5xx three times", (v, s["3_ledger_settle"], s["4b_resume_agreement"]), ("red", "red", "red")))
    cases.append(("4b ok: the check contract is in the Resume's agreements[] after its batch is confirmed", states(world(cc=True))[1]["4b_resume_agreement"], "ok"))
    v, s = states(world(cc=True, **{AGREEMENT + "/contract/" + CSHA + "/report": (404, {"error": "not_found"})}))
    cases.append(("4b not_yet: the check contract is not on file at the MUSUBI intake", (v, s["4b_resume_agreement"]), ("not_all_checked", "not_yet")))
    v, s = states(world(cc=True, **{AGREEMENT + "/contract/" + CSHA + "/report": (200, {"intake": {"verdict": "accepted", "anchor": {"status": "pending"}}})}))
    cases.append(("4b not_yet: on file, not in a ledger batch yet", s["4b_resume_agreement"], "not_yet"))
    v, s = states(world(cc=True, **{LEDGER + "/verify/300": (200, {"bitcoin_status": "pending"})}))
    cases.append(("4b not_yet: its batch is not confirmed in Bitcoin yet", s["4b_resume_agreement"], "not_yet"))
    rj4 = json.loads(json.dumps(g(RESUME_URL)[1]))
    v, s = states(world(cc=True, **{RESUME_URL: (200, dict(rj4, agreements=[]))}))
    cases.append(("4b red: the batch is confirmed and the Resume lists the contract nowhere", (v, s["4b_resume_agreement"]), ("red", "red")))
    v, s = states(world(cc=True, **{RESUME_URL: (200, dict(rj4, agreements=[], not_counted=[{"record_sha256": CSHA, "why": "not_yet_anchored", "kind": "agreement"}]))}))
    cases.append(("4b not_yet: the Resume names the contract as not yet anchored", s["4b_resume_agreement"], "not_yet"))
    v, s = states(world(cc=True, **{RESUME_URL: (200, dict(rj4, agreements=[], not_counted=[{"record_sha256": CSHA, "why": "agreement_bytes_do_not_hash_to_the_listed_sha"}]))}))
    cases.append(("4b red: the Resume refuses to count the contract", s["4b_resume_agreement"], "red"))
    v, s = states(world(cc=True, **{AGREEMENT + "/contract/" + CSHA + "/report": "down"}))
    cases.append(("4b red: the MUSUBI intake answers 5xx three times", s["4b_resume_agreement"], "red"))
    sk = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
    cases.append(("Ed25519: RFC 8032 test 1 (public half, signature, a changed message fails)", (ed25519_public(sk).hex(), ed25519_verify(base64.b64encode(ed25519_public(sk)).decode(), b"", base64.b64encode(ed25519_sign(sk, b"")).decode()),
                  ed25519_verify(base64.b64encode(ed25519_public(sk)).decode(), b"x", base64.b64encode(ed25519_sign(sk, b"")).decode())), ("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", True, False)))
    cases.append(("the leaf hash of a fixed envelope is the runner's (node canonical_v0.mjs, a fixed vector)", leaf_hash(json.loads(VEC_ENVELOPE)), "56054ab73249bca2d4b7af50788fffe5e0309a628dff691d6b380f3bb06198b4"))
    r1 = run(world(), now)[2]; r2 = run(world(), now)[2]
    cases.append(("the result sha is the same for the same day and answers", r1 == r2 and len(r1) == 64, True))
    ra, ta, sa = run(world(cc=True), now, "schedule")
    rb, tb, sb = run(world(cc=True), now.replace(hour=11, minute=50, second=32), "dispatch")
    cases.append(("the result names its trigger", (ra["trigger"], rb["trigger"]), ("schedule", "dispatch")))
    cases.append(("two runs of one day: result_sha256 differs (checked_at, trigger), day_sha256 is the same", (sa != sb, day_sha256(ra) == day_sha256(rb), len(day_sha256(ra))), (True, True, 64)))
    rc_, _, _ = run(world(cc=True, prev=False), now)
    cases.append(("a day whose answers differ has another day_sha256", day_sha256(ra) != day_sha256(rc_), True))
    rd, _, _ = run(world(cc=True), now + datetime.timedelta(days=1))
    cases.append(("the same answers on another day have another day_sha256 (the day is in the view)", day_sha256(ra) != day_sha256(rd), True))
    try:
        run(world(), now, "nightly"); t_ok = False
    except ValueError:
        t_ok = True
    cases.append(("an unknown trigger is refused", t_ok, True))
    w = json.loads(witness_record(ra, "anonymous", "test", now, "ab" * 32))
    cases.append(("the witness record: an unsigned jidec-path-v1 commitment of the day_sha256, for the published day's URL",
                  (w["schema"], w["mode"], w["commitment"], w["purpose"], w["base"], w["tooshi"]["day_sha256"], sorted(w["witness"]), bool(w["establishes"]) and bool(w["does_not_establish"])),
                  ("jidec-path-v1", "commitment", day_sha256(ra), "tooshi-day-v0: 2026-11-05", DAY_URL % "2026-11-05", day_sha256(ra), ["name", "vantage"], True)))
    cases.append(("the witness record carries no key, no signature and no answer text beyond the counts", any(k in w for k in ("signature_ed25519_b64", "public_key_ed25519_b64", "checks", "nodes")) or "key_url" in w["witness"], False))
    cases.append(("witness: refused before 03:47 UTC, with --now, and without a name", (main(["--witness", "x", "--now", "2026-11-05T04:05:00Z"]), witness_refusal(datetime.datetime(2026, 11, 5, 3, 46, tzinfo=datetime.timezone.utc), "x"), witness_refusal(now, "")), (2, "too_early", "no_name")))
    # 5: check_store_required is a setting; a witness who runs later reads the same value and gets the same day_sha256
    rs_, _, _ = run(world(cc=True), now, "schedule")
    rw_, _, _ = run(world(cc=True), now.replace(hour=11, minute=20), "witness")
    f5 = lambda r: [x["facts"].get("check_store_required") for x in r["checks"] if x["id"] == "5_door_runner"][0]
    ww = json.loads(witness_record(rw_, "anonymous", "test", now.replace(hour=11, minute=20), "ab" * 32))
    cases.append(("5: the 04:05 run and a witness at 11:20 read check_store_required true and get the same day_sha256, which the witness record commits to",
                  (f5(rs_), f5(rw_), day_sha256(rs_) == day_sha256(rw_), ww["commitment"] == day_sha256(rs_)), (True, True, True, True)))
    rx_, _, _ = run(world(cc=True, **{DOOR_POLICY: (200, dict(pol, furui=dict(pol["furui"], stores_requiring=[])))}), now, "schedule")
    cases.append(("5: a door whose check store no longer requires the check gives another day_sha256 (false is in the facts)", (f5(rx_), day_sha256(rx_) != day_sha256(rs_)), (False, True)))
    # the note beside 3 (--notes): is yesterday's batch confirmed in Bitcoin; 3 still reads the day before yesterday
    REC4 = hsh("the admission of 11-04")
    A4 = (200, {"canonical_sha256": REC4, "status": "anchored", "ledger_entry": 310})

    def note_world(bs="confirmed", adm=A4, ix4=None, first=None, **over):
        ix = json.loads(json.dumps(INDEX))
        ix["days"]["2026-11-04"] = dict({"record_sha256": REC4, "admission_sha256": hsh("adm4"), "execution_sha256": hsh("exe4"), "settled": False, "status": None, "verdict": None}, **(ix4 or {}))
        if first:
            ix["first_day"] = first
        o = {CHECK_RUNS + "index.json": (200, ix), LEDGER + "/admission/" + REC4: adm, LEDGER + "/verify/310": (200, {"bitcoin_status": bs})}
        o.update(over)
        return world(cc=True, **o)
    nst = lambda get, when=now: (lambda x: (x["state"], x["day"], x.get("entry")))(notes(get, when)["items"][0])
    rc3, _, _ = run(note_world("confirmed"), now)
    c3 = [x for x in rc3["checks"] if x["id"] == "3_ledger_settle"][0]
    cases.append(("note: yesterday's batch is confirmed; the note says so, and 3 still reads the day before yesterday (11-03, ok), the verdict green",
                  (nst(note_world("confirmed")), c3["state"], c3["facts"]["day"], rc3["verdict"]), (("confirmed", "2026-11-04", 310), "ok", "2026-11-03", "green")))
    cases.append(("note: yesterday's batch is pending in Bitcoin: not_confirmed", nst(note_world("pending")), ("not_confirmed", "2026-11-04", 310)))
    cases.append(("note: yesterday's admission is not in a ledger batch yet: not_in_batch",
                  nst(note_world(adm=(200, {"canonical_sha256": REC4, "status": "pending_anchor", "ledger_entry": None}))), ("not_in_batch", "2026-11-04", None)))
    cases.append(("note: yesterday is not filed in the loop's index yet: not_filed", nst(world(cc=True)), ("not_filed", "2026-11-04", None)))
    cases.append(("note: yesterday is settled final already: settled", nst(note_world(ix4={"settled": True, "status": "final"})), ("settled", "2026-11-04", None)))
    cases.append(("note: yesterday is before the loop's first day: before_first_day", nst(note_world(first="2026-11-05")), ("before_first_day", "2026-11-04", None)))
    rd3, _, _ = run(note_world(**{LEDGER + "/verify/310": "down"}), now)
    cases.append(("note: /verify answers 5xx three times: unreadable, and the run is not touched (green)", (nst(note_world(**{LEDGER + "/verify/310": "down"}))[0], rd3["verdict"]), ("unreadable", "green")))
    cases.append(("note: an index without its shape gives unreadable, never an exception", nst(note_world(**{CHECK_RUNS + "index.json": (200, [1])}))[0], "unreadable"))
    ra3, ta3, _ = run(note_world("pending"), now, "schedule")
    rb3, tb3, _ = run(note_world("confirmed"), now.replace(hour=11, minute=20), "witness")
    cases.append(("note: the 04:05 run that saw pending and a witness at 11:20 that saw confirmed have the same day_sha256; only the notes differ",
                  (day_sha256(ra3) == day_sha256(rb3), nst(note_world("pending"))[0], nst(note_world("confirmed"))[0]), (True, "not_confirmed", "confirmed")))
    cases.append(("note: the result text is the same whatever the note says (the note is not in the result)", ta3 == run(note_world("confirmed"), now, "schedule")[1] and "notes" not in ra3, True))
    nt3 = notes(note_world(), now)
    cases.append(("note: the notes carry observed_at (the run's time) and say they are outside the day sha", (nt3["schema"], nt3["observed_at"], "day_sha256" in nt3["outside"], sorted(nt3)),
                  ("tooshi-notes-v0", "2026-11-05T04:05:00Z", True, ["items", "observed_at", "outside", "schema"])))
    bad = [n for n, got, want in cases if got != want]
    for n, got, want in cases:
        print(("  ok   " if got == want else "  NG   ") + n + ("" if got == want else " (got %r, want %r)" % (got, want)))
    print("tooshi selftest %d / %d %s" % (len(cases) - len(bad), len(cases), "all green" if not bad else "NG"))
    return 1 if bad else 0


# a fixed envelope (no signature that verifies); its leaf hash was computed with the runner's canonical_v0.mjs in node
VEC_ENVELOPE = '{"check":{"action_binding_digest":"3333333333333333333333333333333333333333333333333333333333333333","answered":true,"checked_at_height":100,"contract_sha256":"4444444444444444444444444444444444444444444444444444444444444444","decision":"pass","input_commit":"1111111111111111111111111111111111111111111111111111111111111111","marks":[],"nonce":"heartbeat-2026-11-03","rules_sha256":null,"schema":"furui-check-v1","scope_sha256":"2222222222222222222222222222222222222222222222222222222222222222","signed_at":"2026-11-03T03:17:09.123Z","stage_reached":4,"trace_sha256":"5555555555555555555555555555555555555555555555555555555555555555","unread":false},"schema":"furui-check-signed-v1","signatures":[{"alg":"ed25519","domain":"horizonshield.dev","key_id":"runner-1","sig":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="}],"signer":{"domain":"horizonshield.dev","key_url":"https://ledger.horizonshield.dev/.well-known/furui-check-keys.json"}}'


def witness_refusal(now, name):
    if not name or not name.strip():
        return "no_name"
    if (now.hour, now.minute) < DAY_READY:
        return "too_early"
    return None


def witness_main(now, name, vantage, ledger, dry):
    why = witness_refusal(now, name)
    if why == "no_name":
        print("witness: give a name (anonymous is allowed)")
        return 2
    if why == "too_early":
        print("witness: the day's checks are not all in before 03:47 UTC (01:05 batch, 03:17 heartbeat, 03:47 door call); run after it")
        return 2
    res, text, sha = run(http_get, now, "witness")
    for x in res["checks"]:
        print("%-8s %s: %s" % (x["state"], x["id"], x["why"]))
    rc = witness_record(res, name.strip(), vantage, now, tool_sha256())
    print("TOOSHI witness %s %s ok %d red %d notice %d not_yet %d day_sha256 %s (published day: %s)" % (res["checked_at"][:10], res["verdict"], res["counts"]["ok"], res["counts"]["red"], res["counts"]["notice"], res["counts"]["not_yet"], day_sha256(res), DAY_URL % res["checked_at"][:10]))
    if dry:
        print("record_canonical " + rc)
        print("dry run: nothing sent")
        return 0
    try:
        s, a = http_post(ledger.rstrip("/") + "/witness", {"record_canonical": rc})
    except (urllib.error.URLError, OSError, ValueError) as e:
        print("witness: the ledger did not answer: %s" % type(e).__name__)
        return 2
    a = a if isinstance(a, dict) else {}
    if s in (200, 201) and isinstance(a.get("sha"), str):
        print("WITNESS_FILED http %d sha %s status %s counted %s url %s" % (s, a["sha"], a.get("status"), a.get("counted"), a.get("url")))
        return 0
    print("WITNESS_REFUSED http %s %s %s" % (s, a.get("error"), a.get("why") or a.get("note") or ""))
    return 3


def main(argv):
    if argv == ["--selftest"]:
        return selftest()
    now, out, bodyf, notesf, trigger, fixed = datetime.datetime.now(datetime.timezone.utc), None, None, None, "manual", False
    wname, vantage, ledger, dry = None, "unspecified", LEDGER, False
    usage = "usage: tooshi_daily.py [--now T] [--trigger %s] [--out file] [--body file] [--notes file] | --witness NAME [--vantage V] [--dry-run] [--ledger URL] | --selftest" % "|".join(TRIGGERS[:4])
    it = iter(argv)
    try:
        for a in it:
            if a == "--now":
                now, fixed = datetime.datetime.strptime(next(it), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc), True
            elif a == "--out":
                out = next(it)
            elif a == "--body":
                bodyf = next(it)
            elif a == "--notes":
                notesf = next(it)
            elif a == "--trigger":
                trigger = next(it)
                if trigger not in TRIGGERS[:4]:
                    print(usage)
                    return 2
            elif a == "--witness":
                wname = next(it)
            elif a == "--vantage":
                vantage = next(it)
            elif a == "--ledger":
                ledger = next(it)
            elif a == "--dry-run":
                dry = True
            else:
                print(usage)
                return 2
    except StopIteration:
        print(usage)
        return 2
    if wname is not None:
        if fixed or out or bodyf or notesf or trigger != "manual":
            print("witness: --now, --out, --body, --notes and --trigger do not go with --witness (the answers are read now, by you)")
            return 2
        return witness_main(now, wname, vantage, ledger, dry)
    res, text, sha = run(http_get, now, trigger)
    if out:
        open(out, "w", encoding="utf-8").write(text + "\n")
    if bodyf:
        open(bodyf, "w", encoding="utf-8").write(body(res, sha))
    for x in res["checks"]:
        print("%-8s %s: %s" % (x["state"], x["id"], x["why"]))
    if notesf:
        nt = notes(http_get, now)
        open(notesf, "w", encoding="utf-8").write(json.dumps(nt, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n")
        for x in nt["items"]:
            print("note     %s %s %s: %s (outside day_sha256)" % (x["about"], x["day"], x["state"], x["why"]))
    print("TOOSHI %s %s ok %d red %d notice %d not_yet %d result_sha256 %s day_sha256 %s trigger %s" % (res["checked_at"], res["verdict"], res["counts"]["ok"], res["counts"]["red"], res["counts"]["notice"], res["counts"]["not_yet"], sha, day_sha256(res), trigger))
    return 1 if res["verdict"] == "red" else 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except SystemExit:
        raise
    except Exception as e:
        print("tooshi_daily failed: %s: %s" % (type(e).__name__, e))
        sys.exit(2)
