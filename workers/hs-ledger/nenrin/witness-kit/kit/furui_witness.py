"""furui_witness.py, furui-witness-kit 0.1.0: recompute the FURUI day records of runner-1 and runner-2 and sign what you found.

What it reads (GET only, https, no redirects, 1 MiB per answer, 20 s per call, 60 calls and 5 minutes per run):
  https://furui.horizonshield.dev/furui/day/<D>/status and /leaf/<i>      runner-1
  https://furui.horizonshield.dev/furui2/day/<D>/status and /leaf/<i>     runner-2
  https://ledger.horizonshield.dev/furui-check-day/<sha>                  the day record as the ledger keeps it
  https://ledger.horizonshield.dev/.well-known/furui-check-keys.json      the runner keys
  https://ledger.horizonshield.dev/ledger/head                            the ledger head, kept in each answer
  your own key_url                                                        to see that it serves your key
What it writes: one POST https://ledger.horizonshield.dev/witness per day and runner, and files in --out.
It runs no code from the operator, installs nothing, and copies no text from any answer into what it signs:
only hex, integers, dates and the fixed words of this file. Signing is done by openssl (pkeyutl -rawin).

  python3 -I -B furui_witness.py answer --answers answers --out out [--github-output FILE] [--now YYYY-MM-DDTHH:MM:SSZ]
      env FURUI_WITNESS_KEY (PEM), FURUI_WITNESS_KEY_URL, FURUI_WITNESS_NAME
  python3 -I -B furui_witness.py keep --incoming DIR --shas "SHA SHA" --answers answers --status status.json [--now ...]
"""
import base64, datetime, hashlib, json, os, re, subprocess, sys, tempfile, time
import http.client, urllib.error, urllib.request

KIT, VERSION = "furui-witness-kit", "0.1.0"
UA = "%s/%s (+https://github.com/ogasurfproject-jpg/horizon-shield/tree/main/workers/hs-ledger/nenrin/witness-kit)" % (KIT, VERSION)
FURUI, LEDGER = "https://furui.horizonshield.dev", "https://ledger.horizonshield.dev"
TREES = {"runner-1": "/furui/day/", "runner-2": "/furui2/day/"}
SIGNER = {"domain": "horizonshield.dev", "key_url": LEDGER + "/.well-known/furui-check-keys.json"}
DAY_LEAF = "sha256(0x00 || musubi-canonical-v0(envelope))"
STEPS = ["envelope_shape", "leaf_sha256", "audit_path", "signature", "runner_key"]   # bitcoin_anchor is not checked (limits)
CAP, CALL_S, RUN_S, CALLS, MAX_N, BACK = 1 << 20, 20.0, 300.0, 60, 4096, 6
SAFE = 9007199254740991
H64 = re.compile(r"[0-9a-f]{64}")
DAY = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
ISO_MS = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z")
NONCE = re.compile(r"[0-9a-f]{32}|heartbeat-[0-9]{4}-[0-9]{2}-[0-9]{2}")
SIG88 = re.compile(r"[A-Za-z0-9+/]{86}==")
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
        "head_unread": ("ledger_head", "h", "the ledger head could not be read or did not have its shape")}
LIMITS = ["The Bitcoin anchor was not checked by this tool.",
          "This answer checks the day record and its leaves as the operator serves them, not the checks they describe.",
          "A leaf the runner no longer serves cannot be checked, and the answer then says incomplete."]
VANTAGE = "a GitHub Actions runner of the witness (furui-witness-kit 0.1.0)"


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

    def fetch(self, url, body=None):
        m = re.fullmatch(r"https://([a-z0-9.-]+)(/[^\s#]*)", url)
        if not m or m.group(1) not in self.hosts:
            raise Unread("not an allowed URL")
        left = RUN_S - (self.now() - self.t0)
        if self.calls >= CALLS or left <= 1:
            raise Budget()
        self.calls += 1
        h = {"user-agent": UA, "accept": "application/json"}
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


# ---- the checks (the steps of nenrin-verify furui-day, without bitcoin_anchor) ----
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


def check_day(net, d, rid, st, keydoc):
    """-> (record values, leaf_index, recomputed, failures); st is the runner's accepted status for d"""
    fails, rec_v = [], {"day_sha256": st["ledger_canonical_sha256"], "root": None, "n": None}
    f = lambda code, leaf=None: fails.append((leaf, code))
    try:
        lr = net.json(LEDGER + "/furui-check-day/" + rec_v["day_sha256"])
        rc = lr.get("record_canonical") if isinstance(lr, dict) else None
        if not isinstance(rc, str):
            raise Unread("no record_canonical")
    except (Unread, Budget):
        f("record_unread")
        return rec_v, [], [], fails
    if sha(rc) != rec_v["day_sha256"]:
        f("record_sha")
        return rec_v, [], [], fails
    try:
        rec = parse(rc)
        ok = canonical(rec) == rc and record_ok(rec, rid, d)
    except (ValueError, RecursionError):
        ok = False
    if not ok:
        f("record_shape")
        return rec_v, [], [], fails
    rec_v.update(root=rec["root"], n=rec["n"])
    if rec["n"] != st["n"] or rec["root"] != st["root"]:
        f("record_other")
        return rec_v, [], [], fails
    if rec["n"] + net.calls + 1 > CALLS:
        f("too_many")
        return rec_v, [], [], fails
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
    return rec_v, leaves, [s for s in STEPS if done[s]], fails


def build(d, rid, rec_v, leaves, recomputed, fails, head, w, impl, observed_at):
    fl = [{"leaf": leaf, "step": FAIL[c][0], "detail": FAIL[c][2]} for leaf, c in fails]
    cls = {FAIL[c][1] for _, c in fails}
    outcome = "mismatch" if "m" in cls else ("incomplete" if "i" in cls else "match")
    if outcome == "match" and (len(leaves) != rec_v["n"] or recomputed != STEPS):
        outcome = "incomplete"
    return {"schema": "witness-answer-v0.2", "kind": "furui-day", "day": d, "runner_id": rid, "outcome": outcome,
            "day_sha256": rec_v["day_sha256"], "root": rec_v["root"], "n": rec_v["n"], "leaf_index": leaves, "recomputed": recomputed,
            "failures": fl[:64], "implementation": impl, "ledger_head": head,
            "tool": "%s %s furui_witness.py sha256 %s" % (KIT, VERSION, impl["sha256"]), "observed_at": observed_at,
            "limits": list(LIMITS), "witness": w}


def intake_record(a):
    """the jidec-path-v1 commitment record the ledger's POST /witness takes (the same bytes as witness_answer_v0.intake_record)"""
    rec = {"schema": "jidec-path-v1", "purpose": "furui-day-v0: " + a["day"], "walked_at": a["observed_at"],
           "base": LEDGER + "/furui-check-day/" + a["day_sha256"], "mode": "commitment", "commitment": a["day_sha256"],
           "witness": {"name": a["witness"]["name"], "vantage": VANTAGE, "key_url": a["witness"]["key_url"]},
           "establishes": ["the witness recomputed: " + ", ".join(a["recomputed"]),
                           "the signed witness-answer-v0 in answer carries the same day_sha256 under key " + a["witness"]["key_id"]],
           "does_not_establish": list(a["limits"]), "answer": a}
    return canonical(rec)


def kept_answers(folder):
    """{(day, runner_id)} already answered, from the files job keep committed (answers/<D>/<sha>.json)"""
    out = set()
    for d in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        if not real_day(d):
            continue
        for n in os.listdir(os.path.join(folder, d)):
            try:
                with open(os.path.join(folder, d, n), "rb") as f:
                    a = parse(f.read(CAP)).get("answer", {})
                if a.get("day") == d and a.get("runner_id") in TREES:
                    out.add((d, a["runner_id"]))
            except (OSError, ValueError, AttributeError, UnicodeDecodeError, RecursionError):
                continue
    return out


def answer(args, net=None, signer=None):
    now = datetime.datetime.strptime(args["--now"], "%Y-%m-%dT%H:%M:%SZ") if "--now" in args else datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None).replace(microsecond=0)
    ku, name = os.environ.get("FURUI_WITNESS_KEY_URL", ""), os.environ.get("FURUI_WITNESS_NAME", "")
    m = re.fullmatch(r"https://([a-z0-9.-]+)/[A-Za-z0-9._~/-]*", ku)
    if not m or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}", name):
        raise SystemExit("set FURUI_WITNESS_KEY_URL (https, your own host) and FURUI_WITNESS_NAME (letters, digits, space . _ -)")
    net = net or Net(["furui.horizonshield.dev", "ledger.horizonshield.dev", m.group(1)])
    signer = signer or Signer(os.environ.get("FURUI_WITNESS_KEY", ""))
    try:
        return _answer(args, net, signer, now, ku, name)
    finally:
        signer.close()


def _answer(args, net, signer, now, ku, name):
    out, shas, lines, ok = args["--out"], [], [], True
    os.makedirs(out, exist_ok=True)
    try:
        kd = net.json(ku)
        served = b64(kd.get("public_key_ed25519_b64"), 32) if isinstance(kd, dict) else None
    except (Unread, Budget):
        served = None
    if served != signer.pub:
        raise SystemExit("your key_url does not serve the public key of FURUI_WITNESS_KEY; nothing was sent")
    with open(os.path.abspath(__file__), "rb") as f:
        impl = {"origin": "operator-kit", "name": KIT, "version": VERSION, "sha256": sha(f.read())}
    w = {"name": name, "key_id": signer.key_id, "key_url": ku}
    try:
        h = net.json(LEDGER + "/ledger/head")
        head = {"n": h["n"], "head": h["head"], "observed_at": now.strftime("%Y-%m-%dT%H:%M:%SZ")} \
            if isinstance(h, dict) and isint(h.get("n"), 1, 10 ** 9) and isinstance(h.get("head"), str) and H64.fullmatch(h["head"]) else None
    except (Unread, Budget):
        head = None
    try:
        kd = net.json(SIGNER["key_url"])
        keydoc = kd["keys"] if isinstance(kd, dict) and kd.get("use") == "furui-check" and isinstance(kd.get("keys"), list) else None
    except (Unread, Budget):
        keydoc = None
    done = kept_answers(args["--answers"])
    yday = (now - datetime.timedelta(days=1)).date()
    first = min([datetime.date.fromisoformat(d) for d, _ in done] or [yday])
    days = [str(yday - datetime.timedelta(days=i)) for i in range(BACK + 1) if yday - datetime.timedelta(days=i) >= first]
    late = now.hour >= 3                         # the 03:50 run; the 01:50 run holds an incomplete answer back for it
    for d in sorted(days, reverse=True):
        for rid in TREES:
            if (d, rid) in done:
                continue
            try:
                st = net.json(FURUI + TREES[rid] + "%s/status" % d)
            except Budget:
                lines.append("%s %s: not read in this run (call or time limit); the next run takes it" % (d, rid))
                continue
            except Unread:
                lines.append("%s %s: the runner status was not read; no answer (it names the sha to answer about)" % (d, rid))
                ok = False
                continue
            s = st.get("status") if isinstance(st, dict) and st.get("day") == d else None
            state = s.get("state") if isinstance(s, dict) else None
            if state != "accepted":
                lines.append("%s %s: no accepted day record to answer about (%s)" % (d, rid, state if state in ("empty", "open", "refused") else "no status yet"))
                continue
            if not (isinstance(s.get("ledger_canonical_sha256"), str) and H64.fullmatch(s["ledger_canonical_sha256"])
                    and isint(s.get("n"), 1, MAX_N) and isinstance(s.get("root"), str) and H64.fullmatch(s["root"])):
                lines.append("%s %s: the runner status names an accepted day without its sha, n and root in their shape; no answer" % (d, rid))
                ok = False
                continue
            rec_v, leaves, rc, fails = check_day(net, d, rid, s, keydoc)
            if head is None:
                fails = fails + [(None, "head_unread")]
            a = build(d, rid, rec_v, leaves, rc, fails, head, w, impl, now.strftime("%Y-%m-%dT%H:%M:%SZ"))
            if a["outcome"] == "incomplete" and not late and d == str(yday):
                lines.append("%s %s: incomplete; held back for the run after 03:00 UTC" % (d, rid))
                continue
            a["signature"] = {"alg": "ed25519", "key_id": signer.key_id, "sig": "A" * 86 + "=="}
            body = {k: v for k, v in a.items() if k != "signature"}
            a["signature"]["sig"] = base64.b64encode(signer.sign(("witness-answer-v0.2\n" + canonical(body)).encode("utf-8"))).decode()
            rcan = intake_record(a)
            post = json.dumps({"record_canonical": rcan, "signature_ed25519_b64": base64.b64encode(signer.sign(rcan.encode("utf-8"))).decode(),
                               "public_key_ed25519_b64": base64.b64encode(signer.pub).decode()}).encode("utf-8")
            try:
                ps, pb = net.fetch(LEDGER + "/witness", post)
                pj = parse(pb) if ps in (200, 201) else None
            except (Unread, Budget, ValueError, UnicodeDecodeError, RecursionError):
                ps, pj = None, None
            if not (isinstance(pj, dict) and pj.get("sha") == sha(rcan)):
                lines.append("%s %s: %s, but the ledger did not take it (http %s); not kept" % (d, rid, a["outcome"], ps))
                ok = False
                continue
            with open(os.path.join(out, sha(rcan) + ".json"), "w", encoding="utf-8", newline="") as fo:
                fo.write(rcan)
            shas.append(sha(rcan))
            ok = ok and a["outcome"] == "match"
            lines.append("%s %s: %s, sent %s%s" % (d, rid, a["outcome"], sha(rcan), "" if pj.get("counted", True) else " (stored, not counted)"))
    print("\n".join(lines + ["calls %d, answers sent %d" % (net.calls, len(shas))]))
    if "--github-output" in args:
        with open(args["--github-output"], "a", encoding="utf-8") as g:
            g.write("shas=%s\nok=%s\n" % (" ".join(shas), "yes" if ok else "no"))
    return 0 if ok else 1


def keep(args):
    """job keep: holds no key. Copies each answer the answer job sent into answers/<D>/<sha>.json, after checking that its
    bytes hash to a sha the answer job named, and writes last_answer into status.json. Anything off: nothing is written."""
    shas = args["--shas"]
    if not re.fullmatch(r"[0-9a-f]{64}( [0-9a-f]{64}){0,31}", shas):
        raise SystemExit("--shas must be 1 to 32 sha256 hex, one space apart")
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
