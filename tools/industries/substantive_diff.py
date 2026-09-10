#!/usr/bin/env python3
"""Count the lines of a staged diff that are a real change.

Why this exists (2026-09-10).

yakumo-content-autopublish has carried a "nothing changed, skip the publish" gate
for weeks. It never fired once. The gate asked `git status --porcelain $PATHS`,
and $PATHS comes from commit_paths, which contains tools/yakumo/last_manifest.json
and data/yakumo-content-manifest.json. Both carry a generated_at / updated_at that
moves every run. So the gate was looking at a set that contained the thing that
defeats it. It was written correctly and could not work.

The cost, measured: commit 9251f540 on 2026-09-10 says
"construction: auto-publish 11 verified pages (門を通過)". Its content is two
timestamp lines and nothing else. Zero pages changed. The same eleven URLs were
resubmitted to IndexNow. A commit that names a publish that did not happen is
the same defect this whole repository exists to hunt, wearing work clothes.

The repair is not "look at fewer files". Excluding files by name means the day a
generator publishes real .json content, the gate goes silent about a real change.
The repair is to say what a change IS: a line that moved for a reason other than
its own clock.

What this does not cover, said here rather than left to be found: a self moving
field that is not in the list below is counted as a change, and this file will
report a publish that did not happen, exactly as before. The list is the whole
of the claim. Add to it when a new one appears, and add a case to the selftest.
"""
import re
import sys

# Fields that move every run for their own reasons. A record carrying one cannot
# be compared to its predecessor by bytes.
SELF_MOVING = re.compile(r'"(generated_at|updated_at|rebuilt_at|pruned_at)"\s*:')


def count(lines):
    n = 0
    for ln in lines:
        if not ln or ln[0] not in "+-":
            continue
        if ln.startswith("+++") or ln.startswith("---"):
            continue
        if SELF_MOVING.search(ln):
            continue
        n += 1
    return n


def _selftest():
    cases = [
        ("empty diff", [], 0),
        ("only the file headers", ["--- a/x.json", "+++ b/x.json", "@@ -1,5 +1,5 @@", " context"], 0),
        ("only a generated_at", ['-  "generated_at": "2026-09-10T07:49:22Z",',
                                 '+  "generated_at": "2026-09-10T07:52:18Z",'], 0),
        ("only an updated_at", ['-  "updated_at": "a",', '+  "updated_at": "b",'], 0),
        ("one real line beside a timestamp", ['-  "generated_at": "a",', '+  "generated_at": "b",',
                                              '-  "member_no": "No.002",', '+  "member_no": "No.001",'], 2),
        ("a page body that merely mentions the word generated_at", ['+<p>generated_at is a field name</p>'], 1),
        ("a minus line that is not a header", ["-  old"], 1),
        ("a context line is never counted", ["   nothing"], 0),
    ]
    bad = 0
    for name, lines, want in cases:
        got = count(lines)
        ok = got == want
        if not ok:
            bad += 1
        print(("ok   " if ok else "NG   ") + name + "  want=" + str(want) + " got=" + str(got))
    print("")
    if bad:
        print("=== " + str(len(cases) - bad) + " / " + str(len(cases)) + " 不合格あり (substantive_diff) ===")
        return 1
    print("=== " + str(len(cases)) + " / " + str(len(cases)) + " 合格 (substantive_diff) ===")
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--selftest":
        raise SystemExit(_selftest())
    print(count(sys.stdin.read().splitlines()))
