"""0.7.0: settle core v0 and the #51 set 2 settlement recompute from the installed package, with no clone."""
import importlib.util

import pytest

from nenrin_verify import musubi


def test_settle_core_128_of_128():
    r = musubi.settle_core()
    assert r["ok"], r
    assert r["vectors"].startswith("128/128") and r["v1_17"].split(" ")[0] == "13/13" and r["v1_18"].split(" ")[0] == "14/14"
    assert musubi.main(["--settle-core"]) == 0


@pytest.mark.skipif(importlib.util.find_spec("ca2a_runtime") is None, reason="needs nenrin-verify[ca2a]")
def test_pilot51_set2_recomputes():
    r = musubi.pilot51_set2()
    assert r["ok"], r
    assert musubi.main(["--pilot51-set2"]) == 0


@pytest.mark.skipif(importlib.util.find_spec("ca2a_runtime") is not None, reason="ca2a-runtime is installed")
def test_pilot51_set2_says_what_is_missing():
    assert musubi.main(["--pilot51-set2"]) == 3
