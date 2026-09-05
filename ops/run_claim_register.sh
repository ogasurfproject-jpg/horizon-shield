#!/bin/zsh
# com.horizonshield.claimregister (launchd, Mondays 08:30 JST) runs this. Public statements vs live measurement.
# Writes ops/claim_register_report.md (the script does that itself) and keeps every run under ops/claim-register-runs/.
set -u
export PATH="/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
OPS="$HOME/horizon-shield/ops"
mkdir -p "$OPS/claim-register-runs"
STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cd "$HOME/horizon-shield" || { printf '%s FAIL cd\n' "$STAMP" >> "$OPS/claim_register_last_run.txt"; exit 1; }
python3 ops/claim_register.py > "$OPS/claim-register-runs/$STAMP.md" 2>&1
rc=$?
printf '%s rc=%s (0 = every claim held, 1 = at least one FAIL, see the report)\n' "$STAMP" "$rc" >> "$OPS/claim_register_last_run.txt"
exit 0
