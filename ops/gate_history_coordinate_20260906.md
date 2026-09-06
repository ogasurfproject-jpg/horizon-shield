# 門の /history は coordinate_derivation を持ち越していない(発見 2026-09-06 12:40 JST、論文チャットの番人)

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

## 配備後にこっち(論文チャット)がやること

- 翌日の掃引(18:00Z)後に export を取り直して `python3 ops/history_cd_summary.py /tmp/hist/*.json` と `verify_beacons.py --history` を回す。derived が出れば C15 が初めて実測になり、論文2 の Table 2 と 9 節を「exercised」に更新する。legacy に落ちていればその理由(二つの explorer の不一致か取得失敗か)を 4.3 の本番段落に書く。
