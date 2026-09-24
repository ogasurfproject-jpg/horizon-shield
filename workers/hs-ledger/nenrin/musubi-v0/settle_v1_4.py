#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MUSUBI settle v1.4: the full adversarial pass (a2a-settlement-v1.4).

Why this file exists. After four public red-team rounds on 2026-09-24 (v1, v1.1, v1.3, correction v0),
the whole stack was attacked on purpose, layer by layer. Every hole below was first reproduced against
settle_v1_3 with a working attack (see the self test, which runs each attack against v1.3 and then
against v1.4), and only then closed:

  H1  fork choice counted work below the contract checkpoint: a short fake branch that simply
      starts earlier outweighed a longer real one
  H2  an empty authorized_actions list meant allow-all
  H3  action names were raw strings: "Delete" or a Cyrillic "е" slipped past prohibited_actions
  H4  a witness key equal to a party key was accepted: the principal could sign as "witness" and
      put a deviation in the contractor's name (a frame); equal party keys likewise
  H5  revocation by delivery_ack gave the contractor a veto: never acknowledge, keep authority
  H6  an acknowledgement named the revocation by full record sha, which changes when the same
      revocation is anchored twice; after duplicate collapse the ack stopped matching
  H7  the same-block tie rule "record_sha256" is grindable: the record author re-signs variants
      until one sorts before the revocation
  H8  a principal approval was valid forever and reusable without limit
  H9  no bounds on records, actions or headers

The rules v1.4 settles by, all in one walk instead of patches over patches (the verified parts of
earlier layers are reused as parts: header verification and anchor proofs from v1.1, signatures from
v1.2, schemas and duplicate collapse from v1.3):

  terms       the contract must verify; authorized_actions must be present (empty means nothing is
              authorized); every action name in the grant and in records matches
              ^[a-z][a-z0-9_.:-]{0,63}$; party keys and witness keys are pairwise distinct; the tie
              policy is absent or "conservative" ("record_sha256" is refused as grindable);
              delivery_ack requires grant.revocation.ack_window (blocks); finality depth >= 1
  work        fork choice counts only headers at or above the contract checkpoint
  ordering    by anchor height. Within one block, ties are broken by TYPE, never by bytes:
              authority ends first (a revocation effective in block E covers acts in block E), and
              authority is granted late (an approval counts only from an earlier block, or from the
              same record as the act). Nothing a record author can grind changes the outcome.
  revocation  authority ends at block E, inclusive. anchor: E = revocation height. delivery_ack:
              E = min(ack height, revocation height + ack_window); the ack names the revocation by
              its signed body digest (or the record sha of any anchored copy of it)
  approvals   scoped approvals (a2a-approval-v1: action, valid_until_height, nonce, single_use,
              signed by the principal) count up to valid_until_height, single_use ones once.
              Unscoped v0 approvals count only if grant.approval_policy.allow_unscoped is true.
  bounds      at most 10000 records, 256 actions per record, 200000 headers, 32 witnesses

Stated limits: full Bitcoin consensus rules are not validated (linkage, work, floor, checkpoint are);
a stolen key signs validly; acts nobody recorded are invisible; the principal can revoke in the block
the contractor acts in, and under the conservative rule the actor bears that block.
"""
import argparse, base64, hashlib, json, os, random, re, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import contract_v0 as v0
import settle_v1 as v1
import settle_v1_1 as v11
import settle_v1_2 as v12
import settle_v1_3 as v13
from contract_v0 import canonical, parse_strict, ed25519_verify, b64_raw, EXEC_SCHEMA

SETTLE_SCHEMA = "a2a-settlement-v1.4"
ACTION_RE = re.compile(r"^[a-z][a-z0-9_.:-]{0,63}$")
HEX32 = re.compile(r"^[0-9a-f]{32}$")
APPROVAL_V1_CONTEXT = b"a2a-approval-v1\n"
MAX_RECORDS, MAX_ACTIONS, MAX_HEADERS, MAX_WITNESSES = 10000, 256, 200000, 32
ORDERING_RULE = ("anchor height; within a block by type: authority ends first, authority is granted "
                 "only from an earlier block or the same record")


# --------------------------------------------------------------------------- terms
def _grant_actions(grant):
    acts = list(grant.get("authorized_actions") or []) + list(grant.get("prohibited_actions") or [])
    acts += [c.get("action") for c in (grant.get("conditional") or []) if isinstance(c, dict)]
    d = grant.get("delegation")
    return acts


def check_terms(contract):
    """Contract-level problems. Any problem means no verdict: the terms themselves are unsettleable."""
    probs = []
    cv = v0.verify_contract(contract)
    if cv.get("verdict") != "accepted":
        return [{"reason": "contract_not_verified", "refusals": cv.get("refusals")}]
    g = contract.get("grant") or {}
    if not isinstance(g.get("authorized_actions"), list):
        probs.append({"reason": "authorized_actions_missing", "detail": "an explicit list is required; empty means nothing is authorized"})
    bad = sorted({a for a in _grant_actions(g) if not (isinstance(a, str) and ACTION_RE.match(a))}, key=str)
    if bad:
        probs.append({"reason": "grant_action_name_invalid", "names": bad})
    keys, wit = v12._keys(contract)
    ws = (g.get("witnesses") or [])
    if len(ws) > MAX_WITNESSES:
        probs.append({"reason": "too_many_witnesses"})
    names = [w.get("name") for w in ws if isinstance(w, dict)]
    raw = {}
    for role, k in keys.items():
        raw.setdefault(b64_raw(k, 32), []).append(role)
    for w in ws:
        if isinstance(w, dict):
            r = b64_raw(w.get("public_key_ed25519_b64"), 32)
            if r is None:
                probs.append({"reason": "witness_key_invalid", "witness": w.get("name")})
            raw.setdefault(r, []).append("witness:%s" % w.get("name"))
    if len(names) != len(set(names)):
        probs.append({"reason": "key_conflict", "detail": "duplicate witness names"})
    for r, holders in raw.items():
        if r is not None and len(holders) > 1:
            probs.append({"reason": "key_conflict", "detail": "one key held by %s" % sorted(holders)})
    tie = (g.get("ordering") or {}).get("same_height") if isinstance(g.get("ordering"), dict) else None
    if tie not in (None, "conservative"):
        probs.append({"reason": "tie_policy_refused",
                      "detail": "%r is grindable by the record author; omit it or use \"conservative\"" % tie})
    rev = g.get("revocation") if isinstance(g.get("revocation"), dict) else None
    if rev is not None:
        mode = rev.get("effective_at")
        if mode not in ("anchor", "delivery_ack"):
            probs.append({"reason": "revocation_policy_not_recomputable", "detail": "effective_at must be anchor or delivery_ack"})
        if mode == "delivery_ack":
            w = rev.get("ack_window")
            if isinstance(w, bool) or not isinstance(w, int) or w < 1:
                probs.append({"reason": "ack_window_missing",
                              "detail": "delivery_ack needs grant.revocation.ack_window (blocks) or the contractor holds a veto"})
    fin = g.get("finality") if isinstance(g.get("finality"), dict) else {}
    dp = fin.get("depth")
    if isinstance(dp, bool) or not isinstance(dp, int) or dp < 1:
        probs.append({"reason": "finality_policy_missing"})
    exp = g.get("expiry_height")
    if exp is not None and (isinstance(exp, bool) or not isinstance(exp, int) or exp < 0):
        probs.append({"reason": "bad_expiry_height"})
    return probs


# --------------------------------------------------------------------------- work from checkpoint
def checkpoint_work(view, contract):
    cv, problem = v11.verify_view(view, contract)
    if cv is None:
        return None, problem
    if len(view["headers"]) > MAX_HEADERS:
        return None, "too many headers"
    ck = cv["checkpoint"]["height"]
    work = 0
    for item in view["headers"]:
        if item["height"] >= ck:
            t = v11.bits_to_target(v11.header_fields(bytes.fromhex(item["hex"]))["bits"])
            work += (1 << 256) // (t + 1)
    return work, None


def compare_views_v1_4(views, contract):
    works, probs = [], []
    for v in views:
        w, p = checkpoint_work(v, contract)
        works.append(w); probs.append(p)
    valid = [i for i, w in enumerate(works) if w is not None]
    if not valid:
        return {"chosen": None, "why": "no view verified", "problems": probs}
    best = max(works[i] for i in valid)
    top = [i for i in valid if works[i] == best]
    if len(top) > 1:
        return {"chosen": None, "why": "tie in work above the checkpoint; wait for the next block",
                "work_hex": [format(w, "x") if w is not None else None for w in works]}
    return {"chosen": top[0], "why": "most work at or above the contract checkpoint",
            "work_hex": [format(w, "x") if w is not None else None for w in works]}


# --------------------------------------------------------------------------- approvals
def approval_v1_bytes(contract, e):
    return APPROVAL_V1_CONTEXT + canonical({
        "contract_id": contract.get("contract_id"),
        "payload_digest": (contract.get("task") or {}).get("payload_digest"),
        "action": e.get("action"), "valid_until_height": e.get("valid_until_height"),
        "nonce": e.get("nonce"), "single_use": e.get("single_use")}).encode("utf-8")


def sign_approval_v1(key, contract, action, valid_until_height, nonce, single_use=True):
    e = {"action": action, "by": "principal", "valid_until_height": valid_until_height,
         "nonce": nonce, "single_use": single_use}
    e["sig_b64"] = base64.b64encode(key.sign(approval_v1_bytes(contract, e))).decode("ascii")
    return e


def classify_approval(e, contract):
    """'scoped', 'unscoped', or None (not signed by the principal)."""
    if not isinstance(e, dict):
        return None
    keys, _ = v12._keys(contract)
    pk = keys.get("principal")
    if not pk:
        return None
    vu, nonce, su = e.get("valid_until_height"), e.get("nonce"), e.get("single_use")
    if (isinstance(vu, int) and not isinstance(vu, bool) and vu >= 0 and isinstance(nonce, str)
            and HEX32.match(nonce) and isinstance(su, bool)):
        if ed25519_verify(pk, e.get("sig_b64"), approval_v1_bytes(contract, e)) is True:
            return "scoped"
    cid, pdg = contract.get("contract_id"), (contract.get("task") or {}).get("payload_digest")
    if ed25519_verify(pk, e.get("sig_b64"), v12.approval_signing_bytes(cid, pdg, e.get("action"))) is True:
        return "unscoped"
    return None


# --------------------------------------------------------------------------- settle
def settle_v1_4(contract, events, view):
    g = contract.get("grant") or {}
    under = list(check_terms(contract))
    cv, vproblem = v11.verify_view(view, contract)
    if cv is None:
        under.append({"reason": "chain_view_rejected", "detail": vproblem})
    elif len(view["headers"]) > MAX_HEADERS:
        under.append({"reason": "input_too_large", "detail": "headers"}); cv = None
    if not isinstance(events, list) or len(events) > MAX_RECORDS:
        under.append({"reason": "input_too_large", "detail": "records"})
        events = []
    terms_ok = not under

    rejected, charges, orphaned, predates, ignored = [], [], [], [], []
    accepted = []                                   # (h, sha, record)
    body_of = {}                                    # body digest hex -> record shas of every anchored copy,
    for ev in v1.bind(contract, events):            # taken BEFORE duplicate collapse drops any copy
        body_of.setdefault(v11.commitment_digest(ev).hex(), set()).add(v1.rec_sha(ev))
    events, collapsed = v13.collapse_anchorings(contract, events, view) if terms_ok else (events, [])
    seen = set()
    for ev in (v1.bind(contract, events) if terms_ok else []):
        s = v1.rec_sha(ev)
        if s in seen:
            continue
        seen.add(s)
        why = v12.authenticate(ev, contract)
        if why:
            rejected.append({"sha256": s, "schema": ev.get("schema"), "why": why}); continue
        if ev.get("schema") == v1.REVOKE_SCHEMA and ev.get("revoked_by") != "principal":
            ignored.append({"sha256": s, "reason": "revocation_by_non_principal"}); continue
        probs = v13.conformance(ev)
        if ev.get("schema") == EXEC_SCHEMA:
            acts = ev.get("performed_actions") if isinstance(ev.get("performed_actions"), list) else []
            if len(acts) > MAX_ACTIONS:
                probs.append("more than %d actions" % MAX_ACTIONS)
            names = [a for a in acts] + [ap.get("action") for ap in (ev.get("approvals") or []) if isinstance(ap, dict)]
            badn = sorted({str(a) for a in names if not (isinstance(a, str) and ACTION_RE.match(a))})
            if badn:
                probs.append("action names outside ^[a-z][a-z0-9_.:-]{0,63}$: %s" % badn)
        if probs:
            if ev.get("schema") == EXEC_SCHEMA and v13._signer(ev, contract) == "contractor":
                charges.append({"clause": "nonconforming_record", "record_sha256": s, "why": probs})
            else:
                rejected.append({"sha256": s, "schema": ev.get("schema"), "why": "nonconforming: %s" % "; ".join(probs)})
                continue
        a = ev.get("anchor") if isinstance(ev.get("anchor"), dict) else {}
        h = v1.height_of(ev)
        bh = a.get("block_hash")
        if h is None or not (isinstance(bh, str) and v11.HEX64.match(bh)):
            under.append({"reason": "anchor_incomplete", "sha256": s}); continue
        if h < cv["checkpoint"]["height"]:
            predates.append({"sha256": s, "height": h}); continue
        if h > cv["tip"] or h not in cv["hashes"]:
            under.append({"reason": "anchor_beyond_observed_chain", "sha256": s, "height": h}); continue
        if cv["hashes"][h] != bh:
            orphaned.append({"sha256": s, "height": h, "block_hash": bh}); continue
        if v11.run_proof(v11.commitment_digest(ev), a.get("proof")) != cv["merkle"][h]:
            under.append({"reason": "anchor_proof_invalid", "sha256": s, "height": h}); continue
        accepted.append((h, s, ev))
    accepted.sort(key=lambda t: (t[0], t[1]))

    # revocations: authority ends at block E, inclusive
    rev_cfg = g.get("revocation") if isinstance(g.get("revocation"), dict) else {}
    mode, window = rev_cfg.get("effective_at"), rev_cfg.get("ack_window")
    acks = [(h, s, e) for h, s, e in accepted if e["schema"] == v1.ACK_SCHEMA]
    revs_out, ends = [], []
    for h, s, e in accepted:
        if e["schema"] != v1.REVOKE_SCHEMA:
            continue
        names = body_of.get(v11.commitment_digest(e).hex(), set()) | {v11.commitment_digest(e).hex()}
        entry = {"sha256": s, "height": h, "basis": mode}
        if mode == "anchor":
            E = h
        else:
            mine = [ah for ah, _, ae in acks if ae.get("revocation_sha256") in names]
            E = min([h + window] + mine)
            entry["ack_height"] = min(mine) if mine else None
            entry["window_end"] = h + window
        entry["authority_ends_at"] = E
        revs_out.append(entry); ends.append((E, s))
    ends.sort()

    # walk
    authorized = set(g.get("authorized_actions") or [])
    prohibited = set(g.get("prohibited_actions") or [])
    conditional = {c.get("action"): c for c in (g.get("conditional") or []) if isinstance(c, dict)}
    deleg = g.get("delegation")
    allowed_delegates = set((deleg.get("allowed") if isinstance(deleg, dict) else []) or [])
    allow_unscoped = bool(((g.get("approval_policy") or {}) if isinstance(g.get("approval_policy"), dict) else {}).get("allow_unscoped"))
    exp = g.get("expiry_height")
    carriers = []                                   # (h, sha, entry, kind)
    forged = []
    for h, s, e in accepted:
        if e["schema"] != EXEC_SCHEMA:
            continue
        for ap in e.get("approvals") or []:
            k = classify_approval(ap, contract)
            if k is None:
                forged.append({"clause": "forged_approval", "observed": ap.get("action") if isinstance(ap, dict) else None,
                               "record_sha256": s})
            else:
                carriers.append((h, s, ap, k))
    used_nonces = set()
    deviations = []
    for h, s, e in accepted:
        if e["schema"] != EXEC_SCHEMA:
            continue
        acts = [a for a in (e.get("performed_actions") or []) if isinstance(a, str)]
        ended = next((rs for E, rs in ends if E <= h), None)
        if ended:
            for a in acts:
                deviations.append({"clause": "revoked", "observed": a, "revocation_sha256": ended, "height": h, "record_sha256": s})
            continue
        for a in acts:
            if exp is not None and h > exp:
                deviations.append({"clause": "after_expiry", "observed": a, "height": h, "record_sha256": s})
            if a in prohibited:
                deviations.append({"clause": "prohibited", "observed": a, "height": h, "record_sha256": s}); continue
            if a in conditional:
                why, ok = None, False
                for ch, cs, ap, kind in carriers:
                    if ap.get("action") != a:
                        continue
                    if not (cs == s or ch < h):
                        why = why or "approval not anchored before the action (same block, other record)"; continue
                    if kind == "unscoped" and not allow_unscoped:
                        why = why or "unscoped approval; this grant requires valid_until_height and nonce"; continue
                    if kind == "scoped":
                        if h > ap["valid_until_height"]:
                            why = why or "approval_expired"; continue
                        if ap["single_use"] and ap["nonce"] in used_nonces:
                            why = why or "approval_reused"; continue
                        if ap["single_use"]:
                            used_nonces.add(ap["nonce"])
                    ok = True; break
                if not ok:
                    deviations.append({"clause": "conditional", "observed": a, "height": h, "record_sha256": s,
                                       "why": why or "requires %s, no approval" % conditional[a].get("requires")})
                continue
            if a not in authorized:
                deviations.append({"clause": "unauthorized", "observed": a, "height": h, "record_sha256": s})
        for dg in e.get("delegated_to") or []:
            if dg not in allowed_delegates:
                deviations.append({"clause": "delegation", "observed": dg, "height": h, "record_sha256": s})
    deviations += forged + charges

    under = sorted(under, key=canonical)
    verdict = "underspecified" if under else ("deviation" if deviations else "within_grant")
    status, horizon, pinned, tip = "undetermined", None, [], None
    if cv is not None:
        used = sorted({h for h, _, _ in accepted})
        pinned = [{"height": h, "block_hash": cv["hashes"][h]} for h in used]
        tip = {"height": cv["tip"], "block_hash": cv["hashes"][cv["tip"]]}
        dp = (g.get("finality") or {}).get("depth") if isinstance(g.get("finality"), dict) else None
        if isinstance(dp, int) and not isinstance(dp, bool) and dp >= 1:
            f = cv["tip"] - dp + 1
            horizon = {"height": f, "block_hash": cv["hashes"].get(f)}
            if verdict != "underspecified":
                status = "final" if all(x <= f for x in used + [o["height"] for o in orphaned]) else "provisional"
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
        "contract_id": contract.get("contract_id"),
        "ordering_rule": ORDERING_RULE,
        "view_rules": {"checkpoint": cv["checkpoint"], "max_target_bits": cv["max_target_bits"]} if cv else None,
        "chain_tip": tip, "finality_horizon": horizon, "pinned_blocks": pinned,
        "authoritative_event_set": [{"kind": v1._kind(e), "sha256": s, "height": h} for h, s, e in accepted],
        "revocations": revs_out,
        "verdict": verdict, "status": status, "bond_outcome": bond_outcome,
        "underspecified": under,
        "deviations": [] if verdict == "underspecified" else sorted(deviations, key=canonical),
        "orphaned": sorted(orphaned, key=canonical), "predates_contract": sorted(predates, key=canonical),
        "ignored": sorted(ignored, key=canonical), "rejected": sorted(rejected, key=canonical),
        "duplicate_anchorings": collapsed,
        "establishes": [
            "that the contract terms are settleable (verified, explicit authority, distinct keys, ungrindable ties, bounded revocation)",
            "that on the verified header view pinned here, the authenticated, proof-checked records %s the grant" % (
                "stay within" if verdict == "within_grant" else "deviate from" if verdict == "deviation" else
                "cannot be settled without the listed terms, so no verdict is rendered on"),
            "that this settlement is %s under the grant's finality depth" % status,
        ],
        "does_not_establish": [
            "full Bitcoin consensus validity; only linkage, work above the checkpoint, the difficulty floor and the checkpoint",
            "that no key was stolen", "that acts nobody recorded did not happen",
            "that HS judged this; the verdict is recomputable by anyone from the same bytes and headers",
        ],
        "signatures": [],
    }


# --------------------------------------------------------------------------- self test: attack v1.3, then v1.4
def _selftest():
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    def newkey():
        k = Ed25519PrivateKey.generate()
        return k, base64.b64encode(k.public_key().public_bytes(serialization.Encoding.Raw,
                                                                 serialization.PublicFormat.Raw)).decode()
    ka, pa = newkey(); kb, pb = newkey(); kw, pw = newkey()
    n = 0
    base = v11._Chain(60, "00" * 32, "common")
    for _ in range(38):                              # 60..97, checkpoint at 97
        base.block()
    lb = {"kind": "bitcoin_block", "height": 97, "hash": base.hashes[97]}
    DNE = ["that HS enforced any of this at runtime",
           "that the contractor obeyed the grant, only that its recorded acts match or deviate from it",
           "that HS judges liability or fault; the verdict is a function anyone recomputes",
           "that a prohibited action was impossible, only that performing one is a provable deviation",
           "that this is a legal contract or determines legal responsibility"]

    def contract(pkey=None, ckey=None, **grant_over):
        g = {"authorized_actions": ["read", "write"], "prohibited_actions": ["delete"],
             "conditional": [{"action": "write", "requires": "principal_approval"}],
             "delegation": {"allowed": []}, "revocation": {"effective_at": "anchor"},
             "finality": {"depth": 3, "max_target_bits": "207fffff"},
             "witnesses": [{"name": "nenrin-walker", "public_key_ed25519_b64": pw}]}
        for k, v in grant_over.items():
            if v is None:
                g.pop(k, None)
            else:
                g[k] = v
        c = v0.build_contract(
            {"domain": "gate.horizonshield.dev", "key_url": "https://gate.horizonshield.dev/keys/agreement.json", "public_key_ed25519_b64": pkey or pa},
            {"domain": "api.babyblueviper.com", "key_url": "https://api.babyblueviper.com/keys/agreement.json", "public_key_ed25519_b64": ckey or pb},
            {"purpose": "endpoint_conduct_walk", "payload_digest": "a" * 64, "a2a_task_id": "t1"}, g,
            ["that both parties signed these grant bytes at the stated time"], DNE,
            bond={"amount": 1000, "currency": "JPY"}, lower_bound=lb,
            contract_id="0123456789abcdef0123456789abcdef", nonce="c" * 32, agreed_at="2026-09-24T00:00:00Z")
        v0.sign_contract(c, ka, pkey or pa, "gate.horizonshield.dev")
        v0.sign_contract(c, kb if ckey is None else ka, ckey or pb, "api.babyblueviper.com")
        return c

    cid = "0123456789abcdef0123456789abcdef"

    def ex(actions, approvals=(), signer=("contractor", kb), ref="1", nenrin=None):
        r = v1._ex(cid, actions, 0, ref=ref); del r["anchor"]; r["approvals"] = list(approvals)
        if nenrin:
            r["nenrin_ref"] = nenrin
        return v12.sign_record(r, signer[1], signer[0], "nenrin-walker" if signer[0] == "witness" else None)

    def rv():
        r = v1._rv(cid, 0); del r["anchor"]
        return v12.sign_record(r, ka, "principal")

    def ack(rev_name):
        r = {"schema": v1.ACK_SCHEMA, "contract_ref": {"contract_id": cid, "payload_digest": "a" * 64},
             "revocation_sha256": rev_name, "acked_by": "contractor"}
        return v12.sign_record(r, kb, "contractor")

    def chain_run(blocks, extra=5):
        ch = base.fork(98, "r%d" % random.randint(0, 1 << 40))
        recs = []
        for b in blocks:
            recs += ch.block(b) if b else ch.block()
        for _ in range(extra):
            ch.block()
        return recs, ch

    def both(c, recs, ch):
        return v13.settle_v1_3(c, recs, ch.view()), settle_v1_4(c, recs, ch.view())

    # [H1] work below the checkpoint
    long_ = base.fork(98, "L"); [long_.block() for _ in range(6)]           # 98..103, full history from 60
    short = base.fork(98, "S"); [short.block() for _ in range(2)]           # 98..99
    c = contract()
    padded = {"headers": short.view()["headers"]}                            # starts at 60
    trimmed = {"headers": [x for x in long_.view()["headers"] if x["height"] >= 97]}   # starts at checkpoint
    old = v11.compare_views([padded, trimmed], c)["chosen"]
    new = compare_views_v1_4([padded, trimmed], c)["chosen"]
    assert old == 0 and new == 1, (old, new)
    n += 1; print("[H1] short branch padded with pre-checkpoint headers: v1.1 picks it; v1.4 counts from the checkpoint and picks the longer chain")

    # [H2] empty authorized_actions
    c = contract(authorized_actions=[], conditional=[])
    recs, ch = chain_run([[ex(["transfer_funds"])]])
    o, w = both(c, recs, ch)
    assert o["verdict"] == "within_grant" and w["verdict"] == "deviation" and w["deviations"][0]["clause"] == "unauthorized", (o["verdict"], w)
    n += 1; print("[H2] authorized_actions [] and 'transfer_funds': v1.3 within_grant; v1.4 deviation, unauthorized")

    # [H3] case and homoglyph names
    recs, ch = chain_run([[ex(["Delete"], ref="1")], [ex(["dеlete"], ref="2")]])
    o, w = both(c, recs, ch)
    assert o["verdict"] == "within_grant" and w["verdict"] == "deviation", (o["verdict"], w["verdict"])
    assert sum(1 for d in w["deviations"] if d["clause"] == "nonconforming_record") == 2
    n += 1; print("[H3] 'Delete' and Cyrillic 'dеlete' with an empty authorized list: v1.3 within_grant; v1.4 nonconforming + unauthorized")

    # [H4] witness key equal to the principal key: the principal frames the contractor
    import copy
    g4 = {"witnesses": [{"name": "nenrin-walker", "public_key_ed25519_b64": pa}]}
    c = contract(**g4)
    fake = v1._ex(cid, ["delete"], 0); del fake["anchor"]; fake["approvals"] = []
    fake = v12.sign_record(fake, ka, "witness", "nenrin-walker")             # signed by the PRINCIPAL's key
    recs, ch = chain_run([[fake]])
    o, w = both(c, recs, ch)
    assert o["verdict"] == "deviation" and w["verdict"] == "underspecified" and w["underspecified"][0]["reason"] == "key_conflict", (o["verdict"], w)
    same = contract(ckey=pa)
    assert any(u["reason"] == "key_conflict" for u in settle_v1_4(same, [], ch.view())["underspecified"])
    n += 1; print("[H4] principal signs a 'delete' as witness: v1.3 deviation (a frame); v1.4 refuses the terms, key_conflict; equal party keys too")

    # [H5] delivery_ack veto
    c_old = contract(revocation={"effective_at": "delivery_ack"})
    c_new = contract(revocation={"effective_at": "delivery_ack", "ack_window": 6})
    blocks = [[rv()]] + [None] * 9 + [[ex(["read"])]]                       # act 10 blocks after, no ack ever
    recs, ch = chain_run(blocks)
    o = v13.settle_v1_3(c_old, recs, ch.view())
    w_old, w_new = settle_v1_4(c_old, recs, ch.view()), settle_v1_4(c_new, recs, ch.view())
    assert o["verdict"] == "within_grant", o["verdict"]
    assert w_old["underspecified"][0]["reason"] == "ack_window_missing"
    assert w_new["verdict"] == "deviation" and w_new["deviations"][0]["clause"] == "revoked", w_new
    n += 1; print("[H5] contractor never acknowledges, acts 10 blocks later: v1.3 within_grant; v1.4 refuses delivery_ack without a window, "
                  "and with ack_window 6 authority ends at block %d: revoked" % w_new["revocations"][0]["authority_ends_at"])

    # [H6] ack names one anchored copy; duplicate collapse keeps another
    c = contract(revocation={"effective_at": "delivery_ack", "ack_window": 50})
    r = rv()
    ch = base.fork(98, "dup")
    (r1,) = ch.block([r]); (r2,) = ch.block([dict(r)])                       # same revocation, anchored at 98 and 99
    (a1,) = ch.block([ack(v1.rec_sha(r2))])                                  # 100: ack names the copy at 99
    ch.block()
    (e1,) = ch.block([ex(["read"])])                                         # 102: act after the ack
    for _ in range(5):
        ch.block()
    recs = [r1, r2, a1, e1]
    o, w = both(c, recs, ch)
    assert o["verdict"] == "within_grant", o["verdict"]
    assert w["verdict"] == "deviation" and w["revocations"][0]["ack_height"] == 100, w
    n += 1; print("[H6] ack names the second anchoring of a revocation: v1.3 loses it after collapse (within_grant); v1.4 matches by signed body, revoked")

    # [H7] grinding the same-block tie under record_sha256
    c_sha = contract(ordering={"same_height": "record_sha256"})
    c_con = contract()
    for attempt in range(400):
        rvx = rv()
        cand = ex(["read"], nenrin=hashlib.sha256(b"grind%d" % attempt).hexdigest())
        ch = base.fork(98, "g%d" % attempt)
        recs = ch.block([rvx, cand])
        for _ in range(5):
            ch.block()
        o = v13.settle_v1_3(c_sha, recs, ch.view())
        if o["verdict"] == "within_grant":
            break
    assert o["verdict"] == "within_grant", "grind failed"
    w_sha, w_con = settle_v1_4(c_sha, recs, ch.view()), settle_v1_4(c_con, recs, ch.view())
    assert w_sha["underspecified"][0]["reason"] == "tie_policy_refused"
    assert w_con["verdict"] == "deviation" and w_con["deviations"][0]["clause"] == "revoked", w_con
    n += 1; print("[H7] contractor re-signs %d variant(s) until its act sorts before the revocation in the same block: "
                  "v1.3 within_grant; v1.4 refuses record_sha256, and the conservative rule says revoked" % (attempt + 1))

    # [H8] approvals forever, reused
    c = contract()
    ap0 = v12.sign_approval(ka, c, "write")                                  # unscoped
    recs, ch = chain_run([[ex(["write"], approvals=[ap0], ref="1")]] + [None] * 5 + [[ex(["write"], approvals=[ap0], ref="2")]])
    o, w = both(c, recs, ch)
    assert o["verdict"] == "within_grant" and w["verdict"] == "deviation", (o["verdict"], w["verdict"])
    cu = contract(approval_policy={"allow_unscoped": True})
    assert settle_v1_4(cu, recs, ch.view())["verdict"] == "within_grant"
    nonce = "ab" * 16
    ap1 = sign_approval_v1(ka, c, "write", valid_until_height=100, nonce=nonce, single_use=True)
    recs, ch = chain_run([[ex(["write"], approvals=[ap1], ref="3")], [ex(["write"], approvals=[ap1], ref="4")]] + [None] * 3 +
                         [[ex(["write"], approvals=[ap1], ref="5")]])
    w = settle_v1_4(c, recs, ch.view())
    whys = sorted(d["why"] for d in w["deviations"] if d["clause"] == "conditional")
    assert whys == ["approval_expired", "approval_reused"], w["deviations"]
    n += 1; print("[H8] unscoped approval reused 6 blocks later: v1.3 within_grant; v1.4 deviation unless the grant allows unscoped. "
                  "Scoped single-use approval: second use approval_reused, use after block 100 approval_expired")

    # [H9] bounds
    w = settle_v1_4(contract(), [{}] * (MAX_RECORDS + 1), ch.view())
    assert any(u["reason"] == "input_too_large" for u in w["underspecified"])
    n += 1; print("[H9] %d records: input_too_large, no work done" % (MAX_RECORDS + 1))

    # [+] honest runs still settle, same bytes in any order, and a same-record approval still counts
    c = contract()
    ap = sign_approval_v1(ka, c, "write", valid_until_height=500, nonce="cd" * 16)
    recs, ch = chain_run([[ex(["read"], ref="6")], [ex(["write"], approvals=[ap], ref="7")]])
    w = settle_v1_4(c, recs, ch.view())
    assert w["verdict"] == "within_grant" and w["status"] == "final" and w["bond_outcome"] == "held", w
    ref = canonical(w)
    rng = random.Random(9)
    for _ in range(30):
        sh = recs + [dict(recs[0])]; rng.shuffle(sh)
        assert canonical(settle_v1_4(c, sh, ch.view())) == ref
    n += 1; print("[+] honest run: within_grant, final, bond held; 30 shuffles with duplicates, identical bytes")

    here = os.path.dirname(os.path.abspath(__file__))
    for f, want in (("settle_v1_3.py", "9 checks"), ("correction_v0.py", "7 checks")):
        rr = subprocess.run([sys.executable, os.path.join(here, f), "--selftest"], capture_output=True, text=True)
        assert rr.returncode == 0 and want in rr.stdout, f
    n += 1; print("[+] settle_v1_3 9/9 and correction_v0 7/7 (with every layer under them) still pass")

    print("\nSELF-TEST PASSED: MUSUBI settle v1.4, %d checks (9 attacks reproduced on v1.3 and closed, honest runs, regression)" % n)


def main():
    ap = argparse.ArgumentParser(description="MUSUBI settle v1.4 (full adversarial pass)")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--settle", metavar="CONTRACT.json")
    ap.add_argument("--event", action="append", default=[], metavar="RECORD.json")
    ap.add_argument("--view", action="append", default=[], metavar="HEADERS.json")
    a = ap.parse_args()
    if a.selftest:
        _selftest(); return 0
    if not a.settle or not a.view:
        ap.print_help(); return 1
    rd = lambda p: parse_strict(open(p, encoding="utf-8").read())
    contract = rd(a.settle)
    views = [rd(p) for p in a.view]
    cmp = compare_views_v1_4(views, contract)
    print(json.dumps({"fork_choice": cmp}, indent=2))
    if cmp["chosen"] is None:
        return 2
    s = settle_v1_4(contract, [rd(p) for p in a.event], views[cmp["chosen"]])
    print(json.dumps(s, ensure_ascii=False, indent=2))
    return 0 if s["status"] == "final" else 2


if __name__ == "__main__":
    sys.exit(main())
