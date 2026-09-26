# -*- coding: utf-8 -*-
"""
UFS 3-701-01 DoD Facilities Pricing Guide (31 July 2026) の Data Tables
(raw/dod-ufc-370101-2026.xlsx, WBDG "2026 Data Tables - updated (08-04-2026)") をセルで読み、
  observations/us/cost_sqft_dod_ufc370101_2026.csv  (Table 2 GUC, Table 3 PUC/SUC)
  observations/us/index_dod_acf_2026.csv            (Table 4-1 CONUS / OCONUS の Area Cost Factor)
  observations/us/work_dod_ufc370101_2026.csv       (Table 6 Supporting Facilities Unit Cost。値は入れない)
を作る。要約を通さない。

読み方: openpyxl(data_only)でセルを直接読む。照合として、同じ xlsx を zipfile + XML で独立に読み
(sharedStrings と <c r=..> を自前で解く)、使ったセル全部の値が一致することを確かめる(verify_xml)。

利用条件の判断(台帳 sources/dod-ufc-370101-2026.json に条文):
- UFS 本体は "APPROVED FOR PUBLIC RELEASE; DISTRIBUTION UNLIMITED"、著者 Department of Defense。連邦政府の著作物(17 U.S.C. 105)。
- ただし AGENT_RULES 3 により、表の中で市販の物価資料・評価サービス由来と示されたセルは値を入れない:
  Table 3 の Source Description が Marshall & Swift / RSMeans / CostWorks / "Commercial" を含む PUC・SUC、
  "Set (equal) to FAC xxxx" 等で参照先がそれらに当たるもの、構成の示されていない "Composite of ... FACs"。
  Table 6 は UFS 6-3.1 のとおり "2025 Costbook database"(TRACES/MII の Cost Book。RSMeans data を含む)から組んだ単価なので全行値なし。
"""
import os, re, sys, json, zipfile, collections
import xml.etree.ElementTree as ET
import openpyxl

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from obs_common import make_id, num, write_obs, US_STATES

SID = "dod-ufc-370101-2026"
XLSX = os.path.join(ROOT, "raw", "dod-ufc-370101-2026.xlsx")
URL = "https://nibs-s3-wbdg3-production.s3.us-east-1.amazonaws.com/media/2026-08/ufs_3_701_01_July_2026_Data_Tables_v2_1785874580922_xtunm5w6d8s.xlsx"
LIC = "US-PD-17USC105"
OUT_COST = os.path.join(ROOT, "observations", "us", "cost_sqft_dod_ufc370101_2026.csv")
OUT_ACF = os.path.join(ROOT, "observations", "us", "index_dod_acf_2026.csv")
OUT_T6 = os.path.join(ROOT, "observations", "us", "work_dod_ufc370101_2026.csv")

STATE_FIPS = {v.lower(): k for k, v in US_STATES.items()}
# OCONUS の Country 欄(原文)→ 米国の州・領土なら FIPS、外国なら ISO 3166-1 alpha-2
US_TERRITORY = {"Guam": "66", "Puerto Rico": "72", "Northern Mariana Islands": "69", "American Samoa": "60",
                "Virgin Islands": "78", "Virgin Islands, U.S.": "78"}
ISO2 = {"Afghanistan": "AF", "Albania": "AL", "Antigua and Barbuda": "AG", "Aruba": "AW", "Australia": "AU",
        "Bahrain": "BH", "Belgium": "BE", "Bulgaria": "BG", "Burkina Faso": "BF", "Cambodia": "KH", "Canada": "CA",
        "Colombia": "CO", "Costa Rica": "CR", "Croatia": "HR", "Cuba": "CU", "Cyprus": "CY", "Denmark": "DK",
        "Diego Garcia": "IO", "Djibouti": "DJ", "Egypt": "EG", "El Salvador": "SV", "Estonia": "EE",
        "Georgia Republic": "GE", "Germany": "DE", "Greece": "GR", "Greenland": "GL", "Honduras": "HN",
        "Hong Kong": "HK", "Iceland": "IS", "Iraq": "IQ", "Israel": "IL", "Italy": "IT", "Japan": "JP",
        "Johnston Atoll": "UM", "Kenya": "KE", "Kuwait": "KW", "Latvia": "LV", "Lithuania": "LT",
        "Marshall Islands": "MH", "Netherlands": "NL", "Netherlands Antilles": "AN", "Norway": "NO", "Oman": "OM",
        "Peru": "PE", "Philippines": "PH", "Poland": "PL", "Portugal": "PT", "Qatar": "QA", "Romania": "RO",
        "Saint Helena": "SH", "Saudi Arabia": "SA", "Singapore": "SG", "South Korea": "KR", "Spain": "ES",
        "Thailand": "TH", "Turkey": "TR", "United Arab Emirates": "AE", "United Kingdom": "GB", "Wake Island": "UM"}
ISO_NOTE = {"AN": "Netherlands Antilles の ISO 3166-1 コード AN は 2010 年に削除された旧コード(原本の国名のまま)",
            "UM": "ISO 3166-1 では United States Minor Outlying Islands(UM)",
            "IO": "Diego Garcia は ISO 3166-1 では British Indian Ocean Territory(IO)"}

COMMERCIAL = re.compile(r"marshall|m\s*&\s*s\b|r\.?\s*s\.?\s*mean|rsmean|\bmeans\b|cost\s*works|commercial", re.I)
FACREF = re.compile(r"(?:set\s+(?:equal\s+)?to|ratio\s+based\s+on|based\s+on)\s+FAC\s*(\d{4})", re.I)
COMPOSITE = re.compile(r"composite", re.I)


def txt(v):
    if v is None:
        return ""
    return re.sub(r"\s+", " ", str(v)).strip()


def fmt_display(v, fmt):
    """Excel の表示形式での丸め(0 / 0.00 / #,##0 / "$"#,##0.00 だけを扱う)。表示と違えば文字を返す。"""
    m = re.search(r"0(?:\.(0+))?(?![0-9.])", fmt.replace("#,##", ""))
    if fmt in ("General", "@") or not m:
        return None
    d = len(m.group(1) or "")
    s = ("%." + str(d) + "f") % v
    return num(s)


def classify(desc, fac, col, table3, seen=None):
    """PUC/SUC の Source Description から値を入れてよいか。('open'|'commercial'|'unresolved', 理由)"""
    d = txt(desc)
    if COMMERCIAL.search(d):
        return "commercial", "Source Description が市販の資料・評価サービスを示す: %s" % d
    m = FACREF.search(d)
    if m:
        ref = m.group(1)
        seen = (seen or set()) | {fac}
        if ref in seen or ref not in table3:
            return "unresolved", "参照先 FAC %s を表の中でたどれない: %s" % (ref, d)
        rdesc = table3[ref][col]
        k, why = classify(rdesc, ref, col, table3, seen)
        return k, "FAC %s を参照(%s)。参照先: %s" % (ref, d, why)
    if COMPOSITE.search(d):
        return "unresolved", "構成する FAC が示されていない複合(%s)。構成の出所を確かめられない" % d
    return "open", d


def table2(ws, rows):
    cat = ""
    stats = collections.Counter()
    for r in range(6, ws.max_row + 1):
        a, b, c, d, e, f, g, h = [ws.cell(r, k).value for k in range(1, 9)]
        if a is None:
            continue
        name = txt(a)
        if name.startswith(("*", "/")):
            continue  # 表の下の注
        if c is None and b is None and e is None:
            cat = name
            continue
        tower = (b == "VM")
        units = [("C", c, "USD/VM" if tower else "USD/m2", "($/m2)" if not tower else "($/VM)", b, "gross m2"),
                 ("E", e, "USD/VF" if tower else "USD/SF", "($/SF)" if not tower else "($/VF)", d, "gross SF")]
        for col, val, unit, hdr, ref, refu in units:
            spec = []
            if tower:
                spec.append("Unit cost based on vertical meter (VM) or vertical feet (VF) of tower")
            elif ref is not None:
                spec.append("Reference Size %s %s" % (num(ref), refu))
            spec.append("Number of Projects %s" % (num(h) if h is not None else "(空欄)"))
            row = dict(country="US", layer="cost_sqft", category="Table 2: Facility Unit Costs for Military Construction / " + cat,
                       item_name=name, spec="; ".join(spec), unit=unit, geo_level="national", geo_code="US",
                       geo_name="United States", price_basis="facility_unit_cost_guc", period="2025-10",
                       source_id=SID, source_page="Table 2!%s%d" % (col, r), evidence_url=URL, license=LIC)
            note = ["Oct 2025 unit cost (GUC) %s。ACF=1(96 Base City 平均)に正規化、2025-10-01 に DoD-SPI で escalate、SIOH・設計・contingency 等を含まない(UFS 3-701-01 2-3)" % hdr]
            if isinstance(val, (int, float)):
                row["price"] = num(repr(float(val)) if isinstance(val, float) else str(val))
                row["price_status"] = "public_domain"
                row["currency"] = "USD"
                disp = fmt_display(val, ws["%s%d" % (col, r)].number_format)
                if disp is not None and disp != row["price"]:
                    note.append("セルの値。Excel の表示形式では %s" % disp)
                if col == "E" and isinstance(f, (int, float)):
                    row["ref_value"] = num(repr(float(f)))
                    row["ref_note"] = "Standard Deviation %s(セルの値)。Standard Deviation/GUC pct %s" % (hdr, num(repr(float(g)))) if isinstance(g, (int, float)) else "Standard Deviation %s(セルの値)" % hdr
                stats["open"] += 1
            else:
                row["price"] = ""
                row["price_status"] = "not_set"
                row["currency"] = "USD"
                note.append("原本は %r: ** Insufficient pricing data in the Historic Analysis Generator (HII) database" % txt(val))
                stats["not_set"] += 1
            if "***" in name:
                note.append("*** Inssufficient projects to include small and large High Bay w/Simulation Training Facility; single GUC published for this facility(原文)")
            for k, t in (("/1/", "Excludes Boilers and Chillers, which are located in a Central Utility Plant (CUP)"),
                         ("/2/", "Includes Boilers and Chillers in the facility"),
                         ("/3/", "DoDEA developed one price based on OCONUS projects (Use appropriate ACF)"),
                         ("/4/", "Parking garage include mix of facilities with sprinklers and without sprinklers")):
                if k in name:
                    note.append("%s %s(原文の注)" % (k, t))
            row["note"] = "。".join(note)
            row["obs_id"] = make_id(SID, "Table 2", r, col)
            rows.append(row)
    return stats


def table3(ws, legend, rows):
    data = collections.OrderedDict()
    for r in range(5, ws.max_row + 1):
        v = [ws.cell(r, k).value for k in range(1, 11)]
        if v[0] is None and v[1] is None:
            continue
        fac = txt(v[0])
        assert re.match(r"^\d{4}$", fac), (r, v[0])
        data[fac] = {"r": r, "v": v, "PUC": v[6], "SUC": v[9]}
    stats = collections.Counter()
    for fac, dct in data.items():
        r, v = dct["r"], dct["v"]
        um = txt(v[2])
        umd = legend.get(um, "")
        base = dict(country="US", layer="cost_sqft", category="Table 3: Unit Costs for DoD Facility Cost Models (FY2026)",
                    item_name="FAC %s %s" % (fac, txt(v[1])), geo_level="national", geo_code="US", geo_name="United States",
                    period="FY2026", source_id=SID, evidence_url=URL, license=LIC, currency="USD")
        for kind, col, vcol, gcol, dcol, extra in (
                ("PUC", "D", 3, 4, 6, "PUC Reference Size (Gross SF) %s" % txt(v[5])),
                ("SUC", "H", 7, 8, 9, "")):
            val, grp, desc = v[vcol], txt(v[gcol]), txt(v[dcol])
            spec = ["UM %s%s" % (um, " (%s)" % umd if umd else ""), "%s Source Group %s" % (kind, grp or "(空欄)")]
            if extra:
                spec.append(extra)
            spec.append("%s Source Description: %s" % (kind, desc or "(空欄)"))
            row = dict(base, spec="; ".join(spec),
                       unit=("USD/%s" % um) if kind == "PUC" else ("USD/%s/yr" % um),
                       price_basis="facility_prv_unit_cost" if kind == "PUC" else "facility_sustainment_unit_cost_annual",
                       source_page="Table 3!%s%d" % (col, r))
            note = ["PRV Unit Cost ($ FY 2026)。Plant Replacement Value の算定用(PRV = Q x PUC x ACF x HF x PD x SIOH x CF)。個別の工事見積には使わない(UFS 3-2.1)"
                    if kind == "PUC" else
                    "Sustainment Unit Cost ($ FY2026)。1 年あたりの維持費の平均(UFS 3-3.2 SR = Q x SUC x SACF x I)"]
            note.append("(Not to be used for military construction projects)(表題の注)")
            if isinstance(val, (int, float)) and val != 0:
                k, why = classify(desc, fac, kind, data)
                if k == "open":
                    row["price"] = num(repr(float(val)))
                    row["price_status"] = "public_domain"
                    disp = fmt_display(val, ws["%s%d" % (col, r)].number_format)
                    if disp is not None and disp != row["price"]:
                        row["ref_value"] = disp
                        row["ref_note"] = "Excel の表示形式(%s)で丸めた表示値" % ws["%s%d" % (col, r)].number_format
                else:
                    row["price"] = ""
                    row["price_status"] = "publication_based_not_public"
                    note.append("値は原本にあるが入れない: " + why + ("(参照先・構成の出所が分からないため開けない)" if k == "unresolved" else ""))
                stats["%s:%s" % (kind, k)] += 1
            else:
                row["price"] = ""
                row["price_status"] = "not_set"
                note.append("原本は %r(%s)" % (txt(val) if val is not None else "空欄", desc or "説明なし"))
                stats["%s:not_set" % kind] += 1
            row["note"] = "。".join(note)
            row["obs_id"] = make_id(SID, "Table 3", fac, kind)
            rows.append(row)
    return stats, len(data)


def acf(ws, sheet, rows):
    hdr = [txt(ws.cell(1, k).value) for k in range(1, ws.max_column + 1)]
    oconus = "OCONUS" in sheet
    ix = {h: i for i, h in enumerate(hdr) if h}
    cols = (("AREA COST FACTOR", "M", "area_cost_factor"), ("Sustainment ACF", "N", "sustainment_area_cost_factor")) if not oconus else \
           (("Area Cost Factor", "M", "area_cost_factor"), ("Sustainment Area Cost Factor", "N", "sustainment_area_cost_factor"))
    seen = collections.Counter()
    full = {}
    stats = collections.Counter()
    for r in range(2, ws.max_row + 1):
        v = [ws.cell(r, k).value for k in range(1, len(hdr) + 1)]
        if all(x is None for x in v[:14]):
            continue
        g = lambda h: txt(v[ix[h]]) if h in ix else ""
        rpsuid = g("RPSUID")
        site = g("Site Name")
        country = g("Country")
        if not oconus:
            st = g("State")
            fips = STATE_FIPS[st.lower()]
            geo = dict(geo_level="state", geo_code=fips, geo_name=US_STATES[fips])
        elif country in US_TERRITORY:
            fips = US_TERRITORY[country]
            geo = dict(geo_level="state", geo_code=fips, geo_name=US_STATES[fips])
        else:
            iso = ISO2[country]
            geo = dict(geo_level="country", geo_code=iso, geo_name=country)
        spec = []
        for h in ("Site Code", "Installation Code", "Installation Name", "Site Reporting Component Code",
                  "Site Operational Status code", "Address Street Name"):
            if h in ix and g(h):
                spec.append("%s: %s" % (h, g(h)))
        members = []
        for h in ("Country", "State", "County", "City", "Zip"):
            if h in ix and g(h):
                members.append("%s: %s" % (h, g(h)))
        key = tuple(txt(x) for x in v[:14])
        seen[(rpsuid, "; ".join(spec), "; ".join(members))] += 1
        dup = seen[(rpsuid, "; ".join(spec), "; ".join(members))]
        if dup > 1:
            spec.append("原本で同じ内容の行が重なる(%d 行目)" % dup)
        for hname, col, basis in cols:
            val = v[ix[hname]]
            row = dict(country="US", layer="index", category="Table 4-1 %s: Area Cost Factors" % ("OCONUS" if oconus else "CONUS"),
                       item_name=hname, spec="; ".join(spec), unit="index (96 Base City average = 1.00)",
                       area_label=site or ("(Site Name 空欄) %s %s" % (country, g("City"))).strip(),
                       area_code=("RPSUID %s" % rpsuid) if rpsuid else "",
                       area_members="; ".join(members), currency="", price_basis=basis, period="FY2026",
                       source_id=SID, source_page="%s!%s%d" % (sheet, col, r), evidence_url=URL, license=LIC, **geo)
            note = ["MILCON ACF(MLE 比 63/35/2)" if basis == "area_cost_factor" else "Sustainment ACF(MLE 比 46/53/1)"]
            note.append("2025 年の調査、96 Base City 平均 = 1.00(UFS 3-701-01 4-1.2, 4-1.3)")
            if oconus:
                note.append("Currency: %s; Exchange Rate: %s(原本の同じ行)" % (g("Currency"), g("Exchange Rate")))
                if geo["geo_level"] == "country" and geo["geo_code"] in ISO_NOTE:
                    note.append(ISO_NOTE[geo["geo_code"]])
                if not rpsuid:
                    note.append("RPSUID・Site 欄が空で City が 'Unknown' の行(国ごとの既定値とみられる)")
            if isinstance(val, (int, float)):
                row["price"] = num(repr(float(val)))
                row["price_status"] = "public_domain"
                disp = fmt_display(val, ws["%s%d" % (col, r)].number_format)
                if disp is not None and disp != row["price"]:
                    row["ref_value"] = disp
                    row["ref_note"] = "Excel の表示形式(0.00)で丸めた表示値"
                stats["open"] += 1
            else:
                row["price"] = ""
                row["price_status"] = "not_set"
                note.append("原本のセルが %r" % val)
                stats["not_set"] += 1
            row["note"] = "。".join(note)
            row["obs_id"] = make_id(SID, sheet, r, col)
            rows.append(row)
        stats["sites"] += 1
    return stats


def table6(ws, rows):
    cat = sub = ""
    stats = collections.Counter()
    for r in range(7, ws.max_row + 1):
        a, b, c, d, e, f, g, h, i = [ws.cell(r, k).value for k in range(1, 10)]
        if a is None and b is None:
            continue
        tag = txt(a)
        if re.match(r"^\d{5}$", tag):
            cat = txt(b); sub = ""
            continue
        if re.match(r"^\d{5}-\d+$", tag):
            sub = txt(b)
            continue
        assert re.match(r"^\d{5}-\d+-\d+$", tag), (r, a, b)
        stats["items"] += 1
        for side, q, u, val, colv in (("左の欄(見出し Standard)", c, d, e, "E"), ("右の欄", g, h, i, "I")):
            uu = txt(u)
            row = dict(country="US", layer="work", category="Table 6: Supporting Facilities Unit Cost / " + cat,
                       item_name="%s %s" % (tag, txt(b)), spec="%s; Quantity %s; UoM %s; 見出し %s" % (side, txt(q), uu, sub),
                       unit="USD/%s" % uu if uu else "USD", geo_level="national", geo_code="US", geo_name="United States",
                       price="", currency="USD", price_basis="supporting_facility_unit_cost",
                       price_status="publication_based_not_public" if val is not None else "not_set",
                       period="2025-10", source_id=SID, source_page="Table 6!%s%d" % (colv, r), evidence_url=URL, license=LIC,
                       note="Oct 2025 UNIT COST。値は原本にあるが入れない: UFS 3-701-01 6-3.1 によりこの表の単価は '2025 Costbook database'(TRACES/MII の Cost Book。USACE と Gordian の契約で RSMeans data を組み込む)の cost item から組んだもの。市販の物価資料の値に由来するため(AGENT_RULES 3)。原本で見る。contractor mark-ups 込み、location adjustment・escalation・design build・contingency・SIOH を含まない")
            row["obs_id"] = make_id(SID, "Table 6", r, colv)
            rows.append(row)
            stats[row["price_status"]] += 1
    return stats


# ---- 照合: xlsx を XML で独立に読む ----
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def xml_sheets():
    z = zipfile.ZipFile(XLSX)
    ss = []
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    for si in root.findall("m:si", NS):
        ss.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rid = {r.get("Id"): r.get("Target") for r in rels}
    out = {}
    for s in wb.find("m:sheets", NS):
        name = s.get("name")
        target = rid[s.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")]
        x = ET.fromstring(z.read("xl/" + target.lstrip("/").replace("xl/", "")))
        cells = {}
        for c in x.iter("{%s}c" % NS["m"]):
            t = c.get("t")
            vv = c.find("m:v", NS)
            if t == "s":
                cells[c.get("r")] = ss[int(vv.text)]
            elif t == "inlineStr":
                cells[c.get("r")] = "".join(tt.text or "" for tt in c.iter("{%s}t" % NS["m"]))
            elif vv is not None:
                cells[c.get("r")] = vv.text
        out[name] = cells
    return out


def verify_xml(rows, wb):
    xs = xml_sheets()
    n = bad = 0
    for row in rows:
        if not row.get("price"):
            continue
        sheet, ref = row["source_page"].split("!")
        xv = xs[sheet].get(ref)
        n += 1
        if xv is None or abs(float(xv) - float(row["price"])) > 1e-9 * max(1, abs(float(xv))):
            bad += 1
    # 文字の欄: ACF の Site Name と Table 3 の FAC 番号を XML でも数える
    return n, bad


def main():
    wb = openpyxl.load_workbook(XLSX, data_only=True)
    legend = {}
    for rr in wb["Legend"].iter_rows(min_row=3, values_only=True):
        if rr[0] and rr[1] == "=" and rr[2]:
            for k in str(rr[0]).split("/"):
                legend[k.strip()] = txt(rr[2])
    cost, acfrows, t6 = [], [], []
    s2 = table2(wb["Table 2"], cost)
    s3, nfac = table3(wb["Table 3"], legend, cost)
    sa1 = acf(wb["Table 4-1 CONUS"], "Table 4-1 CONUS", acfrows)
    sa2 = acf(wb["Table 4-1 OCONUS"], "Table 4-1 OCONUS", acfrows)
    s6 = table6(wb["Table 6"], t6)
    n1 = write_obs(OUT_COST, cost)
    n2 = write_obs(OUT_ACF, acfrows)
    n3 = write_obs(OUT_T6, t6)
    vx = verify_xml(cost + acfrows, wb)
    # 照合: Correction Log の行番号と RPSUID
    cl = {}
    for rr in wb["Correction Log"].iter_rows(min_row=5, values_only=True):
        if rr[0]:
            cl[txt(rr[0])] = [txt(x) for x in rr[1:6]]
    con, ocon = wb["Table 4-1 CONUS"], wb["Table 4-1 OCONUS"]
    chk = {"003": {"M4317_rpsuid": con["A4317"].value, "M5693_rpsuid": con["A5693"].value},
           "004": {"M605_rpsuid": ocon["A605"].value, "M736_rpsuid": ocon["A736"].value},
           "002": {"row389": [ocon["C389"].value, ocon["M389"].value, ocon["N389"].value]}}
    # 照合: Table 3 の PUC で出所が "Table 2, UFS 3-701-01" のものと Table 2 の $/SF
    guc = {}
    for rr in wb["Table 2"].iter_rows(min_row=6, max_row=97, values_only=True):
        if isinstance(rr[4], (int, float)):
            guc.setdefault(round(rr[4], 2), rr[0])
    t2ref = collections.Counter()
    for rr in wb["Table 3"].iter_rows(min_row=5, values_only=True):
        if rr[6] and re.search(r"Table 2, UFS 3-701-01", str(rr[6])):
            if isinstance(rr[3], (int, float)) and round(rr[3], 2) in guc:
                t2ref["exact"] += 1
            elif isinstance(rr[3], (int, float)) and any(abs(round(k) - rr[3]) < 1e-9 for k in guc):
                t2ref["display_rounded"] += 1
            else:
                t2ref["other"] += 1
    rep = {"rows": {"cost_sqft": n1, "acf": n2, "table6": n3}, "table2": dict(s2), "table3": dict(s3), "table3_facs": nfac,
           "acf_conus": dict(sa1), "acf_oconus": dict(sa2), "table6": dict(s6),
           "verify_xml_values": {"compared": vx[0], "mismatch": vx[1]}, "correction_log": cl, "correction_log_cells": chk,
           "table3_puc_from_table2": dict(t2ref)}
    print(json.dumps(rep, ensure_ascii=False, indent=1, default=str))


if __name__ == "__main__":
    main()
