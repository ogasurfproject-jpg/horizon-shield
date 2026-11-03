"""nenrin_verify.trace against the three TRACE corpora (packaged copies under _repo/, pinned in VENDORED.json), the
RFC 8785 vectors made by Python's rfc8785 for trace-pin-v0, and the OpenTelemetry helper on a stand-in span."""
import json
import os

from nenrin_verify import trace, tsunagi
from nenrin_verify._js import loads

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.join(HERE, "..", "..")


def _run(corpus, fn):
    cases, _ = tsunagi.load_corpus(corpus)
    batch = loads(tsunagi.batch_text(corpus))
    bad = []
    for c in batch:
        got = fn(c["bundle"])
        want = cases[c["name"]]["expect"]
        if (got["verdict"], sorted(got["refusals"]), sorted(got["findings"])) != (want["verdict"], sorted(want["refusals"]), sorted(want["findings"])):
            bad.append((c["name"], got, want))
    assert not bad, bad
    return len(batch)


def test_intake_corpus():
    assert _run("nenrin-trace-intake-v0", trace.verify_trace_intake) == 28


def test_bind_corpus():
    assert _run("nenrin-trace-bind-v0", trace.verify_trace_bind) == 28


def test_span_corpus():
    assert _run("nenrin-trace-span-v0", lambda b: trace.check_span_attributes(b["span"], b["bind_bundle"])) == 16


def test_jcs_matches_python_rfc8785_vectors():
    fx = json.load(open(os.path.join(REPO, "trace-pin-v0", "fixtures", "trace_fixtures.json"), encoding="utf-8"))
    for v in fx["_jcs_vectors"]:
        assert trace.jcs(loads(json.dumps(v["value"]))).encode("utf-8").hex() == v["jcs_utf8_hex"]


def test_annotate_span_sets_the_identifiers():
    class Span:
        def __init__(self):
            self.attrs = {}

        def set_attributes(self, a):
            self.attrs.update(a)

    cases, batch = tsunagi.load_corpus("nenrin-trace-bind-v0")
    b = next(c["bundle"] for c in batch if c["name"] == "bound_bernstein_registered_key")
    s = trace.annotate_span(Span(), b["bind"])
    assert s.attrs["nenrin.trace.sha256"] == b["bind"]["trace_sha256"]
    assert trace.check_span_attributes(s.attrs, b)["verdict"] == "span_bound"


def test_bind_hex_and_thumbprint_exactly_as_javascript():
    """0.8.1: record_sha256, trace_sha256 and trace_key_thumbprint with a character before or after them, and the two
    sha256 in uppercase, are bind_malformed, as trace_verify.mjs says (re.match with "$" passed a trailing "\n" before).
    Uppercase is base64url, so a thumbprint in uppercase is well formed and left out here."""
    import shutil
    import subprocess
    batch = loads(tsunagi.batch_text("nenrin-trace-bind-v0"))
    base = [c for c in batch if trace.verify_trace_bind(c["bundle"])["verdict"] == "bound"]
    assert base
    out = []
    for c in base[:3]:
        for k in ("record_sha256", "trace_sha256", "trace_key_thumbprint"):
            edges = [lambda t: t + "\n", lambda t: t + "\r", lambda t: t + " ", lambda t: "\n" + t]
            for f in edges + ([lambda t: t.upper()] if k != "trace_key_thumbprint" else []):
                b = json.loads(json.dumps(c["bundle"]))
                v = f(b["bind"][k])
                if v == b["bind"][k]:
                    continue
                b["bind"][k] = v
                got = trace.verify_trace_bind(b)
                assert got["refusals"] == ["bind_malformed"], (k, repr(v), got)
                out.append(b)
    node = shutil.which("node")
    if node is None:
        return
    js = os.path.normpath(os.path.join(REPO, "sdk", "trace_verify.mjs"))
    src = ("import { verifyTraceBind } from %s; const inp = JSON.parse(require_fs().readFileSync(0, 'utf8'));"
           "process.stdout.write(JSON.stringify(inp.map((b) => verifyTraceBind(b).refusals)));") % json.dumps("file://" + js)
    src = "import { readFileSync } from 'node:fs'; const require_fs = () => ({ readFileSync });" + src
    r = subprocess.run([node, "--input-type=module", "-e", src], input=json.dumps(out), capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout) == [["bind_malformed"]] * len(out)
