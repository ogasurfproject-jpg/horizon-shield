# -*- coding: utf-8 -*-
"""
Census Building Permits Survey (BPS) の ASCII ファイル(州・郡・都市圏・place)を読み、
observations/us/spending_census_bps_<階層>_<時点>.csv と sources/census-bps-<ファイル名>.json を作る。

入力: raw/census-bps-<stem>.txt(<stem> は原本のファイル名。例 co2025a, st2608y, ma2016a, cbsa2025a, ne2025a)。
  年次ファイル(...a.txt)は 2016〜2025 年、年初来累計ファイル(...y.txt)は 2026 年 8 月まで(2608y)。
  原本は latin-1(CBSA の "Cañon City  CO" の ñ が 0xF1)。数の列は ASCII。

原本の形(Census の Documentation/*.pdf による):
  - 州: Survey Date, FIPS State, Region, Division, State Name, 1-unit(Bldgs, Units, Value), 2-units, 3-4 units, 5+ units
        の「Estimates with Imputation」12 列と「Reported Only」12 列。Value は千ドル(stateasc.pdf "valuation is shown in thousands of dollars")。
        州の後に US 計、Region(R1〜R4)、Division(D1〜D9)、島しょ地域(60, 72, 78 など)が並ぶ。
  - 郡: Survey Date, FIPS State, FIPS County, Region, Division, County Name, 同じ 24 列。Value はドル(原本の文書に単位の記載なし。
        郡の和 ÷ 1000 が州の千ドルの値に一致することで確かめた。報告の照合を参照)。
  - 都市圏: 2016〜2023 は Metro (ending 2023)/ma<YYYY>a.txt(CSA, CBSA, 被覆コード "C" か空白)、
        2024 以降は CBSA (beginning Jan 2024)/cbsa<...>.txt(CSA, CBSA, Header Code 2/4/5 = 大都市圏で CSA の一部 / 大都市圏で CSA 外 / 小都市圏)。
        Value は千ドル(msaasc.pdf, cbsaasc.pdf)。
  - place: 4 地域(ne, mw, so, we)のファイル。Survey Date, State, 6-Digit ID, County, Census Place, FIPS Place, FIPS MCD, Pop, CSA, CBSA,
        Footnote, Central City, Zip, Region, Division, Number of Months Rep, Place Name, 24 列。Value はドル(郡と同じく照合で確かめた)。

行の作り方:
  - 1 つの地域 x 区分(1-unit / 2-units / 3-4 units / 5+ units)ごとに Bldgs, Units, Value の 3 行。値は Estimates with Imputation、
    ref_value に Reported Only の同じ欄。
  - Bldgs と Units は price_basis "count"(0 も値)。Value は "permit_valuation_usd"(郡・place、ドル)か
    "permit_valuation_thousand_usd"(州・都市圏、千ドル)。検査器は permit_valuation_* の 0 を値として受け付けないため、
    Value が 0 のセルは price 空・not_set・ref_value に Reported Only の値とし、note に「原本の Value は 0」と書く。
  - 1 戸あたり工事額(原本に無い値): Units > 0 かつ Value > 0 のとき、Value(千ドルなら x 1000)÷ Units をドル単位で 1 ドル未満四捨五入。
    price_basis "permit_valuation_per_unit_usd"。note に元の 2 行の obs_id を書く。
  - place は、その区分で 6 つの数(補完込み・報告のみの Bldgs, Units, Value)がすべて 0 の組は行にしない(郡・州・都市圏は全部の組を行にする)。
    省いた組の数は照合の出力に出す。

照合(全数): 郡の和 = 州、州 51(50 州 + DC)の和 = US 計、州の和 = Region / Division、place の和と州の比較、
  1-unit の Bldgs = Units、2-units の Units = 2 x Bldgs、3-4 units の Units が Bldgs の 3〜4 倍、5+ units の Units >= 5 x Bldgs。
結果は tools/parsers/out/census_bps_checks.json。
"""
import csv, io, os, re, sys, json, hashlib, collections

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from obs_common import make_id, num, write_obs, US_STATES

LIC = "US-PD-17USC105"
BASE = "https://www2.census.gov/econ/bps/"
CLASSES = ["1-unit", "2-units", "3-4 units", "5+ units"]
MEASURES = ["Bldgs", "Units", "Value"]
YEARS = list(range(2016, 2026))
YTD = "2608y"  # 2026 年 1〜8 月の年初来累計(2026-09-24 公表)
REGION_DIR = {"ne": "Northeast", "mw": "Midwest", "so": "South", "we": "West"}
CATEGORY = "Building Permits Survey: New Privately-Owned Residential Construction"
OLD_CODES = {("43", "Puerto Rico"): "72", ("52", "Virgin Islands"): "78"}
CENSUS_REGION = {"R1": "Northeast Region", "R2": "Midwest Region", "R3": "South Region", "R4": "West Region"}


def stems():
    out = []
    for lvl, pre in (("state", "st"), ("county", "co")):
        for y in YEARS:
            out.append((lvl, "%s%da" % (pre, y)))
        out.append((lvl, pre + YTD))
    for y in range(2016, 2024):
        out.append(("metro", "ma%da" % y))
    for y in (2024, 2025):
        out.append(("metro", "cbsa%da" % y))
    out.append(("metro", "cbsa" + YTD))
    for r in ("ne", "mw", "so", "we"):
        for y in YEARS:
            out.append(("place", "%s%da" % (r, y)))
        out.append(("place", r + YTD))
    return out


def url_of(stem):
    if stem.startswith("st"):
        return BASE + "State/%s.txt" % stem
    if stem.startswith("co"):
        return BASE + "County/%s.txt" % stem
    if stem.startswith("ma"):
        return BASE + "Metro%%20(ending%%202023)/%s.txt" % stem
    if stem.startswith("cbsa"):
        return BASE + "CBSA%%20(beginning%%20Jan%%202024)/%s.txt" % stem
    return BASE + "Place/%s%%20Region/%s.txt" % (REGION_DIR[stem[:2]], stem)


def period_of(stem):
    m = re.search(r"(\d{4})a$", stem)
    if m:
        return m.group(1), "Annual"
    m = re.search(r"(\d{2})(\d{2})y$", stem)
    return "20%s-%s" % (m.group(1), m.group(2)), "Year-to-Date (January through %s 20%s)" % (
        ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
         "November", "December"][int(m.group(2)) - 1], m.group(1))


def read_rows(stem):
    b = open(os.path.join(ROOT, "raw", "census-bps-%s.txt" % stem), "rb").read()
    t = b.decode("latin-1")
    rows = []
    header = []
    for line in t.splitlines():
        if not line.strip():
            continue
        r = next(csv.reader([line]))
        if re.match(r"^\d{4}", r[0].strip()):
            rows.append(r)
        elif not rows:
            header.append(line)
    return b, header, rows


def nums(r, start):
    """start から 12 列(4 区分 x Bldgs, Units, Value)を int のリストで。"""
    out = []
    for i in range(12):
        v = num(r[start + i].strip())
        out.append(int(v))
    return out


def main():
    obs_by_file = collections.defaultdict(list)
    checks = collections.OrderedDict()
    parsed = {}  # stem -> list of dict(geo=..., est=[12], rep=[12], ...)
    counts = collections.Counter()
    zero_value_notset = collections.Counter()
    percap_skipped = collections.Counter()
    place_skipped = collections.Counter()
    place_combos = collections.Counter()
    percap_rounded0 = []
    percap_small = []
    for lvl, stem in stems():
        b, header, rows = read_rows(stem)
        period, per_label = period_of(stem)
        sid = "census-bps-" + stem
        url = url_of(stem)
        thousand = lvl in ("state", "metro")
        recs = []
        for r in rows:
            d = {}
            if lvl == "state":
                assert len(r) == 29, (stem, r)
                code = r[1].strip()
                d.update(key=code, name=r[4].strip(), est=nums(r, 5), rep=nums(r, 17))
                if code == "US":
                    d.update(geo_level="national", geo_code="US", geo_name="United States", area_code="US")
                elif code in CENSUS_REGION:
                    d.update(geo_level="census_region", geo_code=code, geo_name=CENSUS_REGION[code], area_code=code)
                elif re.match(r"^D[1-9]$", code):
                    d.update(geo_level="census_region", geo_code=code, geo_name=r[4].strip(), area_code=code)
                elif (code, r[4].strip()) in OLD_CODES:
                    # 2016〜2021 年の州ファイルは Puerto Rico を 43、Virgin Islands を 52 で持つ(2022 年以降は FIPS 72, 78)
                    fips = OLD_CODES[(code, r[4].strip())]
                    d.update(geo_level="state", geo_code=fips, geo_name=US_STATES[fips], area_code=code)
                else:
                    assert code in US_STATES, (stem, code)
                    d.update(geo_level="state", geo_code=code, geo_name=US_STATES[code], area_code=code)
                d["extra"] = "Region code %s, Division code %s" % (r[2].strip(), r[3].strip())
                if (code, r[4].strip()) in OLD_CODES:
                    d["extra"] += "。原本の州コードは %s(%s)。geo_code は FIPS %s に写した" % (code, r[4].strip(), OLD_CODES[(code, r[4].strip())])
            elif lvl == "county":
                assert len(r) == 30, (stem, r)
                st, co = r[1].strip(), r[2].strip()
                assert st in US_STATES, (stem, st)
                d.update(key=st + co, name=r[5].strip(), est=nums(r, 6), rep=nums(r, 18), geo_level="county",
                         geo_code=st + co, geo_name=US_STATES[st], area_code=st + co,
                         extra="Region code %s, Division code %s" % (r[3].strip(), r[4].strip()))
            elif lvl == "metro":
                assert len(r) == 29, (stem, r)
                csa, cbsa, hc = r[1].strip(), r[2].strip(), r[3].strip()
                assert re.match(r"^\d{5}$", cbsa), (stem, cbsa)
                if stem.startswith("ma"):
                    extra = "CSA %s, Header Coverage Code %s" % (csa, hc if hc else "blank") + (
                        "(C = CSA/CBSA is completely covered by monthly permit issuing places)" if hc == "C" else "")
                else:
                    extra = "CSA %s, Header Code %s(%s)" % (csa, hc, {"2": "CBSA (Metropolitan) is part of a CSA",
                                                                    "4": "CBSA (Metropolitan) is NOT part of a CSA",
                                                                    "5": "CBSA (Micropolitan)"}[hc])
                d.update(key=cbsa, name=r[4].strip(), est=nums(r, 5), rep=nums(r, 17), geo_level="metro",
                         geo_code=cbsa, geo_name=r[4].strip(), area_code=cbsa, extra=extra)
            else:
                assert len(r) == 41, (stem, r)
                st, pid = r[1].strip(), r[2].strip()
                assert st in US_STATES and re.match(r"^\d{6}$", pid), (stem, st, pid)
                extra = ("ID %s; county %s; census place %s; FIPS place %s; MCD %s; CSA %s; CBSA %s; "
                         "months reported %s; footnote %s; central city %s" % (
                             pid, r[3].strip(), r[4].strip() or "blank", r[5].strip(), r[6].strip(), r[8].strip(),
                             r[9].strip(), r[15].strip(), r[10].strip() or "blank", r[11].strip() or "blank"))
                d.update(key=st + pid, name=r[16].strip(), est=nums(r, 17), rep=nums(r, 29), geo_level="city",
                         geo_code=st, geo_name=US_STATES[st], area_code=pid, extra=extra, county=st + r[3].strip())
            d["date"] = r[0].strip()
            recs.append(d)
        parsed[stem] = recs
        # 日付の欄と時点の一致
        dates = collections.Counter(d["date"] for d in recs)
        checks.setdefault("survey_date_field", {})[stem] = dict(dates)
        # 行を作る
        if lvl == "state":
            fkey = "state"
        elif "-" in period:
            fkey = "%s_%s_ytd%s" % (lvl, period[:4], period[5:])
        else:
            fkey = "%s_%s" % (lvl, period)
        vunit = "USD thousand" if thousand else "USD"
        vbasis = "permit_valuation_thousand_usd" if thousand else "permit_valuation_usd"
        for d in recs:
            for ci, cls in enumerate(CLASSES):
                est = d["est"][ci * 3:ci * 3 + 3]
                rep = d["rep"][ci * 3:ci * 3 + 3]
                if lvl == "place":
                    place_combos[stem] += 1
                    if not any(est) and not any(rep):
                        place_skipped[stem] += 1
                        continue
                ids = {}
                for mi, meas in enumerate(MEASURES):
                    oid = make_id(sid, d["key"], cls, meas)
                    ids[meas] = oid
                    v, rv = est[mi], rep[mi]
                    row = {
                        "obs_id": oid, "country": "US", "layer": "spending", "category": CATEGORY,
                        "item_name": cls,
                        "spec": "%s, Estimates with Imputation; %s" % (meas, per_label),
                        "geo_level": d["geo_level"], "geo_code": d["geo_code"], "geo_name": d["geo_name"],
                        "area_label": d["name"], "area_code": d["area_code"],
                        "period": period, "source_id": sid, "source_page": stem + ".txt", "evidence_url": url,
                        "license": LIC,
                        "ref_value": str(rv),
                        "ref_note": "Reported Only",
                    }
                    note = d["extra"]
                    if meas in ("Bldgs", "Units"):
                        row.update(unit="buildings" if meas == "Bldgs" else "housing units", price=str(v), currency="",
                                   price_basis="count", price_status="public_domain")
                    else:
                        row.update(unit=vunit, currency="USD", price_basis=vbasis)
                        if v == 0:
                            row.update(price="", price_status="not_set")
                            note = "原本の Value は 0(検査器が permit_valuation の 0 を値として受けないため not_set)。" + note
                            zero_value_notset[lvl] += 1
                        else:
                            row.update(price=str(v), price_status="public_domain")
                    row["note"] = note
                    obs_by_file[fkey].append(row)
                    counts[(lvl, row["price_status"])] += 1
                # 1 戸あたり工事額(原本に無い値)
                units, value = est[1], est[2]
                per = value * (1000 if thousand else 1) / units if units > 0 else 0
                if units > 0 and value > 0 and int(per + 0.5) == 0:
                    percap_rounded0.append((stem, d["name"], cls, value, units))
                elif units > 0 and value > 0:
                    per_s = str(int(per + 0.5))
                    row = {
                        "obs_id": make_id(sid, d["key"], cls, "Value per Unit"), "country": "US", "layer": "spending",
                        "category": CATEGORY, "item_name": cls,
                        "spec": "Value / Units, Estimates with Imputation; %s" % per_label,
                        "unit": "USD per housing unit",
                        "geo_level": d["geo_level"], "geo_code": d["geo_code"], "geo_name": d["geo_name"],
                        "area_label": d["name"], "area_code": d["area_code"],
                        "price": per_s, "currency": "USD", "price_basis": "permit_valuation_per_unit_usd",
                        "price_status": "public_domain",
                        "period": period, "source_id": sid, "source_page": stem + ".txt", "evidence_url": url,
                        "license": LIC,
                        "note": "原本に無い値。%s / %s(Value%s ÷ Units、1 ドル未満四捨五入。許可申請時の工事額で、土地代を含まない)" % (
                            ids["Value"], ids["Units"], " x 1000" if thousand else ""),
                    }
                    if per < 1000:
                        row["note"] += "。1 戸 1,000 ドル未満: 原本の Value が戸数に比べて極端に小さい(申告の誤りの疑い)"
                        percap_small.append((stem, d["name"], cls, value, units))
                    obs_by_file[fkey].append(row)
                    counts[(lvl, "computed")] += 1
                elif units > 0:
                    percap_skipped[lvl] += 1
    # 書く
    written = {}
    for fkey, rows in sorted(obs_by_file.items()):
        rows.sort(key=lambda o: (o["period"], o["geo_level"], o["geo_code"], o["area_code"], o["item_name"], o["spec"]))
        path = os.path.join(ROOT, "observations", "us", "spending_census_bps_%s.csv" % fkey)
        write_obs(path, rows)
        written[os.path.relpath(path, ROOT)] = {"rows": len(rows), "bytes": os.path.getsize(path),
                                                "sha256": hashlib.sha256(open(path, "rb").read()).hexdigest()}
    checks["files"] = written
    checks["rows_by_level_status"] = {"%s:%s" % k: v for k, v in sorted(counts.items())}
    checks["value_zero_not_set"] = dict(zero_value_notset)
    checks["per_unit_skipped_units_gt0_value0"] = dict(percap_skipped)
    checks["per_unit_skipped_rounds_to_0(stem,name,class,value,units)"] = percap_rounded0
    checks["per_unit_under_1000_usd_noted(stem,name,class,value,units)"] = percap_small
    checks["place_combos_total"] = dict(place_combos)
    checks["place_combos_all_zero_skipped"] = dict(place_skipped)
    run_checks(parsed, checks)
    write_ledgers(checks)
    os.makedirs(os.path.join(ROOT, "tools", "parsers", "out"), exist_ok=True)
    json.dump(checks, open(os.path.join(ROOT, "tools", "parsers", "out", "census_bps_checks.json"), "w"),
              ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in checks.items() if k not in ("survey_date_field",)}, ensure_ascii=False, indent=1)[:6000])


def run_checks(parsed, checks):
    periods = ["%da" % y for y in YEARS] + [YTD]
    res = collections.OrderedDict()
    for p in periods:
        st = {d["key"]: d for d in parsed["st" + p]}
        states51 = [k for k in st if k in US_STATES and int(k) <= 56]
        r = collections.OrderedDict()
        # (1) 州 51 の和 = US 計(24 列すべて)
        us = st["US"]
        diffs = [sum(st[k]["est"][i] for k in states51) - us["est"][i] for i in range(12)] + \
                [sum(st[k]["rep"][i] for k in states51) - us["rep"][i] for i in range(12)]
        def summ(dd):
            return {"cells": len(dd), "exact": sum(1 for i, x in enumerate(dd) if x == 0),
                    "exact_bldgs_units": sum(1 for i, x in enumerate(dd) if x == 0 and i % 3 != 2),
                    "max_abs_diff_bldgs_units": max(abs(dd[i]) for i in range(len(dd)) if i % 3 != 2),
                    "max_abs_diff_value_thousand": max(abs(dd[i]) for i in range(len(dd)) if i % 3 == 2)}
        r["states51_sum_minus_US"] = {"estimates": summ(diffs[:12]), "reported_only": summ(diffs[12:])}
        # (2) Region, Division = 州の和
        rd = []
        for code, d in st.items():
            if code in CENSUS_REGION or re.match(r"^D\d$", code):
                if code.startswith("R"):
                    mem = [k for k in states51 if st[k]["extra"].startswith("Region code %s," % code[1])]
                else:
                    mem = [k for k in states51 if st[k]["extra"].endswith("Division code %s" % code[1])]
                for i in range(12):
                    rd.append(sum(st[k]["est"][i] for k in mem) - d["est"][i])
                    rd.append(sum(st[k]["rep"][i] for k in mem) - d["rep"][i])
        r["region_division_sum"] = {"cells": len(rd), "exact": sum(1 for x in rd if x == 0),
                                    "max_abs_diff": max(abs(x) for x in rd)}
        # (3) 郡の和 = 州(Bldgs, Units は完全一致、Value は ドル÷1000 と千ドルの差)
        co = parsed["co" + p]
        agg = collections.defaultdict(lambda: [0] * 24)
        for d in co:
            a = agg[d["key"][:2]]
            for i in range(12):
                a[i] += d["est"][i]
                a[12 + i] += d["rep"][i]
        res3 = {}
        miss = []
        for part, off in (("estimates", 0), ("reported_only", 12)):
            cnt_cells = cnt_exact = val_cells = 0
            max_val = 0.0
            worst = None
            bad_states = collections.Counter()
            for s_ in states51 + [k for k in st if k in US_STATES and int(k) > 56]:
                if s_ not in agg:
                    if part == "estimates":
                        miss.append(s_)
                    continue
                a = agg[s_]
                for i in range(12):
                    sv = st[s_]["est" if off == 0 else "rep"][i]
                    av = a[off + i]
                    if i % 3 == 2:
                        val_cells += 1
                        dv = abs(av / 1000.0 - sv)
                        if dv > 0.5 + 1e-9:
                            bad_states[s_] += 1
                        if dv > max_val:
                            max_val, worst = dv, (s_, CLASSES[i // 3], av, sv)
                    else:
                        cnt_cells += 1
                        if av == sv:
                            cnt_exact += 1
                        else:
                            bad_states[s_] += 1
            res3[part] = {"count_cells": cnt_cells, "count_cells_exact": cnt_exact, "value_cells": val_cells,
                          "value_max_abs_diff_thousand_usd": round(max_val, 3),
                          "value_worst(state, class, county_sum_usd, state_thousand)": worst,
                          "states_with_any_mismatch": dict(bad_states)}
        r["county_sum_vs_state"] = {"states_without_county_rows": miss, "county_rows": len(co), **res3}
        # (4) place の和と州(参考。place には州の集計に入らない行(N)や郡部の重なりがありうる)
        pl = []
        for rg in ("ne", "mw", "so", "we"):
            pl += parsed[rg + p]
        pagg = collections.defaultdict(lambda: [0] * 12)
        for d in pl:
            a = pagg[d["geo_code"]]
            for i in range(12):
                a[i] += d["est"][i]
        pc = pe = 0
        pmax = 0.0
        for s, a in pagg.items():
            if s not in st:
                continue
            for i in range(12):
                sv = st[s]["est"][i]
                if i % 3 == 2:
                    pmax = max(pmax, abs(a[i] / 1000.0 - sv))
                else:
                    pc += 1
                    pe += (a[i] == sv)
        r["place_sum_vs_state"] = {"place_rows": len(pl), "states": len(pagg), "count_cells": pc,
                                   "count_cells_exact": pe, "value_max_abs_diff_thousand_usd": round(pmax, 3)}
        # (5) 行の中の整合: 1-unit Bldgs = Units、2-units Units = 2 x Bldgs、3-4 units 3B <= U <= 4B、5+ units U >= 5B
        bad = collections.Counter()
        tot = 0
        for lvlstem in [s for s in parsed if s.endswith(p)]:
            for d in parsed[lvlstem]:
                for arr in (d["est"], d["rep"]):
                    tot += 1
                    if arr[0] != arr[1]:
                        bad["1-unit B!=U"] += 1
                    if arr[4] != 2 * arr[3]:
                        bad["2-units U!=2B"] += 1
                    if not (3 * arr[6] <= arr[7] <= 4 * arr[6]):
                        bad["3-4 units out of 3B..4B"] += 1
                    if arr[10] < 5 * arr[9]:
                        bad["5+ units U<5B"] += 1
                    for i in range(4):
                        if arr[3 * i + 1] == 0 and arr[3 * i + 2] != 0:
                            bad["units 0 but value>0"] += 1
        r["row_internal"] = {"row_sets": tot, "violations": dict(bad)}
        # (6) Reported Only <= Estimates(全セル)
        over = 0
        cells = 0
        for lvlstem in [s for s in parsed if s.endswith(p)]:
            for d in parsed[lvlstem]:
                for i in range(12):
                    cells += 1
                    over += d["rep"][i] > d["est"][i]
        r["reported_gt_estimate_cells"] = {"cells": cells, "reported_gt_estimate": over}
        res[p] = r
    checks["reconciliation"] = res


LICENSE_QUOTE = ("Copyright protection under this title is not available for any work of the United States Government, but the "
                 "United States Government is not precluded from receiving and holding copyrights transferred to it by assignment, "
                 "bequest, or otherwise. (17 U.S.C. 105(a), https://www.law.cornell.edu/uscode/text/17/105) / Census Bureau, "
                 "Citing our Data, Tools, Technical Documents and Research, Public-Use Statement "
                 "(https://www.census.gov/about/policies/citation.html, Page Last Revised - February 24, 2026, Apify で 2026-09-26 に再取得して同文を確認): "
                 "\"Proper citation ensures that Census Bureau statistical products and research can be discovered, reused, replicated "
                 "for verification, and credited for recognition to measure usage and impact. Data users who create their own estimates "
                 "using data from disseminated tables and other data should cite the Census Bureau as the source of the original data only. "
                 "Conclusions drawn from any analysis of these data are the sole responsibility of the performing party.\"")
SCOPE_QUOTE = {
    "state": "These files provide building permit statistics on new privately-owned residential construction. These are provided for the 50 states and the District of Columbia sorted by FIPS State code, followed by aggregate totals for divisions, regions and the United States total. / Buildings, Units and Valuation Permit Data (valuation is shown in thousands of dollars.) (stateasc.pdf, February 9, 2022)",
    "county": "This file provides building permit statistics on new privately-owned residential construction. These are the County totals for all counties in which permit offices are requested to report. (cntyasc.pdf, February 9, 2022)",
    "metro": "These files provide building permit statistics on new privately-owned residential construction. These are provided for all CSAs and CBSAs in the United States sorted by CSA code and CBSA code. / Buildings, Units and Valuation Permit Data (valuation is shown in thousands of dollars) (msaasc.pdf February 9, 2022; cbsaasc.pdf 01/22/2024: Beginning with the January 2024 monthly and Annual 2024 BPS data releases, Micropolitan area data will be included in the existing Metropolitan data files.)",
    "place": "This file provides building permit statistics on new privately-owned residential construction. They are provided for individual permit-issuing jurisdictions. (placeasc.pdf, February 9, 2022) / (N) - Permit-issuing places identified since the 20,000-place universe was established in 2004 (selection actually took place in August 2003); activity for these places is not included in summary statistics.",
}
TWO_SETS = ("Two sets of data are shown for each type of construction: 1. Estimates with Imputation - includes reported data for monthly "
            "respondents and imputed data for nonrespondents. 2. Reported Only - includes only reported data for respondents.")
FETCH = {
    "small": ("apify/website-content-crawler(crawlerType cheerio, saveContentTypes text/plain, respectRobotsTxtFile false)で原本を "
              "key-value store に保存 → rationalistic_candle_ucn/bulk-file-downloader がその記録を取り直して bytes と sha256 を記録し zip(無圧縮)に → "
              "apify/web-fetch(raw, base64)で zip を受け取り、zip の CRC 検査正常、中のファイルの sha256 が bulk-file-downloader の記録と一致"),
    "county": ("apify/website-content-crawler(同上)で key-value store に保存 → bulk-file-downloader が bytes と sha256 を記録し zip に → "
               "apify/web-fetch(raw)で zip を受け取った。zip の見出し部の 2 進数が文字として読み替えられ壊れた(EF BF BD 108 か所)ため、"
               "zip 内のファイル名の直後から記録どおりのバイト数を切り出し、sha256 が bulk-file-downloader の記録と一致することを確かめた(原本は ASCII のみ)"),
    "place": ("apify/web-fetch(formats raw、text/plain を文字列で受け取り UTF-8 で書き戻し)で www2.census.gov から直接取得。"
              "別に apify/website-content-crawler で key-value store に保存したものを bulk-file-downloader が測った bytes と sha256 と一致(U+FFFD 0 個、非 ASCII 0 バイト)"),
}


def write_ledgers(checks):
    listing = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "census_bps_listing_20260926.json")))
    recon = checks["reconciliation"]
    for lvl, stem in stems():
        sid = "census-bps-" + stem
        path = os.path.join(ROOT, "raw", sid + ".txt")
        b = open(path, "rb").read()
        period, per_label = period_of(stem)
        p = stem[-5:] if stem[-1] == "a" else stem[-5:]
        pk = [k for k in recon if stem.endswith(k)][0]
        rc = recon[pk]
        if lvl in ("state", "metro"):
            fv = FETCH["small"]
        elif lvl == "county":
            fv = FETCH["county"]
        else:
            fv = FETCH["place"]
        extra_fetch = {"st2025a": "。別に apify/web-fetch(raw)で直接取得した 10,744 bytes と一致",
                       "ma2023a": "。別に apify/web-fetch(raw)で直接取得した 50,400 bytes と一致",
                       "co2025a": "。別に apify/web-fetch(raw)で直接取得したものと sha256 一致(Last-Modified Thu, 14 May 2026 13:45:24 GMT)",
                       "we2025a": "(Last-Modified Thu, 14 May 2026 12:15:24 GMT)"}.get(stem, "")
        lvl_name = {"state": "State", "county": "County", "metro": "Metro (ending 2023)" if stem.startswith("ma") else "CBSA (beginning Jan 2024)",
                    "place": "Place, %s Region" % REGION_DIR.get(stem[:2], "")}[lvl]
        how = ["tools/parsers/parse_census_bps.py。原本は latin-1 のカンマ区切り(見出し 2〜3 行の後に 1 地域 1 行)。"
               "4 区分(1-unit, 2-units, 3-4 units, 5+ units)x Bldgs/Units/Value の Estimates with Imputation を price、"
               "Reported Only を ref_value に。Value は %s。Units > 0 かつ Value > 0 の組に 1 戸あたり工事額(原本に無い計算値)を足した。"
               % ("千ドル(文書に明記)" if lvl in ("state", "metro") else "ドル(文書に単位の記載なし。郡の和 ÷ 1000 が州の千ドルの値と ±0.5 以内で一致することで確かめた)")]
        if lvl == "place":
            how.append("補完込み・報告のみの Bldgs/Units/Value の 6 つがすべて 0 の区分は行にしない(このファイルは %d 組のうち %d 組を省いた)。"
                       "geo_code は州 FIPS 2 桁(検査器の city の形が 2/5/6 桁のため、州 FIPS + place コード 7〜8 桁は入らない)、area_code は 6-Digit ID(州の中で一意)、"
                       "FIPS place / MCD / county / CBSA などは note に。" % (checks["place_combos_total"][stem], checks["place_combos_all_zero_skipped"][stem]))
        if lvl == "state":
            e = rc["states51_sum_minus_US"]
            how.append("照合: 50 州 + DC の和 = US 計(Estimates: Bldgs/Units 8 セル中 %d 一致・最大差 %d、Value 最大差 %d 千ドル。Reported Only: Bldgs/Units 8 セル中 %d 一致・最大差 %d、Value 最大差 %d 千ドル)。"
                       "Region 4 と Division 9 = 州の和(%d セル中 %d 一致、最大差 %d)。"
                       % (e["estimates"]["exact_bldgs_units"], e["estimates"]["max_abs_diff_bldgs_units"], e["estimates"]["max_abs_diff_value_thousand"],
                          e["reported_only"]["exact_bldgs_units"], e["reported_only"]["max_abs_diff_bldgs_units"], e["reported_only"]["max_abs_diff_value_thousand"],
                          rc["region_division_sum"]["cells"], rc["region_division_sum"]["exact"], rc["region_division_sum"]["max_abs_diff"]))
        if lvl in ("state", "county"):
            c = rc["county_sum_vs_state"]
            how.append("照合: 同じ時点の郡ファイルの州ごとの和 = 州ファイル(Estimates: Bldgs/Units %d セル中 %d 一致、Value 最大差 %s 千ドル。"
                       "Reported Only: %d セル中 %d 一致、Value 最大差 %s 千ドル)。"
                       % (c["estimates"]["count_cells"], c["estimates"]["count_cells_exact"], c["estimates"]["value_max_abs_diff_thousand_usd"],
                          c["reported_only"]["count_cells"], c["reported_only"]["count_cells_exact"], c["reported_only"]["value_max_abs_diff_thousand_usd"]))
            if stem.endswith(YTD):
                how.append("年初来累計(2026 年 1〜8 月)は州ファイルと郡ファイルが一致しない州がある(原本どうしの不一致。値は原本のまま)。")
        if lvl == "place":
            c = rc["place_sum_vs_state"]
            how.append("参考: 4 地域の place ファイルの州ごとの和と州ファイル(Estimates の Bldgs/Units %d セル中 %d 一致)。place には集計に入らない (N) の jurisdiction 等があり、完全一致は前提にしない。"
                       % (c["count_cells"], c["count_cells_exact"]))
        ri = rc["row_internal"]
        how.append("行の中の整合(同じ時点の全階層): 1-unit Bldgs = Units、2-units Units = 2 x Bldgs 等の違反 %s。Reported Only が Estimates を上回るセル %d。"
                   % (json.dumps(ri["violations"], ensure_ascii=False), rc["reported_gt_estimate_cells"]["reported_gt_estimate"]))
        led = collections.OrderedDict([
            ("source_id", sid), ("country", "US"),
            ("title", "Building Permits Survey, %s ASCII file %s.txt (%s, %s)" % (lvl_name, stem, period, per_label)),
            ("publisher", "U.S. Census Bureau, Economic Indicators Division (Building Permits Survey)"),
            ("url", url_of(stem)), ("landing", "https://www.census.gov/construction/bps/"),
            ("documentation", {"state": BASE + "Documentation/stateasc.pdf", "county": BASE + "Documentation/cntyasc.pdf",
                               "metro": BASE + "Documentation/" + ("msaasc.pdf" if stem.startswith("ma") else "cbsaasc.pdf"),
                               "place": BASE + "Documentation/placeasc.pdf"}[lvl]),
            ("retrieved_at", "2026-09-26"),
            ("published", listing[stem][0][:10]),
            ("http_last_modified", "ディレクトリ一覧の更新日時 %s(サーバーの現地時刻)、一覧のサイズ %s" % tuple(listing[stem])),
            ("bytes", len(b)), ("sha256", hashlib.sha256(b).hexdigest()),
            ("encoding", "latin-1(ASCII 以外は CBSA の Ca\\xf1on City の 1 バイトのみ)" if stem.startswith("cbsa") else "ASCII"),
            ("fetched_via", fv + extra_fetch),
            ("license", LIC), ("license_url", "https://www.law.cornell.edu/uscode/text/17/105"),
            ("license_quote", LICENSE_QUOTE),
            ("attribution", "Source: U.S. Census Bureau, Building Permits Survey, %s, %s, accessed on September 26, 2026" % (stem + ".txt", url_of(stem))),
            ("scope_quote", SCOPE_QUOTE[lvl] + " / " + TWO_SETS),
            ("how_read", "".join(how)),
            ("values_copied", True),
        ])
        json.dump(led, open(os.path.join(ROOT, "sources", sid + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
