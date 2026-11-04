"""ots_nightly.py: every night, the OpenTimestamps proof of every anchored NENRIN ledger entry, rechecked against the
Bitcoin block header from two public block explorers, and kept where anyone can read it (ots-nightly/ in this
repository, at once on raw.githubusercontent.com).

    python3 -I -B workers/hs-ledger/nenrin/ots-nightly/ots_nightly.py check --trigger schedule|dispatch|force --out result.json
            [--previous ots-nightly/latest.json] [--only N-M]
        reads https://ledger.horizonshield.dev (GET /ledger, /ledger/<n>?format=json, /ledger/<n>/ots) and the two
        explorers of nenrin-verify --bitcoin-header (https://mempool.space/api, https://blockstream.info/api: GET
        /blocks/tip/height, /block-height/<h>, /block/<hash>/header). For each entry:
          - the entry's record_canonical hashes to its claim_sha256 (when the entry carries it);
          - the proof's file digest is the claim_sha256, and it has a Bitcoin attestation at the entry's bitcoin_block;
          - nenrin_verify.furui_day.bitcoin_header (0.9.0): both explorers name the same block hash at that height and
            serve the same 80 byte header, the header hashes (sha256d) to that hash, meets the target its own bits name,
            and its merkle root is the one the proof commits to.
        Writes the result (schema nenrin-ots-nightly-v1) and prints "OTS_NIGHTLY <verdict> <result_sha256>".
        Exit 0 green or notice, 1 red, 2 the check itself could not run (the ledger did not answer).
    python3 -I -B workers/hs-ledger/nenrin/ots-nightly/ots_nightly.py decide --trigger schedule|dispatch|force --now <UTC ISO> --have-night 0|1
        prints "run <why>" or "skip <why>". schedule and dispatch run once a night (the night is the UTC date of the
        start), never between 00:20 and 01:05 UTC (the ledger's daily batch); force always runs and the earlier result
        of the night is kept under earlier.
    python3 -I -B workers/hs-ledger/nenrin/ots-nightly/ots_nightly.py write --result result.json --run-url URL --dir ots-nightly
        writes ots-nightly/nights/<night>.json, ots-nightly/latest.json (the same bytes) and ots-nightly/index.json, and
        prints "OTS_NIGHTLY_KEPT <night> <result_sha256>".
    python3 -I -B workers/hs-ledger/nenrin/ots-nightly/ots_nightly.py --selftest
        the verdicts on made up ledgers and explorers (no network), and the writing on a scratch folder.

Verdict: red when a check fails on bytes the ledger serves (an entry that does not hash to its claim, a proof that does
not commit to the claim or does not reach the entry's block, a header both explorers agree on whose merkle root is not
the proof's or that does not hash to the block they name or misses its own target), or when an entry that was ok the
night before is now red or its block hash changed. notice when something could not be checked (an explorer down or
malformed after three tries, the two explorers disagreeing, a block with fewer than 6 confirmations). green when every
anchored entry is ok. Entries not yet anchored (pending, unstamped) are counted, never red.

Limits (also in the result): two explorers that serve the same made up header are believed; the chain is not walked from
a checkpoint, the bits are not compared with the difficulty at that height, the height is the explorers' word. Your own
Bitcoin node, or `ots verify` pointed at one, has none of these limits.

Standard library and nenrin_verify (0.9.0 or later; the copy in this repository unless --installed). Writes only --out
and under --dir.
"""
import argparse, datetime, hashlib, json, os, re, sys, tempfile, threading, time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_SRC = os.path.normpath(os.path.join(HERE, "..", "sdk-python", "src"))

SCHEMA = "nenrin-ots-nightly-v1"
LEDGER = "https://ledger.horizonshield.dev"
MIN_CONF = 6
BATCH = (20, 65)  # minutes after 00:00 UTC: the ledger's daily batch; schedule and dispatch do not start in it
TRIGGERS = ("schedule", "dispatch", "force")
TRIES = 3
WAITS = (5, 20)
EXPLORER_GAP = 0.25  # seconds between two calls to the same explorer
NIGHT_RE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
H64 = re.compile(r"[0-9a-f]{64}")
# bitcoin_header codes that say an explorer could not be read, not that a block or a proof is wrong
SOURCE_CODE = re.compile(r"(mempool|blockstream)_(height_http_[0-9]+|header_http_[0-9]+|hash_shape|header_shape)")
DISAGREE = ("explorers_name_different_blocks", "explorers_serve_different_headers")
LIMITS = [
    "two explorers that serve the same made up header are believed",
    "the chain is not walked from a checkpoint, and the bits are not compared with the difficulty at that height",
    "the height is the explorers' word (a header does not carry its height)",
    "your own Bitcoin node, or `ots verify` pointed at one, has none of these limits",
]
RECHECK = ("python3 -I -B workers/hs-ledger/nenrin/ots-nightly/ots_nightly.py check --trigger force --out mine.json, then compare "
           "answers_sha256 (entries, blocks, counts and verdict; it does not cover the times, the tips or the request counts)")


def canon(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha(b):
    return hashlib.sha256(b if isinstance(b, bytes) else b.encode("utf-8")).hexdigest()


def load_nv(installed):
    if not installed:
        sys.path.insert(0, REPO_SRC)
    import nenrin_verify
    from nenrin_verify import furui_day as F
    if not hasattr(F, "bitcoin_header"):
        raise SystemExit("nenrin_verify %s has no bitcoin_header (0.9.0 or later is needed)" % nenrin_verify.__version__)
    return nenrin_verify.__version__, F


class Net:
    """GETs with three tries (a network error, 429 or 5xx), one memo per URL for the run, and a gap per explorer."""

    def __init__(self, F, ledger_get=None, explorer_get=None, sleep=time.sleep, clock=time.monotonic):
        self.F = F
        self.lget = ledger_get or F.http_get
        self.xget = explorer_get or F.http_get_explorer
        self.sleep, self.clock = sleep, clock
        self.memo, self.last = {}, {}
        self.count = {"ledger": 0, "mempool": 0, "blockstream": 0, "retries": 0}
        self.lock = threading.Lock()

    def _add(self, k):
        with self.lock:
            self.count[k] += 1

    def _tries(self, fn, url, label):
        err = None
        for i in range(TRIES):
            if i:
                self._add("retries")
                self.sleep(WAITS[i - 1])
            self._add(label)
            try:
                s, b = fn(url)
            except self.F.NetError as e:
                err = e
                continue
            if s == 429 or s >= 500:
                err = None
                last = (s, b)
                continue
            return s, b
        if err is not None:
            raise err
        return last

    def ledger(self, url):
        return self._tries(self.lget, url, "ledger")

    def explorer(self, url):
        if url in self.memo:
            return self.memo[url]
        label = "mempool" if url.startswith("https://mempool.space/") else "blockstream"
        t = self.last.get(label)
        if t is not None:
            w = EXPLORER_GAP - (self.clock() - t)
            if w > 0:
                self.sleep(w)
        try:
            r = self._tries(self.xget, url, label)
        finally:
            self.last[label] = self.clock()
        self.memo[url] = r
        return r


def _tip(net, F):
    out = {}
    for name, base in F.EXPLORERS:
        try:
            s, b = net.explorer(base + "/blocks/tip/height")
            t = bytes(b).decode("latin-1")
            out[name] = int(t) if s == 200 and re.fullmatch(r"[1-9][0-9]{0,8}", t) else None
        except F.NetError:
            out[name] = None
    return out


def _entry(net, F, n):
    """-> the entry's line (without the header part) and the proof's merkle root at its block, or None"""
    line = {"n": n, "claim_sha256": None, "ots_status": None, "bitcoin_block": None, "ots_sha256": None,
            "merkle_root": None, "state": None, "code": None}
    s, b = net.ledger(LEDGER + "/ledger/%d?format=json" % n)
    try:
        e = F.parse_json(b) if s == 200 else None
    except F._Bad:
        e = None
    if not isinstance(e, dict):
        line.update(state="not_checked", code="entry_http_%d" % s if s != 200 else "entry_not_json")
        return line
    cs = e.get("claim_sha256")
    line["claim_sha256"] = cs if isinstance(cs, str) else None
    line["ots_status"] = e.get("ots_status") if isinstance(e.get("ots_status"), str) else None
    if not isinstance(cs, str) or not H64.fullmatch(cs):
        line.update(state="red", code="entry_claim_shape")
        return line
    rc = e.get("record_canonical")
    if isinstance(rc, str) and sha(rc) != cs:
        line.update(state="red", code="entry_bytes_do_not_hash_to_claim")
        return line
    if line["ots_status"] != "confirmed":
        line["state"] = line["ots_status"] if line["ots_status"] in ("pending", "unstamped") else "other"
        return line
    h = e.get("bitcoin_block")
    if not F._isint(h, 1):
        line.update(state="red", code="entry_confirmed_without_block")
        return line
    line["bitcoin_block"] = h
    s, pb = net.ledger(LEDGER + "/ledger/%d/ots" % n)
    if s != 200:
        line.update(state="not_checked", code="ots_http_%d" % s)
        return line
    line["ots_sha256"] = sha(bytes(pb))
    try:
        digest, btc, _p = F.ots_parse(bytes(pb))
    except F._Bad as x:
        line.update(state="red", code="ots_parse_" + str(x))
        return line
    if digest.hex() != cs:
        line.update(state="red", code="ots_digest_is_not_the_entry")
        return line
    hit = [m for (hh, m) in btc if hh == h]
    if not hit:
        line.update(state="red", code="ots_no_attestation_at_the_entry_block" if btc else "ots_no_bitcoin_attestation")
        return line
    line["merkle_root"] = hit[0]
    return line


def check(trigger, previous=None, only=None, installed=False, net=None, now=None, F=None, version=None):
    if F is None:
        version, F = load_nv(installed)
    net = net or Net(F)
    started = now or datetime.datetime.now(datetime.timezone.utc)
    s, top = net.ledger(LEDGER + "/ledger")
    try:
        top = F.parse_json(top) if s == 200 else None
    except F._Bad:
        top = None
    count = top.get("count") if isinstance(top, dict) else None
    if not F._isint(count, 1):
        raise F.NetError("the ledger's /ledger did not answer a count (http %d)" % s)
    ns = list(range(1, count + 1))
    if only:
        lo, hi = only
        ns = [n for n in ns if lo <= n <= hi]
    tip = _tip(net, F)
    known = [t for t in tip.values() if t is not None]
    tipmin = min(known) if known else None
    with ThreadPoolExecutor(max_workers=4) as ex:
        lines = list(ex.map(lambda n: _entry(net, F, n), ns))
    blocks = {}
    for ln in lines:
        if ln["state"] is not None:
            continue
        h = ln["bitcoin_block"]
        k = str(h)
        if k not in blocks:
            blocks[k] = {"state": None, "code": None, "block_hash": None, "header": None, "merkle_root": None,
                         "entries": [], "sources": None}
            if tipmin is None:
                blocks[k].update(state="not_checked", code="no_tip_from_either_explorer")
            elif tipmin - h + 1 < MIN_CONF:
                blocks[k].update(state="too_recent", code="confirmations_%d" % max(0, tipmin - h + 1))
        blocks[k]["entries"].append(ln["n"])
        b = blocks[k]
        if b["state"] in ("not_checked", "too_recent") and b["code"] and b["header"] is None:
            ln.update(state=b["state"], code=b["code"])
            continue
        seen = {}

        def rec(url):
            r = net.explorer(url)
            seen[url] = r
            return r
        try:
            st, code, facts = F.bitcoin_header(h, ln["merkle_root"], rec)
        except F.NetError as x:
            st, code, facts = "fail", "explorer_unreachable", None
            seen["error"] = (0, str(x).encode("utf-8", "replace")[:200])
        if st == "ok":
            b.update(state="ok", block_hash=facts["block_hash"], header=facts["header"], merkle_root=ln["merkle_root"])
            ln.update(state="ok", code=None)
        elif code == "explorer_unreachable" or SOURCE_CODE.fullmatch(code or ""):
            b.update(state="not_checked", code=code)
            ln.update(state="not_checked", code=code)
        elif code in DISAGREE:
            b.update(state="sources_disagree", code=code,
                     sources={u: {"status": r[0], "body": bytes(r[1]).decode("latin-1")[:200]} for u, r in sorted(seen.items())})
            ln.update(state="not_checked", code=code)
        else:
            # both explorers served the same header; it does not hash to their block, misses its target, or does
            # not carry this proof's merkle root
            b.update(state="red" if b["state"] != "ok" else "ok", code=code if b["state"] != "ok" else b["code"])
            if b["header"] is None:
                hx = [bytes(r[1]).decode("latin-1") for u, r in sorted(seen.items()) if u.endswith("/header") and r[0] == 200]
                b["header"] = hx[0] if hx else None
            ln.update(state="red", code=code)
    prev = {}
    if isinstance(previous, dict):
        prev_blocks = previous.get("blocks") if isinstance(previous.get("blocks"), dict) else {}
        for pl in previous.get("entries") or []:
            if isinstance(pl, dict) and pl.get("state") == "ok":
                pb = prev_blocks.get(str(pl.get("bitcoin_block"))) or {}
                prev[pl.get("n")] = (pl.get("bitcoin_block"), pb.get("block_hash"), pl.get("ots_sha256"))
    for ln in lines:
        p = prev.get(ln["n"])
        if not p:
            continue
        b = blocks.get(str(ln["bitcoin_block"])) or {}
        if ln["state"] == "ok" and b.get("block_hash") and p[1] and (p[0] != ln["bitcoin_block"] or p[1] != b["block_hash"]):
            ln.update(state="red", code="block_changed_since_last_night")
        elif ln["state"] == "red" and ln["code"] and not ln["code"].endswith("_since_last_night"):
            ln["code"] = ln["code"] + "_was_ok_last_night"
        elif ln["state"] in ("pending", "unstamped", "other"):
            ln.update(state="red", code="was_anchored_last_night")
    for ln in lines:
        ln.pop("merkle_root", None)
    counts = {k: 0 for k in ("entries", "confirmed", "ok", "red", "not_checked", "too_recent", "pending", "unstamped", "other")}
    counts["entries"] = len(lines)
    for ln in lines:
        counts[ln["state"]] = counts.get(ln["state"], 0) + 1
        if ln["ots_status"] == "confirmed":
            counts["confirmed"] += 1
    verdict = "red" if counts["red"] else ("notice" if counts["not_checked"] or counts["too_recent"] else "green")
    answers = {"entries": lines, "blocks": blocks, "counts": counts, "verdict": verdict}
    res = {
        "schema": SCHEMA,
        "night": started.strftime("%Y-%m-%d"),
        "checked_at": started.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "finished_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if now is None else started.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "trigger": trigger,
        "tool": {"script": "workers/hs-ledger/nenrin/ots-nightly/ots_nightly.py", "script_sha256": sha(open(os.path.abspath(__file__), "rb").read()),
                 "nenrin_verify": version, "furui_day_sha256": sha(open(F.__file__, "rb").read())},
        "ledger": {"origin": LEDGER, "count": count, "only": list(only) if only else None},
        "explorers": [base for _n, base in F.EXPLORERS],
        "tip": tip,
        "min_confirmations": MIN_CONF,
        "verdict": verdict,
        "counts": counts,
        "requests": dict(net.count),
        "blocks": blocks,
        "entries": lines,
        "answers_sha256": sha(canon(answers)),
        "limits": LIMITS,
        "recheck": RECHECK,
    }
    return res


def result_sha256(res):
    return sha(canon({k: v for k, v in res.items() if k not in ("result_sha256", "run_url", "earlier")}))


def decide(trigger, now, have_night):
    if trigger not in TRIGGERS:
        return "skip", "unknown trigger %s" % trigger
    if trigger == "force":
        return "run", "force always runs; an earlier result of the night is kept under earlier"
    if BATCH[0] <= now.hour * 60 + now.minute < BATCH[1]:
        return "skip", "a %s run at %s UTC is in the ledger's batch (00:20 to 01:05 UTC); the next schedule or dispatch checks the night" % (trigger, now.strftime("%H:%M"))
    if have_night:
        return "skip", "%s already has a result; the %s run does nothing" % (now.strftime("%Y-%m-%d"), trigger)
    return "run", "%s has no result yet" % now.strftime("%Y-%m-%d")


def _atomic(path, text):
    d = os.path.dirname(path)
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def write(result_path, run_url, out_dir):
    with open(result_path, encoding="utf-8") as f:
        res = json.load(f)
    if res.get("schema") != SCHEMA or not NIGHT_RE.fullmatch(str(res.get("night"))) or res.get("result_sha256") != result_sha256(res):
        raise SystemExit("not a %s result, or its result_sha256 does not match" % SCHEMA)
    night = res["night"]
    day_path = os.path.join(out_dir, "nights", night + ".json")
    earlier = []
    if os.path.exists(day_path):
        with open(day_path, encoding="utf-8") as f:
            old = json.load(f)
        earlier = list(old.get("earlier") or []) + [{k: old.get(k) for k in ("checked_at", "trigger", "verdict", "result_sha256", "answers_sha256", "run_url")}]
    res["run_url"] = run_url
    res["earlier"] = earlier
    text = canon(res) + "\n"
    _atomic(day_path, text)
    _atomic(os.path.join(out_dir, "latest.json"), text)
    ip = os.path.join(out_dir, "index.json")
    idx = {"schema": "nenrin-ots-nightly-index-v1", "nights": []}
    if os.path.exists(ip):
        with open(ip, encoding="utf-8") as f:
            idx = json.load(f)
    rows = [r for r in idx.get("nights", []) if r.get("night") != night]
    rows.append({"night": night, "verdict": res["verdict"], "counts": res["counts"], "result_sha256": res["result_sha256"],
                 "answers_sha256": res["answers_sha256"], "path": "nights/%s.json" % night})
    rows.sort(key=lambda r: r["night"], reverse=True)
    idx["nights"] = rows
    _atomic(ip, json.dumps(idx, sort_keys=True, indent=1, ensure_ascii=False) + "\n")
    return night, res["result_sha256"]


# ---- self test: made up ledgers and explorers ----
def _varuint(v):
    out = bytearray()
    while True:
        c = v & 0x7F
        v >>= 7
        out.append(c | (0x80 if v else 0))
        if not v:
            return bytes(out)


def _proof(F, digest_hex, height, salt):
    """an OTS proof: the digest, append salt, sha256, a Bitcoin attestation at height. -> (bytes, merkle root, explorer order)"""
    d = bytes.fromhex(digest_hex)
    msg = hashlib.sha256(d + salt).digest()
    b = F.OTS_MAGIC + _varuint(1) + b"\x08" + d + b"\xf0" + _varuint(len(salt)) + salt + b"\x08"
    b += b"\x00" + F.OTS_BITCOIN + _varuint(len(_varuint(height))) + _varuint(height)
    return b, msg[::-1].hex()


def _header(F, merkle, salt):
    b = (0x20000000).to_bytes(4, "little") + hashlib.sha256(salt).digest() + bytes.fromhex(merkle)[::-1]
    b += (1793000000).to_bytes(4, "little") + (0x207FFFFF).to_bytes(4, "little")
    t = F.bits_target(0x207FFFFF)
    for nonce in range(1 << 20):
        hb = b + nonce.to_bytes(4, "little")
        if int(F.sha256d(hb)[::-1].hex(), 16) <= t:
            return hb.hex(), F.sha256d(hb)[::-1].hex()
    raise AssertionError("no nonce")


def _world(F):
    """a ledger of 5 entries: 1 and 2 in block 900000 (two proofs with two merkle roots: only 1's is the block's),
    3 in block 900050, 4 pending, 5 unstamped. -> (ledger answers, height -> the merkle root of its header)"""
    W, X = {}, {}
    for n in (1, 2, 3, 4, 5):
        rc = "record %d" % n
        cs = sha(rc)
        status = "confirmed" if n <= 3 else ("pending" if n == 4 else "unstamped")
        e = {"n": n, "claim_sha256": cs, "record_canonical": rc, "ots_status": status}
        if status == "confirmed":
            h = 900050 if n == 3 else 900000
            pb, mr = _proof(F, cs, h, b"tx-900000" + bytes([n]) if h == 900000 else b"tx-900050")
            e["bitcoin_block"] = h
            W[LEDGER + "/ledger/%d/ots" % n] = (200, pb)
            X.setdefault(h, mr)
        W[LEDGER + "/ledger/%d?format=json" % n] = (200, json.dumps(e).encode())
    W[LEDGER + "/ledger"] = (200, json.dumps({"count": 5, "entries": []}).encode())
    return W, X


def _explorers(F, X, tip=900100, override=None):
    """the two explorers' answers for the blocks in X (height -> merkle root)"""
    E = {}
    for h, mr in X.items():
        hx, bh = _header(F, mr, b"prev-%d" % h)
        for _name, base in F.EXPLORERS:
            E[base + "/block-height/%d" % h] = (200, bh.encode())
            E[base + "/block/%s/header" % bh] = (200, hx.encode())
    for _name, base in F.EXPLORERS:
        E[base + "/blocks/tip/height"] = (200, str(tip).encode())
    E.update(override or {})
    return E


def _getter(table, F):
    def g(url):
        if url not in table:
            return 404, b"not found"
        r = table[url]
        if r == "down":
            raise F.NetError(url + ": down")
        return r
    return g


def _run(F, version, W, E, previous=None):
    net = Net(F, _getter(W, F), _getter(E, F), sleep=lambda s: None, clock=lambda: 0.0)
    now = datetime.datetime(2026, 11, 5, 19, 10, tzinfo=datetime.timezone.utc)
    res = check("schedule", previous=previous, net=net, now=now, F=F, version=version)
    res["result_sha256"] = result_sha256(res)
    return res, net


def selftest(installed=False):
    version, F = load_nv(installed)
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
        print(("ok    " if c else "FAIL  ") + m)

    W, X = _world(F)
    E = _explorers(F, X)
    # green: entry 2 moved to its own block 900001
    W2 = dict(W)
    e2 = json.loads(W[LEDGER + "/ledger/2?format=json"][1])
    e2["bitcoin_block"] = 900001
    pb2, mr2 = _proof(F, e2["claim_sha256"], 900001, b"tx-900000" + bytes([2]))
    W2[LEDGER + "/ledger/2?format=json"] = (200, json.dumps(e2).encode())
    W2[LEDGER + "/ledger/2/ots"] = (200, pb2)
    X2 = {900000: X[900000], 900001: mr2, 900050: X[900050]}
    E2 = _explorers(F, X2)
    g, net = _run(F, version, W2, E2)
    ok(g["verdict"] == "green" and g["counts"]["ok"] == 3 and g["counts"]["pending"] == 1 and g["counts"]["unstamped"] == 1,
       "green: 3 anchored entries ok, 1 pending and 1 unstamped counted, not red (%s %s)" % (g["verdict"], g["counts"]))
    ok(net.count["mempool"] == 1 + 2 * 3 and net.count["blockstream"] == 1 + 2 * 3 and net.count["retries"] == 0,
       "green: each explorer asked for the tip and 2 GETs per block, once (%s)" % net.count)
    g2, _ = _run(F, version, W2, E2)
    ok(g2["answers_sha256"] == g["answers_sha256"] and g2["result_sha256"] == g["result_sha256"], "the same answers give the same answers_sha256 and result_sha256")
    # red: entry 2's proof reaches another merkle root than block 900000's header, both explorers agree on the header
    r, _ = _run(F, version, W, E)
    e2r = [x for x in r["entries"] if x["n"] == 2][0]
    ok(r["verdict"] == "red" and e2r["state"] == "red" and e2r["code"] == "header_merkle_root_is_not_the_proof",
       "red: a proof whose merkle root is not the header's (%s %s)" % (r["verdict"], e2r["code"]))
    # red: the entry does not hash to its claim
    W3 = dict(W2)
    e3 = json.loads(W2[LEDGER + "/ledger/3?format=json"][1])
    e3["record_canonical"] = "record 3 changed"
    W3[LEDGER + "/ledger/3?format=json"] = (200, json.dumps(e3).encode())
    r3, _ = _run(F, version, W3, E2)
    ok(r3["verdict"] == "red" and [x for x in r3["entries"] if x["n"] == 3][0]["code"] == "entry_bytes_do_not_hash_to_claim",
       "red: record_canonical does not hash to claim_sha256")
    # red: the proof is for another digest
    W4 = dict(W2)
    W4[LEDGER + "/ledger/3/ots"] = (200, _proof(F, "ab" * 32, 900050, b"tx-900050")[0])
    r4, _ = _run(F, version, W4, E2)
    ok([x for x in r4["entries"] if x["n"] == 3][0]["code"] == "ots_digest_is_not_the_entry" and r4["verdict"] == "red",
       "red: the proof's digest is not the entry's claim")
    # red: no attestation at the entry's block
    W5 = dict(W2)
    W5[LEDGER + "/ledger/3/ots"] = (200, _proof(F, e3["claim_sha256"], 900051, b"tx-900050")[0])
    r5, _ = _run(F, version, W5, E2)
    ok([x for x in r5["entries"] if x["n"] == 3][0]["code"] == "ots_no_attestation_at_the_entry_block", "red: the proof reaches another height")
    # notice: blockstream down for every call (three tries each, then not_checked)
    E6 = dict(E2)
    for u in list(E6):
        if u.startswith("https://blockstream.info/"):
            E6[u] = "down"
    r6, net6 = _run(F, version, W2, E6)
    ok(r6["verdict"] == "notice" and r6["counts"]["not_checked"] == 3 and r6["counts"]["red"] == 0 and r6["tip"]["blockstream"] is None,
       "notice: one explorer down, the anchored entries are not_checked, nothing red (%s)" % r6["counts"])
    ok(net6.count["retries"] > 0 and all(x["code"] == "explorer_unreachable" for x in r6["entries"] if x["state"] == "not_checked"),
       "notice: the down explorer was tried three times per URL (%d retries)" % net6.count["retries"])
    # notice: blockstream answers 503 for the header of 900050
    E7 = dict(E2)
    bh50 = E2["https://mempool.space/api/block-height/900050"][1].decode()
    E7["https://blockstream.info/api/block/%s/header" % bh50] = (503, b"busy")
    r7, _ = _run(F, version, W2, E7)
    ok(r7["verdict"] == "notice" and [x for x in r7["entries"] if x["n"] == 3][0]["code"] == "blockstream_header_http_503",
       "notice: an explorer that answers 503 three times is not a red")
    # notice: the two explorers serve different headers (the bodies are kept)
    E8 = dict(E2)
    hx = E2["https://blockstream.info/api/block/%s/header" % bh50][1].decode()
    E8["https://blockstream.info/api/block/%s/header" % bh50] = (200, (hx[:-2] + ("00" if hx[-2:] != "00" else "01")).encode())
    r8, _ = _run(F, version, W2, E8)
    b8 = r8["blocks"]["900050"]
    ok(r8["verdict"] == "notice" and b8["state"] == "sources_disagree" and b8["code"] == "explorers_serve_different_headers" and len(b8["sources"]) == 4,
       "notice: explorers that disagree are recorded with both answers, not red")
    # notice: too recent
    E9 = _explorers(F, X2, tip=900053)
    r9, _ = _run(F, version, W2, E9)
    ok(r9["blocks"]["900050"]["state"] == "too_recent" and r9["verdict"] == "notice" and r9["counts"]["ok"] == 2,
       "notice: a block with 4 confirmations is left for a later night")
    # red: a block hash changed since last night
    prev = json.loads(json.dumps(g))
    prev["blocks"]["900050"]["block_hash"] = "00" * 32
    r10, _ = _run(F, version, W2, E2, previous=prev)
    ok(r10["verdict"] == "red" and [x for x in r10["entries"] if x["n"] == 3][0]["code"] == "block_changed_since_last_night",
       "red: an entry ok last night whose block hash changed")
    # red: an entry anchored last night is pending now
    W11 = dict(W2)
    e3p = json.loads(W2[LEDGER + "/ledger/3?format=json"][1])
    e3p["ots_status"] = "pending"
    W11[LEDGER + "/ledger/3?format=json"] = (200, json.dumps(e3p).encode())
    r11, _ = _run(F, version, W11, E2, previous=g)
    ok(r11["verdict"] == "red" and [x for x in r11["entries"] if x["n"] == 3][0]["code"] == "was_anchored_last_night",
       "red: an entry anchored last night is not anchored now")
    # the ledger does not answer: the check raises (exit 2 in main)
    W12 = dict(W2)
    W12[LEDGER + "/ledger"] = (503, b"")
    try:
        _run(F, version, W12, E2)
        raised = False
    except F.NetError:
        raised = True
    ok(raised, "the ledger without a count stops the check (exit 2)")
    # decide
    t = lambda h, m: datetime.datetime(2026, 11, 5, h, m, tzinfo=datetime.timezone.utc)
    ok(decide("schedule", t(19, 10), False)[0] == "run" and decide("dispatch", t(19, 10), True)[0] == "skip"
       and decide("schedule", t(0, 30), False)[0] == "skip" and decide("schedule", t(1, 5), False)[0] == "run"
       and decide("force", t(0, 30), True)[0] == "run" and decide("push", t(19, 10), False)[0] == "skip",
       "decide: once a night, not in the ledger's batch (00:20 to 01:05 UTC), force always")
    # write
    with tempfile.TemporaryDirectory() as d:
        rp = os.path.join(d, "r.json")
        with open(rp, "w", encoding="utf-8") as f:
            json.dump(g, f)
        out = os.path.join(d, "ots-nightly")
        night, rs = write(rp, "https://example.invalid/run/1", out)
        with open(rp, "w", encoding="utf-8") as f:
            json.dump(r, f)
        write(rp, "https://example.invalid/run/2", out)
        lt = open(os.path.join(out, "latest.json"), encoding="utf-8").read()
        dy = open(os.path.join(out, "nights", night + ".json"), encoding="utf-8").read()
        idx = json.load(open(os.path.join(out, "index.json"), encoding="utf-8"))
        kept = json.loads(dy)
        ok(lt == dy and kept["verdict"] == "red" and len(kept["earlier"]) == 1 and kept["earlier"][0]["result_sha256"] == rs
           and len(idx["nights"]) == 1 and idx["nights"][0]["verdict"] == "red",
           "write: night file and latest are the same bytes, the earlier run of the night is kept, one index line per night")
        bad = dict(g)
        bad["verdict"] = "green!"
        with open(rp, "w", encoding="utf-8") as f:
            json.dump(bad, f)
        try:
            write(rp, "x", out)
            refused = False
        except SystemExit:
            refused = True
        ok(refused, "write refuses a result whose result_sha256 does not match")
    ok(all(chr(0x2013) not in x and chr(0x2014) not in x for x in LIMITS + [RECHECK, __doc__]), "no en or em dash in the texts")
    print("%d failed" % len(fails) if fails else "OTS_NIGHTLY_SELFTEST_OK")
    return 1 if fails else 0


def main(argv):
    if argv[:1] == ["--selftest"]:
        return selftest("--installed" in argv)
    ap = argparse.ArgumentParser(prog="ots_nightly.py")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check")
    c.add_argument("--trigger", required=True, choices=TRIGGERS)
    c.add_argument("--out", required=True)
    c.add_argument("--previous")
    c.add_argument("--only")
    c.add_argument("--installed", action="store_true")
    d = sub.add_parser("decide")
    d.add_argument("--trigger", required=True)
    d.add_argument("--now", required=True)
    d.add_argument("--have-night", required=True, choices=("0", "1"))
    w = sub.add_parser("write")
    w.add_argument("--result", required=True)
    w.add_argument("--run-url", required=True)
    w.add_argument("--dir", required=True)
    a = ap.parse_args(argv)
    if a.cmd == "decide":
        now = datetime.datetime.strptime(a.now, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
        verb, why = decide(a.trigger, now, a.have_night == "1")
        print(verb + " " + why)
        return 0
    if a.cmd == "write":
        night, rs = write(a.result, a.run_url, a.dir)
        print("OTS_NIGHTLY_KEPT %s %s" % (night, rs))
        return 0
    previous = None
    if a.previous and os.path.exists(a.previous):
        try:
            with open(a.previous, encoding="utf-8") as f:
                previous = json.load(f)
        except ValueError:
            previous = None
    only = None
    if a.only:
        m = re.fullmatch(r"([1-9][0-9]{0,6})-([1-9][0-9]{0,6})", a.only)
        if not m:
            ap.error("--only N-M")
        only = (int(m.group(1)), int(m.group(2)))
    version, F = load_nv(a.installed)
    try:
        res = check(a.trigger, previous=previous, only=only, F=F, version=version)
    except F.NetError as e:
        print("OTS_NIGHTLY could not run: %s" % e)
        return 2
    res["result_sha256"] = result_sha256(res)
    _atomic(os.path.abspath(a.out), json.dumps(res, sort_keys=True, indent=1, ensure_ascii=False) + "\n")
    print("counts %s requests %s" % (canon(res["counts"]), canon(res["requests"])))
    for ln in res["entries"]:
        if ln["state"] in ("red", "not_checked", "too_recent"):
            print("  entry %d block %s %s %s" % (ln["n"], ln["bitcoin_block"], ln["state"], ln["code"]))
    print("OTS_NIGHTLY %s %s" % (res["verdict"], res["result_sha256"]))
    return 1 if res["verdict"] == "red" else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
