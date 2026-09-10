#!/usr/bin/env python3
"""Adversary for a2a-agreement-v1 (draft) and its verifier. Offline, deterministic, real Ed25519
keys from fixed seeds, no network, no ledger, no clock. Run: python3 agreement_redteam.py

Every vector is a refusal, a separation, or a control that must NOT refuse. Nothing here scores
anybody. A vector that only proves the verifier says yes to a good record is worth as much as one
that proves it says no to a bad one, so both are counted, in their own columns.
"""

import copy
import json
import os
import re
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import agreement_verify as V
import agreement_sign as S

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
ex = V.EXAMPLE
case("control", "the example record handed to newcomers is correct in every way except that nobody has signed it",
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


_walk(signed(good(), BOTH))
_crashes, _bad_accept, _runs = [], 0, 0
for _t in range(1500):
    _rec = signed(good(), BOTH)
    for _ in range(_rnd.randint(1, 3)):
        try:
            _setp(_rec, _rnd.choice(_paths), copy.deepcopy(_rnd.choice(_vals)))
        except Exception:
            pass
    if _rnd.random() < 0.2:
        _rec = _rnd.choice([_rec, [_rec], "string", 5, None, {}])
    for _k in (None, KEYS):
        _runs += 1
        try:
            _rp = V.verify(_rec, keys=_k, recorder_domain="party-b.example", now="2026-09-11T00:00:00Z")
            if _rp["verdict"] == "accepted" and (_rp["refusals"] or not _rp["signatures_checked"]):
                _bad_accept += 1
        except Exception as _e:
            _crashes.append(type(_e).__name__)
case("attack", "%d mutated records, half of them with no keys: no traceback ever escapes" % _runs,
     _crashes == [], ", ".join(sorted(set(_crashes))))
case("control", "and none of them is accepted while carrying a refusal or an unchecked signature",
     _bad_accept == 0, str(_bad_accept))

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
