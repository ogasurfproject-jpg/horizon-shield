#!/usr/bin/env bash
# furui-witness-kit 0.2.0 setup. Run it once in the root of your own public repository that holds the kit files.
#   bash setup.sh "Your Name"
#       make a key, store it as a repository secret, serve the public key with GitHub Pages, start the workflow
#   bash setup.sh "Your Name" --key-url https://your.site/keys/witness.pub [--status-url URL] [--key-file FILE]
#       serve the public key from your own site: setup.sh prints the two small files to place there (the key file and
#       status.json); nothing of the key is published on GitHub Pages, and your answers carry your own domain
#   bash setup.sh --rotate [--key-url URL] [--key-file FILE]
#       change the key; the old key stays listed in status.json as previous
# --key-file takes an Ed25519 private key you already have: PEM, or an OpenSSH key without a passphrase. Without it a new
# key is made. A key URL ending in .pub serves one OpenSSH line (ssh-ed25519 ...); any other serves {"public_key_ed25519_b64"}.
# It needs gh (logged in), git, curl, Python 3.8 or later (python3, python or py) and openssl 3 or later. On Windows, run
# it from Git Bash or WSL (Python on Windows ends its printed lines in CR LF; every value read back from it here is
# stripped of CR). It sends nothing to the operator. The private key exists only in a temporary folder on this
# machine until gh has stored it as a secret; then it is removed.
if grep -q "$(printf '\r')" "$0" 2>/dev/null; then t=$(mktemp) && tr -d '\r' < "$0" > "$t" && export KIT_SELF_COPY="$t" && exec bash "$t" "$@"; fi #
set -euo pipefail
die() { echo "setup.sh: $*" >&2; exit 1; }
KIT_PY_SHA256="5e6703c45536e4d73d33ddc8bb6688c5382e03262c5dd01e46e928db7eb53e4d"

# ---- the tools ----
PY=""
for c in python3 python "py -3"; do
  if $c -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' >/dev/null 2>&1; then PY=$c; break; fi
done
[ -n "$PY" ] || die "Python 3.8 or later is not installed (tried python3, python and py -3)"
for c in gh git curl openssl; do command -v "$c" >/dev/null || die "$c is not installed"; done
openssl version 2>/dev/null | grep -Eq '^OpenSSL ([3-9]|[1-9][0-9])\.' || die "openssl 3 or later is needed, not $(openssl version 2>/dev/null) (macOS: brew install openssl@3, then put its bin first on PATH)"
[ -f furui_witness.py ] && [ -f .github/workflows/furui-witness.yml ] || die "run this in the root of the repository that holds the kit files"

# ---- the arguments ----
rotate=0; wname=""; key_url=""; status_url=""; key_file=""
if [ "${1:-}" = "--rotate" ]; then rotate=1; shift
elif [ $# -gt 0 ] && [ "${1#--}" = "$1" ]; then wname=$1; shift
fi
while [ $# -gt 0 ]; do
  case "$1" in
    --key-url) [ $# -ge 2 ] || die "--key-url takes a URL"; key_url=$2; shift 2 ;;
    --status-url) [ $# -ge 2 ] || die "--status-url takes a URL"; status_url=$2; shift 2 ;;
    --key-file) [ $# -ge 2 ] || die "--key-file takes a file"; key_file=$2; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done
if [ "$rotate" = 1 ]; then
  [ -f status.json ] || die "--rotate needs the status.json of an earlier setup"
else
  [ -n "$wname" ] || die "give your name as the witness: bash setup.sh \"Your Name\""
  printf '%s' "$wname" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$' || die "the name takes letters, digits, space . _ - (up to 64)"
  [ ! -f status.json ] || die "status.json is already here; use --rotate to change the key"
fi
if [ -n "$key_url" ]; then
  printf '%s' "$key_url" | grep -Eq '^https://[a-z0-9.-]+/[A-Za-z0-9._~/-]*[A-Za-z0-9._~-]$' || die "--key-url must be https://<your host>/<path to the key file>, lower-case host, no query"
  derived=$($PY -I -B -c 'import sys
u = sys.argv[1]; host_end = u.index("/", 8); path = u[host_end:]
base = path.rsplit("/", 1)[0]
base = base[:-len("/keys")] if base.endswith("/keys") else base
print(u[:host_end] + base + "/status.json")' "$key_url" | tr -d '\r')
  # the operator's audit reads status.json beside the key file, or one folder above it when the key file sits in keys/
  [ -z "$status_url" ] || [ "$status_url" = "$derived" ] || die "the audit reads status.json at $derived (beside the key file, or one folder above keys/), not at $status_url; place it there, or move the key"
  status_url=$derived
elif [ -n "$status_url" ]; then
  die "--status-url goes with --key-url; with GitHub Pages, status.json sits in this repository"
fi

gh auth status >/dev/null 2>&1 || die "gh is not logged in (gh auth login)"
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner) || die "gh does not see a GitHub repository here"
[ "$(gh repo view --json visibility -q .visibility)" = "PUBLIC" ] || die "$repo must be public, so that anyone can read your answers"
git config user.email >/dev/null || die "git has no user.email in this repository (git config user.email you@example.com)"
owner=${repo%%/*}; name_part=${repo#*/}
owner_l=$(printf '%s' "$owner" | tr 'A-Z' 'a-z')
site="https://${owner_l}.github.io/${name_part}"
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# ---- line endings: a copy made on Windows may carry CR LF; the runner must get the bytes of the release ----
for f in furui_witness.py setup.sh .github/workflows/furui-witness.yml .gitattributes; do
  if [ -f "$f" ] && grep -q "$(printf '\r')" "$f"; then tr -d '\r' < "$f" > "$f.lf" && mv "$f.lf" "$f"; echo "line endings of $f made LF"; fi
done
[ -f .gitattributes ] || printf '# furui-witness-kit: keep every file with LF line endings, also when the repository is checked out on Windows\n* text=auto eol=lf\n' > .gitattributes
got_sha=$($PY -I -B -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())' furui_witness.py | tr -d '\r')
[ "$got_sha" = "$KIT_PY_SHA256" ] || echo "note: furui_witness.py is not the released 0.2.0 file (sha256 $got_sha); the audit will show your answers as modified"

# ---- the key ----
tmp=$(mktemp -d); trap 'rm -rf "$tmp"; [ -z "${KIT_SELF_COPY:-}" ] || rm -f "$KIT_SELF_COPY"' EXIT; chmod 700 "$tmp"
if [ -n "$key_file" ]; then
  [ -f "$key_file" ] || die "--key-file $key_file is not a file"
  if grep -q 'BEGIN OPENSSH PRIVATE KEY' "$key_file"; then
    set +e
    $PY -I -B - "$key_file" "$tmp/k.pem" <<'PY'
import base64, os, sys
src, dst = sys.argv[1], sys.argv[2]
t = open(src).read()
b = base64.b64decode("".join(t.split("-----BEGIN OPENSSH PRIVATE" + " KEY-----")[1].split("-----END OPENSSH PRIVATE" + " KEY-----")[0].split()))
pos = [0]
def take(n):
    if pos[0] + n > len(b):
        sys.exit(4)
    v = b[pos[0]:pos[0] + n]; pos[0] += n; return v
def string():
    return take(int.from_bytes(take(4), "big"))
if take(15) != b"openssh-key-v1\x00":
    sys.exit(4)
cipher, kdf, _opts = string(), string(), string()
if cipher != b"none" or kdf != b"none":
    sys.exit(3)
if int.from_bytes(take(4), "big") != 1:
    sys.exit(4)
string()
b, pos = string(), [0]
c1, c2 = take(4), take(4)
if c1 != c2 or string() != b"ssh-ed25519":
    sys.exit(4)
pub, sk = string(), string()
if len(pub) != 32 or len(sk) != 64 or sk[32:] != pub:
    sys.exit(4)
der = bytes.fromhex("302e020100300506032b657004220420") + sk[:32]
fd = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w", newline="\n") as f:
    f.write("-----BEGIN PRIVATE" + " KEY-----\n" + base64.b64encode(der).decode() + "\n-----END PRIVATE" + " KEY-----\n")
PY
    rc=$?; set -e
    [ "$rc" != 3 ] || die "$key_file has a passphrase. Make a copy without it and pass the copy: cp \"$key_file\" k_copy && ssh-keygen -p -N \"\" -f k_copy, then bash setup.sh ... --key-file k_copy, then delete k_copy"
    [ "$rc" = 0 ] || die "$key_file is not an OpenSSH Ed25519 private key this script can read"
  else
    openssl pkey -in "$key_file" -out "$tmp/k.pem" || die "openssl cannot read $key_file as a private key"
  fi
else
  openssl genpkey -algorithm ed25519 -out "$tmp/k.pem" 2>/dev/null || die "this openssl cannot make an Ed25519 key"
fi
chmod 600 "$tmp/k.pem"
openssl pkey -in "$tmp/k.pem" -pubout -outform DER > "$tmp/pub.der" 2>/dev/null || die "openssl cannot read the key"
read -r pub_b64 kid16 ssh_line <<EOF
$($PY -I -B -c 'import base64,hashlib,sys
d = open(sys.argv[1], "rb").read()
if len(d) != 44 or d[:12] != bytes.fromhex("302a300506032b6570032100"):
    sys.exit("the key is not an Ed25519 key")
k = d[12:]
wire = (11).to_bytes(4, "big") + b"ssh-ed25519" + (32).to_bytes(4, "big") + k
print(base64.b64encode(k).decode(), hashlib.sha256(k).hexdigest()[:16], base64.b64encode(wire).decode())' "$tmp/pub.der" | tr -d '\r')
EOF
[ -n "${ssh_line:-}" ] || die "the key is not an Ed25519 key"
case "$key_url" in
  "") key_url="$site/keys/$kid16.json"; key_body="{\"public_key_ed25519_b64\":\"$pub_b64\"}" ;;
  *.pub) key_body="ssh-ed25519 $ssh_line furui-witness" ;;
  *) key_body="{\"public_key_ed25519_b64\":\"$pub_b64\"}" ;;
esac
own=0; [ -n "$status_url" ] && own=1

# ---- status.json: this repository's copy (job keep writes last_answer in it); in own-site mode also the copy to place ----
$PY -I -B - "$rotate" "ed25519:$kid16" "$now" "$own" "$site/answers/" <<'PY'
import json, sys
rotate, kid, now, own, answers = sys.argv[1] == "1", sys.argv[2], sys.argv[3], sys.argv[4] == "1", sys.argv[5]
if rotate:
    s = json.load(open("status.json"))
    assert s.get("schema") == "furui-witness-status-v0", "status.json is not furui-witness-status-v0"
    if s.get("current_key_id") != kid:
        s["previous_key_ids"] = s.get("previous_key_ids", []) + [{"key_id": s["current_key_id"], "until": now}]
else:
    s = {"schema": "furui-witness-status-v0", "previous_key_ids": [], "revoked": []}
s.update(current_key_id=kid, updated_at=now)
if own:
    s["answers_url"] = answers   # the operator's audit reads the copies of your answers here, beside your key's status.json
else:
    s.pop("answers_url", None)
open("status.json", "w", newline="\n").write(json.dumps(s, indent=2, sort_keys=True) + "\n")
PY
mkdir -p answers; touch .nojekyll answers/.gitkeep
if [ "$own" = 0 ]; then
  mkdir -p keys; printf '%s\n' "$key_body" > "keys/$kid16.json"
else
  mkdir -p place_on_your_site
  printf '%s\n' "$key_body" > "place_on_your_site/$(basename "$key_url")"
  $PY -I -B -c 'import json,sys; s = json.load(open("status.json")); s.pop("last_answer", None); open(sys.argv[1], "w", newline="\n").write(json.dumps(s, indent=2, sort_keys=True) + "\n")' place_on_your_site/status.json
fi

echo "1/4 storing the private key as the secret FURUI_WITNESS_KEY of $repo"
gh secret set FURUI_WITNESS_KEY --repo "$repo" < "$tmp/k.pem"
rm -f "$tmp/k.pem"
gh variable set FURUI_WITNESS_KEY_URL --repo "$repo" --body "$key_url"
[ "$rotate" = 1 ] || gh variable set FURUI_WITNESS_NAME --repo "$repo" --body "$wname"

echo "2/4 committing status.json$([ "$own" = 0 ] && echo " and keys/$kid16.json") and the kit files"
git add .gitattributes .nojekyll answers/.gitkeep status.json furui_witness.py setup.sh .github/workflows/furui-witness.yml
[ "$own" = 1 ] || git add keys
git diff --cached --quiet || git commit -m "furui-witness: key ed25519:$kid16" >/dev/null
git push

echo "3/4 serving the repository with GitHub Pages ($site/)"
gh api "repos/$repo/pages" >/dev/null 2>&1 || gh api -X POST "repos/$repo/pages" -f "source[branch]=$(git branch --show-current)" -f "source[path]=/" >/dev/null
if [ "$own" = 1 ]; then
  echo
  echo "Place these two files on your site, as they are (they are in place_on_your_site/, which is not committed):"
  echo "  $key_url"
  echo "    $key_body"
  echo "  $status_url"
  sed 's/^/    /' place_on_your_site/status.json
  echo "Your answers stay in this repository and GitHub Pages serves them at $site/answers/; status.json names that place."
  echo
fi
served_ok() {   # url, kind (key or status): does the url serve what was made here?
  got=$(curl -fsS --max-time 15 "$1" 2>/dev/null) || return 1
  printf '%s' "$got" | $PY -I -B -c 'import base64,json,sys
b = sys.stdin.buffer.read(); kind, want_b64, kid, answers = sys.argv[1:5]
if kind == "status":
    try:
        s = json.loads(b)
    except ValueError:
        sys.exit(1)
    ok = isinstance(s, dict) and s.get("schema") == "furui-witness-status-v0" and s.get("current_key_id") == kid and (answers == "-" or s.get("answers_url") == answers)
    sys.exit(0 if ok else 1)
want = base64.b64decode(want_b64)
try:
    d = json.loads(b)
    k = base64.b64decode(d["public_key_ed25519_b64"]) if isinstance(d, dict) and isinstance(d.get("public_key_ed25519_b64"), str) else None
except ValueError:
    t = b.decode("ascii", "replace").strip().split()
    w = base64.b64decode(t[1]) if len(t) >= 2 and t[0] == "ssh-ed25519" else b""
    k = w[19:] if len(w) == 51 else None
sys.exit(0 if k == want else 1)' "$2" "$pub_b64" "ed25519:$kid16" "$([ "$own" = 1 ] && echo "$site/answers/" || echo -)"
}
for i in $(seq 1 40); do
  if served_ok "$key_url" key && { [ "$own" = 0 ] || served_ok "$status_url" status; }; then break; fi
  if [ "$i" = 40 ]; then
    echo "setup.sh: after 20 minutes $key_url$([ "$own" = 1 ] && echo " or $status_url") does not serve the new files yet."
    echo "When it does, start the workflow once with: gh workflow run furui-witness.yml"
    exit 1
  fi
  [ "$i" = 1 ] && echo "waiting until $key_url$([ "$own" = 1 ] && echo " and $status_url") serve the new files (up to 20 minutes)"
  sleep 30
done

echo "4/4 starting the workflow once"
gh workflow run furui-witness.yml --repo "$repo"
echo "done: key ed25519:$kid16 at $key_url. Runs at 01:50 and 03:50 UTC; answers appear under $site/answers/"
