"""tests for witness_answer_v0.py. No network: every socket call raises before the tests start.

    python3 -I -B test_witness_answer_v0.py                 run the tests
    python3 -I -B test_witness_answer_v0.py --write-vectors  rewrite vectors.json (deterministic; the tests compare against it)
"""
import socket


def _no_network(*a, **k):
    raise RuntimeError("network is not allowed in these tests")


socket.socket = _no_network
socket.create_connection = _no_network
socket.getaddrinfo = _no_network

import base64, copy, hashlib, importlib.util, json, os, re, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
_sp = importlib.util.spec_from_file_location("witness_answer_v0", os.path.join(HERE, "witness_answer_v0.py"))
W = importlib.util.module_from_spec(_sp)
_sp.loader.exec_module(W)

# RFC 8032 section 7.1 TEST 1 and TEST 2 (public test keys, not anyone's key)
SEED1 = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
PUB1 = bytes.fromhex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a")
SIG1 = bytes.fromhex("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b")
SEED2 = bytes.fromhex("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb")
PUB2 = bytes.fromhex("3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c")
SIG2 = bytes.fromhex("92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00")
KEY_URL = "https://witness.example/keys/witness.json"
DOC1 = {"public_key_ed25519_b64": base64.b64encode(PUB1).decode()}
DOC2 = {"public_key_ed25519_b64": base64.b64encode(PUB2).decode()}
LIMITS = ["digest and inclusion checks only; not the correctness of the content",
          "not the completeness of the day's log",
          "the runner key was taken from the key list the ledger serves; its history was not authenticated separately"]
H = lambda s: hashlib.sha256(s.encode()).hexdigest()


def fx(name):
    with open(os.path.join(HERE, "fixtures", name), "r", encoding="utf-8") as f:
        return json.load(f)


def furui_check(leaf, states=None, n=2, root=H("root"), rec=H("rec"), day="2026-11-03"):
    states = states or {}
    return {"schema": "nenrin-furui-check-v1", "command": "furui-day", "args": {"day": day, "leaf": leaf}, "verdict": "ok",
            "first_not_ok": None, "steps": [{"step": i + 1, "name": s, "state": states.get(s, "ok"), "code": None} for i, s in enumerate(W.FURUI_STEPS)],
            "facts": {"day": day, "leaf": leaf, "record_sha256": rec, "n": n, "root": root, "ledger_entry": None, "bitcoin_block": None, "merkle_root": None}}


def tooshi_result(at="2026-11-06T05:00:00Z"):
    return {"schema": "tooshi-daily-v0", "checked_at": at, "trigger": "manual", "verdict": "green",
            "counts": {"ok": 2, "red": 0, "notice": 0, "not_yet": 1},
            "checks": [{"id": "1_sieve_admission", "state": "ok", "why": "w", "facts": {}},
                       {"id": "5_door_runner", "state": "ok", "why": "w", "facts": {"k": 1}},
                       {"id": "3_ledger_settle", "state": "not_yet", "why": "w", "facts": {}}]}


def furui_answer(seed=SEED1, pub=PUB1):
    a = W.build_furui([furui_check(0, {"bitcoin_anchor": "not_yet"}), furui_check(1)], "pipavlo82", KEY_URL, LIMITS, "2026-11-04T02:36:00Z", "nenrin-verify 0.8.1 furui-day")
    return W.finish(a, pub, seed)


def tooshi_answer(seed=SEED1, pub=PUB1):
    a = W.build_tooshi(tooshi_result(), H("tool"), "pipavlo82", KEY_URL, LIMITS)
    return W.finish(a, pub, seed)


def verdict(a, doc=DOC1, schema=W.SCHEMA):
    r = W.verify(a, doc, schema)
    return "ok" if len(r) == 4 and all(ok for _, ok, _ in r) else next(n for n, ok, _ in r if not ok)


class Ed25519(unittest.TestCase):
    def test_rfc8032_vectors(self):
        self.assertEqual(W.ed25519_public(SEED1), PUB1)
        self.assertEqual(W.ed25519_sign(SEED1, b""), SIG1)
        self.assertTrue(W.ed25519_verify(PUB1, b"", SIG1))
        self.assertEqual(W.ed25519_public(SEED2), PUB2)
        self.assertEqual(W.ed25519_sign(SEED2, b"\x72"), SIG2)
        self.assertTrue(W.ed25519_verify(PUB2, b"\x72", SIG2))
        self.assertFalse(W.ed25519_verify(PUB2, b"\x73", SIG2))

    def test_small_order_and_noncanonical_keys_refused(self):
        ident = bytes([1]) + bytes(31)                       # the identity point: R = identity, S = 0 would verify anything
        self.assertFalse(W.key_ok(ident))
        self.assertFalse(W.ed25519_verify(ident, b"anything", ident + bytes(32)))
        self.assertFalse(W.key_ok(bytes([0xEC] + [0xFF] * 30 + [0x7F])))   # y = p - 1 + ... non-canonical / out of range
        self.assertFalse(W.key_ok(b"\x00" * 31))

    def test_s_not_below_L_refused(self):
        s = int.from_bytes(SIG1[32:], "little") + W._Q
        if s < 2 ** 256:
            self.assertFalse(W.ed25519_verify(PUB1, b"", SIG1[:32] + s.to_bytes(32, "little")))

    def test_pavlo_key_is_a_valid_prime_order_point(self):
        pub = W.key_from_doc(fx("pipavlo82_witness_json_20261104.json"))
        self.assertTrue(W.key_ok(pub))
        self.assertEqual(W.key_id_of(pub), "ed25519:" + hashlib.sha256(pub).hexdigest()[:16])

    def test_pem_loader(self):
        der = W.PKCS8_PREFIX + SEED1
        pem = "-----BEGIN PRIVATE KEY-----\n" + base64.b64encode(der).decode() + "\n-----END PRIVATE KEY-----\n"
        with tempfile.TemporaryDirectory() as td:                # outside the tree: a .pem is never left in the repository
            p = os.path.join(td, "test_only_rfc8032_key1.pem")
            with open(p, "w") as f:
                f.write(pem)
            self.assertEqual(W.load_pem_seed(p), SEED1)


class Canonical(unittest.TestCase):
    def test_jcs_subset(self):
        self.assertEqual(W.canonical({"b": 1, "a": [True, None, "é\n"]}), '{"a":[true,null,"é\\n"],"b":1}')
        for bad in ({"x": 1.5}, {"x": 2 ** 53}, {"é": 1}, {"x": "\ud800"}):
            with self.assertRaises(W.Bad):
                W.canonical(bad)

    def test_preimage_is_schema_line_plus_canonical_without_signature(self):
        a = furui_answer()
        body = {k: v for k, v in a.items() if k != "signature"}
        self.assertEqual(W.preimage(a), ("witness-answer-v0\n" + W.canonical(body)).encode())
        self.assertTrue(W.preimage(a).startswith(b"witness-answer-v0\n{"))


class Answer(unittest.TestCase):
    def test_furui_ok(self):
        a = furui_answer()
        self.assertEqual(verdict(a), "ok")
        self.assertEqual(a["leaf_index"], [0, 1])
        self.assertEqual(a["recomputed"], ["envelope_shape", "leaf_sha256", "audit_path", "signature", "runner_key"])   # anchor was not_yet on leaf 0

    def test_tooshi_ok_and_day_sha(self):
        a = tooshi_answer()
        self.assertEqual(verdict(a), "ok")
        self.assertEqual(a["recomputed"], ["day_view", "1_sieve_admission", "5_door_runner"])
        self.assertEqual(a["day_sha256"], W.tooshi_day_sha256(tooshi_result()))
        self.assertEqual(W.tooshi_day_sha256(tooshi_result("2026-11-06T09:59:59Z")), a["day_sha256"])   # time of run is not in the day view

    def test_published_tooshi_day_reproduces(self):
        d = fx("tooshi_day_2026-11-04.json")
        res = json.loads(d["result_canonical"])
        self.assertEqual(W.tooshi_day_sha256(res), d["day_sha256"])
        same, _ = W.compare_tooshi(res, d)
        self.assertTrue(same)
        changed = copy.deepcopy(res)
        changed["checks"][3]["state"] = "red"
        same, lines = W.compare_tooshi(changed, d)
        self.assertFalse(same)
        self.assertTrue(any(l.startswith("differs 4_door_resume") for l in lines))

    def test_mutations_fail(self):
        base = furui_answer()
        muts = {
            "day_sha256": lambda a: a.__setitem__("day_sha256", H("other")),
            "root": lambda a: a.__setitem__("root", H("other")),
            "limits": lambda a: a["limits"].append("one more line"),
            "recomputed": lambda a: a.__setitem__("recomputed", ["envelope_shape"]),
            "leaf_index": lambda a: a.__setitem__("leaf_index", [1]),
            "name": lambda a: a["witness"].__setitem__("name", "someone else"),
        }
        for k, f in muts.items():
            a = copy.deepcopy(base)
            f(a)
            self.assertEqual(verdict(a), "signature", k)

    def test_wrong_key_at_key_url(self):
        self.assertEqual(verdict(furui_answer(), DOC2), "key_id")
        a = furui_answer(SEED2, PUB2)
        a["witness"]["key_id"] = a["signature"]["key_id"] = W.key_id_of(PUB1)   # claims key 1, signed by key 2
        self.assertEqual(verdict(a, DOC1), "signature")

    def test_shape_refusals(self):
        def bad(f):
            a = furui_answer()
            f(a)
            return verdict(a)
        self.assertEqual(bad(lambda a: a.__setitem__("extra", 1)), "shape")
        self.assertEqual(bad(lambda a: a.__setitem__("leaf_index", [0, 2])), "shape")         # 2 >= n
        self.assertEqual(bad(lambda a: a.__setitem__("leaf_index", [1, 0])), "shape")
        self.assertEqual(bad(lambda a: a.__setitem__("recomputed", ["audit_path", "envelope_shape"])), "shape")
        self.assertEqual(bad(lambda a: a.__setitem__("limits", ["two\nlines"])), "shape")
        self.assertEqual(bad(lambda a: a.__setitem__("limits", [])), "shape")
        self.assertEqual(bad(lambda a: a.__setitem__("observed_at", "2026-11-02T00:00:00Z")), "shape")   # before the day
        self.assertEqual(bad(lambda a: a["signature"].__setitem__("key_id", "ed25519:0000000000000000")), "shape")
        for u in ("http://witness.example/k.json", "https://ledger.horizonshield.dev/k.json", "https://gist.githubusercontent.com/x/y",
                  "https://raw.githubusercontent.com/ogasurfproject-jpg/r/main/k.json", "https://raw.githubusercontent.com/someone/r/0123abc/k.json"):
            self.assertEqual(bad(lambda a: a["witness"].__setitem__("key_url", u)), "shape", u)
        t = tooshi_answer()
        t["recomputed"] = ["1_sieve_admission"]
        self.assertEqual(verdict(t), "shape")
        t = tooshi_answer()
        t["root"] = H("x")
        self.assertEqual(verdict(t), "shape")

    def test_identity(self):
        self.assertEqual(W.identity_of("https://pipavlo82.github.io/keys/witness.json"), "pipavlo82.github.io")
        self.assertEqual(W.identity_of("https://raw.githubusercontent.com/Someone/r/main/k.json"), "github.com/someone")
        self.assertIsNone(W.key_url_problem("https://pipavlo82.github.io/keys/witness.json"))

    def test_builders_refuse(self):
        with self.assertRaises(W.Bad):
            W.build_tooshi(tooshi_result("2026-11-06T03:46:00Z"), H("t"), "x", KEY_URL, LIMITS)
        with self.assertRaises(W.Bad):
            W.build_furui([furui_check(0), furui_check(1, root=H("r2"))], "x", KEY_URL, LIMITS, "2026-11-04T00:00:00Z", "t")
        with self.assertRaises(W.Bad):
            W.build_furui([furui_check(0, {s: "fail" for s in W.FURUI_STEPS})], "x", KEY_URL, LIMITS, "2026-11-04T00:00:00Z", "t")

    def test_unsigned_placeholder_does_not_verify(self):
        a = W.finish(W.build_tooshi(tooshi_result(), H("tool"), "x", KEY_URL, LIMITS), PUB1, None)
        self.assertEqual(a["signature"]["sig"], W.UNSIGNED)
        self.assertEqual(verdict(a), "signature")
        a["signature"]["sig"] = base64.b64encode(W.ed25519_sign(SEED1, W.preimage(a))).decode()   # what attach-sig does
        self.assertEqual(verdict(a), "ok")


class Intake(unittest.TestCase):
    """the wrapper must pass the rules POST /witness applies today (workers/hs-ledger/src/worker.js witnessValidate and the
    signature check), restated here without the network"""
    def test_wrapper(self):
        for a in (furui_answer(), tooshi_answer()):
            rc = W.intake_record(a, "my laptop, home network, Python urllib")
            r = json.loads(rc)
            self.assertEqual(r["schema"], "jidec-path-v1")
            self.assertEqual(r["mode"], "commitment")
            self.assertEqual(r["commitment"], a["day_sha256"])
            for k in ("purpose", "walked_at", "base"):
                self.assertTrue(isinstance(r[k], str) and r[k])
            self.assertTrue(r["establishes"] and r["does_not_establish"])
            self.assertEqual(set(r["witness"]), {"name", "vantage", "key_url"})
            self.assertEqual(r["answer"], a)
            body = W.intake_body(rc, PUB1, seed=SEED1)
            self.assertTrue(W.ed25519_verify(base64.b64decode(body["public_key_ed25519_b64"]), body["record_canonical"].encode(), base64.b64decode(body["signature_ed25519_b64"])))
            self.assertEqual(verdict(json.loads(body["record_canonical"])["answer"]), "ok")
        self.assertRegex(json.loads(W.intake_record(tooshi_answer(), "v"))["purpose"], r"^tooshi-day-v0: \d{4}-\d{2}-\d{2}$")   # NET_TOOSHI_PURPOSE

    def test_record_and_answer_preimages_are_distinct(self):
        a = furui_answer()
        self.assertNotEqual(W.intake_record(a, "v").encode()[:1], W.preimage(a)[:1])

    def test_record_signature_must_verify(self):
        rc = W.intake_record(furui_answer(), "v")
        with self.assertRaises(W.Bad):
            W.intake_body(rc, PUB1, sig=W.ed25519_sign(SEED2, rc.encode()))


class Enroll(unittest.TestCase):
    def test_enroll_and_pool_entry(self):
        e = {"schema": W.ENROLL_SCHEMA, "kinds": ["furui-day", "tooshi-day"], "enrolled_at": "2026-11-04T03:00:00Z", "limits": LIMITS,
             "witness": {"name": "pipavlo82", "key_id": "", "key_url": KEY_URL}}
        W.finish(e, PUB1, SEED1, W.ENROLL_SCHEMA)
        self.assertEqual(verdict(e, DOC1, W.ENROLL_SCHEMA), "ok")
        self.assertEqual(W.pool_entry(e, DOC1), {"signed_domain": "witness.example", "key_url": KEY_URL, "public_key_ed25519_b64": DOC1["public_key_ed25519_b64"]})
        # an answer signature cannot be replayed as an enrollment and the other way round (different first line)
        self.assertNotEqual(W.preimage(e, W.ENROLL_SCHEMA)[:18], W.preimage(furui_answer())[:18])
        e2 = copy.deepcopy(e)
        e2["kinds"] = ["tooshi-day"]
        self.assertEqual(verdict(e2, DOC1, W.ENROLL_SCHEMA), "signature")


def ssh_line(pub, comment=" witness key\n", tail=b""):
    s = lambda b: len(b).to_bytes(4, "big") + b
    return "ssh-ed25519 " + base64.b64encode(s(b"ssh-ed25519") + s(pub) + tail).decode() + comment


WORKER = os.path.join(HERE, "..", "..", "src", "worker.js")


class KeyUrlAsTheIntake(unittest.TestCase):
    """the key_url rules of POST /witness (workers/hs-ledger/src/worker.js witnessKeyIdentity and the self_witness checks).
    workers/hs-ledger/test/witness_answer_helper.test.mjs runs the intake itself on the same cases."""
    def test_shared_hosts_are_the_intakes(self):
        if not os.path.exists(WORKER):
            self.skipTest("worker.js is not beside this folder (the helper taken by itself)")
        with open(WORKER, "r", encoding="utf-8") as f:
            src = f.read()
        m = re.search(r"const WITNESS_SHARED_HOSTS = \[(.*?)\];", src, re.S)
        self.assertEqual(tuple(re.findall(r'"([^"]+)"', m.group(1))), W.SHARED_HOSTS)
        self.assertIn("/^" + W.SHARED_S3 + "$/.test(host)", src)
        m = re.search(r"const WITNESS_OUR_GITHUB_OWNERS = \[(.*?)\];", src, re.S)
        self.assertEqual(tuple(re.findall(r'"([^"]+)"', m.group(1))), W.OPERATOR_GITHUB)
        m = re.search(r"const WITNESS_OUR_DOMAINS = \[(.*?)\];", src, re.S)
        self.assertEqual(tuple(re.findall(r'"([^"]+)"', m.group(1))), W.OPERATOR_SUFFIXES)

    def test_hosts_that_serve_many_peoples_files(self):
        for h in ("1drv.ms", "camo.githubusercontent.com", "cdn.statically.io", "fastly.jsdelivr.net", "firebasestorage.googleapis.com",
                  "git.sr.ht", "gitee.com", "hastebin.com", "media.githubusercontent.com", "npmjs.com", "onedrive.live.com", "paste.ee",
                  "raw.githack.com", "rawcdn.githack.com", "sites.google.com", "storage.cloud.google.com",
                  "user-images.githubusercontent.com", "www.npmjs.com", "s3-us-west-2.amazonaws.com", "s3.eu-central-1.amazonaws.com"):
            self.assertIn("many people's files", W.key_url_problem("https://%s/k/witness.json" % h) or "", h)
        self.assertIsNone(W.key_url_problem("https://my-bucket.s3.amazonaws.com/witness.json"))   # one owner per bucket host
        self.assertIsNone(W.key_url_problem("https://s3.dualstack.us-east-1.amazonaws.com/k.json"))   # two labels: not the intake's pattern either

    def test_github_raw_refs_heads_and_tags(self):
        R = "https://raw.githubusercontent.com/"
        for u, ident in ((R + "alice/keys/refs/heads/main/witness.json", "github.com/alice"),
                         (R + "Alice/keys/refs/tags/v1/k/witness.json", "github.com/alice"),
                         (R + "alice/keys/main/witness.json", "github.com/alice"),
                         (R + "alice//keys/main/witness.json", "github.com/alice"),
                         (R + "alice/keys/refs/main/witness.json", "github.com/alice")):   # "refs" is then the branch name
            self.assertIsNone(W.key_url_problem(u), u)
            self.assertEqual(W.identity_of(u), ident, u)
        for u in (R + "alice/keys/refs/heads/0123abc/witness.json",                 # a commit SHA behind refs/heads
                  R + "alice/keys/refs/tags/0123456789abcdef0123456789abcdef01234567/k.json",
                  R + "alice/keys/refs/heads/main", R + "alice/keys/refs/heads/main/",   # no file after the ref
                  R + "alice/keys/main", R + "alice/keys", R + "-alice/keys/main/k.json", R + "a_b/keys/main/k.json",
                  R + "a" * 40 + "/keys/main/k.json", R + "ogasurfproject-jpg/x/refs/heads/main/k.json",
                  R + "alice/../ogasurfproject-jpg/x/main/k.json", R + "alice/%2E%2E/x/main/k.json",
                  R + "alice/keys/main/./k.json", "https://witness.example/a\\b/k.json"):
            self.assertIsNotNone(W.key_url_problem(u), u)
        self.assertIsNone(W.key_url_problem(R + "a" * 39 + "/keys/main/k.json"))

    def test_intake_body_refuses_self_witness(self):
        a = tooshi_answer()
        a["witness"]["key_url"] = "https://raw.githubusercontent.com/alice/keys/main/witness.json"
        W.finish(a, PUB1, SEED1)
        self.assertEqual(verdict(a), "ok")                                           # the answer itself verifies
        with self.assertRaises(W.Bad) as e:
            W.intake_record(a, "v")                                                  # but the intake would refuse the record
        self.assertIn("self_witness", str(e.exception))
        f = furui_answer()
        f["witness"]["key_url"] = "https://raw.githubusercontent.com/alice/keys/main/witness.json"
        W.finish(f, PUB1, SEED1)
        self.assertEqual(json.loads(W.intake_record(f, "v"))["witness"]["key_url"], f["witness"]["key_url"])   # a FURUI day's base is the ledger

    def test_operator_domains_stay_refused(self):
        for u in ("https://horizonshield.dev/.well-known/nenrin-witness-key.json", "https://x.oga-surf-project.workers.dev/k.json",
                  "https://the-horizons-innovation.com/k.json", "https://ogasurfproject-jpg.github.io/keys/witness.json",
                  "https://x.ogasurfproject-jpg.github.io/k.json"):
            self.assertIn("operator's own domain", W.key_url_problem(u) or "", u)
        for u in ("https://ogasurfproject-jpg-fan.github.io/k.json", "https://evilhorizonshield.dev/k.json"):   # look-alikes are not
            self.assertIsNone(W.key_url_problem(u), u)


class SshKeyLine(unittest.TestCase):
    """a key_url may serve one OpenSSH line, as at the intake (src/ssh_ed25519.mjs, servedKeyB64 with ssh)"""
    def test_verify_reads_an_ssh_line(self):
        a = furui_answer()
        for body in (ssh_line(PUB1), ssh_line(PUB1, "\r\n"), ssh_line(PUB1, "")):
            self.assertEqual(verdict(a, body.encode("utf-8")), "ok", repr(body))
            self.assertEqual(verdict(a, body), "ok", repr(body))
        self.assertEqual(verdict(a, b"\xef\xbb\xbf" + ssh_line(PUB1).encode()), "ok")       # res.text() drops one BOM
        self.assertEqual(verdict(a, ssh_line(PUB2).encode()), "key_id")
        for body in (ssh_line(PUB1, "\n\n"), ssh_line(PUB1, tail=b"\x00"), "ssh-rsa " + ssh_line(PUB1)[12:], " " + ssh_line(PUB1),
                     json.dumps(ssh_line(PUB1)), "", "NaN", '{"public_key_ed25519_b64": NaN}', ssh_line(PUB1, " darr\u00e9n\n")):
            self.assertEqual(verdict(a, body.encode("utf-8")), "key_url_key", repr(body))

    def test_json_body_as_before_and_with_bom(self):
        a = furui_answer()
        self.assertEqual(verdict(a, json.dumps(DOC1).encode()), "ok")
        self.assertEqual(verdict(a, b"\xef\xbb\xbf" + json.dumps(DOC1).encode()), "ok")    # res.text() drops one BOM
        self.assertEqual(verdict(a, json.dumps({"key": "x"}).encode()), "key_url_key")

    def test_same_as_the_enroll_twin(self):
        sp = importlib.util.spec_from_file_location("witness_enroll_v0", os.path.join(HERE, "..", "witness-enroll-v0", "witness_enroll_v0.py"))
        if sp is None or not os.path.exists(sp.origin):
            self.skipTest("witness-enroll-v0 is not beside this folder")
        E = importlib.util.module_from_spec(sp)
        sp.loader.exec_module(E)
        for body in (ssh_line(PUB1), ssh_line(PUB1, "\r\n"), ssh_line(PUB1, "\tc"), ssh_line(PUB1, "\n\n"), ssh_line(PUB1, tail=b"\x00"),
                     ssh_line(PUB1[:31]), "ssh-ed25519 \n", ""):
            self.assertEqual(W.ssh_ed25519_key(body.encode()), E.ssh_ed25519_key(body.encode()), repr(body))

    def test_verify_fetch_and_key_doc_read_an_ssh_line(self):
        a = furui_answer()
        with tempfile.TemporaryDirectory() as td:
            ap, kp = os.path.join(td, "answer.json"), os.path.join(td, "witness.pub")
            with open(ap, "w") as f:
                json.dump(a, f)
            with open(kp, "w") as f:
                f.write(ssh_line(PUB1))
            got, keep = [], W.fetch_key_doc
            W.fetch_key_doc = lambda u: (got.append(u), ssh_line(PUB1).encode())[1]
            try:
                self.assertEqual(W.main(["verify", ap, "--fetch"]), 0)
            finally:
                W.fetch_key_doc = keep
            self.assertEqual(got, [KEY_URL])
            self.assertEqual(W.main(["verify", ap, "--key-doc", kp]), 0)
            self.assertEqual(W.main(["key-of", kp]), 0)
        self.assertEqual(W.pool_entry(W.finish({"schema": W.ENROLL_SCHEMA, "kinds": ["furui-day"], "enrolled_at": "2026-11-04T03:00:00Z",
                                                "limits": LIMITS, "witness": {"name": "x", "key_id": "", "key_url": KEY_URL}}, PUB1, SEED1, W.ENROLL_SCHEMA),
                                       ssh_line(PUB1).encode())["public_key_ed25519_b64"], DOC1["public_key_ed25519_b64"])


def make_vectors():
    cases = []

    def add(name, obj, doc, schema=W.SCHEMA):
        r = W.verify(obj, doc, schema)
        cases.append({"name": name, "schema": schema, "object": obj, "key_doc": doc,
                      "preimage_sha256": W.sha256hex(W.preimage(obj, schema)) if isinstance(obj, dict) else None,
                      "expect": "ok" if len(r) == 4 and all(ok for _, ok, _ in r) else "fail:" + next(n for n, ok, _ in r if not ok)})
    add("furui_day_ok", furui_answer(), DOC1)
    add("tooshi_day_ok", tooshi_answer(), DOC1)
    m = furui_answer()
    m["day_sha256"] = H("other")
    add("furui_day_changed_after_signing", m, DOC1)
    add("furui_day_key_url_serves_another_key", furui_answer(), DOC2)
    m = tooshi_answer()
    m["extra"] = True
    add("tooshi_day_extra_field", m, DOC1)
    e = {"schema": W.ENROLL_SCHEMA, "kinds": ["furui-day", "tooshi-day"], "enrolled_at": "2026-11-04T03:00:00Z", "limits": LIMITS,
         "witness": {"name": "pipavlo82", "key_id": "", "key_url": KEY_URL}}
    add("enroll_ok", W.finish(e, PUB1, SEED1, W.ENROLL_SCHEMA), DOC1, W.ENROLL_SCHEMA)
    return {"schema": "witness-answer-v0-vectors", "key": "RFC 8032 section 7.1 TEST 1 (a public test key)",
            "public_key_ed25519_b64": DOC1["public_key_ed25519_b64"], "cases": cases}


class Vectors(unittest.TestCase):
    def test_vectors_file_matches(self):
        with open(os.path.join(HERE, "vectors.json"), "r", encoding="utf-8") as f:
            self.assertEqual(json.load(f), json.loads(json.dumps(make_vectors())))


def run():
    r = unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]))
    return 0 if r.wasSuccessful() else 1


if __name__ == "__main__":
    if sys.argv[1:] == ["--write-vectors"]:
        with open(os.path.join(HERE, "vectors.json"), "w", encoding="utf-8") as f:
            f.write(json.dumps(make_vectors(), ensure_ascii=False, sort_keys=True, indent=2) + "\n")
        print("vectors.json written")
        sys.exit(0)
    sys.exit(run())
