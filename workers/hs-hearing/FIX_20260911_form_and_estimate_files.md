# 用紙に回答欄が無かった件と、見積書を置く場所が無かった件

2026-09-11

## 起きたこと

2026-09-10 11:17、リフォーム職人株式会社(加盟No.001)の森下さまから。

> いただいたフォーム内を確認させていただいたのですが、回答欄がなく、
> 「フォームで回答する」と「登録を完了する」のループとなってしまうため、
> 「HORIZON グループ」のトークにてご回答させていただきます

そのあと 11:21、森下さまは設問1への答えを公式LINEに直接書かれた。
その返事は `[Yakumo] 切り分け不能(ambiguous)のため定型で返信。人が当て直すこと` で流れた。

森下さまの言うとおりだった。穴は3つあった。

## 穴1: 用紙に、聞いている設問が載っていなかった

こちらが LINE で聞いた設問は `store.autopilot.pending` にある。
`/register-info` はそれを `pending_question` として返していた。
ただし **連結済みの1本の文字列** でしか返していない。
用紙はそれを見ても欄を作れない。どこで切れば1問なのかが判らないからである。

結果、建設の加盟店に渡していた用紙(`yakumo/register/`)は会社情報の登録用紙のままで、
LINE で聞いた問いが一問も載っていなかった。
しかも森下さまは `already_answered:true`(完成度62%)。
一度出し終えた人が開けば、埋まった欄と「登録を完了する」しか無い。
設問の行き場が無いから、ループに見える。

建設以外の業種は `hearing.horizonshield.dev/h/<token>` 側の用紙に行く。
そちらは設問バンクを全部描いている。**建設の加盟店だけが、設問の載っていない紙を渡されていた。**

## 穴2: 見積書を置く場所が、どこにも無かった

森下さまに出ていた設問の本文は、こう書いてある。

> 実際の見積もりが3本必要です。今はまだ0本のため、御社の値付けを測る土台がありません。
> **写真でも、PDFでも、手書きのメモでも構いません。**

そう言うておいて、受け口を一つも持っていなかった。

- 用紙の「見積もり例」は 工種 / 概算金額 / 内訳 の文字欄だけ。ファイル欄が無い。
- `hearing.js` の LINE webhook は `ev.message.type !== "text"` で無言の `continue`。
  写真を送った人には届いたように見えて、こちらには何も残らない。

(公式LINE @172piime の webhook は `hs-kira-line` が持っており、そちらは加盟店の画像を
読み取って `estimates_for_audit` に積む道を持つ。ただし発火は `hs-kira-line` 側 KV の
`partner:<uid>` 印に依り、その印は hs-hearing の加盟店台帳と同期していない。
印が無いと同じ写真が施主の見積診断に流れる。これは別途。)

## 穴3: 当て先の決まらなかった返事が、誰の目にも触れない

切り分け不能(ambiguous)の1通は `profile.extra._unsorted` に1本だけ置き、
`needs_human` を立てて notify を1回流す。流れたら終わりである。
誰も当て直さなければ、お客様の言葉はそこに座ったまま見えない。
設問は答え済みにならないので、同じことをもう一度聞くことになる。二度手間はこちら側の落ち度。

## 直したこと

### autopilot.js

- `settleByQid(store, answers)` を追加。用紙から `{qid, text}` で返ってきた答えを、
  その設問にだけ入れる。印は `attributed:"form"`。
  用紙から返る答えはどの設問への答えか最初から判っているので、
  `ambiguous` も `recent_wave` も構造的に起こらない。
  締めた設問は波から外し、**残した波の送信時刻は動かさない**(催促の 3/7/14/21 日はそこから数えている)。
  空白だけの欄は「書かれていない」として扱う。
- `settlePendingOnAnswer` の残波再構成で、締めた設問の問い文が `asked_texts` に
  残り続けていたのを直した。`p.text` は `/register-info` を通って用紙にそのまま出るので、
  答え終えた設問が用紙の上でもう一度お客様に出ていた。
- 自己診断に E9 `no_unsorted_reply` を追加。`extra._unsorted` があれば名指しする。
  中身は判定しない。当て直せば消える。放っておけば残る。

### hearing.js

- `pendingQuestionList(store)`: 返事待ちを `[{qid, text}]` で1問ずつ返す。
- `/register-info` に `pending_questions` と `estimate_files`(預かっている見積書の件数)を追加。
- `hearingForm(token, store, profile, pendingQs)`: 用紙の一番上に設問の欄を出す。
  欄には `data-pq="<qid>"` が乗る。設問本文は必ず HTML エスケープする。
- `/h/<token>` POST が `answers` を見る。あれば `settleByQid`、無ければ従来どおり(後方互換)。
- `POST /h/<token>/file`: 見積書(写真/PDF)の受け口。1枚8MBまで。
  中身は名乗りを信じず先頭バイトで見る(`sniffFileType`)。JPEG / PNG / PDF / HEIC / WebP / GIF のみ。
  判らないものは預からない。KV `estfile:<store_id>:<id>` に実体、`estfiles:<store_id>` に一覧。
  受けたら `needs_human` を立てて通知する。**機械が金額を読んだことにはしない。**
- LINE webhook が文字以外を捨てるのをやめた。画像/PDF は受け取って保存し、返事を返す。
  複数枚は1枚ずつ届くので、返事は最後の1枚にだけ返す。
  読める形でないもの(スタンプ・動画など)には、受け取れないと正直に返す。
- `GET /admin/profile?store=`: いま何が入っているかを読む口。
  直す口(`/admin/profile-patch`)は前からあったのに、読む口が無かった。
  見ずに直すのは、当てずっぽうで人の言葉を動かすことになる。
- `GET /admin/estimate-files?store=` / `GET /admin/estimate-file?store=&id=` /
  `POST /admin/estimate-file-read`: 届いた見積書を人が見て、読み取り済みの印を付ける口。
  未読が0になれば見積書由来の `needs_human` は自動で外れる。

### yakumo/register/index.html

用紙の一番上に設問の欄。見積もり例の下に見積書の添付欄。
送信は、先に見積書を1枚ずつ上げてから本体を出す。
まとめて base64 にすると、電波の悪い現場で1枚こけたら全部やり直しになる。

### formanswer_test.mjs (新規)

用紙から返る答えの当て方、返事待ちの取り出し、先頭バイトの判別、
用紙(HTML)と worker の配線、書き出した client の JS の構文検査。
最初に走らせたとき「空白だけの欄を答えとして立てていた」のを掴んだので、
検査ではなく実装のほうを直した。

## 出す順番

worker が先、用紙があと。

用紙を先に出すと `/file` が 404 になり、`pending_questions` が undefined で
欄が出ない。しかも**黙って**出ない。それは今回直した壊れ方と同じ形である。

    cd workers/hs-hearing
    node run_all.mjs && npx wrangler deploy
    (それから) git push

## まだ残っていること

- `hs-kira-line` の `partner:<uid>` 印と、hs-hearing の加盟店台帳が同期していない。
  印の無い加盟店が公式LINEに見積書を送ると、施主の見積診断に流れる。
  hs-hearing 側に照会の口を置き、hs-kira-line がそこを見る形にすれば構造的に消える。
- 森下さまの 2026-09-10 11:21 の回答が `_unsorted` にある。人が当て直すこと。
  当て直しは `/admin/profile-patch` の `extra` に `{text, at}` を渡す
  (`at` を渡せば答えた時刻が保たれ、印は `legacy_confirmed` になる)。

---

## 追記 2026-09-11 夕: 当て先の決まらない返事を、消せるようにした

穴3(_unsorted が誰の目にも触れない)に、E9(no_unsorted_reply)で名指しする所までは入れた。
だが当て直したあと _unsorted を消す口が無く、消せないので E9 が永久に鳴った。

- `/admin/profile-patch` の extra が `_unsorted: ""` を受けて消せるようにした。
  _unsorted は手で書く物ではない(機械しか置かない)ので、**消すことだけ許す**。
  非空の _unsorted を書こうとすると `unsorted_is_delete_only` で 400。
- `GET /admin/profile?store=` を先に足してあるので、**読んでから当て直す**順が守れる。

森下さま(hs-partner-001)の 2026-09-10 11:21 の回答(お客様の見つかり方)は q_ai_found への答え。
手順: /admin/profile で _unsorted の中身を見て、q_ai_found であることを確かめてから、
profile-patch の extra で `{q_ai_found:{text,at}, _unsorted:""}` を一度に送る。
at には _unsorted の at をそのまま渡す(答えた時刻を今の時刻で潰さない=legacy_confirmed)。

検査: admin_unsorted_test.mjs(実物の /admin/profile と /admin/profile-patch を mock KV で叩き、
時刻の保存・巻き込みなし・手書き _unsorted の拒否・未来日付の拒否を確認)。全 suite 10/10 緑。
