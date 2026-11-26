# dr_check 0.2.1

dr_check reads draft-gruszka-audit-decision-receipts-11. On the 617 vectors of the author's -11 test package, all
617 agree on result and step and 0 disagree: 606 name the same step, and 11 name step n of Section 3.2 where the
package names step n of Appendix B.3, which Appendix B.5 of -11 says is the same step.

It checks decision receipts and outcome receipts by Sections 3.2 to 3.4 with the field rules of Section 3.8, in the
DSSE binding of Section 3.10 and the COSE_Sign1 binding of Appendix B, the approver signature of Section 3.11, the
relying-party check of Section 4 and the three checks over a set of receipts of Section 3.5. It was written from the
text of -11 only and shares no code with the verifier in the author's test package.

The reader of -06 (dr_check 0.1.1) is in the directory above and is not changed.

## Files

- `dr_check.py`: the reader, 0.2.1. Python 3 with the `cryptography` package (Ed25519); the counts below were made
  with Python 3.14.10 and cryptography 46.0.7. It opens no network connection.
- `dr_check_0.2.0.py`: the reader as it was frozen before any expected file was opened, kept for the record.
- `READINGS.md`: the places where the text of -11 reads two ways (R-1 to R-22), the reading taken at each, and the
  two readings 0.2.1 changed, with the sentences of -11 they follow.
- `make_inputs.py`: writes `inputs-11.json` from the verifier calls of the test package: for each vector its name,
  the input file it comes from, its verifier call, and the SHA-256 (from `MANIFEST.sha256` of the package) of every
  file the call reads. It opens no expected result.
- `count.py`: compares the verdicts with the expected files of the test package.

The test package is not copied here; it belongs to the draft's author. Take it from the URL in Appendix A.5 of the
draft and check its SHA-256 against the value given there (for -11:
`1e413b5b5885627a4c072752d3c753846f052e2038434d720bf09de8b48e225d`).

## Run

```sh
python3 -m pip install cryptography
python3 -I -B dr_check.py --selftest
python3 -I -B make_inputs.py <package_dir> inputs-11.json
python3 -I -B dr_check.py inputs-11.json <package_dir> out
python3 -I -B count.py <package_dir> out/gruszka11_verdicts.json
```

`--selftest` runs small checks built only from the values printed in Appendix A of -11. `dr_check.py` runs each
verifier call that `inputs-11.json` names, writes `out/gruszka11_verdicts.json` (one result and step per vector) and
prints its SHA-256. It does not open the expected files. On the -11 package, the verdicts file of 0.2.1 has SHA-256
`1a6eaa3e72d4eda7bcd301d0eb79024c9c13fdfc0da19c7f27d702fcb3a922c5` (617 vectors: fail 532, invalid input 16, no
result 5, pass 52, refused 12).

`count.py` then prints:

- agree on result and step: 606 / 617.
- agree by Appendix B.5 of -11: 11. The package names step 1 or step 3 of Appendix B.3 and dr_check names the step of
  the same number of Section 3.2; all 11 are decision receipts in the COSE_Sign1 binding (C2-s1-depth33,
  C2-s1-dup-label, C2-s1-int64-neg, C2-s1-int64-pos, C2-s1-iss-8193, C2-s1-iss-space, C2-s1-sub-space,
  C2-s1-unprot-crit, C2-s1-unprot-label, CPK1, CPK2).
- agree in all: 617 / 617.
- disagree: 0.

## One result per vector, and the checks of Section 3.5

Section 3.5 of -11 says that the results of its checks are reported apart from the result of a receipt, and that a
failure there does not turn a pass of that receipt into a failure. dr_check writes one result and step per vector,
as the expected files of the package do. Where a receipt passes and a check of Section 3.5 fails or gives no
result, dr_check writes that check as the result of the vector (R-22 in `READINGS.md`); the receipt itself passed.
The result of each check is kept apart in the `set_checks` member of the verdict.

## 0.2.0 and 0.2.1

0.2.0 was run on the package and its verdicts were frozen before any expected file was opened. Its verdicts file
has SHA-256 `06ddf097fcfb44cc0744f0a3725c331b53d9ce7b72abdbfd3225ccf6e450f65b`; counted as above it gives 605
agree on result and step, the same 11 by Appendix B.5, and 1 disagree (I1).

0.2.1 differs from the frozen 0.2.0 in two readings, and in nothing else. 0.2.1 was changed on 22 November
after asking the author, before -11 was posted. Both changes follow sentences that -11 as posted adds:

- R-20 (Section 3.1): a Case 3 call without an outcome receipt gives no result (incomplete invocation). 0.2.0 failed
  it at Case 3. This moves I1 from disagree to agree.
- R-18 (Section 3.5): the binding of each held receipt is an input of the call. 0.2.0 fixed it to DSSE. Every held
  receipt in the package is DSSE, so no verdict changes.

`READINGS.md` keeps the readings of 0.2.0 as they were and adds the two changes below them.

## What it does not check

- The Signed Statements and SCITT Receipts of Appendix A.4.
- The proofbundle commands and exit codes recorded in the package.
- The wording of a failure: `count.py` compares the result and the step, not the reason text.

## License

MIT, see `../LICENSE`.
