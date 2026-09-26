# -*- coding: utf-8 -*-
"""
公共工事設計労務単価の各年ファイル(observations/jp/labor_mlit_roumu_*.csv)を、国交省が同じ PDF の中で公表している
『単純平均の伸び率』と突き合わせる(取り込んだ単価の全体を、別の数え方で確かめる)。

  1. 全職種の単純平均の伸び率: 各年の全セル(単価が設定された 県 x 職種)の単純平均の、前年比。
     公表値: 令和8年 PDF の資料2『参考：近年の公共工事設計労務単価の単純平均の伸び率の推移』(H25〜R08) と、
     各年 PDF の1頁目『全国全職種単純平均で(対)前年度比 X％』。
  2. 主要12職種の単純平均の伸び率: 12職種の全セルの単純平均の前年比。公表値: 令和7年 PDF の同じ表(H25〜R07) と令和8年 PDF の資料1。
  3. 主要12職種の職種ごとの伸び率: 各年 PDF の資料1の表(『伸率は単純平均値で算出』)。
公表値は小数1桁なので、計算値を小数1桁に丸めて一致を数える。

使い方: python3 check_mlit_roumu_series.py   (結果を out/roumu_series_check.json に書き、要約を表示)
"""
import csv, json, os, re, subprocess, sys, unicodedata, collections

HERE = os.path.dirname(os.path.abspath(__file__))
OBS2 = os.path.dirname(os.path.dirname(HERE))
ORDER = ["h25", "h26", "h27", "h28", "h29", "h30", "h31", "r2", "r3", "r4", "r5", "r6", "r7", "r8"]
LABEL = {"h25": "H25", "h26": "H26", "h27": "H27", "h28": "H28", "h29": "H29", "h30": "H30", "h31": "H31",
         "r2": "R02", "r3": "R03", "r4": "R04", "r5": "R05", "r6": "R06", "r7": "R07", "r8": "R08"}
M12 = ["特殊作業員", "普通作業員", "軽作業員", "とび工", "鉄筋工", "運転手（特殊）", "運転手（一般）", "型わく工", "大工", "左官",
       "交通誘導警備員Ａ", "交通誘導警備員Ｂ"]
# 平成25年の表では『交通誘導員Ａ/Ｂ』。伸び率の計算では同じ職種として続ける。
ALIAS = {"交通誘導員Ａ": "交通誘導警備員Ａ", "交通誘導員Ｂ": "交通誘導警備員Ｂ"}


def N(s):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", s))


def load():
    D = {}
    for y in ORDER:
        fn = os.path.join(OBS2, "observations", "jp", "labor_mlit_roumu_%s.csv" % y)
        d = {}
        for r in csv.DictReader(open(fn, encoding="utf-8")):
            if r["price"]:
                d[(r["geo_code"], ALIAS.get(r["item_name"], r["item_name"]))] = int(r["price"])
        D[y] = d
    return D


def savg(d, jobs=None):
    v = [w for (c, j), w in d.items() if jobs is None or j in jobs]
    return sum(v) / len(v)


def pdf_text(y, pages=None):
    pdf = os.path.join(OBS2, "raw", "mlit-roumu-%s.pdf" % y)
    if y == "r8" and not os.path.exists(pdf):
        pdf = "/home/claude/work/src/mlit_roumu_r8_001981942.pdf"
    if y == "h29":
        import pdfplumber
        with pdfplumber.open(pdf) as d:
            ps = d.pages if pages is None else [d.pages[i - 1] for i in pages]
            return "\n".join(p.extract_text() or "" for p in ps)
    args = ["pdftotext", "-layout"]
    if pages:
        args += ["-f", str(pages[0]), "-l", str(pages[-1])]
    return subprocess.run(args + [pdf, "-"], capture_output=True).stdout.decode("utf-8", "replace")


def series(text, rowname):
    """『全 職 種 +15.1% → +7.1% → ...』の行から、見出しの年(H25..)と値を取る。"""
    t = unicodedata.normalize("NFKC", text)
    lines = t.split("\n")
    for i, l in enumerate(lines):
        if N(l).startswith(rowname) and "→" in l:
            vals = re.findall(r"([+\-−▲]?\d+\.\d)%", l)
            for k in range(i - 1, max(0, i - 6), -1):
                heads = re.findall(r"\b(H\d\d|R\d\d)\b", lines[k])
                if len(heads) >= len(vals) - 1:
                    return dict(zip(heads, [float(v.replace("−", "-").replace("▲", "-")) for v in vals]))
    return {}


def main():
    D = load()
    res = {"all": [], "m12": [], "per_job": [], "headline": []}
    calc_all, calc_12, calc_job = {}, {}, {}
    for a, b in zip(ORDER, ORDER[1:]):
        calc_all[b] = (savg(D[b]) / savg(D[a]) - 1) * 100
        calc_12[b] = (savg(D[b], M12) / savg(D[a], M12) - 1) * 100
        for j in M12:
            calc_job[(b, j)] = (savg(D[b], [j]) / savg(D[a], [j]) - 1) * 100
    # 1. 全職種の推移(令和8年 PDF の資料2)
    t8 = pdf_text("r8", [3])
    s_all = series(t8, "全職種")
    t7 = pdf_text("r7", [3])
    s_12 = series(t7, "主要12職種")
    for y in ORDER[1:]:
        p = s_all.get(LABEL[y])
        c = round(calc_all[y], 1)
        res["all"].append({"year": y, "calc": round(calc_all[y], 3), "published": p, "match": p is not None and abs(c - p) < 1e-9})
        p = s_12.get(LABEL[y])
        if y == "r8":
            m = re.search(r"主要12職種※?\([\d,]+円\)令和7年3月比;\+(\d+\.\d)%", N(pdf_text("r8", [2])))
            p = float(m.group(1)) if m else None
        c = round(calc_12[y], 1)
        res["m12"].append({"year": y, "calc": round(calc_12[y], 3), "published": p, "match": p is not None and abs(c - p) < 1e-9})
    # 2. 各年 PDF の1頁目『全国全職種単純平均で(対)前年度比 X％』と、資料1の主要12職種の職種ごとの伸率
    jobpat = {"特殊作業員": "特殊作業員", "普通作業員": "普通作業員", "軽作業員": "軽作業員", "とび工": "とび工", "鉄筋工": "鉄筋工",
              "運転手(特殊)": "運転手（特殊）", "運転手(一般)": "運転手（一般）", "型わく工": "型わく工", "型枠工": "型わく工",
              "大工": "大工", "左官": "左官", "交通誘導警備員A": "交通誘導警備員Ａ", "交通誘導警備員B": "交通誘導警備員Ｂ"}
    rx = re.compile(r"(%s)([\d,]+)円([+\-−▲]\d+\.\d)%%" % "|".join(re.escape(k) for k in sorted(jobpat, key=len, reverse=True)))
    for y in ORDER[1:]:
        t = N(pdf_text(y, [1, 2, 3, 4]))
        m = re.search(r"全国全職種単純平均で(?:対)?前年度比([\d.]+)%", t)
        if m:
            p = float(m.group(1))
            res["headline"].append({"year": y, "calc": round(calc_all[y], 3), "published": p, "match": abs(round(calc_all[y], 1) - p) < 1e-9})
        for jm in rx.finditer(t):
            j = jobpat[jm.group(1)]
            p = float(jm.group(3).replace("−", "-").replace("▲", "-"))
            c = calc_job[(y, j)]
            res["per_job"].append({"year": y, "job": j, "calc": round(c, 3), "published": p, "match": abs(round(c, 1) - p) < 1e-9})
    summ = {k: {"checked": len(v), "match": sum(1 for x in v if x["match"])} for k, v in res.items()}
    res["summary"] = summ
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    json.dump(res, open(os.path.join(HERE, "out", "roumu_series_check.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps(summ, ensure_ascii=False))
    for k in ("all", "m12", "headline", "per_job"):
        for x in res[k]:
            if not x["match"]:
                print("NOT MATCH", k, x)


if __name__ == "__main__":
    main()
