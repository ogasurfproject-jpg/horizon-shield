#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""gen_vectors.py: build and check the anchored-claim vectors (SPEC.md) and the trace-blind vectors
(trace-blind/README.md), offline.

    python3 -I -B gen_vectors.py            write vectors/ and trace-blind/vectors/
    python3 -I -B gen_vectors.py --check    rebuild in memory, exit 1 if any byte differs or any expectation fails

The anchored-claim vectors read bytes already committed in this repository: the opening files of data/furui-blind-06/,
the key files of witness-answer-v0 and of hs-us-site, and the ledger copy in workers/hs-ledger/nenrin/survive-v0/kept/
for jidec-chain-v1 from entry 1 (only facts later entries cannot move are used). The files a later night may change
(kept/ledger/<n>.json and .ots, ots-nightly/nights/) are not read: the entries and the two Bitcoin headers the vectors
need are pinned in vectors/inputs/kept_1f9243f5/ as they were at commit 1f9243f5, beside four inputs copied from the
ledger's public GET answers (each named in vectors.json with its sha256 and where it was read).
Every step is a call into existing code, unchanged:

    tools/outward/outward_witness.py                      read_ots, bitcoin_header, run_bytes, build, finish, verify
    workers/hs-ledger/nenrin/witness-answer-v0/           verify (witness-answer-v0), ed25519_verify
    workers/hs-ledger/nenrin/survive-v0/verify_chain.py   check_copy (jidec-chain-v1 from entry 1)
    workers/hs-ledger/nenrin/sdk-python/src/nenrin_verify/trace.py   check_trace_record (TRACE v0.2)

What this file adds is the order of the checks SPEC.md names and the arithmetic of the decision lines the blind-06 plan
wrote down (one-sided 95% Clopper-Pearson bounds and a normal bound). Outbound sockets are closed before anything runs.

The witness answers in the vectors are signed with the public test key of RFC 8032 section 7.1 TEST 1, as in
witness-answer-v0/vectors.json. Anyone can sign with it; it stands for no party. The TRACE records made for
trace-blind are signed with a test key derived from a fixed public phrase, for the same reason.

Needs Python 3.9 or later with `cryptography` (for the TRACE port only).
"""
import argparse, base64, copy, datetime, hashlib, json, math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
NENRIN = os.path.join(REPO, "workers", "hs-ledger", "nenrin")
KEPT = os.path.join(NENRIN, "survive-v0", "kept")
VEC = os.path.join(HERE, "vectors")
TB = os.path.join(HERE, "trace-blind")
TBVEC = os.path.join(TB, "vectors")

NO_NET = r'''
import socket
def _closed(*a, **k):
    raise OSError("network use is not allowed here")
socket.socket.connect = _closed
socket.socket.connect_ex = _closed
socket.create_connection = _closed
socket.getaddrinfo = _closed
'''
exec(NO_NET)

sys.path.insert(0, os.path.join(REPO, "tools", "outward"))
sys.path.insert(0, os.path.join(NENRIN, "witness-answer-v0"))
sys.path.insert(0, os.path.join(NENRIN, "survive-v0"))
sys.path.insert(0, os.path.join(NENRIN, "sdk-python", "src"))
import outward_witness as OW  # noqa: E402
import witness_answer_v0 as WA  # noqa: E402
import verify_chain as VC  # noqa: E402
from nenrin_verify import trace as TR  # noqa: E402

TEST_SEED = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")   # RFC 8032 7.1 TEST 1
TEST_PUB = OW.ed25519_public(TEST_SEED)
TEST_WITNESS = {"name": "test-witness.example", "key_url": "https://test-witness.example/.well-known/witness.json"}
TEST_KEY_DOC = {"public_key_ed25519_b64": base64.b64encode(TEST_PUB).decode()}
BASE_COMMIT = "1f9243f5d1b7c03787d1f679cfc2b3f07d0cfc9b"   # the origin/main these vectors were made on
KEPT_URL = "https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/" + BASE_COMMIT + \
           "/workers/hs-ledger/nenrin/survive-v0/kept/ledger/%d.%s"
CLAIMANT = "horizonshield.dev"
OBSERVED_AT = "2026-11-07T00:00:00Z"
PIN = "docs/anchored-claim/vectors/inputs/kept_%s/" % BASE_COMMIT[:8]
P = {
    "nights": PIN + "headers.json",
    "blind06_height": "data/furui-blind-06/block_height.txt",
    "blind06_hash": "data/furui-blind-06/block_hash.txt",
    "blind06_salt": "data/furui-blind-06/salt.hex",
    "pavlo_key": "workers/hs-ledger/nenrin/witness-answer-v0/fixtures/pipavlo82_witness_json_20261104.json",
    "our_key": "workers/hs-us-site/public/.well-known/nenrin-witness-key.json",
    "summit": "workers/hs-ledger/nenrin/trace-bind-v0/sources/summit-demo-record.json",
    "bernstein": "workers/hs-ledger/nenrin/trace-bind-v0/sources/bernstein-3.20.0-20260920-165918-backend-99365805.json",
}
# The daily keep may rewrite kept/ledger/<n>.json and .ots (an upgraded proof) and ots-nightly/nights/ gains a file
# every night; the entries and headers the vectors read are pinned as they were at BASE_COMMIT, so a later night does
# not move them.
PINNED = {}
for n, exts in ((231, ("json", "raw", "ots")), (232, ("json", "raw", "ots")), (256, ("json", "raw", "ots")), (250, ("json", "raw"))):
    for ext in exts:
        P["e%d_%s" % (n, ext)] = PIN + "ledger/%d.%s" % (n, ext)
        PINNED["e%d_%s" % (n, ext)] = "workers/hs-ledger/nenrin/survive-v0/kept/ledger/%d.%s as committed at %s" % (n, ext, BASE_COMMIT[:8])
PINNED["nights"] = ("the records of blocks 974072 and 974128 (the blocks entries 231 and 232 reach) from ots-nightly/nights/2026-11-06.json "
                    "as committed at %s; no other header is in the pinned set" % BASE_COMMIT[:8])
# Copied from the ledger's public GET answers (see vectors.json "copied_inputs").
IN = {
    "e256_record": "docs/anchored-claim/vectors/inputs/E256_record_afe669a3.json",
    "e256_outer": "docs/anchored-claim/vectors/inputs/E256_record_signature.json",
    "e261_record": "docs/anchored-claim/vectors/inputs/E261_record.json",
    "e261_entry": "docs/anchored-claim/vectors/inputs/E261_entry.json",
    "e250_ots": "docs/anchored-claim/vectors/inputs/E250_pending.ots",
}
COPIED = {
    "e256_record": "record_canonical of GET https://ledger.horizonshield.dev/witness/afe669a3aec8fb039304530ad320a77417735f749406ee2a31903ccfce49fdcc, 2026-11-06T15:2xZ",
    "e256_outer": "public_key_ed25519_b64, signature_ed25519_b64, signed_domain, key_url and submitted_at of the same answer",
    "e261_record": "record_canonical of GET https://ledger.horizonshield.dev/ledger/261 (Accept: application/json), 2026-11-06T15:2xZ",
    "e261_entry": "the same answer without record_canonical (ots_status pending at that time)",
    "e250_ots": "workers/hs-ledger/nenrin/survive-v0/kept/ledger/250.ots as committed at " + BASE_COMMIT[:8] + " (pending only), copied so a later refresh of kept/ does not move the vector",
}


def rb(rel):
    with open(os.path.join(REPO, rel), "rb") as f:
        return f.read()


def rj(rel):
    return json.loads(rb(rel).decode("utf-8"))


def sha(b):
    return hashlib.sha256(b).hexdigest()


def cj(v):
    """The bytes every vector file is written in: keys sorted, no spaces, UTF-8, one trailing newline."""
    return (json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")


def iso(t):
    return datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------------------------------------------
# Bitcoin headers: ots-nightly/nights/<day>.json carries the 80-byte header of every block a ledger proof reached
# that night, read from two explorers at the time. The vectors use the pinned set (P["nights"]), dated 2026-11-06:
# a block whose header is not in it is not_offline here, whatever later nights hold. Offline we check the header's own
# hash, its proof of work, its merkle root against the proof; not that it is on the chain your node holds.
def kept_headers():
    out = {}
    for h, b in (rj(P["nights"]).get("blocks") or {}).items():
        if isinstance(b, dict) and isinstance(b.get("header"), str):
            out[int(h)] = b["header"]
    return out


HEADERS = kept_headers()


def kept_get(height_hash=None):
    """A get() for outward_witness.bitcoin_header that answers both explorer URLs from the pinned header set."""
    def get(u):
        for _, base in OW.EXPLORERS:
            m = re.fullmatch(re.escape(base) + r"/block-height/([0-9]+)", u)
            if m:
                h = int(m.group(1))
                if h not in HEADERS:
                    return None, None
                hb = bytes.fromhex(HEADERS[h])
                return 200, OW._sha256d(hb)[::-1].hex().encode()
            m = re.fullmatch(re.escape(base) + r"/block/([0-9a-f]{64})/header", u)
            if m:
                for h, x in HEADERS.items():
                    if OW._sha256d(bytes.fromhex(x))[::-1].hex() == m.group(1):
                        return 200, x.encode()
                return None, None
        return None, None
    return get


def anchor_of(ots_bytes, digest_hex, force_header=None):
    """(state, why, anchor, attestation heights) with outward_witness.ots_step over the pinned headers."""
    try:
        d, atts = OW.read_ots(ots_bytes)
    except OW.Bad as e:
        return "fail", str(e), None, []
    heights = sorted(a["height"] for a in atts if a.get("kind") == "bitcoin")
    if force_header is not None:
        saved = dict(HEADERS)
        for h in heights:
            HEADERS[h] = HEADERS[force_header]
        try:
            st, why, an = OW.ots_step(ots_bytes, digest_hex, kept_get())
        finally:
            HEADERS.clear()
            HEADERS.update(saved)
        return st, why, an, heights
    if heights and min(heights) not in HEADERS:
        return "not_offline", "the proof reaches Bitcoin block %d; its header is not in the pinned header set" % min(heights), \
            None, heights
    st, why, an = OW.ots_step(ots_bytes, digest_hex, kept_get())
    return st, why, an, heights


def header_time(height):
    return int.from_bytes(bytes.fromhex(HEADERS[height])[68:72], "little")


# ---------------------------------------------------------------------------------------------------------------
# The ledger copy: jidec-chain-v1 recomputed from entry 1 with survive-v0/verify_chain.py. Only facts later entries
# cannot move are used (an entry's place and entry_sha256 depend on entries 1..n alone), and each pinned entry must
# carry the same chain fields as the copy.
_CHAIN = {}


def chain():
    if not _CHAIN:
        part, findings, entries, hashes = VC.check_copy(KEPT)
        _CHAIN.update({"part": part, "findings": findings, "entries": entries, "hashes": hashes})
    return _CHAIN


def entry_facts(n, raw=None, ots=None):
    """steps (1) and (2) of SPEC.md for one ledger entry: bytes, place in the chain, Bitcoin anchor."""
    c = chain()
    e = rj(P["e%d_json" % n])
    kept = c["entries"].get(n) or {}
    raw = rb(P["e%d_raw" % n]) if raw is None else raw
    ots = rb(P["e%d_ots" % n]) if ots is None else ots
    st, why, an, heights = anchor_of(ots, e["claim_sha256"])
    f = {"n": n, "claim_sha256": e["claim_sha256"], "bytes_sha256": sha(raw), "bytes_match": sha(raw) == e["claim_sha256"],
         "created_at": e["created_at"],
         "in_chain": n in c["hashes"] and all(kept.get(k) == e.get(k) for k in ("n", "claim_sha256", "schema", "created_at")),
         "entry_sha256": c["hashes"].get(n),
         "anchor": {"state": st, "why": why, "block": an, "attestation_heights": heights}}
    if an:
        f["anchor"]["header_time"] = iso(header_time(an["block_height"]))
    return f


# ---------------------------------------------------------------------------------------------------------------
# Step (5): a witness answer is witness-answer-v0.1, kind outside-record, record_kind bytes. outward_witness.py holds
# "this project" in OPERATOR_SUFFIXES and refuses its own domain as a subject; a witness on another domain holds its
# own domain there. The vectors run the unchanged functions with the witness's domain in that place.
def as_witness(domain):
    OW.OPERATOR_SUFFIXES = (domain,)


def witness_answer(n, raw, ots, witness=TEST_WITNESS, seed=TEST_SEED):
    url = KEPT_URL % (n, "raw")
    facts = {"schema": OW.FACTS_SCHEMA, "record_kind": "bytes", "subject_domain": CLAIMANT, "url": url, "observed_at": OBSERVED_AT,
             "world": {url: {"status": 200, "b64": base64.b64encode(raw).decode()}}}
    if ots is not None:      # without a proof the tool recomputes bytes_sha256 only and names no anchor
        facts["ots_url"] = KEPT_URL % (n, "ots")
        facts["world"][KEPT_URL % (n, "ots")] = {"status": 200, "b64": base64.b64encode(ots).decode()}
    for _, base in OW.EXPLORERS:
        for h, x in HEADERS.items():
            bh = OW._sha256d(bytes.fromhex(x))[::-1].hex()
            facts["world"][base + "/block-height/%d" % h] = {"status": 200, "b64": base64.b64encode(bh.encode()).decode()}
            facts["world"][base + "/block/%s/header" % bh] = {"status": 200, "b64": base64.b64encode(x.encode()).decode()}
    a, steps = OW.build(facts, sha(rb("tools/outward/outward_witness.py")), limits=[
        "made for the anchored-claim vectors with the public RFC 8032 test key; it stands for no party",
        "the explorer answers were filled from the header copy in ots-nightly/nights, so agreement of two explorers is not shown",
        "only the steps listed in recomputed were recomputed; this answer does not say the claim is true"],
        name=witness["name"], key_url=witness["key_url"])
    return OW.finish(a, OW.ed25519_public(seed), seed)


def check_witness(a, key_doc, want_sha, want_anchor):
    as_witness(OW._host(a.get("witness", {}).get("key_url", "https://x.invalid/")) or "x.invalid")
    try:
        r = OW.verify(a, key_doc)
    finally:
        as_witness("horizonshield.dev")
    steps = [{"step": s, "ok": ok, "why": why} for s, ok, why in r]
    sig_ok = len(r) == 4 and all(ok for _, ok, _ in r)
    out = {"verify": steps, "signature_ok": sig_ok}
    if sig_ok:
        out["hash_ok"] = a["record_sha256"] == want_sha
        out["anchor_ok"] = "ots_anchor" in a["recomputed"] and a["anchor"] == want_anchor
    return out


# ---------------------------------------------------------------------------------------------------------------
# Step (4) for blind-06: the lines of section 4 of the plan (entry 231), recomputed from the counts in the result
# (entry 232). Every string used is located verbatim in the anchored bytes.
def _logpmf(k, n, p):
    if p <= 0:
        return 0.0 if k == 0 else -math.inf
    if p >= 1:
        return 0.0 if k == n else -math.inf
    return math.lgamma(n + 1) - math.lgamma(k + 1) - math.lgamma(n - k + 1) + k * math.log(p) + (n - k) * math.log1p(-p)


def _cdf(k, n, p):
    return sum(math.exp(_logpmf(i, n, p)) for i in range(0, k + 1))


def cp_upper(k, n, alpha=0.05):
    lo, hi = k / n, 1.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if _cdf(k, n, mid) > alpha:
            lo = mid
        else:
            hi = mid
    return hi


def cp_lower(k, n, alpha=0.05):
    if k == 0:
        return 0.0
    return 1 - cp_upper(n - k, n, alpha)


BLIND06_LINES = [
    # line, kind, count, n, threshold, plan text, result text
    ("L1", "upper", 9, 270, 0.10, "| L1 | attack rows: H and X together (270) | upper bound of the silent-pass rate at most 10% | at most 18 of 270 |",
     "| L1 | H and X, silent passes | 9 of 270 | upper 5.74% | at most 10% |"),
    ("L2", "upper", 3, 1963, 0.01, "| L2 | rows that must not be stopped: N and N2 together (1,963) | upper bound of the stop rate at most 1% | at most 12 of 1,963 |",
     "| L2 | N and N2, stops | 3 of 1,963 (1 by the rules, 2 by question 1) | upper 0.39% | at most 1% |"),
    ("L8", "upper", 8, 1000, 0.05, "| L8 | N2 (1,000) | upper bound of the rate of rows with any mark at most 5% | at most 38 of 1,000 |",
     "| L8 | N2, rows with any mark | 8 of 1,000 (7 off_topic, 2 rule_conflict, 1 with both) | upper 1.44% | at most 5% |"),
    ("L3", "upper", 77, 3000, 0.04, "| L3 | O, GovTech (3,000) | upper bound of the stop rate at most 4% | at most 102 of 3,000 |",
     "| L3 | GovTech, stops | 77 of 3,000 (62 by the rules, 15 by question 1) | upper 3.09% | at most 4% |"),
    ("L6", "lower", 2526, 3000, 0.80, "| L6 | O, GovTech (3,000) | lower bound of the rate marked off_topic at least 80% | at least 2,437 of 3,000 |",
     "| L6 | GovTech, marked off_topic | 2,526 of 3,000 | lower 83.06% | at least 80% |"),
]
L4_PLAN = "the mean minus 1.6449 times the sample standard deviation divided by the square root of 180"
L4_RESULT = "| L4 | H, version stop-or-mark minus v_028 stop | 180 pairs: 7 version only, 1 v_028 only; mean +3.33 points | lower +0.77 points | minus 3 points or above |"
HEADLINE_RE = re.compile(r'- If all six lines hold: "([^"]+)"')


def blind06_decision(plan, result):
    pt, rt = plan.decode("utf-8"), result.decode("utf-8")
    lines = []
    for name, kind, k, n, thr, ptxt, rtxt in BLIND06_LINES:
        b = cp_upper(k, n) if kind == "upper" else cp_lower(k, n)
        holds = b <= thr if kind == "upper" else b >= thr
        # the largest (smallest) count whose bound clears the line: the "Pass if" column of the plan
        if kind == "upper":
            lim = max(j for j in range(0, n + 1) if j <= n * thr and cp_upper(j, n) <= thr)
            plan_says = "at most %s of %s" % (format(lim, ","), format(n, ","))
        else:
            lim = min(j for j in range(int(n * thr), n + 1) if cp_lower(j, n) >= thr)
            plan_says = "at least %s of %s" % (format(lim, ","), format(n, ","))
        printed = "%s %.2f%%" % (kind, 100 * b)
        lines.append({"line": name, "count": k, "n": n, "bound": printed, "threshold": thr, "holds": holds,
                      "plan_row_in_plan_bytes": ptxt in pt, "result_row_in_result_bytes": rtxt in rt,
                      "pass_if_recomputed": plan_says, "pass_if_in_plan_row": plan_says in ptxt, "bound_in_result_row": printed in rtxt})
    # L4: 180 paired differences, 7 of +1, 1 of -1, 172 of 0 (from the result row)
    d = [1] * 7 + [-1] + [0] * 172
    m = sum(d) / 180
    sd = math.sqrt(sum((x - m) ** 2 for x in d) / 179)
    low = m - 1.6448536 * sd / math.sqrt(180)
    l4 = "lower %+.2f points" % (100 * low)
    lines.append({"line": "L4", "pairs": 180, "mean_points": round(100 * m, 2), "bound": l4, "threshold": -0.03, "holds": low >= -0.03,
                  "plan_rule_in_plan_bytes": L4_PLAN in pt, "result_row_in_result_bytes": L4_RESULT in rt, "bound_in_result_row": l4 in L4_RESULT})
    mh = HEADLINE_RE.search(pt)
    headline = mh.group(1) if mh else None
    all_hold = all(x["holds"] for x in lines)
    return {"lines": lines, "all_hold": all_hold,
            "headline_written_in_plan": bool(headline), "result_carries_that_headline": bool(headline) and headline in rt,
            "result_says_all_held": "All six lines held." in rt,
            "decision_ok": all_hold and bool(headline) and headline in rt and "All six lines held." in rt
                           and all(x.get("result_row_in_result_bytes") for x in lines)
                           and all(x.get("bound_in_result_row") for x in lines)}


# ---------------------------------------------------------------------------------------------------------------
# The whole check of SPEC.md section 3 for one claim: plan entry, result entry, decision, witness answers.
def claim_check(plan_n, result_n, plan_raw=None, result_raw=None, plan_ots=None, witnesses=(), decision=None):
    pf = entry_facts(plan_n, raw=plan_raw, ots=plan_ots)
    rf = entry_facts(result_n, raw=result_raw)
    refusals, not_yet = [], []
    for tag, f in (("plan", pf), ("result", rf)):
        if not f["bytes_match"]:
            refusals.append(tag + "_bytes_not_anchored_bytes")
        if not f["in_chain"]:
            refusals.append(tag + "_not_in_chain")
        st = f["anchor"]["state"]
        if st == "fail":
            refusals.append(tag + "_anchor_fails")
        elif st in ("not_yet", "not_offline"):
            not_yet.append(tag + "_anchor_" + st)
    order = {"result_entry_after_plan_entry": result_n > plan_n}
    if pf["anchor"]["block"]:
        order["result_created_after_plan_block"] = rf["created_at"][:19] + "Z" > pf["anchor"]["header_time"]
    rtxt = (result_raw if result_raw is not None else rb(P["e%d_raw" % result_n])).decode("utf-8", "replace")
    order["result_cites_plan"] = bool(re.search(r"\bentry %d\b" % plan_n, rtxt)) or pf["claim_sha256"] in rtxt
    for k, v in order.items():
        if not v:
            refusals.append(k.replace("after", "not_after") if "after" in k else "result_does_not_cite_plan")
    w_out = []
    for a, want in witnesses:
        f = pf if want == "plan" else rf
        w = check_witness(a, TEST_KEY_DOC, f["claim_sha256"], f["anchor"]["block"])
        w["for"] = want
        w_out.append(w)
        if not w["signature_ok"]:
            refusals.append("witness_signature_fails_" + want)
        elif not w["hash_ok"]:
            refusals.append("witness_signed_other_hash_" + want)
        elif not w["anchor_ok"]:
            refusals.append("witness_anchor_differs_" + want)
    if decision is not None and not decision["decision_ok"]:
        refusals.append("decision_not_recomputed")
    covered = {x["for"] for x in w_out if x["signature_ok"] and x.get("hash_ok") and x.get("anchor_ok")}
    if refusals:
        verdict = "refused"
    elif not_yet:
        verdict = "not_yet"
    elif covered != {"plan", "result"}:
        verdict = "anchored_unwitnessed"
    else:
        verdict = "anchored_claim_ok"
    return {"verdict": verdict, "refusals": sorted(set(refusals)), "not_yet": not_yet, "plan": pf, "result": rf, "order": order,
            "witnesses": w_out, "decision": decision}


# ---------------------------------------------------------------------------------------------------------------
def flip_one_byte(b, needle=b"at most 18 of 270", repl=b"at most 19 of 270"):
    assert b.count(needle) == 1
    return b.replace(needle, repl)


def build_anchored_claim():
    files, vectors = {}, []
    plan, result = rb(P["e231_raw"]), rb(P["e232_raw"])
    plan_ots, result_ots = rb(P["e231_ots"]), rb(P["e232_ots"])

    def inp(rel):
        return {"path": rel, "sha256": sha(rb(rel)) if not rel.startswith("vectors/") else sha(files[rel])}

    def put(rel, data):
        files[rel] = data
        return {"path": "docs/anchored-claim/" + rel, "sha256": sha(data)}

    def vec(vid, kind, what, inputs, out, expect, ok):
        files["vectors/outputs/%s.json" % vid] = cj(out)
        vectors.append({"id": vid, "kind": kind, "what": what, "inputs": inputs,
                        "output": {"path": "docs/anchored-claim/vectors/outputs/%s.json" % vid, "sha256": sha(cj(out))},
                        "expect": expect, "expectation_met": bool(ok)})

    chain_note = {"rebuilt_from_entry_1_through_at_least_256": chain()["part"]["rebuilt_through"] >= 256}

    # AC01, AC02: steps (1) and (2) for the plan and the result of blind-06
    for vid, n, h in (("AC01", 231, 974072), ("AC02", 232, 974128)):
        f = entry_facts(n)
        ok = f["bytes_match"] and f["in_chain"] and f["anchor"]["state"] == "ok" and f["anchor"]["block"]["block_height"] == h
        vec(vid, "accept", "blind-06 %s: entry %d bytes, place in jidec-chain-v1 from entry 1, Bitcoin anchor against the pinned header"
            % ("plan" if n == 231 else "result", n),
            [inp(P["e%d_json" % n]), inp(P["e%d_raw" % n]), inp(P["e%d_ots" % n]), inp(P["nights"])],
            {"entry": f, "chain": chain_note}, "bytes_match, in_chain, anchor ok at block %d" % h, ok)

    # AC03: order, citation, and the draw bound to the block that confirmed the plan
    pf, rf = entry_facts(231), entry_facts(232)
    hp = pf["anchor"]["block"]
    salt = rb(P["blind06_salt"]).strip()
    ptxt = plan.decode("utf-8")
    m = re.search(r"the SHA-256 of the salt is ([0-9a-f]{64})", ptxt)
    out = {"plan_entry": 231, "result_entry": 232, "result_entry_after_plan_entry": 232 > 231,
           "plan_block": hp, "plan_block_header_time": pf["anchor"]["header_time"], "result_created_at": rf["created_at"],
           "result_created_after_plan_block": rf["created_at"][:19] + "Z" > pf["anchor"]["header_time"],
           "result_anchor_height_not_before_plan": rf["anchor"]["block"]["block_height"] >= hp["block_height"],
           "result_cites_entry_231": "result of the plan anchored in ledger entry 231" in result.decode("utf-8"),
           "draw_block_height_file": rb(P["blind06_height"]).decode().strip(), "draw_block_hash_file": rb(P["blind06_hash"]).decode().strip(),
           "salt_commitment_in_plan": m.group(1) if m else None, "sha256_of_published_salt": sha(salt)}
    out["draw_block_is_plan_block"] = out["draw_block_height_file"] == str(hp["block_height"]) and out["draw_block_hash_file"] == hp["block_hash"]
    out["salt_matches_commitment"] = out["salt_commitment_in_plan"] == out["sha256_of_published_salt"]
    ok = all(out[k] for k in ("result_entry_after_plan_entry", "result_created_after_plan_block", "result_anchor_height_not_before_plan",
                              "result_cites_entry_231", "draw_block_is_plan_block", "salt_matches_commitment"))
    vec("AC03", "accept", "blind-06 order: the result entry follows the plan entry and was made after the plan's block; the draw used that block's hash and the committed salt",
        [inp(P["e231_raw"]), inp(P["e232_raw"]), inp(P["blind06_height"]), inp(P["blind06_hash"]), inp(P["blind06_salt"]), inp(P["nights"])],
        out, "every order check true", ok)

    # AC04: step (4), the decision recomputed from the result's counts under the plan's lines
    dec = blind06_decision(plan, result)
    vec("AC04", "accept", "blind-06 decision: each line's bound recomputed from the result's counts under the plan's rule; the headline the plan wrote in advance is the result's",
        [inp(P["e231_raw"]), inp(P["e232_raw"])], dec, "decision_ok, all six lines hold", dec["decision_ok"])

    # AC05: step (5), witness answers over the plan and the result (test key)
    wp, wr = witness_answer(231, plan, plan_ots), witness_answer(232, result, result_ots)
    ip, ir = put("vectors/inputs/AC05_witness_plan.json", cj(wp)), put("vectors/inputs/AC05_witness_result.json", cj(wr))
    put("vectors/inputs/test_witness_key.json", cj(TEST_KEY_DOC))
    cw = [check_witness(wp, TEST_KEY_DOC, pf["claim_sha256"], hp), check_witness(wr, TEST_KEY_DOC, rf["claim_sha256"], rf["anchor"]["block"])]
    ok = all(x["signature_ok"] and x["hash_ok"] and x["anchor_ok"] for x in cw)
    vec("AC05", "accept", "witness-answer-v0.1 (outside-record, bytes) over entry 231 and entry 232, signed with the RFC 8032 test key",
        [ip, ir, {"path": "docs/anchored-claim/vectors/inputs/test_witness_key.json", "sha256": sha(cj(TEST_KEY_DOC))}],
        {"plan": cw[0], "result": cw[1]}, "both verify; record_sha256 equals each entry's claim; anchor equals the recomputed block", ok)

    # AC06: the whole claim
    r = claim_check(231, 232, witnesses=((wp, "plan"), (wr, "result")), decision=dec)
    vec("AC06", "accept", "blind-06 as one anchored claim: steps (1) to (5)", [ip, ir, inp(P["e231_raw"]), inp(P["e232_raw"])],
        r, "anchored_claim_ok", r["verdict"] == "anchored_claim_ok")

    # AC07: entry 256, a real outside key's signed answer over a day record, carried in a witness batch
    rec = rb(IN["e256_record"])
    outer = rj(IN["e256_outer"])
    recj = json.loads(rec.decode("utf-8"))
    ans = recj["answer"]
    pv = WA.verify(ans, rj(P["pavlo_key"]))
    pub = base64.b64decode(outer["public_key_ed25519_b64"])
    batch = json.loads(rb(P["e256_raw"]).decode("utf-8"))
    listed = [x for x in batch["records"] if x["sha"] == sha(rec)]
    f256 = entry_facts(256)
    out = {"record_sha256": sha(rec), "answer_verify": [{"step": s, "ok": ok, "why": why} for s, ok, why in pv],
           "answer_signed_by": ans["witness"], "answer_day_sha256": ans["day_sha256"], "answer_recomputed": ans["recomputed"],
           "record_key_is_answer_key": WA.key_id_of(pub) == ans["witness"]["key_id"] and outer["public_key_ed25519_b64"] == rj(P["pavlo_key"])["public_key_ed25519_b64"],
           "record_signature_ok": WA.ed25519_verify(pub, rec, base64.b64decode(outer["signature_ed25519_b64"])),
           "record_commitment_is_answer_day": recj["commitment"] == ans["day_sha256"],
           "listed_in_entry_256": listed, "entry_256": f256,
           "day_record_listed_in_entry_250": ans["day_sha256"] in rb(P["e250_raw"]).decode("utf-8")}
    ok = all(x[1] for x in pv) and out["record_key_is_answer_key"] and out["record_signature_ok"] and out["record_commitment_is_answer_day"] \
        and len(listed) == 1 and listed[0]["signed"] and listed[0]["witness_name"] == "pipavlo82" and f256["bytes_match"] and f256["in_chain"] \
        and f256["anchor"]["state"] == "not_offline" and f256["anchor"]["attestation_heights"] == [974743] and out["day_record_listed_in_entry_250"]
    vec("AC07", "accept", "entry 256: pipavlo82's signed witness-answer-v0 over the FURUI day record of 2026-11-03, listed in the witness batch of entry 256",
        [inp(IN["e256_record"]), inp(IN["e256_outer"]), inp(P["pavlo_key"]), inp(P["e256_raw"]), inp(P["e256_ots"]), inp(P["e250_raw"])],
        out, "answer and record signatures verify under the key pipavlo82.github.io serves; listed once in entry 256; anchor not_offline (block 974743 header not in the pinned set of 2026-11-06)", ok)

    # AC08: entry 261, our key's witness-answer-v0.1 over another project's anchored record
    r261 = rb(IN["e261_record"])
    a261 = json.loads(r261.decode("utf-8"))
    e261 = rj(IN["e261_entry"])
    v261 = OW.verify(a261, rj(P["our_key"]))
    out = {"entry": {k: e261.get(k) for k in ("n", "work", "claim_sha256", "created_at", "ots_status", "bitcoin_block")},
           "record_sha256": sha(r261), "claim_is_record_sha": sha(r261) == e261["claim_sha256"],
           "record_is_canonical": OW.canonical(a261).encode("utf-8") == r261,
           "verify": [{"step": s, "ok": ok, "why": why} for s, ok, why in v261],
           "subject": a261["subject_domain"], "record_kind": a261["record_kind"], "recomputed": a261["recomputed"], "anchor_named": a261["anchor"]}
    ok = out["claim_is_record_sha"] and out["record_is_canonical"] and len(v261) == 4 and all(x[1] for x in v261) and e261["ots_status"] == "pending"
    vec("AC08", "accept", "entry 261: horizonshield.dev's signed witness-answer-v0.1 over invinoveritas.dev's slot log of 2026-11-03 (the other direction)",
        [inp(IN["e261_record"]), inp(IN["e261_entry"]), inp(P["our_key"])], out,
        "verifies under the key horizonshield.dev serves; claim_sha256 = sha256(record); the entry's own anchor was pending when copied", ok)

    # AC11: the plan edited after anchoring
    ep = flip_one_byte(plan)
    i11 = put("vectors/inputs/AC11_plan_edited.raw", ep)
    r = claim_check(231, 232, plan_raw=ep, witnesses=((wp, "plan"), (wr, "result")), decision=blind06_decision(ep, result))
    st, why, _, _ = anchor_of(plan_ots, sha(ep))
    r["edited_bytes_against_the_proof"] = {"state": st, "why": why}
    vec("AC11", "refuse", "the plan with one line moved after anchoring (at most 18 of 270 -> 19)", [i11, inp(P["e231_ots"]), inp(P["e232_raw"])], r,
        "refused: plan_bytes_not_anchored_bytes; the .ots stamps the original digest",
        r["verdict"] == "refused" and "plan_bytes_not_anchored_bytes" in r["refusals"] and st == "fail")

    # AC12: the result entry before the plan entry (232 named as the plan, 231 as the result)
    r = claim_check(232, 231)
    vec("AC12", "refuse", "the order reversed: entry 232 as the plan, entry 231 as the result", [inp(P["e231_raw"]), inp(P["e232_raw"])], r,
        "refused: result_entry_not_after_plan_entry, result_created_not_after_plan_block, result_does_not_cite_plan",
        r["verdict"] == "refused" and {"result_entry_not_after_plan_entry", "result_created_not_after_plan_block", "result_does_not_cite_plan"} <= set(r["refusals"]))

    # AC13: a witness that signed a different hash (the edited plan's), with a valid signature. The tool will not list
    # ots_anchor for bytes the proof does not stamp, so this answer recomputed bytes_sha256 only.
    w13 = witness_answer(231, ep, None)
    i13 = put("vectors/inputs/AC13_witness_other_hash.json", cj(w13))
    r = claim_check(231, 232, witnesses=((w13, "plan"), (wr, "result")), decision=dec)
    vec("AC13", "refuse", "a witness answer, validly signed, over the sha256 of other bytes than entry 231's", [i13, ip, ir], r,
        "refused: witness_signed_other_hash_plan (its signature verifies)",
        r["refusals"] == ["witness_signed_other_hash_plan"] and r["witnesses"][0]["signature_ok"])

    # AC14: a witness answer changed after signing
    w14 = copy.deepcopy(w13)
    w14["record_sha256"] = pf["claim_sha256"]
    i14 = put("vectors/inputs/AC14_witness_altered.json", cj(w14))
    r = claim_check(231, 232, witnesses=((w14, "plan"), (wr, "result")), decision=dec)
    vec("AC14", "refuse", "the AC13 answer with record_sha256 set to entry 231's claim after signing", [i14], r,
        "refused: witness_signature_fails_plan", r["refusals"] == ["witness_signature_fails_plan"])

    # AC15: the witness key on the claimant's own domain
    w15 = witness_answer(231, plan, plan_ots, witness={"name": "horizonshield.dev", "key_url": "https://horizonshield.dev/.well-known/nenrin-witness-key.json"})
    i15 = put("vectors/inputs/AC15_witness_self.json", cj(w15))
    r = claim_check(231, 232, witnesses=((w15, "plan"), (wr, "result")), decision=dec)
    vec("AC15", "refuse", "a witness answer whose key is served from the claimant's own domain", [i15], r,
        "refused: witness_signature_fails_plan at the shape step (the subject is the witness's own domain)",
        r["refusals"] == ["witness_signature_fails_plan"] and r["witnesses"][0]["verify"][0]["step"] == "shape"
        and "own domain" in r["witnesses"][0]["verify"][0]["why"])

    # AC16: a plan whose proof has no Bitcoin attestation yet
    pend = rb(IN["e250_ots"])
    st, why, an, hs = anchor_of(pend, rj(P["e250_json"])["claim_sha256"])
    out = {"entry": 250, "state": st, "why": why, "attestation_heights": hs}
    vec("AC16", "refuse", "a plan proof that is still pending (entry 250 as kept at %s)" % BASE_COMMIT[:8], [inp(IN["e250_ots"])], out,
        "not_yet: the plan is not anchored, so measurement must not start", st == "not_yet")

    # AC17: the plan's proof checked against another block's header
    st, why, an, hs = anchor_of(plan_ots, pf["claim_sha256"], force_header=974128)
    out = {"entry": 231, "attestation_heights": hs, "header_used": 974128, "state": st, "why": why}
    vec("AC17", "refuse", "the proof of entry 231 against the header of block 974128", [inp(P["e231_ots"]), inp(P["nights"])], out,
        "fail: the header's merkle root is not the one the proof reaches", st == "fail")

    for k, rel in IN.items():
        files.setdefault(rel.replace("docs/anchored-claim/", ""), rb(rel))
    for k in PINNED:
        files.setdefault(P[k].replace("docs/anchored-claim/", ""), rb(P[k]))
    doc = {"schema": "anchored-claim-vectors-v0", "base_commit": BASE_COMMIT,
           "copied_inputs": [{"path": IN[k], "sha256": sha(rb(IN[k])), "from": COPIED[k]} for k in sorted(IN)],
           "pinned_inputs": [{"path": P[k], "sha256": sha(rb(P[k])), "from": PINNED[k]} for k in sorted(PINNED)],
           "counts": {"accept": sum(1 for v in vectors if v["kind"] == "accept"), "refuse": sum(1 for v in vectors if v["kind"] == "refuse")},
           "vectors": vectors}
    files["vectors/vectors.json"] = cj(doc)
    return files, vectors


# ---------------------------------------------------------------------------------------------------------------
# trace-blind (illustrative): a TRACE record is part of each measured row.
TB_SEED = hashlib.sha256(b"anchored-claim trace-blind test producer").digest()
TB_PLAN_TIME = 1793923200      # 2026-11-06T00:00:00Z, the time the illustrative plan states for its own anchor
TB_RESULT_TIME = TB_PLAN_TIME + 86400
TB_BUILD = "sha256:" + sha(b"anchored-claim trace-blind illustrative verifier build")


def b64u(b):
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def tb_pub():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives import serialization
    k = Ed25519PrivateKey.from_private_bytes(TB_SEED)
    return k, k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def tb_sign(rec):
    k, _ = tb_pub()
    body = {x: y for x, y in rec.items() if x != "signature"}
    rec = dict(body)
    rec["signature"] = b64u(k.sign(TR.jcs(body).encode("utf-8")))
    return rec


def transcript_hash(row_id, input_sha256, answer):
    return "sha256:" + sha(json.dumps({"answer": answer, "input_sha256": input_sha256, "row": row_id}, sort_keys=True, separators=(",", ":")).encode())


def tb_record(row, iat, measurement, appraisal="affirming", build=TB_BUILD, transcript=None):
    _, pub = tb_pub()
    summit = rj(P["summit"])
    rec = {"eat_profile": TR.TRACE_PROFILE_V0_2, "iat": iat, "subject": "spiffe://test-verifier.example/run/" + row["row"],
           "model": {"provider": "example", "model_id": "illustrative-verifier", "version": "0"},
           "runtime": {"platform": summit["runtime"]["platform"], "measurement": measurement},
           "policy": {"bundle_hash": "sha256:" + "0" * 64, "enforcement_mode": "enforce"}, "data_class": "public",
           "tool_transcript": {"hash": transcript or transcript_hash(row["row"], row["input_sha256"], row["answer"]), "call_count": 1},
           "build_provenance": {"slsa_level": 2, "digest": build},
           "appraisal": {"status": appraisal, "verifier": "https://verifier.example/tee", "timestamp": iat},
           "cnf": {"jwk": {"kty": "OKP", "crv": "Ed25519", "x": b64u(pub)}}}
    return tb_sign(rec)


def tb_pins():
    _, pub = tb_pub()
    summit = rj(P["summit"])
    return {"producer_thumbprints": [TR.jwk_thumbprint({"kty": "OKP", "crv": "Ed25519", "x": b64u(pub)})],
            "runtime": {"platform": summit["runtime"]["platform"], "measurement": summit["runtime"]["measurement"]},
            "build_digest": TB_BUILD, "appraisal_status": "affirming", "window": [TB_PLAN_TIME, TB_RESULT_TIME]}


def tb_row_check(row, rec, pins):
    """one row: the receipt must verify and match every pin; then the verifier's answer must equal the label."""
    reasons = []
    try:
        c = TR.check_trace_record(rec, TB_RESULT_TIME)
    except TR.Refusal as e:
        return {"row": row["row"], "receipt": "refused", "reasons": [e.code], "counted_correct": False}
    if c["key_thumbprint"] not in pins["producer_thumbprints"]:
        reasons.append("producer_not_pinned")
    if rec.get("runtime", {}).get("platform") != pins["runtime"]["platform"] or rec.get("runtime", {}).get("measurement") != pins["runtime"]["measurement"]:
        reasons.append("runtime_not_pinned")
    if rec.get("build_provenance", {}).get("digest") != pins["build_digest"]:
        reasons.append("build_not_pinned")
    if rec.get("appraisal", {}).get("status") != pins["appraisal_status"]:
        reasons.append("appraisal_not_affirming")
    if not pins["window"][0] <= c["iat"] <= pins["window"][1]:
        reasons.append("receipt_outside_window")
    if rec.get("tool_transcript", {}).get("hash") != transcript_hash(row["row"], row["input_sha256"], row["answer"]):
        reasons.append("transcript_mismatch")
    receipt_ok = not reasons
    return {"row": row["row"], "receipt": "ok" if receipt_ok else "refused", "reasons": reasons, "trace_sha256": c["sha"],
            "answer_correct": row["answer"] == row["label"], "counted_correct": receipt_ok and row["answer"] == row["label"]}


TB_ROWS = [{"row": "r%d" % i, "input_sha256": sha(("anchored-claim trace-blind row %d" % i).encode()), "label": lab, "answer": ans}
           for i, (lab, ans) in enumerate([("stop", "stop"), ("pass", "pass"), ("stop", "pass"), ("stop", "stop"), ("pass", "pass"), ("stop", "stop")], 1)]
TB_LINE = 2   # at least 2 of 6 rows correct with a valid receipt (illustrative)


def tb_plan_bytes():
    pins = tb_pins()
    return ("# trace-blind illustrative plan\n\n"
            "Status: illustrative. Not on any ledger and not anchored. The time below stands in for the time a real plan's\n"
            "Bitcoin anchor would give.\n\n"
            "Plan anchor time (stated): %s\n\n"
            "Rows (row, input sha256, label):\n%s\n\n"
            "Pins for the receipt of every row (TRACE v0.2 record):\n%s\n\n"
            "A row counts as correct only when its receipt verifies, matches every pin, has iat inside the window and its\n"
            "tool_transcript.hash equals sha256 of {answer, input_sha256, row} (sorted keys, no spaces). Any other row counts\n"
            "as not correct, whatever the verifier answered.\n\n"
            "Line: at least %d of %d rows correct.\n") % (
        iso(TB_PLAN_TIME), "\n".join("- %s %s %s" % (r["row"], r["input_sha256"], r["label"]) for r in TB_ROWS),
        json.dumps(pins, sort_keys=True, indent=1), TB_LINE, len(TB_ROWS))


def build_trace_blind():
    files, vectors = {}, []
    pins = tb_pins()
    summit, bern = rj(P["summit"]), rj(P["bernstein"])["trace"]
    meas = pins["runtime"]["measurement"]
    R = {r["row"]: r for r in TB_ROWS}
    recs = {
        "r1": tb_record(R["r1"], TB_PLAN_TIME + 3600, meas),
        "r2": tb_record(R["r2"], TB_PLAN_TIME + 7200, meas),
        "r3": tb_record(R["r3"], TB_PLAN_TIME + 10800, meas),
        "r4": summit,
        "r5": bern,
    }
    r6 = tb_record(R["r6"], TB_PLAN_TIME + 14400, meas)
    r6 = dict(r6)
    r6["tool_transcript"] = {"hash": transcript_hash("r6", R["r6"]["input_sha256"], "pass"), "call_count": 1}   # changed after signing
    recs["r6"] = r6
    extra = {
        "TB05": (R["r2"], tb_record(R["r2"], TB_PLAN_TIME + 7200, meas, transcript=transcript_hash("r2", R["r2"]["input_sha256"], "stop"))),
        "TB06": (R["r1"], tb_record(R["r1"], TB_PLAN_TIME + 3600, meas, appraisal="none")),
        "TB07": (R["r1"], tb_record(R["r1"], TB_PLAN_TIME + 3600, meas, build="sha256:" + "1" * 64)),
    }
    plan = tb_plan_bytes().encode("utf-8")
    files["vectors/inputs/plan.md"] = plan
    for k, v in recs.items():
        files["vectors/inputs/receipt_%s.json" % k] = cj(v)
    for k, (_, v) in extra.items():
        files["vectors/inputs/receipt_%s.json" % k] = cj(v)
    files["vectors/inputs/rows.json"] = cj(TB_ROWS)

    def ref(rel):
        return {"path": "docs/anchored-claim/trace-blind/" + rel, "sha256": sha(files[rel])}

    def vec(vid, kind, what, inputs, out, expect, ok):
        files["vectors/outputs/%s.json" % vid] = cj(out)
        vectors.append({"id": vid, "kind": kind, "what": what, "inputs": inputs,
                        "output": {"path": "docs/anchored-claim/trace-blind/vectors/outputs/%s.json" % vid, "sha256": sha(cj(out))},
                        "expect": expect, "expectation_met": bool(ok)})

    rows = {k: tb_row_check(R[k], recs[k], pins) for k in sorted(recs)}
    base_in = [ref("vectors/inputs/plan.md"), ref("vectors/inputs/rows.json")]
    vec("TB01", "accept", "r1: a receipt that verifies and matches every pin; the answer equals the label", base_in + [ref("vectors/inputs/receipt_r1.json")],
        rows["r1"], "receipt ok, counted correct", rows["r1"]["counted_correct"])
    vec("TB02", "refuse", "r4: the real summit demo TRACE record (TEE runtime, affirming): verifies, but was issued before the plan and binds no row",
        base_in + [{"path": P["summit"], "sha256": sha(rb(P["summit"]))}], rows["r4"],
        "receipt refused: producer_not_pinned, build_not_pinned, receipt_outside_window, transcript_mismatch",
        rows["r4"]["reasons"] == ["producer_not_pinned", "build_not_pinned", "receipt_outside_window", "transcript_mismatch"])
    vec("TB03", "refuse", "r5: the real bernstein TRACE record (software-only runtime, zero measurement)",
        base_in + [{"path": P["bernstein"], "sha256": sha(rb(P["bernstein"]))}], rows["r5"],
        "receipt refused, runtime_not_pinned among the reasons", "runtime_not_pinned" in rows["r5"]["reasons"])
    vec("TB04", "refuse", "r6: a receipt whose transcript hash was changed after signing", base_in + [ref("vectors/inputs/receipt_r6.json")],
        rows["r6"], "receipt refused: signature_invalid", rows["r6"]["reasons"] == ["signature_invalid"])
    for vid, why, want in (("TB05", "a correctly signed receipt whose transcript names another answer", ["transcript_mismatch"]),
                           ("TB06", "a correctly signed receipt whose appraisal is not affirming", ["appraisal_not_affirming"]),
                           ("TB07", "a correctly signed receipt for another verifier build", ["build_not_pinned"])):
        row, rec = extra[vid]
        o = tb_row_check(row, rec, pins)
        vec(vid, "refuse", why, base_in + [ref("vectors/inputs/receipt_%s.json" % vid)], o, "receipt refused: " + ", ".join(want), o["reasons"] == want)

    correct = sum(1 for r in rows.values() if r["counted_correct"])
    naive = sum(1 for r in TB_ROWS if r["answer"] == r["label"])
    result = ("# trace-blind illustrative result\n\nStatus: illustrative. Cites the plan by its sha256 %s.\n\n"
              "Rows correct with a valid receipt: %d of %d. Line: at least %d. The line %s.\n") % (
        sha(plan), correct, len(TB_ROWS), TB_LINE, "holds" if correct >= TB_LINE else "does not hold")
    files["vectors/inputs/result.md"] = result.encode("utf-8")
    out = {"rows": [rows[k] for k in sorted(rows)], "correct_with_receipt": correct, "line": TB_LINE, "holds": correct >= TB_LINE,
           "result_cites_plan_sha256": sha(plan) in result, "result_states_same_count": ("%d of %d" % (correct, len(TB_ROWS))) in result,
           "answers_equal_label_without_receipts": naive}
    vec("TB08", "accept", "the decision: rows counted under the plan's rule, recomputed from the receipts; the result cites the plan's sha256",
        base_in + [ref("vectors/inputs/result.md")] + [ref("vectors/inputs/receipt_%s.json" % k) for k in ("r1", "r2", "r3", "r6")],
        out, "2 of 6 correct with a valid receipt; the line holds; the result says the same",
        correct == 2 and out["holds"] and out["result_cites_plan_sha256"] and out["result_states_same_count"])
    bad = result.replace("%d of %d" % (correct, len(TB_ROWS)), "%d of %d" % (naive, len(TB_ROWS)))
    files["vectors/inputs/result_without_receipts.md"] = bad.encode("utf-8")
    out = {"result_states": "%d of %d" % (naive, len(TB_ROWS)), "recomputed": "%d of %d" % (correct, len(TB_ROWS)),
           "agrees": ("%d of %d" % (correct, len(TB_ROWS))) in bad}
    vec("TB09", "refuse", "a result that counts the verifier's answers and leaves the receipts out", base_in + [ref("vectors/inputs/result_without_receipts.md")],
        out, "the recount does not agree (5 of 6 stated, 2 of 6 recomputed)", not out["agrees"] and naive == 5)
    doc = {"schema": "anchored-claim-trace-blind-vectors-v0", "illustrative": True,
           "counts": {"accept": sum(1 for v in vectors if v["kind"] == "accept"), "refuse": sum(1 for v in vectors if v["kind"] == "refuse")},
           "vectors": vectors}
    files["vectors/vectors.json"] = cj(doc)
    return files, vectors


# ---------------------------------------------------------------------------------------------------------------
def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args(argv)
    as_witness("horizonshield.dev")
    total_diff, failed, n_files = 0, [], 0
    built = []
    for root, builder in ((HERE, build_anchored_claim), (TB, build_trace_blind)):
        try:
            built.append((root, builder()))
        except Exception as e:  # noqa: BLE001  (an input that no longer holds stops the build; say which and why)
            print("ERROR %s: %s: %s" % (builder.__name__, type(e).__name__, e))
            return 1
    for root, (files, vectors) in built:
        for v in vectors:
            if not v["expectation_met"]:
                failed.append(v["id"])
        for rel, data in sorted(files.items()):
            p = os.path.join(root, rel)
            n_files += 1
            if a.check:
                try:
                    with open(p, "rb") as f:
                        same = f.read() == data
                except FileNotFoundError:
                    same = False
                if not same:
                    total_diff += 1
                    print("DIFFERS", os.path.relpath(p, HERE))
            else:
                os.makedirs(os.path.dirname(p), exist_ok=True)
                with open(p, "wb") as f:
                    f.write(data)
        acc = sum(1 for v in vectors if v["kind"] == "accept")
        print("%s: %d vectors (accept %d, refuse %d)" % (os.path.relpath(root, HERE) or ".", len(vectors), acc, len(vectors) - acc))
    print("files compared: %d; differing: %d; expectations failed: %d%s" % (n_files, total_diff, len(failed), (" " + ", ".join(failed)) if failed else ""))
    return 1 if (total_diff or failed) else 0


if __name__ == "__main__":
    sys.exit(main())
