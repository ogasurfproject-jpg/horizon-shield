"""nenrin-verify furui-day and resume-admission (0.8.0, exact closed strings in 0.8.1): the shared vectors, the CLI's usage and exit codes, the
vectors file is what its generator writes, and the JavaScript twin gives the same answer on the vectors and on
mutations of them (skipped when node is not on PATH). --bitcoin-header (next version): its own vectors
(bitcoin_header_vectors.json, Python and JavaScript only), the explorers are asked only with the flag, the host guard,
and the JavaScript twin on those vectors and on mutations of them. No test goes to the network."""
import base64
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile

import pytest

from nenrin_verify import furui_day as F
from nenrin_verify import cli

HERE = os.path.dirname(os.path.abspath(__file__))
NENRIN = os.path.normpath(os.path.join(HERE, "..", ".."))
VECTORS = os.path.join(NENRIN, "furui-check-day-v0", "verify_vectors.json")
BH_VECTORS = os.path.join(NENRIN, "furui-check-day-v0", "bitcoin_header_vectors.json")
JS = os.path.join(NENRIN, "sdk", "furui_day.mjs")
NODE = shutil.which("node")


def _doc():
    with open(VECTORS, "rb") as f:
        return F.parse_json(f.read())


def test_vectors_all_agree():
    out = io.StringIO()
    assert F.run_vectors(VECTORS, out) == 0, out.getvalue()
    assert out.getvalue().strip().endswith("furui vectors give the expected verdict (python)")


def test_vectors_cover_every_step_and_the_resume():
    doc = _doc()
    fails = {(c["command"], s[0]) for c in doc["cases"] if c["command"] != "ots-parse" for s in c["expect"]["steps"] if s[1] == "fail"}
    for n in range(1, 7):
        assert ("furui-day", n) in fails
    for n in range(1, 6):
        assert ("resume-admission", n) in fails
    verdicts = {(c["command"], c["expect"].get("verdict")) for c in doc["cases"]}
    assert ("furui-day", "ok") in verdicts and ("furui-day", "not_yet") in verdicts
    assert ("resume-admission", "ok") in verdicts and ("resume-admission", "not_yet") in verdicts


def test_generator_writes_the_same_file():
    gen = os.path.join(NENRIN, "furui-check-day-v0", "make_verify_vectors.py")
    r = subprocess.run([sys.executable, "-I", gen, "--check"], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


@pytest.mark.parametrize("argv", [[], ["furui-day"], ["furui-day", "2026-11-31", "--leaf", "0"], ["furui-day", "2026-11-03", "--leaf", "-1"],
                                  ["furui-day", "2026-11-03", "--leaf", "01"], ["furui-day", "2026-11-03", "0"],
                                  ["resume-admission", "http://example.org/", "a" * 64], ["resume-admission", "https://example.org/", "A" * 64],
                                  # 0.8.1: nothing after the value, and ASCII digits only (re.match with "$" passed a trailing "\n")
                                  ["furui-day", "2026-11-03\n", "--leaf", "0"], ["furui-day", "\uff12\uff10\uff12\uff16-11-03", "--leaf", "0"],
                                  ["furui-day", "2026-11-03", "--leaf", "0\n"], ["furui-day", "2026-11-03", "--leaf", "\u0663"],
                                  ["resume-admission", "https://example.org/", "a" * 64 + "\n"], ["resume-admission", "https://example.org/\n", "a" * 64]])
def test_usage_exit_2(argv, capsys):
    if not argv:
        return
    assert cli.main(argv) == 2


def test_exactly_64_lowercase_hex():
    for v in ["0" * 64 + "\n", "0" * 64 + "\r", "0" * 64 + " ", "\n" + "0" * 64, "0" * 63, "0" * 65, "A" * 64, "\uff10" * 64]:
        assert not F.H64.fullmatch(v), repr(v)
    assert F.H64.fullmatch("0123456789abcdef" * 4)
    for v in ["2026-11-03\n", "\uff12\uff10\uff12\uff16-11-03", "2026-11-31"]:
        assert not F._real_day(v), repr(v)
    assert F._b64("A" * 86 + "==\n", 64) is None


def test_no_other_host(monkeypatch):
    with pytest.raises(F.NetError):
        F.http_get("https://example.org/furui/day/2026-11-03/leaf/0")
    with pytest.raises(F.NetError):
        F.http_get("http://ledger.horizonshield.dev/ledger/1")
    with pytest.raises(F.NetError):
        F.http_get("https://ledger.horizonshield.dev:8443/ledger/1")


def test_world_is_the_only_input():
    seen = []
    doc = _doc()
    c = next(x for x in doc["cases"] if x["command"] == "furui-day" and x["expect"]["verdict"] == "ok")
    g = F.world_get(c["world"])

    def get(url):
        seen.append(url)
        return g(url)
    F.furui_day(c["args"]["day"], c["args"]["leaf"], get)
    assert seen and all(u.startswith(F.LEDGER + "/") or u.startswith(F.FURUI + "/") for u in seen)


def test_ots_parser_real_proof():
    doc = _doc()
    c = next(x for x in doc["cases"] if x["command"] == "ots-parse")
    d, btc, pend = F.ots_parse(base64.b64decode(c["args"]["body_b64"]))
    assert btc == [(970879, "b321a85fbd104dfbfb3a96e9cbbbd96ca1039afc95e2ec7079b21a5f170822c9")]


def _node_lines(path):
    r = subprocess.run([NODE, os.path.join(HERE, "parity", "furui_runner.mjs"), JS, path], capture_output=True, text=True, timeout=600)
    assert r.returncode == 0, r.stderr
    return r.stdout.splitlines()


def _py_lines(path):
    with open(path, "rb") as f:
        doc = F.parse_json(f.read())
    out = []
    for c in doc["cases"]:
        out.append(F.canonical(F.case_answer(c)))
    return out


@pytest.mark.skipif(NODE is None, reason="node is not on PATH")
def test_javascript_twin_on_the_vectors():
    assert _node_lines(VECTORS) == _py_lines(VECTORS)


@pytest.mark.skipif(NODE is None, reason="node is not on PATH")
def test_javascript_twin_on_mutations():
    d = tempfile.mkdtemp()
    try:
        m = os.path.join(d, "mutations.json")
        r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "parity", "mutate_furui.py"), VECTORS, m, "--per-body", "6"], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        py, js = _py_lines(m), _node_lines(m)
        assert len(py) == len(js) > 1000
        diff = [i for i, (a, b) in enumerate(zip(py, js)) if a != b]
        assert not diff, "%d of %d differ, first: %s | %s" % (len(diff), len(py), py[diff[0]], js[diff[0]])
    finally:
        shutil.rmtree(d)


# ---- --bitcoin-header ----
def _bh_doc():
    with open(BH_VECTORS, "rb") as f:
        return F.parse_json(f.read())


def test_bitcoin_header_vectors_all_agree():
    out = io.StringIO()
    assert F.run_vectors(BH_VECTORS, out) == 0, out.getvalue()
    assert out.getvalue().strip().endswith("24/24 furui vectors give the expected verdict (python)")


def test_bitcoin_header_generator_writes_the_same_file():
    gen = os.path.join(NENRIN, "furui-check-day-v0", "make_bitcoin_header_vectors.py")
    r = subprocess.run([sys.executable, "-I", "-B", gen, "--check"], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_bitcoin_header_vectors_cover_every_code():
    doc = _bh_doc()
    codes = set()
    for c in doc["cases"]:
        e = c["expect"]
        codes.add(e["code"] if c["command"] == "bitcoin-header" else next((x[2] for x in e["steps"] if x[1] in ("fail", "not_yet")), None))
    for k in ("header_merkle_root_is_not_the_proof", "explorers_serve_different_headers", "explorers_name_different_blocks",
              "header_hash_is_not_the_named_block", "header_hash_above_its_target", "header_bits_shape", "mempool_hash_shape",
              "mempool_header_shape", "blockstream_header_shape", "mempool_height_http_404", "blockstream_header_http_503", None):
        assert k in codes, k
    verdicts = {(c["command"], c["expect"].get("verdict")) for c in doc["cases"]}
    for v in (("furui-day", "ok"), ("furui-day", "fail"), ("furui-day", "not_yet"), ("resume-admission", "ok"), ("resume-admission", "fail")):
        assert v in verdicts, v


def test_the_real_header_is_the_block_of_the_real_proof():
    """the recorded header of block 970879 holds the merkle root the real proof of ledger entry 80 commits to"""
    doc, bh = _doc(), _bh_doc()
    real = next(x for x in doc["cases"] if x["command"] == "ots-parse")["expect"]["bitcoin"]
    ok = next(c for c in bh["cases"] if c["command"] == "bitcoin-header" and c["expect"]["state"] == "ok")
    assert [ok["args"]["height"], ok["args"]["merkle_root"]] == real[0]
    hx = ok["expect"]["facts"]["header"]
    assert F.sha256d(bytes.fromhex(hx))[::-1].hex() == ok["expect"]["facts"]["block_hash"] == "000000000000000000005f12b1e66ebb0dea2224e0b567ab6a099aeae3fd93ba"


def _no_explorer(url):
    raise AssertionError("an explorer was asked without --bitcoin-header: " + url)


def test_without_the_flag_no_explorer_is_asked_and_nothing_changes():
    for c in _doc()["cases"] + _bh_doc()["cases"]:
        if c["command"] not in ("furui-day", "resume-admission"):
            continue
        a, g = c["args"], F.world_get(c["world"])
        if c["command"] == "furui-day":
            plain = F.summary(F.furui_day(a["day"], a["leaf"], g, header_get=_no_explorer, runner=a.get("runner", 1)))
        else:
            plain = F.summary(F.resume_admission(a["endpoint"], a["record_sha256"], g, header_get=_no_explorer))
        assert "bitcoin_header" not in plain["facts"]
        if a.get("bitcoin_header") is True:
            e = c["expect"]
            assert plain["steps"] == e["steps"][:-1]
            assert plain["facts"] == {k: v for k, v in e["facts"].items() if k != "bitcoin_header"}
            before = [x[1] for x in e["steps"][:-1]]
            assert plain["verdict"] == ("fail" if "fail" in before else "not_yet" if "not_yet" in before else "ok")
        else:
            assert plain == c["expect"]


def test_with_the_flag_only_the_height_and_the_hash_go_to_the_explorers():
    c = next(x for x in _bh_doc()["cases"] if x["command"] == "furui-day" and x["expect"]["verdict"] == "ok")
    seen, g = [], F.world_get(c["world"])

    def hg(url):
        seen.append(url)
        return g(url)
    r = F.furui_day(c["args"]["day"], c["args"]["leaf"], g, bitcoin_header=True, header_get=hg)
    h, bh = r["facts"]["bitcoin_block"], r["facts"]["bitcoin_header"]["block_hash"]
    assert r["verdict"] == "ok" and [x["name"] for x in r["steps"]][-1] == "bitcoin_header"
    assert seen == ["https://mempool.space/api/block-height/%d" % h, "https://mempool.space/api/block/%s/header" % bh,
                    "https://blockstream.info/api/block-height/%d" % h, "https://blockstream.info/api/block/%s/header" % bh]


def test_explorer_host_guard():
    for u in ("https://ledger.horizonshield.dev/ledger/1", "http://mempool.space/api/block-height/1", "https://mempool.space:8443/api/block-height/1",
              "https://example.org/api/block-height/1", "https://mempool.space.example.org/api/block-height/1", "https://[::1/x"):
        with pytest.raises(F.NetError):
            F.http_get_explorer(u)
    for u in ("https://mempool.space/api/block-height/1", "https://blockstream.info/api/block-height/1"):
        with pytest.raises(F.NetError):
            F.http_get(u)


@pytest.mark.parametrize("argv", [["furui-day", "2026-11-03", "--leaf", "0", "--bitcoin-header", "--bitcoin-header"],
                                  ["furui-day", "--bitcoin-header"], ["furui-vectors", BH_VECTORS, "--bitcoin-header"],
                                  ["resume-admission", "https://example.org/", "a" * 64, "--bitcoin-headers"],
                                  ["resume-admission", "https://example.org/", "--bitcoin-header"]])
def test_flag_usage_exit_2(argv):
    assert cli.main(argv) == 2


def test_flag_reaches_both_commands_wherever_it_stands(monkeypatch, capsys):
    seen = []

    def fake(name):
        def f(*a, **k):
            seen.append((name, a, k.get("bitcoin_header")))
            return {"verdict": "ok"}
        return f
    monkeypatch.setattr(F, "furui_day", fake("day"))
    monkeypatch.setattr(F, "resume_admission", fake("resume"))
    assert cli.main(["furui-day", "2026-11-03", "--bitcoin-header", "--leaf", "0"]) == 0
    assert cli.main(["furui-day", "2026-11-03", "--leaf", "0"]) == 0
    assert cli.main(["resume-admission", "--bitcoin-header", "https://example.org/", "a" * 64]) == 0
    assert seen == [("day", ("2026-11-03", 0), True), ("day", ("2026-11-03", 0), False), ("resume", ("https://example.org/", "a" * 64), True)]


@pytest.mark.skipif(NODE is None, reason="node is not on PATH")
def test_javascript_twin_on_the_bitcoin_header_vectors():
    assert _node_lines(BH_VECTORS) == _py_lines(BH_VECTORS)


@pytest.mark.skipif(NODE is None, reason="node is not on PATH")
def test_javascript_twin_on_bitcoin_header_mutations():
    d = tempfile.mkdtemp()
    try:
        m = os.path.join(d, "mutations.json")
        r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "parity", "mutate_furui.py"), BH_VECTORS, m, "--per-body", "6"], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        py, js = _py_lines(m), _node_lines(m)
        assert len(py) == len(js) > 900
        diff = [i for i, (a, b) in enumerate(zip(py, js)) if a != b]
        assert not diff, "%d of %d differ, first: %s | %s" % (len(diff), len(py), py[diff[0]], js[diff[0]])
    finally:
        shutil.rmtree(d)


def test_runner_option():
    """--runner 2 reads runner-2's day tree (/furui2/day/) with key_id and runner_id runner-2; the default and --runner 1
    give runner-1's answer, with args as before; anything else is a usage error"""
    doc = _doc()
    c2 = next(x for x in doc["cases"] if x["args"].get("runner") == 2 and x["expect"]["verdict"] == "ok")
    seen = []
    g = F.world_get(c2["world"])

    def get(url):
        seen.append(url)
        return g(url)
    r = F.furui_day(c2["args"]["day"], c2["args"]["leaf"], get, runner=2)
    assert r["verdict"] == "ok" and r["args"] == {"day": c2["args"]["day"], "leaf": c2["args"]["leaf"], "runner": 2}
    assert any("/furui2/day/" in u for u in seen) and not any("/furui/day/" in u for u in seen)
    c1 = next(x for x in doc["cases"] if x["command"] == "furui-day" and "runner" not in x["args"] and x["expect"]["verdict"] == "ok")
    r1 = F.furui_day(c1["args"]["day"], c1["args"]["leaf"], F.world_get(c1["world"]))
    assert r1["args"] == {"day": c1["args"]["day"], "leaf": c1["args"]["leaf"]}
    assert F.summary(r1) == F.summary(F.furui_day(c1["args"]["day"], c1["args"]["leaf"], F.world_get(c1["world"]), runner=1))
    for bad in (["furui-day", "2026-11-03", "--leaf", "1", "--runner", "3"], ["furui-day", "2026-11-03", "--leaf", "1", "--runner"],
                ["furui-day", "2026-11-03", "--leaf", "1", "--runner", "2", "--runner", "2"], ["resume-admission", "https://a.example/", "a" * 64, "--runner", "2"]):
        assert F.main(bad) == 2, bad
