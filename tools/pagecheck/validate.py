# -*- coding: utf-8 -*-
"""
公開前ページ検証 (fail-closed) ・ 業種に属さない共通の門

2026-08-23 に tools/yakumo/ からここへ移した。
合同会社あっぷす様(訪問看護)は Yakumo に加盟していないのに、
あっぷす様のページを公開できるかどうかを Yakumo の門が決めていたため。

検査の中身は移動前と一字一句同じである。Yakumo に属していたのは
名前と、モール(/yakumo/)へのバックリンク1件だけで、それは既に
置き場所で分岐するようにしてある。

目的: 「絶対に Google / Bing にエラーを出さない」ための静的関所。
1枚でも落ちたらバッチ全体を不適格(exit 1)にする。GitHub Action はこれが通った時だけ commit する。

チェック項目(各ページ):
  - HTML基本構造(<html> / <title> / </html>)
  - <script type="application/ld+json"> が全て正当なJSONで @context/@type を持つ
  - canonical が存在し、ファイルパスから導かれる正規URLと一致
  - 必須メタ(title / description / robots=index,follow / author)
  - 禁止語(MOAT語。下の MOAT_FORBIDDEN、逆順表記)が本文に無い
  - em/en/bar dash(U+2014/2013/2015) が無い
  - 金額数字(¥1,234 / 1,234円 / 12万円 等)が無い(施主向け加盟店面は金額非表示)。
    ただし採用ページ(/recruit/)は求人給与の表示が必要なため、可視テキストの金額チェックを免除する。
  - バックリンク(認知度導線)。置き場所で宛先が変わる:
      yakumo/ の下 -> モール(/yakumo/)へ。建設の加盟店モール。
      care/ の下   -> その事業所自身の窓口(/care/<slug>/)へ。
                      訪問看護は Yakumo の対象外なので、モールへ送らない。
      いずれも HORIZON SHIELD ルートへのバックリンクは必須。
  - 内部リンクが絶対URL(https://shield.the-horizons-innovation.com/...)で壊れていない形

使い方:
  python3 tools/yakumo/validate.py --manifest tools/yakumo/last_manifest.json
  python3 tools/yakumo/validate.py --paths yakumo/souba/xxx/index.html ...
"""
import argparse, json, sys, os, re

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# 2026-08-24: 門が見る根を、外から変えられるようにした。
#   これまでは自分のファイル位置から決めた1箇所だけを見ていた。
#   そのため、リポジトリの外に書き出した束を門に通すことができず、
#   「生成 -> 門」の配線を、本物のリポジトリを汚さずに試す方法が無かった。
#   実際に試したとき、ファイルは在るのに5枚とも FILE_MISSING と出た。
#   在るものを「無い」と言ったのは、見る場所が違っていたからである。
#   計器の指す先を変えられないと、計器そのものを試せない。
def _set_root(path):
    global REPO_ROOT
    REPO_ROOT = os.path.abspath(path)


if os.environ.get("PAGECHECK_ROOT"):
    _set_root(os.environ["PAGECHECK_ROOT"])
BASE = "https://shield.the-horizons-innovation.com"
MOAT_FORBIDDEN = [s[::-1] for s in ["5.23", "dlohserht_regnad", "CPW"]]  # 逆順表記(公開repoのgrep封印。機能は同一)
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

def is_recruit_path(relpath):
    # 採用(求人)ページは給与表示が必要なため、金額チェックを免除する名前空間。
    # 施主向け(souba / faq 等)は従来どおり金額非表示のまま(このヘルパで区別する)。
    return "/recruit/" in ("/" + relpath.replace("\\", "/"))

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

    # 金額(可視テキスト): 施主向けは非表示。ただし採用(/recruit/)は求人給与の表示が必要なため免除。
    if not is_recruit_path(relpath):
        mm = MONEY_RE.search(vis)
        if mm:
            errs.append("MONEY_ON_PAGE: " + mm.group(0).strip())

    # バックリンク(認知度導線)
    #
    # 2026-08-23。ここは長らく無条件に /yakumo/ (建設モール)へのリンクを求めていた。
    # 訪問看護は Yakumo の対象外なので(industry.js の mall: null)、
    # モールへ送ってはいけない。送れば、訪問看護を探している人が建設のモールに着く。
    # かといって検査を外すと、建設のページからも導線が消える。
    # 検証器を増やさず、ここだけで置き場所によって分ける。
    rel = "/" + relpath.replace("\\", "/")
    if rel.startswith("/yakumo/"):
        if (BASE + "/yakumo/") not in html:
            errs.append("NO_MALL_BACKLINK")
    elif rel.startswith("/care/"):
        # モールが無い業種。宛先は、その事業所自身の窓口。
        # care/<slug>/... の <slug> を取り出して、そこへのリンクがあることを見る。
        parts = [p for p in rel.split("/") if p]
        if len(parts) < 2:
            errs.append("CARE_PATH_TOO_SHALLOW: " + relpath)
        else:
            window = BASE + "/care/" + parts[1] + "/"
            if window not in html:
                errs.append("NO_MEMBER_WINDOW_BACKLINK: " + window)
    else:
        # どの名前空間にも属していない。置き場所を取り違えている。
        errs.append("UNKNOWN_NAMESPACE: " + relpath)

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
    # 残っている結合(2026-08-23):
    #   指紋の計算(fingerprint / simhash / ledger)は tools/yakumo/generate.py にある。
    #   これも本来は業種に属さないので、いずれここへ来るべきである。
    #   ただし動かすと建設の生成器そのものに触るので、今夜はやらない。
    #   明示的に読みに行き、残っていることをここに書いておく。
    #
    #   台帳を共有していること自体は正しい。建設のページと訪問看護のページが
    #   互いに重複していたら、それは見つけるべきものである。
    # 指紋は業種に属さない場所から直接読む(2026-08-23)。
    #   ここが最後の結合だった。訪問看護のページを公開してよいかどうかが、
    #   建設の生成器を import できるかに依存していた。
    #   台帳を共有していること自体は正しい。建設のページと訪問看護のページが
    #   互いに重複していたら、それは見つけるべきものである。
    _fp = os.path.dirname(os.path.abspath(__file__))
    if _fp not in sys.path:
        sys.path.insert(0, _fp)
    try:
        import fingerprint as G
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
    ap.add_argument("--root", help="ページを探す根。既定はこのリポジトリの根。"
                                   "リポジトリの外に書き出した束を試すときに使う。")
    a = ap.parse_args()
    if a.root:
        _set_root(a.root)
    print("見る根: %s" % REPO_ROOT)

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
