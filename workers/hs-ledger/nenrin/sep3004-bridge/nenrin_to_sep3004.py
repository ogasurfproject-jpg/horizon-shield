#!/usr/bin/env python3
"""nenrin_to_sep3004.py : project NENRIN witness records into an MCP SEP-3004 audit record chain, and verify one.

SEP-3004 (modelcontextprotocol PR #3004, "Tamper-Evident Audit Record Contract", draft) defines one record shape,
one canonical form (gif-audit/2: sorted keys, NFC, no bare numbers), one hash chain (previous_hash / event_hash,
SHA-256) and one verification procedure (section 2.6). NENRIN witness records (jidec-path-v1 walks filed at
POST /witness on the ledger) already have an identity of their own: sha256 of their exact bytes, anchored to
Bitcoin through the daily nenrin-witness-batch-v1 ledger entry. This tool is a second door into the same bytes
for anyone who verifies SEP-3004 chains, the same way ring_to_intoto.py is a second door for in-toto readers.

What it does
  export   read witness records (bare walk files, or GET /witness/<sha> bodies, pending or anchored form),
           refuse any whose stored sha does not equal sha256 of its bytes, order them deterministically
           (occurred_at, then event_id), and write a chain segment: one SEP-3004 record per witness record,
           previous_hash threaded, event_hash computed, plus the section 2.7 manifest and an anchors sidecar.
  verify   run section 2.6 over a chain file: recompute every event_hash, check every previous_hash link,
           check the core skeleton, report unregistered extension types as findings (the reference verifier
           reports them as failures; the conduct-witness type is proposed, not yet registered).
  kat      reproduce the two sealed known-answer digests of the SEP from the published preimages.
  selftest kat + export the two walk files in ../a2a-conduct-walk + verify + mutation checks.

What a projected record carries
  core (section 2.1): event_id = the NENRIN record sha256 (content addressed: GET /witness/<event_id> returns the
  bytes); occurred_at = the ledger's receipt time when the input came from the ledger (recorder assigned), else the
  witness's walked_at (witness clock; the record says which); principal_id = the witness ("witness:domain:<d>" when
  the ledger verified a signature under d, else "witness:name:<name>"); event_type = "conduct_walk";
  tool_name = the measured target (the origin or endpoint named in the walk's purpose); outcome = "allowed" when
  the walk completed and carries a verdict (PASS and FAIL are both completed observations), "deferred" for a
  commitment record (verdict unrevealed), "error" when the walk carries no verdict and no commitment.
  extensions: "caller-governance" (registered by the SEP: purpose_declared = the walk's purpose, sources_touched =
  the URLs the walk fetched, as the SEP's canonical array string) and "conduct-witness" (proposed here, see
  SEP3004_BRIDGE_v0.md section 3; --extensions registered leaves it out so today's reference verifier passes
  every check).

What it never does
  It does not recompute or restate a verdict, does not turn counts into a score, does not sign, does not fetch
  unless --fetch is given, and does not put the Bitcoin anchor inside the preimage (section 2.8 reserves
  anchor_witness and requires it absent or null in v1; the anchor rides the sidecar).

Standard library only. Python 3.8+.
"""
import argparse
import hashlib
import io
import json
import os
import re
import sys
import unicodedata

BRIDGE_VERSION = "0.1.0"
CANONICAL_FORM_VERSION = "gif-audit/2"
CHAIN_ALGORITHM = "sha-256"
EVENT_TYPE = "conduct_walk"
EXT_CONDUCT = "conduct-witness"
EXT_CG = "caller-governance"
LEDGER = "https://ledger.horizonshield.dev"
VERIFICATION_PROCEDURE_REF = "https://github.com/ogasurfproject-jpg/horizon-shield/tree/main/workers/hs-ledger/nenrin/sep3004-bridge"
REGISTERED_EXTENSIONS = {
    # section 2.2 of the SEP as implemented by the reference verifier (gif, audit-record-contract.ts)
    "caller-governance": {"required": ["purpose_declared"],
                          "optional": ["session_id", "invoked_by_principal_id", "flagged", "sources_touched",
                                       "sensitivity_encountered", "output_disposition", "human_actor_id"]},
    "runtime-security": {"required": ["drift_status", "severity", "quarantine_decision", "policy_id"],
                         "optional": ["evidence_hash"]},
    "admission-control": {"required": [], "optional": []},
}
PROPOSED_EXTENSIONS = {
    "conduct-witness": {"required": ["record_sha256", "record_schema", "walked_at", "witness_name", "occurred_at_source"],
                        "optional": ["record_url", "conduct_ext_uri", "mode", "privacy_mode", "witness_vantage",
                                     "witness_signed_domain", "witness_key_url", "verdict_outcome", "n_pass", "n_total",
                                     "assertions_failed", "commitment"]},
}
OUTCOMES = ("allowed", "denied", "deferred", "error")
CORE_PROTECTED = ("event_id", "occurred_at", "principal_id", "event_type", "tool_name", "outcome", "previous_hash")
MAX_FIELD_LEN = 8192
MAX_DEPTH = 64
HEX64 = re.compile(r"^[0-9a-f]{64}$")
TS = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$")


class Refuse(Exception):
    pass


# ---------------------------------------------------------------- section 2.3 canonical form (gif-audit/2)

def _check_wellformed(s):
    try:
        s.encode("utf-8")
    except UnicodeEncodeError:
        raise Refuse("string is not well formed Unicode (unpaired surrogate)")


def normalize_string(s):
    """Protected string VALUE: reject controls, NFC, trim U+0020 only, cap 8192 UTF-16 code units."""
    _check_wellformed(s)
    for ch in s:
        o = ord(ch)
        if o < 0x20 or 0x7F <= o <= 0x9F:
            raise Refuse("control character in protected string field")
    n = unicodedata.normalize("NFC", s).strip(" ")
    if len(n.encode("utf-16-le")) // 2 > MAX_FIELD_LEN:
        raise Refuse("protected string field exceeds length cap")
    return n


def _js_string(s):
    # JSON.stringify for a string with no control characters: escape only " and \, non-ASCII literal.
    return json.dumps(s, ensure_ascii=False)


def canonicalize(value, depth=0):
    if depth > MAX_DEPTH:
        raise Refuse("protected value nesting exceeds depth cap")
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        raise Refuse("bare number in protected field; gif-audit/2 carries numerics as strings")
    if isinstance(value, str):
        return _js_string(normalize_string(value))
    if isinstance(value, list):
        return "[" + ",".join(canonicalize(v, depth + 1) for v in value) + "]"
    if isinstance(value, dict):
        for k in value:
            if not isinstance(k, str):
                raise Refuse("non-string object key")
            _check_wellformed(k)
        # code point order == UTF-8 byte order; keys are registry vocabulary and are not normalized
        keys = sorted(value.keys())
        return "{" + ",".join(_js_string(k) + ":" + canonicalize(value[k], depth + 1) for k in keys) + "}"
    raise Refuse("uncanonicalizable value of type " + type(value).__name__)


def protected_body(record):
    body = {}
    for f in CORE_PROTECTED:
        body[f] = record.get(f)
    body["extensions"] = record.get("extensions")
    return body


def preimage(record):
    return canonicalize(protected_body(record))


def event_hash(record):
    return hashlib.sha256(preimage(record).encode("utf-8")).hexdigest()


# ---------------------------------------------------------------- inputs: NENRIN witness records

def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def rfc3339_ms(ts, what):
    m = TS.match(ts or "")
    if not m:
        raise Refuse(what + " is not an RFC 3339 UTC timestamp with a literal Z: " + repr(ts))
    frac = m.group(2) or ""
    if len(frac) > 3:
        raise Refuse(what + " carries more than millisecond precision; refusing to truncate: " + ts)
    return m.group(1) + "." + (frac + "000")[:3] + "Z"


def load_source(path):
    """One NENRIN witness record in any of three forms. Returns a dict with the exact bytes, their sha and context."""
    raw = open(path, "rb").read()
    try:
        j = json.loads(raw.decode("utf-8"))
    except Exception as e:
        raise Refuse(path + ": not UTF-8 JSON: " + str(e))
    if not isinstance(j, dict):
        raise Refuse(path + ": not a JSON object")
    if j.get("schema") == "jidec-path-v1":
        return {"path": path, "form": "walk_file", "bytes": raw, "sha": sha256_bytes(raw), "walk": j,
                "submitted_at": None, "ledger_entry": None, "signed": None, "signed_domain": None, "record_url": None}
    stored = None
    ledger_entry = None
    if j.get("status") == "anchored" and isinstance(j.get("record"), dict):
        stored, ledger_entry = j["record"], j.get("ledger_entry")
    elif isinstance(j.get("record_canonical"), str) and isinstance(j.get("sha"), str):
        stored = j
    if stored is None:
        raise Refuse(path + ": neither a jidec-path-v1 walk nor a GET /witness/<sha> body")
    rc = stored.get("record_canonical")
    if not isinstance(rc, str):
        raise Refuse(path + ": record_canonical missing")
    b = rc.encode("utf-8")
    sha = sha256_bytes(b)
    claimed = (stored.get("sha") or j.get("sha") or "").lower()
    if claimed and claimed != sha:
        raise Refuse(path + ": stored sha " + claimed + " does not equal sha256 of record_canonical " + sha)
    if HEX64.match(os.path.basename(path).split(".")[0] or "") and os.path.basename(path).split(".")[0] != sha:
        raise Refuse(path + ": file name sha does not equal sha256 of the bytes")
    try:
        walk = json.loads(rc)
    except Exception as e:
        raise Refuse(path + ": record_canonical is not JSON: " + str(e))
    if not isinstance(walk, dict) or walk.get("schema") != "jidec-path-v1":
        raise Refuse(path + ": record_canonical is not a jidec-path-v1 record")
    return {"path": path, "form": "witness_anchored" if ledger_entry is not None else "witness_pending",
            "bytes": b, "sha": sha, "walk": walk, "submitted_at": stored.get("submitted_at"),
            "ledger_entry": ledger_entry, "signed": stored.get("signed"),
            "signed_domain": stored.get("signed_domain") or None, "record_url": LEDGER + "/witness/" + sha}


def walk_target(walk):
    p = walk.get("purpose") or ""
    if ": " in p:
        return p.split(": ", 1)[1].strip() or None
    return walk.get("base") or None


def sources_touched(walk):
    urls = set()
    for n in walk.get("nodes") or []:
        if isinstance(n, dict) and n.get("kind") == "fetch":
            u = (n.get("request") or {}).get("url")
            if isinstance(u, str) and u:
                urls.add(u)
    if not urls:
        return None
    # the SEP's canonical array string: deduplicated, sorted by UTF-8 bytes, minimal escaping
    items = sorted(urls, key=lambda s: s.encode("utf-8"))
    return "[" + ",".join('"' + u.replace("\\", "\\\\").replace('"', '\\"') + '"' for u in items) + "]"


def failed_assertions(walk):
    names = []
    for a in walk.get("assertions") or []:
        if isinstance(a, dict) and a.get("result") is False:
            claim = a.get("claim") or ""
            names.append(claim.split(":", 1)[0].strip() or "unnamed")
    if not names:
        return None
    items = sorted(set(names), key=lambda s: s.encode("utf-8"))
    return "[" + ",".join('"' + u.replace("\\", "\\\\").replace('"', '\\"') + '"' for u in items) + "]"


def s_or_none(v):
    if v is None:
        return None
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, str):
        return v
    return None


def project(src, previous_hash, extensions_mode):
    walk = src["walk"]
    witness = walk.get("witness") if isinstance(walk.get("witness"), dict) else {}
    verdict = walk.get("verdict") if isinstance(walk.get("verdict"), dict) else None
    commitment = walk.get("commitment") if isinstance(walk.get("commitment"), str) else None
    if src["submitted_at"]:
        occurred_at, occ_src = rfc3339_ms(src["submitted_at"], "submitted_at"), "ledger_receipt"
    else:
        occurred_at, occ_src = rfc3339_ms(walk.get("walked_at"), "walked_at"), "witness_clock"
    if src["signed"] is True and src["signed_domain"]:
        principal = "witness:domain:" + src["signed_domain"]
    else:
        name = witness.get("name")
        if not isinstance(name, str) or not name.strip():
            raise Refuse(src["path"] + ": witness.name missing; the ledger would have refused this record too")
        principal = "witness:name:" + name
    if verdict is not None and verdict.get("outcome") in ("PASS", "FAIL"):
        outcome = "allowed"
    elif commitment:
        outcome = "deferred"
    else:
        outcome = "error"
    purpose = walk.get("purpose")
    if not isinstance(purpose, str) or not purpose:
        raise Refuse(src["path"] + ": purpose missing")
    cg = {"purpose_declared": purpose, "sources_touched": sources_touched(walk)}
    exts = {EXT_CG: cg}
    if extensions_mode == "full":
        ce = walk.get("conduct_ext") if isinstance(walk.get("conduct_ext"), dict) else {}
        cw = {
            "record_sha256": src["sha"],
            "record_url": src["record_url"],
            "record_schema": "jidec-path-v1",
            "conduct_ext_uri": s_or_none(ce.get("uri")),
            "mode": s_or_none(ce.get("mode")),
            "privacy_mode": s_or_none(walk.get("mode")),
            "walked_at": walk.get("walked_at"),
            "witness_name": witness.get("name"),
            "witness_vantage": s_or_none(witness.get("vantage")),
            "witness_signed_domain": src["signed_domain"],
            "witness_key_url": s_or_none(witness.get("key_url")),
            "verdict_outcome": s_or_none(verdict.get("outcome")) if verdict else None,
            "n_pass": s_or_none(verdict.get("n_pass")) if verdict else None,
            "n_total": s_or_none(verdict.get("n_total")) if verdict else None,
            "assertions_failed": failed_assertions(walk),
            "commitment": commitment,
            "occurred_at_source": occ_src,
        }
        exts[EXT_CONDUCT] = cw
    rec = {
        "event_id": src["sha"],
        "occurred_at": occurred_at,
        "principal_id": principal,
        "event_type": EVENT_TYPE,
        "tool_name": walk_target(walk),
        "outcome": outcome,
        "previous_hash": previous_hash,
        "extensions": exts,
    }
    rec["event_hash"] = event_hash(rec)
    return rec


def manifest(extensions_mode, n_records, occurred_sources):
    return {
        "schema": "sep3004-attestation-manifest",
        "storage_mechanism": ("append-only ledger (JIDEC): witness records are filed at POST /witness on ledger.horizonshield.dev, "
                              "bundled daily into a nenrin-witness-batch-v1 ledger entry (KV, no delete route, operator cannot remove a "
                              "filed record), each entry stamped to Bitcoin through OpenTimestamps; this chain is a deterministic "
                              "projection of those stored bytes (same inputs, same bytes, same hashes)"),
        "chain_algorithm": CHAIN_ALGORITHM,
        "canonical_form_version": CANONICAL_FORM_VERSION,
        "verification_procedure_ref": VERIFICATION_PROCEDURE_REF,
        "verifier": "nenrin_to_sep3004.py verify <chain.jsonl>  (standard library; exit 0 only when every hash and link holds)",
        "bridge_version": BRIDGE_VERSION,
        "extensions_mode": extensions_mode,
        "extension_types": [EXT_CG] + ([EXT_CONDUCT] if extensions_mode == "full" else []),
        "extension_registration": ("caller-governance is registered by the SEP; conduct-witness is proposed in SEP3004_BRIDGE_v0.md "
                                   "section 3 and will read as unregistered under a verifier that only knows the SEP's registry"),
        "event_type_vocabulary": [EVENT_TYPE],
        "outcome_rule": ("allowed = the walk completed and carries a verdict (PASS and FAIL alike: the outcome describes the "
                         "observation event, not the agent); deferred = commitment record, verdict unrevealed; error = no verdict "
                         "and no commitment"),
        "occurred_at_source": occurred_sources,
        "segment_order": "ascending (occurred_at, event_id); the segment head has previous_hash null",
        "record_bytes": "GET " + LEDGER + "/witness/<event_id> returns the NENRIN record this event projects; sha256 of record_canonical equals event_id",
        "anchor": "outside the preimage (SEP section 2.8, v1): see anchors.json beside this manifest",
        "records": n_records,
    }


def export(paths, out_dir, extensions_mode, prev_hash=None):
    srcs = [load_source(p) for p in paths]
    seen = {}
    for s in srcs:
        if s["sha"] in seen:
            raise Refuse("duplicate record " + s["sha"] + " (" + seen[s["sha"]] + " and " + s["path"] + ")")
        seen[s["sha"]] = s["path"]
    # order key: the same occurred_at the record will carry, then event_id
    def okey(s):
        t = s["submitted_at"] or (s["walk"].get("walked_at") or "")
        return (rfc3339_ms(t, "timestamp"), s["sha"])
    srcs.sort(key=okey)
    chain = []
    prev = prev_hash
    sources = set()
    anchors = {}
    for s in srcs:
        r = project(s, prev, extensions_mode)
        chain.append(r)
        prev = r["event_hash"]
        sources.add("ledger_receipt" if s["submitted_at"] else "witness_clock")
        anchors[r["event_id"]] = {
            "input_form": s["form"],
            "record_url": s["record_url"],
            "ledger_entry": s["ledger_entry"],
            "ledger_url": (LEDGER + "/ledger/" + str(s["ledger_entry"])) if s["ledger_entry"] is not None else None,
            "ots_url": (LEDGER + "/ledger/" + str(s["ledger_entry"]) + "/ots") if s["ledger_entry"] is not None else None,
            "note": ("the daily batch entry lists this event_id under records[].sha; its claim_sha256 is the sha256 of the batch bytes; "
                     "the OTS proof stamps that claim into a Bitcoin block" if s["ledger_entry"] is not None else
                     "not from the ledger: existence time rests on the witness clock until the record is filed and batched"),
        }
    os.makedirs(out_dir, exist_ok=True)
    chain_path = os.path.join(out_dir, "chain.jsonl")
    with io.open(chain_path, "w", encoding="utf-8", newline="") as f:
        for r in chain:
            f.write(json.dumps(r, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")
    man = manifest(extensions_mode, len(chain), sorted(sources))
    with io.open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8", newline="") as f:
        f.write(json.dumps(man, ensure_ascii=False, sort_keys=True, indent=1) + "\n")
    with io.open(os.path.join(out_dir, "anchors.json"), "w", encoding="utf-8", newline="") as f:
        f.write(json.dumps({"schema": "sep3004-bridge-anchors-v0", "anchor_witness_in_preimage": False, "anchors": anchors},
                           ensure_ascii=False, sort_keys=True, indent=1) + "\n")
    return chain, man, chain_path


# ---------------------------------------------------------------- section 2.6 verification

def read_chain(path):
    out = []
    with io.open(path, "r", encoding="utf-8") as f:
        for i, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except Exception as e:
                raise Refuse("line " + str(i + 1) + " is not JSON: " + str(e))
    return out


def verify_chain(records, registry_known=None):
    """Returns (ok, failures, findings). ok covers hashes, links and the core skeleton; findings do not fail."""
    failures, findings = [], []
    known = dict(REGISTERED_EXTENSIONS)
    if registry_known:
        known.update(registry_known)
    if not records:
        return False, ["empty chain"], findings
    for i, r in enumerate(records):
        rid = str(r.get("event_id"))
        for f in CORE_PROTECTED + ("event_hash", "extensions"):
            if f not in r:
                failures.append(rid + ": missing required field " + f)
        if "outcome" in r and r.get("outcome") not in OUTCOMES:
            findings.append(rid + ": outcome outside the abstract vocabulary: " + repr(r.get("outcome")))
        if r.get("tool_name") is not None and not isinstance(r.get("tool_name"), str):
            failures.append(rid + ": tool_name must be string or null")
        if r.get("previous_hash") is not None and not isinstance(r.get("previous_hash"), str):
            failures.append(rid + ": previous_hash must be string or null")
        ex = r.get("extensions")
        if not isinstance(ex, dict) or isinstance(ex, list):
            failures.append(rid + ": extensions must be a keyed object")
            ex = {}
        if not ex:
            failures.append(rid + ": extensions must declare at least one type")
        for t, data in ex.items():
            spec = known.get(t)
            if spec is None:
                findings.append(rid + ": extension type not in the SEP registry: " + t + (" (proposed by this bridge)" if t in PROPOSED_EXTENSIONS else ""))
                continue
            for req in spec["required"]:
                if not isinstance(data, dict) or data.get(req) is None:
                    failures.append(rid + ": extension " + t + " requires " + req)
        if "occurred_at" in r:
            try:
                if rfc3339_ms(r["occurred_at"], "occurred_at") != r["occurred_at"]:
                    failures.append(rid + ": occurred_at is not millisecond precision with literal Z")
            except Refuse as e:
                failures.append(rid + ": " + str(e))
        try:
            h = event_hash(r)
        except Refuse as e:
            failures.append(rid + ": canonicalization failed: " + str(e))
            continue
        if h != r.get("event_hash"):
            failures.append(rid + ": event_hash mismatch: expected " + h + ", stored " + str(r.get("event_hash")))
        if i == 0:
            if r.get("previous_hash") is not None:
                failures.append(rid + ": segment head must have previous_hash null")
        else:
            if r.get("previous_hash") != records[i - 1].get("event_hash"):
                failures.append(rid + ": broken link: previous_hash " + str(r.get("previous_hash")) + " != prior event_hash " + str(records[i - 1].get("event_hash")))
    return len(failures) == 0, failures, findings


# ---------------------------------------------------------------- known answers (section 3, C-REC-3)

KAT_CG = {
    "event_id": "99999999-9999-9999-9999-999999999999",
    "occurred_at": "2026-06-06T12:00:00.000Z",
    "principal_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "event_type": "tool_call",
    "tool_name": "export",
    "outcome": "deferred",
    "previous_hash": None,
    "extensions": {"caller-governance": {"session_id": "55555555-5555-5555-5555-555555555555", "invoked_by_principal_id": None,
                                         "purpose_declared": "reconcile June invoices", "flagged": False}},
}
KAT_CG_HASH = "d494769c1ae442ea88dd190068747abf63c0568a3b856f85791b1a50a99d48b4"
KAT_2X = dict(KAT_CG)
KAT_2X["extensions"] = {
    "caller-governance": dict(KAT_CG["extensions"]["caller-governance"]),
    "runtime-security": {"drift_status": "confirmed",
                         "evidence_hash": "sha256:b2c547e2c8f17eafc72ef5c2d4d7b6b4d0f7437ab52bae573a9af14ff5e2d9be",
                         "policy_id": "example.org/runtime-drift@3", "quarantine_decision": "quarantine", "severity": "high"},
}
KAT_2X_HASH = "f733fed9cc757165f810b778e4baba1f51a45504988e937707aaab4361b2f064"


def kat():
    a, b = event_hash(KAT_CG), event_hash(KAT_2X)
    ok = a == KAT_CG_HASH and b == KAT_2X_HASH
    print("KAT single extension  " + a + "  " + ("match" if a == KAT_CG_HASH else "MISMATCH, expected " + KAT_CG_HASH))
    print("KAT two extensions    " + b + "  " + ("match" if b == KAT_2X_HASH else "MISMATCH, expected " + KAT_2X_HASH))
    return ok


# ---------------------------------------------------------------- selftest

def selftest():
    here = os.path.dirname(os.path.abspath(__file__))
    walks = sorted(os.path.join(here, "..", "a2a-conduct-walk", f) for f in os.listdir(os.path.join(here, "..", "a2a-conduct-walk")) if f.startswith("walk_") and f.endswith(".json"))
    n_ok, n_fail = 0, 0
    def check(name, cond, detail=""):
        nonlocal n_ok, n_fail
        if cond:
            n_ok += 1
            print("ok    " + name)
        else:
            n_fail += 1
            print("FAIL  " + name + ("  " + detail if detail else ""))
    check("K1 known answers reproduce", kat())
    # canonical form corners (C-REC-2)
    check("C1 null is distinct from empty string", canonicalize({"a": None}) != canonicalize({"a": ""}))
    check("C2 NFC: composed and decomposed hash alike", canonicalize({"a": "é"}) == canonicalize({"a": "é"}))
    check("C3 trims U+0020 only, keeps NBSP", canonicalize({"a": "  x  "}) == '{"a":"x "}')
    def refuses(v):
        try:
            canonicalize(v); return False
        except Refuse:
            return True
    check("C4 control character refused", refuses({"a": "line1\nline2"}))
    check("C5 C1 control refused (stricter than the reference, which checks U+0000..U+001F and U+007F)", refuses({"a": "xy"}))
    check("C6 bare number refused", refuses({"a": 1}))
    check("C7 unpaired surrogate refused", refuses({"a": "\ud800"}))
    check("C8 non-ASCII literal, keys sorted by code point", canonicalize({"b": "平塚", "a": "x"}) == '{"a":"x","b":"平塚"}')
    check("C9 sources_touched uses minimal escaping and byte order", sources_touched({"nodes": [{"kind": "fetch", "request": {"url": "https://b/\"q"}}, {"kind": "fetch", "request": {"url": "https://a/"}}, {"kind": "fetch", "request": {"url": "https://a/"}}]}) == '["https://a/","https://b/\\"q"]')
    import tempfile
    tmp = tempfile.mkdtemp(prefix="sep3004_")
    # export full
    chain, man, cp = export(walks, os.path.join(tmp, "full"), "full")
    check("E1 exported " + str(len(chain)) + " records from the repo's walk files", len(chain) == len(walks))
    ok, fails, finds = verify_chain(chain)
    check("E2 full chain verifies (hashes, links, skeleton)", ok, "; ".join(fails))
    check("E3 conduct-witness reads as a finding, not a failure", any("conduct-witness" in f for f in finds) and not fails)
    walk_shas = sorted(sha256_bytes(open(w, "rb").read()) for w in walks)
    check("E4 event_id equals sha256 of the walk bytes", sorted(r["event_id"] for r in chain) == walk_shas)
    check("E5 segment head previous_hash null, links threaded", chain[0]["previous_hash"] is None and all(chain[i]["previous_hash"] == chain[i-1]["event_hash"] for i in range(1, len(chain))))
    check("E6 ordered by occurred_at then event_id", [ (r["occurred_at"], r["event_id"]) for r in chain] == sorted((r["occurred_at"], r["event_id"]) for r in chain))
    check("E7 no bare numbers anywhere in a protected field", all("n_pass" not in r["extensions"].get(EXT_CONDUCT, {}) or isinstance(r["extensions"][EXT_CONDUCT]["n_pass"], str) for r in chain))
    check("E8 outcome is allowed for PASS and FAIL alike (observation completed)", all(r["outcome"] == "allowed" for r in chain))
    check("E9 occurred_at_source says witness_clock for bare walk files", all(r["extensions"][EXT_CONDUCT]["occurred_at_source"] == "witness_clock" for r in chain))
    # re-export with shuffled input order gives identical bytes
    chain2, _, cp2 = export(list(reversed(walks)), os.path.join(tmp, "full2"), "full")
    check("E10 same inputs in any order give byte identical chain", open(cp, "rb").read() == open(cp2, "rb").read())
    # registered-only export
    chain_r, man_r, cp_r = export(walks, os.path.join(tmp, "reg"), "registered")
    ok_r, fails_r, finds_r = verify_chain(chain_r)
    check("R1 registered-only chain verifies with zero findings", ok_r and not finds_r, "; ".join(fails_r + finds_r))
    check("R2 registered-only record still names the NENRIN record: event_id is its sha, tool_name its target", chain_r[0]["event_id"] == chain[0]["event_id"] and chain_r[0]["tool_name"] == chain[0]["tool_name"])
    check("R3 manifest carries the four section 2.7 fields non-empty", all(isinstance(man_r.get(k), str) and man_r[k].strip() for k in ("storage_mechanism", "chain_algorithm", "canonical_form_version", "verification_procedure_ref")))
    # mutations (C-REC-4): every one must be detected
    import copy
    m = copy.deepcopy(chain); m[-1]["extensions"][EXT_CONDUCT]["n_pass"] = "0"
    check("M1 extension value mutation detected", not verify_chain(m)[0])
    m = copy.deepcopy(chain); m[0]["extensions"][EXT_CG]["purpose_declared"] = "something else"
    check("M2 purpose_declared mutation detected", not verify_chain(m)[0])
    m = copy.deepcopy(chain); m[0]["tool_name"] = "https://elsewhere.example"
    check("M3 core field mutation detected", not verify_chain(m)[0])
    if len(chain) >= 2:
        m = copy.deepcopy(chain); m.reverse()
        check("M4 reordering detected", not verify_chain(m)[0])
        m = copy.deepcopy(chain)[1:]
        check("M5 deleting the head detected (head must be null linked)", not verify_chain(m)[0])
        m = copy.deepcopy(chain); m.insert(1, copy.deepcopy(chain[0]))
        check("M6 insertion detected", not verify_chain(m)[0])
    m = copy.deepcopy(chain); m[0]["extensions"][EXT_CONDUCT]["n_pass"] = 5
    check("M7 a bare number smuggled into the chain fails verification", not verify_chain(m)[0])
    m = copy.deepcopy(chain); m[0]["anchor_witness"] = {"anything": "x"}
    check("M8 anchor_witness is outside the preimage (adding it changes nothing)", verify_chain(m)[0])
    m = copy.deepcopy(chain); m[0]["extensions"]["conduct-witness"] = m[0]["extensions"].pop("conduct-witness")
    check("M9 key order of the JSON text is irrelevant", verify_chain(m)[0])
    # input refusals
    bad = os.path.join(tmp, "bad.json")
    with io.open(bad, "w", encoding="utf-8", newline="") as f:
        f.write(json.dumps({"status": "pending", "sha": "0" * 64, "record_canonical": open(walks[0], "r", encoding="utf-8").read()}))
    try:
        load_source(bad); check("I1 stored sha that does not match the bytes is refused", False)
    except Refuse:
        check("I1 stored sha that does not match the bytes is refused", True)
    # witness form roundtrip: wrap a walk as the ledger would serve it, expect ledger_receipt
    wrapped = os.path.join(tmp, "w.json")
    rc = open(walks[0], "r", encoding="utf-8").read()
    with io.open(wrapped, "w", encoding="utf-8", newline="") as f:
        f.write(json.dumps({"status": "anchored", "sha": sha256_bytes(rc.encode("utf-8")), "ledger_entry": 41,
                            "record": {"sha": sha256_bytes(rc.encode("utf-8")), "record_canonical": rc, "signed": True, "signed_domain": "example.org",
                                       "submitted_at": "2026-09-15T00:00:00.123Z"}}))
    c3, _, _ = export([wrapped], os.path.join(tmp, "w"), "full")
    r3 = c3[0]
    check("W1 ledger form: occurred_at is the ledger receipt, principal is the signed domain", r3["occurred_at"] == "2026-09-15T00:00:00.123Z" and r3["principal_id"] == "witness:domain:example.org" and r3["extensions"][EXT_CONDUCT]["occurred_at_source"] == "ledger_receipt")
    check("W2 ledger form: record_url is the content addressed witness URL", r3["extensions"][EXT_CONDUCT]["record_url"] == LEDGER + "/witness/" + r3["event_id"])
    print("")
    print("selftest: " + str(n_ok) + " ok, " + str(n_fail) + " failed  (out dir " + tmp + ")")
    return n_fail == 0


# ---------------------------------------------------------------- CLI

def fetch(shas, out_dir):
    import urllib.request
    os.makedirs(out_dir, exist_ok=True)
    paths = []
    for s in shas:
        s = s.lower()
        if not HEX64.match(s):
            raise Refuse("not a 64 hex sha: " + s)
        url = LEDGER + "/witness/" + s
        req = urllib.request.Request(url, headers={"accept": "application/json", "user-agent": "nenrin_to_sep3004/" + BRIDGE_VERSION})
        with urllib.request.urlopen(req, timeout=20) as r:
            b = r.read()
        p = os.path.join(out_dir, s + ".witness.json")
        open(p, "wb").write(b)
        paths.append(p)
        print("fetched " + url + " -> " + p)
    return paths


def main():
    ap = argparse.ArgumentParser(description="NENRIN witness records <-> SEP-3004 audit record chain")
    sub = ap.add_subparsers(dest="cmd")
    e = sub.add_parser("export", help="project witness records into a chain segment")
    e.add_argument("inputs", nargs="*", help="walk_*.json files or GET /witness/<sha> bodies")
    e.add_argument("--fetch", nargs="*", default=[], help="record sha256s to fetch from the ledger first")
    e.add_argument("--out", default="sep3004_out", help="output directory (chain.jsonl, manifest.json, anchors.json)")
    e.add_argument("--extensions", choices=["full", "registered"], default="full", help="full = caller-governance + conduct-witness (proposed); registered = caller-governance only")
    e.add_argument("--prev-hash", default=None, help="continue a segment: event_hash of the record this segment follows")
    v = sub.add_parser("verify", help="section 2.6 over a chain.jsonl")
    v.add_argument("chain")
    v.add_argument("--json", action="store_true")
    sub.add_parser("kat", help="reproduce the SEP's known-answer digests")
    sub.add_parser("selftest")
    a = ap.parse_args()
    try:
        if a.cmd == "kat":
            return 0 if kat() else 1
        if a.cmd == "selftest":
            return 0 if selftest() else 1
        if a.cmd == "verify":
            recs = read_chain(a.chain)
            ok, fails, finds = verify_chain(recs)
            if a.json:
                print(json.dumps({"ok": ok, "records": len(recs), "failures": fails, "findings": finds}, ensure_ascii=False, indent=1))
            else:
                print(("verified" if ok else "FAILED") + ": " + str(len(recs)) + " records, " + str(len(fails)) + " failures, " + str(len(finds)) + " findings")
                for f in fails:
                    print("  failure: " + f)
                for f in finds:
                    print("  finding: " + f)
            return 0 if ok else 1
        if a.cmd == "export":
            paths = list(a.inputs)
            if a.fetch:
                paths += fetch(a.fetch, os.path.join(a.out, "inputs"))
            if not paths:
                ap.error("no inputs")
            if a.prev_hash is not None and not HEX64.match(a.prev_hash):
                raise Refuse("--prev-hash must be 64 lowercase hex")
            chain, man, cp = export(paths, a.out, a.extensions, a.prev_hash)
            print("chain: " + cp + "  (" + str(len(chain)) + " records, extensions " + a.extensions + ")")
            for r in chain:
                print("  " + r["occurred_at"] + "  " + r["outcome"] + "  " + str(r["tool_name"]) + "  event " + r["event_id"][:12] + "  hash " + r["event_hash"][:12])
            print("manifest: " + os.path.join(a.out, "manifest.json") + "   anchors: " + os.path.join(a.out, "anchors.json"))
            print("verify:   python3 " + os.path.basename(__file__) + " verify " + cp)
            return 0
        ap.print_help()
        return 2
    except Refuse as ex:
        print("refused: " + str(ex), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
