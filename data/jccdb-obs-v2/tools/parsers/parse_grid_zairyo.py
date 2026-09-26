# -*- coding: utf-8 -*-
"""
国の地方機関の「材料単価【設計】」(土木工事設計材料単価表)を、罫線の格子とセルの座標で読み、観測層 v2 に書く。
対象: 九州地方整備局(qsr) / 東北地方整備局(thr) / 内閣府 沖縄総合事務局 開発建設部(ogb)。
使い方: python3 parse_grid_zairyo.py <qsr|thr|ogb> [--debug 出力.csv] [--check 照合結果.json]

読み方(tools/parsers/mlit_grid.py):
- 語は pdftotext -bbox-layout の座標。罫線の位置は pdfplumber(線の座標だけ)。
- 行 = 単位の列と値の列を横切る横罫線で区切った帯。列 = 縦罫線で区切ったセル。複数行にわたる規格は帯ごとにまとめる。
- 列見出し: 見出し帯の語で1つのセルに収まるもの(2段なら ' / ' でつなぐ)。県名の群ラベルは、ラベルの高さまで伸びる縦線で範囲を決める。
- 値: 値の列のセルの語。数1つなら値。空欄は行を作らない(物価資料の値を使う地区か、設定なし。原本はどちらか区別しない)。
- 「参考重量」の列は値ではない(note に書く)。
照合(このスクリプトの最後に数を出す):
- pdfplumber(pdfminer)の語で、値のセルの数字を別に数え、poppler の読みと (文字, 右端 x, 上端 y) の組で全件照合する。
- pdftotext -layout の頁ごとの数字の語の数と、bbox の頁ごとの数字の語の数が一致するか。
- 値の右端とセルの右罫線の距離、値の中心と列見出しの中心の距離の最大値。
"""
import sys, os, re, json, csv, collections, hashlib, unicodedata
HERE = os.path.dirname(os.path.abspath(__file__))
OBS2 = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(OBS2, "tools"))
from mlit_grid import poppler_pages, plumber_pages, layout_pages, parse_grid_page, is_num, cell_text, NUMTOK
from obs_common import make_id, clean, num, pref, write_obs

TAX_NOTE = "消費税の扱いは表に明記なし(国の積算の材料単価は税抜き)。"
CONF = {
    "qsr": {
        "source_id": "qsr-zairyo-r8-09", "pdf": "raw/qsr-zairyo-r8-09.pdf",
        "url": "https://www.qsr.mlit.go.jp/content/000002946.pdf",
        "license": "PDL1.0", "status": "published_pdl", "period": "2026-09", "effective_from": "2026-09-01",
        "out": "observations/jp/material_qsr_zairyo_r8_09.csv", "bureau": "九州地方整備局",
        "note": "九州地整が独自調査で設定した単価(物価資料に載っていない材料・地区だけ。空欄の地区は行を作らない)。",
        "area_pages": [3, 4],
    },
    "thr": {
        "source_id": "thr-zairyo-r8-04", "pdf": "raw_restricted/thr-zairyo-r8-04.pdf",
        "url": "https://www.thr.mlit.go.jp/bumon/b00097/k00910/h12-hp/html/rodo/tanka/R08_04_01tanka.pdf",
        "license": "restricted", "status": "published_restricted_not_copied", "period": "2026-04", "effective_from": "",
        "out": "observations/jp/material_thr_zairyo_r8_04.csv", "bureau": "東北地方整備局",
        "note": "東北地整は値を公開しているが、表に『全部または一部を無断で複製・転載…することを禁止』とあるため値を写さない。値は原本で見る。",
        "area_pages": [],
    },
    "ogb": {
        "source_id": "ogb-zairyo-r8-04", "pdf": "raw/ogb-zairyo-r8-04.pdf",
        "url": "https://www.ogb.go.jp/-/media/Files/OGB/Kaiken/kyoku/about/gikan/sekisan_roumushizai/roumu_shizai/R08/PDF_R0804_roumu_shizai_kensetu_1.pdf",
        "license": "PDL1.0", "status": "published_pdl", "period": "2026-04", "effective_from": "",
        "out": "observations/jp/material_ogb_zairyo_r8_04.csv", "bureau": "沖縄総合事務局",
        "note": "沖縄総合事務局開発建設部が市場取引価格を調査して設定した単価(物価資料に載っているものは載せていない)。",
        "area_pages": [],
    },
}

# フォントの都合で文字が取れない語(原本では読めるが、PDF の文字の対応表が無い)。値を作らない。
BAD_RANGES = [(0x0590, 0x1DFF), (0x2C00, 0x2E7F), (0xA000, 0xABFF), (0xE000, 0xF8FF), (0x2140, 0x214F)]


def garbled(s):
    return any(any(a <= ord(ch) <= b for a, b in BAD_RANGES) for ch in s)


PRICE_TOK = re.compile(r"^([\d,]+)円/(.+)$")


def machine_page(ws, pn):
    """東北地整 76頁『土木工事設計材料単価（土木機械設備工事）』(表の罫線が無い書式)を語の座標で読む。
    値の語(『121円/組』の形)ごとに、同じ高さの左側の語を規格、直前の節の見出しを品目にする。
    1節は『単価（東北地方）』『単価（関東地方）』の2列(見出しの x 範囲で決める)。ほかの節は頁末の注記『※特記なき事項は東北地方にて適用可能な単価とする。』により東北地方。"""
    lines = collections.OrderedDict()
    for w in sorted(ws, key=lambda t: (round(t[1]), t[0])):
        k = next((y for y in lines if abs(y - w[1]) < 2.5), None)
        lines.setdefault(k if k is not None else w[1], []).append(w)
    ys = sorted(lines)
    heads = {}
    for y in ys:
        for w in lines[y]:
            if w[4] in ("単価（東北地方）", "単価（関東地方）"):
                heads[w[4]] = w
    sec, sub = "", ""
    out = []
    for y in ys:
        ln = sorted(lines[y], key=lambda t: t[0])
        first = ln[0][4]
        m = re.match(r"^[１２３４５６７８９]．(.+)$", first)
        if m:
            sec, sub = m.group(1), ""
            continue
        prices = [w for w in ln if PRICE_TOK.match(w[4])]
        if not prices:
            if len(ln) == 1 and ln[0][0] < 90 and sec == "ボルト・ナット":
                sub = ln[0][4]
            continue
        for p in prices:
            left = [w for w in ln if w[2] < p[0] - 3 and not PRICE_TOK.match(w[4])]
            right = [w for w in ln if w[0] > p[2] + 3 and not PRICE_TOK.match(w[4]) and not re.match(r"^[\d.]+kg/", w[4])]
            unit = PRICE_TOK.match(p[4]).group(2)
            area = "東北地方"
            if "単価（関東地方）" in heads:
                hk, ht = heads["単価（関東地方）"], heads["単価（東北地方）"]
                cx = (p[0] + p[2]) / 2
                if abs(cx - (hk[0] + hk[2]) / 2) < abs(cx - (ht[0] + ht[2]) / 2) and sec == "ボルト・ナット":
                    area = "関東地方"
            name = " ".join(w[4] for w in left)
            if sec.startswith("投込み式水位計"):
                item, spec = name, sec
            elif sec == "ボルト・ナット":
                item, spec = sub or sec, name
            else:
                item, spec = sec, name
            ext = " ".join(w[4] for w in right if w[0] < 300)
            out.append({"item": item, "spec": spec + (" [" + ext + "]" if ext else ""), "unit": unit, "area": area,
                        "value": PRICE_TOK.match(p[4]).group(1), "w": p})
    return out


def area_table_qsr(P, pages):
    """九州の別表『地区割り一覧表』: 左右2段。地区名称の列の語で行を作り、同じ段の適用市町村名(続きの行も)をつなぐ。"""
    res = collections.OrderedDict()
    order = []
    for pn in pages:
        ws = P[pn - 1]
        heads = [w for w in ws if w[4] == "地区名称"]
        for h in heads:
            pass
        halves = [(80.0, 125.0, 125.0, 391.4), (437.2, 481.7, 481.7, 759.1)]  # (地区名称 x0,x1, 市町村 x0,x1) 罫線の位置
        for a0, a1, m0, m1 in halves:
            names = sorted([w for w in ws if a0 - 2 <= w[0] and w[2] <= a1 + 2 and w[4] not in ("地区名称",)], key=lambda t: t[1])
            mem = sorted([w for w in ws if m0 - 2 <= w[0] and w[2] <= m1 + 2 and w[4] not in ("適", "用", "市", "町", "村", "名")],
                         key=lambda t: (t[1], t[0]))
            stop = min([w[1] for w in names if w[4].startswith("注") or w[4].startswith("※")] + [9999])
            names = [w for w in names if w[1] < stop - 1]
            cur = None
            rows = []
            for w in names:
                rows.append([w, []])
            for w in mem:
                if w[1] >= stop - 1 or re.match(r"^※(平成|市況)", w[4]):
                    continue
                # その語の高さに地区名があればその行、無ければ直前の行の続き
                best = None
                for r in rows:
                    if abs((r[0][1] + r[0][3]) / 2 - (w[1] + w[3]) / 2) < 3.0:
                        best = r
                if best is None:
                    prev = [r for r in rows if r[0][1] < w[1]]
                    best = prev[-1] if prev else None
                if best is None:
                    continue
                best[1].append(w)
            for nw, mws in rows:
                txt = cell_text(mws, m1)  # セルの幅で折り返した行は空白を入れずにつなぐ
                res[nw[4]] = txt
                order.append((pn, nw[4]))
        # 表の下の注記(注）１．… / 注）２．…)を、本文の『※注）１』の後ろに [ ] で添える
        lines = collections.OrderedDict()
        for w in sorted([w for w in ws if w[0] >= 80 and w[2] <= 760], key=lambda t: (round(t[1]), t[0])):
            k = next((y for y in lines if abs(y - w[1]) < 2.0), None)
            lines.setdefault(k if k is not None else w[1], []).append(w)
        cur, notes = None, {}
        for y in sorted(lines):
            t = " ".join(w[4] for w in sorted(lines[y], key=lambda t: t[0]))
            m = re.match(r"^注）([１２３４５６７８９])．\s*(.*)$", t)
            if m:
                cur = m.group(1); notes[cur] = m.group(2); continue
            if cur and not t.startswith("※"):
                notes[cur] += " " + t
            else:
                cur = None
        for k2, v in list(res.items()):
            for n, nt in notes.items():
                if "※注）" + n in v and "[注）" + n not in v:
                    res[k2] = v.replace("※注）" + n, "※注）%s [注）%s． %s]" % (n, n, nt.strip()))
    return res


def norm_area(s):
    return s.replace(" / ", "").replace("・", "").replace("諌", "諫").replace("狭", "挟")


def main():
    key = sys.argv[1]
    dbg = sys.argv[sys.argv.index("--debug") + 1] if "--debug" in sys.argv else None
    C = CONF[key]
    pdf = os.path.join(OBS2, C["pdf"])
    sha = hashlib.sha256(open(pdf, "rb").read()).hexdigest()
    P = poppler_pages(pdf)
    G = plumber_pages(pdf)
    L = layout_pages(pdf)
    areas = area_table_qsr(P, C["area_pages"]) if C["area_pages"] else {}
    areas_n = {norm_area(k): v for k, v in areas.items()}
    out, dbg_rows = [], []
    stats = collections.Counter()
    problems = []
    max_right, max_center = 0.0, 0.0
    area_pref = collections.defaultdict(set)
    area_unmatched = set()
    garbled_seen = collections.Counter()
    cross_mismatch = []
    layout_mismatch = []
    footers = collections.Counter()
    page_rows = {}
    parsed = {pn: parse_grid_page(ws, g, pn) for pn, (ws, g) in enumerate(zip(P, G), 1)}
    # 表の中の「※条件」(受取場所・荷造り費・支払い条件・消費税)は、同じ種別で同じ格子の、続きの頁に掛かる
    cond = {}
    for pn, r in parsed.items():
        if r and r.get("ok"):
            items = {row["item"]: row["spec"] for row in r["rows"] if not row["vals"]}
            if "消費税" in items:
                txt = "原本の※条件: " + "、".join("%s %s" % (k, items[k].rstrip("。")) for k in ("受取場所", "荷造り費", "支払い条件", "消費税") if k in items) + "。"
                sig = tuple(round(a) for a, b in r["cells"])
                q = pn
                while q in parsed and parsed[q] and parsed[q].get("ok") and parsed[q]["category"] == r["category"] \
                        and tuple(round(a) for a, b in parsed[q]["cells"]) == sig:
                    cond[q] = txt
                    q -= 1
    stats["pages_with_conditions"] = len(cond)
    for pn, (ws, g) in enumerate(zip(P, G), 1):
        r = parsed[pn]
        # 照合B: -layout の数字の語の数 = bbox の数字の語の数(頁全体)
        lay_n = sum(1 for t in L[pn - 1].split() if NUMTOK.match(t))
        box_n = sum(1 for w in ws if NUMTOK.match(w[4]))
        if lay_n != box_n:
            layout_mismatch.append((pn, lay_n, box_n))
        stats["layout_num_tokens"] += lay_n
        stats["bbox_num_tokens"] += box_n
        if r is None:
            stats["pages_not_table"] += 1
            if key == "thr" and any("土木機械設備工事" in w[4] for w in ws) and any(PRICE_TOK.match(w[4]) for w in ws):
                cat = "土木工事設計材料単価（土木機械設備工事）"
                for m in machine_page(ws, pn):
                    stats["machine_page_values"] += 1
                    oid = make_id(C["source_id"], pn, cat, m["item"], m["spec"], m["unit"], "", m["area"])
                    out.append({
                        "obs_id": oid, "country": "JP", "layer": "material", "category": cat, "item_name": m["item"],
                        "spec": m["spec"], "unit": m["unit"], "geo_level": "bureau_area", "geo_code": "", "geo_name": "",
                        "area_label": m["area"], "area_code": "", "area_members": "", "price": "", "currency": "JPY",
                        "price_basis": "design_unit_price_ex_tax", "price_status": C["status"], "period": C["period"],
                        "effective_from": C["effective_from"], "source_id": C["source_id"], "source_page": pn,
                        "evidence_url": C["url"], "license": C["license"],
                        "note": C["note"] + "企画部施工企画課の土木機械設備工事の単価(表の書式でない頁)。原本『*価格には消費税含まず』。",
                    })
                    if dbg is not None:
                        dbg_rows.append({"page": pn, "kind": "machine", "item": m["item"], "spec": m["spec"], "unit": m["unit"], "rem": m["area"]})
            continue
        if not r["ok"]:
            problems.append(("page_fail", pn, r["why"]))
            continue
        stats["pages_table"] += 1
        problems += r["problems"]
        cells = r["cells"]
        # 列の意味
        colinfo = {}
        for c in r["columns"]:
            head, groups = c["head"], c["groups"]
            gtxt = " ".join(groups)
            if not head:
                colinfo[c["cell"]] = ("empty", None, None, None)
            elif "参考重量" in head or "参考重量" in gtxt:
                colinfo[c["cell"]] = ("weight", pref(head)[0], None, head)
            elif re.match(r"^(北海道|.{2,3}[県府都])$", head) and pref(head)[0]:
                colinfo[c["cell"]] = ("pref", pref(head)[0], pref(head)[1], head)
            else:
                gp = [pref(x) for x in groups if pref(x)[0]]
                if len(gp) != 1:
                    problems.append(("area_without_pref", pn, head, groups))
                    colinfo[c["cell"]] = ("bad", None, None, head)
                    continue
                colinfo[c["cell"]] = ("area", gp[0][0], gp[0][1], head)
                area_pref[head].add(gp[0][1])
        ci = r["ci"]
        # 頁の下(表の外)の注記
        foot = " ".join(w[4] for w in sorted(r["footer"], key=lambda t: (round(t[1]), t[0])))
        foot = re.sub(r"-\s*\d+\s*-", " ", foot)
        foot = re.sub(r"\s+\d+\s*$", "", " " + foot).strip()
        if foot:
            footers[foot] += 1
        prev = {"item": "", "spec": "", "unit": ""}
        nrows_page = 0
        # 照合A 用: pdfplumber の語で値のセルの数字
        pl_words = g["words"]
        for row in r["rows"]:
            item, spec, unit, rem = row["item"], row["spec"], row["unit"], row["rem"]
            # 結合セル: 上の罫線が無い列は上の行の文字を引き継ぐ
            if not item and row["joined"].get(ci["item"]):
                item = prev["item"]
            if not unit and row["joined"].get(ci["unit"]):
                unit = prev["unit"]
            # 参考重量: 県ごとの列(県名の見出し)なら同じ県の値へ、1列だけ(見出しが「参考重量」)なら全部の値へ
            weight = {colinfo[i][1]: cell_text(v) for i, v in row["vals"].items() if colinfo.get(i, ("?",))[0] == "weight"}
            vals = {i: v for i, v in row["vals"].items() if colinfo.get(i, ("?",))[0] not in ("weight",)}
            if not vals:
                stats["rows_without_values"] += 1
                if item or spec:
                    dbg_rows.append({"page": pn, "kind": "row_no_values", "item": item, "spec": spec, "unit": unit, "rem": rem})
                prev = {"item": item, "spec": spec, "unit": unit}
                continue
            if not item or not unit:
                problems.append(("row_missing_item_or_unit", pn, item, spec, unit, {i: cell_text(v) for i, v in vals.items()}))
                continue
            prev = {"item": item, "spec": spec, "unit": unit}
            nrows_page += 1
            rem_note = ""
            if rem and garbled(rem):
                garbled_seen[rem] += 1
                rem_note = "備考欄の文字はフォントの都合で取れない(原本で見る)。"
                rem = ""
            for t in (item, spec, unit):
                if garbled(t):
                    problems.append(("garbled_text", pn, t))
            spec_full = spec + (" [" + rem + "]" if rem else "")
            for i, v in sorted(vals.items()):
                kind, gcode, gname, head = colinfo.get(i, ("none", None, None, None))
                txt = cell_text(v)
                if kind in ("empty", "none", "bad"):
                    problems.append(("value_in_unknown_column", pn, item, spec, txt, kind))
                    continue
                toks = txt.split()
                stats["cells_with_text"] += 1
                price, status, extra = "", C["status"], ""
                if len(toks) == 1 and is_num(toks[0]):
                    val = num(toks[0])
                    if float(val) == 0:
                        status = "not_set"
                        extra = "原本の値は 0。"
                        stats["zero_values"] += 1
                    elif C["status"] in ("published_pdl", "published_cc_by"):
                        price = val
                    # 距離
                    w = v[0]
                    a, b = cells[i]
                    max_right = max(max_right, abs(b - w[2]))
                    hws = [c for c in r["columns"] if c["cell"] == i][0]["head_ws"]
                    if hws:
                        hc = (min(x[0] for x in hws) + max(x[2] for x in hws)) / 2
                        max_center = max(max_center, abs((w[0] + w[2]) / 2 - hc))
                    stats["numeric_cells"] += 1
                else:
                    status = "not_set"
                    extra = "原本の値の欄は『%s』。" % txt
                    stats["text_cells"] += 1
                    dbg_rows.append({"page": pn, "kind": "text_value", "item": item, "spec": spec, "unit": unit, "rem": txt})
                if kind == "pref":
                    geo_level, area_label, members = "pref", head, ""
                else:
                    geo_level, area_label = "bureau_area", head
                    members = areas_n.get(norm_area(head), "")
                    if areas and not members:
                        area_unmatched.add(head)
                note = C["note"]
                if pn in cond:
                    note += cond[pn]
                else:
                    note += TAX_NOTE
                if foot:
                    note += "頁の注記: " + foot
                wv = weight.get(gcode) if gcode in weight else weight.get(None)
                if wv:
                    note += "参考重量(kg): %s。" % wv
                note += rem_note + extra
                layer = "work" if "工事費" in r["category"] else "material"
                basis = "work_unit_price_ex_tax" if layer == "work" else "design_unit_price_ex_tax"
                # 機械・機器の賃料/損料で単位が期間(日・月・時間)なら equipment
                per = unit.replace("･", "・").split("・")[-1]
                if re.search(r"(機器|機械).*(賃料|損料)", item) and per in ("日", "月", "h", "時間"):
                    layer = "equipment"
                    basis = {"日": "equipment_rate_daily", "月": "equipment_rate_monthly"}.get(per, "equipment_rate_hourly")
                oid = make_id(C["source_id"], pn, r["category"], item, spec_full, unit, gcode, area_label)
                out.append({
                    "obs_id": oid, "country": "JP", "layer": layer, "category": r["category"], "item_name": item,
                    "spec": spec_full, "unit": unit, "geo_level": geo_level, "geo_code": gcode, "geo_name": gname,
                    "area_label": area_label, "area_code": "", "area_members": members, "price": price, "currency": "JPY",
                    "price_basis": basis, "price_status": status, "period": C["period"],
                    "effective_from": C["effective_from"], "source_id": C["source_id"], "source_page": pn,
                    "evidence_url": C["url"], "license": C["license"], "note": note,
                })
                if dbg is not None:
                    dbg_rows.append({"page": pn, "kind": "value", "item": item, "spec": spec_full, "unit": unit,
                                     "rem": "%s|%s|%s" % (area_label, gname, txt)})
        page_rows[pn] = nrows_page
        # 照合A: pdfplumber の語で値のセルの数字を拾い、poppler の読みと比べる
        val_cells = [c["cell"] for c in r["columns"]]
        def pick(words):
            s = collections.Counter()
            for w in words:
                cy = (w[1] + w[3]) / 2
                cx = (w[0] + w[2]) / 2
                if not (r["y_first"] < cy < r["table_bottom"]):
                    continue
                for i in val_cells:
                    a, b = cells[i]
                    if a <= cx < b and NUMTOK.match(w[4]):
                        s[(w[4], round(w[2]), round(w[1]))] += 1
            return s
        sp, sq = pick(ws), pick(pl_words)
        # 丸めの境目で 1pt ずれることがあるので、同じ文字で x, y とも 1.5pt 以内なら同じ語とみなす
        lp = sorted(sp.elements())
        lq = sorted(sq.elements())
        unq = list(lq)
        miss = []
        for t in lp:
            hit = next((u for u in unq if u[0] == t[0] and abs(u[1] - t[1]) <= 1.5 and abs(u[2] - t[2]) <= 1.5), None)
            if hit is None:
                miss.append(t)
            else:
                unq.remove(hit)
        if miss or unq:
            cross_mismatch.append((pn, len(miss), len(unq), miss[:3], unq[:3]))
        stats["crosscheck_cells_poppler"] += len(lp)
        stats["crosscheck_cells_pdfminer"] += len(lq)
        stats["crosscheck_matched"] += len(lp) - len(miss)
    n = write_obs(os.path.join(OBS2, C["out"]), out)
    st = collections.Counter(o["price_status"] for o in out)
    report = {
        "source_id": C["source_id"], "pdf_sha256": sha, "rows_written": n, "by_status": dict(st),
        "by_layer": dict(collections.Counter(o["layer"] for o in out)),
        "stats": dict(stats), "problems": len(problems), "problem_samples": [str(p)[:300] for p in problems[:40]],
        "max_value_right_to_cell_right_pt": round(max_right, 2), "max_value_center_to_header_center_pt": round(max_center, 2),
        "crosscheck_pdfminer_mismatch_pages": cross_mismatch[:20], "layout_vs_bbox_mismatch_pages": layout_mismatch[:20],
        "area_pref_conflicts": {k: sorted(v) for k, v in area_pref.items() if len(v) > 1},
        "areas_in_table": len(areas), "areas_unmatched": sorted(area_unmatched),
        "garbled_remarks": dict(garbled_seen), "footers": dict(footers),
        "rows_per_page": page_rows,
    }
    print(json.dumps({k: v for k, v in report.items() if k not in ("rows_per_page",)}, ensure_ascii=False, indent=1))
    if "--check" in sys.argv:
        json.dump(report, open(sys.argv[sys.argv.index("--check") + 1], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    if dbg:
        with open(dbg, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["page", "kind", "item", "spec", "unit", "rem"])
            w.writeheader(); w.writerows(dbg_rows)
    if problems:
        sys.exit("problems: %d" % len(problems))


if __name__ == "__main__":
    main()
