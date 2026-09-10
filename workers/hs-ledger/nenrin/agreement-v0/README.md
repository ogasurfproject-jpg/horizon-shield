# agreement-v0

Offline reference implementation of the agreement record. Two schemas, one program, no service.

| schema | draft | status |
| --- | --- | --- |
| `a2a-agreement-v1` | [`ops/AGREEMENT_EXT_v0_DRAFT.md`](../../../../ops/AGREEMENT_EXT_v0_DRAFT.md) | anchored as JIDEC entry 39. Read exactly as written, never corrected |
| `a2a-agreement-v1.1` | [`ops/AGREEMENT_EXT_v0_1_DRAFT.md`](../../../../ops/AGREEMENT_EXT_v0_1_DRAFT.md) | every hole found in v0 and in the v0 verifier, closed |

A `conduct-v1` record is one sided: somebody measured somebody. This record is the other half: at
time T, party A and party B both signed the same bytes describing terms, and each of them pinned,
by sha256, a conduct record about the other. Under v1.1 that record must have been written by
somebody who is neither party, unless the record declares otherwise and pays for it: a self
measured record is accepted only when it says so, and the sentence about third party measurement
then disappears from what the record establishes.

| file | what it does |
| --- | --- |
| `agreement_verify.py` | reads a record, answers `accepted` / `refused` / `incomplete` with reasons |
| `agreement_sign.py` | one party adds its own signature, on its own machine |
| `agreement_redteam.py` | 194 vectors: 119 attacks, 57 controls, 12 misclassifications, 6 residuals. A few seconds |
| `agreement_mutation.py` | breaks the verifier one rule at a time and checks the adversary notices. 74 mutants, two to three minutes. It mutates a copy in a temporary directory and never touches this one |
| `agreement_fixture.py` | freezes 5,283 inputs and the report the verifier gave for each, as one compressed envelope with a sha over it |
| `agreement_strings.py` | the 419 sentence templates and 46 refusal codes the reports are built from, folded out of the fixture |
| `agreement_float_repr.py` | 17,759 doubles as raw bits beside what Python's `json.dumps` wrote for each. The float table |
| `agreement_readback.py` | 173 pieces of JSON text beside what `parse_strict` did with each: the bytes it produced, or the name it refused by |
| `agreement_canonical.mjs` | the canonical byte form and the record reader, in JavaScript. The first piece of the second implementation |
| `agreement_canonical_test.mjs` | 53 checks: unit vectors, both Python tables, and 20.4 MB of fixture bytes round tripped through two readers |
| `agreement_canonical_mutation.mjs` | breaks `agreement_canonical.mjs` 33 ways and checks the suite notices. Also works on a copy |
| `run_all.mjs` | runs every suite in this directory and refuses to report if any file here has not declared what it is |
| `run_all_test.mjs` | 32 checks on the runner itself, because a runner that skips a suite quietly is worse than no runner |
| `agreement_verify.mjs` | the verifier's rules, in JavaScript. The second implementation |
| `agreement_verify_test.mjs` | all 5,283 frozen cases through it, byte for byte against the frozen report |
| `agreement_verify_mutation.mjs` | breaks a rule in `agreement_verify.mjs` 33 ways and checks the 5,283 notice |
| `readme_numbers_test.mjs` | every count this table states, derived from the files and the suites, so the table cannot go stale quietly |
| `agreement_pyrepr.py` | 831 values beside what Python's `repr` wrote for each. The refusal messages are made of it |

There is no intake, no KV, no ring column, no fee, no URI. Those come when a real pair of parties
has a real agreement to record. A record layer built before it has two parties is an empty
exchange, and an empty exchange is worse than none.

## Run it

```
node run_all.mjs                        # everything, about six minutes
```

`run_all.mjs` holds no list of suites. Every `.py` and `.mjs` file here declares what it is in a
single comment line, `# RUN_ALL: suite --selftest` or `# RUN_ALL: library`, and a file that
declares nothing makes the runner refuse to run at all rather than skip it quietly. That is the
one failure it is built to prevent: a test added and never run. What it cannot see is a suite
deleted from this directory, because it holds no list to miss it from. That guard belongs to git.

One at a time, if you want them one at a time:

```
python3 agreement_redteam.py            # 185 / 185, needs cryptography, no network
python3 agreement_mutation.py           # 74 / 74, only worth running after editing the verifier
node agreement_canonical_test.mjs       # 44 / 44, the JavaScript byte form against Python's
```

A v1.1 record end to end, in full, because a quickstart that needs a step you have to guess is
not a quickstart. The keys go INSIDE the record, which is what lets it verify offline forever.
Run this from this directory; it works in a scratch directory and writes nothing here:

```
V=$PWD
mkdir -p /tmp/agr && cd /tmp/agr
openssl genpkey -algorithm ed25519 -out a.pem
openssl genpkey -algorithm ed25519 -out b.pem
python3 $V/agreement_verify.py --example > rec.json
python3 $V/agreement_sign.py --pubkey a.pem > pa.json
python3 $V/agreement_sign.py --pubkey b.pem > pb.json
python3 -c 'import json; r=json.load(open("rec.json")); r["parties"][0]["public_key_ed25519_b64"]=json.load(open("pa.json"))["public_key_ed25519_b64"]; r["parties"][1]["public_key_ed25519_b64"]=json.load(open("pb.json"))["public_key_ed25519_b64"]; open("rec.json","w").write(json.dumps(r,ensure_ascii=False,sort_keys=True,separators=(",",":")))'
python3 $V/agreement_sign.py rec.json --key a.pem --domain party-a.example --out rec.json
python3 $V/agreement_sign.py rec.json --key b.pem --domain party-b.example --out rec.json
python3 $V/agreement_verify.py rec.json --quiet
python3 -c 'import json; json.dump({"https://party-a.example/keys/agreement.json": json.load(open("pa.json")), "https://party-b.example/keys/agreement.json": json.load(open("pb.json"))}, open("keys.json","w"))'
python3 $V/agreement_verify.py rec.json --keys keys.json --quiet
```

The first verify prints `accepted ... signatures_checked=True key_urls_checked=False`, from the
record alone with no key file anywhere. The second adds `key_urls_checked=True`, and only then does
the report claim the signatures are attributable to those domains.

`--example-v1` prints the v1 template instead; under v1 the keys live only at `key_url`, so
`--keys` is required before anything can be accepted. Exit codes: `0` accepted, `1` refused,
`2` incomplete.

## The rule that matters

**The verdict is never `accepted` unless an Ed25519 verification actually ran and passed for both
parties.** A verifier that says accepted without that launders a one sided record into a two sided
claim, which is the exact failure this layer exists to prevent.

That flag is derived from the evidence printed in the report, never set beside it. It has to be:
`agreement_mutation.py` found on 2026-09-10 that replacing it with the constant `true` left the
whole adversary green. A flag that can disagree with the list it summarises is a flag that will.

## What 74 out of 74 does not mean

It means the 74 rules somebody wrote a mutant for are tested. It says nothing about the rules
nobody wrote one for, and the difference is not small. Before asking an outside reviewer to find a
mutant this adversary misses, the operator went looking first: eleven candidates outside the list,
**ten of which survived**. Every rule they broke already existed in the verifier. What was missing
was a vector. A second hunt, twelve more candidates, found two more that were real, and the first
of those is the one that matters: `under_domain` compares a host against a domain, and dropping
the dot from the boundary makes `evilparty-a.example` count as being under `party-a.example`. That
one function carries `bad_key_url`, `self_agreement`, `conduct_subject_wrong` and
`recorder_undisclosed`, and not one vector had used a lookalike domain against it.

A third hunt, eighteen more candidates, found the heaviest one of all. **`canonical()` itself had
no vector.** Stop sorting keys, escape the non-ASCII, loosen the separators to the JSON defaults,
and all 166 vectors stayed green, in a program whose entire claim is that two implementations
reach the same bytes. The form is pinned as bytes now, in four vectors that compare exact strings,
and so are the signed bytes for both schemas. The same hunt found that the non-canonical point
encoding bound was carrying real weight: `y = p + 1` reduces to the identity element's `y`, but
compares unequal to it before reduction, so with that bound removed the identity slips through a
subgroup test as a valid key. One of nineteen possible non-canonical encodings does that.

All of them are closed and all of them are in the mutant list. The lesson is kept here rather than
tidied away: a green suite is evidence about the vectors, not about the program.

Everything is offline on purpose. Nothing fetches `key_url`, the agent cards, the conduct records,
or a ledger. Two people holding the same record reach the same answer, and neither of them has to
be able to reach this operator. Reachability is the intake's problem (503, retry), not a verifier's.

## What the report separates

`signatures_checked` and `key_urls_checked` are two different questions, and `establishes` changes
with both. A v1.1 record verifies from its own bytes; adding a key file additionally proves the
signing key is the one that party serves at its own domain, and only then does the report claim
attribution to the domain. This is gate 0.4.4's discipline: what a record proves moves with the
facts, the verdict does not.

`findings` never change the verdict. They are written into the report so a reader sees what the
verifier saw and could not decide: a recorder that is a party, a conduct record measured by one of
the parties, two domains under one parent, an agreed_at in the future.

## Refusals

The v1 draft's section 4 names eight, and all eight are implemented:
`one_sided`, `signatures_disagree`, `self_agreement`, `bad_key_url`, `key_url_unreachable`,
`missing_conduct_sha`, `disclaimer_missing`, `fee_tied_to_outcome`.

Every refusal in a report carries `in_draft: true` or `false`, so a reader can tell the v1 draft's
rules from everything added since without reading any code. The full v1.1 list is section 4 of the
v0.1 draft, and `agreement_redteam.py` checks that the document and this program name exactly the
same codes, so the two cannot drift apart quietly.

## What building and then attacking the verifier found

Twenty one items, all closed in v1.1, all listed with their reasons in section 6 of the v0.1
draft. The v0 draft is not rewritten: its sha is anchored, and a dated draft whose text moves
afterwards is worth nothing. Six came from attacking the verifier rather than reading the draft:

1. **A lone surrogate killed the verifier.** `"\ud800"` is valid JSON, survives the parser, and
   then cannot be encoded as UTF-8. Found by fuzzing. A reader that dies has not refused anything.
2. **Five thousand levels of nesting killed it too**, along with every other recursive reader.
   Depth, node count, string length, array length and total size are now bounded, and checked
   iteratively before anything is canonicalized.
3. **A `key_url` that was a list, not a string**, raised TypeError. Found by fuzzing.
4. **The verifier's own `establishes` failed its own overclaim guard.** It said the record
   discloses "who paid for it", which its own rule reads as a claim that the deal was paid.
5. **`signatures_checked` could be set to a constant and no vector noticed.** Found by mutation.
6. **A public key of small order** makes one signature verify under many messages. The subgroup
   check is now done from first principles in pure python, with no library and no blocklist:
   a key is refused unless L times the point is the identity and the point is not.

And two more came from trying to build the first real record with a real counterparty
(`ops/agreement_first_record_federico_20260910.md`), which no fixture would ever have revealed:
an agreement with no price could not be written at all, and the conduct subject had to match the
party domain exactly, which rejected the only conduct record that actually exists between those
two parties. Using a thing is what finds its holes.

Two came from the documentation and the tooling around the code rather than the code. The
quickstart in this README told a reader to print a public key and never told them to put it into
the record, so following it literally produced a template still carrying a placeholder and a
signer that refused. It is written out in full now and a vector checks that it stays that way.
And running this adversary in the same directory as a mutation run in flight reads a verifier that
somebody else is editing: one vector went red, and the defect was not there. The suite now refuses
to run at all when the mutation tool's backup file is present, except for the mutation tool itself.

One more came from the tool itself. `agreement_mutation.py` claimed it restored the file it edits
"on every exit path, including a crash and a Ctrl-C". That was false for SIGTERM, which python
ends the process on without running a finally block. A command timeout sent exactly that signal
mid-run and left a mutant sitting in `agreement_verify.py`; the next run of the adversary went red
and the line was found by hashing the file against a copy on another machine. Nothing was
committed, and it could as easily have been. The tool now writes a backup beside the file before
the first mutation and recovers from it on the next run, so even a SIGKILL leaves a way back.

## The second implementation, and how far it has got

The intake stays shut until two implementations of this verifier agree. Not agree in the sense
that both were written from the same document: agree in the sense that they were run against the
same 5,283 inputs and gave the same answer, byte for byte, and that somebody broke each of them on
purpose to check the comparison could tell.

Three layers have to agree, and they are not equally hard.

**What a record IS, as bytes.** Done, 2026-09-10. `agreement_canonical.mjs` writes the same bytes
as `json.dumps(obj, sort_keys=True, separators=(",",":"), ensure_ascii=True)`. Four places where
the two languages part company unless made not to: key order (Python sorts by code point,
JavaScript by UTF-16 code unit, and the two disagree above the BMP), escaping, integers past 2^53
(the fixture holds 376 copies of 2^70, and `JSON.parse` turns that into a different number), and
floats (Python writes `1.0` and `1e+16` and `1e-07` where JavaScript writes `1` and
`10000000000000000` and `1e-7`). The proof is the fixture's own 20.4 MB of canonical bytes read,
parsed, written back, and compared byte for byte, plus 17,759 doubles that Python wrote the
answers for. 33 deliberate breakages, 32 caught, 1 proved equivalent rather than excused.

**What a record can be READ as.** Done, 2026-09-10, and it moved a rule. The JavaScript reader was
written to refuse `NaN` and `Infinity`, which felt obviously right. Run against the real
`parse_strict`, it disagreed: Python reads them, and the refusal comes later, from the verifier,
under the name `unsafe_number`. Two programs that both refuse a record but call it different
things have not agreed. The JavaScript now reads what Python reads and refuses what Python
refuses, by the same names, and 173 pieces of text hold that in place.

**What a record MEANS.** Done, 2026-09-10. Every rule is written twice, and the two agree on all
5,283 frozen cases, byte for byte across the whole report: verdict, every refusal code and its
English sentence, every finding, the per signature results, the two shas and the two lists of what
the record does and does not establish.

Getting there moved the reference implementation once, and that is the part worth keeping. The
JavaScript disagreed on 2 cases out of 5,221. The check that settled it was running the PYTHON
against its own frozen fixture, where it failed the same 2. `measure` returns early at the depth
limit, so the node count it reports depended on which subtree it descended first, which depended on
dict insertion order, which JSON does not carry. The sentence "holds N nodes" was a number no
second implementation could reproduce, and the fix was to walk children in sorted key order, the
same as `scan_text` and `scan_numbers` already did. The verdict never depended on it. A value the
reference implementation cannot reproduce from the recorded input was never a specification.

Then the mutation battery, because 5,283 out of 5,283 is a statement about the contract as much as
about the code. 33 deliberate breakages of the JavaScript rules: 26 were caught at once, 1 is
equivalent and says why, and **6 survived because the contract did not cover the rule they broke**.
Not one of the 6 was a defect in the JavaScript. They were holes in the 5,221 cases: no record with
a field over the length limit made of astral characters, none with a tab, none where the order of
two `bad_text` refusals was observable, none with U+0085 around a hostname, none with an overclaim
word glued to a non ASCII character on either side. The adversary has vectors for all of them now,
the fixture is 5,283 cases, and the mutants die.

One survives on purpose. `refuse` and `find` share one seen set, so the same (code, why) cannot
appear as both. No rule produces that collision today, so separating the sets changes nothing.
That is not asserted: a residual vector measures it across every record, and the day it goes red
the mutant stops being equivalent.

## What an `accepted` verdict does not establish

That either party performed, or that money moved. That the record is a contract, or that the terms
are lawful, fair or complete. That either party is solvent, competent or honest. That the conduct
records named are accurate, only that they are the records that were pinned. That the key each
party signed with is the key it serves at its `key_url`, unless `key_urls_checked` is true. That
this record was filed anywhere, or that it is the only one these parties signed. Anything about
time: the anchor bounds `agreed_at` from above and this program never sees one.

Two keys signing the same bytes is not two humans agreeing. It is two keys.
