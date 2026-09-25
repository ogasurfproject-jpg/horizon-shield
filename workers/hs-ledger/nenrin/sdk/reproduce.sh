#!/usr/bin/env bash
# reproduce.sh: rebuild nenrin-verify@<version> from the commit npm says it came from, and compare the result
# to the registry's tarball, byte for byte.
#
# Why. The provenance attestation (npm publish --provenance from GitHub Actions) says which commit and which
# workflow produced the tarball. That is a statement by GitHub and npm. This script is the independent check:
# your machine, the public source, npm pack, one hash. If the hash matches, the verifier you installed is what
# the source you can read builds. If it does not, trust neither until someone explains the difference.
#
# Needs git, npm (>= 7, whose pack output is deterministic), openssl, tar. No account, no token, no trust in HS.
# Network: the npm registry and github.com, read only. Nothing is installed globally; everything lands in a
# temporary directory that is printed at the end so you can inspect it.
#
#   ./reproduce.sh 0.2.1
#   REPO=https://github.com/<your fork>/horizon-shield.git ./reproduce.sh 0.2.1
set -euo pipefail

V="${1:?usage: reproduce.sh <version>   (for example 0.2.1)}"
PKG="nenrin-verify"
REPO="${REPO:-https://github.com/ogasurfproject-jpg/horizon-shield.git}"
DIR="workers/hs-ledger/nenrin/sdk"

for tool in git npm openssl tar; do
  command -v "$tool" >/dev/null 2>&1 || { echo "missing: $tool"; exit 3; }
done

C=$(npm view "$PKG@$V" gitHead 2>/dev/null || true)
I=$(npm view "$PKG@$V" dist.integrity 2>/dev/null || true)
if [ -z "$C" ] || [ -z "$I" ]; then
  echo "npm does not report gitHead and dist.integrity for $PKG@$V; nothing to reproduce against"; exit 3
fi

T=$(mktemp -d)
echo "work dir: $T"

# 1. the exact source: one commit, fetched by its sha, blobs only for the one directory we archive
git init -q "$T/repo"
git -C "$T/repo" remote add origin "$REPO"
git -C "$T/repo" fetch -q --depth 1 --filter=blob:none origin "$C"
git -C "$T/repo" archive FETCH_HEAD "$DIR" | tar -x -C "$T"

# 2. build the tarball the way the publish workflow does: npm pack, no scripts
( cd "$T/$DIR" && npm pack --ignore-scripts --silent >/dev/null )
BUILT="$T/$DIR/$PKG-$V.tgz"
H="sha512-$(openssl dgst -sha512 -binary "$BUILT" | base64 | tr -d '\n')"

# 3. the registry's own bytes, hashed here rather than trusted from metadata
mkdir -p "$T/registry"
( cd "$T/registry" && npm pack --ignore-scripts --silent "$PKG@$V" >/dev/null )
HR="sha512-$(openssl dgst -sha512 -binary "$T/registry/$PKG-$V.tgz" | base64 | tr -d '\n')"

echo "package:                 $PKG@$V"
echo "commit (npm gitHead):    $C"
echo "registry dist.integrity: $I"
echo "registry tarball, hashed here: $HR"
echo "rebuilt from source:     $H"
if [ "$H" = "$I" ] && [ "$H" = "$HR" ]; then
  echo "REPRODUCED: $PKG@$V is, byte for byte, what commit $C builds"
  exit 0
fi
echo "NOT REPRODUCED: the registry tarball is not what commit $C builds. Do not run either until the difference is explained."
echo "  diff the two trees: tar -xzf $BUILT -C $T/a; tar -xzf $T/registry/$PKG-$V.tgz -C $T/b; diff -r $T/a $T/b"
exit 2
