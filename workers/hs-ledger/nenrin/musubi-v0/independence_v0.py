#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MUSUBI independence v0: from "three keys" toward "three control domains", as counts (a2a-independence-v0).

Why this file exists. Every layer here compares actors by Ed25519 public key. settle v1.4 refuses a
contract in which one key is held by two roles (key_conflict) and a party that signs as its own witness.
That is key independence. It says nothing about organizational independence: one owner with three
keys is three actors to every verifier in this directory and one economic subject in the world. An
outside review (2026-09-26, holes 2 and 4) named it: key independence is not organizational
independence, and a fair draw from a poisoned witness pool is a fair draw from a poisoned pool.

HS will not answer that with central identity verification; that would break the design at the root.
The honest step is the same one every other layer took: a DECLARATION inside signed bytes, and a
MEASUREMENT anyone recomputes.

  1. a2a-actor-declaration-v0: the holder of a key states, over that key's own signature, which legal
     entity answers for the key (registry, scheme, id: the same triple legal-entity-v1 puts inside a
     signed agent card), the domain and key_url the key lives under, and optionally the AS number it
     operates from. Declared once per key; usable across contracts. Two different declarations for one
     key, both signed, are a provable contradiction and this verifier refuses the pair.
  2. The independence VECTOR of a contract's actors (principal, contractor, every witness) is a set of
     counts: distinct keys, distinct hosts, distinct sites, distinct key hosts, distinct legal entities,
     distinct AS numbers, plus the groups that share an entity and which witnesses share one with a party.
     Counts, never scores. Undeclared actors are counted as undeclared, not guessed.
  3. A contract may state a QUORUM in requirements.independence (min_distinct_legal_entities and the
     like). The verdict is met / not_met / undetermined: not_met only when the missing declarations
     could not change it (a fresh entity per undeclared actor still falls short); undetermined when
     they could. Nothing is inferred about who really controls whom.
  4. The same vector runs over a witness POOL (a list of declarations) so a selection layer can state
     how many distinct entities the pool holds and how many actors the largest entity holds.

What this establishes: that these keys, over their own signatures, declared these entities, and that
the counts follow from the declarations. What it does not: that a declaration is true; that two
entities are not one owner behind two registrations; that the register lists the identifier. The
declarant asserts, the register answers, the reader looks it up at lookup_url. The gain is the same as
legal-entity-v1's: the assertion sits inside signed bytes, so a later "we never said that" is refuted
by the bytes, and a lie is a provable lie rather than an absence.
"""
import argparse, base64, hashlib, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import contract_v0 as v0
from contract_v0 import canonical, parse_strict, contract_sha256, HEX64
from agreement_verify import b64_raw, norm_domain, host_of_https, ed25519_verify, scan_numbers

DECL_SCHEMA = "a2a-actor-declaration-v0"
DECL_CONTEXT = b"a2a-actor-declaration-v0\n"
OUT_SCHEMA = "a2a-independence-v0"

# Key doors, the rule every record here follows: a key no verifier reads is refused, never ignored.
DECL_KEYS = frozenset(("schema", "public_key_ed25519_b64", "domain", "key_url", "legal_entity", "asn",
                       "card_sha256", "contract_sha256", "declared_at", "signatures"))
LE_KEYS = frozenset(("registry", "scheme", "id", "name", "lookup_url"))
REQ_KEYS = frozenset(("min_distinct_legal_entities", "min_distinct_sites", "min_distinct_key_hosts",
                      "min_distinct_asns", "witnesses_independent_of_parties", "declarations_required"))
COUNT_REQS = {"min_distinct_legal_entities": "distinct_legal_entities", "min_distinct_sites": "distinct_sites",
              "min_distinct_key_hosts": "distinct_key_hosts", "min_distinct_asns": "distinct_asns"}

REGISTRY = re.compile(r"^[A-Z]{2}$|^GLEIF$")
SCHEME_RULES = {"houjin-bango": re.compile(r"^[0-9]{13}$"), "lei": re.compile(r"^[A-Z0-9]{18}[0-9]{2}$")}
MAX_ASN = 4294967295

# Site rule. No public suffix list ships here (it would be a network dependency or a stale copy), so a
# "site" is the last two labels, or three under these well known second level suffixes. Reported next
# to distinct_hosts so the reader sees both and knows the rule.
SECOND_LEVEL = frozenset(("co.jp", "ne.jp", "or.jp", "ac.jp", "go.jp", "gr.jp", "lg.jp", "ed.jp", "ad.jp",
                          "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "ltd.uk", "plc.uk",
                          "com.au", "net.au", "org.au", "edu.au", "gov.au", "co.nz", "org.nz", "net.nz",
                          "com.br", "co.kr", "or.kr", "co.in", "com.cn", "com.tw", "com.sg", "com.hk",
                          "co.za", "com.mx", "com.ar", "co.id", "com.my", "com.tr", "co.th"))
SITE_RULE = "last two labels, or three under a listed second level suffix (no public suffix list; see SECOND_LEVEL)"


# --------------------------------------------------------------------------- helpers
def sha256_hex(b):
    if isinstance(b, str):
        b = b.encode("utf-8")
    return hashlib.sha256(b).hexdigest()


def _is_int(x):
    return isinstance(x, int) and not isinstance(x, bool)


def site_of(host):
    """The site a host belongs to under SITE_RULE. None for a non host."""
    h = norm_domain(host)
    if not h:
        return None
    labels = h.split(".")
    if len(labels) >= 3 and ".".join(labels[-2:]) in SECOND_LEVEL:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def declaration_signing_bytes(decl):
    body = {k: v for k, v in decl.items() if k != "signatures"}
    return DECL_CONTEXT + canonical(body).encode("utf-8")


def declaration_sha256(decl):
    return sha256_hex(declaration_signing_bytes(decl))


def _where(d, i, label="declaration"):
    """A name for a declaration in messages that does not depend on its position in the input, so the output is
    identical under any input order: the digest of its signed body when it has one, else its index."""
    try:
        return "%s %s" % (label, declaration_sha256(d)[:16])
    except Exception:  # noqa: BLE001
        return "%s[%d]" % (label, i)


def legal_entity_key(le):
    """The comparable identity of a legal entity: registry, scheme, id. Name is display only."""
    return "%s:%s:%s" % (le["registry"], le["scheme"], le["id"])


# --------------------------------------------------------------------------- build / sign
def build_declaration(public_key_b64, domain, key_url, legal_entity=None, asn=None, card_sha256=None,
                      contract_sha256_=None, declared_at=None):
    """The UNSIGNED declaration. legal_entity: {registry, scheme, id, name, lookup_url?} or None when the
    holder declares no entity (that is a statement too: the key answers for nobody in a register)."""
    rec = {"schema": DECL_SCHEMA, "public_key_ed25519_b64": public_key_b64, "domain": domain, "key_url": key_url,
           "legal_entity": dict(legal_entity) if legal_entity else None, "signatures": []}
    if asn is not None:
        rec["asn"] = asn
    if card_sha256 is not None:
        rec["card_sha256"] = card_sha256
    if contract_sha256_ is not None:
        rec["contract_sha256"] = contract_sha256_
    if declared_at is not None:
        rec["declared_at"] = declared_at
    return rec


def sign_declaration(decl, key):
    sig = base64.b64encode(key.sign(declaration_signing_bytes(decl))).decode("ascii")
    decl.setdefault("signatures", []).append({"alg": "ed25519", "sig_b64": sig})
    return decl


# --------------------------------------------------------------------------- declarations
def _door(r, obj, allowed, where, code):
    extra = sorted(k for k in obj.keys() if k not in allowed)
    if extra:
        r.refuse(code, "%s carries keys no verifier reads: %s" % (where, ", ".join(extra)))


def _check_legal_entity(r, le, where):
    if le is None:
        return None
    if not isinstance(le, dict):
        r.refuse("bad_legal_entity", "%s.legal_entity must be an object or null" % where)
        return None
    _door(r, le, LE_KEYS, where + ".legal_entity", "unknown_legal_entity_key")
    ok = True
    for f in ("registry", "scheme", "id", "name"):
        if not (isinstance(le.get(f), str) and le[f]):
            r.refuse("bad_legal_entity", "%s.legal_entity.%s must be a non empty string" % (where, f)); ok = False
    if not ok:
        return None
    if not REGISTRY.match(le["registry"]):
        r.refuse("bad_legal_entity", "%s.legal_entity.registry must be ISO 3166-1 alpha-2 or GLEIF" % where); ok = False
    rule = SCHEME_RULES.get(le["scheme"])
    if rule is not None and not rule.match(le["id"]):
        r.refuse("bad_legal_entity", "%s.legal_entity.id %r does not fit scheme %s" % (where, le["id"], le["scheme"])); ok = False
    if le.get("lookup_url") is not None and not host_of_https(le["lookup_url"]):
        r.refuse("bad_legal_entity", "%s.legal_entity.lookup_url must be an https URL" % where); ok = False
    if le["scheme"] not in SCHEME_RULES:
        r.find("scheme_unchecked", "%s.legal_entity.scheme %r has no id rule here; the id is carried as given" % (where, le["scheme"]))
    return legal_entity_key(le) if ok else None


def check_declaration(decl, where="declaration"):
    """Shape and self signature of one declaration. Returns (R, key_b64 or None)."""
    r = v0.R()
    if not isinstance(decl, dict) or decl.get("schema") != DECL_SCHEMA:
        r.refuse("bad_schema", "%s is not an %s record" % (where, DECL_SCHEMA))
        return r, None
    _door(r, decl, DECL_KEYS, where, "unknown_declaration_key")
    for path, why, shown in scan_numbers(decl):
        r.refuse("unsafe_number" if why != "not an integer" else "non_integer_number", "%s %s is %s (%s)" % (where, path, why, shown))
    pub = decl.get("public_key_ed25519_b64")
    if b64_raw(pub, 32) is None:
        r.refuse("bad_public_key", "%s.public_key_ed25519_b64 must be 32 bytes of canonical base64" % where)
        pub = None
    if not norm_domain(decl.get("domain")):
        r.refuse("bad_domain", "%s.domain must be a bare hostname" % where)
    kh = host_of_https(decl.get("key_url"))
    if not kh:
        r.refuse("bad_key_url", "%s.key_url must be an https URL" % where)
    elif norm_domain(decl.get("domain")) and not (kh == norm_domain(decl["domain"]) or kh.endswith("." + norm_domain(decl["domain"]))):
        r.find("key_url_off_domain", "%s.key_url host %s is not under %s" % (where, kh, decl["domain"]))
    _check_legal_entity(r, decl.get("legal_entity"), where)
    if "asn" in decl and not (_is_int(decl["asn"]) and 0 < decl["asn"] <= MAX_ASN):
        r.refuse("bad_asn", "%s.asn must be a positive integer up to %d" % (where, MAX_ASN))
    for f in ("card_sha256", "contract_sha256"):
        if f in decl and not (isinstance(decl[f], str) and HEX64.match(decl[f])):
            r.refuse("bad_field", "%s.%s must be 64 lowercase hex" % (where, f))
    if "declared_at" in decl and not isinstance(decl["declared_at"], str):
        r.refuse("bad_field", "%s.declared_at must be a string" % where)
    sigs = decl.get("signatures")
    signed = False
    if pub and isinstance(sigs, list):
        msg = declaration_signing_bytes(decl)
        for s in sigs:
            if isinstance(s, dict) and s.get("alg") == "ed25519" and ed25519_verify(pub, s.get("sig_b64"), msg) is True:
                signed = True
    if not signed:
        r.refuse("not_signed_by_declared_key", "%s carries no valid signature by its own public key" % where)
    return r, pub


# --------------------------------------------------------------------------- actors and the vector
def contract_actors(contract):
    """[{id, role, key, domain, key_url}] for the two parties and every witness. Witness domain and
    key_url are None until a declaration supplies them."""
    out = []
    for p in (contract.get("parties") or []):
        if isinstance(p, dict):
            out.append({"id": p.get("role"), "role": p.get("role"), "key": p.get("public_key_ed25519_b64"),
                        "domain": norm_domain(p.get("domain")), "key_url": p.get("key_url")})
    grant = contract.get("grant") if isinstance(contract.get("grant"), dict) else {}
    for w in (grant.get("witnesses") or []):
        if isinstance(w, dict):
            out.append({"id": "witness:%s" % w.get("name"), "role": "witness", "key": w.get("public_key_ed25519_b64"),
                        "domain": None, "key_url": None})
    return out


def _attach(r, actors, declarations, csha):
    """Match declarations to actors by key. Returns {actor_id: declaration or None}."""
    by_key = {a["key"]: a for a in actors if a.get("key")}
    chosen = {}
    for i, d in enumerate(declarations or []):
        where = _where(d, i)
        dr, pub = check_declaration(d, where)
        r.refusals.extend(dr.refusals); r.findings.extend(dr.findings)
        if dr.refusals or pub is None:
            continue
        if csha is not None and d.get("contract_sha256") not in (None, csha):
            r.find("declaration_names_other_contract", "%s names contract %s; ignored here" % (where, d["contract_sha256"]))
            continue
        a = by_key.get(pub)
        if a is None:
            r.find("declaration_for_stranger", "%s is signed by a key that is not a party or witness here; ignored" % where)
            continue
        if a["domain"] and norm_domain(d.get("domain")) != a["domain"]:
            r.refuse("declaration_domain_mismatch", "%s: the %s key is pinned under %s in the contract and declares %s"
                     % (where, a["id"], a["domain"], d.get("domain")))
            continue
        prev = chosen.get(pub)
        if prev is not None and declaration_sha256(prev) != declaration_sha256(d):
            r.refuse("conflicting_declarations", "two different signed declarations for the %s key; the pair is a provable contradiction, "
                                                 "%s and %s" % (a["id"], declaration_sha256(prev)[:16], declaration_sha256(d)[:16]))
            continue
        chosen[pub] = d
    return {a["id"]: chosen.get(a["key"]) for a in actors}


def independence_vector(actors, decl_by_id):
    """Counts over the actor set. Every value is a count or a list of actor ids; nothing is weighted."""
    keys, hosts, sites, key_hosts, entities, asns = set(), set(), set(), set(), {}, set()
    undeclared = []
    site_by_actor = {}
    for a in actors:
        raw = b64_raw(a.get("key"), 32)
        if raw is not None:
            keys.add(raw)
        d = decl_by_id.get(a["id"])
        dom = a["domain"] or (norm_domain(d.get("domain")) if d else None)
        ku = a["key_url"] or (d.get("key_url") if d else None)
        if dom:
            hosts.add(dom); s = site_of(dom); sites.add(s); site_by_actor[a["id"]] = s
        kh = host_of_https(ku)
        if kh:
            key_hosts.add(kh)
        if d is None:
            undeclared.append(a["id"])
            continue
        le = d.get("legal_entity")
        if isinstance(le, dict):
            entities.setdefault(legal_entity_key(le), []).append(a["id"])
        if _is_int(d.get("asn")):
            asns.add(d["asn"])
    shared = [{"legal_entity": k, "actors": sorted(v)} for k, v in sorted(entities.items()) if len(v) > 1]
    party_entities = {k for k, v in entities.items() if any(x in ("principal", "contractor") for x in v)}
    overlap = sorted(x for k in party_entities for x in entities[k] if x.startswith("witness:"))
    party_sites = {site_by_actor.get(x) for x in ("principal", "contractor")} - {None}
    under_party_site = sorted(x for x, s in site_by_actor.items() if x.startswith("witness:") and s in party_sites)
    no_entity = sorted(a["id"] for a in actors if decl_by_id.get(a["id"]) is not None and decl_by_id[a["id"]].get("legal_entity") is None)
    return {"actors": len(actors), "declared": len(actors) - len(undeclared), "undeclared": sorted(undeclared),
            "declared_no_entity": no_entity,
            "distinct_keys": len(keys), "distinct_hosts": len(hosts), "distinct_sites": len(sites),
            "distinct_key_hosts": len(key_hosts), "distinct_legal_entities": len(entities), "distinct_asns": len(asns),
            "shared_legal_entity": shared, "witness_party_overlap": overlap, "witness_under_party_site": under_party_site,
            "site_rule": SITE_RULE}


# --------------------------------------------------------------------------- quorum
def _check_requirements(r, req):
    if req is None:
        return None
    if not isinstance(req, dict):
        r.refuse("bad_requirements", "requirements.independence must be an object")
        return None
    _door(r, req, REQ_KEYS, "requirements.independence", "unknown_requirement_key")
    for k in COUNT_REQS:
        if k in req and not (_is_int(req[k]) and req[k] >= 1):
            r.refuse("bad_requirements", "requirements.independence.%s must be a positive integer" % k)
    for k in ("witnesses_independent_of_parties", "declarations_required"):
        if k in req and not isinstance(req[k], bool):
            r.refuse("bad_requirements", "requirements.independence.%s must be true or false" % k)
    return req


def evaluate_quorum(vec, req):
    """Per rule: met / not_met / undetermined. not_met only when every undeclared actor being a fresh
    value would still fall short; undetermined when declarations could still change it."""
    rules = []
    n_und = len(vec["undeclared"])
    for k, field in COUNT_REQS.items():
        if k not in req:
            continue
        have, need = vec[field], req[k]
        # for entities and asns an undeclared actor may add one; for sites and key hosts a witness without
        # a declaration also lacks a host, so the same reasoning applies to those counts
        if have >= need:
            st = "met"
        elif have + n_und >= need:
            st = "undetermined"
        else:
            st = "not_met"
        rules.append({"rule": k, "required": need, "counted": have, "undeclared": n_und, "status": st})
    if req.get("witnesses_independent_of_parties"):
        if vec["witness_party_overlap"]:
            st = "not_met"
        elif any(x.startswith("witness:") for x in vec["undeclared"]) or \
                any(x in ("principal", "contractor") for x in vec["undeclared"]):
            st = "undetermined"
        else:
            st = "met"
        rules.append({"rule": "witnesses_independent_of_parties", "overlap": vec["witness_party_overlap"],
                      "undeclared": vec["undeclared"], "status": st})
    if req.get("declarations_required"):
        rules.append({"rule": "declarations_required", "undeclared": vec["undeclared"],
                      "status": "met" if not vec["undeclared"] else "undetermined"})
    sts = {x["status"] for x in rules}
    verdict = "not_met" if "not_met" in sts else ("undetermined" if "undetermined" in sts else "met")
    return verdict, rules


def verify_independence(contract, declarations=None):
    """Offline. The contract's actors, the declarations that match them, the vector, and the quorum the
    contract states in requirements.independence (verdict 'measured' when it states none)."""
    r = v0.R()
    if not isinstance(contract, dict) or contract.get("schema") != v0.SCHEMA:
        r.refuse("bad_contract", "not an %s record" % v0.SCHEMA)
        return _out(r, None, None, None, "refused")
    csha = contract_sha256(contract)
    actors = contract_actors(contract)
    if len([a for a in actors if a["role"] in ("principal", "contractor")]) != 2:
        r.refuse("bad_contract", "contract must carry exactly two parties")
    reqs = contract.get("requirements") if isinstance(contract.get("requirements"), dict) else {}
    req = _check_requirements(r, reqs.get("independence"))
    decl_by_id = _attach(r, actors, declarations, csha)
    if r.refusals:
        return _out(r, csha, None, None, "refused")
    vec = independence_vector(actors, decl_by_id)
    if vec["witness_party_overlap"]:
        r.find("witness_shares_entity_with_party", "witnesses %s declare the same legal entity as a party" % vec["witness_party_overlap"])
    if vec["witness_under_party_site"]:
        r.find("witness_under_party_site", "witnesses %s live under a party's site (%s)" % (vec["witness_under_party_site"], SITE_RULE))
    if req is None:
        return _out(r, csha, vec, None, "measured")
    verdict, rules = evaluate_quorum(vec, req)
    return _out(r, csha, vec, rules, verdict)


def pool_vector(declarations):
    """The vector over a witness pool given as declarations only (no contract). Adds largest_entity_actors
    so a selection layer can state how much of the pool one entity holds, as a count."""
    r = v0.R()
    actors, decl_by_id, seen = [], {}, {}
    for i, d in enumerate(declarations or []):
        dr, pub = check_declaration(d, _where(d, i, "pool"))
        r.refusals.extend(dr.refusals); r.findings.extend(dr.findings)
        if dr.refusals or pub is None:
            continue
        if pub in seen:
            if declaration_sha256(seen[pub]) != declaration_sha256(d):
                r.refuse("conflicting_declarations", "pool holds two different signed declarations for one key")
            continue
        seen[pub] = d
        aid = "pool:%s" % sha256_hex(pub)[:16]
        actors.append({"id": aid, "role": "witness", "key": pub, "domain": None, "key_url": None})
        decl_by_id[aid] = d
    if r.refusals:
        return _out(r, None, None, None, "refused")
    vec = independence_vector(actors, decl_by_id)
    groups = {}
    for a in actors:
        le = decl_by_id[a["id"]].get("legal_entity")
        if isinstance(le, dict):
            groups[legal_entity_key(le)] = groups.get(legal_entity_key(le), 0) + 1
    vec["largest_entity_actors"] = max(groups.values()) if groups else 0
    vec["pool_size"] = len(actors)
    for k in ("witness_party_overlap", "witness_under_party_site"):
        vec.pop(k, None)
    return _out(r, None, vec, None, "measured")


def _out(r, csha, vec, rules, verdict):
    out = {"schema": OUT_SCHEMA, "verdict": verdict, "contract_sha256": csha,
           "refusals": sorted(r.refusals, key=canonical), "findings": sorted(r.findings, key=canonical),
           "vector": vec, "quorum": rules,
           "establishes": [
               "that each counted key declared, over its own signature, the entity, domain and key host counted for it",
               "that every count here follows from those declarations and the contract by a function anyone recomputes",
           ],
           "does_not_establish": [
               "that any declaration is true; the declarant asserts, the register answers, look the identifier up yourself",
               "that two distinct legal entities are not one owner behind two registrations",
               "that an undeclared actor is independent or dependent; it is counted as undeclared",
               "that HS verified identity; nothing here fetched anything or consulted a register",
           ]}
    return out


# --------------------------------------------------------------------------- self test
def _selftest():
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    import random

    def newkey():
        k = Ed25519PrivateKey.generate()
        return k, base64.b64encode(k.public_key().public_bytes(serialization.Encoding.Raw,
                                                               serialization.PublicFormat.Raw)).decode()

    def codes(out):
        return {x["code"] for x in out["refusals"]}

    def fcodes(out):
        return {x["code"] for x in out["findings"]}

    HS = {"registry": "JP", "scheme": "houjin-bango", "id": "7021001075279", "name": "The HORIZONs Co., Ltd.",
          "lookup_url": "https://www.houjin-bangou.nta.go.jp/henkorireki-johoto.html?selHouzinNo=7021001075279"}
    BBV = {"registry": "GLEIF", "scheme": "lei", "id": "5493001KJTIIGC8Y1R12", "name": "Baby Blue Viper LLC"}
    W3 = {"registry": "JP", "scheme": "houjin-bango", "id": "1234567890123", "name": "Witness Three K.K."}
    DNE = ["that HS enforced any of this at runtime",
           "that the contractor obeyed the grant, only that its recorded acts match or deviate from it",
           "that HS judges liability or fault; the verdict is a function anyone recomputes",
           "that a prohibited action was impossible, only that performing one is a provable deviation",
           "that this is a legal contract or determines legal responsibility"]

    ka, pa = newkey(); kb, pb = newkey(); kw, pw = newkey(); kx, px = newkey()

    def mk(independence=None, witnesses=None):
        grant = {"authorized_actions": ["read"], "prohibited_actions": ["delete"], "delegation": {"allowed": []},
                 "revocation": {"effective_at": "anchor"}, "finality": {"depth": 3, "max_target_bits": "207fffff"},
                 "witnesses": witnesses if witnesses is not None else [{"name": "w", "public_key_ed25519_b64": pw}]}
        reqs = {"evidence": "nenrin_required", "recovery": "tsugi_required"}
        if independence is not None:
            reqs["independence"] = independence
        c = v0.build_contract(
            {"domain": "gate.horizonshield.dev", "key_url": "https://gate.horizonshield.dev/keys/agreement.json", "public_key_ed25519_b64": pa},
            {"domain": "api.babyblueviper.com", "key_url": "https://api.babyblueviper.com/keys/agreement.json", "public_key_ed25519_b64": pb},
            {"purpose": "endpoint_conduct_walk", "payload_digest": "a" * 64}, grant,
            ["that both parties signed these grant bytes at the stated time"], DNE, requirements=reqs,
            lower_bound={"kind": "bitcoin_block", "height": 968325, "hash": "0" * 64},
            contract_id="0123456789abcdef0123456789abcdef", nonce="c" * 32, agreed_at="2026-09-26T00:00:00Z")
        v0.sign_contract(c, ka, pa, "gate.horizonshield.dev"); v0.sign_contract(c, kb, pb, "api.babyblueviper.com")
        return c

    def decl(key, pub, domain, le, asn=None, **kw):
        d = build_declaration(pub, domain, "https://%s/keys/agreement.json" % domain, le, asn=asn, **kw)
        return sign_declaration(d, key)

    dA = decl(ka, pa, "gate.horizonshield.dev", HS, asn=13335)
    dB = decl(kb, pb, "api.babyblueviper.com", BBV, asn=16509)
    dW = decl(kw, pw, "witness3.example", W3, asn=2516)
    Q3 = {"min_distinct_legal_entities": 3, "witnesses_independent_of_parties": True, "declarations_required": True}
    n = 0

    # [1] honest: three keys, three entities, three AS numbers; quorum met; contract still verifies with the block
    c = mk(Q3)
    assert v0.verify_contract(c)["verdict"] == "accepted"
    out = verify_independence(c, [dA, dB, dW])
    v = out["vector"]
    assert out["verdict"] == "met", out
    assert (v["actors"], v["declared"], v["distinct_keys"], v["distinct_legal_entities"], v["distinct_asns"], v["distinct_sites"]) == (3, 3, 3, 3, 3, 3), v
    assert v["shared_legal_entity"] == [] and v["witness_party_overlap"] == []
    n += 1; print("[1] three actors, three declared entities, three AS numbers: quorum met; verify_contract accepts requirements.independence")

    # [2] the picture from the review: Owner X holds agent A, agent B and witness C. Three keys, one entity.
    dA1 = decl(ka, pa, "gate.horizonshield.dev", HS); dB1 = decl(kb, pb, "api.babyblueviper.com", HS); dW1 = decl(kw, pw, "witness3.example", HS)
    out = verify_independence(c, [dA1, dB1, dW1])
    v = out["vector"]
    assert out["verdict"] == "not_met" and v["distinct_keys"] == 3 and v["distinct_legal_entities"] == 1, out
    assert v["shared_legal_entity"] == [{"legal_entity": "JP:houjin-bango:7021001075279", "actors": ["contractor", "principal", "witness:w"]}]
    assert v["witness_party_overlap"] == ["witness:w"] and "witness_shares_entity_with_party" in fcodes(out)
    st = {x["rule"]: x["status"] for x in out["quorum"]}
    assert st == {"min_distinct_legal_entities": "not_met", "witnesses_independent_of_parties": "not_met", "declarations_required": "met"}, st
    n += 1; print("[2] one owner, three keys: distinct_keys 3, distinct_legal_entities 1, the shared group named, witness overlap named: not_met")

    # [3] undeclared witness: two entities declared, one actor undeclared. min 3 could still be reached: undetermined. min 4 cannot: not_met
    out = verify_independence(c, [dA, dB])
    assert out["verdict"] == "undetermined" and out["vector"]["undeclared"] == ["witness:w"], out
    st = {x["rule"]: x["status"] for x in out["quorum"]}
    assert st["min_distinct_legal_entities"] == "undetermined" and st["witnesses_independent_of_parties"] == "undetermined" and st["declarations_required"] == "undetermined"
    c4 = mk({"min_distinct_legal_entities": 4})
    out = verify_independence(c4, [dA, dB])
    assert out["verdict"] == "not_met", out
    n += 1; print("[3] one undeclared actor: min 3 undetermined (a declaration could still meet it); min 4 not_met (no declaration could)")

    # [4] forged, stranger, conflicting declarations
    forged = build_declaration(pw, "witness3.example", "https://witness3.example/keys/agreement.json", W3)
    sign_declaration(forged, kx)                                                    # someone else's key signs for w
    out = verify_independence(c, [dA, dB, forged])
    assert out["verdict"] == "refused" and "not_signed_by_declared_key" in codes(out), out
    stranger = decl(kx, px, "stranger.example", W3)
    out = verify_independence(c, [dA, dB, dW, stranger])
    assert out["verdict"] == "met" and "declaration_for_stranger" in fcodes(out), out
    dW2 = decl(kw, pw, "witness3.example", BBV)                                    # same key, a different entity
    out = verify_independence(c, [dA, dB, dW, dW2])
    assert out["verdict"] == "refused" and "conflicting_declarations" in codes(out), out
    assert verify_independence(c, [dA, dB, dW, json.loads(json.dumps(dW))])["verdict"] == "met"   # the same declaration twice is fine
    n += 1; print("[4] declaration signed by another key: refused; stranger's declaration: ignored with a finding; two entities for one key: refused as a contradiction; a duplicate copy is fine")

    # [5] a party key declaring a domain other than the one the contract pins; a declaration for another contract
    dA_wrong = decl(ka, pa, "somewhere-else.example", HS)
    out = verify_independence(c, [dA_wrong, dB, dW])
    assert out["verdict"] == "refused" and "declaration_domain_mismatch" in codes(out), out
    dW_other = decl(kw, pw, "witness3.example", W3, contract_sha256_="f" * 64)
    out = verify_independence(c, [dA, dB, dW_other])
    assert out["verdict"] == "undetermined" and "declaration_names_other_contract" in fcodes(out), out
    dW_this = decl(kw, pw, "witness3.example", W3, contract_sha256_=contract_sha256(c))
    assert verify_independence(c, [dA, dB, dW_this])["verdict"] == "met"
    n += 1; print("[5] party declares a domain the contract does not pin: refused; declaration bound to another contract: ignored; bound to this one: counted")

    # [6] key doors and identifier rules
    k1 = json.loads(json.dumps(dW)); k1["owner_note"] = "trust me"
    out = verify_independence(c, [dA, dB, k1])
    assert "unknown_declaration_key" in codes(out) or "not_signed_by_declared_key" in codes(out)
    bad_id = decl(kw, pw, "witness3.example", dict(W3, id="123456789012"))          # 12 digits
    assert "bad_legal_entity" in codes(verify_independence(c, [dA, dB, bad_id]))
    bad_reg = decl(kw, pw, "witness3.example", dict(W3, registry="Japan"))
    assert "bad_legal_entity" in codes(verify_independence(c, [dA, dB, bad_reg]))
    cq = mk({"min_distinct_legal_entities": 3, "min_trust_score": 90})
    out = verify_independence(cq, [dA, dB, dW])
    assert out["verdict"] == "refused" and "unknown_requirement_key" in codes(out), out
    cz = mk({"min_distinct_legal_entities": 0})
    assert "bad_requirements" in codes(verify_independence(cz, [dA, dB, dW]))
    other_scheme = decl(kw, pw, "witness3.example", {"registry": "DE", "scheme": "hrb", "id": "HRB 12345", "name": "Zeuge GmbH"})
    out = verify_independence(c, [dA, dB, other_scheme])
    assert out["verdict"] == "met" and "scheme_unchecked" in fcodes(out), out
    n += 1; print("[6] unknown key in a declaration, 12 digit houjin bangou, registry 'Japan', min_trust_score in the quorum, min 0: refused; an unlisted scheme is carried with a finding")

    # [7] site rule and a witness under a party's site
    kw2, pw2 = newkey()
    cw = mk({"min_distinct_sites": 3}, witnesses=[{"name": "w", "public_key_ed25519_b64": pw}, {"name": "w2", "public_key_ed25519_b64": pw2}])
    dW_site = decl(kw, pw, "witness.gate.horizonshield.dev", W3)                     # under the principal's site
    dW2_site = decl(kw2, pw2, "b.example.co.jp", {"registry": "JP", "scheme": "houjin-bango", "id": "9876543210987", "name": "B K.K."})
    out = verify_independence(cw, [dA, dB, dW_site, dW2_site])
    v = out["vector"]
    assert v["distinct_hosts"] == 4 and v["distinct_sites"] == 3, v
    assert v["witness_under_party_site"] == ["witness:w"] and "witness_under_party_site" in fcodes(out), out
    assert out["verdict"] == "met"                                                  # 3 sites: horizonshield.dev, babyblueviper.com, example.co.jp
    assert site_of("a.example.co.jp") == "example.co.jp" and site_of("x.y.example.com") == "example.com" and site_of("localhost") is None
    n += 1; print("[7] four hosts, three sites (co.jp handled); a witness under the principal's site is named as a finding")

    # [8] a witness pool: ten declarations, eight under one entity; counts, deterministic under shuffle
    pool = []
    for i in range(10):
        k, p = newkey()
        le = HS if i < 8 else {"registry": "JP", "scheme": "houjin-bango", "id": "%013d" % (1000000000000 + i), "name": "Indep %d" % i}
        pool.append(decl(k, p, "w%d.pool.example" % i, le))
    out = pool_vector(pool)
    v = out["vector"]
    assert out["verdict"] == "measured" and v["pool_size"] == 10 and v["distinct_legal_entities"] == 3 and v["largest_entity_actors"] == 8, v
    ref = canonical(out)
    for _ in range(5):
        random.shuffle(pool)
        assert canonical(pool_vector(pool)) == ref
    n += 1; print("[8] pool of 10 with 8 under one entity: distinct_legal_entities 3, largest_entity_actors 8; deterministic under shuffle")

    # [9] no quorum stated: measured, vector only; a declaration with legal_entity null is counted as declared_no_entity
    c0 = mk(None)
    dW_none = decl(kw, pw, "witness3.example", None)
    out = verify_independence(c0, [dA, dB, dW_none])
    assert out["verdict"] == "measured" and out["quorum"] is None and out["vector"]["declared_no_entity"] == ["witness:w"], out
    assert out["vector"]["distinct_legal_entities"] == 2
    n += 1; print("[9] contract with no independence quorum: measured only; a key declaring no entity is counted as declared_no_entity, not as an entity")

    print("\nSELF-TEST PASSED: MUSUBI independence v0, %d checks (quorum met, one owner three keys, undeclared undetermined vs not_met, "
          "forged/stranger/conflicting declarations, domain pin, key doors and identifier rules, site rule, pool counts, measured only)" % n)


def main():
    ap = argparse.ArgumentParser(description="MUSUBI independence v0 (a2a-independence-v0: control domains as counts)")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--contract", metavar="CONTRACT.json")
    ap.add_argument("--declaration", action="append", default=[], metavar="DECL.json")
    ap.add_argument("--pool", nargs="*", metavar="DECL.json", help="vector over a witness pool, no contract")
    a = ap.parse_args()
    if a.selftest:
        _selftest(); return 0
    rd = lambda p: parse_strict(open(p, encoding="utf-8").read())
    if a.pool:
        out = pool_vector([rd(p) for p in a.pool])
        print(json.dumps(out, ensure_ascii=False, indent=2)); return 0 if out["verdict"] == "measured" else 2
    if a.contract:
        out = verify_independence(rd(a.contract), [rd(p) for p in a.declaration])
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return {"met": 0, "measured": 0, "undetermined": 3}.get(out["verdict"], 2)
    ap.print_help(); return 1


if __name__ == "__main__":
    sys.exit(main())
