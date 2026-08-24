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

def _main_worktree():
    """git の本体(最初のチェックアウト)の場所。

    2026-08-24: 鍵マネージャは(正しく)git に入っていない。
      そのため worktree で作業すると、そこには存在しない。
      実際に /tmp/hs-deploy(worktree)から道具を走らせて
      「現行の HEARING_ADMIN_SECRET を読めませんでした」で止まった。
      鍵が無いのではなく、鍵を探す場所が worktree だっただけである。

      本体は .git/worktrees/<名前> の2つ上にある。そこも探す。
    """
    try:
        import subprocess
        common = subprocess.run(["git", "rev-parse", "--path-format=absolute",
                                 "--git-common-dir"],
                                cwd=HS, capture_output=True, text=True).stdout.strip()
        if common.endswith("/.git"):
            return os.path.dirname(common)
    except Exception:
        pass
    return None


# 探す順。現行の鍵は鍵マネージャ(.html)にある。
KEYFILES = []
if os.environ.get("HS_ADMIN_KEYFILE"):
    KEYFILES.append(os.environ["HS_ADMIN_KEYFILE"])
for _root in [HS, _main_worktree(), os.path.expanduser("~"),
              os.path.join(os.path.expanduser("~"), "Desktop", "hs-docfix")]:
    if not _root:
        continue
    KEYFILES.append(os.path.join(_root, "HORIZON_SHIELD_鍵マネージャ.html"))
    KEYFILES.append(os.path.join(_root, "HORIZON_SHIELD_鍵一覧_20260822.md"))
# 同じ場所を二度探さない(見つからなかったときの一覧が読みにくくなる)
_seen, _uniq = set(), []
for _f in KEYFILES:
    if _f in _seen:
        continue
    _seen.add(_f)
    _uniq.append(_f)
KEYFILES = _uniq

HOSTS = ["https://hs-hearing.oga-surf-project.workers.dev",
         "https://hearing.horizonshield.dev"]
# 試験のときだけ宛先を差し替える。既定は本番のまま。
# 環境変数が無ければ何も変わらないので、本番の経路に影響しない。
if os.environ.get("HS_ADMIN_HOSTS"):
    HOSTS = [h for h in os.environ["HS_ADMIN_HOSTS"].split(",") if h.strip()]

# Cloudflare の Bot Fight Mode 対策。既定の Python-urllib は名乗りで弾かれ 403 を返す。
# 鍵の問題に見えるが鍵は正しい(2026-08-23 に一度これで誤った)。
UA = "HORIZON-SHIELD-tools/1.0 (+contact@the-horizons-innovation.com)"

_PAT = re.compile(r'"(HEARING_ADMIN_SECRET[^"]*)","value":"([0-9a-f]{32,})","status":"([^"]*)"')


def admin_secret(quiet=False):
    """現行の管理キーを読む。旧・失効のものは採らない。値は表示しない。

    2026-08-24: 鍵マネージャは(正しく)リポジトリに入っていない。
      そのため CI では必ずここで落ち、失敗の通知が飛び続けた。
      試験は本物の鍵を要らない。模擬のサーバに当てるだけである。
      環境変数があればそれを使う。無ければ従来どおり鍵マネージャを読む。
      本番の経路は変わらない。
    """
    env_key = os.environ.get("HS_ADMIN_KEY")
    if env_key:
        if not quiet:
            print("管理キー: 環境変数から読みました(値は表示しません)")
        return env_key
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


# --- 欄名の解釈も、ここ1箇所に置く -----------------------------------------
# 2026-08-24: /admin/stores の行は storeToContractor が作っており、
#   店IDは store_id、社名は name である。company でも id でもない。
#   collect_field_reports.py は s.get("id") と書いていて、全部 None になり、
#   "/admin/export/" + None で落ちた。fix_company.py には正しく書いてあった。
#   欄名を各所で解釈すれば、解釈は必ずずれる。ここでだけ解釈する。

def row_id(row):
    return row.get("store_id") or row.get("id")


def row_company(row):
    """薄い方(store:)の社名。厚い方は profile にある。"""
    return (row.get("name") or row.get("company") or "").strip()


def stores(key):
    """加盟店の一覧。id を正規化して返す。"""
    r = call("/admin/stores", key)
    rows = r.get("stores") or r.get("items") or []
    out = []
    for row in rows:
        i = row_id(row)
        if not i:
            # 黙って捨てない。捨てた店は、居なかったことになる。
            print("  ★ 店IDの読めない行があります: %s" % sorted(row.keys())[:8])
            continue
        row = dict(row); row["_id"] = i
        out.append(row)
    return out


def export(sid, key):
    """厚い方(hearing:<id>)。profile と answered_at を返す。"""
    if not sid:
        raise ValueError("店IDが空です")
    return call("/admin/export/" + sid, key)
