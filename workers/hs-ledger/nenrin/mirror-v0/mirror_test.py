#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Self test for nenrin-mirror-v0. Serves a synthetic ledger on loopback, mirrors it, verifies it offline,
tampers with the copy, serves a lying object, diffs two mirrors. No network beyond 127.0.0.1."""
import hashlib, json, os, shutil, subprocess, sys, tempfile, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mirror as M  # noqa: E402


def sha(b):
    return hashlib.sha256(b).hexdigest()


class Ledger:
    """A tiny ledger: entries 1..3, entry 3 a batch pointing at two objects, one of which the server can be told to lie about."""
    def __init__(self, port):
        self.port = port
        self.objects = {}
        obj_a = json.dumps({"schema": "a2a-contract-v0", "contract_id": "a" * 32}, sort_keys=True, separators=(",", ":")).encode()
        obj_b = json.dumps({"schema": "a2a-execution-v0", "performed_actions": ["read"]}, sort_keys=True, separators=(",", ":")).encode()
        self.objects[sha(obj_a)] = obj_a
        self.objects[sha(obj_b)] = obj_b
        # a contract is named by contract_sha256 (context + canonical body without signatures), not by sha256 of its bytes,
        # exactly as the real intake serves e15c0188: the same address whether one or both parties have signed
        contract = {"schema": "a2a-contract-v0", "contract_id": "c" * 32, "parties": [{"role": "principal"}, {"role": "contractor"}],
                    "grant": {"authorized_actions": ["read"]}, "signatures": [{"domain": "x", "signature": "AAAA"}]}
        body = {k: v for k, v in contract.items() if k != "signatures"}
        csha = sha(b"a2a-contract-v0\n" + M.canonical(body).encode("utf-8"))
        obj_c = M.canonical(contract).encode("utf-8")
        assert sha(obj_c) != csha
        self.objects[csha] = obj_c
        self.contract_sha = csha
        base = "http://127.0.0.1:%d" % port
        recs = [{"sha": sha(obj_a), "kind": "agreement", "bytes_url": "%s/object/%s" % (base, sha(obj_a))},
                {"sha": sha(obj_b), "kind": "execution", "bytes_url": "%s/object/%s" % (base, sha(obj_b))},
                {"sha": csha, "kind": "contract", "bytes_url": "%s/object/%s" % (base, csha)}]
        batch = json.dumps({"schema": "nenrin-agreement-batch-v1", "count": 2, "records": recs}, sort_keys=True, separators=(",", ":"))
        self.raw = {1: "外壁塗装 30坪 一式（シリコン）: claim one".encode("utf-8"),
                    2: b'{"schema":"jidec-claim","work":"claim two"}',
                    3: batch.encode("utf-8")}
        self.lie_about = None          # sha of an object to serve wrong bytes for
        self.missing = set()           # entry numbers whose json 404s
        self.requests = []

    def entry(self, n):
        return {"n": n, "work": "entry %d" % n, "claim_sha256": sha(self.raw[n]), "record_canonical": self.raw[n].decode("utf-8"),
                "ots_status": "confirmed", "bitcoin_block": 968000 + n, "created_at": "2026-09-26T00:00:00Z"}

    def index(self):
        return {"ledger": "JIDEC", "count": 3, "entries": [{"n": n, "claim_sha256": sha(self.raw[n])} for n in (3, 2, 1)]}


def make_handler(L):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, body, ctype="application/json"):
            self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body)))
            self.end_headers(); self.wfile.write(body)

        def do_GET(self):
            L.requests.append(self.path)
            u = urlparse(self.path); q = parse_qs(u.query); parts = u.path.strip("/").split("/")
            if u.path == "/ledger":
                return self._send(200, json.dumps(L.index()).encode())
            if parts[0] == "ledger" and len(parts) >= 2 and parts[1].isdigit():
                n = int(parts[1])
                if n not in L.raw or n in L.missing:
                    return self._send(404, b"not found")
                if len(parts) == 3 and parts[2] == "ots":
                    return self._send(200, b"\x00OpenTimestamps\x00fake-proof-for-%d" % n, "application/octet-stream")
                if q.get("format") == ["raw"]:
                    return self._send(200, L.raw[n], "application/octet-stream")
                return self._send(200, json.dumps(L.entry(n), ensure_ascii=False).encode("utf-8"))
            if parts[0] == "object" and len(parts) == 2 and parts[1] in L.objects:
                b = L.objects[parts[1]]
                if L.lie_about == parts[1]:
                    b = b + b" "
                return self._send(200, b, "application/octet-stream")
            return self._send(404, b"not found")
    return H


def main():
    srv = HTTPServer(("127.0.0.1", 0), BaseHTTPRequestHandler)
    port = srv.server_address[1]
    srv.server_close()
    L = Ledger(port)
    srv = HTTPServer(("127.0.0.1", port), make_handler(L))
    t = threading.Thread(target=srv.serve_forever, daemon=True); t.start()
    base = "http://127.0.0.1:%d" % port
    tmp = tempfile.mkdtemp()
    n = 0
    try:
        # [1] pull an honest ledger: every raw matches its claim, both objects land under their sha, no problems
        A = os.path.join(tmp, "A")
        assert M.pull(base, A, quiet=True) == 0
        man = json.loads(open(os.path.join(A, "manifest.json"), encoding="utf-8").read())
        assert man["problems"] == [] and len(man["entries"]) == 3 and len(man["objects"]) == 3, man
        assert man["objects"][L.contract_sha]["addressed_by"] == "contract_sha256"
        assert all(v["addressed_by"] == "sha256" for k, v in man["objects"].items() if k != L.contract_sha)
        assert all(e["raw_ok"] and e["ots"] for e in man["entries"])
        assert sorted(os.listdir(os.path.join(A, "objects"))) == sorted(L.objects)
        assert M.verify(A, quiet=True) == 0
        n += 1; print("[1] honest ledger: 3 entries, 3 objects content addressed (two by sha256, the contract by contract_sha256), every digest recomputes offline")

        # [2] resume: a second pull fetches only the index; nothing on disk is refetched, verify still clean
        before = len(L.requests)
        assert M.pull(base, A, quiet=True) == 0
        new = L.requests[before:]
        assert new == ["/ledger?format=json"], new
        assert M.verify(A, quiet=True) == 0
        n += 1; print("[2] resume: one request (the index), nothing refetched, still clean")

        # [3] tamper with the copy: verify names the exact file
        obj = sorted(L.objects)[0]
        p = os.path.join(A, "objects", obj)
        b = open(p, "rb").read(); open(p, "wb").write(b + b"x")
        assert M.verify(A, quiet=True) == 1
        open(p, "wb").write(b)
        rp = os.path.join(A, "ledger", "2.raw"); rb = open(rp, "rb").read(); open(rp, "wb").write(rb + b"x")
        assert M.verify(A, quiet=True) == 1
        open(rp, "wb").write(rb)
        assert M.verify(A, quiet=True) == 0
        n += 1; print("[3] an object edited on disk, a raw claim edited on disk: verify fails and names them; restored: clean")

        # [4] the server lies about an object: the bytes are not stored, the problem is recorded, the entry is still mirrored
        L.lie_about = sorted(L.objects)[1]
        B = os.path.join(tmp, "B")
        assert M.pull(base, B, quiet=True) == 1
        man = json.loads(open(os.path.join(B, "manifest.json"), encoding="utf-8").read())
        assert any(pb["what"] == "object_sha_mismatch" and pb["sha"] == L.lie_about for pb in man["problems"]), man["problems"]
        assert not os.path.exists(os.path.join(B, "objects", L.lie_about))
        assert os.path.exists(os.path.join(B, "objects", sorted(L.objects)[0]))
        L.lie_about = None
        n += 1; print("[4] server serves wrong bytes for one object: not stored, named in the manifest, the other object kept")

        # [5] diff two mirrors: B lacks the lied-about object; after B pulls again it is complete and the diff is clean
        assert M.diff(A, B, quiet=True) == 0        # no differing bytes, only a missing file
        assert M.pull(base, B, quiet=True) == 0
        assert M.diff(A, B, quiet=True) == 0
        fa = sorted(os.listdir(os.path.join(A, "objects"))); fb = sorted(os.listdir(os.path.join(B, "objects")))
        assert fa == fb
        open(os.path.join(B, "objects", fa[0]), "ab").write(b"!")
        assert M.diff(A, B, quiet=True) == 1        # same name, different bytes: reported
        n += 1; print("[5] diff: a missing file is listed, a completed second pull diffs clean, differing bytes under one name are reported")

        # [6] an entry the ledger cannot serve is a problem, not a crash; the rest is mirrored
        L.missing.add(2)
        C = os.path.join(tmp, "C")
        assert M.pull(base, C, quiet=True) == 1
        man = json.loads(open(os.path.join(C, "manifest.json"), encoding="utf-8").read())
        assert any(pb["what"] == "entry_json" and pb["n"] == 2 for pb in man["problems"])
        assert os.path.exists(os.path.join(C, "ledger", "3.raw")) and os.path.exists(os.path.join(C, "ledger", "1.raw"))
        L.missing.clear()
        n += 1; print("[6] entry 2 unreachable: recorded as a problem, entries 1 and 3 mirrored")

        # [7] the CLI runs the same code
        rr = subprocess.run([sys.executable, os.path.join(HERE, "mirror.py"), "verify", "--dir", A], capture_output=True, text=True)
        assert rr.returncode == 0 and "0 problem(s)" in rr.stdout, rr.stdout + rr.stderr
        n += 1; print("[7] CLI verify on the honest copy: 0 problems")

        # [8] a contract whose signatures were stripped still verifies under its address (that is the point of the
        # address); a contract whose terms were edited does not, even though the server serves it with a valid shape
        cp = os.path.join(A, "objects", L.contract_sha)
        orig = open(cp, "rb").read()
        rec = json.loads(orig.decode("utf-8")); rec["signatures"] = []
        open(cp, "wb").write(M.canonical(rec).encode("utf-8"))
        assert M.verify(A, quiet=True) == 0
        rec = json.loads(orig.decode("utf-8")); rec["grant"]["authorized_actions"] = ["read", "payment"]
        open(cp, "wb").write(M.canonical(rec).encode("utf-8"))
        assert M.verify(A, quiet=True) == 1
        open(cp, "wb").write(orig)
        assert M.verify(A, quiet=True) == 0
        n += 1; print("[8] contract object: signatures stripped still matches its contract_sha256 address; one action added does not")
    finally:
        srv.shutdown(); shutil.rmtree(tmp, ignore_errors=True)
    print("\nSELF-TEST PASSED: nenrin-mirror-v0, %d checks (honest pull, resume, tampered copy, lying server, diff, unreachable entry, CLI, contract address rule)" % n)


if __name__ == "__main__":
    main()
