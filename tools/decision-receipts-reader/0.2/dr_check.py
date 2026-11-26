"""dr_check 0.2.1: a reader of draft-gruszka-audit-decision-receipts-11, written from the text of -11 only.

0.2.1 changes two readings of 0.2.0 after the author's answers of 22 November 2026 and nothing else: a Case 3
call without an outcome receipt gives no result (incomplete invocation; R-20 rewritten), and the binding of each
held receipt is an input of the call (R-18 rewritten). All other verdicts are those of 0.2.0, frozen before the
answers. See READINGS.md.

It checks decision receipts and outcome receipts by Sections 3.2 to 3.4 with the field rules of Section 3.8, in the
DSSE binding of Section 3.10 and the COSE_Sign1 binding of Appendix B, the approver signature of Section 3.11, the
relying-party check of Section 4 and the three checks over a set of receipts of Section 3.5.  Places where the text
reads two ways are listed in READINGS.md next to this file and are cited here only by their number (R-n).

Python standard library plus cryptography (Ed25519).  No network access.

The checking core takes one receipt (or one pair, for Case 3) and its inputs and returns the result and the failing
step: check_receipt(case, ctx) and set_checks(spec).  Reading the test package is kept apart (run_call, main): it
reads inputs-11.json, which make_inputs.py writes from the verifier calls of the package, and no expected result.

Usage:
  python3 -I -B dr_check.py --selftest
      runs small checks built only from the values printed in Appendix A of -11.
  python3 -I -B make_inputs.py <package_dir> inputs-11.json
      writes, for each of the 617 vectors, its name, the input file it comes from and its verifier call, and the
      SHA-256 (from MANIFEST.sha256) of every file those calls read.  It reads no expected result.
  python3 -I -B dr_check.py inputs-11.json <package_dir> <out_dir>
      runs each call and writes <out_dir>/gruszka11_verdicts.json, one result and step per vector.
"""
__version__ = "0.2.1"
import base64, hashlib, json, math, os, re, sys, traceback
from datetime import datetime
from decimal import Decimal
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from cryptography.exceptions import InvalidSignature

DRAFT = "draft-gruszka-audit-decision-receipts-11"
DEC_TYPE = "https://signed-evidence.org/receipts/decision/v0.1"   # 3.10, B.1
OUT_TYPE = "https://signed-evidence.org/receipts/outcome/v0.1"    # 3.10, B.1
STMT = "https://in-toto.io/Statement/v1"
PTYPE = "application/vnd.in-toto+json"
APPROVAL_CTX = b"approval-record-signature-v1"                    # 3.11.1
MAX_JSON_DEPTH = 64                                                # 3.1
MAX_CBOR_DEPTH = 32                                                # B.3 step 1
MAX_SAFE = 9007199254740991                                        # 3.2 step 4, 3.8
HEX64 = re.compile(r"[0-9a-f]{64}")


class Fail(Exception):
    """A failure named by its step, e.g. '3.2 step 4', '3.3 case 1', '3.4 step 5', 'approver signature',
    'Section 4 item 5'."""

    def __init__(self, step, why):
        super().__init__(step)
        self.step, self.why = step, why


class BindFail(Exception):
    """A failure in step n (1 to 6) of Section 3.2 as applied through a binding, before it is named."""

    def __init__(self, n, why):
        super().__init__(n)
        self.n, self.why = n, why


class InputError(Exception):
    """An input the verifier itself must supply is missing or malformed; not a result of a step."""


class Incomplete(Exception):
    """The call is incomplete in the sense of Section 3.1 as the author answered on 22 November 2026: the verifier
    gives no result (neither a pass nor a failing step). R-20, rewritten in 0.2.1."""


def sha(b):
    return hashlib.sha256(b).hexdigest()


def _nes(x):
    return isinstance(x, str) and x != ""


# ---------- JSON (RFC 8259), with the depth limit of Section 3.1 ----------
class JFrac(float):
    """A JSON number written with a frac or exp part (RFC 8259 Section 6).  Numbers written without them are int."""
    __slots__ = ()


class JSONError(ValueError):
    pass


_J_PLAIN = re.compile(r'[^"\\\x00-\x1f]+')
_J_NUM = re.compile(r"-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?")
_J_HEX4 = re.compile(r"[0-9A-Fa-f]{4}")
_J_ESC = {'"': '"', "\\": "\\", "/": "/", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t"}


class _JP:
    def __init__(self, t, maxdepth):
        self.t, self.i, self.n, self.maxdepth = t, 0, len(t), maxdepth

    def ws(self):
        t, i, n = self.t, self.i, self.n
        while i < n and t[i] in " \t\n\r":
            i += 1
        self.i = i

    def value(self, depth):
        if depth > self.maxdepth:
            raise JSONError("a value with depth greater than %d" % self.maxdepth)
        self.ws()
        if self.i >= self.n:
            raise JSONError("unexpected end")
        c = self.t[self.i]
        if c == "{":
            return self.obj(depth)
        if c == "[":
            return self.arr(depth)
        if c == '"':
            return self.string()
        for lit, val in (("true", True), ("false", False), ("null", None)):
            if self.t.startswith(lit, self.i):
                self.i += len(lit)
                return val
        m = _J_NUM.match(self.t, self.i)
        if m:
            self.i = m.end()
            if m.group(1) is None and m.group(2) is None:
                return int(m.group(0))
            return JFrac(float(m.group(0)))
        raise JSONError("unexpected character at %d" % self.i)

    def _expect_more(self):
        if self.i >= self.n:
            raise JSONError("unexpected end")

    def obj(self, depth):
        self.i += 1
        d = {}
        self.ws()
        if self.i < self.n and self.t[self.i] == "}":
            self.i += 1
            return d
        while True:
            self.ws()
            if self.i >= self.n or self.t[self.i] != '"':
                raise JSONError("member name expected at %d" % self.i)
            k = self.string()
            if k in d:
                raise JSONError("duplicate member name %r" % k)
            self.ws()
            if self.i >= self.n or self.t[self.i] != ":":
                raise JSONError("colon expected at %d" % self.i)
            self.i += 1
            d[k] = self.value(depth + 1)
            self.ws()
            self._expect_more()
            c = self.t[self.i]
            self.i += 1
            if c == ",":
                continue
            if c == "}":
                return d
            raise JSONError("comma or } expected at %d" % (self.i - 1))

    def arr(self, depth):
        self.i += 1
        a = []
        self.ws()
        if self.i < self.n and self.t[self.i] == "]":
            self.i += 1
            return a
        while True:
            a.append(self.value(depth + 1))
            self.ws()
            self._expect_more()
            c = self.t[self.i]
            self.i += 1
            if c == ",":
                continue
            if c == "]":
                return a
            raise JSONError("comma or ] expected at %d" % (self.i - 1))

    def string(self):
        t, n = self.t, self.n
        i = self.i + 1
        out = []
        while True:
            m = _J_PLAIN.match(t, i)
            if m:
                out.append(m.group(0))
                i = m.end()
            if i >= n:
                raise JSONError("unterminated string")
            c = t[i]
            if c == '"':
                self.i = i + 1
                return "".join(out)
            if c != "\\":
                raise JSONError("control character in a string at %d" % i)
            if i + 1 >= n:
                raise JSONError("unterminated escape")
            e = t[i + 1]
            if e in _J_ESC:
                out.append(_J_ESC[e])
                i += 2
                continue
            if e != "u" or not _J_HEX4.fullmatch(t[i + 2:i + 6]):
                raise JSONError("bad escape at %d" % i)
            cp = int(t[i + 2:i + 6], 16)
            i += 6
            if 0xD800 <= cp <= 0xDBFF and t.startswith("\\u", i) and _J_HEX4.fullmatch(t[i + 2:i + 6]):
                lo = int(t[i + 2:i + 6], 16)
                if 0xDC00 <= lo <= 0xDFFF:
                    cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00)
                    i += 6
            out.append(chr(cp))  # an unpaired surrogate is kept here; RFC 8785 refuses it (R-1)


def parse_json(data, maxdepth=MAX_JSON_DEPTH):
    """Strict UTF-8, one JSON text of RFC 8259, no duplicate member names, depth at most maxdepth (3.1)."""
    t = bytes(data).decode("utf-8") if isinstance(data, (bytes, bytearray)) else data
    p = _JP(t, maxdepth)
    v = p.value(0)
    p.ws()
    if p.i != p.n:
        raise JSONError("data after the JSON value")
    return v


# ---------- RFC 8785 ----------
def _jstr(s):
    o = ['"']
    m = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t"}
    for ch in s:
        if ch in m:
            o.append(m[ch])
        elif ord(ch) < 0x20:
            o.append("\\u%04x" % ord(ch))
        elif 0xD800 <= ord(ch) <= 0xDFFF:
            raise ValueError("unpaired surrogate (RFC 8785 Section 3.2.2.2)")
        else:
            o.append(ch)
    o.append('"')
    return "".join(o)


def es6num(f):
    """ECMAScript Number.prototype.toString of a double, as RFC 8785 Section 3.2.2.3."""
    if math.isnan(f) or math.isinf(f):
        raise ValueError("NaN or infinity")
    if f == 0:
        return "0"
    if f < 0:
        return "-" + es6num(-f)
    t = Decimal(repr(f)).normalize().as_tuple()
    digits = "".join(map(str, t.digits))
    k = len(digits)
    n = k + t.exponent
    if k <= n <= 21:
        return digits + "0" * (n - k)
    if 0 < n <= 21:
        return digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return "0." + "0" * (-n) + digits
    ex = n - 1
    return digits[0] + ("." + digits[1:] if k > 1 else "") + "e" + ("+" if ex >= 0 else "-") + str(abs(ex))


def jcs(v):
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, float):
        return es6num(v)
    if isinstance(v, int):  # 3.2 step 4: numbers are IEEE 754 doubles (RFC 8785 Section 3.1)
        try:
            f = float(v)
        except OverflowError:
            raise ValueError("number outside the range of a double")
        return es6num(f)
    if isinstance(v, str):
        return _jstr(v)
    if isinstance(v, list):
        return "[" + ",".join(jcs(x) for x in v) + "]"
    if isinstance(v, dict):
        for k in v:
            _jstr(k)
        ks = sorted(v, key=lambda k: k.encode("utf-16-be"))
        return "{" + ",".join(_jstr(k) + ":" + jcs(v[k]) for k in ks) + "}"
    raise ValueError("not a JSON value")


def jcsb(v):
    return jcs(v).encode("utf-8")


def _big_int(v):
    if v is None or isinstance(v, (bool, float, str)):
        return False
    if isinstance(v, int):
        return abs(v) > MAX_SAFE
    if isinstance(v, list):
        return any(_big_int(x) for x in v)
    if isinstance(v, dict):
        return any(_big_int(x) for x in v.values())
    return False


def step4_canonical(P):
    """Section 3.2 step 4 on payload bytes P; returns the parsed value or raises ValueError."""
    try:
        val = parse_json(P)
    except Exception as e:
        raise ValueError("P does not parse: %s" % e)
    try:
        c = jcsb(val)
    except Exception as e:
        raise ValueError("no RFC 8785 serialization: %s" % e)
    if c != P:
        raise ValueError("P is not its own RFC 8785 serialization")
    if _big_int(val):
        raise ValueError("an integer literal whose absolute value is greater than 9007199254740991")
    return val


# ---------- base64 of 3.10 step 2 ----------
_B64 = re.compile(r"[A-Za-z0-9+/]*={0,2}")


def b64strict(x):
    """Alphabet of RFC 4648 Section 4 and padding only, length a multiple of four, pad bits zero."""
    if not isinstance(x, str) or len(x) % 4 or not _B64.fullmatch(x):
        raise ValueError("base64 form")
    b = base64.b64decode(x, validate=True)
    if base64.b64encode(b).decode("ascii") != x:
        raise ValueError("base64 pad bits or padding")
    return b


# ---------- timestamps of 3.8 ----------
_TS = re.compile(r"([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,6}))?Z")


def ts(s):
    """3.8 timestamp; compared by full value, the fraction padded with zeros to six digits (Section 3)."""
    m = _TS.fullmatch(s) if isinstance(s, str) else None
    if not m:
        raise ValueError("timestamp form")
    y, mo, d, h, mi, se = (int(m.group(i)) for i in range(1, 7))
    if y < 1 or se > 59:
        raise ValueError("timestamp year or second")
    return datetime(y, mo, d, h, mi, se, int((m.group(7) or "").ljust(6, "0")))


def is_ts(x):
    try:
        ts(x)
    except (ValueError, TypeError):
        return False
    return True


def is_digest(x):
    return isinstance(x, dict) and set(x) == {"sha256"} and isinstance(x["sha256"], str) and bool(
        HEX64.fullmatch(x["sha256"]))


# ---------- Ed25519 (RFC 8032) with the rules of 3.2 step 3 and 3.11.3 check 5 ----------
_P = 2 ** 255 - 19
_L = 2 ** 252 + 27742317777372353535851937790883648493
_D = -121665 * pow(121666, _P - 2, _P) % _P
_SQRTM1 = pow(2, (_P - 1) // 4, _P)
_O = (0, 1, 1, 0)


def _pt_add(A, B):
    X1, Y1, Z1, T1 = A
    X2, Y2, Z2, T2 = B
    a = (Y1 - X1) * (Y2 - X2) % _P
    b = (Y1 + X1) * (Y2 + X2) % _P
    c = T1 * 2 * _D * T2 % _P
    d = Z1 * 2 * Z2 % _P
    e, f, g, h = b - a, d - c, d + c, b + a
    return (e * f % _P, g * h % _P, f * g % _P, e * h % _P)


def _pt_mul(s, A):
    Q = _O
    while s > 0:
        if s & 1:
            Q = _pt_add(Q, A)
        A = _pt_add(A, A)
        s >>= 1
    return Q


def _pt_eq(A, B):
    return (A[0] * B[2] - B[0] * A[2]) % _P == 0 and (A[1] * B[2] - B[1] * A[2]) % _P == 0


def _pt_is_identity(A):
    return _pt_eq(A, _O)


def _pt_decode(b):
    """RFC 8032 Section 5.1.3 (used by 5.1.7): None where the 32 bytes do not decode."""
    if not isinstance(b, (bytes, bytearray)) or len(b) != 32:
        return None
    y = int.from_bytes(b, "little")
    sign = y >> 255
    y &= (1 << 255) - 1
    if y >= _P:
        return None
    x2 = (y * y - 1) * pow(_D * y * y + 1, _P - 2, _P) % _P
    if x2 == 0:
        if sign:
            return None
        x = 0
    else:
        x = pow(x2, (_P + 3) // 8, _P)
        if (x * x - x2) % _P != 0:
            x = x * _SQRTM1 % _P
        if (x * x - x2) % _P != 0:
            return None
        if (x & 1) != sign:
            x = _P - x
    return (x, y, 1, x * y % _P)


_G = _pt_decode(bytes.fromhex("5866666666666666666666666666666666666666666666666666666666666666"))
_KEY_OK = {}


def key_ok(raw):
    """3.2 step 3: the expected key decodes, is not the identity point, and L times it is the identity point."""
    raw = bytes(raw)
    if raw not in _KEY_OK:
        A = _pt_decode(raw)
        _KEY_OK[raw] = A is not None and not _pt_is_identity(A) and _pt_is_identity(_pt_mul(_L, A))
    return _KEY_OK[raw]


def _pure_equation(raw, sig, msg):
    """[S]B = R + [k]A without the cofactor 8, computed here; used only as a cross-check of cryptography."""
    A, R = _pt_decode(raw), _pt_decode(sig[:32])
    if A is None or R is None:
        return False
    S = int.from_bytes(sig[32:], "little")
    if S >= _L:
        return False
    k = int.from_bytes(hashlib.sha512(sig[:32] + raw + msg).digest(), "little") % _L
    return _pt_eq(_pt_mul(S, _G), _pt_add(R, _pt_mul(k, A)))


ED_DISAGREE = []


def ed25519_verify(raw, sig, msg):
    """True where sig is 64 bytes, S < L, the key meets key_ok, R decodes, and the group equation holds.
    The equation is decided by cryptography; a disagreement with _pure_equation is recorded in ED_DISAGREE."""
    if not (isinstance(sig, (bytes, bytearray)) and len(sig) == 64):
        return False
    sig, raw = bytes(sig), bytes(raw)
    if int.from_bytes(sig[32:], "little") >= _L:
        return False
    if not key_ok(raw):
        return False
    if _pt_decode(sig[:32]) is None:
        return False
    try:
        Ed25519PublicKey.from_public_bytes(raw).verify(sig, msg)
        lib = True
    except InvalidSignature:
        lib = False
    pure = _pure_equation(raw, sig, msg)
    if pure != lib:
        ED_DISAGREE.append({"key": base64.b64encode(raw).decode(), "sig": base64.b64encode(sig).decode(),
                            "msg_sha256": sha(msg), "cryptography": lib, "equation": pure})
    return lib


def pae(c, body):
    """'DSSEv1' SP LEN(c) SP c SP LEN(body) SP body (3.10 step 3, 3.11.1 step 3)."""
    return b"DSSEv1 " + str(len(c)).encode() + b" " + c + b" " + str(len(body)).encode() + b" " + body


# ---------- CBOR in the core deterministic encoding (B.3 step 1) ----------
class CBORError(ValueError):
    pass


class CTag:
    def __init__(self, tag, item):
        self.tag, self.item = tag, item


class CMap:
    """A decoded CBOR map.  Keys: ('i', int), ('t', str) or ('raw', encoded bytes) for any other key."""

    def __init__(self):
        self.d = {}

    def keys(self):
        return list(self.d)

    def get(self, k, dflt=None):
        return self.d.get(k, dflt)


_I64MAX = 2 ** 63 - 1


def _cb_arg(b, i, ai):
    if ai < 24:
        return ai, i
    if ai in (24, 25, 26, 27):
        n = 1 << (ai - 24)
        if i + n > len(b):
            raise CBORError("truncated argument")
        v = int.from_bytes(b[i:i + n], "big")
        if v < (24, 256, 65536, 1 << 32)[ai - 24]:
            raise CBORError("argument not in its shortest form")
        return v, i + n
    raise CBORError("indefinite length or reserved additional information")


def _cb_key(item, raw):
    if isinstance(item, bool) or item is None:
        return ("raw", raw)
    if isinstance(item, int):
        return ("i", item)
    if isinstance(item, str):
        return ("t", item)
    return ("raw", raw)


def _cb(b, i, depth, outer_tag):
    if depth > MAX_CBOR_DEPTH:
        raise CBORError("an item with depth greater than %d" % MAX_CBOR_DEPTH)
    if i >= len(b):
        raise CBORError("truncated")
    ib = b[i]
    mt, ai = ib >> 5, ib & 31
    i += 1
    if mt == 7:
        if ai == 20:
            return False, i
        if ai == 21:
            return True, i
        if ai == 22:
            return None, i
        raise CBORError("floating-point value, break or simple value other than false, true and null")
    v, i = _cb_arg(b, i, ai)
    if mt in (0, 1):
        if v > _I64MAX:
            raise CBORError("integer outside the range of a signed 64-bit integer")
        return (v if mt == 0 else -1 - v), i
    if mt in (2, 3):
        if i + v > len(b):
            raise CBORError("truncated string")
        s = bytes(b[i:i + v])
        i += v
        if mt == 2:
            return s, i
        try:
            return s.decode("utf-8"), i
        except UnicodeDecodeError:
            raise CBORError("text string not valid UTF-8")  # R-13
    if mt == 4:
        out = []
        for _ in range(v):
            x, i = _cb(b, i, depth + 1, None)
            out.append(x)
        return out, i
    if mt == 5:
        m, last = CMap(), None
        for _ in range(v):
            k0 = i
            k, i = _cb(b, i, depth + 1, None)
            raw = bytes(b[k0:i])
            if last is not None and raw <= last:
                raise CBORError("map keys duplicated or not in the bytewise order of their encoding")
            last = raw
            val, i = _cb(b, i, depth + 1, None)
            m.d[_cb_key(k, raw)] = val
        return m, i
    if outer_tag is None or depth != 0 or v != outer_tag:
        raise CBORError("tag %d not allowed here" % v)
    x, i = _cb(b, i, depth + 1, None)
    return CTag(v, x), i


def cbor_decode(b, outer_tag=None):
    item, i = _cb(b, 0, 0, outer_tag)
    if i != len(b):
        raise CBORError("bytes after the data item")
    return item


def _cb_head(mt, n):
    if n < 24:
        return bytes([(mt << 5) | n])
    for ai, size in ((24, 1), (25, 2), (26, 4), (27, 8)):
        if n < (1 << (8 * size)):
            return bytes([(mt << 5) | ai]) + n.to_bytes(size, "big")
    raise ValueError("argument too large")


def cbor_encode(v):
    """Core deterministic encoding, for the Sig_structure of B.3 step 3 (and for the self-test)."""
    if v is False:
        return b"\xf4"
    if v is True:
        return b"\xf5"
    if v is None:
        return b"\xf6"
    if isinstance(v, int):
        return _cb_head(0, v) if v >= 0 else _cb_head(1, -1 - v)
    if isinstance(v, (bytes, bytearray)):
        return _cb_head(2, len(v)) + bytes(v)
    if isinstance(v, str):
        e = v.encode("utf-8")
        return _cb_head(3, len(e)) + e
    if isinstance(v, list):
        return _cb_head(4, len(v)) + b"".join(cbor_encode(x) for x in v)
    if isinstance(v, dict):
        items = sorted((cbor_encode(k), cbor_encode(x)) for k, x in v.items())
        return _cb_head(5, len(items)) + b"".join(k + x for k, x in items)
    if isinstance(v, CTag):
        return _cb_head(6, v.tag) + cbor_encode(v.item)
    raise ValueError("not encodable")


# ---------- URI of RFC 3986, for StringOrURI of RFC 8392 Section 2 (B.2, B.3 step 1) ----------
def _uri_re():
    unres = r"A-Za-z0-9\-._~"
    sub = r"!$&'()*+,;="
    pct = r"%[0-9A-Fa-f]{2}"
    pchar = r"(?:[" + unres + sub + r":@]|" + pct + r")"
    scheme = r"[A-Za-z][A-Za-z0-9+\-.]*"
    userinfo = r"(?:[" + unres + sub + r":]|" + pct + r")*"
    dec = r"(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])"
    v4 = dec + r"(?:\." + dec + r"){3}"
    h16 = r"[0-9A-Fa-f]{1,4}"
    ls32 = r"(?:" + h16 + ":" + h16 + "|" + v4 + ")"

    def rep(n):
        return r"(?:" + h16 + r":){" + str(n) + "}"

    def upto(n):
        return r"(?:(?:" + h16 + r":){0," + str(n) + "}" + h16 + r")?"

    v6 = "|".join([
        rep(6) + ls32,
        "::" + rep(5) + ls32,
        r"(?:" + h16 + r")?::" + rep(4) + ls32,
        upto(1) + "::" + rep(3) + ls32,
        upto(2) + "::" + rep(2) + ls32,
        upto(3) + "::" + rep(1) + ls32,
        upto(4) + "::" + ls32,
        upto(5) + "::" + h16,
        upto(6) + "::",
    ])
    vfut = r"v[0-9A-Fa-f]+\.[" + unres + sub + r":]+"
    host = r"(?:\[(?:" + v6 + "|" + vfut + r")\]|" + v4 + r"|(?:[" + unres + sub + r"]|" + pct + r")*)"
    authority = r"(?:" + userinfo + r"@)?" + host + r"(?::[0-9]*)?"
    seg, segnz = pchar + "*", pchar + "+"
    hier = (r"(?://" + authority + r"(?:/" + seg + r")*|/(?:" + segnz + r"(?:/" + seg + r")*)?|"
            + segnz + r"(?:/" + seg + r")*|)")
    q = r"(?:" + pchar + r"|[/?])*"
    return re.compile(scheme + ":" + hier + r"(?:\?" + q + r")?(?:#" + q + r")?")


_URI = _uri_re()


def string_or_uri(s):
    """RFC 8392 Section 2 (RFC 7519): any string, but a value that contains ':' must be a URI (R-12)."""
    return isinstance(s, str) and (":" not in s or bool(_URI.fullmatch(s)))


# ---------- bindings: steps 1, 2, 3 and 6 of Section 3.2 ----------
class DSSEBinding:
    """Section 3.10."""
    name = "dsse"

    @staticmethod
    def step1(rb):
        rb = bytes(rb)
        if rb.startswith(b"\xef\xbb\xbf"):
            raise BindFail(1, "envelope begins with the byte order mark")
        try:
            env = parse_json(rb)
        except Exception as e:
            raise BindFail(1, "envelope is not one JSON text: %s" % e)
        if not isinstance(env, dict):
            raise BindFail(1, "envelope is not an object")
        for k in ("payload", "payloadType", "signatures"):
            if k not in env:
                raise BindFail(1, "envelope lacks " + k)
        if env["payloadType"] != PTYPE:
            raise BindFail(1, "payloadType is not " + PTYPE)
        if not isinstance(env["signatures"], list):
            raise BindFail(1, "signatures is not an array")
        for s in env["signatures"]:
            if not (isinstance(s, dict) and isinstance(s.get("sig"), str)):
                raise BindFail(1, "an entry of signatures is not an object whose sig is a string")
        return env

    @staticmethod
    def step2(env):
        try:
            return b64strict(env["payload"])  # a payload that is not a string fails here (R-3)
        except Exception:
            raise BindFail(2, "payload is not base64 in the form of 3.10 step 2")

    @staticmethod
    def step3(env, P, keys):
        m = pae(env["payloadType"].encode("utf-8"), P)
        for s in env["signatures"]:
            try:
                sig = b64strict(s["sig"])
            except Exception:
                continue  # a sig in another form counts as a signature that does not verify
            for raw in keys:  # R-2, R-4
                if ed25519_verify(raw, sig, m):
                    return raw
        raise BindFail(3, "no entry of signatures verifies under the expected key")

    @staticmethod
    def step6(env, val, kind):
        want = DEC_TYPE if kind == "decision" else OUT_TYPE
        if not isinstance(val, dict):
            raise BindFail(6, "the Statement is not an object")
        if val.get("_type") != STMT:
            raise BindFail(6, "_type")
        if val.get("predicateType") != want:
            raise BindFail(6, "predicateType is not the %s receipt type" % kind)
        if "predicate" not in val:
            raise BindFail(6, "no predicate")
        pred = val["predicate"]
        if not isinstance(pred, dict):
            raise BindFail(6, "predicate is not an object")
        subj = val.get("subject")
        if not isinstance(subj, list) or len(subj) != 1 or not isinstance(subj[0], dict):
            raise BindFail(6, "subject does not have exactly one entry")
        d = subj[0].get("digest")
        h = sha(jcsb(pred))
        if not isinstance(d, dict) or d.get("sha256") != h:
            raise BindFail(6, "subject digest.sha256 is not SHA-256 of the RFC 8785 serialization of predicate")
        return pred, h


class COSEBinding:
    """Appendix B."""
    name = "cose"
    PROT = {("i", 1), ("i", 3), ("i", 4), ("i", 15)}

    @staticmethod
    def step1(rb):
        try:
            item = cbor_decode(bytes(rb), outer_tag=18)
        except CBORError as e:
            raise BindFail(1, "CBOR: %s" % e)
        if not (isinstance(item, CTag) and item.tag == 18):
            raise BindFail(1, "not a COSE_Sign1 message with tag 18")
        a = item.item
        if not (isinstance(a, list) and len(a) == 4):
            raise BindFail(1, "COSE_Sign1 is not an array of four")
        prot, unprot, payload, sig = a
        if not isinstance(prot, bytes) or not isinstance(unprot, CMap) or not (
                payload is None or isinstance(payload, bytes)) or not isinstance(sig, bytes):
            raise BindFail(1, "COSE_Sign1 member types")
        try:
            ph = cbor_decode(prot)
        except CBORError as e:
            raise BindFail(1, "protected header: %s" % e)
        if not isinstance(ph, CMap) or set(ph.keys()) != COSEBinding.PROT:
            raise BindFail(1, "protected header does not hold exactly alg, content type, kid and CWT Claims")
        alg = ph.get(("i", 1))
        if type(alg) is not int or alg != -8:
            raise BindFail(1, "alg is not -8")
        if ph.get(("i", 3)) != "application/json":
            raise BindFail(1, "content type is not application/json")
        kid = ph.get(("i", 4))
        if not (isinstance(kid, bytes) and len(kid) > 0):
            raise BindFail(1, "kid is not a non-empty byte string")
        cwt = ph.get(("i", 15))
        if not isinstance(cwt, CMap) or set(cwt.keys()) != {("i", 1), ("i", 2)}:
            raise BindFail(1, "CWT Claims do not hold exactly iss and sub")
        iss, sub = cwt.get(("i", 1)), cwt.get(("i", 2))
        for n, v in (("iss", iss), ("sub", sub)):
            if not _nes(v):
                raise BindFail(1, n + " is not a non-empty text string")
            if not string_or_uri(v):
                raise BindFail(1, n + " is not in the StringOrURI form (contains ':' and is not a URI)")
        if not 1 <= len(iss) <= 8192:
            raise BindFail(1, "iss is longer than 8192 code points")
        for k in unprot.keys():
            if k[0] not in ("i", "t"):
                raise BindFail(1, "unprotected header label is not an integer or a text string")
            if k == ("i", 2):
                raise BindFail(1, "unprotected header holds crit")
            if k in COSEBinding.PROT:
                raise BindFail(1, "unprotected header repeats a label of the protected header")
        return {"prot": prot, "payload": payload, "sig": sig, "iss": iss, "sub": sub}

    @staticmethod
    def step2(c):
        if c["payload"] is None:
            raise BindFail(2, "payload is nil")
        return c["payload"]

    @staticmethod
    def step3(c, P, keys):
        if len(c["sig"]) != 64:
            raise BindFail(3, "signature is not 64 bytes")
        m = cbor_encode(["Signature1", c["prot"], b"", P])
        for raw in keys:  # R-2
            if ed25519_verify(raw, c["sig"], m):
                return raw
        raise BindFail(3, "signature does not verify under the expected key")

    @staticmethod
    def step6(c, val, kind):
        want, idn, pre = ((DEC_TYPE, "decisionId", "decision:") if kind == "decision"
                          else (OUT_TYPE, "outcomeId", "outcome:"))
        if not isinstance(val, dict) or set(val) != {"predicate", "type"}:
            raise BindFail(6, "P is not an object with exactly predicate and type")
        if val["type"] != want:
            raise BindFail(6, "type is not the %s receipt type" % kind)
        pred = val["predicate"]
        if not isinstance(pred, dict):
            raise BindFail(6, "predicate is not an object")
        if not _nes(pred.get(idn)):
            raise BindFail(6, "predicate has no %s as a non-empty string" % idn)
        if c["sub"] != pre + pred[idn]:
            raise BindFail(6, "sub is not %s followed by %s" % (pre, idn))
        return pred, sha(jcsb(pred))


BINDINGS = {"dsse": DSSEBinding, "cose": COSEBinding}


def binding_of(name):
    b = BINDINGS.get(name)
    if b is None:
        raise InputError("unknown binding %r" % (name,))
    return b


def steps_1_to_5(rb, binding, keys):
    """Section 3.2 steps 1 to 5.  Returns (container, P, parsed value, R, key); raises BindFail(n)."""
    b = binding_of(binding)
    c = b.step1(rb)
    P = b.step2(c)
    k = b.step3(c, P, keys)
    try:
        val = step4_canonical(P)
    except ValueError as e:
        raise BindFail(4, str(e))
    return c, P, val, sha(P), k


def steps_1_to_6(rb, binding, keys, kind):
    """Section 3.2 steps 1 to 6 (or 1 to 5 and 3.4 step 2).  Returns a dict; raises BindFail(n)."""
    c, P, val, R, k = steps_1_to_5(rb, binding, keys)
    pred, pdig = binding_of(binding).step6(c, val, kind)
    return {"P": P, "R": R, "key": k, "pred": pred, "pdig": pdig, "kind": kind}


# ---------- Section 3.8 field rules (Figures 1 and 2) ----------
REL = [  # rows of relationships, the same in both figures
    ("relationships", "arr_obj_1_64", False, False),
    ("relationships[].relation", "enum:supersedes,revises,corrects,retracts,renews,derivedFrom,amends", True, False),
    ("relationships[].targetReceiptDigest", "relationDigest", True, False),
    ("relationships[].targetSubjectDigest", "relationDigest", False, False),
    ("relationships[].reason", "str", False, False),
    ("relationships[].reasonCode",
     "enum:correction,rerun,data-update,methodology-update,policy-change,withdrawal,other", False, False),
    ("relationships[].declaredAt", "ts", False, False),
]
# (path, type, required, null allowed)
DEC_TABLE = [
    ("schemaVersion", "ver", True, False),
    ("decisionId", "nes", True, False),
    ("decisionType", "const:preActionAuthorization", True, False),
    ("decidedAt", "ts", True, False),
    ("recordedAt", "ts", False, False),
    ("decisionMaker", "obj", True, False),
    ("decisionMaker.id", "nes", True, False),
    ("decisionMaker.version", "any", False, True),
    ("agent", "obj", True, False),
    ("agent.id", "nes", True, False),
    ("agent.version", "str", False, False),
    ("agent.configurationDigest", "digest", False, False),
    ("principal", "obj", True, False),
    ("principal.id", "nes", True, False),
    ("principal.authnContextRef", "obj", False, False),
    ("principal.authnContextRef.uri", "str", False, False),
    ("principal.authnContextRef.digest", "digest", False, False),
    ("delegationRefs", "arr_any", False, False),
    ("proposedAction", "obj", True, False),
    ("proposedAction.actionType", "str", True, False),
    ("proposedAction.target", "obj", False, False),
    ("proposedAction.target.name", "str", False, False),
    ("proposedAction.target.uri", "str", False, False),
    ("proposedAction.target.digest", "digest", False, False),
    ("proposedAction.method", "str", False, False),
    ("proposedAction.parametersDigest", "digest", False, False),  # note (1)
    ("proposedAction.parametersRef", "open", False, False),        # note (1)
    ("proposedAction.parametersSchemaRef", "obj", False, False),
    ("proposedAction.parametersSchemaRef.uri", "str", False, False),
    ("proposedAction.parametersSchemaRef.digest", "digest", False, False),
    ("inputSnapshot", "arr_obj", True, False),
    ("inputSnapshot[].name", "str", False, False),
    ("inputSnapshot[].uri", "str", False, False),
    ("inputSnapshot[].digest", "digest", True, False),
    ("inputSnapshot[].mediaType", "str", False, False),
    ("policyBoundary", "obj", True, False),
    ("policyBoundary.policyEngine", "nes", True, False),
    ("policyBoundary.policyId", "nes", True, False),
    ("policyBoundary.decisionPath", "nes", True, False),
    ("policyBoundary.policyDigest", "digest", True, False),
    ("policyBoundary.bundleRevision", "str", False, False),
    ("policyBoundary.validFrom", "ts", False, False),
    ("policyBoundary.validUntil", "ts", False, False),
    ("evidenceRefs", "arr_obj", True, False),
    ("evidenceRefs[].relation", "str", True, False),
    ("evidenceRefs[].digest", "digest", True, False),
    ("evidenceRefs[].artifactDigest", "digest", False, False),
    ("evidenceRefs[].uri", "str", False, False),
    ("evidenceRefs[].predicateType", "str", False, False),
    ("evidenceRefs[].typedDigest", "typedDigest", False, False),
    ("decision", "obj", True, False),
    ("decision.verdict", "enum:ALLOW,DENY,REFUSE,ESCALATE,DEFER,OBSERVE", True, False),  # note (2)
    ("decision.reasonCodes", "nearr_nes", True, False),
    ("decision.humanReadableSummary", "str", False, False),
    ("decision.obligations", "arr_any", False, False),
    ("decision.allowedScope", "arr_any", False, False),
    ("notChecked", "arr_obj_or_str", True, False),
    ("notChecked[].field", "str", False, False),
    ("notChecked[].reason", "str", False, False),
    ("notChecked[].impact", "str", False, False),
    ("decisionChangeConditions", "arr_obj", True, False),
    ("decisionChangeConditions[].conditionType", "str", False, False),
    ("decisionChangeConditions[].description", "str", False, False),
    ("decisionChangeConditions[].requiredEvidenceType", "str", False, False),
    ("actionOutcome", "obj", False, False),
    ("actionOutcome.status", "enum:notAttempted,blocked,refused,attempted,executed,failed,unknown", False, False),
    ("actionOutcome.performedAt", "ts", False, True),
    ("actionOutcome.outcomeRef", "obj", False, True),
    ("actionOutcome.outcomeRef.uri", "str", False, False),
    ("actionOutcome.outcomeRef.digest", "digest", False, False),
    ("traceContext", "open", False, False),
    ("privacy", "obj", True, False),
    ("privacy.rawInputsIncluded", "bool", True, False),
    ("privacy.redactionProfile", "str", False, False),
    ("privacy.erased", "arr_any", False, False),
    ("privacy.masked", "arr_any", False, False),
    ("validity", "obj", True, False),
    ("validity.audience", "nearr_nes", True, False),
    ("validity.nonce", "nes", True, False),
    ("validity.expiresAt", "ts", True, False),
] + REL

OUT_TABLE = [
    ("schemaVersion", "ver", True, False),
    ("outcomeId", "nes", True, False),
    ("decisionRef", "digest", True, False),
    ("executor", "obj", True, False),
    ("executor.id", "nes", True, False),
    ("executor.keyId", "str", False, False),
    ("requestedActionDigest", "digest", True, False),
    ("status", "enum:executed,refused,failed,partial", True, False),  # note (4)
    ("performedAt", "ts", True, False),
    ("effectDigest", "digest", False, False),
    ("actualActionDigest", "digest", False, False),
    ("responseDigest", "digest", False, False),
    ("policyPurpose", "const:outcome", False, False),
    ("receiverRefs", "arr_obj", False, False),
    ("receiverRefs[].relation", "nes", True, False),
    ("receiverRefs[].digest", "digest", True, False),
    ("receiverRefs[].receiverId", "str", False, False),
    ("receiverRefs[].receiverKeyId", "str", False, False),
    ("receiverRefs[].artifactDigest", "digest", False, False),
    ("sequence", "obj", False, False),
    ("sequence.runId", "nes", True, False),
    ("sequence.seq", "int0", True, False),
    ("recordedAt", "ts", False, False),
    ("limitations", "arr_str", False, False),
    ("traceContext", "obj", False, False),
    ("traceContext.traceparent", "str", False, False),
    ("validity", "obj", False, False),
    ("validity.audience", "arr_any", False, False),
    ("validity.nonce", "str", False, False),
] + REL

_VER = re.compile(r"0\.1\.[0-9]+")


def _children(table):
    ch = {}
    for path, typ, req, nul in table:
        parent, name = path.rsplit(".", 1) if "." in path else ("", path)
        ch.setdefault(parent, []).append((name, path, typ, req, nul))
    return ch


DEC_CH = _children(DEC_TABLE)
OUT_CH = _children(OUT_TABLE)


def _no_null(v, where, step):
    if v is None:
        raise Fail(step, "null inside " + where)
    if isinstance(v, dict):
        for k, x in v.items():
            _no_null(x, where + "." + k, step)
    elif isinstance(v, list):
        for i, x in enumerate(v):
            _no_null(x, "%s[%d]" % (where, i), step)


def _check_obj(obj, parent, ch, step, where):
    rows = ch.get(parent, [])
    for name, path, typ, req, nul in rows:
        if name not in obj:
            if req:
                raise Fail(step, "missing " + where + name)
            continue
        v = obj[name]
        if v is None:
            if not nul:
                raise Fail(step, "null not allowed at " + where + name)
            continue
        _check_val(v, path, typ, ch, step, where + name)
    extra = sorted(set(obj) - {r[0] for r in rows})
    if extra:
        raise Fail(step, "member not allowed: " + ",".join(where + e for e in extra))


def _is_int0(v):
    return isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= MAX_SAFE


def _check_val(v, path, typ, ch, step, where):
    def bad():
        return Fail(step, "%s is not %s" % (where, typ))

    if typ == "ver":
        if not (isinstance(v, str) and _VER.fullmatch(v)):
            raise bad()
    elif typ == "nes":
        if not _nes(v):
            raise bad()
    elif typ == "str":
        if not isinstance(v, str):
            raise bad()
    elif typ == "bool":
        if not isinstance(v, bool):
            raise bad()
    elif typ == "int0":
        if not _is_int0(v):
            raise bad()
    elif typ.startswith("const:"):
        if not (isinstance(v, str) and v == typ[6:]):
            raise bad()
    elif typ.startswith("enum:"):
        if not (isinstance(v, str) and v in typ[5:].split(",")):
            raise bad()
    elif typ == "ts":
        if not is_ts(v):
            raise Fail(step, "timestamp form at " + where)
    elif typ == "digest":
        if not is_digest(v):
            raise Fail(step, "digest form at " + where)
    elif typ == "typedDigest":
        if not (isinstance(v, dict) and {"type", "digestAlgorithm", "digest"} <= set(v)
                and set(v) <= {"type", "digestAlgorithm", "digest", "purpose"}):
            raise bad()
        if not _nes(v["type"]) or ("purpose" in v and not _nes(v["purpose"])):
            raise bad()
        if v["digestAlgorithm"] != "jcs-sha256-v1" or not (isinstance(v["digest"], str)
                                                          and HEX64.fullmatch(v["digest"])):
            raise bad()
    elif typ == "relationDigest":
        if not (isinstance(v, dict) and set(v) == {"digestAlgorithm", "digest"}):
            raise bad()
        if v["digestAlgorithm"] != "jcs-sha256-v1" or not (isinstance(v["digest"], str)
                                                          and HEX64.fullmatch(v["digest"])):
            raise bad()
    elif typ == "obj":
        if not isinstance(v, dict):
            raise bad()
        _check_obj(v, path, ch, step, where + ".")
    elif typ == "open":
        if not isinstance(v, dict):
            raise bad()
        _no_null(v, where, step)
    elif typ == "any":
        _no_null(v, where, step)
    elif typ == "arr_any":
        if not isinstance(v, list):
            raise bad()
        _no_null(v, where, step)
    elif typ == "arr_str":
        if not (isinstance(v, list) and all(isinstance(x, str) for x in v)):
            raise bad()
    elif typ == "nearr_nes":
        if not (isinstance(v, list) and v and all(_nes(x) for x in v)):
            raise bad()
    elif typ in ("arr_obj", "arr_obj_or_str", "arr_obj_1_64"):
        if not isinstance(v, list):
            raise bad()
        if typ == "arr_obj_1_64" and not 1 <= len(v) <= 64:
            raise bad()
        for i, e in enumerate(v):
            if isinstance(e, dict):
                _check_obj(e, path + "[]", ch, step, "%s[%d]." % (where, i))
            elif not (typ == "arr_obj_or_str" and isinstance(e, str)):
                raise bad()
    else:
        raise ValueError("table type " + typ)


def field_rules(pred, ch, step):
    if not isinstance(pred, dict):
        raise Fail(step, "predicate is not an object")
    _check_obj(pred, "", ch, step, "")


def relationships_rules(pred, kind, step):
    """The rules of 3.8 for relationships alone (preliminary checks of 3.5)."""
    if "relationships" in pred:
        _check_val(pred["relationships"], "relationships", "arr_obj_1_64",
                   DEC_CH if kind == "decision" else OUT_CH, step, "relationships")


# ---------- trust policy (its format is not defined by the text, 1.2) ----------
class TrustPolicy:
    """decision, outcome, approver: lists of (raw public key, [identifiers]).  scope: the consumption scope
    of an Auditor, where the policy names one (3.5)."""

    def __init__(self, decision=(), outcome=(), approver=(), scope=None):
        self.tables = {"decision": [(bytes(k), list(i)) for k, i in decision],
                       "outcome": [(bytes(k), list(i)) for k, i in outcome],
                       "approver": [(bytes(k), list(i)) for k, i in approver]}
        self.scope = scope

    def keys(self, table):
        out = []
        for k, _ in self.tables[table]:
            if k not in out:
                out.append(k)
        return out

    def ids(self, table, raw):
        out = []
        for k, ids in self.tables[table]:
            if k == raw:
                out += ids
        return out

    def keys_for(self, table, ident):
        return [k for k in self.keys(table) if ident in self.ids(table, k)]


def policy_from_json(b):
    """The trust policy files of the -11 test package: {"decision": {base64 key: [ids]}, "outcome": {...},
    "approver": {...}, "consumptionScope": {...}}, each member optional."""
    try:
        j = json.loads(b)
    except Exception as e:
        raise InputError("trust policy does not parse: %s" % e)
    if not isinstance(j, dict):
        raise InputError("trust policy is not an object")

    def tab(name):
        out = []
        t = j.get(name) or {}
        if not isinstance(t, dict):
            raise InputError("trust policy member %s is not an object" % name)
        for k, ids in t.items():
            out.append((base64.b64decode(k, validate=True), [ids] if isinstance(ids, str) else list(ids)))
        return out

    return TrustPolicy(tab("decision"), tab("outcome"), tab("approver"), j.get("consumptionScope"))


# ---------- Section 3.2 ----------
def verify_decision(ctx):
    pol = ctx["policy"]
    keys = ctx.get("decision_keys") or pol.keys("decision")  # the expected key of 3.1, given per vector (R-8)
    try:
        d = steps_1_to_6(ctx["decision"], ctx.get("decision_binding", "dsse"), keys, "decision")
    except BindFail as f:
        raise Fail("3.2 step %d" % f.n, f.why)
    pred = d["pred"]
    field_rules(pred, DEC_CH, "3.2 step 7")
    pa = pred["proposedAction"]
    if "parametersDigest" not in pa and "parametersRef" not in pa:
        raise Fail("3.2 step 7", "note (1): proposedAction carries neither parametersDigest nor parametersRef")
    dm = pred["decisionMaker"]["id"]
    if dm not in pol.ids("decision", d["key"]):
        raise Fail("3.2 step 8", "the trust policy does not bind decisionMaker.id to the key of step 3")
    if dm != ctx["dm_id"]:
        raise Fail("3.2 step 8", "decisionMaker.id is not the expected decisionMaker.id")
    T, v = ts(ctx["T"]), pred["validity"]
    if ts(pred["decidedAt"]) > T:
        raise Fail("3.2 step 9", "decidedAt is later than T")
    if not T < ts(v["expiresAt"]):
        raise Fail("3.2 step 9", "T is not strictly earlier than validity.expiresAt")
    if ctx.get("aud") is not None and not any(x == ctx["aud"] for x in v["audience"]):
        raise Fail("3.2 step 9", "audience has no element equal to the expected audience")
    if ctx.get("nonce") is not None and v["nonce"] != ctx["nonce"]:
        raise Fail("3.2 step 9", "nonce is not the expected nonce")
    if ctx.get("action") is not None:
        pd = pa.get("parametersDigest")
        if pd is None or sha(ctx["action"]) != pd["sha256"]:
            raise Fail("3.2 step 10", "SHA-256 of the action bytes is not proposedAction.parametersDigest.sha256")
    return d


# ---------- Section 3.3 ----------
def case1(d, ctx):
    st, pred = "3.3 case 1", d["pred"]
    if pred["decision"]["verdict"] != "ALLOW":
        raise Fail(st, "decision.verdict is not ALLOW")
    if not any(x == "user_approval" for x in pred["decision"]["reasonCodes"]):
        raise Fail(st, "decision.reasonCodes has no element equal to user_approval")
    ents = [e for e in pred["inputSnapshot"] if e.get("name") == "approval record"]
    if len(ents) != 1:
        raise Fail(st, "inputSnapshot has %d entries named approval record" % len(ents))
    A = ctx.get("approval")
    if A is None:
        raise Fail(st, "approval record bytes not supplied")
    if sha(A) != ents[0]["digest"]["sha256"]:
        raise Fail(st, "SHA-256 of the approval record bytes is not the digest of that entry")
    try:
        a = parse_json(A)
    except Exception as e:
        raise Fail(st, "approval record does not parse: %s" % e)
    try:
        canon = jcsb(a)
    except Exception as e:
        raise Fail(st, "approval record has no RFC 8785 serialization: %s" % e)
    if canon != A:
        raise Fail(st, "approval record bytes are not their own RFC 8785 serialization")
    need = ("approvalId", "approver", "session", "actionDigest", "approvedAt", "validUntil")
    if not isinstance(a, dict) or not all(k in a for k in need):
        raise Fail(st, "approval record is not an object with " + ", ".join(need))
    for k in ("approvalId", "approver", "session"):
        if not _nes(a[k]):
            raise Fail(st, k + " is not a non-empty string")
    if not is_digest(a["actionDigest"]):
        raise Fail(st, "actionDigest does not have the digest form")
    pd = pred["proposedAction"].get("parametersDigest")
    if pd is None or a["actionDigest"] != pd:
        raise Fail(st, "actionDigest is not proposedAction.parametersDigest")
    if a["approver"] != pred["principal"]["id"]:
        raise Fail(st, "approver is not principal.id")
    for k in ("approvedAt", "validUntil"):
        if not is_ts(a[k]):
            raise Fail(st, k + " is not a timestamp in the form of 3.8")
    if not (ts(a["approvedAt"]) <= ts(pred["decidedAt"]) <= ts(ctx["T"]) < ts(pred["validity"]["expiresAt"])
            <= ts(a["validUntil"])):
        raise Fail(st, "approvedAt <= decidedAt <= T < validity.expiresAt <= validUntil does not hold")
    return a


def case2(d, ctx):
    st, pred = "3.3 case 2", d["pred"]
    if pred["decision"]["verdict"] not in ("DENY", "REFUSE"):
        raise Fail(st, "decision.verdict is not DENY or REFUSE")
    if "actionOutcome" in pred:
        ao = pred["actionOutcome"]
        if "status" not in ao:
            raise Fail(st, "actionOutcome without status")
        if ao["status"] not in ("notAttempted", "blocked", "refused"):
            raise Fail(st, "actionOutcome.status is not notAttempted, blocked or refused")
        if ao.get("performedAt") is not None or ao.get("outcomeRef") is not None:
            raise Fail(st, "actionOutcome.performedAt or outcomeRef is present and not null")


def case3(d, ctx):
    st = "3.3 case 3"
    if d["pred"]["decision"]["verdict"] != "ALLOW":
        raise Fail(st, "decision.verdict is not ALLOW")
    if ctx.get("outcome") is None:
        raise Incomplete("no outcome receipt supplied (R-20)")  # not reached from check_receipt
    o = verify_outcome(ctx, d)
    if o["status"] != "executed":
        raise Fail(st, "the status of the outcome receipt is not executed")
    return o


# ---------- Section 3.4 ----------
def verify_outcome(ctx, d):
    pol = ctx["policy"]
    ob = ctx.get("outcome_binding", "dsse")
    b = binding_of(ob)
    try:
        c = b.step1(ctx["outcome"])
        Q = b.step2(c)
        kraw = b.step3(c, Q, ctx.get("outcome_keys") or pol.keys("outcome"))  # R-4
        try:
            val = step4_canonical(Q)
        except ValueError as e:
            raise BindFail(4, str(e))
    except BindFail as f:
        raise Fail("3.4 step 1", "as 3.2 step %d: %s" % (f.n, f.why))
    try:
        pred, _ = b.step6(c, val, "outcome")
    except BindFail as f:
        raise Fail("3.4 step 2", f.why)
    field_rules(pred, OUT_CH, "3.4 step 3")
    dp = d["pred"]
    if pred["decisionRef"]["sha256"] != d["R"]:
        raise Fail("3.4 step 4", "decisionRef.sha256 is not the content root R of the decision receipt")
    pd = dp["proposedAction"].get("parametersDigest")
    if pd is None or pred["requestedActionDigest"] != pd:
        raise Fail("3.4 step 4", "requestedActionDigest is not the parametersDigest of the decision")
    eid = ctx.get("executor_id")
    if eid is None:
        raise InputError("Case 3 needs the expected executor.id")
    if pred["executor"]["id"] != eid:
        raise Fail("3.4 step 5", "executor.id is not the expected executor.id")
    if eid not in pol.ids("outcome", kraw):
        raise Fail("3.4 step 5", "the trust policy does not permit the outcome-signing key to attest executor.id")
    if kraw == d["key"]:
        raise Fail("3.4 step 5", "the outcome-signing key is the decision maker's key")
    if pred["executor"]["id"] == dp["decisionMaker"]["id"]:
        raise Fail("3.4 step 5", "executor.id equals decisionMaker.id")
    if pred["status"] == "executed" and "effectDigest" not in pred:
        raise Fail("3.4 step 6", "status executed without effectDigest")
    if ctx.get("effect") is not None:
        if "effectDigest" not in pred:
            raise Fail("3.4 step 6", "effect bytes supplied but effectDigest absent")
        if sha(ctx["effect"]) != pred["effectDigest"]["sha256"]:
            raise Fail("3.4 step 6", "SHA-256 of the effect bytes is not effectDigest.sha256")
    pa = ts(pred["performedAt"])
    if pa < ts(dp["decidedAt"]):
        raise Fail("3.4 step 7", "performedAt is earlier than decidedAt")
    if not pa < ts(dp["validity"]["expiresAt"]):
        raise Fail("3.4 step 7", "performedAt is not strictly earlier than validity.expiresAt")
    return pred


# ---------- Section 3.11 ----------
def approver_signature(ctx, d, a):
    st = "approver signature"
    if ctx.get("action") is None:
        raise Fail(st, "check 1: action bytes not supplied")
    if "approverSignature" not in a:
        raise Fail(st, "check 2: the approval record has no approverSignature")
    s = a["approverSignature"]
    if not (isinstance(s, dict) and list(s) == ["sig"]):
        raise Fail(st, "check 2: approverSignature is not an object whose only member is sig")
    try:
        sig = b64strict(s["sig"])
    except Exception:
        raise Fail(st, "check 2: sig is not a string in the base64 form of 3.10 step 2")
    pol = ctx["policy"]
    key = ctx.get("approver_key")  # R-5
    if key is not None:
        if a["approver"] not in pol.ids("approver", key):
            raise Fail(st, "check 3: the trust policy does not bind the approver key to approver")
    else:
        cands = pol.keys_for("approver", a["approver"])
        if len(cands) != 1:
            raise Fail(st, "check 3: the trust policy binds %d keys to approver" % len(cands))
        key = cands[0]
    if bytes(key) == d["key"]:
        raise Fail(st, "check 4: the approver key is the key that verified the decision receipt")
    U = {k: v for k, v in a.items() if k != "approverSignature"}
    M = pae(APPROVAL_CTX, jcsb(U))
    if not ed25519_verify(key, sig, M):
        raise Fail(st, "check 5: the signature does not pass")


# ---------- Section 4 ----------
def state_generations(state):
    """The form of the -11 test package (the text defines none, item 5): an array is the current generation;
    an object whose members are all arrays is a set of generations, the member current being the current one.
    Any other form (for example a generation that holds only a count of compacted entries) is None: its
    required entries are not preserved in a form that can be checked, which item 5 refuses."""
    if isinstance(state, list):
        return {"current": state}
    if isinstance(state, dict) and all(isinstance(g, list) for g in state.values()):
        return state
    return None


def section4(a, state_bytes, T=None, received_bytes=None):
    if state_bytes is None:
        raise Fail("Section 4 item 5", "consumption state missing")
    try:
        state = parse_json(state_bytes)
    except Exception as e:
        raise Fail("Section 4 item 5", "consumption state unreadable: %s" % e)  # R-7
    gens = state_generations(state)
    if gens is None:
        raise Fail("Section 4 item 5", "consumption state of a form not known")
    for name, g in gens.items():
        for j, e in enumerate(g):
            if not (isinstance(e, dict) and _nes(e.get("approvalId")) and _nes(e.get("session"))
                    and is_digest(e.get("actionDigest"))):
                raise Fail("Section 4 item 5", "malformed entry %d of generation %s" % (j, name))

    def same(e):
        return (e["approvalId"] == a["approvalId"] and e["session"] == a["session"]
                and e["actionDigest"] == a["actionDigest"])

    if any(same(e) for e in gens.get("current", [])):
        raise Fail("Section 4 item 1", "approval identity already consumed (current generation); item 2 makes "
                                       "a copy with other bytes the same approval")  # R-6
    for name, g in gens.items():
        if name != "current" and any(same(e) for e in g):
            raise Fail("Section 4 item 4", "approval identity consumed in generation " + name)
    if received_bytes is not None:  # item 2: the earliest validUntil among the copies received (R-19)
        try:
            rec = parse_json(received_bytes)
        except Exception as e:
            raise Fail("Section 4 item 2", "the copies received cannot be read: %s" % e)
        if not isinstance(rec, list):
            raise Fail("Section 4 item 2", "the copies received are not a list")
        bounds = [ts(a["validUntil"])]
        for e in rec:
            if (isinstance(e, dict) and _nes(e.get("approvalId")) and _nes(e.get("session"))
                    and is_digest(e.get("actionDigest")) and same(e) and is_ts(e.get("validUntil"))):
                bounds.append(ts(e["validUntil"]))
        if not ts(T) < min(bounds):
            raise Fail("Section 4 item 2", "T is not strictly earlier than the earliest validUntil of the copies "
                                           "received for this identity")


# ---------- one receipt, or one pair for Case 3 ----------
def check_receipt(case, ctx):
    """ctx: policy (TrustPolicy), T, dm_id, decision (bytes), decision_binding, and optional aud, nonce, action,
    approval, effect, outcome (bytes), outcome_binding, executor_id, approver_check, approver_key (raw),
    relying_party, state (bytes).  Returns the verdict dict; raises InputError for a missing verifier input."""
    if case not in (1, 2, 3):
        raise InputError("case must be 1, 2 or 3")
    if not is_ts(ctx.get("T")):
        raise InputError("T is not in the timestamp form of 3.8")
    if not _nes(ctx.get("dm_id")):
        raise InputError("expected decisionMaker.id missing")
    r = {"procedure": "case%d" % case, "binding": ctx.get("decision_binding", "dsse"), "T": ctx["T"]}
    if case == 3:
        r["outcome_binding"] = ctx.get("outcome_binding", "dsse")
        if ctx.get("outcome") is None:  # R-20, rewritten in 0.2.1
            r.update({"result": "no result", "step": "3.1 incomplete invocation",
                      "why": "Case 3 was asked and no outcome receipt was supplied (R-20)",
                      "receipt_verification": "not run"})
            return r
    a = None
    try:
        d = verify_decision(ctx)
        if case == 1:
            a = case1(d, ctx)
            r["approval_carries_approverSignature"] = "approverSignature" in a
            if ctx.get("approver_check"):
                approver_signature(ctx, d, a)
                r["approver_signature"] = "pass"
            else:
                r["approver_signature"] = "not checked"
        elif case == 2:
            case2(d, ctx)
        else:
            case3(d, ctx)
        if case != 1 and ctx.get("approver_check"):
            r["approver_signature"] = "not run: asked under a case other than Case 1 (R-9)"
    except Fail as f:
        if f.step == "approver signature":
            r["approver_signature"] = "fail"
        r.update({"result": "fail", "step": f.step, "why": f.why, "receipt_verification": "fail"})
        return r
    r.update({"receipt_verification": "pass", "content_root": d["R"], "predicate_digest": d["pdig"]})
    if ctx.get("relying_party") and case == 1:
        try:
            section4(a, ctx.get("state"), ctx["T"], ctx.get("received"))
            r.update({"result": "pass", "step": None, "why": None, "section4": "pass"})
        except Fail as f:
            r.update({"result": "refused", "step": f.step, "why": f.why, "section4": "refused"})
    else:
        r.update({"result": "pass", "step": None, "why": None, "section4": "not run"})
    return r


# ---------- Section 3.5 ----------
def held_preliminary(h, policy):
    """Preliminary checks of 3.5 for one held receipt.  h: {name, bytes, binding, keys, kind (optional)}.
    Where kind is not given (the package names only a key and a file for each held receipt), the receipt passes
    where steps 1 to 5 pass and step 6 passes for the decision receipt type or the outcome receipt type (R-18)."""
    kinds = [h["kind"]] if h.get("kind") else ["decision", "outcome"]
    keys = h.get("keys") or policy.keys(kinds[0])
    binding = h.get("binding", "dsse")
    try:
        c, P, val, R, k = steps_1_to_5(h["bytes"], binding, keys)
    except BindFail as f:
        step = "3.2 step %d" % f.n if kinds == ["decision"] else "3.2 step %d (3.4 step 1)" % f.n
        return False, {"step": step, "why": f.why}
    why = []
    for kind in kinds:
        try:
            pred, pdig = binding_of(binding).step6(c, val, kind)
        except BindFail as f:
            why.append("%s: %s" % (kind, f.why))
            continue
        try:
            relationships_rules(pred, kind, "3.5 preliminary (relationships)")
        except Fail as f:
            return False, {"step": f.step, "why": f.why}
        return True, {"P": P, "R": R, "key": k, "pred": pred, "pdig": pdig, "kind": kind}
    return False, {"step": "3.2 step 6 (3.4 step 2)", "why": "; ".join(why)}


def approval_identity(b):
    """Identity extraction of the first check of 3.5; None where the citation gives no identity."""
    if b is None:
        return None
    try:
        a = parse_json(b)
    except Exception:
        return None
    if not (isinstance(a, dict) and _nes(a.get("approvalId")) and _nes(a.get("session"))
            and is_digest(a.get("actionDigest"))):
        return None
    return (a["approvalId"], a["session"], a["actionDigest"]["sha256"])


def _verdict(info):
    dd = info["pred"].get("decision")
    return dd.get("verdict") if isinstance(dd, dict) else None


def consumption_scope(spec):
    """The scope of the first check: from the audit context, or where that names none, from the trust policy.
    Returns (scope decisions as a set of content roots, unreleased set, source) or (None, why)."""
    ac = spec.get("audit_context")
    unreleased = set()
    scope, src = None, None
    if ac is not None:
        try:
            acj = parse_json(ac)
        except Exception as e:
            return None, "the audit context cannot be read: %s" % e
        if not isinstance(acj, dict):
            return None, "the audit context is not an object"
        if "consumptionScope" in acj:
            scope, src = acj["consumptionScope"], "audit context"
        u = acj.get("unreleased", [])
        if not (isinstance(u, list) and all(isinstance(x, str) for x in u)):
            return None, "unreleased in the audit context cannot be read"
        unreleased = set(u)
    if scope is None and spec["policy"].scope is not None:
        scope, src = spec["policy"].scope, "trust policy"
    if scope is None:
        return None, "no consumption scope in the audit context or the trust policy"
    dec = scope.get("decisions") if isinstance(scope, dict) else None
    if not (isinstance(dec, list) and all(isinstance(x, str) for x in dec)):
        return None, "the consumption scope (%s) does not list its decisions by content root (R-10)" % src
    return (set(dec), unreleased, src), None


def first_check(held, spec):
    got, why = consumption_scope(spec)
    if got is None:
        return {"result": "no result", "why": why}
    members, unreleased, src = got
    approvals = {sha(b): b for b in spec.get("approvals", [])}
    seen, pairs, not_counted = {}, [], []
    for name, info in held.items():
        if info["kind"] != "decision" or info["R"] not in members or info["R"] in unreleased:
            continue
        if _verdict(info) != "ALLOW":
            continue
        snap = info["pred"].get("inputSnapshot")
        for j, e in enumerate(snap if isinstance(snap, list) else []):
            if not (isinstance(e, dict) and e.get("name") == "approval record"):
                continue
            dg = e.get("digest")
            hx = dg.get("sha256") if isinstance(dg, dict) else None
            ident = approval_identity(approvals.get(hx)) if isinstance(hx, str) else None
            if ident is None:
                not_counted.append({"receipt": name, "inputSnapshot": j})
                continue
            for other, oR in seen.get(ident, []):
                if oR != info["R"]:
                    pairs.append({"receipts": [other, name], "approvalId": ident[0], "session": ident[1],
                                  "actionDigest": ident[2]})
            seen.setdefault(ident, []).append((name, info["R"]))
    return {"result": "fail" if pairs else "pass", "scope_from": src, "pairs": pairs, "not_counted": not_counted}


def second_check(held):
    roots = {}
    for n, info in held.items():
        if info["kind"] == "decision":
            roots.setdefault(info["R"], []).append((n, _verdict(info)))
    conflicts = []
    for n, info in held.items():
        if info["kind"] != "outcome" or info["pred"].get("status") != "executed":
            continue
        dr = info["pred"].get("decisionRef")
        hx = dr.get("sha256") if isinstance(dr, dict) else None
        for dn, verdict in (roots.get(hx, []) if isinstance(hx, str) else []):
            if verdict != "ALLOW":  # R-11
                conflicts.append({"outcome": n, "decision": dn, "verdict": verdict})
    return {"result": "fail" if conflicts else "pass", "conflicts": conflicts}


def third_check(held, spec, invalid):
    if invalid:
        return {"result": "no result", "why": "the input is invalid: a held receipt failed the preliminary checks"}
    starts = []
    for s in spec.get("subjects", []):
        ok, info = held_preliminary(s, spec["policy"])
        if not ok:
            return {"result": "no result", "why": "%s fails %s (R-14)" % (s.get("name"), info["step"])}
        starts.append((s.get("name", "subject"), info))
    by_root = {}
    for n, i in held.items():
        by_root.setdefault(i["R"], []).append((n, i))
    failures, chain, done = [], [], set()
    queue = list(starts)
    while queue:
        name, info = queue.pop(0)
        if info["R"] in done:  # R-15
            continue
        done.add(info["R"])
        for j, e in enumerate(info["pred"].get("relationships", [])):
            if e["relation"] != "supersedes":
                continue
            found = by_root.get(e["targetReceiptDigest"]["digest"])
            if not found:
                failures.append({"receipt": name, "entry": j, "why": "no held receipt has that content root"})
                continue
            pn, pi = found[0]
            if "targetSubjectDigest" in e and e["targetSubjectDigest"]["digest"] != pi["pdig"]:
                failures.append({"receipt": name, "entry": j,
                                 "why": "targetSubjectDigest is not the predicate digest of " + pn})
                continue
            chain.append([name, pn])
            queue.append((pn, pi))
    return {"result": "fail" if failures else "pass", "failures": failures, "predecessors": chain}


def set_checks(spec):
    """spec: policy; held (list of {name, bytes, binding, keys}); approvals (list of bytes); first, second, third
    (bool: which checks are asked); audit_context (bytes or None); subjects (the receipts being verified, as
    held_preliminary takes them, with kind)."""
    held, failed = {}, {}
    for h in spec.get("held", []):
        ok, info = held_preliminary(h, spec["policy"])
        if ok:
            held[h["name"]] = info
        else:
            failed[h["name"]] = info
    out = {"preliminary": {"valid": not failed, "failed": failed}}
    if spec.get("first"):
        out["first"] = first_check(held, spec)
    if spec.get("second"):
        out["second"] = second_check(held)
    if spec.get("third"):
        out["third"] = third_check(held, spec, bool(failed))
    return out


def fold_set_checks(r, sc):
    """One result and step for a vector with checks of 3.5 (R-22).  A failure of the receipt or a refusal under
    Section 4 stands; then an invalid input; then a failing first, second, third check; then a first check that
    gives no result."""
    r["set_checks"] = sc
    if r["result"] != "pass":
        return r
    if not sc["preliminary"]["valid"]:
        r.update({"result": "invalid input", "step": "3.5 preliminary checks",
                  "why": "; ".join("%s: %s %s" % (n, f["step"], f["why"]) for n, f in sorted(sc["preliminary"]["failed"].items()))})
        return r
    for k, label in (("first", "3.5 first check"), ("second", "3.5 second check"), ("third", "3.5 third check")):
        if k in sc and sc[k]["result"] == "fail":
            r.update({"result": "fail", "step": label, "why": json.dumps({x: y for x, y in sc[k].items() if x != "result"},
                                                                         sort_keys=True)})
            return r
    if "first" in sc and sc["first"]["result"] == "no result":
        r.update({"result": "no result", "step": "3.5 first check", "why": sc["first"]["why"]})
    return r


# ---------- driver: the verifier calls of the -11 test package (inputs-11.json, made by make_inputs.py) ----------
VALUE_FLAGS = {"-binding", "-decision-binding", "-policy", "-pub", "-signer", "-t", "-aud", "-nonce", "-case",
               "-action", "-approval", "-approver-pub", "-consumed", "-received", "-held", "-held-approval",
               "-audit-context", "-executor-id", "-decision", "-decision-pub", "-decision-signer", "-decision-aud",
               "-decision-nonce", "-effect"}
BOOL_FLAGS = {"-first", "-second"}
MULTI_FLAGS = {"-held", "-held-approval"}
FILE_FLAGS = {"-policy", "-action", "-approval", "-consumed", "-received", "-held-approval", "-audit-context",
              "-decision", "-effect"}
CASES = {"approval": 1, "declined": 2, "executed": 3}


def parse_call(argv):
    """argv of one verifier call of the package: command (decision or outcome), flags, one receipt file."""
    if not argv or argv[0] not in ("decision", "outcome"):
        raise InputError("command is not decision or outcome")
    opts, multi, bools, pos = {}, {k: [] for k in MULTI_FLAGS}, set(), []
    i = 1
    while i < len(argv):
        x = argv[i]
        if x in BOOL_FLAGS:
            bools.add(x)
            i += 1
        elif x in VALUE_FLAGS:
            if i + 1 >= len(argv):
                raise InputError("flag %s without a value" % x)
            if x in MULTI_FLAGS:
                multi[x].append(argv[i + 1])
            elif x in opts:
                raise InputError("flag %s given twice" % x)
            else:
                opts[x] = argv[i + 1]
            i += 2
        elif x.startswith("-"):
            raise InputError("flag %s not known" % x)
        else:
            pos.append(x)
            i += 1
    if len(pos) != 1:
        raise InputError("not exactly one receipt file")
    return argv[0], opts, multi, bools, pos[0]


def call_files(argv):
    """The package files that one call reads."""
    cmd, opts, multi, bools, pos = parse_call(argv)
    fs = [opts[k] for k in sorted(FILE_FLAGS - MULTI_FLAGS) if k in opts]
    fs += multi["-held-approval"]
    fs += [held_arg(h)[2] for h in multi["-held"]]
    fs.append(pos)
    return fs


def _b64key(s):
    try:
        return base64.b64decode(s, validate=True)
    except Exception:
        raise InputError("key %r is not base64" % s)


def held_arg(h):
    """-held [binding:]key:file.  The binding of a held receipt is an input (R-18, rewritten in 0.2.1: the Auditor
    knows it).  The calls of the -11 test package give key:file only; the author said every wrapped receipt in it
    is DSSE, so a call without a binding means dsse."""
    first, rest = h.split(":", 1)
    if first in BINDINGS:
        k, path = rest.split(":", 1)
        return first, k, path
    return "dsse", first, rest


def run_call(argv, rd):
    cmd, opts, multi, bools, pos = parse_call(argv)
    pol = policy_from_json(rd(opts["-policy"]))
    f = lambda k: rd(opts[k]) if k in opts else None
    if cmd == "decision":
        if opts.get("-case") not in CASES:
            raise InputError("case %r not known" % opts.get("-case"))
        case = CASES[opts["-case"]]
        ctx = {"policy": pol, "T": opts.get("-t"), "dm_id": opts.get("-signer"), "aud": opts.get("-aud"),
               "nonce": opts.get("-nonce"), "decision": rd(pos), "decision_binding": opts.get("-binding", "dsse"),
               "decision_keys": [_b64key(opts["-pub"])], "action": f("-action"), "approval": f("-approval"),
               "approver_check": "-approver-pub" in opts,
               "approver_key": _b64key(opts["-approver-pub"]) if "-approver-pub" in opts else None,
               "relying_party": "-consumed" in opts or "-received" in opts,
               "state": f("-consumed"), "received": f("-received")}
        subjects = [{"name": pos, "bytes": ctx["decision"], "binding": ctx["decision_binding"],
                     "keys": ctx["decision_keys"], "kind": "decision"}]
    else:
        case = 3
        ctx = {"policy": pol, "T": opts.get("-t"), "dm_id": opts.get("-decision-signer"),
               "aud": opts.get("-decision-aud"), "nonce": opts.get("-decision-nonce"), "decision": f("-decision"),
               "decision_binding": opts.get("-decision-binding", "dsse"),
               "decision_keys": [_b64key(opts["-decision-pub"])], "outcome": rd(pos),
               "outcome_binding": opts.get("-binding", "dsse"), "outcome_keys": [_b64key(opts["-pub"])],
               "executor_id": opts.get("-executor-id"), "effect": f("-effect")}
        if ctx["decision"] is None:
            raise InputError("outcome call without -decision")
        subjects = [{"name": opts["-decision"], "bytes": ctx["decision"], "binding": ctx["decision_binding"],
                     "keys": ctx["decision_keys"], "kind": "decision"},
                    {"name": pos, "bytes": ctx["outcome"], "binding": ctx["outcome_binding"],
                     "keys": ctx["outcome_keys"], "kind": "outcome"}]  # R-21
    r = check_receipt(case, ctx)
    r["command"] = cmd
    if multi["-held"] or multi["-held-approval"] or bools:
        held = []
        for h in multi["-held"]:
            hb, k, path = held_arg(h)
            held.append({"name": path, "bytes": rd(path), "binding": hb, "keys": [_b64key(k)]})  # R-18
        spec = {"policy": pol, "held": held, "approvals": [rd(p) for p in multi["-held-approval"]],
                "first": "-first" in bools, "second": "-second" in bools, "third": bool(held),
                "audit_context": f("-audit-context"), "subjects": subjects}
        r = fold_set_checks(r, set_checks(spec))
    return r


def main(argv):
    if len(argv) == 2 and argv[1] == "--selftest":
        return selftest()
    if len(argv) != 4:
        print(__doc__, file=sys.stderr)
        return 2
    with open(argv[1], "rb") as fh:
        inp = json.load(fh)
    pkg, od = argv[2], argv[3]

    def rd(path):
        with open(os.path.join(pkg, path), "rb") as fh:
            return fh.read()

    def have(path):
        return os.path.isfile(os.path.join(pkg, path))

    off, read_sha = {}, {}

    def rd_checked(path):  # every file read is compared with the SHA-256 that inputs-11.json gives for it
        b = rd(path)
        got = sha(b)
        want = inp["files"].get(path)
        read_sha[path] = got
        if got != want:
            off.setdefault(path, {"sha256_inputs": want, "sha256_found": got, "vectors": []})
        return b

    results = {}
    for v in inp["vectors"]:
        name = v["name"]
        try:
            fs = call_files(v["argv"])
        except InputError as e:
            results[name] = {"result": "input error", "step": None, "why": str(e), "source": v["source"]}
            continue
        gone = [p for p in fs if not have(p)]
        if gone:
            results[name] = {"result": "not run", "step": None, "why": "not in the package: " + ", ".join(gone),
                             "source": v["source"]}
            continue
        try:
            r = run_call(v["argv"], rd_checked)
        except InputError as e:
            r = {"result": "input error", "step": None, "why": str(e)}
        except Exception:
            r = {"result": "error", "step": None, "why": traceback.format_exc()}
        r["source"] = v["source"]
        mine = sorted(p for p in fs if p in off)
        for p in mine:
            off[p]["vectors"].append(name)
        if mine:
            r["inputs_off"] = mine
        results[name] = r
    counts = {}
    for r in results.values():
        counts[r["result"]] = counts.get(r["result"], 0) + 1
    doc = {"checker": "dr_check " + __version__, "draft": DRAFT, "readings": "READINGS.md (R-1 to R-22)",
           "inputs_sha256": sha(json.dumps(inp, sort_keys=True).encode()), "package": inp.get("package"),
           "files_off": off, "files_read": len(read_sha), "results": results, "count": len(results),
           "count_by_result": counts, "ed25519_cross_check_disagreements": ED_DISAGREE}
    data = json.dumps(doc, sort_keys=True, indent=1).encode()
    os.makedirs(od, exist_ok=True)
    with open(os.path.join(od, "gruszka11_verdicts.json"), "wb") as fh:
        fh.write(data)
    for p in sorted(off):
        print("file off: %s (found %s), read by %d vectors" % (p, off[p]["sha256_found"][:8], len(off[p]["vectors"])),
              file=sys.stderr)
    if ED_DISAGREE:
        print("Ed25519: cryptography and the group equation disagree %d times" % len(ED_DISAGREE), file=sys.stderr)
    print("%d vectors: %s" % (len(results), ", ".join("%s %d" % kv for kv in sorted(counts.items()))), file=sys.stderr)
    print(sha(data))
    return 0


# ---------- self-test: values of Appendix A of -11 only, and receipts built here from them ----------
A1_KEYS = [  # label, seed (hex), public key (base64), keyid; Appendix A.1
    ("gate-1", "100fa92fa6464c141f791a96327f555c1c0cfbf3095af986537e50c3c4335f8c",
     "TWfs75IN1In3CNI8TnyIOUHgtwilOPGcRFQLJ670CJc=", "SHA256:NjZMAelLq9XON3pxV5tR5hZjX99NkQyw4gGJSRc2gP8"),
    ("observer-1", "f03ad5b668ad225ea15fd9fd272fc8df84be59f467da86b0f2ad0a5ad26f4ddd",
     "4hDsi5TCL+A+9SB7k2l4EkY7XePUheE+zE9mBazt2Fs=", "SHA256:q/d0VZCREBObUFi8PWKWXEF4lVNeYPuGn0GuOqd1ij0"),
    ("gate-sa", "2f4dc12b893338e2cd324f681baf8acf2a46830105a683cdba7b0ab00d7d7cd5",
     "ULcjJ1DulKja0EjIH+F/fCjsHCX64AHa5vM3Zo01tH8=", "SHA256:hbX2BDnXPmITRVdno78Mdk/qWHNavEMCKAzgVC+eTuU"),
    ("approver-1", "a49c35e42e266cce01738b3e8581ede5c99735853586619c2781f948d9c637ad",
     "NaFodtbI4q99jUOKDY3PdgFuOX3ODCQ3cpuZ4DK3Z1o=", "SHA256:fDsZsZLXxGReK2KGzLgq4I3KEDuii3XBNnISFhQqGKg"),
    ("approver-2", "0b988ae84c124001421578eab44b0cfc83f928063ae9d74bacd52e35a7df7818",
     "i262dRw6N2af5ECLfw3xwFdco7MAzbhloiUF6lB6xbY=", "SHA256:ZduWovwwZWMFM4GK5mRSALiopia6UyQbMwswrisUyGs"),
]
A1_INPUTS = {  # name: (bytes or None, size, SHA-256); Appendix A.1
    "a1": (b"git push origin refs/heads/topic:refs/heads/topic\n", 50,
           "dec54f771352454097310ae4bd6608c0070ebebb3955c6be013c1b3a8e310bd0"),
    "a1x": (b"git push --force origin refs/heads/topic:refs/heads/main\n", 57,
            "b683418806875ff79c6fa190c50edab0b96577ad8062de5ba7b41dc1d9c363fb"),
    "a2": (b"gh pr merge 7 --repo acme/widgets --merge\n", 42,
           "5a7549948a1441addb710f5ada59e06dbce25cc5a59accf14f140379f47adb5b"),
    "pol": (b"example gate rules, revision 1\n", 31,
            "43789b41915ae0febcd13263d293101af5ab041eb7c234e1cbe625d6312815f6"),
}
A1_JSON = {  # name: (value, size, SHA-256); the bytes are the RFC 8785 serialization of the value
    "a3": ({"body": "All required checks passed for 4f1c2a9.", "pull": 7, "repo": "acme/widgets"}, 81,
           "9165c850b7e03cd59578efa1769be74c5386cff5ce96df6b59e25d38ad6f88b4"),
    "e3": ({"author": "agent-42-bot", "body": "All required checks passed for 4f1c2a9.", "id": 9001, "pull": 7}, 93,
           "d3d824cf55168298c0f651244853ec9d9620ea09087abe899243ceb8f9df3a6d"),
}
AP_SIZE, AP_SHA = 231, "88e5b6d69b3e4bc250a42aeffea0414d406e5f04ba4f991ee432a78231da1170"
V1_GOOD = ("2026-10-15T09:01:00Z", 1816, "5fee565673553b8dfbc71a3ea21df340bd9af1b7db78d7ea427bc74cc3fcb4d0",
           "9CL6WsgwL3fMH/7CoFx3Qpqgq/GAn3RU/6/oJ/qBt1FD2qD/JZXBBr+A+qmezhZFwxKej9kr+psShEmFHvhVCA==")
V1_BAD_SHA = "b26c46d88976f2c9f0df3eb76cba2b83dd4ee8f3d2d7dab42bb0e135ef738145"


def _keyid(pub):
    wire = b"\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20" + pub
    return "SHA256:" + base64.b64encode(hashlib.sha256(wire).digest()).decode().rstrip("=")


def _sign(seed_hex, msg):
    return Ed25519PrivateKey.from_private_bytes(bytes.fromhex(seed_hex)).sign(msg)


def _v1_predicate(a1, ap, pol):
    return {
        "agent": {"id": "agent-42"},
        "decidedAt": "2026-10-15T09:00:05Z",
        "decision": {"reasonCodes": ["user_approval"], "verdict": "ALLOW"},
        "decisionChangeConditions": [{"conditionType": "ruleChange",
                                      "description": "a changed gate, mode or rule of the gate"}],
        "decisionId": "dec-0001",
        "decisionMaker": {"id": "gate-1"},
        "decisionType": "preActionAuthorization",
        "evidenceRefs": [],
        "inputSnapshot": [
            {"digest": {"sha256": sha(a1)}, "mediaType": "text/plain", "name": "approved bytes"},
            {"digest": {"sha256": sha(ap)}, "mediaType": "application/json", "name": "approval record"}],
        "notChecked": [{"field": "content", "impact": "an approved text can be wrong",
                        "reason": "the gate does not judge whether the text is true"}],
        "policyBoundary": {"bundleRevision": "1", "decisionPath": "outbound-gate/allow-write",
                           "policyDigest": {"sha256": sha(pol)}, "policyEngine": "proofbundle-pilot/github-write",
                           "policyId": "outbound-gate-rules"},
        "principal": {"id": "user-123"},
        "privacy": {"rawInputsIncluded": False},
        "proposedAction": {"actionType": "git.push", "method": "write", "parametersDigest": {"sha256": sha(a1)},
                           "target": {"name": "https://git.example/acme/widgets refs/heads/topic",
                                      "uri": "https://git.example/acme/widgets"}},
        "schemaVersion": "0.1.0",
        "traceContext": {"parentId": "int-002", "traceId": "trace-abc"},
        "validity": {"audience": ["observer-1"], "expiresAt": "2026-10-15T09:05:05Z", "nonce": "dec-0001"},
    }


def _statement(pred, ptype, name):
    return {"_type": STMT, "predicate": pred, "predicateType": ptype,
            "subject": [{"digest": {"sha256": sha(jcsb(pred))}, "name": name}]}


def _dsse(P, seed, keyid, sig=None):
    if sig is None:
        sig = _sign(seed, pae(PTYPE.encode(), P))
    env = {"payload": base64.b64encode(P).decode(), "payloadType": PTYPE,
           "signatures": [{"keyid": keyid, "sig": base64.b64encode(sig).decode()}]}
    return json.dumps(env).encode(), sig


def _cose(pred, kind, seed, iss="gate-1", sub=None, tag=True, payload_nil=False, ptype=None, unprot=None):
    P = jcsb({"predicate": pred, "type": ptype or (DEC_TYPE if kind == "decision" else OUT_TYPE)})
    if sub is None:
        sub = ("decision:" + pred["decisionId"]) if kind == "decision" else ("outcome:" + pred["outcomeId"])
    prot = cbor_encode({1: -8, 3: "application/json", 4: b"test-kid", 15: {1: iss, 2: sub}})
    sig = _sign(seed, cbor_encode(["Signature1", prot, b"", P]))
    arr = [prot, unprot or {}, None if payload_nil else P, sig]
    return cbor_encode(CTag(18, arr) if tag else arr)


def selftest():
    res = []

    def ok(name, cond):
        res.append((name, bool(cond)))
        print(("ok  " if cond else "NG  ") + name)

    def step_of(fn):
        try:
            r = fn()
            return r["result"] if r["result"] != "fail" and r["result"] != "refused" else r["step"]
        except Exception as e:
            return "exception %s: %s" % (type(e).__name__, e)

    keys = {}
    for label, seed, pub_b64, keyid in A1_KEYS:
        s = hashlib.sha256(("draft-gruszka-audit-decision-receipts test key " + label).encode()).digest()
        pub = Ed25519PrivateKey.from_private_bytes(s).public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
        ok("A.1 key %s: seed is SHA-256 of the label" % label, s.hex() == seed)
        ok("A.1 key %s: public key" % label, base64.b64encode(pub).decode() == pub_b64)
        ok("A.1 key %s: keyid" % label, _keyid(pub) == keyid)
        ok("A.1 key %s: meets the key rule of 3.2 step 3" % label, key_ok(pub))
        keys[label] = (seed, pub, keyid)
    inp = {}
    for n, (b, size, h) in A1_INPUTS.items():
        ok("A.1 input %s: size and SHA-256" % n, len(b) == size and sha(b) == h)
        inp[n] = b
    for n, (v, size, h) in A1_JSON.items():
        b = jcsb(v)
        ok("A.1 input %s: size and SHA-256 of the RFC 8785 bytes" % n, len(b) == size and sha(b) == h)
        inp[n] = b
    ap_obj = {"actionDigest": {"sha256": sha(inp["a1"])}, "approvalId": "appr-001",
              "approvedAt": "2026-10-15T09:00:00Z", "approver": "user-123", "session": "sess-1",
              "validUntil": "2026-10-15T09:15:00Z"}
    inp["ap"] = jcsb(ap_obj)
    ok("A.1 input ap: size and SHA-256", len(inp["ap"]) == AP_SIZE and sha(inp["ap"]) == AP_SHA)

    g_seed, g_pub, g_kid = keys["gate-1"]
    o_pub = keys["observer-1"][1]
    pol = TrustPolicy(decision=[(g_pub, ["gate-1"])], outcome=[(o_pub, ["forge:agent-42-bot"])],
                      approver=[(keys["approver-1"][1], ["user-123"]), (keys["approver-2"][1], ["user-456"])])
    D = _v1_predicate(inp["a1"], inp["ap"], inp["pol"])
    P = jcsb(_statement(D, DEC_TYPE, "decision:dec-0001"))
    T, size, psha, sig_b64 = V1_GOOD
    ok("A.3 V1-good: payload size and SHA-256 (receipt types of 3.10)", len(P) == size and sha(P) == psha)
    env, sig = _dsse(P, g_seed, g_kid)
    ok("A.3 V1-good: the signature of gate-1 is the one printed", base64.b64encode(sig).decode() == sig_b64)

    def ctx1(**kw):
        c = {"policy": pol, "T": T, "dm_id": "gate-1", "aud": "observer-1", "nonce": "dec-0001",
             "decision": env, "decision_binding": "dsse", "action": inp["a1"], "approval": inp["ap"]}
        c.update(kw)
        return c

    ok("A.3 V1-good: pass (Case 1 with a1 and ap)", step_of(lambda: check_receipt(1, ctx1())) == "pass")
    Pbad = P.replace(sha(inp["a1"]).encode(), sha(inp["a1x"]).encode())
    ok("A.3 V1-bad: payload SHA-256", sha(Pbad) == V1_BAD_SHA)
    env_bad, _ = _dsse(Pbad, None, g_kid, sig=base64.b64decode(sig_b64))
    ok("A.3 V1-bad: fails at 3.2 step 3", step_of(lambda: check_receipt(1, ctx1(decision=env_bad))) == "3.2 step 3")
    ok("A.5 V1-accept: consumption state [] passes",
       step_of(lambda: check_receipt(1, ctx1(relying_party=True, state=b"[]"))) == "pass")

    # own checks below: receipts built here from the values above; the expected step is our reading of the text
    ident = [{"actionDigest": {"sha256": sha(inp["a1"])}, "approvalId": "appr-001", "session": "sess-1"}]
    ok("own: identity in the current generation refused under Section 4 item 1 (R-6)",
       step_of(lambda: check_receipt(1, ctx1(relying_party=True, state=jcsb(ident)))) == "Section 4 item 1")
    ok("own: identity only in a rotated generation refused under item 4 (R-6)",
       step_of(lambda: check_receipt(1, ctx1(relying_party=True, state=jcsb({"current": [], "g1": ident}))))
       == "Section 4 item 4")
    ok("own: malformed entry refused under item 5",
       step_of(lambda: check_receipt(1, ctx1(relying_party=True, state=b'[{"approvalId":""}]'))) == "Section 4 item 5")
    ok("own: missing state refused under item 5",
       step_of(lambda: check_receipt(1, ctx1(relying_party=True, state=None))) == "Section 4 item 5")
    ok("own: T after expiresAt fails 3.2 step 9",
       step_of(lambda: check_receipt(1, ctx1(T="2026-10-15T09:05:05Z"))) == "3.2 step 9")
    ok("own: wrong nonce fails 3.2 step 9", step_of(lambda: check_receipt(1, ctx1(nonce="dec-0009"))) == "3.2 step 9")
    ok("own: a1x as action bytes fails 3.2 step 10",
       step_of(lambda: check_receipt(1, ctx1(action=inp["a1x"]))) == "3.2 step 10")
    ok("own: V1-good under Case 2 fails 3.3 case 2", step_of(lambda: check_receipt(2, ctx1())) == "3.3 case 2")
    ok("own: V1-good under the COSE binding fails 3.2 step 1",
       step_of(lambda: check_receipt(1, ctx1(decision_binding="cose"))) == "3.2 step 1")
    ok("own: the decision type of -10 fails 3.2 step 6",
       step_of(lambda: check_receipt(1, ctx1(decision=_dsse(jcsb(_statement(
           D, "https://b7n0de.com/proofbundle/predicates/decision-receipt/v0.1", "decision:dec-0001")),
           g_seed, g_kid)[0]))) == "3.2 step 6")

    # 3.11: an approval record signed by approver-1, cited by a decision re-signed by gate-1
    ap_s = dict(ap_obj)
    ap_s["approverSignature"] = {"sig": base64.b64encode(_sign(keys["approver-1"][0], pae(APPROVAL_CTX, jcsb(ap_obj))))
                                 .decode()}
    ap_s_b = jcsb(ap_s)
    D_s = _v1_predicate(inp["a1"], ap_s_b, inp["pol"])
    env_s = _dsse(jcsb(_statement(D_s, DEC_TYPE, "decision:dec-0001")), g_seed, g_kid)[0]
    ok("own: signed approval passes 3.11.3",
       step_of(lambda: check_receipt(1, ctx1(decision=env_s, approval=ap_s_b, approver_check=True))) == "pass")
    ok("own: approver-2 key fails check 3",
       step_of(lambda: check_receipt(1, ctx1(decision=env_s, approval=ap_s_b, approver_check=True,
                                             approver_key=keys["approver-2"][1]))) == "approver signature")
    ok("own: no action bytes fails the approver signature (check 1)",
       step_of(lambda: check_receipt(1, ctx1(decision=env_s, approval=ap_s_b, approver_check=True, action=None)))
       == "approver signature")
    ok("own: unsigned record with the check asked fails check 2",
       step_of(lambda: check_receipt(1, ctx1(approver_check=True))) == "approver signature")
    ok("own: signed record without the check asked passes Case 1",
       step_of(lambda: check_receipt(1, ctx1(decision=env_s, approval=ap_s_b))) == "pass")

    # Appendix B: COSE_Sign1 receipts of the V1-good predicate, built here
    cose_ok = _cose(D, "decision", g_seed)
    ok("own: COSE_Sign1 of V1-good passes Case 1",
       step_of(lambda: check_receipt(1, ctx1(decision=cose_ok, decision_binding="cose"))) == "pass")
    ok("own: COSE_Sign1 under the DSSE binding fails 3.2 step 1",
       step_of(lambda: check_receipt(1, ctx1(decision=cose_ok))) == "3.2 step 1")
    for name, kw, want in [
        ("sub with a space", {"sub": "decision:dec 0001"}, "3.2 step 1"),
        ("iss with a space and no colon", {"iss": "gate 1"}, "pass"),
        ("iss with a colon and a space", {"iss": "gate: 1"}, "3.2 step 1"),
        ("iss of 8193 code points", {"iss": "g" * 8193}, "3.2 step 1"),
        ("no tag 18", {"tag": False}, "3.2 step 1"),
        ("payload nil", {"payload_nil": True}, "3.2 step 2"),
        ("type of the outcome receipt", {"ptype": OUT_TYPE}, "3.2 step 6"),
        ("sub naming another decisionId", {"sub": "decision:dec-0002"}, "3.2 step 6"),
        ("crit in the unprotected header", {"unprot": {2: [1]}}, "3.2 step 1"),
        ("kid repeated in the unprotected header", {"unprot": {4: b"x"}}, "3.2 step 1"),
    ]:
        m = _cose(D, "decision", g_seed, **kw)
        ok("own: COSE %s: %s" % (name, want),
           step_of(lambda: check_receipt(1, ctx1(decision=m, decision_binding="cose"))) == want)
    ok("own: COSE with a byte after the item fails 3.2 step 1",
       step_of(lambda: check_receipt(1, ctx1(decision=cose_ok + b"\x00", decision_binding="cose"))) == "3.2 step 1")
    ok("own: COSE with a non-shortest length fails 3.2 step 1",
       step_of(lambda: check_receipt(1, ctx1(decision=b"\xd2\x98\x04" + cose_ok[2:], decision_binding="cose")))
       == "3.2 step 1")

    # 3.2 step 3: the identity point as expected key
    O_key = b"\x01" + b"\x00" * 31
    O_sig = b"\x01" + b"\x00" * 31 + b"\x00" * 32
    ok("3.2 step 3: R = O, S = 0 satisfies the bare equation under the identity key",
       _pure_equation(O_key, O_sig, b"any message"))
    ok("3.2 step 3: the identity key is refused", not ed25519_verify(O_key, O_sig, b"any message"))
    ok("3.2 step 3: y = p (not canonical) does not decode", _pt_decode(_P.to_bytes(32, "little")) is None)
    S_big = bytearray(base64.b64decode(sig_b64))
    s_int = int.from_bytes(bytes(S_big[32:]), "little") + _L
    ok("3.2 step 3: S + L does not verify",
       s_int >= 2 ** 256 or not ed25519_verify(g_pub, bytes(S_big[:32]) + s_int.to_bytes(32, "little"),
                                               pae(PTYPE.encode(), P)))

    # 3.2 step 4 and 3.1 depth
    def s4(b):
        try:
            step4_canonical(b)
            return True
        except ValueError:
            return False

    ok("3.2 step 4: 9007199254740993 fails", not s4(b'{"a":9007199254740993}'))
    ok("3.2 step 4: integer literal 9007199254740992 fails even though canonical", not s4(b'{"a":9007199254740992}'))
    ok("3.2 step 4: 1e+21 passes", s4(b'{"a":1e+21}'))
    ok("3.2 step 4: unpaired surrogate fails", not s4(b'{"a":"\\ud800"}'))
    ok("3.2 step 4: duplicate member fails", not s4(b'{"a":1,"a":1}'))
    ok("3.2 step 4: NaN fails", not s4(b'{"a":NaN}'))
    ok("3.1: depth 64 parses", s4(b"[" * 65 + b"]" * 65))
    ok("3.1: depth 65 does not parse", not s4(b"[" * 66 + b"]" * 66))

    # 3.8 timestamps and 3.10 base64
    for t, want in [("2026-10-15T09:00:00Z", True), ("2026-10-15T09:00:00.123456Z", True),
                    ("2026-10-15T09:00:00.1234567Z", False), ("2026-02-29T00:00:00Z", False),
                    ("2028-02-29T00:00:00Z", True), ("0000-01-01T00:00:00Z", False),
                    ("2026-10-15T09:00:60Z", False), ("2026-10-15t09:00:00Z", False), ("2026-10-15T09:00:00z", False),
                    ("2026-10-15T09:00:00Z\n", False), ("2026-10-15T24:00:00Z", False)]:
        ok("3.8 timestamp %r: %s" % (t, want), is_ts(t) == want)
    for x, want in [("QQ==", True), ("QR==", False), ("QQ", False), ("QQ==\n", False), ("Q-==", False), ("", True)]:
        try:
            b64strict(x)
            got = True
        except ValueError:
            got = False
        ok("3.10 base64 %r: %s" % (x, want), got == want)
    for s, want in [("decision:dec-0001", True), ("decision:dec 0001", False), ("gate 1", True),
                    ("https://a.example/x?y#z", True), (":abc", False), ("urn:x:\u00e9", False),
                    ("http://[::1]/", True), ("http://[::1/", False)]:
        ok("StringOrURI %r: %s" % (s, want), string_or_uri(s) == want)
    ok("3.5 jcs-sha256-v1 of the parsed payload is the content root", sha(jcsb(parse_json(P))) == sha(P))

    # 3.5 on receipts built here
    D2 = _v1_predicate(inp["a1"], inp["ap"], inp["pol"])
    D2["decisionId"] = "dec-0002"
    D2["validity"]["nonce"] = "dec-0002"
    env2 = _dsse(jcsb(_statement(D2, DEC_TYPE, "decision:dec-0002")), g_seed, g_kid)[0]
    held = [{"name": "V1-good", "bytes": env, "binding": "dsse", "keys": [g_pub]},
            {"name": "D2", "bytes": env2, "binding": "dsse", "keys": [g_pub]}]
    R2 = sha(base64.b64decode(json.loads(env2)["payload"]))
    ac = jcsb({"consumptionScope": {"id": "s", "decisions": [sha(P), R2]}})
    sc = set_checks({"policy": pol, "held": held, "approvals": [inp["ap"]], "first": True, "audit_context": ac})
    ok("own 3.5: two ALLOW payloads citing one approval identity fail the first check", sc["first"]["result"] == "fail")
    sc = set_checks({"policy": pol, "held": held, "approvals": [inp["ap"]], "first": True})
    ok("own 3.5: no scope gives no result", sc["first"]["result"] == "no result")
    sc = set_checks({"policy": pol, "held": held, "approvals": [inp["ap"]], "first": True,
                     "audit_context": jcsb({"consumptionScope": {"id": "s", "decisions": [sha(P), R2]},
                                            "unreleased": [R2]})})
    ok("own 3.5: an unreleased ALLOW does not count", sc["first"]["result"] == "pass")
    sc = set_checks({"policy": pol, "held": held, "approvals": [inp["ap"]], "first": True, "audit_context": b"{"})
    ok("own 3.5: an unreadable audit context gives no result", sc["first"]["result"] == "no result")
    sc = set_checks({"policy": pol, "held": held[:1] + [dict(held[0], name="V1-copy")], "approvals": [inp["ap"]],
                     "first": True, "audit_context": ac})
    ok("own 3.5: copies of one payload do not fail the first check", sc["first"]["result"] == "pass")
    D3 = _v1_predicate(inp["a1"], inp["ap"], inp["pol"])
    D3["decisionId"] = "dec-0003"
    D3["relationships"] = [{"relation": "supersedes",
                            "targetReceiptDigest": {"digestAlgorithm": "jcs-sha256-v1", "digest": sha(P)},
                            "targetSubjectDigest": {"digestAlgorithm": "jcs-sha256-v1", "digest": sha(jcsb(D))}}]
    env3 = _dsse(jcsb(_statement(D3, DEC_TYPE, "decision:dec-0003")), g_seed, g_kid)[0]
    s3 = [{"name": "D3", "bytes": env3, "binding": "dsse", "keys": [g_pub], "kind": "decision"}]
    sc = set_checks({"policy": pol, "held": held, "third": True, "subjects": s3})
    ok("own 3.5: supersedes a held receipt passes the third check", sc["third"]["result"] == "pass")
    sc = set_checks({"policy": pol, "held": held[1:], "third": True, "subjects": s3})
    ok("own 3.5: supersedes a receipt not held fails the third check", sc["third"]["result"] == "fail")
    sc = set_checks({"policy": pol, "held": held + [{"name": "bad", "bytes": env_bad, "binding": "dsse",
                                                      "keys": [g_pub]}], "third": True, "subjects": s3})
    ok("own 3.5: a held receipt failing the preliminary checks makes the third check give no result",
       sc["third"]["result"] == "no result")
    ok("own 4 item 2: a copy received with an earlier validUntil refuses",
       step_of(lambda: check_receipt(1, ctx1(relying_party=True, state=b"[]", received=jcsb(
           [dict(ap_obj, validUntil="2026-10-15T09:00:30Z")])))) == "Section 4 item 2")
    ok("own 3.1: Case 3 without an outcome receipt gives no result (R-20, 0.2.1)",
       check_receipt(3, ctx1(action=None, approval=None, executor_id="forge:agent-42-bot"))["result"] == "no result")
    ok("own R-18 0.2.1: -held without a binding is dsse", held_arg("AAAA:x.json") == ("dsse", "AAAA", "x.json"))
    ok("own R-18 0.2.1: -held cose:key:file names the binding", held_arg("cose:AAAA:x.cbor") == ("cose", "AAAA", "x.cbor"))
    ok("own R-18 0.2.1: a file name with a colon stays whole", held_arg("dsse:AAAA:a:b.json") == ("dsse", "AAAA", "a:b.json"))

    ok("Ed25519: cryptography and the group equation agreed throughout", not ED_DISAGREE)
    bad = [n for n, c in res if not c]
    print("%d checks, %d NG" % (len(res), len(bad)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
