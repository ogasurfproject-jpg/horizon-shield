#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SEKI heartbeat: the first door works every day, whether or not anyone else calls it, and every day is settled.

The door (hs-seki-door) stands in front of HORIZON SHIELD's own paid tool, hs-gateway /report, for the store
hs-seki-demo, under the demonstration contract musubi-v0/run0003/contract.json. Principal, agent and door are all
The HORIZONs Co., Ltd., and the contract says so. A door that is only exercised on the day it was built proves little,
so once a day this file does two things, and the scheduled workflow .github/workflows/seki-heartbeat.yml commits what
they wrote under runs/<day>/, the UTC day the run is for (see responsible_day):

  run      The agent makes the same three calls as run0003, each with a fresh nonce:
             report   20 tickets, the limit is 20      must be admitted, run, and filed as an execution record
             audit    30 tickets, the limit is 25      must be refused amount_over_limit, nothing spent
             compare  50 tickets, prohibited           must be refused prohibited_action, nothing spent
           Every record the door signs is checked here under the key keys/seki-door.json publishes and must be on
           the ledger. Anything other than the expected answer is a failure (exit 1), so a broken door shows up as a
           failed run, not as a quiet gap.
  settle   Every earlier day whose records the ledger has batched and Bitcoin has confirmed is settled with
           settle v1.15 (and v1.12, which must agree on the verdict). The anchors are composed with anchor_compose
           from the ledger's own batch bytes and .ots proofs; the header view comes from two explorers, extended
           from final headers kept in view-chunks/ (written once, never rewritten) and checked again in full every time. Days not yet confirmed are left for a
           later run. settlement.json and the anchored records are written next to the day's records.

Only the agent's key is used here (SEKI_AGENT_SEED_B64, the 32 byte Ed25519 seed in base64, from the repository's
Actions secrets) with the store's gateway token (HSG_STORE_TOKEN). The agent can do nothing the contract does not
allow and the tickets of the pilot carry no monetary value. The door's key never leaves Cloudflare and is not here.

  python3 heartbeat.py run    [--root runs] [--date YYYY-MM-DD]
  python3 heartbeat.py gaps   [--root runs] [--through YYYY-MM-DD] [--days 7] [--json out.json]
  python3 heartbeat.py settle [--root runs] [--view-chunks view-chunks]
  python3 heartbeat.py --selftest
"""
import argparse, base64, datetime, hashlib, json, os, secrets, sys, tempfile, time, urllib.error, urllib.request

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
from contract_v0 import canonical, contract_sha256, parse_strict  # noqa: E402

CONTRACT_PATH = os.path.join(MUSUBI, "run0003", "contract.json")
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
          ("audit", 30, "refuse", ["amount_over_limit"], 403),
          ("compare", 50, "refuse", ["prohibited_action"], 403)]
PAYLOAD = {
    "report": {"koji_type": "gaiheki_30tsubo", "teiji_kingaku": 1200000},
    "audit": {"note": "SEKI heartbeat: the door refuses this call before the payload is read"},
    "compare": {"note": "SEKI heartbeat: the door refuses this call before the payload is read"},
}
UA = "seki-heartbeat/1 (+https://github.com/ogasurfproject-jpg/horizon-shield)"
# 2026-10-19: locate() used to look at the newest 40 entries only. Once the ledger head passed 120, the batch holding
# 2026-10-10's admissions (entry 80) fell out of reach and that day could never settle, although it had settled in a
# dry run hours before. A day is now looked for down to entry 1; entries are fetched once per settle run and shared by
# every day (the ledger had about 120 entries on that day).


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
        return 0 if prev.get("result") == "as expected" else 1
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
    os.makedirs(out, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="seki-heartbeat-")
    pem = os.path.join(tmp, "agent.pem")
    fd = os.open(pem, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    try:
        record = {"schema": "seki-heartbeat-run-v0", "note": DISCLOSURE, "date": date, "day_rule": DAY_RULE, "contract_sha256": csha, "store": STORE,
                  "target": TARGET, "door_public_key_ed25519_b64": door_pub, "gateway": GATEWAY, "balance_before": bal,
                  "ran_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "calls": []}
        st, _h, b = http("POST", AGREEMENT + "/contract", ctext.encode("utf-8"), {"content-type": "application/json"})
        j = jl(b) or {}
        check("the contract is on file at the agreement intake", st in (200, 201, 409) and (j.get("verdict") == "accepted" or j.get("dedup") is True), (st, b[:300]))
        tip = tip_height()
        expiry = tip + 18
        record["tip_height_at_request"] = tip
        for service, price, want_decision, want_reasons, want_status in EXPECT:
            nonce = secrets.token_hex(16)
            req = A.build_action_request(contract, service, nonce, expiry, key, target=TARGET, amount=price)
            body = dict(PAYLOAD[service], seki={"action_request": req, "presentation": [{"adapter": "musubi-native", "material": {"contract": contract}}]})
            st, hd, rb = http("POST", "%s/report?store=%s&service=%s" % (GATEWAY, STORE, service), json.dumps(body),
                              {"content-type": "application/json", "x-store-token": token})
            hl = {k.lower(): v for k, v in hd.items()}
            call = {"service": service, "tickets": price, "request_sha256": hashlib.sha256(canonical(req).encode()).hexdigest(), "nonce": nonce,
                    "status": st, "decision": hl.get("x-seki-decision"), "admission_sha256": hl.get("x-seki-admission-sha256"),
                    "record_sha256": hl.get("x-seki-record-sha256"), "published": hl.get("x-seki-published"), "tickets_spent": hl.get("x-tickets-spent")}
            with open(os.path.join(out, "request_%s.json" % service), "w", encoding="utf-8") as f:
                f.write(canonical(req))
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
                gst, _, gb = http("GET", "%s/seki/record/%s" % (GATEWAY, rs))
                check("%s: the door serves the record by its sha256" % service, gst == 200 and hashlib.sha256(gb).hexdigest() == rs, gst)
                rec = parse_strict(gb.decode("utf-8"))
                v = A.verify_admission(rec, door_pub, contract)
                check("%s: the record verifies under the door's published key" % service, v.get("verdict") == "accepted", v)
                check("%s: decision %s, reasons %s" % (service, want_decision, want_reasons), rec.get("decision") == want_decision and rec.get("reasons") == want_reasons, (rec.get("decision"), rec.get("reasons")))
                with open(os.path.join(out, "admission_%s.json" % service), "w", encoding="utf-8") as f:
                    f.write(gb.decode("utf-8"))
                lst = None
                for _ in range(6):
                    lst, _, _ = http("GET", "%s/admission/%s" % (LEDGER, rs))
                    if lst == 200:
                        break
                    time.sleep(5)
                check("%s: the ledger holds the record" % service, lst == 200, lst)
                call["ledger_url"] = LEDGER + "/admission/" + rs
            if st == 200 and rec is not None:
                e = peer_kit.make_exec(contract, pem, [service], call["report_sha256"], admitted=[(req, rec)])
                etext = canonical(e)
                est, _, eb = http("POST", AGREEMENT + "/execution", etext.encode("utf-8"), {"content-type": "application/json"})
                ej = jl(eb) or {}
                check("%s: the execution record naming the admission is filed" % service, est in (201, 409) and (ej.get("verdict") == "accepted" or ej.get("dedup") is True), (est, eb[:300]))
                with open(os.path.join(out, "execution_%s.json" % service), "w", encoding="utf-8") as f:
                    f.write(etext)
                call["execution_sha256"] = hashlib.sha256(etext.encode("utf-8")).hexdigest()
                call["execution_url"] = AGREEMENT + "/execution/" + call["execution_sha256"]
            record["calls"].append(call)
        record["result"] = "as expected" if not fails else "NOT as expected: " + "; ".join(fails)
        with open(os.path.join(out, "RUN.json"), "w", encoding="utf-8") as f:
            f.write(json.dumps(record, indent=2, ensure_ascii=False) + "\n")
    finally:
        if os.path.exists(pem):
            os.unlink(pem)
        os.rmdir(tmp)
    print(("\nHEARTBEAT %s: report admitted and executed, audit and compare refused, nothing spent on the refusals" % date)
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


def settle_day(day_dir, contract, chunk_dir, get=None, cache=None):
    get = get or (lambda u: http("GET", u))
    runp = os.path.join(day_dir, "RUN.json")
    if not os.path.exists(runp) or os.path.exists(os.path.join(day_dir, "settlement.json")):
        return "skip"
    r = json.load(open(runp, encoding="utf-8"))
    if r.get("result") != "as expected":
        return "skip (the run itself failed; nothing to settle)"
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
    s = s15.settle_v1_15(contract, events, view, admissions=admissions, relying_keys=keys)
    s_12 = s12.settle_v1_12(contract, events, view, admissions=admissions, relying_keys=keys)
    if s.get("verdict") != s_12.get("verdict"):
        raise RuntimeError("settle v1.15 says %s and v1.12 says %s for %s" % (s.get("verdict"), s_12.get("verdict"), day_dir))
    tip = view["headers"][-1]["height"]
    with open(os.path.join(day_dir, "settlement.json"), "w", encoding="utf-8") as f:
        f.write(canonical(s))
    with open(os.path.join(day_dir, "SETTLED.json"), "w", encoding="utf-8") as f:
        f.write(json.dumps({"schema": "seki-heartbeat-settled-v0", "settle": "v1.15 (v1.12 agrees on the verdict)", "verdict": s.get("verdict"),
                            "status": s.get("status"), "view": {"from": view["headers"][0]["height"], "to": tip},
                            "ledger_entries": entries, "settlement_sha256": hashlib.sha256(canonical(s).encode()).hexdigest(),
                            "recompute": "anchor_compose.py for each record against its ledger entry (?format=raw and /ots), "
                                         "header_view_fetch.py --to %d (from runs/<date>/, the tools are in ../../../musubi-v0), then settle_v1_15.py --settle ../../../musubi-v0/run0003/contract.json "
                                         "--event execution_report.anchored.json --admission admission_*.anchored.json "
                                         "--relying-key %s=<keys/seki-door.json> --view view.json" % (tip, DOOR_DOMAIN)},
                           indent=2) + "\n")
    return "settled: %s %s" % (s.get("verdict"), s.get("status"))


def settle(root, chunk_dir):
    contract = rd(CONTRACT_PATH)
    days = sorted(d for d in os.listdir(root) if len(d) == 10 and os.path.isdir(os.path.join(root, d))) if os.path.isdir(root) else []
    bad = 0
    now = datetime.datetime.now(datetime.timezone.utc)
    cache = {}
    for d in days:
        try:
            msg = settle_day(os.path.join(root, d), contract, chunk_dir, cache=cache)
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
        calls = {c["service"]: c for c in r.get("calls", [])}
        sp = os.path.join(root, d, "SETTLED.json")
        sv = json.load(open(sp, encoding="utf-8")) if os.path.exists(sp) else None
        cell = lambda s: "%s %s" % ((calls.get(s) or {}).get("decision") or "?", ((calls.get(s) or {}).get("record_sha256") or "")[:8])
        rows.append("| %s | %s | %s | %s | %s |" % (d, cell("report"), cell("audit"), cell("compare"),
                                                    ("%s, %s" % (sv["verdict"], sv["status"])) if sv else "waiting for Bitcoin"))
    text = ("# SEKI heartbeat\n\nOnce a day the agent calls HORIZON SHIELD's own paid tool through the SEKI door under the demonstration "
            "contract (../../musubi-v0/run0003/contract.json): a report inside its limit, an audit over its limit, a comparison "
            "the contract prohibits. The door must admit the first and refuse the other two, and every answer is a signed record "
            "on the public ledger. Once the ledger's batch is confirmed in Bitcoin the day is settled with settle v1.15. "
            "Principal, agent and door are all The HORIZONs Co., Ltd.; it is a demonstration, not an outside customer, and the "
            "pilot's tickets carry no monetary value. heartbeat.py and the workflow seki-heartbeat.yml write this folder. "
            "Every deviation is explained in ../README.md, and a final verdict is never rewritten.\n\n"
            "| day (UTC) | report (limit 20) | audit 30 (limit 25) | compare (prohibited) | settlement |\n|---|---|---|---|---|\n"
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
