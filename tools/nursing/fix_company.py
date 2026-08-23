# -*- coding: utf-8 -*-
"""
社名が空の店を探して、埋める。管理キーは鍵マネージャから自分で読む。

なぜ要るか (2026-08-24):
  平田様に「加盟店 さま、Yakumo運営です。」が届いた。
  名乗りの側は直したが、もう半分の原因は、店の記録の company が空だったことである。
  社名はご本人が LINE で名乗っておられる。こちらが受け取り損ねていた。

  手で curl を書くと、管理キーを画面に出すことになる。出さずに済ませる。
  鍵は鍵マネージャから読む。ここには書かないし、表示もしない。

使い方:
  python3 tools/nursing/fix_company.py                       空の店を一覧する
  python3 tools/nursing/fix_company.py --id <店ID> --name "社名"   埋める(下見)
  python3 tools/nursing/fix_company.py --id <店ID> --name "社名" --apply
"""

import io, json, os, re, sys, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
HS = os.path.abspath(os.path.join(HERE, "..", ".."))
KEYFILES = [os.path.join(HS, "HORIZON_SHIELD_鍵マネージャ.html"),
            os.path.join(HS, "HORIZON_SHIELD_鍵一覧_20260822.md")]
HOSTS = ["https://hs-hearing.oga-surf-project.workers.dev",
         "https://hearing.horizonshield.dev"]
# Cloudflare の Bot Fight Mode 対策。既定の Python-urllib は名乗りで弾かれ、
# 403 が返る。鍵の問題に見えるが鍵は正しい(2026-08-23 に一度これで誤った)。
UA = "HORIZON-SHIELD-tools/1.0 (fix_company; contact@the-horizons-innovation.com)"


def admin_secret():
    for f in KEYFILES:
        if not os.path.exists(f):
            continue
        src = io.open(f, encoding="utf-8").read()
        for m in re.finditer(r'"(HEARING_ADMIN_SECRET[^"]*)","value":"([0-9a-f]{32,})","status":"([^"]*)"', src):
            name, val, status = m.group(1), m.group(2), m.group(3)
            if "旧" in status or "失効" in name or "旧" in name:
                continue
            print("管理キー: %s から読みました(値は表示しません)" % os.path.basename(f))
            return val
    sys.stderr.write("\n現行の HEARING_ADMIN_SECRET を読めませんでした。\n"
                     "探した場所:\n  " + "\n  ".join(KEYFILES) + "\n\n")
    sys.exit(2)


def call(path, key, body=None):
    last = None
    for h in HOSTS:
        req = urllib.request.Request(
            h + path,
            data=(json.dumps(body, ensure_ascii=False).encode("utf-8") if body else None),
            method=("POST" if body else "GET"),
            headers={"X-Admin-Key": key, "user-agent": UA, "accept": "application/json",
                     **({"content-type": "application/json"} if body else {})})
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
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


def main():
    argv = sys.argv[1:]
    sid = argv[argv.index("--id") + 1] if "--id" in argv else None
    name = argv[argv.index("--name") + 1] if "--name" in argv else None
    apply = "--apply" in argv

    key = admin_secret()
    r = call("/admin/stores", key)
    stores = r.get("stores") or r.get("items") or []
    print("\n店: %d 件" % len(stores))

    rows = []
    for s in stores:
        p = s.get("profile") or {}
        co = (s.get("company") or p.get("company") or "").strip()
        rows.append((s.get("store_id") or s.get("id"), p.get("industry") or "-", co))
    empty = [x for x in rows if not x[2]]

    print("\n%-26s %-14s %s" % ("店ID", "業種", "社名"))
    for i, ind, co in rows:
        mark = "  ← 空" if not co else ""
        print("%-26s %-14s %s%s" % (i, ind, co or "(空)", mark))

    if not sid:
        print("\n社名が空の店: %d 件" % len(empty))
        if empty:
            print("埋めるには:")
            for i, ind, _ in empty:
                print('  python3 tools/nursing/fix_company.py --id %s --name "社名" --apply' % i)
        return

    if not name:
        sys.exit("--name が要ります")
    cur = next((c for i, _, c in rows if i == sid), None)
    if cur is None:
        sys.exit("その店IDが見つかりません: " + sid)
    print("\n店ID   : %s" % sid)
    print("いまの社名: %s" % (cur or "(空)"))
    print("入れる社名: %s" % name)
    if cur and cur != name:
        # 既に入っているものを、こちらの判断で上書きしない。
        print("\n既に社名が入っています。上書きは自動でしません。", file=sys.stderr)
        print("本当に差し替えるなら、いまの値を消してから実行してください。", file=sys.stderr)
        sys.exit(3)
    if not apply:
        print("\n(--apply が無いので、まだ書いていません)")
        return
    out = call("/admin/profile-patch", key, {"store_id": sid, "company": name})
    print("\n応答: %s" % json.dumps(out, ensure_ascii=False)[:300])
    chk = call("/admin/stores", key)
    for s in (chk.get("stores") or chk.get("items") or []):
        if (s.get("store_id") or s.get("id")) == sid:
            p = s.get("profile") or {}
            print("確認: 社名 = %s" % (s.get("company") or p.get("company") or "(まだ空)"))


if __name__ == "__main__":
    main()
