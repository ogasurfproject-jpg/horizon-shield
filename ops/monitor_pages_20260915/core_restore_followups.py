#!/usr/bin/env python3
# core_restore_followups.py (2026-09-16, 番人)
#
# #2 の後追い 2 本を preview / 適用する:
#   C1) souba/index.html の hub 一覧に 13 本(復帰 12 + p039)の <li> を足す(静的リスト、冪等)。
#   C2) aeo/アスベスト除去工事.html に「30秒でわかる結論」を足して citeable にする(数字は既存表と souba-db 2.2.0 に一致)。
#
# 掟: ダッシュ(U+2013/14/15/2500)を出さん。生 hash/curl/暗号語を足さん。
#     既定は preview(<file>.preview に書いて diff を出す。本体は触らん)。--apply で当てる(bak を残す)。
#     archive/yakumo/robots は触らん。

import os, io, sys, argparse, time, difflib

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BASE = "https://shield.the-horizons-innovation.com"
DASHES = "".join(chr(c) for c in (0x2013, 0x2014, 0x2015, 0x2500))

# hub 一覧に足す 13 本: (href, 表示文)  数字は souba-db 2.2.0 と一致
HUB = [
    (BASE + "/souba/aircon-toritsuke-souba/",    "エアコン取付工事の費用相場 1台1.5〜3万円"),
    (BASE + "/souba/ecocute-370l-souba/",        "エコキュート交換の費用相場 370Lで35〜58万円"),
    (BASE + "/souba/genkan-door-cover-souba/",    "玄関ドアカバー工法の費用相場 20〜38万円"),
    (BASE + "/souba/kitchen-middle-souba/",       "キッチンリフォームの費用相場 ミドル80〜150万円"),
    (BASE + "/souba/shiroari-30tsubo-hiyou/",     "シロアリ駆除30坪の費用相場 15〜30万円"),
    (BASE + "/souba/shiroari-kujo-tanka-souba/",  "シロアリ駆除の費用相場 ㎡1,500〜2,500円"),
    (BASE + "/souba/toilet-tankless-souba/",      "タンクレストイレ交換の費用相場 20〜40万円"),
    (BASE + "/souba/unit-bath-1616-souba/",       "ユニットバス交換の費用相場 1616で90〜150万円"),
    (BASE + "/souba/veranda-frp-bousui-souba/",   "ベランダ防水FRPの費用相場 10㎡6〜12万円"),
    (BASE + "/souba/yane-cover-galvalume-souba/", "屋根カバー工法の費用相場 ガルバ30坪70〜150万円"),
    (BASE + "/souba/yane-tosou-30tsubo-souba/",   "屋根塗装30坪の費用相場 シリコン25〜60万円"),
    (BASE + "/souba/yuka-dannetsu-souba/",        "床断熱リフォームの費用相場 30坪30〜60万円"),
    (BASE + "/aeo/%E3%82%A2%E3%82%B9%E3%83%99%E3%82%B9%E3%83%88%E9%99%A4%E5%8E%BB%E5%B7%A5%E4%BA%8B.html",
                                                  "アスベスト除去工事の費用相場 レベル別20〜800万円"),
]

# p039 結論(数字は表と souba-db 2.2.0 に一致。〜 と ・ は掟で可、ダッシュは無し)
KETSU_H2 = '<h2 style="font-size:18px;font-weight:900;color:#0f1e4a;margin:24px 0 12px">30秒でわかる結論</h2>'
KETSU_P = ('  <p class="speakable">アスベスト除去の費用相場は、レベル3の成形板の部分撤去で20〜60万円、'
           '解体に伴う戸建30坪の全面撤去で60〜150万円、レベル1の吹付アスベスト除去で300〜800万円です。'
           'レベル1(吹付)・レベル2(保温材)・レベル3(成形板)で工事費が10倍以上変わるため、'
           'まず自宅がどのレベルかを事前調査で確定してから金額を判断します。'
           '2023年4月からアスベストの事前調査は義務です。</p>\n')
KETSU_BLOCK = KETSU_H2 + "\n" + KETSU_P + "\n  "

def dash_hits(t):
    return [hex(ord(c)) for c in set(t) if c in DASHES]

def diffstat(a, b, name):
    da = a.splitlines(); db = b.splitlines()
    d = list(difflib.unified_diff(da, db, lineterm=""))
    add = sum(1 for x in d if x.startswith("+") and not x.startswith("+++"))
    rem = sum(1 for x in d if x.startswith("-") and not x.startswith("---"))
    print("  %s: +%d / -%d lines" % (name, add, rem))
    for x in d[:0]:  # keep quiet by default
        pass
    return add, rem

def hub_apply(s):
    key = "工事別・相場の詳細ページ一覧"
    if key not in s:
        return s, "REFUSE: hub list heading not found", []
    i = s.index(key)
    ul_end = s.index("</ul>", i)
    added = []
    ins = ""
    for href, text in HUB:
        if href in s:
            continue
        ins += ('  <li style="margin:0;padding:4px 0;"><a href="' + href +
                '" style="color:#1E6B43;text-decoration:none;">' + text + ' →</a></li>\n')
        added.append(href)
    out = s[:ul_end] + ins + s[ul_end:]
    return out, None, added

def ketsu_apply(s):
    if "30秒でわかる結論" in s:
        return s, "skip: 結論 already present", False
    anchor = '<h2 style="font-size:18px;font-weight:900;color:#0f1e4a;margin:24px 0 12px">📊 アスベスト除去工事 費用相場一覧表'
    if anchor not in s:
        return s, "REFUSE: table H2 anchor not found", False
    out = s.replace(anchor, KETSU_BLOCK + anchor, 1)
    return out, None, True

def handle(relpath, fn, apply):
    fp = os.path.join(ROOT, relpath)
    s = io.open(fp, encoding="utf-8").read()
    out, note, changed = fn(s)
    print("== %s ==" % relpath)
    if note and note.startswith("REFUSE"):
        print("  " + note); return
    if note and note.startswith("skip"):
        print("  " + note); return
    diffstat(s, out, relpath)
    dh = dash_hits(out) if not isinstance(changed, list) else dash_hits(out)
    if dh:
        print("  DASH in output:", dh, "(refusing to write)"); return
    if isinstance(changed, list):
        print("  added %d links:" % len(changed))
        for h in changed: print("   +", h)
    if apply:
        bak = fp + ".bak-" + time.strftime("%Y%m%d-%H%M%S")
        io.open(bak, "w", encoding="utf-8").write(s)
        io.open(fp, "w", encoding="utf-8").write(out)
        print("  APPLIED. backup:", os.path.basename(bak))
    else:
        pv = fp + ".preview"
        io.open(pv, "w", encoding="utf-8").write(out)
        print("  preview:", os.path.basename(pv), "(original untouched)")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--only", choices=["hub", "ketsu"], default=None)
    a = ap.parse_args()
    if a.only in (None, "hub"):
        handle("souba/index.html", hub_apply, a.apply)
    if a.only in (None, "ketsu"):
        handle("aeo/アスベスト除去工事.html", ketsu_apply, a.apply)

if __name__ == "__main__":
    main()
