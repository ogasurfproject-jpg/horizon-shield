"""tooshi_publish.py: keep TOOSHI's daily result where anyone can read it (tooshi/ in the repository, served by Pages at
/tooshi/ and at once by raw.githubusercontent.com), and decide whether a scheduled run has anything to do.

    python3 -I -B tools/tooshi/tooshi_publish.py decide --trigger schedule|second|dispatch --now 2026-11-03T04:35:00Z --have-day 0|1 [--day-file F]
        prints "run <why>" or "skip <why>" and exits 0. A scheduled run (schedule, second) skips when the day already has a
        published result, or when it starts before 03:47 UTC (a schedule so late that it ran on the next day would read the
        next day before its checks are in, and would then stop that day's own run). A dispatch always runs.
        One exception (2026-11-05): the second run reads the day again when the published day (--day-file, the
        tooshi/days/<day>.json on main) was written by the schedule run and still counts a not_yet. The day's
        Bitcoin confirmation is often written down a few minutes after 04:05 (11-05: confirmed at 03:31, recorded by the
        04:17 stamp), so 3 and 4b read not_yet at 04:05. The second run's result replaces the day like a dispatch does
        and the 04:05 result stays under earlier; a check still not ready stays not_yet. The day is read again once:
        a day written by the second run or by hand is not read again by a scheduled run.
    python3 -I -B tools/tooshi/tooshi_publish.py write --result tooshi_result.json [--notes tooshi_notes.json] --run-url URL --dir tooshi
        checks that the file is the canonical result tooshi_daily.py wrote, then writes
          tooshi/days/<day>.json   the day: verdict, counts, each check's state and why, the exact result bytes
                                   (result_canonical), result_sha256, day_sha256, trigger, checked_at, run_url, and the
                                   earlier runs of the same day (a dispatch after the scheduled run keeps it here);
                                   with --notes, the run's notes (tooshi_daily.py --notes, tooshi-notes-v0, observed_at
                                   equal to the result's checked_at) under notes. The notes are outside result_canonical,
                                   so they change neither result_sha256 nor day_sha256 (added 2026-11-05).
          tooshi/latest.json       the newest day, the same bytes as its day file
          tooshi/index.json        one line per day, newest first
        and prints "TOOSHI_KEPT <day> <result_sha256> <day_sha256>".
    python3 -I -B tools/tooshi/tooshi_publish.py --selftest
Standard library only. Writes only under --dir.
"""
import datetime, hashlib, json, os, re, shutil, sys, tempfile

DAY_READY = (3, 47)
SCHEDULED = ("schedule", "second")
TRIGGERS = ("schedule", "second", "dispatch", "manual")
RECIPE = ("result_sha256 = sha256 of the UTF-8 bytes of result_canonical. day_sha256 = sha256 of the same JSON with checked_at "
          "and trigger removed, schema set to tooshi-day-view-v0 and day added, keys sorted, separators , and : without spaces, "
          "UTF-8 (tools/tooshi/tooshi_daily.py day_view). Any run of the same day after 03:47 UTC that reads the same answers "
          "gets the same day_sha256. notes, when present, are what that run saw at notes.observed_at; they are not in "
          "result_canonical, so neither sha covers them.")
WITNESS = "python3 -I -B tools/tooshi/tooshi_daily.py --witness <your name> [--vantage <your network>] [--dry-run]"
DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def canon(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha(t):
    return hashlib.sha256(t.encode("utf-8")).hexdigest()


def day_sha256(res):
    v = {k: x for k, x in res.items() if k not in ("checked_at", "trigger")}
    v["schema"] = "tooshi-day-view-v0"
    v["day"] = res["checked_at"][:10]
    return sha(canon(v))


def not_yet_of(day):
    """the not_yet count and ids of a published day file (tooshi-day-v0), or (0, []) when it cannot be read"""
    if not isinstance(day, dict):
        return 0, []
    n = (day.get("counts") or {}).get("not_yet")
    ids = [c.get("id") for c in (day.get("checks") or []) if isinstance(c, dict) and c.get("state") == "not_yet"]
    return (n if isinstance(n, int) and n > 0 else 0), ids


def decide(trigger, now, have_day, day=None):
    if trigger not in TRIGGERS:
        return "skip", "unknown trigger %s" % trigger
    if trigger not in SCHEDULED:
        return "run", "%s always runs; an earlier result of the day is kept under earlier" % trigger
    if (now.hour, now.minute) < DAY_READY:
        return "skip", "a %s run that starts at %s, before 03:47 UTC, is a late run of the day before; it is not recorded" % (trigger, now.strftime("%H:%M"))
    if have_day:
        d = now.strftime("%Y-%m-%d")
        n, ids = not_yet_of(day)
        if trigger == "second" and isinstance(day, dict) and day.get("day") == d and day.get("trigger") == "schedule" and n:
            return "run", "%s was published by the schedule run with %d not_yet (%s); the second run reads the day again (what is still not ready stays not_yet, the first result is kept under earlier)" % (d, n, ", ".join(str(x) for x in ids))
        if trigger == "second" and isinstance(day, dict) and day.get("day") == d and n:
            return "skip", "%s already has a published result by the %s run (%d not_yet); the day is read again once, by the second run after the schedule run" % (d, day.get("trigger"), n)
        return "skip", "%s already has a published result; the %s run does nothing" % (d, trigger)
    return "run", "%s has no published result yet" % now.strftime("%Y-%m-%d")


def read_result(path):
    with open(path, "rb") as f:
        raw = f.read()
    text = raw.decode("utf-8")
    if text.endswith("\n"):
        text = text[:-1]
    res = json.loads(text)
    if not isinstance(res, dict) or res.get("schema") != "tooshi-daily-v0":
        raise ValueError("not a tooshi-daily-v0 result")
    if canon(res) != text:
        raise ValueError("the result file is not the canonical bytes tooshi_daily.py writes")
    for k in ("checked_at", "trigger", "verdict", "counts", "checks"):
        if k not in res:
            raise ValueError("the result has no " + k)
    if res["trigger"] not in TRIGGERS:
        raise ValueError("unknown trigger " + str(res["trigger"]))
    if not re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$", res["checked_at"]):
        raise ValueError("checked_at is not a time")
    return res, text


def _write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".tooshi.")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(json.dumps(obj, sort_keys=True, indent=1, ensure_ascii=False) + "\n")
    os.replace(tmp, path)


def _load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None


def read_notes(path, res):
    """the run's notes (tooshi_daily.py --notes): a tooshi-notes-v0 object of the same run, kept beside the result"""
    with open(path, encoding="utf-8") as f:
        nt = json.load(f)
    if not isinstance(nt, dict) or nt.get("schema") != "tooshi-notes-v0" or not isinstance(nt.get("items"), list):
        raise ValueError("not tooshi-notes-v0 notes")
    if nt.get("observed_at") != res["checked_at"]:
        raise ValueError("the notes are not of this run (observed_at %s, checked_at %s)" % (nt.get("observed_at"), res["checked_at"]))
    return nt


def write(result_path, run_url, out_dir, notes_path=None):
    res, text = read_result(result_path)
    nt = read_notes(notes_path, res) if notes_path else None
    d = res["checked_at"][:10]
    rs, ds = sha(text), day_sha256(res)
    dayf = os.path.join(out_dir, "days", d + ".json")
    old = _load(dayf)
    earlier = []
    if isinstance(old, dict):
        earlier = list(old.get("earlier") or [])
        e = {k: old.get(k) for k in ("checked_at", "trigger", "result_sha256", "day_sha256", "run_url", "verdict")}
        if "notes" in old:
            e["notes"] = old["notes"]
        earlier.append(e)
    day = {
        "schema": "tooshi-day-v0", "day": d, "verdict": res["verdict"], "counts": res["counts"],
        "checks": [{"id": x.get("id"), "state": x.get("state"), "why": x.get("why")} for x in res["checks"]],
        "result_canonical": text, "result_sha256": rs, "day_sha256": ds,
        "trigger": res["trigger"], "checked_at": res["checked_at"], "run_url": run_url, "earlier": earlier,
        "recipe": RECIPE, "witness": WITNESS,
    }
    if nt is not None:
        day["notes"] = nt   # outside result_canonical: neither result_sha256 nor day_sha256 covers it
    _write(dayf, day)
    idxf = os.path.join(out_dir, "index.json")
    idx = _load(idxf) or {}
    rows = [r for r in (idx.get("days") or []) if isinstance(r, dict) and r.get("day") != d]
    rows.append({"day": d, "verdict": res["verdict"], "counts": res["counts"], "result_sha256": rs, "day_sha256": ds,
                 "trigger": res["trigger"], "run_url": run_url, "path": "days/%s.json" % d, "runs": len(earlier) + 1})
    rows.sort(key=lambda r: r["day"], reverse=True)
    _write(idxf, {"schema": "tooshi-index-v0", "latest": rows[0]["day"], "days": rows, "recipe": RECIPE})
    latest = _load(os.path.join(out_dir, "days", rows[0]["day"] + ".json"))
    _write(os.path.join(out_dir, "latest.json"), latest)
    return d, rs, ds


def selftest():
    cases = []
    T = lambda s: datetime.datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
    cases.append(("schedule, no day yet: run", decide("schedule", T("2026-11-04T04:05:00Z"), False)[0], "run"))
    cases.append(("second, no day yet (the 04:05 run did not come): run", decide("second", T("2026-11-04T04:35:00Z"), False)[0], "run"))
    cases.append(("second, the day is published: skip", decide("second", T("2026-11-04T04:35:00Z"), True)[0], "skip"))
    cases.append(("schedule late by hours, the day was dispatched by hand: skip", decide("schedule", T("2026-11-03T11:50:14Z"), True)[0], "skip"))
    cases.append(("a schedule so late it starts on the next day before 03:47: skip", decide("schedule", T("2026-11-05T01:10:00Z"), False)[0], "skip"))
    cases.append(("dispatch with the day published: run (the earlier one is kept)", decide("dispatch", T("2026-11-04T09:00:00Z"), True)[0], "run"))
    cases.append(("dispatch before 03:47: run (by hand, the person sees not_yet)", decide("dispatch", T("2026-11-04T02:00:00Z"), False)[0], "run"))
    cases.append(("an unknown trigger: skip", decide("nightly", T("2026-11-04T04:05:00Z"), False)[0], "skip"))
    # the second run reads the day again when the schedule run left a not_yet (2026-11-05: 3 and 4b at 04:05)
    def pub(d, trigger, not_yet, ids=("3_ledger_settle", "4b_resume_agreement")):
        return {"schema": "tooshi-day-v0", "day": d, "trigger": trigger, "counts": {"ok": 8 - not_yet, "red": 0, "notice": 0, "not_yet": not_yet},
                "checks": [{"id": x, "state": "not_yet" if i < not_yet else "ok", "why": ""} for i, x in enumerate(list(ids) + ["5_x"] * 8)][:8]}
    T35 = T("2026-11-05T04:35:00Z")
    r = decide("second", T35, True, pub("2026-11-05", "schedule", 2))
    cases.append(("second, the schedule run left 2 not_yet: run, naming them", (r[0], "2 not_yet (3_ledger_settle, 4b_resume_agreement)" in r[1]), ("run", True)))
    cases.append(("second, the schedule run left no not_yet: skip", decide("second", T35, True, pub("2026-11-05", "schedule", 0))[0], "skip"))
    cases.append(("second, the day was already read again by a second run: skip (once a day)", decide("second", T("2026-11-05T11:40:00Z"), True, pub("2026-11-05", "second", 2))[0], "skip"))
    cases.append(("second, the day was run by hand: skip", decide("second", T35, True, pub("2026-11-05", "dispatch", 2))[0], "skip"))
    cases.append(("schedule (late) with a not_yet day: skip (only the second run reads again)", decide("schedule", T("2026-11-05T11:50:00Z"), True, pub("2026-11-05", "schedule", 2))[0], "skip"))
    cases.append(("second with a not_yet day file of another day: skip", decide("second", T35, True, pub("2026-11-04", "schedule", 2))[0], "skip"))
    cases.append(("second, the day file could not be read (none given): skip as before", decide("second", T35, True, None)[0], "skip"))
    cases.append(("second before 03:47 with a not_yet day: skip", decide("second", T("2026-11-06T01:00:00Z"), True, pub("2026-11-06", "schedule", 2))[0], "skip"))
    tmp = tempfile.mkdtemp(prefix="tooshi_publish_")
    def result(at, trigger, ok=4, verdict="not_all_checked"):
        r = {"schema": "tooshi-daily-v0", "checked_at": at, "trigger": trigger, "verdict": verdict, "counts": {"ok": ok, "red": 0, "notice": 0, "not_yet": 8 - ok},
             "checks": [{"id": "1_sieve_admission", "state": "not_yet", "why": "wé", "facts": {}}]}
        p = os.path.join(tmp, "r_%s_%s.json" % (at.replace(":", ""), trigger))
        with open(p, "w", encoding="utf-8") as f:
            f.write(canon(r) + "\n")
        return p, r
    out = os.path.join(tmp, "tooshi")
    p1, r1 = result("2026-11-04T04:07:48Z", "schedule")
    d, rs, ds = write(p1, "https://example.invalid/run/1", out)
    day = _load(os.path.join(out, "days", "2026-11-04.json"))
    with open(p1, encoding="utf-8") as f:
        raw = f.read()[:-1]
    cases.append(("the day file carries the exact result bytes, its sha and the day sha", (day["result_sha256"] == sha(day["result_canonical"]) == sha(raw), day["day_sha256"] == day_sha256(r1), day["trigger"], day["earlier"]), (True, True, "schedule", [])))
    p2, r2 = result("2026-11-04T11:50:32Z", "dispatch")
    write(p2, "https://example.invalid/run/2", out)
    day = _load(os.path.join(out, "days", "2026-11-04.json"))
    cases.append(("a dispatch later the same day replaces the day and keeps the earlier run, with the same day sha", (day["trigger"], [e["trigger"] for e in day["earlier"]], day["day_sha256"] == day["earlier"][0]["day_sha256"]), ("dispatch", ["schedule"], True)))
    p2b, r2b = result("2026-11-04T04:36:02Z", "second", ok=4)
    da2 = os.path.join(tmp, "second")
    write(p1, "https://example.invalid/run/1", da2)
    write(p2b, "https://example.invalid/run/2b", da2)
    dy, lt = _load(os.path.join(da2, "days", "2026-11-04.json")), _load(os.path.join(da2, "latest.json"))
    cases.append(("the second run's result replaces the day, keeps the schedule run under earlier, latest is the same bytes, runs 2",
                  (dy["trigger"], [e["trigger"] for e in dy["earlier"]], dy["counts"]["not_yet"], lt == dy, _load(os.path.join(da2, "index.json"))["days"][0]["runs"]), ("second", ["schedule"], 4, True, 2)))
    p3, r3 = result("2026-11-05T04:05:10Z", "second", ok=8, verdict="green")
    write(p3, "https://example.invalid/run/3", out)
    idx = _load(os.path.join(out, "index.json"))
    latest = _load(os.path.join(out, "latest.json"))
    cases.append(("the index lists each day once, newest first; latest is the newest day", ([r["day"] for r in idx["days"]], idx["latest"], latest["day"], latest["verdict"], [r["runs"] for r in idx["days"]]), (["2026-11-05", "2026-11-04"], "2026-11-05", "2026-11-05", "green", [1, 2])))
    bad_p = os.path.join(tmp, "bad.json")
    with open(bad_p, "w", encoding="utf-8") as f:
        f.write(json.dumps(r1, indent=1) + "\n")
    try:
        write(bad_p, "x", out); refused = False
    except ValueError:
        refused = True
    cases.append(("a result file that is not the canonical bytes is refused", refused, True))
    r4 = dict(r1); del r4["trigger"]
    p4 = os.path.join(tmp, "notrigger.json")
    with open(p4, "w", encoding="utf-8") as f:
        f.write(canon(r4) + "\n")
    try:
        write(p4, "x", out); refused = False
    except ValueError:
        refused = True
    cases.append(("a result without trigger (an older tooshi_daily.py) is refused", refused, True))
    names = sorted(os.path.relpath(os.path.join(a, f), out) for a, _, fs in os.walk(out) for f in fs)
    cases.append(("only the three kinds of file are written, no temporary file is left", names, ["days/2026-11-04.json", "days/2026-11-05.json", "index.json", "latest.json"]))
    # the run's notes (tooshi_daily.py --notes): in the day file, outside result_canonical, result_sha256 and day_sha256
    def notes_file(at, state, name):
        p = os.path.join(tmp, name)
        with open(p, "w", encoding="utf-8") as f:
            f.write(canon({"schema": "tooshi-notes-v0", "observed_at": at, "outside": "x", "items": [{"about": "3_ledger_settle", "day": "2026-11-05", "state": state}]}) + "\n")
        return p
    p6, r6 = result("2026-11-06T04:05:00Z", "schedule")
    da, db = os.path.join(tmp, "na"), os.path.join(tmp, "nb")
    write(p6, "u", da, notes_file("2026-11-06T04:05:00Z", "not_confirmed", "n_a.json"))
    write(p6, "u", db, notes_file("2026-11-06T04:05:00Z", "confirmed", "n_b.json"))
    ya, yb = _load(os.path.join(da, "days", "2026-11-06.json")), _load(os.path.join(db, "days", "2026-11-06.json"))
    cases.append(("two day files of the same result whose notes differ: the same result_sha256 and day_sha256, the notes kept as given",
                  (ya["result_sha256"] == yb["result_sha256"], ya["day_sha256"] == yb["day_sha256"], ya["notes"]["items"][0]["state"], yb["notes"]["items"][0]["state"]), (True, True, "not_confirmed", "confirmed")))
    cases.append(("a witness's recipe on result_canonical alone gives the file's day_sha256 (the notes are not read)",
                  (day_sha256(json.loads(ya["result_canonical"])) == ya["day_sha256"], "notes" in ya["result_canonical"]), (True, False)))
    try:
        write(p6, "u", da, notes_file("2026-11-06T04:35:00Z", "confirmed", "n_c.json")); refused = False
    except ValueError:
        refused = True
    cases.append(("notes of another run (observed_at is not the result's checked_at) are refused", refused, True))
    p7, r7 = result("2026-11-06T11:50:00Z", "dispatch")
    write(p7, "u", da)
    ya = _load(os.path.join(da, "days", "2026-11-06.json"))
    cases.append(("a later run without notes: its day has no notes, the earlier run keeps its own", ("notes" in ya, ya["earlier"][0]["notes"]["items"][0]["state"]), (False, "not_confirmed")))
    shutil.rmtree(tmp, ignore_errors=True)
    bad = [n for n, got, want in cases if got != want]
    for n, got, want in cases:
        print(("  ok   " if got == want else "  NG   ") + n + ("" if got == want else " (got %r, want %r)" % (got, want)))
    print("tooshi_publish selftest %d / %d %s" % (len(cases) - len(bad), len(cases), "all green" if not bad else "NG"))
    return 1 if bad else 0


def main(argv):
    if argv == ["--selftest"]:
        return selftest()
    if not argv:
        print(__doc__)
        return 2
    cmd, rest = argv[0], argv[1:]
    opts = {}
    it = iter(rest)
    try:
        for a in it:
            if a not in ("--trigger", "--now", "--have-day", "--day-file", "--result", "--notes", "--run-url", "--dir"):
                raise StopIteration
            opts[a] = next(it)
    except StopIteration:
        print("usage: see the docstring")
        return 2
    if cmd == "decide":
        now = datetime.datetime.strptime(opts["--now"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
        day = None
        if opts.get("--day-file"):
            try:
                day = _load(opts["--day-file"])
            except ValueError:
                day = None   # not JSON: decided as before (a published day is not read again)
        what, why = decide(opts.get("--trigger", ""), now, opts.get("--have-day") == "1", day)
        print(what + " " + why)
        return 0
    if cmd == "write":
        d, rs, ds = write(opts["--result"], opts.get("--run-url", ""), opts.get("--dir", "tooshi"), opts.get("--notes"))
        print("TOOSHI_KEPT %s %s %s" % (d, rs, ds))
        return 0
    print("usage: see the docstring")
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except SystemExit:
        raise
    except Exception as e:
        print("tooshi_publish failed: %s: %s" % (type(e).__name__, e))
        sys.exit(2)
