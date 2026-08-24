# -*- coding: utf-8 -*-
"""業種の振り分けを、枝ごとに走らせて確かめる。

なぜ要るか (2026-08-24):
  「出口が無い業種は失敗にしない」という決まりを入れた。
  決まりを入れた日には、必ず正しく動いているように見える。
  だが本当に確かめたいのは、次の二つが別々に扱われているかである。

    ・出口が無い          → 0 で終わる。失敗通知を出さない。だが「無い」と言う。
    ・生成器か門が落ちた  → 非ゼロで終わる。公開しない。

  片方しか試さなければ、いつか全部が0になるか、全部が非ゼロになる。
"""
import io
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
ROUTER = os.path.join(HERE, "route_generate.py")
REAL_REG = os.path.join(ROOT, "data", "industries", "registry.json")

NURSING_PROFILE = {
    "industry": "nursing",
    "company": "試験用 訪問看護ステーション",
    "rep": "試験",
    "area": "平塚市および周辺(二宮町は要相談)",
    "areas_served": ["平塚市", "茅ヶ崎市", "大磯町", "二宮町要相談"],
    "works": ["点滴・注射の管理", "服薬管理", "褥瘡の処置", "在宅酸素の管理", "看取りの支援"],
    "strengths": "24時間の連絡体制をとっています。土日祝も必要なときは伺います。",
    "trust": "看護師5名、うち常勤3名。ケアマネさんとの会議を毎月開いています。",
    "hours": "平日9時から18時。夜間休日は当番の携帯へ。",
    "contact": "お電話またはFAXで承ります。",
    "faqs": [{"q": "急に必要になったときは来てもらえますか",
              "a": "主治医の指示があれば伺います。まずお電話ください。"}],
}


def dispatch_file(profile, autopilot=None):
    d = tempfile.mkdtemp(prefix="route_")
    p = os.path.join(d, "dispatch.json")
    with io.open(p, "w", encoding="utf-8") as f:
        json.dump({"client_payload": {"profile": profile,
                                      "autopilot": autopilot or {}}}, f, ensure_ascii=False)
    return p


def run(dispatch, registry=None, out_root=None):
    env = dict(os.environ)
    if registry:
        env["HS_INDUSTRY_REGISTRY"] = registry
    out_root = out_root or tempfile.mkdtemp(prefix="routeout_")
    # 記録の置き場所を試験専用にする。本物の last_route.json を汚すと、
    # 「最後に何が起きたか」の記録が、試験の結果に置き換わる。
    rp = os.path.join(out_root, "last_route.json")
    env["HS_ROUTE_OUT"] = rp
    r = subprocess.run([sys.executable, ROUTER, "--dispatch", dispatch,
                        "--out-root", out_root],
                       capture_output=True, text=True, cwd=ROOT, env=env)
    route = None
    if os.path.exists(rp):
        route = json.load(io.open(rp, encoding="utf-8"))
    return r, route, out_root


def temp_registry(mutate):
    reg = json.load(io.open(REAL_REG, encoding="utf-8"))
    mutate(reg)
    d = tempfile.mkdtemp(prefix="reg_")
    p = os.path.join(d, "registry.json")
    with io.open(p, "w", encoding="utf-8") as f:
        json.dump(reg, f, ensure_ascii=False)
    return p


FAILS = []


def must(label, cond, r=None, extra=""):
    print(("  ok  " if cond else "  ★NG ") + label + (("  " + extra) if extra else ""))
    if not cond:
        FAILS.append(label)
        if r is not None:
            for line in (r.stdout + r.stderr).strip().splitlines()[-14:]:
                print("        " + line)
    return cond


def main():
    print("業種の振り分け: 枝ごとに走らせる\n")

    print("1) 訪問看護。生成器が繋がっていて、門を通る")
    r, route, out = run(dispatch_file(NURSING_PROFILE, {"industry": "nursing"}))
    must("0 で終わる", r.returncode == 0, r, "rc=%d" % r.returncode)
    must("published が true", bool(route and route.get("published")), r,
         str(route and route.get("status")))
    must("care/ に書いている",
         bool(route and route.get("pages") and
              all(p.startswith("care/") for p in route["pages"])), r,
         str(route and (route.get("pages") or [])[:2]))
    must("門を通った枚数を言う", bool(route and route.get("count")), r,
         "count=%s" % (route or {}).get("count"))
    must("実際にファイルが在る",
         all(os.path.exists(os.path.join(out, p)) for p in (route or {}).get("pages", [])), r)
    must("Yakumo のモールに載せていない",
         not any("yakumo" in p for p in (route or {}).get("pages", [])), r)

    print("\n2) 出口が繋がっていない業種。失敗にしないが、黙らない")
    reg = temp_registry(lambda d: d["industries"]["nursing"]["generator"].update(
        {"status": "missing", "gap": "試験のために外した"}))
    r, route, out = run(dispatch_file(NURSING_PROFILE, {"industry": "nursing"}), registry=reg)
    must("0 で終わる(失敗通知を出さない)", r.returncode == 0, r, "rc=%d" % r.returncode)
    must("published は false", bool(route and route.get("published") is False), r,
         str(route and route.get("status")))
    must("状態を no_exit と記録する", bool(route and route.get("status") == "no_exit"), r,
         str(route and route.get("status")))
    must("「出口が繋がっていません」と言う", "出口" in r.stdout, r)
    must("答えが失われていないことを言う", "失われていません" in r.stdout, r)
    must("ページを1枚も作らない", not os.path.isdir(os.path.join(out, "care")), r)

    print("\n3) 業種が入っていない dispatch。これは失敗にする")
    p = dict(NURSING_PROFILE); p.pop("industry")
    r, route, out = run(dispatch_file(p, {}))
    must("非ゼロで終わる", r.returncode != 0, r, "rc=%d" % r.returncode)
    must("状態を no_industry と記録する", bool(route and route.get("status") == "no_industry"), r,
         str(route and route.get("status")))
    must("ページを1枚も作らない", not os.path.isdir(os.path.join(out, "care")), r)

    print("\n4) レジストリに無い業種。似ている業種の生成器で作らない")
    p = dict(NURSING_PROFILE); p["industry"] = "hoken-yakkyoku"
    r, route, out = run(dispatch_file(p, {"industry": "hoken-yakkyoku"}))
    must("非ゼロで終わる", r.returncode != 0, r, "rc=%d" % r.returncode)
    must("状態を unknown_industry と記録する",
         bool(route and route.get("status") == "unknown_industry"), r,
         str(route and route.get("status")))
    must("ページを1枚も作らない", not os.path.isdir(os.path.join(out, "care")), r)

    print("\n5) 生成器が落ちたら、公開しない")
    # 事業所名の無いプロフィールは、生成器が exit 5 で止める(名前の無いページは作らない)。
    p = dict(NURSING_PROFILE); p["company"] = ""
    r, route, out = run(dispatch_file(p, {"industry": "nursing"}))
    must("非ゼロで終わる", r.returncode != 0, r, "rc=%d" % r.returncode)
    must("状態を generator_failed と記録する",
         bool(route and route.get("status") == "generator_failed"), r,
         str(route and route.get("status")))
    must("published は false", bool(route and route.get("published") is False), r)

    print("\n6) 門が落ちたら、公開しない")
    # 門の見る根を、何も無い場所にすると FILE_MISSING で落ちる。
    # 生成は通るが門で止まる、という状態をここで作る。
    env_reg = temp_registry(lambda d: d["industries"]["nursing"]["generator"].update(
        {"manifest": "tools/care/last_manifest.json"}))
    empty = tempfile.mkdtemp(prefix="empty_")
    r2 = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "pagecheck", "validate.py"),
                         "--manifest", os.path.join(out or empty, "x.json")],
                        capture_output=True, text=True, cwd=ROOT)
    must("manifest が無ければ門は非ゼロ", r2.returncode != 0, r2, "rc=%d" % r2.returncode)

    print("")
    if FAILS:
        print("%d 件おかしい。" % len(FAILS))
        return 1
    print("枝ごとに、止まるものは止まり、通るものは通りました。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
