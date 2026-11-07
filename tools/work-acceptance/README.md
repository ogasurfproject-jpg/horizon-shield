# Work-acceptance record: a second checker, profile 1.4.7 on vectors 01-115

This directory holds a checker for work-acceptance records (schema `trilatic.acceptance-receipt/1.2`)
written from the README text of
[maximusrufus/work-acceptance-record](https://github.com/maximusrufus/work-acceptance-record), and the
records of its runs against the conformance vectors of that repository:

| checker | profile | vectors | tag | result |
|---|---|---|---|---|
| `war147_check.py` | 1.4.7 | 01-115 | `v1.4.7` | **115 of 115 agree with `expected`** |
| `war145_check.py` | 1.4.5 | 01-112 | `v1.4.5` | 112 of 112 agree with `expected` |

Both self-tests pass. Neither run was blind. See "What was seen before the change" for 1.4.7 and
"What was seen before the run" for 1.4.5.

## Profile 1.4.7 run (vectors 01-115)

### Upstream pin

| | |
|---|---|
| repository | https://github.com/maximusrufus/work-acceptance-record |
| tag | `v1.4.7` (lightweight tag) |
| commit | `6f7a075fe71116a723a1b222c1199bf1742ac71d` |
| tree | `2d35a9590696b1777954310be85d5cc554a5358d` |
| commit date | 2026-11-06T21:14:36Z |
| files read | `README.md` and `vectors/` only |
| SHA-256 of each file read | `SHA256SUMS_data_6f7a075.txt` (116 lines: `README.md` and the 115 vectors) |
| SHA-256 of that list | `e0ace57fc37110e1e552042c0c5259f9cb5fd275f79e1540dd5a050c844dd132` |

Vectors 01-112 at `6f7a075` have the same SHA-256 as at `066315f` (the `v1.4.5` list); only `README.md`
changed among the files read, and vectors 113-115 are new. Release 1.4.6 (`0fed63f`) changed licences only.
As before, the vectors are not copied here, and `verifier/`, `composition/` and `interop/` of the upstream
repository were not opened.

### What changed from the 1.4.5 checker

Profile 1.4.7 adds one sentence to step 12: "The producer's key must pass step 2's point rule (a canonical
point of prime order): a small-order key such as the neutral point is held by no one and identifies no
producer, so it never establishes the producer's key and derived independence is `self-checked` (114, 115)."
Vector 113 (a repeated `key_id` inside `relying_party_keys`, matched by key) came with release 1.4.7 too;
the 1.4.5 checker already agreed with it, because it never compares the `key_id` of those entries.

`war147_check.py` is `war145_check.py` with two code lines changed and nothing else:

1. Step 12: the producer's key counts only when it also passes the point rule (R27 in `READINGS147.md`).
   A neutral-point producer key found in `relying_party_keys`, under its own `key_id` (114) or another
   one (115), now gives derived `self-checked` and so `INDEPENDENCE_INCONSISTENT`.
2. A checker or producer key that is canonical base64 but fails only the point rule, and is not the key
   named by the signed `key_id`, is no longer `KEY_REJECTED` (R26). Step 2 says the rule "applies to the key
   named by the signed `receipt.key_id` only", and the expected result of 114 and 115 has no `KEY_REJECTED`.
   `KEY_REJECTED` for a party key stays for non-canonical base64 and for repeated identifiers.

Compared with `war145_check.py` on the same 115 masked vectors, only the outputs for 114 and 115 change.
The outputs for 01-112 are byte for byte the entries of `verdicts_01_112.json`. No vector in 01-115 has a
party key, other than the signer's, that fails only the point rule without `relying_party_keys`, so the
vectors do not separate R26 from keeping `KEY_REJECTED` in that case.

### What was seen before the change

This change was written after the expected results of vectors 114 and 115 were known. It is a check that
the checker matches the vectors, not a blind reading of the 1.4.7 text.

- The unchanged `war145_check.py` was first run on vectors 01-115 at `6f7a075`. It agreed on 113 and differed
  on 114 and 115: it gave `KEY_REJECTED` where `expected` has `INDEPENDENCE_INCONSISTENT`. Both readings
  (R26, R27) were chosen after that difference and after the `expected` objects of 111, 114 and 115 had been
  read in full.
- Also read before the change: the 1.4.7 text of step 12 and step 2, the Changelog lines for 1.4.5 and 1.4.7,
  the vector table rows for 109 to 115, the Implementations table, the README diff from `066315f` to `6f7a075`,
  and the README line saying that the reference verifier implements profile 1.4.7 and agrees with all 115.
- `mask144.py` and `compare.py` are unchanged. No reference verifier code and no other implementer's code
  was opened.

### Files for 1.4.7

| file | what it is |
|---|---|
| `war147_check.py` | the 1.4.7 checker. One Python file, standard library only, the same imports as `war145_check.py`. It opens no network connection and fetches nothing. |
| `READINGS147.md` | R26 and R27, the readings added for 1.4.7, with the other reading of each. |
| `RUN_LOG147.txt` | the log of the run: sandbox profile, network probe, Python version, SHA-256 of the scripts and of the vector list, the frozen verdicts' SHA-256, the comparison result, the check against `verdicts_01_112.json` and the difference from `war145_check.py`. |
| `verdicts_01_115.json` | the checker's output for vectors 01-115, frozen before the comparison. SHA-256 `668b0c42207816f111972789847fe006f21710fe2c3eb57a3be21abe6327ac0c`. |
| `compare_01_115.json` | the output of `compare.py`: `"agree": 115`, `"vectors": 115`, no differences. |
| `SHA256SUMS_data_6f7a075.txt` | SHA-256 of the upstream `README.md` and of each of the 115 vectors at `6f7a075`. |

### How to rerun 1.4.7

Only the first command uses the network. The run recorded here had outbound network access blocked by
the macOS sandbox (`sandbox-exec`), and a connection test to an outside address failed inside the same
sandbox before the run (see `RUN_LOG147.txt`).

```
git clone https://github.com/maximusrufus/work-acceptance-record wa
git -C wa checkout 6f7a075fe71116a723a1b222c1199bf1742ac71d
(cd wa && shasum -a 256 -c ../SHA256SUMS_data_6f7a075.txt)
python3 -I -B mask144.py wa/vectors masked 1 115
python3 -I -B war147_check.py --selftest
python3 -I -B war147_check.py masked verdicts.json
shasum -a 256 verdicts.json
python3 -I -B compare.py verdicts.json wa/vectors compare.json
```

Run the commands from this directory. The `shasum -c` line should print `OK` for all 116 files.
`verdicts.json` should have the SHA-256 given above for `verdicts_01_115.json` (the recorded run used
Python 3.14.7), and `compare.py` should print `agree 115 of 115`.

### Not run (1.4.7)

- The vectors under `composition/` and `interop/`, and `check_payment.py`.
- `criteria_hash` `not_supplied` and the delivered-file check of step 3 (no vector in 01-115 carries a
  delivered file).

## Profile 1.4.5 run (vectors 01-112)

The text below is the record of the 1.4.5 run as it was first published, with its headings moved one level
down. Its files are unchanged.

### Upstream pin

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

### Files

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

### How to rerun

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

### What changed from the 1.4.4 checker

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

### What was seen before the run

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

### Not run

- The vectors under `composition/` and `interop/`, and `check_payment.py`.
- `criteria_hash` `not_supplied` and the delivered-file check of step 3 (no vector in 01-112 carries a
  delivered file).

## Licence

The files in this directory are under the licence of this repository (MIT, see `LICENSE` at the root).
The upstream vectors are CC0-1.0 and are not included.
