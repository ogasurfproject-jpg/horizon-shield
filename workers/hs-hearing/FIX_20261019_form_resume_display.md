# FIX 2026-10-19 ヒアリング用紙 再開時に回答済みと進捗を表示

## 症状(平田様/合同会社あっぷす、store kira-wbbk99p9)
- 「ヒアリングシートの回答が反映されていない」
- 「どこまでやったか分からなくなる」

実際には回答は取り込み済み(完成度 40→77、needs_human 解除、返事待ちなし。
カイポケ・指示書期限管理・採用条件・会社情報など本人フォーム回答が profile.extra に保存されていた)。

## 原因
hearingForm() が再開(GET /h/<token>)時に:
1. 詳細設問の入力欄を qField() で毎回「空」で生成していた
   (ibank=業種45問、可視性 q_ai_place、目的別=採用などの focus グループ、返事待ち pq)。
   上部の社名・エリア・工種・strengths 等だけは prefill されていたが、
   本人が答えた詳細回答は画面に一切出ていなかった。
2. それらの欄は、閉じた <details> と display:none の focus グループの中にあり、
   開き直しても存在自体が見えなかった。
→ 保存は成功しているのに「消えた」ように見え、進捗も分からない状態だった(表示の不具合)。

## 直し(hearing.js、11箇所)
- qField(qid, text, val): 保存値を textarea に prefill、ラベルに「回答済み」タグ。
- pf.extra から ansText(qid) を引く(attributed==="ambiguous" は除外=ノイズを出さない)。
- 返事待ち(pqbox)の textarea も prefill。
- 回答のある可視性/業種の <details> を自動 open。
- 回答のある focus グループを自動選択・表示(answeredFocus)。
- 上部に進捗バナー「✓ これまでに◯問お答えいただいています」(.resume)+ .done タグの CSS。

送信経路は不変: prefill された data-q textarea は従来どおり extra[id] として再送され、
settleByQid / RMW.hearing.merge_answer で冪等に合流する。

## 検証
- node run_all.mjs: 24/24 スイート緑(hearing_form_test の #9「既にもらった答えが最初から埋まっていること」含む)。
- commit c6101c94。deploy_hearing.sh で本番配備、Version 9ec4c3bc-6fc4-4d81-bd0d-917e9d9ac4f3。
- 本番 hearing.horizonshield.dev/h/<平田様token>: resume バナー1・回答済みタグ8・カイポケ反映・<details open> 2 を確認。
