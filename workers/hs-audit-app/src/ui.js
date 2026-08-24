export const AUDIT_UI_HTML = /* html */ `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>HORIZON SHIELD 見積もり誠実性監査</title>
<style>
  :root {
    --bg: #0f1216; --card: #171b21; --line: #262c36; --fg: #e8ecf1;
    --muted: #9aa4b2; --ok: #2ec76a; --watch: #f5a623; --alert: #ff4d4f;
    --accent: #4c8dff; --chip: #1e242d;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg:#f6f8fb; --card:#fff; --line:#e6eaf0; --fg:#12151a;
            --muted:#5b6572; --chip:#eef2f7; }
  }
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;
         background:var(--bg); color:var(--fg); padding:16px; line-height:1.5; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px;
          padding:18px; max-width:640px; margin:0 auto; }
  h1 { font-size:15px; margin:0 0 4px; letter-spacing:.02em; }
  .sub { color:var(--muted); font-size:12px; margin-bottom:14px; }
  form { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; }
  input { flex:1; min-width:140px; background:var(--chip); border:1px solid var(--line);
          color:var(--fg); border-radius:9px; padding:10px 12px; font-size:14px; }
  button { background:var(--accent); color:#fff; border:0; border-radius:9px;
           padding:10px 16px; font-size:14px; font-weight:600; cursor:pointer; }
  button:disabled { opacity:.5; cursor:default; }
  .badge { display:inline-block; padding:4px 12px; border-radius:999px; font-weight:700;
           font-size:13px; }
  .lv-ok { background:rgba(46,199,106,.15); color:var(--ok); }
  .lv-watch { background:rgba(245,166,35,.15); color:var(--watch); }
  .lv-alert { background:rgba(255,77,79,.15); color:var(--alert); }
  .price { font-size:26px; font-weight:800; margin:10px 0 2px; }
  .vs { font-size:13px; color:var(--muted); }
  .bar { position:relative; height:12px; background:var(--chip); border-radius:99px;
         margin:16px 0 6px; overflow:visible; }
  .bar .range { position:absolute; top:0; bottom:0; background:rgba(76,141,255,.28);
                border-radius:99px; }
  .bar .avg { position:absolute; top:-3px; width:2px; height:18px; background:var(--fg); }
  .bar .you { position:absolute; top:-6px; width:12px; height:12px; border-radius:50%;
              border:3px solid var(--card); }
  .scale { display:flex; justify-content:space-between; font-size:11px; color:var(--muted); }
  .advice { background:var(--chip); border-radius:10px; padding:12px; font-size:13px;
            margin:14px 0; }
  .note { font-size:12px; color:var(--muted); }
  .prov { border-top:1px dashed var(--line); margin-top:16px; padding-top:12px;
          font-size:11.5px; color:var(--muted); }
  .prov b { color:var(--fg); font-weight:600; }
  .prov .sha { font-family:ui-monospace,Menlo,monospace; word-break:break-all;
               background:var(--chip); padding:2px 6px; border-radius:6px; }
  .prov a { color:var(--accent); text-decoration:none; }
  .row { display:flex; gap:8px; flex-wrap:wrap; margin-top:6px; }
  .chip { background:var(--chip); border-radius:7px; padding:3px 9px; font-size:11px; }
  .err { color:var(--alert); font-size:13px; }
  .hidden { display:none; }
</style>
</head>
<body>
  <div class="card">
    <h1>🛡 HORIZON SHIELD 見積もり誠実性監査</h1>
    <div class="sub">工事名と提示額を入れると、実務監修の適正レンジで即判定します。</div>

    <form id="f">
      <input id="work" placeholder="工事名 例: 外壁塗装 シリコン" autocomplete="off" />
      <input id="price" type="number" placeholder="提示額(円/単価)" inputmode="numeric" />
      <button id="go" type="submit">監査する</button>
    </form>

    <div id="err" class="err hidden"></div>
    <div id="result" class="hidden"></div>
  </div>

<script type="module">
  // ---- ホストブリッジ(ext-apps 現行仕様に合わせて確認する3点) --------------
  const pending = new Map();
  let seq = 0;
  const host = {
    ready() { post({ jsonrpc:"2.0", method:"app/ready" }); },
    callTool(name, args) {
      const id = "c" + (++seq);
      post({ jsonrpc:"2.0", id, method:"tools/call", params:{ name, arguments: args } });
      return new Promise((res, rej) => pending.set(id, { res, rej }));
    },
  };
  function post(msg) { parent.postMessage(msg, "*"); }
  window.addEventListener("message", (e) => {
    const m = e.data || {};
    // 2) host -> iframe: 初回/更新の描画データ
    if (m.method === "app/render" && m.params) return render(m.params.structuredContent || m.params);
    // tools/call の応答
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id);
      if (m.error) rej(m.error);
      else res(unwrap(m.result));
    }
  });
  // MCPのtool結果 { structuredContent } / { content:[{text}] } の両対応
  function unwrap(result) {
    if (!result) return null;
    if (result.structuredContent) return result.structuredContent;
    const t = result.content && result.content.find(c => c.type === "text");
    if (t) { try { return JSON.parse(t.text); } catch { return { advice: t.text }; } }
    return result;
  }

  // ---- 再監査フォーム ------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  $("f").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const work = $("work").value.trim();
    const quoted_price = Number($("price").value);
    if (!work || !quoted_price) return;
    $("go").disabled = true; showErr("");
    try {
      const data = await host.callTool("audit_estimate", { work, quoted_price });
      render(data);
    } catch (err) {
      showErr("監査に失敗しました: " + (err && err.message ? err.message : String(err)));
    } finally { $("go").disabled = false; }
  });

  function showErr(msg) {
    const el = $("err");
    el.textContent = msg; el.classList.toggle("hidden", !msg);
  }

  // ---- 結果カード描画 ------------------------------------------------------
  const yen = (n) => "¥" + Number(n).toLocaleString("ja-JP");
  function render(d) {
    if (!d) return;
    // フォームに現在値を反映(ホスト初回描画時に埋める)
    if (d.work_query) $("work").value = d.work_query;
    if (d.your_price != null) $("price").value = d.your_price;

    // unit_mismatch / did_you_mean など非マッチ系
    if (d.unit_mismatch) return simple(d.message || "単価建ての工事です。単価で再入力してください。", d);
    if (!d.fair_range) return simple(d.advice || d.message || "該当データが見つかりませんでした。", d);

    const lv = d.level || "ok";
    const cls = lv === "alert" ? "lv-alert" : lv === "watch" ? "lv-watch" : "lv-ok";
    const { min, avg, max } = d.fair_range;
    const you = d.your_price;
    // バーのスケール: min*0.6 〜 max*1.6 の範囲に配置
    const lo = min * 0.6, hi = Math.max(max * 1.6, you * 1.1);
    const pct = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
    const youColor = lv === "alert" ? "var(--alert)" : lv === "watch" ? "var(--watch)" : "var(--ok)";

    $("result").innerHTML = \`
      <div><span class="badge \${cls}">\${esc(d.verdict || "判定")}</span></div>
      <div class="price">\${yen(you)} <span class="vs">/ \${esc(d.unit || "")}・平均比 \${esc(d.vs_avg_pct || "")}</span></div>
      <div class="bar">
        <div class="range" style="left:\${pct(min)}%; right:\${100-pct(max)}%"></div>
        <div class="avg" style="left:\${pct(avg)}%"></div>
        <div class="you" style="left:calc(\${pct(you)}% - 6px); background:\${youColor}"></div>
      </div>
      <div class="scale"><span>適正 \${yen(min)}</span><span>平均 \${yen(avg)}</span><span>\${yen(max)}</span></div>
      <div class="advice">\${esc(d.advice || "")}</div>
      \${d.note ? \`<div class="note">\${esc(d.note)}</div>\` : ""}
      \${provBlock(d)}
    \`;
    $("result").classList.remove("hidden");
  }

  function simple(msg, d) {
    $("result").innerHTML = \`<div class="advice">\${esc(msg)}</div>\${provBlock(d)}\`;
    $("result").classList.remove("hidden");
  }

  // 出典・検証ブロック(引用が剥がれない核心)
  function provBlock(d) {
    const p = d && d._provenance;
    if (!p) return d && d.source ? \`<div class="prov">出典: \${esc(d.source)}</div>\` : "";
    const sg = p.signed;
    return \`
      <div class="prov">
        <div><b>\${esc(p.system)}</b> — \${esc(p.provider)} / \${esc(p.data.db)} v\${esc(p.data.version)}
          (\${esc(p.data.supervisor)})</div>
        <div class="row">
          <span class="chip">\${esc(p.data.dataset)} \${p.data.items.toLocaleString()}項目</span>
          <span class="chip">DOI \${esc(p.data.doi)}</span>
          <span class="chip">\${esc(p.data.license)}</span>
          <span class="chip">更新 \${esc(p.data.updated_at)}</span>
        </div>
        \${sg ? \`<div style="margin-top:8px">検証: <span class="sha">\${esc(sg.claim_sha256)}</span>
          <a href="\${esc(sg.verify_url)}" target="_blank" rel="noopener">→ 改ざん検証</a></div>\`
          : \`<div style="margin-top:8px">署名付き証明: <b>verify_fair_price</b> で取得可 ·
             <a href="\${esc(p.verification_contract)}" target="_blank" rel="noopener">検証契約</a></div>\`}
        <div style="margin-top:6px"><a href="\${esc(p.site)}" target="_blank" rel="noopener">\${esc(p.site)}</a></div>
      </div>\`;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) =>
      ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
  }

  // ホストに準備完了を通知(初回 structuredContent を受け取る)
  host.ready();
<\/script>
</body>
</html>`;
