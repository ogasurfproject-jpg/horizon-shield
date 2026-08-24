# -*- coding: utf-8 -*-
"""生成物が、どこで走らせても同じになるかを見る。

なぜ要るか (2026-08-24):
  build_mcp_rules.py は、はじめ「読んだファイルの sha256」を生成物に書いていた。
  手元では JHNRD 本体を読み、CI ではリポジトリ内の写しを読む。
  写しには sync_db.py が『写しである』印(_copy_of)を足しているので、
  同じ版でもバイト列が違う。だから --check が CI でだけ落ちた。
  実際に落ちた(5c977d78 の nursing-questions / visibility)。

  生成物が「どこで走らせたか」で変わるなら、それは検査にならない。
  手元で緑・CI で赤、という形は、原因が分かるまで必ず「CI のせい」に見える。

  ここでは、同じ中身に印だけを足したものを渡して、
  出てくるバイト列が1バイトも変わらないことを見る。
"""
import io
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(HERE, "build_mcp_rules.py")
sys.path.insert(0, HERE)
import migrate_questions as MQ  # noqa: E402

HS = MQ.HS
OUT = os.path.join(HS, "workers", "hs-nursing-mcp", "src", "rules.js")


def run_check(db_path):
    env = dict(os.environ)
    env["HS_NURSING_DB"] = db_path
    return subprocess.run([sys.executable, TOOL, "--check"],
                          capture_output=True, text=True, cwd=HS, env=env)


def main():
    if not os.path.exists(OUT):
        print("生成物がまだありません: %s" % OUT)
        print("  python3 tools/nursing/build_mcp_rules.py --write")
        return 1

    src = MQ.DB
    raw = json.load(io.open(src, encoding="utf-8"))
    bad = 0

    print("いま読んでいるデータベース: %s" % src)

    # 1) そのまま
    r = run_check(src)
    ok = (r.returncode == 0)
    print(("  ok  " if ok else "  ★NG ") + "そのままの版で、生成物とずれない")
    if not ok:
        print((r.stdout + r.stderr)[-800:]); bad += 1

    # 2) 『写しである』印を足したもの。中身は同じ。
    stamped = dict(raw)
    stamped["_copy_of"] = {
        "repo": "https://github.com/ogasurfproject-jpg/jhnrd",
        "raw": "https://raw.githubusercontent.com/ogasurfproject-jpg/jhnrd/main/data/rules_2024.json",
        "source_sha256": "0" * 64,
        "note": "試験のために足した印。中身は変えていない。",
    }
    d = tempfile.mkdtemp(prefix="mcprules_")
    p = os.path.join(d, "rules_2024.json")
    with io.open(p, "w", encoding="utf-8") as f:
        json.dump(stamped, f, ensure_ascii=False, indent=2)
    r = run_check(p)
    ok = (r.returncode == 0)
    print(("  ok  " if ok else "  ★NG ") + "『写しである』印を足しても、生成物は1バイトも変わらない")
    if not ok:
        print((r.stdout + r.stderr)[-800:]); bad += 1

    # 3) 並び順だけを変えたもの。中身は同じ。
    reordered = {k: raw[k] for k in sorted(raw.keys())}
    p2 = os.path.join(d, "reordered.json")
    with io.open(p2, "w", encoding="utf-8") as f:
        json.dump(reordered, f, ensure_ascii=False, indent=4)
    r = run_check(p2)
    ok = (r.returncode == 0)
    print(("  ok  " if ok else "  ★NG ") + "鍵の並び順と字下げを変えても、生成物は変わらない")
    if not ok:
        print((r.stdout + r.stderr)[-800:]); bad += 1

    # 4) 中身を1文字変えたら、ちゃんとずれると言うこと。
    #    「何をしても同じ」なら、それは検査ではない。
    changed = json.loads(json.dumps(raw, ensure_ascii=False))
    changed["items"][0]["name"] = str(changed["items"][0].get("name")) + "(試験)"
    p3 = os.path.join(d, "changed.json")
    with io.open(p3, "w", encoding="utf-8") as f:
        json.dump(changed, f, ensure_ascii=False, indent=2)
    r = run_check(p3)
    ok = (r.returncode != 0)
    print(("  ok  " if ok else "  ★NG ") + "中身を変えたら、ずれていると言う")
    if not ok:
        print((r.stdout + r.stderr)[-400:]); bad += 1

    print("")
    if bad:
        print("%d 件おかしい。" % bad)
        return 1
    print("生成物は、どこで走らせても同じになります。中身が変われば、変わったと言います。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
