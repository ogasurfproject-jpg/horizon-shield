# -*- coding: utf-8 -*-
"""
走行2で pending に落ちた 918 件を、現行の MCP(2026-07-28)の作法で当て直す。

なぜ (2026-08-24):
  報告書1は「pending 918 件のうち、いくつが我々の作法違いのせいかは分からない。
  上限が918だとしか言えない」と書いて公開した。上限を実数に変えるのがこの走行である。

  走行2は 2025年代の作法で測っている。initialize を送り、Mcp-Session-Id を扱い、
  notifications/initialized を送る。現行の 2026-07-28 はその3つを全部やめた。
  現行だけに対応したサーバは、走行2では「MCPを話していない」側に落ちる。

作法は仕様から取った。書き写しではなく、仕様の文をそのまま根拠にしている:
  ・server/discover は「Servers MUST implement it」。だから一発で足りる。
    https://modelcontextprotocol.io/specification/2026-07-28/server/discover
  ・POST に MCP-Protocol-Version と Mcp-Method が REQUIRED。
    Mcp-Name が要るのは tools/call, resources/read, prompts/get だけなので付けない。
  ・Accept は application/json と text/event-stream の両方を列挙すること。
    https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http

判定も仕様の後方互換の節に書いてある。こちらで決めていない:
  ・200 + result           -> 現行の作法で答えた。走行2の判定は我々のせいだった。
  ・400 + -32022/-32021    -> 現行のサーバ。版が合わないだけ。やはり我々のせい。
  ・400 + -32020           -> ヘッダと本文が食い違っている。こちらの実装の誤り。
  ・404 + -32601           -> サーバは居るが server/discover が無い。
                             MUST なので、現行の版ではない。走行2の判定が正しい。
  ・その他/本文が JSON-RPC でない -> 旧来側。走行2の判定が正しい。
  ・届かない               -> held。今回も測れていない。数えない。

走行2と同じ規律を持つ:
  ・対照アドレスを持ち、連続失敗が続いたら自分を疑い、回復しなければ中止する。
  ・robots を読み直す。前回許されていても、いま断られていれば当てない。
  ・読むだけ。ツールは一つも呼ばない。
  ・held と pending を混ぜない。

使い方(ネットワークに出られる端末で):
  python3 tools/survey2_recheck.py \
      verify-directory/survey/data/survey1_walk_2026-08-23_run2.jsonl \
      --out verify-directory/survey/data/survey2_recheck_2026-08-24.jsonl
  python3 tools/survey2_recheck.py ... --limit 20     # まず20件だけ試す
"""

import argparse, io, json, os, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import survey1_walk as W  # noqa: E402  対照probe・robots・例外の説明を使い回す

PROTOCOL = "2026-07-28"
CLIENT = {"name": "HORIZON-SHIELD-survey", "version": "2.0.0"}

# 走行2で「測ったが不成立」に入った outcome。ここだけを当て直す。
# 届かなかったもの(held)と robots で断ったもの(skipped)は対象にしない。
# held を混ぜれば、今回届いたかどうかで数が動き、前回の話ではなくなる。
PENDING_OUTCOMES = ("no_result_in_initialize", "no_mcp_at_declared_address",
                    "initialize_rejected")

MODERN_ERROR_CODES = {
    -32022: "UnsupportedProtocolVersion",
    -32021: "MissingRequiredClientCapability",
    -32020: "HeaderMismatch",
}


def discover(url):
    """server/discover を1回だけ送る。仕様の形をそのまま組む。"""
    body = {
        "jsonrpc": "2.0", "id": "discover-1", "method": "server/discover",
        "params": {"_meta": {
            "io.modelcontextprotocol/protocolVersion": PROTOCOL,
            "io.modelcontextprotocol/clientInfo": CLIENT,
            "io.modelcontextprotocol/clientCapabilities": {},
        }},
    }
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), method="POST", headers={
        "content-type": "application/json",
        "accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": PROTOCOL,
        "Mcp-Method": "server/discover",
        "user-agent": W.UA,
    })
    try:
        with urllib.request.urlopen(req, timeout=W.TIMEOUT) as r:
            return r.getcode(), r.read(200000).decode("utf-8", "replace"), None
    except urllib.error.HTTPError as e:
        try:
            payload = e.read(200000).decode("utf-8", "replace")
        except Exception:
            payload = ""
        return e.code, payload, None
    except Exception as e:
        return None, "", W.describe_exc(e)


def parse_jsonrpc(text):
    """本文が JSON-RPC かどうかを見る。SSE で来ることもある。"""
    t = (text or "").strip()
    if t.startswith("event:") or t.startswith("data:"):
        for line in t.splitlines():
            if line.startswith("data:"):
                t = line[5:].strip()
                break
    if not t.startswith("{"):
        return None
    try:
        return json.loads(t)
    except Exception:
        return None


def judge(code, text, err):
    """仕様の後方互換の節どおりに分ける。こちらで足した規則は無い。"""
    if code is None:
        return "held", "not reached: " + str(err), {}
    doc = parse_jsonrpc(text)
    res = (doc or {}).get("result")
    e = (doc or {}).get("error") or {}
    ecode = e.get("code")

    if code == 200 and isinstance(res, dict) and "supportedVersions" in res:
        info = ((res.get("_meta") or {}).get("io.modelcontextprotocol/serverInfo") or {})
        return "modern_answered", "server/discover answered", {
            "supported_versions": res.get("supportedVersions"),
            "capabilities": sorted((res.get("capabilities") or {}).keys()),
            "server_name": info.get("name"),
            "result_type": res.get("resultType"),
        }
    if ecode in MODERN_ERROR_CODES:
        return ("our_request_wrong" if ecode == -32020 else "modern_answered"), \
               "modern JSON-RPC error %d (%s)" % (ecode, MODERN_ERROR_CODES[ecode]), \
               {"error_code": ecode, "supported": e.get("data", {}).get("supported")
                if isinstance(e.get("data"), dict) else None}
    if ecode == -32601:
        # server/discover は MUST。無いなら現行の版ではない。
        return "not_modern", "method not found (-32601): server/discover is MUST in 2026-07-28", {}
    if doc is not None and ("result" in doc or "error" in doc):
        return "not_modern", "JSON-RPC reply but not a discover result (code=%s)" % ecode, {}
    return "not_modern", "HTTP %s, body is not a JSON-RPC message" % code, {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run2_jsonl")
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--sleep", type=float, default=0.6)
    a = ap.parse_args()

    targets = []
    for line in io.open(a.run2_jsonl, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except Exception:
            continue
        if d.get("outcome") in PENDING_OUTCOMES:
            u = d.get("url") or d.get("endpoint") or d.get("target")
            if u:
                targets.append({"url": u, "run2_outcome": d.get("outcome"),
                                "run2_reason": d.get("reason")})
    if a.limit:
        targets = targets[:a.limit]

    print("走行2で pending だったもの: %d 件" % len(targets))
    print("作法: MCP %s / server/discover を1回。読むだけ。\n" % PROTOCOL)
    if not W.control_ok():
        sys.exit("対照アドレスに届きません。こちら側が先に壊れています。中止します。")

    counts, unreached_run, out = {}, 0, io.open(a.out, "w", encoding="utf-8")
    for i, t in enumerate(targets, 1):
        if not W.robots_allows(t["url"]):
            verdict, note, extra = "skipped", "robots disallowed at recheck time", {}
        else:
            code, text, err = discover(t["url"])
            verdict, note, extra = judge(code, text, err)
            extra["http"] = code

        if verdict == "held":
            unreached_run += 1
            if unreached_run >= W.UNREACHED_TRIP:
                print("\n連続で届きません(%d件)。自分を疑います。" % unreached_run)
                if not W.wait_healthy():
                    out.close()
                    sys.exit("対照が回復しませんでした。ここで中止します。"
                             "途中までの記録は残しますが、報告には使いません。")
                unreached_run = 0
        else:
            unreached_run = 0

        rec = dict(t); rec.update({"verdict": verdict, "note": note,
                                   "protocol": PROTOCOL, "method": "server/discover"})
        rec.update(extra)
        out.write(json.dumps(W.stamp(rec) if hasattr(W, "stamp") else rec,
                             ensure_ascii=False) + "\n")
        out.flush()
        counts[verdict] = counts.get(verdict, 0) + 1
        if i % 25 == 0 or i == len(targets):
            print("  %5d / %d   %s" % (i, len(targets),
                  "  ".join("%s=%d" % kv for kv in sorted(counts.items()))))
        time.sleep(a.sleep)
    out.close()

    print("\n結果:")
    for k in sorted(counts):
        print("  %-20s %5d" % (k, counts[k]))
    mod = counts.get("modern_answered", 0)
    print("\n報告書1は pending 918 件の上限しか言えなかった。")
    print("このうち %d 件は、現行の作法では答えた。走行2の判定は我々の作法違いだった。" % mod)
    if counts.get("our_request_wrong"):
        print("※ %d 件は HeaderMismatch。こちらの組み立てが誤っている。"
              "直してから数え直すこと。" % counts["our_request_wrong"])
    print("\n書いた: %s" % a.out)


if __name__ == "__main__":
    main()
