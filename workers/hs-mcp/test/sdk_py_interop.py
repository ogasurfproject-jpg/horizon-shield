#!/usr/bin/env python3
"""公式 a2a-sdk (Python, 1.1.x) の client で、この Worker の A2A 面を叩く。ネットワーク無し。

なぜ: JS の公式 SDK と Python の公式 SDK は card の読み方も線の版の選び方も別に書かれとる。
      片方が通っても、もう片方が通る保証は無い。両方が通って「A2A 1.0 に載った」。

何を: test/serve_local.mjs で本物の Worker を local に立て、a2a-sdk を 2 通りで当てる。
        1.0 : card の supportedInterfaces(1.0 を優先)を読み、SendMessage、A2A-Extensions
        0.3 : 0.3 形の card(url / preferredTransport / protocolVersion)を渡し、SDK の互換路
              (message/send、A2A-Extensions と X-A2A-Extensions の両方を送る)を通す

使い方 (workers/hs-mcp で):
    python3 -m pip install "a2a-sdk>=1.1,<2"
    python3 test/sdk_py_interop.py                        (この Worker)
    python3 test/sdk_py_interop.py ../hs-ledger/src/worker.js /a2a
    python3 test/sdk_py_interop.py ../hs-jidec-mcp/src/worker.js /a2a
    python3 test/sdk_py_interop.py ../hs-verify-gate/src/worker.js /a2a
1 つでも落ちたら exit 1。
"""
import asyncio
import json
import os
import subprocess
import sys

EXT = "https://gate.horizonshield.dev/ext/conduct/v1"
MODULE = sys.argv[1] if len(sys.argv) > 1 else "./src/mcp.js"
A2A_PATH = sys.argv[2] if len(sys.argv) > 2 else "/"
TEXT = sys.argv[3] if len(sys.argv) > 3 else "a2a-conduct sdk interop: 外壁塗装で120万、今日契約なら半額と言われた"
HERE = os.path.dirname(os.path.abspath(__file__))

fails = 0


def ok(cond, name, extra=""):
    global fails
    print(("PASS " if cond else "FAIL ") + name + (("  " + str(extra)) if extra else ""))
    if not cond:
        fails += 1


async def main():
    import httpx
    from a2a.client import ClientConfig, ClientFactory
    from a2a.client.card_resolver import parse_agent_card
    from a2a.client.client import ClientCallContext
    from a2a.client.service_parameters import ServiceParametersFactory, with_a2a_extensions
    from a2a.types import Message, Part, Role, SendMessageRequest

    proc = subprocess.Popen(["node", os.path.join(HERE, "serve_local.mjs"), MODULE], stdout=subprocess.PIPE, text=True)
    line = proc.stdout.readline().strip()
    assert line.startswith("PORT="), line
    base = "http://127.0.0.1:" + line[5:]

    seen = []

    async def spy(request):  # httpx event hook: 要求ヘッダと method を記録
        try:
            body = json.loads(request.content or b"{}")
        except Exception:
            body = {}
        seen.append({"req": dict(request.headers), "method": body.get("method"), "res": None})

    async def spy_res(response):
        if seen:
            seen[-1]["res"] = dict(response.headers)

    try:
        async with httpx.AsyncClient(event_hooks={"request": [spy], "response": [spy_res]}, timeout=30) as hc:
            raw = (await hc.get(base + "/.well-known/agent-card.json")).json()

            # ---- 1. A2A 1.0 ----
            card10 = json.loads(json.dumps(raw))
            for i in card10.get("supportedInterfaces", []):
                i["url"] = base + A2A_PATH
            card10["url"] = base + A2A_PATH
            card = parse_agent_card(card10)
            picked = [i for i in card.supported_interfaces if i.protocol_version == "1.0"]
            ok(bool(picked), "1.0 card: official Python SDK parses the card and sees a 1.0 interface", [i.protocol_binding for i in card.supported_interfaces])
            factory = ClientFactory(ClientConfig(httpx_client=hc, streaming=False))
            client = factory.create(card)
            seen.clear()
            req = SendMessageRequest(message=Message(message_id="py-10-1", role=Role.ROLE_USER, parts=[Part(text=TEXT)]))
            ctx = ClientCallContext(service_parameters=ServiceParametersFactory.create([with_a2a_extensions([EXT])]))
            err = None
            events = []
            try:
                async for ev in client.send_message(req, context=ctx):
                    events.append(ev)
            except Exception as e:  # noqa: BLE001
                err = e
            call = next((s for s in seen if s["method"]), None)
            ok(err is None, "1.0 wire: send_message completes without a parse error", repr(err) if err else "")
            ok(call and call["method"] == "SendMessage", "1.0 wire: the SDK sent method SendMessage", call and call["method"])
            ok(call and call["req"].get("a2a-extensions") == EXT, "1.0 wire: the SDK sent A2A-Extensions", call and call["req"].get("a2a-extensions"))
            ok(call and call["res"] and call["res"].get("a2a-extensions") == EXT, "1.0 wire: server echoed A2A-Extensions", call and call["res"] and call["res"].get("a2a-extensions"))
            payload = events[0] if events else None
            # StreamResponse: task か message のどっちか
            obj = None
            if payload is not None:
                obj = getattr(payload, "task", None) or getattr(payload, "message", None)
                if obj is not None and not getattr(obj, "id", None) and not getattr(obj, "message_id", None):
                    obj = getattr(payload, "message", None)
            md = None
            if obj is not None:
                md = getattr(obj, "metadata", None)
                try:
                    md = dict(md) if md is not None else None
                except Exception:  # noqa: BLE001
                    md = None
            ok(md is not None and (EXT + "/endpoint") in md and (EXT + "/conduct_record") in md and (EXT + "/witness_intake") in md, "1.0 wire: the 3 conduct metadata keys are present on the parsed result", sorted(md.keys()) if md else md)
            msg = getattr(obj, "message", None) if obj is not None and hasattr(obj, "status") else obj
            if obj is not None and hasattr(obj, "status"):
                msg = obj.status.message if obj.status else None
            exts = list(getattr(msg, "extensions", []) or []) if msg is not None else []
            ok(EXT in exts, "1.0 wire: Message.extensions carries the URI", exts)

            # ---- 2. A2A 0.3 (SDK の互換路) ----
            card03 = json.loads(json.dumps(raw))
            card03.pop("supportedInterfaces", None)
            card03["url"] = base + A2A_PATH
            card03["preferredTransport"] = "JSONRPC"
            card03["protocolVersion"] = "0.3.0"
            card = parse_agent_card(card03)
            ok(any(i.protocol_version.startswith("0.3") for i in card.supported_interfaces), "0.3 card: the SDK maps url/preferredTransport to a 0.3 interface", [i.protocol_version for i in card.supported_interfaces])
            client = factory.create(card)
            seen.clear()
            err = None
            events = []
            try:
                async for ev in client.send_message(SendMessageRequest(message=Message(message_id="py-03-1", role=Role.ROLE_USER, parts=[Part(text=TEXT)])), context=ctx):
                    events.append(ev)
            except Exception as e:  # noqa: BLE001
                err = e
            call = next((s for s in seen if s["method"]), None)
            ok(err is None, "0.3 wire: send_message completes without a parse error", repr(err) if err else "")
            ok(call and call["method"] == "message/send", "0.3 wire: the SDK sent method message/send", call and call["method"])
            ok(call and call["req"].get("x-a2a-extensions") == EXT, "0.3 wire: the SDK sent X-A2A-Extensions (compat mirror)", call and call["req"].get("x-a2a-extensions"))
            ok(call and call["res"] and call["res"].get("x-a2a-extensions") == EXT and call["res"].get("a2a-extensions") == EXT, "0.3 wire: server echoed both spellings", call and call["res"] and [call["res"].get("x-a2a-extensions"), call["res"].get("a2a-extensions")])
            payload = events[0] if events else None
            obj = (getattr(payload, "task", None) or getattr(payload, "message", None)) if payload is not None else None
            if obj is not None and not getattr(obj, "id", None) and not getattr(obj, "message_id", None):
                obj = getattr(payload, "message", None)
            md = None
            if obj is not None and getattr(obj, "metadata", None) is not None:
                try:
                    md = dict(obj.metadata)
                except Exception:  # noqa: BLE001
                    md = None
            ok(md is not None and (EXT + "/endpoint") in md, "0.3 wire: conduct metadata present on the parsed result", sorted(md.keys()) if md else md)

            # ---- 3. 有効化なし ----
            seen.clear()
            card = parse_agent_card(card10)
            client = factory.create(card)
            events = []
            async for ev in client.send_message(SendMessageRequest(message=Message(message_id="py-10-2", role=Role.ROLE_USER, parts=[Part(text=TEXT)]))):
                events.append(ev)
            call = next((s for s in seen if s["method"]), None)
            ok(call and call["res"] is not None and not call["res"].get("a2a-extensions") and not call["res"].get("x-a2a-extensions"), "no activation: no echo header")
    finally:
        proc.terminate()

    print("\n" + (f"{fails} FAIL" if fails else f"ALL PASS: official a2a-sdk (Python) client, both wires, against {MODULE} {A2A_PATH}"))
    sys.exit(1 if fails else 0)


asyncio.run(main())
