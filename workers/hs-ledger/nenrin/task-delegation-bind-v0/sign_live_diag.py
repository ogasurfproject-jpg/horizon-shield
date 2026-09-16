# sign_live_diag.py : raw diagnostic for the live /witness/task signed path. Prints the exact HTTP status,
# content-type and raw body (no JSON parsing, so it never crashes), for an unsigned obs and a signed obs.
# If unsigned -> 200 JSON but signed -> 5xx non-JSON, the fault is isolated to the signature path.
# Run alongside `npx wrangler tail` to capture the worker-side stack.  python3 sign_live_diag.py

import json
import urllib.request
import urllib.error
from task_witness_emit import new_agent, build_observation, sign_observation, sign_edge

URL = "https://ledger.horizonshield.dev/witness/task"


def post_raw(o, label):
    data = json.dumps(o).encode()
    req = urllib.request.Request(URL, data=data, method="POST", headers={"content-type": "application/json"})
    try:
        r = urllib.request.urlopen(req, timeout=20)
        print(label, "STATUS", r.status, "ct=", r.headers.get("content-type"))
        print((r.read().decode(errors="replace"))[:2000])
    except urllib.error.HTTPError as e:
        print(label, "HTTPError", e.code, "ct=", e.headers.get("content-type"))
        print((e.read().decode(errors="replace"))[:2000])
    except Exception as e:
        print(label, "EXC", repr(e))
    print("----")


w1, W1 = new_agent()
w2, W2 = new_agent()
a, A = new_agent()
b, B = new_agent()

o_un = build_observation("diag-unsigned", 0, A, B, "PASS", W1)
post_raw(o_un, "[unsigned]")

o_s = build_observation("diag-signed", 0, A, B, "PASS", W1)
o_s = sign_edge(sign_observation(o_s, w1), a)
print("[signed] witness_sig_len", len(o_s["witness_sig"]), "edge_sig_len", len(o_s["edge_sig"]),
      "witness_id_head", o_s["witness_id"][:20], "hop_from_head", o_s["hop"]["from"][:20])
post_raw(o_s, "[signed]")
