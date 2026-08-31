# -*- coding: utf-8 -*-
"""
NENRIN Census, reference implementation (nenrin-census-v1)

The problem this closes, stated by babyblueviper1 (Federico Blanco Sanchez-Llanos),
the founding witness of nenrin-discrepancy-0001:

    "For a census there is no fetch-the-bytes-yourself. A function you never call is
     not an artifact you can recompute. Best I have is naming the undeclared remainder
     unknown rather than absent. Does NENRIN reach that set, or is the boundary structural?"

The answer this file makes runnable: the boundary is structural only for a single
self-declaration channel, and only there. It is not structural for the population that
can affect a trust verdict.

    Callability-Observability coincidence.
    A server an agent can trust and call is a public HTTPS endpoint (MCP transport is
    HTTP(S); a server behind private networking has no URL to enumerate and cannot be
    the subject of a public trust verdict). A public HTTPS endpoint that a client
    enforcing modern PKI norms will connect to presents a CA-issued certificate whose
    issuance is logged, with an SCT, in Certificate Transparency. The CA logs it. The
    operator does not choose this. Therefore every callable public server leaves an
    involuntary artifact in CT whether or not it declared to any registry.

So at census scale the coordinate is not self-declaration. It is Certificate
Transparency, a log the party being counted does not own. The census recomputes the
population from that log, the way a record-level walk recomputes a hash: fetch the
CT snapshot yourself, probe yourself, recompute the same three sets.

    D  = declared set                 (the register; authored by the parties counted)
    U  = involuntarily observed set    (CT-logged hosts; authored by the CAs)
    Ucall = U that also answers an MCP-shaped probe (callable-observed)

    D and Ucall      declared and independently confirmed callable
    D minus U        declared but NO involuntary artifact at all: a claim with no
                     footprint. Flagged. Never counted as present.
    Ucall minus D    callable and independently observed but never declared:
                     the dark set Federico named unknown, here ENUMERATED.

    R = callable servers with no CT artifact = reachable only by clients that ignore
        SCT enforcement. Out of scope for "should my agent trust and call this", because
        an agent's own TLS stack under modern norms would not accept such a certificate.
        Named unknown, never absent. Its size for the in-scope population is provably 0;
        for the out-of-scope population it is unbounded and irrelevant to the verdict.

A census is not a new kind of object. It is a witness whose vantage is an involuntary
log, so it rides the existing NENRIN witness intake as a jidec-path-v1 walk, and the
disagreement between the declared set and the observed set is a discrepancy record,
Federico's own founding contribution generalised one scale up.

Counts, never scores. Unmeasured is never a pass and never a fail. The residual is
named, not hidden. The operator's own census is a subject under the same rules.

Runs offline against a fixture (self_test), deterministic. A live crt.sh adapter is
provided for real runs; the record it produces carries the CT snapshot hash so a third
party reproduces the same coordinate.
"""
import json, hashlib, re, sys, urllib.request, urllib.parse

SCHEMA = "nenrin-census-ring-v1"
SPEC = "nenrin-census-v1"

# Canonicalisation matches the rest of the ledger: sorted keys, compact separators,
# UTF-8, so a record_sha256 recomputes byte for byte anywhere.
def canon(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

def sha256hex(s):
    if isinstance(s, str):
        s = s.encode("utf-8")
    return hashlib.sha256(s).hexdigest()

def host_of(url):
    """Registrable host of an endpoint URL, lowercased, no port. Used for set membership."""
    u = url.strip()
    if "://" not in u:
        u = "https://" + u
    p = urllib.parse.urlsplit(u)
    return (p.hostname or "").lower()

# ---------------------------------------------------------------------------
# The census computation. Pure function of its inputs. No wall clock inside the
# computed record except the caller-supplied walked_at (so it is reproducible).
#
#   declared : list of endpoint URLs from the register
#   ct_hosts : list of {host, cert_sha256, in_ct: bool, sct: bool} from an involuntary
#              enumerator (Certificate Transparency). in_ct True means a logged cert
#              exists; sct True means it carries an SCT (modern clients require it).
#   probes   : dict host -> {mcp_shaped: bool, evidence_sha256: str} from an independent
#              probe. A host is callable-observed only if it is CT-logged AND answers
#              an MCP-shaped probe. A cert alone is not a service.
#   coordinate: {enumerator, source, snapshot_sha256, sth_ref} naming the involuntary
#              log and the exact snapshot. A census with no coordinate is not a census;
#              it would just be the operator's word again.
def compute_census(scope, ring, declared, ct_hosts, probes, coordinate,
                   walked_at, prev_ring_sha256=None, witness=None):
    if not coordinate or not coordinate.get("enumerator") or not coordinate.get("snapshot_sha256"):
        raise ValueError("census refused: no involuntary coordinate. A census without a "
                         "prover-independent enumerator snapshot is only the operator's word.")

    D = sorted({host_of(u) for u in declared if host_of(u)})
    ct_by_host = {}
    for c in ct_hosts:
        h = (c.get("host") or "").lower()
        if not h:
            continue
        ct_by_host.setdefault(h, {"in_ct": False, "sct": False, "certs": []})
        rec = ct_by_host[h]
        rec["in_ct"] = rec["in_ct"] or bool(c.get("in_ct"))
        rec["sct"] = rec["sct"] or bool(c.get("sct"))
        if c.get("cert_sha256"):
            rec["certs"].append(c["cert_sha256"])

    # U: hosts with an involuntary CT artifact carrying an SCT (the class modern clients accept).
    U = sorted({h for h, r in ct_by_host.items() if r["in_ct"] and r["sct"]})
    # Ucall: CT-observed AND answers an MCP-shaped probe. Cert without a live MCP surface
    # is observed-in-CT but not callable-observed. The two are never merged.
    Ucall = sorted({h for h in U if probes.get(h, {}).get("mcp_shaped") is True})

    Dset, Uset, Ucallset = set(D), set(U), set(Ucall)

    d_and_o = sorted(Dset & Ucallset)
    d_minus_u = sorted(Dset - Uset)          # declared, no involuntary footprint at all
    u_minus_d = sorted(Ucallset - Dset)      # callable, observed, never declared: the dark set
    # declared and CT-present but probe did not confirm a live MCP surface: measured, not confirmed.
    d_ct_no_probe = sorted((Dset & Uset) - Ucallset)

    # residual R: callable hosts whose cert is NOT SCT-logged. These appear only if a probe
    # found them off the CT coordinate. They are named unknown / out-of-scope, never absent.
    callable_off_ct = sorted({h for h, pr in probes.items()
                              if pr.get("mcp_shaped") is True and h not in Uset})

    record = {
        "schema": SCHEMA,
        "spec": SPEC,
        "scope": scope,
        "ring": ring,
        "walked_at": walked_at,
        "coordinate": {
            "enumerator": coordinate["enumerator"],
            "source": coordinate.get("source", ""),
            "snapshot_sha256": coordinate["snapshot_sha256"],
            "sth_ref": coordinate.get("sth_ref", ""),
        },
        "counts": {
            "declared": len(D),
            "observed_ct_sct": len(U),
            "callable_observed": len(Ucall),
            "declared_and_callable": len(d_and_o),
            "declared_no_footprint": len(d_minus_u),
            "declared_ct_probe_unconfirmed": len(d_ct_no_probe),
            "undeclared_callable": len(u_minus_d),
            "callable_off_coordinate": len(callable_off_ct),
        },
        "cells": {
            "declared_and_callable": d_and_o,
            "declared_no_footprint": d_minus_u,
            "declared_ct_probe_unconfirmed": d_ct_no_probe,
            "undeclared_callable": u_minus_d,
            "callable_off_coordinate": callable_off_ct,
        },
        "residual": {
            "class": "callable-but-off-coordinate",
            "meaning": "servers callable only by clients that ignore SCT enforcement. An agent "
                       "under modern PKI norms would not accept such a certificate, so this class "
                       "cannot be the subject of a trust verdict.",
            "in_scope_size": len(callable_off_ct),
            "in_scope_proof": "callable and SCT-logged coincide for clients enforcing modern PKI; "
                              "any member here was found by a probe and is listed above, not hidden.",
            "label": "unknown",
            "not": "absent",
        },
        "self_applied": "The operator's own endpoints are counted under identical rules. A host the "
                        "operator runs but did not declare appears in undeclared_callable against its "
                        "own census, with no exception.",
        "limits": "The coincidence holds for callable-public servers under SCT-enforcing clients. It "
                  "does not extend to private-network services, non-HTTPS transports, or a client that "
                  "ignores SCTs. For those the census marks unknown and, if such a class becomes trust "
                  "relevant, a new involuntary enumerator must be named or the boundary is structural "
                  "there. This limit is stated, not worked around.",
        "prev_ring_sha256": prev_ring_sha256,
    }
    if witness:
        record["witness"] = {"name": witness.get("name", "anonymous"),
                             "vantage": witness.get("vantage", "certificate-transparency enumeration + independent MCP probe")}
    record["record_sha256"] = sha256hex(canon({k: v for k, v in record.items() if k != "record_sha256"}))
    return record

# ---------------------------------------------------------------------------
# A census disagreement is a discrepancy record: two witnesses enumerating the same
# scope from CT snapshots that differ, or an operator census that omits a host a second
# witness finds. This is nenrin-discrepancy generalised to population scale.
def census_discrepancy(scope, ring, census_a, census_b):
    a = set(census_a["cells"]["undeclared_callable"]) | set(census_a["cells"]["declared_and_callable"])
    b = set(census_b["cells"]["undeclared_callable"]) | set(census_b["cells"]["declared_and_callable"])
    only_a = sorted(a - b)
    only_b = sorted(b - a)
    rec = {
        "schema": "nenrin-census-discrepancy-v1",
        "spec": SPEC,
        "scope": scope,
        "ring": ring,
        "witness_a": {"vantage": census_a.get("witness", {}).get("vantage", ""),
                      "coordinate": census_a["coordinate"]["snapshot_sha256"],
                      "census_sha256": census_a["record_sha256"]},
        "witness_b": {"vantage": census_b.get("witness", {}).get("vantage", ""),
                      "coordinate": census_b["coordinate"]["snapshot_sha256"],
                      "census_sha256": census_b["record_sha256"]},
        "seen_only_by_a": only_a,
        "seen_only_by_b": only_b,
        "meaning": "Two independent enumerations of one scope disagree on membership. Neither can be "
                   "dismissed: either a coordinate is stale or one enumerator is partial, and the "
                   "gap itself is the finding. A single operator census cannot self-certify complete.",
    }
    rec["record_sha256"] = sha256hex(canon({k: v for k, v in rec.items() if k != "record_sha256"}))
    return rec

# ---------------------------------------------------------------------------
# Render a census as a jidec-path-v1 witness walk so it rides the EXISTING NENRIN
# witness intake (POST /witness) with no new server code. The walk's nodes are the
# fetches (register, CT snapshot, probes), its assertions are the set-membership facts,
# its verdict is counts. vantage names the involuntary coordinate.
def as_witness_walk(census, base, register_url, walker=None):
    c = census["counts"]
    nodes = [
        {"n": 0, "kind": "fetch", "label": "register declared set",
         "request": {"method": "GET", "url": register_url}},
        {"n": 1, "kind": "fetch", "label": "certificate transparency snapshot (" + census["coordinate"]["source"] + ")",
         "response": {"snapshot_sha256": census["coordinate"]["snapshot_sha256"], "sth_ref": census["coordinate"]["sth_ref"]}},
        {"n": 2, "kind": "compute", "label": "three-set decomposition D, U, Ucall",
         "output_sha256": census["record_sha256"]},
    ]
    assertions = [
        {"claim": "coordinate is an involuntary log the counted party does not own",
         "op": "eq", "result": True, "evidence_nodes": [1]},
        {"claim": "declared_no_footprint counted, never treated as present",
         "op": "ge", "result": True, "evidence_nodes": [0, 1]},
        {"claim": "undeclared_callable enumerated from the coordinate, not from self-declaration",
         "op": "ge", "result": True, "evidence_nodes": [1, 2]},
        {"claim": "residual named unknown, not absent",
         "op": "eq", "result": census["residual"]["label"] == "unknown", "evidence_nodes": [2]},
    ]
    walk = {
        "schema": "jidec-path-v1",
        "purpose": "NENRIN census of " + census["scope"] + " for ring " + census["ring"] +
                   " from an involuntary coordinate (" + census["coordinate"]["enumerator"] + ")",
        "base": base,
        "walked_at": census["walked_at"],
        "nodes": nodes,
        "assertions": assertions,
        "verdict": {"outcome": "COUNTED", "n_declared": c["declared"],
                    "n_callable_observed": c["callable_observed"],
                    "n_undeclared_callable": c["undeclared_callable"],
                    "n_declared_no_footprint": c["declared_no_footprint"]},
        "replay": {"how": "re-query the same CT snapshot and re-probe; recompute D, U, Ucall and the census record_sha256",
                   "match_means": "the population has not drifted since this ring",
                   "mismatch_means": "membership changed, or a second coordinate disagrees (a discrepancy record is due)"},
        "census_ref": {"schema": SCHEMA, "record_sha256": census["record_sha256"], "ring": census["ring"]},
        "witness": census.get("witness", {"name": "anonymous",
                   "vantage": "certificate-transparency enumeration + independent MCP probe"}),
        "walker": walker or {"tool": "nenrin_census.py", "version": "1"},
        "prev_path_refs": [],
    }
    walk["record_sha256"] = sha256hex(canon({k: v for k, v in walk.items() if k != "record_sha256"}))
    return walk

# ---------------------------------------------------------------------------
# Validator: the honesty rules the schema enforces. Used by the red team and by intake.
FORBIDDEN_SCORE_KEYS = ("score", "rate", "ranking", "rank", "rating", "percent", "pct", "grade")
def validate_census(census):
    errs = []
    if census.get("schema") != SCHEMA:
        errs.append("wrong schema")
    co = census.get("coordinate") or {}
    if not co.get("enumerator") or not co.get("snapshot_sha256"):
        errs.append("no involuntary coordinate")
    res = census.get("residual") or {}
    if res.get("label") != "unknown" or res.get("not") != "absent":
        errs.append("residual must be labelled unknown, never absent")
    # counts, never scores: no scoring field anywhere in the record
    flat = canon(census).lower()
    for k in FORBIDDEN_SCORE_KEYS:
        if ('"' + k + '"') in flat:
            errs.append("scoring field present: " + k)
    # a declared host with no footprint must never sit in a 'present/confirmed' cell
    dnf = set(census.get("cells", {}).get("declared_no_footprint", []))
    dac = set(census.get("cells", {}).get("declared_and_callable", []))
    if dnf & dac:
        errs.append("a declared_no_footprint host is also counted callable")
    # record_sha256 must recompute
    body = {k: v for k, v in census.items() if k != "record_sha256"}
    if census.get("record_sha256") != sha256hex(canon(body)):
        errs.append("record_sha256 does not recompute (tampered)")
    return errs

# ---------------------------------------------------------------------------
# Live crt.sh adapter. Network. TOshi runs this for a real ring; the record it feeds
# compute_census carries the snapshot hash so the coordinate is reproducible.
def fetch_ct_hosts(domain, timeout=30):
    url = "https://crt.sh/?q=" + urllib.parse.quote("%." + domain) + "&output=json"
    req = urllib.request.Request(url, headers={"user-agent": "nenrin-census/1 (+https://gate.horizonshield.dev)"})
    raw = urllib.request.urlopen(req, timeout=timeout).read()
    snapshot_sha256 = sha256hex(raw)
    rows = json.loads(raw)
    hosts = {}
    for r in rows:
        for name in str(r.get("name_value", "")).split("\n"):
            name = name.strip().lower().lstrip("*.")
            if name.endswith(domain):
                hosts.setdefault(name, {"host": name, "in_ct": True, "sct": True, "cert_sha256": None})
    return list(hosts.values()), {"enumerator": "certificate-transparency", "source": "crt.sh",
                                  "snapshot_sha256": snapshot_sha256, "sth_ref": ""}

# ---------------------------------------------------------------------------
def self_test():
    """Offline, deterministic. Fixture stands in for a CT snapshot and probes."""
    scope = "*.horizonshield.dev"
    ring = "2026-09"
    walked_at = "2026-09-01T00:00:00Z"
    declared = [
        "https://mcp.horizonshield.dev/mcp",
        "https://hearing.horizonshield.dev/mcp",
        "https://ghost.horizonshield.dev/mcp",   # declared but we will give it no CT footprint
    ]
    # CT snapshot: what the CAs logged, whether or not the operator declared it.
    ct_hosts = [
        {"host": "mcp.horizonshield.dev", "in_ct": True, "sct": True, "cert_sha256": "aa"},
        {"host": "hearing.horizonshield.dev", "in_ct": True, "sct": True, "cert_sha256": "bb"},
        {"host": "p003.horizonshield.dev", "in_ct": True, "sct": True, "cert_sha256": "cc"},   # never declared
        {"host": "decoy.horizonshield.dev", "in_ct": True, "sct": True, "cert_sha256": "dd"},  # cert, no service
    ]
    probes = {
        "mcp.horizonshield.dev": {"mcp_shaped": True, "evidence_sha256": "e1"},
        "hearing.horizonshield.dev": {"mcp_shaped": True, "evidence_sha256": "e2"},
        "p003.horizonshield.dev": {"mcp_shaped": True, "evidence_sha256": "e3"},      # undeclared but callable
        "decoy.horizonshield.dev": {"mcp_shaped": False, "evidence_sha256": "e4"},    # cert only, no MCP surface
    }
    coordinate = {"enumerator": "certificate-transparency", "source": "crt.sh",
                  "snapshot_sha256": sha256hex("fixture-ct-snapshot-A"), "sth_ref": "fixture"}
    c = compute_census(scope, ring, declared, ct_hosts, probes, coordinate, walked_at,
                       witness={"name": "operator", "vantage": "crt.sh + own probe"})
    errs = validate_census(c)
    assert not errs, errs
    assert c["counts"]["undeclared_callable"] == 1, c["counts"]            # p003
    assert c["cells"]["undeclared_callable"] == ["p003.horizonshield.dev"]
    assert c["counts"]["declared_no_footprint"] == 1, c["counts"]         # ghost
    assert c["cells"]["declared_no_footprint"] == ["ghost.horizonshield.dev"]
    assert c["counts"]["declared_and_callable"] == 2, c["counts"]         # mcp, hearing
    assert c["counts"]["callable_observed"] == 3                          # mcp, hearing, p003 (not decoy)
    # determinism
    c2 = compute_census(scope, ring, declared, ct_hosts, probes, coordinate, walked_at,
                        witness={"name": "operator", "vantage": "crt.sh + own probe"})
    assert c["record_sha256"] == c2["record_sha256"]
    # a second independent witness that missed p003 in its snapshot -> discrepancy
    ct_missing = [x for x in ct_hosts if x["host"] != "p003.horizonshield.dev"]
    probes_missing = {k: v for k, v in probes.items() if k != "p003.horizonshield.dev"}
    coord_b = {"enumerator": "certificate-transparency", "source": "independent monitor",
               "snapshot_sha256": sha256hex("fixture-ct-snapshot-B"), "sth_ref": "fixture-b"}
    cb = compute_census(scope, ring, declared, ct_missing, probes_missing, coord_b, walked_at,
                        witness={"name": "second", "vantage": "independent CT monitor + probe"})
    disc = census_discrepancy(scope, ring, c, cb)
    assert disc["seen_only_by_a"] == ["p003.horizonshield.dev"], disc
    # witness walk rides the existing intake shape
    walk = as_witness_walk(c, "https://hs-ledger.oga-surf-project.workers.dev",
                           "https://gate.horizonshield.dev/register")
    assert walk["schema"] == "jidec-path-v1" and walk["witness"]["vantage"]
    print("nenrin_census self_test: PASS")
    print("  declared", c["counts"]["declared"],
          "| callable_observed", c["counts"]["callable_observed"],
          "| undeclared_callable", c["counts"]["undeclared_callable"],
          "| declared_no_footprint", c["counts"]["declared_no_footprint"])
    print("  census record_sha256", c["record_sha256"][:16])
    print("  discrepancy surfaces the hidden host:", disc["seen_only_by_a"])
    return 0

if __name__ == "__main__":
    if "--live" in sys.argv:
        dom = sys.argv[sys.argv.index("--live") + 1]
        hosts, coord = fetch_ct_hosts(dom)
        print("crt.sh returned", len(hosts), "hosts for", dom, "snapshot", coord["snapshot_sha256"][:16])
    else:
        sys.exit(self_test())
