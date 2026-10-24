#!/usr/bin/env python3
"""Check the #51 run records against the occurrence-binding corpus of agent-evidence-vectors.

    pip install -r .github/requirements/agent-evidence-vectors.txt
    agent-evidence-vectors-occurrence-binding --output <new directory>
    python3 occurrence_pins_check.py <that directory>/report.json

The corpus pins a case B input: the first two lines of the estimate fixture, as
RFC 8785 bytes, sha256 1f75bcab... Both runs of case B send exactly those bytes,
so the check recomputes that digest from rehearsal/fixture.json and refuses any
other. It also refuses an audit whose lines name more than one dataset digest
or whose fixture digest is not the fixture's, and a corpus report with a
failing case (which covers the lost-call rule: a lost call stays unresolved
unless the worker signs a statement naming that call's request digest and
saying it did not run).

Exit 0 when every check holds; each failure is printed on its own line.
"""
import hashlib
import json
import os
import sys
from pathlib import Path

from agent_evidence_vectors.occurrence_binding import reader
from agent_evidence_vectors.occurrence_binding.run import PACKAGED_CORPUS

HERE = Path(os.path.dirname(os.path.abspath(__file__)))
REHEARSAL = HERE / "rehearsal"


def jcs_sha256(value):
    return hashlib.sha256(reader.canonical(value)).hexdigest()


def main(argv):
    if len(argv) != 2:
        raise SystemExit("usage: occurrence_pins_check.py <occurrence-binding report.json>")
    bad = []
    report = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    if report.get("failures") != [] or not report.get("results"):
        bad.append(f"corpus report: failing cases {report.get('failures')!r}")
    pins = reader.input_pins(json.loads((PACKAGED_CORPUS / "occurrence.json").read_text("utf-8")))
    fixture = json.loads((REHEARSAL / "fixture.json").read_text(encoding="utf-8"))
    case_b = dict(fixture, lines=fixture["lines"][:2])
    got = "sha256:" + jcs_sha256(case_b)
    if got != pins["input_sha256"]:
        bad.append(f"case B input: {got} from rehearsal/fixture.json, corpus pins {pins['input_sha256']}")
    else:
        print(f"case B input: {len(reader.canonical(case_b))} bytes, {got}, matches the corpus pin")
    for audit_path in sorted(REHEARSAL.rglob("audit.json")):
        audit = json.loads(audit_path.read_text(encoding="utf-8"))
        where = audit_path.relative_to(HERE)
        if audit.get("fixture_sha256") != jcs_sha256(fixture):
            bad.append(f"{where}: fixture_sha256 is not rehearsal/fixture.json")
        datasets = {line.get("dataset_sha256") for line in audit.get("lines", [])}
        if len(datasets) != 1 or None in datasets:
            bad.append(f"{where}: lines name {len(datasets)} dataset digests, one frozen dataset expected")
        else:
            print(f"{where}: one dataset, {datasets.pop()}")
    print("\n".join(bad) if bad else "occurrence pins: every check holds")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
