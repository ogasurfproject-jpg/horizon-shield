#!/usr/bin/env python3
"""Read a "Record a mould" issue and post it to the ledger.

The identity chain, stated once so nobody has to infer it:
  GitHub authenticated the account that opened the issue.
  This workflow, running in this repository, read that issue.
  It posts the words to the gate with the operator token.
The gate freezes who wrote it. Nothing in this chain checks whether the search
described actually happened, and the record it writes says so in its own body.

The write token stays here rather than being handed out, because a shared write
token would let anyone file a record under someone else's name.
"""
import json, os, re, sys, urllib.request, urllib.error

GATE = os.environ.get("GATE_URL", "https://gate.horizonshield.dev")

# フォームの見出しと、台帳のフィールドの対応。見出し文字列はフォーム側と一字一句そろえる。
FIELDS = {
    "The assumption": "class",
    "Why it is worth recording": "class_note",
    "Where you first noticed it": "instance_where",
    "What it did there": "instance_symptom",
    "How loudly did it fail there?": "instance_volume",
    "Where you searched for the same assumption": "searched",
    "What you found at each place": "found",
    "What prompted the search": "prompted_by",
}


def parse_issue_body(body):
    """GitHub の Issue Form は '### 見出し' + 本文 で描画される。見出しで切る。"""
    out, key = {}, None
    buf = []
    for line in (body or "").replace("\r\n", "\n").split("\n"):
        m = re.match(r"^###\s+(.+?)\s*$", line)
        if m:
            if key:
                out[key] = "\n".join(buf).strip()
            key = FIELDS.get(m.group(1).strip())
            buf = []
            continue
        if key:
            buf.append(line)
    if key:
        out[key] = "\n".join(buf).strip()
    # 未入力の任意項目は GitHub が _No response_ と書く。空として扱う。
    for k, v in list(out.items()):
        if v.strip().lower() in ("_no response_", "_no response_.", "none", ""):
            out[k] = ""
    return out


def volume_of(text):
    t = (text or "").strip().lower()
    if t.startswith("loud"):
        return "loud"
    if t.startswith("quiet"):
        return "quiet"
    return None


def parse_found(block):
    rows = []
    for line in (block or "").split("\n"):
        line = line.strip().lstrip("-").strip()
        if not line:
            continue
        parts = [p.strip() for p in line.split("|")]
        where = parts[0] if parts else ""
        if not where:
            continue
        rows.append({
            "where": where,
            "state": parts[1] if len(parts) > 1 and parts[1] else "",
            "volume": volume_of(parts[2]) if len(parts) > 2 else None,
            "note": parts[3] if len(parts) > 3 and parts[3] else None,
        })
    return rows


def parse_searched(block):
    return [l.strip().lstrip("-").strip() for l in (block or "").split("\n") if l.strip().lstrip("-").strip()]


def build(fields, issue_number, login, issue_url):
    return {
        "id": "mould-gh-%d" % issue_number,
        "class": fields.get("class", ""),
        "class_note": fields.get("class_note") or None,
        "instance": {
            "where": fields.get("instance_where") or None,
            "symptom": fields.get("instance_symptom") or None,
            "volume": volume_of(fields.get("instance_volume")),
        },
        "searched": parse_searched(fields.get("searched")),
        "found": parse_found(fields.get("found")),
        "prompted_by": fields.get("prompted_by") or None,
        "submitted_via": "github",
        "submitted_by": login,
        "source_url": issue_url,
    }


def post(payload, token):
    req = urllib.request.Request(
        GATE + "/mould",
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json", "x-sweep-token": token},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"error": raw[:400]}


def comment_body(status, rec, payload):
    if status == 201:
        empty = not payload["searched"]
        lines = [
            "Recorded as `%s`." % rec.get("id", ""),
            "",
            "```",
            "record_sha256  %s" % rec.get("record_sha256", ""),
            "recorded_at    %s" % rec.get("recorded_at", ""),
            "```",
            "",
            "Read it: https://gate.horizonshield.dev/mould/%s" % rec.get("id", ""),
            "",
            "Recompute it yourself. Remove the `record_sha256` and `recompute_note` fields, "
            "`JSON.stringify` the remainder in the order returned, take the SHA-256, and it must match.",
            "",
            "What this establishes: GitHub authenticated your account, and this repository's "
            "workflow carried your words to the ledger unchanged. What it does not establish: "
            "that the search you describe happened. Nobody checked. The record says so in its own body.",
        ]
        if empty:
            lines += [
                "",
                "Your search list is empty, so the record is published with an empty search list "
                "and carries the marker on the public page. That is the designed outcome, not a "
                "rejection. It is the one thing this ledger exists to make visible.",
            ]
        lines += ["", "The record is append only. Closing this issue does not remove it."]
        return "\n".join(lines)
    if status == 409:
        return ("This issue already has a record in the ledger (`%s`). The ledger is append only, "
                "so it is not rewritten. Open a new issue if the account has changed."
                % rec.get("id", ""))
    if status == 400:
        return ("The ledger did not accept this: `%s`\n\nThe assumption field is the only required "
                "one. Edit the issue and it will be read again." % rec.get("error", "unknown"))
    return "The ledger returned %d: `%s`\n\nNothing was recorded. This is a fault on our side unless the message says otherwise." % (status, json.dumps(rec)[:300])


def main():
    ev = json.load(open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8"))
    issue = ev["issue"]
    fields = parse_issue_body(issue.get("body"))
    if not fields.get("class", "").strip():
        print("::notice::no class field, nothing to record")
        open(os.environ["GITHUB_OUTPUT"], "a").write("comment=\n")
        return 0
    payload = build(fields, issue["number"], issue["user"]["login"], issue["html_url"])
    token = os.environ.get("GATE_SWEEP_TOKEN", "")
    if not token:
        print("::error::GATE_SWEEP_TOKEN is not set. Refusing to guess.")
        return 1
    status, rec = post(payload, token)
    print("gate status", status)
    body = comment_body(status, rec, payload)
    with open("comment.md", "w", encoding="utf-8") as f:
        f.write(body)
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as f:
        f.write("status=%d\n" % status)
    return 0 if status in (201, 409) else 1


if __name__ == "__main__":
    sys.exit(main())
