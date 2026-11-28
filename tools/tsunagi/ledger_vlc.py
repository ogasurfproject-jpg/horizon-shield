#!/usr/bin/env python3
"""The JIDEC ledger, graded every night by an outside checker against a head stamped to Bitcoin.

    python3 tools/tsunagi/ledger_vlc.py --out DIR     (one run on its own: DIR/ledger_vlc.json and the files it read)

run_board.py calls run() once a night and keeps the row in board.json (key ledger_vlc, inside board_sha256), in
history.json and in BOARD.md. The checker is vlc-check 1.0.0 (VLC-1, Matthew Moore, MIT,
https://github.com/MattyIceMatrix/vlc-1), run under the adapter its author wrote for this ledger. Nothing it reports is
rewritten here: the row keeps its levels and the status and note of every requirement as it printed them.

One run, in order. Every request is a GET to a fixed host with no redirects; nothing is sent, signed or written
anywhere but a temporary directory (and --out).
  1 checker     the vlc-check 1.0.0 wheel from PyPI, byte for byte the pinned sha256. conformance.py is read out of it
                (sha256 pinned too) and run as python3 -I conformance.py. Nothing is installed.
  2 adapter     adapters/jidec-ledger-chained.json of MattyIceMatrix/vlc-1 at a pinned commit, sha256 pinned.
  3 export      GET https://ledger.horizonshield.dev/ledger/export.jsonl, as served. Its sha256 is in the row.
  4 checkpoint  walking down from the export's last entry, the first nenrin-head-checkpoint-v1 entry whose
                OpenTimestamps proof is confirmed, among the last LOOK_BACK entries. Its record must hash to its claim,
                and the export must carry the same claim at the same n. Newer checkpoints still waiting for Bitcoin are
                listed, not used.
  5 heads       the walk goes on to the bottom of those LOOK_BACK entries, and below them to the most entries an earlier
                night in history.json that held graded, when that is lower (no earlier night's head reaches above it, so
                a rewrite there could only show in an older stamp the walk reads); on a night with no earlier night that
                held (the first night, or after a gap) it goes to entry 1: every entry of the export. Every
                entry it reads must be the export's (its record hashes to its claim, and the export carries that claim at
                that n), and every ledger head written inside one must be reached by the export, recomputed: each
                nenrin-head-checkpoint-v1 entry (waiting, used or older) and each nenrin-witness-batch-v1 entry, its
                ledger_head.entry_sha256 the recomputed link of entry ledger_head.n and a checkpoint's marker_sha256 the
                end marker for it. An older stamp the export no longer reaches shows here even when history.json has no
                night to compare with. A walk that does not read every entry of its range (three entries in a row not
                fetched, its time up, an entry not served, or served without its record bytes) leaves the night not ok.
                A witness batch that says the chain was broken when it was written carries no head; it is listed. The
                proofs of the heads other than the used checkpoint's are not fetched: what the row says of their
                Bitcoin state (confirmed) is the ledger's word.
  6 anchor      the entry's proof (GET /ledger/<n>/ots) commits that claim to the Bitcoin block the entry names, and
                two block explorers (mempool.space, blockstream.info) serve the same header at that height, whose hash
                meets its own target and whose merkle root is the proof's: the code of nenrin-verify furui-day
                --bitcoin-header, loaded from this repository's copy of the PyPI package before any outside code runs.
  7 cut         entries 1..n of the export, byte for byte, where n is the checkpoint's ledger_head.n, then the
                jidec-head-v1 end marker for n made from the checkpoint's head (the line the export ends with when the
                ledger has n entries). Its hash must be the checkpoint's marker_sha256. The board also recomputes the
                links of the whole export itself: every entry's stated links and the export's own end marker must be the
                recomputed ones, and entry n's recomputed link must be the checkpoint's head.
  8 grade       vlc-check --log <cut> --adapter <adapter> --expect-head <marker_sha256> --json
  9 controls    the same with two of the spec's own Annex A mutations of the cut (truncate-tail, flip-byte). Each must
                come out at L0: a check that cannot fail would be no check.
 10 earlier     the export, recomputed, must still reach the head of every earlier night in history.json that held
                (a rewrite or a cut of entries an earlier stamp covered shows here, even after a newer checkpoint), and
                tonight's checkpoint must cover at least the entries each of those nights graded: a newest confirmed
                checkpoint that went back is not a night that held.

The row keeps the export's sha256, how many entries it carried, how many were graded, the head the check compared
against, the grade string, the checkpoint entry and its Bitcoin block, and what the walk read (stamped_heads). A step
that could not be done ends the row as not run, with the reason. ok is true only when every step held and the grade is
at least L1 structural and L1 attested.

What a row establishes: that on that night the export, as served, chained entries 1..n to the head stamped to Bitcoin in
the checkpoint entry, as graded by VLC-1's own checker, and reached every head written inside the entries the walk read.
What it does not: anything about the entries after n (they wait for the next checkpoint), that every submission the
ledger received was appended (the adapter declares no loss mode), or that any record is true. On a night with no earlier
night that held, a ledger rewritten whole, every head inside it rewritten too and stamped again, agrees with itself and
is not visible to the board; the board's own nights from then on, and copies others keep (an export someone saved, a
head someone holds), are what would show it. The same goes, above the entries the earlier nights graded, for a rewrite
that rewrote the older stamps there too: the walk holds each older stamp as the ledger serves it, and only the used
checkpoint's proof is checked.
"""
import argparse, hashlib, importlib.util, io, json, os, re, subprocess, sys, tempfile, time, zipfile
import urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
NENRIN = os.path.join(ROOT, "workers", "hs-ledger", "nenrin")
SCHEMA = "hs-tsunagi-ledger-vlc-v1"
LEDGER = "https://ledger.horizonshield.dev"
EXPORT_URL = LEDGER + "/ledger/export.jsonl"
CHECKER = {"name": "vlc-check", "version": "1.0.0", "author": "Matthew Moore", "license": "MIT",
           "url": "https://files.pythonhosted.org/packages/2e/66/af87e32c63008a13257a16b5a15dd936bc2c48b893958e517786d93ffc30/vlc_check-1.0.0-py3-none-any.whl",
           "sha256": "96cc938ba506f9789ff2653f3daca27a0b95f2d13b069dfe85dd9b9dc10a1921",
           "module": "conformance.py",
           "module_sha256": "68a334035109caa40a94558419d5bae6d1ffb5b91a9e1acebab6a43fe81fcf3b"}
ADAPTER = {"repo": "https://github.com/MattyIceMatrix/vlc-1", "commit": "dada2c991fe34358cb5022fef08784ca438fc827",
           "path": "adapters/jidec-ledger-chained.json",
           "url": "https://raw.githubusercontent.com/MattyIceMatrix/vlc-1/dada2c991fe34358cb5022fef08784ca438fc827/adapters/jidec-ledger-chained.json",
           "sha256": "5c6d1c9c7ffb746af4d99d1ceb0a23ba413e50f55eb9910ce0232f5181eee5e3"}
HOSTS = ("ledger.horizonshield.dev", "files.pythonhosted.org", "raw.githubusercontent.com")
UA = "hs-tsunagi-ledger-vlc/1 (+https://github.com/ogasurfproject-jpg/horizon-shield/tree/main/tools/tsunagi)"
LIMITS = {"wheel": 1 << 20, "adapter": 1 << 18, "export": 64 << 20, "entry": 4 << 20, "ots": 1 << 16}
LOOK_BACK = 40          # entries looked at, from the export's last one down, for a confirmed checkpoint and their heads
WALK_SECONDS = 300      # and for at most this long; three entries in a row that cannot be fetched also end the walk
WHOLE_WALK_SECONDS = 900   # a night with no earlier night that held reads every entry, for at most this long
CONTROLS = ("truncate-tail", "flip-byte")
CHECK_TIMEOUT = 300
CHECKPOINT = "nenrin-head-checkpoint-v1"
WITNESS_BATCH = "nenrin-witness-batch-v1"
HEADS = {CHECKPOINT: "checkpoint", WITNESS_BATCH: "witness batch"}   # the records that carry a ledger_head
MARKER = "jidec-head-v1"
CHAIN = "jidec-chain-v1"
ZERO = "0" * 64
H64 = re.compile(r"[0-9a-f]{64}")


def _sdk_furui_day():
    """ots_parse and bitcoin_header from the PyPI package's source in this repository, loaded by path (as run_board
    loads its referee), so the board needs nothing installed and outside code cannot change them before they are read."""
    path = os.path.join(NENRIN, "sdk-python", "src", "nenrin_verify", "furui_day.py")
    spec = importlib.util.spec_from_file_location("tsunagi_furui_day", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


FD = _sdk_furui_day()


class NetError(Exception):
    pass


class _Stop(Exception):
    pass


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def http_get(url, limit, timeout=30):
    """(status, body bytes). GET only, only HOSTS, no redirects, at most limit bytes. Up to three tries on a network
    error, a 429 or a 5xx; anything else is answered as it came."""
    try:
        u = urllib.parse.urlsplit(url)
        port = u.port
    except ValueError:
        raise NetError("not an allowed URL: " + url)
    if u.scheme != "https" or u.hostname not in HOSTS or port not in (None, 443):
        raise NetError("not an allowed URL: " + url)
    op = urllib.request.build_opener(_NoRedirect)
    req = urllib.request.Request(url, headers={"user-agent": UA, "accept": "*/*"})
    last = None
    for i in range(3):
        try:
            with op.open(req, timeout=timeout) as r:
                b = r.read(limit + 1)
                if len(b) > limit:
                    raise NetError("%s: longer than %d bytes" % (url, limit))
                return r.status, b
        except urllib.error.HTTPError as e:
            if (e.code < 500 and e.code != 429) or i == 2:
                return e.code, e.read(4096)
            last = "HTTP %d" % e.code
        except (urllib.error.URLError, OSError, ValueError) as e:
            last = str(getattr(e, "reason", None) or e)
        time.sleep(2 * (i + 1))
    raise NetError("%s: %s" % (url, last))


def sha(b):
    return hashlib.sha256(b if isinstance(b, bytes) else b.encode("utf-8")).hexdigest()


def canon(o):
    """the ledger's canon (GET /ledger/head, recipe): keys sorted, separators , and : without spaces, non-ASCII escaped"""
    return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def marker_line(n, head):
    """The jidec-head-v1 end marker the export ends with when the ledger has n entries and entry n's entry_sha256 is
    head: the ledger's boundHeadRecord, same fields in the same order (workers/hs-ledger/src/chain_v1.mjs)."""
    m = {"schema": MARKER, "n": n, "head": head, "root": ZERO, "chain": CHAIN, "prev_entry_sha256": head}
    m["entry_sha256"] = sha(canon({"n": n, "schema": MARKER, "prev_entry_sha256": head, "head": head}))
    return m


def recompute(entries):
    """-> (links, first bad n): each entry's jidec-chain-v1 entry_sha256 recomputed from its own fields and the link before
    it (GET /ledger/head, recipe), and the first n whose stated prev_entry_sha256 or entry_sha256 is not that, or None"""
    prev, links, bad = ZERO, [], None
    for e in entries:
        body = {"n": e.get("n"), "claim_sha256": e.get("claim_sha256"), "prev_entry_sha256": prev}
        for k in ("schema", "created_at"):
            if isinstance(e.get(k), str):
                body[k] = e[k]
        h = sha(canon(body))
        if bad is None and (e.get("prev_entry_sha256") != prev or e.get("entry_sha256") != h):
            bad = e.get("n") if e.get("n") is not None else len(links) + 1
        links.append(h)
        prev = h
    return links, bad


def held(r):
    """an earlier night in history.json that held: it ran, every step held, and it says what it graded and against what"""
    return (isinstance(r, dict) and r.get("status") == "ran" and r.get("ok") is True and _int(r.get("graded"))
            and isinstance(r.get("head_compared"), str))


def against_earlier(rows, links, graded=None):
    """Tonight's export, recomputed, against the head each earlier night graded, for the nights that held; and tonight's
    checkpoint (graded: the entries it covers) against the entries each of those nights graded."""
    out = {"nights": 0, "agree": 0, "disagree": []}
    for r in rows or []:
        if not held(r):
            continue
        out["nights"] += 1
        n = r["graded"]
        if n > len(links):
            out["disagree"].append({"at": r.get("at"), "graded": n, "head_compared": r["head_compared"],
                                    "why": "tonight's export has %d entries" % len(links)})
            continue
        m = marker_line(n, links[n - 1])["entry_sha256"]
        if m != r["head_compared"]:
            out["disagree"].append({"at": r.get("at"), "graded": n, "head_compared": r["head_compared"], "export_marker": m,
                                    "why": "tonight's export does not reach the head that night compared"})
        elif _int(graded) and graded < n:
            out["disagree"].append({"at": r.get("at"), "graded": n, "head_compared": r["head_compared"], "tonight_graded": graded,
                                    "why": "tonight's newest confirmed checkpoint covers 1..%d, fewer than the 1..%d that night graded"
                                           % (graded, n)})
        else:
            out["agree"] += 1
    out["disagree"] = out["disagree"][:20]
    return out


def _int(x, lo=1):
    return isinstance(x, int) and not isinstance(x, bool) and x >= lo


def _get(get, url, limit, what):
    try:
        s, b = get(url, limit)
    except NetError as e:
        raise _Stop("%s could not be fetched: %s" % (what, str(e)[:200]))
    if s != 200:
        raise _Stop("%s could not be fetched (HTTP %d)" % (what, s))
    return b


def read_export(b):
    """-> (raw entry lines, parsed entries, the parsed last line or None, problems). The last line is the end record
    (jidec-head-v1, or jidec-chain-broken-v1 when the ledger could not walk its chain); every line before it an entry."""
    raw = b.split(b"\n")
    if raw and raw[-1] == b"":
        raw.pop()
    problems, parsed = [], []
    for i, line in enumerate(raw):
        try:
            v = FD.parse_json(line)
        except FD._Bad:
            v = None
        if not isinstance(v, dict):
            problems.append("line %d is not a JSON object" % (i + 1))
            v = {}
        parsed.append(v)
    end = None
    if parsed and parsed[-1].get("schema") in (MARKER, "jidec-chain-broken-v1"):
        end = parsed.pop()
        raw = raw[:-1]
        if end.get("schema") != MARKER:
            problems.append("the export ends in jidec-chain-broken-v1: the ledger could not walk its own chain (broken_at %r)"
                            % end.get("broken_at"))
    else:
        problems.append("the export does not end in a jidec-head-v1 end marker")
    for i, e in enumerate(parsed):
        if e.get("n") != i + 1:
            problems.append("line %d carries n=%r" % (i + 1, e.get("n")))
            break
    return raw, parsed, end, problems[:20]


def hold(m, kind, lh, links):
    """One ledger head written inside entry m (the ledger_head of a checkpoint or a witness batch), held against the
    export's links, recomputed. -> ("agree" | "disagree" | "said_broken", what the row keeps of it)"""
    d = {"entry": m, "kind": kind}
    if isinstance(lh, dict) and "broken_at" in lh and "entry_sha256" not in lh:
        d.update(broken_at=lh.get("broken_at"), last_linked=lh.get("last_linked"))
        return "said_broken", d
    k = lh.get("n") if isinstance(lh, dict) else None
    marker = kind == "checkpoint" or (isinstance(lh, dict) and "marker_sha256" in lh)
    if not (isinstance(lh, dict) and lh.get("chain") == CHAIN and _int(k) and k < m
            and isinstance(lh.get("entry_sha256"), str) and H64.fullmatch(lh["entry_sha256"])
            and (not marker or (isinstance(lh.get("marker_sha256"), str) and H64.fullmatch(lh["marker_sha256"])))):
        d["why"] = "its ledger_head is not {chain: %s, n below %d, entry_sha256%s}" % (CHAIN, m, ", marker_sha256" if marker else "")
        return "disagree", d
    d["covers"] = k
    if k > len(links) or links[k - 1] != lh["entry_sha256"]:
        d["why"] = "the export, recomputed, does not reach the head it states for entries 1..%d" % k
        return "disagree", d
    if marker and lh["marker_sha256"] != marker_line(k, links[k - 1])["entry_sha256"]:
        d["why"] = "its marker_sha256 is not the end marker of the head it states"
        return "disagree", d
    return "agree", d


def walk(get, entries, links, look_back=LOOK_BACK, whole=False, floor=None):
    """Walk down from the export's last entry, reading each entry as the ledger serves it.
    -> (n, entry, record, waiting, skipped, looked, heads): the first nenrin-head-checkpoint-v1 entry with a confirmed
    proof among the last look_back entries ((None, None, None, ...) when there is none in reach), the checkpoints newer
    than it still waiting, the entries the walk could not use, how many it looked at, and what it read (heads: every entry
    read held against the export, every ledger head written inside one held against the export's links). The walk goes to
    the bottom of the look-back; with floor (the most entries an earlier night that held graded) below it, on to entry
    floor + 1, so that every entry above the heads the earlier nights compared is read; with whole to entry 1. Three
    entries in a row that cannot be fetched, or its time, end it early."""
    top = len(entries)
    window = max(0, top - look_back)          # entries above this one are within the look-back
    deeper = not whole and _int(floor, 0) and floor < window
    bottom = 0 if whole else floor if deeper else window
    seconds = WHOLE_WALK_SECONDS if whole or deeper else WALK_SECONDS
    used, waiting, skipped, looked, misses, until = None, [], [], 0, 0, time.time() + seconds
    heads = {"walked": {"from": top, "to": None, "whole_export": bool(whole), "complete": False, "stopped": None},
             "entries_read": 0, "entries_agree": 0, "entries_disagree": [],
             "seen": 0, "agree": 0, "confirmed": 0, "disagree": [], "said_broken": []}
    if deeper:
        heads["walked"]["above_earlier_graded"] = floor   # below the look-back: every entry above what earlier nights graded
    for n in range(top, bottom, -1):
        if used is None and n <= window:
            break                              # no confirmed checkpoint within the look-back: nothing to grade against
        if misses >= 3 or time.time() > until:
            why = "three entries in a row could not be fetched" if misses >= 3 else "%d seconds" % seconds
            skipped.append({"entry": n, "why": "the walk stopped here: " + why})
            heads["walked"]["stopped"] = "at entry %d: %s" % (n, why)
            break
        looked += 1
        heads["walked"]["to"] = n
        try:
            s, b = get(LEDGER + "/ledger/%d?format=json" % n, LIMITS["entry"])
        except NetError as e:
            misses += 1
            skipped.append({"entry": n, "why": "not fetched: " + str(e)[:120]})
            continue
        misses = 0
        if s != 200:
            skipped.append({"entry": n, "why": "HTTP %d" % s})
            continue
        try:
            e = FD.parse_json(b)
        except FD._Bad:
            e = None
        rc = e.get("record_canonical") if isinstance(e, dict) else None
        if not isinstance(rc, str) or not isinstance(e.get("claim_sha256"), str):
            skipped.append({"entry": n, "why": "the entry is not a ledger entry object"})
            continue
        heads["entries_read"] += 1
        why = ("its record bytes do not hash to its claim_sha256" if sha(rc) != e["claim_sha256"] else
               "the export carries another claim_sha256 at this n" if entries[n - 1].get("claim_sha256") != e["claim_sha256"] else None)
        if why:
            skipped.append({"entry": n, "why": why})
            heads["entries_disagree"].append({"entry": n, "why": why})
            continue
        heads["entries_agree"] += 1
        try:
            rec = FD.parse_json(rc)
        except FD._Bad:
            rec = None
        kind = HEADS.get(rec.get("schema")) if isinstance(rec, dict) else None
        if not kind or (kind == "witness batch" and "ledger_head" not in rec):
            continue                           # witness batches before 2026-09-28 carry no head
        confirmed = e.get("ots_status") == "confirmed" and _int(e.get("bitcoin_block"))
        verdict, d = hold(n, kind, rec.get("ledger_head"), links)
        d["ots_status"] = e.get("ots_status")
        if verdict == "said_broken":
            heads["said_broken"].append(d)
        else:
            heads["seen"] += 1
            if verdict == "agree":
                heads["agree"] += 1
                heads["confirmed"] += bool(confirmed)
            else:
                heads["disagree"].append(d)
        if kind == "checkpoint" and used is None:
            if confirmed:
                used = (n, e, rec)
            else:
                waiting.append({"entry": n, "ots_status": e.get("ots_status")})
    else:
        heads["walked"]["complete"] = heads["entries_read"] == top - bottom
    for k in ("entries_disagree", "disagree", "said_broken"):
        heads[k] = heads[k][:20]
    c, e, rec = used or (None, None, None)
    return c, e, rec, waiting, skipped, looked, heads


def anchor(get, header_get, n, e):
    """The proof of entry n commits its claim to the block it names; two explorers serve that block's header."""
    out = {"proof": None, "bitcoin_block": e["bitcoin_block"], "merkle_root": None, "bitcoin_header": None, "block_hash": None}
    try:
        s, b = get(LEDGER + "/ledger/%d/ots" % n, LIMITS["ots"])
    except NetError as x:
        out["proof"] = "not fetched: " + str(x)[:120]
        return out
    if s != 200:
        out["proof"] = "ots_http_%d" % s
        return out
    out["proof_sha256"] = sha(b)
    try:
        digest, btc, _pending = FD.ots_parse(b)
    except FD._Bad as x:
        out["proof"] = "ots_parse: %s" % x
        return out
    if digest.hex() != e["claim_sha256"]:
        out["proof"] = "ots_digest_is_not_the_entry"
        return out
    hit = [m for (h, m) in btc if h == e["bitcoin_block"]]
    if not btc:
        out["proof"] = "ots_no_bitcoin_attestation"
        return out
    if not hit:
        out["proof"] = "ots_height_is_not_the_entry_block"
        return out
    out["proof"], out["merkle_root"] = "ok", hit[0]
    try:
        state, code, facts = FD.bitcoin_header(e["bitcoin_block"], hit[0], header_get or FD.http_get_explorer)
    except FD.NetError as x:
        out["bitcoin_header"] = "not checked: " + str(x)[:120]
        return out
    out["bitcoin_header"] = "ok" if state == "ok" else code
    if facts:
        out["block_hash"], out["explorers"] = facts["block_hash"], facts["explorers"]
        out["header_time"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(int.from_bytes(bytes.fromhex(facts["header"])[68:72], "little")))
    return out


def check(python, checker, adapter, log, head, mutation=None, timeout=CHECK_TIMEOUT):
    """Run the checker once. -> (exit code, report dict or None, stderr tail). Its own directory, its own HOME, -I."""
    d = os.path.dirname(log)
    argv = [python, "-I", checker, "--log", log, "--adapter", adapter, "--expect-head", head, "--json"]
    if mutation:
        argv += ["--mutate", mutation]
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": d, "TMPDIR": d, "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"}
    try:
        r = subprocess.run(argv, cwd=d, env=env, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return 124, None, "timeout after %ds" % timeout
    except OSError as x:
        return 127, None, str(x)[:300]
    try:
        rep = json.loads(r.stdout)
    except ValueError:
        rep = None
    return r.returncode, rep if isinstance(rep, dict) else None, (r.stderr or "").strip()[-300:]


def _level(rep, k):
    v = rep.get(k) if isinstance(rep, dict) else None
    return v if _int(v, 0) else None


def grade_of(rep):
    s, a = _level(rep, "structural_level"), _level(rep, "attested_level")
    return None if s is None or a is None else "structural L%d, attested L%d" % (s, a)


def _requirements(rep):
    """{requirement id: {status, class, note}} as the checker printed them (notes cut at 300 characters)"""
    req = rep.get("requirements") if isinstance(rep, dict) else None
    if not isinstance(req, dict):
        return {}
    return {k: {"status": v.get("status"), "class": v.get("class"), "note": str(v.get("note") or "")[:300]}
            for k, v in sorted(req.items()) if isinstance(v, dict)}


def run(get=http_get, header_get=None, python=None, checker=None, adapter=None, out_dir=None, look_back=LOOK_BACK, earlier=None):
    """-> the ledger_vlc row for board.json. earlier: history.json's ledger_vlc rows (read before any outside code runs).
    Nothing outside makes it raise: a step that could not be done is a not run row with the reason, and a fault in this
    file is reported the same way rather than stopping the board."""
    checker, adapter = checker or CHECKER, adapter or ADAPTER
    t0 = time.time()
    row = {"schema": SCHEMA, "status": "not_run", "ok": False, "reason": None,
           "checker": {k: checker[k] for k in ("name", "version", "author", "license", "url", "sha256", "module", "module_sha256") if k in checker},
           "adapter": dict(adapter), "export": None, "checkpoint": None, "stamped_heads": None, "anchor": None, "cut": None,
           "grade": None, "controls": None, "earlier": None}
    try:
        with tempfile.TemporaryDirectory(prefix="tsunagi-ledger-") as t:
            _run(row, t, get, header_get, python or sys.executable, checker, adapter, out_dir, look_back, earlier)
    except _Stop as x:
        row["reason"] = str(x)
    except Exception as x:   # a fault in this file must not stop the board; it is written down instead
        row["reason"] = "the board's ledger step failed: %s: %s" % (type(x).__name__, str(x)[:200])
    row["seconds"] = round(time.time() - t0, 1)
    return row


def _run(row, t, get, header_get, python, checker, adapter, out_dir, look_back, earlier):
    keep = {}
    wheel = _get(get, checker["url"], LIMITS["wheel"], "the checker wheel")
    if sha(wheel) != checker["sha256"]:
        raise _Stop("the checker wheel is not the pinned one (sha256 %s)" % sha(wheel))
    try:
        mod = zipfile.ZipFile(io.BytesIO(wheel)).read(checker["module"])
    except (zipfile.BadZipFile, KeyError) as x:
        raise _Stop("the checker wheel has no %s: %s" % (checker["module"], x))
    if sha(mod) != checker["module_sha256"]:
        raise _Stop("%s in the wheel is not the pinned one" % checker["module"])
    ad = _get(get, adapter["url"], LIMITS["adapter"], "the adapter")
    if sha(ad) != adapter["sha256"]:
        raise _Stop("the adapter is not the pinned one (sha256 %s)" % sha(ad))
    exp = _get(get, EXPORT_URL, LIMITS["export"], "the export")
    keep["export.jsonl"], keep["adapter.json"] = exp, ad
    raw, entries, end, problems = read_export(exp)
    links, bad = recompute(entries)
    if bad is not None:
        problems.append("the export's own links break at n=%s: its prev_entry_sha256 or entry_sha256 is not the recomputed one" % bad)
    if isinstance(end, dict) and end.get("schema") == MARKER and links:
        own = marker_line(len(entries), links[-1])
        if any(end.get(k) != own[k] for k in own):
            problems.append("the export's end marker is not the marker of its own last entry, recomputed")
    row["export"] = {"url": EXPORT_URL, "sha256": sha(exp), "bytes": len(exp), "entries": len(entries),
                     "end": None if end is None else {k: end.get(k) for k in ("schema", "n", "head", "entry_sha256", "broken_at")
                                                       if k in end},
                     "recomputed_head": links[-1] if links else None, "problems": problems[:20]}
    if not entries:
        raise _Stop("the export carries no entries")
    graded = [r["graded"] for r in (earlier or []) if held(r)]
    first = not graded            # no earlier night to compare with: the walk reads every entry
    c, e, rec, waiting, skipped, looked, heads = walk(get, entries, links, look_back, whole=first,
                                                      floor=None if first else max(graded))
    row["checkpoint"] = {"entry": c, "looked_at": looked, "waiting": waiting, "skipped": skipped[:20]}
    row["stamped_heads"] = heads
    if c is None:
        _write(out_dir, keep)
        raise _Stop("no %s entry with a confirmed OpenTimestamps proof among entries %d..%d"
                    % (CHECKPOINT, max(1, len(entries) - look_back + 1), len(entries)))
    lh = rec.get("ledger_head")
    row["checkpoint"].update({"claim_sha256": e["claim_sha256"], "anchored_at": rec.get("anchored_at"), "ledger_head": lh,
                              "ots_status": e.get("ots_status"), "bitcoin_block": e.get("bitcoin_block"),
                              "block_time": e.get("block_time")})
    if not (isinstance(lh, dict) and lh.get("chain") == CHAIN and _int(lh.get("n")) and lh["n"] < c
            and isinstance(lh.get("entry_sha256"), str) and H64.fullmatch(lh["entry_sha256"])
            and isinstance(lh.get("marker_sha256"), str) and H64.fullmatch(lh["marker_sha256"])):
        _write(out_dir, keep)
        raise _Stop("checkpoint entry %d: ledger_head is not {chain: %s, n below %d, entry_sha256, marker_sha256}" % (c, CHAIN, c))
    row["anchor"] = anchor(get, header_get, c, e)
    n, eh, mh = lh["n"], lh["entry_sha256"], lh["marker_sha256"]
    m = marker_line(n, eh)
    cut = b"\n".join(raw[:n] + [json.dumps(m, separators=(",", ":")).encode("ascii")]) + b"\n"
    keep["cut.jsonl"] = cut
    row["cut"] = {"entries": n, "sha256": sha(cut), "marker_sha256": m["entry_sha256"],
                  "marker_is_the_checkpoint_s": m["entry_sha256"] == mh,
                  "entry_n_is_the_checkpoint_s": links[n - 1] == eh}
    paths = {}
    for name, body in (("conformance.py", mod), ("adapter.json", ad), ("cut.jsonl", cut)):
        paths[name] = os.path.join(t, name)
        with open(paths[name], "wb") as f:
            f.write(body)
    code, rep, tail = check(python, paths["conformance.py"], paths["adapter.json"], paths["cut.jsonl"], mh)
    keep["report.json"] = json.dumps(rep, indent=2).encode() if rep is not None else None
    g = {"exit": code, "head_compared": mh, "grade": grade_of(rep), "structural_level": _level(rep, "structural_level"),
         "attested_level": _level(rep, "attested_level"), "spec": (rep or {}).get("spec"),
         "adapter_sha256": (rep or {}).get("adapter_sha256"), "head_reported": (rep or {}).get("head"),
         "requirements": _requirements(rep)}
    if rep is None or code != 0:
        g["stderr_tail"] = tail
        if isinstance(rep, dict) and rep.get("error"):
            g["error"] = "%s: %s" % (rep.get("error"), str(rep.get("message"))[:200])
    row["grade"] = g
    ctl = {}
    for mu in CONTROLS:
        cc, cr, ct = check(python, paths["conformance.py"], paths["adapter.json"], paths["cut.jsonl"], mh, mu)
        keep["report_%s.json" % mu] = json.dumps(cr, indent=2).encode() if cr is not None else None
        fails = [k for k, v in _requirements(cr).items() if k.startswith("VLC-L1-") and v["status"] != "PASS"]
        ctl[mu] = {"exit": cc, "structural_level": _level(cr, "structural_level"), "attested_level": _level(cr, "attested_level"),
                   "fails_at_l1": fails}
    row["controls"] = ctl
    row["controls_ok"] = all(v["exit"] == 0 and v["structural_level"] == 0 and v["attested_level"] == 0 for v in ctl.values())
    row["earlier"] = against_earlier(earlier, links, n)
    row["status"] = "ran"
    a, sh = row["anchor"], row["stamped_heads"]
    row["ok"] = bool(code == 0 and rep is not None and g["structural_level"] and g["attested_level"]
                     and g["head_reported"] == mh and g["adapter_sha256"] == adapter["sha256"]
                     and a["proof"] == "ok" and a["bitcoin_header"] == "ok"
                     and row["cut"]["marker_is_the_checkpoint_s"] and row["cut"]["entry_n_is_the_checkpoint_s"]
                     and row["controls_ok"] and not row["export"]["problems"] and not row["earlier"]["disagree"]
                     and sh["walked"]["complete"] and not sh["entries_disagree"] and not sh["disagree"])
    _write(out_dir, keep)


def _write(out_dir, keep):
    if not out_dir:
        return
    os.makedirs(out_dir, exist_ok=True)
    for k, v in keep.items():
        if v is not None:
            with open(os.path.join(out_dir, k), "wb") as f:
                f.write(v)


def _walked(sh):
    w = sh.get("walked") or {}
    return "%s..%s" % (w.get("from"), w.get("to")) + (" (every entry)" if w.get("whole_export") else
                                                      " (every entry above the 1..%s an earlier night graded)" % w["above_earlier_graded"]
                                                      if _int(w.get("above_earlier_graded"), 0) else "")


def summary(row):
    if row.get("status") != "ran":
        return "ledger (VLC-1): not run: %s" % row.get("reason")
    c, g, x, sh = row["checkpoint"], row["grade"], row["controls"], row.get("stamped_heads") or {}
    return ("ledger (VLC-1): entries 1..%d of %d against the head in checkpoint entry %d (Bitcoin block %s, proof %s, header %s): %s; "
            "controls %s; entries read %s: %d of %d the export's, heads inside them reached %d of %d%s; %s"
            % (row["cut"]["entries"], row["export"]["entries"], c["entry"], c["bitcoin_block"],
               row["anchor"]["proof"], row["anchor"]["bitcoin_header"], g["grade"] or "no grade (exit %s)" % g["exit"],
               ", ".join("%s L%s" % (k, v["attested_level"]) for k, v in x.items()), _walked(sh), sh.get("entries_agree", 0),
               sh.get("entries_read", 0), sh.get("agree", 0), sh.get("seen", 0),
               "" if (sh.get("walked") or {}).get("complete") else ", the walk did not read every entry of its range",
               "ok" if row["ok"] else "NOT ok"))


def history_row(day, row):
    """One night, as history.json keeps it (the last HISTORY_KEEP nights)."""
    ran = row.get("status") == "ran"
    return {"at": day, "status": row.get("status"), "ok": bool(row.get("ok")),
            "export_sha256": (row.get("export") or {}).get("sha256"), "entries": (row.get("export") or {}).get("entries"),
            "graded": (row.get("cut") or {}).get("entries"), "head_compared": (row.get("grade") or {}).get("head_compared"),
            "grade": (row.get("grade") or {}).get("grade"), "checkpoint": (row.get("checkpoint") or {}).get("entry") if ran else None,
            "bitcoin_block": (row.get("checkpoint") or {}).get("bitcoin_block") if ran else None,
            "reason": None if ran else row.get("reason")}


def _h(x, n=16):
    return "`%s...`" % x[:n] if isinstance(x, str) and x else ""


def to_md(row, hist=None, show=7):
    ck, ad = row.get("checker") or CHECKER, row.get("adapter") or ADAPTER
    L = ["This project's own ledger (JIDEC, `ledger.horizonshield.dev`), read every night by a checker this project did "
         "not write: %s %s of [VLC-1](%s) (%s, %s), the PyPI wheel checked against its sha256 `%s...`, under the adapter its "
         "author wrote for this ledger (`%s` at `%s`, sha256 `%s...`). The head the check compares against is not read from "
         "the export: it is the end-marker hash in the newest checkpoint entry whose OpenTimestamps proof is in a Bitcoin "
         "block, and the board checks that proof and the block header itself, with two block explorers. Entries after "
         "that checkpoint wait for the next one. Generated by `tools/tsunagi/ledger_vlc.py`."
         % (ck["name"], ck["version"], ad["repo"], ck.get("author", ""), ck.get("license", ""), ck["sha256"][:16],
            ad["path"], ad["commit"][:8], ad["sha256"][:16]), ""]
    if row.get("status") != "ran":
        L.append("Tonight: not run: %s" % row.get("reason"))
    else:
        c, g, a, x = row["checkpoint"], row["grade"], row["anchor"], row["controls"]
        hdr = "header checked with %s" % " and ".join(a.get("explorers") or []) if a.get("bitcoin_header") == "ok" else \
            "header: %s" % a.get("bitcoin_header")
        L.append("Tonight: entries 1..%d of the %d in the export (sha256 %s) against the head in checkpoint entry %d "
                 "(Bitcoin block %s, proof: %s, %s): **%s**. Head compared: %s. Controls (Annex A mutations of the same "
                 "log): %s. %s"
                 % (row["cut"]["entries"], row["export"]["entries"], _h(row["export"]["sha256"]), c["entry"], c["bitcoin_block"],
                    a.get("proof"), hdr, g.get("grade") or "no grade (exit %s)" % g.get("exit"), _h(g.get("head_compared")),
                    ", ".join("%s L%s" % (k, v.get("attested_level")) for k, v in x.items()),
                    "Every step held." if row.get("ok") else "**Not every step held**; board.json has each one."))
        sh = row.get("stamped_heads") or {}
        if sh:
            w = sh.get("walked") or {}
            L.append("")
            L.append("The walk read entries %s%s: %d of the %d it read are the export's%s. The export, recomputed, reaches %d of "
                     "the %d ledger heads written inside them (checkpoints and witness batches; the ledger says %d of those reached "
                     "are confirmed in Bitcoin, and only the used checkpoint's proof is checked here)%s.%s"
                     % (_walked(sh), "" if w.get("complete") else " and **did not read every entry of its range** (%s)"
                        % (w.get("stopped") or "entries not served"), sh.get("entries_agree", 0), sh.get("entries_read", 0),
                        "" if not sh.get("entries_disagree") else "; **not the export's**: " + ", ".join(
                            "entry %s (%s)" % (d["entry"], d["why"]) for d in sh["entries_disagree"]),
                        sh.get("agree", 0), sh.get("seen", 0), sh.get("confirmed", 0),
                        "" if not sh.get("disagree") else "; **not reached**: " + ", ".join(
                            "entry %s, %s (%s)" % (d["entry"], d["kind"], d["why"]) for d in sh["disagree"]),
                        "" if not sh.get("said_broken") else " Witness batches that said the chain was broken when they were "
                        "written: " + ", ".join("entry %s (broken at %s)" % (d["entry"], d.get("broken_at")) for d in sh["said_broken"]) + "."))
        ea = row.get("earlier") or {}
        if ea.get("nights"):
            L.append("")
            L.append("Tonight's export, recomputed, holds against %d of the %d earlier nights that held (it reaches the head each "
                     "of them compared, and tonight's checkpoint covers at least the entries each graded)%s."
                     % (ea["agree"], ea["nights"], "" if not ea["disagree"] else
                        "; it does **not** hold against: " + "; ".join("%s (1..%s: %s)" % ((d.get("at") or "")[:10], d.get("graded"), d.get("why"))
                                                                        for d in ea["disagree"])))
        if c.get("waiting"):
            L.append("")
            L.append("Newer checkpoints still waiting for Bitcoin: " + ", ".join("entry %d (%s)" % (w["entry"], w["ots_status"]) for w in c["waiting"]) + ".")
        lv = g.get("attested_level")
        if isinstance(lv, int):
            nxt = [(k, v["note"]) for k, v in sorted(g.get("requirements", {}).items())
                   if k.startswith("VLC-L%d-" % (lv + 1)) and v["status"] != "PASS" and v["note"] and v["note"] != "not evaluated"]
            if nxt:
                L.append("")
                L.append("What the checker says stops L%d: %s." % (lv + 1, "; ".join("%s %s" % (k, n) for k, n in nxt)))
    rows = [r for r in (hist or []) if isinstance(r, dict)][-show:][::-1]
    if rows:
        L += ["", "| night (UTC) | export sha256 | entries | graded | head compared | checkpoint | Bitcoin block | grade |",
              "|---|---|---|---|---|---|---|---|"]
        for r in rows:
            if r.get("status") != "ran":
                L.append("| %s | %s | %s | not run | | | | %s |" % ((r.get("at") or "")[:10], _h(r.get("export_sha256"), 8),
                                                              r.get("entries") or "", str(r.get("reason") or "")[:80].replace("|", "\\|")))
            else:
                L.append("| %s | %s | %s | 1..%s | %s | %s | %s | %s%s |" % ((r.get("at") or "")[:10], _h(r.get("export_sha256"), 8),
                         r.get("entries"), r.get("graded"), _h(r.get("head_compared"), 8), r.get("checkpoint"), r.get("bitcoin_block"),
                         r.get("grade"), "" if r.get("ok") else " (not every step held)"))
    return L


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, help="writes ledger_vlc.json, the export, the adapter, the cut log and the reports")
    a = ap.parse_args(argv)
    row = run(out_dir=a.out)
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "ledger_vlc.json"), "w", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    print(summary(row))
    return 0 if row["ok"] else (1 if row["status"] == "ran" else 3)


if __name__ == "__main__":
    sys.exit(main())
