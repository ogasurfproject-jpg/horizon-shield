#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# patch23: cross links. The standalone register repository was an island. This
# points the existing assets at it: the README repository map, the directory
# page, and the members index. Each link says what the target is for, so a
# reader and a crawler both learn that a machine readable copy exists.
# Default is dry-run. --apply writes. Anchors expect exactly 1 hit each.
import sys, subprocess, tempfile, os, re

APPLY = "--apply" in sys.argv
EDITS = [('README.md', '| everything else | The GitHub Pages site for the human facing service at the-horizons-innovation.com |\n\n## JIDEC: verify this project without trusting it', '| everything else | The GitHub Pages site for the human facing service at the-horizons-innovation.com |\n\n## The register, as a repository\n\nThe same measurements are published as a standalone, machine generated repository:\n**[mcp-conduct-register](https://github.com/ogasurfproject-jpg/mcp-conduct-register)**.\n\nNobody selects the rows there either. A script rebuilds the table from the public API once a day,\nand the same run writes a\n[`register.json`](https://raw.githubusercontent.com/ogasurfproject-jpg/mcp-conduct-register/main/register.json)\nsnapshot so an agent can read the register without parsing Markdown. It carries a `CITATION.cff`,\nso the register can be cited the way a dataset is cited, and an\n[`llms.txt`](https://raw.githubusercontent.com/ogasurfproject-jpg/mcp-conduct-register/main/llms.txt)\nthat states in plain words what the register is and, more importantly, what it is not.\n\n## JIDEC: verify this project without trusting it', 'readme backlink section'), ('verify-directory/index.html', '<section id="listed">\n  <div class="wrap">\n    <div class="kh">Get listed</div>', '<section>\n  <div class="wrap">\n    <div class="kh">The same rows, for machines</div>\n    <h2>An agent should not have to read this page</h2>\n    <p class="slead">Everything above is also published as a repository that rebuilds itself from the same API once a day:\n      <a href="https://github.com/ogasurfproject-jpg/mcp-conduct-register" rel="noopener">mcp-conduct-register</a>.\n      A script writes the table, so nobody chooses the rows there either. The same run publishes a\n      <a href="https://raw.githubusercontent.com/ogasurfproject-jpg/mcp-conduct-register/main/register.json" rel="noopener">register.json</a>\n      snapshot and an\n      <a href="https://raw.githubusercontent.com/ogasurfproject-jpg/mcp-conduct-register/main/llms.txt" rel="noopener">llms.txt</a>,\n      and the repository carries a citation file, so the register can be quoted and cited without going through any page we control.</p>\n    <p class="slead">The live API underneath all of it answers directly, with no key:\n      <span class="mono">curl -s https://gate.horizonshield.dev/register</span></p>\n  </div>\n</section>\n\n<section id="listed">\n  <div class="wrap">\n    <div class="kh">Get listed</div>', 'directory machine section'), ('verify-directory/members/index.html', '  <div class="card">\n    <h2 id="lh"></h2>', '  <div class="card">\n    <h2 id="mh"></h2>\n    <p class="note" id="m1"></p>\n  </div>\n  <div class="card">\n    <h2 id="lh"></h2>', 'members card slot'), ('verify-directory/members/index.html', '    lh: "What a row here means",', '    mh: "The same rows, for machines",\n    m1a: "This table is also published as a repository that rebuilds itself from the same API once a day, with a JSON snapshot and a citation file: ",\n    lh: "What a row here means",', 'members en strings'), ('verify-directory/members/index.html', '    lh: "\u3053\u306e1\u884c\u304c\u610f\u5473\u3059\u308b\u3053\u3068",', '    mh: "\u540c\u3058\u884c\u3092\u3001\u6a5f\u68b0\u306e\u305f\u3081\u306b",\n    m1a: "\u3053\u306e\u8868\u306f\u3001\u540c\u3058API\u304b\u30891\u65e5\u306b1\u5ea6\u81ea\u52d5\u3067\u518d\u751f\u6210\u3055\u308c\u308b\u30ea\u30dd\u30b8\u30c8\u30ea\u3068\u3057\u3066\u3082\u516c\u958b\u3055\u308c\u3066\u3044\u308b\u3002JSON\u30b9\u30ca\u30c3\u30d7\u30b7\u30e7\u30c3\u30c8\u3068\u5f15\u7528\u30d5\u30a1\u30a4\u30eb\u4ed8\u304d: ",\n    lh: "\u3053\u306e1\u884c\u304c\u610f\u5473\u3059\u308b\u3053\u3068",', 'members ja strings'), ('verify-directory/members/index.html', '  document.getElementById("lh").textContent = T.lh;', '  document.getElementById("mh").textContent = T.mh;\n  const m1 = document.getElementById("m1");\n  m1.textContent = T.m1a;\n  const ml2 = document.createElement("a");\n  ml2.href = "https://github.com/ogasurfproject-jpg/mcp-conduct-register";\n  ml2.rel = "noopener";\n  ml2.textContent = "mcp-conduct-register";\n  ml2.style.borderBottom = "1px dashed rgba(255,255,255,.35)";\n  m1.appendChild(ml2);\n  document.getElementById("lh").textContent = T.lh;', 'members wiring')]

def main():
    contents = {}
    ok = True
    for path, old, new, name in EDITS:
        if path not in contents:
            contents[path] = open(path, encoding="utf-8").read()
        n = contents[path].count(old)
        print("[anchor] %s: %d occurrence(s) (expect 1)" % (name, n))
        if n != 1: ok = False
    if not ok:
        print("ABORT: anchor mismatch. Nothing written.")
        sys.exit(1)
    for path, old, new, name in EDITS:
        contents[path] = contents[path].replace(old, new, 1)

    rd = contents["README.md"]
    vd = contents["verify-directory/index.html"]
    mi = contents["verify-directory/members/index.html"]
    REPO = "github.com/ogasurfproject-jpg/mcp-conduct-register"
    checks = [
        (rd.count(REPO) >= 1, "readme: links to the register repo"),
        ("register.json" in rd and "llms.txt" in rd, "readme: names the machine readable files"),
        (vd.count(REPO) >= 1, "directory: links to the register repo"),
        ("register.json" in vd, "directory: links the json snapshot"),
        (mi.count(REPO) == 1, "members: links to the register repo"),
        (mi.count('id="mh"') == 1 and mi.count('id="m1"') == 1, "members: card slots present"),
        (mi.count("T.mh") == 1 and mi.count("T.m1a") == 1, "members: strings wired"),
        (mi.count("mh:") == 2, "members: label in both languages"),
    ]
    for path in ("verify-directory/index.html", "verify-directory/members/index.html"):
        src = contents[path]
        for i, blk in enumerate(re.findall(r"<script>(.*?)</script>", src, re.S)):
            tf = tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8"); tf.write(blk); tf.close()
            r = subprocess.run(["node", "--check", tf.name], capture_output=True, text=True)
            os.unlink(tf.name)
            checks.append((r.returncode == 0, "%s script %d: node --check ok" % (path, i + 1) + ("" if r.returncode == 0 else " :: " + r.stderr.strip()[:160])))
    allok = True
    for good, label in checks:
        print(("[ok]  " if good else "[FAIL] ") + label)
        allok = allok and good
    if not allok:
        print("ABORT: invariant failed. Nothing written.")
        sys.exit(1)
    if not APPLY:
        print("DRY-RUN OK. Nothing written. Run with --apply to write.")
        return
    for path in contents:
        open(path, "w", encoding="utf-8").write(contents[path])
        print("[written] " + path)
    print("APPLY done. Pages only, no gate deploy needed.")

if __name__ == "__main__":
    main()
