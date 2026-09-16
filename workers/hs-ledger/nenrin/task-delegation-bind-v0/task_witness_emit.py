# task_witness_emit.py : NENRIN conduct-witness producer for A2A task-bound observations (bind-v0).
#
# The producer side of the /witness/task ledger face. It builds a WitnessObservation keyed by the A2A Task id
# (a2a.task.id) and delegation hop, stamps evidence_id, and POSTs it to the live ledger. canonical() and
# evidence_id() are byte-identical to task_ledger_v0.mjs (simplified JCS + SHA-256), so the ledger's R2
# recompute accepts what this produces. R1 (witness independence) is enforced here, before emit.
#
# v0 emits UNSIGNED observations (evidence_id only). witness_sig/edge_sig are the next layer (attribution);
# because the preimage strips those derived fields, adding signatures later does not change evidence_id.

import json
import hashlib
import urllib.request
from datetime import datetime, timezone

LEDGER_TASK_URL = "https://ledger.horizonshield.dev/witness/task"
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


def emit(obs, ledger_url=LEDGER_TASK_URL, timeout=15):
    """POST a stamped observation to the live ledger /witness/task face. Returns (status, body)."""
    data = json.dumps(obs).encode("utf-8")
    req = urllib.request.Request(ledger_url, data=data, method="POST",
                                 headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:  # noqa: F821 (urllib.error imported lazily below)
        return e.code, json.loads(e.read().decode("utf-8"))


import urllib.error  # after emit def, keeps the module import order tidy


def demo_observations():
    """Deterministic observations for the cross-language conformance test (no network)."""
    at = "2026-09-16T10:00:00Z"
    out = []
    # single hop, one witness
    out.append(build_observation("prod-t1", 0, "did:key:A", "did:key:B", "PASS", "did:key:W1", observed_at=at))
    # two-hop chain: hop1 links hop0 by prev_evidence_id
    h0 = build_observation("prod-t2", 0, "did:key:A", "did:key:B", "PASS", "did:key:W1", observed_at=at)
    out.append(h0)
    out.append(build_observation("prod-t2", 1, "did:key:B", "did:key:C", "PASS", "did:key:W2",
                                 prev_evidence_id=h0["evidence_id"], observed_at=at))
    # disagreement on one hop: two independent witnesses, opposite verdicts
    out.append(build_observation("prod-t3", 0, "did:key:A", "did:key:B", "PASS", "did:key:W1", observed_at=at))
    out.append(build_observation("prod-t3", 0, "did:key:A", "did:key:B", "FAIL", "did:key:W2", observed_at=at))
    return out


if __name__ == "__main__":
    print(json.dumps(demo_observations(), ensure_ascii=False))
