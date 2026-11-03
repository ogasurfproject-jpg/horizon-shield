"""The few JavaScript semantics the NENRIN verifiers depend on, written down so the Python port means the same.

The reference verifier (npm nenrin-verify, nenrin_verify.mjs) is JavaScript. A Python port that reads `x or y`
where JavaScript reads `x || y` disagrees on `{}` and `[]`; one that reads `a == b` where JavaScript reads `a === b`
disagrees on `True == 1` and on two equal but distinct objects. Every such place goes through a helper here, so
the port can be read against the original line by line and the differences are in one file.

UNDEF stands for JavaScript `undefined` (a property that is not there). None stands for `null`.
"""
import base64
import math
import re

UNDEF = type("Undefined", (), {"__repr__": lambda s: "undefined", "__bool__": lambda s: False})()

# Object.prototype names a JSON object inherits in JavaScript. `obj[k]` with one of these keys is not undefined
# there, so a lookup table keyed by user input must refuse them the way the original would trip over them.
OBJECT_PROTOTYPE_KEYS = frozenset((
    "constructor", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "toString",
    "valueOf", "__proto__", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__",
))


class JSTypeError(TypeError):
    """Where the JavaScript original would throw a TypeError (reading a property of null or undefined)."""


def is_obj(v):
    return isinstance(v, dict)


class JSObject(dict):
    """An object made by Object.assign, which can carry a prototype: when a source has an own "__proto__" key,
    Object.assign does not copy it, it calls the __proto__ setter, and every property the target lacks is then
    read from that object. Own keys (what Object.keys, canonical and JSON.stringify see) are the dict itself."""

    def __init__(self, *a, **k):
        dict.__init__(self, *a, **k)
        self.proto = None


def assign(*sources):
    """Object.assign({}, ...sources)."""
    out = JSObject()
    for src in sources:
        if src is None or src is UNDEF or isinstance(src, (bool, int, float)):
            continue
        if isinstance(src, str):
            items = [(str(i), c) for i, c in enumerate(src)]
        elif isinstance(src, list):
            items = [(str(i), v) for i, v in enumerate(src)]
        else:
            items = list(src.items())
        for k, v in items:
            if k == "__proto__":
                if isinstance(v, dict):
                    out.proto = v
                elif v is None:
                    out.proto = None
                continue
            out[k] = v
    return out


def prop(o, k):
    """o.k in JavaScript: throws on null and undefined, undefined when absent."""
    if o is None or o is UNDEF:
        raise JSTypeError("Cannot read properties of %s (reading '%s')" % ("null" if o is None else "undefined", k))
    if isinstance(o, dict):
        if k in o:
            return o[k]
        if isinstance(o, JSObject) and o.proto is not None:
            return o.proto.get(k, UNDEF)
        return UNDEF
    if isinstance(o, (str, list)) and k == "length":
        return len(o) if isinstance(o, list) else utf16_len(o)
    return UNDEF


def and_prop(o, k):
    """o && o.k"""
    return prop(o, k) if truthy(o) else o


def truthy(v):
    if v is None or v is UNDEF or v is False:
        return False
    if isinstance(v, bool):
        return True
    if isinstance(v, (int, float)):
        return v != 0 and not (isinstance(v, float) and math.isnan(v))
    if isinstance(v, str):
        return len(v) > 0
    return True


def or_(a, b):
    """a || b"""
    return a if truthy(a) else b


def nullish(v):
    """v == null"""
    return v is None or v is UNDEF


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def seq(a, b):
    """a === b"""
    if a is UNDEF or b is UNDEF or a is None or b is None:
        return a is b
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if is_num(a) and is_num(b):
        return a == b
    if isinstance(a, str) and isinstance(b, str):
        return a == b
    if isinstance(a, (dict, list)) or isinstance(b, (dict, list)):
        return a is b
    return False


def uniq(xs):
    """[...new Set(xs)]: SameValueZero, first occurrence kept, objects by identity."""
    out = []
    for x in xs:
        if not any(_same_value_zero(x, y) for y in out):
            out.append(x)
    return out


def _same_value_zero(a, b):
    if is_num(a) and is_num(b) and isinstance(a, float) and isinstance(b, float) and math.isnan(a) and math.isnan(b):
        return True
    return seq(a, b)


class JSMap(object):
    """new Map() with SameValueZero keys and insertion order."""

    def __init__(self):
        self.keys, self.vals = [], []

    def _i(self, k):
        for i, x in enumerate(self.keys):
            if _same_value_zero(x, k):
                return i
        return -1

    def has(self, k):
        return self._i(k) >= 0

    def get(self, k):
        i = self._i(k)
        return self.vals[i] if i >= 0 else UNDEF

    def set(self, k, v):
        i = self._i(k)
        if i >= 0:
            self.vals[i] = v
        else:
            self.keys.append(k)
            self.vals.append(v)

    def items(self):
        return list(zip(self.keys, self.vals))

    def size(self):
        return len(self.keys)


_JS_WS = " \t\n\v\f\r\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
_DEC = re.compile(r"\A[+-]?(?:(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?|Infinity)\Z")


def _double(n):
    """An integer as the double JavaScript holds: exact up to 2^53, rounded beyond, Infinity past the largest double."""
    if abs(n) <= MAX_SAFE:
        return n
    try:
        return float(n)
    except OverflowError:
        return float("inf") if n > 0 else float("-inf")


def to_number(v):
    """ToNumber, for the values a JSON document can hold."""
    if v is UNDEF:
        return float("nan")
    if v is None or v is False:
        return 0
    if v is True:
        return 1
    if is_num(v):
        return v
    if isinstance(v, str):
        t = v.strip(_JS_WS)
        if t == "":
            return 0
        if re.match(r"\A0[xX][0-9a-fA-F]+\Z", t):
            return _double(int(t[2:], 16))
        if re.match(r"\A0[oO][0-7]+\Z", t):
            return _double(int(t[2:], 8))
        if re.match(r"\A0[bB][01]+\Z", t):
            return _double(int(t[2:], 2))
        if _DEC.match(t):
            return float(t.replace("Infinity", "inf"))
        return float("nan")
    if isinstance(v, list):
        return to_number(",".join("" if (x is None or x is UNDEF) else (x if isinstance(x, str) else _prim_str(x)) for x in v))
    return float("nan")


def _prim_str(v):
    if v is True:
        return "true"
    if v is False:
        return "false"
    if is_num(v):
        return num_str(v)
    if isinstance(v, list):
        return ",".join("" if (x is None or x is UNDEF) else (x if isinstance(x, str) else _prim_str(x)) for x in v)
    return "[object Object]"


def _sub(a, b):
    """SortCompare over the comparator (a, b) => a - b: ToNumber on both, and a NaN result reads as +0 (ECMA-262)."""
    x, y = to_number(a), to_number(b)
    try:
        v = x - y
    except OverflowError:
        return 0
    return 0 if (isinstance(v, float) and math.isnan(v)) else v


def sort_numeric(keys):
    """keys.slice().sort((a, b) => a - b) as V8 runs it: undefined moved to the end without calling the comparator,
    the comparator coercing with ToNumber, a NaN answer read as +0, and V8's TimSort, which for fewer than 64 elements is one run made by
    CountAndMakeRun and finished by BinaryInsertionSort. Inputs the comparator cannot order consistently are therefore
    ordered the way V8 orders them, not the way a Python sort would. Longer arrays of non-numbers raise rather than guess."""
    a = [k for k in keys if k is not UNDEF]
    tail = [k for k in keys if k is UNDEF]
    n = len(a)
    if n < 2:
        return a + tail
    if all(is_num(k) and not (isinstance(k, float) and math.isnan(k)) for k in a):
        return sorted(a) + tail
    if n >= 64:
        raise ValueError("unordered: 64 or more keys that are not all numbers; V8 would merge runs here")
    # CountAndMakeRun(0, n)
    run = 2
    desc = _sub(a[1], a[0]) < 0
    prev = a[1]
    for idx in range(2, n):
        order = _sub(a[idx], prev)
        if desc:
            if order >= 0:
                break
        elif order < 0:
            break
        prev = a[idx]
        run += 1
    if desc:
        a[0:run] = a[0:run][::-1]
    # BinaryInsertionSort(0, run, n)
    for start in range(run, n):
        left, right, pivot = 0, start, a[start]
        while left < right:
            mid = left + ((right - left) >> 1)
            if _sub(pivot, a[mid]) < 0:
                right = mid
            else:
                left = mid + 1
        a[left + 1:start + 1] = a[left:start]
        a[left] = pivot
    return a + tail


def utf16_len(s):
    return sum(2 if ord(c) > 0xFFFF else 1 for c in s)


def key_ok(k):
    return isinstance(k, str) and all(0x20 <= ord(c) <= 0x7E for c in k)


MAX_SAFE = 9007199254740991


class CanonicalError(ValueError):
    def __init__(self, code, at=None):
        ValueError.__init__(self, code + (" at " + str(at) if at is not None else ""))
        self.code = code
        self.at = at


def check_canonical_input(v, path="$"):
    """strict_json.mjs checkCanonicalInput"""
    if v is None or isinstance(v, (str, bool)):
        return
    if is_num(v):
        if isinstance(v, float) and (not math.isfinite(v) or not v.is_integer()):
            raise CanonicalError("non_integer_number", path)
        if v > MAX_SAFE or v < -MAX_SAFE:
            raise CanonicalError("unsafe_number", path)
        return
    if isinstance(v, list):
        for i, x in enumerate(v):
            check_canonical_input(x, path + "[" + str(i) + "]")
        return
    if isinstance(v, dict):
        for k in v:
            if not key_ok(k):
                raise CanonicalError("key_not_printable_ascii", path + "." + k)
            check_canonical_input(v[k], path + "." + k)
        return
    raise CanonicalError("bad_json", path)


_ESC = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t"}


def quote(s):
    """JSON.stringify(string): escapes '"', '\\', U+0000..U+001F and lone surrogates; everything else raw."""
    out = ['"']
    for c in s:
        o = ord(c)
        if c in _ESC:
            out.append(_ESC[c])
        elif o < 0x20 or 0xD800 <= o <= 0xDFFF:
            out.append("\\u%04x" % o)
        else:
            out.append(c)
    out.append('"')
    return "".join(out)


def num_str(v):
    """Number.prototype.toString for the values JSON can carry (ECMA-262 Number::toString, radix 10)."""
    if isinstance(v, int):
        if abs(v) <= MAX_SAFE:
            return str(v)
        v = float(v)
    if math.isnan(v) or math.isinf(v):
        return "null"
    if v == 0:
        return "0"
    sign = "-" if v < 0 else ""
    r = repr(abs(v))
    m = re.fullmatch(r"([0-9]+)(?:\.([0-9]+))?(?:e([+-][0-9]+))?", r)
    ip, fp, ex = m.group(1), m.group(2) or "", int(m.group(3) or 0)
    digits = (ip + fp).lstrip("0")
    point = len(ip) + ex - (len(ip + fp) - len((ip + fp).lstrip("0")))
    digits = digits.rstrip("0") or "0"
    k, n = len(digits), point
    if k <= n <= 21:
        return sign + digits + "0" * (n - k)
    if 0 < n <= 21:
        return sign + digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return sign + "0." + "0" * (-n) + digits
    e = n - 1
    es = ("+" if e >= 0 else "-") + str(abs(e))
    if k == 1:
        return sign + digits + "e" + es
    return sign + digits[0] + "." + digits[1:] + "e" + es


def _canon(v):
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, str):
        return quote(v)
    if is_num(v):
        return num_str(v)
    if isinstance(v, list):
        return "[" + ",".join(_canon(x) for x in v) + "]"
    keys = sorted(k for k, x in v.items() if x is not UNDEF)
    return "{" + ",".join(quote(k) + ":" + _canon(v[k]) for k in keys) + "}"


def canonical(v):
    """bind.mjs canonical(): checkCanonicalInput, then keys sorted by code point, no whitespace."""
    check_canonical_input(v)
    return _canon(v)


def stringify(v, indent=None, sort_keys=False, _level=0):
    """JSON.stringify(v, null, indent). Keys whose value is undefined are dropped, as in JavaScript. With
    sort_keys, keys are ordered by UTF-16 code unit, the order Array.prototype.sort gives JavaScript strings."""
    if v is UNDEF:
        return None
    if v is None or v is True or v is False or isinstance(v, str) or is_num(v):
        return _canon(v) if not isinstance(v, float) or math.isfinite(v) else "null"
    pad = "" if indent is None else "\n" + " " * (indent * (_level + 1))
    end = "" if indent is None else "\n" + " " * (indent * _level)
    if isinstance(v, list):
        if not v:
            return "[]"
        items = [stringify(x, indent, sort_keys, _level + 1) for x in v]
        items = ["null" if x is None else x for x in items]
        return "[" + pad + ("," + pad).join(items) + end + "]"
    keys = [k for k in v if v[k] is not UNDEF]
    if sort_keys:
        keys.sort(key=lambda k: k.encode("utf-16-be", "surrogatepass"))
    else:
        keys = _js_key_order(keys)
    if not keys:
        return "{}"
    sep = ":" if indent is None else ": "
    items = [quote(k) + sep + stringify(v[k], indent, sort_keys, _level + 1) for k in keys]
    return "{" + pad + ("," + pad).join(items) + end + "}"


# fullmatch: with match and "$", the key "1\n" would count as an array index; in JavaScript it is not one
_INDEX = re.compile(r"0|[1-9][0-9]*")


def _js_key_order(keys):
    """Own property order of a JavaScript object: array-index keys ascending, then the rest in insertion order."""
    idx = sorted((k for k in keys if _INDEX.fullmatch(k) and int(k) < 4294967295), key=int)
    return idx + [k for k in keys if not (_INDEX.fullmatch(k) and int(k) < 4294967295)]


def loads(text):
    """JSON.parse(text): duplicate keys last-wins, every number a double (so 1.0 is the integer 1, and an integer
    literal too long for a double is Infinity, not an error), NaN and Infinity literals refused. Bytes are decoded
    as Node's readFileSync(path, "utf8") does, invalid sequences becoming U+FFFD."""
    import json

    if isinstance(text, (bytes, bytearray)):
        text = bytes(text).decode("utf-8", "replace")

    def num(s):
        f = float(s)
        if f.is_integer() and abs(f) <= MAX_SAFE:
            return int(f)
        return f

    def integer(s):
        if len(s.lstrip("-")) > 16:
            return num(s)
        i = int(s)
        return i if abs(i) <= MAX_SAFE else num(s)

    def constant(name):
        raise ValueError("JSON.parse refuses the literal " + name)

    return json.loads(text, parse_float=num, parse_int=integer, parse_constant=constant)


_B64 = {c: i for i, c in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")}
_B64["-"] = 62
_B64["_"] = 63


def node_b64decode(s):
    """Buffer.from(s, "base64"): standard and url-safe letters, anything else skipped, stop at the first '='."""
    vals = []
    for c in s:
        if c == "=":
            break
        if c in _B64:
            vals.append(_B64[c])
    out = bytearray()
    for i in range(0, len(vals) - len(vals) % 4, 4):
        n = (vals[i] << 18) | (vals[i + 1] << 12) | (vals[i + 2] << 6) | vals[i + 3]
        out += bytes(((n >> 16) & 255, (n >> 8) & 255, n & 255))
    rest = vals[len(vals) - len(vals) % 4:]
    if len(rest) == 2:
        out.append(((rest[0] << 18) | (rest[1] << 12)) >> 16 & 255)
    elif len(rest) == 3:
        n = (rest[0] << 18) | (rest[1] << 12) | (rest[2] << 6)
        out += bytes(((n >> 16) & 255, (n >> 8) & 255))
    return bytes(out)


def b64encode(b):
    return base64.b64encode(b).decode("ascii")


_RFC3339 = re.compile(r"\A([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]+)?Z\Z")


def _days_from_civil(y, m, d):
    y -= m <= 2
    era = (y if y >= 0 else y - 399) // 400
    yoe = y - era * 400
    doy = (153 * (m + (-3 if m > 2 else 9)) + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


def date_parse(s):
    """Date.parse(s) as V8 reads the strings the RFC3339_UTC rule admits: day 1..31 in any month (rolling over),
    hour 24 only at 24:00:00 with every fraction digit zero, other fractions truncated to milliseconds. None for NaN."""
    if not isinstance(s, str):
        return None
    m = _RFC3339.match(s)
    if not m:
        return None
    y, mo, d, h, mi, se = (int(m.group(i)) for i in range(1, 7))
    ms = int((m.group(7) or ".0")[1:4].ljust(3, "0"))
    if not (1 <= mo <= 12 and 1 <= d <= 31 and mi <= 59 and se <= 59):
        return None
    if h > 24 or (h == 24 and (mi or se or (m.group(7) or ".0").strip(".0"))):
        return None
    days = _days_from_civil(y, mo, 1) + d - 1
    return days * 86400000 + h * 3600000 + mi * 60000 + se * 1000 + ms


# ---- added for the TSUGI port (tsugi.py) ----

class NotReproduced(Exception):
    """An input where this port does not reproduce the JavaScript and raises instead of guessing (the limits are
    listed in the package README under "Where the claim stops")."""


def number_to_string(v):
    """String(n) for a JavaScript number: unlike JSON.stringify, NaN and the infinities have names."""
    if isinstance(v, float) and math.isnan(v):
        return "NaN"
    if isinstance(v, float) and math.isinf(v):
        return "Infinity" if v > 0 else "-Infinity"
    return num_str(v)


def to_string(v):
    """ToString (and string concatenation) of a value JSON.parse can produce. A plain object is "[object Object]"
    unless it has an own toString key: that one is not callable, valueOf answers the object itself, and
    JavaScript throws TypeError: Cannot convert object to primitive value."""
    if v is UNDEF:
        return "undefined"
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, str):
        return v
    if is_num(v):
        return number_to_string(v)
    if isinstance(v, list):
        return ",".join("" if (x is None or x is UNDEF) else to_string(x) for x in v)
    if isinstance(v, dict):
        if "toString" in v:
            raise JSTypeError("Cannot convert object to primitive value")
        return "[object Object]"
    raise JSTypeError("to_string: not a JSON value")


def to_number_js(v):
    """ToNumber for any JSON value, objects and arrays going through ToPrimitive (to_string's rules)."""
    if isinstance(v, (list, dict)):
        return to_number(to_string(v))
    return to_number(v)


def lower(s):
    """String.prototype.toLowerCase. Python's str.lower() and JavaScript's agree on the default case conversion
    (SpecialCasing included, final sigma included) for every code point both Unicode tables assign; a code point
    this Python does not assign may have a mapping in a newer table, so it raises instead of guessing."""
    if s.isascii():
        return s.lower()
    import unicodedata
    if any(unicodedata.category(c) == "Cn" for c in s):
        raise NotReproduced("toLowerCase of a code point this Python's Unicode tables do not assign")
    return s.lower()


def utf8(s):
    """TextEncoder.encode: UTF-8, a lone surrogate written as U+FFFD."""
    return re.sub("[\ud800-\udfff]", "�", s).encode("utf-8")


_ARG_TYPE = ("The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an "
             "Array-like Object. Received ")


def _to_uint8(v):
    n = to_number_js(v)
    if isinstance(n, float) and (math.isnan(n) or math.isinf(n)):
        return 0
    return int(n) % 256


def _from_array_like(xs):
    return bytes(_to_uint8(x) for x in xs)


def _specific_type(v, legacy=False):
    """lib/internal/errors.js determineSpecificType for a plain object.

    Node 24.22.0 rewrote it (as Node main has it): the constructor's name is read once with `?.`, and only a
    non-empty string name gives "an instance of <name>"; anything else is inspected at depth -1, "[Object]".
    That is the default here. Node 22 and Node 24 before 24.22.0 write `'name' in value.constructor`, which
    throws a TypeError when the constructor is a truthy primitive and prints any name through String();
    legacy=True gives that older text, so the live test can compare against whichever Node it runs."""
    if "constructor" not in v:
        return "an instance of Object"
    c = v["constructor"]
    if not legacy:
        name = c["name"] if isinstance(c, dict) and "name" in c else UNDEF
        if isinstance(name, str) and name != "":
            return "an instance of " + name
        return "[Object]"
    if not truthy(c):
        return "[Object]"
    if c is True or isinstance(c, str) or is_num(c):
        raise JSTypeError("Cannot use 'in' operator to search for 'name' in " + to_string(c))
    if isinstance(c, dict) and "name" in c:
        return "an instance of " + to_string(c["name"])
    return "[Object]"


def node_has_new_specific_type(version):
    """Whether this Node version ("24.22.0") writes the 24.22.0 determineSpecificType. Only the lines the parity
    matrix runs are listed; a release or backport that changes it shows up as a failure of the live test."""
    major, minor = (int(x) for x in version.split(".")[:2])
    return major == 24 and minor >= 22


def buffer_from(v, legacy=False):
    """Buffer.from(v, "base64") for the values JSON can hold (Node 22 and 24, lib/buffer.js): a string is
    decoded leniently; an array is copied element by element through ToNumber modulo 256; an object goes
    through valueOf, then an own length (a non-number gives an empty buffer), then {type: "Buffer", data: [...]},
    and otherwise throws ERR_INVALID_ARG_TYPE, whose text for an object follows _specific_type(v, legacy)."""
    if isinstance(v, str):
        return node_b64decode(v)
    if isinstance(v, list):
        return _from_array_like(v)
    if isinstance(v, dict):
        if "valueOf" in v:
            vo = v["valueOf"]
            if truthy(vo):
                raise JSTypeError("value.valueOf is not a function")
            if isinstance(vo, str):
                return node_b64decode(vo)
        if "length" in v:
            if is_num(v["length"]):
                raise NotReproduced("Buffer.from of an object with a numeric length")
            return b""
        if seq(v.get("type", UNDEF), "Buffer") and isinstance(v.get("data", UNDEF), list):
            return _from_array_like(v["data"])
        raise JSTypeError(_ARG_TYPE + _specific_type(v, legacy))
    if v is True or v is False:
        raise JSTypeError(_ARG_TYPE + "type boolean (" + ("true" if v else "false") + ")")
    if v is None:
        raise JSTypeError(_ARG_TYPE + "null")
    if v is UNDEF:
        raise JSTypeError(_ARG_TYPE + "undefined")
    raise NotReproduced("Buffer.from of a number")
