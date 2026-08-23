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
    # 2026-08-24: ここは sid という名前で持っていた。
    #   そして下の一覧を作るループでも sid を使い回していた。
    #   ループが終わったとき sid は「最後に見た店」になっていて、
    #   --id kira-wbbk99p9 と打っても hs-partner-002 を書き換えようとした。
    #   ミネオトーヨー住器さまの社名が、別の会社の名前で潰れるところだった。
    #   止めたのは「既に社名が入っている」という別の門である。偶然に近い。
    #   引数は want_id という別の名前で持ち、途中で書き換わらないようにする。
    want_id = argv[argv.index("--id") + 1] if "--id" in argv else None
    name = argv[argv.index("--name") + 1] if "--name" in argv else None
    apply = "--apply" in argv

    key = admin_secret()
    r = call("/admin/stores", key)
    stores = r.get("stores") or r.get("items") or []
    print("\n店: %d 件" % len(stores))

    # 2026-08-24: /admin/stores の行は storeToContractor が作っており、
    #   社名は company ではなく name に入る。industry は入らない。
    #   最初この道具は company だけを見て、全部「空」と出していた。
    #   厚い方(hearing:<id>.profile)は /admin/export/<id> にある。両方見る。
    rows = []
    for s in stores:
        row_id = s.get("store_id") or s.get("id")
        thin = (s.get("name") or s.get("company") or "").strip()
        ex = call("/admin/export/" + row_id, key) if row_id else {}
        pr = (ex or {}).get("profile") or {}
        thick = str(pr.get("company") or "").strip()
        rows.append({
            "id": row_id,
            "industry": pr.get("industry") or "-",
            "thin": thin,          # store: 側
            "thick": thick,        # hearing:<id>.profile 側
            "line": s.get("line_linked"),
            "answered": (ex or {}).get("answered_at") or s.get("answered_at") or "",
            "area": pr.get("area") or s.get("area") or "",
        })
    empty = [r for r in rows if not (r["thin"] or r["thick"])]

    print("\n%-18s %-13s %-26s %-26s %s" % ("店ID", "業種", "社名(store側)", "社名(profile側)", "最終回答"))
    for r in rows:
        mark = "  ← 両方とも空" if not (r["thin"] or r["thick"]) else ""
        print("%-18s %-13s %-26s %-26s %s%s"
              % (r["id"], r["industry"], r["thin"] or "(空)", r["thick"] or "(空)",
                 str(r["answered"])[:19], mark))
        if r["area"]:
            print("%-18s   エリア: %s" % ("", r["area"]))

    if not want_id:
        print("\n社名が空の店: %d 件" % len(empty))
        if empty:
            print("\nそのまま貼れる形にしてあります。社名だけ、実際のものに書き換えてください:")
            for r in empty:
                print('  python3 tools/nursing/fix_company.py --id %s --name "ここに社名" --apply' % r["id"])
        return

    if not name:
        sys.exit("--name が要ります")
    row = next((r for r in rows if r["id"] == want_id), None)
    if row is None:
        sys.exit("その店IDが見つかりません: " + want_id)
    cur = row["thin"] or row["thick"]
    print("\n店ID   : %s" % row["id"])
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
    # 2026-08-24: 送る形は {store_id, fields:{company:...}} である。
    #   平らに {store_id, company:...} と送ると no_allowed_field が返る。
    #   最初この道具はその形で送ろうとしていた。
    # 書く直前に、もう一度だけ突き合わせる。
    # 変数の取り違えは、動く道具の中では見えない。書く瞬間に確かめる。
    if row["id"] != want_id:
        sys.exit("指示された店と、書こうとしている店が違います: 指示=%s / 対象=%s"
                 % (want_id, row["id"]))
    print("\n対象の突き合わせ: 指示=%s / 対象=%s  一致" % (want_id, row["id"]))
    out = call("/admin/profile-patch", key, {"store_id": row["id"], "fields": {"company": name}})
    print("\n応答: %s" % json.dumps(out, ensure_ascii=False)[:300])
    ex = call("/admin/export/" + row["id"], key)
    pr = (ex or {}).get("profile") or {}
    print("確認: profile 側の社名 = %s" % (pr.get("company") or "(まだ空)"))
    print("  呼びかけは store 側と profile 側の両方を見るので、これで名前で呼ばれます。")


if __name__ == "__main__":
    main()
