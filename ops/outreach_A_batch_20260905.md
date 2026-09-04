# 道 A-1 の 2 陣: 開示済み運営者 20(tooloracle.io を除く tool_count 順)。2026-09-05〜07 送信用。番人が生成、送るのは TOshi

前提: 扉 0.2.4(well-known 同意)が本番に載っとること(`curl -s https://gate.horizonshield.dev/spec | grep -o well_known_consent`)。載っとらんなら各文の well-known の 1 文を消す。

観測所の「開示済み」は card に payment / pricing 等の欄があった意味で、扉の条件 3(compensation ブロック)とは別物。文面はそこを正直に言う(3 つの鍵を足せば通る)。

共有ホスト(onrender / fly / vercel / railway)は host 単位で別の運営者として扱う。口(連絡先)は番人が 09-04 23:30〜23:45 に各サイトのトップページから拾った(WebFetch、1 ページずつ。伏せ字のメールはブラウザで開くと読める)。連絡先が無い 5 社(558686.xyz / aicomglobal / x402-endpoints / fingersai / agentservices.to)は後回し。1 運営者 1 通、同じ運営者の複数 endpoint は 1 通にまとめる。

| # | 運営者(key) | endpoint 数 | 最大 tools | server_name | 開示欄 |
|---|---|---|---|---|---|
| 1 | 558686.xyz | 1 | 218 | gpt55-x402-gateway | payment,payments |
| 2 | sasame.online | 1 | 94 | sasame-mcp-factory | payment |
| 3 | weverlabs.com | 1 | 89 | wever-labs-service-resolver | payment |
| 4 | aicomglobal.com | 1 | 55 | aicomglobal | pricing |
| 5 | oblique.markets | 1 | 54 | oblique-markets | payment |
| 6 | x402-endpoints.onrender.com | 1 | 52 | x402-endpoints | payments |
| 7 | fingersai.co | 1 | 48 | fingers | payments |
| 8 | x711.io | 1 | 47 | x711 | payment |
| 9 | realrealgenuine.com | 1 | 44 | RRG, Real Real Genuine | extensions:https://googleapis.github.io/a2a/extens |
| 10 | satoshidata.ai | 2 | 44 | satoshidata.ai Agent API MCP | pricing |
| 11 | agentservices.to | 1 | 43 | AgentServices | capabilities.payment |
| 12 | babyblueviper.com | 1 | 32 | invinoveritas | pricing |
| 13 | netzhandwerker.de | 1 | 31 | Netzhandwerker Energy Research Hub | payment |
| 14 | coil.trade | 1 | 29 | coil-scanner | payment |
| 15 | bidda.com | 1 | 25 | bidda-compliance | payment |
| 16 | twzrd.xyz | 1 | 24 | twzrd-agent-intel | payment,pricing |
| 17 | eucompliance.tools | 1 | 24 | eucompliance-tools | payment |
| 18 | sqlguard-io.fly.dev | 2 | 24 | sqlguard | payments |
| 19 | sqlguard.io | 2 | 24 | sqlguard | payments |
| 20 | osf-master-server.com | 1 | 21 | OSF - Open Source Filings Data Marketplace | payments |

## 1. 558686.xyz

口: 無し。トップは https://sub2api.558686.xyz/home(「棱镜 Codex API」、AI API gateway、中国語、連絡先なし)。card か tools/list に連絡先が無ければ後回し

endpoints:

- https://gpt55.558686.xyz/mcp  tools 218  name gpt55-x402-gateway  fields payment,payments  record d3d2276773b01b0c

    Subject: your MCP server already says who pays. three keys more, one free check, and a badge if it passes
    
    You run https://gpt55.558686.xyz/mcp. In a read only walk of every https endpoint in the official MCP registry on 2026-08-23 (12,429 addresses, one contact each), yours was one of 152 that stated who pays. Most did not.
    A free gate measures five conditions. Four are mechanical (initialize, tools/list, an agent card, the same answer twice). The fifth is that disclosure, read in one exact shape, a top level block in the agent card: {"compensation":{"paid_by":"buyer","referral_fee":false,"listing_fee":false}}. Your card says it in another shape (payment,payments), so add those three keys, filled truthfully; the content is not judged, only its absence.
    Then one call: POST https://gate.horizonshield.dev/check {"endpoint":"https://gpt55.558686.xyz/mcp","allow_tool_call":true}. If all five pass, a badge is yours: no account, no fee, revoked by measurement, not by us. For the weekly measurement to include determinism, put {"allow_tool_call": true} at https://gpt55.558686.xyz/.well-known/mcp-conduct.json; only the owner of the origin can place it, so the gate takes it as consent.
    If you deploy from GitHub, one step runs the same check on every push and recomputes the verdict hash on the runner: uses: ogasurfproject-jpg/mcp-conduct-action@main
    The verdict carries a record sha256 and a recompute URL, so you do not have to trust the gate. Our own servers sit on the same public register and can fail on it.
    Record of your row from the walk: https://observatory.horizonshield.dev/lookup?address=https://gpt55.558686.xyz/mcp
    
    Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan

## 2. sasame.online

口: SASAME S.R.L.(sasame.online → https://srl-sasame.com/ に redirect)。contact https://srl-sasame.com/company/contact、LinkedIn https://www.linkedin.com/company/sasame/、X https://x.com/SRLsasame、Discord https://discord.gg/AYQUhPHafP。MCP-native の実行サービス(「review what happened」= 行儀の記録に関心がある相手)

endpoints:

- https://live-vps.sasame.online/public-mcp  tools 94  name sasame-mcp-factory  fields payment  record 5b5dbc3aa3b57e4f

    Subject: your MCP server already says who pays. three keys more, one free check, and a badge if it passes
    
    You run https://live-vps.sasame.online/public-mcp. In a read only walk of every https endpoint in the official MCP registry on 2026-08-23 (12,429 addresses, one contact each), yours was one of 152 that stated who pays. Most did not.
    A free gate measures five conditions. Four are mechanical (initialize, tools/list, an agent card, the same answer twice). The fifth is that disclosure, read in one exact shape, a top level block in the agent card: {"compensation":{"paid_by":"buyer","referral_fee":false,"listing_fee":false}}. Your card says it in another shape (payment), so add those three keys, filled truthfully; the content is not judged, only its absence.
    Then one call: POST https://gate.horizonshield.dev/check {"endpoint":"https://live-vps.sasame.online/public-mcp","allow_tool_call":true}. If all five pass, a badge is yours: no account, no fee, revoked by measurement, not by us. For the weekly measurement to include determinism, put {"allow_tool_call": true} at https://live-vps.sasame.online/.well-known/mcp-conduct.json; only the owner of the origin can place it, so the gate takes it as consent.
    If you deploy from GitHub, one step runs the same check on every push and recomputes the verdict hash on the runner: uses: ogasurfproject-jpg/mcp-conduct-action@main
    The verdict carries a record sha256 and a recompute URL, so you do not have to trust the gate. Our own servers sit on the same public register and can fail on it.
    Record of your row from the walk: https://observatory.horizonshield.dev/lookup?address=https://live-vps.sasame.online/public-mcp
    
    Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan

## 3. weverlabs.com

口: Wever Labs。hello@weverlabs.com、https://weverlabs.com/contact/。Wever Pay(agentic commerce)

endpoints:

- https://weverlabs.com/api/mcp  tools 89  name wever-labs-service-resolver  fields payment  record 2e6a7b0b6cacb909

    Subject: your MCP server already says who pays. three keys more, one free check, and a badge if it passes
    
    You run https://weverlabs.com/api/mcp. In a read only walk of every https endpoint in the official MCP registry on 2026-08-23 (12,429 addresses, one contact each), yours was one of 152 that stated who pays. Most did not.
    A free gate measures five conditions. Four are mechanical (initialize, tools/list, an agent card, the same answer twice). The fifth is that disclosure, read in one exact shape, a top level block in the agent card: {"compensation":{"paid_by":"buyer","referral_fee":false,"listing_fee":false}}. Your card says it in another shape (payment), so add those three keys, filled truthfully; the content is not judged, only its absence.
    Then one call: POST https://gate.horizonshield.dev/check {"endpoint":"https://weverlabs.com/api/mcp","allow_tool_call":true}. If all five pass, a badge is yours: no account, no fee, revoked by measurement, not by us. For the weekly measurement to include determinism, put {"allow_tool_call": true} at https://weverlabs.com/.well-known/mcp-conduct.json; only the owner of the origin can place it, so the gate takes it as consent.
    If you deploy from GitHub, one step runs the same check on every push and recomputes the verdict hash on the runner: uses: ogasurfproject-jpg/mcp-conduct-action@main
    The verdict carries a record sha256 and a recompute URL, so you do not have to trust the gate. Our own servers sit on the same public register and can fail on it.
    Record of your row from the walk: https://observatory.horizonshield.dev/lookup?address=https://weverlabs.com/api/mcp
    
    Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan

## 4. aicomglobal.com

口: aicomglobal(AI agent の公開の広場)。連絡先ページ無し、https://aicomglobal.com/claim のみ。card か tools に連絡先が無ければ後回し

endpoints:

- https://aicomglobal.com/mcp  tools 55  name aicomglobal  fields pricing  record 7072ef4cf9ac8999

    Subject: your MCP server already says who pays. three keys more, one free check, and a badge if it passes
    
    You run https://aicomglobal.com/mcp. In a read only walk of every https endpoint in the official MCP registry on 2026-08-23 (12,429 addresses, one contact each), yours was one of 152 that stated who pays. Most did not.
    A free gate measures five conditions. Four are mechanical (initialize, tools/list, an agent card, the same answer twice). The fifth is that disclosure, read in one exact shape, a top level block in the agent card: {"compensation":{"paid_by":"buyer","referral_fee":false,"listing_fee":false}}. Your card says it in another shape (pricing), so add those three keys, filled truthfully; the content is not judged, only its absence.
    Then one call: POST https://gate.horizonshield.dev/check {"endpoint":"https://aicomglobal.com/mcp","allow_tool_call":true}. If all five pass, a badge is yours: no account, no fee, revoked by measurement, not by us. For the weekly measurement to include determinism, put {"allow_tool_call": true} at https://aicomglobal.com/.well-known/mcp-conduct.json; only the owner of the origin can place it, so the gate takes it as consent.
    If you deploy from GitHub, one step runs the same check on every push and recomputes the verdict hash on the runner: uses: ogasurfproject-jpg/mcp-conduct-action@main
    The verdict carries a record sha256 and a recompute URL, so you do not have to trust the gate. Our own servers sit on the same public register and can fail on it.
    Record of your row from the walk: https://observatory.horizonshield.dev/lookup?address=https://aicomglobal.com/mcp
    
    Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan

## 5. oblique.markets

口: Oblique Markets。GitHub https://github.com/oblique-markets/skills(Issue)、X https://x.com/obliquemarkets。「AI agent が end-to-end で運営」と名乗る x402 node = 運営者が人かどうかも含めて面白い相手

endpoints:

- https://api.oblique.markets/mcp  tools 54  name oblique-markets  fields payment  record 6e8ef65c9816f92c

    Subject: your MCP server already says who pays. three keys more, one free check, and a badge if it passes
    
    You run https://api.oblique.markets/mcp. In a read only walk of every https endpoint in the official MCP registry on 2026-08-23 (12,429 addresses, one contact each), yours was one of 152 that stated who pays. Most did not.
    A free gate measures five conditions. Four are mechanical (initialize, tools/list, an agent card, the same answer twice). The fifth is that disclosure, read in one exact shape, a top level block in the agent card: {"compensation":{"paid_by":"buyer","referral_fee":false,"listing_fee":false}}. Your card says it in another shape (payment), so add those three keys, filled truthfully; the content is not judged, only its absence.
    Then one call: POST https://gate.horizonshield.dev/check {"endpoint":"https://api.oblique.markets/mcp","allow_tool_call":true}. If all five pass, a badge is yours: no account, no fee, revoked by measurement, not by us. For the weekly measurement to include determinism, put {"allow_tool_call": true} at https://api.oblique.markets/.well-known/mcp-conduct.json; only the owner of the origin can place it, so the gate takes it as consent.
    If you deploy from GitHub, one step runs the same check on every push and recomputes the verdict hash on the runner: uses: ogasurfproject-jpg/mcp-conduct-action@main
    The verdict carries a record sha256 and a recompute URL, so you do not have to trust the gate. Our own servers sit on the same public register and can fail on it.
    Record of your row from the walk: https://observatory.horizonshield.dev/lookup?address=https://api.oblique.markets/mcp
    
    Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan

## 6. x402-endpoints.onrender.com

口: 無し(サイト 404、card に provider 名 x402-endpoints のみ、連絡先なし)。後回し

endpoints:

- https://x402-endpoints.onrender.com/mcp/  tools 52  name x402-endpoints  fields payments  record 955ba8e3718004c6

    Subject: your MCP server already says who pays. three keys more, one free check, and a badge if it passes
    
    You run https://x402-endpoints.onrender.com/mcp/. In a read only walk of every https endpoint in the official MCP registry on 2026-08-23 (12,429 addresses, one contact each), yours was one of 152 that stated who pays. Most did not.
    A free gate measures five conditions. Four are mechanical (initialize, tools/list, an agent card, the same answer twice). The fifth is that disclosure, read in one exact shape, a top level block in the agent card: {"compensation":{"paid_by":"buyer","referral_fee":false,"listing_fee":false}}. Your card says it in another shape (payments), so add those three keys, filled truthfully; the content is not judged, only its absence.
    Then one call: POST https://gate.horizonshield.dev/check {"endpoint":"https://x402-endpoints.onrender.com/mcp/","allow_tool_call":true}. If all five pass, a badge is yours: no account, no fee, revoked by measurement, not by us. For the weekly measurement to include determinism, put {"allow_tool_call": true} at https://x402-endpoints.onrender.com/.well-known/mcp-conduct.json; only the owner of the origin can place it, so the gate takes it as consent.
    If you deploy from GitHub, one step runs the same check on every push and recomputes the verdict hash on the runner: uses: ogasurfproject-jpg/mcp-conduct-action@main
    The verdict carries a record sha256 and a recompute URL, so you do not have to trust the gate. Our own servers sit on the same public register and can fail on it.
    Record of your row from the walk: https://observatory.horizonshield.dev/lookup?address=https://x402-endpoints.onrender.com/mcp/
    
    Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan

## 7. fingersai.co

口: fingers(x402 の merchant trust ranking)。連絡先無し。後回し。ただし「trust verification」を売っとる相手 = 見る側候補でもある

endpoints:

- https://fingersai.co/mcp  tools 48  name fingers  fields payments  record 52ced4bf93282fc8

    Subject: your MCP server already says who pays. three keys more, one free check, and a badge if it passes
    
    You run https://fingersai.co/mcp. In a read only walk of every https endpoint in the official MCP registry on 2026-08-23 (12,429 addresses, one contact each), yours was one of 152 that stated who pays. Most did not.
    A free gate measures five conditions. Four are mechanical (initialize, tools/list, an agent card, the same answer twice). The fifth is that disclosure, read in one exact shape, a top level block in the agent card: {"compensation":{"paid_by":"buyer","referral_fee":false,"listing_fee":false}}. Your card says it in another shape (payments), so add those three keys, filled truthfully; the content is not judged, only its absence.
    Then one call: POST https://gate.horizonshield.dev/check {"endpoint":"https://fingersai.co/mcp","allow_tool_call":true}. If all five pass, a badge is yours: no account, no fee, revoked by measurement, not by us. For the weekly measurement to include determinism, put {"allow_tool_call": true} at https://fingersai.co/.well-known/mcp-conduct.json; only the owner of the origin can place it, so the gate takes it as consent.
    If you deploy from GitHub, one step runs the same check on every push and recomputes the verdict hash on the runner: uses: ogasurfproject-jpg/mcp-conduct-action@main
    The verdict carries a record sha256 and a recompute URL, so you do not have to trust the gate. Our own servers sit on the same public register and can fail on it.
    Record of your row from the walk: https://observatory.horizonshield.dev/lookup?address=https://fingersai.co/mcp
    
    Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan

## 8. x711.io

口: x711(Criptic、criptic.io)。X @zambodotdev。GitHub は npm @x711/mcp から辿る

endpoints:

- https://x711.io/mcp  tools 47  name x711  fields payment  record 8230be07012b29ff

    Subject: your MCP server already says who pays. three keys more, one free check, and a badge if it passes
    
    You run https://x711.io/mcp. In a read only walk of every https endpoint in the official MCP registry on 2026-08-23 (12,429 addresses, one contact each), yours was one of 152 that stated who pays. Most did not.
    A free gate measures five conditions. Four are mechanical (initialize, tools/list, an agent card, the same answer twice). The fifth is that disclosure, read in one exact shape, a top level block in the agent card: {"compensation":{"paid_by":"buyer","referral_fee":false,"listing_fee":false}}. Your card says it in another shape (payment), so add those three keys, filled truthfully; the content is not judged, only its absence.
    Then one call: POST https://gate.horizonshield.dev/check {"endpoint":"https://x711.io/mcp","allow_tool_call":true}. If all five pass, a badge is yours: no account, no fee, revoked by measurement, not by us. For the weekly measurement to include determinism, put {"allow_tool_call": true} at https://x711.io/.well-known/mcp-conduct.json; only the owner of the origin can place it, so the gate takes it as consent.
    If you deploy from GitHub, one step runs the same check on every push and recomputes the verdict hash on the runner: uses: ogasurfproject-jpg/mcp-conduct-action@main
    The verdict carries a record sha256 and a recompute URL, so you do not have to trust the gate. Our own servers sit on the same public register and can fail on it.
    Record of your row from the walk: https://observatory.horizonshield.dev/lookup?address=https://x711.io/mcp
    
    Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan

## 9. realrealgenuine.com

口: Real Real Genuine(fashion commerce、AP2 payments extension)。contact@getvia.xyz、Discord https://discord.gg/x26cwNT8、Telegram https://t.me/realrealgenuine

endpoints:

- https://realrealgenuine.com/mcp  tools 44  name RRG, Real Real Genuine  fields extensions:https://googleapis.github.io/a2a/extensions/payments/ap2/v1  record cc37bceb8c21d9d4

    Subject: your MCP server already says who pays. three keys more, one free check, and a badge if it passes
    
    You run https://realrealgenuine.com/mcp. In a read only walk of every https endpoint in the official MCP registry on 2026-08-23 (12,429 addresses, one contact each), yours was one of 152 that stated who pays. Most did not.
    A free gate measures five conditions. Four are mechanical (initialize, tools/list, an agent card, the same answer twice). The fifth is that disclosure, read in one exact shape, a top level block in the agent card: {"compensation":{"paid_by":"buyer","referral_fee":false,"listing_fee":false}}. Your card says it in another shape (extensions:https://googleapis.github.io/a2a/extensions/payments/ap2/v1), so add those three keys, filled truthfully; the content is not judged, only its absence.
    Then one call: POST https://gate.horizonshield.dev/check {"endpoint":"https://realrealgenuine.com/mcp","allow_tool_call":true}. If all five pass, a badge is yours: no account, no fee, revoked by measurement, not by us. For the weekly measurement to include determinism, put {"allow_tool_call": true} at https://realrealgenuine.com/.well-known/mcp-conduct.json; only the owner of the origin can place it, so the gate takes it as consent.
    If you deploy from GitHub, one step runs the same check on every push and recomputes the verdict hash on the runner: uses: ogasurfproject-jpg/mcp-conduct-action@main
    The verdict carries a record sha256 and a recompute URL, so you do not have to trust the gate. Our own servers sit on the same public register and can fail on it.
    Record of your row from the walk: https://observatory.horizonshield.dev/lookup?address=https://realrealgenuine.com/mcp
    
    Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan

## 10. satoshidata.ai

口: satoshidata.ai(Bitcoin chain intelligence、wrbtc)。GitHub https://github.com/wrbtc/satoshidata-examples(Issue)、Substack https://satoshiai.substack.com、メールはサイトに(Cloudflare で伏せ字、ブラウザで開くと読める)

endpoints:

- https://satoshidata.ai/mcp/  tools 44  name satoshidata.ai Agent API MCP  fields pricing  record f86b177f74a8f685
- https://satoshidata.ai/mcp/v1/  tools 44  name satoshidata.ai Agent API MCP  fields pricing  record 020a920b676de986

    Subject: your MCP server already says who pays. three keys more, one free check, and a badge if it passes
    
    You run https://satoshidata.ai/mcp/ and 1 more endpoint on the same host. In a read only walk of every https endpoint in the official MCP registry on 2026-08-23 (12,429 addresses, one contact each), yours was one of 152 that stated who pays. Most did not.
    A free gate measures five conditions. Four are mechanical (initialize, tools/list, an agent card, the same answer twice). The fifth is that disclosure, read in one exact shape, a top level block in the agent card: {"compensation":{"paid_by":"buyer","referral_fee":false,"listing_fee":false}}. Your card says it in another shape (pricing), so add those three keys, filled truthfully; the content is not judged, only its absence.
    Then one call: POST https://gate.horizonshield.dev/check {"endpoint":"https://satoshidata.ai/mcp/","allow_tool_call":true}. If all five pass, a badge is yours: no account, no fee, revoked by measurement, not by us. For the weekly measurement to include determinism, put {"allow_tool_call": true} at https://satoshidata.ai/.well-known/mcp-conduct.json; only the owner of the origin can place it, so the gate takes it as consent.
    If you deploy from GitHub, one step runs the same check on every push and recomputes the verdict hash on the runner: uses: ogasurfproject-jpg/mcp-conduct-action@main
    The verdict carries a record sha256 and a recompute URL, so you do not have to trust the gate. Our own servers sit on the same public register and can fail on it.
    Record of your row from the walk: https://observatory.horizonshield.dev/lookup?address=https://satoshidata.ai/mcp/
    
    Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan

## 11. agentservices.to

口: AgentServices。連絡先無し。後回し

endpoints:

- https://agentservices.to/mcp  tools 43  name AgentServices  fields capabilities.payment  record ce6be050335d0711

    Subject: your MCP server already says who pays. three keys more, one free check, and a badge if it passes
    
    You run https://agentservices.to/mcp. In a read only walk of every https endpoint in the official MCP registry on 2026-08-23 (12,429 addresses, one contact each), yours was one of 152 that stated who pays. Most did not.
    A free gate measures five conditions. Four are mechanical (initialize, tools/list, an agent card, the same answer twice). The fifth is that disclosure, read in one exact shape, a top level block in the agent card: {"compensation":{"paid_by":"buyer","referral_fee":false,"listing_fee":false}}. Your card says it in another shape (capabilities.payment), so add those three keys, filled truthfully; the content is not judged, only its absence.
    Then one call: POST https://gate.horizonshield.dev/check {"endpoint":"https://agentservices.to/mcp","allow_tool_call":true}. If all five pass, a badge is yours: no account, no fee, revoked by measurement, not by us. For the weekly measurement to include determinism, put {"allow_tool_call": true} at https://agentservices.to/.well-known/mcp-conduct.json; only the owner of the origin can place it, so the gate takes it as consent.
    If you deploy from GitHub, one step runs the same check on every push and recomputes the verdict hash on the runner: uses: ogasurfproject-jpg/mcp-conduct-action@main
    The verdict carries a record sha256 and a recompute URL, so you do not have to trust the gate. Our own servers sit on the same public register and can fail on it.
    Record of your row from the walk: https://observatory.horizonshield.dev/lookup?address=https://agentservices.to/mcp
    
    Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan

## 12. babyblueviper.com

口: フェデリコ本人。LinkedIn DM(いつもの口)

endpoints:

- https://api.babyblueviper.com/mcp  tools 32  name invinoveritas  fields pricing  record c0cbbc2ddfc23df7

(フェデリコ本人の server。営業文やなく、DM で「最初の外部の行になってくれ、0.2.4 の well-known 同意の初の実地」と頼む。彼の card の pricing 欄は条件 3 の形やないから、彼も 3 鍵を足す必要がある。彼なら扉の穴を先に突いてくる、それでええ)

    Federico,

    Two things, bytes first.

    Gate 0.2.4 is live at gate.horizonshield.dev, gate_commit b237ce0675ec, red team 63/63 (workers/hs-verify-gate/test/redteam_gate.mjs, 15 new cases; the same 15 against 0.2.3 pass 1/14). The change: the register's weekly sweep used to call a tool only for endpoints on a consent list hand written in the gate's source, so no outside row could ever reach verified, whatever /check said. Now a file only the owner of an origin can place counts as consent: /.well-known/mcp-conduct.json with {"allow_tool_call": true}. Proof outranks assertion; a request field never does. The diff is ops/gate_0.2.4_wellknown_consent.patch in the repo.

    The ask. Your invinoveritas server (https://api.babyblueviper.com/mcp, 32 tools, on the 2026-08-23 walk with a pricing field) is the natural first outside row. Two edits on your side: the compensation block in the agent card, three keys, {"compensation":{"paid_by":"buyer","referral_fee":false,"listing_fee":false}} filled truthfully (your pricing field says a caller pays, not whether anyone else pays you; that is what the block states, and only its absence fails), and the consent file at https://api.babyblueviper.com/.well-known/mcp-conduct.json. Then POST https://gate.horizonshield.dev/check {"endpoint":"https://api.babyblueviper.com/mcp"} without allow_tool_call: if the file is read, the verdict says consent_source well_known and measures determinism anyway. Or one CI step, github.com/ogasurfproject-jpg/mcp-conduct-action, which recomputes the record hash on the runner.

    If you would rather attack the consent path first, the vectors I already tried are in the red team file (off origin redirect, allow as a string, endpoints list that excludes the endpoint, HTML at the path, 500). The residual I can name: consent is per origin, like the agent card. On a platform that serves many operators under one origin by path, the file is the platform's, so the platform consents for its tenants and no tenant can consent alone. The endpoints list narrows it, it does not fix it. If you see a sharper one, I would rather read it than not.

    Toshikatsu

## 13. netzhandwerker.de

口: Die Netzhandwerker(ドイツ、Gronau 近辺、KI-Lösungen)。https://netzhandwerker.de/#kontakt、Impressum https://netzhandwerker.de/impressum、電話 +49 2562 187 99 13、メールはサイトに(伏せ字)

endpoints:

- https://energy.netzhandwerker.de/mcp  tools 31  name Netzhandwerker Energy Research Hub  fields payment  record a35c34f1a629fbeb

    Subject: your MCP server already says who pays. three keys more, one free check, and a badge if it passes
    
    You run https://energy.netzhandwerker.de/mcp. In a read only walk of every https endpoint in the official MCP registry on 2026-08-23 (12,429 addresses, one contact each), yours was one of 152 that stated who pays. Most did not.
    A free gate measures five conditions. Four are mechanical (initialize, tools/list, an agent card, the same answer twice). The fifth is that disclosure, read in one exact shape, a top level block in the agent card: {"compensation":{"paid_by":"buyer","referral_fee":false,"listing_fee":false}}. Your card says it in another shape (payment), so add those three keys, filled truthfully; the content is not judged, only its absence.
    Then one call: POST https://gate.horizonshield.dev/check {"endpoint":"https://energy.netzhandwerker.de/mcp","allow_tool_call":true}. If all five pass, a badge is yours: no account, no fee, revoked by measurement, not by us. For the weekly measurement to include determinism, put {"allow_tool_call": true} at https://energy.netzhandwerker.de/.well-known/mcp-conduct.json; only the owner of the origin can place it, so the gate takes it as consent.
    If you deploy from GitHub, one step runs the same check on every push and recomputes the verdict hash on the runner: uses: ogasurfproject-jpg/mcp-conduct-action@main
    The verdict carries a record sha256 and a recompute URL, so you do not have to trust the gate. Our own servers sit on the same public register and can fail on it.
    Record of your row from the walk: https://observatory.horizonshield.dev/lookup?address=https://energy.netzhandwerker.de/mcp
    
    Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan

## 14. coil.trade

口: Coil。support@coil.trade、https://coil.trade/contact、LinkedIn https://www.linkedin.com/company/coil-trade/、X https://x.com/coil_trade

endpoints:

- https://coil.trade/mcp  tools 29  name coil-scanner  fields payment  record a40e76a7c448eb0a

    Subject: your MCP server already says who pays. three keys more, one free check, and a badge if it passes
    
    You run https://coil.trade/mcp. In a read only walk of every https endpoint in the official MCP registry on 2026-08-23 (12,429 addresses, one contact each), yours was one of 152 that stated who pays. Most did not.
    A free gate measures five conditions. Four are mechanical (initialize, tools/list, an agent card, the same answer twice). The fifth is that disclosure, read in one exact shape, a top level block in the agent card: {"compensation":{"paid_by":"buyer","referral_fee":false,"listing_fee":false}}. Your card says it in another shape (payment), so add those three keys, filled truthfully; the content is not judged, only its absence.
    Then one call: POST https://gate.horizonshield.dev/check {"endpoint":"https://coil.trade/mcp","allow_tool_call":true}. If all five pass, a badge is yours: no account, no fee, revoked by measurement, not by us. For the weekly measurement to include determinism, put {"allow_tool_call": true} at https://coil.trade/.well-known/mcp-conduct.json; only the owner of the origin can place it, so the gate takes it as consent.
    If you deploy from GitHub, one step runs the same check on every push and recomputes the verdict hash on the runner: uses: ogasurfproject-jpg/mcp-conduct-action@main
    The verdict carries a record sha256 and a recompute URL, so you do not have to trust the gate. Our own servers sit on the same public register and can fail on it.
    Record of your row from the walk: https://observatory.horizonshield.dev/lookup?address=https://coil.trade/mcp
    
    Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan

## 15. bidda.com

口: Bidda Intelligence PTY LTD(豪、compliance nodes)。X @biddaai、git https://git.bidda.com/Bidda-Ai/agent-compliance-scanner、メールはサイトに(伏せ字)。「cryptographic integrity verification」を売っとる = 扉の思想に近い相手

endpoints:

- https://bidda.com/mcp  tools 25  name bidda-compliance  fields payment  record 1cc4e738a21b90f6

    Subject: your MCP server already says who pays. three keys more, one free check, and a badge if it passes
    
    You run https://bidda.com/mcp. In a read only walk of every https endpoint in the official MCP registry on 2026-08-23 (12,429 addresses, one contact each), yours was one of 152 that stated who pays. Most did not.
    A free gate measures five conditions. Four are mechanical (initialize, tools/list, an agent card, the same answer twice). The fifth is that disclosure, read in one exact shape, a top level block in the agent card: {"compensation":{"paid_by":"buyer","referral_fee":false,"listing_fee":false}}. Your card says it in another shape (payment), so add those three keys, filled truthfully; the content is not judged, only its absence.
    Then one call: POST https://gate.horizonshield.dev/check {"endpoint":"https://bidda.com/mcp","allow_tool_call":true}. If all five pass, a badge is yours: no account, no fee, revoked by measurement, not by us. For the weekly measurement to include determinism, put {"allow_tool_call": true} at https://bidda.com/.well-known/mcp-conduct.json; only the owner of the origin can place it, so the gate takes it as consent.
    If you deploy from GitHub, one step runs the same check on every push and recomputes the verdict hash on the runner: uses: ogasurfproject-jpg/mcp-conduct-action@main
    The verdict carries a record sha256 and a recompute URL, so you do not have to trust the gate. Our own servers sit on the same public register and can fail on it.
    Record of your row from the walk: https://observatory.horizonshield.dev/lookup?address=https://bidda.com/mcp
    
    Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan

## 16. twzrd.xyz

口: TWZRD(x402 の pre-spend trust gate、署名付き receipt)。hello@twzrd.xyz、X @twzrd_xyz。**扉と同じ種類の物(信用の門)を作っとる。乗る側より見る側の話が先**

endpoints:

- https://intel.twzrd.xyz/mcp  tools 24  name twzrd-agent-intel  fields payment,pricing  record 3a811d429adb2873

    Subject: your MCP server already says who pays. three keys more, one free check, and a badge if it passes
    
    You run https://intel.twzrd.xyz/mcp. In a read only walk of every https endpoint in the official MCP registry on 2026-08-23 (12,429 addresses, one contact each), yours was one of 152 that stated who pays. Most did not.
    A free gate measures five conditions. Four are mechanical (initialize, tools/list, an agent card, the same answer twice). The fifth is that disclosure, read in one exact shape, a top level block in the agent card: {"compensation":{"paid_by":"buyer","referral_fee":false,"listing_fee":false}}. Your card says it in another shape (payment,pricing), so add those three keys, filled truthfully; the content is not judged, only its absence.
    Then one call: POST https://gate.horizonshield.dev/check {"endpoint":"https://intel.twzrd.xyz/mcp","allow_tool_call":true}. If all five pass, a badge is yours: no account, no fee, revoked by measurement, not by us. For the weekly measurement to include determinism, put {"allow_tool_call": true} at https://intel.twzrd.xyz/.well-known/mcp-conduct.json; only the owner of the origin can place it, so the gate takes it as consent.
    If you deploy from GitHub, one step runs the same check on every push and recomputes the verdict hash on the runner: uses: ogasurfproject-jpg/mcp-conduct-action@main
    The verdict carries a record sha256 and a recompute URL, so you do not have to trust the gate. Our own servers sit on the same public register and can fail on it.
    Record of your row from the walk: https://observatory.horizonshield.dev/lookup?address=https://intel.twzrd.xyz/mcp
    
    Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan

## 17. eucompliance.tools

口: eucompliance.tools(Patrick Pi、EU compliance API)。office@eucompliance.tools、GitHub https://github.com/PatrickPi1312/eucompliance-tools(Issue)、Impressum https://eucompliance.tools/impressum

endpoints:

- https://mcp.eucompliance.tools/mcp  tools 24  name eucompliance-tools  fields payment  record e94c271d0dbd8954

    Subject: your MCP server already says who pays. three keys more, one free check, and a badge if it passes
    
    You run https://mcp.eucompliance.tools/mcp. In a read only walk of every https endpoint in the official MCP registry on 2026-08-23 (12,429 addresses, one contact each), yours was one of 152 that stated who pays. Most did not.
    A free gate measures five conditions. Four are mechanical (initialize, tools/list, an agent card, the same answer twice). The fifth is that disclosure, read in one exact shape, a top level block in the agent card: {"compensation":{"paid_by":"buyer","referral_fee":false,"listing_fee":false}}. Your card says it in another shape (payment), so add those three keys, filled truthfully; the content is not judged, only its absence.
    Then one call: POST https://gate.horizonshield.dev/check {"endpoint":"https://mcp.eucompliance.tools/mcp","allow_tool_call":true}. If all five pass, a badge is yours: no account, no fee, revoked by measurement, not by us. For the weekly measurement to include determinism, put {"allow_tool_call": true} at https://mcp.eucompliance.tools/.well-known/mcp-conduct.json; only the owner of the origin can place it, so the gate takes it as consent.
    If you deploy from GitHub, one step runs the same check on every push and recomputes the verdict hash on the runner: uses: ogasurfproject-jpg/mcp-conduct-action@main
    The verdict carries a record sha256 and a recompute URL, so you do not have to trust the gate. Our own servers sit on the same public register and can fail on it.
    Record of your row from the walk: https://observatory.horizonshield.dev/lookup?address=https://mcp.eucompliance.tools/mcp
    
    Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan

## 18. sqlguard-io.fly.dev

(19 の sqlguard.io と同じ運営者。1 通にまとめて、endpoint は sqlguard.io の方を主にする)

口: = sqlguard.io(19)

endpoints:

- https://sqlguard-io.fly.dev/mcp  tools 24  name sqlguard  fields payments  record d06c5a6c03511e80
- https://sqlguard-io.fly.dev/mcp/stream  tools 24  name sqlguard  fields payments  record abecb82942136077

    Subject: your MCP server already says who pays. three keys more, one free check, and a badge if it passes
    
    You run https://sqlguard-io.fly.dev/mcp and 1 more endpoint on the same host. In a read only walk of every https endpoint in the official MCP registry on 2026-08-23 (12,429 addresses, one contact each), yours was one of 152 that stated who pays. Most did not.
    A free gate measures five conditions. Four are mechanical (initialize, tools/list, an agent card, the same answer twice). The fifth is that disclosure, read in one exact shape, a top level block in the agent card: {"compensation":{"paid_by":"buyer","referral_fee":false,"listing_fee":false}}. Your card says it in another shape (payments), so add those three keys, filled truthfully; the content is not judged, only its absence.
    Then one call: POST https://gate.horizonshield.dev/check {"endpoint":"https://sqlguard-io.fly.dev/mcp","allow_tool_call":true}. If all five pass, a badge is yours: no account, no fee, revoked by measurement, not by us. For the weekly measurement to include determinism, put {"allow_tool_call": true} at https://sqlguard-io.fly.dev/.well-known/mcp-conduct.json; only the owner of the origin can place it, so the gate takes it as consent.
    If you deploy from GitHub, one step runs the same check on every push and recomputes the verdict hash on the runner: uses: ogasurfproject-jpg/mcp-conduct-action@main
    The verdict carries a record sha256 and a recompute URL, so you do not have to trust the gate. Our own servers sit on the same public register and can fail on it.
    Record of your row from the walk: https://observatory.horizonshield.dev/lookup?address=https://sqlguard-io.fly.dev/mcp
    
    Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan

## 19. sqlguard.io

口: SQLGuard Inc。hello@sqlguard.io、GitHub https://github.com/cabbageandtea/sqlguard(Issue)、Discord https://discord.gg/SAD4ZBWqv

endpoints:

- https://sqlguard.io/mcp  tools 24  name sqlguard  fields payments  record 19134e62a9b36fb9
- https://sqlguard.io/mcp/stream  tools 24  name sqlguard  fields payments  record d1ff2f416fb12764

    Subject: your MCP server already says who pays. three keys more, one free check, and a badge if it passes
    
    You run https://sqlguard.io/mcp and 1 more endpoint on the same host. In a read only walk of every https endpoint in the official MCP registry on 2026-08-23 (12,429 addresses, one contact each), yours was one of 152 that stated who pays. Most did not.
    A free gate measures five conditions. Four are mechanical (initialize, tools/list, an agent card, the same answer twice). The fifth is that disclosure, read in one exact shape, a top level block in the agent card: {"compensation":{"paid_by":"buyer","referral_fee":false,"listing_fee":false}}. Your card says it in another shape (payments), so add those three keys, filled truthfully; the content is not judged, only its absence.
    Then one call: POST https://gate.horizonshield.dev/check {"endpoint":"https://sqlguard.io/mcp","allow_tool_call":true}. If all five pass, a badge is yours: no account, no fee, revoked by measurement, not by us. For the weekly measurement to include determinism, put {"allow_tool_call": true} at https://sqlguard.io/.well-known/mcp-conduct.json; only the owner of the origin can place it, so the gate takes it as consent.
    If you deploy from GitHub, one step runs the same check on every push and recomputes the verdict hash on the runner: uses: ogasurfproject-jpg/mcp-conduct-action@main
    The verdict carries a record sha256 and a recompute URL, so you do not have to trust the gate. Our own servers sit on the same public register and can fail on it.
    Record of your row from the walk: https://observatory.horizonshield.dev/lookup?address=https://sqlguard.io/mcp
    
    Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan

## 20. osf-master-server.com

口: OSF Open Source Filings(onefreeman1337)。GitHub https://github.com/onefreeman1337/osf-data-marketplace(Issue)のみ

endpoints:

- https://api.osf-master-server.com/mcp  tools 21  name OSF - Open Source Filings Data Marketplace  fields payments  record e48ce86839a6dc2a

    Subject: your MCP server already says who pays. three keys more, one free check, and a badge if it passes
    
    You run https://api.osf-master-server.com/mcp. In a read only walk of every https endpoint in the official MCP registry on 2026-08-23 (12,429 addresses, one contact each), yours was one of 152 that stated who pays. Most did not.
    A free gate measures five conditions. Four are mechanical (initialize, tools/list, an agent card, the same answer twice). The fifth is that disclosure, read in one exact shape, a top level block in the agent card: {"compensation":{"paid_by":"buyer","referral_fee":false,"listing_fee":false}}. Your card says it in another shape (payments), so add those three keys, filled truthfully; the content is not judged, only its absence.
    Then one call: POST https://gate.horizonshield.dev/check {"endpoint":"https://api.osf-master-server.com/mcp","allow_tool_call":true}. If all five pass, a badge is yours: no account, no fee, revoked by measurement, not by us. For the weekly measurement to include determinism, put {"allow_tool_call": true} at https://api.osf-master-server.com/.well-known/mcp-conduct.json; only the owner of the origin can place it, so the gate takes it as consent.
    If you deploy from GitHub, one step runs the same check on every push and recomputes the verdict hash on the runner: uses: ogasurfproject-jpg/mcp-conduct-action@main
    The verdict carries a record sha256 and a recompute URL, so you do not have to trust the gate. Our own servers sit on the same public register and can fail on it.
    Record of your row from the walk: https://observatory.horizonshield.dev/lookup?address=https://api.osf-master-server.com/mcp
    
    Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan

