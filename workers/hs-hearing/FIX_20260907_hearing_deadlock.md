# ヒアリング自動化の膠着 修理記録 2026-09-07

番人が設計・実装・検査まで。deploy は TOshi の手。

## 何が起きていたか(本番データで確定)

hs-partner-001(堤さま) 2026-09-07 時点
- pending.qids = q_cases / q_fr_target / q_estimates、waves は 8/21 と 8/25 の二つ
- pending.sent_at = 2026-09-03T22:53:49Z (= 堤さまが答えた時刻に巻き戻っていた)
- 巡回は 9/4・9/5・9/6 と走って一通も出ていない。completeness 67 (85未満)

hs-partner-002(たかし) 同日
- pending 6問、last_send 2026-09-01、以後5日間無送信、nudges 2

## 真因 4つ

1. settlePendingOnAnswer が、返事のたび、まだ答えていない古い波の
   `p.sent_at` を now() に巻き戻していた。催促の日数表も波の寿命もそこから数え直し。
2. 追撃の門が `!ap.pending` を要求する。prospect では返事待ちが1つでもあれば永久に閉じる。
3. 通常の波に失効が無い(soft pending だけ7日)。1と2に噛み合って、答えている相手ほど固まる。
4. 初回ヒアリングが終わっても prospect のまま。立場を変える道は /admin/hearing-mode を
   人が叩く一手だけで、自動の移行はどこにも無かった。
   加盟店が 3/7/14/21 の催促と28日打ち切りに落ちて、そこで会話が終わっていた。

## 直したこと (src/autopilot.js)

- `p.sent_at = remain[0].sent_at` 残した波の時計は動かさない
- `WAVE_TTL_D = 10` 古い波を落とす。ただし **返事のあった相手の波だけ**。
  一度も返事の無い相手には当てない(28日打ち切りの掟を壊さないため)
- 初回ヒアリング完了 + member_no あり + 立場が未設定 なら、巡回が自動で
  `hearing_mode = "onboarding"` に上げる。人が決めた店(hearing_mode_at あり)は触らない

バックアップ: `src/autopilot.js.20260907-deadlock.bak`

## 検査

    node deadlock_test.mjs        # 新設 15件 全通過(直す前のコードでは落ちる)
    node cadence_test.mjs         # 45件
    node hearing_form_test.mjs    # 276件
    node inbound_test.mjs / focus_multi_test.mjs / concierge_test.mjs / industry_gate_test.mjs

## deploy したらどうなるか

- 001 は最初の tick で 8/21・8/25 の波が失効 -> pending が消える -> 追撃が再開。
  **KV を手で触る必要は無い。**
- 001・002 とも hearing_mode 未設定なので、同じ tick で onboarding に自動昇格。
  以後は返事待ちでも48時間おきに次が届き、3回無返答で人に回る。
- 昇格した店は巡回ログの `promoted` と activity に出る。想定外の店が混ざっていないか
  最初の1回だけ目視すること。

## まだ人の手が要る

- q_estimates は asked 3回で ASK_MAX=3 に達し、自動では二度と聞かれない。
  見積もり例3本(MIN_AUDIT_ESTIMATES)は人が頼む。KIRA自動採点と verified 化はそこで止まっている。
- 堤さまの 8/20 の回答 q_fr_support「進めて下さい」(代理店の話)は、機械の担当ではない。

---

# 第二弾 2026-09-07 09:2x(第一弾 deploy 後に判明した2件)

## 5. q_estimates が ASK_MAX=3 で永久に死んでいた

実見積が MIN_AUDIT_ESTIMATES(3本)揃わないと、KIRA の自動採点(scoreEstimates の
enoughEvidence)も verified 化(hearing.js auto-score)も永久に始まらない。
つまり q_estimates は「あれば良い情報」ではなく、売った物の分母。
それを nextQuestions の ASK_MAX=3 が打ち切っていた。
実測: hs-partner-001 は 7/31・8/20・8/25 の3回で打ち止め、estimates_for_audit は 0 本。

直し: `NEVER_GIVE_UP = ["q_estimates"]` と `RETRY_COOL_D = 14`。
上限に達しても打ち切らず、14日の長い冷却を置いて聞き直す。
4回目以降は `LAST_RESORT_TEXT` に差し替え、同じ文面を繰り返さない。
打ち切ってよい問い(q_story など)はこれまでどおり3回で止まる。

## 6. 自動昇格が回数を数え直していなかった

/admin/hearing-mode(人が叩く道)は立場を変えるとき unanswered_sends を 0 に戻し
needs_human を外している。第一弾で足した自動昇格だけ、それを写し忘れていた。
実測: hs-partner-002 は onboarding に昇格したのに last_send が 2026-09-01 のまま。
prospect 時代に積んだ unanswered_sends が残り、handOff(3回無返答で人に回す)が
昇格したその場で成立して、一通も出せない状態だった。

直し: 自動昇格でも `ap.unanswered_sends = 0` と `delete ap.needs_human`。

## 検査

    node deadlock_test.mjs   # 21件 全通過(D節を追加)
    既存6本 全通過

バックアップ: src/autopilot.js.20260907b.bak

## deploy 後の予測(確かめること)

- hs-partner-002: 次の tick で unanswered_sends が 0 に戻り、onboarding の
  48時間の門が開いて追撃が飛ぶ。last_send が動くはず。
- hs-partner-001: q_estimates の最後の送信は 2026-08-25。14日目は 2026-09-08。
  つまり **9/8 の朝の巡回で、見積もりの問いが文面を変えて戻ってくる**。

---

# 第三弾 2026-09-07 10:5x 切り分け不能の1通を、回答欄に配らない

## 7. 他所宛の私信が、お客様の回答欄に2箇所コピーされた

実測 2026-09-07T01:09:04Z、hs-partner-001(堤さま)から届いた
「@森下 真也 宜しくです!」は、こちらへの返事ではなく他所へ宛てた私信。
それが同日朝に送った q_cn_zairyo_ugoki と q_ai_summary の回答欄へ両方
コピーされ(attributed=ambiguous)、機械は
「いただいた内容は担当が確認し、掲載に必要なところを整えます」と返した。
お客様はその後トークから消している(送信取り消しと見られる)。

朝の時点で番人は「answered() が ambiguous を弾くので実害は薄い」と判断して
この直しを取り下げた。設問が死なないのは正しいが、実害の評価が誤りだった。
お客様の回答欄に別人宛の文が残り、それに掲載を約束する返事をしたことが害である。

直し: parts が無く qids が複数のときは、どの設問にも配らない。
`extra._unsorted` に 1 本だけ残し(text / attributed / with / asked)、
asked には replied_at だけ立て、返事待ちは消さず、needs_human を
「当てるか決められない」という理由で立てる。
needs_human は recover() の後に立てる(recover が印を外すため、順序が要る)。

契約の分離: 「無返答だから人に回す」印は返事で消える。
「当て直しが要る」印はそれとは別の事実として立つ。配信は止まらない
(handOff は unanswered_sends で決まるため)。

## 検査

    cadence_test.mjs  48件(45 から 3 増、EXPECT も更新)
    deadlock / hearing_form / inbound / focus_multi / concierge / industry_gate  全通過

バックアップ: src/autopilot.js.20260907c.bak

## deploy 後、KV に残った汚れを一度だけ落とす

hearing:hs-partner-001 の profile.extra から
q_cn_zairyo_ugoki と q_ai_summary を消し、_unsorted へ移す。
消したあと、その2問は未回答に戻るので、巡回が聞き直す(堤さまはまだ答えていない)。
