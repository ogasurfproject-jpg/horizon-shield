# NENRIN Résumé v1 〜 可搬・第三者検算可能なエージェント行動履歴

Status: 配備済み(2026-09-18、hs-ledger Version 9f8b46c2-a201-4b95-823c-606ef80dd0c9、route GET /resume 稼働)。実装は route + python/node 二実装 + 敵。
Anchor target: 配備後、本ドキュメントの SHA-256 を JIDEC 台帳に刻む。

## 0. 一行の定義

履歴書は新しい主張を一切しない。既存の JIDEC 録を 1 つのエージェント(origin)の下に集約して「指す」だけの読み取り面である。行の中身は全部、証人が測って台帳が錨打った記録に由来する。エージェントは自分の履歴書に一行も書けない。

## 1. 何を解くか

README の問題設定「Discovery is solved. Choice is not.」への直接の答え。
「このエージェントは過去どう振る舞ったか」を、可搬・改ざん不能・第三者検算可能な 1 枚にする。判定(ALLOW/BLOCK)は使い捨てだが、履歴書は積み上がる。積み上がりが堀になる。

## 2. 識別子と口

- identity(perma_id)= エージェントの origin(例 https://mcp.horizonshield.dev)。同じ origin の /mcp と /a2a は同一エージェント。将来 w3id の per-agent 永続識別子に差し替え可。
- 口: GET /resume?endpoint=<https url> [&format=md]。JSON 既定。Accept: text/markdown か format=md で人間可読(平文の表、バッジ無し、スコア無し)。
- 実装: 台帳 worker(hs-ledger)の薄い route。既存の entry 読み(GET /paths と同じ、新しい方から並列、天井 400)に乗る。扉(hs-verify-gate)は無改造。

## 3. 何を集めるか(台帳の実形)

証人録は個別 entry ではなく nenrin-witness-batch-v1 の束ね entry に錨打たれ、束ねは各録の sha だけを列挙し、録の元バイトは KV の wit:anchored:<sha> にある。よって 1 行の認証は二段:
  hop 1  sha256(録の元バイト) == record_sha256(核が検算)
  hop 2  record_sha256 が束ね bytes の records[].sha に含まれ、sha256(束ね bytes) == entry の claim(= anchor.batch_sha256)、その entry に OpenTimestamps 証明
録が自分の entry として錨打たれた場合(per-record path)は hop 1 + entry の claim で足りる(anchor.batch_sha256 は null)。

核に渡すのは full mode・counted・錨付き(ots confirmed かつ block_time あり)の録だけ。渡さない録は envelope の not_counted に理由付きで全部出す:
  not_yet_anchored / confirmed_without_block_time / commitment_unrevealed / stored_not_counted(同一証人・同一 endpoint・同日) / batch_lists_sha_but_stored_bytes_missing
対象外(他 origin、証人の無い path)は scan.out_of_scope に数える。隠すものは無い。

## 4. 出力(核が返す resume と envelope)

resume(sha の対象): schema, perma_id, measured_endpoint, agent_card_url, counts{PASS,FAIL}, witness_diversity{distinct_names,distinct_vantages}, measurements[], discrepancies[], rings[], agreements[], admissions[], freshness{last_measured,oldest_measurement,current_now,period_days}, resume_sha256
measurements[i]: measured_at(=walked_at), record_sha256, outcome(PASS|FAIL), n_pass, n_total, base, purpose, witness{name,vantage,key_url}, record_url, anchor{bitcoin_block,block_time,ots,batch_sha256}, source_ledger_n
admissions[i](2026-11-02 に足した。11 節): record_sha256, ledger_n, decision, content(null か {checked, decision, marks, rules_sha256}), revoked
順序: entry 昇順 → 束ね内順(第三者が再現できる順)。
envelope(sha の外): evaluated_at(freshness の評価時刻、再計算に必要), not_counted[], scan{seq,entries_read,ceiling,out_of_scope}, recompute{how,reference,evaluated_at_needed}
resume_sha256 = sha256(canonical(resume から resume_sha256 を除いたもの))、canonical = キー辞書順・空白無し・非 ASCII 生(make_ring と同一)。

## 5. ソフトに付ける 5 つの堀(不変条件、構造で強制)

M1 自己認証する出力: 各行は record_sha256 + Bitcoin anchor を内包。元バイトを取って第三者が再計算する。postdating は prover 非所有の block_time で構造的に refuse。fork はコードを持てても錨の無い行は信用ゼロで、錨は実時間でしか積めない。
M2 中立の外部検算可能性: 座標は prover 非所有の源から導出。全フィールド名を公開。open であること自体が堀。
M3 証人の多様性を露出: 各行の witness{name,vantage} と header の distinct カウント。薄い履歴書は薄いと分かる。
M4 決定論を標準にする: python と node が同じバイト・同じ拒否コード(byte-match)。fork 可能なコードでなく皆が検算する参照標準。
M5 敵が製品: 公開 red-team。check を緩めた fork は公開ハーネスで落ちる。

## 6. 3 つの掟(2026-09-13 合意)

1. 自己申告の行はゼロ。行は測定由来のみ(M1〜M3 で構造強制)。
2. Discrepancy は一級市民。必ず載せる。
3. スコア・星・信用点は出さない。カウントとリンクだけ(PASS/FAIL、n_pass/n_total はカウント)。

## 7. 核の拒否(fail-closed。1 行でも落ちれば route は 422 で理由を名指しし、周りだけで組み立てない)

self_asserted(バイト無し / jidec-path-v1 でない / witness{name,vantage} 無し) / orphan_record(バイトが sha に一致しない) / score_injection(verdict.outcome が PASS|FAIL 以外、または score 系キー) / verdict_inconsistent(verdict.ok と outcome が食い違う) / coordinate_chosen_by_prover(block_time 無し / 時刻が読めない / walked_at が block_time より後 = postdated)。時刻は walk の 'YYYY-MM-DDTHH:MM:SSZ' と台帳の 'YYYY-MM-DD HH:MM[:SS] UTC'(stamp 台本の書式)を両方 UTC 秒に正規化して比べる。文字列比較は同日の錨で 'T' と ' ' の差だけで誤拒否する(2026-09-13 本番の block_time で発見)

## 8. 検証(全部 offline・決定論、この dir で)

    python3 resume_redteam.py        控え 4 + 攻撃 11 + 正直 limit 1 + legacy 1 + 時刻書式 2 = 19/19
    python3 resume_bytematch.py      python vs node、36 ケースで sha と拒否コード一致(M4。admissions[] の 10 ケースを 2026-11-02 に足した)
    node resume_route_selftest.mjs
                                     実 worker.js を KV モックで叩く。束ね二段認証・仕分け・順序・422・md・400・空台帳 = 19/19
配備の門(Mac): cd workers/hs-ledger && npx wrangler deploy --dry-run --outdir /tmp/hsl-bundle(核が bundle に入り node import が無いことの確認)→ npx wrangler deploy → 本番 curl。

## 9. 未解決(正直に)

- backdating(現実より古い walked_at)は前方 anchor では捕まらない = 再測定(ring)のみ。freshness は fail-closed(period 外は current_now:false)。
- 履歴の厚みは format では作れない。今日の本番は自前の証人が大半で薄い。厚みは時間と独立証人でしか積めない。
- agreements[] は 2026-11-02 から route が渡す。入れるのは、その端点の host(またはその親の domain)の当事者が署名した合意のうち、次の 2 つを満たす物だけ。測りと同じ二段の照らし。
  - 保存したバイトの sha256 が、合意の束(nenrin-agreement-batch-v1)に載った sha と合う。
  - その束が錨の付いた entry である(OTS が確定し、block と時刻がある)。
- 満たさない合意は not_counted に理由つきで入る: 保存したバイトが束の sha と合わない物は agreement_bytes_do_not_hash_to_the_listed_sha、束にまだ錨の無い物は not_yet_anchored(確定して時刻の無い物は confirmed_without_block_time)。同じ束の admission、revocation、furui-check-day の行は合意でないので読まない。
- 合意のある端点では agreements[] が入るので、resume_sha256 が前と替わる。合意の無い端点は前と同じ空の list で、resume_sha256 も替わらない。
- rings[] は核が受けられるが、route はまだ渡していない(空)。次版で ring entry を同じ二段認証で載せる。

## 10. 堀の正体(まとめ)

route 自体は MIT で fork 可。でも fork は空の台帳・証人ゼロ・敵に落ちる。堀は履歴書という機能ではなく、履歴書が指す錨付き実履歴 + 独立証人 + 運用年数で溜まるもの。ソフトの役目は「fork が真似できない物を出力で露出し、fraud と薄さを構造的に可視化する」こと。

## 11. admissions[](2026-11-02 に足した。schema は nenrin-resume-v1 のまま)

- 足した日: 2026-11-02。schema の名は nenrin-resume-v1 のままにし、既存の欄は替えていない。古い読み手は知らない欄 admissions を飛ばす。
- resume_sha256 は admissions[] を含めて計る。admission の無い端点でも空の list が入る。**足した日に全部の端点の resume_sha256 が替わる、欄の意味は替わらない。**(CHANGELOG にも書いた)
- 誰の Résumé に載るか: その端点の host(またはその親の domain)が、admission(a2a-admission-v0)の relying_party.domain である物だけ。扉の側の Résumé で、その扉が何をどう通したかを示す。契約の当事者の側の Résumé には、まだ載せない(台帳が契約を sha で引けるようになった後)。
- 数え方は agreements[] と同じ二段の照らし。
  - 保存したバイトの sha256 が、束(nenrin-agreement-batch-v1)に載った sha と合う。合わない物は not_counted に admission_bytes_do_not_hash_to_the_listed_sha、kind "admission"。
  - その束が錨の付いた entry である。錨の無い物は not_counted に not_yet_anchored(確定して時刻の無い物は confirmed_without_block_time)、kind "admission"。
- 1 行の欄は閉じた物だけ。
  - record_sha256: 保存したバイトの sha256(GET /admission/{sha} と同じ)。
  - ledger_n: その admission を挙げた束の entry の番号。
  - decision: "admit"、"escalate"、"refuse" のどれか。
  - content: rules.version が "0.4" の admission では content の塊から 4 つだけを写す。checked(真偽)、decision(null、"stop"、"pass")、marks("off_topic"、"rule_conflict" をこの順で、0 から 2 個)、rules_sha256(null か 16 進 64 字)。0.3 以前の admission は null。
  - revoked: 同じ契約(contract_ref.contract_sha256)を打ち消す a2a-revocation-v0 が、その admission より後の錨の付いた entry にあれば true。同じ束の中の前後は錨では決まらないので true にしない。
- 写さない物: admission_id、relying_party(domain と key_url)、contract_ref、action_ref、presentation_ref、clause、reasons、establishes、does_not_establish、immune、signatures、content の input_commit と scope_sha256 と check_sha256。record_sha256 から元のバイトを引けば全部ある。
- 閉じた形でない行(intake が形を照らすので、ふつうは起きない二つ目の鍵)は Résumé を落とさず、not_counted に admission_fields_not_closed(detail admission_not_closed)で入る。
- 言わない事: 扉の判断が正しかったか。admissions[] は、扉が自分の鍵で署名して台帳に積んだ記録が、錨の付いた束にある事だけを言う。content も、扉がそう言った事であって、照らしが走った事の証明ではない。
