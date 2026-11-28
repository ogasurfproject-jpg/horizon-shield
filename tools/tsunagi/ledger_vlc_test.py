#!/usr/bin/env python3
"""Offline checks of ledger_vlc.py (the nightly VLC-1 grade of the ledger). No network: a made-up ledger of eight entries,
OpenTimestamps proofs and Bitcoin headers built here, and a stand-in for the checker that recomputes the jidec chain and
compares its head the way VLC-1 does. run_board_test.py runs these too.

With TSUNAGI_VLC_WHEEL and TSUNAGI_VLC_ADAPTER set to local copies of the pinned vlc-check wheel and adapter, the same
made-up ledger is also graded by the real checker (still offline)."""
import hashlib, io, json, os, re, sys, tempfile, zipfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ledger_vlc as lv

FD = lv.FD
STANDIN = r'''
import argparse, hashlib, json, sys
ap = argparse.ArgumentParser()
for k in ("--log", "--adapter", "--expect-head", "--mutate"):
    ap.add_argument(k)
ap.add_argument("--json", action="store_true")
a = ap.parse_args()
def h(o):
    return hashlib.sha256(json.dumps(o, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
lines = [l for l in open(a.log, encoding="utf-8").read().split("\n") if l.strip()]
if a.mutate == "truncate-tail":
    lines = lines[:-1]
elif a.mutate == "flip-byte":
    i = len(lines) // 2
    s = lines[i]
    j = len(s) // 2
    lines[i] = s[:j] + ("0" if s[j] != "0" else "1") + s[j + 1:]
ok, why, prev, ended = True, "chain consistent AND its head equal the value(s) supplied independently of the log", "0" * 64, False
try:
    recs = [json.loads(l) for l in lines]
except ValueError:
    recs, ok, why = [], False, "delivered set unreadable"
for r in recs:
    if r.get("schema") == "jidec-head-v1":
        if (r.get("prev_entry_sha256") != prev or r.get("head") != prev
                or h({k: r.get(k) for k in ("n", "schema", "prev_entry_sha256", "head")}) != r.get("entry_sha256")):
            ok, why = False, "end marker does not link to its predecessor"
        prev, ended = r.get("entry_sha256"), True
        break
    body = {k: r[k] for k in ("n", "schema", "claim_sha256", "created_at", "prev_entry_sha256") if k in r}
    if r.get("prev_entry_sha256") != prev or h(body) != r.get("entry_sha256"):
        ok, why = False, "link broken at n=%s" % r.get("n")
        break
    prev = r["entry_sha256"]
if ok and not ended:
    ok, why = False, "no end marker"
if ok and a.expect_head and prev != a.expect_head:
    ok, why = False, "final head does not equal the independently supplied head"
lvl = 1 if ok else 0
print(json.dumps({"spec": "stand-in", "adapter_sha256": hashlib.sha256(open(a.adapter, "rb").read()).hexdigest(),
                  "structural_level": lvl, "attested_level": lvl, "head": prev if ok else None,
                  "anchors": {"root": None, "head": a.expect_head},
                  "requirements": {"VLC-L1-1": {"status": "PASS" if ok else "FAIL", "note": why, "class": "structural"},
                                   "VLC-L2-1": {"status": "FAIL", "note": "adapter declares no production count or ordinal", "class": "structural"},
                                   "VLC-L2-2": {"status": "FAIL", "note": "not evaluated", "class": "structural"}}}))
'''
ALWAYS_L1 = r'''
import json, sys
print(json.dumps({"spec": "always", "adapter_sha256": "%s", "structural_level": 1, "attested_level": 1,
                  "head": sys.argv[sys.argv.index("--expect-head") + 1], "requirements": {}}))
'''
BROKEN = r'''
import json, sys
print(json.dumps({"spec": "broken", "error": "adapter", "message": "adapter could not be applied to this log"}))
sys.exit(2)
'''
ADAPTER_BYTES = b'{"name": "made-up adapter for the offline checks"}\n'
HEIGHT = 900000


def varuint(v):
    out = bytearray()
    while True:
        b, v = v & 0x7F, v >> 7
        out.append(b | (0x80 if v else 0))
        if not v:
            return bytes(out)


def proof(claim_hex, height):
    """-> (an OpenTimestamps proof committing claim to height, the merkle root it names, explorer byte order)"""
    d = bytes.fromhex(claim_hex)
    pay = varuint(height)
    b = FD.OTS_MAGIC + varuint(1) + b"\x08" + d + b"\x08" + b"\x00" + FD.OTS_BITCOIN + varuint(len(pay)) + pay
    return b, hashlib.sha256(d).digest()[::-1].hex()


def header(merkle_root):
    """-> (an 80 byte header hex whose merkle root is merkle_root and whose hash meets its own bits, its block hash)"""
    bits = 0x207FFFFF
    for nonce in range(1 << 16):
        hb = ((1).to_bytes(4, "little") + bytes(32) + bytes.fromhex(merkle_root)[::-1] + (1764000000).to_bytes(4, "little")
              + bits.to_bytes(4, "little") + nonce.to_bytes(4, "little"))
        bh = FD.sha256d(hb)[::-1].hex()
        if int(bh, 16) <= FD.bits_target(bits):
            return hb.hex(), bh
    raise RuntimeError("no nonce")


def chain(objs):
    """re-link a list of entry objects (n, claim_sha256, [schema], created_at) as the ledger's export rows"""
    prev, rows = lv.ZERO, []
    for o in objs:
        body = {"n": o["n"], "claim_sha256": o["claim_sha256"], "prev_entry_sha256": prev}
        for k in ("schema", "created_at"):
            if k in o:
                body[k] = o[k]
        h = lv.sha(lv.canon(body))
        rows.append(dict(body, entry_sha256=h))
        prev = h
    return rows


def export_of(rows):
    end = lv.marker_line(rows[-1]["n"], rows[-1]["entry_sha256"])
    return ("\n".join(json.dumps(r, separators=(",", ":")) for r in rows + [end]) + "\n").encode()


def world(n=8, checkpoints=((7, 5, "confirmed"), (8, 6, "pending")), bad_marker=False, alt=None, fixed=None):
    """n entries; each checkpoint (entry, covers 1..k, ots_status). Every other entry is confirmed too. fixed: entry ->
    the record bytes it carries instead (or a function of the links so far that gives them), the rest built over it."""
    objs, served, E = [], {}, {}
    for i in range(1, n + 1):
        ck = [c for c in checkpoints if c[0] == i]
        if fixed and i in fixed:
            rc = fixed[i](E) if callable(fixed[i]) else fixed[i]
        elif ck:
            k = ck[0][1]
            ms = lv.marker_line(k, E[k])["entry_sha256"]
            if bad_marker:
                ms = "f" + ms[1:] if ms[0] != "f" else "e" + ms[1:]
            rc = json.dumps({"schema": lv.CHECKPOINT, "anchored_at": "2026-11-%02dT00:30:00.000Z" % (10 + i),
                             "ledger_head": {"chain": lv.CHAIN, "n": k, "entry_sha256": E[k], "marker_sha256": ms},
                             "note": "made up"}, separators=(",", ":"))
        else:
            rc = json.dumps(dict({"schema": "made-up-v0", "i": i}, **({"alt": alt} if alt and i == 3 else {})), separators=(",", ":"))
        o = {"n": i, "claim_sha256": lv.sha(rc), "created_at": "2026-11-%02dT00:00:%02d.000Z" % (10 + i, i)}
        if i > 1:
            o["schema"] = "v0-plain"
        objs.append(o)
        E[i] = chain(objs)[-1]["entry_sha256"]
        st = ck[0][2] if ck else "confirmed"
        served[i] = {"n": i, "work": "made-up entry %d" % i, "claim_sha256": o["claim_sha256"], "record_canonical": rc,
                     "schema": o.get("schema"), "created_at": o["created_at"], "ots_status": st,
                     "bitcoin_block": HEIGHT + i if st == "confirmed" else None,
                     "block_time": "2026-11-%02d 01:00 UTC" % (10 + i) if st == "confirmed" else None}
    proofs, headers = {}, {}
    for i, e in served.items():
        if e["ots_status"] == "confirmed":
            proofs[i], root = proof(e["claim_sha256"], e["bitcoin_block"])
            headers[e["bitcoin_block"]] = header(root)
    rows = chain(objs)
    return {"objs": objs, "rows": rows, "export": export_of(rows), "entries": served, "proofs": proofs, "headers": headers, "E": E}


def wheel(src):
    bio = io.BytesIO()
    with zipfile.ZipFile(bio, "w") as z:
        for name, body in (("conformance.py", src), ("made_up-0.dist-info/METADATA", "Name: made-up\n")):
            z.writestr(zipfile.ZipInfo(name, date_time=(2026, 11, 27, 0, 0, 0)), body)
    return bio.getvalue()


def pins(src):
    w = wheel(src)
    ck = dict(lv.CHECKER, url="https://files.pythonhosted.org/packages/made/up/checker.whl", sha256=lv.sha(w), module_sha256=lv.sha(src))
    ad = dict(lv.ADAPTER, url="https://raw.githubusercontent.com/made/up/adapter.json", sha256=lv.sha(ADAPTER_BYTES))
    return w, ck, ad


def getter(W, w, ck, ad, over=None):
    over = over or {}

    def get(url, limit):
        if url in over:
            v = over[url]
            if isinstance(v, Exception):
                raise v
            return v
        if url == ck["url"]:
            return 200, w
        if url == ad["url"]:
            return 200, ADAPTER_BYTES
        if url == lv.EXPORT_URL:
            return 200, W["export"]
        m = re.fullmatch(re.escape(lv.LEDGER) + r"/ledger/([0-9]+)\?format=json", url)
        if m:
            e = W["entries"].get(int(m.group(1)))
            return (200, json.dumps(e).encode()) if e else (404, b'{"error":"not found"}')
        m = re.fullmatch(re.escape(lv.LEDGER) + r"/ledger/([0-9]+)/ots", url)
        if m:
            p = W["proofs"].get(int(m.group(1)))
            return (200, p) if p else (404, b'{"error":"proof not yet available"}')
        return 404, b""
    return get


def hgetter(W, differ=False, down=False):
    def get(url):
        if down:
            raise FD.NetError(url + ": connection refused")
        for name, base in FD.EXPLORERS:
            if url.startswith(base + "/block-height/"):
                x = W["headers"].get(int(url.rsplit("/", 1)[1]))
                return (200, x[1].encode()) if x else (404, b"")
            if url.startswith(base + "/block/") and url.endswith("/header"):
                bh = url[len(base + "/block/"):-len("/header")]
                for hx, bhx in W["headers"].values():
                    if bhx == bh:
                        return 200, (("0" if hx[0] != "0" else "1") + hx[1:] if differ and name == "blockstream" else hx).encode()
                return 404, b""
        return 404, b""
    return get


def run(t):
    W = world()
    w, ck, ad = pins(STANDIN)

    def go(W=W, src=None, over=None, h=None, **k):
        ww, cc, aa = pins(src) if src else (w, ck, ad)
        return lv.run(get=getter(W, ww, cc, aa, over=over), header_get=h or hgetter(W), checker=cc, adapter=aa, **k)
    with tempfile.TemporaryDirectory() as td:
        r = lv.run(get=getter(W, w, ck, ad), header_get=hgetter(W), checker=ck, adapter=ad, out_dir=td)
        cut = open(os.path.join(td, "cut.jsonl"), "rb").read()
        served = open(os.path.join(td, "export.jsonl"), "rb").read()
    m5 = lv.marker_line(5, W["E"][5])["entry_sha256"]
    t("ledger: a confirmed checkpoint, its proof and the block header from two explorers: ran and every step held",
      r["status"] == "ran" and r["ok"] is True)
    t("ledger: the newest checkpoint still waiting for Bitcoin is listed, not used",
      r["checkpoint"]["entry"] == 7 and [x["entry"] for x in r["checkpoint"]["waiting"]] == [8])
    t("ledger: entries 1..5 of 8 graded against the marker hash the checkpoint carries",
      r["cut"]["entries"] == 5 and r["export"]["entries"] == 8 and r["grade"]["head_compared"] == m5 == r["grade"]["head_reported"])
    t("ledger: the row keeps the sha256 of the export as served, and --out keeps its bytes",
      r["export"]["sha256"] == lv.sha(W["export"]) and served == W["export"])
    t("ledger: the cut is byte for byte the export the ledger serves when it has 5 entries",
      cut == export_of(W["rows"][:5]) and r["cut"]["sha256"] == lv.sha(cut))
    t("ledger: the grade string, and both Annex A controls at L0",
      r["grade"]["grade"] == "structural L1, attested L1" and r["controls_ok"]
      and sorted(r["controls"]) == sorted(lv.CONTROLS) and all(v["attested_level"] == 0 for v in r["controls"].values()))
    t("ledger: the anchor names the entry's block, the proof's merkle root, the block hash and the header's own time",
      r["anchor"]["proof"] == "ok" and r["anchor"]["bitcoin_header"] == "ok" and r["anchor"]["bitcoin_block"] == HEIGHT + 7
      and r["anchor"]["block_hash"] == W["headers"][HEIGHT + 7][1] and r["anchor"]["header_time"] == "2025-11-24T16:00:00Z")
    t("ledger: the export's links are recomputed by the board too, and its head is in the row",
      r["export"]["recomputed_head"] == W["E"][8] and r["export"]["problems"] == [] and r["earlier"] == {"nights": 0, "agree": 0, "disagree": []})
    night = lv.history_row("2026-11-26T18:41:00Z", r)
    ok2 = go(earlier=[night, {"at": "x", "status": "not_run"}, dict(night, ok=False, head_compared="0" * 64)])
    t("ledger: tonight's export reaches the head of the earlier night that held (nights that did not hold are not compared)",
      ok2["ok"] and ok2["earlier"] == {"nights": 1, "agree": 1, "disagree": []})
    bad = go(earlier=[dict(night, head_compared="0" * 64)])
    t("ledger: an earlier night's head tonight's export does not reach is not an ok row", not bad["ok"] and bad["earlier"]["disagree"][0]["graded"] == 5)
    bad = go(earlier=[dict(night, graded=99)])
    t("ledger: an earlier night graded past tonight's last entry is not an ok row", not bad["ok"] and "has 8 entries" in bad["earlier"]["disagree"][0]["why"])
    A = world(alt="rewritten")
    bad = go(W=A, h=hgetter(A), earlier=[night])
    t("ledger: entry 3 rewritten and a newer checkpoint stamped over the rewrite: graded L1 on its own, not ok against the earlier night",
      bad["grade"]["grade"] == "structural L1, attested L1" and bad["anchor"]["proof"] == "ok" and not bad["ok"]
      and bad["earlier"]["disagree"][0]["head_compared"] == m5)

    # the heads written inside the entries the walk reads (a rewrite under a new stamp, and no earlier night to compare with)
    sh = r["stamped_heads"]
    t("ledger: with no earlier night the walk reads every entry, each is the export's, and the export reaches both checkpoints' heads",
      sh["walked"] == {"from": 8, "to": 1, "whole_export": True, "complete": True, "stopped": None}
      and sh["entries_read"] == sh["entries_agree"] == 8 and sh["entries_disagree"] == []
      and (sh["seen"], sh["agree"], sh["confirmed"]) == (2, 2, 1) and sh["disagree"] == [] and sh["said_broken"] == [])
    O = world(n=9, checkpoints=((5, 4, "confirmed"), (8, 7, "confirmed")))
    hon = go(W=O, h=hgetter(O))
    t("ledger: two confirmed checkpoints and no earlier night: the newer is used, the older one's head is held too, every step held",
      hon["ok"] and hon["checkpoint"]["entry"] == 8 and hon["cut"]["entries"] == 7
      and (hon["stamped_heads"]["seen"], hon["stamped_heads"]["agree"], hon["stamped_heads"]["confirmed"]) == (2, 2, 2))
    RW = world(n=9, checkpoints=((5, 4, "confirmed"), (8, 7, "confirmed")), alt="rewritten", fixed={5: O["entries"][5]["record_canonical"]})
    hole = go(W=RW, h=hgetter(RW))
    t("ledger: entry 3 rewritten, every link re-derived, a new checkpoint stamped over it, the older checkpoint left and no earlier night: not ok",
      hole["status"] == "ran" and hole["grade"]["grade"] == "structural L1, attested L1" and hole["anchor"]["proof"] == "ok"
      and hole["cut"]["entry_n_is_the_checkpoint_s"] and hole["earlier"]["nights"] == 0 and not hole["ok"]
      and [(d["entry"], d["covers"]) for d in hole["stamped_heads"]["disagree"]] == [(5, 4)]
      and "does not reach the head it states for entries 1..4" in hole["stamped_heads"]["disagree"][0]["why"])
    md = "\n".join(lv.to_md(hole))
    t("ledger page and summary: the walk, and the head the export does not reach",
      "The walk read entries 9..1 (every entry): 9 of the 9 it read are the export's. The export, recomputed, reaches 1 of the 2 ledger heads" in md
      and "**not reached**: entry 5, checkpoint (the export, recomputed, does not reach the head it states for entries 1..4)" in md
      and "entries read 9..1 (every entry): 9 of 9 the export's, heads inside them reached 1 of 2; NOT ok" in lv.summary(hole))
    S1 = world(n=10, checkpoints=((5, 4, "confirmed"), (8, 7, "confirmed"), (10, 1, "confirmed")))
    one = go(W=S1, h=hgetter(S1))
    t("ledger: no earlier night and a newest checkpoint that covers 1..1: graded 1..1, and the row says so",
      one["ok"] and one["checkpoint"]["entry"] == 10 and one["cut"]["entries"] == 1 and one["stamped_heads"]["agree"] == 3)
    n7 = {"at": "2026-11-26T18:41:00Z", "status": "ran", "ok": True, "graded": 7, "head_compared": lv.marker_line(7, S1["E"][7])["entry_sha256"]}
    back = go(W=S1, h=hgetter(S1), earlier=[n7])
    t("ledger: a newest confirmed checkpoint covering fewer entries than an earlier night graded is not an ok row",
      back["status"] == "ran" and back["cut"]["entries"] == 1 and not back["ok"] and back["earlier"]["agree"] == 0
      and "covers 1..1, fewer than the 1..7 that night graded" in back["earlier"]["disagree"][0]["why"])
    L12 = world(n=12, checkpoints=((5, 4, "confirmed"), (11, 10, "confirmed")))
    R12 = world(n=12, checkpoints=((5, 4, "confirmed"), (11, 10, "confirmed")), alt="rewritten", fixed={5: L12["entries"][5]["record_canonical"]})
    bad = go(W=R12, h=hgetter(R12), look_back=3)
    t("ledger: with no earlier night the walk goes below the look-back too, and finds the older head the export does not reach",
      bad["checkpoint"]["entry"] == 11 and bad["checkpoint"]["looked_at"] == 12 and bad["stamped_heads"]["walked"]["to"] == 1
      and not bad["ok"] and [d["entry"] for d in bad["stamped_heads"]["disagree"]] == [5])
    n12 = lv.history_row("2026-11-26T18:41:00Z", go(W=L12, h=hgetter(L12), look_back=3))
    ok12 = go(W=L12, h=hgetter(L12), look_back=3, earlier=[n12])
    t("ledger: with an earlier night that held, the walk stops at the bottom of the look-back",
      n12["ok"] and ok12["ok"] and ok12["checkpoint"]["looked_at"] == 3
      and ok12["stamped_heads"]["walked"] == {"from": 12, "to": 10, "whole_export": False, "complete": True, "stopped": None})

    # a rewrite below the look-back and above every entry the earlier nights graded, under a new stamp: no earlier head
    # reaches it, so only the older stamp below the look-back shows it, and the walk has to go down to read that stamp
    H = world(n=14, checkpoints=((2, 1, "confirmed"), (6, 5, "confirmed"), (13, 12, "confirmed")))
    HR = world(n=14, checkpoints=((2, 1, "confirmed"), (6, 5, "confirmed"), (13, 12, "confirmed")), alt="rewritten",
               fixed={6: H["entries"][6]["record_canonical"]})
    n1 = {"at": "2026-11-20T18:41:00Z", "status": "ran", "ok": True, "graded": 1,
          "head_compared": lv.marker_line(1, H["E"][1])["entry_sha256"]}
    deep = go(W=HR, h=hgetter(HR), look_back=3, earlier=[n1])
    t("ledger: entry 3 rewritten under a new stamp, below the look-back and above the 1..1 the earlier night graded: the walk goes down, reads the older checkpoint, not ok",
      deep["status"] == "ran" and deep["grade"]["grade"] == "structural L1, attested L1" and deep["anchor"]["proof"] == "ok"
      and deep["earlier"] == {"nights": 1, "agree": 1, "disagree": []} and not deep["ok"]
      and deep["stamped_heads"]["walked"] == {"from": 14, "to": 2, "whole_export": False, "complete": True, "stopped": None,
                                              "above_earlier_graded": 1}
      and [(d["entry"], d["covers"]) for d in deep["stamped_heads"]["disagree"]] == [(6, 5)])
    fine = go(W=H, h=hgetter(H), look_back=3, earlier=[n1])
    t("ledger: the same ledger left honest, the same earlier night: every entry above the 1..1 it graded is read, every head agrees, ok",
      fine["ok"] and fine["checkpoint"]["looked_at"] == 13 and fine["stamped_heads"]["entries_read"] == 13
      and (fine["stamped_heads"]["seen"], fine["stamped_heads"]["agree"]) == (3, 3))
    md = "\n".join(lv.to_md(deep))
    t("ledger page and summary: a walk below the look-back says how far it went and why",
      "The walk read entries 14..2 (every entry above the 1..1 an earlier night graded): 13 of the 13 it read are the export's" in md
      and "entries read 14..2 (every entry above the 1..1 an earlier night graded): 13 of 13 the export's" in lv.summary(deep))
    n5 = {"at": "2026-11-22T18:41:00Z", "status": "ran", "ok": True, "graded": 5,
          "head_compared": lv.marker_line(5, H["E"][5])["entry_sha256"]}
    two = go(W=H, h=hgetter(H), look_back=3, earlier=[n1, n5, dict(n5, graded=12, ok=False)])
    t("ledger: with several earlier nights the walk goes down to the most entries one that held graded (a night that did not hold is not counted)",
      two["ok"] and two["stamped_heads"]["walked"]["to"] == 6 and two["stamped_heads"]["walked"]["above_earlier_graded"] == 5
      and two["stamped_heads"]["entries_read"] == 9 and two["earlier"] == {"nights": 2, "agree": 2, "disagree": []})
    keep = lv.WALK_SECONDS
    lv.WALK_SECONDS = -1
    try:
        slow = go(W=H, h=hgetter(H), look_back=3, earlier=[n1])
        quick = go(W=L12, h=hgetter(L12), look_back=3, earlier=[n12])
    finally:
        lv.WALK_SECONDS = keep
    t("ledger: a walk below the look-back has the time of a whole walk; a walk of the look-back alone keeps the short one",
      slow["ok"] and slow["stamped_heads"]["walked"]["complete"] and not quick["ok"]
      and (quick["stamped_heads"]["walked"]["stopped"] or "").endswith("-1 seconds"))
    e2 = dict(W["entries"][2], record_canonical="a record put in afterwards", claim_sha256=lv.sha("a record put in afterwards"))
    bad = go(over={lv.LEDGER + "/ledger/2?format=json": (200, json.dumps(e2).encode())})
    t("ledger: an entry the ledger serves with another claim than the export carries at that n is not an ok row",
      bad["status"] == "ran" and bad["grade"]["attested_level"] == 1 and not bad["ok"]
      and bad["stamped_heads"]["entries_disagree"] == [{"entry": 2, "why": "the export carries another claim_sha256 at this n"}])
    e2 = dict(W["entries"][2], record_canonical=W["entries"][2]["record_canonical"] + " ")
    bad = go(over={lv.LEDGER + "/ledger/2?format=json": (200, json.dumps(e2).encode())})
    t("ledger: an entry whose record bytes, as served, do not hash to its claim is not an ok row",
      bad["status"] == "ran" and not bad["ok"]
      and bad["stamped_heads"]["entries_disagree"] == [{"entry": 2, "why": "its record bytes do not hash to its claim_sha256"}])
    bad = go(over={lv.LEDGER + "/ledger/%d?format=json" % i: lv.NetError("timed out") for i in (4, 3, 2)})
    t("ledger: three entries in a row not fetched below the checkpoint end the walk, and the night is not ok",
      bad["status"] == "ran" and bad["grade"]["attested_level"] == 1 and not bad["ok"] and bad["stamped_heads"]["walked"]["complete"] is False
      and "at entry 1: three entries in a row could not be fetched" == bad["stamped_heads"]["walked"]["stopped"])
    bad = go(over={lv.LEDGER + "/ledger/3?format=json": (404, b'{"error":"not found"}')})
    t("ledger: an entry of the export the ledger does not serve leaves the walk incomplete, and the night not ok",
      bad["status"] == "ran" and not bad["ok"] and bad["stamped_heads"]["walked"]["complete"] is False
      and bad["stamped_heads"]["entries_read"] == 7 and any(x["entry"] == 3 and x["why"] == "HTTP 404" for x in bad["checkpoint"]["skipped"]))
    e5 = {k: v for k, v in W["entries"][5].items() if k != "record_canonical"}
    bad = go(over={lv.LEDGER + "/ledger/5?format=json": (200, json.dumps(e5).encode())})
    t("ledger: an entry served without its record bytes (so a head inside it cannot be read) leaves the night not ok",
      bad["status"] == "ran" and not bad["ok"] and bad["stamped_heads"]["walked"]["complete"] is False
      and any(x["entry"] == 5 and x["why"] == "the entry is not a ledger entry object" for x in bad["checkpoint"]["skipped"]))
    bogus = "0" * 63 + "1"
    rc8 = json.dumps({"schema": lv.CHECKPOINT, "anchored_at": "2026-11-18T00:30:00.000Z",
                      "ledger_head": {"chain": lv.CHAIN, "n": 6, "entry_sha256": bogus, "marker_sha256": lv.marker_line(6, bogus)["entry_sha256"]},
                      "note": "made up"}, separators=(",", ":"))
    P8 = world(fixed={8: rc8})
    bad = go(W=P8, h=hgetter(P8))
    t("ledger: a checkpoint still waiting for Bitcoin whose head the export does not reach is not an ok row",
      bad["status"] == "ran" and bad["checkpoint"]["entry"] == 7 and not bad["ok"]
      and [(d["entry"], d["ots_status"]) for d in bad["stamped_heads"]["disagree"]] == [(8, "pending")])

    def older(k, head=None, marker=None):
        return lambda E: json.dumps({"schema": lv.CHECKPOINT, "anchored_at": "2026-11-14T00:30:00.000Z",
                                     "ledger_head": {"chain": lv.CHAIN, "n": k, "entry_sha256": head or E[min(k, 3)],
                                                     "marker_sha256": marker or lv.marker_line(min(k, 3), E[min(k, 3)])["entry_sha256"]},
                                     "note": "made up"}, separators=(",", ":"))
    X = world(fixed={4: older(4)})
    bad = go(W=X, h=hgetter(X))
    t("ledger: an older checkpoint whose ledger_head is not below its own entry is not an ok row",
      not bad["ok"] and bad["stamped_heads"]["disagree"][0]["entry"] == 4 and "n below 4" in bad["stamped_heads"]["disagree"][0]["why"])
    X = world(fixed={4: older(3, marker=bogus)})
    bad = go(W=X, h=hgetter(X))
    t("ledger: an older checkpoint whose marker_sha256 is not the end marker of its own head is not an ok row",
      not bad["ok"] and bad["stamped_heads"]["disagree"][0]["why"] == "its marker_sha256 is not the end marker of the head it states")

    def batch(lh):
        return lambda E: json.dumps({"schema": lv.WITNESS_BATCH, "anchored_at": "2026-11-14T00:30:00.000Z", "count": 0,
                                     "ledger_head": lh(E), "records": []}, separators=(",", ":"))
    X = world(fixed={4: batch(lambda E: {"chain": lv.CHAIN, "n": 3, "entry_sha256": E[3]})})
    okb = go(W=X, h=hgetter(X))
    t("ledger: a witness batch's head (no marker in it) is held against the export too, and an honest one agrees",
      okb["ok"] and (okb["stamped_heads"]["seen"], okb["stamped_heads"]["agree"], okb["stamped_heads"]["confirmed"]) == (3, 3, 2))
    X = world(fixed={4: batch(lambda E: {"chain": lv.CHAIN, "n": 3, "entry_sha256": bogus})})
    bad = go(W=X, h=hgetter(X))
    t("ledger: a witness batch whose head the export does not reach is not an ok row",
      not bad["ok"] and [(d["entry"], d["kind"], d["covers"]) for d in bad["stamped_heads"]["disagree"]] == [(4, "witness batch", 3)])
    X = world(fixed={4: json.dumps({"schema": lv.WITNESS_BATCH, "anchored_at": "2026-09-05T00:30:00.000Z", "count": 0,
                                    "records": []}, separators=(",", ":"))})
    okb = go(W=X, h=hgetter(X))
    t("ledger: a witness batch from before the chain (no ledger_head in it) is not a head and changes nothing",
      okb["ok"] and okb["stamped_heads"]["seen"] == 2 and okb["stamped_heads"]["disagree"] == [] and okb["stamped_heads"]["said_broken"] == [])
    X = world(fixed={4: batch(lambda E: {"chain": lv.CHAIN, "broken_at": 2, "last_linked": 1})})
    sb = go(W=X, h=hgetter(X))
    t("ledger: a witness batch that says the chain was broken carries no head: it is listed, and the night still holds",
      sb["ok"] and sb["stamped_heads"]["seen"] == 2
      and sb["stamped_heads"]["said_broken"] == [{"entry": 4, "kind": "witness batch", "broken_at": 2, "last_linked": 1, "ots_status": "confirmed"}]
      and "Witness batches that said the chain was broken when they were written: entry 4 (broken at 2)." in "\n".join(lv.to_md(sb)))

    bad = go(over={ck["url"]: (200, w + b"x")})
    t("ledger: a checker wheel that is not the pinned one is not run", bad["status"] == "not_run" and "not the pinned one" in bad["reason"] and bad["grade"] is None)
    bad = go(over={ad["url"]: (200, ADAPTER_BYTES + b" ")})
    t("ledger: an adapter that is not the pinned one is not run", bad["status"] == "not_run" and "adapter is not the pinned one" in bad["reason"])
    bad = go(over={lv.EXPORT_URL: (503, b"")})
    t("ledger: an export answering 503 is not run, with the status", bad["status"] == "not_run" and "HTTP 503" in bad["reason"])
    bad = go(over={lv.EXPORT_URL: lv.NetError("timed out")})
    t("ledger: an export that cannot be reached is not run", bad["status"] == "not_run" and "could not be fetched" in bad["reason"])
    bad = go(over={lv.EXPORT_URL: RuntimeError("a fault")})
    t("ledger: a fault inside the step is written down, never raised into the board",
      bad["status"] == "not_run" and bad["reason"].startswith("the board's ledger step failed: RuntimeError"))

    P = world(checkpoints=((7, 5, "pending"), (8, 6, "pending")))
    bad = go(W=P, h=hgetter(P))
    t("ledger: no checkpoint confirmed yet is not run, and says which ones wait",
      bad["status"] == "not_run" and "no nenrin-head-checkpoint-v1 entry with a confirmed" in bad["reason"]
      and [x["entry"] for x in bad["checkpoint"]["waiting"]] == [8, 7])
    bad = go(look_back=1)
    t("ledger: a confirmed checkpoint beyond the look-back is not used", bad["status"] == "not_run" and bad["checkpoint"]["looked_at"] == 1)
    down = {lv.LEDGER + "/ledger/%d?format=json" % i: lv.NetError("timed out") for i in (8, 7, 6)}
    bad = go(over=down)
    t("ledger: three entries in a row that cannot be fetched end the walk", bad["status"] == "not_run" and bad["checkpoint"]["looked_at"] == 3
      and "the walk stopped here: three entries in a row" in bad["checkpoint"]["skipped"][-1]["why"])

    e7 = dict(W["entries"][7], record_canonical=W["entries"][7]["record_canonical"] + " ")
    bad = go(over={lv.LEDGER + "/ledger/7?format=json": (200, json.dumps(e7).encode())})
    t("ledger: a checkpoint whose bytes do not hash to its claim is skipped, with the reason",
      bad["status"] == "not_run" and any(x["entry"] == 7 and "do not hash" in x["why"] for x in bad["checkpoint"]["skipped"]))
    rc = W["entries"][7]["record_canonical"].replace("made up", "made up again")
    e7 = dict(W["entries"][7], record_canonical=rc, claim_sha256=lv.sha(rc))
    bad = go(over={lv.LEDGER + "/ledger/7?format=json": (200, json.dumps(e7).encode())})
    t("ledger: a checkpoint whose claim the export does not carry at that n is skipped",
      bad["status"] == "not_run" and any(x["entry"] == 7 and "another claim_sha256" in x["why"] for x in bad["checkpoint"]["skipped"]))

    other, _ = proof(W["entries"][6]["claim_sha256"], HEIGHT + 7)
    bad = go(over={lv.LEDGER + "/ledger/7/ots": (200, other)})
    t("ledger: a proof of another claim fails the anchor and the row", bad["status"] == "ran" and not bad["ok"]
      and bad["anchor"]["proof"] == "ots_digest_is_not_the_entry")
    elsewhere, _ = proof(W["entries"][7]["claim_sha256"], HEIGHT + 99)
    bad = go(over={lv.LEDGER + "/ledger/7/ots": (200, elsewhere)})
    t("ledger: a proof at another height than the entry's block fails the anchor", not bad["ok"] and bad["anchor"]["proof"] == "ots_height_is_not_the_entry_block")
    bad = go(over={lv.LEDGER + "/ledger/7/ots": (404, b"{}")})
    t("ledger: no proof served fails the anchor", not bad["ok"] and bad["anchor"]["proof"] == "ots_http_404")
    bad = go(over={lv.LEDGER + "/ledger/7/ots": (200, b"not a proof")})
    t("ledger: bytes that are not a proof fail the anchor", not bad["ok"] and bad["anchor"]["proof"].startswith("ots_parse"))
    bad = go(h=hgetter(W, differ=True))
    t("ledger: two explorers serving different headers fail the anchor", not bad["ok"] and bad["anchor"]["bitcoin_header"] == "explorers_serve_different_headers")
    bad = go(h=hgetter(W, down=True))
    t("ledger: explorers that cannot be reached leave the header not checked, and the row not ok",
      not bad["ok"] and bad["anchor"]["bitcoin_header"].startswith("not checked") and bad["grade"]["grade"] == "structural L1, attested L1")

    B = world(bad_marker=True)
    bad = go(W=B, h=hgetter(B))
    t("ledger: a checkpoint whose marker_sha256 is not the marker of its own head grades L0",
      bad["status"] == "ran" and not bad["ok"] and bad["cut"]["marker_is_the_checkpoint_s"] is False and bad["grade"]["attested_level"] == 0)

    objs = [dict(o) for o in W["objs"]]
    objs[2]["claim_sha256"] = lv.sha("a record put in afterwards")
    R = dict(W, export=export_of(chain(objs)))
    bad = go(W=R)
    t("ledger: an export rewritten under the stamped head, every link re-derived, grades L0",
      bad["status"] == "ran" and not bad["ok"] and bad["grade"]["attested_level"] == 0 and bad["cut"]["entry_n_is_the_checkpoint_s"] is False)
    rows = [dict(x) for x in W["rows"]]
    rows[6]["created_at"] = "2026-11-17T00:00:00.000Z"
    R = dict(W, export=("\n".join(json.dumps(x, separators=(",", ":")) for x in rows + [lv.marker_line(8, W["E"][8])]) + "\n").encode())
    bad = go(W=R)
    t("ledger: a stated link after the graded entries that is not the recomputed one is a problem on the row",
      bad["status"] == "ran" and not bad["ok"] and bad["grade"]["attested_level"] == 1 and "links break at n=7" in bad["export"]["problems"][0])
    R = dict(W, export=W["export"].rsplit(b"\n", 2)[0] + b"\n" + json.dumps(lv.marker_line(7, W["E"][7]), separators=(",", ":")).encode() + b"\n")
    bad = go(W=R)
    t("ledger: an end marker that is not the marker of the export's own last entry is a problem on the row",
      not bad["ok"] and "end marker is not the marker of its own last entry" in bad["export"]["problems"][0])
    R = dict(W, export=W["export"].rsplit(b"\n", 2)[0] + b"\n")
    bad = go(W=R)
    t("ledger: an export that does not end in its end marker is a problem on the row",
      bad["status"] == "ran" and not bad["ok"] and "does not end in a jidec-head-v1" in bad["export"]["problems"][0])

    R = dict(W, export=W["export"].rsplit(b"\n", 2)[0] + b"\n" + b'{"schema":"jidec-chain-broken-v1","broken_at":9,"last_linked":8}\n')
    bad = go(W=R)
    t("ledger: an export ending in jidec-chain-broken-v1 is a problem on the row, even with the prefix graded",
      bad["status"] == "ran" and not bad["ok"] and bad["grade"]["attested_level"] == 1 and "chain-broken" in bad["export"]["problems"][0])
    bad = go(src=ALWAYS_L1 % lv.sha(ADAPTER_BYTES))
    t("ledger: a checker that cannot fail (controls at L1) is not an ok row", bad["status"] == "ran" and bad["controls_ok"] is False and not bad["ok"])
    bad = go(src=BROKEN)
    t("ledger: a checker that gives no verdict (exit 2) is recorded with its error, not ok",
      bad["status"] == "ran" and not bad["ok"] and bad["grade"]["exit"] == 2 and bad["grade"]["error"].startswith("adapter:"))

    e7 = json.loads(W["entries"][7]["record_canonical"])
    e7["ledger_head"]["n"] = 7
    rc = json.dumps(e7, separators=(",", ":"))
    Q = world()
    Q["entries"][7] = dict(Q["entries"][7], record_canonical=rc, claim_sha256=lv.sha(rc))
    Q["objs"][6]["claim_sha256"] = lv.sha(rc)
    Q["rows"] = chain(Q["objs"])
    Q["export"] = export_of(Q["rows"])
    Q["proofs"][7], root = proof(lv.sha(rc), HEIGHT + 7)
    Q["headers"][HEIGHT + 7] = header(root)
    bad = go(W=Q, h=hgetter(Q))
    t("ledger: a checkpoint whose ledger_head is not below its own entry is not run", bad["status"] == "not_run" and "ledger_head is not" in bad["reason"])

    hr = lv.history_row("2026-11-27T18:41:00Z", r)
    t("ledger history: the night keeps export sha256, entries, graded, head compared, grade, checkpoint, block",
      hr["export_sha256"] == r["export"]["sha256"] and hr["entries"] == 8 and hr["graded"] == 5 and hr["head_compared"] == m5
      and hr["grade"] == "structural L1, attested L1" and hr["checkpoint"] == 7 and hr["bitcoin_block"] == HEIGHT + 7 and hr["ok"])
    md = "\n".join(lv.to_md(ok2, [lv.history_row("2026-11-26T18:41:00Z", bad), hr]))
    t("ledger page: tonight's sentence and a table row per night, newest first",
      "entries 1..5 of the 8 in the export" in md and "**structural L1, attested L1**" in md and "Every step held." in md
      and md.index("2026-11-27") < md.index("2026-11-26") and "What the checker says stops L2: VLC-L2-1 adapter declares no production count or ordinal." in md
      and "holds against 1 of the 1 earlier nights that held (it reaches the head each of them compared, and tonight's "
          "checkpoint covers at least the entries each graded)." in md)
    md = "\n".join(lv.to_md(go(over={lv.EXPORT_URL: (503, b"")})))
    t("ledger page: a night not run says why", "Tonight: not run: the export could not be fetched (HTTP 503)" in md)

    wp, ap = os.environ.get("TSUNAGI_VLC_WHEEL"), os.environ.get("TSUNAGI_VLC_ADAPTER")
    if wp and ap:
        rw, ra = open(wp, "rb").read(), open(ap, "rb").read()
        if lv.sha(rw) == lv.CHECKER["sha256"] and lv.sha(ra) == lv.ADAPTER["sha256"]:
            def real_get(url, limit):
                if url == lv.CHECKER["url"]:
                    return 200, rw
                if url == lv.ADAPTER["url"]:
                    return 200, ra
                return getter(W, w, ck, ad)(url, limit)
            rr = lv.run(get=real_get, header_get=hgetter(W))
            t("ledger, the real vlc-check 1.0.0 and its adapter on the made-up ledger: L1/L1, controls L0, every step held",
              rr["ok"] and rr["grade"]["grade"] == "structural L1, attested L1" and rr["grade"]["spec"].startswith("VLC-1"))
        else:
            t("ledger: TSUNAGI_VLC_WHEEL and TSUNAGI_VLC_ADAPTER are the pinned files", False)


if __name__ == "__main__":
    fail = [0]

    def t(name, ok):
        print(("ok   " if ok else "NG   ") + name)
        fail[0] += (not ok)
    run(t)
    print("")
    if fail[0]:
        print("FAIL %d (tsunagi ledger)" % fail[0])
        sys.exit(1)
    print("ALL PASS (tsunagi: the ledger's nightly VLC-1 grade, offline)")
