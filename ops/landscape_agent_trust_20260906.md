# AI エージェントの「信用」基盤、日本と世界の現在地(2026-09-06、番人の調べ)

調べ方: 5 本の並列調査(日本の大手と官、格付けと観測所、世界のプロトコル、HORIZON SHIELD の外部露出、AGNTCon と日本の開発者コミュニティ)。一次資料を取りに行った物は [V]、検索の断片だけの物は [S]。URL は末尾。会社名は The HORIZ音s株式会社。

## 0. 結論(5 行)

1. 日本で見つかった物は全部「身元・資格(誰が、誰の保証で)」か「適合(検査時点で仕様を満たすか)」の層。**他人が測った振る舞いを、時間方向に、外の証人も書き込める形で、改ざん不能に残す**物は 1 つも無かった。台帳の主張があるのは SoftBank の Agent Firewall 試作(2025-07)だけで、技術は未公開。
2. 世界で一番近いのは NTT やなく **Agenstry(アムステルダム)**。A2A agent を 100 点法で週 1 回以上再測定し、agent ごとの履歴と生 card と監査 JSON を公開し、日次で Merkle root を出しとる。ただし外部錨(chain)は未着手、外の証人の口は無い、MCP は生死だけで採点無し。
3. ChatGPT の分析には 3 つ誤りがある。KanseiLink は日本企業やなく **シンガポールの Synapse Arrows**(格付けされる SaaS 側が月 149 ドルで報告書を買う、根拠の個別公開無し、履歴無し)。a2a-router は **1 人の MVP**(2026-05、pledge は自己宣言、「Public Trust Ledger」は planned で 404、star 3)。「NTT DATA のトラスト×AI」という物は見つからず、レジストリ試作は **NTT ドコモビジネス**(旧 NTT Com)の 2026-05-12 発表で、VC で属性を検証する「身元」層。
4. **「証人 + 錨 + 振る舞い」の 3 つを同時に、現に動かしとる物は、今回の調べでは HORIZON SHIELD 以外に見つからんかった**(調査エージェントの結論、公開ページだけで確認)。近い物は 1F916 Agent Record(IETF 個人草案、SCITT 型、証人が署名するのは「登録簿の一貫性」であって振る舞いやない)、Cedulon(決済の領収書)、Asqav(運営者自身のログを OTS)。
5. 一方で **HORIZON SHIELD を独立した第三者が公に言及した例はゼロ**。全部が自分の投稿か、README の自動転載(Glama、mcpservers.org、mcp.so)か、台帳の中に名前がある協力者(Federico)。#2211 は 0 コメント、#1631 の返信にも反応無し、awesome-mcp-servers に無し。技術の位置は珍しい、世間の位置はまだ無い。次の勝負が「第三者採用」というのは、その意味で正しい。

## 1. 物差し(7 軸)

ID 身元(誰か、誰が保証するか)/ CONF 適合(検査時点で仕様を満たすか)/ **COND 振る舞い**(対象以外の者が測った結果、時間方向)/ **WIT 証人**(外の者の観測が記録に入るか)/ **ANCH 錨**(追記専用、時刻、chain)/ COMP 報酬開示(誰がその agent に払うか)/ PRE 接続前判定(client が記録を見てから繋ぐか)。HORIZON SHIELD は COND / WIT / ANCH / COMP を持ち、ID は弱い(endpoint 単位、DID 無し)、PRE は「意図」であって client 側の強制は無い。

## 2. 日本

| 主体 | 物 | 日付 | 中身 | 軸 |
|---|---|---|---|---|
| NTT ドコモビジネス | AIエージェント属性情報レジストリ(仮称)試作 [V] | 2026-05-12 | 事業者が AgentCard と属性(開発者、運用主体、所在国、データ流用方針、決済やデータアクセスの権限)を VC で登録、相手 agent が A2A 取引中に照会。技術検証、商用日無し、パートナー無し。振る舞いの記録は無し。 | ID |
| NTT ドコモグローバル + Accenture + AWS | AI 駆動開発のトラスト基盤 [V] | 2026-05-28 | UWI(デジタル ID とウォレット)の拡張。SBOM、VC、agent identity、AI 生成コードの来歴と監査。共同白書段階。 | ID |
| NTT データ | 複数システム横断で AI が自律実行する環境構築 [V] | 2026-06-24(7 月提供) | AI ゲートウェイ(認証認可、アクセス制御、監査ログ)。A2A や VC の記述無し。 | CONF、一次監査ログ |
| NTT データ | WitnessAI 再販 [V] | 2026-04-14 | 自社 agent の入出力を自社で監視。名前に witness とあるが第三者証人やない。 | 一次 COND |
| NEC + みずほ | KYA(Know Your Agent)認証基盤 PoC [V] | 2026-05-28 | DID/VC で agent の真正性、顔認証で人と紐付け、委任範囲、事後追跡の証跡。A2A や MCP には触れず。 | ID、一次監査 |
| SoftBank | Agent Firewall(仮称)試作 [V] | 2025-07-24 | agent 間ゲートウェイ。認証認可、契約とポリシー、DLP、「通信内容を改ざん困難な台帳に記録」。A2A と ACP 対応、特許出願、2026 年度実用化目標。台帳の技術は未公開、2026 年の続報は見つからず。 | CONF、ANCH(主張のみ) |
| Campus Create + VESS Labs | VC で agent の権限を証明する PoC [V] | 2026-05-08 | 何を、どの範囲で、いつまで、を VC で発行、Claude と MCP で接続、人の承認を挟む。 | ID、CONF |
| 日立 | AI 品質維持サイクル [V] | 2026-09-03 | 実行前に業務手順と照合、運用ログで委任範囲を更新。運営者側の測定。 | CONF、一次 COND |
| 富士通 | Kozuchi Multi AI Agent Framework [V] | 2026-07-13 | 自己進化型、変更履歴を監査可能に、人の承認。企業間の信用は対象外。 | CONF |
| NEC | AI ガバナンスサービス 3 種 [V] | 2025-12-02 | リスク評価、Cisco AI Defense、監視。500 万円から。 | CONF |
| 官: 総務省 経産省 | AI 事業者ガイドライン 1.2 版 [V] | 2026-03-31 | AI エージェントを定義、ログ保存とトレーサビリティを求める。身元やレジストリの仕組みは規定せず、MCP/A2A に言及無し。 | 方針 |
| 官: デジタル庁 | DS-920 生成 AI 調達 利活用ガイドライン [V] | 2026-06-12 | 入出力とアクセス履歴のログ、高度な自律 agent の作成制限か事前届出。 | 方針 |
| 官: AISI | AI セーフティ評価観点ガイド 1.20 版 [V] | 2026-07-07 | 「観測と制御」の観点を追加、自律的挙動と外部環境との相互作用。評価の観点であって仕組みやない。 | CONF |

KDDI、Sony、LayerX、PFN: agent の身元・監査・MCP 検証に当たる発表は検索で見つからず(無いことの証明にはならん)。

**KanseiLink** [V]: 運営 Synapse Arrows Pte. Ltd.(シンガポール、Robinson Road)、著者名義 Michie Yamaguchi。日本 SaaS の Agent Readiness Index、5 領域のうち 4 つが「開発中」。2026 年夏の Award: 200 社中 194 社を格付け、41 社が A 以上(AAA 11、AA 21、A 9)、2026-07-16 凍結、訂正 2 件。公式 MCP の有無を見る、JSON-RPC の handshake で 2,257 サービスを自前 scanner で叩いた(成功 3,475 / 試行 4,367)と書く一方で、自分の報告書に「スコアは接続方式と内部 seed データから導いた heuristic で、実運用の性能の測定や主張やない」「seed / auto-eval データを含む可能性」と注記。個別サービスの根拠(生応答、hash、日付)の公開無し、前回版無し(初回)、第三者の観測の口無し(メールで訂正受付)。料金: 格付けされる SaaS 側が Rating Report 月 149 ドル、Enterprise 2,990 ドル以上、調達側は Custom Assessment 2,990 ドル以上。「報告書の購入は格付けに影響せん」「スコアは売らん」と独立性を宣言。分類: RATING(自前 probe を含むが集計のみ公開)。COND 時間方向、WIT、ANCH は無し。

**MCP サーバー比較カオスマップ**(マーケティングプランナー社、2026-07-29)[V]: 114 サービスを提供者種別と認証方式で分類、「安全とも危険とも断定せず」、測定無し。LISTING。

## 3. 世界

**Agenstry**(Accessible AI、アムステルダム、KvK 登録)[V]: A2A agent 6,278 件(生存応答 720)、MCP server 157,182 件(生存 7,570)、30 分毎更新、6 時間の発見周期と 15 分 / 1 時間 / 24 時間の段階再クロール。A2A は公開の 9 基準 100 点(有効な AgentCard 10、生きた JSON-RPC 25、protocol version 10、JWS 署名 10、30 日 uptime 15、skills 10、GLEIF / Companies House / KvK による身元 10、鮮度 5、セキュリティ宣言 5)、35 点が card 由来、65 点が観測由来、週 1 回以上再測定、30 日で減衰、A から F。agent ごとのページに最終試行時刻と HTTP 状態、30 日の probe 回数、card の drift 履歴、生 card JSON、Audit JSON、異議ボタン。日次で 5 つの追記専用テーブルの SHA-256 Merkle root(RFC 6962 型)を公開、外部錨は未着手(onchain_anchor 列は NULL、「次は Base に setRoot」)。MCP は tools/list の生死のみ、採点無し。第三者の観測の口は無し(異議は domain 所有者だけ)。料金は watcher と hosting と企業向け(月 0 / 9 / 29 / 99 ユーロ)、「placement は売らん、順位は機械的」。分類: RATING + CONF + **COND(A2A、時間方向)** + ANCH(内部 Merkle、外部無し)。WIT 無し。**規模と身元検証で扉を大きく上回り、証人と外部錨と無採点で扉が上回る。** 世界でいちばん近い相手はここ。

**a2a-router**(GitHub shufflethis、RFC 著者 Gorden Wuebbe、ブラジル)[V]: repo 作成 2026-05-16、最終 push 05-22、star 3。MCP と A2A の橋。Trust-Pledge は 5 つの約束を agent 所有者が自分の Ed25519 鍵で署名した JSON、did:web と JWKS で鍵公開、本番の pledge は tier "self_attested"、auditor null。RFC-001 は Tier 0 自己宣言、Tier 1 コミュニティ(3 件の通報で調査)、Tier 2 第三者監査(125 プロンプト、200〜2,000 ドル)、0〜100 点、「Public Trust Ledger(CT 型の追記ログ)」を定義するが、site は planned、/trust-ledger は 404。測定は無し、証人の口は無し、錨は無し。ChatGPT の「かなり思想が近い」は構想の文書に対する評価で、動いとる物は橋だけ。

**ERC-8004 Trustless Agents** [V]: 2025-08-13 起草、Draft のまま、mainnet と 30 chain 超に配備、2026-03-17 に "Launch Day"。Identity は ERC-721、Reputation は agent 所有者以外の任意のウォレットが書く feedback(値、tag)。実証研究(Xiong ら、2026-07-08): 3 chain で約 17.3 万登録、動くサービスを露出しとるのは 3〜15%、評価者の 59〜91% に共謀 Sybil の兆候、「値は比較不能で、feedback は検証可能な相互作用に根差しとらん、信用信号として機能せん」。ANCH は on-chain、COND と WIT は「相手方の feedback」であって独立測定やない。

**A2A 本家** [V]: 1.0 §8.4 の card 署名は agent 自身の JWS = 完全性であって信用やない。公式拡張は experimental-ext-oid4vp-auth と experimental-cpb-slimrpc だけ、conduct / reputation の公式拡張は 2026-09-06 時点で無し。#1631(2026-03-14〜)、#1628(trust.signals[])、#1677(OATR 実行時 attestation)、#1720(AgentGraph)は全部 maintainer 返信無し。#2211 は Open、Feature ラベル、0 コメント。

**IETF draft-tonyai-a2a-trust**(Tony Trujillo、個人提出、-03 は 2026-09-04)[V]: X.509 の agent 証明書、親子の生成連鎖、テンプレート登録簿、hash 連鎖の監査ログ。「agent の振る舞い」は明示的に対象外。

**身元と決済の層**(全部 ID か PRE、COND / WIT 無し)[V]: MIT NANDA(AgentFacts、"behavioral records" と書くが仕組み無し)、Agent Network Protocol(did:wba)、OWASP ANS 1.0(2025-05)と Linux Foundation の ANS 立ち上げ意向(2026-06-23、Cloudflare / GoDaddy / Salesforce / Cisco)、Cloudflare Web Bot Auth(RFC 9421、IETF webbotauth WG)、Microsoft Entra Agent ID、Okta Cross App Access、Visa Trusted Agent Protocol(2025-10)、Mastercard Agent Pay、Google AP2(mandate を VC で、agent 身元は無し)、KYA(Sumsub 等ベンダー用語)、OpenAI は Web Bot Auth の鍵を公開、Anthropic は UA 名と IP 一覧のみ。

**Sigstore-a2a** [V]: Fulcio の keyless 署名で card を署名し Rekor に記録、SLSA 来歴。prototype、監査無し。扉の card 署名(自分の鍵、JWKS)と補完関係: 「誰が発行した card か」を公開ログで示す層。

**「証人 + 錨 + 振る舞い」の近い物** [V]: 1F916 Agent Record(draft-maintainer-1f916-agent-record-01、2026-08-12): agent ごとの hash 連鎖ログ、RFC 6962 の checkpoint を「独立した証人が副署」、SCITT 型、chain 無し、証人が証明するのは登録簿の一貫性で振る舞いやない、1f916.ai に 600 超の agent と主張。Cedulon(draft-dogru-cedulon-08、2026-09-02): 支出の領収書を hash 連鎖、SCITT の証人は任意、決済専用、manifest で条件開示(COMP あり)。Asqav(2026-07-06): 運営者側の改ざん検知ログを OpenTimestamps か RFC 3161 で、外の観測やない。Brömme "A Black Box for Agentic Processes"(arXiv 2609.04017、2026-09-03): 立場論文、試作無し。

## 4. 一覧と scanner(誰も per-server の第三者記録を公開しとらん)[V]

Glama: 採点式を公開(tool 定義の質 70% + 一貫性 30%、A〜F)、時点の snapshot、履歴無し、第三者報告無し、Advertise あり。Smithery: 採点の文書無し。PulseMCP: 取得不可(robots)、分類と推定 DL。mcp.so / MCP Market: 一覧、Advertise、Featured の基準非公開。Cline: GitHub issue で人の審査、継続監視無し。公式 MCP registry: namespace 所有の検証だけ、health も点数も履歴も無し。Docker MCP Catalog: 自前 build と署名、SBOM、継続記録の公開無し。Anthropic directory: 「初回と継続の審査」、結果は非公開。Snyk(Invariant mcp-scan)、Cisco mcp-scanner、Palo Alto Prisma AIRS、Salt MCP Finder: 一回限りか企業内、公開記録無し。

## 5. 場と空気

AGNTCon + MCPCon Japan 2026 [V]: 9/10〜11、ベルサール渋谷ガーデン、AAIF(Linux Foundation)。登録は 9/11 23:59 JST まで、6 万円(学術 1.6 万円)。基調: Allan Teng(Workato)、David Soria Parra(Anthropic、MCP 共同開発者)、Kaz Sato(Google)、Lin Sun(Solo.io)、田畑義之(日立)。信用に近い session: 飯島龍二(SoftBank)「agent 間 trust boundary の設計、PoC の教訓」、日立「open agentic stack に欠けとる物」、PagerDuty「agent の評価 pipeline」、Workato「access control から execution control へ」、Obot「MCP の allowlist と承認と監査ログ」。CFP は 6/12 締切済み、lightning talk や open mic の記述無し(sched は取得不可)。NTT は参加企業の列挙だけで登壇名無し。AAIF: 2025-12-09 設立、Platinum 8 / Gold 47 / Silver 200 超、日本は日立(Gold)と SoftBank(Silver)。Identity & Trust WG の範囲は「可搬な身元と動的な信用、委任、ドメイン横断」、成果物は未公開、aaif.io に reputation / conduct / witness の語は無し。

日本語コミュニティ(2026 年の実質的な投稿 12 本、Zenn / Qiita / CloudNative / Speaker Deck)[V]: agent の security、A2A 1.0 の card 署名(kai_kou)、MCP の脆弱性と点検表(CData)、監査台帳の雛形と permission engineering(山本)、MCP server の信頼性判断の枠組み(斎藤、scanner と CSA の DB を挙げる)、Authlete の agent identity、Nowcast の MCPass、AWS Agent Registry の Shadow Agent Hunter。**第三者が測った MCP server や agent の公開記録を書いた投稿は 1 本も無い。** connpass の候補: Agentic Tokyo #2(9/9)、AI Agent Journey 第 3 回(10/19)、MCP Ops LT 大会と OpenID TechNight は過去に LT 枠あり。

## 6. HORIZON SHIELD の外から見た姿(2026-09-06)[V]

生きた面: 扉 0.3.4、red team 82/82、register 9 行(6 verified、2 pending、TWZRD は測定 0)、台帳 37 entry 全部 confirmed(block 959118〜965717)、**entry 37(仕様 v1 の錨)は block 965717 で確定済み**、/ext/conduct/v1 の sha は 3aa5a50d(#1631 の 09-06 の書き込みと一致)。

露出: 公式 MCP registry に 7 サーバー 30 版(自分)、Glama は A(自動、README 転載)、mcpservers.org と mcp.so は自分の提出、Smithery 無し、PulseMCP 無し、awesome-mcp-servers 無し、Anthropic connectors の一覧に未掲載(09-05 に approved、アイコン待ち)。#2211 は 0 コメント。#1631 の 2 本の書き込みに返信も反応も無し(スレッドは 16 名参加、最終の他者コメントは 08-30)。Federico の公開 repo(invinoveritas、invinoveritas-mcp)と Substack に HORIZON SHIELD / NENRIN / JIDEC の記述無し、彼の名は台帳 entry 20 / 25 の中だけ。grep.app で horizonshield.dev の外部参照 0。X / LinkedIn / note / Zenn / Qiita の他者投稿 0。**独立した第三者の公の言及: 0。**

## 7. だから何か(番人の線)

技術の位置: 「他人が測った振る舞いを、外の証人も書き込める形で、Bitcoin に錨打ちして、点数を付けずに、報酬の出所まで開示する」の組み合わせは、日本には無く、世界でも現に動いとる物は見つからん。部品は全部既存(仕様 9 節に書いたとおり)。ここは変えん。

相手の位置: 競合は NTT やない。NTT / NEC / SoftBank は身元と門(gateway)の層で、扉と食い合わん。**補完**や(§8)。現物で近いのは Agenstry で、向こうは規模と身元検証、こっちは証人と外部錨と無採点。ぶつけるより、Agenstry を証人 1 主体として口説くのが早い(彼らは毎週測っとる、その観測を witness intake に流すだけで「外部証人」になる。向こうも外部錨が未着手で、JIDEC を錨に使える)。

弱点: 第三者採用がゼロ。#2211 は sponsor が要る。AGNTCon は CFP 締切済み、登壇は無理でも、飯島(SoftBank、trust boundary PoC)、日立(AAIF Ambassador)、David Soria Parra(MCP)に「扉の /check を 1 回叩いてもらう」だけで足りる。持って行く物は 1 枚: 「あなたの agent card を扉に入れると、10 秒で、あなたが書いとらん記録が 1 行できる」。

順番: (1) 扉 0.3.5(今夜の掃引で derived を履歴に)。(2) witness を「AI が 1 回呼べば提出まで済む」MCP tool と skill に(他人の AI を証人にする)。(3) 証人候補の口説き: Agenstry、1F916(SCITT 型の証人設計、相互に証人になれる)、Sigstore-a2a(card 署名の Rekor 記録と補完)、Federico に続く 2 人目。(4) 身元層の受け口: conduct-v1.1 の params に OPTIONAL の `identity`(VC か DID の pointer)を足す案。NTT ドコモビジネスのレジストリや KYA が本番になったら、扉の行がその VC を指し、向こうの登録が扉の記録を指す。v1 は錨打ち済みなので v1.1(同じ URI、新 sha)で。

## 8. TOshi の 4 つの案への番人の答え

**追跡エージェント(GPS)と磁石**: 「LLM を追跡する」はできん(LLM の側に足跡は残らん、こっちが置けるのは道標だけ)。今できとる磁石は 3 つ: 判定に埋めた sha と recompute の文(hs-mcp の verify_integrity_claim と recompute 欄)、card の conduct 拡張(全応答に conduct_record と witness_intake の pointer が乗る)、llms.txt と AEO。足りん 1 つが「証人になる道具」= LLM が扉を見た**ついでに** witness を出せる 1 呼び出し。追跡やなく、通った跡を本人に残させる設計。それが GPS の正しい形。

**嘘を見抜く技術**: 作らん。扉の設計は「宣言の真偽は誰にも分からん、形の不備と、宣言と実測の食い違いと、証人同士の食い違いだけを記録する」で、それは仕様 5 節に書いてある。作れると言うた瞬間に、自分が採点機になる。今の武器は「食い違いを永久に残す」で、それは嘘発見器より強い(嘘つきは食い違いを消せん)。

**トルネード MCP**: repo に tornado / トルネードの名の物が無い(survey データの中の他社サーバー名だけ)。KIRA(hs-mcp)のことか、別の物か、名前を言うてくれたら見る。

**NTT 等の取り込み**: 可能で、取り込むんやなく**繋ぐ**。向こうは「誰か」、こっちは「どう振る舞ったか」。§7 の (4)。相手の本番化を待つ間に、受け口(OPTIONAL の identity pointer)だけ設計しとく。

## Sources

日本: https://www.ntt.com/about-us/press-releases/news/article/2026/0512.html / https://www.nttdata.com/global/ja/news/topics/2026/062400/ / https://www.docomoglobalgr.com/pdf/nttdocomoglobal_accenture_aws_20260528_j.pdf / https://www.nttdata.com/global/ja/news/topics/2026/041400/ / https://jpn.nec.com/press/202605/20260528_02.html / https://www.softbank.jp/corp/news/press/sbkk/2025/20250724_01/ / https://prtimes.jp/main/html/rd/p/000000406.000031052.html / https://prtimes.jp/main/html/rd/p/000000074.000152541.html / https://global.fujitsu/ja-jp/technology/research/article/topics/202607-multi-aI-agent-framework / https://jpn.nec.com/press/202512/20251202_02.html / https://www.meti.go.jp/shingikai/mono_info_service/ai_shakai_jisso/pdf/20260331_1.pdf / https://www.digital.go.jp/assets/contents/node/information/field_ref_resources/decb64eb-f26e-41cb-8d37-f3dd173108b8/59054b35/20260612_resources_standard_guidelines_guideline_01.pdf / https://aisi.go.jp/output/output_information/260707/ / https://prtimes.jp/main/html/rd/p/000000003.000186517.html

格付けと観測所: https://kansei-link.com/en/ / https://kansei-link.com/en/ari-award/2026-summer.html / https://kansei-link.com/en/pricing.html / https://kansei-link.com/en/independence.html / https://synapsearrows.com/en/products/ / https://agenstry.com/methodology / https://agenstry.com/transparency / https://agenstry.com/pulse / https://agenstry.com/pricing / https://agenstry.com/imprint / https://agenstry.com/agents/kone.vc / https://glama.ai/mcp/servers/@sooperset/mcp-atlassian/score / https://github.com/modelcontextprotocol/registry / https://github.com/cline/mcp-marketplace / https://docs.docker.com/ai/mcp-catalog-and-toolkit/catalog/ / https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy / https://github.com/invariantlabs-ai/mcp-scan / https://github.com/cisco-ai-defense/mcp-scanner / https://salt.security/press-releases/salt-security-launches-salt-mcp-finder-technology-the-discovery-engine-for-mcp-servers-in-agentic-ai-deployments

世界: https://github.com/shufflethis/a2a-router / https://github.com/shufflethis/a2a-router/blob/main/docs/rfc/RFC-001-trust-pledge.md / https://www.a2a-router.com/.well-known/trust-pledge.json / https://eips.ethereum.org/EIPS/eip-8004 / https://arxiv.org/html/2606.26028 / https://datatracker.ietf.org/doc/draft-tonyai-a2a-trust/ / https://a2a-protocol.org/latest/topics/extensions/ / https://github.com/orgs/a2aproject/repositories / https://github.com/a2aproject/A2A/discussions/1631 / https://github.com/a2aproject/A2A/issues/2211 / https://projectnanda.org/ / https://genai.owasp.org/resource/agent-name-service-ans-for-secure-al-agent-discovery-v1-0/ / https://www.linuxfoundation.org/press/linux-foundation-announces-intent-to-launch-agent-name-service-to-establish-trusted-identity-infrastructure-for-ai-agents / https://blog.cloudflare.com/verified-bots-with-cryptography/ / https://learn.microsoft.com/en-us/entra/agent-id/what-is-microsoft-entra-agent-id / https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.21716.html / https://ap2-protocol.org/ / https://github.com/sigstore/sigstore-a2a / https://datatracker.ietf.org/doc/draft-maintainer-1f916-agent-record/ / https://datatracker.ietf.org/doc/html/draft-dogru-cedulon-08 / https://www.asqav.com/blog/posts/tamper-evident-logs-for-ai-agents / https://arxiv.org/abs/2609.04017

場と露出: https://events.linuxfoundation.org/agntcon-mcpcon-japan/ / https://www.prnewswire.com/news-releases/agntcon--mcpcon-japan-to-convene-builders-advancing-production-ready-agentic-ai-302858755.html / https://sessionize.com/mcp-dev-summit-tokyo-2026/ / https://aaif.io/ / https://aaif.io/members / https://github.com/aaif / https://blog.cloudnative.co.jp/articles/mcp-server-security-evaluation-2026/ / https://qiita.com/kai_kou/items/dc0b6b7fc66789b2e498 / https://registry.modelcontextprotocol.io/v0/servers?search=ogasurfproject / https://glama.ai/mcp/servers/ogasurfproject-jpg/horizon-shield / https://mcpservers.org/servers/ogasurfproject-jpg/horizon-shield / https://raw.githubusercontent.com/punkpeye/awesome-mcp-servers/main/README.md / https://github.com/babyblueviper1/invinoveritas / https://gate.horizonshield.dev/spec / https://gate.horizonshield.dev/register / https://ledger.horizonshield.dev/ledger / https://gate.horizonshield.dev/ext/conduct/v1
