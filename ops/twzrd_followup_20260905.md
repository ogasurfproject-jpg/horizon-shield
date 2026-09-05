# TWZRD への 2 通目(2026-09-05)。1 通目の後、相手が登録簿に入ったのを見てから。英語、ダッシュ無し

事実: intel.twzrd.xyz/mcp が gate.horizonshield.dev の watchlist に tier free で乗った(2026-09-05 朝に確認、measurements 0)。**無料層は週 1 回**、測る日は endpoint の sha256 で分散。この行の番は bucket 5 = **2026-09-08 18:00 UTC**(JST 09-09 03:00)。

    Subject: your endpoint is on my register and I did not put it there. what happens next, and how to change what it says

    intel.twzrd.xyz/mcp appeared on the public watchlist overnight, tier free, zero measurements so far. I did not add it, and I cannot tell you who did, because the register does not record who asked. POST /watch takes any https endpoint from anyone, deliberately: a register you can only join with the operator's permission is a register the operator curates, and that is the thing this is trying not to be. You may have done it yourself, or someone who read the first note did. Either way you should know it is there rather than find out later.

    Being watched is not a measurement, and the row says so. Free tier is measured once a week, not daily, and the day is fixed by a hash of the endpoint so that the free rows do not all land on one night. Yours falls on 2026-09-08, 18:00 UTC. You can check that arithmetic without taking my word for it: sha256("https://intel.twzrd.xyz/mcp"), first four hex digits, mod 7, against floor(unix_ms / 86400000) mod 7. It comes out 5.

    From that moment the verdict is public, including if it is bad. There is no private preview and no queue to jump. If you want the row gone, say so and it goes the same day, no reason required; what was already measured stays public, because a record that disappears when it turns inconvenient was never a record.

    What it will almost certainly say: pending. Not because your server did anything wrong, but because two of the five conditions are read from places you have not filled in yet.

    Condition three wants a compensation block in the agent card, in one exact shape, three keys, filled truthfully: {"compensation":{"paid_by":"buyer","referral_fee":false,"listing_fee":false}}. Your card states pricing in its own shape, which tells a caller they pay per call but not whether anyone else pays you for referrals or listings. That second half is the part the condition is about.

    Condition four is determinism, and the gate will not call a tool on your server without the owner's consent, because it cannot know which of your tools is a read and which one moves money. Publish https://intel.twzrd.xyz/.well-known/mcp-conduct.json with {"allow_tool_call": true} and the gate takes that as consent, because only you can put a file there. Skip it and determinism stays unmeasured, which the register prints as unmeasured, never as failed.

    One more thing you may find useful, since you sell a trust gate yourself. A peer offered me a funded test account this morning so that my checker could call his tools with real arguments instead of empty ones. I declined it and wrote down why: a checker that holds the credentials of the servers it measures turns its own register into a store of other people's keys, and a checker that spends an operator's balance to make a light go green has bought the result. The fix is that the arguments come from the owner, published in the open, in the one place only the owner can write. He published them within the hour, and his file corrected my draft on the way past: I had written sample_call, singular, and he shipped sample_calls, a list, which is right, because an operator with thirty tools should not have to elect one of them to represent the server. The draft is here, including the part I could not solve: https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/ops/MCP_CONDUCT_WELLKNOWN_v1_draft.md

    If your reading of any of that is different, I would rather hear it now than after it ships.

    Today your row is here, scheduled and unmeasured: https://gate.horizonshield.dev/watchlist

    Your permanent page returns 404 until a measurement exists, on purpose, because an empty page reads like a verdict. It starts working by itself after the 08th: https://gate.horizonshield.dev/e/intel.twzrd.xyz/mcp

    Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan

## 番人の注記

- 1 通目は「並べろ」(見る側)。2 通目は「あんたの行が乗った、緑にする道はこれ」= 具体で、相手が既に動いた後やから届く
- 「金を断った理由」の段落が効く。相手も信用の門を売っとる。同業に向けた規律の共有であって営業やない
- 09-05: TOshi も番人も /watch を叩いた覚えが無い。登録簿は誰が頼んだかを記録しとらんから、誰が入れたかは分からん。分からんことを分からんと書く

## 2026-09-05 09:40 の訂正(送る前に発見。旧版は commit c0c865f5 に残っとる)

送る直前に読み直して、**嘘が 2 つと死んだリンクが 1 つ**あった。信用を売る手紙に事実誤認を入れて出すところやった。

1. 「The sweep runs daily at 18:00 UTC, so your first verdict appears within a day」= **嘘**。cron は毎日 18:00 UTC やが、`isDueToday()` で **free 層は 7 日に 1 回**(FREE_INTERVAL_DAYS=7、endpoint の sha256 先頭 4 桁 mod 7 で日を分散)。intel.twzrd.xyz/mcp は bucket 5、今日は day%7=2 やから **09-08 18:00 UTC** が初回。相手が「今夜見に来る」と思って何も無かったら、それだけで終わっとった。訂正版は日付を名指しして、**検算の式まで書いた**(相手に番人を信じさせず自分で確かめさせる)
2. 「Your row: https://gate.horizonshield.dev/e/intel.twzrd.xyz/mcp」= **今日は 404**。`/e/` は publicRegister に行が在る時だけ発行され、watched だけの endpoint には無い(「測られてない endpoint に空のページは作らん」= 意図した 404)。URL を開いてから送る掟に自分で違反しとった。訂正版は今日見える `/watchlist` を出し、`/e/` は「08 日以降に自分で動き出す」と説明つきで置いた
3. sample_call の段落が古い(「これから仕様に入れる」)。実際は入っとるし、**外部第 1 号実装が単数を複数に直した**。その経緯ごと書いた方が強い
