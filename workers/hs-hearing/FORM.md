# ヒアリングフォーム（`/h/<token>`）

加盟店・事業所が1回だけ開く紙。ここに書かれた答えが、そのまま
生成されるページ（GEO / AEO / LLMO / WebMCP）の素材になる。

## 業種で言葉が変わる

`hearingForm(token, store)` は `store.industry` を見て `FORM_PACK` から言葉を選ぶ。
業種が無い店、知らない業種の店は建設に落ちる（後方互換）。

| | 建設 (`construction`) | 訪問看護 (`nursing`) |
|---|---|---|
| 必須の3つ目 | 対応できる工種 | 対応できる医療処置 |
| 許可番号 | 建設業許可番号 | 事業所番号(指定訪問看護事業所番号) |
| 相手の呼び方 | 施主 | ケアマネさん・ご家族 |
| 見積もり例 | あり（KIRA監査に使う） | **無し**（訪問看護に見積書は無い） |
| 名乗り | Yakumo | HORIZON SHIELD |

語彙の出どころは `industry.js` の `words` 層である。ここで新しい言葉を発明しない。
発明すると、答えを構造化する側（`llm_sys`）と設問の言葉がずれる。

見積もり例を出さないのは、`computeCompleteness` も同じ判断をしているからである
（`usesEstimates = !p.industry || p.industry === "construction"`）。
業種を見ずに10点を課すと、訪問看護は永久に完成度が上がらず、生成が始まらない。

## 1枚で完成度が上がるようにしてある

`GEN_MIN_COMPLETENESS`（既定60）に届くと、その場で `triggerGeneration()` が走る。
つまり**1回の送信で②専用窓口の生成まで行く**。

フォームが集めるもの:

- 基本（社名・所在地・工種/医療処置・エリア・強み・FAQ・信頼・連絡先）
- 目的（`focus`）と、選ばれた目的の設問3問
- 始めたきっかけ（`story`）と代表的な事例（`cases`）
- 可視性の設問5問（GEO / AEO / LLMO / WebMCP / measure）
- 業種の設問（訪問看護45問、建設6問）

うしろの3つは `payload.extra[qid]` として送られる。
`normalizeProfile` は**実在する qid だけ**を受け取り、知らない id は捨てる。
捨てないと、フォームに細工をした人が profile に任意のキーを書き込める。

### なぜ1枚にしたか

LINE の追撃は3日に2問である（`nextQuestions` の `ASK_MAX=3` / `ASK_COOL_MS=3日`）。
訪問看護の設問は45問、可視性が5問、目的別が3問。追撃だけでは67日かかる。
合同会社あっぷす様の運用開始は 2026-10-01 で、間に合わない。だから1枚にした。

## 業種を足すとき

1. `industry.js` の `INDUSTRIES` に `words` / `keywords` / `opening` / `llm_sys` を書く
2. 目的別の言葉が建設のままでよいか見る。違うなら `focus_labels` と `focus_overrides` を書く
3. `hearing.js` の `FORM_PACK` に、その業種の言葉を書く
4. `hearing_form_test.mjs` に「その業種の紙に、他の業種の言葉が0回」を足す

4 を飛ばさないこと。2026-08-25 まで、訪問看護の紙に建設の言葉が入っていることを
誰も測っていなかった。測っていない項目は、書いてあっても効かない。

## 検査

```
node workers/hs-hearing/hearing_form_test.mjs
```

235件。`deploy-hs-hearing.yml` の門に入っているので、通らなければ配られない。
