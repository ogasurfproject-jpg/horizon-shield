# -*- coding: utf-8 -*-
"""
国土交通省 大臣官房官庁営繕部「令和９年度 新営予算単価」(令和8年5月20日 国営計第42号) を観測層 v2 に入れる。

入力: OBS2/raw/mlit-shinei-yosan-r9.pdf (https://www.mlit.go.jp/gobuild/content/001464509.pdf、47 頁)
出力:
  observations/jp/work_mlit_shinei_yosan_fy2027.csv
      第２ 標準予算単価(PDF 6〜11 頁): 建物別 24 型 x 工事項目 17 行。東京(地域別工事費指数100)の
      建物延べ面積 1㎡当たり(共通費相当分を含む。消費税相当分を除く。)円。
      「○」(通常必要だが別途計上)、「－」(通常不要)、「0」は値を持たないので not_set。
  observations/jp/index_mlit_shinei_yosan_fy2027.csv
      第１ １ 一般地域別工事費指数(PDF 3 頁): 50 地域(北海道 4 地域 + 46 都府県) x 構造 4 種。東京 = 100。

読み方: pdftotext -bbox-layout の語の座標。列は「番号」行の (1)〜(24) の x 中心、行は行見出しの y。
値の x 中心と列の x 中心の距離を全セルで測り、最大値を出す。
照合(止める条件):
  - 各列・各工事区分で、数値の項目の和 = 小計(「○」「－」は 0 として)。3 つの小計の和 = 合計。
  - pdftotext -layout の同じ頁の数値の語の数と、bbox で読んだ数値セルの数が一致すること。
  - 地域別工事費指数は 50 地域 x 4 = 200 値、東京の 4 値が 100。-layout と bbox の数値の数が一致。
"""
import os, re, sys, json, hashlib, subprocess, collections

HERE = os.path.dirname(os.path.abspath(__file__))
OBS2 = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(OBS2, "tools"))
from obs_common import make_id, write_obs, num, pref  # noqa: E402

SID = "mlit-shinei-yosan-r9"
PDF = os.path.join(OBS2, "raw", SID + ".pdf")
URL = "https://www.mlit.go.jp/gobuild/content/001464509.pdf"
OUT_WORK = os.path.join(OBS2, "observations", "jp", "work_mlit_shinei_yosan_fy2027.csv")
OUT_INDEX = os.path.join(OBS2, "observations", "jp", "index_mlit_shinei_yosan_fy2027.csv")
PERIOD = "FY2027"   # 令和９年度
BUILDINGS = ["自転車置場", "寄宿舎", "体育館", "渡廊下", "庁舎", "倉庫", "車庫"]
SECTIONS = ["建築工事", "電気設備工事", "機械設備工事"]
AREA_RANGE = {"(1)": "200㎡(～300㎡)", "(2)": "400㎡(301㎡～500㎡)", "(3)": "750㎡(501㎡～1,000㎡)",
              "(4)": "1,500㎡(1,001㎡～2,250㎡)", "(5)": "3,000㎡(2,251㎡～4,500㎡)",
              "(6)": "6,000㎡(4,501㎡～10,000㎡)", "(7)": "15,000㎡(10,001㎡～22,500㎡)",
              "(8)": "30,000㎡(22,501㎡以上)"}
MARK_NOTE = {
    "○": "原本「○」: 通常その建物に必要と考えられるものであり、「第３ 標準予算単価算出基準」を用いるなどし、実情に応じて別途計上する(表に単価なし)",
    "－": "原本「－」: 通常その建物に不要と考えられるもの(必要なら第３の算出基準などで別途計上)",
    "0": "原本の表示は 0",
}
NUM = re.compile(r"^[0-9][0-9,]*$")


def words(page):
    out = subprocess.run(["pdftotext", "-bbox-layout", "-f", str(page), "-l", str(page), PDF, "-"],
                         capture_output=True, text=True, check=True).stdout
    ws = []
    for x0, y0, x1, y1, w in re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', out):
        ws.append(((float(x0) + float(x1)) / 2, (float(y0) + float(y1)) / 2, w))
    return ws


def layout_numbers(page):
    t = subprocess.run(["pdftotext", "-layout", "-f", str(page), "-l", str(page), PDF, "-"],
                       capture_output=True, text=True, check=True).stdout
    return [w for w in t.split() if NUM.match(w)]


def rows_by_y(ws, tol=3.0):
    rows = []
    for x, y, w in sorted(ws, key=lambda a: a[1]):
        if rows and abs(rows[-1][0] - y) <= tol:
            rows[-1][1].append((x, w))
        else:
            rows.append([y, [(x, w)]])
    return [(y, sorted(r)) for y, r in rows]


def split_buildings(chars):
    """建物別の行の語(1文字ずつのことが多い)を、既知の建物名に貪欲に割り当てる。[(名前, x 中心)]"""
    chars = [(x, ch) for x, w in chars for ch in w]   # 複数文字の語は各文字に語の中心を持たせる
    s = "".join(w for _, w in chars)
    out, i = [], 0
    while i < len(chars):
        for b in sorted(BUILDINGS, key=len, reverse=True):
            if s.startswith(b, i):
                xs = [chars[i + k][0] for k in range(len(b))]
                out.append((b, sum(xs) / len(xs)))
                i += len(b)
                break
        else:
            raise SystemExit("建物名が読めない: %r" % s[i:])
    return out


def parse_standard(page, stat, maxdist):
    ws = words(page)
    rows = rows_by_y(ws)
    cols, bld, struct, area = None, None, None, None
    items = []  # (section, itemno, label, {colno: token})
    sec = 0
    pending_no = {}
    for y, r in rows:
        left = [(x, w) for x, w in r if x < 200]
        right = [(x, w) for x, w in r if x >= 200]
        ltxt = "".join(w for _, w in left)
        if ltxt.startswith("建物別"):
            bld = split_buildings(right)
            continue
        if ltxt.startswith("番号"):
            cols = [(w, x) for x, w in right]
            assert all(re.fullmatch(r"\(\d+\)", w) for w, _ in cols), cols
            continue
        if cols is None:
            continue

        def assign(tokens):
            d = {}
            for x, w in tokens:
                c, cx = min(cols, key=lambda cc: abs(cc[1] - x))
                maxdist[0] = max(maxdist[0], abs(cx - x))
                assert c not in d, (page, c, w)
                d[c] = w
            return d
        if ltxt.startswith("構造、階数"):
            struct = assign(right)
            continue
        if ltxt.startswith("概略延べ面積"):
            area = assign(right)
            continue
        # 行見出し: 「(n)ラベル」または「小計」「合計」。縦書きの工事区分(建/築/…)は x≈42 の1文字。
        lab = "".join(w for x, w in left if x >= 50)   # x≈42 の縦書き(建/築/工/事 など)は落とす
        m = re.match(r"^\((\d)\)(.*)$", lab)
        if not right:
            if re.fullmatch(r"\(\d\)", lab):
                pending_no[round(y)] = lab
            continue
        if lab in ("小計",):
            items.append((SECTIONS[sec], "", "小計", assign(right)))
            sec += 1
            continue
        if lab == "合計":
            items.append(("", "", "合計", assign(right)))
            break   # 合計の下は頁番号と発行者名だけ
        if m:
            items.append((SECTIONS[sec], "(%s)" % m.group(1), m.group(2), assign(right)))
        else:
            # 番号が別の y にずれた行(例: 「(5)」が 1pt 下)
            near = [v for k, v in pending_no.items() if abs(k - y) <= 3]
            items.append((SECTIONS[sec], near[0] if near else "", lab, assign(right)))
    # 番号がずれた行: 直後の行に「(n)」だけが来る場合を拾う
    fixed = []
    for sec_, no, lab, d in items:
        fixed.append([sec_, no, lab, d])
    return cols, bld, struct, area, fixed


def main():
    stat = collections.Counter()
    maxdist = [0.0]
    out_rows = []
    checks = collections.Counter()
    pages = [6, 7, 8, 9, 10, 11]
    for page in pages:
        cols, bld, struct, area, items = parse_standard(page, stat, maxdist)
        # 番号の欠けた項目行(「(5) その他」の番号が別行になる)を補う
        for sec in SECTIONS:
            k = 0
            for it in items:
                if it[0] == sec and it[2] != "小計":
                    k += 1
                    if not it[1]:
                        it[1] = "(%d)" % k
                    assert it[1] == "(%d)" % k, (page, it)
        # 建物名は複数列にまたがって中央に置かれる。左から順に列を連続した組に分け、
        # 「建物名の x 中心」と「その組の列の x 中心の平均」の差の和が最小になる分け方を採る。
        import itertools
        best = None
        n, k = len(cols), len(bld)
        for cut in itertools.combinations(range(1, n), k - 1):
            edges = (0,) + cut + (n,)
            cost = 0.0
            for j in range(k):
                grp = cols[edges[j]:edges[j + 1]]
                cost += abs(bld[j][1] - sum(x for _, x in grp) / len(grp))
            if best is None or cost < best[0]:
                best = (cost, edges)
        colbld = {}
        for j in range(k):
            for c, _ in cols[best[1][j]:best[1][j + 1]]:
                colbld[c] = bld[j][0]
        ncell = 0
        for c, _ in cols:
            tot_sub = 0
            for sec in SECTIONS:
                vals = [it[3].get(c) for it in items if it[0] == sec and it[2] != "小計"]
                sub = [it[3].get(c) for it in items if it[0] == sec and it[2] == "小計"][0]
                s = sum(int(v.replace(",", "")) for v in vals if v and NUM.match(v))
                assert NUM.match(sub) and s == int(sub.replace(",", "")), (page, c, sec, vals, sub)
                checks["subtotal_ok"] += 1
                tot_sub += int(sub.replace(",", ""))
            tot = [it[3].get(c) for it in items if it[2] == "合計"][0]
            assert tot_sub == int(tot.replace(",", "")), (page, c, tot_sub, tot)
            checks["total_ok"] += 1
        # -layout と数の数
        bbox_nums = sum(1 for it in items for v in it[3].values() if NUM.match(v))
        bbox_nums += sum(1 for v in area.values() if NUM.match(v))
        lay = layout_numbers(page)
        lay = [w for w in lay if w not in ("-",)]
        # ページ番号(-4- など)は数字だけの語として -layout に出ないが、念のため頁番号の語は除く
        assert len(lay) == bbox_nums, (page, len(lay), bbox_nums)
        checks["layout_numeric_tokens_equal"] += bbox_nums
        for it in items:
            sec, no, lab, d = it
            for c, _ in cols:
                v = d.get(c)
                assert v is not None, (page, c, it)
                b = colbld[c]
                iname = "%s %s %s" % (b, sec, (no + lab) if no else lab) if sec else "%s %s" % (b, lab)
                iname = iname.replace("  ", " ")
                spec = "番号%s | 構造・階数 %s | 概略延べ面積 %s" % (c, struct[c], AREA_RANGE.get(c, area[c] + "㎡"))
                row = {
                    "obs_id": make_id(SID, "standard", c, sec, no, lab), "country": "JP", "layer": "work",
                    "category": "新営予算単価 第２ 標準予算単価(%s)" % b, "item_name": iname, "spec": spec,
                    "unit": "円/㎡(建物延べ面積)", "geo_level": "pref", "geo_code": "13", "geo_name": "東京都",
                    "area_label": "東京（地域別工事費指数100）", "currency": "JPY", "price_basis": "cost_per_m2",
                    "period": PERIOD, "source_id": SID, "source_page": "PDF %d頁(印字 -%d-)" % (page, page - 2),
                    "evidence_url": URL, "license": "PDL1.0",
                }
                base_note = "官庁施設の新営の予算用の標準予算単価。東京(地域別工事費指数100)の建物延べ面積1㎡当たり、共通費相当分を含み消費税相当分を除く。他地域は第１の地域別工事費指数を掛ける"
                if NUM.match(v) and int(v.replace(",", "")) > 0:
                    row.update(price=num(v), price_status="published_pdl", note=base_note)
                    stat["published"] += 1
                else:
                    key = "0" if v == "0" else v
                    assert key in MARK_NOTE, (page, c, v)
                    row.update(price="", price_status="not_set", note=MARK_NOTE[key] + "。" + base_note)
                    if key == "0":
                        row.update(ref_value="0", ref_note="原本の表示値 0(この工事区分に計上する項目なし)")
                    stat["not_set_" + key] += 1
                out_rows.append(row)
                ncell += 1
        stat["cells"] += ncell

    # 第１ １ 一般地域別工事費指数(PDF 3 頁)
    ws = words(3)
    rows = rows_by_y(ws)
    lay = layout_numbers(3)
    idx = []
    STRUCT = ["鉄筋コンクリート造", "鉄骨鉄筋コンクリート造", "鉄骨造", "木造"]
    started = False
    for y, r in rows:
        toks = [w for _, w in r]
        if not started:
            started = "".join(toks).startswith("地域別")   # 表の見出し「地域別 … 地域別」の行から下
            continue
        if toks and toks[0].startswith("※"):
            break   # 表の下の注(道北などの範囲)
        # 「道 北 102 102 103 100 福 井 94 95 96 96」
        i = 0
        while i < len(toks):
            name = ""
            while i < len(toks) and not NUM.match(toks[i]):
                name += toks[i]
                i += 1
            vals = []
            while i < len(toks) and NUM.match(toks[i]) and len(vals) < 4:
                vals.append(toks[i])
                i += 1
            if len(vals) == 4 and name and not name.startswith("構造別"):
                idx.append((name, vals, y))
            elif vals:
                raise SystemExit("地域別指数の行が読めない: %r" % toks)
    assert len(idx) == 50, len(idx)   # 北海道 4 地域 + 46 都府県
    assert len(lay) == 50 * 4, (len(lay), "-layout の数値の語は 200 のはず(頁番号は -1- で数値の語にならない)")
    tokyo = [v for n, v, _ in idx if n == "東京"][0]
    assert tokyo == ["100"] * 4, tokyo
    checks["index_values"] = 200
    HOKKAIDO = {"道北": "宗谷、上川、留萌（総合振興局又は振興局の所管区域を指す。以下同じ）",
                "道東": "オホーツク、根室、釧路、十勝", "道央": "空知、石狩、後志、胆振、日高", "道南": "檜山、渡島"}
    idx_rows = []
    for name, vals, _ in idx:
        if name in HOKKAIDO:
            gc, gn, lvl, members = "01", "北海道", "pref_area", HOKKAIDO[name]
        else:
            gc, gn = pref(name)
            assert gc, name
            lvl, members = "pref", ""
        for s, v in zip(STRUCT, vals):
            idx_rows.append({
                "obs_id": make_id(SID, "chiiki_index", name, s), "country": "JP", "layer": "index",
                "category": "新営予算単価 第１ １ 一般地域別工事費指数", "item_name": "地域別工事費指数 " + s,
                "spec": "構造別 " + s, "unit": "index (東京 = 100)", "geo_level": lvl, "geo_code": gc,
                "geo_name": gn, "area_label": name, "area_members": members, "price": num(v), "currency": "",
                "price_basis": "index_value", "price_status": "published_pdl", "period": PERIOD,
                "source_id": SID, "source_page": "PDF 3頁(印字 -1-)", "evidence_url": URL, "license": "PDL1.0",
                "note": "各工事ごとに東京の工事費単価を100としたときの各地域別の工事費指数。各地域における材料価格、労務賃金その他の価格の相違に対して算定したもの。第２ 標準予算単価(東京)に掛けて使う",
            })
    n1 = write_obs(OUT_WORK, out_rows)
    n2 = write_obs(OUT_INDEX, idx_rows)
    print(json.dumps({"pdf_sha256": hashlib.sha256(open(PDF, "rb").read()).hexdigest(), "work_rows": n1,
                      "index_rows": n2, "stat": dict(stat), "checks": dict(checks),
                      "max_col_distance_pt": round(maxdist[0], 2)}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
