"""nenrin-verify: recompute NENRIN evidence yourself, offline, in your own Python process.

The Python twin of the npm package nenrin-verify. Three verifiers held to their JavaScript counterparts, and MUSUBI:

  provenance   verify_provenance / consume_evidence: one A2A task's delegation chain, execution receipt,
               pre-execution intent and outcome evidence (port of nenrin_verify.mjs; same report, key for key)
  agreement    agreement_verify.verify: a two-party agreement record (a2a-agreement-v1 / v1.1), the repository's
               own Python verifier, which returns the same report as the JavaScript one on 5,286 frozen cases
  TSUGI        tsugi.verify_chain: a recovery chain (drift, proposal, authorization, execution, verify), strict
               operator keys, the random witness draw and its quorum (port of tsugi_verify.mjs; the same output,
               byte for byte, as `node tsugi_verify.mjs`)
  MUSUBI       musubi.load / musubi-verify: contracts, settlements and the spine (a2a-contract-v0). MUSUBI is
               written in Python and has no JavaScript twin; the package carries the repository's files byte for
               byte, so nothing has to be cloned to recompute a contract or a settlement

  TRACE        trace.verify_trace_intake / verify_trace_bind (0.5): whether the NENRIN ledger pins a TRACE Trust Record,
               and a nenrin-trace-bind-v0 record joining a NENRIN or MUSUBI record to a TRACE record (port of
               trace_verify.mjs; trace-bind-v0/SPEC.md); span_attributes / annotate_span put the bind on the agent's
               OpenTelemetry GenAI span

And two things for the agent you are building (0.4):

  a2a_recorder Recorder: a ClientCallInterceptor for the official A2A Python SDK. Every call your agent makes is
               recorded as a signed jidec-path-v1 witness record (salted hashes only, nothing sent unless you file)
  policy       evaluate: your own rule over a NENRIN resume ("2 signed-domain witnesses with PASS in 30 days, no
               FAIL"), a decision anyone recomputes from the resume, the rule and the time

The verifiers use no network, no clock and no score. A signature proves who asserted, not that the assertion is true; every report
says what it does not establish.
"""
import hashlib

from ._js import assign as _assign, stringify as _stringify, loads as js_loads
from .provenance import (VERIFIER_VERSION, candidate_evidence_set, consume_evidence, did_key_resolver,
                         evidence_id, grant_ref, intent_id, posture_line, preflight_report,
                         public_key_from_did_key, receipt_id, verify_provenance)
from . import agreement_verify, tsugi, musubi, policy, trace
from .trace import (verify_trace_intake, verify_trace_bind, check_trace_record, span_attributes, annotate_span,
                    check_span_attributes)

__version__ = "0.8.1"

__all__ = ["verify_provenance", "consume_evidence", "posture_line", "candidate_evidence_set", "preflight_report",
           "public_key_from_did_key", "did_key_resolver", "evidence_id", "grant_ref", "receipt_id", "intent_id",
           "agreement_verify", "tsugi", "musubi", "policy", "trace", "verify_trace_intake", "verify_trace_bind",
           "check_trace_record", "span_attributes", "annotate_span", "check_span_attributes", "report_sha256", "report_json", "verify_bundle", "js_loads", "VERIFIER_VERSION", "__version__"]


def report_sha256(report):
    """sha256 of the report's sorted-key JSON, the same bytes the JavaScript side hashes for the parity check:
    keys ordered by UTF-16 code unit at every depth, no whitespace, numbers as JavaScript writes them."""
    return hashlib.sha256(_stringify(report, sort_keys=True).encode("utf-8")).hexdigest()


def verify_bundle(bundle):
    """What `nenrin-verify bundle.json` does: Object.assign({}, bundle, {resolve: didKeyResolver}), then verify,
    offline. Any JSON value is accepted the way the JavaScript CLI accepts it (an array or null verifies as {})."""
    return verify_provenance(_assign(bundle, {"resolve": did_key_resolver}))


def report_json(report, indent=2):
    """The report as JSON text, written the way JSON.stringify(report, null, indent) writes it. Use this rather
    than json.dumps: a report can carry the port's stand-in for JavaScript undefined (a key the JavaScript leaves
    out of its output), which json.dumps cannot write."""
    return _stringify(report, indent=indent)
