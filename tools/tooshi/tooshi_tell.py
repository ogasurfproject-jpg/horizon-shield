"""tooshi_tell.py: tell a red TOOSHI day, once. Run by .github/workflows/tooshi-daily.yml after tooshi_daily.py.

    python3 -I -B tools/tooshi/tooshi_tell.py issue --result tooshi_result.json --body tooshi_body.md --out tooshi_issue.txt
        GITHUB_TOKEN and GITHUB_REPOSITORY from the job. A red day opens one issue (label tooshi, title "TOOSHI red <day>",
        the same shape as bot-watch): when the day has an issue already (label tooshi, or tooshi-red from before
        2026-11-06), a later run of the same day that is red in a check not named in it yet adds a comment, otherwise
        nothing. The issue and every comment end with a marker that names the red checks. Writes opened, commented,
        already_told or not_red to --out and prints "TOOSHI_ISSUE <action> #<number> <title>".
    python3 -I -B tools/tooshi/tooshi_tell.py mail --result tooshi_result.json --issue-action opened
        RESEND_API_KEY from the job (the repository secret; absent, it says so and sends nothing). One mail per red day:
        only the run that opened the day's issue sends it. From contact@the-horizons-innovation.com to the owner, subject
        "TOOSHI red <day>", one line per red check: its id and the first line of its reason, cut at 160 characters. No
        key, no message body and nothing about a person is in it (13 writes only a worker, a time and a place).
        Prints "TOOSHI_MAIL sent", "TOOSHI_MAIL not_sent: <why>" or "TOOSHI_MAIL failed: <why>" (exit 1).
    python3 -I -B tools/tooshi/tooshi_tell.py --selftest
Standard library only; the self test opens no socket.
"""
import json, os, re, sys, urllib.error, urllib.request

LABEL = "tooshi"
OLD_LABEL = "tooshi-red"
API = "https://api.github.com"
RESEND = "https://api.resend.com/emails"
MAIL_FROM = "TOOSHI <contact@the-horizons-innovation.com>"
MAIL_TO = "thehorizon.nnovation@icloud.com"
MARK = re.compile(r"<!-- tooshi-evidence: ([^>]*) -->")
UA = "tooshi-tell/0.1"


def red_of(res):
    return [x for x in res.get("checks", []) if isinstance(x, dict) and x.get("state") == "red"]


def title_of(res):
    return "TOOSHI red " + str(res.get("checked_at", ""))[:10]


def marker(res):
    return "<!-- tooshi-evidence: %s %s -->" % (str(res.get("checked_at", ""))[:10], " ".join(x["id"] for x in red_of(res)))


def marked(texts):
    s = set()
    for t in texts:
        for m in MARK.finditer(str(t or "")):
            s.update(m.group(1).split()[1:])
    return s


def one_line(s, n=160):
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    return s if len(s) <= n else s[: n - 3] + "..."


def tell_issue(res, body, repo, api, send):
    """(action, number): one issue per red day, a comment when a later run of the day is red in a check not named yet"""
    reds = red_of(res)
    if not reds:
        return "not_red", None
    title = title_of(res)
    try:
        send("POST", "/repos/%s/labels" % repo, {"name": LABEL, "color": "b60205", "description": "TOOSHI: a day with a red check (one issue per day)"})
    except RuntimeError as e:
        if " 422" not in str(e):
            raise
    found = []
    for lb in (LABEL, OLD_LABEL):
        found += [i for i in (api("/repos/%s/issues?labels=%s&state=all&per_page=100" % (repo, lb)) or []) if isinstance(i, dict) and not i.get("pull_request") and i.get("title") == title]
    text = body.rstrip("\n") + "\n\n" + marker(res) + "\n"
    if not found:
        made = send("POST", "/repos/%s/issues" % repo, {"title": title, "body": text, "labels": [LABEL]})
        return "opened", (made or {}).get("number")
    it = sorted(found, key=lambda i: i.get("number") or 0)[0]
    comments = api("/repos/%s/issues/%s/comments?per_page=100" % (repo, it["number"])) or []
    seen = marked([it.get("body")] + [x.get("body") for x in comments if isinstance(x, dict)])
    fresh = [x["id"] for x in reds if x["id"] not in seen]
    if not fresh:
        return "already_told", it["number"]
    send("POST", "/repos/%s/issues/%s/comments" % (repo, it["number"]), {"body": "The same day is red again, now also in %s.\n\n%s" % (", ".join(fresh), text)})
    return "commented", it["number"]


def mail_text(res):
    lines = ["TOOSHI %s: red" % str(res.get("checked_at", ""))[:10], ""]
    lines += ["%s: %s" % (x["id"], one_line(x.get("why"))) for x in red_of(res)]
    return "\n".join(lines) + "\n"


def tell_mail(res, action, key, post):
    if action != "opened":
        return "not_sent", "the day's issue was %s by this run, so the day's mail went out with the run that opened it" % action
    if not red_of(res):
        return "not_sent", "no red check"
    if not key:
        return "not_sent", "RESEND_API_KEY is not set for this workflow"
    s, j = post(RESEND, {"from": MAIL_FROM, "to": [MAIL_TO], "subject": title_of(res), "text": mail_text(res)}, key)
    if s in (200, 201, 202) and isinstance(j, dict) and j.get("id"):
        return "sent", "Resend accepted it"
    return "failed", "Resend answered http %s" % s


def _gh(token):
    hd = {"authorization": "Bearer " + token, "accept": "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": UA}

    def call(method, path, obj=None):
        req = urllib.request.Request(API + path, data=None if obj is None else json.dumps(obj).encode("utf-8"), method=method, headers=dict(hd, **({"content-type": "application/json"} if obj is not None else {})))
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                t = r.read().decode("utf-8")
                return json.loads(t) if t else None
        except urllib.error.HTTPError as e:
            raise RuntimeError("%s %s answered %d" % (method, path, e.code))
    return (lambda path: call("GET", path)), call


def _post(url, obj, key):
    req = urllib.request.Request(url, data=json.dumps(obj).encode("utf-8"), method="POST", headers={"authorization": "Bearer " + key, "content-type": "application/json", "user-agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "null")
    except urllib.error.HTTPError as e:
        return e.code, None
    except (urllib.error.URLError, OSError, ValueError) as e:
        return type(e).__name__, None


def selftest():
    cases = []
    res = {"checked_at": "2026-11-07T04:05:00Z", "verdict": "red", "checks": [
        {"id": "11_main_ci", "state": "red", "why": "a push run on main failed: horizon-shield: public-boundary, job boundary, commit 6a65cef5 (failure)"},
        {"id": "13_line_delivery", "state": "red", "why": "a LINE send failed: hs-kira-line at 2026-11-07T01:12:13Z in followup_touch\nsecond line"},
        {"id": "5_door_runner", "state": "ok", "why": "fine"}]}

    class GH:
        def __init__(self, issues=None):
            self.issues, self.comments, self.calls = list(issues or []), {}, []

        def api(self, path):
            self.calls.append(("GET", path))
            m = re.match(r"^/repos/o/r/issues\?labels=([a-z-]+)&", path)
            if m:
                return [i for i in self.issues if m.group(1) in i["labels"]]
            m = re.match(r"^/repos/o/r/issues/(\d+)/comments", path)
            return [{"body": b} for b in self.comments.get(int(m.group(1)), [])] if m else None

        def send(self, method, path, obj):
            self.calls.append((method, path))
            if path.endswith("/labels"):
                raise RuntimeError("POST /labels answered 422")
            if path.endswith("/issues"):
                n = 40 + len(self.issues)
                self.issues.append({"number": n, "title": obj["title"], "body": obj["body"], "labels": obj["labels"]})
                return {"number": n}
            n = int(re.search(r"/issues/(\d+)/comments", path).group(1))
            self.comments.setdefault(n, []).append(obj["body"])
            return {}
    g = GH()
    a1 = tell_issue(res, "TOOSHI 2026-11-07: red\n", "o/r", g.api, g.send)
    cases.append(("a red day with no issue: one is opened with the label tooshi and a marker naming the red checks",
                  (a1, g.issues[0]["labels"], g.issues[0]["body"].endswith("<!-- tooshi-evidence: 2026-11-07 11_main_ci 13_line_delivery -->\n")), (("opened", 40), ["tooshi"], True)))
    a2 = tell_issue(res, "again\n", "o/r", g.api, g.send)
    cases.append(("the second run of the same day, red in the same checks: nothing new is written", (a2, len(g.issues), dict(g.comments)), (("already_told", 40), 1, {})))
    res3 = dict(res, checks=res["checks"] + [{"id": "15_recovery_fresh", "state": "red", "why": "x"}])
    a3 = tell_issue(res3, "third\n", "o/r", g.api, g.send)
    cases.append(("a later run of the day, red in a check not named yet: one comment naming it", (a3, len(g.comments[40]), "now also in 15_recovery_fresh" in g.comments[40][0]), (("commented", 40), 1, True)))
    cases.append(("after the comment the same run again: nothing", tell_issue(res3, "x", "o/r", g.api, g.send), ("already_told", 40)))
    g2 = GH([{"number": 7, "title": "TOOSHI red 2026-11-07", "body": "old", "labels": ["tooshi-red"]}])
    cases.append(("an issue of the day under the old label tooshi-red is found, not opened twice", (tell_issue(res, "b", "o/r", g2.api, g2.send)[1], len(g2.issues)), (7, 1)))
    g3 = GH([{"number": 8, "title": "TOOSHI red 2026-11-06", "body": "", "labels": ["tooshi"]}])
    cases.append(("another day's issue does not count", tell_issue(res, "b", "o/r", g3.api, g3.send), ("opened", 41)))
    g4 = GH()
    cases.append(("a day without red: no call at all", (tell_issue(dict(res, checks=[res["checks"][2]]), "b", "o/r", g4.api, g4.send), g4.calls), (("not_red", None), [])))
    sent = []

    def post(url, obj, key):
        sent.append((url, obj, key))
        return 200, {"id": "m1"}
    r1 = tell_mail(res, "opened", "k", post)
    u, o, k = sent[0]
    cases.append(("the run that opened the issue sends one mail to the owner from contact@, subject TOOSHI red <day>",
                  (r1[0], u, o["from"], o["to"], o["subject"]), ("sent", RESEND, MAIL_FROM, [MAIL_TO], "TOOSHI red 2026-11-07")))
    cases.append(("the mail has the red checks' ids and one line each, nothing else",
                  o["text"], "TOOSHI 2026-11-07: red\n\n11_main_ci: a push run on main failed: horizon-shield: public-boundary, job boundary, commit 6a65cef5 (failure)\n13_line_delivery: a LINE send failed: hs-kira-line at 2026-11-07T01:12:13Z in followup_touch second line\n"))
    seen_k = []
    tell_mail(res, "opened", "rk_TESTKEY_0123", lambda u, o, k: (seen_k.append((json.dumps(o), k)) or (200, {"id": "m2"})))
    cases.append(("the key goes only to the request header, never into the mail", ("rk_TESTKEY" in seen_k[0][0], seen_k[0][1]), (False, "rk_TESTKEY_0123")))
    cases.append(("a reason longer than 160 characters is cut", len(one_line("x" * 400)), 160))
    cases.append(("a run that commented or found the day told sends no mail", (tell_mail(res, "commented", "k", post)[0], tell_mail(res, "already_told", "k", post)[0], len(sent)), ("not_sent", "not_sent", 1)))
    cases.append(("no RESEND_API_KEY: not sent, and it says why", tell_mail(res, "opened", "", post), ("not_sent", "RESEND_API_KEY is not set for this workflow")))
    cases.append(("Resend refuses: failed with its http status", tell_mail(res, "opened", "k", lambda u, o, k: (403, {"message": "x"})), ("failed", "Resend answered http 403")))
    bad = [n for n, got, want in cases if got != want]
    for n, got, want in cases:
        print(("  ok   " if got == want else "  NG   ") + n + ("" if got == want else " (got %r, want %r)" % (got, want)))
    print("tooshi_tell selftest %d / %d %s" % (len(cases) - len(bad), len(cases), "all green" if not bad else "NG"))
    return 1 if bad else 0


def main(argv):
    if argv == ["--selftest"]:
        return selftest()
    if not argv or argv[0] not in ("issue", "mail"):
        print(__doc__)
        return 2
    a = dict(zip(argv[1::2], argv[2::2]))
    try:
        res = json.load(open(a["--result"], encoding="utf-8"))
    except (KeyError, OSError, ValueError) as e:
        print("tooshi_tell: --result could not be read (%s)" % type(e).__name__)
        return 2
    if argv[0] == "issue":
        repo, token = os.environ.get("GITHUB_REPOSITORY"), os.environ.get("GITHUB_TOKEN")
        if not repo or not token or "--body" not in a:
            print("tooshi_tell issue: GITHUB_REPOSITORY, GITHUB_TOKEN and --body are required")
            return 2
        api, send = _gh(token)
        action, num = tell_issue(res, open(a["--body"], encoding="utf-8").read(), repo, api, send)
        if a.get("--out"):
            open(a["--out"], "w", encoding="utf-8").write(action + "\n")
        print("TOOSHI_ISSUE %s #%s %s" % (action, num, title_of(res)))
        return 0
    st, why = tell_mail(res, a.get("--issue-action", "").strip(), os.environ.get("RESEND_API_KEY", "").strip(), _post)
    print("TOOSHI_MAIL %s: %s" % (st, why))
    return 1 if st == "failed" else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
