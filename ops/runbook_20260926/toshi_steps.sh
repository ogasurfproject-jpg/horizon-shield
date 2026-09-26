#!/bin/bash
# TOshi が打つ手順(2026-09-26 夕)。番人は走らせない(push・deploy・secret は TOshi の手)。
#
# 使い方:  bash ~/horizon-shield/ops/runbook_20260926/toshi_steps.sh <段>
#   status  いまの状態を見るだけ(何も変えない)
#   A       JHNRD seed.24 の commit と push(一番急ぎ。あっぷす運用開始 10/1)
#   A2      JHNRD の公開 MCP(jhnrd-mcp)を配って、seed.24 を返すか確かめる
#   B       訪問看護の写し(A の push 後)
#   C1      観測層の SQL を作る(検査器が先に走る)と手元の harness。D1 が 50 MB のファイルを受けなければ MAXMB=20 bash ... C1 で作り直す
#   C2      D1 を用意する(無ければ作り、wrangler.jsonc の <D1_ID> <D1_US_ID> を埋める)
#   C3      D1 に流す(日本 → 米国)と行数の確認。ONLY=JP / ONLY=US で片方だけ
#   C3R     米国の流し込みが途中で止まったとき、D1 の今の行数を見て続きのファイルから流す(済んだ分は流さない)
#   C4      hs-jccdb-obs v0.3 を deploy して確かめる
#   D       hs-mcp に 11 ツール(patcher v2)と deploy
#   E       改正ウォッチャー(hs-law-watch)の D1 と deploy
#   F       horizon-shield の git add(個別)・commit・push
#   G       片付けの一覧を出す(消すのは TOshi)
#   R       公式 MCP レジストリに載せ直す(jhnrd 0.24.0・hs-verify-gate 0.4.15・horizon-shield 1.0.10 の2つの名前)。
#           本番が配っている版しか載せない。dev.horizonshield の名前は horizonshield.dev の鍵で入る(鍵は Mac の中で作り、中身は画面に出さない)
#
# 止まり方: どこかで想定と違えば「止めた: 理由」と出して終わる。途中から打ち直してよい(C3 は必ず最初の 0003 から流し直す)。
# secret はこの台本では扱わない(打つコマンドを表示するだけ)。
# 段が最後まで通ると ~/hs-core-private/handoff/PROGRESS_runbook_20260926.md に1行書く(番人はそれを読んで引き継ぎと記録を直す)。
# 進み具合は引き継ぎと同じく公開リポに入れない。
set -euo pipefail

HS="${HS:-$HOME/horizon-shield}"
JH="${JH:-$HOME/Desktop/jhnrd}"
ACCOUNT_ID="c15ff64aba400e541853dec1fbe5e76a"
OBS2="$HS/data/jccdb-obs-v2"
JO="$HS/workers/hs-jccdb-obs"
LW="$HS/workers/hs-law-watch"
MCP="$HS/workers/hs-mcp"
PATCHER="$HS/ops/jccdb_upgrade_20260926/patch_hs_mcp_jccdb_obs_v2.py"
ADD_LIST="$HS/ops/_incoming_20260926c/GIT_ADD_LIST_20260926c.txt"
ADD_LIST_D="$HS/ops/runbook_20260926/GIT_ADD_LIST_20260926d.txt"
RULES_SHA="c272d288b5dd0afd3b41c726e8b865d9e7b7edc444d6e1d7f25110f1e3630295"
# 番人の作業場で作った SQL の指紋(同じ観測層なら TOshi の手元でも同じになる)
FP_JP="8c0097f52ae6f56caef4d8a7feb2468cbe9c00c64ff40a1a19eb7cde5cd6225e"
FP_US="c7d9f5a3b8202dad6756ee4b984fb1c3b3dba2902283fa2b03834ef05e422fdb"   # 2026-09-26 15:4x 直し: 旧値 33538a92 は機械単価の CSV を2つに分ける前の組み立ての値だった
N_JP=331946
N_US=2853445
JO_URL="https://hs-jccdb-obs.oga-surf-project.workers.dev"
LW_URL="https://hs-law-watch.oga-surf-project.workers.dev"
MCP_URL="https://mcp.horizonshield.dev/mcp"
JHNRD_DERIVED="status.json mcp/rules.data.js datapackage.json .zenodo.json server.json CHANGELOG.md CITATION.cff README.md README.ja.md README_en.md"

PRIV="${PRIV:-$HOME/hs-core-private}"
if [ -d "$PRIV/handoff" ]; then PROG="$PRIV/handoff/PROGRESS_runbook_20260926.md"; else PROG="$HOME/PROGRESS_runbook_20260926.md"; fi
JHNRD_MCP_URL="https://jhnrd-mcp.oga-surf-project.workers.dev"
say()  { printf '\n== %s\n' "$*"; }
progress() { [ -f "$PROG" ] || printf '%s\n\n' "# 台本の進み具合(段が通るたびに台本が書く)" > "$PROG"; printf '%s\n' "- $(date '+%Y-%m-%d %H:%M') $1: $2" >> "$PROG"; echo "記録した: $PROG"; }
# .gitignore で外しているものは add しない(リポに入れない約束の物)。外した物は名前を出す
add_tracked() {
  local f skipped=""
  for f in "$@"; do
    if git check-ignore -q -- "$f"; then skipped="$skipped $f"; else git add -- "$f"; fi
  done
  [ -z "$skipped" ] || echo "リポに入れない約束(.gitignore)なので add していない:$skipped"
}
die()  { printf '\n止めた: %s\n' "$*" >&2; exit 1; }
ask()  { printf '\n%s\n  続けるなら yes と打つ: ' "$*"; read -r a; [ "$a" = "yes" ] || die "yes 以外が入ったので止めた(何も変えていない)"; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 が見つからない"; }
sha()  { shasum -a 256 "$1" | awk '{print $1}'; }
jget() { python3 -c 'import json,sys
d=json.load(open(sys.argv[1]))
for k in sys.argv[2].split("."): d=d[k]
print(" ".join(d) if isinstance(d,list) else d)' "$1" "$2"; }

check_account() {  # $1 = worker のディレクトリ
  local out; out="$(cd "$1" && npx wrangler whoami 2>&1 || true)"
  printf '%s\n' "$out" | grep -q "$ACCOUNT_ID" || die "wrangler のアカウントが c15ff64a(oga.surf.project)ではない。npx wrangler login をやり直す"
}
no_placeholder() { ! grep -q '<D1_' "$1/wrangler.jsonc" || die "$1/wrangler.jsonc に <D1_...> が残っている。先に C2(ウォッチャーは E)"; }
d1_yes_flag() { if (cd "$JO" && npx wrangler d1 execute --help 2>&1) | grep -q -- '--yes'; then echo "--yes"; fi; }
d1_id_of() {  # $1 = D1 の名前。無ければ空
  (cd "$JO" && npx wrangler d1 list --json 2>/dev/null) | python3 -c 'import json,sys
t=sys.stdin.read(); t=t[t.find("["):] if "[" in t else "[]"
for d in json.loads(t):
    if d.get("name")==sys.argv[1]: print(d.get("uuid") or d.get("database_id") or ""); break' "$1"
}
d1_count() {  # $1 = D1 の名前, $2 = SQL(1列 n を返す)
  (cd "$JO" && npx wrangler d1 execute "$1" --remote --json --command "$2" 2>/dev/null) | python3 -c 'import json,sys
t=sys.stdin.read(); t=t[t.find("["):]
print(json.loads(t)[0]["results"][0]["n"])'
}
d1_create() {  # $1 = D1 の名前, $2 = 書き換えられては困る wrangler.jsonc
  # wrangler 4 の d1 create は、設定ファイルがある場所で打つと「設定に書き足すか」と聞き、
  # yes だと別名の binding を二重に足す(2026-09-26 に実際に起きかけた)。設定ファイルの無い一時の場所で作る。
  local before tmp; before="$(sha "$2")"; tmp="$(mktemp -d)"
  (cd "$tmp" && CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID" npx --yes wrangler@4 d1 create "$1" < /dev/null) || die "D1 $1 を作れなかった(上の出力)"
  [ "$(sha "$2")" = "$before" ] || die "wrangler が $2 を書き換えた。足された d1 の項目を消してから打ち直す"
}
fill_id() {  # $1 = wrangler.jsonc, $2 = 置き場("<D1_ID>" など), $3 = id
  python3 - "$1" "$2" "$3" <<'PY'
import sys, re
p, ph, v = sys.argv[1:]
if not re.fullmatch(r"[0-9a-f-]{36}", v): sys.exit("id の形が違う: " + v)
t = open(p, encoding="utf-8").read()
if ph not in t: sys.exit(0)
open(p, "w", encoding="utf-8").write(t.replace(ph, v, 1))
print("埋めた:", p, ph, "->", v)
PY
}

step_status() {
  need python3; need node
  say "JHNRD ($JH)"
  [ -f "$JH/data/rules_2024.json" ] && { s="$(sha "$JH/data/rules_2024.json")"; [ "$s" = "$RULES_SHA" ] && echo "rules_2024.json は seed.24" || echo "rules_2024.json は seed.24 ではない($s)"; }
  (cd "$JH" && git fetch -q && git status -sb | head -12) || true
  say "観測層 v2 ($OBS2)"
  echo "観測の CSV: $( (ls "$OBS2/observations/jp" "$OBS2/observations/us" 2>/dev/null || true) | grep -c '\.csv$' || true)"
  say "hs-jccdb-obs"
  for c in jp us; do m="$JO/sql_$c/MANIFEST.json"; if [ -f "$m" ]; then echo "sql_$c: obs2=$(jget "$m" built.obs2) fingerprint=$(jget "$m" built.obs2_fingerprint_sha256 | cut -c1-16)"; else echo "sql_$c: まだ無い(C1)"; fi; done
  grep -q '<D1_' "$JO/wrangler.jsonc" && echo "wrangler.jsonc: <D1_...> が残っている(C2)" || echo "wrangler.jsonc: D1 の id は埋まっている"
  say "hs-mcp(patcher の dry-run)"
  python3 "$PATCHER" "$MCP" --dry 2>&1 | tail -3 || true
  say "hs-law-watch"
  grep -q '<D1_' "$LW/wrangler.jsonc" && echo "wrangler.jsonc: <D1_ID> が残っている(E)" || echo "wrangler.jsonc: D1 の id は埋まっている"
  say "本番の口"
  echo "jhnrd-mcp: $(curl -s -m 10 "$JHNRD_MCP_URL/status.json" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("version"))' 2>/dev/null || echo 届かない)"
  echo "hs-jccdb-obs: $(curl -s -m 10 "$JO_URL/health" | python3 -c 'import json,sys; h=json.load(sys.stdin); print("ok", h.get("ok"), h.get("obs2_by_country"))' 2>/dev/null || echo 届かない)"
  echo "hs-law-watch: $(curl -s -m 10 "$LW_URL/health" 2>/dev/null | head -c 120 || echo 届かない)"
  if [ -f "$PROG" ]; then say "進み具合($PROG)"; tail -12 "$PROG"; fi
  say "horizon-shield の git"
  (cd "$HS" && git status -sb | head -5) || true
}

step_A() {
  need git; need python3; need node
  cd "$JH"
  [ "$(sha data/rules_2024.json)" = "$RULES_SHA" ] || die "data/rules_2024.json が seed.24 ではない(sha が違う)。番人に知らせる"
  local bk; bk="$(mktemp -d)"; cp data/rules_2024.json "$bk/rules_2024.seed24.json"; echo "控え: $bk/rules_2024.seed24.json"
  say "A1 origin に追いつく(手元の変更は stash に退避)"
  git fetch
  local n0 n1; n0="$(git stash list | wc -l | tr -d ' ')"
  git stash push -m "seed24-before-pull-$(date +%Y%m%d%H%M%S)"
  n1="$(git stash list | wc -l | tr -d ' ')"
  [ "$n1" -gt "$n0" ] || die "stash が作られなかった(手元に変更が無い = seed.24 が既に commit 済み?)。git log -1 と git status を見て、番人に知らせる"
  git pull --rebase
  if ! git stash pop; then
    local bad=""
    for f in $(git diff --name-only --diff-filter=U); do
      case " $JHNRD_DERIVED " in
        *" $f "*)
          if git cat-file -e "HEAD:$f" 2>/dev/null; then git checkout HEAD -- "$f"; echo "派生ファイルは origin 側を取った(下で作り直す): $f"
          else git rm -q -f -- "$f"; echo "origin で消えた派生ファイルは消した: $f"; fi;;
        *) bad="$bad $f";;
      esac
    done
    [ -z "$bad" ] || die "派生でないファイルが衝突した:$bad(stash は残っている。git stash list で見える)"
    git reset -q
    git stash drop
  fi
  [ "$(sha data/rules_2024.json)" = "$RULES_SHA" ] || die "pull のあと rules_2024.json が seed.24 でなくなった。控えは $bk にある。番人に知らせる"
  say "A2 検査と派生ファイル(順番が大事: validate が先)"
  python3 tools/validate.py
  python3 tools/update_readme.py --write
  python3 tools/make_metadata.py --write
  python3 tools/make_mcp_data.py --write
  node mcp/mcp_test.mjs
  python3 tools/make_changelog.py --write
  [ "$(sha data/rules_2024.json)" = "$RULES_SHA" ] || die "派生ファイルを作ったあと rules_2024.json が変わった"
  say "A3 add(個別)と commit"
  git add data/rules_2024.json
  for f in $JHNRD_DERIVED; do if [ -f "$f" ]; then git add -- "$f"; fi; done
  git status --short | head -30
  ask "上の内容で commit する(seed.24)"
  git commit -m "seed.24: 令和8年6月施行の要件の本文(留意事項通知・施設基準・届出通知・疑義解釈・告示第19/95/94号・老企36号)に284件を結ぶ。准看護師の率を訂正"
  ask "origin に push する"
  git push
  progress A "JHNRD seed.24 を push した($(git rev-parse --short HEAD))"
  cat <<'EOF2'

push は済んだ。次に公開 MCP(jhnrd-mcp)を配る。GitHub の release は Cloudflare の鍵を受け取れないと配らずに「成功」で終わる(2026-09-26 に実際そうなった)ので、手で打つ:
  bash ~/horizon-shield/ops/runbook_20260926/toshi_steps.sh A2
EOF2
}

step_A2() {
  need curl
  cd "$JH/mcp"
  local out; out="$(npx wrangler whoami 2>&1 || true)"
  printf '%s\n' "$out" | grep -q "$ACCOUNT_ID" || die "wrangler のアカウントが c15ff64a ではない"
  ask "JHNRD の公開 MCP(jhnrd-mcp)を deploy する(必ず mcp/ の中。secret は無い)"
  npx wrangler deploy
  sleep 3
  local v; v="$(curl -s "$JHNRD_MCP_URL/status.json" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("version",""))' || true)"
  echo "公開 MCP の版: $v"
  [ "$v" = "2024-kaitei.seed.24" ] || die "公開 MCP が seed.24 を返さない(返したのは $v)"
  progress A2 "jhnrd-mcp を deploy した。公開 MCP は $v を返す"
}

step_B() {
  cd "$HS"
  [ "$(sha "$JH/data/rules_2024.json")" = "$RULES_SHA" ] || die "JHNRD が seed.24 ではない。先に A"
  local out; out="$(JHNRD_REPO="$JH" python3 tools/nursing/sync_db.py 2>&1 || true)"; printf '%s\n' "$out"
  printf '%s' "$out" | grep -q "一致しています" || die "写しが本物と一致しない(上の出力)。番人に知らせる"
  add_tracked data/nursing/rules_2024.json workers/hs-nursing-mcp/src/rules.js workers/hs-apps-jimu/test/fixtures/nursing/rules.js
  echo "add した。commit は F でまとめる。介護の准看護師の率を 98/100 で扱った出力があれば、イ・ロは 100分の90 で見直す。"
  progress B "訪問看護の写しが seed.24 と一致。data/nursing と hs-nursing-mcp の rules を add(hs-apps-jimu は .gitignore でリポの外)"
}

step_C1() {
  need python3; need node
  cd "$JO"
  say "C1 SQL を作る(最初に検査器が全 320 万行を見る。約 1.2 GB のメモリ)"
  local c fp want
  for c in JP US; do
    if [ "$c" = JP ]; then want="$FP_JP"; else want="$FP_US"; fi
    m="sql_$(echo "$c" | tr 'A-Z' 'a-z')/MANIFEST.json"
    fp=""; if [ -f "$m" ]; then fp="$(jget "$m" built.obs2_fingerprint_sha256)"; fi
    local rb="${REBUILD:-}"
    if [ "$rb" != "1" ] && [ "$rb" != "$c" ] && [ -z "${MAXMB:-}" ] && [ "$fp" = "$want" ]; then
      echo "$c: 作り済みの SQL の指紋が合っているので作り直さない(作り直すなら REBUILD=1、片方だけなら REBUILD=JP か REBUILD=US)"
    else
      python3 tools/make_d1_sql_v3.py "$OBS2" --country "$c" ${MAXMB:+--max-mb "$MAXMB"}
    fi
  done
  [ "$(jget sql_jp/MANIFEST.json built.obs2)" = "$N_JP" ] || die "日本の行数が $N_JP でない"
  [ "$(jget sql_us/MANIFEST.json built.obs2)" = "$N_US" ] || die "米国の行数が $N_US でない"
  [ "$(jget sql_jp/MANIFEST.json built.obs2_fingerprint_sha256)" = "$FP_JP" ] || die "日本の SQL の指紋が番人の作業場と違う(観測層が違う?)"
  [ "$(jget sql_us/MANIFEST.json built.obs2_fingerprint_sha256)" = "$FP_US" ] || die "米国の SQL の指紋が番人の作業場と違う"
  echo "行数と指紋は番人の作業場と同じ"
  say "C1 手元の harness(ファイルの DB に全部流す。約 2 GB の空きと数分)"
  local hr; hr="$(OBS2="$OBS2" node test/harness.mjs 2>&1 || true)"; printf '%s\n' "$hr" | tail -3
  printf '%s' "$hr" | grep -q ' / 0 fail' || die "hs-jccdb-obs の harness に落ちたものがある(上の出力)。番人に知らせる"
  progress C1 "sql_jp / sql_us を作った(行数・指紋が作業場と同じ)。$(printf '%s' "$hr" | grep ' / 0 fail' | tail -1)"
}

step_C2() {
  cd "$JO"; check_account "$JO"
  local id
  id="$(d1_id_of hs-jccdb-obs)"
  if [ -z "$id" ]; then
    ask "D1 hs-jccdb-obs が無い。作る(日本。v0.1 の items も入る)"
    d1_create hs-jccdb-obs "$JO/wrangler.jsonc"
    id="$(d1_id_of hs-jccdb-obs)"; [ -n "$id" ] || die "作った D1 の id が取れない"
    touch "$JO/.need_v01"
  fi
  fill_id "$JO/wrangler.jsonc" "<D1_ID>" "$id"
  id="$(d1_id_of hs-jccdb-obs-us)"
  if [ -z "$id" ]; then
    ask "D1 hs-jccdb-obs-us を作る(米国、1.6 GB。Workers Paid が前提)"
    d1_create hs-jccdb-obs-us "$JO/wrangler.jsonc"
    id="$(d1_id_of hs-jccdb-obs-us)"; [ -n "$id" ] || die "作った D1 の id が取れない"
  fi
  fill_id "$JO/wrangler.jsonc" "<D1_US_ID>" "$id"
  no_placeholder "$JO"
  grep -n '"database_id"' wrangler.jsonc
  progress C2 "D1 hs-jccdb-obs と hs-jccdb-obs-us を用意し wrangler.jsonc に id を埋めた"
}

apply_order() {  # $1 = D1 の名前, $2 = MANIFEST
  local y; y="$(d1_yes_flag)"
  for f in $(jget "$2" apply_order); do
    echo "-> $1 : $f"
    npx wrangler d1 execute "$1" --remote $y --file="$f" || die "$f で止まった。1ファイルの流し込みは全部入るか全く入らないかのどちらか。米国なら C3R で続きから、日本なら ONLY=JP で C3 を最初から"
  done
}

step_C3() {
  # ONLY=JP で日本だけ、ONLY=US で米国だけ流す(途中で止まったとき、済んだ国を流し直さないため)
  cd "$JO"; check_account "$JO"; no_placeholder "$JO"
  [ -f sql_jp/MANIFEST.json ] && [ -f sql_us/MANIFEST.json ] || die "sql_jp / sql_us が無い。先に C1"
  local only="${ONLY:-}"
  if [ "$only" != "US" ]; then
    if [ -f "$JO/.need_v01" ]; then
      say "C3 日本の D1 は新しいので、先に v0.1 の items と obs(52 ファイル、31 MB)"
      ask "日本(hs-jccdb-obs)に v0.1 の表(品目 95,403 行など)を流す"
      ls sql/*.sql >/dev/null 2>&1 || die "v0.1 の sql/*.sql が無い(v0.1 の手順で作る)"
      npx wrangler d1 execute hs-jccdb-obs --remote $(d1_yes_flag) --file=schema/0001_init.sql || die "0001_init.sql で止まった"
      for f in sql/*.sql; do echo "-> $f"; npx wrangler d1 execute hs-jccdb-obs --remote $(d1_yes_flag) --file="$f" || die "$f で止まった(もう一度 C3 を打てば 0001 から流し直す)"; done
      [ "$(d1_count hs-jccdb-obs 'SELECT COUNT(*) AS n FROM items')" = "95403" ] || die "v0.1 の items が 95403 行でない"
      echo "v0.1 items = 95403 行"
      rm -f "$JO/.need_v01"
      progress C3 "日本の D1 に v0.1 の items(95,403 行)と obs を流した"
    fi
    ask "日本(hs-jccdb-obs)に 0003 と sql_jp を流す(6 ファイル、約 210 MB。v0.1 の表には触らない)"
    apply_order hs-jccdb-obs sql_jp/MANIFEST.json
    [ "$(d1_count hs-jccdb-obs 'SELECT COUNT(*) AS n FROM obs2')" = "$N_JP" ] || die "日本の obs2 の行数が $N_JP でない"
    echo "日本 obs2 = $N_JP 行"
    progress C3 "日本の D1 に観測層を流した。obs2 $N_JP 行"
  fi
  if [ "$only" != "JP" ]; then
    ask "米国(hs-jccdb-obs-us)に 0003 と sql_us と fts を流す(29 ファイル、約 1.3 GB。長くかかる。途中で閉じない)"
    apply_order hs-jccdb-obs-us sql_us/MANIFEST.json
    [ "$(d1_count hs-jccdb-obs-us 'SELECT COUNT(*) AS n FROM obs2')" = "$N_US" ] || die "米国の obs2 の行数が $N_US でない"
    echo "米国 obs2 = $N_US 行"
    npx wrangler d1 execute hs-jccdb-obs-us --remote --command "SELECT k FROM meta"
    progress C3 "米国の D1 に観測層を流した。obs2 $N_US 行"
  fi
}

step_C3R() {
  cd "$JO"; check_account "$JO"; no_placeholder "$JO"
  local n m
  n="$(d1_count hs-jccdb-obs-us 'SELECT COUNT(*) AS n FROM obs2')" || die "米国の D1 を数えられない(網の具合を見てもう一度)"
  m="$(d1_count hs-jccdb-obs-us 'SELECT COALESCE(MAX(rid),0) AS n FROM obs2')" || die "米国の D1 を数えられない"
  echo "米国 D1 の今: obs2 $n 行、rid の最大 $m"
  [ "$n" = "$m" ] || die "行数($n)と rid の最大($m)が合わない。欠けがあるので ONLY=US で C3 を最初から流す"
  local rest
  rest="$(python3 - "$m" <<'PY'
import json, re, sys
m = int(sys.argv[1])
order = [f for f in json.load(open("sql_us/MANIFEST.json"))["apply_order"] if f.startswith("sql_us/") and "/fts_" not in f]
pat = re.compile(rb"INSERT INTO obs2 \([^)]*\) VALUES \((\d+),")
firsts = []
for f in order:
    with open(f, "rb") as fh:
        buf = b""
        while True:
            chunk = fh.read(1 << 20)
            if not chunk: break
            buf += chunk
            g = pat.search(buf)
            if g: break
    if not g: sys.exit("obs2 の行が見つからない: " + f)
    firsts.append((f, int(g.group(1))))
rest = [f for f, r in firsts if r > m]
if rest:
    first = dict(firsts)[rest[0]]
    if m != first - 1: sys.exit("D1 の rid の最大 %d が、続きのファイル %s の始まり %d の直前と合わない" % (m, rest[0], first))
print(" ".join(rest))
PY
)" || die "続きを決められない(上の理由)。ONLY=US で C3 を最初から流す"
  local fts; fts="$(d1_count hs-jccdb-obs-us "SELECT COUNT(*) AS n FROM sqlite_master WHERE name='obs2_fts'")"
  echo "続きに流すファイル: ${rest:-なし}$( [ "$fts" = "0" ] && echo " + sql_us/fts_001.sql(検索の索引)")"
  [ -n "$rest" ] || [ "$fts" = "0" ] || echo "流すものは無い"
  if [ -n "$rest" ] || [ "$fts" = "0" ]; then
    ask "米国(hs-jccdb-obs-us)に続きを流す"
    local y f; y="$(d1_yes_flag)"
    for f in $rest; do
      echo "-> hs-jccdb-obs-us : $f"
      npx wrangler d1 execute hs-jccdb-obs-us --remote $y --file="$f" || die "$f で止まった。もう一度 C3R を打てば、D1 の今を見て続きから流す"
    done
    if [ "$fts" = "0" ]; then
      echo "-> hs-jccdb-obs-us : sql_us/fts_001.sql"
      npx wrangler d1 execute hs-jccdb-obs-us --remote $y --file=sql_us/fts_001.sql || die "fts_001.sql で止まった。もう一度 C3R を打つ"
    fi
  fi
  [ "$(d1_count hs-jccdb-obs-us 'SELECT COUNT(*) AS n FROM obs2')" = "$N_US" ] || die "米国の obs2 の行数が $N_US でない"
  echo "米国 obs2 = $N_US 行"
  npx wrangler d1 execute hs-jccdb-obs-us --remote --command "SELECT k FROM meta"
  progress C3R "米国の D1 の続きを流した(${rest:-obs2 は済み}$( [ "$fts" = "0" ] && echo " + fts")). obs2 $N_US 行"
}

step_C4() {
  cd "$JO"; check_account "$JO"; no_placeholder "$JO"
  ask "hs-jccdb-obs v0.3 を deploy する"
  npx wrangler deploy
  sleep 5
  curl -s "$JO_URL/health" | python3 -c 'import json,sys
h=json.load(sys.stdin); c=h.get("obs2_by_country",{})
print("ok",h.get("ok"),"JP",c.get("JP"),"US",c.get("US"),"complete",h.get("obs2_complete"))
sys.exit(0 if h.get("ok") and c.get("JP")=='"$N_JP"' and c.get("US")=='"$N_US"' else 1)' || die "/health が想定と違う(上の出力)"
  curl -s "$JO_URL/us/wage?state=CA&county=Los%20Angeles&trade=carpenter&limit=2" | head -c 600; echo
  curl -s "$JO_URL/us/permits?geo=Austin,%20TX&year=2024&limit=2" | head -c 600; echo
  progress C4 "hs-jccdb-obs v0.3 を deploy した。/health は JP $N_JP・US $N_US"
}

step_D() {
  cd "$MCP"; check_account "$MCP"
  curl -s "$JO_URL/health" | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("obs2_complete") is True else 1)' || die "hs-jccdb-obs v0.3 がまだ答えない。先に C4"
  python3 "$PATCHER" "$MCP" --dry
  ask "上の dry-run のとおり hs-mcp に当てる(.bak を2つ残す)"
  python3 "$PATCHER" "$MCP"
  ask "hs-mcp を deploy する"
  npx wrangler deploy
  sleep 5
  local n
  n="$(curl -s "$MCP_URL" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
       -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -o '"get_us_prevailing_wage"\|"get_us_permits"\|"get_us_area_factor"\|"get_jccdb_coverage"' | sort -u | wc -l | tr -d ' ')"
  [ "$n" = "4" ] || die "tools/list に新しい道具が出ていない($n/4)"
  echo "tools/list に新しい道具が出た"
  progress D "hs-mcp に 11 ツールを当てて deploy した。tools/list に新しい道具が出る"
}

step_E() {
  cd "$LW"; check_account "$LW"
  local hr; hr="$(node test/harness.mjs 2>&1 || true)"; printf '%s\n' "$hr" | tail -1
  printf '%s' "$hr" | grep -q ' / 0 fail' || die "hs-law-watch の harness に落ちたものがある"
  local id; id="$(d1_id_of hs-law-watch)"
  if [ -z "$id" ]; then
    ask "D1 hs-law-watch を作り、schema を流す"
    d1_create hs-law-watch "$LW/wrangler.jsonc"
    id="$(d1_id_of hs-law-watch)"; [ -n "$id" ] || die "作った D1 の id が取れない"
    fill_id "$LW/wrangler.jsonc" "<D1_ID>" "$id"
    npx wrangler d1 execute hs-law-watch --remote $(d1_yes_flag) --file=schema/0001_init.sql
  else
    fill_id "$LW/wrangler.jsonc" "<D1_ID>" "$id"
  fi
  no_placeholder "$LW"
  ask "hs-law-watch を deploy する(1日2回、43 か所を見る)"
  npx wrangler deploy
  progress E "hs-law-watch を deploy した(secret と最初の /admin/run はこのあと手で)"
  cat <<EOF

ここからは TOshi が自分で打つ(secret は台本に入れない):
  cd $LW
  npx wrangler secret put ADMIN_KEY      # 鍵マネージャで作った値
  curl -s -X POST $LW_URL/admin/run -H "x-admin-key: <ADMIN_KEY>"     # 1回目は基準線だけ
  curl -s $LW_URL/sources | head -c 3000                               # 各先の http_status と ok
  (任意) npx wrangler secret put LINE_TOKEN / LINE_TO / GITHUB_TOKEN / GITHUB_REPO
EOF
}

step_F() {
  cd "$HS"
  [ -f "$ADD_LIST" ] || die "$ADD_LIST が無い"
  say "F add(一覧の個別 add。git add . は使わない)"
  local paths; paths="$(cat "$ADD_LIST"; if [ -f "$ADD_LIST_D" ]; then cat "$ADD_LIST_D"; fi)"
  local missing; missing="$(printf '%s\n' "$paths" | while read -r f; do if [ -n "$f" ] && [ ! -e "$f" ]; then echo "$f"; fi; done)"
  [ -z "$missing" ] || die "一覧にあるのに見つからないファイルがある: $missing"
  local ign; ign="$(printf '%s\n' "$paths" | git check-ignore --stdin || true)"
  [ -z "$ign" ] || printf 'リポに入れない約束(.gitignore)なので add しない:\n%s\n' "$ign"
  printf '%s\n' "$paths" | while read -r f; do
    if [ -n "$f" ] && ! printf '%s\n' "$ign" | grep -qxF -- "$f"; then printf '%s\0' "$f"; fi
  done | xargs -0 git add --
  git status --short | awk '{print $1}' | sort | uniq -c
  git diff --cached --name-only -z | python3 -c 'import os,sys
bad=[]; big=[]
for f in sys.stdin.buffer.read().decode("utf-8").split("\0"):
    if not f: continue
    if f.startswith(("data/jccdb-obs-v2/raw/","data/jccdb-obs-v2/raw_restricted/","data/jccdb-obs-v2/observations_restricted/")): bad.append(f)
    if os.path.isfile(f) and os.path.getsize(f) > 45*1024*1024: big.append("%s %d" % (f, os.path.getsize(f)))
for x in bad: print("リポに入れない置き場:", x)
for x in big: print("45 MB 超:", x)
sys.exit(1 if bad or big else 0)' || die "入れてはいけないファイルが add されている(上の一覧)。git reset -- <path> で外す"
  ask "上の内容で commit する(観測層 v2・米国 DB・hs-jccdb-obs v0.3・patcher v2・改正ウォッチャー)"
  git commit -m "JCCDB 観測層 v2(日本 331,946 行・米国 2,853,445 行)、hs-jccdb-obs v0.3(D1 を日本と米国に分ける)、hs-mcp patcher v2(11 ツール)、改正ウォッチャーに米国の出典"
  ask "origin に push する"
  git push
  progress F "horizon-shield を push した($(git rev-parse --short HEAD))"
}

step_G() {
  cat <<EOF
消してよいもの(TOshi が確かめてから消す):
  $HS/_to_delete/20260926 $HS/_to_delete/20260926b $HS/_to_delete/20260926c $HS/_to_delete/20260926d
  (20260926d は公開リポから非公開の置き場へ移した下書きの元。写しは ~/hs-core-private/ops-private/jccdb_letters_20260926/ にある)
  $HS/ops/_incoming_20260926c/*.part* $HS/ops/_incoming_20260926c/*.tgz(展開済み)
  $JO/sql_v2/(v0.2 の SQL。v0.3 では使わない)
残すもの: $JO/sql_jp $JO/sql_us(入れ直しに使う。リポには入らない)
EOF
}

# 公式 MCP レジストリ(registry.modelcontextprotocol.io)の、いま載っている版(latest)。取れなければ空
# 2026-09-26 18:09: 最初の版は一覧の検索(?search=)で引いていて、レジストリの検索が遅く R-2 で止まって見えた。
# 名前をそのまま指す口に替えた。1回 20 秒まで、3回まで取り直す。
# 18:27: /versions/latest は jhnrd だけ古い 0.22.0 を返した(レジストリ側の写しの遅れ)。同じ時に /versions(版の一覧)は
# 0.24.0 に isLatest を付けていたので、版の一覧を取り、isLatest の付いた1件を見る。
reg_json() {  # $1 = 名前。版の一覧(JSON)をそのまま出す
  local enc i out; enc="$(printf '%s' "$1" | sed 's#/#%2F#g')"
  for i in 1 2 3; do
    out="$(curl -s -m 20 --connect-timeout 10 "https://registry.modelcontextprotocol.io/v0/servers/$enc/versions" || true)"
    if [ -n "$out" ]; then printf '%s' "$out"; return 0; fi
    echo "  レジストリが答えない($1、$i 回目)。取り直す" >&2
  done
}
reg_latest() {  # $1 = 名前
  echo "  読んでいる: $1" >&2
  reg_json "$1" | python3 -c 'import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
for s in d.get("servers") or []:
    sv=s.get("server") or {}
    m=(s.get("_meta") or {}).get("io.modelcontextprotocol.registry/official") or {}
    if sv.get("name")==sys.argv[1] and m.get("isLatest") is True:
        print(sv.get("version","")); break' "$1"
}
# horizonshield.dev の署名鍵(Ed25519)。中身は画面に出さない。公開鍵(TXT に書く方)と、login に渡す 32 バイトの秘密の値を出し分ける
DNSKEY="${DNSKEY:-$HOME/.config/hs/mcp_registry_dns_ed25519.pem}"
dnskey_new() { mkdir -p "$(dirname "$DNSKEY")"; node -e 'const c=require("crypto"),fs=require("fs");
const {privateKey}=c.generateKeyPairSync("ed25519");
fs.writeFileSync(process.argv[1], privateKey.export({type:"pkcs8",format:"pem"}), {mode:0o600, flag:"wx"});' "$DNSKEY"; chmod 600 "$DNSKEY"; }
dnskey_pub() { node -e 'const c=require("crypto"),fs=require("fs");
const der=c.createPublicKey(c.createPrivateKey(fs.readFileSync(process.argv[1]))).export({type:"spki",format:"der"});
process.stdout.write(der.subarray(der.length-32).toString("base64"));' "$DNSKEY"; }
dnskey_seed_hex() { node -e 'const c=require("crypto"),fs=require("fs");
const der=c.createPrivateKey(fs.readFileSync(process.argv[1])).export({type:"pkcs8",format:"der"});
process.stdout.write(der.subarray(der.length-32).toString("hex"));' "$DNSKEY"; }
dns_txt() { { dig +short TXT horizonshield.dev @1.1.1.1; dig +short TXT horizonshield.dev @8.8.8.8; } 2>/dev/null | tr -d '"' | grep 'v=MCPv1' | sort -u; }
# grep -q は途中で読むのをやめ、pipefail の下では前の段の SIGPIPE で「見えない」と取り違えることがある。全部読ませる
has_pub() { dns_txt | grep -F "p=$1" >/dev/null; }

step_R() {
  need python3; need node; need curl; need git; need dig
  command -v mcp-publisher >/dev/null 2>&1 || die "mcp-publisher が見つからない。brew install mcp-publisher で入れてから打ち直す"
  local GATE="$HS/workers/hs-verify-gate" GATE_URL="https://gate.horizonshield.dev"
  local N_JH="io.github.ogasurfproject-jpg/jhnrd" N_GATE="io.github.ogasurfproject-jpg/hs-verify-gate"
  local N_ROOT="io.github.ogasurfproject-jpg/horizon-shield" N_DOM="dev.horizonshield/horizon-shield"

  say "R-1 本番が配っている版と server.json の版(配っていない版はレジストリに載せない)"
  local jl jw gl gw ml mw rw
  jl="$(curl -s -m 15 -H 'Cache-Control: no-cache' "$JHNRD_MCP_URL/status.json?r=$(date +%s)" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("version",""))' 2>/dev/null || true)"
  jw="$(jget "$JH/status.json" version)"
  echo "JHNRD: 本番 ${jl:-(取れず)} / リポ $jw / server.json $(jget "$JH/server.json" version)"
  [ -n "$jl" ] && [ "$jl" = "$jw" ] || die "JHNRD の本番がリポの版を配っていない。先に A2"
  gl="$(curl -s -m 15 -H 'Cache-Control: no-cache' "$GATE_URL/health?r=$(date +%s)" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("gate_version",""))' 2>/dev/null || true)"
  gw="$(jget "$GATE/server.json" version)"
  echo "hs-verify-gate: 本番 ${gl:-(取れず)} / server.json $gw"
  [ -n "$gl" ] && [ "$gl" = "$gw" ] || die "hs-verify-gate の本番が server.json の版を配っていない(bash $GATE/deploy_gate.sh が先)"
  ml="$(curl -s -m 15 "$MCP_URL" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
        -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"toshi-steps-R","version":"0"}}}' \
        | python3 -c 'import json,sys,re
t=sys.stdin.read(); m=re.search(r"\{.*\}", t, re.S)
print(((json.loads(m.group(0)).get("result") or {}).get("serverInfo") or {}).get("version","") if m else "")' 2>/dev/null || true)"
  mw="$(jget "$MCP/server.json" version)"; rw="$(jget "$HS/server.json" version)"
  echo "hs-mcp: 本番 ${ml:-(取れず)} / workers/hs-mcp/server.json $mw / ルートの server.json $rw"
  [ -n "$ml" ] && [ "$ml" = "$mw" ] && [ "$ml" = "$rw" ] || die "hs-mcp の本番と server.json の版が揃っていない"

  say "R-2 いまレジストリに載っている版"
  local rj rg rr rd
  rj="$(reg_latest "$N_JH")"; rg="$(reg_latest "$N_GATE")"; rr="$(reg_latest "$N_ROOT")"; rd="$(reg_latest "$N_DOM")"
  echo "$N_JH ${rj:-(取れず)} → $(jget "$JH/server.json" version)"
  echo "$N_GATE ${rg:-(取れず)} → $gw"
  echo "$N_ROOT ${rr:-(取れず)} → $rw"
  echo "$N_DOM ${rd:-(取れず)} → $mw"
  [ -n "$rj" ] && [ -n "$rg" ] && [ -n "$rr" ] && [ -n "$rd" ] || die "レジストリから版が取れなかった(ネットワークか、レジストリが止まっている)。少し置いて打ち直す"

  say "R-3 horizon-shield の3ファイル(ルートの server.json 1.0.10 など)を main に入れる"
  cd "$HS"
  local files="server.json workers/hs-mcp/server.json ops/registry_drift_check.mjs"
  if [ -n "$(git status --porcelain -- $files)" ]; then
    [ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || die "horizon-shield が main にいない"
    git fetch -q origin
    [ "$(git rev-list --count HEAD..origin/main)" = "0" ] || die "origin/main が手元より先に進んでいる。番人に知らせる(ここでは何も変えていない)"
    [ "$(git rev-list --count origin/main..HEAD)" = "0" ] || die "手元に push していない commit がある(git log origin/main..HEAD)。一緒に出てしまうので止めた。番人に知らせる"
    git --no-pager diff --stat -- $files
    ask "この3つだけを commit して push する(ほかの変更は入れない)"
    git commit -m "レジストリ: ルートの server.json を 1.0.10 に(本番は 9/25 から 1.0.10)。dev.horizonshield の server.json を今の schema に。ずれの見張りが、ドメインの名前には dns の鍵が要ると言う" -- $files
    git push
    progress R "horizon-shield の server.json 2つと registry_drift_check.mjs を push した($(git rev-parse --short HEAD))"
  else
    echo "3つとも commit 済み"
  fi

  say "R-4 GitHub の名前(io.github.ogasurfproject-jpg)の3つを載せる"
  local todo=""
  [ "$rj" = "$(jget "$JH/server.json" version)" ] || todo="$todo $JH"
  [ "$rg" = "$gw" ] || todo="$todo $GATE"
  [ "$rr" = "$rw" ] || todo="$todo $HS"
  if [ -n "$todo" ]; then
    echo "載せるもの:$todo"
    ask "mcp-publisher login github(画面に出る URL を開き、8文字のコードを入れる)の後、続けて publish する"
    mcp-publisher login github
    local d
    for d in $todo; do (cd "$d" && mcp-publisher publish) || die "$d の publish に失敗(401 ならトークン切れ。R を打ち直せば、載った物は飛ばして続きから行く)"; done
    progress R "レジストリに載せた(GitHub の名前):$todo"
  else
    echo "3つとも載っている"
  fi

  say "R-5 dev.horizonshield/horizon-shield を載せる(horizonshield.dev の鍵)"
  if [ "$rd" != "$mw" ]; then
    if [ ! -f "$DNSKEY" ]; then
      ask "horizonshield.dev の新しい署名鍵を $DNSKEY に作る(9/16 の鍵は露出済みなので使わない。中身は画面に出さない)"
      dnskey_new
    fi
    local pub; pub="$(dnskey_pub)"
    if has_pub "$pub"; then
      echo "この鍵の TXT はもう DNS に出ている"
    else
      cat <<EOF

Cloudflare の画面で TXT を1つ足す(古い v=MCPv1 の TXT は、まだ消さない):
  dash.cloudflare.com → horizonshield.dev → DNS → Records → Add record
  Type: TXT   Name: @   TTL: Auto
  Content: v=MCPv1; k=ed25519; p=$pub
  → Save
EOF
      ask "Save まで済んだ"
      local i
      for i in $(seq 1 30); do has_pub "$pub" && break; echo "  まだ DNS に見えない(試行 $i/30)。10 秒待つ"; sleep 10; done
      has_pub "$pub" || die "5 分待っても TXT が見えない。Name が @ か、Content に余計な文字が無いかを見て、R を打ち直す"
      echo "TXT が DNS に見えた"
    fi
    mcp-publisher login dns --domain horizonshield.dev --private-key "$(dnskey_seed_hex)"
    (cd "$MCP" && mcp-publisher publish) || die "dev.horizonshield の publish に失敗(上の出力)"
    progress R "レジストリに載せた: $N_DOM $mw(horizonshield.dev の新しい鍵で login)"
  else
    echo "載っている"
  fi
  local old; old="$(dns_txt | grep -vF "p=$(if [ -f "$DNSKEY" ]; then dnskey_pub; else echo '(鍵なし)'; fi)" || true)"
  if [ -f "$DNSKEY" ] && [ -n "$old" ] && has_pub "$(dnskey_pub)" && [ "$(reg_latest "$N_DOM")" = "$mw" ]; then
    cat <<EOF

新しい鍵で載ったので、古い鍵の TXT を Cloudflare で消す(9/16 の鍵。露出済み):
$(printf '%s\n' "$old" | sed 's/^/  /')
  dash.cloudflare.com → horizonshield.dev → DNS → Records → 上の Content の TXT → Edit → Delete
  (新しい p=$(dnskey_pub | cut -c1-8)… の方は消さない)
EOF
  fi

  say "R-6 レジストリを読み直す"
  local bad=0 n want got
  for n in "$N_JH:$(jget "$JH/server.json" version)" "$N_GATE:$gw" "$N_ROOT:$rw" "$N_DOM:$mw"; do
    want="${n##*:}"; n="${n%:*}"; got="$(reg_latest "$n")"
    if [ "$got" = "$want" ]; then echo "[OK] $n $got"; else echo "[まだ] $n 載っている=${got:-(取れず)} 載せたい=$want"; bad=1; fi
  done
  reg_json "$N_JH" | python3 -c 'import json,sys
for s in json.load(sys.stdin).get("servers") or []:
    if ((s.get("_meta") or {}).get("io.modelcontextprotocol.registry/official") or {}).get("isLatest") is True:
        m=((s.get("server") or {}).get("_meta") or {}).get("io.modelcontextprotocol.registry/publisher-provided") or {}
        print("jhnrd の名刺の利益相反:", "入っている" if "conflict_of_interest" in m else "入っていない(live が赤のままになる)"); break' || true
  [ "$bad" = "0" ] || die "載っていないものがある(上)。数分おいて R を打ち直す(載った物は飛ばす)"
  progress R "レジストリの4つ(jhnrd・hs-verify-gate・horizon-shield の2つの名前)が本番と同じ版になった"
  cat <<EOF

GitHub の赤を消す(どちらも Run workflow を押すだけ):
  https://github.com/ogasurfproject-jpg/jhnrd/actions/workflows/live.yml → Run workflow
  https://github.com/ogasurfproject-jpg/horizon-shield/actions/workflows/registry-drift.yml → Run workflow
EOF
}

case "${1:-}" in
  status) step_status;; A) step_A;; A2) step_A2;; B) step_B;; C1) step_C1;; C2) step_C2;; C3) step_C3;; C3R) step_C3R;; C4) step_C4;;
  D) step_D;; E) step_E;; F) step_F;; G) step_G;; R) step_R;;
  *) sed -n '2,20p' "$0"; exit 2;;
esac
