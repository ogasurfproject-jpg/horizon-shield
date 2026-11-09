"""tests for witness_enroll_v0.py. No network: every socket call raises before the tests start. The public endpoints are
played by a fake reader (runner, ledger, two block explorers, key_url).

    python3 -I -B test_witness_enroll_v0.py                 run the tests
    python3 -I -B test_witness_enroll_v0.py --write-vectors  rewrite vectors.json (deterministic; the tests compare against it)
"""
import socket


def _no_network(*a, **k):
    raise RuntimeError("network is not allowed in these tests")


socket.socket = _no_network
socket.create_connection = _no_network
socket.getaddrinfo = _no_network

import base64, copy, hashlib, importlib.util, json, os, re, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
_sp = importlib.util.spec_from_file_location("witness_enroll_v0", os.path.join(HERE, "witness_enroll_v0.py"))
E = importlib.util.module_from_spec(_sp)
_sp.loader.exec_module(E)
W = E.W

H = lambda s: hashlib.sha256(s.encode()).hexdigest()
# RFC 8032 section 7.1 TEST 1 and TEST 2 public keys, and one key from a public test seed (not anyone's key)
PUB1 = bytes.fromhex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a")
PUB2 = bytes.fromhex("3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c")
PUB3 = W.ed25519_public(hashlib.sha256(b"witness-enroll-v0 test key 3").digest())
DAY = "2026-11-05"


def load(name):
    with open(os.path.join(HERE, name), "r", encoding="utf-8") as f:
        return json.load(f)


def entry(pub, host, joined="2026-11-04", left=None, kinds=("furui-day",), form="email"):
    return {"name": host.split(".")[0], "signed_domain": host, "key_url": "https://%s/keys/witness.json" % host,
            "public_key_ed25519_b64": base64.b64encode(pub).decode(), "key_id": W.key_id_of(pub), "kinds": list(kinds),
            "joined_on": joined, "consent": {"on": joined, "form": form, "enrollment_sha256": None if form == "email" else H("enroll " + host)},
            "left_on": left, "left_reason": None if left is None else "asked to leave"}


def pool(entries, version=1, prev=None):
    return {"schema": E.POOL_SCHEMA, "version": version, "previous_pool_sha256": prev, "entries": entries}


POOL3 = pool([entry(PUB1, "a.example"), entry(PUB2, "b.example"), entry(PUB3, "c.example")])


class World:
    """the runner, the ledger and two explorers, for one day; entries maps n -> (record_canonical, ots_status, block)"""

    def __init__(self, pl=None, day=DAY, n=2, pool_n=255, pool_block=974700, pool_status="confirmed", batch_n=260, H_=974750,
                 tips=(974765, 974765), beacons=None, runner="accepted", rec_status="anchored", batch_status="confirmed", key_doc=None):
        self.day, self.n, self.H = day, n, H_
        self.rec = W.canonical({"schema": "furui-check-day-v0", "day": day, "n": n, "root": H("root " + day), "first_height": 1,
                                "last_height": 2, "signatures": []})
        self.rs = H(self.rec)
        self.runner, self.rec_status, self.batch_n = runner, rec_status, batch_n
        self.tips = tips
        self.beacons = beacons if beacons is not None else [H("block %d" % (H_ + 1))] * 2
        self.ents = {}
        for i in range(1, batch_n + 3):
            self.ents[i] = ("# FILLER %d\n" % i, "confirmed", 974000 + i)
        if pl is not None:
            self.ents[pool_n] = (E.pool_record(pl), pool_status, pool_block if pool_status == "confirmed" else None)
        batch = W.canonical({"schema": "nenrin-agreement-batch-v1", "records": [{"canonical_sha256": H("x"), "record_schema": "a2a-admission-v0"},
                                                                               {"canonical_sha256": self.rs, "record_schema": "furui-check-day-v0"}]})
        self.ents[batch_n] = (batch, batch_status, H_ if batch_status == "confirmed" else None)
        self.key_doc = key_doc
        self.calls = []

    def add(self, n, rc, status="confirmed", block=974800):
        self.ents[n] = (rc, status, block)

    def get(self, url):
        self.calls.append(url)
        j = lambda o: (200, json.dumps(o).encode())
        if url == E.FURUI + "/furui/day/%s/status" % self.day:
            st = {"state": self.runner, "ledger_canonical_sha256": self.rs} if self.runner else None
            return j({"day": self.day, "status": st})
        if url == E.LEDGER + "/furui-check-day/" + self.rs:
            o = {"record_canonical": self.rec, "status": self.rec_status}
            if self.rec_status == "anchored":
                o["ledger_entry"] = self.batch_n
            return j(o)
        if url == E.LEDGER + "/ledger/head":
            return j({"n": max(self.ents)})
        if url == E.LEDGER + "/ledger/export.jsonl":
            return 200, "\n".join(json.dumps({"n": k, "claim_sha256": H(v[0])}) for k, v in sorted(self.ents.items())).encode()
        m = re.fullmatch(re.escape(E.LEDGER) + r"/ledger/([0-9]+)\?format=json", url)
        if m and int(m.group(1)) in self.ents:
            rc, st, b = self.ents[int(m.group(1))]
            return j({"n": int(m.group(1)), "record_canonical": rc, "claim_sha256": H(rc), "ots_status": st, "bitcoin_block": b})
        for i, base in enumerate(E.EXPLORERS):
            if url == base + "/blocks/tip/height":
                t = self.tips[i]
                if t is None:
                    return 503, b"down"
                return 200, str(t).encode()
            if url == base + "/block-height/%d" % (self.H + 1):
                return (200, self.beacons[i].encode()) if self.beacons[i] else (404, b"Block not found")
        if self.key_doc is not None and url.endswith("/keys/witness.json"):
            if self.key_doc == 500:
                return 500, b"x"
            return j(self.key_doc)
        raise AssertionError("unexpected GET " + url)


class Pool(unittest.TestCase):
    def test_pool_file_is_the_published_key(self):
        p = load("pool_v1.json")
        E.check_pool(p)
        self.assertEqual(E.pool_sha256(p), "96f8be7b1e3de7cb6a87a881281bb84cb408176bb050a7db45b7cdf90ec7d969")
        doc = json.load(open(os.path.join(HERE, "..", "witness-answer-v0", "fixtures", "pipavlo82_witness_json_20261104.json"), encoding="utf-8"))
        (e,) = p["entries"]
        self.assertEqual(e["public_key_ed25519_b64"], doc["public_key_ed25519_b64"])
        self.assertEqual(e["key_id"], "ed25519:375909759fe5e437")
        self.assertEqual(e["signed_domain"], "pipavlo82.github.io")
        self.assertEqual([x["signed_domain"] for x in E.active(p, DAY)], ["pipavlo82.github.io"])

    def test_pool_file_version_2(self):
        p, p1 = load("pool.json"), load("pool_v1.json")
        E.check_pool(p)
        self.assertEqual((p["version"], p["previous_pool_sha256"]), (2, E.pool_sha256(p1)))
        self.assertEqual(p["entries"][:1], p1["entries"])
        for e in p["entries"][1:]:
            self.assertEqual(e["consent"]["form"], "witness-enroll-v0")
            self.assertEqual((e["left_on"], e["left_reason"]), (None, None))
        self.assertEqual([x["signed_domain"] for x in E.active(p, DAY)], ["pipavlo82.github.io"])

    def test_refusals(self):
        def bad(mut):
            p = copy.deepcopy(POOL3)
            mut(p)
            with self.assertRaises(W.Bad):
                E.check_pool(p)
        bad(lambda p: p.update(extra=1))
        bad(lambda p: p["entries"][0].update(extra=1))
        bad(lambda p: p["entries"][0].update(key_id="ed25519:0000000000000000"))
        bad(lambda p: p["entries"][0].update(signed_domain="b.example"))
        bad(lambda p: p["entries"][0].update(key_url="https://witness.horizonshield.dev/k.json", signed_domain="witness.horizonshield.dev"))
        bad(lambda p: p["entries"][0].update(key_url="https://gist.github.com/k.json", signed_domain="gist.github.com"))
        bad(lambda p: p["entries"][0]["consent"].update(on="2026-11-09"))
        bad(lambda p: p["entries"][0]["consent"].update(enrollment_sha256=H("x")))
        bad(lambda p: p["entries"][0]["consent"].update(form="witness-enroll-v0"))
        bad(lambda p: p["entries"][0].update(left_on="2026-11-01", left_reason="x"))
        bad(lambda p: p["entries"][0].update(left_reason="x"))
        bad(lambda p: p["entries"][0].update(left_on="2026-11-09"))
        bad(lambda p: p["entries"][0].update(kinds=["tooshi-day", "furui-day"]))
        bad(lambda p: p["entries"][0].update(kinds=[]))
        bad(lambda p: p["entries"][0].update(public_key_ed25519_b64=base64.b64encode(bytes(32)).decode()))
        bad(lambda p: p["entries"].append(entry(PUB1, "d.example")))
        bad(lambda p: p["entries"].append(dict(entry(PUB3, "a.example"), joined_on="2026-11-06")))
        bad(lambda p: p.update(version=2))
        bad(lambda p: p.update(previous_pool_sha256=H("x")))
        bad(lambda p: p.update(version=1.0))
        bad(lambda p: p.update(schema="nenrin-witness-pool-v1"))

    def test_key_change_and_leave(self):
        new = W.ed25519_public(hashlib.sha256(b"witness-enroll-v0 test key 4").digest())
        p = copy.deepcopy(POOL3)
        p["entries"][0].update(left_on="2026-11-07", left_reason="key changed")
        p["entries"].append(dict(entry(new, "a.example", joined="2026-11-07")))
        p["entries"][1].update(left_on="2026-11-06", left_reason="asked to leave")
        p.update(version=2, previous_pool_sha256=E.pool_sha256(POOL3))
        E.check_pool(p)
        on = lambda d: sorted(x["key_id"] for x in E.active(p, d))
        self.assertEqual(on("2026-11-05"), sorted([W.key_id_of(PUB1), W.key_id_of(PUB2), W.key_id_of(PUB3)]))
        self.assertEqual(on("2026-11-06"), sorted([W.key_id_of(PUB1), W.key_id_of(PUB3)]))
        self.assertEqual(on("2026-11-07"), sorted([W.key_id_of(new), W.key_id_of(PUB3)]))
        self.assertEqual(on("2026-11-03"), [])
        q = pool([entry(PUB1, "a.example", kinds=("tooshi-day",))])
        self.assertEqual(E.active(q, DAY), [])

    def test_pool_record(self):
        rc = E.pool_record(POOL3)
        self.assertEqual(E.parse_pool_record(rc), POOL3)
        self.assertTrue(rc.startswith(E.POOL_HEAD + "\n\npool_sha256: " + E.pool_sha256(POOL3) + "\n"))
        for t in (rc.replace("pool_version: 1", "pool_version: 2"), rc.replace("a.example", "z.example"), rc + " "):
            with self.assertRaises((W.Bad, ValueError)):
                E.parse_pool_record(t)

    def test_records_leave_the_tsugi_gate_alone(self):
        d = E.draw(DAY, H("d"), 5, H("r"), 260, 974750, H("b"), POOL3, 255)
        for rc in (E.pool_record(POOL3), E.draw_record(d, "0" * 64)):
            first = rc.split("\n", 1)[0]
            self.assertFalse(first.startswith("# tsugi-draw-commitment-") or first.startswith("# TSUGI live draw") or first.startswith("# TSUGI draw dropped"))
            self.assertNotIn("committed in ledger entry", rc)


def tsugi_pick(beacon, psha, subject, n):
    """witness_draw.mjs draw() with k = 1, written out again"""
    seed = H(beacon + "|" + psha + "|" + subject)
    return seed, int(H(seed + "|0")[:16], 16) % n


class Draw(unittest.TestCase):
    def test_one_witness_is_always_drawn(self):
        p = load("pool.json")
        for i in range(200):
            d = E.draw(DAY, H("day %d" % i), 1 + i % 7, H("r"), 300, 974000, H("beacon %d" % i), p, 299)
            self.assertEqual(d["witness_key_id"], "ed25519:375909759fe5e437")
            li = d["leaf_index"]
            self.assertEqual(len(li), min(2, d["n"]))
            self.assertEqual(li, sorted(set(li)))
            self.assertTrue(all(0 <= x < d["n"] for x in li))

    def test_the_arithmetic_is_tsugis(self):
        for i in range(50):
            d = E.draw(DAY, H("s%d" % i), 1000, H("r"), 300, 974000, H("b%d" % i), POOL3, 299)
            seed, j = tsugi_pick(H("b%d" % i), E.pool_sha256(POOL3), H("s%d" % i), 3)
            self.assertEqual(d["seed_sha256"], seed)
            self.assertEqual(d["witness_key_id"], E.active(POOL3, DAY)[j]["key_id"])
            a = list(range(1000))
            for k in range(2):
                jj = k + int(H(seed + "|leaf|" + str(k))[:16], 16) % (1000 - k)
                a[k], a[jj] = a[jj], a[k]
            self.assertEqual(d["leaf_index"], sorted(a[:2]))

    def test_three_witnesses_are_each_drawn(self):
        seen = {E.draw(DAY, H("d"), 2, H("r"), 300, 974000, H("b%d" % i), POOL3, 299)["witness_key_id"] for i in range(300)}
        self.assertEqual(len(seen), 3)

    def test_no_witness(self):
        with self.assertRaises(E.NoWitness):
            E.draw("2026-11-03", H("d"), 2, H("r"), 300, 974000, H("b"), POOL3, 299)
        with self.assertRaises(W.Bad):
            E.draw(DAY, H("d"), 2, H("r"), 300, 974000, H("b"), POOL3, 300)

    def test_record(self):
        d = E.draw(DAY, H("d"), 9, H("r"), 260, 974750, H("b"), load("pool.json"), 255)
        rc = E.draw_record(d, "0" * 64)
        f = E.parse_draw_record(rc)
        self.assertEqual(list(f), E.FIELDS)
        self.assertEqual(f["leaf_index"], " ".join(str(x) for x in d["leaf_index"]))
        self.assertEqual(f["beacon_block"], "974751")
        for x in d["leaf_index"]:
            self.assertIn("nenrin-verify furui-day %s --leaf %d" % (DAY, x), rc)
        self.assertTrue(all(ord(c) < 128 for c in rc))
        with self.assertRaises(W.Bad):
            E.parse_draw_record(rc.replace("eligible: 1\n", ""))


def seed_of(w, **k):
    st, rc = E.draw_live(DAY, w.get, "0" * 64, **k)
    return st, rc


class Live(unittest.TestCase):
    def setUp(self):
        self.p = load("pool.json")

    def code(self, w, **k):
        try:
            seed_of(w, **k)
            return 0
        except E.Stop as e:
            return e.code

    def test_ok(self):
        w = World(self.p)
        st, rc = seed_of(w)
        self.assertEqual(st, "new")
        f = E.parse_draw_record(rc)
        self.assertEqual((f["pool_entry"], f["day_batch_entry"], f["anchor_block"], f["beacon_block"]), ("255", "260", "974750", "974751"))
        self.assertEqual(f["witness_signed_domain"], "pipavlo82.github.io")
        self.assertEqual(f["leaf_index"], "0 1")
        self.assertTrue(all(any(u.startswith(h) for h in (E.LEDGER, E.FURUI) + E.EXPLORERS) for u in w.calls))

    def test_already_and_different(self):
        w = World(self.p)
        _, rc = seed_of(w)
        w.add(262, rc)
        self.assertEqual(seed_of(w), ("already", 262))
        w.add(262, rc.replace("sha256:" + "0" * 64, "sha256:" + "1" * 64))
        self.assertEqual(seed_of(w), ("already", 262))
        w.add(262, rc.replace("leaf_index: 0 1", "leaf_index: 1"))
        self.assertEqual(self.code(w), 1)
        w.add(262, E.DRAW_HEAD + DAY + "\n\nsomething else\n")
        self.assertEqual(self.code(w), 1)

    def test_not_yet(self):
        self.assertEqual(self.code(World(self.p, runner="pending")), 3)
        self.assertEqual(self.code(World(self.p, runner=None)), 3)
        self.assertEqual(self.code(World(self.p, rec_status="pending_anchor")), 3)
        self.assertEqual(self.code(World(self.p, batch_status="pending")), 3)
        self.assertEqual(self.code(World(self.p, pool_status="pending")), 3)
        self.assertEqual(self.code(World(self.p, tips=(974755, 974765))), 3)
        self.assertEqual(self.code(World(self.p, beacons=[None, None])), 3)

    def test_pool_rule(self):
        self.assertEqual(self.code(World(self.p, pool_block=974751)), 4)
        self.assertEqual(self.code(World(self.p, pool_n=261)), 4)
        self.assertEqual(self.code(World(None)), 4)
        w = World(self.p, pool_block=974750)
        self.assertEqual(seed_of(w)[0], "new")
        p2 = copy.deepcopy(POOL3)
        p2.update(version=2, previous_pool_sha256=E.pool_sha256(self.p))
        w.add(258, E.pool_record(p2), block=974740)
        f = E.parse_draw_record(seed_of(w)[1])
        self.assertEqual((f["pool_entry"], f["pool_sha256"], f["eligible"]), ("258", E.pool_sha256(p2), "3"))
        w.add(259, E.pool_record(self.p), block=974760)
        self.assertEqual(E.parse_draw_record(seed_of(w)[1])["pool_entry"], "258")
        w.add(259, E.pool_record(self.p), status="pending", block=None)
        self.assertEqual(self.code(w), 3)

    def test_refused(self):
        self.assertEqual(self.code(World(self.p, beacons=[H("x"), H("y")])), 1)
        self.assertEqual(self.code(World(self.p, tips=(None, 974765))), 2)
        w = World(self.p)
        w.ents[260] = (W.canonical({"schema": "nenrin-agreement-batch-v1", "records": []}), "confirmed", 974750)
        self.assertEqual(self.code(w), 1)
        w = World(self.p)
        del w.ents[100]
        self.assertEqual(self.code(w), 1)
        w = World(self.p)
        g = w.get
        w.get = lambda u: (200, g(u)[1].replace(b"FILLER 256", b"FILLER 999")) if u.endswith("/ledger/256?format=json") else g(u)
        self.assertEqual(self.code(w), 1)

    def test_key_url(self):
        doc = {"public_key_ed25519_b64": self.p["entries"][0]["public_key_ed25519_b64"]}
        self.assertEqual(seed_of(World(self.p, key_doc=doc), check_key_url=True)[0], "new")
        self.assertEqual(self.code(World(self.p, key_doc={"public_key_ed25519_b64": base64.b64encode(PUB1).decode()}), check_key_url=True), 1)
        self.assertEqual(self.code(World(self.p, key_doc=500), check_key_url=True), 2)

    def test_verify_draw(self):
        w = World(self.p)
        _, rc = seed_of(w)
        w.add(262, rc)
        self.assertEqual(E.verify_draw(262, w.get)[-1], "VERDICT draw_ok")
        w.add(262, rc.replace("leaf_index: 0 1", "leaf_index: 0 0"))
        self.assertEqual(E.verify_draw(262, w.get)[-1], "VERDICT not_ok")
        w.add(262, rc)
        w.add(263, rc)
        self.assertEqual(E.verify_draw(263, w.get)[-1], "VERDICT not_ok")

    def test_no_socket(self):
        with self.assertRaises(Exception):
            E.http_get(E.LEDGER + "/ledger/head")


# A key_url that serves one OpenSSH line (2026-11-07). The key part of https://sencor.ai/keys/witness.pub (fetched
# 2026-11-07) with a generic comment; the fingerprint and the key come from the base64 alone.
SENCOR = b"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJDSZavjq+n3yxyvowCNma1gpeC1NXooMLI70YbwN3Px witness key\n"
SENCOR_RAW = bytes.fromhex("90d265abe3abe9f7cb1cafa3008d99ad60a5e0b5357a2830b23bd186f03773f1")


def wire(name, key, tail=b""):
    s = lambda b: len(b).to_bytes(4, "big") + b
    return base64.b64encode(s(name) + s(key) + tail)


class SshKey(unittest.TestCase):
    def test_published_line(self):
        blob = base64.b64decode(SENCOR.split(b" ")[1])
        self.assertEqual("SHA256:" + base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip("="),
                         "SHA256:zuNo8wSV2fuhmuqhf3sv+0wEyL3p5/1wWvUub+3RoWE")
        k = E.ssh_ed25519_key(SENCOR)
        self.assertEqual(k, SENCOR_RAW)
        self.assertEqual(W.key_id_of(k), "ed25519:06bcf268b400a48b")
        self.assertTrue(W.key_ok(k))
        self.assertEqual(E.served_key(SENCOR), SENCOR_RAW)

    def test_lines_read_and_refused(self):
        B = wire(b"ssh-ed25519", SENCOR_RAW)
        pad1 = wire(b"ssh-ed25519", SENCOR_RAW, b"\x00")
        non_canon = pad1[:-3] + bytes([pad1[-3] + 1]) + b"=="
        good = [b"ssh-ed25519 " + B + b"\n", b"ssh-ed25519 " + B + b" c", b"ssh-ed25519 " + B + b" c\r\n",
                b"ssh-ed25519\t" + B + b"\tc", b"ssh-ed25519 " + B + b" \n"]
        bad = [b"ssh-rsa " + B + b" c\n", b"ssh-ed25519 " + wire(b"ssh-ed25518", SENCOR_RAW) + b"\n",
               b'from="*" ssh-ed25519 ' + B + b"\n", b" ssh-ed25519 " + B + b"\n", b"ssh-ed25519 " + B + b"\nssh-ed25519 " + B + b"\n",
               b"ssh-ed25519 " + B + b"\n\n", b"ssh-ed25519 " + wire(b"ssh-ed25519", SENCOR_RAW[:31]) + b"\n",
               b"ssh-ed25519 " + wire(b"ssh-ed25519", SENCOR_RAW + b"\x01") + b"\n", b"ssh-ed25519 " + pad1 + b"\n",
               b"ssh-ed25519 " + non_canon + b"\n", b"ssh-ed25519 " + pad1.rstrip(b"=") + b"\n", b"ssh-ed25519\n", b"ssh-ed25519 \n",
               b"ssh-ed25519 " + B + " darr\u00e9n\n".encode("utf-8"), b"ssh-ed25519 " + B + b" a\x00b\n", b""]
        for t in good:
            self.assertEqual(E.ssh_ed25519_key(t), SENCOR_RAW, t)
        for t in bad:
            self.assertIsNone(E.ssh_ed25519_key(t), t)
            with self.assertRaises(W.Bad):
                E.served_key(t)

    def test_json_document_as_before(self):
        self.assertEqual(E.served_key(json.dumps({"public_key_ed25519_b64": base64.b64encode(PUB1).decode()}).encode()), PUB1)
        for doc in ({"key": "x"}, None, [], SENCOR.decode()):        # an ssh line inside a JSON string is not read
            with self.assertRaises(W.Bad):
                E.served_key(json.dumps(doc).encode())

    def test_key_served_reads_an_ssh_line(self):
        e = entry(SENCOR_RAW, "sencor.example")
        self.assertTrue(E.key_served(e, lambda u: (200, SENCOR)))
        self.assertFalse(E.key_served(entry(PUB1, "a.example"), lambda u: (200, SENCOR)))
        self.assertFalse(E.key_served(e, lambda u: (200, b"ssh-ed25519 " + wire(b"ssh-ed25519", SENCOR_RAW, b"\x00") + b"\n")))


def make_vectors():
    cases = []
    p1 = load("pool_v1.json")
    left = copy.deepcopy(POOL3)
    left["entries"][1].update(left_on=DAY, left_reason="asked to leave")
    for name, pl, n, day in (("pool_json_two_leaves", p1, 2, DAY), ("pool_json_one_leaf", p1, 1, DAY), ("pool_json_many_leaves", p1, 1000, DAY),
                             ("three_witnesses", POOL3, 37, DAY), ("three_witnesses_one_left", left, 37, DAY),
                             ("no_witness_active_yet", POOL3, 2, "2026-11-03")):
        inp = {"day": day, "day_sha256": H("day " + name), "n": n, "root": H("root " + name), "batch_entry": 260, "anchor_block": 974750,
               "beacon_hash": H("beacon " + name), "pool_entry": 255}
        try:
            d = E.draw(pool=pl, **inp)
            rc = E.draw_record(d, "0" * 64)
            exp = {"draw": d, "record_sha256": H(rc)}
        except E.NoWitness:
            exp = "no_witness"
        cases.append({"name": name, "input": dict(inp, pool=pl), "pool_sha256": E.pool_sha256(pl), "expect": exp})
    return {"schema": "witness-enroll-v0-vectors", "tool_sha256_in_records": "0" * 64,
            "keys": "pool.json (a published public key), RFC 8032 section 7.1 TEST 1 and TEST 2, and one key from the public seed "
                    "sha256(\"witness-enroll-v0 test key 3\")", "pool_json_sha256": E.pool_sha256(p1),
            "pool_json_record_sha256": H(E.pool_record(p1)), "cases": cases}


class Vectors(unittest.TestCase):
    def test_vectors_file_matches(self):
        self.assertEqual(load("vectors.json"), json.loads(json.dumps(make_vectors())))


def run():
    suite = unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__])
    r = unittest.TextTestRunner(verbosity=1).run(suite)
    n, bad = r.testsRun, len(r.failures) + len(r.errors)
    print("witness-enroll-v0 tests %d / %d %s" % (n - bad, n, "all green" if r.wasSuccessful() else "NG"))
    return 0 if r.wasSuccessful() else 1


if __name__ == "__main__":
    if sys.argv[1:] == ["--write-vectors"]:
        with open(os.path.join(HERE, "vectors.json"), "w", encoding="utf-8") as f:
            f.write(json.dumps(make_vectors(), ensure_ascii=False, sort_keys=True, indent=1) + "\n")
        print("vectors.json written")
        sys.exit(0)
    sys.exit(run())
