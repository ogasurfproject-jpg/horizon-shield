"""make_bitcoin_header_vectors.py: writes bitcoin_header_vectors.json, the vectors of `--bitcoin-header` (the step
bitcoin_header after bitcoin_anchor, in furui-day and resume-admission). The Python and JavaScript ports run this file
and must give the same answers; the Go and Java ports take the flag in their next version and do not run it yet.

Each case is a small world (URL -> status and body) with the two block explorers answered by the world, so no case
goes to the network. Two kinds of header:

  - the real header of Bitcoin block 970879 (the block the real OpenTimestamps proof of ledger entry 80 reaches),
    as mempool.space and blockstream.info both served it on 2026-11-03 (the same 160 hex characters from both);
  - made up headers for the worlds of make_verify_vectors.py, whose proofs reach made up merkle roots. They carry the
    easiest bits (0x207fffff, the regtest limit) and a nonce found here, so they meet their own target. That is the
    limit of this step: two explorers that agree on a header are believed (see VERIFY.md).

  python3 -I make_bitcoin_header_vectors.py            write bitcoin_header_vectors.json
  python3 -I make_bitcoin_header_vectors.py --check    exit 1 if the file differs from what this writes
"""
import base64
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_verify_vectors as V  # noqa: E402  (builds its worlds; writes nothing when imported)

F = V.F
MEMPOOL, BLOCKSTREAM = dict(F.EXPLORERS)["mempool"], dict(F.EXPLORERS)["blockstream"]

# Bitcoin block 970879, served identically by https://mempool.space/api and https://blockstream.info/api (2026-11-03)
REAL_HEIGHT = 970879
REAL_HASH = "000000000000000000005f12b1e66ebb0dea2224e0b567ab6a099aeae3fd93ba"
REAL_HEADER = ("00800720002e1e8349f30619e0943ce4f2799eecdb7e25827c7501000000000000000000c92208175f1ab27970ece295fc9a03a1"
               "6cd9bbcbe9963afbfb4d10bd5fa821b38827cb6af01e0217eed722b8")
REAL_MERKLE = "b321a85fbd104dfbfb3a96e9cbbbd96ca1039afc95e2ec7079b21a5f170822c9"
assert F.sha256d(bytes.fromhex(REAL_HEADER))[::-1].hex() == REAL_HASH
assert bytes.fromhex(REAL_HEADER)[36:68][::-1].hex() == REAL_MERKLE


def block_hash(hx):
    return F.sha256d(bytes.fromhex(hx))[::-1].hex()


def with_field(hx, merkle=None, bits=None, nonce=None):
    """the header hex with its merkle root (block explorer order), bits or nonce replaced"""
    b = bytearray(bytes.fromhex(hx))
    if merkle is not None:
        b[36:68] = bytes.fromhex(merkle)[::-1]
    if bits is not None:
        b[72:76] = bits.to_bytes(4, "little")
    if nonce is not None:
        b[76:80] = nonce.to_bytes(4, "little")
    return bytes(b).hex()


def made_up_header(merkle, salt):
    """version 0x20000000, prev sha256(salt), the merkle root, a fixed time, bits 0x207fffff, the first nonce that meets it"""
    b = (0x20000000).to_bytes(4, "little") + hashlib.sha256(salt.encode()).digest() + bytes.fromhex(merkle)[::-1]
    b += (1793000000).to_bytes(4, "little") + (0x207FFFFF).to_bytes(4, "little")
    t = F.bits_target(0x207FFFFF)
    for nonce in range(1 << 20):
        hx = (b + nonce.to_bytes(4, "little")).hex()
        if int(block_hash(hx), 16) <= t:
            return hx
    raise SystemExit("no nonce")


def text(s, status=200):
    return {"status": status, "body": s}


def explorers(height, hx, mempool=None, blockstream=None):
    """both explorers name block_hash(hx) at height and serve hx; mempool/blockstream: (hash, header) to serve instead"""
    w = {}
    for base, over in ((MEMPOOL, mempool), (BLOCKSTREAM, blockstream)):
        bh, hd = over if over else (block_hash(hx), hx)
        w[base + "/block-height/%d" % height] = text(bh)
        w[base + "/block/%s/header" % bh] = text(hd)
    return w


cases = []


def add(name, command, args, world, want_state, want_step=None, want_code=None, note=""):
    c = {"name": name, "note": note, "command": command, "args": args, "world": world}
    got = F.case_answer(c)
    if command == "bitcoin-header":
        assert got["state"] == want_state and got["code"] == want_code, (name, got)
    elif want_state == "ok":
        assert got["verdict"] == "ok", (name, got)
    else:
        bad = [s for s in got["steps"] if s[1] in ("fail", "not_yet")]
        assert got["verdict"] == want_state and bad and bad[0][0] == want_step and bad[0][2] == want_code, (name, got)
    c["expect"] = got
    cases.append(c)


BH = "bitcoin-header"
RA = {"height": REAL_HEIGHT, "merkle_root": REAL_MERKLE}
RW = explorers(REAL_HEIGHT, REAL_HEADER)
# ---- the step alone, on the real block ----
add("header ok: block 970879, the block the real proof of ledger entry 80 reaches", BH, RA, RW, "ok")
add("header fail: the proof's merkle root is not the header's", BH, dict(RA, merkle_root=V.h("another root")), RW, "fail", None, "header_merkle_root_is_not_the_proof")
flip = with_field(REAL_HEADER, nonce=0x01020304)
add("header fail: blockstream serves another header under the same hash", BH, RA, explorers(REAL_HEIGHT, REAL_HEADER, blockstream=(REAL_HASH, flip)), "fail", None, "explorers_serve_different_headers")
other = with_field(REAL_HEADER, merkle=V.h("other block"))
add("header fail: blockstream names another block at the height", BH, RA, explorers(REAL_HEIGHT, REAL_HEADER, blockstream=(block_hash(other), other)), "fail", None, "explorers_name_different_blocks")
w = dict(RW)
del w[MEMPOOL + "/block-height/%d" % REAL_HEIGHT]
add("header fail: mempool does not know the height (404)", BH, RA, w, "fail", None, "mempool_height_http_404")
add("header fail: blockstream answers 503 for the header", BH, RA, dict(RW, **{BLOCKSTREAM + "/block/%s/header" % REAL_HASH: text("", 503)}), "fail", None, "blockstream_header_http_503")
add("header fail: mempool's hash ends with a newline", BH, RA, dict(RW, **{MEMPOOL + "/block-height/%d" % REAL_HEIGHT: text(REAL_HASH + "\n")}), "fail", None, "mempool_hash_shape")
add("header fail: blockstream's header in upper case", BH, RA, dict(RW, **{BLOCKSTREAM + "/block/%s/header" % REAL_HASH: text(REAL_HEADER.upper())}), "fail", None, "blockstream_header_shape")
add("header fail: mempool's header is one byte short", BH, RA, dict(RW, **{MEMPOOL + "/block/%s/header" % REAL_HASH: text(REAL_HEADER[:-2])}), "fail", None, "mempool_header_shape")
add("header fail: mempool's hash is not ASCII", BH, RA, dict(RW, **{MEMPOOL + "/block-height/%d" % REAL_HEIGHT: {"status": 200, "body_b64": base64.b64encode(b"\xff" * 64).decode()}}), "fail", None, "mempool_hash_shape")
fake = with_field(REAL_HEADER, merkle=V.h("fake root"))
add("header fail: both serve a changed header under the real hash", BH, RA,
    explorers(REAL_HEIGHT, REAL_HEADER, mempool=(REAL_HASH, fake), blockstream=(REAL_HASH, fake)), "fail", None, "header_hash_is_not_the_named_block")
fake = with_field(REAL_HEADER, merkle=REAL_MERKLE, nonce=7)
add("header fail: both agree on a header with the proof's root and the block's bits, but without the work", BH, RA, explorers(REAL_HEIGHT, fake), "fail", None, "header_hash_above_its_target")
fake = with_field(REAL_HEADER, bits=0x1D80FFFF)
add("header fail: both agree on a header whose bits are negative", BH, RA, explorers(REAL_HEIGHT, fake), "fail", None, "header_bits_shape")
fake = with_field(REAL_HEADER, bits=0x21000001)
add("header fail: both agree on a header whose bits are wider than 256 bits", BH, RA, explorers(REAL_HEIGHT, fake), "fail", None, "header_bits_shape")

# ---- furui-day --bitcoin-header (worlds of make_verify_vectors.py, made up headers) ----
D = V.D
DB = {"day": D, "bitcoin_header": True}
w, rs, e = V.day_world(entry=330)
plain = F.furui_day(D, 1, F.world_get(w))
mr = plain["facts"]["merkle_root"]
hx = made_up_header(mr, "day 330")
wh = dict(w, **explorers(971234, hx))
add("day ok with --bitcoin-header: seven steps, the header holds the proof's merkle root", "furui-day", dict(DB, leaf=1), wh, "ok")
add("day ok with --bitcoin-header: leaf 0 of the same day", "furui-day", dict(DB, leaf=0), wh, "ok")
hx2 = made_up_header(V.h("not the proof"), "day 330 other")
add("day fail 7: both explorers serve a header with another merkle root", "furui-day", dict(DB, leaf=1), dict(w, **explorers(971234, hx2)), "fail", 7, "header_merkle_root_is_not_the_proof")
add("day fail 7: the explorers are not in the world (mempool 404)", "furui-day", dict(DB, leaf=1), w, "fail", 7, "mempool_height_http_404")
add("day fail 7: blockstream names another block", "furui-day", dict(DB, leaf=1), dict(w, **explorers(971234, hx, blockstream=(block_hash(hx2), hx2))), "fail", 7, "explorers_name_different_blocks")
wp, _, _ = V.day_world(entry=331, ots_status="pending")
add("day not_yet 6 with --bitcoin-header: the proof is not in Bitcoin yet, step 7 skipped", "furui-day", dict(DB, leaf=1), dict(wp, **explorers(971234, hx)), "not_yet", 6, "ots_not_confirmed")
L1 = V.FURUI + "/furui/day/%s/leaf/1" % D
add("day fail 3 with --bitcoin-header: steps 4 to 7 skipped", "furui-day", dict(DB, leaf=1), V.edit(dict(wh), L1, lambda o: o.__setitem__("proof", o["proof"][:-1])), "fail", 3, "proof_does_not_rebuild_the_root")

# ---- resume-admission --bitcoin-header ----
w, rs, ep = V.resume_world(entry=290)
plain = F.resume_admission(ep, rs, F.world_get(w))
hr = made_up_header(plain["facts"]["merkle_root"], "resume 290")
RB = {"endpoint": ep, "record_sha256": rs, "bitcoin_header": True}
add("resume ok with --bitcoin-header: six steps", "resume-admission", RB, dict(w, **explorers(971111, hr)), "ok")
add("resume fail 6: the explorers serve different headers", "resume-admission", RB,
    dict(w, **explorers(971111, hr, blockstream=(block_hash(hr), with_field(hr, nonce=0xDEADBEEF)))), "fail", 6, "explorers_serve_different_headers")
w2, rs2, ep2 = V.resume_world(entry=291, ots_height=971112)
add("resume fail 5 with --bitcoin-header: the proof reaches another height, step 6 skipped", "resume-admission",
    {"endpoint": ep2, "record_sha256": rs2, "bitcoin_header": True}, dict(w2, **explorers(971111, hr)), "fail", 5, "ots_height_is_not_the_entry_block")

doc = {"schema": "nenrin-furui-verify-vectors-v1",
       "about": "Vectors of nenrin-verify --bitcoin-header (furui-day step 7, resume-admission step 6, and the step alone as command bitcoin-header). "
                "Python and JavaScript run this file and must give the same expect; the Go and Java ports take the flag in their next version. "
                "The explorers are answered by each world. The real header of block 970879 is as mempool.space and blockstream.info served it on 2026-11-03; "
                "the other headers are made up, with the easiest bits.",
       "summary_form": "bitcoin-header: expect = {state, code, facts}; furui-day and resume-admission: as in verify_vectors.json, with one more step",
       "cases": cases}
out_text = json.dumps(doc, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
out = os.path.join(HERE, "bitcoin_header_vectors.json")
if sys.argv[1:] == ["--check"]:
    same = os.path.exists(out) and open(out, encoding="utf-8").read() == out_text
    print("bitcoin_header_vectors.json %s (%d cases)" % ("is what this writes" if same else "DIFFERS from what this writes", len(cases)))
    sys.exit(0 if same else 1)
with open(out, "w", encoding="utf-8") as f:
    f.write(out_text)
print("wrote bitcoin_header_vectors.json, %d cases, sha256 %s" % (len(cases), hashlib.sha256(out_text.encode()).hexdigest()))
