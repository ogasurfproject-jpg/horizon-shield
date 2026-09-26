# -*- coding: utf-8 -*-
"""
test/fixtures/obs2 を作る(hs-jccdb-obs v0.2 の検査用)。

  1. 観測層 v2 の実ファイル4本と台帳4本と tools/extra_enums を、そのまま写す(2026-09-26 の snapshot)。
     検査の数(奈良の生コン 72 行など)が、他の担当がファイルを足しても動かないように写しを持つ。
  2. まだ取り込まれていない layer(work / wage / bid_item / equipment / spending / cost_sqft / 日本の index)と、
     労務単価の過去年の形を試すための「試験用」の行を作る。
     値はすべて架空。source_id は test-fixture- で始まり、台帳の title と各行の note に「試験用」と書く。
     evidence_url は https://example.invalid/(存在しない領域)。本番の sql_v2 には入らない(make_d1_sql_v2.py は
     観測層 v2 のルートしか読まない)。

使い方: python3 test/fixtures/make_fixtures.py [<観測層 v2 のルート>]   (既定 /home/claude/work/obs2、環境変数 OBS2 でも可)
"""
import hashlib, json, os, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OBS2 = os.path.abspath(os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("OBS2", "/home/claude/work/obs2")))
sys.path.insert(0, os.path.join(OBS2, "tools"))
from obs_common import make_id, write_obs  # noqa: E402

OUT = os.path.join(HERE, "obs2")
REAL = [
    ("observations/jp/labor_mlit_roumu_r8.csv", "sources/mlit-roumu-r8.json"),
    ("observations/jp/material_kkr_namacon_r8_09.csv", "sources/kkr-zairyo-r8-09.json"),
    ("observations/us/index_fhwa_nhcci.csv", "sources/fhwa-nhcci.json"),
]
TEST_NOTE = "試験用の架空の値。実データではない。/ TEST FIXTURE: synthetic value, not real data."
TEST_URL = "https://example.invalid/jccdb-test-fixture/"
TEST_SHA = hashlib.sha256(b"hs-jccdb-obs v0.2 test fixture (synthetic)").hexdigest()


def ledger(sid, country, lic, what, attribution=True, values=True):
    d = {
        "source_id": sid, "country": country,
        "title": "試験用 (TEST FIXTURE, not real data): " + what,
        "publisher": "hs-jccdb-obs test harness", "url": TEST_URL + sid, "retrieved_at": "2026-09-26",
        "license": lic, "license_url": TEST_URL + "license",
        "license_quote": "試験用。実在の利用条件ではない。/ Test fixture; not a real licence text.",
        "how_read": "test/fixtures/make_fixtures.py が書いた架空の行。/ Written by make_fixtures.py.",
        "values_copied": values, "sha256": TEST_SHA,
    }
    if attribution:
        d["attribution"] = "試験用の帰属表示 (" + sid + ")"
    json.dump(d, open(os.path.join(OUT, "sources", sid + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def row(sid, **kw):
    r = {"note": TEST_NOTE, "evidence_url": TEST_URL + sid, "source_id": sid}
    r.update(kw)
    key = [sid] + [kw.get(k, "") for k in ("layer", "item_name", "spec", "geo_code", "area_label", "area_code", "period", "price_basis")]
    r["obs_id"] = make_id(*key)
    return r


def main():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    for d in ("observations/jp", "observations/us", "observations_restricted/jp", "sources"):
        os.makedirs(os.path.join(OUT, d))
    for csv_rel, src_rel in REAL:
        shutil.copy2(os.path.join(OBS2, csv_rel), os.path.join(OUT, csv_rel))
        shutil.copy2(os.path.join(OBS2, src_rel), os.path.join(OUT, src_rel))
    # 検査器が読む許可一覧の追加分(extra_enums)も写す。着工統計の construction_cost_planned_total などはここで許されている。
    shutil.copytree(os.path.join(OBS2, "tools", "extra_enums"), os.path.join(OUT, "tools", "extra_enums"))

    # 労務単価の過去年の形(試験用)。奈良・北海道・東京の数職種と、今年は無い職種を1つ。
    sid = "test-fixture-labor-r7"
    ledger(sid, "JP", "PDL1.0", "公共工事設計労務単価の過去年の形")
    L = []
    for code, name, job, v in (("29", "奈良県", "大工", 25000), ("29", "奈良県", "左官", 24000), ("01", "北海道", "大工", 23000),
                               ("13", "東京都", "大工", 27000), ("01", "北海道", "試験用職種(廃止)", 20000)):
        L.append(row(sid, country="JP", layer="labor", category="労務単価", item_name=job, spec="所定労働時間内8時間あたり", unit="人日",
                     geo_level="pref", geo_code=code, geo_name=name, price=str(v), currency="JPY", price_basis="labor_wage_8h",
                     price_status="published_pdl", period="2025-03", effective_from="2025-03-01", license="PDL1.0"))
    write_obs(os.path.join(OUT, "observations/jp/labor_test_fixture_r7.csv"), L)

    # 施工パッケージの形(試験用)。実ファイル(work_mlit_sekou_package*)と同じ形: 構成比の行は item_name が「<単価の行の品目名> 構成比 <内訳>」、
    # spec は単価の行と同じ、note に「標準単価の行 obs_id=<16桁> の構成比」。内訳の内訳(機械 K1)もある。大阪の構成比は obs_id を書かない形(添え先を名前で探す道)。
    sid = "test-fixture-jp-work"
    ledger(sid, "JP", "PDL1.0", "施工パッケージ型積算の標準単価と構成比の形")
    W = []
    for code, name, area, base, link in (("13", "東京都", "東京地区(試験用)", 1000, True), ("27", "大阪府", "大阪地区(試験用)", 900, False)):
        for item, spec, add in (("掘削(試験用)", "土質：土砂 | 障害の有無：無し", 0), ("盛土(試験用)", "路体 | 施工数量：10000m3未満", 500)):
            pkg = row(sid, country="JP", layer="work", category="土工(試験用)", item_name=item, spec=spec, unit="m3",
                      geo_level="pref", geo_code=code, geo_name=name, area_label=area, price=str(base + add), currency="JPY",
                      price_basis="work_unit_price_ex_tax", price_status="published_pdl", period="2025-04", effective_from="2026-04-01",
                      license="PDL1.0")
            W.append(pkg)
            for part, pct in (("機械", 45), ("機械 K1", 45), ("労務", 35), ("材料", 20)):
                W.append(row(sid, country="JP", layer="work", category="土工(試験用)", item_name=item + " 構成比 " + part, spec=spec, unit="%",
                             geo_level="pref", geo_code=code, geo_name=name, area_label=area, price=str(pct), currency="",
                             price_basis="ratio", price_status="published_pdl", period="2025-04", effective_from="2026-04-01",
                             license="PDL1.0", note=TEST_NOTE + (" 標準単価の行 obs_id=%s の構成比" % pkg["obs_id"] if link else "")))
    write_obs(os.path.join(OUT, "observations/jp/work_test_fixture.csv"), W)

    # 着工統計の形(試験用)。床面積(count, ㎡)と工事費予定額(万円)と、原本に無い 1m2 あたり(組み立てで計算、note に「原本に無い値」)。
    sid = "test-fixture-jp-chakko"
    ledger(sid, "JP", "GOV-STD-2.0", "建築着工統計の都道府県別 床面積・工事費予定額の形")
    C = []
    for code, name, m2, man in (("29", "奈良県", 1000, 30000), ("13", "東京都", 2000, 90000)):
        for spec, unit, v, basis, cur, note in (("床面積の合計(㎡)", "㎡", m2, "count", "", TEST_NOTE),
                                               ("工事費予定額(万円)", "万円", man, "construction_cost_planned_total", "JPY", TEST_NOTE),
                                               ("工事費予定額(万円)x10000÷床面積の合計(㎡)", "円/m2", man * 10000 // m2, "cost_per_m2", "JPY",
                                                TEST_NOTE + " 原本に無い値: 工事費予定額 x 10000 ÷ 床面積の合計")):
            C.append(row(sid, country="JP", layer="cost_sqft", category="着工建築物(試験用)", item_name="総計(試験用)", spec=spec, unit=unit,
                         geo_level="pref", geo_code=code, geo_name=name, price=str(v), currency=cur, price_basis=basis,
                         price_status="published_cc_by", period="2025", license="GOV-STD-2.0", note=note))
    write_obs(os.path.join(OUT, "observations/jp/cost_sqft_test_fixture.csv"), C)

    # 日本の指数(試験用)。月次 2024-01〜2025-03 と年度 FY2023〜FY2025。
    sid = "test-fixture-jp-index"
    ledger(sid, "JP", "GOV-STD-2.0", "建設工事費デフレーターの形")
    X = []
    for i in range(15):
        y, m = 2024 + (i // 12), (i % 12) + 1
        X.append(row(sid, country="JP", layer="index", category="指数(試験用)", item_name="建設工事費デフレーター(試験用)", spec="総合",
                     unit="index (2015 = 100)", geo_level="national", geo_code="JP", geo_name="日本", price=str(120 + i), currency="",
                     price_basis="index_value", price_status="published_cc_by", period="%04d-%02d" % (y, m), license="GOV-STD-2.0"))
    for fy, v in (("FY2023", 110), ("FY2024", 121), ("FY2025", 133.1)):
        X.append(row(sid, country="JP", layer="index", category="指数(試験用)", item_name="建設工事費デフレーター(試験用)", spec="総合 年度",
                     unit="index (2015 = 100)", geo_level="national", geo_code="JP", geo_name="日本", price=str(v), currency="",
                     price_basis="index_value", price_status="published_cc_by", period=fy, license="GOV-STD-2.0"))
    write_obs(os.path.join(OUT, "observations/jp/index_test_fixture.csv"), X)

    # 米国(試験用)
    sid = "test-fixture-us-wage"
    ledger(sid, "US", "US-PD-17USC105", "OEWS wage shape")
    U = []
    for lvl, code, name, v in (("state", "06", "California", 40), ("state", "48", "Texas", 25), ("national", "US", "United States", 30),
                               ("metro", "31080", "Los Angeles-Long Beach-Anaheim, CA (test)", 42)):
        U.append(row(sid, country="US", layer="wage", category="47-2031 (test)", item_name="Carpenters (test)", spec="hourly mean",
                     unit="USD/hour", geo_level=lvl, geo_code=code, geo_name=name, price=str(v), currency="USD", price_basis="wage_hourly_mean",
                     price_status="public_domain", period="2025-05", license="US-PD-17USC105"))
    write_obs(os.path.join(OUT, "observations/us/wage_test_fixture.csv"), U)

    sid = "test-fixture-us-bid"
    ledger(sid, "US", "OPEN-TERMS", "state DOT bid item average shape")
    B = []
    for lvl, code, name, area, v in (("district", "48", "Texas", "Austin (test)", 10), ("district", "48", "Texas", "Dallas (test)", 12),
                                     ("state", "06", "California", "", 20)):
        B.append(row(sid, country="US", layer="bid_item", category="Earthwork (test)", item_name="Excavation, roadway (test)", spec="",
                     unit="USD/CY", geo_level=lvl, geo_code=code, geo_name=name, area_label=area, price=str(v), currency="USD",
                     price_basis="bid_weighted_avg", price_status="published_open_terms", period="2025", license="OPEN-TERMS"))
    write_obs(os.path.join(OUT, "observations/us/bid_item_test_fixture.csv"), B)

    sid = "test-fixture-us-equipment"
    ledger(sid, "US", "US-PD-17USC105", "FEMA equipment rate shape")
    write_obs(os.path.join(OUT, "observations/us/equipment_test_fixture.csv"), [
        row(sid, country="US", layer="equipment", category="Excavator (test)", item_name="Excavator, hydraulic (test)", spec="1.5 CY",
            unit="USD/hour", geo_level="national", geo_code="US", geo_name="United States", price="80", currency="USD",
            price_basis="equipment_rate_hourly", price_status="public_domain", period="2025", license="US-PD-17USC105")])

    sid = "test-fixture-us-spending"
    ledger(sid, "US", "US-PD-17USC105", "Census construction spending shape")
    write_obs(os.path.join(OUT, "observations/us/spending_test_fixture.csv"), [
        row(sid, country="US", layer="spending", category="Total construction (test)", item_name="Total construction spending (test)",
            spec="SAAR", unit="million USD", geo_level="national", geo_code="US", geo_name="United States", price=str(v), currency="USD",
            price_basis="spending_million_usd_saar", price_status="public_domain", period=p, license="US-PD-17USC105")
        for p, v in (("2025-06", 2100000), ("2025-07", 2110000))])

    sid = "test-fixture-us-cost"
    ledger(sid, "US", "US-PD-17USC105", "Census cost per square foot shape")
    write_obs(os.path.join(OUT, "observations/us/cost_sqft_test_fixture.csv"), [
        row(sid, country="US", layer="cost_sqft", category="New single-family (test)", item_name="Construction cost per square foot (test)",
            spec="", unit="USD/sqft", geo_level=lvl, geo_code=code, geo_name=name, price=str(v), currency="USD",
            price_basis="cost_per_sqft", price_status="public_domain", period="2024", license="US-PD-17USC105")
        for lvl, code, name, v in (("national", "US", "United States", 150), ("census_region", "R3", "South", 130))])

    sid = "test-fixture-us-restricted"
    ledger(sid, "US", "restricted", "restricted-terms shape (value not copied)", attribution=False, values=False)
    write_obs(os.path.join(OUT, "observations/us/cost_sqft_test_fixture_restricted.csv"), [
        row(sid, country="US", layer="cost_sqft", category="Commercial (test)", item_name="Construction cost per square foot (test)",
            spec="commercial", unit="USD/sqft", geo_level="state", geo_code="06", geo_name="California", price="", currency="USD",
            price_basis="cost_per_sqft", price_status="published_restricted_not_copied", period="2024", license="restricted")])
    # 行を載せない出典(表が複製・電子化を禁じている)の形。実在の出典の行の一覧はリポに入れない約束なので、試験用の架空の行で作る。
    sid = "test-fixture-jp-restricted-listing"
    ledger(sid, "JP", "restricted", "表が複製・電子媒体への加工を禁じている出典の形(行は載せず件数だけ)", attribution=False, values=False)
    lp = os.path.join(OUT, "sources", sid + ".json")
    d = json.load(open(lp, encoding="utf-8"))
    d["row_listing"] = "not_in_public_build"
    d["row_listing_reason"] = "試験用: 本単価表の全部または一部を、無断で複製・転載・磁気媒体入力することを禁止します(という形の注記)。"
    json.dump(d, open(lp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    R = []
    for i, st in enumerate(["publication_based_not_public"] * 5 + ["published_restricted_not_copied"] * 4 + ["not_set"] * 3):
        R.append(row(sid, country="JP", layer="material", category="生コンクリート・モルタル", item_name="生コンクリート(試験用)",
                     spec="試験用規格-%02d" % i, unit="m3", geo_level="pref_area", geo_code="29", geo_name="奈良県", area_label="%d地区" % (i % 3 + 1),
                     price="", currency="JPY", price_basis="design_unit_price_ex_tax", price_status=st, period="2026-09", license="restricted"))
    write_obs(os.path.join(OUT, "observations_restricted/jp/material_test_fixture_restricted_listing.csv"), R)
    us_v03()
    print("fixtures written to", OUT)


def us_v03():
    """v0.3 で足した米国の形(試験用の架空の行)。v0.2 の試験が見る州(CA・TX)と全国の行は足さない(数が動かないように)。
    Oregon(41)と Washington(53)を使う。値はすべて架空。"""
    OR, WA = ("41", "Oregon"), ("53", "Washington")

    # Davis-Bacon の一般賃金決定の形: 1 職種 = 基本時給と付加給付の2行(同じ source_page)。郡は area_members に原文の形。
    for dec, rev, types, published, counties, lines in (
        ("OR20260001", "3", "Building", "2026-08-14", "Oregon Counties of Benton, Clackamas, Lane and Multnomah", (
            (40, "CARPENTER", "Rate identifier: CARP0001-001 06/01/2025", "prevailing_wage_hourly", 40, 20.5),
            (41, "ELECTRICIAN", "Rate identifier: ELEC0048-001 06/01/2025", "prevailing_wage_hourly", 48.1, 25),
            (42, "LABORER: GROUP 1", "Rate identifier: SUOR2026-001 02/02/2026", "prevailing_wage_hourly", 30, 0),
            (43, "DIVER (AMOUNTS IN RATES COLUMN ARE PER DAY)", "Rate identifier: CARP0001-002 06/01/2025", "prevailing_wage_daily", 800, 20.5))),
        ("OR20260002", "0", "Heavy", "2026-01-02", "Oregon Counties of Baker, Grant and Harney", (
            (30, "CARPENTER", "Rate identifier: CARP0001-003 06/01/2025", "prevailing_wage_hourly", 35, 15),))):
        sid = "test-fixture-us-dbra-%s-%s" % (dec.lower(), rev)
        ledger(sid, "US", "US-PD-17USC105", "Davis-Bacon general wage determination shape " + dec)
        D = []
        for line, job, spec, basis, base, fringe in lines:
            for pb, v, unit in ((basis, base, "USD/day" if basis == "prevailing_wage_daily" else "USD/hour"), ("prevailing_fringe_hourly", fringe, "USD/hour")):
                D.append(row(sid, country="US", layer="labor", category="Davis-Bacon General Decision", item_name=job, spec=spec, unit=unit,
                             geo_level="state", geo_code=OR[0], geo_name=OR[1], area_label=dec + " " + types, area_code=rev, area_members=counties,
                             price=str(v), currency="USD", price_basis=pb, price_status="public_domain", period=published, license="US-PD-17USC105",
                             source_page="document line %d" % line))
        write_obs(os.path.join(OUT, "observations/us/labor_test_fixture_dbra_%s.csv" % dec.lower()), D)

    # Census BPS の形: 地域 x 区分 x 棟数・戸数・工事額・1戸あたり(原本に無い値)。州と都市圏の工事額は千ドル、郡と市はドル。
    sid = "test-fixture-us-bps"
    ledger(sid, "US", "US-PD-17USC105", "Census Building Permits Survey shape")
    B = []
    CAT = "Building Permits Survey: New Privately-Owned Residential Construction"
    for lvl, code, name, label, acode, thousand, data in (
        ("state", OR[0], OR[1], "Oregon", "41", True, {"2024": {"1-unit": (8000, 8000, 3200000), "5+ units": (300, 9000, 2700000)},
                                                        "2025": {"1-unit": (7500, 7500, 3150000), "5+ units": (250, 8000, 2560000)}}),
        ("county", "41051", OR[1], "Multnomah County", "41051", False, {"2024": {"1-unit": (900, 900, 405000000), "5+ units": (60, 3000, 750000000)},
                                                                         "2025": {"1-unit": (850, 850, 391000000), "5+ units": (50, 2500, 650000000)}}),
        ("metro", "38900", "Portland-Vancouver-Hillsboro  OR-WA", "Portland-Vancouver-Hillsboro  OR-WA", "38900", True,
         {"2024": {"1-unit": (5000, 5000, 2250000), "5+ units": (150, 6000, 1500000)}}),
        ("city", OR[0], OR[1], "Portland", "123456", False, {"2024": {"1-unit": (400, 400, 180000000), "5+ units": (40, 2200, 550000000)},
                                                              "2025": {"1-unit": (380, 380, 175000000), "5+ units": (30, 1800, 468000000)}}),
        ("metro", "53033", "Test Collision Metro (test)", "Test Collision Metro (test)", "53033", True, {"2024": {"1-unit": (10, 10, 5000)}})):
        for year, per in data.items():
            for struct, (bl, un, val) in per.items():
                for meas, unit, basis, v, ref in (("Bldgs", "buildings", "count", bl, bl), ("Units", "housing units", "count", un, un),
                                                  ("Value", "USD thousand" if thousand else "USD", "permit_valuation_thousand_usd" if thousand else "permit_valuation_usd", val, val)):
                    B.append(row(sid, country="US", layer="spending", category=CAT, item_name=struct, spec="%s, Estimates with Imputation; Annual" % meas, unit=unit,
                                 geo_level=lvl, geo_code=code, geo_name=name, area_label=label, area_code=acode, price=str(v),
                                 currency="" if basis == "count" else "USD", price_basis=basis, price_status="public_domain", ref_value=str(ref),
                                 ref_note="Reported Only", period=year, license="US-PD-17USC105"))
                per_unit = round(val * (1000 if thousand else 1) / un)
                B.append(row(sid, country="US", layer="spending", category=CAT, item_name=struct, spec="Value / Units, Estimates with Imputation; Annual",
                             unit="USD per housing unit", geo_level=lvl, geo_code=code, geo_name=name, area_label=label, area_code=acode,
                             price=str(per_unit), currency="USD", price_basis="permit_valuation_per_unit_usd", price_status="public_domain", period=year,
                             license="US-PD-17USC105", note=TEST_NOTE + " 原本に無い値。Value / Units"))
    write_obs(os.path.join(OUT, "observations/us/spending_test_fixture_bps.csv"), B)

    # 市の許可データの形: 件数・合計・中央値・分位(spending)と 1 sqft あたりの中央値(cost_sqft)。どれも原本に無い値(許可ごとの申告額から計算)。
    sid = "test-fixture-us-city-permits"
    ledger(sid, "US", "OPEN-TERMS", "city building permit valuation distribution shape")
    C = []
    for item, cnt, tot, med, p25, p75, sqft in (("Building / New | (all permitclass)", 100, 5000000, 30000, 10000, 80000, 150),
                                                ("Building / New | Single Family", 60, 2400000, 35000, 15000, 70000, None)):
        spec = "permittypemapped=Building; permittypedesc=New; (test)"
        for basis, v, unit in (("count", cnt, "permits"), ("permit_valuation_total_usd", tot, "USD"), ("permit_valuation_median_usd", med, "USD per permit"),
                               ("permit_valuation_p25_usd", p25, "USD per permit"), ("permit_valuation_p75_usd", p75, "USD per permit")):
            C.append(row(sid, country="US", layer="spending", category="Building / New", item_name=item, spec=spec, unit=unit, geo_level="city",
                         geo_code=OR[0], geo_name="Portland", price=str(v), currency="" if basis == "count" else "USD", price_basis=basis,
                         price_status="published_open_terms", period="2024", license="OPEN-TERMS", note=TEST_NOTE + " 原本に無い値(許可ごとの申告額から計算)"))
        if sqft:
            C.append(row(sid, country="US", layer="cost_sqft", category="Building / New", item_name=item, spec=spec, unit="USD per square foot",
                         geo_level="city", geo_code=OR[0], geo_name="Portland", price=str(sqft), currency="USD", price_basis="permit_valuation_per_sqft_median_usd",
                         price_status="published_open_terms", ref_value="40", ref_note="計算に使った件数", period="2024", license="OPEN-TERMS",
                         note=TEST_NOTE + " 原本に無い値。申告額 / 面積の中央値"))
    write_obs(os.path.join(OUT, "observations/us/spending_test_fixture_city_permits.csv"), C)

    # DoD UFS 3-701-01 Table 4-1 の形: 施設ごとの ACF と Sustainment ACF。所在は area_members(County / City / Zip)。国外は geo_level country。
    sid = "test-fixture-us-dod-acf"
    ledger(sid, "US", "US-PD-17USC105", "DoD Area Cost Factor shape")
    A = []
    for cat, lvl, code, name, inst, site, rps, members, acf, sacf in (
        ("Table 4-1 CONUS: Area Cost Factors", "state", OR[0], OR[1], "FORT TESTING OR", "FORT TESTING MAIN (test)", "RPSUID 9001",
         "Country: United States; State: Oregon; County: Multnomah; City: Portland; Zip: 97201", 1.1, 1.05),
        ("Table 4-1 CONUS: Area Cost Factors", "state", OR[0], OR[1], "CAMP EXAMPLE OR", "CAMP EXAMPLE (test)", "RPSUID 9002",
         "Country: United States; State: Oregon; County: Lane; City: Eugene; Zip: 97401", 1.02, 0.98),
        ("Table 4-1 OCONUS: Area Cost Factors", "country", "JP", "Japan", "TEST AIR BASE JA", "TEST AIR BASE (test)", "RPSUID 9003",
         "Country: Japan; County: Not Applicable; City: Testcity", 1.93, 1.6)):
        spec = "Site Code: %s-0001; Installation Code: %s; Installation Name: %s; Address Street Name: 1 Test Road" % (rps[-4:], rps[-4:], inst)
        for item, basis, v in (("Area Cost Factor", "area_cost_factor", acf), ("Sustainment ACF", "sustainment_area_cost_factor", sacf)):
            A.append(row(sid, country="US", layer="index", category=cat, item_name=item, spec=spec, unit="index (96 Base City average = 1.00)",
                         geo_level=lvl, geo_code=code, geo_name=name, area_label=site, area_code=rps, area_members=members, price=str(v), currency="",
                         price_basis=basis, price_status="public_domain", period="FY2026", license="US-PD-17USC105"))
    write_obs(os.path.join(OUT, "observations/us/index_test_fixture_dod_acf.csv"), A)

    # USACE CWCCIS の州の調整係数の形(Table 3 の現行値と Table 4 の年ごとの値)
    sid = "test-fixture-us-cwccis"
    ledger(sid, "US", "US-PD-17USC105", "USACE CWCCIS state adjustment factor shape")
    write_obs(os.path.join(OUT, "observations/us/index_test_fixture_cwccis.csv"), [
        row(sid, country="US", layer="index", category=cat, item_name="State Adjustment Factor", spec=cat + " (test)", unit="factor",
            geo_level="state", geo_code=OR[0], geo_name=OR[1], area_label="OREGON", price=str(v), currency="", price_basis="state_adjustment_factor",
            price_status="public_domain", period=per, license="US-PD-17USC105")
        for cat, per, v in (("TABLE 3, STATE ADJUSTMENT FACTORS", "2026-03", 1.08), ("TABLE 4, HISTORICAL STATE ADJUSTMENT FACTORS", "2024", 1.05),
                            ("TABLE 4, HISTORICAL STATE ADJUSTMENT FACTORS", "2025", 1.06))])

    # USACE EP 1110-1-8 の機械損料の地域の形(地域に含まれる州は area_members)
    sid = "test-fixture-us-ep"
    ledger(sid, "US", "US-PD-17USC105", "USACE EP 1110-1-8 regional equipment rate shape")
    write_obs(os.path.join(OUT, "observations/us/equipment_test_fixture_ep.csv"), [
        row(sid, country="US", layer="equipment", category="T50 EXCAVATORS (test)", item_name="T50TE001 EXCAVATOR, HYDRAULIC (test)", spec="Model: TEST",
            unit="USD/hour", geo_level="usace_ep_region", geo_code="EP-R8", geo_name="Region 8 - Northwest (test)", area_label="Region: 8",
            area_members="Idaho; Oregon; Washington", price="95.5", currency="USD", price_basis="equipment_rate_hourly", price_status="public_domain",
            period="2024", license="US-PD-17USC105")])

    # HUD TDC の形(市の 1 戸あたり上限額、layer cost_limit)
    sid = "test-fixture-us-hud"
    ledger(sid, "US", "US-PD-17USC105", "HUD TDC limit shape")
    write_obs(os.path.join(OUT, "observations/us/cost_limit_test_fixture_hud.csv"), [
        row(sid, country="US", layer="cost_limit", category="2024 UNIT TOTAL DEVELOPMENT COST (TDC) LIMITS (test)", item_name="HCC",
            spec="Detached/Semi-Detached; Number of Bedrooms 2 (test)", unit="USD per dwelling unit", geo_level="city", geo_code=OR[0], geo_name=OR[1],
            area_label="PORTLAND", price="250000", currency="USD", price_basis="hcc_limit_usd", price_status="public_domain", period="2024",
            license="US-PD-17USC105")])

    # BLS QCEW の形(郡 53033 と州 53。郡 53033 は上の試験用の都市圏 53033 と同じ番号 = 郡か都市圏か決まらない場合の試験)
    sid = "test-fixture-us-qcew"
    ledger(sid, "US", "US-PD-17USC105", "BLS QCEW county wage shape")
    write_obs(os.path.join(OUT, "observations/us/wage_test_fixture_qcew.csv"), [
        row(sid, country="US", layer="wage", category="NAICS 23 Construction", item_name="NAICS 23 Construction (test)", spec="NAICS 23; own_code 5 Private (test)",
            unit="USD per week", geo_level=lvl, geo_code=code, geo_name=WA[1], area_label=label, area_code=code + ("000" if lvl == "state" else ""),
            price=str(v), currency="USD", price_basis="wage_weekly_mean", price_status="public_domain", period="2024", license="US-PD-17USC105")
        for lvl, code, label, v in (("county", "53033", "King County, Washington", 2100), ("state", WA[0], "Washington -- Statewide", 1800))])


if __name__ == "__main__":
    main()
