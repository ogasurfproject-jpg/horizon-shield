#!/usr/bin/env python3
"""Python が float をどう書くか、その答えを表にして固める。

なぜこれが要るか (2026-09-10)。

agreement_canonical_test.mjs の 20.4 MB 往復は強い。せやけど、あの payload に
入っとる float は 0.25 と 1.5 と 10000.5 の 3 種類だけや。Python と JavaScript が
float の書き方で食い違うのは、そこやない。1e16 の前後、1e-4 の前後、整数に見える
float、非正規化数、そこで割れる。往復では一生当たらん。

せやから、当たらん所を先に当てにいく。この道具が Python 側の答えを出す。JS 側は
その答えと 1 バイトも違わんことを要求される。表は「書いた」んやのうて「Python に
書かせた」もんや。ここが肝で、思い出しで打った表は証拠やない、主張や。

  python3 agreement_float_repr.py            # 表を作り直す
  python3 agreement_float_repr.py --check    # ずれとらんか見るだけ (CI 用)
  python3 agreement_float_repr.py --selftest # この道具自身の試験

出す物: agreement_float_repr_v1.json
  cases: [[bits を 16 桁の 16 進で, json.dumps(その float)], ...] bits の昇順。
  bits で持つ理由は、10 進の文字列で持つと「その文字列を読んだら同じ double に
  なる」を暗に仮定してまう。仮定を一つ減らす。
"""
# RUN_ALL: suite --selftest
# RUN_ALL: suite --check
import json
import math
import struct
import sys
import os
import hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "agreement_float_repr_v1.json")


def bits_of(x):
    return struct.unpack(">Q", struct.pack(">d", x))[0]


def float_of(b):
    return struct.unpack(">d", struct.pack(">Q", b))[0]


def _nextafter(x, y):
    # math.nextafter は 3.9 から。無い場合に備えて bit 単位で歩く。
    if hasattr(math, "nextafter"):
        return math.nextafter(x, y)
    b = bits_of(x)
    if x == 0.0:
        return float_of(1 if y > 0 else (1 << 63) | 1)
    up = (y > x) == (x > 0)
    return float_of(b + 1 if up else b - 1)


def collect():
    """試す double を集める。決まった手順だけ。乱数は種を固定した bit 列。"""
    out = set()

    def add(x):
        try:
            f = float(x)
        except (OverflowError, ValueError):
            return
        out.add(bits_of(f))

    # 1. 10 の冪。指数形式に切り替わる境目 (decpt <= -4 と decpt > 16) を跨ぐ。
    for k in range(-330, 309):
        try:
            v = float("1e%d" % k)
        except (OverflowError, ValueError):
            continue
        if math.isinf(v):
            continue
        add(v)
        add(_nextafter(v, math.inf))
        add(_nextafter(v, -math.inf))
        add(-v)
        add(v * 2.5)
        add(v * 1.5)
        add(v * 9.0)

    # 2. 整数に見える float。JS は "1"、Python は "1.0" と書く所。
    for n in range(0, 1025):
        add(float(n))
        add(-float(n))
    for k in range(0, 1024):
        try:
            add(float(2 ** k))
        except OverflowError:
            pass
    for n in (2 ** 53 - 1, 2 ** 53, 2 ** 53 + 2, 2 ** 63, 2 ** 64, 2 ** 70,
              10 ** 15, 10 ** 16, 10 ** 17, 2 * 10 ** 16 + 8):
        add(float(n))
        add(-float(n))

    # 3. 短い小数。桁の落とし方がずれる所。
    for n in range(1, 1001):
        add(n / 10.0)
        add(n / 100.0)
        add(n / 1000.0)
        add(n / 3.0)
        add(n / 7.0)

    # 4. 非正規化数と両端。
    tiny = 5e-324
    add(tiny)
    add(-tiny)
    x = tiny
    for _ in range(64):
        x = _nextafter(x, math.inf)
        add(x)
    add(sys.float_info.min)
    add(_nextafter(sys.float_info.min, -math.inf))
    add(sys.float_info.max)
    add(_nextafter(sys.float_info.max, -math.inf))
    add(sys.float_info.epsilon)
    add(0.0)
    add(-0.0)

    # 5. 種を固定した bit 列。思い付きでは行かん所に落ちる。
    seed = b"agreement-v1 float repr 2026-09-10"
    h = hashlib.sha256(seed).digest()
    n = 0
    while n < 6000:
        h = hashlib.sha256(h).digest()
        for i in range(0, 32, 8):
            b = struct.unpack(">Q", h[i:i + 8])[0]
            f = float_of(b)
            if math.isinf(f) or math.isnan(f):
                continue
            out.add(bits_of(f))
            n += 1

    # 6. json.dumps だけが持つ 3 語。repr と同じやが、書くのは json.dumps や。
    out.add(bits_of(float("inf")))
    out.add(bits_of(float("-inf")))
    out.add(bits_of(float("nan")))

    return sorted(out)


def build():
    cases = []
    for b in collect():
        f = float_of(b)
        cases.append(["%016x" % b, json.dumps(f)])
    return {
        "name": "agreement-float-repr-v1",
        "note": "python json.dumps が double をどう書くか。JS 側はこれと 1 バイトも違うたらあかん。",
        "generated_by": "agreement_float_repr.py",
        "count": len(cases),
        "cases": cases,
    }


# 表に入れてええのは「答え」だけで、「どこで走らせたか」は入れたらあかん。
# 2026-09-10: ここに python の版を書き込んどった。作った機械 (3.10.12) と TOshi の
# Mac の python3 は版が違う。中身は 1 件も違わんのに --check が赤くなり、run_all が
# commit を止めた。止まったこと自体は正しい。悪いんは、変わってええ物を契約に
# 混ぜたこの表の作りの方や。版は作るときに画面へ出すだけにして、file には残さん。
def dump(doc):
    return json.dumps(doc, ensure_ascii=False, indent=1, sort_keys=True) + "\n"



def show_diff(have, now, limit=20):
    """何がずれとるかを見せる。「作り直せ」だけやと、直す人は当てもんをする羽目になる。
    2026-09-10、実際にそうなった。ずれとったんは答えやのうて python の版の刻印で、
    それが分かるまで丸ごと作り直すか中身を疑うかの二択やった。二択にせんこと。"""
    import difflib
    d = [l for l in difflib.unified_diff(have.split("\n"), now.split("\n"),
                                         "今 file にある物", "今 python が出す物",
                                         n=0, lineterm="")]
    body = [l for l in d if l[:1] in "+-" and l[:3] not in ("---", "+++")]
    print("   ずれとる行 %d 本 (file %d 行 / 今 %d 行)"
          % (len(body), have.count("\n"), now.count("\n")))
    for l in d[:limit]:
        print("    " + l[:160])
    if len(d) > limit:
        print("    ... 他 %d 行" % (len(d) - limit))
    print("   答えがずれとるなら直す。刻印や体裁だけなら、それは表に入れたらあかん物や。")
    print("   作り直すには: python3 %s" % os.path.basename(__file__))

def selftest():
    ok = 0
    ng = 0

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
    t("空やない", len(cases) > 5000, len(cases))

    # 機械ごとに変わる物が表に混じっとらんか。混ぜたら、中身が同じでも --check が
    # 赤くなって、直す人は無いはずの defect を探しに行く。2026-09-10 に実際に起きた。
    MACHINE = ("python", "platform", "hostname", "user", "cwd", "path",
               "generated_at", "built_at", "timestamp", "date", "host", "machine")
    leaked = [k for k in doc if k.lower() in MACHINE]
    t("機械ごとに変わる物を表に入れとらん", leaked == [], leaked)
    blob = dump(doc)
    t("走らせた python の版が字として混じっとらん",
      sys.version.split()[0] not in blob, sys.version.split()[0])

    t("count は数え直した数", doc["count"] == len(cases))

    seen = set()
    dup = None
    for b, _ in cases:
        if b in seen:
            dup = b
            break
        seen.add(b)
    t("bits に重複が無い", dup is None, dup)

    t("bits は昇順", all(int(cases[i][0], 16) < int(cases[i + 1][0], 16)
                        for i in range(len(cases) - 1)))

    bad = None
    for b, s in cases:
        f = float_of(int(b, 16))
        if "%016x" % bits_of(f) != b:
            bad = b
            break
    t("bits から double に戻して、また bits にして、同じ", bad is None, bad)

    bad = None
    for b, s in cases:
        f = float_of(int(b, 16))
        if s != json.dumps(f):
            bad = (b, s)
            break
    t("表の字は json.dumps がその場で書いた物と同じ", bad is None, bad)

    # 往復しない 3 語を除いて、字を読み戻したら同じ double になる
    bad = None
    for b, s in cases:
        if s in ("NaN", "Infinity", "-Infinity"):
            continue
        if "%016x" % bits_of(float(s)) != b:
            bad = (b, s)
            break
    t("字を読み戻したら元の double (NaN と無限を除く)", bad is None, bad)

    got = {s for _, s in cases}
    for want in ("1.0", "100.0", "1000000000000000.0", "1e+16", "1e+17",
                 "1e-05", "1e-07", "-0.0", "0.0001", "0.25", "1.5",
                 "5e-324", "NaN", "Infinity", "-Infinity"):
        t("表に " + want + " が居る", want in got)

    # 境目そのもの
    t("1e15 は固定形", json.dumps(1e15) == "1000000000000000.0")
    t("1e16 は指数形", json.dumps(1e16) == "1e+16")
    t("1e-4 は固定形", json.dumps(1e-4) == "0.0001")
    t("1e-5 は指数形", json.dumps(1e-5) == "1e-05")
    t("指数は 2 桁に揃う", json.dumps(1e-7) == "1e-07" and json.dumps(1e21) == "1e+21")

    # --check がずれを見つけられる
    a = dump(doc)
    d2 = json.loads(a)
    d2["cases"][0][1] = "999.0"
    t("--check はずれを見つける", dump(d2) != a)

    print("")
    print("=== %d / %d %s (agreement_float_repr の自己試験) ===" %
          (ok, ok + ng, "不合格あり" if ng else "合格"))
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
        with open(OUT, "r", encoding="utf-8") as f:
            have = f.read()
        if have != text:
            print("★ 拒否: %s が今の Python の書き方とずれとる。" % os.path.basename(OUT))
            show_diff(have, text)
            return 1
        print("一致: %s (%d 件)" % (os.path.basename(OUT), doc["count"]))
        return 0
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    print("書いた: %s" % os.path.basename(OUT))
    print("  double %d 個" % doc["count"])
    print("  Python %s (作った機械の版。表には残さん)" % sys.version.split()[0])
    print("  sha256 %s" % hashlib.sha256(text.encode("utf-8")).hexdigest())
    return 0


if __name__ == "__main__":
    sys.exit(main())
