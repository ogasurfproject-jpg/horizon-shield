# -*- coding: utf-8 -*-
"""
捨ててしまった回答を、本人に訊き直さずに取り込む。

2026-08-23 22:30。平田様(合同会社アップス / さざなみ訪問看護ステーション)は、
訊いた3つに全部お答えくださった。ところが業種ゲートが、その文から業種だけ読み取って
中身を捨て、同じ3問を送り返した。仕組みは直したが、直したのは「これから」の分である。
既に捨てた回答は戻らない。

もう一度お送りくださいと言うのは、筋が通らない。相手は既に答えている。
だから、いただいた文をそのまま、正規の取り込み口(/admin/email-ingest)に流す。
LLM の抽出も、突合も、完成度の計算も、普段と同じ経路を通る。
こちらで構造を手打ちして KV に書くことはしない。手打ちは、相手が言っていないことを
書き込む余地を作る。

使い方:
  python3 tools/replay_answer.py --store kira-wbbk99p9 --file /tmp/hirata.txt
  python3 tools/replay_answer.py --store kira-wbbk99p9 --file /tmp/hirata.txt --send
--send を付けるまで、何も送らない。
"""

import argparse, io, json, os, re, subprocess, sys, urllib.request

NS = "cae22b3bf47b46bebdfcdfd6a724f8ab"

# 2026-08-23。独自ドメイン側で 403 が返った。hs-hearing の wrangler.jsonc に
# routes の記載が無く、hearing.horizonshield.dev は別の経路で振られているため、
# 管理エンドポイントがそこで止まっている疑いがある。
# ワーカー本来の宛先を先に試し、駄目なら独自ドメインを試して、
# どちらが何を返したかを必ず表に出す。黙って片方だけ試して諦めない。
HOSTS = [
    "https://hs-hearing.oga-surf-project.workers.dev",
    "https://hearing.horizonshield.dev",
]
PATH = "/admin/email-ingest"
KEYFILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                       "HORIZON_SHIELD_鍵マネージャ.html")


def admin_secret():
    """鍵マネージャから現行の管理キーを読む。旧・失効のものは採らない。"""
    src = io.open(KEYFILE, encoding="utf-8").read()
    for m in re.finditer(r'"(HEARING_ADMIN_SECRET[^"]*)","value":"([0-9a-f]{32,})","status":"([^"]*)"', src):
        name, val, status = m.group(1), m.group(2), m.group(3)
        if "旧" in status or "失効" in name or "旧" in name:
            continue
        return val
    raise SystemExit("鍵マネージャから現行の HEARING_ADMIN_SECRET を読めませんでした")


def store_token(store_id):
    r = subprocess.run(["npx", "wrangler", "kv", "key", "get",
                        "--namespace-id", NS, "store:" + store_id, "--remote"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(r.stderr[-600:] + "\n")
        raise SystemExit("店を読めませんでした: " + store_id)
    out = r.stdout
    i = out.find("{")
    s = json.loads(out[i:])
    return s.get("token"), s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--store", required=True)
    ap.add_argument("--file", required=True, help="お客様が実際に送ってこられた文をそのまま入れたファイル")
    ap.add_argument("--send", action="store_true")
    a = ap.parse_args()

    text = io.open(a.file, encoding="utf-8").read().strip()
    if not text:
        raise SystemExit("本文が空です")

    tok, store = store_token(a.store)
    if not tok:
        raise SystemExit("この店に token がありません: " + a.store)

    print("店       : %s" % a.store)
    print("会社名   : %s" % json.dumps(store.get("company", ""), ensure_ascii=False))
    print("業種     : %s" % json.dumps(store.get("industry"), ensure_ascii=False))
    print("状態     : %s" % store.get("status"))
    print("token    : %s…" % tok[:8])
    print("\n--- 流す本文(お客様の言葉のまま。加工していません) ---")
    print(text)
    print("--- ここまで %d 文字 ---" % len(text))

    if not store.get("industry"):
        print("\n業種が入っていません。先に set_industry.py で業種を決めてください。", file=sys.stderr)
        print("業種が無いと、建設用の抽出プロンプトが使われます。", file=sys.stderr)
        sys.exit(3)

    if not a.send:
        print("\n(--send が無いので、まだ送っていません)")
        return

    body = json.dumps({"token": tok, "text": text}, ensure_ascii=False).encode("utf-8")
    key = admin_secret()
    res = None
    print("")
    for host in HOSTS:
        url = host + PATH
        req = urllib.request.Request(url, data=body, method="POST", headers={
            "content-type": "application/json",
            "X-Admin-Key": key,
            # Cloudflare の error 1010 対策。
            # 既定の "Python-urllib/3.9" は Bot Fight Mode に名乗りで弾かれる。
            # 同じ鍵・同じ宛先でも curl は通り、Python だけが 403 になっていた
            # (2026-08-23)。鍵の問題に見えるが、鍵は正しい。
            "user-agent": "HORIZON-SHIELD-tools/1.0 (replay_answer; contact@the-horizons-innovation.com)",
            "accept": "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                res = json.loads(r.read().decode("utf-8"))
            print("  %-52s HTTP 200" % host)
            break
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", "replace")[:160]
            except Exception:
                pass
            print("  %-52s HTTP %s  %s" % (host, e.code, detail))
        except Exception as e:
            print("  %-52s 届かず  %s" % (host, str(e)[:80]))

    if res is None:
        print("\nどちらのホストでも取り込めませんでした。", file=sys.stderr)
        print("403 が両方なら、ワーカーに設定されている HEARING_ADMIN_SECRET が、", file=sys.stderr)
        print("鍵マネージャに書いてある値と違います。次で確かめられます:", file=sys.stderr)
        print("  cd workers/hs-hearing && npx wrangler secret list", file=sys.stderr)
        sys.exit(4)

    print("\n取り込み結果:")
    print(json.dumps(res, ensure_ascii=False, indent=2))
    if not res.get("ok"):
        print("\n取り込めませんでした。理由は上の result を見てください。", file=sys.stderr)
        print("missing-required なら、会社名・地域・処置のどれかが抽出できていません。", file=sys.stderr)
        sys.exit(5)


if __name__ == "__main__":
    main()
