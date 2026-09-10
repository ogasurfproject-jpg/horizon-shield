#!/usr/bin/env python3
"""Rebuild ops/keys_inventory.md from the tree, keeping every hand written column.

Why this file exists (2026-09-10).

ops/keys_inventory.md says at the top that it was "Generated 2026-09-05 by
ops/keys_inventory.py". That script was not in the tree. The table could not be
regenerated, could not be checked against the code, and had not been checked in
five days. An index that cannot be rebuilt is an assertion, not an index, and
this one calls itself the index of the succession envelope.

It also read only `env.NAME` under workers/. Anything held as a GitHub Actions
secret was outside its sight entirely, which is why CLOUDFLARE_API_TOKEN, a
credential that can deploy every Worker, appears nowhere in a table of every
secret.

What this does:
  - reads env.NAME from workers/ and secrets.NAME from .github/workflows/
  - keeps a name when it looks like a credential (see SECRETISH)
  - MERGES with the existing table by name, so the hand written columns
    (local copy, last rotation, note) survive a regeneration. Losing those
    would be worse than having no generator at all, which is why the merge is
    the first thing this file was tested for.
  - marks rows the tree has and the table lacks (NEW), and rows the table has
    and the tree lacks (GONE), rather than silently adding or dropping them.

What this does NOT do, said here rather than left to be discovered: it reads
NAMES. It never reads, prints, stores or compares a value, and it cannot tell
you whether a secret was actually rotated. The "last rotation" column is human
knowledge and stays human knowledge. This file only guarantees that the list of
names is the list the code actually uses.

Usage:
  python3 ops/keys_inventory.py            rewrite ops/keys_inventory.md
  python3 ops/keys_inventory.py --check    exit 1 if the table is out of date
  python3 ops/keys_inventory.py --selftest run the built in cases
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
TABLE = os.path.join(HERE, "keys_inventory.md")

# A name is treated as a credential when it ends in one of these. Widen it when
# a new shape appears; a name that is a secret and does not match is invisible
# to this file, and that is the whole of its blind spot.
SECRETISH = re.compile(r"(_KEY|_SECRET|_TOKEN|_PAT|_SALT|_PASSWORD|_WEBHOOK_ID|_CHALLENGE)$")

ENV_RE = re.compile(r"env\.([A-Z][A-Z0-9_]{2,})")
GHS_RE = re.compile(r"secrets\.([A-Z][A-Z0-9_]{2,})")


def scan(root=ROOT):
    """name -> sorted list of readers. Readers are worker names and workflow files."""
    found = {}

    def add(name, reader):
        if not SECRETISH.search(name):
            return
        found.setdefault(name, set()).add(reader)

    wroot = os.path.join(root, "workers")
    if os.path.isdir(wroot):
        for worker in sorted(os.listdir(wroot)):
            wdir = os.path.join(wroot, worker)
            files = []
            if os.path.isfile(wdir) and worker.endswith(".js"):
                files = [wdir]
                worker = worker[:-3]
            else:
                src = os.path.join(wdir, "src")
                for dirpath, _dirs, names in os.walk(src):
                    files += [os.path.join(dirpath, n) for n in names
                              if n.endswith((".js", ".mjs", ".ts"))]
            for f in files:
                try:
                    text = io.open(f, encoding="utf-8", errors="replace").read()
                except OSError:
                    continue
                for m in ENV_RE.finditer(text):
                    add(m.group(1), worker)

    wf = os.path.join(root, ".github", "workflows")
    if os.path.isdir(wf):
        for n in sorted(os.listdir(wf)):
            if not n.endswith((".yml", ".yaml")):
                continue
            try:
                text = io.open(os.path.join(wf, n), encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            for m in GHS_RE.finditer(text):
                add(m.group(1), "gh:" + n)

    return {k: sorted(v) for k, v in found.items()}


def parse_table(text):
    """name -> {read_by, local, rotation, note} from an existing table."""
    out = {}
    for ln in text.splitlines():
        if not ln.startswith("|") or ln.startswith("|---") or ln.startswith("| secret"):
            continue
        c = [x.strip() for x in ln.strip().strip("|").split("|")]
        if len(c) < 5 or not re.match(r"^[A-Z][A-Z0-9_]*$", c[0]):
            continue
        out[c[0]] = {"read_by": c[1], "local": c[2], "rotation": c[3], "note": c[4]}
    return out


def render(found, old, header):
    names = sorted(set(found) | set(old))
    lines = [header.rstrip("\n"), "", "## Table", "",
             "| secret | read by | local copy | last rotation | note |",
             "|---|---|---|---|---|"]
    new, gone = [], []
    for n in names:
        prev = old.get(n, {})
        if n in found:
            read_by = ", ".join(found[n])
        else:
            read_by = prev.get("read_by", "")
            gone.append(n)
        note = prev.get("note", "")
        if n not in old:
            new.append(n)
            note = ("NEW 2026-09-10: in the code, absent from the previous table. "
                    "Rotation state unknown. " + note).strip()
        if n not in found and "GONE" not in note:
            note = ("GONE 2026-09-10: no longer read anywhere in this tree. "
                    "A secret nothing reads is still live at the provider until it is deleted. "
                    + note).strip()
        lines.append("| %s | %s | %s | %s | %s |" % (
            n, read_by, prev.get("local", "unknown"), prev.get("rotation", "unknown"), note))
    return "\n".join(lines) + "\n", new, gone


DEFAULT_HEADER = """# Secrets inventory (names only, never values)

Regenerated by `python3 ops/keys_inventory.py`, which reads `env.NAME` under
`workers/` and `secrets.NAME` under `.github/workflows/`. The name list is
derived from the code. The `local copy`, `last rotation` and `note` columns are
human knowledge and are carried across regenerations untouched.

Values live only in Cloudflare (`wrangler secret put`), in GitHub Actions
secrets, and, for the few the operator uses by hand, in `~/.hs_*` files
(chmod 600). Never in chat, never on a command line, never in a file under this
repository.

## Rules

1. A value that appears in a chat transcript, a terminal paste, a screenshot or
   a commit is rotated the same day. No exceptions, no judgement of how public
   the transcript was.
2. Rotation cadence: quarterly for anything that can send, pay or write (mail,
   PayPal, Stripe, GitHub, admin tokens); yearly for read only API keys.
3. Every local copy is a file read by a script, never typed. Length is checked
   before anything is sent (append_witness.sh, run_stamp.sh do this).
4. The succession envelope (weakness audit item 1) is this table plus the
   values, on paper, with one named person. This file is the index of that
   envelope.
5. A rotation is written in four places in the same sitting: the Worker or
   Actions secret, the `~/.hs_*` file, this row, and the key manager. Three out
   of four is how 2026-09-09 lost a morning to a 403.
6. `--check` must be green before this file is trusted. An index that disagrees
   with the code is worse than no index, because it is believed."""


def _selftest():
    cases = []
    old = {"KEEP_TOKEN": {"read_by": "old-worker", "local": "~/.hs_keep",
                          "rotation": "2026-01-01", "note": "hand written, must survive"}}
    found = {"KEEP_TOKEN": ["new-worker"], "FRESH_KEY": ["w2"]}
    text, new, gone = render(found, old, "# t")
    cases.append(("hand written columns survive a regeneration",
                  "~/.hs_keep" in text and "2026-01-01" in text and "hand written, must survive" in text))
    cases.append(("read by is refreshed from the tree", "new-worker" in text))
    cases.append(("a name only in the tree is marked NEW", new == ["FRESH_KEY"] and "NEW 2026-09-10" in text))
    text2, _n2, gone2 = render({}, old, "# t")
    cases.append(("a name only in the table is marked GONE and kept",
                  gone2 == ["KEEP_TOKEN"] and "GONE 2026-09-10" in text2 and "KEEP_TOKEN" in text2))
    cases.append(("a plain config name is not treated as a secret",
                  not SECRETISH.search("PUBLIC_DATA_URL") and not SECRETISH.search("GH_DISPATCH_REPO")))
    cases.append(("credential shapes are caught", all(SECRETISH.search(x) for x in
                  ["ADMIN_TOKEN", "RESEND_API_KEY", "MYPAGE_SALT", "PAYPAL_WEBHOOK_ID",
                   "GITHUB_PAT", "ADMIN_PASSWORD", "OPENAI_APPS_CHALLENGE"])))
    round_trip = parse_table(text)
    cases.append(("what is rendered can be parsed back",
                  round_trip.get("KEEP_TOKEN", {}).get("rotation") == "2026-01-01"))
    bad = 0
    for name, ok in cases:
        print(("ok   " if ok else "NG   ") + name)
        bad += 0 if ok else 1
    print("")
    print("=== %d / %d %s (keys_inventory) ===" % (len(cases) - bad, len(cases),
          "不合格あり" if bad else "合格"))
    return 1 if bad else 0


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    if arg == "--selftest":
        raise SystemExit(_selftest())
    prev_text = io.open(TABLE, encoding="utf-8").read() if os.path.exists(TABLE) else ""
    old = parse_table(prev_text)
    header = prev_text.split("## Table")[0].rstrip() if "## Table" in prev_text else DEFAULT_HEADER
    if "Regenerated by" not in header:
        header = DEFAULT_HEADER
    found = scan()
    text, new, gone = render(found, old, header)
    if arg == "--check":
        same = (text == prev_text)
        print("表と木は %s" % ("一致しとる" if same else "食い違っとる"))
        if new:
            print("  木にあって表に無い: " + ", ".join(new))
        if gone:
            print("  表にあって木に無い: " + ", ".join(gone))
        raise SystemExit(0 if same else 1)
    io.open(TABLE, "w", encoding="utf-8").write(text)
    print("書き出した: %s  (%d 本)" % (os.path.relpath(TABLE, ROOT), len(parse_table(text))))
    if new:
        print("木にあって表に無かった %d 本 (NEW を付けた): %s" % (len(new), ", ".join(new)))
    if gone:
        print("表にあって木に無い %d 本 (GONE を付けて残した): %s" % (len(gone), ", ".join(gone)))
