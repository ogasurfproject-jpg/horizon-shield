# -*- coding: utf-8 -*-
"""
/yakumo/souba/ の入口(souba_index.py、2026-11-16)を確かめる。網に出ない。リポジトリの file だけを読み、書くのは一時の写しだけ。

  python3 tools/yakumo/souba_index_test.py

見ること:
  1. 一覧の頁に載る頁が、sitemap-yakumo.xml に在って答えの印を持ち、generate.ANSWER_HOLD と ANSWER_SKIP に無い頁と同じ組
  2. ANSWER_HOLD と ANSWER_SKIP の頁、souba_questions.json に無く sitemap にも無い頁への link が、一覧、/yakumo/、店の頁、llms.txt の印の中に 0
  3. 一覧の頁と、/yakumo/ と店の頁の印の中に金額の形が 0(門 v1.4.0 の物差し)
  4. 店の頁の印の中の link は、その店の答えの頁の全部と一覧だけ
  5. robots.txt の sitemap-yakumo.xml の行、sitemap-yakumo.xml の一覧の loc、各 file の印の組が、どれもちょうど 1
  6. 台帳 data/yakumo-content-manifest.json の一覧の指紋がちょうど 1 つで、今の頁から計算した物と同じ
  7. 写しの上で、印と一覧と足した行を外してから当てると、今のリポジトリと同じ bytes に戻る
  8. 写しの上で、もう一度当てると 0 file(bytes も同じ)
"""
import glob, json, os, re, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import generate as G  # noqa: E402
import souba_index as SI  # noqa: E402
sys.path.insert(0, os.path.join(ROOT, "tools", "pagecheck"))
from validate import find_money  # noqa: E402

results = []
FILES = ("yakumo/souba/index.html", "yakumo/index.html", "robots.txt", "llms.txt", "sitemap-yakumo.xml", "data/yakumo-content-manifest.json")


def chk(name, ok, detail=""):
    results.append(bool(ok))
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  " + str(detail)[:300]))


def rd(root, rel):
    p = os.path.join(root, rel)
    return open(p, encoding="utf-8").read() if os.path.exists(p) else ""


def block(t):
    m = SI.BLOCK_RE.search(t)
    return m.group(0) if m else ""


def visible(t):
    return re.sub(r"<[^>]+>", " ", re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", t, flags=re.S))


def answer_links(t):
    return set(re.findall(re.escape(G.BASE) + r"/yakumo/souba/([a-z0-9-]+)/", t))


def strip(root):
    """一覧と、印の塊と、足した行を外す(当てる前の形に戻す)"""
    os.remove(os.path.join(root, "yakumo", "souba", "index.html"))
    for rel in ["yakumo/index.html", "llms.txt"] + ["yakumo/%s/index.html" % s for s in stores()]:
        p = os.path.join(root, rel)
        t = open(p, encoding="utf-8").read()
        open(p, "w", encoding="utf-8").write(SI.BLOCK_RE.sub("", t, count=1))
    p = os.path.join(root, "robots.txt")
    ls = open(p, encoding="utf-8").readlines()
    open(p, "w", encoding="utf-8").write("".join(l for l in ls if l.rstrip("\n") != SI.SITEMAP_LINE))
    p = os.path.join(root, "sitemap-yakumo.xml")
    ls = open(p, encoding="utf-8").readlines()
    open(p, "w", encoding="utf-8").write("".join(l for l in ls if "<loc>%s</loc>" % SI.INDEX_URL not in l))
    p = os.path.join(root, "data", "yakumo-content-manifest.json")
    led = json.load(open(p, encoding="utf-8"))
    led["entries"] = [e for e in led["entries"] if e.get("slug") != "yakumo/souba"]
    json.dump(led, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def stores():
    return sorted({os.path.basename(os.path.dirname(p)) for p in glob.glob(os.path.join(ROOT, "yakumo", "no[0-9][0-9][0-9]", "index.html"))
                   if SI.OPEN in open(p, encoding="utf-8").read()})


def run(root):
    return subprocess.run([sys.executable, "-I", "-B", os.path.join(root, "tools", "yakumo", "souba_index.py"), "--apply", "--date", DATE],
                          capture_output=True, text=True)


def snap(root):
    out = {}
    for rel in FILES + tuple("yakumo/%s/index.html" % s for s in stores()):
        p = os.path.join(root, rel)
        out[rel] = open(p, "rb").read() if os.path.exists(p) else None
    for p in glob.glob(os.path.join(root, "yakumo", "souba", "*", "index.html")):
        out[os.path.relpath(p, root)] = open(p, "rb").read()
    return out


def main():
    global DATE
    idx = rd(ROOT, "yakumo/souba/index.html")
    m = re.search(r"<loc>%s</loc><lastmod>(\d{4}-\d{2}-\d{2})</lastmod>" % re.escape(SI.INDEX_URL), rd(ROOT, "sitemap-yakumo.xml"))
    DATE = m.group(1) if m else "2026-11-17"
    pages = SI.answer_pages()
    want = {p["slug"] for p in pages}
    locs = set(SI.LOC_RE.findall(rd(ROOT, "sitemap-yakumo.xml")))
    expect = set()
    for p in glob.glob(os.path.join(ROOT, "yakumo", "souba", "*", "index.html")):
        s = os.path.basename(os.path.dirname(p))
        if "%s/yakumo/souba/%s/" % (G.BASE, s) in locs and "<!-- yakumo-answer-v1 -->" in open(p, encoding="utf-8").read() and s not in (G.ANSWER_HOLD | G.ANSWER_SKIP):
            expect.add(s)
    chk("1 一覧の頁に載る頁が、出ている答えの頁と同じ組(%d)" % len(expect), answer_links(idx) == expect == want, (sorted(answer_links(idx) ^ expect), sorted(want ^ expect)))
    held = (G.ANSWER_HOLD | G.ANSWER_SKIP) | {s for s in answer_links(idx) if "%s/yakumo/souba/%s/" % (G.BASE, s) not in locs}
    for d in glob.glob(os.path.join(ROOT, "yakumo", "souba", "*")):
        s = os.path.basename(d)
        if os.path.isdir(d) and "%s/yakumo/souba/%s/" % (G.BASE, s) not in locs:
            held.add(s)
    places = {"一覧": idx, "/yakumo/ の印": block(rd(ROOT, "yakumo/index.html")), "llms.txt の印": block(rd(ROOT, "llms.txt"))}
    for s in stores():
        places["%s の印" % s] = block(rd(ROOT, "yakumo/%s/index.html" % s))
    for k, t in places.items():
        chk("2 %s に、載せない頁(%d)への link が 0" % (k, len(held)), not (answer_links(t) & held), sorted(answer_links(t) & held))
    for k, t in places.items():
        if k.startswith("llms"):
            continue
        chk("3 %s に金額の形が 0" % k, find_money(visible(t)) is None, find_money(visible(t)))
    for s in stores():
        mine = {p["slug"] for p in pages if p["ms"] == s}
        b = places["%s の印" % s]
        chk("4 %s の印は、その店の答えの頁 %d 枚と一覧だけ" % (s, len(mine)), answer_links(b) == mine and SI.INDEX_URL in b, sorted(answer_links(b) ^ mine))
    chk("5 robots.txt の sitemap-yakumo.xml の行が 1", rd(ROOT, "robots.txt").splitlines().count(SI.SITEMAP_LINE) == 1)
    chk("5 sitemap-yakumo.xml の一覧の loc が 1", rd(ROOT, "sitemap-yakumo.xml").count("<loc>%s</loc>" % SI.INDEX_URL) == 1)
    for rel in ["yakumo/index.html", "llms.txt"] + ["yakumo/%s/index.html" % s for s in stores()]:
        t = rd(ROOT, rel)
        chk("5 %s の印の組が 1" % rel, t.count(SI.OPEN) == 1 and t.count(SI.CLOSE) == 1)
    chk("5 印を持つ店の頁が、答えの頁の店の全部(%s)" % ",".join(stores()), stores() == sorted({p["ms"] for p in pages}))
    led = json.load(open(os.path.join(ROOT, "data", "yakumo-content-manifest.json"), encoding="utf-8"))
    ents = [e for e in led["entries"] if e.get("slug") == "yakumo/souba"]
    chk("6 台帳の一覧の指紋が 1 つで、今の頁から計算した物と同じ", len(ents) == 1 and ents[0] == G.fingerprint(SI.INDEX_URL, idx), ents)
    tmp = tempfile.mkdtemp(prefix="souba_index_test_")
    try:
        for rel in ("tools", "yakumo", "data", "sitemap-yakumo.xml", "robots.txt", "llms.txt"):
            s, d = os.path.join(ROOT, rel), os.path.join(tmp, rel)
            (shutil.copytree if os.path.isdir(s) else shutil.copy)(s, d)
        now = snap(tmp)
        strip(tmp)
        r = run(tmp)
        chk("7 外してから当てると 8 file と台帳の 1 行を書き、今のリポジトリと同じ bytes", r.returncode == 0 and "WROTE 8 file(s), LEDGER +1" in r.stdout and snap(tmp) == now,
            r.stdout[-300:] + r.stderr[-300:] + str(sorted(k for k, v in snap(tmp).items() if now.get(k) != v)))
        r = run(tmp)
        chk("8 もう一度当てると 0 file で、bytes が同じ", r.returncode == 0 and r.stdout.rstrip().endswith("WROTE 0 file(s), LEDGER +0") and snap(tmp) == now, r.stdout[-300:] + r.stderr[-300:])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("\n一覧 %d 枚、店 %d、確かめ %d / 失敗 %d" % (len(want), len(stores()), len(results), results.count(False)))
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
