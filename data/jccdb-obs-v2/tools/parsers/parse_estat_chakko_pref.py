# -*- coding: utf-8 -*-
"""
建築着工統計調査(国土交通省、e-Stat 提供の Excel)の
  第６表－１ 着工建築物：都道府県別、構造別(建築物の数、床面積の合計、工事費予定額)
  第７表－１ 着工建築物：都道府県別、用途別(大分類)(同上)
を xlrd でセルから直接読み、観測層 v2 の行にする。

入力: OBS2/raw/estat-chakko-t6-1-<時点>.xls, estat-chakko-t7-1-<時点>.xls
      時点 = 2025(令和7年計)と 2026-01 ... 2026-07(令和8年各月分)
出力: OBS2/observations/jp/cost_sqft_mlit_chakko_2025.csv(年計)
      OBS2/observations/jp/cost_sqft_mlit_chakko_2026_01_07.csv(月次 7 か月)
      OBS2/reports/W2-chakko-checks.json(照合の数字)

行の作り方:
  - 表の値はそのまま別行で持つ: 建築物の数(count, 棟)、床面積の合計(count, ㎡)、工事費予定額(construction_cost_planned_total, 万円)
  - 1㎡あたり工事費予定額は自分で割った値(cost_per_m2, 円/m2)。工事費予定額x10000/床面積 を 1円未満四捨五入。
    割る前の2行の obs_id を note に書く。どちらかが 0 / 秘匿(＊)なら作らない。
  - 0 は price を空にして not_set、ref_value=0。＊(秘匿)は not_set、note に原文。
  - 第７表－１の「全建築物計」は第６表－１の「総計」と同じ量なので行にしない(照合にだけ使う)。
  - 市部計・郡部計の段は行にしない(都道府県計 = 市部計 + 郡部計 の照合にだけ使う)。
照合(全部機械で数える):
  A 全国計 = 47 都道府県の和(列ごと)
  B 第６表: 総計 = 6 構造の和
  C 都道府県計 = 市部計 + 郡部計
  D 第６表の総計 = 第７表の全建築物計
  E 第７表: 用途 18 区分の和 と 全建築物計 の差(原本の注意書きのとおり按分で一致しないことがある。差を数える)
"""
import os, re, sys, json, hashlib, collections
from decimal import Decimal, ROUND_HALF_UP
import xlrd

HERE = os.path.dirname(os.path.abspath(__file__))
OBS2 = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(OBS2, "tools"))
from obs_common import make_id, write_obs, JP_PREFS, JP_PREF_CODE  # noqa: E402

PERIODS = [("2025", "2025", "令和7年計分")] + [("2026-%02d" % m, "2026-%02d" % m, "令和8年%d月分" % m) for m in range(1, 8)]
STAT_INF = {  # (表, 時点) -> e-Stat statInfId(ファイル一覧の頁で表番号と調査年月を確かめた)
    ("6-1", "2025"): "000040405889", ("7-1", "2025"): "000040405891",
    ("6-1", "2026-01"): "000040417114", ("7-1", "2026-01"): "000040417116",
    ("6-1", "2026-02"): "000040441459", ("7-1", "2026-02"): "000040441461",
    ("6-1", "2026-03"): "000040450922", ("7-1", "2026-03"): "000040450924",
    ("6-1", "2026-04"): "000040459273", ("7-1", "2026-04"): "000040459275",
    ("6-1", "2026-05"): "000040469905", ("7-1", "2026-05"): "000040469907",
    ("6-1", "2026-06"): "000040482040", ("7-1", "2026-06"): "000040482042",
    ("6-1", "2026-07"): "000040497338", ("7-1", "2026-07"): "000040497340",
}
TITLE = {
    "6-1": "第６表－１ 着工建築物：都道府県別、構造別（建築物の数、床面積の合計、工事費予定額）",
    "7-1": "第７表－１ 着工建築物：都道府県別、用途別（大分類）（建築物の数、床面積の合計、工事費予定額）",
}
MEASURES = [  # 列見出しの頭, price_basis, unit, 通貨
    ("建築物の数", "count", "棟", ""),
    ("床面積の合計", "count", "㎡", ""),
    ("工事費予定額", "construction_cost_planned_total", "万円", "JPY"),
]
WS = re.compile(r"[\s　]+")


def colname(c):
    s = ""
    c += 1
    while c:
        c, r = divmod(c - 1, 26)
        s = chr(65 + r) + s
    return s


def cellval(v):
    """('num', int/Decimal) / ('secret', '＊') / ('blank', '')"""
    if isinstance(v, float):
        if v == int(v):
            return ("num", int(v))
        return ("num", Decimal(repr(v)))
    t = str(v).strip()
    if t in ("＊", "*"):
        return ("secret", t)
    if t in ("", "-", "－", "…"):
        return ("blank", t)
    raise ValueError("想定外のセル: %r" % v)


def read_table(path, table):
    wb = xlrd.open_workbook(path)
    assert wb.nsheets == 1, path
    sh = wb.sheet_by_index(0)
    title = WS.sub("", str(sh.cell_value(1, 3)))
    want = {"6-1": "着工建築物：都道府県別、構造別", "7-1": "着工建築物：都道府県別、用途別（大分類）"}[table]
    assert title.startswith(want), (path, title)
    # 表頭(行5=グループ、行6=測度。0始まりで 4 と 5)
    groups = []
    for c in range(3, sh.ncols, 3):
        g = str(sh.cell_value(4, c))
        ms = [str(sh.cell_value(5, c + k)) for k in range(3)]
        for k, (head, _, _, _) in enumerate(MEASURES):
            assert WS.sub("", ms[k]).startswith(head), (path, c, ms)
        groups.append((c, g, ms))
    # 段(ブロック): 列B(1)の見出しで探す
    blocks = {"pref": [], "shi": [], "gun": []}
    period_label = str(sh.cell_value(3, 1))
    for r in range(sh.nrows):
        lab = str(sh.cell_value(r, 1)).strip()
        if lab == "全国計" or re.match(r"^\d{5}\S+$", lab):
            blocks["pref"].append(r)
        elif lab.endswith("市部計"):
            blocks["shi"].append(r)
        elif lab.endswith("郡部計"):
            blocks["gun"].append(r)
    for k in blocks:
        assert len(blocks[k]) == 48, (path, k, len(blocks[k]))
    # 3 段とも表頭が同じか
    hdr_rows = [r for r in range(sh.nrows) if WS.sub("", str(sh.cell_value(r, 1))) in ("構造", "用途(大分類)", "用途（大分類）")]
    assert len(hdr_rows) == 3, (path, hdr_rows)
    for hr in hdr_rows:
        for c, g, ms in groups:
            assert sh.cell_value(hr, c) == g, (path, hr, c)
            for k in range(3):
                assert sh.cell_value(hr + 1, c + k) == ms[k], (path, hr, c, k)
    return sh, groups, blocks, period_label


def geo_of_label(lab, idx):
    """都道府県の段の行見出し -> (geo_level, geo_code, geo_name, area_code)。idx は段の中の順番(0=全国計)"""
    if lab == "全国計":
        assert idx == 0
        return "national", "JP", "日本", ""
    m = re.match(r"^(\d{2})000(\S+)$", lab)
    assert m, lab
    code = m.group(1)
    name = JP_PREFS[int(code) - 1]
    assert name.startswith(m.group(2)) or name == m.group(2), (lab, name)
    assert int(code) == idx, (lab, idx)
    return "pref", code, name, lab[:5]


def pref_of_sub(lab):
    for n in JP_PREFS:
        if lab.startswith(n):
            return JP_PREF_CODE[n]
    if lab.startswith("全国"):
        return "JP"
    raise ValueError(lab)


def main():
    rows_by_file = collections.OrderedDict()
    checks = collections.OrderedDict()
    for per, period, per_label in PERIODS:
        out = rows_by_file.setdefault("2025" if per == "2025" else "2026_01_07", [])
        grid = {}  # (table, geo_code, group_norm, measure_idx) -> cellval
        subs = {}  # (table, 'shi'/'gun', geo_code, group_norm, measure_idx) -> cellval
        for table in ("6-1", "7-1"):
            sid = "estat-chakko-t%s-%s" % (table, per)
            path = os.path.join(OBS2, "raw", sid + ".xls")
            sh, groups, blocks, plabel = read_table(path, table)
            assert plabel == per_label, (path, plabel, per_label)
            url = "https://www.e-stat.go.jp/stat-search/file-download?statInfId=%s&fileKind=0" % STAT_INF[(table, per)]
            for kind in ("shi", "gun"):
                for r in blocks[kind]:
                    g = pref_of_sub(str(sh.cell_value(r, 1)).strip())
                    for c, gh, ms in groups:
                        for k in range(3):
                            subs[(table, kind, g, WS.sub("", gh), k)] = cellval(sh.cell_value(r, c + k))
            for idx, r in enumerate(blocks["pref"]):
                lab = str(sh.cell_value(r, 1)).strip()
                gl, gc, gn, acode = geo_of_label(lab, idx)
                for c, gh, ms in groups:
                    gnorm = WS.sub("", gh)
                    vals = []
                    for k in range(3):
                        v = cellval(sh.cell_value(r, c + k))
                        grid[(table, gc, gnorm, k)] = v
                        vals.append(v)
                    if table == "7-1" and gnorm == "全建築物計":
                        continue  # 第６表の総計と同じ量。照合にだけ使う
                    if table == "7-1":
                        m = re.match(r"^([Ａ-ＺA-Z])[\s　]+(.*)$", gh.replace("\n", ""), re.S)
                        assert m, gh
                        item = m.group(1) + "　" + WS.sub("", m.group(2))
                    else:
                        item = gnorm
                    cat = "建築着工統計調査 " + TITLE[table]
                    ids = {}
                    for k, (head, basis, unit, cur) in enumerate(MEASURES):
                        kind, v = vals[k]
                        oid = make_id(sid, lab, gnorm, head)
                        ids[k] = oid
                        row = dict(
                            obs_id=oid, country="JP", layer="cost_sqft", category=cat, item_name=item,
                            spec="表頭「%s」/「%s」" % (gh.replace("\n", " "), ms[k]), unit=unit,
                            geo_level=gl, geo_code=gc, geo_name=gn, area_label=lab, area_code=acode,
                            currency=cur, price_basis=basis, period=period, source_id=sid,
                            source_page="%s!%s%d" % (sh.name, colname(c + k), r + 1), evidence_url=url,
                            license="GOV-STD-2.0")
                        notes = [per_label]
                        if table == "7-1":
                            notes.append("用途別の値は一つの工事・建築物に複数の用途があるとき床面積の割合で按分して計上(原本の利用上の注意)")
                        if kind == "num" and v > 0:
                            row.update(price=str(v), price_status="published_cc_by")
                        elif kind == "num":
                            row.update(price="", price_status="not_set", ref_value="0", ref_note="原本の値は 0(該当する着工なし)")
                        elif kind == "secret":
                            row.update(price="", price_status="not_set")
                            notes.append("原本は「%s」(建築物の数が1又は2の場合等に工事費予定額を秘匿)" % v)
                        else:
                            row.update(price="", price_status="not_set")
                            notes.append("原本は空欄/記号「%s」" % v)
                        row["note"] = "。".join(notes)
                        out.append(row)
                    # 1㎡あたり(自分で割る)
                    (ka, area), (kc, cost) = vals[1], vals[2]
                    if ka == "num" and kc == "num" and area > 0 and cost > 0:
                        yen = (Decimal(cost) * 10000 / Decimal(area)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
                        out.append(dict(
                            obs_id=make_id(sid, lab, gnorm, "工事費予定額/床面積"), country="JP", layer="cost_sqft",
                            category=cat, item_name=item,
                            spec="表頭「%s」/ 工事費予定額(万円)x10000÷床面積の合計(㎡)" % gh.replace("\n", " "),
                            unit="円/m2", geo_level=gl, geo_code=gc, geo_name=gn, area_label=lab, area_code=acode,
                            price=str(yen), currency="JPY", price_basis="cost_per_m2", price_status="published_cc_by",
                            period=period, source_id=sid,
                            source_page="%s!%s%d,%s%d" % (sh.name, colname(c + 1), r + 1, colname(c + 2), r + 1),
                            evidence_url=url, license="GOV-STD-2.0",
                            note="%s。原本に無い値: 工事費予定額 %s万円 x 10000 ÷ 床面積の合計 %s㎡ を1円未満四捨五入して作成(建築着工統計調査(国土交通省)を加工して作成)。割る前の行 obs_id: 工事費予定額=%s, 床面積の合計=%s"
                                 % (per_label, cost, area, ids[2], ids[1])
                                 + ("。建築物の数 %s 棟" % vals[0][1] if vals[0][0] == "num" else "")
                                 + ("(10棟未満。少数の工事で値が大きく振れる)" if vals[0][0] == "num" and vals[0][1] < 10 else "")))
        # ---- 照合 ----
        ck = collections.Counter()
        diffs = []
        for table in ("6-1", "7-1"):
            gnorms = sorted({k[2] for k in grid if k[0] == table})
            prefs = ["%02d" % i for i in range(1, 48)]
            for gnorm in gnorms:
                for k in range(3):
                    # A 全国計 = 47 都道府県の和
                    tot = grid[(table, "JP", gnorm, k)]
                    parts = [grid[(table, p, gnorm, k)] for p in prefs]
                    if tot[0] == "num" and all(p[0] == "num" for p in parts):
                        s = sum(p[1] for p in parts)
                        ck["A_ok" if s == tot[1] else "A_ng"] += 1
                        if s != tot[1]:
                            diffs.append(("A", table, gnorm, k, tot[1], s))
                    else:
                        ck["A_skip"] += 1
                    # C 都道府県計 = 市部計 + 郡部計(全国も)
                    for p in ["JP"] + prefs:
                        a = grid[(table, p, gnorm, k)]
                        b = subs[(table, "shi", p, gnorm, k)]
                        c_ = subs[(table, "gun", p, gnorm, k)]
                        if a[0] == b[0] == c_[0] == "num":
                            ok = a[1] == b[1] + c_[1]
                            ck["C_ok" if ok else "C_ng"] += 1
                            if not ok:
                                diffs.append(("C", table, p, gnorm, k, a[1], b[1], c_[1]))
                        else:
                            ck["C_skip"] += 1
            if table == "6-1":
                structs = [g for g in gnorms if g != "総計"]
                assert len(structs) == 6, structs
                for p in ["JP"] + prefs:
                    for k in range(3):
                        tot = grid[(table, p, "総計", k)]
                        parts = [grid[(table, p, g, k)] for g in structs]
                        if tot[0] == "num" and all(x[0] == "num" for x in parts):
                            s = sum(x[1] for x in parts)
                            ck["B_ok" if s == tot[1] else "B_ng"] += 1
                            if s != tot[1]:
                                diffs.append(("B", p, k, tot[1], s))
                        else:
                            ck["B_skip"] += 1
            else:
                uses = [g for g in gnorms if g != "全建築物計"]
                assert len(uses) == 18, uses
                for p in ["JP"] + prefs:
                    for k in range(3):
                        tot = grid[(table, p, "全建築物計", k)]
                        parts = [grid[(table, p, g, k)] for g in uses]
                        if tot[0] == "num" and all(x[0] == "num" for x in parts):
                            s = sum(x[1] for x in parts)
                            d = s - tot[1]
                            ck["E_eq" if d == 0 else "E_ne"] += 1
                            if d != 0:
                                ck["E_absdiff_max_%d" % k] = max(ck["E_absdiff_max_%d" % k], abs(d))
                        else:
                            ck["E_skip"] += 1
        for p in ["JP"] + ["%02d" % i for i in range(1, 48)]:
            for k in range(3):
                a, b = grid[("6-1", p, "総計", k)], grid[("7-1", p, "全建築物計", k)]
                ok = a == b
                ck["D_ok" if ok else "D_ng"] += 1
                if not ok:
                    diffs.append(("D", p, k, a, b))
        checks[per] = {"counts": dict(ck), "diffs": [list(map(str, d)) for d in diffs[:30]]}
    # ---- 書き出し ----
    files = {}
    for key, rows in rows_by_file.items():
        fn = os.path.join(OBS2, "observations", "jp", "cost_sqft_mlit_chakko_%s.csv" % key)
        n = write_obs(fn, rows)
        st = collections.Counter(r["price_status"] for r in rows)
        pb = collections.Counter(r["price_basis"] for r in rows)
        files[os.path.relpath(fn, OBS2)] = {"rows": n, "by_status": dict(st), "by_price_basis": dict(pb),
                                             "sha256": hashlib.sha256(open(fn, "rb").read()).hexdigest()}
    rep = {"files": files, "checks": checks}
    json.dump(rep, open(os.path.join(OBS2, "reports", "W2-chakko-checks.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(json.dumps(rep, ensure_ascii=False, indent=1)[:6000])


if __name__ == "__main__":
    main()
