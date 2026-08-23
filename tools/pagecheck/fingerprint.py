# -*- coding: utf-8 -*-
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

# ここから norm_text は generate.py から切り出したもの。打ち直していない。
CONTENT_LEDGER = os.path.join(REPO_ROOT, "data", "yakumo-content-manifest.json")
NORM_DROP_RE = re.compile(r"[、。・,.:;!?'\"()\[\]{}<>|/\\\-\s　]")
TITLE_RE_G = re.compile(r"<title>(.*?)</title>", re.S)
SCRIPT_STYLE_RE_G = re.compile(r'<(script|style)\b[^>]*>.*?</\1>', re.S)
TAG_RE_G = re.compile(r'<[^>]+>')


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
        re.compile(r'<header>.*?</header>', re.S),
        re.compile(r'<!-- EHN_RECIRC_START.*?EHN_RECIRC_END:[^>]*-->', re.S),
            # 2026-08-23。この1行は 0 箇所にしか当たっていなかった。
        # 実際の HTML は <div class="section"> に包まれていない。
        # 剥がれないまま、全ページ共通の 173 字が「中身」として数えられ、
        # souba の2ページを重複に見せていた。実物に合わせて書き直す。
        re.compile(r'<h2>出典・データソース</h2><div class="source-block">.*?</div>', re.S),
        # 全ページ共通の枠なのに、剥がす指定が無かった(101 字)。
        re.compile(r'<h2>Yakumoの検証で確認すること</h2><ul class="tip-list">.*?</ul>', re.S),
        re.compile(r'<div class="cta-section">.*$', re.S),
    ],
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


def norm_text(s):
    s = (s or "")[:20000].lower()
    s = TAG_RE_G.sub(" ", s)
    return NORM_DROP_RE.sub("", s)

def fnv1a64(s):
    h = 0xcbf29ce484222325
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x100000001b3) & 0xFFFFFFFFFFFFFFFF
    return h

def simhash64(text):
    t = norm_text(text)
    if len(t) < 3:
        return "0"
    acc = [0] * 64
    for i in range(len(t) - 2):
        h = fnv1a64(t[i:i + 3])
        for b in range(64):
            acc[b] += 1 if (h >> b) & 1 else -1
    out = 0
    for b in range(64):
        if acc[b] > 0:
            out |= 1 << b
    return format(out, "x")

def hamming64(a, b):
    return bin(int(a or "0", 16) ^ int(b or "0", 16)).count("1")

def visible_body(html):
    return TAG_RE_G.sub(" ", SCRIPT_STYLE_RE_G.sub(" ", html))

# 指紋は「そのページ固有の本文」から取る。全ページ共通のボイラープレート(ヘッダー/出典/CTA/還流網/フッター)を
# 除いてから simhash する。共通枠で距離が縮んで別内容のページ同士が誤検知されるのを防ぎ、
# 本文が同じなのに枠だけ違うダブりは今まで通り検出する。
def content_core(html, ns=DEFAULT_NS):
    t = SCRIPT_STYLE_RE_G.sub(" ", html)
    for r in NS_BOILERPLATE.get(ns, NS_BOILERPLATE[DEFAULT_NS]):
        t = r.sub(" ", t)
    return TAG_RE_G.sub(" ", t)

def fingerprint(canonical, html, member=None):
    slug = canonical.replace(BASE + "/", "").strip("/")
    m = TITLE_RE_G.search(html)
    tsha = hashlib.sha256(norm_text(m.group(1) if m else "").encode("utf-8")).hexdigest()[:8]
    fp = {"slug": slug, "tsha": tsha,
          "simhash": simhash64(content_core(html, namespace_of(canonical)))}
    if member:
        fp["m"] = member  # ページの持ち主(加盟店)。他店による同slug上書きを防ぐ
    return fp

def ledger_load():
    if os.path.exists(CONTENT_LEDGER):
        try:
            return json.load(open(CONTENT_LEDGER, encoding="utf-8"))
        except Exception:
            pass
    return {"schema": "yakumo-content-ledger/v1", "entries": []}

def ledger_save(led):
    os.makedirs(os.path.dirname(CONTENT_LEDGER), exist_ok=True)
    json.dump(led, open(CONTENT_LEDGER, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

def answer_sha(profile):
    """店の回答本文の指紋。別の店が同じ回答(丸コピー)を出してきたら店単位で検出する。"""
    parts = [profile.get("strengths") or "", profile.get("trust") or ""]
    for f in (profile.get("faqs") or []):
        parts.append((f.get("q") or "") + (f.get("a") or ""))
    for v in (profile.get("extra") or {}).values():
        if isinstance(v, dict):
            parts.append(v.get("text") or "")
    t = norm_text("".join(parts))
    if len(t) < 60:
        return None  # 素材が薄いうちは判定しない(誤検知防止)
    return hashlib.sha256(t.encode("utf-8")).hexdigest()[:12]

def duplicate_of(fp, entries):
    for e in entries:
        if e.get("slug") == fp["slug"]:
            return ("slug:" + e["slug"], e)
        if e.get("tsha") and e["tsha"] == fp["tsha"]:
            return ("title:" + e["slug"], e)
        if e.get("simhash") and fp["simhash"] != "0" and hamming64(fp["simhash"], e["simhash"]) <= 6:
            return ("near-dup:" + e["slug"], e)
    return (None, None)

