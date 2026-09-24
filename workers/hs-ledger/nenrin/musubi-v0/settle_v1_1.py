#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MUSUBI settle v1.1: fork-aware, proof-checked settlement (a2a-settlement-v1.1).

Why this file exists. After settle v1 closed the replica ordering race, the same red team
(@quaxworld.art, Bluesky, 2026-09-24) asked: let two replicas accept different anchor histories
before finality, then reorg one after settlement. If authority is (height, sha), can both emit valid
but incompatible receipts, and what proves convergence afterward?

For v1 the honest answer was yes, and working the question through exposed two more holes of the
same family, closed here before anyone had to ask:
  a. v1 trusted whatever chain view it was handed. A fabricated view could order anything.
  b. v1 trusted the height a record CLAIMED. An approval could be backdated below the action it
     covers and hide a deviation.

What v1.1 does, on top of v1 (settle_v1.py is untouched and still does ordering, ties, revocation):

  1. The chain view is raw Bitcoin block headers (80 bytes each), verified here, not trusted:
     prev-hash linkage, double-SHA256 proof of work against each header's own nBits, a difficulty
     floor named in the signed grant (grant.finality.max_target_bits), and the contract's own
     checkpoint (contract.lower_bound: height + hash) must be in the view. A view that fails any of
     these yields no verdict.
  2. Fork choice is cumulative work, computed from the headers (compare_views). Two views that do not
     share the contract's checkpoint are not comparable. Equal work is a tie, and a tie picks nothing.
  3. Every anchor carries a proof: a list of append / prepend / sha256 operations (the OpenTimestamps
     model) that takes sha256(canonical(record without "anchor")) to the merkle root serialized in
     the header at the claimed height. A record that claims a height without committing to that
     block cannot be ordered there. Backdating needs a proof into an old block, which needs the old
     block's merkle root, which needs the work.
  4. Anchors carry the block hash. A record whose (height, block_hash) is not on the view is
     orphaned: listed by sha, excluded, never silently dropped.
  5. The grant names a finality depth (grant.finality.depth >= 1). With tip T and depth k the horizon
     is T - k + 1. "final" only if every bound record, on chain or orphaned, is at or below the
     horizon; otherwise "provisional", bond "pending_finality".
  6. Every settlement pins the block hash at each height it used, the horizon, the tip, the view's
     cumulative work and the rules it was verified under. check_settlement(settlement, view)
     re-verifies any later view under those same rules and marks the settlement "superseded" when
     the pins disagree. Superseded receipts are kept, never deleted.
  7. A revocation counts only when revoked_by is the principal; others are listed and ignored.

Stated limits (also written into every settlement): the view is verified for linkage, work, the
difficulty floor and the checkpoint, not for the full consensus rules (retarget schedule, timestamps,
transaction validity). "Heaviest" means heaviest among the views compared, not a claim about every
chain in existence. A reorg deeper than the finality depth can supersede a final settlement; that is
exposed by check_settlement, not denied. Record signatures are verified elsewhere (contract_v0 and the
record verifiers); this function orders and compares.
"""
import argparse, hashlib, json, os, random, re, struct, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import settle_v1 as v1
from contract_v0 import canonical, parse_strict

SETTLE_SCHEMA = "a2a-settlement-v1.1"
HEX64 = re.compile(r"^[0-9a-f]{64}$")
HEXOPS = re.compile(r"^(?:[0-9a-f]{2})*$")
MAX_PROOF_OPS = 512
MAX_OPERAND = 4096


# --------------------------------------------------------------------------- bitcoin headers
def sha256d(b):
    return hashlib.sha256(hashlib.sha256(b).digest()).digest()


def header_hash(raw):
    return sha256d(raw)[::-1].hex()


def bits_to_target(bits):
    exp, mant = bits >> 24, bits & 0x007fffff
    if bits & 0x00800000 or mant == 0:
        return None                                # negative or zero targets are not valid
    return mant * (1 << (8 * (exp - 3))) if exp >= 3 else mant >> (8 * (3 - exp))


def header_fields(raw):
    return {"prev": raw[4:36][::-1].hex(), "merkle": raw[36:68], "bits": struct.unpack("<I", raw[72:76])[0]}


def _floor_target(grant):
    fin = grant.get("finality") if isinstance(grant.get("finality"), dict) else {}
    s = fin.get("max_target_bits")
    if not (isinstance(s, str) and re.match(r"^[0-9a-f]{8}$", s)):
        return None, s
    return bits_to_target(int(s, 16)), s


def verify_view(view, contract):
    """Verify a header view under the contract's rules. Returns (result, problem). result carries
    tip, hashes {height: hash}, merkle {height: bytes}, work (int)."""
    grant = contract.get("grant") or {}
    floor, floor_s = _floor_target(grant)
    if floor is None:
        return None, "grant.finality.max_target_bits missing or not 8 lowercase hex (compact nBits)"
    lb = contract.get("lower_bound")
    if not (isinstance(lb, dict) and isinstance(lb.get("height"), int) and not isinstance(lb.get("height"), bool)
            and isinstance(lb.get("hash"), str) and HEX64.match(lb["hash"])):
        return None, "contract.lower_bound (checkpoint height + hash) missing"
    if not isinstance(view, dict) or not isinstance(view.get("headers"), list) or not view["headers"]:
        return None, "view must be {\"headers\": [{\"height\": h, \"hex\": 160 hex}, ...]}"
    hashes, merkle, work, prev_hash, prev_h = {}, {}, 0, None, None
    for i, item in enumerate(view["headers"]):
        if not isinstance(item, dict):
            return None, "header %d is not an object" % i
        h, hx = item.get("height"), item.get("hex")
        if isinstance(h, bool) or not isinstance(h, int) or h < 0:
            return None, "header %d height invalid" % i
        if not (isinstance(hx, str) and re.match(r"^[0-9a-f]{160}$", hx)):
            return None, "header at %d is not 80 bytes of lowercase hex" % h
        raw = bytes.fromhex(hx)
        f = header_fields(raw)
        hh = header_hash(raw)
        if prev_h is not None:
            if h != prev_h + 1:
                return None, "heights not contiguous at %d" % h
            if f["prev"] != prev_hash:
                return None, "linkage broken at %d" % h
        t = bits_to_target(f["bits"])
        if t is None:
            return None, "invalid nBits at %d" % h
        if t > floor:
            return None, "difficulty at %d is easier than the grant's floor %s" % (h, floor_s)
        if int(hh, 16) > t:
            return None, "proof of work fails at %d" % h
        hashes[h], merkle[h] = hh, f["merkle"]
        work += (1 << 256) // (t + 1)
        prev_hash, prev_h = hh, h
    if hashes.get(lb["height"]) != lb["hash"]:
        return None, "contract checkpoint %d not in view with the signed hash" % lb["height"]
    return {"tip": prev_h, "hashes": hashes, "merkle": merkle, "work": work,
            "checkpoint": {"height": lb["height"], "hash": lb["hash"]}, "max_target_bits": floor_s}, None


def compare_views(views, contract):
    """Pick the heaviest verified view. Returns {"chosen": index or None, "work": [...], "why": ...}."""
    res = []
    for v in views:
        r, p = verify_view(v, contract)
        res.append((r, p))
    works = [r["work"] if r else None for r, p in res]
    valid = [i for i, w in enumerate(works) if w is not None]
    if not valid:
        return {"chosen": None, "work": works, "why": "no view verified", "problems": [p for r, p in res]}
    best = max(works[i] for i in valid)
    top = [i for i in valid if works[i] == best]
    if len(top) > 1:
        return {"chosen": None, "work": works, "why": "tie in cumulative work; wait for the next block"}
    return {"chosen": top[0], "work": works, "why": "most cumulative work among verified views"}


# --------------------------------------------------------------------------- anchor proofs
def commitment_digest(ev):
    r = {k: v for k, v in ev.items() if k != "anchor"}
    return hashlib.sha256(canonical(r).encode("utf-8")).digest()


def run_proof(digest, ops):
    if not isinstance(ops, list) or not ops or len(ops) > MAX_PROOF_OPS:
        return None
    cur = digest
    for op in ops:
        if not isinstance(op, dict):
            return None
        kind = op.get("op")
        if kind == "sha256":
            cur = hashlib.sha256(cur).digest()
        elif kind in ("append", "prepend"):
            hx = op.get("hex")
            if not (isinstance(hx, str) and HEXOPS.match(hx)) or len(hx) // 2 > MAX_OPERAND:
                return None
            b = bytes.fromhex(hx)
            cur = cur + b if kind == "append" else b + cur
        else:
            return None
        if len(cur) > 65536:
            return None
    return cur


# --------------------------------------------------------------------------- settle
def settle_v1_1(contract, events, view):
    grant = contract.get("grant") or {}
    fin = grant.get("finality") if isinstance(grant.get("finality"), dict) else {}
    depth = fin.get("depth")
    under = []
    if isinstance(depth, bool) or not isinstance(depth, int) or depth < 1:
        under.append({"reason": "finality_policy_missing", "detail": "grant.finality.depth must be an integer >= 1"})
        depth = None
    cv, problem = verify_view(view, contract)
    if cv is None:
        under.append({"reason": "chain_view_rejected", "detail": problem})

    on_chain, orphaned, predates, ignored, seen = [], [], [], [], set()
    for ev in v1.bind(contract, events):
        s = v1.rec_sha(ev)
        if s in seen:
            continue
        seen.add(s)
        if ev.get("schema") == v1.REVOKE_SCHEMA and ev.get("revoked_by") != "principal":
            ignored.append({"sha256": s, "reason": "revocation_by_non_principal", "revoked_by": ev.get("revoked_by")})
            continue
        a = ev.get("anchor") if isinstance(ev.get("anchor"), dict) else {}
        h = v1.height_of(ev)
        bh = a.get("block_hash") if isinstance(a.get("block_hash"), str) and HEX64.match(a.get("block_hash")) else None
        if h is None:
            on_chain.append(ev)                     # v1 reports unanchored_event
            continue
        if bh is None:
            under.append({"reason": "anchor_without_block_hash", "sha256": s, "height": h})
            continue
        if cv is None:
            continue
        if h > cv["tip"] or h not in cv["hashes"]:
            if h < min(cv["hashes"]):
                pass                                # handled by predates below when under the checkpoint
            else:
                under.append({"reason": "anchor_beyond_observed_chain", "sha256": s, "height": h})
                continue
        if h < cv["checkpoint"]["height"]:
            predates.append({"sha256": s, "height": h, "reason": "anchored before the contract checkpoint"})
            continue
        if cv["hashes"][h] != bh:
            orphaned.append({"sha256": s, "height": h, "block_hash": bh, "view_hash_at_height": cv["hashes"][h]})
            continue
        if "proof" not in a:
            under.append({"reason": "anchor_without_proof", "sha256": s, "height": h})
            continue
        if run_proof(commitment_digest(ev), a.get("proof")) != cv["merkle"][h]:
            under.append({"reason": "anchor_proof_invalid", "sha256": s, "height": h,
                          "detail": "proof does not reach the merkle root of the block at the claimed height"})
            continue
        on_chain.append(ev)

    base = v1.settle_v1(contract, on_chain)
    underspecified = sorted(base["underspecified"] + under, key=canonical)
    verdict = "underspecified" if underspecified else base["verdict"]

    pinned, horizon, tip_pin, status, rules, work = [], None, None, "undetermined", None, None
    if cv is not None:
        used = sorted({e["height"] for e in base["authoritative_event_set"]})
        pinned = [{"height": h, "block_hash": cv["hashes"][h]} for h in used]
        tip_pin = {"height": cv["tip"], "block_hash": cv["hashes"][cv["tip"]]}
        rules = {"checkpoint": cv["checkpoint"], "max_target_bits": cv["max_target_bits"]}
        work = format(cv["work"], "x")
        if depth is not None:
            f = cv["tip"] - depth + 1
            horizon = {"height": f, "block_hash": cv["hashes"].get(f)}
            if verdict != "underspecified":
                heights = used + [o["height"] for o in orphaned]
                status = "final" if all(h <= f for h in heights) else "provisional"

    bond = contract.get("bond")
    if not (isinstance(bond, dict) and bond.get("amount")):
        bond_outcome = "n/a"
    elif verdict == "underspecified":
        bond_outcome = "undetermined"
    elif status == "provisional":
        bond_outcome = "pending_finality"
    else:
        bond_outcome = "held" if verdict == "within_grant" else "forfeited"

    return {
        "schema": SETTLE_SCHEMA,
        "settled_under": v1.SETTLE_SCHEMA,
        "contract_id": contract.get("contract_id"),
        "a2a_task_id": (contract.get("task") or {}).get("a2a_task_id"),
        "ordering_rule": v1.ORDERING_RULE,
        "same_height_policy": base["same_height_policy"],
        "view_rules": rules,
        "view_work_hex": work,
        "finality_depth": depth,
        "status": status,
        "chain_tip": tip_pin,
        "finality_horizon": horizon,
        "pinned_blocks": pinned,
        "orphaned": sorted(orphaned, key=lambda o: (o["height"], o["sha256"])),
        "predates_contract": sorted(predates, key=lambda o: (o["height"], o["sha256"])),
        "ignored": sorted(ignored, key=lambda o: o["sha256"]),
        "authoritative_event_set": base["authoritative_event_set"],
        "ties": base["ties"],
        "revocations": base["revocations"],
        "verdict": verdict,
        "underspecified": underspecified,
        "deviations": base["deviations"] if verdict != "underspecified" else [],
        "bond_outcome": bond_outcome,
        "establishes": [
            "that on the header view pinned here, verified for linkage, proof of work, the grant's difficulty floor and "
            "the contract checkpoint, the proof-checked records %s the grant" % (
                "stay within" if verdict == "within_grant" else
                "deviate from" if verdict == "deviation" else "cannot be settled without the listed terms, so no verdict is rendered on"),
            "that this settlement is %s under the grant's finality depth" % status,
        ],
        "does_not_establish": [
            "that the view is the heaviest chain in existence; only that it verified and, if compared, outweighed the others",
            "full Bitcoin consensus validity (retarget schedule, timestamps, transactions); only linkage, work, floor, checkpoint",
            "that no reorg deeper than the finality depth will happen; if one does, check_settlement marks this superseded",
            "that records not yet visible to this settler will not appear later",
            "that each record is signed by the party it names; verify signatures before settling",
            "that HS judged this; the verdict is recomputable by anyone from the same bytes and headers",
        ],
        "signatures": [],
    }


def check_settlement(settlement, view, contract):
    cv, problem = verify_view(view, contract)
    if cv is None:
        return {"status": "unknown", "why": "view rejected: %s" % problem}
    rules = settlement.get("view_rules") or {}
    if rules.get("checkpoint") != cv["checkpoint"] or rules.get("max_target_bits") != cv["max_target_bits"]:
        return {"status": "unknown", "why": "settlement was made under different view rules"}
    pins = list(settlement.get("pinned_blocks") or [])
    for extra in (settlement.get("finality_horizon"), settlement.get("chain_tip")):
        if isinstance(extra, dict) and extra.get("block_hash"):
            pins.append(extra)
    mismatches, unseen = [], []
    for p in pins:
        h, bh = p.get("height"), p.get("block_hash")
        if h not in cv["hashes"]:
            unseen.append(h)
        elif cv["hashes"][h] != bh:
            mismatches.append({"height": h, "pinned": bh, "view": cv["hashes"][h]})
    if mismatches:
        return {"status": "superseded", "mismatches": sorted(mismatches, key=lambda m: m["height"]),
                "note": "kept, not deleted; recompute on this view for the settlement that replaces it"}
    if unseen:
        return {"status": "unknown", "why": "view lacks pinned heights", "heights": sorted(set(unseen))}
    return {"status": "consistent"}


# --------------------------------------------------------------------------- self test fixtures
REGTEST_BITS = 0x207fffff
GENESIS_HEX = ("0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27a"
               "c72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c")
GENESIS_HASH = "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f"


def _mine(prev_hash, merkle, bits=REGTEST_BITS, t=1700000000, salt=0):
    t0 = bits_to_target(bits)
    nonce = salt * 1000003
    while True:
        raw = (struct.pack("<I", 0x20000000) + bytes.fromhex(prev_hash)[::-1] + merkle +
               struct.pack("<III", t, bits, nonce & 0xffffffff))
        if int(header_hash(raw), 16) <= t0:
            return raw
        nonce += 1


def _tree(digests):
    """Merkle tree over commitment digests, node = sha256(sha256(left || right)). Returns root and proofs."""
    level = [d for d in digests]
    proofs = [[] for _ in digests]
    pos = list(range(len(digests)))
    while len(level) > 1:
        if len(level) % 2:
            level.append(level[-1])
        nxt = [sha256d(level[i] + level[i + 1]) for i in range(0, len(level), 2)]
        for leaf, p in enumerate(pos):
            sib = level[p ^ 1]
            side = "append" if p % 2 == 0 else "prepend"
            proofs[leaf] += [{"op": side, "hex": sib.hex()}, {"op": "sha256"}, {"op": "sha256"}]
            pos[leaf] = p // 2
        level = nxt
    if not proofs[0]:                                  # a single leaf still has to be committed by hashing
        root = sha256d(level[0])
        return root, [[{"op": "sha256"}, {"op": "sha256"}]]
    return level[0], proofs


class _Chain:
    """Builds a regtest-difficulty header chain from a start hash, placing records into blocks with real proofs."""
    def __init__(self, start_height, start_prev, label):
        self.h0, self.prev, self.label = start_height, start_prev, label
        self.headers, self.hashes = [], {}

    def block(self, records=()):
        h = self.h0 + len(self.headers)
        if records:
            root, proofs = _tree([commitment_digest(r) for r in records])
        else:
            root, proofs = hashlib.sha256(("%s-%d" % (self.label, h)).encode()).digest(), []
        raw = _mine(self.prev, root, salt=h * 7 + len(self.label))
        hh = header_hash(raw)
        self.headers.append({"height": h, "hex": raw.hex()})
        self.hashes[h] = hh
        self.prev = hh
        out = []
        for r, p in zip(records, proofs):
            r = json.loads(json.dumps(r))
            r["anchor"] = {"height": h, "block_hash": hh, "proof": p}
            out.append(r)
        return out

    def fork(self, at_height, label):
        c = _Chain(self.h0, None, label)
        c.headers = [x for x in self.headers if x["height"] < at_height]
        c.hashes = {k: v for k, v in self.hashes.items() if k < at_height}
        c.prev = c.hashes[at_height - 1]
        return c

    def view(self):
        return {"headers": list(self.headers)}


def _selftest():
    cid = "0123456789abcdef0123456789abcdef"
    n = 0

    # [1] the header verifier is real: Bitcoin mainnet genesis hashes and meets its own nBits
    g = bytes.fromhex(GENESIS_HEX)
    assert header_hash(g) == GENESIS_HASH and int(GENESIS_HASH, 16) <= bits_to_target(header_fields(g)["bits"])
    n += 1; print("[1] mainnet genesis header: hash %s..., proof of work valid under nBits 1d00ffff" % GENESIS_HASH[:16])

    # common history 95..100, checkpoint at 97
    base = _Chain(95, "00" * 32, "common")
    for _ in range(3):
        base.block()
    ck = {"kind": "bitcoin_block", "height": 97, "hash": base.hashes[97]}

    def contract(depth=3, floor="207fffff", lb=ck):
        c = v1._c(revocation={"effective_at": "anchor"})
        c["grant"]["finality"] = {k: v for k, v in (("depth", depth), ("max_target_bits", floor)) if v is not None}
        if lb is not None:
            c["lower_bound"] = lb
        return c

    c = contract()
    (rv,) = base.block([v1._rv(cid, 0)])          # height 98: revocation, on common history
    base.block(); base.block()                     # 99, 100
    fa, fb = base.fork(101, "A"), base.fork(101, "B")
    (ex,) = fa.block([v1._ex(cid, ["read"], 0)])   # 101 on fork A only: action after revocation
    fa.block()                                      # 102
    fb.block(); fb.block()                          # 101, 102 on fork B
    evs = [rv, ex]

    # [2] two forks, two valid but incompatible settlements, both provisional
    sa, sb = settle_v1_1(c, evs, fa.view()), settle_v1_1(c, evs, fb.view())
    assert sa["verdict"] == "deviation" and sb["verdict"] == "within_grant", (sa["underspecified"], sb["underspecified"])
    assert sa["status"] == sb["status"] == "provisional" and sb["orphaned"][0]["height"] == 101
    assert sa["bond_outcome"] == sb["bond_outcome"] == "pending_finality"
    n += 1; print("[2] fork A: deviation, fork B: within_grant; both provisional, bonds pending, B lists the record as orphaned")

    # [3] fork choice by work: A grows, compare_views picks A; recompute is final; B's receipt superseded
    for _ in range(4):
        fa.block()                                  # 103..106
    cmp = compare_views([fb.view(), fa.view()], c)
    assert cmp["chosen"] == 1, cmp
    sf = settle_v1_1(c, evs, fa.view())
    assert sf["status"] == "final" and sf["verdict"] == "deviation" and sf["bond_outcome"] == "forfeited", sf
    cb, ca = check_settlement(sb, fa.view(), c), check_settlement(sa, fa.view(), c)
    assert cb["status"] == "superseded" and ca["status"] == "consistent", (cb, ca)
    n += 1; print("[3] compare_views picks fork A by cumulative work; recompute final, bond forfeited; B superseded, A consistent")

    # [4] convergence: any order, duplicates, same verified view: identical bytes
    ref = canonical(sf)
    rng = random.Random(113)
    for _ in range(50):
        sh = evs + [dict(ex)]; rng.shuffle(sh)
        assert canonical(settle_v1_1(c, sh, fa.view())) == ref
    n += 1; print("[4] convergence: 50 shuffles with duplicates, settlement bytes identical")

    # [5] reorg deeper than the depth, heavier: a final settlement is exposed, not hidden
    deep = base.fork(99, "D")
    for _ in range(10):
        deep.block()
    assert compare_views([fa.view(), deep.view()], c)["chosen"] == 1
    cd = check_settlement(sf, deep.view(), c)
    assert cd["status"] == "superseded", cd
    n += 1; print("[5] heavier reorg from 99 (deeper than depth 3): final settlement marked superseded at %s"
                  % [m["height"] for m in cd["mismatches"]])

    # [6] fabricated views are rejected: broken linkage, failed work, easier than the floor, wrong checkpoint
    v = fa.view(); bad = json.loads(json.dumps(v))
    raw = bytearray.fromhex(bad["headers"][6]["hex"]); raw[4] ^= 1; bad["headers"][6]["hex"] = raw.hex()
    assert "linkage" in (settle_v1_1(c, evs, bad)["underspecified"][0]["detail"] or "") or \
           "proof of work" in settle_v1_1(c, evs, bad)["underspecified"][0]["detail"]
    hard = contract(floor="1d00ffff")
    r = settle_v1_1(hard, evs, fa.view())
    assert r["verdict"] == "underspecified" and "easier than the grant's floor" in r["underspecified"][0]["detail"], r
    other = contract(lb={"kind": "bitcoin_block", "height": 97, "hash": "ab" * 32})
    r = settle_v1_1(other, evs, fa.view())
    assert r["verdict"] == "underspecified" and "checkpoint" in r["underspecified"][0]["detail"], r
    forged = json.loads(json.dumps(v))
    raw = bytearray.fromhex(forged["headers"][-1]["hex"])
    for nonce in range(1, 1 << 20):              # find a nonce whose hash FAILS regtest work
        raw[76:80] = struct.pack("<I", nonce)
        if int(header_hash(bytes(raw)), 16) > bits_to_target(REGTEST_BITS):
            break
    forged["headers"][-1]["hex"] = raw.hex()
    r = settle_v1_1(c, evs, forged)
    assert r["verdict"] == "underspecified" and "proof of work" in r["underspecified"][0]["detail"], r
    n += 1; print("[6] fabricated views rejected: tampered prev hash, failed work, easier than the floor, wrong checkpoint")

    # [7] backdating: an approval claiming an old height without committing to that block is refused
    c7 = contract()
    b7 = _Chain(95, "00" * 32, "common"); [b7.block() for _ in range(3)]
    c7["lower_bound"] = {"kind": "bitcoin_block", "height": 97, "hash": b7.hashes[97]}
    b7.block()                                                 # 98 empty
    (act,) = b7.block([v1._ex(cid, ["write"], 0, ref="1")])    # 99: conditional action, no approval yet
    (appr,) = b7.block([v1._ex(cid, ["read"], 0, approvals=["write"], ref="2")])   # 100: approval, honest
    for _ in range(4):
        b7.block()
    honest = settle_v1_1(c7, [act, appr], b7.view())
    assert honest["verdict"] == "deviation", honest               # approval after the action: deviation
    forged_appr = json.loads(json.dumps(appr))
    forged_appr["anchor"] = {"height": 98, "block_hash": b7.hashes[98], "proof": appr["anchor"]["proof"]}
    r = settle_v1_1(c7, [act, forged_appr], b7.view())
    assert r["verdict"] == "underspecified" and r["underspecified"][0]["reason"] == "anchor_proof_invalid", r
    assert r["deviations"] == []
    n += 1; print("[7] backdating: approval re-labelled to height 98 without a proof into block 98: anchor_proof_invalid, no verdict")

    # [8] missing proof, missing block hash, missing depth, missing floor: no verdict
    e8 = json.loads(json.dumps(ex)); del e8["anchor"]["proof"]
    assert settle_v1_1(c, [rv, e8], fa.view())["underspecified"][0]["reason"] == "anchor_without_proof"
    e9 = json.loads(json.dumps(ex)); del e9["anchor"]["block_hash"]
    assert settle_v1_1(c, [rv, e9], fa.view())["underspecified"][0]["reason"] == "anchor_without_block_hash"
    assert settle_v1_1(contract(depth=None), evs, fa.view())["underspecified"][0]["reason"] == "finality_policy_missing"
    assert settle_v1_1(contract(floor=None), evs, fa.view())["underspecified"][0]["reason"] == "chain_view_rejected"
    n += 1; print("[8] missing proof / block hash / finality depth / difficulty floor: underspecified each")

    # [9] a revocation not signed as the principal does not end the grant
    b9 = _Chain(95, "00" * 32, "common"); [b9.block() for _ in range(3)]
    c9 = contract(lb={"kind": "bitcoin_block", "height": 97, "hash": b9.hashes[97]})
    fake_rv = v1._rv(cid, 0); fake_rv["revoked_by"] = "contractor"
    (frv,) = b9.block([fake_rv])
    (e,) = b9.block([v1._ex(cid, ["read"], 0)])
    for _ in range(4):
        b9.block()
    r = settle_v1_1(c9, [frv, e], b9.view())
    assert r["verdict"] == "within_grant" and r["ignored"][0]["reason"] == "revocation_by_non_principal", r
    n += 1; print("[9] revocation by the contractor: ignored and listed, grant stands")

    # [10] equal work picks nothing
    t1, t2 = base.fork(101, "T1"), base.fork(101, "T2")
    t1.block(); t2.block()
    assert compare_views([t1.view(), t2.view()], c)["chosen"] is None
    n += 1; print("[10] two views with equal cumulative work: no choice made, wait for the next block")

    # [11] v1 regression
    here = os.path.dirname(os.path.abspath(__file__))
    rr = subprocess.run([sys.executable, os.path.join(here, "settle_v1.py"), "--selftest"], capture_output=True, text=True)
    assert rr.returncode == 0 and "11 checks" in rr.stdout, rr.stdout + rr.stderr
    n += 1; print("[11] settle_v1.py still 11 of 11")

    print("\nSELF-TEST PASSED: MUSUBI settle v1.1, %d checks (headers, forks, work, convergence, deep reorg, "
          "fabricated views, backdating, terms)" % n)


def main():
    ap = argparse.ArgumentParser(description="MUSUBI settle v1.1 (fork-aware, proof-checked settlement)")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--settle", metavar="CONTRACT.json")
    ap.add_argument("--event", action="append", default=[], metavar="RECORD.json")
    ap.add_argument("--view", action="append", default=[], metavar="HEADERS.json",
                    help='{"headers": [{"height": h, "hex": "<160 hex>"}]}; repeat to let work choose')
    ap.add_argument("--check", metavar="SETTLEMENT.json", help="re-verify a settlement's pins against --view")
    ap.add_argument("--out", metavar="OUT.json")
    a = ap.parse_args()
    if a.selftest:
        _selftest(); return 0
    if not a.settle:
        ap.print_help(); return 1
    contract = parse_strict(open(a.settle, encoding="utf-8").read())
    views = [parse_strict(open(p, encoding="utf-8").read()) for p in a.view]
    if not views:
        print("need at least one --view"); return 1
    cmp = compare_views(views, contract)
    print(json.dumps({"fork_choice": cmp}, indent=2))
    if cmp["chosen"] is None:
        return 2
    view = views[cmp["chosen"]]
    if a.check:
        r = check_settlement(parse_strict(open(a.check, encoding="utf-8").read()), view, contract)
        print(json.dumps(r, indent=2)); return 0 if r["status"] == "consistent" else 2
    events = [parse_strict(open(p, encoding="utf-8").read()) for p in a.event]
    s = settle_v1_1(contract, events, view)
    if a.out:
        with open(a.out, "w", encoding="utf-8", newline="") as f:
            f.write(canonical(s))
        print("wrote", a.out)
    print(json.dumps(s, ensure_ascii=False, indent=2))
    return 0 if s["status"] == "final" else 2


if __name__ == "__main__":
    sys.exit(main())
