"""tasuki: walk one paid call from its admission record to the Bitcoin anchor, one handoff (link) at a time.

  nenrin-verify tasuki <record_sha256> [--now YYYY-MM-DDTHH:MM:SSZ]

record_sha256 is the sha256 of the admission record's bytes, the key the ledger serves it under (GET /admission/<sha>).
Each link asks one thing: does the later record name the earlier one by its digest, and do the digests recompute?

    adm->check         the admission's content block names a check (0.4 content.check_sha256; 0.5 every checks[] entry
                       read as an answer), and exactly one leaf of its runner's day holds an envelope whose check hashes to
                       it (furui-day steps envelope_shape and leaf_sha256 on that leaf)
    check->day         the leaf's RFC 6962 audit path rebuilds the root of the day record the ledger serves, under the
                       runner's signature and listed key (furui-day steps audit_path, signature, runner_key)
    day->entry         the day record is listed in a ledger batch entry whose bytes hash to its claim (furui-day step 6)
    adm->entry         the admission is listed in the ledger batch entry the ledger names for it
    adm->exec          the execution the store's day file names (runs/<day>/RUN.json) is served by the agreement intake
                       as bytes that hash to its sha, and its admission_ref names the admission_sha256 the public
                       verifier computes from the record (admission_verify_v0.admission_sha256), with the same nonce
    exec->result       the execution's nenrin_ref is the report_sha256 of the same call in the day file (the report's
                       bytes are not read)
    exec->entry        the execution is listed in a ledger batch entry (nenrin-agreement-batch-v1, kind execution)
    exec->settle       the day's final settlement (SETTLED.json and the settlement.json bytes it names) lists the anchored
                       execution in authoritative_event_set and the admission_sha256 in admission_gate.admissions_read
    settle->recompute  the settle version SETTLED.json names, run here on the anchored records of runs/<day>/, the
                       contract and the Bitcoin headers of seki-heartbeat/view-chunks, gives the settlement.json bytes
    entry->ots         every ledger entry found above carries an OpenTimestamps proof of its claim to a Bitcoin block
    day->witness       a signed witness answer (witness-answer-v0) names the day record's sha256, root and n

Each link ends in holds, missing (a named field is absent, a digest does not match, a signature does not verify) or
not_yet (the runner's day closes at 00:47 UTC the next day, the ledger batch, the Bitcoin confirmation, the settlement,
the witness answer). A link whose earlier link does not hold takes that state and says so in follows; only links with
follows null are causes. The relying party's key is the one record.relying_party.key_url serves at the time of the walk
(its host must be the relying party's domain). Exit: 0 every link holds, 3 none missing and some not_yet, 1 a link is
missing, 2 usage or network error. Network: GET only, no redirects, to the ledger, the runner, the agreement intake,
raw.githubusercontent.com (the repository's main branch) and the relying party's key_url. No content is read.
"""
import datetime
import hashlib
import json
import re
import sys

from . import furui_day as F

LEDGER = F.LEDGER
FURUI = F.FURUI
AGREEMENT = "https://agreement.horizonshield.dev"
RAW = "https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/"
RAW_RUNS = RAW + "workers/hs-ledger/nenrin/seki-heartbeat/runs/"
RAW_CHUNKS = RAW + "workers/hs-ledger/nenrin/seki-heartbeat/view-chunks/"
# where a store's settlement inputs live: its contract (the sha must be the one RUN.json names)
CONTRACTS = {"hs-seki-demo": RAW + "workers/hs-ledger/nenrin/musubi-v0/run0003/contract.json"}
HOSTS = ("ledger.horizonshield.dev", "furui.horizonshield.dev", "agreement.horizonshield.dev", "raw.githubusercontent.com")
SCHEMA = "nenrin-tasuki-walk-v0"
LINKS = ["adm->check", "check->day", "day->entry", "adm->entry", "adm->exec", "exec->result", "exec->entry", "exec->settle",
         "settle->recompute", "entry->ots", "day->witness"]
DOES_NOT_ESTABLISH = [
    "A chain that holds shows that each handoff left a record that names the one before it; it does not show that any judgment in it was right.",
    "The admission names a salted commitment to the content, not the content: the walk does not show which content the check read.",
    "The report's bytes are named by their sha256 and are not read: the walk does not show what the report says.",
    "not_yet is a wait for a time or a later record, not a finding either way.",
    "The relying party's key is the one its key_url serves at the time of the walk.",
]
DAY_CLOSE = (0, 47)          # a runner day D closes at 00:47 UTC of D+1
BATCH_DONE = (1, 5)          # the ledger's daily batches (00:30 admissions, 00:45 executions) are made by 01:05 UTC
CHUNK = 1000                 # seki-heartbeat view-chunks: files of 1000 headers from the contract's lower bound
LEAF_SCAN = 256              # at most this many leaves of one runner day are read to find a check
ENTRY_SCAN = 200             # at most this many ledger entries are read back from the head
DAY_SHIFT = datetime.timedelta(hours=6)   # heartbeat.py responsible_day: the UTC day of the start minus 6 hours
H64 = F.H64
ISO = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z")


class NetError(F.NetError):
    pass


class Fetcher:
    """the default GET: only HOSTS (raw.githubusercontent.com only under the repository's main branch), plus the hosts
    allow() adds (the relying party's key_url), no redirects; (status, body bytes)"""
    def __init__(self, timeout=30):
        self.hosts, self.timeout = list(HOSTS), timeout

    def allow(self, host):
        if host and host not in self.hosts:
            self.hosts.append(host)

    def __call__(self, url):
        if url.startswith("https://raw.githubusercontent.com/") and not url.startswith(RAW):
            raise NetError("not an allowed URL: " + url)
        try:
            return F._http_get(url, tuple(self.hosts), "application/json", 8 * 1024 * 1024, self.timeout)
        except F.NetError as e:
            raise NetError(str(e))


def _when(s):
    if not (isinstance(s, str) and ISO.fullmatch(s)):
        return None
    t = s[:19]
    return datetime.datetime.strptime(t, "%Y-%m-%dT%H:%M:%S").replace(tzinfo=datetime.timezone.utc)


def _iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def _at(day, hm, plus_days=1):
    d = datetime.datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=datetime.timezone.utc)
    return d + datetime.timedelta(days=plus_days, hours=hm[0], minutes=hm[1])


def _load(name):
    from . import musubi
    return musubi.load(name)


class _Walk:
    def __init__(self, get, now):
        self._get, self.now, self.memo = get, now, {}
        self.links = {}
        self.facts = {}
        self._entries = None

    def get(self, url):
        """every URL is asked once per walk"""
        if url not in self.memo:
            self.memo[url] = self._get(url)
        return self.memo[url]

    def getj(self, url):
        s, b = self.get(url)
        try:
            return s, F.parse_json(b)
        except F._Bad:
            return s, None

    def put(self, link, state, why, digests=None, follows=None):
        self.links[link] = {"link": link, "state": state, "why": why, "digests": digests or {}, "follows": follows}

    def follow(self, link, parent, digests=None):
        """link cannot be walked before parent holds: it takes parent's state"""
        p = self.links[parent]
        self.put(link, p["state"], "follows %s (%s)" % (parent, p["state"]), digests, parent)

    def holds(self, link):
        return self.links.get(link, {}).get("state") == "holds"

    def entries(self, since):
        """ledger entries from the head back to the first created before since (cached; at most ENTRY_SCAN read):
        [(n, entry dict, batch dict or None)], complete flag"""
        if self._entries is None:
            self._entries = {"list": [], "low": None, "next": None, "complete": False}
            s, h = self.getj(LEDGER + "/ledger/head")
            n = h.get("n") if s == 200 and isinstance(h, dict) else None
            if not F._isint(n, 1):
                raise NetError("the ledger's head answered http %s without n" % s)
            self._entries["next"] = n
        E = self._entries
        while E["next"] and E["next"] >= 1 and (E["low"] is None or E["low"] >= since):
            if len(E["list"]) >= ENTRY_SCAN:
                return E["list"], False
            i = E["next"]
            s, e = self.getj(LEDGER + "/ledger/%d?format=json" % i)
            t = _when(e.get("created_at")) if s == 200 and isinstance(e, dict) else None
            if t is None:
                raise NetError("ledger entry %d answered http %s without created_at" % (i, s))
            rc = e.get("record_canonical")
            try:
                b = F.parse_json(rc) if isinstance(rc, str) else None
            except F._Bad:
                b = None
            E["list"].append((i, e, b if isinstance(b, dict) else None, t))
            E["low"], E["next"] = t, i - 1
        return [x for x in E["list"]], True


def _ots(W, n, e):
    """the OpenTimestamps half of furui_day._anchor, for an entry already read: (state, code, facts)"""
    if e.get("ots_status") != "confirmed" or not F._isint(e.get("bitcoin_block"), 1):
        return "not_yet", "ots_not_confirmed", {"entry": n}
    s, b = W.get(LEDGER + "/ledger/%d/ots" % n)
    if s != 200:
        return "missing", "ots_http_%d" % s, {"entry": n}
    try:
        digest, btc, _p = F.ots_parse(b)
    except F._Bad:
        return "missing", "ots_parse", {"entry": n}
    if digest.hex() != e.get("claim_sha256"):
        return "missing", "ots_digest_is_not_the_entry", {"entry": n}
    hit = [m for (h, m) in btc if h == e["bitcoin_block"]]
    if not hit:
        return "missing", "ots_height_is_not_the_entry_block", {"entry": n}
    return "holds", None, {"entry": n, "bitcoin_block": e["bitcoin_block"], "merkle_root": hit[0]}


# ---- the leaf of a check: kept here so that TOOSHI (17) and this walk read one function ----
def leaves_holding(get, day, check_sha256, runner=1, scan=LEAF_SCAN):
    """the leaves of runner's day whose envelope has the closed shape and whose check hashes (musubi-canonical-v0) to
    check_sha256. -> (state, why, [leaf index]); state is "read", "not_yet" (the day is open) or "missing" (the runner
    does not serve the day's leaves)"""
    rid, path = "runner-%d" % runner, FURUI + F.RUNNER_PATHS[runner]

    def getj(u):
        s, b = get(u)
        try:
            return s, F.parse_json(b)
        except F._Bad:
            return s, None
    s, a = getj(path + "%s/leaf/0" % day)
    if s == 404 and isinstance(a, dict) and a.get("error") == "day_open":
        ss, st = getj(path + "%s/status" % day)
        v = st.get("status") if ss == 200 and isinstance(st, dict) and st.get("day") == day else None
        if isinstance(v, dict) and v.get("state") == "empty":
            return "read", "the day closed empty", []
        return "not_yet", "day_open", []
    if s != 200 or not isinstance(a, dict) or not F._isint(a.get("n"), 1):
        return "missing", "leaf_http_%d" % s if s != 200 else "leaf_without_n", []
    n, hits = a["n"], []
    for i in range(min(n, scan)):
        if i:
            s, a = getj(path + "%s/leaf/%d" % (day, i))
        env = a.get("envelope") if s == 200 and isinstance(a, dict) else None
        if env is None or F.envelope_problem(env, rid):
            continue
        try:
            if F.sha(F.canonical(env["check"])) == check_sha256:
                hits.append(i)
        except F._Bad:
            continue
    return "read", ("only the first %d of %d leaves were read" % (scan, n) if n > scan else None), hits


def _checks_of(rec):
    """[(runner number, check_sha256)] the admission names, or None with a reason"""
    rules = rec.get("rules") if isinstance(rec.get("rules"), dict) else {}
    cb = rec.get("content")
    if not isinstance(cb, dict):
        return None, "no_content_block (rules.version %s)" % rules.get("version")
    if rules.get("version") == "0.5" and isinstance(cb.get("checks"), list):
        out = []
        for q in cb["checks"]:
            if not (isinstance(q, dict) and q.get("why") == "ok"):
                continue
            m = re.fullmatch(r"runner-([0-9])", q.get("key_id") or "")
            if not m or int(m.group(1)) not in F.RUNNER_PATHS or not (isinstance(q.get("check_sha256"), str) and H64.fullmatch(q["check_sha256"])):
                return None, "a check of %s that no runner day can hold" % q.get("key_id")
            out.append((int(m.group(1)), q["check_sha256"]))
        return (out, None) if out else (None, "no check of checks[] read as an answer")
    ck = cb.get("check_sha256")
    if isinstance(ck, str) and H64.fullmatch(ck):
        return [(1, ck)], None
    return None, "no content.check_sha256"


def _worst(states):
    return "missing" if "missing" in states else ("not_yet" if "not_yet" in states else "holds")


def _furui(W, rec, t, refused):
    """adm->check, check->day, day->entry; -> [(day, day record sha256, root, n)] and the day entries [(n, state, code, facts)]"""
    days_found, entries = [], []
    if refused:
        W.put("adm->check", "missing", refused)
    else:
        cks, why = _checks_of(rec)
        if cks is None:
            W.put("adm->check", "missing", why)
    if "adm->check" in W.links:
        for k in ("check->day", "day->entry"):
            W.follow(k, "adm->check")
        return days_found, entries
    a_st, c_st, d_st, a_d, c_d, d_d = [], [], [], [], [], []
    days = sorted({t.strftime("%Y-%m-%d"), (t - datetime.timedelta(minutes=10)).strftime("%Y-%m-%d")})
    for runner, ck in cks:
        hits, notes, waits = [], [], []
        for d in days:
            if W.now < _at(d, DAY_CLOSE):
                waits.append(d)
                continue
            st, why, ix = leaves_holding(W.get, d, ck, runner)
            if st == "not_yet":
                waits.append(d)
            elif st == "missing":
                notes.append("%s: %s" % (d, why))
            else:
                hits += [(d, i) for i in ix]
                if why:
                    notes.append("%s: %s" % (d, why))
        dg = {"runner": "runner-%d" % runner, "check_sha256": ck, "days": days}
        if len(hits) == 1:
            d, i = hits[0]
            res = F.furui_day(d, i, W.get, runner=runner)
            steps = {x["name"]: x for x in res["steps"]}
            dg.update(day=d, leaf=i)
            a_d.append(dg)
            if any(steps[k]["state"] != "ok" for k in ("envelope_shape", "leaf_sha256")):
                a_st.append("missing")
                dg["why"] = "furui-day: " + ", ".join("%s %s" % (k, steps[k]["code"]) for k in ("envelope_shape", "leaf_sha256") if steps[k]["state"] != "ok")
                continue
            a_st.append("holds")
            mid = [steps[k] for k in ("audit_path", "signature", "runner_key")]
            cd = {"runner": "runner-%d" % runner, "day": d, "leaf": i, "day_record_sha256": res["facts"]["record_sha256"], "root": res["facts"]["root"], "n": res["facts"]["n"]}
            c_d.append(cd)
            if any(x["state"] == "fail" for x in mid):
                c_st.append("missing")
                cd["why"] = "furui-day: " + ", ".join("%s %s" % (x["name"], x["code"]) for x in mid if x["state"] == "fail")
                continue
            if any(x["state"] == "not_yet" for x in mid):
                c_st.append("not_yet")
                cd["why"] = "furui-day: " + ", ".join("%s %s" % (x["name"], x["code"]) for x in mid if x["state"] == "not_yet")
                continue
            c_st.append("holds")
            days_found.append((d, res["facts"]["record_sha256"], res["facts"]["root"], res["facts"]["n"]))
            s6 = steps["bitcoin_anchor"]
            dd = {"runner": "runner-%d" % runner, "day_record_sha256": res["facts"]["record_sha256"], "entry": res["facts"]["ledger_entry"]}
            d_d.append(dd)
            if res["facts"]["ledger_entry"] is None:
                d_st.append("not_yet" if s6["state"] == "not_yet" else "missing")
                dd["why"] = "furui-day bitcoin_anchor %s" % s6["code"]
                continue
            d_st.append("holds")
            ost = {"ok": "holds", "not_yet": "not_yet"}.get(s6["state"], "missing")
            entries.append((res["facts"]["ledger_entry"], ost, s6["code"], {"entry": res["facts"]["ledger_entry"], "of": "day record " + res["facts"]["record_sha256"],
                                                                         "bitcoin_block": res["facts"]["bitcoin_block"], "merkle_root": res["facts"]["merkle_root"]}))
        elif hits:
            a_st.append("missing")
            dg.update(leaves=["%s/%d" % x for x in hits], why="%d leaves hold the check (one is required)" % len(hits))
            a_d.append(dg)
        elif waits:
            a_st.append("not_yet")
            dg["why"] = "the runner day %s closes at 00:47 UTC the next day" % ", ".join(waits)
            a_d.append(dg)
        else:
            a_st.append("missing")
            dg["why"] = "no leaf of %s holds the check%s" % (", ".join(days), (" (" + "; ".join(notes) + ")") if notes else "")
            a_d.append(dg)
    st = _worst(a_st)
    W.put("adm->check", st, {"holds": "exactly one leaf of its runner's day holds each check the admission names",
                             "not_yet": "the runner's day is not closed yet", "missing": "a check the admission names is not held by exactly one leaf"}[st], {"checks": a_d})
    if st != "holds":
        W.follow("check->day", "adm->check")
        W.follow("day->entry", "adm->check")
        return days_found, entries
    st = _worst(c_st)
    W.put("check->day", st, {"holds": "the audit path rebuilds the day record's root, signed by the runner under its listed key",
                             "not_yet": "the day record is not accepted at the ledger yet", "missing": "the leaf does not reach the day record"}[st], {"days": c_d})
    if st != "holds":
        W.follow("day->entry", "check->day")
        return days_found, entries
    st = _worst(d_st)
    W.put("day->entry", st, {"holds": "the day record is listed in a ledger batch entry", "not_yet": "the day record is not in a ledger batch yet",
                             "missing": "the ledger batch does not list the day record"}[st], {"days": d_d})
    return days_found, entries


def _adm_entry(W, sha, st, refused):
    if refused:
        W.put("adm->entry", "missing", refused)
        return []
    n = st.get("ledger_entry")
    dg = {"record_sha256": sha, "status": st.get("status"), "entry": n if F._isint(n, 1) else None}
    if st.get("status") != "anchored" or not F._isint(n, 1):
        W.put("adm->entry", "not_yet", "the ledger says %s (the admission is not in an anchored batch yet)" % st.get("status"), dg)
        return []
    run = F._Run(W.get, [])
    part, state, code = F._anchor(run, n, sha, "a2a-admission-v0", True)
    if part == "batch":
        W.put("adm->entry", "missing", "furui-day anchor: %s" % code, dg)
        return []
    W.put("adm->entry", "holds", "ledger entry %d lists the admission" % n, dg)
    return [(n, {"ok": "holds", "not_yet": "not_yet"}.get(state, "missing"), code,
             {"entry": n, "of": "admission " + sha, "bitcoin_block": run.facts.get("bitcoin_block"), "merkle_root": run.facts.get("merkle_root")})]


def _run_call(W, sha, t):
    """the store's day file that names the call: (day, RUN.json, the call row) or (None, None, None)"""
    for d in sorted({(t - DAY_SHIFT).strftime("%Y-%m-%d"), t.strftime("%Y-%m-%d")}):
        s, r = W.getj(RAW_RUNS + d + "/RUN.json")
        if s != 200 or not isinstance(r, dict) or not isinstance(r.get("calls"), list):
            continue
        rows = [k for k in r["calls"] if isinstance(k, dict) and k.get("record_sha256") == sha and not k.get("scene")]
        if len(rows) == 1:
            return d, r, rows[0]
    return None, None, None


def _exec(W, sha, rec, adm_sha, t, refused):
    """adm->exec and exec->result; -> (day, RUN.json, call row, execution sha, execution record) or Nones"""
    none = (None, None, None, None, None)
    if refused:
        W.put("adm->exec", "missing", refused)
        W.follow("exec->result", "adm->exec")
        return none
    if rec.get("decision") != "admit":
        W.put("adm->exec", "missing", "the admission is not an admit (%s), so no execution follows it" % rec.get("decision"))
        W.follow("exec->result", "adm->exec")
        return none
    d, r, call = _run_call(W, sha, t)
    if call is None:
        st = "not_yet" if W.now - t < datetime.timedelta(hours=24) else "missing"
        W.put("adm->exec", st, "no day file of the store (seki-heartbeat runs/<day>/RUN.json) names the call", {"admission_sha256": adm_sha})
        W.follow("exec->result", "adm->exec")
        return none
    xs = call.get("execution_sha256")
    dg = {"admission_sha256": adm_sha, "run_day": d, "execution_sha256": xs}
    if not (isinstance(xs, str) and H64.fullmatch(xs)):
        W.put("adm->exec", "missing", "the day file names no execution for the call", dg)
        W.follow("exec->result", "adm->exec")
        return d, r, call, None, None
    s, b = W.get(AGREEMENT + "/execution/" + xs)
    if s != 200 or F.sha(b) != xs:
        W.put("adm->exec", "missing", "the agreement intake does not serve the execution as bytes that hash to it (http %d)" % s, dg)
        W.follow("exec->result", "adm->exec")
        return d, r, call, xs, None
    try:
        ex = F.parse_json(b)
    except F._Bad:
        ex = None
    refs = ex.get("admission_ref") if isinstance(ex, dict) and ex.get("schema") == "a2a-execution-v0" else None
    hit = [x for x in (refs if isinstance(refs, list) else []) if isinstance(x, dict) and x.get("admission_sha256") == adm_sha]
    nonce = (rec.get("action_ref") or {}).get("nonce") if isinstance(rec.get("action_ref"), dict) else None
    if len(hit) != 1:
        W.put("adm->exec", "missing", "the execution's admission_ref does not name the admission_sha256 once", dg)
    elif not isinstance(hit[0].get("executed"), dict) or hit[0]["executed"].get("nonce") != nonce:
        W.put("adm->exec", "missing", "the execution's nonce is not the admission's action_ref.nonce", dg)
    else:
        dg["nonce"] = nonce
        W.put("adm->exec", "holds", "the execution names the admission_sha256 computed from the record, with the same nonce", dg)
    if not W.holds("adm->exec"):
        W.follow("exec->result", "adm->exec")
        return d, r, call, xs, ex
    ref, rep = ex.get("nenrin_ref"), call.get("report_sha256")
    dg2 = {"nenrin_ref": ref, "report_sha256": rep}
    if isinstance(ref, str) and H64.fullmatch(ref) and ref == rep:
        W.put("exec->result", "holds", "the execution's nenrin_ref is the call's report_sha256", dg2)
    else:
        W.put("exec->result", "missing", "the execution's nenrin_ref is not the call's report_sha256", dg2)
    return d, r, call, xs, ex


def _listed(b, xs):
    rows = b.get("records") if isinstance(b, dict) and b.get("schema") == "nenrin-agreement-batch-v1" else None
    return isinstance(rows, list) and any(isinstance(x, dict) and ((x.get("sha") == xs and x.get("kind") == "execution")
                                                                   or (x.get("canonical_sha256") == xs and x.get("record_schema") == "a2a-execution-v0")) for x in rows)


def _exec_entry(W, xs, t):
    if not W.holds("adm->exec"):
        W.follow("exec->entry", "adm->exec")
        return []
    es, complete = W.entries(t - datetime.timedelta(minutes=10))
    hits = [(n, e) for (n, e, b, _t) in es if _listed(b, xs)]
    dg = {"execution_sha256": xs, "entries_read": len(es)}
    if len(hits) == 1:
        n, e = hits[0]
        if not (isinstance(e.get("record_canonical"), str) and e.get("claim_sha256") == F.sha(e["record_canonical"])):
            W.put("exec->entry", "missing", "ledger entry %d's bytes do not hash to its claim" % n, dict(dg, entry=n))
            return []
        W.put("exec->entry", "holds", "ledger entry %d lists the execution" % n, dict(dg, entry=n))
        st, code, f = _ots(W, n, e)
        f["of"] = "execution " + xs
        return [(n, st, code, f)]
    if hits:
        W.put("exec->entry", "missing", "%d ledger entries list the execution" % len(hits), dict(dg, entries=[n for n, _e in hits]))
        return []
    if W.now < _at(t.strftime("%Y-%m-%d"), BATCH_DONE):
        W.put("exec->entry", "not_yet", "the ledger's batch of the day after the call is made by 01:05 UTC", dg)
    elif not complete:
        W.put("exec->entry", "missing", "not in the %d ledger entries read back from the head" % len(es), dg)
    else:
        W.put("exec->entry", "missing", "no ledger entry made since the call lists the execution", dg)
    return []


def _settle(W, d, r, call, xs, adm_sha, rp, pub):
    if not W.holds("adm->exec"):
        W.follow("exec->settle", "adm->exec")
        W.follow("settle->recompute", "exec->settle")
        return
    s, S = W.getj(RAW_RUNS + d + "/SETTLED.json")
    dg = {"run_day": d}
    if s == 404 or (s == 200 and isinstance(S, dict) and S.get("status") != "final"):
        W.put("exec->settle", "not_yet", "the day %s is not settled final yet (SETTLED.json %s)" % (d, "absent" if s == 404 else S.get("status")), dg)
        W.follow("settle->recompute", "exec->settle")
        return
    if s != 200 or not isinstance(S, dict) or not (isinstance(S.get("settlement_sha256"), str) and H64.fullmatch(S["settlement_sha256"])):
        W.put("exec->settle", "missing", "SETTLED.json of %s answered http %s without settlement_sha256" % (d, s), dg)
        W.follow("settle->recompute", "exec->settle")
        return
    C = _load("contract_v0")
    ts, tb = W.get(RAW_RUNS + d + "/settlement.json")
    dg["settlement_sha256"] = S["settlement_sha256"]
    if ts != 200 or F.sha(tb) != S["settlement_sha256"]:
        W.put("exec->settle", "missing", "settlement.json is not served as the bytes SETTLED.json names (http %d)" % ts, dg)
        W.follow("settle->recompute", "exec->settle")
        return
    svc = call.get("service")
    as_, ab = W.get(RAW_RUNS + d + "/execution_%s.anchored.json" % svc)
    try:
        anc = C.parse_strict(ab.decode("utf-8")) if as_ == 200 else None
        st = C.parse_strict(tb.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        anc, st = None, None
    if not isinstance(anc, dict) or not isinstance(st, dict):
        W.put("exec->settle", "missing", "the anchored execution or the settlement of %s cannot be read (http %d)" % (d, as_), dg)
        W.follow("settle->recompute", "exec->settle")
        return
    bare = {k: v for k, v in anc.items() if k != "anchor"}
    ev = F.sha(C.canonical(anc))
    dg["anchored_execution_sha256"] = ev
    evs = [x.get("sha256") for x in (st.get("authoritative_event_set") or []) if isinstance(x, dict) and x.get("kind") == "execution"]
    rd = (st.get("admission_gate") or {}).get("admissions_read") if isinstance(st.get("admission_gate"), dict) else None
    rd = rd if isinstance(rd, list) else []
    if F.sha(C.canonical(bare)) != xs:
        W.put("exec->settle", "missing", "the anchored execution of %s without its anchor is not the execution %s" % (d, xs[:12]), dg)
    elif evs.count(ev) != 1:
        W.put("exec->settle", "missing", "the settlement's authoritative_event_set does not list the anchored execution once", dg)
    elif not any(isinstance(x, dict) and x.get("admission_sha256") == adm_sha and x.get("decision") == "admit" and x.get("record_sha256") == ev for x in rd):
        W.put("exec->settle", "missing", "the settlement's admission_gate.admissions_read does not name the admission_sha256 as admit", dg)
    else:
        dg.update(verdict=st.get("verdict"), status=st.get("status"))
        W.put("exec->settle", "holds", "the final settlement of %s lists the execution and reads the admission" % d, dg)
    if not W.holds("exec->settle"):
        W.follow("settle->recompute", "exec->settle")
        return
    _recompute(W, d, r, S, tb, anc, rp, pub)


def _recompute(W, d, r, S, tb, anc, rp, pub):
    C = _load("contract_v0")
    from . import musubi
    m = re.fullmatch(r"v1\.([0-9]{1,3})", (S.get("settle") or "").split(" ")[0])
    mod = "settle_v1_%s" % m.group(1) if m else None
    dg = {"run_day": d, "settle": S.get("settle"), "view": S.get("view")}
    if mod is None or mod not in musubi.modules():
        W.put("settle->recompute", "missing", "SETTLED.json names a settle version this package does not carry (%s)" % S.get("settle"), dg)
        return
    url = CONTRACTS.get(r.get("store"))
    cs, cb = W.get(url) if url else (None, b"")
    try:
        contract = C.parse_strict(cb.decode("utf-8")) if cs == 200 else None
    except (ValueError, UnicodeDecodeError):
        contract = None
    if not isinstance(contract, dict) or C.contract_sha256(contract) != r.get("contract_sha256"):
        W.put("settle->recompute", "missing", "the contract of %s is not served as the one RUN.json names (%s)" % (r.get("store"), str(r.get("contract_sha256"))[:12]), dg)
        return
    v = S.get("view") if isinstance(S.get("view"), dict) else {}
    lo = (contract.get("lower_bound") or {}).get("height")
    if not (F._isint(lo) and v.get("from") == lo and F._isint(v.get("to")) and v["to"] >= lo):
        W.put("settle->recompute", "missing", "SETTLED.json's view does not start at the contract's lower bound", dg)
        return
    starts = list(range(lo, v["to"] + 1, CHUNK))
    headers, got = [], {}
    for a in [starts[-1]] + starts[:-1]:      # the last chunk first: before it is written the others are not read
        s, ch = W.getj(RAW_CHUNKS + "%d-%d.json" % (a, a + CHUNK - 1))
        if s == 404:
            W.put("settle->recompute", "not_yet", "the headers up to %d are not all in seki-heartbeat/view-chunks yet (no %d-%d.json); a chunk is written when its 1000 headers are final"
                  % (v["to"], a, a + CHUNK - 1), dg)
            return
        hs = ch.get("headers") if s == 200 and isinstance(ch, dict) else None
        if not isinstance(hs, list) or len(hs) != CHUNK:
            W.put("settle->recompute", "missing", "view chunk %d-%d.json answered http %d without its headers" % (a, a + CHUNK - 1, s), dg)
            return
        got[a] = hs
    for a in starts:
        headers += got[a]
    view = {"headers": [x for x in headers if isinstance(x, dict) and F._isint(x.get("height")) and x["height"] <= v["to"]]}
    adms = []
    for k in [k for k in r.get("calls") or [] if isinstance(k, dict) and not k.get("scene")]:
        s, b = W.get(RAW_RUNS + d + "/admission_%s.anchored.json" % k.get("service"))
        try:
            adms.append(C.parse_strict(b.decode("utf-8")) if s == 200 else None)
        except (ValueError, UnicodeDecodeError):
            adms.append(None)
    if any(x is None for x in adms):
        W.put("settle->recompute", "missing", "an anchored admission of %s is not served" % d, dg)
        return
    keys = {rp: pub}
    fn = getattr(_load(mod), mod)
    got = fn(contract, [anc], view, admissions=adms, relying_keys=keys)
    same = C.canonical(got).encode("utf-8") == tb
    dg["recomputed_sha256"] = hashlib.sha256(C.canonical(got).encode("utf-8")).hexdigest()
    if mod != "settle_v1_20":
        g20 = _load("settle_v1_20").settle_v1_20(contract, [anc], view, admissions=adms, relying_keys=keys)
        dg["v1_20_same_verdict_status_deviations"] = (g20.get("verdict"), g20.get("status"), C.canonical(g20.get("deviations"))) == (
            got.get("verdict"), got.get("status"), C.canonical(got.get("deviations")))
    if same:
        W.put("settle->recompute", "holds", "%s, run here on the anchored records, gives the settlement.json bytes" % mod.replace("settle_v1_", "settle v1."), dg)
    else:
        W.put("settle->recompute", "missing", "%s, run here, does not give the settlement.json bytes" % mod.replace("settle_v1_", "settle v1."), dg)


def _answer_problem(st, day_sha, root, n):
    """a witness intake record (GET /witness/<sha>) of a furui-day answer: the answer's key_id is the key the intake checked,
    the answer's and the record's signatures verify, the commitment is the answer's day_sha256, and day_sha256, root and n
    are the day record's. None when it holds; "other" when it names another day record"""
    pub, rc = st.get("public_key_ed25519_b64"), st.get("record_canonical")
    try:
        rec = F.parse_json(rc) if isinstance(rc, str) else None
    except F._Bad:
        rec = None
    a = rec.get("answer") if isinstance(rec, dict) else None
    if not isinstance(a, dict) or a.get("schema") != "witness-answer-v0" or a.get("kind") != "furui-day":
        return "not a furui-day witness-answer-v0"
    if a.get("day_sha256") != day_sha:
        return "other"
    pk = F._b64(pub, 32)
    w, g = a.get("witness"), a.get("signature")
    if pk is None or not isinstance(w, dict) or not isinstance(g, dict) or g.get("alg") != "ed25519":
        return "no key, witness or signature object"
    kid = "ed25519:" + hashlib.sha256(pk).hexdigest()[:16]
    if w.get("key_id") != kid or g.get("key_id") != kid:
        return "key_id is not the key the intake checked"
    try:
        body = F.canonical({k: v for k, v in a.items() if k != "signature"})
    except F._Bad:
        return "the answer has no canonical form"
    sg, rs = F._b64(g.get("sig"), 64), F._b64(st.get("signature_ed25519_b64"), 64)
    if sg is None or not F.ed25519_verify(pk, ("witness-answer-v0\n" + body).encode("utf-8"), sg):
        return "the answer's signature does not verify"
    if rs is None or not F.ed25519_verify(pk, rc.encode("utf-8"), rs):
        return "the record's signature does not verify"
    if rec.get("commitment") != day_sha:
        return "the record's commitment is not the answer's day_sha256"
    if a.get("root") != root or a.get("n") != n:
        return "root or n is not the day record's"
    return None


def _witness(W, days_found):
    if not W.holds("check->day"):
        W.follow("day->witness", "check->day")
        return
    out, states = [], []
    for d, ds, root, n in days_found:
        purpose, shas = "furui-day-v0: " + d, set()
        s, pend = W.getj(LEDGER + "/witness/pending")
        for x in ((pend or {}).get("pending") or []) if s == 200 and isinstance(pend, dict) else []:
            if isinstance(x, dict) and x.get("purpose") == purpose and isinstance(x.get("sha"), str) and H64.fullmatch(x["sha"]):
                shas.add(x["sha"])
        es, _complete = W.entries(_at(d, (0, 0)))
        for (_n, _e, b, _t) in es:
            if isinstance(b, dict) and b.get("schema") == "nenrin-witness-batch-v1":
                for x in b.get("records") or []:
                    if isinstance(x, dict) and x.get("purpose") == purpose and isinstance(x.get("sha"), str) and H64.fullmatch(x["sha"]):
                        shas.add(x["sha"])
        good, bad, other = [], [], 0
        for w in sorted(shas):
            s, r = W.getj(LEDGER + "/witness/" + w)
            st = (r.get("record") if r.get("status") == "anchored" else r) if s == 200 and isinstance(r, dict) else None
            if not isinstance(st, dict) or st.get("signed") is not True or not st.get("signed_domain"):
                continue
            p = _answer_problem(st, ds, root, n)
            if p == "other":
                other += 1
            elif p:
                bad.append({"witness_record": w, "domain": st.get("signed_domain"), "why": p})
            else:
                good.append({"witness_record": w, "domain": st.get("signed_domain")})
        out.append({"day": d, "day_record_sha256": ds, "answers": good, "contradicting": bad, "naming_another_day_record": other})
        states.append("missing" if bad else ("holds" if good else "not_yet"))
    st = _worst(states)
    W.put("day->witness", st, {"holds": "a signed witness answer names each day record's sha256, root and n",
                               "not_yet": "no signed witness answer for the day record yet", "missing": "a signed answer for the day record does not verify or names another root or n"}[st],
          {"days": out})


def walk(record_sha256, get=None, now=None):
    """the walk of one admission record; -> the result dict (schema nenrin-tasuki-walk-v0). Raises NetError."""
    get = get or Fetcher()
    now = now or datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)
    W = _Walk(get, now)
    W.facts = {"record_sha256": record_sha256, "admission_sha256": None, "submitted_at": None, "admission": None}

    def done():
        for k in LINKS:
            if k not in W.links:
                W.put(k, "missing", "not walked")
        links = [W.links[k] for k in LINKS]
        verdict = _worst([x["state"] for x in links])
        return {"schema": SCHEMA, "record_sha256": record_sha256, "walked_at": _iso(now), "verdict": verdict, "links": links,
                "causes": [x["link"] for x in links if x["state"] != "holds" and x["follows"] is None],
                "facts": W.facts, "does_not_establish": list(DOES_NOT_ESTABLISH)}
    s, st = W.getj(LEDGER + "/admission/" + record_sha256)
    rc = st.get("record_canonical") if s == 200 and isinstance(st, dict) else None
    if not isinstance(rc, str) or F.sha(rc) != record_sha256:
        why = "the ledger does not serve the admission as bytes that hash to it (http %d)" % s
        for k in ("adm->check", "adm->entry", "adm->exec"):
            W.put(k, "missing", why)
        for k, p in (("check->day", "adm->check"), ("day->entry", "adm->check"), ("day->witness", "adm->check"), ("exec->result", "adm->exec"),
                     ("exec->entry", "adm->exec"), ("exec->settle", "adm->exec"), ("settle->recompute", "adm->exec"), ("entry->ots", "adm->entry")):
            W.follow(k, p)
        return done()
    A = _load("admission_verify_v0")
    try:
        rec = A.read_record(rc)
    except (ValueError, RecursionError):
        rec = None
    t = _when(st.get("submitted_at"))
    if not isinstance(rec, dict) or t is None:
        why = "the admission is not a JSON object" if not isinstance(rec, dict) else "the ledger names no submitted_at"
        for k in ("adm->check", "adm->entry", "adm->exec"):
            W.put(k, "missing", why)
        for k, p in (("check->day", "adm->check"), ("day->entry", "adm->check"), ("day->witness", "adm->check"), ("exec->result", "adm->exec"),
                     ("exec->entry", "adm->exec"), ("exec->settle", "adm->exec"), ("settle->recompute", "adm->exec"), ("entry->ots", "adm->entry")):
            W.follow(k, p)
        return done()
    adm_sha = A.admission_sha256(rec)
    rp = rec.get("relying_party") if isinstance(rec.get("relying_party"), dict) else {}
    dom, ku = rp.get("domain"), rp.get("key_url")
    pub, refused = None, None
    host = A._host(ku)
    if not (isinstance(dom, str) and host and host == dom.lower()):
        refused = "admission_refused: signer_not_on_own_domain"
    else:
        if hasattr(get, "allow"):
            get.allow(host)
        ks, kd = W.getj(ku)
        pub = kd.get("public_key_ed25519_b64") if ks == 200 and isinstance(kd, dict) else None
        if not isinstance(pub, str):
            refused = "admission_refused: the key_url answered http %d without public_key_ed25519_b64" % ks
        else:
            v = A.verify_admission(rec, pub)
            W.facts["admission"] = {"verdict": v["verdict"], "refusals": v["refusals"], "key_url": ku}
            if v["verdict"] != "accepted":
                refused = "admission_refused: " + ",".join(v["refusals"])
    rep = st.get("report") if isinstance(st.get("report"), dict) else {}
    W.facts.update(admission_sha256=adm_sha, submitted_at=_iso(t), decision=rec.get("decision"),
                   rules_version=(rec.get("rules") or {}).get("version") if isinstance(rec.get("rules"), dict) else None,
                   ledger_admission_sha256=rep.get("admission_sha256"))
    days_found, entries = _furui(W, rec, t, refused)
    entries += _adm_entry(W, record_sha256, st, refused)
    d, r, call, xs, _ex = _exec(W, record_sha256, rec, adm_sha, t, refused)
    entries += _exec_entry(W, xs, t)
    if W.holds("adm->exec"):
        _settle(W, d, r, call, xs, adm_sha, dom, pub)
    else:
        W.follow("exec->settle", "adm->exec")
        W.follow("settle->recompute", "exec->settle")
    if entries:
        ss = [x[1] for x in entries]
        st2 = _worst(ss)
        W.put("entry->ots", st2, {"holds": "every ledger entry found carries an OpenTimestamps proof of its claim to a Bitcoin block",
                                  "not_yet": "a ledger entry found is not confirmed in Bitcoin yet",
                                  "missing": "a ledger entry's proof does not commit its claim to the named block"}[st2],
              {"entries": [dict(f, state=s2, code=code) for (_n, s2, code, f) in entries]})
    else:
        first = next((k for k in ("day->entry", "adm->entry", "exec->entry") if not W.holds(k)), "adm->entry")
        W.follow("entry->ots", first)
    _witness(W, days_found)
    return done()


EXIT = {"holds": 0, "missing": 1, "not_yet": 3}
USAGE = "usage: nenrin-verify tasuki <record_sha256> [--now YYYY-MM-DDTHH:MM:SSZ]"


def main(argv):
    argv = list(argv)
    now = None
    if argv[1:].count("--now") == 1:
        i = argv.index("--now")
        now = _when(argv[i + 1]) if i + 1 < len(argv) else None
        if now is None:
            print(USAGE, file=sys.stderr)
            return 2
        del argv[i:i + 2]
    if len(argv) != 2 or argv[0] != "tasuki" or not H64.fullmatch(argv[1]):
        print(USAGE, file=sys.stderr)
        return 2
    try:
        res = walk(argv[1], now=now)
    except F.NetError as e:
        print("nenrin-verify: network: %s" % e, file=sys.stderr)
        return 2
    F._Utf8Out().write(json.dumps(res, ensure_ascii=False, sort_keys=True, indent=2) + "\n")
    return EXIT[res["verdict"]]
