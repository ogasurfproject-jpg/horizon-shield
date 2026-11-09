"""tests for outward_witness.py. No network: every socket call raises before the tests start.

    python3 -I -B test_outward_witness.py                 run the tests
    python3 -I -B test_outward_witness.py --write-vectors  rewrite vectors.json (deterministic; the tests compare against it)
"""
import socket
import ssl, http.client, urllib.request   # noqa: F401  loaded before the block below: ssl subclasses socket.socket at import


def _no_network(*a, **k):
    raise RuntimeError("network is not allowed in these tests")


socket.socket = _no_network
socket.create_connection = _no_network
socket.getaddrinfo = _no_network

import base64, copy, csv, hashlib, importlib.util, json, os, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
NENRIN = os.path.join(ROOT, "workers", "hs-ledger", "nenrin")


def _module(name, path):
    sp = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(sp)
    sp.loader.exec_module(m)
    return m


O = _module("outward_witness", os.path.join(HERE, "outward_witness.py"))
V0 = _module("witness_answer_v0", os.path.join(NENRIN, "witness-answer-v0", "witness_answer_v0.py"))

# RFC 8032 section 7.1 TEST 1 and TEST 2 (public test keys, not anyone's key)
SEED1 = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
PUB1 = bytes.fromhex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a")
SIG1 = bytes.fromhex("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b")
SEED2 = bytes.fromhex("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb")
PUB2 = bytes.fromhex("3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c")
DOC1 = {"public_key_ed25519_b64": base64.b64encode(PUB1).decode()}
DOC2 = {"public_key_ed25519_b64": base64.b64encode(PUB2).decode()}
# the document .well-known/nenrin-witness-key.json carries, here with the test key
WELL_KNOWN1 = {"public_key_ed25519_b64": DOC1["public_key_ed25519_b64"], "key_id": "ed25519:" + hashlib.sha256(PUB1).hexdigest()[:16],
               "purpose": "outward witness: HORIZON SHIELD recomputes and signs other projects' records", "since": "2026-11-06"}
TOOL = hashlib.sha256(b"tool").hexdigest()
H = lambda s: hashlib.sha256(s.encode()).hexdigest()

# the files of witness-answer-v0 that must stay as they are (other people pin them)
V0_PINNED = {"witness_answer_v0.py": "501fd68f18a611e62d11cc63cd4b421ab91eac301780383f2bffaf0517f334b0",
             "vectors.json": "5bbdaec158c0ed58d0897287dc217f33695c74891ade725b4139819d07ecab15"}


def jload(*p):
    with open(os.path.join(*p), "r", encoding="utf-8") as f:
        return json.load(f)


# ---- the real slot log of 2026-10-10 ----
SLOT_FX = jload(NENRIN, "slot-witness-v0", "fixtures", "invinoveritas_slot_log_20261010.json")
WORLD_FX = jload(HERE, "fixtures", "invinoveritas_slot_log_world_20261010.json")
BASE = WORLD_FX["base"]
U = O.slot_log_urls("2026-10-10", BASE)


def day_file_1010():
    """the 2026-10-10 day file rebuilt from slot-witness-v0's fixture: the header, then the one line, canonical JSON each"""
    lg = json.loads(SLOT_FX["body"])["log"]
    return (O._jcs_line(lg["header"]) + "\n" + O._jcs_line(lg["line"]) + "\n").encode("utf-8")


def slot_facts(**over):
    w = dict(WORLD_FX["world"])
    w[U["record"]] = {"status": 200, "b64": base64.b64encode(day_file_1010()).decode()}
    for u, v in over.items():
        if v is None:
            w.pop(u, None)
        else:
            w[u] = v
    return {"schema": O.FACTS_SCHEMA, "record_kind": "invinoveritas-slot-log", "subject_domain": "invinoveritas.dev", "date": "2026-10-10",
            "base": BASE, "observed_at": WORLD_FX["observed_at"], "world": w}


def served(b, status=200):
    return {"status": status, "b64": base64.b64encode(b).decode() if b is not None else None}


def raw(facts, url):
    return base64.b64decode(facts["world"][url]["b64"])


def states(steps):
    return {n: st for n, st, _ in steps}


# ---- a made-up anchored record (for the bytes kind): a .ots of sha256 -> append -> sha256 -> bitcoin, and a header ----
def made_up_ots(digest, height, extra=b"\x01" * 16, pending=False):
    def vu(n):
        out = b""
        while True:
            c = n & 0x7f
            n >>= 7
            out += bytes([c | (0x80 if n else 0)])
            if not n:
                return out
    body = b"\xf0" + vu(len(extra)) + extra + b"\x08"
    if pending:
        uri = b"https://a.pool.example"
        att = b"\x00" + O.TAG_PENDING + vu(len(vu(len(uri)) + uri)) + vu(len(uri)) + uri
    else:
        att = b"\x00" + O.TAG_BITCOIN + vu(len(vu(height))) + vu(height)
    msg = hashlib.sha256(digest + extra).digest()
    return O.OTS_MAGIC + b"\x01" + b"\x08" + digest + body + att, msg


def made_up_header(merkle_internal, salt="outward"):
    """version 0x20000000, prev sha256(salt), the merkle root, a fixed time, bits 0x207fffff, the first nonce that meets them"""
    b = (0x20000000).to_bytes(4, "little") + hashlib.sha256(salt.encode()).digest() + merkle_internal
    b += (1793000000).to_bytes(4, "little") + (0x207FFFFF).to_bytes(4, "little")
    t = O.bits_target(0x207FFFFF)
    for nonce in range(1 << 20):
        h = b + nonce.to_bytes(4, "little")
        if int(O._sha256d(h)[::-1].hex(), 16) <= t:
            return h.hex(), O._sha256d(h)[::-1].hex()
    raise AssertionError("no nonce")


RECORD = b'{"release":"v1.2.3","receipt":"made up for the tests"}\n'
REC_URL = "https://records.example/r/v1.2.3.json"
HEIGHT = 900001


def bytes_world(record=RECORD, sig_alg="ed25519", ots=True, sig=True, header_merkle=None, explorer2=None):
    w = {REC_URL: served(record)}
    f = {"schema": O.FACTS_SCHEMA, "record_kind": "bytes", "subject_domain": "records.example", "url": REC_URL, "observed_at": "2026-11-06T13:00:00Z", "world": w}
    if ots:
        ob, msg = made_up_ots(hashlib.sha256(RECORD).digest(), HEIGHT)
        hx, bh = made_up_header(header_merkle or msg)
        f["ots_url"] = REC_URL + ".ots"
        w[f["ots_url"]] = served(ob)
        for i, (name, base) in enumerate(O.EXPLORERS):
            w[base + "/block-height/%d" % HEIGHT] = served(((explorer2 if i == 1 and explorer2 else bh)).encode())
            w[base + "/block/%s/header" % bh] = served(hx.encode())
        if explorer2:
            w[O.EXPLORERS[1][1] + "/block/%s/header" % explorer2] = served(hx.encode())
    if sig:
        f.update(sig_url=REC_URL + ".sig", sig_alg=sig_alg)
        if sig_alg == "ed25519":
            w[f["sig_url"]] = served(base64.b64encode(O.ed25519_sign(SEED2, RECORD)).decode().encode())
            f["sig_key_url"] = "https://records.example/key.json"
            w[f["sig_key_url"]] = served(json.dumps(DOC2).encode())
        else:
            B = _module("bip340", os.path.join(NENRIN, "slot-witness-v0", "bip340.py"))
            sk = bytes.fromhex("0000000000000000000000000000000000000000000000000000000000000003")   # BIP-340 test vector 0 key
            w[f["sig_url"]] = served(B.sign(sk, hashlib.sha256(RECORD).digest(), bytes(32)).hex().encode())
            f["sig_pub"] = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9"
    return f


def answer(facts=None, seed=SEED1, pub=PUB1, limits=None):
    a, _ = O.build(facts or slot_facts(), TOOL, limits)
    return O.finish(a, pub, seed)


def verdict(a, doc=DOC1):
    r = O.verify(a, doc)
    return "ok" if len(r) == 4 and all(ok for _, ok, _ in r) else next(n for n, ok, _ in r if not ok)


class NoNetwork(unittest.TestCase):
    def test_sockets_are_blocked(self):
        for f in (lambda: socket.socket(), lambda: socket.create_connection(("1.1.1.1", 443)), lambda: socket.getaddrinfo("example.com", 443)):
            with self.assertRaises(RuntimeError):
                f()


class Crypto(unittest.TestCase):
    def test_rfc8032_and_same_arithmetic_as_v0(self):
        self.assertEqual(O.ed25519_public(SEED1), PUB1)
        self.assertEqual(O.ed25519_sign(SEED1, b""), SIG1)
        self.assertTrue(O.ed25519_verify(PUB1, b"", SIG1))
        for m in (b"", b"x", b"witness-answer-v0.1\n{}", bytes(range(256))):
            self.assertEqual(O.ed25519_sign(SEED2, m), V0.ed25519_sign(SEED2, m))
        self.assertFalse(O.key_ok(bytes([1]) + bytes(31)))
        self.assertEqual(O.canonical({"b": 1, "a": [True, None, "é\n"]}), V0.canonical({"b": 1, "a": [True, None, "é\n"]}))

    def test_bip340_vectors_of_the_repository(self):
        with open(os.path.join(NENRIN, "slot-witness-v0", "fixtures", "bip340_test_vectors.csv"), newline="") as f:
            rows = list(csv.DictReader(f))
        self.assertGreater(len(rows), 10)
        for r in rows:
            got = O.bip340_verify(bytes.fromhex(r["public key"]), bytes.fromhex(r["message"]), bytes.fromhex(r["signature"])) \
                if len(r["public key"]) == 64 and len(r["signature"]) == 128 else False
            self.assertEqual(got, r["verification result"] == "TRUE", r["index"])

    def test_ots_reader_on_the_real_proof_of_ledger_entry_80(self):
        with open(os.path.join(NENRIN, "furui-check-day-v0", "ots_entry80.ots.b64")) as f:
            ob = base64.b64decode(f.read())
        hv = jload(NENRIN, "furui-check-day-v0", "bitcoin_header_vectors.json")
        real = hv["cases"][0]["expect"]["facts"]["header"]
        d, atts = O.read_ots(ob)
        btc = [a for a in atts if a["kind"] == "bitcoin"]
        self.assertEqual(min(a["height"] for a in btc), 970879)
        low = min(btc, key=lambda a: a["height"])
        self.assertEqual(low["msg"], bytes.fromhex(real)[36:68])
        sys.path[:0] = [os.path.join(NENRIN, p) for p in ("musubi-v0",)]
        AC = _module("anchor_compose", os.path.join(NENRIN, "musubi-v0", "anchor_compose.py"))
        for b in (ob, base64.b64decode(WORLD_FX["world"][U["ots"]]["b64"])):
            d2, a2 = AC.read_ots(b)
            d1, a1 = O.read_ots(b)
            self.assertEqual(d1, d2)
            self.assertEqual([(x["kind"], x.get("height"), x["msg"]) for x in a1], [(x["kind"], x.get("height"), x["msg"]) for x in a2])
        with self.assertRaises(O.Bad):
            O.read_ots(ob + b"\x00")


class SlotLog(unittest.TestCase):
    def test_rebuilt_day_file_is_the_served_one(self):
        b = day_file_1010()
        self.assertEqual(hashlib.sha256(b).hexdigest(), WORLD_FX["day_file_sha256_as_served"])
        h, hl, lines = O.slot_log_file(b)
        self.assertEqual(O.sha256hex(hl), SLOT_FX["expect_issuer_log"]["log_root"])
        self.assertEqual(O.slot_merkle_root(lines), h["merkle_root"])

    def test_all_five_steps_ok_on_the_real_day(self):
        steps, rsha, anchor = O.recompute(slot_facts())
        self.assertEqual([(n, st) for n, st, _ in steps], [(s, "ok") for s in O.STEPS["invinoveritas-slot-log"]])
        self.assertEqual(rsha, WORLD_FX["day_file_sha256_as_served"])
        self.assertEqual(anchor, {"block_height": 970851, "block_hash": "000000000000000000009f573a04fc58a3c5e4757c3ef97c2254e5fd99803735"})

    def test_same_reading_as_slot_check(self):
        sys.path[:0] = [os.path.join(NENRIN, p) for p in ("slot-witness-v0", "vouch-pin-v0", "musubi-v0")]
        SC = _module("slot_check", os.path.join(NENRIN, "slot-witness-v0", "slot_check.py"))
        prev = raw(slot_facts(), U["prev"])
        lines = ['{"claim_sha256":"%s","conflicts":[],"decider_sig":null,"event_ids":["%s"],"scope":"account","slot":"%s","taken_at":%d}'
                 % (H("c%d" % i), H("e%d" % i), H("s%d" % i), 1791676000 + i) for i in range(5)]
        lines.sort(key=lambda l: json.loads(l)["slot"])
        root = O.slot_merkle_root(lines)
        hdr = O._jcs_line({"cutoff": 1791676800, "date": "2026-10-10", "merkle_root": root, "n_slots": 5, "prev_root": H("p"), "rules": "r", "schema": O.SLOT_LOG_SCHEMA})
        five = (hdr + "\n" + "\n".join(lines) + "\n").encode()
        for b in (day_file_1010(), prev, five):
            h, ls, lr, prob = SC.check_day_file(b)
            self.assertEqual(prob, [])
            h2, hl2, ls2 = O.slot_log_file(b)
            self.assertEqual((h2, O.sha256hex(hl2), O.slot_merkle_root(ls2)), (h, lr, h["merkle_root"]))

    def test_changed_bytes(self):
        b = day_file_1010()
        st = states(O.recompute(slot_facts(**{U["record"]: served(b.replace(b'"taken_at":1791631641', b'"taken_at":1791631642'))}))[0])
        self.assertEqual(st["merkle_root"], "fail")
        st = states(O.recompute(slot_facts(**{U["record"]: served(b.replace(b'"n_slots":1', b'"n_slots":2'))}))[0])
        self.assertEqual(st["entries_parse"], "fail")
        self.assertNotIn("merkle_root", st)
        st = states(O.recompute(slot_facts(**{U["record"]: served(b[:-1])}))[0])
        self.assertEqual(st["entries_parse"], "fail")
        st = states(O.recompute(slot_facts(**{U["record"]: served(b.replace(b"2026-10-10", b"2026-10-11", 1))}))[0])
        self.assertEqual(st["entries_parse"], "fail")   # the header names another day

    def test_prev_root_chain(self):
        prev = raw(slot_facts(), U["prev"])
        st = states(O.recompute(slot_facts(**{U["prev"]: served(prev.replace(b'"cutoff":1791590400', b'"cutoff":1791590401'))}))[0])
        self.assertEqual(st["prev_root_chain"], "fail")
        self.assertEqual(states(O.recompute(slot_facts(**{U["prev"]: served(None, 404)}))[0])["prev_root_chain"], "not_yet")
        self.assertEqual(states(O.recompute(slot_facts(**{U["prev"]: None}))[0])["prev_root_chain"], "not_yet")
        # 2026-10-09 is the first day: prev_root is 64 zeros and the day before does not exist
        f = slot_facts()
        f.update(date="2026-10-09")
        u9 = O.slot_log_urls("2026-10-09", BASE)
        f["world"][u9["record"]] = served(prev)
        f["world"][u9["prev"]] = served(None, 404)
        st = states(O.recompute(f)[0])
        self.assertEqual((st["entries_parse"], st["merkle_root"], st["prev_root_chain"], st["ots_anchor"]), ("ok", "ok", "ok", "not_yet"))

    def test_ots_and_header(self):
        st = states(O.recompute(slot_facts(**{U["ots"]: None}))[0])
        self.assertEqual(st["ots_anchor"], "not_yet")
        ob = raw(slot_facts(), U["ots"])
        self.assertEqual(states(O.recompute(slot_facts(**{U["ots"]: served(ob[:-3])}))[0])["ots_anchor"], "fail")
        other, _ = made_up_ots(bytes(32), 970851)
        self.assertEqual(states(O.recompute(slot_facts(**{U["ots"]: served(other)}))[0])["ots_anchor"], "fail")   # stamps another digest
        pend, _ = made_up_ots(hashlib.sha256(O._jcs_line(json.loads(SLOT_FX["body"])["log"]["header"]).encode()).digest(), 0, pending=True)
        self.assertEqual(states(O.recompute(slot_facts(**{U["ots"]: served(pend)}))[0])["ots_anchor"], "not_yet")
        mh = "https://mempool.space/api/block-height/970851"
        self.assertEqual(states(O.recompute(slot_facts(**{mh: None}))[0])["ots_anchor"], "not_yet")
        self.assertEqual(states(O.recompute(slot_facts(**{mh: served(b"", 500)}))[0])["ots_anchor"], "fail")
        bhdr = [u for u in WORLD_FX["world"] if u.startswith("https://blockstream.info/api/block/")][0]
        hx = bytearray(raw(slot_facts(), bhdr))
        hx[100] = ord("0") if hx[100] != ord("0") else ord("1")
        self.assertEqual(states(O.recompute(slot_facts(**{bhdr: served(bytes(hx))}))[0])["ots_anchor"], "fail")

    def test_offline_fetch_reads_what_build_needs(self):
        w = slot_facts()["world"]
        calls = []

        def get(u, limit):
            calls.append(u)
            x = w.get(u)
            return (x["status"], base64.b64decode(x["b64"])) if x else (404, None)
        f = O.fetch("invinoveritas-slot-log", {"--date": "2026-10-10", "--base": BASE}, get=get, now=lambda: WORLD_FX["observed_at"])
        self.assertEqual(sorted(calls), sorted(w))
        self.assertEqual(O.recompute(f), O.recompute(slot_facts()))


class Bytes(unittest.TestCase):
    def test_ed25519_and_bip340_and_ots(self):
        for alg in ("ed25519", "bip340"):
            steps, rsha, anchor = O.recompute(bytes_world(sig_alg=alg))
            self.assertEqual([(n, st) for n, st, _ in steps], [("bytes_sha256", "ok"), ("ots_anchor", "ok"), ("signature", "ok")], alg)
            self.assertEqual(rsha, hashlib.sha256(RECORD).hexdigest())
            self.assertEqual(anchor["block_height"], HEIGHT)

    def test_failures(self):
        f = bytes_world()
        f["world"][REC_URL] = served(RECORD + b" ")
        st = states(O.recompute(f)[0])
        self.assertEqual((st["ots_anchor"], st["signature"]), ("fail", "fail"))
        self.assertEqual(states(O.recompute(bytes_world(header_merkle=bytes(32)))[0])["ots_anchor"], "fail")
        self.assertEqual(states(O.recompute(bytes_world(explorer2=H("other")))[0])["ots_anchor"], "fail")
        self.assertEqual([n for n, _, _ in O.recompute(bytes_world(ots=False, sig=False))[0]], ["bytes_sha256"])
        f = bytes_world()
        f["world"][f["sig_url"]] = served(b"not a signature")
        self.assertEqual(states(O.recompute(f)[0])["signature"], "fail")
        with self.assertRaises(O.Bad):
            O.build(bytes_world(header_merkle=bytes(32)), TOOL)   # a failed step: nothing is signed
        f = bytes_world()
        f["world"][REC_URL] = served(None, 404)
        with self.assertRaises(O.Bad):
            O.recompute(f)


class Answer(unittest.TestCase):
    def test_slot_log_answer(self):
        a = answer()
        self.assertEqual(verdict(a), "ok")
        self.assertEqual(verdict(a, WELL_KNOWN1), "ok")
        self.assertEqual(a["record_url"], U["record"])
        self.assertEqual(a["witness"], {"name": "horizonshield.dev", "key_id": WELL_KNOWN1["key_id"], "key_url": O.WITNESS_KEY_URL})
        self.assertTrue(O.preimage(a).startswith(b"witness-answer-v0.1\n{"))
        self.assertEqual(a["limits"], O.DEFAULT_LIMITS)

    def test_not_yet_steps_are_left_out_and_anchor_is_null(self):
        a = answer(slot_facts(**{U["ots"]: None}))
        self.assertEqual(a["recomputed"], ["bytes_sha256", "entries_parse", "merkle_root", "prev_root_chain"])
        self.assertIsNone(a["anchor"])
        self.assertEqual(verdict(a), "ok")

    def test_mutations_fail(self):
        base = answer()
        muts = {"record_sha256": lambda a: a.__setitem__("record_sha256", H("x")),
                "subject_domain": lambda a: a.__setitem__("subject_domain", "other.example"),
                "recomputed": lambda a: a.__setitem__("recomputed", ["bytes_sha256", "entries_parse", "merkle_root", "ots_anchor"]),
                "anchor": lambda a: a["anchor"].__setitem__("block_height", 970852),
                "limits": lambda a: a["limits"].append("one more"),
                "observed_at": lambda a: a.__setitem__("observed_at", "2026-11-07T00:00:00Z")}
        for k, f in muts.items():
            a = copy.deepcopy(base)
            f(a)
            self.assertEqual(verdict(a), "signature", k)

    def test_keys(self):
        self.assertEqual(verdict(answer(), DOC2), "key_id")
        self.assertEqual(verdict(answer(), dict(WELL_KNOWN1, key_id="ed25519:0000000000000000")), "key_url_key")
        a = answer(seed=SEED2, pub=PUB2)
        a["witness"]["key_id"] = a["signature"]["key_id"] = O.key_id_of(PUB1)
        self.assertEqual(verdict(a), "signature")

    def test_shape_refusals(self):
        def bad(f):
            a = answer()
            f(a)
            return verdict(a)
        self.assertEqual(bad(lambda a: a.__setitem__("extra", 1)), "shape")
        self.assertEqual(bad(lambda a: a.__setitem__("subject_domain", "horizonshield.dev")), "shape")
        self.assertEqual(bad(lambda a: a.__setitem__("subject_domain", "ledger.the-horizons-innovation.com")), "shape")
        self.assertEqual(bad(lambda a: a.__setitem__("subject_domain", "Invinoveritas.dev")), "shape")
        self.assertEqual(bad(lambda a: a.__setitem__("recomputed", ["entries_parse", "bytes_sha256"])), "shape")
        self.assertEqual(bad(lambda a: a.__setitem__("recomputed", ["bytes_sha256", "signature"])), "shape")   # not a step of this kind
        self.assertEqual(bad(lambda a: a.__setitem__("anchor", None)), "shape")
        self.assertEqual(bad(lambda a: a.__setitem__("record_kind", "furui-day")), "shape")
        self.assertEqual(bad(lambda a: a.__setitem__("kind", "furui-day")), "shape")
        self.assertEqual(bad(lambda a: a.__setitem__("schema", "witness-answer-v0")), "shape")
        self.assertEqual(bad(lambda a: a.__setitem__("record_url", "http://invinoveritas.dev/x")), "shape")
        for u in ("http://horizonshield.dev/k.json", "https://gist.githubusercontent.com/x/k.json", "https://raw.githubusercontent.com/o/r/main/k.json",
                  "https://invinoveritas.dev/k.json", "https://keys.invinoveritas.dev/k.json"):
            self.assertEqual(bad(lambda a: a["witness"].__setitem__("key_url", u)), "shape", u)
        a = answer(slot_facts(**{U["ots"]: None}))
        a["anchor"] = {"block_height": 1, "block_hash": H("b")}
        self.assertEqual(verdict(a), "shape")

    def test_unsigned_placeholder(self):
        a, _ = O.build(slot_facts(), TOOL)
        O.finish(a, PUB1, None)
        self.assertEqual(verdict(a), "signature")
        a["signature"]["sig"] = base64.b64encode(O.ed25519_sign(SEED1, O.preimage(a))).decode()   # what attach-sig does
        self.assertEqual(verdict(a), "ok")


class V0Unchanged(unittest.TestCase):
    def test_v0_files_and_vectors_are_as_pinned(self):
        for name, want in V0_PINNED.items():
            with open(os.path.join(NENRIN, "witness-answer-v0", name), "rb") as f:
                self.assertEqual(hashlib.sha256(f.read()).hexdigest(), want, name)
        for c in jload(NENRIN, "witness-answer-v0", "vectors.json")["cases"]:
            r = V0.verify(c["object"], c["key_doc"], c["schema"])
            self.assertEqual("ok" if len(r) == 4 and all(ok for _, ok, _ in r) else "fail:" + next(n for n, ok, _ in r if not ok), c["expect"], c["name"])
            if c["schema"] == V0.SCHEMA:
                self.assertEqual(verdict(c["object"], c["key_doc"]), "shape", c["name"])   # a v0 answer is not read here

    def test_no_replay_between_v0_and_v01(self):
        a = answer()
        self.assertNotEqual(O.preimage(a)[:20], V0.preimage(a)[:20])
        v0 = jload(NENRIN, "witness-answer-v0", "vectors.json")["cases"][0]["object"]
        self.assertFalse(O.ed25519_verify(PUB1, O.preimage(v0), base64.b64decode(v0["signature"]["sig"])))


class Ledger(unittest.TestCase):
    def test_seed(self):
        a = answer()
        s = O.ledger_seed(a, DOC1)
        self.assertEqual(sorted(s), ["claim_sha256", "record_canonical", "work"])
        self.assertEqual(s["claim_sha256"], hashlib.sha256(s["record_canonical"].encode()).hexdigest())
        self.assertEqual(json.loads(s["record_canonical"]), a)
        self.assertEqual(s["work"], "NENRIN outward witness: invinoveritas.dev invinoveritas-slot-log 2026-10-10")
        self.assertEqual(O.ledger_seed(answer(bytes_world()), DOC1)["work"], "NENRIN outward witness: records.example bytes 2026-11-06")
        b = copy.deepcopy(a)
        b["record_sha256"] = H("x")
        with self.assertRaises(O.Bad):
            O.ledger_seed(b, DOC1)

    def test_pick_day(self):
        # the chain recipe on the ledger's real entry 1 (export.jsonl, 2026-11-06)
        e1 = {"n": 1, "claim_sha256": "9a40b9811ac816421a3a4a819136f48d3377c55c1b982f433f760b4b7595f88d", "prev_entry_sha256": "0" * 64,
              "created_at": "2026-07-22T07:27:53.063Z"}
        self.assertEqual(O._chain_entry_sha(e1), "ceebc5b7d58613651394f9ea193717362f8a051055fd4efe0243c9536ecef054")
        lines, prev = [], "0" * 64
        for n, t in enumerate(["2026-10-30T10:00:00.000Z", "2026-10-31T23:59:59.999Z", "2026-11-01T00:00:00.000Z", "2026-11-01T00:30:00.000Z"], 1):
            e = {"n": n, "schema": "v0", "claim_sha256": H("c%d" % n), "prev_entry_sha256": prev, "created_at": t}
            e["entry_sha256"] = prev = O._chain_entry_sha(e)
            lines.append(json.dumps(e))
        lines.append(json.dumps({"schema": "jidec-head-v1", "n": 4, "head": prev}))
        p = O.pick_day(lines, "2026-10", "2026-11-01T00:00:00Z")
        h2 = json.loads(lines[1])["entry_sha256"]
        self.assertEqual((p["head_n"], p["head_entry_sha256"], p["days_counted"]), (2, h2, 31))
        self.assertEqual(p["day"], "2026-10-%02d" % (int(h2[:8], 16) % 31 + 1))
        p = O.pick_day(lines, "2026-11", "2026-11-07T00:00:00Z")   # the first run: the days of the month before the run day
        self.assertEqual((p["head_n"], p["days_counted"]), (4, 6))
        broken = list(lines)
        broken[1] = broken[1].replace(H("c2"), H("x"))
        with self.assertRaises(O.Bad):
            O.pick_day(broken, "2026-10", "2026-11-01T00:00:00Z")
        with self.assertRaises(O.Bad):
            O.pick_day(lines, "2026-11", "2026-11-01T00:00:00Z")


def make_vectors():
    cases = []

    def add(name, obj, doc, facts=None):
        r = O.verify(obj, doc)
        cases.append({"name": name, "object": obj, "key_doc": doc, "preimage_sha256": O.sha256hex(O.preimage(obj)),
                      "facts_sha256": O.sha256hex(O.canonical(facts)) if facts else None,
                      "expect": "ok" if len(r) == 4 and all(ok for _, ok, _ in r) else "fail:" + next(n for n, ok, _ in r if not ok)})
    add("slot_log_2026-10-10_ok", answer(), WELL_KNOWN1, slot_facts())
    add("slot_log_2026-10-10_ots_not_served", answer(slot_facts(**{U["ots"]: None})), WELL_KNOWN1)
    add("bytes_ed25519_ots_ok", answer(bytes_world()), WELL_KNOWN1)
    m = answer()
    m["record_sha256"] = H("other")
    add("slot_log_changed_after_signing", m, WELL_KNOWN1)
    add("key_url_serves_another_key", answer(), DOC2)
    m = answer()
    m["subject_domain"] = "horizonshield.dev"
    add("subject_is_our_own_domain", m, WELL_KNOWN1)
    return {"schema": "witness-answer-v0.1-vectors", "key": "RFC 8032 section 7.1 TEST 1 (a public test key)",
            "public_key_ed25519_b64": DOC1["public_key_ed25519_b64"], "tool_sha256_in_answers": TOOL, "cases": cases}


class Vectors(unittest.TestCase):
    def test_vectors_file_matches(self):
        self.assertEqual(jload(HERE, "vectors.json"), json.loads(json.dumps(make_vectors())))


def run():
    r = unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]))
    bad = len(r.failures) + len(r.errors)
    print("outward_witness selftest %d / %d %s" % (r.testsRun - bad, r.testsRun, "all green" if r.wasSuccessful() else "NG"))
    return 0 if r.wasSuccessful() else 1


if __name__ == "__main__":
    if sys.argv[1:] == ["--write-vectors"]:
        with open(os.path.join(HERE, "vectors.json"), "w", encoding="utf-8") as f:
            f.write(json.dumps(make_vectors(), ensure_ascii=False, sort_keys=True, indent=2) + "\n")
        print("vectors.json written")
        sys.exit(0)
    sys.exit(run())
