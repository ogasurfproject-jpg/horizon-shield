"""MUSUBI in the package is the repository's MUSUBI: the files byte for byte (test_vendored.py, tools/vendor.py),
every module's own self-test passing from the installed copy, the first settled contract execution (run0002)
recomputing to the hashes its README publishes, and the library entry point importing the same modules.

MUSUBI has no JavaScript twin; the Python in musubi-v0 is the reference, so there is no second report to agree with.
What these tests guard is that installing the package changes nothing about how MUSUBI runs."""
import io
import json
import os

import pytest

from nenrin_verify import musubi


@pytest.mark.parametrize("name", musubi.modules())
def test_module_selftest_passes_from_the_package(name):
    p = musubi.run(name, ["--selftest"], capture_output=True, text=True, timeout=900)
    last = (p.stdout.strip().splitlines() or [""])[-1]
    assert p.returncode == 0 and ("PASSED" in last or "ALL PASS" in last), (p.stdout[-800:], p.stderr[-800:])


def test_run0002_recomputes_to_the_published_hashes():
    r = musubi.recompute_run0002()
    assert r["ok"], r


def test_shipped_modules():
    assert musubi.modules() == sorted([
        "admission_verify_v0", "anchor_compose", "bond_v0", "clause_eval_v0", "contract_v0", "convergence_v0", "correction_bundle_v0", "correction_v0",
        "approval_v3", "corroboration_v0", "immune_v0", "independence_v0", "offer_v0", "settle_v1", "settle_v1_1", "settle_v1_10", "settle_v1_11", "settle_v1_12",
        "settle_v1_13", "settle_v1_14", "settle_v1_15", "settle_v1_16", "settle_v1_17", "settle_v1_18", "settle_v1_19", "settle_v1_2", "settle_v1_20", "requirements_furui_v0",
        "settle_v1_3", "settle_v1_4", "settle_v1_5", "settle_v1_6", "settle_v1_7", "settle_v1_8", "settle_v1_9",
        "spine_verify", "terms_v0"])


def test_load_gives_the_repository_module():
    v0 = musubi.load("contract_v0")
    assert os.path.dirname(os.path.abspath(v0.__file__)) == os.path.abspath(musubi.MUSUBI_DIR)
    rec = v0.parse_strict(open(os.path.join(musubi.MUSUBI_DIR, "second_contract_AB.json"), encoding="utf-8").read())
    rep = v0.verify_contract(rec)
    assert rep["verdict"] == "accepted", json.dumps(rep)[:600]
    cor = musubi.load("correction_v0")
    pins = json.load(open(os.path.join(os.path.dirname(musubi.ROOT), "VENDORED.json")))
    fp = cor.code_fingerprint()
    assert all(fp[f] == pins["_repo/musubi-v0/" + f]["source_sha256"] for f in fp)


def test_cli():
    assert musubi.main(["--list"]) == 0
    assert musubi.main(["no_such_module"]) == 2
    assert musubi.main([]) == 2


def test_selftest_all_reuses_lower_layers_and_still_passes():
    buf = io.StringIO()
    assert musubi.selftest_all(out=buf), buf.getvalue()
    text = buf.getvalue()
    assert "nested self-tests answered with a result that passed earlier in this run" in text, text[-400:]


def test_layer_order_puts_nested_layers_first():
    order = musubi._layer_order(musubi.modules())
    assert order.index("settle_v1_8") < order.index("settle_v1_9") < order.index("settle_v1_10")
    assert order.index("convergence_v0") < order.index("settle_v1_9")
