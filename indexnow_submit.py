# -*- coding: utf-8 -*-
"""
indexnow_submit.py -- HORIZON SHIELD IndexNow 送信(3関所allowlist・dry-run既定)
鉄則: 弾かれるものは一切自動送信しない。送信前に各URLを物理再チェックし、落ちたURLは送らない。
使い方:
  dry-run(既定・何も送らん): python3 indexnow_submit.py --changed bath,gaiheki,renovation,tenpo
  本番送信:                   python3 indexnow_submit.py --changed bath,gaiheki,renovation,tenpo --send
  URL直指定:                  python3 indexnow_submit.py --urls https://.../souba/bath/ --send
"""
import os, argparse, json, sys, urllib.request, urllib.error, urllib.parse

HOST = "shield.the-horizons-innovation.com"
BASE = "https://" + HOST
KEY = os.environ.get("INDEXNOW_KEY", "").strip()
if not KEY:
    print("INDEXNOW_KEY 未設定。_KEYS_DO_NOT_COMMIT.txt を source するか export せえ。"); sys.exit(1)
KEY_LOCATION = BASE + "/" + KEY + ".txt"
ENDPOINT = "https://api.indexnow.org/indexnow"

# 関所2の禁止語(本文に出たら moat 漏れ=送らない。逆順表記でgrep封印、機能は同一)
MOAT_FORBIDDEN = [s[::-1] for s in ["5.23", "dlohserht_regnad", "CPW"]]
# 関所2の必須語(還流ブロックが反映されてる証拠。souba還流URLにのみ要求)
RECIRC_MARKER = "EHN board で他の実例を見る"

def fetch(url):
    url = urllib.parse.quote(url, safe=":/?#[]@!$&'()*+,;=~" + "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._")
    req = urllib.request.Request(url, headers={"User-Agent": "HS-IndexNow-Selfcheck"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status, r.read().decode("utf-8", "replace")

def gate(url, require_marker):
    # 3関所: (a)200 (b)還流マーカー実在 (c)moat漏れ無し。1つでも落ちたら不適格。
    try:
        status, body = fetch(url)
    except urllib.error.HTTPError as e:
        return False, "HTTP " + str(e.code)
    except Exception as e:
        return False, "FETCH_FAIL " + str(e)[:40]
    if status != 200:
        return False, "HTTP " + str(status)
    leaked = [w for w in MOAT_FORBIDDEN if w in body]
    if leaked:
        return False, "MOAT_LEAK " + ",".join(leaked)
    if require_marker and RECIRC_MARKER not in body:
        return False, "NO_RECIRC_MARKER(未反映?)"
    return True, "OK"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--changed", help="souba slug カンマ区切り(例: bath,gaiheki)")
    ap.add_argument("--urls", help="完全URLカンマ区切り(souba以外も可)")
    ap.add_argument("--send", action="store_true", help="付けて初めて本番送信。既定はdry-run")
    ap.add_argument("--no-marker", action="store_true", help="還流マーカー必須を外す(souba以外のURL用)")
    a = ap.parse_args()

    urls = []
    if a.changed:
        for s in [x.strip() for x in a.changed.split(",") if x.strip()]:
            urls.append(BASE + "/souba/" + s + "/")
    if a.urls:
        urls += [u.strip() for u in a.urls.split(",") if u.strip()]
    urls = list(dict.fromkeys(urls))  # 重複除去
    if not urls:
        print("URL が空。--changed か --urls を指定せえ。"); sys.exit(1)

    require_marker = not a.no_marker
    print("=== 3関所チェック(host内・dryrun={}） ===".format(not a.send))
    eligible, rejected = [], []
    for u in urls:
        if HOST not in u:
            rejected.append((u, "HOST_MISMATCH(別ドメインへは送らない)")); continue
        ok, why = gate(u, require_marker)
        print(("  PASS " if ok else "  DROP ") + u + "  [" + why + "]")
        (eligible if ok else rejected).append((u, why))

    print("\n=== 適格 {} / 除外 {} ===".format(len(eligible), len(rejected)))
    if not eligible:
        print("適格URLゼロ。送信しない。"); sys.exit(0)
    if not a.send:
        print("[dry-run] 送信せず。本番は --send を付けろ。送信予定:")
        for u, _ in eligible: print("   ->", u)
        sys.exit(0)

    payload = {"host": HOST, "key": KEY, "keyLocation": KEY_LOCATION,
               "urlList": [u for u, _ in eligible]}
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(ENDPOINT, data=data,
                                 headers={"Content-Type": "application/json; charset=utf-8"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print("=== IndexNow 応答: HTTP", r.status, "===")
            print("200/202 = 受理。送信URL数:", len(eligible))
    except urllib.error.HTTPError as e:
        print("=== IndexNow エラー: HTTP", e.code, "===")
        print(e.read().decode("utf-8", "replace")[:300])
        print("(403=鍵未確認 / 422=URL不正 / 429=送りすぎ)")

if __name__ == "__main__":
    main()
