# -*- coding: utf-8 -*-
"""
NENRIN Census red team. Attack the census the way the gate and pagecheck red teams
attack their subjects: adversarial inputs, one poison each, fail-closed, deterministic,
offline against a mock Certificate Transparency snapshot. If one attack gets the census
to lie, exit 1.

What a lying census would look like, and what each attack proves the census refuses:

  1  hide_undeclared        an operator omits a callable host that CT shows. A second
                            witness recomputes from the same coordinate and the gap
                            surfaces as a discrepancy. The operator cannot self-certify
                            complete.
  2  decoy_cert_as_present  a host with a CT cert but no MCP surface is counted as a
                            live callable member. Refused: cert without a probe is
                            observed-in-CT, never callable-observed.
  3  declared_no_footprint  a declared host with no involuntary artifact is counted as
                            present. Refused: it sits in declared_no_footprint, flagged,
                            never in a present cell.
  4  tamper_record          one byte of the census is flipped after issue. Refused:
                            record_sha256 no longer recomputes.
  5  residual_relabel       the off-coordinate residual is relabelled absent or complete.
                            Refused: the validator requires unknown, never absent.
  6  no_coordinate          a census is offered with no involuntary coordinate, i.e. the
                            operator's word again. Refused at construction.
  7  score_smuggled         a score or rate field is smuggled into the record. Refused:
                            counts only, no scores.
  8  sct_ignoring_server    a callable server whose cert is not SCT-logged is silently
                            dropped or counted absent. Refused: it must surface in the
                            residual as unknown, out of scope, not vanish.

Controls (over-detection monitor, must PASS):
  c1 honest_complete        an honest census of a fully declared scope passes.
  c2 no_false_discrepancy   two witnesses with the same coordinate produce no discrepancy.

Reproduce: python3 census_redteam.py   (expect all green)
"""
import sys, os, json, copy
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nenrin_census as N

WALKED = "2026-09-01T00:00:00Z"
SCOPE = "*.horizonshield.dev"
RING = "2026-09"

def coord(tag="A"):
    return {"enumerator": "certificate-transparency", "source": "crt.sh",
            "snapshot_sha256": N.sha256hex("ct-snapshot-" + tag), "sth_ref": "fixture-" + tag}

def base_world():
    declared = ["https://mcp.horizonshield.dev/mcp", "https://hearing.horizonshield.dev/mcp"]
    ct = [
        {"host": "mcp.horizonshield.dev", "in_ct": True, "sct": True, "cert_sha256": "aa"},
        {"host": "hearing.horizonshield.dev", "in_ct": True, "sct": True, "cert_sha256": "bb"},
        {"host": "p003.horizonshield.dev", "in_ct": True, "sct": True, "cert_sha256": "cc"},   # undeclared, callable
    ]
    probes = {
        "mcp.horizonshield.dev": {"mcp_shaped": True, "evidence_sha256": "e1"},
        "hearing.horizonshield.dev": {"mcp_shaped": True, "evidence_sha256": "e2"},
        "p003.horizonshield.dev": {"mcp_shaped": True, "evidence_sha256": "e3"},
    }
    return declared, ct, probes

def run():
    fails = []
    passed = 0
    total = 0

    def ok(name, cond, why=""):
        nonlocal passed, total
        total += 1
        if cond:
            passed += 1
            print("  green  %-24s ok" % name)
        else:
            fails.append(name + ": " + why)
            print("  RED    %-24s << %s" % (name, why))

    print("=== NENRIN census red team (attack the census, fail-closed, offline) ===")

    # 1 hide_undeclared: operator census omits p003; a second witness from the same CT
    #   coordinate finds it; discrepancy must surface it.
    declared, ct, probes = base_world()
    ct_op = [x for x in ct if x["host"] != "p003.horizonshield.dev"]
    pr_op = {k: v for k, v in probes.items() if k != "p003.horizonshield.dev"}
    c_op = N.compute_census(SCOPE, RING, declared, ct_op, pr_op, coord("A"), WALKED,
                            witness={"name": "operator", "vantage": "operator omitted p003"})
    c_ind = N.compute_census(SCOPE, RING, declared, ct, probes, coord("A"), WALKED,
                             witness={"name": "independent", "vantage": "full CT snapshot"})
    disc = N.census_discrepancy(SCOPE, RING, c_ind, c_op)
    ok("hide_undeclared", disc["seen_only_by_a"] == ["p003.horizonshield.dev"],
       "second witness must surface the host the operator omitted; got " + str(disc["seen_only_by_a"]))

    # 2 decoy_cert_as_present: decoy has a cert but no MCP surface.
    declared, ct, probes = base_world()
    ct2 = ct + [{"host": "decoy.horizonshield.dev", "in_ct": True, "sct": True, "cert_sha256": "dd"}]
    pr2 = dict(probes); pr2["decoy.horizonshield.dev"] = {"mcp_shaped": False, "evidence_sha256": "e0"}
    c2 = N.compute_census(SCOPE, RING, declared, ct2, pr2, coord("A"), WALKED)
    ok("decoy_cert_as_present",
       "decoy.horizonshield.dev" not in c2["cells"]["undeclared_callable"]
       and "decoy.horizonshield.dev" not in c2["cells"]["declared_and_callable"],
       "a cert without an MCP probe was counted callable")

    # 3 declared_no_footprint: ghost declared, no CT, no probe.
    declared, ct, probes = base_world()
    d3 = declared + ["https://ghost.horizonshield.dev/mcp"]
    c3 = N.compute_census(SCOPE, RING, d3, ct, probes, coord("A"), WALKED)
    ok("declared_no_footprint",
       c3["cells"]["declared_no_footprint"] == ["ghost.horizonshield.dev"]
       and "ghost.horizonshield.dev" not in c3["cells"]["declared_and_callable"],
       "a declared host with no involuntary footprint was not flagged")

    # 4 tamper_record: flip a count after issue.
    declared, ct, probes = base_world()
    c4 = N.compute_census(SCOPE, RING, declared, ct, probes, coord("A"), WALKED)
    t = copy.deepcopy(c4); t["counts"]["undeclared_callable"] = 0
    ok("tamper_record", N.validate_census(t) and any("recompute" in e for e in N.validate_census(t)),
       "a tampered census still validated")

    # 5 residual_relabel: rename the residual to absent.
    declared, ct, probes = base_world()
    c5 = N.compute_census(SCOPE, RING, declared, ct, probes, coord("A"), WALKED)
    t5 = copy.deepcopy(c5); t5["residual"]["not"] = "unknown"; t5["residual"]["label"] = "absent"
    t5["record_sha256"] = N.sha256hex(N.canon({k: v for k, v in t5.items() if k != "record_sha256"}))
    ok("residual_relabel", any("unknown" in e for e in N.validate_census(t5)),
       "residual relabelled absent was accepted")

    # 6 no_coordinate: refuse at construction.
    declared, ct, probes = base_world()
    refused = False
    try:
        N.compute_census(SCOPE, RING, declared, ct, probes, {"enumerator": "", "snapshot_sha256": ""}, WALKED)
    except ValueError:
        refused = True
    ok("no_coordinate", refused, "a census with no involuntary coordinate was constructed")

    # 7 score_smuggled: inject a score field.
    declared, ct, probes = base_world()
    c7 = N.compute_census(SCOPE, RING, declared, ct, probes, coord("A"), WALKED)
    t7 = copy.deepcopy(c7); t7["score"] = 0.98
    t7["record_sha256"] = N.sha256hex(N.canon({k: v for k, v in t7.items() if k != "record_sha256"}))
    ok("score_smuggled", any("scoring field" in e for e in N.validate_census(t7)),
       "a smuggled score field was accepted")

    # 8 sct_ignoring_server: callable off the CT coordinate must surface as residual unknown.
    declared, ct, probes = base_world()
    # off-coordinate: a host that answers MCP but has NO SCT-logged cert in the snapshot.
    pr8 = dict(probes); pr8["darknet.horizonshield.dev"] = {"mcp_shaped": True, "evidence_sha256": "eX"}
    c8 = N.compute_census(SCOPE, RING, declared, ct, pr8, coord("A"), WALKED)
    ok("sct_ignoring_server",
       "darknet.horizonshield.dev" in c8["cells"]["callable_off_coordinate"]
       and c8["residual"]["label"] == "unknown" and c8["residual"]["in_scope_size"] == 1,
       "an off-coordinate callable server was dropped instead of named unknown")

    # c1 honest_complete: fully declared scope passes clean.
    declared = ["https://mcp.horizonshield.dev/mcp", "https://hearing.horizonshield.dev/mcp",
                "https://p003.horizonshield.dev/mcp"]
    ct = [{"host": h, "in_ct": True, "sct": True, "cert_sha256": "x"} for h in
          ["mcp.horizonshield.dev", "hearing.horizonshield.dev", "p003.horizonshield.dev"]]
    probes = {h: {"mcp_shaped": True, "evidence_sha256": "e"} for h in
              ["mcp.horizonshield.dev", "hearing.horizonshield.dev", "p003.horizonshield.dev"]}
    c_c1 = N.compute_census(SCOPE, RING, declared, ct, probes, coord("A"), WALKED)
    ok("c1_honest_complete",
       not N.validate_census(c_c1) and c_c1["counts"]["undeclared_callable"] == 0
       and c_c1["counts"]["declared_no_footprint"] == 0,
       "an honest complete census did not pass clean: " + str(N.validate_census(c_c1)))

    # c2 no_false_discrepancy: same coordinate, same view -> no discrepancy.
    c_a = N.compute_census(SCOPE, RING, declared, ct, probes, coord("A"), WALKED,
                           witness={"name": "a", "vantage": "one"})
    c_b = N.compute_census(SCOPE, RING, declared, ct, probes, coord("A"), WALKED,
                           witness={"name": "b", "vantage": "two"})
    d2 = N.census_discrepancy(SCOPE, RING, c_a, c_b)
    ok("c2_no_false_discrepancy", d2["seen_only_by_a"] == [] and d2["seen_only_by_b"] == [],
       "two identical views produced a false discrepancy")

    print("\n=== %d / %d ===" % (passed, total))
    if fails:
        print("census not clear (fail-closed):")
        for f in fails:
            print("  - " + f)
        return 1
    print("census refused every lie, surfaced every hidden host, passed the honest ones. clear.")
    return 0

if __name__ == "__main__":
    sys.exit(run())
