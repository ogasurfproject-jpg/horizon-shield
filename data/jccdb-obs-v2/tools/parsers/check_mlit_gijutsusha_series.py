# -*- coding: utf-8 -*-
"""
設計業務委託等技術者単価の各年ファイル(observations/jp/labor_mlit_gijutsusha_*.csv)を、国交省が PDF の中で公表している
平均値・伸び率と突き合わせる。
  1. 令和8年度 PDF 資料2 の折れ線グラフ『全職種単純平均値の推移』の数字: 数の語の x 中心を、いちばん近い年の目盛り(Ｈ9〜R8)に対応させる。
  2. 令和8年度 PDF 資料1『直近１０か年の伸び率(全職種(職階)平均)』(H28〜R7) と、各年度 PDF 1頁目の『単純平均で対前年度比 X％』。
  3. 各年度 PDF 資料1 の群ごとの平均値(設計業務(７職階) 平均 62,157円 など、令和3年度以降)。
使い方: python3 check_mlit_gijutsusha_series.py   結果: out/gijutsusha_series_check.json
"""
import csv, json, os, re, subprocess, sys, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
OBS2 = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from parse_mlit_roumu_hist import words_poppler, xc  # noqa: E402

ORDER = ["h21", "h22", "h23", "h24", "h25", "h26", "h27", "h28", "h29", "h30", "h31", "r2", "r3", "r4", "r5", "r6", "r7", "r8"]
AXIS = {"h21": "H21", "h22": "H22", "h23": "H23", "h24": "H24", "h25": "H25", "h26": "H26", "h27": "H27", "h28": "H28",
        "h29": "H29", "h30": "H30", "h31": "H31", "r2": "R2", "r3": "R3", "r4": "R4", "r5": "R5", "r6": "R6", "r7": "R7", "r8": "R8"}
GROUP_KEY = {"設計業務": "①", "測量業務": "②", "航空・船舶関係業務": "③", "地質調査業務": "④"}


def N(s):
    return unicodedata.normalize("NFKC", s)


def load(y):
    return list(csv.DictReader(open(os.path.join(OBS2, "observations", "jp", "labor_mlit_gijutsusha_%s.csv" % y), encoding="utf-8")))


def avg(rows, pre=None):
    v = [int(r["price"]) for r in rows if pre is None or r["category"].split(" ")[1].startswith(pre)]
    return sum(v) / len(v)


def main():
    A = {y: avg(load(y)) for y in ORDER}
    res = {"chart_r8": [], "growth": [], "headline": [], "group_avg": []}
    # 1. グラフの数字を x で年に対応させる
    ws = words_poppler(os.path.join(OBS2, "raw", "mlit-gijutsusha-r8.pdf"))[2]
    axis = [w for w in ws if re.match(r"^[HR]\d+$", N(w[4]))]
    nums = [w for w in ws if re.match(r"^\d\d,\d{3}$", w[4]) and not w[4].endswith(",000") and w[0] > 60]
    chart = {}
    for w in nums:
        a = min(axis, key=lambda t: abs(xc(t) - xc(w)))
        chart.setdefault(N(a[4]), []).append((abs(xc(a) - xc(w)), int(w[4].replace(",", ""))))
    for y in ORDER:
        c = chart.get(AXIS[y])
        p = min(c)[1] if c else None
        res["chart_r8"].append({"year": y, "calc": round(A[y], 3), "published": p, "match": p is not None and round(A[y]) == p})
    # 2. 伸び率
    t8 = N(subprocess.run(["pdftotext", "-layout", os.path.join(OBS2, "raw", "mlit-gijutsusha-r8.pdf"), "-"], capture_output=True).stdout.decode())
    lines = t8.split("\n")
    for i, l in enumerate(lines):
        if l.strip().startswith("全職種:") and "%" in l:
            heads = re.findall(r"\b(H\d\d|R\d)\b", lines[i - 1])
            vals = [float(v) for v in re.findall(r"\+(\d+\.\d)%", l)]
            for h, v in zip(heads, vals):
                y = [k for k, a in AXIS.items() if a == h][0]
                prev = ORDER[ORDER.index(y) - 1]
                c = (A[y] / A[prev] - 1) * 100
                res["growth"].append({"year": y, "calc": round(c, 3), "published": v, "match": round(c, 1) == v})
    for y in ORDER:
        t = re.sub(r"\s+", "", N(subprocess.run(["pdftotext", "-layout", os.path.join(OBS2, "raw", "mlit-gijutsusha-%s.pdf" % y), "-"],
                                                 capture_output=True).stdout.decode()))
        m = re.search(r"単純平均で対前年度比(\d+\.\d)%", t)
        if m:
            prev = ORDER[ORDER.index(y) - 1]
            c = (A[y] / A[prev] - 1) * 100
            res["headline"].append({"year": y, "calc": round(c, 3), "published": float(m.group(1)), "match": round(c, 1) == float(m.group(1))})
        rows = load(y)
        for gm in re.finditer(r"(設計業務|測量業務|航空・船舶関係業務|地質調査業務)(?:\(\d職階\))?平均([\d,]+)円", t):
            p = int(gm.group(2).replace(",", ""))
            c = avg(rows, GROUP_KEY[gm.group(1)])
            res["group_avg"].append({"year": y, "group": gm.group(1), "calc": round(c, 3), "published": p, "match": round(c) == p})
    # 4. 別のエンジン(pdfminer)の文字列で、全行(職種・基準日額・比率)が CSV と一致するか
    import pdfplumber
    res["pdfminer_rows"] = []
    for y in ORDER:
        with pdfplumber.open(os.path.join(OBS2, "raw", "mlit-gijutsusha-%s.pdf" % y)) as d:
            txt = "\n".join((p.dedupe_chars().extract_text() or "") for p in d.pages)
        got = []
        for line in txt.split("\n"):
            m = re.match(r"^\s*(\S+)\s+[<＜]?(\d{1,3}(?:,\d{3})+)[>＞]?\s+(\d{1,3})%?\s*$", line)
            if m:
                got.append((m.group(1).replace(" ", ""), int(m.group(2).replace(",", "")), int(m.group(3))))
        want = [(r["item_name"], int(r["price"]), int(r["ref_value"])) for r in load(y)]
        res["pdfminer_rows"].append({"year": y, "rows": len(want), "pdfminer_rows": len(got), "match": got[:len(want)] == want and len(got) >= len(want)})
    res["summary"] = {k: {"checked": len(v), "match": sum(1 for x in v if x["match"])} for k, v in res.items()}
    json.dump(res, open(os.path.join(HERE, "out", "gijutsusha_series_check.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps(res["summary"], ensure_ascii=False))
    for k in ("chart_r8", "growth", "headline", "group_avg", "pdfminer_rows"):
        for x in res[k]:
            if not x["match"]:
                print("NOT MATCH", k, x)


if __name__ == "__main__":
    main()
