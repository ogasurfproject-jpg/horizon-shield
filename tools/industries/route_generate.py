# -*- coding: utf-8 -*-
"""業種を見て、その業種の生成器に渡す。出口が無い業種は、失敗ではなく「無い」と記録する。

なぜ要るか (2026-08-24):
  hs-hearing は完成度が閾値に達すると repository_dispatch を投げる。
  受け手の yakumo-content.yml は tools/yakumo/generate.py だけを走らせていた。
  建設の生成器には業種の安全弁があり、nursing なら exit 4 で止まる。
  だから他社の名前で建設のページが作られることはない。しかし、止まるだけである。

  止まると、ワークフローが失敗する。失敗すると、メールが飛ぶ。
  平田様のヒアリングが進むほど、失敗の通知だけが増える。
  お金をいただいている相手の答えが溜まるのに、出口が無い。
  そして出口が無いことは、失敗通知という形でしか表に出ない。

  ここで二つを分ける。
    ・その業種に生成器が繋がっていない  → 失敗ではない。「まだ出口が無い」と記録して0で終わる。
    ・生成器が落ちた / 門が落ちた        → 失敗である。公開しない。非ゼロで終わる。

  どちらを走らせるかは data/industries/registry.json だけが決める。
  ここに業種名を書かない。書けば、レジストリと二重管理になり、いつか片方だけ直る。
"""
import argparse
import io
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
# 2026-08-24: 試験のために、見るレジストリを外から差し替えられるようにした。
#   差し替えられないと、「出口が無い業種」の枝を試すために本物のレジストリを
#   一時的に壊すしかない。壊して戻し忘れれば、それがそのまま出荷される。
REG = os.environ.get("HS_INDUSTRY_REGISTRY") or os.path.join(
    ROOT, "data", "industries", "registry.json")
# 記録の置き場所。試験は本物を汚さないよう、ここを差し替える。
OUT = os.environ.get("HS_ROUTE_OUT") or os.path.join(
    ROOT, "tools", "industries", "last_route.json")
GATE = os.path.join(ROOT, "tools", "pagecheck", "validate.py")


def load_dispatch(path):
    with io.open(path, encoding="utf-8") as f:
        payload = json.load(f)
    cp = payload.get("client_payload", payload)
    profile = cp.get("profile") or payload.get("profile") or payload
    autopilot = cp.get("autopilot") or {}
    ind = (autopilot.get("industry") or profile.get("industry") or "").strip()
    return profile, autopilot, ind


def write_route(d):
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with io.open(OUT, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    print("\n記録: tools/industries/last_route.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dispatch", required=True)
    ap.add_argument("--out-root", default=ROOT)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    with io.open(REG, encoding="utf-8") as f:
        reg = json.load(f)
    industries = reg.get("industries") or {}

    profile, autopilot, ind = load_dispatch(a.dispatch)
    company = profile.get("company") or "(事業所名なし)"

    print("受け取った業種: %s" % (ind or "(無し)"))
    print("事業所        : %s" % company)

    if not ind:
        # 業種の無い dispatch は、測られたものが壊れている。これは失敗でよい。
        sys.stderr.write(
            "\n業種が入っていません。どの生成器に渡すか決められません。\n"
            "  hs-hearing 側で industry が決まっていない店から dispatch が来ています。\n"
            "  業種を先に決めてください(合言葉のあとに1問だけ尋ねる分岐があります)。\n\n")
        write_route({"status": "no_industry", "company": company})
        return 3

    if ind not in industries:
        sys.stderr.write(
            "\nレジストリに無い業種です: %s\n"
            "  data/industries/registry.json に足してください。\n"
            "  知らない業種のページを、似ている業種の生成器で作ることはしません。\n\n" % ind)
        write_route({"status": "unknown_industry", "industry": ind, "company": company})
        return 3

    entry = industries[ind]
    gen = entry.get("generator") or {}
    status = gen.get("status")
    tool = gen.get("tool")
    manifest = gen.get("manifest")
    publishes_to = gen.get("publishes_to")

    if status != "wired" or not tool:
        # 出口が無い。これは失敗ではない。「無い」ということが分かっている状態である。
        print("")
        print("この業種には、まだ出口(生成器)が繋がっていません。")
        print("  業種      : %s (%s)" % (ind, entry.get("label") or ""))
        print("  生成器    : %s" % (tool or "(未指定)"))
        print("  状態      : %s" % (status or "(未指定)"))
        if gen.get("gap"):
            print("  穴        : %s" % gen["gap"])
        if gen.get("next"):
            print("  次にやる  : %s" % gen["next"])
        print("")
        print("ヒアリングの答えは失われていません。溜まっています。")
        print("出口が繋がった時点で、同じ答えからページを作れます。")
        print("ここは失敗にしません。失敗にすると、出口が無いことが通知の雨になるだけで、")
        print("出口は一歩も近づかないからです。")
        write_route({"status": "no_exit", "industry": ind, "company": company,
                     "generator": tool, "generator_status": status,
                     "gap": gen.get("gap"), "next": gen.get("next"),
                     "published": False})
        return 0

    if not manifest:
        sys.stderr.write("\nレジストリの %s に generator.manifest がありません。"
                         "門に何を渡すか決められません。\n\n" % ind)
        write_route({"status": "no_manifest", "industry": ind})
        return 3

    # ---- 生成 -----------------------------------------------------------
    cmd = [sys.executable, os.path.join(ROOT, tool), "--dispatch", a.dispatch]
    if a.out_root != ROOT:
        cmd += ["--out-root", a.out_root]
    if a.dry_run:
        cmd += ["--dry-run"]
    print("\n$ %s" % " ".join(cmd[1:]))
    r = subprocess.run(cmd, cwd=ROOT)
    if r.returncode != 0:
        sys.stderr.write("\n生成器が落ちました(終了コード %d)。公開しません。\n\n" % r.returncode)
        write_route({"status": "generator_failed", "industry": ind,
                     "generator": tool, "returncode": r.returncode, "published": False})
        return r.returncode

    if a.dry_run:
        write_route({"status": "dry_run", "industry": ind, "generator": tool, "published": False})
        return 0

    # ---- 門 -------------------------------------------------------------
    man_path = os.path.join(a.out_root, manifest)
    if not os.path.exists(man_path):
        sys.stderr.write("\n生成器は通ったのに、manifest がありません: %s\n"
                         "門に渡すものが無いので、公開しません。\n\n" % man_path)
        write_route({"status": "manifest_missing", "industry": ind,
                     "manifest": manifest, "published": False})
        return 3
    # 門は manifest に書かれた相対パスを、自分の cwd から辿る。
    # 生成器が書いた先(out_root)から見なければ、そこに在るファイルを「無い」と言う。
    # 2026-08-24、実際にそう言わせた。out_root を /tmp にして試したとき、
    # 5枚とも FILE_MISSING で落ちた。ファイルは在った。見る場所が違っていた。
    print("\n$ %s --manifest %s   (cwd=%s)"
          % (os.path.relpath(GATE, ROOT), manifest, a.out_root))
    r = subprocess.run([sys.executable, GATE, "--manifest", man_path,
                        "--root", a.out_root], cwd=ROOT)
    if r.returncode != 0:
        sys.stderr.write("\n門が落ちました。1枚でも落ちたら公開しません(fail-closed)。\n\n")
        write_route({"status": "gate_failed", "industry": ind,
                     "manifest": manifest, "returncode": r.returncode, "published": False})
        return r.returncode

    with io.open(man_path, encoding="utf-8") as f:
        man = json.load(f)
    paths = sorted({p.get("path") for p in (man.get("pages") or []) if p.get("path")})
    # commit する対象。生成器が触る場所は、レジストリが宣言している。
    targets = [x for x in [publishes_to, manifest] if x]
    for extra in (entry.get("generator") or {}).get("also_commit", []) or []:
        targets.append(extra)

    print("\n業種 %s: %d 枚が門を通りました。" % (ind, len(paths)))
    write_route({"status": "ok", "industry": ind, "company": company,
                 "generator": tool, "manifest": manifest,
                 "count": len(paths), "pages": paths,
                 "urls": man.get("urls") or [],
                 "commit_paths": targets, "published": True})
    return 0


if __name__ == "__main__":
    sys.exit(main())
