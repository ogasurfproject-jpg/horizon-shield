#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SEKI heartbeat: the first door works every day, whether or not anyone else calls it, and every day is settled.

The door (hs-seki-door) stands in front of HORIZON SHIELD's own paid tool, hs-gateway /report, for the store
hs-seki-demo, under the demonstration contract musubi-v0/seki_demo_v2/contract.json (before 2026-11-12,
musubi-v0/run0003/contract.json; a day is settled under the contract its records name). Principal, agent and door are all
The HORIZONs Co., Ltd., and the contract says so. A door that is only exercised on the day it was built proves little,
so once a day this file does two things, and the scheduled workflow .github/workflows/seki-heartbeat.yml commits what
they wrote under runs/<day>/, the UTC day the run is for (see responsible_day):

  run      The agent makes the same three calls as run0003, each with a fresh nonce:
             report   20 tickets, the limit is 20      must be admitted, run, and filed as an execution record; its
                                                       payload is inside the contract's grant.payload_schema
             audit    30 tickets, prohibited           must be refused prohibited_action, nothing spent
             compare  50 tickets, prohibited           must be refused prohibited_action, nothing spent
           (Under run0003, before 2026-11-12, audit was authorized up to 25 tickets and refused amount_over_limit.)
           Every record the door signs is checked here under the key keys/seki-door.json publishes and must be on
           the ledger. Anything other than the expected answer is a failure (exit 1), so a broken door shows up as a
           failed run, not as a quiet gap. Every call carries its payload as content for the door's content check
           (FURUI); the door reads it only where its policy (GET /seki) requires the check (see the note at PAYLOAD).
  settle   Every earlier day whose records the ledger has batched and Bitcoin has confirmed is settled with
           settle v1.20 (and v1.12, which must agree on the verdict). Before admission v0.5 it was v1.15; v1.20 gives the
           same verdict, status and deviations on every day settled with v1.15 (self test [16]). The anchors are composed with anchor_compose
           from the ledger's own batch bytes and .ots proofs; the header view comes from two explorers, extended
           from final headers kept in view-chunks/ (written once, never rewritten) and checked again in full every time. Days not yet confirmed are left for a
           later run. settlement.json and the anchored records are written next to the day's records.
  mismatch After the three calls of run, one more call (2026-11-07): compare with seki.content a copy of its payload and a
           body payload that differs from it. The gateway must refuse it 400 content_mismatch before the door is asked,
           so nothing is spent and no record is signed (see the note at MISMATCH). It is filed in RUN.json under calls
           with scene "mismatch"; settle and the index read only the three calls that reached the door.

Only the agent's key is used here (SEKI_AGENT_SEED_B64, the 32 byte Ed25519 seed in base64, from the repository's
Actions secrets) with the store's gateway token (HSG_STORE_TOKEN). The agent can do nothing the contract does not
allow and the tickets of the pilot carry no monetary value. The door's key never leaves Cloudflare and is not here.

  python3 heartbeat.py run    [--root runs] [--date YYYY-MM-DD]
  python3 heartbeat.py gaps   [--root runs] [--through YYYY-MM-DD] [--days 7] [--json out.json]
  python3 heartbeat.py settle [--root runs] [--view-chunks view-chunks]
  python3 heartbeat.py --selftest
"""
import argparse, base64, contextlib, datetime, hashlib, json, os, secrets, signal, sys, tempfile, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
MUSUBI = os.path.normpath(os.path.join(HERE, "..", "musubi-v0"))
REPO = os.path.normpath(os.path.join(HERE, "..", "..", "..", ".."))
sys.path.insert(0, MUSUBI)
import admission_verify_v0 as A  # noqa: E402
import anchor_compose as AC  # noqa: E402
import header_view_fetch as HV  # noqa: E402
import peer_kit  # noqa: E402
import settle_v1_1 as v11  # noqa: E402
import settle_v1_12 as s12  # noqa: E402
import settle_v1_15 as s15  # noqa: E402
import settle_v1_20 as s20  # noqa: E402
from contract_v0 import canonical, contract_sha256, parse_strict  # noqa: E402

CONTRACT_PATH = os.path.join(MUSUBI, "seki_demo_v2", "contract.json")
# the contracts a day's records may name, newest first: a day is settled under the one its admissions name (contract_for)
CONTRACT_PATHS = (CONTRACT_PATH, os.path.join(MUSUBI, "run0003", "contract.json"))
GATEWAY = "https://hs-gateway.oga-surf-project.workers.dev"
LEDGER = "https://ledger.horizonshield.dev"
AGREEMENT = "https://agreement.horizonshield.dev"
STORE = "hs-seki-demo"
TARGET = GATEWAY + "/report?store=" + STORE
DOOR_DOMAIN = "shield.the-horizons-innovation.com"
DISCLOSURE = ("a demonstration: the principal, the contractor and the relying party are all The HORIZONs Co., Ltd.; "
              "the door is exercised every day on its own paid path; this is not an arm's-length agreement and the pilot's "
              "tickets carry no monetary value")
EXPECT = [("report", 20, "admit", ["within_grant"], 200),
          ("audit", 30, "refuse", ["prohibited_action"], 403),
          ("compare", 50, "refuse", ["prohibited_action"], 403)]
PAYLOAD = {
    "report": {"koji_type": "gaiheki_30tsubo", "teiji_kingaku": 1200000},
    "audit": {"note": "SEKI heartbeat: the door refuses this call, so no report is made and nothing is spent"},
    "compare": {"note": "SEKI heartbeat: the door refuses this call, so no report is made and nothing is spent"},
}
# 2026-11-07. The door can require the content check (FURUI) for a store. It then sends submission.content to its runner
# itself and builds the admission's content block from the runner's signed envelope; a caller cannot bring an envelope
# (the door drops submission.furui). So every call carries content, the payload it sends to /report. Whether the door
# reads it is the door's policy, read once per run from GET /seki (the door's /policy); a run that cannot read it makes
# no call. While the store does not require the check the door ignores content and the reasons must match exactly, as
# before. When it does, the reasons the door adds for the content are allowed only where they change nothing: an admit
# may carry content_off_topic (admission v0.4 keeps it on an admit), a refusal may carry any content_ reason besides its
# own, and the admitted call's record must name a checked content block (content.checked, a 64 hex check_sha256).
# Admission v0.5 (FURUI 1.0). A door with more than one runner writes admission v0.5: the content block has no check_sha256 of its own but
# checks[], one per runner. Both are read: a v0.4 record must name its check_sha256 as above, a v0.5 record must be checked
# and name a 64 hex check_sha256 for every check it read as an answer (why ok), and at least one.
H64 = set("0123456789abcdef")
UA = "seki-heartbeat/1 (+https://github.com/ogasurfproject-jpg/horizon-shield)"
# 2026-10-19: locate() used to look at the newest 40 entries only. Once the ledger head passed 120, the batch holding
# 2026-10-10's admissions (entry 80) fell out of reach and that day could never settle, although it had settled in a
# dry run hours before. A day is now looked for down to entry 1; entries are fetched once per settle run and shared by
# every day (the ledger had about 120 entries on that day).

# 2026-11-07. The scene mismatch. The gateway runs a guarded /report only when the payload that runs (the body without seki)
# is seki.content as canonical bytes, and answers 400 content_mismatch otherwise, before the door and before any spend.
# The scene sends compare (the contract prohibits it, so even a gateway without the match spends nothing: the door
# refuses prohibited_action) with seki.content PAYLOAD["compare"] and a body whose note differs. Expected: HTTP 400,
# error content_mismatch, no X-Tickets-Spent, no X-Seki-Decision (the door was not asked). A 403 means the door answered,
# so the match is not on the gateway that runs: a failure. GET /health says whether the gateway carries the match
# (seki_content_match true); while it does not, the scene is not run and RUN.json says not_yet, which is not a failure
# (a run before the gateway is deployed). The scene's result is kept apart from the three calls' result, which settle
# reads, so a gateway fault never holds back the settlement of the door's records; it still fails the run (exit 1).
MISMATCH_SERVICE, MISMATCH_TICKETS = "compare", 50
MISMATCH_NOTE = "SEKI heartbeat, scene mismatch: this body is not its seki.content, so the gateway refuses it before the door"


def http(method, url, body=None, headers=None, timeout=120):
    data = body if isinstance(body, (bytes, type(None))) else body.encode("utf-8")
    rq = urllib.request.Request(url, data=data, headers=dict({"user-agent": UA}, **(headers or {})), method=method)
    try:
        with urllib.request.urlopen(rq, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def jl(b):
    try:
        return json.loads(b)
    except Exception:
        return None


def rd(p):
    return parse_strict(open(p, encoding="utf-8").read())


def door_key():
    k = json.load(open(os.path.join(REPO, "keys", "seki-door.json"), encoding="utf-8"))
    return k["public_key_ed25519_b64"]


def tip_height():
    """The lower of the two explorers' tips; both must answer."""
    tips = [int(HV._get(base + "/blocks/tip/height").strip()) for base in HV.SOURCES.values()]
    return min(tips)


# --------------------------------------------------------------------------- the batch window
# 2026-10-21. settle v1.11 and later call a day admission_after_execution when the admission's Bitcoin block is above
# the execution's, because then the public record cannot show that the door answered first. The two records go to two
# pools that are cut at two times: the ledger batches admissions at 00:30 UTC, the MUSUBI intake batches executions at
# 00:45 UTC. A run whose calls land between the two cuts puts the execution into tonight's 00:45 batch and the admission
# into tomorrow's 00:30 batch, a day above it. That happened on 2026-10-20 (calls at 00:30:1x, admissions in entry 129,
# the execution in entry 126). 2026-10-19 went the same way for another reason: the intake was cut by hand at 11:38 UTC
# (entry 120) while that day's admission still waited for 00:30. So the calls are never made between 00:20 and 00:55
# UTC, and the intake is never cut by hand while an admission of the same day is waiting (see README.md).
WINDOW_FROM, WINDOW_TO = (0, 20), (0, 55)


def window_wait(now):
    """Seconds to wait before the calls so that they land outside 00:20 to 00:55 UTC (0 when already outside)."""
    t = now.astimezone(datetime.timezone.utc)
    lo = t.replace(hour=WINDOW_FROM[0], minute=WINDOW_FROM[1], second=0, microsecond=0)
    hi = t.replace(hour=WINDOW_TO[0], minute=WINDOW_TO[1], second=0, microsecond=0)
    return int((hi - t).total_seconds()) + 1 if lo <= t < hi else 0


# --------------------------------------------------------------------------- the day a run is for
# 2026-10-24. The schedule is 21:17 UTC and GitHub starts it up to about three hours late. The day used to be the UTC
# date when the run started, so a run that started after midnight took the next day's name, and the next evening's run
# found that name taken, printed "already ran" and was green although nothing was done: 2026-10-20 (started 23:56:20Z,
# runs/2026-10-20 held the run that started 00:24:25Z for 10-19) and 2026-10-23 (started 23:52:15Z, runs/2026-10-23 held
# the run that started 00:00:08Z for 10-22); runs/2026-10-21 does not exist. Now the day is the UTC date six hours
# before the start: a run started from 21:17 to 06:00 the next morning is for the day it was scheduled on.
# RUN.json written from now on says so (day_rule). The older ones are read by their ran_at with the same rule.
DAY_RULE = "utc-date-of-start-minus-6h"
DAY_SHIFT_HOURS = 6
GAPS_FROM = "2026-10-11"            # the first day the heartbeat ran on its schedule


def responsible_day(now):
    """The UTC day a run started at `now` is for."""
    return (now.astimezone(datetime.timezone.utc) - datetime.timedelta(hours=DAY_SHIFT_HOURS)).strftime("%Y-%m-%d")


def day_of_run(r):
    """The day a RUN.json covers: its date under the day rule, else the day of its ran_at (older runs)."""
    if r.get("day_rule") == DAY_RULE and isinstance(r.get("date"), str):
        return r["date"]
    try:
        return responsible_day(datetime.datetime.strptime(r["ran_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc))
    except (KeyError, TypeError, ValueError):
        return None


def covered_days(root):
    """{day: [folder, ...]} for every RUN.json under root."""
    out = {}
    if not os.path.isdir(root):
        return out
    for d in sorted(os.listdir(root)):
        p = os.path.join(root, d, "RUN.json")
        if len(d) != 10 or not os.path.exists(p):
            continue
        try:
            day = day_of_run(json.load(open(p, encoding="utf-8")))
        except (ValueError, OSError):
            day = None
        if day:
            out.setdefault(day, []).append(d)
    return out


def gaps(root, through, days=7):
    """Days from max(GAPS_FROM, through - days + 1) to through that no RUN.json covers."""
    end = datetime.datetime.strptime(through, "%Y-%m-%d")
    cov = covered_days(root)
    out = []
    for i in range(days - 1, -1, -1):
        d = (end - datetime.timedelta(days=i)).strftime("%Y-%m-%d")
        if d >= GAPS_FROM and d not in cov:
            out.append(d)
    return out


# --------------------------------------------------------------------------- the content check
def is_h64(x):
    return isinstance(x, str) and len(x) == 64 and set(x) <= H64


def door_furui_required(policy, store=STORE):
    """Whether the door's policy (GET /seki) requires the content check for store: the store's own policy.furui.required
    when the door shows one, else whether .furui.stores_requiring names the store (the stores whose own policy requires
    it), else the door's default .furui.policy.required. Raises ValueError when the policy does not say."""
    if not isinstance(policy, dict) or not isinstance(policy.get("stores"), list):
        raise ValueError("the door policy has no list of stores")
    mine = [s for s in policy["stores"] if isinstance(s, dict) and s.get("store") == store]
    if len(mine) != 1:
        raise ValueError("the door policy lists the store %s %d times" % (store, len(mine)))
    own = mine[0].get("policy")
    own = own.get("furui") if isinstance(own, dict) else None
    if isinstance(own, dict) and isinstance(own.get("required"), bool):
        return own["required"]
    fu = policy.get("furui")
    if not isinstance(fu, dict):
        raise ValueError("the door policy has no furui block")
    if isinstance(fu.get("stores_requiring"), list) and store in fu["stores_requiring"]:
        return True
    dp = fu.get("policy")
    if isinstance(dp, dict) and isinstance(dp.get("required"), bool):
        return dp["required"]
    raise ValueError("the door policy does not say whether %s requires the content check" % store)


def read_door_policy(get=None):
    """(required, problem): the door's policy for this store, read once per run. problem is None when it was read."""
    get = get or (lambda u: http("GET", u))
    try:
        st, _h, b = get(GATEWAY + "/seki")
    except Exception as e:
        return None, "GET /seki did not answer (%s)" % type(e).__name__
    if st != 200:
        return None, "GET /seki answered http %s" % st
    try:
        return door_furui_required(jl(b)), None
    except ValueError as e:
        return None, "GET /seki: %s" % e


def reasons_hold(decision, reasons, want_decision, want_reasons, required):
    """Whether the record's decision and reasons are the expected ones (see the note at PAYLOAD)."""
    if decision != want_decision or not isinstance(reasons, list) or len(set(map(str, reasons))) != len(reasons):
        return False
    if not required:
        return reasons == want_reasons
    if want_decision == "admit":
        return reasons in (want_reasons, want_reasons + ["content_off_topic"])
    return all(r in reasons for r in want_reasons) and all(isinstance(r, str) and (r in want_reasons or r.startswith("content_")) for r in reasons)


def content_checks(rec):
    """[(runner_id, check_sha256)] of the checks a v0.5 record read as answers (why ok), or None when the record is not
    v0.5 or its block has no list of checks. A check_sha256 that is not 64 hex is kept as None."""
    rules = rec.get("rules") if isinstance(rec, dict) and isinstance(rec.get("rules"), dict) else {}
    cb = rec.get("content") if isinstance(rec, dict) and isinstance(rec.get("content"), dict) else None
    if rules.get("version") != "0.5" or cb is None or not isinstance(cb.get("checks"), list):
        return None
    return [(k.get("runner_id"), k.get("check_sha256") if is_h64(k.get("check_sha256")) else None)
            for k in cb["checks"] if isinstance(k, dict) and k.get("why") == "ok"]


def judge_record(service, rec, want_decision, want_reasons, required):
    """[(name, ok, detail)] for one signed record, and the content block's check_sha256 (None when it names none; for a
    v0.5 record, the list content_checks gives)."""
    cb = rec.get("content") if isinstance(rec, dict) and isinstance(rec.get("content"), dict) else None
    ks = content_checks(rec)
    ck = ks if ks is not None else (cb.get("check_sha256") if cb is not None and is_h64(cb.get("check_sha256")) else None)
    d, r = (rec.get("decision"), rec.get("reasons")) if isinstance(rec, dict) else (None, None)
    allowed = "" if not required else (" (content_off_topic allowed)" if want_decision == "admit" else " (content_ reasons allowed besides)")
    out = [("%s: decision %s, reasons %s%s" % (service, want_decision, want_reasons, allowed), reasons_hold(d, r, want_decision, want_reasons, required), (d, r))]
    if required and want_decision == "admit" and ks is not None:
        out.append(("%s: the door checked the content (content.checked, a 64 hex check_sha256 for each check read as an answer)" % service,
                    cb.get("checked") is True and bool(ks) and all(h is not None for _rid, h in ks), cb))
    elif required and want_decision == "admit":
        out.append(("%s: the door checked the content (content.checked, a 64 hex content.check_sha256)" % service,
                    cb is not None and cb.get("checked") is True and ck is not None, cb))
    return out, ck


def call_body(service, req, contract):
    """The /report body of one call: the payload, and seki with the signed request, the contract and the payload as content."""
    return dict(PAYLOAD[service], seki={"action_request": req, "presentation": [{"adapter": "musubi-native", "material": {"contract": contract}}],
                                        "content": dict(PAYLOAD[service])})


def mismatch_body(req, contract):
    """The scene mismatch: seki.content is a copy of PAYLOAD["compare"], the body's own payload differs from it (its note)."""
    body = call_body(MISMATCH_SERVICE, req, contract)
    body["note"] = MISMATCH_NOTE
    return body


def gateway_content_match(get=None):
    """(True, None) when GET {GATEWAY}/health says seki_content_match true, else (False, why). Never raises."""
    get = get or (lambda u: http("GET", u))
    try:
        st, _h, b = get(GATEWAY + "/health")
    except Exception as e:
        return False, "GET /health did not answer (%s)" % type(e).__name__
    j = jl(b) if st == 200 else None
    if isinstance(j, dict) and j.get("seki_content_match") is True:
        return True, None
    return False, "GET /health answered http %s without seki_content_match true: the gateway has no content match yet" % st


def judge_mismatch(st, hl, body):
    """[(name, ok, detail)] for the scene's answer: HTTP 400 content_mismatch, nothing spent, the door not asked."""
    j = jl(body) if isinstance(body, (bytes, str)) else None
    err = j.get("error") if isinstance(j, dict) else None
    why = "" if st != 403 else " (403: the door answered, so the gateway that runs has no content match)"
    return [("mismatch: HTTP 400 content_mismatch from the gateway%s" % why, st == 400 and err == "content_mismatch", (st, (body or b"")[:300])),
            ("mismatch: nothing was spent", "x-tickets-spent" not in hl, hl.get("x-tickets-spent")),
            ("mismatch: the door was not asked (no X-Seki-Decision)", "x-seki-decision" not in hl, hl.get("x-seki-decision"))], err


def mismatch_scene(contract, key, expiry, token, check, get=None, post=None):
    """Run the scene mismatch after the three calls: (the row for RUN.json calls, the scene's result). check(name, ok, detail)
    is run()'s, so a failure here fails the run. Never raises: the three calls are filed already."""
    post = post or (lambda url, body: http("POST", url, body, {"content-type": "application/json", "x-store-token": token}))
    scene = {"service": MISMATCH_SERVICE, "scene": "mismatch", "tickets": MISMATCH_TICKETS, "status": None, "error": None}
    ready, not_yet = gateway_content_match(get)
    if not ready:
        scene["not_yet"] = not_yet
        print("not yet: the scene mismatch was not run (%s)" % not_yet)
        return scene, "not_yet"
    nonce = secrets.token_hex(16)
    req = A.build_action_request(contract, MISMATCH_SERVICE, nonce, expiry, key, target=TARGET, amount=MISMATCH_TICKETS)
    try:
        st, hd, rb = post("%s/report?store=%s&service=%s" % (GATEWAY, STORE, MISMATCH_SERVICE), json.dumps(mismatch_body(req, contract)))
    except Exception as e:
        st, hd, rb = None, {}, ("did not answer (%s)" % type(e).__name__).encode()
    hl = {k.lower(): v for k, v in hd.items()}
    judged, err = judge_mismatch(st, hl, rb)
    scene.update(nonce=nonce, request_sha256=hashlib.sha256(canonical(req).encode()).hexdigest(), status=st, error=err,
                 decision=hl.get("x-seki-decision"), tickets_spent=hl.get("x-tickets-spent"))
    bad = [name for name, ok, detail in judged if not check(name, ok, detail)]
    return scene, "as expected" if not bad else "NOT as expected: " + "; ".join(bad)


def contract_on_file(ctext, post=None):
    """(ok, detail): the agreement intake holds the contract, or files it now. Asked BEFORE any call is made (2026-11-13).
    On 2026-11-12 the intake's checker did not know two grant keys of the new contract and refused it (422
    grant_key_unknown). The calls were made anyway, so the paid call was admitted and executed, and its execution record
    could then not be filed (409 contract_not_filed): a paid call with no settlement, on a day that is written once. Now a
    refusal, an error or no answer stops the run before the first call: nothing is spent, no admission is made, no
    RUN.json is written, and a later run for the same day (the late fallback cron, or a run by hand) can still make the
    calls once the intake accepts the contract."""
    post = post or (lambda u, body: http("POST", u, body, {"content-type": "application/json"}))
    try:
        st, _h, b = post(AGREEMENT + "/contract", ctext.encode("utf-8"))
    except Exception as e:
        return False, "POST /contract did not answer (%s)" % type(e).__name__
    j = jl(b) or {}
    ok = st in (200, 201, 409) and isinstance(j, dict) and (j.get("verdict") == "accepted" or j.get("dedup") is True)
    return ok, (st, (b or "")[:300])


FILE_TRIES, FILE_WAIT = 4, 15


def file_execution(etext, post=None, sleep=time.sleep, tries=FILE_TRIES, wait=FILE_WAIT):
    """(ok, detail, attempts): the execution record is on file at the agreement intake. The paid call is already made when
    this is asked, so an answer that may pass (no answer, 408, 429, a 5xx) is asked again, up to `tries` times, `wait`
    seconds apart, with the same bytes; the intake takes a record it already holds as a dedup, so a repeat cannot file it
    twice. A refusal (any other 4xx, for example 409 contract_not_filed or 422) is final and not asked again. It never
    raises: http() raises when the intake does not answer, and before this function that left run() after the paid call and
    before RUN.json was written, so the day would have had a call and no day file. The day's record keeps its shape."""
    post = post or (lambda u, body: http("POST", u, body, {"content-type": "application/json"}))
    body, detail, n = etext.encode("utf-8"), None, 0
    while n < max(1, tries):
        n += 1
        try:
            st, _h, b = post(AGREEMENT + "/execution", body)
        except Exception as e:
            st, b, detail = None, "", "POST /execution did not answer (%s)" % type(e).__name__
        else:
            j = jl(b) or {}
            if st in (201, 409) and isinstance(j, dict) and (j.get("verdict") == "accepted" or j.get("dedup") is True):
                return True, (st, (b or "")[:300]), n
            detail = (st, (b or "")[:300])
        if not (st is None or st in (408, 429) or (isinstance(st, int) and 500 <= st <= 599)) or n >= max(1, tries):
            break
        sleep(wait)
    return False, detail, n


def close_raised_day(record, call, sent, err, fails):
    """True when run() raised after a call was sent, and then `record` is made ready to be written as the day's RUN.json.

    Before this, an error between the first call and RUN.json (the gateway, the ledger or the chain tip not answering)
    left the day's folder without RUN.json: the next run for the day made the calls again, so a paid call could be made
    twice, and the first one was named by no day file and so was seen by no later check. Now such a day is closed as
    NOT as expected with the calls it holds, like any other failed day, and "nothing is spent twice" holds.
    When nothing was sent (sent == 0) it returns False and changes nothing: run() raises as before, the day is not
    written, and a later run can still make the calls. The record gets no new key."""
    if not sent or not isinstance(record, dict):
        return False
    if call is not None and all(c is not call for c in record["calls"]):
        record["calls"].append(call)
    why = "the run raised %s after %d of the day's calls were sent" % (type(err).__name__, sent)
    fails.append(why)
    if "result" not in record:
        record["result"] = "NOT as expected: " + "; ".join(fails)
        record.setdefault("scene_result", "not run: " + why)
    else:                                   # the three calls were judged; it was the scene mismatch that raised
        record["scene_result"] = "NOT as expected: " + why
    return True


class Terminated(SystemExit):
    """SIGTERM inside run(): raised by the handler run() sets, so a stop from outside takes the same path as Ctrl-C."""


def _terminated(signum, _frame):
    raise Terminated(128 + signum)


@contextlib.contextmanager
def signals_held():
    """SIGINT and SIGTERM wait (blocked, not lost) while the day's RUN.json is being closed and written, and arrive after it.
    A cancel on GitHub Actions sends SIGINT and, a few seconds later, SIGTERM: the second must not cut the first one's
    writing of the day file short."""
    mask = getattr(signal, "pthread_sigmask", None)
    if mask is None:
        yield
        return
    old = mask(signal.SIG_BLOCK, {signal.SIGINT, signal.SIGTERM})
    try:
        yield
    finally:
        mask(signal.SIG_SETMASK, old)


def door_calls(r):
    """The calls of a RUN.json that reached the door (the three of EXPECT). A row with a scene (mismatch, 2026-11-07) asked
    the gateway only: no record, nothing to settle, no cell in the index."""
    return [c for c in (r.get("calls") or []) if isinstance(c, dict) and not c.get("scene")]


# --------------------------------------------------------------------------- run
def run(root, date, now=None, sleep=time.sleep):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    out = os.path.join(root, date)
    if os.path.exists(os.path.join(out, "RUN.json")):
        prev = json.load(open(os.path.join(out, "RUN.json"), encoding="utf-8"))
        held = day_of_run(prev) or date          # a RUN.json without ran_at says nothing else; its folder name stands
        if held != date:
            # The folder name is taken by a run for another day (named by the older rule). Doing nothing here would be
            # the silent green of 2026-10-20 and 2026-10-23, so this is a failure, and gaps() reports the day.
            print("FAIL: runs/%s already holds the run for %s (started %s); the calls for %s were NOT made" % (date, held, prev.get("ran_at"), date))
            return 1
        print("already ran for %s (%s); nothing is spent twice" % (date, prev.get("result")))
        return 0 if prev.get("result") == "as expected" and not str(prev.get("scene_result") or "").startswith("NOT") else 1
    wait = window_wait(now or datetime.datetime.now(datetime.timezone.utc))
    if wait:
        print("waiting %d s: between 00:20 and 00:55 UTC the admission and the execution would land in batches a day apart" % wait)
        sleep(wait)
    seed_b64 = os.environ.get("SEKI_AGENT_SEED_B64", "").strip()
    token = os.environ.get("HSG_STORE_TOKEN", "").strip()
    if not seed_b64 or not token:
        print("FAIL: SEKI_AGENT_SEED_B64 and HSG_STORE_TOKEN are required (repository Actions secrets)")
        return 1
    seed = base64.b64decode(seed_b64, validate=True)
    if len(seed) != 32:
        print("FAIL: SEKI_AGENT_SEED_B64 is not a 32 byte seed")
        return 1
    key = Ed25519PrivateKey.from_private_bytes(seed)
    agent_pub = base64.b64encode(key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
    ctext = open(CONTRACT_PATH, encoding="utf-8").read()
    contract = parse_strict(ctext)
    csha = contract_sha256(contract)
    door_pub = door_key()
    fails = []

    def check(name, cond, detail=""):
        print(("ok   " if cond else "NG   ") + name + ("" if cond else "   <<< " + str(detail)[:400]))
        if not cond:
            fails.append(name)
        return cond

    contractor = next(p for p in contract["parties"] if p["role"] == "contractor")
    if not check("the secret is the contractor key the contract pins", contractor["public_key_ed25519_b64"] == agent_pub):
        return 1
    st, _h, b = http("GET", "%s/balance?store=%s" % (GATEWAY, STORE), headers={"x-store-token": token})
    bal = (jl(b) or {}).get("tickets")
    if not check("the store holds at least the 20 tickets the report needs (balance %s)" % bal, st == 200 and isinstance(bal, int) and bal >= 20, (st, b[:200])):
        return 1
    required, problem = read_door_policy()
    if not check("the door's policy says whether %s requires the content check (required %s)" % (STORE, required), problem is None, problem):
        return 1
    on_file, detail = contract_on_file(ctext)
    if not check("the contract is on file at the agreement intake", on_file, detail):
        print("FAIL: the agreement intake does not hold the contract, so no call is made: nothing is spent, no admission is made and the day is not written. Run again when the intake accepts the contract (see contract_on_file)")
        return 1
    os.makedirs(out, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="seki-heartbeat-")
    pem = os.path.join(tmp, "agent.pem")
    fd = os.open(pem, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    record, call, sent, old_term = None, None, 0, None
    try:
        # 2026-11-14. A stop from outside (Ctrl-C, or the SIGINT and then SIGTERM of a cancelled or timed out job) after a call
        # was sent closes the day like any other raise (close_raised_day); before this, KeyboardInterrupt and SystemExit
        # passed the except below and SIGTERM ended the process at once, so the day was not written and a later run made the
        # calls again. Before any call is sent it still writes nothing and the stop goes on as before.
        try:
            old_term = signal.signal(signal.SIGTERM, _terminated)
        except ValueError:                  # not the main thread: SIGTERM keeps its own handling
            old_term = None
        record = {"schema": "seki-heartbeat-run-v0", "note": DISCLOSURE, "date": date, "day_rule": DAY_RULE, "contract_sha256": csha, "store": STORE,
                  "target": TARGET, "door_public_key_ed25519_b64": door_pub, "gateway": GATEWAY, "balance_before": bal, "door_furui_required": required,
                  "ran_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "calls": []}
        tip = tip_height()
        expiry = tip + 18
        record["tip_height_at_request"] = tip
        for service, price, want_decision, want_reasons, want_status in EXPECT:
            nonce = secrets.token_hex(16)
            req = A.build_action_request(contract, service, nonce, expiry, key, target=TARGET, amount=price)
            body = call_body(service, req, contract)
            # 2026-11-14. The call's row (its nonce and request_sha256, the answer's fields null) and request_<service>.json are
            # in place before the call is sent, so a call that gets no answer is still named by the day file; the answer
            # fills the row. The row has the keys it always had.
            call = {"service": service, "tickets": price, "request_sha256": hashlib.sha256(canonical(req).encode()).hexdigest(), "nonce": nonce,
                    "status": None, "decision": None, "admission_sha256": None, "record_sha256": None, "published": None, "tickets_spent": None,
                    "door_furui_required": required}
            record["calls"].append(call)
            with open(os.path.join(out, "request_%s.json" % service), "w", encoding="utf-8") as f:
                f.write(canonical(req))
            sent += 1
            st, hd, rb = http("POST", "%s/report?store=%s&service=%s" % (GATEWAY, STORE, service), json.dumps(body),
                              {"content-type": "application/json", "x-store-token": token})
            hl = {k.lower(): v for k, v in hd.items()}
            call.update(status=st, decision=hl.get("x-seki-decision"), admission_sha256=hl.get("x-seki-admission-sha256"),
                        record_sha256=hl.get("x-seki-record-sha256"), published=hl.get("x-seki-published"), tickets_spent=hl.get("x-tickets-spent"))
            check("%s: HTTP %d" % (service, want_status), st == want_status, (st, rb[:300]))
            rec = None
            if st == 200:
                call["report_sha256"] = hashlib.sha256(rb).hexdigest()
                check("%s: a PDF came back and %d tickets were spent" % (service, price), rb[:4] == b"%PDF" and hl.get("x-tickets-spent") == str(price), (rb[:20], hl.get("x-tickets-spent")))
            else:
                check("%s: nothing was spent" % service, "x-tickets-spent" not in hl)
            rs = call["record_sha256"]
            check("%s: the door named its signed record (decision %s)" % (service, want_decision), call["decision"] == want_decision and isinstance(rs, str) and len(rs) == 64, call)
            if isinstance(rs, str) and len(rs) == 64:
                # 2026-11-14. Every read after the call (the door's record, its parse and checks, the ledger) is a check: an
                # error there fails the check and the run goes on, so an admitted call reaches its execution record whenever
                # the door's record could be read. Before this, an error here left run() before the filing.
                gst, gb = None, b""
                for _ in range(3):
                    try:
                        gst, _, gb = http("GET", "%s/seki/record/%s" % (GATEWAY, rs))
                    except Exception as e:
                        gst, gb = "did not answer (%s)" % type(e).__name__, b""
                    if gst == 200:
                        break
                    sleep(5)
                check("%s: the door serves the record by its sha256" % service, gst == 200 and hashlib.sha256(gb).hexdigest() == rs, gst)
                if gst == 200:
                    try:
                        rec = parse_strict(gb.decode("utf-8"))
                        with open(os.path.join(out, "admission_%s.json" % service), "w", encoding="utf-8") as f:
                            f.write(gb.decode("utf-8"))
                    except Exception as e:
                        rec = None
                        check("%s: the door's record is read (%s)" % (service, type(e).__name__), False, str(e)[:200])
                if rec is not None:
                    try:
                        v = A.verify_admission(rec, door_pub, contract)
                        check("%s: the record verifies under the door's published key" % service, v.get("verdict") == "accepted", v)
                        judged, ck = judge_record(service, rec, want_decision, want_reasons, required)
                        for name, ok, detail in judged:
                            check(name, ok, detail)
                        if isinstance(ck, list):
                            call["content_checks"] = [{"runner_id": rid, "check_sha256": h} for rid, h in ck]
                        elif ck is not None:
                            call["content_check_sha256"] = ck
                    except Exception as e:
                        check("%s: the record was checked (verify and judge)" % service, False, "%s: %s" % (type(e).__name__, str(e)[:200]))
                lst = None
                for _ in range(6):
                    try:
                        lst, _, _ = http("GET", "%s/admission/%s" % (LEDGER, rs))
                    except Exception as e:
                        lst = "did not answer (%s)" % type(e).__name__
                    if lst == 200:
                        break
                    sleep(5)
                check("%s: the ledger holds the record" % service, lst == 200, lst)
                call["ledger_url"] = LEDGER + "/admission/" + rs
            if st == 200 and rec is None:
                check("%s: the execution record is made (it needs the door's record, which was not read, so it is not filed)" % service, False)
            if st == 200 and rec is not None:
                e = peer_kit.make_exec(contract, pem, [service], call["report_sha256"], admitted=[(req, rec)])
                etext = canonical(e)
                filed, fdetail, ftries = file_execution(etext, sleep=sleep)
                check("%s: the execution record naming the admission is filed" % service, filed, (fdetail, "asked %d times" % ftries))
                if filed and ftries > 1:
                    print("  note %s: the execution record was filed on try %d of %d" % (service, ftries, FILE_TRIES))
                with open(os.path.join(out, "execution_%s.json" % service), "w", encoding="utf-8") as f:
                    f.write(etext)
                call["execution_sha256"] = hashlib.sha256(etext.encode("utf-8")).hexdigest()
                call["execution_url"] = AGREEMENT + "/execution/" + call["execution_sha256"]
        record["result"] = "as expected" if not fails else "NOT as expected: " + "; ".join(fails)
        # the scene mismatch (see the note at MISMATCH): its failures are its own, so settle still reads the three calls
        scene, record["scene_result"] = mismatch_scene(contract, key, expiry, token, check)
        record["calls"].append(scene)
        with signals_held():
            with open(os.path.join(out, "RUN.json"), "w", encoding="utf-8") as f:
                f.write(json.dumps(record, indent=2, ensure_ascii=False) + "\n")
    except BaseException as e:              # KeyboardInterrupt and SystemExit (Terminated) too: see the note at the handler
        with signals_held():
            closed = close_raised_day(record, call, sent, e, fails)
            if closed:
                print("NG   %s   <<< %s" % (fails[-1], str(e)[:300]))
                with open(os.path.join(out, "RUN.json"), "w", encoding="utf-8") as f:
                    f.write(json.dumps(record, indent=2, ensure_ascii=False) + "\n")
        if not closed or not isinstance(e, Exception):
            raise                           # a stop from outside goes on as a stop, the day written first
    finally:
        if old_term is not None:
            signal.signal(signal.SIGTERM, old_term)
        if os.path.exists(pem):
            os.unlink(pem)
        os.rmdir(tmp)
    print(("\nHEARTBEAT %s: report admitted and executed, audit and compare refused, nothing spent on the refusals; scene mismatch: %s" % (date, record.get("scene_result")))
          if not fails else "\nFAIL %d: %s" % (len(fails), ", ".join(fails)))
    return 1 if fails else 0


# --------------------------------------------------------------------------- settle
def locate(shas, get=None, cache=None):
    """{sha: (entry n, batch bytes)} for the shas listed in records[] of any ledger entry, newest first.
    cache (a dict) keeps the head and each entry for the rest of one settle run, so several days fetch each entry once."""
    get = get or (lambda u: http("GET", u))
    cache = {} if cache is None else cache
    if "head" not in cache:
        st, _, b = get(LEDGER + "/ledger/head?cb=%d" % int(time.time()))
        head = (jl(b) or {}).get("n") if st == 200 else None
        if not isinstance(head, int):
            raise RuntimeError("the ledger head did not answer (%s)" % st)
        cache["head"] = head
    head = cache["head"]
    want, found = set(shas), {}
    for n in range(head, 0, -1):
        if n not in cache:
            cache[n] = get("%s/ledger/%d?format=raw" % (LEDGER, n))
        st, _, raw = cache[n]
        if st != 200:
            continue
        d = jl(raw)
        for r in (d or {}).get("records") or []:
            # The ledger's agreement pool (which also takes admissions and revocations) lists a record by
            # canonical_sha256; MUSUBI's contract and execution intake lists it by sha. Both are listings.
            s = (r.get("sha") or r.get("canonical_sha256")) if isinstance(r, dict) else None
            if s in want and s not in found:
                found[s] = (n, raw)
        if len(found) == len(want):
            break
    return found


CHUNK = 1000
STALL_HOURS = 72      # a day that ran as expected and is still not settled after this long is a failure, not a wait


# 2026-10-19. The ledger batches admissions with its agreement pool, whose listing is
# {"canonical_sha256", "record_schema", "verdict", "verifier_version"} under nenrin-agreement-batch-v1 (entry 80).
# anchor_compose.py reads only the MUSUBI intake listing {"sha", "kind"}, so every admission was refused as not listed
# and every day since 2026-10-10 stayed "waiting for Bitcoin" although its batch was confirmed at 970879. settle v1.11
# and later read an admission's anchor height as stated and leave verifying it to the caller, so the caller composes it
# here, with the same leg 1 and the same OTS legs as anchor_compose, the listing found at records[i].canonical_sha256.
# anchor_compose.py and the settle versions are unchanged. Stated limit: anchor_compose.batch_leg_check reads only
# records[i].sha, so it answers record_not_listed_in_batch for these admission proofs; recompute them with
# intake_listing_ops below (or by hand: the proof's prepend and append operands rebuild the batch bytes, and the
# digest sits at records[i].canonical_sha256).
INTAKE_BATCH_SCHEMA = "nenrin-agreement-batch-v1"


def intake_listing_ops(record, batch):
    """(digest, ops, offset) for a record listed by canonical_sha256 in the ledger's agreement pool batch. Raises AC.Refused."""
    d = v11.commitment_digest(record)
    hx = d.hex()
    try:
        text = batch.decode("utf-8")
        parsed = parse_strict(text)
    except Exception as e:
        raise AC.Refused("batch_not_json", "the batch bytes are not strict JSON (%s)" % type(e).__name__)
    if not isinstance(parsed, dict) or parsed.get("schema") != INTAKE_BATCH_SCHEMA:
        raise AC.Refused("batch_schema_unknown", "not an agreement pool batch")
    recs = parsed.get("records")
    if not isinstance(recs, list) or not all(isinstance(r, dict) for r in recs):
        raise AC.Refused("batch_schema_unknown", "records must be a list of objects")
    if "count" in parsed and parsed["count"] != len(recs):
        raise AC.Refused("batch_count_mismatch", "count %r but %d records" % (parsed["count"], len(recs)))
    hits = [i for i, r in enumerate(recs) if r.get("canonical_sha256") == hx]
    if not hits:
        raise AC.Refused("record_not_listed_in_batch", "%s is not the canonical_sha256 of any entry in records[]" % hx)
    if len(hits) > 1:
        raise AC.Refused("record_listed_twice", "records[] lists %s %d times" % (hx, len(hits)))
    idx = hits[0]
    entry = recs[idx]
    rschema = record.get("schema") if isinstance(record, dict) else None
    if entry.get("record_schema") != rschema:
        raise AC.Refused("record_schema_mismatch", "records[%d] is listed with record_schema %r, the record is %r" % (idx, entry.get("record_schema"), rschema))
    if entry.get("verdict") != "accepted":
        raise AC.Refused("record_not_accepted", "records[%d] is listed with verdict %r" % (idx, entry.get("verdict")))
    spans = AC._json_positions(text, ("records", idx, "canonical_sha256"))
    if len(spans) != 1 or text[spans[0][0]:spans[0][1]] != hx:
        raise AC.Refused("internal", "records[%d].canonical_sha256 could not be located in the raw bytes" % idx)
    at = len(text[:spans[0][0]].encode("utf-8"))
    prefix, suffix = batch[:at], batch[at + len(hx):]
    ops = [{"op": "hexlify"}]
    chunks = [prefix[i:i + CHUNK] for i in range(0, len(prefix), CHUNK)]
    for c in reversed(chunks):
        ops.append({"op": "prepend", "hex": c.hex()})
    for i in range(0, len(suffix), CHUNK):
        ops.append({"op": "append", "hex": suffix[i:i + CHUNK].hex()})
    ops.append({"op": "sha256"})
    return d, ops, at


def compose_listed(record, batch, ots, contract, view):
    """anchor_compose.compose for a batch that lists by sha; the same legs for the agreement pool's canonical_sha256 listing."""
    if isinstance(record, dict) and record.get("schema") not in AC.RECORD_KIND:
        try:
            parsed = parse_strict(batch.decode("utf-8"))
        except Exception:
            parsed = None
        recs = (parsed or {}).get("records") if isinstance(parsed, dict) else None
        if isinstance(recs, list) and any(isinstance(r, dict) and "canonical_sha256" in r for r in recs):
            return _compose_intake(record, batch, ots, contract, view)
    return AC.compose(record, batch, ots, contract, view)


def _compose_intake(record, batch, ots, contract, view):
    d, ops1, offset = intake_listing_ops(record, batch)
    claim = hashlib.sha256(batch).digest()
    if v11.run_proof(d, ops1) != claim:
        raise AC.Refused("internal", "leg 1 does not reproduce the batch sha")
    fdig, atts = AC.read_ots(ots)
    if fdig != claim:
        raise AC.Refused("ots_for_other_bytes", "the .ots stamps %s, the batch bytes hash to %s" % (fdig.hex(), claim.hex()))
    btc = sorted([a for a in atts if a["kind"] == "bitcoin"], key=lambda a: a["height"])
    base = {"record_digest": d.hex(), "batch_sha256": claim.hex(), "listed_at_offset": offset, "listing": "canonical_sha256"}
    if not btc:
        return dict(base, status="pending")
    cv, problem = v11.verify_view(view, contract)
    if cv is None:
        raise AC.Refused("view_rejected", problem)
    tried = []
    for a in btc:
        h = a["height"]
        if h not in cv["hashes"]:
            tried.append({"height": h, "why": "not in the view"})
            continue
        proof = ops1 + AC.ots_ops(a)
        if len(proof) > v11.MAX_PROOF_OPS:
            raise AC.Refused("proof_too_long", "%d ops over %d" % (len(proof), v11.MAX_PROOF_OPS))
        if v11.run_proof(d, proof) != cv["merkle"][h]:
            tried.append({"height": h, "why": "the path does not reach the merkle root of the header at this height"})
            continue
        return dict(base, status="anchored", anchor={"height": h, "block_hash": cv["hashes"][h], "proof": proof})
    raise AC.Refused("no_attestation_verifies", json.dumps(tried))


def _chunks(chunk_dir):
    if not chunk_dir or not os.path.isdir(chunk_dir):
        return []
    names = [x for x in os.listdir(chunk_dir) if x.endswith(".json") and x[:-5].count("-") == 1]
    return sorted(names, key=lambda x: int(x.split("-")[0]))


def extend_view(contract, chunk_dir, sources=None, get=HV._get, chunk=CHUNK):
    """The verified view lower_bound..tip.

    Final headers (more than 6 below the tip) are kept in chunk_dir as files of `chunk` headers each, written once and
    never rewritten, so a year of headers costs the repository about 10 MB once instead of a growing file every day.
    Only the headers after the last chunk are fetched, from both explorers, and they must be byte identical. The whole
    view, chunks included, is checked with verify_view under the contract's rules on every run; a chunk that does not
    fit is an error, never silently replaced."""
    sources = sources or HV.SOURCES
    lo = contract["lower_bound"]["height"]
    headers = []
    for name in _chunks(chunk_dir):
        part = json.load(open(os.path.join(chunk_dir, name), encoding="utf-8"))["headers"]
        a, b = (int(x) for x in name[:-5].split("-"))
        expect = lo if not headers else headers[-1]["height"] + 1
        if a != expect or part[0]["height"] != a or part[-1]["height"] != b or len(part) != b - a + 1:
            raise RuntimeError("view chunk %s does not continue the view at %d" % (name, expect))
        headers.extend(part)
    tips = {name: int(get(base + "/blocks/tip/height").strip()) for name, base in sources.items()}
    hi = min(tips.values())
    start = headers[-1]["height"] + 1 if headers else lo
    if start <= hi:
        got = {name: HV.fetch_source(base, start, hi, get) for name, base in sources.items()}
        names = sorted(got)
        for h in range(start, hi + 1):
            if len({got[n][h] for n in names}) != 1:
                raise RuntimeError("explorers disagree at height %d" % h)
            headers.append({"height": h, "hex": got[names[0]][h].hex()})
    view = {"headers": headers}
    cv, problem = v11.verify_view(view, contract)
    if cv is None:
        raise RuntimeError("view rejected under the contract's rules: " + problem)
    if chunk_dir:
        os.makedirs(chunk_dir, exist_ok=True)
        done = int(_chunks(chunk_dir)[-1][:-5].split("-")[1]) if _chunks(chunk_dir) else lo - 1
        final = hi - 6
        while final - done >= chunk:
            a, b = done + 1, done + chunk
            part = [x for x in headers if a <= x["height"] <= b]
            with open(os.path.join(chunk_dir, "%d-%d.json" % (a, b)), "w", encoding="utf-8") as f:
                json.dump({"headers": part}, f, separators=(",", ":"))
            done = b
    return view


def settle_day(day_dir, contract, chunk_dir, get=None, cache=None, contract_rel="run0003/contract.json"):
    get = get or (lambda u: http("GET", u))
    runp = os.path.join(day_dir, "RUN.json")
    if not os.path.exists(runp) or os.path.exists(os.path.join(day_dir, "settlement.json")):
        return "skip"
    r = json.load(open(runp, encoding="utf-8"))
    if r.get("result") != "as expected":
        return "skip (the run itself failed; nothing to settle)"
    r = dict(r, calls=door_calls(r))           # the three calls that reached the door; a scene row is not settled
    adm_files = {c["service"]: os.path.join(day_dir, "admission_%s.json" % c["service"]) for c in r["calls"]}
    exe_file = os.path.join(day_dir, "execution_report.json")
    shas = [c["record_sha256"] for c in r["calls"]] + [next(c["execution_sha256"] for c in r["calls"] if c.get("execution_sha256"))]
    found = locate(shas, get, cache)
    if len(found) != len(shas):
        return "pending: %d of %d records are in a ledger batch" % (len(found), len(shas))
    entries = sorted({n for n, _ in found.values()})
    ots = {}
    for n in entries:
        st, _, b = get("%s/verify/%d" % (LEDGER, n))
        if st != 200 or (jl(b) or {}).get("bitcoin_status") != "confirmed":
            return "pending: ledger entry %d is not confirmed in Bitcoin yet" % n
        st, _, ob = get("%s/ledger/%d/ots" % (LEDGER, n))
        if st != 200:
            return "pending: no proof served for entry %d" % n
        ots[n] = ob
    view = extend_view(contract, chunk_dir)
    anchored = {}
    for path, sha in [(adm_files[c["service"]], c["record_sha256"]) for c in r["calls"]] + [(exe_file, shas[-1])]:
        rec = rd(path)
        n, batch = found[sha]
        res = compose_listed(rec, batch, ots[n], contract, view)
        if res["status"] != "anchored":
            return "pending: the proof for %s does not reach Bitcoin yet" % sha[:12]
        a = AC.anchored_record(rec, res["anchor"])
        anchored[path] = a
        with open(path.replace(".json", ".anchored.json"), "w", encoding="utf-8") as f:
            f.write(canonical(a))
    admissions = [anchored[adm_files[c["service"]]] for c in r["calls"]]
    events = [anchored[exe_file]]
    keys = {DOOR_DOMAIN: door_key()}
    s = s20.settle_v1_20(contract, events, view, admissions=admissions, relying_keys=keys)
    s_12 = s12.settle_v1_12(contract, events, view, admissions=admissions, relying_keys=keys)
    if s.get("verdict") != s_12.get("verdict"):
        raise RuntimeError("settle v1.20 says %s and v1.12 says %s for %s" % (s.get("verdict"), s_12.get("verdict"), day_dir))
    tip = view["headers"][-1]["height"]
    with open(os.path.join(day_dir, "settlement.json"), "w", encoding="utf-8") as f:
        f.write(canonical(s))
    with open(os.path.join(day_dir, "SETTLED.json"), "w", encoding="utf-8") as f:
        f.write(json.dumps({"schema": "seki-heartbeat-settled-v0", "settle": "v1.20 (v1.12 agrees on the verdict)", "verdict": s.get("verdict"),
                            "status": s.get("status"), "view": {"from": view["headers"][0]["height"], "to": tip},
                            "ledger_entries": entries, "settlement_sha256": hashlib.sha256(canonical(s).encode()).hexdigest(),
                            "recompute": "anchor_compose.py for each record against its ledger entry (?format=raw and /ots), "
                                         "header_view_fetch.py --to %d (from runs/<date>/, the tools are in ../../../musubi-v0), then settle_v1_20.py --settle ../../../musubi-v0/%s "
                                         "--event execution_report.anchored.json --admission admission_*.anchored.json "
                                         "--relying-key %s=<keys/seki-door.json> --view view.json" % (tip, contract_rel, DOOR_DOMAIN)},
                           indent=2) + "\n")
    return "settled: %s %s" % (s.get("verdict"), s.get("status"))


def contract_for(day_dir):
    """(contract, path) of CONTRACT_PATHS whose contract_sha256 the day's admissions name; the first when the day has no
    admission yet. A day whose admissions name another contract, or two, is an error (never settled under a guess)."""
    named = set()
    for f in sorted(os.listdir(day_dir)) if os.path.isdir(day_dir) else []:
        if f.startswith("admission_") and f.endswith(".json") and not f.endswith(".anchored.json"):
            ref = (rd(os.path.join(day_dir, f)).get("contract_ref") or {})
            named.add(ref.get("contract_sha256"))
    if not named:
        return rd(CONTRACT_PATHS[0]), CONTRACT_PATHS[0]
    for p in CONTRACT_PATHS:
        c = rd(p)
        if named == {contract_sha256(c)}:
            return c, p
    raise RuntimeError("the admissions of %s name %s, not one of the contracts this file knows" % (day_dir, sorted(map(str, named))))


def settle(root, chunk_dir):
    days = sorted(d for d in os.listdir(root) if len(d) == 10 and os.path.isdir(os.path.join(root, d))) if os.path.isdir(root) else []
    bad = 0
    now = datetime.datetime.now(datetime.timezone.utc)
    cache = {}
    for d in days:
        try:
            contract, cpath = contract_for(os.path.join(root, d))
            msg = settle_day(os.path.join(root, d), contract, chunk_dir, cache=cache, contract_rel=os.path.relpath(cpath, MUSUBI))
        except Exception as e:
            msg, bad = "FAIL: %s" % e, bad + 1
        if msg.startswith("pending"):
            ran = datetime.datetime.strptime(d, "%Y-%m-%d").replace(tzinfo=datetime.timezone.utc) + datetime.timedelta(days=1)
            if (now - ran).total_seconds() > STALL_HOURS * 3600:
                msg, bad = "STALLED (more than %d hours unsettled): %s" % (STALL_HOURS, msg), bad + 1
        if msg != "skip":
            print("%s  %s" % (d, msg))
    return 1 if bad else 0


def write_index(root):
    """runs/README.md: one line per day, from the files, so the folder reads as a log."""
    if not os.path.isdir(root):
        return
    rows = []
    for d in sorted((x for x in os.listdir(root) if len(x) == 10), reverse=True) if os.path.isdir(root) else []:
        p = os.path.join(root, d, "RUN.json")
        if not os.path.exists(p):
            continue
        r = json.load(open(p, encoding="utf-8"))
        calls = {c["service"]: c for c in door_calls(r)}
        sp = os.path.join(root, d, "SETTLED.json")
        sv = json.load(open(sp, encoding="utf-8")) if os.path.exists(sp) else None
        cell = lambda s: "%s %s" % ((calls.get(s) or {}).get("decision") or "?", ((calls.get(s) or {}).get("record_sha256") or "")[:8])
        rows.append("| %s | %s | %s | %s | %s |" % (d, cell("report"), cell("audit"), cell("compare"),
                                                    ("%s, %s" % (sv["verdict"], sv["status"])) if sv else "waiting for Bitcoin"))
    text = ("# SEKI heartbeat\n\nOnce a day the agent calls HORIZON SHIELD's own paid tool through the SEKI door under the demonstration "
            "contract (../../musubi-v0/seki_demo_v2/contract.json; before 2026-11-12 ../../musubi-v0/run0003/contract.json, under "
            "which the audit was over its limit rather than prohibited): a report inside its limit and its payload schema, an audit "
            "and a comparison the contract prohibits. The door must admit the first and refuse the other two, and every answer is a signed record "
            "on the public ledger. Once the ledger's batch is confirmed in Bitcoin the day is settled with settle v1.15. "
            "Principal, agent and door are all The HORIZONs Co., Ltd.; it is a demonstration, not an outside customer, and the "
            "pilot's tickets carry no monetary value. heartbeat.py and the workflow seki-heartbeat.yml write this folder. "
            "Every deviation is explained in ../README.md, and a final verdict is never rewritten.\n\n"
            "| day (UTC) | report (limit 20) | audit 30 | compare (prohibited) | settlement |\n|---|---|---|---|---|\n"
            + "\n".join(rows) + "\n")
    with open(os.path.join(root, "README.md"), "w", encoding="utf-8") as f:
        f.write(text)


# --------------------------------------------------------------------------- self test (offline)
def _selftest():
    n = 0
    # locate(): only records[] listings count, newest entry first, and it stops once everything is found
    batches = {10: {"schema": "nenrin-agreement-batch-v1", "records": [{"sha": "aa" * 32}, {"sha": "bb" * 32}]},
               9: {"schema": "nenrin-agreement-batch-v1", "records": [{"sha": "cc" * 32}], "note": "dd" * 32},
               8: {"schema": "nenrin-agreement-batch-v1", "records": [{"sha": "aa" * 32}]}}

    def fake(u):
        if "/ledger/head" in u:
            return 200, {}, json.dumps({"n": 10}).encode()
        m = int(u.split("/ledger/")[1].split("?")[0])
        return (200, {}, json.dumps(batches[m]).encode()) if m in batches else (404, {}, b"")
    f = locate(["aa" * 32, "cc" * 32, "dd" * 32], fake)
    assert f["aa" * 32][0] == 10 and f["cc" * 32][0] == 9 and "dd" * 32 not in f
    n += 1; print("[1] locate: a sha counts only as a records[] listing, the newest entry wins, a sha in a note is not a listing")

    # extend_view(): final headers kept as chunks written once, the rest fetched from both explorers, a bad chunk is an error
    import struct
    chain, prev = {}, "00" * 32
    for h in range(200, 240):
        rr = v11._mine(prev, bytes([h % 256]) * 32, salt=h)
        fl = v11.header_fields(rr)
        ver, t, bits, nonce = struct.unpack("<i", rr[:4])[0], *struct.unpack("<III", rr[68:80])
        chain[h] = {"id": v11.header_hash(rr), "height": h, "version": ver, "timestamp": t, "bits": bits, "nonce": nonce,
                    "previousblockhash": fl["prev"], "merkle_root": fl["merkle"][::-1].hex()}
        prev = chain[h]["id"]
    contract = {"lower_bound": {"kind": "bitcoin_block", "height": 205, "hash": chain[205]["id"]},
                "grant": {"finality": {"depth": 6, "max_target_bits": "207fffff"}}}
    calls = []
    tip = [222]

    def explorer(u):
        calls.append(u)
        if u.endswith("/blocks/tip/height"):
            return str(tip[0])
        h = int(u.rsplit("/", 1)[1])
        return json.dumps([dict(chain[x]) for x in range(h, max(199, h - 10), -1) if x in chain])
    srcs = {"a": "A", "b": "B"}
    d = tempfile.mkdtemp(prefix="hb-self-")
    cdir = os.path.join(d, "chunks")
    v = extend_view(contract, cdir, srcs, explorer, chunk=10)
    assert v["headers"][0]["height"] == 205 and v["headers"][-1]["height"] == 222
    assert _chunks(cdir) == ["205-214.json"]
    n += 1; print("[2] extend_view: first run fetches 205..222 from both explorers and keeps one chunk of final headers (205..214)")
    calls.clear(); tip[0] = 239
    v = extend_view(contract, cdir, srcs, explorer, chunk=10)
    asked = sorted({int(u.rsplit("/", 1)[1]) for u in calls if "/blocks/" in u and not u.endswith("tip/height")})
    assert v["headers"][-1]["height"] == 239 and min(asked) >= 215 and _chunks(cdir) == ["205-214.json", "215-224.json"]
    n += 1; print("[3] extend_view: the next run asks only from 215 up, adds the chunk 215..224, and the whole view verifies again")
    c = json.load(open(os.path.join(cdir, "205-214.json"))); c["headers"][3]["hex"] = c["headers"][4]["hex"]
    json.dump(c, open(os.path.join(cdir, "205-214.json"), "w"))
    try:
        extend_view(contract, cdir, srcs, explorer, chunk=10); ok = False
    except RuntimeError as e:
        ok = "rejected" in str(e)
    assert ok
    n += 1; print("[4] extend_view: a tampered chunk makes the view fail under the contract's rules (an error, never replaced quietly)")
    import shutil; shutil.rmtree(d)

    # run(): refuses to spend twice on the same day
    d = tempfile.mkdtemp(prefix="hb-self-")
    os.makedirs(os.path.join(d, "2026-10-11"))
    json.dump({"result": "as expected"}, open(os.path.join(d, "2026-10-11", "RUN.json"), "w"))
    assert run(d, "2026-10-11") == 0
    n += 1; print("[5] run: a day that already ran is not run again (nothing is spent twice)")
    write_index(d)
    assert "2026-10-11" in open(os.path.join(d, "README.md")).read()
    n += 1; print("[6] write_index: the day appears in runs/README.md")
    # the agreement pool's listing: located, and leg 1 rebuilt at records[i].canonical_sha256 only
    adm = {"schema": "a2a-admission-v0", "admission_id": "self", "decision": "admit"}
    hx = v11.commitment_digest(adm).hex()
    pool = canonical({"schema": INTAKE_BATCH_SCHEMA, "anchored_at": "2026-10-11T00:30:00Z", "count": 2, "records": [
        {"canonical_sha256": "ee" * 32, "record_schema": "a2a-agreement-v1.1", "verdict": "accepted", "verifier_version": "x"},
        {"canonical_sha256": hx, "record_schema": "a2a-admission-v0", "verdict": "accepted", "verifier_version": "admission-intake 0.2.0"}]}).encode()
    f = locate([hx], lambda u: (200, {}, json.dumps({"n": 1}).encode()) if "/ledger/head" in u else (200, {}, pool))
    assert f[hx][0] == 1
    dg, ops, at = intake_listing_ops(adm, pool)
    assert v11.run_proof(dg, ops) == hashlib.sha256(pool).digest() and pool[at - 20:at] == b'"canonical_sha256":"'
    n += 1; print("[7] the agreement pool lists admissions by canonical_sha256: located, and leg 1 rebuilds the batch sha from that listing")
    for why, rec2, b2 in [
            ("listed twice", adm, pool.replace(b'"' + b"e" * 64, b'"' + hx.encode())),
            ("other record_schema", dict(adm, schema="a2a-revocation-v0"), pool),
            ("not listed", dict(adm, admission_id="other"), pool),
            ("listed only inside another field", adm, canonical({"schema": INTAKE_BATCH_SCHEMA, "records": [{"canonical_sha256": "ee" * 32, "record_schema": "a2a-admission-v0", "verdict": "accepted", "note": hx}]}).encode())]:
        try:
            intake_listing_ops(rec2, b2); ok = False
        except AC.Refused:
            ok = True
        assert ok, why
    n += 1; print("[8] refused: a digest listed twice, under another record_schema, not listed, or present only inside another field")
    # an old batch is still found once the ledger has grown far past it, and each entry is fetched once per run
    asked = []

    def deep(u):
        asked.append(u)
        if "/ledger/head" in u:
            return 200, {}, json.dumps({"n": 130}).encode()
        m = int(u.split("/ledger/")[1].split("?")[0])
        return (200, {}, json.dumps({"records": [{"sha": "ab" * 32}]}).encode()) if m == 80 else (200, {}, b"{}")
    cache = {}
    assert locate(["ab" * 32], deep, cache)["ab" * 32][0] == 80
    first = len(asked)
    assert locate(["ab" * 32], deep, cache)["ab" * 32][0] == 80 and len(asked) == first
    assert locate(["cd" * 32], deep, cache) == {} and len(asked) == first + 79
    n += 1; print("[9] locate: a batch 50 entries below the head is found, and a second day in the same run fetches nothing again")

    U = datetime.timezone.utc
    W = lambda h, m, sec=0: window_wait(datetime.datetime(2026, 10, 20, h, m, sec, tzinfo=U))
    assert W(0, 19, 59) == 0 and W(0, 55) == 0 and W(1, 14) == 0 and W(21, 17) == 0 and W(23, 59) == 0
    assert W(0, 20) == 35 * 60 + 1 and W(0, 30, 7) == 24 * 60 + 53 + 1 and W(0, 54, 59) == 2
    jst = datetime.timezone(datetime.timedelta(hours=9))
    assert window_wait(datetime.datetime(2026, 10, 20, 9, 30, tzinfo=jst)) == 25 * 60 + 1
    slept, kept = [], {k: os.environ.pop(k) for k in ("SEKI_AGENT_SEED_B64", "HSG_STORE_TOKEN") if k in os.environ}
    try:                                                   # without the secrets run() stops before any call is made
        with tempfile.TemporaryDirectory() as td:
            rc = run(td, "2026-10-20", now=datetime.datetime(2026, 10, 20, 0, 30, 7, tzinfo=U), sleep=slept.append)
    finally:
        os.environ.update(kept)
    assert slept == [24 * 60 + 54] and rc == 1           # it waited, then stopped at the missing secrets (none in the test)
    n += 1; print("[10] the calls wait out 00:20 to 00:55 UTC, between the ledger's admission cut and the intake's execution cut")

    # [11] the day a run is for. The real start times of the runs of 2026-10-18 to 10-23 (Actions run list).
    T = lambda s: datetime.datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=U)
    starts = ["2026-10-19T01:13:12Z", "2026-10-20T00:24:25Z", "2026-10-20T23:56:20Z", "2026-10-22T00:01:18Z", "2026-10-23T00:00:08Z", "2026-10-23T23:52:15Z"]
    old = [T(x).strftime("%Y-%m-%d") for x in starts]
    new = [responsible_day(T(x)) for x in starts]
    assert old == ["2026-10-19", "2026-10-20", "2026-10-20", "2026-10-22", "2026-10-23", "2026-10-23"]   # two collisions, no 10-21
    assert new == ["2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]   # one day each
    assert responsible_day(T("2026-10-24T21:17:00Z")) == "2026-10-24" and responsible_day(T("2026-10-25T05:59:59Z")) == "2026-10-24"
    assert responsible_day(T("2026-10-25T06:00:00Z")) == "2026-10-25"
    n += 1; print("[11] the day is the one the run was scheduled on: the starts of 10-19 to 10-23 give six days, not two collisions")

    # [12] the folders as they are (fixture: date and ran_at of runs/2026-10-18 .. 10-23 as committed): 10-20 and 10-23 missed
    REAL = {"2026-10-18": "2026-10-18T01:01:04Z", "2026-10-19": "2026-10-19T01:14:20Z", "2026-10-20": "2026-10-20T00:30:07Z",
            "2026-10-22": "2026-10-22T00:02:26Z", "2026-10-23": "2026-10-23T00:01:33Z"}
    with tempfile.TemporaryDirectory() as td:
        for d, ran in REAL.items():
            os.makedirs(os.path.join(td, d))
            with open(os.path.join(td, d, "RUN.json"), "w", encoding="utf-8") as f:
                json.dump({"date": d, "ran_at": ran, "result": "as expected", "calls": []}, f)
        assert gaps(td, "2026-10-23") == ["2026-10-20", "2026-10-23"], gaps(td, "2026-10-23")
        assert gaps(td, "2026-10-22", days=3) == ["2026-10-20"]
        # 2026-10-20 23:56Z and 2026-10-23 23:52Z again: the folder is taken by the run for the day before. Red, not "already ran".
        for d in ("2026-10-20", "2026-10-23"):
            rc = run(td, responsible_day(T({"2026-10-20": "2026-10-20T23:56:20Z", "2026-10-23": "2026-10-23T23:52:15Z"}[d])), now=T(d + "T23:56:20Z"), sleep=slept.append)
            assert rc == 1, (d, rc)
        # a second run for a day that is done under the rule is still "already ran", green
        os.makedirs(os.path.join(td, "2026-10-24"))
        with open(os.path.join(td, "2026-10-24", "RUN.json"), "w", encoding="utf-8") as f:
            json.dump({"date": "2026-10-24", "day_rule": DAY_RULE, "ran_at": "2026-10-25T00:10:00Z", "result": "as expected", "calls": []}, f)
        assert run(td, "2026-10-24", now=T("2026-10-25T02:00:00Z"), sleep=slept.append) == 0
        assert gaps(td, "2026-10-24") == ["2026-10-20", "2026-10-23"] and gaps(td, "2026-10-25") == ["2026-10-20", "2026-10-23", "2026-10-25"]
        assert gaps(td, "2026-10-12", days=7) == [d for d in ["2026-10-11", "2026-10-12"]]   # nothing before GAPS_FROM
    n += 1; print("[12] the real folders: 10-20 and 10-23 have no run; a taken folder is a failure; a rerun of a done day stays green")

    # [13] the door's policy (GET /seki, as the door served it on 2026-11-07: the store's policy shows no furui, the
    # default says required false, the check store is the one store that requires it)
    RULES = "2c5a1089a90265717175dd1056be7075472aed44fab5581e6be6e73b1746f195"
    def pol(default=False, requiring=("tooshi-check",), own=None, drop=()):
        p = {"stores": [{"store": STORE, "policy": dict({"policy_id": "x"}, **({"furui": own} if own is not None else {}))},
                        {"store": "tooshi-check", "policy": {"policy_id": "x"}}],
             "furui": {"policy": {"required": default, "rules_sha256": RULES}, "stores_requiring": list(requiring)}}
        for k in drop:
            p["furui"].pop(k)
        return p
    assert door_furui_required(pol()) is False
    assert door_furui_required(pol(default=True)) is True
    assert door_furui_required(pol(requiring=("tooshi-check", STORE))) is True
    assert door_furui_required(pol(default=True, own={"required": False})) is False and door_furui_required(pol(own={"required": True})) is True
    assert door_furui_required(pol(drop=("stores_requiring",))) is False
    for bad in (None, [], {"furui": {}}, dict(pol(), stores=[]), dict(pol(), stores=pol()["stores"] * 2), pol(drop=("policy",)), dict(pol(), furui=None)):
        try:
            door_furui_required(bad); ok = False
        except ValueError:
            ok = True
        assert ok, bad
    G = lambda st, body: (lambda u: (st, {}, body if isinstance(body, bytes) else json.dumps(body).encode()))
    assert read_door_policy(G(200, pol())) == (False, None) and read_door_policy(G(200, pol(default=True))) == (True, None)
    def down(u):
        raise OSError("no route")
    for g in (G(503, pol()), G(200, b"<html>"), G(200, {"stores": []}), down):
        r, why = read_door_policy(g)
        assert r is None and isinstance(why, str) and why.startswith("GET /seki"), (r, why)
    for sv in PAYLOAD:
        bd = call_body(sv, {"nonce": "n"}, {"contract_id": "c"})
        assert bd["seki"]["content"] == PAYLOAD[sv] and {k: x for k, x in bd.items() if k != "seki"} == PAYLOAD[sv]
        assert sorted(bd["seki"]) == ["action_request", "content", "presentation"] and canonical(bd["seki"]["content"]) == canonical(PAYLOAD[sv])
    n += 1; print("[13] the door's policy: the store's own furui, else stores_requiring, else the default; unreadable, it is a failure and no call is made; every call carries its payload as seki.content")

    # [14] the records: exact reasons while the check is not required; with it, only the content reasons that change nothing
    CK = "ab" * 32
    rec = lambda d, r, content=None: dict({"decision": d, "reasons": r}, **({"content": content} if content is not None else {}))
    blk = lambda **k: dict({"checked": True, "check_sha256": CK, "decision": "pass", "marks": []}, **k)
    J = lambda s, r, req: (lambda out: ([ok for _n, ok, _d in out[0]], out[1]))(judge_record(s, r, *{"report": ("admit", ["within_grant"]), "audit": ("refuse", ["amount_over_limit"]), "compare": ("refuse", ["prohibited_action"])}[s], req))
    # required false: exactly as before
    assert J("report", rec("admit", ["within_grant"]), False) == ([True], None)
    assert J("report", rec("admit", ["within_grant", "content_off_topic"]), False) == ([False], None)
    assert J("audit", rec("refuse", ["amount_over_limit"]), False) == ([True], None)
    assert J("audit", rec("refuse", ["amount_over_limit", "content_unchecked"]), False) == ([False], None)
    # required true: report admitted, plain or off topic, with a checked block naming its check
    assert J("report", rec("admit", ["within_grant"], blk()), True) == ([True, True], CK)
    assert J("report", rec("admit", ["within_grant", "content_off_topic"], blk(marks=["off_topic"])), True) == ([True, True], CK)
    assert J("report", rec("admit", ["content_off_topic", "within_grant"], blk()), True)[0] == [False, True]
    assert J("report", rec("admit", ["within_grant", "content_flagged"], blk()), True)[0] == [False, True]
    assert J("report", rec("escalate", ["content_unchecked"], blk(checked=False, check_sha256=None)), True) == ([False, False], None)
    assert J("report", rec("admit", ["within_grant"]), True) == ([True, False], None)                     # no content block
    assert J("report", rec("admit", ["within_grant"], blk(check_sha256=None)), True) == ([True, False], None)
    assert J("report", rec("admit", ["within_grant"], blk(check_sha256="AB" * 32)), True) == ([True, False], None)
    assert J("report", rec("admit", ["within_grant"], blk(checked=False)), True) == ([True, False], CK)
    # required true: refusals keep their own reasons, and only content_ reasons may come with them
    assert J("audit", rec("refuse", ["amount_over_limit"], blk()), True) == ([True], CK)
    assert J("audit", rec("refuse", ["amount_over_limit", "content_off_topic"], blk(marks=["off_topic"])), True) == ([True], CK)
    assert J("compare", rec("refuse", ["prohibited_action", "content_flagged", "content_unchecked"]), True) == ([True], None)
    assert J("compare", rec("refuse", ["content_flagged"]), True) == ([False], None)
    assert J("compare", rec("refuse", ["prohibited_action", "outside_grant"]), True) == ([False], None)
    assert J("compare", rec("refuse", ["prohibited_action", "content_off_topic", "content_off_topic"]), True) == ([False], None)
    assert J("audit", rec("admit", ["within_grant"], blk()), True)[0] == [False]
    n += 1; print("[14] the records: exact reasons while not required; required: an admit may add content_off_topic and must name a checked content block, a refusal may add only content_ reasons")

    # [15] the scene mismatch: a body that is not its seki.content is refused by the gateway, 400 content_mismatch, before the door
    contract = rd(CONTRACT_PATH)

    class NoKey:                                            # the scene signs its request; no real key in a self test
        def sign(self, b):
            return b"\0" * 64
    bd = mismatch_body({"nonce": "n"}, {"contract_id": "c"})
    assert bd["seki"]["content"] == PAYLOAD["compare"] and bd["note"] != PAYLOAD["compare"]["note"]
    assert canonical({k: x for k, x in bd.items() if k != "seki"}) != canonical(bd["seki"]["content"]) and sorted(bd) == ["note", "seki"]
    H = lambda st, body: (lambda u: (st, {}, body if isinstance(body, bytes) else json.dumps(body).encode()))
    assert gateway_content_match(H(200, {"seki_content_match": True})) == (True, None)
    for g in (H(200, {"name": "hs-gateway"}), H(200, {"seki_content_match": "true"}), H(503, {"seki_content_match": True}), H(200, b"<html>"), down):
        r, why = gateway_content_match(g)
        assert r is False and why.startswith("GET /health"), (r, why)

    def scene(health, answer):
        sent, seen = [], []
        def post(url, body):
            sent.append((url, json.loads(body)))
            if answer == "down":
                raise OSError("no route")
            return answer
        def chk(name, ok, detail=""):
            seen.append((name, ok))
            return ok
        row, res = mismatch_scene(contract, NoKey(), 100, "t", chk, get=health, post=post)
        return row, res, sent, seen
    OK400 = (400, {"Content-Type": "application/json"}, json.dumps({"ok": False, "error": "content_mismatch", "why": "x", "spent": 0}).encode())
    row, res, sent, seen = scene(H(200, {"seki_content_match": True}), OK400)
    assert res == "as expected" and [ok for _n, ok in seen] == [True, True, True] and len(sent) == 1
    assert (row["service"], row["scene"], row["status"], row["error"], row["decision"], row["tickets_spent"]) == ("compare", "mismatch", 400, "content_mismatch", None, None)
    url, body = sent[0]
    assert url == GATEWAY + "/report?store=" + STORE + "&service=compare" and body["seki"]["content"] == PAYLOAD["compare"] and body["note"] == MISMATCH_NOTE
    assert body["seki"]["action_request"]["nonce"] == row["nonce"] and is_h64(row["request_sha256"]) and len(row["nonce"]) == 32
    assert body["seki"]["action_request"]["action"] == {"action": "compare", "target": TARGET, "amount": 50}
    assert scene(H(200, {"seki_content_match": True}), OK400)[0]["nonce"] != row["nonce"]          # a new nonce every run
    for answer, why in [((403, {"X-Seki-Decision": "refuse"}, json.dumps({"type": "x"}).encode()), "403"),
                        ((200, {"X-Tickets-Spent": "50", "X-Seki-Decision": "admit"}, b"%PDF"), "HTTP 400"),
                        ((400, {}, json.dumps({"ok": False, "error": "bad_payload"}).encode()), "HTTP 400"),
                        ((402, {}, json.dumps({"ok": False, "error": "insufficient_tickets"}).encode()), "HTTP 400"),
                        ("down", "HTTP 400")]:
        row2, res2, sent2, seen2 = scene(H(200, {"seki_content_match": True}), answer)
        assert res2.startswith("NOT as expected") and why in res2 and len(sent2) == 1, (answer, res2)
    row3 = scene(H(200, {"seki_content_match": True}), (403, {"X-Seki-Decision": "refuse"}, b"{}"))[0]
    assert (row3["status"], row3["decision"]) == (403, "refuse")
    assert scene(H(200, {"seki_content_match": True}), "down")[0]["status"] is None
    for g in (H(200, {"name": "hs-gateway"}), down):          # the gateway has no match yet: not run, not a failure
        row4, res4, sent4, seen4 = scene(g, OK400)
        assert res4 == "not_yet" and sent4 == [] and seen4 == [] and row4["status"] is None and row4["not_yet"].startswith("GET /health") and row4["scene"] == "mismatch"
    # the row never reaches settle or the index: settle reads the three calls (4 shas, not 5), the index keeps the real compare
    calls3 = [{"service": "report", "decision": "admit", "record_sha256": "a1" * 32, "execution_sha256": "e1" * 32},
              {"service": "audit", "decision": "refuse", "record_sha256": "a2" * 32}, {"service": "compare", "decision": "refuse", "record_sha256": "a3" * 32}]
    with tempfile.TemporaryDirectory() as td:
        os.makedirs(os.path.join(td, "2026-11-08"))
        json.dump({"date": "2026-11-08", "day_rule": DAY_RULE, "ran_at": "2026-11-08T21:18:00Z", "result": "as expected", "scene_result": "as expected",
                   "calls": calls3 + [dict(row)]}, open(os.path.join(td, "2026-11-08", "RUN.json"), "w"))
        listed = json.dumps({"records": [{"sha": c["record_sha256"]} for c in calls3] + [{"sha": "e1" * 32}]}).encode()
        def lg(u):
            if "/ledger/head" in u:
                return 200, {}, json.dumps({"n": 1}).encode()
            if "/verify/1" in u:
                return 200, {}, json.dumps({"bitcoin_status": "pending"}).encode()
            return (200, {}, listed) if "/ledger/1" in u else (404, {}, b"")
        assert settle_day(os.path.join(td, "2026-11-08"), contract, td, get=lg) == "pending: ledger entry 1 is not confirmed in Bitcoin yet"
        assert door_calls(json.load(open(os.path.join(td, "2026-11-08", "RUN.json")))) == calls3
        write_index(td)
        assert "| 2026-11-08 | admit a1a1a1a1 | refuse a2a2a2a2 | refuse a3a3a3a3 |" in open(os.path.join(td, "README.md")).read()
        assert run(td, "2026-11-08") == 0                                                        # already ran, scene as expected
        json.dump(dict(json.load(open(os.path.join(td, "2026-11-08", "RUN.json"))), scene_result="NOT as expected: mismatch: HTTP 400"),
                  open(os.path.join(td, "2026-11-08", "RUN.json"), "w"))
        assert run(td, "2026-11-08") == 1                                                        # already ran, the scene failed: still red
        assert settle_day(os.path.join(td, "2026-11-08"), contract, td, get=lg).startswith("pending")   # and the day still settles
    n += 1; print("[15] the scene mismatch: seki.content is compare's payload and the body differs; 400 content_mismatch with nothing spent and no door is as expected, "
                  "403, 2xx, another 400, 402 or no answer is not; without seki_content_match on GET /health it is not run (not_yet); the row stays out of settle and the index")

    # [16] admission v0.5 (more than one runner): checks[] in place of check_sha256; and settle v1.20 in place of v1.15
    k5 = lambda rid, h=CK, why="ok": {"runner_id": rid, "check_sha256": h, "why": why}
    r5 = lambda d, r, ks, checked=True: {"decision": d, "reasons": r, "rules": {"version": "0.5"}, "content": {"checked": checked, "decision": "pass", "checks": ks}}
    two = [k5("runner-1"), k5("runner-2", "cd" * 32)]
    assert J("report", r5("admit", ["within_grant"], two), True) == ([True, True], [("runner-1", CK), ("runner-2", "cd" * 32)])
    assert J("report", r5("admit", ["within_grant"], two, checked=False), True)[0] == [True, False]
    assert J("report", r5("admit", ["within_grant"], [k5("runner-1"), k5("runner-2", None)]), True)[0] == [True, False]
    assert J("report", r5("admit", ["within_grant"], [k5("runner-1", None, "no_envelope")]), True) == ([True, False], [])
    assert J("report", r5("admit", ["within_grant"], [k5("runner-1"), k5("runner-2", None, "timeout")]), True) == ([True, True], [("runner-1", CK)])
    assert J("audit", r5("refuse", ["amount_over_limit"], two), True) == ([True], [("runner-1", CK), ("runner-2", "cd" * 32)])
    assert J("report", rec("admit", ["within_grant"], blk()), True) == ([True, True], CK)                 # v0.4 reads as before
    assert content_checks(dict(r5("admit", ["within_grant"], two), rules={"version": "0.4"})) is None
    # every day settled so far, whose view lies in view-chunks/ (no network): v1.20 gives v1.15's verdict, status and deviations,
    # v1.12 the same verdict, and v1.15 the bytes settlement.json holds
    contracts_used = set()
    hd = []
    for name in _chunks(os.path.join(HERE, "view-chunks")):
        hd += json.load(open(os.path.join(HERE, "view-chunks", name), encoding="utf-8"))["headers"]
    top = hd[-1]["height"] if hd else -1
    days, beyond = [], []
    for d in sorted(x for x in os.listdir(os.path.join(HERE, "runs")) if len(x) == 10):
        dd = os.path.join(HERE, "runs", d)
        if not os.path.exists(os.path.join(dd, "SETTLED.json")):
            continue
        S = json.load(open(os.path.join(dd, "SETTLED.json"), encoding="utf-8"))
        if S["view"]["to"] > top:
            beyond.append(d)
            continue
        view = {"headers": [x for x in hd if x["height"] <= S["view"]["to"]]}
        r = json.load(open(os.path.join(dd, "RUN.json"), encoding="utf-8"))
        adms = [rd(os.path.join(dd, "admission_%s.anchored.json" % c["service"])) for c in door_calls(r)]   # a scene row reached no door
        evs = [rd(os.path.join(dd, "execution_report.anchored.json"))]
        keys = {DOOR_DOMAIN: door_key()}
        contract, cpath = contract_for(dd)
        contracts_used.add(os.path.relpath(cpath, MUSUBI))
        a15 = s15.settle_v1_15(contract, evs, view, admissions=adms, relying_keys=keys)
        a20 = s20.settle_v1_20(contract, evs, view, admissions=adms, relying_keys=keys)
        a12 = s12.settle_v1_12(contract, evs, view, admissions=adms, relying_keys=keys)
        stored = open(os.path.join(dd, "settlement.json"), encoding="utf-8").read()
        assert canonical(a15 if S.get("settle", "").startswith("v1.15") else a20) == stored, d
        assert (a20["verdict"], a20["status"], canonical(a20["deviations"])) == (a15["verdict"], a15["status"], canonical(a15["deviations"])) == (
            S["verdict"], S["status"], canonical(json.loads(stored)["deviations"])), d
        assert a12["verdict"] == a20["verdict"], d
        days.append(d)
    assert len(days) >= 24, days
    n += 1; print("[16] the records of v0.5: checked, and a 64 hex check_sha256 for each check read as an answer (v0.4 as before); %d settled days "
                  "(%s to %s) settle under v1.20 with v1.15's verdict, status and deviations and v1.12's verdict, and the settle SETTLED.json names gives the "
                  "bytes settlement.json holds (%d later days need headers past view-chunks/ and are left to the run that settles them)"
                  % (len(days), days[0], days[-1], len(beyond)))
    # [17] the contract of a day (2026-11-12): a day is settled under the contract its admissions name; the days so far name run0003,
    # a day with no admission yet gets the newest; a day that names a contract this file does not know is an error, never a guess
    assert contracts_used == {os.path.join("run0003", "contract.json")}, contracts_used
    assert EXPECT[1] == ("audit", 30, "refuse", ["prohibited_action"], 403) and contract_sha256(rd(CONTRACT_PATHS[0])) != contract_sha256(rd(CONTRACT_PATHS[1]))
    g0 = rd(CONTRACT_PATH)["grant"]
    assert "audit" in g0["prohibited_actions"] and "compare" in g0["prohibited_actions"] and g0["authorized_actions"] == ["report"]
    with tempfile.TemporaryDirectory() as td:
        assert contract_for(td)[1] == CONTRACT_PATH
        open(os.path.join(td, "admission_report.json"), "w").write(json.dumps({"contract_ref": {"contract_sha256": contract_sha256(rd(CONTRACT_PATH))}}))
        assert contract_for(td)[1] == CONTRACT_PATH
        open(os.path.join(td, "admission_audit.json"), "w").write(json.dumps({"contract_ref": {"contract_sha256": "00" * 32}}))
        try:
            contract_for(td); raise AssertionError("a day naming an unknown contract was settled")
        except RuntimeError:
            pass
    n += 1; print("[17] the contract of a day: the %d settled days name run0003 and are settled under it; a new day gets seki_demo_v2 (audit and compare "
                  "prohibited, so the audit is expected refused prohibited_action); a day naming an unknown contract is an error" % len(days))
    n += 1; print("[18] the contract is on file before any call: accepted or dedup lets the run go on; a refusal (the 422 of 2026-11-12), a 5xx, an answer "
                  "that is not JSON or no answer stops it, and in run() the question comes before the day's folder and before the first call")
    import inspect
    ct = open(CONTRACT_PATH, encoding="utf-8").read()
    sent = []

    def poster(st, body):
        def post(u, b):
            sent.append((u, hashlib.sha256(b).hexdigest()))
            if st is None:
                raise OSError("no route")
            return st, {}, body
        return post
    assert contract_on_file(ct, poster(201, '{"verdict":"accepted"}'))[0] is True
    assert contract_on_file(ct, poster(200, '{"verdict":"accepted"}'))[0] is True
    assert contract_on_file(ct, poster(409, '{"dedup":true}'))[0] is True
    assert sent[0] == (AGREEMENT + "/contract", hashlib.sha256(ct.encode("utf-8")).hexdigest()) and len(sent) == 3   # the file's bytes, unchanged, once per ask
    r422 = contract_on_file(ct, poster(422, '{"error":"grant_key_unknown","keys":["exposure","payload_schema"]}'))
    assert r422[0] is False and r422[1][0] == 422 and "grant_key_unknown" in r422[1][1]
    assert contract_on_file(ct, poster(409, '{"error":"contract_not_filed"}'))[0] is False      # a 409 that is not a dedup
    assert contract_on_file(ct, poster(201, '{"verdict":"refused"}'))[0] is False
    assert contract_on_file(ct, poster(200, '{"dedup":"true"}'))[0] is False                     # the word true is not the value true
    assert contract_on_file(ct, poster(500, 'upstream error'))[0] is False
    assert contract_on_file(ct, poster(200, 'not json'))[0] is False
    assert contract_on_file(ct, poster(200, '[1]'))[0] is False
    assert contract_on_file(ct, poster(403, '{"verdict":"accepted"}'))[0] is False
    na = contract_on_file(ct, poster(None, ""))
    assert na[0] is False and "did not answer" in na[1]
    src = inspect.getsource(run)
    i_ask, i_dir, i_call, i_run = src.index("contract_on_file(ctext)"), src.index("os.makedirs(out"), src.index('"%s/report?store=%s&service=%s"'), src.index('"RUN.json"), "w"')
    assert src.count("contract_on_file(") == 1 and 'AGREEMENT + "/contract"' not in src
    assert i_ask < i_dir < i_call < i_run, "the contract is asked for before the folder, the first call and the day file"
    assert src[i_ask:i_dir].count("return 1") == 1, "a contract that is not on file returns before the folder is made"
    n += 1; print("[19] the execution record is filed after the call: an answer that may pass (no answer, 408, 429, 5xx) is asked again with the same bytes, "
                  "up to %d times; a refusal is final; a dedup counts as filed; it never raises" % FILE_TRIES)
    ex = '{"schema":"x","n":1}'

    def seq(answers, log, naps):
        it = iter(answers)

        def post(u, b):
            log.append((u, hashlib.sha256(b).hexdigest()))
            a = next(it)
            if a is None:
                raise TimeoutError("no answer")
            return a[0], {}, a[1]
        return post, (lambda s: naps.append(s))
    OKB, DUP = '{"verdict":"accepted"}', '{"dedup":true}'
    for answers, want_ok, want_tries, want_naps in (
            ([(201, OKB)], True, 1, 0), ([(409, DUP)], True, 1, 0),
            ([(500, "x"), (503, "x"), (201, OKB)], True, 3, 2), ([None, (201, OKB)], True, 2, 1), ([(429, "slow"), (408, ""), None, (409, DUP)], True, 4, 3),
            ([(502, "x")] * 4, False, 4, 3), ([None] * 4, False, 4, 3),
            ([(409, '{"error":"contract_not_filed"}'), (201, OKB)], False, 1, 0), ([(422, '{"error":"x"}'), (201, OKB)], False, 1, 0),
            ([(400, "bad"), (201, OKB)], False, 1, 0), ([(201, '{"verdict":"refused"}'), (201, OKB)], False, 1, 0), ([(200, OKB), (201, OKB)], False, 1, 0),
            ([(201, "[1]"), (201, OKB)], False, 1, 0)):
        log, naps = [], []
        post, nap = seq(answers, log, naps)
        ok_, det, tr = file_execution(ex, post, nap)
        assert (ok_, tr, len(naps)) == (want_ok, want_tries, want_naps), (answers, ok_, tr, naps)
        assert set(log) == {(AGREEMENT + "/execution", hashlib.sha256(ex.encode()).hexdigest())} and len(log) == want_tries   # the same bytes every time
        assert all(s == FILE_WAIT for s in naps)
        assert want_ok or det is not None
    log, naps = [], []
    post, nap = seq([(500, "x")] * 2, log, naps)
    assert file_execution(ex, post, nap, tries=2)[2] == 2 and len(naps) == 1          # the last try is not followed by a wait
    rsrc = inspect.getsource(run)
    assert rsrc.count("file_execution(etext, sleep=sleep)") == 1 and 'AGREEMENT + "/execution"' not in rsrc.replace('AGREEMENT + "/execution/"', "")
    assert rsrc.index("file_execution(etext") < rsrc.index('"RUN.json"), "w"'), "the day file is written after the filing, whatever its answer"
    assert "execution_filing" not in rsrc, "the day's record keeps its shape"
    n += 1; print("[20] a run that raises after a call was sent closes the day as NOT as expected with the calls it holds, so nothing is spent twice; "
                  "a run that raises before any call is sent writes nothing and raises as before")
    E = TimeoutError("x")
    r0 = {"calls": []}
    assert close_raised_day(r0, None, 0, E, []) is False and r0 == {"calls": []} and close_raised_day(None, None, 2, E, []) is False
    c1, c2 = {"service": "report"}, {"service": "audit"}
    r1, f1 = {"calls": [c1]}, ["report: HTTP 200"]
    assert close_raised_day(r1, c2, 2, E, f1) is True and r1["calls"] == [c1, c2] and len(f1) == 2
    assert r1["result"] == "NOT as expected: report: HTTP 200; the run raised TimeoutError after 2 of the day's calls were sent" and r1["scene_result"].startswith("not run: ")
    r2, f2 = {"calls": [c1]}, []
    assert close_raised_day(r2, c1, 1, E, f2) is True and r2["calls"] == [c1] and r2["result"].startswith("NOT as expected: the run raised")   # not appended twice
    r3, f3 = {"calls": [c1, c2], "result": "as expected"}, []
    assert close_raised_day(r3, c2, 3, E, f3) is True and r3["result"] == "as expected" and r3["scene_result"].startswith("NOT as expected: the run raised") and f3
    assert set(r1) == {"calls", "result", "scene_result"}, "no new key"
    # run() itself, offline: a made-up contractor key, the questions before the calls answered, then the gateway stops answering
    from cryptography.hazmat.primitives import serialization as _ser
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey as _K
    g = globals()
    keep = {k: g[k] for k in ("http", "CONTRACT_PATH", "read_door_policy", "contract_on_file", "tip_height", "close_raised_day")}
    keep_verify, keep_term = A.verify_admission, signal.getsignal(signal.SIGTERM)
    kenv = {k: os.environ.get(k) for k in ("SEKI_AGENT_SEED_B64", "HSG_STORE_TOKEN")}
    seed = bytes(range(32))
    pub = base64.b64encode(_K.from_private_bytes(seed).public_key().public_bytes(_ser.Encoding.Raw, _ser.PublicFormat.Raw)).decode()
    cj = json.loads(open(CONTRACT_PATH, encoding="utf-8").read())
    for pty in cj["parties"]:
        if pty["role"] == "contractor":
            pty["public_key_ed25519_b64"] = pub
    noon = datetime.datetime(2026, 11, 14, 12, 0, 0, tzinfo=U)
    try:
        with tempfile.TemporaryDirectory() as td:
            cp = os.path.join(td, "contract.json")
            open(cp, "w", encoding="utf-8").write(canonical(cj))
            os.environ["SEKI_AGENT_SEED_B64"], os.environ["HSG_STORE_TOKEN"] = base64.b64encode(seed).decode(), "t"
            g["CONTRACT_PATH"], g["read_door_policy"], g["contract_on_file"] = cp, (lambda: (False, None)), (lambda ctext: (True, "x"))
            posts = []

            def world(fail_at, tip_ok=True):
                del posts[:]

                def tip():
                    if not tip_ok:
                        raise OSError("no tip")
                    return 900000

                def fake(method, url, body=None, headers=None, timeout=120):
                    if "/balance?" in url:
                        return 200, {}, b'{"tickets": 50}'
                    if method == "POST" and "/report?" in url:
                        posts.append(url)
                        if len(posts) >= fail_at:
                            raise TimeoutError("the gateway did not answer")
                        return 403, {"x-seki-decision": "refuse"}, b"{}"
                    raise AssertionError("an unexpected call in the test: %s %s" % (method, url))
                g["http"], g["tip_height"] = fake, tip
            # (a) the chain tip does not answer: nothing was sent, so run() raises and the day is not written
            world(1, tip_ok=False)
            try:
                run(os.path.join(td, "a"), "2026-11-14", now=noon, sleep=slept.append)
                raise AssertionError("run() must raise when nothing was sent")
            except OSError:
                pass
            assert posts == [] and not os.path.exists(os.path.join(td, "a", "2026-11-14", "RUN.json"))
            # (b) the first call gets no answer: it may have been spent, so the day is closed and a second run spends nothing
            world(1)
            assert run(os.path.join(td, "b"), "2026-11-14", now=noon, sleep=slept.append) == 1 and len(posts) == 1
            rj = json.load(open(os.path.join(td, "b", "2026-11-14", "RUN.json"), encoding="utf-8"))
            assert [(c["service"], c["status"]) for c in rj["calls"]] == [("report", None)], "the row of the unanswered call is there (2026-11-14)"
            assert rj["result"].endswith("the run raised TimeoutError after 1 of the day's calls were sent") and rj["scene_result"].startswith("not run: ")
            assert run(os.path.join(td, "b"), "2026-11-14", now=noon, sleep=slept.append) == 1 and len(posts) == 1, "already ran: no second call"
            # (c) the first call is answered and judged (here: not as expected), the second gets no answer: the first is kept
            world(2)
            assert run(os.path.join(td, "c"), "2026-11-14", now=noon, sleep=slept.append) == 1 and len(posts) == 2
            rj = json.load(open(os.path.join(td, "c", "2026-11-14", "RUN.json"), encoding="utf-8"))
            assert [(c["service"], c["status"]) for c in rj["calls"]] == [("report", 403), ("audit", None)] and "after 2 of the day's calls were sent" in rj["result"]
            assert os.path.exists(os.path.join(td, "c", "2026-11-14", "request_audit.json")) and os.path.exists(os.path.join(td, "c", "2026-11-14", "request_report.json"))
            assert not os.path.exists(os.path.join(td, "c", "2026-11-14", "request_compare.json"))

            # 2026-11-14: a world where the door answers as expected; faults[(what, service)] puts one fault in it
            recs, filed = {}, []
            for sv, _p, dc, rr, _st in EXPECT:
                t = canonical({"schema": "a2a-admission-v0", "decision": dc, "reasons": rr, "test": sv})
                recs[sv] = (t.encode(), hashlib.sha256(t.encode()).hexdigest())
            by_sha = {h: sv for sv, (_t, h) in recs.items()}

            def act(f):
                if f == "sigterm":
                    os.kill(os.getpid(), signal.SIGTERM)
                    time.sleep(0.2)
                    raise AssertionError("SIGTERM was not raised in the call")
                if isinstance(f, BaseException):
                    raise f
                return f()

            def world2(faults=None, tip_fault=None):
                faults = dict(faults or {})
                del posts[:], filed[:]

                def tip():
                    if tip_fault is not None:
                        act(tip_fault)
                    return 900000

                def fake(method, url, body=None, headers=None, timeout=120):
                    if "/balance?" in url:
                        return 200, {}, b'{"tickets": 50}'
                    if method == "POST" and "/report?" in url:
                        sv = url.rsplit("service=", 1)[1]
                        posts.append(sv)
                        if ("post", sv) in faults:
                            return act(faults[("post", sv)])
                        t, h = recs[sv]
                        if sv == "report":
                            return 200, {"X-Seki-Decision": "admit", "X-Seki-Record-Sha256": h, "X-Seki-Admission-Sha256": "ab" * 32, "X-Tickets-Spent": "20"}, b"%PDF-1.7 test"
                        return 403, {"X-Seki-Decision": "refuse", "X-Seki-Record-Sha256": h}, b'{"error":"refused"}'
                    if method == "GET" and url.startswith(GATEWAY + "/seki/record/"):
                        sv = by_sha[url.rsplit("/", 1)[1]]
                        f = faults.get(("record", sv))
                        if isinstance(f, list):
                            f = f.pop(0) if f else None
                        if f is not None:
                            return act(f)
                        return 200, {}, recs[sv][0]
                    if method == "GET" and url.startswith(LEDGER + "/admission/"):
                        sv = by_sha[url.rsplit("/", 1)[1]]
                        if ("ledger", sv) in faults:
                            return act(faults[("ledger", sv)])
                        return 200, {}, b"{}"
                    if method == "POST" and url == AGREEMENT + "/execution":
                        filed.append(hashlib.sha256(body).hexdigest())
                        return 201, {}, b'{"verdict":"accepted"}'
                    if method == "GET" and url == GATEWAY + "/health":
                        return 404, {}, b""
                    raise AssertionError("an unexpected call in the test: %s %s" % (method, url))

                def verify(rec, pub_, c):
                    if ("verify", rec.get("test")) in faults:
                        act(faults[("verify", rec.get("test"))])
                    return {"verdict": "accepted"}
                g["http"], g["tip_height"] = fake, tip
                A.verify_admission = verify

            def day(root):
                d = os.path.join(td, root, "2026-11-14")
                return json.load(open(os.path.join(d, "RUN.json"), encoding="utf-8")), d

            def stop(root, want):
                try:
                    run(os.path.join(td, root), "2026-11-14", now=noon, sleep=slept.append)
                except want as x:
                    return x
                raise AssertionError("run() did not stop with %s" % want.__name__)

            def guard(signum, _frame):
                raise RuntimeError("SIGTERM reached the test, not run()")
            signal.signal(signal.SIGTERM, guard)
            world2()
            assert run(os.path.join(td, "ok"), "2026-11-14", now=noon, sleep=slept.append) == 0 and posts == ["report", "audit", "compare"] and len(filed) == 1
            rok, dok = day("ok")
            assert rok["result"] == "as expected" and [c["status"] for c in door_calls(rok)] == [200, 403, 403] and door_calls(rok)[0]["execution_sha256"] == filed[0]
            assert signal.getsignal(signal.SIGTERM) is guard, "run() gives SIGTERM back as it found it"
            ROW = set(door_calls(rok)[1]) - {"ledger_url"}
            n += 1; print("[21] a stop from outside after a call was sent (KeyboardInterrupt, SystemExit, SIGTERM, and SIGTERM again while the day is "
                          "being written) closes the day as NOT as expected, writes it, and stops; the next run spends nothing; a stop before any call writes nothing")
            for root, fault, want, name in (("ki", KeyboardInterrupt(), KeyboardInterrupt, "KeyboardInterrupt"), ("se", SystemExit(3), SystemExit, "SystemExit"),
                                            ("term", "sigterm", Terminated, "Terminated")):
                world2({("post", "audit"): fault})
                x = stop(root, want)
                rj, dd = day(root)
                assert posts == ["report", "audit"] and len(filed) == 1, (root, posts, filed)
                assert rj["result"].startswith("NOT as expected") and rj["result"].endswith("the run raised %s after 2 of the day's calls were sent" % name), (root, rj["result"])
                assert [(c["service"], c["status"]) for c in rj["calls"]] == [("report", 200), ("audit", None)] and rj["calls"][0]["execution_sha256"] == filed[0]
                assert os.path.exists(os.path.join(dd, "request_audit.json")) and os.path.exists(os.path.join(dd, "execution_report.json"))
                assert signal.getsignal(signal.SIGTERM) is guard, root
                if root == "se":
                    assert x.code == 3
                if root == "term":
                    assert x.code == 128 + signal.SIGTERM
                assert run(os.path.join(td, root), "2026-11-14", now=noon, sleep=slept.append) == 1 and posts == ["report", "audit"], "already ran: no second call"
            # a cancel on Actions: SIGINT, and SIGTERM while the day is being closed: the day is written in full, then the stop goes on
            orig_close = keep["close_raised_day"]

            def close_then_term(*a):
                os.kill(os.getpid(), signal.SIGTERM)
                time.sleep(0.2)
                return orig_close(*a)
            world2({("post", "compare"): KeyboardInterrupt()})
            g["close_raised_day"] = close_then_term
            try:
                x = stop("ki2", (KeyboardInterrupt, Terminated))
            finally:
                g["close_raised_day"] = orig_close
            assert isinstance(x, Terminated), "the SIGTERM waited until the day was written, then stopped the run"
            rj, dd = day("ki2")
            assert rj["result"].endswith("the run raised KeyboardInterrupt after 3 of the day's calls were sent") and [c["status"] for c in rj["calls"]] == [200, 403, None]
            assert run(os.path.join(td, "ki2"), "2026-11-14", now=noon, sleep=slept.append) == 1 and posts == ["report", "audit", "compare"]
            # before any call: the stop goes on and nothing is written, so a later run can still make the calls
            for root, fault, want in (("ki0", KeyboardInterrupt(), KeyboardInterrupt), ("term0", "sigterm", Terminated)):
                world2(tip_fault=fault)
                stop(root, want)
                assert posts == [] and not os.path.exists(os.path.join(td, root, "2026-11-14", "RUN.json")) and signal.getsignal(signal.SIGTERM) is guard
            n += 1; print("[22] a call that gets no answer is named by the day file: its row (nonce, request_sha256, the answer's fields null, the keys a row "
                          "always has) and request_<service>.json are written before it is sent; settle, the index and door_calls read such a day")
            world2({("post", "report"): TimeoutError("the gateway did not answer")})
            assert run(os.path.join(td, "h2"), "2026-11-14", now=noon, sleep=slept.append) == 1 and posts == ["report"] and filed == []
            rj, dd = day("h2")
            assert set(rj) == set(rok), "no new key in the day's record"
            row = rj["calls"][0]
            assert len(rj["calls"]) == 1 and set(row) == ROW, (set(row) ^ ROW)
            assert row["status"] is None and row["decision"] is None and row["record_sha256"] is None and row["tickets_spent"] is None
            assert len(row["nonce"]) == 32 and set(row["nonce"]) <= H64 and is_h64(row["request_sha256"])
            rq = open(os.path.join(dd, "request_report.json"), encoding="utf-8").read()
            assert hashlib.sha256(rq.encode()).hexdigest() == row["request_sha256"] and json.loads(rq)["nonce"] == row["nonce"]
            assert door_calls(rj) == [row] and settle_day(dd, cj, os.path.join(td, "nochunks")) == "skip (the run itself failed; nothing to settle)"
            write_index(os.path.join(td, "h2"))
            assert "| 2026-11-14 | ? " in open(os.path.join(td, "h2", "README.md"), encoding="utf-8").read()
            assert run(os.path.join(td, "h2"), "2026-11-14", now=noon, sleep=slept.append) == 1 and posts == ["report"], "already ran: no second call"
            n += 1; print("[23] the reads after an admitted call (the door's record, its parse, verify and judge, the ledger) fail a check when they raise and the "
                          "run goes on: the execution record is filed whenever the door's record was read, the day is written NOT as expected, audit and compare are still called")
            for root, faults, filed_n, why in (
                    ("rec1", {("record", "report"): [OSError("reset"), OSError("reset")]}, 1, None),
                    ("rec3", {("record", "report"): [OSError("reset")] * 3}, 0, "report: the door serves the record by its sha256"),
                    ("parse", {("record", "report"): [lambda: (200, {}, b"{not json")]}, 0, "report: the door's record is read ("),
                    ("verify", {("verify", "report"): ValueError("bad signature block")}, 1, "report: the record was checked (verify and judge)"),
                    ("ledger", {("ledger", "report"): OSError("no route")}, 1, "report: the ledger holds the record"),
                    ("ledger_a", {("ledger", "audit"): OSError("no route")}, 1, "audit: the ledger holds the record")):
                world2(faults)
                del slept[:]
                assert run(os.path.join(td, root), "2026-11-14", now=noon, sleep=slept.append) == (0 if why is None else 1), root
                rj, dd = day(root)
                assert posts == ["report", "audit", "compare"] and len(filed) == filed_n, (root, posts, filed)
                assert [c["status"] for c in door_calls(rj)] == [200, 403, 403] and rj["calls"][-1].get("scene") == "mismatch"
                if why is None:
                    assert rj["result"] == "as expected" and slept == [5, 5], (root, slept)
                    continue
                assert rj["result"].startswith("NOT as expected: ") and why in rj["result"], (root, rj["result"])
                assert "the run raised" not in rj["result"], (root, rj["result"])
                if filed_n:
                    assert door_calls(rj)[0]["execution_sha256"] == filed[0] and os.path.exists(os.path.join(dd, "execution_report.json"))
                else:
                    assert "report: the execution record is made (it needs the door's record" in rj["result"] and not os.path.exists(os.path.join(dd, "execution_report.json"))
    finally:
        g.update(keep)
        A.verify_admission = keep_verify
        signal.signal(signal.SIGTERM, keep_term)
        for k, v in kenv.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    rsrc = inspect.getsource(run)
    assert rsrc.index("sent += 1") < rsrc.index('st, hd, rb = http("POST", "%s/report?store=%s&service=%s"') and rsrc.count("sent += 1") == 1
    assert rsrc.index('record["calls"].append(call)') < rsrc.index("sent += 1") and rsrc.count('record["calls"].append(call)') == 1
    assert rsrc.count("except BaseException as e:") == 1 and rsrc.count("closed = close_raised_day(record, call, sent, e, fails)") == 1
    print("ALL PASS (seki heartbeat: %d checks)" % n)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", nargs="?", choices=["run", "settle", "index", "gaps"])
    ap.add_argument("--root", default=os.path.join(HERE, "runs"))
    ap.add_argument("--date", default=responsible_day(datetime.datetime.now(datetime.timezone.utc)))
    ap.add_argument("--through", default=None, help="gaps: the last day to check (default: the day a run started now is for)")
    ap.add_argument("--days", type=int, default=7, help="gaps: how many days back, the last included")
    ap.add_argument("--json", default=None, help="gaps: write {through, missed} here")
    ap.add_argument("--view-chunks", default=os.path.join(HERE, "view-chunks"))
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        _selftest(); return 0
    if a.cmd == "run":
        rc = run(a.root, a.date); write_index(a.root); return rc
    if a.cmd == "settle":
        rc = settle(a.root, a.view_chunks); write_index(a.root); return rc
    if a.cmd == "gaps":
        through = a.through or a.date
        missed = gaps(a.root, through, a.days)
        if a.json:
            with open(a.json, "w", encoding="utf-8") as f:
                json.dump({"through": through, "days": a.days, "missed": missed}, f)
        print(("days without a heartbeat run (%s back to %d days): %s" % (through, a.days, ", ".join(missed))) if missed else "every day up to %s has a heartbeat run" % through)
        return 1 if missed else 0
    if a.cmd == "index":
        write_index(a.root); return 0
    ap.print_help(); return 1


if __name__ == "__main__":
    sys.exit(main())
