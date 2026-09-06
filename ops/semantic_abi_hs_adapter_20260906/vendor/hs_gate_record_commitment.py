#!/usr/bin/env python3
"""Standalone, runnable backend for trustless-ai/semantic-abi, adapters/horizon-shield.

Relation under test: content_addressed_decision_commitment, the HORIZON SHIELD analogue of the
repository's relation 1 (reject/evidence_against != reject/insufficient_evidence). HORIZON SHIELD's
verdicts are not signed. Each verdict is content-addressed (record_sha256 over the record bytes) and
later carried into a Bitcoin-anchored ledger entry. A hash commitment is not a signed commitment, so
this adapter does not report under the signed relation's name; whether the group folds the two is
their call, and the README asks. Nothing here is imported from any other owner's adapter.

PROVENANCE (read before trusting this file). Everything replayed below is copied from one public
file, workers/hs-verify-gate/src/worker.js in github.com/ogasurfproject-jpg/horizon-shield, at
commits you can fetch yourself:

  8a370fca  2026-08-19T12:13+09:00  patch51, the last commit BEFORE the fix
            sha256(worker.js) e624087fba99cc4e6e7c2c4c691c9a727beb35fa6474ba3389f482f4b3bc80c2
  3077a482  2026-08-19T12:51+09:00  patch52: "the gate could not measure itself and recorded that as
            the target being unreachable; the relay now covers self-probes, and an unmeasured self is
            recorded as unmeasured"
            sha256(worker.js) 78ed14adaa438b923a84a97e1f5b9b7db4e1089e75df2ca29a78f8f072cb54e1
  522d4208  2026-08-19T12:58+09:00  patch53: "a relay that throws still blamed the target"
            sha256(worker.js) c1fcdf477d518aa3261fa9c34c7a3b82352a383afbc3b24263922fac98b5b54f
  f8a3f719  2026-09-06 main at the time of writing (gate 0.3.1)
            sha256(worker.js) 32e7270fae028435eda8b9925d95f26c235d3127a71f749e82b3d58b6c62c2d5

  Reproduce any of them:  git show <commit>:workers/hs-verify-gate/src/worker.js | shasum -a 256

WHAT IS REPLAYED VERBATIM (same at 8a370fca and 3077a482; the fix did not touch these lines):
  the record derivation
      gateSide    = some check has gate_side === true
      unreachable = some check has transport === true
      reachable   = gateSide ? null : !unreachable
      status      = passed ? "verified" : ((unreachable || gateSide) ? "held" : "pending")
  the commitment
      canonical = JSON.stringify(record)            (key insertion order, no sorting, no spaces)
      record.record_sha256 = sha256hex(canonical)   (record_sha256 and recompute_note are outside it)
  the classifier of an HTTP answer
      gatewayish = 502..504 or 520..530  ->  { pass:false, transport:true, reason:"... (http N)" }
  the classifier of a thrown probe
      catch (e) -> { pass:false, gate_side:true, measured:false, reason:"not measured: " + e.message }

WHAT CHANGED IN patch52 (3077a482), the only difference between the two modes below:
  before: probeFetch(url) used the relay only when (isOwnZone(url) && relayConfigured()) held, and
          relayConfigured() also required the HTTP context. In the daily cron the gate probed ITSELF
          directly; a Worker cannot fetch its own zone, the edge answered 522, and 522 is gatewayish,
          so the instrument's own path limitation was classified transport:true. The record said
          reachable:false, status:held about the gate, every day at 03:00 JST, and published it.
  after:  useRelay(url) is true for the gate's own host in any context, and when no relay path exists
          for a self-probe, probeFetch THROWS "relay unavailable (self-probe has no relay path):
          gate-side failure, not a statement about the target". The catch classifies it
          gate_side:true, measured:false; the record says reachable:null, status:held, and carries a
          measurement_note saying the measurement did not happen.

THE PAIR: same endpoint, same checked_at, two different states of the world.
  A: the gate's origin genuinely answered 522 (a real outage of the target, seen through a working path)
  B: the gate's own probe path had no relay and could not reach itself (the instrument failed)
  A is evidence against reachability. B is insufficient evidence about anything. Their true relation is
  therefore VIOLATED (the claims differ) whichever code processes them. Before patch52 the two records
  are byte-identical and record_sha256 is identical: the collapse. After patch52 they differ.
  The clean control is A twice: oracle PRESERVED, and any backend that reports otherwise is broken.

THE SECOND PAIR (HORIZON SHIELD's own open finding, current code, not historical):
  C: determinism was not measured (the owner gave no consent to call a tool): pass:false, measured:false
  D: determinism was measured and failed: pass:false, measured:true
  At record scope the bytes differ and so do the hashes (PRESERVED distinction, PASS). At the scope of
  the status label both records read status:"pending", and the NENRIN ring's instants_by_status counts
  them under one key; the unmeasured count survives only as prose in the ring's limits sentence. That
  is a live collapse at label scope and is reported as such rather than hidden.

The record built here is REDUCED: it keeps the fields the derivation under test reads or writes, in
the gate's own key order, and holds the other conditions constant as a fixture. The fixture is ASCII
only, so Python's json.dumps(separators=(",",":"), ensure_ascii=False) over an insertion-ordered dict
produces the same bytes as JavaScript's JSON.stringify for these values; a non-ASCII or control
character would open the escaping seam described in the paper, and none is present here.

Usage: python3 hs_gate_record_commitment.py <pre_patch52|post_patch52|post_patch52_clean|determinism>
Prints one JSON object:
  {"sha_a","sha_b","status_a","status_b","reachable_a","reachable_b","distinct_record","distinct_status"}
"""
from __future__ import annotations

import hashlib
import json
import sys

GATE_NAME = "Yakumo Verification Gate"          # the string at 8a370fca and 3077a482
GATE_VERSION = "0.1.x-fixture"
GATE_COMMIT_PRE = "8a370fca"
GATE_COMMIT_POST = "3077a482"
ENDPOINT = "https://gate.horizonshield.dev/mcp"   # the gate measuring itself (Layer 4)
CHECKED_AT = "2026-08-19T18:00:00.000Z"          # the 03:00 JST daily cron

TIER_PASS, TIER_FAIL, TIER_HELD = "verified", "pending", "held"


def sha256hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def canonical(record: dict) -> str:
    # JSON.stringify(record): insertion order, no whitespace, non-ASCII raw. See docstring.
    return json.dumps(record, separators=(",", ":"), ensure_ascii=False)


# ---- classifiers, copied in shape from worker.js (see docstring for the exact lines) ----

def classify_http(status: int, what: str, url: str) -> dict:
    gatewayish = (502 <= status <= 504) or (520 <= status <= 530)
    if gatewayish:
        return {"pass": False, "transport": True, "reason": what + " not reachable (http %d)" % status, "detail": {"url": url}}
    return {"pass": False, "reason": what + " not published (http %d: the server answered; no card lives at this path)" % status, "detail": {"url": url}}


def classify_thrown(message: str) -> dict:
    return {"pass": False, "gate_side": True, "measured": False, "reason": "not measured: " + message}


# ---- the two observations for the agent-card probe ----

def observe_agent_card(world: str, code_version: str) -> dict:
    """world: 'target_522' (A) or 'self_no_relay' (B). code_version: 'pre' or 'post'."""
    url = "https://gate.horizonshield.dev/.well-known/agent-card.json"
    if world == "target_522":
        # A working path reached the edge; the edge answered 522 for the origin. Same in both versions.
        return classify_http(522, "agent-card", url)
    if world == "self_no_relay":
        if code_version == "pre":
            # 8a370fca: no relay in cron context; direct fetch of own zone; edge answers 522; gatewayish.
            return classify_http(522, "agent-card", url)
        # 3077a482: useRelay() is true for self, no relay path exists, probeFetch throws, catch classifies.
        return classify_thrown("relay unavailable (self-probe has no relay path): gate-side failure, not a statement about the target")
    raise ValueError(world)


def build_record(agent_card: dict, determinism: dict, code_version: str) -> dict:
    results = {
        "mcp_endpoint": {"pass": True, "reason": "fixture: initialize answered"},
        "agent_card": agent_card,
        "compensation_disclosure": (
            {"pass": False, "gate_side": True, "measured": False,
             "reason": "not measured: the agent card could not be fetched because the gate's relay path was unavailable, so whether compensation is disclosed is unknown"}
            if agent_card.get("gate_side") is True
            else {"pass": False, "reason": "fixture: no compensation block on the card"}
        ),
        "determinism": determinism,
    }
    passed = all(r.get("pass") for r in results.values())
    gate_side = any(r.get("gate_side") is True for r in results.values())
    unreachable = any(r.get("transport") is True for r in results.values())

    record = {
        "gate": GATE_NAME,
        "gate_version": GATE_VERSION,
        "gate_commit": GATE_COMMIT_PRE if code_version == "pre" else GATE_COMMIT_POST,
        "endpoint": ENDPOINT,
        "checked_at": CHECKED_AT,
        "reachable": None if gate_side else (not unreachable),
        "status": TIER_PASS if passed else (TIER_HELD if (unreachable or gate_side) else TIER_FAIL),
        "probed_via": "direct from the gate worker (cron context)" if code_version == "pre" else "relay (hs-verify-relay)",
    }
    if gate_side:
        record["measurement_note"] = (
            "This measurement did not happen. The gate's own relay path was unavailable, so nothing in "
            "this record says anything about the target. reachable is null rather than false for exactly "
            "that reason: an instrument failure is not a statement about the thing it failed to measure."
        )
    record["checks"] = results
    record["record_sha256"] = sha256hex(canonical(record))
    return record


DET_OK = {"pass": True, "measured": True, "reason": "fixture: two calls, identical bytes"}
DET_UNMEASURED = {"pass": False, "measured": False, "reason": "not measured: no owner consent to call a tool"}
DET_FAILED = {"pass": False, "measured": True, "reason": "fixture: two calls, different bytes"}


def pair(rec_a: dict, rec_b: dict) -> dict:
    return {
        "sha_a": rec_a["record_sha256"],
        "sha_b": rec_b["record_sha256"],
        "status_a": rec_a["status"],
        "status_b": rec_b["status"],
        "reachable_a": rec_a["reachable"],
        "reachable_b": rec_b["reachable"],
        "distinct_record": rec_a["record_sha256"] != rec_b["record_sha256"],
        "distinct_status": rec_a["status"] != rec_b["status"],
    }


def main() -> None:
    modes = ("pre_patch52", "post_patch52", "post_patch52_clean", "determinism")
    if len(sys.argv) != 2 or sys.argv[1] not in modes:
        print("usage: hs_gate_record_commitment.py <%s>" % "|".join(modes), file=sys.stderr)
        sys.exit(2)
    mode = sys.argv[1]
    if mode == "pre_patch52":
        a = build_record(observe_agent_card("target_522", "pre"), DET_OK, "pre")
        b = build_record(observe_agent_card("self_no_relay", "pre"), DET_OK, "pre")
    elif mode == "post_patch52":
        a = build_record(observe_agent_card("target_522", "post"), DET_OK, "post")
        b = build_record(observe_agent_card("self_no_relay", "post"), DET_OK, "post")
    elif mode == "post_patch52_clean":
        a = build_record(observe_agent_card("target_522", "post"), DET_OK, "post")
        b = build_record(observe_agent_card("target_522", "post"), DET_OK, "post")
    else:  # determinism: the card is fine in both; only the determinism check differs
        card_ok = {"pass": True, "reason": "fixture: card published"}
        a = build_record(card_ok, DET_UNMEASURED, "post")
        b = build_record(card_ok, DET_FAILED, "post")
    print(json.dumps(pair(a, b)))


if __name__ == "__main__":
    main()
