# -*- coding: utf-8 -*-
"""
国土交通省「令和８年度 施工パッケージ型積算方式 標準単価表」を観測層 v2 の work 層に入れる。

入力(OBS2/raw):
  mlit-sekou-package-r8-04.xlsx
      国総研(社会資本システム研究室)が公表する excel 版(20260319_sekoptanka0804.xlsx)。値はここからセルで読む。
  mlit-sekou-package-r8-04_pdf_text.txt
      同じ表の PDF 版(国交省 大臣官房技術調査課の通知 001989802.pdf、868 頁)を Apify web-fetch の
      PDF 文字抽出(formats=text)で起こしたもの。照合にだけ使う(値はここから取らない)。

出力(OBS2/observations/jp):
  work_mlit_sekou_package_r7_04.csv        標準単価(東京地区・基準年月 令和7年4月)と「物価資料等による」パッケージの状態
  work_mlit_sekou_package_ratio_r7_04.csv  機労材構成比(K, K1..K3, R, R1..R4, Z, Z1..Z4, S。単位 %)

読み方:
  - シート 001..411 が1パッケージ1シート。3〜5行目が見出し(条件区分 / 標準単価 / 機労材構成比 15 欄 /
    代表機労材規格 15 欄(K1〜K3 は名称と賃料の * 印の2セル) / 備考)。6行目から明細、明細の下に「注」。
  - 値は Excel の表示書式(#,###.0 など)の桁で丸めた値(PDF に印字された値と同じ)。丸めで保存値と違う
    セルの数を数えて出す。
  - 「物価資料等による」だけのシート(一覧の ※3)は値を持たない。price 空、publication_based_not_public。
  - 構成比の「-」は行にしない(その成分が無い)。K または Z の合計が 0(0.00)のセルも行にしない
    (検査器は開いた状態の 0 を許さない。成分が無いことは K1..K3 / Z1..Z4 が「-」であることで分かる)。数は報告する。

照合(止める条件):
  - 一覧シートの No・名称とシート1行目の No・名称が全件一致すること。
  - PDF 文字の各頁の「No.xxx【 名称 】」と頁番号「xxx - n」から、パッケージごとの頁数が一覧の頁欄
    (例 001-1～5)と一致すること。
  - PDF 文字の各行の末尾 16 語(標準単価 + 構成比 15 欄)の並びが、Excel の表示値の並びとパッケージごとに
    全件一致すること。一致しないパッケージが1つでもあれば止める。
"""
import csv, json, os, re, sys, hashlib, collections
from decimal import Decimal, ROUND_HALF_UP

HERE = os.path.dirname(os.path.abspath(__file__))
OBS2 = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(OBS2, "tools"))
from obs_common import make_id, write_obs, num, clean  # noqa: E402

import openpyxl  # noqa: E402

SID = "mlit-sekou-package-r8-04"
XLSX = os.path.join(OBS2, "raw", SID + ".xlsx")
PDFTXT = os.path.join(OBS2, "raw", SID + "_pdf_text.txt")
OUT_PRICE = os.path.join(OBS2, "observations", "jp", "work_mlit_sekou_package_r7_04.csv")
# 構成比は約 8 万行(約 58MB)あるので、パッケージ番号で2つに分ける(1ファイル 50MB 未満にする)
OUT_RATIO = os.path.join(OBS2, "observations", "jp", "work_mlit_sekou_package_ratio_r7_04_p%d.csv")
URL_XLSX = "https://www.nilim.go.jp/lab/pbg/theme/theme2/sekop/20260319_sekoptanka0804.xlsx"
URL_PDF = "https://www.mlit.go.jp/tec/content/001989802.pdf"
PERIOD = "2025-04"            # 基準年月 令和7年4月(単価表 Ⅰ「令和 8 年度版の基準年月は令和 7 年 4 月」)
EFFECTIVE = "2026-04-01"      # 令和8年4月1日以降に入札書提出期限日を設定する工事から(令和9年3月31日まで)
AREA = "東京地区（東京17区）"
NOTE_BASE = "東京地区・基準年月の標準単価。他地区・他時点は構成比と地区の単価で補正して使う"

RATIO_KEYS = ["K", "K1", "K2", "K3", "R", "R1", "R2", "R3", "R4", "Z", "Z1", "Z2", "Z3", "Z4", "S"]
RATIO_NAME = {"K": "機械", "R": "労務", "Z": "材料", "S": "市場単価"}
REP_KEYS = ["K1", "K2", "K3", "R1", "R2", "R3", "R4", "Z1", "Z2", "Z3", "Z4", "S"]
NAME_DIFF = []  # 一覧シートの名称とシート1行目の名称が違うもの(原本の表記ゆれ。シート1行目を品目名に使う)
NUMTOK = re.compile(r"^(?:-|[0-9][0-9,]*(?:\.[0-9]+)?)$")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def txt(v):
    """セルの文字。セル内の改行は日本語の折り返しなので詰める(clean は空白にするため先に落とす)。"""
    if v is None:
        return ""
    return clean(str(v).replace("\r", "").replace("\n", ""))


def decimals(fmt):
    m = re.search(r"\.(0+)", fmt or "")
    return len(m.group(1)) if m else 0


def disp(cell):
    """表示書式の桁で丸めた文字(桁区切りなし)。'-' はそのまま。戻り値 (表示文字, 保存値と違うか)。"""
    v = cell.value
    if isinstance(v, str):
        return v.strip(), False
    d = decimals(cell.number_format)
    raw = Decimal(repr(float(v))) if isinstance(v, float) else Decimal(v)
    q = raw.quantize(Decimal(1).scaleb(-d), rounding=ROUND_HALF_UP)
    return format(q, "f"), (q != raw)


def dec(s):
    return None if s == "-" else Decimal(s.replace(",", ""))


def read_ichiran(wb):
    ws = wb["一覧"]
    out = collections.OrderedDict()
    notes = {}
    for row in ws.iter_rows(min_row=4, values_only=True):
        no = row[0]
        if isinstance(no, str) and re.fullmatch(r"\d{3}", no):
            out[no] = {"name": txt(row[1]), "pages": txt(row[2]), "hen": txt(row[3]), "sho": txt(row[4]),
                       "kou": txt(row[5]), "kijun": txt(row[6]), "biko": txt(row[7])}
        elif row[1] and str(row[1]).startswith("※"):
            m = re.match(r"※(\d)\s*(.*)", txt(row[1]))
            notes["※" + m.group(1)] = txt(row[1])
    return out, notes


def parse_xlsx():
    wb = openpyxl.load_workbook(XLSX)
    ichiran, marks = read_ichiran(wb)
    pk = collections.OrderedDict()
    stat = collections.Counter()
    for ws in wb.worksheets[3:]:
        no = ws.title
        m = re.match(r"^No\.(\d{3})【\s*(.*?)\s*】$", txt(ws["A1"].value))
        assert m and m.group(1) == no, (no, ws["A1"].value)
        name = m.group(2)
        assert no in ichiran, no
        if ichiran[no]["name"] != name:
            stat["name_diff_ichiran_vs_sheet"] += 1
            NAME_DIFF.append((no, ichiran[no]["name"], name))
        r3 = [c.value for c in ws[3]]
        if isinstance(r3[0], str) and "物価資料等による" in r3[0]:
            pk[no] = {"name": name, "kind": "bukka", "rows": [], "unit": "", "a3": txt(r3[0])}
            stat["pkg_bukka"] += 1
            continue
        mu = re.match(r"^＜\s*積算単位：\s*(.*?)\s*＞$", txt(ws["A2"].value))
        assert mu, (no, ws["A2"].value)
        unit = mu.group(1)
        ci, ki, di, bi = r3.index("標準単価"), r3.index("機労材構成比"), r3.index("代表機労材規格"), r3.index("備考")
        r4 = [c.value for c in ws[4]]
        r5 = [c.value for c in ws[5]]
        assert di - ki == 15 and bi - di == 15 and ki - ci == 1, (no, ci, ki, di, bi)
        got = [(txt(a) + txt(b)) for a, b in zip(r4[ki:di], r5[ki:di])]
        assert got == RATIO_KEYS, (no, got)
        conds = [txt(v) for v in r4[:ci]]
        assert all(conds), (no, conds)
        # 代表機労材規格の列: K1(名,印) K2(名,印) K3(名,印) R1..R4 Z1..Z4 S
        repcols = {"K1": (di, di + 1), "K2": (di + 2, di + 3), "K3": (di + 4, di + 5)}
        for j, k in enumerate(["R1", "R2", "R3", "R4", "Z1", "Z2", "Z3", "Z4", "S"]):
            repcols[k] = (di + 6 + j, None)
        hdr = {k: txt(r4[a]) + "|" + txt(r5[a]) for k, (a, _) in repcols.items()}
        assert hdr["K1"].endswith("K1") and hdr["R1"].endswith("R1") and hdr["Z1"].endswith("Z1") and hdr["S"].startswith("S"), (no, hdr)
        rows = []
        notes_rows = []
        for r in range(6, ws.max_row + 1):
            cells = ws[r]
            pv = cells[ci].value
            if pv in (None, ""):
                vals = [txt(c.value) for c in cells if c.value not in (None, "")]
                if vals:
                    notes_rows.append(" ".join(vals))
                continue
            assert not notes_rows, (no, r, "明細の途中に注がある")
            price, pdiff = disp(cells[ci])
            stat["price_display_differs_from_stored"] += int(pdiff)
            ratios = []
            for c in cells[ki:di]:
                s, dd = disp(c)
                stat["ratio_display_differs_from_stored"] += int(dd)
                ratios.append(s)
            rep = {}
            for k, (a, b) in repcols.items():
                nm = txt(cells[a].value)
                mk = txt(cells[b].value) if b is not None else ""
                assert mk in ("", "*"), (no, r, k, mk)
                rep[k] = (nm, mk)
            rows.append({"xlsx_row": r, "conds": [txt(c.value) for c in cells[:ci]], "price": price,
                         "ratios": ratios, "rep": rep, "biko": txt(cells[bi].value)})
        assert rows, no
        pk[no] = {"name": name, "kind": "priced", "unit": unit, "cond_names": conds, "rows": rows,
                  "notes": notes_rows}
        stat["pkg_priced"] += 1
        stat["rows_priced"] += len(rows)
    return wb, ichiran, marks, pk, stat


def parse_pdf_text():
    """PDF 文字を頁に分け、パッケージごとに (頁番号の並び, 印字頁ラベル, 16 語の並び) を返す。"""
    t = open(PDFTXT, encoding="utf-8").read()
    parts = re.split(r"^-- (\d+) of (\d+) --$", t, flags=re.M)
    pages = {}
    total = None
    for i in range(1, len(parts), 3):
        pages[int(parts[i])] = parts[i - 1]
        total = int(parts[i + 1])
    assert total and len(pages) == total, (len(pages), total)
    by = collections.OrderedDict()
    for p in range(1, total + 1):
        body = pages[p]
        m = re.search(r"^No\.(\d{3})【\s*(.*?)\s*】\s*$", body, flags=re.M)
        if not m:
            continue
        no = m.group(1)
        lab = re.findall(r"^(\d{3}) - (\d+)\s*$", body, flags=re.M)
        d = by.setdefault(no, {"name": m.group(2), "pages": [], "labels": [], "tokens": [], "bukka": False,
                               "text": ""})
        d["pages"].append(p)
        d["labels"] += ["%s-%s" % x for x in lab]
        d["text"] += re.sub(r"\s+", "", body)
        if "物価資料等による" in body:
            d["bukka"] = True
        for tk in body.split():
            d["tokens"].append((p, tk))
    return by, total


def main():
    wb, ichiran, marks, pk, stat = parse_xlsx()
    by, total_pages = parse_pdf_text()
    check = collections.Counter()
    mism = []
    # 頁数と名称の照合
    for no, info in ichiran.items():
        d = by.get(no)
        assert d, ("PDF に無い", no)
        pdf_name = re.sub(r"\s+", "", d["name"])
        sheet_name = pk[no]["name"]
        assert pdf_name == re.sub(r"\s+", "", sheet_name), (no, d["name"], sheet_name)
        check["name_pdf_eq_sheet"] += 1
        m = re.match(r"^(\d{3})-(\d+)(?:～(\d+))?$", info["pages"])
        want = int(m.group(3) or m.group(2)) - int(m.group(2)) + 1
        if len(d["pages"]) != want:
            mism.append(("pages", no, len(d["pages"]), want))
        check["pages_ok"] += int(len(d["pages"]) == want)
    # 値の照合
    for no, p in pk.items():
        d = by[no]
        if p["kind"] == "bukka":
            check["bukka_pdf_ok"] += int(d["bukka"] and not any(re.match(r"^[0-9][0-9,]*\.[0-9]+$", tk) for _, tk in d["tokens"]))
            continue
        # PDF の語の並び(頁をまたいで連結)の中に、Excel の各行の 16 語(標準単価 + 構成比 15 欄)が
        # この順に連続して現れることを確かめる。見つかった位置の頁をその行の PDF 頁とする。
        toks = d["tokens"]
        vals = [dec(tk) if NUMTOK.match(tk) else None for _, tk in toks]
        isnum = [bool(NUMTOK.match(tk)) for _, tk in toks]
        cur = 0
        ok = True
        for r in p["rows"]:
            want = [dec(r["price"])] + [dec(x) for x in r["ratios"]]
            found = None
            i = cur
            while i + 16 <= len(toks):
                if isnum[i] and vals[i] == want[0] and all(isnum[i + j] and vals[i + j] == want[j] for j in range(1, 16)):
                    found = i
                    break
                i += 1
            if found is None:
                ok = False
                mism.append(("row_not_found", no, r["xlsx_row"], r["price"]))
                continue
            r["pdf_page"] = toks[found][0]
            check["cells_equal"] += 16
            check["rows_found"] += 1
            cur = found + 16
        check["pkg_values_equal"] += int(ok)
        # 条件区分の文字が PDF の同じパッケージの頁に出ること(空白を抜いて)
        for r in p["rows"]:
            for v in r["conds"]:
                vv = re.sub(r"\s+", "", v)
                if vv == "-":
                    continue
                if vv in d["text"]:
                    check["cond_found"] += 1
                else:
                    check["cond_not_found"] += 1
    if mism:
        print(json.dumps(mism[:40], ensure_ascii=False))
        sys.exit("照合に失敗: %d 件" % len(mism))

    # 書く
    prices, ratios_out = [], []
    for no, p in pk.items():
        info = ichiran[no]
        cat = info["kijun"]
        loc = "施工パッケージ型積算基準 %s編%s章%s %s" % (info["hen"], info["sho"], info["kou"], info["kijun"])
        pages = [pg for pg in by[no]["pages"]]
        if p["kind"] == "bukka":
            prices.append({
                "obs_id": make_id(SID, no, "bukka"), "country": "JP", "layer": "work", "category": cat,
                # 同じ名称の「（材料費）」パッケージが複数の工種にあるので、規格にパッケージ番号を入れて区別する
                "item_name": p["name"], "spec": "No.%s" % no, "unit": "-",
                "geo_level": "pref", "geo_code": "13", "geo_name": "東京都", "area_label": AREA,
                "price": "", "currency": "JPY", "price_basis": "work_unit_price_ex_tax",
                "price_status": "publication_based_not_public", "period": PERIOD, "effective_from": EFFECTIVE,
                "source_id": SID, "source_page": "No.%s(Excel シート %s / PDF %s頁)" % (no, no, ",".join(map(str, pages))),
                "evidence_url": URL_XLSX, "license": "PDL1.0",
                "note": "単価表は「%s」とだけ記し、標準単価を示さない(一覧の備考 %s)。積算単位の記載も無いので unit は「-」。%s%s" % (
                    p["a3"].strip("　 "), marks.get(info["biko"], info["biko"]).rstrip("。"), loc,
                    "" if info["name"] == p["name"] else "。一覧シートの名称は「%s」(表の見出しの名称を使った)" % info["name"]),
            })
            stat["rows_bukka"] += 1
            continue
        for r in p["rows"]:
            # 規格 = 条件区分の「名：値」を原本の列順に並べたもの。値が「-」(その条件に当たらない)の列は省く。
            spec = " | ".join("%s：%s" % (n, v) for n, v in zip(p["cond_names"], r["conds"]) if v != "-")
            pid = make_id(SID, no, spec, "work_unit_price_ex_tax")
            rep_txt = "; ".join("%s=%s%s" % (k, nm, "（*賃料）" if mk == "*" else "")
                                for k, (nm, mk) in r["rep"].items() if nm and nm != "-")
            note = [NOTE_BASE + "。基準年月 令和7年4月、" + AREA + "。単価表に消費税の記載なし(積算の単価で税抜き扱い)"]
            if rep_txt:
                note.append("代表機労材規格: " + rep_txt)
            if r["biko"] and r["biko"] != "-":
                note.append("備考: " + r["biko"])
                if "注" in r["biko"] and p["notes"]:
                    note.append("表の注: " + " ".join(p["notes"]))
            if info["biko"]:
                note.append("一覧の備考 " + marks.get(info["biko"], info["biko"]))
            if info["name"] != p["name"]:
                note.append("一覧シートの名称は「%s」(表の見出しの名称を使った)" % info["name"])
            note.append(loc)
            src = "No.%s(Excel シート %s 行%d / PDF %d頁)" % (no, no, r["xlsx_row"], r["pdf_page"])
            prices.append({
                "obs_id": pid, "country": "JP", "layer": "work", "category": cat, "item_name": p["name"],
                "spec": spec, "unit": p["unit"], "geo_level": "pref", "geo_code": "13", "geo_name": "東京都",
                "area_label": AREA, "price": num(r["price"]), "currency": "JPY",
                "price_basis": "work_unit_price_ex_tax", "price_status": "published_pdl",
                "period": PERIOD, "effective_from": EFFECTIVE, "source_id": SID, "source_page": src,
                "evidence_url": URL_XLSX, "license": "PDL1.0", "note": "。".join(x.rstrip("。") for x in note),
            })
            for key, val in zip(RATIO_KEYS, r["ratios"]):
                if val == "-":
                    stat["ratio_dash_skipped"] += 1
                    continue
                if Decimal(val) == 0:
                    stat["ratio_zero_skipped_" + key] += 1
                    continue
                grp = RATIO_NAME[key[0]]
                iname = "%s 構成比 %s" % (p["name"], grp) + ("" if key in RATIO_NAME else " " + key)
                rn = ""
                if key in r["rep"]:
                    nm, mk = r["rep"][key]
                    if nm and nm != "-":
                        rn = "。代表規格: %s%s" % (nm, "（*賃料）" if mk == "*" else "")
                what = {"K": "機械経費の合計", "R": "労務費の合計", "Z": "材料費の合計", "S": "市場単価"}.get(key, "代表規格")
                ratios_out.append({
                    "_no": no, "obs_id": make_id(SID, no, spec, "ratio", key), "country": "JP", "layer": "work",
                    "category": cat, "item_name": iname, "spec": spec, "unit": "%",
                    "geo_level": "pref", "geo_code": "13", "geo_name": "東京都", "area_label": AREA,
                    "price": num(val), "currency": "", "price_basis": "ratio", "price_status": "published_pdl",
                    "period": PERIOD, "effective_from": EFFECTIVE, "source_id": SID, "source_page": src,
                    "evidence_url": URL_XLSX, "license": "PDL1.0",
                    "note": "機労材構成比 %s(%s)。標準単価の行 obs_id=%s の構成比%s" % (key, what, pid, rn),
                })
                stat["ratio_rows"] += 1
    n1 = write_obs(OUT_PRICE, prices)
    # 分け目: 行数の累計が半分を超えたパッケージの終わり
    half = len(ratios_out) / 2.0
    cnt = collections.Counter(x["_no"] for x in ratios_out)
    acc, cut = 0, None
    for no in pk:
        acc += cnt.get(no, 0)
        if acc >= half:
            cut = no
            break
    part1 = [{k: v for k, v in x.items() if k != "_no"} for x in ratios_out if x["_no"] <= cut]
    part2 = [{k: v for k, v in x.items() if k != "_no"} for x in ratios_out if x["_no"] > cut]
    n2 = (write_obs(OUT_RATIO % 1, part1), write_obs(OUT_RATIO % 2, part2), "p1 = No.001-%s, p2 = No.%s 以降" % (cut, "%03d" % (int(cut) + 1)))
    res = {"name_diff": NAME_DIFF, "xlsx_sha256": sha256(XLSX), "pdf_text_sha256": sha256(PDFTXT), "pdf_pages": total_pages,
           "price_file_rows": n1, "ratio_file_rows": n2, "stat": dict(stat), "check": dict(check)}
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
