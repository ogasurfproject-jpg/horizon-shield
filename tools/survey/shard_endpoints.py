# -*- coding: utf-8 -*-
"""走る一覧を、ホスト単位で N 個に割る。

なぜ要るか (2026-08-24):
  全件の走行は一日かかる。GitHub Actions のジョブは6時間で切られる。
  だから四半期の走行を自動で回すには、分けて走らせるしかない。

なぜ計器そのものを触らないか:
  survey1_walk.py は、公開している数字を出した道具である。
  そこに --shard を足せば、公開した数字を出した道具と、
  これから走らせる道具が、別のものになる。
  再現できると書いてある以上、計器は1バイトも変えない。
  割るのは、計器ではなく入力の一覧のほうにする。

なぜホスト単位で割るか:
  survey1_walk.py は「同じホストには2秒あけて叩く」を守っている(PER_HOST_INTERVAL)。
  その約束は、1つのプロセスの中でしか効かない。
  住所を機械的に等分すると、同じホストが複数のシャードに散る。
  すると別々のプロセスが同時に同じホストを叩き、2秒の約束が黙って破れる。
  相手からは、こちらが約束を破ったようにしか見えない。

  ホストで割れば、そのホストの全部が1つのシャードに入る。約束は守られる。
  代わりにシャードの大きさは揃わない。揃わない方を選ぶ。

  python3 tools/survey/shard_endpoints.py --input endpoints.txt --shards 12 --out-dir shards/
"""
import argparse
import hashlib
import io
import os
import sys
from urllib.parse import urlsplit


def host_of(u):
    try:
        h = urlsplit(u.strip()).netloc.lower()
    except Exception:
        h = ""
    # 住所として読めないもの(雛形など)は、1つのシャードにまとめる。
    # 散らすと、どのシャードにも少しずつ混ざって数えにくい。
    return h or "(住所として読めない)"


def shard_of(host, n):
    d = hashlib.sha256(host.encode("utf-8")).digest()
    return int.from_bytes(d[:4], "big") % n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="1行1住所の一覧")
    ap.add_argument("--shards", type=int, required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--only", type=int, default=None, help="この番号のシャードだけ書く(0起点)")
    a = ap.parse_args()

    if a.shards < 1:
        sys.stderr.write("--shards は1以上。\n")
        return 2

    urls = [l.strip() for l in io.open(a.input, encoding="utf-8") if l.strip()]
    if not urls:
        sys.stderr.write("一覧が空です: %s\n" % a.input)
        return 3

    buckets = {i: [] for i in range(a.shards)}
    hosts = {}
    for u in urls:
        h = host_of(u)
        hosts.setdefault(h, 0)
        hosts[h] += 1
        buckets[shard_of(h, a.shards)].append(u)

    os.makedirs(a.out_dir, exist_ok=True)
    print("住所 %d 本 / ホスト %d / シャード %d" % (len(urls), len(hosts), a.shards))
    total = 0
    for i in range(a.shards):
        if a.only is not None and i != a.only:
            continue
        p = os.path.join(a.out_dir, "shard_%02d.txt" % i)
        with io.open(p, "w", encoding="utf-8") as f:
            for u in buckets[i]:
                f.write(u + "\n")
        total += len(buckets[i])
        # そのシャードで最も本数の多いホスト。走る時間はここで決まる。
        top = {}
        for u in buckets[i]:
            h = host_of(u)
            top[h] = top.get(h, 0) + 1
        big = max(top.items(), key=lambda x: x[1]) if top else ("-", 0)
        print("  shard %02d  %5d 本  最大ホスト %s (%d 本, 最短 %.1f 分)"
              % (i, len(buckets[i]), big[0][:34], big[1], big[1] * 2.0 / 60))
    print("書いた合計: %d 本" % total)

    if a.only is None:
        assert sum(len(v) for v in buckets.values()) == len(urls), \
            "割ったあとの合計が合いません"
        print("\n合計は一致しています。ホストは1つのシャードにまとまっています。")
        print("(同じホストへ2秒あける約束は、1つのプロセスの中でしか効かない。")
        print(" だから住所ではなくホストで割っている)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
