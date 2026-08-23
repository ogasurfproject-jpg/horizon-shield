# -*- coding: utf-8 -*-
"""tools/ の運用スクリプトを git で追跡できるようにする。

*.py は既定で除外されているので、必要なものだけ ! で戻す。
今回のものは、事故の直し方そのものが残る道具なので、追跡する。
"""
import io, os, sys
P = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".gitignore")
P = os.path.abspath(os.environ.get("HS_GITIGNORE", P))
ADD = [
    "!tools/survey1_report.py",
    "!tools/patch_industry.py",
    "!tools/patch_signature.py",
    "!tools/patch_ingest.py",
    "!tools/set_industry.py",
    "!tools/replay_answer.py",
    "!tools/patch_survey_index.py",
    "!tools/patch_qualifier.py",
    "!tools/gitignore_tools.py",
    "!tools/nursing/validate_rules.py",
    "!tools/nursing/patch_nursing_questions.py",
]
s = io.open(P, encoding="utf-8").read()
anchor = "!tools/survey1_aggregate.py"
if anchor not in s:
    print("アンカーが見つかりません: " + anchor, file=sys.stderr); sys.exit(1)
missing = [a for a in ADD if a + "\n" not in s]
if not missing:
    print("すでに全部入っています"); sys.exit(0)
i = s.find(anchor); j = s.find("\n", i) + 1
s = s[:j] + "\n# 2026-08-23 事故対応の道具。直し方そのものが残るので追跡する。\n" + "\n".join(missing) + "\n" + s[j:]
io.open(P, "w", encoding="utf-8").write(s)
print("追加しました: " + ", ".join(missing))
