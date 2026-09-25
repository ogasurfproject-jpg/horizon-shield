#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ops/prep_federico_contract.py  (番人 2026-09-24)

Builds the FIRST live MUSUBI a2a-contract-v0 between HORIZON SHIELD (principal) and
Federico / api.babyblueviper.com (contractor), fills it with live values, writes the UNSIGNED
canonical record, and prints the single command to sign as party A. It signs nothing and never
touches a private key.

Run this in YOUR OWN terminal (it needs the network). Then run the printed --sign command.

Proposed task (adjust with Federico before signing if you both prefer another scope):
  HS engages Federico to independently conduct-walk gate.horizonshield.dev/a2a under a scoped
  grant: read / observe / emit_witness ALLOWED; payment / delete / redelegate / send_pii
  PROHIBITED; evidence via NENRIN required. This formalises the witnessing you two already do
  into a signed, settle-able contract. Change task/grant here if you agree on a different scope.
"""
import json, hashlib, sys, os, time, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
OUT_DIR = os.path.join(HERE, "federico_contract_prep_out")
OUT = os.path.join(OUT_DIR, "contract_unsigned.json")

# known-good HS side (same agreement key as the 2nd agreement)
HS_DOMAIN   = "horizonshield.dev"
HS_KEY_URL  = "https://gate.horizonshield.dev/keys/agreement.json"
HS_PUBKEY   = "Q8DJu/tXWNNzsrmIkIUm4r2cR4MYaXNf1E2j+oZi+oo="
HS_CARD     = "https://gate.horizonshield.dev/.well-known/agent-card.json"
HS_CARD_SHA = "769df24571c1a0323f6c70cde07fc35854a90010789fb32f24e8c63434dcff5f"

FED_DOMAIN  = "api.babyblueviper.com"
FED_KEY_URL = "https://api.babyblueviper.com/keys/agreement.json"
FED_PUBKEY  = "poTpqz0G34FMkZ1okV/fd5Dcvq7mCO4v1+qOgqBsje4="
FED_CARD    = "https://api.babyblueviper.com/.well-known/agent-card.json"

TASK_TEXT = ("HORIZON SHIELD (principal) engages api.babyblueviper.com (contractor) to conduct-walk "
             "gate.horizonshield.dev/a2a and file a witness record, under the grant in this contract.")

UA = {"User-Agent": "hs-musubi-prep/1"}


def die(m):
    print("\n  refused: " + m, file=sys.stderr); sys.exit(2)


def get(url, accept=None, timeout=20):
    h = dict(UA)
    if accept:
        h["Accept"] = accept
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
        return r.status, r.read()


def get_text(url):
    try:
        st, b = get(url); return st, b.decode("utf-8", "replace").strip()
    except Exception as e:
        return None, str(e)


def bitcoin_tip():
    for base in ("https://blockstream.info/api", "https://mempool.space/api"):
        sh, height = get_text(base + "/blocks/tip/height")
        sx, bhash = get_text(base + "/blocks/tip/hash")
        if sh == 200 and sx == 200 and height.isdigit() and len(bhash) == 64:
            try:
                int(bhash, 16)
            except ValueError:
                continue
            print("  bitcoin tip: height %s hash %s (via %s)" % (height, bhash, base))
            return int(height), bhash.lower()
    die("could not fetch a Bitcoin tip")


def card_sha(url):
    st, b = get(url, accept="application/json")
    if st != 200:
        die("%s returned HTTP %s" % (url, st))
    return hashlib.sha256(b).hexdigest(), len(b)


def canonical(o):
    return json.dumps(o, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def main():
    print("== prep first MUSUBI contract (HS principal, Federico contractor) ==")
    os.makedirs(OUT_DIR, exist_ok=True)
    height, bhash = bitcoin_tip()

    fed_sha, fb = card_sha(FED_CARD)
    print("  Federico card: %s (%d bytes) LIVE" % (fed_sha, fb))
    hs_sha, hb = card_sha(HS_CARD)
    print("  HS card:       %s (%d bytes) LIVE" % (hs_sha, hb))
    if hs_sha != HS_CARD_SHA:
        die("gate card sha changed to %s (expected %s); re-run compose" % (hs_sha, HS_CARD_SHA))

    import secrets
    payload_digest = hashlib.sha256(TASK_TEXT.encode("utf-8")).hexdigest()

    rec = {
        "schema": "a2a-contract-v0",
        "contract_id": secrets.token_hex(16),
        "nonce": secrets.token_hex(16),
        "agreed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "expiry": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 30 * 86400)),
        "lower_bound": {"kind": "bitcoin_block", "height": height, "hash": bhash},
        "parent_contract": None,
        "parties": [
            {"role": "principal", "domain": HS_DOMAIN, "key_url": HS_KEY_URL,
             "public_key_ed25519_b64": HS_PUBKEY, "agent_card": HS_CARD, "agent_card_sha256": HS_CARD_SHA},
            {"role": "contractor", "domain": FED_DOMAIN, "key_url": FED_KEY_URL,
             "public_key_ed25519_b64": FED_PUBKEY, "agent_card": FED_CARD, "agent_card_sha256": fed_sha},
        ],
        "task": {"purpose": "conduct_walk_witness", "payload_digest": payload_digest, "a2a_task_id": None,
                 "description": TASK_TEXT, "subject": "gate.horizonshield.dev/a2a"},
        "grant": {
            "authorized_actions": ["read", "observe", "emit_witness"],
            "prohibited_actions": ["payment", "delete", "redelegate", "send_pii"],
            "conditional": [],
            "delegation": {"allowed": []},
            "data_access": ["public_endpoint"],
            "max_hops": 1,
            "privacy": "no_external_retention",
        },
        "bond": None,
        "liability_boundary": [
            "contractor: the witness record it files, and that its walk stayed within the grant",
            "principal: any use it makes of that witness record",
        ],
        "requirements": {"evidence": "nenrin_required", "recovery": "tsugi_required"},
        "selection_provenance": None,
        "establishes": [
            "that both parties signed this grant at the stated time",
            "that each party named the grant it accepted for this task",
        ],
        "does_not_establish": [
            "that HS enforced any of this at runtime",
            "that the contractor obeyed the grant, only that its recorded acts match or deviate from it",
            "that HS judges liability or fault; the settlement verdict is a function anyone recomputes",
            "that a prohibited action was impossible, only that performing one is a provable deviation",
            "that this is a legal contract or determines legal responsibility",
        ],
        "signatures": [],
    }

    text = canonical(rec)
    sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
    with open(OUT, "w", encoding="utf-8", newline="") as f:
        f.write(text)

    print("")
    print("  wrote unsigned contract: " + OUT)
    print("  bytes %d  sha256(unsigned) %s" % (len(text.encode("utf-8")), sha))
    print("  Federico card_sha256 pinned: %s" % fed_sha)
    print("")
    print("  next -- sign as party A (principal, HS). Your key never leaves the Mac:")
    print("    python3 workers/hs-ledger/nenrin/musubi-v0/contract_v0.py \\")
    print("      --sign %s \\" % os.path.relpath(OUT, ROOT))
    print("      --key ~/.hs_agreement_key.pem --domain horizonshield.dev \\")
    print("      --out ops/federico_contract_prep_out/contract_A.json")
    print("")
    print("  then send contract_A.json to Federico (attach the file). He confirms his card sha,")
    print("  signs as contractor with:")
    print("    python3 contract_v0.py --sign contract_A.json --key <his agreement key>.pem \\")
    print("      --domain api.babyblueviper.com --out contract_AB.json")
    print("  and sends contract_AB.json back. Then verify both signatures:")
    print("    python3 workers/hs-ledger/nenrin/musubi-v0/contract_v0.py --verify ops/federico_contract_prep_out/contract_AB.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
