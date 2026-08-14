# LinkedIn 投稿 v2 — 数字が変わった。話の芯も変わる

## 俺が2つ間違えた

**① 数字が古かった。** Glama の実測（2026-08-14 スクショ）:

| | 直近30日 |
|---|---|
| Search Impressions | **93,983** |
| Search Clicks | **24**（CTR 0.0%） |
| Profile Views | **421** |
| **Tool Calls** | **0** |

**54,911 ではない。93,983 だ。** しかも**直近30日**の数字で、日別グラフは 8/10 前後に **11,500/日** のピークがある。

**そして verify-directory のページに、いまも「54,911 impressions … as of 2026-08-09」と書いてある。** あのページ自身が **"a number without a date quietly stops being true"** と言っている。**5日で古くなった。直す必要がある。**

**② 日本語で書け、と言ったのが間違い。** インプレッション11.5%を直そうとして、**日本の建設関係者に配られやすくする**方向に振った。**その人たちは MCP サーバーを持っていない。永久に加盟しない。**

**63人の正しい相手のほうが、500人の間違った相手より価値がある。** 直すのは言語ではない。**書き出しと、話の中身だ。**

---

## ★話の芯を入れ替える

いままで俺が書いていたのは全部「**自分のバグを見つけた話**」だった。文章としては悪くないが、**全部過去の話だ。** 未来がどこにも無い。

**未来は、この2つの数字の間にある。**

> **93,983 回表示されて、0 回使われた。**

**これが agent economy でいま起きていることの全部だ。**

- **発見は、もう解決している。** 93,983 がその証拠
- **選択が、解決していない。** エージェントは、目の前の候補のどれが本物かを判定できない
- 人間はレビューを読み、知り合いに聞き、会社を調べる。**エージェントにはそれが一つも無い**
- 見えるのは、名前と、**ベンダー自身が書いた説明文**と、URL だけ。**全部同じに見える**
- だから、どれも選ばない。**それが 0 だ**

**93,983 が 0 になる理由が、そのままディレクトリが存在する理由になる。**

これは自虐ではない。**市場の大きさの証明だ。**

---

# 投稿① — 旗艦。これを最初に投げる

```
Last month our MCP server appeared in 93,983 search results.

It was used zero times.

Not "a few times." Zero. 24 clicks out of 93,983 — the dashboard
rounds the click-through rate down to 0.0%.

I am not writing this to complain about a directory. I am writing it
because I think that gap is the most important number in the agent
economy right now, and almost nobody is looking at it.

Agents can already find software. That problem is solved — 93,983 is
the proof. What they cannot do is work out which of those results is
what it claims to be.

A human picks software by reading reviews, asking a colleague,
checking who is behind the company. An agent has none of that. It
sees a name, a description written by the vendor, and a URL. Every
result looks identical from the outside. So it picks none of them —
or it picks one and hopes.

That is how 93,983 becomes 0.

And we are about to hand software written by strangers the ability to
look up a price, book a slot, move money, on our behalf, while we are
not watching. Right now the only thing telling you that software is
what it claims to be is that software.

Better search does not fix this. The missing layer is a record: taken
by a machine, published whether it passes or not, and recomputable by
someone who does not trust whoever published it.

So we built one, and pointed it at ourselves first. Our own verdict
reads "pending". Four rows on the register today, zero green, all of
them ours.

If you run an MCP server — what would make an agent pick yours over
the one next to it?
```

**冒頭2行が全部だ。** `93,983` と `zero` だけで、開かせる。**そして最後は質問で、しかも相手の商売の話をさせる。**

**画像**: 灯台の絵。または**この2つの数字だけを大きく置いた1枚**（93,983 / 0）。**ターミナルのスクショは使わない。**

---

# 投稿② — エージェント側から世界を見せる

```
Here is what an AI agent sees when it goes looking for a tool.

A list of names. A one-line description of each, written by whoever
is selling it. A URL.

That is the whole dossier. No reviews it can weigh. No colleague to
ask. No way to tell the team that has run this for two years from the
weekend project that went up on Tuesday.

Now put money behind that decision. Book the appointment. Send the
payment. Pull the customer record.

We keep talking about agents as if the hard part is reasoning. In my
experience the hard part is that the agent has no way to be
suspicious. It cannot walk into the office and look around.

Humans built an entire economy of substitutes for that — credit
ratings, audits, licences, land registries. Every one of them exists
because somebody had to make a decision about a stranger. None of
them are readable by a machine in ten seconds without an account.

I do not think agents need a better ranking algorithm. I think they
need the boring infrastructure: a dated, public, recomputable record
of what a server actually did when somebody measured it. Including
the days it failed.

We are building one for MCP servers. It is free, it calls nothing on
your server, and it is allowed to come back red — including for us.
It currently does.

What is the equivalent in your field? What is the thing a machine
would need to read, that today only a person can judge?
```

---

# 投稿③ — 自分が落ちた話（ここまで来て、初めて効く）

**①②で「なぜ必要か」を作った後だから、この話が「潔さ」ではなく「基準の証拠」として読まれる。**

```
We wrote the test. Then we failed it. All five conditions, first run.

That part I expected. This part I did not.

Last week I found the checker had been returning "pass" for a
condition it openly could not measure — but only when it checked
itself. Pointed at anyone else's server, the same unmeasured
condition came back as a failure.

The written record was honest the whole time. It said, in plain
words, that the condition had not been measured. And right next to
that sentence, the boolean said pass.

A human reading it would not notice. A machine reading it would let
it through.

So the checker was strict with every server on earth and lenient with
exactly one. Mine. Nobody would ever have found it, because nothing
was broken. Everything returned success.

I removed the exception. My own verdict dropped from "verified" to
"pending", and there is now not one green row on the register.

I would rather run a register where the operator is the one failing
than one where the operator is the only one passing.

If the people who write the test are the only ones who pass it, the
test is decoration.

Has anyone here applied their own standard to themselves and not
liked the answer?
```

---

# 投稿④ — ここで誘う。①②③の後、最短10日空ける

```
Six months from now, someone is going to ask your software to prove
it is what it says it is. Probably not a person. Probably an agent,
in the middle of deciding whether to hand you a task.

On that day, the only thing that will help you is a record you
started before you needed it.

That is the entire pitch, and I want to be honest about what it is
not.

It is not traffic. Our own listing on another directory produced
93,983 impressions, 24 clicks and zero tool calls in the last thirty
days. Real numbers off the dashboard, dated, because a number without
a date quietly stops being true. A directory is not a distribution
channel and anyone telling you otherwise has not measured it.

What it is: five conditions, measured by a machine, no human reviewer
anywhere in the loop. Ten seconds. No account, no API key, no fee,
ever. It calls no tool on your server unless you explicitly allow it,
because the first tool a server lists may well be destructive.

You will probably fail something. We failed everything on the first
run. Finding out here is free and private until you choose otherwise.
Finding out because a customer found it first is neither.

And right now you would be the first name on the register from
outside our own company. Four rows today: two of our servers, two
member firms we brought in ourselves. Zero outside registrations. I
am not going to dress that up — hiding it would make every other row
worthless.

The first name on a register is remembered in a way the fiftieth is
not. It is the same one command either way.

Link in the first comment.
```

---

# 投稿⑤ — 30年の橋。人を出す

```
I started as a carpenter in Osaka at fifteen. Thirty years on
construction sites, ending as a construction manager.

The question I was asked more than any other, by homeowners, was:
"is this quote too high?"

They could not tell. I could. So they asked me, and whatever I said
was the answer. My thirty years were the entire basis.

I hated being that basis. So I built software to replace it with
data.

And then I hit exactly the same problem one level up.

Who checks the software?

If my answer was "I built it, so trust me," I had become the thing I
set out to replace. Just with better tooling.

So I wrote conditions a machine checks, that I am not allowed to
overrule, and I pointed it at my own servers first.

They failed all five.

Thirty years on site taught me one thing that has held up everywhere
since: the person who never checks their own work is usually the
least reliable one in the room.

What is the "trust me" in your industry that nobody has replaced yet?
```

---

## 運用

| | |
|---|---|
| **順番** | ①→②→③→④→⑤ |
| **間隔** | 3〜4日。**④は最短10日後** |
| **言語** | **英語のまま。** 世界向けの製品に、日本語で日本の建設関係者を集めても加盟しない |
| **リンク** | 本文に入れず、**投稿直後に自分で最初のコメントに貼る** |
| **画像** | ①は `93,983 / 0` の2数字だけ。②③⑤は絵。**ターミナルのスクショは全部不可** |
| **投稿後60分** | コメントに全部返す |

## 測り方

**いいねは見ない。**

1. **コメント数。** いまは 0〜2。**1本で5件付いたら書き方は直っている**
2. **verify-directory への流入。** LinkedIn からの参照が増えているか
3. **最終的な指標は1つだけ: 外部からの登録が1件入るかどうか**

---

## ★今日中にやるべき、コード側の直し

**verify-directory のページに、まだ `54,911 impressions, 24 clicks … as of 2026-08-09` と書いてある。5日で古くなった。**

そのページ自身が言っている —

> "dated because a number without a date quietly stops being true"

**自分のページに書いた原則に、自分が引っかかっている。今日これで4件目だ。**

差し替える数字（2026-08-14 実測）:

```
93,983 impressions, 24 clicks, 421 profile views and zero tool calls
in the last thirty days, as of 2026-08-14
```

**しかも新しい数字のほうが、主張が強くなる。** 93,983 → 0 のほうが、54,911 → 0 より落差が大きい。**論拠を更新すると論拠が強くなる、という珍しいケースだ。**

パッチが要るなら言え。すぐ書く。
