#!/bin/sh
# company_name_fix.sh: 日本語文脈の社名「The HORIZONs株式会社」を「The HORIZ音s株式会社」に直す (STEP3: 名指しのファイルだけ)。
# STEP1 の一覧は ops/company_name_inventory_20260905.tsv (file / count / contexts / flag)。
# STEP2 (目で分類) の結果は、この台本が読む一覧ファイルで表す:
#   ops/company_name_phase1.txt  = 門の blocking 名前空間 (yakumo/ care/ qa/ aeo/ faq/) の外で、flag が空のファイル (自動で作る)
#   ops/company_name_phase2.txt  = blocking 名前空間のファイル (自動で作るが、既知の近似重複 22 組 + yakumo の 4 ページの直しが先)
#   flag のあるファイル (signed_payload / claim_sha256 / signature の語がある、または領収・宣言の経路) はどちらにも入れない。
#   目で見て安全と分かったものだけ、手で phase1 か phase2 に足す。
# 既定は dry-run。--apply phase1 / --apply phase2 で書き換える。再帰 sed は使わない。置換は完全一致の 1 文字列だけ。
set -eu
cd "$(dirname "$0")/.."
MODE="${1:-dry}"
PHASE="${2:-phase1}"
TS=$(date +%Y%m%d-%H%M%S)
INV=ops/company_name_inventory_20260905.tsv
[ -f "$INV" ] || { echo "$INV が無い"; exit 1; }

python3 - "$INV" <<'PY'
import io, sys
inv = sys.argv[1]
p1, p2, skipped = [], [], []
for line in io.open(inv, encoding="utf-8").read().splitlines()[1:]:
    f, count, ctx, flag = (line.split("\t") + ["", "", "", ""])[:4]
    if flag.strip():
        skipped.append(f); continue
    if f.split("/")[0] in ("yakumo", "care", "qa", "aeo", "faq"):
        p2.append(f)
    else:
        p1.append(f)
io.open("ops/company_name_phase1.txt", "w", encoding="utf-8").write("\n".join(p1) + "\n")
io.open("ops/company_name_phase2.txt", "w", encoding="utf-8").write("\n".join(p2) + "\n")
io.open("ops/company_name_flagged.txt", "w", encoding="utf-8").write("\n".join(skipped) + "\n")
print("phase1 (blocking の外):", len(p1), " phase2 (blocking の中):", len(p2), " flagged (目で見るまで触らない):", len(skipped))
PY

LIST="ops/company_name_$PHASE.txt"
N=$(grep -c . "$LIST" || true)
echo "mode=$MODE phase=$PHASE files=$N"
if [ "$MODE" != "--apply" ]; then
  echo "dry-run のみ。書き換えるには: sh ops/company_name_fix.sh --apply $PHASE"
  exit 0
fi

tar czf "ops/BACKUP_company_name_${PHASE}_$TS.tar.gz" -T "$LIST"
echo "backup: ops/BACKUP_company_name_${PHASE}_$TS.tar.gz"

LIST="$LIST" python3 - <<'PY'
import io, os
OLD = "The HORIZONs株式会社"; NEW = "The HORIZ音s株式会社"
changed, occ = [], 0
for f in io.open(os.environ["LIST"], encoding="utf-8").read().splitlines():
    f = f.strip()
    if not f or not os.path.exists(f):
        continue
    t = io.open(f, encoding="utf-8").read()
    n = t.count(OLD)
    if n == 0:
        continue
    io.open(f, "w", encoding="utf-8").write(t.replace(OLD, NEW))
    changed.append(f); occ += n
io.open("ops/company_name_changed_files.txt", "w", encoding="utf-8").write("\n".join(changed) + "\n")
print("changed files:", len(changed), " occurrences replaced:", occ, " (一覧 ops/company_name_changed_files.txt)")
PY
echo "次: git add \$(cat ops/company_name_changed_files.txt)"
