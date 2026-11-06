"""outward_witness.py: HORIZON SHIELD recomputes another project's published record and signs what it recomputed
(witness-answer-v0.1, kind outside-record). Python standard library only. Only `fetch` and `verify --fetch` use the
network; `build`, `verify --key-doc`, `ledger-body`, `pick-day` and `selftest` read local files. The tests are
test_outward_witness.py (every socket blocked) and vectors.json.

    python3 -I -B outward_witness.py fetch invinoveritas-slot-log --date YYYY-MM-DD [--base URL] --out facts.json
    python3 -I -B outward_witness.py fetch bytes --url URL [--ots-url URL] [--sig-url URL --sig-alg ed25519|bip340 (--sig-key-url URL | --sig-pub HEX)] --subject DOMAIN --out facts.json
    python3 -I -B outward_witness.py build      facts.json [--key key.pem | --pub B64] [--limit "..."] --out answer.json
    python3 -I -B outward_witness.py preimage   answer.json --out preimage.bin           (to sign with openssl elsewhere)
    python3 -I -B outward_witness.py attach-sig answer.json --sig-file sig.bin --out answer.json
    python3 -I -B outward_witness.py verify     answer.json --key-doc key.json           (offline: the JSON key_url serves)
    python3 -I -B outward_witness.py verify     answer.json --fetch                      (GET key_url, https only, no redirects)
    python3 -I -B outward_witness.py ledger-body answer.json (--key-doc key.json | --fetch) --out seed.json
    python3 -I -B outward_witness.py pick-day   --export export.jsonl --month YYYY-MM --cutoff YYYY-MM-DDT00:00:00Z
    python3 -I -B outward_witness.py selftest

witness-answer-v0.1 adds one kind to witness-answer-v0 (workers/hs-ledger/nenrin/witness-answer-v0). The two v0 kinds,
furui-day and tooshi-day, are unchanged: they keep the schema line "witness-answer-v0" and are built and verified by
witness_answer_v0.py. This file builds and verifies outside-record only.

The answer (every key required, no other key allowed):
    schema          "witness-answer-v0.1"
    kind            "outside-record"
    subject_domain  the domain of the project whose record this is (never this project's own)
    record_url      https URL the record bytes were read from
    record_sha256   sha256 of those bytes
    record_kind     the fetcher: "invinoveritas-slot-log" or "bytes"
    recomputed      the steps of that fetcher that were ok here, in the fetcher's order (STEPS below)
    anchor          {block_height, block_hash} of the Bitcoin block checked in ots_anchor, or null when that step is not listed
    tool            one line naming this file and its sha256
    observed_at     YYYY-MM-DDTHH:MM:SSZ (when the bytes were read)
    limits          one line each: what this answer does not establish
    witness         {name, key_id, key_url}
    signature       {alg: "ed25519", key_id, sig}
preimage = UTF-8 bytes of "witness-answer-v0.1\n" + canonical JSON of the answer without "signature" (the v0 rule).
key_id = "ed25519:" + the first 16 hex of sha256(raw 32-byte public key). The key_url serves {"public_key_ed25519_b64": ...}
(and may carry key_id, purpose and since; a key_id there must equal the computed one).
The Ed25519 code is the arithmetic of witness_answer_v0.py, the BIP-340 verification is that of slot-witness-v0/bip340.py
and the OpenTimestamps reader is that of musubi-v0/anchor_compose.py, copied so this file runs alone. Signing here is not
constant time; preimage and attach-sig let you sign elsewhere.
"""
import base64, calendar, datetime, hashlib, json, re, sys

SCHEMA = "witness-answer-v0.1"
V0_SCHEMA = "witness-answer-v0"
V0_KINDS = ("furui-day", "tooshi-day")      # witness-answer-v0, unchanged: witness_answer_v0.py builds and verifies them
KIND = "outside-record"
FACTS_SCHEMA = "outward-witness-facts-v0"
SEED_WORK = "NENRIN outward witness: %s %s %s"
ANSWER_KEYS = sorted(["schema", "kind", "subject_domain", "record_url", "record_sha256", "record_kind", "recomputed", "anchor",
                      "tool", "observed_at", "limits", "witness", "signature"])
STEPS = {"invinoveritas-slot-log": ["bytes_sha256", "entries_parse", "merkle_root", "prev_root_chain", "ots_anchor"],
         "bytes": ["bytes_sha256", "ots_anchor", "signature"]}
SLOT_LOG_SCHEMA = "invinoveritas.decision_receipt.slot_log.v1"
SLOT_LOG_BASE = "https://invinoveritas.dev/decision-receipt/slots/log"
SLOT_LOG_GENESIS = "0" * 64
SLOT_LINE_KEYS = sorted(["slot", "scope", "event_ids", "taken_at", "claim_sha256", "decider_sig", "conflicts"])
EXPLORERS = (("mempool", "https://mempool.space/api"), ("blockstream", "https://blockstream.info/api"))
WITNESS_NAME = "horizonshield.dev"
WITNESS_KEY_URL = "https://horizonshield.dev/.well-known/nenrin-witness-key.json"
DEFAULT_LIMITS = ["only the steps listed in recomputed were recomputed here; this answer does not say the record is complete or that its content is true",
                  "the bytes are what record_url served to this vantage at observed_at; what it served to others or at other times is not covered",
                  "the Bitcoin block, when named, was checked against two public block explorers that agreed; no node of our own was run"]
OPERATOR_SUFFIXES = ("horizonshield.dev", "the-horizons-innovation.com", "oga-surf-project.workers.dev")
SHARED_HOSTS = ("github.com", "gist.github.com", "gist.githubusercontent.com", "objects.githubusercontent.com", "codeload.github.com",
                "raw.githubusercontent.com", "gitlab.com", "bitbucket.org", "codeberg.org", "huggingface.co", "cdn.jsdelivr.net", "unpkg.com",
                "esm.sh", "storage.googleapis.com", "s3.amazonaws.com", "drive.google.com", "docs.google.com", "dropbox.com", "www.dropbox.com",
                "dl.dropboxusercontent.com", "pastebin.com", "web.archive.org", "archive.org", "pypi.org", "files.pythonhosted.org",
                "registry.npmjs.org", "medium.com", "notion.site")
H64 = re.compile(r"[0-9a-f]{64}")
H128 = re.compile(r"[0-9a-f]{128}")
H160 = re.compile(r"[0-9a-f]{160}")
DAY = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
ISO = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z")
KEY_ID = re.compile(r"ed25519:[0-9a-f]{16}")
SIG88 = re.compile(r"[A-Za-z0-9+/]{86}==")
DOMAIN = re.compile(r"(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}")
SAFE = 9007199254740991
LINE_MAX, LIMITS_MAX, NAME_MAX = 500, 20, 120
MAX_RECORD, MAX_OTS, MAX_SIG = 8 << 20, 1 << 16, 4096


class Bad(ValueError):
    pass


# ---- canonical JSON (RFC 8785 on the closed value set, as witness_answer_v0.py) ----
def canonical(o):
    def chk(v):
        if isinstance(v, float):
            raise Bad("float not allowed")
        if isinstance(v, int) and not isinstance(v, bool) and not -SAFE <= v <= SAFE:
            raise Bad("integer out of range")
        if isinstance(v, str) and any(0xD800 <= ord(x) <= 0xDFFF for x in v):
            raise Bad("lone surrogate")
        if isinstance(v, list):
            for x in v:
                chk(x)
        elif isinstance(v, dict):
            for k, x in v.items():
                if not isinstance(k, str) or not all(0x20 <= ord(ch) <= 0x7E for ch in k):
                    raise Bad("key must be printable ASCII")
                chk(x)
        elif not (v is None or isinstance(v, (bool, int, str))):
            raise Bad("type not allowed")
    chk(o)
    return json.dumps(o, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256hex(b):
    return hashlib.sha256(b if isinstance(b, bytes) else b.encode("utf-8")).hexdigest()


# ---- Ed25519 (RFC 8032), the arithmetic of witness_answer_v0.py ----
_P = 2 ** 255 - 19
_Q = 2 ** 252 + 27742317777372353535851937790883648493
_D = -121665 * pow(121666, _P - 2, _P) % _P
_I = pow(2, (_P - 1) // 4, _P)


def _add(a, b):
    A, B = (a[1] - a[0]) * (b[1] - b[0]) % _P, (a[1] + a[0]) * (b[1] + b[0]) % _P
    C, D = 2 * a[3] * b[3] * _D % _P, 2 * a[2] * b[2] % _P
    E, F, G, H = B - A, D - C, D + C, B + A
    return (E * F % _P, G * H % _P, F * G % _P, E * H % _P)


def _mul(s, pt):
    q = (0, 1, 1, 0)
    while s > 0:
        if s & 1:
            q = _add(q, pt)
        pt = _add(pt, pt)
        s >>= 1
    return q


def _xrec(y, sign):
    if y >= _P:
        return None
    x2 = (y * y - 1) * pow(_D * y * y + 1, _P - 2, _P) % _P
    if x2 == 0:
        return None if sign else 0
    x = pow(x2, (_P + 3) // 8, _P)
    if (x * x - x2) % _P:
        x = x * _I % _P
    if (x * x - x2) % _P:
        return None
    return _P - x if (x & 1) != sign else x


_GY = 4 * pow(5, _P - 2, _P) % _P
_G = (_xrec(_GY, 0), _GY, 1, _xrec(_GY, 0) * _GY % _P)


def _enc(pt):
    zi = pow(pt[2], _P - 2, _P)
    x, y = pt[0] * zi % _P, pt[1] * zi % _P
    return int.to_bytes(y | ((x & 1) << 255), 32, "little")


def _dec(b):
    y = int.from_bytes(b, "little")
    sign, y = y >> 255, y & ((1 << 255) - 1)
    x = _xrec(y, sign)
    return None if x is None else (x, y, 1, x * y % _P)


def _is_identity(pt):
    return pt[0] % _P == 0 and (pt[1] - pt[2]) % _P == 0


def _hq(m):
    return int.from_bytes(hashlib.sha512(m).digest(), "little") % _Q


def _scalar(seed):
    h = hashlib.sha512(seed).digest()
    return (int.from_bytes(h[:32], "little") & ((1 << 254) - 8)) | (1 << 254), h[32:]


def ed25519_public(seed):
    return _enc(_mul(_scalar(seed)[0], _G))


def ed25519_sign(seed, msg):
    a, prefix = _scalar(seed)
    A = _enc(_mul(a, _G))
    r = _hq(prefix + msg)
    R = _enc(_mul(r, _G))
    return R + int.to_bytes((r + _hq(R + A + msg) * a) % _Q, 32, "little")


def key_ok(pub):
    """the canonical encoding of a point of the prime-order subgroup (not small order, not mixed order)"""
    if len(pub) != 32 or int.from_bytes(pub, "little") & ((1 << 255) - 1) >= _P:
        return False
    A = _dec(pub)
    return A is not None and not _is_identity(A) and _is_identity(_mul(_Q, A)) and _enc(A) == pub


def ed25519_verify(pub, msg, sg):
    if len(pub) != 32 or len(sg) != 64 or not key_ok(pub):
        return False
    A, R = _dec(pub), _dec(sg[:32])
    s = int.from_bytes(sg[32:], "little")
    if A is None or R is None or s >= _Q:
        return False
    sB, rhs = _mul(s, _G), _add(R, _mul(_hq(sg[:32] + pub + msg), A))
    return (sB[0] * rhs[2] - rhs[0] * sB[2]) % _P == 0 and (sB[1] * rhs[2] - rhs[1] * sB[2]) % _P == 0


# ---- BIP-340 verification (secp256k1), the code of slot-witness-v0/bip340.py ----
_KP = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
_KN = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
_KG = (0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
       0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)


def _tagged(tag, msg):
    t = hashlib.sha256(tag.encode()).digest()
    return hashlib.sha256(t + t + msg).digest()


def _kadd(a, b):
    if a is None:
        return b
    if b is None:
        return a
    if a[0] == b[0] and a[1] != b[1]:
        return None
    if a == b:
        lam = 3 * a[0] * a[0] * pow(2 * a[1], _KP - 2, _KP) % _KP
    else:
        lam = (b[1] - a[1]) * pow(b[0] - a[0], _KP - 2, _KP) % _KP
    x3 = (lam * lam - a[0] - b[0]) % _KP
    return (x3, (lam * (a[0] - x3) - a[1]) % _KP)


def _kmul(pt, k):
    r = None
    while k:
        if k & 1:
            r = _kadd(r, pt)
        pt = _kadd(pt, pt)
        k >>= 1
    return r


def _lift_x(x):
    if x >= _KP:
        return None
    y_sq = (pow(x, 3, _KP) + 7) % _KP
    y = pow(y_sq, (_KP + 1) // 4, _KP)
    if y * y % _KP != y_sq:
        return None
    return (x, y if y % 2 == 0 else _KP - y)


def bip340_verify(pub, msg, sig):
    """pub: 32 bytes x-only, msg: bytes, sig: 64 bytes. BIP-340 Verification."""
    if len(pub) != 32 or len(sig) != 64:
        return False
    pt = _lift_x(int.from_bytes(pub, "big"))
    r, s = int.from_bytes(sig[:32], "big"), int.from_bytes(sig[32:], "big")
    if pt is None or r >= _KP or s >= _KN:
        return False
    e = int.from_bytes(_tagged("BIP0340/challenge", sig[:32] + pub + msg), "big") % _KN
    R = _kadd(_kmul(_KG, s), _kmul(pt, _KN - e))
    return R is not None and R[1] % 2 == 0 and R[0] == r


# ---- OpenTimestamps reader, the code of musubi-v0/anchor_compose.py read_ots ----
OTS_MAGIC = b"\x00OpenTimestamps\x00\x00Proof\x00\xbf\x89\xe2\xe8\x84\xe8\x92\x94"
TAG_BITCOIN = bytes.fromhex("0588960d73d71901")
TAG_PENDING = bytes.fromhex("83dfe30d2ef90c8e")
UNARY = {0x08: "sha256", 0xf3: "hexlify", 0x02: "sha1", 0x03: "ripemd160", 0xf2: "reverse", 0x67: "keccak256"}
BINARY = {0xf0: "append", 0xf1: "prepend"}
OTS_DEPTH = 256


class _R:
    def __init__(self, b):
        self.b, self.i = b, 0

    def byte(self):
        if self.i >= len(self.b):
            raise Bad("ots: file ends inside the proof")
        self.i += 1
        return self.b[self.i - 1]

    def take(self, n):
        if self.i + n > len(self.b):
            raise Bad("ots: file ends inside the proof")
        self.i += n
        return self.b[self.i - n:self.i]

    def varuint(self):
        v, shift = 0, 0
        while True:
            c = self.byte()
            v |= (c & 0x7f) << shift
            if not c & 0x80:
                return v
            shift += 7
            if shift > 63:
                raise Bad("ots: varuint too long")

    def varbytes(self, maxlen):
        n = self.varuint()
        if n > maxlen:
            raise Bad("ots: operand of %d bytes over the %d byte limit" % (n, maxlen))
        return self.take(n)


def _ots_apply(name, arg, msg):
    if name == "sha256":
        return hashlib.sha256(msg).digest()
    if name == "hexlify":
        return msg.hex().encode("ascii")
    if name == "append":
        return msg + arg
    if name == "prepend":
        return arg + msg
    if name == "sha1":
        return hashlib.sha1(msg).digest()
    if name == "reverse":
        return msg[::-1]
    if name == "ripemd160":
        try:
            return hashlib.new("ripemd160", msg).digest()
        except ValueError:
            return None
    return None


def _ots_node(r, msg, out, depth):
    if depth > OTS_DEPTH:
        raise Bad("ots: proof deeper than %d" % OTS_DEPTH)

    def one(tag):
        if tag == 0x00:
            atag = r.take(8)
            payload = r.varbytes(8192)
            item = {"msg": msg}
            if atag == TAG_BITCOIN:
                pr = _R(payload)
                item.update(kind="bitcoin", height=pr.varuint())
                if pr.i != len(payload):
                    raise Bad("ots: bitcoin attestation payload has trailing bytes")
            elif atag == TAG_PENDING:
                pr = _R(payload)
                item.update(kind="pending", uri=pr.varbytes(1000).decode("ascii", "replace"))
            else:
                item.update(kind="other")
            out.append(item)
            return
        if tag in UNARY:
            name, arg = UNARY[tag], None
        elif tag in BINARY:
            name, arg = BINARY[tag], r.varbytes(4096)
        else:
            raise Bad("ots: unknown operation tag 0x%02x" % tag)
        nxt = _ots_apply(name, arg, msg) if msg is not None else None
        if nxt is not None and len(nxt) > 4096:
            raise Bad("ots: intermediate result over 4096 bytes")
        _ots_node(r, nxt, out, depth + 1)
    tag = r.byte()
    while tag == 0xff:
        one(r.byte())
        tag = r.byte()
    one(tag)


def read_ots(data):
    """a detached .ots -> (file digest, attestations [{kind, height|uri, msg}])"""
    r = _R(data)
    if r.take(len(OTS_MAGIC)) != OTS_MAGIC:
        raise Bad("ots: missing the OpenTimestamps header magic")
    if r.varuint() != 1:
        raise Bad("ots: unsupported major version")
    if r.byte() != 0x08:
        raise Bad("ots: only sha256 file digests are read")
    digest = r.take(32)
    out = []
    _ots_node(r, digest, out, 0)
    if r.i != len(data):
        raise Bad("ots: %d bytes after the proof" % (len(data) - r.i))
    return digest, out


# ---- the Bitcoin header at the attested height, from two explorers (furui-check-day-v0 --bitcoin-header) ----
def _sha256d(b):
    return hashlib.sha256(hashlib.sha256(b).digest()).digest()


def bits_target(bits):
    exp, mant = bits >> 24, bits & 0x007FFFFF
    if bits & 0x00800000 or mant == 0 or exp > 32:
        return None
    return mant << (8 * (exp - 3)) if exp >= 3 else mant >> (8 * (3 - exp))


def header_urls(height, block_hashes=None):
    out = []
    for i, (name, base) in enumerate(EXPLORERS):
        out.append(base + "/block-height/%d" % height)
        if block_hashes and block_hashes[i]:
            out.append(base + "/block/" + block_hashes[i] + "/header")
    return out


def bitcoin_header(height, merkle_internal, get):
    """-> (state, why, {block_height, block_hash}). merkle_internal is the attestation's msg (header bytes 36..68)."""
    hashes, headers = [], []
    for name, base in EXPLORERS:
        s, b = get(base + "/block-height/%d" % height)
        if s is None:
            return "not_yet", "%s did not answer for height %d" % (name, height), None
        if s != 200:
            return "fail", "%s answered http %s for height %d" % (name, s, height), None
        t = b.decode("latin-1").strip()
        if not H64.fullmatch(t):
            return "fail", name + " did not answer a block hash", None
        s, b = get(base + "/block/" + t + "/header")
        if s is None:
            return "not_yet", "%s did not answer the header of %s" % (name, t), None
        x = b.decode("latin-1").strip() if s == 200 else ""
        if not H160.fullmatch(x):
            return "fail", name + " did not serve an 80 byte header", None
        hashes.append(t)
        headers.append(x)
    if hashes[0] != hashes[1]:
        return "fail", "the explorers name different blocks at height %d" % height, None
    if headers[0] != headers[1]:
        return "fail", "the explorers serve different headers", None
    hb = bytes.fromhex(headers[0])
    bh = _sha256d(hb)[::-1].hex()
    if bh != hashes[0]:
        return "fail", "the header does not hash to the named block", None
    target = bits_target(int.from_bytes(hb[72:76], "little"))
    if target is None or int(bh, 16) > target:
        return "fail", "the header hash does not meet its own bits", None
    if hb[36:68] != merkle_internal:
        return "fail", "the header's merkle root is not the one the proof reaches", None
    return "ok", "", {"block_height": height, "block_hash": bh}


def ots_step(ots_bytes, digest_hex, get):
    """(state, why, anchor or None) for a .ots that should stamp digest_hex"""
    if ots_bytes is None:
        return "not_yet", "no .ots was served", None
    try:
        digest, atts = read_ots(ots_bytes)
    except Bad as e:
        return "fail", str(e), None
    if digest.hex() != digest_hex:
        return "fail", "the .ots stamps %s, not %s" % (digest.hex(), digest_hex), None
    btc = [a for a in atts if a.get("kind") == "bitcoin" and a.get("msg") is not None and len(a["msg"]) == 32]
    if not btc:
        return "not_yet", "the .ots has no Bitcoin attestation yet (pending)", None
    low = min(btc, key=lambda a: a["height"])
    return bitcoin_header(low["height"], low["msg"], get)


# ---- the record kinds ----
def _jcs_line(o):
    return json.dumps(o, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def slot_log_file(data):
    """an invinoveritas slot log day file, by its SPEC's rules (as slot-witness-v0/slot_check.py check_day_file).
    -> (header, raw header line, raw lines); raises Bad"""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        raise Bad("not UTF-8")
    if not text.endswith("\n"):
        raise Bad("not newline terminated")
    raw = text.split("\n")[:-1]
    if not raw:
        raise Bad("empty file")
    try:
        header = json.loads(raw[0])
    except ValueError:
        raise Bad("the header line is not JSON")
    if not isinstance(header, dict) or _jcs_line(header) != raw[0]:
        raise Bad("the header line is not canonical JSON")
    if header.get("schema") != SLOT_LOG_SCHEMA:
        raise Bad("the header schema is not " + SLOT_LOG_SCHEMA)
    lines = []
    for r in raw[1:]:
        try:
            x = json.loads(r)
        except ValueError:
            raise Bad("a line is not JSON")
        if not isinstance(x, dict) or _jcs_line(x) != r:
            raise Bad("a line is not canonical JSON")
        if sorted(x) != SLOT_LINE_KEYS or not isinstance(x.get("slot"), str) or not H64.fullmatch(x["slot"]) or x.get("scope") not in ("account", "decider"):
            raise Bad("a line does not have the SPEC's fields")
        lines.append(x)
    slots = [x["slot"] for x in lines]
    if any(not a < b for a, b in zip(slots, slots[1:])):
        raise Bad("slots are not strictly sorted")
    if header.get("n_slots") != len(lines):
        raise Bad("n_slots is %r, the file has %d lines" % (header.get("n_slots"), len(lines)))
    cut = header.get("cutoff")
    if not (isinstance(cut, int) and not isinstance(cut, bool)) or any(not isinstance(x.get("taken_at"), int) or x["taken_at"] >= cut for x in lines):
        raise Bad("a slot was taken at or after the cutoff")
    return header, raw[0], raw[1:]


def slot_merkle_root(raw_lines):
    """leaf = sha256(line); pair = sha256((left_hex + right_hex) as UTF-8); odd last node paired with itself"""
    level = [sha256hex(r) for r in raw_lines] or [sha256hex(SLOT_LOG_SCHEMA + "|empty")]
    while len(level) > 1:
        level = [sha256hex(level[i] + (level[i + 1] if i + 1 < len(level) else level[i])) for i in range(0, len(level), 2)]
    return level[0]


def _prev_day(d):
    return (datetime.date.fromisoformat(d) - datetime.timedelta(days=1)).isoformat()


def slot_log_urls(date, base=SLOT_LOG_BASE):
    return {"record": "%s/%s" % (base, date), "prev": "%s/%s" % (base, _prev_day(date)), "ots": "%s/%s.ots" % (base, date)}


def run_slot_log(f, get):
    """-> (steps [(name, state, why)], record_sha256, anchor)"""
    date = f["date"]
    if not _real_day(date):
        raise Bad("facts: date must be a real YYYY-MM-DD")
    u = slot_log_urls(date, f["base"])
    s, data = get(u["record"])
    if s != 200 or data is None:
        raise Bad("the day file was not read (http %s): nothing to recompute" % s)
    steps, rsha, anchor = [("bytes_sha256", "ok", "")], sha256hex(data), None
    try:
        header, hline, lines = slot_log_file(data)
        if header.get("date") != date:
            raise Bad("the header names %r, not %s" % (header.get("date"), date))
        steps.append(("entries_parse", "ok", ""))
    except Bad as e:
        steps.append(("entries_parse", "fail", str(e)))
        return steps, rsha, None
    root = slot_merkle_root(lines)
    steps.append(("merkle_root", "ok", "") if root == header.get("merkle_root") else ("merkle_root", "fail", "the lines fold to %s, the header names %s" % (root, header.get("merkle_root"))))
    log_root = sha256hex(hline)
    pr = header.get("prev_root")
    ps, pdata = get(u["prev"])
    if pr == SLOT_LOG_GENESIS and ps == 404:
        steps.append(("prev_root_chain", "ok", ""))
    elif ps != 200 or pdata is None:
        steps.append(("prev_root_chain", "not_yet", "the day before was not read (http %s)" % ps))
    else:
        try:
            ph, phline, _ = slot_log_file(pdata)
            if ph.get("date") != _prev_day(date):
                steps.append(("prev_root_chain", "fail", "the file of the day before names %r" % ph.get("date")))
            elif sha256hex(phline) != pr:
                steps.append(("prev_root_chain", "fail", "prev_root %s is not the log_root %s of the day before" % (pr, sha256hex(phline))))
            else:
                steps.append(("prev_root_chain", "ok", ""))
        except Bad as e:
            steps.append(("prev_root_chain", "fail", "the file of the day before: %s" % e))
    os_, odata = get(u["ots"])
    st, why, anchor = ots_step(odata if os_ == 200 else None, log_root, get)
    steps.append(("ots_anchor", st, why))
    return steps, rsha, anchor


def _sig_bytes(b):
    """a detached signature: 64 raw bytes, or text holding 128 hex or 88 base64 characters"""
    if b is None:
        raise Bad("no signature was served")
    if len(b) == 64:
        return b
    t = b.decode("ascii", "replace").strip()
    if H128.fullmatch(t.lower()):
        return bytes.fromhex(t)
    if SIG88.fullmatch(t):
        return base64.b64decode(t)
    raise Bad("the signature is neither 64 bytes, 128 hex nor 88 base64 characters")


def _sig_pub(f, get):
    if f.get("sig_pub"):
        return bytes.fromhex(f["sig_pub"])
    s, b = get(f["sig_key_url"])
    if s != 200:
        raise Bad("the signer's key URL answered http %s" % s)
    doc = json.loads(b.decode("utf-8"))
    if f["sig_alg"] == "ed25519":
        return b64d(doc.get("public_key_ed25519_b64"), 32)
    v = doc.get("public_key_bip340_hex") or doc.get("pubkey")
    if not isinstance(v, str) or not H64.fullmatch(v.lower()):
        raise Bad("the signer's key document has no 32 byte x-only key (public_key_bip340_hex or pubkey)")
    return bytes.fromhex(v)


def run_bytes(f, get):
    s, data = get(f["url"])
    if s != 200 or data is None:
        raise Bad("the record was not read (http %s): nothing to recompute" % s)
    steps, rsha, anchor = [("bytes_sha256", "ok", "")], sha256hex(data), None
    if f.get("ots_url"):
        os_, odata = get(f["ots_url"])
        st, why, anchor = ots_step(odata if os_ == 200 else None, rsha, get)
        steps.append(("ots_anchor", st, why))
    if f.get("sig_url"):
        try:
            ss, sb = get(f["sig_url"])
            sig = _sig_bytes(sb if ss == 200 else None)
            pub = _sig_pub(f, get)
            if f["sig_alg"] == "ed25519":
                ok = ed25519_verify(pub, data, sig)                              # over the record bytes
            else:
                ok = bip340_verify(pub, hashlib.sha256(data).digest(), sig)      # over sha256 of the record bytes
            steps.append(("signature", "ok", "") if ok else ("signature", "fail", "the %s signature does not verify" % f["sig_alg"]))
        except (Bad, ValueError, KeyError, TypeError, AttributeError) as e:
            steps.append(("signature", "fail", str(e)))
    return steps, rsha, anchor


# ---- facts: what fetch read, kept as bytes so build runs offline ----
def world_get(facts):
    w = facts["world"]

    def get(u):
        if u not in w:
            return None, None
        x = w[u]
        return x["status"], (base64.b64decode(x["b64"]) if x.get("b64") is not None else None)
    return get


def record_url_of(f):
    return slot_log_urls(f["date"], f["base"])["record"] if f["record_kind"] == "invinoveritas-slot-log" else f["url"]


def recompute(facts):
    """-> (steps, record_sha256, anchor). Raises Bad when there is nothing to recompute."""
    if not isinstance(facts, dict) or facts.get("schema") != FACTS_SCHEMA or facts.get("record_kind") not in STEPS:
        raise Bad("facts must be an %s file written by fetch" % FACTS_SCHEMA)
    get = world_get(facts)
    if facts["record_kind"] == "invinoveritas-slot-log":
        return run_slot_log(facts, get)
    return run_bytes(facts, get)


def build(facts, tool_sha, limits=None, name=WITNESS_NAME, key_url=WITNESS_KEY_URL):
    steps, rsha, anchor = recompute(facts)
    failed = [(n, why) for n, st, why in steps if st == "fail"]
    if failed:
        raise Bad("a step failed, so nothing is signed: " + "; ".join("%s: %s" % x for x in failed))
    ok = [n for n, st, _ in steps if st == "ok"]
    a = {"schema": SCHEMA, "kind": KIND, "subject_domain": facts["subject_domain"], "record_url": record_url_of(facts),
         "record_sha256": rsha, "record_kind": facts["record_kind"], "recomputed": ok,
         "anchor": anchor if "ots_anchor" in ok else None, "tool": "tools/outward/outward_witness.py sha256:" + tool_sha,
         "observed_at": facts["observed_at"], "limits": list(limits or DEFAULT_LIMITS), "witness": {"name": name, "key_id": "", "key_url": key_url}}
    return a, steps


# ---- shape and signature ----
def b64d(s, n):
    if not isinstance(s, str):
        raise Bad("base64 must be a string")
    b = base64.b64decode(s, validate=True)
    if len(b) != n or base64.b64encode(b).decode() != s:
        raise Bad("base64 must be the exact encoding of %d bytes" % n)
    return b


def key_id_of(pub):
    return "ed25519:" + hashlib.sha256(pub).hexdigest()[:16]


PKCS8_PREFIX = bytes.fromhex("302e020100300506032b657004220420")


def load_pem_seed(path):
    """an Ed25519 private key as written by: openssl genpkey -algorithm ed25519 -out key.pem"""
    with open(path, "r", encoding="ascii") as f:
        txt = f.read()
    m = re.search(r"-----BEGIN PRIVATE KEY-----(.+?)-----END PRIVATE KEY-----", txt, re.S)
    if not m:
        raise Bad("not a PKCS#8 PEM private key")
    der = base64.b64decode("".join(m.group(1).split()))
    if len(der) != 48 or not der.startswith(PKCS8_PREFIX):
        raise Bad("not an Ed25519 PKCS#8 key")
    return der[16:]


def _host(u):
    m = re.fullmatch(r"https://([a-z0-9.-]+)(/[^\s?#]*)?", u or "")
    return m.group(1) if m else None


def _own(host):
    return any(host == s or host.endswith("." + s) for s in OPERATOR_SUFFIXES)


def key_url_problem(u):
    """the witness of an outside-record answer is this project, so its own domain is the expected key_url"""
    if not isinstance(u, str) or not re.fullmatch(r"https://([a-z0-9.-]+)(/[^\s?#]*)", u):
        return "key_url must be https, lower-case host, no port, no query or fragment"
    if _host(u) in SHARED_HOSTS:
        return _host(u) + " serves many people's files and is not a witness identity"
    return None


def _line(s, what, mx=LINE_MAX):
    if not isinstance(s, str) or not s.strip() or len(s) > mx or s != s.strip() or any(ord(c) < 0x20 or ord(c) == 0x7F for c in s):
        raise Bad("%s must be one non-empty line (<= %d chars, no control characters, no outer spaces)" % (what, mx))


def _real_day(d):
    if not isinstance(d, str) or not DAY.fullmatch(d):
        return False
    try:
        datetime.date.fromisoformat(d)
        return True
    except ValueError:
        return False


def check_shape(a):
    if not isinstance(a, dict):
        raise Bad("the answer must be a JSON object")
    if a.get("schema") == V0_SCHEMA or a.get("kind") in V0_KINDS:
        raise Bad("furui-day and tooshi-day answers are witness-answer-v0: check them with witness_answer_v0.py")
    if sorted(a) != ANSWER_KEYS:
        raise Bad("the answer must carry exactly the keys " + ", ".join(ANSWER_KEYS))
    if a["schema"] != SCHEMA or a["kind"] != KIND:
        raise Bad("schema must be %s and kind %s" % (SCHEMA, KIND))
    d = a["subject_domain"]
    if not isinstance(d, str) or not DOMAIN.fullmatch(d):
        raise Bad("subject_domain must be a lower-case domain name")
    if _own(d):
        raise Bad("subject_domain is this project's own domain; an outside record is someone else's")
    if not isinstance(a["record_url"], str) or _host(a["record_url"]) is None or len(a["record_url"]) > LINE_MAX:
        raise Bad("record_url must be an https URL with a lower-case host")
    if not isinstance(a["record_sha256"], str) or not H64.fullmatch(a["record_sha256"]):
        raise Bad("record_sha256 must be 64 lower-case hex")
    if a["record_kind"] not in STEPS:
        raise Bad("record_kind must be one of " + ", ".join(STEPS))
    order = STEPS[a["record_kind"]]
    rc = a["recomputed"]
    if not isinstance(rc, list) or not rc or not all(isinstance(x, str) for x in rc) or any(x not in order for x in rc) \
            or rc != [x for x in order if x in rc] or rc[0] != "bytes_sha256":
        raise Bad("recomputed takes step names of %s, in its order, starting with bytes_sha256: %s" % (a["record_kind"], ", ".join(order)))
    an = a["anchor"]
    if "ots_anchor" in rc:
        if not isinstance(an, dict) or sorted(an) != ["block_hash", "block_height"] or not isinstance(an["block_height"], int) \
                or isinstance(an["block_height"], bool) or not 0 <= an["block_height"] <= 10 ** 8 or not isinstance(an["block_hash"], str) \
                or not H64.fullmatch(an["block_hash"]):
            raise Bad("anchor must be {block_height, block_hash} when ots_anchor is recomputed")
    elif an is not None:
        raise Bad("anchor must be null when ots_anchor is not recomputed")
    _line(a["tool"], "tool", 200)
    if not isinstance(a["observed_at"], str) or not ISO.fullmatch(a["observed_at"]) or not _real_day(a["observed_at"][:10]):
        raise Bad("observed_at must be YYYY-MM-DDTHH:MM:SSZ")
    lim = a["limits"]
    if not isinstance(lim, list) or not lim or len(lim) > LIMITS_MAX:
        raise Bad("limits must be a list of 1 to %d lines" % LIMITS_MAX)
    for x in lim:
        _line(x, "each limit")
    w = a["witness"]
    if not isinstance(w, dict) or sorted(w) != ["key_id", "key_url", "name"]:
        raise Bad("witness must be exactly {name, key_id, key_url}")
    _line(w["name"], "witness.name", NAME_MAX)
    if not isinstance(w["key_id"], str) or not KEY_ID.fullmatch(w["key_id"]):
        raise Bad("witness.key_id must be ed25519:<16 hex>")
    p = key_url_problem(w["key_url"])
    if p:
        raise Bad("witness.key_url: " + p)
    wh = _host(w["key_url"])
    if wh == d or wh.endswith("." + d) or d.endswith("." + wh):
        raise Bad("the witness key is served from the subject's own domain (self_witness)")
    s = a["signature"]
    if not isinstance(s, dict) or sorted(s) != ["alg", "key_id", "sig"] or s["alg"] != "ed25519":
        raise Bad("signature must be exactly {alg: ed25519, key_id, sig}")
    if s["key_id"] != w["key_id"]:
        raise Bad("signature.key_id must equal witness.key_id")
    if not isinstance(s["sig"], str) or not SIG88.fullmatch(s["sig"]):
        raise Bad("signature.sig must be 88 characters of base64 (64 bytes)")


def preimage(obj):
    return (SCHEMA + "\n" + canonical({k: v for k, v in obj.items() if k != "signature"})).encode("utf-8")


UNSIGNED = "A" * 86 + "=="


def finish(obj, pub, seed=None):
    if not key_ok(pub):
        raise Bad("the public key is not a valid prime-order Ed25519 point")
    kid = key_id_of(pub)
    obj["witness"]["key_id"] = kid
    obj["signature"] = {"alg": "ed25519", "key_id": kid, "sig": UNSIGNED}
    if seed is not None:
        if ed25519_public(seed) != pub:
            raise Bad("the private key does not match the public key")
        obj["signature"]["sig"] = base64.b64encode(ed25519_sign(seed, preimage(obj))).decode()
    return obj


def key_from_doc(doc):
    if not isinstance(doc, dict) or not isinstance(doc.get("public_key_ed25519_b64"), str):
        raise Bad("the key_url document must be {\"public_key_ed25519_b64\": ...}")
    pub = b64d(doc["public_key_ed25519_b64"], 32)
    if "key_id" in doc and doc["key_id"] != key_id_of(pub):
        raise Bad("the key document's key_id is not the key_id of its key")
    return pub


def verify(a, key_doc):
    """-> list of (step, ok, why); the same four steps as witness-answer-v0. No network here."""
    out = []

    def step(name, fn):
        try:
            fn()
            out.append((name, True, ""))
            return True
        except (Bad, ValueError, KeyError, TypeError) as e:
            out.append((name, False, str(e)))
            return False
    if not step("shape", lambda: check_shape(a)):
        return out
    holder = {}

    def k():
        holder["pub"] = key_from_doc(key_doc)
        if not key_ok(holder["pub"]):
            raise Bad("the key served at key_url is not a valid prime-order Ed25519 point")
    if not step("key_url_key", k):
        return out

    def kid():
        if key_id_of(holder["pub"]) != a["witness"]["key_id"]:
            raise Bad("witness.key_id is not the key_id of the key served at key_url")
    if not step("key_id", kid):
        return out

    def sig():
        if not ed25519_verify(holder["pub"], preimage(a), b64d(a["signature"]["sig"], 64)):
            raise Bad("the signature does not verify over the preimage")
    step("signature", sig)
    return out


def verified(a, key_doc):
    r = verify(a, key_doc)
    return len(r) == 4 and all(ok for _, ok, _ in r)


def record_date(a):
    """the date in the ledger entry's work line: the day of a slot log, else the day observed"""
    if a["record_kind"] == "invinoveritas-slot-log":
        m = re.search(r"/([0-9]{4}-[0-9]{2}-[0-9]{2})$", a["record_url"])
        if m:
            return m.group(1)
    return a["observed_at"][:10]


def ledger_seed(a, key_doc):
    """the body POST /ledger/append takes: the record is the signed answer itself, in canonical JSON"""
    if not verified(a, key_doc):
        raise Bad("the answer does not verify; nothing goes to the ledger")
    rc = canonical(a)
    return {"claim_sha256": sha256hex(rc), "record_canonical": rc, "work": SEED_WORK % (a["subject_domain"], a["record_kind"], record_date(a))}


# ---- the day of a month to witness, chosen by the ledger's head ----
def _chain_entry_sha(e):
    o = {k: e[k] for k in ("n", "schema", "claim_sha256", "created_at", "prev_entry_sha256") if e.get(k) is not None}
    return hashlib.sha256(json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")).hexdigest()


def head_before(export_lines, cutoff):
    """the entry_sha256 of the last entry created before cutoff, the chain recomputed from entry 1 (jidec-chain-v1)"""
    prev, best = "0" * 64, None
    want = 1
    for ln in export_lines:
        if not ln.strip():
            continue
        e = json.loads(ln)
        if e.get("schema") == "jidec-head-v1" and "head" in e:
            break
        if e.get("n") != want or e.get("prev_entry_sha256") != prev:
            raise Bad("the export breaks at entry %s" % e.get("n"))
        es = _chain_entry_sha(e)
        if e.get("entry_sha256") not in (None, es):
            raise Bad("entry %d: entry_sha256 does not recompute" % want)
        if not isinstance(e.get("created_at"), str) or e["created_at"][:19] + "Z" >= cutoff:
            break
        best, prev, want = (want, es), es, want + 1
    if best is None:
        raise Bad("no entry before " + cutoff)
    return best


def pick_day(export_lines, month, cutoff):
    """the day = (first 8 hex of the head's sha256, as a number) mod (days of month before the cutoff's date) + 1"""
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}", month) or not ISO.fullmatch(cutoff):
        raise Bad("--month YYYY-MM and --cutoff YYYY-MM-DDTHH:MM:SSZ")
    y, m = int(month[:4]), int(month[5:])
    last = calendar.monthrange(y, m)[1]
    cd = datetime.date.fromisoformat(cutoff[:10])
    days = [datetime.date(y, m, d) for d in range(1, last + 1) if datetime.date(y, m, d) < cd]
    if not days:
        raise Bad("no day of %s is before %s" % (month, cutoff))
    n, h = head_before(export_lines, cutoff)
    i = int(h[:8], 16) % len(days)
    return {"month": month, "cutoff": cutoff, "head_n": n, "head_entry_sha256": h, "days_counted": len(days),
            "rule": "int(head[:8], 16) mod days_counted + 1", "day": days[i].isoformat()}


# ---- network (fetch and verify --fetch only) ----
def http_get(u, limit, timeout=30):
    import urllib.error, urllib.request

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None
    if _host(u) is None:
        raise Bad("only https URLs with a lower-case host are read: " + u)
    op = urllib.request.build_opener(NoRedirect)
    req = urllib.request.Request(u, headers={"user-agent": "outward-witness/0.1", "accept": "*/*"})
    try:
        with op.open(req, timeout=timeout) as r:
            b = r.read(limit + 1)
            if len(b) > limit:
                raise Bad("%s is over %d bytes" % (u, limit))
            return r.status, b
    except urllib.error.HTTPError as e:
        return e.code, None
    except (urllib.error.URLError, OSError):
        return None, None


def _now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch(kind, opt, get=http_get, now=_now):
    """read what the record kind needs and keep it as bytes; the block headers are read for the .ots it finds"""
    world = {}

    def g(u, limit):
        if u in world:
            x = world[u]
            return x["status"], (base64.b64decode(x["b64"]) if x["b64"] is not None else None)
        s, b = get(u, limit)
        world[u] = {"status": s, "b64": base64.b64encode(b).decode() if b is not None else None}
        return s, b
    at = now()
    if kind == "invinoveritas-slot-log":
        date, base = opt["--date"], opt.get("--base", SLOT_LOG_BASE).rstrip("/")
        if not _real_day(date):
            raise Bad("--date must be a real YYYY-MM-DD")
        u = slot_log_urls(date, base)
        f = {"schema": FACTS_SCHEMA, "record_kind": kind, "subject_domain": opt.get("--subject", "invinoveritas.dev"), "date": date, "base": base}
        g(u["record"], MAX_RECORD)
        g(u["prev"], MAX_RECORD)
        s, ob = g(u["ots"], MAX_OTS)
    elif kind == "bytes":
        f = {"schema": FACTS_SCHEMA, "record_kind": kind, "subject_domain": opt["--subject"], "url": opt["--url"]}
        g(f["url"], MAX_RECORD)
        ob = None
        if "--ots-url" in opt:
            f["ots_url"] = opt["--ots-url"]
            s, ob = g(f["ots_url"], MAX_OTS)
        if "--sig-url" in opt:
            f.update(sig_url=opt["--sig-url"], sig_alg=opt["--sig-alg"])
            if f["sig_alg"] not in ("ed25519", "bip340"):
                raise Bad("--sig-alg ed25519 or bip340")
            g(f["sig_url"], MAX_SIG)
            if "--sig-pub" in opt:
                f["sig_pub"] = opt["--sig-pub"].lower()
            else:
                f["sig_key_url"] = opt["--sig-key-url"]
                g(f["sig_key_url"], 65536)
    else:
        raise Bad("record kinds: " + ", ".join(STEPS))
    if ob is not None:
        try:
            _, atts = read_ots(ob)
            btc = [a for a in atts if a.get("kind") == "bitcoin"]
            if btc:
                h = min(a["height"] for a in btc)
                hashes = []
                for name, eb in EXPLORERS:
                    s, b = g(eb + "/block-height/%d" % h, 4096)
                    t = b.decode("latin-1").strip() if s == 200 and b else ""
                    hashes.append(t if H64.fullmatch(t) else None)
                for (name, eb), t in zip(EXPLORERS, hashes):
                    if t:
                        g(eb + "/block/" + t + "/header", 4096)
        except Bad:
            pass   # build reports the .ots as it is
    f["observed_at"] = at
    f["world"] = world
    return f


def fetch_key_doc(u, get=http_get):
    p = key_url_problem(u)
    if p:
        raise Bad(p)
    s, b = get(u, 65536)
    if s != 200 or b is None:
        raise Bad("key_url answered %s" % s)
    return json.loads(b.decode("utf-8"))


# ---- command line ----
def _args(argv, multi=("--limit",), flags=("--fetch",)):
    pos, opt = [], {m: [] for m in multi}
    it = iter(argv)
    for x in it:
        if x in flags:
            opt[x] = True
        elif x.startswith("--"):
            v = next(it, None)
            if v is None:
                raise Bad("missing value for " + x)
            if x in multi:
                opt[x].append(v)
            else:
                opt[x] = v
        else:
            pos.append(x)
    return pos, opt


def _load(p):
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


def _write(p, o):
    with open(p, "w", encoding="utf-8") as f:
        f.write(json.dumps(o, ensure_ascii=False, sort_keys=True, indent=2) + "\n")


def _self_sha():
    import os
    with open(os.path.abspath(__file__), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    cmd, (pos, opt) = argv[0], _args(argv[1:])
    if cmd == "selftest":
        import importlib.util, os
        sp = importlib.util.spec_from_file_location("test_outward_witness", os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_outward_witness.py"))
        t = importlib.util.module_from_spec(sp)
        sys.modules[sp.name] = t
        sp.loader.exec_module(t)
        return t.run()
    if cmd == "fetch":
        f = fetch(pos[0] if pos else "", opt)
        _write(opt["--out"], f)
        print("facts %s: %s, %d URL(s) read at %s" % (opt["--out"], f["record_kind"], len(f["world"]), f["observed_at"]))
        for u, x in sorted(f["world"].items()):
            print("  %s %s" % (x["status"], u))
        return 0
    if cmd == "build":
        facts = _load(pos[0])
        try:
            obj, steps = build(facts, _self_sha(), opt["--limit"] or None)
        except Bad as e:
            for n, st, why in (recompute(facts)[0] if facts.get("schema") == FACTS_SCHEMA else []):
                print("%-8s %s%s" % (st, n, ": " + why if why else ""))
            raise
        for n, st, why in steps:
            print("%-8s %s%s" % (st, n, ": " + why if why else ""))
        if "--key" in opt:
            seed = load_pem_seed(opt["--key"])
            pub = ed25519_public(seed)
        elif "--pub" in opt:
            seed, pub = None, b64d(opt["--pub"], 32)
        else:
            raise Bad("give --key key.pem (sign here) or --pub <base64> (sign elsewhere, then attach-sig)")
        finish(obj, pub, seed)
        check_shape(obj)
        _write(opt["--out"], obj)
        print(("signed " if seed else "built, not signed yet (preimage, then attach-sig) ") + opt["--out"] + " key_id " + obj["witness"]["key_id"]
              + " record_sha256 " + obj["record_sha256"])
        return 0
    if cmd == "preimage":
        a = _load(pos[0])
        with open(opt["--out"], "wb") as f:
            f.write(preimage(a))
        print("preimage %s sha256 %s" % (opt["--out"], sha256hex(preimage(a))))
        return 0
    if cmd == "attach-sig":
        a = _load(pos[0])
        with open(opt["--sig-file"], "rb") as f:
            sg = f.read()
        if len(sg) != 64:
            raise Bad("the signature file must hold the 64 raw bytes")
        a["signature"]["sig"] = base64.b64encode(sg).decode()
        _write(opt["--out"], a)
        print("attached; run verify")
        return 0
    if cmd in ("verify", "ledger-body"):
        a = _load(pos[0])
        doc = fetch_key_doc(a["witness"]["key_url"]) if opt.get("--fetch") else _load(opt["--key-doc"])
        if cmd == "verify":
            res = verify(a, doc)
            for name, ok, why in res:
                print("%-4s %s%s" % ("ok" if ok else "FAIL", name, "" if ok else ": " + why))
            good = len(res) == 4 and all(ok for _, ok, _ in res)
            print("VERDICT " + ("signed_answer_ok witness %s subject %s recomputed %s" % (_host(a["witness"]["key_url"]), a["subject_domain"], ",".join(a["recomputed"])) if good else "not_ok"))
            return 0 if good else 1
        seed = ledger_seed(a, doc)
        _write(opt["--out"], seed)
        print("ledger body %s claim_sha256 %s work %s" % (opt["--out"], seed["claim_sha256"], seed["work"]))
        return 0
    if cmd == "pick-day":
        with open(opt["--export"], "r", encoding="utf-8") as f:
            print(json.dumps(pick_day(f.read().split("\n"), opt["--month"], opt["--cutoff"]), sort_keys=True))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except (Bad, KeyError, OSError, ValueError) as e:
        print("outward_witness: %s: %s" % (type(e).__name__, e))
        sys.exit(2)
