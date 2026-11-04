#!/usr/bin/env python3
"""nenrin-survive-v0: rebuild yesterday's ledger history without the operator.

The claim this tests: if The HORIZONs Co., Ltd. and every host it runs disappeared tomorrow, a stranger could
still rebuild the JIDEC ledger from copies held elsewhere and check it against Bitcoin alone.

A claim like that is worth nothing until someone tries it on a schedule and publishes the result. This file is
that attempt. It never talks to an operator host: every URL is checked against a list of operator names and a
short allowlist of custodians and block explorers before any connection is made, and in CI the operator names
are also sinkholed in /etc/hosts and a canary connection must fail.

    python3 survive.py drill --source swh    --out report.json   # copy from Software Heritage (preferred)
    python3 survive.py drill --source github --out report.json   # copy from a GitHub tarball (operator controlled)
    python3 survive.py drill --source dir:/path/to/mirror --out report.json   # your own copy (mirror-v0 layout)
    python3 survive.py precook --out drills/swh-cook-ahead.json   # ask the vault now for the next drill's copy
    python3 survive.py drill --source swh --ahead drills/swh-cook-ahead.json --out report.json

What is checked, all from the copy plus two public block explorers:
  1. digests: sha256 of every ledger/<n>.raw equals the claim_sha256 of ledger/<n>.json
  2. chain: jidec-chain-v1 is recomputed over entries 1..N from the copy alone, and every stamped head a
     checkpoint or batch carries (ledger_head: n, entry_sha256, marker_sha256) must match the recomputation
  3. anchors: every ledger/<n>.ots is walked with the OpenTimestamps library; each Bitcoin attestation's
     merkle root must equal the block header's, as served by two explorers that must agree with each other

Dependencies: Python 3.8+, opentimestamps (pinned in requirements.txt). Nothing else.
"""
import argparse, datetime, hashlib, io, json, os, socket, sys, tarfile, time, urllib.error, urllib.parse, urllib.request

SCHEMA = "nenrin-survive-drill-v0"
VERSION = "0.1.0"
REPO_ORIGIN = "https://github.com/ogasurfproject-jpg/horizon-shield"
KEPT_PATH = "workers/hs-ledger/nenrin/survive-v0/kept"
OPERATOR_SUFFIXES = ("horizonshield.dev", "the-horizons-innovation.com", "oga-surf-project.workers.dev")
ALLOWED_HOSTS = ("archive.softwareheritage.org", "codeload.github.com", "blockstream.info", "mempool.space")
EXPLORERS = ("https://blockstream.info/api", "https://mempool.space/api")
CANARY_HOST = "ledger.horizonshield.dev"
CHAIN_ROOT = "0" * 64
UA = "nenrin-survive-v0/" + VERSION + " (+" + REPO_ORIGIN + ")"


class Refused(Exception):
    pass


def host_of(url):
    return (urllib.parse.urlsplit(url).hostname or "").lower().rstrip(".")


def guard(url):
    """Refuse operator hosts by name, and anything that is not an allowed custodian or explorer."""
    h = host_of(url)
    if not url.startswith("https://"):
        raise Refused("not https: " + url)
    for s in OPERATOR_SUFFIXES:
        if h == s or h.endswith("." + s):
            raise Refused("operator host refused: " + h)
    if h not in ALLOWED_HOSTS:
        raise Refused("host not on the custodian/explorer allowlist: " + h)
    return url


def http_get(url, timeout=60, data=None, method=None):
    guard(url)
    req = urllib.request.Request(url, data=data, method=method, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


def sha256hex(b):
    return hashlib.sha256(b).hexdigest()


# ---- canonical form and chain, identical to workers/hs-ledger/src/chain_v1.mjs --------------------------------
def canon(v):
    return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def chain_body(entry, prev):
    b = {"n": entry["n"], "claim_sha256": entry["claim_sha256"], "prev_entry_sha256": prev}
    if isinstance(entry.get("schema"), str):
        b["schema"] = entry["schema"]
    if isinstance(entry.get("created_at"), str):
        b["created_at"] = entry["created_at"]
    return b


def entry_sha(entry, prev):
    return sha256hex(canon(chain_body(entry, prev)).encode("ascii"))


def marker_sha(n, head):
    return sha256hex(canon({"n": n, "schema": "jidec-head-v1", "prev_entry_sha256": head, "head": head}).encode("ascii"))


# ---- obtaining a copy without the operator --------------------------------------------------------------------
def copy_from_dir(path):
    return os.path.abspath(path), {"custodian": "local", "path": os.path.abspath(path), "operator_controlled": None}


def _extract_subdir(tgz_bytes, want_suffix, dest):
    os.makedirs(dest, exist_ok=True)
    root = None
    with tarfile.open(fileobj=io.BytesIO(tgz_bytes), mode="r:*") as tf:
        for m in tf.getmembers():
            name = m.name.lstrip("./")
            i = name.find(want_suffix)
            if i < 0 or not (m.isfile() or m.isdir()):
                continue
            rel = name[i + len(want_suffix):].lstrip("/")
            if ".." in rel.split("/"):
                continue
            out = os.path.join(dest, rel)
            if m.isdir():
                os.makedirs(out, exist_ok=True)
                continue
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with open(out, "wb") as f:
                f.write(tf.extractfile(m).read())
            root = dest
    if root is None:
        raise RuntimeError("the archive does not contain " + want_suffix)
    return dest


def copy_from_github(work):
    url = "https://codeload.github.com/ogasurfproject-jpg/horizon-shield/tar.gz/refs/heads/main"
    st, body = http_get(url, timeout=180)
    d = _extract_subdir(body, KEPT_PATH, os.path.join(work, "kept"))
    return d, {"custodian": "github", "url": url, "archive_sha256": sha256hex(body),
               "operator_controlled": True,
               "note": "the operator can delete this account; this source proves the copy's form, not its survival"}


SWH_API = "https://archive.softwareheritage.org/api/1"
# 2026-11-04: 48 h and three were too few. The drill of 11/04 saw only the request of 11/03 (still "new"); the
# request of 11/02 was found done at 12:46 UTC that day, at most 49 h after it was asked for, past the 48 h. Four
# days and five requests keep such a copy in reach; the report names its day either way.
AHEAD_MAX_AGE_S = 96 * 3600
AHEAD_KEEP = 5  # precook requests kept in the record (newest first), so a copy that finishes days late is still found


def swh_latest_kept(get=http_get):
    """The kept/ directory of the latest Software Heritage visit of the repository, as a swhid and its provenance."""
    o = urllib.parse.quote(REPO_ORIGIN, safe="")
    st, b = get("%s/origin/%s/visit/latest/?require_snapshot=true" % (SWH_API, o))
    visit = json.loads(b)
    snap_id = visit["snapshot"]
    st, b = get("%s/snapshot/%s/" % (SWH_API, snap_id))
    snap = json.loads(b)
    br = snap["branches"].get("HEAD") or snap["branches"].get("refs/heads/main")
    if br and br.get("target_type") == "alias":
        br = snap["branches"][br["target"]]
    rev = br["target"]
    st, b = get("%s/revision/%s/" % (SWH_API, rev))
    rv = json.loads(b)
    root_dir = rv["directory"]
    st, b = get("%s/directory/%s/%s/" % (SWH_API, root_dir, KEPT_PATH))
    ent = json.loads(b)
    if ent.get("type") != "dir":
        raise RuntimeError("%s is not a directory in the archived revision" % KEPT_PATH)
    return {"visit_date": visit.get("date"), "snapshot": snap_id, "revision": rev,
            "revision_date": rv.get("committer_date") or rv.get("date"), "directory": "swh:1:dir:" + ent["target"]}


BODY_KEEP = 600  # bytes of a vault answer kept in a record, as text


class VaultNotReady(RuntimeError):
    """The vault did not hand over a copy. Carries what each vault call answered, for the report."""
    def __init__(self, msg, trail):
        RuntimeError.__init__(self, msg)
        self.trail = trail


def _vault_call(get, url, data=None, method=None):
    """One vault call. An HTTP error status is returned as (code, body) instead of raised, so its code and body
    reach the record; a network error still raises."""
    try:
        st, b = get(url, data=data, method=method)
    except urllib.error.HTTPError as e:
        try:
            b = e.read() or b""
        except Exception:
            b = b""
        st = e.code
    try:
        info = json.loads(b)
        if not isinstance(info, dict):
            info = {}
    except (TypeError, ValueError):
        info = {}
    ans = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "method": method or "GET", "url": url,
           "http_status": st, "vault_id": info.get("id"), "status": info.get("status"),
           "body": (b or b"")[:BODY_KEEP].decode("utf-8", "replace"), "body_sha256": sha256hex(b or b"")}
    return st, b, info, ans


def _swh_fetch(work, info, cook, get=http_get):
    fu = info.get("fetch_url") or (cook + "raw/")
    if not fu.startswith("https://"):
        fu = "https://archive.softwareheritage.org" + fu
    st, tgz = get(fu, timeout=300)
    d = os.path.join(work, "kept")
    os.makedirs(d, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(tgz), mode="r:*") as tf:
        for m in tf.getmembers():
            parts = m.name.split("/", 1)
            if len(parts) < 2 or not m.isfile() or ".." in parts[1].split("/"):
                continue
            out = os.path.join(d, parts[1])
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with open(out, "wb") as f:
                f.write(tf.extractfile(m).read())
    return d, sha256hex(tgz)


AHEAD_FIELDS = ("directory", "requested_at", "visit_date", "snapshot", "revision", "revision_date", "status_at_request", "answer")


def _utc(ts):
    try:
        return time.mktime(time.strptime(ts or "", "%Y-%m-%dT%H:%M:%SZ")) - time.timezone
    except (TypeError, ValueError):
        return None


def _ahead_list(path):
    """The precook requests in a record that are under four days old, newest first, one per directory. A record of
    the 2026-10-30 form (one request, no "recent") is read as a list of one."""
    try:
        with open(path, "rb") as f:
            a = json.loads(f.read())
    except (OSError, ValueError):
        return []
    if not isinstance(a, dict):
        return []
    items = a.get("recent") if isinstance(a.get("recent"), list) else [a]
    out, seen = [], set()
    for it in items:
        if not isinstance(it, dict) or not str(it.get("directory", "")).startswith("swh:1:dir:"):
            continue
        t = _utc(it.get("requested_at"))
        # a request older than four days is not used: a precook that kept failing must not pin the drill to an old copy
        if t is None or time.time() - t > AHEAD_MAX_AGE_S:
            continue
        out.append((t, it))
    out.sort(key=lambda x: -x[0])
    res = []
    for t, it in out:
        if it["directory"] in seen:
            continue
        seen.add(it["directory"])
        res.append(it)
    return res


def _read_ahead(path):
    """The newest usable precook request in a record, or None."""
    lst = _ahead_list(path)
    return lst[0] if lst else None


def _age_any(iso, now):
    """Hours from an ISO 8601 time with an offset (as Software Heritage writes it) to now, or None."""
    if not iso:
        return None
    try:
        d = datetime.datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=datetime.timezone.utc)
        return round((now - d.timestamp()) / 3600.0, 1)
    except ValueError:
        return None


def _copy_dates(kind, src, drill_t):
    """What day the copy is from, so a copy asked for on an earlier day is never reported as today's."""
    return {"kind": kind, "directory": src.get("directory"), "precooked_at": src.get("requested_at"),
            "visit_date": src.get("visit_date"), "revision": src.get("revision"), "revision_date": src.get("revision_date"),
            "revision_age_hours": _age_any(src.get("revision_date"), drill_t),
            "is_todays_visit": kind == "latest_visit"}


def copy_from_swh(work, wait_s=1800, ahead=None, get=http_get):  # 2026-10-02: 900 s ran out once while the vault queue was busy
    # 2026-10-30. The vault often had not started cooking within the 30 minutes (status "new", 8 times from 10/02
    # to 10/29). The previous drill asks for the next copy at its end (precook below).
    # 2026-11-03. Every vault call's code, id, status and the head of its body are kept (trail), on success in the
    # provenance and on failure in the report, so a day the vault does not move can be shown from the record alone.
    # 2026-11-04. From 10/29 to 11/03 the vault took more than a day to cook each request, and finished them later
    # (10/29 to 11/01 were done by 11/03). The record now keeps the precook requests of the last two days (four since 11/04). Today's
    # latest visit is asked for first; when it is not done at once, the newest earlier request that is done is used,
    # and the report names the day of that copy (copy.kind "cooked_ahead", precooked_at, revision_date). Only when
    # none is done does the drill wait for today's, as before.
    drill_t = time.time()
    trail = {}
    cands = _ahead_list(ahead) if ahead else []
    ca = {"requested_at": cands[0].get("requested_at"), "used": False, "directory": cands[0]["directory"],
          "candidates": len(cands)} if cands else None
    lk = swh_latest_kept(get)
    trail["directory"] = lk["directory"]
    cook = "%s/vault/flat/%s/" % (SWH_API, lk["directory"])
    st, b, info, trail["post"] = _vault_call(get, cook, data=b"", method="POST")
    if info.get("status") != "done" and cands:
        trail["ahead_get"] = []
        for c in cands:
            if c["directory"] == lk["directory"]:
                continue
            cu = "%s/vault/flat/%s/" % (SWH_API, c["directory"])
            try:
                _st, _b, ci, an = _vault_call(get, cu)
            except Exception as ex:
                ci, an = {}, {"url": cu, "error": "%s: %s" % (type(ex).__name__, str(ex)[:200])}
            trail["ahead_get"].append(an)
            if ci.get("status") == "done" and 200 <= _st < 300:
                d, tsha = _swh_fetch(work, ci, cu, get)
                return d, {"custodian": "software-heritage", "visit_date": c.get("visit_date"), "snapshot": c.get("snapshot"),
                           "revision": c.get("revision"), "directory": c["directory"], "archive_sha256": tsha,
                           "operator_controlled": False,
                           "cooked_ahead": {"requested_at": c.get("requested_at"), "used": True, "candidates": len(cands)},
                           "copy": _copy_dates("cooked_ahead", c, drill_t), "todays_visit": lk, "vault": trail}
    t0 = time.time(); polls = 0
    while True:
        if info.get("status") == "done":
            break
        if not (200 <= st < 300) or info.get("status") == "failed" or time.time() - t0 > wait_s:
            trail["polls"] = polls; trail["waited_s"] = int(time.time() - t0)
            raise VaultNotReady("Software Heritage vault did not finish: " + str(info.get("status") if 200 <= st < 300 else "http %s" % st),
                                dict(trail, cooked_ahead=ca))
        time.sleep(15)
        st, b, info, trail["last_get"] = _vault_call(get, cook)
        polls += 1
    trail["polls"] = polls; trail["waited_s"] = int(time.time() - t0)
    d, tsha = _swh_fetch(work, info, cook, get)
    prov = {"custodian": "software-heritage", "visit_date": lk["visit_date"], "snapshot": lk["snapshot"],
            "revision": lk["revision"], "directory": lk["directory"], "archive_sha256": tsha, "operator_controlled": False,
            "copy": _copy_dates("latest_visit", lk, drill_t), "vault": trail}
    if ca:
        prov["cooked_ahead"] = ca
    return d, prov


def precook(out, get=http_get):
    """Ask the vault to cook the latest visit's kept/ now, for the next drill. Does not wait. The record keeps this
    request on top (the 2026-10-30 fields, for readers of that form) and, in "recent", up to AHEAD_KEEP requests
    of the last four days, newest first."""
    prev = _ahead_list(out)
    lk = swh_latest_kept(get)
    cook = "%s/vault/flat/%s/" % (SWH_API, lk["directory"])
    st, b, info, ans = _vault_call(get, cook, data=b"", method="POST")
    # 2026-11-03: the answer itself (http code, vault id, the head of the body) is kept, not only its status
    rec = dict(lk, schema="nenrin-survive-precook-v0", requested_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               status_at_request=info.get("status"), answer=ans)
    core = {k: rec.get(k) for k in AHEAD_FIELDS}
    rec["recent"] = [core] + [{k: p.get(k) for k in AHEAD_FIELDS} for p in prev if p["directory"] != lk["directory"]][:AHEAD_KEEP - 1]
    with open(out, "w", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    return rec


# ---- checks -----------------------------------------------------------------------------------------------------
def load_entries(d):
    ld = os.path.join(d, "ledger")
    out = {}
    for name in os.listdir(ld) if os.path.isdir(ld) else []:
        if name.endswith(".json") and name[:-5].isdigit():
            with open(os.path.join(ld, name), "rb") as f:
                out[int(name[:-5])] = json.loads(f.read())
    return out


def check_digests(d, entries):
    ok, bad = 0, []
    for n in sorted(entries):
        p = os.path.join(d, "ledger", "%d.raw" % n)
        if not os.path.exists(p):
            bad.append({"n": n, "why": "raw_missing"}); continue
        with open(p, "rb") as f:
            h = sha256hex(f.read())
        if h != entries[n].get("claim_sha256"):
            bad.append({"n": n, "why": "digest_mismatch", "got": h}); continue
        ok += 1
    return {"ok": ok, "failed": bad}


def find_heads(v, found):
    if isinstance(v, dict):
        lh = v.get("ledger_head")
        if isinstance(lh, dict) and isinstance(lh.get("n"), int) and isinstance(lh.get("entry_sha256"), str):
            found.append(lh)
        for x in v.values():
            find_heads(x, found)
    elif isinstance(v, list):
        for x in v:
            find_heads(x, found)


def check_chain(d, entries):
    heads, top = {}, max(entries) if entries else 0
    prev, broken = CHAIN_ROOT, None
    for n in range(1, top + 1):
        e = entries.get(n)
        if not e or e.get("n") != n or not isinstance(e.get("claim_sha256"), str):
            broken = n; break
        prev = entry_sha(e, prev)
        heads[n] = prev
    stamped, results = [], []
    for n in sorted(entries):
        p = os.path.join(d, "ledger", "%d.raw" % n)
        try:
            with open(p, "rb") as f:
                rec = json.loads(f.read())
        except Exception:
            continue
        found = []
        find_heads(rec, found)
        for lh in found:
            stamped.append((n, lh))
    for carrier, lh in stamped:
        k = lh["n"]
        r = {"carried_by": carrier, "head_n": k}
        if k not in heads:
            r["result"] = "beyond_rebuilt_range"
        elif heads[k] != lh["entry_sha256"]:
            r["result"] = "entry_sha256_mismatch"
        elif isinstance(lh.get("marker_sha256"), str) and lh["marker_sha256"] != marker_sha(k, heads[k]):
            r["result"] = "marker_mismatch"
        else:
            r["result"] = "match"
        results.append(r)
    return {"rebuilt_through": (broken - 1) if broken else top, "broken_at": broken,
            "head": heads.get((broken - 1) if broken else top),
            "stamped_heads": results,
            "stamped_heads_matched": sum(1 for r in results if r["result"] == "match")}


def header_merkle_root(height, get=http_get, cache=None):
    cache = {} if cache is None else cache
    if height in cache:
        return cache[height]
    roots = {}
    for base in EXPLORERS:
        try:
            st, h = get("%s/block-height/%d" % (base, height))
            st, b = get("%s/block/%s" % (base, h.decode().strip()))
            roots[host_of(base)] = json.loads(b)["merkle_root"]
        except Refused:
            raise
        except Exception as ex:
            roots[host_of(base)] = "error: " + type(ex).__name__
        time.sleep(0.2)
    cache[height] = roots
    return roots


def check_anchors(d, entries, get=http_get):
    from opentimestamps.core.timestamp import DetachedTimestampFile
    from opentimestamps.core.serialize import StreamDeserializationContext
    from opentimestamps.core.notary import BitcoinBlockHeaderAttestation
    confirmed, pending, failed = [], [], []
    cache = {}
    for n in sorted(entries):
        p = os.path.join(d, "ledger", "%d.ots" % n)
        if not os.path.exists(p):
            failed.append({"n": n, "why": "ots_missing"}); continue
        try:
            with open(p, "rb") as f:
                dtf = DetachedTimestampFile.deserialize(StreamDeserializationContext(f))
        except Exception as ex:
            failed.append({"n": n, "why": "ots_unparsable", "detail": type(ex).__name__}); continue
        if dtf.file_digest.hex() != entries[n].get("claim_sha256"):
            failed.append({"n": n, "why": "ots_digest_is_not_the_claim"}); continue
        btc = [(msg, a) for msg, a in dtf.timestamp.all_attestations() if isinstance(a, BitcoinBlockHeaderAttestation)]
        if not btc:
            pending.append(n); continue
        good = None
        for msg, a in sorted(btc, key=lambda x: x[1].height):
            want = msg[::-1].hex()
            roots = header_merkle_root(a.height, get, cache)
            vals = list(roots.values())
            if len(vals) == len(EXPLORERS) and all(v == want for v in vals):
                good = a.height; break
        if good is not None:
            confirmed.append({"n": n, "block": good})
        else:
            failed.append({"n": n, "why": "merkle_root_not_confirmed_by_both_explorers",
                           "heights": sorted(a.height for _, a in btc)})
    return {"confirmed": len(confirmed), "pending": pending, "failed": failed,
            "first_block": min((c["block"] for c in confirmed), default=None),
            "last_block": max((c["block"] for c in confirmed), default=None),
            "explorers": [host_of(e) for e in EXPLORERS]}


def canary():
    """In a fenced run the operator must be unreachable. Resolution to a sinkhole or a refused connect passes."""
    try:
        infos = socket.getaddrinfo(CANARY_HOST, 443, proto=socket.IPPROTO_TCP)
    except Exception:
        return {"host": CANARY_HOST, "reachable": False, "why": "does_not_resolve"}
    for fam, _, _, _, addr in infos:
        if addr[0] in ("0.0.0.0", "::", "127.0.0.1", "::1"):
            return {"host": CANARY_HOST, "reachable": False, "why": "sinkholed:" + addr[0]}
        try:
            s = socket.create_connection((addr[0], 443), timeout=5); s.close()
            return {"host": CANARY_HOST, "reachable": True, "why": "connected:" + addr[0]}
        except Exception:
            continue
    return {"host": CANARY_HOST, "reachable": False, "why": "connect_failed"}


def drill(source, work, fenced, get=http_get, ahead=None):
    started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    fence = canary() if fenced else {"checked": False}
    if fenced and fence.get("reachable"):
        return {"schema": SCHEMA, "version": VERSION, "drill_at": started, "outcome": "fence_failed", "fence": fence}
    try:
        if source == "swh":
            d, prov = copy_from_swh(work, ahead=ahead) if ahead else copy_from_swh(work)
        elif source == "github":
            d, prov = copy_from_github(work)
        elif source.startswith("dir:"):
            d, prov = copy_from_dir(source[4:])
        else:
            raise SystemExit("unknown --source " + source)
    except Refused:
        raise
    except SystemExit:
        raise
    except Exception as ex:
        # The custodian could not hand over a copy. That is a finding about availability, not about the ledger,
        # and it is reported as such rather than as a crash or as a pass.
        rep = {"schema": SCHEMA, "version": VERSION, "drill_at": started, "outcome": "custodian_unavailable",
               "source": {"requested": source}, "fence": fence,
               # VaultNotReady keeps the old prefix so history.jsonl reads the same from day to day
               "why": "%s: %s" % ("RuntimeError" if isinstance(ex, VaultNotReady) else type(ex).__name__, str(ex)[:300])}
        tr = getattr(ex, "trail", None)
        if isinstance(tr, dict):
            if tr.get("cooked_ahead"):
                rep["source"]["cooked_ahead"] = tr["cooked_ahead"]
            rep["source"]["vault"] = {k: v for k, v in tr.items() if k != "cooked_ahead"}
        rep["report_sha256"] = sha256hex(canon(rep).encode("ascii"))
        return rep
    entries = load_entries(d)
    dig = check_digests(d, entries)
    ch = check_chain(d, entries)
    an = check_anchors(d, entries, get)
    clean = (not dig["failed"] and ch["broken_at"] is None and not an["failed"]
             and all(r["result"] in ("match", "beyond_rebuilt_range") for r in ch["stamped_heads"]))
    rep = {
        "schema": SCHEMA, "version": VERSION, "drill_at": started,
        "outcome": "rebuilt" if clean and entries else ("empty_copy" if not entries else "findings"),
        "source": prov, "fence": fence,
        "entries": len(entries), "range": [min(entries), max(entries)] if entries else None,
        "digests": dig, "chain": ch, "anchors": an,
        "establishes": [
            "these ledger bytes were rebuilt from the named custodian without connecting to any operator host",
            "every digest, the jidec-chain-v1 head, the stamped heads and the Bitcoin anchors were recomputed from the copy and two public explorers",
        ],
        "does_not_establish": [
            "that any claim in the ledger is true",
            "that the copy is complete past its highest entry; the newest entries may not have reached the custodian yet",
            "that two explorers agreeing is Bitcoin consensus; check headers against your own node for that",
            "anything about entries whose proofs are still pending; they are listed, not counted",
        ],
    }
    cp = prov.get("copy") if isinstance(prov, dict) else None
    if cp:
        rep["copy"] = cp
        if cp.get("kind") != "latest_visit":
            # 2026-11-04: an earlier day's copy is named as such, never as today's
            rep["does_not_establish"].append(
                "that the copy is today's: it is the copy asked for at %s, of the revision committed at %s (%s hours before the drill); "
                "entries added after that are not in it" % (cp.get("precooked_at"), cp.get("revision_date"), cp.get("revision_age_hours")))
    rep["report_sha256"] = sha256hex(canon(rep).encode("ascii"))
    return rep


def main(argv=None):
    ap = argparse.ArgumentParser(prog="survive.py")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("drill")
    p.add_argument("--source", default="swh", help="swh | github | dir:/path")
    p.add_argument("--out", default="-")
    p.add_argument("--work", default=".survive-work")
    p.add_argument("--fenced", action="store_true", help="require the operator canary to be unreachable")
    p.add_argument("--ahead", default=None, help="swh only: a precook record; its copy is used when the vault has it ready")
    q = sub.add_parser("precook")
    q.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    if a.cmd == "precook":
        rec = precook(a.out)
        ans = rec.get("answer") or {}
        print("precook %s http=%s vault_id=%s status=%s body=%s" % (rec["directory"], ans.get("http_status"), ans.get("vault_id"),
              rec["status_at_request"], json.dumps(ans.get("body", ""))[:300]), file=sys.stderr)
        return 0
    rep = drill(a.source, a.work, a.fenced, ahead=a.ahead)
    txt = json.dumps(rep, ensure_ascii=False, indent=2, sort_keys=True)
    if a.out == "-":
        print(txt)
    else:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(txt + "\n")
    print("outcome=%s entries=%s confirmed=%s pending=%s" % (rep.get("outcome"), rep.get("entries"),
          (rep.get("anchors") or {}).get("confirmed"), len((rep.get("anchors") or {}).get("pending") or [])), file=sys.stderr)
    return 0 if rep.get("outcome") == "rebuilt" else 1


if __name__ == "__main__":
    sys.exit(main())
