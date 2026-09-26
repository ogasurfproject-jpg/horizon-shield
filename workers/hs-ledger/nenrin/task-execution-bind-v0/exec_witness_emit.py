#!/usr/bin/env python3
"""exec_witness_emit.py : independent Python implementation of the task-execution-bind-v0 content hashes.

Builds a fixed AuthorizationGrant and ExecutionReceipt, computes grant_ref and receipt_id with a hand-written
recursive canonical (same discipline as task_witness_emit.py), and prints JSON. exec_cross_lang_test.mjs runs
this script and recomputes both ids in JS; they must match byte for byte, which they only can if the two
canonical() implementations agree. That is what makes the digest independent of any one implementation.
Deliberately exercises: unsorted insertion order, a nested object, a null value, and no numbers (numbers are
the one cross-language canonicalization hazard v0 avoids by hashing args and results as sha256 strings).
"""
import hashlib
import json

def canonical(v):
    if v is None or not isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    if isinstance(v, list):
        return "[" + ",".join(canonical(x) for x in v) + "]"
    keys = sorted(v.keys())
    return "{" + ",".join(json.dumps(k, ensure_ascii=False, separators=(",", ":")) + ":" + canonical(v[k]) for k in keys) + "}"

def sha256hex(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()

GRANT_DERIVED = ("grant_ref", "caller_sig", "action_binding")
RECEIPT_DERIVED = ("receipt_id", "provider_sig", "action_binding")

def action_binding(action):
    # VATE-shaped, derived (outside the preimage): the JS side must recompute digest.value byte for byte
    return {"type": "canonical_request_digest", "canonicalization": "musubi-canonical-v0",
            "preimage_profile": "task-execution-bind-v0/action",
            "digest": {"alg": "sha-256", "value": sha256hex(canonical(action))}}

def stripped(rec, derived):
    return {k: v for k, v in rec.items() if k not in derived}

def grant_ref(g):
    return sha256hex(canonical(stripped(g, GRANT_DERIVED)))

def receipt_id(r):
    return sha256hex(canonical(stripped(r, RECEIPT_DERIVED)))

def fixture():
    # insertion order is deliberately NOT sorted, so sort_keys discipline is what makes the bytes agree
    grant = {
        "nonce": "n-xlang-1",
        "task_id": "task_xlang_exec_1",
        "provider_id": "did:key:PROVIDER",
        "action": {"target": "/invoices/pay", "args_sha256": "sha_args_ok", "tool": "a2a.invoke"},
        "caller_id": "did:key:CALLER",
        "schema": "task-execution-bind-v0/grant",
        "not_after": "2026-09-18T01:00:00Z",
        "not_before": None,
    }
    grant["grant_ref"] = grant_ref(grant)
    grant["action_binding"] = action_binding(grant["action"])
    receipt = {
        "provider_id": "did:key:PROVIDER",
        "outcome": {
            "result_sha256": "sha_res_1",
            "status": "completed",
            "evidence": {"system": "ledger.horizonshield.dev", "kind": "ledger_record", "ref": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"},
        },
        "task_id": "task_xlang_exec_1",
        "executed_action": {"tool": "a2a.invoke", "args_sha256": "sha_args_ok", "target": "/invoices/pay"},
        "schema": "task-execution-bind-v0/receipt",
        "grant_ref": grant["grant_ref"],
        "executed_at": "2026-09-18T00:30:00Z",
    }
    receipt["receipt_id"] = receipt_id(receipt)
    receipt["action_binding"] = action_binding(receipt["executed_action"])
    return {
        "grant": grant,
        "receipt": receipt,
        "grant_preimage_canonical": canonical(stripped(grant, GRANT_DERIVED)),
        "receipt_preimage_canonical": canonical(stripped(receipt, RECEIPT_DERIVED)),
    }

if __name__ == "__main__":
    print(json.dumps(fixture(), ensure_ascii=False))
