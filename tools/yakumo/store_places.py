#!/usr/bin/env python3
"""加盟店の連絡先(所在地・電話・公式サイト・地図・許可・検証記録)を、AI の口が読む公開ファイルにする(2026-11-06 番人)。
なぜ: AI が業者を探す口(find_verified_contractor)が店の名前と点数しか返さず、施主に連絡先を渡せなかった。
決まり: 値は店の頁(yakumo/noNNN/index.html)の JSON-LD に既に公開している物だけを写す。作らない。検証記録の sha256 は公開ファイルから計算する。
出力: data/yakumo-store-places.json   使い方: python3 tools/yakumo/store_places.py [--check]"""
import glob, hashlib, io, json, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SITE = "https://shield.the-horizons-innovation.com"
out = {"schema": "yakumo-store-places/v1", "source": "yakumo/noNNN/index.html JSON-LD (the public store pages)", "stores": {}}
for page in sorted(glob.glob(os.path.join(ROOT, "yakumo", "no[0-9][0-9][0-9]", "index.html"))):
    t = io.open(page, encoding="utf-8").read()
    for j in re.findall(r'<script type="application/ld\+json">(.*?)</script>', t, flags=re.S):
        d = json.loads(j)
        for g in d.get("@graph") or [d]:
            ty = g.get("@type"); ty = ty if isinstance(ty, list) else [ty]
            if "LocalBusiness" not in ty: continue
            ids = g.get("identifier") or []
            ids = ids if isinstance(ids, list) else [ids]
            member = next((i.get("value") for i in ids if isinstance(i, dict) and i.get("propertyID") == "Yakumo member number"), None)
            if not member: continue
            lic = next((i.get("value") for i in ids if isinstance(i, dict) and i.get("propertyID") == "建設業許可"), None)
            a = g.get("address") or {}
            same = [u for u in (g.get("sameAs") or []) if "maps.google" not in u]
            rec = os.path.join(os.path.dirname(page), "verification-record.json")
            vr = None
            if os.path.exists(rec):
                vr = {"url": SITE + "/yakumo/" + os.path.basename(os.path.dirname(page)) + "/verification-record.json",
                      "sha256": hashlib.sha256(open(rec, "rb").read()).hexdigest()}
                if os.path.exists(rec + ".ots"): vr["opentimestamps"] = vr["url"] + ".ots"
            out["stores"][member] = {k: v for k, v in {
                "name": g.get("name"), "alternate_name": g.get("alternateName"),
                "address": "〒%s %s%s%s" % (a.get("postalCode", ""), a.get("addressRegion", ""), a.get("addressLocality", ""), a.get("streetAddress", "")) if a.get("streetAddress") else None,
                "telephone": re.sub(r"^\+81-?", "0", g["telephone"]) if g.get("telephone") else None,
                "website": same[0] if same else None, "map": g.get("hasMap"),
                "construction_license": lic, "verification_record": vr, "profile_url": g.get("url")}.items() if v}
body = json.dumps(out, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
dst = os.path.join(ROOT, "data", "yakumo-store-places.json")
if "--check" in sys.argv:
    cur = io.open(dst, encoding="utf-8").read() if os.path.exists(dst) else ""
    print("same" if cur == body else "differs"); sys.exit(0 if cur == body else 1)
io.open(dst, "w", encoding="utf-8").write(body); print("wrote %d stores" % len(out["stores"]))
