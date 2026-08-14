# Launch pack v3 — 2026-08-14 深夜版

v2 からの変更: **今日さらに3つ直した。そのうち1つは、v2 の主役より強い。**

- 扉が自分にだけ fail-open だった（v2 の主役）
- **`hs-mcp` が、実装していない全パスに 200 を返していた。** SSE クライアントが毎秒1回、数週間、無限に再接続していた。**HTTP は成功、ログは Ok、エラー率にも出ない**
- MCPエンドポイントへの GET が仕様違反の 200 だった。405 に直した

**3件に共通する形が、そのまま投稿の芯になる:**

> **全部の信号が OK と言っていた。**

これは Hacker News がいちばん反応する形の話である。「壊れていて気づかない」ではなく「**成功したと表示され続けながら壊れていた**」だから。

---

# 第1部 — Hacker News の実務（規約は一次資料で確認済み）

## A. カルマの話 — 投稿にカルマは要らない

公式 Show HN ページの記述はこれだけ。

> "To post, submit a story whose title begins with 'Show HN'."

**カルマ要件は書かれていない。** カルマの閾値が効くのは、FAQ にあるとおり **flag リンクと vouch リンクが出るかどうか**だけ。

> "There's a small karma threshold before flag links appear"
> "There's a small karma threshold before vouch links appear."

## B. 「死んでる」の診断 — 3分で確定する

FAQ の記述:

> "The post was killed by software, user flags, or moderators. **Dead posts aren't displayed by default, but you can see them all by turning on 'showdead' in your profile.**"

**手順:**

1. HN にログイン → 右上の**自分のユーザー名**をクリック → プロフィール画面
2. **`showdead`** を **`yes`** に変更 → 下の `update` を押す
3. 自分のプロフィールの `submissions` と `comments` を開く
4. **過去の投稿の横に `[dead]` と出ていないか**を見る

さらに決定的な確認:

5. **ログアウトする**（またはプライベートウィンドウで開く）
6. 同じ投稿の URL を開く

**ログイン中は見えるのにログアウトすると消える** → その投稿は殺されている。アカウント自体が対象なら、以降の投稿も自動で殺され続ける。

## C. ★2026-08-14 17:34 実測により、この節は破棄された

**この節にあった「shadowban を前提としたメール文」は使うな。証拠と矛盾する。**

実際に `showdead: yes` にして確認した結果は **shadowban ではなく `[flagged]`** だった。
つまりソフトが自動で殺したのではなく、**人間が読んで flag を押した。**

- 投稿1件（70日前）: `[flagged] Show HN: I kept the LLM away from the numbers in a cost estimator (dev.to)` — 1 point
- コメント7本中5本に `[flagged]`。全部 1 point（3ヶ月で upvote ゼロ）

**旧メール文は "I believe this happened automatically rather than through flags" と書いていた。これは偽である。** そのまま送っていたら、検証可能性を売る人間が、確認せずに書いた文をモデレータに送ることになっていた。

**正しい診断・訂正したメール文・コメントの書き換え方は、別ファイルに全部ある:**

→ **`_HN_復帰計画_20260814.md`**

この節はもう読むな。

## D. 殺される原因になる行動（絶対にやらない）

- **「upvote してください」と、どこかに書く。** X でも LinkedIn でも Discord でも。**投票操作は最も確実に投稿を殺される**
- 同じURLを短期間に何度も投稿する
- 投稿直後に知人へ一斉にリンクを送る（IPやタイミングで検出される）
- ガイドライン: **"Please don't use HN primarily for promotion. It's ok to post your own stuff part of the time, but the primary use of the site should be for curiosity."**
  → **投稿の前に、他人のスレッドで数回まともなコメントをしておく。** これは工作ではなく、規約が求めている使い方そのもの

## E. Show HN として通る形か（規約との突合）

> "Show HN is for something you've made that **other people can play with**."
> "Off topic: blog posts, sign-up pages, newsletters, lists, and other **reading material**."
> "Please make it easy for users to try your thing out, **ideally without barriers such as signups or emails**."

| 要件 | verify-directory の現状 |
|---|---|
| 遊べるか | **○** ページ最上部に入力欄。貼れば10秒で判定が返る |
| サインアップ不要か | **○** アカウント・APIキー・メール、すべて不要 |
| 読み物ではないか | **△** 1,856語ある。**ツールが最上部にあることが生命線** |
| 自分で作ったか | ○ |
| 議論に張り付けるか | **要確認。投稿後3〜4時間は返信できる時間帯に投げること** |

**「読み物」と見なされるのが唯一のリスク。** タイトルと1本目のコメントの冒頭で、道具であることを先に立てる。

## F. 投稿の手順（クリック単位）

1. https://news.ycombinator.com/submit を開く
2. **title:** 下記のタイトルを貼る
3. **url:** `https://shield.the-horizons-innovation.com/verify-directory/`
4. **text:** **空のままにする**（url を入れると text は使えない）
5. `submit` を押す
6. **即座に**、自分の投稿を開いて**1本目のコメントを自分で書く**（下記の本文）
7. **そこから3〜4時間、画面の前にいる。** 返信の速さが全部を決める

**時間帯: 火〜木、米東部の 08:00〜10:00。** 日本時間なら **21:00〜23:00（夏時間）**。

## G. タイトル

ガイドライン: **"don't editorialize"**。煽らず、モノを説明する。

**第1候補**

```
Show HN: A conformance checker for MCP servers – its own verdict is "pending"
```

**第2候補**（より地味・安全）

```
Show HN: Free conformance checker for MCP servers, no signup, recomputable verdicts
```

**避けるべき**: `I made my checker fail its own test` — 一人称の物語はタイトルではなくコメントに置く。編集的すぎると判定されうる。

---

# 第2部 — 本文（今日の3件を反映）

## 1. Hacker News — 1本目のコメント（自分で即投稿）

```
I build estimate-auditing software for Japanese construction and started
exposing it over MCP last year. Then I hit a problem I could not talk my way
out of: I had no way to tell a customer "this server is what it says it is"
other than saying so.

So I wrote five conditions a machine can check, with no human able to overrule
it:

  1. it actually speaks MCP (initialize + tools/list, >= 1 tool)
  2. it publishes an A2A agent card with a name and description
  3. the card declares who pays it (paid_by / referral_fee / listing_fee)
  4. identical input returns identical output
  5. the verdict carries a SHA-256 you recompute yourself

Then I ran the published Anthropic connector review criteria against my own
code, and found three defects in two days. All three had the same shape, and
that shape is why I am posting.

(1) The gate was fail-open for exactly one server: itself.

A Cloudflare Worker cannot fetch its own hostname from inside its own account,
so the gate cannot measure whether it speaks MCP. The record said so, in plain
words — "applicable and served, but not self measured" — and then carried
pass: true on that row anyway. That single flag was what made its own verdict
read "verified". Pointed at anyone else's server, the same unmeasured
condition returns pass: false. Fail-closed for the whole world, fail-open for
me.

The sentence was honest. The boolean was not. A human reading the record would
not notice. A machine reading it would pass.

Fixed. My gate's verdict is now "pending" and nothing on the register passes:
four rows, zero green, all of them mine.

(2) My audit server answered 200 for every path it did not implement.

GET /sse, /foo, /this-does-not-exist, /admin — all 200, all returning the same
server-info JSON, because the GET handler had a catch-all at the end.

I only found it because I turned on request logging. A client had been hitting
/sse roughly once per second. It received 200, could not read an event stream
out of a JSON body, closed, and reconnected. Immediately. Every second. For
weeks.

HTTP said success. The log line said "Ok". Nothing appeared in the error rate,
because nothing was an error. Roughly eighty thousand requests a day of a
client stuck in a loop I had built for it.

I now return 405 on /sse with Allow: POST and a message naming the correct
transport, 404 on unknown paths with the list of real ones. The once-per-second
traffic stopped the moment it deployed. The client was well behaved. It had
simply never been given a reason to stop.

(3) The MCP endpoint itself was returning 200 on GET.

The Streamable HTTP spec says a server that does not open an SSE stream at its
endpoint MUST return 405 on GET. Mine returned 200 with a friendly JSON body.
A company selling conformance checking, quietly non-conformant on its own
endpoint. It now returns 405 with Allow: POST — and the identical body, so
nothing was lost except the wrong number.

The thing worth taking away, if anything here is:

Every one of these had a success code on it. That is what made them survive.
An outage gets fixed in an hour because everything screams. A server that
answers OK to a question it does not understand can run for months, and the
only trace is somebody else's client burning CPU in a loop.

Try it, read-only, no key, no signup:

  curl -s -X POST https://gate.horizonshield.dev/check \
    -H 'content-type: application/json' \
    -d '{"endpoint":"https://your-server/mcp"}'

Recompute any verdict yourself: drop record_sha256 and recompute_note,
JSON.stringify the rest in key order, SHA-256, compare. If it does not match, I
altered it and you just caught me.

Two deliberate limits, because that is where the design actually lives:

- Condition 4 is NOT measured unless the owner opts in with
  allow_tool_call: true. Measuring determinism means executing a tool on
  someone's server, and the first tool a server lists may well be destructive.
  Every verdict carries tools_called, and by default it reads none. You can
  point this at a stranger's endpoint without touching their data.
- Condition 3 fails only on silence. The machine cannot tell whether a
  disclosure is honest, only whether it exists. A disclosure later shown to be
  false is grounds for removal, not something a checker can detect.

Tell me the conditions are wrong. That is the actual reason I am posting. I
would rather find out here than from a customer.
```

### 想定される反応と返し方

**「自分のものすら通らないのか」**
> Correct. It measures four conditions on itself and cannot measure the fifth from inside its own account, so it refuses to count that one. If I wanted a green page I could have had one yesterday. I had one. It was wrong.

**「バッジ商売だろう」**
> Directories mostly are. My own listing on another MCP directory had produced 54,911 impressions, 24 clicks and zero tool calls as of 2026-08-09. That is why the page says a directory is not a distribution channel. What is left is a dated record, and that is the only part I think is worth anything.

**「conformance checker なんて誰が要る？」**
> Possibly nobody yet. Nothing forces anyone to prove anything about an MCP server today, and I say that on the page. What I wanted was to stop being the only source of the claim that my own server is honest. Whether that generalises is genuinely an open question and I would like to hear the argument against.

**「なぜ 2026-07-28 に対応していない？」**（刺さる可能性がある）
> Because I have not implemented it. That revision removes initialize, requires server/discover, and requires resultType on every result. I support up to 2025-11-25 and say so; adding the newer string to my supported list without implementing it would be exactly the kind of lie this thing exists to catch.

**「AI に書かせただろう」**
> The commits, the diffs and the timestamps are public in the repo, including the ones where I was wrong. Judge the record.

---

## 2. X / Twitter — 6連スレッド

**1/**
```
I built a checker that decides whether an MCP server is what it claims to be.

Then I ran it against my own servers and found three defects in two days.

All three had a success code on them.
```

**2/**
```
The gate could not measure one condition on itself — a Worker can't fetch its
own hostname.

The record said so in plain words. And set pass: true anyway.

Fail-closed for every server on earth. Fail-open for exactly one: mine.
```

**3/**
```
My audit server answered 200 for every path it didn't implement.

/sse, /foo, /admin — all 200, all the same JSON.

A client had been hitting /sse once a second for weeks. 200, can't stream,
reconnect. ~80k requests a day, in a loop I built for it.
```

**4/**
```
HTTP said success. The log line said "Ok". The error rate was clean.

Nothing was an error. That's why it survived.

An outage gets fixed in an hour. A server that answers OK to a question it
doesn't understand runs for months.
```

**5/**
```
Fixed all three. My own verdict dropped from "verified" to "pending".

Four rows on the register. Zero green. All of them mine.

The once-per-second traffic stopped the moment 405 deployed. The client was
fine. It had just never been given a reason to stop.
```

**6/**
```
Free, read-only, no key, no signup:

curl -s -X POST https://gate.horizonshield.dev/check \
  -H 'content-type: application/json' \
  -d '{"endpoint":"https://your-server/mcp"}'

https://shield.the-horizons-innovation.com/verify-directory/
```

---

## 3. MCP Discord — `#showcase` に1本

```
Built a read-only conformance checker for MCP servers, and I'd like people to
try to break it.

Five conditions, no human in the loop: speaks MCP, publishes an agent card,
declares who pays it, deterministic, and the verdict carries a SHA-256 you
recompute yourself.

curl -s -X POST https://gate.horizonshield.dev/check \
  -H 'content-type: application/json' -d '{"endpoint":"https://your-server/mcp"}'

It calls no tools on your endpoint unless you pass allow_tool_call: true —
measuring determinism means executing someone's tool and the first one listed
might be destructive, so it reports "not measured" rather than guessing.

Two things I found by pointing it at my own stuff this week, in case they are
useful to anyone here:

1. My gate was returning pass:true for a condition it openly could not measure,
   but only when checking itself. Everyone else got fail-closed. Fixed; my own
   verdict is now "pending" and nothing on my register passes.

2. My MCP server was answering 200 on every path it didn't implement, including
   /sse. A client had been reconnecting once a second for weeks — 200, no event
   stream, retry. Nothing in the error rate because nothing was an error. It
   now returns 405 with Allow: POST, and the traffic stopped instantly.

If a condition is wrong or measures differently on your side, tell me.
```

---

## 4. GitHub Discussions — 聞く。告知しない

**Title:** `What should a machine be allowed to check about an MCP server without calling its tools?`

```
I've been running an experiment: five conditions a machine can check about an
MCP server, with no human reviewer anywhere in the loop.

  1. speaks MCP — initialize + tools/list returns at least one tool
  2. publishes an A2A agent card with name + description
  3. the card declares who pays it (paid_by / referral_fee / listing_fee)
  4. determinism — identical input, identical output
  5. the verdict carries a SHA-256 a third party recomputes

Four can be measured from outside without touching anything. The fourth cannot:
determinism means executing a tool, and the first tool a server lists may be
destructive. So it defaults to "not measured", opt-in only via
allow_tool_call: true, and every verdict carries tools_called (none by
default).

I am posting because of what that default did to me. My own gate cannot reach
its own hostname from inside its own Cloudflare account, so it cannot measure
condition 1 on itself. The record said exactly that — and then set pass: true
anyway, which quietly made its own verdict read "verified" while every other
server got fail-closed. Removed; my verdict is now "pending".

Separately, and in the same week: my MCP server was returning 200 on every path
it did not implement. A client polling /sse got 200, could not read a stream,
and reconnected once a second for weeks. Nothing in the error rate, because
nothing was an error.

So, genuinely:

- Is a checker that skips determinism by default worth having at all?
- Is condition 3 (disclosure exists) meaningful when the machine cannot tell
  whether the disclosure is true?
- Should "returns a success code for a method or path it does not implement"
  be a conformance condition in its own right? It is invisible to every
  monitoring signal I had.

Live and read-only if you want to poke at it: POST
https://gate.horizonshield.dev/check with {"endpoint":"..."}.

I would rather have the conditions torn apart now than defend a bad ruleset
later.
```

---

## 5. LinkedIn — 人を出す。仕様は出さない

```
I spent 30 years on construction sites watching customers get handed numbers
they had no way to check.

So I built software that checks them. Then I hit the same problem one level up:
how does anyone know MY software isn't lying?

Saying "trust us" would have made me exactly what I set out to replace. So I
wrote five conditions a machine can check, with no human able to overrule it.

This week I turned it on my own systems and found three faults in two days.

The one that stays with me: my server had been answering "OK" to questions it
did not understand. Somewhere out there a program had been asking the same
question once a second, for weeks, getting a polite "OK" that meant nothing,
and trying again. Nothing was broken. Nothing was logged as an error. Nobody
was ever going to find it.

I fixed it, and it stopped within seconds. The program on the other end was
fine. It had simply never been told the truth.

That is the whole business, really. Not catching villains. Catching the things
that look fine from every angle and are not.

My own verdict dropped from "verified" to "pending" in the process, and there
is now not a single green row on my register. A judge who has never ruled
against himself isn't a judge.

Free, no account, works on anyone's server including mine:
https://shield.the-horizons-innovation.com/verify-directory/
```

---

# 第3部 — 順番

| 順 | 媒体 | 目的 | 前提 |
|---|---|---|---|
| 0 | **hn@ycombinator.com へメール** | アカウントが死んでいるなら先に生き返らせる | showdead で確認してから |
| 1 | **MCP Discord** | バグ出し。**ここで外部の第三者が curl を叩く＝外部検証も同時に済む** | いつでも |
| 2 | **GitHub Discussions** | 条件そのものへの反論を集める | Discord の反応を見てから |
| 3 | **Show HN** | 1〜2で直したものを持って出る | **アカウントが生きていること／3〜4時間張り付けること** |
| 4 | X | HN のスレッドが立ってから | HNへの誘導はしない |
| 5 | LinkedIn | 建設・投資家・報道向け | いつでも |

**同じ日に全部出さない。** 条件に穴があったなら、20人の部屋で知るほうが2万人の部屋で知るより安い。

**★HN のリンクを X や LinkedIn に貼って「見て」と言わないこと。** それが最も確実に投稿を殺す。

---

# 聞かれたら正確に答える用のメモ

- レジストリの他3行は **in process** であって **failed ではない**。「まだ何も通っていない」と言う。「全部落ちた」ではない。`pending` という状態がある意味そのものが要点
- 4行の内訳: 自社サーバー2本 + 連れてきた加盟店2社。**外部から登録した会社はまだゼロ**
- `54,911 / 24 clicks / 0 tool calls` は **2026-08-09 時点**の別ディレクトリの実測値。日付を必ず添える
- 対応プロトコル版は **2025-11-25 まで**。2026-07-28 は未実装で、そう明言する
