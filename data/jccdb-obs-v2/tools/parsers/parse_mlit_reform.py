# -*- coding: utf-8 -*-
"""
国土交通省「建築物リフォーム・リニューアル調査 令和７年度計」(令和7年度受注分_調査報告データ、002005997.xlsx)を
openpyxl でセルから直接読み、観測層 v2 の spending 層の行にする。

入力: OBS2/raw/mlit-reform-fy2025.xlsx
出力: OBS2/observations/jp/spending_mlit_reform_fy2025.csv, OBS2/reports/W2-reform-checks.json
取る表:
  年表1-2   工事種類別 受注件数・受注高(計/住宅/非住宅建築物 x 計/増築/一部改築/改装・改修/維持・修理)
  年表2-2   発注者、工事種類別 受注高
  年表2-4-1 工事部位、主たる工事部位別 受注件数(住宅・非住宅建築物。部位: 基礎躯体、屋根、外壁、内装、建具、設備 等)
値の扱い:
  セルの値は推計値で小数を持つ。price はセルの表示書式(#,##0 / #,##0.0)の桁に四捨五入した値(表に見えている値)。
  丸める前のセルの値は note に書く。前年度比(%)が表にある行は ref_value に前年度比を入れる。
  0 は not_set(note に「原本の値は 0」)、空欄・「-」も not_set。
照合(reports/W2-reform-checks.json):
  R1 表1-2: 計 = 住宅 + 非住宅建築物(件数・受注高、工事種類ごと)
  R2 表1-2: 計 = 増築 + 一部改築 + 改装・改修(+維持・修理)。原本注のとおり独立推定なので差を数える
  R3 表2-2: 計 = 住宅 + 非住宅、住宅/非住宅 = 発注者の和、個人 = 居住者 + 非居住オーナー、計 = 工事種類の和
  R4 表2-2 と 表1-2 の同じ量(住宅・非住宅の 計、改装・改修、維持・修理)
  R5 表2-4-1: 総数行の値 = 行列の対角(主たる工事部位 = 工事部位)、総数行の 計 = 主たる工事部位の和、総数行の計 = 表1-2 の受注件数
"""
import os, re, sys, json, hashlib, collections
from decimal import Decimal, ROUND_HALF_UP
import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
OBS2 = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(OBS2, "tools"))
from obs_common import make_id, write_obs  # noqa: E402

SID = "mlit-reform-fy2025"
URL = "https://www.mlit.go.jp/report/press/content/002005997.xlsx"
PER = "FY2025"
WS = re.compile(r"[\s　]+")
CAT = "建築物リフォーム・リニューアル調査（令和７年度計） "


def nz(s):
    return WS.sub("", str(s or ""))


def decimals(fmt):
    m = re.match(r"^[#,0]*0(\.(0+))?", fmt or "")
    if fmt == "General" or not m:
        return None
    return len(m.group(2) or "")


def disp(cell):
    """(kind, 表示値Decimal, 生の値str)"""
    v = cell.value
    if isinstance(v, (int, float)):
        raw = Decimal(repr(v)) if isinstance(v, float) else Decimal(v)
        d = decimals(cell.number_format)
        if d is None:
            d = 1 if isinstance(v, float) and v != int(v) else 0
        q = Decimal(1).scaleb(-d)
        shown = raw.quantize(q, rounding=ROUND_HALF_UP)
        return ("num", shown, raw)
    t = str(v).strip() if v is not None else ""
    if t in ("", "-", "－"):
        return ("blank", t, None)
    raise ValueError("想定外のセル %s: %r" % (cell.coordinate, v))


def fmt(d):
    s = format(d, "f")
    return s


def base_row(item, spec, unit, basis, cur, cell, sheet, note_extra=""):
    return dict(obs_id=make_id(SID, sheet, spec, unit), country="JP", layer="spending", item_name=item, spec=spec,
                unit=unit, geo_level="national", geo_code="JP", geo_name="日本", currency=cur, price_basis=basis,
                period=PER, effective_from="", source_id=SID, source_page="%s!%s" % (sheet, cell.coordinate),
                evidence_url=URL, license="PDL1.0")


def fill(row, kind, shown, raw, yoy=None, extra_notes=()):
    notes = ["令和７年度計(令和7年4月〜令和8年3月に元請として受注した工事)"] + list(extra_notes)
    if kind == "num" and shown > 0:
        row.update(price=fmt(shown), price_status="published_pdl")
        if raw != shown:
            notes.append("原本セルの丸める前の値(推計値): %s" % format(raw.normalize(), "f"))
    elif kind == "num":
        row.update(price="", price_status="not_set")
        notes.append("原本の値は 0")
    else:
        row.update(price="", price_status="not_set")
        notes.append("原本は空欄" if not shown else "原本は「%s」" % shown)
    if yoy is not None and yoy[0] == "num" and row["price_status"] == "published_pdl":
        row.update(ref_value=fmt(yoy[1]), ref_note="前年度比(%)。原本の表示は小数第1位、▲は負")
    elif yoy is not None and yoy[0] != "num":
        notes.append("前年度比は原本で「%s」" % (yoy[1] or "空欄"))
    row["note"] = "。".join(notes)
    return row


def main():
    wb = openpyxl.load_workbook(os.path.join(OBS2, "raw", SID + ".xlsx"))  # 書式を読むため data_only にしない
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for c in row:
                assert not (isinstance(c.value, str) and c.value.startswith("=")), ("数式セル", ws.title, c.coordinate)
    rows = []
    chk = collections.OrderedDict()
    # ---------- 年表1-2 ----------
    ws = wb["年表1-2"]
    assert nz(ws["B1"].value) == nz("表1-2　工事種類別　受注件数・受注高")
    assert "件，億円" in str(ws["N2"].value)
    groups = [(3, nz(ws["C4"].value)), (7, nz(ws["G4"].value)), (11, nz(ws["K4"].value))]
    assert [g for _, g in groups] == ["計", "住宅", "非住宅建築物"]
    t12 = {}
    for r in range(7, 12):
        kind_label = nz(ws.cell(r, 2).value)
        for c0, g in groups:
            assert nz(ws.cell(5, c0).value) == "受注件数" and nz(ws.cell(5, c0 + 2).value) == "受注高"
            assert nz(ws.cell(6, c0 + 1).value) == "前年度比" and nz(ws.cell(6, c0 + 3).value) == "前年度比"
            for off, meas, unit, basis, cur in ((0, "受注件数", "件", "count", ""), (2, "受注高", "億円", "orders_received_total", "JPY")):
                cell = ws.cell(r, c0 + off)
                k, shown, raw = disp(cell)
                yk, ys, _ = disp(ws.cell(r, c0 + off + 1))
                t12[(kind_label, g, meas)] = raw if k == "num" else None
                spec = "表側「%s」/ 表頭「%s」「%s」" % (kind_label, g, meas)
                row = base_row("%s %s %s" % (g, kind_label, meas), spec, unit, basis, cur, cell, ws.title)
                row["category"] = CAT + "表1-2 工事種類別 受注件数・受注高"
                ex = []
                if g in ("計", "非住宅建築物") and kind_label == "改装・改修":
                    ex.append("この表の計と非住宅建築物の「改装・改修」は維持・修理を含む(同じ行の維持・修理が空欄。表2-2 で改装・改修と維持・修理に分かれる)")
                rows.append(fill(row, k, shown, raw, (yk, ys), ex))
    # R1, R2
    r1 = collections.Counter(); r1max = Decimal(0)
    for kind_label in ("計", "増築", "一部改築", "改装・改修"):
        for meas in ("受注件数", "受注高"):
            a, b, c = t12[(kind_label, "計", meas)], t12[(kind_label, "住宅", meas)], t12[(kind_label, "非住宅建築物", meas)]
            if None in (a, b, c):
                continue
            if kind_label == "改装・改修":
                b = b + t12[("維持・修理", "住宅", meas)]  # 計の「改装・改修」は住宅の維持・修理も含む(非住宅と同じ扱い)
            d = abs(a - b - c)
            r1["ok_rel1e-6" if d <= abs(a) * Decimal("1e-6") else "ng"] += 1
            r1max = max(r1max, d)
    chk["R1_total_eq_house_plus_nonhouse"] = {"counts": dict(r1), "absdiff_max_raw": format(r1max.normalize(), "f")}
    r2 = {}
    for g in ("計", "住宅", "非住宅建築物"):
        for meas in ("受注件数", "受注高"):
            parts = [t12[(k, g, meas)] for k in ("増築", "一部改築", "改装・改修", "維持・修理") if t12[(k, g, meas)] is not None]
            tot = t12[("計", g, meas)]
            r2["%s/%s" % (g, meas)] = {"計": format(tot.quantize(Decimal("0.1")), "f"), "内訳の和": format(sum(parts).quantize(Decimal("0.1")), "f"),
                                       "差": format((tot - sum(parts)).quantize(Decimal("0.1")) + 0, "f")}
    chk["R2_total_vs_sum_of_work_types"] = r2
    # ---------- 年表2-2 ----------
    ws = wb["年表2-2"]
    assert nz(ws["B1"].value) == nz("表2-2　発注者、工事種類別　受注高")
    cols = []
    for c in range(5, 17, 2):
        h = nz(ws.cell(5, c).value) + nz(ws.cell(6, c).value)
        assert nz(ws.cell(7, c + 1).value) == "前年度比", c
        cols.append((c, h))
    assert [h for _, h in cols] == ["計", "増築，一部改築（建築工事届あり）", "増築，一部改築（建築工事届なし）", "増築，一部改築（建築工事届不明）", "改装・改修", "維持・修理"], cols
    t22 = {}
    lb, lc = "", ""
    for r in range(8, 23):
        b, c_, d = nz(ws.cell(r, 2).value), nz(ws.cell(r, 3).value), nz(ws.cell(r, 4).value)
        if b:
            lb, lc = b, ""
            path = [b]
        elif c_:
            lc = c_
            path = [lb, c_]
        else:
            assert d, r
            path = [lb, lc, d]
        pth = " > ".join(path)
        for c, h in cols:
            cell = ws.cell(r, c)
            k, shown, raw = disp(cell)
            yk, ys, _ = disp(ws.cell(r, c + 1))
            t22[(pth, h)] = raw if k == "num" else None
            spec = "表側「%s」/ 表頭「%s」" % (pth, h)
            row = base_row("%s %s 受注高" % (pth.replace(" > ", " "), h), spec, "億円", "orders_received_total", "JPY", cell, ws.title)
            row["category"] = CAT + "表2-2 発注者、工事種類別 受注高"
            rows.append(fill(row, k, shown, raw, (yk, ys)))
    r3 = collections.Counter(); r3max = Decimal(0)

    def eq(a, parts, tag):
        nonlocal r3max
        if a is None or any(p is None for p in parts):
            r3["skip"] += 1
            return
        dd = abs(a - sum(parts))
        r3[tag + (":ok" if dd <= Decimal("0.05") else ":ng")] += 1
        r3max = max(r3max, dd)
    hs = [h for _, h in cols]
    for h in hs:
        eq(t22[("計", h)], [t22[("住宅", h)], t22[("非住宅建築物", h)]], "計=住宅+非住宅")
        for top in ("住宅", "非住宅建築物"):
            subs = [p for p in t22 if p[1] == h and p[0].startswith(top + " > ") and p[0].count(">") == 1]
            eq(t22[(top, h)], [t22[p] for p in subs], "区分=発注者の和")
        eq(t22[("住宅 > 個人", h)], [t22[("住宅 > 個人 > 居住者", h)], t22[("住宅 > 個人 > 非居住オーナー", h)]], "個人=居住者+非居住オーナー")
    for p in {k[0] for k in t22}:
        eq(t22[(p, "計")], [t22[(p, h)] for h in hs[1:]], "計=工事種類の和")
    chk["R3_table2_2_sums"] = {"counts": dict(r3), "absdiff_max_raw": format(r3max.normalize(), "f")}
    r4 = {}
    for g, g22 in (("住宅", "住宅"), ("非住宅建築物", "非住宅建築物"), ("計", "計")):
        r4["%s 計" % g] = [format(t12[("計", g, "受注高")].quantize(Decimal("0.1")), "f"), format(t22[(g22, "計")].quantize(Decimal("0.1")), "f")]
        r4["%s 改装・改修" % g + ("(表2-2 の改装・改修)" if g == "住宅" else "(表2-2 の改装・改修+維持・修理)")] = [
            format(t12[("改装・改修", g, "受注高")].quantize(Decimal("0.1")), "f"),
            format((t22[(g22, "改装・改修")] + (t22[(g22, "維持・修理")] if g != "住宅" else 0)).quantize(Decimal("0.1")), "f")]
    r4["住宅 維持・修理"] = [format(t12[("維持・修理", "住宅", "受注高")].quantize(Decimal("0.1")), "f"), format(t22[("住宅", "維持・修理")].quantize(Decimal("0.1")), "f")]
    chk["R4_table2_2_vs_1_2_[表1-2,表2-2]"] = r4
    # ---------- 年表2-4-1 ----------
    ws = wb["年表2-4-1"]
    assert nz(ws["B1"].value) == nz("表2-4-1　工事部位、主たる工事部位別　受注件数")
    assert "件" in str(ws["W2"].value)
    heads = []
    grp = ""
    for c in range(5, 24):
        top = nz(ws.cell(4, c).value)
        sub = nz(ws.cell(5, c).value)
        if top and not sub:
            heads.append((c, top, top))
            grp = ""
            continue
        if top:
            grp = top
        heads.append((c, grp, sub))
    names = [h[2] for h in heads]
    assert names[0] == "計" and names[1:7] == ["基礎躯体", "屋根", "外壁", "内装", "建具", "その他建築"], names
    assert names[-3:] == ["外構", "その他", "不明"], names
    t241 = {}
    for blk_start, blk in ((6, "住宅"), (24, "非住宅建築物")):
        assert nz(ws.cell(blk_start, 2).value) == blk + "総数", ws.cell(blk_start, 2).value
        cat_l = ""
        for r in range(blk_start, blk_start + 18):
            if r == blk_start:
                rlab, rgrp = "総数", ""
            else:
                cc, dd = nz(ws.cell(r, 3).value), nz(ws.cell(r, 4).value)
                if cc and dd:
                    cat_l = cc
                    rlab, rgrp = dd, cc
                elif cc:
                    rlab, rgrp = cc, cc
                    cat_l = ""
                else:
                    rlab, rgrp = dd, cat_l
            for c, hg, hn in heads:
                cell = ws.cell(r, c)
                k, shown, raw = disp(cell)
                t241[(blk, rlab, hn)] = raw if k == "num" else None
                rtxt = "総数" if rlab == "総数" else ("%s %s" % (rgrp, rlab) if rgrp and rgrp != rlab else rlab)
                htxt = hn if hg in ("", hn) else "%s %s" % (hg, hn)
                if rlab == "総数":
                    item = "%s 主たる工事部位「%s」の受注件数(総数)" % (blk, htxt)
                elif hn == "計":
                    item = "%s 工事部位「%s」を含む受注件数(計、複数回答)" % (blk, rtxt)
                else:
                    item = "%s 工事部位「%s」を含み主たる工事部位が「%s」の受注件数" % (blk, rtxt, htxt)
                spec = "%s / 表側(工事部位、複数回答)「%s」/ 表頭(主たる工事部位)「%s」" % (blk, rtxt, htxt)
                row = base_row(item, spec, "件", "count", "", cell, ws.title)
                row["category"] = CAT + "表2-4-1 工事部位、主たる工事部位別 受注件数"
                ex = ["表側の工事部位は複数回答。総数行は主たる工事部位の件数で、表側の各行の計とは一致しない(原本注)"]
                rows.append(fill(row, k, shown, raw, None, ex))
    r5 = collections.Counter(); r5max = Decimal(0); r5sum = {}
    for blk in ("住宅", "非住宅建築物"):
        for hn in names[1:]:
            if hn in ("不明",):
                continue
            rl = {"その他設備": "その他の設備", "外構": "外構（門、塀等）"}.get(hn, hn)
            a, b = t241.get((blk, "総数", hn)), t241.get((blk, rl, hn))
            if a is None or b is None:
                r5["diag_skip"] += 1
                continue
            r5["diag_eq" if a == b else "diag_ne"] += 1
        tot = t241[(blk, "総数", "計")]
        s = sum(t241[(blk, "総数", hn)] or 0 for hn in names[1:])
        r5sum[blk] = {"総数行の計": format(tot.quantize(Decimal("0.001")), "f"), "主たる工事部位の和": format(s.quantize(Decimal("0.001")), "f"),
                      "表1-2の受注件数": format(t12[("計", blk, "受注件数")].quantize(Decimal("0.001")), "f")}
    chk["R5_table2_4_1"] = {"counts": dict(r5), "sums": r5sum}
    fn = os.path.join(OBS2, "observations", "jp", "spending_mlit_reform_fy2025.csv")
    n = write_obs(fn, rows)
    rep = {"file": {"path": "observations/jp/spending_mlit_reform_fy2025.csv", "rows": n,
                    "by_status": dict(collections.Counter(r["price_status"] for r in rows)),
                    "by_table": dict(collections.Counter(r["category"].split(" ")[1] for r in rows)),
                    "sha256": hashlib.sha256(open(fn, "rb").read()).hexdigest()},
           "checks": chk}
    json.dump(rep, open(os.path.join(OBS2, "reports", "W2-reform-checks.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps(rep, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
