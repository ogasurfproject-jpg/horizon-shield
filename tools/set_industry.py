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

    if not cands:
        print("候補はありません。業種の無い店は、すべて既に何かを答えています。")
        return

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
