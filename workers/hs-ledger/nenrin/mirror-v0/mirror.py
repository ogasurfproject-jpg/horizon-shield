#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
nenrin-mirror-v0: hold a copy of the evidence yourself.

An anchor proves that bytes with a digest existed by a block. It does not keep the bytes. If every copy of
the bytes disappears (this ledger, its intake, this repository, the operator itself), the anchor still proves
that something existed and nobody can say what. Integrity is not availability. The answer is not a promise by
the operator; it is copies held by people who are not the operator, each checkable against the anchors alone.

This file is the copy. Standard library only, one directory, every file named by what it is:

    <dir>/ledger/<n>.json    the ledger entry as served (claim_sha256, ots_status, bitcoin_block, record_canonical)
    <dir>/ledger/<n>.raw     the claim bytes as served (?format=raw); sha256 must equal claim_sha256
    <dir>/ledger/<n>.ots     the OpenTimestamps proof bytes for the entry
    <dir>/objects/<sha256>   every record a batch entry points to by bytes_url, stored under the digest the batch names it by:
                             sha256 of the bytes for agreements and executions; for a contract, contract_sha256 (sha256 over
                             "a2a-contract-v0\n" plus the canonical record without its signatures, the digest both parties sign),
                             which stays the same whether one or both signatures are present. verify checks each by its rule.
    <dir>/manifest.json      what was fetched, what verified, what did not, and the sha256 of this manifest

Two digests are printed and stored, and they answer two different questions:
    manifest sha256   the digest of this file's bytes. It includes mirrored_at, so two honest mirrors of identical
                      evidence always differ here, by construction. It identifies this copy, not the evidence.
    content_sha256    sha256 over the canonical manifest with mirrored_at, content_sha256 and entries_sha256 removed.
                      Two mirrors that fetched identical evidence (same entries, same anchor states, same objects,
                      same problems) share it exactly; a difference is a real diff, not the clock.
    entries_sha256    sha256 over the canonical entries list alone (the range), for a quick compare when only the
                      ledger part is in question.
"say I hold a mirror" means: post content_sha256 and the range. (2026-09-26, finding by the second mirror holder.)

    python3 mirror.py pull   --dir ./nenrin-mirror              # fetch or resume; re-verifies what is already there
    python3 mirror.py verify --dir ./nenrin-mirror              # offline: every raw against its claim, every object against its name
    python3 mirror.py diff   ./nenrin-mirror ../someone-elses   # what one holds that the other lacks, and any bytes that differ

What a mirror establishes: that these bytes, with these digests, were obtainable at this time, and that anyone
holding this directory can recompute every digest without the network. What it does not: that the ledger's
claims are true, that the anchors are valid (verify the .ots yourself against Bitcoin headers), or that this
copy is complete beyond what manifest.json lists. Two mirrors that diff clean are two independent copies; a
mirror whose verify fails names the exact file, and that file is the finding.
"""
import argparse, hashlib, json, os, sys, time, urllib.error, urllib.request

SCHEMA = "nenrin-mirror-v0"
DEFAULT_BASE = "https://ledger.horizonshield.dev"
UA = "nenrin-mirror-v0 (+https://github.com/ogasurfproject-jpg/horizon-shield)"
PAUSE = 0.15


def sha256_hex(b):
    return hashlib.sha256(b).hexdigest()


def _retry_waits(text):
    """Two waits in seconds, "a,b". Anything else falls back to the default."""
    try:
        w = tuple(float(x) for x in text.split(","))
    except ValueError:
        return (5.0, 15.0)
    return w if len(w) == 2 and all(0 <= x <= 600 for x in w) else (5.0, 15.0)


# 2026-11-17. One GET of entry 336 failed once during a drill pull, and the entry became a problem. A fetch that got
# no answer (network error, timeout) or a 5xx is tried again, twice, after these waits; 200 and 4xx are answers and
# are never retried. NENRIN_MIRROR_RETRY_WAITS="0,0" makes the self test run without sleeping.
RETRY_WAITS = _retry_waits(os.environ.get("NENRIN_MIRROR_RETRY_WAITS", "5,15"))


def _fetch_once(url, timeout):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b""
    except Exception as e:  # noqa: BLE001
        return None, str(e).encode("utf-8", "replace")


def fetch(url, timeout=30):
    st, b = _fetch_once(url, timeout)
    for wait in RETRY_WAITS:
        if st is not None and not 500 <= st <= 599:
            break
        time.sleep(wait)
        st, b = _fetch_once(url, timeout)
    return st, b


def _write(path, b):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".part"
    with open(tmp, "wb") as f:
        f.write(b)
    os.replace(tmp, path)


def _read(path):
    with open(path, "rb") as f:
        return f.read()


def _is_hex64(s):
    return isinstance(s, str) and len(s) == 64 and all(c in "0123456789abcdef" for c in s)


ALLOW_HTTP = False   # set when the base itself is a loopback http server (the self test); https otherwise


def _url_ok(u):
    if not isinstance(u, str):
        return False
    if u.startswith("https://"):
        return True
    return ALLOW_HTTP and (u.startswith("http://127.0.0.1") or u.startswith("http://localhost"))


def canonical(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


CONTRACT_CONTEXT = b"a2a-contract-v0\n"


def object_ok(kind, sha, b):
    """Does this object carry the digest the batch names it by? Returns (ok, rule). Agreements and executions are
    named by sha256 of their bytes. A contract is named by contract_sha256, the digest both parties signed: sha256
    over the context line plus the canonical record without its signatures. Tried in that order; when the kind is
    unknown (a stray file in objects/), a contract shaped record is allowed the second rule."""
    if sha256_hex(b) == sha:
        return True, "sha256"
    if kind in ("contract", None):
        try:
            rec = json.loads(b.decode("utf-8"))
        except Exception:  # noqa: BLE001
            return False, None
        if isinstance(rec, dict) and rec.get("schema") == "a2a-contract-v0":
            body = {k: v for k, v in rec.items() if k != "signatures"}
            if sha256_hex(CONTRACT_CONTEXT + canonical(body).encode("utf-8")) == sha:
                return True, "contract_sha256"
    return False, None


# Batches whose records carry no bytes_url still name each record by its digest, and the ledger serves the record
# under that digest. 2026-10-09 (red team R3-1): these were not copied, so 27 witness walks named by anchored batches
# would have been lost with the ledger. Each kind says where the ledger serves the record and where its bytes are.
NAMED_KINDS = {
    "nenrin-witness-batch-v1": ("sha", "witness_record", "/witness/%s"),
    "nenrin-trace-pin-batch-v0": ("sha", "trace_record", "/evidence/trace/%s?format=raw"),
    "nenrin-agreement-batch-v1": ("canonical_sha256", "agreement_record", "/agreement/%s"),
    "nenrin-vouch-pin-batch-v0": ("sha", "vouch_record", "/evidence/vouch/%s?format=raw"),
    "nenrin-slot-witness-batch-v0": ("sha", "slot_record", "/evidence/slot/%s?format=raw"),
}


def named_records(entry):
    """(sha, kind, path) for every record a known batch names by digest without a bytes_url."""
    out = []
    rc = entry.get("record_canonical")
    if not isinstance(rc, str):
        return out
    try:
        rec = json.loads(rc)
    except Exception:  # noqa: BLE001
        return out
    if not isinstance(rec, dict) or rec.get("schema") not in NAMED_KINDS:
        return out
    field, kind, path = NAMED_KINDS[rec["schema"]]
    for item in rec.get("records") or []:
        if isinstance(item, dict) and _is_hex64(item.get(field)) and not item.get("bytes_url"):
            out.append((item[field], kind, path % item[field]))
    return out


def record_bytes(kind, body):
    """The record's own bytes from what the ledger serves: raw for a TRACE record, a Vouch credential or a slot observation, the
    record_canonical string of the JSON envelope for a witness walk or an agreement. Returns (bytes or None, envelope dict or None)."""
    if kind in ("trace_record", "vouch_record", "slot_record"):
        return body, None
    try:
        env = json.loads(body.decode("utf-8"))
    except Exception:  # noqa: BLE001
        return None, None
    rc = None
    if isinstance(env, dict):
        if isinstance(env.get("record"), dict) and isinstance(env["record"].get("record_canonical"), str):
            rc = env["record"]["record_canonical"]
        elif isinstance(env.get("record_canonical"), str):
            rc = env["record_canonical"]
    return (rc.encode("utf-8") if rc is not None else None), env


def objects_of(entry):
    """(sha, bytes_url, kind) triples a ledger entry points to: any records[] item with a 64 hex sha and an https bytes_url."""
    out = []
    rc = entry.get("record_canonical")
    if not isinstance(rc, str):
        return out
    try:
        rec = json.loads(rc)
    except Exception:  # noqa: BLE001
        return out
    for item in (rec.get("records") if isinstance(rec, dict) else None) or []:
        if isinstance(item, dict) and _is_hex64(item.get("sha")) and _url_ok(item.get("bytes_url")):
            out.append((item["sha"], item["bytes_url"], item.get("kind") if isinstance(item.get("kind"), str) else None))
    return out


# --------------------------------------------------------------------------- pull
def pull(base, d, n_from=None, n_to=None, quiet=False):
    global ALLOW_HTTP
    base = base.rstrip("/")
    ALLOW_HTTP = base.startswith("http://127.0.0.1") or base.startswith("http://localhost")
    problems, entries, objects, named_problems, awaiting = [], [], {}, [], []
    st, body = fetch(base + "/ledger?format=json")
    if st != 200:
        print("cannot read %s/ledger?format=json (status %s)" % (base, st)); return 2
    idx = json.loads(body.decode("utf-8"))
    count = int(idx.get("count") or 0)
    lo, hi = n_from or 1, n_to or count
    say = (lambda *a: None) if quiet else print
    say("ledger %s: count %d, mirroring %d..%d into %s" % (base, count, lo, hi, d))
    for n in range(lo, hi + 1):
        e = {"n": n, "json": False, "raw_ok": None, "ots": False, "objects": []}
        jp = os.path.join(d, "ledger", "%d.json" % n)
        if os.path.exists(jp):
            jb = _read(jp)
        else:
            st, jb = fetch("%s/ledger/%d?format=json" % (base, n)); time.sleep(PAUSE)
            if st != 200:
                problems.append({"n": n, "what": "entry_json", "status": st}); entries.append(e); continue
            _write(jp, jb)
        try:
            entry = json.loads(jb.decode("utf-8"))
        except Exception:  # noqa: BLE001
            problems.append({"n": n, "what": "entry_json_unparseable"}); entries.append(e); continue
        e["json"] = True
        claim = entry.get("claim_sha256")
        e["claim_sha256"] = claim
        e["ots_status"] = entry.get("ots_status")
        e["bitcoin_block"] = entry.get("bitcoin_block")
        # raw claim bytes
        rp = os.path.join(d, "ledger", "%d.raw" % n)
        if not os.path.exists(rp):
            st, rb = fetch("%s/ledger/%d?format=raw" % (base, n)); time.sleep(PAUSE)
            if st == 200 and rb:
                _write(rp, rb)
        if os.path.exists(rp):
            rb = _read(rp)
            e["raw_ok"] = (sha256_hex(rb) == claim)
            if not e["raw_ok"]:
                problems.append({"n": n, "what": "raw_sha_mismatch", "claim": claim, "got": sha256_hex(rb)})
            rc = entry.get("record_canonical")
            if isinstance(rc, str) and rc.encode("utf-8") != rb:
                e["raw_equals_record_canonical"] = False
                problems.append({"n": n, "what": "raw_differs_from_record_canonical"})
        else:
            problems.append({"n": n, "what": "raw_missing"})
        # ots proof
        op = os.path.join(d, "ledger", "%d.ots" % n)
        if not os.path.exists(op):
            st, ob = fetch("%s/ledger/%d/ots" % (base, n)); time.sleep(PAUSE)
            if st == 200 and ob:
                _write(op, ob)
        e["ots"] = os.path.exists(op)
        # 2026-10-13. An entry the ledger itself reports as not yet stamped has no proof to fetch yet. That is a state,
        # not a defect: it is listed under awaiting_stamp (and the entry carries awaiting_stamp), and the next pull
        # fetches the proof once it exists. A missing proof for an entry the ledger says is pending or confirmed is
        # still a problem. Both keys appear only when non-empty, so a copy with nothing awaiting is byte-identical to
        # one written by the previous version.
        if not e["ots"]:
            if entry.get("ots_status") == "unstamped":
                e["awaiting_stamp"] = True; awaiting.append(n)
            else:
                problems.append({"n": n, "what": "ots_missing"})
        # objects the entry points to, content addressed
        for sha, url, kind in objects_of(entry):
            e["objects"].append(sha)
            path = os.path.join(d, "objects", sha)
            if sha in objects:
                continue
            if not os.path.exists(path):
                st, b = fetch(url); time.sleep(PAUSE)
                if st != 200 or not b:
                    objects[sha] = {"url": url, "kind": kind, "ok": False, "status": st}
                    problems.append({"n": n, "what": "object_unreachable", "sha": sha, "url": url, "status": st}); continue
                ok, rule = object_ok(kind, sha, b)
                if not ok:
                    objects[sha] = {"url": url, "kind": kind, "ok": False, "got_sha256": sha256_hex(b)}
                    problems.append({"n": n, "what": "object_sha_mismatch", "sha": sha, "url": url, "kind": kind, "got_sha256": sha256_hex(b)}); continue
                _write(path, b)
            b = _read(path)
            ok, rule = object_ok(kind, sha, b)
            objects[sha] = {"url": url, "kind": kind, "ok": ok, "addressed_by": rule, "bytes": len(b)}
            if not ok:
                problems.append({"n": n, "what": "object_on_disk_mismatch", "sha": sha, "kind": kind})
        for sha, kind, rpath in named_records(entry):
            path = os.path.join(d, "objects", sha)
            if sha in objects:
                e["objects"].append(sha); continue
            if not os.path.exists(path):
                st, body = fetch(base + rpath); time.sleep(PAUSE)
                b, env = record_bytes(kind, body) if st == 200 and body else (None, None)
                # a record the ledger did not serve, or served wrong, is listed in named_record_problems only: the
                # objects map and the content digest describe what this copy holds, not what one fetch failed to get
                if b is None:
                    named_problems.append({"n": n, "what": "named_record_unreachable", "sha": sha, "kind": kind, "status": st}); continue
                if sha256_hex(b) != sha:
                    named_problems.append({"n": n, "what": "named_record_sha_mismatch", "sha": sha, "kind": kind, "got_sha256": sha256_hex(b)}); continue
                _write(path, b)
                if env is not None:   # the signature and the key travel beside the bytes, so a reader can verify without the ledger
                    keep = {k: env[k] for k in ("public_key_ed25519_b64", "signature_ed25519_b64", "signed_domain", "key_url") if k in env}
                    if isinstance(env.get("record"), dict):
                        keep.update({k: env["record"][k] for k in ("public_key_ed25519_b64", "signature_ed25519_b64", "signed_domain", "key_url") if k in env["record"]})
                    if keep:
                        _write(path + ".sig.json", json.dumps(keep, sort_keys=True, separators=(",", ":")).encode("utf-8"))
            b = _read(path)
            e["objects"].append(sha)
            objects[sha] = {"kind": kind, "ok": sha256_hex(b) == sha, "addressed_by": "sha256", "bytes": len(b)}
            if not objects[sha]["ok"]:
                problems.append({"n": n, "what": "object_on_disk_mismatch", "sha": sha, "kind": kind})
        entries.append(e)
        say("  %3d  claim %s  raw %s  ots %s  objects %d%s" % (n, (claim or "")[:12], "ok" if e["raw_ok"] else "NO", "ok" if e["ots"] else "NO",
                                                          len(e["objects"]), "  block %s" % e.get("bitcoin_block") if e.get("bitcoin_block") else ""))
    man = {"schema": SCHEMA, "base": base, "mirrored_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "ledger_count_reported": count, "range": [lo, hi], "entries": entries,
           "objects": {k: objects[k] for k in sorted(objects)}, "problems": problems,
           # named records the ledger did not serve are listed, not failed: the copy is still honest about what it holds
           "named_record_problems": named_problems,
           **({"awaiting_stamp": awaiting} if awaiting else {}),
           "establishes": ["that the bytes listed here, with these digests, were obtainable from base at mirrored_at",
                           "that every digest here recomputes offline from the files in this directory (run verify)",
                           "that another mirror with the same content_sha256 holds byte-identical evidence for the same range"],
           "does_not_establish": ["that any claim in the ledger is true", "that the anchors are valid; verify each .ots against Bitcoin headers yourself",
                                  "that this copy is complete beyond the range and objects listed"]}
    man["content_sha256"], man["entries_sha256"] = content_digests(man)
    mb = json.dumps(man, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    _write(os.path.join(d, "manifest.json"), mb)
    say("manifest.json sha256 %s; %d entries, %d objects, %d problem(s), %d named record(s) not obtained%s" % (sha256_hex(mb), len(entries), len(objects), len(problems), len(named_problems),
        "" if not awaiting else ", %d awaiting their first stamp (%s)" % (len(awaiting), ", ".join(str(x) for x in awaiting))))
    say("content_sha256 %s  entries_sha256 %s  (compare these with another mirror; the manifest sha never matches by design)" % (man["content_sha256"], man["entries_sha256"]))
    # one line each, as verify prints them, so a red run names the entry without opening manifest.json
    for p in problems + named_problems:
        say("  " + json.dumps(p, ensure_ascii=False))
    return 0 if not problems else 1


# the two digests two honest mirrors can share. mirrored_at is the clock; it never enters either.
CONTENT_EXCLUDED = ("mirrored_at", "content_sha256", "entries_sha256")


def content_digests(man):
    """(content_sha256, entries_sha256): sha256 over canonical(manifest minus mirrored_at and the two digest fields), and
    sha256 over canonical(entries) alone. Deterministic in the evidence, independent of when the pull happened."""
    body = {k: v for k, v in man.items() if k not in CONTENT_EXCLUDED}
    return sha256_hex(canonical(body).encode("utf-8")), sha256_hex(canonical(man.get("entries", [])).encode("utf-8"))


# --------------------------------------------------------------------------- verify (offline)
def verify(d, quiet=False):
    say = (lambda *a: None) if quiet else print
    problems, n_raw, n_obj, kinds, awaiting = [], 0, 0, {}, []
    named_total, named_held, named_missing = 0, 0, []
    ld = os.path.join(d, "ledger")
    for name in sorted(os.listdir(ld) if os.path.isdir(ld) else []):
        if not name.endswith(".json"):
            continue
        n = name[:-5]
        try:
            entry = json.loads(_read(os.path.join(ld, name)).decode("utf-8"))
        except Exception:  # noqa: BLE001
            problems.append({"n": n, "what": "entry_json_unparseable"}); continue
        claim = entry.get("claim_sha256")
        rp = os.path.join(ld, n + ".raw")
        if os.path.exists(rp):
            n_raw += 1
            got = sha256_hex(_read(rp))
            if got != claim:
                problems.append({"n": n, "what": "raw_sha_mismatch", "claim": claim, "got": got})
        else:
            problems.append({"n": n, "what": "raw_missing"})
        if not os.path.exists(os.path.join(ld, n + ".ots")):
            # 2026-10-13. As in pull: the ledger said this entry was not yet stamped when it was copied. A state, not a defect.
            if entry.get("ots_status") == "unstamped":
                awaiting.append(n)
            else:
                problems.append({"n": n, "what": "ots_missing"})
        for sha, _url, kind in objects_of(entry):
            path = os.path.join(d, "objects", sha)
            if not os.path.exists(path):
                problems.append({"n": n, "what": "object_missing", "sha": sha, "kind": kind}); continue
            kinds[sha] = kind
        for sha, kind, _p in named_records(entry):
            named_total += 1
            if os.path.exists(os.path.join(d, "objects", sha)):
                kinds[sha] = kind; named_held += 1
            else:
                named_missing.append({"n": n, "sha": sha, "kind": kind})
    od = os.path.join(d, "objects")
    for name in sorted(os.listdir(od) if os.path.isdir(od) else []):
        if not _is_hex64(name):
            continue
        n_obj += 1
        b = _read(os.path.join(od, name))
        ok, rule = object_ok(kinds.get(name), name, b)
        if not ok:
            problems.append({"what": "object_sha_mismatch", "sha": name, "kind": kinds.get(name), "got_sha256": sha256_hex(b)})
    mp = os.path.join(d, "manifest.json")
    msha = sha256_hex(_read(mp)) if os.path.exists(mp) else None
    csha = esha = None
    if msha:
        try:
            man = json.loads(_read(mp).decode("utf-8"))
            csha, esha = content_digests(man)
            # a manifest written before content digests existed carries none; that is not a problem, just older
            if "content_sha256" in man and (man.get("content_sha256") != csha or man.get("entries_sha256") != esha):
                problems.append({"what": "manifest_content_sha_mismatch", "stored": man.get("content_sha256"), "recomputed": csha})
        except Exception:  # noqa: BLE001
            problems.append({"what": "manifest_json_unparseable"})
    say("verify %s: %d raw claims, %d objects, manifest %s, %d problem(s)" % (d, n_raw, n_obj, (msha or "absent")[:16], len(problems)))
    if awaiting:
        say("awaiting their first stamp (the ledger reported them unstamped; not a problem, the next pull fetches the proof): %s" % ", ".join(sorted(awaiting, key=lambda x: int(x) if x.isdigit() else 0)))
    say("records named by batches without bytes_url: %d held of %d%s" % (named_held, named_total, "" if not named_missing else " (not held: %s)" % ", ".join(m["sha"][:12] for m in named_missing[:20])))
    if csha:
        say("content_sha256 %s  entries_sha256 %s" % (csha, esha))
    for p in problems:
        say("  " + json.dumps(p, ensure_ascii=False))
    return 0 if not problems else 1


# --------------------------------------------------------------------------- diff (two mirrors)
def diff(a, b, quiet=False):
    say = (lambda *a: None) if quiet else print

    def files(d):
        out = {}
        for sub in ("ledger", "objects"):
            p = os.path.join(d, sub)
            for name in (os.listdir(p) if os.path.isdir(p) else []):
                if name.endswith(".part"):
                    continue
                out[sub + "/" + name] = sha256_hex(_read(os.path.join(p, name)))
        return out
    fa, fb = files(a), files(b)
    only_a = sorted(k for k in fa if k not in fb)
    only_b = sorted(k for k in fb if k not in fa)
    differ = sorted(k for k in fa if k in fb and fa[k] != fb[k] and not k.endswith(".json"))
    say("diff: %d files in A, %d in B; only in A %d, only in B %d, same name different bytes %d"
        % (len(fa), len(fb), len(only_a), len(only_b), len(differ)))
    ca = cb = None
    for tag, d in (("A", a), ("B", b)):
        mp = os.path.join(d, "manifest.json")
        if os.path.exists(mp):
            try:
                man = json.loads(_read(mp).decode("utf-8")); c, e = content_digests(man)
                say("  %s content_sha256 %s  entries_sha256 %s  (mirrored_at %s)" % (tag, c, e, man.get("mirrored_at")))
                if tag == "A": ca = c
                else: cb = c
            except Exception:  # noqa: BLE001
                say("  %s manifest unreadable" % tag)
    if ca and cb:
        say("  content digests %s" % ("EQUAL: the two mirrors hold byte-identical evidence for their range" if ca == cb else "differ: the files above say where"))
    for k in only_a[:50]:
        say("  only A: " + k)
    for k in only_b[:50]:
        say("  only B: " + k)
    for k in differ:
        say("  DIFFER: %s  A %s  B %s" % (k, fa[k][:12], fb[k][:12]))
    return 0 if not differ else 1


def main():
    ap = argparse.ArgumentParser(description="nenrin-mirror-v0: hold a checkable copy of the ledger's evidence")
    sub = ap.add_subparsers(dest="cmd")
    p = sub.add_parser("pull"); p.add_argument("--dir", required=True); p.add_argument("--base", default=DEFAULT_BASE)
    p.add_argument("--from", dest="n_from", type=int); p.add_argument("--to", dest="n_to", type=int); p.add_argument("--quiet", action="store_true")
    v = sub.add_parser("verify"); v.add_argument("--dir", required=True); v.add_argument("--quiet", action="store_true")
    f = sub.add_parser("diff"); f.add_argument("a"); f.add_argument("b"); f.add_argument("--quiet", action="store_true")
    a = ap.parse_args()
    if a.cmd == "pull":
        return pull(a.base, a.dir, a.n_from, a.n_to, a.quiet)
    if a.cmd == "verify":
        return verify(a.dir, a.quiet)
    if a.cmd == "diff":
        return diff(a.a, a.b, a.quiet)
    ap.print_help(); return 1


if __name__ == "__main__":
    sys.exit(main())
