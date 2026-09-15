#!/usr/bin/env python3
# note_drafts.py  (2026-09-16, rebuilt by 番人)
#
# commit 済みの souba/<slug>/index.html から note 下書き(markdown)を作り直す。
# 3.4 の掟: 数字はページと同じ、生 hash や curl は貼らん、競合名は出さん、ダッシュ無し、
#           末尾にページと /kantei/ への link と監修の一行。
#
# 使い方:
#   python3 note_drafts.py --out ~/Downloads/https___shield-2/note_drafts_20260916   # 既定の 8 本
#   python3 note_drafts.py --slugs souba/kyutoki-20man,souba/gaiheki-150man --out /tmp/nd
#   python3 note_drafts.py --dry --slugs souba/ecocute-370l-souba   # 標準出力に 1 本だけ
#
# 抽出は H2 見出しの語で節を選ぶので、souba 型(woven)と 質問型(kyutoki-20man)の両方に効く。

import os, re, io, sys, argparse

BASE = "https://shield.the-horizons-innovation.com"
DASHES = "".join(chr(c) for c in (0x2013, 0x2014, 0x2015, 0x2500))
DASH_RE = re.compile("[" + DASHES + "]")

# 効きそうな順(3.4)。slug は souba/<name>。存在せんものは黙って飛ばす。
MONITOR = [
    ("j002", "souba/kyutoki-20man"),
    ("j001", "souba/gaiheki-150man"),
    ("j038", "souba/flooring"),
    ("p002", "souba/gaiheki"),
    ("p013", "souba/kyutoki"),
    ("p005", "souba/yane-fukikae-slate-hiyou"),
    ("p071", "souba/shiroari"),
    ("p016", "souba/toilet"),
]

def strip_tags(h):
    h = re.sub(r"(?is)<script.*?</script>", " ", h)
    h = re.sub(r"(?is)<style.*?</style>", " ", h)
    h = re.sub(r"(?s)<[^>]+>", " ", h)
    h = h.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&yen;", "¥").replace("&quot;", '"')
    h = re.sub(r"[ \t]+", " ", h)
    h = re.sub(r"\n{3,}", "\n\n", h)
    return h.strip()

SCRUB_TOKENS = ("SHA-256", "SHA256", "sha-256", "sha256", " hash ", "hash ", "curl ", "\u6697\u53f7", "\u30d0\u30c3\u30b8", "\u8a3c\u660e\u30d0\u30a4\u30c8")

def scrub(t):
    # \u6d88\u8cbb\u8005\u5411\u3051 note \u306e\u6389: \u751f hash / curl / \u6697\u53f7\u306e\u8a71\u3092\u542b\u3080\u6587\u3092\u4e38\u3054\u3068\u843d\u3068\u3059\u3002
    import re as _re
    out = []
    for sent in _re.split(r"(?<=\u3002)", t):
        low = sent
        if any(tok in low for tok in SCRUB_TOKENS):
            continue
        if _re.search(r"[0-9a-f]{40,}", low):
            continue
        out.append(sent)
    return _re.sub(r"\s+", " ", "".join(out)).strip()

def clean(t):
    # 掟: ダッシュを除く。3 連ダッシュ罫線は空に、それ以外は句点寄りの区切りに寄せる。
    t = DASH_RE.sub("-", t)  # ここは ASCII ハイフンに寄せる(掟でハイフンは可)
    return t.strip()

def first_table_md(html):
    m = re.search(r"(?is)<table.*?</table>", html)
    if not m:
        return None
    rows = re.findall(r"(?is)<tr[^>]*>(.*?)</tr>", m.group(0))
    out = []
    for r in rows:
        cells = [clean(strip_tags(c)) for c in re.findall(r"(?is)<t[dh][^>]*>(.*?)</t[dh]>", r)]
        cells = [c for c in cells]
        if cells:
            out.append(cells)
    if not out:
        return None
    md = []
    head = out[0]
    md.append("| " + " | ".join(head) + " |")
    md.append("| " + " | ".join(["---"] * len(head)) + " |")
    for r in out[1:]:
        if len(r) < len(head):
            r = r + [""] * (len(head) - len(r))
        md.append("| " + " | ".join(r[:len(head)]) + " |")
    return "\n".join(md)

def sections(html):
    # H2 で割る。各節に (見出し, 本文テキスト) を返す。
    parts = re.split(r"(?is)<h2[^>]*>(.*?)</h2>", html)
    secs = []
    # parts[0] は最初の H2 より前。以降 [見出し, 本体, 見出し, 本体, ...]
    i = 1
    while i < len(parts):
        head = clean(strip_tags(parts[i]))
        body_html = parts[i + 1] if i + 1 < len(parts) else ""
        secs.append((head, body_html))
        i += 2
    return secs

def pick(secs, *keys):
    for head, body in secs:
        if any(k in head for k in keys):
            return head, body
    return None, None

def para_text(body_html, limit=600):
    t = clean(strip_tags(body_html))
    t = re.sub(r"\s+", " ", t)
    return scrub(t)[:limit].strip()

def bullets(body_html, n=4):
    items = [clean(strip_tags(li)) for li in re.findall(r"(?is)<li[^>]*>(.*?)</li>", body_html)]
    items = [scrub(x) for x in items if x]
    items = [x for x in items if x]
    return items[:n]

def faq_pairs(secs, n=2):
    head, body = pick(secs, "よくある質問", "FAQ")
    if not body:
        return []
    # dt/dd, または details/summary, または <p><strong>Q</strong>
    pairs = []
    dts = re.findall(r"(?is)<(?:dt|summary)[^>]*>(.*?)</(?:dt|summary)>", body)
    dds = re.findall(r"(?is)<(?:dd)[^>]*>(.*?)</(?:dd)>", body)
    if dts and dds and len(dts) == len(dds):
        for q, a in list(zip(dts, dds))[:n]:
            pairs.append((clean(strip_tags(q)), scrub(clean(strip_tags(a)))))
        return pairs
    # details 内: summary が Q、残りが A
    for d in re.findall(r"(?is)<details[^>]*>(.*?)</details>", body)[:n]:
        ms = re.search(r"(?is)<summary[^>]*>(.*?)</summary>", d)
        if ms:
            q = clean(strip_tags(ms.group(1)))
            a = scrub(clean(strip_tags(re.sub(r"(?is)<summary.*?</summary>", "", d))))
            pairs.append((q, a[:400]))
    return pairs[:n]

def h1_or_title(html):
    m = re.search(r"(?is)<h1[^>]*>(.*?)</h1>", html)
    if m:
        return clean(strip_tags(m.group(1)))
    m = re.search(r"(?is)<title[^>]*>(.*?)</title>", html)
    return clean(strip_tags(m.group(1))) if m else "(no title)"

def slug_url(slug):
    s = slug.rstrip("/")
    if s.endswith(".html"):
        return BASE + "/" + s
    return BASE + "/" + s + "/"

def build_one(qid, slug, root):
    path = slug if slug.endswith(".html") else os.path.join(slug, "index.html")
    fp = os.path.join(root, path)
    if not os.path.exists(fp):
        return None, "missing: " + fp
    html = io.open(fp, encoding="utf-8").read()
    secs = sections(html)
    q = h1_or_title(html)
    _, lead_b = pick(secs, "結論", "30秒")
    lead = para_text(lead_b, 500) if lead_b else ""
    table = first_table_md(html) or ""
    _, mean_b = pick(secs, "内訳", "費用構成", "目安", "正常な形")
    mean = para_text(mean_b, 500) if mean_b else ""
    _, rf_b = pick(secs, "赤旗", "レッドフラグ")
    rf = bullets(rf_b, 4) if rf_b else []
    faqs = faq_pairs(secs, 2)
    _, chk_b = pick(secs, "確かめる", "適正ですか", "手順")
    chk = para_text(chk_b, 400) if chk_b else ""

    L = []
    L.append("# " + q)
    L.append("")
    if lead:
        L.append(lead)
        L.append("")
    if table:
        L.append("## 相場(2026年・全国)")
        L.append("")
        L.append(table)
        L.append("")
    if mean:
        L.append("## 内訳と目安")
        L.append("")
        L.append(mean)
        L.append("")
    if rf:
        L.append("## 疑う赤旗")
        L.append("")
        for b in rf:
            L.append("- " + b)
        L.append("")
    for i, (qq, aa) in enumerate(faqs):
        if i == 0:
            L.append("## よくある質問")
            L.append("")
        L.append("**Q. " + qq + "**")
        L.append("")
        L.append("A. " + aa)
        L.append("")
    if chk:
        L.append("## 手元の見積もりを確かめる")
        L.append("")
        L.append(chk)
        L.append("")
    L.append("---")
    L.append("")
    L.append("元ページ(数字の出典): " + slug_url(slug))
    L.append("")
    L.append("無料・匿名で高いか即判定: " + BASE + "/kantei/")
    L.append("")
    L.append("監修: 大賀俊勝(建設実務30年)。数字は souba-db 2.2.0(2026-08-17)。当社は紹介料を受け取らん。")
    md = "\n".join(L).rstrip() + "\n"

    # 掟の最終検査
    warns = []
    if DASH_RE.search(md):
        warns.append("DASH remained")
    if re.search(r"(?i)sha-?256|curl |[0-9a-f]{40,}", md):
        warns.append("raw hash/curl leaked")
    for comp in ("アリプロ", "ヌリカエ", "リショップ", "くらしのマーケット", "ホームプロ", "リフォームガイド"):
        if comp in md:
            warns.append("competitor name: " + comp)
    return md, (";".join(warns) if warns else "")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".", help="repo root (souba/ の親)")
    ap.add_argument("--slugs", default="", help="カンマ区切りの souba/<slug>。空なら既定の 8 本")
    ap.add_argument("--out", default="note_drafts_out")
    ap.add_argument("--dry", action="store_true", help="標準出力に出すだけ")
    a = ap.parse_args()
    root = os.path.abspath(a.root)

    if a.slugs.strip():
        jobs = [(None, s.strip()) for s in a.slugs.split(",") if s.strip()]
    else:
        jobs = MONITOR

    if not a.dry:
        os.makedirs(a.out, exist_ok=True)
    idx = []
    for k, (qid, slug) in enumerate(jobs, 1):
        md, warn = build_one(qid, slug, root)
        name = (qid + "_" if qid else "") + slug.split("/")[-1].replace(".html", "") + ".md"
        if md is None:
            print("SKIP %-28s %s" % (slug, warn), file=sys.stderr)
            continue
        if a.dry:
            print(md)
        else:
            io.open(os.path.join(a.out, name), "w", encoding="utf-8").write(md)
        idx.append((k, name, slug, warn))
        print("%-2d %-26s %s" % (k, name, ("WARN " + warn) if warn else "ok"), file=sys.stderr)

    if not a.dry:
        rl = ["# note 下書き(自動生成)", "", "生成器: ops/monitor_pages_20260915/note_drafts.py", "元: commit 済みの souba/<slug>/index.html", "掟: 数字はページと同じ / 生 hash・curl 無し / 競合名無し / ダッシュ無し", "", "順(効きそうな順):", ""]
        for k, name, slug, warn in idx:
            rl.append("%d. %s  <- %s%s" % (k, name, slug, ("  [WARN " + warn + "]") if warn else ""))
        io.open(os.path.join(a.out, "README.md"), "w", encoding="utf-8").write("\n".join(rl) + "\n")
        print("\nwrote %d drafts + README to %s" % (len(idx), a.out), file=sys.stderr)

if __name__ == "__main__":
    main()
