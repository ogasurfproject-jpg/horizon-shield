# -*- coding: utf-8 -*-
"""
管理エンドポイントへの入口。鍵の読み方と呼び方を、ここ1箇所に置く。

なぜ要る (2026-08-24):
  鍵の探し方を fix_company.py と collect_field_reports.py の2箇所に書いていた。
  片方だけ直したので、collect 側は鍵一覧(.md)を見ていた。
  現行の鍵は鍵マネージャ(.html)にあり、.md には1件も入っていない。
  だから collect は「現行の HEARING_ADMIN_SECRET を読めませんでした」で止まった。

  同じことを2箇所に書けば、片方だけ直る。これは今日、
  算定要件データベースでも、社名でも、同じ形で起きた。
  今度は写しを作らず、1箇所にする。

鍵は表示しない。読めたことだけを言う。
"""

import io, json, os, re, sys, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
HS = os.path.abspath(os.path.join(HERE, "..", ".."))

# 探す順。現行の鍵は鍵マネージャ(.html)にある。
KEYFILES = [
    os.path.join(HS, "HORIZON_SHIELD_鍵マネージャ.html"),
    os.path.join(HS, "HORIZON_SHIELD_鍵一覧_20260822.md"),
    os.path.join(os.path.expanduser("~"), "HORIZON_SHIELD_鍵マネージャ.html"),
]

HOSTS = ["https://hs-hearing.oga-surf-project.workers.dev",
         "https://hearing.horizonshield.dev"]

# Cloudflare の Bot Fight Mode 対策。既定の Python-urllib は名乗りで弾かれ 403 を返す。
# 鍵の問題に見えるが鍵は正しい(2026-08-23 に一度これで誤った)。
UA = "HORIZON-SHIELD-tools/1.0 (+contact@the-horizons-innovation.com)"

_PAT = re.compile(r'"(HEARING_ADMIN_SECRET[^"]*)","value":"([0-9a-f]{32,})","status":"([^"]*)"')


def admin_secret(quiet=False):
    """現行の管理キーを読む。旧・失効のものは採らない。値は表示しない。"""
    looked = []
    for f in KEYFILES:
        looked.append(f)
        if not os.path.exists(f):
            continue
        src = io.open(f, encoding="utf-8", errors="replace").read()
        for m in _PAT.finditer(src):
            name, val, status = m.group(1), m.group(2), m.group(3)
            if "旧" in status or "失効" in name or "旧" in name:
                continue
            if not quiet:
                print("管理キー: %s から読みました(値は表示しません)" % os.path.basename(f))
            return val
    sys.stderr.write("\n現行の HEARING_ADMIN_SECRET を読めませんでした。\n探した場所:\n  "
                     + "\n  ".join(looked) + "\n\n")
    sys.exit(2)


def call(path, key, body=None, timeout=45):
    """管理エンドポイントを1回。どのホストが何を返したかを黙らない。"""
    last = None
    for h in HOSTS:
        headers = {"X-Admin-Key": key, "user-agent": UA, "accept": "application/json"}
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            headers["content-type"] = "application/json"
        req = urllib.request.Request(h + path, data=data,
                                     method=("POST" if body is not None else "GET"),
                                     headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8")[:200]
            except Exception:
                pass
            last = "HTTP %d %s  %s" % (e.code, h, detail)
            print("  " + last)
        except Exception as e:
            last = "%s %s" % (type(e).__name__, h)
            print("  " + last)
    sys.exit("届きませんでした: " + str(last))
