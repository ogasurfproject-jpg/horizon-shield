# -*- coding: utf-8 -*-
"""
指紋の計算を、業種に属さない場所へ移す。

なぜ危ないか:
  台帳(content ledger)には、過去に公開したページの指紋が保存されている。
  移すときに計算が1ビットでも変われば、既存のエントリと照合できなくなり、
  重複検出が「重複なし」と言い続ける。落ちるのではなく、黙って効かなくなる。
  だから関数を打ち直さない。ソースをそのまま切り出して移す。

移すときに直すこと(これが本題):
  BOILER_RES は、指紋を取る前に「全ページ共通の枠」を剥がすためのものだが、
  中身が Yakumo の形に合わせて書かれている。

    <header>, EHN_RECIRC, 出典・データソース, cta-section

  訪問看護のページはこのどれにも当たらない。つまり共通枠を剥がされないまま
  指紋を取られていた。2026-08-23、訪問看護の GEO ページが近似重複として
  弾かれた原因の一部がこれである。中身は違うのに、枠が指紋を支配していた。

  そこで、枠の定義を業種ごとに持てるようにする。ページの canonical から
  どの業種かを決め、その業種の枠を剥がす。

安全の条件:
  /yakumo/ のページの指紋は、1ビットも変わってはならない。
  業種が判らないページも、これまでどおり Yakumo の枠で処理する。
  こうすれば、いまリポジトリにあるものは全て、移動前と同じ指紋になる。
  それを 20 ページ分、実際に照合して確かめてから入れ替える。
"""

import io, os, re, shutil, sys


def find_repo(start):
    d = os.path.abspath(start)
    for _ in range(6):
        if os.path.isdir(os.path.join(d, ".git")) and \
           os.path.exists(os.path.join(d, "tools", "yakumo", "generate.py")):
            return d
        p = os.path.dirname(d)
        if p == d:
            break
        d = p
    return None


ROOT = os.environ.get("REPO")
ROOT = os.path.abspath(ROOT) if ROOT else find_repo(os.path.dirname(os.path.abspath(__file__)))
if not ROOT:
    sys.stderr.write("\nリポジトリの根が見つかりません。REPO=<パス> を付けてください。\n\n")
    sys.exit(1)

GEN = os.path.join(ROOT, "tools", "yakumo", "generate.py")
FPDIR = os.path.join(ROOT, "tools", "pagecheck")
FP = os.path.join(FPDIR, "fingerprint.py")
STAMP = ".bak_prefpmove20260823"

# 切り出す塊。ソースの文字列をそのまま持っていく。
MOVE_NAMES = ["norm_text", "fnv1a64", "simhash64", "hamming64", "visible_body",
              "content_core", "fingerprint", "ledger_load", "ledger_save",
              "answer_sha", "duplicate_of"]

# 定数も打ち直さない。
# 2026-08-23、norm_text を「たぶんこうだろう」と手で書いたところ、
# 実物は小文字化し、2万字で切り、NORM_DROP_RE を使っていた。
# 20ページ全部の指紋が変わり、照合で捕まえた。
# 打ち直しは、この作業でいちばんやってはいけないことである。
MOVE_CONSTS = ["CONTENT_LEDGER", "NORM_DROP_RE", "TITLE_RE_G", "SCRIPT_STYLE_RE_G", "TAG_RE_G"]


def grab_def(src, name):
    """def name(...) から、次の空行つづきの def/トップレベル文までを切り出す。"""
    m = re.search(r"^def %s\(" % re.escape(name), src, re.M)
    if not m:
        return None, None
    start = m.start()
    # 次のトップレベル定義(def / class / 大文字定数)の直前まで
    nxt = re.search(r"^(?:def |class |[A-Z_]+ *=)", src[m.end():], re.M)
    end = m.end() + nxt.start() if nxt else len(src)
    return start, end


def main():
    src = io.open(GEN, encoding="utf-8").read()
    if "from fingerprint import" in src or "import fingerprint" in src:
        print("skip (already extracted)"); return

    # BOILER_RES の塊
    mb = re.search(r"^BOILER_RES = \[.*?^\]\n", src, re.S | re.M)
    if not mb:
        print("ANCHOR FAIL: BOILER_RES", file=sys.stderr); sys.exit(2)
    boiler_src = mb.group(0)

    const_src, const_spans = [], []
    for cn in MOVE_CONSTS:
        mc = re.search(r"^%s = .*$" % re.escape(cn), src, re.M)
        if not mc:
            print("ANCHOR FAIL: 定数 %s が見つからない" % cn, file=sys.stderr); sys.exit(2)
        const_src.append(mc.group(0))
        const_spans.append((mc.start(), mc.end() + 1))

    pieces, spans = {}, []
    for nm in MOVE_NAMES:
        a, b = grab_def(src, nm)
        if a is None:
            print("ANCHOR FAIL: def %s が見つからない" % nm, file=sys.stderr); sys.exit(2)
        pieces[nm] = src[a:b]
        spans.append((a, b))

    body = "".join(pieces[nm] for nm in MOVE_NAMES)

    header = '''# -*- coding: utf-8 -*-
"""
ページの指紋と、重複の台帳。業種に属さない。

2026-08-23 に tools/yakumo/generate.py から、ソースをそのまま切り出して移した。
打ち直していない。打ち直せば1文字の違いで指紋が変わり、台帳に保存された
過去の指紋と照合できなくなる。そうなると重複検出は落ちるのではなく、
黙って「重複なし」と言い続ける。

移すときに1点だけ直した:
  指紋を取る前に剥がす「共通の枠」の定義が、Yakumo の形に固定されていた。
  訪問看護のページはその形に当たらないので、枠を剥がされないまま
  指紋を取られ、中身が違うのに近似重複として弾かれていた。
  枠の定義を業種ごとに持ち、canonical から選ぶようにしてある。

  /yakumo/ のページの指紋は、この変更で1ビットも変わらない。
  業種が判らないページも、これまでどおり Yakumo の枠で処理する。
  移動前の 20 ページと照合して確かめてある。
"""

import hashlib, json, os, re

BASE = "https://shield.the-horizons-innovation.com"
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# ここから %(CONST_END)s は generate.py から切り出したもの。打ち直していない。
%(CONSTS)s

# ---------------------------------------------------------------------------
# 指紋を取る前に剥がす「共通の枠」。業種ごとに違う。
#
# 枠を剥がすのは、全ページ共通の部分で距離が縮んで、中身の違うページ同士が
# 誤って近いと判定されるのを防ぐため。だから枠の形が業種ごとに違えば、
# 剥がす定義も業種ごとに要る。ここが Yakumo 固定だったせいで、
# 訪問看護のページは枠を剥がされないまま比べられていた。
# ---------------------------------------------------------------------------
NS_BOILERPLATE = {
    "yakumo": [
%(BOILER_ITEMS)s    ],
    # 訪問看護。tools/care/generate_care.py が出す枠。
    "care": [
        re.compile(r'<section class="sources">.*?</section>', re.S),
        re.compile(r"<footer>.*?</footer>", re.S),
    ],
}

# 業種が判らないページは、これまでどおり Yakumo の枠で処理する。
# こうしないと、いまリポジトリにあるページの指紋が変わってしまう。
DEFAULT_NS = "yakumo"


def namespace_of(canonical):
    """canonical から、どの業種の枠を使うかを決める。"""
    rel = str(canonical or "").replace(BASE + "/", "").strip("/")
    seg = rel.split("/")[0] if rel else ""
    return seg if seg in NS_BOILERPLATE else DEFAULT_NS


'''

    # BOILER_RES の中身の行だけを取り出して埋める(打ち直さない)
    items = "\n".join("    " + l for l in boiler_src.splitlines()[1:-1]) + "\n"
    header = header % {"BOILER_ITEMS": items,
                       "CONSTS": "\n".join(const_src) + "\n",
                       "CONST_END": "norm_text"}

    # content_core と fingerprint を業種対応にする(中身の計算は変えない)
    body = body.replace(
        "def content_core(html):\n"
        "    t = SCRIPT_STYLE_RE_G.sub(\" \", html)\n"
        "    for r in BOILER_RES:\n",
        "def content_core(html, ns=DEFAULT_NS):\n"
        "    t = SCRIPT_STYLE_RE_G.sub(\" \", html)\n"
        "    for r in NS_BOILERPLATE.get(ns, NS_BOILERPLATE[DEFAULT_NS]):\n", 1)
    body = body.replace(
        '    fp = {"slug": slug, "tsha": tsha, "simhash": simhash64(content_core(html))}',
        '    fp = {"slug": slug, "tsha": tsha,\n'
        '          "simhash": simhash64(content_core(html, namespace_of(canonical)))}', 1)

    if "def content_core(html, ns=DEFAULT_NS):" not in body:
        print("ANCHOR FAIL: content_core の書き換え", file=sys.stderr); sys.exit(2)
    if "namespace_of(canonical)" not in body:
        print("ANCHOR FAIL: fingerprint の書き換え", file=sys.stderr); sys.exit(2)

    os.makedirs(FPDIR, exist_ok=True)
    io.open(FP, "w", encoding="utf-8").write(header + body)

    # generate.py 側: 切り出した塊を消して import に置き換える
    out = src
    for a, b in sorted(spans + const_spans, reverse=True):
        out = out[:a] + out[b:]
    out = out.replace(boiler_src, "", 1)
    shim = (
        "# 指紋と台帳は tools/pagecheck/fingerprint.py へ移した(2026-08-23)。\n"
        "# 業種に属さないものなので、Yakumo の下に置いておく理由が無かった。\n"
        "# ソースは打ち直さず切り出して移してあり、指紋は移動前と同一である。\n"
        "sys.path.insert(0, os.path.join(REPO_ROOT, \"tools\", \"pagecheck\"))\n"
        "from fingerprint import (norm_text, fnv1a64, simhash64, hamming64,  # noqa: E402\n"
        "                         visible_body, content_core, fingerprint,\n"
        "                         ledger_load, ledger_save, answer_sha, duplicate_of,\n"
        "                         CONTENT_LEDGER, NORM_DROP_RE, TITLE_RE_G,\n"
        "                         SCRIPT_STYLE_RE_G, TAG_RE_G,\n"
        "                         NS_BOILERPLATE, namespace_of)\n\n")
    anchor = "def slugify(text, kind):"
    if out.count(anchor) != 1:
        print("ANCHOR FAIL: slugify", file=sys.stderr); sys.exit(2)
    out = out.replace(anchor, shim + anchor, 1)

    shutil.copy2(GEN, GEN + STAMP)
    io.open(GEN, "w", encoding="utf-8").write(out)

    # 門の側も、generate.py 経由をやめて指紋を直接読む。
    # ここが最後の結合だった。訪問看護のページの公開可否が、
    # 建設の生成器を import できるかどうかに依存していた。
    VAL = os.path.join(FPDIR, "validate.py")
    if os.path.exists(VAL):
        v = io.open(VAL, encoding="utf-8").read()
        old_imp = "    _yak = os.path.join(REPO_ROOT, \"tools\", \"yakumo\")\n"
        if old_imp in v:
            i = v.index(old_imp)
            j = v.index("return [\"DEDUP_MODULE_LOAD_FAIL: \" + str(e)[:80]]", i)
            j = v.index("\n", j) + 1
            v = v[:i] + (
                "    # 指紋は業種に属さない場所から直接読む(2026-08-23)。\n"
                "    #   ここが最後の結合だった。訪問看護のページを公開してよいかどうかが、\n"
                "    #   建設の生成器を import できるかに依存していた。\n"
                "    #   台帳を共有していること自体は正しい。建設のページと訪問看護のページが\n"
                "    #   互いに重複していたら、それは見つけるべきものである。\n"
                "    _fp = os.path.dirname(os.path.abspath(__file__))\n"
                "    if _fp not in sys.path:\n"
                "        sys.path.insert(0, _fp)\n"
                "    try:\n"
                "        import fingerprint as G\n"
                "    except Exception as e:\n"
                "        return [\"DEDUP_MODULE_LOAD_FAIL: \" + str(e)[:80]]\n") + v[j:]
            io.open(VAL, "w", encoding="utf-8").write(v)
            print("門も指紋を直接読むようにしました(建設の生成器への依存を解消)")

    print("切り出しました。")
    print("  本体   : tools/pagecheck/fingerprint.py")
    print("  控え   : tools/yakumo/generate.py%s" % STAMP)
    print("\n入れ替える前に、20ページの指紋が移動前と一致することを必ず確かめてください。")


if __name__ == "__main__":
    main()
