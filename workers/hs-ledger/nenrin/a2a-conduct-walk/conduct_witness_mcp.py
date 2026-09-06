#!/usr/bin/env python3
"""conduct_witness_mcp.py : the witness walk as one MCP tool call, from YOUR machine.

A stdio MCP server (JSON-RPC 2.0, one message per line) with a single tool, witness_walk. Any MCP
capable agent (Claude Desktop, Claude Code, Cursor, an A2A agent with an MCP client) can call it.
The walk runs where this process runs, so the vantage is yours, not the register operator's. That
is the whole point: a record of an agent's conduct that the agent did not write, and that the
register operator did not write either.

    uvx --from "git+https://github.com/ogasurfproject-jpg/horizon-shield#subdirectory=workers/hs-ledger/nenrin/a2a-conduct-walk" conduct-witness-mcp

Claude Code:   claude mcp add conduct-witness -- uvx --from "git+https://github.com/ogasurfproject-jpg/horizon-shield#subdirectory=workers/hs-ledger/nenrin/a2a-conduct-walk" conduct-witness-mcp
Claude Desktop / Cursor (mcpServers):
    {"conduct-witness": {"command": "uvx", "args": ["--from", "git+https://github.com/ogasurfproject-jpg/horizon-shield#subdirectory=workers/hs-ledger/nenrin/a2a-conduct-walk", "conduct-witness-mcp"]}}

Standard library only. No key, no account, no payment. The record is filed under the witness name
you give (or "anonymous") at the intake the walked agent's own card names, pooled, bundled daily,
and stamped to Bitcoin through the JIDEC ledger. Nothing here judges quality; a PASS is one observation.
"""
import io
import json
import os
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import a2a_conduct_walk as W  # noqa: E402

SERVER = {"name": "conduct-witness", "version": "1.1.0"}
PROTOCOL_DEFAULT = "2024-11-05"

TOOL = {
    "name": "witness_walk",
    "description": (
        "Walk one agent the way section 4 of the A2A Conduct Extension v1 says, from this machine, and file the "
        "observation under your name at the witness intake the agent's own card names. Fetches the agent card twice, "
        "validates the extension declaration, sends one JSON-RPC message to the measured endpoint with the "
        "A2A-Extensions header, records every response body's sha256, and returns the record's sha256 plus the "
        "intake's answer. One observation, no score, no judgement of quality. Do not call this on an agent whose "
        "owner has asked not to be measured."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "origin": {"type": "string", "description": "agent origin, e.g. https://mcp.horizonshield.dev (the card is at <origin>/.well-known/agent-card.json)"},
            "witness_name": {"type": "string", "description": "who you are (a person, a project, or 'anonymous'). This is what the monthly ring counts witnesses by."},
            "vantage": {"type": "string", "description": "where the walk is taken from, e.g. 'Claude Desktop on a laptop in Osaka' or 'VPS eu-west'"},
            "mode": {"type": "string", "enum": ["a2a", "mcp"], "default": "a2a", "description": "node 3 body: an A2A message (default) or MCP initialize"},
            "wire": {"type": "string", "enum": ["1.0", "0.3"], "default": "1.0", "description": "a2a mode only: 1.0 sends SendMessage with A2A-Extensions; 0.3 sends message/send with X-A2A-Extensions"},
            "endpoint": {"type": "string", "description": "measured endpoint to POST; default: the card's first params.measured_endpoints entry"},
            "submit": {"type": "boolean", "default": True, "description": "file the record at the card's witness_intake (default true). false = walk only, nothing leaves this machine"},
            "transport": {"type": "string", "enum": ["urllib", "curl"], "default": "urllib", "description": "use curl when an edge answers 403 to Python's urllib"},
        },
        "required": ["origin", "witness_name", "vantage"],
    },
}


def _text(s):
    return {"content": [{"type": "text", "text": s}]}


def run_witness_walk(args):
    origin = str(args.get("origin") or "").strip()
    name = str(args.get("witness_name") or "").strip() or "anonymous"
    vantage = str(args.get("vantage") or "").strip()
    if not origin.startswith("https://"):
        return {"isError": True, **_text("origin must be an https URL")}
    if not vantage:
        return {"isError": True, **_text("vantage is required: say where this walk is taken from")}
    mode = "mcp" if args.get("mode") == "mcp" else "a2a"
    wire = "0.3" if str(args.get("wire") or "1.0") == "0.3" else "1.0"
    fetch = W.curl_fetch if args.get("transport") == "curl" else W.http_fetch
    rec = W.walk(origin, args.get("endpoint") or None, mode, name, vantage, fetch=fetch, wire=wire)
    rc = W.canonical(rec)
    sha = W.sha256_hex(rc)
    out = {
        "sha256": sha,
        "purpose": rec["purpose"],
        "outcome": rec["verdict"]["outcome"],
        "n_pass": rec["verdict"]["n_pass"],
        "n_total": rec["verdict"]["n_total"],
        "assertions": [{"claim": a["claim"], "result": a["result"]} for a in rec["assertions"]],
        "nodes": [{"n": n["n"], "url": n["request"]["url"], "status": n["response"]["status"], "body_sha256": n["response"]["body_sha256"]} for n in rec["nodes"] if n.get("kind") == "fetch"],
        "witness": rec["witness"],
        "wire": rec["conduct_ext"].get("wire"),
        "conduct_record": rec["conduct_ext"].get("conduct_record"),
        "submitted": None,
    }
    if args.get("submit", True):
        intake = rec["conduct_ext"].get("witness_intake")
        if not intake:
            out["submitted"] = {"ok": False, "reason": "the card names no witness_intake; nothing was sent"}
        else:
            st, j = W.submit(intake, rc, fetch=fetch)
            out["submitted"] = {"ok": st in (200, 201), "http": st, "intake": intake, "response": j}
    out["record_canonical"] = rc
    summary = "witness walk %s: %s %d/%d, sha256 %s" % (rec["purpose"], out["outcome"], out["n_pass"], out["n_total"], sha)
    if out["submitted"]:
        summary += "; submitted http %s to %s" % (out["submitted"].get("http"), out["submitted"].get("intake")) if out["submitted"].get("intake") else "; not submitted: " + out["submitted"].get("reason", "")
    else:
        summary += "; not submitted (submit false)"
    return {"content": [{"type": "text", "text": summary}, {"type": "text", "text": json.dumps(out, ensure_ascii=False, indent=1)}], "structuredContent": out}


def handle(msg):
    mid = msg.get("id")
    method = msg.get("method")
    params = msg.get("params") or {}
    if method == "initialize":
        return {"jsonrpc": "2.0", "id": mid, "result": {"protocolVersion": params.get("protocolVersion") or PROTOCOL_DEFAULT, "capabilities": {"tools": {}}, "serverInfo": SERVER,
                                                        "instructions": "One tool: witness_walk. It walks an agent from this machine and files the observation under the witness name given. Ask the human for their witness_name once and reuse it."}}
    if method == "ping":
        return {"jsonrpc": "2.0", "id": mid, "result": {}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": mid, "result": {"tools": [TOOL]}}
    if method == "tools/call":
        if params.get("name") != "witness_walk":
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32602, "message": "unknown tool: %s" % params.get("name")}}
        try:
            return {"jsonrpc": "2.0", "id": mid, "result": run_witness_walk(params.get("arguments") or {})}
        except Exception as e:  # the walk itself never raises on a bad agent; this is a transport or programming error
            return {"jsonrpc": "2.0", "id": mid, "result": {"isError": True, **_text("witness_walk failed: %s\n%s" % (e, traceback.format_exc()[-800:]))}}
    if method and method.startswith("notifications/"):
        return None
    if mid is None:
        return None
    return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "method not found: %s" % method}}


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv and argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8")
    stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", write_through=True)

    def emit(obj):
        # stdout is a pipe: the BufferedWriter under us holds bytes until flushed, and the client waits forever.
        stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
        stdout.flush()

    while True:
        line = stdin.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception:
            emit({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}})
            continue
        if isinstance(msg, list):
            replies = [r for r in (handle(m) for m in msg if isinstance(m, dict)) if r is not None]
            if replies:
                emit(replies)
            continue
        if not isinstance(msg, dict):
            continue
        reply = handle(msg)
        if reply is not None:
            emit(reply)
    return 0


if __name__ == "__main__":
    sys.exit(main())
