#!/usr/bin/env python3
"""
ops/agreement_first_record_finalize.py

Fills the last fields of the first a2a-agreement-v1.1 record (section 5 of
ops/agreement_first_record_federico_20260910.md) from the values the other person hands over,
and writes the UNSIGNED canonical record. It signs nothing, fetches nothing, and never touches
a private key. Standard library only, Python 3.8+.

Why this exists: the template has four TODOs (agreement_id, agreed_at, the counterparty's
public key, and a fresh lower_bound). Filling them by hand is where the last two mistakes
came from (a trailing space changes the sha; a hand typed key is unverifiable). This script
fills them, canonicalises exactly as the verifier does, and prints the signing commands.

    python3 ops/agreement_first_record_finalize.py \
        --b-pubkey  '<Federico's public_key_ed25519_b64>' \
        --b-key-url 'https://api.babyblueviper.com/keys/agreement.json' \
        --lb-height 967000 --lb-hash 0000...64hex \
        [--a-conduct-sha <64hex>]   (only if party B was re-walked after he declared the extension)
        [--b-conduct-sha <64hex> --b-conduct-url <https url>]   (only if he serves his own record of the gate)
        [--a-card-sha <64hex> --b-card-sha <64hex>]   (from the same prep run; his card sha changes the moment he edits his card)

Output: ops/first_record_prep_out/first_record_unsigned.json (canonical bytes, no signatures)
plus the sha256 of those bytes and the exact next commands.
"""
import argparse, json, re, secrets, sys, time, io, os

A_PUB_DEFAULT = "Q8DJu/tXWNNzsrmIkIUm4r2cR4MYaXNf1E2j+oZi+oo="     # gate 0.4.7, /keys/agreement.json
A_CARD_SHA = "f36353620147490a954f39862346d37bf7bbf48868a7b9fb5c69f61e16a90d6d"
B_CARD_SHA = "d8013f58216c5400108365656eaa7c32fad59985bff1a048bd1bd2a89b3e175d"
A_CONDUCT_SHA_DEFAULT = "9e058efa16789bb1911eb237a160f7c3bcebc520ba3ee4d74f6d469d02648eb8"   # HS walked api.babyblueviper.com, FAIL 3/5, ledger entry 41
B_CONDUCT_SHA_DEFAULT = "da9289a1117598658d171ca89de03028ca497e54cfe9ad75aaad2f0075d7adff"   # Federico's witness of mcp.horizonshield.dev
LEDGER = "https://ledger.horizonshield.dev"
HEX64 = re.compile(r"^[0-9a-f]{64}$")
B64_32 = re.compile(r"^[A-Za-z0-9+/]{43}=$")


def canonical(obj):
    # conduct-v1 section 4: UTF-8, keys sorted at every level, separators , and :, non-ASCII unescaped.
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def die(msg):
    print("refused: " + msg, file=sys.stderr)
    sys.exit(2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--b-pubkey", required=True, help="Federico's Ed25519 public key, canonical base64 (44 chars)")
    ap.add_argument("--b-key-url", default="https://api.babyblueviper.com/keys/agreement.json", help="https URL under babyblueviper.com serving that key")
    ap.add_argument("--lb-height", type=int, required=True, help="Bitcoin block height for lower_bound (from a fresh header sync)")
    ap.add_argument("--lb-hash", required=True, help="that block's hash, 64 lowercase hex")
    ap.add_argument("--a-card-sha", default=A_CARD_SHA, help="sha256 of the exact bytes of mcp.horizonshield.dev's card (prep script step 4); default is the 2026-09-11 value")
    ap.add_argument("--b-card-sha", default=B_CARD_SHA, help="sha256 of the exact bytes of api.babyblueviper.com's card (prep script step 4); it CHANGES if he edits his card, so take it from the same prep run as the walk")
    ap.add_argument("--a-conduct-sha", default=A_CONDUCT_SHA_DEFAULT, help="sha256 of HS's walk of api.babyblueviper.com (re-walk only if he declared the extension)")
    ap.add_argument("--b-conduct-sha", default=B_CONDUCT_SHA_DEFAULT, help="sha256 of his record of mcp.horizonshield.dev")
    ap.add_argument("--b-conduct-url", default=None, help="where that record is served; default is the HS ledger witness URL for that sha")
    ap.add_argument("--b-measured-by", default="babyblueviper.com", help="measured_by_domain for party B's pinned record")
    ap.add_argument("--a-pubkey", default=A_PUB_DEFAULT, help=argparse.SUPPRESS)   # test only: never change for the real record
    ap.add_argument("--agreed-at", default=None, help=argparse.SUPPRESS)           # test only
    ap.add_argument("--agreement-id", default=None, help=argparse.SUPPRESS)        # test only
    ap.add_argument("--out", default=None, help="output path (default ops/first_record_prep_out/first_record_unsigned.json)")
    a = ap.parse_args()

    if not B64_32.match(a.b_pubkey): die("--b-pubkey is not a 32 byte key in canonical base64 (expected 43 chars and one =)")
    from urllib.parse import urlparse
    ku = urlparse(a.b_key_url)
    if ku.scheme != "https" or not (ku.hostname == "babyblueviper.com" or (ku.hostname or "").endswith(".babyblueviper.com")):
        die("--b-key-url must be https and its host must be babyblueviper.com or a host under it")
    if not HEX64.match(a.lb_hash): die("--lb-hash must be 64 lowercase hex")
    if a.lb_height <= 966384: die("--lb-height must be newer than the 2026-09-11 block 966384; re-sync headers first")
    for k, v in (("--a-conduct-sha", a.a_conduct_sha), ("--b-conduct-sha", a.b_conduct_sha), ("--a-card-sha", a.a_card_sha), ("--b-card-sha", a.b_card_sha)):
        if not HEX64.match(v): die(k + " must be 64 lowercase hex")
    b_conduct_url = a.b_conduct_url or (LEDGER + "/witness/" + a.b_conduct_sha)
    if not b_conduct_url.startswith("https://"): die("--b-conduct-url must be https")

    agreement_id = a.agreement_id or secrets.token_hex(16)
    agreed_at = a.agreed_at or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    if not re.match(r"^[0-9a-f]{32}$", agreement_id): die("agreement_id must be 32 lowercase hex")

    record = {
        "schema": "a2a-agreement-v1.1",
        "agreement_id": agreement_id,
        "agreed_at": agreed_at,
        "lower_bound": {"kind": "bitcoin_block", "height": a.lb_height, "hash": a.lb_hash},
        "parties": [
            {
                "domain": "horizonshield.dev",
                "key_url": "https://gate.horizonshield.dev/keys/agreement.json",
                "public_key_ed25519_b64": a.a_pubkey,
                "agent_card": "https://mcp.horizonshield.dev/.well-known/agent-card.json",
                "agent_card_sha256": a.a_card_sha,
                "conduct_record": {
                    "sha256": a.a_conduct_sha,
                    "url": LEDGER + "/witness/" + a.a_conduct_sha,
                    "subject_domain": "api.babyblueviper.com",
                    "measured_by_domain": "horizonshield.dev",
                    "self_measured": True,
                },
                "role": "peer",
            },
            {
                "domain": "babyblueviper.com",
                "key_url": a.b_key_url,
                "public_key_ed25519_b64": a.b_pubkey,
                "agent_card": "https://api.babyblueviper.com/.well-known/agent-card.json",
                "agent_card_sha256": a.b_card_sha,
                "conduct_record": {
                    "sha256": a.b_conduct_sha,
                    "url": b_conduct_url,
                    "subject_domain": "mcp.horizonshield.dev",
                    "measured_by_domain": a.b_measured_by,
                    "self_measured": True,
                },
                "role": "peer",
            },
        ],
        "terms": {
            "what": "that two independent implementations of the NENRIN ring builder, one in Python and one in Node.js, reproduced the same eight 2026-08 rings byte for byte, as recorded in JIDEC entry 34",
            "consideration": "none",
            "disclosure_url": LEDGER + "/ledger/34",
        },
        "recorder": {"domain": "horizonshield.dev", "is_a_party": True, "fee": {"basis": "none"}},
        "record_paid_by": "neither",
        "establishes": [
            "that both parties signed these bytes at the stated time",
            "that each party named the counterparty's conduct record by sha256 at that moment",
            "that both of them stood behind the entry 34 result on the date they signed",
        ],
        "does_not_establish": [
            "that either party performed any work under this record",
            "that this record is a contract",
            "that money moved, or was ever owed",
            "that the conduct record each side pinned is accurate",
            "that the entry 34 result is correct, only that both parties say they stand behind it",
            "that either implementation is free of defects",
        ],
        "signatures": [],
    }

    text = canonical(record)
    import hashlib
    sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
    out = a.out or os.path.join(os.path.dirname(os.path.abspath(__file__)), "first_record_prep_out", "first_record_unsigned.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    io.open(out, "w", encoding="utf-8", newline="").write(text)

    print("unsigned canonical record written: " + out)
    print("bytes " + str(len(text.encode("utf-8"))) + "  sha256(unsigned) " + sha)
    print("agreement_id " + agreement_id + "  agreed_at " + agreed_at + "  lower_bound " + str(a.lb_height))
    print("")
    print("next, in order (V = workers/hs-ledger/nenrin/agreement-v0):")
    print("  1. sign as party A (your key never leaves the Mac):")
    print("     python3 $V/agreement_sign.py " + out + " --key ~/.hs_agreement_key.pem --domain horizonshield.dev --out ops/first_record_prep_out/first_record_A.json")
    print("  2. send first_record_A.json to Federico, byte for byte (attach the file, do not paste it), with:")
    print("     python3 agreement_sign.py first_record_A.json --key <his.pem> --domain babyblueviper.com --out first_record_AB.json")
    print("  3. when first_record_AB.json comes back, verify offline with both keys, then file:")
    print("     python3 $V/agreement_verify.py first_record_AB.json --keys keys.json      # expect accepted, findings: conduct_self_measured x2, operator_is_a_party")
    print("     curl -sS -X POST https://agreement.horizonshield.dev/agreement -H 'content-type: application/json' --data-binary @first_record_AB.json")
    print("     the intake answers 201 with the same sha as canonical_sha256; the 00:45 UTC batch appends it to the ledger; the stamp run anchors it")
    return 0


if __name__ == "__main__":
    sys.exit(main())
