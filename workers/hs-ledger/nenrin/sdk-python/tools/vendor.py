"""Copy the repository's agreement verifier, the MUSUBI contract verifier and the frozen interop corpora into the package.

The agreement verifier (agreement-v0/agreement_verify.py and key_succession.py) is already held to its
JavaScript twin by 5,286 frozen reports. Rewriting it for the package would throw that proof away, so the package
carries the files themselves. The only edit is `import key_succession as KS` becoming a package-relative import.
VENDORED.json pins the sha256 of each source and of each vendored file; tests/test_vendored.py refuses a package
whose copies drift from the pins, and, inside the repository, from the sources.

MUSUBI (musubi-v0) is written in Python and has no JavaScript twin; the repository's files are the reference. They
are copied byte for byte, with no edit at all, into src/nenrin_verify/_repo/ under the same directory names
(musubi-v0/ beside agreement-v0/), so that each module finds its siblings and ../agreement-v0 exactly as it does in
the repository. Byte identity matters beyond the proof: correction_v0 fingerprints its own code files, and a copy
that differed by one header line would make every correction bundle built from the repository fail here.

  python3 tools/vendor.py          rewrite the copies and VENDORED.json from ../agreement-v0 and ../musubi-v0
  python3 tools/vendor.py --check  exit 1 if the copies are not what this script would write
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.normpath(os.path.join(ROOT, "..", "agreement-v0"))
DST = os.path.join(ROOT, "src", "nenrin_verify")
FILES = ["agreement_verify.py", "key_succession.py"]
EDITS = {"agreement_verify.py": [("    import key_succession as KS\n", "    from . import key_succession as KS\n")]}
REPO = os.path.normpath(os.path.join(ROOT, ".."))
# Byte-identical copies under src/nenrin_verify/_repo/. Left out: gen_anchor_compose_fixture.py (needs the
# opentimestamps package, it only regenerates a fixture) and header_view_fetch.py (fetches block headers over the
# network; the package opens no socket unless asked).
MUSUBI_MODULES = ["contract_v0.py", "settle_v1.py", "settle_v1_1.py", "settle_v1_2.py", "settle_v1_3.py", "settle_v1_4.py",
                  "settle_v1_5.py", "settle_v1_6.py", "settle_v1_7.py", "settle_v1_8.py", "settle_v1_9.py", "settle_v1_10.py",
                  "clause_eval_v0.py", "admission_verify_v0.py", "settle_v1_11.py", "settle_v1_12.py",
                  "convergence_v0.py", "spine_verify.py", "terms_v0.py", "independence_v0.py",
                  "corroboration_v0.py", "offer_v0.py", "bond_v0.py", "correction_v0.py", "correction_bundle_v0.py",
                  "anchor_compose.py", "immune_v0.py",
                  # settle v1.13 to v1.16, the reference of settle core v0 (nenrin-verify 0.7.0)
                  "approval_v3.py", "settle_v1_13.py", "settle_v1_14.py", "settle_v1_15.py", "settle_v1_16.py",
                  "settle_v1_17.py", "requirements_furui_v0.py", "settle_v1_18.py", "settle_v1_19.py"]
MUSUBI_DATA = ["canonical_v0.mjs", "canonical_vectors.json", "anchor_compose_fixture.json", "first_contract_A.json",
               "first_contract_AB.json", "first_contract_unsigned.json", "second_contract_A.json", "second_contract_AB.json",
               "README.md", "run0002/README.md", "run0002/entry63.ots", "run0002/entry63.raw", "run0002/exec_19c44a79.anchored.json",
               "run0002/exec_19c44a79.json", "run0002/settlement_walk2.json", "run0002/view.json", "run0002/walk_8bf29f1a.json",
               "fixtures/babyblueviper1_leg1/README.md", "fixtures/babyblueviper1_leg1/SHA256SUMS",
               "fixtures/babyblueviper1_leg1/leg1_vectors.json",
               "fixtures/babyblueviper1_approver_v2/LICENSE", "fixtures/babyblueviper1_approver_v2/README.md",
               "fixtures/babyblueviper1_approver_v2/SHA256SUMS", "fixtures/babyblueviper1_approver_v2/vectors.json",
               "fixtures/babyblueviper1_approver_v2/verify_approval_v2.py", "fixtures/babyblueviper1_approver_v2/_ed25519.py",
               # Admission records (SEKI): the verifying side only. The door that writes them is not in this repository.
               "admission_verify_v0.mjs", "clause_eval_v0.mjs",
               "fixtures/ADMISSION_FIXTURES.sha256", "fixtures/admission_intake/cases.json",
               "fixtures/admission_intake/v0_admission_public.json", "fixtures/contract_door/corpus.json",
               "fixtures/settle_admission/cases.json",
               # admission v0.2 (the immune block): the records its self-test reads, and the demo they come from
               "fixtures/admission_immune/cases.json", "fixtures/admission_immune/demo.json",
               # admission v0.3 (the content block): the records its self-test reads
               "fixtures/admission_content/cases.json",
               # requirements.furui (settle v1.17): its self-test holds it to its JavaScript twin
               "requirements_furui_v0.mjs",
               # approval v3 (settle v1.13 and later): the vectors its self-test reads (0.7.0)
               "fixtures/approval_v3/vectors.json", "approval_v3.mjs", "approval_v3.test.mjs"]
# convergence_v0 (settle v1.9) imports recovery-v0/recovery_verify.py by path, so that one file travels too.
# admission_verify_v0's self-test holds it to its JavaScript twin, which reads ../agreement-v0's three .mjs files.
VERBATIM = [("musubi-v0/" + f) for f in MUSUBI_MODULES + MUSUBI_DATA] + ["agreement-v0/agreement_verify.py", "agreement-v0/key_succession.py",
                                                                     "agreement-v0/agreement_verify.mjs", "agreement-v0/agreement_canonical.mjs",
                                                                     "agreement-v0/key_succession.mjs",
                                                                     "recovery-v0/recovery_verify.py"]
# settle core v0 (0.7.0): the text, the notes, the 128 vectors and the scripts that run them against settle_v1_16, so
# that `musubi-verify --settle-core` needs no clone (gen_vectors.py travels too: exercise_inputs.py imports it, and
# importing it writes nothing).
for _root, _dirs, _files in os.walk(os.path.join(REPO, "musubi-v0", "settle-core-v0")):
    _dirs[:] = sorted(d for d in _dirs if d != "__pycache__")
    for _f in sorted(_files):
        if not _f.endswith(".pyc"):
            VERBATIM.append(os.path.relpath(os.path.join(_root, _f), REPO).replace(os.sep, "/"))
# The cA2A companion's settler and the #51 set 2 run (0.7.0): `musubi-verify --pilot51-set2` recomputes the published
# settlement. companion_v0 imports ca2a_runtime, which comes with the extra nenrin-verify[ca2a].
VERBATIM += ["musubi-v0/ca2a-companion-v0/" + f for f in ("companion_v0.py", "companion_v0_1.py", "pilot_v0.py")]
for _root, _dirs, _files in os.walk(os.path.join(REPO, "musubi-v0", "ca2a-companion-v0", "pilot51", "set2")):
    _dirs.sort()
    for _f in sorted(_files):
        VERBATIM.append(os.path.relpath(os.path.join(_root, _f), REPO).replace(os.sep, "/"))
# nenrin-track-v0: the tracker of signed admissions in a mirror, and its vectors (each a small mirror directory).
TRACK = os.path.join(REPO, "track-v0")
VERBATIM.append("track-v0/track.py")
for _root, _dirs, _files in os.walk(os.path.join(TRACK, "vectors")):
    _dirs.sort()
    for _f in sorted(_files):
        VERBATIM.append(os.path.relpath(os.path.join(_root, _f), REPO).replace(os.sep, "/"))
# The frozen NENRIN corpora, so that nenrin-tsunagi scores a verifier offline exactly as the TSUNAGI board does.
INTEROP_DIRS = ["interop-v0", "interop-v0.1", "interop-v0.2/edge", "interop-v0.2/action-presence", "interop-v0.3/survivors", "interop-v0.3/own-proto", "trace-intake-v0", "trace-bind-v0", "trace-span-v0"]
for _d in INTEROP_DIRS:
    VERBATIM.append(_d + "/expected.json")
    VERBATIM += sorted(_d + "/fixtures/" + f for f in os.listdir(os.path.join(REPO, _d, "fixtures")) if f.endswith(".json"))
HEADER = "# VENDORED from workers/hs-ledger/nenrin/agreement-v0/%s by tools/vendor.py. Do not edit; edit the source.\n"


def sha(b):
    return hashlib.sha256(b).hexdigest()


def build():
    out, pins = {}, {}
    for name in FILES:
        src = open(os.path.join(SRC, name), "rb").read().decode("utf-8")
        text = src
        for old, new in EDITS.get(name, []):
            if text.count(old) != 1:
                raise SystemExit("%s: expected exactly one %r" % (name, old.strip()))
            text = text.replace(old, new)
        if text.startswith("#!"):
            first, rest = text.split("\n", 1)
            text = first + "\n" + (HEADER % name) + rest
        else:
            text = (HEADER % name) + text
        data = text.encode("utf-8")
        out[name] = data
        pins[name] = {"source": "workers/hs-ledger/nenrin/agreement-v0/" + name, "source_sha256": sha(src.encode("utf-8")), "vendored_sha256": sha(data)}
    for rel in VERBATIM:
        data = open(os.path.join(REPO, rel), "rb").read()
        out["_repo/" + rel] = data
        pins["_repo/" + rel] = {"source": "workers/hs-ledger/nenrin/" + rel, "source_sha256": sha(data), "vendored_sha256": sha(data)}
    return out, pins


def main(argv):
    out, pins = build()
    if "--check" in argv:
        bad = [n for n, d in out.items() if not os.path.exists(os.path.join(DST, n)) or open(os.path.join(DST, n), "rb").read() != d]
        pinned = json.load(open(os.path.join(DST, "VENDORED.json")))
        if pinned != pins:
            bad.append("VENDORED.json")
        if bad:
            print("vendored copies differ from what tools/vendor.py writes: " + ", ".join(bad))
            return 1
        print("vendored copies match their sources")
        return 0
    for n, d in out.items():
        os.makedirs(os.path.dirname(os.path.join(DST, n)), exist_ok=True)
        open(os.path.join(DST, n), "wb").write(d)
    open(os.path.join(DST, "VENDORED.json"), "w").write(json.dumps(pins, indent=2, sort_keys=True) + "\n")
    print("wrote " + ", ".join(out) + " and VENDORED.json")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
