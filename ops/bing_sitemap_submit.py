#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bing Webmaster に sitemap を API で登録する(SubmitFeed)。Google には見せない別 sitemap を Bing にだけ出すための台本。
鍵: 環境変数 BING_WMT_KEY(Bing Webmaster > 設定 > API アクセス > API キー。値はどこにも書かない)。

使い方:
  export BING_WMT_KEY=...   (先に打つ。未設定なら止まる)
  python3 ops/bing_sitemap_submit.py                    登録済み一覧だけ(送らない)
  python3 ops/bing_sitemap_submit.py --send             sitemap-archive.xml と sitemap-yakumo.xml を登録して一覧
  python3 ops/bing_sitemap_submit.py --send --feeds https://.../a.xml,https://.../b.xml
"""
import os, sys, json, argparse, urllib.request, urllib.parse, urllib.error
SITE = "https://shield.the-horizons-innovation.com/"
FEEDS = [SITE + "sitemap-archive.xml", SITE + "sitemap-yakumo.xml"]
API = "https://ssl.bing.com/webmaster/api.svc/json/"

def call(method, key, params=None, body=None):
    q = {"apikey": key}
    if params: q.update(params)
    url = API + method + "?" + urllib.parse.urlencode(q)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET",
                                 headers={"Content-Type": "application/json; charset=utf-8", "User-Agent": "HS-bing-sitemap-submit"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")

def show(key):
    st, txt = call("GetFeeds", key, {"siteUrl": SITE})
    if st != 200:
        print("GetFeeds 失敗 HTTP %s: %s" % (st, txt[:300])); return
    rows = (json.loads(txt).get("d") or [])
    print("Bing 登録済み sitemap: %d 件" % len(rows))
    for f in rows:
        if "Url" not in f:
            print("  " + json.dumps(f, ensure_ascii=False)[:300]); continue
        print("  %s | 状態 %s | 送信 %s | 最終クロール %s | URL数 %s" % (
            f.get("Url"), f.get("Status"), f.get("Submitted"), f.get("LastCrawled"), f.get("UrlCount")))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--send", action="store_true", help="付けて初めて登録。既定は一覧表示のみ")
    ap.add_argument("--feeds", help="完全URLカンマ区切り。既定は sitemap-archive.xml と sitemap-yakumo.xml")
    a = ap.parse_args()
    key = os.environ.get("BING_WMT_KEY", "").strip()
    if key and not (key.isalnum() and len(key) >= 20):
        print("環境変数 BING_WMT_KEY に鍵でない文字列が入っている(前に貼った仮の文字が残っている)。無視して画面で聞く。")
        key = ""
    if not key:
        # 2026-09-13: export の置き場に「ここに値を貼る」を貼ったまま実行される事故があったので、
        # 環境変数が無ければ画面で聞く(入力は表示されない)。
        import getpass
        key = getpass.getpass("Bing Webmaster の API キー(設定 > API アクセス で生成した 32 桁の英数字)を貼って Enter: ").strip()
    if not key or not key.isalnum() or len(key) < 20:
        print("キーの形が違う(英数字 32 桁のはず)。何も送っていない。"); sys.exit(1)
    feeds = [u.strip() for u in a.feeds.split(",")] if a.feeds else FEEDS
    print("=== 登録前 ==="); show(key)
    if not a.send:
        print("[dry-run] 送っていない。登録予定:"); [print("  " + u) for u in feeds]; return
    for u in feeds:
        st, txt = call("SubmitFeed", key, body={"siteUrl": SITE, "feedUrl": u})
        print(("登録 OK " if st == 200 else "登録 失敗 HTTP %s " % st) + u + ("" if st == 200 else " " + txt[:200]))
    print("=== 登録後 ==="); show(key)

if __name__ == "__main__":
    main()
