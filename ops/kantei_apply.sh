#!/bin/sh
# kantei_apply.sh: 見積もり鑑定書AI (/kantei/) への入口統合を適用する。
# 既定は dry-run (何も書き換えず、対象を数えて表示するだけ)。--apply で書き換える。
# 前提: /kantei/ が本番で 200 を返していること (転送先が無い間に転送元を潰さない)。
# 根拠と一覧: ops/kantei_consolidation_map_20260905.md
# sh + python3 だけで書いてある (zsh/bash/BSD sed の差を踏まない)。
set -eu
cd "$(dirname "$0")/.."
MODE="${1:-dry}"
TS=$(date +%Y%m%d-%H%M%S)
HOST="https://shield.the-horizons-innovation.com"

# 転送する 4 入口: "ファイル 転送先 見出し"
STUBS='mitsumori-ai-shindan.html /kantei/ 見積もり鑑定書AI
negotiate/index.html /kantei/ 見積もり鑑定書AI
gemini-shindan/index.html /kantei/ 見積もり鑑定書AI
reverse-estimate/index.html /hs-reverse-estimate/ 逆見積もり診断'

FILES=$(grep -rl 'href="/mitsumori-ai-shindan.html"\|href="https://shield.the-horizons-innovation.com/mitsumori-ai-shindan.html"' --include=*.html . | grep -v '_to_delete\|BACKUP\|node_modules\|^./ops/' || true)
N=$(printf '%s\n' "$FILES" | grep -c . || true)

echo "mode=$MODE"
echo "stubs:"; printf '%s\n' "$STUBS" | sed 's/^/  /'
echo "href rewrite files: $N"
echo "index.html card anchors: $(grep -c 'href="/inspect.html" style="display:flex;flex-direction:column' index.html) (expect 1)"
echo "llms.txt has /kantei/: $(grep -c '/kantei/' llms.txt || true)"
[ -f kantei/index.html ] || { echo "kantei/index.html が無い。先に正本を置け"; exit 1; }

if [ "$MODE" != "--apply" ]; then
  echo "dry-run のみ。書き換えるには: sh ops/kantei_apply.sh --apply"
  exit 0
fi

CODE=$(curl -s -o /dev/null -w "%{http_code}" "$HOST/kantei/?cb=$TS" || echo 000)
if [ "$CODE" != "200" ]; then
  echo "本番の /kantei/ が $CODE。先に push して 200 になってから --apply せえ"; exit 1
fi

tar czf "ops/BACKUP_kantei_redirects_$TS.tar.gz" mitsumori-ai-shindan.html negotiate/index.html gemini-shindan/index.html reverse-estimate/index.html index.html llms.txt
echo "backup: ops/BACKUP_kantei_redirects_$TS.tar.gz"

printf '%s\n' "$STUBS" > ops/kantei_stubs.txt
printf '%s\n' "$FILES" > ops/kantei_href_files.txt
HOST="$HOST" python3 - <<'PY'
import io, os
host = os.environ["HOST"]
changed = []
stub = """<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>移転しました｜HORIZON SHIELD</title>
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0;url={dest}">
<link rel="canonical" href="{host}{dest}">
<meta name="description" content="このページは{label}に統合されました。自動的に移動します。移動しない場合は下のリンクをタップしてください。">
</head>
<body>
<h1>移転しました</h1>
<p>このページは{label}に統合されました。<a href="{dest}">移動する</a></p>
<script>location.replace("{dest}");</script>
<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{{"token": "5a6009e4bfe34dc8ae92f6fc93506de4"}}'></script><!-- End Cloudflare Web Analytics -->
</body>
</html>
"""
for line in io.open("ops/kantei_stubs.txt", encoding="utf-8"):
    parts = line.split()
    if len(parts) != 3:
        continue
    path, dest, label = parts
    io.open(path, "w", encoding="utf-8").write(stub.format(dest=dest, host=host, label=label))
    changed.append(path)
    print("stub:", path, "->", dest)

for line in io.open("ops/kantei_href_files.txt", encoding="utf-8"):
    p = line.strip()
    if not p:
        continue
    t = io.open(p, encoding="utf-8").read()
    t2 = t.replace('href="/mitsumori-ai-shindan.html"', 'href="/kantei/"').replace(
        'href="https://shield.the-horizons-innovation.com/mitsumori-ai-shindan.html"', 'href="/kantei/"')
    if t2 != t:
        io.open(p, "w", encoding="utf-8").write(t2)
        changed.append(p)
print("href rewritten:", len(changed) - 4)

p = "index.html"; t = io.open(p, encoding="utf-8").read()
old = '<a href="/inspect.html" style="display:flex;flex-direction:column;background:#fff;'
assert t.count(old) == 1, "card anchor not unique"
io.open(p, "w", encoding="utf-8").write(t.replace(old, '<a href="/kantei/" style="display:flex;flex-direction:column;background:#fff;'))
changed.append(p); print("index.html: card -> /kantei/")

p = "llms.txt"; t = io.open(p, encoding="utf-8").read()
if "/kantei/" not in t:
    line = ('- [見積もり鑑定書AI / Estimate appraisal (free upload check, ¥5,500 appraisal PDF)](https://shield.the-horizons-innovation.com/kantei/): '
            'The single consumer entry for "is my renovation estimate too high?". Upload a photo or PDF of the estimate; a third party that does not '
            'perform construction returns the concerns for free, and the ¥5,500 appraisal PDF lists per-item fair unit prices, the gap, a negotiation '
            'template, a certificate number and a SHA-256 fingerprint so the contractor can check it was not altered.\n')
    k = "## Public-facing pages\n\n"
    assert k in t
    io.open(p, "w", encoding="utf-8").write(t.replace(k, k + line, 1))
    changed.append(p); print("llms.txt: +1 line")

changed += ["sitemap.xml", "kantei/index.html"]
io.open("ops/kantei_changed_files.txt", "w", encoding="utf-8").write("\n".join(sorted(set(c.lstrip("./") for c in changed))) + "\n")
print("changed files:", len(set(changed)), "(ops/kantei_changed_files.txt)")
PY
rm -f ops/kantei_stubs.txt ops/kantei_href_files.txt
echo "次: git add \$(cat ops/kantei_changed_files.txt)"
