#!/usr/bin/env python3
"""Find places where a secret is written into a URL.

Why this exists (2026-09-10).

A header is read and dropped. A URL is not: it survives in request logs, in a
browser's history the moment a person opens one, and in the Referer of anything
the page links out to. So a credential in a query string is a credential in more
places than anyone intended, and nothing errors when it happens.

hs-outreach accepted its admin token from the query and that was closed today.
Then this scanner was written, and it found the other half of the same problem:
hs-gateway was not only accepting a secret from a URL, it was WRITING one into a
URL on every paid report, alongside the header that already carried it. The
header made the query redundant. Redundant, and permanent wherever that URL
landed.

What it looks for: a line that names an env var shaped like a credential and, in
the same line, builds a query string. It reports the line, it does not judge it.
A per-store hash in a link that partners are meant to bookmark will match too,
and that is a design choice rather than a defect, so this file prints and the
reader decides.

What it cannot see, said here rather than left to be found: a secret assigned to
a variable on one line and appended to a URL on another. It reads one line at a
time. Widen it the day that shape appears, and add a case to the selftest.

Usage:
  python3 tools/no_secret_in_url.py             scan workers/ and tools/
  python3 tools/no_secret_in_url.py --selftest  run the built in cases
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))

SECRET_ENV = re.compile(r"\benv\.([A-Z][A-Z0-9_]*(?:_TOKEN|_KEY|_SECRET|_PASSWORD|_SALT))\b")
# a query being built: "?name=" or "&name=" inside a string, or searchParams.set
QUERY_BUILD = re.compile(r'["\'`][^"\'`]*[?&][A-Za-z_][A-Za-z0-9_]*=|searchParams\.set\(|URLSearchParams\(')


# A line can build a query AND set a header. When the secret sits behind the word
# "headers" it is the header's value, not the query's. Found on 2026-09-10 by
# running this scanner and reading its own output: it reported two lines of
# hs-apps-jimu's harness where the query carried a date and the header carried the
# key. A scanner that cries wolf is a scanner nobody runs.
HEADER_USE = re.compile(r"headers?\b", re.I)


def scan_line(line):
    """Return the secret name when this one line puts a secret into a query."""
    m = SECRET_ENV.search(line)
    if not m:
        return None
    if not QUERY_BUILD.search(line):
        return None
    if HEADER_USE.search(line[:m.start()]):
        return None
    return m.group(1)


def scan_tree(root=ROOT, dirs=("workers", "tools")):
    out = []
    for d in dirs:
        base = os.path.join(root, d)
        for dp, dnames, names in os.walk(base):
            if "node_modules" in dp or "/.git" in dp:
                continue
            for n in names:
                if not n.endswith((".js", ".mjs", ".ts", ".py", ".sh")):
                    continue
                p = os.path.join(dp, n)
                # This file carries the defect in its own selftest fixtures, as a
                # scanner must. Reporting them would be reporting the ruler for
                # having marks on it.
                if os.path.abspath(p) == os.path.abspath(__file__):
                    continue
                try:
                    text = io.open(p, encoding="utf-8", errors="replace").read()
                except OSError:
                    continue
                for i, line in enumerate(text.splitlines(), 1):
                    s = line.strip()
                    if s.startswith("//") or s.startswith("#") or s.startswith("*"):
                        continue
                    name = scan_line(line)
                    if name:
                        out.append((os.path.relpath(p, root), i, name, s[:150]))
    return out


def _selftest():
    cases = [
        ("a token appended to a url is caught",
         'rurl = rurl + "?token=" + encodeURIComponent(env.HS_AUDIT_TOKEN);', "HS_AUDIT_TOKEN"),
        ("searchParams.set with a secret is caught",
         'u.searchParams.set("key", env.ADMIN_KEY);', "ADMIN_KEY"),
        ("an ampersand form is caught",
         'const u = base + "&admin=" + env.ADMIN_TOKEN;', "ADMIN_TOKEN"),
        ("a secret in a HEADER is not a finding",
         'headers["X-HS-TOKEN"] = env.HS_AUDIT_TOKEN;', None),
        ("reading a secret to compare it is not a finding",
         'return await ctEq(t, env.ADMIN_TOKEN);', None),
        ("a query with no secret is not a finding",
         'const u = base + "?store=" + storeId;', None),
        ("a non credential env var in a query is not a finding",
         'const u = base + "?base=" + env.PUBLIC_BASE;', None),
        ("a salt counts as a credential",
         'const u = base + "?s=" + env.MYPAGE_SALT;', "MYPAGE_SALT"),
        ("a query and a header on one line: the header is not a finding",
         'await W.fetch(new Request("https://x/admin?today=" + T, { headers: { "X-Admin-Key": env.ADMIN_KEY } }));', None),
        ("but a query and a header on one line, with the secret in the QUERY, still is",
         'await fetch("https://x/a?token=" + env.ADMIN_TOKEN, { headers: { "Content-Type": "application/json" } });', "ADMIN_TOKEN"),
    ]
    bad = 0
    for name, line, want in cases:
        got = scan_line(line)
        ok = got == want
        if not ok:
            bad += 1
        print(("ok   " if ok else "NG   ") + name + ("" if ok else "  want=%s got=%s" % (want, got)))
    print("")
    print("=== %d / %d %s (no_secret_in_url) ===" % (len(cases) - bad, len(cases),
          "不合格あり" if bad else "合格"))
    return 1 if bad else 0


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--selftest":
        raise SystemExit(_selftest())
    found = scan_tree()
    if not found:
        print("秘密を URL に書いとる行: 0")
        raise SystemExit(0)
    print("秘密を URL に書いとる行: %d" % len(found))
    for p, i, name, s in found:
        print("  %s:%d  [%s]" % (p, i, name))
        print("      " + s)
    raise SystemExit(1)
