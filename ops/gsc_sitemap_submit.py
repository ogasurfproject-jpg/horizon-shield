#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GSC に sitemap.xml を(再)送信する。gsc_check.py と同じ OAuth(client_secret.json)を使う。
gsc_check.py の token.json は readonly スコープなので、この台本は書込スコープで別の token_sitemaps.json を作る。
初回だけブラウザが開いて「許可」を聞く(GSC のオーナー本人のアカウントで許可する)。

使い方(~/horizon-shield で):
  python3 ops/gsc_sitemap_submit.py            現状の一覧だけ出す(送らない)
  python3 ops/gsc_sitemap_submit.py --send     sitemap.xml を送信して、一覧を出す
  --site / --feed で変えられる。既定は URL プレフィックス型の https://shield.the-horizons-innovation.com/
  GSC が「ドメイン」型なら --site sc-domain:the-horizons-innovation.com
"""
import argparse, os, sys, json
SCOPES = ["https://www.googleapis.com/auth/webmasters"]
CLIENT_SECRET = "client_secret.json"
TOKEN = "token_sitemaps.json"

def get_service():
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build
    creds = None
    if os.path.exists(TOKEN):
        creds = Credentials.from_authorized_user_file(TOKEN, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(CLIENT_SECRET):
                print("エラー: %s が無い。~/horizon-shield で実行しているか確認。" % CLIENT_SECRET); sys.exit(1)
            flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRET, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN, "w") as f:
            f.write(creds.to_json())
    return build("searchconsole", "v1", credentials=creds, cache_discovery=False)

def show(service, site):
    r = service.sitemaps().list(siteUrl=site).execute()
    rows = r.get("sitemap", [])
    if not rows:
        print("GSC に登録されている sitemap: 0 件"); return
    for s in rows:
        c = s.get("contents") or []
        web = [x for x in c if x.get("type") == "web"]
        sub = web[0].get("submitted") if web else "?"
        idx = web[0].get("indexed") if web else "?"
        print("  %s | 最終送信 %s | 最終取得 %s | pending=%s | 送信URL %s / 索引 %s | warn %s err %s" % (
            s.get("path"), s.get("lastSubmitted"), s.get("lastDownloaded"), s.get("isPending"),
            sub, idx, s.get("warnings", 0), s.get("errors", 0)))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", default="https://shield.the-horizons-innovation.com/")
    ap.add_argument("--feed", default="https://shield.the-horizons-innovation.com/sitemap.xml")
    ap.add_argument("--send", action="store_true", help="付けて初めて送信。既定は一覧表示のみ")
    a = ap.parse_args()
    svc = get_service()
    print("=== 送信前 ==="); show(svc, a.site)
    if not a.send:
        print("[dry-run] 送っていない。送るなら --send"); return
    svc.sitemaps().submit(siteUrl=a.site, feedpath=a.feed).execute()
    print("送信した: %s" % a.feed)
    print("=== 送信後 ==="); show(svc, a.site)

if __name__ == "__main__":
    main()
