"""test_furui_witness.py: the witness kit (kit/furui_witness.py, kit/setup.sh and kit/.github/workflows/furui-witness.yml)
without the network.

A test world answers the kit's URLs: two runners, the ledger with its batch entries and OpenTimestamps proofs, and the
two block explorers, with day records and leaves signed by openssl keys made here and block headers that meet their own
(easiest) target. Every answer the kit signs is read back with ../witness-answer-v0/witness_answer_v0.py (shape v0.2,
signature, and the intake record's bytes). The real proof of ledger entry 80 and the real header of Bitcoin block 970879
are read from ../furui-check-day-v0 (the files nenrin-verify's vectors use). Needs python3, bash and openssl 3 or later.
  python3 -I -B test_furui_witness.py
"""
import base64, hashlib, json, os, re, shutil, subprocess, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "kit"))
sys.path.insert(0, os.path.join(HERE, "..", "witness-answer-v0"))
import furui_witness as K  # noqa: E402
import witness_answer_v0 as W  # noqa: E402

FCD = os.path.join(HERE, "..", "furui-check-day-v0")
H = "ab" * 32
KU = "https://w.example/kit/keys/k.json"
D1, NOW = "2026-11-19", "2026-11-20T04:10:00Z"
D0 = "2026-11-18"
MEMPOOL, BLOCKSTREAM = dict((n, u) for n, u in K.EXPLORERS)["mempool.space"], dict((n, u) for n, u in K.EXPLORERS)["blockstream.info"]


def rd(p, mode="r"):
    with open(p, mode) as f:
        return f.read()


def wr(p, b, mode="w"):
    with open(p, mode) as f:
        f.write(b)


def ossl(*a, inp=None):
    return subprocess.run(["openssl"] + list(a), input=inp, capture_output=True, check=True).stdout


def newkey(t, n):
    p = os.path.join(t, n)
    ossl("genpkey", "-algorithm", "ed25519", "-out", p)
    return p, ossl("pkey", "-in", p, "-pubout", "-outform", "DER")[12:]


def osign(p, msg):
    t = tempfile.mkdtemp()
    try:
        wr(os.path.join(t, "m"), msg, "wb")
        return subprocess.run(["openssl", "pkeyutl", "-sign", "-inkey", p, "-rawin", "-in", os.path.join(t, "m")], capture_output=True, check=True).stdout
    finally:
        shutil.rmtree(t)


def tree(l):
    if len(l) == 1:
        return l[0]
    k = 1
    while k * 2 < len(l):
        k *= 2
    return K.node(tree(l[:k]), tree(l[k:]))


def path(m, l):
    if len(l) <= 1:
        return []
    k = 1
    while k * 2 < len(l):
        k *= 2
    return path(m, l[:k]) + [tree(l[k:])] if m < k else path(m - k, l[k:]) + [tree(l[:k])]


# ---- OpenTimestamps and block headers, made up the way make_bitcoin_header_vectors.py makes them ----
def varuint(v):
    out = bytearray()
    while True:
        b = v & 0x7F
        v >>= 7
        out.append(b | (0x80 if v else 0))
        if not v:
            return bytes(out)


def ots_proof(digest, height, salt=b"furui-witness-kit", pending=False):
    """an OpenTimestamps file: append salt, sha256, then a Bitcoin attestation at height (and a pending one beside it)
    -> (file bytes, the merkle root the proof reaches, in block explorer order)"""
    msg = hashlib.sha256(digest + salt).digest()
    att = b"\x00" + K.OTS_BITCOIN + varuint(len(varuint(height))) + varuint(height)
    body = b"\xf0" + varuint(len(salt)) + salt + b"\x08"
    if pending:
        url = b"https://a.pool.example"
        body += b"\xff" + b"\x00" + K.OTS_PENDING + varuint(len(url) + 1) + varuint(len(url)) + url
    return K.OTS_MAGIC + b"\x01\x08" + digest + body + att, msg[::-1].hex()


def made_up_header(merkle, salt, bits=0x207FFFFF, meet=True):
    """version 0x20000000, prev sha256(salt), the merkle root, a fixed time, bits, the first nonce that meets (or misses) them"""
    b = (0x20000000).to_bytes(4, "little") + hashlib.sha256(salt.encode()).digest() + bytes.fromhex(merkle)[::-1]
    b += (1793000000).to_bytes(4, "little") + bits.to_bytes(4, "little")
    t = K.bits_target(0x207FFFFF)
    for nonce in range(1 << 20):
        hx = (b + nonce.to_bytes(4, "little")).hex()
        if (int(K.sha256d(bytes.fromhex(hx))[::-1].hex(), 16) <= t) == meet:
            return hx
    raise SystemExit("no nonce")


def block_hash(hx):
    return K.sha256d(bytes.fromhex(hx))[::-1].hex()


class World:
    """URL -> (status, bytes); posts are verified like the ledger's intake does and kept in self.posted"""
    def __init__(self, t, n=3):
        self.t, self.routes, self.posted, self.calls = t, {}, [], []
        self.rk = {r: newkey(t, r + ".pem") for r in K.TREES}
        self.wk = newkey(t, "witness.pem")
        self.recs = {}
        self.put(K.SIGNER["key_url"], {"use": "furui-check", "keys": [{"key_id": r, "public_key_ed25519_b64": base64.b64encode(self.rk[r][1]).decode(),
                                                                       "from_height": 0, "revoked_height": None} for r in K.TREES]})
        self.put(K.LEDGER + "/ledger/head", {"n": 354, "head": "cd" * 32})
        self.put(KU, {"public_key_ed25519_b64": base64.b64encode(self.wk[1]).decode()})
        self.post_status = 201
        for d in ["2026-11-%02d" % i for i in range(13, 25)]:
            for r in K.TREES:
                self.day(d, r, n)

    def put(self, url, obj, status=200):
        self.routes[url] = (status, obj if isinstance(obj, bytes) else (obj.encode() if isinstance(obj, str) else json.dumps(obj).encode()))

    def day(self, d, rid, n, bad=None):
        envs = []
        for i in range(n):
            c = {"action_binding_digest": H, "answered": True, "checked_at_height": 100 + i, "contract_sha256": H, "decision": "pass",
                 "input_commit": H, "marks": [], "nonce": "%032x" % (i + 1), "rules_sha256": None, "schema": "furui-check-v1",
                 "scope_sha256": None, "signed_at": d + "T10:00:00.000Z", "stage_reached": 4, "trace_sha256": H, "unread": False}
            e = {"schema": "furui-check-signed-v1", "check": c, "signer": K.SIGNER}
            sg = osign(self.rk[rid][0], K.envelope_message(e))
            if bad == "leaf_sig" and i == 1:
                sg = bytes([sg[0] ^ 1]) + sg[1:]
            e["signatures"] = [{"alg": "ed25519", "domain": "horizonshield.dev", "key_id": rid, "sig": base64.b64encode(sg).decode()}]
            envs.append(e)
        leaves = [K.sha(b"\x00" + K.canonical(e).encode()) for e in envs]
        root = tree(leaves)
        rec = {"clock_skew": 0, "day": d, "first_height": 100, "last_height": 100 + n, "late": 0, "leaf": K.DAY_LEAF, "n": n,
               "publication": "public", "root": root, "schema": "furui-check-day-v0", "signer": K.SIGNER, "tree": "rfc6962-sha256"}
        if rid == "runner-2":
            rec["runner_id"] = rid
        rec["signatures"] = [{"alg": "ed25519", "domain": "horizonshield.dev", "key_id": rid,
                              "sig": base64.b64encode(osign(self.rk[rid][0], K.day_message(rec))).decode()}]
        rc = K.canonical(rec)
        rs = K.sha(rc)
        base = K.FURUI + K.TREES[rid] + d
        self.put(base + "/status", {"day": d, "checks": n, "spent_usd": 0.032049, "capped": 0,
                                    "status": {"state": "accepted", "n": n, "root": root, "ledger_canonical_sha256": rs, "record_sha256": rs}})
        self.recs[(d, rid)] = (rs, rc + (" " if bad == "record_bytes" else ""))
        self.put(K.LEDGER + "/furui-check-day/" + rs, {"record_canonical": rc + (" " if bad == "record_bytes" else ""), "status": "pending_anchor", "ledger_entry": None})
        for i, e in enumerate(envs):
            pr = path(i, leaves)
            if bad == "path" and i == 0:
                pr = ["00" * 32] + pr[1:]
            ec = K.canonical(e)
            self.put(base + "/leaf/%d" % i, {"day": d, "index": i, "envelope": e, "leaf_sha256": leaves[i], "envelope_sha256": K.sha(ec),
                                              "proof_kind": "rfc6962-audit-path", "proof": pr, "n": n, "root": root,
                                              "day_record": {"state": "accepted", "ledger_canonical_sha256": rs}})
        return rs

    def anchor(self, n, members, height, confirmed=True, bad=None):
        """batch entry n lists the day records members [(day, runner)], is confirmed at height, its proof reaches a made up
        merkle root that a made up header holds; bad changes one thing"""
        shas = [self.recs[m][0] for m in members]
        listed = [s for s in shas if bad != "not_listed"]
        rows = [{"canonical_sha256": s, "record_schema": "furui-check-day-v0", "verdict": "accepted", "verifier_version": "furui-check-day-intake 0.3.0"} for s in sorted(listed)]
        rows.append({"canonical_sha256": "ef" * 32, "record_schema": "a2a-admission-v0", "verdict": "accepted", "verifier_version": "admission-intake 0.5.0"})
        bc = K.canonical({"schema": "nenrin-agreement-batch-v1", "anchored_at": "2026-11-20T00:30:38.212Z", "count": len(rows), "records": rows})
        claim = K.sha(bc)
        e = {"n": n, "work": "NENRIN agreement batch (%d records)" % len(rows), "claim_sha256": claim if bad != "claim" else "00" * 32,
             "record_canonical": bc, "schema": "v0-plain", "created_at": "2026-11-20T00:30:38.335Z",
             "ots_status": "confirmed" if confirmed else "pending", "bitcoin_block": height if confirmed else None}
        self.put(K.LEDGER + "/ledger/%d?format=json" % n, e)
        proof, merkle = ots_proof(bytes.fromhex(claim) if bad != "ots_digest" else hashlib.sha256(b"other").digest(), height + (1 if bad == "ots_height" else 0), pending=True)
        if confirmed:
            self.put(K.LEDGER + "/ledger/%d/ots" % n, proof if bad != "ots_bytes" else proof[:-3])
        hx = made_up_header(merkle if bad != "root" else "11" * 32, "salt-%d" % height)
        if bad == "target":
            hx = made_up_header(merkle, "salt-%d" % height, bits=0x1D00FFFF)
        self.explorers(height, hx, other=bad == "explorers")
        for s in shas:
            st, body = self.routes[K.LEDGER + "/furui-check-day/" + s]
            j = json.loads(body)
            j.update(status="anchored", ledger_entry=n)
            self.put(K.LEDGER + "/furui-check-day/" + s, j)
        return merkle, hx

    def explorers(self, height, hx, other=False):
        for base in (MEMPOOL, BLOCKSTREAM):
            h2 = hx
            if other and base == BLOCKSTREAM:
                h2 = made_up_header("22" * 32, "other-%d" % height)
            bh = block_hash(h2)
            self.put(base + "/block-height/%d" % height, bh)
            self.put(base + "/block/%s/header" % bh, h2)

    def net(self, clock=None):
        w = self

        class N(K.Net):
            def _open(self, req, timeout):
                w.calls.append((req.get_method(), req.full_url, req.get_header("User-agent")))
                if req.get_method() == "POST":
                    b = json.loads(req.data)
                    rc = b["record_canonical"]
                    ok = W.ed25519_verify(base64.b64decode(b["public_key_ed25519_b64"]), rc.encode(), base64.b64decode(b["signature_ed25519_b64"]))
                    if w.post_status != 201 or not ok:
                        return w.post_status if ok else 422, b'{"error":"refused"}'
                    w.posted.append(rc)
                    return 201, json.dumps({"sha": K.sha(rc), "status": "pending", "counted": True}).encode()
                r = w.routes.get(req.full_url, (404, b'{"error":"not_found"}'))
                if callable(r):
                    return r()
                return r
        hosts = ["furui.horizonshield.dev", "ledger.horizonshield.dev", "w.example", "mempool.space", "blockstream.info"]
        return N(hosts, **({"now": clock} if clock else {}))


class Kit(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.mkdtemp()
        self.w = World(self.t)
        os.environ.update(FURUI_WITNESS_KEY=rd(self.w.wk[0]), FURUI_WITNESS_KEY_URL=KU, FURUI_WITNESS_NAME="Test Witness")
        self.ans, self.out = os.path.join(self.t, "answers"), os.path.join(self.t, "out")

    def tearDown(self):
        shutil.rmtree(self.t)

    def run_kit(self, now=NOW, clock=None, **kw):
        a = {"--answers": self.ans, "--out": self.out, "--now": now, "--github-output": os.path.join(self.t, "gho")}
        self.w.posted = []
        if os.path.isdir(self.out):
            shutil.rmtree(self.out)
        rc = K.answer(a, net=self.w.net(clock))
        return rc, [json.loads(x)["answer"] for x in self.w.posted]

    def records(self):
        return [json.loads(x) for x in self.w.posted]

    def keep_all(self):
        for f in os.listdir(self.out):
            b = rd(os.path.join(self.out, f), "rb")
            d = json.loads(b)["answer"]["day"]
            os.makedirs(os.path.join(self.ans, d), exist_ok=True)
            wr(os.path.join(self.ans, d, f), b, "wb")

    def one(self, ans, rid="runner-1", d=D1, kind=None):
        x = [a for a in ans if a["runner_id"] == rid and a["day"] == d and (kind is None or ("bitcoin_anchor" in a["recomputed"] or a["limits"] == K.LIMITS["anchor"]) == (kind == "anchor"))]
        self.assertEqual(len(x), 1)
        return x[0]

    def check_answer(self, a):
        W.check_shape_v02(a)
        self.assertTrue(all(ok for _, ok, _ in W.verify(a, {"public_key_ed25519_b64": base64.b64encode(self.w.wk[1]).decode()}, W.SCHEMA_V02)))

    def first_answered(self):
        """the day answers of D1 sent at 01:52 on the next day and kept, as a witness that started that day"""
        rc, ans = self.run_kit(now="2026-11-20T01:52:00Z")
        self.assertEqual((rc, len(ans)), (0, 2))
        self.keep_all()

    # ---- day answers (kit 0.1.0, unchanged apart from the first limit) ----
    def test_01_match_both_runners_verify_with_the_helper(self):
        rc, ans = self.run_kit()
        self.assertEqual(rc, 0)
        self.assertEqual(sorted(a["runner_id"] for a in ans), ["runner-1", "runner-2"])
        for a in ans:
            self.assertEqual(a["outcome"], "match")
            self.assertEqual(a["recomputed"], K.STEPS)
            self.assertNotIn("bitcoin_anchor", a["recomputed"])
            self.assertEqual(a["limits"], K.LIMITS["day"])
            self.check_answer(a)
            self.assertEqual(W.intake_record(a, K.VANTAGE), K.intake_record(a))
            self.assertEqual(a["ledger_head"]["n"], 354)
            self.assertEqual(a["implementation"]["origin"], "operator-kit")
        self.assertEqual({r["purpose"] for r in self.records()}, {"furui-day-v0: " + D1})
        self.assertIn("shas=", rd(os.path.join(self.t, "gho")))

    def test_02_user_agent_named_and_only_get_and_one_post(self):
        self.run_kit()
        self.assertTrue(all(ua == K.UA for _, _, ua in self.w.calls))
        self.assertEqual(sorted({m for m, _, _ in self.w.calls}), ["GET", "POST"])
        self.assertEqual(sum(1 for m, _, _ in self.w.calls if m == "POST"), 2)

    def test_03_root_differs_is_a_signed_mismatch(self):
        self.w.day(D1, "runner-1", 3, bad="path")
        rc, ans = self.run_kit()
        a = self.one(ans)
        self.assertEqual((rc, a["outcome"], [x["step"] for x in a["failures"]]), (1, "mismatch", ["audit_path"]))
        self.assertNotIn("audit_path", a["recomputed"])
        W.check_shape_v02(a)

    def test_04_bad_envelope_signature_is_a_mismatch(self):
        self.w.day(D1, "runner-2", 3, bad="leaf_sig")
        rc, ans = self.run_kit()
        a = self.one(ans, "runner-2")
        self.assertEqual((a["outcome"], a["failures"][0]["step"], a["failures"][0]["leaf"]), ("mismatch", "signature", 1))

    def test_05_record_bytes_other_than_the_status_sha(self):
        self.w.day(D1, "runner-1", 3, bad="record_bytes")
        rc, ans = self.run_kit()
        a = self.one(ans)
        self.assertEqual((a["outcome"], a["failures"][0]["step"], a["root"], a["n"]), ("mismatch", "day_record", None, None))

    def test_06_leaf_not_served_held_at_0150_sent_at_0350(self):
        del self.w.routes[K.FURUI + "/furui/day/%s/leaf/2" % D1]
        rc, ans = self.run_kit(now="2026-11-20T01:52:00Z")
        self.assertEqual([a["runner_id"] for a in ans], ["runner-2"])
        self.keep_all()
        rc, ans = self.run_kit(now="2026-11-20T03:52:00Z")
        a = self.one(ans)
        self.assertEqual((rc, a["outcome"], a["leaf_index"], a["failures"][0]["step"]), (1, "incomplete", [0, 1], "envelope_shape"))
        W.check_shape_v02(a)

    def test_07_empty_and_open_days_are_not_answered(self):
        self.w.put(K.FURUI + "/furui/day/%s/status" % D1, {"day": D1, "checks": 0, "status": {"state": "empty"}})
        self.w.put(K.FURUI + "/furui2/day/%s/status" % D1, {"day": D1, "checks": 2, "status": None})
        rc, ans = self.run_kit()
        self.assertEqual((rc, ans), (0, []))

    def test_08_second_run_sends_nothing(self):
        self.run_kit()
        self.keep_all()
        rc, ans = self.run_kit(now="2026-11-20T04:30:00Z")
        self.assertEqual((rc, ans), (0, []))

    def test_09_just_after_midnight_takes_yesterday(self):
        rc, ans = self.run_kit(now="2026-11-20T00:00:05Z")
        self.assertEqual({a["day"] for a in ans}, {D1})

    def test_10_key_url_serving_another_key_sends_nothing(self):
        self.w.put(KU, {"public_key_ed25519_b64": base64.b64encode(self.w.rk["runner-1"][1]).decode()})
        with self.assertRaises(SystemExit):
            self.run_kit()
        self.assertEqual(self.w.posted, [])

    def test_11_post_refused_is_not_kept(self):
        self.w.post_status = 503
        rc, ans = self.run_kit()
        self.assertEqual((rc, os.listdir(self.out)), (1, []))
        self.assertIn("ok=no", rd(os.path.join(self.t, "gho")))

    def test_12_a_missed_day_is_filled(self):
        os.makedirs(os.path.join(self.ans, "2026-11-16"))
        self.run_kit(now="2026-11-17T04:00:00Z")
        self.keep_all()
        rc, ans = self.run_kit()
        self.assertEqual(sorted({a["day"] for a in ans}), ["2026-11-17", D0, D1])

    def test_13_hostile_answers_never_reach_the_signed_bytes(self):
        st = K.FURUI + "/furui/day/%s/status" % D1
        for body in (b'{"day":"2026-11-19","status":{"state":"accepted","n":1e309,"root":"' + b"ab" * 32 + b'","ledger_canonical_sha256":"' + b"ab" * 32 + b'"}}',
                     json.dumps({"day": D1, "status": {"state": "accepted", "n": 3, "root": "<script>", "ledger_canonical_sha256": H}}).encode(),
                     json.dumps({"day": D1, "status": {"state": "accepted\u202e", "n": 3}}).encode(),
                     b"x" * (2 << 20), b'{"day":"2026-11-19","status":NaN}'):
            self.w.routes[st] = (200, body)
            rc, ans = self.run_kit()
            self.assertEqual([a["runner_id"] for a in ans], ["runner-2"])
            for x in self.w.posted:
                self.assertFalse(re.search(r"<script>|\u202e|[\x00-\x1f]", x))

    def test_14_too_many_leaves_and_the_time_limit(self):
        self.w.day(D1, "runner-1", K.CALLS)
        rc, ans = self.run_kit()
        a = self.one(ans)
        self.assertEqual((a["outcome"], a["failures"][0]["detail"], a["leaf_index"]), ("incomplete", K.FAIL["too_many"][2], []))
        W.check_shape_v02(a)
        self.assertLessEqual(len(self.w.calls), K.CALLS)
        t = [0.0]

        def clock():
            t[0] += 40.0
            return t[0]
        self.w.calls = []
        self.w.day(D1, "runner-1", 3)
        rc, ans = self.run_kit(clock=clock)
        self.assertLessEqual(len(self.w.calls), int(K.RUN_S // 40))
        # what the run finished is signed; what it did not finish within its own limit is left for the next run, not signed
        self.assertEqual([(a["runner_id"], a["outcome"]) for a in ans], [("runner-1", "match")])

    def test_15_big_answer_and_redirect_are_unread(self):
        n = self.w.net()
        self.w.routes[K.LEDGER + "/ledger/head"] = (200, b" " * (K.CAP + 1))
        with self.assertRaises(K.Unread):
            n.json(K.LEDGER + "/ledger/head")
        self.w.routes[K.LEDGER + "/ledger/head"] = (302, b"")
        with self.assertRaises(K.Unread):
            n.json(K.LEDGER + "/ledger/head")
        with self.assertRaises(K.Unread):
            n.fetch("https://evil.example/x")

    def test_16_head_unread_keeps_the_match(self):
        self.w.routes[K.LEDGER + "/ledger/head"] = (503, b"")
        rc, ans = self.run_kit()
        a = self.one(ans)
        self.assertEqual((a["outcome"], a["ledger_head"], [x["step"] for x in a["failures"]]), ("match", None, ["ledger_head"]))
        W.check_shape_v02(a)

    def test_17_keep_checks_the_bytes_and_writes_status(self):
        self.run_kit()
        st = os.path.join(self.t, "status.json")
        wr(st, json.dumps({"schema": "furui-witness-status-v0", "current_key_id": "ed25519:" + "0" * 16, "revoked": []}))
        shas = " ".join(sorted(f[:-5] for f in os.listdir(self.out)))
        bad = os.path.join(self.t, "bad")
        shutil.copytree(self.out, bad)
        f0 = sorted(os.listdir(bad))[0]
        wr(os.path.join(bad, f0), b" ", "ab")
        for inc, s in ((bad, shas), (self.out, shas.split(" ")[0]), (self.out, "zz")):
            with self.assertRaises(SystemExit):
                K.keep({"--incoming": inc, "--shas": s, "--answers": self.ans, "--status": st, "--now": NOW})
        self.assertFalse(os.path.exists(self.ans))
        self.assertEqual(K.keep({"--incoming": self.out, "--shas": shas, "--answers": self.ans, "--status": st, "--now": NOW}), 0)
        for s in shas.split(" "):
            self.assertEqual(K.sha(rd(os.path.join(self.ans, D1, s + ".json"), "rb")), s)
        j = json.loads(rd(st))
        self.assertEqual((j["schema"], j["last_answer"] in shas.split(" "), j["revoked"]), ("furui-witness-status-v0", True, []))
        wr(st, '{"schema": "something-else"}')
        with self.assertRaises(SystemExit):
            K.keep({"--incoming": self.out, "--shas": shas, "--answers": self.ans, "--status": st})

    def test_18_the_key_file_is_removed(self):
        s = K.Signer(rd(self.w.wk[0]))
        t = s.t
        s.sign(b"x")
        s.close()
        self.assertFalse(os.path.exists(t))

    # ---- anchor answers (0.2.0) ----
    def test_19_anchor_answer_once_the_batch_is_confirmed(self):
        self.first_answered()
        merkle, hx = self.w.anchor(380, [(D1, "runner-2"), (D0, "runner-1")], 977449)
        rc, ans = self.run_kit(now="2026-11-20T03:52:00Z")
        self.assertEqual((rc, len(ans)), (0, 1))
        a = self.one(ans, "runner-2", kind="anchor")
        self.assertEqual((a["outcome"], a["recomputed"], a["failures"], a["leaf_index"], a["limits"]), ("match", K.ANCHOR_STEPS, [], [0, 1, 2], K.LIMITS["anchor"]))
        self.check_answer(a)
        r = self.records()[0]
        self.assertEqual((r["purpose"], r["commitment"], r["base"]), ("furui-anchor-v0: " + D1, a["day_sha256"], K.LEDGER + "/furui-check-day/" + a["day_sha256"]))
        self.assertIn("ledger entry 380, whose OpenTimestamps proof reaches Bitcoin block 977449 (%s)" % block_hash(hx), r["establishes"][2])
        self.assertEqual(r["establishes"][0], "the witness recomputed: " + ", ".join(K.ANCHOR_STEPS))
        self.assertNotEqual(K.anchor_record(a, None), W.intake_record(a, K.VANTAGE))
        self.keep_all()
        # runner-1's record of D1 goes into the next day's batch; it is answered then, and nothing is sent twice
        rc, ans = self.run_kit(now="2026-11-20T04:30:00Z")
        self.assertEqual((rc, ans), (0, []))
        self.w.anchor(386, [(D1, "runner-1")], 977600)
        rc, ans = self.run_kit(now="2026-11-21T03:51:00Z")
        self.assertEqual(sorted((a["day"], a["runner_id"], a["outcome"], "bitcoin_anchor" in a["recomputed"]) for a in ans),
                         [(D1, "runner-1", "match", True), ("2026-11-20", "runner-1", "match", False), ("2026-11-20", "runner-2", "match", False)])
        self.keep_all()
        rc, ans = self.run_kit(now="2026-11-21T05:00:00Z")
        self.assertEqual((rc, ans), (0, []))

    def test_20_not_anchored_yet_waits_then_signs_incomplete_after_4_days(self):
        self.first_answered()
        rc, ans = self.run_kit(now="2026-11-21T03:52:00Z")
        self.assertEqual(sorted({(a["day"], "bitcoin_anchor" in a["recomputed"]) for a in ans}), [("2026-11-20", False)])
        self.assertEqual(rc, 0)
        self.keep_all()
        for day in ("2026-11-22", "2026-11-23"):
            self.keep_all()
            rc, ans = self.run_kit(now=day + "T03:52:00Z")
            self.assertFalse(any(a["day"] == D1 for a in ans))
        self.keep_all()
        rc, ans = self.run_kit(now="2026-11-24T03:52:00Z")
        x = [a for a in ans if a["day"] == D1]
        self.assertEqual(sorted(a["runner_id"] for a in x), ["runner-1", "runner-2"])
        for a in x:
            self.assertEqual((a["outcome"], a["recomputed"], [f["step"] for f in a["failures"]], a["failures"][0]["detail"]),
                             ("incomplete", K.STEPS, ["bitcoin_anchor"], K.FAIL["anchor_wait"][2]))
            self.check_answer(a)
        self.assertEqual(rc, 1)
        rec = [r for r in self.records() if r["answer"]["day"] == D1][0]
        self.assertEqual((rec["purpose"], len(rec["establishes"])), ("furui-anchor-v0: " + D1, 2))

    def test_21_anchor_mismatches_are_signed(self):
        for bad, code in (("not_listed", "anchor_entry"), ("claim", "anchor_entry"), ("ots_digest", "anchor_ots"), ("ots_height", "anchor_ots"),
                          ("ots_bytes", "anchor_ots"), ("root", "anchor_root")):
            with self.subTest(bad=bad):
                shutil.rmtree(self.ans, ignore_errors=True)
                self.w = World(self.t)
                os.environ["FURUI_WITNESS_KEY"] = rd(self.w.wk[0])
                self.w.put(KU, {"public_key_ed25519_b64": base64.b64encode(self.w.wk[1]).decode()})
                self.first_answered()
                self.w.anchor(380, [(D1, "runner-2")], 977449, bad=bad)
                rc, ans = self.run_kit(now="2026-11-20T03:52:00Z")
                a = self.one(ans, "runner-2", kind="anchor")
                self.assertEqual((rc, a["outcome"], [f["detail"] for f in a["failures"]], a["recomputed"]), (1, "mismatch", [K.FAIL[code][2]], K.STEPS))
                self.check_answer(a)
                self.assertEqual(len(self.records()[0]["establishes"]), 2)

    def test_22_explorers_that_disagree_or_a_header_off_target_are_tried_again_then_incomplete(self):
        for bad, code in (("explorers", "anchor_explorer"), ("target", "anchor_header")):
            with self.subTest(bad=bad):
                shutil.rmtree(self.ans, ignore_errors=True)
                self.w = World(self.t)
                os.environ["FURUI_WITNESS_KEY"] = rd(self.w.wk[0])
                self.first_answered()
                self.w.anchor(380, [(D1, "runner-2")], 977449, bad=bad)
                rc, ans = self.run_kit(now="2026-11-20T03:52:00Z")
                self.assertEqual((rc, ans), (0, []))
                rc, ans = self.run_kit(now="2026-11-24T01:52:00Z")
                a = self.one(ans, "runner-2", kind="anchor")
                self.assertEqual((rc, a["outcome"], [f["detail"] for f in a["failures"]]), (1, "incomplete", [K.FAIL[code][2]]))
                self.check_answer(a)

    def test_23_explorer_down_is_tried_again(self):
        self.first_answered()
        self.w.anchor(380, [(D1, "runner-2")], 977449)
        del self.w.routes[BLOCKSTREAM + "/block-height/977449"]
        rc, ans = self.run_kit(now="2026-11-20T03:52:00Z")
        self.assertEqual((rc, ans), (0, []))
        self.w.anchor(380, [(D1, "runner-2")], 977449)
        rc, ans = self.run_kit(now="2026-11-20T05:52:00Z")
        self.assertEqual(self.one(ans, "runner-2", kind="anchor")["outcome"], "match")

    def test_24_one_entry_and_one_block_are_read_once(self):
        self.first_answered()
        self.w.anchor(380, [(D1, "runner-2"), (D1, "runner-1")], 977449)
        self.w.calls = []
        rc, ans = self.run_kit(now="2026-11-20T03:52:00Z")
        self.assertEqual(sorted(a["runner_id"] for a in ans), ["runner-1", "runner-2"])
        urls = [u for _, u, _ in self.w.calls]
        for u in (K.LEDGER + "/ledger/380?format=json", K.LEDGER + "/ledger/380/ots", MEMPOOL + "/block-height/977449", BLOCKSTREAM + "/block-height/977449"):
            self.assertEqual(urls.count(u), 1, u)
        self.assertEqual(sum(1 for u in urls if "/leaf/" in u), 6)

    def test_25_a_late_day_gets_both_answers_in_one_run_and_its_leaves_are_read_once(self):
        os.makedirs(os.path.join(self.ans, "2026-11-16"))
        self.run_kit(now="2026-11-17T04:00:00Z")
        self.keep_all()
        self.w.anchor(377, [(D0, "runner-1"), (D0, "runner-2")], 977300)
        self.w.calls = []
        rc, ans = self.run_kit()
        got = sorted((a["day"], a["runner_id"], "bitcoin_anchor" in a["recomputed"]) for a in ans)
        self.assertIn((D0, "runner-1", True), got)
        self.assertIn((D0, "runner-1", False), got)
        urls = [u for _, u, _ in self.w.calls]
        self.assertEqual(sum(1 for u in urls if "/furui/day/%s/leaf/" % D0 in u), 3)
        self.assertEqual(rc, 0)

    def test_26_the_real_proof_of_entry_80_and_the_real_header_of_block_970879(self):
        proof = base64.b64decode(rd(os.path.join(FCD, "ots_entry80.ots.b64")))
        digest, btc, pend = K.ots_parse(proof)
        v = json.loads(rd(os.path.join(FCD, "bitcoin_header_vectors.json")))
        c = v["cases"][0]
        self.assertEqual(c["expect"]["state"], "ok")
        h, mr = c["args"]["height"], c["args"]["merkle_root"]
        self.assertIn((h, mr), btc)
        world = {u: (x["status"], x["body"].encode("latin-1")) for u, x in c["world"].items()}
        w = self.w

        class N(K.Net):
            def _open(self, req, timeout):
                w.calls.append(req.full_url)
                return world.get(req.full_url, (404, b""))
        an = K.Anchor(N(["mempool.space", "blockstream.info"]))
        code, got = an._header(h)
        self.assertEqual((code, got), (None, {"block_hash": c["expect"]["facts"]["block_hash"], "merkle_root": mr}))
        for b in (proof[:-1], proof + b"\x00", proof[:20], b"\x01" + proof[1:]):
            with self.assertRaises(ValueError):
                K.ots_parse(b)

    def test_26b_the_real_entry_380_and_block_977449(self):
        fx = json.loads(rd(os.path.join(HERE, "real_anchor_entry380.json")))
        ots = bytes.fromhex(fx["ots_hex"])
        self.assertEqual((K.sha(ots), K.sha(fx["record_canonical"])), (fx["ots_sha256"], fx["claim_sha256"]))
        e = {k: fx[k] for k in ("claim_sha256", "record_canonical", "ots_status", "bitcoin_block")}
        world = {K.LEDGER + "/ledger/380?format=json": (200, json.dumps(e).encode()), K.LEDGER + "/ledger/380/ots": (200, ots)}
        for base in (MEMPOOL, BLOCKSTREAM):
            world[base + "/block-height/977449"] = (200, fx["block_hash"].encode())
            world[base + "/block/%s/header" % fx["block_hash"]] = (200, fx["header"].encode())

        class N(K.Net):
            def _open(self, req, timeout):
                return world.get(req.full_url, (404, b""))
        an = K.Anchor(N(["ledger.horizonshield.dev", "mempool.space", "blockstream.info"]))
        for s in fx["day_records"].values():
            self.assertEqual(an.check(s, {"status": "anchored", "ledger_entry": 380}),
                             ("ok", None, {"ledger_entry": 380, "bitcoin_block": 977449, "block_hash": fx["block_hash"]}))
        self.assertEqual(an.check("01d72f5ac2714c35bdf897763e34445f2926951f099592f1fb7cd55a98532569", {"status": "anchored", "ledger_entry": 380}), ("done", "anchor_entry", None))
        self.assertEqual(an.check(H, {"status": "pending_anchor", "ledger_entry": None}), ("wait", None, None))

    def test_27_key_url_may_serve_one_openssh_line(self):
        wire = (11).to_bytes(4, "big") + b"ssh-ed25519" + (32).to_bytes(4, "big") + self.w.wk[1]
        line = "ssh-ed25519 " + base64.b64encode(wire).decode()
        for body in (line, line + " witness@example\n", line + "\r\n"):
            self.assertEqual(K.served_key(body.encode()), self.w.wk[1])
        for body in (line + "\n" + line, "ssh-rsa " + base64.b64encode(wire).decode(), line + "=", line[:-4], 'from="x" ' + line):
            self.assertIsNone(K.served_key(body.encode()))
        self.w.put(KU, line + " witness@example\n")
        rc, ans = self.run_kit()
        self.assertEqual((rc, len(ans)), (0, 2))

    def test_28_kit_010_answers_are_day_answers(self):
        self.first_answered()
        for f in os.listdir(os.path.join(self.ans, D1)):
            p = os.path.join(self.ans, D1, f)
            r = json.loads(rd(p))
            r["answer"]["tool"] = "furui-witness-kit 0.1.0 furui_witness.py sha256 " + "ab" * 32
            wr(p, K.canonical(r))
        day, anchor = K.kept_answers(self.ans)
        self.assertEqual((sorted(day), anchor), ([(D1, "runner-1"), (D1, "runner-2")], set()))

    def test_29_the_call_limit_puts_work_off_and_never_signs_it_incomplete(self):
        old = K.CALLS
        try:
            os.makedirs(os.path.join(self.ans, "2026-11-16"))
            self.run_kit(now="2026-11-17T04:00:00Z")
            self.keep_all()
            self.w.anchor(377, [(D0, "runner-1"), (D0, "runner-2")], 977300)
            K.CALLS = 12
            self.w.calls = []
            rc, ans = self.run_kit()
            self.assertTrue(all(a["outcome"] == "match" for a in ans))
            self.assertLessEqual(len(self.w.calls), 12)
        finally:
            K.CALLS = old


# ---- setup.sh, with gh, git and curl answered by stubs (no account, no network) ----
GH_STUB = r"""#!/usr/bin/env bash
echo "gh $*" >> "$STUB_LOG"
case "$1 $2" in
  "auth status") exit 0 ;;
  "repo view") case "$*" in *nameWithOwner*) echo "Tester/witness" ;; *visibility*) echo "${STUB_VISIBILITY:-PUBLIC}" ;; esac ;;
  "secret set") cat > "$STUB_DIR/secret.pem" ;;
  "variable set") echo "$3=$7" >> "$STUB_DIR/vars" ;;
  "api repos/Tester/witness/pages") exit 1 ;;
esac
exit 0
"""
GIT_STUB = r"""#!/usr/bin/env bash
echo "git $*" >> "$STUB_LOG"
case "$1" in
  config) echo "t@example.com" ;;
  diff) exit 1 ;;
  branch) echo "main" ;;
esac
exit 0
"""
CURL_STUB = r"""#!/usr/bin/env bash
url=""; for a in "$@"; do url=$a; done
echo "curl $url" >> "$STUB_LOG"
case "$url" in
  https://tester.github.io/witness/*) f="$PWD/${url#https://tester.github.io/witness/}" ;;
  https://own.example/*) f="$PWD/place_on_your_site/$(basename "$url")" ;;
  *) exit 22 ;;
esac
[ -f "$f" ] || exit 22
cat "$f"
"""


def openssh_private(seed, pub, cipher=b"none"):
    """an OpenSSH private key file (openssh-key-v1) for an Ed25519 key, without a passphrase unless cipher says otherwise"""
    st = lambda b: len(b).to_bytes(4, "big") + b
    blob = st(b"ssh-ed25519") + st(pub)
    priv = b"\x01\x02\x03\x04" * 2 + st(b"ssh-ed25519") + st(pub) + st(seed + pub) + st(b"test@example")
    priv += bytes(range(1, 1 + (-len(priv)) % 8))
    b = b"openssh-key-v1\x00" + st(cipher) + st(b"none" if cipher == b"none" else b"bcrypt") + st(b"") + (1).to_bytes(4, "big") + st(blob) + st(priv)
    t = base64.b64encode(b).decode()
    return "-----BEGIN OPENSSH PRIVATE" + " KEY-----\n" + "\n".join(t[i:i + 70] for i in range(0, len(t), 70)) + "\n-----END OPENSSH PRIVATE" + " KEY-----\n"


class SetupSh(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.mkdtemp()
        self.repo, self.bin = os.path.join(self.t, "repo"), os.path.join(self.t, "bin")
        os.makedirs(os.path.join(self.repo, ".github", "workflows"))
        os.makedirs(self.bin)
        for f in ("furui_witness.py", "setup.sh", ".gitattributes", os.path.join(".github", "workflows", "furui-witness.yml")):
            shutil.copy(os.path.join(HERE, "kit", f), os.path.join(self.repo, f))
        for n, body in (("gh", GH_STUB), ("git", GIT_STUB), ("curl", CURL_STUB)):
            wr(os.path.join(self.bin, n), body)
            os.chmod(os.path.join(self.bin, n), 0o755)
        self.env = dict(os.environ, PATH=self.bin + os.pathsep + os.environ["PATH"], STUB_LOG=os.path.join(self.t, "log"), STUB_DIR=self.t)

    def tearDown(self):
        shutil.rmtree(self.t)

    def run_setup(self, *args, env=None):
        r = subprocess.run(["bash", "setup.sh"] + list(args), cwd=self.repo, env=env or self.env, capture_output=True, text=True, timeout=120)
        return r.returncode, r.stdout + r.stderr

    def secret_key(self):
        p = os.path.join(self.t, "secret.pem")
        return ossl("pkey", "-in", p, "-pubout", "-outform", "DER")[12:]

    def vars(self):
        return dict(x.split("=", 1) for x in rd(os.path.join(self.t, "vars")).splitlines())

    def test_pages_mode_makes_a_key_and_serves_it_with_pages(self):
        rc, out = self.run_setup("Test Witness")
        self.assertEqual(rc, 0, out)
        k = self.secret_key()
        kid16 = K.sha(k)[:16]
        v = self.vars()
        self.assertEqual(v, {"FURUI_WITNESS_KEY_URL": "https://tester.github.io/witness/keys/%s.json" % kid16, "FURUI_WITNESS_NAME": "Test Witness"})
        self.assertEqual(K.served_key(rd(os.path.join(self.repo, "keys", kid16 + ".json"), "rb")), k)
        st = json.loads(rd(os.path.join(self.repo, "status.json")))
        self.assertEqual((st["schema"], st["current_key_id"], "answers_url" in st), ("furui-witness-status-v0", "ed25519:" + kid16, False))
        self.assertIn("gh workflow run furui-witness.yml --repo Tester/witness", rd(os.path.join(self.t, "log")))
        self.assertFalse(os.path.exists(os.path.join(self.repo, "place_on_your_site")))

    def test_own_site_mode_with_a_pem_key_prints_the_two_files(self):
        pem, pub = newkey(self.t, "mine.pem")
        rc, out = self.run_setup("Test Witness", "--key-url", "https://own.example/keys/witness.pub", "--key-file", pem)
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.secret_key(), pub)
        self.assertEqual(self.vars()["FURUI_WITNESS_KEY_URL"], "https://own.example/keys/witness.pub")
        line = rd(os.path.join(self.repo, "place_on_your_site", "witness.pub"), "rb")
        self.assertTrue(line.startswith(b"ssh-ed25519 "))
        self.assertEqual(K.served_key(line), pub)
        st = json.loads(rd(os.path.join(self.repo, "place_on_your_site", "status.json")))
        self.assertEqual((st["current_key_id"], st["answers_url"]), ("ed25519:" + K.sha(pub)[:16], "https://tester.github.io/witness/answers/"))
        self.assertIn("https://own.example/status.json", out)
        self.assertFalse(os.path.exists(os.path.join(self.repo, "keys")))
        self.assertNotIn("place_on_your_site", rd(os.path.join(self.t, "log")))

    def test_an_openssh_key_is_read_and_one_with_a_passphrase_is_refused_with_the_way_out(self):
        pem, pub = newkey(self.t, "seed.pem")
        der = ossl("pkey", "-in", pem, "-outform", "DER")
        seed = der[-32:]
        wr(os.path.join(self.t, "id_ed25519"), openssh_private(seed, pub))
        rc, out = self.run_setup("Test Witness", "--key-url", "https://own.example/witness.json", "--key-file", os.path.join(self.t, "id_ed25519"))
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.secret_key(), pub)
        self.assertEqual(K.served_key(rd(os.path.join(self.repo, "place_on_your_site", "witness.json"), "rb")), pub)
        shutil.rmtree(self.repo)
        self.setUp()
        wr(os.path.join(self.t, "id_locked"), openssh_private(seed, pub, cipher=b"aes256-ctr"))
        rc, out = self.run_setup("Test Witness", "--key-file", os.path.join(self.t, "id_locked"))
        self.assertEqual(rc, 1)
        self.assertIn("ssh-keygen -p -N", out)

    def test_crlf_copies_from_windows_still_run_and_are_made_lf(self):
        for f in ("setup.sh", "furui_witness.py"):
            p = os.path.join(self.repo, f)
            wr(p, rd(p, "rb").replace(b"\n", b"\r\n"), "wb")
        rc, out = self.run_setup("Test Witness")
        self.assertEqual(rc, 0, out)
        for f in ("setup.sh", "furui_witness.py"):
            self.assertEqual(rd(os.path.join(self.repo, f), "rb"), rd(os.path.join(HERE, "kit", f), "rb"))

    def test_python_under_another_name(self):
        real = shutil.which("python3")
        wr(os.path.join(self.bin, "python3"), "#!/bin/sh\necho 'Python was not found; run without arguments to install from the Microsoft Store' >&2\nexit 9009\n")
        wr(os.path.join(self.bin, "python"), "#!/bin/sh\nexec %s \"$@\"\n" % real)
        for n in ("python3", "python"):
            os.chmod(os.path.join(self.bin, n), 0o755)
        rc, out = self.run_setup("Test Witness")
        self.assertEqual(rc, 0, out)

    def test_python_that_ends_its_lines_in_cr_lf_as_on_windows(self):
        real = shutil.which("python3")
        wr(os.path.join(self.bin, "python3"), "#!/bin/sh\nexit 9009\n")
        wr(os.path.join(self.bin, "python"), "#!/usr/bin/env bash\nset -o pipefail\n%s \"$@\" | sed 's/$/\\r/'\n" % real)
        for n in ("python3", "python"):
            os.chmod(os.path.join(self.bin, n), 0o755)
        pem, pub = newkey(self.t, "mine.pem")
        rc, out = self.run_setup("Test Witness", "--key-url", "https://own.example/keys/witness.pub", "--key-file", pem)
        self.assertEqual(rc, 0, out)
        self.assertNotIn("not the released", out)
        for f in ("witness.pub", "status.json"):
            self.assertNotIn(b"\r", rd(os.path.join(self.repo, "place_on_your_site", f), "rb"), f)
        self.assertEqual(K.served_key(rd(os.path.join(self.repo, "place_on_your_site", "witness.pub"), "rb")), pub)
        self.assertEqual(self.vars()["FURUI_WITNESS_KEY_URL"], "https://own.example/keys/witness.pub")
        self.assertEqual(json.loads(rd(os.path.join(self.repo, "status.json")))["current_key_id"], "ed25519:" + K.sha(pub)[:16])

    def test_rotate_lists_the_old_key_as_previous(self):
        rc, out = self.run_setup("Test Witness")
        self.assertEqual(rc, 0, out)
        k1 = self.secret_key()
        rc, out = self.run_setup("--rotate")
        self.assertEqual(rc, 0, out)
        k2 = self.secret_key()
        st = json.loads(rd(os.path.join(self.repo, "status.json")))
        self.assertNotEqual(k1, k2)
        self.assertEqual((st["current_key_id"], [x["key_id"] for x in st["previous_key_ids"]]), ("ed25519:" + K.sha(k2)[:16], ["ed25519:" + K.sha(k1)[:16]]))
        self.assertTrue(os.path.isfile(os.path.join(self.repo, "keys", K.sha(k1)[:16] + ".json")))
        rc, out = self.run_setup("--rotate", "--key-url", "https://own.example/keys/witness.pub")
        self.assertEqual(rc, 0, out)
        k3 = self.secret_key()
        st = json.loads(rd(os.path.join(self.repo, "place_on_your_site", "status.json")))
        self.assertEqual((st["current_key_id"], len(st["previous_key_ids"]), st["answers_url"]), ("ed25519:" + K.sha(k3)[:16], 2, "https://tester.github.io/witness/answers/"))
        self.assertEqual(rd(os.path.join(self.t, "vars")).splitlines()[-1], "FURUI_WITNESS_KEY_URL=https://own.example/keys/witness.pub")

    def test_refusals(self):
        for args, env, want in ((["Test Witness"], dict(self.env, STUB_VISIBILITY="PRIVATE"), "must be public"),
                                (["bad/name"], None, "the name takes"),
                                (["Test Witness", "--key-url", "http://own.example/k.json"], None, "--key-url must be https"),
                                (["Test Witness", "--status-url", "https://own.example/status.json"], None, "--status-url goes with --key-url"),
                                (["--rotate"], None, "--rotate needs the status.json"),
                                (["Test Witness", "--key-url", "https://own.example/keys/witness.json", "--status-url", "https://own.example/keys/status.json"], None,
                                 "reads status.json at https://own.example/status.json")):
            rc, out = self.run_setup(*args, env=env)
            self.assertEqual(rc, 1, args)
            self.assertIn(want, out)


class Workflow(unittest.TestCase):
    def jobs(self):
        y = rd(os.path.join(HERE, "kit", ".github", "workflows", "furui-witness.yml"))
        parts = re.split(r"\n  (answer|keep):\n", y)
        return y, dict(zip(parts[1::2], parts[2::2]))

    def test_key_job_cannot_write_and_write_job_has_no_secret(self):
        y, j = self.jobs()
        self.assertIn("permissions: {}", y)
        self.assertIn("permissions:\n      contents: read\n", j["answer"])
        self.assertNotIn("write", j["answer"])
        self.assertIn("secrets.FURUI_WITNESS_KEY", j["answer"])
        self.assertIn("permissions:\n      contents: write\n", j["keep"])
        self.assertNotIn("secrets.", j["keep"])
        self.assertIn("persist-credentials: false", j["answer"])

    def test_actions_pinned_and_no_outside_trigger(self):
        y, _ = self.jobs()
        uses = re.findall(r"uses: (\S+)", y)
        self.assertEqual(len(uses), 4)
        self.assertTrue(all(re.fullmatch(r"actions/(checkout|upload-artifact|download-artifact)@[0-9a-f]{40}", u) for u in uses))
        self.assertNotRegex(y, r"pull_request|issue|workflow_run|repository_dispatch")
        self.assertNotRegex(y, r"run:.*\$\{\{")

    def test_the_answer_job_has_time_for_the_run_limit(self):
        y, j = self.jobs()
        m = re.search(r"timeout-minutes: (\d+)", j["answer"])
        self.assertGreaterEqual(int(m.group(1)) * 60, K.RUN_S + 60)

    def test_versions_lists_the_files_of_this_version(self):
        v = json.loads(rd(os.path.join(HERE, "VERSIONS.json")))
        x = next(x for x in v["versions"] if x["version"] == K.VERSION)
        sh = lambda p: K.sha(rd(os.path.join(HERE, "kit", p), "rb"))
        self.assertEqual((x["furui_witness_py_sha256"], x["furui_witness_yml_sha256"], x["setup_sh_sha256"], x["gitattributes_sha256"]),
                         (sh("furui_witness.py"), sh(os.path.join(".github", "workflows", "furui-witness.yml")), sh("setup.sh"), sh(".gitattributes")))
        self.assertIn('KIT_PY_SHA256="%s"' % sh("furui_witness.py"), rd(os.path.join(HERE, "kit", "setup.sh")))
        self.assertEqual(K.VANTAGE, "a GitHub Actions runner of the witness (furui-witness-kit %s)" % K.VERSION)

    def test_line_endings_are_kept_lf(self):
        self.assertEqual(rd(os.path.join(HERE, "kit", ".gitattributes")).splitlines()[-1], "* text=auto eol=lf")
        for p in ("furui_witness.py", "setup.sh", os.path.join(".github", "workflows", "furui-witness.yml"), ".gitattributes"):
            self.assertNotIn(b"\r", rd(os.path.join(HERE, "kit", p), "rb"), p)


if __name__ == "__main__":
    unittest.main(verbosity=1)
