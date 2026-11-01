#!/usr/bin/env python3
# blind-06 の母集団と引き(BLIND06_PLAN.md の 3 節と 5 節)。書いた者 helper agent(番人(Team) の頼み)2026-11-01、照らすのは番人(個人)。
# 呼ばない、網に出ない(元の file は先に取って sha を照らす)。本文と範囲の文は画面にも manifest にも出さない(数、key、hash だけ)。
# 層(計画の 3 節):
#   H、X  Tensor Trust の盲検の半分(draw_blind05.py 35565ace の iter_layer と除外表)から、blind-05 で引いた key を除いた全部(180、90)。引かない。
#   N     SystemChat の盲検の半分(同じ iter_layer)から、blind-05 で引いた key を除いた全部(963)。引かない。
#   O_gov GovTech train の off_topic=1、割り sha256("furui-a7-govtech-split-v1|"+i) の 1 バイト目が奇数。範囲か本文の無い行、除外表の key、
#         除外表と D と C の半分の範囲の文、使った key を除いて 650,776 行。塩で引く行の数は計画の記録の文「GovTech rows drawn: <1,000、2,000、3,000>.」から読む。
#   O_ctat CantTalkAboutThis の mixtral の file(d_check_work/dl、031adcb1)の distractor 5,365 から、使った key(A7 の作りの 500)を除いた 4,865 行。塩で 300 行。
#          この file の範囲の文は全部 C の半分に当たる(計画の 3 節に書いた事実)。範囲の文での除外はしない。
#   N2    GovTech train の off_topic=0、盲検の側。O_gov と同じ決まりで除いて 663,261 行。塩で 1,000 行。
# 使った key: blind-05 の引き(blind05_draw/manifest.json)、A7 の作り(a7_build_work/manifest.json)、N2 の作り(a7_4_n2_work/manifest.json)、除外表の key。
# 母集団ごとの key の sha256(並べて改行でつなぎ、最後に改行)は計画の 9 節と同じでなければ止まる(POP_SHA)。
# 引き: 層ごとに sha256(塩 | block hash | 層 | key) の小さい順(blind-05 と同じ式)。塩は 64 桁の 16 進、画面に出さない。
# usage(pyarrow のある python で、-I を付ける):
#   python3 -I -B draw_blind06.py draw <raw_dir> <salt.hex> <block_hash> <BLIND06_PLAN.md> <out_dir>      blind06.jsonl(600、本文を持つ)と manifest.json
#   python3 -I -B draw_blind06.py verify <raw_dir> <salt.hex> <block_hash> <BLIND06_PLAN.md> <out_dir>    引き直して同じか
# 試しだけ: FURUI_B06_TRIAL_ROWS(作った行の jsonl。layer、key、text、scope、ds、src_id)があれば、母集団を盲検の源でなくその file から作る(母集団の数と sha の照らしは飛ばす)。
#   TOshi の引く台本は、この変数があると止まる。試しは盲検の行に道具を当てない(REPLY_138、REPLY_139)。
#   python3 -I -B draw_blind06.py buildcheck <raw_dir>      作りの key の照らし(file の行数だけを使い、行は読まない。B3)
#   python3 -I -B draw_blind06.py selftest
import collections, hashlib, heapq, importlib.util, json, os, re, sys
sys.dont_write_bytecode = True
def ops(): return os.environ.get("FURUI_B06_OPS", os.path.expanduser("~/hs-core-private/ops-private"))
PINS = {"furui_a5_20261031/blind05/draw_blind05.py": "35565ace",
        "furui_a5_20261031/preview/preview_tt.py": "88c831f3",
        "blind05_draw/manifest.json": "079a41fb",
        "a7_build_work/manifest.json": "ea1b5e16",
        "a7_4_n2_work/manifest.json": "9cf48613",
        "d_check_work/dl/canttalkaboutthis_topic_control_mixtral.jsonl": "031adcb1"}
CTAT_REV = "b015ae8902d8429ce32ebfed9f9935f891d10ed5"
GOV_SPLIT = "furui-a7-govtech-split-v1|"
LAYERS = ("H", "X", "N", "O_gov", "O_ctat", "N2")
WANT = {"H": None, "X": None, "N": None, "O_gov": None, "O_ctat": 300, "N2": 1000}  # None は全部(引かない)。O_gov は計画の記録から読む(gov_n)
GOV_RE = re.compile(r"GovTech rows drawn: (1,000|2,000|3,000)\.")
POP = {"H": 180, "X": 90, "N": 963, "O_gov": 650776, "O_ctat": 4865, "N2": 663261}
POP_SHA = {"H": "6c34e4946ca387af7eea6d22f36523636b9acf196243c9e5774c912df04eeccb", "X": "9365d4930975d960c57e691a012479ff1e1fe015f81349921ddcd4bb4e168ebf",
           "N": "c0b31fca4ea990a9e3136bbaa8b85886d599a8fd1439f2253e610be5b27ee1a8", "O_gov": "2d0c62d2c7a54fd7497f0203e9f382d2825153d99210854c51548ec553096c24",
           "O_ctat": "94960b72c69046b46dd6b1127aedf7bd64cf72712e0af2e6716e27ad30345222", "N2": "c8474fe5f22da9349bea817e0f7a95c6db4ad6c40d5e48ea63cd1f34cb3b8ad3"}
ROW_FIELDS = ("key", "layer", "ds", "src_id", "row_sha256")
def die(m): sys.exit("止めた: " + m)
def H(s): return hashlib.sha256(s.encode("utf-8")).hexdigest()
def fsha(p): return hashlib.sha256(open(p, "rb").read()).hexdigest()
def rd(p): return [json.loads(l) for l in open(p, encoding="utf-8") if l.strip()]
def keys_sha(ks): return H("\n".join(sorted(ks)) + "\n")
def gov_n(plan_p):
    m = GOV_RE.findall(open(plan_p, encoding="utf-8").read())
    if len(m) != 1: die("計画の記録に「GovTech rows drawn: <1,000、2,000、3,000>.」の文がちょうど 1 つ無い")
    return int(m[0].replace(",", ""))
def want_of(n_gov): return dict(WANT, O_gov=n_gov)
def trial_populations(p):
    out = {l: [] for l in LAYERS}
    for x in rd(p): out[x["layer"]].append((x["key"], x["text"], x["scope"], x["ds"], x["src_id"]))
    ks = [r[0] for l in LAYERS for r in out[l]]
    if len(ks) != len(set(ks)): die("試しの行に同じ key がある")
    return out, {l: {"trial_rows": len(out[l])} for l in LAYERS}, {"trial": True}
def gov_half(i): return "build" if hashlib.sha256((GOV_SPLIT + str(i)).encode("utf-8")).digest()[0] % 2 == 0 else "blind"
def row_sha(k, text, scope): return H(json.dumps({"key": k, "text": text, "scope": scope}, ensure_ascii=False, sort_keys=True))
def score(salt, block, lab, k): return H("%s|%s|%s|%s" % (salt, block, lab, k))

def P(rel):
    p = os.path.join(ops(), rel)
    if not fsha(p).startswith(PINS[rel]): die("%s が固定の %s でない" % (rel, PINS[rel]))
    return p

def d5():
    s = importlib.util.spec_from_file_location("draw_blind05_b06d", P("furui_a5_20261031/blind05/draw_blind05.py"))
    D = importlib.util.module_from_spec(s); sys.modules["draw_blind05_b06d"] = D; s.loader.exec_module(D)
    P("furui_a5_20261031/preview/preview_tt.py")
    return D

def used():
    b5 = json.load(open(P("blind05_draw/manifest.json"), encoding="utf-8"))["rows"]
    a7 = json.load(open(P("a7_build_work/manifest.json"), encoding="utf-8"))["rows"]
    n2 = json.load(open(P("a7_4_n2_work/manifest.json"), encoding="utf-8"))["keys"]
    return {r["key"] for r in b5}, {r["key"] for r in a7}, {r["key"] for r in n2}

def build_key_check(n_rows, rev):
    """B3(REPLY_141): GovTech の key は行の番号だけで決まる。番号の全部(0 から n_rows - 1)の key を作り、A7 の作りの GovTech の key と N2 の作りの key が
    作りの半分に何個あり、盲検の半分に何個あるかを数える。行の本文も label も読まない(file の行数だけを使う)"""
    a7 = json.load(open(P("a7_build_work/manifest.json"), encoding="utf-8"))["rows"]
    gov = {r["key"] for r in a7 if r["src"].startswith("govtech")}
    n2 = {r["key"] for r in json.load(open(P("a7_4_n2_work/manifest.json"), encoding="utf-8"))["keys"]}
    c = collections.Counter()
    for i in range(n_rows):
        k = H("gabrielchua/off-topic|%s|train|%d" % (rev, i)); half = gov_half(i)
        if k in gov: c["a7_govtech_" + half] += 1
        if k in n2: c["n2_" + half] += 1
    res = {"a7_govtech_keys": len(gov), "n2_keys": len(n2), "a7_govtech_in_build_half": c["a7_govtech_build"], "a7_govtech_in_blind_half": c["a7_govtech_blind"],
           "n2_in_build_half": c["n2_build"], "n2_in_blind_half": c["n2_blind"]}
    if not (res["a7_govtech_in_build_half"] == len(gov) == 1000 and res["n2_in_build_half"] == len(n2) == 1000 and c["a7_govtech_blind"] == 0 and c["n2_blind"] == 0):
        die("作りの key の照らしが合わない: %s" % res)
    return res

def buildcheck(raw):
    D = d5(); import pyarrow.parquet as pq
    n = pq.ParquetFile(D.checked(raw, "govtech/train.parquet")).metadata.num_rows
    r = build_key_check(n, D.RAW["govtech/train.parquet"][1]); print("作りの key の照らし(行数 %d だけを使う): %s" % (n, r)); return r

def populations(raw):
    """層ごとに (key, text, scope, ds, src_id) の list と、除いた数。本文は返すだけで出さない"""
    D = d5(); k5, ka7, kn2 = used(); ek, es = D.excl(); ex = {"_keys": ek, "_scopes": es}
    allused = k5 | ka7 | kn2 | ek; out, rem = {}, {}
    for lab in ("H", "X", "N"):
        rows, c = [], collections.Counter()
        for k, text, scope, src, sid in D.iter_layer(raw, lab, ex):
            if k in k5: c["drawn_in_blind05"] += 1; continue
            if k in ka7: c["in_a7_build"] += 1; continue
            if k in kn2: c["in_n2_build"] += 1; continue
            rows.append((k, text, scope, src, sid))
        c.update({"blind05_rule:" + a: b for a, b in ex[lab].items()}); out[lab], rem[lab] = rows, dict(c)
    import pyarrow.parquet as pq
    rev = D.RAW["govtech/train.parquet"][1]; f = pq.ParquetFile(D.checked(raw, "govtech/train.parquet")); i = 0
    bkc = build_key_check(f.metadata.num_rows, rev)
    acc = {1: ("O_gov", [], collections.Counter()), 0: ("N2", [], collections.Counter())}
    for b in f.iter_batches(batch_size=200000, columns=["system_prompt", "prompt", "off_topic"]):
        d = b.to_pydict()
        for sp, u, o in zip(d["system_prompt"], d["prompt"], d["off_topic"]):
            i += 1
            if o not in acc: continue
            lab, rows, c = acc[o]; c["label_rows"] += 1
            if gov_half(i - 1) != "blind": c["build_half"] += 1; continue
            k = H("gabrielchua/off-topic|%s|train|%d" % (rev, i - 1))
            if not (sp or "").strip(): c["no_scope"] += 1; continue
            if not (u or "").strip(): c["no_text"] += 1; continue
            if k in ek: c["exclude_table_key"] += 1; continue
            if H(D.norm(sp)) in es: c["scope_in_exclude_or_D_C"] += 1; continue
            if k in k5: c["drawn_in_blind05"] += 1; continue
            if k in ka7: c["in_a7_build"] += 1; continue
            if k in kn2: c["in_n2_build"] += 1; continue
            rows.append((k, u, sp, "govtech/train" + ("_in_scope" if o == 0 else ""), str(i - 1)))
    for lab, rows, c in acc.values():
        for z in ("no_scope", "no_text", "exclude_table_key", "scope_in_exclude_or_D_C", "drawn_in_blind05", "in_a7_build", "in_n2_build"): c[z] += 0
        out[lab], rem[lab] = rows, {k: c[k] for k in sorted(c)}
    rows, c = [], collections.Counter()
    for ci, x in enumerate(rd(P("d_check_work/dl/canttalkaboutthis_topic_control_mixtral.jsonl"))):
        for j, dd in enumerate(x.get("distractors") or []):
            u = dd.get("distractor") if isinstance(dd, dict) else dd; sp = x.get("system_instruction") or ""; u = u if isinstance(u, str) else ""
            k = H("ctat|%s|mixtral|%d|%d" % (CTAT_REV, ci, j)); c["all"] += 1
            if not sp.strip(): c["no_scope"] += 1; continue
            if not u.strip(): c["no_text"] += 1; continue
            if k in allused:
                c["in_a7_build" if k in ka7 else "used_key_other"] += 1; continue
            if H(D.norm(sp)) in es: c["kept_scope_in_C_half"] += 1
            rows.append((k, u, sp, "ctat/mixtral", "%d.%d" % (ci, j)))
    out["O_ctat"], rem["O_ctat"] = rows, dict(c)
    for lab in LAYERS:
        ks = [r[0] for r in out[lab]]
        if len(ks) != len(set(ks)): die("%s に同じ key が 2 度ある" % lab)
        if set(ks) & allused: die("%s に使った key が残っている" % lab)
        if len(ks) != POP[lab] or keys_sha(ks) != POP_SHA[lab]: die("%s の母集団が計画と違う(%d 行、keys %s)" % (lab, len(ks), keys_sha(ks)[:16]))
    allk = [r[0] for lab in LAYERS for r in out[lab]]
    if len(allk) != len(set(allk)): die("層をまたいで同じ key がある")
    return out, rem, {"blind05_drawn": len(k5), "a7_build": len(ka7), "n2_build": len(kn2), "exclude_table": len(ek), "build_key_check": bkc}

def select(pops, salt, block, want=None):
    want = want or want_of(1000)
    if len(salt) != 64 or any(ch not in "0123456789abcdef" for ch in salt): die("塩が 64 桁の 16 進でない")
    if len(block) != 64 or not block.startswith("0000") or any(ch not in "0123456789abcdef" for ch in block): die("block hash の形でない")
    rows = []
    for lab in LAYERS:
        cand = pops[lab]; w = want[lab]
        if w is None: got = sorted(cand)
        else:
            if len(cand) < w: die("%s の母集団が足りない" % lab)
            got = [x[1] for x in heapq.nsmallest(w, ((score(salt, block, lab, r[0]), r) for r in cand))]
        for k, text, scope, src, sid in got:
            rows.append({"key": k, "layer": lab, "ds": src, "src_id": sid, "text": text, "scope": scope, "row_sha256": row_sha(k, text, scope)})
    return rows

def manifest(rows, pops, rem, uk, salt, block, want=None):
    want = want or want_of(1000)
    man = {"schema": "furui-blind06-manifest-v0", "salt_sha256": H(salt), "block_hash": block, "used_key_sets": uk, "govtech_rows_drawn": want["O_gov"],
           "layers": {lab: {"population": len(pops[lab]), "keys_sha256": keys_sha([r[0] for r in pops[lab]]), "wanted": want[lab] or len(pops[lab]),
                            "drawn": sum(1 for r in rows if r["layer"] == lab), "whole": want[lab] is None, "removed": rem[lab], "overlap_with_used_keys": 0} for lab in LAYERS},
           "rows": [{f: r[f] for f in ROW_FIELDS} for r in rows], "draw_rule": "whole for H, X, N; else smallest sha256(salt|block|layer|key)"}
    man["total_rows"] = len(rows)
    man["root"] = H("\n".join("%s %s %s" % (r["layer"], r["key"], r["row_sha256"]) for r in man["rows"]) + "\n")
    return man

def jl(rows): return "".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in rows)

def draw(raw, salt_p, block, plan_p, out, check_only=False):
    salt = open(salt_p).read().strip(); want = want_of(gov_n(plan_p)); tp = os.environ.get("FURUI_B06_TRIAL_ROWS")
    pops, rem, uk = trial_populations(tp) if tp else populations(raw)
    rows = select(pops, salt, block, want); man = manifest(rows, pops, rem, uk, salt, block, want)
    if man["total_rows"] != 2533 + want["O_gov"]: die("行の計が %d でない(%d)" % (2533 + want["O_gov"], man["total_rows"]))
    if check_only:
        old = json.load(open(os.path.join(out, "manifest.json"), encoding="utf-8"))
        same = old == man and fsha(os.path.join(out, "blind06.jsonl")) == H(jl(rows))
        print("引き直し: %s(root %s)" % ("同じ" if same else "違う", man["root"][:16])); return same
    if os.path.exists(out): die(out + " が既にある")
    tmp = out + ".tmp_draw"
    if os.path.exists(tmp):  # 前の回が途中で落ちた時の残り(この道具が作る dir だけを消す)
        for f in os.listdir(tmp): os.remove(os.path.join(tmp, f))
        os.rmdir(tmp)
    os.makedirs(tmp); os.chmod(tmp, 0o700)
    fd = os.open(os.path.join(tmp, "blind06.jsonl"), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh: fh.write(jl(rows))
    json.dump(man, open(os.path.join(tmp, "manifest.json"), "w"), indent=1, sort_keys=True)
    os.rename(tmp, out)  # 書き終えてから名を替える(途中で落ちた dir を残さない、REPLY_141 C6)
    for lab in LAYERS:
        L = man["layers"][lab]; print("%-6s 取った %4d / 母集団 %7d(%s)除いた %s" % (lab, L["drawn"], L["population"], "全部" if L["whole"] else "塩で引いた", L["removed"]))
    print("計 %d 行、使った key との重なり 0。manifest root %s、blind06.jsonl sha256 %s" % (man["total_rows"], man["root"][:16], fsha(os.path.join(out, "blind06.jsonl"))[:16]))

def selftest():
    ok = []
    def check(n, c): ok.append(bool(c)); print(("  ok   " if c else "  NG   ") + n)
    def stops(f):
        try: f(); return False
        except SystemExit as e: return bool(e.code)
    check("層と数は計画のとおり(全部 3 層、引く 3 層、GovTech は計画から)", [want_of(2000)[l] for l in LAYERS] == [None, None, None, 2000, 300, 1000] and POP["H"] + POP["X"] + POP["N"] + 1300 == 2533)
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        pp = os.path.join(d, "p.md")
        res = []
        for v in ("1,000", "2,000", "3,000"):
            open(pp, "w").write("x\nGovTech rows drawn: %s.\n" % v); res.append(gov_n(pp))
        check("計画の文から GovTech の行数を読む(1,000、2,000、3,000)", res == [1000, 2000, 3000])
        open(pp, "w").write("GovTech rows drawn: <TO FILL>.\n"); check("行数を埋めていなければ止まる", stops(lambda: gov_n(pp)))
        open(pp, "w").write("GovTech rows drawn: 1,500.\n"); check("三つの外の行数なら止まる", stops(lambda: gov_n(pp)))
    check("引きの順は塩、block、層、key で決まる(blind-05 の式)", score("a", "b", "N2", "k") == H("a|b|N2|k") and score("a", "b", "N2", "k") != score("a", "b", "O_gov", "k"))
    fake = {l: [] for l in LAYERS}; W2 = want_of(1000)
    for l in LAYERS:
        for i in range(5 if W2[l] is None else W2[l] + 7): fake[l].append((H(l + str(i)), "t%d" % i, "s%d" % i, "ds", str(i)))
    s1, b1 = "a" * 64, "0000" + "b" * 60
    r1 = select(fake, s1, b1); r2 = select(fake, s1, b1); r3 = select(fake, "c" * 64, b1)
    check("同じ塩と block なら同じ行", r1 == r2)
    check("塩が違えば引く行が替わる(全部の層は替わらない)", [r["key"] for r in r1 if r["layer"] == "N2"] != [r["key"] for r in r3 if r["layer"] == "N2"]
          and [r["key"] for r in r1 if r["layer"] == "H"] == [r["key"] for r in r3 if r["layer"] == "H"])
    check("引く層は欲しい数だけ、全部の層は全部", collections.Counter(r["layer"] for r in r1) == collections.Counter({"H": 5, "X": 5, "N": 5, "O_gov": 1000, "O_ctat": 300, "N2": 1000}))
    m = manifest(r1, fake, {l: {} for l in LAYERS}, {}, s1, b1)
    check("manifest の行は key、層、源、ID、hash だけ(本文と範囲が無い)", all(set(r) == set(ROW_FIELDS) for r in m["rows"]) and "t0" not in json.dumps(m))
    check("manifest は塩の sha だけを持ち、塩を持たない", m["salt_sha256"] == H(s1) and s1 not in json.dumps(m))
    check("塩の形が違えば止まる", stops(lambda: select(fake, "xyz", b1)))
    check("block hash の形が違えば止まる", stops(lambda: select(fake, s1, "ffff" + "b" * 60)))
    check("GovTech の割りは番号だけで決まり、両方の半分がある", {gov_half(i) for i in range(64)} == {"build", "blind"})
    check("固定の道具と使った key の file の sha が合う", all(fsha(os.path.join(ops(), k)).startswith(v) for k, v in PINS.items()))
    print("draw_blind06 selftest %d / %d %s" % (sum(ok), len(ok), "all green" if all(ok) else "RED"))
    return all(ok)

if __name__ == "__main__":
    a = sys.argv[1:]
    if a == ["selftest"]: sys.exit(0 if selftest() else 1)
    elif a[:1] == ["draw"] and len(a) == 6: draw(*a[1:])
    elif a[:1] == ["buildcheck"] and len(a) == 2: buildcheck(a[1])
    elif a[:1] == ["verify"] and len(a) == 6: sys.exit(0 if draw(*a[1:], check_only=True) else 1)
    else: die("usage は頭の注")
