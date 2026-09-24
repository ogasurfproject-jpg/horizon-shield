#!/usr/bin/env python3
"""
ops/musubi_first_contract_build.py

Builds the UNSIGNED a2a-contract-v0 record for the first live MUSUBI contract:
HORIZON SHIELD (principal) and api.babyblueviper.com (contractor, Federico), a witness task on the
gate's a2a endpoint. Carries the three adjustments the contractor asked for before signing
(Issue #25 thread, 2026-09-25):
  1. requirements.recovery is n/a (a witness task has nothing for TSUGI to recover)
  2. expiry is grant.expiry_height, a chain coordinate; no wall-clock expiry (settlement never reads a clock)
  3. emit_witness is spelled out: fetch the card, POST the conduct probe to /a2a, sign the record with the
     agreement key, serve it content-addressed at /record, file it at the intake

It signs nothing, fetches nothing, never touches a private key. Standard library plus the sibling
musubi-v0 and agreement-v0 modules. Run from the repo root:

    python3 ops/musubi_first_contract_build.py

Then, HS's own hand:
    python3 workers/hs-ledger/nenrin/musubi-v0/contract_v0.py --sign workers/hs-ledger/nenrin/musubi-v0/first_contract_unsigned.json \
        --key ~/.hs_agreement_key.pem --domain horizonshield.dev --out workers/hs-ledger/nenrin/musubi-v0/first_contract_A.json
"""
import base64, hashlib, io, json, os, secrets, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
MUSUBI = os.path.join(ROOT, "workers", "hs-ledger", "nenrin", "musubi-v0")
sys.path.insert(0, MUSUBI)
import contract_v0 as v0
import settle_v1_6 as v16
import spine_verify as spine
from contract_v0 import canonical, contract_sha256

# --- pinned facts (from the countersigned a2a-agreement-v1.1 record 3eb0a7b1..., verified by both sides 2026-09-25) ---
A_DOMAIN = "horizonshield.dev"
A_KEY_URL = "https://gate.horizonshield.dev/keys/agreement.json"
A_PUB = "Q8DJu/tXWNNzsrmIkIUm4r2cR4MYaXNf1E2j+oZi+oo="
A_CARD = "https://gate.horizonshield.dev/.well-known/agent-card.json"
A_CARD_SHA = "769df24571c1a0323f6c70cde07fc35854a90010789fb32f24e8c63434dcff5f"
B_DOMAIN = "api.babyblueviper.com"
B_KEY_URL = "https://api.babyblueviper.com/keys/agreement.json"
B_PUB = "poTpqz0G34FMkZ1okV/fd5Dcvq7mCO4v1+qOgqBsje4="
B_CARD = "https://api.babyblueviper.com/.well-known/agent-card.json"
B_CARD_SHA = "5306018339599f3a8c7f6c932487b86f4c8d88a9766db3a1c2cec2f832816dac"
AGREEMENT_RECORD = "https://agreement.horizonshield.dev/agreement/3eb0a7b1e386990dd692c5c7c7ad71ce8ff3a973f225ae8cc4dcac7c48fc9d28"
LB_HEIGHT, LB_HASH = 968416, "0000000000000000000122af55415c0cfe39fa65742f4083a4e464d5f074b9ac"
EXPIRY_HEIGHT = LB_HEIGHT + 4320          # about 30 days of blocks above the checkpoint
TARGET = "https://gate.horizonshield.dev/a2a"

TASK_PAYLOAD = "a2a-conduct-walk-v1 witness of " + TARGET + " by " + B_DOMAIN + ", both wire versions 1.0 and 0.3"


def build():
    task = {
        "purpose": "witness: walk the principal's a2a endpoint with the a2a-conduct-v1 probe and publish a signed, content-addressed record of what was observed",
        "target": TARGET,
        "payload": TASK_PAYLOAD,
        "payload_digest": hashlib.sha256(TASK_PAYLOAD.encode("utf-8")).hexdigest(),
        "a2a_task_id": None,
        "action_definitions": {
            "read": "GET the principal's agent card and public endpoints; no state is changed",
            "observe": "run the a2a-conduct-v1 probe against the target on wire 1.0 and 0.3 and record each check's result and response body hash",
            "emit_witness": [
                "fetch the principal's agent card at " + A_CARD + " and pin its sha256",
                "POST the conduct probe to " + TARGET,
                "sign the resulting walk record with the contractor's agreement key (" + B_KEY_URL + ")",
                "serve the signed record content-addressed at https://" + B_DOMAIN + "/record/{sha256}",
                "file it at the principal's intake, POST https://ledger.horizonshield.dev/witness",
            ],
        },
    }
    grant = {
        "authorized_actions": ["read", "observe", "emit_witness"],
        "prohibited_actions": ["payment", "delete", "redelegate", "send_pii"],
        "conditional": [],
        "delegation": {"allowed": []},
        "data_access": ["public_endpoint"],
        "max_hops": 1,
        "privacy": "public_record",
        "revocation": {"effective_at": "anchor"},
        "finality": {"depth": 6, "max_target_bits": "17080000"},
        "expiry_height": EXPIRY_HEIGHT,
        "witnesses": [],
    }
    establishes = [
        "that both parties signed these grant bytes at the stated time",
        "that the contractor named, by sha256 of these bytes, exactly which actions it is authorized to perform on the principal's a2a endpoint and which it is prohibited from",
        "that any execution, walk record, settlement or delegation claiming these terms must carry contract_sha256 of these bytes, or it does not claim them",
    ]
    does_not_establish = [
        "that HS enforced any of this at runtime; the grant is proved against the records afterwards, never imposed during the walk",
        "that the contractor obeyed the grant, only that its recorded acts match or deviate from it under a2a-settlement-v1.6",
        "that HS judges liability or fault; the verdict is a function anyone recomputes from the contract, the records and the headers",
        "that a prohibited action was impossible, only that performing one is a provable deviation",
        "that this is a legal contract or determines legal responsibility",
        "that money moved or is owed; consideration is none and there is no bond",
        "that the walk result the contractor publishes is correct, only that it is the record the contractor signed",
        "that either party's key was not stolen",
    ]
    rec = v0.build_contract(
        {"domain": A_DOMAIN, "key_url": A_KEY_URL, "public_key_ed25519_b64": A_PUB, "agent_card": A_CARD, "agent_card_sha256": A_CARD_SHA},
        {"domain": B_DOMAIN, "key_url": B_KEY_URL, "public_key_ed25519_b64": B_PUB, "agent_card": B_CARD, "agent_card_sha256": B_CARD_SHA},
        task, grant, establishes, does_not_establish,
        liability_boundary=[
            "contractor: the signed walk record, its content-addressed serving at /record, and its filing at the intake",
            "principal: the intake, the ledger entry, the anchor, and the a2a endpoint being walked",
        ],
        requirements={"evidence": "nenrin_required", "recovery": "n/a"},
        selection_provenance={"basis": "first outside witness of the gate and countersigner of a2a-agreement-v1.1 record 3eb0a7b1",
                              "record": AGREEMENT_RECORD},
        bond=None, parent_contract=None, expiry=None,
        lower_bound={"kind": "bitcoin_block", "height": LB_HEIGHT, "hash": LB_HASH},
    )
    rec["settlement"] = {"layer": v16.SETTLE_SCHEMA, "spine": spine.SPINE_SCHEMA,
                         "note": "settle under a2a-settlement-v1.6 or later: records and approvals bound by contract_sha256, grant key door, delegation narrowed on every axis (Issue #25)"}
    return rec


def prove_terms(rec):
    """Sign a COPY with throwaway keys pinned in place of the real ones, and show the terms settle under v1.6.
    Nothing here touches a real key; the copy is discarded."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    def nk():
        k = Ed25519PrivateKey.generate()
        return k, base64.b64encode(k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
    ka, pa = nk(); kb, pb = nk()
    c = json.loads(json.dumps(rec))
    c["parties"][0]["public_key_ed25519_b64"] = pa
    c["parties"][1]["public_key_ed25519_b64"] = pb
    v0.sign_contract(c, ka, pa, A_DOMAIN); v0.sign_contract(c, kb, pb, B_DOMAIN)
    vc = v0.verify_contract(c)
    terms = v16.check_terms_v1_6(c)
    sp = spine.spine_verify(c)
    return vc, terms, sp


def main():
    rec = build()
    text = canonical(rec)
    csha = contract_sha256(rec)
    out = os.path.join(MUSUBI, "first_contract_unsigned.json")
    io.open(out, "w", encoding="utf-8", newline="").write(text)
    print("unsigned canonical contract written: " + os.path.relpath(out, ROOT))
    print("bytes %d  sha256(file) %s" % (len(text.encode("utf-8")), hashlib.sha256(text.encode("utf-8")).hexdigest()))
    print("contract_sha256 (the binding sha, identical before and after either signature): " + csha)
    print("contract_id " + rec["contract_id"] + "  agreed_at " + rec["agreed_at"] + "  checkpoint " + str(LB_HEIGHT) + "  expiry_height " + str(EXPIRY_HEIGHT))

    vc = v0.verify_contract(rec)
    print("\nverify_contract on the unsigned record: %s (expected refused, one_sided x2 only): %s" % (
        vc["verdict"], sorted({r["code"] for r in vc["refusals"]})))
    vc2, terms, sp = prove_terms(rec)
    print("terms, proved on a throwaway-key copy: verify %s, findings %s, v1.6 check_terms problems %s, spine %s" % (
        vc2["verdict"], [f["code"] for f in vc2["findings"]], terms, sp["spine"]))
    print("")
    print("next, HS's own hand (the signer refuses unless the pinned key is the key you sign with):")
    print("  python3 workers/hs-ledger/nenrin/musubi-v0/contract_v0.py --sign workers/hs-ledger/nenrin/musubi-v0/first_contract_unsigned.json --key ~/.hs_agreement_key.pem --domain horizonshield.dev --out workers/hs-ledger/nenrin/musubi-v0/first_contract_A.json")
    print("then commit first_contract_A.json and hand the contractor the raw URL at that commit plus its sha256; he runs the same --sign as api.babyblueviper.com")
    return 0


if __name__ == "__main__":
    sys.exit(main())
