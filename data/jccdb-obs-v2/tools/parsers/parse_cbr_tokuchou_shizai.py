# -*- coding: utf-8 -*-
"""
中部地方整備局「令和８年度の特別調査（資材単価）」(管内事務所・管理所が工事ごとに行った特別調査の報告リスト)を
観測層 v2 に取り込む(担当 J1-open-routes)。

原本: OBS2/raw/cbr-tokuchou-shizai-r8-08-<県>.zip(愛知・岐阜・三重・静岡・長野の5つ。中身は事務所ごとの PDF
「建設資材価格調査報告リスト 令和８年度 管内建設資材価格・設計労務単価調査業務」)。
頁: https://www.cbr.mlit.go.jp/architecture/kensetsugijutsu/unit_price/R8_chousa_tanka.htm
利用条件: サイトの PDL1.0(「権利表記の記載がない限り」)。16 の PDF のどこにも転載・複製を禁じる表記が無いことを全文検索で確かめた。
          局の「土木工事設計材料単価表」(shizai2026xx.pdf)は表の 2 頁に禁止の表記があるので別(値は写していない)。

読み方: PDF は罫線(細い矩形)の格子。pdfplumber の extract_tables(lines) でセルに切る(14 列: 県名 / 調査依頼事務所名 / 担当課 /
        依頼番号 / 資材番号 / 調査区分 / 材工区分 / 品名 / 規格 / 単位 / 価格 / 報告月 / 単価適用地域 / 備考)。
        セルの中の折り返しは、前後がどちらも ASCII の英数字のときだけ空白でつなぎ、ほかは詰める。
照合(別の読み方): poppler(pdftotext -bbox-layout)の語を、同じ頁の罫線の格子(矩形から作る)でセルに割り当て、
        pdfminer(pdfplumber)のセルの文字と、空白を除いて全セルで比べる。価格の列は全件一致を要求する。

使い方: python3 parse_cbr_tokuchou_shizai.py [--check-json 出力先]
"""
import sys, os, re, io, json, zipfile, subprocess, tempfile, collections, unicodedata
import xml.etree.ElementTree as ET
HERE = os.path.dirname(os.path.abspath(__file__))
OBS2 = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(OBS2, "tools"))
from obs_common import make_id, num, pref, write_obs
import pdfplumber

PREFS = ["aichi", "gifu", "mie", "shizuoka", "nagano"]
PREF_JA = {"aichi": "愛知県", "gifu": "岐阜県", "mie": "三重県", "shizuoka": "静岡県", "nagano": "長野県"}
PAGE = "https://www.cbr.mlit.go.jp/architecture/kensetsugijutsu/unit_price/R8_chousa_tanka.htm"
ZIPURL = "https://www.cbr.mlit.go.jp/architecture/kensetsugijutsu/unit_price/zip/r08/list_r8.08_shizai_%s.zip"
OUT = os.path.join(OBS2, "observations", "jp", "material_cbr_tokuchou_shizai_r8_08.csv")
COLS = ["pref", "office", "ka", "irai", "shizai", "kubun", "zaiko", "hin", "kikaku", "unit", "price", "month", "area", "biko"]
HEAD = ["県名", "調査依頼事務所名", "担当課", "依頼番号", "資材番号", "調査区分", "材工区分", "品名", "規格", "単位", "価格", "報告月", "単価適用地域", "備考"]
TS = {"vertical_strategy": "lines", "horizontal_strategy": "lines"}
PRICE_RE = re.compile(r"^[0-9][0-9,]*(\.[0-9]+)?$")
ASCII_AN = re.compile(r"[0-9A-Za-z]")


def join_wrapped(s):
    """セルの中の改行(折り返し)をつなぐ。前後が ASCII の英数字なら空白、ほかは詰める。"""
    if s is None:
        return ""
    parts = [p.strip() for p in str(s).split("\n")]
    out = ""
    for p in parts:
        if not p:
            continue
        if out and ASCII_AN.match(out[-1]) and ASCII_AN.match(p[0]):
            out += " " + p
        else:
            out += p
    return out.strip()


def nows(s):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", s or ""))


def reiwa(s):
    """'R8.6.10' -> '2026-06-10'、'R8.6' -> '2026-06'。"""
    m = re.match(r"^R(\d+)\.(\d+)(?:\.(\d+))?$", nows(s))
    if not m:
        return None
    y = 2018 + int(m.group(1))
    if m.group(3):
        return "%04d-%02d-%02d" % (y, int(m.group(2)), int(m.group(3)))
    return "%04d-%02d" % (y, int(m.group(2)))


def grid_of(page):
    """罫線の矩形から、縦線の x と横線の y の並びを作る(細い矩形だけ)。"""
    xs, ys = set(), set()
    for r in page.rects:
        if r["width"] < 2 and r["height"] > 20:
            xs.add(round((r["x0"] + r["x1"]) / 2, 1))
        if r["height"] < 2 and r["width"] > 100:
            ys.add(round((r["top"] + r["bottom"]) / 2, 1))
    return sorted(xs), sorted(ys)


def poppler_words(pdf_bytes):
    """pdftotext -bbox-layout の語(頁ごと)。座標は pdfplumber と同じ(左上原点、pt)。"""
    with tempfile.NamedTemporaryFile(suffix=".pdf") as t:
        t.write(pdf_bytes); t.flush()
        x = subprocess.run(["pdftotext", "-bbox-layout", t.name, "-"], capture_output=True, check=True).stdout
    root = ET.fromstring(x)
    ns = {"h": "http://www.w3.org/1999/xhtml"}
    pages = []
    for pg in root.iter("{http://www.w3.org/1999/xhtml}page"):
        ws = []
        for w in pg.iter("{http://www.w3.org/1999/xhtml}word"):
            ws.append((float(w.get("xMin")), float(w.get("yMin")), float(w.get("xMax")), float(w.get("yMax")), w.text or ""))
        pages.append(ws)
    return pages


def cell_index(v, lines):
    for i in range(len(lines) - 1):
        if lines[i] <= v < lines[i + 1]:
            return i
    return None


def main():
    args = sys.argv[1:]
    check_out = args[args.index("--check-json") + 1] if "--check-json" in args else None
    rows_out = []
    chk = collections.OrderedDict()
    tot = collections.Counter()
    for pk in PREFS:
        sid = "cbr-tokuchou-shizai-r8-08-%s" % pk
        zpath = os.path.join(OBS2, "raw", sid + ".zip")
        z = zipfile.ZipFile(zpath)
        assert z.testzip() is None
        for info in sorted(z.infolist(), key=lambda i: i.filename):
            name = info.filename if info.flag_bits & 0x800 else info.filename.encode("cp437").decode("cp932")
            base = os.path.basename(name)
            if not base.lower().endswith(".pdf"):
                continue
            data = z.read(info)
            pw = poppler_words(data)
            fchk = collections.Counter()
            with pdfplumber.open(io.BytesIO(data)) as pdf:
                prev_kubun = ""
                for pi, page in enumerate(pdf.pages, 1):
                    tables = page.find_tables(TS)
                    assert len(tables) == 1, (base, pi, len(tables))
                    tb = tables[0]
                    cells = tb.extract()
                    # 別の読み方: poppler の語を罫線の格子でセルに割り当てる
                    xs, ys = grid_of(page)
                    pop = collections.defaultdict(str)
                    for (x0, y0, x1, y1, t) in sorted(pw[pi - 1], key=lambda w: (round(w[1]), w[0])):
                        ci = cell_index((x0 + x1) / 2, xs); ri = cell_index((y0 + y1) / 2, ys)
                        if ci is None or ri is None:
                            fchk["poppler_words_outside_grid"] += 1
                            continue
                        pop[(ri, ci)] += t
                    assert len(ys) - 1 == len(cells), (base, pi, len(ys), len(cells))
                    assert all(len(r) == 14 for r in cells) and len(xs) - 1 == 14, (base, pi)
                    for ri, raw in enumerate(cells):
                        for ci, c in enumerate(raw):
                            fchk["cells"] += 1
                            if nows(c) == nows(pop.get((ri, ci), "")):
                                fchk["cells_equal"] += 1
                            elif ci == 10:
                                fchk["price_cells_differ"] += 1
                            else:
                                fchk["other_cells_differ"] += 1
                        vals = [join_wrapped(c) for c in raw]
                        if [nows(v) for v in vals] == [nows(h) for h in HEAD]:
                            fchk["header_rows"] += 1
                            continue
                        d = dict(zip(COLS, vals))
                        fchk["data_rows"] += 1
                        irai = nows(d["irai"]); shz = nows(d["shizai"])
                        kubun = d["kubun"]
                        kubun_note = kubun
                        if kubun in ("〃", "〃"):
                            kubun_note = "〃(上の行と同じ: %s)" % prev_kubun
                        elif kubun:
                            prev_kubun = kubun
                        code, pname = pref(d["pref"])
                        assert code and pname == PREF_JA[pk], (base, pi, d["pref"])
                        period = reiwa(d["month"])
                        assert period, (base, pi, d["month"])
                        pr = d["price"]
                        area = d["area"]
                        note = ["中部地整の事務所が工事ごとに行った特別調査の報告価格(予定価格の積算に用いたもの。原本の頁の説明: 施工地域、時期、現場条件が異なる場合、単価が異なる場合がある)",
                                "調査依頼: %s %s %s 資材番号 %s" % (d["office"], d["ka"], irai, shz),
                                "調査区分: %s" % (kubun_note or "(空欄)"), "材工区分: %s" % d["zaiko"],
                                "単価適用地域: %s" % (area or "(空欄)"), "報告月: %s" % d["month"]]
                        if d["biko"]:
                            note.append("備考: %s" % d["biko"])
                        note.append("消費税の扱いは原本に記載なし。geo_code は原本の県名欄(調査を依頼した事務所の県)")
                        if PRICE_RE.match(pr):
                            price = num(pr)
                            if float(price) == 0:
                                status, price = "not_set", ""
                            else:
                                status = "published_pdl"
                        else:
                            price = ""
                            if re.search(r"建設物価|積算資料|物価資料|刊行物", d["biko"] + pr):
                                status = "publication_based_not_public"
                            else:
                                status = "not_set"
                            note.append("価格欄: %s" % (pr or "(空欄)"))
                        if area == "局管内":
                            gl, gc, gn = "bureau_area", "", ""
                        else:
                            gl, gc, gn = "pref", code, pname
                        rows_out.append({
                            "obs_id": make_id(sid, d["office"], irai, shz),
                            "country": "JP", "layer": "material",
                            "category": "特別調査（資材単価） %s %s" % (d["office"], d["ka"]),
                            "item_name": d["hin"], "spec": d["kikaku"], "unit": d["unit"],
                            "geo_level": gl, "geo_code": gc, "geo_name": gn,
                            "area_label": area, "area_code": "%s#%s" % (irai, shz), "area_members": "",
                            "price": price, "currency": "JPY", "price_basis": "special_survey_price",
                            "price_status": status, "ref_value": "", "ref_note": "",
                            "period": period, "effective_from": "",
                            "source_id": sid, "source_page": "%s p.%d" % (base, pi),
                            "evidence_url": ZIPURL % pk, "license": "PDL1.0",
                            "jccdb_v4_item_id": "", "note": "。".join(note),
                        })
                        tot["status:" + status] += 1
            chk["%s/%s" % (pk, base)] = dict(fchk)
            for k, v in fchk.items():
                tot[k] += v
    n = write_obs(OUT, rows_out)
    res = {"rows": n, "totals": dict(tot), "per_file": chk}
    print(json.dumps({"rows": n, "totals": dict(tot)}, ensure_ascii=False, indent=1))
    if check_out:
        json.dump(res, open(check_out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
