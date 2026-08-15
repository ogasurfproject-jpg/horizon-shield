# -*- coding: utf-8 -*-
"""
patch_webmcp_version_tolerance.py (2026-08-15) — GlamaのUnhealthyの修理

実測で確定した原因:
  Glamaの検査機(python-httpx2)は最初の1発で MCP-Protocol-Version: 2026-07-28 を名乗る。
  hs-webmcp は対応リスト(2025-11-25まで)に無い版を400で門前払いしていた。
  検査機は2025-11-25に下げて再試行し全部通るが、最初の400で健康診断が赤になる。
  wrangler tail で4リクエスト全部のヘッダと返した番号を捕捉済み。推測ではない。

直し:
  未知の版のヘッダを400にしない。initialize には元々交渉があり、未知の要求には
  既定版で答える。門前払いの検査だけを外し、理由をコメントで現場に残す。
  今朝のやくも(廃止モデル1本賭け)と同じ教訓: 未来の値を弾く作りは時間で必ず壊れる。

fail-closed:
  - 既定は dry-run。--apply を付けた時だけ書く
  - アンカーは 期待1件。1件でなければ1バイトも書かない
  - 適用後に不変条件を検査し、失敗したら書かずに終了

使い方:
  cd ~/Desktop/hs-docfix
  python3 patch_webmcp_version_tolerance.py
  python3 patch_webmcp_version_tolerance.py --apply
"""
import io, sys

APPLY = "--apply" in sys.argv

W = "workers/hs-webmcp/index.js"

OLD = '''    // MCP-Protocol-Version ヘッダ: 提示があり未対応なら400
    const pvHeader = request.headers.get("MCP-Protocol-Version");
    if (pvHeader && !SUPPORTED_VERSIONS.includes(pvHeader))
      return new Response("Unsupported MCP-Protocol-Version: " + pvHeader, { status: 400, headers: CORS });
'''

NEW = '''    // MCP-Protocol-Version ヘッダ: 未知の版でも拒否しない。
    // 2026-08-15 実測: Glamaの検査機が 2026-07-28 を名乗り、旧実装の400門前払いが
    // 健康診断を赤にしていた(wrangler tailで全リクエスト捕捉済み)。未知の版は
    // initialize の交渉に任せ、こちらの既定版で答える。新しい版を名乗る正しい相手を
    // 弾くより、受けて交渉結果を返す方が相互運用の実利がある。
'''


def main():
    t = io.open(W, encoding="utf-8").read()
    n = t.count(OLD)
    print("  %s 400門前払いの3行: 期待1 実際%d" % ("OK " if n == 1 else "NG ", n))
    n2 = t.count("SUPPORTED_VERSIONS")
    print("  %s SUPPORTED_VERSIONS の出現: 期待3 実際%d" % ("OK " if n2 == 3 else "NG ", n2))
    if n != 1 or n2 != 3:
        print("\n★ 前提が違う。1バイトも書かずに終了する。")
        sys.exit(1)

    if not APPLY:
        print("\ndry-run 合格。--apply を付ければ書く。")
        return

    w = t.replace(OLD, NEW, 1)

    checks = [
        ("Unsupported MCP-Protocol-Version" not in w, "門前払いの400が消えた"),
        ("pvHeader" not in w, "使わなくなった変数が残っていない"),
        (w.count("SUPPORTED_VERSIONS") == 2, "定義とinitialize交渉の2箇所だけ残った"),
        (w.count("2026-08-15 実測") == 1, "現場に理由が残った"),
        (w.count("status: 405") == t.count("status: 405"), "405(GET)の設計は不変"),
    ]
    bad = [l for o, l in checks if not o]
    for o, l in checks:
        print("  %s %s" % ("OK " if o else "NG ", l))
    if bad:
        print("\n★ 適用後検査に失敗。書かずに終了する。")
        sys.exit(1)

    io.open(W, "w", encoding="utf-8", newline="").write(w)
    print("\n書いた: %s" % W)
    print("\n次: 1) git add -f patch_webmcp_version_tolerance.py && git add %s" % W)
    print("    2) git commit して push")
    print("    3) cd workers/hs-webmcp && npx wrangler deploy")
    print("    4) 2026-07-28を名乗るcurlで200が返るか確認(検証コマンドは指示のとおり)")
    print("    5) GlamaでTest Connection → 緑を確認")


if __name__ == "__main__":
    main()
