#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""gen_vectors.py: build and check the trace-chain vectors, offline.

One path, step by step, over records that already exist in this repository:

  1  a TRACE v0.2 Trust Record (the trace-registry summit demo record)          sdk/trace_verify.mjs, trace-pin-v0, intake
  2  trace-bind: the record joined to a MUSUBI execution record                 sdk/trace_verify.mjs, bind and span
  3  SEKI: the door's signed admission for that execution                        musubi-v0/admission_verify_v0.py
  4  MUSUBI: the execution settled against the admission, anchors recomposed     seki-heartbeat/heartbeat.py, settle v1.15
  5  NENRIN: the ledger entries that list the records, and the chain over them   survive-v0/survive.py, verify_chain.py
  6  nenrin-verify: steps 1 to 4 again with the package's own code               sdk-python/src/nenrin_verify

    python3 -I -B gen_vectors.py            write vectors/
    python3 -I -B gen_vectors.py --check    rebuild in memory, exit 1 if any byte of vectors/ differs or any expectation fails

Every verdict comes from the existing code named above, unchanged. This file only feeds it inputs, writes what it
answers, and holds each answer to an expectation written here by hand. Outbound sockets are closed before anything
runs, in this process and in each child it starts.

Needs Python 3.9 or later with `cryptography`, and Node 18 or later.
"""
import argparse, calendar, copy, hashlib, json, os, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
NENRIN = os.path.join(REPO, "workers", "hs-ledger", "nenrin")
MUSUBI = os.path.join(NENRIN, "musubi-v0")
HEART = os.path.join(NENRIN, "seki-heartbeat")
SURVIVE = os.path.join(NENRIN, "survive-v0")
PKG_SRC = os.path.join(NENRIN, "sdk-python", "src")
VEC = os.path.join(HERE, "vectors")

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

sys.path.insert(0, HEART)
sys.path.insert(0, SURVIVE)
import heartbeat as HB  # noqa: E402  (imports admission_verify_v0, anchor_compose, settle v1.12 and v1.15 from musubi-v0)
import survive as SV  # noqa: E402
import verify_chain as VC  # noqa: E402
A, AC, S12, S15 = HB.A, HB.AC, HB.s12, HB.s15
import settle_v1_16 as S16  # noqa: E402  (musubi-v0 is on sys.path through heartbeat)

DAY = "2026-10-22"
OTHER_DAY = "2026-10-23"
P = {
    "trace": "workers/hs-ledger/nenrin/trace-bind-v0/sources/summit-demo-record.json",
    "producer": "workers/hs-ledger/nenrin/trace-bind-v0/sources/producers/verifiable-agent-summit-demo-0.1.0.json",
    "contract": "workers/hs-ledger/nenrin/musubi-v0/run0003/contract.json",
    "check_contract": "workers/hs-ledger/nenrin/seki-heartbeat/check-contract.json",
    "door_key": "keys/seki-door.json",
    "run": "workers/hs-ledger/nenrin/seki-heartbeat/runs/%s/RUN.json" % DAY,
    "request": "workers/hs-ledger/nenrin/seki-heartbeat/runs/%s/request_report.json" % DAY,
    "admission": "workers/hs-ledger/nenrin/seki-heartbeat/runs/%s/admission_report.json" % DAY,
    "admission_audit": "workers/hs-ledger/nenrin/seki-heartbeat/runs/%s/admission_audit.json" % DAY,
    "admission_compare": "workers/hs-ledger/nenrin/seki-heartbeat/runs/%s/admission_compare.json" % DAY,
    "execution": "workers/hs-ledger/nenrin/seki-heartbeat/runs/%s/execution_report.json" % DAY,
    "execution_other_day": "workers/hs-ledger/nenrin/seki-heartbeat/runs/%s/execution_report.json" % OTHER_DAY,
    "settled": "workers/hs-ledger/nenrin/seki-heartbeat/runs/%s/SETTLED.json" % DAY,
    "settlement": "workers/hs-ledger/nenrin/seki-heartbeat/runs/%s/settlement.json" % DAY,
    "chunk1": "workers/hs-ledger/nenrin/seki-heartbeat/view-chunks/970715-971714.json",
    "chunk2": "workers/hs-ledger/nenrin/seki-heartbeat/view-chunks/971715-972714.json",
    "entry_adm_json": "workers/hs-ledger/nenrin/survive-v0/kept/ledger/134.json",
    "entry_adm_raw": "workers/hs-ledger/nenrin/survive-v0/kept/ledger/134.raw",
    "entry_adm_ots": "workers/hs-ledger/nenrin/survive-v0/kept/ledger/134.ots",
    "entry_exe_json": "workers/hs-ledger/nenrin/survive-v0/kept/ledger/137.json",
    "entry_exe_raw": "workers/hs-ledger/nenrin/survive-v0/kept/ledger/137.raw",
    "entry_exe_ots": "workers/hs-ledger/nenrin/survive-v0/kept/ledger/137.ots",
    "export": "workers/hs-ledger/nenrin/survive-v0/kept/export.jsonl",
}
for s in ("report", "audit", "compare"):
    P["anchored_" + s] = "workers/hs-ledger/nenrin/seki-heartbeat/runs/%s/admission_%s.anchored.json" % (DAY, s)
P["anchored_execution"] = "workers/hs-ledger/nenrin/seki-heartbeat/runs/%s/execution_report.anchored.json" % DAY
ENTRY_ADM, ENTRY_EXE = 134, 137
DOOR_DOMAIN = "shield.the-horizons-innovation.com"
# The binder keys are test keys derived from fixed public phrases. Anyone can derive them; they show the mechanics of
# the bind and stand for no party.
SEED_A = hashlib.sha256(b"nenrin-trace-chain-v0 test binder A").hexdigest()
SEED_B = hashlib.sha256(b"nenrin-trace-chain-v0 test binder B").hexdigest()


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


def node(req):
    r = subprocess.run(["node", os.path.join(HERE, "trace_step.mjs")], input=json.dumps(req).encode("utf-8"),
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=HERE, check=False)
    if r.returncode != 0:
        raise RuntimeError("trace_step.mjs failed: " + r.stderr.decode("utf-8", "replace"))
    return json.loads(r.stdout.decode("utf-8"))


def pkg(job):
    """Run one job with the nenrin-verify package (sdk-python/src) in a child process, so its vendored MUSUBI
    modules are the ones imported, not the repository's."""
    code = NO_NET + "\nimport sys\nsys.path.insert(0, %r)\n" % PKG_SRC + PKG_JOB
    r = subprocess.run([sys.executable, "-I", "-B", "-c", code], input=json.dumps(job).encode("utf-8"),
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=HERE, check=False)
    if r.returncode != 0:
        raise RuntimeError("nenrin-verify job failed: " + r.stderr.decode("utf-8", "replace"))
    return json.loads(r.stdout.decode("utf-8"))


PKG_JOB = r'''
import hashlib, json, os
from nenrin_verify import trace as T, musubi as M
from nenrin_verify._js import loads
job = json.loads(sys.stdin.read())
rd = lambda p: open(p, "rb").read().decode("utf-8")
out = {}
for name, path in job.get("intake", {}).items():
    b = loads(rd(path)); r = T.verify_trace_intake(b)
    out["intake:" + name] = {k: r.get(k) for k in ("verdict", "refusals", "findings", "sha", "key_thumbprint")}
for name, path in job.get("bind", {}).items():
    r = T.verify_trace_bind(loads(rd(path)))
    out["bind:" + name] = {k: r.get(k) for k in ("verdict", "refusals", "findings")}
if "admission" in job:
    Av = M.load("admission_verify_v0"); C = M.load("contract_v0")
    j = job["admission"]
    rec = json.loads(rd(j["record"])); con = C.parse_strict(rd(j["contract"]))
    out["admission"] = Av.verify_admission(rec, j["key"], con)
    out["admission_sha256"] = Av.admission_sha256(rec)
if "settle" in job:
    S15 = M.load("settle_v1_15"); C = M.load("contract_v0")
    j = job["settle"]
    con = C.parse_strict(rd(j["contract"]))
    view = {"headers": [h for p in j["chunks"] for h in json.loads(rd(p))["headers"] if h["height"] <= j["to"]]}
    ev = [json.loads(rd(p)) for p in j["events"]]
    adm = [json.loads(rd(p)) for p in j["admissions"]]
    s = S15.settle_v1_15(con, ev, view, admissions=adm, relying_keys={j["domain"]: j["key"]})
    out["settle"] = {"verdict": s.get("verdict"), "status": s.get("status"),
                     "settlement_sha256": hashlib.sha256(C.canonical(s).encode("utf-8")).hexdigest()}
out["vendored"] = {n: hashlib.sha256(open(M.path_of(n), "rb").read()).hexdigest() for n in job.get("vendored", [])}
sys.stdout.write(json.dumps(out, sort_keys=True))
'''


def view_to(to):
    hs = [h for rel in (P["chunk1"], P["chunk2"]) for h in rj(rel)["headers"] if h["height"] <= to]
    return {"headers": hs}


def iso_to_epoch(s):
    return calendar.timegm(time.strptime(s, "%Y-%m-%dT%H:%M:%SZ"))


def build():
    """Return {relative path under vectors/: bytes} and the list of expectation failures."""
    files, vectors, fails = {}, [], []

    def put_input(name, value):
        rel = "inputs/%s.json" % name
        files[rel] = cj(value)
        return {"path": "docs/trace-chain/vectors/" + rel, "sha256": sha(files[rel])}

    def repo_in(key):
        return {"path": P[key], "sha256": sha(rb(P[key]))}

    def add(vid, step, kind, what, code, inputs, output, ok, expect_text):
        rel = "outputs/%s.json" % vid
        files[rel] = cj(output)
        vectors.append({"id": vid, "step": step, "kind": kind, "what": what, "code": code, "inputs": inputs,
                        "output": {"path": "docs/trace-chain/vectors/" + rel, "sha256": sha(files[rel])},
                        "expect": expect_text})
        if not ok:
            fails.append("%s: expected %s, got %s" % (vid, expect_text, json.dumps(output, sort_keys=True)[:400]))

    trace = rj(P["trace"])
    producer = rj(P["producer"])
    execution = rj(P["execution"])
    other_exec = rj(P["execution_other_day"])
    run = rj(P["run"])
    acted_at = iso_to_epoch(run["ran_at"])
    contract = HB.parse_strict(rb(P["contract"]).decode("utf-8"))
    door_key = rj(P["door_key"])["public_key_ed25519_b64"]
    thumb_reg = node({"op": "thumbprint", "jwk": producer["public_key_jwk"]})["thumbprint"]
    tampered = copy.deepcopy(trace)
    tampered["subject"] = tampered["subject"] + "-edited"

    # ---- step 1: TRACE intake ------------------------------------------------------------------------------------
    r = node({"op": "intake", "bundle": {"now": acted_at, "vector": trace}})
    pin = node({"op": "pin_intake", "record": trace, "now": acted_at})
    out = {"intake": r, "ledger_intake_module": pin, "now": acted_at, "registry_producer": {"producer_id": producer.get("producer_id"), "thumbprint": thumb_reg,
           "same_key_as_record": r.get("key_thumbprint") == thumb_reg}}
    add("TC01", "1 trace intake", "positive",
        "the registry's summit demo TRACE v0.2 record, checked at the time of the act: signature, profile, required members, canonical form",
        ["sdk/trace_verify.mjs verifyTraceIntake", "sdk/trace_verify.mjs jwkThumbprint", "trace-pin-v0/trace_pin_v0.mjs checkTraceRecord, registeredProducer"],
        {"trace": repo_in("trace"), "producer": repo_in("producer")}, out,
        r["verdict"] == "pinnable" and out["registry_producer"]["same_key_as_record"] and pin["sha"] == r["sha"]
        and (pin["registered_producer"] or {}).get("producer_id") == producer.get("producer_id"),
        "pinnable; the ledger's intake module gives the same pin sha and names the registered producer; the key thumbprint equals the one trace-registry lists")
    pin_sha = r.get("sha")

    r = node({"op": "intake", "bundle": {"now": acted_at, "vector": tampered}})
    add("TC02", "1 trace intake", "negative", "the same record with one claim edited after signing (subject)",
        ["sdk/trace_verify.mjs verifyTraceIntake"], {"trace": put_input("TC02_trace_edited", tampered)},
        {"intake": r, "now": acted_at}, r["verdict"] == "refused" and r["refusals"] == ["signature_invalid"],
        "refused, signature_invalid")

    # ---- step 2: trace-bind --------------------------------------------------------------------------------------
    bind = node({"op": "sign_bind", "record": execution, "trace": trace, "acted_at": acted_at, "seed_hex": SEED_A})
    policy = {"binder_keys": [bind["binder_public_key_ed25519_b64"]], "trace_key_thumbprints": [thumb_reg], "max_age_seconds": 31536000}
    bundle = {"bind": bind, "trace": trace, "record": execution, "policy": policy}
    r = node({"op": "bind", "bundle": bundle})
    add("TC03", "2 trace-bind", "positive",
        "a bind naming the TRACE record and the execution record of %s by sha256, acted_at the run's start, under a relying party policy that pins the registry key and accepts records up to 365 days old" % DAY,
        ["sdk/trace_verify.mjs signTraceBind", "sdk/trace_verify.mjs verifyTraceBind"],
        {"bundle": put_input("TC03_bundle", bundle)},
        {"bind": r, "bind_sha256_of_record": bind["record_sha256"], "bind_trace_sha256": bind["trace_sha256"]},
        r["verdict"] == "bound" and bind["trace_sha256"] == pin_sha and bind["record_sha256"] == sha(rb(P["execution"])),
        "bound; trace_sha256 equals the pin sha of TC01; record_sha256 equals the sha256 of the execution file")

    b4 = dict(bundle, policy={"binder_keys": policy["binder_keys"], "trace_key_thumbprints": [thumb_reg]})
    r = node({"op": "bind", "bundle": b4})
    add("TC04", "2 trace-bind", "negative", "the same bind under the default policy (TRACE's 86400 second record age): the TRACE record is older than a day at the act",
        ["sdk/trace_verify.mjs verifyTraceBind"], {"bundle": put_input("TC04_bundle", b4)}, {"bind": r},
        r["verdict"] == "not_bound" and r["refusals"] == ["trace_stale_at_act"], "not_bound, trace_stale_at_act")

    b5 = dict(bundle, record=other_exec)
    r = node({"op": "bind", "bundle": b5})
    add("TC05", "2 trace-bind", "negative", "wrong binding: the bind names the execution of %s, the bundle carries the execution of %s" % (DAY, OTHER_DAY),
        ["sdk/trace_verify.mjs verifyTraceBind"], {"bundle": put_input("TC05_bundle", b5)}, {"bind": r},
        r["verdict"] == "not_bound" and r["refusals"] == ["record_sha_mismatch"], "not_bound, record_sha_mismatch")

    b6 = dict(bundle, trace=tampered)
    r = node({"op": "bind", "bundle": b6})
    add("TC06", "2 trace-bind", "negative", "tampered receipt: the bundle carries the TRACE record of TC02",
        ["sdk/trace_verify.mjs verifyTraceBind"], {"bundle": put_input("TC06_bundle", b6)}, {"bind": r},
        r["verdict"] == "not_bound" and r["refusals"] == ["trace:signature_invalid", "trace_sha_mismatch"],
        "not_bound, trace:signature_invalid and trace_sha_mismatch")

    bind_b = node({"op": "sign_bind", "record": execution, "trace": trace, "acted_at": acted_at, "seed_hex": SEED_B})
    b7 = dict(bundle, bind=bind_b)
    r = node({"op": "bind", "bundle": b7})
    add("TC07", "2 trace-bind", "negative", "a correctly signed bind by a binder the relying party did not pin",
        ["sdk/trace_verify.mjs signTraceBind", "sdk/trace_verify.mjs verifyTraceBind"], {"bundle": put_input("TC07_bundle", b7)},
        {"bind": r}, r["verdict"] == "not_bound" and r["refusals"] == ["binder_not_pinned"], "not_bound, binder_not_pinned")

    attrs = node({"op": "span_attributes", "bind": bind})
    r = node({"op": "span", "span": attrs, "bind_bundle": bundle})
    add("TC08", "2 trace-bind", "positive", "the OpenTelemetry span attributes of the TC03 bind, checked against its bundle",
        ["sdk/trace_verify.mjs spanAttributes", "sdk/trace_verify.mjs checkSpanAttributes"],
        {"span": put_input("TC08_span", attrs), "bind_bundle": {"path": "docs/trace-chain/vectors/inputs/TC03_bundle.json", "sha256": sha(files["inputs/TC03_bundle.json"])}},
        {"span": r}, r["verdict"] == "span_bound", "span_bound")

    a9 = dict(attrs, **{"nenrin.record.sha256": sha(rb(P["execution_other_day"]))})
    r = node({"op": "span", "span": a9, "bind_bundle": bundle})
    add("TC09", "2 trace-bind", "negative", "a span that names the other day's execution record against the TC03 bundle",
        ["sdk/trace_verify.mjs checkSpanAttributes"],
        {"span": put_input("TC09_span", a9), "bind_bundle": {"path": "docs/trace-chain/vectors/inputs/TC03_bundle.json", "sha256": sha(files["inputs/TC03_bundle.json"])}},
        {"span": r}, r["verdict"] == "span_not_bound" and r["refusals"] == ["span_attribute_mismatch:nenrin.record.sha256"],
        "span_not_bound, span_attribute_mismatch:nenrin.record.sha256")

    # ---- step 3: SEKI admission ----------------------------------------------------------------------------------
    adm = rj(P["admission"])
    req = rj(P["request"])
    csha = HB.contract_sha256(contract)
    v = A.verify_admission(adm, door_key, contract)
    ref = execution["admission_ref"][0]
    links = {
        "request_signed_by_contractor": A.request_signed(contract, req),
        "admission_names_request_digest": adm["action_ref"]["action_binding_digest"] == A.action_digest(csha, req),
        "execution_names_admission": ref["admission_sha256"] == A.admission_sha256(adm),
        "executed_equals_requested": {k: ref["executed"].get(k) for k in ("action", "target", "amount", "nonce", "expiry_height")}
        == {"action": req["action"]["action"], "target": req["action"]["target"], "amount": req["action"]["amount"], "nonce": req["nonce"], "expiry_height": req["expiry_height"]},
        "admission_canonical_sha256_listed_in_run": sha(rb(P["admission"])) == run["calls"][0]["record_sha256"],
    }
    out = {"verify_admission": v, "decision": adm["decision"], "reasons": adm["reasons"], "admission_sha256": A.admission_sha256(adm), "links": links}
    add("TC10", "3 SEKI admission", "positive",
        "the door's signed admission for the report call of %s, under the door key the repository publishes, for the run0003 contract; and the links request -> admission -> execution" % DAY,
        ["musubi-v0/admission_verify_v0.py verify_admission, request_signed, action_digest, admission_sha256"],
        {"admission": repo_in("admission"), "request": repo_in("request"), "execution": repo_in("execution"), "contract": repo_in("contract"),
         "door_key": repo_in("door_key"), "run": repo_in("run")},
        out, v["verdict"] == "accepted" and adm["decision"] == "admit" and all(links.values()),
        "accepted, decision admit, every link true")

    aud = rj(P["admission_audit"])
    v = A.verify_admission(aud, door_key, contract)
    add("TC11", "3 SEKI admission", "positive", "the door's signed refusal of the audit call of the same day (30 tickets over a signed limit of 25): a genuine record of a refusal",
        ["musubi-v0/admission_verify_v0.py verify_admission"], {"admission": repo_in("admission_audit"), "contract": repo_in("contract"), "door_key": repo_in("door_key")},
        {"verify_admission": v, "decision": aud["decision"], "reasons": aud["reasons"]},
        v["verdict"] == "accepted" and aud["decision"] == "refuse" and aud["reasons"] == ["amount_over_limit"],
        "accepted as the door's record; decision refuse, amount_over_limit")

    adm12 = copy.deepcopy(adm)
    adm12["chain_view"]["height"] = adm12["chain_view"]["height"] + 1
    v = A.verify_admission(adm12, door_key, contract)
    add("TC12", "3 SEKI admission", "negative", "the admission with chain_view.height raised by one after the door signed it",
        ["musubi-v0/admission_verify_v0.py verify_admission"], {"admission": put_input("TC12_admission_edited", adm12), "contract": repo_in("contract"), "door_key": repo_in("door_key")},
        {"verify_admission": v}, v == {"verdict": "refused", "refusals": ["bad_signature"]}, "refused, bad_signature")

    other_contract = HB.parse_strict(rb(P["check_contract"]).decode("utf-8"))
    v = A.verify_admission(adm, door_key, other_contract)
    add("TC13", "3 SEKI admission", "negative", "wrong binding: the genuine admission read against another contract the same door serves (the check contract)",
        ["musubi-v0/admission_verify_v0.py verify_admission"], {"admission": repo_in("admission"), "contract": repo_in("check_contract"), "door_key": repo_in("door_key")},
        {"verify_admission": v}, v["verdict"] == "refused" and "other_contract" in v["refusals"], "refused, other_contract")

    req14 = copy.deepcopy(req)
    req14["action"]["amount"] = 25
    out = {"request_signed_by_contractor": A.request_signed(contract, req14),
           "admission_names_request_digest": adm["action_ref"]["action_binding_digest"] == A.action_digest(csha, req14)}
    add("TC14", "3 SEKI admission", "negative", "the agent's signed request with the amount changed from 20 to 25 after signing",
        ["musubi-v0/admission_verify_v0.py request_signed, action_digest"], {"request": put_input("TC14_request_edited", req14), "admission": repo_in("admission"), "contract": repo_in("contract")},
        out, out == {"request_signed_by_contractor": False, "admission_names_request_digest": False}, "both false")

    # ---- step 4: MUSUBI settlement -------------------------------------------------------------------------------
    settled = rj(P["settled"])
    view = view_to(settled["view"]["to"])
    batches = {ENTRY_ADM: (rb(P["entry_adm_raw"]), rb(P["entry_adm_ots"])), ENTRY_EXE: (rb(P["entry_exe_raw"]), rb(P["entry_exe_ots"]))}
    composed, same, anchors = {}, {}, {}
    for key, entry in (("report", ENTRY_ADM), ("audit", ENTRY_ADM), ("compare", ENTRY_ADM), ("execution", ENTRY_EXE)):
        rec = rj(P["admission_" + key] if key != "execution" else P["execution"]) if key != "report" else adm
        res = HB.compose_listed(rec, batches[entry][0], batches[entry][1], contract, view)
        a = AC.anchored_record(rec, res["anchor"]) if res.get("status") == "anchored" else None
        composed[key] = a
        b = HB.canonical(a).encode("utf-8") if a else b""
        same[key] = b == rb(P["anchored_" + key])
        anchors[key] = {"entry": entry, "status": res.get("status"), "height": (res.get("anchor") or {}).get("height"),
                        "block_hash": (res.get("anchor") or {}).get("block_hash"), "anchored_sha256": sha(b) if b else None}
    adms = [composed["report"], composed["audit"], composed["compare"]]
    keys = {DOOR_DOMAIN: door_key}
    s = S15.settle_v1_15(contract, [composed["execution"]], view, admissions=adms, relying_keys=keys)
    s12 = S12.settle_v1_12(contract, [composed["execution"]], view, admissions=adms, relying_keys=keys)
    s_sha = sha(HB.canonical(s).encode("utf-8"))
    out = {"anchors": anchors, "anchored_bytes_equal_committed": same, "view": {"from": view["headers"][0]["height"], "to": view["headers"][-1]["height"]},
           "settle_v1_15": {"verdict": s.get("verdict"), "status": s.get("status"), "deviations": s.get("deviations"), "settlement_sha256": s_sha},
           "settle_v1_12_verdict": s12.get("verdict")}
    inputs = {k: repo_in(k) for k in ("contract", "door_key", "admission", "admission_audit", "admission_compare", "execution",
                                      "entry_adm_raw", "entry_adm_ots", "entry_exe_raw", "entry_exe_ots", "chunk1", "chunk2", "settled")}
    add("TC15", "4 MUSUBI settlement", "positive",
        "the anchors recomposed from the ledger's own batch bytes and .ots proofs against kept Bitcoin headers, then settle v1.15 over the execution and the day's three admissions",
        ["seki-heartbeat/heartbeat.py compose_listed", "musubi-v0/anchor_compose.py anchored_record", "musubi-v0/settle_v1_15.py", "musubi-v0/settle_v1_12.py"],
        inputs, out,
        all(same.values()) and s.get("verdict") == "within_grant" and s.get("status") == "final" and s_sha == settled["settlement_sha256"]
        and s_sha == sha(rb(P["settlement"])) and s12.get("verdict") == s.get("verdict"),
        "anchored bytes equal the committed ones; within_grant, final; settlement sha256 equals SETTLED.json and settlement.json; v1.12 agrees")

    s = S15.settle_v1_15(contract, [composed["execution"]], view, admissions=[], relying_keys=keys)
    devs = sorted({d.get("clause") or d.get("reason") or d.get("kind") for d in (s.get("deviations") or []) if isinstance(d, dict)})
    out = {"verdict": s.get("verdict"), "status": s.get("status"), "deviation_clauses": devs}
    add("TC16", "4 MUSUBI settlement", "negative", "the same anchored execution settled without any admission in hand",
        ["musubi-v0/settle_v1_15.py"], {k: inputs[k] for k in ("contract", "execution", "entry_exe_raw", "entry_exe_ots", "chunk1", "chunk2")},
        out, s.get("verdict") == "deviation" and "unadmitted_execution" in devs, "deviation, unadmitted_execution")

    ex17 = copy.deepcopy(composed["execution"])
    ex17["admission_ref"][0]["executed"]["amount"] = 25
    s = S15.settle_v1_15(contract, [ex17], view, admissions=adms, relying_keys=keys)
    s16 = S16.settle_v1_16(contract, [ex17], view, admissions=adms, relying_keys=keys)
    out = {"settle_v1_15": {"verdict": s.get("verdict"), "status": s.get("status"), "rejected": s.get("rejected"), "deviations": s.get("deviations"),
                            "settlement_sha256": sha(HB.canonical(s).encode("utf-8"))},
           "settle_v1_16": {"verdict": s16.get("verdict"), "rejected": s16.get("rejected")}}
    edited_sha = sha(HB.canonical(ex17).encode("utf-8"))
    add("TC17", "4 MUSUBI settlement", "negative",
        "the anchored execution with executed.amount changed from 20 to 25 after the agent signed it, anchor kept: the record is not counted as an act",
        ["musubi-v0/settle_v1_15.py", "musubi-v0/settle_v1_16.py"],
        {"execution_anchored": put_input("TC17_execution_anchored_edited", ex17), "contract": inputs["contract"],
         "chunk1": inputs["chunk1"], "chunk2": inputs["chunk2"]},
        out, [x.get("sha256") for x in (s.get("rejected") or [])] == [edited_sha] and not s.get("deviations")
        and out["settle_v1_15"]["settlement_sha256"] != settled["settlement_sha256"]
        and s16.get("verdict") == "nothing_to_settle" and len(s16.get("rejected") or []) == 1,
        "v1.15 sets the edited record aside (no valid signature) and settles over no act; v1.16 rejects it and says nothing_to_settle")

    try:
        res = HB.compose_listed(execution, batches[ENTRY_ADM][0], batches[ENTRY_ADM][1], contract, view)
        out = {"refused": None, "status": res.get("status")}
    except AC.Refused as e:
        out = {"refused": e.code, "detail": e.detail}
    add("TC18", "4 MUSUBI settlement", "negative", "broken chain: the execution composed against ledger entry %d, a batch that does not list it" % ENTRY_ADM,
        ["seki-heartbeat/heartbeat.py compose_listed"], {"execution": inputs["execution"], "entry_raw": inputs["entry_adm_raw"], "entry_ots": inputs["entry_adm_ots"]},
        out, out.get("refused") is not None, "refused by compose")

    # ---- step 5: NENRIN entries ----------------------------------------------------------------------------------
    kept = os.path.join(SURVIVE, "kept")
    entries_all = SV.load_entries(kept)
    upto = {n: e for n, e in entries_all.items() if n <= ENTRY_EXE}
    ch = SV.check_chain(kept, upto)
    rows = {}
    with open(os.path.join(REPO, P["export"]), "rb") as f:
        for line in f:
            o = json.loads(line)
            if o.get("n") in (ENTRY_ADM, ENTRY_EXE):
                rows[o["n"]] = o
    exe_batch = json.loads(batches[ENTRY_EXE][0])
    adm_batch = json.loads(batches[ENTRY_ADM][0])
    listed_exe = [x.get("sha") for x in exe_batch.get("records", [])]
    listed_adm = [x.get("canonical_sha256") for x in adm_batch.get("records", [])]
    heads = {}
    prev = SV.CHAIN_ROOT
    for n in range(1, ENTRY_EXE + 1):
        prev = SV.entry_sha(upto[n], prev)
        heads[n] = prev
    out = {
        "claims": {str(n): {"claim_sha256": entries_all[n]["claim_sha256"], "raw_sha256": VC.sha256hex(batches[n][0])} for n in (ENTRY_ADM, ENTRY_EXE)},
        "execution_listed_in_%d" % ENTRY_EXE: sha(rb(P["execution"])) in listed_exe,
        "admissions_listed_in_%d" % ENTRY_ADM: {c["service"]: c["record_sha256"] in listed_adm for c in run["calls"]},
        "chain": {"rebuilt_through": ch["rebuilt_through"], "broken_at": ch["broken_at"], "entry_sha256": {str(n): heads[n] for n in (ENTRY_ADM, ENTRY_EXE)},
                  "stamped_heads_up_to_%d" % ENTRY_EXE: len(ch["stamped_heads"]), "stamped_heads_matched": ch["stamped_heads_matched"]},
        "export_rows_agree": {str(n): rows.get(n, {}).get("entry_sha256") == heads[n] for n in (ENTRY_ADM, ENTRY_EXE)},
        "bind_record_sha256_is_listed": bind["record_sha256"] in listed_exe,
    }
    ok = (all(v["claim_sha256"] == v["raw_sha256"] for v in out["claims"].values()) and out["execution_listed_in_%d" % ENTRY_EXE]
          and all(out["admissions_listed_in_%d" % ENTRY_ADM].values()) and ch["broken_at"] is None
          and ch["stamped_heads_matched"] == len(ch["stamped_heads"]) and all(out["export_rows_agree"].values()) and out["bind_record_sha256_is_listed"])
    add("TC19", "5 NENRIN entries", "positive",
        "ledger entries %d (the door's records) and %d (the execution): claim digests, listings, jidec-chain-v1 recomputed from entry 1, stamped heads, export rows; and the bind of TC03 names a record entry %d lists" % (ENTRY_ADM, ENTRY_EXE, ENTRY_EXE),
        ["survive-v0/survive.py load_entries, check_chain, entry_sha", "survive-v0/verify_chain.py sha256hex"],
        {"entry_adm_json": repo_in("entry_adm_json"), "entry_adm_raw": repo_in("entry_adm_raw"), "entry_exe_json": repo_in("entry_exe_json"),
         "entry_exe_raw": repo_in("entry_exe_raw"), "ledger_copy": {"path": "workers/hs-ledger/nenrin/survive-v0/kept/ledger/1.json .. %d.json and .raw" % ENTRY_EXE, "sha256": None},
         "export": {"path": P["export"], "sha256": None, "rows_read": [ENTRY_ADM, ENTRY_EXE]}},
        out, ok, "every check true; chain unbroken through %d; all stamped heads up to %d match" % (ENTRY_EXE, ENTRY_EXE))

    raw20 = bytearray(batches[ENTRY_EXE][0])
    i = bytes(raw20).find(b'"anchored_at":"') + len(b'"anchored_at":"') + 3
    raw20[i:i + 1] = b"7" if raw20[i:i + 1] != b"7" else b"5"
    raw20 = bytes(raw20)
    try:
        res = HB.compose_listed(execution, raw20, batches[ENTRY_EXE][1], contract, view)
        comp = {"refused": None, "status": res.get("status")}
    except AC.Refused as e:
        comp = {"refused": e.code, "detail": e.detail}
    out = {"claim_sha256": entries_all[ENTRY_EXE]["claim_sha256"], "raw_sha256": VC.sha256hex(raw20), "compose": comp}
    add("TC20", "5 NENRIN entries", "negative", "entry %d's batch bytes with one digit of the year in anchored_at changed" % ENTRY_EXE,
        ["survive-v0/verify_chain.py sha256hex", "seki-heartbeat/heartbeat.py compose_listed"],
        {"entry_raw_edited": {"path": "docs/trace-chain/vectors/inputs/TC20_entry_raw_edited.raw", "sha256": sha(raw20)}, "entry_ots": inputs["entry_exe_ots"]},
        out, out["claim_sha256"] != out["raw_sha256"] and comp.get("refused") == "ots_for_other_bytes",
        "raw digest differs from claim_sha256; compose refused, ots_for_other_bytes")
    files["inputs/TC20_entry_raw_edited.raw"] = raw20

    holes = {n: e for n, e in upto.items() if n != ENTRY_EXE - 2}
    ch = SV.check_chain(kept, holes)
    out = {"removed": ENTRY_EXE - 2, "rebuilt_through": ch["rebuilt_through"], "broken_at": ch["broken_at"], "head": ch["head"]}
    add("TC21", "5 NENRIN entries", "negative", "the ledger copy with entry %d removed" % (ENTRY_EXE - 2),
        ["survive-v0/survive.py check_chain"], {"ledger_copy": {"path": "workers/hs-ledger/nenrin/survive-v0/kept/ledger/1.json .. %d.json without %d" % (ENTRY_EXE, ENTRY_EXE - 2), "sha256": None}},
        out, ch["broken_at"] == ENTRY_EXE - 2 and ch["head"] != heads[ENTRY_EXE], "chain broken at %d; no head reaches entry %d" % (ENTRY_EXE - 2, ENTRY_EXE))

    rew = dict(upto)
    rew[ENTRY_EXE - 1] = dict(upto[ENTRY_EXE - 1], claim_sha256="0" * 64)
    prev = SV.CHAIN_ROOT
    for n in range(1, ENTRY_EXE + 1):
        prev = SV.entry_sha(rew[n], prev)
    out = {"rewritten": ENTRY_EXE - 1, "recomputed_entry_sha256_%d" % ENTRY_EXE: prev, "export_row_entry_sha256": rows[ENTRY_EXE]["entry_sha256"]}
    add("TC22", "5 NENRIN entries", "negative", "entry %d's claim_sha256 rewritten: the chain no longer reaches the entry_sha256 the export states for %d" % (ENTRY_EXE - 1, ENTRY_EXE),
        ["survive-v0/survive.py entry_sha"], {"ledger_copy": {"path": "workers/hs-ledger/nenrin/survive-v0/kept/ledger/1.json .. %d.json, %d rewritten" % (ENTRY_EXE, ENTRY_EXE - 1), "sha256": None}},
        out, prev != rows[ENTRY_EXE]["entry_sha256"], "recomputed entry_sha256 differs from the export row")

    # ---- step 6: nenrin-verify -----------------------------------------------------------------------------------
    tmp = tempfile.mkdtemp(prefix="trace-chain-")
    try:
        def tmpfile(name, b):
            p = os.path.join(tmp, name)
            with open(p, "wb") as f:
                f.write(b)
            return p
        job = {"intake": {"TC01": tmpfile("i1.json", cj({"now": acted_at, "vector": trace}))},
               "bind": {"TC03": tmpfile("b3.json", files["inputs/TC03_bundle.json"]), "TC06": tmpfile("b6.json", files["inputs/TC06_bundle.json"])},
               "admission": {"record": os.path.join(REPO, P["admission"]), "contract": os.path.join(REPO, P["contract"]), "key": door_key},
               "settle": {"contract": os.path.join(REPO, P["contract"]), "chunks": [os.path.join(REPO, P["chunk1"]), os.path.join(REPO, P["chunk2"])],
                          "to": settled["view"]["to"], "events": [os.path.join(REPO, P["anchored_execution"])],
                          "admissions": [os.path.join(REPO, P["anchored_" + s]) for s in ("report", "audit", "compare")],
                          "domain": DOOR_DOMAIN, "key": door_key},
               "vendored": ["admission_verify_v0", "settle_v1_15", "settle_v1_14", "clause_eval_v0", "contract_v0"]}
        got = pkg(job)
        job17 = {"settle": dict(job["settle"], events=[tmpfile("e17.json", files["inputs/TC17_execution_anchored_edited.json"])])}
        got17 = pkg(job17)
    finally:
        for n in os.listdir(tmp):
            os.remove(os.path.join(tmp, n))
        os.rmdir(tmp)
    js1 = json.loads(files["outputs/TC01.json"])["intake"]
    js3 = json.loads(files["outputs/TC03.json"])["bind"]
    js6 = json.loads(files["outputs/TC06.json"])["bind"]
    repo_vendored = {n: sha(rb("workers/hs-ledger/nenrin/musubi-v0/%s.py" % n)) for n in job["vendored"]}
    out = {"package": got, "same_as_javascript": {"TC01": {k: got["intake:TC01"][k] for k in ("verdict", "refusals", "sha", "key_thumbprint")} == {k: js1[k] for k in ("verdict", "refusals", "sha", "key_thumbprint")},
                                                   "TC03": got["bind:TC03"] == {k: js3[k] for k in ("verdict", "refusals", "findings")}},
           "vendored_equal_repository": got["vendored"] == repo_vendored,
           "settlement_equal_committed": got["settle"]["settlement_sha256"] == settled["settlement_sha256"]}
    add("TC23", "6 nenrin-verify", "positive",
        "steps 1 to 4 recomputed with the nenrin-verify Python package from this repository (sdk-python/src): its TRACE port, and its vendored MUSUBI admission verifier and settle v1.15 over the committed anchored records",
        ["sdk-python/src/nenrin_verify/trace.py", "sdk-python/src/nenrin_verify/musubi.py load", "nenrin_verify/_repo/musubi-v0"],
        {"bundle": {"path": "docs/trace-chain/vectors/inputs/TC03_bundle.json", "sha256": sha(files["inputs/TC03_bundle.json"])},
         "anchored_execution": repo_in("anchored_execution"), "anchored_report": repo_in("anchored_report"), "anchored_audit": repo_in("anchored_audit"),
         "anchored_compare": repo_in("anchored_compare"), "admission": inputs["admission"], "contract": inputs["contract"], "chunk1": inputs["chunk1"], "chunk2": inputs["chunk2"]},
        out, all(out["same_as_javascript"].values()) and out["vendored_equal_repository"] and out["settlement_equal_committed"]
        and got["admission"]["verdict"] == "accepted" and got["settle"]["verdict"] == "within_grant",
        "the package agrees with the JavaScript reference on TC01 and TC03, accepts the admission, settles within_grant with the committed settlement sha256, and its vendored files equal the repository's")

    t17 = json.loads(files["outputs/TC17.json"])
    out = {"bind:TC06": got["bind:TC06"], "settle:TC17": got17["settle"],
           "same_as_reference": {"TC06": got["bind:TC06"] == {k: js6[k] for k in ("verdict", "refusals", "findings")},
                                 "TC17": got17["settle"]["settlement_sha256"] == t17["settle_v1_15"]["settlement_sha256"]}}
    add("TC24", "6 nenrin-verify", "negative", "the package on the tampered receipt bundle of TC06 and the edited execution of TC17",
        ["sdk-python/src/nenrin_verify/trace.py", "nenrin_verify/_repo/musubi-v0/settle_v1_15.py"],
        {"bundle": {"path": "docs/trace-chain/vectors/inputs/TC06_bundle.json", "sha256": sha(files["inputs/TC06_bundle.json"])},
         "execution_anchored": {"path": "docs/trace-chain/vectors/inputs/TC17_execution_anchored_edited.json", "sha256": sha(files["inputs/TC17_execution_anchored_edited.json"])}},
        out, got["bind:TC06"]["verdict"] == "not_bound" and got17["settle"]["settlement_sha256"] != settled["settlement_sha256"] and all(out["same_as_reference"].values()),
        "not_bound; the edited execution settles to other bytes than the committed settlement; both the same as the reference, byte for byte")

    index = {"schema": "nenrin-trace-chain-vectors-v0",
             "path": "TRACE v0.2 record -> trace-bind -> SEKI admission -> MUSUBI settlement -> NENRIN entries -> nenrin-verify",
             "day": DAY, "acted_at": acted_at,
             "binder_keys": "test keys: Ed25519 seeds sha256(\"nenrin-trace-chain-v0 test binder A\") and (... B); they stand for no party",
             "counts": {"positive": sum(1 for v in vectors if v["kind"] == "positive"), "negative": sum(1 for v in vectors if v["kind"] == "negative")},
             "vectors": vectors}
    files["vectors.json"] = cj(index)
    return files, fails


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args(argv)
    files, fails = build()
    for f in fails:
        print("EXPECTATION FAILED " + f)
    if a.check:
        diff = []
        on_disk = set()
        for root, _, names in os.walk(VEC):
            for n in names:
                on_disk.add(os.path.relpath(os.path.join(root, n), VEC).replace(os.sep, "/"))
        for rel in sorted(set(files) | on_disk):
            p = os.path.join(VEC, rel)
            have = open(p, "rb").read() if os.path.exists(p) else None
            if have != files.get(rel):
                diff.append(rel)
        for rel in diff:
            print("DIFFERS " + rel)
        idx = json.loads(files["vectors.json"])
        print("vectors: %d (positive %d, negative %d); files compared: %d; differing: %d; expectations failed: %d"
              % (len(idx["vectors"]), idx["counts"]["positive"], idx["counts"]["negative"], len(files), len(diff), len(fails)))
        return 1 if diff or fails else 0
    if fails:
        return 1
    for rel, b in files.items():
        p = os.path.join(VEC, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as f:
            f.write(b)
    print("wrote %d files under vectors/" % len(files))
    return 0


if __name__ == "__main__":
    sys.exit(main())
