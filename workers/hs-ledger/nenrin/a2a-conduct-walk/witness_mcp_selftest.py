#!/usr/bin/env python3
"""witness_mcp_selftest.py : drives conduct_witness_mcp.py as a real subprocess over stdio against a fake agent on
localhost. No outside network. Exit 1 on any miss.

    python3 witness_mcp_selftest.py

Checks: initialize, tools/list (one tool, required fields), tools/call witness_walk against an honest fake agent
(PASS 5/5, submitted to the fake intake, sha256 equals sha256 of the returned canonical bytes), submit false sends
nothing, a dishonest agent (no echo) is FAIL 4/5 and still filed (a FAIL is a record, not an error), bad input is
isError, unknown method is -32601, notifications get no reply.
"""
import hashlib
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
EXT = "https://gate.horizonshield.dev/ext/conduct/v1"
STATE = {"echo": True, "intake_hits": []}


class Agent(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, status, body, headers=None):
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        base = "https://127.0.0.1:%d" % self.server.server_port   # the card must name https URLs (section 2); the selftest transport rewrites them
        if self.path == "/.well-known/agent-card.json":
            return self._send(200, {
                "name": "Fake Agent", "description": "selftest", "url": base + "/a2a", "version": "1",
                "capabilities": {"extensions": [{"uri": EXT, "required": False, "params": {
                    "compensation": {"paid_by": "public", "referral_fee": False, "listing_fee": False, "success_fee_pct": 0},
                    "measured_endpoints": [base + "/a2a"],
                    "conduct_record": "https://gate.horizonshield.dev/history?endpoint=x",
                    "witness_intake": base + "/witness"}}]},
                "skills": [], "defaultInputModes": ["text/plain"], "defaultOutputModes": ["application/json"]})
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
        if self.path == "/a2a":
            mid = body.get("id")
            hdr = {"A2A-Extensions": EXT} if STATE["echo"] else {}
            msg = {"messageId": "m", "role": "ROLE_AGENT", "parts": [{"text": "hi"}], "metadata": {EXT + "/endpoint": "x"}, "extensions": [EXT]}
            return self._send(200, {"jsonrpc": "2.0", "id": mid, "result": {"message": msg}}, hdr)
        if self.path == "/witness":
            STATE["intake_hits"].append(body)
            return self._send(200, {"ok": True, "sha256": hashlib.sha256(body["record_canonical"].encode("utf-8")).hexdigest(), "pending": len(STATE["intake_hits"])})
        return self._send(404, {"error": "not found"})


R = []


def t(name, ok, detail=""):
    R.append((name, bool(ok), str(detail)))


def main():
    srv = HTTPServer(("127.0.0.1", 0), Agent)
    port = srv.server_port
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % port

    # The card must name https URLs (section 2) and the tool refuses non-https origins, so the selftest transport rewrites
    # https://127.0.0.1:port to plain http for the fake. Protocol checks use the real subprocess; tool checks run in process.
    sys.path.insert(0, HERE)
    import conduct_witness_mcp as M
    import a2a_conduct_walk as W
    real_fetch = W.http_fetch
    def test_fetch(method, url, headers=None, body=None):
        return real_fetch(method, url.replace("https://127.0.0.1:", "http://127.0.0.1:"), headers, body)
    W.http_fetch = test_fetch
    hbase = "https://127.0.0.1:%d" % port

    # protocol, real subprocess
    p = subprocess.Popen([sys.executable, os.path.join(HERE, "conduct_witness_mcp.py")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8")
    def rpc(obj):
        p.stdin.write(json.dumps(obj) + "\n"); p.stdin.flush()
        return json.loads(p.stdout.readline())
    init = rpc({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "selftest", "version": "0"}}})
    t("initialize answers with the client's protocolVersion, tools capability and serverInfo", init.get("result", {}).get("protocolVersion") == "2025-06-18" and "tools" in init["result"]["capabilities"] and init["result"]["serverInfo"]["name"] == "conduct-witness", json.dumps(init)[:160])
    p.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n"); p.stdin.flush()
    lst = rpc({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
    tools = lst.get("result", {}).get("tools", [])
    t("notifications get no reply and tools/list lists exactly witness_walk with origin, witness_name, vantage required", lst.get("id") == 2 and len(tools) == 1 and tools[0]["name"] == "witness_walk" and sorted(tools[0]["inputSchema"]["required"]) == ["origin", "vantage", "witness_name"], json.dumps(lst)[:160])
    bad = rpc({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "witness_walk", "arguments": {"origin": "http://not-https.invalid", "witness_name": "x", "vantage": "y"}}})
    t("an http origin is refused as isError, not an exception", bad.get("result", {}).get("isError") is True, json.dumps(bad)[:160])
    unk = rpc({"jsonrpc": "2.0", "id": 4, "method": "resources/list"})
    t("unknown method is -32601", unk.get("error", {}).get("code") == -32601)
    unkt = rpc({"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "nope", "arguments": {}}})
    t("unknown tool is -32602", unkt.get("error", {}).get("code") == -32602)
    p.stdin.close(); p.wait(timeout=10)
    t("server exits cleanly when stdin closes", p.returncode == 0, "rc " + str(p.returncode))

    # tool logic, in process, against the fake agent (http allowed here by calling walk() directly through the runner)
    def run(args):
        a = dict(args); a["origin"] = hbase
        out = M.run_witness_walk(a)
        sc = out.get("structuredContent") or {}
        rec = json.loads(sc["record_canonical"])
        return rec, sc["record_canonical"], sc["sha256"], sc.get("submitted")
    rec, rc, sha, sub = run({"witness_name": "Selftest Witness", "vantage": "localhost"})
    t("honest fake agent: PASS 5/5", rec["verdict"]["outcome"] == "PASS" and rec["verdict"]["n_pass"] == 5 and rec["verdict"]["n_total"] == 5, json.dumps(rec["verdict"]))
    t("submitted: the intake received the same canonical bytes and answered with the same sha256, and the tool's sha256 is sha256 of those bytes", sub and sub["ok"] and sub["response"].get("sha256") == sha and STATE["intake_hits"][-1]["record_canonical"] == rc and hashlib.sha256(rc.encode("utf-8")).hexdigest() == sha, json.dumps(sub)[:160])
    t("the record carries the witness name and vantage and the 1.0 wire", rec["witness"] == {"name": "Selftest Witness", "vantage": "localhost"} and rec["conduct_ext"]["wire"] == "1.0")
    hits = len(STATE["intake_hits"])
    rec2, rc2, sha2, sub2 = run({"witness_name": "Quiet", "vantage": "localhost", "submit": False})
    t("submit false: nothing reaches the intake", sub2 is None and len(STATE["intake_hits"]) == hits)
    out_text = M.run_witness_walk({"origin": hbase, "witness_name": "Selftest Witness", "vantage": "localhost", "submit": False})["content"][0]["text"]
    t("the tool's first content block is a one-line human summary with the sha256", out_text.startswith("witness walk ") and "sha256 " in out_text and "not submitted" in out_text, out_text[:120])
    STATE["echo"] = False
    rec3, rc3, sha3, sub3 = run({"witness_name": "Selftest Witness", "vantage": "localhost"})
    t("dishonest agent (declares, does not echo): FAIL 4/5, and it is still filed (a FAIL is a record, not an error)", rec3["verdict"]["outcome"] == "FAIL" and rec3["verdict"]["n_pass"] == 4 and sub3 and sub3["ok"], json.dumps(rec3["verdict"]))
    STATE["echo"] = True
    rec4, rc4, sha4, sub4 = run({"witness_name": "Selftest Witness", "vantage": "localhost", "wire": "0.3"})
    t("0.3 wire walk records wire 0.3 and still passes against an agent that echoes both spellings? no: this fake echoes only A2A-Extensions, so the 0.3 walk must FAIL the echo assertion (a 0.3 client reads only X-A2A-Extensions)", rec4["conduct_ext"]["wire"] == "0.3" and rec4["verdict"]["outcome"] == "FAIL", json.dumps(rec4["verdict"]))

    # the MCP tool's own output shape, using the runner with the real function on an https-looking origin is not possible
    # offline; check the formatter on a synthetic record instead
    fake_out = M.run_witness_walk({"origin": "http://x", "witness_name": "a", "vantage": "b"})
    t("run_witness_walk refuses a non-https origin with isError", fake_out.get("isError") is True)

    srv.shutdown()
    ok = sum(1 for r in R if r[1])
    for r in R:
        if not r[1]:
            print("  NG  " + r[0] + "\n      " + r[2])
    print("=== %d / %d passed (conduct-witness-mcp selftest) ===" % (ok, len(R)))
    return 0 if ok == len(R) else 1


if __name__ == "__main__":
    sys.exit(main())
