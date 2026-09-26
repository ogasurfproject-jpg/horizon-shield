# -*- coding: utf-8 -*-
"""
観測層 v1(日本3ファイル)と米国 NHCCI を v2 の形に移す。値は1つも作り直さない(列の名前と置き場所だけ変える)。
obs_id は v1 のものをそのまま使う(既に外へ出た ID を変えない)。

使い方: python3 migrate_v1.py <jccdb_up のルート> <jccdb_us のルート> <obs2 のルート>
"""
import csv, json, os, sys, hashlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from obs_common import write_obs, pref, make_id, num

V1, US, OUT = [os.path.abspath(a) for a in sys.argv[1:4]]


def v1rows(fn):
    return list(csv.DictReader(open(os.path.join(V1, "observations", fn), encoding="utf-8")))


def base(r):
    return {"obs_id": r["obs_id"], "country": "JP", "layer": r["layer"], "category": r["category"],
            "item_name": r["item_name"], "spec": r["spec"], "unit": r["unit"],
            "area_label": r["area_label"], "area_code": r["area_code"], "area_members": r["area_members"],
            "price": r["price_yen"], "currency": "JPY", "price_status": r["price_status"],
            "ref_value": r["ref_value_yen"], "ref_note": r["ref_value_note"],
            "effective_from": r["effective_from"], "source_id": r["source_id"], "source_page": r["source_page"],
            "evidence_url": r["evidence_url"], "license": r["license"], "jccdb_v4_item_id": r["jccdb_v4_item_id"],
            "note": r["note"]}


def main():
    n = {}
    # 1. 労務単価
    rows = []
    for r in v1rows("obs_labor_mlit_r8.csv"):
        o = base(r)
        c, nm = pref(r["pref_code"])
        assert c == r["pref_code"] and nm == r["pref"], r
        o.update(geo_level="pref", geo_code=c, geo_name=nm, price_basis="labor_wage_8h", period="2026-03")
        rows.append(o)
    n["jp/labor_mlit_roumu_r8.csv"] = write_obs(os.path.join(OUT, "observations", "jp", "labor_mlit_roumu_r8.csv"), rows)
    # 2. 近畿地整の生コン(v1 では生コンだけ。v2 で全資材に広げるときはこのファイルを置き換える)
    rows = []
    for r in v1rows("obs_namacon_kkr_r8_09.csv"):
        o = base(r)
        c, nm = pref(r["pref"])
        assert c, r["pref"]
        o.update(geo_level="bureau_area", geo_code=c, geo_name=nm, price_basis="design_unit_price_ex_tax", period="2026-09")
        rows.append(o)
    n["jp/material_kkr_namacon_r8_09.csv"] = write_obs(os.path.join(OUT, "observations", "jp", "material_kkr_namacon_r8_09.csv"), rows)
    # 3. 奈良県の生コン(状態だけ)
    rows = []
    for r in v1rows("obs_namacon_nara_status_r8_09.csv"):
        o = base(r)
        assert r["pref_code"] == "29"
        o.update(geo_level="pref_area", geo_code="29", geo_name="奈良県", price_basis="design_unit_price_ex_tax", period="2026-09")
        rows.append(o)
    n["jp/material_nara_namacon_status_r8_09.csv"] = write_obs(os.path.join(OUT, "observations", "jp", "material_nara_namacon_status_r8_09.csv"), rows)
    # 4. NHCCI
    rows = []
    for r in csv.DictReader(open(os.path.join(US, "data", "us_obs_nhcci.csv"), encoding="utf-8")):
        y, q = r["period"].split(" ")
        rows.append({"obs_id": r["obs_id"], "country": "US", "layer": "index", "category": "Highway construction cost",
                     "item_name": "NHCCI (National Highway Construction Cost Index)", "spec": "not seasonally adjusted",
                     "unit": "index (2003Q1 = 1)", "geo_level": "national", "geo_code": "US", "geo_name": "United States",
                     "price": num(r["value"]), "currency": "", "price_basis": "index_value", "price_status": "public_domain",
                     "ref_value": num(r["value_sa"]) if r["value_sa"] else "", "ref_note": "seasonally adjusted value" if r["value_sa"] else "",
                     "period": y + q, "source_id": "fhwa-nhcci", "source_page": "", "evidence_url": r["evidence_url"],
                     "license": "US-PD-17USC105", "note": ""})
    n["us/index_fhwa_nhcci.csv"] = write_obs(os.path.join(OUT, "observations", "us", "index_fhwa_nhcci.csv"), rows)
    # 台帳: v1 の sources.json を1出典1ファイルに分ける
    s = json.load(open(os.path.join(V1, "sources", "sources.json"), encoding="utf-8"))["sources"]
    os.makedirs(os.path.join(OUT, "sources"), exist_ok=True)
    lic = {"PDL1.0": "PDL1.0"}
    for sid, d in s.items():
        e = dict(d)
        e["source_id"] = sid
        e["country"] = "JP"
        e["license"] = lic.get(d["license"], "restricted")
        e.setdefault("values_copied", e["license"] != "restricted")
        e.setdefault("fetched_via", "Apify web-fetch (formats=raw)。作業環境から官公庁サイトへ直接は届かないため。バイト列は sha256 で原本と同じと確かめられる。")
        if e["license"] == "restricted":
            e.setdefault("attribution", "")
        json.dump(e, open(os.path.join(OUT, "sources", sid + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    raw = os.path.join(US, "data", "nhcci_r94d-n4f9_raw.json")
    b = open(raw, "rb").read()
    json.dump({
        "source_id": "fhwa-nhcci", "country": "US",
        "title": "National Highway Construction Cost Index (NHCCI)", "publisher": "U.S. DOT Federal Highway Administration",
        "url": "https://data.transportation.gov/resource/r94d-n4f9.json",
        "landing": "https://data.transportation.gov/Research-and-Statistics/NHCCI/r94d-n4f9",
        "retrieved_at": "2026-09-26", "bytes": len(b), "sha256": hashlib.sha256(b).hexdigest(),
        "license": "US-PD-17USC105", "license_url": "https://www.law.cornell.edu/uscode/text/17/105",
        "license_quote": "Copyright protection under this title is not available for any work of the United States Government (17 U.S.C. 105)",
        "attribution": "Source: U.S. DOT, Federal Highway Administration, National Highway Construction Cost Index (NHCCI)",
        "how_read": "Socrata JSON API の全行(93 四半期)。値はそのまま、四半期の表記だけ '2003 Q1' を '2003Q1' に。",
        "values_copied": True, "api": True,
        "fetched_via": "Apify web-fetch (formats=raw)"}, open(os.path.join(OUT, "sources", "fhwa-nhcci.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps(n, ensure_ascii=False))


if __name__ == "__main__":
    main()
