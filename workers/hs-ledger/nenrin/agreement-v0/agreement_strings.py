#!/usr/bin/env python3
"""The wording the verifier emits, pulled out of the fixture so a second implementation can read it.

Why this file exists (2026-09-10).

A second implementation of the verifier has to reproduce 708 English templates,
about 65,000 characters, byte for byte. Retyping that into JavaScript would make
every typo look like a disagreement between implementations, and it is not one.
The thing worth proving is that both sides reach the same DECISION: which refusal
code fires, which template applies, what gets interpolated. The wording is data.

So the wording is lifted out as data. Not out of agreement_verify.py, which stays
untouched: out of agreement_vectors_v1.json, which already holds every report the
185 vectors produce. Deriving it costs the verifier nothing and leaves the
contract sha where it is.

The danger in a derived table is the one this repository met twice today: a value
that lives in two places gets changed in one. So this file carries --check, which
rebuilds the table from the current fixture and fails when the committed table
disagrees. A table nobody re-derives is a table that is quietly wrong.

What this table is NOT: it is not the specification. agreement_verify.py is. This
is a view of what that file says, taken through the adversary, and it therefore
holds exactly the wording the adversary causes and no other. A branch no vector
reaches contributes no string here, and a second implementation reading this table
has nothing to emit on that branch. That limit is the same one the fixture
already states, and it belongs beside any claim of agreement.

Usage:
  python3 agreement_strings.py            write agreement_strings_v1.json
  python3 agreement_strings.py --check    exit 1 if the written table is stale
  python3 agreement_strings.py --selftest run the built in cases
"""
import base64
import hashlib
import io
import json
import os
import re
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(HERE, "agreement_vectors_v1.json")
OUT = os.path.join(HERE, "agreement_strings_v1.json")
STRINGS_SCHEMA = "a2a-agreement-strings-v1"

# Values the verifier interpolates. Folding them out turns 1019 sentences into the
# smaller set of shapes a second implementation actually has to hold.
FOLDS = [
    (re.compile(r"https?://[^\s,;)\"]+"), "<url>"),
    (re.compile(r"\b[0-9a-f]{16,}\b"), "<hex>"),
    (re.compile(r"signatures\[\d+\]"), "signatures[<i>]"),
    (re.compile(r"parties\[\d+\]"), "parties[<i>]"),
    (re.compile(r"\$\.[A-Za-z_][A-Za-z0-9_.\[\]]*"), "<path>"),
    (re.compile(r"\([^)]{0,400}\)"), "(<v>)"),
    (re.compile(r"'[^']{0,200}'"), "'<v>'"),
    (re.compile(r"\b\d+\b"), "<n>"),
]


def fold(s):
    for rx, rep in FOLDS:
        s = rx.sub(rep, s)
    return s


def load_fixture(path=FIXTURE):
    env = json.loads(io.open(path, encoding="utf-8").read())
    raw = zlib.decompress(base64.b64decode(env["payload"]))
    got = hashlib.sha256(raw).hexdigest()
    if got != env["contract_sha256"]:
        raise SystemExit("fixture の中身が封筒の名乗りと違う。先に agreement_fixture.py --verify")
    return env["contract_sha256"], json.loads(raw)


def harvest(doc):
    """Pull the wording out of every report, grouped by where it came from."""
    refusals, findings = {}, {}
    est, dne, sigreason = set(), set(), set()
    for c in doc["cases"]:
        r = c["report"]
        for x in r.get("refusals", []) or []:
            refusals.setdefault(x.get("code"), set()).add(fold(x.get("why", "")))
        for x in r.get("findings", []) or []:
            findings.setdefault(x.get("code"), set()).add(fold(x.get("why", "")))
        for s in r.get("establishes", []) or []:
            est.add(fold(s))
        for s in r.get("does_not_establish", []) or []:
            dne.add(fold(s))
        for sg in r.get("signatures", []) or []:
            if isinstance(sg, dict) and sg.get("reason"):
                sigreason.add(fold(sg["reason"]))
    return {
        "refusals": {k: sorted(v) for k, v in sorted(refusals.items()) if k},
        "findings": {k: sorted(v) for k, v in sorted(findings.items()) if k},
        "establishes": sorted(est),
        "does_not_establish": sorted(dne),
        "signature_reasons": sorted(sigreason),
    }


def build(contract_sha, doc):
    h = harvest(doc)
    n = (sum(len(v) for v in h["refusals"].values())
         + sum(len(v) for v in h["findings"].values())
         + len(h["establishes"]) + len(h["does_not_establish"]) + len(h["signature_reasons"]))
    return {
        "schema": STRINGS_SCHEMA,
        "derived_from": "agreement_vectors_v1.json",
        "fixture_contract_sha256": contract_sha,
        "template_count": n,
        "refusal_codes": len(h["refusals"]),
        "finding_codes": len(h["findings"]),
        "what_this_is": (
            "The wording agreement_verify.py emits, as data, so a second implementation can "
            "reach the same decision without retyping the sentences. Interpolated values are "
            "folded to <url> <hex> <path> <n> <v> and signatures[<i>] parties[<i>]."
        ),
        "what_this_is_not": (
            "Not the specification. agreement_verify.py is. This is a view of it taken through "
            "the adversary, so it holds the wording the adversary causes and no other. A branch "
            "no vector reaches contributes nothing here."
        ),
        "note_signature_reasons": (
            "Empty, and correctly so. This verifier's signatures[] entries carry domain, key_url "
            "and result, and no prose at all. The field is kept so a reader can see it was looked "
            "at rather than forgotten; an empty list that is explained is not the same as a "
            "missing one."
        ) if not h["signature_reasons"] else "",
        "strings": h,
    }


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _selftest():
    cases = []

    def t(name, ok):
        cases.append((name, ok))

    t("a url is folded", fold("see https://a.example/x/y now") == "see <url> now")
    t("a sha is folded", fold("sha 0123456789abcdef0123 ok") == "sha <hex> ok")
    t("a signature index is folded", fold("signatures[1].key_url") == "signatures[<i>].key_url")
    t("a party index is folded", fold("parties[0].role") == "parties[<i>].role")
    t("a bare number is folded", fold("is 42 levels deep") == "is <n> levels deep")
    t("a quoted value is folded", fold("found 'peerx'") == "found '<v>'")
    t("two sentences that differ only in a value fold to one shape",
      fold("parties[0].role bad, found 'x'") == fold("parties[1].role bad, found 'y'"))
    t("two sentences that differ in WORDS do not fold together",
      fold("the record is one_sided") != fold("the record is two_sided"))
    doc = {"cases": [{"report": {
        "refusals": [{"code": "bad_role", "why": "parties[0].role must be one of payer, found 'x'"}],
        "findings": [{"code": "conduct_self_measured", "why": "party 1 declared it"}],
        "establishes": ["that A signed"], "does_not_establish": ["that money moved"],
        "signatures": [{"reason": "verifies over the canonical bytes"}]}}]}
    h = harvest(doc)
    t("refusals are grouped by code", list(h["refusals"]) == ["bad_role"])
    t("findings are grouped by code", list(h["findings"]) == ["conduct_self_measured"])
    t("establishes and does_not_establish are kept apart",
      h["establishes"] == ["that A signed"] and h["does_not_establish"] == ["that money moved"])
    t("a signature reason is kept", h["signature_reasons"] == ["verifies over the canonical bytes"])
    d1 = build("abc", doc)
    d2 = build("abc", doc)
    t("the table is byte stable", canonical(d1) == canonical(d2))
    t("the table names the fixture it came from", d1["fixture_contract_sha256"] == "abc")

    bad = 0
    for name, ok in cases:
        print(("ok   " if ok else "NG   ") + name)
        bad += 0 if ok else 1
    print("")
    print("=== %d / %d %s (agreement_strings) ===" % (len(cases) - bad, len(cases),
          "不合格あり" if bad else "合格"))
    return 1 if bad else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        raise SystemExit(_selftest())
    sha, doc = load_fixture()
    table = build(sha, doc)
    text = canonical(table)

    if "--check" in sys.argv:
        if not os.path.exists(OUT):
            print("表がまだ無い。python3 agreement_strings.py で書き出す")
            raise SystemExit(1)
        have = io.open(OUT, encoding="utf-8").read().strip()
        same = have == text
        print("表と fixture は %s" % ("一致しとる" if same else "食い違っとる"))
        if not same:
            print("  検証器の文言が変わったのに表が古い、または fixture を出し直しとらん。")
            print("  python3 agreement_fixture.py && python3 agreement_strings.py")
        raise SystemExit(0 if same else 1)

    io.open(OUT, "w", encoding="utf-8").write(text + "\n")
    print("書き出した: %s" % os.path.relpath(OUT, HERE))
    print("  fixture      : %s" % sha[:16] + "...")
    print("  英文の型     : %d 本" % table["template_count"])
    print("    refusal    : %d code" % table["refusal_codes"])
    print("    finding    : %d code" % table["finding_codes"])
    print("    establishes: %d" % len(table["strings"]["establishes"]))
    print("    dne        : %d" % len(table["strings"]["does_not_establish"]))
    print("    sig reason : %d" % len(table["strings"]["signature_reasons"]))
    print("  ファイル     : %d bytes" % len(text.encode("utf-8")))
