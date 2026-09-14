#!/usr/bin/env python3
"""
ops/ledger_precedence_patch_20260914.py  hs-ledger: 先後(precedence)レシートを1本足す

「pace the frontier」ニュースの芯 = フェデリコが名指しした穴「precedence: 会社の時計から独立して
発見に時刻を刻む物」。台帳には既に citationCard(/cite)が「これらのバイトはこの時刻以前に存在した」
まで出しとる。足りんのは (1) 記者が踏める専用 URL (2) before/after の明示的な枠 (3) ?before=<時刻>
で「この記録はその事象より前に在ったか」を答える所。既存の citationCard を再利用するだけ、新しい
信頼ロジックはゼロ。全部 additive、read-only。

  P1 routeLabel に /precedence/ を追加
  P2 precedenceEpoch / precedenceView / precedenceMarkdown を citationCard の前に追加
  P3 GET /precedence/<citation>[?before=<ISO>] ハンドラを /cite ハンドラの直後に追加

/health の routes 配列は触らない(ledger.test の本数固定を壊さないため)。

既定 dry-run。--apply で書く(.bak を先に残す)。各 anchor は count==1 を assert。
"""
import sys, os, re, datetime
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, "workers", "hs-ledger", "src", "worker.js")
APPLY = "--apply" in sys.argv
src = open(TARGET, encoding="utf-8").read(); orig = src

def rep(anchor, new, label):
    global src
    n = src.count(anchor)
    assert n == 1, "%s: anchor count %d != 1" % (label, n)
    src = src.replace(anchor, new); print("ok   " + label)

# ---- P1 routeLabel ----
rep('  if (p.startsWith("/cite/")) return "cite";',
    '  if (p.startsWith("/cite/")) return "cite";\n  if (p.startsWith("/precedence/")) return "precedence";',
    "P1 routeLabel に /precedence/")

# ---- P2 helpers before citationCard ----
HELP = '''// [2026-09-14] Precedence receipt. Reuses citationCard (no new trust logic). Frames what the
// confirmed anchor establishes as before/after, so an outside reader can check "did this record
// exist before event X" without trusting the operator. A signature would not establish this; a
// clock the operator cannot move (the Bitcoin block time) does.
const _PREC_ISO = /^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})(?:\\.\\d+)?Z$/;
const _PREC_LEDGER = /^(\\d{4})-(\\d{2})-(\\d{2}) (\\d{2}):(\\d{2})(?::(\\d{2}))? UTC$/;
function precedenceEpoch(t) {
  if (typeof t !== "string") return null;
  const m = _PREC_ISO.exec(t) || _PREC_LEDGER.exec(t);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}
function precedenceView(card, beforeRaw) {
  const bt = card && card.bitcoin && card.bitcoin.block_time;
  const confirmed = !!(card && card.bitcoin && card.bitcoin.status === "confirmed" && card.bitcoin.block && bt);
  const integrityOk = !!(card && card.integrity && card.integrity.match);
  const pv = {
    established: false,
    what_it_means:
      "A confirmed anchor proves this exact record existed at or before the Bitcoin block time. " +
      "That time comes from a clock the operator does not control. A signature would not establish it: " +
      "a signature carries only the time the signer claims to have written.",
    limits: card ? card.limits : undefined,
    recompute: card ? card.reproduce : undefined,
    verify_block_url: card ? card.ots_url : undefined,
  };
  if (!integrityOk) {
    pv.status = "integrity_failure";
    pv.why = "the stored bytes do not hash to the cited id, so nothing is established";
    return pv;
  }
  if (!confirmed) {
    pv.status = (card && card.bitcoin && card.bitcoin.status === "pending") ? "anchor_pending" : "not_anchored";
    pv.why = pv.status === "anchor_pending"
      ? "submitted to OpenTimestamps; the Bitcoin block time is not confirmed yet, so no independent time bounds this record. Pending is the honest state, not a failure."
      : "this record is not Bitcoin-anchored, so no independent clock bounds its existence time";
    return pv;
  }
  pv.established = true;
  pv.status = "confirmed";
  pv.existed_at_or_before = bt;
  pv.bitcoin_block = card.bitcoin.block;
  pv.statement =
    "This exact record existed at or before Bitcoin block " + card.bitcoin.block + " at " + bt +
    ", established by a clock the operator cannot move.";
  if (beforeRaw != null && String(beforeRaw).length) {
    const tb = precedenceEpoch(bt);
    const tx = precedenceEpoch(String(beforeRaw).trim());
    const cmp = { claimed_time: String(beforeRaw).trim() };
    if (tb == null || tx == null) {
      cmp.result = "unparseable_time";
      cmp.note = "give the time as ISO 8601 UTC, e.g. 2026-09-01T00:00:00Z";
    } else if (tb < tx) {
      cmp.result = "precedes"; cmp.provable = true; cmp.margin_seconds = tx - tb;
      cmp.note = "this record provably predates the claimed time: its existence is bounded at or before " +
        bt + ", which is earlier than " + cmp.claimed_time + ".";
    } else {
      cmp.result = "not_provably_before"; cmp.provable = false;
      cmp.note = "cannot conclude precedence: the anchored time " + bt + " is not earlier than " +
        cmp.claimed_time + ", so this record is not provably before it.";
    }
    pv.compared_to = cmp;
  }
  return pv;
}
function precedenceMarkdown(card, pv) {
  const L = [];
  L.push("# Precedence receipt");
  L.push("");
  L.push("Citation: `" + card.citation + "` (ledger entry #" + card.resolved_entry + ").");
  L.push("");
  if (!pv.established) {
    L.push("## Not established");
    L.push("");
    L.push("Status: " + pv.status + ". " + (pv.why || ""));
    L.push("");
    L.push(pv.what_it_means);
    if (pv.recompute) { L.push(""); L.push("Recompute the record:"); L.push(""); L.push("```"); L.push(pv.recompute); L.push("```"); }
    L.push("");
    return L.join("\\n") + "\\n";
  }
  L.push("## Established");
  L.push("");
  L.push(pv.statement);
  L.push("");
  L.push(pv.what_it_means);
  if (pv.compared_to) {
    L.push("");
    L.push("## Against the claimed time " + pv.compared_to.claimed_time);
    L.push("");
    L.push(pv.compared_to.note);
  }
  L.push("");
  L.push("## Check it yourself");
  L.push("");
  L.push("Recompute the record:");
  L.push("");
  L.push("```");
  L.push(pv.recompute);
  L.push("```");
  L.push("");
  L.push("Verify the block: " + pv.verify_block_url);
  L.push("");
  L.push("## What this does and does not prove");
  L.push("");
  L.push(pv.limits);
  L.push("");
  return L.join("\\n") + "\\n";
}

// Resolve any citation form to a verified card, using only public state.'''
rep('// Resolve any citation form to a verified card, using only public state.', HELP, "P2 precedence helpers")

# ---- P3 handler after /cite block ----
CITE_BLOCK = '''    if (p.startsWith("/cite/") && request.method === "GET") {
      const citation = decodeURIComponent(p.slice("/cite/".length));
      try {
        const card = await citationCard(env, origin, citation);
        if (wantsMarkdown(request)) return md(cardMarkdown(card));
        return jsonV(card, card.integrity.match ? 200 : 409);
      } catch (err) {
        return jsonV({ error: "unresolved", detail: String((err && err.message) || err), accepted_forms: ["jidec:entry:<n>", "jidec:path:<64hex>", "<64hex>", origin + "/ledger/<n>"], index: origin + "/ledger" }, 404);
      }
    }'''
NEW = CITE_BLOCK + '''

    // Precedence receipt: the same verified card, framed as before/after, so an outside reader can
    // check whether a record existed before a claimed time without trusting the operator.
    // GET /precedence/<citation>[?before=<ISO 8601 UTC>]
    if (p.startsWith("/precedence/") && request.method === "GET") {
      const citation = decodeURIComponent(p.slice("/precedence/".length));
      let card;
      try {
        card = await citationCard(env, origin, citation);
      } catch (err) {
        return jsonV({ error: "unresolved", detail: String((err && err.message) || err), accepted_forms: ["jidec:entry:<n>", "jidec:path:<64hex>", "<64hex>", origin + "/ledger/<n>"], index: origin + "/ledger" }, 404);
      }
      const pv = precedenceView(card, url.searchParams.get("before"));
      if (wantsMarkdown(request)) return md(precedenceMarkdown(card, pv));
      return jsonV({ citation: card.citation, resolved_entry: card.resolved_entry, integrity: card.integrity, bitcoin: card.bitcoin, precedence: pv }, card.integrity.match ? 200 : 409);
    }'''
rep(CITE_BLOCK, NEW, "P3 /precedence ハンドラ")

# ---- checks ----
DASH = re.compile("[" + "".join(chr(c) for c in (0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D)) + "]")
new_lines = [l for l in src.splitlines() if l not in set(orig.splitlines())]
bad = [l for l in new_lines if DASH.search(l)]
assert not bad, "追加行にダッシュ: " + "\n".join(bad[:5])
print("ok   追加行 %d 本、ダッシュ無し" % len(new_lines))
for must in ["precedenceView(", "precedenceMarkdown(", "precedenceEpoch(", '"/precedence/"']:
    assert must in src, must

if not APPLY:
    print("\nDRY RUN。--apply で書く。"); sys.exit(0)
stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
open(TARGET + "." + stamp + "-precedence.bak", "w", encoding="utf-8").write(orig)
open(TARGET, "w", encoding="utf-8").write(src)
print("\nAPPLIED  " + TARGET + "  (bak " + stamp + ")")
