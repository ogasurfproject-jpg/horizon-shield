#!/usr/bin/env python3
"""
keys_inventory.py: the list of every secret name each Worker reads, with what is known about where
its local copy lives and when it was last rotated. Values are never read, printed or stored.

    python3 ops/keys_inventory.py          # writes ops/keys_inventory.md and prints it

Why (weakness audit 2026-09-05, item 14): the secrets lived in one operator's head and one Mac, with no
list and no rotation plan. On the same day one admin token was pasted into a chat by hand. A list is
the precondition for rotating anything, and for the succession envelope (item 1).

The table is generated from `env.NAME` reads in workers/*/src, so it cannot go stale by forgetting a
Worker. The KNOWN dict is the hand-maintained part: rotation dates and local copies. Keep it honest;
"unknown" is a fact, an invented date is not.
"""

import io, os, re, glob
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "ops", "keys_inventory.md")

# Names that are configuration or bindings, not secrets. Everything else read from env is listed as a secret.
NOT_SECRET = re.compile(r"(_KV$|_DO$|^KV$|_SVC$|_STORE$|_BUCKET$|^ORDERS$|^LEDGER$|^ESTIMATE$|^PDF_GEN$|^PDFGEN_SVC$|^GATEWAY$|"
                        r"^MYBROWSER$|_AE$|^HS_MCP$|^HS_CONTRACTORS$|^HS_REAL_CASES$|^GENKA_(PENDING|VERIFIED|INGEST)$|^GYOSHA_CHECK$|"
                        r"^FOLLOWUP$|^AUDIT_RL$|^RL_KV$|^SEEN_STORE$|^OUTREACH_(DATA|QUEUE)$|^TICKETS_(DO|KV)$|^KIRA_STATS$|"
                        r"_URL$|_URLS$|_BASE$|_ORIGIN$|_ORIGINS$|_MODEL$|_RATE$|_THRESHOLD$|_OVERRIDE$|^DRY_RUN$|^DEBUG$|^ENVIRONMENT$|"
                        r"^MODE$|^PER_RUN_MAX$|_FILENAME$|^FROM_ADDRESS$|^REPLY_TO$|^TEST_INBOX$|^UNSUB_MAILBOX$|^SENDER_BLOCK$|"
                        r"^PUBLIC_BASE$|_COEFF$|_COMMIT$|^TOSHI_EMAIL$|^HEARING_(FROM|REPLY_TO|PUBLIC_ORIGIN)$|^GEN_MIN_COMPLETENESS$|"
                        r"^GH_DISPATCH_REPO$|^GITHUB_(OWNER|REPO)$|^PARTNER_NAME$|^STORE_ID$|^LINE_USER_ID$|^ALERT_LINE_TO$|"
                        r"^LINE_LOGIN_CHANNEL_ID$|^PAYPAL_CLIENT_ID$|^GOOGLE_CLIENT_ID$|^SALES_CEILING_YEN$|^PENDING_STALE_HOURS$|"
                        r"^AI_COUNCIL_COST$|^BANK_INFO$|^APIFY_ACTOR_ID$|^ESTAT_APP_ID$|^HACHIUN_FEE_RATE$|^OPENAI_APPS_CHALLENGE$|"
                        r"^SUBSCRIBERS$|^SOUBA_SOURCE$|^PAYPAY_MERCHANT_ID$)")

# Hand-maintained facts. Dates are only written when known from a record (commit, handoff, script comment).
KNOWN = {
    "LEDGER_ADMIN_TOKEN": {"local": "~/.hs_ledger_token (chmod 600, 64 chars; read by ops/run_stamp.sh hourly launchd and append_witness.sh)",
                           "rotated": "2026-09-04 (per run_stamp.sh: the old script had the key inline and pointed at the old host; rotated that day)",
                           "note": "read by hs-ledger, hs-gateway and hs-pdf-gen: one rotation means three `wrangler secret put`"},
    "SWEEP_TOKEN":        {"local": "~/.hs_sweep_token (48 chars, dated Aug 9) does NOT match the Worker secret: POST /sweep returned 403 on 2026-09-05",
                           "rotated": "unknown; the file and the secret diverged before 2026-09-05",
                           "note": "gate: POST /sweep, /watch admin tier, DELETE /watch. Rotate and rewrite the file in the same minute"},
    "ADMIN_TOKEN":        {"local": "none yet; proposed ~/.hs_outreach_token",
                           "rotated": "ROTATE NOW: the value was pasted into a chat transcript by hand on 2026-09-05",
                           "note": "hs-outreach status/enqueue"},
    "ANTHROPIC_API_KEY":  {"local": "~/.hs_anthropic_key (used by ops/run_visibility_weekly.sh); whether the Workers share this exact key is unknown",
                           "rotated": "unknown", "note": "read by many Workers; if one key is shared, one leak is every Worker"},
    "RELAY_TOKEN":        {"local": "unknown", "rotated": "unknown", "note": "hs-verify-relay; the gate calls the relay with it"},
    "RESEND_API_KEY":     {"local": "unknown", "rotated": "unknown", "note": "outbound mail (hs-outreach, hs-pdf-gen)"},
    "GITHUB_TOKEN":       {"local": "unknown", "rotated": "unknown", "note": "hs-blog-post commits to the site repo; scope should be one repo"},
    "GITHUB_PAT":         {"local": "unknown", "rotated": "unknown", "note": "hs-monitor"},
    "GH_DISPATCH_TOKEN":  {"local": "unknown", "rotated": "unknown", "note": "hs-hearing repository dispatch"},
}

def main():
    rows = {}
    for src in sorted(glob.glob(os.path.join(ROOT, "workers", "*", "src", "**", "*.js"), recursive=True)):
        worker = os.path.relpath(src, os.path.join(ROOT, "workers")).split(os.sep)[0]
        txt = io.open(src, encoding="utf-8", errors="replace").read()
        for name in set(re.findall(r"env\.([A-Z][A-Z0-9_]{3,})", txt)):
            if NOT_SECRET.search(name):
                continue
            rows.setdefault(name, set()).add(worker)
    lines = ["# Secrets inventory (names only, never values)", "",
             "Generated %s by ops/keys_inventory.py from `env.NAME` reads under workers/*/src." % datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
             "Values live only in Cloudflare (`wrangler secret put`) and, for the few the operator uses by hand, in `~/.hs_*` files (chmod 600).",
             "Never in chat, never on a command line, never in a file under this repository.", "",
             "## Rules", "",
             "1. A value that appears in a chat transcript, a terminal paste, a screenshot or a commit is rotated the same day. No exceptions, no judgement of how public the transcript was.",
             "2. Rotation cadence: quarterly for anything that can send, pay or write (mail, PayPal, Stripe, GitHub, admin tokens); yearly for read-only API keys. First scheduled rotation: 2026-12.",
             "3. Every local copy is a file read by a script, never typed. Length is checked before anything is sent (append_witness.sh, run_stamp.sh do this).",
             "4. The succession envelope (weakness audit item 1) is this table plus the values, on paper, with one named person. This file is the index of that envelope.", "",
             "## Table", "",
             "| secret | read by | local copy | last rotation | note |", "|---|---|---|---|---|"]
    for name in sorted(rows):
        k = KNOWN.get(name, {})
        lines.append("| %s | %s | %s | %s | %s |" % (name, ", ".join(sorted(rows[name])), k.get("local", "unknown"), k.get("rotated", "unknown"), k.get("note", "")))
    n_unknown = sum(1 for name in rows if KNOWN.get(name, {}).get("rotated", "unknown").startswith("unknown"))
    lines += ["", "%d secret names across %d Workers. Last rotation unknown for %d of them. Unknown is the honest state today, not a target." % (
        len(rows), len(set(w for ws in rows.values() for w in ws)), n_unknown)]
    rep = "\n".join(lines) + "\n"
    io.open(OUT, "w", encoding="utf-8").write(rep)
    print(rep)

if __name__ == "__main__":
    main()
