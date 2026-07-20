# Yakumo 自動運用エージェント(AUTOPILOT) 設計書

作成 2026-07-10 ／ 運用 The HORIZONs株式会社(HORIZON SHIELD) ／ 対象 workers/hs-hearing + tools/yakumo + yakumo/*

## 0. 目的(TOshi要求の写し)

1. ヒアリングは厳格に・満遍なく。最適な回答が来なければ、計算しながら聞き直す(自動追撃質問)。
2. 加盟店ごとの「求めるもの」(フォーカス)を見極め、それに合わせた質の良い GEO/AEO/LLMO/WebMCP を継続的に生成しサイトに紐付ける。
3. 同じダブりは絶対に出さない(重複ゼロ・ガード)。
4. 回答が止まる店にはまず「こんなことはありますか？」と注意喚起の質問を返し、それでも止まればランクを落とすことがある。
5. 加盟店が活発になるほど Yakumo と HORIZON SHIELD の知名度が上がる仕組み(活動フィード・紹介プログラム)。
6. 補佐はエージェント(本ワーカーの日次tick)が行う。モール自体の運用はTOshi+Claudeで随時更新。

## 1. 構成図

```
加盟店 ──メール/LINE/フォーム──> hs-hearing Worker
                                   ├ ingest: 構造化->マージ->pending消込->完成度再計算->活動記録
                                   ├ autopilot(日次cron):
                                   │   完成度<85 -> 次の質問を自動送信(重複質問ゼロ)
                                   │   pending放置 7d/14d/28d -> 注意喚起 -> ペナルティ(ランク帯降下)
                                   │   ニュースダイジェスト更新(KV設定のRSSのみ・捏造なし)
                                   ├ triggerGeneration -> GitHub Actions(yakumo-content.yml)
                                   │   generate.py: フォーカス別ページ構成+manifest重複ゲート
                                   │   validate.py: fail-closed 検証(+重複ゲートB)
                                   │   -> commit -> Pages公開 -> IndexNow
                                   ├ /activity.json  -> モール「YAKUMO NOW」フィード(認知)
                                   └ /ref-hit?ref=No.001 -> 紹介カウント(加盟店が加盟店を呼ぶ)
```

## 2. データ(KV: HS_HEARING_KV)

- `store:<sid>` 既存 + `autopilot` フィールドを追加:
  `{ focus_primary, focus_all[], focus_via, completeness, missing[], pending:{qids[],text,sent_at,via},
     asked:[{qid,at,answered}], last_answer_at, last_send_at, nudges, penalty }`
- `hearing:<sid>` 既存(プロフィール)。追撃回答は `profile.extra[qid]={text,at}` にも保持。
- `activity:index` 直近100件の活動イベント(公開安全な文言のみ。金額・連絡先なし)。
- `dedupe:index` 公開済みコンテンツ指紋の一覧 `{slug, tsha, simhash}`(上限5000)。
- `ref:<member_no>` 紹介リンクの着地カウント。
- `news:sources` 管理者が設定するRSS URL配列(既定は空=ニュース織り込みなしで進む)。
- `news:digest` 直近ダイジェスト `{items:[{title,url,source}],updated_at}`。

## 3. ヒアリング(厳格・満遍なく・聞き直し)

- 完成度スコア(0-100)。重み: areas_served10 / strengths15(120字以上) / faqs15(3件以上) /
  estimates10(2件以上・監査用非公開) / trust10 / contact5 / hours5 / license5 / story5 / cases5 /
  フォーカス判明5 / フォーカス個別質問10。
- 質問バンク(qid固定)。基本10問 + フォーカス別3問x5系統。**同じqidは二度と送らない**(askedに記録)。
- 選定 = 「計算しながら」: 未充足のうち重みが大きい順、フォーカス未判明なら q_focus を最優先。1回の送信は最大2問。
- 送信チャネル: LINE連携済みならLINE push、なければメール(件名 ref:<token> で返信自動照合)。72時間の送信間隔制限。
- 回答が来たら: 構造化->既存プロフィールに**マージ**(上書きでなく統合)、pending消込、ペナルティ0にリセット、完成度再計算、活動記録、生成トリガー。

## 4. フォーカス(加盟店の求めるもの)

系統: recruit(人材確保) / leads(案件・元請け獲得) / homeowners(施主集客) / franchise(協力店・加盟店募集) / brand(認知)。
- 判定: q_focus の明示回答(数字/キーワード) > 回答本文のキーワード > Workers AI 補助。判定できるまで「不明」のまま(決めつけない)。
- 生成への影響: dispatch payload に `autopilot:{focus_primary, completeness}` を同梱。generate.py がフォーカス別ページを1枚差し込む
  (recruit=採用情報ページ / leads=協力業者・元請け向けページ / homeowners=施工事例・保証ページ / franchise=パートナー募集 / brand=実績・信頼ページ)。

## 5. 重複ゼロ・ガード(二重関所)

- 指紋 = slug完全一致 / タイトルsha256(8) / 本文simhash64(3-gram, FNV-1a 64bit)。ハミング距離<=6は近似重複として不可。
- 関所A(生成時): generate.py が data/yakumo-content-manifest.json と照合し、重複ページは**書かずにスキップ**(ログDUP-SKIP)。
- 関所B(検証時): validate.py がバッチ内相互+manifest照合。衝突があれば exit 1 で**バッチごと不公開**(fail-closed)。
- 公開後: manifest に指紋を追記して同一コミットに含める(リポジトリが台帳)。ワーカーKVは補助台帳(/admin/dedup-register)。

## 6. 動的ランクと注意喚起(誠実設計)

- **KIRAの適正度スコア(fairness_score)は絶対に改変しない**(414の教訓: 数字の捏造・加工は信頼を殺す)。
- 公開値に `rank_score = max(0, fairness_score - penalty)` を別フィールドで追加。バッジは rank_score から算出、
  「適正度 92」の表記は純正スコアのまま。penalty>0 の店には「運用状態により表示ランクを一時調整中」を明示。
- ペナルティ階段: pending放置 7日->注意喚起1(「その後いかがですか。◯◯のようなご実績はありますか？」)
  / 14日->注意喚起2 + penalty3(帯が一段落ちうる) / 28日->penalty5(上限)。回答が来れば即0に戻す+活動記録「復帰」。

## 7. 認知爆上げ(活発さ->知名度のループ)

1. **YAKUMO NOW(活動フィード)**: 新規加盟/ヒアリング完了/検証通過/ページ公開を /activity.json で公開し、モールに表示。
   毎日動くサイト=クローラーへの鮮度シグナル+訪問者への勢い提示。個人情報・金額は載せない。
2. **紹介プログラム**: 各加盟店のマイページに紹介リンク(/yakumo/apply/?ref=No.001)。着地で ref カウント。
   紹介実績はマイページに表示(将来: モールの紹介ランキング)。加盟店が加盟店を呼ぶ導線。
3. **バッジ相互リンク**(既存): 検証済み店の自社サイトからYakumoへ被リンク。
4. **生成ページのバックリンク網**(既存): 全生成ページがモール/HS本体へ還流。
5. **IndexNow**(既存): 公開の都度、検索へ即時通知。
6. **SNS下書き**: /admin/sns-drafts が活動イベントからX/Instagram用の下書きテキストを返す(テンプレ生成)。TOshiがコピペ投稿。

## 8. ニュース織り込み(捏造ゼロ)

- KV `news:sources` に入れたRSSだけを日次で取得(既定は空)。タイトル+リンクのみ保持し、生成時に
  「時事の切り口」として渡す。**本文の事実はRSSタイトル+出典リンクの範囲でのみ言及**(数字・因果の創作禁止)。
- 取得失敗/未設定でも生成は止まらない(fail-open。ニュース無しで通常生成)。

## 9. エンドポイント一覧(追加分)

公開: `GET /activity.json` / `GET /ref-hit?ref=No.XXX`(204)
管理(X-Admin-Key): `POST /admin/followup {store_id}` / `POST /admin/classify {store_id}` /
`POST /admin/nudge {store_id}` / `GET /admin/autopilot/<sid>` / `POST /admin/dedup-check` /
`POST /admin/dedup-register` / `GET /admin/news` / `POST /admin/news-refresh` /
`POST /admin/news-sources {urls[]}` / `POST /admin/activity {type,text}` / `POST /admin/sns-drafts` /
`POST /admin/tick`(日次処理の手動実行) / `POST /admin/link-token {store_id,token}`(旧レコードのトークン後付け)
cron: 毎日 06:17 JST(wrangler.jsonc triggers.crons = "17 21 * * *" UTC)

## 10. TOshiの一回作業(これだけやれば全自動が回る)

1. `git am`でパッチ適用 -> push(または sources 追加でClaudeが直接push)。
2. ワーカー再デプロイ: `cd workers/hs-hearing && wrangler deploy`(cron有効化に必須)。
3. No.001のトークン後付け(旧レコード対応):
   `curl -X POST .../admin/link-token -H "X-Admin-Key: <key>" -d '{"store_id":"hs-partner-001","token":"ht_0e25f1dd9e25b469133b301957cdff9b"}'`
4. メール自動送信を生かすなら RESEND_API_KEY、LINEを生かすなら LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN を secret 登録(未設定でも他は動く)。
5. 任意: KV news:sources にRSSを設定(/admin/news-sources)。GH secrets に HEARING_ADMIN_SECRET を入れると
   ActionsからKV台帳同期・活動コールバックが有効化(未設定でもfail-openで動く)。

## 11. 保全エージェント(二人体制・三段構え)

方針(TOshi): エージェントが内部の構造エラーを察知し報告。軽微は自動修復。難しいものはTOshiとClaudeで修繕。

- **壱号(ソト回り)**: .github/workflows/yakumo-guardian.yml。6時間ごとに本番を巡回。
  検知: ワーカー生存 / cronの脈(最終巡回26h超で警報) / 公開済みページの404 / モール表示と堀語・金額漏れ /
  MCP応答 / 公開JSONのPII・料金漏れ / 直近の自動公開の失敗 / 弐号の未解決報告。
  自動修復: 公開済みページが404かつrepoに実体あり -> Pagesデプロイを自ら発火し、3分後に再確認(今日の404事件の再発防止)。
  報告: 異常時はIssue「🛡 保全レポート」を起票/追記(TOshiへメール通知)。全緑に戻れば自動クローズ。
  未解決のチェックボックスが「俺とお前で修繕」する作業台になる。
- **弐号(ウチ回り)**: autopilot.js selfHeal()。毎朝の巡回に同乗し、/admin/selfheal で単独実行も可。
  自動修復: htok索引の張り直し / email逆引きの再構築 / autopilot枠の初期化 / 活動フィード破損の初期化。
  報告のみ(自動で直さない): member_no・company欠損 / 検証済みなのにスコア欠損(fail-closed違反) /
  hearing破損 / 重複ゼロ台帳(dedupe:index)の破損(台帳は勝手に初期化しない。repoのmanifestから再同期)。
  結果は guardian:last に記録し、/health が要約(件数のみ)を公開、壱号が詳細を回収する。

## 12. 非目標(やらないこと)

- KIRAスコアの自動改変・自己申告だけでの自動「検証済み」化(検証はTOshiの承認ボタンのまま。ここは信頼の芯)。
- 金額の施主向け公開。堀(配分・エンジン)の公開面への露出。
- RSSにない事実の生成(ニュースの創作)。
