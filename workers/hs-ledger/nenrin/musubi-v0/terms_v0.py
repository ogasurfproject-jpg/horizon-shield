#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MUSUBI terms v0: byte agreement made into meaning agreement (a2a-terms-v0).

Why this file exists. Two parties signing the same canonical bytes settles WHICH bytes were agreed.
It settles nothing about what those bytes mean. A task whose deliverable reads "high quality
renovation" verifies, anchors and settles perfectly while each party keeps its own idea of quality.
An outside review (2026-09-26, hole 9) named it: byte agreement is not semantic agreement.

This layer adds no judge of meaning. It removes the place where meaning can hide:

  1. Every deliverable is an ITEM drawn from a VOCABULARY that is content addressed. A vocabulary is
     any a2a-vocabulary-v0 document anyone can publish (a public cost database wrapped in one, a trade
     standard, a two line glossary between two parties). The terms carry the vocabulary's sha256 over
     its exact published bytes; the contract carries the terms' sha256; both parties sign the contract.
     Meaning therefore sits inside the signed bytes, not behind a URL whose content can change.
  2. Every item carries an integer quantity, the unit the vocabulary fixes for that item, an integer
     tolerance in basis points, and a completion_test naming the method and the evidence schema by
     which "done" is decided. An item missing any of these is refused as unpinned_term. Free text is
     allowed only as a label, and the verifier does not read labels.
  3. check_completion is a pure function: terms plus measurements in, within_terms / outside_terms /
     undetermined out, by integer arithmetic at a common decimal scale. It counts items. It never scores.

Nothing here depends on JCCDB or on any HS dataset. JCCDB is one vocabulary that can be pinned; a paint
maker's product list or a private glossary pins the same way. The verifier needs the vocabulary BYTES
to resolve items; without them the terms are undetermined, never accepted on faith and never refused
for a fetch that did not happen. No network, ever.

Numbers: integers only. A decimal quantity is {"value": 1874, "scale": 1}, meaning 187.4; comparison
happens at the common scale in integers. A float anywhere in the terms is a refusal here, not the
finding it is in contract v0: terms are the one place where a digit another runtime serializes
differently would move what was agreed.

The terms are not signed on their own. The contract's two signatures cover task.terms_sha256, so a
signature on the terms would add nothing and would create a second thing to keep in step.
"""
import argparse, hashlib, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import contract_v0 as v0
from contract_v0 import canonical, parse_strict, HEX64
from agreement_verify import host_of_https, scan_numbers, OVERCLAIM

SCHEMA = "a2a-terms-v0"
VOCAB_SCHEMA = "a2a-vocabulary-v0"
EVIDENCE_SCHEMA = "a2a-terms-evidence-v0"
CONTEXT = b"a2a-terms-v0\n"

# Key doors. A key no verifier reads is a key some reader can be made to trust (Issue #25). Every
# object here accepts exactly the keys listed; anything else is a refusal, never ignored.
TERMS_KEYS = frozenset(("schema", "vocabulary", "items", "deadline", "price", "establishes", "does_not_establish"))
VOCAB_REF_KEYS = frozenset(("name", "version", "sha256", "url"))
ITEM_KEYS = frozenset(("item_id", "label", "quantity", "unit", "tolerance_bp", "spec", "completion_test"))
PINNING_KEYS = ("item_id", "quantity", "unit", "completion_test")   # missing any of these: unpinned_term
TEST_KEYS = frozenset(("method", "evidence_schema"))
DEADLINE_KINDS = frozenset(("bitcoin_block",))
EVIDENCE_KEYS = frozenset(("schema", "terms_sha256", "measurements"))
MEASUREMENT_KEYS = frozenset(("item_id", "measured", "method", "evidence_ref"))
MAX_SCALE = 9
MAX_BP = 10000
SAFE_INT_MAX = 2 ** 53 - 1
CURRENCY = re.compile(r"^[A-Z]{3}$")

REQUIRED_DNE = [
    ("that a measurement is true in the world", ("true", "real", "actual")),
    ("not a legal contract", ("legal",)),
]

DEFAULT_ESTABLISHES = [
    "that every item here names an entry of one content addressed vocabulary, with a quantity, a unit, a tolerance and a completion test fixed in these bytes",
    "that within_terms and outside_terms are recomputable by anyone from these bytes and the measurements, by integer arithmetic",
]
DEFAULT_DNE = [
    "that any measurement is true or actual; only that the stated figure sits within or outside the stated tolerance",
    "that the vocabulary is correct or authoritative; only that these bytes name exactly that vocabulary by sha256",
    "that HS judges quality, liability or fault; the verdict is a function anyone recomputes",
    "that this is a legal contract or determines legal responsibility",
]


# --------------------------------------------------------------------------- digests
def sha256_hex(b):
    if isinstance(b, str):
        b = b.encode("utf-8")
    return hashlib.sha256(b).hexdigest()


def terms_sha256(terms):
    """sha256 over the domain separated canonical bytes of the terms. This is what the contract pins."""
    return sha256_hex(CONTEXT + canonical(terms).encode("utf-8"))


def vocabulary_sha256(vocabulary_bytes):
    """sha256 over the vocabulary's EXACT published bytes. The publisher needs no canonicalization of
    ours; anyone who fetched the same bytes computes the same digest."""
    return sha256_hex(vocabulary_bytes)


# --------------------------------------------------------------------------- integers with a scale
def _is_int(x):
    return isinstance(x, int) and not isinstance(x, bool)


def _qty(x):
    """(value, scale) for an integer or a {"value": int, "scale": int} decimal; None when malformed.
    Negative values are malformed here; a quantity is a count of something."""
    if _is_int(x):
        return (x, 0) if 0 <= x <= SAFE_INT_MAX else None
    if isinstance(x, dict) and set(x.keys()) == {"value", "scale"} and _is_int(x["value"]) and _is_int(x["scale"]):
        if 0 <= x["value"] <= SAFE_INT_MAX and 0 <= x["scale"] <= MAX_SCALE:
            return (x["value"], x["scale"])
    return None


def _common(a, b):
    """Two (value, scale) pairs brought to the same scale, as plain integers."""
    s = max(a[1], b[1])
    return a[0] * 10 ** (s - a[1]), b[0] * 10 ** (s - b[1])


def within_tolerance(quantity, measured, tolerance_bp):
    """True when |measured - quantity| * 10000 <= quantity * tolerance_bp, in integers. Also returns the
    deviation in basis points, floored, so the reader sees the arithmetic and not a grade."""
    q, m = _common(quantity, measured)
    dev = abs(m - q)
    ok = dev * MAX_BP <= q * tolerance_bp
    dev_bp = (dev * MAX_BP) // q if q else (0 if dev == 0 else MAX_BP)
    return ok, dev_bp


# --------------------------------------------------------------------------- build
def build_terms(vocabulary_ref, items, deadline=None, price=None, establishes=None, does_not_establish=None):
    """Assemble the terms. vocabulary_ref: {name, version, sha256, url}. items: list of item dicts.
    The caller pins the result into a contract with bind_terms; nothing here signs."""
    return {
        "schema": SCHEMA,
        "vocabulary": dict(vocabulary_ref),
        "items": list(items),
        "deadline": deadline,
        "price": price,
        "establishes": list(establishes or DEFAULT_ESTABLISHES),
        "does_not_establish": list(does_not_establish or DEFAULT_DNE),
    }


def make_vocabulary(name, version, items, source=None):
    """An a2a-vocabulary-v0 document. items: {item_id: {"unit": str, "label"?: str, "methods"?: [str]}}.
    source, when the vocabulary wraps someone else's dataset: {"url": https, "sha256": hex64} of that
    dataset's bytes, so the wrapper itself is pinned to what it wraps."""
    doc = {"schema": VOCAB_SCHEMA, "name": name, "version": version, "items": items}
    if source is not None:
        doc["source"] = source
    return doc


def vocabulary_bytes(vocabulary):
    """The bytes a publisher would put at the URL. Canonical here for determinism in tests; any bytes
    work as long as the same bytes are what everyone hashes."""
    return canonical(vocabulary).encode("utf-8")


def bind_terms(task, terms):
    """Pin the terms into a contract's task block. verify_contract leaves task's extra keys alone; the
    contract's two signatures then cover this digest."""
    task["terms_schema"] = SCHEMA
    task["terms_sha256"] = terms_sha256(terms)
    return task


# --------------------------------------------------------------------------- verify
def _door(r, obj, allowed, where, code):
    extra = sorted(k for k in obj.keys() if k not in allowed)
    if extra:
        r.refuse(code, "%s carries keys no verifier reads: %s" % (where, ", ".join(extra)))
    return not extra


def _check_vocabulary_ref(r, ref):
    if not isinstance(ref, dict):
        r.refuse("bad_vocabulary", "vocabulary must be an object {name, version, sha256, url}")
        return None
    _door(r, ref, VOCAB_REF_KEYS, "vocabulary", "unknown_vocabulary_key")
    for f in ("name", "version"):
        if not (isinstance(ref.get(f), str) and ref[f]):
            r.refuse("bad_vocabulary", "vocabulary.%s must be a non empty string" % f)
    if not (isinstance(ref.get("sha256"), str) and HEX64.match(ref["sha256"])):
        r.refuse("bad_vocabulary", "vocabulary.sha256 must be 64 lowercase hex over the vocabulary's exact bytes")
    url = ref.get("url")
    if url is not None and not host_of_https(url):
        r.refuse("bad_vocabulary_url", "vocabulary.url, when present, must be an https URL")
    if url is None:
        r.find("vocabulary_unlocated", "vocabulary carries no url; the bytes must reach the reader by another route")
    return ref


def _check_item(r, i, item, seen):
    where = "items[%d]" % i
    if not isinstance(item, dict):
        r.refuse("bad_item", "%s must be an object" % where)
        return
    _door(r, item, ITEM_KEYS, where, "unknown_item_key")
    missing = [k for k in PINNING_KEYS if k not in item]
    if missing:
        r.refuse("unpinned_term", "%s lacks %s; a deliverable without a vocabulary item, a quantity, a unit and a "
                                  "completion test is free text, and free text is not a term" % (where, ", ".join(missing)))
        return
    iid = item.get("item_id")
    if not (isinstance(iid, str) and iid):
        r.refuse("bad_item_field", "%s.item_id must be a non empty string" % where)
    elif iid in seen:
        r.refuse("duplicate_item", "%s.item_id %r appears more than once" % (where, iid))
    else:
        seen.add(iid)
    if "label" in item and not isinstance(item["label"], str):
        r.refuse("bad_item_field", "%s.label, when present, must be a string (the verifier does not read it)" % where)
    q = _qty(item.get("quantity"))
    if q is None or q[0] == 0:
        r.refuse("bad_quantity", "%s.quantity must be a positive safe integer or {value, scale} with scale 0..%d" % (where, MAX_SCALE))
    if not (isinstance(item.get("unit"), str) and item["unit"]):
        r.refuse("bad_item_field", "%s.unit must be a non empty string" % where)
    tol = item.get("tolerance_bp", 0)
    if not (_is_int(tol) and 0 <= tol <= MAX_BP):
        r.refuse("bad_tolerance", "%s.tolerance_bp must be an integer 0..%d (basis points; 200 is 2 percent)" % (where, MAX_BP))
    ct = item.get("completion_test")
    if not isinstance(ct, dict):
        r.refuse("bad_completion_test", "%s.completion_test must be an object {method, evidence_schema}" % where)
    else:
        _door(r, ct, TEST_KEYS, where + ".completion_test", "unknown_completion_test_key")
        for f in ("method", "evidence_schema"):
            if not (isinstance(ct.get(f), str) and ct[f]):
                r.refuse("bad_completion_test", "%s.completion_test.%s must be a non empty string" % (where, f))
    if "spec" in item and not isinstance(item["spec"], dict):
        r.refuse("bad_item_field", "%s.spec, when present, must be an object" % where)


def _check_deadline(r, dl):
    if dl is None:
        r.find("no_deadline", "terms carry no deadline")
        return
    if not isinstance(dl, dict) or set(dl.keys()) != {"kind", "height"}:
        r.refuse("bad_deadline", "deadline must be {kind, height}")
        return
    if dl.get("kind") not in DEADLINE_KINDS:
        r.refuse("deadline_kind_unsupported", "deadline.kind %r is not one of %s; a wall clock is not a clock any "
                                              "verifier here can read offline" % (dl.get("kind"), sorted(DEADLINE_KINDS)))
    if not (_is_int(dl.get("height")) and dl["height"] > 0):
        r.refuse("bad_deadline", "deadline.height must be a positive integer")


def _check_price(r, price):
    if price is None:
        return
    if not isinstance(price, dict) or set(price.keys()) != {"amount", "currency"}:
        r.refuse("bad_price", "price must be {amount, currency}")
        return
    if not (_is_int(price.get("amount")) and 0 <= price["amount"] <= SAFE_INT_MAX):
        r.refuse("bad_price", "price.amount must be a non negative safe integer in minor units")
    if not (isinstance(price.get("currency"), str) and CURRENCY.match(price["currency"])):
        r.refuse("bad_price", "price.currency must be three uppercase letters")


def _check_statements(r, terms):
    est = terms.get("establishes")
    if not isinstance(est, list) or not all(isinstance(s, str) for s in est):
        r.refuse("bad_establishes", "establishes must be a list of strings")
    else:
        for s in est:
            for rx, label in OVERCLAIM:
                if re.search(rx, s, re.IGNORECASE):
                    r.refuse("overclaim", "establishes claims %s: %r" % (label, s))
    dne = terms.get("does_not_establish")
    if not isinstance(dne, list) or not all(isinstance(s, str) for s in dne):
        r.refuse("bad_does_not_establish", "does_not_establish must be a list of strings")
    else:
        low = " ".join(dne).lower()
        for name, kws in REQUIRED_DNE:
            if not any(k in low for k in kws):
                r.refuse("missing_does_not_establish", "does_not_establish must cover: %s" % name)


def _resolve_vocabulary(r, ref, vocabulary_bytes_):
    """Parse the supplied bytes, check them against the pinned digest, return the items map or None."""
    got = vocabulary_sha256(vocabulary_bytes_)
    if ref.get("sha256") != got:
        r.refuse("vocabulary_sha_mismatch", "terms pin vocabulary %s, supplied bytes hash to %s" % (ref.get("sha256"), got))
        return None
    try:
        doc = parse_strict(vocabulary_bytes_.decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        r.refuse("vocabulary_unreadable", "vocabulary bytes are not strict JSON: %s" % e.__class__.__name__)
        return None
    if not isinstance(doc, dict) or doc.get("schema") != VOCAB_SCHEMA:
        r.refuse("vocabulary_schema_unsupported", "vocabulary bytes are not an %s document; wrap a foreign dataset in one" % VOCAB_SCHEMA)
        return None
    if doc.get("name") != ref.get("name") or doc.get("version") != ref.get("version"):
        r.refuse("vocabulary_ref_mismatch", "terms call the vocabulary %r %r, the bytes call themselves %r %r"
                 % (ref.get("name"), ref.get("version"), doc.get("name"), doc.get("version")))
    items = doc.get("items")
    if not isinstance(items, dict) or not items:
        r.refuse("vocabulary_unreadable", "vocabulary.items must be a non empty object keyed by item_id")
        return None
    for path, why, shown in scan_numbers(doc):
        r.refuse("vocabulary_number", "vocabulary %s is %s (%s)" % (path, why, shown))
    return items


def _resolve_items(r, terms, vitems):
    for i, item in enumerate(terms.get("items") or []):
        if not isinstance(item, dict):
            continue
        iid = item.get("item_id")
        ent = vitems.get(iid) if isinstance(iid, str) else None
        if not isinstance(ent, dict):
            r.refuse("item_not_in_vocabulary", "items[%d].item_id %r is not an entry of the pinned vocabulary" % (i, iid))
            continue
        if ent.get("unit") != item.get("unit"):
            r.refuse("unit_mismatch", "items[%d] uses unit %r, the vocabulary fixes %r for %r" % (i, item.get("unit"), ent.get("unit"), iid))
        methods = ent.get("methods")
        ct = item.get("completion_test") if isinstance(item.get("completion_test"), dict) else {}
        if isinstance(methods, list) and ct.get("method") not in methods:
            r.refuse("method_not_in_vocabulary", "items[%d].completion_test.method %r is not one the vocabulary lists for %r: %s"
                     % (i, ct.get("method"), iid, ", ".join(str(m) for m in methods)))


def _out(r, tsha, undetermined_ok=False, extra=None):
    if r.refusals:
        verdict = "refused"
    elif undetermined_ok:
        verdict = "undetermined"
    else:
        verdict = "accepted"
    out = {"schema": "a2a-terms-verify-v0", "verdict": verdict, "terms_sha256": tsha,
           "refusals": sorted(r.refusals, key=canonical), "findings": sorted(r.findings, key=canonical)}
    if extra:
        out.update(extra)
    return out


def verify_terms(terms, vocabulary_bytes=None, contract=None):
    """Offline. Shape, key doors, integers only, deadline kind, statements; the contract pin when a
    contract is supplied; item resolution against the vocabulary when its bytes are supplied.
    verdict: accepted / refused / undetermined (structure holds, vocabulary bytes absent)."""
    r = v0.R()
    if not isinstance(terms, dict) or terms.get("schema") != SCHEMA:
        r.refuse("bad_schema", "not an %s record" % SCHEMA)
        return _out(r, None)
    tsha = terms_sha256(terms)
    _door(r, terms, TERMS_KEYS, "terms", "unknown_key")

    for path, why, shown in scan_numbers(terms):
        code = "non_integer_number" if why == "not an integer" else "unsafe_number"
        r.refuse(code, "%s is %s (%s); terms carry integers only, a decimal is {value, scale}" % (path, why, shown))

    ref = _check_vocabulary_ref(r, terms.get("vocabulary"))
    items = terms.get("items")
    if not isinstance(items, list) or not items:
        r.refuse("no_items", "items must be a non empty list")
    else:
        seen = set()
        for i, item in enumerate(items):
            _check_item(r, i, item, seen)
    _check_deadline(r, terms.get("deadline"))
    _check_price(r, terms.get("price"))
    _check_statements(r, terms)

    if contract is not None:
        task = contract.get("task") if isinstance(contract, dict) else None
        pin = task.get("terms_sha256") if isinstance(task, dict) else None
        if pin is None:
            r.refuse("terms_not_pinned", "the contract's task carries no terms_sha256; these terms are not what was signed")
        elif pin != tsha:
            r.refuse("terms_sha_mismatch", "contract pins terms %s, these terms hash to %s" % (pin, tsha))

    undetermined = False
    if vocabulary_bytes is None:
        r.find("vocabulary_bytes_not_supplied", "items cannot be resolved without the vocabulary bytes; supply them, "
                                                "the verifier fetches nothing")
        undetermined = True
    elif ref is not None and not r.refusals:
        vitems = _resolve_vocabulary(r, ref, vocabulary_bytes)
        if vitems is not None:
            _resolve_items(r, terms, vitems)

    n_items = len(items) if isinstance(items, list) else 0
    return _out(r, tsha, undetermined, {"counts": {"items": n_items}})


# --------------------------------------------------------------------------- completion
def check_completion(terms, evidence, vocabulary_bytes=None):
    """Pure. terms + measurements -> within_terms / outside_terms / undetermined / refused.
    A measurement is {item_id, measured, method, evidence_ref?}. One per item; a second measurement for
    the same item is refused, not averaged. method must equal the item's completion_test.method or the
    agreed test was not the one run (method_mismatch counts as outside_terms)."""
    tv = verify_terms(terms, vocabulary_bytes)
    r = v0.R()
    tsha = tv.get("terms_sha256")
    if tv["verdict"] == "refused":
        return {"schema": "a2a-terms-completion-v0", "verdict": "refused", "terms_sha256": tsha,
                "refusals": [{"code": "terms_refused", "why": "the terms themselves do not verify"}] + tv["refusals"],
                "findings": tv["findings"], "items": [], "counts": {"items": 0, "within": 0, "outside": 0, "unmeasured": 0}}
    for f in tv["findings"]:
        r.findings.append(f)

    if not isinstance(evidence, dict) or evidence.get("schema") != EVIDENCE_SCHEMA:
        r.refuse("bad_evidence_schema", "evidence must be an %s record" % EVIDENCE_SCHEMA)
        return _completion_out(r, tsha, [], tv["verdict"] == "undetermined")
    _door(r, evidence, EVIDENCE_KEYS, "evidence", "unknown_evidence_key")
    if evidence.get("terms_sha256") != tsha:
        r.refuse("evidence_names_other_terms", "evidence names terms %s, these terms hash to %s" % (evidence.get("terms_sha256"), tsha))
    for path, why, shown in scan_numbers(evidence):
        r.refuse("non_integer_number" if why == "not an integer" else "unsafe_number", "evidence %s is %s (%s)" % (path, why, shown))

    meas = evidence.get("measurements")
    by_id = {}
    if not isinstance(meas, list):
        r.refuse("bad_measurements", "evidence.measurements must be a list")
        meas = []
    for i, m in enumerate(meas):
        where = "measurements[%d]" % i
        if not isinstance(m, dict):
            r.refuse("bad_measurement", "%s must be an object" % where)
            continue
        _door(r, m, MEASUREMENT_KEYS, where, "unknown_measurement_key")
        iid = m.get("item_id")
        if not (isinstance(iid, str) and iid):
            r.refuse("bad_measurement", "%s.item_id must be a non empty string" % where)
            continue
        if iid in by_id:
            r.refuse("duplicate_measurement", "%s repeats item_id %r; two figures for one item are refused, not averaged" % (where, iid))
            continue
        if _qty(m.get("measured")) is None:
            r.refuse("bad_measurement", "%s.measured must be a safe integer or {value, scale}" % where)
            continue
        if not (isinstance(m.get("method"), str) and m["method"]):
            r.refuse("bad_measurement", "%s.method must be a non empty string" % where)
            continue
        by_id[iid] = m

    results = []
    for item in terms["items"]:
        iid = item["item_id"]
        q = _qty(item["quantity"])
        tol = item.get("tolerance_bp", 0)
        m = by_id.get(iid)
        if m is None:
            results.append({"item_id": iid, "status": "unmeasured", "why": "no measurement carries this item_id"})
            continue
        if m["method"] != item["completion_test"]["method"]:
            results.append({"item_id": iid, "status": "outside_terms", "why": "method_mismatch",
                            "agreed_method": item["completion_test"]["method"], "measured_method": m["method"]})
            continue
        ok, dev_bp = within_tolerance(q, _qty(m["measured"]), tol)
        results.append({"item_id": iid, "status": "within_terms" if ok else "outside_terms",
                        "quantity": item["quantity"], "measured": m["measured"], "unit": item["unit"],
                        "tolerance_bp": tol, "deviation_bp": dev_bp, "evidence_ref": m.get("evidence_ref")})
    for iid in sorted(by_id):
        if iid not in {it["item_id"] for it in terms["items"]}:
            r.find("measurement_outside_terms", "measurement for %r names no item of these terms; ignored" % iid)
    return _completion_out(r, tsha, results, tv["verdict"] == "undetermined")


def _completion_out(r, tsha, results, terms_undetermined):
    counts = {"items": len(results),
              "within": sum(1 for x in results if x["status"] == "within_terms"),
              "outside": sum(1 for x in results if x["status"] == "outside_terms"),
              "unmeasured": sum(1 for x in results if x["status"] == "unmeasured")}
    if r.refusals:
        verdict = "refused"
    elif counts["outside"]:
        verdict = "outside_terms"
    elif counts["unmeasured"] or terms_undetermined or not results:
        verdict = "undetermined"
    else:
        verdict = "within_terms"
    return {"schema": "a2a-terms-completion-v0", "verdict": verdict, "terms_sha256": tsha,
            "refusals": sorted(r.refusals, key=canonical), "findings": sorted(r.findings, key=canonical),
            "items": results, "counts": counts,
            "does_not_establish": [
                "that any measured figure is true; only its integer distance from the agreed quantity",
                "that the measurer is independent of either party; check who signed the evidence yourself",
                "that HS judges quality, liability or fault; this verdict is a function anyone recomputes",
            ]}


# --------------------------------------------------------------------------- self test
def _selftest():
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    import base64, random

    def newkey():
        k = Ed25519PrivateKey.generate()
        return k, base64.b64encode(k.public_key().public_bytes(serialization.Encoding.Raw,
                                                               serialization.PublicFormat.Raw)).decode()

    def codes(out):
        return {x["code"] for x in out["refusals"]}

    def fcodes(out):
        return {x["code"] for x in out["findings"]}

    n = 0
    vocab = make_vocabulary("paint-works-glossary", "2026.09", {
        "wall_paint_exterior": {"unit": "dm2", "label": "exterior wall painting, finished surface",
                                "methods": ["laser_area_survey", "photo_grid_count"]},
        "paint_coats": {"unit": "coat", "methods": ["wet_film_gauge"]},
        "scaffold_days": {"unit": "day"},
    }, source={"url": "https://example.test/glossary/2026.09.json", "sha256": "e" * 64})
    vb = vocabulary_bytes(vocab)
    vref = {"name": "paint-works-glossary", "version": "2026.09", "sha256": vocabulary_sha256(vb),
            "url": "https://example.test/glossary/2026.09.json"}
    ITEMS = [
        {"item_id": "wall_paint_exterior", "label": "north and west faces", "quantity": {"value": 1874, "scale": 0}, "unit": "dm2",
         "tolerance_bp": 200, "spec": {"manufacturer": "X", "product": "Y"},
         "completion_test": {"method": "laser_area_survey", "evidence_schema": "a2a-terms-evidence-v0"}},
        {"item_id": "paint_coats", "quantity": 3, "unit": "coat", "tolerance_bp": 0,
         "completion_test": {"method": "wet_film_gauge", "evidence_schema": "a2a-terms-evidence-v0"}},
    ]
    good = build_terms(vref, ITEMS, deadline={"kind": "bitcoin_block", "height": 972000},
                       price={"amount": 480000, "currency": "JPY"})

    # [1] honest terms with vocabulary bytes: accepted; the sha is stable under key order
    out = verify_terms(good, vb)
    assert out["verdict"] == "accepted" and out["counts"]["items"] == 2, out
    shuffled = json.loads(json.dumps(good))
    shuffled["items"][0] = dict(reversed(list(shuffled["items"][0].items())))
    assert terms_sha256(shuffled) == terms_sha256(good)
    n += 1; print("[1] two vocabulary items, integer decimal, tolerance in bp, block deadline: accepted; sha stable under key order")

    # [2] the hole itself: a free text deliverable is not a term
    free = build_terms(vref, [{"label": "high quality renovation"}])
    out = verify_terms(free, vb)
    assert out["verdict"] == "refused" and "unpinned_term" in codes(out), out
    half = build_terms(vref, [{"item_id": "wall_paint_exterior", "quantity": 1874, "unit": "dm2"}])   # no completion test
    assert "unpinned_term" in codes(verify_terms(half, vb))
    n += 1; print("[2] 'high quality renovation' and an item without a completion test: refused as unpinned_term")

    # [3] floats refused, decimals carried as {value, scale}
    fl = json.loads(json.dumps(good)); fl["items"][0]["quantity"] = 187.4
    out = verify_terms(fl, vb)
    assert out["verdict"] == "refused" and "non_integer_number" in codes(out), out
    dec = json.loads(json.dumps(good)); dec["items"][0]["quantity"] = {"value": 18740, "scale": 1}
    assert verify_terms(dec, vb)["verdict"] == "accepted"
    big = json.loads(json.dumps(good)); big["price"]["amount"] = 2 ** 53
    assert "unsafe_number" in codes(verify_terms(big, vb))
    n += 1; print("[3] 187.4 refused (non_integer_number); {value: 18740, scale: 1} accepted; 2^53 refused (unsafe_number)")

    # [4] vocabulary resolution: unknown item, wrong unit, method outside the vocabulary's list, wrong bytes
    bad_id = json.loads(json.dumps(good)); bad_id["items"][1]["item_id"] = "paint_coats_premium"
    assert "item_not_in_vocabulary" in codes(verify_terms(bad_id, vb))
    bad_unit = json.loads(json.dumps(good)); bad_unit["items"][0]["unit"] = "m2"
    assert "unit_mismatch" in codes(verify_terms(bad_unit, vb))
    bad_m = json.loads(json.dumps(good)); bad_m["items"][0]["completion_test"]["method"] = "eyeball"
    assert "method_not_in_vocabulary" in codes(verify_terms(bad_m, vb))
    other = vocabulary_bytes(make_vocabulary("paint-works-glossary", "2026.09", {"wall_paint_exterior": {"unit": "m2"}, "paint_coats": {"unit": "coat"}}))
    out = verify_terms(good, other)
    assert out["verdict"] == "refused" and "vocabulary_sha_mismatch" in codes(out), out
    renamed = json.loads(json.dumps(good)); renamed["vocabulary"]["name"] = "some-other-glossary"
    assert "vocabulary_ref_mismatch" in codes(verify_terms(renamed, vb))
    n += 1; print("[4] item not in vocabulary, unit differs, method not listed, other bytes, renamed ref: each refused by name")

    # [5] vocabulary bytes absent: undetermined, never accepted on faith, never refused for a fetch
    out = verify_terms(good)
    assert out["verdict"] == "undetermined" and not out["refusals"] and "vocabulary_bytes_not_supplied" in fcodes(out), out
    n += 1; print("[5] no vocabulary bytes: undetermined with the reason, zero refusals")

    # [6] key doors: a key no verifier reads is refused at every level
    k1 = json.loads(json.dumps(good)); k1["items"][0]["note"] = "or whatever the contractor thinks is fine"
    assert "unknown_item_key" in codes(verify_terms(k1, vb))
    k2 = json.loads(json.dumps(good)); k2["side_letter"] = "payment on handshake"
    assert "unknown_key" in codes(verify_terms(k2, vb))
    k3 = json.loads(json.dumps(good)); k3["items"][0]["completion_test"]["fallback"] = "principal's opinion"
    assert "unknown_completion_test_key" in codes(verify_terms(k3, vb))
    k4 = json.loads(json.dumps(good)); k4["vocabulary"]["mirror"] = "http://x"
    assert "unknown_vocabulary_key" in codes(verify_terms(k4, vb))
    n += 1; print("[6] unknown key in item, top level, completion_test, vocabulary ref: refused, never ignored")

    # [7] deadline and price doors; statements
    wall = json.loads(json.dumps(good)); wall["deadline"] = {"kind": "utc", "height": 1}
    assert "deadline_kind_unsupported" in codes(verify_terms(wall, vb))
    nodl = json.loads(json.dumps(good)); nodl["deadline"] = None
    o = verify_terms(nodl, vb); assert o["verdict"] == "accepted" and "no_deadline" in fcodes(o)
    bp = json.loads(json.dumps(good)); bp["items"][0]["tolerance_bp"] = 10001
    assert "bad_tolerance" in codes(verify_terms(bp, vb))
    zero = json.loads(json.dumps(good)); zero["items"][1]["quantity"] = 0
    assert "bad_quantity" in codes(verify_terms(zero, vb))
    dup = json.loads(json.dumps(good)); dup["items"].append(json.loads(json.dumps(good["items"][1])))
    assert "duplicate_item" in codes(verify_terms(dup, vb))
    cur = json.loads(json.dumps(good)); cur["price"]["currency"] = "yen"
    assert "bad_price" in codes(verify_terms(cur, vb))
    oc = json.loads(json.dumps(good)); oc["establishes"].append("that the work was performed and paid")
    assert "overclaim" in codes(verify_terms(oc, vb))
    nd = json.loads(json.dumps(good)); nd["does_not_establish"] = ["nothing"]
    assert "missing_does_not_establish" in codes(verify_terms(nd, vb))
    n += 1; print("[7] wall clock deadline, tolerance over 10000 bp, zero quantity, duplicate item, bad currency, overclaim, thin does_not_establish: refused")

    # [8] the contract pin: verify_contract still accepts a task carrying terms_sha256; swapped terms fail the pin
    ka, pa = newkey(); kb, pb = newkey(); kw, pw = newkey()
    DNE = ["that HS enforced any of this at runtime",
           "that the contractor obeyed the grant, only that its recorded acts match or deviate from it",
           "that HS judges liability or fault; the verdict is a function anyone recomputes",
           "that a prohibited action was impossible, only that performing one is a provable deviation",
           "that this is a legal contract or determines legal responsibility"]
    grant = {"authorized_actions": ["paint"], "prohibited_actions": ["demolish"], "delegation": {"allowed": []},
             "revocation": {"effective_at": "anchor"}, "finality": {"depth": 3, "max_target_bits": "207fffff"},
             "witnesses": [{"name": "w", "public_key_ed25519_b64": pw}]}
    task = bind_terms({"purpose": "exterior_wall_painting", "payload_digest": "a" * 64, "a2a_task_id": "t-terms-1"}, good)
    c = v0.build_contract(
        {"domain": "gate.horizonshield.dev", "key_url": "https://gate.horizonshield.dev/keys/agreement.json", "public_key_ed25519_b64": pa},
        {"domain": "api.babyblueviper.com", "key_url": "https://api.babyblueviper.com/keys/agreement.json", "public_key_ed25519_b64": pb},
        task, grant, ["that both parties signed these grant bytes at the stated time"], DNE,
        lower_bound={"kind": "bitcoin_block", "height": 968325, "hash": "0" * 64},
        contract_id="0123456789abcdef0123456789abcdef", nonce="c" * 32, agreed_at="2026-09-26T00:00:00Z")
    v0.sign_contract(c, ka, pa, "gate.horizonshield.dev"); v0.sign_contract(c, kb, pb, "api.babyblueviper.com")
    cv = v0.verify_contract(c)
    assert cv["verdict"] == "accepted", cv
    assert verify_terms(good, vb, contract=c)["verdict"] == "accepted"
    swapped = json.loads(json.dumps(good)); swapped["items"][1]["quantity"] = 2       # one coat fewer, same label
    out = verify_terms(swapped, vb, contract=c)
    assert out["verdict"] == "refused" and "terms_sha_mismatch" in codes(out), out
    c_nopin = json.loads(json.dumps(c)); del c_nopin["task"]["terms_sha256"]
    assert "terms_not_pinned" in codes(verify_terms(good, vb, contract=c_nopin))
    n += 1; print("[8] contract with task.terms_sha256 verifies; terms with one coat fewer fail the pin; a contract without the pin is refused")

    # [9] completion: within, outside, unmeasured, method mismatch, duplicate, other terms; deterministic
    def ev(ms):
        return {"schema": EVIDENCE_SCHEMA, "terms_sha256": terms_sha256(good), "measurements": ms}
    M1 = {"item_id": "wall_paint_exterior", "measured": {"value": 18500, "scale": 1}, "method": "laser_area_survey",
          "evidence_ref": {"nenrin_sha256": "b" * 64}}
    M2 = {"item_id": "paint_coats", "measured": 3, "method": "wet_film_gauge"}
    out = check_completion(good, ev([M1, M2]), vb)
    assert out["verdict"] == "within_terms" and out["counts"] == {"items": 2, "within": 2, "outside": 0, "unmeasured": 0}, out
    assert out["items"][0]["deviation_bp"] == 128, out["items"][0]      # |1850.0 - 1874| = 24 dm2 on 1874 = 128 bp floored
    out = check_completion(good, ev([dict(M1, measured=1700), M2]), vb)
    assert out["verdict"] == "outside_terms" and out["items"][0]["deviation_bp"] == 928, out
    out = check_completion(good, ev([M1]), vb)
    assert out["verdict"] == "undetermined" and out["counts"]["unmeasured"] == 1, out
    out = check_completion(good, ev([M1, dict(M2, method="visual")]), vb)
    assert out["verdict"] == "outside_terms" and out["items"][1]["why"] == "method_mismatch", out
    out = check_completion(good, ev([M1, M2, dict(M2, measured=2)]), vb)
    assert out["verdict"] == "refused" and "duplicate_measurement" in codes(out), out
    e = ev([M1, M2]); e["terms_sha256"] = "f" * 64
    assert "evidence_names_other_terms" in codes(check_completion(good, e, vb))
    out = check_completion(good, ev([M1, M2]))                          # no vocabulary bytes
    assert out["verdict"] == "undetermined" and out["counts"]["within"] == 2, out
    ref = canonical(check_completion(good, ev([M1, M2]), vb))
    for _ in range(5):
        ms = [M1, M2]; random.shuffle(ms)
        assert canonical(check_completion(json.loads(json.dumps(good)), ev(ms), vb)) == ref
    exact = check_completion(good, ev([dict(M1, measured=1874), M2]), vb)
    assert exact["items"][0]["deviation_bp"] == 0
    n += 1; print("[9] completion: 1850 of 1874 at 200 bp within (128 bp); 1700 outside (928 bp); missing item undetermined; "
                  "wrong method outside; two figures refused; other terms refused; no vocabulary undetermined with the arithmetic shown; deterministic")

    # [10] a foreign dataset wraps into a vocabulary and pins the same way; the wrapper carries the source digest
    jccdb_like = make_vocabulary("jccdb-wrapper", "2026.09", {"concrete_ready_mix_nara_18_18_20": {"unit": "m3", "methods": ["delivery_slip_count"]}},
                                 source={"url": "https://example.test/jccdb/2026.09.json", "sha256": "d" * 64})
    jb = vocabulary_bytes(jccdb_like)
    t = build_terms({"name": "jccdb-wrapper", "version": "2026.09", "sha256": vocabulary_sha256(jb), "url": None},
                    [{"item_id": "concrete_ready_mix_nara_18_18_20", "quantity": {"value": 125, "scale": 1}, "unit": "m3", "tolerance_bp": 300,
                      "completion_test": {"method": "delivery_slip_count", "evidence_schema": "a2a-terms-evidence-v0"}}])
    out = verify_terms(t, jb)
    assert out["verdict"] == "accepted" and "vocabulary_unlocated" in fcodes(out), out
    assert verify_terms(t, vb)["verdict"] == "refused"                  # the paint glossary is not this vocabulary
    n += 1; print("[10] a wrapped foreign dataset is just another vocabulary: accepted by its own bytes, refused against other bytes; no url is a finding")

    print("\nSELF-TEST PASSED: MUSUBI terms v0, %d checks (pinning, free text refused, integers, vocabulary resolution, "
          "undetermined without bytes, key doors, deadline and price doors, contract pin, completion arithmetic, foreign vocabulary)" % n)


def main():
    ap = argparse.ArgumentParser(description="MUSUBI terms v0 (a2a-terms-v0: meaning inside the signed bytes)")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--verify", metavar="TERMS.json")
    ap.add_argument("--completion", metavar="TERMS.json")
    ap.add_argument("--evidence", metavar="EVIDENCE.json")
    ap.add_argument("--vocabulary", metavar="VOCAB.json", help="the vocabulary's exact bytes; without them items stay undetermined")
    ap.add_argument("--contract", metavar="CONTRACT.json", help="check task.terms_sha256 against these terms")
    ap.add_argument("--sha", metavar="TERMS.json", help="print terms_sha256")
    a = ap.parse_args()
    if a.selftest:
        _selftest(); return 0
    rd = lambda p: parse_strict(open(p, encoding="utf-8").read())
    vb = open(a.vocabulary, "rb").read() if a.vocabulary else None
    if a.sha:
        print(terms_sha256(rd(a.sha))); return 0
    if a.verify:
        out = verify_terms(rd(a.verify), vb, contract=rd(a.contract) if a.contract else None)
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return {"accepted": 0, "undetermined": 3}.get(out["verdict"], 2)
    if a.completion and a.evidence:
        out = check_completion(rd(a.completion), rd(a.evidence), vb)
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return {"within_terms": 0, "undetermined": 3}.get(out["verdict"], 2)
    ap.print_help(); return 1


if __name__ == "__main__":
    sys.exit(main())
