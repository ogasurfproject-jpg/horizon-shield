# MUSUBI（結）/ a2a-contract-v0 — 設計ノート v0.2

番人 2026-09-24。三本目の柱の芯。**新規建設やのうて、既にある部品の統合と命名。**

NENRIN =「何をしたか」を証明する。
TSUGI =「壊れた後どう戻したか」を証明する。
**MUSUBI =「何を約束したか」を固定し、約束と実際のズレを証明し、逸脱に市場のコストを付ける。**

---

## 0. 掟（一番大事。これを外すと嘘になる）

MUSUBI は「実行を止める装置」やない。**「約束と行為のズレを否定できなくし、逸脱を高くつかせる装置」**や。
HS が相手エージェントの実行経路を握っとらん限り、第三者の行為そのものは止められん。だから MUSUBI が
やるのは：(a) 署名 Grant で許可/禁止/条件を**定義**、(b) 相手に**受諾署名**させる、(c) NENRIN で実際の
行為を記録し、(d) Settlement で Grant と突き合わせて**逸脱を決定論的に証明**、(e) 逸脱を評判と bond に
**価格付け**する。= enforce-by-runtime やのうて **prove-and-price**。NENRIN の思想と完全一致。
真の事前ブロックが効くのは「HS が gateway も運営する経路」だけ。そこは正直に分ける。

---

## 1. 歯（teeth）── 「止められんなら無力やろ」への答え

prove-not-enforce は無力やない。runtime を握らずに逸脱を高くつかせる経路が3つある。

1. **永続・公開の逸脱記録。** 逸脱は NENRIN に content-addressed で残り、Bitcoin に錨打ちされる。消せん、否認できん。
2. **選定での罰。** 逸脱は contractor の conduct / NENRIN Resume に載る。次の**多次元選定（第4層）で自動的に除外/下位化**される。約束を破ったエージェントは、次の仕事が来なくなる。市場が罰する。
3. **bond の没収（任意）。** contractor は契約時に bond（RDA / settlement-admissibility 段）を積める。**逸脱が決定論的に証明されたら没収**、principal または保険プールへ。HS が runtime を握らんでも、逸脱に即時の金銭コストが付く。

つまり「守らせる」んやのうて「破ったら損をする」。ERC-8004 系の reputation/stake と同じ力学を、HS の証拠層の上で回す。
runtime ブロックは gateway 経路だけ。それ以外は評判 + bond が歯や。

---

## 2. 土台（既にある物。ゼロから作らん）

- **agreement-v1.1**：双方署名・鍵をバイトに内包・オフライン検証器・overclaim/dne 検査・redteam 185 vector。MUSUBI = これ + Grant + Task binding + Settlement。**今日の2件目の合意が実物のタネ。**
- **task-delegation-bind-v0 / `/witness/task`**：`a2a.task.id` への結線。既にある。
- **NENRIN**（証拠）・**TSUGI**（回復）・**RDA / issuer.mjs**（bond/settlement、作りかけ）。
- A2A の Extension レール（Agent Card で宣言、`A2A-Extensions` で有効化）に載せる = A2A を壊さず試作可。

---

## 3. 記録：a2a-contract-v0（schema）

```
schema           : "a2a-contract-v0"
contract_id      : 32 hex（両者が選ぶ）
nonce            : 32 hex（リプレイ防止。署名バイトに含める）
agreed_at        : ISO8601
expiry           : ISO8601（過ぎたら Grant は無効）
lower_bound      : {kind:"bitcoin_block", height, hash}
parent_contract  : null | {contract_id, settlement_url}   # 委任なら親を指す（第6節）
parties:
  - role: "principal"    # 依頼側 Agent A
    domain, key_url, public_key_ed25519_b64, agent_card, agent_card_sha256
  - role: "contractor"   # 実行側 Agent B
    domain, key_url, public_key_ed25519_b64, agent_card, agent_card_sha256
task:
  purpose          : 文字列（例 "estimate_audit"）
  payload_digest   : sha256（依頼メッセージそのものへの binding = exact-message envelope）
  a2a_task_id      : 実行時に埋める（task-bind と一致）
grant:
  authorized_actions  : []   # 例 ["read_pdf","query_kira","compute_souba","emit_nenrin"]
  prohibited_actions  : []   # 例 ["payment","delete","external_transfer","redelegate","send_pii"]
  conditional         : []   # 例 [{action:"spend", threshold_jpy:100000, requires:"human_approval"}]
  delegation          : "none" | {allowed:[domain...], requires:"signed_authorization"}
  data_access         : []   # 例 ["estimate.pdf"]
  max_hops            : int
  privacy             : "no_external_retention" 等
bond:                        # 任意。歯の (3)
  amount               : {currency, value} | null
  custodian            : domain            # 誰が預かるか（HS 以外も可）
  forfeit_to           : "principal" | "pool"
  admissibility_ref    : sha256            # RDA settlement-admissibility 段の記録
liability_boundary:          # 当事者が「述べた」境界。HS の判定やない
  - "contractor: analysis output only"
  - "principal: final transaction decision"
requirements:
  evidence : "nenrin_required"
  recovery : "tsugi_required"
selection_provenance:        # 多次元選定をやった時だけ
  params_used   : []         # 例 ["price","confidence","latency","region","recovery","track_record"]
  candidate_set : sha256     # 候補集合のハッシュ（誰を検討したか固定）
  chosen_under  : {}         # 満たした条件
establishes        : [...]
does_not_establish : [...]   # 第9節の行を必ず含む
signatures         : [{domain, alg:"ed25519", signature}, ...]  # principal と contractor
```

### 署名の規律（agreement-v1.1 と同じ、明示）

- context prefix `"a2a-contract-v0\n"` を signing_bytes に前置（他署名へのリプレイ不可）。
- 鍵は記録の中（`public_key_ed25519_b64`）。**オフラインで永久に検証できる**（key_url が来年何を配ろうと）。
- signing_bytes は `contract_id + nonce + payload_digest + expiry + grant` を必ず縛る = **同じ署名を別タスクに使い回せない**。
- 署名者は自分の pinned 鍵と一致せんと署名を拒否（agreement_sign.py と同型）。

---

## 4. 実行を契約に縛る（v0 で抜けとった穴）

実行の NENRIN 記録に **`contract_ref: {contract_id, payload_digest}` を必須**化する。
これが無いと「この walk / この行為は、この契約の下でやった物や」を settlement が証明できん。
payload_digest 一致で、汎用の観測やのうて**この依頼への応答**である事を縛る。

---

## 5. Settlement：HS が下す判定やのうて、誰でも再計算できる決定論的関数

```
schema       : "a2a-settlement-v0"
contract_id  : <契約>
a2a_task_id  : <実行>
nenrin_refs  : [contract_ref を持つ conduct/walk record sha...]
tsugi_refs   : [recovery record sha...]
verdict      : "within_grant" | "deviation"      # 計算結果であって宣告やない
deviations   : [{clause, observed, evidence_sha}] # prohibited/conditional/delegation 違反
bond_outcome : "held" | "forfeited" | "n/a"
establishes / does_not_establish
signatures   : [...]   # 任意で principal + contractor が「事実に同意」を共署名
```

- **verdict は関数 `settle(contract, evidence) -> verdict` の出力。** 誰でも同じ入力で再計算して同じ結果を得る。
  HS は settlement 記録を**錨打ちするだけ**、verdict を**宣告せん**。これで「HS は判定せん」の掟を settlement でも守る。
- 当事者が verdict に同意すれば共署名（争いなし）。同意せんでも、入力（契約 + NENRIN）は全部錨打ち済みやから、
  **第三者が再計算して決着できる**。

---

## 6. 委任と責任の鎖（厳密化）

再委任は**子契約**を作る。子は `parent_contract` で親を指し、principal は「親の contractor」。
**掟：子の grant ⊆ 親の grant（部分集合のみ、権限拡大は不可）。** verifier がこれを機械的に検査。
これで委任で権限が漏れ広がる事故を設計で潰し、責任の鎖：

```
契約 -> 認可 -> 委任(子契約, grant⊆親) -> 実行 -> 結果 -> 証拠(NENRIN) -> 回復(TSUGI)
```

を丸ごと再計算可能にする。HS は事実だけ出す、判定は出さん。

---

## 7. 鎖（全体像）

```
MUSUBI 契約（両者署名, bond 任意）
   -> A2A Task ID（task-bind）
   -> 実行
   -> NENRIN（contract_ref 付き = 何をした）
   -> Outcome
   -> TSUGI（失敗なら回復）
   -> Settlement（settle() を誰でも再計算 -> within_grant / deviation, bond held/forfeited）
```

---

## 8. 脅威モデル（agreement_redteam.py の流儀。攻撃と防御）

| 攻撃 | 防御 |
|---|---|
| grant を偽造して権限を盛る | 両者署名 + 鍵内包。principal が署名した grant しか有効やない |
| 委任で権限を拡大 | 子 grant ⊆ 親 grant を verifier が機械検査、拡大は refuse |
| 契約を別タスクに使い回す（replay） | signing_bytes が contract_id+nonce+payload_digest+expiry を縛る |
| settlement を後付け・改竄 | settlement は決定論関数の出力。誰でも入力から再計算、錨打ちで時刻固定 |
| 逸脱を within_grant と偽る | verdict は HS の宣告やなく関数。偽れば再計算で即バレる |
| HS が verdict を宣告してしまう（思想崩壊） | 設計上 HS は錨打ちのみ。verdict は関数、宣告する口を持たせない |
| 実行と証拠の紐を切る（別の walk を貼る） | NENRIN に contract_ref{contract_id,payload_digest} 必須、一致検査 |
| bond を積んだフリ | bond.admissibility_ref を RDA 段で検算、無ければ bond:"n/a" |

---

## 9. does_not_establish に必ず入れる行

- that HS enforced any of this at runtime
- that the contractor actually obeyed the grant, only that its recorded acts match or deviate from it
- that HS judges liability or fault; it anchors the facts by which others may judge, and the verdict is a function anyone recomputes, not a decree
- that a prohibited action was impossible, only that performing one is provable as a deviation and priced by reputation and bond
- that this is a legal contract or determines legal responsibility; that depends on jurisdiction and the real agreement between the parties

---

## 10. A2A 相互運用（サイロにせん）

MUSUBI のフィールドは、今 A2A で議論中の **exact-message authorization envelope**（caller, recipient,
purpose, payload digest, expiry, nonce を具体的 Message に binding する提案）に対応させてある：

| A2A envelope | MUSUBI |
|---|---|
| caller / recipient | parties[principal] / parties[contractor] |
| purpose | task.purpose |
| payload digest | task.payload_digest |
| expiry / nonce | expiry / nonce |

= HS 独自拡張として試作しつつ、**A2A 本体への貢献候補**として出せる。Agent Card で宣言し `A2A-Extensions` で有効化、
仕様は `/ext/contract/v1`（or `musubi/v1`）で配る。A2A を壊さん。

---

## 11. 最初の一本（プラットフォーム建設やない、Federico と1回）

1. `a2a-contract-v0` を agreement-v1.1 の拡張として実装（schema + builder + verifier + settle()。
   既存の agreement_sign.py / agreement_verify.py を土台に、Grant・委任 ⊆ 検査・Settlement 関数・脅威 vector を足す）。
2. **Federico と実契約を1回**：範囲を絞ったタスク（例「api.babyblueviper.com を、read/observe 許可・payment/delete/redelegate 禁止で歩け」）
   を両者署名 → 実行 → NENRIN（contract_ref 付き）→ settle() で照合 → 錨打ち。bond は最初は null で可。
3. 拡張仕様を扉で公開（`/ext/contract/v1`）。
4. **それから宣伝**：「これは生きた A2A 契約や。settle() を自分で再計算して within_grant を確かめろ」。vapor やのうて動く1本。

---

## 12. 次の実装ステップ（この設計に合意したら）

1. `agreement_verify.py` / `agreement_sign.py` を読み、`a2a-contract-v0` の canonical・signing_bytes を同じ規律で定義。
2. builder（契約を組む）+ verifier（両署名 + grant 整合 + 委任 ⊆ + overclaim/dne + 脅威 vector）。
3. `settle()`（決定論。契約 + NENRIN refs -> verdict、誰でも再計算）+ settlement builder/verifier。
4. Federico 1本 → 錨打ち → 拡張仕様公開 → 宣伝。
