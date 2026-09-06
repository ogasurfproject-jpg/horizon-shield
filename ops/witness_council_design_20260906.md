# 証人会(witness council)設計書 v0.1(2026-09-06、番人。決めるのは TOshi)

## 0. 一行

運営者 1 人では通らん物を 2 つ作る: 月の輪の一覧の錨打ちと、規則の版上げ。どちらも、独立した証人の副署が無いと台帳に載らん。証人の席は「この台帳に自分の名前で書いた記録」だけで決まり、金でも会員証でも買えん。DAO やない。token も無い。公開で、小さい。

## 1. なぜ

今日の調べ(ops/landscape_agent_trust_20260906.md)で、扉の弱点は 1 つに絞れた。記録は誰にも消せんが、「何を載せるか、規則をいつ変えるか」は運営者の一存や。ERC-8004 は登録簿を chain に置いて Sybil で沈み、Agenstry は運営者が握っとる。運営者の権限を、買えん形で外に分けた物は無い。ここを直すと、弱点がそのまま、真似できん物になる(真似するには独立した証人が要る)。

## 2. 原則(変えん)

1. 独立: 証人会の席は HORIZON SHIELD の中の人間には無い。運営者は 1 票を持つが、拒否権は無い。
2. 無償: 金も token も出さん。見返りは名前と、規則への票。払うた瞬間に条件 3 の「報酬の出所」に自分が引っかかる。
3. 資格は記録: 席に着けるのは、この台帳に自分の名前で witness 記録を出した者(walk 1 本以上)で、直近 3 か月に 1 本以上ある者。消えた証人は責めん、席が空くだけ。
4. 各側の物は各側に: 証人の鍵は証人が自分の domain(か repo)で公開する。台帳は署名を写すだけ。混ぜん。
5. 公開: 会員、鍵、副署、否決、全部が台帳と /spec と register README に出る。隠した統治は、扉が他人に禁じとる事そのもの。
6. 記録は先、文は後: 副署される物は bytes の sha256 で、文やない(Federico との "bytes first" のまま)。

## 3. 何を副署するか

### 3a. 月の輪の一覧(毎月 1 回)

今: 月初に `rings/<YYYY-MM>.sha256`(8 本の輪の sha256 一覧)を JIDEC entry として append(8 月分 = entry 32)。

これから: その一覧の sha256 を証人会の各員が自分の鍵で署名し、署名を添えて append する。entry の型は新規 `nenrin-ring-list-countersigned-v1`:

```
schema: nenrin-ring-list-countersigned-v1
month: 2026-09
ring_list_sha256: <64 hex>
ring_list_url: https://raw.githubusercontent.com/.../rings/2026-09.sha256
countersignatures:
  - by: "Baby Blue Viper (invinoveritas)"
    kid: <証人の kid>
    jwks: https://<証人の domain>/.well-known/jwks.json
    alg: ES256
    signed_at: <ISO>
    signature: <base64url(raw r||s) over "nenrin-ring-list-v1:" + month + ":" + ring_list_sha256>
operator_signature: { kid: hs-2026-09, jwks: https://gate.horizonshield.dev/.well-known/jwks.json, ... }
quorum: { required: 2, present: 3 }
```

規則: `countersignatures` が 2 名未満なら append せん(運営者だけでは通らん)。署名対象は文字列 `"nenrin-ring-list-v1:2026-09:<sha>"` の UTF-8。鍵は card 署名と同じ ES256(P-256)、JWKS の形も同じ。card 署名鍵をそのまま使える(Federico なら自分で作る)。

検証は誰でも: 一覧の bytes を取って sha256、各署名を各員の JWKS で verify。運営者を信じる所は無い。

### 3b. 規則の版上げ(不定期)

対象: 扉の判定規則(5 条件と判定の意味)、NENRIN の輪の形、conduct-v1 の仕様の版上げ(v1.1 等)。コードの bug fix や表示の直しは対象外(それは今までどおり、/spec に日付付きで書く)。

流れ: (1) 提案を公開の場に出す(GitHub の issue、本文に変更の bytes の sha256)。(2) 14 日の予告。(3) 証人会の 2 名以上が「読んだ、反対せん」を署名で返す(上と同じ形で、署名対象は `"nenrin-rule-change-v1:" + <提案の sha256>`)。(4) 台帳に `nenrin-rule-change-countersigned-v1` として append してから配備。反対があれば、反対の署名と理由も同じ entry に載せる(食い違いは消さん)。

これで、運営者が一存で「verified の意味」を変えることができんようになる。それが証人会の一番の仕事で、輪の副署はその練習や。

## 4. 役

| 役 | なる条件 | できること |
|---|---|---|
| 証人 | walk を 1 本出した(名前付き) | 輪の witnesses に載る |
| 宣言者 | 自分の card に conduct-v1 を宣言した | 登録簿の行が自分の card から辿れる |
| 運営者 | 自分の扉か台帳を立てた | JIDEC と互いに root を錨打ちする |
| 証人会 | 証人で、直近 3 か月に記録がある、自分の JWKS を公開しとる | 輪の一覧と規則の版上げに副署する。1 人 1 票 |

運営者(HORIZON SHIELD)は証人会の 1 票を持つが、3a と 3b の quorum(2)に運営者の票は数えん。

## 5. 立ち上げ

- 1 人目: Federico(witness 記録 2 本、ring 再実装、論文共著)。頼むのは論文 2 の v0.5 と ETHOnline の審査期間が明けてから。頼み方は「うちに入ってくれ」やなく「あなたの鍵で、あなたの側から副署してくれ」。彼の JWKS は彼の domain(babyblueviper.com か invinoveritas の repo)。
- 2 人目、3 人目の候補: Agenstry(毎週測っとる観測所、外部の錨が無い → JIDEC を錨に使える、互いに証人になれる)、1F916 Agent Record(SCITT 型の証人設計、同じ言葉で話せる)、trustless-ai の Merlini と Pavlo(審査明けに walk を 1 本ずつ)。
- 3 名揃うまでは 3a を「副署 0〜1 名でも append するが、entry に quorum 未達と書く」で回す。揃った月から quorum を効かせる。始めから閉じると、最初の月が来ん。

## 6. 台帳と扉に足す物(実装の量)

- hs-ledger: entry 型 2 つのスキーマ検証(`nenrin-ring-list-countersigned-v1`、`nenrin-rule-change-countersigned-v1`)、署名の verify(WebCrypto ES256、JWKS を jku から取る。扉 0.3.4 の verifyCardSignatures と同じ部品)、quorum 未達の拒否(append 側)。GET /council で会員と鍵と直近の副署を公開。
- 扉: /spec に `governance` 節(会員、quorum、直近の版上げ entry)。
- register README: 「Council」節、会員の名前と JWKS の URL。
- 証人側の道具: `a2a-conduct-walk countersign --month 2026-09 --key <pem>`(輪の一覧を取って sha を出して署名して JSON を吐く、提出は台帳の口 POST /council/countersign か GitHub の PR)。stdlib では ES256 署名ができんので `cryptography` か openssl の呼び出し。

番人の見立てで 2〜3 日の仕事。3 名揃う前に作っても回らんので、順番は「Federico の返事 → 実装」。

## 7. 消えた時、揉めた時

- 会員が消えた: 3 か月記録が無ければ席が空く。quorum に満たん月は「未達」と書いて append(記録を止めん)。
- 会員が反対した: 反対の署名と理由を同じ entry に載せて、配備は止める。多数決やない、quorum の副署が無ければ通らんだけ。
- 運営者が消えた: 登録簿は GitHub、輪と台帳は Bitcoin、扉のコードは公開、仕様は Apache-2.0。証人会の会員が自分の扉を立てれば続く(役「運営者」)。これが「インフラの条件 3」の中身。

## 8. conduct-v1.1 の受け口(身元の層との接続、後で)

NTT ドコモビジネスの属性レジストリや NEC の KYA が本番になった日のために、conduct-v1.1 の `params` に OPTIONAL の `identity` を足す案:

```
"identity": { "did": "did:web:...", "vc": "https://.../credential.json", "issuer": "..." }
```

扉は形だけ見て `detail.identity` に写す(判定不変、card 署名と同じ扱い)。向こうの登録が扉の `conduct_record` を指し、扉の行が向こうの VC を指す。v1 は entry 37 で錨打ち済みなので、v1.1 は同じ URI、新しい sha、10 節の規則どおり。3b の流れの最初の実例にできる(証人会の初仕事 = 仕様の版上げ)。

## 9. TOshi が決めること

1. quorum は 2 でええか(3 名の会で 2、5 名なら 3)。
2. 運営者の票を quorum に数えん、でええか(番人の線: 数えん。数えたら「運営者 + 1 人」で通ってしまう)。
3. 3b の対象に「登録簿からの行の削除」を入れるか(番人の線: 入れる。削除は一番濫用されやすい権限)。
4. Federico への頼みの時期(番人の線: 論文 2 v0.5 の後、hackathon 明け)。
