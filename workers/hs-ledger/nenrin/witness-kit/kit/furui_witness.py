"""furui_witness.py, furui-witness-kit 0.2.0: recompute the FURUI day records of runner-1 and runner-2, check that each is
anchored in Bitcoin, and sign what you found.

Two answers per day and runner, both in the witness-answer-v0.2 shape:
  day answer     (purpose furui-day-v0: <D>)     the first run after the day closes: the day record and every leaf, five
                 steps of nenrin-verify furui-day (envelope_shape, leaf_sha256, audit_path, signature, runner_key).
  anchor answer  (purpose furui-anchor-v0: <D>)  the first run after the ledger's batch entry that lists the day record is
                 confirmed in Bitcoin: the same five steps again and the sixth, bitcoin_anchor. The batch entry hashes to
                 its claim and lists the day record; its OpenTimestamps proof commits the entry to the block the ledger
                 names; mempool.space and blockstream.info serve the same block hash and the same header at that height;
                 the header hashes to the block hash, meets the target of its own bits, and holds the proof's merkle root.
                 The record of the answer names the ledger entry, the block height and the block hash.
                 runner-1 closes a day at 00:47 UTC of D+1, so its anchor answer comes at 03:50 UTC of D+2; runner-2
                 closes at 00:14 UTC, so its anchor answer usually comes at 03:50 UTC of D+1. When a day record is
                 still not in a confirmed batch 4 days after the day, the anchor answer says incomplete.

What it reads (GET only, https, no redirects, 1 MiB per answer, 20 s per call, 160 calls and 8 minutes per run):
  https://furui.horizonshield.dev/furui/day/<D>/status and /leaf/<i>      runner-1
  https://furui.horizonshield.dev/furui2/day/<D>/status and /leaf/<i>     runner-2
  https://ledger.horizonshield.dev/furui-check-day/<sha>                  the day record as the ledger keeps it
  https://ledger.horizonshield.dev/.well-known/furui-check-keys.json      the runner keys
  https://ledger.horizonshield.dev/ledger/head                            the ledger head, kept in each answer
  https://ledger.horizonshield.dev/ledger/<n>?format=json and /ledger/<n>/ots   the batch entry and its proof
  https://mempool.space/api and https://blockstream.info/api              /block-height/<h> and /block/<hash>/header
  your own key_url                                                        to see that it serves your key
What it writes: at most two POST https://ledger.horizonshield.dev/witness per day and runner, and files in --out.
It runs no code from the operator, installs nothing, and copies no text from any answer into what it signs:
only hex, integers, dates and the fixed words of this file. Signing is done by openssl (pkeyutl -rawin).
Your key_url may serve {"public_key_ed25519_b64": "..."} or one OpenSSH line "ssh-ed25519 <base64> [comment]".

  python3 -I -B furui_witness.py answer --answers answers --out out [--github-output FILE] [--now YYYY-MM-DDTHH:MM:SSZ]
      env FURUI_WITNESS_KEY (PEM), FURUI_WITNESS_KEY_URL, FURUI_WITNESS_NAME
  python3 -I -B furui_witness.py keep --incoming DIR --shas "SHA SHA" --answers answers --status status.json [--now ...]
"""
import base64, datetime, hashlib, json, os, re, subprocess, sys, tempfile, time
import http.client, urllib.error, urllib.request

KIT, VERSION = "furui-witness-kit", "0.2.0"
UA = "%s/%s (+https://github.com/ogasurfproject-jpg/horizon-shield/tree/main/workers/hs-ledger/nenrin/witness-kit)" % (KIT, VERSION)
FURUI, LEDGER = "https://furui.horizonshield.dev", "https://ledger.horizonshield.dev"
TREES = {"runner-1": "/furui/day/", "runner-2": "/furui2/day/"}
SIGNER = {"domain": "horizonshield.dev", "key_url": LEDGER + "/.well-known/furui-check-keys.json"}
DAY_LEAF = "sha256(0x00 || musubi-canonical-v0(envelope))"
STEPS = ["envelope_shape", "leaf_sha256", "audit_path", "signature", "runner_key"]   # a day answer
ANCHOR_STEPS = STEPS + ["bitcoin_anchor"]                                             # an anchor answer
PURPOSE = {"day": "furui-day-v0: ", "anchor": "furui-anchor-v0: "}
EXPLORERS = (("mempool.space", "https://mempool.space/api"), ("blockstream.info", "https://blockstream.info/api"))
CAP, CALL_S, RUN_S, CALLS, MAX_N, BACK, ANCHOR_WAIT = 1 << 20, 20.0, 480.0, 160, 4096, 6, 4
BASE_CALLS = 3                                  # key_url, ledger head and runner keys, read once per run
SAFE = 9007199254740991
H64 = re.compile(r"[0-9a-f]{64}")
H160 = re.compile(r"[0-9a-f]{160}")
DAY = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
ISO_MS = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z")
NONCE = re.compile(r"[0-9a-f]{32}|heartbeat-[0-9]{4}-[0-9]{2}-[0-9]{2}")
SIG88 = re.compile(r"[A-Za-z0-9+/]{86}==")
SSH_LINE = re.compile(r"ssh-ed25519[ \t]+([A-Za-z0-9+/]+={0,2})(?:[ \t]+[\x20-\x7e\t]*)?")
DER = bytes.fromhex("302a300506032b6570032100")
CHECK_KEYS = sorted(["action_binding_digest", "answered", "checked_at_height", "contract_sha256", "decision", "input_commit", "marks",
                     "nonce", "rules_sha256", "schema", "scope_sha256", "signed_at", "stage_reached", "trace_sha256", "unread"])
DAY_KEYS = sorted(["clock_skew", "day", "first_height", "last_height", "late", "leaf", "n", "publication", "root", "schema",
                   "signatures", "signer", "tree"])
# every failure detail is one of these fixed lines; (step, class): class m is a mismatch, i is incomplete
FAIL = {"record_unread": ("day_record", "i", "the day record could not be read from the ledger"),
        "record_sha": ("day_record", "m", "the day record bytes do not hash to the sha the runner names"),
        "record_shape": ("day_record", "m", "the day record does not have its expected shape"),
        "record_other": ("day_record", "m", "the day record names another day, runner, n or root than the runner status"),
        "too_many": ("day_record", "i", "the day has more leaves than one run may read"),
        "keys_unread": ("runner_key", "i", "the runner key list could not be read from the ledger"),
        "key_missing": ("runner_key", "m", "the runner key list has no usable key for this runner"),
        "record_sig": ("signature", "m", "the day record signature does not verify"),
        "leaf_unread": ("envelope_shape", "i", "the leaf could not be read from the runner"),
        "budget": ("envelope_shape", "i", "the run reached its time or call limit before this leaf"),
        "leaf_shape": ("envelope_shape", "m", "the leaf or its envelope does not have its expected shape"),
        "leaf_hash": ("leaf_sha256", "m", "the leaf hash is not the hash of its envelope"),
        "path": ("audit_path", "m", "the root recomputed from the audit path differs from the record"),
        "leaf_sig": ("signature", "m", "the envelope signature does not verify"),
        "key_range": ("runner_key", "m", "the runner key was not valid at the heights the record names"),
        "head_unread": ("ledger_head", "h", "the ledger head could not be read or did not have its shape"),
        "anchor_wait": ("bitcoin_anchor", "i", "the day record was not in a ledger batch confirmed in Bitcoin 4 days after the day"),
        "anchor_entry_unread": ("bitcoin_anchor", "i", "the ledger batch entry that lists the day record could not be read"),
        "anchor_entry": ("bitcoin_anchor", "m", "the ledger batch entry does not hash to its claim or does not list the day record"),
        "anchor_ots_unread": ("bitcoin_anchor", "i", "the OpenTimestamps proof of the batch entry could not be read"),
        "anchor_ots": ("bitcoin_anchor", "m", "the OpenTimestamps proof does not commit the batch entry to the Bitcoin block the ledger names"),
        "anchor_explorer": ("bitcoin_anchor", "i", "the two block explorers did not serve one block hash and one header at the height"),
        "anchor_header": ("bitcoin_anchor", "i", "the header the explorers served does not hash to the block hash or does not meet its target"),
        "anchor_root": ("bitcoin_anchor", "m", "the block header does not hold the merkle root the OpenTimestamps proof reaches")}
# an anchor read that failed on the side of the network or the explorers is tried again by the next run until the day is
# ANCHOR_WAIT days old; then the anchor answer is signed incomplete with that failure
RETRY = ("anchor_entry_unread", "anchor_ots_unread", "anchor_explorer", "anchor_header")
LIMITS = {"day": ["The Bitcoin anchor is not in this answer: a day record is anchored one or two days after the day, and this tool checks it then, in its anchor answer (purpose furui-anchor-v0).",
                  "This answer checks the day record and its leaves as the operator serves them, not the checks they describe.",
                  "A leaf the runner no longer serves cannot be checked, and the answer then says incomplete."],
          "anchor": ["The block hash and header were read from two block explorers, mempool.space and blockstream.info, not from a copy of the Bitcoin chain the witness keeps.",
                     "The header's proof of work was checked against the target of its own bits, not against the difficulty of the chain at that height.",
                     "This answer checks the day record and its leaves as the operator serves them, not the checks they describe.",
                     "A leaf the runner no longer serves cannot be checked, and the answer then says incomplete."]}
VANTAGE = "a GitHub Actions runner of the witness (furui-witness-kit 0.2.0)"


class Unread(Exception):
    pass


class Budget(Exception):
    pass


def canonical(o):
    """keys sorted, no whitespace, non-ASCII raw; refuses floats, big integers, odd keys and lone surrogates"""
    def chk(v):
        if isinstance(v, bool) or v is None:
            return
        if isinstance(v, int):
            if not -SAFE <= v <= SAFE:
                raise ValueError("integer out of range")
        elif isinstance(v, str):
            if any(0xD800 <= ord(ch) <= 0xDFFF for ch in v):
                raise ValueError("lone surrogate")
        elif isinstance(v, list):
            for x in v:
                chk(x)
        elif isinstance(v, dict):
            for k, x in v.items():
                if not (isinstance(k, str) and all(0x20 <= ord(ch) <= 0x7E for ch in k)):
                    raise ValueError("key")
                chk(x)
        else:
            raise ValueError("type")
    chk(o)
    return json.dumps(o, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _const(c):
    raise ValueError("NaN or Infinity")


def parse(b):
    """bytes -> value; valid UTF-8 only, no NaN or Infinity. Numbers that are copied anywhere are checked as integers (isint)."""
    t = b.decode("utf-8") if isinstance(b, (bytes, bytearray)) else b
    return json.loads(t, parse_constant=_const)


def sha(b):
    return hashlib.sha256(b if isinstance(b, (bytes, bytearray)) else b.encode("utf-8")).hexdigest()


def isint(x, lo=0, hi=SAFE):
    return isinstance(x, int) and not isinstance(x, bool) and lo <= x <= hi


def keys(o, ks):
    return isinstance(o, dict) and sorted(o) == sorted(ks)


def real_day(s):
    try:
        return bool(isinstance(s, str) and DAY.fullmatch(s) and datetime.date.fromisoformat(s))
    except ValueError:
        return False


def b64(s, n):
    try:
        b = base64.b64decode(s, validate=True) if isinstance(s, str) else None
    except ValueError:
        return None
    return b if b is not None and len(b) == n and base64.b64encode(b).decode() == s else None


def ssh_ed25519_key(b):
    """bytes as served: one OpenSSH line, with at most one final \\n or \\r\\n -> the 32 key bytes, or None (the same reading
    as the ledger's witness intake, src/ssh_ed25519.mjs, and witness-enroll-v0's ssh_ed25519_key)"""
    try:
        t = b.decode("ascii")
    except (UnicodeDecodeError, AttributeError):
        return None
    t = t[:-2] if t.endswith("\r\n") else t[:-1] if t.endswith("\n") else t
    m = SSH_LINE.fullmatch(t)
    if not m:
        return None
    try:
        w = base64.b64decode(m.group(1), validate=True)
    except ValueError:
        return None
    if base64.b64encode(w).decode() != m.group(1) or len(w) != 4 + 11 + 4 + 32:
        return None
    if w[:4] != (11).to_bytes(4, "big") or w[4:15] != b"ssh-ed25519" or w[15:19] != (32).to_bytes(4, "big"):
        return None
    return w[19:]


def served_key(b):
    """the 32 key bytes a key_url serves: {"public_key_ed25519_b64": ...} or one ssh-ed25519 line; None otherwise"""
    try:
        doc = parse(b)
    except (ValueError, UnicodeDecodeError, RecursionError):
        return ssh_ed25519_key(b)
    return b64(doc.get("public_key_ed25519_b64"), 32) if isinstance(doc, dict) else None


# ---- the network: one door with every limit ----
class Net:
    def __init__(self, hosts, now=time.monotonic):
        self.hosts, self.now, self.calls, self.t0 = set(hosts), now, 0, now()

    def _open(self, req, timeout):
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **k):
                return None
        try:
            with urllib.request.build_opener(NoRedirect).open(req, timeout=timeout) as r:
                return r.status, r.read(CAP + 1)
        except urllib.error.HTTPError as e:
            return e.code, e.read(CAP + 1)

    def left(self):
        return CALLS - self.calls

    def fetch(self, url, body=None, accept="application/json"):
        m = re.fullmatch(r"https://([a-z0-9.-]+)(/[^\s#]*)", url)
        if not m or m.group(1) not in self.hosts:
            raise Unread("not an allowed URL")
        left = RUN_S - (self.now() - self.t0)
        if self.calls >= CALLS or left <= 1:
            raise Budget()
        self.calls += 1
        h = {"user-agent": UA, "accept": accept}
        if body is not None:
            h["content-type"] = "application/json"
        req = urllib.request.Request(url, data=body, headers=h, method="POST" if body is not None else "GET")
        try:
            st, data = self._open(req, min(CALL_S, left))
        except (urllib.error.URLError, OSError, ValueError, http.client.HTTPException) as e:
            raise Unread(type(e).__name__)
        if len(data) > CAP:
            raise Unread("larger than the cap")
        return st, data

    def json(self, url):
        st, data = self.fetch(url)
        if st != 200:
            raise Unread("http %s" % st)
        try:
            return parse(data)
        except (ValueError, UnicodeDecodeError, RecursionError):
            raise Unread("not JSON")


# ---- openssl ----
OPENSSL = os.environ.get("FURUI_WITNESS_OPENSSL", "openssl")


def ossl(args, tmp):
    return subprocess.run([OPENSSL] + args, cwd=tmp, capture_output=True, timeout=20)


def verify(pub, msg, sig):
    with tempfile.TemporaryDirectory() as t:
        for n, b in (("p.pem", b"-----BEGIN PUBLIC KEY-----\n" + base64.b64encode(DER + pub) + b"\n-----END PUBLIC KEY-----\n"), ("m", msg), ("s", sig)):
            with open(os.path.join(t, n), "wb") as f:
                f.write(b)
        r = ossl(["pkeyutl", "-verify", "-pubin", "-inkey", "p.pem", "-rawin", "-in", "m", "-sigfile", "s"], t)
        return r.returncode == 0 and b"Verified Successfully" in r.stdout


class Signer:
    """the witness key, from env FURUI_WITNESS_KEY, in a 0700 folder that is removed at the end of the run"""
    def __init__(self, pem):
        self.t = tempfile.mkdtemp()
        p = os.path.join(self.t, "k.pem")
        fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(pem)
        r = ossl(["pkey", "-in", "k.pem", "-pubout", "-outform", "DER"], self.t)
        if r.returncode != 0 or len(r.stdout) != 44 or r.stdout[:12] != DER:
            self.close()
            raise SystemExit("FURUI_WITNESS_KEY is not an Ed25519 private key in PEM")
        self.pub = r.stdout[12:]
        self.key_id = "ed25519:" + sha(self.pub)[:16]

    def sign(self, msg):
        with open(os.path.join(self.t, "m"), "wb") as f:
            f.write(msg)
        r = ossl(["pkeyutl", "-sign", "-inkey", "k.pem", "-rawin", "-in", "m"], self.t)
        if r.returncode != 0 or len(r.stdout) != 64 or not verify(self.pub, msg, r.stdout):
            raise SystemExit("openssl did not make an Ed25519 signature that verifies")
        return r.stdout

    def close(self):
        for n in ("k.pem", "m"):
            try:
                os.remove(os.path.join(self.t, n))
            except OSError:
                pass
        os.rmdir(self.t)


# ---- the checks (the steps of nenrin-verify furui-day) ----
def envelope_ok(e, rid):
    if not keys(e, ["check", "schema", "signatures", "signer"]) or e["schema"] != "furui-check-signed-v1":
        return False
    c = e["check"]
    if not keys(c, CHECK_KEYS) or c["schema"] != "furui-check-v1":
        return False
    hx = lambda v: isinstance(v, str) and H64.fullmatch(v)
    if not all(hx(c[k]) for k in ("input_commit", "action_binding_digest", "contract_sha256", "trace_sha256")):
        return False
    if not all(c[k] is None or hx(c[k]) for k in ("rules_sha256", "scope_sha256")) or c["decision"] not in (None, "stop", "pass"):
        return False
    if c["marks"] not in ([], ["off_topic"], ["rule_conflict"], ["off_topic", "rule_conflict"]):
        return False
    if not isinstance(c["unread"], bool) or not isinstance(c["answered"], bool) or not isint(c["stage_reached"], 0, 4) or not isint(c["checked_at_height"]):
        return False
    if not (isinstance(c["nonce"], str) and NONCE.fullmatch(c["nonce"]) and isinstance(c["signed_at"], str) and ISO_MS.fullmatch(c["signed_at"])):
        return False
    g = e["signatures"][0] if isinstance(e["signatures"], list) and len(e["signatures"]) == 1 else None
    return (e["signer"] == SIGNER and keys(g, ["alg", "domain", "key_id", "sig"]) and g["alg"] == "ed25519"
            and g["domain"] == SIGNER["domain"] and g["key_id"] == rid and isinstance(g["sig"], str) and bool(SIG88.fullmatch(g["sig"])))


def record_ok(r, rid, d):
    rk = sorted(DAY_KEYS + ["runner_id"]) if isinstance(r, dict) and "runner_id" in r else DAY_KEYS
    if not keys(r, rk) or r["schema"] != "furui-check-day-v0" or r.get("runner_id", "runner-1") != rid or r["day"] != d:
        return False
    g = r["signatures"][0] if isinstance(r["signatures"], list) and len(r["signatures"]) == 1 else None
    return (r["signer"] == SIGNER and isint(r["n"], 1, MAX_N) and r["tree"] == "rfc6962-sha256" and r["leaf"] == DAY_LEAF
            and isinstance(r["root"], str) and bool(H64.fullmatch(r["root"])) and isint(r["first_height"]) and isint(r["last_height"])
            and r["first_height"] <= r["last_height"] and isint(r["late"]) and isint(r["clock_skew"]) and r["publication"] == "public"
            and keys(g, ["alg", "domain", "key_id", "sig"]) and g["alg"] == "ed25519" and g["domain"] == "horizonshield.dev"
            and g["key_id"] == rid and b64(g["sig"], 64) is not None)


def node(a, b):
    return sha(b"\x01" + bytes.fromhex(a) + bytes.fromhex(b))


def root_from_path(leaf, m, n, path):
    if n == 1:
        return leaf if not path else None
    if not path:
        return None
    k = 1
    while k * 2 < n:
        k *= 2
    if m < k:
        x = root_from_path(leaf, m, k, path[:-1])
        return None if x is None else node(x, path[-1])
    x = root_from_path(leaf, m - k, n - k, path[:-1])
    return None if x is None else node(path[-1], x)


def day_message(r):
    return ("furui-check-day-v0\n" + canonical({k: v for k, v in r.items() if k != "signatures"})).encode("utf-8")


def envelope_message(e):
    return ("furui-check-signed-v1\n" + canonical({"schema": e["schema"], "check": e["check"], "signer": e["signer"]})).encode("utf-8")


def read_record(net, d, rid, st):
    """-> (record values, record or None, the ledger's answer {status, ledger_entry} or None, failures) for the sha st names"""
    fails, rec_v = [], {"day_sha256": st["ledger_canonical_sha256"], "root": None, "n": None}
    try:
        lr = net.json(LEDGER + "/furui-check-day/" + rec_v["day_sha256"])
        rc = lr.get("record_canonical") if isinstance(lr, dict) else None
        if not isinstance(rc, str):
            raise Unread("no record_canonical")
    except Budget:
        return rec_v, None, None, [(None, "budget")]
    except Unread:
        return rec_v, None, None, [(None, "record_unread")]
    at = {"status": lr.get("status"), "ledger_entry": lr.get("ledger_entry")}
    if sha(rc) != rec_v["day_sha256"]:
        return rec_v, None, at, [(None, "record_sha")]
    try:
        rec = parse(rc)
        ok = canonical(rec) == rc and record_ok(rec, rid, d)
    except (ValueError, RecursionError):
        ok = False
    if not ok:
        return rec_v, None, at, [(None, "record_shape")]
    rec_v.update(root=rec["root"], n=rec["n"])
    if rec["n"] != st["n"] or rec["root"] != st["root"]:
        return rec_v, None, at, [(None, "record_other")]
    return rec_v, rec, at, fails


def check_leaves(net, d, rid, rec, rec_v, keydoc):
    """-> (leaf_index, recomputed, failures) of the five steps, for a record read_record accepted"""
    fails = []
    f = lambda code, leaf=None: fails.append((leaf, code))
    k = None
    if keydoc is None:
        f("keys_unread")
    else:
        k = next((x for x in keydoc if isinstance(x, dict) and x.get("key_id") == rid), None)
        pub = b64(k.get("public_key_ed25519_b64"), 32) if k else None
        if pub is None or not isint(k.get("from_height")) or not (k.get("revoked_height") is None or isint(k.get("revoked_height"))):
            f("key_missing")
            k = None
        else:
            k = (pub, k["from_height"], k.get("revoked_height"))
            if not verify(pub, day_message(rec), b64(rec["signatures"][0]["sig"], 64)):
                f("record_sig")
    done = {s: True for s in STEPS}
    if k is None:
        done["signature"] = done["runner_key"] = False
    if any(c == "record_sig" for _, c in fails):
        done["signature"] = False
    leaves = []
    for i in range(rec["n"]):
        try:
            a = net.json(FURUI + TREES[rid] + "%s/leaf/%d" % (d, i))
        except Budget:
            f("budget", i)
            break
        except Unread:
            f("leaf_unread", i)
            done = {s: False for s in STEPS}
            continue
        leaves.append(i)
        env = a.get("envelope") if isinstance(a, dict) else None
        try:
            envc = canonical(env) if envelope_ok(env, rid) else None
        except ValueError:
            envc = None
        if envc is None or a.get("day") != d or a.get("index") != i:
            f("leaf_shape", i)
            done = {s: False for s in STEPS}
            continue
        lh = sha(b"\x00" + envc.encode("utf-8"))
        if a.get("leaf_sha256") != lh or a.get("envelope_sha256") != sha(envc):
            f("leaf_hash", i)
            done.update(leaf_sha256=False, audit_path=False)
        else:
            pr, dr = a.get("proof"), a.get("day_record")
            if (a.get("proof_kind") != "rfc6962-audit-path" or not isinstance(pr, list) or len(pr) > 64
                    or not all(isinstance(x, str) and H64.fullmatch(x) for x in pr) or a.get("n") != rec["n"] or a.get("root") != rec["root"]
                    or not isinstance(dr, dict) or dr.get("ledger_canonical_sha256") != rec_v["day_sha256"]
                    or root_from_path(lh, i, rec["n"], pr) != rec["root"]):
                f("path", i)
                done["audit_path"] = False
        if k is not None:
            if not verify(k[0], envelope_message(env), base64.b64decode(env["signatures"][0]["sig"])):
                f("leaf_sig", i)
                done["signature"] = False
            hh = env["check"]["checked_at_height"]
            if rec["first_height"] < k[1] or hh < k[1] or (k[2] is not None and (rec["last_height"] >= k[2] or hh >= k[2])):
                f("key_range", i)
                done["runner_key"] = False
    if not leaves:
        done = {s: False for s in STEPS}
    return leaves, [s for s in STEPS if done[s]], fails


# ---- OpenTimestamps: enough of the format to follow sha256, append and prepend to the Bitcoin attestations ----
# (the reading of nenrin-verify's furui_day.py ots_parse: the same limits, the same refusals)
OTS_MAGIC = b"\x00OpenTimestamps\x00\x00Proof\x00\xbf\x89\xe2\xe8\x84\xe8\x92\x94"
OTS_BITCOIN = bytes.fromhex("0588960d73d71901")
OTS_PENDING = bytes.fromhex("83dfe30d2ef90c8e")


def ots_parse(b):
    """-> (file digest bytes, [(height, merkle root in block explorer order)], pending count) or raise ValueError"""
    pos = [0]

    def rd(n):
        if pos[0] + n > len(b):
            raise ValueError("ots_truncated")
        v = b[pos[0]:pos[0] + n]
        pos[0] += n
        return v

    def varuint():
        v = 0
        for i in range(8):
            c = rd(1)[0]
            v |= (c & 0x7F) << (7 * i)
            if not c & 0x80:
                if v > SAFE:
                    raise ValueError("ots_varuint")
                return v
        raise ValueError("ots_varuint")

    def varbytes(mx):
        n = varuint()
        if n > mx:
            raise ValueError("ots_too_long")
        return rd(n)

    if rd(len(OTS_MAGIC)) != OTS_MAGIC or varuint() != 1 or rd(1) != b"\x08":
        raise ValueError("ots_header")
    digest = rd(32)
    btc, pend, steps = [], [0], [0]

    def item(tag, msg, depth):
        if tag == 0:
            t = rd(8)
            payload = varbytes(8192)
            if t == OTS_BITCOIN:
                v, i, done = 0, 0, False
                while i < len(payload) and i < 8:
                    c = payload[i]
                    v |= (c & 0x7F) << (7 * i)
                    i += 1
                    if not c & 0x80:
                        done = True
                        break
                if not done or i != len(payload) or v > SAFE or len(msg) != 32:
                    raise ValueError("ots_attestation")
                btc.append((v, msg[::-1].hex()))
            elif t == OTS_PENDING:
                pend[0] += 1
            return
        steps[0] += 1
        if steps[0] > 10000 or depth > 256:
            raise ValueError("ots_too_deep")
        if tag == 0x08:
            nxt = hashlib.sha256(msg).digest()
        elif tag == 0xF0:
            nxt = msg + varbytes(4096)
        elif tag == 0xF1:
            nxt = varbytes(4096) + msg
        else:
            raise ValueError("ots_unsupported_op")
        if len(nxt) > 4096:
            raise ValueError("ots_too_long")
        stamp(nxt, depth + 1)

    def stamp(msg, depth):
        tag = rd(1)[0]
        while tag == 0xFF:
            item(rd(1)[0], msg, depth)
            tag = rd(1)[0]
        item(tag, msg, depth)

    try:
        stamp(digest, 0)
    except RecursionError:
        raise ValueError("ots_too_deep")
    if pos[0] != len(b):
        raise ValueError("ots_trailing")
    return digest, btc, pend[0]


def sha256d(b):
    return hashlib.sha256(hashlib.sha256(b).digest()).digest()


def bits_target(bits):
    """the target a header's compact bits encode, or None when the bits are negative, zero or wider than 256 bits"""
    exp, mant = bits >> 24, bits & 0x007FFFFF
    if bits & 0x00800000 or mant == 0 or exp > 32:
        return None
    return mant << (8 * (exp - 3)) if exp >= 3 else mant >> (8 * (3 - exp))


class Anchor:
    """step 6 for the day records of one run; a batch entry and a block header are read once per run"""
    def __init__(self, net):
        self.net, self.entries, self.headers = net, {}, {}

    def check(self, rec_sha, at):
        """-> ("wait", None, None) while the record is not in a confirmed batch; ("ok", None, facts); or (state, code, None)
        with state retry (RETRY codes: tried again by the next run) or done (a mismatch code). Budget passes through."""
        if not isinstance(at, dict) or at.get("status") != "anchored" or not isint(at.get("ledger_entry"), 1):
            return "wait", None, None
        n = at["ledger_entry"]
        if n not in self.entries:
            self.entries[n] = self._entry(n)
        code, e = self.entries[n]
        if code:
            return ("retry" if code in RETRY else "done"), code, None
        if rec_sha not in e["listed"]:
            return "done", "anchor_entry", None
        if not e["confirmed"]:
            return "wait", None, None
        code, ots = e["ots"]
        if code:
            return ("retry" if code in RETRY else "done"), code, None
        h, mr = ots
        if h not in self.headers:
            self.headers[h] = self._header(h)
        code, bh = self.headers[h]
        if code:
            return ("retry" if code in RETRY else "done"), code, None
        if bh["merkle_root"] != mr:
            return "done", "anchor_root", None
        return "ok", None, {"ledger_entry": n, "bitcoin_block": h, "block_hash": bh["block_hash"]}

    def _entry(self, n):
        try:
            e = self.net.json(LEDGER + "/ledger/%d?format=json" % n)
        except Unread:
            return "anchor_entry_unread", None
        rc = e.get("record_canonical") if isinstance(e, dict) else None
        if not isinstance(rc, str) or e.get("claim_sha256") != sha(rc):
            return "anchor_entry", None
        try:
            bt = parse(rc)
        except (ValueError, RecursionError):
            bt = None
        rows = bt.get("records") if isinstance(bt, dict) and bt.get("schema") == "nenrin-agreement-batch-v1" else None
        if not isinstance(rows, list):
            return "anchor_entry", None
        listed = {r["canonical_sha256"] for r in rows if isinstance(r, dict) and r.get("record_schema") == "furui-check-day-v0"
                  and isinstance(r.get("canonical_sha256"), str) and H64.fullmatch(r["canonical_sha256"])}
        confirmed = e.get("ots_status") == "confirmed" and isint(e.get("bitcoin_block"), 1)
        out = {"listed": listed, "confirmed": confirmed, "ots": (None, None)}
        if confirmed:
            out["ots"] = self._ots(n, e["claim_sha256"], e["bitcoin_block"])
        return None, out

    def _ots(self, n, claim, height):
        try:
            st, b = self.net.fetch(LEDGER + "/ledger/%d/ots" % n, accept="application/vnd.opentimestamps.proof")
        except Unread:
            return "anchor_ots_unread", None
        if st != 200:
            return "anchor_ots_unread", None
        try:
            digest, btc, _p = ots_parse(b)
        except ValueError:
            return "anchor_ots", None
        hit = [m for h, m in btc if h == height]
        if digest.hex() != claim or not hit:
            return "anchor_ots", None
        return None, (height, hit[0])

    def _header(self, h):
        hashes, headers = [], []
        for _name, base in EXPLORERS:
            try:
                st, b = self.net.fetch(base + "/block-height/%d" % h, accept="text/plain")
                t = b.decode("latin-1")
                if st != 200 or not H64.fullmatch(t):
                    return "anchor_explorer", None
                st, b = self.net.fetch(base + "/block/" + t + "/header", accept="text/plain")
                x = b.decode("latin-1")
                if st != 200 or not H160.fullmatch(x):
                    return "anchor_explorer", None
            except Unread:
                return "anchor_explorer", None
            hashes.append(t)
            headers.append(x)
        if hashes[0] != hashes[1] or headers[0] != headers[1]:
            return "anchor_explorer", None
        hb = bytes.fromhex(headers[0])
        bh = sha256d(hb)[::-1].hex()
        target = bits_target(int.from_bytes(hb[72:76], "little"))
        if bh != hashes[0] or target is None or int(bh, 16) > target:
            return "anchor_header", None
        return None, {"block_hash": bh, "merkle_root": hb[36:68][::-1].hex()}


# ---- the answers ----
def build(kind, d, rid, rec_v, leaves, recomputed, fails, head, w, impl, observed_at):
    fl = [{"leaf": leaf, "step": FAIL[c][0], "detail": FAIL[c][2]} for leaf, c in fails]
    cls = {FAIL[c][1] for _, c in fails}
    outcome = "mismatch" if "m" in cls else ("incomplete" if "i" in cls else "match")
    if outcome == "match" and (len(leaves) != rec_v["n"] or recomputed != (ANCHOR_STEPS if kind == "anchor" else STEPS)):
        outcome = "incomplete"
    return {"schema": "witness-answer-v0.2", "kind": "furui-day", "day": d, "runner_id": rid, "outcome": outcome,
            "day_sha256": rec_v["day_sha256"], "root": rec_v["root"], "n": rec_v["n"], "leaf_index": leaves, "recomputed": recomputed,
            "failures": fl[:64], "implementation": impl, "ledger_head": head,
            "tool": "%s %s furui_witness.py sha256 %s" % (KIT, VERSION, impl["sha256"]), "observed_at": observed_at,
            "limits": list(LIMITS[kind]), "witness": w}


def intake_record(a):
    """the jidec-path-v1 commitment record of a day answer that the ledger's POST /witness takes (the same bytes as
    witness_answer_v0.intake_record)"""
    rec = {"schema": "jidec-path-v1", "purpose": PURPOSE["day"] + a["day"], "walked_at": a["observed_at"],
           "base": LEDGER + "/furui-check-day/" + a["day_sha256"], "mode": "commitment", "commitment": a["day_sha256"],
           "witness": {"name": a["witness"]["name"], "vantage": VANTAGE, "key_url": a["witness"]["key_url"]},
           "establishes": ["the witness recomputed: " + ", ".join(a["recomputed"]),
                           "the signed witness-answer-v0 in answer carries the same day_sha256 under key " + a["witness"]["key_id"]],
           "does_not_establish": list(a["limits"]), "answer": a}
    return canonical(rec)


def anchor_record(a, facts):
    """the record of an anchor answer: the day answer's record under purpose furui-anchor-v0, and, when step 6 held, one more
    line that names the ledger entry, the Bitcoin block height and the block hash"""
    est = ["the witness recomputed: " + ", ".join(a["recomputed"]) if a["recomputed"] else "the witness recomputed no step",
           "the signed witness-answer-v0 in answer carries the same day_sha256 under key " + a["witness"]["key_id"]]
    if facts:
        est.append("the day record is listed in ledger entry %d, whose OpenTimestamps proof reaches Bitcoin block %d (%s); "
                   "mempool.space and blockstream.info served the same header, which holds the proof's merkle root"
                   % (facts["ledger_entry"], facts["bitcoin_block"], facts["block_hash"]))
    rec = {"schema": "jidec-path-v1", "purpose": PURPOSE["anchor"] + a["day"], "walked_at": a["observed_at"],
           "base": LEDGER + "/furui-check-day/" + a["day_sha256"], "mode": "commitment", "commitment": a["day_sha256"],
           "witness": {"name": a["witness"]["name"], "vantage": VANTAGE, "key_url": a["witness"]["key_url"]},
           "establishes": est, "does_not_establish": list(a["limits"]), "answer": a}
    return canonical(rec)


def kept_answers(folder):
    """({(day, runner_id)} with a day answer, {(day, runner_id)} with an anchor answer), from the files job keep committed
    (answers/<D>/<sha>.json); a record of kit 0.1.0 is a day answer"""
    out = {"day": set(), "anchor": set()}
    for d in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        if not real_day(d):
            continue
        for n in os.listdir(os.path.join(folder, d)):
            try:
                with open(os.path.join(folder, d, n), "rb") as f:
                    r = parse(f.read(CAP))
                a = r.get("answer", {})
                kind = "anchor" if r.get("purpose") == PURPOSE["anchor"] + d else "day"
                if a.get("day") == d and a.get("runner_id") in TREES:
                    out[kind].add((d, a["runner_id"]))
            except (OSError, ValueError, AttributeError, UnicodeDecodeError, RecursionError):
                continue
    return out["day"], out["anchor"]


def answer(args, net=None, signer=None):
    now = datetime.datetime.strptime(args["--now"], "%Y-%m-%dT%H:%M:%SZ") if "--now" in args else datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None).replace(microsecond=0)
    ku, name = os.environ.get("FURUI_WITNESS_KEY_URL", ""), os.environ.get("FURUI_WITNESS_NAME", "")
    m = re.fullmatch(r"https://([a-z0-9.-]+)/[A-Za-z0-9._~/-]*", ku)
    if not m or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}", name):
        raise SystemExit("set FURUI_WITNESS_KEY_URL (https, your own host) and FURUI_WITNESS_NAME (letters, digits, space . _ -)")
    net = net or Net(["furui.horizonshield.dev", "ledger.horizonshield.dev", m.group(1)] + [u[8:].split("/")[0] for _, u in EXPLORERS])
    signer = signer or Signer(os.environ.get("FURUI_WITNESS_KEY", ""))
    try:
        return _answer(args, net, signer, now, ku, name)
    finally:
        signer.close()


def _status(net, d, rid, lines):
    """the runner's accepted status of d, or (None, ok): None with a line when there is nothing to answer about"""
    try:
        st = net.json(FURUI + TREES[rid] + "%s/status" % d)
    except Budget:
        lines.append("%s %s: not read in this run (call or time limit); the next run takes it" % (d, rid))
        return None, True
    except Unread:
        lines.append("%s %s: the runner status was not read; no answer (it names the sha to answer about)" % (d, rid))
        return None, False
    s = st.get("status") if isinstance(st, dict) and st.get("day") == d else None
    state = s.get("state") if isinstance(s, dict) else None
    if state != "accepted":
        lines.append("%s %s: no accepted day record to answer about (%s)" % (d, rid, state if state in ("empty", "open", "refused") else "no status yet"))
        return None, True
    if not (isinstance(s.get("ledger_canonical_sha256"), str) and H64.fullmatch(s["ledger_canonical_sha256"])
            and isint(s.get("n"), 1, MAX_N) and isinstance(s.get("root"), str) and H64.fullmatch(s["root"])):
        lines.append("%s %s: the runner status names an accepted day without its sha, n and root in their shape; no answer" % (d, rid))
        return None, False
    return s, True


def _answer(args, net, signer, now, ku, name):
    out, shas, lines, ok = args["--out"], [], [], True
    os.makedirs(out, exist_ok=True)
    try:
        st_, kb = net.fetch(ku, accept="application/json, text/plain")
        served = served_key(kb) if st_ == 200 else None
    except (Unread, Budget):
        served = None
    if served != signer.pub:
        raise SystemExit("your key_url does not serve the public key of FURUI_WITNESS_KEY; nothing was sent")
    with open(os.path.abspath(__file__), "rb") as f:
        impl = {"origin": "operator-kit", "name": KIT, "version": VERSION, "sha256": sha(f.read())}
    w = {"name": name, "key_id": signer.key_id, "key_url": ku}
    stamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        h = net.json(LEDGER + "/ledger/head")
        head = {"n": h["n"], "head": h["head"], "observed_at": stamp} \
            if isinstance(h, dict) and isint(h.get("n"), 1, 10 ** 9) and isinstance(h.get("head"), str) and H64.fullmatch(h["head"]) else None
    except (Unread, Budget):
        head = None
    try:
        kd = net.json(SIGNER["key_url"])
        keydoc = kd["keys"] if isinstance(kd, dict) and kd.get("use") == "furui-check" and isinstance(kd.get("keys"), list) else None
    except (Unread, Budget):
        keydoc = None
    day_done, anchor_done = kept_answers(args["--answers"])
    yday = (now - datetime.timedelta(days=1)).date()
    first = min([datetime.date.fromisoformat(d) for d, _ in day_done] or [yday])
    days = [str(yday - datetime.timedelta(days=i)) for i in range(BACK + 1) if yday - datetime.timedelta(days=i) >= first]
    late = now.hour >= 3                         # the 03:50 run; the 01:50 run holds an incomplete answer back for it
    seen, anchors = {}, Anchor(net)

    def send(kind, a, facts=None):
        """sign a, POST its record, keep the bytes in out; -> True when the ledger took it"""
        nonlocal ok
        d, rid = a["day"], a["runner_id"]
        a["signature"] = {"alg": "ed25519", "key_id": signer.key_id, "sig": "A" * 86 + "=="}
        body = {k: v for k, v in a.items() if k != "signature"}
        a["signature"]["sig"] = base64.b64encode(signer.sign(("witness-answer-v0.2\n" + canonical(body)).encode("utf-8"))).decode()
        rcan = intake_record(a) if kind == "day" else anchor_record(a, facts)
        post = json.dumps({"record_canonical": rcan, "signature_ed25519_b64": base64.b64encode(signer.sign(rcan.encode("utf-8"))).decode(),
                           "public_key_ed25519_b64": base64.b64encode(signer.pub).decode()}).encode("utf-8")
        try:
            ps, pb = net.fetch(LEDGER + "/witness", post)
            pj = parse(pb) if ps in (200, 201) else None
        except (Unread, Budget, ValueError, UnicodeDecodeError, RecursionError):
            ps, pj = None, None
        if not (isinstance(pj, dict) and pj.get("sha") == sha(rcan)):
            lines.append("%s %s: %s answer %s, but the ledger did not take it (http %s); not kept" % (d, rid, kind, a["outcome"], ps))
            ok = False
            return False
        with open(os.path.join(out, sha(rcan) + ".json"), "w", encoding="utf-8", newline="") as fo:
            fo.write(rcan)
        shas.append(sha(rcan))
        ok = ok and a["outcome"] == "match"
        note = "" if kind == "anchor" or pj.get("counted", True) else " (stored, not counted)"
        blk = " (block %d)" % facts["bitcoin_block"] if facts else ""
        lines.append("%s %s: %s answer %s%s, sent %s%s" % (d, rid, kind, a["outcome"], blk, sha(rcan), note))
        return True

    # 1. day answers, the newest day first: the five steps, at the first run after the day closes
    for d in sorted(days, reverse=True):
        for rid in TREES:
            if (d, rid) in day_done:
                continue
            s, good = _status(net, d, rid, lines)
            ok = ok and good
            if s is None:
                continue
            if s["n"] + 3 + BASE_CALLS > CALLS:
                rec_v, leaves, rc, fails = {"day_sha256": s["ledger_canonical_sha256"], "root": None, "n": None}, [], [], [(None, "too_many")]
            elif s["n"] + 2 > net.left():
                lines.append("%s %s: not read in this run (call limit); the next run takes it" % (d, rid))
                continue
            else:
                rec_v, rec, at, fails = read_record(net, d, rid, s)
                leaves, rc = [], []
                if rec is not None:
                    leaves, rc, f2 = check_leaves(net, d, rid, rec, rec_v, keydoc)
                    fails = fails + f2
                if any(c == "budget" for _, c in fails):
                    lines.append("%s %s: not finished in this run (call or time limit); the next run takes it" % (d, rid))
                    continue
                seen[(d, rid)] = (s, rec_v, rec, at, leaves, rc, fails)
            a = build("day", d, rid, rec_v, leaves, rc, fails + ([(None, "head_unread")] if head is None else []), head, w, impl, stamp)
            if a["outcome"] == "incomplete" and not late and d == str(yday):
                lines.append("%s %s: incomplete; held back for the run after 03:00 UTC" % (d, rid))
                continue
            if send("day", a):
                day_done.add((d, rid))

    # 2. anchor answers, the oldest day first: the six steps, once the day record's batch entry is confirmed in Bitcoin
    for d in sorted(days):
        age = (now.date() - datetime.date.fromisoformat(d)).days
        for rid in TREES:
            if (d, rid) in anchor_done or (d, rid) not in day_done:
                continue
            if (d, rid) in seen:
                s, rec_v, rec, at, leaves, rc, fails = seen[(d, rid)]
            else:
                if net.left() < 3:
                    lines.append("%s %s: anchor not read in this run (call limit); the next run takes it" % (d, rid))
                    continue
                s, good = _status(net, d, rid, lines)
                ok = ok and good
                if s is None:
                    continue
                rec_v, rec, at, fails = read_record(net, d, rid, s)
                leaves = rc = None
            if any(c == "budget" for _, c in fails):
                lines.append("%s %s: anchor not read in this run (call or time limit); the next run takes it" % (d, rid))
                continue
            if at is None:                     # the ledger did not answer for the day record
                if age <= ANCHOR_WAIT:
                    lines.append("%s %s: %s; the next run tries again" % (d, rid, FAIL["record_unread"][2]))
                    continue
                state, code, facts = "done", None, None
            else:
                try:
                    state, code, facts = anchors.check(rec_v["day_sha256"], at)
                except Budget:
                    lines.append("%s %s: anchor not read in this run (call or time limit); the next run takes it" % (d, rid))
                    continue
            if state == "wait" and age <= ANCHOR_WAIT:
                lines.append("%s %s: the day record is not in a batch confirmed in Bitcoin yet; the anchor answer waits" % (d, rid))
                continue
            if state == "retry" and age <= ANCHOR_WAIT:
                lines.append("%s %s: %s; the next run tries again" % (d, rid, FAIL[code][2]))
                continue
            if leaves is None:
                leaves, rc = [], []
                if rec is not None and rec["n"] + 3 + BASE_CALLS > CALLS:
                    fails = fails + [(None, "too_many")]
                elif rec is not None:
                    if rec["n"] + 1 > net.left():
                        lines.append("%s %s: anchor answer not finished in this run (call limit); the next run takes it" % (d, rid))
                        continue
                    leaves, rc, f2 = check_leaves(net, d, rid, rec, rec_v, keydoc)
                    fails = fails + f2
                    if any(c == "budget" for _, c in fails):
                        lines.append("%s %s: anchor answer not finished in this run (call or time limit); the next run takes it" % (d, rid))
                        continue
            af = list(fails)
            if state == "wait":
                af.append((None, "anchor_wait"))
            elif code:
                af.append((None, code))
            arc = rc + ["bitcoin_anchor"] if state == "ok" else list(rc)
            a = build("anchor", d, rid, rec_v, leaves, arc, af + ([(None, "head_unread")] if head is None else []), head, w, impl, stamp)
            if send("anchor", a, facts if state == "ok" else None):
                anchor_done.add((d, rid))
    print("\n".join(lines + ["calls %d, answers sent %d" % (net.calls, len(shas))]))
    if "--github-output" in args:
        with open(args["--github-output"], "a", encoding="utf-8") as g:
            g.write("shas=%s\nok=%s\n" % (" ".join(shas), "yes" if ok else "no"))
    return 0 if ok else 1


def keep(args):
    """job keep: holds no key. Copies each answer the answer job sent into answers/<D>/<sha>.json, after checking that its
    bytes hash to a sha the answer job named, and writes last_answer into status.json. Anything off: nothing is written."""
    shas = args["--shas"]
    if not re.fullmatch(r"[0-9a-f]{64}( [0-9a-f]{64}){0,63}", shas):
        raise SystemExit("--shas must be 1 to 64 sha256 hex, one space apart")
    shas, inc = shas.split(" "), args["--incoming"]
    names = sorted(os.listdir(inc))
    if names != sorted(x + ".json" for x in set(shas)):
        raise SystemExit("the artifact holds other files than the answers the answer job named; nothing kept")
    put = []
    for x in shas:
        with open(os.path.join(inc, x + ".json"), "rb") as f:
            b = f.read(65537)
        if len(b) > 65536 or sha(b) != x:
            raise SystemExit("an answer file is not the bytes the answer job named; nothing kept")
        r = parse(b)
        d = r.get("answer", {}).get("day") if isinstance(r, dict) and r.get("schema") == "jidec-path-v1" and isinstance(r.get("answer"), dict) else None
        if not real_day(d):
            raise SystemExit("an answer file does not name its day; nothing kept")
        put.append((d, x, b))
    with open(args["--status"], "rb") as f:
        stj = parse(f.read(65536))
    if not isinstance(stj, dict) or stj.get("schema") != "furui-witness-status-v0":
        raise SystemExit("status.json is not furui-witness-status-v0; nothing kept")
    for d, x, b in put:
        os.makedirs(os.path.join(args["--answers"], d), exist_ok=True)
        with open(os.path.join(args["--answers"], d, x + ".json"), "wb") as f:
            f.write(b)
    now = args.get("--now") or datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None).strftime("%Y-%m-%dT%H:%M:%SZ")
    stj.update(last_answer=put[-1][1], updated_at=now)
    with open(args["--status"], "w", encoding="utf-8") as f:
        f.write(json.dumps(stj, indent=2, sort_keys=True) + "\n")
    print("kept %d answers: %s" % (len(put), " ".join(x for _, x, _ in put)))
    return 0


def main(argv):
    if not argv or argv[0] not in ("answer", "keep") or len(argv) % 2 != 1:
        print(__doc__)
        return 2
    args = dict(zip(argv[1::2], argv[2::2]))
    need = ("--answers", "--out") if argv[0] == "answer" else ("--incoming", "--shas", "--answers", "--status")
    if any(k not in args for k in need):
        print(__doc__)
        return 2
    return answer(args) if argv[0] == "answer" else keep(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
