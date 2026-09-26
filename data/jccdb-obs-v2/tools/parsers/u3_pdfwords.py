# -*- coding: utf-8 -*-
"""U3-us-state-dot の parser が共有する部品(pdftotext -bbox-layout の語の座標で表を読む)。
値は要約を通さず、語の座標で列に割り当てる。列の割り当ては「その行の数値語の並び順」で仮に決め、
次に「見出し語の右端 + 列ごとの中央値のずれ」からの距離で最近傍の列が同じであることを全セルで確かめる。
"""
import re, subprocess, html, statistics, hashlib, json, os, sys

WORD_RE = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>')


def words_of(pdf, first=None, last=None):
    """頁ごとの語のリスト [(x0, y0, x1, y1, text), ...] を返す(頁番号は 1 始まりの first から)。"""
    cmd = ["pdftotext", "-bbox-layout"]
    if first:
        cmd += ["-f", str(first)]
    if last:
        cmd += ["-l", str(last)]
    out = subprocess.run(cmd + [pdf, "-"], capture_output=True, text=True, check=True).stdout
    pages = out.split("<page ")[1:]
    res = []
    for pg in pages:
        ws = WORD_RE.findall(pg)
        res.append([(float(a), float(b), float(c), float(d), html.unescape(w)) for a, b, c, d, w in ws])
    return res


def lines_of(ws, tol=2.0):
    """語を y(上端)で行に束ねる。各行は x の順に並べる。"""
    ws = sorted(ws, key=lambda w: (w[1], w[0]))
    lines = []
    for w in ws:
        if lines and abs(w[1] - lines[-1][0]) <= tol:
            lines[-1][1].append(w)
        else:
            lines.append([w[1], [w]])
    return [(y, sorted(l, key=lambda w: w[0])) for y, l in lines]


def sha256_file(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


class ColumnCheck:
    """列の割り当ての検算。add(page, col, value_xmax, anchor_xmax, value_xc, anchor_xc) を全セルで呼び、
    finish() で 列ごと・頁ごとの中央値のずれを引いた後の距離の最大値と、最近傍の列が割り当てと違うセルの数を返す。"""

    def __init__(self):
        self.cells = []

    def add(self, page, col, vx1, ax1, vxc, axc, anchors):
        self.cells.append((page, col, vx1, ax1, vxc, axc, anchors))

    def finish(self):
        off = {}
        by = {}
        for page, col, vx1, ax1, vxc, axc, anchors in self.cells:
            by.setdefault((page, col), []).append(vx1 - ax1)
        for k, v in by.items():
            off[k] = statistics.median(v)
        maxd, maxc, wrong = 0.0, 0.0, 0
        for page, col, vx1, ax1, vxc, axc, anchors in self.cells:
            d = abs(vx1 - ax1 - off[(page, col)])
            maxd = max(maxd, d)
            maxc = max(maxc, abs(vxc - axc))
            # 最近傍の列(右端 + その列のずれ)が割り当てた列と同じか
            best = min(anchors, key=lambda c: abs(vx1 - (anchors[c] + off.get((page, c), off[(page, col)]))))
            if best != col:
                wrong += 1
        return {"cells": len(self.cells), "max_right_edge_dist_pt_after_offset": round(maxd, 2),
                "max_center_dist_pt_raw": round(maxc, 2), "nearest_column_mismatch": wrong}
