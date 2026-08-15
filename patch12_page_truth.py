# -*- coding: utf-8 -*-
"""
第12弾パッチ (2026-08-15) — verify-directory を、いまの本番の事実に合わせる

古くなった記述(2箇所):
  1. 「it cannot reach its own hostname ... has not measured that condition」
     「on the watchlist it sits as held · http 522」
       → 2026-08-15、オンデマンドでは中継経由で測れるようになった。
         いま「try: the checker on itself」を押した訪問者は reachable: true を見る。
         ページ本文と実挙動が食い違っている。
  2. ENTRY 01 の「Its endpoint row reads served, not measured by us」
       → 同上。初の自己測定が立った。

書き足す事実:
  - 522 の顛末(外部からの再現で発覚 → 境界の地図 → 公開エッジ経由の中継)
  - probed_via フィールドの存在
  - 非対称: 夜の掃引は中継を使えないので、夜の台帳では held のまま。
    オンデマンドでは測れる。両方の記録を残し、どちらにも合わせて書き換えない。
  - 発見者 Federico Blanco Sanchez-Llanos の名前(本人が名指しを許諾)

使い方:
  cd ~/Desktop/hs-docfix
  python3 patch12_page_truth.py
  python3 patch12_page_truth.py --apply
"""
import sys, os, io, hashlib

TARGET = "verify-directory/index.html"

F1 = '''      <p>On the first run, our own servers did not meet a single one of the rules we had just published. We fixed what we could and left the rest visible. <b>Not one of the four rows on the list today passes.</b> That includes the checker itself: it cannot reach its own hostname from inside its own account, so it has not measured that condition — and it refuses to count an unmeasured condition as a pass, because that is the rule it applies to everyone else. Its own verdict therefore reads <span class="mono">pending</span>, and on the watchlist it sits as <span class="mono">held · http 522</span>.</p>'''

R1 = '''      <p>On the first run, our own servers did not meet a single one of the rules we had just published. We fixed what we could and left the rest visible. <b>Not one of the four rows on the list today passes.</b> That includes the checker itself. Until 2026-08-15 it could not reach its own hostname at all, refused to count that unmeasured condition as a pass — the same rule it applies to everyone else — and its row sat as <span class="mono">held · http 522</span>. Then an outside runner found the mirror image of that limit: on-demand checks of our own servers were failing with 522 too, while the nightly sweep quietly passed. We mapped the boundary, routed those probes over the public edge through a relay, and every verdict now names the path that measured it in a <span class="mono">probed_via</span> field. The gate has measured itself for the first time — <span class="mono">reachable: true · pending</span> on demand. The nightly sweep cannot use the relay, so the register's own row can still read <span class="mono">held</span> at night while measuring fine on demand. Both records stand; neither is edited to match the other.</p>'''

F2 = '''        <p>Answers "who verifies the verifier" by going first — and then fails its own test. It now speaks MCP at <span class="mono">/mcp</span>, so the tool that lets you distrust the issuer is <b>provided by the issuer</b>. Its endpoint row reads <b>served, not measured by us</b>: a Worker cannot fetch its own hostname. For a while the record carried <span class="mono">pass: true</span> on that row anyway, which made the gate's own verdict read verified. <b>It was the only server this gate was lenient with, so we removed the leniency.</b> The verdict now reads <span class="mono">pending</span>, and the row stays visible rather than being quietly dropped.</p></div>'''

R2 = '''        <p>Answers "who verifies the verifier" by going first — and then fails its own test. It now speaks MCP at <span class="mono">/mcp</span>, so the tool that lets you distrust the issuer is <b>provided by the issuer</b>. For a while its endpoint row carried <span class="mono">pass: true</span> on a condition it openly had not measured, which made its own verdict read verified. <b>It was the only server this gate was lenient with, so we removed the leniency</b> and the verdict fell to <span class="mono">pending</span>. On 2026-08-15, after Federico Blanco Sanchez-Llanos reproduced our check from his own network and caught on-demand probes of our own zone failing with 522, those probes were rerouted over the public edge — and the gate measured its own endpoint for the first time: <span class="mono">reachable: true</span>, still <span class="mono">pending</span>, because determinism stays unmeasured without consent, including for us. The row stays visible either way.</p></div>'''


def main():
    apply = "--apply" in sys.argv
    if not os.path.exists(TARGET):
        print("NG: %s が無い。" % TARGET)
        sys.exit(1)
    src = io.open(TARGET, encoding="utf-8").read()
    print("対象  : %s" % TARGET)
    print("変更前: sha256 %s  (%d bytes)" % (hashlib.sha256(src.encode()).hexdigest(), len(src.encode())))
    print("モード: %s" % ("APPLY(本番)" if apply else "dry-run(何も書かない)"))
    print("-" * 74)

    ok_all = True
    for i, f in enumerate((F1, F2), 1):
        n = src.count(f)
        ok = (n == 1)
        ok_all = ok_all and ok
        print("  %s アンカー%d                          期待1 / 実際%d" % ("OK " if ok else "NG ", i, n))
    already = "probed_via" in src
    print("  %s まだ適用されていない                %s" % ("NG " if already else "OK ", "適用済み" if already else "未適用"))
    if not ok_all or already:
        print("★ 前提が違う。1バイトも書かずに終了する。")
        sys.exit(1)

    out = src.replace(F1, R1, 1).replace(F2, R2, 1)

    checks = [
        ("probed_via の説明が1回入った",         out.count("probed_via") == 1),
        ("発見者の名前が1回入った",              out.count("Federico Blanco Sanchez-Llanos") == 1),
        ("held · http 522 は歴史として1回残る", out.count("held · http 522") == 1),
        ("初の自己測定を2箇所で言う",            out.count("measured itself for the first time") + out.count("measured its own endpoint for the first time") == 2),
        ("非対称を明記",                         "cannot use the relay" in out),
        ("どちらの記録も直さないと明記",          "neither is edited to match the other" in out),
        ("日付 2026-08-15 が入った",             out.count("2026-08-15") == 2),
        ("<p> と </p> の収支が変わらない",
             out.count("<p") - out.count("</p>") == src.count("<p") - src.count("</p>")),
        ("<span> の収支が変わらない",
             out.count("<span") - out.count("</span>") == src.count("<span") - src.count("</span>")),
        ("<b> の収支が変わらない",
             out.count("<b>") - out.count("</b>") == src.count("<b>") - src.count("</b>")),
        ("mono クラス以外を持ち込まない",         'class="mono"' in out),
        ("determinism の同意原則を維持",          "unmeasured without consent, including for us" in out),
    ]
    for c, ok in checks:
        print("  %s %s" % ("OK " if ok else "NG ", c))
    if any(not ok for _c, ok in checks):
        print("★ 検算に失敗。書かずに終了する。")
        sys.exit(1)

    print("-" * 74)
    print("変更後: sha256 %s  (%d bytes)" % (hashlib.sha256(out.encode()).hexdigest(), len(out.encode())))
    if not apply:
        print("")
        print("[dry-run] 書いていない。本番は --apply を付けろ。")
        sys.exit(0)

    io.open(TARGET, "w", encoding="utf-8").write(out)
    print("")
    print("書いた。")


if __name__ == "__main__":
    main()
