"""make_verify_vectors.py: writes verify_vectors.json, the shared vectors of `nenrin-verify furui-day` and
`nenrin-verify resume-admission` (Python, JavaScript, Go and Java ports run the same file and must give the same
verdicts). Each case is a small world (URL -> status and body) and the expected verdict, step states, codes and facts.

The key is a test key (seed sha256("nenrin-verify furui vectors test key")), listed as runner-1 in the world's keys
document; nothing here is the production key. The OpenTimestamps proofs are built here (sha256, append, prepend and a
Bitcoin attestation), plus one real proof of ledger entry 80 for the parser alone.

  python3 -I make_verify_vectors.py            write verify_vectors.json
  python3 -I make_verify_vectors.py --check    exit 1 if the file differs from what this writes
"""
import base64
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "sdk-python", "src"))
from nenrin_verify import furui_day as F  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: E402

LEDGER, FURUI = F.LEDGER, F.FURUI
SEED = hashlib.sha256(b"nenrin-verify furui vectors test key").digest()
SEED2 = hashlib.sha256(b"nenrin-verify furui vectors other key").digest()


def h(s):
    return hashlib.sha256(s.encode()).hexdigest()


def sign(seed, msg):
    return base64.b64encode(Ed25519PrivateKey.from_private_bytes(seed).sign(msg)).decode()


def pub(seed):
    from cryptography.hazmat.primitives import serialization
    k = Ed25519PrivateKey.from_private_bytes(seed).public_key()
    return base64.b64encode(k.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()


def envelope(day, i, seed=SEED, **chk):
    k = {"schema": "furui-check-v1", "input_commit": h("ic%s%d" % (day, i)), "rules_sha256": h("rules"), "scope_sha256": h("scope"),
         "action_binding_digest": h("abd%d" % i), "contract_sha256": h("contract"), "trace_sha256": h("trace%d" % i), "decision": "pass",
         "marks": [], "unread": False, "answered": True, "stage_reached": 4, "checked_at_height": 100 + i,
         "nonce": "heartbeat-%s" % day if i == 0 else h("nonce%d" % i)[:32], "signed_at": "%sT03:%02d:09.123Z" % (day, 17 + i)}
    k.update(chk)
    e = {"schema": "furui-check-signed-v1", "check": k, "signer": dict(F.SIGNER), "signatures": []}
    e["signatures"] = [{"alg": "ed25519", "domain": "horizonshield.dev", "key_id": "runner-1", "sig": sign(seed, F.envelope_message(e))}]
    return e


def varuint(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)


def ots(digest_hex, height, pending_only=False, salt="a"):
    d = bytes.fromhex(digest_hex)
    nonce = hashlib.sha256(("ots" + salt).encode()).digest()[:16]
    sib = hashlib.sha256(("sib" + salt).encode()).digest()
    b = bytearray(F.OTS_MAGIC + varuint(1) + b"\x08" + d)
    msg = d + nonce
    b += b"\xf0" + varuint(16) + nonce + b"\x08"
    msg = hashlib.sha256(msg).digest()
    if pending_only:
        uri = b"https://alice.btc.calendar.opentimestamps.org"
        b += b"\x00" + F.OTS_PENDING + varuint(len(uri) + 1) + varuint(len(uri)) + uri
        return bytes(b), None
    # a fork: one branch to a pending calendar, one to Bitcoin
    uri = b"https://bob.btc.calendar.opentimestamps.org"
    b += b"\xff" + b"\x00" + F.OTS_PENDING + varuint(len(uri) + 1) + varuint(len(uri)) + uri
    b += b"\xf1" + varuint(32) + sib + b"\x08"
    msg = hashlib.sha256(sib + msg).digest()
    p = varuint(height)
    b += b"\x00" + F.OTS_BITCOIN + varuint(len(p)) + p
    return bytes(b), msg[::-1].hex()


def batch_entry(n, rows, height, status="confirmed", salt="a", block_time="2026-11-05 01:12 UTC"):
    batch = {"schema": "nenrin-agreement-batch-v1", "anchored_at": "2026-11-05T00:30:01.000Z", "count": len(rows),
             "records": [{"canonical_sha256": s, "record_schema": rs, "verdict": "accepted", "verifier_version": v} for (s, rs, v) in sorted(rows)]}
    rc = json.dumps(batch, separators=(",", ":"))
    e = {"n": n, "work": "NENRIN agreement batch (%d records)" % len(rows), "claim_sha256": h(rc), "record_canonical": rc, "schema": "v0-plain",
         "created_at": "2026-11-05T00:30:02.000Z", "ots_status": status, "bitcoin_block": height if status == "confirmed" else None,
         "block_time": block_time if status == "confirmed" else None, "stamped_at": None, "anchored_by": "schedule"}
    return e


def jbody(o):
    return {"status": 200, "body": json.dumps(o, ensure_ascii=False, indent=1)}


def day_world(day="2026-11-03", n=5, entry=301, height=971234, seed=SEED, env_over=None, rec_over=None, keys=None, status="anchored", ots_status="confirmed", root_tail=""):
    envs = [envelope(day, i, seed=seed) for i in range(n)]
    for i, e in (env_over or {}).items():
        envs[i] = e
    lv = [F.leaf_hash(e) for e in envs]
    root = F.tree_hash(lv) + root_tail
    rec = {"schema": "furui-check-day-v0", "day": day, "signer": dict(F.SIGNER), "n": n, "tree": "rfc6962-sha256", "leaf": F.DAY_LEAF, "root": root,
           "first_height": 100, "last_height": 100 + n - 1, "late": 0, "clock_skew": 0, "publication": "public", "signatures": []}
    rec.update(rec_over or {})
    rec["signatures"] = [{"alg": "ed25519", "domain": "horizonshield.dev", "key_id": "runner-1", "sig": sign(seed, F.day_message(rec))}]
    rc = F.canonical(rec)
    rs = h(rc)
    w = {F.KEYS_URL: jbody(keys if keys is not None else {"schema": "furui-check-keys-v0", "use": "furui-check",
                                                         "keys": [{"key_id": "runner-1", "public_key_ed25519_b64": pub(SEED), "from_height": 0, "revoked_height": None}]}),
         LEDGER + "/furui-check-day/" + rs: jbody({"canonical_sha256": rs, "record_canonical": rc, "report": {"record_schema": "furui-check-day-v0", "verdict": "accepted"},
                                                   "status": status, "ledger_entry": entry if status == "anchored" else None,
                                                   "ledger_url": LEDGER + "/ledger/%d" % entry if status == "anchored" else None, "submitted_at": "2026-11-04T00:47:03.000Z"})}
    for i, e in enumerate(envs):
        w[FURUI + "/furui/day/%s/leaf/%d" % (day, i)] = jbody({"day": day, "index": i, "n": n, "root": root, "leaf_sha256": lv[i], "envelope_sha256": h(F.canonical(e)),
                                                               "envelope": e, "proof": F.audit_path(i, lv), "proof_kind": "rfc6962-audit-path",
                                                               "day_record": {"state": "accepted", "ledger_canonical_sha256": rs}, "kept_until": "2026-11-10"})
    other = (h("another record"), "a2a-admission-v0", "admission-intake 0.4.0")
    e = batch_entry(entry, [(rs, "furui-check-day-v0", "furui-check-day-intake 0.2.0"), other], height, status=ots_status)
    w[LEDGER + "/ledger/%d?format=json" % entry] = jbody(e)
    if ots_status == "confirmed":
        b, _m = ots(e["claim_sha256"], height)
        w[LEDGER + "/ledger/%d/ots" % entry] = {"status": 200, "body_b64": base64.b64encode(b).decode()}
    return w, rs, e


def admission_record(rp="shield.example", decision="admit", v04=True, **cont):
    c = {"rules": "a2a-content-check-v1", "input_commit": h("aic"), "check_sha256": h("acheck"), "rules_sha256": h("rules"), "scope_sha256": h("scope"),
         "decision": "pass", "marks": [], "unread": False, "answered": True, "checked": True}
    c.update(cont)
    r = {"schema": "a2a-admission-v0", "admission_id": h("aid"), "relying_party": {"domain": rp, "key_url": "https://%s/.well-known/keys.json" % rp},
         "decision": decision, "rules": {"version": "0.4" if v04 else "0.1"}, "publication": "public"}
    if v04:
        r["content"] = c
    return r


def resume_world(endpoint="https://agent.shield.example/a2a", rec=None, entry=280, height=971111, line_over=None, not_counted=None, listed=True,
                 ots_height=None, batch_rows=None, tamper_resume=False, discrepancies=None):
    rec = rec or admission_record()
    rc = json.dumps(rec, separators=(",", ":"))
    rs = h(rc)
    cb = rec.get("content") if rec["rules"]["version"] == "0.4" else None
    line = {"record_sha256": rs, "ledger_n": entry, "decision": rec["decision"], "content": None if cb is None else
            {"checked": cb["checked"], "decision": cb["decision"], "marks": cb["marks"], "rules_sha256": cb["rules_sha256"]}, "revoked": False}
    line.update(line_over or {})
    other = {"record_sha256": h("other admission"), "ledger_n": 200, "decision": "refuse", "content": None, "revoked": False}
    from urllib.parse import urlsplit
    origin = "https://" + urlsplit(endpoint).hostname
    resume = {"schema": "nenrin-resume-v1", "perma_id": origin, "measured_endpoint": endpoint, "agent_card_url": origin + "/.well-known/agent-card.json",
              "counts": {"PASS": 0, "FAIL": 0}, "witness_diversity": {"distinct_names": 0, "distinct_vantages": 0}, "measurements": [], "discrepancies": discrepancies or [],
              "rings": [], "agreements": [], "admissions": [other] + ([line] if listed else []),
              "freshness": {"last_measured": None, "oldest_measurement": None, "current_now": "2026-11-06T04:05:00Z", "period_days": 30}}
    resume["resume_sha256"] = h(F.canonical(resume))
    if tamper_resume:
        resume["admissions"][0]["decision"] = "admit"
    env = dict(resume, evaluated_at="2026-11-06T04:05:00Z", subject_responses=[], not_counted=not_counted or [],
               scan={"seq": 300, "entries_read": 300, "ceiling": 400, "out_of_scope": 0}, recompute={"how": "see the ledger"})
    w = {LEDGER + "/resume?endpoint=" + F._enc_component(endpoint): jbody(env),
         LEDGER + "/admission/" + rs: jbody({"canonical_sha256": rs, "record_canonical": rc, "report": {"record_schema": "a2a-admission-v0"}, "status": "anchored",
                                             "ledger_entry": entry, "ledger_url": LEDGER + "/ledger/%d" % entry, "submitted_at": "2026-11-04T03:47:10.000Z"})}
    rows = batch_rows if batch_rows is not None else [(rs, "a2a-admission-v0", "admission-intake 0.4.0"), (h("x"), "a2a-agreement-v1", "agreement-intake 0.3.0")]
    e = batch_entry(entry, rows, height, salt="r")
    w[LEDGER + "/ledger/%d?format=json" % entry] = jbody(e)
    b, _m = ots(e["claim_sha256"], ots_height or height, salt="r")
    w[LEDGER + "/ledger/%d/ots" % entry] = {"status": 200, "body_b64": base64.b64encode(b).decode()}
    return w, rs, endpoint


def edit(w, url, fn):
    o = json.loads(w[url]["body"])
    fn(o)
    w[url] = jbody(o)
    return w


cases = []


def add(name, command, args, world, want_state, want_step=None, want_code=None, note=""):
    c = {"name": name, "note": note, "command": command, "args": args, "world": world}
    got = F.summary(F.run_case(c))
    if want_state == "ok":
        assert got["verdict"] == "ok", (name, got)
    else:
        bad = [s for s in got["steps"] if s[1] in ("fail", "not_yet")]
        assert got["verdict"] == want_state and bad and bad[0][0] == want_step and bad[0][2] == want_code, (name, got)
    c["expect"] = got
    cases.append(c)


D = "2026-11-03"
DA = {"day": D}
# ---- furui-day: passing ----
w, rs, e = day_world()
add("day ok, leaf 0 (the heartbeat) of 5", "furui-day", dict(DA, leaf=0), w, "ok")
add("day ok, leaf 3 of 5", "furui-day", dict(DA, leaf=3), w, "ok")
add("day ok, leaf 4 of 5 (the last leaf)", "furui-day", dict(DA, leaf=4), w, "ok")
w1, _, _ = day_world(n=1, entry=302)
add("day ok, a day of one leaf (empty audit path)", "furui-day", dict(DA, leaf=0), w1, "ok")
w7, _, _ = day_world(n=7, entry=303, env_over={2: envelope(D, 2, decision="stop", marks=["off_topic"], answered=True), 5: envelope(D, 5, decision=None, unread=True, answered=False, rules_sha256=None, scope_sha256=None, stage_reached=0)})
add("day ok, leaf 5 of 7 (decision null, rules and scope null)", "furui-day", dict(DA, leaf=5), w7, "ok")
add("day ok, leaf 2 of 7 (stop, off_topic)", "furui-day", dict(DA, leaf=2), w7, "ok")
# ---- furui-day: not yet ----
add("not_yet 1: the day is still open (404 day_open)", "furui-day", {"day": "2026-11-09", "leaf": 0},
    {FURUI + "/furui/day/2026-11-09/leaf/0": {"status": 404, "body": '{"error":"day_open"}'}}, "not_yet", 1, "day_open")
add("fail 1: the day closed with no check (status empty), so there is no leaf", "furui-day", {"day": "2026-11-01", "leaf": 0},
    {FURUI + "/furui/day/2026-11-01/leaf/0": {"status": 404, "body": '{"error":"day_open"}'},
     FURUI + "/furui/day/2026-11-01/status": jbody({"day": "2026-11-01", "checks": 0, "status": {"state": "empty", "accepted": False, "n": 0, "root": None}})},
    "fail", 1, "day_closed_empty")
w, rs, e = day_world(status="pending_anchor")
add("not_yet 6: the day record waits for the ledger's batch (pending_anchor)", "furui-day", dict(DA, leaf=1), w, "not_yet", 6, "not_in_an_anchored_batch_yet")
w, rs, e = day_world(ots_status="pending")
add("not_yet 6: in a batch, the batch's OpenTimestamps proof not yet in Bitcoin", "furui-day", dict(DA, leaf=1), w, "not_yet", 6, "ots_not_confirmed")
# ---- furui-day: step 1 ----
w, rs, e = day_world()
L1 = FURUI + "/furui/day/%s/leaf/1" % D
add("fail 1: the envelope has one more field (check.note)", "furui-day", dict(DA, leaf=1), edit(dict(w), L1, lambda o: o["envelope"]["check"].__setitem__("note", "x")), "fail", 1, "envelope_shape:check_keys")
add("fail 1: a free text nonce", "furui-day", dict(DA, leaf=1), edit(dict(w), L1, lambda o: o["envelope"]["check"].__setitem__("nonce", "hello there")), "fail", 1, "envelope_shape:check_nonce")
add("fail 1: marks out of order", "furui-day", dict(DA, leaf=1), edit(dict(w), L1, lambda o: o["envelope"]["check"].__setitem__("marks", ["rule_conflict", "off_topic"])), "fail", 1, "envelope_shape:check_marks")
add("fail 1: the leaf is gone (410)", "furui-day", dict(DA, leaf=1), dict(w, **{L1: {"status": 410, "body": '{"error":"gone"}'}}), "fail", 1, "leaf_http_410")
add("fail 1: the runner answers another index", "furui-day", dict(DA, leaf=1), edit(dict(w), L1, lambda o: o.__setitem__("index", 2)), "fail", 1, "leaf_is_another_day_or_index")
# ---- step 2 ----
add("fail 2: the leaf sha256 is not the envelope's", "furui-day", dict(DA, leaf=1), edit(dict(w), L1, lambda o: o.__setitem__("leaf_sha256", h("x"))), "fail", 2, "leaf_sha256_is_not_the_envelope")
add("fail 2: the envelope was changed after it was hashed (decision)", "furui-day", dict(DA, leaf=1), edit(dict(w), L1, lambda o: o["envelope"]["check"].__setitem__("decision", "stop")), "fail", 2, "leaf_sha256_is_not_the_envelope")
add("fail 2: envelope_sha256 is not the envelope's", "furui-day", dict(DA, leaf=1), edit(dict(w), L1, lambda o: o.__setitem__("envelope_sha256", h("y"))), "fail", 2, "envelope_sha256_is_not_the_envelope")
# ---- step 3 ----
add("fail 3: the audit path reversed", "furui-day", dict(DA, leaf=1), edit(dict(w), L1, lambda o: o.__setitem__("proof", list(reversed(o["proof"])))), "fail", 3, "proof_does_not_rebuild_the_root")
add("fail 3: one hash short in the audit path", "furui-day", dict(DA, leaf=1), edit(dict(w), L1, lambda o: o.__setitem__("proof", o["proof"][:-1])), "fail", 3, "proof_does_not_rebuild_the_root")
add("fail 3: the runner's root is not the ledger record's", "furui-day", dict(DA, leaf=1), edit(dict(w), L1, lambda o: o.__setitem__("root", h("z"))), "fail", 3, "n_or_root_differs_from_the_ledger_record")
RU = LEDGER + "/furui-check-day/" + rs
add("fail 3: the ledger's bytes do not hash to the record sha", "furui-day", dict(DA, leaf=1), edit(dict(w), RU, lambda o: o.__setitem__("record_canonical", o["record_canonical"].replace('"late":0', '"late":1'))), "fail", 3, "day_record_bytes_do_not_hash_to_sha")
add("fail 3: the ledger does not serve the day record (404)", "furui-day", dict(DA, leaf=1), dict(w, **{RU: {"status": 404, "body": '{"error":"not_found"}'}}), "fail", 3, "day_record_http_404")
wx, rsx, _ = day_world(rec_over={"publication": "private"}, entry=304)
add("fail 3: the day record is not public (closed shape)", "furui-day", dict(DA, leaf=1), wx, "fail", 3, "day_record_shape")
# ---- step 4 ----
wx, _, _ = day_world(seed=SEED2, entry=305)
add("fail 4: day record and envelopes signed by another key than the listed runner-1", "furui-day", dict(DA, leaf=1), wx, "fail", 4, "day_record_signature")
wx, _, _ = day_world(entry=306, env_over={1: envelope(D, 1, seed=SEED2)})
add("fail 4: one envelope signed by another key", "furui-day", dict(DA, leaf=1), wx, "fail", 4, "envelope_signature")
# ---- step 5 ----
K = lambda **k: {"schema": "furui-check-keys-v0", "use": "furui-check", "keys": [dict({"key_id": "runner-1", "public_key_ed25519_b64": pub(SEED), "from_height": 0, "revoked_height": None}, **k)]}
wx, _, _ = day_world(entry=307, keys=K(from_height=101))
add("fail 5: the record's first height is below the key's from_height", "furui-day", dict(DA, leaf=1), wx, "fail", 5, "key_not_yet_valid")
wx, _, _ = day_world(entry=308, keys=K(revoked_height=103))
add("fail 5: the key was revoked at a height inside the day", "furui-day", dict(DA, leaf=1), wx, "fail", 5, "key_revoked")
wx, _, _ = day_world(entry=309, keys=K(key_id="runner-2"))
add("fail 5: runner-1 is not in the ledger's keys (4 has no key to check with)", "furui-day", dict(DA, leaf=1), wx, "fail", 5, "key_not_listed")
wx, _, _ = day_world(entry=310, rec_over={"signer": {"domain": "horizonshield.dev", "key_url": "https://horizonshield.dev/keys.json"}})
add("fail 5: the record names another keys document than the ledger's", "furui-day", dict(DA, leaf=1), wx, "fail", 5, "signer_is_not_the_ledger_keys")
wx, _, _ = day_world(entry=311, keys={"schema": "furui-check-keys-v0", "use": "issuer", "keys": []})
add("fail 5: the keys document is not for furui-check", "furui-day", dict(DA, leaf=1), wx, "fail", 5, "keys_not_furui_check")
# ---- step 6 ----
w, rs, e = day_world(entry=320)
EU = LEDGER + "/ledger/320?format=json"
add("fail 6: the batch entry's bytes do not hash to its claim", "furui-day", dict(DA, leaf=1), edit(dict(w), EU, lambda o: o.__setitem__("record_canonical", o["record_canonical"].replace('"count":2', '"count":3'))), "fail", 6, "entry_bytes_do_not_hash_to_claim")
w2, rs2, e2 = day_world(entry=321)
bad = batch_entry(321, [(h("someone else"), "furui-check-day-v0", "furui-check-day-intake 0.2.0")], 971234)
b, _ = ots(bad["claim_sha256"], 971234)
w2 = dict(w2, **{LEDGER + "/ledger/321?format=json": jbody(bad), LEDGER + "/ledger/321/ots": {"status": 200, "body_b64": base64.b64encode(b).decode()}})
add("fail 6: the batch entry does not list the day record", "furui-day", dict(DA, leaf=1), w2, "fail", 6, "record_not_in_entry")
b, _ = ots(h("another entry"), 971234)
add("fail 6: the OpenTimestamps proof is for another entry", "furui-day", dict(DA, leaf=1), dict(w, **{LEDGER + "/ledger/320/ots": {"status": 200, "body_b64": base64.b64encode(b).decode()}}), "fail", 6, "ots_digest_is_not_the_entry")
b, _ = ots(e["claim_sha256"], 971235)
add("fail 6: the proof reaches another block height than the entry says", "furui-day", dict(DA, leaf=1), dict(w, **{LEDGER + "/ledger/320/ots": {"status": 200, "body_b64": base64.b64encode(b).decode()}}), "fail", 6, "ots_height_is_not_the_entry_block")
b, _ = ots(e["claim_sha256"], 0, pending_only=True)
add("fail 6: the entry says confirmed, the proof has only a pending calendar", "furui-day", dict(DA, leaf=1), dict(w, **{LEDGER + "/ledger/320/ots": {"status": 200, "body_b64": base64.b64encode(b).decode()}}), "fail", 6, "ots_no_bitcoin_attestation")
b, _ = ots(e["claim_sha256"], 971234)
add("fail 6: a truncated proof", "furui-day", dict(DA, leaf=1), dict(w, **{LEDGER + "/ledger/320/ots": {"status": 200, "body_b64": base64.b64encode(b[:-3]).decode()}}), "fail", 6, "ots_parse")

# ---- 64 hex and the other closed strings, exactly: nothing before or after, lowercase, ASCII digits (0.8.1) ----
# Python's re.match with a final "$" also passes one trailing "\n", and bytes.fromhex skips whitespace, so before 0.8.1
# an audit path hash with a trailing line feed rebuilt the root in Python and nowhere else. Each value below is signed
# where it sits, so the only thing that can refuse it is the shape check.
w, rs, e = day_world(entry=330)
L1 = FURUI + "/furui/day/%s/leaf/1" % D
for tail, what in (("\n", "a trailing line feed"), ("\r", "a trailing carriage return"), (" ", "a trailing space"), ("\r\n", "a trailing CR LF")):
    add("fail 3: an audit path hash with %s" % what, "furui-day", dict(DA, leaf=1), edit(dict(w), L1, lambda o, t=tail: o["proof"].__setitem__(0, o["proof"][0] + t)), "fail", 3, "proof_shape")
add("fail 3: an audit path hash with a leading line feed", "furui-day", dict(DA, leaf=1), edit(dict(w), L1, lambda o: o["proof"].__setitem__(0, "\n" + o["proof"][0])), "fail", 3, "proof_shape")
add("fail 3: an audit path hash in uppercase", "furui-day", dict(DA, leaf=1), edit(dict(w), L1, lambda o: o["proof"].__setitem__(0, o["proof"][0].upper())), "fail", 3, "proof_shape")
add("fail 3: the leaf names its day record sha with a trailing line feed", "furui-day", dict(DA, leaf=1),
    edit(dict(w), L1, lambda o: o["day_record"].__setitem__("ledger_canonical_sha256", o["day_record"]["ledger_canonical_sha256"] + "\n")), "fail", 3, "no_day_record")
wx, _, _ = day_world(entry=331, root_tail="\n")
add("fail 3: the signed day record's root has a trailing line feed", "furui-day", dict(DA, leaf=1), wx, "fail", 3, "day_record_shape")
wx, _, _ = day_world(entry=332, rec_over={"day": D + "\n"})
add("fail 3: the signed day record's day has a trailing line feed", "furui-day", dict(DA, leaf=1), wx, "fail", 3, "day_record_shape")
wx, _, _ = day_world(entry=333, rec_over={"day": "\uff12\uff10\uff12\uff16-11-03"})
add("fail 3: the signed day record's day in fullwidth digits", "furui-day", dict(DA, leaf=1), wx, "fail", 3, "day_record_shape")
for k, v, what in (("input_commit", h("ic") + "\n", "with a trailing line feed"), ("rules_sha256", h("rules") + "\n", "with a trailing line feed"),
                   ("contract_sha256", h("contract").upper(), "in uppercase"), ("trace_sha256", " " + h("trace1"), "with a leading space"),
                   ("nonce", h("nonce1")[:32] + "\n", "with a trailing line feed"), ("signed_at", D + "T03:18:09.123Z\n", "with a trailing line feed")):
    wx, _, _ = day_world(entry=334, env_over={1: envelope(D, 1, **{k: v})})
    add("fail 1: a signed envelope, check.%s %s" % (k, what), "furui-day", dict(DA, leaf=1), wx, "fail", 1, "envelope_shape:check_" + k)
ex = envelope(D, 1)
ex["signatures"][0]["sig"] += "\n"
wx, _, _ = day_world(entry=335, env_over={1: ex})
add("fail 1: the envelope's signature with a trailing line feed", "furui-day", dict(DA, leaf=1), wx, "fail", 1, "envelope_shape:signature")
DW = "\uff12\uff10\uff12\uff16-11-03"
wx, _, _ = day_world(day=DW, entry=336)
add("fail 1: a day in fullwidth digits, the heartbeat nonce", "furui-day", {"day": DW, "leaf": 0}, wx, "fail", 1, "envelope_shape:check_nonce")
add("fail 1: a day in fullwidth digits, signed_at", "furui-day", {"day": DW, "leaf": 1}, wx, "fail", 1, "envelope_shape:check_signed_at")

# ---- resume-admission ----
w, rs, ep = resume_world()
add("resume ok: a 0.4 admission with its content block", "resume-admission", {"endpoint": ep, "record_sha256": rs}, w, "ok")
w, rs, ep = resume_world(discrepancies=[{"note": "\u00e9 \U0001F600 \u2028 \u007f \u0001 \" \\ \t"}], entry=282)
add("resume ok: non-ASCII, an astral character and control characters inside the hashed resume", "resume-admission", {"endpoint": ep, "record_sha256": rs}, w, "ok")
w, rs, ep = resume_world(rec=admission_record(v04=False, decision="refuse"), entry=281)
add("resume ok: a 0.1 admission (content null)", "resume-admission", {"endpoint": ep, "record_sha256": rs}, w, "ok")
w, rs, ep = resume_world(rec=admission_record(rp="example.org"), endpoint="https://example.org/")
add("resume ok: the relying party is the endpoint host itself", "resume-admission", {"endpoint": ep, "record_sha256": rs}, w, "ok")
w, rs, ep = resume_world(listed=False, not_counted=[{"n": 280, "record_sha256": None, "why": "not_yet_anchored", "kind": "admission"}])
w = edit(w, LEDGER + "/resume?endpoint=" + F._enc_component(ep), lambda o: o["not_counted"][0].__setitem__("record_sha256", rs))
add("resume not_yet 2: batched, not anchored yet (not_counted)", "resume-admission", {"endpoint": ep, "record_sha256": rs}, w, "not_yet", 2, "not_anchored_yet")
w, rs, ep = resume_world(tamper_resume=True)
add("resume fail 1: a line changed after resume_sha256 was computed", "resume-admission", {"endpoint": ep, "record_sha256": rs}, w, "fail", 1, "resume_sha256_does_not_recompute")
w, rs, ep = resume_world(listed=False)
add("resume fail 2: the record is not listed and not in not_counted", "resume-admission", {"endpoint": ep, "record_sha256": rs}, w, "fail", 2, "not_listed")
w, rs, ep = resume_world(line_over={"note": "x"})
add("resume fail 2: the line carries a field outside the closed set", "resume-admission", {"endpoint": ep, "record_sha256": rs}, w, "fail", 2, "line_not_closed")
w, rs, ep = resume_world(line_over={"ledger_n": 0})
add("resume fail 2: the line's ledger_n is not a positive integer", "resume-admission", {"endpoint": ep, "record_sha256": rs}, w, "fail", 2, "line_not_closed")
w, rs, ep = resume_world(line_over={"decision": "escalate"})
add("resume fail 3: the line's decision is not the record's", "resume-admission", {"endpoint": ep, "record_sha256": rs}, w, "fail", 3, "decision_differs")
w, rs, ep = resume_world(line_over={"content": {"checked": True, "decision": "stop", "marks": ["off_topic"], "rules_sha256": h("rules")}})
add("resume fail 3: the line's content is not the record's content block", "resume-admission", {"endpoint": ep, "record_sha256": rs}, w, "fail", 3, "content_differs")
w, rs, ep = resume_world(rec=admission_record(rp="other.example"))
add("resume fail 3: the record's relying party is another host", "resume-admission", {"endpoint": ep, "record_sha256": rs}, w, "fail", 3, "relying_party_is_not_the_endpoint_host")
w, rs, ep = resume_world()
add("resume fail 3: the stored bytes do not hash to record_sha256", "resume-admission", {"endpoint": ep, "record_sha256": rs},
    edit(dict(w), LEDGER + "/admission/" + rs, lambda o: o.__setitem__("record_canonical", o["record_canonical"].replace('"admit"', '"refuse"'))), "fail", 3, "admission_bytes_do_not_hash_to_sha")
w, rs, ep = resume_world(batch_rows=[(h("y"), "a2a-admission-v0", "admission-intake 0.4.0")])
add("resume fail 4: the batch entry does not list the record", "resume-admission", {"endpoint": ep, "record_sha256": rs}, w, "fail", 4, "record_not_in_entry")
w, rs, ep = resume_world(ots_height=971112)
add("resume fail 5: the proof reaches another block height", "resume-admission", {"endpoint": ep, "record_sha256": rs}, w, "fail", 5, "ots_height_is_not_the_entry_block")
w, rs, ep = resume_world()
add("resume fail 5: the entry the Resume lists is not anchored", "resume-admission", {"endpoint": ep, "record_sha256": rs},
    edit(dict(w), LEDGER + "/ledger/280?format=json", lambda o: o.update({"ots_status": "pending", "bitcoin_block": None, "block_time": None})), "fail", 5, "entry_listed_by_the_resume_is_not_anchored")

w, rs, ep = resume_world(line_over={"content": {"checked": True, "decision": "pass", "marks": [], "rules_sha256": h("rules") + "\n"}})
add("resume fail 2: the line's content rules_sha256 has a trailing line feed", "resume-admission", {"endpoint": ep, "record_sha256": rs}, w, "fail", 2, "line_not_closed")
w, rs, ep = resume_world(line_over={"content": {"checked": True, "decision": "pass", "marks": [], "rules_sha256": h("rules").upper()}})
add("resume fail 2: the line's content rules_sha256 in uppercase", "resume-admission", {"endpoint": ep, "record_sha256": rs}, w, "fail", 2, "line_not_closed")

# ---- the parser alone, on a real proof (ledger entry 80, anchored 2026-10-11) ----
real = os.path.join(HERE, "ots_entry80.ots.b64")
REAL = None
if os.path.exists(real):
    rb = base64.b64decode(open(real).read())
    d, btc, pend = F.ots_parse(rb)
    REAL = {"name": "OpenTimestamps parser: the real proof of ledger entry 80", "command": "ots-parse", "args": {"body_b64": base64.b64encode(rb).decode()},
            "expect": {"digest": d.hex(), "bitcoin": [[x, m] for (x, m) in btc], "pending": pend}}

doc = {"schema": "nenrin-furui-verify-vectors-v1",
       "about": "Shared vectors of nenrin-verify furui-day and resume-admission. Python, JavaScript, Go and Java run this file and must give the same expect. "
                "The keys document in each world lists a test key as runner-1; no production key or record is used, except the real OpenTimestamps proof of ledger entry 80 for the parser.",
       "summary_form": "expect = {verdict, steps: [[step, state, code]], facts}; state is ok, fail, not_yet or skipped; steps after the first fail or not_yet are skipped",
       "cases": cases + ([REAL] if REAL else [])}
text = json.dumps(doc, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
out = os.path.join(HERE, "verify_vectors.json")
# imported (make_bitcoin_header_vectors.py uses the worlds above): nothing is written
if __name__ == "__main__":
    if sys.argv[1:] == ["--check"]:
        same = os.path.exists(out) and open(out, encoding="utf-8").read() == text
        print("verify_vectors.json %s (%d cases)" % ("is what this writes" if same else "DIFFERS from what this writes", len(doc["cases"])))
        sys.exit(0 if same else 1)
    with open(out, "w", encoding="utf-8") as f:
        f.write(text)
    print("wrote verify_vectors.json, %d cases, sha256 %s" % (len(doc["cases"]), hashlib.sha256(text.encode()).hexdigest()))
