"""The packaged agreement verifier and its JavaScript twin on inputs the frozen reports do not hold (0.8.1).

agreed_at with fullwidth or Arabic-Indic digits was accepted by Python's \\d and refused by JavaScript; a non-ASCII
space between "paid" and "for this record", and inside the host of an https URL, was read with two different \\s
(Python's takes \\x85 and not \\ufeff, JavaScript's the other way round). Each case starts from an accepted frozen record
and changes one string; the records are not signed again, so signature_invalid is in every report. The full reports of
the two verifiers must be the same, and both must refuse the digits with bad_agreed_at. Skipped outside the
repository; the JavaScript half is skipped when node is not on PATH.
"""
import base64
import copy
import json
import os
import shutil
import subprocess
import zlib

import pytest

from nenrin_verify import agreement_verify as AV

HERE = os.path.dirname(os.path.abspath(__file__))
AGR = os.path.normpath(os.path.join(HERE, "..", "..", "agreement-v0"))
FIXTURE = os.path.join(AGR, "agreement_vectors_v1.json")
pytestmark = pytest.mark.skipif(not os.path.exists(FIXTURE), reason="needs the repository's agreement-v0 fixture")


def _canon(o):
    return json.dumps(o, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def _cases():
    env = json.load(open(FIXTURE, encoding="utf-8"))
    doc = AV.parse_strict(zlib.decompress(base64.b64decode(env["payload"])).decode("utf-8"))
    base = next(c for c in doc["cases"] if c["report"].get("verdict") == "accepted" and isinstance(c["input"]["record"], dict)
                and "agreed_at" in c["input"]["record"] and c["input"]["record"].get("establishes")
                and "agent_card" in c["input"]["record"]["parties"][0])
    r = base["input"]["record"]
    at = r["agreed_at"]
    out = [("agreed_at in fullwidth digits", dict(r, agreed_at="".join(chr(ord(ch) + 0xFEE0) if "0" <= ch <= "9" else ch for ch in at)), True),
           ("agreed_at with an Arabic-Indic year", dict(r, agreed_at="٢٠٢٦" + at[4:]), True)]
    for ws in ("\x85", "﻿", "　"):
        e = copy.deepcopy(r)
        e["establishes"] = e["establishes"][:-1] + [e["establishes"][-1] + " paid" + ws + "for this record"]
        out.append(("paid U+%04X for this record" % ord(ws), e, False))
        e = copy.deepcopy(r)
        e["parties"][0]["agent_card"] = e["parties"][0]["agent_card"].replace("https://", "https://x" + ws, 1)
        out.append(("agent_card host with U+%04X" % ord(ws), e, False))
    return base["input"], out


def _py(inp, rec):
    return AV.verify(rec, keys=inp.get("keys"), recorder_domain=inp.get("recorder_domain"), now=inp.get("now"))


def test_python_refuses_non_ascii_digits_in_agreed_at():
    inp, cases = _cases()
    for name, rec, digits in cases:
        codes = [x["code"] for x in _py(inp, rec)["refusals"]]
        assert ("bad_agreed_at" in codes) == digits, (name, codes)


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not on PATH")
def test_javascript_twin_gives_the_same_reports():
    inp, cases = _cases()
    js = ("import { verify } from %s; import { parseStrict } from %s; import { readFileSync } from 'node:fs';"
          "const inp = parseStrict(readFileSync(0, 'utf8')); const res = [];"
          "for (const r of inp.records) res.push(await verify(r, { keys: inp.keys, recorderDomain: inp.recorder_domain, now: inp.now }));"
          "process.stdout.write(JSON.stringify(res));") % (json.dumps("file://" + os.path.join(AGR, "agreement_verify.mjs")),
                                                        json.dumps("file://" + os.path.join(AGR, "agreement_canonical.mjs")))
    payload = json.dumps({"records": [c[1] for c in cases], "keys": inp.get("keys"), "recorder_domain": inp.get("recorder_domain"),
                          "now": inp.get("now")}, ensure_ascii=False)
    p = subprocess.run(["node", "--input-type=module", "-e", js], input=payload, capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert p.returncode == 0, p.stderr
    got = json.loads(p.stdout)
    assert len(got) == len(cases)
    for (name, rec, digits), j in zip(cases, got):
        assert _canon(_py(inp, rec)) == _canon(j), name
        assert ("bad_agreed_at" in [x["code"] for x in j["refusals"]]) == digits, name
