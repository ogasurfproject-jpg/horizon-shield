# -*- coding: utf-8 -*-
"""
八雲 生成コンテンツ プリフライト検証 (fail-closed)

目的: 「絶対に Google / Bing にエラーを出さない」ための静的関所。
1枚でも落ちたらバッチ全体を不適格(exit 1)にする。GitHub Action はこれが通った時だけ commit する。

チェック項目(各ページ):
  - HTML基本構造(<html> / <title> / </html>)
  - <script type="application/ld+json"> が全て正当なJSONで @context/@type を持つ
  - canonical が存在し、ファイルパスから導かれる正規URLと一致
  - 必須メタ(title / description / robots=index,follow / author)
  - 禁止語(MOAT) "32.5" / "danger_threshold" / "WPC" が本文に無い
  - em/en/bar dash(U+2014/2013/2015) が無い
  - 金額数字(¥1,234 / 1,234円 / 12万円 等)が無い(施主向け加盟店面は金額非表示)
  - モール(/yakumo/)とHORIZON SHIELDルートへのバックリンクが有る(認知度導線)
  - 内部リンクが絶対URL(https://shield.the-horizons-innovation.com/...)で壊れていない形

使い方:
  python3 tools/yakumo/validate.py --manifest tools/yakumo/last_manifest.json
  python3 tools/yakumo/validate.py --paths yakumo/souba/xxx/index.html ...
"""
import argparse, json, sys, os, re

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BASE = "https://shield.the-horizons-innovation.com"
MOAT_FORBIDDEN = ["32.5", "danger_threshold", "WPC"]
FORBIDDEN_DASH = {"—": "EM", "–": "EN", "―": "BAR"}
LD_RE = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)
CANON_RE = re.compile(r'<link rel="canonical" href="([^"]+)"')
TITLE_RE = re.compile(r"<title>(.*?)</title>", re.S)
DESC_RE = re.compile(r'<meta name="description" content="([^"]*)"')
ROBOTS_RE = re.compile(r'<meta name="robots" content="([^"]*)"')
AUTHOR_RE = re.compile(r'<meta name="author" content="([^"]*)"')
# 金額: ¥123 / 123円 / 12万円 / 1,234,567 円 など(数字を伴う通貨表現)
MONEY_RE = re.compile(r'(¥\s*\d|\d[\d,]*\s*円|\d+\s*万円)')
# 本文(タグ除去)で禁止語・金額を見るため簡易にscript/styleを剥がす
SCRIPT_STYLE_RE = re.compile(r'<(script|style)\b[^>]*>.*?</\1>', re.S)
TAG_RE = re.compile(r'<[^>]+>')

def path_to_canonical(relpath):
    # yakumo/souba/xxx/index.html -> https://.../yakumo/souba/xxx/
    rel = relpath.replace("\\", "/")
    rel = re.sub(r'/index\.html$', '/', rel)
    if not rel.endswith('/'):
        rel += '/'
    return BASE + "/" + rel

def visible_text(html):
    t = SCRIPT_STYLE_RE.sub(' ', html)
    t = TAG_RE.sub(' ', t)
    return t

def check_page(relpath):
    errs = []
    abspath = os.path.join(REPO_ROOT, relpath)
    if not os.path.exists(abspath):
        return ["FILE_MISSING: " + relpath]
    html = open(abspath, encoding="utf-8").read()

    # 構造
    if "<html" not in html or "</html>" not in html:
        errs.append("NO_HTML_STRUCTURE")
    if not TITLE_RE.search(html):
        errs.append("NO_TITLE")

    # JSON-LD
    lds = LD_RE.findall(html)
    if not lds:
        errs.append("NO_JSONLD")
    for i, block in enumerate(lds):
        try:
            obj = json.loads(block)
        except Exception as e:
            errs.append("JSONLD_PARSE_FAIL[%d]: %s" % (i, str(e)[:60]))
            continue
        nodes = obj.get("@graph") if isinstance(obj, dict) and "@graph" in obj else [obj]
        for n in nodes:
            if not isinstance(n, dict):
                errs.append("JSONLD_NODE_NOT_OBJECT[%d]" % i); continue
            if "@type" not in n:
                errs.append("JSONLD_NO_TYPE[%d]" % i)
        if isinstance(obj, dict) and "@context" not in obj:
            errs.append("JSONLD_NO_CONTEXT[%d]" % i)

    # canonical 一致
    m = CANON_RE.search(html)
    if not m:
        errs.append("NO_CANONICAL")
    else:
        expected = path_to_canonical(relpath)
        if m.group(1) != expected:
            errs.append("CANONICAL_MISMATCH: got %s expected %s" % (m.group(1), expected))

    # 必須メタ
    if not DESC_RE.search(html):
        errs.append("NO_DESCRIPTION")
    rb = ROBOTS_RE.search(html)
    if not rb or "index" not in rb.group(1) or "follow" not in rb.group(1):
        errs.append("ROBOTS_NOT_INDEXABLE")
    if not AUTHOR_RE.search(html):
        errs.append("NO_AUTHOR")

    # 禁止語(MOAT)は全文で
    for w in MOAT_FORBIDDEN:
        if w in html:
            errs.append("MOAT_LEAK: " + w)

    # 禁止ダッシュ
    for ch, name in FORBIDDEN_DASH.items():
        if ch in html:
            errs.append("FORBIDDEN_DASH: " + name)

    vis = visible_text(html)

    # 金額(可視テキスト)
    mm = MONEY_RE.search(vis)
    if mm:
        errs.append("MONEY_ON_PAGE: " + mm.group(0).strip())

    # バックリンク(認知度導線)
    if (BASE + "/yakumo/") not in html:
        errs.append("NO_MALL_BACKLINK")
    if ('href="' + BASE + '/"') not in html and ('href="' + BASE + '"') not in html:
        errs.append("NO_HS_ROOT_BACKLINK")

    # 内部リンクの体裁(相対の壊れリンクを弾く: href="souba/..." のような裸相対は不可)
    for href in re.findall(r'href="([^"]+)"', html):
        if href.startswith("#") or href.startswith("http") or href.startswith("mailto:") or href.startswith("tel:"):
            continue
        errs.append("SUSPECT_RELATIVE_LINK: " + href)

    return errs

def check_duplicates(paths):
    """重複ゼロ関所B: バッチ内の相互重複 + 台帳(自slug以外)との衝突を検査。generate.py と同一指紋。"""
    try:
        import generate as G  # 同ディレクトリ(tools/yakumo)
    except Exception as e:
        return ["DEDUP_MODULE_LOAD_FAIL: " + str(e)[:80]]
    errs = []
    ledger = G.ledger_load().get("entries", [])
    fps = []
    for p in paths:
        abspath = os.path.join(REPO_ROOT, p)
        if not os.path.exists(abspath):
            continue
        html = open(abspath, encoding="utf-8").read()
        canonical = path_to_canonical(p)
        fps.append((p, G.fingerprint(canonical, html)))
    # バッチ内 相互
    for i in range(len(fps)):
        for j in range(i + 1, len(fps)):
            a, b = fps[i][1], fps[j][1]
            if a["tsha"] == b["tsha"]:
                errs.append("DUPLICATE_IN_BATCH(title): %s == %s" % (fps[i][0], fps[j][0]))
            elif a["simhash"] != "0" and G.hamming64(a["simhash"], b["simhash"]) <= 6:
                errs.append("DUPLICATE_IN_BATCH(near): %s ~= %s" % (fps[i][0], fps[j][0]))
    # 台帳(自分のslug以外)との衝突
    for (p, fp) in fps:
        for e in ledger:
            if e.get("slug") == fp["slug"]:
                continue  # 自分自身(更新)は許可
            if e.get("tsha") == fp["tsha"]:
                errs.append("DUPLICATE_VS_LEDGER(title): %s == %s" % (p, e["slug"])); break
            if e.get("simhash") and fp["simhash"] != "0" and G.hamming64(fp["simhash"], e["simhash"]) <= 6:
                errs.append("DUPLICATE_VS_LEDGER(near): %s ~= %s" % (p, e["slug"])); break
    return errs

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest")
    ap.add_argument("--paths", nargs="*")
    a = ap.parse_args()

    paths = []
    if a.manifest:
        man = json.load(open(a.manifest, encoding="utf-8"))
        paths = [p["path"] for p in man.get("pages", [])]
    if a.paths:
        paths += a.paths
    if not paths:
        print("検証対象なし(--manifest か --paths を指定)"); sys.exit(2)

    total_err = 0
    print("=== 八雲 生成コンテンツ プリフライト検証(fail-closed) ===")
    for p in paths:
        errs = check_page(p)
        if errs:
            total_err += len(errs)
            print("  NG   " + p)
            for e in errs:
                print("        - " + e)
        else:
            print("  PASS " + p)

    # 重複ゼロ関所B(同じダブりは絶対に出さない)
    dup_errs = check_duplicates(paths)
    if dup_errs:
        total_err += len(dup_errs)
        print("  NG   [DEDUP GATE]")
        for e in dup_errs:
            print("        - " + e)
    else:
        print("  PASS [DEDUP GATE] 重複なし")
    print("\n=== 検証結果: %d ページ / エラー %d 件 ===" % (len(paths), total_err))
    if total_err:
        print("不適格。1枚でも落ちたらバッチ全体を公開しない(fail-closed)。")
        sys.exit(1)
    print("全ページ適格。公開可。")
    sys.exit(0)

if __name__ == "__main__":
    main()
