# -*- coding: utf-8 -*-
"""
HUD「2024 UNIT TOTAL DEVELOPMENT COST (TDC) LIMITS」(公営住宅の 1 戸あたり総開発費の上限、PDF 88 頁、
https://www.hud.gov/sites/dfiles/PIH/documents/2024_Units_TDC_Limits.pdf)を読み、
observations/us/cost_limit_hud_tdc_2024.csv と sources/hud-tdc-2024.json を作る。

原本の形: 各頁の上に「Number of Bedrooms 0〜6」、その下に寝室数ごとに HCC と TDC の 2 列(計 14 列)、その下に想定面積
(500 / 700 / 900 / 1200 / 1500 / 1700 / 1900 sqft)。本文は Region(x≒19)> 州(x≒21)> 地域(x≒34)> 構造(x≒46: Detached/Semi-Detached,
Row House, Walkup, Elevator)で、構造の行の 3pt 下に 14 個の数の行がある。
読み方: pdftotext -bbox-layout の語の座標で、数を頁ごとの見出し(HCC/TDC の 14 語)の x 中心に最も近い列に割り当てる。
全セルで見出しとの x 中心の距離を測り、最大値を出力する。別の読み方として pdftotext -layout の行を空白で区切った数の並びと
bbox で組んだ行の数の並びを全行で突き合わせる。
照合: 地域ごとに 4 構造がそろうこと、1 行 14 個、TDC ÷ HCC の比(構造ごとの一定値かどうか)を全セルで数える。
"""
import os, re, sys, json, subprocess, hashlib, collections

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from obs_common import make_id, num, write_obs, US_STATES

SID = "hud-tdc-2024"
PDF = os.path.join(ROOT, "raw", SID + ".pdf")
URL = "https://www.hud.gov/sites/dfiles/PIH/documents/2024_Units_TDC_Limits.pdf"
OUT = os.path.join(ROOT, "observations", "us", "cost_limit_hud_tdc_2024.csv")
LIC = "US-PD-17USC105"
STRUCTS = ["Detached/Semi-Detached", "Row House", "Walkup", "Elevator"]
NAME2FIPS = {v.upper(): k for k, v in US_STATES.items()}
NAME2FIPS["VIRGIN ISLANDS"] = "78"
WORD = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>')
NUMRE = re.compile(r"^\d{1,3}(,\d{3})+$|^\d+$")


def pages_words():
    html = subprocess.run(["pdftotext", "-bbox-layout", PDF, "-"], capture_output=True, text=True, check=True).stdout
    out = []
    for pg in html.split("<page ")[1:]:
        ws = [(float(a), float(b), float(c), float(d), t.replace("&amp;", "&")) for a, b, c, d, t in WORD.findall(pg)]
        out.append(ws)
    return out


def lines_of(ws):
    lines = collections.defaultdict(list)
    for x0, y0, x1, y1, t in ws:
        lines[round(y0)].append((x0, x1, t))
    return [(y, sorted(lines[y])) for y in sorted(lines)]


def main():
    pw = pages_words()
    obs = []
    maxdist = 0.0
    cells = 0
    region = state = loc = None
    locs = collections.OrderedDict()
    numline_seq = []
    ratio = collections.defaultdict(collections.Counter)
    for pi, ws in enumerate(pw, start=1):
        L = lines_of(ws)
        # 見出し: HCC/TDC の行と sqft の行
        hdr = [l for y, l in L if [t for _, _, t in l].count("HCC") == 7 and [t for _, _, t in l].count("TDC") == 7]
        assert len(hdr) == 1, pi
        cols = [((a + b) / 2, t) for a, b, t in hdr[0]]
        sq = [l for y, l in L if [t for _, _, t in l].count("sqft") == 7]
        assert len(sq) == 1, pi
        sqft = [t for _, _, t in sq[0] if t != "sqft"]
        bed = [l for y, l in L if [t for _, _, t in l] == ["0", "1", "2", "3", "4", "5", "6"]]
        assert len(bed) == 1, pi
        pend = None  # 直前の構造の行 (y, 名前)
        for y, l in L:
            x0 = l[0][0]
            words = [t for _, _, t in l]
            text = " ".join(words)
            if y < 100:
                continue
            if text.startswith("Report Title") or text.startswith("Printed on") or text.startswith("HUDPIH"):
                continue
            if all(NUMRE.match(t) for t in words) and x0 > 140:
                assert pend is not None and 0 < y - pend[0] <= 6, (pi, y, pend, text)
                assert len(l) == 14, (pi, y, text)
                vals = {}
                for a, b, t in l:
                    c = (a + b) / 2
                    j = min(range(14), key=lambda k: abs(cols[k][0] - c))
                    dist = abs(cols[j][0] - c)
                    maxdist = max(maxdist, dist)
                    assert j not in vals, (pi, y, text)
                    vals[j] = int(num(t))
                    cells += 1
                numline_seq.append([vals[j] for j in range(14)])
                locs[(state, loc)].append(pend[1])
                for bi in range(7):
                    hcc, tdc = vals[2 * bi], vals[2 * bi + 1]
                    assert cols[2 * bi][1] == "HCC" and cols[2 * bi + 1][1] == "TDC"
                    ratio[pend[1]][round(tdc / hcc, 3)] += 1
                    for kind, v in (("HCC", hcc), ("TDC", tdc)):
                        obs.append({
                            "obs_id": make_id(SID, state, loc, pend[1], bi, kind),
                            "country": "US", "layer": "cost_limit",
                            "category": "2024 UNIT TOTAL DEVELOPMENT COST (TDC) LIMITS",
                            "item_name": kind,
                            "spec": "%s; Number of Bedrooms %d; %s sqft" % (pend[1], bi, sqft[bi]),
                            "unit": "USD per dwelling unit",
                            "geo_level": "city", "geo_code": NAME2FIPS[state], "geo_name": US_STATES[NAME2FIPS[state]],
                            "area_label": loc, "area_code": "",
                            "price": str(v), "currency": "USD",
                            "price_basis": "tdc_limit_usd" if kind == "TDC" else "hcc_limit_usd",
                            "price_status": "public_domain",
                            "period": "2024", "source_id": SID, "source_page": str(pi), "evidence_url": URL, "license": LIC,
                            "note": "%s / %s。HUD 公営住宅の 1 戸あたり上限(HCC = Housing Construction Cost、TDC = Total Development Cost)。HCC は HUD が 2 つの民間建設費指数(R.S. Means, Marshall & Swift)の平均から算定(24 CFR 905.314)" % (region, state),
                        })
                pend = None
                continue
            if x0 < 20.5 and words[0] == "Region":
                region = text
            elif 20.5 <= x0 < 30:
                assert text in NAME2FIPS, (pi, text)
                state = text
            elif 30 <= x0 < 40:
                loc = text
                locs.setdefault((state, loc), [])
            elif 40 <= x0 < 60:
                assert text in STRUCTS, (pi, text)
                pend = (y, text)
            else:
                raise SystemExit("unexpected line p%d y%d: %s" % (pi, y, text))
    obs.sort(key=lambda o: (o["geo_code"], o["area_label"], STRUCTS.index(o["spec"].split(";")[0]), o["spec"], o["item_name"]))
    write_obs(OUT, obs)
    # 照合 1: 地域ごとに 4 構造がこの順でそろう
    bad = {"%s/%s" % k: v for k, v in locs.items() if v != STRUCTS}
    # 照合 2: pdftotext -layout の数の並び
    lay = subprocess.run(["pdftotext", "-layout", PDF, "-"], capture_output=True, text=True, check=True).stdout
    lay_seq = []
    for line in lay.splitlines():
        toks = line.split()
        nums = [t for t in toks if NUMRE.match(t)]
        if len(nums) == 14 and any(t in line for t in ("Detached", "Row House", "Walkup", "Elevator")):
            lay_seq.append([int(num(t)) for t in nums])
    same = sum(1 for a, b in zip(lay_seq, numline_seq) if a == b)
    checks = collections.OrderedDict([
        ("pages", len(pw)), ("localities", len(locs)), ("structure_rows", len(numline_seq)), ("cells", cells),
        ("rows_written", len(obs)), ("max_x_center_distance_pt", round(maxdist, 2)),
        ("localities_not_4_structures", bad),
        ("layout_rows", len(lay_seq), ), ("layout_rows_equal_bbox_rows", same),
        ("states", sorted({k[0] for k in locs})),
        ("tdc_over_hcc_ratio_by_structure", {k: dict(v) for k, v in ratio.items()}),
    ])
    json.dump(checks, open(os.path.join(ROOT, "tools", "parsers", "out", "hud_tdc_2024_checks.json"), "w"), ensure_ascii=False, indent=1)
    b = open(PDF, "rb").read()
    rt = checks["tdc_over_hcc_ratio_by_structure"]
    led = collections.OrderedDict([
        ("source_id", SID), ("country", "US"),
        ("title", "2024 Unit Total Development Cost (TDC) Limits (Public Housing; HCC and TDC by locality, structure type and number of bedrooms)"),
        ("publisher", "U.S. Department of Housing and Urban Development, Office of Public and Indian Housing, Office of Capital Improvements"),
        ("url", URL), ("landing", "https://www.hud.gov/helping-americans/public-indian-housing-capfund"),
        ("retrieved_at", "2026-09-26"), ("published", "2024-11-13"),
        ("http_last_modified", "Tue, 24 Dec 2024 16:04:08 GMT(ETag \"11caeb-62a06435a6241\")"),
        ("bytes", len(b)), ("sha256", hashlib.sha256(b).hexdigest()),
        ("fetched_via", "Apify apify/web-fetch(formats raw、application/pdf を base64)。bytes が contentLength と一致、先頭 %PDF-1.7、88 頁(Microsoft Access の報告、Report Title : TDC for all building types-11/5/2024 10:32:04 AM、Printed on : 11/13/2024、HUDPIH-516391410-425 Last Updated 11/13/2024)"),
        ("version_note", "Office of Capital Improvements の頁(2026-09-26 取得)の Total Development Cost Limits (TDCs) の一覧は 2024 が最新(2018〜2024)。https://www.hud.gov/sites/dfiles/PIH/documents/2025_Units_TDC_Limits.pdf は 404"),
        ("license", LIC), ("license_url", "https://www.law.cornell.edu/uscode/text/17/105"),
        ("license_quote", "Copyright protection under this title is not available for any work of the United States Government, but the United States Government is not precluded from receiving and holding copyrights transferred to it by assignment, bequest, or otherwise. (17 U.S.C. 105(a), https://www.law.cornell.edu/uscode/text/17/105) / HUD's Web Publication Procedures and Style Guide (https://www.hud.gov/sites/documents/webpubstandards.pdf, 8/27/2025, Apify で取得、raw/hud-webpubstandards-20250827.pdf sha256 a3c7695daad70e117c64d3522fe4855e1689ccde744e7dbe88258e7cecdf12f8), p.1: \"D. Copyrights and Attribution: As a rule, all content--including written materials and graphics--on HUD's Internet websites is in the public domain. Anyone can use or link to any material written or created for HUD's Internet websites.\" / \"2. If an organization publishes written materials reprinted from outside sources, the Web Manager must have written authorization from the holder of the copyright to publish the materials on HUD's website and the copyright must be noted on each page of the material.\" (この PDF の 88 頁に著作権の表示は無い)"),
        ("attribution", "Source: U.S. Department of Housing and Urban Development, 2024 Unit Total Development Cost (TDC) Limits, %s, accessed on September 26, 2026" % URL),
        ("scope_quote", "24 CFR 905.314(c)(2)(i) (eCFR, current): HUD will first determine the applicable \u201cconstruction cost guideline\u201d by averaging the current construction costs as listed in two nationally recognized residential construction cost indices for publicly bid construction of a good and sound quality for specific bedroom sizes and structure types. The two indices HUD will use for this purpose are the R.S. Means cost index for construction of \u201caverage\u201d quality and the Marshall & Swift cost index for construction of \u201cgood\u201d quality. ... (iii) Step 3: Elevator and nonelevator type structures. HUD will then multiply the resulting amounts from step 2 by 1.6 for elevator type structures and by 1.75 for nonelevator type structures."),
        ("publication_based_judgment", "HCC は HUD が 2 つの民間建設費指数の平均から算定した HUD 自身の上限額で、指数の値そのものを写した表ではない(表に市販資料の値である旨の表示も著作権表示も無い)。AGENT_RULES 3 の『市販の物価資料とその値を写した表』には当たらないと判断して値を入れた。所有者の判断で閉じる場合は parser の price_status を publication_based_not_public に替える"),
        ("how_read", "tools/parsers/parse_hud_tdc.py。pdftotext -bbox-layout の語の座標で読む。頁ごとの見出し(HCC/TDC 14 語)の x 中心に数を割り当て、全 %d セルで見出しとの距離の最大 %.2f pt(列の間隔は約 45 pt)。"
                     "Region(x≒19)> 州(x≒21)> 地域(x≒34)> 構造(x≒46)の字下げで区切り、構造の行の 3 pt 下の 14 個の数の行を組にした。%d 地域 x 4 構造 = %d 行(全地域で 4 構造がこの順にそろう)、x 7 寝室数 x HCC/TDC = %d 行。"
                     "照合: pdftotext -layout の数の行 %d 行と bbox で組んだ行の数の並びが %d 行で一致。TDC ÷ HCC は Detached/Semi-Detached・Row House・Walkup で全セル 1.75、Elevator で全セル 1.6(小数 3 桁、24 CFR 905.314(c)(2)(iii) の係数どおり)。"
                     "地域は州の中の HUD の地域名(原本の大文字のまま area_label に)。geo_level city、geo_code は州 FIPS 2 桁。" % (
                         checks["cells"], checks["max_x_center_distance_pt"], checks["localities"], checks["structure_rows"], checks["rows_written"],
                         checks["layout_rows"], checks["layout_rows_equal_bbox_rows"])),
        ("values_copied", True),
    ])
    json.dump(led, open(os.path.join(ROOT, "sources", SID + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps(checks, ensure_ascii=False, indent=1))
    return checks


if __name__ == "__main__":
    main()
