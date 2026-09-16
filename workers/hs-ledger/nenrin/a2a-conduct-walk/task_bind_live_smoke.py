# task_bind_live_smoke.py : prove task_bind emits a real signed task observation to the LIVE /witness/task,
# and that /witness/task and /trust-signal reflect it. Writes under nenrin:task: with a unique timestamped
# task_id (isolated). Run: python3 task_bind_live_smoke.py
import sys
import json
import urllib.request
from datetime import datetime, timezone
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
import task_bind as B
import task_witness_emit as T

fails = 0


def ok(name, cond):
    global fails
    print(("  ok   " if cond else "  FAIL ") + name)
    if not cond:
        fails += 1


def get(url):
    req = urllib.request.Request(url, headers={"user-agent": T.PRODUCER_UA})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))


wpriv = Ed25519PrivateKey.generate()
wpub = wpriv.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
W = T.did_key_from_pub(wpub)
stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
tid = "walkbind-smoke-" + stamp
AGENT = "https://mcp.horizonshield.dev"

print("task_bind live -> " + T.LEDGER_TASK_URL + "  (task_id " + tid + ", witness " + W[:20] + "...)")

st, body = B.emit_task_binding(tid, AGENT, "PASS", wpriv, W)
ok("task binding accepted live (200)", st == 200 and body.get("ok") is True)
ok("live records witness_sig + edge_sig true", body.get("witness_sig") is True and body.get("edge_sig") is True)

g = get(T.LEDGER_TASK_URL + "?task_id=" + tid)
h = (g.get("hops") or [{}])[0]
ok("live GET signed_witnesses==1 + edge_attested + verdict PASS", h.get("signed_witnesses") == 1 and h.get("edge_attested") is True and h.get("verdict") == "PASS")

ts = get(T.LEDGER_TASK_URL.replace("/witness/task", "/trust-signal") + "?task_id=" + tid)
d = (ts.get("delegation") or [{}])[0]
ok("live trust-signal reflects binding (attributable + hop.to is the walked agent)", d.get("attributable") is True and d.get("to") == AGENT)

print(("\n" + str(fails) + " FAILED") if fails else "\nALL PASS (task_bind -> live /witness/task -> trust-signal)")
sys.exit(1 if fails else 0)
