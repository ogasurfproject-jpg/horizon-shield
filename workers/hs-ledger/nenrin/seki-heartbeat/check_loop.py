#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_loop.py: the SEKI door's daily check call, carried through the whole MUSUBI loop.

At 03:47 UTC the door sends one fixed request to its check store (tooshi-check) under the check contract
(check-contract.json): the content check runner (FURUI) checks it, the door (SEKI) signs an admission of version 0.4 and
hands it to the public ledger (NENRIN). The door stops there. This file carries the same call through the rest of the
MUSUBI loop, every day, and writes what it did under check-runs/<day>/:

  file     After the call (the heartbeat workflow runs it at 21:17 UTC): read the door's last check call from its
           public policy (GET /seki, furui.check_call), fetch the admission the door signed, check it under the door's
           published key and the check contract, rebuild the request the door sent (its action, nonce and expiry are
           bound by the admission's action_binding_digest, which is checked), and file at the MUSUBI intake
             the check contract (POST /contract; once, later runs are answered as already on file) and
             an execution record signed by the contract's contractor, naming the admission (admission_ref) and the
             content check (nenrin_ref is the content block's check_sha256).
  settle   For each earlier day whose admission and execution the ledger has batched and Bitcoin has confirmed: compose
           both anchors, build the header view from the contract's lower bound (final headers kept in
           check-view-chunks/), and settle with MUSUBI settle v1.19. settlement.json and SETTLED.json are written next to
           the day's records; a final verdict is never rewritten. A day still unsettled 72 hours after it was filed is
           a failure, not a wait.
  index    check-runs/index.json and check-runs/README.md, one line per day.

The contractor's key is made from a public label (sha256 of "seki-check-v0:agent"), as the check contract says, so this
file needs no secret and anyone can recompute every signature it makes. The principal, the contractor and the relying
party are all The HORIZONs Co., Ltd.; the check contract allows one action, check, with an amount of 0.

  python3 check_loop.py file   [--root check-runs] [--date YYYY-MM-DD]
  python3 check_loop.py settle [--root check-runs] [--view-chunks check-view-chunks]
  python3 check_loop.py index  [--root check-runs]
  python3 check_loop.py --selftest
"""
import argparse, datetime, hashlib, json, os, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import heartbeat as HB  # noqa: E402  (puts musubi-v0 on the path)
import admission_verify_v0 as A  # noqa: E402
import anchor_compose as AC  # noqa: E402
import peer_kit  # noqa: E402
import settle_v1_2 as v12  # noqa: E402
import settle_v1_19 as s19  # noqa: E402
from contract_v0 import canonical, contract_sha256, parse_strict, verify_contract  # noqa: E402

CONTRACT_PATH = os.path.join(HERE, "check-contract.json")
CONTRACT_SHA256 = "d8f28e81288f45d2fcc07f00532f19b67aeeb9b2873ee5a496cc88adb8e50580"
POLICY = HB.GATEWAY + "/seki"
RECORD = HB.GATEWAY + "/seki/record/"
AGENT_LABEL = b"seki-check-v0:agent"
EXPIRY_AFTER_VIEW = 6          # the door's check request expires 6 blocks after the door's chain view (checkRequest)
ACTION = "check"
AMOUNT = 0
INDEX_SCHEMA = "seki-check-loop-index-v0"
SETTLED_SCHEMA = "seki-check-loop-settled-v0"


def contract():
    c = parse_strict(open(CONTRACT_PATH, encoding="utf-8").read())
    if contract_sha256(c) != CONTRACT_SHA256:
        raise SystemExit("check-contract.json is not the check contract %s" % CONTRACT_SHA256)
    return c


def agent_key():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    return Ed25519PrivateKey.from_private_bytes(hashlib.sha256(AGENT_LABEL).digest())


def target_of(c):
    return ((c.get("selection_provenance") or {}).get("task_document") or {}).get("target")


def rebuild_request(c, adm):
    """The request the door sent, from what its admission binds: (request, problem or None)."""
    ar = adm.get("action_ref") if isinstance(adm, dict) else None
    cv = adm.get("chain_view") if isinstance(adm, dict) else None
    if not isinstance(ar, dict) or not isinstance(cv, dict) or not isinstance(cv.get("height"), int) or not isinstance(ar.get("nonce"), str):
        return None, "the admission carries no action_ref nonce or chain_view height"
    req = {"action": {"action": ACTION, "target": target_of(c), "amount": AMOUNT}, "nonce": ar["nonce"], "expiry_height": cv["height"] + EXPIRY_AFTER_VIEW}
    if A.action_digest(contract_sha256(c), req) != ar.get("action_binding_digest"):
        return None, "the rebuilt request does not hash to the admission's action_binding_digest"
    return req, None


def make_execution(c, req, adm, nenrin_ref):
    from cryptography.hazmat.primitives import serialization
    tmp = tempfile.mkdtemp(prefix="seki-check-")
    pem = os.path.join(tmp, "agent.pem")
    try:
        with open(pem, "wb") as f:
            f.write(agent_key().private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        return peer_kit.make_exec(c, pem, [ACTION], nenrin_ref, admitted=[(req, adm)])
    finally:
        if os.path.exists(pem):
            os.unlink(pem)
        os.rmdir(tmp)


def _w(p, text):
    with open(p, "w", encoding="utf-8") as f:
        f.write(text)


def file_day(root, date, http=None, door_key=None):
    """0 done or nothing to do yet, 1 failure. Writes check-runs/<date>/ only when the day's call is filed."""
    http = http or HB.http
    out = os.path.join(root, date)
    if os.path.exists(os.path.join(out, "RUN.json")):
        print("check call of %s: already filed" % date)
        return 0
    c = contract()
    st, _h, b = http("GET", POLICY)
    cc = (((HB.jl(b) or {}).get("furui") or {}).get("check_call")) if st == 200 else None
    if st != 200:
        print("FAIL: the door's policy answered %s" % st)
        return 1
    if not isinstance(cc, dict) or cc.get("day") != date:
        print("not yet: the door shows no check call for %s (furui.check_call day %s); nothing filed" % (date, (cc or {}).get("day") if isinstance(cc, dict) else cc))
        return 0
    rs = cc.get("record_sha256")
    if cc.get("ok") is not True or cc.get("decision") != "admit" or not (isinstance(rs, str) and len(rs) == 64):
        print("FAIL: the check call of %s was not admitted (ok %s, decision %s); there is no admission to execute under" % (date, cc.get("ok"), cc.get("decision")))
        return 1
    gst, _h, gb = http("GET", RECORD + rs)
    if gst != 200 or hashlib.sha256(gb).hexdigest() != rs:
        print("FAIL: the door does not serve the record %s as bytes that hash to it (%s)" % (rs, gst))
        return 1
    adm = parse_strict(gb.decode("utf-8"))
    v = A.verify_admission(adm, door_key or HB.door_key(), c)
    if v.get("verdict") != "accepted" or adm.get("decision") != "admit" or adm.get("reasons") != ["within_grant"]:
        print("FAIL: the admission %s does not verify as admit within_grant under the door's key and the check contract (%s)" % (rs, json.dumps(v.get("refusals"))))
        return 1
    req, why = rebuild_request(c, adm)
    if why:
        print("FAIL: %s" % why)
        return 1
    k = adm.get("content") or {}
    nref = k.get("check_sha256")
    if not (isinstance(nref, str) and len(nref) == 64):
        print("FAIL: the admission carries no content check_sha256")
        return 1
    ctext = canonical(c)
    cst, _h, cb = http("POST", HB.AGREEMENT + "/contract", ctext.encode("utf-8"), {"content-type": "application/json"})
    cj = HB.jl(cb) or {}
    if not (cst in (200, 201, 409) and (cj.get("verdict") == "accepted" or cj.get("dedup") is True)):
        print("FAIL: the MUSUBI intake did not take the check contract (%s %s)" % (cst, (cb or b"")[:300]))
        return 1
    e = make_execution(c, req, adm, nref)
    if v12.authenticate(e, c) is not None:
        print("FAIL: the execution record does not authenticate under the check contract")
        return 1
    etext = canonical(e)
    est, _h, eb = http("POST", HB.AGREEMENT + "/execution", etext.encode("utf-8"), {"content-type": "application/json"})
    ej = HB.jl(eb) or {}
    if not (est in (201, 409) and (ej.get("verdict") == "accepted" or ej.get("dedup") is True)):
        print("FAIL: the MUSUBI intake did not take the execution record (%s %s)" % (est, (eb or b"")[:300]))
        return 1
    esha = hashlib.sha256(etext.encode("utf-8")).hexdigest()
    os.makedirs(out, exist_ok=True)
    _w(os.path.join(out, "admission.json"), gb.decode("utf-8"))
    _w(os.path.join(out, "execution.json"), etext)
    run = {"schema": "seki-check-loop-run-v0", "date": date, "contract_sha256": CONTRACT_SHA256, "check_call_at": cc.get("at"),
           "admission_sha256": A.admission_sha256(adm), "record_sha256": rs, "execution_sha256": esha, "nenrin_ref": nref,
           "contract_url": HB.AGREEMENT + "/contract/" + CONTRACT_SHA256, "execution_url": HB.AGREEMENT + "/execution/" + esha,
           "ledger_url": HB.LEDGER + "/admission/" + rs, "result": "filed"}
    _w(os.path.join(out, "RUN.json"), json.dumps(run, indent=2, ensure_ascii=False) + "\n")
    print("check call of %s: admission %s, execution %s filed at the MUSUBI intake" % (date, rs[:12], esha[:12]))
    return 0


def settle_day(day_dir, c, chunk_dir, get=None, cache=None, door_key=None):
    get = get or (lambda u: HB.http("GET", u))
    runp = os.path.join(day_dir, "RUN.json")
    if not os.path.exists(runp) or os.path.exists(os.path.join(day_dir, "settlement.json")):
        return "skip"
    r = json.load(open(runp, encoding="utf-8"))
    shas = [r["record_sha256"], r["execution_sha256"]]
    found = HB.locate(shas, get, cache)
    if len(found) != len(shas):
        return "pending: %d of 2 records are in a ledger batch" % len(found)
    entries = sorted({n for n, _ in found.values()})
    ots = {}
    for n in entries:
        st, _, b = get("%s/verify/%d" % (HB.LEDGER, n))
        if st != 200 or (HB.jl(b) or {}).get("bitcoin_status") != "confirmed":
            return "pending: ledger entry %d is not confirmed in Bitcoin yet" % n
        st, _, ob = get("%s/ledger/%d/ots" % (HB.LEDGER, n))
        if st != 200:
            return "pending: no proof served for entry %d" % n
        ots[n] = ob
    view = HB.extend_view(c, chunk_dir)
    anchored = {}
    for name, sha in (("admission.json", shas[0]), ("execution.json", shas[1])):
        p = os.path.join(day_dir, name)
        rec = HB.rd(p)
        n, batch = found[sha]
        res = HB.compose_listed(rec, batch, ots[n], c, view)
        if res["status"] != "anchored":
            return "pending: the proof for %s does not reach Bitcoin yet" % sha[:12]
        a = AC.anchored_record(rec, res["anchor"])
        anchored[name] = a
        _w(p.replace(".json", ".anchored.json"), canonical(a))
    s = s19.settle_v1_19(c, [anchored["execution.json"]], view, admissions=[anchored["admission.json"]],
                         relying_keys={HB.DOOR_DOMAIN: door_key or HB.door_key()})
    tip = view["headers"][-1]["height"]
    _w(os.path.join(day_dir, "settlement.json"), canonical(s))
    _w(os.path.join(day_dir, "SETTLED.json"), json.dumps({
        "schema": SETTLED_SCHEMA, "settle": "v1.19", "contract_sha256": CONTRACT_SHA256, "verdict": s.get("verdict"), "status": s.get("status"),
        "view": {"from": view["headers"][0]["height"], "to": tip}, "ledger_entries": entries,
        "settlement_sha256": hashlib.sha256(canonical(s).encode()).hexdigest(),
        "recompute": "anchor_compose.py for each record against its ledger entry (?format=raw and /ots), header_view_fetch.py --contract "
                     "../../check-contract.json --to %d, then settle_v1_19.py --settle ../../check-contract.json --event execution.anchored.json "
                     "--admission admission.anchored.json --relying-key %s=<keys/seki-door.json> --view view.json (the tools are in ../../../musubi-v0)" % (tip, HB.DOOR_DOMAIN)},
        indent=2) + "\n")
    return "settled: %s %s" % (s.get("verdict"), s.get("status"))


def settle(root, chunk_dir, now=None):
    c = contract()
    days = sorted(d for d in os.listdir(root) if len(d) == 10 and os.path.isdir(os.path.join(root, d))) if os.path.isdir(root) else []
    bad, cache = 0, {}
    now = now or datetime.datetime.now(datetime.timezone.utc)
    for d in days:
        try:
            msg = settle_day(os.path.join(root, d), c, chunk_dir, cache=cache)
        except Exception as e:  # noqa: BLE001
            msg, bad = "FAIL: %s" % e, bad + 1
        if msg.startswith("pending"):
            filed = datetime.datetime.strptime(d, "%Y-%m-%d").replace(tzinfo=datetime.timezone.utc) + datetime.timedelta(days=1)
            if (now - filed).total_seconds() > HB.STALL_HOURS * 3600:
                msg, bad = "STALLED (more than %d hours unsettled): %s" % (HB.STALL_HOURS, msg), bad + 1
        if msg != "skip":
            print("%s  %s" % (d, msg))
    return 1 if bad else 0


def write_index(root):
    if not os.path.isdir(root):
        return
    days = {}
    for d in sorted(x for x in os.listdir(root) if len(x) == 10 and os.path.exists(os.path.join(root, x, "RUN.json"))):
        r = json.load(open(os.path.join(root, d, "RUN.json"), encoding="utf-8"))
        sp = os.path.join(root, d, "SETTLED.json")
        sv = json.load(open(sp, encoding="utf-8")) if os.path.exists(sp) else None
        days[d] = {"record_sha256": r.get("record_sha256"), "admission_sha256": r.get("admission_sha256"), "execution_sha256": r.get("execution_sha256"),
                   "settled": sv is not None, "settle": (sv or {}).get("settle"), "verdict": (sv or {}).get("verdict"), "status": (sv or {}).get("status"),
                   "settlement_sha256": (sv or {}).get("settlement_sha256")}
    idx = {"schema": INDEX_SCHEMA, "contract_sha256": CONTRACT_SHA256, "first_day": min(days) if days else None, "days": days}
    _w(os.path.join(root, "index.json"), json.dumps(idx, indent=2, sort_keys=True) + "\n")
    rows = ["| %s | %s | %s | %s |" % (d, (x["record_sha256"] or "")[:8], (x["execution_sha256"] or "")[:8],
                                       ("%s, %s (settle %s)" % (x["verdict"], x["status"], x["settle"])) if x["settled"] else "waiting for Bitcoin")
            for d, x in sorted(days.items(), reverse=True)]
    _w(os.path.join(root, "README.md"),
       "# The SEKI door's check call through MUSUBI\n\n"
       "Once a day at 03:47 UTC the door sends its fixed check request: the content check runner (FURUI) checks it, the door "
       "(SEKI) admits it, the public ledger (NENRIN) holds the admission. check_loop.py files the execution record under the "
       "check contract (../check-contract.json) at the MUSUBI intake, and once Bitcoin has confirmed both records the day is "
       "settled with MUSUBI settle v1.19. TOOSHI reads index.json every day. Principal, contractor and relying party are all "
       "The HORIZONs Co., Ltd., and the contractor's key is made from a public label.\n\n"
       "| day (UTC) | admission record | execution | settlement |\n|---|---|---|---|\n" + "\n".join(rows) + "\n")


# --------------------------------------------------------------------------- self test (offline)
def _selftest():
    from cryptography.hazmat.primitives import serialization
    n = 0
    c = contract()
    assert verify_contract(c)["verdict"] == "accepted"
    pub = __import__("base64").b64encode(agent_key().public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
    con = next(p for p in c["parties"] if p["role"] == "contractor")
    assert con["public_key_ed25519_b64"] == pub
    keyf = json.load(open(os.path.join(HERE, "..", "..", "..", "..", "keys", "seki-check-agent.json"), encoding="utf-8"))
    assert keyf["public_key_ed25519_b64"] == pub and keyf["key_url"] == con["key_url"]
    n += 1; print("[1] check-contract.json is the check contract (verify_contract accepted), the contractor key from the public label is the pinned one and keys/ serves it")
    nonce, h = "ab" * 16, 974300
    full = A.build_action_request(c, ACTION, nonce, h + EXPIRY_AFTER_VIEW, agent_key(), target=target_of(c), amount=AMOUNT)
    adm = {"action_ref": {"action_binding_digest": full["action_binding"]["digest"]["value"], "nonce": nonce}, "chain_view": {"height": h}, "decision": "admit"}
    req, why = rebuild_request(c, adm)
    assert why is None and req["expiry_height"] == h + 6 and req["action"] == full["action"]
    bad, why2 = rebuild_request(c, dict(adm, chain_view={"height": h + 1}))
    assert bad is None and "action_binding_digest" in why2
    bad, why3 = rebuild_request(c, {"decision": "admit"})
    assert bad is None and why3
    n += 1; print("[2] the request is rebuilt from the admission (nonce, chain view + 6) and must hash to its action_binding_digest; another height is refused")
    orig = A.admission_sha256
    A.admission_sha256 = lambda rec: "cd" * 32
    try:
        e = make_execution(c, req, adm, "ef" * 32)
    finally:
        A.admission_sha256 = orig
    assert v12.authenticate(e, c) is None
    ref = e["admission_ref"][0]
    assert ref["admission_sha256"] == "cd" * 32 and ref["executed"] == {"action": ACTION, "target": target_of(c), "amount": AMOUNT, "nonce": nonce, "expiry_height": h + 6}
    assert A.action_digest(contract_sha256(c), {"action": {k: ref["executed"][k] for k in ("action", "target", "amount")}, "nonce": nonce, "expiry_height": h + 6}) == adm["action_ref"]["action_binding_digest"]
    assert e["nenrin_ref"] == "ef" * 32 and e["performed_actions"] == [ACTION]
    n += 1; print("[3] the execution record is signed by the contractor, authenticates under the contract, names the admission and executes exactly what it bound")
    t = tempfile.mkdtemp()
    calls = []

    def fake(policy):
        def http(method, url, body=None, headers=None):
            calls.append((method, url))
            if url == POLICY:
                return 200, {}, json.dumps(policy).encode()
            return 500, {}, b"{}"
        return http
    assert file_day(t, "2026-11-04", fake({"furui": {"check_call": None}})) == 0 and not os.listdir(t)
    assert file_day(t, "2026-11-04", fake({"furui": {"check_call": {"day": "2026-11-03", "ok": True}}})) == 0 and not os.listdir(t)
    assert file_day(t, "2026-11-04", fake({"furui": {}})) == 0 and not os.listdir(t)
    assert file_day(t, "2026-11-04", fake({"furui": {"check_call": {"day": "2026-11-04", "ok": False, "error": "x"}}})) == 1 and not os.listdir(t)
    assert all(m == "GET" for m, _ in calls)
    n += 1; print("[4] file: no call for the day is not yet (nothing written, nothing posted); a failed call of the day is a failure")
    os.makedirs(os.path.join(t, "2026-11-04"))
    _w(os.path.join(t, "2026-11-04", "RUN.json"), json.dumps({"record_sha256": "aa" * 32, "admission_sha256": "bb" * 32, "execution_sha256": "cc" * 32}))
    write_index(t)
    ix = json.load(open(os.path.join(t, "index.json")))
    assert ix["first_day"] == "2026-11-04" and ix["days"]["2026-11-04"]["settled"] is False and ix["contract_sha256"] == CONTRACT_SHA256
    _w(os.path.join(t, "2026-11-04", "SETTLED.json"), json.dumps({"settle": "v1.19", "verdict": "within_grant", "status": "final", "settlement_sha256": "dd" * 32}))
    write_index(t)
    ix = json.load(open(os.path.join(t, "index.json")))
    assert ix["days"]["2026-11-04"]["verdict"] == "within_grant" and ix["days"]["2026-11-04"]["status"] == "final"
    n += 1; print("[5] index.json names the first day and, per day, the records and the settlement once there is one")
    print("\nSELF-TEST PASSED: check_loop, %d checks" % n)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", nargs="?", choices=["file", "settle", "index"])
    ap.add_argument("--root", default=os.path.join(HERE, "check-runs"))
    ap.add_argument("--date", default=HB.responsible_day(datetime.datetime.now(datetime.timezone.utc)))
    ap.add_argument("--view-chunks", default=os.path.join(HERE, "check-view-chunks"))
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        _selftest(); return 0
    if a.cmd == "file":
        rc = file_day(a.root, a.date); write_index(a.root); return rc
    if a.cmd == "settle":
        rc = settle(a.root, a.view_chunks); write_index(a.root); return rc
    if a.cmd == "index":
        write_index(a.root); return 0
    ap.print_help(); return 1


if __name__ == "__main__":
    sys.exit(main())
