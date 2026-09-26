# -*- coding: utf-8 -*-
"""
JCCDB v4 の CSV と観測層の CSV から、D1 に流し込む SQL を作る。
wrangler d1 execute hs-jccdb-obs --remote --file=<各ファイル> を 00 から順に流す。
1ファイルあたりの行数を抑えてある(D1 の1回の文の上限に当たらないように)。
"""
import csv, json, hashlib, unicodedata, re, os, sys, glob

def nfkc(s):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", s or "")).replace("‐", "-").replace("−", "-").replace("－", "-").lower()

def q(v):
    if v is None: return "NULL"
    if isinstance(v, int): return str(v)
    return "'" + str(v).replace("'", "''") + "'"

def main(jccdb, upgrade, out, chunk=2000):
    os.makedirs(out, exist_ok=True)
    for f in glob.glob(os.path.join(out, "*.sql")): os.remove(f)
    prov = {}
    for r in csv.DictReader(open(os.path.join(jccdb, "jccdb-v4-provenance.csv"), encoding="utf-8-sig")):
        prov.setdefault((r["category"], r["item_name"], r["unit"]), r)
    for fn in ("jccdb-v3-provenance.csv",):
        p = os.path.join(jccdb, fn)
        if os.path.exists(p):
            for r in csv.DictReader(open(p, encoding="utf-8-sig")):
                prov.setdefault((r["category"], r["item_name"], r["unit"]), r)
    verified = set((r["category"], r["item_name"], r["unit"]) for r in csv.DictReader(open(os.path.join(jccdb, "jccdb-v4-verified.csv"), encoding="utf-8")))
    stmts, seen = [], set()
    for r in csv.DictReader(open(os.path.join(jccdb, "jccdb-v4-full.csv"), encoding="utf-8")):
        key = (r["category"], r["item_name"], r["unit"])
        rk = hashlib.sha256("|".join(key).encode()).hexdigest()[:16]
        if rk in seen: continue
        seen.add(rk)
        p = prov.get(key, {})
        stmts.append("INSERT INTO items VALUES (%s);" % ",".join(q(x) for x in (
            rk, p.get("item_id"), r["category"], r["item_name"], r["unit"], nfkc(r["item_name"]),
            "verified" if key in verified else "extended", p.get("verification_method"), p.get("evidence_url"))))
    n_items = len(stmts)
    for fn in sorted(glob.glob(os.path.join(upgrade, "observations", "obs_*.csv"))):
        for r in csv.DictReader(open(fn, encoding="utf-8")):
            stmts.append("INSERT INTO obs VALUES (%s);" % ",".join(q(x) for x in (
                r["obs_id"], r["layer"], r["category"], r["item_name"], r["spec"], r["unit"],
                nfkc(r["item_name"] + " " + r["spec"]), r["pref_code"], r["pref"], r["area_label"], r["area_code"], r["area_members"],
                int(r["price_yen"]) if r["price_yen"] else None, r["price_status"],
                int(r["ref_value_yen"]) if r["ref_value_yen"] else None, r["ref_value_note"],
                r["effective_from"], r["source_id"], r["source_page"], r["evidence_url"], r["license"], r["jccdb_v4_item_id"], r["note"])))
    n_obs = len(stmts) - n_items
    src = json.load(open(os.path.join(upgrade, "sources", "sources.json"), encoding="utf-8"))["sources"]
    for k, v in src.items():
        stmts.append("INSERT INTO sources VALUES (%s,%s);" % (q(k), q(json.dumps(v, ensure_ascii=False))))
    stmts.append("INSERT INTO meta VALUES ('built', %s);" % q(json.dumps({"items": n_items, "obs": n_obs, "sources": len(src)}, ensure_ascii=False)))
    for i in range(0, len(stmts), chunk):
        with open(os.path.join(out, "%03d.sql" % (i // chunk + 1)), "w", encoding="utf-8") as f:
            f.write("\n".join(stmts[i:i + chunk]) + "\n")
    print("items", n_items, "obs", n_obs, "files", (len(stmts) + chunk - 1) // chunk)

if __name__ == "__main__":
    main(*sys.argv[1:4])
