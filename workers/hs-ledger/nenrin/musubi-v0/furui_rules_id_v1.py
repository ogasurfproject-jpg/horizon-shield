#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
furui-rules-id-v1: one name for the content check a relying party says it ran, in the arrangement of FURUI A7.4
(2026-11-01). furui-rules-id-v0 (furui_rules_id_v0.py) is unchanged and still names the checks it named.

A7.4 asks four questions, some once per scope and some in two stages, and decides with a fixed count and a fixed quote
check. "The same check" therefore means more than v0 wrote down: the rule files, the four questions, the code that
builds the text sent to the model (with its output schemas), the call arguments (max_tokens, the model keywords, the
effort, the timeout and the retry rule), the seven stages, the count and its version, the quote check and the Unicode
version it normalises with, and the implementations that were shown to give the measured decisions. This file writes
those down as one object and names it by one digest:

    rules_sha256 = sha256(musubi-canonical-v0 bytes of the object)

The object, with every key required and no other key allowed:

    {"id": "furui-rules-id-v1",
     "version": "A7.4",
     "questions":   [{"name": "q1_v2", "sha256": ..}, ..],               sha256 of each question's UTF-8 text, sorted by name, at least one
     "rule_files":  [{"name": "a6_rules.py", "sha256": ..}, ..],         sorted by name, at least one
     "prompt_builder": {"name": .., "sha256": .., "pin_sha256": ..},     the file that builds the text sent, and the digest of what it pins
     "call": {"max_tokens": {model: int}, "kw": {model: {..}}, "effort": str, "temperature": null | int,
              "timeout_s": int, "retry": {"transport_retries": int, "other_retries": int, "wait_s": str, "transport": str}},
     "stages": [{"n": 1, "kind": "rules"},
                {"n": 2, "kind": "model", "question": "q1_v2", "model": "claude-haiku-5-5"}, ..],
     "arrangement": "a7-q1-q21-q22",
     "count": {"name": "a7_count.py", "ver": "v5", "sha256": ..},
     "quote_check": {"name": "quote_check.py", "sha256": .., "unicode": "16.0.0"},
     "implementations": [{"name": .., "sha256": ..}, ..]}                 sorted by name, may be empty

The arrangement a7-q1-q21-q22 fixes the shape of the seven stages (kind, question role, when, per), as the plan of
FURUI blind-06 (ledger entry 231) states them; the question names are the ones in "questions".

A relying party's door compares rules_sha256 for equality only (policy.furui.rules_sha256, the admission's
content.rules_sha256, a contract's requirements.furui.rules_sha256). The digest names what the party says it used. It
does not make a model answer the same way twice, and the rates a blind test measured hold for the scopes it measured.

  python3 furui_rules_id_v1.py --selftest
  python3 furui_rules_id_v1.py --id ID.json            prints rules_sha256, or the problems
"""
import hashlib, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from contract_v0 import canonical

ID = "furui-rules-id-v1"
KEYS = ("arrangement", "call", "count", "id", "implementations", "prompt_builder", "questions", "quote_check", "rule_files", "stages", "version")
# (kind, question index in the sorted questions or None, when, per) for each stage
ARRANGEMENTS = {
    "a7-q1-q21-q22": [("rules", None, None, None), ("model", "q1", None, None), ("model", "q1", "stage_2_not_none", None),
                      ("model", "q21", None, "scope"), ("model", "q21b", None, "scope"),
                      ("model", "q22", "scope_has_verified_limit", None), ("model", "q22", "stage_6_not_all_no", None)],
}
ROLES = {"a7-q1-q21-q22": {"q1": "q1_v2", "q21": "q2_1_v4", "q21b": "q2_1b", "q22": "q2_2_v4"}}
CALL_KEYS = ("effort", "kw", "max_tokens", "retry", "temperature", "timeout_s")
RETRY_KEYS = ("other_retries", "transport", "transport_retries", "wait_s")
HEX64 = re.compile(r"\A[0-9a-f]{64}\Z")
NAME = re.compile(r"\A[\x21-\x7e][\x20-\x7e]{0,127}\Z")
VERSION = re.compile(r"\A[\x21-\x7e]{1,64}\Z")


def _is_int(x):
    return isinstance(x, int) and not isinstance(x, bool)


def _named(xs, where, empty_ok):
    if not isinstance(xs, list) or (not xs and not empty_ok):
        return ["%s_malformed" % where]
    for x in xs:
        if not (isinstance(x, dict) and sorted(x) == ["name", "sha256"] and isinstance(x["name"], str) and NAME.match(x["name"])
                and isinstance(x["sha256"], str) and HEX64.match(x["sha256"])):
            return ["%s_malformed" % where]
    names = [x["name"] for x in xs]
    return [] if names == sorted(set(names)) else ["%s_not_sorted_unique" % where]


def _obj(x, keys, checks):
    return isinstance(x, dict) and sorted(x) == sorted(keys) and all(f(x[k]) for k, f in checks.items())


def _call_ok(c, models):
    s = lambda v: isinstance(v, str) and 0 < len(v) <= 400
    if not _obj(c, CALL_KEYS, {"effort": s, "temperature": lambda v: v is None or (_is_int(v) and 0 <= v <= 1), "timeout_s": lambda v: _is_int(v) and v > 0,
                               "retry": lambda r: _obj(r, RETRY_KEYS, {"other_retries": lambda v: _is_int(v) and v >= 0, "transport_retries": lambda v: _is_int(v) and v >= 0,
                                                                        "wait_s": s, "transport": s}),
                               "max_tokens": lambda m: isinstance(m, dict) and all(_is_int(v) and v > 0 for v in m.values()),
                               "kw": lambda m: isinstance(m, dict) and all(isinstance(v, dict) for v in m.values())}):
        return False
    return models is None or (set(c["max_tokens"]) == set(models) and set(c["kw"]) == set(models))


def problems(obj):
    """[] when obj is a well formed furui-rules-id-v1 object; otherwise the codes, in a fixed order."""
    if not isinstance(obj, dict):
        return ["not_an_object"]
    if sorted(obj) != list(KEYS):
        return ["keys_not_exact"]
    p = []
    if obj["id"] != ID:
        p.append("id_unknown")
    if not (isinstance(obj["version"], str) and VERSION.match(obj["version"])):
        p.append("version_malformed")
    p += _named(obj["questions"], "questions", False)
    p += _named(obj["rule_files"], "rule_files", False)
    p += _named(obj["implementations"], "implementations", True)
    hexs = lambda v: isinstance(v, str) and bool(HEX64.match(v))
    nm = lambda v: isinstance(v, str) and bool(NAME.match(v))
    if not _obj(obj["prompt_builder"], ("name", "pin_sha256", "sha256"), {"name": nm, "pin_sha256": hexs, "sha256": hexs}):
        p.append("prompt_builder_malformed")
    if not _obj(obj["count"], ("name", "sha256", "ver"), {"name": nm, "sha256": hexs, "ver": lambda v: isinstance(v, str) and bool(VERSION.match(v))}):
        p.append("count_malformed")
    if not _obj(obj["quote_check"], ("name", "sha256", "unicode"), {"name": nm, "sha256": hexs, "unicode": lambda v: isinstance(v, str) and bool(VERSION.match(v))}):
        p.append("quote_check_malformed")
    st, shape, models = obj["stages"], None, []
    if not isinstance(st, list) or not st:
        p.append("stages_malformed")
    else:
        shape = []
        for i, s in enumerate(st):
            ok = isinstance(s, dict) and _is_int(s.get("n")) and s["n"] == i + 1 and s.get("kind") in ("rules", "model")
            if ok:
                allowed = {"n", "kind"} | ({"question", "model", "when", "per"} if s["kind"] == "model" else set())
                ok = not (set(s) - allowed) and (s["kind"] == "rules" or (nm(s.get("model")) and nm(s.get("question")))) \
                    and ("when" not in s or isinstance(s["when"], str)) and ("per" not in s or isinstance(s["per"], str))
            if not ok:
                p.append("stages_malformed"); shape = None; break
            shape.append((s["kind"], s.get("question"), s.get("when"), s.get("per")))
            if s["kind"] == "model" and s["model"] not in models:
                models.append(s["model"])
    if obj["arrangement"] not in ARRANGEMENTS:
        p.append("arrangement_unknown")
    elif shape is not None:
        roles = ROLES[obj["arrangement"]]
        want = [(k, roles[q] if q else None, w, per) for k, q, w, per in ARRANGEMENTS[obj["arrangement"]]]
        if shape != want:
            p.append("stages_not_the_arrangement")
        elif isinstance(obj["questions"], list) and not _named(obj["questions"], "questions", False) \
                and sorted(set(roles.values())) != [x["name"] for x in obj["questions"]]:
            p.append("questions_not_the_stages")
    if not _call_ok(obj["call"], models if shape is not None else None):
        p.append("call_malformed")
    return p


def rules_sha256(obj):
    """The digest of a well formed object. Raises ValueError with the problems otherwise."""
    p = problems(obj)
    if p:
        raise ValueError(", ".join(p))
    return hashlib.sha256(canonical(obj).encode("utf-8")).hexdigest()


def build(version, questions, rule_files, prompt_builder, call, models, count, quote_check, implementations, arrangement="a7-q1-q21-q22"):
    """questions {name: text}, rule_files {name: bytes}, prompt_builder {"name", "bytes", "pin_sha256"}, models {"haiku": .., "opus": ..},
    count {"name", "ver", "bytes"}, quote_check {"name", "bytes", "unicode"}, implementations {name: bytes}."""
    H = lambda b: hashlib.sha256(b).hexdigest()
    roles = ROLES[arrangement]; hk, op = models["haiku"], models["opus"]
    mdl = [None, hk, op, op, op, hk, op]
    stages = []
    for i, (kind, q, when, per) in enumerate(ARRANGEMENTS[arrangement]):
        s = {"n": i + 1, "kind": kind}
        if kind == "model":
            s.update(question=roles[q], model=mdl[i])
            if when: s["when"] = when
            if per: s["per"] = per
        stages.append(s)
    return {"id": ID, "version": version,
            "questions": [{"name": n, "sha256": H(t.encode("utf-8"))} for n, t in sorted(questions.items())],
            "rule_files": [{"name": n, "sha256": H(b)} for n, b in sorted(rule_files.items())],
            "prompt_builder": {"name": prompt_builder["name"], "sha256": H(prompt_builder["bytes"]), "pin_sha256": prompt_builder["pin_sha256"]},
            "call": call, "stages": stages, "arrangement": arrangement,
            "count": {"name": count["name"], "ver": count["ver"], "sha256": H(count["bytes"])},
            "quote_check": {"name": quote_check["name"], "sha256": H(quote_check["bytes"]), "unicode": quote_check["unicode"]},
            "implementations": [{"name": n, "sha256": H(b)} for n, b in sorted(implementations.items())]}


EXAMPLE_CALL = {"max_tokens": {"claude-haiku-5-5": 400, "claude-opus-5-5": 4000},
                "kw": {"claude-haiku-5-5": {"thinking": {"type": "disabled"}}, "claude-opus-5-5": {}},
                "effort": "low", "temperature": None, "timeout_s": 180,
                "retry": {"transport_retries": 8, "other_retries": 3, "wait_s": "min(2 ** (i + 1), 60)",
                          "transport": "status 429 or 500..599, or a transport exception"}}


def example():
    """A fixed example in the A7.4 shape. The bytes are stand-ins, not the real rule files or questions, which are not public."""
    return build("example-a7", {"q1_v2": "Example q1.", "q2_1_v4": "Example q2-1.", "q2_1b": "Example q2-1b.", "q2_2_v4": "Example q2-2."},
                 {"sieve_v0.py": b"example sieve", "a6_rules.py": b"example a6"},
                 {"name": "a74_prompt_v1.py", "bytes": b"example builder", "pin_sha256": "ab" * 32}, json.loads(json.dumps(EXAMPLE_CALL)),
                 {"haiku": "claude-haiku-5-5", "opus": "claude-opus-5-5"}, {"name": "a7_count.py", "ver": "v5", "bytes": b"example count"},
                 {"name": "quote_check.py", "bytes": b"example qc", "unicode": "16.0.0"}, {"a74_decide_v1.mjs": b"example decide"})


def mutants():
    e = example()
    def m(**kw):
        x = json.loads(json.dumps(e)); x.update(kw); return x
    st = e["stages"]
    def call(**kw):
        c = json.loads(json.dumps(e["call"])); c.update(kw); return m(call=c)
    return [
        ("extra key", dict(e, note="x"), ["keys_not_exact"]),
        ("id v0", m(id="furui-rules-id-v0"), ["id_unknown"]),
        ("version empty", m(version=""), ["version_malformed"]),
        ("questions unsorted", m(questions=list(reversed(e["questions"]))), ["questions_not_sorted_unique"]),
        ("a question missing", m(questions=e["questions"][:3]), ["questions_not_the_stages"]),
        ("rule files empty", m(rule_files=[]), ["rule_files_malformed"]),
        ("implementations empty", m(implementations=[]), []),
        ("prompt builder without pin", m(prompt_builder={"name": "x", "sha256": "ab" * 32}), ["prompt_builder_malformed"]),
        ("count without ver", m(count={"name": "a7_count.py", "sha256": "ab" * 32}), ["count_malformed"]),
        ("quote check without unicode", m(quote_check={"name": "q", "sha256": "ab" * 32}), ["quote_check_malformed"]),
        ("stage 3 without when", m(stages=[dict((k, v) for k, v in s.items() if not (s["n"] == 3 and k == "when")) for s in st]), ["stages_not_the_arrangement"]),
        ("stage 4 not per scope", m(stages=[dict((k, v) for k, v in s.items() if not (s["n"] == 4 and k == "per")) for s in st]), ["stages_not_the_arrangement"]),
        ("stages numbered from 0", m(stages=[dict(s, n=s["n"] - 1) for s in st]), ["stages_malformed"]),
        ("arrangement unknown", m(arrangement="rules-haiku-opus_on_flag"), ["arrangement_unknown"]),
        ("temperature a float", call(temperature=0.5), ["call_malformed"]),
        ("max_tokens for another model", call(max_tokens={"claude-haiku-5-5": 400}), ["call_malformed"]),
        ("retry without wait", call(retry={"transport_retries": 8, "other_retries": 3, "transport": "x"}), ["call_malformed"]),
        ("not an object", [e], ["not_an_object"]),
    ]


def _selftest():
    n = 0
    e = example()
    assert problems(e) == [], problems(e)
    h = rules_sha256(e)
    assert h == rules_sha256(dict(reversed(list(e.items()))))
    n += 1; print("[1] the example is well formed; rules_sha256 %s does not depend on the order keys were written in" % h)
    ms = [x for x in mutants() if x[0] != "temperature a float"]
    for label, x, want in ms:
        assert problems(x) == want, (label, problems(x), want)
    n += 1; print("[2] %d objects that break one rule each give their code" % sum(1 for _, _, w in ms if w))
    other = json.loads(json.dumps(e)); other["call"]["max_tokens"]["claude-opus-5-5"] = 2000
    assert problems(other) == [] and rules_sha256(other) != h
    other2 = json.loads(json.dumps(e)); other2["prompt_builder"]["pin_sha256"] = "cd" * 32
    assert problems(other2) == [] and rules_sha256(other2) != h
    n += 1; print("[3] another max_tokens, or another prompt builder pin, is another check (another digest)")
    r = subprocess.run(["node", os.path.join(HERE, "furui_rules_id_v1.mjs"), "--batch"], input=json.dumps([e] + [x for _, x, _ in ms]), capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[-400:]
    js = json.loads(r.stdout)
    py = [{"problems": problems(x), "rules_sha256": rules_sha256(x) if not problems(x) else None} for x in [e] + [x for _, x, _ in ms]]
    assert js == py, [(i, a, b) for i, (a, b) in enumerate(zip(js, py)) if a != b]
    n += 1; print("[4] furui_rules_id_v1.mjs gives the same codes and the same digest on all %d objects" % len(py))
    print("\nSELF-TEST PASSED: furui-rules-id-v1, %d checks (one object, one digest; closed keys, the A7.4 arrangement, the call; the twin agrees)" % n)


def main():
    a = sys.argv[1:]
    if a == ["--selftest"]:
        _selftest(); return 0
    if len(a) == 2 and a[0] == "--id":
        obj = json.loads(open(a[1], encoding="utf-8").read())
        p = problems(obj)
        print(json.dumps({"problems": p}) if p else rules_sha256(obj))
        return 1 if p else 0
    print(__doc__); return 1


if __name__ == "__main__":
    sys.exit(main())
