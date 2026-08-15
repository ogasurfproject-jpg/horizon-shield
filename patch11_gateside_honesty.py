# -*- coding: utf-8 -*-
"""
第11弾パッチ (2026-08-15) — 「文は正直、booleanが嘘」を機械可読の層から追い出す

見つけた穴(patch10 の出荷直後に自分で発見):
  中継が落ちているときに /check を叩くと、
    reason  : "relay unavailable ... gate-side failure, not a statement about the target"  ← 正直
    reachable: false                                                                        ← 嘘
  機械は reason の散文を読まない。boolean が相手のせいにする。
  扉の fail-open 事件とバイト単位で同じ構造。憲法5条を機械可読の層で破っていた。

このパッチがやること:
  1. 中継由来の故障(gate-side)を、対象の到達性と別の状態として扱う
       reachable: null (false ではない)
       status: held
       各条件に gate_side: true, measured: false
       判定に measurement_note を追加(この測定は起きなかった、と判定自身が言う)
  2. summarise の reason 切り詰め 240→400
       (allow_tool_call の直し方の説明が、直し方の直前で切れていた。
        バッジのリンク先=いちばん人目につく場所で切れていた)
  3. 扉の workers.dev の口を閉じる(workers_dev: true → false)
       2026-08-15 朝の522診断のために開けた。診断は終わった。
       開けた事実と理由はこのコメントに残す。事故で決まった状態を放置しない。

前提: patch10 適用済みのファイルに当てる。

使い方:
  cd ~/Desktop/hs-docfix
  python3 patch11_gateside_honesty.py
  python3 patch11_gateside_honesty.py --apply
  node --check workers/hs-verify-gate/src/worker.js
"""
import sys, os, io, hashlib

W = "workers/hs-verify-gate/src/worker.js"
C = "workers/hs-verify-gate/wrangler.jsonc"

# ---- 1a. checkMcp: initialize の catch ----
F1 = '''  } catch (e) {
    const hint = /1104|1042|Failed to fetch|fetch failed/i.test(String(e.message))
      ? " (the gate could not reach this host. Cloudflare blocks Worker-to-Worker calls within the " +
        "same account over workers.dev; use a custom domain, or run the check from outside)"
      : "";
    return { pass: false, transport: true, reason: "initialize failed: " + e.message + hint, detail };
  }
'''
R1 = '''  } catch (e) {
    if (/gate-side failure/.test(String(e && e.message))) {
      // 中継の故障。対象のことは何も分かっていない。boolean にもそう言わせる。
      return { pass: false, gate_side: true, measured: false, reason: "not measured: " + e.message, detail };
    }
    const hint = /1104|1042|Failed to fetch|fetch failed/i.test(String(e.message))
      ? " (the gate could not reach this host. Cloudflare blocks Worker-to-Worker calls within the " +
        "same account over workers.dev; use a custom domain, or run the check from outside)"
      : "";
    return { pass: false, transport: true, reason: "initialize failed: " + e.message + hint, detail };
  }
'''

# ---- 1b. checkMcp: tools/list の catch ----
F2 = '''    return { pass: false, transport: true, reason: "tools/list failed: " + e.message, detail };
'''
R2 = '''    if (/gate-side failure/.test(String(e && e.message))) {
      return { pass: false, gate_side: true, measured: false, reason: "not measured: " + e.message, detail };
    }
    return { pass: false, transport: true, reason: "tools/list failed: " + e.message, detail };
'''

# ---- 1c. checkAgentCard の catch ----
F3 = '''  } catch (e) {
    return { pass: false, transport: true, reason: "agent-card fetch failed: " + e.message, detail: { url } };
  }
'''
R3 = '''  } catch (e) {
    if (/gate-side failure/.test(String(e && e.message))) {
      return { pass: false, gate_side: true, measured: false, reason: "not measured: " + e.message, detail: { url } };
    }
    return { pass: false, transport: true, reason: "agent-card fetch failed: " + e.message, detail: { url } };
  }
'''

# ---- 1e. runCheck: agent_card の包み直しで gate_side を落とさない / compensation も未測定に ----
F3b = '''  results.agent_card = { pass: cardRes.pass, transport: cardRes.transport === true, reason: cardRes.reason, detail: cardRes.detail };
  results.compensation_disclosure = checkCompensation(cardRes.card);
'''
R3b = '''  results.agent_card = { pass: cardRes.pass, transport: cardRes.transport === true, ...(cardRes.gate_side === true ? { gate_side: true, measured: false } : {}), reason: cardRes.reason, detail: cardRes.detail };
  // カードが「取れなかった」のが中継故障なら、開示の有無も分かっていない。落ちた顔をさせない。
  results.compensation_disclosure = cardRes.gate_side === true
    ? { pass: false, gate_side: true, measured: false, reason: "not measured: the agent card could not be fetched because the gate's relay path was unavailable, so whether compensation is disclosed is unknown" }
    : checkCompensation(cardRes.card);
'''

# ---- 1d. runCheck: 判定の組み立て ----
F4 = '''  const passed = Object.values(results).every((r) => r.pass);
'''
R4 = '''  const passed = Object.values(results).every((r) => r.pass);
  // gate-side = こちらの測定装置の故障。unreachable(相手に届かない)と混ぜない。
  const gateSide = Object.values(results).some((r) => r && r.gate_side === true);
'''

F5 = '''    reachable: !unreachable,
    status: passed ? CONFIG.tier_pass : (unreachable ? CONFIG.tier_held : CONFIG.tier_fail),
'''
R5 = '''    reachable: gateSide ? null : !unreachable,
    status: passed ? CONFIG.tier_pass : ((unreachable || gateSide) ? CONFIG.tier_held : CONFIG.tier_fail),
'''

F6 = '''    probed_via: probeVia(endpoint),
    checks: results
  };
'''
R6 = '''    probed_via: probeVia(endpoint),
    ...(gateSide ? {
      measurement_note:
        "This measurement did not happen. The gate's own relay path was unavailable, so nothing in " +
        "this record says anything about the target. reachable is null rather than false for exactly " +
        "that reason: an instrument failure is not a statement about the thing it failed to measure."
    } : {}),
    checks: results
  };
'''

# ---- 2. summarise の reason 240→400 ----
F7 = '''      reason: r ? r.slice(0, 240) : null
'''
R7 = '''      reason: r ? r.slice(0, 400) : null
'''

# ---- 3. workers.dev の口を閉じる ----
FC = '''  "workers_dev": true,
'''
RC = '''  // 2026-08-15 朝、同一ゾーン522の診断のために一時的に true にした
  // (workers.dev入口ならcron同様に通ることを実測し、中継設計の根拠になった)。
  // 診断は終わり、恒久対応は hs-verify-relay 経由。公開入口は custom domain 1本に戻す。
  "workers_dev": false,
'''


def run(target, pairs, extra_checks):
    src = io.open(target, encoding="utf-8").read()
    print("対象  : %s" % target)
    print("変更前: sha256 %s  (%d bytes)" % (hashlib.sha256(src.encode()).hexdigest(), len(src.encode())))
    ok_all = True
    for i, (f, _r) in enumerate(pairs, 1):
        n = src.count(f)
        ok = (n == 1)
        ok_all = ok_all and ok
        print("  %s アンカー%d                     期待1 / 実際%d" % ("OK " if ok else "NG ", i, n))
    if not ok_all:
        return None
    out = src
    for f, r in pairs:
        out = out.replace(f, r, 1)
    for label, ok in extra_checks(src, out):
        print("  %s %s" % ("OK " if ok else "NG ", label))
        ok_all = ok_all and ok
    if not ok_all:
        return None
    print("変更後: sha256 %s  (%d bytes)" % (hashlib.sha256(out.encode()).hexdigest(), len(out.encode())))
    return out


def main():
    apply = "--apply" in sys.argv
    for t in (W, C):
        if not os.path.exists(t):
            print("NG: %s が無い。" % t)
            sys.exit(1)
    print("モード: %s" % ("APPLY(本番)" if apply else "dry-run(何も書かない)"))
    print("=" * 74)

    def wchecks(src, out):
        return [
            ("patch10 が先に入っている",         "probeFetch" in src and "probed_via" in src),
            ("gate_side の分岐が5箇所",           out.count("gate_side: true, measured: false") == 5),
            ("包み直しでフラグを落とさない",       "cardRes.gate_side === true ? { gate_side: true, measured: false }" in out),
            ("開示条件も未測定になれる",           "whether compensation is disclosed is unknown" in out),
            ("reachable が null になれる",        "reachable: gateSide ? null : !unreachable," in out),
            ("held に倒す",                       "(unreachable || gateSide) ? CONFIG.tier_held" in out),
            ("measurement_note は条件付き",       out.count("This measurement did not happen.") == 1 and "...(gateSide ? {" in out),
            ("gate_side を unreachable に数えない", "r.gate_side === true" in out and out.count("r && r.transport === true") == src.count("r && r.transport === true")),
            ("reason は 400 に伸びた",            "slice(0, 400)" in out and "slice(0, 240)" not in out),
            ("既存4ツール無傷",                   out.count('name: "lookup_server"') == 1),
            ("波括弧の収支が合う",                out.count("{") - out.count("}") == src.count("{") - src.count("}")),
        ]

    def cchecks(src, out):
        return [
            ("workers_dev が false に戻った",     '"workers_dev": false,' in out and '"workers_dev": true,' not in out),
            ("理由が書いてある",                  "診断のために一時的に true" in out),
            ("RELAY_URL は無傷",                  '"RELAY_URL"' in out),
            ("KV バインドは無傷",                 '"binding": "HS_VERIFY_KV"' in out),
        ]

    out_w = run(W, [(F1, R1), (F2, R2), (F3, R3), (F3b, R3b), (F4, R4), (F5, R5), (F6, R6), (F7, R7)], wchecks)
    print("-" * 74)
    out_c = run(C, [(FC, RC)], cchecks)
    print("=" * 74)

    if out_w is None or out_c is None:
        print("★ 前提または検算に失敗。1バイトも書かずに終了する。")
        sys.exit(1)

    if not apply:
        print("[dry-run] 書いていない。本番は --apply を付けろ。")
        sys.exit(0)

    io.open(W, "w", encoding="utf-8").write(out_w)
    io.open(C, "w", encoding="utf-8").write(out_c)
    print("書いた。次: node --check %s" % W)


if __name__ == "__main__":
    main()
