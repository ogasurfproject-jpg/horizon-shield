"""test_furui_witness.py: the witness kit (kit/furui_witness.py and kit/.github/workflows/furui-witness.yml) without the network.

A test world answers the kit's URLs: two runners and the ledger, with day records and leaves signed by openssl keys made
here. Every answer the kit signs is read back with ../witness-answer-v0/witness_answer_v0.py (shape v0.2, signature,
and the intake record's bytes). Needs python3 and openssl 3 or later.  python3 -I -B test_furui_witness.py
"""
import base64, json, os, re, shutil, subprocess, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "kit"))
sys.path.insert(0, os.path.join(HERE, "..", "witness-answer-v0"))
import furui_witness as K  # noqa: E402
import witness_answer_v0 as W  # noqa: E402

H = "ab" * 32
KU = "https://w.example/kit/keys/k.json"
D1, NOW = "2026-11-19", "2026-11-20T04:10:00Z"


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


class World:
    """URL -> (status, bytes); posts are verified like the ledger's intake does and kept in self.posted"""
    def __init__(self, t, n=3):
        self.t, self.routes, self.posted, self.calls = t, {}, [], []
        self.rk = {r: newkey(t, r + ".pem") for r in K.TREES}
        self.wk = newkey(t, "witness.pem")
        self.put(K.SIGNER["key_url"], {"use": "furui-check", "keys": [{"key_id": r, "public_key_ed25519_b64": base64.b64encode(self.rk[r][1]).decode(),
                                                                       "from_height": 0, "revoked_height": None} for r in K.TREES]})
        self.put(K.LEDGER + "/ledger/head", {"n": 354, "head": "cd" * 32})
        self.put(KU, {"public_key_ed25519_b64": base64.b64encode(self.wk[1]).decode()})
        self.post_status = 201
        for d in ("2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", D1):
            for r in K.TREES:
                self.day(d, r, n)

    def put(self, url, obj, status=200):
        self.routes[url] = (status, obj if isinstance(obj, bytes) else json.dumps(obj).encode())

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
        self.put(K.LEDGER + "/furui-check-day/" + rs, {"record_canonical": rc + (" " if bad == "record_bytes" else ""), "status": "anchored", "ledger_entry": 340})
        for i, e in enumerate(envs):
            pr = path(i, leaves)
            if bad == "path" and i == 0:
                pr = ["00" * 32] + pr[1:]
            ec = K.canonical(e)
            self.put(base + "/leaf/%d" % i, {"day": d, "index": i, "envelope": e, "leaf_sha256": leaves[i], "envelope_sha256": K.sha(ec),
                                              "proof_kind": "rfc6962-audit-path", "proof": pr, "n": n, "root": root,
                                              "day_record": {"state": "accepted", "ledger_canonical_sha256": rs}})
        return rs

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
        return N(["furui.horizonshield.dev", "ledger.horizonshield.dev", "w.example"], **({"now": clock} if clock else {}))


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
        rc = K.answer(a, net=self.w.net(clock))
        return rc, [json.loads(x)["answer"] for x in self.w.posted]

    def keep_all(self):
        for f in os.listdir(self.out):
            b = rd(os.path.join(self.out, f), "rb")
            d = json.loads(b)["answer"]["day"]
            os.makedirs(os.path.join(self.ans, d), exist_ok=True)
            wr(os.path.join(self.ans, d, f), b, "wb")

    def one(self, ans, rid="runner-1", d=D1):
        x = [a for a in ans if a["runner_id"] == rid and a["day"] == d]
        self.assertEqual(len(x), 1)
        return x[0]

    def test_01_match_both_runners_verify_with_the_helper(self):
        rc, ans = self.run_kit()
        self.assertEqual(rc, 0)
        self.assertEqual(sorted(a["runner_id"] for a in ans), ["runner-1", "runner-2"])
        for a in ans:
            self.assertEqual(a["outcome"], "match")
            self.assertEqual(a["recomputed"], K.STEPS)
            self.assertNotIn("bitcoin_anchor", a["recomputed"])
            self.assertIn("The Bitcoin anchor was not checked by this tool.", a["limits"])
            W.check_shape_v02(a)
            self.assertTrue(all(ok for _, ok, _ in W.verify(a, {"public_key_ed25519_b64": base64.b64encode(self.w.wk[1]).decode()}, W.SCHEMA_V02)))
            self.assertEqual(W.intake_record(a, K.VANTAGE), K.intake_record(a))
            self.assertEqual(a["ledger_head"]["n"], 354)
            self.assertEqual(a["implementation"]["origin"], "operator-kit")
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
        self.assertEqual(sorted({a["day"] for a in ans}), ["2026-11-17", "2026-11-18", D1])

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

    def test_14_call_and_time_limits(self):
        self.w.day(D1, "runner-1", 70)
        rc, ans = self.run_kit()
        a = self.one(ans)
        self.assertEqual((a["outcome"], a["failures"][0]["detail"]), ("incomplete", K.FAIL["too_many"][2]))
        self.assertLessEqual(len(self.w.calls), K.CALLS)
        t = [0.0]

        def clock():
            t[0] += 40.0
            return t[0]
        self.w.calls = []
        rc, ans = self.run_kit(clock=clock)
        self.assertLessEqual(len(self.w.calls), int(K.RUN_S // 40))
        self.assertEqual(rc, 1)

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


if __name__ == "__main__":
    unittest.main(verbosity=1)
