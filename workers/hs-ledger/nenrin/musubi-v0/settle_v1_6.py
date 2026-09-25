#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MUSUBI settle v1.6: approvals bound to the terms (a2a-settlement-v1.6).

Why this file exists. The first outside contractor (Issue #25, 2026-09-25, babyblueviper1) ran a cold
break attempt at 330b94a0 against the whole settle chain and listed what was still open. Four gaps,
all reproduced here before anything was changed:

  D1  a leftover grant key "authorized_prohibited" silently replaced prohibited_actions in the v0 and v1
      settle paths (contract_v0.settle, settle_v1.py:92); no verifier ever validated the key
  D2  an empty authorized_actions list settled as allow-everything in settle_v1.py:233 (v1.4 already
      treats empty as nothing authorized; the base path still does not)
  D3  grant_subset compared only actions, data_access and hops, so a delegated child could widen who
      it delegates to, drop a parent's approval requirement, outlive the parent's expiry
  D4  approvals were signed over contract_id, so a principal's approval for one set of terms verified
      under renegotiated terms that kept the same id. v1.5 bound executions by contract_sha256 and
      left approvals bound by the label

What closes them, and where:
  D1  contract_v0.verify_contract now refuses any grant key outside GRANT_KEYS (grant_key_unknown), so
      every layer that verifies the contract first (v1.2 and up) refuses the shadowed grant at the
      door. The base v0 and v1 settle paths are superseded, not edited; the self test reproduces them.
  D2  inherited from v1.4: empty means nothing authorized. The self test reproduces the v1 path.
  D3  contract_v0.grant_subset now narrows on every axis of authority (actions, prohibitions, data,
      hops, delegates, conditions, expiry, revocation speed, unscoped approvals). Reproduced against a
      frozen copy of the old function.
  D4  this file. An approval counts only if the principal signed it over a2a-approval-v2 bytes that
      carry contract_sha256, valid_until_height, nonce and single_use. A genuine principal signature
      over the old contract_id bytes is classified label_bound and does not count (the action it
      covers settles as unapproved, clause conditional, with the reason named). A valid v2 approval
      for a different sha is other_terms and does not count. Unscoped approvals cannot be bound to
      terms and time, so a grant that allows them is refused (unscoped_approvals_refused).

Everything else is v1.5 and v1.4 reused as parts, untouched: binding by contract_sha256 and the NENRIN
cross check from v1.5; terms, checkpoint work, authentication, conformance, duplicate collapse, the
ordering and revocation rules from v1.4. The walk below is v1.4's walk with the approval classifier
swapped; nothing about ordering, ties or revocation changed.

Stated limits: as v1.4 and v1.5. A stolen principal key still signs a valid v2 approval.
"""
import argparse, base64, hashlib, json, os, random, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import contract_v0 as v0
import settle_v1 as v1
import settle_v1_1 as v11
import settle_v1_2 as v12
import settle_v1_3 as v13
import settle_v1_4 as v14
import settle_v1_5 as v15
from contract_v0 import canonical, parse_strict, ed25519_verify, contract_sha256, HEX64, EXEC_SCHEMA

SETTLE_SCHEMA = "a2a-settlement-v1.6"
APPROVAL_V2_CONTEXT = b"a2a-approval-v2\n"
HEX32 = v14.HEX32


# --------------------------------------------------------------------------- approvals v2
def approval_v2_bytes(csha, e):
    return APPROVAL_V2_CONTEXT + canonical({
        "contract_sha256": csha, "action": e.get("action"), "valid_until_height": e.get("valid_until_height"),
        "nonce": e.get("nonce"), "single_use": e.get("single_use")}).encode("utf-8")


def sign_approval_v2(key, contract, action, valid_until_height, nonce, single_use=True):
    csha = contract_sha256(contract)
    e = {"action": action, "by": "principal", "binding": "contract_sha256", "contract_sha256": csha,
         "valid_until_height": valid_until_height, "nonce": nonce, "single_use": single_use}
    e["sig_b64"] = base64.b64encode(key.sign(approval_v2_bytes(csha, e))).decode("ascii")
    return e


def classify_approval_v2(e, contract):
    """'scoped_v2' (counts), 'other_terms' (valid v2 for another sha), 'label_bound' (genuine principal
    signature over the old contract_id bytes), or None (not the principal's signature)."""
    if not isinstance(e, dict):
        return None
    keys, _ = v12._keys(contract)
    pk = keys.get("principal")
    if not pk:
        return None
    csha = contract_sha256(contract)
    vu, nonce, su, claimed = e.get("valid_until_height"), e.get("nonce"), e.get("single_use"), e.get("contract_sha256")
    if (isinstance(vu, int) and not isinstance(vu, bool) and vu >= 0 and isinstance(nonce, str) and HEX32.match(nonce)
            and isinstance(su, bool) and isinstance(claimed, str) and HEX64.match(claimed)):
        if ed25519_verify(pk, e.get("sig_b64"), approval_v2_bytes(claimed, e)) is True:
            return "scoped_v2" if claimed == csha else "other_terms"
    return "label_bound" if v14.classify_approval(e, contract) in ("scoped", "unscoped") else None


# --------------------------------------------------------------------------- terms
def check_terms_v1_6(contract):
    probs = list(v14.check_terms(contract))
    g = contract.get("grant") or {}
    ap = g.get("approval_policy") if isinstance(g.get("approval_policy"), dict) else {}
    if bool(ap.get("allow_unscoped")):
        probs.append({"reason": "unscoped_approvals_refused",
                      "detail": "an unscoped approval cannot be bound to these terms and a height; use a2a-approval-v2"})
    return probs


# --------------------------------------------------------------------------- settle
def settle_v1_6(contract, events, view, mode="strict", nenrin_records=None):
    if mode not in ("strict", "legacy"):
        raise ValueError("mode must be 'strict' or 'legacy'")
    if not isinstance(events, list):
        events = []
    csha = contract_sha256(contract)
    g = contract.get("grant") or {}
    bound, foreign, unbound, inconsistent = v15.classify_binding(contract, events, csha)
    used = list(bound) + (list(unbound) if mode == "legacy" else [])

    under = check_terms_v1_6(contract)
    cv, vproblem = v11.verify_view(view, contract)
    if cv is None:
        under.append({"reason": "chain_view_rejected", "detail": vproblem})
    elif len(view["headers"]) > v14.MAX_HEADERS:
        under.append({"reason": "input_too_large", "detail": "headers"}); cv = None
    if len(used) > v14.MAX_RECORDS:
        under.append({"reason": "input_too_large", "detail": "records"}); used = []
    terms_ok = not under

    # v1.4's walk, verbatim except for the approval classifier
    rejected, charges, orphaned, predates, ignored = [], [], [], [], []
    accepted, body_of = [], {}
    for ev in v1.bind(contract, used):
        body_of.setdefault(v11.commitment_digest(ev).hex(), set()).add(v1.rec_sha(ev))
    used, collapsed = v13.collapse_anchorings(contract, used, view) if terms_ok else (used, [])
    seen = set()
    for ev in (v1.bind(contract, used) if terms_ok else []):
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
            if len(acts) > v14.MAX_ACTIONS:
                probs.append("more than %d actions" % v14.MAX_ACTIONS)
            names = [a for a in acts] + [ap.get("action") for ap in (ev.get("approvals") or []) if isinstance(ap, dict)]
            badn = sorted({str(a) for a in names if not (isinstance(a, str) and v14.ACTION_RE.match(a))})
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

    rev_cfg = g.get("revocation") if isinstance(g.get("revocation"), dict) else {}
    mode_r, window = rev_cfg.get("effective_at"), rev_cfg.get("ack_window")
    acks = [(h, s, e) for h, s, e in accepted if e["schema"] == v1.ACK_SCHEMA]
    revs_out, ends = [], []
    for h, s, e in accepted:
        if e["schema"] != v1.REVOKE_SCHEMA:
            continue
        names = body_of.get(v11.commitment_digest(e).hex(), set()) | {v11.commitment_digest(e).hex()}
        entry = {"sha256": s, "height": h, "basis": mode_r}
        if mode_r == "anchor":
            E = h
        else:
            mine = [ah for ah, _, ae in acks if ae.get("revocation_sha256") in names]
            E = min([h + window] + mine)
            entry["ack_height"] = min(mine) if mine else None
            entry["window_end"] = h + window
        entry["authority_ends_at"] = E
        revs_out.append(entry); ends.append((E, s))
    ends.sort()

    authorized = set(g.get("authorized_actions") or [])
    prohibited = set(g.get("prohibited_actions") or [])
    conditional = {c.get("action"): c for c in (g.get("conditional") or []) if isinstance(c, dict)}
    deleg = g.get("delegation")
    allowed_delegates = set((deleg.get("allowed") if isinstance(deleg, dict) else []) or [])
    exp = g.get("expiry_height")
    carriers, forged, label_bound, other_terms = [], [], [], []
    for h, s, e in accepted:
        if e["schema"] != EXEC_SCHEMA:
            continue
        for ap in e.get("approvals") or []:
            k = classify_approval_v2(ap, contract)
            act = ap.get("action") if isinstance(ap, dict) else None
            if k is None:
                forged.append({"clause": "forged_approval", "observed": act, "record_sha256": s})
            elif k == "label_bound":
                label_bound.append({"action": act, "record_sha256": s})
            elif k == "other_terms":
                other_terms.append({"action": act, "record_sha256": s, "contract_sha256": ap.get("contract_sha256")})
            else:
                carriers.append((h, s, ap))
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
                for ch, cs, ap in carriers:
                    if ap.get("action") != a:
                        continue
                    if not (cs == s or ch < h):
                        why = why or "approval not anchored before the action (same block, other record)"; continue
                    if h > ap["valid_until_height"]:
                        why = why or "approval_expired"; continue
                    if ap["single_use"] and ap["nonce"] in used_nonces:
                        why = why or "approval_reused"; continue
                    if ap["single_use"]:
                        used_nonces.add(ap["nonce"])
                    ok = True; break
                if not ok:
                    if why is None and any(x["action"] == a and x["record_sha256"] == s for x in label_bound):
                        why = "approval bound by contract_id, not these terms (replayable across renegotiation); not counted"
                    elif why is None and any(x["action"] == a and x["record_sha256"] == s for x in other_terms):
                        why = "approval bound to other terms (different contract_sha256); not counted"
                    deviations.append({"clause": "conditional", "observed": a, "height": h, "record_sha256": s,
                                       "why": why or "requires %s, no approval" % conditional[a].get("requires")})
                continue
            if a not in authorized:
                deviations.append({"clause": "unauthorized", "observed": a, "height": h, "record_sha256": s})
        for dg in e.get("delegated_to") or []:
            if dg not in allowed_delegates:
                deviations.append({"clause": "delegation", "observed": dg, "height": h, "record_sha256": s})
    deviations += forged + charges
    deviations += v15._nenrin_deviations(used, nenrin_records, csha)

    under = sorted(under, key=canonical)
    verdict = "underspecified" if under else ("deviation" if deviations else "within_grant")
    status, horizon, pinned, tip = "undetermined", None, [], None
    if cv is not None:
        usedh = sorted({h for h, _, _ in accepted})
        pinned = [{"height": h, "block_hash": cv["hashes"][h]} for h in usedh]
        tip = {"height": cv["tip"], "block_hash": cv["hashes"][cv["tip"]]}
        dp = (g.get("finality") or {}).get("depth") if isinstance(g.get("finality"), dict) else None
        if isinstance(dp, int) and not isinstance(dp, bool) and dp >= 1:
            f = cv["tip"] - dp + 1
            horizon = {"height": f, "block_hash": cv["hashes"].get(f)}
            if verdict != "underspecified":
                status = "final" if all(x <= f for x in usedh + [o["height"] for o in orphaned]) else "provisional"
    bond_outcome = v15._bond_outcome(contract, verdict, status)

    return {
        "schema": SETTLE_SCHEMA,
        "settled_under": v15.SETTLE_SCHEMA,
        "contract_id": contract.get("contract_id"),
        "contract_sha256": csha,
        "binding_mode": mode,
        "bound_by_label_only": (mode == "legacy" and bool(unbound)),
        "ordering_rule": v14.ORDERING_RULE,
        "approval_rule": "a2a-approval-v2: signed by the principal over contract_sha256, action, valid_until_height, nonce, single_use; "
                         "label_bound and other_terms approvals are listed and never counted; unscoped approvals are refused",
        "view_rules": {"checkpoint": cv["checkpoint"], "max_target_bits": cv["max_target_bits"]} if cv else None,
        "chain_tip": tip, "finality_horizon": horizon, "pinned_blocks": pinned,
        "authoritative_event_set": [{"kind": v1._kind(e), "sha256": s, "height": h} for h, s, e in accepted],
        "revocations": revs_out,
        "verdict": verdict, "status": status, "bond_outcome": bond_outcome,
        "underspecified": under,
        "deviations": [] if verdict == "underspecified" else sorted(deviations, key=canonical),
        "approvals": {"counted": [{"action": ap.get("action"), "record_sha256": s, "nonce": ap.get("nonce")} for _, s, ap in carriers],
                      "label_bound": sorted(label_bound, key=canonical), "other_terms": sorted(other_terms, key=canonical)},
        "binding": {"bound": sorted(v1.rec_sha(e) for e in bound), "unbound": sorted(v1.rec_sha(e) for e in unbound),
                    "foreign": sorted(foreign, key=canonical), "inconsistent": sorted(inconsistent, key=canonical)},
        "orphaned": sorted(orphaned, key=canonical), "predates_contract": sorted(predates, key=canonical),
        "ignored": sorted(ignored, key=canonical), "rejected": sorted(rejected, key=canonical),
        "duplicate_anchorings": collapsed,
        "establishes": [
            "that every settled record and every counted approval names these terms by contract_sha256, recomputed here from the contract bytes",
            "that the contract terms are settleable (verified, no undeclared grant key, explicit authority, distinct keys, ungrindable ties, bounded revocation, no unscoped approvals)",
            "that on the verified header view pinned here, the authenticated, proof-checked records %s the grant" % (
                "stay within" if verdict == "within_grant" else "deviate from" if verdict == "deviation" else
                "cannot be settled without the listed terms, so no verdict is rendered on"),
            "that this settlement is %s under the grant's finality depth" % status,
        ],
        "does_not_establish": [
            "full Bitcoin consensus validity; only linkage, work above the checkpoint, the difficulty floor and the checkpoint",
            "that no key was stolen", "that acts nobody recorded did not happen",
            "that a label_bound or other_terms approval is false; only that it does not bind to these terms, so it is not counted",
            "that HS judged this; the verdict is recomputable by anyone from the same bytes and headers",
        ],
        "signatures": [],
    }


# --------------------------------------------------------------------------- self test
def _grant_subset_before_issue_25(child, parent):
    """Frozen copy of contract_v0.grant_subset as of 330b94a0, kept only to reproduce D3."""
    v = []
    pa = set(parent.get("authorized_actions") or [])
    for a in (child.get("authorized_actions") or []):
        if a not in pa:
            v.append("authorized action %r not in parent grant" % a)
    cp = set(child.get("prohibited_actions") or [])
    for a in (parent.get("prohibited_actions") or []):
        if a not in cp:
            v.append("parent prohibits %r but child does not" % a)
    pd = set(parent.get("data_access") or [])
    for d in (child.get("data_access") or []):
        if d not in pd:
            v.append("data_access %r not in parent grant" % d)
    if isinstance(parent.get("max_hops"), int) and isinstance(child.get("max_hops"), int):
        if child["max_hops"] > parent["max_hops"] - 1:
            v.append("max_hops %d exceeds parent-1 (%d)" % (child["max_hops"], parent["max_hops"] - 1))
    return v


def _selftest():
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    def newkey():
        k = Ed25519PrivateKey.generate()
        return k, base64.b64encode(k.public_key().public_bytes(serialization.Encoding.Raw,
                                                               serialization.PublicFormat.Raw)).decode()
    ka, pa = newkey(); kb, pb = newkey(); kw, pw = newkey()
    n = 0
    PDG = "a" * 64
    base = v11._Chain(60, "00" * 32, "common")
    for _ in range(38):
        base.block()
    lb = {"kind": "bitcoin_block", "height": 97, "hash": base.hashes[97]}
    DNE = ["that HS enforced any of this at runtime",
           "that the contractor obeyed the grant, only that its recorded acts match or deviate from it",
           "that HS judges liability or fault; the verdict is a function anyone recomputes",
           "that a prohibited action was impossible, only that performing one is a provable deviation",
           "that this is a legal contract or determines legal responsibility"]

    def mk(cid, authorized, prohibited, conditional=(), nonce="c" * 32, **over):
        g = {"authorized_actions": authorized, "prohibited_actions": prohibited, "conditional": list(conditional),
             "delegation": {"allowed": []}, "revocation": {"effective_at": "anchor"},
             "finality": {"depth": 3, "max_target_bits": "207fffff"},
             "witnesses": [{"name": "nenrin-walker", "public_key_ed25519_b64": pw}]}
        g.update(over)
        c = v0.build_contract(
            {"domain": "gate.horizonshield.dev", "key_url": "https://gate.horizonshield.dev/keys/agreement.json", "public_key_ed25519_b64": pa},
            {"domain": "api.babyblueviper.com", "key_url": "https://api.babyblueviper.com/keys/agreement.json", "public_key_ed25519_b64": pb},
            {"purpose": "endpoint_conduct_walk", "payload_digest": PDG, "a2a_task_id": "t1"}, g,
            ["that both parties signed these grant bytes at the stated time"], DNE,
            bond={"amount": 1000, "currency": "JPY"}, lower_bound=lb,
            contract_id=cid, nonce=nonce, agreed_at="2026-09-24T00:00:00Z")
        v0.sign_contract(c, ka, pa, "gate.horizonshield.dev")
        v0.sign_contract(c, kb, pb, "api.babyblueviper.com")
        return c

    def ex(c, actions, approvals=(), ref="1"):
        r = {"schema": EXEC_SCHEMA,
             "contract_ref": {"contract_id": c["contract_id"], "payload_digest": PDG, "contract_sha256": contract_sha256(c)},
             "performed_actions": list(actions), "approvals": list(approvals), "delegated_to": [],
             "nenrin_ref": (ref * 64)[:64]}
        return v12.sign_record(r, kb, "contractor")

    def run(recs_by_block, extra=5):
        ch = base.fork(98, "r%d" % random.randint(0, 1 << 40))
        out = []
        for recs in recs_by_block:
            out += ch.block(recs) if recs else ch.block()
        for _ in range(extra):
            ch.block()
        return out, ch

    idA = "0123456789abcdef0123456789abcdef"
    COND = [{"action": "payment", "requires": "principal_approval"}]

    # [D4] the replay: a principal approval for A, presented under renegotiated A' with the same id
    A = mk(idA, ["read", "payment"], ["delete"], COND, nonce="a" * 32)
    Ap = mk(idA, ["read", "payment"], ["delete", "send_pii"], COND, nonce="b" * 32)   # renegotiated, same id
    assert contract_sha256(A) != contract_sha256(Ap)
    ap_v1 = v14.sign_approval_v1(ka, A, "payment", valid_until_height=500, nonce="ab" * 16)   # bound by contract_id
    recs, ch = run([[ex(Ap, ["payment"], approvals=[ap_v1])]])
    s5 = v15.settle_v1_5(Ap, recs, ch.view())
    s6 = settle_v1_6(Ap, recs, ch.view())
    assert s5["verdict"] == "within_grant", s5["verdict"]
    assert s6["verdict"] == "deviation" and s6["deviations"][0]["clause"] == "conditional" and "contract_id" in s6["deviations"][0]["why"], s6["deviations"]
    assert s6["approvals"]["label_bound"] and not s6["approvals"]["counted"]
    n += 1; print("[D4] approval signed for A (contract_id bound) replayed under A' (same id, new terms): v1.5 within_grant; "
                  "v1.6 label_bound, not counted, deviation conditional")

    # [D4 closed] a v2 approval counts under its own terms and is other_terms anywhere else
    ap_v2 = sign_approval_v2(ka, A, "payment", valid_until_height=500, nonce="cd" * 16)
    recs, ch = run([[ex(A, ["payment"], approvals=[ap_v2])]])
    s = settle_v1_6(A, recs, ch.view())
    assert s["verdict"] == "within_grant" and s["status"] == "final" and s["bond_outcome"] == "held" and s["approvals"]["counted"], s
    recs2, ch2 = run([[ex(Ap, ["payment"], approvals=[ap_v2])]])
    s = settle_v1_6(Ap, recs2, ch2.view())
    assert s["verdict"] == "deviation" and s["approvals"]["other_terms"] and "other terms" in s["deviations"][0]["why"], s
    n += 1; print("[D4] a2a-approval-v2 counts under A (within_grant, final, bond held); the same approval under A' is other_terms, not counted")

    # [D4] forged is still forged; a v2 approval whose sha claim is edited fails the signature
    bad = dict(ap_v2); bad["contract_sha256"] = contract_sha256(Ap)
    recs, ch = run([[ex(Ap, ["payment"], approvals=[bad])]])
    s = settle_v1_6(Ap, recs, ch.view())
    assert any(d["clause"] == "forged_approval" for d in s["deviations"]), s["deviations"]
    n += 1; print("[D4] v2 approval with its contract_sha256 field rewritten: signature fails, forged_approval")

    # [D1] the shadowed key: v1 path settles delete within grant; the door now refuses the contract
    c1 = v1._c(); cid = c1["contract_id"]
    c1["grant"]["authorized_actions"] = []; c1["grant"]["authorized_prohibited"] = ["harmless"]; c1["grant"]["conditional"] = []
    old = v1.settle_v1(c1, [v1._ex(cid, ["delete", "payment"], 100)])
    assert old["verdict"] == "within_grant", old["verdict"]
    old0 = v0.settle(c1, [{"schema": EXEC_SCHEMA, "contract_ref": {"contract_id": cid, "payload_digest": "a" * 64},
                           "performed_actions": ["delete"], "approvals": [], "delegated_to": [], "nenrin_ref": "a" * 64}])
    assert old0["verdict"] == "within_grant"
    shadow = mk(idA, ["read"], ["delete"], nonce="d" * 32)
    shadow["grant"]["authorized_prohibited"] = ["harmless"]          # after signing: also breaks the signature, so re-sign
    shadow["signatures"] = []; v0.sign_contract(shadow, ka, pa, "gate.horizonshield.dev"); v0.sign_contract(shadow, kb, pb, "api.babyblueviper.com")
    s = settle_v1_6(shadow, [], ch.view())
    assert s["verdict"] == "underspecified" and s["underspecified"][0]["reason"] == "contract_not_verified"
    assert any(r["code"] == "grant_key_unknown" for r in s["underspecified"][0]["refusals"]), s["underspecified"]
    n += 1; print("[D1] authorized_prohibited shadows prohibited_actions in v0.settle and settle_v1 (within_grant); "
                  "verify_contract now refuses the key (grant_key_unknown), so v1.6 renders no verdict")

    # [D2] empty authorized_actions: v1 path allow-all; v1.6 nothing authorized
    c2 = v1._c(); c2["grant"]["authorized_actions"] = []; c2["grant"]["conditional"] = []
    assert v1.settle_v1(c2, [v1._ex(cid, ["anything"], 100)])["verdict"] == "within_grant"
    empty = mk(idA, [], ["delete"], nonce="e" * 32)
    recs, ch = run([[ex(empty, ["anything"])]])
    s = settle_v1_6(empty, recs, ch.view())
    assert s["verdict"] == "deviation" and s["deviations"][0]["clause"] == "unauthorized", s
    n += 1; print("[D2] authorized_actions [] : settle_v1 within_grant on 'anything'; v1.6 unauthorized")

    # [D3] delegation widening: frozen old grant_subset sees nothing; the live one names every axis
    parent = {"authorized_actions": ["read", "write"], "prohibited_actions": ["delete"],
              "conditional": [{"action": "write", "requires": "principal_approval"}],
              "delegation": {"allowed": ["a.example"]}, "expiry_height": 1000, "revocation": {"effective_at": "anchor"}}
    child = {"authorized_actions": ["read", "write"], "prohibited_actions": ["delete"], "conditional": [],
             "delegation": {"allowed": ["a.example", "anyone.example"]}, "expiry_height": 9999,
             "revocation": {"effective_at": "delivery_ack", "ack_window": 50}}
    assert _grant_subset_before_issue_25(child, parent) == []
    live = v0.grant_subset(child, parent)
    assert len(live) >= 4 and any("anyone.example" in x for x in live) and any("drops the condition" in x for x in live) \
        and any("9999" in x for x in live) and any("delivery_ack" in x for x in live), live
    n += 1; print("[D3] child widens delegates, drops a condition, extends expiry, loosens revocation: old grant_subset [] ; "
                  "live grant_subset names %d violations" % len(live))

    # [+] unscoped approvals are refused as terms
    cu = mk(idA, ["read", "payment"], ["delete"], COND, nonce="f" * 32, approval_policy={"allow_unscoped": True})
    s = settle_v1_6(cu, [], ch.view())
    assert any(u["reason"] == "unscoped_approvals_refused" for u in s["underspecified"]), s["underspecified"]
    n += 1; print("[+] grant.approval_policy.allow_unscoped true: refused (unscoped_approvals_refused)")

    # [+] honest run and determinism
    ap2 = sign_approval_v2(ka, A, "payment", valid_until_height=500, nonce="ef" * 16)
    recs, ch = run([[ex(A, ["read"], ref="2")], [ex(A, ["payment"], approvals=[ap2], ref="3")]])
    s = settle_v1_6(A, recs, ch.view())
    assert s["verdict"] == "within_grant" and s["status"] == "final" and s["bond_outcome"] == "held", s
    ref = canonical(s)
    rng = random.Random(11)
    for _ in range(30):
        sh = recs + [dict(recs[0])]; rng.shuffle(sh)
        assert canonical(settle_v1_6(A, sh, ch.view())) == ref
    n += 1; print("[+] honest run with a v2 approval: within_grant, final, bond held; 30 shuffles with a duplicate, identical bytes")

    # [+] every layer below still passes
    here = os.path.dirname(os.path.abspath(__file__))
    for f, want in (("contract_v0.py", "9 checks"), ("settle_v1_5.py", "9 checks")):
        rr = subprocess.run([sys.executable, os.path.join(here, f), "--selftest"], capture_output=True, text=True)
        assert rr.returncode == 0 and want in rr.stdout, (f, rr.stdout[-300:], rr.stderr[-300:])
    n += 1; print("[+] contract_v0 7/7 and settle_v1_5 9/9 (with every layer under them) still pass")

    print("\nSELF-TEST PASSED: MUSUBI settle v1.6, %d checks (Issue #25: D1 grant key door, D2 empty grant, "
          "D3 delegation on every axis, D4 approvals bound by contract_sha256; unscoped refused; determinism; regression)" % n)


def main():
    ap = argparse.ArgumentParser(description="MUSUBI settle v1.6 (approvals bound to the terms)")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--settle", metavar="CONTRACT.json")
    ap.add_argument("--event", action="append", default=[], metavar="RECORD.json")
    ap.add_argument("--view", action="append", default=[], metavar="HEADERS.json")
    ap.add_argument("--nenrin", action="append", default=[], metavar="WALK.json")
    ap.add_argument("--mode", choices=("strict", "legacy"), default="strict")
    ap.add_argument("--out", metavar="OUT.json")
    a = ap.parse_args()
    if a.selftest:
        _selftest(); return 0
    if not a.settle or not a.view:
        ap.print_help(); return 1
    rd = lambda p: parse_strict(open(p, encoding="utf-8").read())
    contract = rd(a.settle)
    views = [rd(p) for p in a.view]
    cmp = v14.compare_views_v1_4(views, contract)
    print(json.dumps({"fork_choice": cmp}, indent=2))
    if cmp["chosen"] is None:
        return 2
    nenrin = [rd(p) for p in a.nenrin] if a.nenrin else None
    s = settle_v1_6(contract, [rd(p) for p in a.event], views[cmp["chosen"]], mode=a.mode, nenrin_records=nenrin)
    if a.out:
        with open(a.out, "w", encoding="utf-8", newline="") as f:
            f.write(canonical(s))
        print("wrote", a.out)
    print(json.dumps(s, ensure_ascii=False, indent=2))
    return 0 if s["status"] == "final" else 2


if __name__ == "__main__":
    sys.exit(main())
