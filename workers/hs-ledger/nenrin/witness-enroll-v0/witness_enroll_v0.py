"""witness_enroll_v0.py: the pool of day witnesses (witness-enroll-pool-v0) and the draw that names one witness and the
leaves of one FURUI day record (witness-enroll-draw-v0). Python standard library only. The procedure is PROCEDURE.md in
this folder; the tests are test_witness_enroll_v0.py (no network) and vectors.json. The key, key_url and canonical JSON
rules are those of ../witness-answer-v0/witness_answer_v0.py, which this file loads: keep the two folders side by side.

    python3 -I -B witness_enroll_v0.py pool-check  pool.json                   shape, keys, one active entry per identity (offline)
    python3 -I -B witness_enroll_v0.py pool-keys   pool.json                   GET each active key_url: is the listed key still served
    python3 -I -B witness_enroll_v0.py pool-seed   pool.json --out seed.json   the ledger record that fixes this pool version
    python3 -I -B witness_enroll_v0.py draw-live   DAY --out seed.json [--check-key-url]
    python3 -I -B witness_enroll_v0.py verify-draw N                           recompute the draw in ledger entry N from public data
    python3 -I -B witness_enroll_v0.py selftest

The pool in force for day D: of the ledger entries that start with "# witness-enroll-pool-v0", those appended before the
batch entry E that lists D's day record and anchored in a Bitcoin block at or below E's block H; the one with the highest
entry number. A pool entry before E that is not anchored yet makes the draw wait.
The draw (TSUGI's arithmetic, witness_draw.mjs, with k = 1):
    seed      = sha256(beacon_hash "|" pool_sha256 "|" day_sha256), beacon = the Bitcoin block at height H + 1
    witness   = eligible[int(sha256(seed "|0")[:16], 16) mod len(eligible)], eligible = the pool entries active on D for
                furui-day, ordered by public_key_ed25519_b64 (code points)
    leaves    = min(2, n) leaves by a partial Fisher-Yates over 0..n-1, step i swapping i and
                i + int(sha256(seed "|leaf|" i)[:16], 16) mod (n - i); listed ascending
The beacon is read from mempool.space and blockstream.info; both must give the same hash, with 6 or more confirmations.
Exit: 0 ok, 1 inconsistent or refused, 2 a public endpoint did not answer, 3 not yet, 4 no pool or no eligible witness,
9 usage or a bad input file.
"""
import base64, datetime, hashlib, importlib.util, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
_sp = importlib.util.spec_from_file_location("witness_answer_v0", os.path.join(HERE, "..", "witness-answer-v0", "witness_answer_v0.py"))
W = importlib.util.module_from_spec(_sp)
_sp.loader.exec_module(W)

POOL_SCHEMA = "witness-enroll-pool-v0"
POOL_HEAD = "# witness-enroll-pool-v0"
DRAW_HEAD = "# witness-enroll-draw-v0 "
POOL_KEYS = sorted(["schema", "version", "previous_pool_sha256", "entries"])
ENTRY_KEYS = sorted(["name", "signed_domain", "key_url", "public_key_ed25519_b64", "key_id", "kinds", "joined_on", "consent",
                     "left_on", "left_reason"])
CONSENT_KEYS = sorted(["on", "form", "enrollment_sha256"])
FORMS = ("email", "witness-enroll-v0")
DRAW_KIND = "furui-day"
LEAVES = 2
MIN_CONF = 6
ENTRIES_MAX = 1000
# Entries 1 to 253 of the ledger were read on 2026-11-05: none starts with "# witness-enroll-". Reading starts here.
BASE = 254
LEDGER = W.LEDGER
FURUI = "https://furui.horizonshield.dev"
EXPLORERS = ("https://mempool.space/api", "https://blockstream.info/api")
PROCEDURE_URL = "https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-ledger/nenrin/witness-enroll-v0/PROCEDURE.md"
H64 = W.H64
Bad = W.Bad


class Stop(Exception):
    code = 1


class Unreachable(Stop):
    code = 2


class NotYet(Stop):
    code = 3


class NoWitness(Stop):
    code = 4


def sha(s):
    return W.sha256hex(s)


# ---- the pool ----
def _day(d, what):
    if not W._real_day(d):
        raise Bad(what + " must be a real YYYY-MM-DD")


def check_pool(p):
    """raises Bad with the first problem"""
    if not isinstance(p, dict) or sorted(p) != POOL_KEYS or p["schema"] != POOL_SCHEMA:
        raise Bad("a pool carries exactly " + ", ".join(POOL_KEYS) + " with schema " + POOL_SCHEMA)
    v = p["version"]
    if not (isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= W.SAFE):
        raise Bad("version must be an integer >= 1")
    pv = p["previous_pool_sha256"]
    if (v == 1 and pv is not None) or (v > 1 and not (isinstance(pv, str) and H64.fullmatch(pv))):
        raise Bad("previous_pool_sha256 is null for version 1 and the sha256 of the previous version after that")
    es = p["entries"]
    if not isinstance(es, list) or len(es) > ENTRIES_MAX:
        raise Bad("entries must be a list of at most %d entries" % ENTRIES_MAX)
    for e in es:
        check_entry(e)
    for i, a in enumerate(es):
        for b in es[i + 1:]:
            if (a["signed_domain"] == b["signed_domain"] or a["key_id"] == b["key_id"]) and _overlap(a, b):
                raise Bad("two entries for %s are active on the same day" % a["signed_domain"])
    W.canonical(p)


def check_entry(e):
    if not isinstance(e, dict) or sorted(e) != ENTRY_KEYS:
        raise Bad("an entry carries exactly " + ", ".join(ENTRY_KEYS))
    W._line(e["name"], "name", W.NAME_MAX)
    u = e["key_url"]
    pr = W.key_url_problem(u) if isinstance(u, str) else "key_url must be a string"
    if pr:
        raise Bad("key_url: " + pr)
    if e["signed_domain"] != W.identity_of(u):
        raise Bad("signed_domain must be the identity of key_url (%s)" % W.identity_of(u))
    pub = W.b64d(e["public_key_ed25519_b64"], 32)
    if not W.key_ok(pub):
        raise Bad("public_key_ed25519_b64 is not a valid prime-order Ed25519 point")
    if e["key_id"] != W.key_id_of(pub):
        raise Bad("key_id must be " + W.key_id_of(pub))
    k = e["kinds"]
    if not isinstance(k, list) or not k or any(x not in W.KINDS for x in k) or k != [x for x in W.KINDS if x in k]:
        raise Bad("kinds must be a non-empty list from " + ", ".join(W.KINDS) + " in that order")
    _day(e["joined_on"], "joined_on")
    c = e["consent"]
    if not isinstance(c, dict) or sorted(c) != CONSENT_KEYS:
        raise Bad("consent carries exactly " + ", ".join(CONSENT_KEYS))
    _day(c["on"], "consent.on")
    if c["on"] > e["joined_on"]:
        raise Bad("consent.on cannot be after joined_on")
    if c["form"] not in FORMS:
        raise Bad("consent.form must be one of " + ", ".join(FORMS))
    es = c["enrollment_sha256"]
    if (c["form"] == "email") != (es is None) or (es is not None and not (isinstance(es, str) and H64.fullmatch(es))):
        raise Bad("consent.enrollment_sha256 is null for email and the sha256 of the signed statement for witness-enroll-v0")
    if e["left_on"] is None:
        if e["left_reason"] is not None:
            raise Bad("left_reason is null while left_on is null")
    else:
        _day(e["left_on"], "left_on")
        if e["left_on"] < e["joined_on"]:
            raise Bad("left_on cannot be before joined_on")
        W._line(e["left_reason"], "left_reason")


def _overlap(a, b):
    end = lambda e: e["left_on"] or "9999-12-31"
    return a["joined_on"] < end(b) and b["joined_on"] < end(a)


def active(p, day, kind=DRAW_KIND):
    """the entries active on day for kind, ordered by public_key_ed25519_b64 (as witness_draw.mjs orders a pool)"""
    out = [e for e in p["entries"] if kind in e["kinds"] and e["joined_on"] <= day and (e["left_on"] is None or day < e["left_on"])]
    return sorted(out, key=lambda e: e["public_key_ed25519_b64"])


def pool_sha256(p):
    return sha(W.canonical(p))


def pool_record(p):
    """the ledger record that fixes one pool version; the pool travels in it on the pool_canonical line"""
    check_pool(p)
    return (POOL_HEAD + "\n\n"
            "pool_sha256: " + pool_sha256(p) + "\n"
            "pool_version: " + str(p["version"]) + "\n"
            "previous_pool_sha256: " + (p["previous_pool_sha256"] or "none") + "\n"
            "entries: " + str(len(p["entries"])) + "\n\n"
            "This entry fixes one version of the pool of day witnesses for FURUI day records. The draw for a day uses the "
            "pool of the latest entry of this kind that was appended before the ledger entry listing that day's record and "
            "is anchored in a Bitcoin block at or below that entry's block. The pool is the JSON on the pool_canonical line; "
            "its sha256 is pool_sha256. Procedure: " + PROCEDURE_URL + "\n"
            "Establishes: that this pool existed no later than the block this entry is anchored to.\n"
            "Does not establish: that anyone in the pool will answer a draw, or anything about their answers.\n\n"
            "pool_canonical: " + W.canonical(p) + "\n")


def parse_pool_record(rc):
    m = re.fullmatch(r"(?s)" + re.escape(POOL_HEAD) + r"\n\npool_sha256: ([0-9a-f]{64})\n.*\npool_canonical: ([^\n]+)\n", rc)
    if not m:
        raise Bad("not a witness-enroll-pool-v0 record")
    p = json.loads(m.group(2))
    check_pool(p)
    if W.canonical(p) != m.group(2) or pool_sha256(p) != m.group(1) or pool_record(p) != rc:
        raise Bad("the pool record is not the record of its own pool_canonical")
    return p


# ---- the draw ----
def draw(day, day_sha256, n, root, batch_entry, anchor_block, beacon_hash, pool, pool_entry):
    _day(day, "day")
    for x, what in ((day_sha256, "day_sha256"), (root, "root"), (beacon_hash, "beacon_hash")):
        if not (isinstance(x, str) and H64.fullmatch(x)):
            raise Bad(what + " must be 64 lower-case hex")
    for x, what in ((n, "n"), (batch_entry, "batch_entry"), (anchor_block, "anchor_block"), (pool_entry, "pool_entry")):
        if not (isinstance(x, int) and not isinstance(x, bool) and 1 <= x <= W.SAFE):
            raise Bad(what + " must be an integer >= 1")
    if pool_entry >= batch_entry:
        raise Bad("the pool entry must come before the batch entry")
    check_pool(pool)
    el = active(pool, day)
    if not el:
        raise NoWitness("no pool entry is active for %s on %s" % (DRAW_KIND, day))
    psha = pool_sha256(pool)
    seed = sha(beacon_hash + "|" + psha + "|" + day_sha256)
    w = el[int(sha(seed + "|0")[:16], 16) % len(el)]
    m, sw, picked = min(LEAVES, n), {}, []
    for i in range(m):
        j = i + int(sha(seed + "|leaf|" + str(i))[:16], 16) % (n - i)
        vi, vj = sw.get(i, i), sw.get(j, j)
        sw[i], sw[j] = vj, vi
        picked.append(vj)
    return {"day": day, "kind": DRAW_KIND, "day_sha256": day_sha256, "n": n, "root": root, "day_batch_entry": batch_entry,
            "anchor_block": anchor_block, "beacon_block": anchor_block + 1, "beacon_hash": beacon_hash, "pool_entry": pool_entry,
            "pool_sha256": psha, "eligible": len(el), "seed_sha256": seed, "witness_name": w["name"],
            "witness_signed_domain": w["signed_domain"], "witness_key_id": w["key_id"], "witness_key_url": w["key_url"],
            "leaf_index": sorted(picked)}


FIELDS = ["day", "kind", "day_sha256", "n", "root", "day_batch_entry", "anchor_block", "beacon_block", "beacon_hash", "pool_entry",
          "pool_sha256", "eligible", "seed_sha256", "witness_name", "witness_signed_domain", "witness_key_id", "witness_key_url",
          "leaf_index", "tool"]
RECIPE = ("seed = sha256(beacon_hash \"|\" pool_sha256 \"|\" day_sha256); witness = eligible[int(sha256(seed \"|0\")[:16], 16) mod eligible], "
          "eligible ordered by public_key_ed25519_b64; leaves = min(2, n) by a partial Fisher-Yates over 0..n-1 with "
          "sha256(seed \"|leaf|\" i), listed ascending")


def draw_record(d, tool_sha):
    """the ledger record of one draw; the notice to the drawn witness is part of it"""
    vals = dict(d, tool="witness_enroll_v0.py sha256:" + tool_sha)
    li = d["leaf_index"]
    lines = [DRAW_HEAD + d["day"], ""]
    for k in FIELDS:
        v = vals[k]
        lines.append(k + ": " + (" ".join(str(x) for x in v) if isinstance(v, list) else str(v)))
    leaves = " and ".join(str(x) for x in li) if len(li) <= 2 else ", ".join(str(x) for x in li)
    cmds = "\n".join("    nenrin-verify furui-day %s --leaf %d" % (d["day"], x) for x in li)
    lines += ["recipe: " + RECIPE, "", "## Notice to the drawn witness", "",
              "To %s (%s, key %s): the draw names you as the day witness for the FURUI day record of %s "
              "(day_sha256 %s, n %d). The leaves drawn for you: %s. If you choose to answer, recompute them:"
              % (d["witness_name"], d["witness_signed_domain"], d["witness_key_id"], d["day"], d["day_sha256"], d["n"], leaves),
              "", cmds, "",
              "and build, sign and file a witness-answer-v0 with leaf_index [%s], as in "
              "workers/hs-ledger/nenrin/witness-answer-v0/PROCEDURE.md. An answer is optional. A leaf you did not check stays "
              "out of leaf_index, and a step that was not ok stays out of recomputed. Anyone can recompute this draw from public "
              "data: python3 -I -B witness_enroll_v0.py verify-draw <this entry's number>." % ", ".join(str(x) for x in li),
              "",
              "Establishes: that the operator recorded this draw, computed from the public values above.",
              "Does not establish: that the witness has read this notice or will answer, or that the content of the day record is right.",
              ""]
    return "\n".join(lines)


def parse_draw_record(rc):
    head, _, rest = rc.partition("\n\n")
    if not head.startswith(DRAW_HEAD):
        raise Bad("not a witness-enroll-draw-v0 record")
    out = {}
    for ln in rest.split("\n"):
        if ln.startswith("recipe: "):
            break
        k, sep, v = ln.partition(": ")
        if not sep or k not in FIELDS or k in out:
            raise Bad("unexpected line in the draw record: " + ln[:80])
        out[k] = v
    if list(out) != FIELDS or head != DRAW_HEAD + out["day"]:
        raise Bad("the draw record does not carry the fields in order")
    return out


def record_fields(d, tool_sha):
    return parse_draw_record(draw_record(d, tool_sha))


# ---- reading public endpoints (GET only) ----
def http_get(url, timeout=30):
    """-> (status, bytes). No redirects. Only the hosts this tool reads, plus a pool entry's key_url host."""
    import urllib.request, urllib.error

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None
    req = urllib.request.Request(url, headers={"user-agent": "witness-enroll-v0/0.1", "accept": "application/json, text/plain"})
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=timeout) as r:
            return r.status, r.read(4 * 1024 * 1024)
    except urllib.error.HTTPError as e:
        return e.code, e.read(65536)
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise Unreachable("%s did not answer (%s)" % (url, type(e).__name__))


class Reader:
    def __init__(self, get):
        self.get = get

    def raw(self, url, ok404=False):
        s, b = self.get(url)
        if s == 404 and ok404:
            return None
        if s != 200:
            raise Unreachable("%s answered %d" % (url, s)) if s >= 500 or s == 429 else Stop("%s answered %d" % (url, s))
        return b

    def json(self, url, ok404=False):
        b = self.raw(url, ok404)
        if b is None:
            return None
        try:
            return json.loads(b.decode("utf-8"))
        except ValueError:
            raise Stop("%s did not answer JSON" % url)

    def entry(self, n, claim=None):
        e = self.json(LEDGER + "/ledger/%d?format=json" % n)
        rc = e.get("record_canonical") if isinstance(e, dict) else None
        if not isinstance(rc, str) or e.get("n") != n or sha(rc) != e.get("claim_sha256") or (claim is not None and e["claim_sha256"] != claim):
            raise Stop("ledger entry %d does not hash to its claim" % n)
        return e


def _isn(x):
    return isinstance(x, int) and not isinstance(x, bool) and x >= 1


def ledger_scan(rd):
    """{n: entry} for BASE..head, after checking that the export lists 1..head once each"""
    for again in (False, True):
        head = rd.json(LEDGER + "/ledger/head")
        hn = head.get("n") if isinstance(head, dict) else None
        if not _isn(hn):
            raise Stop("the ledger head has no number")
        claims = {}
        for ln in rd.raw(LEDGER + "/ledger/export.jsonl").decode("utf-8", "replace").splitlines():
            if not ln.strip():
                continue
            try:
                d = json.loads(ln)
            except ValueError:
                raise Stop("the export has a line that is not JSON")
            if not isinstance(d, dict):
                raise Stop("the export has a line that is not an object")
            if d.get("schema") == "jidec-head-v1":
                continue
            if not _isn(d.get("n")) or d["n"] in claims:
                raise Stop("the export has an entry number that is not a number or repeats")
            claims[d["n"]] = d.get("claim_sha256")
        if sorted(claims) == list(range(1, hn + 1)):
            break
        if again:
            raise Stop("the export does not list entries 1..%d (read twice)" % hn)
    return {n: rd.entry(n, claims[n]) for n in range(BASE, hn + 1)}, hn


def live_inputs(day, get=http_get):
    """everything the draw for day needs, read from the runner, the ledger and two block explorers"""
    _day(day, "day")
    rd = Reader(get)
    st = rd.json(FURUI + "/furui/day/%s/status" % day, ok404=True)
    s = st.get("status") if isinstance(st, dict) and st.get("day") == day else None
    if not isinstance(s, dict) or s.get("state") != "accepted":
        raise NotYet("the runner has no accepted day record for %s yet" % day)
    rs = s.get("ledger_canonical_sha256")
    if not (isinstance(rs, str) and H64.fullmatch(rs)):
        raise Stop("the runner's status for %s names no day record" % day)
    lr = rd.json(LEDGER + "/furui-check-day/" + rs)
    rc = lr.get("record_canonical") if isinstance(lr, dict) else None
    if not isinstance(rc, str) or sha(rc) != rs:
        raise Stop("the ledger's day record does not hash to %s" % rs)
    try:
        rec = json.loads(rc)
        ok = W.canonical(rec) == rc
    except (ValueError, Bad):
        ok = False
    if not ok or rec.get("schema") != "furui-check-day-v0" or rec.get("day") != day or not _isn(rec.get("n")) \
            or not (isinstance(rec.get("root"), str) and H64.fullmatch(rec["root"])):
        raise Stop("the ledger's day record for %s is not a canonical furui-check-day-v0 record of that day" % day)
    if lr.get("status") != "anchored" or not _isn(lr.get("ledger_entry")):
        raise NotYet("the day record %s is not in a ledger batch yet" % rs[:16])
    E = lr["ledger_entry"]
    be = rd.entry(E)
    try:
        bt = json.loads(be["record_canonical"])
    except ValueError:
        bt = None
    rows = bt.get("records") if isinstance(bt, dict) and bt.get("schema") == "nenrin-agreement-batch-v1" else None
    if not isinstance(rows, list) or not any(isinstance(r, dict) and r.get("canonical_sha256") == rs and r.get("record_schema") == "furui-check-day-v0" for r in rows):
        raise Stop("ledger entry %d does not list the day record %s" % (E, rs[:16]))
    if be.get("ots_status") != "confirmed" or not _isn(be.get("bitcoin_block")):
        raise NotYet("ledger entry %d is not anchored in a Bitcoin block yet" % E)
    H = be["bitcoin_block"]
    ents, hn = ledger_scan(rd)
    pools, draws = [], []
    for n in sorted(ents):
        first = ents[n]["record_canonical"].split("\n", 1)[0]
        if first == POOL_HEAD and n < E:
            pools.append(n)
        elif first == DRAW_HEAD + day:
            draws.append(n)
    for n in pools:
        if ents[n].get("ots_status") != "confirmed" or not _isn(ents[n].get("bitcoin_block")):
            raise NotYet("pool entry %d comes before entry %d and is not anchored yet" % (n, E))
    fit = [n for n in pools if ents[n]["bitcoin_block"] <= H]
    if not fit:
        raise NoWitness("no pool entry before entry %d is anchored at or below block %d" % (E, H))
    P = max(fit)
    pool = parse_pool_record(ents[P]["record_canonical"])
    hashes, tips = [], []
    for base in EXPLORERS:
        t = rd.raw(base + "/blocks/tip/height").decode("ascii", "replace").strip()
        h = rd.raw(base + "/block-height/%d" % (H + 1), ok404=True)
        if not re.fullmatch(r"[0-9]{1,9}", t):
            raise Stop("%s gave no tip height" % base)
        if h is None:
            raise NotYet("block %d is not there yet (%s)" % (H + 1, base))
        h = h.decode("ascii", "replace").strip()
        if not H64.fullmatch(h):
            raise Stop("%s gave no block hash for %d" % (base, H + 1))
        hashes.append(h)
        tips.append(int(t))
    if len(set(hashes)) != 1:
        raise Stop("the two explorers give different hashes for block %d" % (H + 1))
    if min(tips) - (H + 1) + 1 < MIN_CONF:
        raise NotYet("block %d has %d confirmations, the draw waits for %d" % (H + 1, min(tips) - H, MIN_CONF))
    return {"day": day, "day_sha256": rs, "n": rec["n"], "root": rec["root"], "batch_entry": E, "anchor_block": H,
            "beacon_hash": hashes[0], "pool": pool, "pool_entry": P, "draws": {n: ents[n]["record_canonical"] for n in draws}}


def tool_sha():
    with open(os.path.abspath(__file__), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


# 2026-11-07: a key_url may serve one OpenSSH line, the file ssh-keygen writes for an Ed25519 key: "ssh-ed25519 <base64>
# [comment]". The base64 is the SSH wire form (RFC 4253 6.6, RFC 8709 4): string "ssh-ed25519" (4-byte length 11, then
# the name), string key (4-byte length 32, then the 32 bytes), nothing after. Those 32 bytes are the key; key_id is
# unchanged. Anything else is None: another key type, options before the type, a second line, lengths other than 11 and
# 32, bytes after the key, base64 that is not the one spelling of its bytes, a comment outside printable ASCII. The
# JavaScript twin is sshEd25519Key in workers/hs-ledger/src/ssh_ed25519.mjs (the ledger's witness intake).
SSH_LINE = re.compile(r"ssh-ed25519[ \t]+([A-Za-z0-9+/]+={0,2})(?:[ \t]+[\x20-\x7e\t]*)?")


def ssh_ed25519_key(b):
    """bytes as served: one line, with at most one final \\n or \\r\\n -> the 32 key bytes, or None"""
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
    """the 32 key bytes a key_url serves: {"public_key_ed25519_b64": ...} as before, or one ssh-ed25519 line"""
    try:
        doc = json.loads(b.decode("utf-8"))
    except ValueError:
        k = ssh_ed25519_key(b)
        if k is None:
            raise Bad("the key_url serves neither {\"public_key_ed25519_b64\": ...} nor one ssh-ed25519 line")
        return k
    return W.key_from_doc(doc)


def key_served(e, get=http_get):
    """True when key_url serves the entry's key now"""
    s, b = get(e["key_url"])
    if s != 200:
        raise Unreachable("%s answered %d" % (e["key_url"], s)) if s >= 500 or s == 429 else Stop("%s answered %d" % (e["key_url"], s))
    try:
        return served_key(b) == W.b64d(e["public_key_ed25519_b64"], 32)
    except (ValueError, Bad):
        return False


def draw_live(day, get=http_get, tsha=None, check_key_url=False):
    """-> ("new", record) or ("already", n). Raises Stop subclasses."""
    i = live_inputs(day, get)
    d = draw(i["day"], i["day_sha256"], i["n"], i["root"], i["batch_entry"], i["anchor_block"], i["beacon_hash"], i["pool"], i["pool_entry"])
    rc = draw_record(d, tsha or tool_sha())
    mine = parse_draw_record(rc)
    for n, other in sorted(i["draws"].items()):
        try:
            f = parse_draw_record(other)
        except Bad:
            raise Stop("ledger entry %d starts like a draw for %s but is not one" % (n, day))
        if {k: v for k, v in f.items() if k != "tool"} != {k: v for k, v in mine.items() if k != "tool"}:
            raise Stop("ledger entry %d already holds a different draw for %s" % (n, day))
        return "already", n
    if check_key_url:
        w = next(e for e in i["pool"]["entries"] if e["key_id"] == d["witness_key_id"] and e in active(i["pool"], day))
        if not key_served(w, get):
            raise Stop("%s no longer serves key %s: the pool needs a new version before this draw" % (w["key_url"], w["key_id"]))
    return "new", rc


def verify_draw(n, get=http_get):
    """-> list of lines; the last is VERDICT draw_ok or VERDICT not_ok"""
    rd = Reader(get)
    e = rd.entry(n)
    try:
        f = parse_draw_record(e["record_canonical"])
    except Bad as x:
        return ["entry %d: %s" % (n, x), "VERDICT not_ok"]
    i = live_inputs(f["day"], get)
    d = draw(i["day"], i["day_sha256"], i["n"], i["root"], i["batch_entry"], i["anchor_block"], i["beacon_hash"], i["pool"], i["pool_entry"])
    mine = record_fields(d, "0" * 64)
    out, bad = [], 0
    for k in FIELDS:
        if k == "tool":
            out.append("info tool %s" % f[k])
            continue
        same = f[k] == mine[k]
        bad += not same
        out.append("%-4s %s %s" % ("ok" if same else "FAIL", k, f[k] if same else "(entry %s, recomputed %s)" % (f[k], mine[k])))
    first = min(i["draws"]) if i["draws"] else None
    if first != n:
        bad += 1
        out.append("FAIL the first draw entry for %s is %s, not %d" % (f["day"], first, n))
    return out + ["VERDICT " + ("draw_ok" if not bad else "not_ok")]


# ---- command line ----
def _load(p):
    with open(p, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _seed(rc, work):
    return {"claim_sha256": sha(rc), "record_canonical": rc, "work": work}


def _write(p, o):
    with open(p, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(o, ensure_ascii=False, sort_keys=True, indent=1) + "\n")


def main(argv):
    if not argv:
        print(__doc__)
        return 9
    cmd, rest = argv[0], argv[1:]
    opt = {}
    pos = []
    it = iter(rest)
    for x in it:
        if x == "--check-key-url":
            opt[x] = True
        elif x.startswith("--"):
            v = next(it, None)
            if v is None:
                raise Bad("missing value for " + x)
            opt[x] = v
        else:
            pos.append(x)
    if cmd == "selftest":
        sp = importlib.util.spec_from_file_location("test_witness_enroll_v0", os.path.join(HERE, "test_witness_enroll_v0.py"))
        t = importlib.util.module_from_spec(sp)
        sys.modules[sp.name] = t
        sp.loader.exec_module(t)
        return t.run()
    if cmd in ("pool-check", "pool-keys", "pool-seed") and len(pos) == 1:
        p = _load(pos[0])
        check_pool(p)
        print("pool ok: version %d, %d entries, pool_sha256 %s" % (p["version"], len(p["entries"]), pool_sha256(p)))
        today = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
        act = active(p, today)
        print("active today (%s UTC) for %s: %s" % (today, DRAW_KIND, ", ".join(e["signed_domain"] + " " + e["key_id"] for e in act) or "none"))
        if cmd == "pool-keys":
            bad = 0
            for e in act:
                ok = key_served(e)
                bad += not ok
                print("%-4s %s serves %s" % ("ok" if ok else "FAIL", e["key_url"], e["key_id"]))
            print("POOL_KEYS " + ("same" if not bad else "differ %d" % bad))
            return 0 if not bad else 1
        if cmd == "pool-seed":
            rc = pool_record(p)
            _write(opt["--out"], _seed(rc, "witness-enroll-v0: pool version %d" % p["version"]))
            print("seed %s claim_sha256 %s" % (opt["--out"], sha(rc)))
        return 0
    if cmd == "draw-live" and len(pos) == 1 and "--out" in opt:
        st, x = draw_live(pos[0], check_key_url=bool(opt.get("--check-key-url")))
        if st == "already":
            print("ALREADY %s the draw for %s is ledger entry %d; nothing new to write" % (pos[0], pos[0], x))
            return 0
        f = parse_draw_record(x)
        _write(opt["--out"], _seed(x, "witness-enroll-v0: draw for the FURUI day record of " + pos[0]))
        print("DRAW %s witness %s %s leaves %s pool_entry %s batch_entry %s beacon %s claim_sha256 %s"
              % (pos[0], f["witness_signed_domain"], f["witness_key_id"], f["leaf_index"], f["pool_entry"], f["day_batch_entry"],
                 f["beacon_block"], sha(x)))
        return 0
    if cmd == "verify-draw" and len(pos) == 1 and re.fullmatch(r"[1-9][0-9]{0,8}", pos[0]):
        lines = verify_draw(int(pos[0]))
        print("\n".join(lines))
        return 0 if lines[-1] == "VERDICT draw_ok" else 1
    print(__doc__)
    return 9


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Stop as e:
        print("witness_enroll_v0: %s: %s" % (type(e).__name__, e))
        sys.exit(e.code)
    except (Bad, KeyError, OSError, ValueError) as e:
        print("witness_enroll_v0: %s: %s" % (type(e).__name__, e))
        sys.exit(9)
