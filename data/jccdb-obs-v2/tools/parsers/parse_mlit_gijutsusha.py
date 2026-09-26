# -*- coding: utf-8 -*-
"""
国交省「設計業務委託等技術者単価」(各年度の PDF、別表) から、職種(職階)別の基準日額と割増対象賃金比を取り出し、観測層 v2 の CSV にする。

表は4群(①設計業務 ②測量業務 ③航空・船舶関係(平成21〜?年度は③航空関係) ④地質業務)で、各群に
『技術者の職種 / 基準日額（円） / 割増対象賃金比(%)』の見出しと職種の行がある。
  1. 語の座標(pdftotext -bbox-layout)で読む: 群の見出し(①〜④)と列の見出しの y を目印に、その下の行を拾う。
     値は、見出し『基準日額（円）』『割増対象賃金比(%)』のどちらに近いかで列に入れ、見出し中心との距離を全セルで測る。
  2. 別の読み方: pdftotext -layout の行を正規表現(職種名 値 比率)で読み、1 と全セル一致するかを数える。
  3. ＜山括弧＞付きの値(令和3・4年度)は印として持つ(原本の注の文言を note に)。

使い方: python3 parse_mlit_gijutsusha.py <year_key>   (r8 r7 ... r2 h31 h30 ... h21)
入力: OBS2/raw/mlit-gijutsusha-<y>.pdf と OBS2/sources/mlit-gijutsusha-<y>.json
出力: OBS2/observations/jp/labor_mlit_gijutsusha_<y>.csv、照合の数字は tools/parsers/out/gijutsusha_<y>_check.json
"""
import os, re, sys, json, hashlib, subprocess, unicodedata, collections

HERE = os.path.dirname(os.path.abspath(__file__))
OBS2 = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(OBS2, "tools"))
sys.path.insert(0, HERE)
from obs_common import write_obs, make_id  # noqa: E402
from parse_mlit_roumu_hist import words_poppler, xc, yc  # noqa: E402

# period と effective_from。平成29年度以降は原本の本文に『3月1日より適用』『3月から適用』、平成26〜28年度は
# 国交省の一覧頁(tec/gyoumu_tanka.html)に『※H26.2より適用』等、平成21〜25年度は年度の単価で適用日の記載なし。
YEARS = {
    "r8": ("2026-03", "2026-03-01"), "r7": ("2025-03", "2025-03-01"), "r6": ("2024-03", "2024-03-01"),
    "r5": ("2023-03", "2023-03-01"), "r4": ("2022-03", "2022-03-01"), "r3": ("2021-03", "2021-03-01"),
    "r2": ("2020-03", "2020-03-01"), "h31": ("2019-03", "2019-03-01"), "h30": ("2018-03", "2018-03-01"),
    "h29": ("2017-03", "2017-03-01"), "h28": ("2016-02", "2016-02-01"), "h27": ("2015-02", "2015-02-01"),
    "h26": ("2014-02", "2014-02-01"), "h25": ("FY2013", ""), "h24": ("FY2012", ""), "h23": ("FY2011", ""),
    "h22": ("FY2010", ""), "h21": ("FY2009", ""),
}
VAL_RE = re.compile(r"^([<＜])?(\d{1,3}(?:,\d{3})+)([>＞])?$")
RATIO_RE = re.compile(r"^(\d{1,3})%?$")
GROUP_RE = re.compile(r"^[①②③④]\S+$")


def N(s):
    return unicodedata.normalize("NFKC", s)


def read_bbox(pages):
    """戻り値: rows [(group, job, value, bracket, ratio, page)], stats"""
    out, dists_v, dists_r, margins = [], [], [], []
    for pno, ws in enumerate(pages, 1):
        heads = sorted([w for w in ws if GROUP_RE.match(w[4]) and len(w[4]) < 12 and w[0] < 150], key=lambda w: w[1])
        if len(heads) < 4:
            continue
        for gi, g in enumerate(heads):
            y_end = heads[gi + 1][1] if gi + 1 < len(heads) else 1e9
            hdr = [w for w in ws if g[1] < w[1] < y_end and w[4] in ("技術者の職種", "基準日額（円）", "割増対象賃金比(%)")]
            H = {w[4]: w for w in hdr}
            assert len(H) == 3, (pno, g[4], [w[4] for w in hdr])
            hy = max(w[3] for w in hdr)
            cn, cv, cr = xc(H["技術者の職種"]), xc(H["基準日額（円）"]), xc(H["割増対象賃金比(%)"])
            body = [w for w in ws if hy < w[1] < y_end and w[0] > g[0] - 5]
            lines = collections.OrderedDict()
            for w in sorted(body, key=lambda w: (w[1], w[0])):
                key = next((k for k in lines if abs(k - yc(w)) < 2.5), None)
                lines.setdefault(key if key is not None else yc(w), []).append(w)
            for ly, lw in lines.items():
                vals = [w for w in lw if VAL_RE.match(w[4])]
                rats = [w for w in lw if RATIO_RE.match(w[4])]
                names = [w for w in lw if w not in vals and w not in rats]
                if not vals:
                    break  # 表の終わり(注や参考資料)
                assert len(vals) == 1 and len(rats) == 1, (pno, g[4], [w[4] for w in lw])
                v, r = vals[0], rats[0]
                # 値と比率が、それぞれ近い見出しの列にあるか(隣の見出しとの距離の差を余裕として測る)
                dv = abs(xc(v) - cv); dr = abs(xc(r) - cr)
                assert dv < abs(xc(v) - cr) and dv < abs(xc(v) - cn), (pno, v)
                assert dr < abs(xc(r) - cv), (pno, r)
                dists_v.append(dv); dists_r.append(dr)
                margins.append(min(abs(xc(v) - cr), abs(xc(v) - cn)) - dv)
                margins.append(abs(xc(r) - cv) - dr)
                name = "".join(w[4] for w in sorted(names, key=lambda w: w[0])).replace(" ", "").replace("　", "")
                m = VAL_RE.match(v[4])
                out.append((g[4], name, int(m.group(2).replace(",", "")), bool(m.group(1)), int(RATIO_RE.match(r[4]).group(1)), pno))
        break
    return out, {"max_value_to_header_center": round(max(dists_v), 2), "max_ratio_to_header_center": round(max(dists_r), 2),
                 "min_margin_to_other_header": round(min(margins), 2)}


def read_layout(pdf):
    """別の読み方: pdftotext -layout の行を正規表現で読む。"""
    t = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True).stdout.decode("utf-8", "replace")
    rows, group = [], None
    started = False
    for line in t.split("\n"):
        s = line.strip()
        if GROUP_RE.match(s):
            group = s; started = True
            continue
        if not started:
            continue
        m = re.match(r"^(\S+)\s+([<＜]?)(\d{1,3}(?:,\d{3})+)([>＞]?)\s+(\d{1,3})%?$", s)
        if m and group:
            rows.append((group, m.group(1), int(m.group(3).replace(",", "")), bool(m.group(2)), int(m.group(5))))
        elif s.startswith("【参考資料】"):
            break
    return rows, t


def main():
    y = sys.argv[1]
    sid = "mlit-gijutsusha-" + y
    period, eff = YEARS[y]
    pdf = os.path.join(OBS2, "raw", sid + ".pdf")
    led = json.load(open(os.path.join(OBS2, "sources", sid + ".json"), encoding="utf-8"))
    assert hashlib.sha256(open(pdf, "rb").read()).hexdigest() == led["sha256"], "原本の sha256 が台帳と違う"
    rows, st = read_bbox(words_poppler(pdf))
    lay, text = read_layout(pdf)
    a = [(g, j, v, b, r) for g, j, v, b, r, p in rows]
    same = sum(1 for x, z in zip(a, lay) if x == z)
    check = {"year": y, "rows_bbox": len(a), "rows_layout": len(lay), "bbox_eq_layout": same, **st,
             "groups": dict(collections.Counter(g for g, *_ in a))}
    if len(a) != len(lay) or same != len(a):
        print(json.dumps(check, ensure_ascii=False))
        for x, z in zip(a, lay):
            if x != z:
                print("DIFF", x, z)
        sys.exit("座標の読みと -layout の読みが一致しない。取り込まない。")
    flat = re.sub(r"\s+", "", N(text))
    brnote = re.search(r"注\)<>書きは、.*?。", flat)
    if any(b for *_, b, _r, _p in [(g, j, v, b, r, p) for g, j, v, b, r, p in rows]):
        assert brnote, "山括弧があるのに注が取れない"
    out = []
    for g, j, v, b, r, p in rows:
        note = []
        if b:
            note.append("原本で山括弧書き。" + brnote.group(0))
        out.append({
            "obs_id": make_id(sid, g, j), "country": "JP", "layer": "labor",
            "category": "設計業務委託等技術者単価 " + g, "item_name": j,
            "spec": "基準日額(所定労働時間内8時間当たり)", "unit": "人日",
            "geo_level": "national", "geo_code": "JP", "geo_name": "日本",
            "price": str(v), "currency": "JPY", "price_basis": "engineer_daily_rate", "price_status": "published_pdl",
            "ref_value": str(r), "ref_note": "割増対象賃金比(%)。時間外・休日・深夜の割増賃金を積算するときに基準日額に掛ける比率(原本の同じ表)",
            "period": period, "effective_from": eff, "source_id": sid, "source_page": "p%d" % p,
            "evidence_url": led["url"], "license": led["license"], "jccdb_v4_item_id": "",
            "note": " ".join(note + ([] if eff else ["年度の単価(原本に適用開始日の記載なし)"]))})
    fn = os.path.join(OBS2, "observations", "jp", "labor_mlit_gijutsusha_%s.csv" % y)
    check["rows_written"] = write_obs(fn, out)
    check["bracket"] = sum(1 for x in rows if x[3])
    check["simple_avg_all"] = round(sum(x[2] for x in rows) / len(rows), 3)
    check["simple_avg_by_group"] = {g: round(sum(x[2] for x in rows if x[0] == g) / sum(1 for x in rows if x[0] == g), 3)
                                    for g in check["groups"]}
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    json.dump(check, open(os.path.join(HERE, "out", "gijutsusha_%s_check.json" % y), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps(check, ensure_ascii=False))


if __name__ == "__main__":
    main()
