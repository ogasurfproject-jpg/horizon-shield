#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Self test for nenrin-mirror-v0. Serves a synthetic ledger on loopback, mirrors it, verifies it offline,
tampers with the copy, serves a lying object, diffs two mirrors. No network beyond 127.0.0.1."""
import hashlib, json, os, shutil, subprocess, sys, tempfile, threading, time
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
        self.witness = {}              # sha -> envelope served at /witness/<sha> (only in the named-record ledger)
        self.lie_about = None          # sha of an object to serve wrong bytes for
        self.missing = set()           # entry numbers whose json 404s
        self.unstamped = set()         # entry numbers the ledger reports as unstamped (its /ots answers 404)
        self.ots_404 = set()           # entry numbers whose /ots 404s while the entry claims a stamp
        self.flaky = {}                # path -> list of answers to give first, each a status code or "drop" (close, no answer)
        self.requests = []

    def add_witness_batch(self):
        """Entry 4: a nenrin-witness-batch-v1 naming three walks by sha with no bytes_url, as the real batches do.
        The ledger serves two of them at /witness/<sha>; the third it no longer has."""
        shas = []
        for i in range(3):
            rc = json.dumps({"schema": "nenrin-witness-v1", "walk": i, "endpoint": "https://example.org/a2a"}, sort_keys=True, separators=(",", ":"))
            h = sha(rc.encode("utf-8")); shas.append(h)
            if i < 2:
                self.witness[h] = {"sha": h, "record": {"record_canonical": rc, "public_key_ed25519_b64": "PK%d" % i,
                                                        "signature_ed25519_b64": "SIG%d" % i, "signed_domain": "w%d.example" % i}}
        batch = {"schema": "nenrin-witness-batch-v1", "count": 3, "records": [{"sha": h, "submitted_at": "2026-10-01T00:00:00Z"} for h in shas]}
        self.raw[4] = json.dumps(batch, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return shas

    def entry(self, n):
        return {"n": n, "work": "entry %d" % n, "claim_sha256": sha(self.raw[n]), "record_canonical": self.raw[n].decode("utf-8"),
                "ots_status": "unstamped" if n in self.unstamped else "confirmed", "bitcoin_block": None if n in self.unstamped else 968000 + n,
                "created_at": "2026-09-26T00:00:00Z"}

    def index(self):
        ns = sorted(self.raw, reverse=True)
        return {"ledger": "JIDEC", "count": len(ns), "entries": [{"n": n, "claim_sha256": sha(self.raw[n])} for n in ns]}


def make_handler(L):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, body, ctype="application/json"):
            self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body)))
            self.end_headers(); self.wfile.write(body)

        def do_GET(self):
            L.requests.append(self.path)
            if L.flaky.get(self.path):
                how = L.flaky[self.path].pop(0)
                if how == "drop":
                    self.close_connection = True
                    return
                return self._send(how, b'{"error":"busy"}')
            u = urlparse(self.path); q = parse_qs(u.query); parts = u.path.strip("/").split("/")
            if u.path == "/ledger":
                return self._send(200, json.dumps(L.index()).encode())
            if parts[0] == "ledger" and len(parts) >= 2 and parts[1].isdigit():
                n = int(parts[1])
                if n not in L.raw or n in L.missing:
                    return self._send(404, b"not found")
                if len(parts) == 3 and parts[2] == "ots":
                    if n in L.unstamped or n in L.ots_404:
                        return self._send(404, b'{"error":"proof not yet available"}')
                    return self._send(200, b"\x00OpenTimestamps\x00fake-proof-for-%d" % n, "application/octet-stream")
                if q.get("format") == ["raw"]:
                    return self._send(200, L.raw[n], "application/octet-stream")
                return self._send(200, json.dumps(L.entry(n), ensure_ascii=False).encode("utf-8"))
            if parts[0] == "witness" and len(parts) == 2 and parts[1] in L.witness:
                env = dict(L.witness[parts[1]])
                if L.lie_about == parts[1]:
                    env = {**env, "record": {**env["record"], "record_canonical": env["record"]["record_canonical"] + " "}}
                return self._send(200, json.dumps(env).encode("utf-8"))
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

        # [6b] content digests: a second honest mirror of the same ledger, pulled later, has a different manifest sha
        # (mirrored_at) but the same content_sha256 and entries_sha256; verify recomputes them; an edited manifest is caught
        D = os.path.join(tmp, "D")
        time.sleep(1.1)
        assert M.pull(base, D, quiet=True) == 0
        ma = json.loads(open(os.path.join(A, "manifest.json"), encoding="utf-8").read())
        md = json.loads(open(os.path.join(D, "manifest.json"), encoding="utf-8").read())
        assert ma["mirrored_at"] != md["mirrored_at"]
        assert sha(open(os.path.join(A, "manifest.json"), "rb").read()) != sha(open(os.path.join(D, "manifest.json"), "rb").read())
        assert ma["content_sha256"] == md["content_sha256"] and ma["entries_sha256"] == md["entries_sha256"], (ma["content_sha256"], md["content_sha256"])
        assert M.content_digests(ma) == (ma["content_sha256"], ma["entries_sha256"])
        assert M.verify(D, quiet=True) == 0 and M.diff(A, D, quiet=True) == 0
        mdp = os.path.join(D, "manifest.json")
        md["entries"][0]["claim_sha256"] = "0" * 64
        open(mdp, "wb").write(M.canonical(md).encode("utf-8"))
        assert M.verify(D, quiet=True) == 1
        open(mdp, "wb").write(M.canonical(ma).encode("utf-8"))
        n += 1; print("[6b] two pulls a second apart: manifest sha differs (mirrored_at), content_sha256 and entries_sha256 equal; an edited manifest fails verify")

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

        # [9] red team R3-1: a witness batch names its walks by sha with no bytes_url. The mirror fetches each from
        # /witness/<sha>, keeps the record's own bytes under that sha and the signature beside them; a walk the ledger
        # cannot serve, or serves altered, is named in named_record_problems and not stored; verify counts held of named
        w = L.add_witness_batch()
        L.lie_about = w[1]
        E = os.path.join(tmp, "E")
        assert M.pull(base, E, quiet=True) == 0       # named-record misses are listed, not fatal
        man = json.loads(open(os.path.join(E, "manifest.json"), encoding="utf-8").read())
        nps = {(pb["what"], pb["sha"]) for pb in man["named_record_problems"]}
        assert nps == {("named_record_sha_mismatch", w[1]), ("named_record_unreachable", w[2])}, nps
        assert os.path.exists(os.path.join(E, "objects", w[0])) and not os.path.exists(os.path.join(E, "objects", w[1]))
        assert sha(open(os.path.join(E, "objects", w[0]), "rb").read()) == w[0]
        sig = json.loads(open(os.path.join(E, "objects", w[0] + ".sig.json"), encoding="utf-8").read())
        assert sig == {"public_key_ed25519_b64": "PK0", "signature_ed25519_b64": "SIG0", "signed_domain": "w0.example"}, sig
        assert w[1] not in man["objects"] and w[2] not in man["objects"] and man["objects"][w[0]]["ok"]
        rr = subprocess.run([sys.executable, os.path.join(HERE, "mirror.py"), "verify", "--dir", E], capture_output=True, text=True)
        assert rr.returncode == 0 and "held 1 of 3" not in rr.stdout and "1 held of 3" in rr.stdout, rr.stdout
        L.lie_about = None
        before = len(L.requests)
        assert M.pull(base, E, quiet=True) == 0       # resume: the walk now served honestly is fetched, the held one is not
        assert ("/witness/" + w[0]) not in L.requests[before:] and ("/witness/" + w[1]) in L.requests[before:]
        rr = subprocess.run([sys.executable, os.path.join(HERE, "mirror.py"), "verify", "--dir", E], capture_output=True, text=True)
        assert rr.returncode == 0 and "2 held of 3" in rr.stdout, rr.stdout
        p0 = os.path.join(E, "objects", w[0]); b0 = open(p0, "rb").read(); open(p0, "wb").write(b0 + b"x")
        assert M.verify(E, quiet=True) == 1
        open(p0, "wb").write(b0)
        n += 1; print("[9] witness batch without bytes_url: walks fetched from /witness/<sha>, bytes and signature kept; an altered and a missing walk listed, not stored; resume fetches only what is missing; 2 held of 3")

        # [10] 2026-10-13: an entry the ledger reports as unstamped has no proof yet. pull and verify list it as awaiting,
        # not as a problem; once the proof exists the next pull fetches it and the list empties. A missing proof for an
        # entry that claims a stamp is still a problem. A copy with nothing awaiting carries no awaiting_stamp key.
        L.raw[5] = b'{"schema":"nenrin-agreement-batch-v1","count":0,"records":[]}'
        L.unstamped = {5}
        F = os.path.join(tmp, "F")
        assert M.pull(base, F, quiet=True) == 0
        man = json.loads(open(os.path.join(F, "manifest.json"), encoding="utf-8").read())
        assert man["problems"] == [] and man.get("awaiting_stamp") == [5], (man["problems"], man.get("awaiting_stamp"))
        assert [e for e in man["entries"] if e["n"] == 5][0].get("awaiting_stamp") is True
        rr = subprocess.run([sys.executable, os.path.join(HERE, "mirror.py"), "verify", "--dir", F], capture_output=True, text=True)
        assert rr.returncode == 0 and "awaiting their first stamp" in rr.stdout and ": 5" in rr.stdout, rr.stdout
        L.unstamped = set()
        assert M.pull(base, F, quiet=True) == 0       # the proof now exists: fetched, nothing awaiting
        man = json.loads(open(os.path.join(F, "manifest.json"), encoding="utf-8").read())
        assert "awaiting_stamp" not in man and os.path.exists(os.path.join(F, "ledger", "5.ots")), man.get("awaiting_stamp")
        L.ots_404 = {5}
        G = os.path.join(tmp, "G")
        assert M.pull(base, G, quiet=True) == 1       # claims confirmed, serves no proof: a problem, as before
        man = json.loads(open(os.path.join(G, "manifest.json"), encoding="utf-8").read())
        assert {"n": 5, "what": "ots_missing"} in man["problems"] and "awaiting_stamp" not in man
        assert M.verify(G, quiet=True) == 1
        L.ots_404 = set(); del L.raw[5]
        n += 1; print("[10] unstamped entry: listed as awaiting, not a problem; fetched on the next pull once stamped; a stamped entry without a proof is still a problem")

        # [11] 2026-11-17: a fetch with no answer or a 5xx is tried again, twice; 200 and 4xx are not. Every kind of
        # fetch a pull makes is covered: the index, entry json, raw, ots, an object, a record named without bytes_url.
        saved_waits = M.RETRY_WAITS
        M.RETRY_WAITS = (0.0, 0.0)
        try:
            assert M._retry_waits("5,15") == (5.0, 15.0) and M._retry_waits("0,0") == (0.0, 0.0)
            assert M._retry_waits("1") == (5.0, 15.0) and M._retry_waits("x,y") == (5.0, 15.0) and M._retry_waits("-1,2") == (5.0, 15.0)
            obj0 = sorted(L.objects)[0]
            L.flaky = {"/ledger?format=json": [503], "/ledger/1?format=json": ["drop"], "/ledger/2?format=json": [503],
                       "/ledger/2?format=raw": [502], "/ledger/3/ots": ["drop"], "/object/" + obj0: [500], "/witness/" + w[0]: [503]}
            I = os.path.join(tmp, "I")
            before = len(L.requests)
            assert M.pull(base, I, quiet=True) == 0
            got = L.requests[before:]
            man = json.loads(open(os.path.join(I, "manifest.json"), encoding="utf-8").read())
            assert man["problems"] == [] and len(man["entries"]) == 4 and all(e["raw_ok"] and e["ots"] for e in man["entries"]), man["problems"]
            for path in ("/ledger?format=json", "/ledger/1?format=json", "/ledger/2?format=json", "/ledger/2?format=raw", "/ledger/3/ots", "/object/" + obj0, "/witness/" + w[0]):
                assert got.count(path) == 2, (path, got.count(path))
            assert got.count("/witness/" + w[2]) == 1          # 404: an answer, asked once
            assert [(pb["what"], pb["sha"]) for pb in man["named_record_problems"]] == [("named_record_unreachable", w[2])]
            assert M.verify(I, quiet=True) == 0
            n += 1; print("[11] one 5xx or one dropped connection on each kind of fetch: tried again, 0 problems; a 404 is asked once")

            # [12] three 503 in a row: a problem, exit 1, and the pull prints it on one line; a 404 entry is asked once
            L.flaky = {"/ledger/2?format=json": [503, 503, 503]}
            L.missing = {3}
            J = os.path.join(tmp, "J")
            before = len(L.requests)
            env = dict(os.environ, NENRIN_MIRROR_RETRY_WAITS="0,0")
            t0 = time.time()
            rr = subprocess.run([sys.executable, os.path.join(HERE, "mirror.py"), "pull", "--dir", J, "--base", base], capture_output=True, text=True, env=env)
            took = time.time() - t0
            got = L.requests[before:]
            assert rr.returncode == 1, rr.stdout + rr.stderr
            assert '  {"n": 2, "what": "entry_json", "status": 503}' in rr.stdout.splitlines(), rr.stdout
            assert '  {"n": 3, "what": "entry_json", "status": 404}' in rr.stdout.splitlines(), rr.stdout
            assert any(ln.startswith('  {"n": 4, "what": "named_record_unreachable"') for ln in rr.stdout.splitlines()), rr.stdout
            assert got.count("/ledger/2?format=json") == 3 and got.count("/ledger/3?format=json") == 1, got
            assert took < 5, took
            L.missing = set(); L.flaky = {}
            n += 1; print("[12] three 503 in a row: entry_json problem, exit 1, printed one per line with the 404 and the named record; the 404 asked once")

            # [13] the waits are the ones configured: 0.25 s and 0.5 s add at least 0.75 s; 0 and 0 add none
            K = os.path.join(tmp, "K")
            M.RETRY_WAITS = (0.25, 0.5)
            L.flaky = {"/ledger/2?format=json": [503, 503, 503]}
            t0 = time.time(); assert M.pull(base, K, 2, 2, quiet=True) == 1; slow = time.time() - t0
            M.RETRY_WAITS = (0.0, 0.0)
            L.flaky = {"/ledger/2?format=json": [503, 503, 503]}
            t0 = time.time(); assert M.pull(base, K, 2, 2, quiet=True) == 1; fast = time.time() - t0
            assert slow >= 0.75 and fast < 0.75, (slow, fast)
            L.flaky = {}
            n += 1; print("[13] the waits between tries come from RETRY_WAITS (NENRIN_MIRROR_RETRY_WAITS): %.2f s with 0.25,0.5, %.2f s with 0,0" % (slow, fast))
        finally:
            M.RETRY_WAITS = saved_waits; L.flaky = {}; L.missing = set()
    finally:
        srv.shutdown(); shutil.rmtree(tmp, ignore_errors=True)
    print("\nSELF-TEST PASSED: nenrin-mirror-v0, %d checks (honest pull, resume, tampered copy, lying server, diff, unreachable entry, content digests, CLI, contract address rule, records named without bytes_url, entries awaiting their first stamp, fetches tried again)" % n)


if __name__ == "__main__":
    main()
