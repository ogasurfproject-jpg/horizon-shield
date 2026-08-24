#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CI が見るものを、押す前に手元で見る。

なぜ要るか (2026-08-24):
  2026-08-23 から 08-24 にかけて、押すたびに CI が赤くなった。
  赤くなるたび、社長のところにメールが飛んだ。中身はどれも同じ種類である。
  「手元では動くが、CI には無いもの(鍵・別リポジトリ)を要求していた」。
  赤は、押したあとに気づくものではない。押す前に気づくものである。

  ここに検査の一覧を書き写さない。書き写せば、いつか片方だけ直る。
  読むのは .github/workflows/*.yml そのもの。
  CI が走らせる run: を、そのまま手元で走らせる。

  走らせられないものは、通ったことにしない。「見ていない」と名前で言う。
  鍵が要る手順、条件つきの手順、式が入っている手順は、手元には無い。
  無いものを「ok」と書けば、この道具そのものが嘘になる。
"""
import os
import re
import subprocess
import sys

try:
    import yaml
except ImportError:
    sys.stderr.write("PyYAML が要ります: pip3 install --user pyyaml\n")
    sys.exit(2)

ROOT = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                      capture_output=True, text=True).stdout.strip()
if not ROOT:
    ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WF = os.path.join(ROOT, ".github", "workflows")

EXPR = re.compile(r"\$\{\{")


def push_triggered(doc):
    """push か pull_request で走るワークフローだけを見る。
    schedule だけのものは、押しても赤くならない。ここでは扱わない。"""
    on = doc.get("on") or doc.get(True)   # YAML 1.1 は on: を True と読む
    if isinstance(on, str):
        return on in ("push", "pull_request")
    if isinstance(on, list):
        return any(k in ("push", "pull_request") for k in on)
    if isinstance(on, dict):
        return any(k in ("push", "pull_request") for k in on)
    return False


def secret_bearing(step):
    blob = str(step.get("run", "")) + str(step.get("env", "")) + str(step.get("with", ""))
    return "secrets." in blob


# CI にしか無い変数。手元で書き込もうとすると、その手順だけが落ちる。
# 落ちたのは測られたものではなく、計器のほうである。
CI_ONLY_ENV = ("GITHUB_STEP_SUMMARY", "GITHUB_OUTPUT", "GITHUB_ENV", "GITHUB_PATH")


def ci_only_env(cmd):
    for v in CI_ONLY_ENV:
        if v in cmd:
            return v
    return None


def collect():
    """(ワークフロー, ジョブ, 手順名, コマンド, 飛ばす理由) を集める。"""
    out = []
    if not os.path.isdir(WF):
        return out
    for fn in sorted(os.listdir(WF)):
        if not fn.endswith((".yml", ".yaml")):
            continue
        path = os.path.join(WF, fn)
        with open(path, encoding="utf-8") as f:
            try:
                doc = yaml.safe_load(f)
            except Exception as e:
                out.append((fn, "-", "(読めない)", None, "YAML が読めない: %s" % e))
                continue
        if not isinstance(doc, dict) or not push_triggered(doc):
            continue
        for jname, job in (doc.get("jobs") or {}).items():
            if not isinstance(job, dict):
                continue
            # 配布のジョブは、手元では走らせない。
            # 2026-08-24、static.yml の組み立て手順を手元で走らせたところ、
            # リポジトリ全体を _public/ に複製した。その中には、git が無視している
            # 鍵マネージャとお客様の契約書が入っていた。CI の checkout には無いが、
            # 手元にはある。同じ run: でも、走る場所が違えば触るものが違う。
            if "environment" in job:
                out.append((fn, jname, "(配布のジョブ全体)", None,
                            "配布のジョブ(environment: 宣言あり)。手元では走らせない"))
                continue
            for step in (job.get("steps") or []):
                if not isinstance(step, dict):
                    continue
                name = step.get("name") or (step.get("uses") or step.get("run", ""))[:40]
                if "run" not in step:
                    continue                      # uses: は手元では要らない
                cmd = step["run"]
                why = None
                if secret_bearing(step):
                    why = "鍵が要る(手元には無い)"
                elif "if" in step:
                    why = "条件つき(CI 側でしか決まらない)"
                elif EXPR.search(cmd):
                    why = "式が入っている"
                elif ci_only_env(cmd):
                    why = "CI にしか無い変数を使う($%s)" % ci_only_env(cmd)
                out.append((fn, jname, str(name), cmd, why))
    return out


def main():
    argv = sys.argv[1:]
    quiet = "--quiet-on-pass" in argv
    checks = collect()
    if not checks:
        print("押しても走る検査が見つかりません。.github/workflows を確認してください。")
        return 1

    ran, failed, skipped = [], [], []
    lines = []
    for fn, jname, name, cmd, why in checks:
        label = "%s / %s" % (fn.replace(".yml", ""), name)
        if why:
            skipped.append((label, why))
            lines.append("  --  %s\n      見ていない: %s" % (label, why))
            continue
        p = subprocess.run(["bash", "-lc", cmd], cwd=ROOT,
                           capture_output=True, text=True)
        if p.returncode == 0:
            ran.append(label)
            lines.append("  ok  %s" % label)
        else:
            failed.append((label, p.returncode, (p.stdout + p.stderr)[-2500:]))
            lines.append("  NG  %s  (終了コード %d)" % (label, p.returncode))

    if failed or not quiet:
        print("押す前の検査  (.github/workflows から読み出し)")
        print("")
        print("\n".join(lines))
        print("")
        print("走らせた %d 件 / 落ちた %d 件 / 見ていない %d 件"
              % (len(ran), len(failed), len(skipped)))

    if failed:
        print("")
        for label, rc, tail in failed:
            print("=" * 60)
            print("落ちた: %s" % label)
            print("-" * 60)
            print(tail.rstrip())
        print("=" * 60)
        print("")
        print("このまま押すと CI が赤くなり、メールが飛びます。先にここを直してください。")
        print("どうしても押す必要があるときだけ: git push --no-verify")
        return 1

    if skipped and not quiet:
        print("")
        print("※ 見ていない手順があります。手元で緑でも、CI で赤くなる余地は残っています。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
