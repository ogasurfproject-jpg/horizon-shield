#!/usr/bin/env python3
"""llms_souba_list.py: the llms.txt section that lists the price pages, one line each: the page and its answer sentence.

    llms_souba_list.py <repo_root> [--write]
    llms_souba_list.py selftest

Reads souba/*/index.html after souba_rebuild.py (the sentence is the paragraph marked data-gen="souba-head-v1") and
data/souba-db.json. Lists indexable pages only (no noindex, no forwarding). The section goes right before
"## よくある質問・直接回答 (AEO)" in llms.txt, in the file's own form "- [title](url): text"; a second run replaces it.
Without --write it prints the section. Standard library only; sends nothing.
"""
import glob
import html
import json
import os
import re
import sys

SITE = "https://shield.the-horizons-innovation.com"
START = "## 相場頁の一覧(頭の 1 文)"
END = "<!-- /souba-list -->"
BEFORE = "## よくある質問・直接回答 (AEO)"


def section(root):
    meta = json.load(open(os.path.join(root, "data", "souba-db.json"), encoding="utf-8"))["_meta"]
    lines = [START, "", "相場の頁ごとの答えの 1 文。数字は HORIZON SHIELD 相場データ souba-db %s(%s 更新)の行から機械で出した物。" % (meta["version"], meta["updated_at"]), ""]
    for p in sorted(glob.glob(os.path.join(root, "souba", "*", "index.html"))):
        src = open(p, encoding="utf-8").read()
        if re.search(r'name="robots"\s+content="[^"]*noindex', src) or 'http-equiv="refresh"' in src:
            continue
        m = re.search(r'<p[^>]*data-gen="souba-head-v1"[^>]*>(.*?)</p>', src, re.S)
        if not m:
            continue
        h = re.search(r"<h1[^>]*>(.*?)</h1>", src, re.S | re.I)
        title = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", h.group(1) if h else ""))).strip()
        slug = os.path.basename(os.path.dirname(p))
        lines.append("- [%s](%s/souba/%s/): %s" % (title, SITE, slug, html.unescape(m.group(1)).strip()))
    lines += ["", END, ""]
    return "\n".join(lines)


def apply(text, sec):
    if START in text:
        a = text.index(START)
        b = text.index(END, a) + len(END)
        rest = text[b:].lstrip("\n")
        return text[:a] + sec + "\n" + rest
    k = text.index(BEFORE)
    return text[:k] + sec + "\n" + text[k:]


def selftest():
    sec = "%s\n\n- [x](u): y\n\n%s\n" % (START, END)
    base = "# t\n\n%s\n- a\n" % BEFORE
    once = apply(base, sec)
    twice = apply(once, sec)
    ok = once == twice and once.index(START) < once.index(BEFORE)
    print("%s the section goes before the AEO heading and a second run replaces it" % ("ok  " if ok else "NG  "))
    print("SELFTEST %s" % ("ok" if ok else "NG"))
    return 0 if ok else 1


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__); return 2
    if argv[0] == "selftest":
        return selftest()
    root = argv[0]
    sec = section(root)
    if "--write" in argv:
        p = os.path.join(root, "llms.txt")
        t = open(p, encoding="utf-8").read()
        open(p, "w", encoding="utf-8").write(apply(t, sec))
    print(sec)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
