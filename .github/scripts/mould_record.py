#!/usr/bin/env python3
"""Turn the gate's reply into a comment for the issue author.

This script holds no credential and sends nothing to the ledger. The workflow
sent the gate one thing, an issue number. The gate read the issue from GitHub
itself. All this does is read what came back and say it plainly, including when
it came back a failure.
"""
import json, os, sys

STATUS = int(os.environ.get("GATE_STATUS") or 0)
RESP = "resp.json"
OUT = "comment.md"


def load():
    try:
        with open(RESP, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def body(status, r):
    if status == 201:
        rid = r.get("id", "")
        empty = not (r.get("searched") or [])
        lines = [
            "Recorded as `%s`." % rid,
            "",
            "```",
            "record_sha256  %s" % r.get("record_sha256", ""),
            "recorded_at    %s" % r.get("recorded_at", ""),
            "gate_commit    %s" % r.get("gate_commit", ""),
            "```",
            "",
            "Read it: https://gate.horizonshield.dev/mould/%s" % rid,
            "It also appears at https://shield.the-horizons-innovation.com/verify-directory/mould/",
            "",
            "Recompute it yourself: remove the `record_sha256` and `recompute_note` fields, "
            "serialise the remainder in the order returned, take the SHA-256, and it must match.",
            "",
            "**What this establishes.** The gate fetched this issue from GitHub itself. Nobody handed "
            "it your words, and no shared write key exists that could have been used to file this under "
            "your name. **What it does not establish:** that the search you describe actually happened. "
            "Nobody checked. The record says so in its own body.",
        ]
        if empty:
            lines += [
                "",
                "Your search list is empty, so the record is published with an empty search list and "
                "carries the marker on the public page. That is the designed outcome, not a rejection. "
                "It is the one thing this ledger exists to make visible.",
            ]
        lines += ["", "The record is append only. Closing this issue does not remove it."]
        return "\n".join(lines)

    if status == 409:
        return ("This issue already has a record in the ledger (`%s`). The ledger is append only, so it "
                "is not rewritten. Editing this issue does not change the record, and that is deliberate: "
                "a record you could revise after the fact would not be worth reading."
                % r.get("id", ""))

    if status == 422:
        return ("Not recorded. The gate reads the label from GitHub, and this issue does not carry the "
                "`mould-record` label. Add the label and it will be read again.")

    if status == 400:
        return ("Not recorded: `%s`\n\nThe assumption field is the only required one. Everything else, "
                "including the search list, may be left empty. Edit the issue, then re-apply the "
                "`mould-record` label to have it read again." % r.get("error", "unknown"))

    if status == 503:
        return ("Not recorded, and not partially recorded. The gate reads GitHub without a token and hit "
                "the anonymous rate limit. Re-apply the `mould-record` label in a few minutes and it will "
                "try again. Nothing you wrote was lost.")

    return ("Not recorded. The gate returned %s and the failure is on our side, not in what you wrote. "
            "Nothing was recorded and nothing was partially recorded.\n\n```\n%s\n```"
            % (status or "no response", json.dumps(r, ensure_ascii=False)[:600]))


def main():
    r = load()
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(body(STATUS, r))
    print("wrote %s for status %s" % (OUT, STATUS))
    return 0


if __name__ == "__main__":
    sys.exit(main())
