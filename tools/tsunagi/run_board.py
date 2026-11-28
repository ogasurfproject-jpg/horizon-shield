#!/usr/bin/env python3
"""TSUNAGI (繋): every night, run every registered implementation against the corpora and publish where they agree.

    python3 tools/tsunagi/run_board.py --out ops/tsunagi            (from the repository root; clones into a temp dir)
    python3 tools/tsunagi/run_board.py --out /tmp/b --ext-dir DIR    (reuse clones already in DIR, no network)
    python3 tools/tsunagi/run_board.py --out /tmp/b --only ID --local ID=PATH
                                      (try your row against your own working copy before you open the pull request)

Refereed runs (parse "batch_referee"): for the NENRIN corpora the board does not take an implementation's own count on
trust. It writes the fixtures as one batch file (@in), the implementation writes one verdict signature per fixture
(@out), and the board compares each with the corpus's frozen expected.json itself, using the same referee that ships
in the PyPI package (nenrin-tsunagi). A cell says who scored it: the board, or the implementation's own report.

Nightly differential: the adversary in conformance-v0 signs a fresh set of edge bundles every run (new keys, no
frozen answer), every implementation that can take a batch reads them, and the board lists each bundle on which two
of them disagree. A disagreement is a finding about the spec, the reference or the other implementation; a person
triages it, never this script.

History and badges: each run is added to history.json (consecutive passing runs, the commit each cell last moved to),
and badges/<id>.json is a shields.io endpoint an author can put in their own README.

The ledger, graded by an outside checker (ledger_vlc.py): each night this project's own JIDEC ledger is read by VLC-1's
vlc-check 1.0.0 (Matthew Moore, MIT; wheel and adapter pinned by sha256) against the head in the newest checkpoint entry
whose OpenTimestamps proof is in a Bitcoin block; the board checks that proof and the block header itself, and every head
stamped inside the entries it reads. The row is in board.json (ledger_vlc), history.json and BOARD.md. It needs the
network; it is skipped with --only or --no-ledger-vlc.

Each row of implementations.json is code in its author's own repository. The board clones it at the default branch
head, runs the command in the row against this repository's corpus, and records the commit it ran, the exit code,
the counts and, where the implementation prints them, one result per vector. Rows marked ours are one column among
the others. A disagreement is written down as a disagreement; nothing here turns it into a pass.

What a green cell establishes: that this code, at this commit, reproduced this corpus's expectations on this run.
What it does not: that the corpus is right, that the code is correct elsewhere, or anything about who wrote it.

Writes board.json (the whole result, canonical JSON, with its own sha256) and BOARD.md (the table people read).
The cloning and running part needs no token and no secret; the workflow runs it with a read-only token.
"""
import argparse, hashlib, importlib.util, json, os, re, shutil, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
TIMEOUT = 900
NENRIN = os.path.join(ROOT, "workers", "hs-ledger", "nenrin")
HISTORY_KEEP = 60
KEEP_REPORTS = None   # --keep-reports DIR: write each crosswalk comparison report the board scored, by implementation and mode
# What outside code must not be able to change between runs: the corpora the board scores against, the generator, and
# the board's own tools and adapters. Snapshotted before anything outside runs, checked and restored after each run.
GUARDED = [os.path.join(NENRIN, d) for d in ("interop-v0", "interop-v0.1", "interop-v0.2", "interop-v0.3", "conformance-v0", "sdk", "sdk-python/src",
                                             "musubi-v0", "trace-intake-v0", "trace-bind-v0", "trace-span-v0", "trace-pin-v0",
                                             "vate-s3-v0")] + [HERE]

# The a2a-approval-v2 vectors (babyblueviper1, settle v1.10's approver), refereed by the board from this repository's pinned copy,
# not from the author's repository: an implementation cannot change the answers it is scored against (2026-10-09, #34).
APPROVAL_CORPORA = {
    "musubi-approval-v2": (os.path.join(NENRIN, "musubi-v0", "fixtures", "babyblueviper1_approver_v2", "vectors.json"),
                           "75b03692f44bc7dd68791e2135d9f8c11569cc95e86fce35bf866906b7904c9b"),
}


def load_approval_corpus(name):
    """(cases {id: {result, reason}}, batch [{name, contract, approval}]). The batch carries no expected value."""
    path, pin = APPROVAL_CORPORA[name]
    raw = open(path, "rb").read()
    if hashlib.sha256(raw).hexdigest() != pin:
        raise ValueError("%s does not match its pinned sha256" % os.path.relpath(path, ROOT))
    V = json.loads(raw.decode("utf-8"))
    cases = {v["id"]: {"result": v["expect"]["result"], "reason": v["expect"].get("reason")} for v in V["vectors"]}
    batch = [{"name": v["id"], "contract": V["contracts"][v["contract"]], "approval": v.get("approval")} for v in V["vectors"]]
    return cases, batch


def score_approval(cases, result, total):
    """Compare each {result, reason} with the pinned expectation, exactly. A missing case, an error, an extra key or an extra
    case counts against the implementation. Same shape of cell as the NENRIN referee's."""
    per, n = {}, 0
    ok_out = isinstance(result, dict)
    for k, want in cases.items():
        got = result.get(k) if ok_out else None
        good = (isinstance(got, dict) and set(got) <= {"result", "reason"}
                and got.get("result") == want["result"] and got.get("reason") == want["reason"])
        n += good
        per[k] = {"ok": good, "result": got.get("result") if isinstance(got, dict) else None,
                  "reason": got.get("reason") if isinstance(got, dict) else None, "want": want}
        if isinstance(got, dict) and "error" in got:
            per[k]["error"] = str(got["error"])[:200]
    extra = sorted(set(result) - set(cases))[:20] if ok_out else []
    out = {"reproduced": n, "of": len(cases), "expected_total": total, "per_vector": per, "scored_by": "board"}
    if extra:
        out["extra_cases"] = extra
    if result is None:
        out["problem"] = "the implementation wrote no readable output file"
    elif not ok_out:
        out["problem"] = "the output file is not a JSON object keyed by case name"
    return out


# Crosswalks: an outside tool that compares two checkers' reports. The board runs it, reads the comparison report it
# writes, and compares every finding with this repository's pinned expectations itself; the tool's exit code is recorded
# but is not the result (2026-10-14, Poke-nushi's NENRIN and VATE S3 crosswalk, VATE #84).
CROSSWALK_CORPORA = {
    "vate-nenrin-s3-crosswalk-v0": (os.path.join(HERE, "expected", "vate-nenrin-s3-crosswalk-v0.json"),
                                    "a339c11bd95cde67dd5b125ee8c946bb08db6a4687e628ab84b72919b1c96919"),
}


def load_crosswalk_expected(name):
    path, pin = CROSSWALK_CORPORA[name]
    raw = open(path, "rb").read()
    if hashlib.sha256(raw).hexdigest() != pin:
        raise ValueError("%s does not match its pinned sha256" % os.path.relpath(path, ROOT))
    E = json.loads(raw.decode("utf-8"))
    rec = E["records"]
    ours = {c: open(os.path.join(ROOT, rec["ours"], c, rec["file"]), "rb").read() for c in E["cases"]}   # before outside code runs
    return E, ours


def _dig(obj, *keys):
    for k in keys:
        if not isinstance(obj, dict) or k not in obj:
            return None
        obj = obj[k]
    return obj


def _native_sig(rep):
    """verdict plus the refusals as a sorted list of [code, reason]: what the expectations file states for each verifier."""
    if not isinstance(rep, dict) or not isinstance(rep.get("refusals"), list):
        return None
    try:
        refs = sorted([[x.get("code"), x.get("reason")] for x in rep["refusals"]], key=lambda r: json.dumps(r))
    except AttributeError:
        return None
    return {"verdict": rep.get("verdict"), "refusals": refs}


def score_crosswalk(expected, report, mode, records_dir, total, ours):
    """Compare a crosswalk's comparison report with the pinned expectations, finding by finding, and count a case only
    when every one of its findings matches (as agreed in VATE #84). Per case: the NENRIN records it compared are byte for
    byte this repository's, each relationship CW-01..CW-11 has the expected status, each NENRIN verifier (npm, PyPI) has
    the expected verdict and refusals, and VATE has the expected assessment and record_linkage with
    retry_authorized false. The report's
    schema, pins and evidence modes must be the expected ones for this mode."""
    E = expected
    per, problems = {}, []
    want_modes = E["evidence_modes"].get(mode)
    rec = E["records"]
    if not isinstance(report, dict):
        problems.append("the crosswalk wrote no readable comparison report" if report is None else "the report is not a JSON object")
        report = {}
    else:
        if report.get("schema") != E["report_schema"]:
            problems.append("report schema %r, expected %r" % (report.get("schema"), E["report_schema"]))
        for k, v in E["pins"].items():
            if _dig(report, "pins", k) != v:
                problems.append("pins.%s is %r, expected %r" % (k, _dig(report, "pins", k), v))
        if report.get("evidence_modes") != want_modes:
            problems.append("evidence modes %r, expected %r for mode %s" % (report.get("evidence_modes"), want_modes, mode))
    by = {}
    for c in report.get("cases") if isinstance(report.get("cases"), list) else []:
        if isinstance(c, dict) and isinstance(c.get("nenrin_case"), str):
            by[c["nenrin_case"]] = c
    extra = sorted(set(by) - set(E["cases"]))
    if extra:
        problems.append("cases not in the expectations: " + ", ".join(extra[:10]))
    for case, want in E["cases"].items():
        got = by.get(case)
        theirs = None
        if records_dir:
            try:
                theirs = open(os.path.join(records_dir, case, rec["file"]), "rb").read()
            except OSError:
                theirs = None
        r = "identical" if theirs is not None and theirs == ours[case] else ("missing" if theirs is None else "different bytes")
        f = {"records": {"ok": r == "identical", "result": r, "want": "identical"}}
        if got is not None:
            if got.get("vate_case") != want["vate_case"]:
                problems.append("%s is paired with VATE case %r, expected %r" % (case, got.get("vate_case"), want["vate_case"]))
            if got.get("evidence_modes") != want_modes:
                problems.append("%s evidence modes %r, expected %r" % (case, got.get("evidence_modes"), want_modes))
        rels = {}
        for x in (got or {}).get("relationships") or []:
            if isinstance(x, dict) and isinstance(x.get("id"), str):
                rels[x["id"]] = x.get("status")
        for rid, st in want["relationships"].items():
            f[rid] = {"ok": rels.get(rid) == st, "result": rels.get(rid), "want": st}
        for k, w in want["native"].items():
            g = _native_sig(_dig(got, "native_reports", k, "report"))
            f["native." + k] = {"ok": g == w, "result": g, "want": w}
        vr = _dig(got, "vate_report", "report")
        g = {k: vr.get(k) for k in want["vate"]} if isinstance(vr, dict) else None
        f["vate"] = {"ok": g == want["vate"], "result": g, "want": want["vate"]}
        bad = [k for k, v in f.items() if not v["ok"]]
        per[case] = {"ok": not bad and got is not None, "result": "all %d findings match" % len(f) if not bad else
                     ("not in the report" if got is None else "differs: " + ", ".join(bad)),
                     "reason": None, "want": "all %d findings" % len(f), "findings": f}
    n = sum(1 for v in per.values() if v["ok"])
    out = {"reproduced": n, "of": len(per), "expected_total": total, "per_vector": per, "scored_by": "board",
           "passed": n == len(per) == total and not problems}
    if problems:
        out["problems"] = problems[:20]
        out["problem"] = problems[0]
    return out


def snapshot():
    snap = {}
    for top in GUARDED:
        for dp, dn, fn in os.walk(top):
            dn[:] = [d for d in dn if d not in ("__pycache__", "node_modules", ".git")]
            for f in fn:
                if f.endswith(".pyc"):
                    continue
                path = os.path.join(dp, f)
                with open(path, "rb") as fh:
                    snap[path] = fh.read()
    return snap


def restore_if_changed(snap):
    """Put back any guarded file an outside run changed; return the paths it changed (relative), empty if none."""
    changed = []
    for path, data in snap.items():
        try:
            cur = open(path, "rb").read()
        except OSError:
            cur = None
        if cur != data:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as fh:
                fh.write(data)
            changed.append(os.path.relpath(path, ROOT))
    return changed


def _referee():
    """The referee module from the PyPI package source, loaded by path so the board needs nothing installed."""
    path = os.path.join(NENRIN, "sdk-python", "src", "nenrin_verify", "tsunagi.py")
    spec = importlib.util.spec_from_file_location("tsunagi_referee", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


REFEREE = _referee()


def _ledger_vlc():
    """ledger_vlc.py beside this file, loaded by path like the referee, before any outside code runs."""
    spec = importlib.util.spec_from_file_location("tsunagi_ledger_vlc", os.path.join(HERE, "ledger_vlc.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


LEDGER_VLC = _ledger_vlc()


def canonical(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sh(cmd, cwd=None, env=None, timeout=TIMEOUT):
    e = dict(os.environ)
    e.update(env or {})
    t0 = time.time()
    try:
        r = subprocess.run(cmd, cwd=cwd, env=e, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout, r.stderr, round(time.time() - t0, 1)
    except subprocess.TimeoutExpired as x:
        return 124, x.stdout or "", "timeout after %ss" % timeout, round(time.time() - t0, 1)
    except FileNotFoundError as x:
        return 127, "", str(x), 0.0


def clone(repo, dest, pin=None):
    """Clone the default branch head, or, when the row names a pin, exactly that commit (a full 40-hex sha agreed with
    the author). A pin that cannot be fetched, or that does not resolve to itself, is a clone error, never a quiet
    fallback to the head."""
    if not os.path.isdir(os.path.join(dest, ".git")):
        code, out, err, _ = sh(["git", "clone", "-q", "--depth", "1", repo, dest], timeout=600)
        if code != 0:
            return False, err.strip()[-300:]
    if pin:
        if not re.fullmatch(r"[0-9a-f]{40}", pin):
            return False, "pin must be a full 40-hex commit sha"
        code, out, err, _ = sh(["git", "-C", dest, "fetch", "-q", "--depth", "1", "origin", pin], timeout=600)
        if code != 0:
            return False, ("pinned commit %s could not be fetched: " % pin) + err.strip()[-200:]
        code, out, err, _ = sh(["git", "-C", dest, "checkout", "-q", "--detach", pin])
        if code != 0 or head(dest) != pin:
            return False, "pinned commit %s could not be checked out" % pin
    return True, ""


def head(dest):
    code, out, _, _ = sh(["git", "-C", dest, "rev-parse", "HEAD"])
    return out.strip() if code == 0 else None


# ---- parsing what each implementation prints ------------------------------------------------------------------
def parse_count_line(out):
    m = re.findall(r"(\d+)/(\d+) verdict signatures reproduced", out)
    return (int(m[-1][0]), int(m[-1][1]), None) if m else (None, None, None)


def parse_all_pass(out, total):
    return (total, total, None) if "ALL PASS" in out else (0, total, None)


def parse_approval_lines(out):
    per = {}
    for line in out.splitlines():
        m = re.match(r"^(ok|NG)\s+(\S+)\s+(\S+)\s*(\S*)\s*$", line)
        if m:
            per[m.group(2)] = {"ok": m.group(1) == "ok", "result": m.group(3), "reason": m.group(4) or None}
    m = re.findall(r"(\d+)/(\d+) agree", out)
    n, t = (int(m[-1][0]), int(m[-1][1])) if m else (sum(v["ok"] for v in per.values()), len(per))
    return n, t, per or None


def parse_json_results(out):
    try:
        d = json.loads(out[out.index("{"):])
    except (ValueError, json.JSONDecodeError):
        return None, None, None
    res = d.get("results") or []
    per = {r["id"]: {"ok": bool(r.get("matches")), "canonical_sha256": r.get("canonical_sha256")} for r in res if "id" in r}
    return sum(v["ok"] for v in per.values()), len(per), per


def parse_pytest(out):
    p = re.findall(r"(\d+) passed", out)
    f = re.findall(r"(\d+) failed", out)
    n = int(p[-1]) if p else 0
    return n, n + (int(f[-1]) if f else 0), None


def parse(kind, code, out, total):
    if kind == "count_line":
        n, t, per = parse_count_line(out)
    elif kind == "all_pass":
        n, t, per = parse_all_pass(out, total)
    elif kind == "approval_lines":
        n, t, per = parse_approval_lines(out)
    elif kind == "json_results":
        n, t, per = parse_json_results(out)
    elif kind == "pytest":
        n, t, per = parse_pytest(out)
    else:
        raise ValueError("unknown parse kind %r" % kind)
    passed = code == 0 and n is not None and n == t == total
    return {"reproduced": n, "of": t, "expected_total": total, "passed": passed, "per_vector": per}


def expand(s, impl_dir, board_dir, vectors, io=None):
    if not isinstance(s, str):
        return s
    if s.startswith("@vectors:"):
        return vectors.get(s[len("@vectors:"):], s)
    if io:
        for k, v in io.items():
            s = s.replace(k, v)
    return (s.replace("@hs", ROOT).replace("@impl", impl_dir or "/nonexistent").replace("@board", board_dir))


def run_batch(cases_batch, cmd, cwd, env, impl_dir, vectors):
    """Write a batch, run a batch-capable implementation on it, return (exit, out dict or None, seconds, stderr tail)."""
    with tempfile.TemporaryDirectory(prefix="tsunagi-io-") as t:
        io = {"@in": os.path.join(t, "in.json"), "@out": os.path.join(t, "out.json")}
        with open(io["@in"], "w", encoding="utf-8") as f:
            if isinstance(cases_batch, str):   # a refereed corpus: the fixtures' exact bytes (REFEREE.batch_text)
                f.write(cases_batch)
            else:
                json.dump(cases_batch, f, ensure_ascii=False)
        argv = [expand(x, impl_dir, HERE, vectors, io) for x in cmd]
        code, out, err, secs = sh(argv, cwd=cwd, env=env)
        try:
            result = REFEREE.read_output(io["@out"])
        except Exception:  # missing, too large, not JSON, too deep: scored as no output
            result = None
    return code, result, secs, (err or out).strip()[-300:]


def refereed(corpus, code, result, total, cases=None):
    if cases is None:
        cases, _ = REFEREE.load_corpus(corpus, NENRIN)
    res = REFEREE.score(cases, result)
    per = {k: {"ok": v["ok"], "result": v["got"], "reason": None, "want": v["want"]} for k, v in res["per_vector"].items()}
    passed = code == 0 and result is not None and res["reproduced"] == res["of"] == total and not res["extra"]
    out = {"reproduced": res["reproduced"], "of": res["of"], "expected_total": total, "passed": passed, "per_vector": per,
           "scored_by": "board"}
    if res["extra"]:
        out["extra_cases"] = res["extra"]
        if res.get("extra_more"):
            out["extra_cases_more"] = res["extra_more"]
    if result is None:
        out["problem"] = "the implementation wrote no readable output file"
    return out


def run_board(spec, ext_dir, local=None):
    rows, vectors, heads, dirs = [], {}, {}, {}
    local = local or {}
    corpora = {n: REFEREE.load_corpus(n, NENRIN) for n in REFEREE.CORPORA}   # read before any outside code runs
    batch_texts = {n: REFEREE.batch_text(n, NENRIN) for n in REFEREE.CORPORA}
    approval = {n: load_approval_corpus(n) for n in APPROVAL_CORPORA}
    crosswalk = {n: load_crosswalk_expected(n) for n in CROSSWALK_CORPORA}
    snap = snapshot()
    for impl in spec["implementations"]:
        impl_dir = None
        info = {"id": impl["id"], "ours": impl["ours"], "author": impl["author"], "repo": impl.get("repo"),
                "language": impl.get("language"), "license": impl.get("license"), "commit": None, "clone_error": None}
        if impl["id"] in local:
            impl_dir = os.path.abspath(local[impl["id"]])
            info["commit"] = head(impl_dir) or "local-working-copy"
            info["local"] = True
        elif impl.get("repo"):
            impl_dir = os.path.join(ext_dir, impl["id"])
            ok, err = clone(impl["repo"], impl_dir, impl.get("pin"))
            if not ok:
                info["clone_error"] = err or "clone failed"
            else:
                info["commit"] = head(impl_dir)
            if impl.get("pin"):
                info["pinned"] = impl["pin"]
        else:
            info["commit"] = head(ROOT)
        heads[impl["id"]] = info
        dirs[impl["id"]] = impl_dir
        for run in impl["runs"]:
            if run.get("vectors") and impl_dir:
                vectors[run["corpus"]] = expand(run["vectors"], impl_dir, HERE, vectors)
            row = {"implementation": impl["id"], "ours": impl["ours"], "corpus": run["corpus"], "commit": info["commit"],
                   "pinned": bool(impl.get("pin")), "mode": run.get("mode", "rerun"),
                   "scored_by": "board" if run["parse"] in BOARD_SCORED else "implementation",
                   "expected_total": run["total"]}
            if "mode" in run:
                row["mode_declared"] = True
            if info["clone_error"]:
                row.update({"status": "not_run", "reason": "the repository could not be cloned: " + info["clone_error"]})
                rows.append(row); continue
            cwd = expand(run["cwd"], impl_dir, HERE, vectors)
            env = {k: expand(v, impl_dir, HERE, vectors) for k, v in (run.get("env") or {}).items()}
            if run.get("setup"):
                code, out, err, secs = sh([expand(x, impl_dir, HERE, vectors) for x in run["setup"]], cwd=cwd, env=env)
                if code != 0:
                    row.update({"status": "not_run", "reason": "setup failed (exit %d): %s" % (code, (err or out).strip()[-300:])})
                    rows.append(row); continue
            if run["parse"] == "crosswalk_findings":
                E, ours = crosswalk[run["corpus"]]
                with tempfile.TemporaryDirectory(prefix="tsunagi-io-") as t:
                    io = {"@out": os.path.join(t, "report.json")}
                    code, out, err, secs = sh([expand(x, impl_dir, HERE, vectors, io) for x in run["cmd"]], cwd=cwd, env=env)
                    try:
                        report = REFEREE.read_output(io["@out"])
                    except Exception:  # missing, too large, not JSON: scored as no report
                        report = None
                    if report is not None:
                        raw = open(io["@out"], "rb").read()
                        row["report_sha256"] = hashlib.sha256(raw).hexdigest()
                        if KEEP_REPORTS:
                            os.makedirs(KEEP_REPORTS, exist_ok=True)
                            with open(os.path.join(KEEP_REPORTS, "%s__%s.json" % (impl["id"], run.get("mode", "rerun"))), "wb") as fh:
                                fh.write(raw)
                records_dir = expand(run["records"], impl_dir, HERE, vectors) if run.get("records") else None
                res = score_crosswalk(E, report, run.get("mode", "rerun"), records_dir, run["total"], ours)
                row.update({"status": "ran", "exit": code, "seconds": secs, **res})
                if report is None or code != 0:
                    row["stderr_tail"] = (err or out).strip()[-300:]
                tampered = restore_if_changed(snap)
                if tampered:
                    row.update({"passed": False, "tampered_with": tampered[:20],
                                "problem": "the run changed files the board scores against; they were restored and the cell is not a pass"})
                rows.append(row)
                continue
            if run["parse"] in ("batch_referee", "batch_approval_referee"):
                if run["parse"] == "batch_referee":
                    cases, _ = corpora[run["corpus"]]
                    code, result, secs, tail = run_batch(batch_texts[run["corpus"]], run["cmd"], cwd, env, impl_dir, vectors)
                    res = refereed(run["corpus"], code, result, run["total"], cases)
                else:
                    cases, batch = approval[run["corpus"]]
                    code, result, secs, tail = run_batch(batch, run["cmd"], cwd, env, impl_dir, vectors)
                    res = score_approval(cases, result, run["total"])
                    res["passed"] = (code == 0 and isinstance(result, dict) and res["reproduced"] == res["of"] == run["total"]
                                     and not res.get("extra_cases"))
                row.update({"status": "ran", "exit": code, "seconds": secs, **res})
                if result is None or code != 0:
                    row["stderr_tail"] = tail
                tampered = restore_if_changed(snap)
                if tampered:
                    row.update({"passed": False, "tampered_with": tampered[:20],
                                "problem": "the run changed files the board scores against; they were restored and the cell is not a pass"})
                rows.append(row)
                continue
            cmd = [expand(x, impl_dir, HERE, vectors) for x in run["cmd"]]
            code, out, err, secs = sh(cmd, cwd=cwd, env=env)
            res = parse(run["parse"], code, out, run["total"])
            res["scored_by"] = "implementation"
            row.update({"status": "ran", "exit": code, "seconds": secs, "stdout_sha256": hashlib.sha256(out.encode()).hexdigest(), **res})
            if code != 0 and not out.strip():
                row["stderr_tail"] = err.strip()[-300:]
            tampered = restore_if_changed(snap)
            if tampered:
                row.update({"passed": False, "tampered_with": tampered[:20],
                            "problem": "the run changed files the board scores against; they were restored and the cell is not a pass"})
            rows.append(row)
    pairs = []
    by = {(r["implementation"], r["corpus"], r["scored_by"]): r for r in rows}
    for p in spec.get("pairs", []):
        sb = p.get("scored_by", "implementation")
        a, b = by.get((p["a"], p["corpus"], sb)), by.get((p["b"], p["corpus"], sb))
        out = {"corpus": p["corpus"], "a": p["a"], "b": p["b"], "what": p["what"], "scored_by": sb}
        if not a or not b or a.get("status") != "ran" or b.get("status") != "ran":
            out.update({"agree": None, "reason": "one side did not run"})
        elif a.get("per_vector") and b.get("per_vector"):
            ids = sorted(set(a["per_vector"]) | set(b["per_vector"]))
            same = [i for i in ids if i in a["per_vector"] and i in b["per_vector"]
                    and a["per_vector"][i].get("result") is not None and b["per_vector"][i].get("result") is not None
                    and (a["per_vector"][i].get("result"), a["per_vector"][i].get("reason")) == (b["per_vector"][i].get("result"), b["per_vector"][i].get("reason"))]
            out.update({"agree": len(same) == len(ids), "same": len(same), "of": len(ids),
                        "differ": [i for i in ids if i not in same]})
        else:
            out.update({"agree": bool(a["passed"] and b["passed"]), "same": None, "of": None,
                        "basis": "both reproduce every expectation of the corpus"})
        pairs.append(out)
    diff = differential(spec, heads, dirs, vectors, snap)
    return rows, pairs, heads, diff


def _cell(v):
    sig = REFEREE.signature(v)
    if sig is not None:
        return REFEREE.short(sig)
    if isinstance(v, dict) and "error" in v:
        return "error: " + str(v.get("error"))[:120]
    return "missing" if v is None else "not a verdict signature"


def differential(spec, heads, dirs, vectors, snap=None):
    """Fresh signed bundles from the adversary, read by every batch-capable implementation; list the disagreements."""
    d = spec.get("differential")
    if not d or not [e for e in d.get("implementations", []) if e["id"] in heads]:
        return None
    with tempfile.TemporaryDirectory(prefix="tsunagi-gen-") as t:
        gen = os.path.join(t, "gen.json")
        g = d["generator"]
        code, out, err, _ = sh([expand(x, None, HERE, vectors, {"@gen": gen}) for x in g["cmd"]], cwd=expand(g["cwd"], None, HERE, vectors))
        try:
            batch = json.load(open(gen, encoding="utf-8"))
        except (OSError, ValueError):
            return {"status": "not_run", "reason": "the generator failed (exit %d): %s" % (code, (err or out).strip()[-300:])}
    results, skipped = {}, {}
    for entry in d["implementations"]:
        iid = entry["id"]
        if iid not in heads:
            continue
        if heads[iid].get("clone_error"):
            skipped[iid] = "not cloned"
            continue
        impl_dir = dirs.get(iid)
        cwd = expand(entry["cwd"], impl_dir, HERE, vectors)
        env = {k: expand(v, impl_dir, HERE, vectors) for k, v in (entry.get("env") or {}).items()}
        try:
            code, result, secs, tail = run_batch(batch, entry["cmd"], cwd, env, impl_dir, vectors)
        except Exception as x:  # one implementation's failure never stops the board
            skipped[iid] = "the run failed: %s" % type(x).__name__
            continue
        if snap is not None and restore_if_changed(snap):
            skipped[iid] = "the run changed files the board scores against; they were restored and its results are not used"
            continue
        if not isinstance(result, dict):
            skipped[iid] = "no readable output (exit %d): %s" % (code, tail)
            continue
        results[iid] = {c["name"]: _cell(result.get(c["name"])) for c in batch}
    ids = sorted(results)
    dis = []
    for c in batch:
        seen = {i: results[i][c["name"]] for i in ids}
        if len(set(seen.values())) > 1:
            dis.append({"case": c["name"], "by": seen})
    return {"status": "ran", "generator": " ".join(g["cmd"]), "bundles": len(batch), "implementations": ids,
            "skipped": skipped, "agree": len(batch) - len(dis), "disagreements": dis,
            "note": "fresh keys and signatures every run; there is no frozen answer, only whether the implementations agree"}


BOARD_SCORED = ("batch_referee", "batch_approval_referee", "crosswalk_findings")


def cell_key(r):
    """One history cell per implementation, corpus, scorer and, for a crosswalk's saved row, mode."""
    return (r["implementation"] + " | " + r["corpus"] + (" | board" if r.get("scored_by") == "board" else "")
            + (" | saved" if r.get("mode") == "saved" else ""))


def update_history(prev, board):
    """Per cell: consecutive passing runs, first pass, the commit it last moved to; keeps the last HISTORY_KEEP runs."""
    hist = {"schema": "hs-tsunagi-history-v0", "cells": {}}
    if isinstance(prev, dict) and isinstance(prev.get("cells"), dict):
        hist["cells"] = prev["cells"]
    day = board["measured_at"]
    for r in board["runs"]:
        key = cell_key(r)
        c = hist["cells"].get(key) or {"first_seen": day, "first_pass": None, "streak": 0, "commit": None, "commit_since": day, "runs": []}
        passed = bool(r.get("passed"))
        c["streak"] = c["streak"] + 1 if passed else 0
        if passed and not c["first_pass"]:
            c["first_pass"] = day
        commit = (r.get("commit") or "")[:12]
        if commit != c.get("commit"):
            c["commit"], c["commit_since"] = commit, day
        c["runs"] = (c["runs"] + [[day, passed, commit[:8]]])[-HISTORY_KEEP:]
        hist["cells"][key] = c
    if isinstance(prev, dict) and isinstance(prev.get("ledger_vlc"), list):
        hist["ledger_vlc"] = prev["ledger_vlc"]
    if isinstance(board.get("ledger_vlc"), dict):   # one row a night: the ledger's VLC-1 grade (ledger_vlc.history_row)
        hist["ledger_vlc"] = (hist.get("ledger_vlc", []) + [LEDGER_VLC.history_row(day, board["ledger_vlc"])])[-HISTORY_KEEP:]
    return hist


def badges(board):
    """One shields.io endpoint per implementation: everything it reproduced on this run, over everything expected."""
    out = {}
    by = {}
    for r in board["runs"]:
        by.setdefault(r["implementation"], []).append(r)
    for iid, runs in by.items():
        if any(r.get("scored_by") == "board" for r in runs):
            runs = [r for r in runs if r.get("scored_by") == "board"]   # the board's own score, not the same corpus twice
        ran = [r for r in runs if r.get("status") == "ran"]
        n = sum(r.get("reproduced") or 0 for r in ran)
        t = sum(r.get("expected_total") or 0 for r in runs)
        allp = bool(runs) and all(r.get("passed") for r in runs)
        ref = any(r.get("scored_by") == "board" for r in ran)
        msg = "%d/%d reproduced%s" % (n, t, ", refereed" if ref else "")
        color = "brightgreen" if allp else ("lightgrey" if not ran else "red")
        out[iid] = {"schemaVersion": 1, "label": "TSUNAGI", "message": msg, "color": color, "cacheSeconds": 3600}
    return out


RAW = "https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/ops/tsunagi/badges/"


def to_md(board, hist=None):
    cells = (hist or {}).get("cells", {})
    s = board["summary"]
    L = ["# TSUNAGI board", "",
         "Every night each registered implementation, cloned from its author's own repository, runs against the corpora "
         "in this repository. A cell is one run of one implementation at one commit. Rows marked ours are this "
         "project's own code, one column among the others. Generated by `tools/tsunagi/run_board.py`; the whole "
         "result is `board.json` (sha256 `%s`)." % board["board_sha256"], "",
         "Run at %s. %d of %d runs reproduced every expectation; %d of them scored by the board itself; %d by authors outside this project." % (
             board["measured_at"], s["passed"], s["runs"], s.get("refereed_passed", 0), s["outside_passed"]), "",
         "Scored by: **board** means the board handed the implementation the fixtures and compared every verdict signature "
         "with the frozen expectations itself; **self** means the cell repeats the count the implementation printed.", "",
         "| implementation | author | corpus | result | scored by | passing runs in a row | commit |", "|---|---|---|---|---|---|---|"]
    heads = board["implementations"]
    for r in board["runs"]:
        h = heads[r["implementation"]]
        who = h["author"] + (" (this project)" if r["ours"] else "")
        if r["status"] != "ran":
            res = "not run: " + r["reason"]
        else:
            res = "%s %s/%s" % ("pass" if r["passed"] else "FAIL", r.get("reproduced"), r.get("expected_total"))
        link = r["implementation"] if not h["repo"] else "[%s](%s)" % (r["implementation"], h["repo"][:-4] if h["repo"].endswith(".git") else h["repo"])
        c = cells.get(cell_key(r), {})
        streak = str(c.get("streak", "")) + ((" (since %s)" % c["first_pass"][:10]) if c.get("first_pass") and c.get("streak") else "")
        by = {"board": "board", "implementation": "self"}.get(r.get("scored_by"), "")
        corpus = r["corpus"] + ((" (%s)" % {"saved": "saved reports", "rerun": "checkers run again"}.get(r.get("mode"), r.get("mode")))
                                if r.get("mode_declared") else "")
        L.append("| %s | %s | %s | %s | %s | %s | `%s`%s |" % (link, who, corpus, res, by, streak, (r.get("commit") or "")[:8],
                                                            " pinned" if r.get("pinned") else ""))
    L += ["", "## Two implementations, one corpus", "", "| corpus | a | b | scored by | agree |", "|---|---|---|---|---|"]
    for p in board["pairs"]:
        if p["agree"] is None:
            ag = "not compared: " + p["reason"]
        elif p.get("of"):
            ag = "%s, %d/%d vectors%s" % ("yes" if p["agree"] else "NO", p["same"], p["of"], "" if p["agree"] else " (differ: " + ", ".join(p["differ"]) + ")")
        else:
            ag = ("yes" if p["agree"] else "NO") + ", " + p["basis"]
        L.append("| %s | %s | %s | %s | %s |" % (p["corpus"], p["a"], p["b"], {"board": "board"}.get(p.get("scored_by"), "self"), ag))
    d = board.get("differential")
    if d:
        L += ["", "## Tonight's fresh bundles", ""]
        if d.get("status") != "ran":
            L.append("Not run: " + d["reason"])
        else:
            L.append("The adversary (`%s`) signed %d new bundles with new keys. Every implementation that takes a batch read them; "
                     "there is no frozen answer, only whether they agree. Implementations: %s." % (d["generator"], d["bundles"], ", ".join(d["implementations"])))
            L.append("")
            if not d["disagreements"]:
                L.append("They agree on all %d." % d["bundles"])
            else:
                L.append("They agree on %d of %d. Each disagreement below is a finding about the spec, the reference or an "
                         "implementation, triaged by a person:" % (d["agree"], d["bundles"]))
                L += ["", "| bundle | " + " | ".join(d["implementations"]) + " |", "|---|" + "---|" * len(d["implementations"])]
                esc = lambda t: str(t).replace("|", "\\|")
                for x in d["disagreements"]:
                    L.append("| %s | %s |" % (esc(x["case"]), " | ".join(esc(x["by"][i]) for i in d["implementations"])))
            for k, v in sorted(d.get("skipped", {}).items()):
                L.append("")
                L.append("Skipped %s: %s" % (k, v))
    lv = board.get("ledger_vlc")
    if isinstance(lv, dict):
        L += ["", "## The ledger, graded by an outside checker", ""] + LEDGER_VLC.to_md(lv, (hist or {}).get("ledger_vlc"))
    L += ["", "## Join", "",
          "Add your implementation with one pull request: a row in `tools/tsunagi/implementations.json` naming your "
          "public repository, the command, and the corpus. It appears on the next night's board, at your own commit, "
          "in your own repository. A green cell is a reproduction on that run, not an endorsement. "
          "Before you open it, `pip install nenrin-verify` and run `nenrin-tsunagi run <corpus> -- <your command>`: "
          "it scores your verifier exactly as the board does. `tools/tsunagi/README.md` has the contract.", "",
          "Each implementation has a badge you can put in your own README:", "",
          "```", "![TSUNAGI](https://img.shields.io/endpoint?url=%s<implementation-id>.json)" % RAW, "```", ""]
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--ext-dir")
    ap.add_argument("--only", help="comma separated implementation ids")
    ap.add_argument("--local", action="append", default=[], metavar="ID=PATH", help="use a working copy instead of cloning")
    ap.add_argument("--history-in", help="the previous history.json, to carry streaks forward")
    ap.add_argument("--no-differential", action="store_true")
    ap.add_argument("--keep-reports", metavar="DIR", help="write each crosswalk comparison report the board scored (its sha256 is in board.json either way)")
    ap.add_argument("--no-ledger-vlc", action="store_true", help="skip the ledger's nightly VLC-1 grade (it needs the network; --only skips it too)")
    a = ap.parse_args()
    global KEEP_REPORTS
    KEEP_REPORTS = os.path.abspath(a.keep_reports) if a.keep_reports else None
    spec = json.load(open(os.path.join(HERE, "implementations.json"), encoding="utf-8"))
    if a.only:
        keep = set(a.only.split(","))
        spec["implementations"] = [i for i in spec["implementations"] if i["id"] in keep]
    ext = os.path.abspath(a.ext_dir or tempfile.mkdtemp(prefix="tsunagi-"))
    os.makedirs(ext, exist_ok=True)
    if a.only:
        spec["pairs"] = [p for p in spec.get("pairs", []) if p["a"] in keep and p["b"] in keep]
        if spec.get("differential"):
            spec["differential"]["implementations"] = [e for e in spec["differential"]["implementations"] if e["id"] in keep]
    if a.no_differential:
        spec.pop("differential", None)
    local = dict(x.split("=", 1) for x in a.local)
    prev = None
    if a.history_in and os.path.exists(a.history_in):
        prev = json.load(open(a.history_in, encoding="utf-8"))   # read before any outside code runs
    rows, pairs, heads, diff = run_board(spec, ext, local)
    ledger = None
    if not (a.only or a.no_ledger_vlc):   # after every implementation, with its own snapshot: vlc-check is outside code too
        snap = snapshot()
        ledger = LEDGER_VLC.run(out_dir=os.path.join(os.path.abspath(a.out), "ledger"),
                                earlier=prev.get("ledger_vlc") if isinstance(prev, dict) else None)
        tampered = restore_if_changed(snap)
        if tampered:
            ledger.update({"ok": False, "tampered_with": tampered[:20],
                           "problem": "the run changed files the board scores against; they were restored and the row is not ok"})
    board = {"schema": "hs-tsunagi-board-v1", "measured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
             "repository_commit": head(ROOT), "implementations": heads, "runs": rows, "pairs": pairs, "differential": diff,
             "summary": {"runs": len(rows), "passed": sum(1 for r in rows if r.get("passed")),
                         "outside_passed": sum(1 for r in rows if r.get("passed") and not r["ours"]),
                         "outside_authors_passing": sorted({heads[r["implementation"]]["author"] for r in rows if r.get("passed") and not r["ours"]}),
                         "refereed_passed": sum(1 for r in rows if r.get("passed") and r.get("scored_by") == "board"),
                         "not_run": sum(1 for r in rows if r.get("status") != "ran")}}
    if ledger is not None:
        board["ledger_vlc"] = ledger
    board["board_sha256"] = hashlib.sha256(canonical({k: v for k, v in board.items() if k != "board_sha256"}).encode()).hexdigest()
    os.makedirs(a.out, exist_ok=True)
    hist = update_history(prev, board)
    with open(os.path.join(a.out, "board.json"), "w", encoding="utf-8") as f:
        f.write(json.dumps(board, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    with open(os.path.join(a.out, "history.json"), "w", encoding="utf-8") as f:
        f.write(json.dumps(hist, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
    os.makedirs(os.path.join(a.out, "badges"), exist_ok=True)
    for iid, b in badges(board).items():
        with open(os.path.join(a.out, "badges", iid + ".json"), "w", encoding="utf-8") as f:
            f.write(json.dumps(b, sort_keys=True) + "\n")
    with open(os.path.join(a.out, "BOARD.md"), "w", encoding="utf-8") as f:
        f.write(to_md(board, hist))
    s = board["summary"]
    print("TSUNAGI: %d/%d runs reproduced every expectation (%d refereed by the board, %d outside this project, authors: %s); %d not run; board %s"
          % (s["passed"], s["runs"], s["refereed_passed"], s["outside_passed"], ", ".join(s["outside_authors_passing"]) or "none", s["not_run"], board["board_sha256"][:16]))
    if diff:
        if diff.get("status") == "ran":
            print("differential: %d fresh bundles, %d implementations (%s), agree on %d, disagree on %d"
                  % (diff["bundles"], len(diff["implementations"]), ", ".join(diff["implementations"]), diff["agree"], len(diff["disagreements"])))
        else:
            print("differential: not run: " + diff["reason"])
    if ledger is not None:
        print(LEDGER_VLC.summary(ledger))
    return 0


if __name__ == "__main__":
    sys.exit(main())
