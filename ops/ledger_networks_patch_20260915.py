#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""hs-ledger: distinct submitter networks per day on GET /witness (2026-09-15).

Same instrument as the gate's /usage distinct_requester_networks, on the ledger's two writing faces:
POST /witness (witness intake) and POST /a2a. One mark per (UTC day, network), network = IPv4 /24
or IPv6 /48, hashed with a per-day random salt that lives 48 hours in KV. No IP stored.
Ledger entries, anchoring, the witness pool, counting rules for the ring: untouched.

Usage (from the repo root):
    python3 ops/ledger_networks_patch_20260915.py            # dry run
    python3 ops/ledger_networks_patch_20260915.py --apply    # write, .bak beside the file

Every anchor must occur exactly once or the script refuses; a patched file is refused (marker).
"""
import sys, os, io, shutil, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, "workers", "hs-ledger", "src", "worker.js")
MARKER = "const NET_COUNTING_SINCE = "

BLOCK = r'''
// 2026-09-15. 「何名が測りに来とるか」に、この台帳も回数しか答えられんかった(看板の AE は route と
// UA の種別だけ、証人録は名前と視点)。人数は測れん。測れるんは「いくつの網から来たか」までや。
// 扉の /usage と同じ計器を、書く口 2 つ(POST /witness、POST /a2a)に置く。
// 要求元の網の接頭(IPv4 /24、IPv6 /48)を、その日限りの乱数 salt と一緒に sha256 した先頭 32 hex を
// 印として 48 時間だけ置く。IP は書かん。salt が消えたら誰にも戻せん。残るんは日ごとの異なりの数だけ。
// 台帳の entry・錨・証人プール・輪の数え方は 1 バイトも動かさん。動くのは GET /witness の中身だけ。
const NET_COUNTING_SINCE = "2026-09-15";
const NET_TTL_SECONDS = 60 * 60 * 48;
const NET_FACES = ["witness", "a2a"];

function netPrefix(ip) {
  if (typeof ip !== "string" || !ip) return null;
  const s = ip.trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return "v4:" + s.split(".").slice(0, 3).join(".");
  if (s.indexOf(":") >= 0) {
    const core = s.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
    const halves = core.split("::");
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(":") : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    const missing = 8 - head.length - tail.length;
    if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
    const groups = head.concat(new Array(missing).fill("0"), tail);
    if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
    return "v6:" + groups.slice(0, 3).map((g) => g.padStart(4, "0")).join(":");
  }
  return null;
}
function netDay(now) { return new Date(now === undefined ? Date.now() : now).toISOString().slice(0, 10); }
function netMarkPrefix(day, face) { return "wit:net:" + day + ":" + face + ":"; }
function netCountKey(day) { return "wit:netcount:" + day; }

async function netSalt(env, day) {
  const k = "wit:netsalt:" + day;
  let salt = await env.LEDGER.get(k);
  if (typeof salt === "string" && /^[0-9a-f]{32}$/.test(salt)) return salt;
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  salt = Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
  await env.LEDGER.put(k, salt, { expirationTtl: NET_TTL_SECONDS });
  return salt;  // 日の最初の 2 要求が同時なら salt が 2 つでき、その網は 2 と数わる。上振れ 1、境界だけ。
}

function noteSubmitterNetwork(env, ctx, request) {
  try {
    if (!env || !env.LEDGER || !request || request.method !== "POST") return;
    const p = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
    const face = p === "/witness" ? "witness" : (p === "/a2a" ? "a2a" : null);
    if (!face) return;
    const prefix = netPrefix(request.headers.get("cf-connecting-ip"));
    if (!prefix) return;  // ヘッダ無し(手元の試験、直叩き)は数えん。偽って数えるより落とす。
    const run = async () => {
      try {
        const day = netDay();
        const salt = await netSalt(env, day);
        const h = (await sha256hex(salt + "|" + prefix)).slice(0, 32);
        for (const f of ["all", face]) {
          const k = netMarkPrefix(day, f) + h;
          if (await env.LEDGER.get(k)) continue;
          await env.LEDGER.put(k, "1", { expirationTtl: NET_TTL_SECONDS });
        }
      } catch (_e) { /* 計数の失敗で台帳を止めない */ }
    };
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(run());
    else run();
  } catch (_e) { /* same */ }
}

async function netCountLive(env, day) {
  const countPrefix = async (p) => {
    let n = 0, cursor;
    for (let guard = 0; guard < 50; guard++) {
      const r = await env.LEDGER.list({ prefix: p, cursor, limit: 1000 });
      n += (r && Array.isArray(r.keys)) ? r.keys.length : 0;
      if (!r || r.list_complete || !r.cursor) break;
      cursor = r.cursor;
    }
    return n;
  };
  const out = { networks: await countPrefix(netMarkPrefix(day, "all")), by_face: {} };
  for (const f of NET_FACES) out.by_face[f] = await countPrefix(netMarkPrefix(day, f));
  return out;
}

async function netFreeze(env, day) {
  if (!env || !env.LEDGER) return null;
  const k = netCountKey(day);
  const raw = await env.LEDGER.get(k);
  if (raw) { try { return JSON.parse(raw); } catch (_e) { return null; } }
  const live = await netCountLive(env, day);
  const row = { day, networks: live.networks, by_face: live.by_face, frozen_at: new Date().toISOString() };
  await env.LEDGER.put(k, JSON.stringify(row));
  return row;
}

async function netReport(env, n) {
  const today = netDay();
  const by_day = [];
  let max = 0, days_counted = 0;
  for (let i = 0; i < n; i++) {
    const d = netDay(Date.now() - i * 86400000);
    let row;
    try {
      if (d < NET_COUNTING_SINCE) row = { day: d, networks: null, by_face: null, state: "not_counted_yet" };
      else if (d === today) { const live = await netCountLive(env, d); row = { day: d, networks: live.networks, by_face: live.by_face, state: "so_far" }; }
      else {
        const raw = await env.LEDGER.get(netCountKey(d));
        let frozen = null;
        if (raw) { try { frozen = JSON.parse(raw); } catch (_e) { frozen = null; } }
        if (!frozen && i <= 1) frozen = await netFreeze(env, d);
        row = frozen ? { day: d, networks: frozen.networks, by_face: frozen.by_face, state: "frozen" }
                     : { day: d, networks: null, by_face: null, state: "not_frozen" };
      }
    } catch (_e) { row = { day: d, networks: null, by_face: null, state: "unreadable" }; }
    if (typeof row.networks === "number") { days_counted++; if (row.networks > max) max = row.networks; }
    by_day.push(row);
  }
  return {
    counting_since: NET_COUNTING_SINCE,
    faces: { witness: "POST /witness", a2a: "POST /a2a" },
    days_counted: days_counted,
    max_networks_in_a_day: max,
    by_day: by_day,
    what_this_is:
      "How many distinct client networks (IPv4 /24, IPv6 /48) sent a request to the faces above, per UTC day. " +
      "Narrower than 'how many witnesses': the ring counts identities (name or signed domain); this counts " +
      "where requests came from, and one operator submitting a hundred records from one network is one.",
    what_this_is_not:
      "Not people. Not witnesses. One person on two networks counts twice; a cloud runner that changes " +
      "address every job counts every job; our own submissions are in here on the days we made them.",
    privacy:
      "No IP address is stored. Each network prefix is hashed with a random salt that exists only for that " +
      "day and is deleted within 48 hours; afterwards the prefix cannot be recovered from the hash, by us " +
      "or by anyone else. What survives is the count.",
    accuracy:
      "May over-count by one network at the UTC day boundary. Days before counting_since are null, not zero. " +
      "A day never frozen before its hashes expired is null, not zero. Today is a running figure. Requests " +
      "without the cf-connecting-ip header are not counted."
  };
}
'''

EDITS = [
    # 1. helper block right before the witness self description
    ("function witnessSelfDescription(origin) {\n", BLOCK.lstrip("\n") + "\nfunction witnessSelfDescription(origin) {\n"),
    # 2. GET /witness carries the report
    ('    if (p === "/witness" && request.method === "GET") {\n      return json(witnessSelfDescription(origin));\n    }\n',
     '    if (p === "/witness" && request.method === "GET") {\n      const d = witnessSelfDescription(origin);\n      try { d.distinct_submitter_networks = await netReport(env, 30); } catch (_e) { d.distinct_submitter_networks = { error: "unreadable" }; }\n      return json(d);\n    }\n'),
    # 3. count on the way out, beside noteHit; ctx is now accepted by fetch
    ('  async fetch(request, env) {\n    const res = await handle(request, env);\n',
     '  async fetch(request, env, ctx) {\n    const res = await handle(request, env);\n    noteSubmitterNetwork(env, ctx, request);\n'),
    # 4. the 00:30 UTC schedule freezes yesterday before its marks expire
    ('  async scheduled(_event, env, _ctx) {\n    try {\n      const r = await anchorWitnessPool(env, "https://ledger.horizonshield.dev", "schedule");\n',
     '  async scheduled(_event, env, _ctx) {\n    try { await netFreeze(env, netDay(Date.now() - 86400000)); } catch (e) { console.log("network freeze failed:", String(e && e.message || e)); }\n    try {\n      const r = await anchorWitnessPool(env, "https://ledger.horizonshield.dev", "schedule");\n'),
]

def main():
    apply = "--apply" in sys.argv
    src = io.open(TARGET, encoding="utf-8").read()
    if MARKER in src:
        print("REFUSE: already patched (marker present):", TARGET); return 3
    for old, _new in EDITS:
        n = src.count(old)
        if n != 1:
            print("REFUSE: anchor count %d (want 1): %r" % (n, old[:80])); return 2
    out = src
    for old, new in EDITS:
        out = out.replace(old, new, 1)
    for ch in (chr(0x2013), chr(0x2014), chr(0x2015), chr(0x2500)):
        if ch in out and ch not in src:
            print("REFUSE: patch would introduce a forbidden dash U+%04X" % ord(ch)); return 4
    print("dry run: %d edits ready, +%d bytes, +%d lines" % (len(EDITS), len(out.encode("utf-8")) - len(src.encode("utf-8")), out.count("\n") - src.count("\n")))
    if not apply:
        print("nothing written. add --apply to write."); return 0
    stamp = datetime.datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    bak = TARGET + ".bak-" + stamp + "-networks"
    shutil.copyfile(TARGET, bak)
    io.open(TARGET, "w", encoding="utf-8", newline="\n").write(out)
    if io.open(TARGET, encoding="utf-8").read() != out:
        print("FAIL: read-back mismatch"); return 5
    print("written:", TARGET); print("backup :", bak); return 0

if __name__ == "__main__":
    sys.exit(main())
