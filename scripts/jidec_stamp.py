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
"""
import os, re, sys, json, base64, subprocess, urllib.request, urllib.error, datetime

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
        raise RuntimeError("%s %s -> HTTP %s %s" % (method, path, ex.code, detail))
    except urllib.error.URLError as ex:
        raise RuntimeError("%s %s -> network error: %s" % (method, path, ex.reason))


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
    m = re.search(r"BitcoinBlockHeaderAttestation\((\d+)\)", info)
    if m:
        height = int(m.group(1))
        b64 = base64.b64encode(open(ots, "rb").read()).decode()
        api(f"/ledger/{n}/ots", "POST", {"ots_base64": b64, "status": "confirmed", "bitcoin_block": height, "block_time": block_time(height)})
        print(f"[{n}] -> CONFIRMED at Bitcoin block {height}")
        return 1
    print(f"[{n}] still pending — no Bitcoin attestation yet (normal for the first ~1-2h)")
    return 0


def main():
    try:
        pending = api("/ledger/pending").get("pending", [])
    except Exception as ex:
        sys.stderr.write(f"cannot fetch pending entries: {ex}\n")
        sys.exit(1)
    print(f"pending entries: {len(pending)}")
    changed = 0
    errors = []
    for e in pending:
        n = e.get("n") if isinstance(e, dict) else None
        try:
            changed += stamp_one(e)
        except Exception as ex:
            errors.append(n)
            print(f"[{n}] ERROR: {ex}")
    print(f"done. updated {changed} entr{'y' if changed==1 else 'ies'}; {len(errors)} error(s).")
    if errors:
        sys.stderr.write("failed entries: %s\n" % ", ".join(str(n) for n in errors))
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        print("FATAL:", e, file=sys.stderr)
        sys.exit(1)
