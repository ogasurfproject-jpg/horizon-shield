"""Command line entry points.

  nenrin-verify bundle.json            the provenance report, exit 0 accepted, 1 refused (as npm nenrin-verify)
  nenrin-verify --sha bundle.json      one line: verdict and report_sha256, for comparing with the JavaScript run
  nenrin-verify --selftest             re-run the frozen cases shipped in the package against the JavaScript
                                       output frozen with them (provenance bundles and TSUGI chains), and recompute
                                       MUSUBI run0002 offline; exit 0 only when every one matches
  nenrin-verify furui-day <day> --leaf <i>
                                       the six checks of one leaf of the content check runner's day (furui_day.py)
  nenrin-verify resume-admission <endpoint> <record_sha256>
                                       one admissions[] line of a Resume against the ledger (furui_day.py)
  nenrin-verify tasuki <record_sha256> one paid call from its admission record to the Bitcoin anchor, link by link
                                       (holds, missing or not_yet for each link; tasuki.py)
  nenrin-agreement-verify record.json  the agreement report (the repository's agreement_verify.py, unchanged)
  tsugi-verify chain.json [options]    the TSUGI recovery-chain report, as `node tsugi_verify.mjs` prints it
  musubi-verify <module> [args]        a MUSUBI module, as python3 <module>.py in musubi-v0 (see musubi.py)
"""
import sys

from . import report_sha256, verify_bundle, __version__
from ._js import loads, stringify


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] in ("furui-day", "resume-admission", "furui-vectors"):
        from . import furui_day
        return furui_day.main(argv)
    if argv and argv[0] == "tasuki":
        from . import tasuki
        return tasuki.main(argv)
    if argv and argv[0] in ("-V", "--version"):
        print("nenrin-verify " + __version__)
        return 0
    if argv and argv[0] == "--selftest":
        return selftest()
    sha_only = False
    if argv and argv[0] == "--sha":
        sha_only, argv = True, argv[1:]
    if len(argv) != 1 or argv[0].startswith("-"):
        print("usage: nenrin-verify [--sha] <bundle.json> | --selftest | --version | furui-day <day> --leaf <i> | resume-admission <endpoint> <record_sha256> | tasuki <record_sha256>", file=sys.stderr)
        return 2
    try:
        with open(argv[0], "rb") as f:
            bundle = loads(f.read())
        report = verify_bundle(bundle)
    except RecursionError:
        print("nenrin-verify: the input is nested deeper than this Python allows; no report", file=sys.stderr)
        return 2
    except Exception as e:
        print("nenrin-verify: no report for this input (%s: %s)" % (type(e).__name__, e), file=sys.stderr)
        return 2
    text = report["verdict"] + " " + report_sha256(report) if sha_only else stringify(report, indent=2)
    _write_utf8(text + "\n")
    return 0 if report["verdict"] == "accepted" else 1


def _write_utf8(text):
    """console.log writes UTF-8 whatever the locale; so does this."""
    if hasattr(sys.stdout, "buffer"):
        sys.stdout.flush()
        sys.stdout.buffer.write(text.encode("utf-8"))
        sys.stdout.buffer.flush()
    else:
        sys.stdout.write(text)


def selftest():
    import hashlib
    import json
    import os
    from . import consume_evidence, did_key_resolver
    doc = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "selftest.json"), encoding="utf-8"))
    ok = 0
    for c in doc["cases"]:
        bundle = loads(json.dumps(c["bundle"], ensure_ascii=False))
        rep = verify_bundle(bundle)
        inp = dict(bundle)
        inp["resolve"] = did_key_resolver
        con = hashlib.sha256(stringify(consume_evidence(inp), sort_keys=True).encode("utf-8")).hexdigest()
        same = rep["verdict"] == c["verdict"] and report_sha256(rep) == c["report_sha256"] and con == c["consume_sha256"]
        ok += same
        if not same:
            print("DIFFERS  " + c["name"])
    n = len(doc["cases"])
    print("%d/%d frozen bundles give the same report as %s" % (ok, n, doc["reference"]))
    t_ok, t_n, t_ref = tsugi_selftest()
    print("%d/%d frozen TSUGI chains give the same output as %s" % (t_ok, t_n, t_ref))
    from . import musubi
    m = musubi.recompute_run0002()
    print("MUSUBI run0002 %s: anchored %s, settlement %s" % ("recomputes" if m["ok"] else "DOES NOT recompute",
                                                          (m.get("got") or {}).get("anchored", "-")[:16], (m.get("got") or {}).get("settlement", "-")[:16]))
    return 0 if ok == n and t_ok == t_n and m["ok"] else 1


def tsugi_selftest():
    import gzip
    import hashlib
    import json
    import os
    from . import tsugi
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tsugi_selftest.json.gz")
    with open(path, "rb") as f:
        doc = json.loads(gzip.decompress(f.read()).decode("utf-8"))
    ok = 0
    for c in doc["cases"]:
        files = c["files"]

        def read(p, files=files):
            if not isinstance(p, str) or p not in files:
                raise OSError("no such file in the case: %r" % (p,))
            return files[p]
        try:
            out, code = tsugi.run(c["args"], read_file=read)
            same = (not c["js"]["threw"] and code == c["js"]["exit"] and tsugi.output_text(out) == c["js"]["stdout"])
        except tsugi.NotReproduced:
            same = False
        except tsugi.Usage:   # the JavaScript printed the usage line to stderr and exited 2, with no report
            same = (not c["js"]["threw"] and c["js"]["exit"] == 2 and c["js"]["stdout"] == "")
        except Exception:
            same = c["js"]["threw"]
        ok += same
        if not same:
            print("DIFFERS  " + c["name"])
    return ok, len(doc["cases"]), doc["reference"]


def tsugi_main(argv=None):
    from . import tsugi
    return tsugi.main(argv)


def agreement_main(argv=None):
    from . import agreement_verify
    return agreement_verify.main(argv)


if __name__ == "__main__":
    sys.exit(main())
