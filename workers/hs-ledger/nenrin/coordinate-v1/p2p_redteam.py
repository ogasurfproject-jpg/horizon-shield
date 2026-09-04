"""
p2p_redteam.py: the adversary for sync_headers_p2p.py.

It runs fake Bitcoin peers on localhost that speak the real wire protocol (version, verack,
ping, getheaders, headers) with a test network magic, serving chains mined by
localheaders_redteam at test difficulty. Then it points the real client at them and checks
what the client writes, what it refuses, and what it says. No network beyond loopback, no
threads in the client, deterministic chains, fixed clock.

Cases:
  two honest peers agree and the bytes written equal the mined chain; a peer serving one
  header that fails proof of work is dropped by name and, below the peer minimum, nothing is
  written; the same with the minimum lowered to one writes from the honest peer and records
  the dropped one; a peer serving a valid fork is dropped by the checkpoint; a tampered
  checksum, a wrong magic, an oversized length, a nonzero transaction count and a stalled
  peer are each dropped with the reason; two peers serving two valid chains that no
  checkpoint separates make the client refuse and name them, because a contradiction between
  sources is evidence and refusing exposes it; a stale peer is lag, its lower tip recorded and
  the longer agreeing chain written; a ping in the middle of getheaders is answered; a peer
  that does not know the locator returns nothing and is dropped.
"""
import socket, struct, threading, json, os, sys, io, tempfile, hashlib, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import localheaders as LH
import localheaders_redteam as RT
import sync_headers_p2p as P2P

TEST_MAGIC = bytes.fromhex("0b11fa09")
TEST = RT.TEST
NOW = RT.T0 + 100_000


class FakePeer(threading.Thread):
    """Serves one chain over loopback. Behaviour flags make it misbehave on purpose."""

    def __init__(self, headers, magic=TEST_MAGIC, corrupt_at=None, bad_checksum=False, stall=False,
                 oversize=False, txn_nonzero=False, serve_upto=None, ping_first=False, unknown_locator=False):
        super().__init__(daemon=True)
        self.headers = list(headers); self.magic = magic
        self.corrupt_at, self.bad_checksum, self.stall, self.oversize = corrupt_at, bad_checksum, stall, oversize
        self.txn_nonzero, self.serve_upto, self.ping_first, self.unknown_locator = txn_nonzero, serve_upto, ping_first, unknown_locator
        self.srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.srv.bind(("127.0.0.1", 0)); self.srv.listen(4); self.srv.settimeout(0.5)
        self.port = self.srv.getsockname()[1]; self.alive = True
        self.got_pong = False; self.hash_index = {}
        for i, h in enumerate(self.headers):
            self.hash_index[LH.parse_header(h)["hash"]] = i

    def addr(self):
        return "127.0.0.1:%d" % self.port

    def run(self):
        while self.alive:
            try:
                conn, _ = self.srv.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            try:
                self.serve(conn)
            except Exception:
                pass
            finally:
                try: conn.close()
                except OSError: pass

    def stop(self):
        self.alive = False
        try: self.srv.close()
        except OSError: pass

    def _send(self, conn, cmd, payload, checksum_ok=True, length_override=None):
        c = cmd.encode().ljust(12, b"\x00")
        ck = LH.dsha256(payload)[:4] if checksum_ok else b"\x00\x00\x00\x00"
        ln = struct.pack("<I", len(payload) if length_override is None else length_override)
        conn.sendall(self.magic + c + ln + ck + payload)

    def _recv(self, conn):
        buf = b""
        while len(buf) < 24:
            chunk = conn.recv(65536)
            if not chunk: return None, None
            buf += chunk
        length = struct.unpack("<I", buf[16:20])[0]
        while len(buf) < 24 + length:
            chunk = conn.recv(65536)
            if not chunk: return None, None
            buf += chunk
        return buf[4:16].rstrip(b"\x00").decode(), buf[24:24 + length]

    def serve(self, conn):
        conn.settimeout(10)
        while True:
            cmd, payload = self._recv(conn)
            if cmd is None: return
            if cmd == "version":
                self._send(conn, "version", P2P.version_payload(start_height=len(self.headers) - 1))
                self._send(conn, "verack", b"")
            elif cmd == "verack":
                pass
            elif cmd == "pong":
                self.got_pong = True
            elif cmd == "getheaders":
                if self.stall:
                    time.sleep(5); return
                if self.oversize:
                    self._send(conn, "headers", b"\x00", length_override=P2P.MAX_PAYLOAD + 1); return
                n, pos = P2P.read_varint(payload, 4)
                locator = [payload[pos + 32 * i: pos + 32 * (i + 1)][::-1].hex() for i in range(n)]
                start = None
                if not self.unknown_locator:
                    for h in locator:
                        if h == LH.ZERO_HASH or h in self.hash_index:
                            start = 0 if h == LH.ZERO_HASH else self.hash_index[h] + 1
                            break
                        # the block before the window is not in our list but its successor's prev is
                        for i, raw in enumerate(self.headers):
                            if LH.parse_header(raw)["prev"] == h:
                                start = i; break
                        if start is not None: break
                if start is None:
                    self._send(conn, "headers", b"\x00"); continue
                end = len(self.headers) if self.serve_upto is None else min(len(self.headers), self.serve_upto)
                batch = self.headers[start:min(end, start + P2P.MAX_HEADERS_PER_MSG)]
                if self.ping_first:
                    self._send(conn, "ping", struct.pack("<Q", 7)); self.ping_first = False
                body = P2P.varint(len(batch))
                for i, raw in enumerate(batch):
                    if self.corrupt_at is not None and start + i == self.corrupt_at:
                        raw = bytearray(raw); raw[50] ^= 0x01; raw = bytes(raw)
                    body += raw + (b"\x01" if self.txn_nonzero else b"\x00")
                self._send(conn, "headers", body, checksum_ok=not self.bad_checksum)


RESULTS = []


def check(name, cond, note=""):
    RESULTS.append((name, bool(cond), note))
    print("  %s  %-44s %s" % ("green" if cond else "FAIL ", name, note if not cond else "ok"))


def run_client(peers, manifest, out_prefix, extra=()):
    """Run the real client in process. Returns (exit_code_or_None, SystemExit message or None, stdout)."""
    import contextlib
    args = (["--from-manifest", manifest] if manifest else []) + ["--magic", TEST_MAGIC.hex(), "--params", "test", "--now", str(NOW),
            "--out-prefix", out_prefix, "--timeout", "2", "--peers", str(len(peers))]
    for p in peers: args += ["--peer", p.addr()]
    args += list(extra)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        try:
            rc = P2P.main(args); msg = None
        except SystemExit as e:
            rc, msg = 1, str(e)
    return rc, msg, buf.getvalue()


def main():
    print("p2p red team. fake peers on loopback, real wire protocol, mined test chains.")
    raw, hon = RT.build_chain(TEST, 32, {0: 600, 1: 600, 2: 300, 3: 600}, TEST.pow_limit_bits)
    hdrs = [raw[i * 80:(i + 1) * 80] for i in range(32)]
    H = lambda i: hon[i]["hash"]
    alt_raw, alt = RT.build_chain(TEST, 32, {}, hon[12]["bits"], tag="alt", start_height=12, start_prev=H(11),
                                  start_time=hon[12]["time"], period_first_times={8: hon[8]["time"]}, prev_bits=hon[11]["bits"])
    alt_hdrs = hdrs[:12] + [alt_raw[i * 80:(i + 1) * 80] for i in range(32)]
    d = tempfile.mkdtemp()
    man = os.path.join(d, "m.json")
    base = {"start_height": 0, "start_prev_hash": LH.ZERO_HASH, "start_bits": TEST.pow_limit_bits, "prior_times": [], "checkpoints": {}}
    json.dump(base, open(man, "w"))
    man_cp = os.path.join(d, "m_cp.json")
    json.dump(dict(base, checkpoints={"20": H(20)}), open(man_cp, "w"))

    def with_peers(peers, fn):
        for p in peers: p.start()
        try:
            return fn()
        finally:
            for p in peers: p.stop()

    # c01 two honest peers
    out = os.path.join(d, "c01")
    p1, p2 = FakePeer(hdrs), FakePeer(hdrs)
    rc, msg, log = with_peers([p1, p2], lambda: run_client([p1, p2], man, out))
    written = os.path.exists(out + ".bin") and open(out + ".bin", "rb").read() == raw
    check("c01_two_honest_peers_bytes_equal_chain", rc == 0 and written, msg or log[-300:])

    # c02 one peer serves a header failing proof of work: dropped; below the minimum nothing is written
    out = os.path.join(d, "c02")
    p1, p2 = FakePeer(hdrs, corrupt_at=20), FakePeer(hdrs)
    rc, msg, log = with_peers([p1, p2], lambda: run_client([p1, p2], man, out))
    check("c02_bad_pow_peer_dropped_nothing_written", rc == 1 and not os.path.exists(out + ".bin") and "fails validation" in log and "need 2" in (msg or ""), (msg or "")[:160])
    out = os.path.join(d, "c02b")
    p1, p2 = FakePeer(hdrs, corrupt_at=20), FakePeer(hdrs)
    rc, msg, log = with_peers([p1, p2], lambda: run_client([p1, p2], man, out, ["--min-peers", "1"]))
    m = json.load(open(out + ".manifest.json")) if rc == 0 else {}
    check("c02b_min_peers_1_writes_and_records_the_drop", rc == 0 and open(out + ".bin", "rb").read() == raw and len(m.get("peers_failed", {})) == 1 and "fails validation" in list(m["peers_failed"].values())[0], msg or "")

    # c03 fork peer refused by checkpoint
    out = os.path.join(d, "c03")
    p1, p2 = FakePeer(alt_hdrs), FakePeer(hdrs)
    rc, msg, log = with_peers([p1, p2], lambda: run_client([p1, p2], man_cp, out, ["--min-peers", "1"]))
    check("c03_fork_peer_dropped_by_checkpoint", rc == 0 and "checkpoint mismatch" in log and open(out + ".bin", "rb").read() == raw, log[-200:])

    # c04 checksum tamper
    out = os.path.join(d, "c04")
    p1 = FakePeer(hdrs, bad_checksum=True)
    rc, msg, log = with_peers([p1], lambda: run_client([p1], man, out, ["--min-peers", "1"]))
    check("c04_checksum_tamper_dropped", rc == 1 and "checksum mismatch" in log and not os.path.exists(out + ".bin"), log[-200:])

    # c05 wrong magic
    out = os.path.join(d, "c05")
    p1 = FakePeer(hdrs, magic=bytes.fromhex("deadbeef"))
    rc, msg, log = with_peers([p1], lambda: run_client([p1], man, out, ["--min-peers", "1"]))
    check("c05_wrong_magic_dropped", rc == 1 and "magic" in log and not os.path.exists(out + ".bin"), log[-200:])

    # c06 stalled peer
    out = os.path.join(d, "c06")
    p1 = FakePeer(hdrs, stall=True)
    t0 = time.time()
    rc, msg, log = with_peers([p1], lambda: run_client([p1], man, out, ["--min-peers", "1"]))
    check("c06_stalled_peer_times_out", rc == 1 and ("timeout" in log or "timed out" in log) and not os.path.exists(out + ".bin") and time.time() - t0 < 15, log[-200:])

    # c07 two valid chains, no checkpoint separates them: refuse and name
    out = os.path.join(d, "c07")
    p1, p2 = FakePeer(hdrs), FakePeer(alt_hdrs)
    rc, msg, log = with_peers([p1, p2], lambda: run_client([p1, p2], man, out))
    check("c07_two_valid_chains_disagree_refused_named", rc == 1 and "peers disagree" in (msg or "") and "127.0.0.1" in (msg or "") and not os.path.exists(out + ".bin"), (msg or "")[:160])

    # c08 oversized length
    out = os.path.join(d, "c08")
    p1 = FakePeer(hdrs, oversize=True)
    rc, msg, log = with_peers([p1], lambda: run_client([p1], man, out, ["--min-peers", "1"]))
    check("c08_oversized_payload_dropped", rc == 1 and "exceeds limit" in log and not os.path.exists(out + ".bin"), log[-200:])

    # c09 transaction count nonzero in a headers message
    out = os.path.join(d, "c09")
    p1 = FakePeer(hdrs, txn_nonzero=True)
    rc, msg, log = with_peers([p1], lambda: run_client([p1], man, out, ["--min-peers", "1"]))
    check("c09_txn_count_nonzero_dropped", rc == 1 and "transaction count" in log and not os.path.exists(out + ".bin"), log[-200:])

    # c10 stale peer is lag: lower tip recorded, longer agreeing chain written
    out = os.path.join(d, "c10")
    p1, p2 = FakePeer(hdrs, serve_upto=20), FakePeer(hdrs)
    rc, msg, log = with_peers([p1, p2], lambda: run_client([p1, p2], man, out))
    m = json.load(open(out + ".manifest.json")) if rc == 0 else {}
    tips = sorted(v["tip_height"] for v in m.get("peers", {}).values())
    check("c10_stale_peer_is_lag_longest_written", rc == 0 and tips == [19, 31] and open(out + ".bin", "rb").read() == raw and m["tip_height"] == 31, json.dumps(tips))

    # c11 ping during getheaders is answered
    out = os.path.join(d, "c11")
    p1 = FakePeer(hdrs, ping_first=True)
    rc, msg, log = with_peers([p1], lambda: run_client([p1], man, out, ["--min-peers", "1"]))
    time.sleep(0.2)
    check("c11_ping_mid_getheaders_answered", rc == 0 and p1.got_pong and open(out + ".bin", "rb").read() == raw, "got_pong=%s" % p1.got_pong)

    # c12 unknown locator: empty headers, dropped
    out = os.path.join(d, "c12")
    p1 = FakePeer(hdrs, unknown_locator=True)
    rc, msg, log = with_peers([p1], lambda: run_client([p1], man, out, ["--min-peers", "1"]))
    check("c12_unknown_locator_dropped", rc == 1 and "no headers" in log and not os.path.exists(out + ".bin"), log[-200:])

    # c13 compare flag: p2p bytes against the explorer built file
    out = os.path.join(d, "c13"); cmpf = os.path.join(d, "explorer.bin"); open(cmpf, "wb").write(raw)
    p1, p2 = FakePeer(hdrs), FakePeer(hdrs)
    rc, msg, log = with_peers([p1, p2], lambda: run_client([p1, p2], man, out, ["--compare", cmpf]))
    m = json.load(open(out + ".manifest.json")) if rc == 0 else {}
    check("c13_compare_records_byte_identical", rc == 0 and m.get("compare", {}).get("byte_identical") is True and m["compare"]["common_headers"] == 32, json.dumps(m.get("compare")))

    # c14 from genesis: no manifest, the locator is the zero hash, every boundary verified from inside
    out = os.path.join(d, "c14")
    p1, p2 = FakePeer(hdrs), FakePeer(hdrs)
    rc, msg, log = with_peers([p1, p2], lambda: run_client([p1, p2], None, out, ["--from-genesis", "--check-against", man_cp]))
    m = json.load(open(out + ".manifest.json")) if rc == 0 else {}
    check("c14_from_genesis_all_boundaries_verified_checkpoint_matched",
          rc == 0 and open(out + ".bin", "rb").read() == raw and m.get("retarget_boundaries_verified") == 3
          and m.get("mode", "").startswith("whole chain") and "20" in m.get("checkpoints", {}) and m["tip_height"] == 31, (msg or "") + json.dumps({k: m.get(k) for k in ("retarget_boundaries_verified", "mode", "tip_height")}))

    n_ok = sum(1 for _, ok, _ in RESULTS if ok)
    print("\n=== %d / %d ===" % (n_ok, len(RESULTS)))
    print("a courier with no website in it: real wire framing, checksum and magic enforced, one bad header drops the peer by name, "
          "peers must agree byte for byte or the sync refuses and says who disagreed, a stale peer is lag, a fork dies at the checkpoint, "
          "and nothing is ever written on a refusal.")
    return 0 if n_ok == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
