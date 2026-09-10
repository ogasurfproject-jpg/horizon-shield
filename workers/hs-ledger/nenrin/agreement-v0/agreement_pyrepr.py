#!/usr/bin/env python3
"""python の repr() が値をどう書くか。断りの文面はこれで値を差し込んどる。

なぜこれが要るか (2026-09-10)。

agreement_verify.py の断り文の多くが "found %r" で値を差し込む。%r は repr() や。
repr は JSON の書き方と違う: None は None、True は True、文字列は単引用符、
中に単引用符があったら二重引用符に変わる、印字できん文字は \\x や \\u に逃げる。
JSON の書き方で代用したら null / true / "..." になって、5,000 件が 1 文字ずれる。

母集団は測ってある。5,221 件の記録に現れる値は 260 種類しか無い (str 191,354 個、
int 64,603 個あっても、別々の値は 260)。せやからこの表は網羅に近い。それに加えて、
将来のために合成した広がり (符号位置、引用符、逆斜線、入れ子) も入れてある。

  python3 agreement_pyrepr.py            # 表を作り直す
  python3 agreement_pyrepr.py --check    # ずれとらんか見るだけ
  python3 agreement_pyrepr.py --selftest # この道具自身の試験

出す物: agreement_pyrepr_v1.json
  cases: [[値を canonical ASCII の JSON で, repr の字], ...]
  値を JSON で持つ理由は、JS 側が同じ物を組み立てられるようにするためや。
"""
# RUN_ALL: suite --selftest
# RUN_ALL: suite --check
import base64
import hashlib
import json
import os
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "agreement_pyrepr_v1.json")
FIXTURE = os.path.join(HERE, "agreement_vectors_v1.json")


def canon(v):
    """表の鍵。ここは **並べ替えん**。repr の dict は挿入順で出るから、並べ替えて
    持ったら順が消えて、読み戻した repr が元と違う物になる。
    (2026-09-10、自己試験が {'b': 2, 'a': 1} と {'a': 1, 'b': 2} の食い違いで捕まえた。)"""
    return json.dumps(v, sort_keys=False, separators=(",", ":"), ensure_ascii=True)


def from_fixture():
    """契約に現れる値を全部。ここが本物の母集団や。"""
    with open(FIXTURE, encoding="utf-8") as f:
        env = json.load(f)
    doc = json.loads(zlib.decompress(base64.b64decode(env["payload"])).decode("utf-8", "surrogatepass"))
    out = []

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                out.append(k)
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
        else:
            out.append(o)

    for c in doc["cases"]:
        walk(c["input"]["record"])
    return out


def synthetic():
    """将来のための広がり。契約に無い形でも、規則がいつか触るかもしれん所。"""
    out = [None, True, False, 0, -1, 1, 2 ** 53, 2 ** 70, -(2 ** 70),
           0.0, -0.0, 1.0, 0.25, 1e16, 1e-7, float("inf"), float("-inf"), float("nan"),
           "", "x", "a b", "it's", 'say "hi"', "both ' and \"", "back\\slash",
           "\n", "\t", "\r", "\x00", "\x1f", "\x7f", "\x80", "\x9f", "\xa0",
           "日本語", "　", "​", "﻿", "\U0001F600", "\ud800", "\udfff",
           # 長いダッシュは値として要るが、生で書いたら家の掟に引っかかる。
           # agreement_redteam.py の見張りが自分自身を撃たんようにしとるのと同じ手。
           "-", "\u2014", "\u2013", "\u2212", "\u2015", "e" * 100,
           [], [1], [1, 2], ["a", None, True], [[1], [2]],
           {}, {"a": 1}, {"b": 2, "a": 1}, {"a": [1, {"c": None}]},
           ]
    for cp in list(range(0, 0x100)) + [0x2028, 0x2029, 0x2060, 0x3000, 0xFFFD, 0x10FFFF]:
        out.append(chr(cp))
        out.append("a" + chr(cp) + "b")
    return out


def collect():
    seen = set()
    cases = []
    for v in from_fixture() + synthetic():
        try:
            key = canon(v)
        except (ValueError, TypeError):
            continue
        if key in seen:
            continue
        seen.add(key)
        cases.append([key, repr(v)])
    cases.sort()
    return cases


def build():
    cases = collect()
    return {
        "name": "agreement-pyrepr-v1",
        "note": "python の repr() が値をどう書くか。断り文の %r はこれや。JS 側は 1 字も違うたらあかん。",
        "generated_by": "agreement_pyrepr.py",
        "from": "agreement_vectors_v1.json に現れる全ての値 + 合成した広がり",
        "count": len(cases),
        "cases": cases,
    }


# 表に入れてええのは答えだけ。どこで走らせたかは入れん。
# (2026-09-10、float と readback の表で python の版を書き込んで --check を赤くした。)
def dump(doc):
    return json.dumps(doc, ensure_ascii=True, indent=1, sort_keys=True) + "\n"


def show_diff(have, now, limit=20):
    import difflib
    d = list(difflib.unified_diff(have.split("\n"), now.split("\n"),
                                  "今 file にある物", "今 python が出す物", n=0, lineterm=""))
    print("   ずれとる行 %d 本" % len([l for l in d if l[:1] in "+-" and l[:3] not in ("---", "+++")]))
    for l in d[:limit]:
        print("    " + l[:160])
    print("   作り直すには: python3 %s" % os.path.basename(__file__))


def selftest():
    ok = ng = 0

    def t(name, cond, detail=""):
        nonlocal ok, ng
        if cond:
            ok += 1
            print("ok   " + name)
        else:
            ng += 1
            print("NG   " + name + ("  " + str(detail) if detail else ""))

    doc = build()
    cases = doc["cases"]
    t("空やない", len(cases) > 300, len(cases))
    t("count は数え直した数", doc["count"] == len(cases))
    t("同じ値を二度入れとらん", len({c[0] for c in cases}) == len(cases))

    MACHINE = ("python", "platform", "hostname", "user", "cwd", "generated_at", "timestamp", "host")
    t("機械ごとに変わる物を表に入れとらん", [k for k in doc if k.lower() in MACHINE] == [])
    t("走らせた python の版が字として混じっとらん", sys.version.split()[0] not in dump(doc))

    bad = None
    for key, want in cases:
        got = repr(json.loads(key))
        if got != want:
            bad = (key, want, got)
            break
    t("表の字は repr がその場で書いた物と同じ", bad is None, bad)

    m = {c[0]: c[1] for c in cases}
    for key, want in (("null", "None"), ("true", "True"), ("false", "False"),
                      ('"x"', "'x'"), ('""', "''"), ("-1", "-1"), ("[1,2]", "[1, 2]"),
                      ('"it\'s"', '"it\'s"'), ('"\\n"', "'\\n'"),
                      ('{"a":1}', "{'a': 1}"), ("1.0", "1.0"), ("0.25", "0.25")):
        t("repr(%s) は %s" % (key, want), m.get(key) == want, m.get(key))

    t("契約に出る値が入っとる", '"a2a-agreement-v1.1"' in m, "契約由来の値が見当たらん")

    a = dump(doc)
    d2 = json.loads(a)
    d2["cases"][0][1] = "壊した"
    t("--check はずれを見つける", dump(d2) != a)

    print("")
    print("=== %d / %d %s (agreement_pyrepr の自己試験) ===" % (ok, ok + ng, "不合格あり" if ng else "合格"))
    return 1 if ng else 0


def main():
    if "--selftest" in sys.argv:
        return selftest()
    doc = build()
    text = dump(doc)
    if "--check" in sys.argv:
        if not os.path.exists(OUT):
            print("★ 拒否: %s が無い。先に作れ。" % os.path.basename(OUT))
            return 2
        with open(OUT, encoding="utf-8") as f:
            have = f.read()
        if have != text:
            print("★ 拒否: %s が今の repr の書き方とずれとる。" % os.path.basename(OUT))
            show_diff(have, text)
            return 1
        print("一致: %s (%d 件)" % (os.path.basename(OUT), doc["count"]))
        return 0
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    print("書いた: %s" % os.path.basename(OUT))
    print("  値 %d 種" % doc["count"])
    print("  python %s (作った機械の版。表には残さん)" % sys.version.split()[0])
    print("  sha256 %s" % hashlib.sha256(text.encode("utf-8")).hexdigest())
    return 0


if __name__ == "__main__":
    sys.exit(main())
