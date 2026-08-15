# Entry #3 手順 — verify_finding_v0.py の Bitcoin 固定 + GitHub push

## 何を anchor するか

**ファイル:** `scripts/verify_finding_v0.py`
**SHA-256:** `e882837d45022fb69ba1bffff9e8332e831424def28cc8fd3582e58b940fdd2f`
**目的:** JIDEC entry #2 の SPEC に書かれた「v0 ハッシュは estimate JSON しかカバーしていない」という finding を、機械的に再現・実証するスクリプト。Python 3 標準ライブラリのみ、依存ゼロ、誰でも実行可能。

デプロイ済 hs-pdf-gen に埋め込まれた canary の期待ハッシュ `C025E288675EE898`（`HS_AUDIT_CANARY_EXPECT.hash` に定数として書かれている）と一致する。これによりコピペしたハッシュではなく、真の再計算だと証明できる。

さらに mutation demonstration で、estimate を変えると hash が変わり、benchmark/algorithm/thresholds を変えても hash が変わらないことを示す。これが SPEC の finding の独立再現。

## Mac 手順

### 1. スクリプトを既存フォルダにコピー

```
mkdir -p ~/Documents/ホライゾンシールドシステム/horizon-shield/workers/hs-ledger/scripts
cp -v ~/Downloads/jidec_ledger_v1_20260725_entry3/scripts/verify_finding_v0.py \
      ~/Documents/ホライゾンシールドシステム/horizon-shield/workers/hs-ledger/scripts/
cp -v ~/Downloads/jidec_ledger_v1_20260725_entry3/seed_entry_3.json \
      ~/Documents/ホライゾンシールドシステム/horizon-shield/workers/hs-ledger/
```

### 2. スクリプトを実行して再現性を確認（重要）

```
cd ~/Documents/ホライゾンシールドシステム/horizon-shield/workers/hs-ledger
python3 scripts/verify_finding_v0.py
```

期待出力の末尾：
```
Reproduced v0 hash:    C025E288675EE898
Deployed expected:     C025E288675EE898
Reproduction faithful: True
...
PASS: reproduction faithful, coverage matches the SPEC's finding.
```

exit code 0。ここで期待値と違ったら手を止める（先に進んでも意味がない）。

### 3. SHA が seed と一致することも確認

```
shasum -a 256 scripts/verify_finding_v0.py
```
→ `e882837d45022fb69ba1bffff9e8332e831424def28cc8fd3582e58b940fdd2f` と一致することを確認。

### 4. GitHub に push

```
cd ~/Documents/ホライゾンシールドシステム/horizon-shield
git add workers/hs-ledger/scripts/verify_finding_v0.py \
        workers/hs-ledger/seed_entry_3.json
git commit -m "Add verify_finding_v0.py — independent reproduction of v0 hash defect (JIDEC entry #3)"
git push
```

### 5. entry #3 を JIDEC 台帳に append

```
cd ~/Documents/ホライゾンシールドシステム/horizon-shield/workers/hs-ledger
curl -s -X POST https://hs-ledger.oga-surf-project.workers.dev/ledger/append \
  -H "X-Ledger-Key: <LEDGER_ADMIN_TOKEN>" \
  -H "content-type: application/json" \
  --data @seed_entry_3.json | python3 -m json.tool
```

期待レスポンス:
```json
{
  "n": 3,
  "url": "https://hs-ledger.oga-surf-project.workers.dev/ledger/3",
  "schema": "v0-plain"
}
```

### 6. OpenTimestamps に投入

```
PATH="$HOME/Library/Python/3.9/bin:$PATH" \
LEDGER_URL="https://hs-ledger.oga-surf-project.workers.dev" \
LEDGER_ADMIN_TOKEN="<LEDGER_ADMIN_TOKEN>" \
python3 ~/jidec/jidec_stamp.py
```

`[3] stamp rc=0 ...` と出れば OK。数時間後に Bitcoin に取り込まれる。

### 7. フェデリコに返信の追加コメント（任意）

entry #3 の URL が生きたら、LinkedIn の該当スレッドに補足コメントとして投稿できます：

> The script is up. GitHub raw and JIDEC entry #3 both anchor the same bytes:
> https://hs-ledger.oga-surf-project.workers.dev/ledger/3
> https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-ledger/scripts/verify_finding_v0.py
>
> Reproduces the deployed canary's expected hash (C025E288675EE898) and shows the coverage table. Python 3, stdlib only, no network. If your team runs it and gets a different result, that itself is a real finding — please post it.

## 検証チェーン全体像

- entry #1: 概念実証（PTKA デモ、v0 スキーマ）
- entry #2: v1 スキーマ SPEC + 欠陥の宣言（誰から指摘があったかを含む）
- entry #3: SPEC の finding を独立に再現するスクリプト、そのバイト SHA を Bitcoin に固定

これで「主張 → 主張を裏付ける SPEC → SPEC の主張を再現する実行可能証拠」が三段階すべて on-chain になる。Federico が指摘した "the one link still resting on trust" が塞がる。
