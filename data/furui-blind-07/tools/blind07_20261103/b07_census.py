#!/usr/bin/env python3
# blind-07 の母集団の数え(計画の 0 節と 3 節)。書いた者 設計の担当 2026-11-05。
# 数えるのは key と数と sha だけ。行の本文、範囲の文は画面にも file にも出さない(govtech の file は空かどうかの照らしにだけ読む)。網に出ない。呼ばない。
# N2、GOV: blind-06 の母集団を draw_blind06.py(9806c3f8)と同じ決まりで key だけ作り直し、blind-06 の計画の数と sha(663,261 と 650,776)に
#   一致する事を照らしてから、blind-06 で引いた key(blind06_draw/manifest.json 38aee098 の N2 1,000 と O_gov 3,000)を除く。
#   blind-06 の後に作られた作り(build)の manifest は無い(blind06_draw/manifest.json より新しい manifest*.json を探して 0、2026-11-05 に照らした)。
# JB: furui_ja_benign_20261025/items.jsonl(4078e677)の split = measure の行。key = sha256("hs@156d0db10074ab44547832dbd415469d7666c95f|furui_ja_benign_20261025|" + id)。
#   A7 の作り、N2 の作り、blind-05、blind-06 の manifest の key と重なる数、src_id と重なる数、出どころの名に ja か horizon-shield を持つ行の数を数える。
# usage(pyarrow のある python で -I -B):
#   python3 -I -B b07_census.py census <raw_dir> <out.json>
#   python3 -I -B b07_census.py selftest
import collections, hashlib, importlib.util, json, os, sys
sys.dont_write_bytecode = True
def ops(): return os.environ.get("FURUI_B07_OPS", os.path.expanduser("~/hs-core-private/ops-private"))
PINS = {"blind06_publish_work/clone/data/furui-blind-06/draw_blind06.py": "9806c3f8",
        "blind06_draw/manifest.json": "38aee098",
        "furui_ja_benign_20261025/items.jsonl": "4078e677"}
HS_COMMIT = "156d0db10074ab44547832dbd415469d7666c95f"
JB_PREFIX = "hs@%s|furui_ja_benign_20261025|" % HS_COMMIT
B06_DRAWN = {"N2": 1000, "O_gov": 3000}
def die(m): sys.exit("止めた: " + m)
def H(s): return hashlib.sha256(s.encode("utf-8")).hexdigest()
def fsha(p): return hashlib.sha256(open(p, "rb").read()).hexdigest()
def keys_sha(ks): return H("\n".join(sorted(ks)) + "\n")
def P(rel):
    p = os.path.join(ops(), rel)
    if not os.path.isfile(p) or not fsha(p).startswith(PINS[rel]): die("%s が固定の %s でない" % (rel, PINS[rel]))
    return p
def jb_key(item_id): return H(JB_PREFIX + item_id)

def d6():
    s = importlib.util.spec_from_file_location("draw_blind06_b07c", P("blind06_publish_work/clone/data/furui-blind-06/draw_blind06.py"))
    D = importlib.util.module_from_spec(s); sys.modules["draw_blind06_b07c"] = D; s.loader.exec_module(D)
    return D

def gov_keys(D, raw):
    """draw_blind06.populations の govtech の段と同じ決まりで、key だけを作る(本文は空かどうかだけを見る)"""
    D5 = D.d5(); k5, ka7, kn2 = D.used(); ek, es = D5.excl()
    import pyarrow.parquet as pq
    rev = D5.RAW["govtech/train.parquet"][1]; f = pq.ParquetFile(D5.checked(raw, "govtech/train.parquet")); i = 0
    acc = {1: ("O_gov", [], collections.Counter()), 0: ("N2", [], collections.Counter())}
    for b in f.iter_batches(batch_size=200000, columns=["system_prompt", "prompt", "off_topic"]):
        d = b.to_pydict()
        for sp, u, o in zip(d["system_prompt"], d["prompt"], d["off_topic"]):
            i += 1
            if o not in acc: continue
            lab, ks, c = acc[o]; c["label_rows"] += 1
            if D.gov_half(i - 1) != "blind": c["build_half"] += 1; continue
            k = H("gabrielchua/off-topic|%s|train|%d" % (rev, i - 1))
            if not (sp or "").strip(): c["no_scope"] += 1; continue
            if not (u or "").strip(): c["no_text"] += 1; continue
            if k in ek: c["exclude_table_key"] += 1; continue
            if H(D5.norm(sp)) in es: c["scope_in_exclude_or_D_C"] += 1; continue
            if k in k5: c["drawn_in_blind05"] += 1; continue
            if k in ka7: c["in_a7_build"] += 1; continue
            if k in kn2: c["in_n2_build"] += 1; continue
            ks.append(k)
    return {lab: (ks, dict(c)) for lab, ks, c in acc.values()}, rev

def b07_population(lab, ks, b06_rows):
    """blind-06 の母集団(数と sha を照らした物)から、blind-06 で引いた key を除く"""
    drawn = {r["key"] for r in b06_rows if r["layer"] == lab}
    if len(drawn) != B06_DRAWN[lab]: die("blind-06 の %s の引いた数が %d でない(%d)" % (lab, B06_DRAWN[lab], len(drawn)))
    s = set(ks)
    if len(s) != len(ks): die("%s に同じ key が 2 度ある" % lab)
    if not drawn <= s: die("blind-06 で引いた %s の key が母集団に無い" % lab)
    rest = s - drawn
    return {"blind06_population": len(s), "blind06_population_keys_sha256": keys_sha(s), "removed_drawn_in_blind06": len(drawn),
            "population": len(rest), "keys_sha256": keys_sha(rest)}

def jb_census(items_p, manifests):
    rows = [json.loads(l) for l in open(items_p, encoding="utf-8") if l.strip()]
    ms = [r for r in rows if r.get("split") == "measure"]
    ids = [r["id"] for r in ms]
    if len(ids) != len(set(ids)): die("JB の id が重なる")
    ks = [jb_key(i) for i in ids]
    tune_ids = {r["id"] for r in rows if r.get("split") == "tune"}
    used_keys, used_ids, src_hits = set(), set(), 0
    for name, recs in manifests.items():
        for r in recs:
            used_keys.add(r.get("key")); used_ids.add(str(r.get("src_id", "")))
            src = str(r.get("src") or r.get("ds") or "").lower()
            if src.startswith("ja") or "horizon" in src or "hs@" in src: src_hits += 1
    return {"items_rows": len(rows), "measure_rows": len(ms), "tune_rows": len(tune_ids), "measure_ids_in_tune": len(set(ids) & tune_ids),
            "keys_sha256": keys_sha(ks), "key_rule": "sha256(\"%s\" + id)" % JB_PREFIX,
            "manifests_checked": {n: len(v) for n, v in manifests.items()},
            "overlap_keys": len(set(ks) & used_keys), "overlap_src_ids": len(set(ids) & used_ids), "manifest_rows_from_ja_or_hs_source": src_hits,
            "per_stratum": dict(sorted(collections.Counter(r["stratum"] for r in ms).items()))}

def census(raw, out):
    D = d6()
    pops, rev = gov_keys(D, raw)
    for lab in ("N2", "O_gov"):
        ks = pops[lab][0]
        if len(ks) != D.POP[lab] or keys_sha(ks) != D.POP_SHA[lab]:
            die("%s の blind-06 の母集団が作り直せない(%d 行、keys %s)" % (lab, len(ks), keys_sha(ks)[:16]))
    b06 = json.load(open(P("blind06_draw/manifest.json"), encoding="utf-8"))["rows"]
    res = {"schema": "furui-blind07-census-v0", "govtech_revision": rev,
           "N2": dict(b07_population("N2", pops["N2"][0], b06), removed_before_blind06=pops["N2"][1]),
           "GOV": dict(b07_population("O_gov", pops["O_gov"][0], b06), removed_before_blind06=pops["O_gov"][1])}
    k5 = json.load(open(os.path.join(ops(), "blind05_draw/manifest.json"), encoding="utf-8"))["rows"]
    a7 = json.load(open(os.path.join(ops(), "a7_build_work/manifest.json"), encoding="utf-8"))["rows"]
    n2b = json.load(open(os.path.join(ops(), "a7_4_n2_work/manifest.json"), encoding="utf-8"))["keys"]
    res["JB"] = jb_census(P("furui_ja_benign_20261025/items.jsonl"), {"a7_build_work/manifest.json": a7, "a7_4_n2_work/manifest.json": n2b,
                                                                      "blind05_draw/manifest.json": k5, "blind06_draw/manifest.json": b06})
    if res["JB"]["measure_rows"] != 2812: die("JB の measure の行が 2,812 でない")
    s = json.dumps(res, indent=1, sort_keys=True, ensure_ascii=False) + "\n"
    if os.path.exists(out): die(out + " が既にある")
    open(out, "w", encoding="utf-8").write(s)
    print("N2 %d(keys %s)、GOV %d(keys %s)、JB %d(keys %s、重なり key %d、src_id %d、出どころ %d)" % (
        res["N2"]["population"], res["N2"]["keys_sha256"][:16], res["GOV"]["population"], res["GOV"]["keys_sha256"][:16],
        res["JB"]["measure_rows"], res["JB"]["keys_sha256"][:16], res["JB"]["overlap_keys"], res["JB"]["overlap_src_ids"], res["JB"]["manifest_rows_from_ja_or_hs_source"]))

def selftest():
    import socket, tempfile
    ok = []
    def t(n, c): ok.append(bool(c)); print(("  ok   " if c else "  NG   ") + n)
    real = socket.socket
    socket.socket = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("網"))
    try:
        b06 = [{"layer": "N2", "key": "k%d" % i} for i in range(1000)] + [{"layer": "O_gov", "key": "g%d" % i} for i in range(3000)]
        ks = ["k%d" % i for i in range(1500)]
        r = b07_population("N2", ks, b06)
        t("blind-06 で引いた 1,000 を除いて 500 が残り、sha は残りの key の並べた物", r["population"] == 500 and r["keys_sha256"] == keys_sha(["k%d" % i for i in range(1000, 1500)]))
        try: b07_population("N2", ks[1:], b06); t("引いた key が母集団に無ければ止まる", False)
        except SystemExit: t("引いた key が母集団に無ければ止まる", True)
        try: b07_population("N2", ks + ["k1"], b06); t("同じ key が 2 度あれば止まる", False)
        except SystemExit: t("同じ key が 2 度あれば止まる", True)
        try: b07_population("N2", ks, b06[1:]); t("引いた数が 1,000 でなければ止まる", False)
        except SystemExit: t("引いた数が 1,000 でなければ止まる", True)
        d = tempfile.mkdtemp(prefix="b07c_"); ip = os.path.join(d, "items.jsonl")
        with open(ip, "w", encoding="utf-8") as f:
            for i in range(6):
                f.write(json.dumps({"id": "ja-%05d" % i, "split": "measure" if i % 2 else "tune", "stratum": "faq", "text": "x"}) + "\n")
        c = jb_census(ip, {"m": [{"key": jb_key("ja-00001"), "src_id": "ja-00003", "src": "ja-benign"}, {"key": "z", "src_id": "1", "src": "govtech"}]})
        t("JB は measure の行だけを数える(3)", c["measure_rows"] == 3 and c["tune_rows"] == 3 and c["measure_ids_in_tune"] == 0)
        t("key、src_id、出どころの名の重なりを数える(1、1、1)", c["overlap_keys"] == 1 and c["overlap_src_ids"] == 1 and c["manifest_rows_from_ja_or_hs_source"] == 1)
        c0 = jb_census(ip, {"m": [{"key": "z", "src_id": "1", "src": "govtech"}]})
        t("重ならなければ 0、0、0", c0["overlap_keys"] == 0 and c0["overlap_src_ids"] == 0 and c0["manifest_rows_from_ja_or_hs_source"] == 0)
        t("JB の key は 64 桁の 16 進(出どころの印 JB/hs@156d0db1/<key> の形)", len(jb_key("ja-00001")) == 64)
        t("census の file に本文の欄が無い(key と数と sha だけ)", "\"text\"" not in json.dumps(c))
    finally:
        socket.socket = real
    print("b07_census selftest %d / %d %s" % (sum(ok), len(ok), "all green" if all(ok) else "RED"))
    return all(ok)

if __name__ == "__main__":
    a = sys.argv[1:]
    if a == ["selftest"]: sys.exit(0 if selftest() else 1)
    if len(a) == 3 and a[0] == "census": census(a[1], a[2]); sys.exit(0)
    sys.exit("usage: census <raw_dir> <out.json> | selftest")
