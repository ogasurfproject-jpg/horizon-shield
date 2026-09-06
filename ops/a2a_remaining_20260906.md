# A2A 第三波の残り、全部やる手順(2026-09-06 昼、TOshi の手)

番人は設計と検証。鍵・push・deploy・secret・台帳 append・PR は TOshi の手。上から順に、1 つ終わるごとに「期待」と見比べる。合わなければ止まって端末の出力を貼る。

順番の理由: 1(publish)は他と独立。2(錨)は seed が既にディスクにある = claim register の C09 が「seed があるのに台帳に無い」と今この瞬間 FAIL しとるので、早く打つか、打たんなら seed を退避するかの二択。3(w3id)と 4(in-toto)は錨と無関係。5(commit)は全部の後で 1 回。

## 0. 前提(30 秒)

```
cd ~/horizon-shield && git pull --rebase --autostash origin main && git status --short | grep -v '^??'; ls -la ~/.hs_card_key.pem; python3 -c "import cryptography; print('cryptography', cryptography.__version__)"
```

期待: `M HORIZON_SHIELD_引き継ぎ_20260906_A2A第二波_v37追記.md` だけ(他の M が出たら論文チャットの作業中、触らん)。鍵は `-rw-------` で 241 bytes。cryptography の版が出る。`ModuleNotFoundError` なら:

```
python3 -m pip install --user cryptography
```

(4 節の in-toto だけが使う。card 署名は node 側、これには要らん。)

## 1. MCP registry publish(C16)

ブラウザ: github.com/ogasurfproject-jpg/horizon-shield → Actions → 左の一覧で「MCP registry publish」→ 右上「Run workflow」→ Branch: main → server_dir に `workers/hs-verify-gate` と入れる(既定値は hs-jidec-mcp なので必ず書き換える)→ 緑の「Run workflow」。1 分ほどで緑。

終わったら端末:

```
cd ~/horizon-shield && python3 ops/claim_register.py 2>&1 | grep -E '^\| C|FAIL|claims'
```

期待: C03 PASS(`v0.3.4 scores 82 of 82`)、C16 PASS(`source 0.3.4, live 0.3.4`)。C14(TWZRD 未測定)は既知。**C09 は 2 節を終えるまで FAIL のまま**(文言: `seed_entry_conduct_ext_v1.json: seed exists but is not in the ledger (never appended?)` と `anchored bytes ... no longer exist locally`。2 つ目は仕様の .md が workers/hs-verify-gate/ext に居て C09 の探索範囲(workers/hs-ledger と ~/jidec の claim_N.txt)の外にあるから。append + stamp で claim_N.txt が workers/hs-ledger に落ちた瞬間、両方消える)。

publish が赤なら: ログの最後 20 行を貼る。よくあるのは server.json の version が registry の既存版と同じ(今回は 0.3.1 → 0.3.4 なので出んはず)。

## 2. 仕様の錨(seed commit → append → stamp)

**打った後は 1 バイトも直せん。** #2211 で maintainer が本文の直しを求めたら v1.1(同じ URI、新しい sha)で応える。それは仕様 10 節に書いてある。錨を待つなら 2 節を丸ごと飛ばし、seed は `git add` せず置いとく(C09 は FAIL のまま出続ける、それが正しい表示)。番人の線: 今打つ。「9 月 6 日に v1 が何を言うとったか」が固定される方が、後の議論の座標になる。

### 2a. 本番の sha と seed の claim が同じか(必ず先に)

```
curl -s https://gate.horizonshield.dev/ext/conduct/v1 | python3 -c "import json,sys; print('live ', json.load(sys.stdin)['spec_markdown_sha256'])"; python3 -c "import json; print('seed ', json.load(open('/Users/oogatoshikatsu/horizon-shield/workers/hs-ledger/seed_entry_conduct_ext_v1.json'))['claim_sha256'])"
```

期待: 2 行とも `3aa5a50d8ac323c63951bdf4b73d6fa1de6a45aa0d0a41dced4792d5f6dfafd8`。違ったら止まる(本番と seed がズレとる、打たん)。

### 2b. seed を commit(錨の対象が repo に残る)

```
cd ~/horizon-shield && git add workers/hs-ledger/seed_entry_conduct_ext_v1.json && git commit -m "seed: A2A Conduct Extension v1 spec anchor (sha 3aa5a50d)" && git push
```

### 2c. append と stamp(token は隠し入力、画面に出ん)

```
zsh ~/horizon-shield/workers/hs-ledger/append_witness.sh seed_entry_conduct_ext_v1.json
```

`Paste LEDGER_ADMIN_TOKEN now (hidden)` と出たら iCloud メモの LEDGER_ADMIN_TOKEN(64 字)を貼って Enter。**貼る前にクリップボードが token か確かめる**(前に命令文が入っとった事故が 2 回)。長さが 64 でなければスクリプトが何も送らずに止まる。

期待の出力(順に):

```
{ "n": <番号>, "url": "https://ledger.horizonshield.dev/ledger/<番号>", "schema": ... }
pending entries: 1
[<番号>] stamp rc=0 ...
done.
```

`append failed, not stamping.` と出たら台帳の応答(直前の JSON)を貼る。stamp が `rc=0` 以外でも、GitHub Actions「JIDEC stamp」が毎時 17 分に pending を拾うので錨は打たれる。ただしその場合 claim_N.txt がローカルに落ちんので C09 は次の手動 stamp まで FAIL(`python3 ~/jidec/jidec_stamp.py` を workers/hs-ledger で回せば落ちる)。

### 2d. 確認

```
cd ~/horizon-shield && python3 ops/claim_register.py 2>&1 | grep -E '^\| C09|^\| C03|^\| C16|claims'
```

期待: C09 PASS(`N document seeds checked; all present locally and in the ledger`、N は前回より 1 多い)。Bitcoin 確定は 1〜2 時間後(C08 は 7 日の猶予を見とる)。

番号が出たら番人に貼る: 引き継ぎ・memory・#2211 の追記(「spec bytes are anchored: ledger entry N」)に使う。#2211 への追記は番人が文を書く、貼るのは TOshi。

## 3. w3id の PR(TOshi の GitHub、ブラウザ 5 分)

内容は `ops/w3id/README.md` の写し。中身は 2 ファイルだけ。

1. https://github.com/perma-id/w3id.org を開く → 右上「Fork」→ 自分のアカウントに fork(既に fork があればそれを使う。古ければ fork の「Sync fork」を先に)。
2. fork の中で「Add file」→「Create new file」。ファイル名の欄に `horizonshield/README.md` と入れる(スラッシュを打つと自動でフォルダになる)。本文:

```
# horizonshield

Permanent identifiers for HORIZON SHIELD specifications (The HORIZ音s株式会社, Hiratsuka, Japan).

- https://w3id.org/horizonshield/conduct/v1 redirects to https://gate.horizonshield.dev/ext/conduct/v1
  (A2A Conduct Extension v1; the target serves JSON by default and the specification text with Accept: text/markdown)

Contact: ogasurfproject@gmail.com  (GitHub: ogasurfproject-jpg)
```

「Commit changes」→ commit message は `Add horizonshield/ (A2A Conduct Extension v1 redirect)`。
3. もう一度「Add file」→「Create new file」→ ファイル名 `horizonshield/.htaccess`。本文:

```
Options +FollowSymLinks
RewriteEngine on

# A2A Conduct Extension v1. The identifier compared by implementations is the target URI; this is a convenience redirect.
RewriteRule ^conduct/v1/?$ https://gate.horizonshield.dev/ext/conduct/v1 [R=302,L]
RewriteRule ^conduct/?$ https://gate.horizonshield.dev/ext/conduct/v1 [R=302,L]
```

commit。
4. fork のトップに「This branch is 2 commits ahead」と出る →「Contribute」→「Open pull request」。
   - Title: `Add horizonshield/ (A2A Conduct Extension v1)`
   - Body(2 文、これ以上書かん。w3id の人は .htaccess しか見ん):

```
Adds horizonshield/ with a redirect for the A2A Conduct Extension v1 specification (https://w3id.org/horizonshield/conduct/v1 to https://gate.horizonshield.dev/ext/conduct/v1). Owner: ogasurfproject-jpg.
```

   - 「Create pull request」。
5. PR の URL を番人に貼る。merge は数日。merge されたら `curl -sI https://w3id.org/horizonshield/conduct/v1 | head -3` で `302` と `location: https://gate.horizonshield.dev/ext/conduct/v1` が見える。仕様の文は変えん(7 節の「MAY later redirect here」が現物になるだけ)。

gh CLI が Mac にあるなら(`which gh` で出るなら)fork と PR は `gh repo fork perma-id/w3id.org --clone` からでもできるが、ブラウザの方が事故が少ない。

## 4. in-toto(8 月の 8 輪、mcp-conduct-register、5 分)

鍵は card 署名と同じ `~/.hs_card_key.pem`(kid hs-2026-09)。DSSE の署名は ES256 の raw r||s、card の JWS と同じ形。

### 4a. 8 輪に DSSE を添える + 公開鍵を rings/jwks.json に

```
cd ~/mcp-conduct-register && git pull --rebase --autostash origin main && for f in rings/*/2026-08.json; do python3 ~/horizon-shield/workers/hs-ledger/nenrin/ring-v1/ring_to_intoto.py "$f" --key ~/.hs_card_key.pem --kid hs-2026-09 --out "${f%.json}.intoto.dsse.json"; done && python3 ~/horizon-shield/workers/hs-ledger/nenrin/ring-v1/ring_to_intoto.py rings/mcp-horizonshield-dev-mcp/2026-08.json --key ~/.hs_card_key.pem --kid hs-2026-09 --jwk-out rings/jwks.json --out /dev/null && ls rings/*/2026-08.intoto.dsse.json | wc -l
```

期待: 8 行の `<sha256>  rings/<slug>/2026-08.json  ->  rings/<slug>/2026-08.intoto.dsse.json`、次に jwks 用の 1 行(`->  /dev/null`)、最後に `8`。(番人は VM で使い捨て鍵と mcp 輪 1 本の写しで同じ列を回して確かめた。repo には何も書いとらん。)

### 4b. 検証(鍵不要、公開鍵だけ)、2 通り

```
cd ~/mcp-conduct-register && for f in rings/*/2026-08.intoto.dsse.json; do python3 ~/horizon-shield/workers/hs-ledger/nenrin/ring-v1/ring_to_intoto.py --verify "$f" --jwk rings/jwks.json | grep -c '"verified": true'; done | sort | uniq -c
```

期待: `8 1`(8 本とも verified true が 1 回)。

rings/jwks.json が本番の card 用 JWKS と同じ鍵か(同じ鍵で署名しとる証拠):

```
curl -s https://mcp.horizonshield.dev/.well-known/jwks.json | python3 -c "import json,sys; k=json.load(sys.stdin)['keys'][0]; print('served', k['kid'], k['x'][:16], k['y'][:16])"; python3 -c "import json; k=json.load(open('/Users/oogatoshikatsu/mcp-conduct-register/rings/jwks.json'))['keys'][0]; print('rings ', k['kid'], k['x'][:16], k['y'][:16])"
```

期待: 2 行の kid と x, y の先頭が一致。

### 4c. README に 1 段落(Rings 節、生成器の外なので日次 rebuild で消えん)

```
cd ~/mcp-conduct-register && python3 - <<'EOF'
import io
p = "README.md"; s = io.open(p, encoding="utf-8").read()
anchor = "### Independent recompute (record)"
line = ("Each August ring also carries an in-toto Statement v1 in a DSSE envelope beside it (`rings/<slug>/2026-08.intoto.dsse.json`): "
        "subject = the ring file's sha256, predicateType = `https://gate.horizonshield.dev/ext/conduct/v1`, predicate = the ring's counts copied, never recomputed. "
        "Signed ES256 with the same key that signs the agent cards (kid `hs-2026-09`, public key in `rings/jwks.json` and at every worker's `/.well-known/jwks.json`). "
        "Verify without the private key: `python3 ring_to_intoto.py --verify rings/<slug>/2026-08.intoto.dsse.json --jwk rings/jwks.json` "
        "(the tool lives in horizon-shield, `workers/hs-ledger/nenrin/ring-v1/`). The envelope adds a second door into the same bytes; the ring file stays the unit of record.\n\n")
if "2026-08.intoto.dsse.json" in s: raise SystemExit("README already has the in-toto paragraph, nothing written")
if s.count(anchor) != 1: raise SystemExit("anchor heading not found exactly once, nothing written")
io.open(p, "w", encoding="utf-8").write(s.replace(anchor, line + anchor))
print("README: in-toto paragraph inserted before", repr(anchor))
EOF
```

### 4d. commit と push

```
cd ~/mcp-conduct-register && git add rings/*/2026-08.intoto.dsse.json rings/jwks.json README.md && git commit -m "rings: in-toto Statement v1 + DSSE (ES256, kid hs-2026-09) beside each August ring; public key in rings/jwks.json; README paragraph" && git push
```

期待: 10 files changed(8 dsse + jwks + README)。

## 5. horizon-shield の commit(全部の後で 1 回)

```
cd ~/horizon-shield && git add HORIZON_SHIELD_引き継ぎ_20260906_A2A第二波_v37追記.md ops/a2a_remaining_20260906.md ops/claim_register_report.md && git commit -m "handoff v37: wave 3 deployed, signed cards live, remaining steps runbook; claim register report" && git push
```

`ops/claim_register_report.md` が無い(1 節を飛ばした)なら、その名前を外して打つ。`Claude outputs/` と他の `??` は触らん(論文チャットの物か置き場)。

## 6. 鍵マネージャと 1 行ずつの確認

- 鍵マネージャ 13:30 版(番人が添付)を今の版と入れ替える。新しい行は「台帳・運用トークン」の「A2A card 署名鍵 hs-2026-09(EC P-256、ES256)」。値の欄は空のまま(鍵はファイル `~/.hs_card_key.pem`、貼る値は無い)。
- `~/.hs_card_key.pem` がバックアップ(Time Machine か iCloud の手元の写し)に入っとるか。**無くしたら**: 5 worker の card 署名を新しい鍵で打ち直し(sign.mjs × 5、deploy × 5)、kid を hs-2026-10 などに変える、旧 kid の署名は検証不能になる。**漏れたら**: 同じ手順 + JWKS から旧鍵を外す。どちらも card の「判定」は変わらん(署名は detail)。
- LinkedIn の Federico 宛て compose box に v2 の下書きが残っとらんか(11:41 に送信済み、二重送信の防止)。
- Smithery の Discord 投稿は出したか、出しとらんか(番人は状態を知らん。出しとらんなら次の波で文を書く)。

## 7. 終わったら番人に貼る物

台帳の `n`、w3id PR の URL、in-toto の `8 1`、claim register の FAIL 数。番人がそれで引き継ぎ・memory・#2211 追記(文)を更新する。
