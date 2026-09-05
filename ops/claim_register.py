#!/usr/bin/env python3
"""
claim_register.py: every number and sentence HORIZON SHIELD states in public, next to the command
that checks it against the live thing. Run weekly from the Mac (the gate and ledger must be reachable):

    python3 ops/claim_register.py            # prints the report, writes ops/claim_register_report.md
    python3 ops/claim_register.py --offline  # local checks only (source vs source, anchored bytes)

Why: on 2026-09-05 four public statements were found stale in one day (npm README, CI, two /spec
sentences), then two more (the history cap of 30, "daily batches" with no schedule). A claim that
nobody re-measures drifts. Every row here is a claim someone can read, and a check a machine runs.
A FAIL is information, not an emergency: it says the public text and the measurement disagree today.
"""

import io, json, os, re, subprocess, sys, time, urllib.request, glob, hashlib
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GATE = "https://gate.horizonshield.dev"
LEDGER = "https://ledger.horizonshield.dev"
RAW_REG = "https://raw.githubusercontent.com/ogasurfproject-jpg/mcp-conduct-register/main/"
OFFLINE = "--offline" in sys.argv
UA = "hs-claim-register/1.0 (+https://shield.the-horizons-innovation.com)"
R = []


def now():
    return datetime.now(timezone.utc)


def rd(rel):
    return io.open(os.path.join(ROOT, rel), encoding="utf-8").read()


def sha_file(path):
    return hashlib.sha256(io.open(path, "rb").read()).hexdigest()


def get(url, as_json=True):
    sep = "&" if "?" in url else "?"
    req = urllib.request.Request(url + sep + "cb=" + str(int(time.time())), headers={"user-agent": UA})
    with urllib.request.urlopen(req, timeout=40) as r:
        b = r.read().decode("utf-8")
    return json.loads(b) if as_json else b


def run(cmd, cwd):
    p = subprocess.run(cmd, cwd=os.path.join(ROOT, cwd), capture_output=True, text=True, timeout=300)
    return (p.stdout or "") + (p.stderr or "")


def passed_total(out):
    m = re.findall(r"(\d+)\s*/\s*(\d+)\s*合格", out)
    return (int(m[-1][0]), int(m[-1][1])) if m else (None, None)


def claim(cid, stated_in, text, fn, network=True):
    if network and OFFLINE:
        R.append((cid, "SKIP", stated_in, text, "offline"))
        return
    try:
        ok, detail = fn()
        R.append((cid, "PASS" if ok else "FAIL", stated_in, text, detail))
    except Exception as e:
        R.append((cid, "FAIL", stated_in, text, "check could not run: %s" % e))


# ---------------------------------------------------------------- the register

def c_gate_version():
    src = re.search(r'version:\s*"([\d.]+)"', rd("workers/hs-verify-gate/src/worker.js")).group(1)
    live = get(GATE + "/spec")["version"]
    return src == live, "source %s, live %s" % (src, live)

def c_history_cap():
    src = int(re.search(r"const HISTORY_MAX = (\d+)", rd("workers/hs-verify-gate/src/worker.js")).group(1))
    h = get(GATE + "/history?endpoint=https://mcp.horizonshield.dev/mcp")
    live = (h.get("retention") or {}).get("kept_max")
    return src == live, "source %s, live %s (absent means the deployed gate predates 0.3.1)" % (src, live)

def c_gate_redteam():
    spec = get(GATE + "/spec")
    txt = json.dumps(spec, ensure_ascii=False)
    stated = re.findall(r"scores (\d+) of (\d+)", txt)
    n = int(stated[-1][1]) if stated else None
    p, t = passed_total(run(["node", "test/redteam_gate.mjs"], "workers/hs-verify-gate"))
    return (n == t and p == t), "/spec says %s, test/redteam_gate.mjs has %s (passed %s)" % (n, t, p)

def c_instant_redteams():
    spec = get(GATE + "/spec")
    txt = json.dumps(spec.get("instant_coordinate") or {}, ensure_ascii=False)
    js = re.search(r"redteam_instant\.mjs, (\d+) vectors", txt)
    py = re.search(r"instant_redteam\.py, (\d+) vectors", txt)
    pj, tj = passed_total(run(["node", "test/redteam_instant.mjs"], "workers/hs-verify-gate"))
    pp, tp = passed_total(run(["python3", "instant_redteam.py"], "workers/hs-ledger/nenrin/coordinate-v1"))
    ok = js and py and int(js.group(1)) == tj == pj and int(py.group(1)) == tp == pp
    return bool(ok), "/spec says js %s py %s; measured js %s/%s py %s/%s" % (
        js and js.group(1), py and py.group(1), pj, tj, pp, tp)

def c_ring_redteam():
    m = re.search(r"(\d+) vectors:", rd("workers/hs-ledger/nenrin/ring-v1/README.md"))
    p, t = passed_total(run(["python3", "ring_redteam.py"], "workers/hs-ledger/nenrin/ring-v1"))
    return bool(m) and int(m.group(1)) == t == p, "README says %s, measured %s/%s" % (m and m.group(1), p, t)

def c_witness_schedule():
    cron = re.search(r'"crons":\s*\["([^"]+)"\]', rd("workers/hs-ledger/wrangler.jsonc"))
    live = json.dumps(get(LEDGER + "/witness"), ensure_ascii=False)
    hhmm = None
    if cron:
        mnt, hr = cron.group(1).split()[:2]
        hhmm = "%02d:%02d UTC" % (int(hr), int(mnt))
    return bool(hhmm) and hhmm in live, "wrangler cron %s, live text mentions %s: %s" % (
        cron and cron.group(1), hhmm, bool(hhmm) and hhmm in live)

def c_witness_pool_age():
    d = get(LEDGER + "/witness/pending")
    old = []
    for s in d.get("pending") or []:
        at = s.get("submitted_at")
        if at:
            age_h = (now() - datetime.fromisoformat(at.replace("Z", "+00:00"))).total_seconds() / 3600
            if age_h > 48:
                old.append("%s... %.0fh" % (s.get("sha", "")[:8], age_h))
    return not old, "pending %d; older than 48h: %s" % (d.get("count", 0), ", ".join(old) or "none")

def c_stamp_lag():
    d = get(LEDGER + "/ledger")
    late = [("#%s %sh" % (e["n"], e.get("pending_hours"))) for e in d.get("entries") or []
            if e.get("ots_status") != "confirmed" and (e.get("pending_hours") or 0) > 24 * 7]
    return not late, "unconfirmed older than 7 days: %s" % (", ".join(late) or "none")

def c_anchored_bytes():
    """Every markdown/sha256 seed we ever appended must still exist locally byte-identical, and be in the ledger."""
    ledger = {e["claim_sha256"]: e["n"] for e in get(LEDGER + "/ledger").get("entries") or []}
    local = {}
    # Anchored documents live under workers/hs-ledger (nenrin/, path/, the root .md files); the bytes of every
    # appended record are also kept as claim_N.txt beside their .ots, in workers/hs-ledger and ~/jidec.
    pats = [os.path.join(ROOT, p) for p in ("workers/hs-ledger/**/*.md", "workers/hs-ledger/**/*.sha256", "workers/hs-ledger/claim_*.txt")]
    pats.append(os.path.join(os.path.expanduser("~/jidec"), "claim_*.txt"))
    for pat in pats:
        for f in glob.glob(pat, recursive=True):
            local[sha_file(f)] = os.path.relpath(f, ROOT)
    bad, n = [], 0
    for sf in sorted(glob.glob(os.path.join(ROOT, "workers/hs-ledger/seed_entry_*.json"))):
        d = json.load(io.open(sf, encoding="utf-8"))
        rc = d.get("record_canonical") or ""
        if not rc or rc.lstrip().startswith("{"):
            continue  # path records and JSON seeds: not files
        n += 1
        c = d.get("claim_sha256")
        if c not in local:
            bad.append("%s: anchored bytes %s... no longer exist locally (edited after anchoring?)" % (os.path.basename(sf), (c or "")[:8]))
        if c not in ledger:
            bad.append("%s: seed exists but is not in the ledger (never appended?)" % os.path.basename(sf))
    return not bad, "%d document seeds checked; %s" % (n, "; ".join(bad) or "all present locally and in the ledger")

def c_register_fresh():
    txt = get(RAW_REG + "README.md", as_json=False)
    m = re.search(r"Generated from <[^>]+> at (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) UTC", txt)
    if not m:
        return False, "no generated-at line"
    t = datetime.strptime(m.group(1), "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
    age = (now() - t).total_seconds() / 3600
    return age <= 48, "generated %s UTC, %.0fh ago (claim: rebuilt daily)" % (m.group(1), age)

def c_register_rows():
    reg = json.loads(get(RAW_REG + "register.json", as_json=False))
    live = get(GATE + "/register")
    live_eps = set(r.get("endpoint") for r in (live.get("rows") or []))
    missing = [r["endpoint"] for r in reg.get("rows") or [] if r.get("endpoint") not in live_eps]
    return not missing, "register.json %d rows, live %d; in snapshot but not live: %s" % (
        len(reg.get("rows") or []), len(live_eps), ", ".join(missing) or "none")

def c_ring_month():
    t = now()
    y, m = (t.year, t.month - 1) if t.month > 1 else (t.year - 1, 12)
    closed = "%04d-%02d" % (y, m)
    if t.day < 5:
        return True, "before the 5th; ring for %s not yet due" % closed
    local = os.path.exists(os.path.join(ROOT, "workers/hs-ledger/nenrin/ring-v1/rings/%s.sha256" % closed))
    try:
        get(RAW_REG + "rings/%s.sha256" % closed, as_json=False); pub = True
    except Exception:
        pub = False
    return local and pub, "ring %s: local %s, published in mcp-conduct-register %s" % (closed, local, pub)

def c_archive_fresh():
    d = json.loads(get(RAW_REG + "history/mcp-horizonshield-dev-mcp.json", as_json=False))
    at = (d.get("archive") or {}).get("last_fetch_at")
    if not at:
        return False, "archive block absent (the daily archive job has not run yet)"
    age = (now() - datetime.fromisoformat(at.replace("Z", "+00:00"))).total_seconds() / 3600
    return age <= 48, "last archive fetch %s, %.0fh ago (claim: daily)" % (at, age)


def c_no_starvation():
    """0.3.1 orders the sweep least-recently-measured first, after a day in which the eight daily self rows
    could consume every slot forever. Any row unmeasured for 14 days (or never) is a starvation signal."""
    live = get(GATE + "/register")
    late = []
    for r in live.get("rows") or []:
        if r.get("owner_declined"):
            continue
        at = (r.get("latest") or {}).get("at")
        if not at:
            late.append("%s: never measured" % r.get("endpoint"))
            continue
        age_d = (now() - datetime.fromisoformat(at.replace("Z", "+00:00"))).total_seconds() / 86400
        if age_d > 14:
            late.append("%s: %.0f days" % (r.get("endpoint"), age_d))
    return not late, "rows unmeasured for 14 days or never (declined rows excluded): %s" % (", ".join(late) or "none")


def c_beacons():
    """Every beacon the gate wrote into a derived verdict must match the locally validated headers, and the salt must
    predate the block. BEYOND_TIP is a stale local file, not a finding: sync headers (sync_headers.py) and rerun."""
    out = run(["python3", "verify_beacons.py", "--history", os.path.join(ROOT, "workers/hs-ledger/nenrin/ring-v1/history/*.json")],
              "workers/hs-ledger/nenrin/coordinate-v1")
    last = [l for l in out.strip().splitlines() if l.strip()][-1] if out.strip() else "no output"
    falsified = re.search(r"(\d+) falsified", out)
    beyond = out.count("BEYOND_TIP")
    ok = (falsified is None or falsified.group(1) == "0") and "REFUSED" not in out
    return ok, "%s%s" % (last, ("; %d beacon(s) beyond the local tip, sync headers" % beyond) if beyond else "")


def c_registry_version():
    """Three places state the gate's version: the source (CONFIG.version), server.json (what gets published), and the
    official MCP registry (what the world reads). On 2026-09-05 they read 0.3.1 / 0.2.4 / 0.2.2. Publishing is a
    manual workflow_dispatch, so this row is the reminder."""
    src = re.search(r'version:\s*"([\d.]+)"', rd("workers/hs-verify-gate/src/worker.js")).group(1)
    sj = json.loads(rd("workers/hs-verify-gate/server.json")).get("version")
    reg = get("https://registry.modelcontextprotocol.io/v0/servers?search=ogasurfproject-jpg/hs-verify-gate&version=latest")
    items = reg.get("servers") or reg.get("items") or []
    live = None
    for it in items:
        srv = it.get("server") or it
        if (srv.get("name") or "") == "io.github.ogasurfproject-jpg/hs-verify-gate":
            live = srv.get("version")
    ok = src == sj == live
    return ok, "source %s, server.json %s, registry %s%s" % (src, sj, live, "" if ok else " (publish: Actions, MCP registry publish, server_dir workers/hs-verify-gate)")


claim("C01", "gate /spec version", "the deployed gate is the committed source", c_gate_version)
claim("C02", "gate /history retention", "the gate keeps HISTORY_MAX records per endpoint and says so", c_history_cap)
claim("C03", "gate /spec red_team", "red team scores N of N, and N is what the test file holds", c_gate_redteam)
claim("C04", "gate /spec instant_coordinate.red_team", "26 js and 17 py vectors, all green", c_instant_redteams)
claim("C05", "ring-v1 README", "N red team vectors, all green", c_ring_redteam, network=False)
claim("C06", "ledger GET /witness", "the pool is bundled daily at the hour the cron says", c_witness_schedule)
claim("C07", "ledger /witness/pending", "no submission waits more than 48h", c_witness_pool_age)
claim("C08", "ledger /ledger", "every entry is Bitcoin-confirmed within 7 days", c_stamp_lag)
claim("C09", "every anchored document", "anchored bytes are never edited, and every seed was appended", c_anchored_bytes)
claim("C10", "mcp-conduct-register README", "rebuilt daily from the public API", c_register_fresh)
claim("C11", "mcp-conduct-register register.json", "every snapshot row is a live register row", c_register_rows)
claim("C12", "ring-v1 README, register README", "one ring per endpoint per month, made by the 5th, published", c_ring_month)
claim("C13", "mcp-conduct-register history/", "archived daily, append-only", c_archive_fresh)
claim("C14", "gate /register, /watchlist", "every watched row is measured on its cadence; nothing starves behind the self rows", c_no_starvation)
claim("C16", "MCP registry, server.json, source", "the published version of the gate is the deployed version", c_registry_version)
claim("C15", "gate /spec instant_coordinate, every derived verdict", "the recorded beacon is the chain's block at that height and the salt predates it", c_beacons, network=False)

# ---------------------------------------------------------------- report
lines = ["# claim register report %s" % now().strftime("%Y-%m-%d %H:%M UTC"), ""]
lines.append("| id | result | stated in | claim | measured |")
lines.append("|---|---|---|---|---|")
for cid, res, where, text, detail in R:
    lines.append("| %s | %s | %s | %s | %s |" % (cid, res, where, text, str(detail).replace("|", "/")))
fails = sum(1 for r in R if r[1] == "FAIL")
skips = sum(1 for r in R if r[1] == "SKIP")
lines += ["", "%d claims, %d FAIL, %d skipped. A FAIL means the public text and the measurement disagree today." % (len(R), fails, skips)]
rep = "\n".join(lines) + "\n"
print(rep)
if not OFFLINE:
    io.open(os.path.join(ROOT, "ops/claim_register_report.md"), "w", encoding="utf-8").write(rep)
sys.exit(1 if fails else 0)
