# -*- coding: utf-8 -*-
"""通信をモックして survey1_walk のロジックだけを検証する。実物の関数を import して試す。"""
import io, json, sys, types, urllib.request, urllib.error
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import survey1_walk as W

W.PER_HOST_INTERVAL = 0.0   # 検証中は待たない
W.RETRY_SLEEP = 0.0         # 検証中は再試行の間も置かない

class Resp(io.BytesIO):
    def __init__(self, body, status=200, headers=None):
        super().__init__(body if isinstance(body, bytes) else body.encode())
        self.status = status
        self.headers = headers or {}
    def __enter__(self): return self
    def __exit__(self, *a): return False

SCENARIOS = {}

def fake_urlopen(req, timeout=None):
    url = req.full_url if hasattr(req, "full_url") else str(req)
    fn = None
    for k, f in SCENARIOS.items():
        if k in url:
            fn = f; break
    if fn is None:
        raise urllib.error.URLError("no route")
    return fn(req, url)

urllib.request.urlopen = fake_urlopen

def reset():
    SCENARIOS.clear()
    W._robots_cache.clear()

def show(name, rec, keys):
    print("  " + name)
    print("    " + "  ".join("%s=%s" % (k, rec.get(k)) for k in keys))

# --- 1. 正常系: セッションIDを要求し、initialized を待つサーバー ---
reset()
state = {"initialized": False}
def ok_host(req, url):
    if url.endswith("/robots.txt"):
        return Resp("User-agent: *\nDisallow: /private/\n")
    if url.endswith("/.well-known/agent-card.json"):
        return Resp(json.dumps({"name": "Good Server", "compensation": {"paid_by": "seller"}}))
    body = json.loads(req.data.decode())
    if body.get("method") == "initialize":
        return Resp(json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"serverInfo": {"name": "good-mcp"}}}),
                    headers={"mcp-session-id": "S1", "content-type": "application/json"})
    if body.get("method") == "notifications/initialized":
        state["initialized"] = True
        return Resp(b"", status=202, headers={})
    if body.get("method") == "tools/list":
        if req.headers.get("Mcp-session-id") != "S1":
            return Resp(json.dumps({"error": {"message": "session required"}}), headers={"content-type": "application/json"})
        if not state["initialized"]:
            return Resp(json.dumps({"error": {"message": "not initialized"}}), headers={"content-type": "application/json"})
        return Resp(json.dumps({"jsonrpc": "2.0", "id": 2, "result": {"tools": [{"name": "a"}, {"name": "b"}]}}),
                    headers={"content-type": "application/json"})
    return Resp(b"{}")
SCENARIOS["good.test"] = ok_host
r = W.measure("https://good.test/mcp")
print("1) セッションID必須 + initialized 待ちのサーバー")
show("結果", r, ["state", "answered", "speaks_mcp", "tool_count", "agent_card", "compensation_disclosed", "session_required"])
assert r["speaks_mcp"] is True and r["tools_listed"] is True and r["tool_count"] == 2, "セッション/initialized 対応が効いていない"
assert r["compensation_disclosed"] is True

# --- 2. SSE で返すサーバー ---
reset()
def sse_host(req, url):
    if url.endswith("/robots.txt"): raise urllib.error.URLError("none")
    if url.endswith("agent-card.json"): raise urllib.error.URLError("none")
    body = json.loads(req.data.decode())
    if body.get("method") == "initialize":
        return Resp("event: message\ndata: " + json.dumps({"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"sse"}}}) + "\n\n",
                    headers={"content-type": "text/event-stream"})
    if body.get("method") == "tools/list":
        return Resp("data: " + json.dumps({"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"x"}]}}) + "\n\n",
                    headers={"content-type": "text/event-stream"})
    return Resp(b"")
SCENARIOS["sse.test"] = sse_host
r = W.measure("https://sse.test/mcp")
print("2) SSE(text/event-stream)で返すサーバー")
show("結果", r, ["state", "speaks_mcp", "tool_count"])
assert r["speaks_mcp"] is True and r["tool_count"] == 1, "SSE を読めていない"

# --- 3. 到達できない: held であり、相手についての主張にしないこと ---
reset()
r = W.measure("https://unreachable.test/mcp")
print("3) 到達できないサーバー(規則2)")
show("結果", r, ["state", "answered", "speaks_mcp", "reason"])
assert r["state"] == "held" and r["answered"] is False
assert r["speaks_mcp"] is None, "測れていないのに speaks_mcp を false と書いてはいけない"

# --- 4. robots.txt が禁じている: 測らない ---
reset()
def blocked(req, url):
    if url.endswith("/robots.txt"):
        return Resp("User-agent: *\nDisallow: /mcp\n")
    raise AssertionError("robots が禁じたのに接触した")
SCENARIOS["blocked.test"] = blocked
r = W.measure("https://blocked.test/mcp")
print("4) robots.txt が禁じているサーバー(規則5)")
show("結果", r, ["state", "reason"])
assert r["state"] == "skipped" and r["answered"] is None

# --- 5. HTTPで応答するが MCP を話さない: pending(held ではない) ---
reset()
def not_mcp(req, url):
    if url.endswith("/robots.txt"): raise urllib.error.URLError("none")
    raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)
SCENARIOS["notmcp.test"] = not_mcp
r = W.measure("https://notmcp.test/mcp")
print("5) HTTP応答あり、MCPではない(held と混ぜないこと)")
show("結果", r, ["state", "answered", "http_status", "reason"])
assert r["state"] == "pending" and r["answered"] is True, "応答した相手を held にしてはいけない"

# --- 6. record_sha256 が再計算できること ---
import hashlib
rec = W.stamp(dict(r))
body = {k: rec[k] for k in rec if k != "record_sha256"}
again = hashlib.sha256(W.canon(body).encode()).hexdigest()
print("6) 1行ごとのハッシュ再計算(規則4)")
print("    再現:", again == rec["record_sha256"])
assert again == rec["record_sha256"]

# --- 7. tools/call を絶対に呼ばないこと ---
src = open(W.__file__.replace(".pyc", ".py"), encoding="utf-8").read()
print("7) tools/call を呼ぶ経路が存在しないこと(規則1)")
print("    'tools/call' の出現:", src.count("tools/call"), "(コメント内の言及のみであること)")
assert '"tools/call"' not in src and "'tools/call'" not in src

print()
print("基本7項目 通過")

# --- 8. 401: 鍵がかかっているだけ。pending にせず、speaks_mcp を false と書かない ---
reset()
def needs_auth(req, url):
    if url.endswith("/robots.txt"): raise urllib.error.URLError("none")
    raise urllib.error.HTTPError(url, 401, "Unauthorized", {}, None)
SCENARIOS["auth.test"] = needs_auth
r = W.measure("https://auth.test/mcp")
print("8) 認証が必要なサーバー(予行で97件中65件を占めた分類)")
show("結果", r, ["state", "outcome", "answered", "speaks_mcp"])
assert r["state"] == "held", "401 を pending にすると、鍵がかかっているだけの相手を不合格に見せる"
assert r["outcome"] == "authorization_required"
assert r["speaks_mcp"] is None, "測っていないのに speaks_mcp を false と書いてはいけない"
assert r["answered"] is True, "応答はしている。それは事実として残す"

# --- 9. 502/521/530: 中継が答え、オリジンは答えていない ---
for code in (502, 521, 530):
    reset()
    def gw(req, url, _c=code):
        if url.endswith("/robots.txt"): raise urllib.error.URLError("none")
        raise urllib.error.HTTPError(url, _c, "gw", {}, None)
    SCENARIOS["gw.test"] = gw
    r = W.measure("https://gw.test/mcp")
    assert r["state"] == "held" and r["outcome"] == "gateway_error", "HTTP %d の扱いが誤り" % code
    assert r["speaks_mcp"] is None
print("9) 中継エラー(502/521/530) -> held / gateway_error / speaks_mcp=None  すべて正しい")

# --- 10. 405: 宛先がストリーム側の可能性。測れていないと書く ---
reset()
def m405(req, url):
    if url.endswith("/robots.txt"): raise urllib.error.URLError("none")
    raise urllib.error.HTTPError(url, 405, "Method Not Allowed", {}, None)
SCENARIOS["m405.test"] = m405
r = W.measure("https://m405.test/mcp")
print("10) POST を拒む宛先(405)")
show("結果", r, ["state", "outcome", "speaks_mcp"])
assert r["state"] == "held" and r["outcome"] == "method_not_allowed" and r["speaks_mcp"] is None

# --- 11. 307: リダイレクトを一度だけ追い、追った先を記録する ---
reset()
hops = {"n": 0}
def redir(req, url):
    if url.endswith("/robots.txt"): raise urllib.error.URLError("none")
    if url.endswith("agent-card.json"): raise urllib.error.URLError("none")
    if "/old" in url:
        hops["n"] += 1
        raise urllib.error.HTTPError(url, 307, "Temporary Redirect",
                                     {"Location": "https://redir.test/new"}, None)
    body = json.loads(req.data.decode())
    if body.get("method") == "initialize":
        return Resp(json.dumps({"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"moved"}}}),
                    headers={"content-type":"application/json"})
    if body.get("method") == "tools/list":
        return Resp(json.dumps({"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"t"}]}}),
                    headers={"content-type":"application/json"})
    return Resp(b"{}")
SCENARIOS["redir.test"] = redir
r = W.measure("https://redir.test/old")
print("11) 307 リダイレクト")
show("結果", r, ["state", "speaks_mcp", "tool_count", "redirected_to"])
assert r["speaks_mcp"] is True, "リダイレクトを追えていない"
assert r["redirected_to"] == "https://redir.test/new"
assert hops["n"] == 1, "リダイレクトを追いすぎている"

# --- 12. 404 は測定である(pending のまま) ---
reset()
SCENARIOS["gone.test"] = lambda req, url: (_ for _ in ()).throw(
    urllib.error.URLError("none") if url.endswith("/robots.txt")
    else urllib.error.HTTPError(url, 404, "NF", {}, None))
r = W.measure("https://gone.test/mcp")
print("12) 宣言された住所に何も無い(404)")
show("結果", r, ["state", "outcome", "speaks_mcp"])
assert r["state"] == "pending" and r["outcome"] == "no_mcp_at_declared_address"
assert r["speaks_mcp"] is False, "これは測定なので false でよい"

print()
print("追加分もすべて通過")

# --- 13. initialize は通ったが tools/list が返らない: MCPは話している ---
reset()
def init_only(req, url):
    if url.endswith("/robots.txt"): raise urllib.error.URLError("none")
    if url.endswith("agent-card.json"): raise urllib.error.URLError("none")
    body = json.loads(req.data.decode())
    if body.get("method") == "initialize":
        return Resp(json.dumps({"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"quiet"}}}),
                    headers={"content-type":"application/json"})
    if body.get("method") == "tools/list":
        raise urllib.error.HTTPError(url, 500, "boom", {}, None)
    return Resp(b"{}")
SCENARIOS["initonly.test"] = init_only
r = W.measure("https://initonly.test/mcp")
print("13) initialize は通り、tools/list が返らないサーバー")
show("結果", r, ["state", "outcome", "initialize_ok", "tools_listed", "speaks_mcp", "tool_count"])
assert r["initialize_ok"] is True
assert r["speaks_mcp"] is True, "initialize に答えた相手を『MCPを話さない』と書いてはいけない"
assert r["tools_listed"] is False
assert r["tool_count"] is None
assert r["outcome"] == "speaks_mcp_no_tool_list"

# --- 14. robots で弾いた行にも outcome が入ること ---
reset()
SCENARIOS["rb.test"] = lambda req, url: Resp("User-agent: *\nDisallow: /mcp\n") if url.endswith("/robots.txt") else (_ for _ in ()).throw(AssertionError("接触した"))
r = W.measure("https://rb.test/mcp")
print("14) robots 拒否行の outcome")
show("結果", r, ["state", "outcome"])
assert r["outcome"] == "robots_disallowed"

print()
print("13/14 も通過")

# =====================================================================
# 計器の健康診断(2026-08-23 の全件走行が 11,307 行の偽 held を書いたことへの対処)
# =====================================================================

def health_reset(trip=3, wait=1, timeout=0.05):
    W._consec_unreached = 0
    W._health_state = "ok"
    W._health_event.set()
    W._abort.clear()
    W._health_log.clear()
    W.UNREACHED_TRIP = trip
    W.CONTROL_MAX_WAIT = wait
    W.CONTROL_TIMEOUT = timeout

# --- 15. 失敗の理由に errno と原因が残ること ---
print()
print("15) 到達できなかった理由が診断できる形で残る")
e = urllib.error.URLError(OSError(8, "nodename nor servname provided, or not known"))
d = W.describe_exc(e)
print("    " + d)
assert "URLError" in d and "errno 8" in d and "nodename" in d, \
    "以前はここが 'URLError' だけで、11,422行が等しく同じ理由になっていた"

# --- 16. 対照先に届くなら、連続失敗でも走行は止まらない ---
reset(); health_reset()
CONTROL = {"up": True}
def control_route(req, url):
    if CONTROL["up"]:
        return Resp(b"ok")
    raise urllib.error.URLError(OSError(8, "nodename nor servname provided, or not known"))
SCENARIOS["shield.the-horizons-innovation.com"] = control_route
SCENARIOS["www.cloudflare.com"] = control_route
def dead(req, url):
    raise urllib.error.URLError(OSError(61, "Connection refused"))
SCENARIOS["dead.test"] = dead

recs = [W.measure_guarded("https://dead.test/mcp%d" % i, verbose=False) for i in range(6)]
print("16) 相手が届かないが、対照先は生きている")
print("    outcome:", sorted({r["outcome"] for r in recs}), " abort:", W._abort.is_set())
assert all(r["outcome"] == "not_reached" for r in recs), "相手が居ないことは、そのまま記録してよい"
assert not W._abort.is_set(), "こちらが生きている限り、走行は止めない"
assert any(ev["event"] == "control_ok" for ev in W._health_log), "点検した記録が残ること"

# --- 17. 対照先にも届かず回復しないなら、偽の held を書かずに中止する ---
reset(); health_reset(trip=3, wait=1)
CONTROL["up"] = False
SCENARIOS["shield.the-horizons-innovation.com"] = control_route
SCENARIOS["www.cloudflare.com"] = control_route
SCENARIOS["dead.test"] = dead
recs = [W.measure_guarded("https://dead.test/mcp%d" % i, verbose=False) for i in range(6)]
print("17) 対照先にも届かない = こちらが落ちている")
print("    outcome:", [r["outcome"] for r in recs])
print("    abort:", W._abort.is_set())
assert W._abort.is_set(), "回復しないなら走行を止めること"
assert recs[-1]["outcome"] == "instrument_down"
assert recs[-1]["speaks_mcp"] is None, "相手についての主張を書いてはいけない"
assert "our network, not about this server" in recs[-1]["reason"]
assert any(ev["event"] == "gave_up" for ev in W._health_log)

# --- 18. 落ちている間の1件は捨てて、回復後に測り直す ---
reset(); health_reset(trip=2, wait=30)
CONTROL["up"] = False
SCENARIOS["shield.the-horizons-innovation.com"] = control_route
SCENARIOS["www.cloudflare.com"] = control_route
flap = {"n": 0}
def flapping(req, url):
    if url.endswith("/robots.txt"):
        raise urllib.error.URLError("none")
    if url.endswith("agent-card.json"):
        raise urllib.error.URLError("none")
    flap["n"] += 1
    if not CONTROL["up"]:
        # 計器が落ちている間は、相手も当然届かない
        raise urllib.error.URLError(OSError(8, "nodename nor servname provided, or not known"))
    body = json.loads(req.data.decode())
    if body.get("method") == "initialize":
        CONTROL["up"] = True
        return Resp(json.dumps({"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"alive"}}}),
                    headers={"content-type":"application/json"})
    if body.get("method") == "tools/list":
        return Resp(json.dumps({"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"x"}]}}),
                    headers={"content-type":"application/json"})
    return Resp(b"", status=202)
SCENARIOS["flap.test"] = flapping

# 1件目・2件目で trip し、点検の途中で回線が戻る
import threading as _th
def _heal():
    import time as _t; _t.sleep(0.4); CONTROL["up"] = True
_th.Thread(target=_heal, daemon=True).start()
r1 = W.measure_guarded("https://flap.test/mcp", verbose=False)
r2 = W.measure_guarded("https://flap.test/mcp2", verbose=False)
print("18) 落ちている間の結果を捨て、回復後に測り直す")
print("    1件目:", r1["outcome"], " 2件目:", r2["outcome"], " abort:", W._abort.is_set())
assert not W._abort.is_set(), "回復したなら止めない"
assert r2["outcome"] == "speaks_mcp_and_lists_tools", \
    "回復後に測り直した結果が採られること(捨てずに not_reached を書いてはいけない)"
assert any(ev["event"] == "recovered" for ev in W._health_log)

# --- 19. 中止後は、残りの行に相手についての主張を書かない ---
reset(); health_reset(trip=1, wait=0)
W._abort.set()
r = W.measure_guarded("https://whatever.test/mcp", verbose=False)
print("19) 中止後の行")
show("結果", r, ["state", "outcome", "speaks_mcp", "answered"])
assert r["state"] == "held" and r["outcome"] == "instrument_down"
assert r["speaks_mcp"] is None and r["answered"] is None

W._abort.clear()
print()
print("15/16/17/18/19 も通過")

# --- 20. 一度つまずいた相手を、永続的な主張に変えない ---
reset(); health_reset(trip=99, wait=1)
CONTROL["up"] = True
SCENARIOS["shield.the-horizons-innovation.com"] = control_route
SCENARIOS["www.cloudflare.com"] = control_route
hiccup = {"n": 0}
def once_then_ok(req, url):
    if url.endswith("/robots.txt") or url.endswith("agent-card.json"):
        raise urllib.error.URLError("none")
    hiccup["n"] += 1
    if hiccup["n"] == 1:
        raise urllib.error.URLError(OSError(8, "nodename nor servname provided, or not known"))
    body = json.loads(req.data.decode())
    if body.get("method") == "initialize":
        return Resp(json.dumps({"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"slow-dns"}}}),
                    headers={"content-type":"application/json"})
    if body.get("method") == "tools/list":
        return Resp(json.dumps({"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"t"}]}}),
                    headers={"content-type":"application/json"})
    return Resp(b"", status=202)
SCENARIOS["hiccup.test"] = once_then_ok
r = W.measure_guarded("https://hiccup.test/mcp", verbose=False)
print()
print("20) 一度だけ名前が引けなかった相手")
show("結果", r, ["state", "outcome", "speaks_mcp", "retried"])
assert r["outcome"] == "speaks_mcp_and_lists_tools", \
    "一瞬のつまずきを『MCPを話さない』として保存してはいけない"
assert r.get("retried") == 1

# --- 21. 本当に居ない相手は、試行回数つきで到達不能のまま ---
reset(); health_reset(trip=99, wait=1)
CONTROL["up"] = True
SCENARIOS["shield.the-horizons-innovation.com"] = control_route
SCENARIOS["www.cloudflare.com"] = control_route
SCENARIOS["gone.test"] = dead
r = W.measure_guarded("https://gone.test/mcp", verbose=False)
print("21) 何度試しても居ない相手")
show("結果", r, ["state", "outcome", "speaks_mcp", "retried"])
assert r["state"] == "held" and r["outcome"] == "not_reached"
assert r["speaks_mcp"] is None, "到達できていない相手について false を書かない"
assert "errno 61" in r["reason"] and "attempts:" in r["reason"]

print()
print("20/21 も通過  ―― 全21本")

# --- 22. カードを取れなかったことを「カードが無い」と書かない ---
reset(); health_reset(trip=99, wait=1)
CONTROL["up"] = True
SCENARIOS["shield.the-horizons-innovation.com"] = control_route
SCENARIOS["www.cloudflare.com"] = control_route
def mcp_ok_card_broken(req, url):
    if url.endswith("/robots.txt"): raise urllib.error.URLError("none")
    if url.endswith("agent-card.json"):
        raise urllib.error.URLError(OSError(60, "Operation timed out"))
    body = json.loads(req.data.decode())
    if body.get("method") == "initialize":
        return Resp(json.dumps({"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"x"}}}),
                    headers={"content-type":"application/json"})
    if body.get("method") == "tools/list":
        return Resp(json.dumps({"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"t"}]}}),
                    headers={"content-type":"application/json"})
    return Resp(b"", status=202)
SCENARIOS["cardto.test"] = mcp_ok_card_broken
r = W.measure("https://cardto.test/mcp")
print()
print("22) カードの取得が時間切れになった相手")
show("結果", r, ["agent_card", "agent_card_note", "compensation_disclosed"])
assert r["agent_card"] is None, "取れなかったことを『カードが無い』(False) と書いてはいけない"
assert r["compensation_disclosed"] is None, "カードを読めていない以上、開示の有無は測っていない"
assert "errno 60" in r["agent_card_note"]

# --- 23. 404 のときだけ「無い」と書いてよい ---
reset(); health_reset(trip=99, wait=1)
def card404(req, url):
    if url.endswith("/robots.txt"): raise urllib.error.URLError("none")
    if url.endswith("agent-card.json"):
        raise urllib.error.HTTPError(url, 404, "nf", {}, None)
    body = json.loads(req.data.decode())
    if body.get("method") == "initialize":
        return Resp(json.dumps({"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"x"}}}),
                    headers={"content-type":"application/json"})
    if body.get("method") == "tools/list":
        return Resp(json.dumps({"jsonrpc":"2.0","id":2,"result":{"tools":[]}}),
                    headers={"content-type":"application/json"})
    return Resp(b"", status=202)
SCENARIOS["card404.test"] = card404
r = W.measure("https://card404.test/mcp")
print("23) カードが 404 の相手")
show("結果", r, ["agent_card", "agent_card_note", "compensation_disclosed"])
assert r["agent_card"] is False, "404 は『無い』と書いてよい唯一の場合"
assert r["compensation_disclosed"] is None, "カードが無い以上、開示の有無は測っていない"

# --- 24. 開示は我々の語彙以外でも拾う ---
reset(); health_reset(trip=99, wait=1)
def card_pricing(req, url):
    if url.endswith("/robots.txt"): raise urllib.error.URLError("none")
    if url.endswith("agent-card.json"):
        return Resp(json.dumps({"name": "P", "pricing": {"per_call_usd": 0.01}}))
    body = json.loads(req.data.decode())
    if body.get("method") == "initialize":
        return Resp(json.dumps({"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"x"}}}),
                    headers={"content-type":"application/json"})
    if body.get("method") == "tools/list":
        return Resp(json.dumps({"jsonrpc":"2.0","id":2,"result":{"tools":[]}}),
                    headers={"content-type":"application/json"})
    return Resp(b"", status=202)
SCENARIOS["pricing.test"] = card_pricing
r = W.measure("https://pricing.test/mcp")
print("24) 我々の 'compensation' ではなく 'pricing' で開示している相手")
show("結果", r, ["agent_card", "compensation_disclosed", "compensation_fields"])
assert r["compensation_disclosed"] is True
assert r["compensation_fields"] == ["pricing"], \
    "我々の語彙だけを探して『開示が無い』と数えるのは、相手ではなく我々についての観測"

# --- 25. 空のカードで開示ありと数えない ---
reset(); health_reset(trip=99, wait=1)
def card_bare(req, url):
    if url.endswith("/robots.txt"): raise urllib.error.URLError("none")
    if url.endswith("agent-card.json"):
        return Resp(json.dumps({"name": "B", "pricing": {}, "compensation": ""}))
    body = json.loads(req.data.decode())
    if body.get("method") == "initialize":
        return Resp(json.dumps({"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"x"}}}),
                    headers={"content-type":"application/json"})
    if body.get("method") == "tools/list":
        return Resp(json.dumps({"jsonrpc":"2.0","id":2,"result":{"tools":[]}}),
                    headers={"content-type":"application/json"})
    return Resp(b"", status=202)
SCENARIOS["bare.test"] = card_bare
r = W.measure("https://bare.test/mcp")
print("25) 名前だけあって中身が空の開示欄")
show("結果", r, ["agent_card", "compensation_disclosed", "compensation_fields"])
assert r["agent_card"] is True and r["compensation_disclosed"] is False
assert r["compensation_fields"] == []

print()
print("22/23/24/25 も通過  ―― 全25本")
