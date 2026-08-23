# -*- coding: utf-8 -*-
"""
算定要件データベースの持ち主を1つに決め、こちら側は写しであることを明示する。

なぜ要るか (2026-08-23):
  JHNRD を公開リポジトリに切り出したあと、データベースが2箇所に存在していた。

    ~/Desktop/jhnrd/data/rules_2024.json              seed.6  出典7件
    ~/Desktop/hs-docfix/data/nursing/rules_2024.json  seed.2  出典5件

  同じ日のうちに4版ぶん離れていた。しかも industry.js のコメントは
  hs-docfix 側を指しているので、ヒアリングは古い方を参照している形になっていた。

  これから DB を厚くしていく作業で、2箇所に書き足せば、どちらが本物か分からなくなる。
  分からなくなったものは、突き合わせもできない。

決めること:
  本物は JHNRD リポジトリ側。公開されていて、CI が規律を検査している方が本物である。
  hs-docfix 側は写し。写しであることを、ファイル自身に書く。
  そして、写しが本物とずれていたら分かるようにする。

使い方:
  python3 tools/nursing/sync_db.py            # ずれているかを見るだけ
  python3 tools/nursing/sync_db.py --pull     # 本物から写しを取り直す
"""

import hashlib, io, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def find_repo(start, marker):
    d = os.path.abspath(start)
    for _ in range(6):
        if os.path.exists(os.path.join(d, marker)):
            return d
        p = os.path.dirname(d)
        if p == d:
            break
        d = p
    return None


HS = find_repo(HERE, os.path.join("tools", "yakumo", "generate.py"))
if not HS:
    sys.stderr.write("\nhs-docfix の根が見つかりません。\n\n"); sys.exit(1)

COPY = os.path.join(HS, "data", "nursing", "rules_2024.json")

UPSTREAM_CANDIDATES = [
    os.environ.get("JHNRD_REPO", ""),
    os.path.join(os.path.dirname(HS), "jhnrd"),
    os.path.expanduser("~/Desktop/jhnrd"),
]
UPSTREAM_URL = "https://raw.githubusercontent.com/ogasurfproject-jpg/jhnrd/main/data/rules_2024.json"


def upstream_path():
    for c in UPSTREAM_CANDIDATES:
        if not c:
            continue
        p = os.path.join(c, "data", "rules_2024.json")
        if os.path.exists(p):
            return p
    return None


def digest(path):
    return hashlib.sha256(io.open(path, "rb").read()).hexdigest()


def stamp_copy(data, src_digest, src_where):
    """写しであることを、ファイル自身に書く。読んだ人が本物と取り違えないように。"""
    data = dict(data)
    data["_copy_of"] = {
        "repo": "https://github.com/ogasurfproject-jpg/jhnrd",
        "file": "data/rules_2024.json",
        "raw": UPSTREAM_URL,
        "synced_at": "2026-08-23",
        "source_sha256": src_digest,
        "source_path_at_sync": src_where,
        "note": ("これは写しである。書き足すなら JHNRD 側に書くこと。"
                 "ここに書いても公開されず、CI の検査も通らず、"
                 "次の同期で消える。"),
    }
    return data


def main():
    pull = "--pull" in sys.argv
    up = upstream_path()

    if not os.path.exists(COPY):
        print("写しがありません: " + os.path.relpath(COPY, HS))
    if not up:
        print("本物が手元に見つかりません。", file=sys.stderr)
        print("JHNRD_REPO=<jhnrdのパス> を付けるか、次で取得してください:", file=sys.stderr)
        print("  curl -s %s -o %s" % (UPSTREAM_URL, os.path.relpath(COPY, HS)), file=sys.stderr)
        sys.exit(2)

    ud = json.load(io.open(up, encoding="utf-8"))
    uh = digest(up)
    print("本物 : %s" % up)
    print("       版 %s / 項目 %d / 出典 %d / sha %s" %
          (ud.get("version"), len(ud.get("items", [])), len(ud.get("sources", {})), uh[:12]))

    if os.path.exists(COPY):
        cd = json.load(io.open(COPY, encoding="utf-8"))
        marker = (cd.get("_copy_of") or {}).get("source_sha256")
        print("写し : %s" % os.path.relpath(COPY, HS))
        print("       版 %s / 項目 %d / 出典 %d" %
              (cd.get("version"), len(cd.get("items", [])), len(cd.get("sources", {}))))
        if marker == uh:
            print("\n一致しています。")
            return
        if cd.get("version") != ud.get("version"):
            print("\nずれています: 写しは %s、本物は %s" % (cd.get("version"), ud.get("version")))
        else:
            print("\n版は同じですが、中身が違います。")
        if not cd.get("_copy_of"):
            print("  写しに『写しである』印がありません。"
                  "この状態だと、こちらに書き足したものが次の同期で消えます。")

    if not pull:
        print("\n(--pull が無いので、まだ書いていません)")
        return

    out = stamp_copy(ud, uh, up)
    os.makedirs(os.path.dirname(COPY), exist_ok=True)
    io.open(COPY, "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
    print("\n写しを取り直しました。版 %s" % ud.get("version"))
    print("  このファイルには『写しである』印が入っています。書き足すなら JHNRD 側へ。")


if __name__ == "__main__":
    main()
