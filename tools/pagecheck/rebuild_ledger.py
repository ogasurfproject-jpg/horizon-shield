# -*- coding: utf-8 -*-
"""
台帳を作り直す。

なぜ要るか:
  剥がす枠のパターンを直したので、指紋の計算結果が変わる。
  台帳には古い計算での指紋が入っているので、そのままだと照合できない。
  照合できない台帳は、落ちるのではなく「重複なし」と言い続ける。

作り直しの条件:
  ・全エントリを一斉に入れ替える。一部だけ新しくすると、
    新旧が混ざった台帳になり、どちらとも照合できない状態が残る。
  ・入れ替えるのは、いま台帳にあるものだけ。新しいページを足さない。
    2026-08-23、最初この道具は台帳を 9 件から 20 件に増やそうとした。
    増える 11 件は yakumo/index.html や admin/ など、生成器が作ったものではない
    静的ページである。それを重複台帳に入れると、今後の生成で
    「モールのトップに似ている」という理由で弾かれることが起きうる。
    これは移行であって、台帳の意味を変える作業ではない。
  ・古い台帳は消さない。控えを残す。
    消すと、作り直しが正しかったかどうかを後から確かめられない。
  ・作り直す前と後で、何件が何件になったかを必ず出す。
    黙って入れ替えない。

確かめること:
  作り直したあと、いま公開されているページを生成器に通して、
  すべて重複として弾かれること。弾かれなければ台帳が効いていない。
"""

import io, json, os, shutil, sys


def find_repo(start):
    d = os.path.abspath(start)
    for _ in range(6):
        if os.path.isdir(os.path.join(d, ".git")) and \
           os.path.exists(os.path.join(d, "tools", "pagecheck", "fingerprint.py")):
            return d
        p = os.path.dirname(d)
        if p == d:
            break
        d = p
    return None


ROOT = os.environ.get("REPO")
ROOT = os.path.abspath(ROOT) if ROOT else find_repo(os.path.dirname(os.path.abspath(__file__)))
if not ROOT:
    sys.stderr.write("\nリポジトリの根が見つかりません。REPO=<パス> を付けてください。\n\n")
    sys.exit(1)

sys.path.insert(0, os.path.join(ROOT, "tools", "pagecheck"))
import fingerprint as F  # noqa: E402

STAMP = ".bak_prerebuild20260823"


def main():
    apply = "--apply" in sys.argv
    led_path = F.CONTENT_LEDGER
    old = F.ledger_load()
    old_entries = old.get("entries", [])
    old_by_slug = {e.get("slug"): e for e in old_entries}

    # いま台帳にあるものだけを、新しい計算で取り直す。増やさない。
    new_entries, changed, gone = [], 0, []
    for slug, prev in old_by_slug.items():
        page = os.path.join(ROOT, str(slug), "index.html")
        if not os.path.exists(page):
            gone.append(slug)
            new_entries.append(prev)   # ページが無いものは、そのまま残す(勝手に消さない)
            continue
        canonical = F.BASE + "/" + str(slug) + "/"
        fp = F.fingerprint(canonical, io.open(page, encoding="utf-8").read())
        if prev.get("m"):
            fp["m"] = prev["m"]
        if prev.get("simhash") != fp["simhash"] or prev.get("tsha") != fp["tsha"]:
            changed += 1
        new_entries.append(fp)
    added = 0

    print("台帳: %s" % os.path.relpath(led_path, ROOT))
    print("  いまのエントリ      : %d" % len(old_entries))
    print("  作り直すと          : %d" % len(new_entries))
    print("    指紋が変わるもの  : %d" % changed)
    print("    新しく入るもの    : %d (この道具は台帳を増やしません)" % added)
    print("    ページが見つからないもの: %d" % len(gone))
    for s in gone[:8]:
        print("      ・" + str(s))
    if gone:
        print("    (古い指紋のまま残します。勝手に消しません)")

    if not apply:
        print("\n(--apply が無いので、まだ書いていません)")
        return

    shutil.copy2(led_path, led_path + STAMP)
    led = dict(old)
    led["entries"] = new_entries
    led["rebuilt_at"] = "2026-08-23"
    led["rebuilt_why"] = ("指紋から剥がす共通枠のパターンを直したため、計算結果が変わった。"
                          "全エントリを一斉に入れ替えて整合を保った。"
                          "古い台帳は %s に残してある。" % os.path.basename(led_path + STAMP))
    io.open(led_path, "w", encoding="utf-8").write(
        json.dumps(led, ensure_ascii=False, indent=1) + "\n")
    print("\n作り直しました。控え: %s" % os.path.basename(led_path + STAMP))
    print("次に、いま公開されているページを生成器に通して、すべて重複として弾かれることを確かめてください。")


if __name__ == "__main__":
    main()
