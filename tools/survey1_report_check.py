# -*- coding: utf-8 -*-
"""
報告書のページに書いた数字が、全部データから来ているかを確かめる。

なぜ要るか (2026-08-24):
  survey1_report.py の冒頭には「報告に載せる数字を、ひとつ残らずここで作る。
  手で書き写さない」と書いてある。だが、そう書いてあるだけで、
  誰も確かめていなかった。HTML は手で書く。手で書けば、写し間違える。

  そして間違いは静かである。1桁違っても、ページは表示される。

  この検査は、HTML に出てくる数を全部拾い、JSON の中に同じ数があるかを見る。
  無ければ落ちる。

  もうひとつ見る。道具の限界が、本当にページに載っているか。
  以前これは「載せたら true にする」という人の申告制だった。申告は嘘をつける。
  いまは JSON の中身にしてあるので、その本文がページに出ているかを機械が見る。

  python3 tools/survey1_report_check.py \
      verify-directory/survey/data/survey1_report_2026-08-23.json \
      verify-directory/survey/1/index.html
"""

import io, json, re, sys


def numbers_in_json(o, out):
    """JSON の中に現れる数を、書き方を問わず全部集める。"""
    if isinstance(o, dict):
        for v in o.values():
            numbers_in_json(v, out)
    elif isinstance(o, list):
        for v in o:
            numbers_in_json(v, out)
    elif isinstance(o, bool):
        pass
    elif isinstance(o, (int, float)):
        out.add(str(o))
        out.add(str(int(o)) if float(o).is_integer() else str(o))
        if float(o).is_integer():
            out.add("{:,}".format(int(o)))          # 1,312
        else:
            out.add("%.1f" % o)                     # 46.5
            out.add("%.2f" % o)
    elif isinstance(o, str):
        for m in re.findall(r"\d[\d,]*\.?\d*", o):  # 本文中の数字も採る
            out.add(m)


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    data = json.load(io.open(sys.argv[1], encoding="utf-8"))
    html = io.open(sys.argv[2], encoding="utf-8").read()

    known = set()
    numbers_in_json(data, known)
    # 年・日付・電話・法人番号・ORCID・ハッシュなど、報告の数字ではないもの
    # 01/02/03 は札の番号であって、報告の数字ではない。
    # 順番に意味がある(読む順)ので置いてある。
    ALLOW = {"01", "02", "03",
             "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "100",
             "2026", "2025", "0009", "9180", "903", "7021001075279",
             "08", "19", "23", "24", "06", "18", "28", "07", "2.6",
             "2026-08-19", "2026-08-23", "2026-07-28", "2025-06-18", "2026-08-24"}

    body = re.sub(r"<head>.*?</head>", "", html, flags=re.S)
    body = re.sub(r"<a [^>]*href=\"[^\"]*\"", "<a", body)      # URL の中の数字は除く
    body = re.sub(r"<span class=\"mono\">[0-9a-f]{32,}</span>", "", body)  # ハッシュ
    body = re.sub(r"data-cf-beacon='[^']*'", "", body)

    used = re.findall(r"(?<![\w/.-])(\d[\d,]*(?:\.\d+)?)(?![\w/-])", body)
    missing = []
    for n in used:
        if n in ALLOW or n in known:
            continue
        if n.replace(",", "") in known:
            continue
        missing.append(n)

    print("ページに出てくる数: %d 種" % len(set(used)))
    print("データに無い数    : %d 種" % len(set(missing)))
    for n in sorted(set(missing)):
        ctx = ""
        m = re.search(r".{60}" + re.escape(n) + r".{40}", body, re.S)
        if m:
            ctx = re.sub(r"<[^>]+>", "", m.group(0)).replace("\n", " ")
        print("  ・%-14s %s" % (n, ctx.strip()[:96]))

    # 限界が本当に載っているか
    lims = data.get("limitations") or []
    print("\n道具の限界: %d 件" % len(lims))
    lost = []
    for L in lims:
        # 影響範囲の数字が、ページのどこかに出ていること
        # 2026-08-24: ここは「1個でも出ていれば載っている」にしていた。
        #   影響範囲の数字を全部消しても、たまたま残った1個で通ってしまった。
        #   甘い検査は、検査をしたという記録だけを残す。全部出ていることを要求する。
        nums = [x for x in re.findall(r"\d[\d,]*", str(L.get("blast_radius", ""))) if len(x) > 2]
        nums = sorted(set(nums))
        shown = [x for x in nums if x in body or x.replace(",", "") in body]
        gone = [x for x in nums if x not in shown]
        ok = (not gone)
        print("  %s %s  (影響範囲の数字 %d 個中 %d 個がページに出ている)"
              % ("載っている" if ok else "★載っていない", L.get("id"), len(nums), len(shown)))
        if gone:
            print("     ページに無い数字: %s" % "、".join(gone))
            lost.append(L.get("id"))

    if missing or lost:
        print("\n落ちました。", file=sys.stderr)
        if missing:
            print("  ページの数字が、データに無い。手で書き写した箇所があります。", file=sys.stderr)
        if lost:
            print("  道具の限界がページに出ていない: %s" % ", ".join(lost), file=sys.stderr)
        sys.exit(3)
    print("\nページの数字は全部データから来ています。限界も載っています。")


if __name__ == "__main__":
    main()
