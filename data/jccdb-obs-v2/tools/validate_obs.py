# -*- coding: utf-8 -*-
"""
観測層 v2 の検査器。全行を機械で数える(抜き取りで結論を出さない)。

使い方: python3 validate_obs.py <obs2 のルート> [--only 相対パス ...] [--json 出力先]
  observations/**/*.csv と sources/*.json を全部読む。誤りが1つでもあれば終了コード 1。

見るもの:
  - 列の並び(COLUMNS と完全一致)
  - 列ごとの値の形(enum、数、日付、期間、URL、ID)
  - price と price_status の整合(開いた状態なら値あり、閉じた状態なら値なし)
  - price_status と license の整合、行の license と出典台帳の license の一致
  - 台帳の values_copied が false の出典に値が入っていないか
  - country と currency / geo_code の整合(JP は都道府県コードと名前、US は州 FIPS と名前)
  - obs_id の重複(全ファイル横断)と、自然キーの重複(同じ出典・品目・規格・単位・地域・時点)
  - 禁止文字(em/en ダッシュ、水平線)、改行
  - 台帳: 必須の欄、sha256 の形、帰属表示(PDL/CC BY のとき)
"""
import csv, glob, json, os, re, sys, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from obs_common import (COLUMNS, LAYERS, GEO_LEVELS, STATUSES, OPEN_STATUSES, STATUS_LICENSES, LICENSES,
                        PRICE_BASES, PERIOD_RE, DATE_RE, NUM_RE, ID_RE, FORBIDDEN, JP_CODE_PREF, US_STATES)

LEDGER_REQUIRED = ["source_id", "country", "title", "publisher", "url", "retrieved_at", "license",
                   "license_url", "license_quote", "how_read", "values_copied"]
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
# 0 を値として持ってよい price_basis(統計の件数・金額。該当なし = 0)。単価の 0 は not_set。
ZERO_OK_BASES = {"count", "construction_cost_planned_total", "orders_received_total", "spending_million_usd_saar", "spending_million_usd_nsa", "ratio",
                 # 2026-09-26 後半: 米国の統計の金額・付加給付・機械の燃料費と資本費の要素の 0
                 "permit_valuation_usd", "permit_valuation_thousand_usd", "annual_total_thousand_usd",
                 "prevailing_fringe_hourly", "equipment_fuel_hourly", "equipment_fccm_hourly"}


def load_ledger(root, errors):
    led = {}
    for fn in sorted(glob.glob(os.path.join(root, "sources", "*.json"))):
        try:
            d = json.load(open(fn, encoding="utf-8"))
        except Exception as e:
            errors.append(("ledger", fn, 0, "json", str(e))); continue
        sid = d.get("source_id")
        base = os.path.basename(fn)[:-5]
        if sid != base:
            errors.append(("ledger", fn, 0, "source_id", "ファイル名と source_id が違う: %s / %s" % (base, sid)))
        for k in LEDGER_REQUIRED:
            if k not in d or d[k] in ("", None):
                errors.append(("ledger", fn, 0, k, "必須の欄が空"))
        if d.get("license") not in LICENSES:
            errors.append(("ledger", fn, 0, "license", "許可一覧に無い: %r" % d.get("license")))
        if d.get("license") in ("PDL1.0", "CC-BY-4.0", "GOV-STD-2.0", "OPEN-TERMS") and not d.get("attribution"):
            errors.append(("ledger", fn, 0, "attribution", "帰属表示が要る利用条件なのに attribution が空"))
        if d.get("api"):
            # API から取った出典は、保存した応答の sha256 を持つ(sha256 は応答ファイルのバイト列)
            pass
        if not SHA_RE.match(str(d.get("sha256", ""))):
            errors.append(("ledger", fn, 0, "sha256", "sha256 が無いか形が違う(原本か API 応答のバイト列から計算する)"))
        for k, v in d.items():
            if isinstance(v, str):
                for ch, nm in FORBIDDEN.items():
                    if ch in v:
                        errors.append(("ledger", fn, 0, k, "禁止文字 %s" % nm))
        if sid:
            led[sid] = d
    return led


def load_extra_enums(root):
    """tools/extra_enums/*.json で許可一覧を足せる(parser ごとに1ファイル、理由つき)。obs_common.py を複数の手で同時に書き換えないため。"""
    add = collections.defaultdict(set)
    for fn in sorted(glob.glob(os.path.join(root, "tools", "extra_enums", "*.json"))):
        d = json.load(open(fn, encoding="utf-8"))
        for k in ("price_basis", "layer", "geo_level"):
            for v in d.get(k, []):
                add[k].add(v["value"] if isinstance(v, dict) else v)
    PRICE_BASES.update(add["price_basis"]); LAYERS.update(add["layer"]); GEO_LEVELS.update(add["geo_level"])
    return {k: sorted(v) for k, v in add.items()}


def main():
    args = sys.argv[1:]
    root = os.path.abspath(args[0])
    extra = load_extra_enums(root)
    only = []
    jout = None
    if "--only" in args:
        i = args.index("--only"); only = [a for a in args[i + 1:] if not a.startswith("--")]
    if "--json" in args:
        jout = args[args.index("--json") + 1]
    errors, warns = [], []
    led = load_ledger(root, errors)
    # observations/ = 公開の組み立てに入るもの。observations_restricted/ = 出典が行の一覧の複製を禁じているもの(組み立てに入れない)。
    # observations_hold/ = 原本の誤りの疑いで保留したもの(組み立てに入れない)。どれも検査はする。
    files = []
    for d in ("observations", "observations_restricted", "observations_hold"):
        files += sorted(glob.glob(os.path.join(root, d, "**", "*.csv"), recursive=True))
    if only:
        files = [f for f in files if os.path.relpath(f, root) in only]
    # 行数が数百万になるので、ID と自然キーは 8 バイトの digest と (ファイル番号, 行) で持つ(文字列の辞書だとメモリが足りない)
    all_ids = {}
    nat = {}
    file_names = []
    import hashlib as _h
    def _dg(x):
        return _h.blake2b(x.encode("utf-8"), digest_size=8).digest()
    stats = collections.OrderedDict()
    tot = collections.Counter()
    for fn in files:
        rel = os.path.relpath(fn, root)
        file_names.append(rel)
        st = collections.Counter()
        with open(fn, encoding="utf-8", newline="") as f:
            rd = csv.reader(f)
            header = next(rd, None)
            if header != COLUMNS:
                errors.append((rel, "", 1, "header", "列の並びが違う: %s" % header)); continue
            for ln, row in enumerate(rd, start=2):
                if len(row) != len(COLUMNS):
                    errors.append((rel, "", ln, "row", "列の数が %d" % len(row))); continue
                r = dict(zip(COLUMNS, row))
                oid = r["obs_id"]
                def E(col, msg):
                    errors.append((rel, oid, ln, col, msg))
                st["rows"] += 1
                for k, v in r.items():
                    for ch, nm in FORBIDDEN.items():
                        if ch in v:
                            E(k, "禁止文字 %s" % nm)
                    if "\n" in v or "\r" in v:
                        E(k, "改行")
                    if v != v.strip():
                        E(k, "前後に空白")
                if not ID_RE.match(oid):
                    E("obs_id", "16桁の16進でない")
                _k = _dg(oid)
                if _k in all_ids:
                    fi, fl = all_ids[_k]
                    E("obs_id", "重複(%s:%d と)" % (file_names[fi], fl))
                all_ids[_k] = (len(file_names) - 1, ln)
                c = r["country"]
                if c not in ("JP", "US"):
                    E("country", "JP か US")
                if r["layer"] not in LAYERS:
                    E("layer", "許可一覧に無い: %r" % r["layer"])
                if not r["item_name"]:
                    E("item_name", "空")
                if not r["unit"]:
                    E("unit", "空")
                if r["geo_level"] not in GEO_LEVELS:
                    E("geo_level", "許可一覧に無い: %r" % r["geo_level"])
                g, gl = r["geo_code"], r["geo_level"]
                if gl == "national":
                    if g != c:
                        E("geo_code", "national なら geo_code は %s" % c)
                elif c == "JP" and gl in ("pref", "pref_area"):
                    if g not in JP_CODE_PREF:
                        E("geo_code", "都道府県コードでない: %r" % g)
                    elif r["geo_name"] != JP_CODE_PREF[g]:
                        E("geo_name", "コード %s は %s(%r でない)" % (g, JP_CODE_PREF[g], r["geo_name"]))
                elif c == "JP" and gl == "bureau_area":
                    if g and g not in JP_CODE_PREF:
                        E("geo_code", "都道府県コードでない: %r" % g)
                    if g and r["geo_name"] != JP_CODE_PREF.get(g):
                        E("geo_name", "コードと名前が合わない")
                    if not r["area_label"]:
                        E("area_label", "bureau_area なら地区の表示が要る")
                elif c == "US" and gl in ("state", "district"):
                    if g not in US_STATES:
                        E("geo_code", "州 FIPS でない: %r" % g)
                    elif r["geo_name"] != US_STATES[g]:
                        E("geo_name", "FIPS %s は %s(%r でない)" % (g, US_STATES[g], r["geo_name"]))
                elif c == "US" and gl == "county":
                    if not re.match(r"^\d{5}$", g) or g[:2] not in US_STATES:
                        E("geo_code", "郡 FIPS 5桁でない: %r" % g)
                elif c == "US" and gl == "metro":
                    if not re.match(r"^\d{5,7}$", g):
                        E("geo_code", "都市圏コードでない: %r" % g)
                elif c == "US" and gl == "census_region":
                    if not re.match(r"^(R[1-4]|D[1-9])$", g):
                        E("geo_code", "R1..R4 / D1..D9 でない: %r" % g)
                elif gl == "city":
                    if not re.match(r"^\d{2}(\d{3,4})?$", g):
                        E("geo_code", "市区町村コードでない: %r" % g)
                if c == "JP" and gl in ("bureau_area", "pref_area", "city") and not (r["area_label"] or r["geo_name"]):
                    E("area_label", "地区の表示が要る")
                ps = r["price_status"]
                if ps not in STATUSES:
                    E("price_status", "許可一覧に無い: %r" % ps)
                st["status:" + ps] += 1
                st["layer:" + r["layer"]] += 1
                p = r["price"]
                if ps in OPEN_STATUSES:
                    if not NUM_RE.match(p):
                        E("price", "開いた状態(%s)なのに数でない: %r" % (ps, p))
                    elif float(p) < 0 and r["layer"] not in ("index",):
                        E("price", "負の値")
                    elif float(p) == 0 and r["layer"] not in ("index",) and r["price_basis"] not in ZERO_OK_BASES:
                        E("price", "0(単価の 0 は not_set で表す。統計の件数・金額の 0 だけが値)")
                    if r["license"] not in STATUS_LICENSES.get(ps, set()):
                        E("license", "%s に %r は合わない" % (ps, r["license"]))
                else:
                    if p != "":
                        E("price", "閉じた状態(%s)なのに値がある" % ps)
                    if r["ref_value"] != "" and ps != "not_set":
                        E("ref_value", "閉じた状態なのに参考値がある")
                if r["ref_value"] and not NUM_RE.match(r["ref_value"]):
                    E("ref_value", "数でない: %r" % r["ref_value"])
                if r["ref_value"] and not r["ref_note"]:
                    E("ref_note", "参考値があるのに何の値か書いていない")
                if r["layer"] == "index":
                    if r["currency"] != "":
                        E("currency", "指数に通貨は付けない")
                else:
                    want = {"JP": "JPY", "US": "USD"}.get(c)
                    if r["price_basis"] not in ("count", "ratio") and r["currency"] != want:
                        E("currency", "%s の行は %s" % (c, want))
                if r["price_basis"] not in PRICE_BASES:
                    E("price_basis", "許可一覧に無い: %r(足すなら obs_common.PRICE_BASES に)" % r["price_basis"])
                if not PERIOD_RE.match(r["period"]):
                    E("period", "YYYY / YYYY-MM / YYYY-MM-DD / YYYYQn / FYYYYY / YYYYHn のどれか: %r" % r["period"])
                if r["effective_from"] and not DATE_RE.match(r["effective_from"]):
                    E("effective_from", "YYYY-MM-DD でない")
                if not re.match(r"^https?://", r["evidence_url"]):
                    E("evidence_url", "http(s) でない")
                if r["license"] not in LICENSES:
                    E("license", "許可一覧に無い: %r" % r["license"])
                sid = r["source_id"]
                s = led.get(sid)
                if not s:
                    E("source_id", "台帳に無い: %r" % sid)
                else:
                    if s.get("license") != r["license"]:
                        E("license", "台帳(%s)と違う" % s.get("license"))
                    if s.get("values_copied") is False and p != "":
                        E("price", "台帳で values_copied=false の出典に値が入っている")
                    if s.get("country") != c:
                        E("country", "台帳(%s)と違う" % s.get("country"))
                key = (sid, r["layer"], r["item_name"], r["spec"], r["unit"], r["geo_level"], g, r["area_label"],
                       r["area_code"], r["period"], r["price_basis"])
                # 保留(observations_hold/)は原本のとおりの記録なので、付け直した行と自然キーが重なってよい
                if not rel.startswith("observations_hold"):
                    _nk = _dg("\x1f".join(key))
                    if _nk in nat:
                        fi, fl = nat[_nk]
                        E("natural_key", "同じ観測が2行(%s:%d と)" % (file_names[fi], fl))
                    nat[_nk] = (len(file_names) - 1, ln)
        stats[rel] = dict(st)
        tot.update(st)
    by_dir = collections.Counter()
    for rel, st in stats.items():
        by_dir[rel.split(os.sep)[0]] += st.get("rows", 0)
    summary = {"files": len(files), "rows": tot["rows"], "rows_by_dir": dict(by_dir), "errors": len(errors), "warnings": len(warns),
               "by_status": {k[7:]: v for k, v in tot.items() if k.startswith("status:")},
               "by_layer": {k[6:]: v for k, v in tot.items() if k.startswith("layer:")},
               "sources_in_ledger": len(led), "extra_enums": extra, "per_file": stats,
               "first_errors": [dict(zip(("file", "obs_id", "line", "col", "msg"), e)) for e in errors[:60]]}
    if jout:
        json.dump(summary, open(jout, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in summary.items() if k != "per_file"}, ensure_ascii=False, indent=1))
    if errors:
        cnt = collections.Counter((e[0], e[3], e[4][:40]) for e in errors)
        print("誤りの内訳(ファイル, 列, 文言):")
        for k, v in cnt.most_common(40):
            print("  %6d  %s" % (v, k))
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
