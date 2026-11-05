#!/usr/bin/env python3
"""
JIDEC auto-stamper — run by GitHub Actions on a cron.
Pulls pending ledger entries, OpenTimestamps-stamps them (Bitcoin), and pushes
the .ots proofs back. Idempotent: safe to run every hour.

Flow per entry:
  unstamped -> `ots stamp` -> store .ots as status "pending"
  pending   -> `ots upgrade` -> if a Bitcoin attestation is present, store as "confirmed"
Env:
  LEDGER_URL          e.g. https://hs-ledger.oga-surf-project.workers.dev
  LEDGER_ADMIN_TOKEN  the ledger admin token (GitHub repo secret)

2026-09-18: error handling hardened (logic unchanged). api() now surfaces the HTTP
status and body on failure, and one bad entry no longer aborts the whole batch; the
job still exits non-zero (fail-closed) if the pending fetch fails or any entry errors,
so a real problem stays red in CI and the log names the exact cause.

2026-10-12: a proof can carry more than one Bitcoin attestation (one per calendar that
got it into a block). The entry now records the earliest block, not whichever one
`ots info` happens to print first: entry 86's .ots carries 971024 and 971047 and was
recorded as 971047. The earliest attestation is the tightest bound on when the bytes
existed, and it is what invinoveritas's slot-log index and our checkers name.

2026-10-19: a stamp that makes no progress is red. Before this, a calendar that never
returned an .ots, or an entry that never reached a Bitcoin block, left every run green
while the entry stayed unstamped or pending for good. Now the run fails when an entry it
could not move is unstamped for more than UNSTAMPED_HOURS after it was created, or
pending for more than PENDING_HOURS after it was stamped (created, if no stamp time).

2026-11-05: the pending fetch is tried up to three times, 10 and 30 seconds apart, but
only when the ledger did not answer in time or answered 5xx. The 19:17 UTC run of
2026-11-04 failed on one read timeout and the entries waited an hour for the next run.
Any other failure (4xx, a refused connection, a name that does not resolve, a body that
is not JSON) still stops the run at once, and three timeouts in a row are still red.
"""
import os, re, sys, json, time, socket, base64, subprocess, urllib.request, urllib.error, datetime

_op = urllib.request.build_opener()
_op.addheaders = [("User-Agent", "hs-ledger-stamper/1.0 (+github-actions)")]
urllib.request.install_opener(_op)


def _need(name):
    v = os.environ.get(name)
    if not v or not v.strip():
        sys.stderr.write("missing required env %s (set it in the workflow or repo secrets)\n" % name)
        sys.exit(2)
    return v.strip()


LEDGER_URL = _need("LEDGER_URL").rstrip("/")
TOKEN = _need("LEDGER_ADMIN_TOKEN")


class ApiError(RuntimeError):
    """A ledger call that failed. retryable is True only for a timeout or an HTTP 5xx."""

    def __init__(self, msg, code=None, retryable=False):
        super().__init__(msg)
        self.code = code
        self.retryable = retryable


def api(path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(LEDGER_URL + path, data=data, method=method)
    req.add_header("X-Ledger-Key", TOKEN)
    if data:
        req.add_header("content-type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as ex:
        detail = ""
        try:
            detail = ex.read().decode("utf-8", "replace")[:300]
        except Exception:
            pass
        raise ApiError("%s %s -> HTTP %s %s" % (method, path, ex.code, detail), ex.code, 500 <= ex.code <= 599)
    except urllib.error.URLError as ex:
        raise ApiError("%s %s -> network error: %s" % (method, path, ex.reason), None, isinstance(ex.reason, (TimeoutError, socket.timeout)))
    except (TimeoutError, socket.timeout) as ex:
        raise ApiError("%s %s -> %s" % (method, path, ex or "timed out"), None, True)


PENDING_WAITS = (10, 30)


def fetch_pending(get=None, sleep=time.sleep, waits=PENDING_WAITS):
    """GET /ledger/pending; on a timeout or a 5xx, wait and try again (len(waits) + 1 tries in all)."""
    get = get or api
    tries = len(waits) + 1
    for i in range(tries):
        try:
            return get("/ledger/pending").get("pending", [])
        except ApiError as ex:
            if not ex.retryable or i == tries - 1:
                raise
            print(f"pending fetch {i + 1}/{tries} failed ({ex}); trying again in {waits[i]} s")
            sleep(waits[i])


def earliest_bitcoin_height(info):
    """The lowest block height among the BitcoinBlockHeaderAttestation lines of `ots info`, or None."""
    heights = [int(h) for h in re.findall(r"BitcoinBlockHeaderAttestation\((\d+)\)", info or "")]
    return min(heights) if heights else None


UNSTAMPED_HOURS = 6
PENDING_HOURS = 48


def _ts(v):
    try:
        return datetime.datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except Exception:
        return None


def stalled(entries, moved, now):
    """Entries this run could not move that have waited too long: [(n, status, hours)]."""
    out = []
    for e in entries:
        if not isinstance(e, dict) or e.get("n") in moved:
            continue
        st = e.get("ots_status")
        if st == "unstamped":
            t, lim = _ts(e.get("created_at")), UNSTAMPED_HOURS
        elif st == "pending":
            t, lim = _ts(e.get("stamped_at")) or _ts(e.get("created_at")), PENDING_HOURS
        else:
            continue
        if t is None:
            continue
        if t.tzinfo is None:
            t = t.replace(tzinfo=datetime.timezone.utc)
        hours = (now - t).total_seconds() / 3600
        if hours > lim:
            out.append((e.get("n"), st, round(hours, 1)))
    return out


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def block_time(height):
    try:
        h = urllib.request.urlopen(f"https://blockstream.info/api/block-height/{height}", timeout=30).read().decode().strip()
        meta = json.loads(urllib.request.urlopen(f"https://blockstream.info/api/block/{h}", timeout=30).read().decode())
        return datetime.datetime.utcfromtimestamp(meta["timestamp"]).strftime("%Y-%m-%d %H:%M UTC")
    except Exception:
        return None


def stamp_one(e):
    """Process one pending entry. Returns 1 if it changed the entry, else 0. Raises on hard error."""
    n = e["n"]
    fn = f"claim_{n}.txt"
    ots = fn + ".ots"
    with open(fn, "w", encoding="utf-8", newline="") as f:
        f.write(e["record_canonical"])  # exact bytes -> sha256 == claim_sha256

    if e["ots_status"] == "unstamped":
        if os.path.exists(ots):
            os.remove(ots)
        r = run(["ots", "stamp", fn])
        print(f"[{n}] stamp rc={r.returncode} {r.stderr.strip()[:160]}")
        if os.path.exists(ots):
            b64 = base64.b64encode(open(ots, "rb").read()).decode()
            api(f"/ledger/{n}/ots", "POST", {"ots_base64": b64, "status": "pending"})
            print(f"[{n}] -> stored PENDING (submitted to calendars)")
            return 1
        print(f"[{n}] stamp produced no .ots — will retry next run")
        return 0

    # pending -> pull current .ots, try to upgrade to a Bitcoin attestation
    try:
        raw = urllib.request.urlopen(f"{LEDGER_URL}/ledger/{n}/ots", timeout=30).read()
        open(ots, "wb").write(raw)
    except Exception as ex:
        print(f"[{n}] could not fetch existing .ots: {ex}")
        return 0
    up = run(["ots", "upgrade", ots])
    print(f"[{n}] upgrade rc={up.returncode} {(up.stderr or up.stdout).strip()[:160]}")
    info = run(["ots", "info", ots]).stdout
    height = earliest_bitcoin_height(info)
    if height is not None:
        b64 = base64.b64encode(open(ots, "rb").read()).decode()
        api(f"/ledger/{n}/ots", "POST", {"ots_base64": b64, "status": "confirmed", "bitcoin_block": height, "block_time": block_time(height)})
        print(f"[{n}] -> CONFIRMED at Bitcoin block {height}")
        return 1
    print(f"[{n}] still pending — no Bitcoin attestation yet (normal for the first ~1-2h)")
    return 0


def main():
    try:
        pending = fetch_pending()
    except Exception as ex:
        sys.stderr.write(f"cannot fetch pending entries: {ex}\n")
        sys.exit(1)
    print(f"pending entries: {len(pending)}")
    changed = 0
    errors = []
    moved = set()
    for e in pending:
        n = e.get("n") if isinstance(e, dict) else None
        try:
            c = stamp_one(e)
            changed += c
            if c:
                moved.add(n)
        except Exception as ex:
            errors.append(n)
            print(f"[{n}] ERROR: {ex}")
    print(f"done. updated {changed} entr{'y' if changed==1 else 'ies'}; {len(errors)} error(s).")
    late = stalled(pending, moved | set(errors), datetime.datetime.now(datetime.timezone.utc))
    for n, st, h in late:
        print(f"[{n}] STALLED: {st} for {h} hours (limit {UNSTAMPED_HOURS if st == 'unstamped' else PENDING_HOURS})")
    if errors:
        sys.stderr.write("failed entries: %s\n" % ", ".join(str(n) for n in errors))
        sys.exit(1)
    if late:
        sys.stderr.write("stalled entries: %s\n" % ", ".join(str(n) for n, _, _ in late))
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        print("FATAL:", e, file=sys.stderr)
        sys.exit(1)
