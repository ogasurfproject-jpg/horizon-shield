# -*- coding: utf-8 -*-
"""
Davis-Bacon 法の一般賃金決定(General Decisions、米国労働省 賃金時間局。SAM.gov で公表)を観測層 v2 に入れる(US-D-davis-bacon)。

入力(OBS2/raw):
  dol-dbra-<wd>-<改訂>.json              SAM.gov の wdol/v1/wd/<WD>/<改訂> の応答(document に決定の本文そのもの)
  dol-dbra-index-2026-09-26-p<k>.json    SAM.gov の検索 sgs/v1/search?index=dbra&is_active=true の応答(現行の決定の一覧、照合用)
  dol-dbra-fetch-manifest-2026-09-26.json 取得の記録(url, bytes, sha256, 応答ヘッダ, 取得時刻)

出力:
  <出力先>/us/labor_dol_davis_bacon_<州略号>_2026.csv  1 行 = 1 決定 x 1 職種行 x (Rates か Fringes)
  sources/dol-dbra-<wd>-<改訂>.json                      出典台帳(1 決定 1 台帳)
  出力先は既定で observations_hold(SAM.gov 利用規約の自動収集の条項の判断待ち。報告 reports/US-D-davis-bacon.md)。
  --dir observations を付けると公開の組み立てに入る場所に書く。

読み方(本文 document の行をそのまま読む。要約を通さない):
  - 見出し: General Decision Number / State / Construction Types / Counties(County)/ 対象工事の文 / Modification Number と Publication Date の表。
  - 賃金の組: 「 XXXX0000-000 MM/DD/YYYY」(rate identifier)の行の次に Rates / Fringes の見出し行(Rates は 53 桁目、Fringes は 76 桁目)。
    組は「-----」の行で終わる。組の中で、行の最後の「$」が 45 桁目以降にあり、その後が「空白 + 数」の行を賃金の行とする。
    職種名は、前の賃金の行(か見出し)から後の文字の行を、原本の行のまま(行末の空白を含めて)つなぎ、点線の引出しを除いたもの。
    Rates は「$」の後の数、Fringes は行の最後の数。間に文字が印字されている行(原本の組版のはみ出し)は note に書く。
  - 照合(別の読み方): 本文の全行について 53 桁目(0 始まりで 52)が「$ 」で始まる行を数え、値を桁の位置で読み、組の読みと件数・値を突き合わせる。
"""
import csv, glob, json, os, re, sys, hashlib, collections
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from obs_common import make_id, num, write_obs, US_STATES, US_STATE_ABBR

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT_DIR = "observations_hold"
if "--dir" in sys.argv:
    OUT_DIR = sys.argv[sys.argv.index("--dir") + 1]
RETRIEVED = "2026-09-26"
ABBR_FIPS = dict(US_STATE_ABBR)
ABBR_FIPS["CM"] = "69"   # SAM.gov の州コード CM = Northern Mariana Islands(本文の State: Northern Mariana Islands)

RF = re.compile(r"^\s+Rates\s+Fringes\s*$")
IDL = re.compile(r"^ ([A-Z0-9]{4,12}(?:-\d{3})?) (\d\d/\d\d/\d{4})\s*$")
NUMS = r"\d[\d,]*\.\d+"
PER_DAY = re.compile(r"RATES['\"]*\s+COLUMN\s+ARE\s+PER\s+DAY", re.I)

LICENSE_URL = "https://www.dol.gov/general/aboutdol/copyright"
LICENSE_QUOTE = (
    "U.S. Department of Labor, Public Domain Copyright Trademark & Patent Information Schedule "
    "(https://www.dol.gov/general/aboutdol/copyright、2026-09-26 に Apify apify/web-fetch で取得): \"Materials created by the federal government "
    "are generally part of the public domain and may be used, reproduced and distributed without permission. Therefore, content on this website "
    "which is in the public domain may be used without the prior permission of the U.S. Department of Labor (DOL). However, such materials may not "
    "be used in a manner that implies any affiliation or endorsement by the DOL of your company, website or publication. You may properly credit "
    "public domain materials obtained from a DOL website to the U.S. Department of Labor and/or https://www.dol.gov.\" / 17 U.S.C. 105(a) "
    "(https://www.law.cornell.edu/uscode/text/17/105、2026-09-26 に Apify で取得): \"Copyright protection under this title is not available for "
    "any work of the United States Government, but the United States Government is not precluded from receiving and holding copyrights "
    "transferred to it by assignment, bequest, or otherwise.\" / SAM.gov Terms of Use, Reuse and Copyright "
    "(https://sam.gov/about/terms-of-use、2026-09-26 に Apify website-content-crawler で表示して取得): \"Most material on our site is free of "
    "copyright and may be copied and distributed without permission. Works produced by federal government employees in the course of their "
    "employment are generally not protected by copyright and are in the public domain in the U.S. Citation of the GSA site and a link back is "
    "much appreciated.\" 賃金決定は労働省 賃金時間局が 29 CFR Part 1 に基づいて定めて公表する文書(本文の末尾に労働省の不服申立ての手続きと"
    "宛先)。本文に著作権表示は無い(取得した 2,213 件の document で copyright / © を検索して 0 件)。")
ACCESS_TERMS_QUOTE = (
    "SAM.gov Terms of Use, Data Access (https://sam.gov/about/terms-of-use、2026-09-26 取得): \"Do not use bots to download or copy restricted "
    "or sensitive data from SAM.gov.\" \"Do not use your SAM.gov login for data mining, bots, or other data gathering and extraction tools.\" "
    "\"With permission, you may use software to connect to some SAM.gov data.\" Full Legal Language: \"SAM.gov makes certain data available via "
    "APIs and extracts with URLs “https://open.gsa.gov/api/” and “https://sam.gov/data-services.” Automated data gathering, web "
    "scraping tools are prohibited and, if detected, will result in the associated account(s) being denied access to SAM.gov via Login.gov.\"")
ACCESS_TERMS_NOTE = (
    "値の著作権(17 U.S.C. 105、公有)とは別に、取り方の条件がある。この出典は SAM.gov の頁をブラウザ(Apify の playwright)で開き、頁の中から "
    "SAM.gov の公開の API(ログインも鍵も使わない。api_key=null は SAM.gov の頁自身が付ける値)を呼んで取った。SAM.gov の利用規約は "
    "\"Automated data gathering, web scraping tools are prohibited\" と書く。取得の途中でこの条文を読み、残りの取得を止めた(2026-09-26 03:25 UTC)。"
    "賃金決定は open.gsa.gov の API の一覧にも sam.gov/data-services の一括ファイルにも無い(同日確認)。公開の組み立てに入れるかは番人の判断待ち。"
    "行は observations_hold/ に置いた。")


def rd(p):
    return json.load(open(p, encoding="utf-8"))


def mdY(s):
    m, d, y = s.split("/")
    return "%s-%s-%s" % (y, m, d)


def parse_doc(doc):
    """本文を読む。返り値: dict(header..., rates=[...], colcheck=[...])"""
    # document は CSV の欄のように「"」で囲まれ、中の「"」は「""」と二重になっている(2,213 件すべてで、囲みの外に文字が無く、
    # 二重でない「"」が 0 個であることを確かめた)。囲みを外し「""」を「"」に戻してから読む(戻さないと桁が 1 つずれる行がある)。
    # 行の番号は元の document の行の番号と同じ(改行の数は変わらない)。
    t = doc.replace("\r", "")
    s = t.rstrip()
    assert t.startswith('"') and s.endswith('"')
    inner = s[1:-1]
    assert '"' not in inner.replace('""', "")
    lines = inner.replace('""', '"').split("\n")
    H = {}
    m = re.search(r"General Decision Number: (\S+) (\d\d/\d\d/\d{4})", lines[0])
    H["gd_number"], H["gd_date"] = m.group(1), m.group(2)
    # 見出しの欄(値が次の行に続くことがあるので、空行までつなぐ)
    def field(prefixes):
        for i, ln in enumerate(lines[:80]):
            for p in prefixes:
                if ln.startswith(p):
                    buf = [ln[len(p):]]
                    j = i + 1
                    while j < len(lines) and lines[j].strip():
                        buf.append(lines[j]); j += 1
                    return "".join(buf).strip(), i, j
        return None, None, None
    H["state"], _, _ = field(["State: "])
    H["types"], _, _ = field(["Construction Types: "])
    H["counties"], ci, cj = field(["Counties: ", "County: ", "Counties:", "County:"])
    # 対象工事の文: 郡の欄の後から Modification Number の表の前まで
    mi = next(i for i, ln in enumerate(lines) if ln.startswith("Modification Number"))
    H["scope"] = " ".join(l.strip() for l in lines[(cj or 0):mi] if l.strip())
    mods = []
    j = mi + 1
    while j < len(lines):
        mm = re.match(r"^\s+(\d+)\s+(\d\d/\d\d/\d{4})\s*$", lines[j])
        if mm:
            mods.append((int(mm.group(1)), mm.group(2)))
        elif lines[j].strip():
            break
        j += 1
    H["mods"] = mods
    # 賃金の組
    rates = []
    i = 0
    nblk = 0
    while i < len(lines):
        if RF.match(lines[i]):
            mid = IDL.match(lines[i - 1])
            assert mid, ("組の見出しの前に rate identifier が無い", lines[i - 1])
            ident = "%s %s" % (mid.group(1), mid.group(2))
            nblk += 1
            buf = []
            j = i + 1
            while j < len(lines) and not lines[j].startswith("-----"):
                ln = lines[j]
                p = ln.rfind("$")
                mt = re.match(r"^ +(" + NUMS + r")(\s.*)?$", ln[p + 1:]) if p >= 45 else None
                if mt:
                    pre = re.sub(r"\.{2,}\s*$", "", ln[:p])
                    text = ("".join(buf) + pre).strip()
                    rest = (mt.group(2) or "")
                    mf = re.match(r"^(.*?)\s*(" + NUMS + r")?\s*$", rest)
                    spill = mf.group(1).strip()
                    fringe = mf.group(2)
                    rates.append({"block": nblk, "ident": ident, "text": text, "rate": mt.group(1), "fringe": fringe,
                                  "spill": spill, "line": j + 1, "raw_line": ln, "nbuf": len(buf)})
                    buf = []
                elif ln.strip():
                    buf.append(ln)
                j += 1
            assert not buf, ("組の終わりに賃金の行の無い文字", buf[:2])
            i = j
        i += 1
    # 照合用: 桁の位置で読む(組の読みとは別の道筋)
    col = []
    for k, ln in enumerate(lines):
        if len(ln) > 54 and ln[52] == "$" and re.match(r"\$ +\d", ln[52:]):
            toks = ln[53:].split()
            col.append({"line": k + 1, "rate": toks[0], "fringe": toks[-1] if len(toks) > 1 else None})
    return H, rates, col, nblk, lines


def main():
    idx = {}
    for p in sorted(glob.glob(os.path.join(ROOT, "raw", "dol-dbra-index-2026-09-26-p*.json"))):
        d = rd(p)
        for x in d["_embedded"]["results"]:
            idx[x["fullReferenceNumber"]] = dict(x, _page=os.path.basename(p), _total=d["page"]["totalElements"])
    man = {os.path.basename(f["raw"]): f for f in rd(os.path.join(ROOT, "raw", "dol-dbra-fetch-manifest-2026-09-26.json"))["files"]}
    files = sorted(f for f in glob.glob(os.path.join(ROOT, "raw", "dol-dbra-*.json"))
                   if re.search(r"/dol-dbra-[a-z]{2}\d{8}-\d+\.json$", f))
    by_state = collections.defaultdict(list)
    chk = collections.Counter()
    problems = []
    per_doc = []
    for f in files:
        base = os.path.basename(f)
        sid = base[:-5]
        b = open(f, "rb").read()
        mf = man[base]
        assert hashlib.sha256(b).hexdigest() == mf["sha256"] and len(b) == mf["bytes"]
        J = json.loads(b.decode("utf-8"))
        wd, rev = J["fullReferenceNumber"], J["revisionNumber"]
        assert sid == "dol-dbra-%s-%d" % (wd.lower(), rev)
        H, rates, col, nblk, lines = parse_doc(J["document"])
        L = idx.get(wd)
        st = wd[:2]
        fips = ABBR_FIPS[st]
        # 照合 1: 一覧(検索の索引)との突き合わせ
        if L is None:
            problems.append((wd, "一覧に無い")); chk["not_in_index"] += 1
        else:
            if L["revisionNumber"] != rev: problems.append((wd, "改訂が一覧と違う")); chk["rev_mismatch"] += 1
            if L["location"]["state"]["code"] != st: problems.append((wd, "州が一覧と違う")); chk["state_mismatch"] += 1
            if sorted(L.get("constructionTypes") or []) != sorted(J.get("constructionType") or []):
                problems.append((wd, "種類が一覧と違う %s %s" % (L.get("constructionTypes"), J.get("constructionType")))); chk["types_mismatch"] += 1
            # 一覧の郡名が本文の郡の欄に出てくるか(大文字小文字を無視、空白の揺れを無視)
            cty = re.sub(r"\s+", " ", (H["counties"] or "").upper())
            names = {c["value"] for c in (L["location"]["state"].get("counties") or [])}
            miss = [n for n in names if re.sub(r"\s+", " ", n.upper()) not in cty]
            chk["index_county_names"] += len(names)
            chk["index_county_names_found_in_doc"] += len(names) - len(miss)
            if miss:
                chk["docs_with_county_name_not_found"] += 1
                problems.append((wd, "一覧の郡名が本文の郡の欄に見当たらない: %s" % sorted(miss)[:5]))
        # 照合 2: 見出しと JSON
        if H["gd_number"] != wd: problems.append((wd, "本文の番号が違う")); chk["gd_number_mismatch"] += 1
        if US_STATES[fips].lower() != (H["state"] or "").lower():
            problems.append((wd, "本文の State と FIPS の名が違う: %s / %s" % (H["state"], US_STATES[fips]))); chk["state_name_diff"] += 1
        cur = [d for n, d in H["mods"] if n == rev]
        if not cur:
            problems.append((wd, "改訂番号が本文の表に無い %s" % H["mods"])); chk["mod_not_in_table"] += 1
            pub = H["gd_date"]
        else:
            pub = cur[-1]
        if pub != H["gd_date"]:
            chk["pub_ne_header_date"] += 1
        period = mdY(pub)
        if J.get("publishDate") != period:
            chk["pub_ne_json_publishDate"] += 1
        # 照合 3: 組の読みと桁の読み
        A = [(r["line"], num(r["rate"]), num(r["fringe"]) if r["fringe"] else None) for r in rates]
        B = [(c["line"], num(c["rate"]), num(c["fringe"]) if c["fringe"] and re.match(NUMS + "$", c["fringe"]) else None) for c in col]
        chk["rate_lines_block_reading"] += len(A)
        chk["rate_lines_column_reading"] += len(B)
        if A != B:
            chk["docs_block_vs_column_differ"] += 1
            problems.append((wd, "組の読みと桁の読みが違う %d / %d" % (len(A), len(B))))
        chk["docs"] += 1
        chk["blocks"] += nblk
        # 行を作る
        types = H["types"] or ""
        area_label = "%s %s" % (wd, types)
        rows = []
        seen = collections.Counter()
        for r in rates:
            text = r["text"]
            mpd = PER_DAY.search(text)
            per_day = bool(mpd)
            spec = "Rate identifier: %s" % r["ident"]
            key = (text, spec)
            seen[key] += 1
            if seen[key] > 1:
                spec += "; 同じ組の中で同じ職種名の %d 行目" % seen[key]
                chk["dup_same_block_same_text"] += 1
            base_note = "Davis-Bacon 一般賃金決定 %s 改訂 %d(公表 %s、%s)。" % (wd, rev, pub, types)
            extra = []
            if r["spill"]:
                extra.append("原本の行で Rates と Fringes の間に「%s」が印字されている(組版のはみ出し)。値は $ の後の数と行の最後の数" % r["spill"])
                chk["spill_lines"] += 1
            common = dict(country="US", layer="labor", category="Davis-Bacon General Decision", item_name=text,
                          geo_level="state", geo_code=fips, geo_name=US_STATES[fips], area_label=area_label,
                          area_code=str(rev), area_members=H["counties"] or "", currency="USD", period=period,
                          source_id=sid, source_page="document line %d" % r["line"],
                          evidence_url="https://sam.gov/wage-determination/%s/%d" % (wd, rev), license="US-PD-17USC105")
            # Rates
            rv = num(r["rate"])
            rr = dict(common, obs_id=make_id(sid, r["line"], "rate"), spec=spec,
                      unit="USD/day" if per_day else "USD/hour",
                      price_basis="prevailing_wage_daily" if per_day else "prevailing_wage_hourly")
            n1 = base_note + "Rates 列(基本賃金)。"
            if per_day:
                n1 += "職種名に「AMOUNTS IN %s」とあるので日額(USD/day)として入れた。" % mpd.group(0)
                chk["per_day_rates"] += 1
            if float(rv) == 0:
                rr.update(price="", price_status="not_set", ref_value="0", ref_note="原本の Rates 欄の値 0.00")
                chk["rate_zero"] += 1
            else:
                rr.update(price=rv, price_status="public_domain")
            rr["note"] = n1 + ("".join(" " + e + "。" for e in extra))
            rows.append(rr)
            # Fringes
            fr = dict(common, obs_id=make_id(sid, r["line"], "fringe"), spec=spec, unit="USD/hour",
                      price_basis="prevailing_fringe_hourly")
            n2 = base_note + "Fringes 列(付加給付の時間あたり額)。"
            if r["fringe"] is None:
                fr.update(price="", price_status="not_set")
                n2 += "原本の Fringes 欄が空。"
                chk["fringe_blank"] += 1
            else:
                fv = num(r["fringe"])
                if float(fv) == 0:
                    fr.update(price="", price_status="not_set", ref_value="0",
                              ref_note="原本の Fringes 欄の値 0.00(付加給付の定めが 0 ドル。単価の 0 は値にしない約束のため not_set)")
                    chk["fringe_zero"] += 1
                else:
                    fr.update(price=fv, price_status="public_domain")
                    if float(fv) > 150:
                        n2 += "原本の値のまま(Fringes %s、同じ行の Rates %s。付加給付の時間あたり額として桁が大きく、打ち誤りの疑い)。" % (r["fringe"], r["rate"])
                        chk["fringe_suspect_large"] += 1
            fr["note"] = n2 + ("".join(" " + e + "。" for e in extra))
            rows.append(fr)
        chk["rows"] += len(rows)
        by_state[st].append((sid, rows))
        per_doc.append({"sid": sid, "wd": wd, "rev": rev, "state": st, "fips": fips, "pub": pub, "period": period,
                        "types": types, "counties": H["counties"], "scope": H["scope"], "mods": H["mods"],
                        "rate_lines": len(rates), "blocks": nblk, "rows": len(rows), "bytes": len(b),
                        "sha256": mf["sha256"], "url": mf["url"], "headers": mf.get("headers"), "fetched_at": mf["fetched_at"],
                        "index_page": L["_page"] if L else None, "json_publishDate": J.get("publishDate"),
                        "constructionType": J.get("constructionType"), "doc_lines": len(lines)})
    # 書く
    outdir = os.path.join(ROOT, OUT_DIR, "us")
    written = {}
    for st in sorted(by_state):
        rows = [r for _, rs in sorted(by_state[st]) for r in rs]
        p = os.path.join(outdir, "labor_dol_davis_bacon_%s_2026.csv" % st.lower())
        written[os.path.relpath(p, ROOT)] = write_obs(p, rows)
    # 台帳
    for d in per_doc:
        led = {
            "source_id": d["sid"], "country": "US",
            "title": "Davis-Bacon General Decision %s, Modification %d (%s)" % (d["wd"], d["rev"], d["types"]),
            "publisher": "U.S. Department of Labor, Wage and Hour Division(SAM.gov で公表、SAM.gov は U.S. General Services Administration の運営)",
            "url": d["url"], "landing": "https://sam.gov/wage-determination/%s/%d" % (d["wd"], d["rev"]),
            "retrieved_at": RETRIEVED, "published": d["period"], "bytes": d["bytes"], "sha256": d["sha256"],
            "http_last_modified": (d["headers"] or {}).get("last-modified", ""),
            "fetched_via": "Apify apify/website-content-crawler(playwright、Apify proxy)で SAM.gov の頁を開き、頁の中から fetch() で "
                           "%s を呼んだ応答のバイト列(fetch の arrayBuffer)。頁の中で測った sha256 と手元で復元したバイト列の sha256 が一致。"
                           "取得時刻 %s。記録は raw/dol-dbra-fetch-manifest-2026-09-26.json" % (d["url"], d["fetched_at"]),
            "license": "US-PD-17USC105", "license_url": LICENSE_URL, "license_quote": LICENSE_QUOTE,
            "access_terms_url": "https://sam.gov/about/terms-of-use", "access_terms_quote": ACCESS_TERMS_QUOTE,
            "access_terms_note": ACCESS_TERMS_NOTE,
            "attribution": "Source: U.S. Department of Labor, Wage and Hour Division, Davis-Bacon General Decision %s (Modification %d), published on SAM.gov, https://sam.gov/wage-determination/%s/%d" % (d["wd"], d["rev"], d["wd"], d["rev"]),
            "how_read": "tools/parsers/parse_dol_dbra.py。JSON の document(決定の本文)を行のまま読んだ。document は CSV の欄のように「\"」で囲まれ中の「\"」が「\"\"」と二重になっているので、囲みを外し「\"\"」を「\"」に戻して読んだ(職種名の「\"」はこの戻した文字)。本文 %d 行、賃金の組 %d、賃金の行 %d(観測 %d 行 = 賃金の行 x Rates と Fringes)。"
                        "組の読み(rate identifier の行 + Rates/Fringes の見出し行から「-----」まで、行の最後の「$」の後の数と行の最後の数)と、"
                        "桁の読み(本文の全行で 53 桁目が「$ 」の行、値を桁で切る)の件数と値が一致。現行の決定の一覧(SAM.gov の検索 index=dbra、%s)の"
                        "改訂番号・州・種類と一致を確かめた。period は本文の Modification Number / Publication Date の表で改訂 %d の公表日(%s)。"
                        % (d["doc_lines"], d["blocks"], d["rate_lines"], d["rows"], d["index_page"], d["rev"], d["pub"]),
            "scope_quote": "State: %s / Construction Types: %s / Counties: %s / %s / Modification Number, Publication Date: %s" % (
                US_STATES[d["fips"]], d["types"], d["counties"], d["scope"], "; ".join("%d %s" % m for m in d["mods"])),
            "area_quote": d["counties"],
            "values_copied": True,
            "hold": "observations_hold/(SAM.gov 利用規約の自動収集の条項の判断待ち)" if OUT_DIR == "observations_hold" else "",
        }
        json.dump(led, open(os.path.join(ROOT, "sources", d["sid"] + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    summary = {"written": written, "check": dict(chk), "problems": problems[:200], "n_problems": len(problems),
               "states": {st: len(v) for st, v in sorted(by_state.items())},
               "index_total_active": next(iter(idx.values()))["_total"] if idx else None, "index_records_read": len(idx)}
    json.dump(summary, open(os.path.join(ROOT, "tools", "parsers", "out", "dol_dbra_summary.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(per_doc, open(os.path.join(ROOT, "tools", "parsers", "out", "dol_dbra_per_doc.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print(json.dumps({k: v for k, v in summary.items() if k != "problems"}, ensure_ascii=False, indent=1))
    for p in problems[:40]:
        print("PROBLEM", p)


if __name__ == "__main__":
    main()
