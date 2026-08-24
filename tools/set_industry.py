# -*- coding: utf-8 -*-
"""
既にある店に、業種を書き込む。

2026-08-23。合同会社あっぷす様(訪問看護)には、建設のヒアリングを送ってしまった後、
訪問看護の3問を手で送り直した。ところが店レコードには業種が無いままなので、
そのまま彼が答えると、ゲートが「まず、ご業種を」と聞き返してしまう。
手で送った文と矛盾する。だからここで直接書き込む。

安全のため、既定では候補を並べるだけで何も書かない。
書くときは店IDを名指しする。当てずっぽうで書き換えない。

使い方:
  python3 tools/set_industry.py                       # 候補を並べる
  python3 tools/set_industry.py --store kira-xxxx --industry nursing   # 書き込む
"""

import argparse, json, subprocess, sys

NS = "cae22b3bf47b46bebdfcdfd6a724f8ab"   # HS_HEARING_KV
VALID = ("construction", "nursing")


def wrangler(args):
    r = subprocess.run(["npx", "wrangler", "kv", "key"] + args,
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(r.stderr[-800:] + "\n")
        raise SystemExit("wrangler が失敗しました: " + " ".join(args[:2]))
    return r.stdout


def jsout(s):
    """wrangler の前置きを飛ばして JSON 部分だけ取る。"""
    for i, ch in enumerate(s):
        if ch in "[{":
            return json.loads(s[i:])
    raise ValueError("JSON が見つかりません")


def kv_list(prefix):
    return jsout(wrangler(["list", "--namespace-id", NS, "--prefix", prefix, "--remote"]))


def kv_get(key):
    out = wrangler(["get", "--namespace-id", NS, key, "--remote"])
    try:
        return jsout(out)
    except Exception:
        return None


def kv_put(key, obj):
    body = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    wrangler(["put", "--namespace-id", NS, key, body, "--remote"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--store", help="書き込む店ID (例 kira-abcd1234)")
    ap.add_argument("--industry", choices=VALID)
    a = ap.parse_args()

    if a.store:
        if not a.industry:
            raise SystemExit("--industry も指定してください (" + " / ".join(VALID) + ")")
        key = "store:" + a.store
        s = kv_get(key)
        if not s:
            raise SystemExit("その店がありません: " + key)
        before = s.get("industry")
        print("店       : " + a.store)
        print("会社名   : " + json.dumps(s.get("company", ""), ensure_ascii=False))
        print("いまの業種: " + json.dumps(before, ensure_ascii=False))
        if before and before != a.industry:
            print("\n既に別の業種が入っています。上書きすると、これまでの質問と食い違います。")
            print("本当に変えるなら、この行を消してから実行してください。")
            raise SystemExit(3)
        s["industry"] = a.industry
        s["industry_decided_at"] = "2026-08-23T00:00:00Z"
        s["industry_set_by"] = "manual (LINEで訪問看護の質問を手で送ったため)"
        kv_put(key, s)
        print("→ 業種 = " + a.industry + " を書き込みました")
        return

    # 候補を並べる。まだ何も答えていない、業種の無い店。
    print("業種が無く、まだ何も答えていない店を探します...\n")
    keys = [k["name"] for k in kv_list("store:")]
    print("店の総数: %d\n" % len(keys))
    cands = []
    for k in keys:
        s = kv_get(k)
        if not s:
            continue
        if s.get("industry"):
            continue
        untouched = (not s.get("company")) and (not s.get("works")) and (not s.get("areas"))
        if untouched:
            cands.append((k, s))

    # 2026-08-24: ここに足した一覧を "if not cands:" の中に置いていた。
    #   候補が1件でもあると出ない。つまり、いちばん見たい状況で出なかった。
    #   分岐の中に置くか外に置くかで、見えるものが変わる。外に出す。
    #
    #   業種の無い店は、答えているかどうかに関わらず全部並べる。
    #   答えていない店は推測せずに尋ねられる。
    #   答えている店は、工種を見てから決める。どちらも見せないと決められない。
    answered, untouched = [], []
    for k in keys:
        s2 = kv_get(k)
        if not s2 or s2.get("industry"):
            continue
        if (not s2.get("company")) and (not s2.get("works")) and (not s2.get("areas")):
            untouched.append((k, s2))
        else:
            answered.append((k, s2))

    if not untouched and not answered:
        print("業種の無い店はありません。")
        return

    if answered:
        print("業種が無く、既に答えている店: %d 件" % len(answered))
        for k, s2 in answered:
            sid = k.split(":", 1)[1]
            print("  %-20s %s" % (sid, s2.get("company") or "(社名なし)"))
            print("      工種  : %s" % (", ".join(s2.get("works") or []) or "(なし)"))
            print("      エリア: %s" % (", ".join(s2.get("areas") or []) or "(なし)"))
        print()
        print("  これらは、コードが既に construction として扱っています。")
        print("  computeCompleteness も generate.py も、業種が無ければ建設として動きます。")
        print("  construction と書くのは、隠れていた既定値を見えるところに出すだけで、")
        print("  挙動は変えません。変わるのは名乗りだけで、")
        print("  「HORIZON SHIELD 運営事務局」から「Yakumo運営」に戻ります。")
        print()
        print("  工種を見て建設だと確かめてから、1店ずつ:")
        for k, s2 in answered:
            sid = k.split(":", 1)[1]
            print("    python3 tools/set_industry.py --store %s --industry construction" % sid)
        print()

    if not untouched:
        return
    cands = untouched
    print("候補 %d 件:" % len(cands))
    for k, s in sorted(cands, key=lambda x: x[1].get("created_at", "")):
        sid = k.split(":", 1)[1]
        line = kv_get("store2line:" + sid)
        if not isinstance(line, str):
            try:
                line = wrangler(["get", "--namespace-id", NS, "store2line:" + sid, "--remote"]).strip().splitlines()[-1]
            except Exception:
                line = "?"
        print("  %-16s 作成 %s  LINE %s" % (sid, s.get("created_at", "?"), str(line)[:40]))
    print("\n書き込むときは、店IDを名指しでどうぞ:")
    print("  python3 tools/set_industry.py --store <ID> --industry nursing")


if __name__ == "__main__":
    main()
