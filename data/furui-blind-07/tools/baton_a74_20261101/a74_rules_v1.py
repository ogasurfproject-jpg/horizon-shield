#!/usr/bin/env python3
# A7.4 の規則の段を 1 つの入口にまとめた物(DESIGN_BATON_A74_v1 の F4 と G4)。書いた者 番人(Team) の作業役 2026-11-01、照らすのは番人(個人)。
# 呼ばない、網に出ない。本文と範囲の文は画面にも結果にも出さない。
# blind-06 と作りの側で使った規則の組を、build_a7.py(4f09260f)の rule_mods と run_blind06.py(a5a325e6)の rules から写した:
#   v_028 の規則 = blind-04 の PIN(BLIND04_PIN.json cdbf162b)の sieve_v0.py、ja_fix_v1.py、fieldwise_v1.py のまま。
#   A7 の規則   = 同じ sieve_v0.py の DETECTOR["hidden_instruction"] から r"\bact as\b" の 1 本だけを外した写し。
#   A6 の規則   = a6_rules.py(93a87851)の hits のうち R2 と R3。
# 止めるのは a7_rule か a6 が立った行(a7_count.rule_stop と同じ)。
# 読む file は下の FILES の sha と全部一致しなければ止まる。build_a7.py と BLIND04_PIN.json は読まない(この file だけで組める)。
# usage:
#   python3 -I -B a74_rules_v1.py flags <items.jsonl> <out_rule_flags.jsonl> [--act-as-only]
#   python3 -I -B a74_rules_v1.py pins
import hashlib, importlib.util, json, os, sys
sys.dont_write_bytecode = True
def ops(): return os.environ.get("FURUI_A7_OPS", os.path.expanduser("~/hs-core-private/ops-private"))
FILES = {
    "sieve_v0.py": ("furui_blind02_pin/v027c/furui/sieve_v0.py", None),
    "ja_fix_v1.py": ("furui_blind02_pin/v027c/furui/ja_fix_v1.py", None),
    "fieldwise_v1.py": ("furui_blind02_pin/v027c/furui/fieldwise_v1.py", None),
    "a6_rules.py": ("furui_a6_20261031/a6_rules.py", "93a87851"),
}
PIN_JSON = ("furui_blind04_20261028/BLIND04_PIN.json", "cdbf162b305bc618d064f66062f065534f063a2cc8358e2994666ba63420075b")
ACT_AS = r"\bact as\b"
def die(m): sys.exit("止めた: " + m)
def fsha(p): return hashlib.sha256(open(p, "rb").read()).hexdigest()
def load(name, p):
    s = importlib.util.spec_from_file_location(name, p); m = importlib.util.module_from_spec(s); sys.modules[name] = m; s.loader.exec_module(m); return m

PINNED = {
    "sieve_v0.py": "5b2897a9",
    "ja_fix_v1.py": "c2e43d82",
    "fieldwise_v1.py": "b251f8c8",
    "a6_rules.py": "93a87851",
}

def file_shas():
    out = {}
    for n, (rel, _) in FILES.items():
        s = fsha(os.path.join(ops(), rel))
        if not s.startswith(PINNED[n]): die("%s が固定の %s でない" % (rel, PINNED[n]))
        out[n] = s
    return out

_M = {}
def mods():
    if not _M:
        file_shas(); f = lambda n: os.path.join(ops(), FILES[n][0])
        S = load("a74r_sieve_v028", f("sieve_v0.py")); S7 = load("a74r_sieve_a7", f("sieve_v0.py"))
        if S7.DETECTOR["hidden_instruction"].count(ACT_AS) != 1: die("sieve_v0.py の hidden_instruction に act as の型がちょうど 1 本でない")
        S7.DETECTOR["hidden_instruction"] = [p for p in S7.DETECTOR["hidden_instruction"] if p != ACT_AS]
        J = load("a74r_ja_fix", f("ja_fix_v1.py")); FW = load("a74r_fieldwise", f("fieldwise_v1.py")); A6 = load("a74r_a6", f("a6_rules.py"))
        _M.update(S=S, S7=S7, J=J, FW=FW, A6=A6)
    return _M

def flags(key, scope, text, act_as_only=False):
    """1 行の旗。run_blind06.rules と同じ欄と同じ並び(書く時に sort_keys)。act_as_only=True は build_a7 の形"""
    M = mods()
    v = bool(M["FW"].flags(M["S"], M["J"], {"text": text})); a7 = bool(M["FW"].flags(M["S7"], M["J"], {"text": text}))
    a6 = [h for h in M["A6"].hits(scope, text) if h in ("R2", "R3")]
    r = {"key": key, "v_028": v, "a7_rule": a7, "a6": a6}
    if act_as_only: r["act_as_only"] = v and not a7
    return r

def rule_stop(f): return bool(f["a7_rule"]) or bool(f["a6"])

def cmd_flags(items_p, out_p, act_as_only):
    rows = [json.loads(l) for l in open(items_p, encoding="utf-8") if l.strip()]
    fd = os.open(out_p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        for r in rows: fh.write(json.dumps(flags(r["key"], r["scope"], r["text"], act_as_only), ensure_ascii=False, sort_keys=True) + "\n")
    print("行 %d、sha256 %s" % (len(rows), fsha(out_p)))

def cmd_pins():
    P = json.load(open(os.path.join(ops(), PIN_JSON[0]), encoding="utf-8"))
    if fsha(os.path.join(ops(), PIN_JSON[0])) != PIN_JSON[1]: die("BLIND04_PIN.json が cdbf162b でない")
    pin = {os.path.basename(k): v for k, v in P["versions"][0]["files"].items()}; fs = file_shas(); bad = 0
    for n in ("sieve_v0.py", "ja_fix_v1.py", "fieldwise_v1.py"):
        ok = pin.get(n) == fs[n]; bad += not ok; print("%-16s %s  PIN と%s" % (n, fs[n][:8], "同じ" if ok else "違う"))
    print("a6_rules.py      %s" % fs["a6_rules.py"][:8])
    return 1 if bad else 0

if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["flags"] and len(a) in (3, 4): cmd_flags(a[1], a[2], a[3:] == ["--act-as-only"]); sys.exit(0)
    if a == ["pins"]: sys.exit(cmd_pins())
    die("usage: flags <items.jsonl> <out.jsonl> [--act-as-only] | pins")
