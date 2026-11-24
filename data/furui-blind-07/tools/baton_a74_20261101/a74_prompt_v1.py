#!/usr/bin/env python3
# A7.4 で AI に送る文を組む部分を、run_blind06.py(a5a325e6)から 1 つの file に分けた物(DESIGN_BATON_A74_v1 の F4)。
# 書いた者 番人(Team) の作業役 2026-11-01、照らすのは番人(個人)。blind06/ の file は替えていない。
# 元の組み: run_blind06.request → run_a7_3.py(92def84b)の prompts と request → run_a7_2.py(bb170ee3)、run_a7_1.py(b1079ece)、run_a7_build.py(98902b25)の
#   schema、mark → ai_judge.py(29c2d8d5)の wrap。呼びの引数は run_blind06.cmd_ai と run_a7_build.A7_MAX_TOKENS、ai_judge.MODELS の kw。
# 印の行の乱数(mark と wrap の 16 字)は元では secrets.token_hex(8)。ここでは tok を引数で受ける(本番は secrets.token_hex、試験は決まった列)。
# 呼ばない、網に出ない。問いの文、本文、範囲の文、引用は出さない。
# usage: python3 -I -B a74_prompt_v1.py pin     この file が組む物の固定の値(CALL と問いの sha)と、その canonical の sha を出す
import hashlib, json, os, secrets, sys
sys.dont_write_bytecode = True
def ops(): return os.environ.get("FURUI_A7_OPS", os.path.expanduser("~/hs-core-private/ops-private"))
QFILE = ("furui_a7_20261031/A7_QUESTIONS_v4.md", "2160b6c1")
HEADS = {"q1": "## 問い 1(", "q21": "## 問い 2-1 v4", "q21b": "## 問い 2-1b", "q22": "## 問い 2-2 v4"}
PROMPT_SHA = {"q1": "ae8537371072b203c353d0e43987cf09ae6c48835eeafed2e136c7c30b6a3648", "q21": "c51bad1190fbc63a04bbb747d50e8231d608401e62b2be7b8c8b951d68e2c591",
              "q21b": "d9adb4014569503964660325347b4bc0a2cc4b915cf6368c7ded08bf16d368af", "q22": "29a9ecc7e843efc303d6924ed7dc7794d876eadba49e780f6c7df628a4685391"}
HAIKU, OPUS = "claude-haiku-5-5", "claude-opus-5-5"
STAGE = {"q21v4_o": ("q21", OPUS), "q21b_o": ("q21b", OPUS), "q1v2_h": ("q1", HAIKU), "q1v2_o": ("q1", OPUS), "q22v4_h": ("q22", HAIKU), "q22v4_o": ("q22", OPUS)}
# 呼びの引数(run_blind06.cmd_ai のまま。temperature は付けていない)
CALL = {
    "max_tokens": {HAIKU: 400, OPUS: 4000},
    "kw": {HAIKU: {"thinking": {"type": "disabled"}}, OPUS: {}},
    "output_config": {"effort": "low", "format": {"type": "json_schema", "schema": "<段の schema>"}},
    "temperature": None,
    "timeout_s": 180,
    "retry": {"transport_retries": 8, "other_retries": 3, "wait_s": "min(2 ** (i + 1), 60)",
              "transport": "status 429 or 500..599, or the exception class (or a base) is one of APIConnectionError, APITimeoutError, RateLimitError, OverloadedError, DeadlineExceededError, ConnectionError, TimeoutError, InternalServerError"},
    "final_answer": "two-stage: the first answer when it is negative, otherwise the second; if the second is an API refusal the first stands",
}
def die(m): sys.exit("止めた: " + m)
def H(s): return hashlib.sha256(s.encode("utf-8")).hexdigest()
def canon(x): return json.dumps(x, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

_P = {}
def prompts():
    if not _P:
        p = os.path.join(ops(), QFILE[0])
        if not hashlib.sha256(open(p, "rb").read()).hexdigest().startswith(QFILE[1]): die("A7_QUESTIONS_v4.md が 2160b6c1 でない")
        t = open(p, encoding="utf-8").read()
        for k, head in HEADS.items():
            i = t.index(head); a = t.index("```\n", i) + 4; b = t.index("\n```", a); _P[k] = t[a:b]
            if H(_P[k]) != PROMPT_SHA[k]: die("問い %s の文が固定の sha と違う" % k)
    return _P

def _s(): return {"type": "string"}
def _e(v): return {"type": "string", "enum": v}
def schema(name):
    if name == "q1": props = {"attack": _e(["none", "override", "role_takeover", "secret_request", "false_authority", "evasion_frame"]), "quote": _s()}
    elif name == "q21": props = {"topic_limit": _e(["limits", "none"]), "topic_quote": _s(), "forbidden_output": _e(["forbids", "none"]), "forbidden_quote": _s()}
    elif name == "q21b": return {"type": "object", "properties": {"required_behavior": _e(["requires", "none"]), "required_quote": _s()},
                                 "required": ["required_behavior", "required_quote"], "additionalProperties": False}
    elif name == "q22": props = {"outside_topic": _e(["yes", "no"]), "topic_evidence": _s(), "asks_forbidden": _e(["yes", "no"]), "forbidden_evidence": _s(),
                                 "breaks_required": _e(["yes", "no"]), "required_evidence": _s()}
    else: die("schema の名が違う: " + name)
    return {"type": "object", "properties": props, "required": sorted(props), "additionalProperties": False}

def parse(name, txt, stop):
    """決まった形だけを受ける。形が違えば None(断りか読めない答え)"""
    if stop != "end_turn": return None
    try: d = json.loads(txt)
    except Exception: return None
    sc = schema(name)
    if not isinstance(d, dict) or set(d) != set(sc["properties"]): return None
    for k, v in sc["properties"].items():
        if not isinstance(d[k], str) or ("enum" in v and d[k] not in v["enum"]): return None
    return d

def wrap(text, tok):
    while True:
        n = tok()
        if n not in text: break
    return "<<<DATA %s BEGIN>>>\n%s\n<<<DATA %s END>>>" % (n, text, n)

def mark(text, tag, tok):
    n = tok()
    while n in text: n = tok()
    return "<<<%s %s BEGIN>>>\n%s\n<<<%s %s END>>>" % (tag, n, text, tag, n)

def request(stage, tok=lambda: secrets.token_hex(8), text=None, scope=None, q21=None, q21b=None, tv=False, fv=False, rv=False):
    """(system, user の文, schema)。q21v4_o と q21b_o は scope だけ。q1 は scope と text。q22 は text と、引用の通った範囲の引用(q21、q21b の答えの parsed)"""
    P = prompts(); name = STAGE[stage][0]
    if stage in ("q21v4_o", "q21b_o"): return P[name], wrap(scope, tok), schema(name)
    if stage.startswith("q1"): return P["q1"], mark(scope, "SCOPE", tok) + "\n" + wrap(text, tok), schema("q1")
    parts = []
    if tv: parts.append("Topic limit:\n" + mark(q21["topic_quote"], "TOPIC LIMIT", tok))
    if fv: parts.append("Forbidden outputs:\n" + mark(q21["forbidden_quote"], "FORBIDDEN", tok))
    if rv: parts.append("Required behaviour:\n" + mark(q21b["required_quote"], "REQUIRED", tok))
    return P["q22"], "\n".join(parts) + "\nUser text:\n" + wrap(text, tok), schema("q22")

def call_args(stage, system, content, sch):
    mo = STAGE[stage][1]
    return dict(model=mo, max_tokens=CALL["max_tokens"][mo], system=system, **CALL["kw"][mo],
                output_config={"effort": "low", "format": {"type": "json_schema", "schema": sch}}, messages=[{"role": "user", "content": content}])

def pin():
    """furui-rules-id-v1 の prompt_builder に入れる物"""
    d = {"builder_file": "a74_prompt_v1.py", "questions": {k: PROMPT_SHA[k] for k in sorted(PROMPT_SHA)},
         "schemas_sha256": {k: H(canon(schema(k))) for k in ("q1", "q21", "q21b", "q22")}, "stages": {k: list(v) for k, v in STAGE.items()}, "call": CALL}
    return d, H(canon(d))

if __name__ == "__main__":
    if sys.argv[1:] == ["pin"]:
        d, s = pin(); print("prompt_builder の canonical の sha256 %s" % s); print("schemas", {k: v[:8] for k, v in d["schemas_sha256"].items()}); sys.exit(0)
    die("usage: pin")
