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
        The checks 8 canary_scene and 9 witness_answer (2026-11-06) are counted like the others: a not_yet in either at
        04:05 (no canary call recorded yet, no signed witness answer for the day before yesterday yet) is read again by the second run.
    python3 -I -B tools/tooshi/tooshi_publish.py write --result tooshi_result.json [--notes tooshi_notes.json] --run-url URL --dir tooshi
        checks that the file is the canonical result tooshi_daily.py wrote, then writes
          tooshi/days/<day>.json   the day: verdict, counts, each check's state and why, the exact result bytes
                                   (result_canonical), result_sha256, day_sha256, trigger, checked_at, run_url, and the
                                   earlier runs of the same day (a dispatch after the scheduled run keeps it here);
                                   with --notes, the run's notes (tooshi_daily.py --notes, tooshi-notes-v0, observed_at
                                   equal to the result's checked_at) under notes. The notes are outside result_canonical,
                                   so they change neither result_sha256 nor day_sha256 (added 2026-11-05).
                                   When the result carries facts (tooshi_daily.py, 2026-11-10: red_zero_streak,
                                   anchored_ledger_days, pypi_wheel), a copy of them sits at the top of the day file under
                                   facts; they are inside result_canonical, so both shas cover them.
          tooshi/latest.json       the newest day, the same bytes as its day file
          tooshi/index.json        one line per day, newest first (with facts: the days of red_zero_streak and
                                   anchored_ledger_days and the state of pypi_wheel)
          tooshi/witness/<D>.json  (2026-11-20) the witness table of the day D that check 9 read (the day before
                                   yesterday): its rows (answer sha, runner, domain, outcome, step names, implementation
                                   origin and sha256, kit word, kept ledger head, state, counted) and one entry per domain.
                                   The hand-written fields of a domain (operator_named, operator_name, checked_at,
                                   basis_url, insider_name) are carried from this day's table when it is written again, else
                                   from the newest earlier table that has the domain; a person edits them in the newest
                                   table. counted is operator_named, not insider_name, and not in
                                   workers/hs-ledger/nenrin/witness-kit/NOT_COUNTED.json. Written only when the result's
                                   check 9 carries a table.
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
NOT_COUNTED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "workers", "hs-ledger", "nenrin", "witness-kit", "NOT_COUNTED.json")
HAND = ("operator_named", "operator_name", "checked_at", "basis_url", "insider_name")
WITNESS_RULE = ("A domain is counted when a person found a named operator on its pages (operator_named, with basis_url and checked_at), "
                "its operator_name is not an insider of the operator or Yakumo (insider_name), and it is not in NOT_COUNTED.json. "
                "matched_operators counts the distinct operator_name of counted domains with an ok row, per runner; own counts those rows of origin own.")
WITNESS_NOTE = "Domains are self-declared; we have not verified who operates them."


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
    if isinstance(res.get("facts"), dict):
        day["facts"] = res["facts"]   # a copy of the result's facts, which result_canonical already holds
    if nt is not None:
        day["notes"] = nt   # outside result_canonical: neither result_sha256 nor day_sha256 covers it
    _write(dayf, day)
    idxf = os.path.join(out_dir, "index.json")
    idx = _load(idxf) or {}
    rows = [r for r in (idx.get("days") or []) if isinstance(r, dict) and r.get("day") != d]
    rows.append({"day": d, "verdict": res["verdict"], "counts": res["counts"], "result_sha256": rs, "day_sha256": ds,
                 "trigger": res["trigger"], "run_url": run_url, "path": "days/%s.json" % d, "runs": len(earlier) + 1})
    if isinstance(res.get("facts"), dict):
        f = res["facts"]
        rows[-1]["facts"] = {"red_zero_streak": (f.get("red_zero_streak") or {}).get("days"), "anchored_ledger_days": (f.get("anchored_ledger_days") or {}).get("days"),
                             "pypi_wheel": (f.get("pypi_wheel") or {}).get("state")}
    write_witness(res, rs, out_dir)
    rows.sort(key=lambda r: r["day"], reverse=True)
    _write(idxf, {"schema": "tooshi-index-v0", "latest": rows[0]["day"], "days": rows, "recipe": RECIPE})
    latest = _load(os.path.join(out_dir, "days", rows[0]["day"] + ".json"))
    _write(os.path.join(out_dir, "latest.json"), latest)
    return d, rs, ds


def not_counted(dom, nc):
    """dom is in NOT_COUNTED.json: one of its domains or a subdomain of one, or github.com/<a listed owner>"""
    d = dom.lower()
    if d.startswith("github.com/"):
        return any(isinstance(x, dict) and d == "github.com/" + str(x.get("owner")).lower() for x in nc.get("github_owners") or [])
    return any(isinstance(x, dict) and isinstance(x.get("domain"), str) and (d == x["domain"] or d.endswith("." + x["domain"])) for x in nc.get("domains") or [])


def hand_fields(wdir, day):
    """the hand-written fields of each domain: from the table of day when it exists, else from the newest earlier table with the domain"""
    out = {}
    try:
        names = sorted((f for f in os.listdir(wdir) if DAY_RE.match(f[:-5]) and f.endswith(".json") and f[:10] <= day), reverse=True)
    except FileNotFoundError:
        return out
    for f in names:
        t = _load(os.path.join(wdir, f))
        for dom, v in ((t.get("domains") if isinstance(t, dict) else None) or {}).items():
            if isinstance(v, dict) and dom not in out:
                out[dom] = {k: v.get(k) for k in HAND}
    return out


def write_witness(res, rs, out_dir, nc_path=None):
    """tooshi/witness/<D>.json from check 9's table (tooshi_daily.py facts.table); None when the result has no table"""
    x = next((c for c in res["checks"] if isinstance(c, dict) and c.get("id") == "9_witness_answer"), None)
    f = (x or {}).get("facts") or {}
    if not isinstance(f.get("table"), list) or not DAY_RE.match(str(f.get("day"))):
        return None
    try:
        nc = _load(nc_path or NOT_COUNTED)
    except ValueError:
        nc = None
    wdir = os.path.join(out_dir, "witness")
    hand = hand_fields(wdir, f["day"])
    doms = {}
    for r in f["table"]:
        d = r.get("domain") if isinstance(r, dict) else None
        if not isinstance(d, str) or d in doms:
            continue
        h = hand.get(d) or {}
        e = {"operator_named": h.get("operator_named") is True, "operator_name": h.get("operator_name") if isinstance(h.get("operator_name"), str) else None,
             "checked_at": h.get("checked_at"), "basis_url": h.get("basis_url"), "insider_name": h.get("insider_name") is True,
             "not_counted": not_counted(d, nc) if isinstance(nc, dict) else None}
        e["counted"] = e["operator_named"] and not e["insider_name"] and e["not_counted"] is False
        doms[d] = e
    line = {}
    for rid in sorted({r.get("runner_id") for r in f["table"] if isinstance(r, dict) and isinstance(r.get("runner_id"), str)}):
        ok = [r for r in f["table"] if isinstance(r, dict) and r.get("runner_id") == rid and r.get("state") == "ok" and r.get("counted") and (doms.get(r.get("domain")) or {}).get("counted")]
        line[rid] = {"matched_operators": len({doms[r["domain"]]["operator_name"] for r in ok}), "own": sum(1 for r in ok if r.get("origin") == "own")}
    t = {"schema": "tooshi-witness-day-v0", "day": f["day"], "checked_at": res["checked_at"], "result_sha256": rs, "state": x.get("state"),
         "records": f.get("records") or {}, "rows": f["table"], "domains": doms, "line": line, "rule": WITNESS_RULE, "note": WITNESS_NOTE,
         "not_counted_read": isinstance(nc, dict)}
    _write(os.path.join(wdir, f["day"] + ".json"), t)
    return t


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
    r89 = decide("second", T35, True, pub("2026-11-05", "schedule", 2, ids=("8_canary_scene", "9_witness_answer")))
    cases.append(("second, the schedule run left 8 and 9 not_yet (no canary record, no witness answer yet): run, naming them", (r89[0], "2 not_yet (8_canary_scene, 9_witness_answer)" in r89[1]), ("run", True)))
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
    pf, rf = result("2026-11-06T04:05:00Z", "schedule")
    rf["facts"] = {"red_zero_streak": {"days": 3, "since": "2026-11-04"}, "anchored_ledger_days": {"days": 67}, "pypi_wheel": {"state": "not_yet"}}
    with open(pf, "w", encoding="utf-8") as f:
        f.write(canon(rf) + "\n")
    outf = os.path.join(tmp, "facts")
    write(p1, "https://example.invalid/run/1", outf)
    write(pf, "https://example.invalid/run/f", outf)
    dyf, ixf = _load(os.path.join(outf, "days", "2026-11-06.json")), _load(os.path.join(outf, "index.json"))
    cases.append(("a result with facts: the day file carries a copy at the top, the index line the two numbers and the state, and day_sha256 covers them",
                  (dyf["facts"] == rf["facts"], ixf["days"][0]["facts"], dyf["day_sha256"] == day_sha256(rf), "facts" in _load(os.path.join(outf, "days", "2026-11-04.json"))),
                  (True, {"red_zero_streak": 3, "anchored_ledger_days": 67, "pypi_wheel": "not_yet"}, True, False)))
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
    # the witness table (2026-11-20): tooshi/witness/<D>.json from check 9's facts.table
    def row(dom, rid="runner-1", state="ok", origin="operator-kit", counted=True):
        return {"answer_sha256": sha(dom + rid), "runner_id": rid, "domain": dom, "schema": "witness-answer-v0.2", "outcome": "match", "steps": [], "origin": origin,
                "implementation_sha256": sha("kit"), "kit": "modified", "ledger_head": None, "state": state, "counted": counted}
    def wres(at, rows):
        r = {"schema": "tooshi-daily-v0", "checked_at": at, "trigger": "schedule", "verdict": "green", "counts": {"ok": 1, "red": 0, "notice": 0, "not_yet": 0},
             "checks": [{"id": "9_witness_answer", "state": "ok", "why": "w", "facts": {"day": at[:8] + "%02d" % (int(at[8:10]) - 2), "records": {"runner-1": sha("r1")}, "table": rows}}]}
        p = os.path.join(tmp, "w_%s.json" % at.replace(":", ""))
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(canon(r) + "\n")
        return p
    ncp = os.path.join(tmp, "nc.json")
    with open(ncp, "w", encoding="utf-8") as fh:
        json.dump({"domains": [{"domain": "horizonshield.dev"}, {"domain": "reform-sn.com"}], "github_owners": [{"owner": "ogasurfproject-jpg"}]}, fh)
    ow = os.path.join(tmp, "wt")
    R1 = [row("a.example"), row("b.example"), row("x.horizonshield.dev"), row("c.example", origin="own"), row("a.example", "runner-2"), row("d.example", state="red")]
    res1, _ = read_result(wres("2026-11-22T04:05:00Z", R1))
    t1 = write_witness(res1, "rs", ow, ncp)
    cases.append(("witness table: written for the day check 9 read, every domain once, nobody counted before a person names an operator",
                  (os.path.isfile(os.path.join(ow, "witness", "2026-11-20.json")), sorted(t1["domains"]), [d["counted"] for d in t1["domains"].values()], t1["line"]),
                  (True, ["a.example", "b.example", "c.example", "d.example", "x.horizonshield.dev"], [False] * 5,
                   {"runner-1": {"matched_operators": 0, "own": 0}, "runner-2": {"matched_operators": 0, "own": 0}})))
    t1 = _load(os.path.join(ow, "witness", "2026-11-20.json"))
    for dom, nm in (("a.example", "Alice Org"), ("b.example", "Alice Org"), ("c.example", "Carol"), ("x.horizonshield.dev", "Us"), ("d.example", "Dan")):
        t1["domains"][dom].update(operator_named=True, operator_name=nm, checked_at="2026-11-20T09:00:00Z", basis_url="https://%s/about" % dom)
    t1["domains"]["c.example"]["insider_name"] = False
    _write(os.path.join(ow, "witness", "2026-11-20.json"), t1)
    res2, _ = read_result(wres("2026-11-23T04:05:00Z", R1 + [row("e.example")]))
    t2 = write_witness(res2, "rs2", ow, ncp)
    cases.append(("witness table: the next day carries the hand fields; a subdomain of NOT_COUNTED is not counted; two domains of one operator count once; own is counted beside",
                  ({k: v["counted"] for k, v in t2["domains"].items()}, t2["line"], t2["domains"]["a.example"]["basis_url"]),
                  ({"a.example": True, "b.example": True, "c.example": True, "d.example": True, "e.example": False, "x.horizonshield.dev": False},
                   {"runner-1": {"matched_operators": 2, "own": 1}, "runner-2": {"matched_operators": 1, "own": 0}}, "https://a.example/about")))
    t2 = _load(os.path.join(ow, "witness", "2026-11-21.json"))
    t2["domains"]["b.example"]["insider_name"] = True
    _write(os.path.join(ow, "witness", "2026-11-21.json"), t2)
    t3 = write_witness(read_result(wres("2026-11-23T11:50:00Z", R1))[0], "rs3", ow, ncp)
    cases.append(("witness table: a second run of the same day keeps that day's hand fields (an insider name is not counted)",
                  (t3["domains"]["b.example"]["counted"], t3["domains"]["a.example"]["counted"], t3["result_sha256"]), (False, True, "rs3")))
    t4 = write_witness(read_result(wres("2026-11-24T04:05:00Z", [row("github.com/ogasurfproject-jpg"), row("github.com/someone")]))[0], "rs4", ow, os.path.join(tmp, "none.json"))
    cases.append(("witness table: without NOT_COUNTED.json nothing is counted (not_counted null)", ([d["not_counted"] for d in t4["domains"].values()], t4["not_counted_read"]), ([None, None], False)))
    cases.append(("witness table: our GitHub account is in NOT_COUNTED, another account is not", (not_counted("github.com/OgaSurfProject-jpg", {"github_owners": [{"owner": "ogasurfproject-jpg"}]}),
                  not_counted("github.com/someone", {"github_owners": [{"owner": "ogasurfproject-jpg"}]}), not_counted("evilhorizonshield.dev", {"domains": [{"domain": "horizonshield.dev"}]})), (True, False, False)))
    cases.append(("witness table: a result whose check 9 has no table writes none (an older tooshi_daily.py)", write_witness(r1, "x", ow, ncp), None))
    rep = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    if os.path.isfile(os.path.join(rep, "data", "yakumo-store-places.json")) and os.path.isfile(NOT_COUNTED):
        st_ = (_load(os.path.join(rep, "data", "yakumo-store-places.json")) or {}).get("stores") or {}
        sites = sorted(re.sub(r"^www\.", "", re.match(r"^https?://([^/:]+)", v["website"]).group(1).lower()) for v in st_.values() if isinstance(v, dict) and isinstance(v.get("website"), str) and re.match(r"^https?://[^/:]+", v["website"]))
        cases.append(("NOT_COUNTED.json holds the own site of every store in data/yakumo-store-places.json (add a new store's site the same day)",
                      [s_ for s_ in sites if not not_counted(s_, _load(NOT_COUNTED))], []))
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
