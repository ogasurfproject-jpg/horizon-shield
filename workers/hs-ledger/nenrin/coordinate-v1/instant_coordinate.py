#!/usr/bin/env python3
"""
NENRIN instant coordinate, reference implementation (`nenrin-instant-v1`).

The defect, in the language of NENRIN_COORDINATE_SPEC_v1 (sha256
5be2b22e339d8b5c45a272325c49da189f10715b01683025ae903e83bf251df5):
"the coordinate is chosen by the party being verified."

Time is a coordinate. A ring counts instants_sampled and instants_reached, so
whoever chooses the instants chooses what the ring says. In the reference gate
as deployed on 2026-09-05, the free tier's measurement day is

    bucket = int(sha256(endpoint)[:4], 16) % 7

which the target can compute for itself. A shim that answers only on its own
bucket day earns a full ring at one seventh of the cost of being up. The gaming
analysis in NENRIN_SPEC_v1 (sha256
9ccba2e325fd2a555fcdb2dec519b8c6bf7a669064674846aea98ecfff824e3d) answers shim
farms by arguing that a shim which stays up has paid most of the cost of honesty.
That argument assumes the shim must stay up. Under a computable schedule it does
not.

The fix, which is the coordinate rule applied to the time axis: derive the
instant from a source neither party controls, and bind the derivation into the
verdict as an output.

Two ingredients, because either alone is insufficient:

  1. A salt the measurer commits to before the window and reveals after. Without
     it the target predicts, because everything else is public.
  2. A Bitcoin block height at the window boundary. Without it the measurer could
     mint a salt after the fact and claim any instant it liked. The commitment
     must be anchored at a height below the window's opening height, so the
     commitment provably predates the measurement.

Neither party can steer the result. Anyone can recompute it afterwards.

Offline and deterministic: no network, no clock reads in the derivation itself.
"""

import hashlib
import hmac
import json

SCHEMA = "nenrin-instant-v1"
SLOTS_PER_WINDOW = 1440          # one slot per minute of a 24h window
SALT_BYTES = 32


def _h(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def salt_commitment(salt_hex: str) -> str:
    """What the measurer publishes and anchors BEFORE the window opens."""
    if not isinstance(salt_hex, str):
        raise TypeError("salt must be a hex string")
    if len(salt_hex) != SALT_BYTES * 2:
        raise ValueError("salt must be %d hex characters" % (SALT_BYTES * 2))
    try:
        raw = bytes.fromhex(salt_hex)
    except ValueError:
        raise ValueError("salt is not hex")
    return _h(b"nenrin-instant-salt-v1:" + raw)


def _prf(salt_hex: str, *parts: str) -> bytes:
    msg = "\x00".join(parts).encode("utf-8")
    return hmac.new(bytes.fromhex(salt_hex), msg, hashlib.sha256).digest()


def derive_instant(salt_hex: str, endpoint: str, window_id: str) -> int:
    """Slot index within the window. The target cannot compute this without the salt."""
    d = _prf(salt_hex, SCHEMA, "instant", endpoint, window_id)
    return int.from_bytes(d[:8], "big") % SLOTS_PER_WINDOW


def tool_set_digest(tool_names) -> str:
    """
    Identity of the declared surface, order-independent and duplicate-hostile.
    Reordering tools/list does not change it. Renaming a tool does, and a ring
    records that as a surface change.
    """
    if not isinstance(tool_names, (list, tuple)):
        raise TypeError("tool_names must be a list")
    names = []
    for n in tool_names:
        if not isinstance(n, str) or not n:
            raise ValueError("tool name must be a non-empty string")
        names.append(n)
    if len(set(names)) != len(names):
        raise ValueError("duplicate tool names: the declared surface is malformed")
    return _h(("\x00".join(sorted(names))).encode("utf-8"))


def derive_tool(salt_hex: str, endpoint: str, window_id: str, tool_names):
    """
    Which tool gets measured. Chosen over the SORTED set, so the server cannot
    steer the pick by reordering its own tools/list. Returns None when there is
    nothing to choose from: unmeasured, never failed.
    """
    names = sorted(tool_names)
    if not names:
        return None
    tool_set_digest(names)          # raises on duplicates or bad types
    d = _prf(salt_hex, SCHEMA, "tool", endpoint, window_id)
    return names[int.from_bytes(d[:8], "big") % len(names)]


def build_derivation(salt_hex, endpoint, window_id, tool_names, anchor):
    """
    The block bound into the verdict. Every field here is an OUTPUT derived by
    the measurer, never an input supplied by the subject.

    `anchor` describes where the salt commitment was anchored:
        {"commit_height": int, "window_open_height": int, "block_hash": str}
    """
    for k in ("commit_height", "window_open_height", "block_hash"):
        if k not in anchor:
            raise ValueError("anchor is missing %s" % k)
    if not isinstance(anchor["commit_height"], int) or not isinstance(anchor["window_open_height"], int):
        raise ValueError("anchor heights must be integers")
    if anchor["commit_height"] >= anchor["window_open_height"]:
        raise ValueError(
            "commitment must be anchored below the window's opening height; "
            "a commitment made after the window opened proves nothing")
    names = sorted(tool_names)
    return {
        "schema": SCHEMA,
        "endpoint": endpoint,
        "window_id": window_id,
        "salt_commitment": salt_commitment(salt_hex),
        "anchor": dict(anchor),
        "instant_slot": derive_instant(salt_hex, endpoint, window_id),
        "slots_per_window": SLOTS_PER_WINDOW,
        "tool_set_sha256": tool_set_digest(names) if names else None,
        "tool_count": len(names),
        "tool_measured": derive_tool(salt_hex, endpoint, window_id, names),
        "rule": ("instant and tool are HMAC-SHA256 derived from a salt committed and anchored "
                 "before the window opened. The subject cannot predict them; the measurer cannot "
                 "choose them after the fact. Recompute with the revealed salt."),
        "limits": ("Derivation is fair only within the surface the subject declared. A tool never "
                   "listed is never picked. That set is unknown, not absent."),
    }


def verify_derivation(derivation, revealed_salt_hex, tool_names_seen):
    """
    Third-party check. Returns (ok, reasons). Recomputes everything from the
    revealed salt; trusts nothing the measurer asserted.
    """
    reasons = []
    if not isinstance(derivation, dict):
        return False, ["derivation is not an object"]
    if derivation.get("schema") != SCHEMA:
        return False, ["wrong schema"]
    for k in ("endpoint", "window_id", "salt_commitment", "anchor", "instant_slot"):
        if k not in derivation:
            return False, ["missing field %s" % k]

    try:
        if salt_commitment(revealed_salt_hex) != derivation["salt_commitment"]:
            reasons.append("revealed salt does not match the anchored commitment")
    except (TypeError, ValueError) as e:
        return False, ["revealed salt is unusable: %s" % e]

    a = derivation["anchor"]
    if not isinstance(a, dict) or "commit_height" not in a or "window_open_height" not in a:
        reasons.append("anchor is malformed")
    elif a["commit_height"] >= a["window_open_height"]:
        reasons.append("commitment was anchored at or after the window opened")

    ep, wid = derivation["endpoint"], derivation["window_id"]
    if derive_instant(revealed_salt_hex, ep, wid) != derivation["instant_slot"]:
        reasons.append("instant_slot does not recompute")

    seen = sorted(tool_names_seen or [])
    if seen:
        try:
            if tool_set_digest(seen) != derivation.get("tool_set_sha256"):
                reasons.append("tool_set_sha256 does not match the surface observed now "
                               "(a surface change, not necessarily a lie)")
        except ValueError as e:
            reasons.append("observed surface is malformed: %s" % e)
        if derive_tool(revealed_salt_hex, ep, wid, seen) != derivation.get("tool_measured"):
            reasons.append("tool_measured does not recompute against the observed surface")
    else:
        if derivation.get("tool_measured") is not None:
            reasons.append("a tool is named but no surface was observed")

    return (len(reasons) == 0), reasons


if __name__ == "__main__":
    salt = "11" * 32
    d = build_derivation(
        salt, "https://example.test/mcp", "2026-09",
        ["b_write", "a_read", "c_delete"],
        {"commit_height": 900000, "window_open_height": 900144, "block_hash": "00" * 32},
    )
    print(json.dumps(d, indent=2, ensure_ascii=False))
    ok, why = verify_derivation(d, salt, ["c_delete", "a_read", "b_write"])
    print("verify:", ok, why)
