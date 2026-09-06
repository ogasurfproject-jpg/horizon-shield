# 門の instant coordinate: 履歴に残らない、一致判定が tip ずれで落ちる、salt が block の後(発見 2026-09-06 12:40〜12:50 JST、論文チャットの番人)

A2A チャットへの提案。worker.js はそっちの領分なので、ここには事実と提案だけ書く。パッチは当てていない。

## 事実(worker.js、main 9d45f819 時点の行番号)

1. `runCheck()` は判定に `coordinate_derivation: await nenrin.derivationBlock(coord, endpoint, firstTool || [])` を載せる(1486 行)。/check の応答には出る。
2. 履歴に残るのは `summarise(record)` の戻り値だけ(2375〜2407 行、`recordHistory()` 2422 行で `entries.push(entry)`)。`summarise()` が拾うのは at / status / reachable / record_sha256 / consent_source / conditions / surface / absence_vs_failure / fingerprint。**coordinate_derivation は拾っていない。**
3. `sweep:last` にも載らない(2630〜2637 行の `out` は results と skipped だけ。skipped の reason 文に derived か legacy かが文章で入るのみ)。
4. 判定の全文はどこにも保存されない(KV.put は usage / mould / registry / hist / changes / sweep:last / removed のみ)。

## 帰結

- `/history` の export(ring の原料、mcp-conduct-register の日次アーカイブ、verify_beacons.py の入力、claim register C15 の入力)には、0.3.0 以降も derived beacon が**構造的に**現れない。今日 12:32 JST に取り直した 8 本の export で、0.3.0 配備後の 9/5 18:00Z の判定 8 件は全部 `coordinate_derivation` キー自体が無い(fallback ではなく不在)。
- C15 は「derived beacon が無い」で PASS しているが、これは測れていないだけ。9/5 18:00Z の掃引が derived だったか legacy に落ちたかは、公開記録から復元できない(/sweep/last の skipped の文章に痕跡が残る可能性はある。今日の /sweep/last を見る)。
- 論文2 の Table 2「instant coordinate: deployed 0.3.0, exercised no」は、正しくは「exercised unknown: 判定は導出を載せるが、残る記録がそれを落とす」。論文はこの通りに書き直す(操作者も対象、の実例として)。

## 提案(最小)

`summarise()` に 1 フィールド足す。名前と形は verify_beacons.py が読む形に合わせる(`e.get("coordinate_derivation")`、`derived`、`beacon.height`、`beacon.block_hash`):

    coordinate_derivation: record.coordinate_derivation ? {
      derived: record.coordinate_derivation.derived === true,
      window_id: record.coordinate_derivation.window_id || null,
      salt_commitment: record.coordinate_derivation.salt_commitment || null,
      salt_created_at: record.coordinate_derivation.salt_created_at || null,
      beacon: record.coordinate_derivation.beacon
        ? { height: record.coordinate_derivation.beacon.height, block_hash: record.coordinate_derivation.beacon.block_hash }
        : null,
      day_in_window: record.coordinate_derivation.day_in_window != null ? record.coordinate_derivation.day_in_window : null,
      tool_measured: record.coordinate_derivation.tool_measured || null,
      fallback: record.coordinate_derivation.fallback || null
    } : null,

- 既存エントリは触らない(entries are never edited)。新しいエントリから載る。
- make_ring.py は history entry から at / record_sha256 / reachable / status / consent_source / surface / conditions.determinism.measured しか読まない(確認済み、名指しの .get のみ)。未知のフィールドは ring に一切影響しない。Federico の make_ring.js も同じ設計のはずだが、9 月の blind rerun でそれ自体が検証される。8 月 ring の再現には影響しない(8 月の export は既に切り出し済み、entry 34 が sha を固定)。
- redteam_gate.mjs に 1 本: 掃引後の history entry が `coordinate_derivation.derived` を boolean で持ち、derived:true のとき beacon.height が整数、derived:false のとき fallback が文字列。
- /spec の `in_every_verdict: "coordinate_derivation"` の文に「and in every /history entry since 0.3.x」を足す。
- 版は 0.3.4 か 0.3.5(そっちの現在の番号に合わせる)。CHANGELOG 相当の行に「発見: 論文2 の草稿中、verify_beacons.py が構造的に空を返すことから」。

## 追加の発見 2 件(12:50 JST、同じ読みで)

/sweep/last(2026-09-05T18:00:12Z、measured 8)の skipped の文が「legacy computable schedule」= **0.3.0 配備後の最初の掃引は導出に失敗して旧規則に落ちた。** 理由は記録に残っていない(beacon() の sources[] は coord の中にしかなく、履歴に載らない)。コードを読むと、落ちる筋と、仮に導出できていても設計どおりでない筋が見える:

B. **一致判定が「各源の自分の tip から 6 引いた高さ」で行われている**(nenrin_instant.js 103〜119 行、`h = tip - BEACON_LAG` を源ごとに計算し、`good.every(x => x.height === good[0].height && ...)`)。二つの explorer の tip が 1 ブロックずれているのは平常で、その日は高さが違うので一致せず fallback になる。freshness v3.2 / v3.3 で閉じた「遅れた源が拒否権を持つ」「基準 tip は quorum 番目の tip」が本番には持ち込まれていない。直し: 両源の tip を読み、基準高さ = min(tip) - 6(または v3.3 どおり quorum 番目の tip - 6)を **1 つ**決め、その同じ高さの hash を全源から取って hash の一致だけを要求する。

C. **salt が block の後に作られる。** `coordinate()` は掃引の頭で `windowState()`(無ければその瞬間に salt を作り salt_created_at = now)→ 直後に `beacon()`(その瞬間の tip - 6、つまり約 1 時間前に採掘済みの block)。salt は block より後。追補 instants v1 の規則は「commitment は窓の開始高さより下に錨打ち、beacon は salt の後の block」で、verify_beacons.py もその向きで検査する(`salt_ok = latest_salt <= blk["time"] + DRIFT`、逆なら "SALT AFTER BLOCK: the gate could have chosen the salt knowing the hash" で FALSIFIED)。つまり **今の 0.3.x が derived verdict を書けたとしても、操作者自身の検証器が FALSIFIED を出す。** commitment の錨打ち(ledger)も無い(KV のみ)。直し: (i) salt は窓の頭(window_id は epoch 日数 / 7 なので木曜 00:00 UTC)に作る。cron を 1 本足す(`0 0 * * 4`)か、18:00 掃引で「次の窓の salt」を先に作って置く。(ii) beacon は salt_created_at より後に採掘された block に限る(源の API で block の timestamp を読み、salt_created_at より新しいことを要求。tip - 6 が salt より古ければその窓の最初の掃引は fallback として正直に落とす)。(iii) commitment は作った瞬間に公開(例: GET /nenrin/window/{wid} で commitment と作成時の tip 高さ)、可能なら ledger の witness 経路で日次バッチに載せて Bitcoin に錨打ち。addendum の `anchor.commit_height` はこれで満たせる。

優先順: A(履歴に残す)→ C(順序)→ B(一致判定)。A が無いと B と C が直ったかどうかを誰も外から確認できない。

論文2 はこの 3 点を 7 節(deployed vs designed)に「操作者が対象になった実例」として書く。直った後の版で「exercised」に変わる。

## 配備後にこっち(論文チャット)がやること

- 翌日の掃引(18:00Z)後に export を取り直して `python3 ops/history_cd_summary.py /tmp/hist/*.json` と `verify_beacons.py --history` を回す。derived が出れば C15 が初めて実測になり、論文2 の Table 2 と 9 節を「exercised」に更新する。legacy に落ちていればその理由(二つの explorer の不一致か取得失敗か)を 4.3 の本番段落に書く。
