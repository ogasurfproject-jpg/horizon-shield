# Work-acceptance record, profile 1.4.5: a second checker run on vectors 01-112

This directory holds a checker for work-acceptance records (schema `trilatic.acceptance-receipt/1.2`,
draft profile 1.4.5) written from the README text of
[maximusrufus/work-acceptance-record](https://github.com/maximusrufus/work-acceptance-record), and the
record of one run of it against the 112 conformance vectors of that repository at tag `v1.4.5`.

Result: **112 of 112 vectors agree with `expected`.** The checker's self-test passes.

This run was **not blind**. See "What was seen before the run" below.

## Upstream pin

| | |
|---|---|
| repository | https://github.com/maximusrufus/work-acceptance-record |
| tag | `v1.4.5` (lightweight tag) |
| commit | `066315f0cbf6199339d5432e4bbec4ecf2c59df4` |
| tree | `43c9013d000a30601b3bd456585d8ebebc057831` |
| commit date | 2026-11-06T06:06:23-08:00 |
| files read | `README.md` and `vectors/` only |
| SHA-256 of each file read | `SHA256SUMS_data_066315f.txt` (113 lines: `README.md` and the 112 vectors) |
| SHA-256 of that list | `c323320c71e2e3527ee6caf6336557df3025533202707a9007dcddca642195ce` |

The vectors are not copied into this directory. Each vector file carries `"license": "CC0-1.0"` and the
upstream README lists `vectors/` as CC0, but only their SHA-256 list is kept here; a rerun reads the
vectors from a checkout of the upstream commit. `verifier/`, `composition/` and `interop/` of the upstream
repository were not extracted or opened.

## Files

| file | what it is |
|---|---|
| `war145_check.py` | the checker. One Python file, standard library only (Ed25519, RFC 8785 JCS, the RFC 3161 token parsing and the TSA signature checks are in the file). Imports: base64, hashlib, json, os, re, sys, datetime, fractions, math. It opens no network connection and fetches nothing; it reads the directory given on the command line and writes one JSON file. |
| `mask144.py` | copies each vector keeping only `inputs`, `vector` and `license`, so the checker never sees `expected`. Prints field names and counts only. |
| `compare.py` | compares the checker's output with `expected`: problem and warning codes as sets, the other members exactly, the two refusal vectors (21 and 77) on `refused` and `reason`. |
| `READINGS.md`, `READINGS144.md`, `READINGS145.md` | the places where the upstream text allows two readings, the reading chosen for each (R1 to R25) and the vectors it touches. `READINGS.md` and `READINGS144.md` were written for earlier profiles (1.4.3 and 1.4.4) and are carried over unchanged; `READINGS145.md` adds R23 to R25 for step 12. |
| `RUN_LOG.txt` | the log of the run: sandbox profile, network probe, Python version, SHA-256 of the scripts and of the vector list, the frozen verdicts' SHA-256, the comparison result. |
| `verdicts_01_112.json` | the checker's output for vectors 01-112, frozen before the comparison. SHA-256 `7a56d21edbccf00f318a47913816a076bbf02f35506ec966e0ecd51a5f15f8eb`. |
| `compare_01_112.json` | the output of `compare.py`: `"agree": 112`, `"vectors": 112`, no differences. |
| `SHA256SUMS_data_066315f.txt` | SHA-256 of the upstream `README.md` and of each of the 112 vectors at `066315f`. |

## How to rerun

Only the first command uses the network. Everything after it runs offline; the run recorded here had
outbound network access blocked by the macOS sandbox (`sandbox-exec`), and a connection test to an outside
address failed inside the same sandbox before the run (see `RUN_LOG.txt`).

```
git clone https://github.com/maximusrufus/work-acceptance-record wa
git -C wa checkout 066315f0cbf6199339d5432e4bbec4ecf2c59df4
(cd wa && shasum -a 256 -c ../SHA256SUMS_data_066315f.txt)
python3 -I -B mask144.py wa/vectors masked 1 112
python3 -I -B war145_check.py --selftest
python3 -I -B war145_check.py masked verdicts.json
shasum -a 256 verdicts.json
python3 -I -B compare.py verdicts.json wa/vectors compare.json
```

Run the commands from this directory. The `shasum -c` line should print `OK` for all 113 files.
`verdicts.json` should have the SHA-256 given above for `verdicts_01_112.json` (the recorded run used
Python 3.14.7), and `compare.py` should print `agree 112 of 112`.

## What changed from the 1.4.4 checker

`war145_check.py` is the 1.4.4 checker of 2026-11-04 (which scored 109 of 109 on vectors 01-109 at
profile 1.4.4) with step 12 of the 1.4.5 text added and nothing else changed. Step 12 is the optional input
`relying_party_keys`: when it is supplied, the record claims that the producer and the checker are separate parties
(the independence value that names them apart) and the producer states a `key_id`, the producer's key counts only when the same decoded key bytes are found among the
decoded `relying_party_keys` entries. The key_id of the relying party's entry is not compared, and an entry
that is not canonical base64 matches nothing. Without `relying_party_keys` nothing changes. The readings
are R23 to R25 in `READINGS145.md`. No vector in 01-112 separates comparing the key bytes only from also
comparing the `key_id`.

Compared with the 1.4.4 checker on the same 112 vectors, only the outputs for 110 and 112 change: both
now carry `INDEPENDENCE_INCONSISTENT`. Vector 111 gives no problems and no warnings with either checker,
so it does not by itself show that step 12 is implemented.

## What was seen before the run

This run was not blind, and the result should be read as a check that the checker matches the vectors,
not as an unprompted reading of the text.

- Before step 12 was added, the unchanged 1.4.4 checker had been scored on the same 112 vectors. It agreed
  on 110 and differed on 110 and 112, so the `expected` results of vectors 110 to 112 had been seen when
  step 12 was written.
- Also read before step 12 was written: the step 12 text, the Changelog line for 1.4.5, the vector table
  rows for 110 to 112, and the README line saying that the reference verifier agrees with all 112.
- `mask144.py` and `compare.py` are the scripts of the earlier runs, unchanged. The docstring of
  `compare.py` ("written before the expected values were opened") refers to the first run on profile
  1.4.3, not to this one.
- No reference verifier code and no other implementer's code was opened.

## Not run

- The vectors under `composition/` and `interop/`, and `check_payment.py`.
- `criteria_hash` `not_supplied` and the delivered-file check of step 3 (no vector in 01-112 carries a
  delivered file).

## Licence

The files in this directory are under the licence of this repository (MIT, see `LICENSE` at the root).
The upstream vectors are CC0-1.0 and are not included.
