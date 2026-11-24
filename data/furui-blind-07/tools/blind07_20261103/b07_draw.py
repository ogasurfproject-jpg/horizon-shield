#!/usr/bin/env python3
# blind-07 の引き(BLIND07_PLAN.md 06bad04c の 3 節と 10 節の 3)。書いた者 番人(Team)の担当 2026-11-08、照らすのは番人(個人)。
# 呼ばない、網に出ない(台帳と block の答えは台本が curl で取って file で渡す)。本文、範囲の文、塩は画面にも manifest にも出さない(数、key、hash だけ)。
# 式: 層ごとに sha256(塩 | block hash | 層の名 | key) の小さい順(entry 231 の 5 節の 3、blind-06 の draw_blind06.py 9806c3f8 の score と同じ形)。
#   層の名は計画の 10 節の 3 の N2_b07、GOV_b07、DOOR_b07、JA3_b07。
# 層(計画の 3 節):
#   N2   GovTech train の off_topic=0、盲検の側、blind-05 と blind-06 で引いた key と作りの key を除いた 662,261 行(keys 4d0ab8f6)。塩で 1,000 行。
#   GOV  同じく off_topic=1 の 647,776 行(keys 06dc4209)。塩で 1,000 行。
#        母集団は b07_census.py(275c9742、計画の 13 節)の gov_keys(blind-06 の決まりで key だけ作る)から、blind-06 で引いた key(blind06_draw/manifest.json 38aee098)を除く。
#   JB   furui_ja_benign_20261025/items.jsonl(4078e677)の measure の 2,812 行(keys 7668cc11)。全部(引かない)。範囲は J_BENIGN_SCOPE.txt(88cc8485)の文。
#   DOOR JB の 2,812 行から 50 行、この回で引いた N2 の 1,000 行から 50 行(門に送る 100 行。計画の 10 節の 3 と 8)。層の名は両方とも DOOR_b07。
#   JA3  SPML の MEASURE の残り(furui_blind02_pop/split の measure.jsonl a0c72b21)から、blind-05 の層 P の 232 key(並べた file の sha 74071852)を除いた
#        攻めの 1,519 行(keys bfa1857d)。b07_j3.py(50ed5285)の pool と sheet で 300 行の訳す表を作る(層の名 JA3_b07 は b07_j3.py の LABEL)。
# block: 台帳の entry 272 の JSON の bitcoin_block と、/ledger/272/ots の証明の Bitcoin の高さが同じ事、二つの源(mempool.space と blockstream.info)の
#   その高さの block hash と header が同じ事、header の sha256d が hash になる事、証明を辿った値が header の merkle root と同じ事を照らす(blockcheck)。
# 試しだけ: FURUI_B07_TRIAL_PINS(試しの JSON)があれば、PIN をその file の pins に替え、N2 と GOV の母集団を GovTech でなくその file の rows から作る。
#   TOshi の引く台本は、この変数があると止まる。試しは盲検の行に道具を当てない。
# usage:
#   python3 -I -B b07_draw.py blockcheck <entry.json> <proof.ots> <plan.md> <hash1> <hash2> <header1> <header2> <out_block.json>
#   python3 -I -B b07_draw.py saltcheck <salt.hex>
#   python3 -I -B b07_draw.py draw <raw_dir> <salt.hex> <block.json> <net_dir> <out_dir>       (pyarrow のある python で)
#   python3 -I -B b07_draw.py verify <raw_dir> <salt.hex> <block.json> <net_dir> <out_dir>     引き直して同じか
#   python3 -I -B b07_draw.py b06check <raw_dir> <blind06_draw_dir> <blind06_salt.hex>       blind-06 の引いた層を同じ式で作り直し、manifest と照らす
#   python3 -I -B b07_draw.py selftest
import hashlib, heapq, importlib.util, json, os, re, sys
sys.dont_write_bytecode = True
def ops(): return os.path.expanduser("~/hs-core-private/ops-private")
PIN = {
    "entry": 272,
    "plan_sha256": "06bad04c14415d78dbf5168cfc3dc70af71b8448526128112d4e36bc4dd8fc67",
    "salt_sha256": "9c40c171fef98b81d66e0d35d967153401fa62dfe69ad410f4e013601ef854f4",
    "N2": {"population": 662261, "keys_sha256": "4d0ab8f67c2fb44a317802e6f8a35cd727234adac732fea0b4d60c9cc2bc030a"},
    "GOV": {"population": 647776, "keys_sha256": "06dc4209c3b03b16bd261b98a61232931444371a0fd3116cf2d8f68e6b05ec9d"},
    "JB": {"population": 2812, "keys_sha256": "7668cc11dd6fff6faadf4452192d223be055ce8edd42e0f64e1133a6283770b3",
           "items_sha256": "4078e677d0a47c74d93b321b93e24146b91644ab6ddfa67bfb997fd03385ebe8",
           "scope_sha256": "88cc84854ec40d039e566c0150c960d2067fea9d305da6ab5c2aa68aedb16e7a"},
    "JA3": {"population": 1519, "keys_sha256": "bfa1857d79fff010ca8ec34037d3129cc85431f53397b523602aaed02fcc24f4",
            "source_sha256": "a0c72b219d9390591c8b2b33f5a91464d1da0355ccbe94f185ffbb5aaf435371",
            "used_keys_sha256": "74071852459627b9ac419a9f2cae88d3efd851bce27ce0cba88c75df6985932c", "n": 300},
    "want": {"N2": 1000, "GOV": 1000, "DOOR_JB": 50, "DOOR_N2": 50},
    "b06_drawn": {"N2": 1000, "O_gov": 3000},
}
LABEL = {"N2": "N2_b07", "GOV": "GOV_b07", "DOOR": "DOOR_b07", "JA3": "JA3_b07"}
SRCP = {"N2": "N2/gabrielchua@226c66f5/", "GOV": "GOV/gabrielchua@226c66f5/", "JB": "JB/hs@156d0db1/"}
TOOLS = {"blind07_20261103/b07_census.py": "275c9742041b52857c2ab9ba75933489b55f0e3c6bad517fe02ed8b2b7b8613b",
         "blind07_20261103/b07_j3.py": "50ed528526d4e09f6203871ecc95ed2156d28b627cd9d3accb9e1e9145247ec5",
         "blind06_draw/manifest.json": "38aee098a7823c8bd59a2f43a9cb5e9a9fa48581ca49774438d8e32b5f726542"}
F_ITEMS = "furui_ja_benign_20261025/items.jsonl"
F_SCOPE = "blind07_20261103/J_BENIGN_SCOPE.txt"
F_SPML = "furui_blind02_pop/split/reshabhs__SPML_Chatbot_Prompt_Injection.measure.jsonl"
F_B05 = "blind05_draw/manifest.json"
JB_PREFIX = "hs@156d0db10074ab44547832dbd415469d7666c95f|furui_ja_benign_20261025|"
GOV_PREFIX = "gabrielchua/off-topic|226c66f56fbbd032b17ea07528b7057078eb0dc6|train|"
ROW_FIELDS = ("src", "key", "layer", "ds", "src_id", "row_sha256")
def die(m): sys.exit("止めた: " + m)
def H(s): return hashlib.sha256(s.encode("utf-8")).hexdigest()
def fsha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
    return h.hexdigest()
def rd(p): return [json.loads(l) for l in open(p, encoding="utf-8") if l.strip()]
def jl(rows): return "".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in rows)
def keys_sha(ks): return H("\n".join(sorted(ks)) + "\n")
def score(salt, block, label, k): return H("%s|%s|%s|%s" % (salt, block, label, k))
def row_sha(k, text, scope): return H(json.dumps({"key": k, "text": text, "scope": scope}, ensure_ascii=False, sort_keys=True))
def jb_key(i): return H(JB_PREFIX + i)

def pick(salt, block, label, keys, n):
    """key の list から、sha256(塩|block|層の名|key) の小さい n 個を、小さい順で返す"""
    if not re.fullmatch(r"[0-9a-f]{64}", salt): die("塩が 64 桁の 16 進でない")
    if not re.fullmatch(r"0000[0-9a-f]{60}", block): die("block hash の形でない")
    if len(keys) != len(set(keys)): die("%s の母集団に同じ key が 2 度ある" % label)
    if len(keys) < n: die("%s の母集団が %d 行で、%d 行に足りない" % (label, len(keys), n))
    return [k for _, k in heapq.nsmallest(n, ((score(salt, block, label, k), k) for k in keys))]

def pins():
    tp = os.environ.get("FURUI_B07_TRIAL_PINS")
    if not tp: return PIN, None
    t = json.load(open(tp, encoding="utf-8"))
    return t["pins"], t

def P(rel):
    p = os.path.join(ops(), rel)
    if not os.path.isfile(p) or fsha(p) != TOOLS[rel]: die("%s が無いか、固定の %s でない" % (rel, TOOLS[rel][:8]))
    return p

def load(name, p):
    s = importlib.util.spec_from_file_location(name, p); m = importlib.util.module_from_spec(s); sys.modules[name] = m; s.loader.exec_module(m); return m

# ---- block の照らし ----
OTS_MAGIC = b"\x00OpenTimestamps\x00\x00Proof\x00\xbf\x89\xe2\xe8\x84\xe8\x92\x94"
OTS_BTC = bytes.fromhex("0588960d73d71901")
class _R:
    """OTS の証明を読む(trace_pr143_20261103/ots_walk.py 50f5b3b6 と同じ読み方)"""
    def __init__(s, b): s.b, s.i = b, 0
    def byte(s):
        if s.i >= len(s.b): raise ValueError("証明が途中で切れている")
        v = s.b[s.i]; s.i += 1; return v
    def take(s, n):
        v = s.b[s.i:s.i + n]
        if len(v) != n: raise ValueError("証明が途中で切れている")
        s.i += n; return v
    def varuint(s):
        v, sh = 0, 0
        while True:
            c = s.byte(); v |= (c & 0x7f) << sh; sh += 7
            if not c & 0x80: return v
    def varbytes(s): return s.take(s.varuint())

def _op(op, r, msg):
    if op == 0x08: return hashlib.sha256(msg).digest()
    if op == 0x02: return hashlib.sha1(msg).digest()
    if op == 0x03: return hashlib.new("ripemd160", msg).digest()
    if op == 0xf0: return msg + r.varbytes()
    if op == 0xf1: return r.varbytes() + msg
    if op == 0xf2: return msg[::-1]
    if op == 0xf3: return msg.hex().encode()
    raise ValueError("知らない op %#x" % op)

def _walk(r, msg, out, depth=0):
    if depth > 4000: raise ValueError("証明が深すぎる")
    while True:
        tag = r.byte()
        if tag == 0xff:
            _one(r, msg, out, r.byte(), depth + 1); continue
        _one(r, msg, out, tag, depth + 1); return

def _one(r, msg, out, tag, depth):
    if tag == 0x00:
        out.append((r.take(8), r.varbytes(), msg)); return
    _walk(r, _op(tag, r, msg), out, depth)

def ots_attest(b):
    """(証明の file の digest, [(Bitcoin の高さ, その点の値)])"""
    if not b.startswith(OTS_MAGIC): raise ValueError("OTS の証明の頭でない")
    r = _R(b); r.i = len(OTS_MAGIC)
    if r.varuint() != 1: raise ValueError("OTS の証明の版が 1 でない")
    if r.byte() != 0x08: raise ValueError("OTS の証明の file の hash が sha256 でない")
    d = r.take(32); out = []
    _walk(r, d, out)
    if r.i != len(b): raise ValueError("OTS の証明の後ろに余りがある")
    return d, [(_R(p).varuint(), m) for k, p, m in out if k == OTS_BTC]

def sha256d(b): return hashlib.sha256(hashlib.sha256(b).digest()).digest()

def blockcheck(entry_p, ots_p, plan_p, h1_p, h2_p, hd1_p, hd2_p, pn=None):
    pn = pn or pins()[0]
    e = json.load(open(entry_p, encoding="utf-8")); plan = open(plan_p, "rb").read(); rc = e.get("record_canonical") or ""
    if e.get("n") != pn["entry"]: die("台帳の entry の番号が %s でない(%s)" % (pn["entry"], e.get("n")))
    if hashlib.sha256(plan).hexdigest() != pn["plan_sha256"]: die("計画の file の sha256 が %s でない" % pn["plan_sha256"][:8])
    if e.get("claim_sha256") != pn["plan_sha256"] or H(rc) != pn["plan_sha256"] or rc.encode("utf-8") != plan:
        die("台帳の entry %s の claim か record_canonical が手元の計画と同じでない" % pn["entry"])
    if e.get("ots_status") != "confirmed" or not isinstance(e.get("bitcoin_block"), int) or isinstance(e.get("bitcoin_block"), bool):
        die("entry %s が Bitcoin でまだ確定していない(ots_status %s)。確定の前は引かない" % (pn["entry"], e.get("ots_status")))
    hl = e["bitcoin_block"]
    try: dg, att = ots_attest(open(ots_p, "rb").read())
    except (ValueError, IndexError) as x: die("OTS の証明が読めない(%s)" % x)
    if dg.hex() != pn["plan_sha256"]: die("OTS の証明が計画の sha256 の物でない")
    hs = sorted({h for h, _ in att})
    if not att: die("OTS の証明に Bitcoin の印が無い(まだ pending だけ)")
    if hs != [hl]: die("OTS の証明の Bitcoin の高さ %s と台帳の bitcoin_block %d が合わない" % (hs, hl))
    rd1 = lambda p: open(p, encoding="ascii").read().strip().lower()
    b1, b2, x1, x2 = rd1(h1_p), rd1(h2_p), rd1(hd1_p), rd1(hd2_p)
    if b1 != b2: die("二つの源の高さ %d の block hash が合わない" % hl)
    if not re.fullmatch(r"0000[0-9a-f]{60}", b1): die("block hash の形でない")
    if x1 != x2: die("二つの源の block header が合わない")
    if not re.fullmatch(r"[0-9a-f]{160}", x1): die("block header が 80 byte の 16 進でない")
    hd = bytes.fromhex(x1)
    if sha256d(hd)[::-1].hex() != b1: die("block header の sha256d が block hash にならない")
    mr = hd[36:68]
    if not any(m == mr for h, m in att if h == hl): die("OTS の証明を辿った値が block %d の header の merkle root と合わない" % hl)
    return {"entry": pn["entry"], "plan_sha256": pn["plan_sha256"], "block_height": hl, "block_hash": b1, "merkle_root": mr[::-1].hex(),
            "checks": ["ledger bitcoin_block == ots bitcoin height", "two sources give the same block hash and header",
                       "sha256d(header) == block hash", "ots path ends at the header merkle root"]}

# ---- 母集団 ----
def gov_pops(raw, pn, trial):
    """N2 と GOV の母集団の key の list と、key から (text, scope, ds, src_id) を引く関数"""
    if trial is not None:
        out = {}
        for lab in ("N2", "GOV"):
            rows = trial["rows"][lab]; out[lab] = [r["key"] for r in rows]
        tab = {r["key"]: (r["text"], r["scope"], r.get("ds", "trial"), str(r["src_id"])) for lab in ("N2", "GOV") for r in trial["rows"][lab]}
        return out, lambda ks: {k: tab[k] for k in ks}
    C = load("b07_census_b07d", P("blind07_20261103/b07_census.py")); D = C.d6()
    pops, rev = C.gov_keys(D, raw)
    b06 = json.load(open(P("blind06_draw/manifest.json"), encoding="utf-8"))["rows"]; out = {}
    for lab, l6 in (("N2", "N2"), ("GOV", "O_gov")):
        ks = pops[l6][0]
        if len(ks) != D.POP[l6] or keys_sha(ks) != D.POP_SHA[l6]: die("%s の blind-06 の母集団が作り直せない(%d 行)" % (lab, len(ks)))
        drawn = {r["key"] for r in b06 if r["layer"] == l6}
        if len(drawn) != pn["b06_drawn"][l6] or not drawn <= set(ks): die("blind-06 で引いた %s の key が %d でないか、母集団に無い" % (l6, pn["b06_drawn"][l6]))
        out[lab] = [k for k in ks if k not in drawn]
    return out, (lambda want: gov_text(D, raw, want))

def gov_text(D, raw, want):
    """選んだ key の行だけ、本文と範囲を GovTech の file から引く(key は行の番号だけで決まる)"""
    import pyarrow.parquet as pq
    D5 = D.d5(); f = pq.ParquetFile(D5.checked(raw, "govtech/train.parquet")); want = set(want); got = {}; i = 0
    if D5.RAW["govtech/train.parquet"][1] != GOV_PREFIX.split("|")[1]: die("GovTech の版が計画と違う")
    for b in f.iter_batches(batch_size=200000, columns=["system_prompt", "prompt", "off_topic"]):
        d = b.to_pydict()
        for sp, u, o in zip(d["system_prompt"], d["prompt"], d["off_topic"]):
            k = H(GOV_PREFIX + str(i))
            if k in want: got[k] = (u, sp, "govtech/train" + ("_in_scope" if o == 0 else ""), str(i))
            i += 1
    if set(got) != want: die("選んだ GovTech の行の本文が %d 行引けない" % len(want - set(got)))
    return got

def jb_pop(pn):
    p = os.path.join(ops(), F_ITEMS); sp = os.path.join(ops(), F_SCOPE)
    if not os.path.isfile(p) or fsha(p) != pn["JB"]["items_sha256"]: die("JB の items.jsonl が無いか、%s でない" % pn["JB"]["items_sha256"][:8])
    if not os.path.isfile(sp) or fsha(sp) != pn["JB"]["scope_sha256"]: die("J_BENIGN_SCOPE.txt が無いか、%s でない" % pn["JB"]["scope_sha256"][:8])
    raw = open(sp, encoding="utf-8").read()
    if not raw.endswith("\n") or raw.endswith("\n\n") or "\n" in raw[:-1]: die("J_BENIGN_SCOPE.txt が 1 行と LF 1 つの形でない")
    scope = raw[:-1]
    rows = {}
    for r in rd(p):
        if r.get("split") != "measure": continue
        k = jb_key(r["id"])
        if k in rows: die("JB の id が重なる")
        if not (r.get("text") or "").strip(): die("JB に本文の無い行がある")
        rows[k] = (r["text"], scope, "furui_ja_benign_20261025", r["id"])
    if len(rows) != pn["JB"]["population"] or keys_sha(rows) != pn["JB"]["keys_sha256"]: die("JB の母集団が計画と違う(%d 行)" % len(rows))
    return rows

def ja3_pop(pn, work):
    """SPML の残りの母集団。使った key の file は blind-05 の層 P の key から作り、sha を照らす"""
    J = load("b07_j3_b07d", P("blind07_20261103/b07_j3.py"))
    src = os.path.join(ops(), F_SPML)
    if not os.path.isfile(src) or fsha(src) != pn["JA3"]["source_sha256"]: die("SPML の measure.jsonl が無いか、%s でない" % pn["JA3"]["source_sha256"][:8])
    b5 = json.load(open(os.path.join(ops(), F_B05), encoding="utf-8"))["rows"]
    used = "".join(k + "\n" for k in sorted(r["key"] for r in b5 if r.get("layer") == "P"))
    if H(used) != pn["JA3"]["used_keys_sha256"]: die("blind-05 の層 P の key の file の sha256 が %s でない" % pn["JA3"]["used_keys_sha256"][:8])
    up = os.path.join(work, "spml_used_keys.txt")
    if not os.path.exists(up):
        fd = os.open(up, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
        with os.fdopen(fd, "w") as f: f.write(used)
    elif fsha(up) != pn["JA3"]["used_keys_sha256"]: die(up + " の中身が違う")
    rows, _ = J.pool(src, up)
    if len(rows) != pn["JA3"]["population"] or keys_sha([r["key"] for r in rows]) != pn["JA3"]["keys_sha256"]: die("JA3 の母集団が計画と違う(%d 行)" % len(rows))
    if J.LABEL != LABEL["JA3"]: die("b07_j3.py の層の名が JA3_b07 でない")
    return J, src, up, rows

def read_salt(p, pn):
    s = open(p).read().strip()
    if not re.fullmatch(r"[0-9a-f]{64}", s): die("塩が 64 桁の 16 進でない")
    if H(s) != pn["salt_sha256"]: die("塩の sha256 が計画の %s と違う" % pn["salt_sha256"][:8])
    return s

def build(raw, salt_p, block_p, work):
    pn, trial = pins(); salt = read_salt(salt_p, pn)
    bj = json.load(open(block_p, encoding="utf-8")); block = bj["block_hash"]
    if bj.get("entry") != pn["entry"] or bj.get("plan_sha256") != pn["plan_sha256"]: die("block.json が entry %s の物でない" % pn["entry"])
    pops, text_of = gov_pops(raw, pn, trial)
    for lab in ("N2", "GOV"):
        if len(pops[lab]) != pn[lab]["population"] or keys_sha(pops[lab]) != pn[lab]["keys_sha256"]: die("%s の母集団が計画と違う(%d 行)" % (lab, len(pops[lab])))
    if set(pops["N2"]) & set(pops["GOV"]): die("N2 と GOV に同じ key がある")
    jb = jb_pop(pn)
    J, src, up, ja = ja3_pop(pn, work)
    got = {"N2": pick(salt, block, LABEL["N2"], pops["N2"], pn["want"]["N2"]), "GOV": pick(salt, block, LABEL["GOV"], pops["GOV"], pn["want"]["GOV"])}
    door = {"JB": pick(salt, block, LABEL["DOOR"], sorted(jb), pn["want"]["DOOR_JB"]), "N2": pick(salt, block, LABEL["DOOR"], got["N2"], pn["want"]["DOOR_N2"])}
    ja_keys = pick(salt, block, LABEL["JA3"], [r["key"] for r in ja], pn["JA3"]["n"])
    sheet = sorted(heapq.nsmallest(pn["JA3"]["n"], ja, key=lambda r: J.score(salt, block, r["key"])), key=lambda r: r["key"])
    if sorted(ja_keys) != [r["key"] for r in sheet]: die("JA3 の引きが b07_j3.py の式と合わない")
    tx = text_of(got["N2"] + got["GOV"]); rows = []
    for lab in ("N2", "GOV"):
        for k in got[lab]:
            t, s, ds, sid = tx[k]
            if not (t or "").strip() or not (s or "").strip(): die("%s に本文か範囲の無い行がある" % lab)
            rows.append({"src": SRCP[lab] + k, "key": k, "layer": lab, "ds": ds, "src_id": sid, "text": t, "scope": s, "row_sha256": row_sha(k, t, s)})
    for k in sorted(jb):
        t, s, ds, sid = jb[k]
        rows.append({"src": SRCP["JB"] + k, "key": k, "layer": "JB", "ds": ds, "src_id": sid, "text": t, "scope": s, "row_sha256": row_sha(k, t, s)})
    sheet_txt = J.jl([{"key": r["key"], "text": r["text"]} for r in sheet])
    man = {"schema": "furui-blind07-manifest-v0", "entry": pn["entry"], "plan_sha256": pn["plan_sha256"], "salt_sha256": H(salt),
           "block_hash": block, "block_height": bj["block_height"], "block_check": bj,
           "draw_rule": "smallest sha256(salt|block|label|key); JB whole; DOOR_b07 draws 50 of the JB rows and 50 of the drawn N2 rows",
           "layers": {"N2": {"label": LABEL["N2"], "population": len(pops["N2"]), "keys_sha256": keys_sha(pops["N2"]), "drawn": len(got["N2"])},
                      "GOV": {"label": LABEL["GOV"], "population": len(pops["GOV"]), "keys_sha256": keys_sha(pops["GOV"]), "drawn": len(got["GOV"])},
                      "JB": {"label": None, "population": len(jb), "keys_sha256": keys_sha(jb), "drawn": len(jb), "whole": True, "scope_sha256": pn["JB"]["scope_sha256"]},
                      "DOOR": {"label": LABEL["DOOR"], "from_JB": len(jb), "from_N2": len(got["N2"]), "drawn_JB": len(door["JB"]), "drawn_N2": len(door["N2"])},
                      "JA3": {"label": LABEL["JA3"], "population": len(ja), "keys_sha256": keys_sha([r["key"] for r in ja]), "drawn": len(ja_keys),
                              "source_sha256": pn["JA3"]["source_sha256"], "used_keys_sha256": pn["JA3"]["used_keys_sha256"], "sheet_sha256": H(sheet_txt),
                              "drawn_keys_sha256": keys_sha(ja_keys)}},
           "rows": [{f: r[f] for f in ROW_FIELDS} for r in rows],
           "door": [{"src": SRCP["JB"] + k, "layer": "JB"} for k in door["JB"]] + [{"src": SRCP["N2"] + k, "layer": "N2"} for k in door["N2"]],
           "ja3_keys": ja_keys, "trial": trial is not None}
    man["total_rows"] = len(rows)
    man["root"] = H("\n".join("%s %s" % (r["src"], r["row_sha256"]) for r in man["rows"]) + "\n")
    return man, rows, sheet_txt

def wnew(p, s, mode):
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(fd, "w", encoding="utf-8") as f: f.write(s)

NET_FILES = ("plan_entry.json", "proof.ots", "hash1.txt", "hash2.txt", "header1.txt", "header2.txt", "block.json")
def draw(raw, salt_p, block_p, net, out, check_only=False):
    if check_only:
        man, rows, sheet_txt = build(raw, salt_p, block_p, out)
        old = json.load(open(os.path.join(out, "manifest.json"), encoding="utf-8"))
        same = old == man and fsha(os.path.join(out, "b07_rows.jsonl")) == H(jl(rows)) and fsha(os.path.join(out, "ja3_sheet.jsonl")) == H(sheet_txt)
        print("引き直し: %s(root %s)" % ("同じ" if same else "違う", man["root"][:16])); return same
    if os.path.exists(out): die(out + " が既にある")
    tmp = out + ".tmp_draw"
    if os.path.exists(tmp):
        for f in os.listdir(tmp): os.remove(os.path.join(tmp, f))
        os.rmdir(tmp)
    os.makedirs(tmp); os.chmod(tmp, 0o700)
    man, rows, sheet_txt = build(raw, salt_p, block_p, tmp)
    for f in NET_FILES:
        b = open(os.path.join(net, f), "rb").read()
        fd = os.open(os.path.join(tmp, f), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
        with os.fdopen(fd, "wb") as h: h.write(b)
    wnew(os.path.join(tmp, "b07_rows.jsonl"), jl(rows), 0o600)
    wnew(os.path.join(tmp, "ja3_sheet.jsonl"), sheet_txt, 0o600)
    wnew(os.path.join(tmp, "manifest.json"), json.dumps(man, indent=1, sort_keys=True, ensure_ascii=False) + "\n", 0o644)
    os.rename(tmp, out)
    for lab in ("N2", "GOV", "JB", "JA3"):
        L = man["layers"][lab]; print("%-4s 取った %4d / 母集団 %7d(keys %s)" % (lab, L["drawn"], L["population"], L["keys_sha256"][:16]))
    print("DOOR JB %d、N2 %d。block %d %s…。計 %d 行、manifest root %s、b07_rows.jsonl sha256 %s、訳す表 sha256 %s" % (
        man["layers"]["DOOR"]["drawn_JB"], man["layers"]["DOOR"]["drawn_N2"], man["block_height"], man["block_hash"][:16], man["total_rows"], man["root"][:16],
        fsha(os.path.join(out, "b07_rows.jsonl"))[:16], fsha(os.path.join(out, "ja3_sheet.jsonl"))[:16]))
    return man

# ---- blind-06 の作り直し(式の照らし) ----
def b06check(raw, d6dir, salt_p):
    """blind-06 の引いた層(N2 1,000、O_gov 3,000、O_ctat 300)を、この file の pick で作り直し、manifest の行(順、key、源、ID、row_sha256)と照らす"""
    man = json.load(open(os.path.join(d6dir, "manifest.json"), encoding="utf-8")); salt = open(salt_p).read().strip()
    if H(salt) != man["salt_sha256"]: die("blind-06 の塩の sha256 が manifest と違う")
    block = open(os.path.join(d6dir, "block_hash.txt")).read().strip()
    if block != man["block_hash"]: die("block_hash.txt が manifest と違う")
    C = load("b07_census_b06c", P("blind07_20261103/b07_census.py")); D = C.d6(); D5 = D.d5()
    pops, rev = C.gov_keys(D, raw)
    k5, ka7, kn2 = D.used(); ek, es = D5.excl(); allused = k5 | ka7 | kn2 | ek
    ct, ctx = [], {}
    for ci, x in enumerate(rd(D.P("d_check_work/dl/canttalkaboutthis_topic_control_mixtral.jsonl"))):
        for j, dd in enumerate(x.get("distractors") or []):
            u = dd.get("distractor") if isinstance(dd, dict) else dd; sp = x.get("system_instruction") or ""; u = u if isinstance(u, str) else ""
            k = H("ctat|%s|mixtral|%d|%d" % (D.CTAT_REV, ci, j))
            if not sp.strip() or not u.strip() or k in allused: continue
            ct.append(k); ctx[k] = (u, sp, "ctat/mixtral", "%d.%d" % (ci, j))
    keys = {"N2": pops["N2"][0], "O_gov": pops["O_gov"][0], "O_ctat": ct}; res = {}; ok = True
    for lab, ks in keys.items():
        L = man["layers"][lab]; mrows = [r for r in man["rows"] if r["layer"] == lab]
        pop_ok = len(ks) == L["population"] and keys_sha(ks) == L["keys_sha256"]
        got = pick(salt, block, lab, ks, L["drawn"])
        order_ok = got == [r["key"] for r in mrows]
        if lab == "O_ctat": tx = {k: ctx[k] for k in got}
        else:
            tx = gov_text(D, raw, got)
        rows_ok = all(r["row_sha256"] == row_sha(r["key"], tx[r["key"]][0], tx[r["key"]][1]) and r["src_id"] == tx[r["key"]][3] and r["ds"] == tx[r["key"]][2]
                      for r in mrows) if order_ok else False
        res[lab] = {"population": len(ks), "population_matches": pop_ok, "drawn": len(got), "same_keys_same_order": order_ok, "same_rows": rows_ok}
        ok = ok and pop_ok and order_ok and rows_ok
    print(json.dumps(res, sort_keys=True))
    print("blind-06 の引いた層の作り直し: %s" % ("manifest と同じ" if ok else "違う"))
    return ok

# ---- 自己試験 ----
def _mine_header(merkle_internal):
    """試しの header(sha256d の頭が 16 bit の 0 になる nonce を探す)"""
    import struct
    for n in range(1 << 24):
        hd = struct.pack("<I", 0x20000000) + b"\x11" * 32 + merkle_internal + struct.pack("<III", 1700000000, 0x17030000, n)
        h = sha256d(hd)[::-1]
        if h[:2] == b"\x00\x00": return hd.hex(), h.hex()
    raise RuntimeError("nonce が見つからない")

def _varuint(n):
    out = b""
    while True:
        b = n & 0x7f; n >>= 7
        if n: out += bytes([b | 0x80])
        else: return out + bytes([b])

def _vb(b): return _varuint(len(b)) + b

def make_proof(digest, height, extra=b"\x00" * 8):
    """試しの OTS 証明: digest に append、sha256 をして Bitcoin の印(と pending の印)。返すのは (bytes, 印の点の値)"""
    m = hashlib.sha256(digest + extra).digest()
    body = b"\xff" + b"\x00" + bytes.fromhex("83dfe30d2ef90c8e") + _vb(b"https://example.invalid") + b"\xf0" + _vb(extra) + b"\x08" + b"\x00" + OTS_BTC + _vb(_varuint(height))
    return OTS_MAGIC + b"\x01" + b"\x08" + digest + body, m

def selftest():
    import socket, tempfile
    ok = []
    def t(n, c): ok.append(bool(c)); print(("  ok   " if c else "  NG   ") + n)
    def stops(f, *a, **k):
        try: f(*a, **k); return False
        except SystemExit as e: return bool(e.code)
    real = socket.socket
    socket.socket = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("網"))
    try:
        t("式は sha256(塩|block|層の名|key)(entry 231 の 5 節の 3 と同じ形)", score("a", "b", "N2_b07", "k") == H("a|b|N2_b07|k"))
        ks = [H("k%d" % i) for i in range(500)]; s1, s2, b1 = "a" * 64, "c" * 64, "0000" + "b" * 60
        p1 = pick(s1, b1, "N2_b07", ks, 50)
        t("同じ塩、block、層の名なら同じ答え(順も同じ)", p1 == pick(s1, b1, "N2_b07", list(reversed(ks)), 50))
        t("塩が違えば答えが替わる", p1 != pick(s2, b1, "N2_b07", ks, 50))
        t("層の名が違えば答えが替わる(N2_b07 と DOOR_b07)", p1 != pick(s1, b1, "DOOR_b07", ks, 50))
        t("小さい順で、選ばれなかった key はどれも選んだ最大より大きい", sorted(score(s1, b1, "N2_b07", k) for k in p1) == [score(s1, b1, "N2_b07", k) for k in p1]
          and min(score(s1, b1, "N2_b07", k) for k in ks if k not in p1) > score(s1, b1, "N2_b07", p1[-1]))
        t("塩の形が違えば止まる", stops(pick, "xyz", b1, "N2_b07", ks, 5))
        t("block hash の形が違えば止まる", stops(pick, s1, "ffff" + "b" * 60, "N2_b07", ks, 5))
        t("母集団が足りなければ止まる", stops(pick, s1, b1, "N2_b07", ks[:3], 5))
        t("同じ key が 2 度あれば止まる", stops(pick, s1, b1, "N2_b07", ks + ks[:1], 5))
        t("JB の key は計画の 3 節の形(hs@156d0db1…|furui_ja_benign_20261025| と id)", jb_key("ja-00001") == H("hs@156d0db10074ab44547832dbd415469d7666c95f|furui_ja_benign_20261025|ja-00001"))
        t("PIN は計画の値(N2 662,261、GOV 647,776、JB 2,812、JA3 1,519 と 300、DOOR 50 と 50、entry 272)",
          (PIN["N2"]["population"], PIN["GOV"]["population"], PIN["JB"]["population"], PIN["JA3"]["population"], PIN["JA3"]["n"], PIN["want"]["DOOR_JB"], PIN["want"]["DOOR_N2"], PIN["entry"])
          == (662261, 647776, 2812, 1519, 300, 50, 50, 272))
        pp = os.path.join(ops(), "blind07_20261103", "BLIND07_PLAN.md")
        if os.path.isfile(pp) and fsha(pp) == PIN["plan_sha256"]:
            txt = open(pp, encoding="utf-8").read()
            vals = [PIN["salt_sha256"], PIN["N2"]["keys_sha256"], PIN["GOV"]["keys_sha256"], PIN["JB"]["keys_sha256"], PIN["JA3"]["keys_sha256"], PIN["JB"]["scope_sha256"],
                    PIN["JB"]["items_sha256"][:8], TOOLS["blind07_20261103/b07_census.py"], TOOLS["blind07_20261103/b07_j3.py"], TOOLS["blind06_draw/manifest.json"]]
            t("PIN の sha と道具の sha が計画の文にある(%d 個)" % len(vals), all(v in txt for v in vals) and all(w in txt for w in ("N2_b07", "GOV_b07", "DOOR_b07", "JA3_b07")))
        # block の照らし
        with tempfile.TemporaryDirectory() as d:
            plan = b"# trial plan\n"; ps = hashlib.sha256(plan).hexdigest()
            pn = dict(PIN, plan_sha256=ps, entry=272)
            proof, m = make_proof(bytes.fromhex(ps), 975030)
            hd, bh = _mine_header(m)
            w = lambda n, b: open(os.path.join(d, n), "wb").write(b if isinstance(b, bytes) else b.encode())
            w("plan.md", plan); w("p.ots", proof); w("h1", bh); w("h2", bh + "\n"); w("x1", hd); w("x2", hd)
            def ent(**kw):
                e = {"n": 272, "claim_sha256": ps, "record_canonical": plan.decode(), "ots_status": "confirmed", "bitcoin_block": 975030}; e.update(kw)
                w("e.json", json.dumps(e))
            fp = lambda n: os.path.join(d, n)
            args = lambda: (fp("e.json"), fp("p.ots"), fp("plan.md"), fp("h1"), fp("h2"), fp("x1"), fp("x2"))
            ent(); r = blockcheck(*args(), pn=pn)
            t("block: 台帳の高さ、証明の高さ、二つの源の hash と header、sha256d、merkle root が全部合えば通る", r["block_height"] == 975030 and r["block_hash"] == bh)
            ent(bitcoin_block=975031); t("block: 台帳の高さと証明の高さが違えば止まる", stops(blockcheck, *args(), pn=pn))
            ent(ots_status="pending", bitcoin_block=None); t("block: 確定の前(pending)は止まる", stops(blockcheck, *args(), pn=pn))
            ent(n=271); t("block: entry の番号が違えば止まる", stops(blockcheck, *args(), pn=pn))
            ent(record_canonical="# other\n"); t("block: 台帳の記録が手元の計画と違えば止まる", stops(blockcheck, *args(), pn=pn))
            ent(); w("h2", "0000" + "e" * 60); t("block: 二つの源の hash が食い違えば止まる", stops(blockcheck, *args(), pn=pn))
            w("h2", bh); w("x2", hd[:-2] + ("00" if hd[-2:] != "00" else "01")); t("block: 二つの源の header が食い違えば止まる", stops(blockcheck, *args(), pn=pn))
            w("x2", hd); w("h1", "0000" + "e" * 60); w("h2", "0000" + "e" * 60); t("block: 二つの源が同じでも header の sha256d と合わなければ止まる", stops(blockcheck, *args(), pn=pn))
            w("h1", bh); w("h2", bh)
            p2, m2 = make_proof(bytes.fromhex(ps), 975030, extra=b"\x01" * 8); w("p.ots", p2)
            t("block: 証明を辿った値が header の merkle root と違えば止まる", stops(blockcheck, *args(), pn=pn))
            p3, _ = make_proof(hashlib.sha256(b"x").digest(), 975030); w("p.ots", p3)
            t("block: 証明が計画の sha256 の物でなければ止まる", stops(blockcheck, *args(), pn=pn))
            w("p.ots", proof[:-3]); t("block: 証明が途中で切れていれば止まる", stops(blockcheck, *args(), pn=pn))
        t("PIN の値を替える試しの変数は、無い時は PIN のまま", (os.environ.get("FURUI_B07_TRIAL_PINS") is not None) or pins()[0] is PIN)
    finally:
        socket.socket = real
    print("b07_draw selftest %d / %d %s" % (sum(ok), len(ok), "all green" if all(ok) else "RED"))
    return all(ok)

if __name__ == "__main__":
    a = sys.argv[1:]
    if a == ["selftest"]: sys.exit(0 if selftest() else 1)
    if a[:1] == ["blockcheck"] and len(a) == 9:
        r = blockcheck(*a[1:8])
        if os.path.exists(a[8]): die(a[8] + " が既にある")
        wnew(a[8], json.dumps(r, indent=1, sort_keys=True) + "\n", 0o644)
        print("block %d、hash %s(台帳と証明の高さ、二つの源の hash と header、merkle root が合う)" % (r["block_height"], r["block_hash"])); sys.exit(0)
    if a[:1] == ["saltcheck"] and len(a) == 2:
        read_salt(a[1], pins()[0]); print("塩の sha256 は計画の %s と合う(塩の中身は出さない)" % pins()[0]["salt_sha256"][:16]); sys.exit(0)
    if a[:1] == ["draw"] and len(a) == 6: draw(*a[1:]); sys.exit(0)
    if a[:1] == ["verify"] and len(a) == 6: sys.exit(0 if draw(*a[1:], check_only=True) else 1)
    if a[:1] == ["b06check"] and len(a) == 4: sys.exit(0 if b06check(*a[1:]) else 1)
    die("usage は頭の注")
