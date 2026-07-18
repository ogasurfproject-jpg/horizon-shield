/* HORIZON SHIELD KIRA embed widget  (served at /embed.js?store=hs-partner-XXX)
   各加盟店サイトに <script src=".../embed.js?store=..."> 1行で載る。
   表向きは全店同一の「KIRA」。store は自分のscript URLから読み、裏でマルチテナントMCPを叩く。
   Shadow DOM でホストページのCSSと完全隔離。localStorage不使用。金額は保存しない。 */
(function () {
  if (window.__HS_KIRA_EMBED__) return;
  window.__HS_KIRA_EMBED__ = true;

  // --- self-identify: store と origin を自分のscript URLから ---
  var me = document.currentScript;
  var srcUrl = (me && me.src) || '';
  if (!srcUrl) {
    var ss = document.getElementsByTagName('script');
    for (var i = 0; i < ss.length; i++) {
      if (ss[i].src && ss[i].src.indexOf('/embed.js') > -1) { me = ss[i]; srcUrl = ss[i].src; break; }
    }
  }
  var store = '';
  var ORIGIN = 'https://hs-webmcp.oga-surf-project.workers.dev';
  try { var u = new URL(srcUrl); store = u.searchParams.get('store') || ''; ORIGIN = u.origin; } catch (e) {}
  if (me && me.getAttribute && me.getAttribute('data-store')) store = me.getAttribute('data-store');
  var ENDPOINT = ORIGIN + '/mcp?store=' + encodeURIComponent(store);
  var SITE = 'https://shield.the-horizons-innovation.com';

  // --- 軽量計測ビーコン(匿名。金額や入力内容は一切送らない。event名だけ) ---
  function ping(ev) {
    try {
      var u = ORIGIN + '/beacon?store=' + encodeURIComponent(store) + '&event=' + ev;
      if (navigator.sendBeacon) { navigator.sendBeacon(u, ''); return; }
      if (window.fetch) { fetch(u, { method: 'POST', mode: 'no-cors', keepalive: true }).catch(function () {}); }
    } catch (e) {}
  }

  function esc(s) {
    s = (s == null ? '' : String(s));
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function yen(n) { try { return '¥' + Number(n).toLocaleString(); } catch (e) { return '¥' + n; } }

  var CSS =
    '*{box-sizing:border-box}' +
    '.fab{position:fixed;right:20px;bottom:20px;z-index:2147483000;background:#f97316;color:#111;border:0;border-radius:999px;padding:14px 20px;font-weight:800;font-size:15px;cursor:pointer;box-shadow:0 8px 28px rgba(0,0,0,.4);font-family:system-ui,"Hiragino Sans",Meiryo,sans-serif}' +
    '.fab:hover{filter:brightness(1.05)}' +
    '.fab .d{display:inline-block;width:8px;height:8px;border-radius:50%;background:#111;margin-right:8px;vertical-align:middle;opacity:.65}' +
    '.panel{position:fixed;right:20px;bottom:84px;z-index:2147483000;width:370px;max-width:calc(100vw - 28px);max-height:calc(100vh - 120px);overflow:auto;background:#0f0f10;color:#e8e8ea;border:1px solid #2a2a2a;border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.55);font-family:system-ui,"Hiragino Sans",Meiryo,sans-serif;display:none;line-height:1.7}' +
    '.panel.open{display:block}' +
    '.hd{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #222;position:sticky;top:0;background:#0f0f10}' +
    '.ttl{font-weight:800;font-size:16px;color:#fff}' +
    '.tag{font-size:11px;font-weight:700;color:#f97316;border:1px solid #f97316;border-radius:999px;padding:2px 8px;margin-left:8px;vertical-align:middle}' +
    '.x{background:0;border:0;color:#888;font-size:22px;line-height:1;cursor:pointer;padding:2px 6px}' +
    '.x:hover{color:#fff}' +
    '.bd{padding:16px 18px}' +
    '.lead{color:#b9c0cc;font-size:13px;margin:0 0 14px}' +
    'label{display:block;font-size:12px;color:#9aa4b2;margin:12px 0 5px;font-weight:700}' +
    'input{width:100%;background:#161719;border:1px solid #313235;color:#fff;border-radius:10px;padding:11px 12px;font-size:15px;outline:none}' +
    'input:focus{border-color:#f97316}' +
    '.go{width:100%;margin-top:16px;background:#f97316;color:#111;border:0;border-radius:10px;padding:13px;font-weight:800;font-size:15px;cursor:pointer}' +
    '.go:disabled{opacity:.6;cursor:default}' +
    '.err{color:#fca5a5;font-size:12px;margin-top:8px;min-height:14px}' +
    '.rc{margin-top:16px;background:#141416;border:1px solid #26262a;border-radius:12px;padding:14px 15px}' +
    '.rc.load{color:#9aa4b2;text-align:center}' +
    '.row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}' +
    '.yp{font-size:26px;font-weight:800;color:#fff;font-variant-numeric:tabular-nums}' +
    '.badge{font-size:12px;font-weight:800;color:#111;border-radius:999px;padding:5px 12px;white-space:nowrap}' +
    '.dim{color:#9aa4b2;font-size:12px;margin-top:6px}' +
    '.adv{color:#e8e8ea;font-size:14px;margin:12px 0 0}' +
    '.note{color:#8b95a3;font-size:12px;margin:8px 0 0}' +
    '.src{color:#6b7280;font-size:11px;margin-top:12px}' +
    '.rtitle{font-weight:800;color:#fff;font-size:15px;margin-bottom:6px}' +
    '.rng{margin:14px 0 2px}' +
    '.track{position:relative;height:10px;background:#232327;border-radius:6px}' +
    '.okband{position:absolute;top:0;height:10px;background:rgba(34,197,94,.28);border-radius:6px}' +
    '.avg{position:absolute;top:-3px;width:2px;height:16px;background:#c9ced6;transform:translateX(-1px)}' +
    '.you{position:absolute;top:-4px;width:16px;height:16px;border-radius:50%;border:2px solid #0f0f10;transform:translateX(-8px)}' +
    '.lbls{display:flex;justify-content:space-between;color:#8b95a3;font-size:11px;margin-top:8px}' +
    '.ehn{display:block;text-align:center;margin-top:12px;background:#f97316;color:#111;font-weight:800;font-size:14px;border-radius:10px;padding:12px;text-decoration:none}' +
    '.ehn2{display:block;text-align:center;margin-top:8px;color:#e8e8ea;font-size:13px;text-decoration:underline}' +
    '.ft{color:#6b7280;font-size:11px;margin-top:14px;border-top:1px solid #222;padding-top:12px;line-height:1.6}';

  var HTML =
    '<button class="fab" id="fab" aria-label="見積もりを無料診断"><span class="d"></span>見積もりを無料診断</button>' +
    '<div class="panel" id="panel" role="dialog" aria-label="KIRA 見積もり診断" aria-modal="false">' +
      '<div class="hd"><div class="ttl">KIRA 見積もり診断<span class="tag">無料・匿名</span></div>' +
        '<button class="x" id="x" aria-label="閉じる">&times;</button></div>' +
      '<div class="bd">' +
        '<p class="lead">建設30年監修のAIが、業者の見積もりが適正かをオープン建設費DB(65,729品目)に照らして一次診断します。判断はあなた自身。契約は急かしません。</p>' +
        '<div id="form">' +
          '<label for="hsw">工事名</label>' +
          '<input id="hsw" placeholder="例: 外壁塗装 シリコン 30坪" autocomplete="off">' +
          '<label for="hsp">業者の見積もり金額(円)</label>' +
          '<input id="hsp" inputmode="numeric" placeholder="例: 1200000" autocomplete="off">' +
          '<button class="go" id="go">診断する</button>' +
          '<div class="err" id="ferr"></div>' +
        '</div>' +
        '<div id="result"></div>' +
        '<div class="ft">運営 The HORIZ音s株式会社 / 監修 大賀俊勝(建設実務30年)。KIRAは施工業者から紹介料や送客報酬を受け取らない、独立した第三者です。</div>' +
      '</div>' +
    '</div>';

  var host = document.createElement('div');
  (document.body || document.documentElement).appendChild(host);
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  var box = document.createElement('div');
  box.innerHTML = '<style>' + CSS + '</style>' + HTML;
  root.appendChild(box);

  var $ = function (id) { return root.getElementById ? root.getElementById(id) : root.querySelector('#' + id); };
  var panel = root.querySelector('#panel');
  var result = root.querySelector('#result');

  // EHN導線クリックの計測(リンク先はそのまま新規タブで開く)
  result.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== result) {
      if (t.className === 'ehn' || t.className === 'ehn2') { ping('ehn_click'); break; }
      t = t.parentNode;
    }
  });

  var opened = false;
  function open() { panel.classList.add('open'); if (!opened) { opened = true; ping('open'); } var w = root.querySelector('#hsw'); if (w) w.focus(); }
  function close() { panel.classList.remove('open'); }
  root.querySelector('#fab').addEventListener('click', function () { panel.classList.contains('open') ? close() : open(); });
  root.querySelector('#x').addEventListener('click', close);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

  function badge(level) {
    var c = level === 'ok' ? '#22c55e' : (level === 'alert' ? '#ef4444' : '#f59e0b');
    var t = level === 'ok' ? '適正レンジ内' : (level === 'alert' ? '過剰請求の懸念' : 'やや高い');
    return '<span class="badge" style="background:' + c + '">' + t + '</span>';
  }
  function rangeBar(a) {
    var fr = a.fair_range; if (!fr) return '';
    var lo = Math.min(fr.min, a.your_price), hi = Math.max(fr.max, a.your_price);
    if (hi === lo) hi = lo + 1;
    function pct(x) { return Math.max(0, Math.min(100, (x - lo) / (hi - lo) * 100)); }
    var mn = pct(fr.min), mx = pct(fr.max), av = pct(fr.avg), yo = pct(a.your_price);
    var c = a.level === 'ok' ? '#22c55e' : (a.level === 'alert' ? '#ef4444' : '#f59e0b');
    return '<div class="rng"><div class="track">' +
      '<span class="okband" style="left:' + mn + '%;width:' + (mx - mn) + '%"></span>' +
      '<span class="avg" style="left:' + av + '%"></span>' +
      '<span class="you" style="left:' + yo + '%;background:' + c + '"></span>' +
      '</div><div class="lbls"><span>' + yen(fr.min) + '</span><span>適正帯(平均 ' + yen(fr.avg) + ')</span><span>' + yen(fr.max) + '</span></div></div>';
  }
  function ehnBlock(a) {
    var board = (a && a.next_actions && a.next_actions.board_url) || (a && a.ehn && a.ehn.compare_cases) || (SITE + '/ehn/');
    var submit = (a && a.next_actions && a.next_actions.ehn_submit) || (a && a.ehn && a.ehn.ehn_submit) || (SITE + '/hacker/submit/');
    return '<a class="ehn" href="' + esc(submit) + '" target="_blank" rel="noopener">この見積もりを匿名で第三者チェック(無料)</a>' +
      '<a class="ehn2" href="' + esc(board) + '" target="_blank" rel="noopener">みんなの実例と並べて見る</a>';
  }
  function renderAudit(a) {
    var html;
    if (a.unit_mismatch) {
      html = '<div class="rtitle">単価建ての工事です</div>' +
        '<p class="adv">' + esc(a.message) + '</p>' +
        (a.how_to_proceed ? '<p class="note">' + esc(a.how_to_proceed) + '</p>' : '') +
        ehnBlock(a) +
        (a.source ? '<div class="src">出典: ' + esc(a.source) + '</div>' : '');
    } else if (a.fair_range && a.verdict) {
      html = '<div class="row"><div class="yp">' + yen(a.your_price) + '</div>' + badge(a.level) + '</div>' +
        '<div class="dim">' + esc(a.verdict) + ' ・ 平均比 ' + esc(a.vs_avg_pct) + '</div>' +
        rangeBar(a) +
        (a.advice ? '<p class="adv">' + esc(a.advice) + '</p>' : '') +
        (a.note ? '<p class="note">' + esc(a.note) + '</p>' : '') +
        ehnBlock(a) +
        (a.source ? '<div class="src">出典: ' + esc(a.source) + '</div>' : '');
    } else {
      html = '<p class="adv">' + esc(a.advice || a.message || '診断結果を取得しました。') + '</p>' + ehnBlock(a);
    }
    result.innerHTML = '<div class="rc">' + html + '</div>';
  }
  function renderSoft(out) {
    var ehn = (out && out.next && out.next.ehn) || (SITE + '/ehn/');
    result.innerHTML = '<div class="rc"><p class="adv">' + esc((out && out.message) || '今回は診断できませんでした。') + '</p>' +
      '<a class="ehn" href="' + esc(ehn) + '" target="_blank" rel="noopener">EHNで匿名・無料の第三者チェック</a></div>';
  }
  function renderError(err) {
    var msg = (err && err.code === -32001) ? 'この店舗ではまだ診断をご利用いただけません。' : 'ただいま混み合っています。少し時間をおいて再度お試しください。';
    result.innerHTML = '<div class="rc"><p class="adv">' + esc(msg) + '</p>' + ehnBlock(null) + '</div>';
  }

  function diagnose(work, price) {
    var go = root.querySelector('#go'); go.disabled = true;
    result.innerHTML = '<div class="rc load">KIRAが照合しています…</div>';
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'intake_estimate', arguments: { work: work, quoted_price: price } } })
    }).then(function (r) { return r.json(); }).then(function (d) {
      go.disabled = false;
      if (d && d.error) { renderError(d.error); return; }
      var out = (d && d.result && d.result.structuredContent) ? d.result.structuredContent : null;
      if (!out && d && d.result && d.result.content && d.result.content[0]) { try { out = JSON.parse(d.result.content[0].text); } catch (e) {} }
      if (!out) { renderError({}); return; }
      if (out.ok === false) { renderSoft(out); return; }
      var audit = null; try { audit = JSON.parse(out.audit); } catch (e) {}
      if (!audit) { renderSoft(out); return; }
      renderAudit(audit);
    }).catch(function () { go.disabled = false; renderError({}); });
  }

  root.querySelector('#go').addEventListener('click', function () {
    var w = (root.querySelector('#hsw').value || '').trim();
    var praw = (root.querySelector('#hsp').value || '').replace(/[^0-9]/g, '');
    var ferr = root.querySelector('#ferr');
    if (!w) { ferr.textContent = '工事名を入力してください。'; return; }
    if (!praw) { ferr.textContent = '見積もり金額(数字)を入力してください。'; return; }
    ferr.textContent = '';
    diagnose(w, parseInt(praw, 10));
  });

  // 表示計測(ウィジェットが実際に描画された時に1回)
  ping('view');
})();
