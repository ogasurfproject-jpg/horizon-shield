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
java -jar nenrin-verify-java-0.1.0.jar furui-day 2026-11-03 --leaf 0
java -jar nenrin-verify-java-0.1.0.jar resume-admission https://shield.the-horizons-innovation.com/ <record_sha256>
java -jar nenrin-verify-java-0.1.0.jar furui-vectors verify_vectors.json
```

Or build it yourself (no build tool):

```sh
javac --release 17 -d out $(find src -name '*.java')
printf 'Main-Class: dev.horizonshield.nenrin.Main\n' > manifest.txt
jar --create --file nenrin-verify.jar --manifest manifest.txt -C out .
java -jar nenrin-verify.jar furui-vectors ../furui-check-day-v0/verify_vectors.json
```

As a library: `Furui.furuiDay(day, leaf, Furui.HTTP)` and `Furui.resumeAdmission(endpoint, sha, Furui.HTTP)` return
the answer as a map; `Furui.summary(answer)` is the form the vectors compare.

Exit codes: 0 ok, 1 fail, 3 not_yet, 2 usage or network error. The network is GET only, only
https://ledger.horizonshield.dev and https://furui.horizonshield.dev, with no redirects.
