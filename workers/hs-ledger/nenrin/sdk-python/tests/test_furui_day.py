"""nenrin-verify furui-day and resume-admission (0.8.0): the shared vectors, the CLI's usage and exit codes, the
vectors file is what its generator writes, and the JavaScript twin gives the same answer on the vectors and on
mutations of them (skipped when node is not on PATH)."""
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
                                  ["resume-admission", "http://example.org/", "a" * 64], ["resume-admission", "https://example.org/", "A" * 64]])
def test_usage_exit_2(argv, capsys):
    if not argv:
        return
    assert cli.main(argv) == 2


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
        if c["command"] == "ots-parse":
            try:
                d, btc, pend = F.ots_parse(base64.b64decode(c["args"]["body_b64"]))
                got = {"digest": d.hex(), "bitcoin": [[x, m] for (x, m) in btc], "pending": pend}
            except F._Bad as e:
                got = {"error": str(e)}
        else:
            got = F.summary(F.run_case(c))
        out.append(F.canonical(got))
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
