#!/usr/bin/env python3
"""Adversary for the agreement record, both schemas, and its verifier. Offline, deterministic,
real Ed25519 keys from fixed seeds, no network, no ledger, no clock.
Run: python3 agreement_redteam.py

Every vector is a refusal, a separation, or a control that must NOT refuse. Nothing here scores
anybody. A vector that only proves the verifier says yes to a good record is worth as much as one
that proves it says no to a bad one, so both are counted, in their own columns.
"""
# RUN_ALL: suite

import copy
import json
import os
import re
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import agreement_verify as V
import agreement_sign as S

HERE = os.path.dirname(os.path.abspath(__file__))
MUTATION_BACKUP = os.path.join(HERE, ".agreement_verify.py.mutation_backup")


def mutation_in_progress(backup=MUTATION_BACKUP, env=None):
    """True when agreement_mutation.py may have a mutant applied to the verifier right now.

    The backup file exists only between the first mutation and the final restore, so its presence
    means either a run is in flight or one died. Reading the verifier then measures nothing. The
    mutation tool itself sets AGREEMENT_MUTATION_RUN, because it is supposed to run this file
    against a mutated verifier; nobody else is.

    Written on 2026-09-10 after the operator ran this suite in the same directory as a mutation
    run in flight, watched one vector go red, and spent the next minutes hunting a defect that
    was not there. A red result from a file somebody else is editing is not a result.
    """
    e = os.environ if env is None else env
    if e.get("AGREEMENT_MUTATION_RUN") == "1":
        return False
    return os.path.exists(backup)


if mutation_in_progress():
    sys.stderr.write(
        "REFUSING TO RUN: " + os.path.basename(MUTATION_BACKUP) + " is present, so agreement_verify.py\n"
        "may have a mutant applied to it right now by agreement_mutation.py, or a run died and left one.\n"
        "Wait for that run to finish, or run agreement_mutation.py once to recover the file.\n"
        "Anything this suite printed in that state would be a measurement of somebody else's edit.\n")
    raise SystemExit(2)

R = []


def case(kind, name, ok, detail=""):
    R.append((kind, name, bool(ok), str(detail)))


def codes(rep):
    return [x["code"] for x in rep["refusals"]]


def finds(rep):
    return [x["code"] for x in rep["findings"]]


# --- keys: fixed seeds, so two people running this file reach the same bytes -----------------

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

import base64


def keypair(seed_byte):
    k = Ed25519PrivateKey.from_private_bytes(bytes([seed_byte]) * 32)
    pub = k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return k, base64.b64encode(pub).decode("ascii")


KA, PA = keypair(0x11)
KB, PB = keypair(0x22)
KC, PC = keypair(0x33)   # a third party nobody invited
KX, PX = keypair(0x44)   # an attacker holding a key served somewhere else

URL_A = "https://party-a.example/keys/agreement.json"
URL_B = "https://party-b.example/keys/agreement.json"
URL_C = "https://party-c.example/keys/agreement.json"
URL_X = "https://attacker.example/keys/agreement.json"

KEYS = {URL_A: PA, URL_B: PB, URL_C: PC, URL_X: PX}


def party(dom, role, sha, url=None):
    return {
        "domain": dom,
        "key_url": url or ("https://%s/keys/agreement.json" % dom),
        "agent_card": "https://%s/.well-known/agent-card.json" % dom,
        "conduct_record_sha256": sha,
        "conduct_record_url": "https://gate.horizonshield.dev/record/" + sha,
        "role": role,
    }


SHA_A = "a" * 64
SHA_B = "b" * 64


def good():
    return {
        "schema": "a2a-agreement-v1",
        "agreed_at": "2026-09-10T00:00:00Z",
        "parties": [party("party-a.example", "payer", SHA_A), party("party-b.example", "payee", SHA_B)],
        "terms": {"what": "one audit of one estimate", "who_pays_whom": "party-a.example pays party-b.example",
                  "amount": 10000, "currency": "JPY", "disclosure_url": "https://party-b.example/pricing"},
        "record_paid_by": "both",
        "recorder_fee": {"basis": "per_record", "amount": 0, "currency": "JPY"},
        "establishes": ["that both parties signed these bytes at the stated time",
                        "that each party named the other's conduct record by sha256 at that moment"],
        "does_not_establish": ["that either party performed",
                               "that this record is a contract",
                               "that the terms are lawful, fair or complete"],
        "signatures": [],
    }


def signed(rec, pairs):
    """pairs: [(domain, key), ...] signed in the order given."""
    out = copy.deepcopy(rec)
    for dom, key in pairs:
        out, _msg = S.sign(out, key, dom)
    return out


BOTH = [("party-a.example", KA), ("party-b.example", KB)]

# --- control ---------------------------------------------------------------------------------

g = signed(good(), BOTH)
rep = V.verify(g, keys=KEYS)
case("control", "two parties, two keys each under its own domain, same bytes: accepted",
     rep["verdict"] == "accepted" and rep["signatures_checked"] is True, json.dumps(codes(rep)))
own = " ".join(rep["establishes"]).lower()
own_over = [w for pat, w in V.OVERCLAIM if re.search(pat, own)]
case("control", "the verifier's own establishes would pass its own overclaim guard",
     rep["verdict"] == "accepted" and any("signed" in s for s in rep["establishes"]) and own_over == [],
     ", ".join(own_over))
case("control", "an accepted report still carries does_not_establish, and it is not empty",
     len(rep["does_not_establish"]) >= 5, str(len(rep["does_not_establish"])))
rev = signed(good(), list(reversed(BOTH)))
case("control", "the two parties may sign in either order and both records are accepted",
     V.verify(rev, keys=KEYS)["verdict"] == "accepted"
     and V.signing_bytes(rev) == V.signing_bytes(g), "")
pretty = json.dumps(g, ensure_ascii=False, indent=2)
rp = V.verify(V.parse_strict(pretty), keys=KEYS, input_text=pretty)
case("control", "reformatted bytes still verify, and the report names the canonical sha beside the input sha",
     rp["verdict"] == "accepted" and rp["input_is_canonical"] is False
     and "not_canonical" in finds(rp) and rp["canonical_sha256"] != rp["input_sha256"], "")
ex = V.EXAMPLE_V1
case("control", "the v1 example record handed to newcomers is correct in every way except that nobody has signed it",
     codes(V.verify(copy.deepcopy(ex))) == ["one_sided"], json.dumps(codes(V.verify(copy.deepcopy(ex)))))

# --- fail closed ------------------------------------------------------------------------------

nok = V.verify(g, keys=None)
case("attack", "with no keys supplied the same good record is incomplete, never accepted",
     nok["verdict"] == "incomplete" and nok["signatures_checked"] is False, nok["verdict"])
case("attack", "an incomplete report says in its own establishes that nothing was checked",
     any("no signature was checked" in s for s in nok["establishes"]), "")

# --- one sided --------------------------------------------------------------------------------

one = signed(good(), [("party-a.example", KA)])
case("attack", "one signature is not an agreement",
     "one_sided" in codes(V.verify(one, keys=KEYS)), json.dumps(codes(V.verify(one, keys=KEYS))))
none_ = good()
case("attack", "no signatures at all is one_sided, not a silent pass",
     "one_sided" in codes(V.verify(none_, keys=KEYS)), "")
twice = copy.deepcopy(one)
twice["signatures"].append(copy.deepcopy(twice["signatures"][0]))
case("attack", "one side signing twice is still one side",
     "one_sided" in codes(V.verify(twice, keys=KEYS)), json.dumps(codes(V.verify(twice, keys=KEYS))))
three = signed(good(), BOTH)
three["signatures"].append({"domain": "party-c.example", "alg": "ed25519", "signature": "x", "key_url": URL_C})
case("attack", "a third signature is refused rather than quietly ignored",
     "extra_signatures" in codes(V.verify(three, keys=KEYS)), json.dumps(codes(V.verify(three, keys=KEYS))))

# the hole the draft's section 4 does not close: two signatures that are not the two parties
imposter = copy.deepcopy(good())
imposter["signatures"] = []
imposter, _ = S.sign(imposter, KA, "party-a.example")
msg = V.signing_bytes(imposter)
imposter["signatures"].append({"domain": "party-c.example", "alg": "ed25519",
                               "signature": base64.b64encode(KC.sign(msg)).decode(), "key_url": URL_C})
ci = codes(V.verify(imposter, keys=KEYS))
case("attack", "two valid signatures that are not the two parties: signature_not_a_party (the draft names no code for this; it counts two and stops)",
     "signature_not_a_party" in ci, json.dumps(ci))

# --- the two signatures do not cover the same bytes ---------------------------------------------

split = copy.deepcopy(good())
split, _ = S.sign(split, KA, "party-a.example")          # A signs amount 10000
split["terms"]["amount"] = 1000000                       # somebody raises the price
split, _ = S.sign(split, KB, "party-b.example")          # B signs the new bytes
cs = codes(V.verify(split, keys=KEYS))
case("attack", "A signed one amount and B signed another: signatures_disagree",
     "signatures_disagree" in cs, json.dumps(cs))
forged = signed(good(), BOTH)
for s in forged["signatures"]:
    s["signature"] = base64.b64encode(b"\x00" * 64).decode()
cf = codes(V.verify(forged, keys=KEYS))
case("attack", "both signatures forged: signature_invalid, and never accepted",
     "signature_invalid" in cf and V.verify(forged, keys=KEYS)["verdict"] == "refused", json.dumps(cf))
tamper = signed(good(), BOTH)
tamper["terms"]["what"] = "one audit of one estimate, and a second one for free"
case("attack", "editing the terms after both signed invalidates both",
     "signature_invalid" in codes(V.verify(tamper, keys=KEYS)), json.dumps(codes(V.verify(tamper, keys=KEYS))))
addfield = signed(good(), BOTH)
addfield["upstream"] = {"protocol": "x402", "reference": "0xdead"}
case("attack", "adding a field after signing invalidates the signatures (signatures cover the whole record minus signatures)",
     "signature_invalid" in codes(V.verify(addfield, keys=KEYS)), "")

# --- self agreement -----------------------------------------------------------------------------

same = good()
same["parties"][1] = party("party-a.example", "payee", SHA_B)
case("attack", "both parties the same domain",
     "self_agreement" in codes(V.verify(same, keys=KEYS)), "")
sub = good()
sub["parties"][1] = party("agents.party-a.example", "payee", SHA_B)
case("attack", "a subdomain of the other party is the same party",
     "self_agreement" in codes(V.verify(sub, keys=KEYS)), "")
casey = good()
casey["parties"][1] = party("PARTY-A.EXAMPLE.", "payee", SHA_B)
casey["parties"][1]["key_url"] = URL_A
cy = codes(V.verify(casey, keys=KEYS))
case("attack", "upper case and a trailing dot do not make a second party",
     "self_agreement" in cy, json.dumps(cy))
sibling = good()
sibling["parties"] = [party("a.corp.example", "payer", SHA_A), party("b.corp.example", "payee", SHA_B)]
sib = V.verify(signed(sibling, [("a.corp.example", KA), ("b.corp.example", KB)]),
               keys={"https://a.corp.example/keys/agreement.json": PA,
                     "https://b.corp.example/keys/agreement.json": PB})
case("misclass", "two siblings under one parent are a finding, not a refusal, and the report says why (no public suffix list offline)",
     sib["verdict"] == "accepted" and "shared_parent_domain" in finds(sib), json.dumps(finds(sib)))

# --- key_url ---------------------------------------------------------------------------------

http = good()
http["parties"][0]["key_url"] = "http://party-a.example/keys/agreement.json"
case("attack", "a key_url that is not https",
     "bad_key_url" in codes(V.verify(http, keys=KEYS)), "")
elsewhere = good()
elsewhere["parties"][0]["key_url"] = URL_X
case("attack", "a key_url under somebody else's domain",
     "bad_key_url" in codes(V.verify(elsewhere, keys=KEYS)), "")
swap = signed(good(), BOTH)
swap["signatures"][0]["key_url"] = URL_X
cw = codes(V.verify(swap, keys=KEYS))
case("attack", "the key_url in the signature block is outside the signed bytes: swapping it is refused as key_url_not_pinned (the draft carries key_url in both places and does not say which binds)",
     "key_url_not_pinned" in cw, json.dumps(cw))
missing_key = V.verify(signed(good(), BOTH), keys={URL_A: PA})
case("misclass", "a key this verifier was not given is key_url_unreachable, not a bad signature, and the verdict is not accepted",
     "key_url_unreachable" in codes(missing_key) and missing_key["verdict"] != "accepted", json.dumps(codes(missing_key)))
wrongkey = V.verify(signed(good(), BOTH), keys={URL_A: PA, URL_B: PX})
case("attack", "a different key served where the party pinned one: the signature simply does not verify",
     "signatures_disagree" in codes(wrongkey) or "signature_invalid" in codes(wrongkey), json.dumps(codes(wrongkey)))

# --- conduct records ---------------------------------------------------------------------------

nosha = good()
nosha["parties"][0].pop("conduct_record_sha256")
case("attack", "a party that presented no conduct record",
     "missing_conduct_sha" in codes(V.verify(nosha, keys=KEYS)), "")
upper = good()
upper["parties"][0]["conduct_record_sha256"] = SHA_A.upper()
case("attack", "an upper case sha would compare unequal to the bytes it names",
     "bad_conduct_sha" in codes(V.verify(upper, keys=KEYS)), "")
sameref = good()
sameref["parties"][1]["conduct_record_sha256"] = SHA_A
sr = V.verify(signed(sameref, BOTH), keys=KEYS)
case("misclass", "both parties presenting the same conduct record is a finding, not a refusal",
     sr["verdict"] == "accepted" and "same_conduct_record" in finds(sr), json.dumps(finds(sr)))

# --- disclaimers -------------------------------------------------------------------------------

nod = good()
nod.pop("does_not_establish")
case("attack", "a record that does not say what it does not establish",
     "disclaimer_missing" in codes(V.verify(nod, keys=KEYS)), "")
empt = good()
empt["does_not_establish"] = []
case("attack", "an emptied does_not_establish is the same hole with the field still present",
     "disclaimer_missing" in codes(V.verify(empt, keys=KEYS)), "")
over = good()
over["establishes"] = over["establishes"] + ["that party-a paid party-b in full"]
co = codes(V.verify(over, keys=KEYS))
case("attack", "establishes may not claim a payment happened",
     "establishes_overclaims" in co, json.dumps(co))
over2 = good()
over2["establishes"] = ["that the parties formed a binding contract"]
case("attack", "establishes may not claim a contract was formed",
     "establishes_overclaims" in codes(V.verify(over2, keys=KEYS)), "")
over3 = good()
over3["establishes"] = ["that the terms are fair"]
case("attack", "establishes may not claim the terms are fair; nobody in this layer judges terms",
     "establishes_overclaims" in codes(V.verify(over3, keys=KEYS)), "")
notover = good()
notover["establishes"] = notover["establishes"] + ["that the record discloses who paid for this record"]
cno = V.verify(signed(notover, BOTH), keys=KEYS)
case("control", "saying who paid FOR THE RECORD is not a claim that the deal was paid: not a false positive",
     cno["verdict"] == "accepted", json.dumps(codes(cno)))
thin = good()
thin["does_not_establish"] = ["that anything else happened"]
tf = V.verify(signed(thin, BOTH), keys=KEYS)
case("misclass", "a thin disclaimer is a finding, not a refusal: the line between missing and weak is not the verifier's to move",
     tf["verdict"] == "accepted" and "disclaimer_thin" in finds(tf), json.dumps(finds(tf)))

# --- fee ---------------------------------------------------------------------------------------

pct = good()
pct["recorder_fee"] = {"basis": "percent_of_amount", "amount": 3, "currency": "JPY"}
case("attack", "a recorder paid a percentage of the deal is a recorder with an interest in the number",
     "fee_tied_to_outcome" in codes(V.verify(pct, keys=KEYS)), "")
succ = good()
succ["recorder_fee"] = {"basis": "success_fee", "amount": 1, "currency": "JPY"}
case("attack", "a success fee is the same interest under another name",
     "fee_tied_to_outcome" in codes(V.verify(succ, keys=KEYS)), "")
unknown = good()
unknown["recorder_fee"] = {"basis": "whatever_we_decide", "amount": 1, "currency": "JPY"}
case("attack", "an unnamed fee basis is refused rather than allowed through as not a percentage",
     "fee_tied_to_outcome" in codes(V.verify(unknown, keys=KEYS)), "")
nofee = good()
nofee.pop("recorder_fee")
case("control", "no recorder fee declared at all is fine; the field is optional",
     V.verify(signed(nofee, BOTH), keys=KEYS)["verdict"] == "accepted", "")

# --- numbers -----------------------------------------------------------------------------------

big = good()
big["terms"]["amount"] = 2 ** 53
case("attack", "an amount past 2^53 is rounded by the reader before any canonicalization runs",
     "unsafe_number" in codes(V.verify(big, keys=KEYS)), "")
flt = good()
flt["terms"]["amount"] = 10000.5
case("attack", "money as a float is refused inside terms, where the number is the deal",
     "unsafe_number" in codes(V.verify(flt, keys=KEYS)), json.dumps(codes(V.verify(flt, keys=KEYS))))
elsewhere_float = good()
elsewhere_float["observed_latency_seconds"] = 0.25
ef = V.verify(signed(elsewhere_float, BOTH), keys=KEYS)
case("misclass", "a double outside terms is disclosed as a finding, not refused: the two failures are not the same size",
     ef["verdict"] == "accepted" and "non_integer_number" in finds(ef), json.dumps(finds(ef)))
dup_text = '{"schema":"a2a-agreement-v1","terms":{"amount":100,"amount":1}}'
try:
    V.parse_strict(dup_text)
    dup_refused = False
except ValueError as e:
    dup_refused = "duplicate key" in str(e)
case("attack", "the same key twice in one object: a reader sees 100 and the canonical bytes carry 1",
     dup_refused, "")

# --- shape -------------------------------------------------------------------------------------

roles = good()
roles["parties"][1]["role"] = "payer"
case("attack", "two payers and no payee",
     "roles_inconsistent" in codes(V.verify(roles, keys=KEYS)), json.dumps(codes(V.verify(roles, keys=KEYS))))
mixed = good()
mixed["parties"][1]["role"] = "peer"
case("attack", "a payer paired with a peer says nothing about who pays whom",
     "roles_inconsistent" in codes(V.verify(mixed, keys=KEYS)), "")
peers = good()
peers["parties"][0]["role"] = "peer"
peers["parties"][1]["role"] = "peer"
case("control", "peer with peer is a shape this record allows",
     V.verify(signed(peers, BOTH), keys=KEYS)["verdict"] == "accepted", "")
nopaid = good()
nopaid.pop("record_paid_by")
case("attack", "a record that does not say who paid for it",
     "bad_record_paid_by" in codes(V.verify(nopaid, keys=KEYS)), "")
positional = good()
positional["record_paid_by"] = "party_a"
pf = V.verify(signed(positional, BOTH), keys=KEYS)
case("misclass", "record_paid_by naming a position rather than a domain is a finding: reorder the array and it reverses",
     pf["verdict"] == "accepted" and "paid_by_positional" in finds(pf), json.dumps(finds(pf)))
badtime = good()
badtime["agreed_at"] = "2026-09-10 00:00:00 JST"
case("attack", "an agreed_at that is not an ISO-8601 UTC instant",
     "bad_agreed_at" in codes(V.verify(badtime, keys=KEYS)), "")
future = V.verify(signed(good(), BOTH), keys=KEYS, now="2026-09-09T00:00:00Z")
case("misclass", "an agreed_at later than the reader's clock is a finding, not a refusal: it is a claim, and the anchor is what bounds it",
     future["verdict"] == "accepted" and "agreed_at_in_future" in finds(future), json.dumps(finds(future)))
port = good()
port["parties"][0]["domain"] = "party-a.example:8443"
case("attack", "a domain carrying a port is not a domain",
     "bad_domain" in codes(V.verify(port, keys=KEYS)), "")
onep = good()
onep["parties"] = [onep["parties"][0]]
case("attack", "one party",
     "not_two_parties" in codes(V.verify(onep, keys=KEYS)), "")
schema = good()
schema["schema"] = "a2a-agreement-v2"
case("attack", "a record announcing a schema this verifier does not implement",
     "bad_schema" in codes(V.verify(schema, keys=KEYS)), "")

# --- the operator -------------------------------------------------------------------------------

op = V.verify(signed(good(), BOTH), keys=KEYS, recorder_domain="party-b.example")
case("misclass", "the recorder being a party is disclosed, not refused: the draft permits it and never says so out loud",
     op["verdict"] == "accepted" and "operator_is_a_party" in finds(op), json.dumps(finds(op)))
noop = V.verify(signed(good(), BOTH), keys=KEYS, recorder_domain="gate.horizonshield.dev")
case("control", "a recorder that is not a party raises nothing",
     "operator_is_a_party" not in finds(noop), "")

# --- signer -------------------------------------------------------------------------------------

try:
    S.sign(copy.deepcopy(good()), KC, "party-c.example")
    refused_sign = False
except SystemExit:
    refused_sign = True
case("attack", "the signer refuses to sign a record you are not a party to, before any bytes leave your machine",
     refused_sign, "")
try:
    S.sign(signed(good(), [("party-a.example", KA)]), KA, "party-a.example")
    refused_twice = False
except SystemExit:
    refused_twice = True
case("attack", "the signer refuses to sign twice as the same party", refused_twice, "")
sig_ku = signed(good(), BOTH)["signatures"][0]["key_url"]
case("control", "the signer takes key_url from the party entry inside the signed bytes, never from a flag",
     sig_ku == URL_A, sig_ku)

# --- exit codes and the CLI -----------------------------------------------------------------------

tmpd = tempfile.mkdtemp()
gp = os.path.join(tmpd, "good.json")
open(gp, "w", encoding="utf-8").write(V.canonical(signed(good(), BOTH)))
kp = os.path.join(tmpd, "keys.json")
open(kp, "w", encoding="utf-8").write(json.dumps(KEYS))
bp = os.path.join(tmpd, "bad.json")
open(bp, "w", encoding="utf-8").write(V.canonical(one))
dp = os.path.join(tmpd, "dup.json")
open(dp, "w", encoding="utf-8").write(dup_text)


def run(argv):
    import io
    from contextlib import redirect_stdout
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = V.main(argv)
    return rc, buf.getvalue()


rc_ok, _ = run([gp, "--keys", kp, "--quiet"])
rc_inc, _ = run([gp, "--quiet"])
rc_bad, _ = run([bp, "--keys", kp, "--quiet"])
rc_dup, out_dup = run([dp, "--keys", kp])
case("control", "exit codes separate the three answers: 0 accepted, 2 incomplete, 1 refused",
     (rc_ok, rc_inc, rc_bad) == (0, 2, 1), str((rc_ok, rc_inc, rc_bad)))
case("attack", "a duplicate key is refused at the door with its own code, before any field is read",
     rc_dup == 1 and "duplicate_json_key" in out_dup, str(rc_dup))

# --- property over every vector built above ---------------------------------------------------

alls = [g, one, none_, twice, three, imposter, split, forged, tamper, addfield, same, sub, casey,
        http, elsewhere, swap, nosha, upper, sameref, nod, empt, over, over2, over3, thin, pct,
        succ, unknown, big, flt, roles, mixed, nopaid, badtime, port, onep, schema]
bad_accept = [i for i, rec in enumerate(alls) if V.verify(rec, keys=None)["verdict"] == "accepted"]
case("control", "no record anywhere in this file is accepted without keys",
     bad_accept == [], str(bad_accept))
leak = [i for i, rec in enumerate(alls)
        if V.verify(rec, keys=KEYS)["verdict"] == "accepted" and V.verify(rec, keys=KEYS)["refusals"]]
case("control", "no report is both accepted and carrying a refusal", leak == [], str(leak))

# =================================================================================================
# a2a-agreement-v1.1: every hole above, closed. ops/AGREEMENT_EXT_v0_1_DRAFT.md
# =================================================================================================

import hashlib

V11 = "a2a-agreement-v1.1"
GATE = "gate.example"          # a measurer that is neither party


def p11(dom, role, pub, sha, other, measured_by=GATE, self_measured=None):
    cr = {"sha256": sha, "url": "https://%s/record/%s" % (GATE, sha),
          "subject_domain": other, "measured_by_domain": measured_by}
    if self_measured is not None:
        cr["self_measured"] = self_measured
    return {
        "domain": dom,
        "key_url": "https://%s/keys/agreement.json" % dom,
        "public_key_ed25519_b64": pub,
        "agent_card": "https://%s/.well-known/agent-card.json" % dom,
        "agent_card_sha256": hashlib.sha256(dom.encode()).hexdigest(),
        "conduct_record": cr,
        "role": role,
    }


def good11():
    return {
        "schema": V11,
        "agreement_id": "00112233445566778899aabbccddeeff",
        "agreed_at": "2026-09-10T00:00:00Z",
        "parties": [p11("party-a.example", "payer", PA, SHA_A, "party-b.example"),
                    p11("party-b.example", "payee", PB, SHA_B, "party-a.example")],
        "terms": {"what": "one audit of one estimate", "consideration": "money",
                  "who_pays_whom": {"from": "party-a.example", "to": "party-b.example"},
                  "amount_minor_units": 10000, "minor_unit_scale": 0, "currency": "JPY",
                  "disclosure_url": "https://party-b.example/pricing"},
        "recorder": {"domain": "recorder.example", "is_a_party": False,
                     "fee": {"basis": "per_record", "amount_minor_units": 0, "currency": "JPY"}},
        "record_paid_by": "both",
        "establishes": ["that both parties signed these bytes at the stated time",
                        "that each party named the counterparty's conduct record by sha256 at that moment"],
        "does_not_establish": ["that either party performed",
                               "that this record is a contract",
                               "that money moved",
                               "that the conduct record each side pinned is accurate",
                               "that the terms are lawful or complete"],
        "signatures": [],
    }


V11_KEYS = {URL_A: PA, URL_B: PB}
ATTACKS_11 = []


def bad11(rec):
    ATTACKS_11.append(rec)
    return rec


g11 = signed(good11(), BOTH)

# --- v1.1 control ---------------------------------------------------------------------------

r11 = V.verify(g11)
case("control", "v1.1: accepted with NO key file at all, because the keys are inside the signed bytes",
     r11["verdict"] == "accepted" and r11["signatures_checked"] is True, json.dumps(codes(r11)))
case("control", "v1.1: with no key file, key_urls_checked is false and the report says no URL was fetched",
     r11["key_urls_checked"] is False and any("no URL was fetched" in s for s in r11["does_not_establish"]), "")
r11k = V.verify(g11, keys=V11_KEYS)
case("control", "v1.1: with a matching key file the domain binding is claimed, and only then",
     r11k["key_urls_checked"] is True and any("attributable to the domain" in s for s in r11k["establishes"]), "")
case("control", "v1.1: either signing order, same bytes, both accepted",
     V.verify(signed(good11(), list(reversed(BOTH))))["verdict"] == "accepted", "")
def nomoney11():
    """The shape the first real record takes: two peers agreeing about a fact, owing nothing."""
    rec = good11()
    rec["parties"][0]["role"] = "peer"
    rec["parties"][1]["role"] = "peer"
    rec["terms"] = {"what": "that both implementations reproduced the same eight rings byte for byte",
                    "consideration": "none",
                    "disclosure_url": "https://party-b.example/method"}
    return rec


peers11 = nomoney11()
rnm = V.verify(signed(nomoney11(), BOTH))
case("control", "v1.1: two peers agreeing about a fact, with no price at all, is a shape v1.1 allows and states",
     rnm["verdict"] == "accepted", json.dumps(codes(rnm)))
nocons = nomoney11()
nocons["terms"].pop("consideration")
case("attack", "v1.1: leaving the price out is not the same as saying there is none; a reader must not have to infer it from missing keys",
     "bad_consideration" in codes(V.verify(bad11(nocons))), json.dumps(codes(V.verify(nocons))))
bothways = nomoney11()
bothways["terms"]["currency"] = "JPY"
case("attack", "v1.1: consideration none while still carrying a currency says two things at once",
     "terms_contradict_roles" in codes(V.verify(bad11(bothways))), json.dumps(codes(V.verify(bothways))))
moneypeers = good11()
moneypeers["parties"][0]["role"] = "peer"
moneypeers["parties"][1]["role"] = "peer"
case("attack", "v1.1: consideration money with nobody named as payer",
     "terms_contradict_roles" in codes(V.verify(bad11(moneypeers))), json.dumps(codes(V.verify(moneypeers))))
freepay = good11()
freepay["terms"]["consideration"] = "none"
case("attack", "v1.1: a payer and a payee, and terms that claim nothing is owed",
     "terms_contradict_roles" in codes(V.verify(bad11(freepay))), json.dumps(codes(V.verify(freepay))))
ex11 = V.verify(copy.deepcopy(V.EXAMPLE_V11))
case("control", "v1.1: the template refuses exactly for the two things a newcomer must fill in, keys and signatures",
     sorted(set(codes(ex11))) == ["bad_public_key", "one_sided"], json.dumps(sorted(set(codes(ex11)))))
lb11 = good11()
lb11["lower_bound"] = {"kind": "bitcoin_block", "height": 913000, "hash": "f" * 64}
rlb = V.verify(signed(lb11, BOTH))
case("control", "v1.1: a Bitcoin block named by hash bounds the record from BELOW, and the report says so",
     rlb["verdict"] == "accepted" and any("cannot have been written before that block" in s for s in rlb["establishes"]), "")

# --- v1.1: the context prefix ------------------------------------------------------------------

noctx = good11()
body = {k: v for k, v in noctx.items() if k != "signatures"}
raw = V.canonical(body).encode("utf-8")
noctx["signatures"] = [
    {"domain": "party-a.example", "alg": "ed25519", "signature": base64.b64encode(KA.sign(raw)).decode()},
    {"domain": "party-b.example", "alg": "ed25519", "signature": base64.b64encode(KB.sign(raw)).decode()},
]
cn = codes(V.verify(bad11(noctx)))
case("attack", "v1.1: signatures made over the bytes WITHOUT the context prefix do not verify, so a signature by the same key on anything else cannot be pasted in",
     "signature_invalid" in cn, json.dumps(cn))
downgrade = copy.deepcopy(g11)
downgrade["schema"] = "a2a-agreement-v1"
cd_ = codes(V.verify(bad11(downgrade), keys=V11_KEYS))
case("attack", "v1.1: relabelling a v1.1 record as v1 to escape its rules breaks both signatures",
     "signature_invalid" in cd_, json.dumps(cd_))

# --- v1.1: keys ---------------------------------------------------------------------------------

ident = good11()
ident["parties"][0]["public_key_ed25519_b64"] = base64.b64encode(bytes([1]) + bytes(31)).decode()
case("attack", "v1.1: the identity element as a public key, under which forged signatures verify",
     "bad_public_key" in codes(V.verify(bad11(ident))), "")
smallorder = good11()
smallorder["parties"][0]["public_key_ed25519_b64"] = base64.b64encode(
    bytes.fromhex("26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05")).decode()
case("attack", "v1.1: a point of order 8 as a public key",
     "bad_public_key" in codes(V.verify(bad11(smallorder))), "")
allzero = good11()
allzero["parties"][1]["public_key_ed25519_b64"] = base64.b64encode(bytes(32)).decode()
case("attack", "v1.1: the all zero key",
     "bad_public_key" in codes(V.verify(bad11(allzero))), "")
short = good11()
short["parties"][0]["public_key_ed25519_b64"] = base64.b64encode(bytes(31)).decode()
case("attack", "v1.1: a 31 byte public key",
     "bad_public_key" in codes(V.verify(bad11(short))), "")
noncanon_b64 = good11()
noncanon_b64["parties"][0]["public_key_ed25519_b64"] = PA[:-1] + ("A" if PA[-1] != "A" else "B")
c_nb = codes(V.verify(bad11(noncanon_b64)))
case("attack", "v1.1: base64 whose trailing bits are not zero is not a canonical key encoding",
     "bad_public_key" in c_nb or "signature_invalid" in c_nb, json.dumps(c_nb))
samekey = good11()
samekey["parties"][1]["public_key_ed25519_b64"] = PA
case("attack", "v1.1: two domains presenting one key is one party wearing two names",
     "same_public_key" in codes(V.verify(bad11(samekey))), "")
wrongpin = copy.deepcopy(good11())
wrongpin["parties"][0]["public_key_ed25519_b64"] = PC
wrongpin = signed(wrongpin, BOTH)
case("attack", "v1.1: a record that pins a key nobody signed with",
     "signature_invalid" in codes(V.verify(bad11(wrongpin))) or "signatures_disagree" in codes(V.verify(wrongpin)),
     json.dumps(codes(V.verify(wrongpin))))
try:
    S.sign(copy.deepcopy(good11()), KC, "party-a.example", public_b64=PC)
    refused_pin = False
except SystemExit:
    refused_pin = True
case("attack", "v1.1: the signer refuses to sign bytes that name somebody else's key as yours",
     refused_pin, "")

B64ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
_i = B64ALPHABET.index(PA[42])
noncanon_same = good11()
noncanon_same["parties"][0]["public_key_ed25519_b64"] = PA[:42] + B64ALPHABET[_i + 1] + PA[43:]
_alt = noncanon_same["parties"][0]["public_key_ed25519_b64"]
# 32 bytes is 10 full base64 groups plus 2 bytes, so the last data character carries 2 unused
# low bits. Canonical encoders write them as zero; nothing forces a hostile one to.
case("control", "the probe below really is the same key written two ways, or it proves nothing",
     _i % 4 == 0 and base64.b64decode(_alt) == base64.b64decode(PA) and _alt != PA,
     "%s vs %s" % (PA[40:], _alt[40:]))
try:
    S.sign(copy.deepcopy(noncanon_same), KA, "party-a.example")
    signer_took_it = True
except SystemExit:
    signer_took_it = False
case("control", "the signer will not sign a record whose pinned key is written in a spelling it cannot reproduce",
     signer_took_it is False, "")
_ncs = copy.deepcopy(noncanon_same)          # an attacker who does not use our signer
_msg_ncs = V.signing_bytes(_ncs, V11)
_ncs["signatures"] = [
    {"domain": "party-a.example", "alg": "ed25519", "signature": base64.b64encode(KA.sign(_msg_ncs)).decode()},
    {"domain": "party-b.example", "alg": "ed25519", "signature": base64.b64encode(KB.sign(_msg_ncs)).decode()},
]
c_ncs = codes(V.verify(bad11(_ncs)))
case("attack", "v1.1: base64 whose unused trailing bits are not zero decodes to the same key, and even with both signatures valid over it the record is refused; one key must have one spelling or two honest records hash apart",
     "bad_public_key" in c_ncs, json.dumps(c_ncs))

endpoint_subject = nomoney11()
endpoint_subject["parties"][0]["conduct_record"]["subject_domain"] = "mcp.party-b.example"
endpoint_subject["parties"][1]["conduct_record"]["subject_domain"] = "gate.party-a.example"
res_ep = V.verify(signed(endpoint_subject, BOTH))
case("control", "v1.1: a conduct record is about an ENDPOINT host, normally a subdomain of the counterparty; requiring an exact domain match would reject every real record",
     res_ep["verdict"] == "accepted", json.dumps(codes(res_ep)))
stranger = good11()
stranger["parties"][0]["conduct_record"]["subject_domain"] = "somebody-else.example"
case("attack", "v1.1: a conduct record about a third domain nobody in this record is",
     "conduct_subject_wrong" in codes(V.verify(bad11(stranger))), json.dumps(codes(V.verify(stranger))))

upper11 = good11()
upper11["parties"][0]["conduct_record"]["sha256"] = SHA_A.upper()
case("attack", "v1.1: an upper case conduct sha compares unequal to the bytes it names",
     "bad_conduct_sha" in codes(V.verify(bad11(upper11))), json.dumps(codes(V.verify(upper11))))

# --- v1.1: whose conduct ---------------------------------------------------------------------

selfsub = good11()
selfsub["parties"][0]["conduct_record"]["subject_domain"] = "party-a.example"
case("attack", "v1.1: a party pinning a conduct record about ITSELF instead of the counterparty",
     "conduct_subject_wrong" in codes(V.verify(bad11(selfsub))), json.dumps(codes(V.verify(selfsub))))
selfmeas = good11()
selfmeas["parties"][0]["conduct_record"]["measured_by_domain"] = "party-a.example"
case("attack", "v1.1: a party pinning a record it measured itself, without saying so",
     "conduct_self_measured_undeclared" in codes(V.verify(bad11(selfmeas))), "")
declared = good11()
declared["parties"][0]["conduct_record"]["measured_by_domain"] = "party-a.example"
declared["parties"][0]["conduct_record"]["self_measured"] = True
rd = V.verify(signed(declared, BOTH))
case("misclass", "v1.1: the same thing DECLARED is accepted, and the third party line disappears from what it establishes",
     rd["verdict"] == "accepted" and "conduct_self_measured" in finds(rd)
     and not any("somebody other than the two parties" in s for s in rd["establishes"])
     and any("measured by anybody other than the two parties" in s for s in rd["does_not_establish"]),
     json.dumps(finds(rd)))
nocard = good11()
nocard["parties"][0].pop("agent_card_sha256")
case("attack", "v1.1: a card named by URL alone can be rewritten after the fact",
     "bad_card_sha" in codes(V.verify(bad11(nocard))), "")

# --- v1.1: the signature block is outside the signed bytes, so it carries nothing --------------

kuin = copy.deepcopy(g11)
kuin["signatures"][0]["key_url"] = URL_X
case("attack", "v1.1: a key_url in the signature block at all, because nothing there is signed",
     "signature_key_url_present" in codes(V.verify(bad11(kuin))), json.dumps(codes(V.verify(kuin))))
shortsig = copy.deepcopy(g11)
shortsig["signatures"][0]["signature"] = base64.b64encode(bytes(63)).decode()
case("attack", "v1.1: a 63 byte signature",
     "bad_signature" in codes(V.verify(bad11(shortsig))), "")

# --- v1.1: numbers, currency, roles -------------------------------------------------------------

fl11 = good11()
fl11["terms"]["amount_minor_units"] = 10000.5
case("attack", "v1.1: a price written as a double is a price two runtimes print differently",
     "bad_amount" in codes(V.verify(bad11(fl11))) or "unsafe_number" in codes(V.verify(fl11)), "")
noscale = good11()
noscale["terms"].pop("minor_unit_scale")
case("attack", "v1.1: an amount with no minor unit scale is both one hundred yen and one yen",
     "bad_amount" in codes(V.verify(bad11(noscale))), "")
lowcur = good11()
lowcur["terms"]["currency"] = "jpy"
case("attack", "v1.1: a currency that is not three upper case letters",
     "bad_currency" in codes(V.verify(bad11(lowcur))), "")
rev = good11()
rev["terms"]["who_pays_whom"] = {"from": "party-b.example", "to": "party-a.example"}
case("attack", "v1.1: terms that say the payee pays the payer, contradicting the roles in the same record",
     "terms_contradict_roles" in codes(V.verify(bad11(rev))), "")
peerpay = good11()
peerpay["parties"][0]["role"] = "peer"
peerpay["parties"][1]["role"] = "peer"
case("attack", "v1.1: peer with peer naming a payer anyway",
     "terms_contradict_roles" in codes(V.verify(bad11(peerpay))), "")

# --- v1.1: who recorded it ----------------------------------------------------------------------

norec = good11()
norec.pop("recorder")
case("attack", "v1.1: a record whose recorder is unnamed cannot be checked for an interest in what it records",
     "bad_recorder" in codes(V.verify(bad11(norec))), "")
hidden = good11()
hidden["recorder"]["domain"] = "party-b.example"
case("attack", "v1.1: the recorder IS a party and the record says it is not",
     "recorder_undisclosed" in codes(V.verify(bad11(hidden))), json.dumps(codes(V.verify(hidden))))
owned = good11()
owned["recorder"]["domain"] = "party-b.example"
owned["recorder"]["is_a_party"] = True
ro = V.verify(signed(owned, BOTH))
case("misclass", "v1.1: declared inside the signed bytes, the recorder being a party is accepted and disclosed",
     ro["verdict"] == "accepted" and "operator_is_a_party" in finds(ro), json.dumps(finds(ro)))
pct11 = good11()
pct11["recorder"]["fee"] = {"basis": "share_of_savings", "amount_minor_units": 1, "currency": "JPY"}
case("attack", "v1.1: a fee that is a share of the savings is still a fee that moves with the deal",
     "fee_tied_to_outcome" in codes(V.verify(bad11(pct11))), "")
pos11 = good11()
pos11["record_paid_by"] = "party_a"
case("attack", "v1.1: record_paid_by naming an array position instead of a domain",
     "bad_record_paid_by" in codes(V.verify(bad11(pos11))), "")
dom11 = good11()
dom11["record_paid_by"] = "party-a.example"
case("control", "v1.1: record_paid_by naming a party's domain is what v1.1 wants",
     V.verify(signed(dom11, BOTH))["verdict"] == "accepted", json.dumps(codes(V.verify(signed(dom11, BOTH)))))

# --- v1.1: identity of the agreement, time, disclaimers ------------------------------------------

noid = good11()
noid.pop("agreement_id")
case("attack", "v1.1: no agreement_id, so two honest agreements with identical terms in one second are one record",
     "bad_agreement_id" in codes(V.verify(bad11(noid))), "")
upid = good11()
upid["agreement_id"] = "00112233445566778899AABBCCDDEEFF"
case("attack", "v1.1: an upper case agreement_id compares unequal to the same id in lower case",
     "bad_agreement_id" in codes(V.verify(bad11(upid))), "")
frac = good11()
frac["agreed_at"] = "2026-09-10T00:00:00.000Z"
case("attack", "v1.1: one instant, one spelling; fractional seconds are two spellings of one time",
     "bad_agreed_at" in codes(V.verify(bad11(frac))), "")
badlb = good11()
badlb["lower_bound"] = {"kind": "bitcoin_block", "height": "913000", "hash": "f" * 64}
case("attack", "v1.1: a lower bound whose height is a string",
     "bad_lower_bound" in codes(V.verify(bad11(badlb))), "")
thin11 = good11()
thin11["does_not_establish"] = ["that either party performed", "that this record is a contract", "that money moved"]
c_t11 = codes(V.verify(bad11(thin11)))
case("attack", "v1.1: a disclaimer that forgets to say the conduct records were not judged",
     "disclaimer_incomplete" in c_t11, json.dumps(c_t11))
nc11 = V.canonical(g11)
pretty11 = json.dumps(g11, ensure_ascii=False, indent=2)
c_nc = codes(V.verify(V.parse_strict(pretty11), input_text=pretty11))
case("attack", "v1.1: non canonical bytes are refused, not merely noted; the sha an anchor carries must be the sha you hold",
     "not_canonical" in c_nc, json.dumps(c_nc))

# --- v1.1: text and size -------------------------------------------------------------------------

surro = good11()
surro["terms"]["what"] = "one audit \ud800 of one estimate"
c_s = codes(V.verify(bad11(surro)))
case("attack", "a lone surrogate is valid JSON, survives the parser, and used to kill this verifier with a traceback",
     c_s == ["bad_text"], json.dumps(c_s))
ctrl = good11()
ctrl["parties"][0]["domain"] = "party-a.example\x1b[31m"
case("attack", "an escape sequence inside a field, which a terminal reading the report would obey",
     "bad_text" in codes(V.verify(bad11(ctrl))), "")
longs = good11()
longs["terms"]["what"] = "x" * (V.MAX_STRING + 1)
case("attack", "a single field longer than the limit",
     "bad_text" in codes(V.verify(bad11(longs))), "")
manyarr = good11()
manyarr["does_not_establish"] = ["that either party performed", "that this record is a contract",
                                 "that money moved", "that the conduct record is accurate"] + ["x"] * 100
case("attack", "an array with more entries than the limit",
     "bad_text" in codes(V.verify(bad11(manyarr))), "")

# --- 2026-09-10: 2 つ目の実装への変異試験が、この 5 本を素通りした。規則は verifier に
# 有るのに、それを踏む入力が 5,221 件の契約に 1 つも無かった。無いものは測れん。
# (見つけ方: agreement_verify_mutation.mjs の 32 本のうち 5 本が生き残った。生き残った
#  変異は JS の欠陥やのうて、契約の穴を指しとった。)

astral = good11()
astral["terms"]["what"] = "\U0001F600" * (V.MAX_STRING + 1)
_why_astral = [x["why"] for x in V.verify(bad11(astral))["refusals"] if x["code"] == "bad_text"]
case("attack", "a field over the limit made of astral characters: the count is code points, not UTF-16 units",
     any("is %d characters" % (V.MAX_STRING + 1) in w for w in _why_astral), json.dumps(_why_astral)[:120])

tabbed = good11()
tabbed["terms"]["what"] = "one\taudit of one estimate"
case("control", "a tab is not one of the control characters this refuses; a tab in prose is prose",
     "bad_text" not in codes(V.verify(bad11(tabbed))), json.dumps(codes(V.verify(tabbed))))

two_bad = good11()
two_bad["terms"]["what"] = "one audit\x01of one estimate"
two_bad["record_paid_by"] = "party-a.example\ud800"
_tb = [x["why"] for x in V.verify(bad11(two_bad))["refusals"] if x["code"] == "bad_text"]
case("attack", "two bad_text refusals come out in sorted path order, not in whatever order the walk found them",
     len(_tb) == 2 and _tb == sorted(_tb), json.dumps(_tb)[:160])

nel = good11()
nel["parties"][0]["domain"] = "party-a.example\x85"
case("control", "NEL (U+0085) around a hostname is stripped, because this verifier strips what python calls space",
     "bad_domain" not in codes(V.verify(bad11(nel))), json.dumps(codes(V.verify(nel))))

bom = good11()
bom["parties"][0]["domain"] = "party-a.example\ufeff"
case("attack", "a byte order mark around a hostname is NOT stripped, and the hostname is refused",
     "bad_domain" in codes(V.verify(bad11(bom))), json.dumps(codes(V.verify(bom))))

# 語境界は前と後ろの二つある。片方だけ ascii にした実装が有り得るから、片方ずつ踏む。
glued_head = good11()
glued_head["establishes"] = ["that both parties signed these bytes",
                             "\u652fpaid was made, and that is a japanese word with latin letters in it"]
case("control", "an overclaim word with non ASCII glued in FRONT is not that word (leading boundary is unicode)",
     "establishes_overclaims" not in codes(V.verify(bad11(glued_head))), json.dumps(codes(V.verify(glued_head))))

glued_tail = good11()
glued_tail["establishes"] = ["that both parties signed these bytes",
                             "the buyer paid\u6e08 nothing, and that is a japanese word with latin letters in it"]
case("control", "an overclaim word with non ASCII glued BEHIND is not that word (trailing boundary is unicode)",
     "establishes_overclaims" not in codes(V.verify(bad11(glued_tail))), json.dumps(codes(V.verify(glued_tail))))

# scan_text は結果を並べ替えてから返す。並べ替えを外しても気付かん入力が多いから、
# 「歩いた順」と「並べ替えた順」がはっきり違う形を作る: 添字 2 と 10 の並びは逆になる。
sortme = good11()
sortme["does_not_establish"] = ["that either party performed", "that this is not a contract",
                                "that money moved", "that the conduct record is accurate"] \
    + ["entry %d \x01 with a control character" % i for i in range(11)]
_sm = [x["why"] for x in V.verify(bad11(sortme))["refusals"] if x["code"] == "bad_text"]
case("attack", "bad_text paths come out sorted, which is not the order the walk found them (index 10 before 2)",
     len(_sm) == 8 and _sm == sorted(_sm), json.dumps(_sm)[:200])

# Report.refuse と Report.find は **同じ** 覚え書き (seen) を共有しとる。せやから同じ
# (code, why) は、断りに出たら所見には出んし、逆も同じや。今の規則ではその衝突が
# 1 度も起きん。起きんなら共有は見えん、見えんなら 2 つ目の実装が分けて書いても
# 気付かん。「見た限り無い」やのうて、契約の全件で「無い」を測る。ここが赤くなったら、
# 共有の意味が生まれたということで、その時は変異が本物の穴になる。
_shared = []
for _rec in alls + ATTACKS_11:
    _rep = V.verify(_rec, keys=KEYS)
    _rf = {(x["code"], x["why"]) for x in _rep["refusals"]}
    _fd = {(x["code"], x["why"]) for x in _rep["findings"]}
    if _rf & _fd:
        _shared.append(sorted(_rf & _fd)[0])
case("residual", "no rule yet produces the same (code, why) as both a refusal and a finding, so the shared seen set is not observable",
     not _shared, json.dumps(_shared[:2], ensure_ascii=False)[:160])
biggy = good11()
biggy["establishes"] = ["that both parties signed these bytes"] + ["y" * 4000 for _ in range(6)]
c_big = codes(V.verify(bad11(biggy)))
case("attack", "a record over the v1.1 size limit is refused before anybody reads its fields",
     "too_large" in c_big, json.dumps(c_big))
same_but_v1 = copy.deepcopy(biggy)
same_but_v1["schema"] = "a2a-agreement-v1"
case("misclass", "the same bytes under v1, whose limit is looser, are not refused for size; the limit belongs to the schema",
     "too_large" not in codes(V.verify(same_but_v1, keys=KEYS)), "")

# --- 自分の変異一覧の外を狩って出た盲点 10 個 (2026-09-10) ---------------------------------------
# 41/41 が意味しとったのは「番人が選んだ 41 本の規則は試されとる」だけで、網羅率やない。
# 一覧の外の変異を 11 個作ったら 10 個が生き残った。規則はどれも実装にあった。無かったのは vector や。
# 上限を試す vector は定数を読まん。定数を読む vector は、定数を動かすと一緒に動いて何も試さん。

single = good11()
single["parties"][0]["domain"] = "localhost"
single["parties"][0]["key_url"] = "https://localhost/keys/agreement.json"
case("attack", "a single label host is not a domain; nobody can be reached at it and nobody owns it",
     "bad_domain" in codes(V.verify(bad11(single))), json.dumps(codes(V.verify(single))))
hyph = good11()
hyph["parties"][0]["domain"] = "-evil.example"
hyph["parties"][0]["key_url"] = "https://-evil.example/keys/agreement.json"
case("attack", "a label may not start with a hyphen",
     "bad_domain" in codes(V.verify(bad11(hyph))), json.dumps(codes(V.verify(hyph))))

three_p = good11()
three_p["parties"].append(p11("party-c.example", "peer", PC, "c" * 64, "party-a.example"))
c3 = codes(V.verify(bad11(three_p)))
case("attack", "three parties is refused as not_two_parties, and not left to some other rule to catch by accident",
     "not_two_parties" in c3, json.dumps(c3))

# 上限は実数で試す。定数を読んだら、定数を動かした時に vector も一緒に動いてまう
big_str = good11()
big_str["terms"]["what"] = "x" * 4097
case("attack", "a 4097 character field is over the limit (written as a number, not as MAX_STRING + 1)",
     "bad_text" in codes(V.verify(bad11(big_str))), "")
ok_str = good11()
ok_str["terms"]["what"] = "x" * 4000
case("control", "and a 4000 character field is not, so the limit is a limit and not a ban",
     V.verify(signed(ok_str, BOTH))["verdict"] == "accepted", json.dumps(codes(V.verify(signed(ok_str, BOTH)))))


def nest(rec, n):
    rec = copy.deepcopy(rec)
    cur = rec
    for _i in range(n):
        cur["nested"] = {}
        cur = cur["nested"]
    return rec


case("attack", "forty levels of nesting is over the limit (written as a number)",
     "too_deep" in codes(V.verify(bad11(nest(good11(), 40)))), json.dumps(codes(V.verify(nest(good11(), 40)))))
case("control", "and twenty levels is not",
     "too_deep" not in codes(V.verify(nest(good11(), 20))), json.dumps(codes(V.verify(nest(good11(), 20)))))

# https の要求は 3 箇所ある。どれも規則はあったが、どれも試されとらんかった
for _field, _setter in (
    ("parties[0].agent_card", lambda r: r["parties"][0].__setitem__("agent_card", "http://party-a.example/card.json")),
    ("parties[0].conduct_record.url", lambda r: r["parties"][0]["conduct_record"].__setitem__("url", "http://gate.example/r")),
    ("terms.disclosure_url", lambda r: r["terms"].__setitem__("disclosure_url", "http://party-b.example/pricing")),
):
    _rec = good11()
    _setter(_rec)
    case("attack", "%s over plain http is refused; a URL that can be rewritten in flight names nothing" % _field,
         "missing_field" in codes(V.verify(bad11(_rec))), json.dumps(codes(V.verify(_rec))))

upstr = good11()
upstr["upstream"] = "x402:0xdead"
case("attack", "upstream as a bare string instead of {protocol, reference}",
     "missing_field" in codes(V.verify(bad11(upstr))), json.dumps(codes(V.verify(upstr))))

alg = copy.deepcopy(g11)
alg["signatures"][0]["alg"] = "ed25519ph"
case("attack", "an alg field naming a different Ed25519 variant than the one actually verified",
     "bad_signature" in codes(V.verify(bad11(alg))), json.dumps(codes(V.verify(alg))))

# --- 3 回目の狩り。この事業の根っこに vector が 1 本も無かった -----------------------------------
# canonical() を壊しても敵は気付かんかった。キーの並べ替えを止めても、非 ASCII を escape しても、
# 区切りに空白を入れても、166 本が全部緑のまま通った。バイト一致で再現できることが看板の仕組みで、
# その形を固定する vector が 1 本も無い状態やった。形は散文やなくバイトで書く。

case("control", "canonical sorts keys at EVERY level, not just the top, and packs the separators",
     V.canonical({"b": 1, "a": {"d": 2, "c": 3}}) == '{"a":{"c":3,"d":2},"b":1}',
     V.canonical({"b": 1, "a": {"d": 2, "c": 3}}))
case("control", "canonical leaves non ASCII as itself and never escapes it",
     V.canonical({"k": "\u97f3"}) == '{"k":"\u97f3"}', V.canonical({"k": "\u97f3"}))
case("control", "canonical inside a list is sorted too, and no space follows a comma or a colon",
     V.canonical({"x": [{"b": 1, "a": 2}]}) == '{"x":[{"a":2,"b":1}]}', V.canonical({"x": [{"b": 1, "a": 2}]}))
_d1 = {"a": 1}
_d1["b"] = 2
_d2 = {"b": 2}
_d2["a"] = 1
case("control", "two dicts built in opposite orders canonicalize to the same string",
     V.canonical(_d1) == V.canonical(_d2) == '{"a":1,"b":2}', V.canonical(_d2))
_body = {k: v for k, v in good11().items() if k != "signatures"}
case("control", "the signed bytes are exactly the context prefix followed by the canonical record without its signatures",
     V.signing_bytes(good11(), V11) == b"a2a-agreement-v1.1\n" + V.canonical(_body).encode("utf-8"), "")
case("control", "and under v1 they are the canonical bytes with no prefix at all",
     V.signing_bytes(good(), "a2a-agreement-v1")
     == V.canonical({k: v for k, v in good().items() if k != "signatures"}).encode("utf-8"), "")

# --- 3 回目の狩り: 鍵の符号化そのもの ------------------------------------------------------------
ycurve = good11()
ycurve["parties"][0]["public_key_ed25519_b64"] = base64.b64encode((V._P25519).to_bytes(32, "little")).decode()
case("attack", "a public key whose y equals the field prime is a non canonical point encoding, not a key",
     "bad_public_key" in codes(V.verify(bad11(ycurve))), json.dumps(codes(V.verify(ycurve))))
offcurve = good11()
offcurve["parties"][0]["public_key_ed25519_b64"] = base64.b64encode((2).to_bytes(32, "little")).decode()
case("attack", "and a y that is not on curve25519 at all",
     "bad_public_key" in codes(V.verify(bad11(offcurve))), json.dumps(codes(V.verify(offcurve))))
# y = p + 1 は約分すると 1 = 単位元の y や。ところが約分前の値は 1 とちゃうので、
# 素朴に point == IDENTITY と比べても一致せん。上限検査を外すと **単位元が非正規な符号化で
# 素位数の鍵として通り抜ける**。19 通りの非正規形のうち、これ 1 つだけがそうなる。
ident_sneak = good11()
ident_sneak["parties"][0]["public_key_ed25519_b64"] = base64.b64encode((V._P25519 + 1).to_bytes(32, "little")).decode()
case("attack", "the identity element wearing a non canonical encoding (y = p + 1): the only one of the nineteen that would slip past a subgroup test alone",
     "bad_public_key" in codes(V.verify(bad11(ident_sneak))), json.dumps(codes(V.verify(ident_sneak))))

# --- 3 回目の狩り: 有効な署名 3 本 ----------------------------------------------------------------
# 2 本と数えとる所を 2 本以上に緩めても、この一式には「有効な署名が 3 本ある記録」が 1 つも
# 無かったので誰も気付かんかった。
three_valid = signed(good(), BOTH)
_msg3 = V.signing_bytes(three_valid, "a2a-agreement-v1")
three_valid["signatures"].append({"domain": "party-c.example", "alg": "ed25519",
                                  "signature": base64.b64encode(KC.sign(_msg3)).decode(), "key_url": URL_C})
_r3v = V.verify(three_valid, keys=KEYS)
case("attack", "three signatures that ALL verify: refused, and signatures_checked stays false because two is two",
     "extra_signatures" in codes(_r3v) and _r3v["signatures_checked"] is False
     and len(_r3v["signatures"]) == 3 and all(e["result"] == "valid" for e in _r3v["signatures"]),
     json.dumps({"checked": _r3v["signatures_checked"], "n": len(_r3v["signatures"])}))

# --- 3 回目の狩り: 一つの規則を一本の vector が代わりに拾ってしまう ---------------------------------
badrole = good11()
badrole["parties"][0]["role"] = "either"
case("attack", "an invented role is refused as bad_role by name, not left to the pairing rule to catch",
     "bad_role" in codes(V.verify(bad11(badrole))), json.dumps(codes(V.verify(badrole))))
over_contract = good11()
over_contract["establishes"] = ["that the parties formed a contract"]
case("attack", "establishes claiming a contract is caught by the contract pattern alone, with no other trigger word in the sentence",
     "establishes_overclaims" in codes(V.verify(bad11(over_contract))), json.dumps(codes(V.verify(over_contract))))

# --- 似せドメイン。under_domain は 4 つの規則を支えとるのに、点の境目を試す vector が無かった -------
# evilparty-a.example は party-a.example で終わる。点を挟んで比べんかったら「その下」になってまう。
# 2 回目の狩りで出た。bad_key_url / self_agreement / conduct_subject_wrong / recorder_undisclosed が
# 全部この 1 本の関数に乗っとる。

# 2026-09-11. ここは v1 と v1.1 で答えが違う。フェデリコが見つけた不揃いの直しや。
# v1 は鍵が記録の中に無いから、他所のホストに置かれたら根拠が丸ごと消える -> 断る。
# v1.1 は鍵が署名バイトの中にあるから署名は立つ -> 帰属だけ落とす。詳しくは草案 6.9。
lookalike_v1 = good()
lookalike_v1["parties"][0]["key_url"] = "https://evilparty-a.example/keys/agreement.json"
c_la1 = codes(V.verify(lookalike_v1, keys=KEYS))
case("attack", "v1: a key served at evilparty-a.example is not served under party-a.example, however the string ends",
     "bad_key_url" in c_la1, json.dumps(c_la1))

lookalike = good11()
lookalike["parties"][0]["key_url"] = "https://evilparty-a.example/keys/agreement.json"
_rep_la = V.verify(bad11(lookalike))
case("attack", "v1.1: the same lookalike host is a finding, and it is named key_url_off_domain",
     "key_url_off_domain" in finds(_rep_la), json.dumps(finds(_rep_la)))
case("fix", "v1.1: and it does NOT refuse the record for it; the key is inside the signed bytes",
     "bad_key_url" not in codes(_rep_la), json.dumps(codes(_rep_la)))
case("fix", "v1.1: and the report names the host, so a reader can go look at whose key server it was",
     any("evilparty-a.example" in x for x in _rep_la["does_not_establish"]),
     json.dumps(_rep_la["does_not_establish"][-1:]))

# 一番効く形。鍵を渡して、しかも一致させる。所見に落とすだけでは、ここで帰属が立ってまう。
# 落とすんやのうて、能動的に落とさなあかん。扉 0.4.4 が踏んだのと同じ穴や。
la_signed = signed(lookalike, BOTH)
KEYS_FOREIGN = dict(KEYS)
KEYS_FOREIGN["https://evilparty-a.example/keys/agreement.json"] = PA
_rep_lf = V.verify(la_signed, keys=KEYS_FOREIGN)
ATTRIB_LINE = "attributable to the domain"
case("attack", "v1.1: even with a key set that supplies the foreign URL and serves the RIGHT key, attribution is not claimed",
     not any(ATTRIB_LINE in x for x in _rep_lf["establishes"]),
     json.dumps(_rep_lf["establishes"][-1:]))
case("attack", "v1.1: and key_urls_checked is false, so the flag agrees with the sentence",
     _rep_lf["key_urls_checked"] is False, json.dumps(_rep_lf["key_urls_checked"]))
case("control", "v1.1: the record itself is still accepted; both signatures still cover the same bytes",
     _rep_lf["verdict"] == "accepted" and _rep_lf["signatures_checked"] is True, json.dumps(codes(_rep_lf)))
case("control", "and a record whose key_url IS under its own domain still gets the attribution line",
     any(ATTRIB_LINE in x for x in V.verify(signed(good11(), BOTH), keys=KEYS)["establishes"]), "")
lasubj = good11()
lasubj["parties"][0]["conduct_record"]["subject_domain"] = "evilparty-b.example"
case("attack", "and a conduct record about evilparty-b.example is not about the counterparty",
     "conduct_subject_wrong" in codes(V.verify(bad11(lasubj))), json.dumps(codes(V.verify(lasubj))))
larec = good11()
larec["recorder"]["domain"] = "evilparty-b.example"
lr = V.verify(signed(larec, BOTH))
case("control", "a recorder at evilparty-b.example is NOT a party, so declaring is_a_party false is correct and accepted",
     lr["verdict"] == "accepted" and "operator_is_a_party" not in finds(lr), json.dumps(codes(lr) + finds(lr)))
neighbour = good11()
neighbour["parties"][1] = p11("xparty-a.example", "payee", PC, SHA_B, "party-a.example")
neighbour["parties"][0]["conduct_record"]["subject_domain"] = "xparty-a.example"
neighbour["terms"]["who_pays_whom"] = {"from": "party-a.example", "to": "xparty-a.example"}
nb = V.verify(signed(neighbour, [("party-a.example", KA), ("xparty-a.example", KC)]))
case("control", "and party-a.example with xparty-a.example are two different parties, not one; the boundary must not over refuse either",
     nb["verdict"] == "accepted", json.dumps(codes(nb)))

lowsur = good11()
lowsur["terms"]["what"] = "one audit \udc00 of one estimate"
case("attack", "a LOW surrogate kills UTF-8 exactly like a high one; the rule is the range, not the one code point that was tested",
     codes(V.verify(bad11(lowsur))) == ["bad_text"], json.dumps(codes(V.verify(lowsur))))

# --- v1.1: key_url cross check --------------------------------------------------------------------

miss11 = V.verify(g11, keys={URL_A: PA})
case("misclass", "v1.1: a key file that is missing one URL is key_url_unreachable, and the record is not accepted",
     "key_url_unreachable" in codes(miss11) and miss11["verdict"] != "accepted", json.dumps(codes(miss11)))
mism11 = V.verify(g11, keys={URL_A: PA, URL_B: PX})
case("attack", "v1.1: a key_url serving a key other than the one pinned inside the signed bytes",
     "key_url_mismatch" in codes(mism11), json.dumps(codes(mism11)))

# --- v1.1: property over every v1.1 attack built above ----------------------------------------------

acc11 = [i for i, rec in enumerate(ATTACKS_11) if V.verify(rec)["verdict"] == "accepted"]
case("control", "not one of the %d v1.1 attack records is accepted" % len(ATTACKS_11), acc11 == [], str(acc11))
acck11 = [i for i, rec in enumerate(ATTACKS_11) if V.verify(rec, keys=V11_KEYS)["verdict"] == "accepted"]
case("control", "and not one of them is accepted with a key file either", acck11 == [], str(acck11))
case("control", "every v1.1 report that is accepted has checked both signatures",
     all(V.verify(r)["signatures_checked"] for r in (g11, signed(peers11, BOTH), signed(dom11, BOTH))), "")

# --- shape bombs: a verifier that dies has not refused anything ---------------------------------

deepr = {"schema": "a2a-agreement-v1"}
cur = deepr
for _i in range(5000):
    cur["x"] = {}
    cur = cur["x"]
dr = V.verify(deepr, keys=KEYS)
case("attack", "5000 levels of nesting: refused as too_deep, not a traceback (every recursive reader dies here, this one answers)",
     dr["verdict"] == "refused" and codes(dr) == ["too_deep"] and dr["canonical_sha256"] is None, json.dumps(codes(dr)))
wide = {"schema": "a2a-agreement-v1", "junk": [1] * 50000}
case("attack", "fifty thousand nodes: refused before anything is canonicalized",
     codes(V.verify(wide, keys=KEYS)) == ["too_deep"], "")
cyc = {"schema": "a2a-agreement-v1"}
cyc["self"] = cyc
case("attack", "a record that refers to itself is refused, not followed forever",
     codes(V.verify(cyc, keys=KEYS)) == ["too_deep"], "")
deep_text = "[" * 100000 + "]" * 100000
dtp = os.path.join(tempfile.mkdtemp(), "deep.json")
open(dtp, "w", encoding="utf-8").write(deep_text)
rc_deep, out_deep = None, ""
try:
    import io
    from contextlib import redirect_stdout
    _b = io.StringIO()
    with redirect_stdout(_b):
        rc_deep = V.main([dtp])
    out_deep = _b.getvalue()
except Exception as _e:
    out_deep = "raised " + type(_e).__name__
case("attack", "JSON nested past what the parser itself can take is refused at the door",
     rc_deep == 1 and "too_deep" in out_deep, str(rc_deep))

# --- fuzz: seeded, so it is the same 3000 records for everybody who runs this ---------------------

import random as _random

_rnd = _random.Random(20260910)
_vals = [None, True, False, 0, -1, 2 ** 70, 1.5, "", "x", [], {}, [1, 2], {"a": 1},
         "https://x", "HTTP://x", "a" * 64, "A" * 64, ":", "..", "x.y.z", "party-a.example"]
_paths = []


def _walk(o, p=""):
    if isinstance(o, dict):
        for k in list(o):
            _paths.append(p + "/" + k)
            _walk(o[k], p + "/" + k)
    elif isinstance(o, list):
        for i, v in enumerate(o):
            _paths.append(p + "/%d" % i)
            _walk(v, p + "/%d" % i)


def _setp(o, path, v):
    parts = [x for x in path.split("/") if x]
    cur = o
    for x in parts[:-1]:
        cur = cur[int(x)] if isinstance(cur, list) else cur[x]
    last = parts[-1]
    if isinstance(cur, list):
        cur[int(last)] = v
    else:
        cur[last] = v


_vals11 = _vals + ["\ud800", "x\x1b[31m", "a2a-agreement-v1", "a2a-agreement-v1.1", "JPY", "jpy",
                   {"kind": "bitcoin_block"}, {"from": "party-a.example"}, "00112233445566778899aabbccddeeff",
                   PA, PB, base64.b64encode(bytes(32)).decode(), "gate.example", True]
_crashes, _bad_accept, _runs = [], 0, 0
for _base, _vlist, _keysets in ((signed(good(), BOTH), _vals, (None, KEYS)),
                                (signed(good11(), BOTH), _vals11, (None, V11_KEYS))):
    _paths = []
    _walk(_base)
    for _t in range(1500):
        _rec = copy.deepcopy(_base)
        for _ in range(_rnd.randint(1, 4)):
            try:
                _setp(_rec, _rnd.choice(_paths), copy.deepcopy(_rnd.choice(_vlist)))
            except Exception:
                pass
        if _rnd.random() < 0.2:
            _rec = _rnd.choice([_rec, [_rec], "string", 5, None, {}])
        for _k in _keysets:
            _runs += 1
            try:
                _rp = V.verify(_rec, keys=_k, recorder_domain="party-b.example", now="2026-09-11T00:00:00Z")
                _ev = _rp.get("signatures") or []
                if _rp["verdict"] == "accepted" and (_rp["refusals"] or not _rp["signatures_checked"]
                                                     or len(_ev) != 2 or any(e["result"] != "valid" for e in _ev)):
                    _bad_accept += 1
            except Exception as _e:
                _crashes.append(type(_e).__name__)
case("attack", "%d mutated records across both schemas, half of them with no keys: no traceback ever escapes" % _runs,
     _crashes == [], ", ".join(sorted(set(_crashes))))
case("control", "and none of them is accepted while carrying a refusal, an unchecked signature, or anything but two valid ones",
     _bad_accept == 0, str(_bad_accept))

malformed_nokey = signed(good(), BOTH)
malformed_nokey["signatures"][0]["signature"] = base64.b64encode(bytes(63)).decode()
c_mn = codes(V.verify(malformed_nokey))
case("attack", "a signature of the wrong length is refused on shape alone, with no key file in sight, rather than reported as merely unchecked",
     "bad_signature" in c_mn and V.verify(malformed_nokey)["verdict"] == "refused", json.dumps(c_mn))
notb64 = signed(good(), BOTH)
notb64["signatures"][1]["signature"] = "not base64 at all!!"
case("attack", "so is a signature that is not base64 at all",
     "bad_signature" in codes(V.verify(notb64)), "")

# --- the flag that must never lie ------------------------------------------------------------

half = V.verify(signed(good(), BOTH), keys={URL_A: PA})
case("attack", "one checkable signature out of two never reports signatures_checked true",
     half["signatures_checked"] is False and half["verdict"] != "accepted",
     json.dumps({"checked": half["signatures_checked"], "v": half["verdict"]}))
forged_flag = V.verify(forged, keys=KEYS)
case("attack", "two forged signatures never report signatures_checked true",
     forged_flag["signatures_checked"] is False, str(forged_flag["signatures_checked"]))
split_flag = V.verify(split, keys=KEYS)
case("attack", "one valid and one invalid never reports signatures_checked true",
     split_flag["signatures_checked"] is False, str(split_flag["signatures_checked"]))

liars = []
for _label, _rec, _k in ([("v1:%d" % i, rec, KEYS) for i, rec in enumerate(alls)]
                         + [("v11:%d" % i, rec, None) for i, rec in enumerate(ATTACKS_11)]
                         + [("v11k:%d" % i, rec, V11_KEYS) for i, rec in enumerate(ATTACKS_11)]
                         + [("ok:0", g, KEYS), ("ok:1", g11, None), ("ok:2", g11, V11_KEYS)]):
    _rp = V.verify(_rec, keys=_k)
    _ev = _rp.get("signatures") or []
    if _rp["signatures_checked"] and not (len(_ev) == 2 and all(e["result"] == "valid" for e in _ev)):
        liars.append(_label)
    if _rp["verdict"] == "accepted" and not _rp["signatures_checked"]:
        liars.append(_label + "/accepted-unchecked")
case("control", "across every record in this file, signatures_checked is true only when the report itself lists two valid signatures, and accepted never appears without it",
     liars == [], ", ".join(liars[:6]))

# --- running this while the mutation tool is working measures nothing --------------------------

import tempfile as _tf

_tmpdir = _tf.mkdtemp()
_fake = os.path.join(_tmpdir, ".agreement_verify.py.mutation_backup")
case("control", "with no backup beside the verifier, nothing is in progress and the suite runs",
     mutation_in_progress(backup=_fake, env={}) is False, "")
open(_fake, "w").close()
case("fix", "with a backup present, the suite refuses rather than reporting a verdict about somebody else's edit",
     mutation_in_progress(backup=_fake, env={}) is True, "")
case("control", "except for the mutation tool itself, which is supposed to run against a mutated verifier",
     mutation_in_progress(backup=_fake, env={"AGREEMENT_MUTATION_RUN": "1"}) is False, "")

# --- the quickstart in the README has to be a quickstart ---------------------------------------
# It was not. It told a reader to print a public key and never told them to put it in the record,
# so following it produced a template still carrying REPLACE_WITH_PARTY_A_PUBLIC_KEY and the
# signer refused. A recipe with a step you have to guess is a recipe that fails on the first
# outside reader, and this file is the only thing that will notice when it happens again.

_README = os.path.join(os.path.dirname(os.path.abspath(__file__)), "README.md")
if os.path.exists(_README):
    _md = open(_README, encoding="utf-8").read()
    _blocks = [b for b in re.findall(r"```\n(.*?)```", _md, re.S) if "agreement_sign.py" in b]
    _qs = _blocks[0] if _blocks else ""
    case("control", "the README carries an end to end block that signs a record",
         bool(_qs), str(len(_blocks)))
    case("control", "and that block puts the printed public keys INTO the record before signing",
         "public_key_ed25519_b64" in _qs and "--pubkey" in _qs, "")
    case("control", "and it builds the key file before it passes one to --keys",
         ("--keys" not in _qs) or (_qs.index("keys.json\"") < _qs.index("--keys")),
         "")
    case("control", "and it writes into a scratch directory, so running the README does not litter the repository",
         "/tmp/" in _qs, "")
else:
    case("control", "the README is beside this file so its quickstart can be checked", False, _README)

# --- the anchored draft must never move --------------------------------------------------------

_HERE = os.path.dirname(os.path.abspath(__file__))
_V0 = os.path.join(_HERE, "..", "..", "..", "..", "ops", "AGREEMENT_EXT_v0_DRAFT.md")
_SEED = os.path.join(_HERE, "..", "..", "seed_entry_agreement_v0.json")
if os.path.exists(_V0) and os.path.exists(_SEED):
    _claim = json.load(open(_SEED, encoding="utf-8")).get("claim_sha256")
    _now = hashlib.sha256(open(_V0, "rb").read()).hexdigest()
    case("control", "the v0 draft still hashes to what JIDEC entry 39 claims; a dated draft whose text moves afterwards is worth nothing, so this file goes red if anybody edits it",
         _claim == _now, "anchored %s, on disk %s" % (str(_claim)[:16], _now[:16]))
else:
    case("control", "the anchored v0 draft and its ledger seed are both here to be checked against each other",
         False, "missing %s or %s" % (_V0, _SEED))

# --- the document and the program must not drift apart -------------------------------------

DOC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..",
                   "ops", "AGREEMENT_EXT_v0_1_DRAFT.md")
V1_ONLY_REFUSALS = {"key_url_not_pinned"}
V1_ONLY_FINDINGS = {"disclaimer_thin", "paid_by_positional", "not_canonical"}
if os.path.exists(DOC):
    _src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "agreement_verify.py"), encoding="utf-8").read()
    _ref = set(re.findall(r'r\.refuse\(\s*"([a-z0-9_]+)"', _src)) | set(re.findall(r'"code":\s*"([a-z0-9_]+)"', _src))
    _fin = set(re.findall(r'r\.find\(\s*"([a-z0-9_]+)"', _src))
    _doc = open(DOC, encoding="utf-8").read()
    _s4 = set(re.findall(r'`([a-z0-9_]+)`', _doc.split("## 4. What a reader MUST refuse")[1].split("## 5.")[0]))
    _s5 = set(re.findall(r'`([a-z0-9_]+)`', _doc.split("## 5. What is recorded but not refused")[1].split("## 6.")[0]))
    _miss_doc = sorted((_ref - V1_ONLY_REFUSALS) - _s4)
    _miss_impl = sorted(_s4 - _ref)
    case("control", "every refusal this program can emit is named in the v1.1 draft",
         _miss_doc == [], ", ".join(_miss_doc))
    case("control", "and every refusal the v1.1 draft names exists in this program",
         _miss_impl == [], ", ".join(_miss_impl))
    _fmiss = sorted((_fin - V1_ONLY_FINDINGS) - _s5)
    case("control", "same for the findings, which are the ones a reader is most likely to forget to document",
         _fmiss == [] and sorted(_s5 - _fin) == [], ", ".join(_fmiss + sorted(_s5 - _fin)))
    case("control", "the v1.1 draft states the exact bytes that are signed, prefix included",
         "a2a-agreement-v1.1" in _doc and 'canonical(record without "signatures")' in _doc, "")
else:
    case("control", "the v1.1 draft is beside this program, so the two can be checked against each other",
         False, "not found at " + DOC)

# --- house rules --------------------------------------------------------------------------------

FORBIDDEN = "\u2014\u2013\u2015\u2012\u2212"  # held as escapes so this guard is not its own violation
here = os.path.dirname(os.path.abspath(__file__))
dash_hits = []
for fn in ("agreement_verify.py", "agreement_sign.py", "agreement_redteam.py", "README.md"):
    p = os.path.join(here, fn)
    if not os.path.exists(p):
        continue
    txt = open(p, encoding="utf-8").read()
    for ch in FORBIDDEN:
        if ch in txt:
            dash_hits.append("%s: U+%04X" % (fn, ord(ch)))
case("control", "no long dash characters anywhere in this directory", dash_hits == [], ", ".join(dash_hits))
vt = open(os.path.join(here, "agreement_verify.py"), encoding="utf-8").read()
case("control", "the verifier opens no socket: no urllib, no requests, no http client anywhere in it",
     not re.search(r"\b(urllib|requests|httpx|socket|http\.client)\b", vt), "")
case("control", "every refusal the draft names is implemented",
     V.DRAFT_CODES.issubset({c for rec in alls for c in codes(V.verify(rec, keys=KEYS))} | {"key_url_unreachable"}),
     str(sorted(V.DRAFT_CODES - ({c for rec in alls for c in codes(V.verify(rec, keys=KEYS))} | {"key_url_unreachable"}))))

# --- residual -------------------------------------------------------------------------------------

case("residual", "this verifier cannot tell whether a conduct record named by sha exists or says anything",
     True, "it checks 64 lower case hex and that the two parties named one each. Fetching them is the intake's job")
case("residual", "offline, the keys are whatever the person running this put in keys.json",
     True, "a party that serves a different key at key_url is caught by the intake, which fetches it, not here")
case("residual", "the terms are never judged",
     V.verify(signed(good(), BOTH), keys=KEYS)["verdict"] == "accepted",
     "an agreement to do something absurd, signed by both, is accepted. No editorial step exists and none may be added")
case("residual", "no anchor is checked here, so nothing in this report bounds agreed_at from above",
     True, "the upper bound comes from the Bitcoin anchor over the batch, and this program never sees one")
case("residual", "two keys signing the same bytes is not two humans agreeing",
     True, "it is two keys. Who holds them is what key_url and the card signature are for, and both are attribution, not proof of intent")

# --- report ---------------------------------------------------------------------------------------

k = {}
for kind, _n, ok, _d in R:
    a, b = k.get(kind, (0, 0))
    k[kind] = (a + (1 if ok else 0), b + 1)
print("--- 種別 ---")
for kind in ("attack", "control", "misclass", "residual"):
    if kind in k:
        print("  %-10s %d / %d" % (kind, k[kind][0], k[kind][1]))
print()
for kind, n, ok, d in R:
    if not ok:
        print("  NG  [%s] %s\n      %s" % (kind, n, d))
passed = sum(1 for _k, _n, ok, _d in R if ok)
print("=== %d / %d 合格 (a2a-agreement-v1 draft, verifier %s) ===" % (passed, len(R), V.VERIFIER_VERSION))
if passed == len(R):
    print("片側は受けん。同じバイトを覆っとらん 2 つの署名も受けん。鍵が無ければ accepted とは言わん。")
raise SystemExit(0 if passed == len(R) else 1)
