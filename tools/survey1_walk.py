# -*- coding: utf-8 -*-
"""
WEDJAT survey, report 1: count 3.

宣言済みの手法(verify-directory/survey/, 2026-08-19 公開)に従って、
report 0 が数えた「住所を宣言している 12,429 件」のうち、実際に応答するのは何件かを測る。

このスクリプトが守る、公開済みの5つの規則:
  1. read only  ...  initialize / notifications/initialized / tools/list のみ。
                     tools/call は絶対に呼ばない。相手のツールは一度も実行しない。
  2. 「落ちていた」と書かない ... held(測れなかった) と pending(測った上で条件を満たさない)
                     を決して混ぜない。計器の失敗を相手についての主張にしない。
  3. 人格ではなく測定を書く ... 出力は事実と日付だけ。評価語を持たない。
  4. 手順とハッシュを添える ... 1行ごとに record_sha256 を付け、再計算手順を公開する。
  5. robots.txt を尊重し、負荷を低く保つ ... ホスト単位で間隔を空け、robots が禁じた
                     パスは測らずに skipped として理由ごと記録する。

正確性について:
  Streamable HTTP の MCP では、initialize の応答ヘッダに Mcp-Session-Id が入り、
  以降の要求にそれを付けないと拒むサーバーがある。notifications/initialized を
  受け取るまで tools/list を返さないサーバーもある。これらを実装せずに数えると、
  実際には動いているサーバーを「応答しない」と数えることになる。
  他人のサーバーについて偽の事実を publish しないために、両方に対応する。

規則2を、この計器自身にも適用する(2026-08-23 追記):
  最初の全件走行は、開始18分後に自機の名前解決が落ち、そのあと 11,307 件を
  一件残らず「到達できなかった」として記録した。規則2が禁じているのは
  まさにこれである。計器の失敗が、相手についての主張として保存されていた。
  よって、連続して到達できなくなったら既知の対照先で自分を確かめ、
  こちらが落ちていると分かった間の結果は捨て、回復しないなら走行を中止する。
  数字を埋めるくらいなら、行がない方がよい。

使い方:
  python3 survey1_walk.py --input endpoints.txt --out results.jsonl            # 全件
  python3 survey1_walk.py --input endpoints.txt --out pilot.jsonl --sample 300 # 予行
  python3 survey1_walk.py --input endpoints.txt --out results.jsonl --resume   # 続きから

依存なし(標準ライブラリのみ)。途中で止めても results.jsonl に書いた分は残る。
--resume は、到達できなかった行を既定で測り直す(相手の不在と計器の失敗を、
その行だけからは区別できないため)。集計は survey1_aggregate.py が
endpoint ごとに最後の行を採る。
"""

import argparse, json, hashlib, random, re, sys, threading, time
import urllib.request, urllib.error, urllib.parse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

UA = ("HORIZON-SHIELD-survey/1.0 (+https://shield.the-horizons-innovation.com/verify-directory/survey/; "
      "read-only; contact@the-horizons-innovation.com)")
PROTOCOL = "2024-11-05"
TIMEOUT = 12
PER_HOST_INTERVAL = 2.0     # 同一ホストへの最短間隔(秒)
GLOBAL_WORKERS = 16    # 1ホストに集中した母集団では、一部のワーカーが待機で塞がるため多めに取る
ROBOTS_TIMEOUT = 8

# ホスト単位の間隔。defaultdict(Lock) は新規キー生成が競合するので使わない。
# また、ロックを握ったまま眠るとワーカーが塞がり、1ホストに集中した母集団で全体が停まる。
# 「次に叩いてよい時刻」を予約だけして、待つのはロックの外で行う。
_reg_lock = threading.Lock()
_host_next = {}
_robots_cache = {}
_robots_lock = threading.Lock()


# ---------------------------------------------------------------------------
# 計器の健康診断。
#
# 2026-08-23 の全件走行で、開始から18分後(06:35)に、以降 11,307 件が
# 一件残らず「到達できなかった」になった。1時間40分のあいだ、回復は一度もない。
# 決定的だったのは api.m2mcent.com で、直前まで 113 回 HTTP で応答していたのに、
# 残る 148 件は全て到達不能として記録されていた。113回answerしたサーバーは消えない。
# 落ちていたのは相手ではなく、こちらの名前解決だった。
#
# 規則2は「計器の失敗を相手についての主張にしない」と言っている。にもかかわらず、
# この計器は自分が壊れたことに気づかず、偽の held を 11,307 行 生産した。
# 規則2を自分自身に適用する:
#   - 連続して到達できなくなったら、既知の対照先を叩いて、こちらが生きているか確かめる。
#   - 対照先にも届かないなら、それは相手についての観測ではない。測定を止めて回復を待つ。
#   - 回復したら、その間に失敗した1件は捨てて測り直す。
#   - 回復しないなら、走行を中止する。数字を埋めるより、行がない方がましである。
# ---------------------------------------------------------------------------
CONTROL_URLS = (
    "https://shield.the-horizons-innovation.com/verify-directory/survey/",
    "https://www.cloudflare.com/robots.txt",
)
UNREACHED_TRIP = 25         # これだけ連続で到達できなければ、まず自分を疑う
CONTROL_MAX_WAIT = 900      # 回復をこれだけ待って、駄目なら中止(秒)
CONTROL_TIMEOUT = 10

_health_lock = threading.Lock()
_health_event = threading.Event(); _health_event.set()   # set = 測ってよい
_consec_unreached = 0
_health_state = "ok"        # ok | checking
_abort = threading.Event()
_health_log = []            # 走行の記録に残す。点検したこと自体を隠さない。


def describe_exc(e):
    """なぜ届かなかったのかを残す。

    以前はここが type(e).__name__ だけで、11,422 行が等しく "URLError" になった。
    そのため「相手が消えた」のか「こちらの resolver が死んだ」のかを、
    出来上がった記録から区別できなかった。errno と原因文を残す。
    """
    parts = [type(e).__name__]
    r = getattr(e, "reason", None)
    if r is not None and not isinstance(r, str):
        parts.append(type(r).__name__)
        eno = getattr(r, "errno", None)
        if eno is not None:
            parts.append("errno " + str(eno))
    s = str(r) if r is not None else str(e)
    s = " ".join(s.split())
    if s and s not in parts:
        parts.append(s[:160])
    return " / ".join(parts)


def control_ok():
    """対照先。片方でも届けば、こちらのネットワークは生きている。"""
    for u in CONTROL_URLS:
        try:
            req = urllib.request.Request(u, headers={"User-Agent": UA}, method="GET")
            with urllib.request.urlopen(req, timeout=CONTROL_TIMEOUT) as r:
                r.read(2048)
            return True, u
        except urllib.error.HTTPError:
            return True, u          # 応答が返っている以上、経路は生きている
        except Exception:
            continue
    return False, None


def _run_health_check(verbose=True):
    """対照先が戻るまで待つ。戻れば True。戻らなければ走行を中止して False。"""
    global _health_state, _consec_unreached
    deadline = time.time() + CONTROL_MAX_WAIT
    attempt = 0
    while time.time() < deadline and not _abort.is_set():
        attempt += 1
        ok, via = control_ok()
        if ok:
            with _health_lock:
                _consec_unreached = 0
                _health_state = "ok"
                _health_log.append({"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                    "event": "recovered", "attempts": attempt, "via": via})
            if verbose:
                print("  [health] 対照先に到達できた(%s)。測定を再開する。" % via, file=sys.stderr)
            _health_event.set()
            return True
        wait = min(60, 5 * attempt)
        if verbose:
            print("  [health] 対照先にも届かない。こちらが落ちている可能性が高い。"
                  "%d秒待って再点検する(試行 %d)。" % (wait, attempt), file=sys.stderr)
        time.sleep(wait)
    with _health_lock:
        _health_log.append({"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                            "event": "gave_up", "attempts": attempt})
    _abort.set()
    _health_event.set()     # 待っているワーカーを解放してから畳む
    if verbose:
        print("  [health] %d秒待っても対照先に届かない。走行を中止する。"
              "偽の held を書くよりは、行がない方がよい。" % CONTROL_MAX_WAIT, file=sys.stderr)
    return False


def health_note_success():
    global _consec_unreached
    with _health_lock:
        _consec_unreached = 0


def health_note_failure(verbose=True):
    """到達できなかったことを1件数える。点検が要るなら、ここで待つ。

    戻り値 True は「計器が落ちていて、その後回復した」= この1件は測り直すべき、の意。
    """
    global _consec_unreached, _health_state
    with _health_lock:
        _consec_unreached += 1
        n = _consec_unreached
        trip = n >= UNREACHED_TRIP and _health_state == "ok"
        if trip:
            _health_state = "checking"
            _health_event.clear()
            _health_log.append({"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                "event": "tripped", "consecutive_unreached": n})
    if trip:
        if verbose:
            print("  [health] %d件連続で到達できない。相手を疑う前に、対照先で自分を確かめる。"
                  % n, file=sys.stderr)
        ok, via = control_ok()
        if ok:
            with _health_lock:
                _consec_unreached = 0
                _health_state = "ok"
                _health_log.append({"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                    "event": "control_ok", "via": via})
            if verbose:
                print("  [health] 対照先には届く(%s)。こちらは生きている。"
                      "この連続はおそらく母集団側の性質なので、そのまま続ける。" % via, file=sys.stderr)
            _health_event.set()
            return False
        return _run_health_check(verbose=verbose)
    if not _health_event.is_set():
        _health_event.wait(CONTROL_MAX_WAIT + 60)
        return not _abort.is_set()
    return False


def wait_healthy():
    _health_event.wait(CONTROL_MAX_WAIT + 60)


def canon(obj):
    """扉と同じ手順。区切りを詰め、非ASCIIをエスケープせず、キーは並べ替えない。"""
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def sha256hex(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def host_gate(host):
    """ホスト単位で間隔を空ける。1ホストに1312件集中している母集団なので、これが要る。"""
    with _reg_lock:
        now = time.time()
        start = max(now, _host_next.get(host, 0.0))
        _host_next[host] = start + PER_HOST_INTERVAL
    delay = start - time.time()
    if delay > 0:
        time.sleep(delay)


def robots_allows(url):
    """規則5。禁じられていたら測らない。取得できないときは許可とみなし、その旨を記録する。"""
    p = urllib.parse.urlparse(url)
    origin = p.scheme + "://" + p.netloc
    with _robots_lock:
        cached = _robots_cache.get(origin, "MISS")
    if cached == "MISS":
        rules = []
        note = "fetched"
        try:
            host_gate(p.hostname or origin)
            req = urllib.request.Request(origin + "/robots.txt", headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=ROBOTS_TIMEOUT) as r:
                body = r.read(200000).decode("utf-8", "replace")
            active = False
            for raw in body.splitlines():
                line = raw.split("#", 1)[0].strip()
                if not line or ":" not in line:
                    continue
                k, v = line.split(":", 1)
                k = k.strip().lower(); v = v.strip()
                if k == "user-agent":
                    active = v == "*" or "horizon" in v.lower()
                elif k == "disallow" and active and v:
                    rules.append(v)
        except Exception as e:
            note = "not fetched (" + type(e).__name__ + "), treated as allowed"
        with _robots_lock:
            _robots_cache[origin] = (rules, note)
        cached = (rules, note)
    rules, note = cached
    path = p.path or "/"
    for rule in rules:
        pref = rule.rstrip("*")
        if path.startswith(pref):
            return False, "robots.txt disallows " + rule + " (" + note + ")"
    return True, note


# 予行(300件)が示したこと: HTTPで応答した97件のうち65件は 401/402/403 だった。
# これを「MCPを話さない」と数えて公開すれば、鍵がかかっているだけの相手について
# 偽の事実を publish することになる(規則3)。到達不能を held にしたのと同じ理屈で、
# 「我々には測れなかった」と「測った上で条件を満たさない」を分ける。
# 公開済みの語彙(held / pending)は増やさず、outcome で精度を足す。
AUTH_CODES = {401, 402, 403, 407}
GATEWAY_CODES = {502, 503, 504} | set(range(520, 531))
REDIRECT_CODES = {301, 302, 303, 307, 308}


def classify_http(code):
    """(state, outcome, reason) を返す。state は公開済みの held / pending のみ。"""
    if code in AUTH_CODES:
        return ("held", "authorization_required",
                "the address answered and asked for authorization (HTTP " + str(code) + "). "
                "Whether it speaks MCP was not measured, because we do not hold a key and did not try to obtain one.")
    if code in GATEWAY_CODES:
        return ("held", "gateway_error",
                "an intermediary answered with HTTP " + str(code) + " and the origin did not answer at all, "
                "so nothing here is a statement about the server itself.")
    if code == 405:
        return ("held", "method_not_allowed",
                "the address refused POST (HTTP 405). The registered address may be a stream endpoint rather "
                "than a message endpoint, so whether it speaks MCP was not measured.")
    if code in (404, 410):
        return ("pending", "no_mcp_at_declared_address",
                "a valid MCP initialize was answered with HTTP " + str(code) + ", so no MCP server was found "
                "at the address the operator registered.")
    return ("pending", "initialize_rejected",
            "a valid MCP initialize was answered with HTTP " + str(code) + ".")


def rpc(url, payload, session_id=None, notify=False):
    """JSON-RPC を1回。SSE で返すサーバーがあるので両方読む。"""
    headers = {
        "content-type": "application/json",
        "accept": "application/json, text/event-stream",
        "user-agent": UA,
        "mcp-protocol-version": PROTOCOL,
    }
    if session_id:
        headers["mcp-session-id"] = session_id
    data = canon(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        status = r.status
        sid = r.headers.get("mcp-session-id")
        ctype = (r.headers.get("content-type") or "").lower()
        body = b"" if notify else r.read(400000)
    if notify:
        return status, sid, None
    text = body.decode("utf-8", "replace")
    if "text/event-stream" in ctype:
        # 最初の data: 行だけ読む。ストリームに居座らない。
        for line in text.splitlines():
            if line.startswith("data:"):
                text = line[5:].strip()
                break
    try:
        return status, sid, json.loads(text)
    except Exception:
        return status, sid, None


# 報酬・課金の開示が、agent card のどこに置かれているか。
#
# 2026-08 時点で、agent card に報酬開示を置く標準の場所は無い。我々は
# "compensation" を使っているが、それは我々の決めごとであって規格ではない。
# 我々の名前だけを探して「開示が無い」と数えれば、それは相手についての観測ではなく、
# 我々の語彙が普及していないという観測を、相手の落ち度として publish することになる。
# よって、他所で使われていそうな名前も見て、どの名前で見つかったかを記録する。
# 見つからない件数が多いはずで、report ではその意味を、上のとおりに書くこと。
COMPENSATION_KEYS = ("compensation", "pricing", "payment", "payments", "monetization",
                     "billing", "fees", "cost", "price", "x-compensation")


def compensation_fields(card):
    """開示らしきものが、どの名前で置かれていたかを返す。無ければ空リスト。"""
    found = []
    for k in COMPENSATION_KEYS:
        v = card.get(k)
        if isinstance(v, (dict, list)) and len(v) > 0:
            found.append(k)
        elif isinstance(v, str) and v.strip():
            found.append(k)
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            found.append(k)
    caps = card.get("capabilities")
    if isinstance(caps, dict):
        for k in COMPENSATION_KEYS:
            if caps.get(k):
                found.append("capabilities." + k)
    ext = card.get("extensions")
    if isinstance(ext, list):
        for e in ext:
            if isinstance(e, dict):
                u = str(e.get("uri") or e.get("name") or "").lower()
                if any(w in u for w in ("compensation", "pricing", "payment", "monet", "billing")):
                    found.append("extensions:" + u[:60])
    return sorted(set(found))


def measure(url):
    """1エンドポイント。read only。tools/call は呼ばない。"""
    out = {
        "endpoint": url, "measured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "answered": None, "initialize_ok": None, "tools_listed": None,
        "speaks_mcp": None, "tool_count": None,
        "agent_card": None, "agent_card_note": None,
        "compensation_disclosed": None, "compensation_fields": None,
        "state": None, "outcome": None, "reason": None, "server_name": None,
        "http_status": None, "session_required": None, "redirected_to": None,
    }
    ok, rnote = robots_allows(url)
    out["robots"] = rnote
    if not ok:
        out["state"] = "skipped"
        out["outcome"] = "robots_disallowed"
        out["reason"] = rnote
        return out

    p = urllib.parse.urlparse(url)
    host = p.hostname or ""

    # 1. initialize。リダイレクトは一度だけ追う(無限に追わない)。
    target = url
    sid = None
    followed = 0
    while True:
        try:
            host_gate(urllib.parse.urlparse(target).hostname or host)
            st, sid, res = rpc(target, {
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": PROTOCOL,
                           "capabilities": {},
                           "clientInfo": {"name": "horizon-shield-survey", "version": "1.0"}}
            })
            out["http_status"] = st
            out["answered"] = True
            out["session_required"] = bool(sid)
            if not (isinstance(res, dict) and "result" in res):
                out["initialize_ok"] = False
                out["speaks_mcp"] = False
                out["state"] = "pending"
                out["outcome"] = "no_result_in_initialize"
                out["reason"] = "the address answered HTTP " + str(st) + " but the initialize response carried no result"
                return out
            info = (res.get("result") or {}).get("serverInfo") or {}
            out["server_name"] = info.get("name")
            out["initialize_ok"] = True
            out["speaks_mcp"] = True   # initialize に答えた時点で MCP を話している
            break
        except urllib.error.HTTPError as e:
            loc = None
            try: loc = e.headers.get("Location")
            except Exception: loc = None
            if e.code in REDIRECT_CODES and loc and followed == 0:
                target = urllib.parse.urljoin(target, loc)
                out["redirected_to"] = target
                followed = 1
                continue
            state, outcome, reason = classify_http(e.code)
            out["http_status"] = e.code
            out["answered"] = True
            out["state"] = state
            out["outcome"] = outcome
            out["reason"] = reason
            # 測れていないものに false を書かない(規則2)。
            out["speaks_mcp"] = False if state == "pending" else None
            return out
        except Exception as e:
            # 到達できなかった。相手についての主張にはしない(規則2)。
            out["answered"] = False
            out["state"] = "held"
            out["outcome"] = "not_reached"
            out["reason"] = "not reached: " + describe_exc(e)
            return out

    # 2. initialized 通知。これを待つサーバーがある。通知なので応答は読まない。
    thost = urllib.parse.urlparse(target).hostname or host
    try:
        host_gate(thost)
        rpc(target, {"jsonrpc": "2.0", "method": "notifications/initialized"}, session_id=sid, notify=True)
    except Exception:
        pass

    # 3. tools/list
    try:
        host_gate(thost)
        st, _sid2, res = rpc(target, {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, session_id=sid)
        tools = ((res or {}).get("result") or {}).get("tools")
        if isinstance(tools, list):
            out["tools_listed"] = True
            out["tool_count"] = len(tools)
            out["tool_names"] = sorted(str(t.get("name")) for t in tools if isinstance(t, dict))[:50]
        else:
            out["tools_listed"] = False
            out["reason"] = "initialize answered but tools/list returned no tool array"
    except urllib.error.HTTPError as e:
        # 相手が答えた上での失敗。これは相手についての観測にしてよい。
        out["tools_listed"] = False
        out["reason"] = "initialize answered but tools/list was refused with HTTP %d" % e.code
    except Exception as e:
        # こちらが読み切れなかった。「一覧を出さない相手だ」とは書かない。
        out["tools_listed"] = None
        out["reason"] = "initialize answered but tools/list did not complete: " + describe_exc(e)

    # 4. agent card。読むだけ。
    #
    # ここも規則1が効く。カードを取りに行って失敗したことは、
    # 「この相手にはカードが無い」ではない。404 だけが「無い」であって、
    # 時間切れも 500 も証明書の失敗も、こちらが読めなかったという話である。
    out["agent_card"] = None
    out["agent_card_note"] = None
    out["compensation_disclosed"] = None
    out["compensation_fields"] = None
    try:
        host_gate(thost)
        tp = urllib.parse.urlparse(target)
        card_url = tp.scheme + "://" + tp.netloc + "/.well-known/agent-card.json"
        req = urllib.request.Request(card_url, headers={"User-Agent": UA, "accept": "application/json"})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            card = json.loads(r.read(200000).decode("utf-8", "replace"))
        if isinstance(card, dict):
            out["agent_card"] = bool(card.get("name"))
            out["agent_card_note"] = "read"
            found = compensation_fields(card)
            out["compensation_fields"] = found
            out["compensation_disclosed"] = bool(found)
        else:
            out["agent_card"] = False
            out["agent_card_note"] = "the document at that address is not a JSON object"
    except urllib.error.HTTPError as e:
        if e.code in (404, 410):
            out["agent_card"] = False
            out["agent_card_note"] = "no card at /.well-known/agent-card.json (HTTP %d)" % e.code
        else:
            out["agent_card_note"] = "card not read (HTTP %d)" % e.code
    except Exception as e:
        out["agent_card_note"] = "card not read: " + describe_exc(e)

    if out["state"] is None:
        out["state"] = "measured"
        out["outcome"] = "speaks_mcp_and_lists_tools" if out.get("tools_listed") else "speaks_mcp_no_tool_list"
    return out


def instrument_down_row(url):
    """相手についての行ではない。こちらが測れなかったという行である。"""
    return {
        "endpoint": url, "measured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "answered": None, "initialize_ok": None, "tools_listed": None,
        "speaks_mcp": None, "tool_count": None, "agent_card": None, "agent_card_note": None,
        "compensation_disclosed": None, "compensation_fields": None, "robots": None,
        "state": "held", "outcome": "instrument_down",
        "reason": ("not measured: our own instrument could not reach a known-good control address, "
                   "so this row is a statement about our network, not about this server."),
        "server_name": None, "http_status": None, "session_required": None, "redirected_to": None,
    }


RETRY_SLEEP = 1.5
MAX_ATTEMPTS = 4


def measure_guarded(url, verbose=True, retries=1):
    """measure() を計器の健康診断で包む。

    到達できなかったときだけ、ここが働く。
      - 一度だけ間を置いて測り直す(resolver の一瞬のつまずきを、相手についての
        永続的な主張に変えないため)。
      - それでも駄目なら、対照先でこちらが生きているか確かめる。
      - こちらが落ちていて、そのあと回復したなら、その間の結果は捨てて測り直す。
      - 回復しないなら走行を中止し、相手についての行は書かない。
    """
    rec = None
    tried = 0
    while tried < MAX_ATTEMPTS:
        if _abort.is_set():
            return instrument_down_row(url)
        wait_healthy()
        if _abort.is_set():
            return instrument_down_row(url)
        rec = measure(url)
        if rec.get("outcome") != "not_reached":
            health_note_success()
            if tried:
                rec["reason"] = (rec.get("reason") or "")
                rec["retried"] = tried
            return rec
        recovered = health_note_failure(verbose=verbose)
        if _abort.is_set():
            return instrument_down_row(url)
        tried += 1
        if tried < MAX_ATTEMPTS and (recovered or tried <= retries):
            time.sleep(RETRY_SLEEP)
            continue
        break
    if rec is not None:
        rec["retried"] = tried
        rec["reason"] = (rec.get("reason") or "") + " (attempts: %d)" % (tried + 1)
    return rec


def stamp(rec):
    body = {k: rec[k] for k in rec if k != "record_sha256"}
    rec["record_sha256"] = sha256hex(canon(body))
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--sample", type=int, default=0, help="無作為抽出でこの件数だけ測る(予行用)")
    ap.add_argument("--seed", type=int, default=20260823)
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--workers", type=int, default=GLOBAL_WORKERS)
    ap.add_argument("--keep-unreached", action="store_true",
                    help="--resume のとき、到達できなかった行も測定済みとして扱う"
                         "(既定では測り直す。計器側の失敗と相手側の不在を、行からは区別できないため)")
    a = ap.parse_args()

    urls = [l.strip() for l in open(a.input, encoding="utf-8") if l.strip()]
    if a.sample:
        random.Random(a.seed).shuffle(urls)
        urls = urls[:a.sample]

    # 再開の扱い。
    # 「到達できなかった」行は、既定では測定済みとして数えない。相手が居ないのか、
    # こちらが落ちていたのかを、その行だけからは決められないからである。同じ理由で
    # instrument_down は常に測り直す。最終集計は endpoint ごとに最後の行を採る。
    done = set()
    redo = 0
    if a.resume:
        try:
            for line in open(a.out, encoding="utf-8"):
                try: rec = json.loads(line)
                except Exception: continue
                ep = rec.get("endpoint")
                if not ep: continue
                oc = rec.get("outcome")
                if oc == "instrument_down" or (oc == "not_reached" and not a.keep_unreached):
                    done.discard(ep); redo += 1
                    continue
                done.add(ep)
        except FileNotFoundError:
            pass
    todo = [u for u in urls if u not in done]

    print("population %d / already done %d / to measure %d" % (len(urls), len(done), len(todo)), file=sys.stderr)
    if redo:
        print("  (うち %d 行は到達できなかった記録なので測り直す。--keep-unreached で抑止できる)"
              % redo, file=sys.stderr)
    print("read only, no tool calls, per-host interval %.1fs, %d workers" % (PER_HOST_INTERVAL, a.workers), file=sys.stderr)
    print("control: %s" % (", ".join(CONTROL_URLS)), file=sys.stderr)

    lock = threading.Lock()
    counts = defaultdict(int)
    started = time.time()
    with open(a.out, "a", encoding="utf-8") as fh, ThreadPoolExecutor(max_workers=a.workers) as ex:
        futures = {ex.submit(measure_guarded, u): u for u in todo}
        i = 0
        for fut in as_completed(futures):
            i += 1
            try:
                rec = fut.result()
            except Exception as e:
                rec = {"endpoint": futures[fut], "state": "held",
                       "reason": "walker error: " + describe_exc(e), "answered": None,
                       "speaks_mcp": None,
                       "measured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
            stamp(rec)
            with lock:
                fh.write(canon(rec) + "\n"); fh.flush()
                counts[rec.get("state")] += 1
                if rec.get("answered"): counts["answered"] += 1
                if rec.get("speaks_mcp"): counts["speaks_mcp"] += 1
            if i % 10 == 0 or i == len(todo):
                el = time.time() - started
                print("  %d/%d  %.2f/s  answered=%d speaks_mcp=%d held=%d skipped=%d pending=%d"
                      % (i, len(todo), i / el if el else 0, counts["answered"], counts["speaks_mcp"],
                         counts["held"], counts["skipped"], counts["pending"]), file=sys.stderr)

    print(json.dumps({k: counts[k] for k in sorted(counts)}, ensure_ascii=False), file=sys.stderr)
    if _health_log:
        print("health events: " + canon(_health_log), file=sys.stderr)
        with open(a.out + ".health.json", "w", encoding="utf-8") as hf:
            hf.write(canon({"out": a.out, "events": _health_log,
                            "control": list(CONTROL_URLS),
                            "trip": UNREACHED_TRIP, "max_wait_s": CONTROL_MAX_WAIT}) + "\n")
    if _abort.is_set():
        print("ABORTED: 計器が回復しなかったため、走行を途中で止めた。"
              "書けた行までは有効で、残りは行が存在しない。--resume で続けられる。", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
