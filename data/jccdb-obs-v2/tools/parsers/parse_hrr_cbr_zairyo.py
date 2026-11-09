# -*- coding: utf-8 -*-
"""
北陸地方整備局「土木工事設計材料単価(2026年9月単価)」と 中部地方整備局「土木工事設計材料単価表(令和8年10月1日以降適用)」を
観測層 v2 に取り込む。両局とも「材料単価【設計】」の同じ帳票(sekisan_layout.py)。値は pdftotext -bbox-layout の座標で読む。

使い方: python3 parse_hrr_cbr_zairyo.py hrr|cbr
       python3 parse_hrr_cbr_zairyo.py hrr [--month r8_09|r8_10|r8_11] [--out 出力.csv] [--summary 要約.json]
       python3 parse_hrr_cbr_zairyo.py cbr [--month r8_10|r8_11] [--out 出力.csv] [--summary 要約.json]
  hrr: 原本 OBS2/raw/hrr-zairyo-<月>.pdf(PDL1.0。値を入れる)。--month を省くと r8_09(9月、最初の取り込みと同じ動き)。
       月ごとに別の source_id・別のファイル(古い月の行は消さない)。原本は HRR_MONTHS の sha256 で固定し、
       各頁の見出しの年月が HRR_MONTHS の period と同じこと、表でない頁が表紙・説明・地区割り一覧表だけであることを確かめる。
       --out / --summary を渡すとそこに書く(古い月に当て直して md5 を比べるときに、既存のファイルを書き換えないため)。
       地区割り一覧表は同じ PDF の 2〜4 頁(地区番号・地区名・該当市町村名)
  cbr: 原本 OBS2/raw_restricted/cbr-zairyo-r8-10.pdf(PDF の 2 頁に「本単価表を無断転載・複写や電子媒体等に加工することを禁じます。」
       とあり、サイトの PDL1.0 の「権利表記の記載がない限り」に当たらないため、値は写さない。状態だけ)
       地区コード一覧表は別の PDF OBS2/raw/cbr-chikukubun.pdf(chikucode01.pdf)
       --month を省くと r8_10(最初の取り込みと同じ動き。出力は observations/jp/ のままなので、作ったら observations_restricted/ の物と比べる)。
       r8_11 からは CBR_MONTHS の out(observations_restricted/jp/)に直に書く。原本は CBR_MONTHS の sha256 で固定し、
       各頁の見出しの年月が period と同じこと、表紙と 2 頁の文字が cover と同じことを確かめる。
照合: 頁ごとに、-layout の本文で値の形の語(ASCII の数・「－」)を数え、bbox で列に割り当てた値の数と比べる。
"""
import sys, os, re, json, hashlib, collections, unicodedata
HERE = os.path.dirname(os.path.abspath(__file__))
OBS2 = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(OBS2, "tools"))
from sekisan_layout import words_of, layout_pages, parse_page, lines_of, NUM, DASH, nfkc
from obs_common import make_id, num, pref, write_obs, JP_CODE_PREF



def _opt(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


HRR_MONTHS = {
    # 9月: 最初の取り込み(2026-09-26 取得)
    "r8_09": {"sid": "hrr-zairyo-r8-09", "url": "https://www.hrr.mlit.go.jp/gijyutu/tannka/2026.9.pdf", "period": "2026-09",
              "sha": "4328997eb468f22185734e43b0f725e801872942d63855b7684645f112c5cf02",
              "summary": os.path.join(OBS2, "reports", "B2_hrr_parse_summary.json")},
    # 10月: 2026-10-04 取得
    "r8_10": {"sid": "hrr-zairyo-r8-10", "url": "https://www.hrr.mlit.go.jp/gijyutu/tannka/2026.10.pdf", "period": "2026-10",
              "sha": "a9c356653604a4d409b87e3ae9711f95a5d9aaf52685afd9ba00952bf43ac536",
              "summary": os.path.join(OBS2, "reports", "hrr_r8_10_parse_summary.json")},
    # 11月: 2026-11-02 取得(Apify、Last-Modified 2026-10-29)
    "r8_11": {"sid": "hrr-zairyo-r8-11", "url": "https://www.hrr.mlit.go.jp/gijyutu/tannka/2026.11.pdf", "period": "2026-11",
              "sha": "da760abbf951b9eee1bbcdd1206cfa646e5e2f36f1a92f467e4058072b486208",
              "summary": os.path.join(OBS2, "reports", "hrr_r8_11_parse_summary.json")},
}


def hrr_cfg(month):
    H = HRR_MONTHS[month]
    return {
        "sid": H["sid"],
        "pdf": os.path.join(OBS2, "raw", H["sid"] + ".pdf"),
        "url": H["url"],
        "out": os.path.join(OBS2, "observations", "jp", "material_hrr_zairyo_%s.csv" % month),
        "license": "PDL1.0", "status_value": "published_pdl", "copy_values": True,
        "effective_from": "",
        "note": "北陸地整が独自調査(特別調査)で設定した単価。物価資料に掲載のある材料は載っていない。税抜き(原本の注記)。",
        "month": month, "period": H["period"], "sha": H["sha"], "summary": H["summary"],
    }


CBR_NOTE = "中部地整が独自調査で設定した単価は原本に載っているが、原本に無断転載・複写・電子媒体への加工を禁じる表記があるため値は写さない。原本で見る。"
CBR_MONTHS = {
    # 10月: 最初の取り込み(2026-09-26 取得)。出力先は最初の取り込みと同じ observations/jp/(apply_decisions_20260926.py が observations_restricted/ へ移した)
    "r8_10": {"sid": "cbr-zairyo-r8-10", "url": "https://www.cbr.mlit.go.jp/architecture/kensetsugijutsu/unit_price/pdf/shizai202610.pdf",
              "period": "2026-10", "effective_from": "2026-10-01",
              "sha": "6f782fa5185eff907637c8f506755c229b455a44f863acb90a82af2cd565015c",
              "out": os.path.join(OBS2, "observations", "jp", "material_cbr_zairyo_r8_10.csv"),
              "summary": os.path.join(OBS2, "reports", "B2_cbr_parse_summary.json"),
              "cover": [(1, "令和８年１０月１日以降適用"), (2, "本単価表を無断転載・複写や電子媒体等に加工することを禁じます。")]},
    # 11月: 2026-10-26 取得(Apify、Last-Modified 2026-10-23)。行の一覧は公開の組み立てに入れないので observations_restricted/ に直に書く
    "r8_11": {"sid": "cbr-zairyo-r8-11", "url": "https://www.cbr.mlit.go.jp/architecture/kensetsugijutsu/unit_price/pdf/shizai202611.pdf",
              "period": "2026-11", "effective_from": "2026-11-01",
              "sha": "3a35cdaa484904c2b27ecf16f600da4f395f3c3c5c2d095375df8c00537e1075",
              "out": os.path.join(OBS2, "observations_restricted", "jp", "material_cbr_zairyo_r8_11.csv"),
              "summary": os.path.join(OBS2, "reports", "cbr_r8_11_parse_summary.json"),
              "cover": [(1, "令和８年１１月１日以降適用"), (2, "本単価表を無断転載・複写や電子媒体等に加工することを禁じます。")]},
}


def cbr_cfg(month):
    M = CBR_MONTHS[month]
    return {
        "sid": M["sid"],
        "pdf": os.path.join(OBS2, "raw_restricted", M["sid"] + ".pdf"),
        "url": M["url"],
        "area_pdf": os.path.join(OBS2, "raw", "cbr-chikukubun.pdf"),
        "out": M["out"],
        "license": "restricted", "status_value": "published_restricted_not_copied", "copy_values": False,
        "effective_from": M["effective_from"],
        "note": CBR_NOTE,
        "month": month, "period": M["period"], "sha": M["sha"], "summary": M["summary"], "cover": M["cover"],
    }


CFG = {
    "hrr": hrr_cfg("r8_09"),
    "cbr": cbr_cfg("r8_10"),
}
VALNUM = re.compile(r"^[0-9]{1,3}(,[0-9]{3})*(\.[0-9]+)?$|^[0-9]+\.[0-9]+$")  # ASCII の数字だけ(全角の規格の数字を数えない)


def hrr_area_table(pdf):
    """北陸: 2〜4 頁の地区割り一覧表。地区番号(2〜3桁) -> (県名, 地区名, 該当市町村名)"""
    pages = words_of(pdf, 2, 4)
    res, quote = {}, []
    for pi, ws in enumerate(pages, 2):
        hdr = [w for w in ws if w[4] == "地区番号"]
        y_h = hdr[0][1]
        codes = sorted([w for w in ws if 625 <= w[0] <= 660 and re.match(r"^\d{2,3}$", w[4]) and w[1] > y_h + 5], key=lambda t: t[1])
        names = [w for w in ws if w[0] >= 665 and w[1] > y_h + 5]
        ents = []
        for c in codes:
            nm = [n for n in names if abs(n[1] - c[1]) < 3]
            ents.append((c[4], min(n[1] for n in nm), "".join(n[4] for n in sorted(nm, key=lambda t: t[0]))))
        cur_pref = None
        for k, (code, y0, name) in enumerate(ents):
            y1 = ents[k + 1][1] - 2 if k + 1 < len(ents) else 10000
            band = [w for w in ws if y0 - 2 <= w[1] < y1 and not w[4].startswith("※") and w[0] >= 80]
            foot = [w for w in ws if w[4].startswith("※")]
            if foot:
                band = [w for w in band if w[1] < min(f[1] for f in foot) - 2]
                quote.append("".join(w[4] for w in sorted([w for w in ws if abs(w[1] - foot[0][1]) < 2], key=lambda t: t[0])))
            pw = [w for w in band if 135 <= w[0] < 168]
            if pw:
                cur_pref = "".join(w[4] for w in pw)
            mem = [w for w in band if 170 <= w[0] < 620]
            members = "".join("".join(w[4] for w in lw) for _, lw in lines_of(mem, 1.5))
            res[code] = {"pref": cur_pref, "name": name, "members": members, "page": pi}
    return res, sorted(set(quote))


def cbr_area_table(pdf):
    """中部: 地区コード一覧表(chikucode01.pdf)。数字3桁の地区コード -> (県, 地区名, 市町村名)"""
    pages = words_of(pdf)
    res, legend = {}, set()
    for pi, ws in enumerate(pages, 1):
        codes = sorted([w for w in ws if w[0] < 100 and re.match(r"^[０-９]{3}(岐阜|長野|静岡|愛知|三重|奈良|滋賀)$", w[4])], key=lambda t: t[1])
        for k, c in enumerate(codes):
            y1 = codes[k + 1][1] - 1 if k + 1 < len(codes) else 10000
            band = [w for w in ws if c[1] - 1 <= w[1] < y1 and w is not c]
            stop = [w for w in band if "県ｺｰﾄﾞ" in w[4] or w[4] in ("地区名",) or "単価未設定地区" in w[4]]
            if stop:
                band = [w for w in band if w[1] < min(s[1] for s in stop) - 1]
            name = "".join(w[4] for w in sorted([w for w in band if w[0] < 100], key=lambda t: (t[1], t[0])))
            mem = [w for w in band if w[0] >= 100]
            members = "".join(" ".join(w[4] for w in lw) for _, lw in lines_of(mem, 1.5))
            code = nfkc(c[4][:3])
            assert code not in res, ("地区コードが2回", code)
            res[code] = {"pref": c[4][3:], "code_label": c[4], "name": name, "members": members, "page": pi}
        for w in ws:
            if "単価未設定地区" in w[4]:
                legend.add(w[4])
    return res, sorted(legend)


def layer_of(cat, item, is_equipment):
    if is_equipment:
        return "equipment"
    if cat in ("土木工事", "各種料金その他"):
        return "work"
    if cat == "市場単価" and ("設置" in item or "手間" in item):
        return "work"
    return "material"


def basis_of(layer, unit):
    if layer == "equipment":
        return "equipment_rate_monthly" if "月" in unit else ("equipment_rate_daily" if "日" in unit else "equipment_rate_hourly")
    if layer == "work":
        return "work_unit_price_ex_tax"
    return "design_unit_price_ex_tax"


def main(which):
    C = CFG[which]
    sid = C["sid"]
    if which == "hrr":
        got = hashlib.sha256(open(C["pdf"], "rb").read()).hexdigest()
        if got != C["sha"]:
            raise SystemExit("原本の sha256 が %s の値と違う: %s" % (C["month"], got))
        area, area_quote = hrr_area_table(C["pdf"])
    else:
        got = hashlib.sha256(open(C["pdf"], "rb").read()).hexdigest()
        if got != C["sha"]:
            raise SystemExit("原本の sha256 が %s の値と違う: %s" % (C["month"], got))
        area, area_quote = cbr_area_table(C["area_pdf"])
    pages = words_of(C["pdf"])
    lay = layout_pages(C["pdf"])
    if which == "cbr":
        for cp, ctext in C["cover"]:
            if ctext not in re.sub(r"\s", "", lay[cp - 1]):
                raise SystemExit("p%d に「%s」が無い(%s の原本でない)" % (cp, ctext, C["month"]))
    rows, seen_nat, checks = [], {}, []
    stats = collections.Counter()
    maxd, maxsplit, offs = 0.0, 0.0, []
    unmatched_area = set()
    nontable = []
    for pno, ws in enumerate(pages, 1):
        P = parse_page(ws, pno)
        if P is None:
            nontable.append(pno)
            continue
        if P["period"] != C["period"]:
            raise SystemExit("p%d の見出しの年月 %s が %s の %s でない" % (pno, P["period"], C["month"], C["period"]))
        stats["pages"] += 1
        maxd = max(maxd, P["max_col_dist_pt"]); maxsplit = max(maxsplit, P["group_split_err_pt"]); offs.append(P["col_offset_pt"])
        # 照合: -layout の本文の値の形の語の数
        body = lay[pno - 1].split("\n")
        # 頁番号の行「- 6 -」は除く。値の形の語の多重集合(文字列ごとの個数)を bbox の値と比べる
        lay_c = collections.Counter(t for ln in body if not re.match(r"^\s*-\s*[0-9]+\s*-\s*$", ln)
                                    for t in ln.split() if VALNUM.match(t) or t in DASH)
        bb_c = collections.Counter(c["text"] for r in P["rows"] for c in r["cells"])
        lay_n = sum(lay_c.values())
        checks.append({"page": pno, "layout_value_tokens": lay_n, "bbox_value_words": P["n_value_words"], "rows": len(P["rows"]),
                       "multiset_equal": lay_c == bb_c})
        cols = P["columns"]
        for r in P["rows"]:
            stats["rows"] += 1
            item = r["item_words"][0]
            spec = " ".join(r["item_words"][1:] + ([r["spec_text"]] if r["spec_text"] else []))
            if r["remark"]:
                spec = (spec + " [" + r["remark"] + "]").strip()
            layer = layer_of(P["category"], item, P["is_equipment"])
            basis = basis_of(layer, r["unit"])
            for cell in r["cells"]:
                col = cols[cell["col"]]
                label = " ".join(col["lines"])
                if col["group"]:
                    gcode, gname = pref(re.sub(r"\d+$", "", nfkc(col["group"])))
                    assert gcode, ("県が分からない", col["group"])
                    geo_level = "bureau_area"
                    if which == "hrr":
                        key = re.sub(r"[\s･・]", "", label)
                        hits = [c for c, a in area.items() if re.sub(r"[\s･・]", "", a["name"]) == key and pref(a["pref"])[0] == gcode]
                        if len(hits) != 1:
                            unmatched_area.add((label, col["group"], tuple(hits)))
                            acode, amem = "", ""
                        else:
                            acode, amem = hits[0], area[hits[0]]["members"]
                    else:
                        acode = re.sub(r"\D", "", nfkc(col["lines"][0]))
                        a = area.get(acode)
                        if not a:
                            unmatched_area.add((label, col["group"], acode)); amem = ""
                        else:
                            amem = a["members"]
                            assert re.sub(r"\s", "", a["name"]) == re.sub(r"\s", "", col["lines"][-1]), ("地区名が合わない", acode, a["name"], col["lines"])
                else:
                    gcode, gname = pref(re.sub(r"\d+$", "", nfkc(label)))
                    assert gcode, ("県が分からない", label)
                    geo_level, acode, amem = "pref", "", ""
                t = cell["text"]
                if t in DASH:
                    status, price = "not_set", ""
                else:
                    status = C["status_value"]
                    price = num(t) if C["copy_values"] else ""
                nat = (layer, item, spec, r["unit"], geo_level, gcode, label, acode, basis)
                if nat in seen_nat:
                    stats["dup_natural_key"] += 1
                    prev = seen_nat[nat]
                    same = prev[1] == t
                    raise SystemExit("同じ観測が2行: %s p%d と p%d (値 %s)" % (nat, prev[0], pno, "同じ" if same else "違う"))
                seen_nat[nat] = (pno, t)
                note = C["note"]
                if status == "not_set":
                    note = "原本で「－」(取引事例が少なく単価を設定していない)。0 円ではない。"
                if "割増額" in item:
                    note += " 割増額(単価に加算する額)で、材料そのものの単価ではない。"
                if layer == "work":
                    note += " 工事・試験などの単価(材料単価表に載っているもの)。"
                rows.append({
                    "obs_id": make_id(sid, pno, P["category"], item, spec, r["unit"], label, acode),
                    "country": "JP", "layer": layer, "category": P["category"], "item_name": item, "spec": spec,
                    "unit": r["unit"], "geo_level": geo_level, "geo_code": gcode, "geo_name": gname,
                    "area_label": label, "area_code": acode, "area_members": amem,
                    "price": price, "currency": "JPY", "price_basis": basis, "price_status": status,
                    "period": P["period"], "effective_from": C["effective_from"], "source_id": sid, "source_page": pno,
                    "evidence_url": C["url"], "license": C["license"], "note": note,
                })
                stats["status:" + status] += 1
                stats["layer:" + layer] += 1
    n = write_obs(C["out"], rows)
    mism = [c for c in checks if c["layout_value_tokens"] != c["bbox_value_words"] or not c["multiset_equal"]]
    summary = {"source_id": sid, "pdf_sha256": hashlib.sha256(open(C["pdf"], "rb").read()).hexdigest(),
               "rows_written": n, "stats": dict(stats), "max_col_dist_pt": maxd, "max_group_split_err_pt": maxsplit,
               "col_offset_pt_range": [min(offs), max(offs)],
               "layout_check": {"pages": len(checks), "pages_equal": len(checks) - len(mism),
                                "layout_tokens": sum(c["layout_value_tokens"] for c in checks),
                                "bbox_values": sum(c["bbox_value_words"] for c in checks), "mismatch": mism},
               "area_entries": len(area), "area_quote": area_quote, "unmatched_area": sorted(map(str, unmatched_area))}
    if which == "hrr":
        # 表でない頁の文字(先頭の語)。表の頁の間に、表紙(「土木工事設計材料（公表）単価一覧表」)以外の頁があれば止める
        heads = {p: "".join(w[4] for w in sorted(pages[p - 1], key=lambda t: (round(t[1]), t[0]))[:12]) for p in nontable}
        first_tab = min(set(range(1, len(pages) + 1)) - set(nontable))
        inside = [p for p in nontable if p > first_tab and "単価一覧表" not in heads[p]]
        summary["month"] = C["month"]
        summary["pages_total"] = len(pages)
        summary["nontable_pages"] = {str(p): heads[p][:40] for p in nontable}
        if inside or unmatched_area or mism:
            print(json.dumps(summary, ensure_ascii=False, indent=1))
            raise SystemExit("照合が合わない: 表の間の表でない頁 %s / 地区の不一致 %d / layout との不一致 %d 頁" % (inside, len(unmatched_area), len(mism)))
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    json.dump(summary, open(C.get("summary") or os.path.join(HERE, "..", "..", "reports", "B2_%s_parse_summary.json" % which), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    if sys.argv[1] == "hrr":
        CFG["hrr"] = hrr_cfg(_opt("--month", "r8_09"))
        CFG["hrr"]["out"] = _opt("--out", CFG["hrr"]["out"])
        CFG["hrr"]["summary"] = _opt("--summary", CFG["hrr"]["summary"])
    elif sys.argv[1] == "cbr":
        CFG["cbr"] = cbr_cfg(_opt("--month", "r8_10"))
        CFG["cbr"]["out"] = _opt("--out", CFG["cbr"]["out"])
        CFG["cbr"]["summary"] = _opt("--summary", CFG["cbr"]["summary"])
    main(sys.argv[1])
