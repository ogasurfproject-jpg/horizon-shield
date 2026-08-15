# -*- coding: utf-8 -*-
"""
第13弾パッチ (2026-08-15) — 表面の変更履歴 (測定設計v2 の E3。旧称 patch9)

やること:
  1. tools/list のカーソルを最後まで辿る(上限3ページ)。
     ★辿り切れなければ surface 全体を complete: false にする。
       部分読みから「14本のツールが消えた」と誤報するのが、この機能の最悪の故障だから。
  2. マニフェスト全体をハッシュする。名前だけではなく name + description + inputSchema。
     名前を残したまま inputSchema を書き換える変更(統合破壊の第1位)が、名前ハッシュでは
     見えない。ツール1本ごとのハッシュも持ち、何が変わったかを名指しできるようにする。
  3. initialize の serverInfo + capabilities も同じ要求内でハッシュ(追加コストゼロ)。
  4. 履歴エントリに surface を保存し、前回と違えば surface_change を同じエントリに残す。
     ★指標は作らない。回数も割合も無変化日数も無し。日付付きの差分という事実だけ。
     ★fingerprint には入れない = 表面の変化は「条件の flip」ではなく、警報を鳴らさない。
       MCP 仕様自体が notifications/tools/list_changed を持つ。変化は正常運用である。
  5. 予算(憲法7条): 1本あたり最悪 1(init)+3(pages)+1(card)=5 呼び出しになったので
     MAX_PER_SWEEP を 15→9 に下げる(9×5=45 ≤ 50)。現在の監視は6本なので実動に変化なし。

ハッシュは16hex(64bit)に切り詰める。変更検出用であり、暗号学的な同一性証明ではない。
その旨をコード内コメントに明記する。

前提: patch10, patch11 適用済み。

使い方:
  cd ~/Desktop/hs-docfix
  python3 patch13_surface_changelog.py
  python3 patch13_surface_changelog.py --apply
  node --check workers/hs-verify-gate/src/worker.js
"""
import sys, os, io, hashlib

W = "workers/hs-verify-gate/src/worker.js"

# ---- 1. ヘルパー2つを checkMcp の直前に追加 ----
F1 = '''// ---- 条件1. 実在する MCP エンドポイント ----
async function checkMcp(endpoint) {
  const detail = {};
'''
R1 = '''// ---- 表面(surface)のハッシュ ----
// JCS風の安定直列化。キーを再帰的にソートするだけの決定論的 stringify。
function canonicalJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
}

// ハッシュは16hex(64bit)に切る。変更検出用の指紋であって、暗号学的な同一性証明ではない。
// 名前ハッシュだけでは「名前を残して inputSchema を書き換える」変更(統合破壊の第1位)が見えない。
// だからマニフェスト全体と、ツール1本ごとの指紋を持つ。
async function surfaceHashes(tools, initResult, pages, complete) {
  const sorted = tools.slice().sort((a, b) => (String(a.name) < String(b.name) ? -1 : 1));
  const strip = (t) => ({ name: t.name, description: t.description || "", inputSchema: t.inputSchema || null });
  const perTool = {};
  for (const t of sorted) {
    perTool[String(t.name)] = (await sha256hex(canonicalJson(strip(t)))).slice(0, 16);
  }
  return {
    complete: complete,
    pages_followed: pages,
    names_hash: (await sha256hex(JSON.stringify(sorted.map((t) => String(t.name))))).slice(0, 16),
    manifest_hash: (await sha256hex(canonicalJson(sorted.map(strip)))).slice(0, 16),
    server_info_hash: initResult ? (await sha256hex(canonicalJson(initResult))).slice(0, 16) : null,
    tool_hashes: perTool
  };
}

// ---- 条件1. 実在する MCP エンドポイント ----
async function checkMcp(endpoint) {
  const detail = {};
  let initResult = null;
'''

# ---- 2. initialize の結果を保持 ----
F2 = '''    detail.server_name = (init && init.result && init.result.serverInfo && init.result.serverInfo.name) || null;
'''
R2 = '''    detail.server_name = (init && init.result && init.result.serverInfo && init.result.serverInfo.name) || null;
    initResult = init && init.result ? { serverInfo: init.result.serverInfo || null, capabilities: init.result.capabilities || null } : null;
'''

# ---- 3. tools/list をカーソル完走に ----
F3 = '''  try {
    const list = await rpcCall(endpoint, "tools/list");
    const tools = (list && list.result && list.result.tools) || [];
    detail.tool_count = tools.length;
    detail.tools = tools.map((t) => t.name).slice(0, 50);
    if (!tools.length) return { pass: false, reason: "tools/list returned no tools", detail };
'''
R3 = '''  try {
    // カーソルを最後まで辿る(上限3ページ)。辿り切れなければ surface は complete: false。
    // 部分読みから「ツールが消えた」と主張するのが、この測定の最悪の故障だから。
    let tools = [];
    let cursor = null;
    let pages = 0;
    do {
      const list = await rpcCall(endpoint, "tools/list", cursor ? { cursor: cursor } : {});
      const batch = (list && list.result && list.result.tools) || [];
      tools = tools.concat(batch);
      cursor = (list && list.result && list.result.nextCursor) || null;
      pages += 1;
    } while (cursor && pages < 3);
    detail.tool_count = tools.length;
    detail.tools = tools.map((t) => t.name).slice(0, 50);
    detail.surface = await surfaceHashes(tools, initResult, pages, !cursor);
    if (!tools.length) return { pass: false, reason: "tools/list returned no tools", detail };
'''

# ---- 4. summarise が surface を保存 ----
F4 = '''  return {
    at: record.checked_at,
    status: record.status,
    reachable: record.reachable !== false,
    record_sha256: record.record_sha256,
    conditions: out,
    fingerprint: stateFingerprint(record)
  };
}
'''
R4 = '''  return {
    at: record.checked_at,
    status: record.status,
    reachable: record.reachable !== false,
    record_sha256: record.record_sha256,
    conditions: out,
    // 表面の指紋。fingerprint には入れない — 表面の変化は条件の flip ではなく、
    // 警報を鳴らさない。MCP 仕様自体が tools/list の変化を正常運用と見なしている。
    surface: (checks.mcp_endpoint && checks.mcp_endpoint.detail && checks.mcp_endpoint.detail.surface) || null,
    fingerprint: stateFingerprint(record)
  };
}
'''

# ---- 5. recordHistory が差分を1行残す ----
F5 = '''  const entry = summarise(record);
'''
R5 = '''  const entry = summarise(record);

  // 表面が前回と違えば、日付付きの差分をこのエントリ自身に残す。
  // 指標にしない。回数も割合も作らない。何が増え、何が消え、何の définition が変わったか、だけ。
  // 両方 complete のときだけ比較する — 部分読みとの比較から「削除」を出さない。
  const prevSurface = last && last.surface ? last.surface : null;
  if (entry.surface && prevSurface && entry.surface.complete === true && prevSurface.complete === true
      && entry.surface.manifest_hash !== prevSurface.manifest_hash) {
    const prevT = prevSurface.tool_hashes || {};
    const curT = entry.surface.tool_hashes || {};
    entry.surface_change = {
      added: Object.keys(curT).filter((k) => !(k in prevT)),
      removed: Object.keys(prevT).filter((k) => !(k in curT)),
      definition_changed: Object.keys(curT).filter((k) => (k in prevT) && curT[k] !== prevT[k]),
      note: "The tool surface changed between measurements. This is a dated fact, not a defect: the MCP specification treats tool-list changes as normal operation (notifications/tools/list_changed). Recorded for anyone; judged by no one."
    };
  }
'''

# ---- 6. 予算: MAX_PER_SWEEP 15→9 ----
F6 = '''const MAX_PER_SWEEP = 15;        // 1本につき外部アクセス3回。Free の 50/request に収まる上限
'''
R6 = '''const MAX_PER_SWEEP = 9;         // 1本あたり最悪 1(init)+3(tools/listページ)+1(card)=5。9×5=45 ≤ 50(Free枠)
'''


def main():
    apply = "--apply" in sys.argv
    if not os.path.exists(W):
        print("NG: %s が無い。" % W)
        sys.exit(1)
    src = io.open(W, encoding="utf-8").read()
    print("対象  : %s" % W)
    print("変更前: sha256 %s  (%d bytes)" % (hashlib.sha256(src.encode()).hexdigest(), len(src.encode())))
    print("モード: %s" % ("APPLY(本番)" if apply else "dry-run(何も書かない)"))
    print("-" * 74)

    pairs = [(F1, R1), (F2, R2), (F3, R3), (F4, R4), (F5, R5), (F6, R6)]
    ok_all = True
    for i, (f, _r) in enumerate(pairs, 1):
        n = src.count(f)
        ok = (n == 1)
        ok_all = ok_all and ok
        print("  %s アンカー%d                     期待1 / 実際%d" % ("OK " if ok else "NG ", i, n))
    pre = [
        ("patch11 が先に入っている",  "gate_side: true, measured: false" in src),
        ("まだ適用されていない",      "surfaceHashes" not in src),
    ]
    for label, ok in pre:
        print("  %s %s" % ("OK " if ok else "NG ", label))
        ok_all = ok_all and ok
    if not ok_all:
        print("★ 前提が違う。1バイトも書かずに終了する。")
        sys.exit(1)

    out = src
    for f, r in pairs:
        out = out.replace(f, r, 1)

    checks = [
        ("カーソル完走(上限3ページ)",          "while (cursor && pages < 3)" in out),
        ("★辿り切れなければ complete: false", "surfaceHashes(tools, initResult, pages, !cursor)" in out),
        ("マニフェスト全体をハッシュ",          "inputSchema: t.inputSchema || null" in out),
        ("ツール単位の指紋を持つ",              "tool_hashes: perTool" in out),
        ("serverInfo もハッシュ",              "server_info_hash" in out),
        ("16hexの断り書きがある",              "暗号学的な同一性証明ではない" in out),
        ("summarise が surface を保存",        out.count("surface: (checks.mcp_endpoint") == 1),
        ("★fingerprint に surface を入れない",  "stateFingerprint" in out and "surface" not in out.split("function stateFingerprint")[1].split("}")[0]),
        ("差分は complete 同士でのみ比較",      "entry.surface.complete === true && prevSurface.complete === true" in out),
        ("差分の3分類",                        "definition_changed" in out and '"added"' not in out),
        ("判定しない文言",                     "Recorded for anyone; judged by no one." in out),
        ("予算 9×5=45",                        "MAX_PER_SWEEP = 9" in out and "9×5=45" in out),
        ("既存4ツール無傷",                    out.count('name: "lookup_server"') == 1),
        ("gate_side 系は無傷",                 out.count("gate_side: true, measured: false") == src.count("gate_side: true, measured: false")),
        ("波括弧の収支が合う",                 out.count("{") - out.count("}") == src.count("{") - src.count("}")),
        ("丸括弧の収支が合う",                 out.count("(") - out.count(")") == src.count("(") - src.count(")")),
    ]
    for c, ok in checks:
        print("  %s %s" % ("OK " if ok else "NG ", c))
    if any(not ok for _c, ok in checks):
        print("★ 検算に失敗。書かずに終了する。")
        sys.exit(1)

    print("-" * 74)
    print("変更後: sha256 %s  (%d bytes)" % (hashlib.sha256(out.encode()).hexdigest(), len(out.encode())))
    if not apply:
        print("")
        print("[dry-run] 書いていない。本番は --apply を付けろ。")
        sys.exit(0)

    io.open(W, "w", encoding="utf-8").write(out)
    print("")
    print("書いた。次: node --check %s" % W)


if __name__ == "__main__":
    main()
