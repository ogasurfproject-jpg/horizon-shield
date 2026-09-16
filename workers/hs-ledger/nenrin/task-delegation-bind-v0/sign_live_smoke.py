# sign_live_smoke.py : live proof that Ed25519 signature verification runs in the DEPLOYED Workers runtime.
#
# The Node selftests prove the logic. Only this proves crypto.subtle Ed25519 importKey/verify actually
# executes on the live Cloudflare Workers runtime (Node 24 supporting it does NOT prove Workers does).
# It writes only under nenrin:task: with a unique timestamped task_id, so it never collides with real data.
# Forged cases are rejected (422) and write nothing. Run AFTER `npx wrangler deploy`:
#     python3 sign_live_smoke.py
#
# Expected: ALL PASS (live Ed25519 verify runs on Workers)

import sys
import json
import urllib.request
import urllib.error
from datetime import datetime, timezone
from task_witness_emit import (
    new_agent, build_observation, sign_observation, sign_edge, emit, LEDGER_TASK_URL, PRODUCER_UA,
)

fails = 0


def ok(name, cond):
    global fails
    print(("  ok   " if cond else "  FAIL ") + name)
    if not cond:
        fails += 1


def get_task(task_id):
    url = LEDGER_TASK_URL + "?task_id=" + task_id
    req = urllib.request.Request(url, headers={"user-agent": PRODUCER_UA})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.status, json.loads(r.read().decode("utf-8"))


def get_trust_signal(task_id):
    url = LEDGER_TASK_URL.replace("/witness/task", "/trust-signal") + "?task_id=" + task_id
    req = urllib.request.Request(url, headers={"user-agent": PRODUCER_UA})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.status, json.loads(r.read().decode("utf-8"))


stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
tid = "smoke-sig-" + stamp

w1, W1 = new_agent()
w2, W2 = new_agent()
a, A = new_agent()   # hop.from party
b, B = new_agent()   # hop.to party

print("live sign smoke -> " + LEDGER_TASK_URL + "  (task_id " + tid + ")")

# 1) valid signed observation: W1 witnesses A->B, edge signed by A (hop.from). Must be accepted live.
o = build_observation(tid, 0, A, B, "PASS", W1)
o = sign_edge(sign_observation(o, w1), a)
st, body = emit(o)
ok("valid signed accepted live (200)", st == 200 and body.get("ok") is True)
ok("live records witness_sig true + edge_sig true", body.get("witness_sig") is True and body.get("edge_sig") is True)

# 2) forged witness_sig: witness_id says W1 but W2 actually signed. Ed25519 verify must FAIL live -> 422.
o2 = build_observation(tid + "-forge", 0, A, B, "PASS", W1)
o2 = sign_observation(o2, w2)
st2, body2 = emit(o2)
ok("forged witness_sig rejected live (422 witness_sig_invalid)", st2 == 422 and body2.get("error") == "witness_sig_invalid")

# 3) forged edge_sig: edge signed by B, not hop.from A. Must FAIL live -> 422.
o3 = build_observation(tid + "-edge", 0, A, B, "PASS", W1)
o3 = sign_edge(sign_observation(o3, w1), b)
st3, body3 = emit(o3)
ok("forged edge_sig rejected live (422 edge_sig_invalid)", st3 == 422 and body3.get("error") == "edge_sig_invalid")

# 4) GET the valid task: live attribution surfaced (signed_witnesses, edge_attested).
stg, g = get_task(tid)
h = (g.get("hops") or [{}])[0]
ok("live GET signed_witnesses == 1", h.get("signed_witnesses") == 1)
ok("live GET edge_attested == true", h.get("edge_attested") is True)
ok("live GET verdict PASS", h.get("verdict") == "PASS")

# 5) task-bound trust signal reflects the signed observation live (counts, never a score).
stt, t = get_trust_signal(tid)
d = (t.get("delegation") or [{}])[0]
ok("live trust-signal name", t.get("signal") == "task-conduct-trust-signal-v0")
ok("live trust-signal reflects signature (signed_witnesses 1 + edge_attested + attributable)",
   d.get("signed_witnesses") == 1 and d.get("edge_attested") is True and d.get("attributable") is True)
ok("live trust-signal verdict PASS, no adverse hop", d.get("verdict") == "PASS" and (t.get("adverse_hops") or []) == [])
ok("live trust-signal carries no numeric score", '"score":' not in json.dumps(t) and isinstance(t.get("not_a_score"), str))

print(("\n" + str(fails) + " FAILED") if fails else "\nALL PASS (live Ed25519 verify runs on Workers; task trust-signal live)")
sys.exit(1 if fails else 0)
