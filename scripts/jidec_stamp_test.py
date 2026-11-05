#!/usr/bin/env python3
"""jidec_stamp_test: the block an entry records is the earliest Bitcoin attestation in the proof (2026-10-12, entry 86); the pending fetch retries only a timeout or a 5xx (2026-11-05)."""
import os, sys
os.environ.setdefault("LEDGER_URL", "https://ledger.invalid")
os.environ.setdefault("LEDGER_ADMIN_TOKEN", "test")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jidec_stamp as J  # noqa: E402

INFO_86 = """File sha256 hash: 2cf03de3edea266bddbc39fdd0a3e046f2d181cb8828a82d4b691ac8495744ba
Timestamp:
append 1a2b
sha256
 -> append 3c4d
    sha256
    verify BitcoinBlockHeaderAttestation(971047)
 -> append 5e6f
    sha256
    verify BitcoinBlockHeaderAttestation(971024)
 -> verify PendingAttestation('https://finney.calendar.eternitywall.com')
"""
checks = [
    ("two attestations, later printed first: the earliest (971024) is recorded", J.earliest_bitcoin_height(INFO_86) == 971024),
    ("one attestation: that one", J.earliest_bitcoin_height("verify BitcoinBlockHeaderAttestation(970852)") == 970852),
    ("pending only: None, so the entry stays pending", J.earliest_bitcoin_height("verify PendingAttestation('https://a.pool.opentimestamps.org')") is None),
    ("empty or missing output: None", J.earliest_bitcoin_height("") is None and J.earliest_bitcoin_height(None) is None),
]
import datetime  # noqa: E402
NOW = datetime.datetime(2026, 10, 19, 12, 0, tzinfo=datetime.timezone.utc)
E = [{"n": 1, "ots_status": "unstamped", "created_at": "2026-10-19T09:00:00Z"},
     {"n": 2, "ots_status": "unstamped", "created_at": "2026-10-19T03:00:00.000Z"},
     {"n": 3, "ots_status": "pending", "created_at": "2026-10-16T00:00:00Z", "stamped_at": "2026-10-18T00:00:00Z"},
     {"n": 4, "ots_status": "pending", "created_at": "2026-10-16T00:00:00Z", "stamped_at": "2026-10-17T00:00:00Z"},
     {"n": 5, "ots_status": "pending", "created_at": "2026-10-16T00:00:00Z"},
     {"n": 6, "ots_status": "confirmed", "created_at": "2026-10-01T00:00:00Z"},
     {"n": 7, "ots_status": "unstamped", "created_at": "not a time"}]
checks += [
    ("stalled: unstamped 9 h and pending 60 h are late; 3 h, 36 h, confirmed and an unreadable time are not",
     [n for n, _, _ in J.stalled(E, set(), NOW)] == [2, 4, 5]),
    ("stalled: an entry this run moved is not late, whatever its age", [n for n, _, _ in J.stalled(E, {2, 4, 5}, NOW)] == []),
]
import socket, urllib.error, urllib.request  # noqa: E402


def fake_get(seq, calls):
    def get(path):
        calls.append(path)
        x = seq.pop(0)
        if isinstance(x, Exception):
            raise x
        return x
    return get


def pend(seq, waits=(10, 30)):
    calls, slept = [], []
    try:
        r = J.fetch_pending(fake_get(list(seq), calls), slept.append, waits)
    except J.ApiError as ex:
        r = ex
    return r, len(calls), slept


T = J.ApiError("GET /ledger/pending -> The read operation timed out", None, True)
OK = {"pending": [{"n": 9}]}
r1 = pend([T, T, OK])
r2 = pend([J.ApiError("GET /ledger/pending -> HTTP 503 ", 503, True), OK])
r3 = pend([T, T, T, OK])
r4 = pend([J.ApiError("GET /ledger/pending -> HTTP 401 ", 401, False), OK])
r5 = pend([J.ApiError("GET /ledger/pending -> network error: [Errno -2] Name or service not known", None, False), OK])
checks += [
    ("pending fetch: two timeouts then an answer, the answer is used after waits of 10 and 30 s",
     r1 == ([{"n": 9}], 3, [10, 30])),
    ("pending fetch: a 503 then an answer, one wait of 10 s", r2 == ([{"n": 9}], 2, [10])),
    ("pending fetch: three timeouts are still a failure, and no fourth try",
     isinstance(r3[0], J.ApiError) and r3[1:] == (3, [10, 30])),
    ("pending fetch: a 401 stops at once (no wait, no second try)", isinstance(r4[0], J.ApiError) and r4[1:] == (1, [])),
    ("pending fetch: a name that does not resolve stops at once", isinstance(r5[0], J.ApiError) and r5[1:] == (1, [])),
]
try:
    pend([ValueError("not JSON"), OK])
    r6ok = False
except ValueError:
    r6ok = True
checks.append(("pending fetch: an error that is not a ledger call error (a body that is not JSON) is not retried", r6ok))


def api_with(exc):
    real = urllib.request.urlopen

    def boom(*a, **k):
        raise exc
    urllib.request.urlopen = boom
    try:
        J.api("/ledger/pending")
    except J.ApiError as ex:
        return ex.retryable, ex.code, str(ex)
    finally:
        urllib.request.urlopen = real
    return None


def http_error(code):
    return urllib.error.HTTPError("https://ledger.invalid/ledger/pending", code, "x", {}, None)


a1 = api_with(TimeoutError("The read operation timed out"))
a2 = api_with(socket.timeout("timed out"))
a3 = api_with(urllib.error.URLError(socket.timeout("timed out")))
a4 = api_with(http_error(502))
a5 = api_with(http_error(401))
a6 = api_with(urllib.error.URLError(ConnectionRefusedError(61, "Connection refused")))
checks += [
    ("api: a read timeout (the 2026-11-04 19:17 UTC failure) is a retryable ledger error with the same words",
     a1 is not None and a1[0] is True and "The read operation timed out" in a1[2]),
    ("api: socket.timeout and a URLError around a timeout are retryable", a2 is not None and a2[0] is True and a3 is not None and a3[0] is True),
    ("api: HTTP 502 is retryable and keeps its code", a4 is not None and a4[:2] == (True, 502) and "HTTP 502" in a4[2]),
    ("api: HTTP 401 and a refused connection are not retryable",
     a5 is not None and a5[:2] == (False, 401) and a6 is not None and a6[0] is False and "network error" in a6[2]),
    ("the waits are 10 and 30 s, three tries in all, under the 60 s read limit of each try", J.PENDING_WAITS == (10, 30)),
]
bad = [n for n, ok in checks if not ok]
for n, ok in checks:
    print(("ok    " if ok else "FAIL  ") + n)
print("\n%d/%d passed" % (len(checks) - len(bad), len(checks)))
sys.exit(1 if bad else 0)
