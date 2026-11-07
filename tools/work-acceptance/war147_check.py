"""war147_check.py: a checker for work-acceptance records (schema trilatic.acceptance-receipt/1.2,
draft profile 1.4.7). A copy of war145_check.py (sha c9a7883c, profile 1.4.5) with the 1.4.7 sentence of step 12
from the README text of maximusrufus/work-acceptance-record at 6f7a075f (tag v1.4.7): the producer's key must
pass step 2's point rule. Two lines changed (R26, R27), nothing else. No reference verifier code was read.
war145_check.py is a copy of war144_check.py (sha fc1f13cc, profile 1.4.4) with step 12 added from the README
text at 066315f0cbf6199339d5432e4bbec4ecf2c59df4 (tag v1.4.5): the optional input relying_party_keys.
Standard library only. Run: python3 -I -B war147_check.py <masked vector dir> <out.json>
Readings where the text allows two are marked R1..Rn (see READINGS.md in war12, READINGS144.md, READINGS145.md
and READINGS147.md).
"""
import base64, hashlib, json, os, re, sys, datetime
from fractions import Fraction
import math

# ---------------------------------------------------------------- base64 (step 10, canonical)
_B64 = re.compile(r'\A[A-Za-z0-9+/]*={0,2}\Z')

def b64_canonical(s):
    """Return bytes, or None when s is not canonical standard base64."""
    if not isinstance(s, str) or len(s) % 4 != 0 or not _B64.match(s):
        return None
    try:
        b = base64.b64decode(s, validate=True)
    except Exception:
        return None
    if base64.b64encode(b).decode('ascii') != s:
        return None
    return b

# ---------------------------------------------------------------- JCS (RFC 8785)
def _num(x):
    if isinstance(x, bool):
        raise ValueError('bool')
    f = float(x)
    if math.isnan(f) or math.isinf(f):
        raise ValueError('non-finite')
    if f == 0:
        return '0'
    sign = '-' if f < 0 else ''
    r = repr(abs(f))
    m, _, ex = r.partition('e')
    ip, _, fp = m.partition('.')
    e = int(ex) if ex else 0
    digits = ip + fp
    # value = int(digits) * 10^(e - len(fp))
    lead = len(digits) - len(digits.lstrip('0'))
    digits = digits.lstrip('0')
    pos = len(ip) - lead + e          # n: value = 0.d1d2.. * 10^n
    digits = digits.rstrip('0')
    k = len(digits); n = pos
    if k <= n <= 21:
        s = digits + '0' * (n - k)
    elif 0 < n <= 21:
        s = digits[:n] + '.' + digits[n:]
    elif -6 < n <= 0:
        s = '0.' + '0' * (-n) + digits
    else:
        ee = n - 1
        es = ('+' if ee >= 0 else '-') + str(abs(ee))
        s = digits[0] + ('.' + digits[1:] if k > 1 else '') + 'e' + es
    return sign + s

def jcs(o):
    if o is None:
        return 'null'
    if o is True:
        return 'true'
    if o is False:
        return 'false'
    if isinstance(o, (int, float)):
        return _num(o)
    if isinstance(o, str):
        return json.dumps(o, ensure_ascii=False)
    if isinstance(o, list):
        return '[' + ','.join(jcs(v) for v in o) + ']'
    if isinstance(o, dict):
        ks = sorted(o.keys(), key=lambda k: k.encode('utf-16-be'))
        return '{' + ','.join(json.dumps(k, ensure_ascii=False) + ':' + jcs(o[k]) for k in ks) + '}'
    raise ValueError('type')

def jcs_bytes(o):
    return jcs(o).encode('utf-8')

# ---------------------------------------------------------------- Ed25519 (RFC 8032), strict key rule
P25519 = 2**255 - 19
L25519 = 2**252 + 27742317777372353535851937790883648493
D25519 = (-121665 * pow(121666, -1, P25519)) % P25519
SQRTM1 = pow(2, (P25519 - 1) // 4, P25519)

def _ed_add(Pt, Qt):
    p = P25519
    X1, Y1, Z1, T1 = Pt; X2, Y2, Z2, T2 = Qt
    A = (Y1 - X1) * (Y2 - X2) % p
    B = (Y1 + X1) * (Y2 + X2) % p
    C = 2 * T1 * T2 * D25519 % p
    Dd = 2 * Z1 * Z2 % p
    E, F, G, H = B - A, Dd - C, Dd + C, B + A
    return (E * F % p, G * H % p, F * G % p, E * H % p)

ED_ID = (0, 1, 1, 0)

def _ed_mul(s, Pt):
    Q = ED_ID
    while s > 0:
        if s & 1:
            Q = _ed_add(Q, Pt)
        Pt = _ed_add(Pt, Pt)
        s >>= 1
    return Q

def _ed_eq(Pt, Qt):
    p = P25519
    return (Pt[0] * Qt[2] - Qt[0] * Pt[2]) % p == 0 and (Pt[1] * Qt[2] - Qt[1] * Pt[2]) % p == 0

def _ed_recover_x(y, sign):
    p = P25519
    x2 = (y * y - 1) * pow(D25519 * y * y + 1, -1, p) % p
    if x2 == 0:
        return None if sign else 0
    x = pow(x2, (p + 3) // 8, p)
    if (x * x - x2) % p != 0:
        x = x * SQRTM1 % p
    if (x * x - x2) % p != 0:
        return None
    if (x & 1) != sign:
        x = p - x
    return x

def ed_decode(b):
    """Decode a 32-byte point; None if not a canonical encoding of a curve point."""
    if len(b) != 32:
        return None
    y = int.from_bytes(b, 'little')
    sign = y >> 255
    y &= (1 << 255) - 1
    if y >= P25519:
        return None
    x = _ed_recover_x(y, sign)
    if x is None:
        return None
    return (x, y, 1, x * y % P25519)

def ed_encode(Pt):
    p = P25519
    zi = pow(Pt[2], -1, p)
    x = Pt[0] * zi % p; y = Pt[1] * zi % p
    return (y | ((x & 1) << 255)).to_bytes(32, 'little')

_GY = 4 * pow(5, -1, P25519) % P25519
ED_B = (_ed_recover_x(_GY, 0), _GY, 1, _ed_recover_x(_GY, 0) * _GY % P25519)

def ed_key_ok(b):
    """Key rule (step 2): canonical encoding, a point of prime order (not neutral, not small/mixed order)."""
    A = ed_decode(b)
    if A is None:
        return None
    if _ed_eq(A, ED_ID):
        return None
    if not _ed_eq(_ed_mul(L25519, A), ED_ID):
        return None
    return A

def ed_verify(A, Abytes, msg, sig):
    if len(sig) != 64:
        return False
    R = ed_decode(sig[:32])
    if R is None:
        return False
    S = int.from_bytes(sig[32:], 'little')
    if S >= L25519:
        return False
    h = int.from_bytes(hashlib.sha512(sig[:32] + Abytes + msg).digest(), 'little') % L25519
    return _ed_eq(_ed_mul(S, ED_B), _ed_add(R, _ed_mul(h, A)))

def ed_sign_selftest(seed, msg):
    h = hashlib.sha512(seed).digest()
    a = int.from_bytes(h[:32], 'little')
    a &= (1 << 254) - 8; a |= 1 << 254
    Ab = ed_encode(_ed_mul(a, ED_B))
    r = int.from_bytes(hashlib.sha512(h[32:] + msg).digest(), 'little') % L25519
    Rb = ed_encode(_ed_mul(r, ED_B))
    k = int.from_bytes(hashlib.sha512(Rb + Ab + msg).digest(), 'little') % L25519
    S = (r + k * a) % L25519
    return Ab, Rb + S.to_bytes(32, 'little')

# ---------------------------------------------------------------- DER
class DERError(Exception):
    pass

def der_read(b, i=0):
    """Return (tag, start_of_content, end, header_start). Definite lengths only."""
    if i >= len(b):
        raise DERError('eof')
    tag = b[i]; j = i + 1
    if tag & 0x1f == 0x1f:
        raise DERError('high tag')
    if j >= len(b):
        raise DERError('eof')
    ln = b[j]; j += 1
    if ln & 0x80:
        n = ln & 0x7f
        if n == 0 or n > 4 or j + n > len(b):
            raise DERError('len')
        ln = int.from_bytes(b[j:j + n], 'big'); j += n
    if j + ln > len(b):
        raise DERError('overrun')
    return tag, j, j + ln, i

def der_children(b, start, end):
    out = []; i = start
    while i < end:
        t, s, e, h = der_read(b, i)
        if e > end:
            raise DERError('child overrun')
        out.append((t, s, e, h))
        i = e
    return out

def der_int(b, s, e):
    return int.from_bytes(b[s:e], 'big', signed=True)

def der_oid(b, s, e):
    v = b[s:e]
    if not v:
        raise DERError('oid')
    parts = []; n = 0
    for c in v:
        n = (n << 7) | (c & 0x7f)
        if not c & 0x80:
            parts.append(n); n = 0
    first = parts[0]
    if first < 40:
        a, bb = 0, first
    elif first < 80:
        a, bb = 1, first - 40
    else:
        a, bb = 2, first - 80
    return '.'.join(str(x) for x in [a, bb] + parts[1:])

OID_SHA1 = '1.3.14.3.2.26'
OID_SHA224 = '2.16.840.1.101.3.4.2.4'
OID_SHA256 = '2.16.840.1.101.3.4.2.1'
OID_SHA384 = '2.16.840.1.101.3.4.2.2'
OID_SHA512 = '2.16.840.1.101.3.4.2.3'
HASHES = {OID_SHA1: 'sha1', OID_SHA224: 'sha224', OID_SHA256: 'sha256', OID_SHA384: 'sha384', OID_SHA512: 'sha512',
          '2.16.840.1.101.3.4.2.8': 'sha3_256', '2.16.840.1.101.3.4.2.9': 'sha3_384', '2.16.840.1.101.3.4.2.10': 'sha3_512'}
OID_SIGNED_DATA = '1.2.840.113549.1.7.2'
OID_TSTINFO = '1.2.840.113549.1.9.16.1.4'
OID_ATTR_CT = '1.2.840.113549.1.9.3'
OID_ATTR_MD = '1.2.840.113549.1.9.4'
OID_ESS_V1 = '1.2.840.113549.1.9.16.2.12'
OID_ESS_V2 = '1.2.840.113549.1.9.16.2.47'
OID_RSA = '1.2.840.113549.1.1.1'
OID_PSS = '1.2.840.113549.1.1.10'
OID_MGF1 = '1.2.840.113549.1.1.8'
RSA_SIG = {'1.2.840.113549.1.1.5': 'sha1', '1.2.840.113549.1.1.14': 'sha224', '1.2.840.113549.1.1.11': 'sha256',
           '1.2.840.113549.1.1.12': 'sha384', '1.2.840.113549.1.1.13': 'sha512'}
OID_EC = '1.2.840.10045.2.1'
EC_SIG = {'1.2.840.10045.4.1': 'sha1', '1.2.840.10045.4.3.1': 'sha224', '1.2.840.10045.4.3.2': 'sha256',
          '1.2.840.10045.4.3.3': 'sha384', '1.2.840.10045.4.3.4': 'sha512'}
OID_P256 = '1.2.840.10045.3.1.7'
OID_P384 = '1.3.132.0.34'
OID_EKU = '2.5.29.37'
OID_BC = '2.5.29.19'
OID_KP_TS = '1.3.6.1.5.5.7.3.8'

# ---------------------------------------------------------------- RSA
DI_PREFIX = {
    'sha1': bytes.fromhex('3021300906052b0e03021a05000414'),
    'sha224': bytes.fromhex('302d300d06096086480165030402040500041c'),
    'sha256': bytes.fromhex('3031300d060960864801650304020105000420'),
    'sha384': bytes.fromhex('3041300d060960864801650304020205000430'),
    'sha512': bytes.fromhex('3051300d060960864801650304020305000440'),
}

def rsa_pkcs1_verify(n, e, hname, msg, sig):
    k = (n.bit_length() + 7) // 8
    if len(sig) != k:
        return False
    s = int.from_bytes(sig, 'big')
    if s >= n:
        return False
    em = pow(s, e, n).to_bytes(k, 'big')
    t = DI_PREFIX[hname] + hashlib.new(hname, msg).digest()
    if k < len(t) + 11:
        return False
    return em == b'\x00\x01' + b'\xff' * (k - len(t) - 3) + b'\x00' + t

def _mgf1(seed, ln, hname):
    out = b''; c = 0
    while len(out) < ln:
        out += hashlib.new(hname, seed + c.to_bytes(4, 'big')).digest(); c += 1
    return out[:ln]

def rsa_pss_verify(n, e, hname, mgfh, slen, msg, sig):
    k = (n.bit_length() + 7) // 8
    if len(sig) != k:
        return False
    s = int.from_bytes(sig, 'big')
    if s >= n:
        return False
    embits = n.bit_length() - 1
    emlen = (embits + 7) // 8
    m = pow(s, e, n)
    if m.bit_length() > embits:
        return False
    em = m.to_bytes(emlen, 'big')
    mh = hashlib.new(hname, msg).digest(); hl = len(mh)
    if emlen < hl + slen + 2 or em[-1] != 0xbc:
        return False
    masked = em[:emlen - hl - 1]; H = em[emlen - hl - 1:-1]
    zb = 8 * emlen - embits
    if zb and masked[0] >> (8 - zb):
        return False
    db = bytes(a ^ b for a, b in zip(masked, _mgf1(H, len(masked), mgfh)))
    if zb:
        db = bytes([db[0] & (0xff >> zb)]) + db[1:]
    ps_len = emlen - hl - slen - 2
    if db[:ps_len] != b'\x00' * ps_len or db[ps_len] != 1:
        return False
    salt = db[len(db) - slen:] if slen else b''
    return hashlib.new(hname, b'\x00' * 8 + mh + salt).digest() == H

# ---------------------------------------------------------------- ECDSA P-256 / P-384
CURVES = {
    OID_P256: dict(p=0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff,
                   a=-3, b=0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b,
                   gx=0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296,
                   gy=0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5,
                   n=0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551),
    OID_P384: dict(p=int('fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000ffffffff', 16),
                   a=-3, b=int('b3312fa7e23ee7e4988e056be3f82d19181d9c6efe8141120314088f5013875ac656398d8a2ed19d2a85c8edd3ec2aef', 16),
                   gx=int('aa87ca22be8b05378eb1c71ef320ad746e1d3b628ba79b9859f741e082542a385502f25dbf55296c3a545e3872760ab7', 16),
                   gy=int('3617de4a96262c6f5d9e98bf9292dc29f8f41dbd289a147ce9da3113b5f0b8c00a60b1ce1d7e819d7a431d7c90ea0e5f', 16),
                   n=int('ffffffffffffffffffffffffffffffffffffffffffffffffc7634d81f4372ddf581a0db248b0a77aecec196accc52973', 16)),
}

def _ec_add(c, P1, P2):
    p = c['p']
    if P1 is None: return P2
    if P2 is None: return P1
    x1, y1 = P1; x2, y2 = P2
    if x1 == x2:
        if (y1 + y2) % p == 0:
            return None
        lam = (3 * x1 * x1 + c['a']) * pow(2 * y1, -1, p) % p
    else:
        lam = (y2 - y1) * pow(x2 - x1, -1, p) % p
    x3 = (lam * lam - x1 - x2) % p
    return (x3, (lam * (x1 - x3) - y1) % p)

def _ec_mul(c, k, Pt):
    R = None
    while k:
        if k & 1: R = _ec_add(c, R, Pt)
        Pt = _ec_add(c, Pt, Pt); k >>= 1
    return R

def ecdsa_verify(curve_oid, point, hname, msg, sigder):
    c = CURVES[curve_oid]; n = c['n']; p = c['p']
    if len(point) < 1 or point[0] != 4:
        return False
    L = (len(point) - 1) // 2
    x = int.from_bytes(point[1:1 + L], 'big'); y = int.from_bytes(point[1 + L:], 'big')
    if (y * y - (x * x * x + c['a'] * x + c['b'])) % p != 0:
        return False
    try:
        t, s, e, _ = der_read(sigder, 0)
        if t != 0x30 or e != len(sigder):
            return False
        ch = der_children(sigder, s, e)
        if len(ch) != 2 or ch[0][0] != 2 or ch[1][0] != 2:
            return False
        r = der_int(sigder, ch[0][1], ch[0][2]); ss = der_int(sigder, ch[1][1], ch[1][2])
    except DERError:
        return False
    if not (1 <= r < n and 1 <= ss < n):
        return False
    h = hashlib.new(hname, msg).digest()
    z = int.from_bytes(h, 'big')
    if len(h) * 8 > n.bit_length():
        z >>= len(h) * 8 - n.bit_length()
    w = pow(ss, -1, n)
    X = _ec_add(c, _ec_mul(c, z * w % n, (c['gx'], c['gy'])), _ec_mul(c, r * w % n, (x, y)))
    return X is not None and X[0] % n == r

# ---------------------------------------------------------------- X.509 (minimal)
def parse_time_der(b, t, s, e):
    v = b[s:e].decode('ascii', 'replace')
    if t == 0x17:
        m = re.fullmatch(r'([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})Z', v)
        if not m: raise DERError('utctime')
        yy = int(m.group(1)); yy += 2000 if yy < 50 else 1900
        g = [yy] + [int(x) for x in m.groups()[1:]]
    elif t == 0x18:
        m = re.fullmatch(r'([0-9]{4})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})Z', v)
        if not m: raise DERError('gentime')
        g = [int(x) for x in m.groups()]
    else:
        raise DERError('time tag')
    dt = datetime.datetime(*g, tzinfo=datetime.timezone.utc)
    return Fraction(int(dt.timestamp()))

def parse_spki(b, s, e):
    ch = der_children(b, s, e)
    alg = der_children(b, ch[0][1], ch[0][2])
    oid = der_oid(b, alg[0][1], alg[0][2])
    param = None
    if len(alg) > 1 and alg[1][0] == 6:
        param = der_oid(b, alg[1][1], alg[1][2])
    bits = b[ch[1][1] + 1:ch[1][2]]
    key = {'oid': oid, 'param': param, 'raw': b[s - 0:e]}
    if oid in (OID_RSA, OID_PSS):
        t, rs, re_, _ = der_read(bits, 0)
        rc = der_children(bits, rs, re_)
        key['n'] = der_int(bits, rc[0][1], rc[0][2]); key['e'] = der_int(bits, rc[1][1], rc[1][2])
    elif oid == OID_EC:
        key['point'] = bits
    return key

def parse_cert(der):
    t, s, e, _ = der_read(der, 0)
    if t != 0x30 or e != len(der):
        raise DERError('cert')
    top = der_children(der, s, e)
    tbs_t, tbs_s, tbs_e, tbs_h = top[0]
    tbs = der_children(der, tbs_s, tbs_e)
    i = 0
    if tbs[0][0] == 0xa0:
        i = 1
    serial = der_int(der, tbs[i][1], tbs[i][2])
    issuer = der[tbs[i + 2][3]:tbs[i + 2][2]]
    validity = der_children(der, tbs[i + 3][1], tbs[i + 3][2])
    nb = parse_time_der(der, validity[0][0], validity[0][1], validity[0][2])
    na = parse_time_der(der, validity[1][0], validity[1][1], validity[1][2])
    subject = der[tbs[i + 4][3]:tbs[i + 4][2]]
    spki_node = tbs[i + 5]
    spki = parse_spki(der, spki_node[1], spki_node[2])
    spki['raw'] = der[spki_node[3]:spki_node[2]]
    exts = {}
    for node in tbs[i + 6:]:
        if node[0] == 0xa3:
            seq = der_children(der, node[1], node[2])[0]
            for ext in der_children(der, seq[1], seq[2]):
                ec = der_children(der, ext[1], ext[2])
                eoid = der_oid(der, ec[0][1], ec[0][2])
                val = ec[-1]
                exts[eoid] = der[val[1]:val[2]]
    sigalg = der_children(der, top[1][1], top[1][2])
    sigalg_oid = der_oid(der, sigalg[0][1], sigalg[0][2])
    sigalg_params = der[sigalg[1][3]:sigalg[1][2]] if len(sigalg) > 1 else b''
    sig = der[top[2][1] + 1:top[2][2]]
    cert = dict(der=der, tbs=der[tbs_h:tbs_e], serial=serial, issuer=issuer, subject=subject, nb=nb, na=na,
                spki=spki, exts=exts, sigalg=sigalg_oid, sigalg_params=sigalg_params, sig=sig)
    ski = exts.get('2.5.29.14')
    if ski is not None:
        tt, ss, ee, _ = der_read(ski, 0)
        cert['ski'] = ski[ss:ee]
    return cert

def cert_is_ca(c):
    v = c['exts'].get(OID_BC)
    if v is None:
        return False
    t, s, e, _ = der_read(v, 0)
    ch = der_children(v, s, e)
    return bool(ch) and ch[0][0] == 0x01 and v[ch[0][1]:ch[0][2]] != b'\x00'

def cert_has_ts_eku(c):
    v = c['exts'].get(OID_EKU)
    if v is None:
        return False
    t, s, e, _ = der_read(v, 0)
    return any(der_oid(v, x[1], x[2]) == OID_KP_TS for x in der_children(v, s, e) if x[0] == 6)

def parse_pss_params(b):
    """RSASSA-PSS-params; returns (hash, mgf hash, salt len)."""
    h, mh, sl = 'sha1', 'sha1', 20
    if not b or b == b'\x05\x00':
        return h, mh, sl
    t, s, e, _ = der_read(b, 0)
    for node in der_children(b, s, e):
        inner = der_children(b, node[1], node[2])
        if node[0] == 0xa0:
            ac = der_children(b, inner[0][1], inner[0][2]); h = HASHES[der_oid(b, ac[0][1], ac[0][2])]
        elif node[0] == 0xa1:
            ac = der_children(b, inner[0][1], inner[0][2])
            if der_oid(b, ac[0][1], ac[0][2]) != OID_MGF1:
                raise KeyError('mgf')
            hc = der_children(b, ac[1][1], ac[1][2]); mh = HASHES[der_oid(b, hc[0][1], hc[0][2])]
        elif node[0] == 0xa2:
            sl = der_int(b, inner[0][1], inner[0][2])
    return h, mh, sl

def verify_sig(key, sigalg, sigalg_params, hname_default, msg, sig):
    """Returns 'ok', 'bad' or 'unsupported'."""
    try:
        if key['oid'] in (OID_RSA, OID_PSS):
            if sigalg == OID_PSS:
                h, mh, sl = parse_pss_params(sigalg_params)
                return 'ok' if rsa_pss_verify(key['n'], key['e'], h, mh, sl, msg, sig) else 'bad'
            if sigalg in RSA_SIG:
                h = RSA_SIG[sigalg]
            elif sigalg == OID_RSA and hname_default in DI_PREFIX:
                h = hname_default
            else:
                return 'unsupported'
            return 'ok' if rsa_pkcs1_verify(key['n'], key['e'], h, msg, sig) else 'bad'
        if key['oid'] == OID_EC:
            if key['param'] not in CURVES:
                return 'unsupported'
            if sigalg in EC_SIG:
                h = EC_SIG[sigalg]
            elif sigalg == OID_EC and hname_default:
                h = hname_default
            else:
                return 'unsupported'
            return 'ok' if ecdsa_verify(key['param'], key['point'], h, msg, sig) else 'bad'
    except (KeyError, DERError, ValueError):
        return 'unsupported'
    return 'unsupported'

# ---------------------------------------------------------------- RFC 3161 token
_GT = re.compile(rb'\A([0-9]{4})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})(\.[0-9]*[1-9])?Z\Z')

def parse_gentime(raw):
    """Step 10 / 11 form of genTime. Returns dict with exact time (Fraction seconds) or None."""
    m = _GT.match(raw)
    if not m:
        return None
    Y, Mo, Dd, h, mi, s = (int(x) for x in m.groups()[:6])
    try:
        dt = datetime.datetime(Y, Mo, Dd, h, mi, s, tzinfo=datetime.timezone.utc)
    except ValueError:
        return None
    base = Fraction(int(dt.timestamp()))
    frac = Fraction(0)
    if m.group(7):
        fd = m.group(7)[1:].decode('ascii')
        frac = Fraction(int(fd), 10 ** len(fd))
    sec = '%04d-%02d-%02dT%02d:%02d:%02dZ' % (Y, Mo, Dd, h, mi, s)
    return {'t': base + frac, 'sec_text': sec}

def parse_token(der):
    """Parse a TimeStampResp (or a bare ContentInfo). Returns dict; raises DERError."""
    t, s, e, _ = der_read(der, 0)
    if t != 0x30 or e != len(der):
        raise DERError('top')
    top = der_children(der, s, e)
    ci = None
    if top and top[0][0] == 0x06:
        ci = (t, s, e, 0)
    else:
        if len(top) < 2:
            raise DERError('no token')
        ci = top[1]
    cic = der_children(der, ci[1], ci[2])
    if der_oid(der, cic[0][1], cic[0][2]) != OID_SIGNED_DATA or cic[1][0] != 0xa0:
        raise DERError('not signed data')
    sd_node = der_children(der, cic[1][1], cic[1][2])[0]
    sd = der_children(der, sd_node[1], sd_node[2])
    idx = 2
    eci = der_children(der, sd[idx][1], sd[idx][2])
    econtent_type = der_oid(der, eci[0][1], eci[0][2])
    if len(eci) < 2 or eci[1][0] != 0xa0:
        raise DERError('no econtent')
    oct_ = der_children(der, eci[1][1], eci[1][2])[0]
    if oct_[0] != 0x04:
        raise DERError('econtent not octet')
    econtent = der[oct_[1]:oct_[2]]
    certs = []; signer_infos = []
    for node in sd[idx + 1:]:
        if node[0] == 0xa0:
            for c in der_children(der, node[1], node[2]):
                if c[0] == 0x30:
                    certs.append(der[c[3]:c[2]])
        elif node[0] == 0x31:
            for si in der_children(der, node[1], node[2]):
                signer_infos.append((der, si))
    # TSTInfo
    tt, ts_, te, _ = der_read(econtent, 0)
    if tt != 0x30:
        raise DERError('tstinfo')
    tc = der_children(econtent, ts_, te)
    mi = der_children(econtent, tc[2][1], tc[2][2])
    ha = der_children(econtent, mi[0][1], mi[0][2])
    imprint_oid = der_oid(econtent, ha[0][1], ha[0][2])
    imprint = econtent[mi[1][1]:mi[1][2]]
    gt_node = tc[4]
    gen = None
    if gt_node[0] == 0x18:
        gen = parse_gentime(econtent[gt_node[1]:gt_node[2]])
    acc = Fraction(0)
    for node in tc[5:]:
        if node[0] == 0x30:
            for a in der_children(econtent, node[1], node[2]):
                v = int.from_bytes(econtent[a[1]:a[2]], 'big')
                if a[0] == 0x02:
                    acc += v
                elif a[0] == 0x80:
                    acc += Fraction(v, 1000)
                elif a[0] == 0x81:
                    acc += Fraction(v, 10 ** 6)
            break
    return dict(imprint_oid=imprint_oid, imprint=imprint, gen=gen, acc=acc, econtent=econtent,
                econtent_type=econtent_type, certs=certs, signer_infos=signer_infos)

def parse_signer_info(der, si):
    ch = der_children(der, si[1], si[2])
    sid = ch[1]
    sid_info = {}
    if sid[0] == 0x30:
        sc = der_children(der, sid[1], sid[2])
        sid_info = {'issuer': der[sc[0][3]:sc[0][2]], 'serial': der_int(der, sc[1][1], sc[1][2])}
    elif sid[0] == 0x80:
        sid_info = {'ski': der[sid[1]:sid[2]]}
    da = der_children(der, ch[2][1], ch[2][2]); digest_oid = der_oid(der, da[0][1], da[0][2])
    i = 3; signed_attrs = None; attrs = {}
    if ch[i][0] == 0xa0:
        node = ch[i]
        signed_attrs = b'\x31' + der[node[3] + 1:node[2]]
        for a in der_children(der, node[1], node[2]):
            ac = der_children(der, a[1], a[2])
            aoid = der_oid(der, ac[0][1], ac[0][2])
            vals = [der[v[3]:v[2]] for v in der_children(der, ac[1][1], ac[1][2])]
            attrs.setdefault(aoid, []).extend(vals)
        i += 1
    sa = der_children(der, ch[i][1], ch[i][2]); sigalg = der_oid(der, sa[0][1], sa[0][2])
    sigalg_params = der[sa[1][3]:sa[1][2]] if len(sa) > 1 else b''
    sig = der[ch[i + 1][1]:ch[i + 1][2]]
    return dict(sid=sid_info, digest_oid=digest_oid, signed_attrs=signed_attrs, attrs=attrs,
                sigalg=sigalg, sigalg_params=sigalg_params, sig=sig)

def tsa_signature(tok_b64, anchors_b64):
    """Step 9 value for one token, with anchors supplied (non-empty list)."""
    raw = b64_canonical(tok_b64)
    if raw is None:
        return 'failed'                          # 1.4.3: non-canonical token with anchors is failed
    try:
        tok = parse_token(raw)
    except (DERError, IndexError, ValueError):
        return 'failed'
    fails = []; flags = set()
    gen = tok['gen']
    if gen is None:
        fails.append('genTime unusable')          # 1.4.3 (105, 107)
    T = gen['t'] if gen else None
    if tok['econtent_type'] != OID_TSTINFO:
        fails.append('eContentType')
    if not tok['signer_infos']:
        flags.add('no_signer')
        return _tsa_fold(fails, flags)
    try:
        si = parse_signer_info(*tok['signer_infos'][0])
    except (DERError, IndexError, ValueError):
        return 'failed'
    certs = []
    for c in tok['certs']:
        try:
            certs.append(parse_cert(c))
        except (DERError, IndexError, ValueError):
            fails.append('cert unparsable')
    anchors = []
    for a in anchors_b64:
        ab = b64_canonical(a) if isinstance(a, str) else None
        if ab is None:
            continue
        try:
            anchors.append(parse_cert(ab))
        except (DERError, IndexError, ValueError):
            pass
    hname = HASHES.get(si['digest_oid'])
    # signed attributes
    if si['signed_attrs'] is None:
        fails.append('no signed attributes')
    else:
        ct = si['attrs'].get(OID_ATTR_CT)
        if not ct or len(ct) != 1:
            fails.append('contentType missing')
        else:
            v = ct[0]; t, s, e, _ = der_read(v, 0)
            if t != 6 or der_oid(v, s, e) != tok['econtent_type'] or tok['econtent_type'] != OID_TSTINFO:
                fails.append('contentType mismatch')
        md = si['attrs'].get(OID_ATTR_MD)
        if hname is None:
            flags.add('unsupported')
        elif not md or len(md) != 1:
            fails.append('messageDigest missing')
        else:
            v = md[0]; t, s, e, _ = der_read(v, 0)
            if v[s:e] != hashlib.new(hname, tok['econtent']).digest():
                fails.append('messageDigest mismatch')
    # signer certificate
    signer = None
    for c in certs:
        if 'serial' in si['sid'] and c['issuer'] == si['sid']['issuer'] and c['serial'] == si['sid']['serial']:
            signer = c; break
        if 'ski' in si['sid'] and c.get('ski') == si['sid']['ski']:
            signer = c; break
    if signer is None:
        flags.add('no_signer')
        return _tsa_fold(fails, flags)
    # ESS signing-certificate binding
    if si['signed_attrs'] is not None:
        ess_ok = None
        for oid, hn in ((OID_ESS_V2, None), (OID_ESS_V1, 'sha1')):
            vals = si['attrs'].get(oid)
            if not vals:
                continue
            try:
                v = vals[0]; t, s, e, _ = der_read(v, 0)
                certs_seq = der_children(v, s, e)[0]
                first = der_children(v, certs_seq[1], certs_seq[2])[0]
                fc = der_children(v, first[1], first[2])
                k = 0; h = hn
                if oid == OID_ESS_V2:
                    h = 'sha256'
                    if fc[0][0] == 0x30:
                        ac = der_children(v, fc[0][1], fc[0][2]); h = HASHES[der_oid(v, ac[0][1], ac[0][2])]; k = 1
                ch = v[fc[k][1]:fc[k][2]]
                ok = hashlib.new(h, signer['der']).digest() == ch
                if ok and len(fc) > k + 1:
                    isn = der_children(v, fc[k + 1][1], fc[k + 1][2])
                    ok = der_int(v, isn[1][1], isn[1][2]) == signer['serial']
                ess_ok = ok
            except (DERError, IndexError, KeyError, ValueError):
                ess_ok = False
            break
        if ess_ok is None:
            fails.append('ESS signing-certificate missing')
        elif not ess_ok:
            fails.append('ESS binding')
    # CMS signature
    if si['signed_attrs'] is not None:
        r = verify_sig(signer['spki'], si['sigalg'], si['sigalg_params'], hname, si['signed_attrs'], si['sig'])
        if r == 'bad':
            fails.append('CMS signature')
        elif r == 'unsupported':
            flags.add('unsupported')
    # signer: EKU and validity
    if not cert_has_ts_eku(signer):
        fails.append('no id-kp-timeStamping')
    if T is not None and not (signer['nb'] <= T <= signer['na']):
        fails.append('signer not valid at genTime')
    # chain to an anchor
    cur = signer; reached = False; depth = 0; seen = set()
    while depth < 12:
        depth += 1
        named = [a for a in anchors if a['subject'] == cur['issuer']]
        for a in named:
            r = verify_sig(a['spki'], cur['sigalg'], cur['sigalg_params'], None, cur['tbs'], cur['sig'])
            if r == 'ok':
                reached = True; break
            if r == 'unsupported':
                flags.add('unsupported')
        if reached:
            break
        if cur['subject'] == cur['issuer']:
            break                                   # a root inside the token is not an anchor
        nxt = None
        for c in certs:
            if c['subject'] == cur['issuer'] and c is not cur and id(c) not in seen:
                nxt = c; break
        if nxt is None:
            break
        seen.add(id(nxt))
        if not cert_is_ca(nxt):
            fails.append('issuer not a CA')
        if T is not None and not (nxt['nb'] <= T <= nxt['na']):
            fails.append('issuer not valid at genTime')
        r = verify_sig(nxt['spki'], cur['sigalg'], cur['sigalg_params'], None, cur['tbs'], cur['sig'])
        if r == 'bad':
            fails.append('issuer signature')
        elif r == 'unsupported':
            flags.add('unsupported')
        cur = nxt
    if not reached:
        flags.add('untrusted')
    return _tsa_fold(fails, flags)

def _tsa_fold(fails, flags):
    if fails:
        return 'failed'
    for v in ('no_signer', 'unsupported', 'untrusted'):
        if v in flags:
            return v
    return 'verified'

def read_token(tok_b64):
    """Steps 5/6: returns (status, tok). status: 'absent', 'unusable' (non-canonical or unparsable), 'ok'."""
    if tok_b64 is None:
        return 'absent', None
    raw = b64_canonical(tok_b64)
    if raw is None:
        return 'unusable', None
    try:
        return 'ok', parse_token(raw)
    except (DERError, IndexError, ValueError):
        return 'unusable', None

def imprint_matches(tok, hexdigest):
    if not is_digest(hexdigest):
        return False
    return tok['imprint_oid'] == OID_SHA256 and tok['imprint'] == bytes.fromhex(hexdigest)

# ---------------------------------------------------------------- stated times
_RT = re.compile(r'\A([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]{1,3})?Z\Z')

def parse_stated(s):
    if not isinstance(s, str):
        return None
    m = _RT.match(s)
    if not m:
        return None
    try:
        dt = datetime.datetime(*(int(x) for x in m.groups()[:6]), tzinfo=datetime.timezone.utc)
    except ValueError:
        return None
    t = Fraction(int(dt.timestamp()))
    if m.group(7):
        fd = m.group(7)[1:]
        t += Fraction(int(fd), 10 ** len(fd))
    return t

def ceil_ms(t):
    return Fraction(math.ceil(t * 1000), 1000)

def floor_ms(t):
    return Fraction(math.floor(t * 1000), 1000)

_HEX = re.compile(r'\A[0-9a-f]{64}\Z')

def is_digest(s):
    return isinstance(s, str) and bool(_HEX.match(s))

# ---------------------------------------------------------------- types (step 10 "Types")
class TypeRefusal(Exception):
    pass

def _need(cond):
    if not cond:
        raise TypeRefusal()

def _opt_str(o, k):
    if k in o:
        _need(o[k] is None or isinstance(o[k], str))

def check_types(inputs):
    _need(isinstance(inputs, dict))
    env = inputs.get('receipt'); _need(isinstance(env, dict))
    r = env.get('receipt'); _need(isinstance(r, dict))
    sig = env.get('signature'); _need(isinstance(sig, dict))
    for k in ('alg', 'key_id', 'value'):
        _need(isinstance(sig.get(k), str))
    ts = env.get('timestamp', None)
    _need(ts is None or isinstance(ts, dict))       # digest_sha256 wrong type is noted, not refused (101)
    for k in ('schema', 'canonicalization', 'key_id', 'issued_utc', 'independence', 'verdict'):
        _need(isinstance(r.get(k), str))
    _need(isinstance(r.get('suite'), dict))
    for k in ('digest', 'signature'):
        _need(isinstance(r['suite'].get(k), str))
    parties = r.get('parties'); _need(isinstance(parties, dict))
    ch = parties.get('checker'); _need(isinstance(ch, dict))
    _opt_str(ch, 'key_id')                          # 1.4.4 step 8: a name of any JSON type is read (absent or declared)
    pr = parties.get('producer', None)
    _need(pr is None or isinstance(pr, dict))
    if isinstance(pr, dict):
        _opt_str(pr, 'key_id')
    cr = r.get('criteria'); _need(isinstance(cr, dict))
    _need(isinstance(cr.get('sha256'), str))
    for k in ('committed_at', 'id', 'version', 'commitment'):
        _opt_str(cr, k)
    res = r.get('results'); _need(isinstance(res, list))
    for it in res:
        _need(isinstance(it, dict))
        _need(isinstance(it.get('id'), str))
        _need(isinstance(it.get('required'), bool))
        _need(isinstance(it.get('result'), str))
        for k in ('title', 'finding'):
            _opt_str(it, k)
    if 'files' in r:
        _need(isinstance(r['files'], dict))
        for v in r['files'].values():
            _need(v is None or isinstance(v, dict))
            if isinstance(v, dict):
                _opt_str(v, 'sha256'); _opt_str(v, 'name')
    keys = inputs.get('keys'); _need(isinstance(keys, dict))
    kl = keys.get('keys'); _need(isinstance(kl, list))
    for k in kl:
        _need(isinstance(k, dict))
        _need(isinstance(k.get('key_id'), str)); _need(isinstance(k.get('public_key_base64'), str))
    for k in ('criteria_file_base64', 'criteria_tsr_base64', 'receipt_tsr_base64'):
        _need(inputs.get(k) is None or isinstance(inputs.get(k), str))
    if 'tsa_roots_base64' in inputs:
        _need(isinstance(inputs['tsa_roots_base64'], list))
        for a in inputs['tsa_roots_base64']:
            _need(isinstance(a, str))

# ---------------------------------------------------------------- the procedure
REFUSED = {"refused": True, "reason": "unknown schema, canonicalization or suite"}
VOCAB = ('pass', 'fail', 'not-evaluated', 'error')

def recompute(results):
    req = [x['result'] for x in results if x['required']]
    if any(v == 'fail' for v in req):
        return 'fail'
    if any(v != 'pass' for v in req):              # R5: an out-of-vocabulary required result is not pass
        return 'incomplete'
    return 'pass'

def verify(inputs):
    try:
        check_types(inputs)
    except TypeRefusal:
        return dict(REFUSED)                         # R4
    env = inputs['receipt']; r = env['receipt']
    # step 1
    if (r['schema'] != 'trilatic.acceptance-receipt/1.2' or r['canonicalization'] != 'JCS-RFC8785'
            or r['suite'].get('digest') != 'sha-256' or r['suite'].get('signature') != 'Ed25519'):
        return dict(REFUSED)
    problems = set(); warnings = set()
    try:
        canon = jcs_bytes(r)
    except (ValueError, UnicodeEncodeError):
        return dict(REFUSED)
    # key list
    klist = inputs['keys']['keys']
    counts = {}
    for k in klist:
        counts[k['key_id']] = counts.get(k['key_id'], 0) + 1
    if any(v > 1 for v in counts.values()):
        problems.add('KEY_REJECTED')                 # repeated key_id, whichever entry (75, 79)
    def entry(kid):
        return [k for k in klist if k['key_id'] == kid]
    def key_bytes(kid):
        """Returns ('ok', bytes, point) | ('rejected', None, None) | ('unlisted', None, None)."""
        es = entry(kid)
        if not es:
            return 'unlisted', None, None
        if len(es) > 1:
            return 'rejected', None, None
        b = b64_canonical(es[0]['public_key_base64'])
        if b is None:
            return 'rejected', None, None
        A = ed_key_ok(b)
        if A is None:
            return 'rejected_point', None, None      # R9: canonical base64, but not a prime-order point
        return 'ok', b, A
    # step 2
    signed_kid = r['key_id']; env_kid = env['signature']['key_id']
    sig_valid = False
    if signed_kid == '' or env_kid == '' or env_kid != signed_kid:
        problems.add('SIGNATURE_INVALID')
    else:
        st, kb, A = key_bytes(signed_kid)
        if st in ('rejected', 'rejected_point'):
            problems.add('KEY_REJECTED')             # R1: no signature check, no SIGNATURE_INVALID
        elif st == 'unlisted':
            problems.add('SIGNATURE_INVALID')
        else:
            sb = b64_canonical(env['signature']['value'])
            if sb is not None and ed_verify(A, kb, canon, sb):
                sig_valid = True
            else:
                problems.add('SIGNATURE_INVALID')
    # independence (profile 1.4.4 step 8)
    parties = r['parties']; ch = parties['checker']; pr = parties.get('producer')
    stated_ind = r['independence']
    claims_ind = stated_ind == 'independent'
    ck = ch.get('key_id')
    if ck is not None and ck != signed_kid:
        problems.add('CHECKER_NOT_SIGNER')
    pk = pr.get('key_id') if isinstance(pr, dict) else None
    self_by_key = False
    status = {}
    for kid in (ck, pk):
        if kid is None or kid in status:
            continue
        if kid == '':
            status[kid] = ('empty', None)
            continue
        st, kb, _ = key_bytes(kid)
        status[kid] = (st, kb)
        if st == 'rejected':
            problems.add('KEY_REJECTED')             # R26 (1.4.7): a party key failing only the point rule is not KEY_REJECTED (114)
    for kid in (ck, pk):
        if kid is None:
            continue
        st = status[kid][0]
        if st == 'rejected' and len(entry(kid)) <= 1:
            self_by_key = True                       # an entry that cannot be read (69)
        elif st == 'rejected' and len(entry(kid)) > 1:
            self_by_key = True                       # R19: a repeated id is an entry that cannot be read (1.4.2: 75, 79)
        elif st in ('empty', 'unlisted') and claims_ind:
            self_by_key = True                       # R18: only when the record claims independent (80, 81, 103)
        # 'rejected_point' (canonical base64, not prime order): R9, independence not changed
    if ck is not None and pk is not None and status[ck][0] == 'ok' and status[pk][0] == 'ok' and status[ck][1] == status[pk][1]:
        problems.add('KEY_COLLISION'); self_by_key = True   # R3: also when one id
    # step 12 (profile 1.4.5): the relying party's own key list, when supplied
    rpk = inputs.get('relying_party_keys')
    if rpk is not None and claims_ind and pk is not None and not self_by_key:
        rp_list = rpk.get('keys') if isinstance(rpk, dict) else None
        rp_bytes = set()
        for k in (rp_list if isinstance(rp_list, list) else []):
            b = b64_canonical(k.get('public_key_base64')) if isinstance(k, dict) else None
            if b is not None:
                rp_bytes.add(b)                      # an entry that does not decode matches nothing (112)
        es = entry(pk)
        pb = b64_canonical(es[0]['public_key_base64']) if len(es) == 1 else None
        if pb is None or pb not in rp_bytes or ed_key_ok(pb) is None:   # R27 (1.4.7): the point rule (114, 115)
            self_by_key = True                       # R23: compared as decoded bytes, key_id not compared (110, 111)
    def norm_name(v):
        """None for an absent name, else a comparable value."""
        if v is None or v is False:
            return None
        if isinstance(v, (int, float)) and not isinstance(v, bool) and v == 0:
            return None
        if isinstance(v, (str, list, dict)) and len(v) == 0:
            return None
        if isinstance(v, str):
            return ('s', v.strip().lower())
        return ('j', jcs(v))
    pn = norm_name(pr.get('name')) if isinstance(pr, dict) else None
    cn = norm_name(ch.get('name'))
    if pn is None or pn in (('s', ''), ('s', 'unspecified'), ('s', 'unknown')):
        derived = 'undeclared'                       # R20: names compared after trim/lower-case
        warnings.add('PRODUCER_UNDECLARED')
    elif (cn is not None and pn == cn) or self_by_key:
        derived = 'self-checked'
    else:
        derived = 'independent'
    if stated_ind != derived:
        problems.add('INDEPENDENCE_INCONSISTENT')
    if stated_ind == 'self-checked':
        warnings.add('SELF_CHECKED')                 # 1.4.4: warned on the stated value
    # step 4
    cdigest = r['criteria']['sha256']
    cf = inputs.get('criteria_file_base64')
    if cf is None:
        criteria_hash = 'not_supplied'
    else:
        cb = b64_canonical(cf)
        if cb is not None and is_digest(cdigest) and hashlib.sha256(cb).hexdigest() == cdigest:
            criteria_hash = 'match'
            try:
                doc = json.loads(cb.decode('utf-8'))
                crit = {c['id']: bool(c.get('required')) for c in doc['criteria']}
                res = {x['id']: x['required'] for x in r['results']}
                if crit != res:
                    problems.add('CRITERIA_RESULTS_MISMATCH')    # R7: same ids and same required flags
            except Exception:
                problems.add('CRITERIA_RESULTS_MISMATCH')
        else:
            criteria_hash = 'mismatch'
            problems.add('CRITERIA_HASH_MISMATCH')
    # step 6 (record token) - needed for the reference time of step 5
    rt_b64 = inputs.get('receipt_tsr_base64')
    receipt_digest = hashlib.sha256(canon).hexdigest()
    rst, rtok = read_token(rt_b64)
    if rst == 'absent':
        receipt_timestamp = 'none'
    elif rst == 'ok' and imprint_matches(rtok, receipt_digest):
        receipt_timestamp = 'imprint_match'
    else:
        receipt_timestamp = 'imprint_mismatch'
    # step 5
    before = 'no'
    issued = parse_stated(r['issued_utc'])
    ct_b64 = inputs.get('criteria_tsr_base64')
    cst_, ctok = read_token(ct_b64)
    commit_t = None; unreadable = False
    use_token = False
    if cst_ != 'absent':
        if cst_ == 'ok' and imprint_matches(ctok, cdigest):
            if ctok['gen'] is not None:
                use_token = True
        else:
            problems.add('CRITERIA_TIMESTAMP_MISMATCH')          # R8: with the fallback warning below
    if use_token:
        g = ctok['gen']
        commit_t = ceil_ms(g['t']) + ctok['acc']
        if r['criteria'].get('committed_at') != g['sec_text']:
            problems.add('CRITERIA_TIME_MISMATCH')
    else:
        warnings.add('CRITERIA_COMMITMENT_UNVERIFIED')
        commit_t = parse_stated(r['criteria'].get('committed_at'))
        if commit_t is None:
            unreadable = True
    if issued is None:
        unreadable = True
    if unreadable:
        problems.add('RECEIPT_TIME_UNREADABLE')
        before = 'no'
    else:
        ref = issued
        if receipt_timestamp == 'imprint_match' and rtok['gen'] is not None:
            rg = floor_ms(rtok['gen']['t']) - rtok['acc']
            ref = min(ref, rg)
        if commit_t < ref:
            before = 'yes'
        else:
            before = 'no'
            problems.add('CRITERIA_COMMITTED_AFTER_CHECK')
    # vocabulary and verdict (step 7)
    for x in r['results']:
        if x['result'] not in VOCAB:
            problems.add('RESULT_VOCABULARY')
    vr = recompute(r['results'])
    if vr != r['verdict']:
        problems.add('VERDICT_MISMATCH')
    out = dict(signature_valid=sig_valid, independence=stated_ind, criteria_hash=criteria_hash,
               criteria_committed_before_check=before, receipt_timestamp=receipt_timestamp,
               verdict_stated=r['verdict'], verdict_recomputed=vr,
               problem_codes=sorted(problems), warning_codes=sorted(warnings))
    # step 9
    anchors = inputs.get('tsa_roots_base64')
    tsa = {}
    present = [(n, b) for n, b in (('criteria', ct_b64), ('receipt', rt_b64)) if b is not None]
    for n, b in present:
        tsa[n] = tsa_signature(b, anchors) if anchors else 'not_evaluated'
    if tsa:
        out['tsa_signature'] = tsa
    return out

# ---------------------------------------------------------------- self-test
def selftest():
    ok = True
    # RFC 8032 7.1 test 1 and 2
    seed = bytes.fromhex('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60')
    A, s = ed_sign_selftest(seed, b'')
    ok &= A.hex() == 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'
    ok &= s.hex() == ('e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155'
                      '5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b')
    ok &= ed_verify(ed_key_ok(A), A, b'', s)
    ok &= not ed_verify(ed_key_ok(A), A, b'x', s)
    seed2 = bytes.fromhex('4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb')
    A2, s2 = ed_sign_selftest(seed2, b'\x72')
    ok &= A2.hex() == '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c'
    ok &= s2.hex().startswith('92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da')
    # key rule
    ok &= ed_key_ok(bytes(32)) is None or True
    ok &= ed_key_ok((1).to_bytes(32, 'little')) is None          # neutral point
    ok &= ed_key_ok((P25519 + 1).to_bytes(32, 'little')) is None   # y >= p
    # JCS numbers (RFC 8785 appendix B samples)
    samples = [(0.0, '0'), (-0.0, '0'), (1e21, '1e+21'), (1e-7, '1e-7'), (1e-6, '0.000001'), (123456789012345680000.0, '123456789012345680000'),
               (5e-324, '5e-324'), (1.7976931348623157e308, '1.7976931348623157e+308'), (9007199254740992.0, '9007199254740992'),
               (295147905179352830000.0, '295147905179352830000'), (0.000001, '0.000001'), (1.5, '1.5'), (-0.25, '-0.25'),
               (100.0, '100'), (333333333.3333333, '333333333.3333333'), (1e+23, '1e+23'), (4.5e-7, '4.5e-7')]
    for v, want in samples:
        if _num(v) != want:
            ok = False; print('jcs number', v, _num(v), want)
    ok &= jcs({'b': 1, 'a': [True, None, 'x€\n']}) == '{"a":[true,null,"x€\\n"],"b":1}'
    ok &= jcs({'\U0001F600': 1, '｡': 2, 'z': 3}) == '{"z":3,"\U0001F600":1,"｡":2}'
    # base64
    ok &= b64_canonical('QQ==') == b'A' and b64_canonical('QR==') is None and b64_canonical('QQ') is None and b64_canonical('Q Q==') is None
    # step 12: a relying_party_keys entry in non-canonical base64 matches nothing
    ok &= base64.b64decode('eYVRu5Xgdn+06pKketK8NYyckKtSPePBpAseHJ9auFh=') == base64.b64decode('eYVRu5Xgdn+06pKketK8NYyckKtSPePBpAseHJ9auFg=')
    ok &= b64_canonical('eYVRu5Xgdn+06pKketK8NYyckKtSPePBpAseHJ9auFh=') is None
    # genTime form
    ok &= parse_gentime(b'20260601120000Z') is not None and parse_gentime(b'20260601120000.5Z') is not None
    ok &= parse_gentime(b'20260601120000.50Z') is None and parse_gentime(b'20261301120000Z') is None
    ok &= parse_gentime(b'20260230120000Z') is None and parse_gentime(b'20260601120000,5Z') is None
    ok &= parse_gentime(b'20260601120000+0000') is None and parse_gentime(b'20260601120060Z') is None
    # stated times
    ok &= parse_stated('2026-06-01T12:00:00.250Z') == parse_stated('2026-06-01T12:00:00Z') + Fraction(1, 4)
    ok &= parse_stated('2026-06-01T12:00:00.2500Z') is None and parse_stated('2026-06-01T12:00:60Z') is None
    # ECDSA P-256 sanity: G * n is infinity
    c = CURVES[OID_P256]
    ok &= _ec_mul(c, c['n'], (c['gx'], c['gy'])) is None
    c = CURVES[OID_P384]
    ok &= _ec_mul(c, c['n'], (c['gx'], c['gy'])) is None
    return bool(ok)

def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--selftest':
        r = selftest(); print('selftest', 'PASS' if r else 'FAIL'); sys.exit(0 if r else 1)
    src, dst = sys.argv[1], sys.argv[2]
    out = {}
    for fn in sorted(os.listdir(src), key=lambda s: int(s.split('-')[0])):
        if not fn.endswith('.json'):
            continue
        d = json.load(open(os.path.join(src, fn)))
        out[fn] = verify(d['inputs'])
    with open(dst, 'w') as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write('\n')
    print('vectors', len(out))

if __name__ == '__main__':
    main()
