"""Re-measure the interop matrix and the a2a-card-sign-v01 corpus against whatever SDK versions are installed now,
and say what moved since the frozen run of 2026-10-01.

Run after matrix.py (which writes out/results.json for the installed versions):
    python3 watch.py            writes out/watch_report.md and out/watch_state.json

What it reports:
  1. the versions measured (a2a-sdk, @a2a-js/sdk, a2a-go commit)
  2. every matrix cell that differs from results_20261001.json, and the section 8.4.1 example per SDK
  3. for the signed corpus, which reading each SDK's verifier follows today: the set of vectors an SDK accepts is
     compared with the set each reading accepts (rule-1-as-written, prune-empty, served-as-is); "none" means the
     SDK follows no single reading on these cards.
     2026-10-13: the headline is measured on s0 and s1 only, the groups the 2026-10-01 baseline had. From 2026-10-02
     the corpus also carries s2 to s4, whose vectors list readings of other axes (unknown fields, dual names), so a
     comparison over the whole corpus matched no reading and the watch reported "none" for every SDK from then on.
     Each group is now also classified on its own, against the readings that group's vectors list
  4. each pair in matrix.PAIRS (2026-11-17): per SDK, whether the two cards canonicalize to the same bytes and whether
     the declaration survives. Then which signer/verifier pairs accept a signature made over the other card. Pairs
     are not in results_20261001.json, so they are printed as measured and never counted as moved cells.
It decides nothing about which reading is right; that is a2aproject/A2A#2122.
"""
import hashlib
import json
import os

import matrix as m

HERE = m.HERE
CORPUS = os.path.join(HERE, "vectors", "a2a-card-sign-v01")
BASELINE = os.path.join(HERE, "results_20261001.json")
READINGS = ["rule-1-as-written", "prune-empty", "served-as-is"]
SDKS = ["python", "js", "go"]
LABEL = {"python": "a2a-python", "js": "a2a-js", "go": "a2a-go"}


def observe_corpus():
    man = json.load(open(os.path.join(CORPUS, "MANIFEST.json"), encoding="utf-8"))
    jwksp = os.path.join(CORPUS, "testkey_jwks.json")
    jwks = json.load(open(jwksp))
    rows = []
    for v in man["vectors"]:
        doc = json.load(open(os.path.join(CORPUS, v["path"]), encoding="utf-8"))
        sp = os.path.join(HERE, "out", "watch-" + doc["id"] + ".json")
        json.dump(doc["served_card"], open(sp, "w"), separators=(",", ":"), ensure_ascii=False)
        got = {
            "python": bool(m.py_verify(doc["served_card"], jwks).get("ok")),
            "js": bool(m.run(["node", "js_tool.mjs", "verify", sp, jwksp]).get("ok")),
            "go": bool(m.run([m.GO_BIN, "verify", sp, jwksp]).get("ok")),
        }
        rows.append({"id": doc["id"], "group": v["path"].split("/")[0], "accept_under": doc["accept_under"], "observed": got})
    return rows


HEADLINE_GROUPS = ("s0-control", "s1-default-valued")


def reading_of(rows, sdk, readings=READINGS):
    accepted = {r["id"] for r in rows if r["observed"][sdk]}
    hits = [rd for rd in readings if accepted == {r["id"] for r in rows if rd in r["accept_under"]}]
    return hits[0] if hits else "none"


def readings_by_group(rows):
    """{group: {sdk: [every reading listed in that group whose accepted set equals the SDK's]}}; [] means none."""
    out = {}
    for g in sorted({r["group"] for r in rows}):
        sub = [r for r in rows if r["group"] == g]
        labels = sorted({l for r in sub for l in r["accept_under"]})
        out[g] = {}
        for s in SDKS:
            acc = {r["id"] for r in sub if r["observed"][s]}
            out[g][s] = [l for l in labels if acc == {r["id"] for r in sub if l in r["accept_under"]}]
    return out


def main():
    res = json.load(open(os.path.join(HERE, "out", "results.json"), encoding="utf-8"))
    base = json.load(open(BASELINE, encoding="utf-8"))
    mark = lambda c: "pass" if c.get("ok") is True else ("n/a" if c.get("ok") is None else "FAIL")
    bcells = {r["case"]: r["cells"] for r in base["rows"]}
    changes = []
    for r in res["rows"]:
        for k, c in r["cells"].items():
            old = bcells.get(r["case"], {}).get(k)
            if old is None or mark(old) != mark(c):
                changes.append((r["case"], k, mark(old) if old else "-", mark(c)))
    rows = observe_corpus()
    head = [r for r in rows if r["group"] in HEADLINE_GROUPS]
    readings = {s: reading_of(head, s) for s in SDKS}
    by_group = readings_by_group(rows)
    base_readings = {"python": "prune-empty", "js": "prune-empty", "go": "served-as-is"}
    state = {
        "schema": "hs-interop-watch-v0",
        "versions": res["versions"],
        "matrix_sha256": hashlib.sha256(json.dumps([[r["case"], {k: mark(c) for k, c in sorted(r["cells"].items())}] for r in res["rows"]], sort_keys=True).encode()).hexdigest(),
        "spec_8_4_1_example": res["spec_8_4_1_example"]["matches"],
        "corpus_readings": readings,
        "corpus_readings_scope": "s0-control and s1-default-valued",
        "corpus_readings_by_group": by_group,
        "frozen_production_card": {s: mark(res["frozen_production_card"][s]) for s in SDKS},
        "pairs": {p["pair"]: {"same_bytes": {s: p["canonical"][s]["same_bytes"] for s in SDKS},
                              "declaration_kept": {s: p["canonical"][s]["declaration_kept"] for s in SDKS},
                              "declared_card": {k: mark(c) for k, c in sorted(p["cells"].items())},
                              "declared_sig_on_undeclared": {k: mark(c) for k, c in sorted(p["declared_sig_on_undeclared"].items())},
                              "undeclared_sig_on_declared": {k: mark(c) for k, c in sorted(p["undeclared_sig_on_declared"].items())}}
                  for p in res.get("pairs", [])},
    }
    lines = ["### Interop matrix re-measured", "",
             "| SDK | version |", "|---|---|"]
    for s, key in (("python", "a2a-python"), ("js", "a2a-js"), ("go", "a2a-go")):
        lines.append("| %s | %s |" % (LABEL[s], res["versions"][key]))
    lines += ["", "**Matrix cells that moved since 2026-10-01:** " + ("none" if not changes else str(len(changes))), ""]
    if changes:
        lines += ["| case | signer > verifier | 2026-10-01 | now |", "|---|---|---|---|"]
        lines += ["| `%s` | %s | %s | %s |" % (c, k.replace(">", " > "), a, b) for c, k, a, b in changes]
        lines.append("")
    lines += ["**Section 8.4.1 worked example reproduced:** " + ", ".join("%s %s" % (LABEL[s], "yes" if res["spec_8_4_1_example"]["matches"][s] else "no") for s in SDKS), ""]
    lines += ["**Frozen production card (JS-signed, 2026-09-28):** " + ", ".join("%s %s" % (LABEL[s], state["frozen_production_card"][s]) for s in SDKS), ""]
    took = lambda c: "accepts" if c.get("ok") is True else ("n/a" if c.get("ok") is None else "rejects")
    yn = lambda b: "n/a" if b is None else ("yes" if b else "no")
    for p in res.get("pairs", []):
        lines += ["**Pair `%s`** (%s; not in the 2026-10-01 run, so shown as measured, not as moved):" % (p["pair"], p["what"]), "",
                  "| SDK | declared card, canonical bytes | `%s`, canonical bytes | same bytes | declaration in canonical form |" % p["undeclared_case"], "|---|---|---|---|---|"]
        for s in SDKS:
            c = p["canonical"][s]
            lines.append("| %s | %s, sha256 `%s` | %s, sha256 `%s` | %s | %s |" % (LABEL[s], c["declared"]["len"], (c["declared"]["sha256"] or "")[:16], c["undeclared"]["len"],
                         (c["undeclared"]["sha256"] or "")[:16], yn(c["same_bytes"]), "n/a" if c["declaration_kept"] is None else ("kept" if c["declaration_kept"] else "removed")))
        lines += ["", "| served card, signature | " + " | ".join("%s signs, %s verifies" % (s, v) for s in SDKS for v in SDKS) + " |", "|---|" + "---|" * 9,
                  "| declared card, signature over it | " + " | ".join(mark(p["cells"][s + ">" + v]) for s in SDKS for v in SDKS) + " |",
                  "| `%s`, signature over the declared card | " % p["undeclared_case"] + " | ".join(took(p["declared_sig_on_undeclared"][s + ">" + v]) for s in SDKS for v in SDKS) + " |",
                  "| declared card, signature over `%s` | " % p["undeclared_case"] + " | ".join(took(p["undeclared_sig_on_declared"][s + ">" + v]) for s in SDKS for v in SDKS) + " |", ""]
    lines += ["**Which reading each verifier follows on the signed corpus (a2a-card-sign-v01, a2aproject/a2a-tck#246), groups s0 and s1, the groups the 2026-10-01 run had:**", "",
              "| SDK | today | 2026-10-01 |", "|---|---|---|"]
    lines += ["| %s | %s | %s |" % (LABEL[s], readings[s], base_readings[s]) for s in SDKS]
    lines += ["", "**Each group on its own** (every reading that group's vectors list whose accepted set equals the verifier's; none means no single reading):", "",
              "| group | " + " | ".join(LABEL[s] for s in SDKS) + " |", "|---|" + "---|" * len(SDKS)]
    lines += ["| %s | %s |" % (g, " | ".join(", ".join("`%s`" % x for x in by_group[g][s]) or "none" for s in SDKS)) for g in by_group]
    lines += ["", "Readings: `rule-1-as-written` is section 8.4.1 rule 1 on the served card; `prune-empty` removes empty values recursively; `served-as-is` removes only `signatures`. Which one is normative is a2aproject/A2A#2122; this run decides nothing about it.",
              "", "<!-- watch-state " + json.dumps(state, sort_keys=True) + " -->"]
    open(os.path.join(HERE, "out", "watch_report.md"), "w").write("\n".join(lines) + "\n")
    json.dump(state, open(os.path.join(HERE, "out", "watch_state.json"), "w"), indent=2, sort_keys=True)
    print("\n".join(lines))


if __name__ == "__main__":
    main()
