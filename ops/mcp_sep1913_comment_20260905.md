# SEP-1913 へのコメント(2026-09-05)。MCP 本体リポジトリ、PR #1913 の会話欄に投稿する

## なぜここか

- SEP ガイドラインに明記: 「For SEPs not yet reaching `final` state, comment directly on the SEP's pull request.」= 部外者がコメントする正規の経路
- 5 月から 6 月にかけて、このスレッドは自力で `evidenceRef` に辿り着いとる。@Rul1an が最小形 `{digest, canonicalization, schema}` を出し、@vaaraio と @Rul1an が **二実装の壁**(片方の参照が、もう片方で再計算だけで解決できること)を基準として合意した。@SamMorrowDrums は Extensions Track へ分割し、IG が **adoption evidence** を集めとる最中
- このスレッドの生産者は全員「呼び出し経路の中」(client / gateway / proxy)。**外から測る生産者が 1 人もおらん**。そこが空席
- SEP-3140 には出さん。著者が「sponsor が付くまで反応せん」と自分で書いとる
- SEP-2127 は Extensions Track へ移行中(PR #2893)で現在地が動いとる。**1913 が着地してから**

## 絶対の前提

CONTRIBUTING.md: 「If you are using any kind of AI assistance to contribute to Model Context Protocol, it must be disclosed in the pull request or issue.」
**SEP-2668 が閉じられた唯一の理由がこれの違反**(@localden: "AI-generated without disclosure and engagement is being automated")。開示行を消したら終わり。先頭に置く。

## 投稿前に開く URL(全部 200 を目視してから投稿)

    curl -s "https://gate.horizonshield.dev/is-verified?endpoint=https://mcp.horizonshield.dev/mcp"
    curl -s https://gate.horizonshield.dev/spec | head -40
    curl -s https://gate.horizonshield.dev/self | head -40

npm と Action はブラウザで 1 回ずつ開く。1 本でも開かんかったら、その行を文面から外す。

**2026-09-05 09:5x 実施済み**: 3 本とも 200 を目視。そのとき /spec に 0.2.3 の古い記述が 2 か所残っとるのを発見した(determinism が「allow_tool_call を送れ」のまま、red_team が 48/48 のまま)。**投稿より先に扉を deploy して直す。** 直さんまま maintainer に /spec を指させたら、こっちが今朝 npm で潰したのと同じ「古い公開記述」を自分でやることになる。

---

## 投稿する本文(ここから下をそのまま貼る)

**Disclosure:** I operate the instrument described below, so I am not a neutral observer, and this comment was drafted with AI assistance (per CONTRIBUTING.md). Everything in it is checkable without me.

@vaaraio @Rul1an @SamMorrowDrums, on the two-implementation bar for `evidenceRef` and on why `canonicalization` has to stay required. I have a producer that is not in the call path.

**What it is.** A public register that measures MCP servers on a schedule and publishes each verdict with a hash. It is neither the client nor the server: a third party holding no key from either and selling to neither. Every producer discussed in this thread so far sits inside the deployment (client, gateway, proxy). This one sits outside it, which is the case `evidenceRef` has to survive if a reference is ever to resolve across an organizational boundary instead of within one.

**The recomputation property, checkable now.**

```
curl -s "https://gate.horizonshield.dev/is-verified?endpoint=https://mcp.horizonshield.dev/mcp"
```

The published method is: remove `record_sha256` and `recompute_note`, serialize the remainder in key order, SHA-256. Two independent consumers already recompute it rather than trusting the response: an npm client (`mcp-conduct`) and a GitHub Action that recomputes on the CI runner. Both derive their verdict from the recomputation alone, and either can be pointed at a verdict it did not fetch itself.

**On `canonicalization`.** This producer serializes with `JSON.stringify` in key order, not RFC 8785. That is the weaker choice, and the register discloses it as a named condition rather than hiding it. I offer it as a live counter-example rather than a hypothetical: the moment `canonicalization` becomes optional, or is assumed to be JCS, this reference stops resolving, and so does every reference from any producer that predates the field. `{digest, canonicalization, schema}` is the right shape, and producers like this one are the reason the middle field cannot be dropped.

**On the false-sense-of-security worry** raised earlier in this thread. The response above carries two fields, `verified_meaning` and `not_an_endorsement`, that state what the verdict does not mean, in the same payload as the verdict. `verified` is `true` or `null`, never `false`, because absence of a measurement is not a negative finding. If an evidence layer ever ships a boolean that a client renders as a badge, the shape of the disclaimer matters as much as the shape of the digest.

**The instrument sits on its own register and currently fails it.** `https://gate.horizonshield.dev/self` returns `pending`, not `verified`, because one of the conditions it applies to everyone else is one it cannot measure about itself: it cannot reach its own MCP endpoint over the network from inside its own account, and it does not count an unmeasured condition as a pass. The response states what would settle it, which is for another checker to point at it from outside, at which point the claim is either confirmed or destroyed. I raise it because the failure this thread keeps circling is an evidence producer that grades itself generously, and the cheapest structural defence against that is a producer who is measurable by someone else and publishes its own red rows.

**Limits, stated plainly.** The register is small. Most rows on it are my own servers, and my own servers can and do fail on it. The measurement is narrow: whether a server speaks MCP, publishes an agent card, declares who compensates its operator, and answers one tool call identically twice, plus whether the verdict itself recomputes. It measures conduct and disclosure at a stated time. It does not measure safety, correctness, or competence, and the next measurement can revoke it.

**One gap that touches both this thread and the server card work.** A measurer outside the deployment cannot call a tool without the operator's consent, and consent has nowhere standard to live. I read a file on the server's own origin, because placing a file there is the strongest ownership claim available without keys, and the verdict records which file it read and at what time. One outside operator has published one so far. That is one implementer, not a standard, and I would rather it became a key in the server card than a second well-known file competing for the same origin.

If a vector would be useful, I will run it against this producer, or have this producer's references resolved by someone else's consumer.

## 投稿後

- 返事が付くか、無視されるかを 2 週間見る。ガイドラインの目安も「2 週間反応が無ければ #general で聞け」
- 反応があった場合のみ、第 2 手(server card の `_meta` に `dev.horizonshield/conduct` を提案)に進む。`_meta` の逆 DNS 規則で第 2 ラベルが `mcp` / `modelcontextprotocol` でなければ合法。`dev.horizonshield` は合法
- 並行して Discord(discord.gg/6CSzBmMkjX)の `Security in MCP`(IG)と `Server Identity`(WG)に Observer で入る。規約に「cold submission より IG が先」と明記されとる
- **sponsor が付かんかったら SEP は `dormant` になるだけで `rejected` やない**(最長 6 か月待てる)。落ちても損は無い
