"""nenrin-verify tasuki: the walk of two paid calls replayed from the public answers frozen when they were walked
(fixtures/tasuki_real_20261108.json; the view chunks are read from seki-heartbeat/view-chunks of this checkout, which
are written once and never rewritten), the state each link takes when one answer is changed, settle->recompute on the
settled day 2026-11-04 from the repository's own files, and the CLI's usage. No test goes to the network: every GET is
answered by a function here."""
import base64
import datetime
import hashlib
import io
import json
import os
import sys

import pytest

from nenrin_verify import cli
from nenrin_verify import furui_day as F
from nenrin_verify import tasuki as T

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", "..", "..", "..", ".."))
HEARTBEAT = os.path.join(REPO, "workers", "hs-ledger", "nenrin", "seki-heartbeat")
IN_REPO = os.path.isdir(os.path.join(HEARTBEAT, "view-chunks"))
FIX = os.path.join(HERE, "fixtures", "tasuki_real_20261108.json")
with open(FIX, encoding="utf-8") as _f:
    REAL = json.load(_f)
NOW = T._when(REAL["captured_at"])
R1107 = "44ee1e0206c2e26ab3d7fb805b5d5bff4d476959e71e1a290079eec955398097"   # 11-07 07:13 UTC, the heartbeat's report call
R1106 = "05190272dead70a220af89a22c828897b386a10f1a7453483a3b2cbef863c5ed"   # 11-06 21:18 UTC, the heartbeat's report call
NOT_FOUND = (404, b'{"error":"not_found"}')


def body(a):
    if "repo_file" in a:
        with open(os.path.join(REPO, a["repo_file"]), "rb") as f:
            b = f.read()
        assert hashlib.sha256(b).hexdigest() == a["sha256"], a["repo_file"]
        return b
    return base64.b64decode(a["body_b64"]) if "body_b64" in a else a["body"].encode("utf-8")


def world(over=None, strict=False):
    """the frozen answers, with over: {url: (status, bytes) or None for 404}; strict: an URL not frozen fails the test"""
    over = over or {}

    def get(url):
        if url in over:
            return NOT_FOUND if over[url] is None else over[url]
        a = REAL["answers"].get(url)
        if a is None:
            assert not strict, "the walk asked an URL that was not asked when it was frozen: " + url
            return NOT_FOUND
        return a["status"], body(a)
    return get


def states(res):
    return {x["link"]: x["state"] for x in res["links"]}


def link(res, name):
    return [x for x in res["links"] if x["link"] == name][0]


def answer_json(url):
    return json.loads(body(REAL["answers"][url]))


needs_repo = pytest.mark.skipif(not IN_REPO, reason="outside the repository (the view chunks are read from the checkout)")


@needs_repo
@pytest.mark.parametrize("sha", [R1107, R1106])
def test_replay_gives_the_frozen_walk(sha):
    got = T.walk(sha, world(strict=True), NOW)
    assert json.dumps(got, sort_keys=True) == json.dumps(REAL["results"][sha], sort_keys=True)


@needs_repo
def test_every_url_frozen_is_one_the_walks_ask():
    asked = set()

    def rec(url):
        asked.add(url)
        return world(strict=True)(url)
    for sha in (R1107, R1106):
        T.walk(sha, rec, NOW)
    assert asked == set(REAL["answers"])


def test_link_list_is_closed_and_in_order():
    res = T.walk(R1107, world(), NOW)
    assert [x["link"] for x in res["links"]] == T.LINKS
    assert len(T.LINKS) == 11 and len(set(T.LINKS)) == 11
    assert all(x["state"] in ("holds", "missing", "not_yet") for x in res["links"])
    assert res["does_not_establish"] == T.DOES_NOT_ESTABLISH and res["schema"] == "nenrin-tasuki-walk-v0"


def test_1107_admission_names_the_execution():
    res = T.walk(R1107, world(), NOW)
    assert link(res, "adm->exec")["state"] == "holds"
    assert link(res, "exec->result")["state"] == "holds"
    assert res["facts"]["admission"]["verdict"] == "accepted"
    # the ledger's key (the record's bytes) and the digest an execution names (the signed bytes) are two digests
    assert res["facts"]["admission_sha256"] == "7db1b3bee422c1795713d9121c2323f81cef1ffc8e6bddeeff6f4e30c7804ad1"
    assert res["facts"]["admission_sha256"] != R1107


def test_1106_report_has_no_content_check():
    res = T.walk(R1106, world(), NOW)
    s = states(res)
    assert s["adm->check"] == "missing" and "content" in link(res, "adm->check")["why"]
    for k in ("check->day", "day->entry", "day->witness"):
        assert link(res, k)["follows"] is not None
    assert "adm->check" in res["causes"] and "check->day" not in res["causes"]
    assert s["adm->exec"] == "holds" and s["exec->result"] == "holds"


def test_before_the_day_closes_the_check_is_not_yet():
    t = T._when(REAL["results"][R1107]["facts"]["submitted_at"])
    early = t.replace(hour=23, minute=59)
    res = T.walk(R1107, world(), early)
    assert link(res, "adm->check")["state"] == "not_yet"
    assert link(res, "check->day")["follows"] == "adm->check"


def test_another_key_at_key_url_refuses_the_admission():
    res0 = T.walk(R1107, world(), NOW)
    ku = res0["facts"]["admission"]["key_url"]
    other = base64.b64encode(hashlib.sha256(b"another key").digest()).decode()
    res = T.walk(R1107, world({ku: (200, json.dumps({"public_key_ed25519_b64": other}).encode())}), NOW)
    for k in ("adm->check", "adm->entry", "adm->exec"):
        assert link(res, k)["state"] == "missing" and "bad_signature" in link(res, k)["why"]
    assert res["verdict"] == "missing"


def test_ledger_bytes_that_do_not_hash_make_every_link_missing():
    u = T.LEDGER + "/admission/" + R1107
    a = answer_json(u)
    a["record_canonical"] = a["record_canonical"].replace('"decision":"admit"', '"decision":"admit" ', 1)
    res = T.walk(R1107, world({u: (200, json.dumps(a).encode())}), NOW)
    assert all(x["state"] == "missing" for x in res["links"])
    assert sorted(res["causes"]) == ["adm->check", "adm->entry", "adm->exec"]


@pytest.mark.parametrize("sha", [R1107, R1106])
def test_execution_bytes_changed_is_missing(sha):
    xs = link(REAL["results"][sha], "adm->exec")["digests"]["execution_sha256"]
    u = T.AGREEMENT + "/execution/" + xs
    res = T.walk(sha, world({u: (200, body(REAL["answers"][u]) + b" ")}), NOW)
    assert link(res, "adm->exec")["state"] == "missing" and "hash" in link(res, "adm->exec")["why"]


@pytest.mark.parametrize("sha", [R1107, R1106])
def test_execution_not_served_is_missing(sha):
    res0 = T.walk(sha, world(), NOW)
    xs = link(res0, "adm->exec")["digests"]["execution_sha256"]
    res = T.walk(sha, world({T.AGREEMENT + "/execution/" + xs: None}), NOW)
    assert link(res, "adm->exec")["state"] == "missing"
    for k in ("exec->result", "exec->entry", "exec->settle", "settle->recompute"):
        assert link(res, k)["state"] == "missing" and link(res, k)["follows"] is not None


@pytest.mark.parametrize("sha", [R1107, R1106])
def test_nenrin_ref_that_is_not_the_report_is_missing(sha):
    res0 = T.walk(sha, world(), NOW)
    d = link(res0, "adm->exec")["digests"]["run_day"]
    u = T.RAW_RUNS + d + "/RUN.json"
    r = answer_json(u)
    for k in r["calls"]:
        if k.get("record_sha256") == sha:
            k["report_sha256"] = "00" * 32
    res = T.walk(sha, world({u: (200, json.dumps(r).encode())}), NOW)
    assert link(res, "exec->result")["state"] == "missing"
    assert link(res, "adm->exec")["state"] == "holds"


def test_admission_pending_at_the_ledger_is_not_yet():
    u = T.LEDGER + "/admission/" + R1107
    a = answer_json(u)
    a.update(status="pending_anchor", ledger_entry=None)
    res = T.walk(R1107, world({u: (200, json.dumps(a).encode())}), NOW)
    assert link(res, "adm->entry")["state"] == "not_yet"


def test_no_settlement_yet_is_not_yet_and_a_changed_settlement_is_missing():
    res = T.walk(R1107, world(), NOW)
    assert link(res, "exec->settle")["state"] in ("not_yet", "holds")
    res6 = T.walk(R1106, world(), NOW)
    if link(res6, "exec->settle")["state"] == "holds":
        u = T.RAW_RUNS + "2026-11-06/settlement.json"
        res = T.walk(R1106, world({u: (200, body(REAL["answers"][u]) + b"\n")}), NOW)
        assert link(res, "exec->settle")["state"] == "missing"
        assert link(res, "settle->recompute")["follows"] == "exec->settle"
        res = T.walk(R1106, world({T.RAW_RUNS + "2026-11-06/SETTLED.json": None}), NOW)
        assert link(res, "exec->settle")["state"] == "not_yet"


def test_an_unconfirmed_entry_is_not_yet_at_entry_ots():
    res0 = T.walk(R1106, world(), NOW)
    es = link(res0, "entry->ots")["digests"].get("entries") or []
    held = [e for e in es if e["state"] == "holds"]
    if not held:
        pytest.skip("no entry of the frozen walk was confirmed")
    n = held[0]["entry"]
    u = T.LEDGER + "/ledger/%d?format=json" % n
    e = answer_json(u)
    e["ots_status"] = "pending"
    res = T.walk(R1106, world({u: (200, json.dumps(e).encode())}), NOW)
    assert link(res, "entry->ots")["state"] == "not_yet"


def test_a_proof_for_other_bytes_is_missing_at_entry_ots():
    res0 = T.walk(R1106, world(), NOW)
    es = [e for e in (link(res0, "entry->ots")["digests"].get("entries") or []) if e["state"] == "holds"]
    if not es:
        pytest.skip("no entry of the frozen walk was confirmed")
    u = T.LEDGER + "/ledger/%d/ots" % es[0]["entry"]
    b = bytearray(body(REAL["answers"][u]))
    i = len(F.OTS_MAGIC) + 2
    b[i] ^= 1                               # one bit of the stamped digest
    res = T.walk(R1106, world({u: (200, bytes(b))}), NOW)
    assert link(res, "entry->ots")["state"] == "missing"


# ---- settle->recompute on 2026-11-04, the repository's own files (no ledger needed for these two links) ----
def repo_get(over=None):
    over = over or {}

    def get(url):
        if url in over:
            return NOT_FOUND if over[url] is None else over[url]
        if url.startswith(T.RAW):
            p = os.path.join(REPO, url[len(T.RAW):])
            if os.path.isfile(p):
                with open(p, "rb") as f:
                    return 200, f.read()
        return NOT_FOUND
    return get


def settle_1104(over=None):
    with open(os.path.join(HEARTBEAT, "runs", "2026-11-04", "RUN.json"), encoding="utf-8") as f:
        r = json.load(f)
    with open(os.path.join(REPO, "keys", "seki-door.json"), encoding="utf-8") as f:
        pub = json.load(f)["public_key_ed25519_b64"]
    call = [k for k in r["calls"] if k.get("service") == "report"][0]
    W = T._Walk(repo_get(over), NOW)
    W.put("adm->exec", "holds", "given")
    T._settle(W, "2026-11-04", r, call, call["execution_sha256"], call["admission_sha256"], "shield.the-horizons-innovation.com", pub)
    return W.links


@needs_repo
def test_1104_settles_again_to_the_same_bytes():
    ls = settle_1104()
    assert ls["exec->settle"]["state"] == "holds"
    assert ls["settle->recompute"]["state"] == "holds"
    d = ls["settle->recompute"]["digests"]
    assert d["recomputed_sha256"] == ls["exec->settle"]["digests"]["settlement_sha256"]
    assert d["v1_20_same_verdict_status_deviations"] is True


@needs_repo
def test_1104_a_changed_anchored_admit_does_not_settle_to_the_bytes():
    u = T.RAW_RUNS + "2026-11-04/admission_report.anchored.json"
    with open(os.path.join(REPO, u[len(T.RAW):]), encoding="utf-8") as f:
        a = json.load(f)
    a["admission_id"] = "00" * 16                # the admit's signed bytes change, so its signature no longer verifies
    ls = settle_1104({u: (200, json.dumps(a, sort_keys=True, separators=(",", ":")).encode())})
    assert ls["settle->recompute"]["state"] == "missing"


@needs_repo
def test_1104_a_view_chunk_not_written_is_not_yet_and_an_unknown_settle_is_missing():
    last = sorted(x for x in os.listdir(os.path.join(HEARTBEAT, "view-chunks")) if x.endswith(".json"))[-1]
    ls = settle_1104({T.RAW_CHUNKS + last: None})
    assert ls["settle->recompute"]["state"] == "not_yet"
    u = T.RAW_RUNS + "2026-11-04/SETTLED.json"
    with open(os.path.join(REPO, u[len(T.RAW):]), encoding="utf-8") as f:
        s = json.load(f)
    s["settle"] = "v1.99 (a version this package does not carry)"
    ls = settle_1104({u: (200, json.dumps(s).encode())})
    assert ls["settle->recompute"]["state"] == "missing"


# ---- the CLI and the GET ----
@pytest.mark.parametrize("argv", [["tasuki"], ["tasuki", "A" * 64], ["tasuki", "a" * 63], ["tasuki", "a" * 64 + "\n"],
                                  ["tasuki", "a" * 64, "--now"], ["tasuki", "a" * 64, "--now", "2026-11-08"], ["tasuki", "a" * 64, "x"]])
def test_usage_exits_2(argv, capsys):
    assert cli.main(argv) == 2
    assert "usage: nenrin-verify tasuki" in capsys.readouterr().err


def test_cli_exit_codes(monkeypatch, capsys):
    def fake(sha, get=None, now=None):
        return {"verdict": verdict, "links": []}
    for verdict, code in (("holds", 0), ("missing", 1), ("not_yet", 3)):
        monkeypatch.setattr(T, "walk", fake)
        assert cli.main(["tasuki", "a" * 64, "--now", "2026-11-08T01:00:00Z"]) == code
        capsys.readouterr()


def test_fetcher_refuses_other_hosts_and_other_repositories_before_any_connection():
    f = T.Fetcher()
    for u in ("https://example.org/x", "http://ledger.horizonshield.dev/ledger/head", "https://ledger.horizonshield.dev:8443/ledger/head",
              "https://raw.githubusercontent.com/someone/else/main/x.json", "https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/dev/x.json"):
        with pytest.raises(F.NetError):
            f(u)
    f.allow("shield.the-horizons-innovation.com")
    assert "shield.the-horizons-innovation.com" in f.hosts


def test_leaves_holding_day_open_and_empty():
    d = "2026-11-07"
    base = T.FURUI + "/furui/day/" + d
    open_ = {base + "/leaf/0": (404, b'{"error":"day_open"}'), base + "/status": (200, json.dumps({"day": d, "status": {"state": "open"}}).encode())}
    assert T.leaves_holding(lambda u: open_.get(u, NOT_FOUND), d, "ab" * 32)[0] == "not_yet"
    empty = dict(open_, **{base + "/status": (200, json.dumps({"day": d, "status": {"state": "empty"}}).encode())})
    assert T.leaves_holding(lambda u: empty.get(u, NOT_FOUND), d, "ab" * 32) == ("read", "the day closed empty", [])
