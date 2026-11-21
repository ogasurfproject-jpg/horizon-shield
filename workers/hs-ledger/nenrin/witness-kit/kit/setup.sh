#!/usr/bin/env bash
# furui-witness-kit 0.1.0 setup. Run it once in the root of your own public repository that holds the kit files.
#   bash setup.sh "Your Name"        make a key, store it as a repository secret, publish the public key, start the workflow
#   bash setup.sh --rotate           make a new key; the old key file stays in keys/ and status.json names it as previous
# It needs gh (logged in), git, python3 and openssl 3 or later. It sends nothing to the operator.
# The private key exists only in a temporary folder on this machine until gh has stored it as a secret; then it is removed.
set -euo pipefail
die() { echo "setup.sh: $*" >&2; exit 1; }
for c in gh git python3 openssl; do command -v "$c" >/dev/null || die "$c is not installed"; done
[ -f furui_witness.py ] && [ -f .github/workflows/furui-witness.yml ] || die "run this in the root of the repository that holds the kit files"
gh auth status >/dev/null 2>&1 || die "gh is not logged in (gh auth login)"
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner) || die "gh does not see a GitHub repository here"
[ "$(gh repo view --json visibility -q .visibility)" = "PUBLIC" ] || die "$repo must be public, so that anyone can read your key and answers"
owner=${repo%%/*}; name_part=${repo#*/}
owner_l=$(printf '%s' "$owner" | tr 'A-Z' 'a-z')
site="https://${owner_l}.github.io/${name_part}"
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)

rotate=0; wname=""
if [ "${1:-}" = "--rotate" ]; then rotate=1; [ -f status.json ] || die "--rotate needs the status.json of an earlier setup"
else wname="${1:-}"; [ -n "$wname" ] || die "give your name as the witness: bash setup.sh \"Your Name\""
  printf '%s' "$wname" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$' || die "the name takes letters, digits, space . _ - (up to 64)"
  [ ! -f status.json ] || die "status.json is already here; use --rotate to change the key"
fi

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT; chmod 700 "$tmp"
openssl genpkey -algorithm ed25519 -out "$tmp/k.pem" 2>/dev/null || die "this openssl cannot make an Ed25519 key"
chmod 600 "$tmp/k.pem"
pub_b64=$(openssl pkey -in "$tmp/k.pem" -pubout -outform DER | tail -c 32 | base64)
kid16=$(printf '%s' "$pub_b64" | base64 -d | python3 -I -c 'import hashlib,sys;print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest()[:16])')
mkdir -p keys answers
printf '{"public_key_ed25519_b64":"%s"}\n' "$pub_b64" > "keys/$kid16.json"
key_url="$site/keys/$kid16.json"
python3 -I -B - "$rotate" "ed25519:$kid16" "$now" <<'PY'
import json, sys
rotate, kid, now = sys.argv[1] == "1", sys.argv[2], sys.argv[3]
if rotate:
    s = json.load(open("status.json"))
    assert s.get("schema") == "furui-witness-status-v0", "status.json is not furui-witness-status-v0"
    s["previous_key_ids"] = s.get("previous_key_ids", []) + [{"key_id": s["current_key_id"], "until": now}]
else:
    s = {"schema": "furui-witness-status-v0", "previous_key_ids": [], "revoked": []}
s.update(current_key_id=kid, updated_at=now)
open("status.json", "w").write(json.dumps(s, indent=2, sort_keys=True) + "\n")
PY
touch .nojekyll answers/.gitkeep

echo "1/4 storing the private key as the secret FURUI_WITNESS_KEY of $repo"
gh secret set FURUI_WITNESS_KEY --repo "$repo" < "$tmp/k.pem"
rm -f "$tmp/k.pem"
gh variable set FURUI_WITNESS_KEY_URL --repo "$repo" --body "$key_url"
[ "$rotate" = 1 ] || gh variable set FURUI_WITNESS_NAME --repo "$repo" --body "$wname"

echo "2/4 committing keys/$kid16.json and status.json"
git add .nojekyll answers/.gitkeep keys status.json
git commit -m "furui-witness: key ed25519:$kid16" >/dev/null
git push

echo "3/4 serving the repository with GitHub Pages ($site/)"
gh api "repos/$repo/pages" >/dev/null 2>&1 || gh api -X POST "repos/$repo/pages" -f "source[branch]=$(git branch --show-current)" -f "source[path]=/" >/dev/null
for i in $(seq 1 40); do
  got=$(curl -fsS --max-time 15 "$key_url" 2>/dev/null || true)
  [ "$got" = "{\"public_key_ed25519_b64\":\"$pub_b64\"}" ] && break
  [ "$i" = 40 ] && die "$key_url does not serve the new key after 20 minutes; run: gh workflow run furui-witness.yml, once it does"
  sleep 30
done

echo "4/4 starting the workflow once"
gh workflow run furui-witness.yml --repo "$repo"
echo "done: key ed25519:$kid16 at $key_url. Runs at 01:50 and 03:50 UTC; answers appear under $site/answers/"
