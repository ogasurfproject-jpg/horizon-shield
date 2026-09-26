# -*- coding: utf-8 -*-
"""
別のエンジンで同じ PDF を読み直し、横長の表(A)の全セル(単価と下段の参考値)が一致するかを数える。
正のエンジンは parse_mlit_roumu_hist.py と同じ(poppler、h29 だけ pdfminer)。照合は他方(pdfminer、h29 は pypdf の文字列)。
使い方: python3 check_mlit_roumu_engines.py r7 r6 ...   結果: out/roumu_engine_<year>.json
"""
import sys, os, json, re, unicodedata
import parse_mlit_roumu_hist as P

HERE = os.path.dirname(os.path.abspath(__file__))


def N(s):
    return unicodedata.normalize("NFKC", s)


def pypdf_rows(pdf, pages):
    """pypdf の抽出文字列で、県名の行ごとに数と『-』の並びを取る(座標を使わない、まったく別の読み方)。"""
    import pypdf
    r = pypdf.PdfReader(pdf)
    seqs = {}
    for pg in pages:
        t = r.pages[pg - 1].extract_text()
        try:  # pypdf は 90msp-RKSJ-H を解けず Shift_JIS のバイトを latin-1 の文字で返すので、戻して cp932 で読む
            t = t.encode("latin-1").decode("cp932")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
        for line in t.split("\n"):
            m = re.search(r"(\d\d) ?(%s)" % "|".join(P.JP_PREF_CODE), line)
            # 数が空白なしで続く(『18,70015,400』)ので、単価の形(1〜2桁,3桁)で切る。県コードの後ろから読む
            toks = re.findall(r"\(?\d{1,2},\d{3}\)?", line[m.end():]) if m else []
            if m and toks:
                seqs.setdefault(m.group(1), []).append(toks)
    return seqs


for y in sys.argv[1:]:
    pdf = os.path.join(P.OBS2, "raw", "mlit-roumu-%s.pdf" % y)
    main_engine = "pdfminer" if y == "h29" else "poppler"
    a = P.build(P.words_pdfminer(pdf) if main_engine == "pdfminer" else P.words_poppler(pdf))
    res = {"year": y, "main": main_engine}
    if y != "h29":
        b = P.build(P.words_pdfminer(pdf))
        ka = {(c, N(j)): v for (c, j), v in a["A"].items()}
        kb = {(c, N(j)): v for (c, j), v in b["A"].items()}
        same = sum(1 for k in ka if k in kb and ka[k]["wage"] == kb[k]["wage"] and ka[k].get("ref") == kb[k].get("ref"))
        res.update({"other": "pdfminer", "cells_main": len(ka), "cells_other": len(kb), "same_wage_and_ref": same})
    else:
        # h29: poppler はフォントを解けないので、pypdf の文字列で縦長の表(B)の値の並びを取り、座標で読んだ B の並びと比べる
        seqs = pypdf_rows(pdf, a["pages"]["B"])
        order = {}
        for pg in a["pages"]["B"]:
            pass
        jobsB = a["jobs"]["B"]
        same = total = 0
        bad = []
        for code in sorted({c for c, _ in a["B"]}):
            got = [int(t.strip("()").replace(",", "")) for s in seqs.get(code, []) for t in s if t != "-"]
            want = [a["B"][(code, j)]["wage"] for j in jobsB if a["B"][(code, j)]["wage"] is not None]
            total += 1
            if got == want:
                same += 1
            else:
                bad.append((code, len(got), len(want)))
        res.update({"other": "pypdf text (B table, value sequence per prefecture)", "prefs": total, "prefs_same_sequence": same, "diff": bad[:10]})
    json.dump(res, open(os.path.join(HERE, "out", "roumu_engine_%s.json" % y), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps(res, ensure_ascii=False), flush=True)
