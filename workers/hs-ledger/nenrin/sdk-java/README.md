# nenrin-verify (Java)

The Java port of `nenrin-verify furui-day` and `nenrin-verify resume-admission`: check one leaf of the content check
runner's day, or one admissions[] line of a Resume, against the public NENRIN ledger. Java 17 or later, standard
library only (Ed25519, SHA-256 and HTTP from the JDK, a small JSON reader of its own), no dependency, one jar. It
runs the shared vectors (`../furui-check-day-v0/verify_vectors.json`) and CI compares its answers line by line with
the Python and JavaScript ports. See `../furui-check-day-v0/VERIFY.md` for the checks.

The chain these commands sit in has five names: FURUI (篩, the content check runner) → SEKI admission (関の扉, the door
that signs an admission) → MUSUBI settle (結の精算, the settlement of a contract) → NENRIN ledger (年輪の台帳, anchored to
Bitcoin) → Résumé. TOOSHI checks the whole chain every day, and TSUGI (継) calls outside witnesses by a public draw.

## Get it

A release is a GitHub release `nenrin-verify-java-vX.Y.Z` of this repository with the jar, the source zip and
`SHA256SUMS`, built by `.github/workflows/nenrin-verify-java-release.yml` on GitHub's runner.

```sh
shasum -a 256 -c SHA256SUMS
java -jar nenrin-verify-java-0.3.0.jar furui-day 2026-11-03 --leaf 0
java -jar nenrin-verify-java-0.3.0.jar furui-day 2026-11-10 --leaf 0 --runner 2
java -jar nenrin-verify-java-0.3.0.jar resume-admission https://shield.the-horizons-innovation.com/ <record_sha256>
java -jar nenrin-verify-java-0.3.0.jar furui-day 2026-11-03 --leaf 0 --bitcoin-header
java -jar nenrin-verify-java-0.3.0.jar furui-vectors verify_vectors.json
```

Or build it yourself (no build tool):

```sh
javac --release 17 -d out $(find src -name '*.java')
printf 'Main-Class: dev.horizonshield.nenrin.Main\n' > manifest.txt
jar --create --file nenrin-verify.jar --manifest manifest.txt -C out .
java -jar nenrin-verify.jar furui-vectors ../furui-check-day-v0/verify_vectors.json
java -jar nenrin-verify.jar furui-vectors ../furui-check-day-v0/bitcoin_header_vectors.json
```

`--runner 1|2` (0.3.0, furui-day) (1 when left out): runner 2 reads runner-2's day tree at `https://furui.horizonshield.dev/furui2/day/`, and wants key_id runner-2 on the day record and on the envelope and runner_id runner-2 on the day record (a runner-1 record may name runner_id runner-1 or leave it out; a record that names another runner is refused at step 5). Without the flag the answers are those of the version before, except that a runner-1 day record that names runner_id runner-1 is now read instead of refused for its shape. `Furui.furuiDay(day, leaf, g, bitcoinHeader, headerGet, runner)` in the library.

`--bitcoin-header` (0.2.0, either command): after the anchor, the block header at the proof's height from
mempool.space and blockstream.info (the same block hash and the same 80 byte header from both, sha256d to that hash,
the hash under the target of the header's own bits, the merkle root the proof commits to). Without the flag nothing
changes and no explorer is asked. The same answers as the other three ports on `bitcoin_header_vectors.json`.

As a library: `Furui.furuiDay(day, leaf, Furui.HTTP)` and `Furui.resumeAdmission(endpoint, sha, Furui.HTTP)` return
the answer as a map (`Furui.furuiDay(day, leaf, Furui.HTTP, true, Furui.HTTP_EXPLORER)` with the header step);
`Furui.summary(answer)` is the form the vectors compare.

Exit codes: 0 ok, 1 fail, 3 not_yet, 2 usage or network error. The network is GET only, only
https://ledger.horizonshield.dev and https://furui.horizonshield.dev, with no redirects; with `--bitcoin-header` also
https://mempool.space and https://blockstream.info (four GETs, sending only the block height and the block hash).
