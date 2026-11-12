# -*- coding: utf-8 -*-
"""
/yakumo/souba/ の答えの頁を作る(2026-11-06)。

  1. tools/yakumo/souba_questions.json の問いから、店の盤の答えの頁を作る(generate.question_page)。
     数は souba-db の行 x 地域係数だけ。行の無い問いには金額を書かない。
  2. 新しい頁を sitemap-yakumo.xml に足す。既にある URL の行は触らない。
  3. data/yakumo-content-manifest.json(重複ゼロ台帳)に指紋を足す。別の頁と重複する頁は書かない。
  既にある工事 x 地域の頁(yakumo/souba/<工種>-<地域>/)には触らない。

何度当てても同じ bytes になる。

使い方:
  python3 tools/yakumo/souba_answers.py                   見るだけ(どの頁がどう変わるか)
  python3 tools/yakumo/souba_answers.py --apply [--date YYYY-MM-DD]
  その後 python3 tools/pagecheck/validate.py --paths <変わった頁> で門に通す
"""
import argparse, datetime, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import generate as G  # noqa: E402

QUESTIONS = os.path.join(HERE, "souba_questions.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--date", default=datetime.date.today().strftime("%Y-%m-%d"), help="sitemap に足す行の lastmod")
    a = ap.parse_args()
    root = G.REPO_ROOT
    out = []   # (relpath, canonical, html, member, new?)
    q = json.load(open(QUESTIONS, encoding="utf-8"))
    for s in q["stores"]:
        rec = G.verification_record(s["member_slug"])
        if not rec:
            print("止めた: %s の検証の記録が無い" % s["member_slug"], file=sys.stderr)
            return 1
        profile = {"company": rec[0].get("name"), "member_no": rec[0].get("member_no")}
        for page in s["pages"]:
            canonical, h = G.question_page(profile, page, s["area"])
            rel = G.canonical_to_path(canonical)[len(root) + 1:]
            ex = os.path.join(root, rel)
            old = open(ex, encoding="utf-8").read() if os.path.exists(ex) else None
            out.append((rel, canonical, h, s["member_slug"], old is None, old != h))
            print("%-6s %-45s %s" % ("NEW" if old is None else ("UPDATE" if old != h else "SAME"), page["slug"], page["question"]))
    if not a.apply:
        print("見るだけ。--apply で書く。")
        return 0
    ledger = G.ledger_load()
    known = list(ledger.get("entries", []))
    for rel, canonical, h, ms, is_new, changed in out:
        fp = G.fingerprint(canonical, h, member=ms)
        why, hit = G.duplicate_of(fp, known)
        if why and not (why.startswith("slug:") and hit and hit.get("m") in (None, ms)):
            print("止めた: %s は %s と重複(%s)。何も書いていない。" % (rel, hit.get("slug") if hit else "?", why), file=sys.stderr)
            return 1
        # 同じ slug の行はその場で差し替え、新しい頁は末尾に足す(台帳の並びを動かさない)
        idx = [i for i, e in enumerate(known) if e.get("slug") == fp["slug"]]
        if idx:
            known[idx[0]] = fp
        else:
            known.append(fp)
    for rel, canonical, h, ms, is_new, changed in out:
        if changed:
            os.makedirs(os.path.dirname(os.path.join(root, rel)), exist_ok=True)
            open(os.path.join(root, rel), "w", encoding="utf-8").write(h)
    if any(c for *_x, c in out):
        ledger["entries"] = known[-5000:]
        ledger["updated_at"] = a.date + "T00:00:00Z"
        G.ledger_save(ledger)
    added = G.update_sitemap([c for _r, c, _h, _m, n, _c in out if n], a.date)
    print("WROTE %d page(s), SITEMAP +%d url(s)" % (sum(1 for *_x, c in out if c), added))
    return 0


if __name__ == "__main__":
    sys.exit(main())
