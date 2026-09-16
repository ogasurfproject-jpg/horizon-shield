# task_bind_selftest.py : offline proof that a real walk key + a real a2a.task.id produce a valid, signed,
# content-addressed task observation the ledger will accept. No network. Run: python3 task_bind_selftest.py
import base64
import os
import sys
import tempfile
import task_bind as B
import task_witness_emit as T
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

fails = 0


def ok(name, cond):
    global fails
    print(("  ok   " if cond else "  FAIL ") + name)
    if not cond:
        fails += 1


print("task_bind : walk key -> did:key -> signed task observation (offline)")

ok("A2A 1.0 result.task.id", B.a2a_task_id_from_response({"result": {"task": {"id": "T-123"}}}) == "T-123")
ok("A2A 0.3 inline kind:task id", B.a2a_task_id_from_response({"result": {"kind": "task", "id": "T-9"}}) == "T-9")
ok("message result -> None (nothing to bind)", B.a2a_task_id_from_response({"result": {"message": {"parts": []}}}) is None)
ok("no result -> None", B.a2a_task_id_from_response({"jsonrpc": "2.0"}) is None)
ok("empty id -> None", B.a2a_task_id_from_response({"result": {"task": {"id": ""}}}) is None)

wpriv = Ed25519PrivateKey.generate()
wpub_raw = wpriv.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
W = T.did_key_from_pub(wpub_raw)
AGENT = "https://mcp.horizonshield.dev"
obs, p_priv = B.build_signed_task_observation("T-real-1", AGENT, "PASS", wpriv, W)

ok("evidence_id recomputes (content-addressed)", obs["evidence_id"] == T.evidence_id(obs))
ok("R1: witness != hop.from and != hop.to", obs["witness_id"] != obs["hop"]["from"] and obs["witness_id"] != obs["hop"]["to"])
ok("witness_id is the walk key as did:key", obs["witness_id"] == W and W.startswith("did:key:z"))
ok("hop.to is the walked agent origin", obs["hop"]["to"] == AGENT)
ok("hop.from is a did:key requester (edge signer)", isinstance(obs["hop"]["from"], str) and obs["hop"]["from"].startswith("did:key:z"))

try:
    wpriv.public_key().verify(base64.b64decode(obs["witness_sig"]), T.canonical(T.preimage(obs)).encode("utf-8"))
    ok("witness_sig verifies (W attests the observation)", True)
except Exception:
    ok("witness_sig verifies (W attests the observation)", False)

try:
    p_priv.public_key().verify(base64.b64decode(obs["edge_sig"]), T.canonical({"task_id": obs["task_id"], "hop": obs["hop"]}).encode("utf-8"))
    ok("edge_sig verifies (requester attests P->B)", True)
except Exception:
    ok("edge_sig verifies (requester attests P->B)", False)

pem = wpriv.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
tf = tempfile.NamedTemporaryFile(delete=False, suffix=".pem")
tf.write(pem)
tf.close()
_k2, did2 = B.did_key_from_pem(tf.name)
os.unlink(tf.name)
ok("did_key_from_pem == did:key from raw pub (one key, both identities)", did2 == W)

tampered = dict(obs)
tampered["conduct"] = {"verdict": "FAIL", "detail_ref": obs["conduct"]["detail_ref"]}
ok("post-sign verdict tamper breaks evidence_id (R2 catches it)", tampered["evidence_id"] != T.evidence_id(tampered))

print(("\n" + str(fails) + " FAILED") if fails else "\nALL PASS (task_bind: walk key -> did:key -> signed task observation)")
sys.exit(1 if fails else 0)
