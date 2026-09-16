# task_witness_emit.py : NENRIN conduct-witness producer for A2A task-bound observations (bind-v0).
#
# The producer side of the /witness/task ledger face. It builds a WitnessObservation keyed by the A2A Task id
# (a2a.task.id) and delegation hop, stamps evidence_id, optionally signs it (witness_sig + edge_sig), and POSTs
# it to the live ledger. canonical() / evidence_id() are byte-identical to task_ledger_v0.mjs (simplified JCS +
# SHA-256). Signatures are Ed25519 over the same canonical bytes; the public key rides inside the did:key
# identifier (self-contained, no network), so the ledger verifies with no resolver call.
#
#   witness_sig : witness signs canonical(preimage(obs))          -> verdict is attributable, non-repudiable.
#   edge_sig    : hop.from signs canonical({task_id, hop})        -> the delegation edge A->B is party-attested.
#
# Because the preimage strips evidence_id/witness_sig/edge_sig, adding signatures never changes evidence_id.

import json
import hashlib
import base64
import urllib.request
import urllib.error
from datetime import datetime, timezone
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

LEDGER_TASK_URL = "https://ledger.horizonshield.dev/witness/task"
# urllib's default UA (Python-urllib/<ver>) is on Cloudflare's bot signature list and is refused at the
# edge with 403 (error 1010) before it ever reaches the worker. An explicit honest product UA passes.
PRODUCER_UA = "HORIZON-SHIELD-NENRIN/1.0 (task-delegation-bind-v0)"
DERIVED_FIELDS = ("evidence_id", "witness_sig", "edge_sig")


def canonical(v):
    # matches task_ledger_v0.mjs canonical(): recursive key sort, no whitespace, JSON-escaped primitives/keys.
    if v is None or isinstance(v, (str, int, float, bool)):
        return json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    if isinstance(v, list):
        return "[" + ",".join(canonical(x) for x in v) + "]"
    if isinstance(v, dict):
        keys = sorted(v.keys())
        return "{" + ",".join(json.dumps(k, ensure_ascii=False, separators=(",", ":")) + ":" + canonical(v[k]) for k in keys) + "}"
    raise TypeError("canonical: unsupported type " + repr(type(v)))


def sha256hex(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def preimage(obs):
    return {k: v for k, v in obs.items() if k not in DERIVED_FIELDS}


def evidence_id(obs):
    return sha256hex(canonical(preimage(obs)))


def _now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---- did:key (Ed25519) : self-contained public key identifier, matches task_ledger_v0.mjs pubFromDidKey ----
_B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def _b58encode(b):
    n = int.from_bytes(b, "big")
    out = ""
    while n > 0:
        n, r = divmod(n, 58)
        out = _B58[r] + out
    pad = len(b) - len(b.lstrip(b"\x00"))
    return "1" * pad + out


def did_key_from_pub(pub_raw):  # pub_raw: 32 raw Ed25519 public bytes
    return "did:key:z" + _b58encode(b"\xed\x01" + pub_raw)


def new_agent():
    """Return (private_key, did_key). The did embeds the public key; no registry needed."""
    priv = Ed25519PrivateKey.generate()
    pub_raw = priv.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return priv, did_key_from_pub(pub_raw)


def build_observation(task_id, hop_seq, hop_from, hop_to, verdict, witness_id,
                      prev_evidence_id=None, detail_ref=None, observed_at=None):
    """Build a stamped WitnessObservation. Enforces R1 (witness must not be either party of the hop)."""
    if not isinstance(task_id, str) or task_id == "":
        raise ValueError("task_id required (the A2A Task id)")
    if witness_id == hop_from or witness_id == hop_to:
        raise ValueError("R1 violated: witness_id must differ from hop.from and hop.to")
    obs = {
        "task_id": task_id,
        "hop": {"seq": hop_seq, "from": hop_from, "to": hop_to},
        "prev_evidence_id": prev_evidence_id,
        "conduct": {"verdict": verdict, "detail_ref": detail_ref},
        "witness_id": witness_id,
        "observed_at": observed_at or _now_iso(),
    }
    obs["evidence_id"] = evidence_id(obs)
    return obs


def sign_observation(obs, witness_priv):
    """witness_sig: the witness signs canonical(preimage(obs)) with Ed25519. Attributable, non-repudiable."""
    sig = witness_priv.sign(canonical(preimage(obs)).encode("utf-8"))
    o = dict(obs)
    o["witness_sig"] = base64.b64encode(sig).decode("ascii")
    return o


def sign_edge(obs, from_priv):
    """edge_sig: hop.from signs canonical({task_id, hop}). The delegation edge is party-attested."""
    sig = from_priv.sign(canonical({"task_id": obs["task_id"], "hop": obs["hop"]}).encode("utf-8"))
    o = dict(obs)
    o["edge_sig"] = base64.b64encode(sig).decode("ascii")
    return o


def _read_json(resp):
    """Decode a response body as JSON; if it is not JSON (e.g. an edge error page), return {"raw": text}."""
    txt = resp.read().decode("utf-8", errors="replace")
    try:
        return json.loads(txt)
    except ValueError:
        return {"raw": txt[:500]}


def emit(obs, ledger_url=LEDGER_TASK_URL, timeout=15):
    """POST a stamped (optionally signed) observation to the live ledger. Returns (status, body).

    Sends an explicit product User-Agent because urllib's default (Python-urllib/<ver>) is refused at the
    Cloudflare edge with 403 (error 1010) before it reaches the worker. A non-JSON body is returned as
    {"raw": <text>} instead of raising, so a producer never dies on an unexpected edge response.
    """
    data = json.dumps(obs).encode("utf-8")
    req = urllib.request.Request(ledger_url, data=data, method="POST",
                                 headers={"content-type": "application/json", "user-agent": PRODUCER_UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, _read_json(r)
    except urllib.error.HTTPError as e:
        return e.code, _read_json(e)


def demo_observations():
    """Unsigned deterministic observations for the evidence_id conformance test."""
    at = "2026-09-16T10:00:00Z"
    out = []
    out.append(build_observation("prod-t1", 0, "did:key:A", "did:key:B", "PASS", "did:key:W1", observed_at=at))
    h0 = build_observation("prod-t2", 0, "did:key:A", "did:key:B", "PASS", "did:key:W1", observed_at=at)
    out.append(h0)
    out.append(build_observation("prod-t2", 1, "did:key:B", "did:key:C", "PASS", "did:key:W2",
                                 prev_evidence_id=h0["evidence_id"], observed_at=at))
    out.append(build_observation("prod-t3", 0, "did:key:A", "did:key:B", "PASS", "did:key:W1", observed_at=at))
    out.append(build_observation("prod-t3", 0, "did:key:A", "did:key:B", "FAIL", "did:key:W2", observed_at=at))
    return out


def signed_demo():
    """Signed cases (real Ed25519 keys + did:key) for the cross-language signature test."""
    at = "2026-09-16T10:00:00Z"
    w1, W1 = new_agent()
    w2, W2 = new_agent()
    a, A = new_agent()   # hop.from party
    b, B = new_agent()   # hop.to party
    out = []

    # 1) fully signed, valid: W1 witnesses A->B, edge signed by A (hop.from)
    o = build_observation("sig-t1", 0, A, B, "PASS", W1, observed_at=at)
    o = sign_edge(sign_observation(o, w1), a)
    out.append({"case": "valid_signed", "expect": "accept", "obs": o})

    # 2) forged witness_sig: witness_id says W1 but W2 signed -> invalid
    o2 = build_observation("sig-t2", 0, A, B, "PASS", W1, observed_at=at)
    o2 = sign_observation(o2, w2)
    out.append({"case": "forged_witness_sig", "expect": "reject", "obs": o2})

    # 3) forged edge_sig: edge signed by B, not hop.from A -> invalid
    o3 = build_observation("sig-t3", 0, A, B, "PASS", W1, observed_at=at)
    o3 = sign_edge(sign_observation(o3, w1), b)
    out.append({"case": "forged_edge_sig", "expect": "reject", "obs": o3})

    # 4) re-stamped tamper: verdict changed AND evidence_id re-stamped (so R2 passes), but witness_sig is stale.
    #    Signatures catch what a re-stamped evidence_id would not. Attacker lacks the witness key.
    o4 = build_observation("sig-t4", 0, A, B, "PASS", W1, observed_at=at)
    o4 = sign_observation(o4, w1)
    o4["conduct"]["verdict"] = "FAIL"
    o4["evidence_id"] = evidence_id(o4)
    out.append({"case": "restamped_stale_sig", "expect": "reject", "obs": o4})

    # 5) unsigned still accepted (backward compatible)
    o5 = build_observation("sig-t5", 0, A, B, "PASS", W1, observed_at=at)
    out.append({"case": "unsigned", "expect": "accept", "obs": o5})

    return out


if __name__ == "__main__":
    import sys
    mode = sys.argv[1] if len(sys.argv) > 1 else "--demo"
    print(json.dumps(signed_demo() if mode == "--signed" else demo_observations(), ensure_ascii=False))
