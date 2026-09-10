#!/usr/bin/env python3
"""Emit the shared fixture a second implementation of the verifier must reproduce.

Why this file exists (2026-09-10).

The agreement record has one verifier, in Python, with 185 vectors and 74 mutants
behind it. The next step people keep asking for is an intake: somewhere to POST a
record and have it checked. An intake lives in a Worker, a Worker is JavaScript,
and writing the rules a second time in a second language is how two
implementations that disagree get born. Disagreement between implementations is
the exact seam the NENRIN work measures. Building it into this layer on purpose
would be a poor joke.

The ring builder faced the same fork and took the same road: a shared fixture
first, then a second implementation, then byte for byte agreement proved on that
fixture before anything was published (ledger entry 34). This file is that first
step for the agreement layer.

What it does: it wraps agreement_verify.verify, runs the adversary, and records
every call that the 185 vectors actually make, with the exact input and the exact
report. The result is a JSON file whose canonical bytes have a sha256. That sha
is the contract. A second implementation is correct when it turns every input in
that file into the byte identical report beside it, and not before.

What it refuses to do: it will not write a fixture from a red adversary run. A
fixture emitted while a vector is failing would freeze the failure as the
specification, and every later implementation would be proved to agree with a
defect. The adversary must be all green or nothing is written.

What it cannot capture, said here rather than left to be found: an input the
adversary builds that JSON cannot hold. A record that refers to itself, a float
that is NaN or infinite. Those vectors still run and still count in the
adversary; they simply cannot travel to another language through a JSON file, so
they are listed by name under "skipped" with the reason, and a second
implementation is untested on them. Anyone reading a coverage claim about the
second implementation should read that list first.

Usage:
  python3 agreement_fixture.py                    write agreement_vectors_v1.json
  python3 agreement_fixture.py --out other.json   write somewhere else
  python3 agreement_fixture.py --selftest         run the built in cases
"""
import base64
import copy
import hashlib
import io
import json
import os
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

FIXTURE_SCHEMA = "a2a-agreement-fixture-v1"
DEFAULT_OUT = os.path.join(HERE, "agreement_vectors_v1.json")


PAYLOAD_ENCODING = "zlib+base64"


def canonical(obj):
    """The fixture's own byte form: sorted keys, packed separators, pure ASCII.

    ensure_ascii is True here and False in the record layer, on purpose. The record
    layer's canonical form is what gets signed, and it leaves non-ASCII as itself.
    This file is transport. Escaping everything to ASCII means a lone surrogate,
    which is legal JSON text and illegal UTF-8, can still travel to another
    language as \ud800 and arrive as the same string.

    The first version of this file used ensure_ascii=False and threw away 187
    vectors as "not carryable", every one of them a lone surrogate case. The lone
    surrogate is the defect that crashed this verifier on 2026-09-10 and got a
    guard written for it. Dropping exactly that class from the fixture would have
    left the second implementation untested on the one input we already know
    kills a careless reader.
    """
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def portable(obj):
    """Return (ok, reason). True when this value can cross a JSON file into another language."""
    try:
        canonical_bytes = canonical(obj)
        json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
        canonical_bytes.encode("utf-8")
    except ValueError as e:
        return False, "not representable as JSON: " + str(e)[:80]
    except (TypeError, RecursionError) as e:
        return False, "not serialisable: " + type(e).__name__
    except UnicodeEncodeError as e:
        return False, "not encodable even as escaped ASCII: " + str(e)[:60]
    return True, ""


def collect(module_name="agreement_redteam"):
    """Run the adversary with verify wrapped, and return (cases, skipped, exit_code)."""
    import agreement_verify as V

    seen = {}
    order = []
    skipped = []
    real = V.verify

    def recording(record, keys=None, recorder_domain=None, now=None, input_text=None):
        out = real(record, keys=keys, recorder_domain=recorder_domain,
                   now=now, input_text=input_text)
        try:
            snap = {
                "record": copy.deepcopy(record),
                "keys": copy.deepcopy(keys),
                "recorder_domain": recorder_domain,
                "now": now,
                "input_text": input_text,
            }
            rep = copy.deepcopy(out)
        except (RecursionError, TypeError):
            skipped.append({"reason": "the input could not be copied (it refers to itself)"})
            return out
        ok_in, why_in = portable(snap)
        ok_out, why_out = portable(rep)
        if not (ok_in and ok_out):
            skipped.append({"reason": why_in or why_out,
                            "verdict": rep.get("verdict") if isinstance(rep, dict) else None})
            return out
        key = canonical(snap)
        if key not in seen:
            seen[key] = {"input": snap, "report": rep}
            order.append(key)
        return out

    V.verify = recording
    code = 0
    try:
        __import__(module_name)
    except SystemExit as e:
        code = e.code if isinstance(e.code, int) else 1
    finally:
        V.verify = real
    return [seen[k] for k in order], skipped, code


def build(cases, skipped, verifier_version, calls):
    return {
        "schema": FIXTURE_SCHEMA,
        "verifier_version": verifier_version,
        "source": "agreement_redteam.py",
        "emitted_by": "agreement_fixture.py",
        "calls_observed": calls,
        "distinct_cases": len(cases),
        "skipped_count": len(skipped),
        "skipped": skipped,
        "what_this_proves": (
            "A second implementation that turns every input below into the byte identical "
            "report beside it agrees with the Python verifier on everything the adversary "
            "exercises. It proves nothing about inputs the adversary does not build, and "
            "nothing about the inputs listed under skipped, which JSON cannot carry."
        ),
        "cases": cases,
    }


def _selftest():
    cases = []

    def t(name, ok):
        cases.append((name, ok))

    t("canonical sorts keys and packs separators",
      canonical({"b": 1, "a": {"d": 2, "c": 3}}) == '{"a":{"c":3,"d":2},"b":1}')
    ok, _ = portable({"a": 1})
    t("an ordinary object is portable", ok)
    ok, why = portable({"a": float("nan")})
    t("NaN is not portable and says so", (not ok) and "JSON" in why)
    cyc = {}
    cyc["self"] = cyc
    ok, _ = portable(cyc)
    t("a record that refers to itself is not portable", not ok)
    ok, _ = portable({"a": "\ud800"})
    t("a lone surrogate IS portable, escaped to ASCII", ok)
    esc = canonical({"a": "\ud800"})
    t("and it travels as an escape, not as bytes", esc == '{"a":"\\ud800"}' and esc.isascii())
    t("and it comes back the same string", json.loads(esc)["a"] == "\ud800")
    t("the fixture payload is always pure ASCII",
      canonical({"j": "日本語", "s": "\ud800"}).isascii())
    doc = build([{"input": {}, "report": {}}], [{"reason": "x"}], "0.0.0", 3)
    t("the fixture names how many it skipped", doc["skipped_count"] == 1 and doc["distinct_cases"] == 1)
    t("the fixture states what it does not prove", "skipped" in doc["what_this_proves"])
    b = canonical(doc).encode("utf-8")
    t("the fixture is byte stable", canonical(doc).encode("utf-8") == b)

    bad = 0
    for name, ok in cases:
        print(("ok   " if ok else "NG   ") + name)
        bad += 0 if ok else 1
    print("")
    print("=== %d / %d %s (agreement_fixture) ===" % (len(cases) - bad, len(cases),
          "不合格あり" if bad else "合格"))
    return 1 if bad else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        raise SystemExit(_selftest())
    if "--verify" in sys.argv:
        path = DEFAULT_OUT
        if "--out" in sys.argv:
            path = sys.argv[sys.argv.index("--out") + 1]
        env = json.loads(io.open(path, encoding="utf-8").read())
        raw = zlib.decompress(base64.b64decode(env["payload"]))
        got = hashlib.sha256(raw).hexdigest()
        ok = got == env["contract_sha256"]
        print("contract_sha256 : " + env["contract_sha256"])
        print("recomputed      : " + got)
        print("bytes           : %d (envelope says %d)" % (len(raw), env["contract_bytes"]))
        print("cases           : %d, skipped %d" % (env["distinct_cases"], env["skipped_count"]))
        print("")
        print("=== " + ("一致" if ok else "食い違い") + " (fixture の中身は封筒が名乗るとおりか) ===")
        raise SystemExit(0 if ok else 1)
    out_path = DEFAULT_OUT
    if "--out" in sys.argv:
        out_path = sys.argv[sys.argv.index("--out") + 1]

    import agreement_verify as V
    calls_before = 0
    cases, skipped, code = collect()

    if code != 0:
        sys.stderr.write(
            "\nREFUSING TO WRITE: the adversary exited %d, so at least one vector is failing.\n"
            "A fixture emitted now would freeze that failure as the specification, and every\n"
            "later implementation would be proved to agree with a defect.\n"
            "Fix the adversary first, then emit.\n" % code)
        raise SystemExit(2)

    doc = build(cases, skipped, V.VERIFIER_VERSION, len(cases) + len(skipped))
    # The contract is the sha256 of the payload's canonical bytes. The container is
    # transport and may vary with a zlib version; the contract does not.
    payload = canonical(doc)
    sha = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    envelope = {
        "schema": FIXTURE_SCHEMA + "-envelope",
        "contract_sha256": sha,
        "contract_bytes": len(payload.encode("utf-8")),
        "payload_encoding": PAYLOAD_ENCODING,
        "payload": base64.b64encode(zlib.compress(payload.encode("utf-8"), 9)).decode("ascii"),
        "how_to_read": (
            "base64 decode payload, zlib inflate it, and you hold the canonical bytes whose "
            "sha256 is contract_sha256. Check that sha before trusting anything inside. "
            "python3 agreement_fixture.py --verify does exactly that."
        ),
        "distinct_cases": len(cases),
        "skipped_count": len(skipped),
    }
    text = canonical(envelope)
    io.open(out_path, "w", encoding="utf-8").write(text + "\n")
    print("")
    print("書き出した: %s" % os.path.relpath(out_path, HERE))
    print("  distinct cases : %d" % len(cases))
    print("  skipped        : %d (JSON で運べん入力)" % len(skipped))
    for s in skipped:
        print("      - " + s["reason"])
    # 2026-09-10 この2行は前は "canonical bytes" と "sha256" が並んどって、
    # 別のバイト列の話をしとった。ファイルの大きさと、契約の判子や。
    # 数字と判子の出どころが違うのに隣に並べるのは、今日ずっと潰してきた形そのもの。
    print("  envelope file  : %d bytes (zlib+base64、これが git に乗る)" % len(text.encode("utf-8")))
    print("  contract bytes : %d bytes (圧縮前の canonical、判子はこっちに打つ)" % len(payload.encode("utf-8")))
    print("  contract sha256: %s" % sha)
    print("")
    print("この sha が契約や。二つ目の実装は、この中の入力を全部、隣の report と")
    print("バイト単位で同じ物に変えられて初めて一致したと言える。")
