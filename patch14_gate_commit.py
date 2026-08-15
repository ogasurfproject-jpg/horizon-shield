# -*- coding: utf-8 -*-
"""
第14弾パッチ (2026-08-15) — コミットの身元を、判定のハッシュの中に入れる

背景(今朝の実測):
  判定でコードを名指しするものは gate_version = "0.2.0" という手打ちの文字列だけだった。
  動かしても誰も気づけない。コミットの身元は判定と一緒に旅していないし、
  read 時に再解決されるのでもない。解決すべきものが存在しなかった。
  フェデリコの1ヶ月前からの質問が正しかった。ケーススタディ公開前に塞ぐと約束した。

このパッチがやること:
  1. gateCommit() を追加。デプロイ時に注入された env.GATE_COMMIT を読む。
     ★注入されずにデプロイされた場合は "unpinned: ..." が判定に載る。
       黙って空になるのではなく、ピンされていないことが見える。fail-visible。
  2. /check の判定・/self の判定・/spec・/health に gate_commit を追加。
     /check と /self では record_sha256 の計算より前に入る = ハッシュの中を旅する。
  3. デプロイ用スクリプト deploy_gate.sh を併設(このパッチとは別ファイル)。
     ワーカーのソースが未コミットならデプロイを拒否する。
     コミットに無いバイトを、そのコミットの名で本番に出さないため。

★手順が1つ変わる: 「コミットしてからデプロイ」になる。
  今までは パッチ→デプロイ→コミット だった。それだと注入される SHA は
  デプロイしたコードを含まない親コミットを指す。それはこの事業が狩っている種類の嘘だ。

前提: patch10, 11, 13 適用済み。

使い方:
  cd ~/Desktop/hs-docfix
  python3 patch14_gate_commit.py
  python3 patch14_gate_commit.py --apply
  node --check workers/hs-verify-gate/src/worker.js
  (その後: git commit → bash workers/hs-verify-gate/deploy_gate.sh)
"""
import sys, os, io, hashlib

W = "workers/hs-verify-gate/src/worker.js"

# ---- 1. gateCommit() を probeVia の直後に ----
F1 = '''async function probeFetch(url, init) {
'''
R1 = '''// デプロイ時に deploy_gate.sh が --var GATE_COMMIT:<sha> で注入する。
// 注入なしでデプロイされたら、判定には "unpinned" が載る。空白ではなく名指しで。
// コミットSHAは内容アドレスであり、この値が record_sha256 の中を旅することで
// 「どのバイト列のコードがこの判定を出したか」が判定自身に固定される。
function gateCommit() {
  return (GATE_ENV && GATE_ENV.GATE_COMMIT)
    ? String(GATE_ENV.GATE_COMMIT)
    : "unpinned: this deployment did not inject a commit (deploy_gate.sh not used)";
}

async function probeFetch(url, init) {
'''

# ---- 2. /check の判定 ----
F2 = '''  const record = {
    gate: "Yakumo Verification Gate",
    gate_version: CONFIG.version,
    endpoint: endpoint,
    checked_at: started,
'''
R2 = '''  const record = {
    gate: "Yakumo Verification Gate",
    gate_version: CONFIG.version,
    gate_commit: gateCommit(),
    endpoint: endpoint,
    checked_at: started,
'''

# ---- 3. /self の判定 ----
F3 = '''  const record = {
    gate: "Yakumo Verification Gate",
    gate_version: CONFIG.version,
    subject: "the gate itself",
'''
R3 = '''  const record = {
    gate: "Yakumo Verification Gate",
    gate_version: CONFIG.version,
    gate_commit: gateCommit(),
    subject: "the gate itself",
'''

# ---- 4. /spec ----
F4 = '''function spec() {
  return {
    gate: "Yakumo Verification Gate",
    version: CONFIG.version,
'''
R4 = '''function spec() {
  return {
    gate: "Yakumo Verification Gate",
    version: CONFIG.version,
    gate_commit: gateCommit(),
'''

# ---- 5. /health ----
F5 = '''    if (path === "/health") return json({ ok: true, gate_version: CONFIG.version });
'''
R5 = '''    if (path === "/health") return json({ ok: true, gate_version: CONFIG.version, gate_commit: gateCommit() });
'''


def main():
    apply = "--apply" in sys.argv
    if not os.path.exists(W):
        print("NG: %s が無い。" % W)
        sys.exit(1)
    src = io.open(W, encoding="utf-8").read()
    print("対象  : %s" % W)
    print("変更前: sha256 %s  (%d bytes)" % (hashlib.sha256(src.encode()).hexdigest(), len(src.encode())))
    print("モード: %s" % ("APPLY(本番)" if apply else "dry-run(何も書かない)"))
    print("-" * 74)

    pairs = [(F1, R1), (F2, R2), (F3, R3), (F4, R4), (F5, R5)]
    ok_all = True
    for i, (f, _r) in enumerate(pairs, 1):
        n = src.count(f)
        ok = (n == 1)
        ok_all = ok_all and ok
        print("  %s アンカー%d                     期待1 / 実際%d" % ("OK " if ok else "NG ", i, n))
    pre = [
        ("patch13 まで入っている",   "surfaceHashes" in src and "gate_side: true" in src),
        ("まだ適用されていない",     "gate_commit" not in src),
    ]
    for label, ok in pre:
        print("  %s %s" % ("OK " if ok else "NG ", label))
        ok_all = ok_all and ok
    if not ok_all:
        print("★ 前提が違う。1バイトも書かずに終了する。")
        sys.exit(1)

    out = src
    for f, r in pairs:
        out = out.replace(f, r, 1)

    checks = [
        ("gateCommit の定義が1回",              out.count("function gateCommit()") == 1),
        ("★未注入は unpinned を名乗る",         "unpinned: this deployment did not inject a commit" in out),
        ("判定2箇所 + spec + health = 4箇所",   out.count("gate_commit: gateCommit()") == 4),
        ("★/check ではハッシュ計算より前",
             out.find('gate_commit: gateCommit(),\n    endpoint: endpoint') < out.find('record.record_sha256 = await sha256hex(canonical)')),
        ("GATE_ENV を使う(新しい仕組みを作らない)", "GATE_ENV && GATE_ENV.GATE_COMMIT" in out),
        ("既存4ツール無傷",                     out.count('name: "lookup_server"') == 1),
        ("surface 系は無傷",                    out.count("surfaceHashes") == src.count("surfaceHashes")),
        ("gate_side 系は無傷",                  out.count("gate_side: true, measured: false") == src.count("gate_side: true, measured: false")),
        ("波括弧の収支が合う",                  out.count("{") - out.count("}") == src.count("{") - src.count("}")),
        ("丸括弧の収支が合う",                  out.count("(") - out.count(")") == src.count("(") - src.count(")")),
    ]
    for c, ok in checks:
        print("  %s %s" % ("OK " if ok else "NG ", c))
    if any(not ok for _c, ok in checks):
        print("★ 検算に失敗。書かずに終了する。")
        sys.exit(1)

    print("-" * 74)
    print("変更後: sha256 %s  (%d bytes)" % (hashlib.sha256(out.encode()).hexdigest(), len(out.encode())))
    if not apply:
        print("")
        print("[dry-run] 書いていない。本番は --apply を付けろ。")
        sys.exit(0)

    io.open(W, "w", encoding="utf-8").write(out)
    print("")
    print("書いた。次: node --check %s" % W)
    print("その後は必ず: git commit → bash workers/hs-verify-gate/deploy_gate.sh")
    print("(コミットしてからデプロイ。SHAがデプロイしたコードを含むコミットを指すため)")


if __name__ == "__main__":
    main()
