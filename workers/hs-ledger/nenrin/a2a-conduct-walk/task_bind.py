# task_bind.py : turn a real A2A conduct walk into a task-bound WitnessObservation for /witness/task.
#
# The walk already talks to a real agent and, on the A2A path, gets back a real A2A Task carrying an
# a2a.task.id. This binds that REAL task to the NENRIN task-delegation ledger:
#   - task_id   = the real a2a.task.id returned by the walked agent
#   - hop.from  = P, a requester identity (the party that delegated task T); attests the edge (edge_sig)
#   - hop.to    = B, the walked agent (its origin)
#   - witness   = W, the walk's OWN Ed25519 key expressed as a did:key; attests the observation (witness_sig)
#
# One key serves two identities: the same Ed25519 key the walk serves at key_url (domain identity, for the
# endpoint-keyed record) is here expressed as did:key W for the task ledger. R1 holds by construction:
# witness (W) != requester (P, a fresh key) != agent (B, an origin). If the walk operator holds both P and
# W it is a disclosed same-operator observation (honest, not counted as an independent third party) exactly
# like the self-witness dogfood; an external walker makes it a genuine third-party observation. Either way
# the ledger holds a real, signed, content-addressed task observation. The signatures prove who asserted,
# not that the assertion is true (the ledger says so in its own words).

import task_witness_emit as T  # vendored producer (canonical / evidence_id / build / sign / emit + did:key), byte-identical to the JS ledger


def a2a_task_id_from_response(j):
    """Extract the real a2a.task.id from a walked agent's JSON-RPC response, or None.

    A2A 1.0 wraps a Task as result.task; 0.3 returns the Task inline with kind == 'task'. A message-shaped
    result carries no task id (nothing to bind); return None so the walk simply files no task observation.
    """
    try:
        r = j.get("result")
        if not isinstance(r, dict):
            return None
        if isinstance(r.get("task"), dict):
            task = r["task"]
        elif r.get("kind") == "task":
            task = r
        else:
            return None
        tid = task.get("id")
        return tid if isinstance(tid, str) and tid else None
    except Exception:
        return None


def did_key_from_pem(pem_path):
    """Return (private_key, did:key) for the walk's Ed25519 PEM: the same key served at key_url, here also
    expressed as the did:key witness_id so the ledger verifies witness_sig with no network (key is in the id)."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    with open(pem_path, "rb") as f:
        key = serialization.load_pem_private_key(f.read(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise SystemExit("witness key must be an Ed25519 private key")
    pub = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return key, T.did_key_from_pub(pub)


def did_key_from_privkey(priv):
    """did:key for an already-loaded Ed25519 private key (the walk holds one from load_signing_key)."""
    from cryptography.hazmat.primitives import serialization
    pub = priv.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return T.did_key_from_pub(pub)


def build_signed_task_observation(task_id, agent_id, verdict, witness_priv, witness_did, detail_ref=None):
    """Build a task-bound observation and sign it: witness_sig by W (the walk key), edge_sig by a fresh
    requester key P. Returns (observation, requester_private_key). Enforces R1 via build_observation."""
    p_priv, P = T.new_agent()  # the requester identity for this delegation instance (edge signer)
    obs = T.build_observation(task_id, 0, P, agent_id, verdict, witness_did, detail_ref=detail_ref)
    obs = T.sign_observation(obs, witness_priv)  # W attests: "I observed this"
    obs = T.sign_edge(obs, p_priv)               # P attests: "I delegated task T to B"
    return obs, p_priv


def emit_task_binding(task_id, agent_id, verdict, witness_priv, witness_did, ledger_url=None, detail_ref=None):
    """Build, sign, and POST a task-bound observation to the live /witness/task. Returns (status, body)."""
    obs, _ = build_signed_task_observation(task_id, agent_id, verdict, witness_priv, witness_did, detail_ref=detail_ref)
    return T.emit(obs, ledger_url=ledger_url or T.LEDGER_TASK_URL)
