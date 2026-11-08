# dr_check 0.1.0

dr_check reads draft-gruszka-audit-decision-receipts-06 (and -07 when published); counts 96/96 on the author's vectors.

It checks decision receipts and action outcome receipts as Sections 3.2 to 3.5, 3.8 and the relying-party check of
Section 4 of the draft describe them. It was written from the draft text only and shares no code with the verifier in
the author's test package.

## Files

- `dr_check.py`: the reader. Python 3 with the `cryptography` package (Ed25519); the count below was made with
  Python 3.14 and cryptography 46.0.7. It opens no network connection.
- `inputs-06.json`: for each of the 96 vectors, the procedure (Case 1, 2 or 3 of Section 3.3), the time T, the
  envelope files and the inputs, with the SHA-256 of each input file. It holds no expected result.
- `make_inputs.py`: writes `inputs-06.json` (`python3 -I -B make_inputs.py out.json` gives the same bytes).
- `count.py`: compares the verdicts with `expected.json` of the test package.

The test package is not copied here; it belongs to the draft's author. Take it from the URL in Appendix A.5 of the
draft and check its SHA-256 against the value given there (for -06:
`850195e6288dc1716a77aa92c4732b54caa20aacf7661ef24059e314341f001c`).

## Run

```sh
python3 -m pip install cryptography
python3 -I -B dr_check.py inputs-06.json <package_dir> out
python3 -I -B count.py out/gruszka06_verdicts.json <package_dir>/expected.json
```

`dr_check.py` reads the envelopes and inputs of the package by the procedure `inputs-06.json` names for each vector,
checks the SHA-256 of every input file, writes `out/gruszka06_verdicts.json` and prints its SHA-256. It does not
open `expected.json`. `count.py` then prints `96/96 vectors agree (result and step)` on the -06 package: the result
(pass, fail, or refused under Section 4) and the failing step or Section 4 item of every vector are the ones
`expected.json` gives.

## Readings

Where the text leaves a choice, dr_check takes one reading and names it (G1 to G30 in `READINGS` of `dr_check.py`).
Every verdicts file carries the readings it was made with.

## What it does not check

- The Signed Statements and SCITT Receipts of Appendix A.4 (`a4/` of the package).
- The proofbundle commands and exit codes recorded in `expected.json`.
- The wording of a failure: `count.py` compares the result and the step, not the reason text.

## -07

When -07 is published, dr_check is changed only where the text changes, as it was for -05 and -06, and its version
goes up.

## License

MIT, see `LICENSE`.
