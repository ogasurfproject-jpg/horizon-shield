# -*- coding: utf-8 -*-
"""
近畿地方整備局「材料単価【設計】」の 種別=生コンクリート の頁を、pdftotext -bbox-layout の語の座標で読み、
observations/jp/material_kkr_namacon_<月>.csv を書く(月ごとに別ファイル・別の source_id。古い月の行は消さない)。

読み方は v1 の /home/claude/work/jccdb_up/tools/parse_kkr_namacon.py(9月の material_kkr_namacon_r8_09.csv を作ったもの)と同じ。
その parse_page をここに写し(左端 X0=363.0 の直しを含む)、行の組み立ては v1 の build_obs.py と migrate_v1.py の変換をそのまま写した。
  - 地区の列: 見出し語(地区名、2 段のことがある)の中心 x で束ねる
  - 値の列割り当て: 値は右寄せなので、値の中心と見出し中心のずれ(頁ごとの中央値)を引いてから最近傍。6pt を超えたら止める
  - 県(群)の割り当て: 群ラベルの中心 = その群の連続した列の両端の中点、を総当たりで探す。誤差が 4pt を超えたら止める
  - 空欄は行を作らない(9月の v1 と同じ約束。空欄 = この地区にこの表の値が無い。0 円ではない)
  - 奈良の列だけ、別表-2 の地区番号と文言を area_code / area_members に入れる(v1 と同じ)。原本の別表-1・-2(PDF 3〜7 頁)の文字が
    9月の原本と同じであることを確かめてから使う
  - jccdb_v4_item_id は JCCDB v4(/home/claude/jccdb の jccdb-v4-full.csv と jccdb-v4-provenance.csv)の品名で結ぶ(v1 と同じ)
照合: 頁ごとに pdftotext -layout の行で、生コンの行(「生コンクリート」を含む行)の数と bbox の行の数、各行の数の並びが一致すること。

使い方: python3 parse_kkr_namacon.py --month r8_10 [--out 出力.csv] [--check 照合.json] [--jccdb /home/claude/jccdb]
  r8_09 に当てると既存の material_kkr_namacon_r8_09.csv と同じもの(md5 一致)が出ることを確かめてある。
"""
import sys, os, re, csv, json, statistics, itertools, subprocess, hashlib, html, unicodedata, collections
HERE = os.path.dirname(os.path.abspath(__file__))
OBS2 = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(OBS2, "tools"))
from obs_common import make_id, pref, write_obs

NUM = re.compile(r"^\d{1,3}(,\d{3})+$")

MONTHS = {
    "r7_06": ("kkr-zairyo-r7-06", "2025-06", "07c79c0d1ad949c4ff3206ccb5b1049d1856aa484204d1267a6c915af553e9e0"),
    "r7_07": ("kkr-zairyo-r7-07", "2025-07", "90a7489068e70b2d9951497b06d70a547b465d4b511cdd1d4d57cc899048cec9"),
    "r8_01": ("kkr-zairyo-r8-01", "2026-01", "c7ad8a76b17067b49046be8c96c9a2b23ec38ea70f371713ca2db0a8dcb9d8fd"),
    "r8_04": ("kkr-zairyo-r8-04", "2026-04", "92e35f0663e09bca28456c5d105d728b17734c38e58e7e9accbc7f2502b7bc22"),
    "r8_09": ("kkr-zairyo-r8-09", "2026-09", "07691505e9319935539a58bb33ed74ca2e3d749b12753eb87c83333690e22886"),
    "r8_10": ("kkr-zairyo-r8-10", "2026-10", "82538ace3f1f9da28e4acdbf0dc1e875d46da91afbb12da23e652e5ac75701bd"),
}

# 近畿地整 別表-2 の奈良県の地区(原本の文言のまま。v1 build_obs.py の KKR_NARA と同じ)
KKR_NARA = {
    "生駒市他": ("61", "生駒市、奈良市（旧月ヶ瀬村、旧都祁村除く）、大和郡山市、天理市、香芝市、桜井市、大和高田市、橿原市、御所市、葛城市、高市郡（高取町、明日香村）、磯城郡（川西町、田原本町、三宅町）、生駒郡（安堵町、斑鳩町、三郷町、平群町）、北葛城郡（王寺町、河合町、上牧町、広陵町）、吉野郡（大淀町、吉野町、下市町）"),
    "奈良市他 / 旧都祁村他": ("62", "奈良市（旧月ヶ瀬村、旧都祁村）、山辺郡山添村、宇陀市、吉野郡（東吉野村）"),
    "宇陀郡": ("63", "宇陀郡（曽爾村、御杖村）"),
    "五條市他 / 旧大塔村他": ("64", "五條市（旧西吉野村、旧大塔村）、吉野郡（黒滝村、天川村、野迫川村）"),
    "吉野郡 / 川上村": ("65", "吉野郡（川上村）"),
    "吉野郡 / 十津川村": ("66", "吉野郡（十津川村）"),
    "吉野郡 / 上北山村他": ("67", "吉野郡（上北山村）"),
    "竹筒": ("68", "［特定地］竹筒地区（吉野郡十津川村）"),
    "五條市 / 旧五條市": ("69", "五條市（旧西吉野村、旧大塔村除く）"),
}
KKR_GROUP_PREF = {"福井": "福井県", "滋賀": "滋賀県", "京都北部": "京都府", "京都南部": "京都府", "大阪": "大阪府",
                  "兵庫": "兵庫県", "兵庫北部": "兵庫県", "兵庫西部": "兵庫県", "奈良": "奈良県", "和歌山": "和歌山県",
                  "三重": "三重県", "岐阜": "岐阜県"}
NOTE = "近畿地整が独自調査で設定した単価(物価資料に載っていない地区・規格だけ)。消費税抜き。"


def opt(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def words_of(pdf, first, last):
    out = subprocess.run(["pdftotext", "-bbox-layout", "-f", str(first), "-l", str(last), pdf, "-"],
                         capture_output=True, text=True, check=True).stdout
    pages = out.split("<page ")[1:]
    res = []
    for pg in pages:
        ws = re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', pg)
        res.append([(float(a), float(b), float(c), float(d), html.unescape(w)) for a, b, c, d, w in ws])
    return res


def cluster(xs, tol):
    xs = sorted(xs, key=lambda t: t[0])
    groups = []
    for x in xs:
        if groups and abs(x[0] - statistics.mean(g[0] for g in groups[-1])) <= tol:
            groups[-1].append(x)
        else:
            groups.append([x])
    return groups


def parse_page(ws, pageno):
    """v1 の parse_page(jccdb_up/tools/parse_kkr_namacon.py)と同じ。戻り値に行ごとの値の並び(照合用)を足した。"""
    if not any(w[4] == "生コンクリート" and w[1] < 40 for w in ws):
        return None
    head_y = min(w[1] for w in ws if w[4] == "品")
    data_ws = [w for w in ws if w[4] == "生コンクリート" and w[1] > head_y + 15]
    first_data_y = min(w[1] for w in data_ws)
    X0, X1 = 363.0, 731.0  # 左端の罫線は x=363.5。見出しの語は x0=364.4 から始まることがある
    labels = [w for w in ws if head_y - 12 < w[1] < head_y - 2 and X0 <= w[0] and w[2] <= X1 + 5]
    areas = [w for w in ws if head_y <= w[1] < first_data_y - 5 and X0 <= w[0] and w[2] <= X1 and w[4] not in ("単", "位")]
    cols = cluster([((w[0] + w[2]) / 2, w) for w in areas], 9.0)
    col_c = [statistics.mean(c for c, _ in g) for g in cols]
    col_name = [" / ".join(w[4] for _, w in sorted(g, key=lambda t: t[1][1])) for g in cols]
    labs = sorted([((w[0] + w[2]) / 2, w[4]) for w in labels])
    n, k = len(col_c), len(labs)
    best = None
    for cuts in itertools.combinations(range(1, n), k - 1):
        bounds = [0, *cuts, n]
        err = 0
        for i in range(k):
            a, b = bounds[i], bounds[i + 1] - 1
            err = max(err, abs((col_c[a] + col_c[b]) / 2 - labs[i][0]))
        if best is None or err < best[0]:
            best = (err, bounds)
    assert best and best[0] < 4.0, (pageno, "group split error", best, labs, col_name)
    group_of = {}
    for i in range(k):
        for c in range(best[1][i], best[1][i + 1]):
            group_of[c] = labs[i][1]
    rows = []
    ys = sorted(set(round(w[1], 1) for w in data_ws))
    raw_vals = []
    for y in ys:
        line = [w for w in ws if abs(w[1] - y) < 1.5]
        cement = " ".join(w[4] for w in line if 85 <= w[0] < 130)
        spec = " ".join(w[4] for w in sorted(line, key=lambda t: t[0]) if 130 <= w[0] < 340)
        unit = " ".join(w[4] for w in line if 340 <= w[0] < 365)
        note = " ".join(w[4] for w in sorted(line, key=lambda t: t[0]) if w[0] >= X1)
        vals = [w for w in line if X0 <= w[0] < X1 and NUM.match(w[4])]
        others = [w for w in line if X0 <= w[0] < X1 and not NUM.match(w[4])]
        assert not others, (pageno, y, others)
        raw_vals.append((y, cement, spec, unit, note, vals))
    offs = [((v[0] + v[2]) / 2) - min(col_c, key=lambda c: abs(c - (v[0] + v[2]) / 2 + 8.8)) for r in raw_vals for v in r[5]]
    off = statistics.median(offs) if offs else 8.8
    seqs = []
    for y, cement, spec, unit, note, vals in raw_vals:
        seqs.append([v[4] for v in sorted(vals, key=lambda t: t[0])])
        for v in vals:
            c = (v[0] + v[2]) / 2 - off
            j = min(range(n), key=lambda i: abs(col_c[i] - c))
            d = abs(col_c[j] - c)
            assert d < 6.0, (pageno, spec, v, col_name[j], d)
            rows.append({"page": pageno, "group": group_of[j], "area": col_name[j], "cement": cement or "普通(表記なし)",
                         "spec": spec, "unit": unit, "price_yen": int(v[4].replace(",", "")), "note": note,
                         "col_offset_pt": round(off, 2), "col_dist_pt": round(d, 2)})
    return rows, col_name, group_of, seqs, round(best[0], 2)


def layout_check(pdf, pageno, seqs):
    """別の読み方: pdftotext -layout の頁で「生コンクリート」を含む行を上から取り、行の中の桁区切りの数の並びを bbox の行と比べる。"""
    t = subprocess.run(["pdftotext", "-layout", "-f", str(pageno), "-l", str(pageno), pdf, "-"],
                       capture_output=True, text=True, check=True).stdout
    lrows = [[x for x in line.split() if NUM.match(x)] for line in t.split("\n") if "生コンクリート" in line.split()]
    # 頁の上の「種 別 生コンクリート」の行(数を持たない)は見出しなので除く
    lrows = lrows[1:] if lrows and not lrows[0] and len(lrows) == len(seqs) + 1 else lrows
    ok = sum(1 for a, b in zip(lrows, seqs) if a == b)
    return len(lrows), ok


def nfkc(s):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", s or "")).replace("‐", "-").replace("−", "-").replace("－", "-")


def load_v4_index(jccdb_dir):
    idx = {}
    for r in csv.DictReader(open(os.path.join(jccdb_dir, "jccdb-v4-provenance.csv"), encoding="utf-8-sig")):
        idx.setdefault((r["category"], nfkc(r["item_name"])), r["item_id"])
    names = {}
    for r in csv.DictReader(open(os.path.join(jccdb_dir, "jccdb-v4-full.csv"), encoding="utf-8")):
        names.setdefault(nfkc(r["item_name"]), r["category"])
    return idx, names


def main():
    month = opt("--month")
    sid, period, sha_want = MONTHS[month]
    pdf = os.path.join(OBS2, "raw", sid + ".pdf")
    out = opt("--out", os.path.join(OBS2, "observations", "jp", "material_kkr_namacon_%s.csv" % month))
    led = json.load(open(os.path.join(OBS2, "sources", sid + ".json"), encoding="utf-8"))
    sha = hashlib.sha256(open(pdf, "rb").read()).hexdigest()
    assert sha == sha_want == led["sha256"], ("原本の sha256 が違う", sha)
    # 別表-1・-2(PDF 3〜7 頁)の文字が 9月の原本と同じか(奈良の地区の文言を使う前提)
    ref = os.path.join(OBS2, "raw", "kkr-zairyo-r8-09.pdf")
    lay = lambda p: subprocess.run(["pdftotext", "-layout", "-f", "3", "-l", "7", p, "-"], capture_output=True, text=True, check=True).stdout
    beppyo_same = lay(pdf) == lay(ref)
    idx, names = load_v4_index(opt("--jccdb", "/home/claude/jccdb"))
    pages = words_of(pdf, 1, 60)
    obs, seen, checks = [], [], []
    for i, ws in enumerate(pages, 1):
        r = parse_page(ws, i)
        if not r:
            continue
        rows, col_name, group_of, seqs, split_err = r
        nl, nok = layout_check(pdf, i, seqs)
        checks.append({"page": i, "rows_bbox": len(seqs), "rows_layout": nl, "rows_equal": nok, "values": len(rows),
                       "group_split_err_pt": split_err, "max_col_dist_pt": max([x["col_dist_pt"] for x in rows] or [0]),
                       "groups": sorted(set(group_of.values()))})
        for x in rows:
            name = "生コンクリート " + x["spec"] + ("" if x["cement"].startswith("普通") else " " + x["cement"])
            if x["group"] == "奈良":
                assert beppyo_same, "別表が 9月と違うので奈良の地区の文言を使えない"
                code, members = KKR_NARA.get(x["area"], ("", ""))
            else:
                code, members = "", ""
            cat = names.get(nfkc(name))
            gc, gn = pref(KKR_GROUP_PREF[x["group"]])
            obs.append({
                "obs_id": make_id(sid, str(x["page"]), x["group"], x["area"], x["cement"], x["spec"]),
                "country": "JP", "layer": "material", "category": "生コンクリート・モルタル", "item_name": "生コンクリート",
                "spec": (x["cement"] + " " if not x["cement"].startswith("普通") else "") + x["spec"] + (" [" + x["note"] + "]" if x["note"] else ""),
                "unit": "m3", "geo_level": "bureau_area", "geo_code": gc, "geo_name": gn,
                "area_label": x["group"] + " " + x["area"], "area_code": code, "area_members": members,
                "price": str(x["price_yen"]), "currency": "JPY", "price_basis": "design_unit_price_ex_tax",
                "price_status": "published_pdl", "ref_value": "", "ref_note": "",
                "period": period, "effective_from": led.get("effective_from", ""), "source_id": sid, "source_page": str(x["page"]),
                "evidence_url": led["url"], "license": led["license"],
                "jccdb_v4_item_id": idx.get((cat, nfkc(name)), "") if cat else "",
                "note": NOTE})
    n = write_obs(out, obs)
    rep = {"month": month, "source_id": sid, "pdf_sha256": sha, "rows": n, "pages": [c["page"] for c in checks],
           "rows_bbox": sum(c["rows_bbox"] for c in checks), "rows_layout": sum(c["rows_layout"] for c in checks),
           "rows_equal": sum(c["rows_equal"] for c in checks),
           "max_col_dist_pt": max(c["max_col_dist_pt"] for c in checks),
           "max_group_split_err_pt": max(c["group_split_err_pt"] for c in checks),
           "beppyo_same_as_r8_09": beppyo_same,
           "linked_v4": sum(1 for o in obs if o["jccdb_v4_item_id"]), "per_page": checks}
    print(json.dumps({k: v for k, v in rep.items() if k != "per_page"}, ensure_ascii=False))
    if opt("--check"):
        json.dump(rep, open(opt("--check"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
