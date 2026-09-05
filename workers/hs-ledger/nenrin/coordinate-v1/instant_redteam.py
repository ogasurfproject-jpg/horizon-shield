#!/usr/bin/env python3
"""
Adversary for nenrin-instant-v1. Offline, deterministic, no network.

Run: python3 instant_redteam.py
"""

import hashlib
from instant_coordinate import (
    SLOTS_PER_WINDOW, build_derivation, derive_instant, derive_tool,
    salt_commitment, tool_set_digest, verify_derivation,
)

RESULTS = []


def case(kind, name, ok, detail=""):
    RESULTS.append((kind, name, bool(ok), detail))


SALT = "a1" * 32
OTHER = "b2" * 32
EP = "https://target.test/mcp"
WIN = "2026-09"
TOOLS = ["read_thing", "delete_thing", "move_money", "list_things"]
ANCHOR = {"commit_height": 900000, "window_open_height": 900144, "block_hash": "ab" * 32}

honest = build_derivation(SALT, EP, WIN, TOOLS, ANCHOR)

# --- control: the honest article verifies ------------------------------------
ok, why = verify_derivation(honest, SALT, TOOLS)
case("control", "honest derivation recomputes for a third party", ok, str(why))

# --- control: reordering tools/list does not move the pick --------------------
ok, why = verify_derivation(honest, SALT, list(reversed(TOOLS)))
case("control", "server reorders tools/list, derived tool is unchanged", ok, str(why))

# --- residual + control: the OLD schedule is computable by the target ---------
def old_bucket(endpoint, interval=7):
    return int(hashlib.sha256(endpoint.encode()).hexdigest()[:4], 16) % interval

b1, b2 = old_bucket(EP), old_bucket(EP)
case("residual", "old rule: target computes its own measurement day (1 of 7)",
     b1 == b2 and 0 <= b1 < 7, "bucket=%d, so a shim needs to answer 1 day in 7" % b1)

# --- attack: target cannot predict the new instant without the salt -----------
# The target's best strategy without the salt is a fixed guess. Measure how often
# a fixed guess lands, across many windows.
hits = 0
TRIALS = 2000
GUESS = 0
for i in range(TRIALS):
    if derive_instant(SALT, EP, "w%05d" % i) == GUESS:
        hits += 1
expected = TRIALS / SLOTS_PER_WINDOW
case("attack", "target guessing without the salt lands at chance, not better",
     hits <= expected * 6 + 3,
     "%d/%d hits, chance is about %.2f" % (hits, TRIALS, expected))

# --- control: secrecy of the salt is load-bearing, not decoration -------------
case("control", "holding the salt makes prediction exact (so secrecy is the whole defence)",
     derive_instant(SALT, EP, WIN) == honest["instant_slot"], "")

# --- attack: measurer reveals a different salt than it committed --------------
ok, why = verify_derivation(honest, OTHER, TOOLS)
case("attack", "measurer reveals a salt other than the one it anchored",
     (not ok) and any("commitment" in r for r in why), str(why))

# --- attack: measurer picks a friendlier slot after the fact ------------------
tampered = dict(honest)
tampered["instant_slot"] = (honest["instant_slot"] + 1) % SLOTS_PER_WINDOW
ok, why = verify_derivation(tampered, SALT, TOOLS)
case("attack", "measurer edits instant_slot after measuring",
     (not ok) and any("instant_slot" in r for r in why), str(why))

# --- attack: measurer names a friendlier tool after the fact -----------------
tampered2 = dict(honest)
victim = [t for t in TOOLS if t != honest["tool_measured"]][0]
tampered2["tool_measured"] = victim
ok, why = verify_derivation(tampered2, SALT, TOOLS)
case("attack", "measurer swaps tool_measured for an easier one",
     (not ok) and any("tool_measured" in r for r in why), str(why))

# --- attack: commitment anchored at or after the window opened ---------------
refused = False
try:
    build_derivation(SALT, EP, WIN, TOOLS,
                     {"commit_height": 900144, "window_open_height": 900144, "block_hash": "00" * 32})
except ValueError:
    refused = True
late = dict(honest)
late["anchor"] = {"commit_height": 900200, "window_open_height": 900144, "block_hash": "00" * 32}
ok, why = verify_derivation(late, SALT, TOOLS)
case("attack", "commitment anchored after the window opened is refused both ways",
     refused and (not ok) and any("window opened" in r for r in why), str(why))

# --- attack: server renames a tool to steer the pick ------------------------
renamed = ["read_thing", "delete_thing", "move_money", "aaa_safe_thing"]
ok, why = verify_derivation(honest, SALT, renamed)
case("attack", "server renames a tool to steer the pick, the surface change surfaces",
     (not ok) and any("tool_set_sha256" in r or "surface" in r for r in why), str(why))

# --- attack: duplicate tool names --------------------------------------------
dup = False
try:
    tool_set_digest(["a", "a", "b"])
except ValueError:
    dup = True
case("attack", "duplicate tool names are refused, not silently deduplicated", dup, "")

# --- attack: salt reused in a later window after it was revealed -------------
# Once revealed, a reused salt lets anyone predict the next window exactly.
predicted = derive_instant(SALT, EP, "2026-10")
reused = build_derivation(SALT, EP, "2026-10", TOOLS,
                          {"commit_height": 901000, "window_open_height": 901144, "block_hash": "cd" * 32})
case("attack", "a revealed salt reused in a later window is fully predictable",
     predicted == reused["instant_slot"],
     "salts MUST be single use per window; this vector is the proof, not a pass")

# --- misclass: no tools declared is unmeasured, never failed ------------------
empty = build_derivation(SALT, EP, WIN, [], ANCHOR)
ok, why = verify_derivation(empty, SALT, [])
case("misclass", "no declared surface: tool is None, and that is not a failure",
     ok and empty["tool_measured"] is None and empty["tool_set_sha256"] is None, str(why))

# --- attack: a tool is named though nothing was observed ---------------------
ghost = dict(empty)
ghost["tool_measured"] = "read_thing"
ok, why = verify_derivation(ghost, SALT, [])
case("attack", "a tool is named while no surface was observed", not ok, str(why))

# --- attack: unusable salt ----------------------------------------------------
bad = 0
for s in ["zz" * 32, "a1" * 16, 12345, None]:
    try:
        salt_commitment(s)
    except (TypeError, ValueError):
        bad += 1
case("attack", "malformed salts are refused (bad hex, wrong length, wrong type)", bad == 4, "")

# --- attack: verdict with no derivation block at all -------------------------
ok, why = verify_derivation({"schema": "nenrin-instant-v1", "endpoint": EP}, SALT, TOOLS)
case("attack", "a verdict missing its derivation fields is unverifiable, not trusted", not ok, str(why))

# --- residual, named not solved ----------------------------------------------
never_declared = derive_tool(SALT, EP, WIN, TOOLS)
case("residual", "a tool the subject never declared is never picked",
     never_declared in TOOLS,
     "derivation is fair only inside the declared surface. That set is unknown, not absent.")

# --- report -------------------------------------------------------------------
kinds = {}
for kind, _n, ok, _d in RESULTS:
    a, b = kinds.get(kind, (0, 0))
    kinds[kind] = (a + (1 if ok else 0), b + 1)

print("--- 種別 ---")
for k in ("attack", "control", "misclass", "residual"):
    if k in kinds:
        print("  %-10s %d / %d" % (k, kinds[k][0], kinds[k][1]))
print()
for kind, n, ok, d in RESULTS:
    if not ok:
        print("  NG  [%s] %s\n      %s" % (kind, n, d))
passed = sum(1 for _k, _n, ok, _d in RESULTS if ok)
print("=== %d / %d 合格 (nenrin-instant-v1) ===" % (passed, len(RESULTS)))
if passed == len(RESULTS):
    print("測る時刻も測る対象も、測られる側が選べず、測る側も後から選べん。")
raise SystemExit(0 if passed == len(RESULTS) else 1)
