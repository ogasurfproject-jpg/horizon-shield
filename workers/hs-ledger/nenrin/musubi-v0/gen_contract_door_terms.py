#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Writes fixtures/contract_door/terms_corpus.json: the inputs on which contract_door_check.py holds grant.payload_schema and
grant.exposure (2026-11-09) together in contract_v0.py and contract_door_v0.mjs.

  doors     signed contracts whose payload_schema or exposure keeps or breaks one rule, and delegated children
  subsets   pairs of grants that differ in payload_schema or exposure
  payloads  a contract, an action and a payload: payload_problems must give the same codes in both runtimes

The two test keys are derived from fixed labels (sha256 of the label is the Ed25519 seed), so the file is the same each
time it is written and no key bytes are stored. Needs the cryptography package.

  python3 gen_contract_door_terms.py           rewrite the file
  python3 gen_contract_door_terms.py --check   exit 1 if the file is not what this script writes
"""
import base64, hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import contract_v0 as v0

OUT = os.path.join(HERE, "fixtures", "contract_door", "terms_corpus.json")


def key(label):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    k = Ed25519PrivateKey.from_private_bytes(hashlib.sha256(label.encode("ascii")).digest())
    pub = k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return k, base64.b64encode(pub).decode("ascii")


KA, PA = key("terms-corpus-principal")
KB, PB = key("terms-corpus-contractor")
PRINCIPAL = {"domain": "principal.example", "key_url": "https://principal.example/keys/a.json", "public_key_ed25519_b64": PA}
CONTRACTOR = {"domain": "contractor.example", "key_url": "https://contractor.example/keys/b.json", "public_key_ed25519_b64": PB}
NEED = {"admission": "required_before_execution", "evidence": "nenrin_required", "recovery": "n/a"}
DNE = ["that anyone enforced any of this at runtime", "that anyone judges liability or fault", "that a prohibited action was impossible, only that a deviation is provable",
       "that this is a legal contract"]
PS = {"schema": "payload-schema-v0", "other_fields": "refuse", "fields": {
    "kind": {"type": "enum", "values": ["a", "b", "c"], "required": True},
    "amount": {"type": "integer", "min": 1, "max": 1000, "required": True},
    "ref": {"type": "token", "max_chars": 8, "required": False},
    "note": {"type": "text", "max_chars": 4, "required": False}}}
EX = {"pay": {"window_blocks": 144, "max_acts": 4}}
BASE = {"authorized_actions": ["pay", "read"], "prohibited_actions": ["delete"], "limits": {"pay": {"max_amount": 20, "unit": "ticket"}}}


def J(x):
    return json.loads(json.dumps(x))


def signed(grant, n, requirements=NEED, parent=None):
    c = v0.build_contract(PRINCIPAL, CONTRACTOR, {"purpose": "terms corpus %d" % n}, J(grant), ["that both parties signed these grant bytes"], DNE,
                          requirements=requirements, parent_contract={"contract_id": parent["contract_id"]} if parent else None,
                          contract_id="%032x" % (0x7e000 + n), nonce="%032x" % (0x5e000 + n), agreed_at="2026-11-09T00:00:00Z")
    v0.sign_contract(c, KA, PA, PRINCIPAL["domain"]); v0.sign_contract(c, KB, PB, CONTRACTOR["domain"])
    return c


def field(name, **kv):
    s = J(PS); s["fields"][name] = dict(s["fields"][name], **kv)
    for k in [k for k, v in kv.items() if v is None]:
        del s["fields"][name][k]
    return s


def schemas():
    """(label, schema) pairs: well formed first, then each broken in one place"""
    good = [("the base schema", PS), ("one enum value", field("kind", values=["a"])), ("amount up to 20", field("amount", max=20)),
            ("ref required", field("ref", required=True)), ("no note", dict(PS, fields={k: v for k, v in PS["fields"].items() if k != "note"})),
            ("note up to 64", field("note", max_chars=64)), ("enum with values_from", field("kind", values_from={"path": "data/x.json", "sha256": "ab" * 32, "pointer": "/x/*/id"})),
            ("amount 0 to 0", field("amount", min=0, max=0)), ("one field", dict(PS, fields={"kind": PS["fields"]["kind"]})),
            ("ref as text", field("ref", type="text"))]
    bad = [("not an object", []), ("null", None), ("no schema key", {k: v for k, v in PS.items() if k != "schema"}), ("schema v1", dict(PS, schema="payload-schema-v1")),
           ("other_fields accept", dict(PS, other_fields="accept")), ("an extra key", dict(PS, extra=1)), ("no fields", dict(PS, fields={})),
           ("fields a list", dict(PS, fields=[])), ("65 fields", dict(PS, fields={"f%d" % i: {"type": "text", "max_chars": 1, "required": False} for i in range(65)})),
           ("a field name with a digit first", dict(PS, fields={"1x": PS["fields"]["kind"]})), ("a field name with a dash", dict(PS, fields={"a-b": PS["fields"]["kind"]})),
           ("a field name of 65", dict(PS, fields={"a" * 65: PS["fields"]["kind"]})), ("type float", field("amount", type="float")), ("type a list", field("amount", type=[])),
           ("min above max", field("amount", min=5, max=4)), ("min a string", field("amount", min="1")), ("max true", field("amount", max=True)),
           ("required a string", field("kind", required="yes")), ("required missing", field("kind", required=None)), ("an extra key in a field", field("kind", note="x")),
           ("an enum of none", field("kind", values=[])), ("an enum with a repeat", field("kind", values=["a", "a"])), ("an enum with an empty string", field("kind", values=[""])),
           ("an enum with a number", field("kind", values=["a", 1])), ("an enum of 1025", field("kind", values=["v%d" % i for i in range(1025)])),
           ("values_from without sha256", field("kind", values_from={"path": "x", "pointer": "/"})), ("values_from with uppercase sha256", field("kind", values_from={"path": "x", "sha256": "AB" * 32, "pointer": "/"})),
           ("values_from on an integer", field("amount", values_from={"path": "x", "sha256": "ab" * 32, "pointer": "/"})),
           ("token max 0", field("ref", max_chars=0)), ("token max 257", field("ref", max_chars=257)), ("text max 65537", field("note", max_chars=65537)),
           ("token max a string", field("ref", max_chars="8")), ("token with min", field("ref", min=1)), ("integer without max", field("amount", max=None))]
    return good, bad


def exposures():
    good = [("144 by 4", {"window_blocks": 144, "max_acts": 4}), ("6 by 1", {"window_blocks": 6, "max_acts": 1}), ("288 by 3", {"window_blocks": 288, "max_acts": 3}),
            ("4320 by 100000", {"window_blocks": 4320, "max_acts": 100000}), ("1 by 1", {"window_blocks": 1, "max_acts": 1})]
    bad = [("window 0", {"window_blocks": 0, "max_acts": 1}), ("window 4321", {"window_blocks": 4321, "max_acts": 1}), ("acts 0", {"window_blocks": 6, "max_acts": 0}),
           ("acts 100001", {"window_blocks": 6, "max_acts": 100001}), ("acts true", {"window_blocks": 6, "max_acts": True}), ("window a string", {"window_blocks": "6", "max_acts": 1}),
           ("an extra key", {"window_blocks": 6, "max_acts": 1, "per": "day"}), ("no acts", {"window_blocks": 6}), ("a list", [6, 1]), ("null", None)]
    return good, bad


def build():
    doors, subsets, payloads = [], [], []
    n = [0]

    def door(label, grant, requirements=NEED, parent=None, edit=None):
        n[0] += 1
        c = signed(grant, n[0], requirements, parent)
        if edit:
            edit(c)
        doors.append({"label": label, "contract": c, "parent": parent})
        return c

    gs, bs = schemas()
    ge, be = exposures()
    for label, s in gs + bs:
        door("payload_schema: " + label, dict(BASE, payload_schema={"pay": s}))
    for label, e in ge + be:
        door("exposure: " + label, dict(BASE, exposure={"pay": e}))
    both = dict(BASE, payload_schema={"pay": PS}, exposure=EX)
    ok = door("both, with admission", both)
    door("both, no requirements", both, requirements=None)
    door("both, admission optional", both, requirements=dict(NEED, admission="optional"))
    door("payload_schema only, no requirements", dict(BASE, limits=None, payload_schema={"pay": PS}), requirements=None)
    door("exposure only, no requirements", dict(BASE, limits=None, exposure=EX), requirements=None)
    door("payload_schema a list", dict(BASE, payload_schema=[PS]))
    door("exposure a string", dict(BASE, exposure="144/4"))
    door("payload_schema names an action outside the grant", dict(BASE, payload_schema={"ship": PS}))
    door("payload_schema names a prohibited action", dict(BASE, payload_schema={"delete": PS}))
    door("exposure names an action outside the grant", dict(BASE, exposure={"ship": EX["pay"]}))
    door("payload_schema on a conditional action", dict(BASE, conditional=[{"action": "pay_large", "requires": "principal_approval"}], payload_schema={"pay_large": PS}))
    door("payload_schema and exposure on two actions", dict(BASE, payload_schema={"pay": PS, "read": dict(PS, fields={"q": {"type": "token", "max_chars": 16, "required": True}})},
                                                            exposure={"pay": EX["pay"], "read": {"window_blocks": 6, "max_acts": 1}}))
    door("edited after signing: schema widened", both, edit=lambda c: c["grant"]["payload_schema"]["pay"]["fields"]["amount"].update(max=100000))
    door("edited after signing: exposure widened", both, edit=lambda c: c["grant"]["exposure"]["pay"].update(max_acts=40))
    parent = door("a parent with both", dict(both, delegation={"allowed": ["contractor.example"]}))
    for label, s in gs:
        for el, e in ge:
            door("child: %s, exposure %s" % (label, el), dict(BASE, payload_schema={"pay": s}, exposure={"pay": e}), parent=parent)
    door("child: no payload_schema", dict(BASE, exposure=EX), parent=parent)
    door("child: no exposure", dict(BASE, payload_schema={"pay": PS}), parent=parent)
    door("child: drops pay", dict(BASE, authorized_actions=["read"], limits=None), parent=parent)

    for _l1, a in gs:
        for _l2, b in gs:
            subsets.append({"child": {"authorized_actions": ["pay"], "payload_schema": {"pay": a}}, "parent": {"authorized_actions": ["pay", "read"], "payload_schema": {"pay": b}}})
    for _l1, a in ge:
        for _l2, b in ge:
            subsets.append({"child": {"authorized_actions": ["pay"], "exposure": {"pay": a}}, "parent": {"authorized_actions": ["pay", "read"], "exposure": {"pay": b}}})
    for _l, s in bs[:12]:
        subsets.append({"child": {"authorized_actions": ["pay"], "payload_schema": {"pay": PS}}, "parent": {"authorized_actions": ["pay"], "payload_schema": {"pay": s}}})
        subsets.append({"child": {"authorized_actions": ["pay"], "payload_schema": {"pay": s}}, "parent": {"authorized_actions": ["pay"], "payload_schema": {"pay": PS}}})
    subsets += [{"child": {"authorized_actions": ["pay"]}, "parent": {"authorized_actions": ["pay"], "payload_schema": {"pay": PS}, "exposure": EX}},
                {"child": {"authorized_actions": [], "prohibited_actions": ["pay"]}, "parent": {"authorized_actions": ["pay"], "payload_schema": {"pay": PS}, "exposure": EX}},
                {"child": {"authorized_actions": [], "conditional": [{"action": "pay", "requires": "x"}]}, "parent": {"authorized_actions": ["pay"], "payload_schema": {"pay": PS}}},
                {"child": {"authorized_actions": ["pay"], "payload_schema": {"pay": PS, "read": PS}}, "parent": {"authorized_actions": ["pay", "read"], "payload_schema": {"pay": PS}}}]

    plist = [{"kind": "a", "amount": 20}, {"kind": "c", "amount": 1000, "ref": "x-1.Y_2", "note": "abcd"}, {"kind": "a", "amount": 1, "note": "日本語で"},
             {"kind": "a", "amount": 1, "note": "日本語です"}, {"kind": "a", "amount": 1, "note": "\U0001F600\U0001F600\U0001F600\U0001F600"},
             {"kind": "a", "amount": 1, "note": "\U0001F600" * 5}, {"kind": "a", "amount": 1, "ref": ""}, {"kind": "a", "amount": 1, "ref": "12345678"},
             {"kind": "a", "amount": 1, "ref": "123456789"}, {"kind": "a", "amount": 1, "ref": "a b"}, {"kind": "a", "amount": 1, "ref": "a\n"},
             {"kind": "a", "amount": 1, "ref": 5}, {"kind": "a", "amount": 0}, {"kind": "a", "amount": 1001}, {"kind": "a", "amount": -3},
             {"kind": "a", "amount": True}, {"kind": "a", "amount": "20"}, {"kind": "a", "amount": None}, {"kind": "z", "amount": 20}, {"kind": "A", "amount": 20},
             {"kind": ["a"], "amount": 20}, {"kind": "a"}, {"amount": 20}, {}, {"kind": "a", "amount": 20, "extra": 1}, {"kind": "a", "amount": 20, "Kind": "a"},
             {"kind": "a", "extra": 1}, {"kind": "z", "extra": 1}, [], "x", None, 5, [{"kind": "a", "amount": 20}],
             {"kind": "a", "amount": 20, "note": None}, {"kind": "a", "amount": 20, "note": ""}, {"kind": "a", "amount": 20, "ref": "-"}]
    for p in plist:
        payloads.append({"contract": ok, "action": "pay", "payload": p})
    for a in ("read", "delete", "ship"):
        payloads.append({"contract": ok, "action": a, "payload": {"anything": 1}})
    payloads.append({"contract": {"grant": {"payload_schema": {"pay": {}}}}, "action": "pay", "payload": {}})
    payloads.append({"contract": {"grant": {"payload_schema": {"pay": None}}}, "action": "pay", "payload": {}})
    payloads.append({"contract": {"grant": {"payload_schema": []}}, "action": "pay", "payload": {}})
    payloads.append({"contract": {"grant": {"payload_schema": {"read": PS}}}, "action": "pay", "payload": {}})
    payloads.append({"contract": {"grant": {}}, "action": "pay", "payload": "x"})
    payloads.append({"contract": None, "action": "pay", "payload": "x"})
    return {"note": "Contracts, pairs of grants and payloads that keep or break one rule of grant.payload_schema or grant.exposure, signed with two test keys "
                    "derived from fixed labels (gen_contract_door_terms.py writes this file; no key bytes are in it). contract_door_check.py gives every one "
                    "to contract_v0.py and to contract_door_v0.mjs and compares.",
            "doors": doors, "subsets": subsets, "payloads": payloads}


def text():
    return json.dumps(build(), ensure_ascii=True, sort_keys=True, separators=(",", ":")) + "\n"


def main(argv):
    t = text()
    if "--check" in argv:
        same = os.path.exists(OUT) and open(OUT, encoding="utf-8").read() == t
        print("terms_corpus.json is what gen_contract_door_terms.py writes" if same else "terms_corpus.json differs from what gen_contract_door_terms.py writes")
        return 0 if same else 1
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, "w", encoding="utf-8", newline="").write(t)
    print("wrote %s (%d bytes)" % (OUT, len(t)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
