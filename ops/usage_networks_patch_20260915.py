#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""hs-verify-gate: distinct requester networks per day (2026-09-15).

Adds to /usage the count of distinct client networks (IPv4 /24, IPv6 /48) that hit the three
measuring faces (POST /check, POST /a2a, MCP tools/call check_conformance) per UTC day.
No IP is stored: prefix is hashed with a per-day random salt that lives 48 hours in KV.
Judgement rules, status vocabulary, conditions, record bytes: untouched. Only /usage grows.

Usage (from the repo root):
    python3 ops/usage_networks_patch_20260915.py            # dry run: report what would change
    python3 ops/usage_networks_patch_20260915.py --apply    # write, with a .bak beside the file

Every anchor must occur exactly once or the script refuses. Re-running on a patched file refuses
(the marker line is already present), so it cannot double-apply.
"""
import sys, os, io, shutil, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, "workers", "hs-verify-gate", "src", "worker.js")
MARKER = "const NET_COUNTING_SINCE = "

BLOCK = r'''
// 2026-09-15. 「何名が測りに来とるか」と問われて、答えられんかった。上の計数は回数と相手の host しか
// 持たん。1 人が 100 回叩いても 100 人が 1 回ずつでも同じ数字になる。人数は測れん。測れるんは
// 「いくつの網から来たか」までや。それをこう数える。
//
// 数えるのは、要求元の網の接頭(IPv4 は /24、IPv6 は /48)を、その日限りの乱数 salt と一緒に
// sha256 した先頭 32 hex。IP そのものは書かん。salt は KV に 48 時間だけ置き、消えたら誰にも
// (この扉自身にも)hash から接頭は戻せん。残るんは日ごとの「異なりの数」だけ。
// 数える口は 3 つ: POST /check、POST /a2a、MCP tools/call の check_conformance。/spec や
// /is-verified のような読むだけの口は数えん(読みに来た回数は spec_hits が既にある)。
// 人やない。1 人が 2 つの網から来たら 2、事務所 1 つが NAT の裏で 10 人おっても 1。
// 自分の測定(CI の runner、手元の点検)も混じる。混じった日は自分が知っとるから引ける。
// 判定規則・status・条件・記録のバイトは 1 つも動かさん。動くのは /usage の中身だけ。
const NET_COUNTING_SINCE = "2026-09-15";
const NET_TTL_SECONDS = 60 * 60 * 48;
const NET_FACES = ["check", "a2a", "mcp"];

function netPrefix(ip) {
  if (typeof ip !== "string" || !ip) return null;
  const s = ip.trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return "v4:" + s.split(".").slice(0, 3).join(".");
  if (s.indexOf(":") >= 0) {
    // IPv6。"::" を展開して先頭 3 群(/48)だけ残す。IPv4 混在表記は数えん(null)。
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
function netSaltKey(day) { return "usage:netsalt:" + day; }
function netMarkPrefix(day, face) { return "usage:net:" + day + ":" + face + ":"; }
function netCountKey(day) { return "usage:netcount:" + day; }

async function netSalt(env, day) {
  const k = netSaltKey(day);
  let salt = await env.HS_VERIFY_KV.get(k);
  if (typeof salt === "string" && /^[0-9a-f]{32}$/.test(salt)) return salt;
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  salt = Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
  await env.HS_VERIFY_KV.put(k, salt, { expirationTtl: NET_TTL_SECONDS });
  // 日の最初の 2 要求が同時に来て salt が 2 つできたら、その網はその日 2 回数えられる。上振れは 1、境界だけ。
  return salt;
}

function noteRequesterNetwork(env, ctx, request, face) {
  if (!env || !env.HS_VERIFY_KV || !request || !request.headers) return;
  if (NET_FACES.indexOf(face) < 0) return;
  let prefix = null;
  try { prefix = netPrefix(request.headers.get("cf-connecting-ip")); } catch (_e) { prefix = null; }
  if (!prefix) return;  // ヘッダが無い(手元の試験、直叩き)なら数えん。偽って数えるより落とす。
  const run = async () => {
    try {
      const day = netDay();
      const salt = await netSalt(env, day);
      const h = (await sha256hex(salt + "|" + prefix)).slice(0, 32);
      for (const f of ["all", face]) {
        const k = netMarkPrefix(day, f) + h;
        if (await env.HS_VERIFY_KV.get(k)) continue;
        await env.HS_VERIFY_KV.put(k, "1", { expirationTtl: NET_TTL_SECONDS });
      }
    } catch (_e) { /* 計数の失敗で測定本体を止めない */ }
  };
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(run());
  else run();
}

async function netCountLive(env, day) {
  const countPrefix = async (p) => {
    let n = 0, cursor;
    for (let guard = 0; guard < 50; guard++) {
      const r = await env.HS_VERIFY_KV.list({ prefix: p, cursor, limit: 1000 });
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

// 日が終わったら数を固定する。印(hash)は 48 時間で消えるので、消える前に数だけ残す。
// 掃引(18:00Z)が前日を固定し、/usage を読んだ時に固定されとらん前日があればそこでも固定する。
async function netFreeze(env, day) {
  if (!env || !env.HS_VERIFY_KV) return null;
  const k = netCountKey(day);
  const cur = await env.HS_VERIFY_KV.get(k, "json");
  if (cur) return cur;
  const live = await netCountLive(env, day);
  const row = { day, networks: live.networks, by_face: live.by_face, frozen_at: new Date().toISOString() };
  await env.HS_VERIFY_KV.put(k, JSON.stringify(row), { expirationTtl: 60 * 60 * 24 * USAGE_TTL_DAYS });
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
        let frozen = await env.HS_VERIFY_KV.get(netCountKey(d), "json");
        if (!frozen && i <= 1) frozen = await netFreeze(env, d);  // 前日の印はまだ消えとらん。ここで固定できる。
        row = frozen ? { day: d, networks: frozen.networks, by_face: frozen.by_face, state: "frozen" }
                     : { day: d, networks: null, by_face: null, state: "not_frozen" };
      }
    } catch (_e) { row = { day: d, networks: null, by_face: null, state: "unreadable" }; }
    if (typeof row.networks === "number") { days_counted++; if (row.networks > max) max = row.networks; }
    by_day.push(row);
  }
  return {
    counting_since: NET_COUNTING_SINCE,
    faces: { check: "POST /check", a2a: "POST /a2a", mcp: "MCP tools/call check_conformance" },
    days_counted: days_counted,
    max_networks_in_a_day: max,
    by_day: by_day,
    what_this_is:
      "How many distinct client networks (IPv4 /24, IPv6 /48) sent a request to the faces above, per UTC day. " +
      "It answers a narrower question than 'how many people': one operator calling a thousand times is one " +
      "network, and stays one.",
    what_this_is_not:
      "Not people. Not operators. One person on two networks counts twice; an office behind one NAT counts " +
      "once; a cloud runner that changes address every job counts every job. Our own measurements (CI runners, " +
      "our own checks) are in here on the days we ran them, and we know which days those are.",
    privacy:
      "No IP address is stored. Each network prefix is hashed together with a random salt that exists only " +
      "for that day and is deleted from storage within 48 hours, so the prefix cannot be recovered from the " +
      "hash afterwards, by us or by anyone else. What survives is the count.",
    accuracy:
      "May over-count by one network at the UTC day boundary when two first requests race for the day's salt. " +
      "Days before counting_since are null, not zero. A day whose count was never frozen before its hashes " +
      "expired is null, not zero. Today is a running figure. Requests that reach the worker without the " +
      "cf-connecting-ip header are not counted."
  };
}
'''

EDITS = [
    # 1. helper block before RECOMPUTE_NOTE
    ("const RECOMPUTE_NOTE =\n", BLOCK.lstrip("\n") + "\nconst RECOMPUTE_NOTE =\n"),
    # 2. usageReport: add the networks block after by_day
    ("    by_day: out,\n    what_this_is:\n      \"Counts of requests, published so that the question",
     "    by_day: out,\n    distinct_requester_networks: await netReport(env, n),\n    what_this_is:\n      \"Counts of requests, published so that the question"),
    # 3. POST /a2a
    ('    if (path === "/a2a" && request.method === "POST") return await handleGateA2A(request, env, url.origin);\n',
     '    if (path === "/a2a" && request.method === "POST") { noteRequesterNetwork(env, ctx, request, "a2a"); return await handleGateA2A(request, env, url.origin); }\n'),
    # 4. MCP tools/call check_conformance (counted in fetch; handleMcp stays request-free and stateless)
    ('      const res = await handleMcp(body, env);\n      if (res === null) return new Response(null, { status: 202, headers: CORS_HEADERS });\n',
     '      if (body && body.method === "tools/call" && body.params && body.params.name === "check_conformance") noteRequesterNetwork(env, ctx, request, "mcp");\n      const res = await handleMcp(body, env);\n      if (res === null) return new Response(null, { status: 202, headers: CORS_HEADERS });\n'),
    # 5. POST /check
    ('      bumpUsage(env, ctx, own ? "own_checks" : "external_checks", own ? null : parsed.hostname);\n',
     '      bumpUsage(env, ctx, own ? "own_checks" : "external_checks", own ? null : parsed.hostname);\n      noteRequesterNetwork(env, ctx, request, "check");\n'),
    # 6. scheduled: freeze yesterday's count before its hashes expire
    ('    ctx.waitUntil(runDailySweep(env));\n  },\n',
     '    ctx.waitUntil(runDailySweep(env));\n    ctx.waitUntil(netFreeze(env, netDay(Date.now() - 86400000)).catch(() => {}));\n  },\n'),
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
    back = io.open(TARGET, encoding="utf-8").read()
    if back != out:
        print("FAIL: read-back mismatch"); return 5
    print("written:", TARGET); print("backup :", bak); return 0

if __name__ == "__main__":
    sys.exit(main())
