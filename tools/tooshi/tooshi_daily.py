"""tooshi_daily.py: TOOSHI, the daily end to end check of the content check chain (sieve, admission, ledger, door,
Resume, runner, the daily root, the heartbeat). It reads public endpoints only, holds no secret and writes nothing.

    python3 -I -B tools/tooshi/tooshi_daily.py [--now 2026-11-03T04:05:00Z] [--out result.json] [--body body.md]
    python3 -I -B tools/tooshi/tooshi_daily.py --selftest

Each check ends in one of four states:
    ok        checked today, and it holds
    red       checked today, and it does not hold (or the endpoint did not answer after three tries)
    notice    holds, with something to know (a day that hit a spending cap; a day with no checks)
    not_yet   cannot be checked yet; counted and named, never reported as ok
The verdict is red if any check is red; green only if every check is ok or notice; otherwise not_all_checked.
Exit 0 for green or not_all_checked, 1 for red, 2 if this script itself failed.
The result is canonical JSON (sorted keys, no spaces); its sha256 is printed on the last line.
"""
import datetime, hashlib, json, sys, time, urllib.error, urllib.request

RUNNER = "https://furui.horizonshield.dev"
LEDGER = "https://ledger.horizonshield.dev"
DOOR_POLICY = "https://hs-gateway.oga-surf-project.workers.dev/seki"
CAPS = {"request_usd": 0.4, "day_usd": 5.0, "party_per_day": 100}
FIRST_HEARTBEAT_DAY = "2026-11-03"   # the runner's first heartbeat scene runs at 03:17 UTC that day
FIRST_CLOSED_DAY = "2026-11-02"      # the first UTC day the runner 0.2.0 closes (its status exists from the next day)
HEARTBEAT_AFTER = (3, 17)            # the cron 17 3 * * *
HEARTBEAT_EXPECT = {"decision": "pass", "answered": True, "marks": []}  # the fixed in scope question of the scene
UA = {"user-agent": "tooshi-daily/0.1", "accept": "application/json"}


class Unreachable(Exception):
    pass


def http_get(url, tries=3, wait=10, timeout=30):
    """(status, parsed JSON). A network failure or a 5xx is tried three times; then Unreachable."""
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.status, json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code < 500:
                try:
                    return e.code, json.loads(e.read().decode("utf-8"))
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
    pol = ((p.get("furui") or {}).get("policy") or {})
    door_rules = pol.get("rules_sha256")
    bad = []
    if h.get("key_id") != "runner-1" or listed != [h.get("public_key_ed25519_b64")] or not h.get("public_key_ed25519_b64"):
        bad.append("the runner's public half is not the one the ledger lists for runner-1")
    if h.get("caps") != CAPS:
        bad.append("caps are %s, not %s" % (json.dumps(h.get("caps"), sort_keys=True), json.dumps(CAPS, sort_keys=True)))
    if h.get("anthropic_key_set") is not True:
        bad.append("the model key is not set")
    if (h.get("rules_sha256") or None) != (door_rules or None):
        bad.append("rules_sha256 differs: runner %s, door %s" % (h.get("rules_sha256"), door_rules))
    facts = {"runner": h.get("runner"), "rules_sha256": h.get("rules_sha256"), "door_required": pol.get("required")}
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


NOT_YET = [
    ("1_sieve_admission", "the door does not call the runner while policy.furui.required is false, so no admission carries a content block yet"),
    ("2_admission_ledger", "no admission with a content block has been sent to the ledger yet"),
    ("3_ledger_door", "the door reads no content check record from the ledger yet"),
    ("4_door_resume", "the Resume carries no content check yet"),
]


def run(get, now):
    checks = [c(i, "not_yet", why) for i, why in NOT_YET]
    checks += [check_door_runner(get), check_day_root(get, now), check_heartbeat(get, now)]
    checks.sort(key=lambda x: x["id"])
    counts = {k: sum(1 for x in checks if x["state"] == k) for k in ("ok", "red", "notice", "not_yet")}
    verdict = "red" if counts["red"] else ("green" if counts["not_yet"] == 0 else "not_all_checked")
    res = {"schema": "tooshi-daily-v0", "checked_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "verdict": verdict, "counts": counts, "checks": checks}
    text = json.dumps(res, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return res, text, hashlib.sha256(text.encode("utf-8")).hexdigest()


def body(res, sha):
    lines = ["TOOSHI %s: %s" % (res["checked_at"][:10], res["verdict"]), "",
             "ok %(ok)d, red %(red)d, notice %(notice)d, not yet %(not_yet)d" % res["counts"], ""]
    for x in res["checks"]:
        lines.append("- %s: %s. %s" % (x["id"], x["state"], x["why"]))
    lines += ["", "result sha256 " + sha]
    return "\n".join(lines) + "\n"


def selftest():
    now = datetime.datetime(2026, 11, 5, 4, 5, tzinfo=datetime.timezone.utc)
    PUB = "A" * 43 + "="
    sha = "ab" * 32

    def world(**over):
        w = {
            RUNNER + "/health": (200, {"runner": "hs-furui-runner 0.2.0", "key_id": "runner-1", "public_key_ed25519_b64": PUB, "rules_sha256": None, "caps": dict(CAPS), "anthropic_key_set": True}),
            LEDGER + "/.well-known/furui-check-keys.json": (200, {"use": "furui-check", "keys": [{"key_id": "runner-1", "public_key_ed25519_b64": PUB, "from_height": 0, "revoked_height": None}]}),
            DOOR_POLICY: (200, {"furui": {"policy": {"required": False}}}),
            RUNNER + "/furui/heartbeat": (200, {"at": "2026-11-05T03:17:09.000Z", "ok": True, "decision": "pass", "answered": True, "marks": [], "capped": False, "spent_usd": 0.03}),
            RUNNER + "/furui/day/2026-11-03/status": (200, {"day": "2026-11-03", "status": {"state": "accepted", "accepted": True, "refused": False, "http": 201, "attempts": 1, "ledger_canonical_sha256": sha}}),
            LEDGER + "/furui-check-day/" + sha: (200, {"canonical_sha256": sha, "status": "anchored", "ledger_entry": 250}),
            LEDGER + "/ledger/250?format=json": (200, {"n": 250, "created_at": "2026-11-05T00:30:40.000Z", "record_canonical": '{"records":[{"canonical_sha256":"%s"}]}' % sha}),
        }
        w.update(over)

        def get(url):
            v = w.get(url, (404, {"error": "not_found"}))
            if v == "down":
                raise Unreachable(url + ": http 503 after 3 tries")
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
    r1 = run(world(), now)[2]; r2 = run(world(), now)[2]
    cases.append(("the result sha is the same for the same day and answers", r1 == r2 and len(r1) == 64, True))
    bad = [n for n, got, want in cases if got != want]
    for n, got, want in cases:
        print(("  ok   " if got == want else "  NG   ") + n + ("" if got == want else " (got %r, want %r)" % (got, want)))
    print("tooshi selftest %d / %d %s" % (len(cases) - len(bad), len(cases), "all green" if not bad else "NG"))
    return 1 if bad else 0


def main(argv):
    if argv == ["--selftest"]:
        return selftest()
    now, out, bodyf = datetime.datetime.now(datetime.timezone.utc), None, None
    it = iter(argv)
    for a in it:
        if a == "--now":
            now = datetime.datetime.strptime(next(it), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
        elif a == "--out":
            out = next(it)
        elif a == "--body":
            bodyf = next(it)
        else:
            print("usage: tooshi_daily.py [--now T] [--out file] [--body file] | --selftest")
            return 2
    res, text, sha = run(http_get, now)
    if out:
        open(out, "w", encoding="utf-8").write(text + "\n")
    if bodyf:
        open(bodyf, "w", encoding="utf-8").write(body(res, sha))
    for x in res["checks"]:
        print("%-8s %s: %s" % (x["state"], x["id"], x["why"]))
    print("TOOSHI %s %s ok %d red %d notice %d not_yet %d result_sha256 %s" % (res["checked_at"], res["verdict"], res["counts"]["ok"], res["counts"]["red"], res["counts"]["notice"], res["counts"]["not_yet"], sha))
    return 1 if res["verdict"] == "red" else 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except SystemExit:
        raise
    except Exception as e:
        print("tooshi_daily failed: %s: %s" % (type(e).__name__, e))
        sys.exit(2)
