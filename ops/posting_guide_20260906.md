# 投稿の手順(2026-09-06、全部 TOshi の手。番人は文だけ)

先に掟 4 つ。(1) **push が先**。文の中の `uvx --from git+…` は push するまで 404 で動かん。(2) 1 か所 1 回。同じ物を同じ場所に 2 回出さん(HN で死んだ理由)。(3) upvote や like を人に頼まん(どこでも規約違反)。(4) 返事が付いたら 24 時間以内に自分で返す。返す文は番人が書くので、来た文をそのまま貼れ。

## 0. push と動作確認(5 分)

```
cd ~/horizon-shield && ls .git/index.lock 2>/dev/null && echo "LOCK あり" || (git pull --rebase --autostash origin main && git add workers/hs-ledger/nenrin/a2a-conduct-walk/conduct_witness_mcp.py workers/hs-ledger/nenrin/a2a-conduct-walk/pyproject.toml workers/hs-ledger/nenrin/a2a-conduct-walk/README.md workers/hs-ledger/nenrin/a2a-conduct-walk/witness_mcp_selftest.py skills/conduct-witness/SKILL.md ops/zenn_witness_post_20260906.md ops/show_hn_20260906.md ops/agntcon_onepager_20260906.md ops/witness_council_design_20260906.md ops/landscape_agent_trust_20260906.md ops/post_discord_mcp_20260906.txt ops/post_a2a_showtell_20260906.md ops/post_reddit_mcp_20260906.md ops/post_linkedin_witness_20260906.txt ops/post_devto_20260906.md ops/posting_guide_20260906.md HORIZON_SHIELD_引き継ぎ_20260906_A2A第二波_v37追記.md && git commit -m "witness in one call: conduct-witness-mcp (stdio MCP, one tool, walks from the caller's machine), pyproject so uvx --from git+...#subdirectory runs a2a-conduct-walk and conduct-witness-mcp, README (be a witness in ten minutes, EN+JA), selftest 14/14, Claude Code skill; posts: Zenn, Show HN, dev.to, Discord, a2aproject show and tell, r/mcp, LinkedIn, AGNTCon one-pager, posting guide; witness council design v0.1; agent trust landscape 2026-09-06" && git push)
```

期待: `17 files changed`、push 成功。次に、README の 1 行が本物か(証人としてやなく試し、`--submit` 無し):

```
cd /tmp && uvx --from "git+https://github.com/ogasurfproject-jpg/horizon-shield#subdirectory=workers/hs-ledger/nenrin/a2a-conduct-walk" a2a-conduct-walk --origin https://mcp.horizonshield.dev --mode a2a --witness-name "HORIZON SHIELD (operator)" --vantage "Mac, Hiratsuka"
```

期待: `walk a2a-conduct-walk-v1: https://mcp.horizonshield.dev/mcp  PASS 5/5  sha256 …`。`uvx: command not found` なら先に `curl -LsSf https://astral.sh/uv/install.sh | sh` を打って、ターミナルを開き直す。**これが通るまで、下は 1 つも出さん。**

## 1. MCP の Discord(今日、最初に)

文: `ops/post_discord_mcp_20260906.txt`(195 語)。

1. 招待 https://discord.gg/6CSzBmMkjX で入る(入っとるなら Discord を開く)。
2. 左のチャンネル一覧で **Security in MCP IG** を探す(interest group、名前は `#security-…` の形かもしれん。見つからんなら上の検索窓に `security` と打つ)。そこに文を丸ごと貼って送る。コードの行(`uvx …`)は前後に ``` を付けると読みやすい。
3. **Server Identity WG** には貼らん(同じ文を 2 か所に出すのは spam の形)。そっちには 1 行だけ: `Posted the witness tool in the Security IG channel; the identity angle (signed cards, kid, JWKS) is in section 8.4 of the spec if anyone here wants to break it.` と、Security の投稿への link(投稿を右クリック → メッセージリンクをコピー)。
4. 返事は 24 時間以内に自分で返す。番人が文を書く。

## 2. a2aproject の Discussions「Show and tell」(Discord の 1 時間後)

文: `ops/post_a2a_showtell_20260906.md`(題 + 本文、399 語)。

1. https://github.com/a2aproject/A2A/discussions → 右上の緑「New discussion」。
2. Category を **Show and tell** に選ぶ(無ければ **General**、**Ideas** には出さん、#2211 と重なる)。
3. Title の欄に文の `Title:` の行を、本文の欄に `Body:` の下を全部貼る(Markdown のまま)。
4. 「Start discussion」。できた URL を番人に貼る。
5. #2211 にはこの discussion の link を**貼らん**(issue は静かに sponsor 待ち。Discussion は Show and tell に出た、で十分)。

## 3. r/mcp(a2aproject の 1〜2 時間後)

文: `ops/post_reddit_mcp_20260906.md`。

1. https://www.reddit.com/r/mcp/submit → 「Text」の型。
2. Title は文の `Title:`、本文は `Body:` の下。Reddit の Markdown editor なら、`    ` で始まるコード行はそのまま貼れば code になる。Fancy editor なら「Markdown Editor」に切り替えてから貼る。
3. Flair があれば **Project** か **Resource**。
4. 「Post」。URL を番人に貼る。
5. Reddit は account の若さと link の数で自動 filter に落ちることがある。投稿直後に自分の投稿が一覧に見えん(自分だけに見える)なら、r/mcp の moderator に modmail で「self-post about an open-source MCP witness tool, removed by filter?」と 1 行送る。文は番人が書く。

## 4. LinkedIn(同じ日の夕方)

文: `ops/post_linkedin_witness_20260906.txt`(202 語、英語、dash 無し)。

1. linkedin.com → 「投稿を開始」→ 文を貼る。link は本文の中の 2 本のまま(LinkedIn は本文の link を嫌うと言われるが、コメント欄に逃がすと読まれん。2 本なら本文でええ)。
2. 画像は付けん(付けるなら AGNTCon の 1 枚を PDF にした物を画像化、それは次回)。
3. 投稿。URL を番人に貼る。Federico が反応したら、返信は論文チャットの流儀(彼への返事はあっちが書く)。

## 5. dev.to(翌日)

文: `ops/post_devto_20260906.md`(先頭に frontmatter あり)。

1. https://dev.to/new → editor を「Basic markdown」にしとくと frontmatter がそのまま効く(設定 → Editor)。Rich editor なら、`---` の塊は貼らずに Title と Tags を画面の欄に入れ、`## The short version` から下を貼る。
2. Tags は `mcp, ai, opensource, security` の 4 つ。
3. 「Save draft」で一度止めて、preview で code block が崩れとらんか見る。
4. 「Publish」。URL を番人に貼る。Zenn の記事(日本語)が先に出とるなら、dev.to の `canonical_url` は空のまま(別言語は別記事)。

## 6. Zenn(日本語、dev.to と同じ日か前日)

文: `ops/zenn_witness_post_20260906.md`。

1. https://zenn.dev/dashboard → 「記事を書く」。
2. 題名の欄に「自分のAIエージェントに、自分が書いていない記録を持たせる(10分)」、絵文字は 🪵、トピックに mcp / a2a / aiagent / bitcoin / opensource。
3. 本文は `## 結論` から下を全部貼る(先頭の `---` の 7 行は貼らん)。
4. 「下書き保存」→ preview → 「公開」。URL を番人に貼る。

## 7. Smithery と Glama の Discord(任意、翌日以降)

Smithery: `ops/smithery_discord_20260906.txt` の文(既にある)。会社名の行だけ `Toshikatsu Oga, HORIZON SHIELD, The HORIZ音s株式会社` に直してから。Glama: Discord の #general に Discord 用の文(1 節)を貼る。どちらも 1 回。

## 8. HN(今は出さん)

karma 3 と過去の flag で新規投稿は自動で死ぬ。出すのは「今夜の掃引で derived が履歴に残った」「証人が 3 人」の両方が揃った日に、Show HN やなく普通の投稿で 1 回だけ。それまで submit を押さん。

## 9. 出した後に番人に貼る物

各投稿の URL(Discord はメッセージリンク)。返事が付いたら、その文を丸ごと貼る。番人が返信を書く。証人の walk が台帳に来たら(`https://ledger.horizonshield.dev/witness/pending` の count が増える)、それも貼る。
