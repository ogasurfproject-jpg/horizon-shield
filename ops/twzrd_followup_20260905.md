# TWZRD への 2 通目(2026-09-05)。1 通目の後、相手が登録簿に入ったのを見てから。英語、ダッシュ無し

事実: intel.twzrd.xyz/mcp が gate.horizonshield.dev/register に tier free で乗った(2026-09-05 朝に番人が確認、measurements 0、次の掃引は毎日 18:00 UTC)。

    Subject: your endpoint is on my register and I did not put it there. what happens next, and how to change what it says

    intel.twzrd.xyz/mcp appeared on the public register overnight, tier free, zero measurements so far. I did not add it, and I cannot tell you who did, because the register does not record who asked. POST /watch takes any https endpoint from anyone, deliberately: a register you can only join with the operator's permission is a register the operator curates, and that is the thing this is trying not to be. You may have done it yourself, or someone who read the note did. Either way you should know it is there rather than find out later.

    Being watched is not a measurement and the register says so on the row. The sweep runs daily at 18:00 UTC, so your first verdict appears within a day and is public from that moment, including if it is bad. There is no private preview and no queue to jump. If you want the row gone, say so and it goes the same day, no reason required; what was already measured stays public, because a record that disappears when it turns inconvenient was never a record.

    What it will almost certainly say: pending. Not because your server did anything wrong, but because two of the five conditions are read from places you have not filled in yet.

    Condition three wants a compensation block in the agent card, in one exact shape, three keys, filled truthfully: {"compensation":{"paid_by":"buyer","referral_fee":false,"listing_fee":false}}. Your card states pricing in its own shape, which tells a caller they pay per call but not whether anyone else pays you for referrals or listings. That second half is the part the condition is about.

    Condition four is determinism, and the gate will not call a tool on your server without the owner's consent, because it cannot know which of your tools is a read and which one moves money. Publish https://intel.twzrd.xyz/.well-known/mcp-conduct.json with {"allow_tool_call": true} and the gate takes that as consent, because only you can put a file there. Skip it and determinism stays unmeasured, which the register prints as unmeasured, never as failed.

    One more thing you may find useful, since you sell a trust gate yourself. A peer offered me a funded test account this morning so my checker could call his tools with real arguments instead of empty ones. I declined it and wrote down why: a checker that holds the credentials of the servers it measures turns its own register into a store of other people's keys, and a checker that spends an operator's balance to make a light go green has bought the result. The fix is that the arguments come from the owner, published in the open. That is going into the spec as a sample_call field before any code is written: https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/ops/MCP_CONDUCT_WELLKNOWN_v1_draft.md

    If your reading of that is different, I would rather hear it now than after it ships.

    Your row: https://gate.horizonshield.dev/e/intel.twzrd.xyz/mcp

    Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan

## 番人の注記

- 1 通目は「並べろ」(見る側)。2 通目は「あんたの行が乗った、緑にする道はこれ」= 具体で、相手が既に動いた後やから届く
- 最後から 2 つ目の段落が効く。相手も信用の門を売っとる。**同業に向かって「金を断った理由」を書いた**。これは営業やなく規律の共有で、相手が一番反応する形
- 09-05: TOshi も番人も /watch を叩いた覚えが無い。登録簿は誰が頼んだかを記録しとらんから、**誰が入れたかは分からん**。せやから文面は「乗った、俺は入れとらん、誰かは分からん、/watch は誰でも叩ける設計や」に直した。分からんことを分からんと書くのが、この事業で一番効く
- 「抜けたければ同日に外す、測った分は残る」を足した。これは verify-directory に既に書いとる約束と同じ文言
