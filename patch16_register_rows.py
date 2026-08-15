# -*- coding: utf-8 -*-
"""
patch16_register_rows.py (2026-08-15) — 加盟者の行を画面に戻す

何をするか:
  1) workers/hs-verify-gate/src/worker.js
     GET /register を追加する。公開の登録簿。watchlist と既存の履歴を読むだけで、
     新しい保存はしない。webhook は絶対に出さない。判定は変えない。
  2) verify-directory/index.html
     登録簿セクションに「生きた一覧」を追加する。ページを開くたびに /register を
     読んで、加盟者の行（エンドポイント・最新の判定・測定回数・履歴リンク・
     その場で測るボタン）を描く。加盟が増えれば自動で行が増える。

前と同じ流儀:
  - 既定は dry-run。--apply を付けた時だけ書く
  - 全アンカーは 期待1件。1件でなければ1バイトも書かない
  - 書いた後に不変条件を検査し、失敗したら異常終了する

使い方:
  cd ~/Desktop/hs-docfix
  python3 patch16_register_rows.py            # dry-run
  python3 patch16_register_rows.py --apply    # 実際に書く
"""
import io, sys

APPLY = "--apply" in sys.argv

W = "workers/hs-verify-gate/src/worker.js"
P = "verify-directory/index.html"

# ---------------------------------------------------------------- worker側

W_FUNC_ANCHOR = '  return { ran: false, note: "No sweep has completed yet. If the cron is registered, the first run happens at 18:00 UTC." };\n}'

W_FUNC_NEW = W_FUNC_ANCHOR + '''

// 公開の登録簿。watchlist と既存の hist:* を読むだけで、何も測らず、何も保存しない。
// webhook は通知の宛先であって公開情報ではないので、決して出さない。
// 未掲載は不合格ではない。ここで測られたことが無い、それだけを意味する。
const REGISTER_JOIN_MAX = 50;

async function publicRegister(env) {
  const list = await watchlist(env);
  const rows = [];
  let joined = 0;
  for (const w of list) {
    const row = {
      endpoint: w.endpoint,
      tier: w.tier,
      cadence: w.tier === "free" ? "weekly" : "daily",
      measurements: null,
      first_at: null,
      latest: null,
      history_url: "https://gate.horizonshield.dev/history?endpoint=" + encodeURIComponent(w.endpoint)
    };
    if (joined < REGISTER_JOIN_MAX) {
      joined++;
      const hist = await readHistory(env, w.endpoint);
      const entries = (hist && Array.isArray(hist.entries)) ? hist.entries : [];
      row.measurements = entries.length;
      row.first_at = entries.length ? (entries[0].at || null) : null;
      const latest = entries.length ? entries[entries.length - 1] : null;
      if (latest) {
        row.latest = {
          at: latest.at || null,
          status: latest.status || null,
          record_sha256: latest.record_sha256 || null
        };
      }
    } else {
      row.note = "not joined with history in this response: over REGISTER_JOIN_MAX (" + REGISTER_JOIN_MAX + "). The history_url works regardless.";
    }
    rows.push(row);
  }
  return {
    count: rows.length,
    max: REGISTRY_MAX,
    gate_commit: gateCommit(),
    note: "The public register. Rows are scheduled measurements, not endorsements. An endpoint that is absent has simply never been measured here; absence is NOT a negative verdict. Webhooks are never published. Every stored verdict carries a record_sha256 you can recompute yourself.",
    join: 'POST /watch with {"endpoint":"https://your-server/mcp"}',
    rows: rows
  };
}'''

W_ROUTE_ANCHOR = "    // 監視の登録。誰でも自分のエンドポイントを載せられる。判定は変わらない。"

W_ROUTE_NEW = '''    // 公開の登録簿。加盟者の行を、人間もエージェントも一覧で読める。
    if (path === "/register" && request.method === "GET") {
      return json(await publicRegister(env));
    }

''' + W_ROUTE_ANCHOR

# ---------------------------------------------------------------- page側

P_H2_OLD = "<h2>Four rows. Not one of them passes. None of them came from outside.</h2>"
P_H2_NEW = "<h2>Every row, drawn live from the register. Ours sit in the same table.</h2>"

P_CARDS_ANCHOR = 'That is the core of the design and it is not relaxed for anybody.</p></div>\n    </div>'
P_CARDS_NEW = P_CARDS_ANCHOR + '''
    <div class="kh" style="margin-top:28px">The rows, live</div>
    <p class="slead">This table is read from the gate's public register at <span class="mono">/register</span> every time this page loads. A member that joins appears here on the next load, with its latest verdict and full public history. <span id="reglive-note">Loading the register…</span></p>
    <div id="regrows"></div>'''

P_CSS_ANCHOR = "</style>"
P_CSS_NEW = '''.regrow{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--line, rgba(127,127,127,.3));border-radius:10px;margin:10px 0;font-size:14px}
.regrow .grow{flex:1 1 260px;word-break:break-all}
.regrow a{white-space:nowrap}
</style>'''

P_JS_ANCHOR = 'document.addEventListener("DOMContentLoaded", function(){'

P_JS_FUNC = '''async function loadRegister(){
  const box = document.getElementById("regrows");
  const note = document.getElementById("reglive-note");
  if (!box || !note) return;
  try{
    const res = await fetch(GATE + "/register");
    const data = await res.json();
    const rows = Array.isArray(data.rows) ? data.rows : [];
    box.textContent = "";
    if (!rows.length){
      note.textContent = "The register answered with zero rows. That is the state of the register, not an error.";
      return;
    }
    note.textContent = rows.length + " rows on the register right now. Absence is not a negative verdict.";
    rows.forEach(function(r){
      const d = document.createElement("div"); d.className = "regrow";
      const ep = document.createElement("span"); ep.className = "mono grow"; ep.textContent = r.endpoint; d.appendChild(ep);
      const st = document.createElement("span"); st.className = "mono";
      st.textContent = (r.latest && r.latest.status)
        ? (r.latest.status + " \\u00b7 " + String(r.latest.at || "").slice(0, 10))
        : "no measurement stored yet";
      d.appendChild(st);
      if (typeof r.measurements === "number"){
        const m = document.createElement("span"); m.className = "mono";
        m.textContent = r.measurements + (r.measurements === 1 ? " measurement" : " measurements");
        d.appendChild(m);
      }
      const h = document.createElement("a"); h.href = r.history_url; h.textContent = "history"; d.appendChild(h);
      const b = document.createElement("a"); b.href = "#"; b.textContent = "measure now";
      b.addEventListener("click", function(ev){
        ev.preventDefault();
        const inp = document.getElementById("epin");
        if (inp) inp.value = r.endpoint;
        runCheck(r.endpoint);
      });
      d.appendChild(b);
      box.appendChild(d);
    });
  }catch(e){
    note.textContent = "live register unavailable (" + e.message + ") \\u2014 the summary above still stands, and the gate answers at /register directly.";
  }
}
''' + P_JS_ANCHOR

P_JS_CALL_OLD = P_JS_ANCHOR + '\n  document.querySelectorAll(".preset")'
P_JS_CALL_NEW = P_JS_ANCHOR + '\n  loadRegister();\n  document.querySelectorAll(".preset")'


def one(text, needle, label):
    n = text.count(needle)
    print("  %s %s: 期待1 実際%d" % ("OK " if n == 1 else "NG ", label, n))
    return n == 1


def main():
    wtext = io.open(W, encoding="utf-8").read()
    ptext = io.open(P, encoding="utf-8").read()

    ok = True
    print("[worker] " + W)
    ok &= one(wtext, W_FUNC_ANCHOR, "readSweepLast末尾（関数の挿入点）")
    ok &= one(wtext, W_ROUTE_ANCHOR, "/watchコメント（ルートの挿入点）")
    ok &= one(wtext, "function gateCommit", "gateCommitの存在")
    if "publicRegister" in wtext:
        print("  NG publicRegisterが既に存在する（二重適用）"); ok = False

    print("[page] " + P)
    ok &= one(ptext, P_H2_OLD, "静的見出し（Four rows）")
    ok &= one(ptext, P_CARDS_ANCHOR, "カード末尾（一覧の挿入点）")
    ok &= one(ptext, P_CSS_ANCHOR, "styleタグの閉じ")
    ok &= one(ptext, P_JS_CALL_OLD, "DOMContentLoadedの先頭")
    if "loadRegister" in ptext:
        print("  NG loadRegisterが既に存在する（二重適用）"); ok = False

    if not ok:
        print("\n★ 前提が違う。1バイトも書かずに終了する。")
        sys.exit(1)

    if not APPLY:
        print("\ndry-run 合格。全アンカー一意。--apply を付ければ書く。")
        return

    wnew = wtext.replace(W_FUNC_ANCHOR, W_FUNC_NEW).replace(W_ROUTE_ANCHOR + "\n", W_ROUTE_NEW + "\n", 1)
    pnew = (ptext
            .replace(P_H2_OLD, P_H2_NEW)
            .replace(P_CARDS_ANCHOR, P_CARDS_NEW)
            .replace(P_CSS_ANCHOR, P_CSS_NEW, 1)
            .replace(P_JS_ANCHOR, P_JS_FUNC, 1))
    pnew = pnew.replace(P_JS_CALL_OLD, P_JS_CALL_NEW, 1)

    checks = [
        (wnew.count('path === "/register"') == 1, "worker: /registerルートが1つ"),
        (wnew.count("async function publicRegister") == 1, "worker: publicRegister定義が1つ"),
        (wnew.count("publicRegister(env)") == 2, "worker: 定義+呼び出しで2箇所"),
        (wnew.count("w.webhook") == wtext.count("w.webhook"), "worker: 登録簿がw.webhookを読まない"),
        ("webhook:" not in W_FUNC_NEW, "worker: 登録簿の行にwebhookプロパティが無い"),
        (pnew.count("async function loadRegister") == 1, "page: loadRegister定義が1つ"),
        (pnew.count("loadRegister();") == 1, "page: 呼び出しが1つ"),
        (pnew.count('id="regrows"') == 1 and pnew.count('getElementById("regrows")') == 1, "page: 一覧コンテナと参照"),
        (pnew.count(P_H2_NEW) == 1 and P_H2_OLD not in pnew, "page: 見出し差し替え"),
        (pnew.count("</style>") == 1, "page: styleタグは1つのまま"),
    ]
    bad = [label for okc, label in checks if not okc]
    for okc, label in checks:
        print("  %s %s" % ("OK " if okc else "NG ", label))
    if bad:
        print("\n★ 適用後検査に失敗。書かずに終了する。")
        sys.exit(1)

    io.open(W, "w", encoding="utf-8", newline="").write(wnew)
    io.open(P, "w", encoding="utf-8", newline="").write(pnew)
    print("\n書いた: %s" % W)
    print("書いた: %s" % P)
    print("\n次: 1) git add -f patch16_register_rows.py && git add %s %s" % (W, P))
    print("    2) git commit して push（ページはこれで本番に出る）")
    print("    3) bash workers/hs-verify-gate/deploy_gate.sh（ゲートのデプロイ。コミット後に）")
    print("    4) curl -s https://gate.horizonshield.dev/register で行が返るか確認")


if __name__ == "__main__":
    main()
