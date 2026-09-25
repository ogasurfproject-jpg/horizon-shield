#!/usr/bin/env python3
# ext/*.md を src/worker.js の埋め込み定数に埋め直す。
# 0.4.3 で追加(CONDUCT_EXT_MD)。0.4.15 で LEGAL_ENTITY_EXT_MD を足し、組を並べる形にした。
# 埋め込みは今まで手で書いとった = 二つが黙ってズレる余地があった(実際 2026-09-25 に、埋め込みだけ
# 11.6.1 から 11.6.3 を足して md が古いまま残っとった。md から埋め直すと公開中の仕様が退行する所やった)。
# 走らせると: worker.js の該当 1 行ずつを書き換え、書き戻した中身の sha256 が md ファイルの sha256 と
# 一致することを読み戻して確かめる。検査は全部、書く前に済ます。合わんかったら書かずに落ちる(fail closed)。
# test/ext_md_sync.test.mjs が「埋め込み == md」を毎回縛るので、どっちか片方だけ直すと suite が赤になる。
import hashlib, io, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
JS = os.path.join(HERE, "src", "worker.js")
PAIRS = [
    ("CONDUCT_EXT_v1.md", "const CONDUCT_EXT_MD = "),
    ("LEGAL_ENTITY_EXT_v1.md", "const LEGAL_ENTITY_EXT_MD = "),
]
BAD = "\u2014\u2013\u2015\u2012\u2212"  # em / en / horizontal bar / figure dash / minus。見張りが掟を破らんよう、字は書かずに符号で持つ

src = io.open(JS, encoding="utf-8").read()
lines = src.split("\n")
plan = []
for name, mark in PAIRS:
    md = io.open(os.path.join(HERE, "ext", name), encoding="utf-8").read()
    for bad in BAD:
        if bad in md:
            sys.exit("refusing: %s carries a forbidden dash %r" % (name, bad))
    hits = [i for i, l in enumerate(lines) if l.startswith(mark)]
    if len(hits) != 1:
        sys.exit("refusing: expected exactly one %s line, found %d" % (mark.strip(), len(hits)))
    before = lines[hits[0]]
    lines[hits[0]] = mark + json.dumps(md, ensure_ascii=False) + ";"
    plan.append((name, mark, hits[0], hashlib.sha256(md.encode("utf-8")).hexdigest(), len(md.encode("utf-8")), before != lines[hits[0]]))
io.open(JS, "w", encoding="utf-8").write("\n".join(lines))

back = io.open(JS, encoding="utf-8").read().split("\n")
for name, mark, i, sha, n, changed in plan:
    again = json.loads(back[i][len(mark):-1])
    if hashlib.sha256(again.encode("utf-8")).hexdigest() != sha:
        sys.exit("refusing: the embedded copy of %s does not hash to the markdown" % name)
    print("%-24s %6d bytes  sha256 %s  %s" % (name, n, sha, "rewritten" if changed else "unchanged"))
