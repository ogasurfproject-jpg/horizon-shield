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
"""
import os, re, sys, json, base64, subprocess, urllib.request, datetime

LEDGER_URL = os.environ["LEDGER_URL"].rstrip("/")
TOKEN = os.environ["LEDGER_ADMIN_TOKEN"]


def api(path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(LEDGER_URL + path, data=data, method=method)
    req.add_header("X-Ledger-Key", TOKEN)
    if data:
        req.add_header("content-type", "application/json")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def block_time(height):
    try:
        h = urllib.request.urlopen(f"https://blockstream.info/api/block-height/{height}", timeout=30).read().decode().strip()
        meta = json.loads(urllib.request.urlopen(f"https://blockstream.info/api/block/{h}", timeout=30).read().decode())
        return datetime.datetime.utcfromtimestamp(meta["timestamp"]).strftime("%Y-%m-%d %H:%M UTC")
    except Exception:
        return None


def main():
    pending = api("/ledger/pending").get("pending", [])
    print(f"pending entries: {len(pending)}")
    changed = 0
    for e in pending:
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
                changed += 1
            else:
                print(f"[{n}] stamp produced no .ots — will retry next run")
            continue

        # pending -> pull current .ots, try to upgrade to a Bitcoin attestation
        try:
            raw = urllib.request.urlopen(f"{LEDGER_URL}/ledger/{n}/ots", timeout=30).read()
            open(ots, "wb").write(raw)
        except Exception as ex:
            print(f"[{n}] could not fetch existing .ots: {ex}")
            continue
        up = run(["ots", "upgrade", ots])
        print(f"[{n}] upgrade rc={up.returncode} {(up.stderr or up.stdout).strip()[:160]}")
        info = run(["ots", "info", ots]).stdout
        m = re.search(r"BitcoinBlockHeaderAttestation\((\d+)\)", info)
        if m:
            height = int(m.group(1))
            b64 = base64.b64encode(open(ots, "rb").read()).decode()
            api(f"/ledger/{n}/ots", "POST", {"ots_base64": b64, "status": "confirmed", "bitcoin_block": height, "block_time": block_time(height)})
            print(f"[{n}] -> CONFIRMED at Bitcoin block {height}")
            changed += 1
        else:
            print(f"[{n}] still pending — no Bitcoin attestation yet (normal for the first ~1-2h)")
    print(f"done. updated {changed} entr{'y' if changed==1 else 'ies'}.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("FATAL:", e, file=sys.stderr)
        sys.exit(1)
