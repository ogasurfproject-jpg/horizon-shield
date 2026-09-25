#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MUSUBI corroboration v0: a signed lie is still a signature; count who else measured (a2a-corroboration-v0).

Why this file exists. Every record in this directory proves who said what, never that it happened.
The deepest hole an outside review named (2026-09-26, hole 1) is that gap: a contractor and a
colluding witness can both sign "wall painted, 1874 dm2" over a wall nobody painted, and every
signature verifies. Cryptography does not close that. What closes it, as far as anything can, is
the same thing that closes it in the world: independent measurement, repeated, with a clock.

This layer adds no oracle. It counts.

  1. a2a-measurement-v0: one measurer, one item of a2a-terms-v0, one figure, one method, signed by the
     measurer's own key. It carries a BEACON (a Bitcoin block height and hash the measurer saw when it
     measured) and, once anchored, an ANCHOR (the block that holds the record). Beacon at or after the
     contract's checkpoint and a valid anchor put the measurement inside a window of blocks: it cannot
     have been prefabricated before the contract and it cannot be backdated after the fact. A record
     without both is provisional, never counted as corroborating.
  2. Each measurer is resolved to a legal entity through the same a2a-actor-declaration-v0 that
     independence v0 verifies. Corroboration is counted in ENTITIES, not signatures: three keys under one
     houjin bangou agreeing with each other are one voice. Measurers with no declaration are counted as
     undeclared, and the contractor's own entity is reported separately from independent ones.
  3. Per item, the output says how many distinct entities measured within the agreed tolerance, how many
     measured outside it, whether any entity contradicted itself, and how many voices are still
     provisional or undeclared. The item is corroborated / disputed / contradicted / undetermined /
     not_corroborated, and not_corroborated is used only when the voices still missing could not reach
     the stated minimum. Counts, never scores, never weights.

What this does not do: it does not decide who is right when entities disagree (disputed is a final
answer here; what follows is a matter for the parties, the witnesses and the recovery layer), it does
not know whether a measurer stood in front of the wall, and it does not know whether two entities are
one owner. It turns "signed by two" into "measured by two legal entities, inside blocks 968400 to
968412, one of them not a party", and it says which of those words it cannot vouch for.
"""
import argparse, base64, hashlib, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import contract_v0 as v0
import settle_v1_1 as v11
import terms_v0 as tv0
import independence_v0 as ind
from contract_v0 import canonical, parse_strict, contract_sha256, HEX64
from agreement_verify import b64_raw, ed25519_verify, scan_numbers

MEAS_SCHEMA = "a2a-measurement-v0"
MEAS_CONTEXT = b"a2a-measurement-v0\n"
OUT_SCHEMA = "a2a-corroboration-v0"

MEAS_KEYS = frozenset(("schema", "terms_sha256", "contract_sha256", "item_id", "measured", "method", "beacon",
                       "evidence_ref", "measurer", "signatures", "anchor"))
BEACON_KEYS = frozenset(("kind", "height", "hash"))
REQ_KEYS = frozenset(("min_corroborating_entities", "measurers_independent_of_parties"))
DEFAULT_REQ = {"min_corroborating_entities": 1, "measurers_independent_of_parties": False}
PARTIES = ("principal", "contractor")


def sha256_hex(b):
    if isinstance(b, str):
        b = b.encode("utf-8")
    return hashlib.sha256(b).hexdigest()


def _is_int(x):
    return isinstance(x, int) and not isinstance(x, bool)


# --------------------------------------------------------------------------- build / sign
def measurement_signing_bytes(m):
    body = {k: v for k, v in m.items() if k not in ("signatures", "anchor")}
    return MEAS_CONTEXT + canonical(body).encode("utf-8")


def measurement_sha256(m):
    """Digest of the signed body, without the anchor: the same bytes the anchor commits to."""
    return v11.commitment_digest({k: v for k, v in m.items() if k != "anchor"}).hex()


def build_measurement(contract, terms, item_id, measured, method, measurer_pub, beacon, evidence_ref=None):
    """UNSIGNED, UNANCHORED. beacon: {"kind": "bitcoin_block", "height": h, "hash": <the block hash the
    measurer saw>}. The measurer signs; whoever files it anchors; both are outside this function."""
    m = {"schema": MEAS_SCHEMA, "terms_sha256": tv0.terms_sha256(terms), "contract_sha256": contract_sha256(contract),
         "item_id": item_id, "measured": measured, "method": method, "beacon": dict(beacon),
         "measurer": {"public_key_ed25519_b64": measurer_pub}, "signatures": []}
    if evidence_ref is not None:
        m["evidence_ref"] = evidence_ref
    return m


def sign_measurement(m, key):
    sig = base64.b64encode(key.sign(measurement_signing_bytes(m))).decode("ascii")
    m.setdefault("signatures", []).append({"alg": "ed25519", "sig_b64": sig})
    return m


# --------------------------------------------------------------------------- one measurement
def _door(problems, obj, allowed, code):
    extra = sorted(k for k in obj.keys() if k not in allowed)
    if extra:
        problems.append({"reason": code, "keys": extra})


def examine_measurement(m, i, tsha, csha, items, cv, checkpoint, deadline):
    """Everything provable about one record on its own. Returns a row; row['use'] is one of
    counted (time bound, agreed method), provisional (not yet time bound), rejected (a provable
    defect), ignored (not about these terms)."""
    where = "measurements[%d]" % i
    row = {"index": i, "where": where, "problems": [], "flags": []}
    P = row["problems"]
    if not isinstance(m, dict) or m.get("schema") != MEAS_SCHEMA:
        P.append({"reason": "bad_schema"}); row["use"] = "rejected"; return row
    _door(P, m, MEAS_KEYS, "unknown_measurement_key")
    for path, why, shown in scan_numbers({k: v for k, v in m.items() if k != "anchor"}):
        P.append({"reason": "unsafe_number" if why != "not an integer" else "non_integer_number", "path": path})
    if m.get("terms_sha256") != tsha or m.get("contract_sha256") != csha:
        row["use"] = "ignored"; row["problems"].append({"reason": "names_other_terms_or_contract"}); return row
    pub = (m.get("measurer") or {}).get("public_key_ed25519_b64") if isinstance(m.get("measurer"), dict) else None
    if b64_raw(pub, 32) is None:
        P.append({"reason": "bad_measurer_key"}); pub = None
    row["measurer_key"] = pub
    row["sha256"] = measurement_sha256(m) if not P else None
    iid = m.get("item_id")
    item = items.get(iid) if isinstance(iid, str) else None
    row["item_id"] = iid
    if item is None:
        P.append({"reason": "item_not_in_terms"})
    q = tv0._qty(m.get("measured"))
    if q is None:
        P.append({"reason": "bad_measured"})
    if not (isinstance(m.get("method"), str) and m["method"]):
        P.append({"reason": "bad_method"})
    # signature by the measurer's own key
    signed = False
    if pub:
        msg = measurement_signing_bytes(m)
        for s in (m.get("signatures") or []):
            if isinstance(s, dict) and s.get("alg") == "ed25519" and ed25519_verify(pub, s.get("sig_b64"), msg) is True:
                signed = True
    if not signed:
        P.append({"reason": "not_signed_by_measurer"})
    # beacon: the lower edge of the window
    b = m.get("beacon")
    beacon_ok = False
    if not isinstance(b, dict):
        P.append({"reason": "beacon_missing"})
    else:
        _door(P, b, BEACON_KEYS, "unknown_beacon_key")
        bh = b.get("height")
        if b.get("kind") != "bitcoin_block" or not (_is_int(bh) and bh >= 0) or not (isinstance(b.get("hash"), str) and HEX64.match(b["hash"])):
            P.append({"reason": "beacon_malformed"})
        elif bh < checkpoint:
            row["flags"].append({"flag": "beacon_before_contract", "beacon": bh, "checkpoint": checkpoint,
                                 "why": "a record that only proves it exists after a block older than the contract could have been written before the contract"})
        elif bh not in cv["hashes"]:
            row["flags"].append({"flag": "beacon_beyond_observed_chain", "beacon": bh, "tip": cv["tip"]})
        elif cv["hashes"][bh] != b["hash"]:
            row["flags"].append({"flag": "beacon_orphaned", "beacon": bh, "why": "the observed chain holds a different block at that height"})
        else:
            beacon_ok = True
            row["beacon_height"] = bh
    # anchor: the upper edge
    a = m.get("anchor")
    anchored_ok = False
    if a is None:
        row["flags"].append({"flag": "unanchored"})
    elif not isinstance(a, dict):
        P.append({"reason": "anchor_malformed"})
    else:
        ah, abh = a.get("height"), a.get("block_hash")
        if not (_is_int(ah) and ah >= 0 and isinstance(abh, str) and HEX64.match(abh)):
            P.append({"reason": "anchor_incomplete"})
        elif ah > cv["tip"] or ah not in cv["hashes"]:
            row["flags"].append({"flag": "anchor_beyond_observed_chain", "anchor": ah})
        elif cv["hashes"][ah] != abh:
            row["flags"].append({"flag": "anchor_orphaned", "anchor": ah})
        elif beacon_ok and ah < row["beacon_height"]:
            P.append({"reason": "anchor_before_beacon", "anchor": ah, "beacon": row["beacon_height"],
                      "why": "a record cannot sit in a block older than the block it says it saw"})
        elif not P and v11.run_proof(v11.commitment_digest({k: v for k, v in m.items() if k != "anchor"}), a.get("proof")) != cv["merkle"][ah]:
            P.append({"reason": "anchor_proof_invalid", "anchor": ah})
        else:
            anchored_ok = True
            row["anchor_height"] = ah
            if deadline is not None and ah > deadline:
                row["flags"].append({"flag": "after_deadline", "anchor": ah, "deadline": deadline})
    if P:
        row["use"] = "rejected"; return row
    # agreement with the terms
    if item is not None and q is not None:
        if m["method"] != item["completion_test"]["method"]:
            row["flags"].append({"flag": "method_mismatch", "agreed": item["completion_test"]["method"], "used": m["method"]})
            row["agreement"] = "wrong_method"
        else:
            ok, dev_bp = tv0.within_tolerance(tv0._qty(item["quantity"]), q, item.get("tolerance_bp", 0))
            row["agreement"] = "within" if ok else "outside"
            row["deviation_bp"] = dev_bp
    row["time_bound"] = beacon_ok and anchored_ok
    if row["time_bound"]:
        row["window"] = [row["beacon_height"], row["anchor_height"]]
    row["use"] = "counted" if (row["time_bound"] and row.get("agreement") in ("within", "outside")) else "provisional"
    if row.get("agreement") == "wrong_method":
        row["use"] = "wrong_method"
    return row


# --------------------------------------------------------------------------- the count
def _entities(declarations, r):
    """key -> legal entity key, or None (declared, no entity). Keys absent are undeclared.
    Conflicting declarations for one key are refused, as in independence v0."""
    out, seen = {}, {}
    for i, d in enumerate(declarations or []):
        dr, pub = ind.check_declaration(d, ind._where(d, i))
        r.refusals.extend(dr.refusals); r.findings.extend(dr.findings)
        if dr.refusals or pub is None:
            continue
        if pub in seen and ind.declaration_sha256(seen[pub]) != ind.declaration_sha256(d):
            r.refuse("conflicting_declarations", "two different signed declarations for one measurer key")
            continue
        seen[pub] = d
        le = d.get("legal_entity")
        out[pub] = ind.legal_entity_key(le) if isinstance(le, dict) else None
    return out


def _check_requirements(r, req):
    if req is None:
        return dict(DEFAULT_REQ), "default"
    if not isinstance(req, dict):
        r.refuse("bad_requirements", "requirements.corroboration must be an object"); return dict(DEFAULT_REQ), "default"
    extra = sorted(k for k in req if k not in REQ_KEYS)
    if extra:
        r.refuse("unknown_requirement_key", "requirements.corroboration carries keys no verifier reads: %s" % ", ".join(extra))
    if "min_corroborating_entities" in req and not (_is_int(req["min_corroborating_entities"]) and req["min_corroborating_entities"] >= 1):
        r.refuse("bad_requirements", "min_corroborating_entities must be a positive integer")
    if "measurers_independent_of_parties" in req and not isinstance(req["measurers_independent_of_parties"], bool):
        r.refuse("bad_requirements", "measurers_independent_of_parties must be true or false")
    full = dict(DEFAULT_REQ); full.update({k: v for k, v in req.items() if k in REQ_KEYS})
    return full, "contract"


def verify_corroboration(contract, terms, measurements, view, declarations=None, vocabulary_bytes=None):
    """Offline. Returns the per item count and the verdict. Nothing here is a judgment of truth."""
    r = v0.R()
    if not isinstance(contract, dict) or contract.get("schema") != v0.SCHEMA:
        r.refuse("bad_contract", "not an %s record" % v0.SCHEMA)
        return _out(r, None, None, [], "refused", None)
    csha = contract_sha256(contract)
    tcheck = tv0.verify_terms(terms, vocabulary_bytes, contract=contract)
    tsha = tcheck.get("terms_sha256")
    if tcheck["verdict"] == "refused":
        r.refuse("terms_refused", "the terms do not verify against this contract; see terms_v0")
        r.refusals.extend(tcheck["refusals"])
        return _out(r, csha, tsha, [], "refused", None)
    terms_undetermined = tcheck["verdict"] == "undetermined"
    for f in tcheck["findings"]:
        r.findings.append(f)
    cv, vproblem = v11.verify_view(view, contract)
    if cv is None:
        r.refuse("chain_view_rejected", vproblem)
        return _out(r, csha, tsha, [], "refused", None)
    reqs = contract.get("requirements") if isinstance(contract.get("requirements"), dict) else {}
    req, req_source = _check_requirements(r, reqs.get("corroboration"))
    entity_of = _entities(declarations, r)
    if r.refusals:
        return _out(r, csha, tsha, [], "refused", None)

    actors = ind.contract_actors(contract)
    role_of_key = {a["key"]: a["id"] for a in actors if a.get("key")}
    party_entities = {entity_of.get(a["key"]) for a in actors if a["role"] in PARTIES and entity_of.get(a["key"])}
    parties_undeclared = [a["id"] for a in actors if a["role"] in PARTIES and a["key"] not in entity_of]
    items = {it["item_id"]: it for it in terms["items"]}
    checkpoint = cv["checkpoint"]["height"]
    deadline = (terms.get("deadline") or {}).get("height") if isinstance(terms.get("deadline"), dict) else None

    uniq, seen = [], set()                                   # a byte-identical duplicate is the same record, once
    for m in (measurements or []):
        key = canonical(m) if isinstance(m, (dict, list)) else repr(m)
        if key not in seen:
            seen.add(key); uniq.append(m)
    rows = [examine_measurement(m, i, tsha, csha, items, cv, checkpoint, deadline) for i, m in enumerate(uniq)]
    for row in rows:
        k = row.get("measurer_key")
        row["measurer"] = role_of_key.get(k) or ("measurer:%s" % sha256_hex(k)[:16] if k else None)
        if k in entity_of:
            row["entity"] = entity_of[k]
            row["party_entity"] = entity_of[k] in party_entities if entity_of[k] else False
        else:
            row["entity"] = None
            row["undeclared"] = True

    per_item = []
    for iid in sorted(items):
        mine = [x for x in rows if x.get("item_id") == iid and x["use"] != "ignored"]
        counted = [x for x in mine if x["use"] == "counted"]
        prov = [x for x in mine if x["use"] == "provisional"]

        def voices(subset, agreement, independent):
            ents, undecl = set(), 0
            for x in subset:
                if x.get("agreement") != agreement:
                    continue
                if x.get("undeclared"):
                    undecl += 1
                elif x["entity"] is None:
                    undecl += 1                      # declared, no entity: a voice with no entity to count
                elif independent and x["party_entity"]:
                    continue
                else:
                    ents.add(x["entity"])
            return ents, undecl

        indep = req["measurers_independent_of_parties"]
        within_all, _ = voices(counted, "within", False)
        outside_all, _ = voices(counted, "outside", False)
        within, within_undecl = voices(counted, "within", indep)
        outside, outside_undecl = voices(counted, "outside", indep)
        prov_within, prov_undecl = voices(prov, "within", indep)
        inconsistent = sorted(within_all & outside_all)
        need = req["min_corroborating_entities"]
        if outside and within:
            status = "disputed"
        elif outside:
            status = "contradicted"
        elif len(within) >= need:
            status = "corroborated"
        elif len(within | prov_within) + within_undecl + prov_undecl + (len(parties_undeclared) if indep else 0) >= need:
            status = "undetermined"
        else:
            status = "not_corroborated"
        per_item.append({
            "item_id": iid, "status": status,
            "counts": {"measurements": len(mine), "counted": len(counted), "provisional": len(prov),
                       "rejected": sum(1 for x in mine if x["use"] == "rejected"),
                       "wrong_method": sum(1 for x in mine if x["use"] == "wrong_method"),
                       "corroborating_entities": len(within), "contradicting_entities": len(outside),
                       "corroborating_entities_any": len(within_all), "contradicting_entities_any": len(outside_all),
                       "inconsistent_entities": len(inconsistent),
                       "undeclared_measurers": within_undecl + outside_undecl,
                       "after_deadline": sum(1 for x in counted if any(f["flag"] == "after_deadline" for f in x["flags"]))},
            "corroborating": sorted(within), "contradicting": sorted(outside), "inconsistent": inconsistent,
            "required": need, "independent_of_parties": indep,
            "measurements": sorted(({k: x.get(k) for k in ("measurer", "entity", "undeclared", "party_entity", "use", "agreement",
                                                          "deviation_bp", "window", "flags", "problems", "sha256")} for x in mine),
                                   key=canonical)})

    ignored = sum(1 for x in rows if x["use"] == "ignored")
    if ignored:
        r.find("measurements_ignored", "%d measurement(s) name other terms or another contract" % ignored)
    if parties_undeclared and req["measurers_independent_of_parties"]:
        r.find("party_undeclared", "%s carry no declaration, so independence from them cannot be checked" % parties_undeclared)
    sts = {x["status"] for x in per_item}
    if "disputed" in sts:
        verdict = "disputed"
    elif "contradicted" in sts:
        verdict = "contradicted"
    elif "not_corroborated" in sts:
        verdict = "not_corroborated"
    elif "undetermined" in sts or terms_undetermined or not per_item:
        verdict = "undetermined"
    else:
        verdict = "corroborated"
    if terms_undetermined:
        r.find("terms_undetermined", "the terms' vocabulary bytes were not supplied; the arithmetic is shown, the meaning is unresolved")
    return _out(r, csha, tsha, per_item, verdict, {"source": req_source, **req}, cv)


def _out(r, csha, tsha, per_item, verdict, req, cv=None):
    return {"schema": OUT_SCHEMA, "verdict": verdict, "contract_sha256": csha, "terms_sha256": tsha,
            "refusals": sorted(r.refusals, key=canonical), "findings": sorted(r.findings, key=canonical),
            "requirement": req, "chain": ({"checkpoint": cv["checkpoint"]["height"], "tip": cv["tip"]} if cv else None),
            "items": per_item,
            "establishes": [
                "that each counted measurement was signed by its measurer's key, names these terms and this contract, and sits in a block window that begins at or after the contract's checkpoint",
                "that the counts of corroborating and contradicting legal entities follow from the measurements and the declarations by a function anyone recomputes",
            ],
            "does_not_establish": [
                "that any measurement is true, or that the measurer stood in front of the work",
                "that two declared entities are two owners, or that an undeclared measurer is anyone in particular",
                "who is right when entities disagree; disputed is the answer here, not a step toward one",
                "that HS judged anything; nothing here fetched, weighed or scored",
            ]}


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

    HS = {"registry": "JP", "scheme": "houjin-bango", "id": "7021001075279", "name": "The HORIZONs Co., Ltd."}
    BBV = {"registry": "GLEIF", "scheme": "lei", "id": "5493001KJTIIGC8Y1R12", "name": "Baby Blue Viper LLC"}
    INSP1 = {"registry": "JP", "scheme": "houjin-bango", "id": "1234567890123", "name": "Inspector One K.K."}
    INSP2 = {"registry": "JP", "scheme": "houjin-bango", "id": "9876543210987", "name": "Inspector Two K.K."}
    DNE = ["that HS enforced any of this at runtime",
           "that the contractor obeyed the grant, only that its recorded acts match or deviate from it",
           "that HS judges liability or fault; the verdict is a function anyone recomputes",
           "that a prohibited action was impossible, only that performing one is a provable deviation",
           "that this is a legal contract or determines legal responsibility"]

    ka, pa = newkey(); kb, pb = newkey(); kw, pw = newkey()
    k1, p1 = newkey(); k2, p2 = newkey(); k3, p3 = newkey()

    base = v11._Chain(60, "00" * 32, "common")
    for _ in range(38):
        base.block()                                            # heights 60..97
    LB = {"kind": "bitcoin_block", "height": 97, "hash": base.hashes[97]}

    vocab = tv0.make_vocabulary("paint-works-glossary", "2026.09", {
        "wall_paint_exterior": {"unit": "dm2", "methods": ["laser_area_survey"]},
        "paint_coats": {"unit": "coat", "methods": ["wet_film_gauge"]}})
    vb = tv0.vocabulary_bytes(vocab)
    vref = {"name": "paint-works-glossary", "version": "2026.09", "sha256": tv0.vocabulary_sha256(vb), "url": "https://example.test/g.json"}
    ITEMS = [{"item_id": "wall_paint_exterior", "quantity": 1874, "unit": "dm2", "tolerance_bp": 200,
              "completion_test": {"method": "laser_area_survey", "evidence_schema": "a2a-measurement-v0"}},
             {"item_id": "paint_coats", "quantity": 3, "unit": "coat", "tolerance_bp": 0,
              "completion_test": {"method": "wet_film_gauge", "evidence_schema": "a2a-measurement-v0"}}]

    def mk(corroboration=None, deadline=None):
        terms = tv0.build_terms(vref, ITEMS, deadline=deadline)
        grant = {"authorized_actions": ["paint"], "prohibited_actions": ["demolish"], "delegation": {"allowed": []},
                 "revocation": {"effective_at": "anchor"}, "finality": {"depth": 3, "max_target_bits": "207fffff"},
                 "witnesses": [{"name": "w", "public_key_ed25519_b64": pw}]}
        reqs = {"evidence": "nenrin_required", "recovery": "tsugi_required"}
        if corroboration is not None:
            reqs["corroboration"] = corroboration
        task = tv0.bind_terms({"purpose": "exterior_wall_painting", "payload_digest": "a" * 64}, terms)
        c = v0.build_contract(
            {"domain": "gate.horizonshield.dev", "key_url": "https://gate.horizonshield.dev/keys/agreement.json", "public_key_ed25519_b64": pa},
            {"domain": "api.babyblueviper.com", "key_url": "https://api.babyblueviper.com/keys/agreement.json", "public_key_ed25519_b64": pb},
            task, grant, ["that both parties signed these grant bytes at the stated time"], DNE, requirements=reqs,
            lower_bound=LB, contract_id="0123456789abcdef0123456789abcdef", nonce="c" * 32, agreed_at="2026-09-26T00:00:00Z")
        v0.sign_contract(c, ka, pa, "gate.horizonshield.dev"); v0.sign_contract(c, kb, pb, "api.babyblueviper.com")
        assert v0.verify_contract(c)["verdict"] == "accepted"
        return c, terms

    def decl(key, pub, domain, le):
        d = ind.build_declaration(pub, domain, "https://%s/keys/agreement.json" % domain, le)
        return ind.sign_declaration(d, key)

    dA = decl(ka, pa, "gate.horizonshield.dev", HS); dB = decl(kb, pb, "api.babyblueviper.com", BBV)
    d1 = decl(k1, p1, "inspector-one.example", INSP1); d2 = decl(k2, p2, "inspector-two.example", INSP2)
    d3_bbv = decl(k3, p3, "inspections.babyblueviper.com", BBV)          # the contractor's own inspector
    DECLS = [dA, dB, d1, d2, d3_bbv]

    def chain(label):
        ch = base.fork(98, label)
        ch.block()                                              # 98: the beacon block
        ch.block()                                              # 99
        return ch

    def beacon(ch, h=98):
        return {"kind": "bitcoin_block", "height": h, "hash": ch.hashes[h]}

    def meas(c, t, ch, key, pub, item, value, method=None, b=None):
        it = {x["item_id"]: x for x in t["items"]}[item]
        m = build_measurement(c, t, item, value, method or it["completion_test"]["method"], pub, b or beacon(ch),
                              evidence_ref={"nenrin_sha256": "b" * 64})
        return sign_measurement(m, key)

    def anchor(ch, ms, extra_blocks=5):
        out = ch.block(list(ms))                                # 100 (or later): the records land
        for _ in range(extra_blocks):
            ch.block()
        return out

    def run(c, t, ms, ch, decls=DECLS, vbytes=vb):
        return verify_corroboration(c, t, ms, ch.view(), decls, vbytes)

    n = 0
    Q2 = {"min_corroborating_entities": 2, "measurers_independent_of_parties": True}

    # [1] honest: contractor, inspector one and inspector two all measure within; two independent entities: corroborated
    c, t = mk(Q2); ch = chain("h1")
    ms = anchor(ch, [meas(c, t, ch, kb, pb, "wall_paint_exterior", 1874), meas(c, t, ch, k1, p1, "wall_paint_exterior", 1860),
                     meas(c, t, ch, k2, p2, "wall_paint_exterior", {"value": 18900, "scale": 1}),
                     meas(c, t, ch, k1, p1, "paint_coats", 3), meas(c, t, ch, k2, p2, "paint_coats", 3)])
    out = run(c, t, ms, ch)
    assert out["verdict"] == "corroborated", out
    w = out["items"][1]                                          # items sorted by id: paint_coats, wall_paint_exterior
    assert w["item_id"] == "wall_paint_exterior" and w["counts"]["corroborating_entities"] == 2 and w["counts"]["corroborating_entities_any"] == 3, w["counts"]
    assert all(x["window"] == [98, 100] for x in w["measurements"]), w["measurements"]
    assert out["requirement"]["source"] == "contract" and out["chain"] == {"checkpoint": 97, "tip": 105}
    n += 1; print("[1] contractor plus two independent inspectors, all within, beacon 98 anchored 100: corroborated; entities 2 independent, 3 in all")

    # [2] the signed lie: contractor and its own inspector (same LEI) agree with each other; nobody independent measured
    c, t = mk(Q2); ch = chain("h2")
    ms = anchor(ch, [meas(c, t, ch, kb, pb, "wall_paint_exterior", 1874), meas(c, t, ch, k3, p3, "wall_paint_exterior", 1874),
                     meas(c, t, ch, kb, pb, "paint_coats", 3), meas(c, t, ch, k3, p3, "paint_coats", 3)])
    out = run(c, t, ms, ch)
    w = out["items"][1]
    assert out["verdict"] == "not_corroborated" and w["counts"]["corroborating_entities"] == 0 and w["counts"]["corroborating_entities_any"] == 1, out["items"]
    c_any, t_any = mk({"min_corroborating_entities": 1})       # without the independence requirement the same bytes corroborate
    ch2 = chain("h2b")
    ms2 = anchor(ch2, [meas(c_any, t_any, ch2, kb, pb, "wall_paint_exterior", 1874), meas(c_any, t_any, ch2, k3, p3, "wall_paint_exterior", 1874),
                       meas(c_any, t_any, ch2, kb, pb, "paint_coats", 3)])
    assert run(c_any, t_any, ms2, ch2)["verdict"] == "corroborated"
    out_u = run(c, t, ms, ch, decls=[dA, d1, d2, d3_bbv])        # contractor undeclared: its independence cannot be checked
    assert out_u["verdict"] == "undetermined" and "party_undeclared" in fcodes(out_u), out_u["verdict"]
    n += 1; print("[2] contractor and its own inspector under one LEI: two keys, one entity, zero independent: not_corroborated; without the requirement they count; contractor undeclared: undetermined")

    # [3] disagreement between independent entities is disputed, not resolved; two outside is contradicted
    c, t = mk(Q2); ch = chain("h3")
    ms = anchor(ch, [meas(c, t, ch, k1, p1, "wall_paint_exterior", 1874), meas(c, t, ch, k2, p2, "wall_paint_exterior", 1500),
                     meas(c, t, ch, k1, p1, "paint_coats", 3), meas(c, t, ch, k2, p2, "paint_coats", 3)])
    out = run(c, t, ms, ch)
    w = out["items"][1]
    assert out["verdict"] == "disputed" and w["counts"] ["corroborating_entities"] == 1 and w["counts"]["contradicting_entities"] == 1, out["items"]
    ch = chain("h3b")
    ms = anchor(ch, [meas(c, t, ch, k1, p1, "wall_paint_exterior", 1500), meas(c, t, ch, k2, p2, "wall_paint_exterior", 1400),
                     meas(c, t, ch, k1, p1, "paint_coats", 3), meas(c, t, ch, k2, p2, "paint_coats", 3)])
    out = run(c, t, ms, ch)
    assert out["verdict"] == "contradicted" and out["items"][1]["contradicting"] == sorted([ind.legal_entity_key(INSP1), ind.legal_entity_key(INSP2)])
    ch = chain("h3c")                                           # one entity says both: inconsistent, named
    ms = anchor(ch, [meas(c, t, ch, k1, p1, "wall_paint_exterior", 1874), meas(c, t, ch, k1, p1, "wall_paint_exterior", 1500),
                     meas(c, t, ch, k2, p2, "wall_paint_exterior", 1874), meas(c, t, ch, k1, p1, "paint_coats", 3), meas(c, t, ch, k2, p2, "paint_coats", 3)])
    out = run(c, t, ms, ch)
    assert out["items"][1]["inconsistent"] == [ind.legal_entity_key(INSP1)] and out["verdict"] == "disputed"
    n += 1; print("[3] one within, one outside: disputed; both outside: contradicted; one entity saying both: inconsistent, named")

    # [4] the clock: a beacon older than the contract, a beacon from another chain, an anchor before its beacon, no anchor
    c, t = mk(Q2); ch = chain("h4")
    old = meas(c, t, ch, k1, p1, "wall_paint_exterior", 1874, b={"kind": "bitcoin_block", "height": 95, "hash": base.hashes[95]})
    other = meas(c, t, ch, k2, p2, "wall_paint_exterior", 1874, b={"kind": "bitcoin_block", "height": 98, "hash": "e" * 64})
    fine1 = meas(c, t, ch, k1, p1, "paint_coats", 3); fine2 = meas(c, t, ch, k2, p2, "paint_coats", 3)
    ms = anchor(ch, [old, other, fine1, fine2])
    late = meas(c, t, ch, k1, p1, "wall_paint_exterior", 1874, b={"kind": "bitcoin_block", "height": 104, "hash": ch.hashes[104]})
    late_anchored = json.loads(json.dumps(late)); late_anchored["anchor"] = dict(ms[2]["anchor"])   # claims block 100, saw 104
    unanchored = meas(c, t, ch, k2, p2, "wall_paint_exterior", 1874)
    out = run(c, t, ms + [late_anchored, unanchored], ch)
    w = out["items"][1]
    allf = [f["flag"] for x in w["measurements"] for f in x["flags"]] + [p["reason"] for x in w["measurements"] for p in x["problems"]]
    for want in ("beacon_before_contract", "beacon_orphaned", "unanchored", "anchor_before_beacon"):
        assert want in allf, (want, allf)
    uses = sorted(x["use"] for x in w["measurements"])
    assert uses == ["provisional", "provisional", "provisional", "rejected"], uses
    assert w["status"] == "undetermined" and w["counts"]["corroborating_entities"] == 0, w["status"]
    n += 1; print("[4] beacon before the contract, beacon from another chain, no anchor: provisional, not counted; anchor older than its beacon: rejected as impossible")

    # [5] forged signature, other terms, wrong method, transplanted anchor
    c, t = mk(Q2); ch = chain("h5")
    forged = build_measurement(c, t, "wall_paint_exterior", 1874, "laser_area_survey", p1, beacon(ch)); sign_measurement(forged, k2)
    wrong = meas(c, t, ch, k2, p2, "wall_paint_exterior", 1874, method="eyeball")
    good1 = meas(c, t, ch, k1, p1, "paint_coats", 3); good2 = meas(c, t, ch, k2, p2, "paint_coats", 3)
    ms = anchor(ch, [forged, wrong, good1, good2])
    c_other, t_other = mk(Q2, deadline={"kind": "bitcoin_block", "height": 500})
    ch_o = chain("h5o")
    foreign = anchor(ch_o, [meas(c_other, t_other, ch_o, k1, p1, "wall_paint_exterior", 1874)])[0]
    transplant = json.loads(json.dumps(ms[2])); transplant["anchor"] = dict(ms[3]["anchor"])
    out = run(c, t, ms + [foreign, transplant], ch)
    w = out["items"][1]

    def marks(rows_):
        return [p["reason"] for x in rows_ for p in x["problems"]] + [f["flag"] for x in rows_ for f in x["flags"]]
    assert "not_signed_by_measurer" in marks(w["measurements"]) and "method_mismatch" in marks(w["measurements"]), marks(w["measurements"])
    assert "anchor_proof_invalid" in marks(out["items"][0]["measurements"]), marks(out["items"][0]["measurements"])
    assert "measurements_ignored" in fcodes(out) and w["counts"]["wrong_method"] == 1 and w["counts"]["rejected"] == 1
    assert out["items"][0]["status"] == "corroborated" and w["status"] == "not_corroborated"
    n += 1; print("[5] signature by another key: rejected; another contract's measurement: ignored; wrong method: not counted; anchor moved from another record: anchor_proof_invalid")

    # [6] undeclared measurers: could still reach the minimum (undetermined) or could not (not_corroborated)
    c, t = mk(Q2); ch = chain("h6")
    ku, pu = newkey()
    ms = anchor(ch, [meas(c, t, ch, k1, p1, "wall_paint_exterior", 1874), meas(c, t, ch, ku, pu, "wall_paint_exterior", 1874),
                     meas(c, t, ch, k1, p1, "paint_coats", 3), meas(c, t, ch, k2, p2, "paint_coats", 3)])
    out = run(c, t, ms, ch)
    w = out["items"][1]
    assert w["status"] == "undetermined" and w["counts"]["undeclared_measurers"] == 1 and w["counts"]["corroborating_entities"] == 1, w["counts"]
    c3, t3 = mk({"min_corroborating_entities": 3, "measurers_independent_of_parties": True}); ch = chain("h6b")
    ms = anchor(ch, [meas(c3, t3, ch, k1, p1, "wall_paint_exterior", 1874), meas(c3, t3, ch, k1, p1, "paint_coats", 3),
                     meas(c3, t3, ch, k2, p2, "paint_coats", 3), meas(c3, t3, ch, ku, pu, "paint_coats", 3)])
    out = run(c3, t3, ms, ch)
    assert out["verdict"] == "not_corroborated", out["verdict"]
    assert out["items"][1]["status"] == "not_corroborated" and out["items"][0]["status"] == "undetermined", [x["status"] for x in out["items"]]
    n += 1; print("[6] one declared plus one undeclared voice against a minimum of 2: undetermined; one voice against 3: not_corroborated; two declared plus one undeclared against 3: undetermined")

    # [7] deadline and defaults: anchored after the terms' deadline is flagged and still counted; no requirements block means 1 entity, any
    c, t = mk(None, deadline={"kind": "bitcoin_block", "height": 99}); ch = chain("h7")
    ms = anchor(ch, [meas(c, t, ch, kb, pb, "wall_paint_exterior", 1874), meas(c, t, ch, kb, pb, "paint_coats", 3)])
    out = run(c, t, ms, ch)
    assert out["verdict"] == "corroborated" and out["requirement"]["source"] == "default"
    assert out["items"][1]["counts"]["after_deadline"] == 1 and out["items"][0]["counts"]["after_deadline"] == 1
    n += 1; print("[7] anchored at 100 against a deadline of 99: after_deadline counted, still a measurement; defaults are 1 entity, any")

    # [8] doors, chain view, terms without vocabulary, determinism
    cq, tq = mk({"min_corroborating_entities": 2, "trust_weight": 1})
    out = run(cq, tq, [], chain("h8"))
    assert out["verdict"] == "refused" and ("unknown_requirement_key" in codes(out) or "unsafe_number" in codes(out) or "non_integer_number" in codes(out)), out["refusals"]
    c, t = mk(Q2); ch = chain("h8b")
    ms = anchor(ch, [meas(c, t, ch, k1, p1, "wall_paint_exterior", 1874), meas(c, t, ch, k2, p2, "wall_paint_exterior", 1874),
                     meas(c, t, ch, k1, p1, "paint_coats", 3), meas(c, t, ch, k2, p2, "paint_coats", 3)])
    bad_view = {"headers": ch.view()["headers"][:-3]}
    bad_view["headers"][-1] = dict(bad_view["headers"][-1], hex="0" * 160)
    assert "chain_view_rejected" in codes(verify_corroboration(c, t, ms, bad_view, DECLS, vb))
    out_nv = run(c, t, ms, ch, vbytes=None)
    assert out_nv["verdict"] == "undetermined" and "terms_undetermined" in fcodes(out_nv)
    k1m = json.loads(json.dumps(ms[0])); k1m["note"] = "trust me"
    out_k = run(c, t, [k1m] + ms[1:], ch)
    assert any(x["use"] == "rejected" and any(p["reason"] == "unknown_measurement_key" for p in x["problems"]) for x in out_k["items"][1]["measurements"])
    ref = canonical(run(c, t, ms, ch))
    for _ in range(5):
        sh = list(ms); random.shuffle(sh)
        dd = list(DECLS); random.shuffle(dd)
        assert canonical(run(c, t, sh, ch, decls=dd)) == ref
    n += 1; print("[8] unknown requirement key (a weight): refused; broken chain view: refused; no vocabulary bytes: undetermined; unknown measurement key: rejected; deterministic under shuffle")

    print("\nSELF-TEST PASSED: MUSUBI corroboration v0, %d checks (independent entities, the signed lie counted as one voice, disputed and contradicted, "
          "the block window, forged and transplanted records, undeclared voices, deadline and defaults, doors and determinism)" % n)


def main():
    ap = argparse.ArgumentParser(description="MUSUBI corroboration v0 (a2a-corroboration-v0: who else measured, in entities, inside blocks)")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--contract", metavar="CONTRACT.json")
    ap.add_argument("--terms", metavar="TERMS.json")
    ap.add_argument("--view", metavar="VIEW.json")
    ap.add_argument("--measurement", action="append", default=[], metavar="M.json")
    ap.add_argument("--declaration", action="append", default=[], metavar="DECL.json")
    ap.add_argument("--vocabulary", metavar="VOCAB.json")
    a = ap.parse_args()
    if a.selftest:
        _selftest(); return 0
    if a.contract and a.terms and a.view:
        rd = lambda p: parse_strict(open(p, encoding="utf-8").read())
        vb = open(a.vocabulary, "rb").read() if a.vocabulary else None
        out = verify_corroboration(rd(a.contract), rd(a.terms), [rd(p) for p in a.measurement], rd(a.view),
                                   [rd(p) for p in a.declaration], vb)
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return {"corroborated": 0, "undetermined": 3}.get(out["verdict"], 2)
    ap.print_help(); return 1


if __name__ == "__main__":
    sys.exit(main())
