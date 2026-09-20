#!/bin/bash
# deploy_gate.sh: 扉を、コミットの身元つきでデプロイする (2026-08-15)
#
# なぜこのスクリプトを通すのか:
#   判定の gate_commit は「どのバイト列のコードがこの判定を出したか」を
#   record_sha256 の中に固定するための値である。
#   未コミットの変更を含んだままデプロイすると、SHA はデプロイしたコードを
#   含まないコミットを指す。それはこの事業が狩っている種類の嘘なので、
#   このスクリプトはワーカーのソースが未コミットならデプロイを拒否する。
#
#   素の `npx wrangler deploy` でもデプロイ自体はできるが、その場合
#   GATE_COMMIT は注入されず、以後の全判定に
#   "unpinned: this deployment did not inject a commit" が載る。
#   黙って空になるのではなく、ピンされていないことが判定に見える。
#
# 使い方:  bash workers/hs-verify-gate/deploy_gate.sh

set -euo pipefail
cd "$(dirname "$0")"

DIRTY=$(git status --porcelain -- src/ wrangler.jsonc)
if [ -n "$DIRTY" ]; then
  echo "★ 拒否: このワーカーのソースに未コミットの変更がある。"
  echo "$DIRTY"
  echo "先にコミットしろ。SHA がデプロイするコードを含むコミットを指すためだ。"
  exit 1
fi

# 2026-09-10. デプロイするコードが自分の試験に通っとるかを、ここで確かめる。
# 上の DIRTY 検査の後に置くのは、そうすれば試験が回るバイト列と、デプロイ
# されるバイト列と、GATE_COMMIT が指すバイト列が同じ物になるからだ。
#
# なぜ要るか: 扉は 18:00Z ごとに、後から書き換えられん記録を書く。その記録を
# 書くのは「最後に手でデプロイされた物」であって、「試験に通った物」やない。
# 0.4.4 は、鍵がどこで配られとろうが署名さえ通れば運営者に帰属させる規則を
# 積んだまま、何時間か本番に居た。18:00Z がその窓に入らんかったから、間違った
# 帰属は一度も anchor されたバイト列に入らんかった。入らんかったんは時刻の
# 都合であって、仕組みやない。時刻は管理ではない。
#
# 逃げ道は置かん。上の 2 つの拒否にも無い。どうしても飛ばしたいときは素の
# npx wrangler deploy を打てばええが、それは GATE_COMMIT が注入されんので、
# 以後の全判定に unpinned と出る。飛ばした事実が判定に残る。それが逃げ道や。
echo "試験: node test/run_all.mjs (全 suite、1 分半ほどかかる)"
if ! node test/run_all.mjs; then
  echo ""
  echo "★ 拒否: この扉の suite が全緑やない。デプロイせん。"
  echo "   ここで止めるんは、次の 18:00Z の掃引が書く記録の著者が、"
  echo "   いま手元にあるこのコードやからだ。書かれた記録は後から直せん。"
  exit 1
fi
echo ""

SHA=$(git rev-parse --short=12 HEAD)
echo "deploying with GATE_COMMIT=$SHA"
# 2026-08-19 patch56. 鍵が渡されていないときに、黙って空でデプロイしない。
# 同日に2回ここで止まり、2回とも人が手で復旧した。手順を道具の中に入れる。
# 空でデプロイすると /.well-known/openai-apps-challenge が404になり、
# OpenAI 側のドメイン確認が誰にも気づかれずに切れる（worker.js の同箇所のコメント参照）。
CHALLENGE_SRC="環境変数から渡された"
CHALLENGE="${OPENAI_APPS_CHALLENGE:-}"
if [ -z "$CHALLENGE" ] && [ -s "$HOME/.config/hs/openai_apps_challenge.txt" ]; then
  CHALLENGE=$(tr -d '[:space:]' < "$HOME/.config/hs/openai_apps_challenge.txt")
  CHALLENGE_SRC="渡されなかったので、~/.config/hs/openai_apps_challenge.txt から読んだ"
fi
if [ -z "$CHALLENGE" ]; then
  CHALLENGE=$(curl -sf https://gate.horizonshield.dev/.well-known/openai-apps-challenge || true)
  CHALLENGE_SRC="渡されなかったので、いま動いている本番から回収した"
fi
if [ -z "$CHALLENGE" ]; then
  echo "★ 拒否: OPENAI_APPS_CHALLENGE が空で、本番からも回収できなかった。"
  echo "   空のままデプロイすると /.well-known/openai-apps-challenge が404になり、"
  echo "   OpenAI のドメイン確認が黙って切れる。切れたことは誰も教えてくれない。"
  echo "   値を渡してから実行する:"
  echo "     export OPENAI_APPS_CHALLENGE=\"\$(cat ~/.config/hs/openai_apps_challenge.txt)\""
  exit 1
fi
echo "challenge: $CHALLENGE_SRC (${#CHALLENGE} 文字)  ← 値そのものは出さない"

npx wrangler deploy --var GATE_COMMIT:"$SHA" --var OPENAI_APPS_CHALLENGE:"$CHALLENGE"
# 2026-09-20 TSUGI: 撒いた commit を repo の外に残す。日次の証人 (ops/run_drift_witness_daily.sh) が --expect-commit に使う。
# これが無いと証人は「ピンされとるか」しか見られず、「今日撒いた物か」が見られん。
mkdir -p "$HOME/.config/hs" && printf '%s\n' "$SHA" > "$HOME/.config/hs/last_gate_commit.txt"

# 2026-09-20 TSUGI (deploy 後の門)。撒いた直後に、本番が本当にこの commit を配っとるか、そして配っとる card の
# 署名が公式 A2A SDK で verify するかを、この場で確かめる。日次の証人は一日一回しか見ん。
# deploy 直後は edge がまだ前の版を配っとる事がある (2026-09-20 の証人がそれを捕まえた: 撒いた 30 秒後に
# 0.4.9 を観測して commit_mismatch を出した) ので、gate_commit が一致するまで待ってから card を見る。
# ここで落ちても commit は撒けとる (last_gate_commit.txt は正しい)。落ちたんは「配っとる物が壊れとる」の報せや。
echo ""
echo "本番の確認: /health の gate_commit が $SHA になるまで待つ (最大 90 秒)"
SERVED=""
for i in $(seq 1 18); do
  H=$(mktemp)
  curl -s -m 15 -H "Cache-Control: no-cache" -o "$H" "https://gate.horizonshield.dev/health?deploy_check=$(date +%s)" || true
  SERVED=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j.gate_commit||""))}catch(e){}' "$H" || true)
  rm -f "$H"
  if [ "$SERVED" = "$SHA" ]; then break; fi
  sleep 5
done
if [ "$SERVED" != "$SHA" ]; then
  echo "★ 本番が撒いた commit を配っとらん: served=${SERVED:-(取れず)} expected=$SHA"
  echo "   deploy は上がっとるが edge が切り替わっとらんか、別の物が本番に居る。手で /health を見ろ。"
  exit 1
fi
echo "  gate_commit 一致: $SHA"
EXPECT_VERSION=$(node -e 'console.log(require("./server.json").version)')
echo "本番の card 署名を公式 @a2a-js/sdk で検証 (version $EXPECT_VERSION を期待)"
if ! node verify_live_card.mjs --expect-version "$EXPECT_VERSION"; then
  echo "★ 本番の card が verify せん。commit は撒けとる (last_gate_commit.txt は $SHA) が、配信 card が壊れとる。"
  echo "   version を上げて署名し直しとらんのが典型。再署名して deploy し直せ:"
  echo "     node ../a2a-card-sign/sign.mjs --worker src/worker.js --origin https://gate.horizonshield.dev --key ~/.hs_card_key.pem --kid hs-2026-09"
  exit 1
fi
echo ""
echo "deploy 完了: commit $SHA を配っとって、card は公式 SDK で verify した。"
echo "  次は証人: bash ../../ops/run_drift_witness_daily.sh   (0 drift のはず)"
