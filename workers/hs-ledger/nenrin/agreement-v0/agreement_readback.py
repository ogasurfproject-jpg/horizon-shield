#!/usr/bin/env python3
"""Python の読み口が、どの字をどう読み、どの字をどの名前で断るか。その表。

なぜこれが要るか (2026-09-10)。

canonical の往復 (20.4 MB) が証明するのは「正しい記録を、同じバイトに戻せる」だけ
や。証明せんのは「壊れた記録を、同じ名前で断る」方。そこがずれたら、二つの検証器
は同じ入力に別の報告書を出す。verdict が同じでも refusal の名前が違えば、読む人に
は別の話や。

実際にずれとった。JS 側を先に「NaN は断る」で書いたら、python の parse_strict は
NaN を黙って読み、verify が unsafe_number と書いて断っとった。どこで断るかやのうて
何と呼ぶかを揃えなあかん、と分かったんはこの突き合わせのおかげで、読んで分かった
んやない。せやからその突き合わせを一回こっきりにせんと、表にして残す。

  python3 agreement_readback.py            # 表を作り直す
  python3 agreement_readback.py --check    # ずれとらんか見るだけ (CI 用)
  python3 agreement_readback.py --selftest # この道具自身の試験

出す物: agreement_readback_v1.json
  cases: [[入力の字, "ok", canonical のバイト] | [入力の字, "refused", 名前], ...]
  名前は agreement_verify.main が報告書に書くのと同じ規則で決める。
"""
# RUN_ALL: suite --selftest
# RUN_ALL: suite --check
import importlib.util
import json
import os
import sys
import hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "agreement_readback_v1.json")


def load_verifier():
    spec = importlib.util.spec_from_file_location(
        "agreement_verify_for_readback", os.path.join(HERE, "agreement_verify.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def canonical(v):
    return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def inputs():
    """試す字を集める。全部この場で組み立てる。手で並べた分も、規則で増やした分も。"""
    xs = []

    # 1. 素直に読めるもの
    xs += ['{}', '[]', 'null', 'true', 'false', '0', '-0', '1', '-1',
           '"", ' [:2] + '"', '""', '"a"', '[1,2,3]', '{"a":1}', '{"b":1,"a":2}',
           '{"a":{"b":{"c":1}}}', '[[[[1]]]]', '{"a":[1,{"b":null}]}']

    # 2. 数。int と float の別れ目、大きさ、書き方
    ints = ['0', '-0', '1', '-1', '10', '123456789', '9007199254740991',
            '9007199254740993', '18446744073709551616', '1180591620717411303424',
            '-1180591620717411303424', '1' + '0' * 60]
    floats = ['0.0', '-0.0', '1.0', '-1.0', '0.25', '1.5', '10000.5', '0.1',
              '1e0', '1E0', '1e+0', '1e-0', '1e16', '1e-5', '1e-7', '1e21',
              '1e309', '-1e309', '5e-324', '1.7976931348623157e308',
              '12345678901234567.0', '100.0', '1e15', '1e17', '2.5e-10', '1e-4']
    bad_nums = ['01', '-01', '+1', '1.', '.1', '1e', '1e+', '--1', '1.2.3',
                '0x10', '1_000', 'Infinity1', '1 2', '00']
    xs += ints + floats + bad_nums
    for n in ints[:6] + floats[:6]:
        xs.append('{"n":%s}' % n)
        xs.append('[%s]' % n)

    # 3. python の json.loads が既定で通す 3 語と、その近所
    xs += ['NaN', 'Infinity', '-Infinity', '[NaN]', '{"n":NaN}',
           '[Infinity,-Infinity]', 'nan', 'INF', '+Infinity', 'inf', 'None',
           'True', 'undefined', 'Nan', 'infinity']

    # 4. 同じ鍵。段の深さを変えて
    xs += ['{"a":1,"a":2}', '{"a":1,"b":2,"a":3}',
           '{"x":{"a":1,"a":2}}', '{"x":[{"a":1,"a":2}]}',
           '{"x":{"y":{"z":{"k":1,"k":2}}}}',
           '{"\\u00e9":1,"\\u00e9":2}', '{"a":1,"A":2}']

    # 5. 文字列。逃がし方、対を組まん代理符号、生の制御文字
    xs += ['"\\u0000"', '"\\u001f"', '"\\u007f"', '"\\u00e9"', '"\\u65e5"',
           '"\\ud83d\\ude00"', '"\\ud800"', '"\\udfff"', '"\\ud800\\ud800"',
           '"\\b\\t\\n\\f\\r"', '"\\/"', '"\\\\"', '"\\""', '"\\x41"', '"\\u00"',
           '"\\uzzzz"', '"a\x01b"', '"a\nb"', '"unterminated', '"\\"']

    # 6. 形が壊れとるもの
    xs += ['{', '}', '[', ']', '{]', '[}', '{"a"}', '{"a":}', '{:1}',
           '{"a":1,}', '[1,]', '[,1]', '{"a":1}{"b":2}', '{} {}', '[] []',
           "{'a':1}", '{a:1}', '', '   ', '\n\t ', '{"a":1} trailing']

    # 7. 空白の入れ方。canonical に戻したら消える所
    xs += ['{ "a" : 1 }', '[ 1 , 2 ]', '\n{"a":\t1}\r\n', ' null ']

    # 8. 深さ。verify の MAX_DEPTH は 32、fixture の最深は 41
    for d in (1, 2, 31, 32, 33, 41, 64, 100):
        xs.append('[' * d + '1' + ']' * d)
        xs.append('{"a":' * d + '1' + '}' * d)

    # 9. 大きさ
    xs.append('[' + ','.join(str(i) for i in range(200)) + ']')
    xs.append('{' + ','.join('"k%d":%d' % (i, i) for i in range(200)) + '}')

    # 同じ字を二度試さん
    out, seen = [], set()
    for x in xs:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def behaviour(V, text):
    """agreement_verify.main が報告書に書くのと同じ規則で、読み口の答えを決める。"""
    try:
        v = V.parse_strict(text)
    except RecursionError:
        return ["refused", "too_deep"]
    except ValueError as e:
        return ["refused", "duplicate_json_key" if "duplicate key" in str(e) else "bad_json"]
    try:
        return ["ok", canonical(v)]
    except (ValueError, TypeError) as e:
        return ["refused", "not_canonicalizable:" + type(e).__name__]


def build():
    V = load_verifier()
    cases = []
    for text in inputs():
        cases.append([text] + behaviour(V, text))
    ok = sum(1 for c in cases if c[1] == "ok")
    codes = {}
    for c in cases:
        if c[1] == "refused":
            codes[c[2]] = codes.get(c[2], 0) + 1
    return {
        "name": "agreement-readback-v1",
        "note": "python の parse_strict が何を読み、何をどの名前で断るか。JS 側はこれと 1 件も違うたらあかん。",
        "generated_by": "agreement_readback.py",
        "verifier_version": getattr(V, "VERIFIER_VERSION", "?"),
        "count": len(cases),
        "read_ok": ok,
        "refused": len(cases) - ok,
        "refusal_codes": dict(sorted(codes.items())),
        "cases": cases,
    }


# 表に入れてええのは「答え」だけで、「どこで走らせたか」は入れたらあかん。
# 2026-09-10: ここに python の版を書き込んどった。作った機械 (3.10.12) と TOshi の
# Mac の python3 は版が違う。中身は 1 件も違わんのに --check が赤くなり、run_all が
# commit を止めた。止まったこと自体は正しい。悪いんは、変わってええ物を契約に
# 混ぜたこの表の作りの方や。版は作るときに画面へ出すだけにして、file には残さん。
def dump(doc):
    return json.dumps(doc, ensure_ascii=True, indent=1, sort_keys=True) + "\n"



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

    V = load_verifier()
    doc = build()
    cases = doc["cases"]

    t("空やない", len(cases) > 150, len(cases))

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
    t("読めた数と断った数を足したら全部", doc["read_ok"] + doc["refused"] == len(cases))
    t("同じ字を二度試しとらん", len({c[0] for c in cases}) == len(cases))
    t("読めたのも断ったのも両方ある", doc["read_ok"] > 50 and doc["refused"] > 20,
      (doc["read_ok"], doc["refused"]))

    for want in ("bad_json", "duplicate_json_key"):
        t("断り方に " + want + " が出とる", want in doc["refusal_codes"])

    # 表の答えは、その場で引き直しても同じ
    bad = None
    for text, kind, val in cases:
        got = behaviour(V, text)
        if got != [kind, val]:
            bad = (text, [kind, val], got)
            break
    t("表の答えは今の python の答えと同じ", bad is None, bad)

    # canonical と言うたやつは、読み直したら同じ canonical になる (NaN と無限は除く)
    bad = None
    for text, kind, val in cases:
        if kind != "ok" or "NaN" in val or "Infinity" in val:
            continue
        again = behaviour(V, val)
        if again != ["ok", val]:
            bad = (text, val, again)
            break
    t("canonical をもう一度読んだら同じ canonical", bad is None, bad)

    # 手で確かめられる要所
    m = {c[0]: c[1:] for c in cases}
    t("同じ鍵は duplicate_json_key", m.get('{"a":1,"a":2}') == ["refused", "duplicate_json_key"], m.get('{"a":1,"a":2}'))
    t("NaN は読める (断るんは verify の unsafe_number)", m.get("NaN") == ["ok", "NaN"], m.get("NaN"))
    t("大きい int は桁のまま", m.get("1180591620717411303424") == ["ok", "1180591620717411303424"])
    t("1e16 は 1e+16", m.get("1e16") == ["ok", "1e+16"])
    t("1.0 は 1.0 のまま", m.get("1.0") == ["ok", "1.0"])
    t("01 は bad_json", m.get("01") == ["refused", "bad_json"])
    t("末尾の余りは bad_json", m.get("{} {}") == ["refused", "bad_json"])
    t("空の字は bad_json", m.get("") == ["refused", "bad_json"])
    t("生の制御文字は bad_json", m.get('"a\x01b"') == ["refused", "bad_json"], m.get('"a\x01b"'))

    a = dump(doc)
    d2 = json.loads(a)
    d2["cases"][0][1] = "refused"
    t("--check はずれを見つける", dump(d2) != a)

    print("")
    print("=== %d / %d %s (agreement_readback の自己試験) ===" %
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
            print("★ 拒否: %s が今の読み口の答えとずれとる。" % os.path.basename(OUT))
            show_diff(have, text)
            return 1
        print("一致: %s (%d 件、読めた %d、断った %d)"
              % (os.path.basename(OUT), doc["count"], doc["read_ok"], doc["refused"]))
        return 0
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    print("書いた: %s" % os.path.basename(OUT))
    print("  入力 %d 件、読めた %d、断った %d" % (doc["count"], doc["read_ok"], doc["refused"]))
    print("  断り方: %s" % json.dumps(doc["refusal_codes"], ensure_ascii=False))
    print("  verifier %s / python %s (版は表には残さん)"
          % (doc["verifier_version"], sys.version.split()[0]))
    print("  sha256 %s" % hashlib.sha256(text.encode("utf-8")).hexdigest())
    return 0


if __name__ == "__main__":
    sys.exit(main())
