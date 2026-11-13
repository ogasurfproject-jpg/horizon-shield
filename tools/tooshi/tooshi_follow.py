#!/usr/bin/env python3
"""TOOSHI follow: two things a person did by hand on 2026-11-13, done after each daily check from then on.

  close     A red day opens one issue (tooshi_tell.py). Nothing closed it, so an answered red looked open from outside.
            For each open issue "TOOSHI red <day>" opened by the workflow, this reads which checks the issue named red
            (its tooshi-evidence markers and the day file) and, for each, the first later published day that reads the
            same check ok. When every named check has one, it writes a closing note and closes the issue. The day file
            is not touched: the day stays red. A check that has not read ok since leaves the issue open, with no comment.
  announce  Check 9 needs a witness answer signed with a key of the witness's own domain. Witnesses were told of a new
            day record by hand, and three days were not announced (2026-11-09 to 2026-11-11). When check 9 has been
            not_yet on two published days in a row (today included), this writes one comment on the witness issue with
            yesterday's day record (sha, n, root), read from the runner and the ledger. It never writes twice for a day
            (its marker, or the record sha in any earlier comment), and writes nothing when the day is empty or not
            accepted yet.
  --selftest  fixed answers, no network.

Reads: tooshi/days/<day>.json in the checkout, the runner's GET /furui/day/<day>/status, the ledger's GET
/furui-check-day/<sha>, GitHub's issue API. Writes: issue comments and one issue state, with the job's token. No secret.
"""
import datetime, hashlib, json, os, re, sys, urllib.error, urllib.request

API = "https://api.github.com"
RUNNER = "https://furui.horizonshield.dev"
LEDGER = "https://ledger.horizonshield.dev"
UA = "tooshi-follow/0.1"
LABELS = ("tooshi", "tooshi-red")
BOT = "github-actions[bot]"
TITLE = re.compile(r"^TOOSHI red (\d{4}-\d{2}-\d{2})$")
MARK = re.compile(r"<!-- tooshi-evidence: ([^>]*) -->")
CID = re.compile(r"^[0-9]+[a-z]?_[a-z0-9_]+$")
H64 = re.compile(r"^[0-9a-f]{64}$")
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CLOSED_MARK = "<!-- tooshi-follow: closed %s -->"
READY_MARK = "<!-- furui-day-ready: %s -->"
W9 = "9_witness_answer"
MAX_CLOSE = 10          # issues closed in one run at most
LOOKAHEAD = 60          # later days read for one issue at most
KEEP_DAYS = 7           # the runner serves a day's leaves this many days
STREAK = 2              # announce when check 9 was not_yet on this many published days in a row, today included


def d_(s):
    return datetime.datetime.strptime(s, "%Y-%m-%d").date()


def read_day(dirp, day):
    """{check id: state} of the published day, or None when the file is absent or not a day file"""
    p = os.path.join(dirp, "days", day + ".json")
    try:
        with open(p, encoding="utf-8") as f:
            j = json.load(f)
    except (OSError, ValueError):
        return None
    ch = j.get("checks") if isinstance(j, dict) else None
    if not isinstance(ch, list):
        return None
    out = {}
    for x in ch:
        if isinstance(x, dict) and isinstance(x.get("id"), str) and isinstance(x.get("state"), str):
            out[x["id"]] = x["state"]
    return out


def counts(states):
    c = {"ok": 0, "red": 0, "notice": 0, "not_yet": 0}
    for s in states.values():
        if s in c:
            c[s] += 1
    return c


def latest_day(dirp, today):
    """the newest published day not after today, looking back LOOKAHEAD days; (day, states) or (None, None)"""
    for i in range(LOOKAHEAD + 1):
        d = (d_(today) - datetime.timedelta(days=i)).strftime("%Y-%m-%d")
        st = read_day(dirp, d)
        if st is not None:
            return d, st
    return None, None


def named_red(day, texts, states):
    """the checks an issue of day named red: the ids of its tooshi-evidence markers for that day, and the day file's reds"""
    ids = set()
    for t in texts:
        for m in MARK.finditer(t or ""):
            w = m.group(1).split()
            if w and w[0] == day:
                ids.update(x for x in w[1:] if CID.match(x))
    ids.update(k for k, v in (states or {}).items() if v == "red")
    return sorted(ids)


def answered(dirp, day, ids, today):
    """{id: the first later published day, not after today, that reads id ok}; an id with no such day is left out"""
    out = {}
    for i in range(1, LOOKAHEAD + 1):
        e = (d_(day) + datetime.timedelta(days=i)).strftime("%Y-%m-%d")
        if e > today:
            break
        st = read_day(dirp, e)
        if st is None:
            continue
        for k in ids:
            if k not in out and st.get(k) == "ok":
                out[k] = e
        if len(out) == len(ids):
            break
    return out


def closing_note(day, ids, ans, latest, lc):
    lines = ["**Closing note (automatic).** The day %s stays red in `tooshi/days/%s.json`. Closing this issue does not change that record." % (day, day), "",
             "What was red, and the first later audit that read the same check ok:", ""]
    lines += ["- `%s`: ok on %s." % (k, ans[k]) for k in ids]
    lines += ["", "The latest audit, %s, reads ok %d, red %d, notice %d, not yet %d. This issue is closed because every check it named has read ok since, not because the day was repaired." % (latest, lc["ok"], lc["red"], lc["notice"], lc["not_yet"]),
              "", "Written by the workflow tooshi-follow (tools/tooshi/tooshi_follow.py).", CLOSED_MARK % day]
    return "\n".join(lines) + "\n"


def follow_close(dirp, repo, api, send, today, dry=False):
    """returns the list of (issue number, day, action) with action closed, would_close, open:<ids not answered>, skipped:<why>"""
    latest, lst = latest_day(dirp, today)
    if latest is None:
        return [(0, "", "skipped:no published day is readable")]
    seen, out, done = set(), [], 0
    for lb in LABELS:
        for i in (api("/repos/%s/issues?labels=%s&state=open&per_page=100" % (repo, lb)) or []):
            if not isinstance(i, dict) or "pull_request" in i or i.get("number") in seen:
                continue
            m = TITLE.match(i.get("title") or "")
            if not m or (i.get("user") or {}).get("login") != BOT or i.get("state") != "open":
                continue
            seen.add(i["number"])
            day = m.group(1)
            if day >= latest:
                out.append((i["number"], day, "open:no later day is published yet"))
                continue
            cm = api("/repos/%s/issues/%d/comments?per_page=100" % (repo, i["number"])) or []
            texts = [i.get("body") or ""] + [c.get("body") or "" for c in cm if isinstance(c, dict)]
            if any((CLOSED_MARK % day) in t for t in texts):
                out.append((i["number"], day, "skipped:a closing note is already there (reopened by hand)"))
                continue
            ids = named_red(day, texts, read_day(dirp, day))
            if not ids:
                out.append((i["number"], day, "skipped:no red check is named"))
                continue
            ans = answered(dirp, day, ids, today)
            left = [k for k in ids if k not in ans]
            if left:
                out.append((i["number"], day, "open:" + " ".join(left)))
                continue
            if done >= MAX_CLOSE:
                out.append((i["number"], day, "skipped:%d issues were closed in this run already" % MAX_CLOSE))
                continue
            if dry:
                out.append((i["number"], day, "would_close"))
                continue
            send("POST", "/repos/%s/issues/%d/comments" % (repo, i["number"]), {"body": closing_note(day, ids, ans, latest, counts(lst))})
            send("PATCH", "/repos/%s/issues/%d" % (repo, i["number"]), {"state": "closed", "state_reason": "completed"})
            done += 1
            out.append((i["number"], day, "closed"))
    return sorted(out)


def sha(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def day_record(get, day):
    """(problem or None, {sha, n, root}) of the day record of runner-1's day, as the runner closed it and the ledger serves it"""
    s, st = get(RUNNER + "/furui/day/%s/status" % day)
    v = st.get("status") if s == 200 and isinstance(st, dict) else None
    if not isinstance(v, dict):
        return "the runner holds no closed status for %s (http %s)" % (day, s), None
    if v.get("state") == "empty":
        return "empty", None
    rs = v.get("ledger_canonical_sha256")
    if v.get("state") != "accepted" or not (isinstance(rs, str) and H64.match(rs)):
        return "%s is %s, not accepted" % (day, v.get("state")), None
    ls, r = get(LEDGER + "/furui-check-day/" + rs)
    rc = r.get("record_canonical") if ls == 200 and isinstance(r, dict) else None
    if not isinstance(rc, str) or sha(rc) != rs:
        return "the ledger does not serve the day record %s as bytes that hash to it (http %s)" % (rs, ls), None
    try:
        rec = json.loads(rc)
    except ValueError:
        return "the day record %s is not JSON" % rs, None
    n, root = rec.get("n") if isinstance(rec, dict) else None, rec.get("root") if isinstance(rec, dict) else None
    if rec.get("day") != day or not (isinstance(n, int) and not isinstance(n, bool) and n >= 1) or not (isinstance(root, str) and H64.match(root)) or root != v.get("root") or n != v.get("n"):
        return "the ledger's day record of %s does not name the runner's n and root" % day, None
    return None, {"sha": rs, "n": n, "root": root}


def streak9(dirp, today):
    """how many published days in a row, today first, read check 9 not_yet; 0 when today is not published or 9 is not not_yet"""
    k = 0
    for i in range(LOOKAHEAD):
        st = read_day(dirp, (d_(today) - datetime.timedelta(days=i)).strftime("%Y-%m-%d"))
        if st is None or st.get(W9) != "not_yet":
            break
        k += 1
    return k


def ready_note(day, rec, k, today):
    nxt = (d_(today) + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    until = (d_(day) + datetime.timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%d")
    leaf = "with `--leaf 0`" if rec["n"] == 1 else "with one line per leaf from `--leaf 0` to `--leaf %d`" % (rec["n"] - 1)
    return "\n".join([
        "### Day record of %s is ready for witnesses" % day, "",
        "- Day record: %s/furui-check-day/%s" % (LEDGER, rec["sha"]),
        "- record_sha256: `%s`" % rec["sha"],
        "- Leaves (`n`): %d, root `%s`" % (rec["n"], rec["root"]),
        "- Runner status: %s/furui/day/%s/status" % (RUNNER, day),
        "- Leaves are served until %s." % until, "",
        "The procedure is the one in the issue text above, with the day changed and %s. If the Bitcoin anchor is not confirmed when you run, leave `bitcoin_anchor` out. An answer made before the anchor stays valid." % leaf, "",
        "Why this comment: check 9 of the daily audit (TOOSHI) has read \"no signed witness answer\" on %d audit days in a row. The audit of %s (04:05 UTC) reads this day record. Only an answer signed with a key served from a witness's own domain closes that line, so we cannot close it ourselves. One answer is enough." % (k, nxt), "",
        "Written by the workflow tooshi-follow (tools/tooshi/tooshi_follow.py), not by hand. It writes only when check 9 has waited %d audits in a row, and once per day record." % STREAK,
        READY_MARK % day]) + "\n"


def follow_announce(dirp, repo, issue, api, send, get, today, dry=False):
    """returns (action, detail): action is announced, would_announce or nothing"""
    k = streak9(dirp, today)
    if k < STREAK:
        return "nothing", "check 9 has been not_yet on %d published days in a row (the line is %d)" % (k, STREAK)
    day = (d_(today) - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    why, rec = day_record(get, day)
    if why:
        return "nothing", "the day record of %s is not ready to announce: %s" % (day, why)
    it = api("/repos/%s/issues/%d" % (repo, issue))
    if not isinstance(it, dict) or "pull_request" in it or it.get("state") != "open":
        return "nothing", "issue %d is not an open issue" % issue
    page, texts = 1, [it.get("body") or ""]
    while page <= 10:
        cm = api("/repos/%s/issues/%d/comments?per_page=100&page=%d" % (repo, issue, page)) or []
        texts += [c.get("body") or "" for c in cm if isinstance(c, dict)]
        if len(cm) < 100:
            break
        page += 1
    else:
        return "nothing", "issue %d has more than 1000 comments; not all were read, so nothing is written" % issue
    if any((READY_MARK % day) in t or rec["sha"] in t for t in texts):
        return "nothing", "the day record of %s (%s) is already named on issue %d" % (day, rec["sha"][:8], issue)
    if dry:
        return "would_announce", "%s %s n %d" % (day, rec["sha"][:8], rec["n"])
    send("POST", "/repos/%s/issues/%d/comments" % (repo, issue), {"body": ready_note(day, rec, k, today)})
    return "announced", "%s %s n %d" % (day, rec["sha"][:8], rec["n"])


def _gh(token):
    hd = {"authorization": "Bearer " + token, "accept": "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": UA}

    def call(method, path, obj=None):
        req = urllib.request.Request(API + path, data=None if obj is None else json.dumps(obj).encode("utf-8"), method=method, headers=dict(hd, **({"content-type": "application/json"} if obj is not None else {})))
        for i in range(3 if method == "GET" else 1):   # a read is tried three times; a write once, so nothing is written twice
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    t = r.read().decode("utf-8")
                    return json.loads(t) if t else None
            except urllib.error.HTTPError as e:
                if e.code < 500 or method != "GET" or i == 2:
                    raise RuntimeError("%s %s answered %d" % (method, path, e.code))
            except (urllib.error.URLError, OSError) as e:
                if method != "GET" or i == 2:
                    raise RuntimeError("%s %s did not answer: %s" % (method, path, type(e).__name__))
    return (lambda path: call("GET", path)), call


def _get(url):
    req = urllib.request.Request(url, headers={"accept": "application/json", "user-agent": UA})
    for i in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                t = r.read().decode("utf-8")
                try:
                    return r.status, json.loads(t)
                except ValueError:
                    return r.status, None
        except urllib.error.HTTPError as e:
            if e.code < 500 or i == 2:
                return e.code, None
        except (urllib.error.URLError, OSError):
            if i == 2:
                raise RuntimeError("%s did not answer three times" % url)
    return 0, None


def selftest():
    import tempfile
    cases = []

    def world(days):
        td = tempfile.mkdtemp(prefix="tooshi_follow_")
        os.makedirs(os.path.join(td, "days"))
        for d, st in days.items():
            with open(os.path.join(td, "days", d + ".json"), "w", encoding="utf-8") as f:
                json.dump({"day": d, "checks": [{"id": k, "state": v} for k, v in st.items()]}, f)
        return td

    class GH:
        def __init__(self, issues, comments=None):
            self.issues, self.comments, self.sent = issues, comments or {}, []

        def api(self, path):
            m = re.match(r"^/repos/o/r/issues\?labels=([a-z-]+)&state=open&per_page=100$", path)
            if m:
                return [i for i in self.issues if m.group(1) in i["labels"] and i["state"] == "open"]
            m = re.match(r"^/repos/o/r/issues/(\d+)/comments\?per_page=100(?:&page=(\d+))?$", path)
            if m:
                c = self.comments.get(int(m.group(1)), [])
                p = int(m.group(2) or 1)
                return [{"body": b} for b in c[(p - 1) * 100:p * 100]]
            m = re.match(r"^/repos/o/r/issues/(\d+)$", path)
            if m:
                return next((i for i in self.issues if i["number"] == int(m.group(1))), None)
            raise RuntimeError("GET %s answered 404" % path)

        def send(self, method, path, obj):
            self.sent.append((method, path, obj))
            m = re.match(r"^/repos/o/r/issues/(\d+)/comments$", path)
            if method == "POST" and m:
                self.comments.setdefault(int(m.group(1)), []).append(obj["body"])
                return {"id": 1}
            m = re.match(r"^/repos/o/r/issues/(\d+)$", path)
            if method == "PATCH" and m:
                next(i for i in self.issues if i["number"] == int(m.group(1)))["state"] = obj["state"]
                return {}
            raise RuntimeError("%s %s answered 404" % (method, path))

    def issue(n, day, body="", login=BOT, labels=("tooshi",), state="open", title=None, pr=False):
        i = {"number": n, "title": title or "TOOSHI red " + day, "body": body, "labels": list(labels), "state": state, "user": {"login": login}}
        if pr:
            i["pull_request"] = {}
        return i

    ev = lambda day, *ids: "x\n<!-- tooshi-evidence: %s %s -->\n" % (day, " ".join(ids))
    A, B, C9 = "3_ledger_settle", "17_paid_call_chain", W9
    w = world({"2026-11-10": {A: "red", B: "ok"}, "2026-11-11": {A: "red", B: "red"}, "2026-11-12": {A: "ok", B: "red"}, "2026-11-13": {A: "ok", B: "ok", C9: "not_yet"}})
    g = GH([issue(1, "2026-11-10", ev("2026-11-10", A)), issue(2, "2026-11-11", ev("2026-11-11", A, B)), issue(3, "2026-11-13", ev("2026-11-13", A))])
    r = follow_close(w, "o/r", g.api, g.send, "2026-11-13")
    cases.append(("an issue whose named checks read ok on a later day is closed; the day itself and a day with no later day stay",
                  (r, [i["state"] for i in g.issues]), ([(1, "2026-11-10", "closed"), (2, "2026-11-11", "closed"), (3, "2026-11-13", "open:no later day is published yet")], ["closed", "closed", "open"])))
    note = g.comments[2][0]
    cases.append(("the note names each check with its first later ok day, says the day stays red, and carries the marker",
                  ("- `17_paid_call_chain`: ok on 2026-11-13." in note, "- `3_ledger_settle`: ok on 2026-11-12." in note, "stays red in `tooshi/days/2026-11-11.json`" in note, note.endswith(CLOSED_MARK % "2026-11-11" + "\n"), "reads ok 2, red 0, notice 0, not yet 1" in note), (True,) * 5))
    cases.append(("the comment is written before the issue is closed, one of each per issue", [(m, p) for m, p, _ in g.sent],
                  [("POST", "/repos/o/r/issues/1/comments"), ("PATCH", "/repos/o/r/issues/1"), ("POST", "/repos/o/r/issues/2/comments"), ("PATCH", "/repos/o/r/issues/2")]))
    g = GH([issue(1, "2026-11-11", ev("2026-11-11", A, B))])
    r = follow_close(w, "o/r", g.api, g.send, "2026-11-12")
    cases.append(("a check that has not read ok yet leaves the issue open and nothing is written", (r, g.sent), ([(1, "2026-11-11", "open:17_paid_call_chain")], [])))
    w2 = world({"2026-11-10": {A: "red"}, "2026-11-11": {A: "not_yet"}, "2026-11-12": {A: "notice"}, "2026-11-13": {A: "not_yet"}})
    g = GH([issue(1, "2026-11-10", ev("2026-11-10", A))])
    cases.append(("not_yet and notice are not ok", follow_close(w2, "o/r", g.api, g.send, "2026-11-13"), [(1, "2026-11-10", "open:3_ledger_settle")]))
    g = GH([issue(1, "2026-11-10", "no marker")])
    cases.append(("without a marker the day file's reds are the named checks", follow_close(w, "o/r", g.api, g.send, "2026-11-13"), [(1, "2026-11-10", "closed")]))
    g = GH([issue(1, "2026-11-10", ev("2026-11-10", B), ), ], {1: [ev("2026-11-10", "8_canary_scene")]})
    cases.append(("a check named red only in a later comment of the day counts too (8 never read ok here)", follow_close(w, "o/r", g.api, g.send, "2026-11-13"), [(1, "2026-11-10", "open:8_canary_scene")]))
    g = GH([issue(1, "2026-11-10", ev("2026-11-10", A), login="someone"), issue(2, "2026-11-10", ev("2026-11-10", A), title="TOOSHI red 2026-11-10 (copy)"), issue(3, "2026-11-10", ev("2026-11-10", A), pr=True),
            issue(4, "2026-11-10", ev("2026-11-10", A), labels=("other",)), issue(5, "2026-11-10", ev("2026-11-10", A), state="closed")])
    cases.append(("an issue by someone else, another title, a pull request, another label or a closed issue is not touched", (follow_close(w, "o/r", g.api, g.send, "2026-11-13"), g.sent), ([], [])))
    g = GH([issue(1, "2026-11-10", ev("2026-11-10", A))], {1: [CLOSED_MARK % "2026-11-10"]})
    cases.append(("an issue reopened by hand after a closing note is left alone", (follow_close(w, "o/r", g.api, g.send, "2026-11-13"), g.sent), ([(1, "2026-11-10", "skipped:a closing note is already there (reopened by hand)")], [])))
    g = GH([issue(1, "2026-11-10", ev("2026-11-10", A), labels=("tooshi", "tooshi-red"))])
    cases.append(("an issue under both labels is closed once", ([x[2] for x in follow_close(w, "o/r", g.api, g.send, "2026-11-13")], len(g.sent)), (["closed"], 2)))
    g = GH([issue(1, "2026-11-10", ev("2026-11-10", A), labels=("tooshi-red",))])
    cases.append(("an issue under the old label tooshi-red alone is closed too", [x[2] for x in follow_close(w, "o/r", g.api, g.send, "2026-11-13")], ["closed"]))
    g = GH([issue(1, "2026-11-10", ev("2026-11-10", A))])
    cases.append(("dry: nothing is written", (follow_close(w, "o/r", g.api, g.send, "2026-11-13", dry=True), g.sent), ([(1, "2026-11-10", "would_close")], [])))
    g = GH([issue(n, "2026-11-10", ev("2026-11-10", A)) for n in range(1, 13)])
    r = follow_close(w, "o/r", g.api, g.send, "2026-11-13")
    cases.append(("at most %d issues are closed in one run" % MAX_CLOSE, ([x[2] for x in r].count("closed"), len([x for x in r if x[2].startswith("skipped:")])), (MAX_CLOSE, 2)))
    g = GH([issue(1, "2026-11-10", ev("2026-11-12", "8_canary_scene") + ev("2026-11-10", "x y", "../etc"))])
    cases.append(("a marker of another day or with words that are not check ids names nothing; the day file's red still counts", follow_close(w, "o/r", g.api, g.send, "2026-11-13"), [(1, "2026-11-10", "closed")]))
    g = GH([issue(1, "2026-11-10", ev("2026-11-10", A))])
    cases.append(("no published day is readable: nothing is done", (follow_close(world({}), "o/r", g.api, g.send, "2026-11-13"), g.sent), ([(0, "", "skipped:no published day is readable")], [])))
    cases.append(("a later day after today is not read (a run for an older today)", follow_close(w, "o/r", GH([issue(1, "2026-11-11", ev("2026-11-11", B))]).api, None, "2026-11-12"), [(1, "2026-11-11", "open:17_paid_call_chain")]))

    # announce
    rc = json.dumps({"day": "2026-11-12", "n": 6, "root": "ab" * 32, "schema": "furui-check-day-v0"}, sort_keys=True, separators=(",", ":"))
    rs = sha(rc)

    def getter(state="accepted", n=6, root="ab" * 32, served=rc, code=200):
        def get(url):
            if url == RUNNER + "/furui/day/2026-11-12/status":
                return 200, {"status": {"state": state, "ledger_canonical_sha256": rs, "n": n, "root": root}}
            if url == LEDGER + "/furui-check-day/" + rs:
                return code, {"record_canonical": served}
            return 404, None
        return get
    wn = world({"2026-11-11": {C9: "ok"}, "2026-11-12": {C9: "not_yet"}, "2026-11-13": {C9: "not_yet"}})
    g = GH([issue(75, "", title="Witness: FURUI day record 2026-11-06", login="owner", labels=())], {75: ["an old comment"]})
    a = follow_announce(wn, "o/r", 75, g.api, g.send, getter(), "2026-11-13")
    body = g.comments[75][-1]
    cases.append(("check 9 not_yet two days in a row: yesterday's day record is announced once, with sha, n, root and the marker",
                  (a, len(g.sent), "- record_sha256: `%s`" % rs in body, "- Leaves (`n`): 6, root `%s`" % ("ab" * 32) in body, "from `--leaf 0` to `--leaf 5`" in body, "until 2026-11-19" in body, "on 2 audit days in a row" in body, "The audit of 2026-11-14" in body, body.endswith(READY_MARK % "2026-11-12" + "\n")),
                  (("announced", "2026-11-12 %s n 6" % rs[:8]), 1, True, True, True, True, True, True, True)))
    a2 = follow_announce(wn, "o/r", 75, g.api, g.send, getter(), "2026-11-13")
    cases.append(("a second run of the day writes nothing", (a2[0], len(g.sent)), ("nothing", 1)))
    g = GH([issue(75, "", title="W", login="owner", labels=())], {75: ["by hand: record_sha256: `%s`" % rs]})
    cases.append(("a day record a person already named (its sha in a comment) is not announced again", (follow_announce(wn, "o/r", 75, g.api, g.send, getter(), "2026-11-13")[0], g.sent), ("nothing", [])))
    g = GH([issue(75, "", title="W", login="owner", labels=())])
    w1 = world({"2026-11-12": {C9: "ok"}, "2026-11-13": {C9: "not_yet"}})
    cases.append(("check 9 not_yet today only: nothing", (follow_announce(w1, "o/r", 75, g.api, g.send, getter(), "2026-11-13"), g.sent), (("nothing", "check 9 has been not_yet on 1 published days in a row (the line is 2)"), [])))
    w0 = world({"2026-11-12": {C9: "not_yet"}, "2026-11-13": {C9: "ok"}})
    cases.append(("check 9 ok today: nothing", follow_announce(w0, "o/r", 75, g.api, g.send, getter(), "2026-11-13")[0], "nothing"))
    cases.append(("today is not published: nothing", follow_announce(wn, "o/r", 75, g.api, g.send, getter(), "2026-11-14")[0], "nothing"))
    for lb, gt in (("the day is empty", getter(state="empty")), ("the day is not accepted yet", getter(state="closed")), ("the ledger serves other bytes", getter(served=rc + " ")), ("the ledger answers 404", getter(code=404)),
                   ("the runner's n differs from the record", getter(n=5)), ("the runner's root differs from the record", getter(root="cd" * 32))):
        cases.append(("%s: nothing is written" % lb, (follow_announce(wn, "o/r", 75, g.api, g.send, gt, "2026-11-13")[0], g.sent), ("nothing", [])))
    cases.append(("an empty day is named as empty in the reason", follow_announce(wn, "o/r", 75, g.api, g.send, getter(state="empty"), "2026-11-13")[1], "the day record of 2026-11-12 is not ready to announce: empty"))
    gc = GH([issue(75, "", title="W", login="owner", labels=(), state="closed")])
    cases.append(("the witness issue is closed: nothing is written", (follow_announce(wn, "o/r", 75, gc.api, gc.send, getter(), "2026-11-13")[0], gc.sent), ("nothing", [])))
    cases.append(("dry: nothing is written", (follow_announce(wn, "o/r", 75, g.api, g.send, getter(), "2026-11-13", dry=True)[0], g.sent), ("would_announce", [])))
    gl = GH([issue(75, "", title="W", login="owner", labels=())], {75: ["c"] * 150 + [READY_MARK % "2026-11-12"]})
    cases.append(("the marker on the second page of comments is found", follow_announce(wn, "o/r", 75, gl.api, gl.send, getter(), "2026-11-13")[0], "nothing"))
    rc1 = json.dumps({"day": "2026-11-12", "n": 1, "root": "ab" * 32}, sort_keys=True, separators=(",", ":"))

    def get1(url):
        if url.endswith("/status"):
            return 200, {"status": {"state": "accepted", "ledger_canonical_sha256": sha(rc1), "n": 1, "root": "ab" * 32}}
        return 200, {"record_canonical": rc1}
    g1 = GH([issue(75, "", title="W", login="owner", labels=())])
    follow_announce(wn, "o/r", 75, g1.api, g1.send, get1, "2026-11-13")
    cases.append(("a day of one leaf names --leaf 0 alone", "with `--leaf 0`. If" in g1.comments[75][0], True))
    bad = 0
    for name, got, want in cases:
        ok = got == want
        bad += not ok
        print("%s  %s" % ("ok  " if ok else "FAIL", name))
        if not ok:
            print("      got  %r\n      want %r" % (got, want))
    print("tooshi_follow selftest: %s (%d cases)" % ("ALL PASS" if not bad else "%d FAILED" % bad, len(cases)))
    return 1 if bad else 0


def main(argv):
    if argv[1:2] == ["--selftest"]:
        return selftest()
    if len(argv) < 2 or argv[1] not in ("close", "announce"):
        print("usage: tooshi_follow.py close|announce [--dir tooshi] [--issue N] [--today YYYY-MM-DD] [--dry] | --selftest")
        return 2
    a = argv[2:]

    def opt(name, default=None):
        return a[a.index(name) + 1] if name in a and a.index(name) + 1 < len(a) else default
    dirp, dry = opt("--dir", "tooshi"), "--dry" in a
    today = opt("--today") or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    if not DAY.match(today):
        print("--today is not a day")
        return 2
    repo, token = os.environ.get("GITHUB_REPOSITORY", ""), os.environ.get("GITHUB_TOKEN", "")
    if not re.match(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", repo) or not token:
        print("GITHUB_REPOSITORY or GITHUB_TOKEN is not set")
        return 2
    iss = opt("--issue", "")
    if argv[1] == "announce" and not iss.isdigit():
        print("--issue is not a number")
        return 2
    api, send = _gh(token)
    try:
        if argv[1] == "close":
            rows = follow_close(dirp, repo, api, send, today, dry)
            for n, day, act in rows:
                print("close: issue %s %s %s" % (n, day, act))
            if not rows:
                print("close: no open issue TOOSHI red <day> by the workflow")
            return 0
        act, det = follow_announce(dirp, repo, int(iss), api, send, _get, today, dry)
        print("announce: %s (%s)" % (act, det))
        return 0
    except RuntimeError as e:
        print("%s: not done, the run fails so that it is seen: %s" % (argv[1], e))
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
