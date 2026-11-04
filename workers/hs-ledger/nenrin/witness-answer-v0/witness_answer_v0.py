"""witness_answer_v0.py: build and verify one signed witness answer (witness-answer-v0) for a FURUI day record or a
TOOSHI day. Python standard library only. The procedure is PROCEDURE.md in this folder; the tests are
test_witness_answer_v0.py (no network) and vectors.json.

    python3 -I -B witness_answer_v0.py build-tooshi --result mine.json --tool-file tooshi_daily.py --name NAME --key-url URL --limit "..." [--limit "..."] [--key key.pem | --pub B64] --out answer.json
    python3 -I -B witness_answer_v0.py build-furui  --check leaf0.json [--check leaf1.json ...] --name NAME --key-url URL --limit "..." [--key key.pem | --pub B64] --out answer.json
    python3 -I -B witness_answer_v0.py preimage     answer.json --out preimage.bin          (to sign with your own tool, e.g. openssl)
    python3 -I -B witness_answer_v0.py attach-sig   answer.json --sig-file sig.bin --out answer.json
    python3 -I -B witness_answer_v0.py verify       answer.json --key-doc witness.json      (offline: the JSON your key_url serves)
    python3 -I -B witness_answer_v0.py verify       answer.json --fetch                     (GET key_url, https only, no redirects)
    python3 -I -B witness_answer_v0.py compare-tooshi --result mine.json --published day.json
    python3 -I -B witness_answer_v0.py intake-body  answer.json --vantage TEXT [--key key.pem | --record-sig-file sig.bin --pub B64] --out body.json
    python3 -I -B witness_answer_v0.py enroll       --name NAME --key-url URL --kind furui-day --kind tooshi-day --limit "..." [--key key.pem | --pub B64] --out enroll.json
    python3 -I -B witness_answer_v0.py selftest

The answer (every key required, no other key allowed):
    schema        "witness-answer-v0"
    kind          "furui-day" | "tooshi-day"
    day           YYYY-MM-DD (UTC)
    day_sha256    furui-day: sha256 of the day record's canonical bytes as the ledger serves them (furui-check-day-v0)
                  tooshi-day: sha256 of the canonical day view (tooshi-day-view-v0, tools/tooshi/tooshi_daily.py day_view)
    n             furui-day: leaves in the day record; tooshi-day: null
    root          furui-day: the RFC 6962 root the day record names; tooshi-day: null
    leaf_index    furui-day: the leaves the witness checked, strictly increasing, each < n; tooshi-day: []
    recomputed    what the witness itself recomputed, nothing else (furui-day: step names of nenrin-verify furui-day that
                  were ok for every listed leaf; tooshi-day: "day_view" and the check ids the run actually made)
    tool          one line naming the tool and its version or sha256
    observed_at   YYYY-MM-DDTHH:MM:SSZ
    limits        one line each, in the witness's own words: what this answer does not establish
    witness       {name, key_id, key_url}
    signature     {alg: "ed25519", key_id, sig}
key_id = "ed25519:" + the first 16 hex of sha256(raw 32-byte public key). The key_url serves {"public_key_ed25519_b64": ...}.
preimage = UTF-8 bytes of "witness-answer-v0\n" + canonical JSON of the answer without "signature".
canonical = RFC 8785 (JCS) on the closed value set used here: no floats, integers within +-(2^53-1), printable ASCII keys,
no lone surrogates. On that set JCS equals json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False).
The Ed25519 code below is the arithmetic of tools/tooshi/tooshi_daily.py (RFC 8032), plus a prime-order key check. It is
not constant time: signing with it on a shared machine is a choice; the preimage/attach-sig pair lets you sign elsewhere.
"""
import base64, datetime, hashlib, json, re, sys

SCHEMA = "witness-answer-v0"
ENROLL_SCHEMA = "witness-enroll-v0"
KINDS = ("furui-day", "tooshi-day")
ANSWER_KEYS = sorted(["schema", "kind", "day", "day_sha256", "n", "root", "leaf_index", "recomputed", "tool", "observed_at",
                      "limits", "witness", "signature"])
ENROLL_KEYS = sorted(["schema", "kinds", "enrolled_at", "limits", "witness", "signature"])
FURUI_STEPS = ["envelope_shape", "leaf_sha256", "audit_path", "signature", "runner_key", "bitcoin_anchor"]
TOOSHI_ITEM = re.compile(r"day_view|[0-9][0-9a-z_]{0,63}")
H64 = re.compile(r"[0-9a-f]{64}")
DAY = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
ISO = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z")
KEY_ID = re.compile(r"ed25519:[0-9a-f]{16}")
SIG88 = re.compile(r"[A-Za-z0-9+/]{86}==")
PUB44 = re.compile(r"[A-Za-z0-9+/]{43}=")
SAFE = 9007199254740991
LINE_MAX, LIMITS_MAX, NAME_MAX = 500, 20, 120
TOOSHI_DAY_URL = "https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/tooshi/days/%s.json"
LEDGER = "https://ledger.horizonshield.dev"
# Hosts an outside witness cannot sign from: the operator's own, and hosts that serve many people's files
# (the same idea as WITNESS_SHARED_HOSTS and WITNESS_OUR_GITHUB_OWNERS in workers/hs-ledger/src/worker.js).
OPERATOR_SUFFIXES = ("horizonshield.dev", "the-horizons-innovation.com", "oga-surf-project.workers.dev")
OPERATOR_GITHUB = ("ogasurfproject-jpg",)
SHARED_HOSTS = ("github.com", "gist.github.com", "gist.githubusercontent.com", "objects.githubusercontent.com", "codeload.github.com",
                "gitlab.com", "bitbucket.org", "codeberg.org", "huggingface.co", "cdn.jsdelivr.net", "unpkg.com", "esm.sh",
                "storage.googleapis.com", "s3.amazonaws.com", "drive.google.com", "docs.google.com", "dropbox.com",
                "www.dropbox.com", "dl.dropboxusercontent.com", "pastebin.com", "web.archive.org", "archive.org", "pypi.org",
                "files.pythonhosted.org", "registry.npmjs.org", "medium.com", "notion.site")


class Bad(ValueError):
    pass


# ---- canonical JSON (RFC 8785 on the closed value set) ----
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


# ---- Ed25519 (RFC 8032), arithmetic as in tools/tooshi/tooshi_daily.py ----
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
    txt = open(path, "r", encoding="ascii").read()
    m = re.search(r"-----BEGIN PRIVATE KEY-----(.+?)-----END PRIVATE KEY-----", txt, re.S)
    if not m:
        raise Bad("not a PKCS#8 PEM private key")
    der = base64.b64decode("".join(m.group(1).split()))
    if len(der) != 48 or not der.startswith(PKCS8_PREFIX):
        raise Bad("not an Ed25519 PKCS#8 key")
    return der[16:]


# ---- key_url: who the witness is ----
def key_url_problem(u):
    m = re.fullmatch(r"https://([a-z0-9.-]+)(/[^\s?#]*)", u or "")
    if not m:
        return "key_url must be https, lower-case host, no port, no query or fragment"
    host, path = m.group(1), m.group(2)
    if host in SHARED_HOSTS:
        return host + " serves many people's files and is not a witness identity"
    if any(host == s or host.endswith("." + s) for s in OPERATOR_SUFFIXES):
        return "the operator's own domain cannot be an outside witness"
    if host == "raw.githubusercontent.com":
        parts = [p for p in path.split("/") if p]
        if len(parts) < 4:
            return "raw.githubusercontent.com/<owner>/<repo>/<branch or tag>/<path>"
        if parts[0].lower() in OPERATOR_GITHUB:
            return "the operator's own GitHub account cannot be an outside witness"
        if re.fullmatch(r"[0-9a-fA-F]{7,64}", parts[2]):
            return "a commit SHA cannot be the ref of a key_url"
    return None


def identity_of(u):
    host = re.fullmatch(r"https://([a-z0-9.-]+)/.*", u).group(1)
    if host == "raw.githubusercontent.com":
        return "github.com/" + u.split("/")[3].lower()
    return host


def key_from_doc(doc):
    if not isinstance(doc, dict) or not isinstance(doc.get("public_key_ed25519_b64"), str):
        raise Bad("the key_url document must be {\"public_key_ed25519_b64\": ...}")
    return b64d(doc["public_key_ed25519_b64"], 32)


def fetch_key_doc(u, timeout=15):
    import urllib.request, urllib.error

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None
    if key_url_problem(u):
        raise Bad(key_url_problem(u))
    op = urllib.request.build_opener(NoRedirect)
    req = urllib.request.Request(u, headers={"accept": "application/json", "user-agent": "witness-answer-v0/0.1"})
    with op.open(req, timeout=timeout) as r:
        if r.status != 200:
            raise Bad("key_url answered %d" % r.status)
        return json.loads(r.read(65536).decode("utf-8"))


# ---- the answer ----
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
    """raises Bad with the first problem; the answer must be exactly the closed shape"""
    if not isinstance(a, dict) or sorted(a) != ANSWER_KEYS:
        raise Bad("the answer must carry exactly the keys " + ", ".join(ANSWER_KEYS))
    if a["schema"] != SCHEMA:
        raise Bad("schema must be " + SCHEMA)
    if a["kind"] not in KINDS:
        raise Bad("kind must be one of " + ", ".join(KINDS))
    if not _real_day(a["day"]):
        raise Bad("day must be a real YYYY-MM-DD")
    if not isinstance(a["day_sha256"], str) or not H64.fullmatch(a["day_sha256"]):
        raise Bad("day_sha256 must be 64 lower-case hex")
    li, rc = a["leaf_index"], a["recomputed"]
    if not isinstance(rc, list) or not rc or len(set(rc)) != len(rc) or not all(isinstance(x, str) for x in rc):
        raise Bad("recomputed must be a non-empty list of distinct strings")
    if a["kind"] == "furui-day":
        n = a["n"]
        if not (isinstance(n, int) and not isinstance(n, bool) and 1 <= n <= SAFE):
            raise Bad("furui-day: n must be an integer >= 1")
        if not isinstance(a["root"], str) or not H64.fullmatch(a["root"]):
            raise Bad("furui-day: root must be 64 lower-case hex")
        if not isinstance(li, list) or not li or not all(isinstance(i, int) and not isinstance(i, bool) for i in li) \
                or li != sorted(set(li)) or li[0] < 0 or li[-1] >= n:
            raise Bad("furui-day: leaf_index must be a non-empty strictly increasing list of leaves < n")
        if any(x not in FURUI_STEPS for x in rc) or rc != [x for x in FURUI_STEPS if x in rc]:
            raise Bad("furui-day: recomputed takes step names of nenrin-verify furui-day, in its order: " + ", ".join(FURUI_STEPS))
    else:
        if a["n"] is not None or a["root"] is not None or li != []:
            raise Bad("tooshi-day: n and root are null and leaf_index is []")
        if rc[0] != "day_view" or not all(TOOSHI_ITEM.fullmatch(x) for x in rc) or rc[1:] != sorted(rc[1:]):
            raise Bad("tooshi-day: recomputed starts with day_view, then the check ids the run made, sorted")
    _line(a["tool"], "tool", 200)
    if not isinstance(a["observed_at"], str) or not ISO.fullmatch(a["observed_at"]) or not _real_day(a["observed_at"][:10]):
        raise Bad("observed_at must be YYYY-MM-DDTHH:MM:SSZ")
    if a["observed_at"][:10] < a["day"]:
        raise Bad("observed_at cannot be before the day")
    lim = a["limits"]
    if not isinstance(lim, list) or not lim or len(lim) > LIMITS_MAX:
        raise Bad("limits must be a list of 1 to %d lines" % LIMITS_MAX)
    for x in lim:
        _line(x, "each limit")
    _check_witness(a["witness"])
    _check_sig_shape(a["signature"], a["witness"]["key_id"])


def _check_witness(w):
    if not isinstance(w, dict) or sorted(w) != ["key_id", "key_url", "name"]:
        raise Bad("witness must be exactly {name, key_id, key_url}")
    _line(w["name"], "witness.name", NAME_MAX)
    if not isinstance(w["key_id"], str) or not KEY_ID.fullmatch(w["key_id"]):
        raise Bad("witness.key_id must be ed25519:<16 hex>")
    p = key_url_problem(w["key_url"]) if isinstance(w["key_url"], str) else "key_url must be a string"
    if p:
        raise Bad("witness.key_url: " + p)


def _check_sig_shape(s, kid):
    if not isinstance(s, dict) or sorted(s) != ["alg", "key_id", "sig"] or s["alg"] != "ed25519":
        raise Bad("signature must be exactly {alg: ed25519, key_id, sig}")
    if s["key_id"] != kid:
        raise Bad("signature.key_id must equal witness.key_id")
    if not isinstance(s["sig"], str) or not SIG88.fullmatch(s["sig"]):
        raise Bad("signature.sig must be 88 characters of base64 (64 bytes)")


def preimage(obj, schema=SCHEMA):
    body = {k: v for k, v in obj.items() if k != "signature"}
    return (schema + "\n" + canonical(body)).encode("utf-8")


UNSIGNED = "A" * 86 + "=="


def finish(obj, pub, seed=None, schema=SCHEMA):
    """fill key_id from the public key, then sign with seed (or leave the placeholder for attach-sig)"""
    if not key_ok(pub):
        raise Bad("the public key is not a valid prime-order Ed25519 point")
    kid = key_id_of(pub)
    obj["witness"]["key_id"] = kid
    obj["signature"] = {"alg": "ed25519", "key_id": kid, "sig": UNSIGNED}
    if seed is not None:
        if ed25519_public(seed) != pub:
            raise Bad("the private key does not match the public key")
        obj["signature"]["sig"] = base64.b64encode(ed25519_sign(seed, preimage(obj, schema))).decode()
    return obj


def verify(a, key_doc, schema=SCHEMA):
    """-> list of (step, ok, why). key_doc is the JSON the key_url serves. Nothing here touches the network."""
    out = []

    def step(name, fn):
        try:
            fn()
            out.append((name, True, ""))
            return True
        except (Bad, ValueError, KeyError, TypeError) as e:
            out.append((name, False, str(e)))
            return False
    if not step("shape", lambda: (check_shape if schema == SCHEMA else check_enroll_shape)(a)):
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
        if not ed25519_verify(holder["pub"], preimage(a, schema), b64d(a["signature"]["sig"], 64)):
            raise Bad("the signature does not verify over the preimage")
    step("signature", sig)
    return out


# ---- builders ----
def tooshi_day_view(res):
    """tools/tooshi/tooshi_daily.py day_view and day_sha256, unchanged"""
    v = {k: x for k, x in res.items() if k not in ("checked_at", "trigger")}
    v["schema"] = "tooshi-day-view-v0"
    v["day"] = res["checked_at"][:10]
    return v


def tooshi_day_sha256(res):
    return hashlib.sha256(json.dumps(tooshi_day_view(res), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()


def build_tooshi(res, tool_sha, name, key_url, limits):
    if not isinstance(res, dict) or res.get("schema") != "tooshi-daily-v0" or not isinstance(res.get("checks"), list):
        raise Bad("the result must be a tooshi-daily-v0 result (tooshi_daily.py --out)")
    if (int(res["checked_at"][11:13]), int(res["checked_at"][14:16])) < (3, 47):
        raise Bad("a run before 03:47 UTC does not see the whole day")
    made = sorted(x["id"] for x in res["checks"] if x.get("state") in ("ok", "red", "notice"))
    return {"schema": SCHEMA, "kind": "tooshi-day", "day": res["checked_at"][:10], "day_sha256": tooshi_day_sha256(res),
            "n": None, "root": None, "leaf_index": [], "recomputed": ["day_view"] + made,
            "tool": "tools/tooshi/tooshi_daily.py sha256:" + tool_sha, "observed_at": res["checked_at"],
            "limits": list(limits), "witness": {"name": name, "key_id": "", "key_url": key_url}}


def build_furui(checks, name, key_url, limits, observed_at, tool):
    """checks: the JSON outputs of `nenrin-verify furui-day <day> --leaf <i>`, one per leaf"""
    if not checks:
        raise Bad("give at least one nenrin-verify furui-day output")
    f0 = checks[0].get("facts", {})
    for c in checks:
        if c.get("schema") != "nenrin-furui-check-v1" or c.get("command") != "furui-day":
            raise Bad("each check must be a nenrin-furui-check-v1 output of furui-day")
        f = c.get("facts", {})
        if (f.get("day"), f.get("record_sha256"), f.get("root"), f.get("n")) != (f0.get("day"), f0.get("record_sha256"), f0.get("root"), f0.get("n")):
            raise Bad("the checks disagree on day, record_sha256, root or n")
    ok_all = [s for s in FURUI_STEPS if all(any(x.get("name") == s and x.get("state") == "ok" for x in c.get("steps", [])) for c in checks)]
    if not ok_all:
        raise Bad("no step was ok for every leaf; there is nothing to sign")
    return {"schema": SCHEMA, "kind": "furui-day", "day": f0["day"], "day_sha256": f0["record_sha256"], "n": f0["n"], "root": f0["root"],
            "leaf_index": sorted(c["facts"]["leaf"] for c in checks), "recomputed": ok_all, "tool": tool,
            "observed_at": observed_at, "limits": list(limits), "witness": {"name": name, "key_id": "", "key_url": key_url}}


def compare_tooshi(mine, published):
    """-> (same, lines). published is tooshi/days/<day>.json (tooshi-day-v0); it carries result_canonical"""
    theirs = json.loads(published["result_canonical"])
    if hashlib.sha256(published["result_canonical"].encode("utf-8")).hexdigest() != published.get("result_sha256"):
        return False, ["the published result_canonical does not hash to its result_sha256"]
    a, b = tooshi_day_sha256(mine), tooshi_day_sha256(theirs)
    lines = ["mine      day_sha256 " + a, "published day_sha256 " + b + (" (file says " + str(published.get("day_sha256")) + ")")]
    if a == b:
        return True, lines + ["same"]
    tm, tt = {x["id"]: x for x in mine["checks"]}, {x["id"]: x for x in theirs["checks"]}
    for i in sorted(set(tm) | set(tt)):
        if json.dumps(tm.get(i), sort_keys=True) != json.dumps(tt.get(i), sort_keys=True):   # the day view may carry floats (spent_usd)
            lines.append("differs %s: mine %s, published %s" % (i, (tm.get(i) or {}).get("state"), (tt.get(i) or {}).get("state")))
    return False, lines


# ---- carrying it to the ledger's existing intake (POST /witness, unchanged) ----
def intake_record(a, vantage):
    """a jidec-path-v1 commitment record that carries the signed answer; the record itself is signed separately over its
    exact bytes, which is what POST /witness verifies today (worker.js witnessVerifySig)."""
    _line(vantage, "vantage")
    if a["kind"] == "tooshi-day":
        purpose, base = "tooshi-day-v0: " + a["day"], TOOSHI_DAY_URL % a["day"]
    else:
        purpose, base = "furui-day-v0: " + a["day"], LEDGER + "/furui-check-day/" + a["day_sha256"]
    rec = {"schema": "jidec-path-v1", "purpose": purpose, "walked_at": a["observed_at"], "base": base, "mode": "commitment",
           "commitment": a["day_sha256"], "witness": {"name": a["witness"]["name"], "vantage": vantage, "key_url": a["witness"]["key_url"]},
           "establishes": ["the witness recomputed: " + ", ".join(a["recomputed"]),
                           "the signed witness-answer-v0 in answer carries the same day_sha256 under key " + a["witness"]["key_id"]],
           "does_not_establish": list(a["limits"]), "answer": a}
    return canonical(rec)


def intake_body(record_canonical, pub, seed=None, sig=None):
    if seed is not None:
        sig = ed25519_sign(seed, record_canonical.encode("utf-8"))
    if sig is None or not ed25519_verify(pub, record_canonical.encode("utf-8"), sig):
        raise Bad("the record signature does not verify")
    return {"record_canonical": record_canonical, "signature_ed25519_b64": base64.b64encode(sig).decode(),
            "public_key_ed25519_b64": base64.b64encode(pub).decode()}


# ---- enrollment: one signed statement that proves the witness holds the key it names ----
def check_enroll_shape(e):
    if not isinstance(e, dict) or sorted(e) != ENROLL_KEYS or e["schema"] != ENROLL_SCHEMA:
        raise Bad("an enrollment carries exactly " + ", ".join(ENROLL_KEYS) + " with schema " + ENROLL_SCHEMA)
    k = e["kinds"]
    if not isinstance(k, list) or not k or any(x not in KINDS for x in k) or k != [x for x in KINDS if x in k]:
        raise Bad("kinds must be a non-empty list from " + ", ".join(KINDS) + " in that order")
    if not isinstance(e["enrolled_at"], str) or not ISO.fullmatch(e["enrolled_at"]):
        raise Bad("enrolled_at must be YYYY-MM-DDTHH:MM:SSZ")
    if not isinstance(e["limits"], list) or not e["limits"] or len(e["limits"]) > LIMITS_MAX:
        raise Bad("limits must be a list of 1 to %d lines" % LIMITS_MAX)
    for x in e["limits"]:
        _line(x, "each limit")
    _check_witness(e["witness"])
    _check_sig_shape(e["signature"], e["witness"]["key_id"])


def pool_entry(e, key_doc):
    """the entry a pool file would carry, in the shape nenrin-witness-pool-v1 hashes (witness_draw.mjs hashedEntry)"""
    if not all(ok for _, ok, _ in verify(e, key_doc, ENROLL_SCHEMA)):
        raise Bad("the enrollment does not verify")
    return {"signed_domain": identity_of(e["witness"]["key_url"]), "key_url": e["witness"]["key_url"],
            "public_key_ed25519_b64": key_doc["public_key_ed25519_b64"]}


# ---- command line ----
def _args(argv, multi=("--limit", "--check", "--kind"), flags=("--fetch",)):
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


def _keys(opt):
    seed = load_pem_seed(opt["--key"]) if "--key" in opt else None
    pub = ed25519_public(seed) if seed is not None else (b64d(opt["--pub"], 32) if "--pub" in opt else None)
    if pub is None:
        raise Bad("give --key key.pem (sign here) or --pub <base64> (sign elsewhere, then attach-sig)")
    return seed, pub


def _now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    cmd, (pos, opt) = argv[0], _args(argv[1:])
    if cmd == "selftest":
        import importlib.util, os
        sp = importlib.util.spec_from_file_location("test_witness_answer_v0", os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_witness_answer_v0.py"))
        t = importlib.util.module_from_spec(sp)
        sys.modules[sp.name] = t
        sp.loader.exec_module(t)
        return t.run()
    if cmd in ("build-tooshi", "build-furui", "enroll"):
        seed, pub = _keys(opt)
        if cmd == "build-tooshi":
            with open(opt["--tool-file"], "rb") as f:
                tool = hashlib.sha256(f.read()).hexdigest()
            obj = build_tooshi(_load(opt["--result"]), tool, opt["--name"], opt["--key-url"], opt["--limit"])
        elif cmd == "build-furui":
            obj = build_furui([_load(p) for p in opt["--check"]], opt["--name"], opt["--key-url"], opt["--limit"],
                              opt.get("--observed-at", _now()), opt.get("--tool", "nenrin-verify 0.8.1 furui-day"))
        else:
            obj = {"schema": ENROLL_SCHEMA, "kinds": [k for k in KINDS if k in opt["--kind"]], "enrolled_at": opt.get("--at", _now()),
                   "limits": list(opt["--limit"]), "witness": {"name": opt["--name"], "key_id": "", "key_url": opt["--key-url"]}}
        schema = ENROLL_SCHEMA if cmd == "enroll" else SCHEMA
        finish(obj, pub, seed, schema)
        (check_enroll_shape if cmd == "enroll" else check_shape)(obj)
        _write(opt["--out"], obj)
        print(("signed " if seed else "built, not signed yet (preimage, then attach-sig) ") + opt["--out"] + " key_id " + obj["witness"]["key_id"]
              + (" day_sha256 " + obj["day_sha256"] if cmd != "enroll" else ""))
        return 0
    if cmd == "preimage":
        a = _load(pos[0])
        schema = a.get("schema", SCHEMA)
        with open(opt["--out"], "wb") as f:
            f.write(preimage(a, schema))
        print("preimage %s sha256 %s" % (opt["--out"], sha256hex(preimage(a, schema))))
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
    if cmd == "verify":
        a = _load(pos[0])
        doc = fetch_key_doc(a["witness"]["key_url"]) if opt.get("--fetch") else _load(opt["--key-doc"])
        res = verify(a, doc, a.get("schema") if a.get("schema") in (SCHEMA, ENROLL_SCHEMA) else SCHEMA)
        for name, ok, why in res:
            print("%-4s %s%s" % ("ok" if ok else "FAIL", name, "" if ok else ": " + why))
        good = len(res) == 4 and all(ok for _, ok, _ in res)
        print("VERDICT " + ("signed_answer_ok identity " + identity_of(a["witness"]["key_url"]) if good else "not_ok"))
        return 0 if good else 1
    if cmd == "compare-tooshi":
        same, lines = compare_tooshi(_load(opt["--result"]), _load(opt["--published"]))
        print("\n".join(lines))
        return 0 if same else 1
    if cmd == "intake-body":
        a = _load(pos[0])
        check_shape(a)
        rc = intake_record(a, opt["--vantage"])
        if "--key" in opt:
            seed, pub = _keys(opt)
            body = intake_body(rc, pub, seed=seed)
        elif "--record-sig-file" in opt:
            with open(opt["--record-sig-file"], "rb") as f:
                body = intake_body(rc, b64d(opt["--pub"], 32), sig=f.read())
        else:
            with open(opt["--out"] + ".record", "wb") as f:
                f.write(rc.encode("utf-8"))
            print("record bytes written to %s.record; sign them, then run again with --record-sig-file and --pub" % opt["--out"])
            return 0
        _write(opt["--out"], body)
        print("intake body %s (POST it to %s/witness yourself)" % (opt["--out"], LEDGER))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except (Bad, KeyError, OSError) as e:
        print("witness_answer_v0: %s: %s" % (type(e).__name__, e))
        sys.exit(2)
