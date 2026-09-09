#!/usr/bin/env python3
# ext/CONDUCT_EXT_v1.md を src/worker.js の CONDUCT_EXT_MD に埋め直す。
# 0.4.3 で追加。埋め込みは今まで手で書いとった = 二つが黙ってズレる余地があった。
# 走らせると: worker.js の 1 行を書き換え、書き戻した中身の sha256 が md ファイルの sha256 と
# 一致することを読み戻して確かめる。合わんかったら書かずに落ちる(fail closed)。
import hashlib, io, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
MD = os.path.join(HERE, "ext", "CONDUCT_EXT_v1.md")
JS = os.path.join(HERE, "src", "worker.js")
MARK = "const CONDUCT_EXT_MD = "

md = io.open(MD, encoding="utf-8").read()
for bad in "\u2014\u2013\u2015\u2012\u2212":  # em / en / horizontal bar / figure dash / minus。この掟の見張りが掟を破らんよう、字は書かずに符号で持つ
    if bad in md:
        sys.exit("refusing: the markdown carries a forbidden dash " + repr(bad))
md_sha = hashlib.sha256(md.encode("utf-8")).hexdigest()

src = io.open(JS, encoding="utf-8").read()
lines = src.split("\n")
hits = [i for i, l in enumerate(lines) if l.startswith(MARK)]
if len(hits) != 1:
    sys.exit("refusing: expected exactly one CONDUCT_EXT_MD line, found %d" % len(hits))
lines[hits[0]] = MARK + json.dumps(md, ensure_ascii=False) + ";"
out = "\n".join(lines)
io.open(JS, "w", encoding="utf-8").write(out)

# 読み戻し検算: JS のリテラルを JSON として読み直して sha を突き合わせる。
back = io.open(JS, encoding="utf-8").read().split("\n")[hits[0]]
lit = back[len(MARK):-1]
again = json.loads(lit)
if hashlib.sha256(again.encode("utf-8")).hexdigest() != md_sha:
    sys.exit("refusing: the embedded copy does not hash to the markdown")
print("embedded  " + str(len(md.encode("utf-8"))) + " bytes")
print("sha256    " + md_sha)
