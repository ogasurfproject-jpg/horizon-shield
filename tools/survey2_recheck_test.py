# -*- coding: utf-8 -*-
"""
当て直しの判定を、仕様どおりでない返事に当てて確かめる。

なぜ (2026-08-24):
  模擬サーバは仕様どおりの形しか作っていなかった。
  実際に当てたら1件目で落ちた。error を文字列で返すサーバが居たからである。
  仕様どおりに答える相手だけを想定した道具は、
  仕様どおりでない相手に当たった瞬間に止まる。
  測りに行く先は、仕様を守っているとは限らない場所である。

  ここには、壊れた形をわざと並べてある。落ちないこと、
  そして「相手の観測」と「こちらが読めなかった」を混ぜないことを見る。

  python3 tools/survey2_recheck_test.py
"""
import io, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import survey2_recheck as R

CASES = [
    # (label, http, body, 期待する判定)
    ("仕様どおりの discover 応答", 200,
     json.dumps({"jsonrpc":"2.0","id":"discover-1","result":{
         "resultType":"complete","supportedVersions":["2026-07-28"],
         "capabilities":{"tools":{}}}}), "modern_answered"),
    ("版が合わない(-32022)", 400,
     json.dumps({"jsonrpc":"2.0","id":1,"error":{"code":-32022,"message":"x"}}), "modern_answered"),
    ("ヘッダ不一致(-32020)", 400,
     json.dumps({"jsonrpc":"2.0","id":1,"error":{"code":-32020,"message":"x"}}), "our_request_wrong"),
    ("discover が無い(-32601)", 404,
     json.dumps({"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"x"}}), "not_modern"),
    # ここから下が、実際に落ちた形とその仲間
    ("error が文字列 ← 実際に落ちた形", 403, json.dumps({"error":"forbidden"}), "not_modern"),
    ("error が配列", 400, json.dumps({"error":[1,2,3]}), "not_modern"),
    ("error が数値", 400, json.dumps({"error":500}), "not_modern"),
    ("error.code が文字列", 400,
     json.dumps({"jsonrpc":"2.0","error":{"code":"-32601","message":"x"}}), "not_modern"),
    ("result が文字列", 200, json.dumps({"jsonrpc":"2.0","result":"ok"}), "not_modern"),
    ("result はあるが supportedVersions が無い", 200,
     json.dumps({"jsonrpc":"2.0","result":{"resultType":"complete"}}), "not_modern"),
    ("本文が配列", 200, json.dumps([1,2,3]), "not_modern"),
    ("本文が null", 200, "null", "not_modern"),
    ("本文が空", 200, "", "not_modern"),
    ("本文が HTML", 404, "<html>nope</html>", "not_modern"),
    ("本文が壊れた JSON", 200, '{"jsonrpc":', "not_modern"),
    ("SSE で正しい discover 応答", 200,
     'event: message\ndata: {"jsonrpc":"2.0","result":{"supportedVersions":["2026-07-28"]}}\n\n',
     "modern_answered"),
    ("SSE だが data が壊れている", 200, "event: message\ndata: {oops\n\n", "not_modern"),
]

def main():
    bad = 0
    print("判定の検査: %d 件\n" % len(CASES))
    for label, code, body, want in CASES:
        try:
            got, note, extra = R.judge(code, body, None)
        except Exception as e:
            print("  ★落ちた  %-34s %s: %s" % (label, type(e).__name__, e)); bad += 1; continue
        ok = (got == want)
        print("  %s %-34s -> %-18s %s" % ("ok  " if ok else "★NG ", label, got, note[:52]))
        if not ok:
            print("        期待: %s" % want); bad += 1

    # 届かなかった場合
    got, note, _ = R.judge(None, "", "timeout")
    print("\n  %s %-34s -> %s" % ("ok  " if got == "held" else "★NG ", "届かない", got))
    if got != "held":
        bad += 1

    print()
    if bad:
        print("★ %d 件ずれています。" % bad); sys.exit(1)
    print("全部通りました。仕様どおりでない返事でも落ちません。")

if __name__ == "__main__":
    main()
