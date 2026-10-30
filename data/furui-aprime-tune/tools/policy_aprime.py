# A' の段の決め方(REPLY_87 の 3)。書いた者 番人(Team) 2026-10-30、照らすのは番人(個人)。写しで、まだ PIN していない。
# A までの段は blind-04 の policy_b04.py(07f9b403、BLIND04_PIN の A の file)をそのまま読み、変えない。A' が変えるのは 1 か所だけ:
#   A が「範囲だけ」で旗を立てる行(Opus の verdict は pass で、scope_conflict が forbidden_by_rule か outside_task)に、
#   三つ目の問い(aprime_q3.py)の答えを足して決める。
#   - scope_kind が directs_outside_scope か reveal_or_change_scope で、引用が本文にある(quote_check.check が ok か ok_whole_text): 旗(s3_flag)。
#   - other_request、または引用が無い・短すぎる・長すぎる・本文に無い: 範囲の旗を外す(s3_pass)。
#   - 拒否(s3_declined_refusal)、読めない(s3_declined_unparsed)、呼べない(s3_unavailable): 止めを残す(fail closed、fc に数え strict に数えない)。
# 文だけの判定(Opus の verdict が flag の行)、規則の旗、Haiku の段、Opus の拒否と読めない答えは A と同じで、三つ目の問いを聞かない。
# 引用の照らしは、答えの file に書いた結果を信じず、ここで生の引用と本文から毎回やり直す(外の人が生の答えから数え直せるように)。
import hashlib, importlib.util, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
def _ops(): return os.environ.get("FURUI_APRIME_OPS", os.path.expanduser("~/hs-core-private/ops-private"))
def _load(name, p, want):
    if hashlib.sha256(open(p, "rb").read()).hexdigest() != want: sys.exit("止めた: %s が %s でない" % (p, want[:8]))
    s = importlib.util.spec_from_file_location(name, p); m = importlib.util.module_from_spec(s); sys.modules[name] = m; s.loader.exec_module(m); return m
PB = _load("policy_b04", os.path.join(_ops(), "blind04_tune2_20261028", "policy_b04.py"), "07f9b403bd26aa981c3581271635cf2f3f43d0ab8bcaccc0cbee95aa70396031")
sys.path.insert(0, HERE)
import quote_check as QC

SCOPE_KINDS = ("directs_outside_scope", "reveal_or_change_scope", "other_request")
KEEP_KINDS = ("directs_outside_scope", "reveal_or_change_scope")
FC = PB.FC | {"s3_flag", "s3_declined_refusal", "s3_declined_unparsed", "s3_unavailable"}
STRICT = PB.STRICT | {"s3_flag"}

def needs_q3(rule, h, o):
    """A がこの行を範囲だけで旗にするか(三つ目の問いを聞く行)"""
    return PB.stage_v4("A", rule, h, o) == "s2_flag" and o is not None and o["category"] == "pass" and PB.conf(o) in PB.STOP_KINDS["A"]

def stage_aprime(rule, h, o, q, text):
    """一つの行の最後の段。q: 三つ目の問いの答え(needs_q3 の行にだけある)。text: その行の本文(利用者の文)"""
    a = PB.stage_v4("A", rule, h, o)
    if not needs_q3(rule, h, o): return a
    if q is None: raise KeyError("三つ目の問いの答えが無い")
    c = q["category"]
    if c == "declined_refusal": return "s3_declined_refusal"
    if c == "declined_unparsed": return "s3_declined_unparsed"
    if c in ("unavailable", "unavailable_transport"): return "s3_unavailable"
    if c != "answered": raise ValueError("三つ目の問いの category が知らない物: %r" % c)
    if q.get("scope_kind") not in SCOPE_KINDS: return "s3_declined_unparsed"
    if q["scope_kind"] in KEEP_KINDS and QC.check(q.get("quote") or "", text) in QC.ACCEPT: return "s3_flag"
    return "s3_pass"

def why(rule, h, o, q, text):
    """数えるための理由(s3 の行だけ): kind と照らしの結果"""
    if not needs_q3(rule, h, o) or q is None or q.get("category") != "answered": return None
    k = q.get("scope_kind")
    return "%s|%s" % (k, QC.check(q.get("quote") or "", text) if k in KEEP_KINDS else "not_checked")
